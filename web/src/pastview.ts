// SEE IT CHANGE PLACE — three real pictures of one object on one slider, with the path its measured motion draws:
// 2MASS around 1999 and WISE in 2010, read from NASA's infrared archive (IRSA) at those surveys' own sharpness, and
// SPHEREx in 2025–26, read from NASA's public SPHEREx archive when the visitor goes past 2010 (a few megabytes: a
// handful of exposures at 2.4–5 µm, combined). Nothing plays by itself: the visitor drags the slider or presses play.
import { SURVEYS, pastCutout } from "./blink/hips";
import { build, PIX_ARCSEC } from "./blink/engine";
import { robustStack } from "./blink/imaging";

export type MoveTarget = { ra: number; dec: number; /** arcsec per year, east and north */ pmra: number; pmdec: number; /** year of (ra, dec) */ epoch: number };
const N = 96, Y_TM = 1999.5, Y_WISE = 2010.5;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const ease = (u: number) => { const v = Math.min(1, Math.max(0, u)); return v * v * (3 - 2 * v); };

export function mountPastView(host: HTMLElement, t: MoveTarget, o: { label?: string; /** play once through the three pictures when they have arrived */ autoplay?: boolean } = {}): { destroy: () => void } {
  const ac = new AbortController(), yNow = Math.max(t.epoch, Y_WISE + 1), pm = Math.hypot(t.pmra, t.pmdec), track = pm * (yNow - Y_TM);
  const field = Math.min(600, Math.max(90, 2.6 * track)), pix = field / N, yMid = (Y_TM + yNow) / 2, cosd = Math.cos((t.dec * Math.PI) / 180);
  // the cutout is centred on the middle of the path, so that the whole of it is in view
  const ra0 = t.ra + (t.pmra * (yMid - t.epoch)) / 3600 / Math.max(cosd, 1e-6), dec0 = t.dec + (t.pmdec * (yMid - t.epoch)) / 3600, c = (N - 1) / 2;
  const at = (yr: number): [number, number] => [c - (t.pmra * (yr - yMid)) / pix, c - (t.pmdec * (yr - yMid)) / pix];     // east is left, north is up
  host.innerHTML = `<div class="pv">
    <div class="pv-stage"><canvas class="pv-cv" aria-label="Pictures of this object in about 1999, in 2010 and today"></canvas><div class="pv-cap" aria-live="polite">Reading the pictures from NASA's archive…</div></div>
    <div class="pv-ctl"><button class="icon-btn pv-play" aria-label="Play from 1999 to today" title="Play from 1999 to today">▶</button>
      <input class="pv-range" type="range" min="0" max="1000" value="0" aria-label="Date, from 1999 to today"><b class="pv-yr mono">2010</b></div>
    <div class="pv-stops"><button data-y="${Y_TM}">≈ 1999 · 2MASS</button><button data-y="${Y_WISE}">2010 · WISE</button><button data-y="${yNow}" title="Reads SPHEREx's own exposures of this place from NASA's archive (a few megabytes)">${Math.floor(yNow)} · SPHEREx</button></div>
    <p class="pv-note">${o.label ? esc(o.label) + " " : ""}The circle marks where the measured motion puts the object at the date shown; the line is its measured path. Three NASA pictures, three wavelengths (2.2, 4.6 and 2.4–5 µm): compare places, not brightness. Field ${field < 100 ? field.toFixed(0) + "″" : (field / 60).toFixed(1) + "′"} wide, north up, east left. A cold object can be invisible in the 1999 picture.</p></div>`;
  const cv = host.querySelector(".pv-cv") as HTMLCanvasElement, cap = host.querySelector(".pv-cap") as HTMLElement, range = host.querySelector(".pv-range") as HTMLInputElement,
    yrEl = host.querySelector(".pv-yr") as HTMLElement, playBtn = host.querySelector(".pv-play") as HTMLButtonElement;
  const img: { tm: Float32Array | null; wise: Float32Array | null; sx: Float32Array | null } = { tm: null, wise: null, sx: null };
  // every confirmed mover was found in WISE data, so its 2010 picture always shows it: the slider starts there
  let done = 0, y = Y_WISE, raf = 0, playing = false, dead = false, last = 0, hold = 0, sx: "idle" | "loading" | "done" | "none" = "idle", sxN = 0;
  const small = document.createElement("canvas"); small.width = small.height = N;
  // display: black just under the sky, white well above the noise (14 sigma or the brightest pixels), so that the sky
  // stays dark and only real sources stand out
  const disp = (a: Float32Array) => { const v: number[] = []; for (let k = 0; k < a.length; k++) if (Number.isFinite(a[k])) v.push(a[k]); v.sort((p, q) => p - q);
    const med = v[v.length >> 1] ?? 0, sig = Math.max(med - (v[Math.floor(v.length * 0.16)] ?? med), 1e-9), lo = med - 0.5 * sig, hi = Math.max(v[Math.floor(v.length * 0.999)] ?? med, med + 14 * sig), d = new Float32Array(a.length);
    for (let k = 0; k < a.length; k++) d[k] = Number.isFinite(a[k]) ? Math.pow(Math.min(1, Math.max(0, (a[k] - lo) / (hi - lo))), 0.62) : 0; return d; };
  /** SPHEREx's own picture of this place: a few exposures at 2.4–5 µm from NASA's archive, combined and put on the card's grid */
  async function loadSpherex() {
    if (sx !== "idle") return; sx = "loading"; draw();
    try {
      const Ns = Math.min(100, Math.max(20, 2 * Math.ceil((field / PIX_ARCSEC + 4) / 2)));
      const b = await build({ ra: ra0, dec: dec0 }, { size: Ns, maxFrames: 9, dets: new Set([4, 5, 6]), concurrency: 4, signal: ac.signal });
      if (dead) return;
      if (b.frames.length < 2) { sx = "none"; draw(); return; }
      const st = robustStack(b.frames.map((f) => f.img), Ns * Ns), cs = (Ns - 1) / 2, out = new Float32Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {      // same centre and orientation, coarser pixels: bilinear onto the card's grid
        const x = cs + ((i - c) * pix) / PIX_ARCSEC, yy = cs + ((j - c) * pix) / PIX_ARCSEC, i0 = Math.floor(x), j0 = Math.floor(yy), k = j * N + i;
        if (i0 < 0 || j0 < 0 || i0 >= Ns - 1 || j0 >= Ns - 1) { out[k] = NaN; continue; }
        const u = x - i0, v = yy - j0, q = j0 * Ns + i0, a00 = st[q], a10 = st[q + 1], a01 = st[q + Ns], a11 = st[q + Ns + 1];
        out[k] = [a00, a10, a01, a11].every(Number.isFinite) ? a00 * (1 - u) * (1 - v) + a10 * u * (1 - v) + a01 * (1 - u) * v + a11 * u * v : st[Math.round(yy) * Ns + Math.round(x)];
      }
      img.sx = disp(out); sxN = b.frames.length; sx = "done"; draw();
    } catch { if (!dead) { sx = "none"; draw(); } }
  }
  function draw() {
    if (dead) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(160, Math.round(cv.clientWidth * dpr)); if (cv.width !== w) cv.width = cv.height = w;
    const g = cv.getContext("2d")!, A = img.tm, B = img.wise, C = img.sx, s = w / N; g.fillStyle = "#05060a"; g.fillRect(0, 0, w, w);
    // which two pictures surround the date, and how far between them it stands. Where a picture is missing its
    // neighbour is shown dimmed.
    let P: Float32Array | null, Q: Float32Array | null, f: number, dim = 1;
    if (y <= Y_WISE) { P = A ?? B; Q = B ?? A; f = A && B ? ease((y - Y_TM) / (Y_WISE - Y_TM)) : 0; if (!A && y < Y_WISE - 0.3) dim = 0.5; }
    else { P = B ?? C; Q = C ?? B; f = B && C ? ease((y - Y_WISE) / (yNow - Y_WISE)) : 0; if (!C) dim = 1 - 0.5 * Math.min(1, (y - Y_WISE) / (yNow - Y_WISE)); }
    if (P && Q) {
      const id = small.getContext("2d")!.createImageData(N, N), px = id.data;
      for (let k = 0; k < N * N; k++) { const v = 255 * dim * (P[k] * (1 - f) + Q[k] * f); px[k * 4] = v; px[k * 4 + 1] = v; px[k * 4 + 2] = v * 1.04; px[k * 4 + 3] = 255; }
      small.getContext("2d")!.putImageData(id, 0, 0); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; g.drawImage(small, 0, 0, w, w);
    }
    const Pt = (yr: number): [number, number] => { const [x, yy] = at(yr); return [(x + 0.5) * s, (yy + 0.5) * s]; };
    const [x0, y0] = Pt(Y_TM), [x1, y1] = Pt(Y_WISE), [x2, y2] = Pt(yNow);
    g.lineWidth = 1.5 * dpr; g.strokeStyle = "#ff9d4d"; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x2, y2); g.stroke();
    g.fillStyle = "#ff9d4d"; g.font = `${10 * dpr}px ui-monospace, Menlo, monospace`; g.textBaseline = "middle";
    // year labels: the two ends beyond the path, along it; the middle one beside it, and only when there is room
    const len = Math.hypot(x2 - x0, y2 - y0) || 1, ux = (x2 - x0) / len, uy = (y2 - y0) / len, off = 17 * dpr; g.textAlign = "center";
    for (const [x, yy] of [[x0, y0], [x1, y1], [x2, y2]]) { g.beginPath(); g.arc(x, yy, 2.4 * dpr, 0, 7); g.fill(); }
    g.fillText("1999", x0 - ux * off, y0 - uy * off); g.fillText(String(Math.floor(yNow)), x2 + ux * off, y2 + uy * off);
    if (len > 70 * dpr) g.fillText("2010", x1 - uy * 13 * dpr, y1 + ux * 13 * dpr);
    const [mx, my] = Pt(y); g.strokeStyle = "#ffffff"; g.lineWidth = 1.6 * dpr; g.beginPath(); g.arc(mx, my, Math.max(7 * dpr, (4 / pix) * s), 0, 7); g.stroke();
    // scale bar and compass
    const bar = [5, 10, 30, 60, 120].find((b) => (b / pix) * s > 0.16 * w) ?? 120, bw = (bar / pix) * s; g.strokeStyle = g.fillStyle = "rgba(240,240,250,.85)"; g.lineWidth = 1 * dpr;
    g.beginPath(); g.moveTo(w - 10 * dpr - bw, w - 12 * dpr); g.lineTo(w - 10 * dpr, w - 12 * dpr); g.stroke(); g.textAlign = "center"; g.fillText(bar < 60 ? `${bar}″` : `${bar / 60}′`, w - 10 * dpr - bw / 2, w - 22 * dpr);
    g.textAlign = "left"; g.fillText("N ↑   E ←", 10 * dpr, w - 12 * dpr);
    yrEl.textContent = String(Math.floor(y + 1e-6));
    const yearNow = Math.floor(yNow);
    cap.textContent = done < 2 && !A && !B ? "Reading the pictures from NASA's archive…" : !A && !B && !C ? "The pictures could not be read just now. The measured path is shown."
      : Math.abs(y - Y_TM) < 0.3 ? (A ? "About 1999 · picture by the 2MASS survey, 2.2 µm" : done < SURVEYS.length ? "Reading the 1999 picture from NASA's archive…" : "About 1999 · no picture could be read for this date")
      : Math.abs(y - Y_WISE) < 0.3 ? (B ? "2010 · picture by NASA's WISE, 4.6 µm" : done < SURVEYS.length ? "Reading the 2010 picture from NASA's archive…" : "2010 · no picture could be read for this date")
      : y < Y_WISE ? "Between the 1999 and 2010 pictures"
      : sx === "loading" ? "Reading SPHEREx's own picture of this place from NASA's archive…"
      : y > yNow - 0.3 ? (C ? `${yearNow} · picture by NASA's SPHEREx: ${sxN} exposures at 2.4–5 µm combined (its pixels are 6″ wide)` : `${yearNow} · no SPHEREx picture could be read just now · the circle is where its images confirmed the object`)
      : C ? "Between the 2010 picture and SPHEREx's" : "After 2010 · the circle follows the measured motion";
    range.value = String(Math.round(((y - Y_TM) / (yNow - Y_TM)) * 1000));
    host.querySelectorAll<HTMLButtonElement>(".pv-stops button").forEach((b) => b.classList.toggle("on", Math.abs(+b.dataset.y! - y) < 0.3));
    playBtn.textContent = playing ? "❚❚" : "▶";
  }
  function step(now: number) {
    if (dead || !playing) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (hold > 0) hold -= dt;
    else if (Math.abs(y - Y_WISE) < 1e-6 && sx === "loading") { /* rest on the 2010 picture until SPHEREx's has arrived */ }
    else { const y1 = y + (dt * (yNow - Y_TM)) / 7;                 // the whole span in seven seconds, resting on each picture
      if (y < Y_WISE && y1 >= Y_WISE) { y = Y_WISE; hold = 0.9; loadSpherex(); } else if (y1 >= yNow) { y = yNow; playing = false; } else y = y1; }
    draw(); if (playing) raf = requestAnimationFrame(step);
  }
  const go = (yr: number) => { y = yr; if (y > Y_WISE + 0.2) loadSpherex(); draw(); };
  playBtn.onclick = () => { playing = !playing; if (playing) { if (y >= yNow - 0.01) y = Y_TM; if (y >= Y_WISE) loadSpherex(); hold = Math.abs(y - Y_TM) < 0.01 ? 0.9 : 0; last = performance.now(); raf = requestAnimationFrame(step); } draw(); };
  range.oninput = () => { playing = false; cancelAnimationFrame(raf); let v = Y_TM + (+range.value / 1000) * (yNow - Y_TM); for (const q of [Y_TM, Y_WISE, yNow]) if (Math.abs(v - q) < 0.35) v = q; go(v); };
  host.querySelectorAll<HTMLButtonElement>(".pv-stops button").forEach((b) => (b.onclick = () => { playing = false; cancelAnimationFrame(raf); go(+b.dataset.y!); }));
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => draw()) : null; ro?.observe(cv);
  // a quick overview: once the two archive pictures are in, the three dates are played through a single time, slowly;
  // the visitor can stop it, and nothing loops
  const overview = () => { if (dead || playing || !o.autoplay || !(img.tm || img.wise)) return; y = img.tm ? Y_TM : Y_WISE; playing = true; hold = 1.1; last = performance.now(); if (y >= Y_WISE) loadSpherex(); raf = requestAnimationFrame(step); draw(); };
  for (const sv of SURVEYS) pastCutout(sv, ra0, dec0, N, pix, ac.signal).catch(() => null).then((a) => { if (dead) return; img[sv.key] = a ? disp(a) : null; done++; draw(); if (done === SURVEYS.length) overview(); });
  draw();
  return { destroy() { dead = true; playing = false; cancelAnimationFrame(raf); ac.abort(); ro?.disconnect(); host.innerHTML = ""; } };
}
