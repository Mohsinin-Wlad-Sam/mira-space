import "./style.css";
import { load, fmt, sexa, key, loadDetail, BASE, type Summary, type Target, type Obj } from "./data";
import { drawSpectrum } from "./spectrum";
import { spectrumStory, lightStory } from "./explain";
import { mountBlink, type BlinkTarget } from "./blink/view";
import { parseCoords, CHALLENGE } from "./blink/catalogs";
import type { SpaceHandle } from "./space";
import { setBase } from "./blink/engine";
import { mountLightCurve } from "./lightcurve";
import { mountTwins, sparkline } from "./twins";
import { SkyLayer, REF_YEAR, WISE_EPOCH, type Row } from "./sky";
import { smoothZoom, onTap } from "./controls";
import { loadSettings, saveSettings, DEFAULTS, SURVEYS, LADDER, COLORMAPS, PROJECTIONS, LOW_POWER, type Settings, type SurveyKey } from "./settings";

const FLIP_IDS: Record<string, string> = { "Barnard's Star": "barnard", "Epsilon Indi B": "eps-indi-b", "WISE 0855-0714": "wise-0855", "WISE 0855−0714": "wise-0855", "RW Aurigae": "rw-aur", "R Draconis": "r-dra" };
const NEARBY: Record<string, string> = { "Barnard's Star": "Barnard's Star", "Epsilon Indi B": "Epsilon Indi B", "WISE 0855-0714": "WISE 0855-0714", "WISE 0855−0714": "WISE 0855-0714" };
let stop3d: (() => void) | undefined;

// ============================================================================ constants
const WISE_URL = SURVEYS.wise.url;
const LENSES = {
  movers: { t: "Motion", c: "#7cc4ff", d: "Objects that crossed the sky between WISE (2010) and SPHEREx (2025)." },
  methane: { t: "Methane", c: "#c792ff", d: "Cold worlds: their 3.3 µm light is absorbed by methane." },
  vanished: { t: "Vanished", c: "#ff5c6c", d: "Bright in WISE, faint or gone in SPHEREx a decade later." },
  brightened: { t: "Brightened", c: "#ffc857", d: "Much brighter now than in the WISE era." },
  unusual: { t: "Unusual", c: "#5be3a6", d: "AI flags spectra unlike anything else it has seen." },
  candidates: { t: "New worlds?", c: "#ff7ad9", d: "Possible new cold brown dwarfs: AI says brown dwarf, within 160 ly, moving or methane-rich, and not in the known-object catalogue." },
} as const;
type LensKey = keyof typeof LENSES;
const BLANK = new Set([50, 51]);
const OVERVIEW_UM = 1.6;
const T_MIN = 2010.5, T_MAX = 2025.84;             // measured era only: WISE (2010) to SPHEREx (2025); no extrapolation

