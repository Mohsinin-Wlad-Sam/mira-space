// OBSERVE — point at a place in the sky and watch every SPHEREx exposure of it. The frames are sky-registered, so
// anything that moves or changes stands out; the right-hand column answers three questions about the target (is it
// moving, is it changing, what is it made of) and keeps the evidence one click away. Engine: engine.ts; measurements:
// measure.ts; wording of the answers: answers.ts.
import "./blink.css";
import { sexa } from "../data";
import {
  build, readMask, propagate, skyToStamp, stampToSky, flagNames, badMask, indexMeta, labelVisits, mjdToDate, mjdToYear,
  DETECTORS, FLAG_DEFS, PIX_ARCSEC, type Frame, type Target, type IndexMeta,
} from "./engine";
import { PLX_SYS } from "./measure";
import { analyzeFrames, answerMove, answerChange, answerMade, plxError, type Analysis, type Answer } from "./answers";
import { levels, shiftImage, robustStack, asinhT } from "./imaging";
import { gaia, allwise, twomass, catPos, magToMjy, angSep, BANDS, CHALLENGE, parseCoords, resolveName, knownMoverNear, type CatSource } from "./catalogs";
import { drawSpectrum, drawLightCurve, drawMotion, detColor, lamColor } from "./plots";
import { findSources, type FieldSource } from "./sources";
import { fitsCube, pythonSnippet } from "./fits";

export type BlinkTarget = Target & { plx?: number; otype?: string; sptype?: string; source?: string; key?: string; note?: string };
/** what "Save to logbook" hands over */
export type Snapshot = { target: BlinkTarget; center: [number, number]; size: number; frames: number; covered: number; lastMjd: number; thumb: string; url: string;
  answers: Record<"move" | "change" | "made", { chip: string; text: string }> | null };
export type BlinkOpts = { embed?: boolean; toast?: (m: string) => void; onState?: (p: URLSearchParams) => void; onAtlas?: (ra: number, dec: number) => void; onSave?: (s: Snapshot) => void };
type Mode = "time" | "lambda" | "stack" | "rgb" | "diff";
type Tab = "spectrum" | "light" | "motion" | "sources" | "frames" | "export";
const TABS: [Tab, string][] = [["spectrum", "Spectrum"], ["light", "Light curve"], ["motion", "Astrometry"], ["sources", "Sources"], ["frames", "Exposures"], ["export", "Export"]];
type Item = { kind: "frame" | "stack" | "rgb" | "diff"; key: string; mjd: number; f?: Frame; list?: Frame[]; ref?: Frame[]; label?: string };
type Probe = { dx: number; dy: number; follow: boolean };
type TwoMass = CatSource & { j: number; h: number; k: number };

