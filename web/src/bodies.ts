// Precise bodies for MIRA Space, in the same Galactic heliocentric frame (parsecs):
//  * the Sun at its true radius, with limb darkening, granulation and a corona glow;
//  * the eight planets on Keplerian orbits from JPL's approximate elements (Standish, valid 1800–2050, usable for
//    centuries), at the date being shown; true radii; Saturn's rings;
//  * Voyager 1 and 2 at their 2025 distances and directions, moving outward at their measured speeds;
//  * stars rendered as spheres at their physical radius (from temperature and luminosity) once you get close.
import * as THREE from "three";

export const AU = 4.84813681109536e-6;            // pc
const KM = 3.2407792894443654e-14;                // pc
const RSUN = 695700 * KM;
const OBL = 23.43928 * Math.PI / 180;
const RG = [[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132], [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]];
const D2R = Math.PI / 180;

// equatorial (ICRS) unit/vector -> Galactic
function eq2gal(x: number, y: number, z: number, out = new THREE.Vector3()) {
  return out.set(RG[0][0] * x + RG[0][1] * y + RG[0][2] * z, RG[1][0] * x + RG[1][1] * y + RG[1][2] * z, RG[2][0] * x + RG[2][1] * y + RG[2][2] * z);
}
export function ecl2gal(x: number, y: number, z: number, out = new THREE.Vector3()) {
  return eq2gal(x, y * Math.cos(OBL) - z * Math.sin(OBL), y * Math.sin(OBL) + z * Math.cos(OBL), out);
}
export function radecToGal(raDeg: number, decDeg: number, out = new THREE.Vector3()) {
  const a = raDeg * D2R, d = decDeg * D2R;
  return eq2gal(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d), out);
}

