// "Honest flipbook": every SPHEREx exposure of an object, wavelength-aware. Data precomputed by census/flipbook.py.
export type Frame = { mjd: number; band: string; detector: number; lam_um: number; bw_um: number; dx: number; dy: number; visit: number };
type Meta = { id: string; name: string; size: number; n: number; frames: Frame[]; pix_arcsec: number };
type Mode = "raw" | "visit" | "deflash" | "diff";

function f16(buf: ArrayBuffer): Float32Array {
  const u = new Uint16Array(buf), o = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) {
    const h = u[i], s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
    o[i] = e === 0 ? s * 2 ** -14 * (m / 1024) : e === 31 ? (m ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + m / 1024);
  }
  return o;
}
// magma-ish ramp (approximation of matplotlib magma)
const RAMP = [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]];
function color(t: number): [number, number, number] {
  t = Math.min(1, Math.max(0, t)) * (RAMP.length - 1); const i = Math.floor(t), f = t - i, a = RAMP[i], b = RAMP[Math.min(i + 1, RAMP.length - 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
export const lamColor = (um: number) => { const t = (um - 0.75) / 4.25; const h = 270 - 270 * Math.min(1, Math.max(0, t)); return `hsl(${h},85%,58%)`; };
const date = (mjd: number) => new Date((mjd - 40587) * 86400000).toISOString().slice(0, 10);

export async function mountFlipbook(el: HTMLElement, id: string, spectrum?: { lam: number[]; flux: (number | null)[] }): Promise<(() => void) | undefined> {
  const [mr, br] = await Promise.all([fetch(`${import.meta.env.BASE_URL}data/flipbook/${id}.json`, { cache: "no-store" }), fetch(`${import.meta.env.BASE_URL}data/flipbook/${id}.bin`, { cache: "no-store" })]);
  if (!mr.ok || !br.ok || (mr.headers.get("content-type") ?? "").includes("html")) return undefined;
  const meta = (await mr.json()) as Meta; const data = f16(await br.arrayBuffer());
  return renderFlipbook(el, meta, data, spectrum);
}

/** render a flipbook from frames + float32 stamps (precomputed by the census, or built live in the browser by sphxlive.ts) */
export function renderFlipbook(el: HTMLElement, meta: { size: number; n: number; frames: Frame[] }, data: Float32Array, spectrum?: { lam: number[]; flux: (number | null)[] }, note = "") {
  const S = meta.size, N = meta.n;
  if (!N) { el.innerHTML = `<div class="soon">No SPHEREx exposures cover this position yet.</div>`; return () => {}; }
  const frame = (i: number) => data.subarray(i * S * S, (i + 1) * S * S);
  // expected flux of the object at wavelength (from its census spectrum) for "de-flashed" mode
  const expect = (um: number) => {
    if (!spectrum) return 1;
    let best = 1, bd = 1e9;
    spectrum.lam.forEach((l, k) => { const f = spectrum.flux[k]; if (f !== null && f > 0 && Math.abs(l - um) < bd) { bd = Math.abs(l - um); best = f; } });
    return best;
  };
  // per-visit, per-band coadds
  const groups = new Map<string, number[]>();
  meta.frames.forEach((f, i) => { const k = `${f.visit}-${f.band}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(i); });
  const coadds = [...groups.entries()].map(([k, idx]) => {
    const img = new Float32Array(S * S); const n = new Float32Array(S * S);
    for (const i of idx) { const fr = frame(i); for (let p = 0; p < S * S; p++) if (isFinite(fr[p])) { img[p] += fr[p]; n[p]++; } }
    for (let p = 0; p < S * S; p++) img[p] = n[p] ? img[p] / n[p] : NaN;
    const f0 = meta.frames[idx[0]], lams = idx.map((i) => meta.frames[i].lam_um);
    return { key: k, img, mjd: idx.reduce((s, i) => s + meta.frames[i].mjd, 0) / idx.length, band: f0.band, visit: f0.visit, n: idx.length, lam: [Math.min(...lams), Math.max(...lams)] as [number, number] };
  }).sort((a, b) => a.visit - b.visit || a.band.localeCompare(b.band));

  el.innerHTML = `
    <div class="fb">
      <div class="fb-modes">
        <button class="btn sm on" data-m="raw">Every exposure</button>
        <button class="btn sm ghost" data-m="visit">Per visit × band</button>
        <button class="btn sm ghost" data-m="deflash" ${spectrum ? "" : "disabled"}>De-flashed</button>
        <button class="btn sm ghost" data-m="diff" ${coadds.length > 1 ? "" : "disabled"}>Difference</button>
      </div>
      <div class="fb-stage"><canvas width="${S * 8}" height="${S * 8}"></canvas><div class="fb-hud"></div></div>
      <div class="fb-ctrl"><button class="btn sm" id="fbplay">❚❚ Pause</button><input type="range" id="fbspeed" min="2" max="20" value="8"><span class="mono note" id="fbn"></span></div>
      <canvas class="fb-strip" height="34"></canvas>
      <p class="note fb-explain"></p>${note ? `<p class="note">${note}</p>` : ""}
    </div>`;
  const cv = el.querySelector(".fb-stage canvas") as HTMLCanvasElement, ctx = cv.getContext("2d")!;
  const hud = el.querySelector(".fb-hud") as HTMLElement, strip = el.querySelector(".fb-strip") as HTMLCanvasElement;
  const explain = el.querySelector(".fb-explain") as HTMLElement;
  let mode: Mode = "raw", i = 0, playing = true, timer = 0 as any;
  const EXPL: Record<Mode, string> = {
    raw: "Every 2-minute SPHEREx exposure in time order. Each one sees the object at a different wavelength (dot colour) — so brightness flickers even for a constant star. That is the trap of blinking SPHEREx naïvely.",
    visit: "Exposures averaged per visit (6-month pass) and per detector band — the classic blink, now one frame per visit and band.",
    deflash: "Each exposure divided by what this object should look like at that wavelength (from its own SPHEREx spectrum), on one common brightness scale. A constant object stops flickering; what still changes is real.",
    diff: "Each visit minus the FIRST visit in the same detector band. Anything constant cancels to grey; a moving object leaves a dark hole where it was and a bright spot where it went; a brightening one turns bright.",
  };
  const items = () => (mode === "visit" || mode === "diff" ? coadds.length : N);
  // reference for difference imaging: the first visit's co-add in each detector band
  const firstByBand = new Map<string, Float32Array>(); for (const c of coadds) if (!firstByBand.has(c.band)) firstByBand.set(c.band, c.img);
  // de-flashed uses ONE stretch for all frames (a per-frame stretch would cancel the per-wavelength scaling)
  let gLo = 0, gHi = 1;
  { const v: number[] = []; for (let k = 0; k < N; k++) { const sc = 1 / Math.max(expect(meta.frames[k].lam_um), 1e-3), fr = frame(k); for (let p = 0; p < S * S; p += 3) if (isFinite(fr[p])) v.push(fr[p] * sc); }
    v.sort((a, b) => a - b); gLo = v[Math.floor(v.length * 0.05)] ?? 0; gHi = v[Math.floor(v.length * 0.998)] ?? 1; }
  function draw() {
    let img: Float32Array, label: string, lam: string, scale = 1;
    if (mode === "visit") { const c = coadds[i]; img = c.img; label = `${date(c.mjd)} · visit ${c.visit + 1} · ${c.band}`; lam = `${c.lam[0].toFixed(2)}–${c.lam[1].toFixed(2)} µm · ${c.n} exp.`; }
    else if (mode === "diff") { const c = coadds[i], ref = firstByBand.get(c.band)!; img = new Float32Array(S * S); for (let p = 0; p < S * S; p++) img[p] = c.img[p] - ref[p];
      label = `${date(c.mjd)} · ${c.band} minus first visit`; lam = `${c.lam[0].toFixed(2)}–${c.lam[1].toFixed(2)} µm`; }
    else { const f = meta.frames[i]; img = frame(i); label = `${date(f.mjd)} · ${f.band}`; lam = `${f.lam_um.toFixed(3)} µm`; if (mode === "deflash") scale = 1 / Math.max(expect(f.lam_um), 1e-3); }
    // robust stretch: per-frame for raw/visit, one global scale for de-flashed, symmetric about zero for differences
    let lo: number, hi: number;
    if (mode === "deflash") { lo = gLo; hi = gHi; }
    else if (mode === "diff") { const a = Array.from(img).filter(isFinite).map(Math.abs).sort((x, y) => x - y); const m = a[Math.floor(a.length * 0.995)] || 1; lo = -m; hi = m; }
    else { const vals = Array.from(img).filter(isFinite).map((v) => v * scale).sort((a, b) => a - b); lo = vals[Math.floor(vals.length * 0.05)] ?? 0; hi = vals[Math.floor(vals.length * 0.995)] ?? 1; }
    const id = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = img[(S - 1 - y) * S + x] * scale, p = (y * S + x) * 4; // flip: FITS row 0 at bottom
      if (!isFinite(v)) { id.data[p] = 40; id.data[p + 1] = 40; id.data[p + 2] = 48; id.data[p + 3] = 255; continue; }
      let r: number, g: number, b: number;
      if (mode === "diff") { const u = Math.max(-1, Math.min(1, v / Math.max(hi, 1e-9))); const q = Math.sign(u) * Math.sqrt(Math.abs(u));   // blue = fainter now, red = brighter now
        r = q > 0 ? 70 + 185 * q : 70 * (1 + q); g = 70 * (1 - Math.abs(q)) + (q > 0 ? 40 * q : 0); b = q < 0 ? 70 - 185 * q : 70 * (1 - q); }
      else { const t = Math.asinh(((v - lo) / Math.max(hi - lo, 1e-9)) * 8) / Math.asinh(8); [r, g, b] = color(t); }
      id.data[p] = r; id.data[p + 1] = g; id.data[p + 2] = b; id.data[p + 3] = 255;
    }
    const off = new OffscreenCanvas(S, S); off.getContext("2d")!.putImageData(id, 0, 0);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(off, 0, 0, cv.width, cv.height);
    // crosshair at the object's (motion-propagated) position
    const k = cv.width / S, f0 = meta.frames[(mode === "visit" || mode === "diff") ? 0 : i];
    const cx = (S / 2 + ((mode === "visit" || mode === "diff") ? 0 : f0.dx)) * k, cy = (S / 2 - ((mode === "visit" || mode === "diff") ? 0 : f0.dy)) * k;
    ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 1.5;
    for (const [a, b, c2, d] of [[-22, 0, -9, 0], [9, 0, 22, 0], [0, -22, 0, -9], [0, 9, 0, 22]]) { ctx.beginPath(); ctx.moveTo(cx + a, cy + b); ctx.lineTo(cx + c2, cy + d); ctx.stroke(); }
    const col = (mode === "visit" || mode === "diff") ? "#fff" : lamColor(meta.frames[i].lam_um);
    hud.innerHTML = `<b>${label}</b><span style="color:${col}">${lam}</span>`;
    (el.querySelector("#fbn") as HTMLElement).textContent = `${i + 1} / ${items()}`;
    drawStrip();
  }
  function drawStrip() {
    const w = (strip.width = strip.clientWidth * devicePixelRatio), h = (strip.height = 34 * devicePixelRatio), c = strip.getContext("2d")!;
    c.clearRect(0, 0, w, h);
    const t0 = meta.frames[0].mjd, t1 = meta.frames[N - 1].mjd, X = (m: number) => 8 + ((m - t0) / Math.max(t1 - t0, 1)) * (w - 16);
    meta.frames.forEach((f, k) => { c.fillStyle = lamColor(f.lam_um); c.globalAlpha = (mode === "visit" || mode === "diff") ? 0.35 : k === i ? 1 : 0.55; c.fillRect(X(f.mjd) - 1, 6 * devicePixelRatio + ((k * 7) % 14) * devicePixelRatio, 2 * devicePixelRatio, 6 * devicePixelRatio); });
    c.globalAlpha = 1; const cur = (mode === "visit" || mode === "diff") ? coadds[i].mjd : meta.frames[i].mjd;
    c.strokeStyle = "#fff"; c.lineWidth = 2; c.beginPath(); c.moveTo(X(cur), 0); c.lineTo(X(cur), h); c.stroke();
    c.fillStyle = "rgba(255,255,255,.6)"; c.font = `${10 * devicePixelRatio}px JetBrains Mono`; c.fillText(date(t0), 8, h - 2); const e = date(t1); c.fillText(e, w - c.measureText(e).width - 8, h - 2);
  }
  const speed = () => 1000 / parseInt((el.querySelector("#fbspeed") as HTMLInputElement).value, 10);
  function loop() { clearTimeout(timer); if (playing) { i = (i + 1) % items(); draw(); timer = setTimeout(loop, speed()); } }
  el.querySelectorAll<HTMLButtonElement>(".fb-modes button").forEach((b) => b.onclick = () => {
    el.querySelectorAll(".fb-modes button").forEach((x) => { x.classList.remove("on"); x.classList.add("ghost"); });
    b.classList.add("on"); b.classList.remove("ghost"); mode = b.dataset.m as Mode; i = 0; explain.textContent = EXPL[mode]; draw();
  });
  (el.querySelector("#fbplay") as HTMLButtonElement).onclick = (e) => { playing = !playing; (e.target as HTMLElement).textContent = playing ? "❚❚ Pause" : "▶ Play"; loop(); };
  strip.onclick = (ev) => {
    const r = strip.getBoundingClientRect(), fx = (ev.clientX - r.left) / r.width, t = meta.frames[0].mjd + fx * (meta.frames[N - 1].mjd - meta.frames[0].mjd);
    const arr = (mode === "visit" || mode === "diff") ? coadds.map((c) => c.mjd) : meta.frames.map((f) => f.mjd);
    i = arr.reduce((b, m, k) => (Math.abs(m - t) < Math.abs(arr[b] - t) ? k : b), 0); draw();
  };
  explain.textContent = EXPL[mode]; draw(); timer = setTimeout(loop, speed());
  return () => clearTimeout(timer);
}
