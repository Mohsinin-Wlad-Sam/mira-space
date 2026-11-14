// THE LAB — the working environment. Point at a place in the sky; the instruments read every SPHEREx exposure of it
// from NASA's archive and answer, on that field: what moved (motion detector), how fast and how far (astrometer),
// what it is (spectrograph), whether its brightness changed (photometer), and what could still hide there (detection
// limits). The image on the left is the same data as a continuous time evolution the user steers.
// Engine: engine.ts; detector: detect.ts; measurements: measure.ts; plots: plots.ts.
import "./blink.css";
import { sexa } from "../data";
import {
  build, readMask, propagate, skyToStamp, stampToSky, flagNames, badMask, indexMeta, labelVisits, mjdToDate, mjdToYear, loadLvf, setFlagDefs,
  DETECTORS, FLAG_DEFS, PIX_ARCSEC, type Frame, type Target, type IndexMeta,
} from "./engine";
import { PLX_SYS } from "./measure";
import { analyzeFrames, answerMove, answerChange, answerMade, plxError, type Analysis, type Answer } from "./answers";
import { levels, shiftImage, robustStack, asinhT } from "./imaging";
import { gaia, allwise, twomass, catPos, magToMjy, angSep, BANDS, CHALLENGE, parseCoords, resolveName, knownMoverNear, type CatSource } from "./catalogs";
import { drawSpectrum, drawLightCurve, drawMotion, drawHistory, drawTrack, drawLimits, detColor, lamColor, type HistPoint } from "./plots";
import { detectChanges, type FieldReport, type ChangeRow } from "./detect";
import { BODIES, reach, halfYearShift, fmtDist } from "./planetx";
import { fitsCube, pythonSnippet } from "./fits";

export type BlinkTarget = Target & { plx?: number; otype?: string; sptype?: string; source?: string; key?: string; note?: string };
/** what "Save to logbook" hands over */
export type Snapshot = { target: BlinkTarget; center: [number, number]; size: number; frames: number; covered: number; lastMjd: number; thumb: string; url: string;
  answers: Record<"move" | "change" | "made", { chip: string; text: string }> | null };
export type BlinkOpts = { embed?: boolean; toast?: (m: string) => void; onState?: (p: URLSearchParams) => void; onAtlas?: (ra: number, dec: number) => void; onSave?: (s: Snapshot) => void };
type Mode = "evolve" | "time" | "lambda" | "stack" | "rgb" | "diff";
type Tab = "changes" | "motion" | "spectrum" | "light" | "limits" | "frames" | "export";
const TABS: [Tab, string, string][] = [["changes", "Motion detector", "Which sources in this field moved or changed"], ["motion", "Astrometer", "Position against time: proper motion, parallax, distance"],
  ["spectrum", "Spectrograph", "The 0.75–5 µm spectrum: what the source is"], ["light", "Photometer", "Brightness since 1999: did it change"], ["limits", "Detection limits", "What could still hide in this field"],
  ["frames", "Exposures", "Every exposure used, with NASA's flags"], ["export", "Export", "Tables, FITS, link, code"]];
type Item = { kind: "frame" | "stack" | "rgb" | "diff"; key: string; mjd: number; f?: Frame; list?: Frame[]; ref?: Frame[]; label?: string };
type Probe = { dx: number; dy: number; follow: boolean };
type TwoMass = CatSource & { j: number; h: number; k: number };

const SIZES = [32, 64, 96, 128], BUDGETS = [36, 72, 144];
const VIEWS: { k: "evolve" | "frames" | "rgb" | "diff"; t: string; tip: string }[] = [{ k: "evolve", t: "Evolution", tip: "The field through time: deep images of each visit, blended continuously" }, { k: "frames", t: "Exposures", tip: "Every single 2-minute exposure" },
  { k: "rgb", t: "Colour", tip: "Six detectors folded into one colour picture per visit" }, { k: "diff", t: "Difference", tip: "Each visit minus the first" }];
