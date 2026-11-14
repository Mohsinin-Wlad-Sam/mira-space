// LAB — the observatory's instruments, on the bench. Four instruments you operate on real SPHEREx data:
//   01 blink comparator   two plates of the same field, months apart: flip them and find what moved
//   02 spectroscope       turn the wavelength dial and build an object's spectrum yourself
//   03 parallax ruler     fit a distance to the yearly swing of a nearby object
//   04 sensitivity        what SPHEREx can and cannot detect, and how far it would move (Planet X included)
// The plates, frames and centroids are baked by scripts/bake_lab.mts with the same engine as Observe, so the Lab
// opens instantly; each instrument hands over to Observe to do the same on any position.
import { detColor, lamColor, FEATURES } from "./blink/plots";
import { parallaxFactors } from "./blink/measure";
import { PIX_ARCSEC, mjdToDate } from "./blink/engine";
import type { BlinkTarget } from "./blink/view";

const BASE = import.meta.env.BASE_URL;
export type LabCtx = { onObserve: (t: BlinkTarget | string) => void; toast: (m: string) => void };
type Plate = { key: string; name: string; story: string; a: string; b: string; dateA: string; dateB: string; posA: number[]; posB: number[]; shift: number; months: number; nA: number; nB: number; pm: number; ly: number };
type Dial = { key: string; name: string; n: number; frames: { lam: number; det: number; flux: number; err: number; date: string; img: string }[]; star: { lam: number; flux: number }[] };
type Par = { key: string; name: string; center: [number, number]; t0: number; xi0: number; eta0: number; pmra: number; pmdec: number; plx: number; eplx: number; n: number; pts: { mjd: number; xi: number; eta: number; visit: number }[]; lit_plx: number; lit_ly: number };
type LabData = { n: number; blink: Plate[]; dial: Dial; parallax: Par };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
/** an 8-bit plate (base64) as a canvas of n × n pixels */
function plateCanvas(b64: string, n: number): HTMLCanvasElement {
  const bin = atob(b64), id = new ImageData(n, n), c = document.createElement("canvas"); c.width = c.height = n;
  for (let k = 0; k < n * n; k++) { const v = bin.charCodeAt(k); id.data[k * 4] = v; id.data[k * 4 + 1] = v; id.data[k * 4 + 2] = Math.min(255, v * 1.03); id.data[k * 4 + 3] = 255; }
  c.getContext("2d")!.putImageData(id, 0, 0); return c;
}
const INSTR = [
  { id: "blink", no: "01", name: "Blink comparator", line: "Two plates, months apart. Find what moved." },
  { id: "spectro", no: "02", name: "Spectroscope", line: "Turn the dial through 102 colours of infrared." },
  { id: "parallax", no: "03", name: "Parallax ruler", line: "Fit a distance to a star's yearly swing." },
  { id: "limit", no: "04", name: "Sensitivity calculator", line: "What SPHEREx can detect — Planet X included." },
] as const;
type Id = (typeof INSTR)[number]["id"];