// ============================================================================ state
const ui = document.getElementById("ui")!;
const set: Settings = loadSettings();
const S = {
  al: null as any, overlay: null as any, sky: null as SkyLayer | null, lam: [] as number[], chan: 94,
  lenses: new Set<LensKey>(["movers", "methane"]), blinkTimer: 0 as any, tourStep: -1, targets: [] as Target[], summary: null as Summary | null,
  unusual: new Map<string, any>(), cands: new Map<string, any>(), candMeta: null as any, year: REF_YEAR, playing: false, speed: 2, loop: true, matched: false, zoom: { speed: set.zoomSpeed, toCursor: set.zoomToCursor },
};
if (import.meta.env.DEV) (window as any).__S = S;
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
function toast(msg: string) { const t = $(".toast"); t.textContent = msg; t.classList.add("show"); clearTimeout((t as any)._h); (t as any)._h = setTimeout(() => t.classList.remove("show"), 2400); }
function hashParams() { return new URLSearchParams(location.hash.replace(/^#\/?\??/, "")); }
document.body.classList.toggle("saver", set.saver);

// ============================================================================ layout
ui.innerHTML = `
<header class="top">
  <a class="logo" href="/" aria-label="Mira home">
    <img src="/brand/mira-mark.png" width="59" height="32" alt="">
    <span>MIRA<small>Digital research observatory</small></span></a>
  <nav class="mainnav" aria-label="The observatory">
    <button data-view="universe" title="Everything found, where it is: fly to a star, see it move in real pictures, help look at the unnamed ones">Map</button>
    <button data-view="blink" title="Deep analysis: point at any field of the sky and measure it with the instruments">Lab</button>
    <button data-view="cat" title="The data behind the map: every confirmed motion, to filter, sort and export">Catalogue</button>
    <button data-view="log" title="Your saved measurements, lists and notes">Cases</button>
  </nav>
  <form class="search" id="search" role="search"><input id="q" placeholder="Find a star, or any position in the sky" autocomplete="off" enterkeyhint="search" aria-label="Find a star by name, or give coordinates to measure that field"></form>
  <button class="btn ghost sm" id="asstbtn" title="Ask the assistant: it reads this page and can operate the instruments">Assistant</button>
  <button class="btn ghost sm" id="aboutbtn">Method</button>
</header>
<section class="catpage" id="catpage"></section>
<aside class="asst" id="asst" hidden></aside>

<div class="unimode seg" id="unimode" role="tablist" aria-label="Two ways to look at the universe"><button data-m="3d" title="Fly through space: every object at its measured distance">In 3D</button><button data-m="map" title="The whole sky as seen from Earth, 2010 against 2025">Sky map</button></div>
<section class="blinkpage" id="blinkpage"></section>
<section class="logpage" id="logpage"></section>

<aside class="lenses" id="lenses">
  <div class="eyebrow lens-head">The survey · what changed since 2010</div>
  ${(Object.keys(LENSES) as LensKey[]).map((k) => `<button class="lens" data-k="${k}" style="--c:${LENSES[k].c}"><span class="sw"></span>
    <span class="t">${LENSES[k].t}</span><span class="n" id="n-${k}">–</span><span class="d">${LENSES[k].d}</span></button>`).join("")}
  <details class="lensmore"><summary>Live sky</summary>
  <div class="livebtns"><button class="lens livet" id="livess" style="--c:#ffd27a"><span class="sw"></span><span class="t">Solar System now</span><span class="n">live</span>
    <span class="d">Planets, Moon, Sun, spacecraft and passing asteroids where they are on the timeline's date.</span></button>
    <button class="lens livet" id="livesky" style="--c:#5be3a6"><span class="sw"></span><span class="t">My sky now</span><span class="n">⌖</span>
    <span class="d">Your horizon and what is overhead where you are, right now.</span></button></div></details>
  <div class="lodstat mono" id="lodstat"></div>
  <div class="lensfoot"><button class="link" id="tourbtn">Guided tour</button><button class="link" id="viewbtn">Display</button></div>
</aside>

<nav class="ladder" id="ladder" aria-label="See the sky in different light">
  <span class="eyebrow">Wavelength</span>
  ${LADDER.map((k) => `<button class="rung" data-s="${k}" title="${SURVEYS[k].label}"><b>${SURVEYS[k].short}</b><small>${SURVEYS[k].band}</small></button>`).join("")}
</nav>
<div class="ladcap" id="ladcap"></div>

<div class="dock">
  <div class="timebar" id="timebar">
    <button class="btn sm play" id="tplay" aria-label="Play">▶</button>
    <div class="yearbox"><b id="tyear">2025.8</b><small id="tlbl">SPHEREx imagery</small></div>
    <div class="tslide"><input type="range" id="tslider" min="${T_MIN}" max="${T_MAX}" step="0.01" value="${REF_YEAR}">
      <div class="tticks2"><span>2010 · WISE</span><span>2015</span><span>2020</span><span>2025 · SPHEREx</span></div></div>
    <select id="tspeed" aria-label="Playback speed">
      <option value="0.5">½ yr/s</option><option value="1">1 yr/s</option><option value="2" selected>2 yr/s</option><option value="5">5 yr/s</option><option value="15">15 yr/s</option><option value="40">40 yr/s</option></select>
    <button class="btn sm ghost" id="blink" title="Flip the map between WISE 2010 and SPHEREx 2025 (B)">2010 ↔ 2025</button>
  </div>
  <div class="rainbow" id="rainbow">
    <div class="lab"><span class="eyebrow">SPHEREx sees 102 colours — drag to change wavelength</span><b id="chanlbl">–</b></div>
    <div class="bar" id="bar"><div class="knob" id="knob"></div></div>
    <div class="ticks"><span>0.75 µm</span><span>1</span><span>1.5</span><span>2</span><span>2.5</span><span>3</span><span>3.5</span><span>4</span><span>4.5</span><span>5 µm</span></div>
  </div>
</div>

<section class="panel" id="panel"><div class="grab"></div><button class="icon-btn close" id="pclose">✕</button><div id="pbody"></div></section>
<section class="tour" id="tour" style="display:none"></section>
<section class="drawer" id="drawer"></section>
<section class="about" id="about"></section>
<section class="hood" id="hood"></section>
<section class="space" id="space"></section>
<section class="labpage" id="labpage"></section>

<div class="tip" id="tip"></div>
<div class="toast"></div>`;

// ============================================================================ sky
let A: any = null;
async function initSky() {
  A = (await import("aladin-lite")).default;      // 2.5 MB with its WebAssembly: loaded only when the atlas is opened
  await A.init;
  const p = hashParams();
  const start = p.get("ra") ? `${p.get("ra")} ${p.get("dec")}` : "266.4 -28.9";
  S.al = A.aladin("#sky", {
    // start zoomed in (regular tiles load reliably), then reveal the whole globe; a direct all-sky start renders black
    survey: SURVEYS[set.survey].url, fov: parseFloat(p.get("fov") ?? "30"), target: start, projection: set.projection, cooFrame: set.galactic ? "galactic" : "ICRS",
    showReticle: false, showLayersControl: false, showZoomControl: false, showFullscreenControl: false, showCooLocation: false,
    showFrame: false, showProjectionControl: false, showSettingsControl: false, showStatusBar: false, showShareControl: false,
    showSimbadPointerControl: false, showCooGridControl: false, showContextMenu: false, showFov: false, log: false,
    backgroundColor: "rgb(0,0,0)", inertia: true,
  });
  S.overlay = A.imageHiPS(WISE_URL, { name: "WISE 2010" });
  S.al.setOverlayImageLayer(S.overlay, "wise");
  setTimeout(() => { try { S.overlay.setOpacity(0); } catch { /* */ } }, 50);
  [300, 900, 1800, 3500, 6000].forEach((ms) => setTimeout(() => { setChan(S.chan); styleLayers(); }, ms));
  nudge();
  let touched = false; const mark = () => { touched = true; };
  ["pointerdown", "wheel", "keydown"].forEach((ev) => addEventListener(ev, mark, { once: true, capture: true }));
  const wide = set.projection === "AIT" || set.projection === "MOL" ? 360 : 150;       // all-sky projections show the entire sky
  if (!p.get("fov")) setTimeout(() => { if (touched) return; try { S.al.zoomToFoV(wide, 3.0, () => nudge()); } catch { S.al.setFoV(wide); } nudge([3500, 5000, 7000]); }, 3500);
  applyGrid();
  const host = $("#sky");
  S.sky = new SkyLayer(S.al, host, { colors: Object.fromEntries(Object.entries(LENSES).map(([k, v]) => [k, v.c])), size: set.markerSize, trails: set.trails,
    labels: set.labels, maxMarkers: set.saver ? Math.min(set.maxMarkers, 500) : set.maxMarkers, density: set.density }, set.saver || LOW_POWER);
  S.sky.onStats = (s) => { const el = $("#lodstat"); if (el) el.textContent = s; };
  smoothZoom(S.al, host, S.zoom);
  // right-click = "inspect this spot" (window capture phase: runs before Aladin's own context menu)
  const ctxInspect = (e: MouseEvent) => { if (!host.contains(e.target as Node)) return; e.preventDefault(); e.stopImmediatePropagation();
    const r = host.getBoundingClientRect(); const p = S.sky?.pix2icrs(e.clientX - r.left, e.clientY - r.top); if (p) openPosition(p[0], p[1]); };
  addEventListener("contextmenu", ctxInspect, { capture: true });
  addEventListener("mouseup", (e) => { if (e.button === 2 && host.contains(e.target as Node)) e.stopImmediatePropagation(); }, { capture: true });
  addEventListener("mousedown", (e) => { if (e.button === 2 && host.contains(e.target as Node)) e.stopImmediatePropagation(); }, { capture: true });
  let lp = 0 as any; host.addEventListener("touchstart", (e) => { if (e.touches.length !== 1) return; const t = e.touches[0]; lp = setTimeout(() => { const r = host.getBoundingClientRect(); const p = S.sky?.pix2icrs(t.clientX - r.left, t.clientY - r.top); if (p) openPosition(p[0], p[1]); }, 650); }, { passive: true });
  ["touchend", "touchmove", "touchcancel"].forEach((ev) => host.addEventListener(ev, () => clearTimeout(lp), { passive: true }));
  onTap(host, (x, y, ev) => {
    const lv = S.sky!.pickLive(x, y, ev.pointerType === "touch" ? 24 : 14); if (lv) { openLive(lv); return; }
    const h = S.sky!.pick(x, y, ev.pointerType === "touch" ? 26 : 16);
    if (!h) return;
    openHit(h.lens as LensKey, h.row);
  }, hoverAt);
}
let hoverRaf = 0;
function hoverAt(x: number, y: number) {
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0; const h = S.sky?.pick(x, y, 14); const tip = $("#tip"); const sky = $("#sky");
    if (!h) { tip.classList.remove("on"); sky.style.cursor = ""; return; }
    sky.style.cursor = "pointer";
    const r = h.row, lens = h.lens as LensKey;
    // plain language: what the number means
    const pm = r[5] ?? 0, ratio = r[8];
    const sc = lens === "movers" ? `moves ${fmt(pm, 2)}″ a year — it would cross the full Moon's width in ${Math.round(1800 / Math.max(pm, 0.01)).toLocaleString()} years`
      : lens === "methane" ? `${Math.round(Math.min(1, Math.max(0, 1 - pm)) * 100)}% darker at 3.3 µm than at 4 µm — methane in its air`
      : lens === "vanished" ? (ratio != null ? `now ${Math.round(Math.max(0, ratio) * 100)}% as bright as in the WISE years` : `much fainter than in the WISE years`)
      : lens === "brightened" ? (ratio != null ? `${fmt(ratio, 1)}× brighter than in the WISE years` : `much brighter than in the WISE years`)
      : lens === "candidates" ? (() => { const c = S.cands.get(r[0]); return c ? `possible new brown dwarf · ~${fmtLy(c.ai_dist)} away · not in known catalogues` : "possible new cold world"; })()
      : `its light matches no familiar pattern`;
    tip.innerHTML = `<b style="color:${LENSES[lens].c}">${LENSES[lens].t}</b><br>${sc}<br><span>click for the evidence</span>`;
    tip.style.transform = `translate(${x + 16}px, ${y + 12}px)`; tip.classList.add("on");
  });
}

// Aladin does not repaint when late tiles arrive until the view changes: re-set the same FoV a few times
function nudge(times: number[] = [800, 1800, 3000, 4500, 6500, 9000, 12500, 17000]) {
  for (const ms of times) setTimeout(() => { try { const f = S.al.getFov()[0]; S.al.setFoV(f); } catch { /* */ } }, ms);
}
// built-in pure-channel colormaps (Aladin's custom colormaps share one texture, so three of them cannot coexist)
const RGB = [{ name: "blue", um: 1.2 }, { name: "green", um: 3.3 }, { name: "red", um: 4.6 }];
function rgbLayers(): any[] { return [S.al?.getBaseImageLayer?.(), S.al?.getOverlayImageLayer?.("sxg"), S.al?.getOverlayImageLayer?.("sxr")]; }
function styleLayers() {
  if (SURVEYS[set.survey].rgb) {
    rgbLayers().forEach((l, i) => { try { setCubeFrame(l, nearestChan(RGB[i].um)); l?.setColormap?.(RGB[i].name, { stretch: "asinh" }); l?.setGamma?.(set.gamma); l?.setContrast?.(set.contrast); l?.setBrightness?.(set.brightness); if (i) l?.setBlendingConfig?.(true); } catch { /* not ready */ } });
    try { S.overlay?.setColormap?.(set.colormap === "native" ? "magma" : set.colormap, { stretch: set.stretch }); } catch { /* */ }
    return;
  }
  const native = set.colormap === "native" || SURVEYS[set.survey].color;
  for (const l of [S.al?.getBaseImageLayer?.(), S.overlay]) {
    try {
      const isOverlay = l === S.overlay;
      l?.setColormap?.(native && !isOverlay ? "native" : (set.colormap === "native" ? "magma" : set.colormap), { stretch: set.stretch });
      l?.setGamma?.(set.gamma); l?.setContrast?.(set.contrast); l?.setBrightness?.(set.brightness);
    } catch { /* not ready */ }
  }
}
function applyGrid() {
  try { S.al.setCooGrid({ enabled: set.grid, color: "rgb(160,190,255)", opacity: 0.35, labelSize: 11, showLabels: true }); } catch { /* */ }
}
function applySurvey() {
  const sv = SURVEYS[set.survey];
  for (const n of ["sxg", "sxr"]) try { if (S.al.getOverlayImageLayer?.(n)) S.al.removeImageLayer(n); } catch { /* */ }
  // choose the frame the moment the cube is added: Aladin's own default is one of the two blank (dichroic) frames
  const first = (k: () => number) => (sv.cube ? { successCallback: (h: any) => { try { setCubeFrame(h, k()); } catch { /* */ } } } : {});
  try { S.al.setBaseImageLayer(A.imageHiPS(sv.url, { name: set.survey, ...first(() => (sv.rgb ? nearestChan(RGB[0].um) : S.chan)) })); } catch { try { S.al.setImageSurvey(sv.url); } catch { /* */ } }
  if (sv.rgb) RGB.slice(1).forEach((c, i) => { const n = ["sxg", "sxr"][i]; try { const l = A.imageHiPS(sv.url + "/".repeat(i + 1), { name: n, additive: true, colormap: c.name, stretch: "asinh", ...first(() => nearestChan(c.um)) }); S.al.setOverlayImageLayer(l, n); } catch { /* */ } });
  $("#rainbow").style.display = sv.cube && !sv.rgb ? "" : "none";
  document.querySelectorAll<HTMLElement>(".rung").forEach((b) => b.classList.toggle("on", b.dataset.s === set.survey));
  [400, 1500, 3000, 5000].forEach((ms) => setTimeout(() => { if (sv.cube && !sv.rgb) setChan(S.chan); styleLayers(); }, ms)); nudge([600, 2000, 4000]);
}
function pickSurvey(k: SurveyKey, caption = true) {
  set.survey = k; saveSettings(set); applySurvey();
  const sky = $("#sky"); sky.classList.remove("flash"); void sky.offsetWidth; sky.classList.add("flash");
  if (caption) { const c = $("#ladcap"); c.innerHTML = `<b>${SURVEYS[k].label}</b> · ${SURVEYS[k].band}<br>${SURVEYS[k].what}`; c.classList.add("show"); clearTimeout((c as any)._h); (c as any)._h = setTimeout(() => c.classList.remove("show"), 7000); }
  if (document.getElementById("drawer")?.classList.contains("open")) renderDrawer();
}

// ============================================================================ lenses (chunked, zoom-aware)
async function loadLenses() {
  const meta = await S.sky!.init(BASE);
  for (const k of ["movers", "methane", "vanished", "brightened"] as LensKey[]) {
    const r = meta ? await S.sky!.loadTop(k) : null;
    const tot = meta?.lenses[k]?.total ?? r?.total;
    $(`#n-${k}`).textContent = tot ? tot.toLocaleString() : "–";
  }
  const cd = await load<{ meta: any; items: any[] }>("candidates", true);
  if (cd) {
    S.candMeta = cd.meta;
    const rows: Row[] = cd.items.map((it) => { const id = `${it.tile}-${it.obj}`; S.cands.set(id, it); return [id, it.ra_sx, it.dec_sx, it.reliable_motion ? it.pmra : null, it.reliable_motion ? it.pmdec : null, it.score, it.w2_uJy]; });
    S.sky!.setExtra("candidates", rows); $("#n-candidates").textContent = cd.items.length.toLocaleString();
  }
  const u = await load<{ n: number; items: any[] }>("unusual", true);
  if (u) {
    const rows: Row[] = u.items.map((it) => { const id = `${it.tile}-${it.obj}`; S.unusual.set(id, it); return [id, it.ra_sx, it.dec_sx, null, null, it.anomaly, null]; });
    S.sky!.setExtra("unusual", rows); $("#n-unusual").textContent = u.n.toLocaleString();
  }
  S.sky!.setLabels(S.targets.filter((t) => t.census).map((t) => ({ name: t.name.replace("-", "−"), ra: t.census!.ra_sx, dec: t.census!.dec_sx, pmra: t.census!.reliable_motion ? t.census!.pmra : null, pmdec: t.census!.reliable_motion ? t.census!.pmdec : null })));
  applyLenses();
}
function applyLenses() {
  for (const k of Object.keys(LENSES) as LensKey[]) document.querySelector(`.lens[data-k="${k}"]`)!.classList.toggle("on", S.lenses.has(k));
  S.sky?.setLenses(S.lenses);
}
async function openHit(lens: LensKey, row: Row) {
  S.sky?.select(row[0]);
  if (lens === "unusual") { openUnusual(S.unusual.get(row[0])); return; }
  if (lens === "candidates") { const c = S.cands.get(row[0]); if (c) { const o = { ...c } as any; if (c.spec_b64 === undefined && c.spec) o.spec = c.spec; openObject(o, "candidates", "Possible new cold world"); } return; }
  const t = S.targets.find((x) => x.census && key(x.census) === row[0]);
  if (t?.census) { openObject(t.census, lens, t.name); return; }
  const o = await loadDetail(row[0]);
  if (o) openObject(o, lens); else toast("Details for this object are still being exported");
}

// ============================================================================ live Solar System + my sky (lazy: pulls three.js math only when used)
let liveOn = false, liveT = 0, liveYear = NaN, myPos: { lat: number; lon: number } | null = null, liveMod: typeof import("./skylive") | null = null;
async function refreshLive(force = false) {
  if (!S.sky) return;
  if (!liveOn) { S.sky.setLive([]); return; }
  if (!force && Math.abs(S.year - liveYear) < 1 / 365.25) return;
  liveYear = S.year; liveMod ??= await import("./skylive");
  // the map's "now" is the SPHEREx epoch; for the live sky we use the real date when the slider sits at the present
  const y = Math.abs(S.year - REF_YEAR) < 0.02 ? 1970 + Date.now() / (365.25 * 864e5) : S.year;
  S.sky.setLive(await liveMod.skyLiveAt(y));
  if (myPos && $("#livesky").classList.contains("on")) { const h = liveMod.horizon(myPos.lat, myPos.lon, new Date((y - 1970) * 365.25 * 864e5));
    S.sky.setHorizon({ ...h, label: `OVERHEAD · ${Math.abs(y - (1970 + Date.now() / (365.25 * 864e5))) < 0.01 ? "NOW" : fmtYear(y)} · ${myPos.lat.toFixed(1)}°, ${myPos.lon.toFixed(1)}°` }); }
}
function scheduleLive() { clearTimeout(liveT); liveT = setTimeout(() => refreshLive(), S.playing ? 60 : 120) as any; }
async function toggleMySky(on: boolean) {
  $("#livesky").classList.toggle("on", on);
  if (!on) { S.sky?.setHorizon(null); return; }
  const apply = async () => { liveMod ??= await import("./skylive"); const h = liveMod.horizon(myPos!.lat, myPos!.lon);
    S.sky?.setHorizon({ ...h, label: `OVERHEAD NOW · ${myPos!.lat.toFixed(1)}°, ${myPos!.lon.toFixed(1)}°` }); flyTo(h.zenith[0], h.zenith[1], 180); toast("Centre = straight up where you are. The green dashed rim is your horizon: everything inside is in your sky right now."); };
  if (myPos) return apply();
  navigator.geolocation?.getCurrentPosition((p) => { myPos = { lat: p.coords.latitude, lon: p.coords.longitude }; apply(); },
    () => { toast("Location not shared — showing the sky over Abu Dhabi instead"); myPos = { lat: 24.45, lon: 54.38 }; apply(); }, { timeout: 8000 });
}
function openLive(it: { name: string; kind: string; note: string; ra: number; dec: number; color: string }) {
  stop3d?.(); stop3d = undefined; S.sky?.select(null);
  const kind = { sun: "Our star", moon: "Earth's Moon", planet: "Planet", craft: "Spacecraft · live from JPL Horizons", rock: "Asteroid passing Earth · live from JPL" }[it.kind] ?? "";
  const when = Math.abs(S.year - REF_YEAR) < 0.02 ? "today" : `in ${fmtYear(S.year)}`;
  $("#pbody").innerHTML = `<div class="eyebrow" style="color:${it.color}">${kind}</div><h2 class="display">${esc(it.name)}</h2>
    <div class="coord">RA ${fmt(it.ra, 3)}° · Dec ${fmt(it.dec, 3)}° · seen from Earth ${when}</div>
    <p class="why">${esc(it.note[0].toUpperCase() + it.note.slice(1))}.${it.kind === "planet" || it.kind === "moon" ? " Play the time slider: planets wander against the background stars — that is how they were first told apart from stars (\"planet\" means wanderer)." : ""}</p>
    <div class="actions">${it.kind !== "moon" ? `<button class="btn sm" id="l3d">Fly to it in 3D</button>` : ""}<button class="btn sm ghost" id="lzoom">Zoom here</button></div>
    <div class="nasaimg" id="limg"></div>`;
  openPanel();
  document.getElementById("l3d")?.addEventListener("click", () => showUniverse("3d", it.name));
  $("#lzoom").onclick = () => flyTo(it.ra, it.dec, it.kind === "rock" || it.kind === "craft" ? 1 : 8);
  import("./live").then((m) => m.nasaImages(it.kind === "planet" || it.kind === "moon" ? `${it.name} ${it.kind === "moon" ? "lunar" : "planet"}` : it.name, 3)).then((L) => {
    const el = document.getElementById("limg"); if (el && L.length) el.innerHTML = `<div class="eyebrow">From NASA's image library</div><div class="thumbs">${L.map((x) => `<a href="${x.href}" target="_blank" rel="noopener"><img src="${x.thumb}" alt="" loading="lazy"></a>`).join("")}</div>`; });
}

// ============================================================================ wavelength
const OVERVIEW_CH = () => nearestChan(OVERVIEW_UM);
// Aladin Lite 3.8 picks a cube tile from a frequency, assuming frames evenly spaced in frequency; IRSA's SPHEREx cube
// is 102 frames in ascending wavelength. Its own setSliceNumber therefore loads another frame than the one asked for,
// so ask for the frequency whose bin is exactly frame k (checked against the tile requests for all frames).
function setCubeFrame(l: any, k: number) {
  if (!l) return;
  const lo = +l.emMin, hi = +l.emMax, n = +l.cubeDepth;
  if (typeof l.setFrequency === "function" && lo > 0 && hi > lo && n > 1) {
    const C = 299792458, f0 = C / hi, f1 = C / lo;
    l.slice = k; l.setFrequency({ value: f0 + ((k + 0.5) / n) * (f1 - f0), unit: "Hz" });
  } else l.setSliceNumber?.(k);
}
function nearestChan(um: number) { let b = 0; S.lam.forEach((l, i) => { if (!BLANK.has(i) && Math.abs(l - um) < Math.abs(S.lam[b] - um)) b = i; }); return b; }
function setChan(c: number) {
  setTimeout(() => nudge([400, 1500, 3000]), 0);
  if (BLANK.has(c)) c = c === 50 ? 49 : 52;
  if (c === 0 && SURVEYS[set.survey].cube) c = 1;   // Aladin Lite 3.8 asks for "Npix_0.png"; the HiPS standard names frame 0 without a suffix
  S.chan = c;
  const um = S.lam[c] ?? 0;
  $("#chanlbl").textContent = um ? `${um.toFixed(3)} µm · channel ${c + 1}/102` : "";
  $("#knob").style.left = `${((um - 0.75) / (5.0 - 0.75)) * 100}%`;
  if (SURVEYS[set.survey].cube && !SURVEYS[set.survey].rgb) try { setCubeFrame(S.al?.getBaseImageLayer?.(), c); } catch { /* not ready */ }
}
function wireRainbow() {
  const bar = $("#bar");
  let pending = 0, lastX = 0;
  const pick = (ev: PointerEvent) => {
    lastX = ev.clientX; if (pending) return;
    pending = requestAnimationFrame(() => {   // at most one slice change per frame while dragging
      pending = 0; const r = bar.getBoundingClientRect(); const f = Math.min(1, Math.max(0, (lastX - r.left) / r.width));
      setChan(nearestChan(0.75 + f * 4.25));
    });
  };
  bar.addEventListener("pointerdown", (e) => { pick(e); bar.setPointerCapture(e.pointerId); bar.onpointermove = pick; });
  bar.addEventListener("pointerup", () => { bar.onpointermove = null; });
}

// ============================================================================ time machine (markers move along measured motions; imagery crossfades)
function fmtYear(y: number) { return y.toFixed(Math.abs(y - Math.round(y)) < 0.005 ? 0 : 1); }
function setYear(y: number, fromSlider = false) {
  S.year = Math.min(T_MAX, Math.max(T_MIN, y));
  // imagery: WISE (2010) fully below its epoch, SPHEREx (2025) at and after; linear crossfade between
  const f = Math.min(1, Math.max(0, (REF_YEAR - S.year) / (REF_YEAR - WISE_EPOCH)));
  try { S.overlay?.setOpacity(f); } catch { /* */ }
  if (f > 0 && !S.matched && SURVEYS[set.survey].cube && !SURVEYS[set.survey].rgb) { S.matched = true; setChan(nearestChan(4.6)); toast("SPHEREx set to 4.6 µm to match WISE's band"); }
  S.sky?.setYear(S.year); scheduleLive();
  $("#tyear").textContent = fmtYear(S.year);
  const past = S.year < WISE_EPOCH - 0.3, future = S.year > REF_YEAR + 0.3;
  $("#tlbl").textContent = past ? "Hindcast · from measured motions" : future ? "Forecast · from measured motions" : f >= 1 ? "WISE 2010 imagery" : f <= 0 ? "SPHEREx 2025 imagery" : `crossfade · ${Math.round(f * 100)}% WISE`;
  document.body.classList.toggle("forecast", past || future);
  if (!fromSlider) ($("#tslider") as HTMLInputElement).value = String(S.year);
}
let lastT = 0;
function play(on: boolean) {
  S.playing = on; $("#tplay").textContent = on ? "❚❚" : "▶"; $("#tplay").classList.toggle("on", on);
  if (on) {
    if (S.year >= T_MAX - 0.05) setYear(WISE_EPOCH);                      // at the end: replay from WISE
    S.loop = S.year >= WISE_EPOCH - 0.01 && S.year <= REF_YEAR + 0.01 && S.speed <= 5;
    if (S.loop && S.year >= REF_YEAR - 0.01) setYear(WISE_EPOCH);
    lastT = performance.now(); requestAnimationFrame(tick);
  }
}
function tick(now: number) {
  if (!S.playing) return;
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  let y = S.year + S.speed * dt;                                          // continuous: speed is years per second of wall time
  if (S.loop && y > REF_YEAR) { y = REF_YEAR; setYear(y); S.playing = false; setTimeout(() => { if ($("#tplay").classList.contains("on")) { S.playing = true; setYear(WISE_EPOCH); lastT = performance.now(); requestAnimationFrame(tick); } }, 900); return; }
  if (y >= T_MAX) { setYear(T_MAX); play(false); return; }
  setYear(y); requestAnimationFrame(tick);
}
function setBlink(on: boolean) {
  const was = $("#blink").classList.contains("on");
  clearInterval(S.blinkTimer); $("#blink").classList.toggle("on", on);
  if (on) {
    play(false); let wise = true; setYear(WISE_EPOCH);
    S.blinkTimer = setInterval(() => {
      wise = !wise;
      if (set.blinkFade) tweenYear(wise ? WISE_EPOCH : REF_YEAR, Math.min(600, set.blinkMs * 0.6)); else setYear(wise ? WISE_EPOCH : REF_YEAR);
    }, set.blinkMs);
  } else if (was) setYear(REF_YEAR);
}
function tweenYear(to: number, ms: number) {
  const from = S.year, t0 = performance.now();
  const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  const step = (now: number) => { const f = Math.min(1, (now - t0) / ms); setYear(from + (to - from) * ease(f)); if (f < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function wireTime() {
  const sl = $("#tslider") as HTMLInputElement;
  sl.oninput = () => { setBlink(false); play(false); setYear(+sl.value, true); };
  $("#tplay").onclick = () => { setBlink(false); play(!S.playing); };
  ($("#tspeed") as HTMLSelectElement).onchange = (e) => { S.speed = +(e.target as HTMLSelectElement).value; };
  $("#blink").onclick = () => setBlink(!$("#blink").classList.contains("on"));
  addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
    if (e.code === "Space") { e.preventDefault(); setBlink(false); play(!S.playing); }
    if (e.key === "b") setBlink(!$("#blink").classList.contains("on"));
    if (e.key === "ArrowRight") { play(false); setYear(S.year + 1); } if (e.key === "ArrowLeft") { play(false); setYear(S.year - 1); }
  });
  setYear(REF_YEAR);
}

// ============================================================================ view drawer (appearance + interaction)
function renderDrawer() {
  const opt = (v: string, l: string, cur: string) => `<option value="${v}" ${v === cur ? "selected" : ""}>${l}</option>`;
  const rng = (id: keyof Settings, label: string, min: number, max: number, step: number, fmt2 = (v: number) => v.toFixed(2)) =>
    `<label class="row"><span>${label}</span><input type="range" data-k="${id}" min="${min}" max="${max}" step="${step}" value="${set[id]}"><b data-v="${id}">${fmt2(set[id] as number)}</b></label>`;
  const chk = (id: keyof Settings, label: string) => `<label class="row chk"><input type="checkbox" data-k="${id}" ${set[id] ? "checked" : ""}><span>${label}</span></label>`;
  $("#drawer").innerHTML = `<button class="icon-btn close" id="dclose">✕</button>
    <div class="eyebrow">View</div><h3 class="display">Map appearance</h3>
    <label class="row"><span>Imagery</span><select data-k="survey">${LADDER.map((k) => opt(k, SURVEYS[k].label, set.survey)).join("")}</select></label>
    <label class="row"><span>Colour map</span><select data-k="colormap">${COLORMAPS.map((c) => opt(c, c, set.colormap)).join("")}</select></label>
    <label class="row"><span>Stretch</span><select data-k="stretch">${["linear", "sqrt", "asinh", "log", "pow2"].map((c) => opt(c, c, set.stretch)).join("")}</select></label>
    ${rng("brightness", "Brightness", -0.5, 0.5, 0.01)}${rng("contrast", "Contrast", 0.3, 3, 0.01)}${rng("gamma", "Gamma", 0.3, 3, 0.01)}
    <label class="row"><span>Projection</span><select data-k="projection">${PROJECTIONS.map(([k, l]) => opt(k, l, set.projection)).join("")}</select></label>
    ${chk("grid", "Coordinate grid")}${chk("galactic", "Galactic coordinates (Milky Way horizontal)")}
    <div class="eyebrow sec">Markers</div>
    ${rng("markerSize", "Size", 6, 26, 1, (v) => v.toFixed(0))}${rng("density", "Density", 0.4, 3, 0.1, (v) => v.toFixed(1) + "×")}
    ${rng("maxMarkers", "Max on screen", 100, 4000, 50, (v) => v.toFixed(0))}
    ${chk("trails", "Motion trails since 2010")}${chk("labels", "Labels for famous objects")}
    <div class="eyebrow sec">Interaction</div>
    ${rng("zoomSpeed", "Zoom speed", 0.2, 3, 0.05, (v) => v.toFixed(2) + "×")}${chk("zoomToCursor", "Zoom toward the cursor")}
    ${rng("blinkMs", "Blink interval", 250, 2500, 50, (v) => (v / 1000).toFixed(2) + " s")}${chk("blinkFade", "Smooth blink (crossfade)")}
    ${chk("saver", "Battery saver (fewer effects, for phones)")}
    <div class="actions"><button class="btn sm ghost" id="dreset">Reset to defaults</button></div>
    <p class="note">Keys: <b>Space</b> play/pause time · <b>B</b> blink · <b>← →</b> step one year.</p>`;
  $("#drawer").classList.add("open");
  $("#dclose").onclick = () => $("#drawer").classList.remove("open");
  $("#dreset").onclick = () => { Object.assign(set, DEFAULTS); saveSettings(set); applyAll(); renderDrawer(); };
  $("#drawer").querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-k]").forEach((el) => {
    el.addEventListener("input", () => {
      const k = el.dataset.k as keyof Settings;
      const v = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el instanceof HTMLInputElement && el.type === "range" ? +el.value : el.value;
      (set as any)[k] = v; saveSettings(set);
      const b = $("#drawer").querySelector(`[data-v="${k}"]`);
      if (b && el instanceof HTMLInputElement) renderValue(k, b as HTMLElement);
      applyOne(k);
    });
  });
}
function renderValue(k: keyof Settings, b: HTMLElement) {
  const v = set[k] as number;
  b.textContent = k === "markerSize" || k === "maxMarkers" ? v.toFixed(0) : k === "density" ? v.toFixed(1) + "×" : k === "zoomSpeed" ? v.toFixed(2) + "×" : k === "blinkMs" ? (v / 1000).toFixed(2) + " s" : v.toFixed(2);
}
function applyOne(k: keyof Settings) {
  switch (k) {
    case "survey": applySurvey(); break;
    case "colormap": case "stretch": case "brightness": case "contrast": case "gamma": styleLayers(); break;
    case "projection": try { S.al.setProjection(set.projection); } catch { /* */ } nudge([500, 1500]); break;
    case "grid": applyGrid(); break;
    case "galactic": try { S.al.setFrame(set.galactic ? "galactic" : "ICRS"); } catch { /* */ } S.sky?.redraw(); break;
    case "markerSize": case "trails": case "labels": case "density": case "maxMarkers":
      S.sky?.setOpts({ size: set.markerSize, trails: set.trails, labels: set.labels, density: set.density, maxMarkers: set.saver ? Math.min(500, set.maxMarkers) : set.maxMarkers }); break;
    case "zoomSpeed": S.zoom.speed = set.zoomSpeed; break;
    case "zoomToCursor": S.zoom.toCursor = set.zoomToCursor; break;
    case "blinkMs": case "blinkFade": if ($("#blink").classList.contains("on")) setBlink(true); break;
    case "saver": document.body.classList.toggle("saver", set.saver); applyOne("maxMarkers"); break;
  }
}
function applyAll() { (Object.keys(DEFAULTS) as (keyof Settings)[]).forEach(applyOne); }