const RATES = [0.1, 0.25, 0.5, 1, 2, 5];                 // evolution playback: years of sky time per second
const EXPLAIN: Record<Mode, string> = {
  evolve: "One deep picture per SPHEREx visit (all its exposures combined), blended smoothly as time runs. Drag the time bar or step from date to date. The numbered boxes are the sources the motion detector measured; an orange track shows where a moving source was at each date since 1999.",
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
const fmtBig = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)} million` : v >= 1000 ? `${Math.round(v / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : v >= 10 ? v.toFixed(0) : v.toFixed(1));

// ---- fields already read are kept in this browser (IndexedDB), so reopening one is instant and needs no network.
//      The ten most recent are kept; a cached field is used only while the exposure index has not changed.
const FDB = "mira-fields", FSTORE = "fields", FLIST = "mira.fields.v1";
const fdb = () => new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(FDB, 1); r.onupgradeneeded = () => r.result.createObjectStore(FSTORE, { keyPath: "key" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function fieldGet(key: string): Promise<any | null> {
  try { const db = await fdb(); return await new Promise((res) => { const q = db.transaction(FSTORE).objectStore(FSTORE).get(key); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); }); } catch { return null; }
}
async function fieldPut(v: { key: string; saved: number } & Record<string, unknown>) {
  try {
    const db = await fdb(); await new Promise<void>((res, rej) => { const tx = db.transaction(FSTORE, "readwrite"); tx.objectStore(FSTORE).put(v); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
    let L: { key: string; saved: number }[] = []; try { L = JSON.parse(localStorage.getItem(FLIST) ?? "[]"); } catch { /* first use */ }
    L = [{ key: v.key, saved: v.saved }, ...L.filter((x) => x.key !== v.key)]; const drop = L.slice(10); L = L.slice(0, 10); localStorage.setItem(FLIST, JSON.stringify(L));
    if (drop.length) { const tx = db.transaction(FSTORE, "readwrite"); drop.forEach((x) => tx.objectStore(FSTORE).delete(x.key)); }
  } catch { /* private mode or quota: the field is simply read again next time */ }
}

export function mountBlink(host: HTMLElement, opts: BlinkOpts = {}) {
  host.classList.toggle("embed", !!opts.embed);
  host.innerHTML = `
  <div class="bk">
    <div class="bk-start" id="bk-start">
      <div class="bk-start-l">
        <div class="eyebrow">The Lab · instruments on NASA SPHEREx exposures, read live from the archive</div>
        <h2 class="display">What moved here?</h2>
        <p>Give a position or a name. The instruments read every SPHEREx exposure of that field and measure it: which sources moved since 1999 and 2010, how fast, how far away, what their spectrum says they are, whether they brightened or faded — and what could still hide there.</p>
        <form class="bk-go" id="bk-go">
          <input id="bk-q" placeholder="A star's name, or coordinates (RA Dec)" autocomplete="off" spellcheck="false" enterkeyhint="go" aria-label="Where to point: a name or coordinates">
          <button class="btn" type="submit">Measure this field</button>
        </form>
        <div class="bk-try"><span>or one of the five test targets NASA set for this challenge</span>
          <div>${CHALLENGE.map((t) => `<button class="chip" data-key="${t.key}" title="${esc(t.blurb)}">${esc(t.name)}</button>`).join("")}</div></div>
      </div>
      <ol class="bk-chain">
        <li><b>Evolution</b><span>the field through time, at your pace</span></li><li><b>Motion detector</b><span>which sources moved, and are they known</span></li>
        <li><b>Astrometer</b><span>proper motion, parallax, distance</span></li><li><b>Spectrograph</b><span>0.75–5 µm spectrum: what it is</span></li>
        <li><b>Photometer</b><span>brightness since 1999</span></li><li><b>Detection limits</b><span>what could still hide here</span></li></ol>
    </div>
    <div class="bk-body" id="bk-body" hidden>
      <header class="bk-head">
        <div class="bk-target" id="bk-target"></div>
        <div class="bk-ctl">
          <div class="bk-ctlrow"><span class="eyebrow">Field</span><div class="seg" id="bk-fov">${SIZES.map((s) => `<button data-s="${s}" title="${s} × ${s} SPHEREx pixels">${((s * PIX_ARCSEC) / 60).toFixed(1)}′</button>`).join("")}</div>
            <span class="eyebrow">Exposures</span><div class="seg" id="bk-n">${BUDGETS.map((b) => `<button data-n="${b}">${b === 144 ? "All" : b}</button>`).join("")}</div><span class="bk-cost mono" id="bk-cost"></span>
            ${opts.onSave ? `<button class="btn sm ghost" id="bk-save">Save as a case</button>` : ""}</div>
          <div class="bk-data mono" id="bk-data"></div>
        </div>
      </header>
      <section class="bk-main">
        <div class="bk-viewbar"><div class="seg" id="bk-views" role="tablist" aria-label="How to show the exposures">${VIEWS.map((v, k) => `<button role="tab" data-v="${v.k}" title="${v.tip} (key ${k + 1})">${v.t}</button>`).join("")}</div>
          <div class="seg" id="bk-range" title="How far back the time bar reaches. Before 2025 there is no SPHEREx image: the picture stays on the first visit and the markers show the positions catalogued at that date">
            <button data-r="sx">SPHEREx visits</button><button data-r="2010">since 2010</button><button data-r="1999">since 1999</button></div></div>
        <div class="bk-stage" id="bk-stage">
          <canvas id="bk-cv" aria-label="SPHEREx frames of this position"></canvas>
          <div class="bk-hud tl" id="bk-hud"></div>
          <div class="bk-hud tr" id="bk-flags"></div>
          <div class="bk-hud bl mono" id="bk-read"></div>
          <div class="bk-load" id="bk-load"></div>
        </div>
        <div class="bk-transport">
          <button class="icon-btn" id="bk-prev" aria-label="Previous date" title="← previous date">‹</button>
          <button class="icon-btn" id="bk-play" aria-label="Play or pause" title="Space"></button>
          <button class="icon-btn" id="bk-next" aria-label="Next date" title="→ next date">›</button>
          <canvas class="bk-strip" id="bk-strip" height="46"></canvas>
          <select id="bk-rate" class="bk-rate" aria-label="Playback speed" title="Playback speed"></select>
          <button class="icon-btn sm" id="bk-loop" aria-label="Repeat" title="Repeat when the end is reached">↻</button>
        </div>
        <div class="bk-layers" id="bk-toggles">
          <button data-v="det" title="The sources the motion detector measured, numbered as in its table; a track marks the ones that moved (D)">Detections</button>
          <button data-v="track" title="Keep the target centred while the sky moves behind it (T)">Follow target</button>
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
            </div></div>
        </div>
        <div class="bk-legend" id="bk-legend"></div>
        <p class="bk-cap bk-explain" id="bk-explain"></p>
      </section>
      <aside class="bk-side">
        <div class="bk-srcbar" id="bk-readouts"></div>
        <div class="bk-tabs" id="bk-tabs" role="tablist">${TABS.map(([k, t, tip]) => `<button role="tab" data-t="${k}" title="${tip}">${t}</button>`).join("")}<button class="bk-help" id="bk-help" title="Show or hide the explanations" aria-label="Show or hide the explanations">?</button></div>
        <div class="bk-panel" id="bk-panel"></div>
      </aside>
    </div>
  </div>`;
  const $ = <T extends HTMLElement>(s: string) => host.querySelector(s) as T;
  const cv = $<HTMLCanvasElement>("#bk-cv"), ctx = cv.getContext("2d")!, off = document.createElement("canvas"), strip = $<HTMLCanvasElement>("#bk-strip");
  const toast = (m: string) => opts.toast?.(m);

  // ------------------------------------------------------------ state
  let target: BlinkTarget = { ra: 0, dec: 0 }, N = 64, maxFrames = 72, center: [number, number] = [0, 0];
  let frames: Frame[] = [], gen = 0, ac: AbortController | null = null, building = false, failed = 0, opened = false;
  let plan: { covered: number; picked: number; listed: number; mbytes: number } | null = null, meta: IndexMeta | null = null, errorMsg = "";
  let mode: Mode = "evolve", dets = new Set([1, 2, 3, 4, 5, 6]), idx = 0, playing = false, fps = 2, timer = 0;
  const view = { det: true, track: false, gaia: false, wise: false, mask: false, smooth: false, cmap: "gray", pct: 99.5 };
  const lock: Record<Mode, boolean> = { evolve: true, time: false, lambda: true, stack: false, rgb: false, diff: false };
  // evolution player: a continuous clock (years) over the dated pictures and catalogue positions
  const evo = { t: 2026, range: "sx" as "sx" | "2010" | "1999", rate: 0.5, loop: false, raf: 0, last: 0, hold: 0 };
  let report: FieldReport | null = null, reportKey = "", detecting = false, masksDone = 0, masksAll = false;
  let fromCache = 0, skipCache = false;                 // when the field on screen was read (ms), if it came from this browser's cache
  const fieldKey = () => `${target.ra.toFixed(5)}|${target.dec.toFixed(5)}|${(target.pmra ?? 0).toFixed(3)}|${(target.pmdec ?? 0).toFixed(3)}|${target.epoch ?? ""}|${N}|${maxFrames}`;
  /** keep what was read for this field: frames, catalogues and flag masks */
  function saveField(my: number) {
    if (my !== gen || building || !frames.length || fromCache) return;
    fieldPut({ key: fieldKey(), saved: Date.now(), index: meta?.last ?? "", frames, plan, center, failed, flagDefs: FLAG_DEFS, catState: cat.state, gaia: cat.gaia, wise: cat.wise, tm: cat.tm,
      masks: masksAll ? frames.map((f) => { const m = maskCache.get(f); return m && m !== "loading" ? m : null; }) : null });
  }
  let probe: Probe = { dx: 0, dy: 0, follow: true }, logSpec = false;
  let tab: Tab = "changes", order: "time" | "lambda" = "time", explain = (() => { try { return localStorage.getItem("mira.explain") === "1"; } catch { return false; } })();
  const excluded = new Set<string>();                    // exposures the user has unticked: left out of pictures and measurements
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
    dets = new Set([1, 2, 3, 4, 5, 6]); view.track = false; mode = o.mode ?? "evolve"; order = "time";
    tab = o.tab ?? "changes"; excluded.clear(); evo.range = "sx"; evo.rate = 0.5;
    if (t.key === "wise-0855") dets = new Set([5, 6]);   // only visible at 4–5 µm
    start();
  }
  async function start() {
    ac?.abort(); ac = new AbortController(); const my = ++gen;
    frames = []; items = []; itemsKey = ""; imgCache.clear(); lockCache.clear(); maskCache.clear(); shiftCache = new WeakMap(); analysis = null; plan = null; failed = 0; errorMsg = "";
    idx = 0; building = true; playing = false; cancelAnimationFrame(evo.raf); report = null; reportKey = ""; masksDone = 0; masksAll = false; vsKey = ""; cat.gaia = []; cat.wise = []; cat.tm = []; cat.state = "idle"; center = [target.ra, target.dec];
    syncControls(); renderTarget(); renderReadouts(); renderPanel(); renderData(); paint(); setLoad("Finding the SPHEREx exposures that cover this place…", 0);
    pushState(); fromCache = 0;
    meta = await indexMeta().catch(() => null); if (my !== gen) return; renderData();
    const hit = skipCache ? null : await fieldGet(fieldKey()); skipCache = false; if (my !== gen) return;
    if (hit && hit.frames?.length && hit.index === (meta?.last ?? "")) {
      await loadLvf().catch(() => {}); setFlagDefs(hit.flagDefs); if (my !== gen) return;      // the wavelength map and flag definitions a fresh read would have loaded
      frames = hit.frames; plan = hit.plan; center = hit.center; failed = hit.failed ?? 0; building = false; fromCache = hit.saved;
      cat.gaia = hit.gaia ?? []; cat.wise = hit.wise ?? []; cat.tm = hit.tm ?? []; cat.state = cat.gaia.length || cat.wise.length ? "ok" : "idle";
      if (hit.masks) { frames.forEach((f, k) => maskCache.set(f, hit.masks[k])); masksAll = true; masksDone = frames.length; }
      setLoad("", 1); const V0 = visitStacks(); if (V0.length) evo.t = V0[0].yr;
      renderTarget(); refresh(); analyze(); runDetect();
      if (cat.state !== "ok") loadCatalogs(my); if (!masksAll) loadAllMasks(my);
      return;
    }
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
      const V = visitStacks(); if (V.length) evo.t = V[0].yr;
      refresh(); analyze(); runDetect(); loadAllMasks(my);
    } catch (e) {
      if ((e as Error).name === "AbortError" || my !== gen) return;
      building = false; errorMsg = `Could not read the exposures: ${(e as Error).message}.`; setLoad("", 1); refresh(); renderReadouts(); renderPanel();
    }
  }
  function loadCatalogs(my: number) {
    cat.state = "loading"; const r = (N * PIX_ARCSEC) / 2 * 1.45, [ra, dec] = center, pm = Math.hypot(target.pmra ?? 0, target.pmdec ?? 0);
    const wide = r + pm * 30;                                      // catalogue epochs reach back to 1998: include where a mover was
    const twice = <T,>(f: () => Promise<T>) => f().catch(() => new Promise<T>((res, rej) => setTimeout(() => f().then(res, rej), 2500)));
    Promise.allSettled([twice(() => gaia(ra, dec, r + pm * 12)), twice(() => allwise(ra, dec, r + pm * 18)), twice(() => twomass(ra, dec, wide))]).then(([g, w, t]) => {
      if (my !== gen) return;
      if (g.status === "fulfilled") cat.gaia = g.value; if (w.status === "fulfilled") cat.wise = w.value; if (t.status === "fulfilled") cat.tm = t.value as TwoMass[];
      cat.state = g.status === "fulfilled" || w.status === "fulfilled" ? "ok" : "fail"; paint(); renderReadouts(); renderPanel(); if (!probe.follow) renderTarget(); runDetect(); if (masksAll) saveField(my);
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
    if (mode === "evolve") return fs.length ? [{ kind: "stack", key: "evo", list: fs, mjd: yearToMjd(evo.t), label: "Evolution" }] : [];
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
  // ---- evolution: one deep picture per visit, each on its own display scale (so that the different mix of
  //      wavelengths from visit to visit does not make every star flicker), blended continuously in time
  type VS = { yr: number; img: Float32Array; disp: Float32Array; n: number; d0: number; d1: number };
  let vsKey = "", vsList: VS[] = [];
  function visitStacks(): VS[] {
    const fs = live().filter((f) => dets.has(f.det)), key = `${fs.length}|${detsKey()}|${excluded.size}|${frames.length}|${view.pct}`;
    if (key === vsKey) return vsList;
    const by = new Map<number, Frame[]>(); fs.forEach((f) => (by.get(f.visit) ?? by.set(f.visit, []).get(f.visit)!).push(f));
    vsList = [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, L]) => { const img = robustStack(L.map((f) => f.img), N * N), [lo, hi] = levels(img, view.pct), disp = new Float32Array(N * N);
      for (let k = 0; k < disp.length; k++) disp[k] = Number.isFinite(img[k]) ? asinhT(img[k], lo, hi) : NaN;
      return { yr: mjdToYear(L.reduce((q, f) => q + f.mjd, 0) / L.length), img, disp, n: L.length, d0: L[0].mjd, d1: L[L.length - 1].mjd }; });
    vsKey = key; return vsList;
  }
  /** the two visits around the clock and how far between them it stands (eased, so each real picture rests a moment) */
  function evoAt(): { a: VS; b: VS; f: number; i: number } | null {
    const V = visitStacks(); if (!V.length) return null;
    if (evo.t <= V[0].yr) return { a: V[0], b: V[0], f: 0, i: 0 };
    for (let i = 0; i < V.length - 1; i++) if (evo.t <= V[i + 1].yr) { const u = (evo.t - V[i].yr) / (V[i + 1].yr - V[i].yr); return { a: V[i], b: V[i + 1], f: u * u * (3 - 2 * u), i }; }
    return { a: V[V.length - 1], b: V[V.length - 1], f: 0, i: V.length - 1 };
  }
  function evoSpan(): [number, number] { const V = visitStacks(), a = V[0]?.yr ?? 2025.3, b = V[V.length - 1]?.yr ?? 2026.8; return evo.range === "sx" ? [a - 0.06, b + 0.06] : [evo.range === "2010" ? 2009.6 : 1997.6, b + 0.3]; }
  /** the dates that carry data: SPHEREx visits, and the catalogue epochs when the bar reaches back to them */
  function evoStops(): { yr: number; kind: "sx" | "wise" | "tm"; n?: number }[] {
    const out: { yr: number; kind: "sx" | "wise" | "tm"; n?: number }[] = visitStacks().map((v) => ({ yr: v.yr, kind: "sx" as const, n: v.n }));
    if (evo.range !== "sx") out.push({ yr: 2010.5, kind: "wise" }); if (evo.range === "1999") out.push({ yr: selRow()?.tm?.epoch ?? 1999.5, kind: "tm" });
    return out.sort((p, q) => p.yr - q.yr);
  }
  const shifted = (f: Frame) => { if (!view.track) return f.img; let s = shiftCache.get(f); if (!s) { s = shiftImage(f.img, N, f.tx - c(), f.ty - c()); shiftCache.set(f, s); } return s; };
  const stack = (list: Frame[]) => robustStack(list.map(shifted), N * N);
  function imageOf(it: Item): Float32Array | Float32Array[] {
    if (it.kind === "frame") return shifted(it.f!);
    if (it.key === "evo") { const e = evoAt(); return e ? (e.f < 0.5 ? e.a.img : e.b.img) : new Float32Array(N * N); }
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
    } else if (it.key === "evo") {
      const e = evoAt(), A = e?.a.disp, B = e?.b.disp, f = e?.f ?? 0, dim = e && evo.t < e.a.yr - 0.05 ? 0.55 : 1;     // before the first SPHEREx picture: dimmed
      for (let k = 0; k < N * N; k++) { const va = A ? A[k] : NaN, vb = B ? B[k] : NaN, v = Number.isFinite(va) && Number.isFinite(vb) ? va + (vb - va) * f : Number.isFinite(va) ? va : vb;
        if (!Number.isFinite(v)) { d[k * 4] = 22; d[k * 4 + 1] = 22; d[k * 4 + 2] = 28; d[k * 4 + 3] = 255; continue; }
        const [r, g, b] = tone(v * dim); d[k * 4] = r; d[k * 4 + 1] = g; d[k * 4 + 2] = b; d[k * 4 + 3] = 255; }
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
  const itMjd = (it: Item) => (it.key === "evo" ? yearToMjd(evo.t) : it.mjd);
  function shiftOf(it: Item): [number, number] {
    if (!view.track) return [0, 0];
    const [tx, ty] = it.f ? [it.f.tx, it.f.ty] : targetXY(itMjd(it)); return [c() - tx, c() - ty];
  }
  /** where a measured source is at a given date: along its fitted path if it moves, else where it was detected */
  function rowAt(r: ChangeRow, year: number): [number, number] {
    const m = r.pm; if (!m || !(r.tags.includes("MOVED") || (m.sig > 4 && m.tot > 0.05))) return [r.x, r.y];
    return [c() - (m.xi0 + m.ra * (year - m.t0)) / PIX_ARCSEC, c() - (m.eta0 + m.dec * (year - m.t0)) / PIX_ARCSEC];
  }
  const rowColor = (r: ChangeRow) => (r.tags.includes("MOVED") ? "#ff9d4d" : r.tags.includes("BRIGHTER") || r.tags.includes("FAINTER") ? "#f0d35b" : r.tags.includes("NEW") ? "#ff7ad9" : r.tags.includes("VARIABLE") ? "#78dcff"
    : r.tags.some((t) => t === "SATURATED" || t === "BLENDED" || t === "EDGE") ? "rgba(240,240,250,.42)" : "#7df0a6");
  function overlays(it: Item) {
    const W = cv.width, s = W / N, [ox, oy] = shiftOf(it), year = mjdToYear(itMjd(it)), u = W / 640;
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
    if (view.det && report) { const sel = selRow(); ctx.textAlign = "left";
      // sources of 2010 with nothing there today
      ctx.setLineDash([4 * u, 4 * u]); ctx.strokeStyle = ctx.fillStyle = "#ff5d6c"; ctx.lineWidth = 1.2 * u;
      for (const q of report.gone) { const [x, y] = P(q.x, q.y); if (!inside(x, y)) continue; ctx.beginPath(); ctx.arc(x, y, 8 * u, 0, 7); ctx.stroke(); ctx.fillText("2010 only", x + 11 * u, y); }
      ctx.setLineDash([]);
      for (const q of report.rows) {
        const col = rowColor(q), [x, y] = P(...rowAt(q, year)), r = (q === sel ? 9 : 7) * u; if (!inside(x, y)) continue;
        // the dated positions of a mover, oldest to newest, joined: its path across the sky
        if (q.tags.includes("MOVED") && q.epochs.length > 1) { ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5 * u; ctx.beginPath();
          q.epochs.forEach((e, k) => { const [ex, ey] = P(c() - e.xi / PIX_ARCSEC, c() - e.eta / PIX_ARCSEC); if (k) ctx.lineTo(ex, ey); else ctx.moveTo(ex, ey); }); ctx.stroke();
          q.epochs.forEach((e, k) => { const [ex, ey] = P(c() - e.xi / PIX_ARCSEC, c() - e.eta / PIX_ARCSEC); ctx.beginPath(); ctx.arc(ex, ey, 2.6 * u, 0, 7); ctx.fill();
            if (k === 0 || (k === q.epochs.length - 1 && q.epochs[k].yr - q.epochs[0].yr > 3)) ctx.fillText(String(Math.floor(e.yr)), ex + 5 * u, ey + 11 * u); }); }
        ctx.strokeStyle = q === sel ? "#fff" : col; ctx.fillStyle = col; ctx.lineWidth = (q === sel ? 2 : 1.2) * u;
        ctx.strokeRect(x - r, y - r, 2 * r, 2 * r); ctx.fillText(String(q.n), x + r + 3 * u, y - r);
      } }
    // target reticle (predicted position at this frame's date) and the clicked probe
    const [tx, ty] = it.f ? [it.f.tx, it.f.ty] : targetXY(itMjd(it)), [rx, ry] = P(tx, ty);
    ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 1.6 * u;
    for (const [a, b, e, f] of [[-26, 0, -11, 0], [11, 0, 26, 0], [0, -26, 0, -11], [0, 11, 0, 26]]) { ctx.beginPath(); ctx.moveTo(rx + a * u, ry + b * u); ctx.lineTo(rx + e * u, ry + f * u); ctx.stroke(); }
    if (!probe.follow && !(view.det && selRow())) { const [px, py] = P(c() + probe.dx, c() + probe.dy), q = 12 * u; ctx.strokeStyle = "#fff"; ctx.strokeRect(px - q, py - q, 2 * q, 2 * q); }
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
    } else if (it.key === "evo") {
      const e = evoAt(), V = visitStacks(), when = new Date((yearToMjd(evo.t) - 40587) * 86400000).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
      const on = e && Math.abs(evo.t - (e.f < 0.5 ? e.a : e.b).yr) < 0.012 ? (e.f < 0.5 ? e.a : e.b) : null;
      const what = !e ? "" : evo.t < V[0].yr - 0.05 ? `no SPHEREx picture exists for this date: the first visit (${mjdToDate(V[0].d0).slice(0, 7)}) is shown dimmed · markers at their ${evo.t.toFixed(0)} positions`
        : on ? `SPHEREx visit ${V.indexOf(on) + 1} of ${V.length} · ${on.n} exposures combined · ${mjdToDate(on.d0)} → ${mjdToDate(on.d1)}` : `between visit ${e.i + 1} and ${e.i + 2} · blend ${Math.round(e.f * 100)}%`;
      h.innerHTML = `<b>${when} <small>${evo.t.toFixed(2)}</small></b><span>${what}</span>`; fl.innerHTML = "";
    } else {
      const L = it.list!, t0 = Math.min(...L.map((f) => f.mjd)), t1 = Math.max(...L.map((f) => f.mjd)), lams = L.map((f) => f.lam);
      h.innerHTML = `<b>${esc(it.label ?? "")}</b><span>${mjdToDate(t0)} → ${mjdToDate(t1)} · ${L.length} exposures combined</span><span>${Math.min(...lams).toFixed(2)}–${Math.max(...lams).toFixed(2)} µm</span>`;
      fl.innerHTML = it.kind === "diff" ? `<em class="neg">fainter / left</em><em class="pos">brighter / arrived</em>` : it.kind === "rgb" ? `<em class="lc" style="color:#8fb7ff">0.75–1.6 µm</em><em class="lc" style="color:#8be29e">1.6–3.8 µm</em><em class="lc" style="color:#ff8a80">3.8–5 µm</em>` : "";
    }
  }
  function drawStrip() {
    const dpr = Math.min(devicePixelRatio || 1, 2), w = (strip.width = Math.max(10, strip.clientWidth * dpr)), h = (strip.height = 46 * dpr), g = strip.getContext("2d")!, n = items.length;
    g.clearRect(0, 0, w, h); if (!n) return;
    if (mode === "evolve") {
      const [a, b] = evoSpan(), p2 = 14 * dpr, X2 = (t: number) => p2 + ((t - a) / (b - a)) * (w - 2 * p2);
      g.font = `${10 * dpr}px "JetBrains Mono", monospace`; g.textBaseline = "alphabetic"; g.fillStyle = "rgba(240,240,250,.35)"; g.fillRect(p2, 21 * dpr, w - 2 * p2, dpr);
      const span = b - a, step = span > 12 ? 5 : span > 5 ? 2 : span > 2.5 ? 1 : 0.5;
      for (let t = Math.ceil(a / step) * step; t <= b; t += step) { const x = X2(t); g.fillStyle = "rgba(240,240,250,.4)"; g.fillRect(x, 17 * dpr, dpr, 9 * dpr);
        const lab = step < 1 ? t.toFixed(1) : String(Math.round(t)); g.fillStyle = "rgba(240,240,250,.7)"; g.fillText(lab, x - g.measureText(lab).width / 2, h - 3 * dpr); }
      for (const st of evoStops()) { const x = X2(st.yr); g.fillStyle = st.kind === "sx" ? "#7df0a6" : st.kind === "wise" ? "#ff9d4d" : "#f0d35b";
        if (st.kind === "sx") { g.beginPath(); g.arc(x, 21.5 * dpr, 4.5 * dpr, 0, 7); g.fill(); } else { g.save(); g.translate(x, 21.5 * dpr); if (st.kind === "wise") g.rotate(Math.PI / 4); g.fillRect(-4 * dpr, -4 * dpr, 8 * dpr, 8 * dpr); g.restore(); }
        const lab = st.kind === "sx" ? "" : st.kind === "wise" ? "WISE" : "2MASS"; if (lab) g.fillText(lab, x - g.measureText(lab).width / 2, 10 * dpr); }
      const xc = X2(Math.min(b, Math.max(a, evo.t))); g.fillStyle = "#fff"; g.fillRect(xc - dpr, 4 * dpr, 2 * dpr, 30 * dpr); g.beginPath(); g.moveTo(xc - 5 * dpr, 2 * dpr); g.lineTo(xc + 5 * dpr, 2 * dpr); g.lineTo(xc, 8 * dpr); g.fill();
      return;
    }
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
  function tick() {
    clearTimeout(timer); cancelAnimationFrame(evo.raf);
    if (mode === "evolve") { if (playing && visitStacks().length) { evo.last = performance.now(); evo.raf = requestAnimationFrame(evoStep); } return; }
    if (playing && items.length > 1) timer = window.setTimeout(() => { idx = (idx + 1) % items.length; paint(); tick(); }, 1000 / (mode === "stack" || mode === "rgb" || mode === "diff" ? Math.min(fps, 1.5) : fps));
  }
  /** advance the clock; rest briefly on every date that carries data, stop (or start over) at the end */
  function evoStep(now: number) {
    if (!playing || mode !== "evolve") return;
    const dt = Math.min(0.1, (now - evo.last) / 1000), [a, b] = evoSpan(); evo.last = now;
    if (evo.hold > 0) evo.hold -= dt;
    else { const t0 = evo.t, t1 = t0 + evo.rate * dt, stop = evoStops().find((q) => q.yr > t0 + 1e-6 && q.yr <= t1);
      if (stop) { evo.t = stop.yr; evo.hold = 0.7; }
      else if (t1 >= b) { if (evo.loop) { evo.t = a; evo.hold = 0.5; } else { evo.t = b; playing = false; syncControls(); } }
      else evo.t = t1;
      paint(); }
    if (playing) evo.raf = requestAnimationFrame(evoStep);
  }
  function seek(k: number, pause = true) {
    if (mode === "evolve") { const S2 = evoStops().map((q) => q.yr), fwd = k > idx, nx = fwd ? S2.find((y) => y > evo.t + 0.004) : [...S2].reverse().find((y) => y < evo.t - 0.004);
      if (nx !== undefined) evo.t = nx; if (pause) playing = false; paint(); syncControls(); tick(); return; }
    if (!items.length) return; idx = ((k % items.length) + items.length) % items.length; if (pause) playing = false; paint(); syncControls(); tick();
  }
  function seekFrame(k: number) { const f = frames[k]; if (!f) return; if (mode !== "time" && mode !== "lambda") { mode = "time"; playing = false; refresh(); } const q = items.findIndex((i) => i.f === f); if (q >= 0) seek(q); }

  // ------------------------------------------------------------ motion detector: every source of the field, measured
  function runDetect() {
    if (building || frames.length < 4) return;
    const used = live().filter((f) => dets.has(f.det)), key = `${used.length}|${detsKey()}|${cat.state}|${cat.gaia.length}|${cat.wise.length}|${cat.tm.length}|${masksAll ? 1 : 0}`;
    if (key === reportKey) return; reportKey = key;
    const mid = used[used.length >> 1]; if (!mid) { report = null; return; }
    const masks = masksAll ? used.map((f) => { const m = maskCache.get(f); return m && m !== "loading" ? m : null; }) : undefined;
    detecting = true;
    try { report = detectChanges(used, N, center, { gaia: cat.gaia.length ? cat.gaia : null, wise: cat.wise.length ? cat.wise : null, tm: cat.tm.length ? cat.tm : null }, targetXY(mid.mjd), masks); } catch { report = null; }
    detecting = false; renderReadouts(); renderPanel(); paint();
  }
  /** NASA's per-pixel flags for every exposure, so that flagged measurements of any source in the field can be set aside */
  async function loadAllMasks(my: number) {
    const q = frames.filter((f) => maskCache.get(f) === undefined); let k = 0;
    await Promise.all(Array.from({ length: 5 }, async () => { while (k < q.length && my === gen) { const f = q[k++]; maskCache.set(f, "loading"); try { maskCache.set(f, await readMask(f, N, ac?.signal)); } catch { maskCache.set(f, null); } masksDone++; } }));
    if (my !== gen) return; masksAll = true; runDetect(); if (tab === "changes") renderPanel(); saveField(my);
  }
  /** the detector's row for the source the instruments are reading */
  function selRow(): ChangeRow | null {
    if (!report) return null;
    if (probe.follow) return report.rows.find((r) => r.isTarget) ?? null;
    const x = c() + probe.dx, y = c() + probe.dy; let b: ChangeRow | null = null, bd = 2.2;
    for (const r of report.rows) { const d = Math.hypot(r.x - x, r.y - y); if (d < bd) { bd = d; b = r; } }
    return b;
  }
  function selectRow(r: ChangeRow) { probe = r.isTarget ? { dx: 0, dy: 0, follow: true } : { dx: r.x - c(), dy: r.y - c(), follow: false }; analyze(); renderTarget(); syncControls(); paint(); }
  const DIR8 = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  const dirOf = (ra: number, dec: number) => DIR8[Math.round((((Math.atan2(ra, dec) * 180) / Math.PI + 360) % 360) / 45) % 8];
  const gaiaPm = (r: ChangeRow) => (r.gaia && r.gaia.plx !== null ? Math.hypot(r.gaia.pmra, r.gaia.pmdec) : null);
  /** one word and one phrase on what happened to a source */
  function verdict(r: ChangeRow): { chip: string; cls: string; text: string } {
    const m = r.pm, d = [r.dW2, r.dW1].find((x) => x && Math.abs(x.z) >= 5 && Math.abs(Math.log(x.ratio)) > 0.26) ?? null;
    if (r.tags.includes("MOVED") && m) return { chip: "moved", cls: "pos", text: `${m.tot.toFixed(m.tot < 1 ? 2 : 1)}″ per year toward ${dirOf(m.ra, m.dec)}` };
    if (r.tags.includes("BRIGHTER") && d) return { chip: "brighter", cls: "warn", text: `${d.ratio.toFixed(1)}× its ${d.year.toFixed(0)} brightness` };
    if (r.tags.includes("FAINTER") && d) return { chip: "fainter", cls: "warn", text: `${Math.round((1 - d.ratio) * 100)}% fainter than in ${d.year.toFixed(0)}` };
    if (r.tags.includes("NEW")) return { chip: "new", cls: "pos", text: "nothing here in the 2010 and 1999 surveys" };
    if (r.tags.includes("VARIABLE")) return { chip: "variable", cls: "warn", text: `changes ${r.lc ? r.lc.amp.toFixed(1) + "× " : ""}between SPHEREx visits` };
    if (r.tags.includes("SATURATED")) return { chip: "saturated", cls: "off", text: r.why || "too bright for SPHEREx to measure" };
    if (r.tags.includes("BLENDED")) return { chip: "blended", cls: "off", text: r.why || "another source inside the same pixel" };
    if (r.tags.includes("EDGE")) return { chip: "edge", cls: "off", text: "too close to the edge of the field" };
    return { chip: "steady", cls: "", text: m && m.base > 5 ? `no motion above ${(3 * Math.hypot(m.etot, report?.cal.pmRms ?? 0.03)).toFixed(2)}″ per year` : "no change measured" };
  }
  const identity = (r: ChangeRow) => (r.gaia ? `${r.gaia.id}${r.gaia.mag != null ? ` · G ${r.gaia.mag.toFixed(1)}` : ""}` : r.wise ? r.wise.id : r.tm ? r.tm.id : report?.catalogs.gaia || report?.catalogs.wise ? "not in Gaia, AllWISE or 2MASS" : "catalogues not reachable");

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
      ${t.note ? `<div class="bk-note warn">${t.note}</div>` : ""}`;
  }
  function renderData() {
    const used = live(), nv = used.length ? used[used.length - 1].visit + 1 : 0, el = $("#bk-data");
    el.innerHTML = !plan ? "" : `<span>${building ? "reading" : ""} <b>${frames.length}</b> / ${plan.covered} exposures${excluded.size ? ` · ${excluded.size} excluded` : ""}${failed ? ` · ${failed} unreadable` : ""}</span>
      ${frames.length ? `<span>${nv} visit${nv > 1 ? "s" : ""}</span><span>${mjdToDate(frames[0].mjd)} → ${mjdToDate(frames[frames.length - 1].mjd)}</span>` : ""}
      ${meta ? `<span title="Date of the newest SPHEREx exposure in MIRA's index; the index is rebuilt after each NASA data release">archive through ${meta.last}</span>` : ""}
      ${fromCache ? `<span title="This field was read from NASA's archive on ${new Date(fromCache).toLocaleString()} and kept in this browser">from this browser's copy · <button class="link" id="bk-reread">read again</button></span>` : ""}${opts.embed ? `<a href="${shareUrl()}" target="_blank" rel="noopener">open in MIRA ↗</a>` : ""}`;
  }
  host.addEventListener("click", (e) => { if ((e.target as HTMLElement).id === "bk-reread") { skipCache = true; start(); } });
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
    const ev = mode === "evolve", rate = $("#bk-rate") as HTMLSelectElement;
    $("#bk-range").style.display = ev ? "" : "none"; $("#bk-loop").style.display = ev ? "" : "none"; $("#bk-loop").classList.toggle("on", evo.loop);
    host.querySelectorAll<HTMLElement>("#bk-range button").forEach((b) => b.classList.toggle("on", b.dataset.r === evo.range));
    if (rate.dataset.kind !== (ev ? "evo" : "fps")) { rate.dataset.kind = ev ? "evo" : "fps";
      rate.innerHTML = ev ? RATES.map((r) => `<option value="${r}">${r} yr / s</option>`).join("") : [1, 2, 4, 6, 10, 16].map((f) => `<option value="${f}">${f} per s</option>`).join(""); }
    rate.value = String(ev ? evo.rate : fps);
    $("#bk-legend").innerHTML = `${view.det ? `<span><i class="lgd box"></i>measured source (number = row in the Motion detector)</span><span><i class="lgd box o"></i>moved: its dated positions, oldest to newest</span>` : ""}
      ${view.gaia ? `<span><i class="lgd ring"></i>Gaia star at this date</span>` : ""}${view.wise ? `<span><i class="lgd dia"></i>where WISE saw a source in 2010</span>` : ""}${view.mask ? `<span><i class="lgd px"></i>pixel flagged by NASA</span>` : ""}<span><i class="lgd plus"></i>target position</span>`;
    host.querySelector(".bk")!.classList.toggle("explain", explain); $("#bk-help").classList.toggle("on", explain);
    const n = plan?.picked ?? Math.min(maxFrames, 120); $("#bk-cost").textContent = `≈ ${Math.round((n * ((N * 1.42 + 3) * 8160 + 60000)) / 1e6)} MB`;
    $("#bk-cost").title = "Read from NASA's archive for this field of view and number of exposures. Wider or more = slower.";
    const tg = host.querySelector<HTMLElement>('#bk-toggles [data-v="track"]'); if (tg) tg.style.display = hasPm() ? "" : "none";
    const extra = dets.size < 6 || order === "lambda" || (lock[mode] && mode !== "evolve" && mode !== "lambda") || view.smooth || view.cmap !== "gray"; $("#bk-morebtn").classList.toggle("dot", extra);
  }
  type InsKey = "made" | "change" | "move";
  let answers: Record<InsKey, Answer> | null = null;
  /** the source bar: which source the instruments are reading, and what the detector found for it */
  function renderReadouts() {
    const el = $("#bk-readouts"), A = analysis, r = selRow();
    const bl = A && cat.gaia.length ? blend() : null, g = probe.follow ? null : nearest(cat.gaia, 5);
    const ref = probe.follow ? target : g ? { pmra: g.pmra, pmdec: g.pmdec, source: "Gaia DR3" } : null;
    answers = { made: answerMade(A, bl && { mag: bl.g.mag, sep: bl.sep }), change: answerChange(A), move: answerMove(A, ref) };
    if (!opened) { el.innerHTML = ""; return; }
    const [ra, dec] = r ? [r.ra, r.dec] : probeSky(frames.length ? mjdToYear(frames[frames.length >> 1].mjd) : 2026), v = r ? verdict(r) : null;
    el.innerHTML = `<div class="who"><span class="eyebrow">The instruments are reading</span>
        <b>${r ? `source ${r.n}${r.isTarget ? " (your target)" : ""}` : probe.follow ? "the target position" : "the position you clicked"}</b>
        <span class="mono">${sexa(ra, dec)}</span><span class="id">${r ? esc(identity(r)) : report ? "no source detected at this position" : ""}</span></div>
      <div class="what">${v ? `<em class="tag ${v.cls}">${v.chip}</em><span>${esc(v.text)}</span>` : ""}
        ${probe.follow ? "" : `<button class="link" id="bk-unprobe">back to the target</button><button class="link" id="bk-recentre" title="Read a new field centred on this source">centre on it</button>`}</div>`;
    host.querySelector<HTMLElement>("#bk-unprobe")?.addEventListener("click", () => { probe = { dx: 0, dy: 0, follow: true }; analyze(); renderTarget(); paint(); });
    host.querySelector<HTMLElement>("#bk-recentre")?.addEventListener("click", () => { const [r2, d2] = probeSky(2016), q = nearest(cat.gaia, 5);
      open(q ? { ra: q.ra, dec: q.dec, pmra: q.pmra, pmdec: q.pmdec, epoch: q.epoch, name: q.id, plx: q.plx ?? undefined, source: "Gaia DR3", otype: "star" } : { ra: r2, dec: d2 }); });
  }
  const tbl = (head: string[], rows: string[][], cls = "") => `<div class="bk-tw"><table class="bk-table ${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const csv = (name: string, head: string[], rows: (string | number)[][], comment = "") => save(new Blob([`# MIRA · ${target.name ?? ""} · RA ${center[0].toFixed(6)} Dec ${center[1].toFixed(6)} (ICRS)${comment ? ` · ${comment}` : ""}\n${head.join(",")}\n${rows.map((r) => r.join(",")).join("\n")}\n`], { type: "text/csv" }), `${fileStem()}_${name}.csv`);
  function renderPanel() {
    const el = $("#bk-panel"), A = analysis;
    if (errorMsg && !frames.length) { el.innerHTML = `<div class="bk-empty">${esc(errorMsg)}</div>`; return; }
    if (tab === "frames") return renderFrames(el);
    if (tab === "export") return renderExport(el);
    if (tab === "changes") return renderChanges(el);
    if (tab === "limits") return renderLimits(el);
    if (!A) { el.innerHTML = `<div class="bk-empty">${opened ? "Measuring as the exposures arrive…" : ""}</div>`; return; }
    const reading = (t: string) => (t ? `<p class="bk-reading"><b>Reading</b> ${t}</p>` : "");
    const say = (a?: Answer) => (!a ? "" : `${/^[—…]$/.test(a.big) || a.tone === "wait" ? "" : `<b>${esc(a.big)}${a.unit ? ` ${esc(a.unit)}` : ""} ${esc(a.label)}.</b> `}${a.text}`);
    if (tab === "spectrum") {
      const per = [1, 2, 3, 4, 5, 6].map((d) => { const v = A.P.filter((p) => p.det === d), c2 = v.filter((p) => !p.flagged), q = DETECTORS[d - 1];
        return [`<i class="sw" style="background:${detColor(d)}"></i>D${d}`, `${q.lo.toFixed(2)}–${q.hi.toFixed(2)}`, String(v.length), c2.length ? median(c2.map((p) => p.flux)).toPrecision(3) : "–", c2.length ? median(c2.map((p) => p.snr)).toFixed(0) : "–", String(v.length - c2.length)]; });
      el.innerHTML = `<h3 class="bk-h">Spectrum of the selected source, 0.75–5 µm</h3>${reading(say(answers?.made))}<div class="bk-plot-host"></div>
        <div class="bk-bar2"><span class="mono">${A.P.length} exposures, one point each · ${A.nFlagged} flagged by NASA</span><span><button class="link" id="bk-log">${logSpec ? "linear scale" : "logarithmic scale"}</button><button class="link" id="bk-csv">CSV</button></span></div>
        ${tbl(["detector", "range (µm)", "exposures", "median flux (mJy)", "median S/N", "flagged"], per, "num")}
        <p class="bk-cap">Each point is one 2-minute exposure: SPHEREx's filter changes wavelength across each detector, so every exposure samples the source at a different wavelength. PSF-weighted photometry (Gaussian of the exposure's FWHM), local sky from a 5–8 px annulus. Shaded bands: molecular absorptions. Diamonds: catalogue fluxes of the same source. Click a point to open that exposure.</p>`;
      drawSpectrum(el.querySelector(".bk-plot-host") as HTMLElement, A.P, { log: logSpec, bins: A.bins.filter((b) => b.n >= 1), anchors: anchors(), onPick: seekFrame });
      (el.querySelector("#bk-log") as HTMLElement).onclick = () => { logSpec = !logSpec; renderPanel(); }; (el.querySelector("#bk-csv") as HTMLElement).onclick = downloadCsv;
    } else if (tab === "light") {
      const r = selRow(), zp = report?.cal.zp ?? {}, S2 = [A.lc.all, ...A.lc.series].filter((q) => q.visits.length >= 2);
      // 25 years in three bands: the catalogues, then each SPHEREx visit in the same band (on this field's zero point)
      const now = (b: ChangeRow["W1"], z: number): HistPoint[] => (b && report && b.f > 0 ? [{ yr: report.yr, f: b.f / z, e: b.e / z, src: "SPHEREx" }] : []);
      const hist = [
        { name: "Ks 2.2 µm", color: "#74dd8f", pts: [...(r?.tm && Number.isFinite(r.tm.k) ? [{ yr: r.tm.epoch, f: magToMjy(r.tm.k, "Ks"), src: "2MASS" }] : []), ...now(r?.K ?? null, zp.Ks?.zp ?? 1)] },
        { name: "W1 3.4 µm", color: "#f0d35b", pts: [...(r?.wise?.mag2 != null ? [{ yr: 2010.5, f: magToMjy(r.wise.mag2, "W1"), src: "AllWISE" }] : []), ...now(r?.W1 ?? null, zp.W1?.zp ?? 1)] },
        { name: "W2 4.6 µm", color: "#ff5d6c", pts: [...(r?.wise?.mag != null ? [{ yr: 2010.5, f: magToMjy(r.wise.mag, "W2"), src: "AllWISE" }] : []), ...now(r?.W2 ?? null, zp.W2?.zp ?? 1)] }];
      const dl = (d: ChangeRow["dW1"], name: string, then: string) => (d ? [name, `${d.then.toPrecision(3)} <small>${then}</small>`, d.now.toPrecision(3), `${d.ratio.toFixed(2)}×`, `${Math.abs(d.z).toFixed(1)}σ`] : null);
      const rows = [dl(r?.dK ?? null, "Ks 2.2 µm", r?.dK ? r.dK.year.toFixed(0) : ""), dl(r?.dW1 ?? null, "W1 3.4 µm", "2010"), dl(r?.dW2 ?? null, "W2 4.6 µm", "2010")].filter(Boolean) as string[][];
      const big = [r?.dW2, r?.dW1].find((d) => d && Math.abs(d.z) >= 5 && Math.abs(Math.log(d.ratio)) > 0.26);
      const long = !r ? "" : r.tags.includes("SATURATED") ? "This star saturates SPHEREx, so its absolute brightness cannot be compared with the catalogues; the visit-to-visit comparison below uses its unsaturated halo."
        : big ? `At ${big.band === "W2" ? "4.6" : "3.4"} µm the source is now <b>${big.ratio > 1 ? `${big.ratio.toFixed(1)} times brighter` : `${Math.round((1 - big.ratio) * 100)}% fainter`}</b> than in ${big.year.toFixed(0)} (${Math.abs(big.z).toFixed(0)}σ against the other sources of this field).`
        : rows.length ? `Within the errors the source is as bright as the catalogues recorded it in ${r.dK ? `${r.dK.year.toFixed(0)} and ` : ""}2010: no change beyond ${Math.round(100 * Math.max(0.1, 3 * Math.max(zp.W1?.sc ?? 0.1, zp.W2?.sc ?? 0.1)))}%.` : "No catalogue counterpart to compare with.";
      el.innerHTML = `<h3 class="bk-h">Brightness of the selected source since 1999</h3>${reading(long)}<div class="bk-plot-host" id="bk-hist"></div>
        ${rows.length ? tbl(["band", "then (mJy)", "now (mJy)", "now ÷ then", "significance"], rows, "num") : ""}
        <h3 class="bk-h sec">Between SPHEREx visits, at matched wavelengths</h3>${reading(say(answers?.change))}${A.halo ? `<div class="bk-warn">Saturated source: levels come from its unsaturated halo (25–43″), not its core.</div>` : ""}<div class="bk-plot-host" id="bk-vis"></div>
        <div class="bk-bar2"><span class="mono">${A.lc.pairs} wavelength-matched pairs of exposures</span><span><button class="link" id="bk-csv">CSV</button></span></div>
        <p class="bk-cap">Top: catalogue fluxes (hollow) and the median SPHEREx flux over all visits in the same band (filled), scaled by the field's zero point (median SPHEREx ÷ catalogue over all sources). Bottom: brightness is compared only between exposures of different visits that saw the same wavelength (same detector, within 1.2%); a constant source sits at 1.00. Undersampling adds 5–12% scatter per exposure, more at short wavelengths, so a change must show in two detectors.</p>`;
      drawHistory(el.querySelector("#bk-hist") as HTMLElement, hist);
      drawLightCurve(el.querySelector("#bk-vis") as HTMLElement, A.lc);
      (el.querySelector("#bk-csv") as HTMLElement).onclick = () => csv("lightcurve", ["band", "visit", "mean_mjd", "level", "level_err", "matched_pairs"], S2.flatMap((q) => q.visits.map((v) => [q.det ? `D${q.det}` : "all", v.visit + 1, v.mjd.toFixed(3), v.ratio.toFixed(4), v.err.toFixed(4), v.n])), "brightness relative to the source's own mean, from wavelength-matched pairs");
    } else {
      const m = A.motion, r = selRow(), L = r?.pm && r.pm.base > 5 ? r.pm : null, gpm = r ? gaiaPm(r) : null;
      const refPm = probe.follow && hasPm() ? { ra: target.pmra!, dec: target.pmdec!, name: `${target.source ?? "catalogue"} motion` } : r?.gaia && gpm !== null ? { ra: r.gaia.pmra, dec: r.gaia.pmdec, name: "Gaia DR3 motion" } : null, ep = m ? plxError(m) : 0;
      const e = L ? Math.hypot(L.etot, report?.cal.pmRms ?? 0.03) : 0;
      const txt = L ? `Over ${L.base.toFixed(0)} years the source ${L.sig >= 5 && L.tot >= 0.08 ? `moved <b>${(L.tot * L.base).toFixed(1)}″</b>: <b>${L.tot.toFixed(L.tot < 1 ? 3 : 2)} ± ${e.toFixed(3)}″ per year</b> toward ${dirOf(L.ra, L.dec)} (${L.sig.toFixed(0)}σ)` : `did not move measurably: ${L.tot.toFixed(3)} ± ${e.toFixed(3)}″ per year`}.${
          refPm ? ` ${refPm.name.replace(" motion", "")} gives ${Math.hypot(refPm.ra, refPm.dec).toFixed(3)}″ per year${Math.hypot(L.ra - refPm.ra, L.dec - refPm.dec) < Math.max(4 * e, 0.04) ? ": the two agree" : ": they disagree, so this image is probably contaminated"}.` : r && !r.gaia ? " Gaia has no motion for this source." : ""}`
        : say(answers?.move);
      const catPlx = probe.follow && target.plx ? target.plx / 1000 : r?.gaia?.plx ? r.gaia.plx / 1000 : null, catD = catPlx && catPlx > 0.001 ? ` The catalogue parallax, ${catPlx.toFixed(3)}″, puts it at ${(3.2616 / catPlx).toFixed(catPlx > 0.1 ? 1 : 0)} light-years.` : "";
      const dist = !m || m.plx === null ? catD : m.plx > 5 * ep ? ` Parallax from the SPHEREx exposures alone: ${m.plx.toFixed(2)} ± ${ep.toFixed(2)}″, a distance of <b>${(3.2616 / m.plx).toFixed(1)} light-years</b> (${(3.2616 / (m.plx + ep)).toFixed(1)}–${(3.2616 / Math.max(m.plx - ep, 1e-3)).toFixed(1)}).${catD}`
        : ` The SPHEREx exposures alone give a parallax of ${m.plx.toFixed(2)} ± ${ep.toFixed(2)}″: below the 5σ needed to state a distance (6″ pixels, 1.4-year baseline).${catD}`;
      const res: string[][] = [];
      if (L) res.push([`This work <small>${esc(L.using)} · ${L.base.toFixed(1)} yr</small>`, `${fmtPm(L.ra)} ± ${e.toFixed(3)}`, `${fmtPm(L.dec)} ± ${e.toFixed(3)}`, "–"]);
      if (m) res.push([`SPHEREx exposures only <small>${m.visits} visits · ${(m.span / 365.25).toFixed(1)} yr</small>`, `${fmtPm(m.pmra)} ± ${m.epmra.toFixed(2)}`, `${fmtPm(m.pmdec)} ± ${m.epmdec.toFixed(2)}`, m.plx === null ? "–" : `${m.plx.toFixed(2)} ± ${ep.toFixed(2)}`]);
      if (probe.follow && hasPm()) res.push([esc(target.source ?? "catalogue"), fmtPm(target.pmra!), fmtPm(target.pmdec!), target.plx ? (target.plx / 1000).toFixed(3) : "–"]);
      else if (r?.gaia && gpm !== null) res.push(["Gaia DR3", fmtPm(r.gaia.pmra), fmtPm(r.gaia.pmdec), r.gaia.plx ? (r.gaia.plx / 1000).toFixed(3) : "–"]);
      el.innerHTML = `<h3 class="bk-h">Position of the selected source against time</h3>${reading(txt + dist)}
        ${r && r.epochs.length >= 2 ? `<div class="bk-plot-host" id="bk-track"></div>` : `<p class="bk-cap show">No dated catalogue position (AllWISE 2010, 2MASS ~1999) is matched to this source, so only the SPHEREx visits are available.</p>`}
        ${res.length ? tbl(["", "μα cos δ (″/yr)", "μδ (″/yr)", "parallax (″)"], res, "num") : ""}
        ${m ? `<h3 class="bk-h sec">Every SPHEREx exposure${m.withParallax ? ": motion and parallax" : ""}</h3>${A.motionFlagged ? `<div class="bk-warn">Every exposure is flagged (saturated): centres come from the wings of the image. Indicative only.</div>` : ""}<div class="bk-plot-host" id="bk-sx"></div>
        <div class="bk-bar2"><span class="mono">${m.n} of ${m.pts.length} centroids used · rms ${m.rms.toFixed(2)}″</span><span><button class="link" id="bk-csv">CSV</button></span></div>` : `<p class="bk-cap show">A fit to single exposures needs the source above 8σ in six or more clean exposures over two visits (here: ${A.P.length} exposures, ${A.nFlagged} flagged). The visit-by-visit positions above do not need that.</p>`}
        <p class="bk-cap">Top: one position per SPHEREx visit (centroid on that visit's deep image, tied to Gaia with the field's reference stars) and the catalogue positions of 2010 and ~1999; straight-line fit with its 1σ band. Bottom: Gaussian-windowed centroid in every clean exposure; least-squares fit of position, proper motion${m?.withParallax ? " and parallax" : ""} with outlier rejection. A SPHEREx pixel is 6.15″.${m?.withParallax ? ` The parallax error includes ${PLX_SYS}″ systematic.` : ""}</p>`;
      const th = el.querySelector("#bk-track") as HTMLElement | null;
      if (th && r) drawTrack(th, r.epochs.map((q) => ({ yr: q.yr, xi: q.xi, eta: q.eta, err: q.err, src: q.src })), r.pm, refPm);
      const sh = el.querySelector("#bk-sx") as HTMLElement | null;
      if (sh && m) drawMotion(sh, m, { onPick: seekFrame, center });
      const cb = el.querySelector("#bk-csv") as HTMLElement | null;
      if (cb && m) cb.onclick = () => csv("astrometry", ["mjd", "date_utc", "xi_east_arcsec", "eta_north_arcsec", "err_arcsec", "used", "visit", "observation"], m.pts.map((p) => [p.mjd.toFixed(5), frames[p.k].dateObs, p.xi.toFixed(3), p.eta.toFixed(3), p.err.toFixed(3), p.used ? 1 : 0, p.visit + 1, `${frames[p.k].obsid}D${frames[p.k].det}`]), "tangent-plane offsets from the field centre");
    }
    markCurrent();
  }
  /** the motion detector: every source of the field, what happened to it, and how sure that is */
  function renderChanges(el: HTMLElement) {
    if (building || frames.length < 4) { el.innerHTML = `<div class="bk-empty">The detector runs when the exposures are in${plan ? ` (${frames.length} of ${plan.picked})` : ""}.</div>`; return; }
    const R = report;
    if (!R) { el.innerHTML = `<div class="bk-empty">${detecting ? "Measuring…" : "No source stands above 5σ in the combined exposures of this field."}</div>`; return; }
    const k = R.counts, sel = selRow(), fov = ((N * PIX_ARCSEC) / 60).toFixed(1), plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const lead = [`<b>${plural(k.measured, "source")}</b> measured in this ${fov}′ field, at ${plural(R.visits.length, "SPHEREx visit")} (${R.visits[0].yr.toFixed(1)}–${R.visits[R.visits.length - 1].yr.toFixed(1)}) and against the surveys of 2010 and ~1999.`,
      k.moved ? `<b class="hl">${k.moved} moved</b>${k.movedUnknown ? ` — ${k.movedUnknown === k.moved ? (k.moved === 1 ? "it has" : "they have") : `${k.movedUnknown} of them ${k.movedUnknown === 1 ? "has" : "have"}`} no motion in Gaia` : ", all with a matching Gaia motion"}.` : "None moved.",
      k.brighter + k.fainter ? `<b class="hl">${k.brighter + k.fainter} changed brightness</b> by more than 30% since 2010.` : "None brightened or faded by more than 30% since 2010.",
      k.fresh ? `<b class="hl">${plural(k.fresh, "source")}</b> ${k.fresh === 1 ? "is" : "are"} absent from the older surveys.` : "", k.gone ? `<b class="hl">${plural(k.gone, "source")}</b> of 2010 ${k.gone === 1 ? "is" : "are"} not seen today.` : "",
      R.limits.pm ? `A motion of ${R.limits.pm.toFixed(2)}″ per year or more would have been detected here.` : ""].filter(Boolean).join(" ");
    const calib = [R.catalogs.gaia ? `Reference frame: ${plural(R.cal.nRef, "Gaia star")}${R.cal.astroRms ? `, ${R.cal.astroRms.toFixed(2)}″ scatter per visit` : ""}` : "Gaia not reachable: positions are uncalibrated",
      R.cal.pmRms ? `motions of Gaia stars recovered to ${R.cal.pmRms.toFixed(3)}″/yr` : "", R.catalogs.wise ? "" : "AllWISE not reachable: no 2010 comparison",
      masksAll ? "NASA's pixel flags applied" : `reading NASA's pixel flags (${masksDone}/${frames.length})`].filter(Boolean).join(" · ");
    const mo = (r: ChangeRow) => { const m = r.pm; if (!m || !(m.base > 5 || r.track)) return "–"; const e = Math.hypot(m.etot, R.cal.pmRms ?? 0.03); return `${m.tot.toFixed(m.tot < 1 ? 3 : 2)} <small>± ${e.toFixed(3)}</small>`; };
    const br = (r: ChangeRow) => { const d = r.dW2 ?? r.dW1; return d ? `${d.ratio.toFixed(2)}× <small>${d.band === "W2" ? "4.6" : "3.4"} µm</small>` : "–"; };
    el.innerHTML = `<h3 class="bk-h">What moved or changed in this field</h3><p class="bk-reading">${lead}</p>
      <div class="bk-tw tall"><table class="bk-table rows" id="bk-ctab"><thead><tr><th title="The number of the box on the image">#</th><th>what happened · which object</th><th title="Measured from the SPHEREx visits and the 2010 / ~1999 catalogue positions">motion (″/yr)</th><th title="The proper motion ESA's Gaia catalogue gives for the same star">Gaia (″/yr)</th><th title="Brightness today divided by the 2010 AllWISE brightness in the same band, on this field's zero point">now ÷ 2010</th></tr></thead><tbody>
      ${R.rows.map((r) => { const v = verdict(r), g = gaiaPm(r); return `<tr data-n="${r.n}" class="${r === sel ? "cur" : ""} ${v.cls === "off" ? "dim" : ""}"><td><i class="sw sq" style="border-color:${rowColor(r)}"></i>${r.n}</td>
        <td class="res"><em class="tag ${v.cls}">${v.chip}</em> <span class="vt">${esc(v.text)}</span><small>${esc(identity(r))}${r.isTarget ? " · your target" : ""}${r.linked ? " · linked to its 2010 position" : ""}</small></td><td class="num">${mo(r)}</td><td class="num">${g === null ? "–" : g.toFixed(3)}</td><td class="num">${br(r)}</td></tr>`; }).join("")}
      ${R.gone.map((q) => `<tr class="dim"><td>–</td><td class="res"><em class="tag warn">gone?</em> <span class="vt">in the 2010 survey, not seen today</span><small>${esc(q.wise.id)}</small></td><td class="num">–</td><td class="num">–</td><td class="num">–</td></tr>`).join("")}</tbody></table></div>
      <div class="bk-bar2"><span class="mono">${calib}</span><span><button class="link" id="bk-csv">CSV</button></span></div>
      <p class="bk-cap">Sources above 5σ on the combined exposures; one position per visit, tied to Gaia by the field's own stars; counterparts in AllWISE (2010) and 2MASS (~1999); a straight-line fit through all dates. “Moved” needs 5σ against the scatter with which Gaia stars are recovered in this same field. Saturated, blended and edge sources are listed but not judged. Click a row, or a box on the image, to point the other instruments at that source.</p>`;
    el.querySelectorAll<HTMLTableRowElement>("#bk-ctab tbody tr[data-n]").forEach((tr) => (tr.onclick = () => { const q = R.rows.find((x) => x.n === +tr.dataset.n!); if (q) selectRow(q); }));
    (el.querySelector("#bk-csv") as HTMLElement).onclick = () => csv("field_changes", ["n", "ra_deg", "dec_deg", "result", "pm_ra_arcsec_yr", "pm_dec_arcsec_yr", "pm_err", "pm_sigma", "baseline_yr", "gaia_pm_ra", "gaia_pm_dec", "ratio_W1", "z_W1", "ratio_W2", "z_W2", "snr", "identity", "tags"],
      R.rows.map((r) => [r.n, r.ra.toFixed(6), r.dec.toFixed(6), verdict(r).chip, r.pm?.ra.toFixed(4) ?? "", r.pm?.dec.toFixed(4) ?? "", r.pm ? Math.hypot(r.pm.etot, R.cal.pmRms ?? 0.03).toFixed(4) : "", r.pm?.sig.toFixed(1) ?? "", r.pm?.base.toFixed(1) ?? "",
        gaiaPm(r) !== null ? r.gaia!.pmra.toFixed(4) : "", gaiaPm(r) !== null ? r.gaia!.pmdec.toFixed(4) : "", r.dW1?.ratio.toFixed(3) ?? "", r.dW1?.z.toFixed(1) ?? "", r.dW2?.ratio.toFixed(3) ?? "", r.dW2?.z.toFixed(1) ?? "", r.snr.toFixed(0), `"${identity(r)}"`, `"${r.tags.join(" ")}"`]), "sources of the field and what changed (motion detector)");
  }
  /** what could still hide here: model bodies against the depth actually reached in this field */
  function renderLimits(el: HTMLElement) {
    const errs: number[] = []; let nb = 0;
    report?.rows.forEach((r) => { if (r.tags.some((t) => t === "SATURATED" || t === "BLENDED" || t === "EDGE")) return; const v = r.P.filter((p) => !p.flagged && p.lam >= 4.1 && p.lam <= 5.0); if (v.length) { errs.push(...v.map((p) => p.err)); nb = Math.max(nb, v.length); } });
    const single = errs.length ? 5 * median(errs) : null, stack = single && nb ? single / Math.sqrt(nb) : null;
    if (!single || !stack) { el.innerHTML = `<div class="bk-empty">${building ? "Waiting for the exposures…" : "No exposure at 4–5 µm covers this field yet, so its depth cannot be measured."}</div>`; return; }
    const rows = BODIES.map((b) => { const d1 = reach(b, single), d2 = reach(b, stack); return [`<i class="sw" style="background:${b.color}"></i>${esc(b.name)}`, d1 ? fmtDist(d1) : "not detectable", d2 ? fmtDist(d2) : "not detectable", d2 ? `${halfYearShift(d2) >= 60 ? `${(halfYearShift(d2) / 60).toFixed(0)}′` : `${halfYearShift(d2).toFixed(1)}″`}` : "–"]; });
    const j = reach(BODIES[2], stack), y = reach(BODIES[3], stack), p9 = BODIES[0].flux(500);
    el.innerHTML = `<h3 class="bk-h">What could still hide in this field</h3>
      <p class="bk-reading"><b>Reading</b> With the ${nb} exposures at 4–5 µm combined, this field reaches <b>${stack.toPrecision(2)} mJy</b> (5σ). A second Jupiter would be seen out to <b>${j ? fmtDist(j) : "nowhere"}</b>, a 250 K brown dwarf like WISE 0855 out to <b>${y ? fmtDist(y) : "nowhere"}</b>. Planet Nine as proposed, at 500 au, would be <b>${p9 >= stack ? "detectable" : `${fmtBig(stack / p9)} times too faint`}</b>: SPHEREx cannot rule it in or out here.</p>
      <div class="bk-plot-host" id="bk-lim"></div>
      ${tbl(["body", "seen out to: one exposure", `${nb} combined`, "shift in 6 months there"], rows)}
      <p class="bk-cap show">Curves: brightness at 4.6 µm against distance from the Sun. Planets: reflected sunlight (falls as distance⁴) plus their own heat as a blackbody; brown dwarfs: the measured brightness of a real one, scaled as distance². Horizontal lines: the faintest point source this field's exposures can show, from the measured noise of its sources. Everything above the green line is excluded here. The last column is why such an object would stand out: seen from the Earth's orbit it changes place by that much between two visits. Assumptions — ${BODIES.map((b) => `${esc(b.name)}: ${esc(b.note)}`).join("; ")}.</p>`;
    drawLimits(el.querySelector("#bk-lim") as HTMLElement, BODIES.map((b) => ({ name: b.name, color: b.color, dash: b.dash, pts: Array.from({ length: 60 }, (_, q) => { const d = b.range[0] * Math.pow(b.range[1] / b.range[0], q / 59); return { d, f: b.flux(d) }; }) })), { single, stack, n: nb });
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
  function setViewMode(v: string) { mode = v === "frames" ? (order === "lambda" ? "lambda" : "time") : (v as Mode); idx = 0; playing = false; refresh(); }
  host.querySelectorAll<HTMLButtonElement>("#bk-range button").forEach((b) => (b.onclick = () => { evo.range = b.dataset.r as typeof evo.range; evo.rate = evo.range === "sx" ? 0.5 : evo.range === "2010" ? 2 : 5;
    const [a, z] = evoSpan(); evo.t = evo.range === "sx" ? Math.min(z, Math.max(a, evo.t)) : a; playing = false; refresh(); }));
  $("#bk-loop").onclick = () => { evo.loop = !evo.loop; syncControls(); };
  ($("#bk-rate") as HTMLSelectElement).onchange = (e) => { const v = +(e.target as HTMLSelectElement).value; if (mode === "evolve") evo.rate = v; else fps = v; tick(); };
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
  host.querySelectorAll<HTMLButtonElement>("#bk-tabs button[data-t]").forEach((b) => (b.onclick = () => { tab = b.dataset.t as Tab; syncControls(); renderReadouts(); renderPanel(); paint(); }));
  $("#bk-help").onclick = () => { explain = !explain; try { localStorage.setItem("mira.explain", explain ? "1" : "0"); } catch { /* private mode */ } syncControls(); };
  const sv = host.querySelector<HTMLButtonElement>("#bk-save");
  if (sv) sv.onclick = () => { if (!frames.length) return; opts.onSave?.(snapshot()); sv.textContent = "Saved ✓"; setTimeout(() => (sv.textContent = "Save as a case"), 1800); };
  const togglePlay = () => { playing = !playing; if (playing && mode === "evolve") { const [a, z] = evoSpan(); if (evo.t >= z - 1e-3) evo.t = a; evo.hold = 0; } syncControls(); tick(); };
  $("#bk-play").onclick = togglePlay;
  $("#bk-prev").onclick = () => seek(idx - 1); $("#bk-next").onclick = () => seek(idx + 1);
  const scrub = (e: PointerEvent) => { const r = strip.getBoundingClientRect(), n = items.length;
    if (mode === "evolve") { const [a, z] = evoSpan(); let t = a + Math.min(1, Math.max(0, (e.clientX - r.left - 14) / (r.width - 28))) * (z - a);
      const near = evoStops().find((q) => Math.abs(q.yr - t) < (z - a) * 0.012); if (near) t = near.yr;        // dates with data are magnetic
      evo.t = t; playing = false; cancelAnimationFrame(evo.raf); paint(); syncControls(); return; }
    if (n) seek(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left - 8) / (r.width - 16))) * (n - 1))); };
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
    const it = items[idx]; if (!it) return;
    let [x, y] = pixAt(e);
    // a click on a measured source selects it
    if (view.det && report) { const yr = mjdToYear(itMjd(it)); let hit: ChangeRow | null = null, hd = 2.5; for (const r of report.rows) { const [rx, ry] = rowAt(r, yr), d2 = Math.hypot(rx - x, ry - y); if (d2 < hd) { hd = d2; hit = r; } } if (hit) { selectRow(hit); return; } }
    if (it.kind === "rgb" || it.kind === "diff") return; const img = imageOf(it) as Float32Array, [ox, oy] = shiftOf(it);
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
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    else if (e.key === "ArrowRight") seek(idx + 1); else if (e.key === "ArrowLeft") seek(idx - 1);
    else if (e.key >= "1" && e.key <= "4") setViewMode(VIEWS[+e.key - 1].k);
    else if (e.key === "d") toggle("det"); else if (e.key === "t" && hasPm()) toggle("track"); else if (e.key === "g") toggle("gaia"); else if (e.key === "w") toggle("wise"); else if (e.key === "m") toggle("mask"); else if (e.key === "l") toggle("lock");
  };
  addEventListener("keydown", onKey);
  const ro = new ResizeObserver(() => { if (opened) paint(); }); ro.observe($("#bk-stage"));
  void hover;
  syncControls(); renderTarget(); renderReadouts(); renderPanel(); renderData(); hud(null);

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
    pause() { clearTimeout(timer); cancelAnimationFrame(evo.raf); playing = false; syncControls(); },
    resume() { if (opened && items.length) { syncControls(); paint(); } },
    destroy() { ac?.abort(); clearTimeout(timer); cancelAnimationFrame(evo.raf); removeEventListener("keydown", onKey); ro.disconnect(); host.innerHTML = ""; },
    /** what the page shows right now, for the assistant: the field, the detector's findings and the selected source */
    context() {
      const r = selRow(), R = report;
      return { open: opened, target: opened ? { name: target.name ?? null, ra: +center[0].toFixed(5), dec: +center[1].toFixed(5), field_arcmin: +((N * PIX_ARCSEC) / 60).toFixed(1) } : null,
        exposures: frames.length, visits: R?.visits.map((v) => +v.yr.toFixed(2)) ?? [], instrument: tab, view: mode, loading: building,
        field: R ? { ...R.counts, gaia_reference_stars: R.cal.nRef, gaia_motion_recovery_arcsec_yr: R.cal.pmRms ? +R.cal.pmRms.toFixed(3) : null, smallest_detectable_motion_arcsec_yr: R.limits.pm ? +R.limits.pm.toFixed(2) : null,
          sources: R.rows.slice(0, 25).map((q) => ({ n: q.n, result: verdict(q).chip, detail: verdict(q).text, motion_arcsec_yr: q.pm && q.pm.base > 5 ? +q.pm.tot.toFixed(3) : null, sigma: q.pm ? +q.pm.sig.toFixed(1) : null,
            gaia_motion: gaiaPm(q) !== null ? +gaiaPm(q)!.toFixed(3) : null, now_over_2010: (q.dW2 ?? q.dW1) ? +(q.dW2 ?? q.dW1)!.ratio.toFixed(2) : null, identity: identity(q), target: q.isTarget })) } : null,
        selected: r ? { n: r.n, identity: identity(r), result: verdict(r).chip, detail: verdict(r).text } : null,
        readings: answers ? { astrometer: answers.move.text.replace(/<[^>]+>/g, ""), photometer: answers.change.text.replace(/<[^>]+>/g, ""), spectrograph: answers.made.text.replace(/<[^>]+>/g, "") } : null };
    },
    /** let the assistant operate the instruments */
    act(a: { instrument?: string; view?: string; select?: number; play?: boolean; date?: number; range?: string; layers?: Record<string, boolean> }) {
      if (a.instrument && TABS.some((t) => t[0] === a.instrument)) tab = a.instrument as Tab;
      if (a.view && VIEWS.some((v) => v.k === a.view)) setViewMode(a.view);
      if (a.range && ["sx", "2010", "1999"].includes(a.range)) { evo.range = a.range as typeof evo.range; const [x0] = evoSpan(); evo.t = x0; }
      if (typeof a.date === "number") { const [x0, x1] = evoSpan(); evo.t = Math.min(x1, Math.max(x0, a.date)); }
      if (a.layers) for (const k of ["det", "gaia", "wise", "mask", "track"] as const) if (k in a.layers) (view as any)[k] = !!a.layers[k];
      if (typeof a.select === "number" && report) { const q = report.rows.find((x) => x.n === a.select); if (q) { selectRow(q); } }
      if (typeof a.play === "boolean" && a.play !== playing) togglePlay();
      syncControls(); renderReadouts(); renderPanel(); paint();
    },
    get isOpen() { return opened; },
  };
}
