// SKY WORLD MODEL — a researcher tool (preview). A small network that was shown two pictures of the same patch of sky
// taken years apart and trained to draw the next one. It was trained on NASA's cluster-free archive pictures on our
// university GPUs (census/wm_train.py); here it runs in the browser, on the pictures the Lab already holds, so the
// site needs no server for it. What it draws is a MODEL'S PREDICTION, not a telescope picture, and is marked so.
// The file is loaded on first use; if the server does not carry it the tool says so instead of pretending.
import { PIX_ARCSEC } from "./engine";

type Layer = { k: string; w: Float32Array; b: Float32Array; cin: number; cout: number; ks: number };
type Model = { meta: any; L: Record<string, Layer> };
let model: Promise<Model | null> | null = null;

async function load(): Promise<Model | null> {
  try {
    const meta = await (await fetch("/data/wm/model.json", { cache: "no-cache" })).json(), buf = await (await fetch(`/data/wm/${meta.weights}`)).arrayBuffer(), f = new Float32Array(buf), L: Record<string, Layer> = {};
    for (const q of meta.layers) L[q.k] = { k: q.k, cin: q.cin, cout: q.cout, ks: q.ks, w: f.subarray(q.w, q.w + q.cout * q.cin * q.ks * q.ks), b: f.subarray(q.b, q.b + q.cout) };
    return { meta, L };
  } catch { return null; }
}
// ---- the network's arithmetic, written out: convolutions on [channels][H*W] arrays
type T = { c: number; h: number; w: number; d: Float32Array };
function conv(x: T, l: Layer, relu = true): T {
  const { h, w } = x, n = h * w, out = new Float32Array(l.cout * n), ks = l.ks, r = ks >> 1;
  for (let o = 0; o < l.cout; o++) {
    const dst = out.subarray(o * n, (o + 1) * n); dst.fill(l.b[o]);
    for (let i = 0; i < l.cin; i++) {
      const src = x.d.subarray(i * n, (i + 1) * n), wb = (o * l.cin + i) * ks * ks;
      for (let ky = 0; ky < ks; ky++) for (let kx = 0; kx < ks; kx++) {
        const wt = l.w[wb + ky * ks + kx]; if (wt === 0) continue; const dy = ky - r, dx = kx - r;
        const y0 = Math.max(0, -dy), y1 = Math.min(h, h - dy), x0 = Math.max(0, -dx), x1 = Math.min(w, w - dx);
        for (let y = y0; y < y1; y++) { let p = y * w + x0, q = (y + dy) * w + x0 + dx; for (let xx = x0; xx < x1; xx++) dst[p++] += wt * src[q++]; }
      }
    }
    if (relu) for (let k = 0; k < n; k++) if (dst[k] < 0) dst[k] = 0;
  }
  return { c: l.cout, h, w, d: out };
}
function pool(x: T): T { const h = x.h >> 1, w = x.w >> 1, out = new Float32Array(x.c * h * w);
  for (let c = 0; c < x.c; c++) for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { const b = c * x.h * x.w + 2 * y * x.w + 2 * xx; out[c * h * w + y * w + xx] = Math.max(x.d[b], x.d[b + 1], x.d[b + x.w], x.d[b + x.w + 1]); }
  return { c: x.c, h, w, d: out }; }
function up(x: T): T { const h = x.h * 2, w = x.w * 2, out = new Float32Array(x.c * h * w);
  for (let c = 0; c < x.c; c++) for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) out[c * h * w + y * w + xx] = x.d[c * x.h * x.w + (y >> 1) * x.w + (xx >> 1)];
  return { c: x.c, h, w, d: out }; }
function cat(a: T, b: T): T { const d = new Float32Array(a.d.length + b.d.length); d.set(a.d); d.set(b.d, a.d.length); return { c: a.c + b.c, h: a.h, w: a.w, d }; }

