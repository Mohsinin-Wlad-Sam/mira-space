// The visible universe around the census, in the same Galactic heliocentric frame (parsecs), from the Milky Way to
// the cosmic microwave background:
//  * Milky Way: a MODEL (exponential disc h_R = 2.6 kpc, h_z = 0.3 kpc, central bar 27° from the Sun–centre line,
//    four log-spiral arms with 12° pitch placed where maser parallaxes find them near the Sun, Orion Spur) — labelled as such
//  * Local Group + nearby landmarks: measured distances (McConnachie 2012 and NED), true orientations for M31 and M33
//  * cosmic web: NED galaxies with spectroscopic redshifts (census/universe.py), quasars to z ~ 7
//  * the edge: Planck SMICA CMB map on the last-scattering surface at its comoving distance (Planck 2018 cosmology)
import * as THREE from "three";

const BASE = import.meta.env.BASE_URL;
const D2R = Math.PI / 180, R0 = 8178;   // Sun – Galactic centre (GRAVITY 2019), pc
const RG = [[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132], [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]];
function galXYZ(ra: number, dec: number, dpc: number) {
  const a = ra * D2R, d = dec * D2R, u = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  return new THREE.Vector3(...RG.map((r) => (r[0] * u[0] + r[1] * u[1] + r[2] * u[2]) * dpc) as [number, number, number]);
}
// [name, RA, Dec, distance kpc, radius kpc, kind, inclination°, position angle°]
export const LOCAL: [string, number, number, number, number, string, number, number][] = [
  ["Large Magellanic Cloud", 80.894, -69.756, 50.0, 4.5, "irr", 34, 170], ["Small Magellanic Cloud", 13.187, -72.829, 62.0, 2.0, "irr", 60, 45],
  ["Andromeda Galaxy (M31)", 10.6847, 41.269, 765, 23, "spiral", 77, 38], ["Triangulum Galaxy (M33)", 23.4621, 30.6599, 840, 9, "spiral", 55, 23],
  ["M32", 10.674, 40.865, 785, 0.5, "dw", 0, 0], ["NGC 205", 10.092, 41.685, 824, 1.5, "dw", 0, 0], ["NGC 185", 9.742, 48.337, 616, 1.0, "dw", 0, 0],
  ["NGC 147", 8.3, 48.509, 676, 1.2, "dw", 0, 0], ["Sagittarius Dwarf", 283.764, -30.48, 26, 2.5, "dw", 0, 0], ["Fornax Dwarf", 39.997, -34.449, 147, 1.0, "dw", 0, 0],
  ["Sculptor Dwarf", 15.039, -33.709, 86, 0.5, "dw", 0, 0], ["Draco Dwarf", 260.06, 57.915, 76, 0.4, "dw", 0, 0], ["Ursa Minor Dwarf", 227.285, 67.222, 76, 0.4, "dw", 0, 0],
  ["Carina Dwarf", 100.403, -50.966, 105, 0.4, "dw", 0, 0], ["Sextans Dwarf", 153.262, -1.615, 86, 0.6, "dw", 0, 0], ["Leo I", 152.117, 12.306, 254, 0.4, "dw", 0, 0],
  ["Leo II", 168.37, 22.152, 233, 0.3, "dw", 0, 0], ["NGC 6822", 296.24, -14.789, 459, 1.5, "dw", 0, 0], ["IC 1613", 16.199, 2.118, 755, 1.5, "dw", 0, 0],
  ["WLM", 0.492, -15.461, 933, 1.5, "dw", 0, 0], ["IC 10", 5.072, 59.304, 794, 1.0, "dw", 0, 0], ["Andromeda II", 19.124, 33.419, 652, 0.5, "dw", 0, 0],
  ["Pegasus Dwarf", 352.151, 14.743, 920, 0.6, "dw", 0, 0], ["Leo A", 149.86, 30.746, 798, 0.6, "dw", 0, 0],
  ["M81 (Bode's Galaxy)", 148.888, 69.065, 3630, 14, "spiral", 59, 157], ["M82 (Cigar Galaxy)", 148.968, 69.68, 3530, 6, "dw", 0, 0],
  ["Centaurus A", 201.365, -43.019, 3800, 15, "dw", 0, 0], ["Whirlpool Galaxy (M51)", 202.47, 47.195, 8600, 12, "spiral", 22, 163],
  ["Sombrero Galaxy (M104)", 189.997, -11.623, 9550, 15, "spiral", 84, 90], ["M87 (Virgo Cluster core)", 187.706, 12.391, 16500, 20, "dw", 0, 0]];