export function mountLab(host: HTMLElement, ctx: LabCtx, start?: string): () => void {
  let stop: () => void = () => {}, cur: Id = (INSTR.find((i) => i.id === start)?.id ?? "blink") as Id, data: LabData | null = null, dead = false;
  host.innerHTML = `<div class="lb">
    <div class="lb-top"><div><div class="eyebrow">Lab · the instruments, on the bench</div><h2 class="display">Use the instruments</h2></div>
      <p>Everything an observatory measures comes down to four instruments. Each one here runs on real SPHEREx data; when you have the feel of it, point it at any position in Observe.</p></div>
    <div class="lb-bench" role="tablist">${INSTR.map((i) => `<button role="tab" data-id="${i.id}"><span class="no">${i.no}</span><b>${i.name}</b><span>${i.line}</span></button>`).join("")}</div>
    <div class="lb-work" id="lbwork"><div class="lb-wait">Setting up the bench…</div></div></div>`;
  const work = host.querySelector("#lbwork") as HTMLElement;
  const open = (id: Id) => { stop(); cur = id; host.querySelectorAll<HTMLElement>(".lb-bench button").forEach((b) => b.classList.toggle("on", b.dataset.id === id));
    if (!data && id !== "limit") { work.innerHTML = `<div class="lb-wait">The Lab's data files are not on this deployment (run scripts/bake_lab.mts). The sensitivity calculator works without them.</div>`; stop = () => {}; return; }
    stop = id === "blink" ? blinkComparator(work, data!, ctx) : id === "spectro" ? spectroscope(work, data!, ctx) : id === "parallax" ? parallaxRuler(work, data!, ctx) : sensitivity(work, ctx); };
  host.querySelectorAll<HTMLButtonElement>(".lb-bench button").forEach((b) => (b.onclick = () => open(b.dataset.id as Id)));
  fetch(`${BASE}lab/lab.json`).then((r) => (r.ok && !(r.headers.get("content-type") ?? "").includes("html") ? r.json() : null)).catch(() => null).then((j) => { if (dead) return; data = j; open(cur); });
  return () => { dead = true; stop(); host.innerHTML = ""; };
}
const shell = (el: HTMLElement, left: string, right: string) => { el.innerHTML = `<div class="lb-inst"><div class="lb-disp">${left}</div><div class="lb-ctl">${right}</div></div>`; };
const kv = (rows: [string, string][]) => `<dl class="lb-kv">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;

// ============================================================================ 01 blink comparator
function blinkComparator(el: HTMLElement, D: LabData, ctx: LabCtx): () => void {
  let L = 0, side = 0, auto = true, found = false, tries = 0, timer = 0;
  shell(el, `<div class="lb-stage"><canvas width="512" height="512" id="bcv"></canvas><div class="lb-tagline mono" id="btag"></div></div>
      <div class="lb-row"><button class="btn" id="bflip">Hold to flip</button><button class="btn ghost" id="bauto">Auto-flip</button><span class="lb-hint">or hold the space bar</span></div>`,
    `<div class="lb-step" id="bstep"></div><div class="seg" id="blev">${D.blink.map((_p, k) => `<button data-k="${k}">Plate ${k + 1}</button>`).join("")}</div>
      <div id="bres"></div><div class="lb-row"><button class="btn sm ghost" id="breveal">Show me</button><button class="btn sm" id="bobs">Observe it for real</button></div>
      <p class="lb-note">In 1930 Clyde Tombaugh found Pluto with a blink comparator: a machine that flips between two photographic plates of the same sky. Stars stay put; anything nearby jumps. These plates are real SPHEREx images, each a stack of one visit's exposures, lined up on the sky.</p>`);
  const cv = el.querySelector("#bcv") as HTMLCanvasElement, g = cv.getContext("2d")!, $ = (q: string) => el.querySelector(q) as HTMLElement;
  let imgs: HTMLCanvasElement[] = [];
  const draw = () => { const p = D.blink[L], s = cv.width / D.n; g.imageSmoothingEnabled = false; g.drawImage(imgs[side], 0, 0, cv.width, cv.height);
    $("#btag").textContent = `PLATE ${side ? "B" : "A"} · ${side ? p.dateB : p.dateA} · ${side ? p.nB : p.nA} exposures stacked`;
    if (found) { const [ax, ay] = p.posA, [bx, by] = p.posB; g.lineWidth = 2; g.strokeStyle = "rgba(111,182,255,.95)"; g.setLineDash([5, 4]); g.beginPath(); g.arc((ax + 0.5) * s, (ay + 0.5) * s, 20, 0, 7); g.stroke();
      g.setLineDash([]); g.strokeStyle = "rgba(255,177,77,.95)"; g.beginPath(); g.arc((bx + 0.5) * s, (by + 0.5) * s, 20, 0, 7); g.stroke(); } };
  const load = () => { const p = D.blink[L]; imgs = [plateCanvas(p.a, D.n), plateCanvas(p.b, D.n)]; found = false; tries = 0; side = 0;
    el.querySelectorAll<HTMLElement>("#blev button").forEach((b, k) => b.classList.toggle("on", k === L));
    $("#bstep").innerHTML = `<b>Find what moved.</b> Two pictures of the same patch of sky, ${p.months} months apart. Flip between them and click the dot that jumps.`; $("#bres").innerHTML = ""; draw(); };
  const reveal = (byUser: boolean) => { const p = D.blink[L]; found = true; draw();
    $("#bstep").innerHTML = byUser ? `<b>Found it${tries > 1 ? ` on try ${tries}` : ", first try"}.</b> ${esc(p.story)}` : `<b>There.</b> Blue ring: where it was. Orange: where it went. ${esc(p.story)}`;
    $("#bres").innerHTML = kv([["shift between plates", `${p.shift.toFixed(1)}″ <small>${(p.shift / PIX_ARCSEC).toFixed(1)} pixels</small>`], ["time between plates", `${p.months} months`],
      ["speed from your two plates", `${((p.shift / p.months) * 12).toFixed(1)}″ / yr`], ["catalogue motion", `${p.pm.toFixed(2)}″ / yr`], ["distance", `${p.ly} light-years`]]); };
  const setAuto = (on: boolean) => { auto = on; $("#bauto").classList.toggle("on", on); clearInterval(timer); if (on) timer = window.setInterval(() => { side = 1 - side; draw(); }, 700); };
  const hold = (on: boolean) => { if (on) setAuto(false); side = on ? 1 : 0; draw(); };
  $("#bflip").addEventListener("pointerdown", () => hold(true)); for (const ev of ["pointerup", "pointerleave", "pointercancel"]) $("#bflip").addEventListener(ev, () => { if (!auto) hold(false); });
  const kd = (e: KeyboardEvent) => { if (e.code === "Space" && (e.target as HTMLElement).tagName !== "INPUT") { e.preventDefault(); if (!e.repeat) hold(true); } }, ku = (e: KeyboardEvent) => { if (e.code === "Space") hold(false); };
  addEventListener("keydown", kd); addEventListener("keyup", ku);
  $("#bauto").onclick = () => setAuto(!auto);
  el.querySelectorAll<HTMLButtonElement>("#blev button").forEach((b) => (b.onclick = () => { L = +b.dataset.k!; load(); }));
  cv.onclick = (e) => { if (found) return; const r = cv.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * D.n - 0.5, y = ((e.clientY - r.top) / r.height) * D.n - 0.5, p = D.blink[L]; tries++;
    if (Math.min(Math.hypot(x - p.posA[0], y - p.posA[1]), Math.hypot(x - p.posB[0], y - p.posB[1])) < 2.6) reveal(true);
    else $("#bstep").innerHTML = `<b>That one stays put.</b> Keep flipping: look for the dot that is in a slightly different place on plate B.`; };
  $("#breveal").onclick = () => reveal(false);
  $("#bobs").onclick = () => ctx.onObserve(D.blink[L].key);
  load(); setAuto(true);
  return () => { clearInterval(timer); removeEventListener("keydown", kd); removeEventListener("keyup", ku); };
}