/** the same normalisation as in training: sky level to 0, noise to 1, then a soft compression of bright stars */
export function norm(img: Float32Array): { z: Float32Array; med: number; sig: number } {
  const v: number[] = []; for (let k = 0; k < img.length; k += 1) if (Number.isFinite(img[k])) v.push(img[k]);
  v.sort((a, b) => a - b); const med = v.length ? v[v.length >> 1] : 0, dev = v.map((x) => Math.abs(x - med)).sort((a, b) => a - b), sig = Math.max(1e-9, (dev[dev.length >> 1] ?? 1) * 1.4826);
  const z = new Float32Array(img.length); for (let k = 0; k < img.length; k++) z[k] = Number.isFinite(img[k]) ? Math.asinh((img[k] - med) / sig / 5) / 4 : 0;
  return { z, med, sig };
}
/** run the network: two pictures (older, newer) and how far ahead to look, in units of the gap between them */
export function predict(m: Model, a: Float32Array, b: Float32Array, N: number, tau: number): { next: Float32Array; heat: Float32Array; vx: Float32Array; vy: Float32Array } {
  const n = N * N, x0: T = { c: 3, h: N, w: N, d: new Float32Array(3 * n) }; x0.d.set(a); x0.d.set(b, n); x0.d.fill(tau / 4, 2 * n);
  const L = m.L, e1 = conv(conv(x0, L.e1a), L.e1b), e2 = conv(conv(pool(e1), L.e2a), L.e2b), e3 = conv(conv(pool(e2), L.e3a), L.e3b), bt = conv(conv(pool(e3), L.ba), L.bb);
  const d3 = conv(conv(cat(up(bt), e3), L.d3a), L.d3b), d2 = conv(conv(cat(up(d3), e2), L.d2a), L.d2b), d1 = conv(conv(cat(up(d2), e1), L.d1a), L.d1b), o = conv(d1, L.out, false);
  const next = new Float32Array(n), heat = new Float32Array(n);
  for (let k = 0; k < n; k++) { next[k] = b[k] + o.d[k]; heat[k] = 1 / (1 + Math.exp(-o.d[n + k])); }
  return { next, heat, vx: o.d.slice(2 * n, 3 * n), vy: o.d.slice(3 * n, 4 * n) };
}

type Row = { n: number; x: number; y: number; isTarget: boolean; pm: { tot: number; etot: number; base: number } | null; gaia: { pmra: number | null; pmdec: number | null } | null };
type Api = { N: () => number; past: () => any; visits: () => { yr: number; img: Float32Array; n: number }[]; frames: () => any[]; tmYear: () => number; esc: (s: string) => string; report: () => { rows: Row[] } | null };
let year = 0, which: "a" | "b" | "p" | "s" | "d" = "p";
function draw(cv: HTMLCanvasElement, z: Float32Array, N: number, mode: "grey" | "heat" | "diff" = "grey") {
  cv.width = cv.height = N; const g = cv.getContext("2d")!, id = g.createImageData(N, N), d = id.data;
  for (let k = 0; k < N * N; k++) { const v = z[k];
    if (mode === "grey") { const t = Math.max(0, Math.min(1, v * 1.15 + 0.06)) * 255; d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = t; }
    else if (mode === "heat") { const t = Math.max(0, Math.min(1, v)); d[k * 4] = 255 * Math.min(1, t * 2); d[k * 4 + 1] = 160 * t * t; d[k * 4 + 2] = 40 * t; }
    else { const u = Math.max(-1, Math.min(1, v * 3)), q = Math.sqrt(Math.abs(u)); if (u >= 0) { d[k * 4] = 255 * q; d[k * 4 + 1] = 160 * q; d[k * 4 + 2] = 50 * q; } else { d[k * 4] = 40 * q; d[k * 4 + 1] = 150 * q; d[k * 4 + 2] = 255 * q; } }
    d[k * 4 + 3] = 255; }
  g.putImageData(id, 0, 0);
}

