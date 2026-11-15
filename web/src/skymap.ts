// THE SKY — a flat map of the entire sky that behaves like any map (drag, zoom, nothing bends) and has ONE time bar:
//   1999 → 2010   the 2MASS picture fades into the WISE one;
//   2010 → 2025   the WISE years, in which the moving stars were caught;
//   2025 → today  SPHEREx images the sky: its picture appears place by place on the dates it really observed them
//                 (from the exposure index), and each mover lights up when SPHEREx reached it;
//   today → +1 yr the planets go on along their road (the picture stays today's).
// The Sun, the Moon and the planets stand where they are on the date shown; at "today" they are live. A second
// slider goes through SPHEREx's 102 wavelengths, each read from NASA's all-sky cube at IRSA. Every confirmed mover,
// every planet and every landmark can be clicked; any other place can be watched through time in a card on the map,
// measured in the Lab, or looked at closely with CDS's Aladin.
// The map is drawn here, from plain pictures, in Galactic coordinates (the Milky Way runs along the middle).
import { hpxFaceXY } from "./blink/hips";
import { ang2pixNest } from "./blink/engine";
import { parseCoords, resolveName, CHALLENGE } from "./blink/catalogs";
import { KIND_PLAIN, isOpenCase, loadVerified, moonYears, mountMoverCard, moverName, votes, type Ver } from "./movercard";
import { bodiesAt, brightWords, dateOf, eclToEq, lightMinutes, seen, whenSeen, yearOf, zodiac, type SkyBody } from "./ephem";
import { mountPlaceView } from "./placeview";

export type SkyOpts = { base: string; lowPower?: boolean; focus?: string;
  onObserve: (t: { ra: number; dec: number; pmra?: number; pmdec?: number; epoch?: number; name?: string; source?: string }) => void;
  /** open one of the Lab's named targets (NASA's five test targets) */ onTarget?: (key: string) => void;
  onExplain?: (q: string) => void; on3D?: (id: string) => void; onCloser?: (ra: number, dec: number) => void; toast?: (m: string) => void;
  /** what is open, as the words that open it again (an id, a name, coordinates; empty when nothing is): for the address bar */ onLink?: (q: string) => void };
export type SkyHandle = { pause: (on: boolean) => void; focus: (q: string) => Promise<boolean>; context: () => unknown; /** "planets" | "spherex" | "story" | "colours" | "all" | "nogaia" | "open" */ show: (what: string) => boolean };