// ============================================================================ 02 spectroscope
function spectroscope(el: HTMLElement, D: LabData, ctx: LabCtx): () => void {
  const F = D.dial.frames, n = D.dial.n, seen = new Set<number>(); let i = 0, raf = 0, sweeping = false, showStar = false;
  const imgs = F.map((f) => plateCanvas(f.img, n)), fmax = Math.max(...F.map((f) => f.flux)) * 1.12;
  const f40 = median(F.filter((f) => f.lam > 3.9 && f.lam < 4.2).map((f) => f.flux)), f33 = median(F.filter((f) => f.lam > 3.2 && f.lam < 3.45).map((f) => f.flux));
  shell(el, `<div class="lb-two"><div class="lb-stage sm"><canvas width="360" height="360" id="scv"></canvas><div class="lb-tagline mono" id="stag"></div></div><div id="splot" class="lb-plot"></div></div>
      <div class="lb-dial"><input type="range" id="sdial" min="0.75" max="5" value="0.75" step="0.005" aria-label="Wavelength dial"><div class="lb-dialscale mono"><span>0.75 µm</span><span>1.8</span><span>2.9</span><span>3.9</span><span>5 µm</span></div></div>`,
    `<div class="lb-step" id="sstep"><b>Turn the dial.</b> Each position is a real exposure of ${esc(D.dial.name)} at one colour of infrared. As you sweep, its spectrum draws itself. Find the colour where it nearly vanishes.</div>
      <div id="sres"></div><div class="lb-row"><button class="btn sm" id="ssweep">Sweep</button><button class="btn sm ghost" id="sstar">Compare with a star</button><button class="btn sm ghost" id="sobs">Observe it for real</button></div>
      <p class="lb-note">SPHEREx has no prism. Its filter changes colour across each detector, so every exposure of an object lands on a different wavelength. Sort the exposures by colour and you have a spectrum: gaps in it are molecules absorbing light.</p>`);
  const cv = el.querySelector("#scv") as HTMLCanvasElement, g = cv.getContext("2d")!, $ = (q: string) => el.querySelector(q) as HTMLElement;
  const W = 520, H = 300, l = 44, r = 12, t = 18, b = 30, X = (um: number) => l + ((um - 0.7) / 4.4) * (W - l - r), Y = (v: number) => t + (1 - Math.max(0, v) / fmax) * (H - t - b);
  const sScale = (() => { const s13 = D.dial.star.filter((q) => q.lam > 1.2 && q.lam < 1.35).map((q) => q.flux), o13 = F.filter((q) => q.lam > 1.2 && q.lam < 1.35).map((q) => q.flux); return s13.length && o13.length ? median(o13) / median(s13) : 1; })();
  const draw = () => { const f = F[i]; seen.add(i); g.imageSmoothingEnabled = false; g.drawImage(imgs[i], 0, 0, cv.width, cv.height);
    $("#stag").innerHTML = `<i style="background:${lamColor(f.lam)}"></i>${f.lam.toFixed(3)} µm · detector ${f.det} · ${f.date}`;
    let s = ""; for (const q of FEATURES) s += `<rect x="${X(q.um - q.w / 2)}" y="${t}" width="${X(q.um + q.w / 2) - X(q.um - q.w / 2)}" height="${H - t - b}" fill="#fff" opacity="${Math.abs(f.lam - q.um) < q.w / 2 ? 0.16 : 0.045}"/><text x="${X(q.um)}" y="${t - 5}" class="bk-ax" text-anchor="middle">${q.label}</text>`;
    for (const um of [1, 2, 3, 4, 5]) s += `<text x="${X(um)}" y="${H - 8}" class="bk-ax" text-anchor="middle">${um} µm</text>`;
    for (const v of [0, 0.5, 1]) s += `<line x1="${l}" x2="${W - r}" y1="${Y(v * fmax / 1.12)}" y2="${Y(v * fmax / 1.12)}" stroke="#fff" opacity=".08"/><text x="${l - 6}" y="${Y(v * fmax / 1.12) + 3}" class="bk-ax" text-anchor="end">${(v * fmax / 1.12).toFixed(0)}</text>`;
    s += `<text x="${l - 6}" y="${t - 5}" class="bk-ax" text-anchor="end">mJy</text>`;
    if (showStar) s += `<polyline fill="none" stroke="#fff" stroke-dasharray="4 4" opacity=".7" points="${D.dial.star.map((q) => `${X(q.lam).toFixed(1)},${Y(Math.min(fmax, q.flux * sScale)).toFixed(1)}`).join(" ")}"/><text x="${W - r}" y="${t + 12}" class="bk-ax" text-anchor="end">- - an ordinary star in the same field (scaled)</text>`;
    for (const k of seen) s += `<circle cx="${X(F[k].lam).toFixed(1)}" cy="${Y(F[k].flux).toFixed(1)}" r="${k === i ? 5 : 2.6}" fill="${lamColor(F[k].lam)}" stroke="${k === i ? "#fff" : "none"}" stroke-width="1.5"/>`;
    s += `<line x1="${X(f.lam)}" x2="${X(f.lam)}" y1="${t}" y2="${H - b}" stroke="#fff" opacity=".35"/>`;
    $("#splot").innerHTML = `<svg class="bk-plot" viewBox="0 0 ${W} ${H}">${s}</svg>`;
    const feat = FEATURES.find((q) => Math.abs(f.lam - q.um) < q.w / 2), pct = Math.round((seen.size / F.length) * 100);
    $("#sres").innerHTML = kv([["wavelength", `${f.lam.toFixed(3)} µm`], ["brightness", `${f.flux.toFixed(1)} ± ${f.err.toFixed(1)} mJy`], ["relative to 4.0 microns", `${Math.round((f.flux / f40) * 100)}%`], ["absorber here", feat ? `${feat.label} <small>${feat.what}</small>` : "–"], ["spectrum uncovered", `${pct}%`]]);
    if (pct > 92) $("#sstep").innerHTML = `<b>That is its spectrum.</b> At 3.3 µm it gives only ${Math.round((f33 / f40) * 100)}% of its 4.0 µm light: methane, which only survives in atmospheres colder than about 1,300 K. No star looks like this — press “Compare with a star”.`; };
  const nearestFrame = (um: number) => F.reduce((b, f, k) => (Math.abs(f.lam - um) < Math.abs(F[b].lam - um) ? k : b), 0);
  (el.querySelector("#sdial") as HTMLInputElement).oninput = (e) => { sweeping = false; i = nearestFrame(+(e.target as HTMLInputElement).value); draw(); };
  const step = () => { if (!sweeping) return; i = (i + 1) % F.length; (el.querySelector("#sdial") as HTMLInputElement).value = String(F[i].lam); draw(); if (i === F.length - 1) { sweeping = false; return; } raf = window.setTimeout(step, 70); };
  $("#ssweep").onclick = () => { sweeping = !sweeping; if (sweeping) { if (i >= F.length - 1) i = -1; step(); } };
  $("#sstar").onclick = () => { showStar = !showStar; $("#sstar").classList.toggle("on", showStar); draw(); };
  $("#sobs").onclick = () => ctx.onObserve(D.dial.key);
  draw(); sweeping = true; raf = window.setTimeout(step, 600);
  return () => { sweeping = false; clearTimeout(raf); };
}