// ============================================================================ object dossier
function fmtLy(pc: number) { const ly = pc * 3.26156; return ly < 100 ? `${ly.toFixed(1)} ly` : `${Math.round(ly).toLocaleString()} ly`; }
function why(o: Obj): string {
  const bits: string[] = [];
  if (o.reliable_motion && (o.pm ?? 0) > 0.3) {
    const conf = (o.sx_w2_snr ?? 0) > 5;
    bits.push(`It moves <b>${fmt(o.pm, 2)}″ per year</b> across the sky — ${fmt((o.pm ?? 0) * 15.5, 0)}″ over 16 years, measured in ${o.n_ep} WISE epochs (2010–2020).` +
      (conf ? ` <b>Independently confirmed:</b> SPHEREx detects it in 2025 exactly where that motion predicts (S/N ${fmt(o.sx_w2_snr, 0)}).` : ` Not yet confirmed by SPHEREx (too faint there).`));
  }
  if (!o.sx_saturated && o.methane_ratio !== null && o.methane_ratio > -0.05 && o.methane_ratio < 0.5 && (o.methane_sigma ?? 0) > 5) bits.push(`At 3.3 µm it is <b>${fmt((1 - (o.methane_ratio ?? 0)) * 100, 0)}% darker</b> than at 4 µm — the fingerprint of methane in a cold atmosphere. Normal stars are ~40% brighter there instead.`);
  if (o.flag_vanished) bits.push(`In the WISE era it shone at ${fmt(o.w2_late_uJy, 0)} µJy; SPHEREx now measures only <b>${fmt((o.decade_ratio_w2 ?? 0) * 100, 0)}%</b> of that (${fmt(o.decade_z_w2, 0)}σ).`);
  if (o.flag_brightened) bits.push(`It is <b>${fmt(o.decade_ratio_w2, 1)}× brighter</b> in SPHEREx than in the WISE era (${fmt(o.decade_z_w2, 0)}σ).`);
  if (!bits.length) bits.push(`A source measured in both missions. Use the lenses to find unusual ones.`);
  if (o.sx_saturated) bits.push(`<i>Very bright: SPHEREx is saturated, so its spectrum here is unreliable.</i>`);
  if (!o.isolated) bits.push(`<i>Has a bright neighbour within 30″ — photometry may be blended.</i>`);
  return bits.join(" ");
}
function openPanel() { $("#panel").classList.add("open"); document.body.classList.add("panel-open"); $("#panel").scrollTop = 0; }
function closePanel() { $("#panel").classList.remove("open"); document.body.classList.remove("panel-open"); stop3d?.(); stop3d = undefined; S.sky?.select(null); }
function openObject(o: Obj, lens?: string, title?: string) {
  const name = title ?? (lens ? `${LENSES[lens as LensKey]?.t ?? ""} candidate` : "Census object");
  S.sky?.select(key(o));
  const tags = [o.reliable_motion && "16-yr motion", o.isolated ? "isolated" : `blend ×${o.blend_n}`, o.flag_vanished && "vanished",
    o.flag_brightened && "brightened", o.sx_saturated && "saturated"].filter(Boolean);
  const hood = title && NEARBY[title];
  $("#pbody").innerHTML = `
    <div class="eyebrow">${esc(name)}</div>
    <h2 class="display">${sexa(o.ra_sx, o.dec_sx).replace(/s /, "s<br>")}</h2>
    <div class="coord">RA ${fmt(o.ra_sx, 5)}° · Dec ${fmt(o.dec_sx, 5)}° (2025.8)</div>
    <div class="facts">
      <div class="fact"><b>${fmt(o.pm, 2)}″</b><span>motion per year</span></div>
      <div class="fact"><b>${o.n_ep}/16</b><span>WISE epochs seen</span></div>
      <div class="fact"><b>${fmt(o.sx_w2_snr, 0)}</b><span>SPHEREx signal-to-noise, 4–5 microns</span></div>
      <div class="fact"><b>${o.sx_saturated ? "sat." : fmt(o.decade_ratio_w2, 2) + "×"}</b><span>${o.sx_saturated ? "too bright to compare" : "brightness vs 2010s"}</span></div>
    </div>
    ${o.ai_dist && o.ai_cls !== null && o.ai_cls !== undefined ? `<div class="airead"><div class="eyebrow">AI reading · trained on Gaia &amp; UltracoolSheet</div>
      <div class="facts">
        <div class="fact"><b>${o.ai_cls === 3 ? "beyond the Galaxy" : fmtLy(o.ai_dist)}</b><span>${o.ai_cls === 3 ? "galaxy / quasar" : `distance ±${Math.round((o.ai_sig ?? 0) * 100)}%`}</span></div>
        <div class="fact"><b>${o.ai_teff ? Math.round(o.ai_teff / 10) * 10 + " K" : "–"}</b><span>temperature</span></div>
        <div class="fact"><b>${["dwarf star", "giant", "brown dwarf", "galaxy/QSO"][o.ai_cls] ?? "–"}</b><span>kind · ${Math.round((o.ai_p ?? 0) * 100)}% confident</span></div>
      </div></div>` : ""}
    <div class="tags">${tags.map((t) => `<span>${t}</span>`).join("")}</div>
    <p class="why">${why(o)}</p>
    ${lens === "candidates" ? (() => { const c = o as any, m = S.candMeta;
      return `<div class="candbox"><div class="eyebrow">Why it is a candidate</div><ul>
        <li>Our AI reads its SPHEREx spectrum as a <b>brown dwarf</b> (${Math.round((c.ai_p ?? 0) * 100)}% confident), about <b>${fmtLy(c.ai_dist)}</b> away (±${Math.round((c.ai_sig ?? 0) * 100)}%).</li>
        ${c.moving ? `<li>It <b>moves</b> ${fmt(c.pm ?? Math.hypot(c.pmra ?? 0, c.pmdec ?? 0), 2)}″ per year across 16 years of WISE images — the sign of a nearby object.</li>` : ""}
        ${c.has_methane ? `<li>Its light shows a <b>methane dip</b> at 3.3 µm — methane survives only in atmospheres cooler than about 1,300 K.</li>` : ""}
        <li>WISE colour W1−W2 = ${fmt(c.c12, 2)} mag (stars are near 0; T and Y dwarfs are 1–4).</li>
        <li><b>Not in the UltracoolSheet</b>, the compendium of ~3,900 known ultracool dwarfs.</li>
        <li>${c.gaia_dist ? `Gaia DR3 also sees it: parallax distance <b>${fmtLy(c.gaia_dist)}</b> — ${Math.abs(Math.log(c.ai_dist / c.gaia_dist)) < 0.5 ? "consistent with our AI" : "different from our AI estimate"}.` : "Gaia DR3 has no parallax for it — too faint and red in visible light, as expected for a cold brown dwarf."}</li></ul>
        <p class="note">Not a confirmed discovery: it still needs a spectrum or a parallax to be confirmed. ${m ? `The same selection recovered ${m.recovered_known.toLocaleString()} already-known brown dwarfs, which is how we know it works.` : ""} Check it below in every SPHEREx pass, or in WiseView.</p></div>`; })() : ""}
    <div class="actions">
      <button class="btn sm ghost" id="pblink" title="Flip the map between WISE 2010 and SPHEREx 2025 here">2010 ↔ 2025</button>
      ${o.reliable_motion && (o.pm ?? 0) > 0.3 ? `<button class="btn sm ghost" id="pplay">Watch it move</button>` : ""}
      <button class="btn sm ghost" id="phood">Fly to it in 3D</button>
      <button class="btn sm ghost" id="pshare">Copy link</button>
      <a class="btn sm ghost" target="_blank" rel="noopener" href="http://byw.tools/wiseview#ra=${o.ra}&dec=${o.dec}&size=176&band=3&speed=200&minbright=-50&maxbright=500&window=0.5&diff_window=1&linear=1&zoom=9">WiseView</a>
      <a class="btn sm ghost" target="_blank" rel="noopener" href="https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${o.ra_sx}+${o.dec_sx}&Radius=15&Radius.unit=arcsec">SIMBAD</a>
    </div>
    <button class="cta" id="pblinkit"><span><b>Blink it</b><small>Every SPHEREx exposure of this object as a movie, with its spectrum and motion measured live</small></span><i>→</i></button>
    <div class="eyebrow" style="margin-top:26px">What its light is made of · SPHEREx, 102 colours</div>
    <div id="spec"></div>
    <div class="eyebrow" style="margin-top:26px">Artist's impression · drawn from its measured temperature</div>
    <div class="o3d" id="o3d"></div>
    <div class="eyebrow" style="margin-top:26px">Is it changing? · 16 years, WISE → SPHEREx</div>
    <div id="lc"></div>
    <div class="eyebrow" style="margin-top:26px">Its cousins across the sky · AI fingerprint</div>
    <div id="twins"></div>`;
  openPanel();
  stop3d?.(); stop3d = undefined;
  const myKey = key(o);   // three.js is fetched on the first dossier only (keeps the initial load light on phones)
  const el = $("#spec");
  if (!(o.spec && S.lam.length)) el.innerHTML = `<div class="soon">No spectrum stored (too faint for SPHEREx).</div>`;
  import("./object3d").then((m) => {
    if (S.sky?.selected !== myKey) return;
    if (document.getElementById("o3d")) { stop3d?.(); stop3d = m.mountObject3D($("#o3d"), o, title); }
    if (o.spec && S.lam.length && !o.sx_saturated) { const ph = m.estimatePhys(o, title); const simple = () => spectrumStory(el, S.lam, o.spec!, o, ph.T, ph.kind, () => drawSpectrum(el, S.lam, o.spec!, "", simple)); simple(); }
    else if (o.spec && S.lam.length) drawSpectrum(el, S.lam, o.spec);
  });
  const fid = (title && FLIP_IDS[title]) || key(o);
  $("#pblinkit").onclick = () => observe({ ra: o.ra_sx, dec: o.dec_sx, pmra: o.reliable_motion ? o.pmra ?? 0 : 0, pmdec: o.reliable_motion ? o.pmdec ?? 0 : 0, epoch: REF_YEAR,
    name: title && !/candidate|object|source|world/i.test(title) ? title : undefined, source: "MIRA census, WISE 2010–2020", otype: lens ? LENSES[lens as LensKey]?.t.toLowerCase() + " · census object" : "census object" });
  const lcSimple = (): Promise<boolean> => lightStory($("#lc"), fid, o.sx_saturated, () => mountLightCurve($("#lc"), fid, o.sx_saturated, () => { lcSimple(); }));
  lcSimple().then((ok) => { if (!ok) mountLightCurve($("#lc"), fid, o.sx_saturated); });
  mountTwins($("#twins"), fid, S.lam, (ra, dec) => { flyTo(ra, dec, 0.4); toast("Flying to a spectral twin"); }, { ra: o.ra_sx, dec: o.dec_sx });
  $("#pblink").onclick = () => { flyTo(o.ra_sx, o.dec_sx, 0.4); setBlink(true); };
  const pp = document.getElementById("pplay"); if (pp) pp.onclick = () => {
    // frame the whole 1990–2100 path, then run time forward
    const span = Math.max(0.05, Math.min(30, (o.pm ?? 1) * 16 / 3600 * 3));
    flyTo(o.ra_sx, o.dec_sx, span); setBlink(false); setYear(WISE_EPOCH); ($("#tspeed") as HTMLSelectElement).value = "2"; S.speed = 2; setTimeout(() => { S.loop = false; S.playing = true; $("#tplay").textContent = "❚❚"; $("#tplay").classList.add("on"); lastT = performance.now(); requestAnimationFrame(tick); }, 2600);
  };
  const ph = document.getElementById("phood"); if (ph) ph.onclick = () => showUniverse("3d", hood || key(o));
  $("#pshare").onclick = () => { const u = `${location.origin}${location.pathname}#ra=${o.ra_sx.toFixed(5)}&dec=${o.dec_sx.toFixed(5)}&fov=0.1&k=${key(o)}`; navigator.clipboard?.writeText(u); toast("Link copied"); };
}
function openUnusual(u: any) {
  if (!u) return;
  stop3d?.(); stop3d = undefined;
  $("#pbody").innerHTML = `
    <div class="eyebrow">Unusual spectrum · AI anomaly</div>
    <h2 class="display">${sexa(u.ra_sx, u.dec_sx).replace(/s /, "s<br>")}</h2>
    <div class="coord">RA ${fmt(u.ra_sx, 5)}° · Dec ${fmt(u.dec_sx, 5)}°</div>
    <div class="facts"><div class="fact"><b>${fmt(u.anomaly, 1)}</b><span>misfit (dex RMS)</span></div><div class="fact"><b>${fmt(u.snr, 0)}</b><span>SPHEREx S/N</span></div></div>
    <p class="why">Our autoencoder learned what normal SPHEREx spectra look like from millions of examples. It <b>cannot reproduce this one</b>:
      the shape below (log flux, normalised) deviates from every pattern it knows. It could be a rare kind of object — an emission-line source, an ice-wrapped young star, a quasar at high redshift — or an instrumental artifact. Worth a human look.</p>
    <div style="margin:14px 0">${sparkline(u.shape, S.lam, undefined, 400, 140)}</div>
    <div class="actions"><button class="btn sm" id="ublinkit">Blink it</button><button class="btn sm ghost" id="ublink">2010 ↔ 2025</button>
      <a class="btn sm ghost" target="_blank" rel="noopener" href="https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${u.ra_sx}+${u.dec_sx}&Radius=15&Radius.unit=arcsec">SIMBAD</a></div>`;
  openPanel();
  $("#ublink").onclick = () => { flyTo(u.ra_sx, u.dec_sx, 0.4); setBlink(true); };
  $("#ublinkit").onclick = () => observe({ ra: u.ra_sx, dec: u.dec_sx, otype: "unusual spectrum · census object" });
}
/** "Inspect this spot" on the map: a small card that hands the position to BLINK (the SPHEREx movie + measurements) */
function openPosition(ra: number, dec: number, known?: BlinkTarget) {
  stop3d?.(); stop3d = undefined; S.sky?.select(null);
  const g = (() => { const R = [[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132], [0.4941094278755837, -0.4448296299600112, 0.7469822444972189], [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]];
    const a = ra * Math.PI / 180, d = dec * Math.PI / 180, u = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)], v = R.map((r) => r[0] * u[0] + r[1] * u[1] + r[2] * u[2]);
    return [(Math.atan2(v[1], v[0]) * 180 / Math.PI + 360) % 360, Math.asin(v[2]) * 180 / Math.PI]; })();
  $("#pbody").innerHTML = `<div class="eyebrow">This spot on the sky</div><h2 class="display">${sexa(ra, dec).replace(/s /, "s<br>")}</h2>
    <div class="coord">RA ${ra.toFixed(5)}° · Dec ${dec.toFixed(5)}° · Galactic ${g[0].toFixed(2)}°, ${g[1].toFixed(2)}°</div>
    <button class="cta" id="posblink"><span><b>Blink this spot</b><small>A movie of every SPHEREx pass over it, read live from NASA's archive, with spectra on the fly</small></span><i>→</i></button>
    <div class="actions">
      <a class="btn sm ghost" target="_blank" rel="noopener" href="https://irsa.ipac.caltech.edu/applications/spherex/?__action=layout.showDropDown&view=MultiTableSearchCmd&position=${ra}+${dec}">IRSA SPHEREx</a>
      <a class="btn sm ghost" target="_blank" rel="noopener" href="http://byw.tools/wiseview#ra=${ra}&dec=${dec}&size=176&band=3&speed=200&minbright=-50&maxbright=500&window=0.5&diff_window=1&linear=1&zoom=9">WiseView</a>
      <a class="btn sm ghost" target="_blank" rel="noopener" href="https://simbad.cfa.harvard.edu/simbad/sim-coo?Coord=${ra}+${dec}&Radius=30&Radius.unit=arcsec">SIMBAD</a></div>
    <p class="note" style="margin-top:18px">Tip: right-click (or long-press) anywhere on the map to inspect that spot.</p>`;
  openPanel();
  $("#posblink").onclick = () => observe(known ?? { ra, dec });
}
function flyTo(ra: number, dec: number, fov: number) {
  if (!S.al) return;
  try { S.al.animateToRaDec(ra, dec, 2.2, () => S.al.zoomToFoV(fov, 1.6, () => nudge())); } catch { S.al.gotoRaDec(ra, dec); S.al.setFoV(fov); }
  nudge([2500, 4200, 6000]);
}