const SIZES = [32, 64, 96, 128], BUDGETS = [36, 72, 144];
const VIEWS: { k: "frames" | "stack" | "rgb" | "diff"; t: string }[] = [{ k: "frames", t: "Frames" }, { k: "stack", t: "Stacked" }, { k: "rgb", t: "Colour" }, { k: "diff", t: "Difference" }];
const EXPLAIN: Record<Mode, string> = {
  time: "Every exposure, one after another, pinned to the sky. What drifts is moving; what shows up once is passing through, or an artifact. Each exposure sees a different colour of infrared light (the tick colours), so brightness flickers even for a steady star.",
  lambda: "The same exposures, ordered from blue to red light instead of by date: the movie is now the object's spectrum. Cold worlds fade out near 3.3 µm, where methane absorbs.",
  stack: "Each visit's exposures added together for a deeper picture; step through the visits to compare them. With Follow target on, they are added along the target's path, which brings out movers too faint for a single exposure.",
  rgb: "SPHEREx's six detectors folded into one colour picture per visit: blue is 0.75–1.6 µm, green 1.6–3.8 µm, red 3.8–5 µm. Ordinary stars look blue-white; cold or dusty objects look red.",
  diff: "Each visit minus the first one. Whatever stayed the same cancels to black; blue marks where something was, orange where it went or brightened.",
};
const MAGMA = [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]];
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
const yearToMjd = (y: number) => 51544.5 + (y - 2000) * 365.25;
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const fmtPm = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(Math.abs(v) < 1 ? 3 : 2)}`;

export function mountBlink(host: HTMLElement, opts: BlinkOpts = {}) {
  host.classList.toggle("embed", !!opts.embed);
  host.innerHTML = `
  <div class="bk">
    <div class="bk-start" id="bk-start">
      <div class="bk-start-l">
        <div class="eyebrow">Observe · real NASA SPHEREx images, read live from the archive</div>
        <h2 class="display">Point the telescope.</h2>
        <p>Enter a position or a name. MIRA reads every SPHEREx exposure of it from NASA's archive, registers them on the sky, and returns a spectrum, a light curve, astrometry and a source list — with the flags, tables and FITS to take away.</p>
        <form class="bk-go" id="bk-go">
          <input id="bk-q" placeholder="A star's name, or coordinates (RA Dec)" autocomplete="off" spellcheck="false" enterkeyhint="go" aria-label="Where to point: a name or coordinates">
          <button class="btn" type="submit">Observe</button>
        </form>
        <div class="bk-try"><span>or start with one of NASA's five test targets</span>
          <div>${CHALLENGE.map((t) => `<button class="chip" data-key="${t.key}" title="${esc(t.blurb)}">${esc(t.name)}</button>`).join("")}</div></div>
      </div>
      <figure class="bk-demo" id="bk-demo" hidden><canvas width="416" height="416"></canvas><figcaption></figcaption></figure>
    </div>
    <div class="bk-body" id="bk-body" hidden>
      <header class="bk-head">
        <div class="bk-target" id="bk-target"></div>
        <div class="bk-ctl">
          <div class="bk-ctlrow"><span class="eyebrow">Field</span><div class="seg" id="bk-fov">${SIZES.map((s) => `<button data-s="${s}" title="${s} × ${s} SPHEREx pixels">${((s * PIX_ARCSEC) / 60).toFixed(1)}′</button>`).join("")}</div>
            <span class="eyebrow">Exposures</span><div class="seg" id="bk-n">${BUDGETS.map((b) => `<button data-n="${b}">${b === 144 ? "All" : b}</button>`).join("")}</div><span class="bk-cost mono" id="bk-cost"></span>
            ${opts.onSave ? `<button class="btn sm ghost" id="bk-save">Save to logbook</button>` : ""}</div>
          <div class="bk-data mono" id="bk-data"></div>
        </div>
      </header>
      <section class="bk-main">
        <div class="bk-viewbar"><div class="seg" id="bk-views" role="tablist" aria-label="How to show the exposures">${VIEWS.map((v, k) => `<button role="tab" data-v="${v.k}" title="Key ${k + 1}">${v.t}</button>`).join("")}</div></div>
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
        </div>
        <div class="bk-layers" id="bk-toggles">
          <button data-v="track" title="Keep the target centred; stacked pictures are then added along its path (T)">Follow target</button>
          <button data-v="gaia" title="Stars from ESA's Gaia catalogue, drawn where they are on each frame's date (G)">Gaia stars</button>
          <button data-v="wise" title="Where NASA's WISE saw each source in 2010: a mover has left its marker behind (W)">WISE 2010</button>
          <button data-v="mask" title="Paint the pixels NASA flags as unreliable in this exposure (M)">NASA flags</button>
          <button class="more" id="bk-morebtn" aria-expanded="false">More</button>
        </div>
        <div class="bk-more" id="bk-more" hidden>
          <div class="bk-row"><span class="eyebrow">Order frames by</span><div class="seg" id="bk-order"><button data-o="time">Time</button><button data-o="lambda" title="From blue to red light: the movie becomes the object's spectrum">Colour</button></div></div>
          <div class="bk-row"><span class="eyebrow">Detectors</span><div class="bk-dets" id="bk-dets" title="Which of SPHEREx's six detectors to use (shift-click: only this one)">${DETECTORS.map((d) => `<button data-d="${d.det}" style="--c:${detColor(d.det)}" title="Detector ${d.det}: ${d.lo}–${d.hi} µm"><i></i>${d.lo.toFixed(d.lo < 1 ? 2 : 1)}–${d.hi.toFixed(1)}</button>`).join("")}</div></div>
          <div class="bk-row"><span class="eyebrow">Picture</span><div class="bk-toggles" id="bk-pic">
            <button data-v="lock" title="One brightness scale for all frames (L)">Lock brightness</button><button data-v="smooth" title="Interpolate between pixels">Smooth pixels</button>
            <select id="bk-cmap" aria-label="Colour map"><option value="gray">Grey</option><option value="heat">Heat</option><option value="invert">Inverted</option></select>
            <select id="bk-fps" aria-label="Playback speed"><option value="2">2 frames/s</option><option value="4">4 frames/s</option><option value="6" selected>6 frames/s</option><option value="10">10 frames/s</option><option value="16">16 frames/s</option></select></div></div>
        </div>
        <p class="bk-cap bk-explain" id="bk-explain"></p>
      </section>
      <aside class="bk-side">
        <div class="bk-readouts" id="bk-readouts"></div>
        <div class="bk-tabs" id="bk-tabs" role="tablist">${TABS.map(([k, t]) => `<button role="tab" data-t="${k}">${t}</button>`).join("")}<button class="bk-help" id="bk-help" title="Show or hide the explanations" aria-label="Show or hide the explanations">?</button></div>
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
  let probe: Probe = { dx: 0, dy: 0, follow: true }, logSpec = false;
  let tab: Tab = "spectrum", order: "time" | "lambda" = "time", explain = (() => { try { return localStorage.getItem("mira.explain") === "1"; } catch { return false; } })();
  const excluded = new Set<string>();                    // exposures the user has unticked: left out of pictures and measurements
  let sources: FieldSource[] = [], srcKey = "";
  const live = () => (excluded.size ? frames.filter((f) => !excluded.has(f.exp.id)) : frames);
  const cat = { gaia: [] as CatSource[], wise: [] as CatSource[], tm: [] as TwoMass[], state: "idle" as "idle" | "loading" | "ok" | "fail" };
  let items: Item[] = [], itemsKey = "";
  const imgCache = new Map<string, Float32Array | Float32Array[]>(), lockCache = new Map<string, [number, number]>(), maskCache = new Map<Frame, Int32Array | null | "loading">();
  let shiftCache = new WeakMap<Frame, Float32Array>();
  let analysis: Analysis | null = null;
  let refreshT = 0, analyzeT = 0, hover: { i: number; j: number } | null = null;
  const c = () => (N - 1) / 2;
  const targetXY = (mjd: number): [number, number] => { const [ra, dec] = propagate(target, mjd); return skyToStamp(center[0], center[1], N, ra, dec); };
  const hasPm = () => Math.hypot(target.pmra ?? 0, target.pmdec ?? 0) > 0.02;
  const detsKey = () => [...dets].sort().join("");

  // ------------------------------------------------------------ open / build
  function open(t: BlinkTarget, o: { size?: number; frames?: number; mode?: Mode; tab?: "spectrum" | "light" | "motion" } = {}) {
    opened = true; target = { ...t }; probe = { dx: 0, dy: 0, follow: true };
    N = o.size && SIZES.includes(o.size) ? o.size : N; maxFrames = o.frames ?? maxFrames;
    dets = new Set([1, 2, 3, 4, 5, 6]); view.track = false; mode = o.mode ?? "time"; order = "time";
    tab = o.tab ?? "spectrum"; excluded.clear(); sources = []; srcKey = "";
    if (t.key === "wise-0855") { dets = new Set([5, 6]); view.track = true; mode = o.mode ?? "stack"; }   // only visible at 4–5 µm, and only when stacked
    start();
  }
  async function start() {
    ac?.abort(); ac = new AbortController(); const my = ++gen;
    frames = []; items = []; itemsKey = ""; imgCache.clear(); lockCache.clear(); maskCache.clear(); shiftCache = new WeakMap(); analysis = null; plan = null; failed = 0; errorMsg = "";
    idx = 0; building = true; playing = true; cat.gaia = []; cat.wise = []; cat.tm = []; cat.state = "idle"; center = [target.ra, target.dec];
    syncControls(); renderTarget(); renderReadouts(); renderPanel(); renderData(); paint(); setLoad("Finding the SPHEREx exposures that cover this place…", 0);
    pushState(); indexMeta().then((m) => { meta = m; if (my === gen) renderData(); });
    try {
      const b = await build(target, {
        size: N, maxFrames, signal: ac.signal, concurrency: 6,
        onPlan: (p) => { if (my !== gen) return; plan = p; center = p.center; renderTarget(); renderData(); loadCatalogs(my);
          setLoad(p.picked ? `Reading ${p.picked} of ${p.covered} exposures from NASA's archive` : "", 0); },
        onFrame: (f, done, total) => { if (my !== gen) return; const k = frames.findIndex((g) => g.mjd > f.mjd); if (k < 0) frames.push(f); else frames.splice(k, 0, f);
          labelVisits(frames); setLoad(`Reading exposures from NASA's archive · ${done} / ${total}`, done / total); scheduleRefresh(); },
        onSkip: (done, total) => { if (my === gen) setLoad(`Reading exposures from NASA's archive · ${done} / ${total}`, done / total); },
      });
      if (my !== gen) return;
      frames = b.frames; failed = b.failed; building = false; setLoad("", 1);
      if (!frames.length) errorMsg = b.covered ? "The exposures that cover this place could not be read just now. NASA's archive may be busy — try again in a moment."
        : b.listed ? "SPHEREx has not observed this exact position yet in the indexed releases (it falls in a gap between detector footprints)." : "No SPHEREx exposures are indexed for this part of the sky yet.";
      refresh(); analyze();
    } catch (e) {
      if ((e as Error).name === "AbortError" || my !== gen) return;
      building = false; errorMsg = `Could not read the exposures: ${(e as Error).message}.`; setLoad("", 1); refresh(); renderReadouts(); renderPanel();
    }
  }
  function loadCatalogs(my: number) {
    cat.state = "loading"; const r = (N * PIX_ARCSEC) / 2 * 1.45, [ra, dec] = center, pm = Math.hypot(target.pmra ?? 0, target.pmdec ?? 0);
    const wide = r + pm * 30;                                      // catalogue epochs reach back to 1998: include where a mover was
    Promise.allSettled([gaia(ra, dec, r + pm * 12), allwise(ra, dec, r + pm * 18), twomass(ra, dec, wide)]).then(([g, w, t]) => {
      if (my !== gen) return;
      if (g.status === "fulfilled") cat.gaia = g.value; if (w.status === "fulfilled") cat.wise = w.value; if (t.status === "fulfilled") cat.tm = t.value as TwoMass[];
      cat.state = g.status === "fulfilled" || w.status === "fulfilled" ? "ok" : "fail"; paint(); renderReadouts(); renderPanel(); if (!probe.follow) renderTarget();
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
    const fs = live().filter((f) => dets.has(f.det));
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
  const stack = (list: Frame[]) => robustStack(list.map(shifted), N * N);
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
    if (tab === "frames") markRow();
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
    if (tab === "sources") { ctx.strokeStyle = ctx.fillStyle = "rgba(125,240,166,.95)"; ctx.lineWidth = 1.2 * u; ctx.textAlign = "left";
      for (const q of sources) { const [x, y] = P(q.x, q.y), r = 7 * u; ctx.strokeRect(x - r, y - r, 2 * r, 2 * r); ctx.fillText(String(q.n), x + r + 3 * u, y - r); } }
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
    const key = `${mode}|${detsKey()}|${view.track}|${frames.length}|${excluded.size}`;
    if (key !== itemsKey) { const curKey = items[idx]?.key; items = buildItems(); itemsKey = key; const k = items.findIndex((i) => i.key === curKey); idx = k >= 0 ? k : Math.min(idx, Math.max(0, items.length - 1)); }
    paint(); syncControls(); tick(); if (building) renderData();
  }
  function tick() { clearTimeout(timer); if (playing && items.length > 1) timer = window.setTimeout(() => { idx = (idx + 1) % items.length; paint(); tick(); }, 1000 / (mode === "stack" || mode === "rgb" || mode === "diff" ? Math.min(fps, 1.5) : fps)); }
  function seek(k: number, pause = true) { if (!items.length) return; idx = ((k % items.length) + items.length) % items.length; if (pause) playing = false; paint(); syncControls(); tick(); }
  function seekFrame(k: number) { const f = frames[k]; if (!f) return; if (mode !== "time" && mode !== "lambda") { mode = "time"; refresh(); } const q = items.findIndex((i) => i.f === f); if (q >= 0) seek(q); }

  // ------------------------------------------------------------ analysis (spectrum, light curve, motion of the probed source)
  function analyze() {
    const used = live(), A = analyzeFrames(used, N, center, probe, probe.follow, dets);
    if (A && used !== frames) { const at = used.map((f) => frames.indexOf(f)); A.P.forEach((p) => (p.k = at[p.k])); A.motion?.pts.forEach((p) => (p.k = at[p.k])); }   // indices refer to `frames` everywhere else
    analysis = A;
    renderReadouts(); renderPanel(); renderData();
  }
  function markRow() { const f = items[idx]?.f, k = f ? frames.indexOf(f) : -1; host.querySelectorAll("#bk-ftab tr.cur").forEach((e) => e.classList.remove("cur")); if (k >= 0) host.querySelector(`#bk-ftab tr[data-k="${k}"]`)?.classList.add("cur"); }
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
  // ------------------------------------------------------------ the workbench: target bar, instrument readouts, tabs
  function renderTarget() {
    const t = target, [ra, dec] = center;
    const dist = t.plx && t.plx > 1 ? `${(3261.56 / t.plx).toFixed(t.plx > 100 ? 1 : 0)} light-years` : "";
    $("#bk-target").innerHTML = `<div class="eyebrow">${esc([t.otype ?? (t.name ? "" : "Sky position"), dist].filter(Boolean).join(" · ") || "Target")}</div>
      <h1 class="display">${esc(t.name ?? sexa(t.ra, t.dec))}</h1>
      <div class="bk-coord mono">${sexa(ra, dec)} · ${ra.toFixed(5)}° ${dec >= 0 ? "+" : ""}${dec.toFixed(5)}° ICRS${hasPm() ? ` · μ ${fmtPm(t.pmra ?? 0)}, ${fmtPm(t.pmdec ?? 0)} ″/yr (${esc(t.source ?? "catalogue")})` : ""}</div>
      ${t.note ? `<div class="bk-note warn">${t.note}</div>` : ""}${probe.follow ? "" : probeLine()}`;
    host.querySelector<HTMLElement>("#bk-unprobe")?.addEventListener("click", () => { probe = { dx: 0, dy: 0, follow: true }; analyze(); renderTarget(); paint(); });
    host.querySelector<HTMLElement>("#bk-recentre")?.addEventListener("click", () => { const [r2, d2] = probeSky(2016), g = nearest(cat.gaia, 5);
      open(g ? { ra: g.ra, dec: g.dec, pmra: g.pmra, pmdec: g.pmdec, epoch: g.epoch, name: g.id, plx: g.plx ?? undefined, source: "Gaia DR3", otype: "star" } : { ra: r2, dec: d2 }); });
  }
  function renderData() {
    const used = live(), nv = used.length ? used[used.length - 1].visit + 1 : 0, el = $("#bk-data");
    el.innerHTML = !plan ? "" : `<span>${building ? "reading" : ""} <b>${frames.length}</b> / ${plan.covered} exposures${excluded.size ? ` · ${excluded.size} excluded` : ""}${failed ? ` · ${failed} unreadable` : ""}</span>
      ${frames.length ? `<span>${nv} visit${nv > 1 ? "s" : ""}</span><span>${mjdToDate(frames[0].mjd)} → ${mjdToDate(frames[frames.length - 1].mjd)}</span>` : ""}
      ${meta ? `<span title="Date of the newest SPHEREx exposure in MIRA's index; the index is rebuilt after each NASA data release">archive through ${meta.last}</span>` : ""}${opts.embed ? `<a href="${shareUrl()}" target="_blank" rel="noopener">open in MIRA ↗</a>` : ""}`;
  }
  function syncControls() {
    host.querySelectorAll<HTMLElement>("#bk-views button").forEach((b) => b.classList.toggle("on", b.dataset.v === "frames" ? mode === "time" || mode === "lambda" : b.dataset.v === mode));
    host.querySelectorAll<HTMLElement>("#bk-order button").forEach((b) => b.classList.toggle("on", b.dataset.o === order));
    host.querySelectorAll<HTMLElement>("#bk-fov button").forEach((b) => b.classList.toggle("on", +b.dataset.s! === N));
    host.querySelectorAll<HTMLElement>("#bk-n button").forEach((b) => b.classList.toggle("on", +b.dataset.n! === maxFrames));
    host.querySelectorAll<HTMLElement>("#bk-dets button").forEach((b) => b.classList.toggle("on", dets.has(+b.dataset.d!)));
    host.querySelectorAll<HTMLElement>("#bk-toggles button[data-v], #bk-pic button[data-v]").forEach((b) => { const k = b.dataset.v!; b.classList.toggle("on", k === "lock" ? lock[mode] : (view as any)[k]); });
    host.querySelectorAll<HTMLElement>("#bk-tabs button[data-t]").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
    host.querySelectorAll<HTMLElement>(".bk-try .chip").forEach((b) => b.classList.toggle("on", b.dataset.key === target.key));
    $("#bk-start").hidden = opened; $("#bk-body").hidden = !opened;
    $("#bk-play").textContent = playing ? "❚❚" : "▶";
    $("#bk-explain").textContent = EXPLAIN[mode];
    host.querySelector(".bk")!.classList.toggle("explain", explain); $("#bk-help").classList.toggle("on", explain);
    const n = plan?.picked ?? Math.min(maxFrames, 120); $("#bk-cost").textContent = `≈ ${Math.round((n * ((N * 1.42 + 3) * 8160 + 60000)) / 1e6)} MB`;
    $("#bk-cost").title = "Read from NASA's archive for this field of view and number of exposures. Wider or more = slower.";
    const tg = host.querySelector<HTMLElement>('#bk-toggles [data-v="track"]'); if (tg) tg.style.display = hasPm() ? "" : "none";
    const extra = dets.size < 6 || order === "lambda" || lock[mode] || view.smooth || view.cmap !== "gray"; $("#bk-morebtn").classList.toggle("dot", extra);
  }
  const probeLine = () => { const [ra, dec] = probeSky(2016), g = nearest(cat.gaia, 5);
    return `<div class="bk-probe"><span><i class="dot"></i>Measuring the selected source · <b class="mono">${sexa(ra, dec)}</b>${g ? ` · ${esc(g.id)} · G ${g.mag?.toFixed(1) ?? "–"}` : ""}</span>
      <span><button class="link" id="bk-unprobe">back to target</button> · <button class="link" id="bk-recentre">observe it</button></span></div>`; };

  type InsKey = "made" | "change" | "move";
  const INS: Record<InsKey, { name: string; tab: Tab }> = { made: { name: "Spectrograph", tab: "spectrum" }, change: { name: "Photometer", tab: "light" }, move: { name: "Astrometer", tab: "motion" } };
  let answers: Record<InsKey, Answer> | null = null;
  /** three instrument readouts in one row; each opens its tab */
  function renderReadouts() {
    const el = $("#bk-readouts"), A = analysis;
    const bl = A && cat.gaia.length ? blend() : null, g = probe.follow ? null : nearest(cat.gaia, 5);
    const ref = probe.follow ? target : g ? { pmra: g.pmra, pmdec: g.pmdec, source: "Gaia DR3" } : null;
    answers = { made: answerMade(A, bl && { mag: bl.g.mag, sep: bl.sep }), change: answerChange(A), move: answerMove(A, ref) };
    el.innerHTML = (["made", "change", "move"] as InsKey[]).map((k) => { const a = answers![k];
      return `<button class="bk-ro ${a.tone}${INS[k].tab === tab ? " on" : ""}" data-t="${INS[k].tab}" title="${esc(a.text.replace(/<[^>]+>/g, ""))}">
        <span class="l">${INS[k].name}<em class="tag ${a.tone}">${esc(a.chip)}</em></span><span class="v">${esc(a.big)}<small>${esc(a.unit)}</small></span><span class="s">${esc(a.label)}</span></button>`; }).join("");
    el.querySelectorAll<HTMLButtonElement>(".bk-ro").forEach((b) => (b.onclick = () => { tab = b.dataset.t as Tab; syncControls(); renderReadouts(); renderPanel(); }));
  }
  const tbl = (head: string[], rows: string[][], cls = "") => `<div class="bk-tw"><table class="bk-table ${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const csv = (name: string, head: string[], rows: (string | number)[][], comment = "") => save(new Blob([`# MIRA · ${target.name ?? ""} · RA ${center[0].toFixed(6)} Dec ${center[1].toFixed(6)} (ICRS)${comment ? ` · ${comment}` : ""}\n${head.join(",")}\n${rows.map((r) => r.join(",")).join("\n")}\n`], { type: "text/csv" }), `${fileStem()}_${name}.csv`);
  function renderPanel() {
    const el = $("#bk-panel"), A = analysis;
    if (errorMsg && !frames.length) { el.innerHTML = `<div class="bk-empty">${esc(errorMsg)}</div>`; return; }
    if (tab === "frames") return renderFrames(el);
    if (tab === "export") return renderExport(el);
    if (tab === "sources") return renderSources(el);
    if (!A) { el.innerHTML = `<div class="bk-empty">${opened ? "Measuring as the exposures arrive…" : ""}</div>`; return; }
    const a = answers?.[tab === "spectrum" ? "made" : tab === "light" ? "change" : "move"], line = a?.text ? `<p class="bk-cap lead">${a.text}</p>` : "";
    if (tab === "spectrum") {
      const per = [1, 2, 3, 4, 5, 6].map((d) => { const v = A.P.filter((p) => p.det === d), c = v.filter((p) => !p.flagged), q = DETECTORS[d - 1];
        return [`<i class="sw" style="background:${detColor(d)}"></i>D${d}`, `${q.lo.toFixed(2)}–${q.hi.toFixed(2)}`, String(v.length), c.length ? median(c.map((p) => p.flux)).toPrecision(3) : "–", c.length ? median(c.map((p) => p.snr)).toFixed(0) : "–", String(v.length - c.length)]; });
      el.innerHTML = `${line}<div class="bk-plot-host"></div>
        <div class="bk-bar2"><span class="mono">${A.P.length} measurements · ${A.nFlagged} flagged</span><span><button class="link" id="bk-log">${logSpec ? "linear" : "log"}</button><button class="link" id="bk-csv">CSV</button></span></div>
        ${tbl(["detector", "µm", "n", "median mJy", "S/N", "flagged"], per, "num")}
        <p class="bk-cap">Each point is one 2-minute exposure: SPHEREx's filter changes wavelength across each detector, so every exposure samples the source at a different wavelength. PSF-weighted photometry (Gaussian of the exposure's FWHM), local sky from a 5–8 px annulus. Line: median. ◇ catalogue fluxes of the same source (2MASS 1998, AllWISE 2010). Hollow: flagged by NASA. Click a point to open that exposure.</p>`;
      drawSpectrum(el.querySelector(".bk-plot-host") as HTMLElement, A.P, { log: logSpec, bins: A.bins.filter((b) => b.n >= 1), anchors: anchors(), onPick: seekFrame });
      (el.querySelector("#bk-log") as HTMLElement).onclick = () => { logSpec = !logSpec; renderPanel(); }; (el.querySelector("#bk-csv") as HTMLElement).onclick = downloadCsv;
    } else if (tab === "light") {
      const S2 = [A.lc.all, ...A.lc.series].filter((q) => q.visits.length >= 2), rows = S2.flatMap((q) => q.visits.map((v) => [q.det ? `<i class="sw" style="background:${detColor(q.det)}"></i>D${q.det}` : "all", mjdToDate(v.mjd), v.ratio.toFixed(3), v.err.toFixed(3), String(v.n)]));
      el.innerHTML = `${line}${A.halo ? `<div class="bk-warn">Saturated source: levels come from its unsaturated halo (25–43″), not its core.</div>` : ""}<div class="bk-plot-host"></div>
        <div class="bk-bar2"><span class="mono">${A.lc.pairs} wavelength-matched pairs</span><span><button class="link" id="bk-csv">CSV</button></span></div>
        ${rows.length ? tbl(["band", "visit (mean date)", "level", "±", "pairs"], rows, "num") : ""}
        <p class="bk-cap">Brightness is compared only between exposures of different visits that saw the same wavelength (same detector, within 1.2%); the per-visit levels are solved from all such pairs and normalised to the source's own mean. A constant source sits at 1.00. On saturated stars the unsaturated halo is used; on the constant Barnard's Star it repeats to about 2%.</p>`;
      drawLightCurve(el.querySelector(".bk-plot-host") as HTMLElement, A.lc);
      (el.querySelector("#bk-csv") as HTMLElement).onclick = () => csv("lightcurve", ["band", "visit", "mean_mjd", "level", "level_err", "matched_pairs"], S2.flatMap((q) => q.visits.map((v) => [q.det ? `D${q.det}` : "all", v.visit + 1, v.mjd.toFixed(3), v.ratio.toFixed(4), v.err.toFixed(4), v.n])), "brightness relative to the source's own mean, from wavelength-matched pairs");
    } else {
      const m = A.motion;
      if (!m) { el.innerHTML = `${line}<p class="bk-cap show">A fit needs the source's centre in six or more clean exposures (above 8σ, unflagged) over two or more visits. Measured here: ${A.P.length} exposures, ${A.nFlagged} flagged.</p>`; return; }
      const g = probe.follow ? null : nearest(cat.gaia, 5), ref = probe.follow && hasPm() ? { pmra: target.pmra!, pmdec: target.pmdec!, plx: target.plx, src: target.source ?? "catalogue" } : g ? { pmra: g.pmra, pmdec: g.pmdec, plx: g.plx ?? undefined, src: "Gaia DR3" } : null, ep = plxError(m);
      el.innerHTML = `${line}${A.motionFlagged ? `<div class="bk-warn">Every exposure is flagged (saturated): centres come from the wings of the image. Indicative only.</div>` : ""}<div class="bk-plot-host"></div>
        <div class="bk-bar2"><span class="mono">${m.n} of ${m.pts.length} centroids used · rms ${m.rms.toFixed(2)}″</span><span><button class="link" id="bk-csv">CSV</button></span></div>
        ${tbl(["", "μα cos δ ″/yr", "μδ ″/yr", "ϖ ″"], [[`SPHEREx <small>${m.visits} visits · ${(m.span / 365.25).toFixed(1)} yr</small>`, `${fmtPm(m.pmra)} ± ${m.epmra.toFixed(2)}`, `${fmtPm(m.pmdec)} ± ${m.epmdec.toFixed(2)}`, m.plx === null ? "–" : `${m.plx.toFixed(2)} ± ${ep.toFixed(2)}`],
          ...(ref ? [[esc(ref.src), fmtPm(ref.pmra), fmtPm(ref.pmdec), ref.plx ? (ref.plx / 1000).toFixed(3) : "–"]] : [])], "num")}
        <p class="bk-cap">Gaussian-windowed centroid in every clean exposure where the source is above 8σ; weighted least-squares fit of position, proper motion${m.withParallax ? " and parallax" : ""} with outlier rejection (hollow points). A SPHEREx pixel is 6.15″.${m.withParallax ? ` The parallax error includes ${PLX_SYS}″ systematic: the spacecraft's roll flips between visits six months apart, in step with the parallax swing.` : " Parallax is fitted only with three or more visits over 300 days."}</p>`;
      drawMotion(el.querySelector(".bk-plot-host") as HTMLElement, m, { onPick: seekFrame });
      (el.querySelector("#bk-csv") as HTMLElement).onclick = () => csv("astrometry", ["mjd", "date_utc", "xi_east_arcsec", "eta_north_arcsec", "err_arcsec", "used", "visit", "observation"], m.pts.map((p) => [p.mjd.toFixed(5), frames[p.k].dateObs, p.xi.toFixed(3), p.eta.toFixed(3), p.err.toFixed(3), p.used ? 1 : 0, p.visit + 1, `${frames[p.k].obsid}D${frames[p.k].det}`]), "tangent-plane offsets from the field centre");
    }
    markCurrent();
  }
  /** every exposure, with its flags; untick one to leave it out of the pictures and the measurements */
  function renderFrames(el: HTMLElement) {
    const bad = badMask(), cur = items[idx]?.f;
    el.innerHTML = `<div class="bk-bar2"><span class="mono">${frames.length - excluded.size} of ${frames.length} in use</span><span><button class="link" id="bk-xflag">exclude flagged</button><button class="link" id="bk-xnone">use all</button><button class="link" id="bk-csv">CSV</button></span></div>
      <div class="bk-tw tall"><table class="bk-table num rows" id="bk-ftab"><thead><tr><th>use</th><th>date (UTC)</th><th>det</th><th>λ µm</th><th>flags at target</th><th>noise</th><th></th></tr></thead><tbody>
      ${frames.map((f, k) => { const fl = flagNames(f.flags, true); return `<tr data-k="${k}" class="${f === cur ? "cur" : ""}${excluded.has(f.exp.id) ? " off" : ""}"><td><input type="checkbox" ${excluded.has(f.exp.id) ? "" : "checked"} aria-label="Use this exposure"></td><td>${esc(f.dateObs.slice(0, 16).replace("T", " "))}</td>
        <td><i class="sw" style="background:${detColor(f.det)}"></i>${f.det}</td><td>${f.lam.toFixed(3)}</td><td class="${f.flags > 0 && f.flags & bad ? "bad" : ""}">${f.flags < 0 ? "?" : fl.length ? fl.join(" ") : "–"}</td><td>${f.noise.toFixed(3)}</td><td><a href="${f.exp.url}" target="_blank" rel="noopener" title="Download this exposure from NASA's archive (FITS, 65 MB)">FITS</a></td></tr>`; }).join("")}</tbody></table></div>
      <p class="bk-cap">Flags are NASA's, read from each exposure's FLAGS extension within 1.5 px of the target (SOURCE and FULLSAMPLE are informational and not listed). Noise: robust pixel scatter in MJy/sr after removing the sky background. Click a row to open that exposure; “NASA flags” above the image paints its full mask.</p>`;
    const again = () => { imgCache.clear(); itemsKey = ""; refresh(); analyze(); renderFrames($("#bk-panel")); };
    el.querySelectorAll<HTMLTableRowElement>("#bk-ftab tbody tr").forEach((tr) => { const f = frames[+tr.dataset.k!];
      tr.onclick = (e) => { if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "A") return; seekFrame(+tr.dataset.k!); };
      (tr.querySelector("input") as HTMLInputElement).onchange = (e) => { if ((e.target as HTMLInputElement).checked) excluded.delete(f.exp.id); else excluded.add(f.exp.id); again(); }; });
    (el.querySelector("#bk-xflag") as HTMLElement).onclick = () => { frames.forEach((f) => { if (f.flags > 0 && f.flags & bad) excluded.add(f.exp.id); }); if (excluded.size >= frames.length) excluded.clear(); again(); };
    (el.querySelector("#bk-xnone") as HTMLElement).onclick = () => { excluded.clear(); again(); };
    (el.querySelector("#bk-csv") as HTMLElement).onclick = () => csv("exposures", ["mjd", "date_utc", "detector", "wavelength_um", "bandwidth_um", "flags_at_target", "flag_names", "sky_MJy_sr", "noise_MJy_sr", "psf_fwhm_arcsec", "exptime_s", "used", "url"],
      frames.map((f) => [f.mjd.toFixed(5), f.dateObs, f.det, f.lam.toFixed(4), f.bw.toFixed(4), f.flags, `"${flagNames(f.flags).join(" ")}"`, f.bg.toFixed(4), f.noise.toFixed(4), isFinite(f.psf) ? f.psf.toFixed(2) : "", isFinite(f.exptime) ? f.exptime.toFixed(1) : "", excluded.has(f.exp.id) ? 0 : 1, f.exp.url]));
  }
  /** everything detected in the field, against Gaia and WISE: the rows the catalogues do not explain are the interesting ones */
  function renderSources(el: HTMLElement) {
    if (building || frames.length < 6) { el.innerHTML = `<div class="bk-empty">The source list is made from the deep stacks once the exposures are in.</div>`; return; }
    const used = live(), key = `${used.length}|${cat.gaia.length}|${cat.wise.length}`, year = mjdToYear((used[0].mjd + used[used.length - 1].mjd) / 2);
    if (srcKey !== key) { sources = findSources(used, N, center, { gaia: cat.gaia, wise: cat.wise, gaiaOk: cat.state === "ok" }, year, targetXY((used[0].mjd + used[used.length - 1].mjd) / 2)); srcKey = key; paint(); }
    const S2 = sources, f1 = (v: number) => (Number.isFinite(v) ? (v > 999 ? ">999" : v.toFixed(0)) : "–");
    el.innerHTML = `<div class="bk-bar2"><span class="mono">${S2.length} sources above 5σ in the stacks${cat.state === "loading" ? " · catalogues loading…" : cat.state === "fail" ? " · catalogue service unreachable" : ""}</span><span><button class="link" id="bk-csv">CSV</button></span></div>
      <div class="bk-tw tall"><table class="bk-table num rows" id="bk-stab"><thead><tr><th>#</th><th>RA, Dec (ICRS)</th><th title="Signal-to-noise in the stack of detectors 1–3">S/N 0.75–2.4</th><th title="Signal-to-noise in the stack of detectors 5–6">S/N 3.8–5</th><th>Gaia G</th><th>W1−W2</th><th>note</th></tr></thead><tbody>
      ${S2.map((q) => `<tr data-n="${q.n}" class="${q.isTarget ? "cur" : ""}"><td>${q.n}</td><td>${q.ra.toFixed(5)}, ${q.dec >= 0 ? "+" : ""}${q.dec.toFixed(5)}</td><td>${f1(q.snrBlue)}</td><td>${f1(q.snrRed)}</td><td>${q.gaia?.mag != null ? q.gaia.mag.toFixed(1) : "–"}</td>
        <td>${q.wise && q.wise.mag != null && q.wise.mag2 != null ? (q.wise.mag2 - q.wise.mag).toFixed(2) : "–"}</td><td class="${q.notes.some((x) => /red only|not in Gaia/.test(x)) ? "hl" : ""}">${q.isTarget ? "target" : ""}${q.isTarget && q.notes.length ? " · " : ""}${esc(q.notes.join(" · "))}</td></tr>`).join("")}</tbody></table></div>
      <p class="bk-cap">Local maxima above 5σ in two robust stacks of all visits (detectors 1–3 and 5–6), matched within 6.5″ to Gaia DR3 (moved to the stack's epoch) and AllWISE. “Red only” and “not in Gaia” mark sources the optical catalogues miss: cold or dust-hidden objects, or artifacts — check their exposures. Sources moving faster than about 4″ a year smear in these sky-fixed stacks. Click a row to measure that source.</p>`;
    el.querySelectorAll<HTMLTableRowElement>("#bk-stab tbody tr").forEach((tr) => (tr.onclick = () => { const q = S2.find((x) => x.n === +tr.dataset.n!); if (!q) return;
      probe = q.isTarget ? { dx: 0, dy: 0, follow: true } : { dx: q.x - c(), dy: q.y - c(), follow: false }; tab = "spectrum"; analyze(); renderTarget(); syncControls(); paint(); }));
    (el.querySelector("#bk-csv") as HTMLElement).onclick = () => csv("sources", ["n", "ra_deg", "dec_deg", "snr_blue_stack", "snr_red_stack", "gaia_dr3", "gaia_G", "gaia_pm_arcsec_yr", "allwise_W1", "allwise_W2", "notes"],
      S2.map((q) => [q.n, q.ra.toFixed(6), q.dec.toFixed(6), f1(q.snrBlue), f1(q.snrRed), q.gaia?.id.replace("Gaia DR3 ", "") ?? "", q.gaia?.mag?.toFixed(3) ?? "", q.gaia ? Math.hypot(q.gaia.pmra, q.gaia.pmdec).toFixed(4) : "", q.wise?.mag2?.toFixed(3) ?? "", q.wise?.mag?.toFixed(3) ?? "", `"${q.notes.join("; ")}"`]));
  }
  function shareUrl(embed = false) {
    const p = stateParams(); if (embed) p.set("embed", "1"); return `${location.origin}${location.pathname}?${p.toString()}`;
  }
  function renderExport(el: HTMLElement) {
    const url = shareUrl(), iframe = `<iframe src="${shareUrl(true)}" width="960" height="680" style="border:0" loading="lazy" allowfullscreen></iframe>`, used = live();
    el.innerHTML = `<div class="eyebrow">Data</div>
      <div class="bk-actions"><button class="btn sm" id="bk-fits" title="The registered frames as a FITS cube with WCS, plus a table of the exposures">Registered cube (FITS)</button><button class="btn sm ghost" data-x="spectrum">Spectrum</button><button class="btn sm ghost" data-x="light">Light curve</button>
        <button class="btn sm ghost" data-x="motion">Astrometry</button><button class="btn sm ghost" data-x="sources">Sources</button><button class="btn sm ghost" data-x="frames">Exposures</button></div>
      <p class="bk-cap show">CSV tables carry their units in the column names; the FITS cube is in MJy/sr, north up, ${N} × ${N} px at 6.15″, one plane per exposure in use (${used.length}).</p>
      <div class="eyebrow sec">Pictures</div><div class="bk-actions"><button class="btn sm ghost" id="bk-png">This frame (PNG)</button><button class="btn sm ghost" id="bk-webm">Movie (WebM)</button></div>
      <div class="eyebrow sec">Link to this observation</div><div class="bk-copy"><input readonly value="${esc(url)}" id="bk-url"><button class="btn sm" data-copy="bk-url">Copy</button></div>
      <div class="eyebrow sec">Embed</div><div class="bk-copy"><input readonly value="${esc(iframe)}" id="bk-emb"><button class="btn sm" data-copy="bk-emb">Copy</button></div>
      <div class="eyebrow sec">Reproduce in Python (astropy)</div><textarea class="bk-code" id="bk-py" readonly rows="7" spellcheck="false">${esc(pythonSnippet(used, N, center, target.name ?? "this position"))}</textarea>
      <div class="bk-actions"><button class="btn sm ghost" data-copy="bk-py">Copy code</button></div>
      <div class="eyebrow sec">The same position elsewhere</div>
      <div class="bk-actions">${opts.onAtlas ? `<button class="btn sm ghost" id="bk-atlas">MIRA sky map</button>` : ""}
        <a class="btn sm ghost" target="_blank" rel="noopener" href="http://byw.tools/wiseview#ra=${center[0]}&dec=${center[1]}&size=176&band=3&speed=200&minbright=-50&maxbright=500&window=0.5&diff_window=1&linear=1&zoom=9">WiseView ↗</a>
        <a class="btn sm ghost" target="_blank" rel="noopener" href="https://irsa.ipac.caltech.edu/applications/spherex/?__action=layout.showDropDown&view=MultiTableSearchCmd&position=${center[0]}+${center[1]}">IRSA ↗</a>
        <a class="btn sm ghost" target="_blank" rel="noopener" href="https://simbad.cfa.harvard.edu/simbad/sim-coo?Coord=${center[0]}+${center[1]}&Radius=30&Radius.unit=arcsec">SIMBAD ↗</a></div>`;
    el.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((b) => (b.onclick = () => { const v = ($(`#${b.dataset.copy}`) as HTMLInputElement).value, t0 = b.textContent; navigator.clipboard?.writeText(v); b.textContent = "Copied"; setTimeout(() => (b.textContent = t0), 1400); }));
    el.querySelectorAll<HTMLButtonElement>("[data-x]").forEach((b) => (b.onclick = () => { if (b.dataset.x === "spectrum") { downloadCsv(); return; } const keep = tab; tab = b.dataset.x as Tab; renderPanel(); ($("#bk-panel").querySelector("#bk-csv") as HTMLElement | null)?.click(); tab = keep; renderPanel(); }));
    $("#bk-fits").onclick = () => { if (used.length) save(fitsCube(used, N, center, target.name ?? sexa(center[0], center[1])), `${fileStem()}_cube.fits`); };
    $("#bk-png").onclick = () => cv.toBlob((b) => b && save(b, `${fileStem()}.png`));
    $("#bk-webm").onclick = recordMovie;
    const at = host.querySelector<HTMLElement>("#bk-atlas"); if (at) at.onclick = () => opts.onAtlas?.(center[0], center[1]);
  }
  const fileStem = () => `mira_${(target.name ?? `${center[0].toFixed(4)}_${center[1].toFixed(4)}`).replace(/[^\w.+-]+/g, "_")}`;
  function save(b: Blob, name: string) { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  function downloadCsv() {
    if (!analysis) return;
    csv("spectrum", ["mjd", "date_utc", "detector", "wavelength_um", "bandwidth_um", "flux_mJy", "flux_err_mJy", "flagged", "observation"],
      analysis.P.map((p) => { const f = frames[p.k]; return [p.mjd.toFixed(5), f.dateObs, p.det, p.lam.toFixed(4), p.bw.toFixed(4), p.flux.toFixed(4), p.err.toFixed(4), p.flagged ? 1 : 0, `${f.obsid}D${f.det}`]; }), "PSF-weighted flux from SPHEREx Level-2 exposures (NASA/IPAC IRSA)");
  }
  function recordMovie() {
    const MR = (window as any).MediaRecorder; if (!MR || !cv.captureStream || items.length < 2) { toast("Movie export is not supported in this browser"); return; }
    const stream = cv.captureStream(30), rec = new MR(stream, { mimeType: MR.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm", videoBitsPerSecond: 6e6 }), chunks: Blob[] = [];
    rec.ondataavailable = (e: any) => e.data.size && chunks.push(e.data); rec.onstop = () => { save(new Blob(chunks, { type: "video/webm" }), `${fileStem()}.webm`); tick(); };
    clearTimeout(timer); playing = false; let k = 0; idx = 0; paint(); rec.start(); toast("Recording one loop…");
    const step = () => { if (++k >= items.length) { setTimeout(() => rec.stop(), 300); return; } idx = k; paint(); setTimeout(step, 1000 / Math.min(fps, 8)); };
    setTimeout(step, 1000 / Math.min(fps, 8));
  }
  /** what the Logbook keeps of an observation: the place, the three answers, a thumbnail and what data it rested on */
  function snapshot(): Snapshot {
    const brief = (a: Answer) => ({ chip: a.chip, text: `${a.big}${a.unit ? ` ${a.unit}` : ""} — ${a.label}` }), th = document.createElement("canvas"); th.width = th.height = 112;
    const g = th.getContext("2d")!; g.imageSmoothingEnabled = false; try { g.drawImage(cv, 0, 0, 112, 112); } catch { /* blank thumbnail */ }
    return { target: { ...target }, center: [...center] as [number, number], size: N, frames: frames.length, covered: plan?.covered ?? 0, lastMjd: frames.length ? frames[frames.length - 1].mjd : 0, thumb: th.toDataURL("image/jpeg", 0.72),
      answers: answers ? { move: brief(answers.move), change: brief(answers.change), made: brief(answers.made) } : null, url: shareUrl() };
  }

  // ------------------------------------------------------------ start screen: a real pair of SPHEREx pictures, flipping
  let demoT = 0;
  function loadDemo() {
    fetch(`${import.meta.env.BASE_URL}lab/demo.json`).then((r) => (r.ok && !(r.headers.get("content-type") ?? "").includes("html") ? r.json() : null)).then((d) => {
      if (!d?.plates?.length) return;
      const fig = $("#bk-demo"), c2 = fig.querySelector("canvas") as HTMLCanvasElement, g = c2.getContext("2d")!, n = d.n as number;
      const imgs = (d.plates as string[]).map((b64) => { const bin = atob(b64), id = new ImageData(n, n); for (let k = 0; k < n * n; k++) { const v = bin.charCodeAt(k); id.data[k * 4] = v; id.data[k * 4 + 1] = v; id.data[k * 4 + 2] = Math.min(255, v * 1.03); id.data[k * 4 + 3] = 255; } const o = document.createElement("canvas"); o.width = o.height = n; o.getContext("2d")!.putImageData(id, 0, 0); return o; });
      fig.hidden = false; (fig.querySelector("figcaption") as HTMLElement).innerHTML = d.caption;
      let k = 0; const draw = () => { if (opened) return; g.imageSmoothingEnabled = false; g.drawImage(imgs[k % imgs.length], 0, 0, c2.width, c2.height);
        g.font = '500 13px "JetBrains Mono", monospace'; g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(10, 10, 104, 24); g.fillStyle = "#f0f0fa"; g.fillText(d.dates[k % imgs.length], 18, 27); k++; };
      draw(); clearInterval(demoT); demoT = window.setInterval(draw, 850);
    }).catch(() => { /* no demo file: the start screen simply has no picture */ });
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
  async function go(q: string, size?: number, fallback?: BlinkTarget) {
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
    if (fallback) return open(fallback);
    toast(`Could not find “${q}”. Try coordinates: RA Dec in degrees or sexagesimal.`);
  }

  // ------------------------------------------------------------ events
  ($("#bk-go") as HTMLFormElement).onsubmit = (e) => { e.preventDefault(); const i = $("#bk-q") as HTMLInputElement; i.blur(); go(i.value); };
  host.querySelectorAll<HTMLButtonElement>(".bk-try .chip").forEach((b) => (b.onclick = () => go(b.dataset.key!)));
  function setViewMode(v: string) { mode = v === "frames" ? (order === "lambda" ? "lambda" : "time") : (v as Mode); idx = 0; refresh(); }
  host.querySelectorAll<HTMLButtonElement>("#bk-views button").forEach((b) => (b.onclick = () => setViewMode(b.dataset.v!)));
  host.querySelectorAll<HTMLButtonElement>("#bk-order button").forEach((b) => (b.onclick = () => { order = b.dataset.o as "time" | "lambda"; setViewMode("frames"); }));
  host.querySelectorAll<HTMLButtonElement>("#bk-fov button").forEach((b) => (b.onclick = () => { if (+b.dataset.s! !== N) { N = +b.dataset.s!; if (opened) start(); else syncControls(); } }));
  host.querySelectorAll<HTMLButtonElement>("#bk-n button").forEach((b) => (b.onclick = () => { if (+b.dataset.n! !== maxFrames) { maxFrames = +b.dataset.n!; if (opened) start(); else syncControls(); } }));
  host.querySelectorAll<HTMLButtonElement>("#bk-dets button").forEach((b) => (b.onclick = (e) => { const d = +b.dataset.d!;
    if ((e as MouseEvent).shiftKey || (e as MouseEvent).altKey) dets = new Set([d]); else if (dets.has(d)) { if (dets.size > 1) dets.delete(d); } else dets.add(d);
    idx = 0; refresh(); analyze(); }));
  host.querySelectorAll<HTMLButtonElement>("#bk-toggles button[data-v], #bk-pic button[data-v]").forEach((b) => (b.onclick = () => toggle(b.dataset.v!)));
  function toggle(k: string) {
    if (k === "lock") lock[mode] = !lock[mode]; else (view as any)[k] = !(view as any)[k];
    if (k === "track") { imgCache.clear(); itemsKey = ""; }
    if ((k === "gaia" || k === "wise") && cat.state === "fail") toast("The star catalogue service (CDS VizieR) is not answering right now");
    refresh();
  }
  $("#bk-morebtn").onclick = () => { const m = $("#bk-more"); m.hidden = !m.hidden; $("#bk-morebtn").setAttribute("aria-expanded", String(!m.hidden)); $("#bk-morebtn").classList.toggle("on", !m.hidden); };
  ($("#bk-cmap") as HTMLSelectElement).onchange = (e) => { view.cmap = (e.target as HTMLSelectElement).value; paint(); syncControls(); };
  ($("#bk-fps") as HTMLSelectElement).onchange = (e) => { fps = +(e.target as HTMLSelectElement).value; tick(); };
  host.querySelectorAll<HTMLButtonElement>("#bk-tabs button[data-t]").forEach((b) => (b.onclick = () => { tab = b.dataset.t as Tab; syncControls(); renderReadouts(); renderPanel(); paint(); }));
  $("#bk-help").onclick = () => { explain = !explain; try { localStorage.setItem("mira.explain", explain ? "1" : "0"); } catch { /* private mode */ } syncControls(); };
  const sv = host.querySelector<HTMLButtonElement>("#bk-save");
  if (sv) sv.onclick = () => { if (!frames.length) return; opts.onSave?.(snapshot()); sv.textContent = "Saved ✓"; setTimeout(() => (sv.textContent = "Save to logbook"), 1800); };
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
    analyze(); renderTarget(); syncControls(); paint();
  });
  const onKey = (e: KeyboardEvent) => {
    if (!host.classList.contains("open") && !opts.embed) return;
    const tag = (e.target as HTMLElement).tagName; if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey) return;
    if (e.code === "Space") { e.preventDefault(); playing = !playing; syncControls(); tick(); }
    else if (e.key === "ArrowRight") seek(idx + 1); else if (e.key === "ArrowLeft") seek(idx - 1);
    else if (e.key >= "1" && e.key <= "4") setViewMode(VIEWS[+e.key - 1].k);
    else if (e.key === "t" && hasPm()) toggle("track"); else if (e.key === "g") toggle("gaia"); else if (e.key === "w") toggle("wise"); else if (e.key === "m") toggle("mask"); else if (e.key === "l") toggle("lock");
  };
  addEventListener("keydown", onKey);
  const ro = new ResizeObserver(() => { if (opened) paint(); }); ro.observe($("#bk-stage"));
  void hover;
  syncControls(); renderTarget(); renderReadouts(); renderPanel(); renderData(); hud(null); loadDemo();

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
    destroy() { ac?.abort(); clearTimeout(timer); clearInterval(demoT); removeEventListener("keydown", onKey); ro.disconnect(); host.innerHTML = ""; },
    get isOpen() { return opened; },
  };
}