// ============================================================================ 03 parallax ruler
function parallaxRuler(el: HTMLElement, D: LabData, ctx: LabCtx): () => void {
  const P = D.parallax; let ly = 30, locked = false, phase = 0, raf = 0, playing = true;
  // residuals after removing the steady drift, averaged per visit
  const res = P.pts.map((p) => { const dt = (p.mjd - P.t0) / 365.25; return { mjd: p.mjd, e: p.xi - (P.xi0 + P.pmra * dt), n: p.eta - (P.eta0 + P.pmdec * dt), visit: p.visit }; });
  const by = new Map<number, typeof res>(); res.forEach((q) => (by.get(q.visit) ?? by.set(q.visit, []).get(q.visit)!).push(q));
  const V = [...by.values()].filter((L) => L.length >= 3).map((L) => { const e = median(L.map((q) => q.e)), n = median(L.map((q) => q.n)), s = Math.max(0.06, (median(L.map((q) => Math.hypot(q.e - e, q.n - n))) * 1.48) / Math.sqrt(L.length)); return { mjd: L.reduce((a, q) => a + q.mjd, 0) / L.length, e, n, s }; });
  const t0 = Math.min(...res.map((q) => q.mjd)) - 20, t1 = Math.max(...res.map((q) => q.mjd)) + 20;
  const chi = (plx: number) => V.reduce((a, v) => { const [pe, pn] = parallaxFactors(P.center[0], P.center[1], v.mjd); return a + (Math.pow(v.e - plx * pe, 2) + Math.pow(v.n - plx * pn, 2)) / (v.s * v.s + 0.08 * 0.08); }, 0) / Math.max(1, 2 * V.length - 1);
  shell(el, `<div id="pplot" class="lb-plot"></div>`,
    `<div class="lb-dial" style="margin-top:0"><label class="lb-slab">Distance you assume — drag<input type="range" id="pdist" min="0" max="1" step="0.002" value="0.75" aria-label="Assumed distance"></label></div>
      <div class="lb-step" id="pstep"><b>How far is ${esc(P.name)}?</b> As Earth circles the Sun, a nearby object swings back and forth against the far background: the nearer it is, the bigger the swing. The green squares are where SPHEREx really saw it, visit by visit. Slide the distance until the white curve passes through them.</div>
      <div id="pres"></div><div class="lb-row"><button class="btn sm" id="plock">Lock in my answer</button><button class="btn sm ghost" id="pobs">Observe it for real</button></div>
      <p class="lb-note">This swing is called parallax, and it is the first rung of every distance in astronomy. Here it is measured from ${P.n} SPHEREx exposures after removing the object's steady drift of ${Math.hypot(P.pmra, P.pmdec).toFixed(1)}″ a year. A SPHEREx pixel is 6.15″ wide: the swing is a twentieth of a pixel, found by averaging many exposures.</p>`);
  const $ = (q: string) => el.querySelector(q) as HTMLElement;
  const draw = () => { const plx = 3.2616 / ly, W = 620, H = 430, l = 50, r = 14, amp = Math.max(0.9, plx * 1.25, ...V.map((v) => Math.max(Math.abs(v.e), Math.abs(v.n)) + v.s)), X = (m: number) => l + ((m - t0) / (t1 - t0)) * (W - l - r);
    const tNow = t0 + phase * (t1 - t0); let s = "";
    // top: Earth's orbit seen from above, the line of sight and the apparent shift
    const cx = 150, cy = 86, R = 46, ang = ((tNow - 51544.5) / 365.25) * 2 * Math.PI, ex = cx + R * Math.cos(ang), ey = cy + R * 0.42 * Math.sin(ang), sx = 420, sy = 86, swing = Math.cos(ang);
    s += `<ellipse cx="${cx}" cy="${cy}" rx="${R}" ry="${R * 0.42}" fill="none" stroke="#fff" opacity=".3"/><circle cx="${cx}" cy="${cy}" r="6" fill="#ffd27a"/><text x="${cx}" y="${cy + 38}" class="bk-ax" text-anchor="middle">Earth's orbit (not to scale)</text>
      <circle cx="${ex}" cy="${ey}" r="4" fill="#6fb6ff"/><circle cx="${sx}" cy="${sy}" r="4" fill="#fff"/><text x="${sx}" y="${sy + 20}" class="bk-ax" text-anchor="middle">${esc(P.name)}</text>
      <line x1="${ex}" y1="${ey}" x2="${W - 40}" y2="${sy + (sy - ey) * ((W - 40 - sx) / (sx - ex))}" stroke="#fff" opacity=".45" stroke-dasharray="3 4"/>
      <line x1="${W - 40}" x2="${W - 40}" y1="${sy - 52}" y2="${sy + 52}" stroke="#fff" opacity=".3"/><text x="${W - 40}" y="${sy - 58}" class="bk-ax" text-anchor="middle">distant stars</text>
      <circle cx="${W - 40}" cy="${sy + (sy - ey) * ((W - 40 - sx) / (sx - ex))}" r="3.5" fill="#7df0a6"/><text x="${W - 54}" y="${sy + 66}" class="bk-ax" text-anchor="end">where it appears: ${swing > 0 ? "+" : "−"}${Math.abs(plx * swing).toFixed(2)}″</text>`;
    // bottom: the real measurements against the swing the assumed distance predicts
    for (const [k, key, lab] of [[0, "e", "east–west swing (″)"], [1, "n", "north–south swing (″)"]] as const) {
      const top = 168 + k * 126, h = 104, Y = (v: number) => top + (1 - (Math.max(-amp, Math.min(amp, v)) + amp) / (2 * amp)) * h;
      s += `<rect x="${l}" y="${top}" width="${W - l - r}" height="${h}" fill="none" stroke="#fff" opacity=".14"/><line x1="${l}" x2="${W - r}" y1="${Y(0)}" y2="${Y(0)}" stroke="#fff" opacity=".2"/><text x="${l + 6}" y="${top + 13}" class="bk-ax">${lab}</text>
        <text x="${l - 6}" y="${Y(amp) + 9}" class="bk-ax" text-anchor="end">+${amp.toFixed(1)}</text><text x="${l - 6}" y="${Y(-amp)}" class="bk-ax" text-anchor="end">−${amp.toFixed(1)}</text>`;
      let path = ""; for (let m = t0; m <= t1; m += 4) path += `${X(m).toFixed(1)},${Y(plx * parallaxFactors(P.center[0], P.center[1], m)[k]).toFixed(1)} `;
      s += `<polyline fill="none" stroke="#fff" stroke-width="1.8" points="${path}"/>`;
      for (const q of res) s += `<circle cx="${X(q.mjd).toFixed(1)}" cy="${Y(q[key]).toFixed(1)}" r="1.6" fill="#7cc4ff" opacity=".3"/>`;
      for (const v of V) s += `<line x1="${X(v.mjd)}" x2="${X(v.mjd)}" y1="${Y(v[key] - v.s)}" y2="${Y(v[key] + v.s)}" stroke="#7df0a6" stroke-width="1.6"/><rect x="${X(v.mjd) - 5}" y="${Y(v[key]) - 5}" width="10" height="10" fill="#000" stroke="#7df0a6" stroke-width="1.8"/>`;
      s += `<line x1="${X(tNow)}" x2="${X(tNow)}" y1="${top}" y2="${top + h}" stroke="#6fb6ff" opacity=".6"/>`;
    }
    s += `<text x="${l}" y="${H - 6}" class="bk-ax">${mjdToDate(t0 + 20)}</text><text x="${W - r}" y="${H - 6}" class="bk-ax" text-anchor="end">${mjdToDate(t1 - 20)}</text>`;
    $("#pplot").innerHTML = `<svg class="bk-plot" viewBox="0 0 ${W} ${H}">${s}</svg>`;
    const c = chi(plx), cBest = chi(P.plx), fit = Math.abs(plx - P.plx) < P.eplx;
    $("#pres").innerHTML = kv([["distance you assume", `${ly.toFixed(1)} light-years`], ["swing it predicts", `±${plx.toFixed(2)}″`], ["misfit to the data", `${c.toFixed(1)} <small>${fit ? "fits" : plx > P.plx ? "too close: curve overshoots" : "too far: curve too flat"}</small>`],
      ...(locked ? ([["SPHEREx best fit", `${(3.2616 / (P.plx + P.eplx)).toFixed(0)}–${(3.2616 / Math.max(0.02, P.plx - P.eplx)).toFixed(0)} light-years <small>misfit ${cBest.toFixed(1)}</small>`], ["Gaia (accepted)", `${P.lit_ly} light-years`]] as [string, string][]) : [])]);
    if (locked) $("#pstep").innerHTML = `<b>Your answer: ${ly.toFixed(0)} light-years.</b> SPHEREx alone allows ${(3.2616 / (P.plx + P.eplx)).toFixed(0)} to ${(3.2616 / Math.max(0.02, P.plx - P.eplx)).toFixed(0)}; the Gaia satellite, built for exactly this, measures ${P.lit_ly}. ${Math.abs(ly - P.lit_ly) / P.lit_ly < 0.3 ? "You are within 30% — from a telescope whose pixels are a hundred times wider than the swing." : "The data cannot pin it more tightly than that: the swing is a twentieth of a pixel."}`; };
  const dist = el.querySelector("#pdist") as HTMLInputElement, toLy = (v: number) => 3 * Math.pow(60 / 3, v);
  dist.oninput = () => { ly = toLy(+dist.value); draw(); }; ly = toLy(+dist.value);
  $("#plock").onclick = () => { locked = true; draw(); };
  $("#pobs").onclick = () => ctx.onObserve(P.key);
  const tick = () => { if (!playing) return; phase = (phase + 0.004) % 1; draw(); raf = requestAnimationFrame(tick); };
  draw(); raf = requestAnimationFrame(tick);
  return () => { playing = false; cancelAnimationFrame(raf); };
}

