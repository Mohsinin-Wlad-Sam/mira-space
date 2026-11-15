// SEE IT MOVE — two real pictures of one object, taken about eleven years apart by two NASA-funded sky surveys
// (2MASS around 1999, WISE in 2010), on one slider, with the path its measured motion draws up to today. The pictures
// are read from NASA's infrared archive (IRSA) at the surveys' own sharpness, so a star that moved only a few
// arcseconds visibly shifts. Nothing plays by itself: the visitor drags the slider or presses play.
import { SURVEYS, pastCutout } from "./blink/hips";

export type MoveTarget = { ra: number; dec: number; /** arcsec per year, east and north */ pmra: number; pmdec: number; /** year of (ra, dec) */ epoch: number };
const N = 96, Y_TM = 1999.5, Y_WISE = 2010.5;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function mountPastView(host: HTMLElement, t: MoveTarget, o: { label?: string } = {}): { destroy: () => void } {
  const ac = new AbortController(), yNow = Math.max(t.epoch, Y_WISE + 1), pm = Math.hypot(t.pmra, t.pmdec), track = pm * (yNow - Y_TM);
  const field = Math.min(600, Math.max(90, 2.6 * track)), pix = field / N, yMid = (Y_TM + yNow) / 2, cosd = Math.cos((t.dec * Math.PI) / 180);
  // the cutout is centred on the middle of the path, so that the whole of it is in view
  const ra0 = t.ra + (t.pmra * (yMid - t.epoch)) / 3600 / Math.max(cosd, 1e-6), dec0 = t.dec + (t.pmdec * (yMid - t.epoch)) / 3600, c = (N - 1) / 2;
  const at = (yr: number): [number, number] => [c - (t.pmra * (yr - yMid)) / pix, c - (t.pmdec * (yr - yMid)) / pix];     // east is left, north is up
  host.innerHTML = `<div class="pv">
    <div class="pv-stage"><canvas class="pv-cv" aria-label="Pictures of this object in about 1999 and in 2010"></canvas><div class="pv-cap" aria-live="polite">Reading two pictures from NASA's archive…</div></div>
    <div class="pv-ctl"><button class="icon-btn pv-play" aria-label="Play from 1999 to today" title="Play from 1999 to today">▶</button>
      <input class="pv-range" type="range" min="0" max="1000" value="0" aria-label="Date, from 1999 to today"><b class="pv-yr mono">1999</b></div>
    <div class="pv-stops"><button data-y="${Y_TM}">≈ 1999</button><button data-y="${Y_WISE}">2010</button><button data-y="${yNow}">${Math.floor(yNow)} · SPHEREx</button></div>
    <p class="pv-note">${o.label ? esc(o.label) + " " : ""}The circle marks where the measured motion puts the object at the date shown. Field ${field < 100 ? field.toFixed(0) + "″" : (field / 60).toFixed(1) + "′"} wide, north up, east left. Cold objects can be invisible in the 1999 picture (2.2 µm) and bright in the 2010 one (4.6 µm).</p></div>`;
  const cv = host.querySelector(".pv-cv") as HTMLCanvasElement, cap = host.querySelector(".pv-cap") as HTMLElement, range = host.querySelector(".pv-range") as HTMLInputElement,
    yrEl = host.querySelector(".pv-yr") as HTMLElement, playBtn = host.querySelector(".pv-play") as HTMLButtonElement;
  const img: Record<string, Float32Array | null> = { tm: null, wise: null }; let done = 0, y = Y_TM, raf = 0, playing = false, dead = false, last = 0, hold = 0;
  const small = document.createElement("canvas"); small.width = small.height = N;
  // display: black just under the sky, white well above the noise (14 sigma or the brightest pixels), so that the sky
  // stays dark and only real sources stand out
  const disp = (a: Float32Array) => { const v: number[] = []; for (let k = 0; k < a.length; k++) if (Number.isFinite(a[k])) v.push(a[k]); v.sort((p, q) => p - q);
    const med = v[v.length >> 1] ?? 0, sig = Math.max(med - (v[Math.floor(v.length * 0.16)] ?? med), 1e-9), lo = med - 0.5 * sig, hi = Math.max(v[Math.floor(v.length * 0.999)] ?? med, med + 14 * sig), d = new Float32Array(a.length);
    for (let k = 0; k < a.length; k++) d[k] = Number.isFinite(a[k]) ? Math.pow(Math.min(1, Math.max(0, (a[k] - lo) / (hi - lo))), 0.62) : 0; return d; };
  function draw() {
    if (dead) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(160, Math.round(cv.clientWidth * dpr)); if (cv.width !== w) cv.width = cv.height = w;
    const g = cv.getContext("2d")!, A = img.tm, B = img.wise, s = w / N; g.fillStyle = "#05060a"; g.fillRect(0, 0, w, w);
    if (A || B) {
      // 1999 -> 2010: one picture gives way to the other; after 2010 there is no later picture here, so the last one dims
      const u = Math.min(1, Math.max(0, (y - Y_TM) / (Y_WISE - Y_TM))), f = A && B ? u * u * (3 - 2 * u) : A ? 0 : 1, dim = y > Y_WISE ? 1 - 0.5 * Math.min(1, (y - Y_WISE) / (yNow - Y_WISE)) : !A && y < Y_WISE ? 0.5 : 1;
      const id = small.getContext("2d")!.createImageData(N, N), px = id.data;
      for (let k = 0; k < N * N; k++) { const v = 255 * dim * ((A ? A[k] : 0) * (1 - f) + (B ? B[k] : 0) * f); px[k * 4] = v; px[k * 4 + 1] = v; px[k * 4 + 2] = v * 1.04; px[k * 4 + 3] = 255; }
      small.getContext("2d")!.putImageData(id, 0, 0); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; g.drawImage(small, 0, 0, w, w);
    }
    const P = (yr: number): [number, number] => { const [x, yy] = at(yr); return [(x + 0.5) * s, (yy + 0.5) * s]; };
    const [x0, y0] = P(Y_TM), [x1, y1] = P(Y_WISE), [x2, y2] = P(yNow);
    g.lineWidth = 1.5 * dpr; g.strokeStyle = "#ff9d4d"; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.setLineDash([4 * dpr, 4 * dpr]); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]);
    g.fillStyle = "#ff9d4d"; g.font = `${10 * dpr}px ui-monospace, Menlo, monospace`; g.textBaseline = "middle";
    const side = Math.abs(x2 - x0) > Math.abs(y2 - y0) ? [0, -11 * dpr] : [9 * dpr, 0];      // labels beside the path, not on it
    for (const [x, yy, lab] of [[x0, y0, "1999"], [x1, y1, "2010"], [x2, y2, String(Math.floor(yNow))]] as [number, number, string][]) { g.beginPath(); g.arc(x, yy, 2.4 * dpr, 0, 7); g.fill(); g.textAlign = side[0] ? "left" : "center"; g.fillText(lab, x + side[0], yy + side[1]); }
    const [mx, my] = P(y); g.strokeStyle = "#ffffff"; g.lineWidth = 1.6 * dpr; g.beginPath(); g.arc(mx, my, Math.max(7 * dpr, (4 / pix) * s), 0, 7); g.stroke();
    // scale bar and compass
    const bar = [5, 10, 30, 60, 120].find((b) => b / pix * s > 0.16 * w) ?? 120, bw = (bar / pix) * s; g.strokeStyle = g.fillStyle = "rgba(240,240,250,.85)"; g.lineWidth = 1 * dpr;
    g.beginPath(); g.moveTo(w - 10 * dpr - bw, w - 12 * dpr); g.lineTo(w - 10 * dpr, w - 12 * dpr); g.stroke(); g.textAlign = "center"; g.fillText(bar < 60 ? `${bar}″` : `${bar / 60}′`, w - 10 * dpr - bw / 2, w - 22 * dpr);
    g.textAlign = "left"; g.fillText("N ↑   E ←", 10 * dpr, w - 12 * dpr);
    yrEl.textContent = String(Math.floor(y + 1e-6));
    cap.textContent = done < 2 && !A && !B ? "Reading two pictures from NASA's archive…" : !A && !B ? "The pictures could not be read just now. The measured path is shown."
      : Math.abs(y - Y_TM) < 0.3 ? (A ? "About 1999 · picture by the 2MASS survey, 2.2 µm" : "About 1999 · no picture could be read for this date")
      : Math.abs(y - Y_WISE) < 0.3 ? (B ? "2010 · picture by NASA's WISE, 4.6 µm" : "2010 · no picture could be read for this date")
      : y < Y_WISE ? "Between the two pictures" : y > yNow - 0.3 ? `${Math.floor(yNow)} · SPHEREx finds it here, where its motion predicts` : "No picture after 2010 here · the circle follows the measured motion";
    range.value = String(Math.round(((y - Y_TM) / (yNow - Y_TM)) * 1000));
    host.querySelectorAll<HTMLButtonElement>(".pv-stops button").forEach((b) => b.classList.toggle("on", Math.abs(+b.dataset.y! - y) < 0.3));
    playBtn.textContent = playing ? "❚❚" : "▶";
  }
  function step(now: number) {
    if (dead || !playing) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (hold > 0) hold -= dt;
    else { const y1 = y + dt * (yNow - Y_TM) / 7;                 // the whole span in seven seconds, resting on each picture
      if (y < Y_WISE && y1 >= Y_WISE) { y = Y_WISE; hold = 0.9; } else if (y1 >= yNow) { y = yNow; playing = false; } else y = y1; }
    draw(); if (playing) raf = requestAnimationFrame(step);
  }
  playBtn.onclick = () => { playing = !playing; if (playing) { if (y >= yNow - 0.01) y = Y_TM; hold = Math.abs(y - Y_TM) < 0.01 ? 0.9 : 0; last = performance.now(); raf = requestAnimationFrame(step); } draw(); };
  range.oninput = () => { playing = false; cancelAnimationFrame(raf); y = Y_TM + (+range.value / 1000) * (yNow - Y_TM); for (const q of [Y_TM, Y_WISE, yNow]) if (Math.abs(y - q) < 0.35) y = q; draw(); };
  host.querySelectorAll<HTMLButtonElement>(".pv-stops button").forEach((b) => (b.onclick = () => { playing = false; cancelAnimationFrame(raf); y = +b.dataset.y!; draw(); }));
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => draw()) : null; ro?.observe(cv);
  for (const sv of SURVEYS) pastCutout(sv, ra0, dec0, N, pix, ac.signal).catch(() => null).then((a) => { if (dead) return; img[sv.key] = a ? disp(a) : null; done++; draw(); });
  draw();
  return { destroy() { dead = true; playing = false; cancelAnimationFrame(raf); ac.abort(); ro?.disconnect(); host.innerHTML = ""; } };
}