// a, e, I, L, long.peri, long.node  and rates per Julian century (JPL Standish table 1, J2000 ecliptic)
type El = [number, number, number, number, number, number];
export const PLANETS: { name: string; el: El; rate: El; rkm: number; col: string; period: number; note: string }[] = [
  { name: "Mercury", el: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593], rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081], rkm: 2440, col: "#a8a39d", period: 0.2408, note: "the smallest planet, scorched and airless" },
  { name: "Venus", el: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], rate: [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418], rkm: 6052, col: "#e8cf9a", period: 0.6152, note: "wrapped in sulphuric-acid clouds; hottest planet" },
  { name: "Earth", el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0], rkm: 6371, col: "#5f8fe0", period: 1.0, note: "you are here" },
  { name: "Mars", el: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891], rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343], rkm: 3390, col: "#c8643c", period: 1.8809, note: "the red planet" },
  { name: "Jupiter", el: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106], rkm: 69911, col: "#d8b48a", period: 11.862, note: "gas giant — a failed star 80× too light to be a brown dwarf" },
  { name: "Saturn", el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], rate: [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794], rkm: 58232, col: "#e3cf9a", period: 29.457, note: "ringed gas giant" },
  { name: "Uranus", el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503], rate: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589], rkm: 25362, col: "#a6d8e0", period: 84.011, note: "ice giant tipped on its side; its blue comes from methane — like the brown dwarfs" },
  { name: "Neptune", el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], rate: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664], rkm: 24622, col: "#4f73d8", period: 164.79, note: "outermost planet; methane-blue ice giant" },
];
// JPL Horizons tracks (heliocentric ecliptic J2000, au) installed from the live feed: used inside their time window
type Track = [number, number, number, number][];
const EPH: { planets: Record<number, Track>; earthH?: Track; moonH?: Track } = { planets: {} };
export function setEphemeris(planets: Record<string, Track> | undefined, earthH?: Track, moonH?: Track) {
  for (const [k, v] of Object.entries(planets ?? {})) EPH.planets[+k] = v;
  EPH.earthH = earthH; EPH.moonH = moonH;
}
export function trackAt(T: Track | undefined, jd: number): [number, number, number] | null {
  if (!T || T.length < 2 || jd < T[0][0] || jd > T[T.length - 1][0]) return null;
  const step = T[1][0] - T[0][0]; let i = Math.min(T.length - 2, Math.max(0, Math.floor((jd - T[0][0]) / step)));
  while (i > 0 && T[i][0] > jd) i--;
  while (i < T.length - 2 && T[i + 1][0] < jd) i++;
  const f = (jd - T[i][0]) / (T[i + 1][0] - T[i][0]);
  return [T[i][1] + (T[i + 1][1] - T[i][1]) * f, T[i][2] + (T[i + 1][2] - T[i][2]) * f, T[i][3] + (T[i + 1][3] - T[i][3]) * f];
}
export const jdOfYear = (y: number) => 2451545.0 + (y - 2000.0) * 365.25;
/** Moon, heliocentric (pc), from the Horizons hourly track; null outside its window */
export function moonPos(year: number, out = new THREE.Vector3()) {
  const p = trackAt(EPH.moonH, jdOfYear(year));
  return p ? ecl2gal(p[0] * AU, p[1] * AU, p[2] * AU, out) : null;
}
/** heliocentric Galactic position (pc) of planet k at decimal year y: JPL Horizons inside the live window, Keplerian elements outside */
export function planetPos(k: number, year: number, out = new THREE.Vector3(), meanAnomOffset = 0) {
  if (!meanAnomOffset) {
    const jd = jdOfYear(year), p = (k === 2 ? trackAt(EPH.earthH, jd) : null) ?? trackAt(EPH.planets[k], jd);
    if (p) return ecl2gal(p[0] * AU, p[1] * AU, p[2] * AU, out);
  }
  const p = PLANETS[k], T = (year - 2000.0) / 100;
  const [a, e, I, L, wb, O] = p.el.map((v, i) => v + p.rate[i] * T) as El;
  const w = (wb - O) * D2R, Om = O * D2R, inc = I * D2R;
  let M = ((L - wb + meanAnomOffset) % 360) * D2R;
  let E = M + e * Math.sin(M); for (let i = 0; i < 6; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Om), sO = Math.sin(Om), cI = Math.cos(inc), sI = Math.sin(inc);
  const x = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
  const y = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
  const z = (sw * sI) * xp + (cw * sI) * yp;
  return ecl2gal(x * AU, y * AU, z * AU, out);
}
// Voyagers (NASA JPL, late 2025): distance au, RA/Dec of the direction, outward speed au/yr
export const PROBES = [{ name: "Voyager 1", au: 169.5, ra: 258.5, dec: 12.05, v: 3.57, note: "launched 1977; the most distant human-made object, in interstellar space since 2012" },
  { name: "Voyager 2", au: 141.5, ra: 301.8, dec: -60.5, v: 3.24, note: "launched 1977; crossed into interstellar space in 2018" }];
export function probePos(k: number, year: number, out = new THREE.Vector3()) {
  const p = PROBES[k]; return radecToGal(p.ra, p.dec, out).multiplyScalar(Math.max(0, p.au + p.v * (year - 2025.84)) * AU);
}

// ---------------------------------------------------------------- surface shader (stars, Sun, brown dwarfs)
const NOISE = `
  vec3 hash3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6))); return fract(sin(p)*43758.5453)*2.0-1.0; }
  float noise(vec3 p){ vec3 i=floor(p), f=fract(p); vec3 u=f*f*(3.0-2.0*f);
    return mix(mix(mix(dot(hash3(i),f), dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x), mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)), dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
               mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)), dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x), mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)), dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z); }
  float fbm(vec3 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }`;
