// MIRA Space: fly through the census in 3D.
// Every point is a real object placed at its measured (Gaia / UltracoolSheet) or AI-inferred distance, moving on its
// measured 3D velocity:  p(t) = p0 + v t  (Galactic heliocentric, pc), evaluated per vertex on the GPU.
// Brightness is physical: apparent magnitude m = M + 5 log10(r) − 5 from the camera, so stars brighten as you approach.
// Data: data/space/core.bin (always), data/space/deep.bin (desktop) written by census/export_space.py.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Bodies, PLANETS, PROBES, AU, radiusRsun, setFadeView } from "./bodies";
import { Exo } from "./exo";
import { Universe } from "./universe";
import { LiveLayer, nasaImages, rockSize, jdOf, craftAt, neoToday, type Live } from "./live";
import { mountPastView } from "./pastview";

const BASE = import.meta.env.BASE_URL;
const PCYR = 1.0227121650537077e-6;        // 1 km/s in pc/yr
const EPOCH = 2025.84;                       // epoch of the star catalogue (SPHEREx)
const NOW_Y = 1970 + Date.now() / (365.25 * 864e5);   // the 3D clock starts at today's date
const DT0 = NOW_Y - EPOCH;                     // stars are propagated from their epoch to today
const LY = 3.261563777;
const T_RANGE = 250000;                      // ± years of straight-line motion offered
const GC = new THREE.Vector3(8178, 0, 0);    // Galactic centre (GRAVITY 2019)
// Galactic -> ICRS (transpose of the ICRS -> Galactic rotation)
const RG = [[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132], [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]];
const CLASSES = ["Main-sequence star", "Giant / evolved star", "Brown dwarf", "Galaxy / quasar"];
const SOURCES = ["–", "Gaia DR3 parallax", "UltracoolSheet parallax", "AI: SPHEREx spectrum + WISE motion", "Gaia DR3 (nearby star)", "Hipparcos parallax (ESA)"];
// What the map says about an object comes from the verified catalogue only (motions confirmed on raw SPHEREx
// exposures). The labels the 3D file was first built with ("vanished", "brightened", survey-level methane) did not
// survive that verification and are no longer read.
const LENS = [{ bit: 2, name: "Methane dip", c: "#c792ff" }, { bit: 4, name: "Unknown to Gaia", c: "#ff5d6c" }, { bit: 8, name: "Cold and red", c: "#e58cff" },
  { bit: 1, name: "Confirmed mover", c: "#ff9d4d" }, { bit: 32, name: "Named", c: "#ffffff" }];
/** the verified catalogue's columns used here (web/public/data/verified/objects.json) */
type Ver = { id: string[]; ra: number[]; dec: number[]; pm: number[]; pmra: number[]; pmdec: number[]; epm: number[]; conf: number[]; known: number[]; gaia: string[]; kind: string[];
  w12: (number | null)[]; methane: number[]; simbad: string[]; yr: number[]; dp: number[]; ds: number[]; n: number[] };
const KIND_PLAIN: Record<string, string> = { "M dwarf": "Red dwarf star", "late M or L dwarf": "Very cool dwarf, at the edge between star and brown dwarf", "K dwarf": "Orange dwarf star", "F/G star": "Sun-like star",
  "white dwarf": "White dwarf: the Earth-sized core a dead star leaves", subdwarf: "Old, metal-poor star from the Galaxy's halo", "L dwarf": "Brown dwarf (type L): too small to shine as a star",
  "T dwarf": "Brown dwarf (type T): cold enough for methane, like Jupiter", "Y dwarf": "Brown dwarf (type Y): the coldest kind", "brown dwarf": "Brown dwarf: too small to shine as a star",
  "methane dwarf": "Methane dwarf: cold enough for methane, like Jupiter", "red: brown dwarf?": "Cold and red: possibly a brown dwarf", "cool dwarf?": "Cool dwarf star, not yet classified", unclassified: "Not yet classified" };
const REPO = (import.meta.env.VITE_MIRA_REPORT_URL as string | undefined) ?? "https://github.com/Mohsinin-Wlad-Sam/assrar-dawla/issues/new";
const VOTES = "mira.votes.v1";
const votes = (): Record<string, { v: string; t: number; name: string }> => { try { return JSON.parse(localStorage.getItem(VOTES) ?? "{}"); } catch { return {}; } };
const CLS_COL = ["#ffe6b8", "#ff9a5a", "#d05cff", "#5cc8ff"];

type Meta = { record: number; core: { file: string; n: number; named: number }; deep: { file: string; n: number }; names: string[];
  counts: { gaia: number; ucs: number; ai: number }; classes: string[] };
type Cat = { n: number; pos: Float32Array; vel: Float32Array; teff: Uint16Array; M: Float32Array; cls: Uint8Array; src: Uint8Array; hasRV: Uint8Array;
  sig: Float32Array; lens: Uint8Array; dflux: Float32Array; tile: Uint16Array; obj: Uint32Array };
export type SpaceOpts = { lowPower: boolean; focus?: string; lab?: boolean; onLab?: () => void; onSky?: (ra: number, dec: number) => void; onDossier?: (id: string) => void;
  /** "put it under the telescope": hand a selected object to the Observe section */
  onObserve?: (t: { ra: number; dec: number; name?: string; pmra?: number; pmdec?: number; epoch?: number }) => void };
/** close(); pause(true/false) suspends rendering while another section of the observatory is in front */
export type SpaceHandle = (() => void) & { pause: (on: boolean) => void; /** fly to an object by name or survey id; false if the map does not hold it */ focus: (nameOrId: string) => boolean };

function parse(buf: ArrayBuffer): Cat {
  const n = Math.floor(buf.byteLength / 32), dv = new DataView(buf);
  const c: Cat = { n, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), teff: new Uint16Array(n), M: new Float32Array(n), cls: new Uint8Array(n),
    src: new Uint8Array(n), hasRV: new Uint8Array(n), sig: new Float32Array(n), lens: new Uint8Array(n), dflux: new Float32Array(n), tile: new Uint16Array(n), obj: new Uint32Array(n) };
  for (let i = 0, o = 0; i < n; i++, o += 32) {
    c.pos[i * 3] = dv.getFloat32(o, true); c.pos[i * 3 + 1] = dv.getFloat32(o + 4, true); c.pos[i * 3 + 2] = dv.getFloat32(o + 8, true);
    for (let k = 0; k < 3; k++) c.vel[i * 3 + k] = dv.getInt16(o + 12 + 2 * k, true) / 10 * PCYR;     // pc/yr
    c.teff[i] = dv.getUint16(o + 18, true); c.M[i] = dv.getInt16(o + 20, true) / 100;
    const f = dv.getUint8(o + 22); c.cls[i] = f & 7; c.src[i] = (f >> 3) & 7; c.hasRV[i] = (f >> 6) & 1;
    c.sig[i] = dv.getUint8(o + 23) / 200; c.lens[i] = dv.getUint8(o + 24); c.dflux[i] = Math.pow(2, (dv.getUint8(o + 25) - 128) / 16);
    c.tile[i] = dv.getUint16(o + 26, true); c.obj[i] = dv.getUint32(o + 28, true);
  }
  return c;
}
function concat(a: Cat, b: Cat): Cat {
  const out: any = { n: a.n + b.n };
  for (const k of Object.keys(a) as (keyof Cat)[]) if (k !== "n") { const A = a[k] as any, B = b[k] as any; const C = new A.constructor(A.length + B.length); C.set(A); C.set(B, A.length); out[k] = C; }
  return out as Cat;
}

// blackbody colour (Tanner Helland fit); below 1000 K the false-colour magenta used across MIRA for methane worlds
function tcol(T: number, out: THREE.Color) {
  if (!T) return out.setRGB(0.85, 0.85, 0.9);
  if (T < 1300) { const f = Math.max(0, (T - 250) / 1050); return out.setRGB(0.55 + 0.35 * f, 0.18 + 0.12 * f, 0.62 - 0.25 * f); }
  const t = T / 100; let r: number, g: number, b: number;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = 255; }
  const cl = (x: number) => Math.min(255, Math.max(0, x)) / 255;
  return out.setRGB(cl(r), cl(g), cl(b));
}
// V − W2 colour vs Teff (main-sequence / ultracool sequence, coarse): turns infrared luminosity into what eyes would see
const VW2: [number, number][] = [[400, 24], [700, 21], [1000, 18], [1300, 15.5], [1700, 12.5], [2200, 9.5], [2700, 7.5], [3100, 6], [3500, 4.4],
  [4000, 3.2], [5000, 2.0], [5800, 1.5], [7000, 0.8], [10000, 0.1], [30000, -0.6]];
function vMinusW2(T: number) {
  if (!T) return 2;
  if (T <= VW2[0][0]) return VW2[0][1];
  for (let i = 1; i < VW2.length; i++) if (T <= VW2[i][0]) { const [x0, y0] = VW2[i - 1], [x1, y1] = VW2[i]; return y0 + (y1 - y0) * (T - x0) / (x1 - x0); }
  return VW2[VW2.length - 1][1];
}

const VERT = `
  attribute vec3 vel; attribute vec3 col; attribute float mag; attribute float vis; attribute float hl;
  uniform float uTime; uniform float uLim; uniform float uPx; uniform float uFloor; uniform float uGlobal;
  varying vec3 vCol; varying float vA; varying float vSpike;
  void main() {
    vec3 p = position + vel * uTime;                                   // straight-line space motion
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float r = max(length(mv.xyz), 1e-6);
    float m = mag + 2.1714724 * log(r) - 5.0;                          // apparent magnitude seen from the camera
    float b = exp(-0.9210340 * (m - uLim));                            // flux relative to the exposure limit
    float s0 = clamp(2.0 * pow(b, 0.22), 1.4, 42.0);
    float a = clamp(pow(b, 0.6) * 4.0 / (s0 * s0), uFloor, 1.0);      // perceived energy (area x opacity) ~ flux^0.6
    gl_Position = projectionMatrix * mv;
    float s = s0 * uPx;
    if (vis < 0.5 || mv.z > 0.0) { s = 0.0; a = 0.0; }
    gl_PointSize = s * (1.0 + hl * 1.5);
    vCol = col; vA = max(a, hl) * uGlobal; vSpike = smoothstep(6.0, 30.0, s);
  }`;
const FRAG = `
  varying vec3 vCol; varying float vA; varying float vSpike;
  void main() {
    vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float core = exp(-r * r * 14.0), halo = exp(-r * 4.5) * 0.35;
    float spikes = vSpike * 0.5 * (exp(-abs(d.x) * 60.0) + exp(-abs(d.y) * 60.0)) * (1.0 - r);
    vec3 c = mix(vCol, vec3(1.0), core * 0.65);
    gl_FragColor = vec4(c * (core + halo + spikes) * vA, 1.0);
  }`;
const LINE_VERT = `
  attribute vec3 vel; uniform float uTime; varying float vA;
  attribute float alpha;
  void main() { vec3 p = position + vel * uTime; vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`;