export async function renderWorldModel(el: HTMLElement, api: Api) {
  el.innerHTML = `<div class="bk-empty">Loading the model…</div>`;
  const m = await (model ??= load());
  if (!m) { model = null; el.innerHTML = `<div class="bk-empty">This server does not carry the world-model file (data/wm/model.json). It is built by census/wm_train.py and copied with the rest of the data.</div>`; return; }
  const N = api.N(), P = api.past(), V = api.visits().filter((v) => v.n >= 1), tm = P?.tm?.img as Float32Array | undefined, wise = P?.wise?.img as Float32Array | undefined, sx = V.length ? V[V.length - 1] : null;
  if (!tm || !wise) { el.innerHTML = `<div class="bk-empty">The model needs the 1999 and 2010 pictures of this field. ${P?.tm === null || P?.wise === null ? "One of them could not be read from NASA's archive for this place." : "They are still being read; this panel fills in when they arrive."}</div>`; return; }
  const t1 = api.tmYear(), t2 = 2010.5, t3 = sx ? sx.yr : 2026, A = norm(tm).z, B = norm(wise).z, S = sx ? norm(sx.img).z : null, mm = m.meta;
  const t0 = performance.now(), now = predict(m, A, B, N, (t3 - t2) / (t2 - t1)), ms = performance.now() - t0;
  // what the model did not expect: today's real picture minus its forecast for today (both on the same scale)
  const sur = S ? S.map((v, k) => v - now.next[k]) : null;
  // the sources the model says are moving: peaks of its map, with the motion it reads off for each (pixels a year, x to the right, y down)
  const peaks: { i: number; j: number; p: number; pm: number; dir: number; ux: number; uy: number }[] = [], px = PIX_ARCSEC, gap = t2 - t1;
  for (let j = 2; j < N - 2; j++) for (let i = 2; i < N - 2; i++) { const k = j * N + i, p = now.heat[k]; if (p < (mm.thr ?? 0.5)) continue; let top = true;
    for (let b = -2; b <= 2 && top; b++) for (let a = -2; a <= 2; a++) if (now.heat[(j + b) * N + i + a] > p) { top = false; break; }
    if (top) peaks.push({ i, j, p, pm: (Math.hypot(now.vx[k], now.vy[k]) * mm.vscale * px) / gap, dir: (Math.atan2(-now.vx[k], -now.vy[k]) * 180) / Math.PI, ux: (now.vx[k] * mm.vscale) / gap, uy: (now.vy[k] * mm.vscale) / gap }); }
  peaks.sort((a, b) => b.p - a.p); const top = peaks.slice(0, 4), y0 = Math.floor(t3), Y1 = Math.floor(t1); if (year < y0) year = y0;
  // what the Lab's own instruments measured for the same source: the row nearest to where the model puts it today
  const rows = api.report()?.rows ?? [], at = (q: (typeof top)[0], t: number) => [q.i + 0.5 + q.ux * (t - t2), q.j + 0.5 + q.uy * (t - t2)];
  const match = (q: (typeof top)[0]) => { const [x, y] = at(q, t3); let best: Row | null = null, bd = 5.5; for (const r of rows) { const d = Math.hypot(r.x - x, r.y - y); if (d < bd) { bd = d; best = r; } } return best; };
  const compass = (d: number) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((d + 360) % 360) / 45) % 8];
  const vs = top.map((q, n) => { const r = match(q), g = r?.gaia && r.gaia.pmra !== null && r.gaia.pmdec !== null ? Math.hypot(r.gaia.pmra, r.gaia.pmdec) : null, lab = r?.pm && r.pm.base > 5 ? r.pm.tot : null;
    return `<tr><td><i class="wm-n">${n + 1}</i></td><td><b>${q.pm.toFixed(q.pm < 1 ? 2 : 1)}″</b> ${compass(q.dir)}</td><td>${lab !== null ? `<b>${lab.toFixed(2)}″</b>${r!.isTarget ? " · your target" : ""}` : `<span class="dim">not measured</span>`}</td><td>${g !== null ? `${g.toFixed(2)}″` : "–"}</td></tr>`; }).join("");
  const STEPS: [typeof which, string][] = [["a", String(Y1)], ["b", "2010"], ["p", "Forecast"], ["s", sx ? String(y0) : "Today"], ["d", "Surprise"]];
  el.innerHTML = `<p class="bk-reading"><b>Sky model</b> It was shown this field in <b>${Y1}</b> and <b>2010</b> only. ${top.length ? `It says <b class="hl">${peaks.length} source${peaks.length > 1 ? "s" : ""} moved</b> and draws where ${peaks.length > 1 ? "they are" : "it is"} later.` : "It sees nothing moving here."}</p>
    <div class="wm-steps" id="wm-steps" role="tablist">${STEPS.map(([k, t]) => `<button role="tab" data-w="${k}">${t}</button>`).join("")}</div>
    <div class="wm-big"><canvas id="wm-big"></canvas><svg id="wm-ov" viewBox="0 0 ${N} ${N}" aria-hidden="true"></svg><span class="wm-mark" id="wm-ai" hidden></span></div>
    <p class="wm-cap" id="wm-capt"></p>
    <div class="wm-f"><span class="eyebrow">Forecast year</span><input type="range" id="wm-yr" min="${y0}" max="2080" step="1" value="${year}" aria-label="Year to forecast"><output id="wm-yo">${year}</output></div>
    ${top.length ? `<h3 class="bk-h sec">The model against the measurement</h3><table class="bk-table wm-vs"><thead><tr><th></th><th>model reads, a year</th><th>the Lab measured</th><th>Gaia</th></tr></thead><tbody>${vs}</tbody></table>` : ""}
    <p class="bk-cap show">The model only looks at pictures; the Lab measures. Tested on ${mm.test?.n ?? "—"} real movers it never saw: ${mm.test ? `${Math.round(100 * mm.test.recall)}% found, ${mm.test.fp_per_field.toFixed(2)} false marks per field` : "—"}. Runs in your browser in ${ms.toFixed(0)} ms. <a href="/docs/#worldmodel" target="_blank" rel="noopener">How it works</a></p>`;
  const big = el.querySelector("#wm-big") as HTMLCanvasElement, ov = el.querySelector("#wm-ov") as SVGElement, ai = el.querySelector("#wm-ai") as HTMLElement, capt = el.querySelector("#wm-capt") as HTMLElement;
  const zero = new Float32Array(N * N); let fut: Float32Array | null = null, futY = 0;
  const show = () => {
    if (which === "p" && year !== y0 && futY !== year) { fut = predict(m, A, B, N, (year - t2) / (t2 - t1)).next; futY = year; }
    const te = which === "a" ? t1 : which === "b" ? t2 : which === "p" ? (year === y0 ? t3 : year) : t3;
    if (which === "a") draw(big, A, N); else if (which === "b") draw(big, B, N); else if (which === "p") draw(big, year === y0 || !fut ? now.next : fut, N); else if (which === "s") draw(big, S ?? zero, N); else draw(big, sur ?? zero, N, "diff");
    ai.hidden = which !== "p" && which !== "d"; ai.textContent = which === "p" ? "AI-generated · prediction" : "model output";
    capt.innerHTML = which === "a" ? `<b>${Y1}</b> NASA 2MASS, real picture` : which === "b" ? `<b>2010</b> NASA WISE, real picture` : which === "p" ? `<b>${Math.floor(te)}</b> drawn by the model from its two pictures, ${Y1} and 2010`
      : which === "s" ? (sx ? `<b>${y0}</b> NASA SPHEREx, real picture: compare with the forecast` : "Not observed yet") : `<b>Surprise</b> the real ${y0} picture minus the forecast: orange is brighter than expected, blue fainter`;
    // each marked source: its path from the first picture to the forecast, and a ring where the model puts it on the date shown
    ov.innerHTML = top.map((q, n) => { const [xa, ya] = at(q, t1), [xb, yb] = at(q, Math.max(t3, te)), [x, y] = at(q, te);
      return `<line x1="${xa.toFixed(2)}" y1="${ya.toFixed(2)}" x2="${xb.toFixed(2)}" y2="${yb.toFixed(2)}"/><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(N / 26).toFixed(2)}"/><text x="${(x + N / 20).toFixed(2)}" y="${(y - N / 28).toFixed(2)}" font-size="${(N / 17).toFixed(2)}">${n + 1}</text>`; }).join("");
    el.querySelectorAll<HTMLButtonElement>("#wm-steps button").forEach((b) => b.classList.toggle("on", b.dataset.w === which));
  };
  el.querySelectorAll<HTMLButtonElement>("#wm-steps button").forEach((b) => (b.onclick = () => { which = b.dataset.w as typeof which; show(); }));
  let tmr = 0; (el.querySelector("#wm-yr") as HTMLInputElement).oninput = (e) => { year = +(e.target as HTMLInputElement).value; (el.querySelector("#wm-yo") as HTMLElement).textContent = String(year); which = "p"; clearTimeout(tmr); tmr = window.setTimeout(show, 40); };
  show();
}