const SURF_VERT = `varying vec3 vN; varying vec3 vP; varying vec3 vV;
  void main(){ vN = normalize(normalMatrix * normal); vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const SURF_FRAG = `uniform vec3 uCol; uniform float uTime; uniform float uBands; uniform float uSeed; varying vec3 vN; varying vec3 vP; varying vec3 vV;
  uniform sampler2D uDisc; uniform float uUseDisc; uniform vec3 uObs; uniform vec3 uNorth; uniform float uDiscR;
  ${NOISE}
  void main(){
    if (uUseDisc > 0.5) {                                    // a real photo of the visible hemisphere (e.g. SDO today)
      vec3 n = normalize(vP); float f = dot(n, uObs);
      if (f > 0.0) { vec3 e1 = normalize(cross(uNorth, uObs)); vec3 e2 = cross(uObs, e1);
        vec2 uv = vec2(0.5 + uDiscR * dot(n, e1), 0.5 + uDiscR * dot(n, e2));
        vec3 img = texture2D(uDisc, uv).rgb; float edge = smoothstep(0.0, 0.08, f);
        vec3 proc = uCol * (0.35 + 0.65 * pow(f, 0.55)) * (0.85 + 0.3 * fbm(n * 18.0 + uTime * 0.05));
        gl_FragColor = vec4(mix(proc, img, edge), 1.0); return; }
    }
    float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
    vec3 p = normalize(vP) * 3.0 + uSeed;
    float limb = 0.35 + 0.65 * pow(mu, 0.55);                        // limb darkening
    float gran = 0.85 + 0.3 * fbm(p * 6.0 + uTime * 0.05);          // granulation
    float spot = smoothstep(0.55, 0.75, fbm(p * 1.4 + 7.0));          // starspots
    vec3 c = uCol * limb * gran * (1.0 - 0.55 * spot);
    if (uBands > 0.5) {                                                // brown dwarf: cloud bands like Jupiter, glowing deep red
      float lat = normalize(vP).z; float b = sin(lat * 14.0 + fbm(p * 2.0) * 3.0);
      c = uCol * (0.55 + 0.35 * b) * (0.4 + 0.6 * pow(mu, 0.8));
    }
    gl_FragColor = vec4(c, 1.0);
  }`;
// planets: lit by the Sun at the origin (day/night terminator), gas giants with cloud bands
const PLANET_VERT = `varying vec3 vNw; varying vec3 vPw; varying vec3 vP;
  void main(){ vNw = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vPw = w.xyz; vP = position; gl_Position = projectionMatrix * viewMatrix * w; }`;
// Surface maps (NASA) are sampled in each body's own frame: pole uP, prime meridian uM, 90°E uE (IAU WGCCRE 2015
// rotation elements, evaluated for the shown date) -> the right face of Earth, Mars, Jupiter… points at the Sun.
const PLANET_FRAG = `uniform vec3 uCol; uniform float uBands; uniform float uSeed; varying vec3 vNw; varying vec3 vPw; varying vec3 vP;
  uniform sampler2D uDisc; uniform float uUseDisc; uniform vec3 uObs; uniform vec3 uNorth; uniform float uDiscR;
  uniform sampler2D uTex; uniform float uHasTex; uniform sampler2D uNight; uniform float uHasNight;
  uniform vec3 uP; uniform vec3 uM; uniform vec3 uE; uniform vec3 uAtmo;
  ${NOISE}
  void main(){
    vec3 L = normalize(-vPw);                                   // the Sun is at the origin of this frame
    vec3 N = normalize(vNw), V = normalize(cameraPosition - vPw);
    float mu = dot(N, L), diff = max(mu, 0.0);
    vec3 n = normalize(vP);
    float lat = asin(clamp(dot(n, uP), -1.0, 1.0)), lon = atan(dot(n, uE), dot(n, uM));
    vec2 uv = vec2(0.5 + lon / 6.2831853, 0.5 + lat / 3.1415927);
    vec3 c;
    if (uHasTex > 0.5) c = texture2D(uTex, uv).rgb;
    else { c = uCol * (0.9 + 0.15 * fbm(n * 6.0 + uSeed));
      if (uBands > 0.5) { float b = sin(lat * 20.0 + fbm(n * 3.0 + uSeed) * 1.5); c = uCol * (0.9 + 0.1 * b); } }
    vec3 col = c * (0.015 + 0.985 * diff);
    if (uUseDisc > 0.5) {                                       // today's EPIC photo on the side DSCOVR sees (Earth -> Sun)
      float f = dot(n, uObs);
      if (f > 0.0) { vec3 e1 = normalize(cross(uNorth, uObs)); vec3 e2 = cross(uObs, e1);
        vec3 img = texture2D(uDisc, vec2(0.5 + uDiscR * dot(n, e1), 0.5 + uDiscR * dot(n, e2))).rgb;
        col = mix(col, img, 0.85 * smoothstep(0.05, 0.25, f) * smoothstep(-0.05, 0.2, mu)); }
    }
    if (uHasNight > 0.5) col += texture2D(uNight, uv).rgb * smoothstep(0.08, -0.12, mu) * 0.9;   // city lights on the night side
    if (uAtmo.r + uAtmo.g + uAtmo.b > 0.0) { float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0); col += uAtmo * rim * smoothstep(-0.25, 0.3, mu); }
    gl_FragColor = vec4(col, 1.0);
  }`;
// Saturn's rings: radial optical-depth profile at the measured radii (km): C, B, Cassini Division, A with Encke Gap, F
const RING_VERT = `varying vec3 vPos; varying vec3 vW; void main(){ vPos = position; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const RING_FRAG = `uniform float uKm; varying vec3 vPos; varying vec3 vW;
  float band(float r, float a, float b){ return step(a, r) * step(r, b); }
  void main(){
    float r = length(vPos.xy) / uKm;
    float tau = 0.08 * band(r, 74658.0, 92000.0) + 0.9 * band(r, 92000.0, 117580.0) + 0.06 * band(r, 117580.0, 122170.0)
              + 0.55 * band(r, 122170.0, 133409.0) + 0.5 * band(r, 133745.0, 136775.0) + 0.35 * band(r, 140130.0, 140230.0);
    tau *= 0.85 + 0.15 * sin(r * 0.004) * sin(r * 0.0011);       // fine ringlet structure
    if (tau < 0.01) discard;
    vec3 c = mix(vec3(0.72, 0.66, 0.55), vec3(0.93, 0.87, 0.74), smoothstep(92000.0, 117000.0, r));
    gl_FragColor = vec4(c, tau);
  }`;
// IAU WGCCRE 2015 rotation elements: [α0, dα/dT, δ0, dδ/dT, W0, dW/dd]  (T centuries, d days from J2000)
const IAU: number[][] = [[281.0103, -0.0328, 61.4155, -0.0049, 329.5988, 6.1385108], [272.76, 0, 67.16, 0, 160.20, -1.4813688], [0, -0.641, 90, -0.557, 190.147, 360.9856235],
  [317.269202, -0.10927547, 54.432516, -0.05827105, 176.049863, 350.891982443297], [268.056595, -0.006499, 64.495303, 0.002413, 284.95, 870.536],
  [40.589, -0.036, 83.537, -0.004, 38.90, 810.7939024], [257.311, 0, -15.175, 0, 203.81, -501.1600928], [299.36, 0, 43.46, 0, 249.978, 541.1397757],
  [269.9949, 0.0031, 66.5392, 0.0130, 38.3213, 13.17635815]];   // last row: Moon
/** body-fixed axes (Galactic frame) at JD: pole P, prime meridian M, 90°E E */
export function iauFrame(k: number, jd: number) {
  const [a0, a1, d0, d1, w0, w1] = IAU[k], d = jd - 2451545.0, T = d / 36525;
  const al = (a0 + a1 * T) * D2R, de = (d0 + d1 * T) * D2R, W = ((w0 + w1 * d) % 360) * D2R;
  const P = new THREE.Vector3(Math.cos(de) * Math.cos(al), Math.cos(de) * Math.sin(al), Math.sin(de));
  const Nd = new THREE.Vector3(Math.cos(al + Math.PI / 2), Math.sin(al + Math.PI / 2), 0);       // ascending node of the body's equator on the ICRF equator
  const PxN = new THREE.Vector3().crossVectors(P, Nd);
  const M = Nd.clone().multiplyScalar(Math.cos(W)).addScaledVector(PxN, Math.sin(W));
  const E = new THREE.Vector3().crossVectors(P, M);
  return { P: eq2gal(P.x, P.y, P.z), M: eq2gal(M.x, M.y, M.z), E: eq2gal(E.x, E.y, E.z) };
}
const GLOW_FRAG = `uniform vec3 uCol; varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 2.0; float g = pow(max(0.0, 1.0 - r), 3.0); gl_FragColor = vec4(uCol * g, 1.0); }`;
const GLOW_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

// bodies are drawn after the star points without depth testing: a convex sphere needs none, and it must hide the stars behind it
function surface(col: THREE.Color, bands: boolean, seed: number) {
  return new THREE.ShaderMaterial({ vertexShader: SURF_VERT, fragmentShader: SURF_FRAG, depthTest: true, depthWrite: true, uniforms: { uCol: { value: col.clone() }, uTime: { value: 0 }, uBands: { value: bands ? 1 : 0 }, uSeed: { value: seed },
    uDisc: { value: null }, uUseDisc: { value: 0 }, uObs: { value: new THREE.Vector3(1, 0, 0) }, uNorth: { value: new THREE.Vector3(0, 0, 1) }, uDiscR: { value: 0.468 } } });
}
function planetMat(col: string, bands: boolean, seed: number) {
  // planets and rings use the depth buffer (stars never write it), so a ring correctly passes behind its planet
  return new THREE.ShaderMaterial({ vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG, depthTest: true, depthWrite: true, uniforms: { uCol: { value: new THREE.Color(col) }, uBands: { value: bands ? 1 : 0 }, uSeed: { value: seed },
    uDisc: { value: null }, uUseDisc: { value: 0 }, uObs: { value: new THREE.Vector3(1, 0, 0) }, uNorth: { value: new THREE.Vector3(0, 0, 1) }, uDiscR: { value: 0.40 },
    uTex: { value: null }, uHasTex: { value: 0 }, uNight: { value: null }, uHasNight: { value: 0 },
    uP: { value: new THREE.Vector3(0, 0, 1) }, uM: { value: new THREE.Vector3(1, 0, 0) }, uE: { value: new THREE.Vector3(0, 1, 0) }, uAtmo: { value: new THREE.Color(0, 0, 0) } } });
}
// NASA texture maps (public domain): NASA 3D Resources (Mars, Jupiter, Saturn, Neptune), GIBS Blue Marble + VIIRS Black Marble (Earth), SVS CGI Moon Kit (Moon)
const TEX: Record<string, string> = { Earth: "earth.jpg", Mars: "mars.jpg", Jupiter: "jupiter.jpg", Saturn: "saturn.jpg", Neptune: "neptune.jpg", Moon: "moon.jpg" };
function loadTex(mat: THREE.ShaderMaterial, file: string, slot: "uTex" | "uNight") {
  new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}space/tex/${file}`, (t) => {
    t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.wrapS = THREE.RepeatWrapping;   // no mip seam at lon ±180
    mat.uniforms[slot].value = t; mat.uniforms[slot === "uTex" ? "uHasTex" : "uHasNight"].value = 1;
  });
}
function glow(col: THREE.Color) {
  const m = new THREE.ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: { uCol: { value: col.clone() } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
  const s = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m); s.renderOrder = 12; return s;
}

// bolometric correction M_bol − M_W2 vs Teff (coarse, main sequence + ultracool) -> luminosity -> radius (Stefan–Boltzmann)
const BCW2: [number, number][] = [[600, 3.8], [1000, 3.5], [1500, 3.0], [2000, 2.6], [2600, 2.9], [3000, 3.0], [3500, 2.8], [4000, 2.5], [5000, 1.9], [5772, 1.47], [7000, 0.9], [9000, 0.1], [15000, -0.9], [30000, -2.5]];
export function radiusRsun(T: number, Mw2: number, cls: number) {
  if (!T) return 1;
  let bc = BCW2[BCW2.length - 1][1];
  if (T <= BCW2[0][0]) bc = BCW2[0][1]; else for (let i = 1; i < BCW2.length; i++) if (T <= BCW2[i][0]) { const [x0, y0] = BCW2[i - 1], [x1, y1] = BCW2[i]; bc = y0 + (y1 - y0) * (T - x0) / (x1 - x0); break; }
  const L = Math.pow(10, -0.4 * (Mw2 + bc - 4.74));
  let R = Math.sqrt(L) / Math.pow(T / 5772, 2);
  if (cls === 2 || T < 2300) R = Math.min(Math.max(R, 0.08), 0.16);             // brown dwarfs are all about Jupiter-sized
  return Math.min(1500, Math.max(0.05, R));
}

// line material that fades out close to the camera, relative to the viewing distance
const FADE_VERT = `uniform float uView; varying float vF; void main(){ vec4 w = modelMatrix * vec4(position,1.0); float d = distance(w.xyz, cameraPosition);
  vF = smoothstep(0.15 * uView, 0.7 * uView, d); gl_Position = projectionMatrix * viewMatrix * w; }`;
const FADE_FRAG = `uniform vec3 uCol; uniform float opacity; varying float vF; void main(){ gl_FragColor = vec4(uCol * opacity * vF, 1.0); }`;
export const fadeMats: THREE.ShaderMaterial[] = [];
export function fadeLineMat(col: number, opacity: number) {
  const m = new THREE.ShaderMaterial({ vertexShader: FADE_VERT, fragmentShader: FADE_FRAG, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    uniforms: { uCol: { value: new THREE.Color(col) }, opacity: { value: opacity }, uView: { value: 1 } } });
  Object.defineProperty(m, "opacity", { get: () => m.uniforms.opacity.value, set: (v: number) => { if (m.uniforms) m.uniforms.opacity.value = v; } });
  fadeMats.push(m); return m;
}
export function setFadeView(d: number) { for (const m of fadeMats) m.uniforms.uView.value = d; }

export class Bodies {
  group = new THREE.Group();
  sun: THREE.Mesh; sunGlow: THREE.Mesh;
  planets: { mesh: THREE.Mesh; glowDot: THREE.Mesh; orbit: THREE.Line; pos: THREE.Vector3; ring?: THREE.Mesh }[] = [];
  probes: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3()];
  star: THREE.Mesh; starGlow: THREE.Mesh; starIdx = -1; starR = 0;
  orbitMat = fadeLineMat(0x8fb0ff, 0.35);
  private sunMat: THREE.ShaderMaterial; private starMat: THREE.ShaderMaterial; private moonMat: THREE.ShaderMaterial;
  moon: THREE.Mesh; moonP = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const sunCol = new THREE.Color(1.0, 0.93, 0.82);
    this.sunMat = surface(sunCol, false, 1.7);
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(RSUN, 64, 48), this.sunMat); this.sun.renderOrder = 10; this.group.add(this.sun);
    this.sunGlow = glow(new THREE.Color(1.0, 0.75, 0.45)); this.group.add(this.sunGlow);
    PLANETS.forEach((p, k) => {
      const pm = planetMat(p.name === "Venus" ? "#e9dcb4" : p.name === "Uranus" ? "#aee0e6" : p.name === "Mercury" ? "#9a958e" : p.col, p.name === "Venus", k * 1.3);
      if (TEX[p.name]) loadTex(pm, TEX[p.name], "uTex");
      if (p.name === "Earth") { loadTex(pm, "earth_night.jpg", "uNight"); pm.uniforms.uAtmo.value.setRGB(0.25, 0.45, 1.0); }
      if (p.name === "Venus") pm.uniforms.uAtmo.value.setRGB(0.35, 0.3, 0.15);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(p.rkm * KM, 96, 64), pm); mesh.renderOrder = 10;
      const dot = glow(new THREE.Color(p.col)); dot.renderOrder = 4;
      const pts: THREE.Vector3[] = []; for (let i = 0; i <= 360; i++) pts.push(planetPos(k, 2025.84, new THREE.Vector3(), i));
      const orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), fadeLineMat(0x8fb0ff, 0.35));
      const entry: any = { mesh, glowDot: dot, orbit, pos: new THREE.Vector3() };
      if (p.name === "Saturn") {
        const ring = new THREE.Mesh(new THREE.RingGeometry(74000 * KM, 141000 * KM, 256, 8),
          new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, uniforms: { uKm: { value: KM } }, side: THREE.DoubleSide, transparent: true, depthTest: true, depthWrite: false })); ring.renderOrder = 11;
        // ring plane: Saturn's pole RA 40.59°, Dec 83.54° (IAU)
        const pole = radecToGal(40.59, 83.54); ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pole); mesh.add(ring); entry.ring = ring;
      }
      this.group.add(mesh, dot, orbit); this.planets.push(entry);
    });

    // the Moon: NASA LRO colour map, JPL Horizons position near today
    this.moonMat = planetMat("#9a9a96", false, 9); loadTex(this.moonMat, TEX.Moon, "uTex");
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(1737.4 * KM, 96, 64), this.moonMat); this.moon.renderOrder = 10; this.group.add(this.moon);
    this.starMat = surface(new THREE.Color(1, 1, 1), false, 0.3);
    this.star = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), this.starMat); this.star.visible = false; this.star.renderOrder = 10; scene.add(this.star);
    this.starGlow = glow(new THREE.Color(1, 1, 1)); this.starGlow.visible = false; scene.add(this.starGlow);
  }

  liveSun = false; liveEarth = false;
  override: ((k: number) => THREE.Vector3 | null) | null = null;   // e.g. the Lab's N-body simulation
  /** today's Sun (SDO) on the Earth-facing hemisphere, today's Earth (EPIC) on its sunlit side */
  setLiveTextures(sunUrl: string | null, earthUrl: string | null) {
    const L = new THREE.TextureLoader();
    if (sunUrl) L.load(sunUrl, (t) => { t.colorSpace = THREE.NoColorSpace; this.sunMat.uniforms.uDisc.value = t; this.sunMat.uniforms.uUseDisc.value = 1; this.liveSun = true;
      this.sunMat.uniforms.uCol.value.setRGB(1.0, 0.62, 0.22); });     // match the far side to SDO's continuum colour
    if (earthUrl) L.load(earthUrl, (t) => { t.colorSpace = THREE.NoColorSpace; const m = this.planets[2].mesh.material as THREE.ShaderMaterial; m.uniforms.uDisc.value = t; m.uniforms.uUseDisc.value = 1; this.liveEarth = true; });
  }
  /** year = calendar year shown; camera for billboards and level of detail */
  update(year: number, camera: THREE.PerspectiveCamera, pxPerRad: number, tSec: number, viewDist = 1) {
    const camD = camera.position.length();
    // an orbit much larger than the view is seen edge-on as a straight line slicing the screen: fade it out
    this.planets.forEach((pl, k) => { const R = PLANETS[k].el[0] * AU, x = Math.log10(R / Math.max(viewDist, 1e-12));
      (pl.orbit.material as THREE.ShaderMaterial).uniforms.opacity.value = 0.35 * Math.max(0, Math.min(1, 1.15 - Math.max(0, x - 0.35) * 1.4)) * Math.max(0, Math.min(1, 1 - Math.log10(Math.max(camD / AU, 1)) / 4)); });
    const near = camD < 0.02;                                    // within ~4,000 au of the Sun
    this.group.visible = near || camD < 0.05;

    this.sunMat.uniforms.uTime.value = tSec;
    // sun glow: a billboard a few radii across, but never smaller than ~10 px
    const sunPx = RSUN / Math.max(camD, 1e-12) * pxPerRad;
    const gs = Math.max(RSUN * 6, 14 / pxPerRad * camD);
    this.sunGlow.scale.setScalar(gs); this.sunGlow.quaternion.copy(camera.quaternion); (this.sunGlow.material as THREE.ShaderMaterial).uniforms.uCol.value.setRGB(1, 0.8, 0.5).multiplyScalar(sunPx > 3 ? 0.5 : 1);
    const earthP = planetPos(2, year, new THREE.Vector3());
    // SDO images: solar north up (IAU pole); EPIC images: celestial north up
    this.sunMat.uniforms.uObs.value.copy(earthP).normalize(); this.sunMat.uniforms.uNorth.value.copy(radecToGal(286.13, 63.87));   // IAU solar rotation pole
    const em = this.planets[2].mesh.material as THREE.ShaderMaterial; em.uniforms.uObs.value.copy(earthP).normalize().negate(); em.uniforms.uNorth.value.copy(eq2gal(0, 0, 1));
    const jd = jdOfYear(year);
    this.planets.forEach((pl, k) => {
      const m = pl.mesh.material as THREE.ShaderMaterial, f = iauFrame(k, jd); m.uniforms.uP.value.copy(f.P); m.uniforms.uM.value.copy(f.M); m.uniforms.uE.value.copy(f.E);
      planetPos(k, year, pl.pos); const ov = this.override?.(k); if (ov) pl.pos.copy(ov); pl.mesh.position.copy(pl.pos);
      const d = camera.position.distanceTo(pl.pos), px = PLANETS[k].rkm * KM / Math.max(d, 1e-14) * pxPerRad;
      pl.glowDot.position.copy(pl.pos); pl.glowDot.quaternion.copy(camera.quaternion); pl.glowDot.scale.setScalar(12 / pxPerRad * d); pl.glowDot.visible = px < 2.5;
      pl.mesh.visible = px >= 0.4;
    });
    PROBES.forEach((_, k) => probePos(k, year, this.probes[k]));
    // Moon: Horizons hourly track inside its window; otherwise low-precision lunar theory (Meeus, ~0.5°, ~1% distance)
    const mh = moonPos(year, this.moonP);
    if (!mh) {
      const dd = jd - 2451545.0, Mm = (134.963 + 13.064993 * dd) * D2R, F = (93.272 + 13.229350 * dd) * D2R;
      const Dm = (297.850 + 12.190749 * dd) * D2R, Ms = (357.529 + 0.98560028 * dd) * D2R;
      const lam = (218.316 + 13.176396 * dd + 6.289 * Math.sin(Mm) + 1.274 * Math.sin(2 * Dm - Mm) + 0.658 * Math.sin(2 * Dm) - 0.186 * Math.sin(Ms) + 0.214 * Math.sin(2 * Mm) - 0.114 * Math.sin(2 * F)) * D2R;
      const bet = 5.128 * Math.sin(F) * D2R, r = (385000.56 - 20905.355 * Math.cos(Mm) - 3699.111 * Math.cos(2 * Dm - Mm) - 2955.968 * Math.cos(2 * Dm)) * KM;
      ecl2gal(r * Math.cos(bet) * Math.cos(lam), r * Math.cos(bet) * Math.sin(lam), r * Math.sin(bet), this.moonP).add(this.planets[2].pos);
    }
    this.moon.position.copy(this.moonP);
    const mf = iauFrame(8, jd); this.moonMat.uniforms.uP.value.copy(mf.P); this.moonMat.uniforms.uM.value.copy(mf.M); this.moonMat.uniforms.uE.value.copy(mf.E);
    this.moon.visible = camera.position.distanceTo(this.moonP) < 0.02 * AU * 50;
  }

  /** show star i as a sphere at its physical radius when it would be resolved */
  setStar(i: number, pos: THREE.Vector3, Rsun: number, col: THREE.Color, bandsBD: boolean, camera: THREE.PerspectiveCamera, pxPerRad: number, tSec: number) {
    if (i < 0) { this.star.visible = this.starGlow.visible = false; this.starIdx = -1; return 0; }
    const R = Rsun * RSUN, d = camera.position.distanceTo(pos), px = R / Math.max(d, 1e-14) * pxPerRad;
    this.starIdx = i; this.starR = R;
    this.star.position.copy(pos); this.star.scale.setScalar(R); this.star.visible = px > 0.8;
    this.starMat.uniforms.uCol.value.copy(col); this.starMat.uniforms.uBands.value = bandsBD ? 1 : 0; this.starMat.uniforms.uTime.value = tSec; this.starMat.uniforms.uSeed.value = (i % 97) * 0.37;
    this.starGlow.position.copy(pos); this.starGlow.quaternion.copy(camera.quaternion); this.starGlow.scale.setScalar(Math.max(R * 5, 10 / pxPerRad * d));
    (this.starGlow.material as THREE.ShaderMaterial).uniforms.uCol.value.copy(col).multiplyScalar(bandsBD ? 0.35 : 0.8);
    this.starGlow.visible = px > 0.8;
    return px;
  }
}