// ============================================================================ the observatory's sections
// One page, four sections that share the header and a current target:
//   Universe  the 3D map (home) and the flat sky map      Observe  the telescope + instruments (blink/)
//   Lab       the instruments, hands-on (lab.ts)           Logbook  the visitor's own observations (logbook.ts)
type View = "universe" | "blink" | "cat" | "log";
type UniMode = "3d" | "map";
const query = new URLSearchParams(location.search), EMBED = query.has("embed");
let catalogue: ReturnType<typeof import("./catalogue").mountCatalogue> | null = null;
let view: View = "blink", uniMode: UniMode = "3d", atlasP: Promise<void> | null = null, spaceP: Promise<SpaceHandle | null> | null = null, space: SpaceHandle | null = null;
setBase(import.meta.env.BASE_URL);
document.body.classList.toggle("embed", EMBED);
const blink = mountBlink($("#blinkpage"), { embed: EMBED, toast,
  onState: (p) => { if (EMBED) p.set("embed", "1"); history.replaceState(null, "", `${location.pathname}?${p.toString()}`); },
  onSave: EMBED ? undefined : (snap) => { import("./logbook").then((m) => { m.saveSnapshot(snap); toast("Saved to your cases"); }); } });
const markNav = (v: string = view) => document.querySelectorAll<HTMLElement>(".mainnav button").forEach((b) => b.classList.toggle("on", b.dataset.view === v));

