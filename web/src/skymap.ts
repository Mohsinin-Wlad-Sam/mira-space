// THE WHOLE SKY — a flat map of the entire sky that behaves like any map: drag to move, scroll to zoom, nothing bends.
// Three NASA pictures of the whole sky lie under one slider and fade into one another by year (2MASS ~1999, WISE
// 2010, SPHEREx 2025–26); on SPHEREx, a second slider goes through its 102 wavelengths, each read live from NASA's
// all-sky cube at IRSA. Every confirmed mover of the verified catalogue is a point one can click; any other place
// can be measured in the Lab or looked at closely with CDS's Aladin.
// The map is drawn here, from plain pictures, in Galactic coordinates (the Milky Way runs along the middle).
import { hpxFaceXY } from "./blink/hips";
import { parseCoords, resolveName } from "./blink/catalogs";
import { KIND_PLAIN, isOpenCase, loadVerified, moonYears, mountMoverCard, moverName, votes, type Ver } from "./movercard";

export type SkyOpts = { base: string; lowPower?: boolean; focus?: string;
  onObserve: (t: { ra: number; dec: number; pmra?: number; pmdec?: number; epoch?: number; name?: string; source?: string }) => void;
  onExplain?: (q: string) => void; on3D?: (id: string) => void; onCloser?: (ra: number, dec: number) => void; toast?: (m: string) => void };
export type SkyHandle = { pause: (on: boolean) => void; focus: (q: string) => Promise<boolean>; context: () => unknown };

const D = Math.PI / 180;
const AG = [[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132], [0.4941094278755837, -0.4448296299600112, 0.7469822444972189], [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]];   // ICRS -> Galactic
export const toGal = (ra: number, dec: number): [number, number] => { const a = ra * D, d = dec * D, e = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const g = AG.map((r) => r[0] * e[0] + r[1] * e[1] + r[2] * e[2]); return [((Math.atan2(g[1], g[0]) / D) + 360) % 360, Math.asin(Math.max(-1, Math.min(1, g[2]))) / D]; };
export const toEq = (l: number, b: number): [number, number] => { const g = [Math.cos(b * D) * Math.cos(l * D), Math.cos(b * D) * Math.sin(l * D), Math.sin(b * D)];
  const e = [0, 1, 2].map((i) => AG[0][i] * g[0] + AG[1][i] * g[1] + AG[2][i] * g[2]); return [((Math.atan2(e[1], e[0]) / D) + 360) % 360, Math.asin(Math.max(-1, Math.min(1, e[2]))) / D]; };
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const hms = (ra: number, dec: number) => { const h = ra / 15, hh = Math.floor(h), mm = Math.floor((h - hh) * 60), a = Math.abs(dec), dd = Math.floor(a), dm = Math.floor((a - dd) * 60);
  return `${String(hh).padStart(2, "0")}h${String(mm).padStart(2, "0")}m ${dec < 0 ? "−" : "+"}${String(dd).padStart(2, "0")}°${String(dm).padStart(2, "0")}′`; };
const SX = "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube";
/** SPHEREx's 102 wavelengths (µm), from the cube's own description; filled from its properties file */
let LAM: number[] = [];
const MISSIONS = [{ k: "2mass", yr: 1999, name: "2MASS", what: "near-infrared, 1.2–2.2 µm, 1997–2001" }, { k: "wise", yr: 2010, name: "WISE", what: "mid-infrared, 3.4–22 µm, 2010" }, { k: "spherex", yr: 2025, name: "SPHEREx", what: "three of its 102 colours: 1.1, 2.2 and 4.4 µm, 2025–26" }];

