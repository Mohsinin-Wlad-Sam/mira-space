// WATCH A PLACE THROUGH TIME — any spot of the sky as a little film, right on the map: 2MASS around 1999, WISE in
// 2010, then one picture per SPHEREx visit (that visit's exposures at 3.8–5 µm combined, WISE's own colour, so
// that a cold object is in every one of them), read from NASA's archives
// when asked for. It plays once, slowly, and can then be scrubbed. The Lab does the same with instruments around it.
import { SURVEYS, pastCutout } from "./blink/hips";
import { build, mjdToYear, PIX_ARCSEC, type Frame } from "./blink/engine";
import { robustStack } from "./blink/imaging";

type Pic = { yr: number; stop: string; cap: string; img: Float32Array | null; kind: "tm" | "wise" | "sx"; state: "wait" | "ok" | "none" };
const N = 96, MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ease = (u: number) => { const v = Math.min(1, Math.max(0, u)); return v * v * (3 - 2 * v); };
const monthOf = (yr: number) => { const d = new Date(Date.UTC(2000, 0, 1) + (yr - 2000) * 365.25 * 864e5); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
// black just under the sky, white well above the noise: the sky stays dark and only real sources stand out
const disp = (a: Float32Array) => { const v: number[] = []; for (let k = 0; k < a.length; k++) if (Number.isFinite(a[k])) v.push(a[k]); v.sort((p, q) => p - q);
  const med = v[v.length >> 1] ?? 0, sig = Math.max(med - (v[Math.floor(v.length * 0.16)] ?? med), 1e-9), lo = med - 0.5 * sig, hi = Math.max(v[Math.floor(v.length * 0.999)] ?? med, med + 14 * sig), d = new Float32Array(a.length);
  for (let k = 0; k < a.length; k++) d[k] = Number.isFinite(a[k]) ? Math.pow(Math.min(1, Math.max(0, (a[k] - lo) / (hi - lo))), 0.62) : 0; return d; };

export function mountPlaceView(host: HTMLElement, p: { ra: number; dec: number }, o: { autoplay?: boolean; /** width of the field, arcsec */ field?: number } = {}): { destroy: () => void } {
  const ac = new AbortController(), field = o.field ?? 240, pix = field / N, c = (N - 1) / 2;
  host.innerHTML = `<div class="pv">
    <div class="pv-stage"><canvas class="pv-cv" aria-label="Pictures of this place at several dates"></canvas><div class="pv-cap" aria-live="polite">Reading the pictures from NASA's archive…</div></div>
    <div class="pv-ctl"><button class="icon-btn pv-play" aria-label="Play from 1999 to today" title="Play from 1999 to today">▶</button>
      <input class="pv-range" type="range" min="0" max="1000" value="0" aria-label="Date, from 1999 to SPHEREx's latest visit"><b class="pv-yr mono">1999</b></div>
    <div class="pv-stops"></div>
    <p class="pv-note">The same ${(field / 60).toFixed(0)}′ of sky at each date, north up, east left. 2MASS saw it at 2.2 µm; WISE at 4.6 µm and SPHEREx here at 3.8–5 µm, the colour in which cold objects show. Compare places rather than brightness: whatever changes place from one picture to the next is moving.</p></div>`;
  const cv = host.querySelector(".pv-cv") as HTMLCanvasElement, cap = host.querySelector(".pv-cap") as HTMLElement, range = host.querySelector(".pv-range") as HTMLInputElement,
    yrEl = host.querySelector(".pv-yr") as HTMLElement, playBtn = host.querySelector(".pv-play") as HTMLButtonElement, stops = host.querySelector(".pv-stops") as HTMLElement;
  let pics: Pic[] = [
    { yr: 1999.5, stop: "≈ 1999 · 2MASS", cap: "About 1999 · picture by the 2MASS survey, 2.2 µm", img: null, kind: "tm", state: "wait" },
    { yr: 2010.5, stop: "2010 · WISE", cap: "2010 · picture by NASA's WISE, 4.6 µm", img: null, kind: "wise", state: "wait" },
    { yr: 2025.6, stop: "2025–26 · SPHEREx", cap: "Reading SPHEREx's exposures of this place from NASA's archive…", img: null, kind: "sx", state: "wait" }];
  let v = 0, raf = 0, playing = false, dead = false, last = 0, hold = 0, sx: "idle" | "loading" | "done" = "idle", got = 0, sxProg = "";
  const small = document.createElement("canvas"); small.width = small.height = N;
  function renderStops() {
    stops.innerHTML = pics.map((q, i) => `<button data-i="${i}">${q.stop}</button>`).join("");
    stops.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => { playing = false; cancelAnimationFrame(raf); go(+b.dataset.i!); }));
  }
  /** one stack of exposures put on the card's grid (same centre and orientation, finer pixels) */
  function toGrid(st: Float32Array, Ns: number) {
    const cs = (Ns - 1) / 2, out = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = cs + ((i - c) * pix) / PIX_ARCSEC, y = cs + ((j - c) * pix) / PIX_ARCSEC, i0 = Math.floor(x), j0 = Math.floor(y), k = j * N + i;
      if (i0 < 0 || j0 < 0 || i0 >= Ns - 1 || j0 >= Ns - 1) { out[k] = NaN; continue; }
      const u = x - i0, w = y - j0, q = j0 * Ns + i0, a00 = st[q], a10 = st[q + 1], a01 = st[q + Ns], a11 = st[q + Ns + 1];
      out[k] = [a00, a10, a01, a11].every(Number.isFinite) ? a00 * (1 - u) * (1 - w) + a10 * u * (1 - w) + a01 * (1 - u) * w + a11 * u * w : st[Math.round(y) * Ns + Math.round(x)];
    }
    return out;
  }
  /** SPHEREx's own pictures of this place: a dozen exposures from NASA's archive, combined visit by visit */
  async function loadSpherex() {
    if (sx !== "idle") return; sx = "loading"; draw();
    const fail = (why: string) => { if (dead) return; sx = "done"; pics = pics.map((q) => (q.kind === "sx" ? { ...q, state: "none" as const, cap: why } : q)); draw(); };
    try {
      const Ns = 2 * Math.ceil((field / PIX_ARCSEC + 4) / 2);
      const tick = (done: number, total: number) => { sxProg = ` ${done} of ${total}`; draw(); };
      const b = await build({ ra: p.ra, dec: p.dec }, { size: Ns, maxFrames: 12, dets: new Set([5, 6]), concurrency: 6, signal: ac.signal, onFrame: (_f, done, total) => tick(done, total), onSkip: tick });
      if (dead) return;
      const by = new Map<number, Frame[]>(); b.frames.forEach((f) => (by.get(f.visit) ?? by.set(f.visit, []).get(f.visit)!).push(f));
      const all = [...by.entries()].sort((a, q) => a[0] - q[0]).map(([, L]) => L), good = all.filter((L) => L.length >= 2), visits = good.length ? good : all;      // single exposures only when no visit has two
      if (!visits.length) return fail(b.listed ? "SPHEREx's exposures of this place could not be read just now." : "No SPHEREx exposure of this place is listed yet.");
      const made: Pic[] = visits.map((L, i) => { const yr = mjdToYear(L.reduce((s, f) => s + f.mjd, 0) / L.length);
        return { yr, stop: `${monthOf(yr)} · SPHEREx`, cap: `${monthOf(yr)} · NASA's SPHEREx, visit ${i + 1} of ${visits.length}: ${L.length > 1 ? L.length + " exposures combined" : "one exposure"} (3.8–5 µm, 6″ pixels)`, img: disp(toGrid(robustStack(L.map((f) => f.img), Ns * Ns), Ns)), kind: "sx" as const, state: "ok" as const }; });
      const at = v; pics = [...pics.filter((q) => q.kind !== "sx"), ...made]; sx = "done"; renderStops(); v = Math.min(at, pics.length - 1); draw();
    } catch (e) { if ((e as Error).name !== "AbortError") fail("SPHEREx's exposures of this place could not be read just now."); }
  }
  function draw() {
    if (dead) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(160, Math.round(cv.clientWidth * dpr)); if (cv.width !== w) cv.width = cv.height = w;
    const g = cv.getContext("2d")!; g.fillStyle = "#05060a"; g.fillRect(0, 0, w, w);
    const i = Math.min(pics.length - 1, Math.floor(v)), j = Math.min(pics.length - 1, i + 1), f = ease(v - i);
    // a picture that has not arrived (or does not exist) borrows its neighbour, dimmed
    const A = pics[i].img ?? pics[j].img ?? pics.find((q) => q.img)?.img ?? null, B = pics[j].img ?? A, dim = (pics[i].img ? 1 : 0.45) * (1 - f) + (pics[j].img ? 1 : 0.45) * f;
    if (A && B) {
      const id = small.getContext("2d")!.createImageData(N, N), px = id.data;
      for (let k = 0; k < N * N; k++) { const q = 255 * dim * (A[k] * (1 - f) + B[k] * f); px[k * 4] = q; px[k * 4 + 1] = q; px[k * 4 + 2] = q * 1.04; px[k * 4 + 3] = 255; }
      small.getContext("2d")!.putImageData(id, 0, 0); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; g.drawImage(small, 0, 0, w, w);
    }
    // the place that was clicked: four small corners, so that nothing hides what is there
    const m = w / 2, r = 13 * dpr, t = 5 * dpr; g.strokeStyle = "#ff9d4d"; g.lineWidth = 1.4 * dpr; g.beginPath();
    for (const [sx2, sy2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.moveTo(m + sx2 * r, m + sy2 * (r - t)); g.lineTo(m + sx2 * r, m + sy2 * r); g.lineTo(m + sx2 * (r - t), m + sy2 * r); }
    g.stroke();
    const s = w / N, bar = [10, 30, 60, 120].find((q) => (q / pix) * s > 0.16 * w) ?? 120, bw = (bar / pix) * s; g.strokeStyle = g.fillStyle = "rgba(240,240,250,.85)"; g.lineWidth = 1 * dpr; g.font = `${10 * dpr}px ui-monospace, Menlo, monospace`; g.textBaseline = "middle";
    g.beginPath(); g.moveTo(w - 10 * dpr - bw, w - 12 * dpr); g.lineTo(w - 10 * dpr, w - 12 * dpr); g.stroke(); g.textAlign = "center"; g.fillText(bar < 60 ? `${bar}″` : `${bar / 60}′`, w - 10 * dpr - bw / 2, w - 22 * dpr);
    g.textAlign = "left"; g.fillText("N ↑   E ←", 10 * dpr, w - 12 * dpr);
    const near = pics[Math.round(v)], yr = pics[i].yr + (pics[j].yr - pics[i].yr) * (v - i), exact = Math.abs(v - Math.round(v)) < 0.02;
    yrEl.textContent = yr > 2025 ? monthOf(yr) : String(Math.floor(yr + 1e-6));
    cap.textContent = !exact ? `Between ${pics[i].stop.split(" · ")[0].replace("≈ ", "")} and ${pics[j].stop.split(" · ")[0]}`
      : near.state === "none" ? near.cap : near.img ? near.cap + (sx === "loading" && near.kind === "wise" ? ` · now reading SPHEREx's exposures of this place from NASA's archive${sxProg}…` : "") : near.kind === "sx" && sx === "idle" ? "SPHEREx's pictures are read when you go past 2010" : near.kind === "sx" ? `Reading SPHEREx's exposures of this place from NASA's archive${sxProg}…` : got < 2 ? "Reading the picture from NASA's archive…" : `${near.stop.split(" · ")[0]} · no picture could be read for this date`;
    range.value = String(Math.round((v / Math.max(1, pics.length - 1)) * 1000));
    stops.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", exact && +b.dataset.i! === Math.round(v)));
    playBtn.textContent = playing ? "❚❚" : "▶";
  }
  function step(now: number) {
    if (dead || !playing) return;
    const dt = Math.min(0.1, (now - last) / 1000), end = pics.length - 1; last = now;
    if (v >= 1 - 1e-6 && sx === "idle") loadSpherex();        // however 2010 was reached, SPHEREx's pictures are asked for
    if (hold > 0) hold -= dt;
    else if (v >= 1 - 1e-6 && sx !== "done" && Math.abs(v - Math.round(v)) < 1e-6) { /* rest on the 2010 picture until SPHEREx's have arrived */ }
    else { const v1 = v + dt / 1.5, k = Math.floor(v) + 1;                       // a second and a half from one picture to the next, resting on each
      if (v1 >= k) { v = Math.min(k, end); hold = 0.9; if (k >= 1) loadSpherex(); if (v >= end && sx === "done") playing = false; } else v = v1; }
    draw(); if (playing) raf = requestAnimationFrame(step);
  }
  const go = (x: number) => { v = Math.max(0, Math.min(pics.length - 1, x)); if (v > 1.05) loadSpherex(); draw(); };
  playBtn.onclick = () => { playing = !playing; if (playing) { if (v >= pics.length - 1 - 0.01) v = 0; hold = Math.abs(v - Math.round(v)) < 0.01 ? 0.8 : 0; last = performance.now(); raf = requestAnimationFrame(step); } draw(); };
  range.oninput = () => { playing = false; cancelAnimationFrame(raf); let x = (+range.value / 1000) * (pics.length - 1); if (Math.abs(x - Math.round(x)) < 0.06) x = Math.round(x); go(x); };
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => draw()) : null; ro?.observe(cv);
  const overview = () => { if (dead || playing || !o.autoplay || !pics.some((q) => q.img)) return; v = pics[0].img ? 0 : 1; playing = true; hold = 1.1; last = performance.now(); raf = requestAnimationFrame(step); draw(); };
  for (const sv of SURVEYS) pastCutout(sv, p.ra, p.dec, N, pix, ac.signal).catch(() => null).then((a) => { if (dead) return; const q = pics.find((x) => x.kind === sv.key)!; q.img = a ? disp(a) : null; q.state = a ? "ok" : "none"; got++; draw(); if (got === SURVEYS.length) overview(); });
  renderStops(); draw();
  return { destroy() { dead = true; playing = false; cancelAnimationFrame(raf); ac.abort(); ro?.disconnect(); host.innerHTML = ""; } };
}
