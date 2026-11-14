import "./style.css";
import A from "aladin-lite";
import { load, fmt, sexa, key, loadDetail, BASE, type Summary, type Target, type Obj } from "./data";
import { drawSpectrum } from "./spectrum";
import { spectrumStory, lightStory } from "./explain";
import { mountBlink, type BlinkTarget } from "./blink/view";
import { parseCoords, resolveName } from "./blink/catalogs";
import { setBase, indexMeta } from "./blink/engine";
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
  lenses: new Set<LensKey>(["movers", "methane", "vanished"]), blinkTimer: 0 as any, tourStep: -1, targets: [] as Target[], summary: null as Summary | null,
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
    <span>MIRA</span></a>
  <nav class="mainnav" aria-label="Sections">
    <button data-view="blink" title="Any position -> a movie of every SPHEREx pass">Blink</button>
    <button data-view="atlas" title="The whole infrared sky, 2010 against 2025, with the census of what changed">Sky atlas</button>
    <button data-view="space" title="Fly through the census in 3D">3D space</button>
    <button data-view="lab" title="Test ideas on the census">Lab</button>
    <button data-view="about">About</button>
  </nav>
  <form class="search" id="search"><input id="q" placeholder="Find on the map: a name, or RA Dec" autocomplete="off" enterkeyhint="search"></form>
  <div class="atlasnav">
    <button class="btn ghost sm" id="tourbtn">Tour</button>
    <button class="btn ghost sm" id="viewbtn">Display</button>
  </div>
  <div class="live" id="livebox" title="Latest SPHEREx exposure in MIRA's index; the index is rebuilt from NASA/IPAC IRSA's inventory after each data release"><span class="dotlive"></span><b id="livecount">SPHEREx data</b></div>
</header>

<section class="blinkpage" id="blinkpage"></section>

<aside class="lenses" id="lenses">
  <div class="eyebrow lens-head">Lenses — what to light up</div>
  ${(Object.keys(LENSES) as LensKey[]).map((k) => `<button class="lens" data-k="${k}" style="--c:${LENSES[k].c}"><span class="sw"></span>
    <span class="t">${LENSES[k].t}</span><span class="n" id="n-${k}">–</span><span class="d">${LENSES[k].d}</span></button>`).join("")}
  <div class="livebtns"><button class="lens livet on" id="livess" style="--c:#ffd27a"><span class="sw"></span><span class="t">Solar System now</span><span class="n">live</span>
    <span class="d">Planets, Moon, Sun, spacecraft and passing asteroids where they are on the timeline's date.</span></button>
    <button class="lens livet" id="livesky" style="--c:#5be3a6"><span class="sw"></span><span class="t">My sky now</span><span class="n">⌖</span>
    <span class="d">Your horizon and what is overhead where you are, right now.</span></button></div>
  <div class="lodstat mono" id="lodstat"></div>
</aside>

<nav class="ladder" id="ladder" aria-label="See the sky in different light">
  <span class="eyebrow">See it in</span>
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
    <button class="btn sm ghost" id="blink" title="Flip between WISE 2010 and SPHEREx 2025">Blink</button>
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
async function initSky() {
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
  if (!p.get("fov")) setTimeout(() => { if (touched) return; try { S.al.zoomToFoV(150, 3.0, () => nudge()); } catch { S.al.setFoV(150); } nudge([3500, 5000, 7000]); }, 3500);
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
    rgbLayers().forEach((l, i) => { try { l?.setSliceNumber?.(nearestChan(RGB[i].um)); l?.setColormap?.(RGB[i].name, { stretch: "asinh" }); l?.setGamma?.(set.gamma); l?.setContrast?.(set.contrast); l?.setBrightness?.(set.brightness); if (i) l?.setBlendingConfig?.(true); } catch { /* not ready */ } });
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
  try { S.al.setBaseImageLayer(A.imageHiPS(sv.url, { name: set.survey })); } catch { try { S.al.setImageSurvey(sv.url); } catch { /* */ } }
  if (sv.rgb) RGB.slice(1).forEach((c, i) => { const n = ["sxg", "sxr"][i]; try { const l = A.imageHiPS(sv.url + "/".repeat(i + 1), { name: n, additive: true, colormap: c.name, stretch: "asinh" }); S.al.setOverlayImageLayer(l, n); } catch { /* */ } });
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
let liveOn = true, liveT = 0, liveYear = NaN, myPos: { lat: number; lon: number } | null = null, liveMod: typeof import("./skylive") | null = null;
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
  document.getElementById("l3d")?.addEventListener("click", () => openSpaceView(it.name));
  $("#lzoom").onclick = () => flyTo(it.ra, it.dec, it.kind === "rock" || it.kind === "craft" ? 1 : 8);
  import("./live").then((m) => m.nasaImages(it.kind === "planet" || it.kind === "moon" ? `${it.name} ${it.kind === "moon" ? "lunar" : "planet"}` : it.name, 3)).then((L) => {
    const el = document.getElementById("limg"); if (el && L.length) el.innerHTML = `<div class="eyebrow">From NASA's image library</div><div class="thumbs">${L.map((x) => `<a href="${x.href}" target="_blank" rel="noopener"><img src="${x.thumb}" alt="" loading="lazy"></a>`).join("")}</div>`; });
}