/** point the telescope at a name, at coordinates, or at a ready-made target (`fallback` is used if a name cannot be resolved) */
function observe(t: BlinkTarget | string, fallback?: BlinkTarget) { setView("blink"); if (typeof t === "string") blink.go(t, undefined, fallback); else blink.open(t); }

async function setView(v: View, arg?: string) {
  closeAbout();
  if (v !== "universe" || uniMode !== "map") { setBlink(false); play(false); endTour(); closePanel(); $("#drawer").classList.remove("open"); }
  if (v !== "universe") space?.pause(true);
  if (v !== "blink") blink.pause();
  view = v;
  for (const k of ["universe", "blink", "cat", "log"]) document.body.classList.toggle(`v-${k}`, k === v);
  document.body.classList.toggle("m-3d", v === "universe" && uniMode === "3d"); document.body.classList.toggle("m-map", v === "universe" && uniMode === "map");
  document.body.classList.toggle("space-on", v === "universe" && uniMode === "3d");
  $("#blinkpage").classList.toggle("open", v === "blink"); $("#catpage").classList.toggle("open", v === "cat"); $("#logpage").classList.toggle("open", v === "log");
  document.querySelectorAll<HTMLElement>("#unimode button").forEach((b) => b.classList.toggle("on", b.dataset.m === uniMode));
  markNav();
  if (v === "universe") {
    if (uniMode === "3d") { const sp = await ensureSpace(); if (sp && view === "universe" && uniMode === "3d") { sp.pause(false); if (arg && !sp.focus(arg)) toast("Not on the map: its distance is not known yet. Open it in the Lab instead."); } }
    else { space?.pause(true); await ensureAtlas(); nudge([100, 700, 1800]); }
  } else if (v === "blink") blink.resume();
  else if (v === "cat") { await ensureCatalogue(); }
  else { const m = await import("./logbook"); if (view === "log") m.mountLogbook($("#logpage"), { onObserve: observe, toast }); }
}
/** the Universe section: `mode` "3d" (fly through space) or "map" (the whole sky from Earth); `focus` = an object to fly to in 3D */
async function showUniverse(_mode: UniMode = uniMode, focus?: string) { uniMode = "3d"; await setView("universe", focus); }      // the old all-sky atlas, with its unverified lists, is retired: the map is always the 3D one
async function loadBasics() {
  if (S.summary) return;
  S.summary = await load<Summary>("summary", true); S.lam = S.summary?.lam_um ?? []; S.targets = (await load<Target[]>("targets", true)) ?? [];
}
function ensureAtlas() { return (atlasP ??= bootAtlas()); }
/** the verified catalogue is mounted once and keeps its filters and selection */
async function ensureCatalogue() { if (!catalogue) { const m = await import("./catalogue"); catalogue ??= m.mountCatalogue($("#catpage"), { onObserve: (t) => observe(t as BlinkTarget), onMap: (id) => showUniverse("3d", id), toast }); } return catalogue; }
/** the 3D universe starts once and is then only paused and resumed, so the camera and the selection survive a visit to another section */
function ensureSpace(): Promise<SpaceHandle | null> {
  return (spaceP ??= (async () => {
    const host = $("#space");
    try {
      const { openSpace } = await import("./space");
      space = await openSpace(host, { lowPower: set.saver || LOW_POWER,
        onObserve: (t) => { if (t.pmra !== undefined) { observe({ ra: t.ra, dec: t.dec, pmra: t.pmra, pmdec: t.pmdec, epoch: t.epoch, name: t.name ?? "Confirmed mover", source: "The survey of the WISE years (2010–2020)" } as BlinkTarget); return; } const pos = `${t.ra.toFixed(5)} ${t.dec >= 0 ? "+" : ""}${t.dec.toFixed(5)}`; if (t.name) observe(t.name, { ra: t.ra, dec: t.dec, name: t.name, epoch: REF_YEAR }); else observe(pos); },
      });
    } catch (e) { console.warn("3D universe unavailable", e); space = null; }
    if (!space) mountHero(host, true);
    return space;
  })());
}
/** the first thing a visitor reads: what this place is, and the one thing to do */
function mountHero(host: HTMLElement, noGl: boolean) {
  if (host.querySelector("#unihero")) return;
  host.classList.add("open");
  host.insertAdjacentHTML("beforeend", `<div class="uni-hero${noGl ? " nogl" : ""}" id="unihero">
    <button class="icon-btn" id="uniherox" aria-label="Hide this introduction">✕</button>
    <div class="eyebrow">MIRA · a digital research observatory</div>
    <h1 class="display">The universe, to scale.</h1>
    <p>Every point here is a real object at its measured distance: the planets today, 350,000 stars and brown dwarfs, 330,000 galaxies, out to the oldest light we can see. Choose one, or any spot in the sky, and put it under NASA's SPHEREx telescope.</p>
    <form class="bk-go" id="unigo"><input placeholder="A star's name, or coordinates (RA Dec)" autocomplete="off" spellcheck="false" enterkeyhint="go" aria-label="Point the telescope: a name or coordinates"><button class="btn" type="submit">Observe</button></form>
    <div class="bk-try"><span>or start with one of NASA's five test targets</span><div>${CHALLENGE.map((t) => `<button class="chip" data-key="${t.key}" title="${esc(t.blurb)}">${esc(t.name)}</button>`).join("")}</div></div>
    ${noGl ? `<p class="note">The 3D view needs WebGL, which this browser does not provide. Observe, the Sky map, the Lab and the Logbook all work without it.</p>` : ""}</div>`);
  const hero = host.querySelector("#unihero") as HTMLElement;
  (hero.querySelector("#unigo") as HTMLFormElement).onsubmit = (e) => { e.preventDefault(); const q = (hero.querySelector("input") as HTMLInputElement).value.trim(); if (q) observe(q); };
  hero.querySelectorAll<HTMLButtonElement>(".chip").forEach((b) => (b.onclick = () => observe(b.dataset.key!)));
  (hero.querySelector("#uniherox") as HTMLElement).onclick = () => hero.classList.add("gone");
}