// ============================================================================ 04 sensitivity calculator
const H_PLANCK = 6.62607015e-34, C_LIGHT = 2.99792458e8, K_B = 1.380649e-23, AU_KM = 1.495978707e8, R_EARTH_KM = 6371, R_SUN_KM = 695700, T_SUN = 5772, PC_AU = 206264.806;
/** Planck function B_ν (W m⁻² Hz⁻¹ sr⁻¹) */
const planck = (um: number, T: number) => { const nu = C_LIGHT / (um * 1e-6), x = (H_PLANCK * nu) / (K_B * T); return x > 600 ? 0 : (2 * H_PLANCK * nu * nu * nu) / (C_LIGHT * C_LIGHT) / Math.expm1(x); };
const sunAt1au = (um: number) => Math.PI * planck(um, T_SUN) * Math.pow(R_SUN_KM / AU_KM, 2);
/** mJy from a body of radius R (Earth radii), geometric albedo p, temperature T, at d au: reflected sunlight + its own blackbody */
function bodyFlux(um: number, R: number, p: number, T: number, dAU: number) { const k = Math.pow((R * R_EARTH_KM) / (dAU * AU_KM), 2); return ((p * k * sunAt1au(um)) / (dAU * dAU) + Math.PI * planck(um, T) * k) * 1e29; }
const DET_UM = [0.93, 1.37, 2.03, 3.1, 4.12, 4.72];
type World = { k: string; name: string; twin?: string; d0pc?: number; R?: number; p?: number; T?: number; d: number; unit: "au" | "pc"; range: [number, number]; note: string };
const WORLDS: World[] = [
  { k: "p9", name: "Planet Nine, as proposed", R: 2.9, p: 0.4, T: 45, d: 500, unit: "au", range: [60, 3000], note: "About six Earth masses on a 300–800 au orbit (Brown & Batygin 2021). Radius and reflectivity are assumptions." },
  { k: "nep", name: "A second Neptune", R: 3.86, p: 0.3, T: 59, d: 200, unit: "au", range: [30, 3000], note: "Giant planets are dark in methane bands, so the true infrared reflectivity may be lower." },
  { k: "jup", name: "A second Jupiter", R: 10.97, p: 0.4, T: 125, d: 1000, unit: "au", range: [30, 30000], note: "Reflected light plus a 125 K blackbody: a lower limit near 5 µm, where real giant planets leak extra heat." },
  { k: "w0855", name: "A twin of WISE 0855 (coldest brown dwarf)", twin: "wise-0855", d0pc: 2.28, d: 4, unit: "pc", range: [0.5, 60], note: "Scaled from MIRA's measurement of the real one at 7.4 light-years; it only shines at 4–5 µm." },
  { k: "epsb", name: "A twin of ε Indi B (methane brown dwarfs)", twin: "eps-indi-b", d0pc: 3.64, d: 20, unit: "pc", range: [1, 400], note: "Scaled from MIRA's measured spectrum of the real pair at 11.9 light-years." },
];
function sensitivity(el: HTMLElement, ctx: LabCtx): () => void {
  let val: any = null, w = WORLDS[0], d = w.d, R = w.R ?? 1, alb = w.p ?? 0.4, stackN = 1, side = 0, timer = 0;
  shell(el, `<div class="lb-two"><div class="lb-stage sm"><canvas width="360" height="360" id="lcv"></canvas><div class="lb-tagline mono" id="ltag"></div></div><div id="lplot" class="lb-plot"></div></div>`,
    `<div class="lb-step" id="lstep"></div>
      <label class="lrow"><span>Object</span><select id="lw">${WORLDS.map((x) => `<option value="${x.k}">${esc(x.name)}</option>`).join("")}</select></label>
      <label class="lrow"><span>Distance</span><input type="range" id="ld" min="0" max="1" step="0.002"><b id="ldv"></b></label>
      <label class="lrow" id="lrrow"><span>Radius</span><input type="range" id="lr" min="0.5" max="14" step="0.1"><b id="lrv"></b></label>
      <label class="lrow" id="larow"><span>Reflectivity</span><input type="range" id="la" min="0.05" max="0.9" step="0.05"><b id="lav"></b></label>
      <label class="lrow"><span>Exposures stacked</span><input type="range" id="ln" min="0" max="8" step="1" value="0"><b id="lnv"></b></label>
      <div id="lres"></div><div class="lb-row"><button class="btn sm ghost" id="lobs">See the real WISE 0855</button></div>
      <p class="lb-note" id="lnote"></p>`);
  const $ = <T extends HTMLElement>(q: string) => el.querySelector(q) as T, cv = $("#lcv") as HTMLCanvasElement, g = cv.getContext("2d")!;
  const limits = () => { const L = [0.2, 0.16, 0.15, 0.13, 0.26, 0.47];        // 5σ, one exposure, mJy: validation run of Nov 2026 (fallback)
    if (val) for (let k = 0; k < 6; k++) { const v = (val.targets as any[]).filter((t) => !t.saturated).map((t) => t.detectors?.[k]?.limit5_mJy).filter((x: any) => x > 0); if (v.length) L[k] = v.reduce((a: number, b: number) => a + b, 0) / v.length; } return L; };
  const fluxes = (dist: number): number[] => { if (w.twin) { const t = (val?.targets as any[] | undefined)?.find((x) => x.key === w.twin), base = t?.detectors?.map((q: any) => q.flux_mJy ?? 0) ?? (w.twin === "wise-0855" ? [0, 0, 0, 0, 0.45, 0.46] : [1.2, 21.3, 13.7, 9, 50.3, 18.7]);
      const f = Math.pow(w.d0pc! / dist, 2); return base.map((v: number, k: number) => (w.twin === "wise-0855" && k < 4 ? 0 : v * f)); }      // below 4 µm the real one is blended with a background star
    return DET_UM.map((um) => bodyFlux(um, R, alb, w.T!, dist)); };
  const fromS = (v: number) => w.range[0] * Math.pow(w.range[1] / w.range[0], v), toS = (x: number) => Math.log(x / w.range[0]) / Math.log(w.range[1] / w.range[0]);
  // a fixed noise field (unit variance), so the picture does not flicker as you drag
  const NP = 36, noise = new Float32Array(NP * NP); { let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); for (let k = 0; k < noise.length; k++) noise[k] = Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd()); }
  let snrBest = 0, shiftPx = 0, bestK = 0;
  const paint = () => { const id = g.createImageData(NP, NP), off = side ? Math.min(shiftPx, 9999) : 0, cx = NP / 2 - 6 + off, cy = NP / 2, peak = snrBest * 0.94;
    for (let j = 0; j < NP; j++) for (let i = 0; i < NP; i++) { const r2 = (i - cx) * (i - cx) + (j - cy) * (j - cy), v = noise[j * NP + i] + peak * Math.exp(-r2 / (2 * 0.75 * 0.75)), t = Math.asinh((Math.max(0, v + 2) / 16) * 10) / Math.asinh(10), q = 255 * Math.min(1, t), p = (j * NP + i) * 4;
      id.data[p] = q; id.data[p + 1] = q; id.data[p + 2] = Math.min(255, q * 1.03); id.data[p + 3] = 255; }
    const o = document.createElement("canvas"); o.width = o.height = NP; o.getContext("2d")!.putImageData(id, 0, 0); g.imageSmoothingEnabled = false; g.drawImage(o, 0, 0, cv.width, cv.height);
    $("#ltag").innerHTML = `simulated · ${DET_UM[bestK]} µm · pass ${side ? "B, six months later" : "A"}${side && shiftPx > NP / 2 + 6 ? ` · it has left this frame (${shiftPx.toFixed(0)} px away)` : ""}`; };
  function draw() {
    const L = limits(), F = fluxes(d), Ls = L.map((x) => x / Math.sqrt(stackN)), dAU = w.unit === "au" ? d : d * PC_AU;
    $("#ldv").textContent = w.unit === "au" ? `${d < 100 ? d.toFixed(0) : Math.round(d / 10) * 10} au` : `${d.toFixed(d < 10 ? 1 : 0)} pc`;
    $("#lrv").textContent = `${R.toFixed(1)} R⊕`; $("#lav").textContent = alb.toFixed(2); $("#lnv").textContent = String(stackN);
    bestK = F.reduce((b, f, k) => (f / Ls[k] > F[b] / Ls[b] ? k : b), 0); snrBest = (F[bestK] / (Ls[bestK] / 5));
    const W = 520, H = 330, l = 56, r = 14, t = 26, b = 44, lo = -5, hi = Math.max(2, Math.ceil(Math.log10(Math.max(...F, 1)) + 0.5)), X = (k: number) => l + ((k + 0.5) / 6) * (W - l - r), Y = (v: number) => t + (1 - (Math.log10(Math.max(v, 1e-9)) - lo) / (hi - lo)) * (H - t - b), bw = ((W - l - r) / 6) * 0.42;
    let s = ""; for (let e = lo; e <= hi; e++) s += `<line x1="${l}" x2="${W - r}" y1="${Y(Math.pow(10, e))}" y2="${Y(Math.pow(10, e))}" stroke="#fff" opacity=".07"/><text x="${l - 8}" y="${Y(Math.pow(10, e)) + 4}" class="bk-ax" text-anchor="end">${e >= 0 ? Math.pow(10, e) : e >= -3 ? Math.pow(10, e).toFixed(-e) : `1e${e}`}</text>`;
    s += `<text x="${l - 8}" y="${t - 10}" class="bk-ax" text-anchor="end">mJy</text><text x="${W - r}" y="${t - 10}" class="bk-ax" text-anchor="end">- - one exposure, 5σ${stackN > 1 ? ` · —— ${stackN} stacked` : ""}</text>`;
    F.forEach((f, k) => { const seen = f > Ls[k], y = Math.min(H - b, Y(f));
      s += `<rect x="${X(k) - bw / 2}" y="${y}" width="${bw}" height="${Math.max(0, H - b - y)}" fill="${detColor(k + 1)}" opacity="${seen ? 0.95 : 0.3}"/><line x1="${X(k) - bw}" x2="${X(k) + bw}" y1="${Y(L[k])}" y2="${Y(L[k])}" stroke="#fff" stroke-width="1.4" stroke-dasharray="4 4"/>
        ${stackN > 1 ? `<line x1="${X(k) - bw}" x2="${X(k) + bw}" y1="${Y(Ls[k])}" y2="${Y(Ls[k])}" stroke="#fff" stroke-width="2.2"/>` : ""}<text x="${X(k)}" y="${H - b + 15}" class="bk-ax" text-anchor="middle" fill="${detColor(k + 1)}">${DET_UM[k]} µm</text>
        <text x="${X(k)}" y="${H - b + 29}" class="bk-ax" text-anchor="middle">${f > 0 ? `S/N ${((f / Ls[k]) * 5).toFixed((f / Ls[k]) * 5 < 10 ? 1 : 0)}` : "–"}</text>`; });
    $("#lplot").innerHTML = `<svg class="bk-plot" viewBox="0 0 ${W} ${H}">${s}</svg>`;
    const par = 206264.806 / dAU, swing = 2 * par, drift = w.unit === "au" ? 1.2958e6 * Math.pow(dAU, -1.5) : 30 / (4.74047 * d); shiftPx = swing / PIX_ARCSEC;
    let dmax = 0; for (let q = 0; q <= 400; q++) { const x = w.range[0] * Math.pow((w.range[1] * 30) / w.range[0], q / 400); if (fluxes(x).some((v, k) => v > Ls[k])) dmax = x; }
    const far = w.unit === "au" ? `${dmax < 1000 ? Math.round(dmax / 10) * 10 : Math.round(dmax / 100) * 100} au` : `${dmax.toFixed(dmax < 10 ? 1 : 0)} pc`, ab = F[bestK] > 0 ? (16.4 - 2.5 * Math.log10(F[bestK])).toFixed(1) : "–", ok = snrBest >= 5;
    $("#lstep").innerHTML = ok ? `<b>Detectable.</b> S/N ${snrBest.toFixed(snrBest < 10 ? 1 : 0)} at ${DET_UM[bestK]} µm${stackN > 1 ? ` in a stack of ${stackN}` : " in a single exposure"}. Watch it jump between the two passes: that jump is how it would be found.`
      : `<b>Lost in the noise.</b> S/N ${snrBest.toFixed(1)} at its best wavelength${stackN > 1 ? `, even with ${stackN} exposures stacked` : ""}. Bring it closer, or stack more — but a stack must follow its motion, which nobody knows in advance.`;
    $("#lres").innerHTML = kv([["brightness at best band", `${F[bestK] > 0 ? F[bestK].toPrecision(2) : "0"} mJy <small>${ab} AB mag · ${DET_UM[bestK]} µm</small>`], ["signal-to-noise", `${snrBest.toFixed(snrBest < 10 ? 1 : 0)} <small>${stackN} exposure${stackN > 1 ? "s" : ""}</small>`],
      ["jump between two passes", `${swing >= 60 ? `${(swing / 60).toFixed(1)}′` : `${swing.toFixed(1)}″`} <small>${shiftPx.toFixed(shiftPx < 10 ? 1 : 0)} pixels (parallax)</small>`], [w.unit === "au" ? "drift along its orbit" : "typical drift (30 km/s)", `${drift.toFixed(drift < 10 ? 2 : 0)}″ / yr`], ["detectable out to", far]]);
    $("#lnote").textContent = `${w.note} Limits are the 5σ point-source noise MIRA measured in single SPHEREx exposures of two ordinary fields (validation run); N stacked exposures lower them by √N. Reflected light: albedo × (radius ÷ distance)² × sunlight at that distance; thermal glow: a blackbody.`;
    paint();
  }
  function pick(k: string) { w = WORLDS.find((x) => x.k === k)!; d = w.d; R = w.R ?? 1; alb = w.p ?? 0.4; ($("#ld") as HTMLInputElement).value = String(toS(d)); ($("#lr") as HTMLInputElement).value = String(R); ($("#la") as HTMLInputElement).value = String(alb);
    $("#lrrow").style.display = $("#larow").style.display = w.twin ? "none" : ""; draw(); }
  ($("#lw") as HTMLSelectElement).onchange = (e) => pick((e.target as HTMLSelectElement).value);
  $("#ld").oninput = (e) => { d = fromS(+(e.target as HTMLInputElement).value); draw(); };
  $("#lr").oninput = (e) => { R = +(e.target as HTMLInputElement).value; draw(); };
  $("#la").oninput = (e) => { alb = +(e.target as HTMLInputElement).value; draw(); };
  $("#ln").oninput = (e) => { stackN = Math.pow(2, +(e.target as HTMLInputElement).value); draw(); };
  $("#lobs").onclick = () => ctx.onObserve("wise-0855");
  fetch(`${BASE}validation.json`).then((r) => (r.ok ? r.json() : null)).then((v) => { val = v; draw(); }).catch(() => {});
  pick("p9"); timer = window.setInterval(() => { side = 1 - side; paint(); }, 900);
  return () => clearInterval(timer);
}