const LINE_FRAG = `uniform vec3 uCol; varying float vA; void main() { gl_FragColor = vec4(uCol * vA, 1.0); }`;
const SKY_VERT = `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FRAG = `
  uniform sampler2D uTex; uniform float uA; varying vec3 vDir;
  void main() {
    float l = atan(vDir.y, vDir.x); float b = asin(clamp(vDir.z, -1.0, 1.0));
    vec2 uv = vec2(fract(l / 6.2831853 + 1.0), 0.5 + b / 3.1415927);
    gl_FragColor = vec4(texture2D(uTex, uv).rgb * uA, 1.0);
  }`;

function fmtYear(y: number) {
  const r = Math.round(y);
  const f = (x: number) => (x < 10000 ? String(x) : x.toLocaleString());
  return r >= 1 ? `AD ${f(r)}` : `${f(1 - r)} BC`;
}
function fmtSpan(pc: number) {   // human scale for the view size: km for planets, au in the Solar System, ly beyond
  const km = pc / 3.2407792894443654e-14; if (km < 3e6) return `${Math.round(km).toLocaleString()} km`;
  return fmtDist(pc);
}
function fmtDist(pc: number) {
  if (pc < 0.05) return `${(pc * 206265).toFixed(pc * 206265 < 100 ? 1 : 0)} au`;
  const ly = pc * LY;
  return ly < 100 ? `${ly.toFixed(ly < 10 ? 2 : 1)} ly` : ly < 1e5 ? `${Math.round(ly).toLocaleString()} ly` : ly < 1e6 ? `${(ly / 1000).toFixed(0)}k ly`
    : ly < 1e9 ? `${(ly / 1e6).toFixed(ly < 1e7 ? 1 : 0)} million ly` : `${(ly / 1e9).toFixed(1)} billion ly`;
}

export async function openSpace(host: HTMLElement, opts: SpaceOpts): Promise<SpaceHandle> {
  host.innerHTML = `
    <canvas class="sp-canvas"></canvas>
    <div class="sp-labels"></div><div class="sp-ring"></div>
    <button class="icon-btn sp-close" id="spclose" aria-label="Close 3D space">✕</button>
    <div class="sp-head">
      <div class="eyebrow">MIRA · the map</div>
      <h2 class="display">The sky is not still</h2>
      <p class="sp-sub" id="spsub">Loading the 3D catalogue…</p>
    </div>
    <div class="sp-intro" id="spintro" hidden>
      <button class="icon-btn" id="spintrox" aria-label="Hide this introduction">✕</button>
      <b>The sky is not still.</b>
      <p>Every point is a real star at its real distance. The orange ones were caught moving between pictures taken years apart, and each was confirmed on the images of NASA's newest sky survey, SPHEREx. Some are cold worlds no optical telescope can see.</p>
      <div><button class="btn sm solid" id="spintro1">Show me one</button><button class="btn sm ghost" id="spintro2">Two-minute tour</button><button class="btn sm ghost" id="spintro3">Help look at one nobody has named</button></div>
    </div>
    <aside class="sp-ctl" id="spctl">
      <div class="sp-find" id="spfind">
        <div class="eyebrow">Caught moving · confirmed on NASA's SPHEREx images</div>
        <button class="sp-findbtn" data-f="all" title="Show only the objects whose motion was confirmed, coloured by what they are"><b id="spfn1">…</b><span>stars and brown dwarfs on this map</span></button>
        <button class="sp-findbtn" data-f="nogaia" title="Confirmed movers that the Gaia star catalogue does not list with this motion: mostly too cold or too faint for visible light"><b id="spfn2">…</b><span>of them unknown to the Gaia catalogue</span></button>
        <button class="sp-findbtn hl" data-f="help" title="Fly to one that nobody has characterised, look at its pictures and say what you see"><b id="spfn3">…</b><span>nobody has named · help look at one</span></button>
      </div>
      <div class="eyebrow">Zoom out from home</div><div class="sp-dest" id="spdest"></div>
      <div class="sp-row2"><button class="btn sm" id="sptour">▶ Guided tour</button><button class="btn sm ghost" id="spfree" title="Free flight (F)">Free flight</button></div>
      <form id="spsearch" class="sp-search"><input id="spq" list="spnames" placeholder="Fly to: Saturn, Sirius, Voyager 1…" autocomplete="off"><datalist id="spnames"></datalist></form>
      <details class="sp-fold" id="splive"><summary><span class="dotlive"></span>Live from NASA</summary><div id="splivebody" class="mono">loading…</div></details>
      <details class="sp-fold"><summary>More places</summary><div class="sp-dest" id="spdest2"></div></details>
      <details class="sp-fold"><summary>Display</summary>
        <div class="eyebrow">See with</div>
        <div class="seg" id="speyes"><button data-v="ir" class="on">Infrared eyes</button><button data-v="vis">Human eyes</button></div>
        <div class="eyebrow">Colour by</div>
        <div class="seg" id="spcol"><button data-v="lens" class="on">Findings</button><button data-v="temp">Temperature</button><button data-v="cls">Kind</button><button data-v="sig">Certainty</button></div>
        <div class="eyebrow">Show</div><div class="sp-chips" id="spshow"></div>
        <label class="row"><span>Exposure</span><input type="range" id="spexp" min="-6" max="10" step="0.1" value="0"></label>
        <label class="row chk"><input type="checkbox" id="spgrid" checked><span>Distance rings & Galactic centre</span></label>
        <label class="row chk"><input type="checkbox" id="spfig" checked><span>Constellation figures (true 3D)</span></label>
        <label class="row chk"><input type="checkbox" id="spunc"><span>Distance uncertainty (AI ±1σ)</span></label>
        <label class="row"><span>Backdrop</span><select id="spbg"><option value="2mass">Near-IR (2MASS)</option><option value="dss">Visible (DSS)</option><option value="wise">Mid-IR (WISE)</option><option value="none">None</option></select></label>
        <div class="sp-legend" id="splegend"></div>
      </details>
      <button id="splab" hidden></button>
    </aside>
    <div class="sp-time">
      <button class="btn sm play" id="spplay">▶</button>
      <div class="yearbox"><b id="spyear">AD 2026</b><small id="spyl">now · SPHEREx epoch</small></div>
      <div class="tslide"><input type="range" id="spslider" min="${-T_RANGE}" max="${T_RANGE}" step="1" value="0">
        <div class="sp-ticks"><span>−250 kyr</span><span>now</span><span>+250 kyr</span></div></div>
      <select id="spspeed"><option value="0.0027">1 day/s</option><option value="0.0833">1 month/s</option><option value="1">1 yr/s</option><option value="100">100 yr/s</option><option value="1000" selected>1,000 yr/s</option><option value="5000">5,000 yr/s</option><option value="20000">20,000 yr/s</option></select>
      <button class="btn sm ghost" id="spnow">Now</button>
    </div>
    <div class="sp-info" id="spinfo"></div>
    <div class="sp-cap" id="spcap"></div>
    <div class="sp-tip" id="sptip"></div>
    <div class="sp-flyhud" id="spflyhud"><b>FREE FLIGHT</b><span id="spflyspd"></span><small>drag to look · W/S or ▲▼ forward/back · A/D Q/E sideways · scroll = speed · Shift = boost · F or Esc to land</small>
      <div class="flybtns"><button data-k="w">▲</button><button data-k="s">▼</button></div></div>
    <div class="sp-hint" id="sphint">Drag to orbit · scroll or pinch to zoom · click to select, double-click to fly · W A S D / Q E to cruise</div>
    <div class="sp-scale mono" id="spscale"></div>`;
  const $ = (s: string) => host.querySelector(s) as HTMLElement;
  host.classList.add("open");

  // ---------------------------------------------------------------- renderer / scene
  const canvas = $(".sp-canvas") as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  const dpr = Math.min(devicePixelRatio || 1, opts.lowPower ? 1.25 : 2);
  renderer.setPixelRatio(dpr);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 1e-5, 1e7);
  camera.up.set(0, 0, 1);                                  // Galactic north up
  camera.position.set(-18, -26, 9);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.rotateSpeed = 0.6; controls.zoomSpeed = 1.4;
  controls.minDistance = 2e-9; controls.maxDistance = 6e10; controls.target.set(0, 0, 0);
  controls.screenSpacePanning = true;

  // backdrop (the real sky as seen from the Sun: valid while you stay within a few hundred light-years)
  const texLoader = new THREE.TextureLoader();
  const skyMat = new THREE.ShaderMaterial({ uniforms: { uTex: { value: null }, uA: { value: 0.0 } }, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false });
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), skyMat); skyMesh.renderOrder = -10; skyMesh.frustumCulled = false; scene.add(skyMesh);
  const bgCache: Record<string, THREE.Texture> = {};
  function setBackdrop(k: string) {
    if (k === "none") { skyMat.uniforms.uTex.value = null; skyMesh.visible = false; return; }
    skyMesh.visible = true;
    const url = `${BASE}space/mw_${k}_${opts.lowPower ? 2048 : 4096}.jpg`;
    if (bgCache[url]) { skyMat.uniforms.uTex.value = bgCache[url]; return; }
    texLoader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; bgCache[url] = t; skyMat.uniforms.uTex.value = t; });
  }
  setBackdrop("2mass");

  // rings in the Galactic plane + direction to the Galactic centre
  const grid = new THREE.Group(); scene.add(grid);
  const ringRadii = [1, 10, 100, 1000, 10000];
  const ringMats: THREE.LineBasicMaterial[] = [];
  for (const R of ringRadii) {
    const pts: THREE.Vector3[] = []; for (let i = 0; i <= 256; i++) { const a = i / 256 * Math.PI * 2; pts.push(new THREE.Vector3(R * Math.cos(a), R * Math.sin(a), 0)); }
    const m = new THREE.LineBasicMaterial({ color: 0x8fb0ff, transparent: true, opacity: 0.25, depthTest: false, blending: THREE.AdditiveBlending });
    ringMats.push(m); grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), m));
  }
  const gcLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), GC]),
    new THREE.LineDashedMaterial({ color: 0xffc857, dashSize: 0.02, gapSize: 0.02, transparent: true, opacity: 0.55, depthTest: false }));
  gcLine.computeLineDistances(); grid.add(gcLine);
  const bodies = new Bodies(scene);
  const exo = new Exo(scene, dpr);
  const uni = new Universe(scene, opts.lowPower); uni.load();
  let focusIdx = -2;
  const liveL = new LiveLayer(scene, dpr);
  let liveData: Live | null = null;

  // ---------------------------------------------------------------- data
  const meta: Meta | null = await fetch(`${BASE}data/space/meta.json`).then((r) => (r.ok && !(r.headers.get("content-type") ?? "").includes("html") ? r.json() : null)).catch(() => null);
  let cat: Cat | null = null, fbNames: string[] = [];
  if (meta) cat = parse(await (await fetch(`${BASE}data/space/${meta.core.file}`)).arrayBuffer());
  else { cat = await fallbackNeighbours(); fbNames = (cat as any)._names; }
  // the Sun itself (M_W2 = 3.27, Teff 5772 K) — always at the origin of this heliocentric frame
  const sunCat: Cat = { n: 1, pos: new Float32Array(3), vel: new Float32Array(3), teff: new Uint16Array([5772]), M: new Float32Array([3.27]), cls: new Uint8Array([0]), src: new Uint8Array([4]),
    hasRV: new Uint8Array([1]), sig: new Float32Array([0]), lens: new Uint8Array([32]), dflux: new Float32Array([1]), tile: new Uint16Array([65535]), obj: new Uint32Array([999999]) };
  cat = concat(sunCat, cat!);
  // ---- Hipparcos: the bright stars Gaia cannot measure (Sirius A, Vega, α Cen A/B, Betelgeuse…) + constellation figures
  const bright: { stars: { hip: number; name: string; p: number[]; v: number[]; T: number; Mw2: number; d: number; e: number }[]; figures: Record<string, [number, number][]> } | null =
    await fetch(`${BASE}space/bright.json`).then((r) => r.json()).catch(() => null);
  const hipIdx = new Map<number, number>();
  if (bright) {
    const c0 = cat!, keep: typeof bright.stars = [], nm: string[] = meta?.names ?? fbNames;
    const near = (p: number[], i: number) => Math.hypot(c0.pos[i * 3] - p[0], c0.pos[i * 3 + 1] - p[1], c0.pos[i * 3 + 2] - p[2]);
    for (const b of bright.stars) {
      let dup = -1;
      const bd = Math.hypot(b.p[0], b.p[1], b.p[2]);
      for (let i = 1; i < c0.n; i++) { if (c0.tile[i] !== 65535) continue; if (near(b.p, i) < Math.max(0.03, b.d * 0.01)) { dup = i; break; }
        // same direction within an arcminute and distance within 5%: the same system, placed by two different parallaxes
        const gd = Math.hypot(c0.pos[i * 3], c0.pos[i * 3 + 1], c0.pos[i * 3 + 2]); if (!(gd > 0) || Math.abs(gd - bd) > 0.05 * bd) continue;
        const cosang = (c0.pos[i * 3] * b.p[0] + c0.pos[i * 3 + 1] * b.p[1] + c0.pos[i * 3 + 2] * b.p[2]) / (gd * bd); if (cosang > 1 - 4.5e-8) { dup = i; break; } }
      if (dup >= 0 && Math.abs(c0.M[dup] - b.Mw2) < 2.5) { hipIdx.set(b.hip, dup); continue; }        // already in Gaia
      if (dup >= 0 && b.name) { const old = nm[c0.obj[dup]]; if (old === b.name || old?.startsWith(b.name)) nm[c0.obj[dup]] = b.name.replace(/ A$/, "") + " B";    // Gaia caught the faint companion
        // put the bright star at the companion's (more precise) Gaia distance, so the pair sits together as it does in the sky
        const gd = Math.hypot(c0.pos[dup * 3], c0.pos[dup * 3 + 1], c0.pos[dup * 3 + 2]); if (gd > 0 && bd > 0) b.p = b.p.map((x) => (x * gd) / bd); }
      keep.push(b);
    }
    const n = keep.length, bc: Cat = { n, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), teff: new Uint16Array(n), M: new Float32Array(n), cls: new Uint8Array(n),
      src: new Uint8Array(n).fill(5), hasRV: new Uint8Array(n), sig: new Float32Array(n), lens: new Uint8Array(n).fill(32), dflux: new Float32Array(n).fill(1), tile: new Uint16Array(n).fill(65535), obj: new Uint32Array(n) };
    keep.forEach((b, k) => { bc.pos.set(b.p, k * 3); bc.vel.set(b.v.map((x) => x * PCYR), k * 3); bc.teff[k] = b.T; bc.M[k] = b.Mw2; bc.cls[k] = b.Mw2 < -1 ? 1 : 0; bc.sig[k] = b.e;
      bc.obj[k] = nm.length; nm.push(b.name || `HIP ${b.hip}`); hipIdx.set(b.hip, c0.n + k); });
    cat = concat(cat!, bc);
  }
  // Nearby Gaia stars carry a temperature from their colour and a brightness scaled from G. A white dwarf is several
  // magnitudes fainter than a main-sequence star of the same colour (M_G > 10 + 2.6 (BP−RP)); the colour is recovered
  // from the stored temperature. Stars stored without any colour (1000 K, M = 12) have no usable temperature or size.
  const BTc: [number, number][] = [[-0.2, 12000], [0, 9700], [0.3, 7400], [0.6, 6200], [0.8, 5600], [1, 5200], [1.2, 4800], [1.5, 4400], [1.85, 3900], [2.2, 3600], [2.6, 3400], [3, 3200], [3.5, 3000], [4, 2800], [4.6, 2600], [5, 2400]];
  const colourOf = (T: number) => { if (T >= 12000) return -0.2; for (let k = 1; k < BTc.length; k++) if (T >= BTc[k][1]) return BTc[k - 1][0] + ((BTc[k][0] - BTc[k - 1][0]) * (BTc[k - 1][1] - T)) / (BTc[k - 1][1] - BTc[k][1]); return 5; };
  const whiteDwarf = new Set<number>(), noPhot = new Set<number>();
  for (let i = 1; i < cat!.n; i++) { if (cat!.src[i] !== 4 || cat!.tile[i] !== 65535) continue; const T = cat!.teff[i], M = cat!.M[i];
    if (T === 1000 && Math.abs(M - 12) < 0.006) { noPhot.add(i); continue; }
    const col = colourOf(T), MG = M + 0.3 + 1.35 * col; if (T >= 4000 && MG > 10 + 2.6 * col) whiteDwarf.add(i); }
  const names: string[] = meta?.names ?? fbNames;
  const nameOf = (i: number) => (cat!.obj[i] === 999999 && cat!.tile[i] === 65535 ? "Sun" : cat!.tile[i] === 65535 ? names[cat!.obj[i]] ?? "Nearby star" : `Census ${cat!.tile[i]}-${cat!.obj[i]}`);

  const S = { time: 0, playing: false, speed: 1000, eyes: "ir", colorBy: "lens", exp: 0, show: new Set([1, 2, 4, 8, 32, 0, 100, 101, 102, 200, 300]), sel: -1, hover: -1, follow: false,
    body: null as null | { kind: "planet" | "probe" | "craft" | "rock"; k: number }, followFn: null as null | (() => THREE.Vector3),
    free: false, freeSpeed: 1, yaw: 0, pitch: 0 };
  let points: THREE.Points, geom: THREE.BufferGeometry;
  // stars never write depth, but test it: the opaque Sun, planets and resolved stars (drawn first) hide what is behind them
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uLim: { value: 8 }, uPx: { value: dpr }, uFloor: { value: 0.07 }, uGlobal: { value: 1 } } });
  const uncMat = new THREE.ShaderMaterial({ vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(0.55, 0.75, 1.0) } } });
  let unc: THREE.LineSegments | null = null;
  // constellation figures between the stars' true 3D positions: familiar from the Sun, distorted elsewhere
  const figMat = new THREE.ShaderMaterial({ vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(0.55, 0.62, 0.9) } } });
  const figures = new THREE.Group(); scene.add(figures);
  if (bright) {
    const P: number[] = [], V: number[] = [], A: number[] = [];
    for (const segs of Object.values(bright.figures)) for (const [a, b] of segs) {
      const i = hipIdx.get(a), j = hipIdx.get(b); if (i === undefined || j === undefined) continue;
      for (const k of [i, j]) { P.push(cat!.pos[k * 3], cat!.pos[k * 3 + 1], cat!.pos[k * 3 + 2]); V.push(cat!.vel[k * 3], cat!.vel[k * 3 + 1], cat!.vel[k * 3 + 2]); A.push(0.45); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("vel", new THREE.Float32BufferAttribute(V, 3)); g.setAttribute("alpha", new THREE.Float32BufferAttribute(A, 1));
    const ls = new THREE.LineSegments(g, figMat); ls.frustumCulled = false; figures.add(ls);
  }

  // ---- the verified catalogue, joined by object id: which points are confirmed movers, and what is known of them
  let ver: Ver | null = null, vi = new Int32Array(0), todo: number[] = []; const verIdx = new Map<string, number>();
  function applyVerified() {
    const c = cat!; vi = new Int32Array(c.n).fill(-1); todo = []; let nMov = 0, nNoG = 0;
    for (let i = 0; i < c.n; i++) {
      let L = c.lens[i] & 32;                                   // "named" stays; the rest comes from the verified catalogue
      const k = ver && c.tile[i] !== 65535 ? verIdx.get(`${c.tile[i]}-${c.obj[i]}`) : undefined;
      if (ver && k !== undefined) { vi[i] = k; L |= 1; nMov++; if (ver.known[k] !== 1) { L |= 4; nNoG++; } if ((ver.w12[k] ?? -9) > 0.6) L |= 8; if (ver.methane[k]) L |= 2;
        if (ver.known[k] === 0 && !ver.simbad[k]) todo.push(i); }
      c.lens[i] = L;
    }
    const set = (id: string, v: string) => { const e = host.querySelector(id); if (e) e.textContent = v; };
    set("#spfn1", ver ? nMov.toLocaleString() : "…"); set("#spfn2", ver ? nNoG.toLocaleString() : "…"); set("#spfn3", ver ? todo.length.toLocaleString() : "…");
  }
  function build() {
    applyVerified();
    const c = cat!;
    geom?.dispose(); if (points) scene.remove(points);
    geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(c.pos, 3));
    geom.setAttribute("vel", new THREE.BufferAttribute(c.vel, 3));
    geom.setAttribute("col", new THREE.BufferAttribute(new Float32Array(c.n * 3), 3));
    geom.setAttribute("mag", new THREE.BufferAttribute(new Float32Array(c.n), 1));
    geom.setAttribute("vis", new THREE.BufferAttribute(new Float32Array(c.n), 1));
    geom.setAttribute("hl", new THREE.BufferAttribute(new Float32Array(c.n), 1));
    points = new THREE.Points(geom, mat); points.frustumCulled = false; scene.add(points);
    recolor(); remag(); refilter(); buildUnc();
    $("#spsub").innerHTML = meta
      ? `Every point is a real star or brown dwarf at its distance, moving as measured. <b>${(c.n - 1).toLocaleString()}</b> are placed here; the orange ones were caught moving and confirmed on NASA's SPHEREx images. Click one to see it move.`
      : `${(c.n - 1).toLocaleString()} Gaia stars within 65 light-years (the census 3D catalogue is still being computed).`;
  }
  const tmp = new THREE.Color();
  function recolor() {
    const c = cat!, col = geom.getAttribute("col") as THREE.BufferAttribute, a = col.array as Float32Array;
    for (let i = 0; i < c.n; i++) {
      if (S.colorBy === "temp") tcol(c.teff[i], tmp);
      else if (S.colorBy === "cls") tmp.set(CLS_COL[c.cls[i]] ?? "#fff");
      else if (S.colorBy === "lens") { const l = LENS.find((x) => c.lens[i] & x.bit); if (l) tmp.set(l.c); else { tcol(c.teff[i], tmp); tmp.multiplyScalar(0.4); } }
      else { const s = Math.min(1, c.sig[i] / 0.45); tmp.setRGB(0.3 + 0.7 * s, 1 - 0.65 * s, 0.45 - 0.2 * s); if (c.src[i] !== 3) tmp.setRGB(0.55, 0.85, 1); }
      a[i * 3] = tmp.r; a[i * 3 + 1] = tmp.g; a[i * 3 + 2] = tmp.b;
    }
    col.needsUpdate = true; legend();
  }
  function remag() {
    const c = cat!, m = geom.getAttribute("mag") as THREE.BufferAttribute, a = m.array as Float32Array;
    for (let i = 0; i < c.n; i++) a[i] = S.eyes === "ir" ? c.M[i] : c.M[i] + vMinusW2(c.teff[i]);
    m.needsUpdate = true;
  }
  let labMask: Uint8Array | null = null;
  function visible(i: number) {
    const c = cat!, L = c.lens[i];
    if (labMask && !labMask[i]) return false;
    if (!S.show.has(100 + Math.min(2, c.cls[i]))) return false;
    if (L === 0) return S.show.has(0);
    for (const l of LENS) if ((L & l.bit) && S.show.has(l.bit)) return true;
    return false;
  }
  function refilter() {
    const v = geom.getAttribute("vis") as THREE.BufferAttribute, a = v.array as Float32Array;
    for (let i = 0; i < cat!.n; i++) a[i] = visible(i) ? 1 : 0;
    v.needsUpdate = true;
  }
  function buildUnc() {
    if (unc) { scene.remove(unc); unc.geometry.dispose(); unc = null; }
    if (!($("#spunc") as HTMLInputElement).checked) return;
    const c = cat!, idx: number[] = [];
    for (let i = 0; i < c.n; i++) if (c.src[i] === 3 && c.sig[i] > 0.02 && visible(i)) idx.push(i);
    const P = new Float32Array(idx.length * 6), V = new Float32Array(idx.length * 6), A = new Float32Array(idx.length * 2);
    idx.forEach((i, k) => {
      const x = c.pos[i * 3], y = c.pos[i * 3 + 1], z = c.pos[i * 3 + 2], lo = Math.exp(-c.sig[i]), hi = Math.exp(c.sig[i]);
      P.set([x * lo, y * lo, z * lo, x * hi, y * hi, z * hi], k * 6); V.set([c.vel[i * 3], c.vel[i * 3 + 1], c.vel[i * 3 + 2], c.vel[i * 3], c.vel[i * 3 + 1], c.vel[i * 3 + 2]], k * 6);
      A[k * 2] = A[k * 2 + 1] = 0.22;
    });
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("vel", new THREE.BufferAttribute(V, 3)); g.setAttribute("alpha", new THREE.BufferAttribute(A, 1));
    unc = new THREE.LineSegments(g, uncMat); unc.frustumCulled = false; scene.add(unc);
  }
  function legend() {
    const L = $("#splegend");
    if (S.colorBy === "temp") L.innerHTML = `<div class="grad" style="background:linear-gradient(90deg,#b23aa0,#ff6a3c,#ffb46b,#fff3e0,#cfe0ff,#9bb5ff)"></div><div class="lt"><span>500 K</span><span>3,000 K</span><span>6,000 K</span><span>15,000 K</span></div>`;
    else if (S.colorBy === "cls") L.innerHTML = CLASSES.slice(0, 3).map((n, i) => `<span class="lg"><i style="background:${CLS_COL[i]}"></i>${n}</span>`).join("");
    else if (S.colorBy === "lens") L.innerHTML = LENS.map((l) => `<span class="lg"><i style="background:${l.c}"></i>${l.name}</span>`).join("") + `<span class="lg"><i style="background:#5a6070"></i>Other stars (their own colour, dimmed)</span>`;
    else L.innerHTML = `<div class="grad" style="background:linear-gradient(90deg,#8cd9ff,#4dff73,#ffd24d,#ff4d40)"></div><div class="lt"><span>parallax</span><span>AI ±5%</span><span>±20%</span><span>±45%</span></div>`;
  }
  build();
  const epochPos = (i: number) => new THREE.Vector3(cat!.pos[i * 3], cat!.pos[i * 3 + 1], cat!.pos[i * 3 + 2]);
  // ---- live NASA data
  const livePanel = async () => {
    const L = liveData, cm = liveL.cmes, eb = cm.filter((k) => k.toEarth && (Date.now() - k.c.t21) / 1000 * k.c.speed / 1.496e8 < 1.2);
    const neo = await neoToday();
    const up = L ? Math.round((Date.now() - Date.parse(L.updated)) / 60000) : null;
    $("#splivebody").innerHTML = `
      ${L?.sun ? `<button class="lv" data-go="sun"><b>The Sun today</b><span>SDO photo mapped on the Sun</span></button>` : ""}
      ${L?.earth ? `<button class="lv" data-go="earth"><b>Earth today</b><span>EPIC photo, ${L.earth.date.slice(0, 10)}</span></button>` : ""}
      ${L?.spacecraft.length ? `<button class="lv" data-go="craft"><b>${L.spacecraft.length} spacecraft</b><span>positions from JPL Horizons</span></button>` : ""}
      ${L?.asteroids.length ? `<button class="lv" data-go="rock"><b>${L.asteroids.length} asteroids passing Earth</b><span>next 60 days · closest ${(L.asteroids[0].dist_au * 389.17).toFixed(1)}× Moon distance</span></button>` : ""}
      <button class="lv" data-go="cme"><b>${cm.filter((k) => (Date.now() - k.c.t21) / 1000 * k.c.speed / 1.496e8 < 2.5).length} solar storms (CMEs) still inside Mars' orbit</b><span>${cm.length} in the last 10 days · ${eb.length ? `<b style="color:#ff5c6c">${eb.length} heading toward Earth</b>` : "none Earth-bound"} · NASA DONKI</span></button>
      ${neo ? `<div class="lv static"><b>${neo.n} asteroids pass Earth today</b><span>NASA NeoWs${neo.closest ? ` · closest ${neo.closest.name.replace(/[()]/g, "")} at ${neo.closest.ld.toFixed(1)}× Moon distance` : ""}</span></div>` : ""}
      <small>${up !== null ? `spacecraft/asteroids/images refreshed ${up < 90 ? up + " min" : Math.round(up / 60) + " h"} ago` : "static feed not built yet"} · storms live</small>`;
    host.querySelectorAll<HTMLButtonElement>("#splivebody .lv[data-go]").forEach((b) => b.onclick = () => {
      play(false); tweenTime(0, 600); const g = b.dataset.go;
      if (g === "sun") { S.body = null; S.sel = 0; info(0); flyTo(new THREE.Vector3(0, 0, 0), 2.2546e-8 * 4, 0, 3200, bodies.planets[2].pos.clone().normalize().add(new THREE.Vector3(0, 0, 0.25)).normalize()); }   // from Earth's side: the face SDO photographed
      else if (g === "earth") flyToBody({ kind: "planet", k: 2 });
      else if (g === "craft") { S.sel = -1; info(-1); flyTo(new THREE.Vector3(0, 0, 0), 12 * AU, -1, 3000); }
      else if (g === "rock") { const e = bodies.planets[2].pos.clone(); flyTo(e, 0.25 * AU, () => bodies.planets[2].pos.clone(), 3000); liveL.rocks.forEach((k) => (k.orbit.visible = true)); }
      else if (g === "cme") { S.sel = -1; info(-1); flyTo(new THREE.Vector3(0, 0, 0), 3 * AU, -1, 3000); }
    });
  };
  liveL.init().then((L) => { liveData = L;
    const tryFocus = () => {
    if (focusIdx === -2) { setTimeout(tryFocus, 200); return; }     // star lookup not finished yet
    if (opts.focus && focusIdx < 0) {                                 // focus requests by name: planets and live spacecraft
      const pk = PLANETS.findIndex((p) => p.name === opts.focus), ck = liveL.crafts.findIndex((c) => c.c.name === opts.focus);
      if (pk >= 0) setTimeout(() => flyToBody({ kind: "planet", k: pk }), 300); else if (ck >= 0) setTimeout(() => flyToBody({ kind: "craft", k: ck }), 300);
      else if (opts.focus === "Sun") setTimeout(() => flyToStar(0), 300);
    } };
    tryFocus(); if (L) bodies.setLiveTextures(L.sun ? `${BASE}live/${L.sun.hmi}` : null, L.earth ? `${BASE}live/${L.earth.img}` : null); livePanel(); });
  liveL.initCMEs().then(() => livePanel());
  exo.load(`${BASE}space/exoplanets.json`).then((n) => { if (n) { exo.attach(cat!.n, epochPos, () => null); if (S.sel >= 0) info(S.sel); } });
  if (meta && !opts.lowPower && meta.deep.n) {
    fetch(`${BASE}data/space/${meta.deep.file}`).then((r) => r.arrayBuffer()).then((b) => { cat = concat(cat!, parse(b)); build(); if (exo.hosts.length) exo.attach(cat!.n, epochPos, () => null); });
  }

  fetch(`${BASE}data/verified/objects.json`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!j?.cols) return; ver = j.cols as Ver; ver.id.forEach((id, k) => verIdx.set(id, k)); build(); if (S.sel >= 0) info(S.sel); }).catch(() => {});      // a card opened before the catalogue arrived is completed
  // the introduction is shown once per visit and leaves as soon as an object is opened
  const intro = $("#spintro"); let introSeen = false; try { introSeen = sessionStorage.getItem("mira.intro") === "1"; } catch { /* storage off */ }
  const hideIntro = () => { intro.hidden = true; try { sessionStorage.setItem("mira.intro", "1"); } catch { /* storage off */ } };
  intro.hidden = introSeen || !!opts.focus;
  $("#spintrox").onclick = hideIntro;
  $("#spintro1").onclick = () => { hideIntro(); const c = cat!, pool: number[] = [];      // a fast, cold one that Gaia cannot see: the clearest case
    if (ver) for (let i = 0; i < c.n; i++) { const k = vi[i]; if (k >= 0 && ver.known[k] === 0 && ver.pm[k] > 1 && ver.simbad[k]) pool.push(i); }
    const i = pool.length ? pool[Math.floor(Math.random() * pool.length)] : byId("6275-47643"); if (i >= 0) flyToStar(i); };
  $("#spintro2").onclick = () => { hideIntro(); $("#sptour").click(); };
  $("#spintro3").onclick = () => { hideIntro(); (host.querySelector('#spfind [data-f="help"]') as HTMLElement).click(); };
  host.querySelectorAll<HTMLButtonElement>("#spfind .sp-findbtn").forEach((b) => (b.onclick = () => {
    const f = b.dataset.f;
    if (f === "help") { const v = votes(), left = todo.filter((i) => !v[`${cat!.tile[i]}-${cat!.obj[i]}`]), from = left.length ? left : todo; if (from.length) flyToStar(from[Math.floor(Math.random() * from.length)]); return; }
    showOnly(f === "nogaia" ? [4] : [1, 2, 4, 8]); setSeg("#spcol", "lens"); S.sel = -1; info(-1); flyTo(new THREE.Vector3(0, 0, 0), 60, -1, 3000);
  }));
  // ---------------------------------------------------------------- UI wiring
  const showChips: [number, string, string][] = [[1, "Confirmed movers", "#ff9d4d"], [4, "Unknown to Gaia", "#ff5d6c"], [8, "Cold and red", "#e58cff"], [2, "Methane dip", "#c792ff"],
    [32, "Named stars", "#ffffff"], [0, "Field stars", "#8a93a8"], [100, "Dwarfs", CLS_COL[0]], [101, "Giants", CLS_COL[1]], [102, "Brown dwarfs", CLS_COL[2]], [200, "Planet systems (NASA)", "#5be3a6"], [300, "Live: spacecraft, asteroids, solar storms", "#7cc4ff"]];
  $("#spshow").innerHTML = showChips.map(([b, n, c]) => `<button class="chip on" data-b="${b}" style="--c:${c}"><i></i>${n}</button>`).join("");
  host.querySelectorAll<HTMLButtonElement>("#spshow .chip").forEach((el) => el.onclick = () => {
    const b = +el.dataset.b!; S.show.has(b) ? S.show.delete(b) : S.show.add(b); el.classList.toggle("on", S.show.has(b));
    if (b === 200) { exo.setVisible(S.show.has(200)); return; }
    if (b === 300) return;
    refilter(); buildUnc();
  });
  const seg = (id: string, cb: (v: string) => void) => host.querySelectorAll<HTMLButtonElement>(`${id} button`).forEach((b) => b.onclick = () => {
    host.querySelectorAll(`${id} button`).forEach((x) => x.classList.remove("on")); b.classList.add("on"); cb(b.dataset.v!);
  });
  seg("#speyes", (v) => { S.eyes = v; remag(); $("#sphint").textContent = v === "vis" ? "Human eyes: brown dwarfs and dust-hidden stars nearly vanish — infrared is how the census sees them" : "Infrared eyes: brightness as seen at 4.6 µm, where cold worlds glow"; });
  seg("#spcol", (v) => { S.colorBy = v; recolor(); });
  ($("#spexp") as HTMLInputElement).oninput = (e) => { S.exp = +(e.target as HTMLInputElement).value; };
  ($("#spgrid") as HTMLInputElement).onchange = (e) => { grid.visible = (e.target as HTMLInputElement).checked; };
  ($("#spfig") as HTMLInputElement).onchange = (e) => { figures.visible = (e.target as HTMLInputElement).checked; };
  ($("#spunc") as HTMLInputElement).onchange = () => buildUnc();
  ($("#spbg") as HTMLSelectElement).onchange = (e) => setBackdrop((e.target as HTMLSelectElement).value);

  // time
  const slider = $("#spslider") as HTMLInputElement;
  function setTime(t: number, fromSlider = false) {
    S.time = Math.max(-T_RANGE, Math.min(T_RANGE, t)); mat.uniforms.uTime.value = S.time + DT0; uncMat.uniforms.uTime.value = S.time + DT0; figMat.uniforms.uTime.value = S.time + DT0;
    $("#spyear").textContent = Math.abs(S.time) < 2 ? new Date(Date.now() + S.time * 365.25 * 864e5).toISOString().slice(0, 10) : fmtYear(NOW_Y + S.time);
    $("#spyl").textContent = Math.abs(S.time) < 1 / 365 ? "today · live" : Math.abs(S.time) < 2 ? `${S.time > 0 ? "+" : "−"}${Math.round(Math.abs(S.time) * 365.25)} days` : `${S.time > 0 ? "+" : "−"}${Math.abs(Math.round(S.time)).toLocaleString()} yr · straight-line motion`;
    if (!fromSlider) slider.value = String(S.time);
    if (S.sel >= 0) info(S.sel);
  }
  slider.oninput = () => { play(false); setTime(+slider.value, true); };
  ($("#spspeed") as HTMLSelectElement).onchange = (e) => { S.speed = +(e.target as HTMLSelectElement).value; };
  $("#spnow").onclick = () => { play(false); tweenTime(0, 1200); };
  function play(on: boolean) { S.playing = on; $("#spplay").textContent = on ? "❚❚" : "▶"; $("#spplay").classList.toggle("on", on); if (on && S.time >= T_RANGE - 1) setTime(-T_RANGE); }
  $("#spplay").onclick = () => play(!S.playing);
  function tweenTime(to: number, ms: number) {
    const from = S.time, t0 = performance.now();
    const step = (now: number) => { const f = Math.min(1, (now - t0) / ms), e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2; setTime(from + (to - from) * e); if (f < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- positions, picking, fly-to
  const TT = () => S.time + DT0;                // years since the catalogue epoch
  const cur = (i: number, out = new THREE.Vector3()) => { const t = TT(); return out.set(cat!.pos[i * 3] + cat!.vel[i * 3] * t, cat!.pos[i * 3 + 1] + cat!.vel[i * 3 + 1] * t, cat!.pos[i * 3 + 2] + cat!.vel[i * 3 + 2] * t); };
  const pm = new THREE.Matrix4();
  type Body = { kind: "planet" | "probe" | "craft" | "rock"; k: number };
  const FAR = new THREE.Vector3(1e9, 0, 0);
  const bodyPos = (b: Body) => (b.kind === "planet" ? bodies.planets[b.k].pos : b.kind === "probe" ? bodies.probes[b.k] : b.kind === "craft" ? (liveL.crafts[b.k]?.pos ?? FAR) : (liveL.rocks[b.k]?.pos ?? FAR));
  const bodyName = (b: Body) => (b.kind === "planet" ? PLANETS[b.k].name : b.kind === "probe" ? PROBES[b.k].name : b.kind === "craft" ? liveL.crafts[b.k].c.name : liveL.rocks[b.k].r.name);
  function pickBody(px: number, py: number, radius: number): Body | null {
    if (camera.position.length() > 0.05) return null;
    let best: Body | null = null, bd = radius;
    const live = S.show.has(300);
    const list: Body[] = [...PLANETS.map((_, k) => ({ kind: "planet" as const, k })), ...(live && liveL.crafts.length ? [] : PROBES.map((_, k) => ({ kind: "probe" as const, k }))),
      ...(live ? liveL.crafts.map((_, k) => ({ kind: "craft" as const, k })).filter((b) => liveL.crafts[b.k].pos) : []), ...(live ? liveL.rocks.map((_, k) => ({ kind: "rock" as const, k })) : [])];
    for (const b of list) { const [x, y, ok] = project(bodyPos(b)); if (!ok) continue; const d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = b; } }
    return best;
  }
  function pickExo(px: number, py: number, radius: number) {
    if (!exo.hosts.length || !S.show.has(200)) return -1;
    let best = -1, bd = radius; const v = new THREE.Vector3();
    const lim = Math.max(camera.position.distanceTo(controls.target), 0.5) * 2.4;
    exo.hosts.forEach((h, k) => { if (exo.star[k] >= 0) return; v.set(h[1], h[2], h[3]); if (v.distanceTo(camera.position) > lim) return; const [x, y, ok] = project(v); if (!ok) return; const d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = k; } });
    return best;
  }
  function pick(px: number, py: number, radius: number) {
    const c = cat!, W = canvas.clientWidth, Hh = canvas.clientHeight, lim = mat.uniforms.uLim.value, magA = geom.getAttribute("mag").array as Float32Array, vis = geom.getAttribute("vis").array as Float32Array;
    pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); const e = pm.elements;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    let best = -1, bs = -1e9;
    for (let i = 0; i < c.n; i++) {
      if (!vis[i]) continue;
      const t = TT(), x = c.pos[i * 3] + c.vel[i * 3] * t, y = c.pos[i * 3 + 1] + c.vel[i * 3 + 1] * t, z = c.pos[i * 3 + 2] + c.vel[i * 3 + 2] * t;
      const w = e[3] * x + e[7] * y + e[11] * z + e[15]; if (w <= 0) continue;
      const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w * 0.5 + 0.5) * W, sy = (1 - ((e[1] * x + e[5] * y + e[9] * z + e[13]) / w * 0.5 + 0.5)) * Hh;
      const d = Math.hypot(sx - px, sy - py); if (d > radius) continue;
      const r = Math.hypot(x - cx, y - cy, z - cz), m = magA[i] + 5 * Math.log10(Math.max(r, 1e-6)) - 5;
      const score = -(m - lim) * 0.6 - d / radius * 3;           // prefer bright and close to the cursor
      if (score > bs) { bs = score; best = i; }
    }
    return best;
  }
  let fly: { t0: number; dur: number; T0: THREE.Vector3; T1: THREE.Vector3; d0: number; d1: number; dir: THREE.Vector3; bump: number; follow: null | (() => THREE.Vector3) } | null = null;
  function flyTo(target: THREE.Vector3, dist: number, follow: number | null | (() => THREE.Vector3) = -1, dur = 2600, dirOverride?: THREE.Vector3) {
    if (S.free) setFree(false);
    const dir = dirOverride ?? camera.position.clone().sub(controls.target).normalize();
    const d0 = camera.position.distanceTo(controls.target), gap = target.distanceTo(controls.target);
    const fn = typeof follow === "function" ? follow : typeof follow === "number" && follow >= 0 ? () => cur(follow) : null;
    S.followFn = fn; lastFollow = null;
    fly = { t0: performance.now(), dur: gap / Math.max(d0, dist) > 1e4 ? dur * 1.4 : dur, T0: controls.target.clone(), T1: target.clone(), d0, d1: dist, dir, bump: Math.log(Math.max(1, gap / Math.max(d0, dist))) * 0.9, follow: fn };
  }
  let lastFollow: THREE.Vector3 | null = null;
  function flyToStar(i: number, dist?: number) {
    const p = cur(i); const r = p.length(); S.body = null;
    const R = radiusRsun(cat!.teff[i], cat!.M[i], cat!.cls[i]) * 2.2546e-8;
    S.sel = i; info(i); flyTo(p, dist ?? (i === 0 ? 40 * AU : Math.min(Math.max(R * 25, 2e-8), Math.max(0.004, r * 0.05))), i);
  }
  function flyToBody(b: Body) {
    S.sel = -1; S.body = b; bodyInfo(b);
    const r = b.kind === "planet" ? PLANETS[b.k].rkm * 3.2407792894443654e-14 : 0; const p = bodyPos(b).clone();
    // arrive on the sunlit side, three-quarter view
    const toSun = p.clone().normalize().negate(), side = new THREE.Vector3().crossVectors(toSun, new THREE.Vector3(0, 0, 1)).normalize();
    const dir = toSun.multiplyScalar(1).addScaledVector(side, 0.55).add(new THREE.Vector3(0, 0, 0.3)).normalize();
    flyTo(p, b.kind === "planet" ? Math.max(r * (PLANETS[b.k].name === "Saturn" ? 9 : 5), 2e-9) : b.kind === "rock" ? 0.02 * AU : b.kind === "craft" ? 0.05 * AU : 2 * AU, () => bodyPos(b).clone(), 3200, dir);
    if (b.kind === "rock") liveL.rocks.forEach((k, i) => (k.orbit.visible = i === b.k));
  }

  // ---------------------------------------------------------------- info card
  function radec(p: THREE.Vector3) {
    const n = p.clone().normalize(); const x = RG[0][0] * n.x + RG[1][0] * n.y + RG[2][0] * n.z, y = RG[0][1] * n.x + RG[1][1] * n.y + RG[2][1] * n.z, z = RG[0][2] * n.x + RG[1][2] * n.y + RG[2][2] * n.z;
    return [((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360, Math.asin(Math.max(-1, Math.min(1, z))) * 180 / Math.PI];
  }
  const maxA = (k: number) => Math.max(...exo.hosts[k][6].map((p) => (p[3] ?? 0.05))) * AU;
  function planetsHTML(k: number) {
    const h = exo.hosts[k], P = h[6];
    const kind = (r: number | null) => (r === null ? "planet" : r < 1.6 ? "rocky world" : r < 4 ? "mini-Neptune" : r < 8 ? "Neptune-like" : "gas giant");
    const temp = (t: number | null) => (t === null ? "" : t > 1000 ? "lava-hot" : t > 400 ? "hot" : t > 330 ? "warm" : t > 180 ? "temperate" : "cold");
    return `<div class="sp-planets"><div class="eyebrow">${P.length} known planet${P.length > 1 ? "s" : ""} · NASA Exoplanet Archive</div>
      ${P.slice(0, 8).map((p) => `<div class="pl"><b>${p[0]}</b><span>${[kind(p[1]), p[1] ? `${p[1]}× Earth's size` : "", p[2] ? `year = ${p[2] < 2 ? (p[2] * 24).toFixed(0) + " hours" : p[2] < 800 ? p[2].toFixed(1) + " days" : (p[2] / 365.25).toFixed(1) + " yr"}` : "", temp(p[4]) ? `${temp(p[4])} (${p[4]} K)` : "", `found ${p[5]} · ${p[6].toLowerCase()}`].filter(Boolean).join(" · ")}</span></div>`).join("")}
      <button class="btn sm ghost" id="spplanets">Show its planets</button></div>`;
  }
  function exoCard(k: number) {
    const h = exo.hosts[k], el = $("#spinfo"), p = new THREE.Vector3(h[1], h[2], h[3]);
    el.innerHTML = `<button class="icon-btn" id="spiclose">✕</button><div class="eyebrow">Planet host · NASA Exoplanet Archive</div><h3 class="display">${h[0]}</h3>
      <div class="facts"><div class="fact"><b>${fmtDist(p.length())}</b><span>distance</span></div><div class="fact"><b>${h[4] ? h[4].toLocaleString() + " K" : "–"}</b><span>star temperature</span></div></div>
      ${planetsHTML(k)}`;
    el.classList.add("open"); exo.show(k);
    $("#spiclose").onclick = () => { exo.show(-1); info(-1); };
    ($("#spplanets") as HTMLElement).onclick = () => flyTo(p, maxA(k) * 2.6, () => p.clone(), 3000);
  }
  let pastView: { destroy: () => void } | null = null;
  function info(i: number) {
    const c = cat!, el = $("#spinfo");
    pastView?.destroy(); pastView = null; el.classList.remove("ver");
    if (i < 0) { el.classList.remove("open"); if (exo.sysHost >= 0 && exo.star[exo.sysHost] >= 0) exo.show(-1); return; }
    const p0 = new THREE.Vector3(c.pos[i * 3], c.pos[i * 3 + 1], c.pos[i * 3 + 2]), p = cur(i), d0 = p0.length(), d = p.length();
    const v = new THREE.Vector3(c.vel[i * 3], c.vel[i * 3 + 1], c.vel[i * 3 + 2]).divideScalar(PCYR), sp = v.length(), vr = d0 > 0 ? v.dot(p0) / d0 : 0;
    const lens = LENS.filter((l) => c.lens[i] & l.bit && l.bit !== 32).map((l) => `<span style="--c:${l.c}">${l.name}</span>`).join("");
    const isSun = c.obj[i] === 999999 && c.tile[i] === 65535, vk = vi.length > i ? vi[i] : -1, V = vk >= 0 ? ver : null;
    const T = c.teff[i], vid = `${c.tile[i]}-${c.obj[i]}`, isTodo = !!V && V.known[vk] === 0 && !V.simbad[vk];
    if (V) el.classList.add("ver");
    intro.hidden = true;
    const lightLeft = EPOCH - d0 * LY;
    el.innerHTML = `<button class="icon-btn" id="spiclose">✕</button>
      <div class="eyebrow">${V ? KIND_PLAIN[V.kind[vk]] ?? V.kind[vk] : isSun ? "Our star" : whiteDwarf.has(i) ? "White dwarf" : noPhot.has(i) ? "Nearby star" : CLASSES[c.cls[i]]}${c.src[i] === 3 ? " · AI classification" : ""}</div>
      <h3 class="display">${labelText(i)}</h3>
      ${V ? `<p class="sp-lead"><b>${fmtDist(d)}</b> from the Sun. It crosses the width of the full Moon in our sky every <b>${Math.round(1800 / Math.max(V.pm[vk], 1e-3)).toLocaleString()} years</b>${V.known[vk] === 0 ? ", and no optical catalogue lists it" : ""}.</p>` : ""}
      <div class="facts">
        <div class="fact"><b>${isSun ? "0" : fmtDist(d)}</b><span>${Math.abs(S.time) > 1 ? `distance in ${fmtYear(NOW_Y + S.time)}` : "distance now"}${c.sig[i] > 0.005 ? ` · ±${Math.round(c.sig[i] * 100)}%` : ""}</span></div>
        <div class="fact"><b>${noPhot.has(i) || !T ? "–" : whiteDwarf.has(i) && T >= 12000 ? "> 12,000 K" : T.toLocaleString() + " K"}</b><span>${noPhot.has(i) ? "no colour measured by Gaia" : whiteDwarf.has(i) ? "temperature from its colour · about the size of Earth" : `temperature${c.src[i] === 3 ? " (AI)" : ""} · ≈${(() => { const R = isSun ? 1 : radiusRsun(T, c.M[i], c.cls[i]); return R < 0.2 ? (R * 9.73).toFixed(1) + " Jupiters" : R.toFixed(R < 3 ? 2 : 0) + " Suns"; })()} wide`}</span></div>
        <div class="fact"><b>${sp.toFixed(1)} km/s</b><span>speed relative to the Sun${c.hasRV[i] ? "" : " (sky-plane only)"}</span></div>
        <div class="fact"><b>${vr > 0.5 ? "receding" : vr < -0.5 ? "approaching" : "–"}</b><span>${c.hasRV[i] ? `${Math.abs(vr).toFixed(1)} km/s radial (Gaia)` : "no radial velocity"}</span></div>
      </div>
      ${lens ? `<div class="sp-lens">${lens}</div>` : ""}
      ${exo.byStar.has(i) ? planetsHTML(exo.byStar.get(i)!) : ""}
      <p class="why">${isSun ? "Everything here moves relative to the Sun, which sits at the centre of the rings." :
        `${c.src[i] ? `Distance from ${SOURCES[c.src[i]]}.` : ""} ${d0 * LY < 3000 ? `The light reaching SPHEREx in 2025 left it around <b>${fmtYear(lightLeft)}</b>.` : ""}`}</p>
      ${V ? `<div class="sp-ver"><b>Caught moving: ${V.pm[vk].toFixed(2)}″ per year.</b> Checked on ${V.n[vk]} raw SPHEREx exposures: it sits ${V.dp[vk].toFixed(1)}″ from where this motion predicts and ${V.ds[vk].toFixed(1)}″ from where it would be had it stood still. ${V.known[vk] === 1 ? "The Gaia catalogue lists the same motion." : V.known[vk] === 0 ? "The Gaia catalogue has no source here: too cold or too faint for visible light." : "The Gaia catalogue does not list this motion."}</div>
      <div class="sp-pics"><div class="eyebrow">See it move · two real pictures, eleven years apart</div><div id="sppv"></div></div>
      ${isTodo ? `<div class="sp-vote" id="spvote"><b>Take part.</b> Nobody has named or classified this object. Drag the slider above: is there a dot inside the circle in 2010, and does it follow the path?
        <div class="sp-vbtn"><button data-v="moves">Yes, it follows</button><button data-v="unsure">I can't tell</button><button data-v="no">No dot there</button></div><small id="spvmsg"></small></div>` : ""}` : ""}
      <div class="actions">
        ${!isSun && opts.onObserve ? `<button class="btn sm solid" id="spobs" title="Read the SPHEREx exposures of this object and run the instruments on it">Deep analysis in the Lab</button>` : ""}
        <button class="btn sm${!isSun && opts.onObserve ? " ghost" : ""}" id="spfly">Fly here</button>
        ${!isSun ? `<button class="btn sm ghost" id="spback">Look back at the Sun</button>` : ""}
        ${!isSun && opts.onSky ? `<button class="btn sm ghost" id="spsky">Show on sky map</button>` : ""}
        ${c.tile[i] !== 65535 && opts.onDossier ? `<button class="btn sm ghost" id="spdos">Evidence</button>` : ""}
      </div>`;
    el.classList.add("open");
    const vb = el.querySelector("#spvote") as HTMLElement | null;
    if (vb) {
      const msg = el.querySelector("#spvmsg") as HTMLElement;
      const show = () => { const v = votes(), mine = v[vid], seen = todo.filter((q) => v[`${c.tile[q]}-${c.obj[q]}`]).length;
        vb.querySelectorAll<HTMLButtonElement>(".sp-vbtn button").forEach((b) => b.classList.toggle("on", mine?.v === b.dataset.v));
        msg.innerHTML = mine ? `Saved on this device. You have looked at <b>${seen} of ${todo.length}</b>. <button class="link" id="spvnext">Next one</button> · <a class="link" id="spvsend" target="_blank" rel="noopener">Send my answers to the team</a>` : "Your answer stays on this device until you choose to send it.";
        const nx = msg.querySelector("#spvnext") as HTMLElement | null; if (nx) nx.onclick = () => (host.querySelector('#spfind [data-f="help"]') as HTMLElement).click();
        const sd = msg.querySelector("#spvsend") as HTMLAnchorElement | null;
        if (sd) { const L = Object.entries(v).slice(-40).map(([id, q]) => `${id} | ${q.v} | ${q.name}`);
          sd.href = `${REPO}?title=${encodeURIComponent(`Visitor answers on ${L.length} unnamed objects`)}&body=${encodeURIComponent(`Sent from the MIRA map. For each object: does a dot follow the measured path between the 1999 and 2010 pictures?\n\nid | answer | label\n${L.join("\n")}`)}`; } };
      vb.querySelectorAll<HTMLButtonElement>(".sp-vbtn button").forEach((b) => (b.onclick = () => { const v = votes(); v[vid] = { v: b.dataset.v!, t: Date.now(), name: labelText(i) }; try { localStorage.setItem(VOTES, JSON.stringify(v)); } catch { /* private mode: the answer lasts for this page only */ } show(); }));
      show();
    }
    const pvh = el.querySelector("#sppv") as HTMLElement | null;
    if (pvh && V) pastView = mountPastView(pvh, { ra: V.ra[vk], dec: V.dec[vk], pmra: V.pmra[vk], pmdec: V.pmdec[vk], epoch: V.yr[vk] });
    if (exo.sysHost !== (exo.byStar.get(i) ?? -1)) exo.show(exo.byStar.get(i) ?? -1);
    const shp = el.querySelector("#spplanets") as HTMLElement | null; if (shp) shp.onclick = () => { const k = exo.byStar.get(i)!; flyTo(cur(i), maxA(k) * 2.6, i, 3000); };
    $("#spiclose").onclick = () => { S.sel = -1; info(-1); };
    $("#spfly").onclick = () => flyToStar(i);
    const ob = el.querySelector("#spobs") as HTMLElement | null; if (ob) ob.onclick = () => { const [ra, dec] = radec(p0), nm = nameOf(i);
      if (V) opts.onObserve!({ ra: V.ra[vk], dec: V.dec[vk], pmra: V.pmra[vk], pmdec: V.pmdec[vk], epoch: V.yr[vk], name: labelText(i) });
      else opts.onObserve!({ ra, dec, name: nm && !/^(Gaia DR3|HIP) /.test(nm) ? nm : undefined }); };
    const bk = el.querySelector("#spback") as HTMLElement | null;
    if (bk) bk.onclick = () => { const p1 = cur(i); fly = null; flyTo(new THREE.Vector3(0, 0, 0), p1.length() * 1.0004, -1, 2600); setTimeout(() => { controls.target.set(0, 0, 0); camera.position.copy(p1.clone().multiplyScalar(1.0004)); }, 2650); };
    const sk = el.querySelector("#spsky") as HTMLElement | null; if (sk) sk.onclick = () => { const [ra, dec] = radec(cur(i)); opts.onSky!(ra, dec); };
    const ds = el.querySelector("#spdos") as HTMLElement | null; if (ds) ds.onclick = () => opts.onDossier!(`${c.tile[i]}-${c.obj[i]}`);
  }

  function bodyInfo(b: Body) {
    const el = $("#spinfo"), p = bodyPos(b), dSun = p.length() / AU;
    const earth = bodies.planets[2].pos, dEarth = p.distanceTo(earth) / AU, year = NOW_Y + S.time;
    const lightMin = dEarth * 8.317;
    if (b.kind === "craft") {
      const C = liveL.crafts[b.k].c, jd = jdOf(year), p0 = craftAt(C, jd - 0.5), p1 = craftAt(C, jd + 0.5);
      const v = p0 && p1 ? Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) * 149597870.7 / 86400 : null;
      el.innerHTML = `<button class="icon-btn" id="spiclose">✕</button><div class="eyebrow"><span class="dotlive"></span>Live · JPL Horizons</div><h3 class="display">${C.name}</h3>
        <div class="facts"><div class="fact"><b>${dSun < 2 ? (dSun * 149.6).toFixed(1) + " M km" : dSun.toFixed(2) + " au"}</b><span>from the Sun</span></div>
        <div class="fact"><b>${dEarth < 0.1 ? (dEarth * 149.6e6).toLocaleString(undefined, { maximumFractionDigits: 0 }) + " km" : dEarth.toFixed(2) + " au"}</b><span>from Earth</span></div>
        <div class="fact"><b>${v ? v.toFixed(1) + " km/s" : "–"}</b><span>speed around the Sun</span></div>
        <div class="fact"><b>${lightMin < 60 ? lightMin.toFixed(1) + " min" : (lightMin / 60).toFixed(1) + " h"}</b><span>radio signal to Earth</span></div></div>
        <p class="why">Position from NASA JPL's Horizons system for the date on the timeline (tracked ±60 days around today; the blue line is its path).</p>
        <div class="nasaimg" id="spimg"></div>
        <div class="actions"><button class="btn sm" id="spfly">Fly here</button></div>`;
    } else if (b.kind === "rock") {
      const R = liveL.rocks[b.k].r, D = rockSize(R), ld = R.dist_au * 389.17;
      el.innerHTML = `<button class="icon-btn" id="spiclose">✕</button><div class="eyebrow"><span class="dotlive"></span>Live · asteroid passing Earth · JPL</div><h3 class="display">${R.name}</h3>
        <div class="facts"><div class="fact"><b>${R.when.slice(0, 11)}</b><span>closest to Earth</span></div>
        <div class="fact"><b>${ld < 10 ? ld.toFixed(1) : ld.toFixed(0)}× Moon</b><span>distance at closest (${(R.dist_au * 149.6e6).toLocaleString(undefined, { maximumFractionDigits: 0 })} km)</span></div>
        <div class="fact"><b>${R.v_kms.toFixed(1)} km/s</b><span>speed relative to Earth</span></div>
        <div class="fact"><b>${D ? (D < 1 ? Math.round(D * 1000) + " m" : D.toFixed(1) + " km") : "–"}</b><span>size${R.diameter_km ? "" : " (estimated from brightness)"}</span></div></div>
        <p class="why">Its orbit (yellow) comes from JPL's Small-Body Database; its position is computed for the date on the timeline. ${ld < 1 ? "<b>It passes closer than the Moon.</b>" : ""} Drag the timeline a few days either side to watch the flyby.</p>
        <div class="actions"><button class="btn sm" id="spfly">Fly here</button><button class="btn sm ghost" id="spcad">Jump to closest approach</button></div>`;
    } else if (b.kind === "planet") {
      const P = PLANETS[b.k];
      el.innerHTML = `<button class="icon-btn" id="spiclose">✕</button><div class="eyebrow">Planet · orbit from JPL elements</div><h3 class="display">${P.name}</h3>
        <div class="facts"><div class="fact"><b>${dSun.toFixed(2)} au</b><span>from the Sun ${Math.abs(S.time) < 2 ? "on " + new Date(Date.now() + S.time * 365.25 * 864e5).toISOString().slice(0, 10) : "in " + fmtYear(year)}</span></div>
        <div class="fact"><b>${P.name === "Earth" ? "–" : dEarth.toFixed(2) + " au"}</b><span>${P.name === "Earth" ? "home" : `from Earth · light takes ${lightMin < 120 ? lightMin.toFixed(0) + " min" : (lightMin / 60).toFixed(1) + " h"}`}</span></div>
        <div class="fact"><b>${P.period < 2 ? Math.round(P.period * 365.25) + " days" : P.period.toFixed(1) + " yr"}</b><span>one orbit</span></div>
        <div class="fact"><b>${P.rkm.toLocaleString()} km</b><span>radius (Earth 6,371)</span></div></div>
        <p class="why">${P.note[0].toUpperCase() + P.note.slice(1)}. Its position here is computed for the date on the timeline.${Math.abs(S.time) > 3000 ? " <i>(Planet positions are only reliable within a few thousand years of today.)</i>" : ""}</p>
        <div class="actions"><button class="btn sm" id="spfly">Fly here</button></div>`;
    } else {
      const P = PROBES[b.k];
      el.innerHTML = `<button class="icon-btn" id="spiclose">✕</button><div class="eyebrow">Spacecraft · NASA</div><h3 class="display">${P.name}</h3>
        <div class="facts"><div class="fact"><b>${dSun.toFixed(1)} au</b><span>from the Sun ${Math.abs(S.time) < 2 ? "on " + new Date(Date.now() + S.time * 365.25 * 864e5).toISOString().slice(0, 10) : "in " + fmtYear(year)}</span></div>
        <div class="fact"><b>${(lightMin / 60).toFixed(1)} h</b><span>for its radio signal to reach Earth</span></div>
        <div class="fact"><b>${(P.v * 4.74).toFixed(1)} km/s</b><span>outward speed</span></div>
        <div class="fact"><b>${Math.round(268000 / P.v / 1000)}k yr</b><span>to cover the distance to Proxima Centauri</span></div></div>
        <p class="why">${P.note[0].toUpperCase() + P.note.slice(1)}. Even our fastest probe has crossed less than 1/1000 of the way to the nearest star — the dots in this view are that far apart.</p>
        <div class="actions"><button class="btn sm" id="spfly">Fly here</button></div>`;
    }
    if (b.kind === "planet") el.querySelector(".actions")?.insertAdjacentHTML("beforebegin", `<div class="nasaimg" id="spimg"></div>`);
    el.classList.add("open");
    $("#spiclose").onclick = () => { S.body = null; S.followFn = null; info(-1); };
    $("#spfly").onclick = () => flyToBody(b);
    const cad = el.querySelector("#spcad") as HTMLElement | null;
    if (cad && b.kind === "rock") cad.onclick = () => { play(false); tweenTime((liveL.rocks[b.k].r.jd - jdOf(NOW_Y)) / 365.25, 1500); flyToBody(b); };
    const im = el.querySelector("#spimg") as HTMLElement | null;
    if (im) nasaImages(b.kind === "craft" ? liveL.crafts[b.k].c.name.replace("James Webb Space Telescope", "Webb telescope") : bodyName(b) + " planet", 3).then((L) => {
      im.innerHTML = L.length ? `<div class="eyebrow">From NASA's image library</div><div class="thumbs">${L.map((x) => `<a href="${x.href}" target="_blank" rel="noopener" title="${x.title.replace(/"/g, "&quot;")}"><img src="${x.thumb}" alt="" loading="lazy"></a>`).join("")}</div>` : ""; });
  }

  // ---------------------------------------------------------------- destinations
  const named = (n: string) => { for (let i = 0; i < cat!.n; i++) if (cat!.tile[i] === 65535 && nameOf(i) === n) return i; return -1; };
  const approaches: { name: string; t: number; d: number }[] = await fetch(`${BASE}data/neighbors.json`).then((r) => r.json()).then((j) => j.approaches ?? []).catch(() => []);
  const dests: [string, () => void][] = [
    ["Earth", () => { play(false); tweenTime(0, 600); flyToBody({ kind: "planet", k: 2 }); }],
    ["The Solar System", () => { S.sel = -1; S.body = null; info(-1); play(false); tweenTime(0, 800); flyTo(new THREE.Vector3(0, 0, 0), 45 * AU, -1, 3600); }],
    ["The nearest stars", () => { S.sel = -1; S.body = null; info(-1); flyTo(new THREE.Vector3(0, 0, 0), 30); }],
    ["The Milky Way", () => { S.sel = -1; info(-1); play(false); flyTo(new THREE.Vector3(8178, 0, 0), 55000, -1, 4200, new THREE.Vector3(-0.35, -0.25, 0.9).normalize()); }],
    ["Neighbouring galaxies", () => { S.sel = -1; info(-1); flyTo(new THREE.Vector3(-150000, 380000, -190000), 2.6e6, -1, 4500); }],
    ["The cosmic web", () => { S.sel = -1; info(-1); flyTo(new THREE.Vector3(0, 0, 0), 4.5e8, -1, 5000); }],
    ["As far as we can see", () => { S.sel = -1; info(-1); flyTo(new THREE.Vector3(0, 0, 0), 4.2e10, -1, 5500); }],
  ];
  const dests2: [string, () => void][] = [
    ["The Moon", () => { play(false); tweenTime(0, 600); flyMoon(); }],
    ["Saturn and its rings", () => flyToBody({ kind: "planet", k: 5 })],
    ["Jupiter", () => flyToBody({ kind: "planet", k: 4 })],
    ["Voyager 1, edge of the Solar System", () => flyToBody({ kind: "probe", k: 0 })],
    ["The Sun's neighbourhood", () => { S.sel = -1; S.body = null; info(-1); flyTo(new THREE.Vector3(0, 0, 0), 30); }],
    ["Jupiter", () => flyToBody({ kind: "planet", k: 4 })],
    ["Voyager 1, edge of the Solar System", () => flyToBody({ kind: "probe", k: 0 })],
    ["The Sun's neighbourhood", () => { S.sel = -1; S.body = null; info(-1); flyTo(new THREE.Vector3(0, 0, 0), 30); }],
    ["Voyager 1", () => flyToBody({ kind: "probe", k: 0 })],
    ["The Sun's neighbourhood", () => { S.sel = -1; S.body = null; info(-1); flyTo(new THREE.Vector3(0, 0, 0), 30); }],
    ["Barnard's Star", () => { const i = named("Barnard's Star"); if (i >= 0) flyToStar(i, 0.02); }],
    ["Epsilon Indi B", () => { const i = named("Epsilon Indi B"); if (i >= 0) flyToStar(i, 0.02); }],
    ["Above the Galactic disk", () => { S.sel = -1; info(-1); fly = null; flyTo(new THREE.Vector3(0, 0, 0), 2500); setTimeout(() => { if (!fly) { camera.position.set(-300, -300, 2500); } }, 2700); }],
    ["Toward the Galactic centre", () => { S.sel = -1; info(-1); flyTo(new THREE.Vector3(1500, 0, 0), 2200); }],
    ...(approaches[0] ? [[`Closest future flyby: ${approaches[0].name}`, () => {
      const i = named(approaches[0].name); play(false); tweenTime(Math.min(T_RANGE, approaches[0].t - (NOW_Y - 2016)), 2400); flyTo(new THREE.Vector3(0, 0, 0), Math.max(2, approaches[0].d / LY * 3)); if (i >= 0) { S.sel = i; setTimeout(() => info(i), 2500); }
    }] as [string, () => void]] : []),
  ];
  // what you are looking at, at each rung of the ladder (shown for a few seconds on arrival)
  const RUNG_CAPS = [
    "<b>Earth, as it is lit right now.</b> The picture on the globe is today's from NASA's EPIC camera; the Moon is where JPL's ephemeris puts it.",
    "<b>The Solar System today.</b> Planets, spacecraft and passing asteroids at their real positions for this date (JPL Horizons).",
    "<b>The Sun's neighbourhood.</b> Every point is a real star or brown dwarf at its measured distance, as bright as it would look from where you are. Click one to put it under the telescope.",
    "<b>The Milky Way, from outside.</b> No spacecraft has been here: this is a model built from what we measure from within. The dot marked Sun is the whole neighbourhood you just left.",
    "<b>Neighbouring galaxies.</b> The Local Group, at true distances and orientations. Light from Andromeda takes 2.5 million years to arrive.",
    "<b>The cosmic web.</b> 330,000 galaxies with measured redshifts (NASA/IPAC NED), placed with a Planck cosmology: walls, filaments and voids, out to a billion light-years.",
    "<b>As far as we can see.</b> Not the edge of the universe: the edge of sight. Light from beyond this shell has not had time to reach us, and every observer sits at the centre of a shell like it. The pattern is the cosmic microwave background (ESA Planck); the rings mark when the light set out.",
  ];
  let capTok = 0;
  $("#spdest").innerHTML = dests.map(([n], k) => `<button class="rungx" data-k="${k}"><i></i>${n}</button>`).join("");
  host.querySelectorAll<HTMLButtonElement>("#spdest button").forEach((b) => b.onclick = () => { const k = +b.dataset.k!, my = ++capTok; stopTour(); dests[k][1](); cap(RUNG_CAPS[k]); setTimeout(() => { if (my === capTok) cap(""); }, 14000); });
  $("#spdest2").innerHTML = dests2.map(([n], k) => `<button class="btn sm ghost" data-k="${k}">${n}</button>`).join("");
  host.querySelectorAll<HTMLButtonElement>("#spdest2 button").forEach((b) => b.onclick = () => dests2[+b.dataset.k!][1]());

  // ---------------------------------------------------------------- autopilot: a narrated flight using only real data
  let tourId = 0;
  const wait = (ms: number, id: number) => new Promise<boolean>((r) => setTimeout(() => r(id === tourId), ms));
  const cap = (html: string) => { const c = $("#spcap"); c.innerHTML = html; c.classList.toggle("on", !!html); };
  const setSeg = (id: string, v: string) => host.querySelector<HTMLButtonElement>(`${id} button[data-v="${v}"]`)?.click();
  const showOnly = (bits: number[] | null) => host.querySelectorAll<HTMLButtonElement>("#spshow .chip").forEach((el) => {
    const b = +el.dataset.b!; const on = !bits || bits.includes(b) || (b >= 100 && !bits.some((x) => x >= 100)); if (on !== S.show.has(b)) el.click(); });
  async function tour() {
    const id = ++tourId; $("#sptour").textContent = "■ Stop tour"; play(false); setTime(0);
    const steps: [string, () => void, number][] = [
      ["<b>Home.</b> The eight planets on their real orbits for this date. Voyager 1, our most distant probe, has only just left them behind.", () => { S.sel = -1; S.body = null; info(-1); flyTo(new THREE.Vector3(0, 0, 0), 45 * AU, -1, 3500); }, 7500],
      ["<b>The Sun's neighbourhood.</b> Every point is a real star or brown dwarf at its measured distance, coloured by temperature and as bright as it would look from where you are.", () => { S.sel = -1; info(-1); flyTo(new THREE.Vector3(0, 0, 0), 25, -1, 3500); }, 7000],
      ["<b>Barnard's Star</b>, six light-years away, is crossing our sky at 142 km/s. Four small rocky planets, found in 2024–25, circle it. Watch 15,000 years pass — it will come within 3.8 light-years of the Sun.", () => { const i = named("Barnard's Star"); if (i >= 0) { flyToStar(i, 1.2); setTimeout(() => { S.speed = 1500; play(true); }, 3200); } }, 13000],
      ["<b>Cold neighbours.</b> Only brown dwarfs and the confirmed movers that the Gaia catalogue cannot see are shown now: objects too cold to shine in visible light, found because they move.", () => { play(false); setTime(0); S.sel = -1; info(-1); setExp(4); showOnly([2, 4, 8, 32, 102]); setSeg("#spcol", "lens"); flyTo(new THREE.Vector3(0, 0, 0), 45, -1, 3000); }, 9000],
      ["<b>Through human eyes</b> most of them vanish — that is why this census works in the infrared.", () => setSeg("#speyes", "vis"), 5000],
      ["<b>Back to infrared eyes.</b>", () => setSeg("#speyes", "ir"), 2500],
      ["<b>Rising above the Galactic disk.</b> 347,000 objects out to thousands of light-years. Green points were placed by our AI from their SPHEREx spectra; blue by Gaia parallaxes.", () => { setExp(0); showOnly(null); setSeg("#spcol", "sig"); flyTo(new THREE.Vector3(0, 0, 0), 2600, -1, 4500); }, 10000],
      ["<b>Running time forward:</b> 200,000 years of measured motion, straight-line.", () => { S.speed = 20000; setTime(0); play(true); }, 9000],
      ["", () => { play(false); tweenTime(0, 1500); setSeg("#spcol", "temp"); flyTo(new THREE.Vector3(0, 0, 0), 30, -1, 3500); }, 3600],
    ];
    for (const [txt, act, ms] of steps) { if (id !== tourId) return; cap(txt); act(); if (!(await wait(ms, id))) return; }
    stopTour();
  }
  function stopTour() { tourId++; cap(""); $("#sptour").textContent = "▶ Guided tour"; setExp(0); }
  function setExp(v: number) { S.exp = v; ($("#spexp") as HTMLInputElement).value = String(v); }
  $("#sptour").onclick = () => (/Stop/.test($("#sptour").textContent ?? "") ? stopTour() : tour());

  // ---------------------------------------------------------------- lab
  $("#splab").onclick = () => { stopTour(); opts.onLab?.(); };

  // ---------------------------------------------------------------- free flight
  const fwd = new THREE.Vector3();
  function setFree(on: boolean) {
    S.free = on; controls.enabled = !on; $("#spflyhud").classList.toggle("on", on); $("#spfree").classList.toggle("on", on);
    if (on) {
      fly = null; S.followFn = null; stopTour();
      const d = camera.position.distanceTo(controls.target); S.freeSpeed = Math.max(1e-9, d * 0.4);
      camera.getWorldDirection(fwd); S.yaw = Math.atan2(fwd.y, fwd.x); S.pitch = Math.asin(Math.max(-1, Math.min(1, fwd.z)));
    } else {
      camera.getWorldDirection(fwd); controls.target.copy(camera.position).addScaledVector(fwd, Math.max(S.freeSpeed * 2.5, 1e-8)); controls.update();
    }
  }
  function aimCamera() {
    fwd.set(Math.cos(S.pitch) * Math.cos(S.yaw), Math.cos(S.pitch) * Math.sin(S.yaw), Math.sin(S.pitch));
    camera.up.set(0, 0, 1); camera.lookAt(camera.position.clone().add(fwd));
  }
  const fmtSpeed = (pcps: number) => { const c = pcps / 9.7156e-9; const lys = pcps * LY;
    return lys >= 0.1 ? `${lys < 10 ? lys.toFixed(2) : Math.round(lys).toLocaleString()} light-years per second · ${c > 1e6 ? (c / 1e6).toFixed(0) + " million" : Math.round(c).toLocaleString()}× the speed of light` :
      c >= 1 ? `${c < 100 ? c.toFixed(1) : Math.round(c).toLocaleString()}× the speed of light` : `${(pcps / 3.2407792894443654e-14).toLocaleString(undefined, { maximumFractionDigits: 0 })} km per second`; };
  $("#spfree").onclick = () => setFree(!S.free);
  let look: { x: number; y: number } | null = null;
  canvas.addEventListener("pointerdown", (e) => { if (S.free) { look = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); } });
  canvas.addEventListener("pointermove", (e) => { if (!S.free || !look) return; S.yaw -= (e.clientX - look.x) * 0.0035; S.pitch = Math.max(-1.5, Math.min(1.5, S.pitch - (e.clientY - look.y) * 0.0035)); look = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener("pointerup", () => { look = null; });
  canvas.addEventListener("wheel", (e) => { if (!S.free) return; e.preventDefault(); S.freeSpeed *= Math.exp(-e.deltaY * 0.002); S.freeSpeed = Math.min(5e4, Math.max(1e-12, S.freeSpeed)); }, { passive: false });
  host.querySelectorAll<HTMLButtonElement>(".flybtns button").forEach((b) => {
    b.onpointerdown = (e) => { e.preventDefault(); keys.add(b.dataset.k!); }; b.onpointerup = b.onpointerleave = () => keys.delete(b.dataset.k!);
  });

  // ---------------------------------------------------------------- pointer
  let down: { x: number; y: number; t: number } | null = null;
  canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener("pointerup", (e) => {
    if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
    if (moved > 6 || dt > 600) return;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, rad = e.pointerType === "touch" ? 30 : 16;
    const b = pickBody(x, y, rad); if (b) { S.sel = -1; S.body = b; bodyInfo(b); return; }
    const i = pick(x, y, rad);
    if (i >= 0) { S.sel = i; S.body = null; info(i); return; }
    const k = pickExo(x, y, rad); if (k >= 0) { S.sel = -1; S.body = null; exoCard(k); }
  });
  canvas.addEventListener("dblclick", (e) => { const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; const b = pickBody(x, y, 18); if (b) { flyToBody(b); return; } const i = pick(x, y, 18); if (i >= 0) flyToStar(i); });
  let hoverT = 0;
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || e.buttons || performance.now() - hoverT < 90) return; hoverT = performance.now();
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const b = pickBody(x, y, 12); S.hover = b ? -1 : pick(x, y, 12);
    canvas.style.cursor = S.hover >= 0 || b ? "pointer" : "";
    const tip = $("#sptip");
    if (!b && S.hover < 0) { tip.classList.remove("on"); return; }
    let html = "";
    if (b) html = `<b>${b.kind === "planet" ? PLANETS[b.k].name : PROBES[b.k].name}</b><span>${(bodyPos(b).length() / AU).toFixed(1)} au from the Sun</span>`;
    else {
      const i = S.hover, c = cat!, d = cur(i).length();
      html = `<b>${labelText(i)}</b><span>${i === 0 ? "our star" : CLASSES[c.cls[i]].toLowerCase()} · ${c.teff[i] ? c.teff[i].toLocaleString() + " K · " : ""}${fmtDist(d)} from the Sun</span>`;
      if (S.sel >= 0 && S.sel !== i) html += `<span>${fmtDist(cur(i).distanceTo(cur(S.sel)))} from ${labelText(S.sel)}</span>`;
    }
    tip.innerHTML = html; tip.style.transform = `translate(${x + 16}px, ${y + 14}px)`; tip.classList.add("on");
  });
  canvas.addEventListener("pointerleave", () => $("#sptip").classList.remove("on"));
  // keyboard cruise: W/S forward-back, A/D strafe, Q/E down-up; speed scales with how far you are looking
  const keys = new Set<string>();
  let paused = false;
  const kd = (e: KeyboardEvent) => { if (paused || (e.target as HTMLElement).tagName === "INPUT") return; const k = e.key.toLowerCase(); if ("wasdqe".includes(k) && k.length === 1) { keys.add(k); S.followFn = null; } if (e.key === "Shift") keys.add("shift"); };
  const ku = (e: KeyboardEvent) => { keys.delete(e.key.toLowerCase()); if (e.key === "Shift") keys.delete("shift"); };
  addEventListener("keydown", kd); addEventListener("keyup", ku);
  // search
  const flyMoon = () => { S.sel = -1; info(-1); const p = bodies.moonP.clone(), toSun = p.clone().normalize().negate();
    flyTo(p, 1737.4 * 3.2407792894443654e-14 * 5, () => bodies.moonP.clone(), 3200, toSun.add(new THREE.Vector3(0, 0, 0.3)).normalize()); };
  const allNames: [string, () => void][] = [["Sun", () => flyToStar(0)], ["Moon", flyMoon], ...PLANETS.map((p, k) => [p.name, () => flyToBody({ kind: "planet", k })] as [string, () => void]),
    ...PROBES.map((p, k) => [p.name, () => flyToBody({ kind: "probe", k })] as [string, () => void])];
  for (let i = 0; i < cat!.n; i++) if (cat!.tile[i] === 65535 && i > 0) { const nm = nameOf(i); if (!nm.startsWith("Gaia DR3")) allNames.push([nm, () => flyToStar(i)]); }
  ($("#spnames") as HTMLDataListElement).innerHTML = allNames.map(([n]) => `<option value="${n.replace(/"/g, "&quot;")}">`).join("");
  ($("#spsearch") as HTMLFormElement).onsubmit = (e) => {
    e.preventDefault(); const q = ($("#spq") as HTMLInputElement).value.trim().toLowerCase().replace(/\beps\b/, "epsilon"); if (!q) return;
    const hit = allNames.find(([n]) => n.toLowerCase() === q) ?? allNames.find(([n]) => n.toLowerCase().includes(q));
    if (hit) { stopTour(); hit[1](); ($("#spq") as HTMLInputElement).blur(); return; }
    const m = q.match(/^(\d+)-(\d+)$/); if (m) { const i = byId(q); if (i >= 0) { flyToStar(i); return; } }
    const vk2 = ver ? ver.simbad.findIndex((n) => n.toLowerCase().includes(q)) : -1, vi2 = vk2 >= 0 ? byId(ver!.id[vk2]) : -1; if (vi2 >= 0) { stopTour(); flyToStar(vi2); return; }
    $("#sphint").textContent = `No placed object called "${q}"`;
  };
  const onKey = (e: KeyboardEvent) => {
    if (paused || (e.target as HTMLElement).tagName === "INPUT") return;
    if (e.code === "Space") { e.preventDefault(); play(!S.playing); }
    if (e.key === "f" || e.key === "F") setFree(!S.free);
    if (e.key === "Escape") { if (S.free) setFree(false); else close(); }
  };
  addEventListener("keydown", onKey);

  // ---------------------------------------------------------------- labels: progressive, collision-free, fading
  const labelHost = $(".sp-labels"), ring = $(".sp-ring");
  const MAXLAB = opts.lowPower ? 12 : 22;
  const live = new Map<string, HTMLDivElement>();
  const labIdx: number[] = []; for (let i = 0; i < cat!.n; i++) if (cat!.tile[i] === 65535) labIdx.push(i);
  let nearIdx: number[] = [];                                   // nearest census objects to the camera (refreshed every few frames)
  const pv = new THREE.Vector3();
  function project(p: THREE.Vector3): [number, number, boolean] {
    pv.copy(p).project(camera); return [(pv.x * 0.5 + 0.5) * canvas.clientWidth, (1 - (pv.y * 0.5 + 0.5)) * canvas.clientHeight, pv.z < 1 && pv.z > -1];
  }
  function labelText(i: number) {
    const c = cat!; if (c.tile[i] === 65535) return nameOf(i);
    const k = vi.length > i ? vi[i] : -1, nm = k >= 0 && ver ? ver.simbad[k].replace(/^NAME /, "").replace(/ \(.*$/, "") : "";
    if (nm) return nm;
    const L = c.lens[i], kind = L & 2 ? "Methane dwarf" : c.cls[i] === 2 ? "Brown dwarf" : L & 4 ? "Mover unknown to Gaia" : L & 1 ? "Confirmed mover" : c.cls[i] === 1 ? "Giant star" : "Star";
    return `${kind} ${c.tile[i]}-${c.obj[i]}`;
  }
  function scanNear() {
    const c = cat!, cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, vis = geom.getAttribute("vis").array as Float32Array;
    const K = 160, best: [number, number][] = []; let worst = Infinity; const tt = TT();
    for (let i = 1; i < c.n; i++) {
      if (!vis[i]) continue;
      const x = c.pos[i * 3] + c.vel[i * 3] * tt - cx, y = c.pos[i * 3 + 1] + c.vel[i * 3 + 1] * tt - cy, z = c.pos[i * 3 + 2] + c.vel[i * 3 + 2] * tt - cz;
      const d2 = x * x + y * y + z * z;
      if (best.length < K) { best.push([d2, i]); if (best.length === K) { best.sort((a, b) => a[0] - b[0]); worst = best[K - 1][0]; } }
      else if (d2 < worst) { best[K - 1] = [d2, i]; best.sort((a, b) => a[0] - b[0]); worst = best[K - 1][0]; }
    }
    nearIdx = best.map((b) => b[1]);
  }
  let panels: DOMRect[] = [];
  const covered = (x: number, y: number) => panels.some((r) => x + 130 >= r.left && x <= r.right + 4 && y >= r.top - 8 && y <= r.bottom + 8);   // label runs ~130 px right of its star
  function labels() {
    const hr = host.getBoundingClientRect();
    panels = [...host.querySelectorAll<HTMLElement>(".sp-ctl, .sp-info.open, .sp-time, .sp-head")].map((e) => { const r = e.getBoundingClientRect(); return new DOMRect(r.left - hr.left, r.top - hr.top, r.width, r.height); });
    const cand: { key: string; txt: string; x: number; y: number; score: number; dim?: boolean }[] = [];
    const magA = geom.getAttribute("mag").array as Float32Array, lim = mat.uniforms.uLim.value, W = canvas.clientWidth, Hh = canvas.clientHeight;
    const vis = geom.getAttribute("vis").array as Float32Array;
    let nCensus = 0;
    const consider = (i: number, named: boolean) => {
      if (!vis[i] && i !== S.sel) return;
      const p = cur(i, new THREE.Vector3()); const r = p.distanceTo(camera.position); const m = magA[i] + 5 * Math.log10(Math.max(r, 1e-9)) - 5;
      const isSel = i === S.sel || i === S.hover;
      if (!isSel && m > lim - (named ? 0.5 : 3.5)) return;                      // only reasonably bright objects get names
      const txt = labelText(i); if (!isSel && /^(Gaia DR3|HIP) /.test(txt)) return;      // catalogue numbers only on demand
      if (!named && !isSel && (/^(Star|Fast mover|Giant star) /.test(txt) || ++nCensus > 6)) return;   // census ids: only the interesting few
      const [x, y, ok] = project(p); if (!ok || x < 0 || y < 0 || x > W || y > Hh || covered(x, y)) return;
      cand.push({ key: "s" + i, txt, x, y, score: m - (isSel ? 100 : 0) - (named ? 1.5 : 0) });
    };
    for (const i of labIdx) consider(i, true);
    for (const i of nearIdx) if (cat!.tile[i] !== 65535) consider(i, false);
    const camD = camera.position.length();
    if (camD < 0.05) {
      { const [x, y, ok] = project(bodies.moonP), [ex, ey] = project(bodies.planets[2].pos); if (ok && bodies.moon.visible && Math.hypot(x - ex, y - ey) > 14) cand.push({ key: "moon", txt: "Moon", x, y, score: -49 }); }
      PLANETS.forEach((P, k) => { const [x, y, ok] = project(bodies.planets[k].pos); const [sx, sy] = project(new THREE.Vector3());
        if (ok && Math.hypot(x - sx, y - sy) > 14 && x > 0 && y > 0 && x < W && y < Hh) cand.push({ key: "p" + k, txt: P.name, x, y, score: -50 + k * 0.1 }); });
      if (!(S.show.has(300) && liveL.crafts.length)) PROBES.forEach((P, k) => { const [x, y, ok] = project(bodies.probes[k]); if (ok && x > 0 && y > 0 && x < W && y < Hh) cand.push({ key: "v" + k, txt: P.name, x, y, score: -40, dim: true }); });
      if (S.show.has(300)) {
        liveL.crafts.forEach((k, i) => { if (!k.pos) return; const [x, y, ok] = project(k.pos); if (ok && x > 0 && y > 0 && x < W && y < Hh) cand.push({ key: "c" + i, txt: k.c.name, x, y, score: -35, dim: true }); });
        const dE = camera.position.distanceTo(bodies.planets[2].pos);
        if (dE < 0.3 * AU) liveL.rocks.forEach((k, i) => { const [x, y, ok] = project(k.pos); if (ok && x > 0 && y > 0 && x < W && y < Hh) cand.push({ key: "a" + i, txt: k.r.name.replace(/[()]/g, ""), x, y, score: -25 + i * 0.01, dim: true }); });
        liveL.cmes.forEach((k, i) => { if (!k.mesh.visible) return; const d = new THREE.Vector3(0, 1, 0).applyQuaternion(k.mesh.quaternion).multiplyScalar(k.r); const [x, y, ok] = project(d);
          if (ok && x > 0 && y > 0 && x < W && y < Hh) cand.push({ key: "m" + i, txt: `${k.toEarth ? "Earth-bound " : ""}solar storm (CME) · ${Math.round(k.c.speed)} km/s`, x, y, score: -33, dim: !k.toEarth }); });
      }
    }
    if (exo.sysHost >= 0) {
      const h = exo.hosts[exo.sysHost], cs = exo.star[exo.sysHost] >= 0 ? cur(exo.star[exo.sysHost]) : new THREE.Vector3(h[1], h[2], h[3]); const [sx, sy] = project(cs);
      exo.planetPos.forEach((p, k) => { const [x, y, ok] = project(p); if (ok && Math.hypot(x - sx, y - sy) > 16 && x > 0 && y > 0 && x < W && y < Hh) cand.push({ key: "x" + k, txt: h[6][k][0], x, y, score: -45 }); });
    }
    { const sc = Math.max(camera.position.length(), camera.position.distanceTo(controls.target));
      for (const L of uni.labels) { if (sc < L.min || sc > L.max) continue; const [x, y, ok] = project(L.p); if (ok && x > 0 && y > 0 && x < W && y < Hh && !covered(x, y)) cand.push({ key: "u" + L.txt, txt: L.txt, x, y, score: -28, dim: true }); } }
    if (grid.visible && camera.position.distanceTo(controls.target) < 3e4) {
      const [x, y, ok] = project(GC); if (ok) cand.push({ key: "gc", txt: "Galactic centre · 26,700 ly", x, y, score: -30, dim: true });
      ringRadii.forEach((R) => { const d = camera.position.distanceTo(controls.target); if (R < d * 0.08 || R > d * 30) return; const [x2, y2, ok2] = project(new THREE.Vector3(0, -R, 0)); if (ok2) cand.push({ key: "r" + R, txt: fmtDist(R), x: x2, y: y2, score: -20, dim: true }); });
    }
    cand.sort((a, b) => a.score - b.score);
    const placed: { x: number; y: number; w: number }[] = [], keep = new Set<string>();
    for (const c of cand) {
      if (keep.size >= MAXLAB) break;
      const w = c.txt.length * 6.6 + 12;
      if (placed.some((p) => c.x + 9 < p.x + p.w && p.x < c.x + 9 + w && Math.abs(p.y - c.y) < 15)) continue;
      placed.push({ x: c.x + 9, y: c.y, w }); keep.add(c.key);
      let d = live.get(c.key);
      if (!d) { d = document.createElement("div"); d.className = "sp-lab"; labelHost.appendChild(d); live.set(c.key, d); requestAnimationFrame(() => d!.classList.add("on")); }
      d.textContent = c.txt; d.classList.toggle("dim", !!c.dim); d.classList.toggle("sel", c.key === "s" + S.sel);
      d.style.transform = `translate(${(c.x + 9).toFixed(1)}px, ${(c.y - 7).toFixed(1)}px)`;
    }
    for (const [k, d] of live) if (!keep.has(k)) { live.delete(k); d.classList.remove("on"); setTimeout(() => d.remove(), 350); }
    const selP = S.sel >= 0 ? cur(S.sel) : S.body ? bodyPos(S.body) : null;
    if (selP) { const [x, y, ok] = project(selP); ring.style.display = ok ? "" : "none"; ring.style.transform = `translate(${x}px, ${y}px)`; } else ring.style.display = "none";
  }

  // ---------------------------------------------------------------- loop
  let raf = 0, last = performance.now(), frame = 0;
  function resize() {
    const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    mat.uniforms.uPx.value = dpr;
  }
  resize(); const onResize = () => resize(); addEventListener("resize", onResize);
  const camDir = new THREE.Vector3(); let hiddenStar = -1;
  function loop(now: number) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (S.playing) { let t = S.time + S.speed * dt; if (t >= T_RANGE) { t = T_RANGE; play(false); } setTime(t); }
    if (fly) {
      const f = Math.min(1, (now - fly.t0) / fly.dur), e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
      const T1 = fly.follow ? fly.follow() : fly.T1;
      controls.target.lerpVectors(fly.T0, T1, e);
      const d = Math.exp(Math.log(fly.d0) + (Math.log(fly.d1) - Math.log(fly.d0)) * e + fly.bump * Math.sin(Math.PI * e));
      camera.position.copy(controls.target).addScaledVector(fly.dir, d);
      camera.fov = 60 + 14 * Math.sin(Math.PI * e); camera.updateProjectionMatrix();          // a touch of warp
      if (f >= 1) { fly = null; camera.fov = 60; camera.updateProjectionMatrix(); lastFollow = S.followFn ? S.followFn().clone() : null; }
    } else if (S.sel >= 0 && S.playing && !S.followFn) {
      // keep the selected star centred while time runs
      const p = cur(S.sel); camDir.copy(camera.position).sub(controls.target); controls.target.copy(p); camera.position.copy(p).add(camDir);
    }
    // keep following a moving target (planet on its orbit, star while time runs)
    if (!fly && S.followFn) { const p = S.followFn(); if (lastFollow) { const dv = p.clone().sub(lastFollow); controls.target.add(dv); camera.position.add(dv); } lastFollow = p.clone(); }
    if (S.free) {
      aimCamera(); camera.getWorldDirection(fwd);
      const sp = S.freeSpeed * dt * (keys.has("shift") ? 5 : 1), rt = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 0, 1)).normalize(), upv = new THREE.Vector3().crossVectors(rt, fwd);
      if (keys.has("w")) camera.position.addScaledVector(fwd, sp); if (keys.has("s")) camera.position.addScaledVector(fwd, -sp);
      if (keys.has("d")) camera.position.addScaledVector(rt, sp); if (keys.has("a")) camera.position.addScaledVector(rt, -sp);
      if (keys.has("e")) camera.position.addScaledVector(upv, sp); if (keys.has("q")) camera.position.addScaledVector(upv, -sp);
      controls.target.copy(camera.position).addScaledVector(fwd, S.freeSpeed * 2.5);
      if ((frame & 7) === 0) $("#spflyspd").textContent = fmtSpeed(S.freeSpeed * (keys.has("shift") ? 5 : 1));
    } else if (keys.size && !fly) {
      const d0 = camera.position.distanceTo(controls.target), sp = d0 * 1.2 * dt, fw = new THREE.Vector3(); camera.getWorldDirection(fw);
      const rt = new THREE.Vector3().crossVectors(fw, camera.up).normalize(), mv = new THREE.Vector3();
      if (keys.has("w")) mv.addScaledVector(fw, sp); if (keys.has("s")) mv.addScaledVector(fw, -sp);
      if (keys.has("d")) mv.addScaledVector(rt, sp); if (keys.has("a")) mv.addScaledVector(rt, -sp);
      if (keys.has("e")) mv.addScaledVector(camera.up, sp); if (keys.has("q")) mv.addScaledVector(camera.up, -sp);
      camera.position.add(mv); controls.target.add(mv);
    }
    if (!S.free) controls.update();
    const dist = S.free ? S.freeSpeed * 2.5 : camera.position.distanceTo(controls.target);
    const pxPerRad = (canvas.clientHeight / 2) / Math.tan(camera.fov * Math.PI / 360);
    bodies.update(NOW_Y + S.time, camera, pxPerRad, now / 1000, dist);
    gcLine.visible = dist > 0.02;
    setFadeView(dist);
    liveL.update(jdOf(NOW_Y + S.time), camera, Date.now() + S.time * 365.25 * 864e5, S.show.has(300) && camera.position.length() < 0.2);
    exo.setScale(Math.max(dist, 0.5));
    if (exo.sysHost >= 0) { const k = exo.sysHost, h = exo.hosts[k]; exo.update(NOW_Y + S.time, exo.star[k] >= 0 ? cur(exo.star[k]) : new THREE.Vector3(h[1], h[2], h[3]), camera, pxPerRad); }
    if ((frame % 12) === 0) scanNear();
    // the star nearest the camera (or the selected one) becomes a real sphere at its physical radius
    const bi = S.sel > 0 ? S.sel : nearIdx[0] ?? -1;
    let starPx = 0;
    if (bi > 0) { tcol(cat!.teff[bi], tmp); starPx = bodies.setStar(bi, cur(bi), radiusRsun(cat!.teff[bi], cat!.M[bi], cat!.cls[bi]), tmp, cat!.cls[bi] === 2 || cat!.teff[bi] < 2300, camera, pxPerRad, now / 1000); }
    else bodies.setStar(-1, new THREE.Vector3(), 1, tmp, false, camera, pxPerRad, 0);
    // hide the glow-point of bodies drawn as spheres (the Sun up close, the resolved star)
    const vA = geom.getAttribute("vis") as THREE.BufferAttribute, va = vA.array as Float32Array;
    const sunHide = camera.position.length() < 0.002 ? 0 : 1;
    if (va[0] !== sunHide) { va[0] = sunHide; vA.needsUpdate = true; }
    if (starPx > 3 && bi > 0 && va[bi] !== 0) { va[bi] = 0; vA.needsUpdate = true; hiddenStar = bi; }
    if (hiddenStar > 0 && (hiddenStar !== bi || starPx <= 3)) { va[hiddenStar] = visible(hiddenStar) ? 1 : 0; vA.needsUpdate = true; hiddenStar = -1; }
    camera.near = Math.max(1e-13, dist * 1e-3); camera.far = Math.max(1e7, camera.position.length() * 4 + dist * 10); camera.updateProjectionMatrix();
    // auto exposure: sensitivity grows with the scale you are looking at (half the distance-modulus), plus the user's setting
    mat.uniforms.uLim.value = 7.0 + 2.2 * Math.log10(1 + Math.max(dist, 1e-3)) + S.exp;
    mat.uniforms.uFloor.value = dist > 3e4 ? 0.003 : dist > 300 ? 0.012 : 0.03;
    uni.update(camera.position.length(), dist, pxPerRad);
    { const sc = Math.max(camera.position.length(), dist), x = Math.max(0, Math.min(1, (Math.log10(Math.max(sc, 1)) - 3.3) / 1.2));
      mat.uniforms.uGlobal.value = 1 - 0.93 * x; if (exo.points) exo.points.visible = S.show.has(200) && sc < 3000; }                       // the measured census is a small bubble at Galaxy scale
    const hl = geom.getAttribute("hl") as THREE.BufferAttribute;
    if ((frame & 7) === 0) { (hl.array as Float32Array).fill(0); if (S.sel >= 0) (hl.array as Float32Array)[S.sel] = 1; if (S.hover >= 0) (hl.array as Float32Array)[S.hover] = 0.6; hl.needsUpdate = true; }
    skyMesh.position.copy(camera.position); skyMesh.scale.setScalar(camera.far * 0.5);
    skyMat.uniforms.uA.value = Math.max(0, Math.min(0.85, 0.85 * (1 - (camera.position.length() - 150) / 1500)));
    const rf = (R: number) => { const x = Math.log10(R / dist); return Math.max(0, Math.min(0.32, 0.32 - 0.16 * Math.abs(x + 0.3))); };
    ringRadii.forEach((R, k) => { ringMats[k].opacity = rf(R); });
    renderer.render(scene, camera);
    if ((frame++ & 1) === 0) labels();
    if ((frame & 15) === 0) { const nm = uni.scaleName(Math.max(camera.position.length(), dist)), rung = nm === "Solar System" ? (dist < 2e-9 ? 0 : 1) : nm === "Around the Sun" || nm === "Stellar neighbourhood" ? 2 : nm === "Milky Way" ? 3 : nm === "Local Group" ? 4 : nm === "Cosmic web" ? 5 : 6;
      host.querySelectorAll("#spdest .rungx").forEach((b, k) => b.classList.toggle("on", k === rung)); }
    if ((frame & 15) === 0) $("#spscale").innerHTML = `<b>${uni.scaleName(Math.max(camera.position.length(), dist))}</b> · view ≈ ${fmtSpan(2 * dist * Math.tan(camera.fov * Math.PI / 360))} across · camera ${fmtSpan(camera.position.length())} from the Sun`;
  }
  raf = requestAnimationFrame(loop);
  setTime(0);

  // focus request (e.g. from a dossier)
  const byId = (id: string) => { const [t, o] = id.split("-").map(Number); for (let i = 0; i < cat!.n; i++) if (cat!.tile[i] === t && cat!.obj[i] === o) return i; return -1; };
  const fi = opts.focus ? (/^\d+-\d+$/.test(opts.focus) ? byId(opts.focus) : named(opts.focus)) : -1;
  focusIdx = fi;
  if (opts.focus && fi >= 0) setTimeout(() => flyToStar(fi, 0.03), 400);
  else if (opts.focus && !(PLANETS.some((p) => p.name === opts.focus) || opts.focus === "Sun" || liveL.crafts.length === 0 || liveL.crafts.some((c) => c.c.name === opts.focus))) { setTimeout(() => flyTo(new THREE.Vector3(0, 0, 0), 40, -1, 3200), 100); $("#sphint").textContent = "That object has no reliable distance yet, so it is not placed in 3D"; }
  else flyTo(new THREE.Vector3(0, 0, 0), 40, -1, 3200);

  function close() {
    cancelAnimationFrame(raf); removeEventListener("resize", onResize); removeEventListener("keydown", onKey); removeEventListener("keydown", kd); removeEventListener("keyup", ku);
    controls.dispose(); geom.dispose(); mat.dispose(); renderer.dispose(); Object.values(bgCache).forEach((t) => t.dispose());
    host.classList.remove("open"); host.innerHTML = "";
  }
  $("#spclose").onclick = () => { close(); (host as any).onclosed?.(); };
  const handle = close as SpaceHandle;
  handle.focus = (f: string) => { const q = f.trim().toLowerCase(); let i = /^\d+-\d+$/.test(f) ? byId(f) : named(f);
    if (i < 0 && q.length > 2) { const hit = allNames.find(([n]) => n.toLowerCase() === q) ?? allNames.find(([n]) => n.toLowerCase().includes(q)); if (hit) { hit[1](); return true; }
      const k = ver ? ver.simbad.findIndex((n) => n.toLowerCase().includes(q)) : -1; if (k >= 0) i = byId(ver!.id[k]); }
    if (i >= 0) { flyToStar(i, i > 0 && vi[i] >= 0 ? undefined : 0.03); return true; }
    const pk = PLANETS.findIndex((p2) => p2.name === f); if (pk >= 0) { flyToBody({ kind: "planet", k: pk }); return true; } if (f === "Sun") { flyToStar(0); return true; } return false; };
  handle.pause = (on: boolean) => { paused = on; cancelAnimationFrame(raf); keys.clear(); if (!on) { last = performance.now(); resize(); raf = requestAnimationFrame(loop); } };
  return handle;
}