// ============================================================================ tour
type Step = { title: string; text: string; ra?: number; dec?: number; fov?: number; lens?: LensKey[]; blink?: boolean; chan?: number; obj?: () => Promise<Obj | undefined | null> | Obj | undefined; objTitle?: string };
function targetObj(name: string) { return S.targets.find((t) => t.name === name)?.census; }
function steps(): Step[] {
  const van = S.sky?.top.get("vanished")?.rows?.[0];
  return [
    { title: "One sky, two missions", text: "This is SPHEREx's map of the whole sky in infrared light — the glowing band is our Milky Way. NASA's WISE mapped the same sky in 2010. Fifteen years apart, the two maps are a time machine: press ▶ below and watch the dots move.", ra: 266.4, dec: -28.9, fov: 150, chan: OVERVIEW_CH(), lens: [] },
    { title: "Barnard's Star", text: "Watch the bright star in the center: we are blinking WISE 2010 against SPHEREx 2025. It jumps by more than 2.5′ — it races 10.3″ a year across the sky. Our census measured that motion from the WISE data alone; the dot follows the measured track.", ra: 269.4468, dec: 4.753, fov: 0.5, blink: true, lens: ["movers"], obj: () => targetObj("Barnard's Star"), objTitle: "Barnard's Star" },
    { title: "The coldest known brown dwarf", text: "WISE 0855−0714 is barely warmer than the North Pole. Invisible to optical telescopes, it glows only near 4.5 µm. Our pipeline found it blind among 2 million detections, moving 8.2″ per year.", ra: 133.76, dec: -7.2422, fov: 0.4, blink: true, lens: ["movers", "methane"], obj: () => targetObj("WISE 0855-0714"), objTitle: "WISE 0855−0714" },
    { title: "A methane world next to a star", text: "Epsilon Indi B is a pair of brown dwarfs orbiting the bright star at upper right. At 3.3 µm its light is absorbed by methane, as in Jupiter's atmosphere. Drag the colour bar between 3.3 and 4 µm and watch it fade and return.", ra: 331.0965, dec: -56.8006, fov: 0.3, chan: 64, lens: ["methane"], obj: () => targetObj("Epsilon Indi B"), objTitle: "Epsilon Indi B" },
    { title: "A young star that flickers", text: "RW Aurigae is a newborn star still wrapped in dust. Across the WISE years its infrared light swung by a factor of three as clouds passed in front of it. Scroll the panel to its 16-year light curve.", ra: 76.9564, dec: 30.4011, fov: 0.5, chan: 94, lens: ["brightened", "vanished"], obj: () => targetObj("RW Aurigae"), objTitle: "RW Aurigae" },
    { title: "A giant star that breathes", text: "R Draconis is a Mira variable: a dying red giant that swells and shrinks every 246 days, changing its infrared brightness several-fold. It sits near the North Ecliptic Pole, where SPHEREx returns week after week — press “Blink it” in the panel to watch every pass and its light curve.", ra: 248.1689, dec: 66.7525, fov: 0.5, chan: 94, lens: ["brightened", "vanished"], obj: () => targetObj("R Draconis"), objTitle: "R Draconis" },
    ...(van ? [{ title: "Something vanished", text: "WISE saw a bright infrared source here; a decade later SPHEREx barely sees it. A star hidden by dust, a faded outburst, or something stranger? Candidates like this are what we want you to investigate.", ra: van[1], dec: van[2], fov: 0.1, blink: true, lens: ["vanished"] as LensKey[], obj: () => loadDetail(van[0]), objTitle: "Vanished source" }] : []),
    ...(S.cands.size ? [(() => { const c = [...S.cands.values()][0]; return { title: "Maybe a world nobody has seen", text: `Our AI and the 16-year motions selected ${S.cands.size} candidates: objects that look cold and nearby and are in no catalogue of known brown dwarfs. This is the top one, unconfirmed. The same search recovered ${S.candMeta?.recovered_known ?? "125"} known brown dwarfs, so it works — but each needs a follow-up observation to be confirmed.`, ra: c.ra_sx, dec: c.dec_sx, fov: 0.3, blink: true, lens: ["candidates"] as LensKey[], obj: () => ({ ...c }), objTitle: "Possible new cold world" }; })()] : []),
    { title: "Your turn", text: "Right-click anywhere on the sky, or open Blink and type any coordinates or a name: MIRA plays every SPHEREx pass over that spot as a movie, read straight from NASA's archive, and measures what it sees. Switch census layers on the left, or open 3D Space to fly among the objects.", ra: 266.4, dec: -28.9, fov: 150, lens: ["movers", "methane", "vanished", "brightened"] },
  ];
}
function renderStep(i: number) {
  const st = steps(); S.tourStep = i;
  const s = st[i]; const tour = $("#tour"); tour.style.display = "block"; document.body.classList.add("touring");
  tour.innerHTML = `<div class="eyebrow">Tour · ${i + 1} / ${st.length}</div><h3 class="display">${esc(s.title)}</h3><p>${s.text}</p>
    <div class="nav">${i > 0 ? `<button class="btn sm ghost" id="tprev">Back</button>` : ""}
    ${i < st.length - 1 ? `<button class="btn sm" id="tnext">Next</button>` : `<button class="btn sm" id="tdone">Explore</button>`}
    <button class="btn sm ghost" id="texit">Exit</button><span class="prog">${"●".repeat(i + 1)}${"○".repeat(st.length - i - 1)}</span></div>`;
  $("#tprev")?.addEventListener("click", () => renderStep(i - 1));
  $("#tnext")?.addEventListener("click", () => renderStep(i + 1));
  $("#tdone")?.addEventListener("click", endTour); $("#texit").addEventListener("click", endTour);
  setBlink(false); play(false); closePanel();
  if (s.lens) { S.lenses = new Set(s.lens); applyLenses(); }
  if (s.chan !== undefined) setChan(s.chan);
  if (s.ra !== undefined) {
    if ((s.fov ?? 1) > 60) { S.al.animateToRaDec?.(s.ra, s.dec, 1.5, () => S.al.zoomToFoV?.(s.fov, 1.5)); }
    else flyTo(s.ra, s.dec!, s.fov!);
  }
  setTimeout(async () => { if (S.tourStep !== i) return; if (s.blink) setBlink(true); const o = await s.obj?.(); if (o && S.tourStep === i) openObject(o, undefined, s.objTitle); }, s.ra !== undefined && (s.fov ?? 99) < 60 ? 3800 : 400);
}
function endTour() { $("#tour").style.display = "none"; S.tourStep = -1; document.body.classList.remove("touring"); }