// ============================================================================ wavelength
const OVERVIEW_CH = () => nearestChan(OVERVIEW_UM);
function nearestChan(um: number) { let b = 0; S.lam.forEach((l, i) => { if (!BLANK.has(i) && Math.abs(l - um) < Math.abs(S.lam[b] - um)) b = i; }); return b; }
function setChan(c: number) {
  setTimeout(() => nudge([400, 1500, 3000]), 0);
  if (BLANK.has(c)) c = c === 50 ? 49 : 52;
  S.chan = c;
  const um = S.lam[c] ?? 0;
  $("#chanlbl").textContent = um ? `${um.toFixed(3)} µm · channel ${c + 1}/102` : "";
  $("#knob").style.left = `${((um - 0.75) / (5.0 - 0.75)) * 100}%`;
  if (SURVEYS[set.survey].cube && !SURVEYS[set.survey].rgb) try { S.al?.getBaseImageLayer?.()?.setSliceNumber?.(c); } catch { /* not ready */ }
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
      <div class="fact"><b>${fmt(o.sx_w2_snr, 0)}</b><span>SPHEREx S/N (4–5 µm)</span></div>
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
        ${c.has_methane ? `<li>Its light shows a <b>methane dip</b> at 3.3 µm — only cold worlds (below ~1,300 K) have methane in their air.</li>` : ""}
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
  $("#pblinkit").onclick = () => openBlink({ ra: o.ra_sx, dec: o.dec_sx, pmra: o.reliable_motion ? o.pmra ?? 0 : 0, pmdec: o.reliable_motion ? o.pmdec ?? 0 : 0, epoch: REF_YEAR,
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
  const ph = document.getElementById("phood"); if (ph) ph.onclick = () => openSpaceView(hood || key(o));
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
  $("#ublinkit").onclick = () => openBlink({ ra: u.ra_sx, dec: u.dec_sx, otype: "unusual spectrum · census object" });
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
  $("#posblink").onclick = () => openBlink(known ?? { ra, dec });
}
function flyTo(ra: number, dec: number, fov: number) {
  if (!S.al) return;
  try { S.al.animateToRaDec(ra, dec, 2.2, () => S.al.zoomToFoV(fov, 1.6, () => nudge())); } catch { S.al.gotoRaDec(ra, dec); S.al.setFoV(fov); }
  nudge([2500, 4200, 6000]);
}

// ============================================================================ Lab (standalone page, lazy-loaded)
async function openLabPage() {
  setBlink(false); play(false); endTour(); closePanel();
  const { openLab } = await import("./labapp");
  document.body.classList.add("lab-on");
  await openLab($("#labpage"), () => document.body.classList.remove("lab-on"));
}

// ============================================================================ 3D space (lazy-loaded)
let closeSpace: (() => void) | null = null;
async function openSpaceView(focus?: string, withLab = false) {
  if (withLab) { openLabPage(); return; }
  setBlink(false); play(false); endTour(); closePanel();
  const { openSpace } = await import("./space");
  document.body.classList.add("space-on");
  const host = $("#space");
  const done = () => { closeSpace?.(); closeSpace = null; document.body.classList.remove("space-on"); nudge([300, 1200]); };
  (host as any).onclosed = () => { closeSpace = null; document.body.classList.remove("space-on"); nudge([300, 1200]); };
  closeSpace = await openSpace(host, { lowPower: set.saver || LOW_POWER, focus, onLab: () => { done(); openLabPage(); },
    onSky: async (ra, dec) => { done(); await showAtlas(); flyTo(ra, dec, 0.5); },
    onDossier: async (id) => { done(); await showAtlas(); const o = await loadDetail(id); if (o) { flyTo(o.ra_sx, o.dec_sx, 0.3); openObject(o); } else toast("Details for this object are not exported"); } });
}

// ============================================================================ tour
type Step = { title: string; text: string; ra?: number; dec?: number; fov?: number; lens?: LensKey[]; blink?: boolean; chan?: number; obj?: () => Promise<Obj | undefined | null> | Obj | undefined; objTitle?: string };
function targetObj(name: string) { return S.targets.find((t) => t.name === name)?.census; }
function steps(): Step[] {
  const van = S.sky?.top.get("vanished")?.rows?.[0];
  return [
    { title: "One sky, two missions", text: "This is SPHEREx's map of the whole sky in infrared light — the glowing band is our Milky Way. NASA's WISE mapped the same sky in 2010. Fifteen years apart, the two maps are a time machine: press ▶ below and watch the dots move.", ra: 266.4, dec: -28.9, fov: 150, chan: OVERVIEW_CH(), lens: [] },
    { title: "Barnard's Star", text: "Watch the bright star in the center: we are blinking WISE 2010 against SPHEREx 2025. It jumps by more than 2.5′ — it races 10.3″ a year across the sky. Our census measured that motion from the data alone, and the dot follows it exactly.", ra: 269.4468, dec: 4.753, fov: 0.5, blink: true, lens: ["movers"], obj: () => targetObj("Barnard's Star"), objTitle: "Barnard's Star" },
    { title: "The coldest known brown dwarf", text: "WISE 0855−0714 is barely warmer than the North Pole. Invisible to optical telescopes, it glows only near 4.5 µm. Our pipeline found it blind among 2 million detections, moving 8.2″ per year.", ra: 133.76, dec: -7.2422, fov: 0.4, blink: true, lens: ["movers", "methane"], obj: () => targetObj("WISE 0855-0714"), objTitle: "WISE 0855−0714" },
    { title: "A methane world next to a star", text: "Epsilon Indi B is a pair of brown dwarfs orbiting the bright star at upper right. At 3.3 µm its light is absorbed by methane, exactly as in Jupiter's atmosphere. Drag the colour bar between 3.3 and 4 µm and watch it fade and return.", ra: 331.0965, dec: -56.8006, fov: 0.3, chan: 64, lens: ["methane"], obj: () => targetObj("Epsilon Indi B"), objTitle: "Epsilon Indi B" },
    { title: "A young star that flickers", text: "RW Aurigae is a newborn star still wrapped in dust. Across the WISE years its infrared light swung by a factor of three as clouds passed in front of it. Scroll the panel to its 16-year light curve.", ra: 76.9564, dec: 30.4011, fov: 0.5, chan: 94, lens: ["brightened", "vanished"], obj: () => targetObj("RW Aurigae"), objTitle: "RW Aurigae" },
    { title: "A giant star that breathes", text: "R Draconis is a Mira variable: a dying red giant that swells and shrinks every 246 days, changing its infrared brightness several-fold. It sits near the North Ecliptic Pole, where SPHEREx passes thousands of times — open its flipbook below to see it pulse.", ra: 248.1689, dec: 66.7525, fov: 0.5, chan: 94, lens: ["brightened", "vanished"], obj: () => targetObj("R Draconis"), objTitle: "R Draconis" },
    ...(van ? [{ title: "Something vanished", text: "WISE saw a bright infrared source here; a decade later SPHEREx barely sees it. A star hidden by dust, a faded outburst, or something stranger? Candidates like this are what we want you to investigate.", ra: van[1], dec: van[2], fov: 0.1, blink: true, lens: ["vanished"] as LensKey[], obj: () => loadDetail(van[0]), objTitle: "Vanished source" }] : []),
    ...(S.cands.size ? [(() => { const c = [...S.cands.values()][0]; return { title: "Maybe a world nobody has seen", text: `Our AI and the 16-year motions flagged ${S.cands.size} cold, nearby objects that are in no catalogue of known brown dwarfs. This is the top one. The same search recovered ${S.candMeta?.recovered_known ?? "125"} known brown dwarfs, so it works — but each needs a follow-up observation to be confirmed.`, ra: c.ra_sx, dec: c.dec_sx, fov: 0.3, blink: true, lens: ["candidates"] as LensKey[], obj: () => ({ ...c }), objTitle: "Possible new cold world" }; })()] : []),
    { title: "Your turn", text: "Type any coordinates (or a name) in the search box, or right-click anywhere on the sky: MIRA builds a flipbook of every SPHEREx pass over that spot, straight from NASA's archive. Switch lenses on the left, or open 3D Space to fly among the objects.", ra: 266.4, dec: -28.9, fov: 150, lens: ["movers", "methane", "vanished", "brightened"] },
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
async function renderAbout() {
  await loadBasics();
  const rows = S.targets.map((t) => `<tr><td>${esc(t.name)}</td><td class="m">${t.census ? `${fmt(t.census.pmra, 2)}, ${fmt(t.census.pmdec, 2)}` : "pending"}</td>
    <td class="m">${fmt(t.pmra / 1000, 2)}, ${fmt(t.pmdec / 1000, 2)}</td><td class="m">${t.census ? fmt(t.census.sx_w2_snr, 0) : "–"}</td></tr>`).join("");
  $("#about").innerHTML = `<button class="icon-btn aclose" id="aclose">✕</button>
    <div class="eyebrow">How it works</div><h2 class="display">A census of a changing sky</h2>
    <p>For each of 12,288 patches of sky we linked the unWISE time-domain catalog — 43 billion WISE detections over 16 epochs (2010–2020) — into individual objects with their motion,
    then measured every object again in SPHEREx's 102-colour all-sky map (2025–26), at the position its motion predicts. Comparing the two reveals what moved, what changed, and what each object is made of.</p>
    <p>The heavy lifting ran once on a GPU cluster; this website only reads the results, and streams images directly from NASA's archive.
    The map loads a light all-sky list first, then only the 10° regions you zoom into. Dots move with each object's measured proper motion
    along great circles (exact for linear motion; perspective acceleration neglected, &lt; 4″ by 2100 even for Barnard's Star).</p>
    <div class="eyebrow" style="margin-top:30px">Validation · the five challenge targets</div>
    <div class="tablewrap"><table><thead><tr><th>Target</th><th>Census motion ″/yr (RA, Dec)</th><th>Literature</th><th>SPHEREx S/N</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="eyebrow" style="margin-top:30px">AI on GPUs · distances, temperatures and kinds for 132 million objects</div>
    <p>A deep ensemble of neural networks reads each SPHEREx spectrum (102 colours), the WISE W1−W2 colour and the 16-year reduced proper motion,
    and predicts the object's absolute infrared brightness, temperature and kind — each with its own uncertainty. It learned from 1.57 million stars with
    Gaia DR3 parallaxes and 1,487 brown dwarfs from the UltracoolSheet, then ran over all 132 million census spectra in 90 seconds on the cluster's GPUs.
    Distance follows from how bright the object looks. The 3D Space view places objects by Gaia parallax where it exists and by this AI elsewhere.</p>
    <div id="aimetrics" class="tablewrap"></div>
    <div class="eyebrow" style="margin-top:30px">Live NASA data</div>
    <p>Directly from NASA in your browser: <b>DONKI</b> solar storms (coronal mass ejections, drawn as expanding fronts at their measured speed and direction), <b>NeoWs</b> asteroids passing Earth today, and the <b>NASA Image and Video Library</b>.
    Refreshed hourly into the site (their servers do not allow direct browser access): <b>JPL Horizons</b> positions of 13 spacecraft, <b>JPL</b> close approaches with <b>SBDB</b> orbits for asteroids passing within 0.05 au,
    today's Sun from <b>SDO</b> and today's Earth from <b>EPIC</b>, mapped onto the 3D spheres. Planet positions use JPL's Keplerian elements (checked against an ephemeris to 0.003 au); 4,834 planetary systems come from the <b>NASA Exoplanet Archive</b>.</p>
    <div class="eyebrow" style="margin-top:30px">Honest limits</div>
    <ul><li>SPHEREx map pixels are 12.9″: close pairs blend, so changes are only flagged for isolated objects.</li>
    <li>Very bright stars saturate SPHEREx and are excluded from change and methane lenses.</li>
    <li>"Vanished" means "not seen by SPHEREx at the expected brightness" — every candidate is for human follow-up, not a confirmed discovery.</li>
    <li>3D renderings are impressions driven by an estimated temperature, not images.</li>
    <li>AI distances are typically ±27% (giants ±60%); objects whose AI uncertainty exceeds ±45% are not placed in 3D. Motion in 3D is straight-line: fine for ±250,000 years near the Sun, not for Galactic orbits.</li></ul>
    <p class="eyebrow" style="margin-top:30px">Data: NASA SPHEREx DR1 (IRSA, doi:10.26131/IRSA679) · unWISE time-domain catalog (doi:10.26131/IRSA580) · NASA WISE/NEOWISE · Gaia DR3 (ESA) · NASA Space Apps 2026</p>`;
  $("#about").classList.add("open"); $("#aclose").onclick = () => $("#about").classList.remove("open");
  load<any>("ai_metrics", true).then((m) => {
    if (!m) return; const r = (k: string, label: string) => m[k] ? `<tr><td>${label}</td><td class="m">${m[k].n.toLocaleString()}</td><td class="m">${(m[k].dist_frac_err * 100).toFixed(0)}%</td><td class="m">${(m[k].frac_within_1sigma * 100).toFixed(0)}%</td></tr>` : "";
    $("#aimetrics").innerHTML = `<table><thead><tr><th>Hold-out test (sky tiles never seen in training)</th><th>objects</th><th>distance error</th><th>within ±1σ (ideal 68%)</th></tr></thead><tbody>
      ${r("M_gaia", "Stars with Gaia parallaxes")}${r("M_ultracool", "Brown dwarfs (UltracoolSheet)")}${r("M_giants", "Giants (hardest)")}
      ${m.Teff ? `<tr><td>Temperature</td><td class="m">${m.Teff.n.toLocaleString()}</td><td class="m">${(m.Teff.robust_frac * 100).toFixed(1)}% scatter</td><td class="m">${(m.Teff.frac_within_1sigma * 100).toFixed(0)}%</td></tr>` : ""}
      ${m.class ? `<tr><td>Kind of object (4 classes)</td><td class="m">${m.class.confusion.flat().reduce((a: number, b: number) => a + b, 0).toLocaleString()}</td><td class="m">${(m.class.accuracy * 100).toFixed(1)}% correct</td><td class="m">brown dwarfs ${Math.round(m.class.confusion[2][2] / m.class.confusion[2].reduce((a: number, b: number) => a + b, 0) * 100)}% found</td></tr>` : ""}
      </tbody></table>`;
  });
}

// ============================================================================ boot
// ---- two main views share the page: BLINK (the SPHEREx movie workstation, default) and the sky atlas (Aladin + census)
type View = "blink" | "atlas";
const query = new URLSearchParams(location.search), EMBED = query.has("embed");
let view: View = "blink", atlasP: Promise<void> | null = null;
setBase(import.meta.env.BASE_URL);
document.body.classList.toggle("embed", EMBED);
const blink = mountBlink($("#blinkpage"), { embed: EMBED, toast,
  onState: (p) => { if (EMBED) p.set("embed", "1"); history.replaceState(null, "", `${location.pathname}?${p.toString()}`); },
  onAtlas: async (ra, dec) => { await showAtlas(); flyTo(ra, dec, 0.3); } });

function setView(v: View) {
  view = v; document.body.classList.toggle("v-blink", v === "blink"); document.body.classList.toggle("v-atlas", v === "atlas");
  $("#blinkpage").classList.toggle("open", v === "blink");
  document.querySelectorAll<HTMLElement>(".mainnav button").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  if (v === "blink") { setBlink(false); play(false); endTour(); closePanel(); $("#drawer").classList.remove("open"); blink.resume(); }
  else blink.pause();
}
function openBlink(t: BlinkTarget) { setView("blink"); blink.open(t); }
async function showAtlas() { setView("atlas"); await ensureAtlas(); nudge([100, 700, 1800]); }
async function loadBasics() {
  if (S.summary) return;
  S.summary = await load<Summary>("summary", true); S.lam = S.summary?.lam_um ?? []; S.targets = (await load<Target[]>("targets", true)) ?? [];
}
function ensureAtlas() { return (atlasP ??= bootAtlas()); }

/** the atlas (Aladin Lite + census layers) starts only when first shown: BLINK links and embeds stay light */
async function bootAtlas() {
  await loadBasics();
  await initSky();
  if (!hashParams().get("ra")) S.chan = OVERVIEW_CH();
  setChan(S.chan); wireRainbow(); wireTime();
  $("#rainbow").style.display = SURVEYS[set.survey].cube && !SURVEYS[set.survey].rgb ? "" : "none";
  await loadLenses();
  $("#livess").onclick = () => { liveOn = !liveOn; $("#livess").classList.toggle("on", liveOn); refreshLive(true); };
  $("#livesky").onclick = () => toggleMySky(!$("#livesky").classList.contains("on"));
  setTimeout(() => refreshLive(true), 1500);
  document.querySelectorAll<HTMLButtonElement>(".lens:not(.livet)").forEach((b) => b.onclick = () => {
    const k = b.dataset.k as LensKey; S.lenses.has(k) ? S.lenses.delete(k) : S.lenses.add(k); applyLenses();
  });
  document.querySelectorAll<HTMLButtonElement>(".rung").forEach((b) => b.onclick = () => pickSurvey(b.dataset.s as SurveyKey));
  document.querySelectorAll<HTMLElement>(".rung").forEach((b) => b.classList.toggle("on", b.dataset.s === set.survey));
  if (SURVEYS[set.survey].rgb) applySurvey();
}

async function boot() {
  document.querySelectorAll<HTMLButtonElement>(".mainnav button").forEach((b) => b.onclick = () => {
    const v = b.dataset.view!; endTour();
    if (v === "blink") setView("blink"); else if (v === "atlas") showAtlas(); else if (v === "space") openSpaceView(); else if (v === "lab") openLabPage(); else renderAbout();
  });
  $("#pclose").onclick = closePanel;
  wireSheet();
  $("#tourbtn").onclick = async () => { await showAtlas(); renderStep(0); };
  $("#viewbtn").onclick = () => ($("#drawer").classList.contains("open") ? $("#drawer").classList.remove("open") : renderDrawer());
  $("#search").onsubmit = async (e) => {
    e.preventDefault(); const q = ($("#q") as HTMLInputElement).value.trim(); if (!q) return; endTour(); ($("#q") as HTMLInputElement).blur();
    await showAtlas();
    const xy = parseCoords(q);
    if (xy) { flyTo(xy[0], xy[1], 0.2); setTimeout(() => openPosition(xy[0], xy[1]), 2400); return; }
    const norm = (x: string) => x.toLowerCase().replace(/\beps\b/g, "epsilon").replace(/\balf\b/g, "alpha").replace(/[^a-z0-9]/g, "");
    const t = S.targets.find((x) => norm(x.name).includes(norm(q)));
    if (t?.census) { flyTo(t.census.ra_sx, t.census.dec_sx, 0.5); setTimeout(() => openObject(t.census!, undefined, t.name), 3500); return; }
    const r = await resolveName(q).catch(() => null);
    if (r) { flyTo(r.ra, r.dec, 0.2); setTimeout(() => openPosition(r.ra, r.dec, r), 2400); toast(`${r.name ?? q} · found in SIMBAD`); return; }
    toast(`Could not find "${q}" — try RA Dec in degrees`);
  };
  indexMeta().then((m) => { if (m) $("#livecount").textContent = `SPHEREx data through ${m.last}`; });
  // deep links. ?ra=&dec=[&fov=&name=] or ?target=<name> open BLINK (embeddable); #atlas, #tour, #space, #lab, #about open the other sections
  const h = hashParams();
  if (query.has("ra") || query.has("target") || query.has("name")) { setView("blink"); blink.openFromParams(query); }
  else if (h.get("ra") && h.has("inspect")) openBlink({ ra: +h.get("ra")!, dec: +h.get("dec")! });
  else if (h.get("ra")) { await showAtlas(); if (h.get("blink")) setBlink(true); const k = h.get("k"); if (k) { const o = await loadDetail(k); if (o) openObject(o); } }
  else if (h.has("atlas") || h.has("tour")) await showAtlas();
  else setView("blink");
  const openFromHash = async () => {
    const g = hashParams();
    if (g.has("tour")) { await showAtlas(); renderStep(0); } else if (g.has("about")) renderAbout(); else if (g.has("lab")) openLabPage(); else if (g.has("hood") || g.has("space")) openSpaceView();
    else if (g.has("atlas") && view !== "atlas") showAtlas(); else if (g.has("blink") && !g.get("ra") && view !== "blink") setView("blink");
  };
  openFromHash(); window.addEventListener("hashchange", openFromHash);
}
// phone: the dossier is a bottom sheet; drag its handle down to dismiss
function wireSheet() {
  const grab = $("#panel").querySelector(".grab") as HTMLElement; let y0 = 0, dy = 0, on = false;
  grab.addEventListener("pointerdown", (e) => { on = true; y0 = e.clientY; dy = 0; grab.setPointerCapture(e.pointerId); $("#panel").style.transition = "none"; });
  grab.addEventListener("pointermove", (e) => { if (!on) return; dy = Math.max(0, e.clientY - y0); $("#panel").style.transform = `translateY(${dy}px)`; });
  grab.addEventListener("pointerup", () => { on = false; $("#panel").style.transition = ""; $("#panel").style.transform = ""; if (dy > 90) closePanel(); });
}
boot();