// Before the census 3D catalogue exists: the Gaia neighbours alone (same record semantics)
async function fallbackNeighbours(): Promise<Cat> {
  const j = await (await fetch(`${BASE}data/neighbors.json`)).json();
  const st = j.stars as any[]; const n = st.length;
  const c: Cat = { n, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), teff: new Uint16Array(n), M: new Float32Array(n), cls: new Uint8Array(n), src: new Uint8Array(n).fill(4),
    hasRV: new Uint8Array(n), sig: new Float32Array(n), lens: new Uint8Array(n).fill(32), dflux: new Float32Array(n).fill(1), tile: new Uint16Array(n).fill(65535), obj: new Uint32Array(n) };
  const BT: [number, number][] = [[-0.2, 12000], [0, 9700], [0.3, 7400], [0.6, 6200], [0.8, 5600], [1, 5200], [1.2, 4800], [1.5, 4400], [1.85, 3900], [2.2, 3600], [2.6, 3400], [3, 3200], [3.5, 3000], [4, 2800], [4.6, 2600], [5, 2400]];
  const bt = (x: number) => { if (x <= BT[0][0]) return BT[0][1]; for (let i = 1; i < BT.length; i++) if (x <= BT[i][0]) return BT[i - 1][1] + (BT[i][1] - BT[i - 1][1]) * (x - BT[i - 1][0]) / (BT[i][0] - BT[i - 1][0]); return 2400; };
  const names: string[] = [];
  st.forEach((s, i) => {
    for (let k = 0; k < 3; k++) { c.vel[i * 3 + k] = s[3 + k] / LY; c.pos[i * 3 + k] = s[k] / LY + c.vel[i * 3 + k] * (EPOCH - 2016); }
    const d = Math.hypot(c.pos[i * 3], c.pos[i * 3 + 1], c.pos[i * 3 + 2]);
    c.teff[i] = s[7] !== null ? bt(s[7]) : 1000; c.hasRV[i] = s[8];
    c.M[i] = s[6] !== null && s[7] !== null ? s[6] - 5 * Math.log10(d) + 5 - (0.3 + 1.35 * s[7]) : 12;
    c.cls[i] = c.teff[i] < 2300 ? 2 : 0; c.obj[i] = i; names.push(s[12]);
  });
  (c as any)._names = names;
  return c;
}