// ============================================================================ about
function closeAbout() { if (!$("#about").classList.contains("open")) return; $("#about").classList.remove("open"); document.body.classList.remove("about-on"); $("#aboutbtn").classList.remove("on"); }
async function renderAbout() {
  await loadBasics();
  const check: [string, string][] = [
    ["A public tool, so that moving objects are easy to spot", "The first screen is a <b>map</b> anyone can use: confirmed movers are marked, and a click shows three real pictures of the object on a slider (2MASS about 1999, WISE 2010, and SPHEREx's own, read from NASA's archive when asked for) with its measured path. For the ones nobody has named, three buttons let a visitor say what they see."],
    ["Enter RA and Dec, get a series of images “like a little video”", "The <b>Lab</b> takes coordinates in any common notation, or a name. <b>Evolution</b> shows one deep image per SPHEREx visit on a time bar you steer (drag, step from date to date, choose the speed), preceded by the pictures NASA's WISE (2010) and 2MASS (~1999) took of the same field, so that 27 years pass in a few seconds and a moving object walks across the frame; <b>Exposures</b> shows every single 2-minute exposure, in time or wavelength order."],
    ["Make moving objects easy to spot", "The <b>Motion detector</b> measures every source of the field and lists the ones that moved, with their significance and whether Gaia knows them; their dated positions since 1999 are drawn on the image. <b>Follow target</b>, Gaia positions at each date and <b>Difference</b> are there for the eye."],
    ["Test on Barnard's Star, ε Indi B, WISE 0855, RW Aur, R Dra", "One click each on the Lab's start screen; results in the tables below. Typing the challenge's 2010 coordinates for WISE 0855 is recognised and followed to where it is now."],
    ["Easy to update with new data releases", "Pixels are never copied: the browser reads them from NASA's archive. Only a small index of exposure footprints is hosted, rebuilt from IRSA's inventory by one script in about a minute; the Lab shows the date of the newest exposure indexed, and saved cases are flagged when newer data exists."],
    ["Creative use of the 102 bands; co-add per detector", "Detector chips select any of the six arrays; each visit's exposures are co-added into a deep image; <b>Colour</b> folds the detectors into one RGB picture; the Spectrograph uses every exposure at the wavelength it saw."],
    ["“Extra kudos”: spectra on the fly", "The <b>Spectrograph</b>: PSF-weighted photometry of any source in the field at the wavelength of each exposure, with molecular bands marked and 2MASS / WISE fluxes for comparison. Methane is detected automatically. CSV download."],
    ["Add or subtract images taken at different times", "Evolution adds the exposures of each visit (with outlier rejection); <b>Difference</b> subtracts the first visit from each later one."],
    ["Let users choose the field of view", "3.3′, 6.6′, 9.8′ or 13.1′, and 36, 72 or all indexed exposures, with the download size stated before you choose."],
    ["Overlay Gaia or WISE", "Gaia DR3 (moved to the date shown) and AllWISE (where WISE saw each source in 2010) toggles, next to the detector's own numbered sources."],
    ["Coordinates in the URL; embeddable", "<span class='mono'>/explore/?ra=…&amp;dec=…&amp;fov=…</span> or <span class='mono'>?target=name</span>. The Export panel gives the link and an &lt;iframe&gt; snippet (<span class='mono'>&amp;embed=1</span> hides the site chrome)."],
    ["Show metadata such as contamination flags", "NASA's per-pixel flags are read from each exposure's compressed FLAGS extension and applied to every source of the field; they can be painted on the image, and the Exposures panel lists them with each exposure's date, wavelength and noise."],
    ["Use Astropy", "The exposure index, the survey and its verification are built with Astropy; the browser engine's astrometry and flag decoding are checked against Astropy on the same NASA files (0.004 px, bit-exact masks)."],
  ];
  $("#about").innerHTML = `<button class="icon-btn aclose" id="aclose" aria-label="Close">✕</button>
    <div class="about-in">
    <div class="eyebrow">Method</div><h2 class="display">What MIRA measures, and how far to trust it</h2>
    <p class="lead">MIRA has two layers. The <b>map</b> is for everyone: the Sun's neighbourhood in 3D, where each star caught moving has a card in plain words with three real NASA pictures of it (1999, 2010, SPHEREx today), and where anyone can help look at the ones nobody has named. The <b>Lab</b> is the deep analysis behind it: a research observatory in the browser whose instruments read NASA's SPHEREx exposures directly from the public archive and answer one chain of questions about any field of the sky: what moved, how fast and how far away it is, what it is, whether it changed, and what could still hide there. The motivating case is the search for unknown cold bodies near the Sun ("Planet X"); the instruments work on any star, brown dwarf or variable source.</p>

    <div class="eyebrow sec">How a field is measured</div>
    <ol class="steps">
      <li><b>Find the exposures.</b> A small index, built from IRSA's inventory of 1.6 million SPHEREx exposures, lists those whose footprint covers each patch of sky, spread over every visit and all six detectors.</li>
      <li><b>Read only what is needed.</b> Each exposure is a 65 MB file on NASA's public cloud storage. The browser fetches its header, the detector rows that cross the field and the matching rows of NASA's flag table — under 1 MB.</li>
      <li><b>Register.</b> Using each exposure's astrometric solution (tangent projection with distortion terms), every frame is resampled north-up onto the same sky grid; the wavelength each pixel saw comes from the filter map of its detector.</li>
      <li><b>One deep image per visit.</b> A visit's exposures are combined with outlier rejection. A position does not depend on wavelength, so all six detectors add up, reaching sources too faint for a single exposure.</li>
      <li><b>Detect and tie to Gaia.</b> Sources above 5σ are located at every visit. The Gaia stars of the same field, moved to each date with their own motion and parallax, fix the reference frame visit by visit and measure how good the positions are at each brightness.</li>
      <li><b>Compare with the past.</b> Each source is matched to AllWISE (2010) and 2MASS (~1999); a counterpart more than 3″ away must also match in brightness. A straight line through all dated positions gives the motion over 15–27 years; brightness is compared on the field's own zero point. The time bar shows the pictures those two NASA surveys took of the same field (WISE at 4.6 µm, 2MASS at 2.2 µm, read from NASA's infrared archive), so a mover can be seen as well as measured; the numbers always come from the catalogues, not from those pictures.</li>
      <li><b>Judge carefully.</b> “Moved” needs 5σ against the scatter with which Gaia stars are recovered in that same field, and at least three dated positions (two always lie on a line). Saturated, blended and edge sources are listed but not judged, with two stated exceptions: a saturated star whose motion, measured on the wings of its image, confirms Gaia's, and your own target when it is tracked with a published motion. A star whose position disagrees with its Gaia motion is flagged as contaminated, not moving.</li>
    </ol>

    <div class="eyebrow sec">How well it works</div>
    <div class="tablewrap"><table><thead><tr><th>Field</th><th>MIRA, SPHEREx + 2010 + 1999 (″/yr)</th><th>Reference (″/yr)</th></tr></thead><tbody>
      <tr><td>ε Indi B</td><td class="m">+3.986, −2.486 ± 0.019</td><td class="m">+3.982, −2.467 (Gaia DR3)</td></tr>
      <tr><td>Luhman 16 <small>no Gaia motion; linked to its 2010 and 1999 positions</small></td><td class="m">−2.759, +0.362 ± 0.019</td><td class="m">−2.75, +0.36 (literature)</td></tr>
      <tr><td>Barnard's Star <small>saturated: measured on the wings of its image; confirms Gaia</small></td><td class="m">−0.797, +10.432 ± 0.047</td><td class="m">−0.802, +10.362 (Gaia DR3)</td></tr>
      <tr><td>WISE 0855−0714 <small>tracked with its published motion; today it shares a pixel with a star</small></td><td class="m">−8.17, +0.75 ± 0.05</td><td class="m">−8.12, +0.67 (Kirkpatrick et al. 2021)</td></tr>
      <tr><td>Survey candidate 6661-325678 <small>not in Gaia</small></td><td class="m">−0.352, −0.016 ± 0.048 (7.3σ)</td><td class="m">−0.357, +0.022 (CatWISE2020)</td></tr>
      <tr><td>Empty high-latitude field, 40 sources</td><td class="m">nothing flagged</td><td class="m">—</td></tr></tbody></table></div>
    <div id="valdet"></div>
    <p class="note">Same code as the Lab, run with <span class="mono">npx tsx scripts/test_detect.mts</span>. In a typical field the motions of Gaia stars are recovered to 0.01–0.02″ per year; that figure is measured in every field and shown under the detector's table. Why a blind pass: the detector uses Gaia to predict where a known star was in 2010 and 1999 and to reject a motion that contradicts Gaia, so testing it on Gaia stars with Gaia switched on would flatter it. In the blind pass the stars under test are removed from the Gaia list before the detector runs, which is the situation of an object Gaia does not list. Sources the detector flags that have no Gaia motion were not checked one by one: some are real, some may be galaxies whose centre shifts with wavelength.</p>
    <div class="eyebrow sec">SPHEREx exposures alone · the five challenge targets</div>
    <div class="tablewrap" id="valtable"><p class="note">Loading the validation run…</p></div>
    <p class="note">Engine checks against Astropy on the same NASA file: pixel positions agree to 0.004 px, resampled pixel values to 0.005%, and decoded flag masks bit for bit. Reproduce with <span class="mono">npx tsx scripts/validate_blink.mts</span>.</p>

    <div class="eyebrow sec">The survey, and what verification did to it</div>
    <p>On a cluster we linked the unWISE time-domain catalogue — 39.9 billion WISE detections over 16 epochs, 2010–2020 — into objects with their motion, and compared them with SPHEREx's all-sky maps. That produced 1.56 million claims of motion or change. Claims at that level are cheap and mostly wrong, so each one worth checking was re-measured on the raw SPHEREx exposures with the Lab's own engine: where is the source really, against the place its motion predicts and against the place it would be had it never moved.</p>
    <div id="funnel" class="tablewrap"></div>
    <p>The Catalogue shows only what passed. The old “brightened” and “vanished” lists did not survive: for ordinary stars SPHEREx and WISE agree to 5%, and against AllWISE only a handful of the claimed changes are real. They are no longer presented as findings.</p>

    <div class="eyebrow sec">The challenge, point by point</div>
    <div class="tablewrap"><table class="checklist"><tbody>${check.map(([q, a]) => `<tr><td>${q}</td><td>${a}</td></tr>`).join("")}</tbody></table></div>

    <div class="eyebrow sec">Limits</div>
    <ul>
      <li>SPHEREx pixels are 6.15″: two sources closer than about 10″ blend. The detector flags blends from Gaia's positions, from neighbours in its own images and from a red-versus-blue centroid shift, and does not judge them. A faint mover sitting on a star (WISE 0855 today lies 8″ from a 16th-magnitude star) is measured when tracked with a known motion, not found blind.</li>
      <li>SPHEREx alone covers 1.5 years: by itself it sees motions above about 2.5″ per year. Slower motions rest on the 2010 and 1999 catalogue positions, so a source needs a counterpart there.</li>
      <li>Parallaxes from SPHEREx alone are indicative: 6″ pixels and a spacecraft roll that flips every six months, in step with the parallax swing. A distance is stated only above 5σ.</li>
      <li>Fluxes assume a Gaussian image of the width NASA reports for each exposure. They agree with WISE to about 5% for isolated stars; they are not a substitute for NASA's own spectrophotometry.</li>
      <li>Stars brighter than about 8th magnitude saturate: listed, not measured, except for their motion (image wings) and their visit-to-visit brightness (halo).</li>
      <li>Planet Nine as proposed is below SPHEREx's depth; the Detection limits panel states what is and is not excluded in each field. A planet a few hundred au away would also shift by many arcminutes between visits: finding it means linking single-visit sources across fields, which MIRA does not do yet.</li>
      <li>The catalogues come from public services (CDS VizieR mirrors, SIMBAD). If they do not answer, the detector says so and compares only SPHEREx visits.</li>
      <li>Catalogue rows are confirmed motions, not discoveries. “No Gaia motion” means exactly that; CatWISE2020 lists most of these sources, and only a spectrum and a parallax make an identification.</li>
    </ul>

    <div class="eyebrow sec">Staying current, and your data</div>
    <p>A new SPHEREx release needs one script (<span class="mono">deploy/update_spherex.sh</span>) that rebuilds the exposure index; every instrument then reads the new exposures, and the verification run re-tests open claims. The site adapts to what the files say: header lengths, flag definitions and pipeline versions are read from each exposure, the catalogue services have mirrors, and a failure is reported in place instead of breaking the page. Your cases stay in your browser and can be exported; nothing is uploaded.</p>
    <div class="eyebrow sec">The assistant</div>
    <p>The assistant is a language model (K2 Horizon, MBZUAI Institute of Foundation Models) that receives your question and the numbers on the page, and can operate the instruments. It does not measure anything itself: the panels are the reference. AI tools were also used in development and are listed in the repository (docs/07_si_usage_log.md).</p>
    <p class="note" style="margin-top:28px">Data: NASA SPHEREx Level-2 images and all-sky maps (NASA/IPAC IRSA, doi:10.26131/IRSA629, IRSA679) · unWISE time-domain catalogue (doi:10.26131/IRSA580) · NASA WISE/NEOWISE, AllWISE and CatWISE2020 · ESA Gaia DR3 · 2MASS · SIMBAD and VizieR (CDS).
    Built for the NASA Space Apps Challenge 2026. MIRA is not affiliated with or endorsed by NASA.</p>
    </div>`;
  fetch(`${import.meta.env.BASE_URL}data/verified/meta.json`).then((r) => (r.ok ? r.json() : null)).then((m) => {
    const el = document.getElementById("funnel"); if (!el || !m?.funnel) return; const f = m.funnel.motion_fast, b = m.funnel.motion_fast_bright, n = (x: number) => x.toLocaleString("en-US"), pc = (a: number, t: number) => `${((100 * a) / t).toFixed(a / t < 0.1 ? 1 : 0)}%`;
    el.innerHTML = `<table><thead><tr><th>Step</th><th>Objects</th><th></th></tr></thead><tbody>
      <tr><td>Survey-level claims of motion or change</td><td class="m">${n(m.claims.total)}</td><td>from 39.9 billion detections</td></tr>
      <tr><td>Re-measured on raw SPHEREx exposures</td><td class="m">${n(m.remeasured)}</td><td>every motion claim above 0.3″/yr and samples of the rest</td></tr>
      <tr><td>Motion above 0.3″/yr: confirmed</td><td class="m">${n(f.moved)} of ${n(f.tested)}</td><td>${pc(f.moved, f.tested)}; among those brighter than 1 mJy: ${pc(b.moved, b.tested)}</td></tr>
      <tr><td>… not detected at all</td><td class="m">${n(f.undetected)}</td><td>${pc(f.undetected, f.tested)}</td></tr>
      <tr><td>… only an unrelated source nearby</td><td class="m">${n(f.elsewhere)}</td><td>${pc(f.elsewhere, f.tested)}</td></tr>
      <tr><td>… saturated / unclear / found where it had been</td><td class="m">${n(f.saturated)} / ${n(f.unclear)} / ${n(f.static)}</td><td></td></tr>
      ${m.high_latitude ? `<tr><td>Confirmed movers away from the crowded Galactic plane (|b| ≥ 10°)</td><td class="m">${n(m.high_latitude.n)} of ${n(m.confirmed_movers)}</td><td>the Catalogue hides the plane by default</td></tr>
      <tr><td>… that are known Gaia stars with the same motion</td><td class="m">${n(m.high_latitude.known)}</td><td>${pc(m.high_latitude.known, m.high_latitude.n)}: an independent check of the method (in the plane: ${pc(m.high_latitude.plane_known, m.high_latitude.plane_n)}, crowding defeats the test)</td></tr>`
        : `<tr><td>Confirmed movers that are known Gaia stars with the same motion</td><td class="m">${n(m.movers_known)} of ${n(m.confirmed_movers)}</td><td>${pc(m.movers_known, m.confirmed_movers)}: an independent check of the method</td></tr>`}
      <tr><td>Methane dips confirmed</td><td class="m">${m.funnel.methane?.confirmed ?? "–"} of ${n(m.funnel.methane?.measurable ?? 0)} measurable</td><td></td></tr>
      <tr><td>Brightness changes that hold against AllWISE</td><td class="m">${m.funnel.brightness_checked ? m.funnel.brightness_checked.brighter + m.funnel.brightness_checked.fainter : "–"} of ${n(m.funnel.brightness_checked?.clean ?? 0)} clean cases</td><td></td></tr></tbody></table>`;
  }).catch(() => {});
  fetch(`${import.meta.env.BASE_URL}data/verified/detector_validation.json`).then((r) => (r.ok && !(r.headers.get("content-type") ?? "").includes("html") ? r.json() : null)).then((v) => {
    const el = document.getElementById("valdet"); if (!el || !v) return;
    el.innerHTML = `<div class="tablewrap"><table><thead><tr><th>Control run on ${v.fields} fields, same code as the Lab</th><th>Result</th></tr></thead><tbody>${(v.rows as [string, string][]).map(([a, b]) => `<tr><td>${a}</td><td class="m">${b}</td></tr>`).join("")}</tbody></table></div>`;
  }).catch(() => {});
  $("#about").classList.add("open"); document.body.classList.add("about-on"); $("#aboutbtn").classList.add("on"); $("#about").scrollTop = 0; $("#aclose").onclick = closeAbout;
  fetch(`${import.meta.env.BASE_URL}validation.json`).then((r) => (r.ok ? r.json() : null)).then((v) => {
    const el = document.getElementById("valtable"); if (!el || !v) return;
    const pm = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}`;
    const band = ["all bands", "0.75–1.1 µm", "1.1–1.7 µm", "1.6–2.4 µm", "2.4–3.9 µm", "3.8–4.4 µm", "4.4–5.0 µm"];
    el.innerHTML = `<table><thead><tr><th>Target</th><th>Exposures read</th><th>Measured by MIRA from SPHEREx alone</th><th>Reference</th></tr></thead><tbody>${v.targets.map((t: any) => {
      const m = t.motion, lc = t.lightcurve, got: string[] = [], ref: string[] = [];
      if (t.saturated) got.push(`Saturated in ${t.saturated_frames} of ${t.frames} exposures (NASA's OVERFLOW flag, shown on every frame)`);
      if (m) { got.push(`Motion ${pm(m.pmra)} ± ${m.epmra.toFixed(2)}, ${pm(m.pmdec)} ± ${m.epmdec.toFixed(2)} ″/yr from ${m.n} exposures${m.from_flagged ? " (from the wings of the saturated image: indicative)" : ""}`);
        ref.push(`${pm(t.lit.pmra)}, ${pm(t.lit.pmdec)} ″/yr (${t.lit.source})`);
        const ep = m.plx === null ? NaN : Math.hypot(m.eplx, 0.08);      // statistical + orientation systematic (see measure.ts)
        if (m.plx !== null && m.plx / ep > 3) { got.push(`Parallax ${m.plx.toFixed(2)} ± ${ep.toFixed(2)}″`); ref.push(`parallax ${t.lit.plx.toFixed(3)}″`); } }
      if (t.methane_ratio !== null && t.methane_ratio < 0.6) got.push(`Methane: ${Math.round((1 - t.methane_ratio) * 100)}% fainter at 3.3 µm than at 4.0 µm`);
      if (t.key === "wise-0855" && t.f46_mJy && t.w2_catwise_mJy) { got.push(`Seen only at 3.8–5 µm: ${t.f46_mJy.toFixed(2)} mJy at 4.6 µm`); ref.push(`${t.w2_catwise_mJy.toFixed(2)} mJy (WISE W2, 2010)`); }
      if (lc.pairs >= 20 || lc.variable) got.push(lc.variable ? `Variable: ${lc.amplitude.toFixed(lc.amplitude > 3 ? 1 : 2)}× brighter at ${band[lc.band]} in ${String(lc.hi).slice(0, 7)} than in ${String(lc.lo).slice(0, 7)}${lc.halo ? " (halo photometry)" : ""}` : `Steady: visit levels within ${Math.round((lc.all_amplitude - 1) * 100)}%${lc.halo ? " (halo photometry)" : ""}`);
      if (t.key === "r-dra") ref.push("Mira variable, period 246 days"); if (t.key === "rw-aur") ref.push("T Tauri star with deep dimming events"); if (t.key === "barnard" || t.key === "eps-indi-b") ref.push("not known to vary");
      return `<tr><td>${esc(t.name)}</td><td class="m">${t.frames} of ${t.covered}<br>${t.visits} visits · ${t.span_yr.toFixed(1)} yr</td><td>${got.join("<br>")}</td><td>${ref.join("<br>")}</td></tr>`; }).join("")}</tbody></table>
      <p class="note">Run of ${esc(String(v.built).replace("T", " "))} · ${v.stamp_px} × ${v.stamp_px} px stamps · index through ${esc(v.index?.last ?? "")}.</p>`;
  }).catch(() => { /* table stays as a note */ });
  load<any>("ai_metrics", true).then((m) => {
    if (!m || !document.getElementById("aimetrics")) return; const r = (k: string, label: string) => m[k] ? `<tr><td>${label}</td><td class="m">${m[k].n.toLocaleString()}</td><td class="m">${(m[k].dist_frac_err * 100).toFixed(0)}%</td><td class="m">${(m[k].frac_within_1sigma * 100).toFixed(0)}%</td></tr>` : "";
    $("#aimetrics").innerHTML = `<table><thead><tr><th>AI hold-out test (sky tiles never seen in training)</th><th>objects</th><th>distance error</th><th>within ±1σ (ideal 68%)</th></tr></thead><tbody>
      ${r("M_gaia", "Stars with Gaia parallaxes")}${r("M_ultracool", "Brown dwarfs (UltracoolSheet)")}${r("M_giants", "Giants (hardest)")}
      ${m.Teff ? `<tr><td>Temperature</td><td class="m">${m.Teff.n.toLocaleString()}</td><td class="m">${(m.Teff.robust_frac * 100).toFixed(1)}% scatter</td><td class="m">${(m.Teff.frac_within_1sigma * 100).toFixed(0)}%</td></tr>` : ""}
      ${m.class ? `<tr><td>Kind of object (4 classes)</td><td class="m">${m.class.confusion.flat().reduce((a: number, b: number) => a + b, 0).toLocaleString()}</td><td class="m">${(m.class.accuracy * 100).toFixed(1)}% correct</td><td class="m">brown dwarfs ${Math.round(m.class.confusion[2][2] / m.class.confusion[2].reduce((a: number, b: number) => a + b, 0) * 100)}% found</td></tr>` : ""}
      </tbody></table>`;
  });
}

// ============================================================================ boot
/** the sky map (Aladin Lite + survey layers) starts only when first shown */
async function bootAtlas() {
  await loadBasics();
  await initSky();
  if (!hashParams().get("ra")) S.chan = OVERVIEW_CH();
  setChan(S.chan); wireRainbow(); wireTime();
  $("#rainbow").style.display = SURVEYS[set.survey].cube && !SURVEYS[set.survey].rgb ? "" : "none";
  await loadLenses();
  $("#livess").onclick = () => { liveOn = !liveOn; $("#livess").classList.toggle("on", liveOn); refreshLive(true); };
  $("#livesky").onclick = () => toggleMySky(!$("#livesky").classList.contains("on"));
  document.querySelectorAll<HTMLButtonElement>(".lens:not(.livet)").forEach((b) => b.onclick = () => {
    const k = b.dataset.k as LensKey; S.lenses.has(k) ? S.lenses.delete(k) : S.lenses.add(k); applyLenses();
  });
  document.querySelectorAll<HTMLButtonElement>(".rung").forEach((b) => b.onclick = () => pickSurvey(b.dataset.s as SurveyKey));
  document.querySelectorAll<HTMLElement>(".rung").forEach((b) => b.classList.toggle("on", b.dataset.s === set.survey));
  if (SURVEYS[set.survey].rgb) applySurvey();
}

/** #universe (default) · #map · #tour · #observe · #lab[=station] · #log · #about; ?ra=&dec=[&fov=&name=] or ?target= open Observe (embeddable) */
async function route(initial: boolean) {
  const g = hashParams();
  if (g.has("about") || g.has("method")) { if (initial) await setView("blink"); renderAbout(); }
  else if (g.has("catalogue") || g.has("catalog") || g.has("tour") || g.has("atlas") || g.has("sky")) await setView("cat");
  else if (g.has("cases") || g.has("log") || g.has("logbook")) await setView("log");
  else if (g.has("take-part")) { await showUniverse("3d");       // straight to an object nobody has named, once the map knows them
    const t0 = Date.now(), iv = setInterval(() => { const btn = document.querySelector<HTMLElement>('#spfind [data-f="help"]'), n = document.querySelector("#spfn3")?.textContent ?? "";
      if (btn && /\d/.test(n)) { clearInterval(iv); btn.click(); } else if (Date.now() - t0 > 20000) clearInterval(iv); }, 400); }
  else if (g.has("space") || g.has("hood") || g.has("universe") || g.has("map")) await showUniverse("3d", g.get("universe") || g.get("map") || undefined);
  else if (g.has("lab") || g.has("observe") || g.has("blink")) await setView("blink");
  else if (initial) { await showUniverse("3d"); if (!space) await setView("blink"); }       // the map is the front door; without WebGL, the Lab is
}
/** fetch the code and data of the other sections while the visitor reads the first one, so that moving between
 *  sections never waits on the network: nothing is started, only downloaded */
function preload() {
  const idle = (f: () => void, ms: number) => ((window as any).requestIdleCallback ? (window as any).requestIdleCallback(f, { timeout: ms }) : setTimeout(f, ms));
  idle(() => { import("./catalogue"); import("./logbook"); import("./assistant"); for (const f of ["meta", "objects", "changes"]) fetch(`${import.meta.env.BASE_URL}data/verified/${f}.json`).catch(() => {}); }, 1500);
}
async function boot() {
  document.querySelectorAll<HTMLButtonElement>(".mainnav button").forEach((b) => b.onclick = () => { const v = b.dataset.view as View;
    // the address follows the section, so that a reload comes back to it; a field's parameters belong to the Lab only
    history.replaceState(null, "", location.pathname + (v === "blink" ? location.search || "#lab" : v === "cat" ? "#catalogue" : v === "log" ? "#cases" : ""));
    if (v === "universe") showUniverse(uniMode); else setView(v); });
  document.querySelectorAll<HTMLButtonElement>("#unimode button").forEach((b) => b.onclick = () => showUniverse(b.dataset.m as UniMode));
  $("#aboutbtn").onclick = () => ($("#about").classList.contains("open") ? closeAbout() : renderAbout());
  $("#asstbtn").onclick = async () => { const m = await import("./assistant"); m.toggleAssistant($("#asst"), { view: () => view, lab: () => blink.context(), labAct: (a) => blink.act(a), catalogue: async () => (await ensureCatalogue()).context(), catalogueAct: async (a) => (await ensureCatalogue()).act(a),
    observe: (q) => observe(q), go: (v) => (v === "universe" ? showUniverse("3d") : setView(v as View)), method: renderAbout, map: () => space?.context() ?? null, mapAct: (a) => space?.act(a) }); $("#asstbtn").classList.toggle("on", !$("#asst").hidden); };
  $("#pclose").onclick = closePanel;
  wireSheet();
  $("#tourbtn").onclick = async () => { await showUniverse("map"); renderStep(0); };
  $("#viewbtn").onclick = () => ($("#drawer").classList.contains("open") ? $("#drawer").classList.remove("open") : renderDrawer());
  // one search for the whole observatory: on the sky map it flies the map there; everywhere else it points the telescope
  $("#search").onsubmit = async (e) => {
    e.preventDefault(); const inp = $("#q") as HTMLInputElement, q = inp.value.trim(); if (!q) return; endTour(); inp.blur();
    // on the map a name flies there; anything the map does not hold (and any coordinates) goes to the Lab to be measured
    if (inp) { inp.value = ""; if (view === "universe" && uniMode === "3d" && space && !parseCoords(q) && space.focus(q)) return; observe(q); return; }
  };
  const h = hashParams();
  if (EMBED || query.has("ra") || query.has("target") || query.has("name")) { await setView("blink"); blink.openFromParams(query); }
  else if (h.get("ra") && h.has("inspect")) observe({ ra: +h.get("ra")!, dec: +h.get("dec")! });
  else if (h.get("ra")) observe({ ra: +h.get("ra")!, dec: +h.get("dec")! });
  else await route(true);
  preload();
  window.addEventListener("hashchange", () => route(false));
}
// phone: the dossier is a bottom sheet; drag its handle down to dismiss
function wireSheet() {
  const grab = $("#panel").querySelector(".grab") as HTMLElement; let y0 = 0, dy = 0, on = false;
  grab.addEventListener("pointerdown", (e) => { on = true; y0 = e.clientY; dy = 0; grab.setPointerCapture(e.pointerId); $("#panel").style.transition = "none"; });
  grab.addEventListener("pointermove", (e) => { if (!on) return; dy = Math.max(0, e.clientY - y0); $("#panel").style.transform = `translateY(${dy}px)`; });
  grab.addEventListener("pointerup", () => { on = false; $("#panel").style.transition = ""; $("#panel").style.transform = ""; if (dy > 90) closePanel(); });
}
boot();