// galaxy clusters / superclusters for labels at cosmic-web scale (redshift distances, Mpc)
export const CLUSTERS: [string, number, number, number][] = [["Virgo Cluster", 187.7, 12.4, 16.5], ["Fornax Cluster", 54.62, -35.45, 19], ["Perseus Cluster", 49.95, 41.51, 73],
  ["Coma Cluster", 194.95, 27.98, 99], ["Norma Cluster (Great Attractor)", 243.6, -60.9, 68], ["Hydra Cluster", 159.17, -27.53, 52], ["Centaurus Cluster", 192.2, -41.31, 47],
  ["Hercules Cluster", 241.15, 17.75, 155], ["Shapley Supercluster", 202.0, -31.0, 200], ["Pisces–Perseus filament", 25.0, 33.0, 70]];

const PT_VERT = `attribute vec3 col; attribute float sz; uniform float uPx; uniform float uA; varying vec3 vC; varying float vA;
  void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
    float s = sz * uPx / max(-mv.z, 1e-9); gl_PointSize = clamp(s, 1.0, 24.0); vA = uA * clamp(s, 0.25, 1.0) * (mv.z < 0.0 ? 1.0 : 0.0); vC = col; }`;
const PT_FRAG = `varying vec3 vC; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard; gl_FragColor = vec4(vC * vA * exp(-r * r * 3.0), 1.0); }`;
const CMB_VERT = `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const CMB_FRAG = `uniform sampler2D uTex; uniform float uA; varying vec3 vD;
  void main(){ float l = atan(vD.y, vD.x), b = asin(clamp(vD.z, -1.0, 1.0)); vec2 uv = vec2(fract(l / 6.2831853 + 1.0), 0.5 + b / 3.1415927);
    gl_FragColor = vec4(texture2D(uTex, uv).rgb * uA, 1.0); }`;

function cloud(n: number, gen: (k: number, p: THREE.Vector3, c: THREE.Color) => number, pxScale: number) {
  const P = new Float32Array(n * 3), C = new Float32Array(n * 3), Z = new Float32Array(n), p = new THREE.Vector3(), c = new THREE.Color();
  for (let k = 0; k < n; k++) { const s = gen(k, p, c); P.set([p.x, p.y, p.z], k * 3); C.set([c.r, c.g, c.b], k * 3); Z[k] = s; }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("col", new THREE.BufferAttribute(C, 3)); g.setAttribute("sz", new THREE.BufferAttribute(Z, 1));
  const m = new THREE.ShaderMaterial({ vertexShader: PT_VERT, fragmentShader: PT_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: { uPx: { value: pxScale }, uA: { value: 0 } } });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; return pts;
}
// deterministic random
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-12))) * Math.cos(2 * Math.PI * rnd());

/** Milky Way model particles (heliocentric Galactic pc; galactocentric = p - (R0,0,0)) */
function milkyWay(n: number) {
  const pitch = 12 * D2R, k = Math.tan(pitch);
  // arm radius at the Sun's azimuth (towards the Sun from the centre): Scutum–Centaurus, Sagittarius–Carina, Perseus, Outer (Norma); + Orion Spur
  const arms = [{ r: 5.0e3, w: 1 }, { r: 6.7e3, w: 0.8 }, { r: 9.9e3, w: 1 }, { r: 13.0e3, w: 0.6 }];
  const bar = 27 * D2R;
  return cloud(n, (_, p, c) => {
    const u = rnd();
    let R: number, th: number, z: number;
    if (u < 0.10) {                                       // bar + bulge (old, yellow-orange)
      const a = gauss() * 1500, b = gauss() * 600; z = gauss() * 350;
      const x = a * Math.cos(bar) - b * Math.sin(bar), y = a * Math.sin(bar) + b * Math.cos(bar);
      p.set(R0 - x, y, z); c.setRGB(1.0, 0.78, 0.5); return 70;
    }
    if (u < 0.38) {                                       // old thin disc (exponential, h_R 2.6 kpc)
      R = -2600 * Math.log(Math.max(1e-6, rnd() * rnd() * 0.999 + 1e-6)) * 0.62 + 1200; th = rnd() * 2 * Math.PI; z = gauss() * 300;
      p.set(R0 + R * Math.cos(th), R * Math.sin(th), z); c.setRGB(0.6, 0.52, 0.42); return 60;
    }
    // young population along the spiral arms (blue-white), with pink star-forming knots
    const arm = arms[Math.floor(rnd() * arms.length)], dth = (rnd() * 2 - 1) * 2.6 * Math.PI;
    R = arm.r * Math.exp(k * dth); if (R < 3000 || R > 16000) { R = 3000 + rnd() * 13000; }
    const th0 = Math.PI;                                  // the Sun sits at azimuth π (x = 0 heliocentric)
    th = th0 + dth; const spread = 110 + R * 0.012;
    const x = R * Math.cos(th) + gauss() * spread, y = R * Math.sin(th) + gauss() * spread; z = gauss() * 120;
    p.set(R0 + x, y, z);
    if (rnd() < 0.04) { c.setRGB(1.0, 0.42, 0.6); return 70; }
    c.setRGB(0.62, 0.75, 1.0); return 50;
  }, 1);
}
function orionSpur(n: number) {
  return cloud(n, (_, p, c) => { const t = (rnd() - 0.5) * 4000, w = gauss() * 180; const ang = 78 * D2R;   // runs from ~l=60° to l=240°, through the Sun
    p.set(t * Math.cos(ang) + w * Math.sin(ang) - 200, t * Math.sin(ang) - w * Math.cos(ang), gauss() * 90); c.setRGB(0.75, 0.85, 1.0); return 120; }, 1);
}
/** a disc galaxy of radius rk (kpc) at position c, oriented by inclination / position angle (sky-plane) */
function discGalaxy(n: number, center: THREE.Vector3, rkpc: number, inc: number, pa: number, ra: number, dec: number) {
  // sky basis at the galaxy: north & east directions, line of sight
  const los = center.clone().normalize();
  const nN = galXYZ(ra, dec + 0.01, 1).sub(galXYZ(ra, dec, 1)).normalize(), nE = new THREE.Vector3().crossVectors(nN, los).normalize().negate();
  const major = nN.clone().multiplyScalar(Math.cos(pa * D2R)).addScaledVector(nE, Math.sin(pa * D2R));
  const minorSky = new THREE.Vector3().crossVectors(los, major).normalize();
  const minor = minorSky.clone().multiplyScalar(Math.cos(inc * D2R)).addScaledVector(los, Math.sin(inc * D2R));   // tilt out of the sky plane
  const R = rkpc * 1000;
  return cloud(n, (_, p, c) => {
    const r = -R / 3.2 * Math.log(Math.max(1e-6, rnd())), th = rnd() * 2 * Math.PI, arm = Math.sin(2 * th - 2.2 * Math.log(r / 1000 + 0.3));
    const rr = r * (1 + 0.06 * arm);
    p.copy(center).addScaledVector(major, rr * Math.cos(th)).addScaledVector(minor, rr * Math.sin(th));
    if (r < R * 0.12) c.setRGB(1, 0.85, 0.6); else if (arm > 0.6) c.setRGB(0.7, 0.8, 1); else c.setRGB(0.95, 0.9, 0.82);
    return R * 0.012;
  }, 1);
}
function irregular(n: number, center: THREE.Vector3, rkpc: number) {
  const R = rkpc * 1000;
  return cloud(n, (_, p, c) => { p.set(center.x + gauss() * R * 0.4, center.y + gauss() * R * 0.3, center.z + gauss() * R * 0.25); c.setRGB(0.82, 0.86, 1); return R * 0.02; }, 1);
}

export type UniLabel = { txt: string; p: THREE.Vector3; min: number; max: number };
export class Universe {
  group = new THREE.Group(); mw: THREE.Points[] = []; local: THREE.Points[] = []; web: THREE.Points | null = null; qso: THREE.Points | null = null;
  cmb: THREE.Mesh | null = null; cmbR = 1.39e10; labels: UniLabel[] = []; counts = { galaxies: 0, quasars: 0 };
  constructor(scene: THREE.Scene, low: boolean) {
    scene.add(this.group);
    const s = low ? 0.35 : 1;
    this.mw.push(milkyWay(Math.round(160000 * s)), orionSpur(Math.round(3000 * s))); this.mw.forEach((m) => this.group.add(m));
    for (const [name, ra, dec, dk, rk, kind, inc, pa] of LOCAL) {
      const c = galXYZ(ra, dec, dk * 1000);
      const pts = kind === "spiral" ? discGalaxy(Math.round((dk > 2000 ? 2500 : 9000) * s), c, rk, inc, pa, ra, dec) : kind === "irr" ? irregular(Math.round(5000 * s), c, rk) : irregular(Math.round(600 * s), c, rk);
      this.local.push(pts); this.group.add(pts);
      this.labels.push({ txt: name, p: c, min: dk * 1000 * 0.03, max: dk * 1000 * 40 });
    }
    this.labels.push({ txt: "Milky Way (model)", p: new THREE.Vector3(R0, 0, 2500), min: 4000, max: 4e6 }, { txt: "Galactic centre", p: new THREE.Vector3(R0, 0, 0), min: 800, max: 2e5 },
      { txt: "Perseus Arm", p: new THREE.Vector3(-1800, 0, 0), min: 2500, max: 40000 }, { txt: "Sagittarius Arm", p: new THREE.Vector3(1500, -800, 0), min: 2500, max: 40000 },
      { txt: "Scutum–Centaurus Arm", p: new THREE.Vector3(3300, 2200, 0), min: 3000, max: 50000 }, { txt: "Sun · inside the bubble this census measured", p: new THREE.Vector3(0, 0, 0), min: 2000, max: 3e5 });
    for (const [n, ra, dec, mpc] of CLUSTERS) this.labels.push({ txt: n, p: galXYZ(ra, dec, mpc * 1e6), min: mpc * 1e6 * 0.05, max: mpc * 1e6 * 25 });
  }
  async load() {
    const meta = await fetch(`${BASE}data/universe/meta.json`).then((r) => (r.ok && !(r.headers.get("content-type") ?? "").includes("html") ? r.json() : null)).catch(() => null);
    if (!meta) return;
    const bin = async (f: string) => new Float32Array(await (await fetch(`${BASE}data/universe/${f}`)).arrayBuffer());
    const g = await bin("galaxies.bin"), n = g.length / 4;
    this.web = cloud(n, (k, p, c) => { p.set(g[k * 4], g[k * 4 + 1], g[k * 4 + 2]); const z = g[k * 4 + 3]; c.setRGB(0.75 + 0.25 * (z / 0.06), 0.8, 1.0 - 0.35 * (z / 0.06)); return 120000; }, 1);
    this.group.add(this.web); this.counts.galaxies = n;
    const q = await bin("quasars.bin"), m = q.length / 4;
    this.qso = cloud(m, (k, p, c) => { p.set(q[k * 4], q[k * 4 + 1], q[k * 4 + 2]); const z = Math.min(1, q[k * 4 + 3] / 4); c.setRGB(0.6 + 0.4 * z, 0.75 - 0.3 * z, 1.0 - 0.5 * z); return 2.5e7; }, 1);
    this.group.add(this.qso); this.counts.quasars = m;
    if (meta.cmb) {
      this.cmbR = meta.cmb.radius_pc;
      const t = await new THREE.TextureLoader().loadAsync(`${BASE}data/universe/cmb_2048.jpg`); t.colorSpace = THREE.NoColorSpace; t.wrapS = THREE.RepeatWrapping;
      this.cmb = new THREE.Mesh(new THREE.SphereGeometry(this.cmbR, 96, 48), new THREE.ShaderMaterial({ vertexShader: CMB_VERT, fragmentShader: CMB_FRAG, side: THREE.BackSide,
        depthTest: false, depthWrite: false, uniforms: { uTex: { value: t }, uA: { value: 0 } } }));
      this.cmb.renderOrder = -9; this.group.add(this.cmb);
      this.labels.push({ txt: "Cosmic microwave background · the edge of the observable universe", p: new THREE.Vector3(0, 0, this.cmbR), min: 2e9, max: 1e12 });
    }
  }
  /** fade each layer in at its own scale; camD = camera distance from the Sun, view = distance to the target */
  update(camD: number, view: number, pxPerRad: number) {
    const ramp = (x: number, a: number, b: number) => Math.max(0, Math.min(1, (Math.log10(Math.max(x, 1e-9)) - Math.log10(a)) / (Math.log10(b) - Math.log10(a))));
    const s = Math.max(camD, view);
    const aMW = ramp(s, 1200, 6000) * (1 - ramp(s, 3e6, 3e7));
    this.mw.forEach((m) => { (m.material as THREE.ShaderMaterial).uniforms.uA.value = aMW * 0.32; (m.material as THREE.ShaderMaterial).uniforms.uPx.value = pxPerRad; m.visible = aMW > 0.001; });
    const aL = ramp(s, 8000, 60000) * (1 - ramp(s, 2e8, 2e9));
    this.local.forEach((m) => { (m.material as THREE.ShaderMaterial).uniforms.uA.value = aL * 0.7; (m.material as THREE.ShaderMaterial).uniforms.uPx.value = pxPerRad; m.visible = aL > 0.001; });
    if (this.web) { const a = ramp(s, 1.5e6, 1.5e7) * (1 - ramp(s, 3e9, 2e10)); const mm = this.web.material as THREE.ShaderMaterial; mm.uniforms.uA.value = a * 0.8; mm.uniforms.uPx.value = pxPerRad; this.web.visible = a > 0.001; }
    if (this.qso) { const a = ramp(s, 2e8, 2e9); const mm = this.qso.material as THREE.ShaderMaterial; mm.uniforms.uA.value = a * 0.8; mm.uniforms.uPx.value = pxPerRad; this.qso.visible = a > 0.001; }
    if (this.cmb) { const a = ramp(s, 2e9, 2.5e10); (this.cmb.material as THREE.ShaderMaterial).uniforms.uA.value = a * 0.9; this.cmb.visible = a > 0.001; }
  }
  scaleName(s: number) {
    return s < 2e-4 ? "Solar System" : s < 2 ? "Around the Sun" : s < 1500 ? "Stellar neighbourhood" : s < 6e4 ? "Milky Way" : s < 5e6 ? "Local Group" : s < 2e9 ? "Cosmic web" : "Observable universe";
  }
}
