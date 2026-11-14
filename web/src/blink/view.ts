// BLINK — the SPHEREx time-domain workstation. Enter a position, get a little movie of every SPHEREx pass over it,
// sky-registered so that anything that moves or changes stands out, with the spectrum, light curve and motion of any
// source measured on the fly from the same exposures.
import "./blink.css";
import { sexa } from "../data";
import {
  build, readMask, propagate, skyToStamp, stampToSky, flagNames, badMask, indexMeta, labelVisits, mjdToDate, mjdToYear,
  DETECTORS, FLAG_DEFS, INFO_FLAGS, PIX_ARCSEC, type Frame, type Target, type IndexMeta,
} from "./engine";
import { spectrum, haloSeries, binSpectrum, lightCurve, fitMotion, PLX_SYS, type Phot, type LightCurve, type Motion } from "./measure";
import { gaia, allwise, twomass, catPos, magToMjy, angSep, BANDS, CHALLENGE, parseCoords, resolveName, knownMoverNear, type CatSource } from "./catalogs";
import { drawSpectrum, drawLightCurve, drawMotion, detColor, lamColor } from "./plots";

export type BlinkTarget = Target & { plx?: number; otype?: string; sptype?: string; source?: string; key?: string; note?: string };
export type BlinkOpts = { embed?: boolean; toast?: (m: string) => void; onState?: (p: URLSearchParams) => void; onAtlas?: (ra: number, dec: number) => void };
type Mode = "time" | "lambda" | "stack" | "rgb" | "diff";
type Tab = "spectrum" | "light" | "motion" | "frame" | "share";
type Item = { kind: "frame" | "stack" | "rgb" | "diff"; key: string; mjd: number; f?: Frame; list?: Frame[]; ref?: Frame[]; label?: string };
type Probe = { dx: number; dy: number; follow: boolean };
type TwoMass = CatSource & { j: number; h: number; k: number };