const D = Math.PI / 180;
const AG = [[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132], [0.4941094278755837, -0.4448296299600112, 0.7469822444972189], [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]];   // ICRS -> Galactic
export const toGal = (ra: number, dec: number): [number, number] => { const a = ra * D, d = dec * D, e = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const g = AG.map((r) => r[0] * e[0] + r[1] * e[1] + r[2] * e[2]); return [((Math.atan2(g[1], g[0]) / D) + 360) % 360, Math.asin(Math.max(-1, Math.min(1, g[2]))) / D]; };
export const toEq = (l: number, b: number): [number, number] => { const g = [Math.cos(b * D) * Math.cos(l * D), Math.cos(b * D) * Math.sin(l * D), Math.sin(b * D)];
  const e = [0, 1, 2].map((i) => AG[0][i] * g[0] + AG[1][i] * g[1] + AG[2][i] * g[2]); return [((Math.atan2(e[1], e[0]) / D) + 360) % 360, Math.asin(Math.max(-1, Math.min(1, e[2]))) / D]; };
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const hms = (ra: number, dec: number) => { const h = ra / 15, hh = Math.floor(h), mm = Math.floor((h - hh) * 60), a = Math.abs(dec), dd = Math.floor(a), dm = Math.floor((a - dd) * 60);
  return `${String(hh).padStart(2, "0")}h${String(mm).padStart(2, "0")}m ${dec < 0 ? "−" : "+"}${String(dd).padStart(2, "0")}°${String(dm).padStart(2, "0")}′`; };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayText = (yr: number) => { const d = dateOf(yr); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const SX = "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube";
/** SPHEREx's 102 wavelengths (µm), from the cube's own description; filled from its properties file */
let LAM: number[] = [];
const MISSIONS = [{ k: "2mass", yr: 1999, name: "2MASS", what: "near-infrared, 1.2–2.2 µm, 1997–2001" }, { k: "wise", yr: 2010, name: "WISE", what: "mid-infrared, 3.4–22 µm, 2010" }, { k: "spherex", yr: 2025, name: "SPHEREx", what: "three of its 102 colours: 1.1, 2.2 and 4.4 µm, 2025–26" }];
const Y0 = 1999.5, Y1 = 2010.5;
// places anyone may have heard of, to find one's way [name, RA, Dec]
const LAND: [string, number, number][] = [["Centre of the Milky Way", 266.417, -29.008], ["Large Magellanic Cloud", 80.894, -69.756], ["Small Magellanic Cloud", 13.187, -72.829], ["Andromeda galaxy", 10.685, 41.269],
  ["Orion Nebula", 83.822, -5.391], ["Pleiades", 56.75, 24.117], ["SPHEREx deep field · north", 270.0, 66.561], ["SPHEREx deep field · south", 90.0, -66.561]];
type Pin = { name: string; sub: string; ra: number; dec: number; pm: number; key?: string; ra0: number; dec0: number };
type Cov = { mjd0: number; first: string; last: string; days: number; exposures: number; visits: number[][] };
const hl = (k: string, c: string, t: string, sub: string) => `<button class="mx-hl" data-h="${k}"><i style="--c:${c}"></i><span><b>${t}</b><small>${sub}</small></span></button>`;

export async function openSky(host: HTMLElement, o: SkyOpts): Promise<SkyHandle> {
  host.innerHTML = `<canvas class="sk-cv" aria-label="Map of the whole sky"></canvas>
    <svg class="sp-leader" id="skleader" aria-hidden="true" hidden><circle r="13"/><circle r="2.5"/><polyline points=""/></svg>
    <aside class="mx-rail" id="skrail" aria-label="Highlights of the sky map">
      <button class="mx-fold" id="skfold" title="Hide or show the highlights" aria-expanded="true">Highlights</button>
      <div class="mx-body">
        <div class="mx-list" id="skhl">
          ${hl("planets", "#ffd27a", "Planets, live", "Where the Sun, the Moon and the planets are right now")}
          ${hl("spherex", "#5be3ff", "SPHEREx, live", "Its survey filling the sky by date, up to NASA's newest public images")}
          ${hl("story", "#f0f0fa", "27 years in 25 seconds", "Three NASA surveys of the whole sky: 1999, 2010, today")}
          ${hl("colours", "#c58cff", "102 colours", "The sky at each wavelength SPHEREx sees")}
          ${hl("all", "#ff9d4d", "Stars caught moving", "<b id='skn1'>…</b> confirmed on SPHEREx images")}
          ${hl("nogaia", "#ff5d6c", "Not in Gaia", "<b id='skn2'>…</b> missing from Europe's star catalogue")}
          ${hl("open", "#7df0a6", "Help look at one", "<b id='skn3'>…</b> are in no reference database")}
        </div>
        <div class="mx-sub" id="sksub" hidden></div>
        <div class="mx-chips" id="skshow" aria-label="What the map shows"><button data-l="movers" class="on">Movers</button><button data-l="planets" class="on">Planets</button><button data-l="marks" class="on">Landmarks</button></div>
      </div>
    </aside>
    <div class="mx-dock" id="skdock">
      <button class="mx-play" id="skplay" aria-label="Play from 1999 to today" title="Play from 1999 to today">▶</button>
      <div class="mx-date"><b id="skdate">–</b><small id="skera">–</small></div>
      <div class="mx-track"><input type="range" id="skt" min="0" max="4000" value="3000" aria-label="Date: from the 2MASS picture of 1999 to a year from now">
        <div class="mx-ticks"><button data-u="0">1999</button><button data-u="1">2010</button><button data-u="2">2025</button><button data-u="3">today</button><button data-u="4" title="Play the coming year: where the planets will go">+1 yr</button></div></div>
      <button class="mx-live on" id="sknow" title="Back to today: the newest picture, and the planets where they are right now"><i></i>Live</button>
    </div>
    <div class="sp-hint show" id="skhint">Drag to move · scroll or pinch to zoom · click a point, a planet or any place</div>
    <div class="sk-coords mono" id="skcoords"></div>
    <div class="sk-menu hud" id="skmenu" hidden></div>
    <div class="sp-info" id="skinfo"></div>`;
  const $ = <T extends HTMLElement>(s: string) => host.querySelector(s) as T, cv = $<HTMLCanvasElement>(".sk-cv"), g = cv.getContext("2d")!;
  const view = { l: 0, b: 0, z: 1 };
  const st = { u: 3, end: 3, wave: -1, chip: "all", panel: "", sel: -1, body: "", place: null as null | { ra: number; dec: number }, playing: false, raf: 0, dirty: true, paused: false, last: 0, show: { movers: true, planets: true, marks: true } as Record<string, boolean> };
  let cw = 0, ch = 0, V: Ver | null = null, GL = new Float32Array(0), GB = new Float32Array(0), CELL = new Uint16Array(0), shown: number[] = [], destroyCard: (() => void) | null = null;
  let nowY = yearOf(), YS = 2025.31, cov: Cov | null = null, cellOf: Uint16Array | null = null, firstEnd = new Float32Array(0), prog = { pct: 1, visits: 0 }, bodies: (SkyBody & { gl: number; gb: number })[] = [], bodiesKey = NaN;
  const scale = () => (cw / 360) * view.z;
  const toScreen = (l: number, b: number): [number, number] => [cw / 2 - wrap(l - view.l) * scale(), ch / 2 - (b - view.b) * scale()];
  const toSky = (x: number, y: number): [number, number] => [(((view.l - (x - cw / 2) / scale()) % 360) + 360) % 360, view.b - (y - ch / 2) / scale()];
  const clampView = () => { view.z = Math.min(40, Math.max(1, cw ? (2 * ch) / cw : 1, view.z)); const half = ch / 2 / scale(); view.b = half >= 90 ? 0 : Math.max(-90 + half, Math.min(90 - half, view.b)); view.l = ((view.l % 360) + 360) % 360; };
  // ---- the time bar: four equal stretches of very different lengths, so that each has room
  const yearAt = (u: number) => (u <= 1 ? Y0 + (Y1 - Y0) * u : u <= 2 ? Y1 + (YS - Y1) * (u - 1) : u <= 3 ? YS + (nowY - YS) * (u - 2) : nowY + (u - 3));
  const uAt = (yr: number) => (yr <= Y1 ? (yr - Y0) / (Y1 - Y0) : yr <= YS ? 1 + (yr - Y1) / (YS - Y1) : yr <= nowY ? 2 + (yr - YS) / (nowY - YS) : 3 + (yr - nowY));
  const RATE = [1 / 4, 1 / 3.5, 1 / 17.5, 1 / 14];           // stretches per second while playing: 1999 to today in 25 seconds
  const isLive = () => Math.abs(st.u - 3) < 1e-4;
  const dayOf = (yr: number) => (cov ? (yr - 2000) * 365.25 + 51544.5 - cov.mjd0 : -1);

  // ---- pictures: one panorama per survey (x = Galactic longitude from the left edge, y = latitude from +90 at the top)
  let revKey = NaN, scanOn = false, revFull = false;
  const pano: Record<string, HTMLImageElement | HTMLCanvasElement | null> = {};
  const loadPano = (k: string, size: number) => new Promise<void>((res) => { const im = new Image(); im.onload = () => { const cur = pano[k] as HTMLImageElement | null; if (!cur || cur.width <= im.width) pano[k] = im; revKey = NaN; st.dirty = true; res(); }; im.onerror = () => res(); im.src = `${o.base}space/mw_${k}_${size}.jpg`; });
  const first = Promise.all(MISSIONS.map((m) => loadPano(m.k, 2048)));
  if (!o.lowPower) first.then(() => MISSIONS.forEach((m) => loadPano(m.k, 4096)));        // sharper copies once the map is up
  // ---- SPHEREx, live: the picture as far as the survey had come on a given day, from the dates of its exposures
  const MW = 360, MH = 180, RW = o.lowPower ? 1024 : 2048, mk = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const maskCv = mk(MW, MH), scanCv = mk(MW, MH), revCv = mk(RW, RW / 2);
  function paint(c: HTMLCanvasElement, val: Float32Array, rgb: number[]) {
    const a = new Float32Array(MW * MH), t = new Float32Array(MW * MH); for (let i = 0; i < a.length; i++) a[i] = val[cellOf![i]];
    for (let pass = 0; pass < 2; pass++) {            // soften the edges of the sky cells (longitude wraps around)
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) t[y * MW + x] = (a[y * MW + ((x + MW - 1) % MW)] + a[y * MW + x] + a[y * MW + ((x + 1) % MW)]) / 3;
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) a[y * MW + x] = (t[Math.max(0, y - 1) * MW + x] + t[y * MW + x] + t[Math.min(MH - 1, y + 1) * MW + x]) / 3; }
    const cx = c.getContext("2d")!, id = cx.createImageData(MW, MH), d = id.data; for (let i = 0; i < a.length; i++) { d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255 * a[i]; } cx.putImageData(id, 0, 0);
  }
  function reveal(day: number) {
    const key = Math.round(day * 2); if (key === revKey || !cov || !cellOf || !pano.spherex) return; revKey = key;
    const n = cov.visits.length, A = new Float32Array(n), S = new Float32Array(n); let seenN = 0, vis = 0; scanOn = false;
    for (let c = 0; c < n; c++) { const v = cov.visits[c]; if (!v.length || day < v[0]) continue; seenN++; A[c] = Math.min(1, (day - v[0] + 1) / (Math.min(v[1] - v[0], 12) + 2));      // a place fills in over its first two weeks, as the 102 colours come in
      for (let q = 0; q < v.length; q += 2) { if (day >= v[q]) vis++; if (day >= v[q] - 1 && day <= v[q] + 4) { S[c] = 1; scanOn = true; } } }
    prog = { pct: seenN / n, visits: vis / n }; revFull = seenN === n && A.every((q) => q >= 1); paint(maskCv, A, [255, 255, 255]); paint(scanCv, S, [91, 227, 255]);
    const rg = revCv.getContext("2d")!; rg.globalCompositeOperation = "copy"; rg.drawImage(pano.spherex, 0, 0, RW, RW / 2); rg.globalCompositeOperation = "destination-in"; rg.imageSmoothingEnabled = true; rg.drawImage(maskCv, 0, 0, RW, RW / 2); rg.globalCompositeOperation = "source-over";
  }
  fetch(`${o.base}data/sphx2/coverage.json`).then((r) => (r.ok ? r.json() : null)).then((c: Cov | null) => {
    if (!c?.visits?.length) return; const nside = Math.round(Math.sqrt(c.visits.length / 12)), map = new Uint16Array(MW * MH);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) { const [ra, dec] = toEq(((x + 0.5) / MW) * 360, 90 - ((y + 0.5) / MH) * 180); map[y * MW + x] = ang2pixNest(nside, ra, dec); }
    firstEnd = new Float32Array(c.visits.length); c.visits.forEach((v, i) => (firstEnd[i] = v.length ? v[1] : 1e9));
    const keep = yearAt(st.u); cov = c; cellOf = map; YS = 2000 + (c.mjd0 - 51544.5) / 365.25; st.u = Math.min(4, Math.max(0, uAt(keep)));
    if (V) CELL = Uint16Array.from(V.ra, (ra, k) => ang2pixNest(nside, ra, V!.dec[k])); sync();
  }).catch(() => {});
  // ---- SPHEREx at one wavelength: the "Allsky" preview of that frame of NASA's cube, laid out on the same panorama
  const frames = new Map<number, HTMLCanvasElement>(), loading = new Set<number>(); let lut: Int32Array | null = null;
  const PW = 2048, PH = 1024;
  function buildLut() {                                     // where each panorama pixel lies in the preview's grid of 768 small tiles
    const out = new Int32Array(PW * PH);
    for (let Y = 0; Y < PH; Y++) for (let X = 0; X < PW; X++) { const [ra, dec] = toEq(((X + 0.5) / PW) * 360, 90 - ((Y + 0.5) / PH) * 180), [face, ix, iy] = hpxFaceXY(512, ra, dec);
      let t = 0; for (let q = 0; q < 3; q++) t += ((((ix >> 6) >> q) & 1) + 2 * (((iy >> 6) >> q) & 1)) * 4 ** q; t += face * 64;
      out[Y * PW + X] = (Math.floor(t / 27) * 64 + (ix & 63)) * 1728 + (t % 27) * 64 + (iy & 63); }
    return out;
  }
  const hue = (um: number): [number, number, number] => { const u = Math.min(1, Math.max(0, (um - 0.75) / 4.25)), h = (220 - 220 * u) / 60, c = 0.75, x = c * (1 - Math.abs((h % 2) - 1)), m = 0.25;
    const [r, gg, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : [0, x, c]; return [r + m, gg + m, b + m]; };
  const busy = (t: string) => { const b = host.querySelector("#skbusy"); if (b) b.textContent = t; };
  async function loadFrame(k: number) {
    if (frames.has(k) || loading.has(k)) return; loading.add(k); busy("reading NASA's archive…");
    try {
      const r = await fetch(`${SX}/Norder3/Allsky${k ? "_" + k : ""}.png`); if (!r.ok) throw new Error("no frame");
      const bmp = await createImageBitmap(await r.blob()), src = document.createElement("canvas"); src.width = bmp.width; src.height = bmp.height; const sg = src.getContext("2d", { willReadFrequently: true })!; sg.drawImage(bmp, 0, 0);
      const px = sg.getImageData(0, 0, bmp.width, bmp.height).data; lut ??= buildLut();
      const samp: number[] = []; for (let q = 0; q < lut.length; q += 997) samp.push(px[lut[q] * 4]); samp.sort((a, b) => a - b);
      const lo = samp[Math.floor(samp.length * 0.4)], hi = Math.max(lo + 20, samp[Math.floor(samp.length * 0.998)]), [tr, tg, tb] = hue(LAM[k] ?? 2);
      const out = document.createElement("canvas"); out.width = PW; out.height = PH; const og = out.getContext("2d")!, id = og.createImageData(PW, PH), d = id.data;
      for (let q = 0; q < lut.length; q++) { const v = Math.pow(Math.min(1, Math.max(0, (px[lut[q] * 4] - lo) / (hi - lo))), 0.85) * 255; d[q * 4] = v * tr; d[q * 4 + 1] = v * tg; d[q * 4 + 2] = v * tb; d[q * 4 + 3] = 255; }
      og.putImageData(id, 0, 0); frames.set(k, out); if (frames.size > 14) frames.delete(frames.keys().next().value!);
    } catch { /* the frame stays unavailable; the three-colour picture remains */ }
    loading.delete(k); if (!loading.size) busy(""); sync();
  }
  fetch(`${SX}/properties`).then((r) => r.text()).then((t) => { const m = t.match(/data_cube_crval3_arr\s*=\s*([^\n]+)/); if (m) LAM = m[1].trim().split(/\s+/).map(Number); sync(); }).catch(() => {});

  // ---- my sky now: with the visitor's position (asked for, kept in this page, sent nowhere) the part of the sky
  //      below their horizon is shaded, and each wanderer is said to be up or to rise at about such an hour
  let me: { lat: number; lon: number } | null = null, horizKey = NaN, horizLine: [number, number][] = [], compass: { n: string; l: number; b: number }[] = [];
  const horizCv = mk(MW, MH); let maskRA: Float32Array | null = null, maskSD: Float32Array, maskCD: Float32Array;
  const lstAt = (yr: number) => { const dj = (yr - 2000) * 365.25, T = dj / 36525; return (((280.46061837 + 360.98564736629 * dj + 0.000387933 * T * T + me!.lon) % 360) + 360) % 360; };
  /** altitude above the visitor's horizon and compass bearing (degrees, from north through east) */
  const altAz = (ra: number, dec: number, yr: number): [number, number] => { const H = (lstAt(yr) - ra) * D, ph = me!.lat * D, d = dec * D, sa = Math.sin(ph) * Math.sin(d) + Math.cos(ph) * Math.cos(d) * Math.cos(H);
    return [Math.asin(Math.max(-1, Math.min(1, sa))) / D, ((Math.atan2(-Math.cos(d) * Math.sin(H), Math.sin(d) * Math.cos(ph) - Math.cos(d) * Math.sin(ph) * Math.cos(H)) / D) + 360) % 360]; };
  const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  /** "34° up in the south-east", or "below your horizon · rises about 21:40" (searched in five-minute steps over a day) */
  function myView(b: { ra: number; dec: number }, yr: number): string {
    const [alt, az] = altAz(b.ra, b.dec, yr); if (alt > 0) return `${alt < 10 ? "low" : alt > 60 ? "high" : Math.round(alt) + "° up"} in the ${COMPASS[Math.round(az / 45) % 8]}`;
    for (let m = 5; m <= 1440; m += 5) if (altAz(b.ra, b.dec, yr + m / 525960)[0] > 0) return `below your horizon · rises about ${dateOf(yr + m / 525960).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    return "does not rise for you today";
  }
  function horizon(yr: number) {
    const key = Math.round(yr * 365.25 * 720); if (key === horizKey || !me) return; horizKey = key;
    if (!maskRA) { maskRA = new Float32Array(MW * MH); maskSD = new Float32Array(MW * MH); maskCD = new Float32Array(MW * MH);
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) { const [ra, dec] = toEq(((x + 0.5) / MW) * 360, 90 - ((y + 0.5) / MH) * 180), i = y * MW + x; maskRA[i] = ra; maskSD[i] = Math.sin(dec * D); maskCD[i] = Math.cos(dec * D); } }
    const lst = lstAt(yr), sp = Math.sin(me.lat * D), cp = Math.cos(me.lat * D), cx = horizCv.getContext("2d")!, id = cx.createImageData(MW, MH), d = id.data;
    for (let i = 0; i < maskRA.length; i++) { const sa = sp * maskSD[i] + cp * maskCD[i] * Math.cos((lst - maskRA[i]) * D); d[i * 4 + 3] = sa >= 0.03 ? 0 : sa <= -0.03 ? 165 : (165 * (0.03 - sa)) / 0.06; }
    cx.putImageData(id, 0, 0);
    const at = (alt: number, az: number): [number, number] => { const a = alt * D, A = az * D, ph = me!.lat * D, dec = Math.asin(Math.sin(a) * Math.sin(ph) + Math.cos(a) * Math.cos(ph) * Math.cos(A)), H = Math.atan2(-Math.sin(A) * Math.cos(a), Math.sin(a) * Math.cos(ph) - Math.cos(a) * Math.sin(ph) * Math.cos(A));
      return toGal((((lst - H / D) % 360) + 360) % 360, dec / D); };
    horizLine = []; for (let az = 0; az <= 360; az += 3) horizLine.push(at(0, az));
    compass = [["N", 0], ["E", 90], ["S", 180], ["W", 270]].map(([n, az]) => { const [l, b] = at(2.5, az as number); return { n: n as string, l, b }; }); const z = at(90, 0); compass.push({ n: "overhead", l: z[0], b: z[1] });
  }
  function askWhere() {
    if (me) { me = null; horizKey = NaN; subKey = ""; sync(); return; }
    if (!navigator.geolocation) { o.toast?.("This browser cannot tell where you are."); return; }
    navigator.geolocation.getCurrentPosition((p) => { me = { lat: p.coords.latitude, lon: p.coords.longitude }; horizKey = NaN; subKey = ""; closeCard(); jump(3);
        horizon(yearAt(3)); const z = compass.find((c) => c.n === "overhead"); if (z) { view.l = z.l; view.b = 0; view.z = 1; clampView(); } st.dirty = true; },       // what is overhead goes to the middle of the map
      () => o.toast?.("No position was given. Allow it for this page to see your own horizon."), { maximumAge: 3600000, timeout: 12000 });
  }
  // ---- the wanderers: Sun, Moon and planets on the date shown, with where they came from and where they are going
  const PAST = 60, AHEAD = 30, STEP = 3;                      // days of trail behind and ahead, and the step between its points
  let trails: Record<string, [number, number][]> = {};
  function ephem() {
    const yr = yearAt(st.u), key = Math.round(yr * 365.25 * 24); if (key === bodiesKey) return; bodiesKey = key;
    bodies = bodiesAt(yr).map((b) => { const [gl, gb] = toGal(b.ra, b.dec); return { ...b, gl, gb }; }); trails = {};
    for (let d = -PAST; d <= AHEAD; d += STEP) for (const b of bodiesAt(yr + d / 365.25)) if (b.kind === "planet") (trails[b.key] ??= []).push(toGal(b.ra, b.dec));
  }
  const ECL: [number, number][] = []; for (let lon = 0; lon <= 360; lon += 2) ECL.push(toGal(...eclToEq(lon, 0)));
  // ---- the famous ones: NASA's five test targets and the nearest brown dwarfs
  const PINS: Pin[] = [...CHALLENGE.map((t) => ({ name: t.name, sub: t.blurb, key: t.key as string | undefined, ra0: t.ra, dec0: t.dec, pmra: t.pmra ?? 0, pmdec: t.pmdec ?? 0, epoch: t.epoch ?? 2000 })),
    { name: "Luhman 16", sub: "The nearest brown dwarfs: a pair 6.5 light-years away", key: undefined, ra0: 162.3288, dec0: -53.3194, pmra: -2.76, pmdec: 0.36, epoch: 2010.5 }]
    .map((t) => { const dt = nowY - t.epoch, dec = t.dec0 + (t.pmdec * dt) / 3600, ra = t.ra0 + (t.pmra * dt) / 3600 / Math.cos(t.dec0 * D), mid = (Y0 + nowY) / 2 - t.epoch;
      return { name: t.name, sub: t.sub, key: t.key, ra, dec, pm: Math.hypot(t.pmra, t.pmdec), ra0: t.ra0 + (t.pmra * mid) / 3600 / Math.cos(t.dec0 * D), dec0: t.dec0 + (t.pmdec * mid) / 3600 }; });
  const PINGAL = PINS.map((p) => toGal(p.ra, p.dec)), LANDGAL = LAND.map(([, ra, dec]) => toGal(ra, dec));
  let marks: { x: number; y: number; r: number; go: () => void }[] = [];

  // ---- drawing
  function layer(img: HTMLImageElement | HTMLCanvasElement | null | undefined, alpha: number) {
    if (!img || alpha <= 0.003) return; const s = scale(), k = (s * 360) / img.width, y0 = ch / 2 - (90 - view.b) * s; g.globalAlpha = Math.min(1, alpha);
    // longitude grows to the left, as on every map of the sky seen from inside; copies on either side close the circle
    for (let n = -1; n <= 1; n++) { const x0 = cw / 2 + view.l * s + n * 360 * s; if (x0 - 360 * s > cw || x0 < 0) continue; g.save(); g.translate(x0, y0); g.scale(-k, k); g.drawImage(img, 0, 0); g.restore(); }
    g.globalAlpha = 1;
  }
  const ease = (u: number) => { const v = Math.min(1, Math.max(0, u)); return v * v * (3 - 2 * v); };
  let boxes: number[][] = [];
  /** a label beside (x, y) that does not sit on another one; returns false when there was no room */
  function label(text: string, x: number, y: number, r: number, color: string, font = "600 11px Barlow, system-ui, sans-serif", must = false) {
    g.font = font; const w = g.measureText(text).width + 6, h = 15, spots = [[r + 5, -h / 2], [-r - 5 - w, -h / 2], [-w / 2, -r - 4 - h], [-w / 2, r + 4]];
    const free = spots.find(([dx, dy]) => { const bx = x + dx, by = y + dy; return bx >= 2 && by >= 2 && bx + w <= cw - 2 && by + h <= ch - 2 && !boxes.some((q) => bx < q[0] + q[2] && bx + w > q[0] && by < q[1] + q[3] && by + h > q[1]); }) ?? (must ? spots[0] : null);
    if (!free) return false; const bx = x + free[0], by = y + free[1];
    boxes.push([bx, by, w, h]); g.textBaseline = "middle"; g.textAlign = "left"; g.lineWidth = 2.5; g.lineJoin = "round"; g.strokeStyle = "rgba(0,0,0,.6)"; g.strokeText(text, bx + 3, by + h / 2); g.fillStyle = color; g.fillText(text, bx + 3, by + h / 2); return true;
  }
  function path(pts: [number, number][], from: number, to: number) {       // a line on the sky, broken where it leaves one edge and comes back on the other
    const s = scale(); let px = NaN; g.beginPath();
    for (let i = from; i <= to; i++) { const x = cw / 2 - wrap(pts[i][0] - view.l) * s, y = ch / 2 - (pts[i][1] - view.b) * s; if (i === from || Math.abs(x - px) > cw / 2) g.moveTo(x, y); else g.lineTo(x, y); px = x; }
    g.stroke();
  }
  function draw() {
    st.dirty = false; g.fillStyle = "#000"; g.fillRect(0, 0, cw, ch); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    const u = st.u, yr = yearAt(u), day = dayOf(yr), s = scale(); boxes = []; marks = [];
    if (st.wave >= 0) { const f = frames.get(st.wave); layer(pano.spherex, f ? 0.25 : 1); layer(f, 1); }
    else if (u <= 1) { layer(pano["2mass"], 1); layer(pano.wise, ease(u)); }
    else if (u <= 2) layer(pano.wise, 1);
    else if (u < 3 && cov && cellOf) { reveal(day);
      if (!revFull) { layer(pano.wise, 1 - 0.5 * ease((u - 2) / 0.05)); layer(revCv, 1); } else layer(pano.spherex, 1);
      if (scanOn) { g.globalCompositeOperation = "screen"; layer(scanCv, 0.34); g.globalCompositeOperation = "source-over"; } }
    else if (u < 3) { layer(pano.wise, 1); layer(pano.spherex, ease(u - 2)); }
    else layer(pano.spherex, 1);
    // my sky now: what is below the visitor's horizon is shaded
    const mine = !!me && isLive() && st.wave < 0;
    if (mine) { horizon(yr); layer(horizCv, 1); g.lineWidth = 1.2; g.strokeStyle = "rgba(125,240,166,.7)"; path(horizLine, 0, horizLine.length - 1); }
    // the ecliptic: the road of the Sun, the Moon and the planets
    const wanderers = st.show.planets && (!st.playing || u >= 2);
    if (wanderers) { g.setLineDash([2, 6]); g.lineWidth = 1; g.strokeStyle = "rgba(255,210,122,.42)"; path(ECL, 0, ECL.length - 1); g.setLineDash([]); }
    // the confirmed movers in view: unseen before WISE, faint through the WISE years, lit when SPHEREx reached them
    const mv = u < 1 ? 0 : u < 2 ? ease(u - 1) : 1;
    if (V && st.show.movers && mv > 0) { const r = Math.max(0.75, Math.min(4, 0.2 + 0.11 * s)), dense = st.chip === "all" && s < 12, sel = st.sel, wait = u < 3 && cov && CELL.length === GL.length; shown = [];
      for (let k = 0; k < GL.length; k++) { if (Math.abs(V.glat[k]) < 10 && k !== sel) continue;                       // the crowded plane is left out, as in the Catalogue
        const nog = V.known[k] !== 1, open = isOpenCase(V, k); if ((st.chip === "nogaia" && !nog) || (st.chip === "open" && !open)) continue;
        const x = cw / 2 - wrap(GL[k] - view.l) * s, y = ch / 2 - (GB[k] - view.b) * s; if (x < -4 || y < -4 || x > cw + 4 || y > ch + 4) continue;
        shown.push(k); const lit = !wait || (u >= 2 && day >= firstEnd[CELL[k]]);         // grey while only WISE had seen it move, in colour once SPHEREx had imaged the place
        g.fillStyle = !lit ? "#a89a8c" : open ? "#7df0a6" : nog ? "#ff5d6c" : "#ff9d4d"; g.globalAlpha = mv * (!lit ? 0.55 : dense && !nog ? 0.5 : dense ? 0.85 : 1); g.fillRect(x - r, y - r, 2 * r, 2 * r); }
      g.globalAlpha = 1; } else shown = [];
    // the wanderers, with their names
    if (wanderers) { ephem();
      for (const b of bodies) { const tr = trails[b.key]; if (!tr) continue; const mid = PAST / STEP; g.lineWidth = 1.4; g.strokeStyle = b.col; g.globalAlpha = 0.55; path(tr, 0, mid); g.globalAlpha = 0.5; g.setLineDash([1.5, 4]); path(tr, mid, tr.length - 1); g.setLineDash([]); g.globalAlpha = 1; }
      for (const b of bodies) { const [x, y] = toScreen(b.gl, b.gb); if (x < -30 || y < -30 || x > cw + 30 || y > ch + 30) continue;
        const r = b.kind === "sun" ? Math.max(8, 0.27 * s) : b.kind === "moon" ? Math.max(6, 0.26 * s) : Math.max(3, Math.min(8, 6 - b.mag * 0.6));
        const halo = g.createRadialGradient(x, y, r * 0.4, x, y, r * (b.kind === "sun" ? 3.2 : 2.4)); halo.addColorStop(0, b.col + "aa"); halo.addColorStop(1, b.col + "00"); g.fillStyle = halo; g.beginPath(); g.arc(x, y, r * (b.kind === "sun" ? 3.2 : 2.4), 0, 7); g.fill();
        g.fillStyle = b.col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.lineWidth = 1; g.strokeStyle = "rgba(0,0,0,.65)"; g.stroke();
        marks.push({ x, y, r: Math.max(12, r + 5), go: () => openBody(b.key) }); }
      for (const b of bodies) { const [x, y] = toScreen(b.gl, b.gb); if (x < 0 || y < 0 || x > cw || y > ch) continue; label(b.name.toUpperCase(), x, y, b.kind === "planet" ? 7 : 10, "#fff", "700 11px Barlow, system-ui, sans-serif", true); } }
    if (mine) for (const c of compass) { const [x, y] = toScreen(c.l, c.b); if (x > 0 && y > 0 && x < cw && y < ch) { if (c.n === "overhead") { g.strokeStyle = "#7df0a6"; g.lineWidth = 1.3; g.beginPath(); g.moveTo(x - 6, y); g.lineTo(x + 6, y); g.moveTo(x, y - 6); g.lineTo(x, y + 6); g.stroke(); } label(c.n === "overhead" ? "straight overhead" : c.n, x, y, c.n === "overhead" ? 7 : 0, "#7df0a6", "700 11px Barlow, system-ui, sans-serif", true); } }
    // the famous ones and the landmarks
    if (st.show.marks) {
      PINS.forEach((p, i) => { const [x, y] = toScreen(PINGAL[i][0], PINGAL[i][1]); if (x < 0 || y < 0 || x > cw || y > ch) return;
        g.strokeStyle = "#fff"; g.lineWidth = 1.3; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 6, y); g.lineTo(x, y + 6); g.lineTo(x - 6, y); g.closePath(); g.stroke();
        label(p.name, x, y, 7, "rgba(255,255,255,.95)", "600 11.5px Barlow, system-ui, sans-serif"); marks.push({ x, y, r: 12, go: () => openPin(p) }); });
      LAND.forEach(([name, ra, dec], i) => { const [x, y] = toScreen(LANDGAL[i][0], LANDGAL[i][1]); if (x < 0 || y < 0 || x > cw || y > ch) return;
        g.strokeStyle = "rgba(240,240,250,.55)"; g.lineWidth = 1; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.stroke();
        if (label(name, x, y, 5, "rgba(240,240,250,.72)", "500 11px Barlow, system-ui, sans-serif")) marks.push({ x, y, r: 10, go: () => openPlace(ra, dec, name, "A landmark of the sky. Here it is as three NASA surveys saw it.") }); });
      if (wanderers && s > 3.2) { const [x, y] = toScreen(ECL[10][0], ECL[10][1]); if (x > 0 && y > 0 && x < cw && y < ch) label("ecliptic · the planets' road", x, y, 3, "rgba(255,210,122,.75)", "500 10.5px Barlow, system-ui, sans-serif"); }
    }
    leader();
  }
  /** where the thing the card is about stands on the sky right now (Galactic), or null */
  function target(): [number, number] | null { if (st.sel >= 0 && V) return [GL[st.sel], GB[st.sel]]; if (st.body) { const b = bodies.find((q) => q.key === st.body); return b ? [b.gl, b.gb] : null; } if (st.place) return toGal(st.place.ra, st.place.dec); return null; }
  function leader() {
    const sv = $<any>("#skleader") as SVGSVGElement, card = $("#skinfo"), t = target(); if (!t || !card.classList.contains("open") || cw < 760) { sv.setAttribute("hidden", ""); return; }
    sv.removeAttribute("hidden"); const [x, y] = toScreen(t[0], t[1]), r = card.getBoundingClientRect(), h = host.getBoundingClientRect(), cx = r.left - h.left, cy = Math.min(Math.max(y, r.top - h.top + 30), r.bottom - h.top - 30);
    sv.querySelectorAll("circle").forEach((q) => { q.setAttribute("cx", String(x)); q.setAttribute("cy", String(y)); });
    (sv.querySelector("polyline") as SVGPolylineElement).setAttribute("points", `${x + 13},${y} ${Math.max(x + 30, cx - 36)},${cy} ${cx},${cy}`);
  }
  // ---- the rail's lower half: what the chosen highlight needs
  let subKey = "", subAt = 0;
  function renderSub() {
    const el = $("#sksub"), yr = yearAt(st.u); if (st.playing && st.panel && subKey && performance.now() - subAt < 250) return;        // while time runs, four times a second is enough
    subAt = performance.now(); el.hidden = !st.panel; $("#skrail").classList.toggle("sub", !!st.panel); if (!st.panel) { subKey = ""; el.innerHTML = ""; return; }
    if (st.panel === "planets") { ephem(); const mine = !!me && isLive(), key = `p${bodiesKey}|${mine}|${mine ? Math.round(yr * 365.25 * 288) : 0}`; if (key === subKey) return; subKey = key;
      el.innerHTML = `<div class="mx-h">${isLive() ? "Right now" : dayText(yr)}</div><div class="mx-rows">${bodies.map((b) => `<button data-b="${b.key}"><i style="background:${b.col}"></i><b>${b.name}</b><span>${mine ? myView(b, yr) : b.kind === "sun" ? "daytime side of the sky" : `${b.kind === "moon" ? whenSeen(b).eye.split(",")[0] : whenSeen(b).when.replace(/^in the /, "").replace(/, (before sunrise|after sunset)$/, "").replace(" to see these weeks", "")}${zodiac(b) ? ` · ${zodiac(b)}` : ""}`}</span></button>`).join("")}</div>
        <div class="mx-acts"><button class="btn sm ${me ? "solid" : "ghost"}" id="skme" title="Shade what is below your own horizon right now, and say which planets are up. Your position is used in this page only">${me ? "✓ My sky now" : "My sky now"}</button><button class="btn sm ghost" id="skyear" title="Let the date run through the next twelve months">▶ The coming year</button></div>
        <p class="mx-note">${mine ? "The shaded part of the map is below your horizon at this moment; the green line is the horizon, with its compass points. Your position stays in this page: it is not sent or stored. " : me ? "Press Live to see your own sky again. " : ""}Computed from JPL's orbital elements (within 10′ of JPL Horizons). The dotted line is the ecliptic, the road the planets keep to; each planet trails its last two months and points to its next one.</p>`;
      $("#skme").onclick = askWhere;
      el.querySelectorAll<HTMLButtonElement>("[data-b]").forEach((b) => (b.onclick = () => openBody(b.dataset.b!, true)));
      $("#skyear").onclick = () => playTo(3, 4); }
    else if (st.panel === "spherex") { const key = `s${Math.round(prog.pct * 1000)}|${Math.round(st.u * 400)}|${!!cov}`; if (key === subKey) return; subKey = key;
      const pct = st.u >= 3 ? 1 : st.u <= 2 ? 0 : prog.pct, vis = st.u >= 3 && cov ? cov.visits.reduce((q, v) => q + v.length / 2, 0) / cov.visits.length : st.u <= 2 ? 0 : prog.visits;
      el.innerHTML = cov ? `<div class="mx-stat"><b>${Math.round(pct * 100)}%</b><span>of the sky imaged at least once by ${dayText(Math.min(yr, nowY))} · ${vis.toFixed(1)} visits on average</span></div><div class="mx-bar"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>
        <div class="mx-acts"><button class="btn sm ghost" id="skrun" title="From SPHEREx's first survey exposures to the newest public ones">▶ Play the survey</button></div>
        <p class="mx-note">${cov.exposures.toLocaleString()} exposures are public, from ${cov.first} to ${cov.last}. The picture appears where SPHEREx had really observed by each date; the blue band is where it had just arrived. It comes back to every place about every six months. A new release needs one script. <a class="link" href="${o.base}data/sphx2/coverage.json" download="spherex_coverage_dates.json">The dates, as a file</a></p>`
        : `<p class="mx-note">The dates of SPHEREx's exposures could not be read just now.</p>`;
      const run = host.querySelector("#skrun") as HTMLElement | null; if (run) run.onclick = () => playTo(2, 3); }
    else if (st.panel === "colours") { const key = `c${st.wave}|${LAM.length}`; if (key === subKey) return; subKey = key; const lam = LAM[st.wave];
      el.innerHTML = `<div class="mx-h">SPHEREx sees 102 colours · pick one</div><div class="sk-row"><input type="range" id="skw" min="0" max="101" value="${st.wave >= 0 ? st.wave : 60}" aria-label="SPHEREx wavelength"><b class="mono" id="skwl">${st.wave >= 0 && lam ? lam.toFixed(2) + " µm" : "–"}</b></div>
        <div class="sk-row"><button class="link" id="skrgb" ${st.wave >= 0 ? "" : "hidden"}>back to the three-colour picture</button><span class="sk-busy" id="skbusy"></span></div>
        <p class="mx-note">Each position of the slider is one of the 102 wavelengths (0.75 to 5 µm), read live from NASA's all-sky cube. Around 3.3 µm the dust of the Milky Way lights up.</p>`;
      $<HTMLInputElement>("#skw").oninput = (e) => { st.playing = false; let k = +(e.target as HTMLInputElement).value; if (k === 50) k = 49; if (k === 51) k = 52; st.u = 3; st.wave = k; loadFrame(k); const l2 = LAM[k]; $("#skwl").textContent = l2 ? `${l2.toFixed(2)} µm` : "…"; ($("#skrgb") as HTMLElement).hidden = false; subKey = `c${k}|${LAM.length}`; sync(); };      // frames 50 and 51 of the cube are blank
      $("#skrgb").onclick = () => { st.wave = -1; sync(); }; }
  }
  function sync() {
    const u = st.u, yr = yearAt(u), live = isLive();
    $<HTMLInputElement>("#skt").value = String(Math.round(u * 1000)); $("#skplay").textContent = st.playing ? "❚❚" : "▶";
    $("#skdate").textContent = u < 2 ? String(Math.floor(yr)) : dayText(yr);
    if (u > 2 && u < 3 && cov && cellOf) reveal(dayOf(yr));
    $("#skera").textContent = st.wave >= 0 ? `SPHEREx at ${LAM[st.wave] ? LAM[st.wave].toFixed(2) : "…"} µm${frames.has(st.wave) ? "" : " · loading"}`
      : live ? "today · live" : u > 3 ? "ahead · the planets' road" : u <= 0.02 ? "2MASS · near-infrared" : u < 0.98 ? "from 2MASS to WISE" : u <= 1.02 ? "WISE · mid-infrared" : u < 2 ? "WISE years · movers caught" : !cov ? "SPHEREx" : prog.pct < 0.999 ? `SPHEREx · ${Math.round(prog.pct * 100)}% of the sky` : `SPHEREx · pass ${Math.ceil(prog.visits + 1e-6)} of the sky`;
    $("#sknow").classList.toggle("on", live);
    host.querySelectorAll<HTMLButtonElement>(".mx-ticks button").forEach((b) => b.classList.toggle("on", Math.abs(+b.dataset.u! - u) < 0.02));
    host.querySelectorAll<HTMLButtonElement>("#skhl .mx-hl").forEach((b) => { const h = b.dataset.h!; b.classList.toggle("on", h === st.panel || (st.show.movers && h === st.chip && ["all", "nogaia", "open"].includes(h))); });
    host.querySelectorAll<HTMLButtonElement>("#skshow button").forEach((b) => b.classList.toggle("on", !!st.show[b.dataset.l!]));
    renderSub(); if (st.body) renderBody();
    st.dirty = true;
  }
  function playTo(from: number | null, to: number) { st.wave = -1; if (from !== null) st.u = from; st.end = to; st.playing = true; st.last = performance.now(); sync(); }
  function loop(now: number) {
    if (st.paused) return;
    if (st.playing) { const dt = Math.min(0.1, (now - st.last) / 1000); st.last = now; let u = st.u + dt * RATE[Math.min(3, Math.floor(st.u + 1e-9))]; if (u >= st.end) { u = st.end; st.playing = false; } st.u = u; sync(); }
    else if (isLive() && now - st.last > 30000) { st.last = now; nowY = yearOf(); sync(); }                     // live: the Moon and the planets keep their appointments
    if (st.dirty) draw();
    st.raf = requestAnimationFrame(loop);
  }
  const resize = () => { const r = host.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); cw = r.width; ch = r.height; if (!cw || !ch) return; cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); cv.style.width = cw + "px"; cv.style.height = ch + "px"; g.setTransform(dpr, 0, 0, dpr, 0, 0); clampView(); st.dirty = true; };
  addEventListener("resize", resize); resize();

  // ---- cards: a confirmed mover (the same card as on the 3D map), a wanderer, or any place
  const poolIds = () => (V ? V.id.filter((_, k) => isOpenCase(V!, k)) : []);
  function nextCase() { if (!V) return; const v = votes(), pool: number[] = []; for (let k = 0; k < V.id.length; k++) if (isOpenCase(V, k)) pool.push(k); const left = pool.filter((k) => !v[V!.id[k]]), from = left.length ? left : pool; if (from.length) select(from[Math.floor(Math.random() * from.length)], true); }
  function closeCard() { closeMenu(); destroyCard?.(); destroyCard = null; st.sel = -1; st.body = ""; st.place = null; const card = $("#skinfo"); card.classList.remove("open", "ver", "hud"); card.innerHTML = ""; st.dirty = true; o.onLink?.(""); }
  // on a phone the card is a sheet over the lower half, so the thing it is about is put in the upper third
  const flyTo = (l: number, b: number, z: number) => { view.l = l; view.z = Math.max(view.z, z); view.b = cw < 760 ? b - (ch * 0.27) / scale() : b; clampView(); st.dirty = true; };
  function select(k: number, fly = false) {
    closeCard(); if (k < 0 || !V) return; st.sel = k; const card = $("#skinfo"); o.onLink?.(V.id[k]);
    if (fly) flyTo(GL[k], GB[k], 5);
    destroyCard = mountMoverCard(card, V, k, { lead: `At ${hms(V.ra[k], V.dec[k])} on the sky. It crosses the width of the full Moon every <b>${moonYears(V, k)} years</b>${V.known[k] === 0 ? ", and it is not in Gaia, Europe's optical star catalogue" : ""}.`,
      poolIds, next: nextCase, onClose: closeCard, onObserve: (t2) => o.onObserve({ ...t2, source: "The survey of the WISE years (2010–2020)" }), onExplain: o.onExplain, autoplay: !o.lowPower,
      more: [...(o.on3D ? [["See it in 3D", "Fly to this object on the 3D map, if its distance is known", () => o.on3D!(V!.id[k])] as [string, string, () => void]] : []),
        ...(o.onCloser ? [["Look closer", "Real survey tiles of this place, with CDS's Aladin", () => o.onCloser!(V!.ra[k], V!.dec[k])] as [string, string, () => void]] : [])] });
    st.dirty = true;
  }
  function openBody(key: string, fly = false) { closeCard(); ephem(); const b = bodies.find((q) => q.key === key); if (!b) return; st.body = key; o.onLink?.(b.name); if (fly) flyTo(b.gl, b.gb, 2.5); renderBody(true); st.dirty = true; }
  let bodyKey = "";
  function renderBody(force = false) {
    const b = bodies.find((q) => q.key === st.body), card = $("#skinfo"); if (!b) return; const key = `${b.key}|${bodiesKey}`; if (!force && key === bodyKey) return; bodyKey = key;
    const w = whenSeen(b), z = b.kind !== "sun" ? zodiac(b) : "", live = isLive(), km = b.dist * 149597870.7, mins = lightMinutes(b);
    card.classList.add("open", "hud", "ver");
    card.innerHTML = `<button class="icon-btn" id="skbx" aria-label="Close">✕</button>
      <div class="eyebrow">${b.kind === "planet" ? "Planet" : b.kind === "moon" ? "The Moon" : "Our star"} · ${live ? "where it is right now" : "on " + dayText(yearAt(st.u))}</div>
      <h3 class="display">${b.name}</h3>
      <p class="sp-lead">${b.kind === "sun" ? "The Sun hides this part of the sky: whatever lies behind it is up during the day. Six months from now the same stars will be overhead at midnight."
        : `${b.name} is <b>${w.when}</b>${z ? `, in the direction of the constellation ${z}` : ""}. ${w.eye[0].toUpperCase() + w.eye.slice(1)}.`}</p>
      <div class="facts">
        <div class="fact"><b>${b.kind === "moon" ? Math.round(km).toLocaleString() + " km" : b.dist.toFixed(2) + " au"}</b><span>from Earth${b.kind === "moon" ? "" : ` (${(km / 1e6).toFixed(0)} million km)`}</span></div>
        <div class="fact"><b>${mins < 1 ? (mins * 60).toFixed(1) + " s" : mins < 100 ? mins.toFixed(0) + " min" : (mins / 60).toFixed(1) + " h"}</b><span>ago its light left</span></div>
        ${b.kind === "sun" ? "" : `<div class="fact"><b>${Math.abs(b.elong).toFixed(0)}° ${b.elong > 0 ? "east" : "west"}</b><span>of the Sun in the sky</span></div><div class="fact"><b>${b.mag >= 0 ? "+" : "−"}${Math.abs(b.mag).toFixed(1)}</b><span>${brightWords(b).split(": ")[1] ?? "magnitude"}</span></div>`}
      </div>
      ${me && live ? `<div class="sp-ver"><b>From where you are, right now:</b> ${myView(b, yearAt(st.u))}.</div>` : ""}
      <p class="why">${b.kind === "planet" ? "Planet means wanderer: it changes place against the stars in days. The stars change place too, in decades: that is what the orange points on this map are." : b.kind === "moon" ? "The Moon goes around the whole sky in a month, about its own width every hour." : "The dotted line is the Sun's yearly path among the stars, the ecliptic. The planets keep close to it."} Position from JPL's orbital elements (within 10′).</p>
      <div class="actions">${o.on3D ? `<button class="btn sm solid" id="skb3d" title="Fly around the Solar System as it is on this date">See it in 3D</button>` : ""}${o.onExplain ? `<button class="btn sm ghost" id="skbex">Explain it to me</button>` : ""}${b.kind === "planet" ? `<button class="btn sm ghost" id="skbyr" title="Let the date run through the next twelve months and watch it go">▶ Its coming year</button>` : ""}</div>`;
    $("#skbx").onclick = closeCard; const b3 = card.querySelector("#skb3d") as HTMLElement | null, bx = card.querySelector("#skbex") as HTMLElement | null, by = card.querySelector("#skbyr") as HTMLElement | null;
    if (b3) b3.onclick = () => o.on3D!(b.name); if (by) by.onclick = () => playTo(3, 4);
    if (bx) bx.onclick = () => o.onExplain!(`Explain in everyday words where ${b.name === "Sun" || b.name === "Moon" ? "the " + b.name : b.name} is in the sky ${live ? "right now" : "on " + dayText(yearAt(st.u))}, when and how I can see it, and one thing worth knowing about it.`);
  }
  function openPlace(ra: number, dec: number, name?: string, sub?: string, opt: { field?: number; key?: string } = {}) {
    closeCard(); st.place = { ra, dec }; const card = $("#skinfo"), [l, b] = toGal(ra, dec); flyTo(l, b, 3); o.onLink?.(name ?? `${ra.toFixed(4)} ${dec >= 0 ? "+" : ""}${dec.toFixed(4)}`); card.classList.add("open", "hud", "ver");
    card.innerHTML = `<button class="icon-btn" id="skbx" aria-label="Close">✕</button>
      <div class="eyebrow">${name ? "On the sky at " + hms(ra, dec) : "A place in the sky"}</div><h3 class="display">${name ? esc(name) : hms(ra, dec)}</h3>
      <p class="sp-lead">${sub ? esc(sub) : "Three NASA surveys have photographed this place. Play them one after another: what changes place is moving."}</p>
      <div class="sp-pics"><div class="eyebrow">This place in 1999, in 2010, and at each SPHEREx visit</div><div id="skpv"></div></div>
      <div class="actions"><button class="btn sm solid" id="skmeas" title="Read every SPHEREx exposure of this field and measure what moved in it">Measure it in the Lab</button>
        ${o.onCloser ? `<button class="btn sm ghost" id="skclose2" title="Real survey tiles of this place, with CDS's Aladin">Look closer</button>` : ""}${o.onExplain && name ? `<button class="btn sm ghost" id="skbex">Explain it to me</button>` : ""}</div>`;
    const pv = mountPlaceView($("#skpv"), { ra, dec }, { autoplay: !o.lowPower, field: opt.field }); destroyCard = () => pv.destroy();
    $("#skbx").onclick = closeCard; $("#skmeas").onclick = () => (opt.key && o.onTarget ? o.onTarget(opt.key) : o.onObserve({ ra, dec, name }));
    const c2 = card.querySelector("#skclose2") as HTMLElement | null, bx = card.querySelector("#skbex") as HTMLElement | null; if (c2) c2.onclick = () => o.onCloser!(ra, dec);
    if (bx) bx.onclick = () => o.onExplain!(`Explain ${name} to me in everyday words: what it is and why astronomers care about it.`);
    st.dirty = true;
  }
  /** one of the famous ones: its verified card when the catalogue holds it, its place through time otherwise */
  function openPin(p: Pin) {
    if (V) { let best = -1, bd = 30 / 3600; const cd = Math.cos(p.dec * D); for (let k = 0; k < V.id.length; k++) { const dd = Math.abs(V.dec[k] - p.dec); if (dd > bd) continue; const d = Math.hypot(dd, wrap(V.ra[k] - p.ra) * cd); if (d < bd) { bd = d; best = k; } } if (best >= 0) { select(best, true); return; } }
    openPlace(p.ra0, p.dec0, p.name, p.sub, { field: Math.min(600, Math.max(240, 2.6 * p.pm * (nowY - Y0))), key: p.key });
  }
  // ---- any other place: watch it through time, measure it, or look closer
  const closeMenu = () => { $("#skmenu").hidden = true; };
  function menuAt(x: number, y: number) {
    const [l, b] = toSky(x, y); if (Math.abs(b) > 90) return; const [ra, dec] = toEq(l, b), m = $("#skmenu");
    m.innerHTML = `<div class="eyebrow">${hms(ra, dec)}</div><button class="btn sm solid" id="skwatch" title="This place in 1999, in 2010 and at each SPHEREx visit, as a little film">Watch this place through time</button>
      <button class="btn sm ghost" id="skmeas0" title="Read every SPHEREx exposure of this field and measure what moved in it">Measure it in the Lab</button>${o.onCloser ? `<button class="btn sm ghost" id="skclose0" title="Real survey tiles of this place, with CDS's Aladin">Look closer</button>` : ""}`;
    m.hidden = false; m.style.left = Math.min(cw - 270, Math.max(8, x + 12)) + "px"; m.style.top = Math.min(ch - 160, Math.max(8, y - 10)) + "px";
    $("#skwatch").onclick = () => openPlace(ra, dec); $("#skmeas0").onclick = () => { closeMenu(); o.onObserve({ ra, dec }); };
    const c2 = m.querySelector("#skclose0") as HTMLElement | null; if (c2) c2.onclick = () => { closeMenu(); o.onCloser!(ra, dec); };
  }
  // ---- pointer: drag, pinch, wheel, click
  const pts = new Map<number, [number, number]>(); let moved = 0, pinch = 0;
  const hitMark = (x: number, y: number) => { let best: (() => void) | null = null, bd = 1e9; for (const m of marks) { const d = Math.hypot(m.x - x, m.y - y); if (d < m.r && d < bd) { bd = d; best = m.go; } } return best; };
  function hit(x: number, y: number) { if (!V) return -1; let best = -1, bd = Math.max(4.5, Math.min(9, 0.2 + 0.11 * scale() + 3.5)) ** 2; for (const k of shown) { const [sx, sy] = toScreen(GL[k], GB[k]), d = (sx - x) ** 2 + (sy - y) ** 2; if (d < bd) { bd = d; best = k; } } return best; }
  cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.offsetX, e.offsetY]); moved = 0; pinch = 0; closeMenu(); });
  cv.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId);
    if (!p) { const [l, b] = toSky(e.offsetX, e.offsetY); if (Math.abs(b) <= 90) { const [ra, dec] = toEq(l, b); $("#skcoords").textContent = `${hms(ra, dec)}  ·  Galactic ${l.toFixed(1)}° ${b >= 0 ? "+" : "−"}${Math.abs(b).toFixed(1)}°`; } cv.style.cursor = hitMark(e.offsetX, e.offsetY) || hit(e.offsetX, e.offsetY) >= 0 ? "pointer" : "grab"; return; }
    if (pts.size === 2) { const [a, b2] = [...pts.entries()].map(([id, q]) => (id === e.pointerId ? [e.offsetX, e.offsetY] : q)), d = Math.hypot(a[0] - b2[0], a[1] - b2[1]); if (pinch) zoomAt((a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2, d / pinch); pinch = d; moved = 9; }
    else { const dx = e.offsetX - p[0], dy = e.offsetY - p[1]; moved += Math.abs(dx) + Math.abs(dy); view.l += dx / scale(); view.b += dy / scale(); clampView(); st.dirty = true; }
    pts.set(e.pointerId, [e.offsetX, e.offsetY]);
  });
  const up = (e: PointerEvent) => { if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId); if (moved < 5 && e.type === "pointerup") { const m = hitMark(e.offsetX, e.offsetY), k = m ? -1 : hit(e.offsetX, e.offsetY); if (m) m(); else if (k >= 0) select(k); else if (st.sel >= 0 || st.body || st.place) closeCard(); else menuAt(e.offsetX, e.offsetY); } };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  function zoomAt(x: number, y: number, f: number) { const [l, b] = toSky(x, y); view.z *= f; clampView(); const [l2, b2] = toSky(x, y); view.l += wrap(l - l2); view.b += b - b2; clampView(); st.dirty = true; }
  cv.addEventListener("wheel", (e) => { e.preventDefault(); closeMenu(); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  // ---- controls
  const jump = (u: number) => { st.playing = false; st.wave = -1; if (Math.abs(u - 3) < 1e-6) nowY = yearOf(); st.u = u; sync(); };
  $<HTMLInputElement>("#skt").oninput = (e) => { let u = +(e.target as HTMLInputElement).value / 1000; for (const q of [0, 1, 2, 3, 4]) if (Math.abs(u - q) < 0.025) u = q; jump(u); };
  $("#skplay").onclick = () => { if (st.playing) { st.playing = false; sync(); } else if (st.u >= 3 && st.u < 3.999) playTo(st.u > 3.001 ? null : 0, st.u > 3.001 ? 4 : 3); else playTo(st.u >= 2.999 ? 0 : null, 3); };
  $("#sknow").onclick = () => jump(3);
  host.querySelectorAll<HTMLButtonElement>(".mx-ticks button").forEach((b) => (b.onclick = () => (b.dataset.u === "4" ? playTo(3, 4) : jump(+b.dataset.u!))));
  const whole = () => { closeCard(); view.l = 0; view.b = 0; view.z = 1; clampView(); };          // the whole sky in view, for the stories told on it
  function show(what: string): boolean {
    if (what === "planets" || what === "spherex" || what === "colours") { const open = st.panel !== what; st.panel = open ? what : ""; if (what !== "colours" && st.wave >= 0) st.wave = -1;
      if (open && what === "planets") { st.show.planets = true; if (st.u < 2) jump(3); } if (open && what === "spherex") { whole(); playTo(2, 3); } if (!open && what === "colours") st.wave = -1; sync(); return true; }
    if (what === "story") { st.panel = ""; whole(); playTo(0, 3); return true; }
    if (what === "all" || what === "nogaia" || what === "open") { st.show.movers = true; if (what === "open" && st.chip === "open") { nextCase(); return true; } st.chip = what; if (st.u < 2) jump(3); sync(); if (what === "open") nextCase(); return true; }
    return false;
  }
  host.querySelectorAll<HTMLButtonElement>("#skhl .mx-hl").forEach((b) => (b.onclick = () => show(b.dataset.h!)));
  host.querySelectorAll<HTMLButtonElement>("#skshow button").forEach((b) => (b.onclick = () => { const k = b.dataset.l!; st.show[k] = !st.show[k]; sync(); }));
  const rail = $("#skrail"), fold = $("#skfold"); if (innerWidth < 760) rail.classList.add("shut");
  fold.onclick = () => { rail.classList.toggle("shut"); fold.setAttribute("aria-expanded", String(!rail.classList.contains("shut"))); };
  // ---- the verified catalogue
  loadVerified(o.base).then((v) => { if (!v) return; V = v; GL = new Float32Array(v.id.length); GB = new Float32Array(v.id.length); let n = 0, ng = 0, op = 0;
    for (let k = 0; k < v.id.length; k++) { const [l, b] = toGal(v.ra[k], v.dec[k]); GL[k] = l; GB[k] = b; if (Math.abs(v.glat[k]) >= 10) { n++; if (v.known[k] !== 1) ng++; if (isOpenCase(v, k)) op++; } }
    if (cov) CELL = Uint16Array.from(v.ra, (ra, k) => ang2pixNest(Math.round(Math.sqrt(cov!.visits.length / 12)), ra, v.dec[k]));
    $("#skn1").textContent = n.toLocaleString(); $("#skn2").textContent = ng.toLocaleString(); $("#skn3").textContent = op.toLocaleString(); st.dirty = true; if (o.focus) handle.focus(o.focus); });
  const handle: SkyHandle = {
    pause(on) { st.paused = on; cancelAnimationFrame(st.raf); if (!on) { resize(); st.dirty = true; st.last = performance.now(); st.raf = requestAnimationFrame(loop); } },
    show,
    async focus(q) {
      const s = q.trim(), low = s.toLowerCase(); if (!s) return false;
      ephem(); const body = bodies.find((b) => b.name.toLowerCase() === low || "the " + b.name.toLowerCase() === low); if (body) { st.show.planets = true; openBody(body.key, true); sync(); return true; }
      const pin = PINS.find((p) => p.name.toLowerCase() === low || p.key === low) ?? (low.length > 3 ? PINS.find((p) => p.name.toLowerCase().includes(low)) : undefined); if (pin) { openPin(pin); return true; }
      const lm = low.length > 3 ? LAND.find(([n2]) => n2.toLowerCase().includes(low)) : undefined; if (lm) { openPlace(lm[1], lm[2], lm[0], "A landmark of the sky. Here it is as three NASA surveys saw it."); return true; }
      if (V) { let k = /^\d+-\d+$/.test(s) ? V.id.indexOf(s) : -1; if (k < 0 && low.length > 2) k = V.simbad.findIndex((n2) => n2.toLowerCase().includes(low)); if (k >= 0) { select(k, true); return true; } }
      const xy = parseCoords(s), r = xy ? { ra: xy[0], dec: xy[1] } : await resolveName(s).catch(() => null); if (!r) return false;
      openPlace(r.ra, r.dec, xy ? undefined : s); view.z = Math.max(view.z, 6); clampView(); return true;
    },
    context() { ephem(); const k = st.sel, yr = yearAt(st.u), b = bodies.find((q) => q.key === st.body);
      return { date_shown: isLive() ? "today, live" : dayText(yr), picture: st.wave >= 0 ? `SPHEREx at ${LAM[st.wave]?.toFixed(2)} µm` : st.u <= 0.5 ? "2MASS (about 1999)" : st.u <= 2 ? "WISE (2010)" : st.u < 3 ? `SPHEREx as far as it had imaged the sky by ${dayText(yr)}: ${Math.round(prog.pct * 100)}%` : "SPHEREx (2025-26)",
        centre_galactic: [+view.l.toFixed(1), +view.b.toFixed(1)], zoom: +view.z.toFixed(1),
        spherex_survey: cov ? { public_exposures: cov.exposures, first: cov.first, newest: cov.last, note: "every place is revisited about every six months" } : null,
        sun_moon_planets: bodies.map((q) => ({ name: q.name, where_and_how_to_see_it: seen(q), constellation: zodiac(q) || undefined, au_from_earth: +q.dist.toFixed(3), magnitude: +q.mag.toFixed(1) })),
        selected: b ? { name: b.name, kind: b.kind, when_to_see_it: whenSeen(b).when, how: whenSeen(b).eye, constellation: zodiac(b) || undefined, au_from_earth: +b.dist.toFixed(3), light_minutes: +lightMinutes(b).toFixed(1), degrees_from_the_sun: +b.elong.toFixed(0), position_accuracy: "within 10 arcminutes (JPL orbital elements)" }
          : st.place ? { a_place_on_the_sky: hms(st.place.ra, st.place.dec), card: "pictures of this place in about 1999 (2MASS), 2010 (WISE) and at each SPHEREx visit, played as a little film" }
          : k >= 0 && V ? { name: moverName(V, k), kind: KIND_PLAIN[V.kind[k]] ?? V.kind[k], confirmed_mover: true, motion_arcsec_per_year: V.pm[k], years_to_cross_a_full_moon_width: Math.round(1800 / Math.max(V.pm[k], 1e-3)),
            spherex_exposures_checked: V.n[k], arcsec_from_where_the_motion_predicts: V.dp[k], arcsec_from_where_it_would_be_if_still: V.ds[k], distance_note: "not shown on the flat sky map; the 3D map has it when it is known",
            gaia: V.known[k] === 1 ? "Gaia lists the same motion" : V.known[k] === 0 ? "not listed in Gaia (the optical star catalogue); that alone does not say why" : "Gaia lists a source here but not this motion", has_a_database_entry: !!V.simbad[k],
            can_take_part: isOpenCase(V, k), pictures: "three real pictures on a slider: 2MASS about 1999, WISE 2010, and SPHEREx's own, with its measured path" } : null }; },
  };
  sync(); st.raf = requestAnimationFrame(loop);
  return handle;
}