export async function openSky(host: HTMLElement, o: SkyOpts): Promise<SkyHandle> {
  host.innerHTML = `<canvas class="sk-cv" aria-label="Map of the whole sky"></canvas>
    <svg class="sp-leader" id="skleader" aria-hidden="true" hidden><circle r="13"/><circle r="2.5"/><polyline points=""/></svg>
    <aside class="sk-panel">
      <div class="eyebrow">The whole sky, as three NASA surveys saw it</div>
      <div class="sk-stops" id="skstops">${MISSIONS.map((m, i) => `<button data-i="${i}" title="${m.name}: ${m.what}"><b>${m.yr}</b>${m.name}</button>`).join("")}</div>
      <div class="sk-row"><button class="icon-btn" id="skplay" title="Play slowly from 1999 to today" aria-label="Play from 1999 to today">▶</button><input type="range" id="skt" min="0" max="2000" value="2000" aria-label="Year: from the 2MASS picture to the SPHEREx picture"></div>
      <p class="sk-what" id="skwhat"></p>
      <div class="sk-wave" id="skwave">
        <div class="eyebrow">SPHEREx sees 102 colours · pick one</div>
        <div class="sk-row"><input type="range" id="skw" min="0" max="101" value="60" aria-label="SPHEREx wavelength"><b class="mono" id="skwl">–</b></div>
        <div class="sk-row"><button class="link" id="skrgb">back to the three-colour picture</button><span class="sk-busy" id="skbusy"></span></div>
      </div>
      <div class="eyebrow">Caught moving · confirmed on SPHEREx images</div>
      <div class="sk-chips" id="skchips"><button data-c="all" class="on"><i style="background:#ff9d4d"></i><b id="skn1">…</b> confirmed movers</button><button data-c="nogaia"><i style="background:#ff5d6c"></i><b id="skn2">…</b> not in Gaia</button><button data-c="open"><i style="background:#7df0a6"></i><b id="skn3">…</b> to look at · help</button></div>
      <p class="sk-hint">Drag to move, scroll or pinch to zoom. Click a point to see it move; click any empty place to measure it. The Milky Way runs along the middle.</p>
    </aside>
    <div class="sk-coords mono" id="skcoords"></div>
    <div class="sk-menu hud" id="skmenu" hidden></div>
    <div class="sp-info" id="skinfo"></div>`;
  const $ = <T extends HTMLElement>(s: string) => host.querySelector(s) as T, cv = $<HTMLCanvasElement>(".sk-cv"), g = cv.getContext("2d")!;
  const view = { l: 0, b: 0, z: 1 }, st = { t: 2, wave: -1, chip: "all", sel: -1, playing: false, raf: 0, dirty: true, paused: false, last: 0 };
  let cw = 0, ch = 0, V: Ver | null = null, GL = new Float32Array(0), GB = new Float32Array(0), shown: number[] = [], destroyCard: (() => void) | null = null;
  const scale = () => (cw / 360) * view.z;
  const toScreen = (l: number, b: number): [number, number] => [cw / 2 - wrap(l - view.l) * scale(), ch / 2 - (b - view.b) * scale()];
  const toSky = (x: number, y: number): [number, number] => [(((view.l - (x - cw / 2) / scale()) % 360) + 360) % 360, view.b - (y - ch / 2) / scale()];
  const clampView = () => { view.z = Math.min(40, Math.max(1, cw ? (2 * ch) / cw : 1, view.z)); const half = ch / 2 / scale(); view.b = half >= 90 ? 0 : Math.max(-90 + half, Math.min(90 - half, view.b)); view.l = ((view.l % 360) + 360) % 360; };

  // ---- pictures: one panorama per survey (x = Galactic longitude from the left edge, y = latitude from +90 at the top)
  const pano: Record<string, HTMLImageElement | HTMLCanvasElement | null> = {};
  const loadPano = (k: string, size: number) => new Promise<void>((res) => { const im = new Image(); im.onload = () => { const cur = pano[k] as HTMLImageElement | null; if (!cur || cur.width <= im.width) pano[k] = im; st.dirty = true; res(); }; im.onerror = () => res(); im.src = `${o.base}space/mw_${k}_${size}.jpg`; });
  const first = Promise.all(MISSIONS.map((m) => loadPano(m.k, 2048)));
  if (!o.lowPower) first.then(() => MISSIONS.forEach((m) => loadPano(m.k, 4096)));        // sharper copies once the map is up
  // ---- SPHEREx at one wavelength: the "Allsky" preview of that frame of NASA's cube, laid out on the same panorama
  const frames = new Map<number, HTMLCanvasElement>(), loading = new Set<number>(); let lut: Int32Array | null = null;
  const PW = 2048, PH = 1024;
  function buildLut() {                                     // where each panorama pixel lies in the preview's grid of 768 small tiles
    const out = new Int32Array(PW * PH);
    for (let Y = 0; Y < PH; Y++) for (let X = 0; X < PW; X++) { const [ra, dec] = toEq(((X + 0.5) / PW) * 360, 90 - ((Y + 0.5) / PH) * 180), [face, ix, iy] = hpxFaceXY(512, ra, dec);
      let t = 0; for (let q = 0; q < 3; q++) t += ((((ix >> 6) >> q) & 1) + 2 * (((iy >> 6) >> q) & 1)) * 4 ** q; t += face * 64;
      out[Y * PW + X] = (Math.floor(t / 27) * 64 + (ix & 63)) * 1728 + (t % 27) * 64 + (iy & 63); }
    return out;
  }
  const hue = (um: number): [number, number, number] => { const u = Math.min(1, Math.max(0, (um - 0.75) / 4.25)), h = (220 - 220 * u) / 60, c = 0.75, x = c * (1 - Math.abs((h % 2) - 1)), m = 0.25;
    const [r, gg, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : [0, x, c]; return [r + m, gg + m, b + m]; };
  async function loadFrame(k: number) {
    if (frames.has(k) || loading.has(k)) return; loading.add(k); $("#skbusy").textContent = "reading NASA's archive…";
    try {
      const r = await fetch(`${SX}/Norder3/Allsky${k ? "_" + k : ""}.png`); if (!r.ok) throw new Error("no frame");
      const bmp = await createImageBitmap(await r.blob()), src = document.createElement("canvas"); src.width = bmp.width; src.height = bmp.height; const sg = src.getContext("2d", { willReadFrequently: true })!; sg.drawImage(bmp, 0, 0);
      const px = sg.getImageData(0, 0, bmp.width, bmp.height).data; lut ??= buildLut();
      const samp: number[] = []; for (let q = 0; q < lut.length; q += 997) samp.push(px[lut[q] * 4]); samp.sort((a, b) => a - b);
      const lo = samp[Math.floor(samp.length * 0.4)], hi = Math.max(lo + 20, samp[Math.floor(samp.length * 0.998)]), [tr, tg, tb] = hue(LAM[k] ?? 2);
      const out = document.createElement("canvas"); out.width = PW; out.height = PH; const og = out.getContext("2d")!, id = og.createImageData(PW, PH), d = id.data;
      for (let q = 0; q < lut.length; q++) { const v = Math.pow(Math.min(1, Math.max(0, (px[lut[q] * 4] - lo) / (hi - lo))), 0.85) * 255; d[q * 4] = v * tr; d[q * 4 + 1] = v * tg; d[q * 4 + 2] = v * tb; d[q * 4 + 3] = 255; }
      og.putImageData(id, 0, 0); frames.set(k, out); if (frames.size > 14) frames.delete(frames.keys().next().value!);
    } catch { /* the frame stays unavailable; the three-colour picture remains */ }
    loading.delete(k); if (!loading.size) $("#skbusy").textContent = ""; sync();
  }
  fetch(`${SX}/properties`).then((r) => r.text()).then((t) => { const m = t.match(/data_cube_crval3_arr\s*=\s*([^\n]+)/); if (m) LAM = m[1].trim().split(/\s+/).map(Number); sync(); }).catch(() => {});

  // ---- drawing
  function layer(img: HTMLImageElement | HTMLCanvasElement | null | undefined, alpha: number) {
    if (!img || alpha <= 0.003) return; const s = scale(), k = (s * 360) / img.width, y0 = ch / 2 - (90 - view.b) * s; g.globalAlpha = Math.min(1, alpha);
    // longitude grows to the left, as on every map of the sky seen from inside; copies on either side close the circle
    for (let n = -1; n <= 1; n++) { const x0 = cw / 2 + view.l * s + n * 360 * s; if (x0 - 360 * s > cw || x0 < 0) continue; g.save(); g.translate(x0, y0); g.scale(-k, k); g.drawImage(img, 0, 0); g.restore(); }
    g.globalAlpha = 1;
  }
  const ease = (u: number) => u * u * (3 - 2 * u);
  function draw() {
    st.dirty = false; g.fillStyle = "#000"; g.fillRect(0, 0, cw, ch); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    if (st.wave >= 0) { const f = frames.get(st.wave); layer(pano.spherex, f ? 0.25 : 1); layer(f, 1); }
    else { const i = Math.min(1, Math.floor(st.t)), u = ease(Math.min(1, Math.max(0, st.t - i))); layer(pano[MISSIONS[i].k], 1); layer(pano[MISSIONS[i + 1].k], u); }
    // the confirmed movers in view
    if (V) { const s = scale(), r = Math.max(0.75, Math.min(4, 0.2 + 0.11 * s)), dense = st.chip === "all" && s < 12, sel = st.sel; shown = [];
      for (let k = 0; k < GL.length; k++) { if (Math.abs(V.glat[k]) < 10 && k !== sel) continue;                       // the crowded plane is left out, as in the Catalogue
        const nog = V.known[k] !== 1, open = isOpenCase(V, k); if ((st.chip === "nogaia" && !nog) || (st.chip === "open" && !open)) continue;
        const x = cw / 2 - wrap(GL[k] - view.l) * s, y = ch / 2 - (GB[k] - view.b) * s; if (x < -4 || y < -4 || x > cw + 4 || y > ch + 4) continue;
        shown.push(k); g.fillStyle = open ? "#7df0a6" : nog ? "#ff5d6c" : "#ff9d4d"; g.globalAlpha = dense && !nog ? 0.5 : dense ? 0.85 : 1; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
      g.globalAlpha = 1; }
    leader();
  }
  function leader() {
    const sv = $<any>("#skleader") as SVGSVGElement, card = $("#skinfo"); if (st.sel < 0 || !V || !card.classList.contains("open") || cw < 760) { sv.setAttribute("hidden", ""); return; }
    sv.removeAttribute("hidden"); const [x, y] = toScreen(GL[st.sel], GB[st.sel]), r = card.getBoundingClientRect(), h = host.getBoundingClientRect(), cx = r.left - h.left, cy = Math.min(Math.max(y, r.top - h.top + 30), r.bottom - h.top - 30);
    sv.querySelectorAll("circle").forEach((q) => { q.setAttribute("cx", String(x)); q.setAttribute("cy", String(y)); });
    (sv.querySelector("polyline") as SVGPolylineElement).setAttribute("points", `${x + 13},${y} ${Math.max(x + 30, cx - 36)},${cy} ${cx},${cy}`);
  }
  function sync() {
    const i = Math.round(st.t), on = st.wave < 0 && Math.abs(st.t - i) < 0.02 ? i : -1;
    host.querySelectorAll<HTMLButtonElement>("#skstops button").forEach((b) => b.classList.toggle("on", +b.dataset.i! === on));
    $<HTMLInputElement>("#skt").value = String(Math.round(st.t * 1000)); $("#skplay").textContent = st.playing ? "❚❚" : "▶";
    const lam = LAM[st.wave];
    $("#skwhat").textContent = st.wave >= 0 ? `SPHEREx at ${lam ? lam.toFixed(2) : "…"} µm, one of its 102 colours, read live from NASA's all-sky cube.${frames.has(st.wave) ? "" : " Loading…"}`
      : on >= 0 ? `${MISSIONS[on].name}: ${MISSIONS[on].what}.` : `Between ${MISSIONS[Math.floor(st.t)].name} and ${MISSIONS[Math.floor(st.t) + 1].name}: different years and different colours of light, the same sky.`;
    $("#skwave").classList.toggle("on", st.t > 1.98 || st.wave >= 0); $("#skwl").textContent = st.wave >= 0 && lam ? `${lam.toFixed(2)} µm` : "–";
    $("#skrgb").style.visibility = st.wave >= 0 ? "visible" : "hidden";
    host.querySelectorAll<HTMLButtonElement>("#skchips button").forEach((b) => b.classList.toggle("on", b.dataset.c === st.chip));
    st.dirty = true;
  }
  function loop(now: number) {
    if (st.paused) return;
    if (st.playing) { const dt = Math.min(0.1, (now - st.last) / 1000); st.last = now; st.t = Math.min(2, st.t + dt / 4); if (st.t >= 2) st.playing = false; sync(); }
    if (st.dirty) draw();
    st.raf = requestAnimationFrame(loop);
  }
  const resize = () => { const r = host.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); cw = r.width; ch = r.height; if (!cw || !ch) return; cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); cv.style.width = cw + "px"; cv.style.height = ch + "px"; g.setTransform(dpr, 0, 0, dpr, 0, 0); clampView(); st.dirty = true; };
  addEventListener("resize", resize); resize();

  // ---- the card of a confirmed mover, the same as on the 3D map
  const poolIds = () => (V ? V.id.filter((_, k) => isOpenCase(V!, k)) : []);
  function nextCase() { if (!V) return; const v = votes(), pool: number[] = []; for (let k = 0; k < V.id.length; k++) if (isOpenCase(V, k)) pool.push(k); const left = pool.filter((k) => !v[V!.id[k]]), from = left.length ? left : pool; if (from.length) select(from[Math.floor(Math.random() * from.length)], true); }
  function select(k: number, fly = false) {
    closeMenu(); destroyCard?.(); destroyCard = null; st.sel = k; const card = $("#skinfo");
    if (k < 0 || !V) { card.classList.remove("open", "ver", "hud"); st.dirty = true; return; }
    if (fly) { view.l = GL[k]; view.b = GB[k]; view.z = Math.max(view.z, 5); clampView(); }
    destroyCard = mountMoverCard(card, V, k, { lead: `At ${hms(V.ra[k], V.dec[k])} on the sky. It crosses the width of the full Moon every <b>${moonYears(V, k)} years</b>${V.known[k] === 0 ? ", and it is not in Gaia, Europe's optical star catalogue" : ""}.`,
      poolIds, next: nextCase, onClose: () => select(-1), onObserve: (t2) => o.onObserve({ ...t2, source: "The survey of the WISE years (2010–2020)" }), onExplain: o.onExplain, autoplay: !o.lowPower,
      more: [...(o.on3D ? [["See it in 3D", "Fly to this object on the 3D map, if its distance is known", () => o.on3D!(V!.id[k])] as [string, string, () => void]] : []),
        ...(o.onCloser ? [["Look closer", "Real survey tiles of this place, with CDS's Aladin", () => o.onCloser!(V!.ra[k], V!.dec[k])] as [string, string, () => void]] : [])] });
    st.dirty = true;
  }
  // ---- any other place: measure it, or look closer
  const closeMenu = () => { $("#skmenu").hidden = true; };
  function menuAt(x: number, y: number) {
    const [l, b] = toSky(x, y); if (Math.abs(b) > 90) return; const [ra, dec] = toEq(l, b), m = $("#skmenu");
    m.innerHTML = `<div class="eyebrow">${hms(ra, dec)}</div><button class="btn sm solid" id="skmeas" title="Read every SPHEREx exposure of this field and measure what moved in it">Measure this field in the Lab</button>${o.onCloser ? `<button class="btn sm ghost" id="skclose2" title="Real survey tiles of this place, with CDS's Aladin">Look closer</button>` : ""}`;
    m.hidden = false; m.style.left = Math.min(cw - 250, Math.max(8, x + 12)) + "px"; m.style.top = Math.min(ch - 120, Math.max(8, y - 10)) + "px";
    $("#skmeas").onclick = () => { closeMenu(); o.onObserve({ ra, dec }); }; const c2 = m.querySelector("#skclose2") as HTMLElement | null; if (c2) c2.onclick = () => { closeMenu(); o.onCloser!(ra, dec); };
  }
  // ---- pointer: drag, pinch, wheel, click
  const pts = new Map<number, [number, number]>(); let moved = 0, pinch = 0;
  cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.offsetX, e.offsetY]); moved = 0; pinch = 0; closeMenu(); });
  cv.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId);
    if (!p) { const [l, b] = toSky(e.offsetX, e.offsetY); if (Math.abs(b) <= 90) { const [ra, dec] = toEq(l, b); $("#skcoords").textContent = `${hms(ra, dec)}  ·  Galactic ${l.toFixed(1)}° ${b >= 0 ? "+" : "−"}${Math.abs(b).toFixed(1)}°`; } cv.style.cursor = hit(e.offsetX, e.offsetY) >= 0 ? "pointer" : "grab"; return; }
    if (pts.size === 2) { const [a, b2] = [...pts.entries()].map(([id, q]) => (id === e.pointerId ? [e.offsetX, e.offsetY] : q)), d = Math.hypot(a[0] - b2[0], a[1] - b2[1]); if (pinch) zoomAt((a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2, d / pinch); pinch = d; moved = 9; }
    else { const dx = e.offsetX - p[0], dy = e.offsetY - p[1]; moved += Math.abs(dx) + Math.abs(dy); view.l += dx / scale(); view.b += dy / scale(); clampView(); st.dirty = true; }
    pts.set(e.pointerId, [e.offsetX, e.offsetY]);
  });
  const up = (e: PointerEvent) => { if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId); if (moved < 5 && e.type === "pointerup") { const k = hit(e.offsetX, e.offsetY); if (k >= 0) select(k); else { select(-1); menuAt(e.offsetX, e.offsetY); } } };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  function zoomAt(x: number, y: number, f: number) { const [l, b] = toSky(x, y); view.z *= f; clampView(); const [l2, b2] = toSky(x, y); view.l += wrap(l - l2); view.b += b - b2; clampView(); st.dirty = true; }
  cv.addEventListener("wheel", (e) => { e.preventDefault(); closeMenu(); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  function hit(x: number, y: number) { if (!V) return -1; let best = -1, bd = 81; for (const k of shown) { const [sx, sy] = toScreen(GL[k], GB[k]), d = (sx - x) ** 2 + (sy - y) ** 2; if (d < bd) { bd = d; best = k; } } return best; }
  // ---- controls
  host.querySelectorAll<HTMLButtonElement>("#skstops button").forEach((b) => (b.onclick = () => { st.playing = false; st.wave = -1; st.t = +b.dataset.i!; sync(); }));
  $<HTMLInputElement>("#skt").oninput = (e) => { st.playing = false; st.wave = -1; let t = +(e.target as HTMLInputElement).value / 1000; for (const q of [0, 1, 2]) if (Math.abs(t - q) < 0.03) t = q; st.t = t; sync(); };
  $("#skplay").onclick = () => { st.playing = !st.playing; if (st.playing) { st.wave = -1; if (st.t >= 1.999) st.t = 0; st.last = performance.now(); } sync(); };
  $<HTMLInputElement>("#skw").oninput = (e) => { st.playing = false; let k = +(e.target as HTMLInputElement).value; if (k === 50) k = 49; if (k === 51) k = 52; st.t = 2; st.wave = k; loadFrame(k); sync(); };      // frames 50 and 51 of the cube are blank
  $("#skrgb").onclick = () => { st.wave = -1; sync(); };
  host.querySelectorAll<HTMLButtonElement>("#skchips button").forEach((b) => (b.onclick = () => { if (b.dataset.c === "open" && st.chip === "open") { nextCase(); return; } st.chip = b.dataset.c!; sync(); if (st.chip === "open") nextCase(); }));
  // ---- the verified catalogue
  loadVerified(o.base).then((v) => { if (!v) return; V = v; GL = new Float32Array(v.id.length); GB = new Float32Array(v.id.length); let n = 0, ng = 0, op = 0;
    for (let k = 0; k < v.id.length; k++) { const [l, b] = toGal(v.ra[k], v.dec[k]); GL[k] = l; GB[k] = b; if (Math.abs(v.glat[k]) >= 10) { n++; if (v.known[k] !== 1) ng++; if (isOpenCase(v, k)) op++; } }
    $("#skn1").textContent = n.toLocaleString(); $("#skn2").textContent = ng.toLocaleString(); $("#skn3").textContent = op.toLocaleString(); st.dirty = true; if (o.focus) handle.focus(o.focus); });
  const handle: SkyHandle = {
    pause(on) { st.paused = on; cancelAnimationFrame(st.raf); if (!on) { resize(); st.dirty = true; st.last = performance.now(); st.raf = requestAnimationFrame(loop); } },
    async focus(q) {
      const s = q.trim(), low = s.toLowerCase(); if (!s) return false;
      if (V) { let k = /^\d+-\d+$/.test(s) ? V.id.indexOf(s) : -1; if (k < 0 && low.length > 2) k = V.simbad.findIndex((n2) => n2.toLowerCase().includes(low)); if (k >= 0) { select(k, true); return true; } }
      const xy = parseCoords(s), r = xy ? { ra: xy[0], dec: xy[1] } : await resolveName(s).catch(() => null); if (!r) return false;
      const [l, b] = toGal(r.ra, r.dec); select(-1); view.l = l; view.b = b; view.z = Math.max(view.z, 6); clampView(); st.dirty = true; draw(); const [x, y] = toScreen(l, b); menuAt(x, y); return true;
    },
    context() { const k = st.sel; return { showing: st.wave >= 0 ? `SPHEREx at ${LAM[st.wave]?.toFixed(2)} µm` : MISSIONS[Math.round(st.t)].name, centre_galactic: [+view.l.toFixed(1), +view.b.toFixed(1)], zoom: +view.z.toFixed(1),
      selected: k >= 0 && V ? { name: moverName(V, k), kind: KIND_PLAIN[V.kind[k]] ?? V.kind[k], confirmed_mover: true, motion_arcsec_per_year: V.pm[k], years_to_cross_a_full_moon_width: Math.round(1800 / Math.max(V.pm[k], 1e-3)),
        spherex_exposures_checked: V.n[k], arcsec_from_where_the_motion_predicts: V.dp[k], arcsec_from_where_it_would_be_if_still: V.ds[k], distance_note: "not shown on the flat sky map; the 3D map has it when it is known",
        gaia: V.known[k] === 1 ? "Gaia lists the same motion" : V.known[k] === 0 ? "not listed in Gaia (the optical star catalogue); that alone does not say why" : "Gaia lists a source here but not this motion", has_a_database_entry: !!V.simbad[k],
        can_take_part: isOpenCase(V, k), pictures: "three real pictures on a slider: 2MASS about 1999, WISE 2010, and SPHEREx's own, with its measured path" } : null }; },
  };
  sync(); st.raf = requestAnimationFrame(loop);
  return handle;
}