const SIZES = [32, 64, 96, 128], BUDGETS = [36, 72, 144];
const MODES: { k: Mode; t: string; d: string }[] = [
  { k: "time", t: "Movie", d: "Every exposure in time order, pinned to the sky. A source that drifts from frame to frame is moving; one that appears once is a transient, an asteroid or an artifact. Each exposure sees the sky at a different wavelength (tick colour), so brightness flickers even for a steady star." },
  { k: "lambda", t: "Spectral sweep", d: "The same exposures re-ordered from blue (0.75 µm) to red (5 µm): the movie is now the object's spectrum. Cold worlds fade out near 3.3 µm where methane absorbs, and blaze at 4–5 µm." },
  { k: "stack", t: "Deep stack", d: "All exposures of one visit added together (weighted by noise) for a deeper image; step through the visits to blink them. With “Follow target” on, the stack is made along the target's motion — shift-and-add — which reveals movers too faint for single exposures." },
  { k: "rgb", t: "Colour", d: "SPHEREx's six detectors folded into one colour image per visit: blue = 0.75–1.6 µm, green = 1.6–3.8 µm, red = 3.8–5 µm. Ordinary stars look blue-white; cold brown dwarfs and dusty objects are red." },
  { k: "diff", t: "Difference", d: "Each visit minus the first. What does not change cancels to black; a moving object leaves a blue hole where it was and an orange spot where it went; a brightening source turns orange." },
];
const MAGMA = [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]];
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
const yearToMjd = (y: number) => 51544.5 + (y - 2000) * 365.25;
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const fmtPm = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(Math.abs(v) < 1 ? 3 : 2)}`;

function levels(img: Float32Array, pct: number): [number, number] {
  const v: number[] = [], step = Math.max(1, Math.floor(img.length / 4096));
  for (let k = 0; k < img.length; k += step) if (Number.isFinite(img[k])) v.push(img[k]);
  if (v.length < 8) return [0, 1];
  v.sort((a, b) => a - b);
  const med = v[v.length >> 1], sig = Math.max(med - v[Math.floor(v.length * 0.16)], 1e-6), hi = v[Math.min(v.length - 1, Math.floor((v.length * pct) / 100))];
  return [med - 1.5 * sig, Math.max(hi, med + 6 * sig)];
}
function shiftImage(src: Float32Array, N: number, sx: number, sy: number): Float32Array {
  const out = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i + sx, y = j + sy, i0 = Math.floor(x), j0 = Math.floor(y);
    if (i0 < 0 || j0 < 0 || i0 >= N - 1 || j0 >= N - 1) { out[j * N + i] = NaN; continue; }
    const u = x - i0, v = y - j0, q = j0 * N + i0;
    out[j * N + i] = src[q] * (1 - u) * (1 - v) + src[q + 1] * u * (1 - v) + src[q + N] * (1 - u) * v + src[q + N + 1] * u * v;
  }
  return out;
}

export function mountBlink(host: HTMLElement, opts: BlinkOpts = {}) {
  host.classList.toggle("embed", !!opts.embed);
  host.innerHTML = `
  <div class="bk">
    <div class="bk-bar">
      <form class="bk-go" id="bk-go">
        <label for="bk-q">Sky position</label>
        <input id="bk-q" placeholder="RA Dec — 17 57 48.5 +04 41 36 · 269.452 4.693 — or a name" autocomplete="off" spellcheck="false" enterkeyhint="go">
        <button class="btn sm" type="submit">Blink</button>
      </form>
      <div class="bk-chips"><span class="eyebrow">Challenge targets</span>${CHALLENGE.map((t) => `<button class="chip" data-key="${t.key}" title="${esc(t.blurb)}">${esc(t.name)}</button>`).join("")}</div>
    </div>
    <div class="bk-start" id="bk-start">
      <div class="eyebrow">NASA SPHEREx · 102 infrared colours · every pass over the sky since 2025</div>
      <h2 class="display">Watch the sky move</h2>
      <p>Enter any position. MIRA finds every SPHEREx exposure that covers it, reads the pixels straight from NASA's archive, lines them up on the sky and plays them as a movie — then measures the spectrum, the light curve and the motion of anything you click.</p>
      <div class="bk-cards">${CHALLENGE.map((t, k) => `<button class="bk-card" data-key="${t.key}"><span class="n">0${k + 1} · ${esc(t.otype ?? "")}</span><h3>${esc(t.name ?? "")}</h3><span class="b">${esc(t.blurb)}</span><span class="t">${esc(t.test)}</span><span class="go">Blink it →</span></button>`).join("")}</div>
      <div class="bk-how">
        <div><b>Straight from NASA</b>No copies, no server: your browser reads only the few image rows it needs from each 65 MB exposure in NASA's public SPHEREx archive at IRSA.</div>
        <div><b>Lined up on the sky</b>SPHEREx rolls between passes. Every frame is re-projected north-up onto the same patch of sky, so what moves is the sky's doing, not the telescope's.</div>
        <div><b>Measured, not just shown</b>Each exposure sees a different wavelength. MIRA turns that into a spectrum on the fly, and tells real change from colour flicker.</div>
      </div>
    </div>
    <div class="bk-body" id="bk-body" hidden>
      <section class="bk-main">
        <div class="bk-modes" role="tablist">${MODES.map((m, k) => `<button role="tab" data-m="${m.k}" title="Key ${k + 1}">${m.t}</button>`).join("")}</div>
        <div class="bk-stage" id="bk-stage">
          <canvas id="bk-cv" aria-label="SPHEREx frames of this position"></canvas>
          <div class="bk-hud tl" id="bk-hud"></div>
          <div class="bk-hud tr" id="bk-flags"></div>
          <div class="bk-hud bl mono" id="bk-read"></div>
          <div class="bk-load" id="bk-load"></div>
        </div>
        <div class="bk-transport">
          <button class="icon-btn" id="bk-prev" aria-label="Previous frame" title="← previous">‹</button>
          <button class="icon-btn" id="bk-play" aria-label="Play or pause" title="Space"></button>
          <button class="icon-btn" id="bk-next" aria-label="Next frame" title="→ next">›</button>
          <canvas class="bk-strip" id="bk-strip" height="46"></canvas>
          <select id="bk-fps" aria-label="Playback speed"><option value="2">2 fps</option><option value="4">4 fps</option><option value="6" selected>6 fps</option><option value="10">10 fps</option><option value="16">16 fps</option></select>
        </div>
        <div class="bk-tools">
          <div class="bk-dets" id="bk-dets" title="Which of SPHEREx's six detectors to show (shift-click: only this one)">${DETECTORS.map((d) => `<button data-d="${d.det}" style="--c:${detColor(d.det)}" title="Detector ${d.det}: ${d.lo}–${d.hi} µm"><i></i>${d.lo.toFixed(d.lo < 1 ? 2 : 1)}–${d.hi.toFixed(1)}</button>`).join("")}</div>
          <div class="bk-toggles" id="bk-toggles">
            <button data-v="track" title="Keep the target centred: shift-and-add in Deep stack (T)">Follow target</button><button data-v="gaia" title="Gaia DR3 stars, moved to each frame's date (G)">Gaia</button>
            <button data-v="wise" title="AllWISE sources where NASA's WISE saw them in 2010: a mover has left its marker behind (W)">WISE 2010</button><button data-v="mask" title="Paint NASA's contamination flags for this exposure (M)">Flags</button>
            <button data-v="lock" title="One brightness scale for all frames (L)">Lock scale</button><button data-v="smooth" title="Interpolate between pixels">Smooth</button>
            <select id="bk-cmap" aria-label="Colour map"><option value="gray">Grey</option><option value="heat">Heat</option><option value="invert">Inverted</option></select>
          </div>
        </div>
        <p class="bk-explain" id="bk-explain"></p>
      </section>
      <aside class="bk-side">
        <div class="bk-target" id="bk-target"></div>
        <div class="bk-setup">
          <div class="bk-row"><span class="eyebrow">Field</span><div class="seg" id="bk-fov">${SIZES.map((s) => `<button data-s="${s}" title="${s} × ${s} SPHEREx pixels">${((s * PIX_ARCSEC) / 60).toFixed(1)}′</button>`).join("")}</div>
            <span class="eyebrow">Exposures</span><div class="seg" id="bk-n">${BUDGETS.map((b) => `<button data-n="${b}">${b === 144 ? "All" : b}</button>`).join("")}</div></div>
          <div class="bk-cost mono" id="bk-cost"></div>
        </div>
        <div class="bk-tabs" role="tablist"><button data-t="spectrum">Spectrum</button><button data-t="light">Light curve</button><button data-t="motion">Motion</button><button data-t="frame">Exposure</button><button data-t="share">Share</button></div>
        <div class="bk-panel" id="bk-panel"></div>
      </aside>
    </div>
  </div>`;
  const $ = <T extends HTMLElement>(s: string) => host.querySelector(s) as T;
  const cv = $<HTMLCanvasElement>("#bk-cv"), ctx = cv.getContext("2d")!, off = document.createElement("canvas"), strip = $<HTMLCanvasElement>("#bk-strip");
  const toast = (m: string) => opts.toast?.(m);

  // ------------------------------------------------------------ state
  let target: BlinkTarget = { ra: 0, dec: 0 }, N = 32, maxFrames = 72, center: [number, number] = [0, 0];
  let frames: Frame[] = [], gen = 0, ac: AbortController | null = null, building = false, failed = 0, opened = false;
  let plan: { covered: number; picked: number; listed: number; mbytes: number } | null = null, meta: IndexMeta | null = null, errorMsg = "";
  let mode: Mode = "time", dets = new Set([1, 2, 3, 4, 5, 6]), idx = 0, playing = true, fps = 6, timer = 0;
  const view = { track: false, gaia: false, wise: false, mask: false, smooth: false, cmap: "gray", pct: 99.5 };
  const lock: Record<Mode, boolean> = { time: false, lambda: true, stack: false, rgb: false, diff: false };
  let probe: Probe = { dx: 0, dy: 0, follow: true }, tab: Tab = "spectrum", logSpec = false;
  const cat = { gaia: [] as CatSource[], wise: [] as CatSource[], tm: [] as TwoMass[], state: "idle" as "idle" | "loading" | "ok" | "fail" };
  let items: Item[] = [], itemsKey = "";
  const imgCache = new Map<string, Float32Array | Float32Array[]>(), lockCache = new Map<string, [number, number]>(), maskCache = new Map<Frame, Int32Array | null | "loading">();
  let shiftCache = new WeakMap<Frame, Float32Array>();
  let analysis: { P: Phot[]; bins: ReturnType<typeof binSpectrum>; lc: LightCurve; halo: boolean; motion: Motion | null; motionFlagged: boolean; nFlagged: number; nSat: number } | null = null;
  let refreshT = 0, analyzeT = 0, hover: { i: number; j: number } | null = null;
  const c = () => (N - 1) / 2;
  const targetXY = (mjd: number): [number, number] => { const [ra, dec] = propagate(target, mjd); return skyToStamp(center[0], center[1], N, ra, dec); };
  const hasPm = () => Math.hypot(target.pmra ?? 0, target.pmdec ?? 0) > 0.02;
  const detsKey = () => [...dets].sort().join("");

  // ------------------------------------------------------------ open / build
  function open(t: BlinkTarget, o: { size?: number; frames?: number; mode?: Mode; tab?: Tab } = {}) {
    opened = true; target = { ...t }; probe = { dx: 0, dy: 0, follow: true };
    N = o.size && SIZES.includes(o.size) ? o.size : N; maxFrames = o.frames ?? maxFrames;
    dets = new Set([1, 2, 3, 4, 5, 6]); view.track = false; mode = o.mode ?? "time"; tab = o.tab ?? "spectrum";
    if (t.key === "wise-0855") { dets = new Set([5, 6]); view.track = true; mode = o.mode ?? "stack"; }   // only visible at 4–5 µm, and only when stacked
    ($("#bk-q") as HTMLInputElement).value = t.name ?? `${t.ra.toFixed(5)} ${t.dec >= 0 ? "+" : ""}${t.dec.toFixed(5)}`;
    start();
  }
  async function start() {
    ac?.abort(); ac = new AbortController(); const my = ++gen;
    frames = []; items = []; itemsKey = ""; imgCache.clear(); lockCache.clear(); maskCache.clear(); shiftCache = new WeakMap(); analysis = null; plan = null; failed = 0; errorMsg = "";
    idx = 0; building = true; playing = true; cat.gaia = []; cat.wise = []; cat.tm = []; cat.state = "idle"; center = [target.ra, target.dec];
    syncControls(); renderTarget(); renderPanel(); paint(); setLoad("Finding the SPHEREx exposures that cover this position…", 0);
    pushState(); indexMeta().then((m) => { meta = m; if (my === gen) renderTarget(); });
    try {
      const b = await build(target, {
        size: N, maxFrames, signal: ac.signal, concurrency: 6,
        onPlan: (p) => { if (my !== gen) return; plan = p; center = p.center; renderTarget(); loadCatalogs(my);
          setLoad(p.picked ? `Reading ${p.picked} of ${p.covered} exposures from NASA's archive` : "", 0); },
        onFrame: (f, done, total) => { if (my !== gen) return; const k = frames.findIndex((g) => g.mjd > f.mjd); if (k < 0) frames.push(f); else frames.splice(k, 0, f);
          labelVisits(frames); setLoad(`Reading exposures from NASA's archive · ${done} / ${total}`, done / total); scheduleRefresh(); },
        onSkip: (done, total) => { if (my === gen) setLoad(`Reading exposures from NASA's archive · ${done} / ${total}`, done / total); },
      });
      if (my !== gen) return;
      frames = b.frames; failed = b.failed; building = false; setLoad("", 1);
      if (!frames.length) errorMsg = b.covered ? "The exposures that cover this position could not be read just now. NASA's archive may be busy — try again in a moment."
        : b.listed ? "SPHEREx has not observed this exact position yet in the indexed releases (it falls in a gap between detector footprints)." : "No SPHEREx exposures are indexed for this part of the sky yet.";
      refresh(); analyze();
    } catch (e) {
      if ((e as Error).name === "AbortError" || my !== gen) return;
      building = false; errorMsg = `Could not build the movie: ${(e as Error).message}.`; setLoad("", 1); refresh(); renderPanel();
    }
  }
  function loadCatalogs(my: number) {
    cat.state = "loading"; const r = (N * PIX_ARCSEC) / 2 * 1.45, [ra, dec] = center, pm = Math.hypot(target.pmra ?? 0, target.pmdec ?? 0);
    const wide = r + pm * 30;                                      // catalogue epochs reach back to 1998: include where a mover was
    Promise.allSettled([gaia(ra, dec, r + pm * 12), allwise(ra, dec, r + pm * 18), twomass(ra, dec, wide)]).then(([g, w, t]) => {
      if (my !== gen) return;
      if (g.status === "fulfilled") cat.gaia = g.value; if (w.status === "fulfilled") cat.wise = w.value; if (t.status === "fulfilled") cat.tm = t.value as TwoMass[];
      cat.state = g.status === "fulfilled" || w.status === "fulfilled" ? "ok" : "fail"; paint(); renderPanel();
    });
  }
  function setLoad(msg: string, frac: number) {
    const el = $("#bk-load"); el.classList.toggle("on", !!msg);
    el.innerHTML = msg ? `<div class="bk-load-bar"><i style="width:${Math.max(2, frac * 100)}%"></i></div><span>${esc(msg)}</span>` : "";
    el.classList.toggle("over", !frames.length);
  }
  function scheduleRefresh() {
    if (!refreshT) refreshT = window.setTimeout(() => { refreshT = 0; refresh(); }, 220);
    if (!analyzeT) analyzeT = window.setTimeout(() => { analyzeT = 0; analyze(); }, 900);
  }

  // ------------------------------------------------------------ items (what the movie steps through)
  function buildItems(): Item[] {
    const fs = frames.filter((f) => dets.has(f.det));
    if (mode === "time") return fs.map((f) => ({ kind: "frame", key: f.exp.id, f, mjd: f.mjd }));
    if (mode === "lambda") return [...fs].sort((a, b) => a.lam - b.lam).map((f) => ({ kind: "frame", key: f.exp.id, f, mjd: f.mjd }));
    const visits = new Map<number, Frame[]>(); fs.forEach((f) => (visits.get(f.visit) ?? visits.set(f.visit, []).get(f.visit)!).push(f));
    const V = [...visits.entries()].sort((a, b) => a[0] - b[0]).map(([, L]) => L), mean = (L: Frame[]) => L.reduce((s, f) => s + f.mjd, 0) / L.length;
    const tag = `${detsKey()}|${view.track ? 1 : 0}`;
    if (mode === "diff") return V.slice(1).map((L, k) => ({ kind: "diff" as const, key: `d${k}|${tag}|${L.length}|${V[0].length}`, list: L, ref: V[0], mjd: mean(L), label: `Visit ${k + 2} minus visit 1` }));
    const kind = mode === "rgb" ? ("rgb" as const) : ("stack" as const);
    const out: Item[] = V.map((L, k) => ({ kind, key: `${kind}${k}|${tag}|${L.length}`, list: L, mjd: mean(L), label: `Visit ${k + 1} of ${V.length}` }));
    if (V.length > 1) out.push({ kind, key: `${kind}all|${tag}|${fs.length}`, list: fs, mjd: mean(fs), label: `All ${V.length} visits` });
    return out;
  }
  const shifted = (f: Frame) => { if (!view.track) return f.img; let s = shiftCache.get(f); if (!s) { s = shiftImage(f.img, N, f.tx - c(), f.ty - c()); shiftCache.set(f, s); } return s; };
  /** robust co-add: per pixel, the brightest values are discarded before averaging (20% with 5+ frames, the single
   *  maximum with 3–4), so a cosmic ray, ghost or passing asteroid in one exposure does not print through the stack */
  function stack(list: Frame[]): Float32Array {
    const out = new Float32Array(N * N), imgs = list.map(shifted), n = imgs.length, v = new Float64Array(n);
    for (let k = 0; k < out.length; k++) {
      let m = 0; for (let q = 0; q < n; q++) { const x = imgs[q][k]; if (Number.isFinite(x)) v[m++] = x; }
      if (!m) { out[k] = NaN; continue; }
      const a = v.subarray(0, m).sort(), hi = m >= 5 ? m - Math.ceil(m * 0.2) : m >= 3 ? m - 1 : m, lo = m >= 10 ? Math.floor(m * 0.1) : 0;
      let sum = 0; for (let q = lo; q < hi; q++) sum += a[q];
      out[k] = sum / (hi - lo);
    }
    return out;
  }
  function imageOf(it: Item): Float32Array | Float32Array[] {
    if (it.kind === "frame") return shifted(it.f!);
    let v = imgCache.get(it.key); if (v) return v;
    if (it.kind === "stack") v = stack(it.list!);
    else if (it.kind === "diff") { const a = stack(it.list!), b = stack(it.ref!); v = a.map((x, k) => x - b[k]); }
    else v = [[5, 6], [3, 4], [1, 2]].map((g) => stack(it.list!.filter((f) => g.includes(f.det))));
    if (imgCache.size > 60) imgCache.clear();
    imgCache.set(it.key, v); return v;
  }
  function levelsFor(it: Item, img: Float32Array): [number, number] {
    if (!lock[mode] || it.kind !== "frame") return levels(img, view.pct);
    const key = `${mode}|${detsKey()}|${view.track}|${items.length}|${view.pct}`; let L = lockCache.get(key);
    if (!L) { const step = Math.max(1, Math.floor(items.length / 40)), lo: number[] = [], hi: number[] = [];
      for (let k = 0; k < items.length; k += step) { const [a, b] = levels(shifted(items[k].f!), view.pct); lo.push(a); hi.push(b); }
      hi.sort((a, b) => a - b); L = [median(lo), hi[Math.floor(hi.length * 0.85)] ?? 1]; lockCache.clear(); lockCache.set(key, L); }
    return L;
  }

  // ------------------------------------------------------------ drawing
  function fit() {
    const st = $("#bk-stage"), w = st.clientWidth; if (!w) return;
    const px = Math.max(N, Math.round((w * Math.min(devicePixelRatio || 1, 2)) / N) * N);
    if (cv.width !== px) { cv.width = px; cv.height = px; }
  }
  function tone(t: number): [number, number, number] {
    t = Math.min(1, Math.max(0, t));
    if (view.cmap === "gray") { const v = 255 * t; return [v, v, v * 1.02]; }
    if (view.cmap === "invert") { const v = 255 * (1 - t); return [v, v, v]; }
    const x = t * (MAGMA.length - 1), i = Math.min(MAGMA.length - 2, Math.floor(x)), f = x - i, a = MAGMA[i], b = MAGMA[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  const asinhT = (v: number, lo: number, hi: number) => Math.asinh((Math.max(0, v - lo) / Math.max(hi - lo, 1e-9)) * 10) / Math.asinh(10);
  function paint() {
    fit(); const it = items[idx], W = cv.width;
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, W);
    if (!it) { hud(null); drawStrip(); return; }
    const img = imageOf(it), id = new ImageData(N, N), d = id.data;
    if (it.kind === "rgb") {
      const ch = img as Float32Array[], lv = ch.map((x) => levels(x, 99.7));
      for (let k = 0; k < N * N; k++) { for (let q = 0; q < 3; q++) { const v = ch[q][k]; d[k * 4 + q] = Number.isFinite(v) ? 255 * asinhT(v, lv[q][0], lv[q][1]) : 0; } d[k * 4 + 3] = 255; }
    } else if (it.kind === "diff") {
      const a = img as Float32Array, abs: number[] = []; for (let k = 0; k < a.length; k += 2) if (Number.isFinite(a[k])) abs.push(Math.abs(a[k]));
      abs.sort((x, y) => x - y); const m = abs[Math.floor(abs.length * 0.995)] || 1;
      for (let k = 0; k < N * N; k++) { const v = a[k]; if (!Number.isFinite(v)) { d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = 18; d[k * 4 + 3] = 255; continue; }
        const u = Math.max(-1, Math.min(1, v / m)), q = Math.sqrt(Math.abs(u));
        if (u >= 0) { d[k * 4] = 255 * q; d[k * 4 + 1] = 160 * q; d[k * 4 + 2] = 50 * q; } else { d[k * 4] = 40 * q; d[k * 4 + 1] = 150 * q; d[k * 4 + 2] = 255 * q; }
        d[k * 4 + 3] = 255; }
    } else {
      const a = img as Float32Array, [lo, hi] = levelsFor(it, a);
      for (let k = 0; k < N * N; k++) { const v = a[k];
        if (!Number.isFinite(v)) { d[k * 4] = 22; d[k * 4 + 1] = 22; d[k * 4 + 2] = 28; d[k * 4 + 3] = 255; continue; }
        const [r, g, b] = tone(asinhT(v, lo, hi)); d[k * 4] = r; d[k * 4 + 1] = g; d[k * 4 + 2] = b; d[k * 4 + 3] = 255; }
    }
    off.width = N; off.height = N; off.getContext("2d")!.putImageData(id, 0, 0);
    ctx.imageSmoothingEnabled = view.smooth; ctx.imageSmoothingQuality = "high"; ctx.drawImage(off, 0, 0, W, W);
    overlays(it); hud(it); drawStrip(); markCurrent();
    if (tab === "frame") renderPanel();
  }
  /** display offset of the sky-fixed stamp when the view follows the target */
  function shiftOf(it: Item): [number, number] {
    if (!view.track) return [0, 0];
    const [tx, ty] = it.f ? [it.f.tx, it.f.ty] : targetXY(it.mjd); return [c() - tx, c() - ty];
  }
  function overlays(it: Item) {
    const W = cv.width, s = W / N, [ox, oy] = shiftOf(it), year = mjdToYear(it.mjd), u = W / 640;
    const P = (x: number, y: number): [number, number] => [(x + ox + 0.5) * s, (y + oy + 0.5) * s];
    const inside = (x: number, y: number) => x > -4 && y > -4 && x < W + 4 && y < W + 4;
    ctx.lineWidth = 1.4 * u; ctx.font = `${11 * u}px "JetBrains Mono", monospace`; ctx.textBaseline = "middle";
    // contamination flags of this exposure
    if (view.mask && it.f) {
      const m = maskCache.get(it.f);
      if (m === undefined) { maskCache.set(it.f, "loading"); const f = it.f, my = gen; readMask(f, N, ac?.signal).then((r) => { if (my !== gen) return; maskCache.set(f, r); if (items[idx]?.f === f) paint(); }).catch(() => maskCache.set(f, null)); }
      else if (m && m !== "loading") { const bad = badMask(); ctx.fillStyle = "rgba(255,70,90,.5)";
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (m[j * N + i] & bad) ctx.fillRect((i + ox) * s, (j + oy) * s, s, s); }
    }
    if (view.wise) { ctx.strokeStyle = "rgba(255,186,92,.95)";
      let shownW = 0;
      for (const w of cat.wise) { const [ra, dec] = catPos(w, year), [x, y] = P(...skyToStamp(center[0], center[1], N, ra, dec)); if (!inside(x, y) || ++shownW > 90) continue;
        const r = 6 * u; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.stroke(); } }
    if (view.gaia) { ctx.strokeStyle = "rgba(120,220,255,.95)"; ctx.fillStyle = "rgba(120,220,255,.95)";
      let shown = 0;
      for (const g of cat.gaia) { const [ra, dec] = catPos(g, year), [x, y] = P(...skyToStamp(center[0], center[1], N, ra, dec)); if (!inside(x, y) || ++shown > 90) continue;
        const r = Math.max(3.2, Math.min(10, 10 - 0.55 * ((g.mag ?? 18) - 8))) * u; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
        const pm = Math.hypot(g.pmra, g.pmdec);
        if (pm > 0.15) { const k = (5 / PIX_ARCSEC) * s, x2 = x - g.pmra * k, y2 = y - g.pmdec * k;        // where it will be in five years
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke(); ctx.fillText(`${pm.toFixed(1)}″/yr`, x + r + 4 * u, y - r); } } }
    // target reticle (predicted position at this frame's date) and the clicked probe
    const [tx, ty] = it.f ? [it.f.tx, it.f.ty] : targetXY(it.mjd), [rx, ry] = P(tx, ty);
    ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 1.6 * u;
    for (const [a, b, e, f] of [[-26, 0, -11, 0], [11, 0, 26, 0], [0, -26, 0, -11], [0, 11, 0, 26]]) { ctx.beginPath(); ctx.moveTo(rx + a * u, ry + b * u); ctx.lineTo(rx + e * u, ry + f * u); ctx.stroke(); }
    if (!probe.follow) { const [px, py] = P(c() + probe.dx, c() + probe.dy), q = 12 * u; ctx.strokeStyle = "#7df0a6"; ctx.strokeRect(px - q, py - q, 2 * q, 2 * q); }
    // compass and scale bar
    const bar = (60 / PIX_ARCSEC) * s * (N > 80 ? 2 : N < 40 ? 0.5 : 1), bx = W - 18 * u, by = W - 18 * u;
    ctx.strokeStyle = ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 1.4 * u;
    ctx.beginPath(); ctx.moveTo(bx - bar, by); ctx.lineTo(bx, by); ctx.moveTo(bx - bar, by - 4 * u); ctx.lineTo(bx - bar, by + 4 * u); ctx.moveTo(bx, by - 4 * u); ctx.lineTo(bx, by + 4 * u); ctx.stroke();
    ctx.textAlign = "right"; ctx.fillText(N > 80 ? "2′" : N < 40 ? "30″" : "1′", bx, by - 12 * u);
    const kx = W - 26 * u, ky = W - 62 * u, L = 26 * u;
    ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(kx, ky - L); ctx.moveTo(kx, ky); ctx.lineTo(kx - L, ky); ctx.stroke();
    ctx.textAlign = "center"; ctx.fillText("N", kx, ky - L - 8 * u); ctx.fillText("E", kx - L - 9 * u, ky); ctx.textAlign = "left";
  }
  function hud(it: Item | null) {
    const h = $("#bk-hud"), fl = $("#bk-flags");
    if (!it) { h.innerHTML = errorMsg && !building ? "" : ""; fl.innerHTML = ""; $("#bk-stage").classList.toggle("empty", !building); $("#bk-stage").setAttribute("data-msg", errorMsg || (opened ? "" : "Enter a position to begin")); return; }
    $("#bk-stage").classList.remove("empty");
    if (it.f) {
      const f = it.f, nv = (frames[frames.length - 1]?.visit ?? 0) + 1;
      h.innerHTML = `<b>${f.dateObs ? f.dateObs.slice(0, 16).replace("T", " ") : mjdToDate(f.mjd)} <small>UTC</small></b><span><i style="background:${lamColor(f.lam)}"></i>${f.lam.toFixed(3)} µm · detector ${f.det} · visit ${f.visit + 1}/${nv}</span>`;
      const names = flagNames(f.flags, true);
      fl.innerHTML = f.flags < 0 ? "" : names.length ? names.slice(0, 5).map((n) => `<em class="bad" title="${esc(FLAG_DEFS.find((d) => d.name === n)?.desc ?? "")}">${n}</em>`).join("") : `<em class="ok" title="No contamination flag on the target's pixels in this exposure">clean</em>`;
    } else {
      const L = it.list!, t0 = Math.min(...L.map((f) => f.mjd)), t1 = Math.max(...L.map((f) => f.mjd)), lams = L.map((f) => f.lam);
      h.innerHTML = `<b>${esc(it.label ?? "")}</b><span>${mjdToDate(t0)} → ${mjdToDate(t1)} · ${L.length} exposures combined</span><span>${Math.min(...lams).toFixed(2)}–${Math.max(...lams).toFixed(2)} µm</span>`;
      fl.innerHTML = it.kind === "diff" ? `<em class="neg">fainter / left</em><em class="pos">brighter / arrived</em>` : it.kind === "rgb" ? `<em class="lc" style="color:#8fb7ff">0.75–1.6 µm</em><em class="lc" style="color:#8be29e">1.6–3.8 µm</em><em class="lc" style="color:#ff8a80">3.8–5 µm</em>` : "";
    }
  }
  function drawStrip() {
    const dpr = Math.min(devicePixelRatio || 1, 2), w = (strip.width = Math.max(10, strip.clientWidth * dpr)), h = (strip.height = 46 * dpr), g = strip.getContext("2d")!, n = items.length;
    g.clearRect(0, 0, w, h); if (!n) return;
    const pad = 8 * dpr, X = (k: number) => (n === 1 ? w / 2 : pad + (k / (n - 1)) * (w - 2 * pad)), bad = badMask();
    g.font = `${10 * dpr}px "JetBrains Mono", monospace`; g.textBaseline = "alphabetic";
    let lastLabel = -1e9;
    items.forEach((it, k) => {
      const x = X(k), cur = k === idx;
      if (it.f) {
        g.fillStyle = lamColor(it.f.lam); g.globalAlpha = cur ? 1 : 0.6; g.fillRect(x - dpr, (cur ? 8 : 14) * dpr, 2 * dpr, (cur ? 24 : 14) * dpr);
        if (it.f.flags > 0 && it.f.flags & bad) { g.fillStyle = "#ff5d6c"; g.globalAlpha = 0.95; g.fillRect(x - 1.5 * dpr, 9 * dpr, 3 * dpr, 3 * dpr); }
        g.globalAlpha = 1;
        const newVisit = mode === "time" && (k === 0 || items[k - 1].f!.visit !== it.f.visit);
        if (newVisit && x - lastLabel > 78 * dpr) { g.fillStyle = "rgba(240,240,250,.7)"; g.fillText(mjdToDate(it.f.mjd).slice(0, 7), Math.min(x, w - 50 * dpr), h - 3 * dpr); lastLabel = x; g.fillStyle = "rgba(240,240,250,.25)"; g.fillRect(x - 3 * dpr, 6 * dpr, dpr, 26 * dpr); }
      } else { g.fillStyle = cur ? "#fff" : "rgba(240,240,250,.45)"; g.fillRect(x - 3 * dpr, (cur ? 8 : 12) * dpr, 6 * dpr, (cur ? 24 : 16) * dpr);
        g.fillStyle = "rgba(240,240,250,.7)"; const t = it.key.includes("all") ? "all" : mjdToDate(it.mjd).slice(2, 7), tw = g.measureText(t).width; g.fillText(t, Math.max(0, Math.min(x - tw / 2, w - tw)), h - 3 * dpr); }
      if (cur) { g.fillStyle = "#fff"; g.fillRect(x - dpr, 2 * dpr, 2 * dpr, 4 * dpr); }
    });
    if (mode === "lambda" && n > 1) { g.fillStyle = "rgba(240,240,250,.7)"; g.fillText(`${items[0].f!.lam.toFixed(2)} µm`, pad, h - 3 * dpr); const t = `${items[n - 1].f!.lam.toFixed(2)} µm`; g.fillText(t, w - pad - g.measureText(t).width, h - 3 * dpr); }
  }
  function markCurrent() {
    const k = items[idx]?.f ? frames.indexOf(items[idx].f!) : -1;
    host.querySelectorAll(".bk-pt.cur").forEach((e) => e.classList.remove("cur"));
    if (k >= 0) host.querySelectorAll(`.bk-pt[data-k="${k}"]`).forEach((e) => e.classList.add("cur"));
  }

  // ------------------------------------------------------------ playback
  function refresh() {
    const key = `${mode}|${detsKey()}|${view.track}|${frames.length}`;
    if (key !== itemsKey) { const curKey = items[idx]?.key; items = buildItems(); itemsKey = key; const k = items.findIndex((i) => i.key === curKey); idx = k >= 0 ? k : Math.min(idx, Math.max(0, items.length - 1)); }
    paint(); syncControls(); tick();
  }
  function tick() { clearTimeout(timer); if (playing && items.length > 1) timer = window.setTimeout(() => { idx = (idx + 1) % items.length; paint(); tick(); }, 1000 / (mode === "stack" || mode === "rgb" || mode === "diff" ? Math.min(fps, 1.5) : fps)); }
  function seek(k: number, pause = true) { if (!items.length) return; idx = ((k % items.length) + items.length) % items.length; if (pause) playing = false; paint(); syncControls(); tick(); }
  function seekFrame(k: number) { const f = frames[k]; if (!f) return; if (mode !== "time" && mode !== "lambda") { mode = "time"; refresh(); } const q = items.findIndex((i) => i.f === f); if (q >= 0) seek(q); }
  function setMode(m: Mode) { mode = m; idx = 0; refresh(); }

  // ------------------------------------------------------------ analysis (spectrum, light curve, motion of the probed source)
  function analyze() {
    if (frames.length < 3) { analysis = null; renderPanel(); return; }
    const fs = dets.size === 6 ? frames : frames.filter((f) => dets.has(f.det));
    const P = spectrum(frames, N, probe, probe.follow).filter((p) => dets.has(p.det)), over = FLAG_DEFS.find((d) => d.name === "OVERFLOW"), obit = over ? 1 << over.bit : 2;
    const nFlagged = P.filter((p) => p.flagged).length, nSat = probe.follow ? frames.filter((f) => f.flags > 0 && f.flags & obit).length : 0;
    let motion = fitMotion(frames, N, center, probe, probe.follow, dets), motionFlagged = false;
    if (!motion && nFlagged > 0.5 * P.length) { motion = fitMotion(frames, N, center, probe, probe.follow, dets, true); motionFlagged = !!motion; }
    // a saturated star: its core is lost, so follow the brightness of its unsaturated halo instead
    const halo = nSat > 0.5 * frames.length, lc = lightCurve(halo ? haloSeries(fs, N, probe, probe.follow) : P);
    analysis = { P, bins: binSpectrum(P, 0.05), lc, halo, motion, motionFlagged, nFlagged, nSat };
    renderPanel(); renderTarget();
  }
  const probeSky = (year: number): [number, number] => (probe.follow ? propagate(target, yearToMjd(year)) : stampToSky(center[0], center[1], N, c() + probe.dx, c() + probe.dy));
  function nearest<T extends CatSource>(L: T[], tol: number): T | null {
    let best: T | null = null, bd = tol;
    for (const s of L) { const [ra, dec] = probeSky(s.epoch), d = angSep(ra, dec, s.ra, s.dec); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  /** a different Gaia star close enough to share the measurement aperture (SPHEREx pixels are 6.15″) */
  function blend(): { g: CatSource; sep: number } | null {
    const year = frames.length ? mjdToYear((frames[0].mjd + frames[frames.length - 1].mjd) / 2) : 2026, [ra, dec] = probeSky(year);
    let best: { g: CatSource; sep: number } | null = null;
    for (const g of cat.gaia) { const [gr, gd] = catPos(g, year), sep = angSep(ra, dec, gr, gd); if (sep > 2 && sep < 10 && (!best || (g.mag ?? 99) < (best.g.mag ?? 99))) best = { g, sep }; }
    return best;
  }
  function anchors() {
    const out: { um: number; mjy: number; label: string }[] = [], tm = nearest(cat.tm, 5), w = nearest(cat.wise, 6);
    if (tm) for (const [b, m] of [["J", tm.j], ["H", tm.h], ["Ks", tm.k]] as const) if (isFinite(m)) out.push({ um: BANDS[b].um, mjy: magToMjy(m, b), label: b });
    if (w) { if (w.mag2 != null) out.push({ um: BANDS.W1.um, mjy: magToMjy(w.mag2, "W1"), label: "W1" }); if (w.mag != null) out.push({ um: BANDS.W2.um, mjy: magToMjy(w.mag, "W2"), label: "W2" }); }
    return out;
  }
  function insights(P: Phot[]): string[] {
    const med = (a: number, b: number) => { const v = P.filter((p) => !p.flagged && p.lam >= a && p.lam <= b); return v.length >= 2 ? { f: median(v.map((p) => p.flux)), e: median(v.map((p) => p.err)) / Math.sqrt(v.length), n: v.length } : null; };
    const out: string[] = [], ch4 = med(3.2, 3.45), ref = med(3.9, 4.2), blue = med(1.0, 1.35), red = med(4.4, 4.95);
    if (ch4 && ref && ref.f > 5 * ref.e) { const r = ch4.f / ref.f;
      if (r < 0.6) out.push(`<b>Methane.</b> At 3.3 µm it is ${Math.round((1 - Math.max(0, r)) * 100)}% fainter than at 4.0 µm. Methane absorbs exactly there, and it only survives in atmospheres cooler than about 1,300 K — the mark of a T or Y brown dwarf (or a giant planet).`); }
    if (blue && red && red.f > 5 * red.e && red.f > 3 * Math.max(blue.f, blue.e)) out.push(`<b>Red.</b> It is ${blue.f > 2 * blue.e ? `${(red.f / blue.f).toFixed(0)}×` : "far"} brighter at 4.7 µm than at 1.2 µm: a very cold or dust-wrapped object.`);
    else if (blue && red && blue.f > 5 * blue.e && blue.f > 4 * Math.max(red.f, red.e)) out.push(`<b>Star-like.</b> Its light falls steadily toward the infrared, as for an ordinary star hotter than ~3,000 K.`);
    return out;
  }

  // ------------------------------------------------------------ side panel
  function renderTarget() {
    const t = target, pm = Math.hypot(t.pmra ?? 0, t.pmdec ?? 0), [ra, dec] = center, nv = frames.length ? frames[frames.length - 1].visit + 1 : 0;
    const dist = t.plx && t.plx > 1 ? `${(3261.56 / t.plx).toFixed(t.plx > 100 ? 2 : 0)} light-years away` : "";
    const stat = !plan ? "" : `<div class="bk-stats"><div><b>${plan.covered}</b><span>exposures cover it</span></div><div><b>${frames.length}${building ? "…" : ""}</b><span>read${failed ? ` · ${failed} failed` : ""}</span></div><div><b>${nv || "–"}</b><span>visits</span></div><div><b>${frames.length ? `${((frames[frames.length - 1].mjd - frames[0].mjd) / 365.25).toFixed(1)} yr` : "–"}</b><span>time span</span></div></div>`;
    $("#bk-target").innerHTML = `<div class="eyebrow">${esc(t.otype ? `${t.otype}${t.sptype ? ` · ${t.sptype}` : ""}` : t.name ? "Target" : "Sky position")}</div>
      <h1 class="display">${esc(t.name ?? sexa(t.ra, t.dec))}</h1>
      <div class="bk-coord mono">${sexa(ra, dec)}<br>RA ${ra.toFixed(5)}° · Dec ${dec >= 0 ? "+" : ""}${dec.toFixed(5)}° · ICRS${frames.length ? ` · epoch ${mjdToYear((frames[0].mjd + frames[frames.length - 1].mjd) / 2).toFixed(1)}` : ""}</div>
      ${pm > 0.1 ? `<div class="bk-note">Moves <b>${pm.toFixed(2)}″ per year</b>${dist ? ` · ${dist}` : ""} <span>(${esc(t.source ?? "catalogue")})</span> — the crosshair follows it.</div>` : dist ? `<div class="bk-note">${dist} <span>(${esc(t.source ?? "catalogue")})</span></div>` : ""}
      ${t.note ? `<div class="bk-note warn">${t.note}</div>` : ""}${stat}
      ${meta ? `<div class="bk-meta mono">Index: ${meta.exposures.toLocaleString()} SPHEREx exposures, ${meta.first} → ${meta.last} (${Object.keys(meta.releases).map((r) => r.toUpperCase()).join(" + ")})</div>` : ""}`;
  }
  function syncControls() {
    host.querySelectorAll<HTMLElement>(".bk-modes button").forEach((b) => b.classList.toggle("on", b.dataset.m === mode));
    host.querySelectorAll<HTMLElement>("#bk-fov button").forEach((b) => b.classList.toggle("on", +b.dataset.s! === N));
    host.querySelectorAll<HTMLElement>("#bk-n button").forEach((b) => b.classList.toggle("on", +b.dataset.n! === maxFrames));
    host.querySelectorAll<HTMLElement>("#bk-dets button").forEach((b) => b.classList.toggle("on", dets.has(+b.dataset.d!)));
    host.querySelectorAll<HTMLElement>("#bk-toggles button").forEach((b) => { const k = b.dataset.v!; b.classList.toggle("on", k === "lock" ? lock[mode] : (view as any)[k]); });
    host.querySelectorAll<HTMLElement>(".bk-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
    host.querySelectorAll<HTMLElement>(".bk-chips .chip").forEach((b) => b.classList.toggle("on", b.dataset.key === target.key));
    $("#bk-start").hidden = opened; $("#bk-body").hidden = !opened;
    $("#bk-play").textContent = playing ? "❚❚" : "▶";
    $("#bk-explain").textContent = MODES.find((m) => m.k === mode)!.d;
    const n = plan?.picked ?? Math.min(maxFrames, 120); $("#bk-cost").textContent = `A wider field or more exposures shows more, and takes longer: this setting reads about ${Math.round((n * ((N * 1.42 + 3) * 8160 + 60000)) / 1e6)} MB from NASA's archive.`;
    const tg = host.querySelector<HTMLElement>('#bk-toggles [data-v="track"]'); if (tg) tg.style.display = hasPm() ? "" : "none";
  }
  const probeLine = () => {
    if (probe.follow) return `<div class="bk-probe"><span><i class="dot"></i>Measuring <b>${esc(target.name ?? "the centre position")}</b></span><span class="hint">click any source in the image to measure it instead</span></div>`;
    const [ra, dec] = probeSky(2016), g = nearest(cat.gaia, 5);
    return `<div class="bk-probe sel"><span><i class="dot"></i>Measuring the clicked source · ${sexa(ra, dec)}${g ? `<br><small>${esc(g.id)} · G = ${g.mag?.toFixed(1) ?? "–"}${g.plx && g.plx > 0.3 ? ` · ${(3261.56 / g.plx).toFixed(0)} ly` : ""}</small>` : ""}</span>
      <span><button class="link" id="bk-recentre">open it as the target</button> · <button class="link" id="bk-unprobe">back to target</button></span></div>`;
  };
  function renderPanel() {
    const el = $("#bk-panel"), A = analysis;
    if (errorMsg && !frames.length) { el.innerHTML = `<div class="bk-empty">${esc(errorMsg)}</div>`; return; }
    if (tab === "share") return renderShare(el);
    if (tab === "frame") return renderFrame(el);
    if (!A) { el.innerHTML = `<div class="bk-empty">${opened ? "Measuring as the exposures arrive…" : "The spectrum, light curve and motion of your target appear here."}</div>`; return; }
    if (tab === "spectrum") {
      const ins = insights(A.P), sat = A.nSat > 0.3 * frames.length, bl = blend();
      if (bl) ins.push(`<b>Blended.</b> A Gaia star (G = ${bl.g.mag?.toFixed(1) ?? "?"}) lies ${bl.sep.toFixed(0)}″ away, about one SPHEREx pixel, so part of the light measured here is its own — mostly at short wavelengths.`);
      el.innerHTML = `${probeLine()}${sat ? `<div class="bk-warn"><b>Saturated.</b> This source is so bright that it overflows SPHEREx's detectors in ${A.nSat} of ${frames.length} exposures (NASA's OVERFLOW flag). Those measurements are drawn hollow: read them as lower limits.</div>` : ""}
        <div id="bk-plot"></div>
        <div class="bk-plotbar"><span class="mono">${A.P.length} measurements · ${A.nFlagged} flagged</span><span><button class="link" id="bk-log">${logSpec ? "linear scale" : "log scale"}</button> · <button class="link" id="bk-csv">download CSV</button></span></div>
        ${ins.map((s) => `<p class="bk-insight">${s}</p>`).join("")}
        <p class="bk-cap">Each dot is one 2-minute exposure. SPHEREx's filter changes colour across each detector, so every exposure measures the source at a different wavelength; together they are its spectrum, built in your browser from the exposures above. The line is the median. ◇ are catalogue fluxes of the same source for comparison (2MASS 1998, WISE 2010).</p>`;
      drawSpectrum($("#bk-plot"), A.P, { log: logSpec, bins: A.bins.filter((b) => b.n >= 1), anchors: anchors(), onPick: seekFrame });
      $("#bk-log").onclick = () => { logSpec = !logSpec; renderPanel(); }; $("#bk-csv").onclick = downloadCsv;
    } else if (tab === "light") {
      const lc = A.lc, band = (d: number) => { const q = DETECTORS[d - 1]; return `${q.lo.toFixed(q.lo < 1 ? 2 : 1)}–${q.hi.toFixed(1)} µm`; };
      const calm = lc.best ? lc.series.filter((q) => q !== lc.best).sort((a, b) => a.amplitude - b.amplitude)[0] : null, top = lc.best ?? lc.all;
      const verdict = lc.all.visits.length < 2 && !lc.series.length ? ""
        : lc.variable && top.lo && top.hi ? `<b>Variable.</b> ${lc.best ? `At ${band(lc.best.det)} it` : "It"} was <b>${top.amplitude.toFixed(top.amplitude > 3 ? 1 : 2)}× brighter</b> in ${mjdToDate(top.hi.mjd).slice(0, 7)} than in ${mjdToDate(top.lo.mjd).slice(0, 7)}${calm && calm.amplitude < 0.6 * top.amplitude ? `, but changed only ${calm.amplitude.toFixed(2)}× at ${band(calm.det)}: its colour changes as it varies` : ""}.`
        : `<b>Steady.</b> Visit-to-visit changes stay within ${Math.max(3, Math.round((Math.max(lc.all.amplitude, 1) - 1) * 100))}%, consistent with a constant source.`;
      el.innerHTML = `${probeLine()}${A.halo ? `<div class="bk-warn"><b>Saturated star, measured by its halo.</b> The core overflows the detector, so MIRA follows the unsaturated glow 25–43″ around it, which rises and falls with the star.</div>` : ""}
        <div id="bk-plot"></div>${verdict ? `<p class="bk-insight">${verdict}</p>` : ""}
        <p class="bk-cap">SPHEREx never sees a source twice at the same wavelength within a visit, and spectra can be very jagged — so brightness is only compared between exposures of <i>different</i> visits that saw the <i>same</i> wavelength (same detector, within 1.2%). ${lc.pairs} such pairs give the level of each visit relative to the source's own average, per detector band (colours) and overall (white).</p>`;
      drawLightCurve($("#bk-plot"), lc);
    } else if (tab === "motion") {
      const m = A.motion;
      if (!m) { el.innerHTML = `${probeLine()}<div class="bk-empty">Not enough clean, well-detected exposures over at least two visits to measure a motion for this source${A.nFlagged > 0.5 * A.P.length ? " (most are flagged)" : ""}.</div>`; }
      else {
        const tot = Math.hypot(m.pmra, m.pmdec), etot = Math.hypot(m.epmra, m.epmdec) / Math.SQRT2, sig = tot / Math.max(etot, 1e-6), pa = ((Math.atan2(m.pmra, m.pmdec) * 180) / Math.PI + 360) % 360;
        const g = probe.follow ? null : nearest(cat.gaia, 5), ref = probe.follow && hasPm() ? { pmra: target.pmra!, pmdec: target.pmdec!, plx: target.plx, src: target.source ?? "catalogue" } : g ? { pmra: g.pmra, pmdec: g.pmdec, plx: g.plx ?? undefined, src: "Gaia DR3" } : null;
        const eplx = m.eplx === null ? NaN : Math.hypot(m.eplx, PLX_SYS), plxOk = m.plx !== null && m.plx / eplx > 3;
        el.innerHTML = `${probeLine()}${A.motionFlagged ? `<div class="bk-warn"><b>Indicative only.</b> Every exposure of this source is flagged (saturated), so its centre is measured from the wings of its image; errors are larger than quoted.</div>` : ""}
          <div id="bk-plot"></div>
          <table class="bk-table"><thead><tr><th></th><th>east ″/yr</th><th>north ″/yr</th><th>parallax ″</th></tr></thead><tbody>
            <tr><td>SPHEREx alone <small>${m.n} exposures · ${m.visits} visits · ${(m.span / 365.25).toFixed(1)} yr</small></td><td>${fmtPm(m.pmra)} ± ${m.epmra.toFixed(2)}</td><td>${fmtPm(m.pmdec)} ± ${m.epmdec.toFixed(2)}</td><td>${m.plx === null ? "–" : `${m.plx.toFixed(2)} ± ${eplx.toFixed(2)}`}</td></tr>
            ${ref ? `<tr class="ref"><td>${esc(ref.src)}</td><td>${fmtPm(ref.pmra)}</td><td>${fmtPm(ref.pmdec)}</td><td>${ref.plx ? (ref.plx / 1000).toFixed(3) : "–"}</td></tr>` : ""}</tbody></table>
          <p class="bk-insight">${sig > 4 ? `<b>It moves.</b> ${tot.toFixed(2)} ± ${etot.toFixed(2)}″ per year toward position angle ${pa.toFixed(0)}° (${sig.toFixed(0)}σ), measured from SPHEREx exposures alone${plxOk ? `; its yearly parallax wobble (${m.plx!.toFixed(2)} ± ${eplx.toFixed(2)}″) puts it between <b>${(3.2616 / (m.plx! + eplx)).toFixed(0)} and ${(3.2616 / (m.plx! - eplx)).toFixed(0)} light-years</b> away` : ""}.`
            : `<b>No significant motion.</b> Slower than ${(3 * etot).toFixed(2)}″ per year (3σ) over the ${(m.span / 365.25).toFixed(1)}-year SPHEREx baseline.`}</p>
          <p class="bk-cap">The centre of the source is measured in every clean exposure where it is detected above 8σ, then a straight-line motion${m.withParallax ? " plus the parallax ellipse" : ""} is fitted with outlier rejection. Scatter per exposure: ${m.rms.toFixed(2)}″ (a pixel is 6.15″). Hollow points were rejected.${m.withParallax ? ` The parallax error includes ${PLX_SYS}″ for a systematic effect: SPHEREx flips over between visits six months apart, in step with the parallax swing.` : ""}</p>`;
        drawMotion($("#bk-plot"), m, { onPick: seekFrame });
      }
    }
    host.querySelector<HTMLElement>("#bk-unprobe")?.addEventListener("click", () => { probe = { dx: 0, dy: 0, follow: true }; analyze(); paint(); });
    host.querySelector<HTMLElement>("#bk-recentre")?.addEventListener("click", () => { const [ra, dec] = probeSky(2016), g = nearest(cat.gaia, 5);
      open(g ? { ra: g.ra, dec: g.dec, pmra: g.pmra, pmdec: g.pmdec, epoch: g.epoch, name: g.id, plx: g.plx ?? undefined, source: "Gaia DR3" } : { ra, dec }); });
    markCurrent();
  }
  function renderFrame(el: HTMLElement) {
    const it = items[idx];
    if (!it) { el.innerHTML = `<div class="bk-empty">No exposure selected.</div>`; return; }
    if (!it.f) { el.innerHTML = `<div class="bk-kv"><div><span>Image</span><b>${esc(it.label ?? "")}</b></div><div><span>Exposures combined</span><b>${it.list!.length}</b></div></div>
      <p class="bk-cap">This frame combines several exposures. Switch to <b>Movie</b> to inspect the metadata and flags of a single exposure.</p>`; return; }
    const f = it.f, all = flagNames(f.flags), near = flagNames(f.flagsNear).filter((n) => !all.includes(n));
    const row = (n: string) => { const d = FLAG_DEFS.find((x) => x.name === n)!; return `<li class="${INFO_FLAGS.has(n) ? "info" : "bad"}"><b>${n}</b><span>${esc(d.desc)}</span></li>`; };
    el.innerHTML = `<div class="bk-kv">
        <div><span>Observation</span><b class="mono">${esc(f.obsid)} · D${f.det}</b></div>
        <div><span>Mid-exposure (UTC)</span><b class="mono">${esc(f.dateObs.replace("T", " ").slice(0, 19))}</b></div>
        <div><span>Wavelength at target</span><b class="mono">${f.lam.toFixed(4)} µm <small>± ${(f.bw / 2).toFixed(3)}</small></b></div>
        <div><span>Exposure time</span><b class="mono">${isFinite(f.exptime) ? f.exptime.toFixed(1) + " s" : "–"}</b></div>
        <div><span>Image sharpness (PSF)</span><b class="mono">${isFinite(f.psf) ? f.psf.toFixed(1) + "″" : "–"}</b></div>
        <div><span>Sky background removed</span><b class="mono">${f.bg.toFixed(3)} MJy/sr</b></div>
        <div><span>Pixel noise</span><b class="mono">${f.noise.toFixed(3)} MJy/sr</b></div>
        <div><span>Release · pipeline</span><b class="mono">${esc(f.exp.rel.toUpperCase())} · ${esc(f.version || "–")}</b></div>
      </div>
      <div class="eyebrow" style="margin-top:18px">NASA quality flags on the target's pixels</div>
      ${f.flags < 0 ? `<p class="bk-cap">Flags could not be read for this exposure.</p>` : `<ul class="bk-flaglist">${all.length ? all.map(row).join("") : `<li class="info"><b>none</b><span>No flag is set within 1.5 pixels of the target.</span></li>`}</ul>
        ${near.length ? `<p class="bk-cap">Also within 3.5 pixels: ${near.join(", ")}.</p>` : ""}`}
      <p class="bk-cap">Turn on <b>Flags</b> to paint every flagged pixel of this exposure in red. <a href="${f.exp.url}" target="_blank" rel="noopener">Download this exposure (FITS, 65 MB) from NASA's archive ↗</a></p>`;
  }
  function shareUrl(embed = false) {
    const p = stateParams(); if (embed) p.set("embed", "1"); return `${location.origin}${location.pathname}?${p.toString()}`;
  }
  function renderShare(el: HTMLElement) {
    const url = shareUrl(), iframe = `<iframe src="${shareUrl(true)}" width="960" height="680" style="border:0" loading="lazy" allowfullscreen></iframe>`;
    el.innerHTML = `<div class="eyebrow">Link to this view</div><div class="bk-copy"><input readonly value="${esc(url)}" id="bk-url"><button class="btn sm" data-copy="bk-url">Copy</button></div>
      <p class="bk-cap">Coordinates live in the address: <span class="mono">?ra=…&amp;dec=…&amp;fov=…</span> (degrees, arcminutes). Any page can link straight to a position.</p>
      <div class="eyebrow" style="margin-top:16px">Embed in your own site</div><div class="bk-copy"><input readonly value="${esc(iframe)}" id="bk-emb"><button class="btn sm" data-copy="bk-emb">Copy</button></div>
      <div class="eyebrow" style="margin-top:16px">Export</div>
      <div class="bk-actions"><button class="btn sm ghost" id="bk-png">Image (PNG)</button><button class="btn sm ghost" id="bk-webm">Movie (WebM)</button><button class="btn sm ghost" id="bk-csv2">Spectrum (CSV)</button></div>
      <div class="eyebrow" style="margin-top:16px">Look at the same spot elsewhere</div>
      <div class="bk-actions">${opts.onAtlas ? `<button class="btn sm ghost" id="bk-atlas">MIRA sky atlas</button>` : ""}
        <a class="btn sm ghost" target="_blank" rel="noopener" href="http://byw.tools/wiseview#ra=${center[0]}&dec=${center[1]}&size=176&band=3&speed=200&minbright=-50&maxbright=500&window=0.5&diff_window=1&linear=1&zoom=9">WiseView ↗</a>
        <a class="btn sm ghost" target="_blank" rel="noopener" href="https://irsa.ipac.caltech.edu/applications/spherex/?__action=layout.showDropDown&view=MultiTableSearchCmd&position=${center[0]}+${center[1]}">IRSA SPHEREx ↗</a>
        <a class="btn sm ghost" target="_blank" rel="noopener" href="https://simbad.cfa.harvard.edu/simbad/sim-coo?Coord=${center[0]}+${center[1]}&Radius=30&Radius.unit=arcsec">SIMBAD ↗</a></div>`;
    el.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((b) => (b.onclick = () => { const v = ($(`#${b.dataset.copy}`) as HTMLInputElement).value; navigator.clipboard?.writeText(v); b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1400); }));
    $("#bk-png").onclick = () => cv.toBlob((b) => b && save(b, `${fileStem()}.png`));
    $("#bk-webm").onclick = recordMovie; $("#bk-csv2").onclick = downloadCsv;
    const at = host.querySelector<HTMLElement>("#bk-atlas"); if (at) at.onclick = () => opts.onAtlas?.(center[0], center[1]);
  }
  const fileStem = () => `mira_${(target.name ?? `${center[0].toFixed(4)}_${center[1].toFixed(4)}`).replace(/[^\w.+-]+/g, "_")}`;
  function save(b: Blob, name: string) { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  function downloadCsv() {
    if (!analysis) return;
    const rows = ["mjd,date_utc,detector,wavelength_um,bandwidth_um,flux_mJy,flux_err_mJy,flagged,observation"];
    for (const p of analysis.P) { const f = frames[p.k]; rows.push([p.mjd.toFixed(5), f.dateObs, p.det, p.lam.toFixed(4), p.bw.toFixed(4), p.flux.toFixed(4), p.err.toFixed(4), p.flagged ? 1 : 0, f.obsid].join(",")); }
    save(new Blob([`# MIRA on-the-fly SPHEREx spectrum · RA ${center[0].toFixed(6)} Dec ${center[1].toFixed(6)} · PSF-weighted flux from SPHEREx Level-2 exposures (NASA/IPAC IRSA)\n${rows.join("\n")}\n`], { type: "text/csv" }), `${fileStem()}_spectrum.csv`);
  }
  function recordMovie() {
    const MR = (window as any).MediaRecorder; if (!MR || !cv.captureStream || items.length < 2) { toast("Movie export is not supported in this browser"); return; }
    const stream = cv.captureStream(30), rec = new MR(stream, { mimeType: MR.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm", videoBitsPerSecond: 6e6 }), chunks: Blob[] = [];
    rec.ondataavailable = (e: any) => e.data.size && chunks.push(e.data); rec.onstop = () => { save(new Blob(chunks, { type: "video/webm" }), `${fileStem()}.webm`); tick(); };
    clearTimeout(timer); playing = false; let k = 0; idx = 0; paint(); rec.start(); toast("Recording one loop…");
    const step = () => { if (++k >= items.length) { setTimeout(() => rec.stop(), 300); return; } idx = k; paint(); setTimeout(step, 1000 / Math.min(fps, 8)); };
    setTimeout(step, 1000 / Math.min(fps, 8));
  }

  // ------------------------------------------------------------ URL state
  function stateParams() {
    const p = new URLSearchParams(), t = target;
    p.set("ra", t.ra.toFixed(6)); p.set("dec", t.dec.toFixed(6)); p.set("fov", ((N * PIX_ARCSEC) / 60).toFixed(1));
    if (hasPm()) { p.set("pmra", String(+(t.pmra ?? 0).toFixed(5))); p.set("pmdec", String(+(t.pmdec ?? 0).toFixed(5))); p.set("epoch", String(t.epoch ?? 2016)); }
    if (t.name) p.set("name", t.name);
    return p;
  }
  function pushState() { opts.onState?.(stateParams()); }

  // ------------------------------------------------------------ search
  async function go(q: string, size?: number) {
    q = q.trim(); if (!q) return;
    const norm = (s: string) => s.toLowerCase().replace(/\bepsilon\b/g, "eps").replace(/[^a-z0-9]/g, "");
    const ch = CHALLENGE.find((t) => norm(t.name) === norm(q) || (norm(q).length > 4 && norm(t.name).includes(norm(q))) || t.key === q);
    if (ch) return open({ ...ch }, { size: size ?? ch.fov, frames: ch.frames ?? Math.min(maxFrames, 72), tab: ch.tab });
    const xy = parseCoords(q);
    if (xy) {
      // a typed position may be where a fast-moving neighbour WAS (catalogue epochs differ): check before reading frames
      toast("Checking for known fast-moving objects at this position…");
      const mover = await Promise.race([knownMoverNear(xy[0], xy[1]), new Promise<null>((r) => setTimeout(() => r(null), 3500))]).catch(() => null);
      const known = mover && CHALLENGE.find((t) => angSep(t.ra, t.dec, mover.ra, mover.dec) < 10);
      if (mover) return open({ ...(known ?? mover), note: `You entered where <b>${esc(known?.name ?? mover.name ?? "")}</b> was in ${mover.year.toFixed(0)}. It moves ${Math.hypot(mover.pmra ?? 0, mover.pmdec ?? 0).toFixed(1)}″ per year, so MIRA follows it to where it is now.` }, known ? { size: N } : {});
      return open({ ra: xy[0], dec: xy[1] });
    }
    toast(`Looking up “${q}”…`);
    const r = await resolveName(q).catch(() => null);
    if (r) return open(r);
    toast(`Could not find “${q}”. Try coordinates: RA Dec in degrees or sexagesimal.`);
  }

  // ------------------------------------------------------------ events
  ($("#bk-go") as HTMLFormElement).onsubmit = (e) => { e.preventDefault(); const i = $("#bk-q") as HTMLInputElement; i.blur(); go(i.value); };
  host.querySelectorAll<HTMLButtonElement>(".bk-chips .chip, .bk-card").forEach((b) => (b.onclick = () => go(b.dataset.key!)));
  host.querySelectorAll<HTMLButtonElement>(".bk-modes button").forEach((b) => (b.onclick = () => setMode(b.dataset.m as Mode)));
  host.querySelectorAll<HTMLButtonElement>("#bk-fov button").forEach((b) => (b.onclick = () => { if (+b.dataset.s! !== N) { N = +b.dataset.s!; if (opened) start(); else syncControls(); } }));
  host.querySelectorAll<HTMLButtonElement>("#bk-n button").forEach((b) => (b.onclick = () => { if (+b.dataset.n! !== maxFrames) { maxFrames = +b.dataset.n!; if (opened) start(); else syncControls(); } }));
  host.querySelectorAll<HTMLButtonElement>("#bk-dets button").forEach((b) => (b.onclick = (e) => { const d = +b.dataset.d!;
    if ((e as MouseEvent).shiftKey || (e as MouseEvent).altKey) dets = new Set([d]); else if (dets.has(d)) { if (dets.size > 1) dets.delete(d); } else dets.add(d);
    idx = 0; refresh(); analyze(); }));
  host.querySelectorAll<HTMLButtonElement>("#bk-toggles button").forEach((b) => (b.onclick = () => toggle(b.dataset.v!)));
  function toggle(k: string) {
    if (k === "lock") lock[mode] = !lock[mode]; else (view as any)[k] = !(view as any)[k];
    if (k === "track") { imgCache.clear(); itemsKey = ""; }
    if ((k === "gaia" || k === "wise") && cat.state === "fail") toast("The catalogue service (CDS VizieR) is not answering right now");
    refresh();
  }
  ($("#bk-cmap") as HTMLSelectElement).onchange = (e) => { view.cmap = (e.target as HTMLSelectElement).value; paint(); };
  ($("#bk-fps") as HTMLSelectElement).onchange = (e) => { fps = +(e.target as HTMLSelectElement).value; tick(); };
  host.querySelectorAll<HTMLButtonElement>(".bk-tabs button").forEach((b) => (b.onclick = () => { tab = b.dataset.t as Tab; syncControls(); renderPanel(); }));
  $("#bk-play").onclick = () => { playing = !playing; syncControls(); tick(); };
  $("#bk-prev").onclick = () => seek(idx - 1); $("#bk-next").onclick = () => seek(idx + 1);
  const scrub = (e: PointerEvent) => { const r = strip.getBoundingClientRect(), n = items.length; if (n) seek(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left - 8) / (r.width - 16))) * (n - 1))); };
  strip.addEventListener("pointerdown", (e) => { strip.setPointerCapture(e.pointerId); scrub(e); strip.onpointermove = scrub; });
  strip.addEventListener("pointerup", () => (strip.onpointermove = null));
  const pixAt = (e: MouseEvent): [number, number] => { const r = cv.getBoundingClientRect(), it = items[idx], [ox, oy] = it ? shiftOf(it) : [0, 0];
    return [((e.clientX - r.left) / r.width) * N - 0.5 - ox, ((e.clientY - r.top) / r.height) * N - 0.5 - oy]; };
  cv.addEventListener("pointermove", (e) => {
    const it = items[idx]; if (!it) return; const [x, y] = pixAt(e), [ra, dec] = stampToSky(center[0], center[1], N, x, y);
    const img = it.kind === "rgb" ? null : (imageOf(it) as Float32Array), [ox, oy] = shiftOf(it), i = Math.round(x + ox), j = Math.round(y + oy), v = img && i >= 0 && j >= 0 && i < N && j < N ? img[j * N + i] : NaN;
    hover = { i, j }; const m = it.f ? maskCache.get(it.f) : null, fl = view.mask && m && m !== "loading" ? flagNames(m[Math.round(y) * N + Math.round(x)] ?? 0).join(" ") : "";
    $("#bk-read").textContent = `${sexa(ra, dec)}${Number.isFinite(v) ? ` · ${v.toFixed(3)} MJy/sr` : ""}${fl ? ` · ${fl}` : ""}`;
  });
  cv.addEventListener("pointerleave", () => { hover = null; $("#bk-read").textContent = ""; });
  cv.addEventListener("click", (e) => {
    const it = items[idx]; if (!it || it.kind === "rgb" || it.kind === "diff") return;
    let [x, y] = pixAt(e); const img = imageOf(it) as Float32Array, [ox, oy] = shiftOf(it);
    // snap to the brightest pixel within 2 px, then to its 3×3 centre of light
    let bi = Math.round(x + ox), bj = Math.round(y + oy), bv = -Infinity;
    for (let j = bj - 2; j <= bj + 2; j++) for (let i = bi - 2; i <= bi + 2; i++) if (i > 0 && j > 0 && i < N - 1 && j < N - 1 && img[j * N + i] > bv) { bv = img[j * N + i]; bi = i; bj = j; }
    if (!Number.isFinite(bv)) return;
    let s = 0, sx = 0, sy = 0; for (let j = bj - 1; j <= bj + 1; j++) for (let i = bi - 1; i <= bi + 1; i++) { const v = Math.max(0, img[j * N + i] || 0); s += v; sx += v * i; sy += v * j; }
    x = (s ? sx / s : bi) - ox; y = (s ? sy / s : bj) - oy;
    const [tx, ty] = it.f ? [it.f.tx, it.f.ty] : targetXY(it.mjd);
    probe = Math.hypot(x - tx, y - ty) < 1.8 ? { dx: 0, dy: 0, follow: true } : { dx: x - c(), dy: y - c(), follow: false };
    if (tab === "frame" || tab === "share") tab = "spectrum";
    analyze(); syncControls(); paint();
  });
  const onKey = (e: KeyboardEvent) => {
    if (!host.classList.contains("open") && !opts.embed) return;
    const tag = (e.target as HTMLElement).tagName; if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey) return;
    if (e.code === "Space") { e.preventDefault(); playing = !playing; syncControls(); tick(); }
    else if (e.key === "ArrowRight") seek(idx + 1); else if (e.key === "ArrowLeft") seek(idx - 1);
    else if (e.key >= "1" && e.key <= "5") setMode(MODES[+e.key - 1].k);
    else if (e.key === "t" && hasPm()) toggle("track"); else if (e.key === "g") toggle("gaia"); else if (e.key === "w") toggle("wise"); else if (e.key === "m") toggle("mask"); else if (e.key === "l") toggle("lock");
  };
  addEventListener("keydown", onKey);
  const ro = new ResizeObserver(() => { if (opened) paint(); }); ro.observe($("#bk-stage"));
  void hover;
  syncControls(); renderTarget(); renderPanel(); hud(null);

  return {
    open, go,
    /** open from URL parameters (?ra=&dec=&fov=&pmra=&pmdec=&epoch=&name=); returns false if they hold no position */
    openFromParams(p: URLSearchParams): boolean {
      const ra = parseFloat(p.get("ra") ?? ""), dec = parseFloat(p.get("dec") ?? ""), name = p.get("name") ?? undefined;
      const fov = parseFloat(p.get("fov") ?? ""), size = isFinite(fov) ? SIZES.reduce((b, s) => (Math.abs((s * PIX_ARCSEC) / 60 - fov) < Math.abs((b * PIX_ARCSEC) / 60 - fov) ? s : b), 32) : undefined;
      if (!isFinite(ra) || !isFinite(dec)) { const t = p.get("target") ?? name; if (t) { if (size) N = size; go(t, size); return true; } return false; }
      const ch = name ? CHALLENGE.find((t) => t.name === name) : undefined;
      const pmra = parseFloat(p.get("pmra") ?? ""), pmdec = parseFloat(p.get("pmdec") ?? "");
      open(ch ? { ...ch } : { ra, dec, name, pmra: isFinite(pmra) ? pmra : undefined, pmdec: isFinite(pmdec) ? pmdec : undefined, epoch: parseFloat(p.get("epoch") ?? "") || undefined }, { size, frames: ch?.frames, tab: ch?.tab });
      return true;
    },
    pause() { clearTimeout(timer); playing = false; syncControls(); },
    resume() { if (opened && items.length) { playing = true; syncControls(); tick(); } },
    destroy() { ac?.abort(); clearTimeout(timer); removeEventListener("keydown", onKey); ro.disconnect(); host.innerHTML = ""; },
    get isOpen() { return opened; },
  };
}
