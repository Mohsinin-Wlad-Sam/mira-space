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

type Api = { N: () => number; past: () => any; visits: () => { yr: number; img: Float32Array; n: number }[]; frames: () => any[]; tmYear: () => number; esc: (s: string) => string };
let year = 2050;
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
  // the sources the model says are moving: peaks of its map, with the motion it reads off for each
  const peaks: { i: number; j: number; p: number; pm: number; dir: number }[] = [], px = PIX_ARCSEC, gap = t2 - t1;
  for (let j = 2; j < N - 2; j++) for (let i = 2; i < N - 2; i++) { const k = j * N + i, p = now.heat[k]; if (p < (mm.thr ?? 0.5)) continue; let top = true;
    for (let b = -2; b <= 2 && top; b++) for (let a = -2; a <= 2; a++) if (now.heat[(j + b) * N + i + a] > p) { top = false; break; }
    if (top) peaks.push({ i, j, p, pm: (Math.hypot(now.vx[k], now.vy[k]) * mm.vscale * px) / gap, dir: (Math.atan2(-now.vx[k], -now.vy[k]) * 180) / Math.PI }); }
  peaks.sort((a, b) => b.p - a.p);
  el.innerHTML = `<p class="bk-reading"><b>World model</b> A network that was shown pairs of real pictures of the sky taken years apart and trained to draw the next one. Here it reads this field's <b>${t1.toFixed(0)}</b> and <b>2010</b> pictures and draws ${sx ? `<b>${t3.toFixed(1)}</b>, which SPHEREx then really observed` : "the present"}. ${peaks.length ? `It marks <b class="hl">${peaks.length} moving source${peaks.length > 1 ? "s" : ""}</b>${peaks[0] ? `, the clearest at about <b>${peaks[0].pm.toFixed(peaks[0].pm < 1 ? 2 : 1)}″ per year</b>` : ""}.` : "It sees nothing moving here."}</p>
    <div class="wm-grid">
      <figure><canvas id="wm-a"></canvas><figcaption><b>${t1.toFixed(0)} · 2MASS</b>real picture, 2.2 µm</figcaption></figure>
      <figure><canvas id="wm-b"></canvas><figcaption><b>2010 · WISE</b>real picture, 4.6 µm</figcaption></figure>
      <figure><canvas id="wm-h"></canvas><span class="wm-mark">model output</span><figcaption><b>What it says moved</b>its motion map, 0 to 1</figcaption></figure>
      <figure><canvas id="wm-p"></canvas><span class="wm-mark">AI-generated · prediction</span><figcaption><b>${t3.toFixed(1)} · forecast</b>drawn by the model</figcaption></figure>
      <figure><canvas id="wm-s"></canvas><figcaption><b>${sx ? `${t3.toFixed(1)} · SPHEREx` : "today"}</b>${sx ? "real picture, 0.75–5 µm" : "not observed yet"}</figcaption></figure>
      <figure><canvas id="wm-d"></canvas><span class="wm-mark">model output</span><figcaption><b>Surprise</b>real minus forecast</figcaption></figure>
    </div>
    <h3 class="bk-h sec">Forecast another year</h3>
    <div class="wm-f"><input type="range" id="wm-yr" min="2027" max="2080" step="1" value="${year}"><output id="wm-yo">${year}</output></div>
    <div class="wm-grid wm-fut"><figure><canvas id="wm-f"></canvas><span class="wm-mark">AI-generated · prediction</span><figcaption><b id="wm-fc">${year} · forecast</b>drawn by the model</figcaption></figure>
      <div>${peaks.length ? `<div class="bk-tw"><table class="bk-table num"><thead><tr><th>source at (x, y)</th><th>model's motion (″/yr)</th><th>toward</th><th>confidence</th></tr></thead><tbody>${peaks.slice(0, 6).map((p) => `<tr><td>${p.i}, ${p.j}</td><td>${p.pm.toFixed(2)}</td><td>${["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((p.dir + 360) % 360) / 45) % 8]}</td><td>${(p.p * 100).toFixed(0)}%</td></tr>`).join("")}</tbody></table></div>` : `<p class="bk-cap show">No source passes the model's mark in this field.</p>`}</div></div>
      <p class="bk-cap show">Checked on ${mm.test?.n ?? "—"} real fast movers it never saw in training: it found ${mm.test ? `${Math.round(100 * mm.test.recall)}% of them (${(mm.test.by_pm ?? []).filter((b: any) => b.n).map((b: any) => `${Math.round(100 * b.recall)}% at ${b.hi > 50 ? `over ${b.lo}` : `${b.lo}–${b.hi}`}″/yr`).join(", ")}), with ${mm.test.fp_per_field.toFixed(2)} false marks per field, and read their motion to ${mm.test.pm_err_median.toFixed(2)}″ per year (median)` : "—"}. ${api.esc(mm.thr_note ?? "")} Compare with the Motion detector and the Astrometer, which measure; this one only looks.</p>
    <p class="bk-cap show"><b>What this is.</b> ${api.esc(mm.about ?? "")} Run here in ${ms.toFixed(0)} ms in your browser (${(mm.params / 1e6).toFixed(2)} million weights, ${(mm.bytes / 1e6).toFixed(1)} MB). <b>What it is not:</b> a measurement. A forecast is a drawing by a network; it can be wrong, it knows nothing the two pictures do not show, and far extrapolations blur. The "surprise" picture also lights up for reasons that are not motion: the three surveys looked at different colours of light.</p>`;
  const cv = (s: string) => el.querySelector(s) as HTMLCanvasElement;
  draw(cv("#wm-a"), A, N); draw(cv("#wm-b"), B, N); draw(cv("#wm-h"), now.heat, N, "heat"); draw(cv("#wm-p"), now.next, N); if (S) draw(cv("#wm-s"), S, N); else draw(cv("#wm-s"), new Float32Array(N * N), N); if (sur) draw(cv("#wm-d"), sur, N, "diff"); else draw(cv("#wm-d"), new Float32Array(N * N), N, "diff");
  const fut = () => { const f = predict(m, A, B, N, (year - t2) / (t2 - t1)); draw(cv("#wm-f"), f.next, N); };
  fut(); let tmr = 0;
  (el.querySelector("#wm-yr") as HTMLInputElement).oninput = (e) => { year = +(e.target as HTMLInputElement).value; (el.querySelector("#wm-yo") as HTMLElement).textContent = String(year); (el.querySelector("#wm-fc") as HTMLElement).textContent = `${year} · forecast`; clearTimeout(tmr); tmr = window.setTimeout(fut, 60); };
}
