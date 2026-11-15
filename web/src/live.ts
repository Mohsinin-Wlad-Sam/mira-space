// Live NASA data shared by the map and 3D Space.
//   static, refreshed hourly by scripts/live_fetch.py:  JPL Horizons spacecraft tracks, JPL close approaches + SBDB orbits,
//                                                       SDO Sun today, EPIC Earth today          -> /live/live.json
//   live from the browser (CORS-enabled NASA APIs):     DONKI coronal mass ejections, NeoWs today's asteroid count,
//                                                       NASA Image and Video Library
import * as THREE from "three";
import { AU, ecl2gal, planetPos, PLANETS, fadeLineMat, setEphemeris, radecToGal } from "./bodies";
const eqToGal = (x: number, y: number, z: number) => radecToGal(Math.atan2(y, x) * 180 / Math.PI, Math.asin(z) * 180 / Math.PI);

const BASE = import.meta.env.BASE_URL;
export const NASA_KEY = "DEMO_KEY";      // public demo key (rate-limited per visitor IP); swap for a project key in production
export type Craft = { id: string; name: string; track: [number, number, number, number][] };
export type Rock = { des: string; name: string; when: string; jd: number; dist_au: number; v_kms: number; H: number | null; diameter_km: number | null;
  epoch: number; e: number; a: number; i: number; om: number; w: number; ma: number };
export type Live = { updated: string; spacecraft: Craft[]; asteroids: Rock[]; sun: { hmi: string; aia171: string; source: string } | null;
  earth: { img: string; date: string; source: string } | null };
export type CME = { id: string; t21: number; speed: number; lat: number; lon: number; half: number; type: string; link: string; note: string };

let cache: Promise<Live | null> | null = null;
export function loadLive(): Promise<Live | null> {
  cache ??= fetch(`${BASE}live/live.json`, { cache: "no-store" }).then((r) => (r.ok && (r.headers.get("content-type") ?? "").includes("json") ? r.json() : null))
    .then((L: any) => { if (L) setEphemeris(L.planets, L.earth_h, L.moon_h); return L; }).catch(() => null);
  return cache;
}
export const jdOf = (year: number) => 2451545.0 + (year - 2000.0) * 365.25;
export const yearOfJd = (jd: number) => 2000 + (jd - 2451545.0) / 365.25;

/** heliocentric ecliptic position (au) of a spacecraft at JD, linear interpolation in its Horizons track; null outside */
export function craftAt(c: Craft, jd: number): [number, number, number] | null {
  const T = c.track; if (!T.length || jd < T[0][0] || jd > T[T.length - 1][0]) return null;
  let i = Math.min(T.length - 2, Math.max(0, Math.floor((jd - T[0][0]) / (T[1][0] - T[0][0]))));
  while (i > 0 && T[i][0] > jd) i--; while (i < T.length - 2 && T[i + 1][0] < jd) i++;
  const f = (jd - T[i][0]) / (T[i + 1][0] - T[i][0]);
  return [T[i][1] + (T[i + 1][1] - T[i][1]) * f, T[i][2] + (T[i + 1][2] - T[i][2]) * f, T[i][3] + (T[i + 1][3] - T[i][3]) * f];
}
/** two-body Kepler propagation of SBDB elements (heliocentric ecliptic J2000) -> au */
export function rockAt(r: Rock, jd: number): [number, number, number] {
  const D = Math.PI / 180, n = 0.9856076686 / Math.pow(r.a, 1.5);
  let M = ((r.ma + n * (jd - r.epoch)) % 360) * D, E = M + r.e * Math.sin(M);
  for (let k = 0; k < 12; k++) E -= (E - r.e * Math.sin(E) - M) / (1 - r.e * Math.cos(E));
  const xp = r.a * (Math.cos(E) - r.e), yp = r.a * Math.sqrt(1 - r.e * r.e) * Math.sin(E);
  const w = r.w * D, O = r.om * D, I = r.i * D, cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  return [(cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp, (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp, (sw * sI) * xp + (cw * sI) * yp];
}
export function rockSize(r: Rock) {   // km; from H with a typical albedo 0.14 when no measured diameter
  return r.diameter_km ?? (r.H !== null ? 1329 / Math.sqrt(0.14) * Math.pow(10, -r.H / 5) : null);
}
/** NASA's open API allows few calls per hour from one address with the public demo key. The site's own hourly copy is
 *  used while it is fresh; otherwise one call is made and its answer kept for three hours in this browser, and after a
 *  refusal (HTTP 429) no further call is tried for an hour. */
const FRESH = 3 * 3600e3;
const liveIsFresh = (L: any) => !!L?.updated && Date.now() - Date.parse(L.updated) < FRESH;
async function nasaJson(key: string, url: string): Promise<any | null> {
  try { const c = JSON.parse(localStorage.getItem(key) ?? "null"); if (c && Date.now() - c.t < FRESH && c.u === url) return c.v; } catch { /* storage off */ }
  try { if (+(localStorage.getItem("mira.nasa429") ?? 0) > Date.now() - 3600e3) return null; } catch { /* storage off */ }
  try {
    const r = await fetch(url);
    if (r.status === 429) { try { localStorage.setItem("mira.nasa429", String(Date.now())); } catch { /* storage off */ } return null; }
    if (!r.ok) return null;
    const v = await r.json(); try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), u: url, v })); } catch { /* quota */ }
    return v;
  } catch { return null; }
}
/** DONKI CME analyses of the last `days` days: the hourly static copy when fresh, else browser-direct (CORS-enabled) */
export async function loadCMEs(days = 10): Promise<CME[]> {
  const end = new Date(), start = new Date(end.getTime() - days * 864e5), f = (d: Date) => d.toISOString().slice(0, 10);
  const L = (await loadLive()) as any; let j: any = liveIsFresh(L) && Array.isArray(L.cmes) ? L.cmes : null;      // an empty list is an answer too: a quiet Sun
  if (!j) j = await nasaJson("mira.donki", `https://api.nasa.gov/DONKI/CMEAnalysis?startDate=${f(start)}&endDate=${f(end)}&mostAccurateOnly=true&api_key=${NASA_KEY}`);
  if (!Array.isArray(j)) j = L?.cmes ?? [];
  try {
    return (j as any[]).filter((c) => c.speed && c.time21_5 && c.latitude !== null && c.longitude !== null).map((c) => ({
      id: c.associatedCMEID, t21: Date.parse(c.time21_5), speed: c.speed, lat: c.latitude, lon: c.longitude, half: c.halfAngle ?? 30, type: c.type, link: c.associatedCMELink, note: c.note ?? "" }));
  } catch { return []; }
}
/** NeoWs: how many asteroids pass Earth today */
export async function neoToday(): Promise<{ n: number; hazardous: number; closest?: { name: string; ld: number } } | null> {
  const d = new Date().toISOString().slice(0, 10), S0 = (await loadLive()) as any;
  if (liveIsFresh(S0) && S0.neo_today) return { n: S0.neo_today.n, hazardous: S0.neo_today.hazardous, closest: S0.neo_today.closest ?? undefined };
  try {
    const j = await nasaJson("mira.neo", `https://api.nasa.gov/neo/rest/v1/feed?start_date=${d}&end_date=${d}&api_key=${NASA_KEY}`); if (!j) throw new Error("rate limited");
    const L = (j.near_earth_objects?.[d] ?? []) as any[];
    const c = L.map((o) => ({ name: o.name, ld: +o.close_approach_data?.[0]?.miss_distance?.lunar })).sort((a, b) => a.ld - b.ld)[0];
    return { n: L.length, hazardous: L.filter((o) => o.is_potentially_hazardous_asteroid).length, closest: c };
  } catch { const s = ((await loadLive()) as any)?.neo_today; return s ? { n: s.n, hazardous: s.hazardous, closest: s.closest ?? undefined } : null; }
}
/** NASA Image and Video Library thumbnails for a subject */
export async function nasaImages(q: string, n = 4): Promise<{ title: string; thumb: string; href: string }[]> {
  try {
    const j = await (await fetch(`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image`)).json();
    return (j.collection?.items ?? []).filter((it: any) => it.links?.[0]?.href).slice(0, n)
      .map((it: any) => ({ title: it.data?.[0]?.title ?? q, thumb: it.links[0].href, href: `https://images.nasa.gov/details/${encodeURIComponent(it.data?.[0]?.nasa_id ?? "")}` }));
  } catch { return []; }
}

// ---------------------------------------------------------------- 3D layer
const DOT_VERT = `attribute vec3 col; uniform float uPx; varying vec3 vC; void main(){ vC = col; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = mv.z < 0.0 ? 9.0 * uPx : 0.0; }`;
const DOT_FRAG = `varying vec3 vC; void main(){ vec2 d = abs(gl_PointCoord - 0.5); if (d.x + d.y > 0.5) discard; float e = 1.0 - smoothstep(0.32, 0.5, d.x + d.y); gl_FragColor = vec4(vC * (0.4 + 0.6 * e), 1.0); }`;
const RSUN_PC = 695700 * 3.2407792894443654e-14;

export class LiveLayer {
  live: Live | null = null; group = new THREE.Group();
  crafts: { c: Craft; pos: THREE.Vector3 | null; line: THREE.Line }[] = [];
  rocks: { r: Rock; pos: THREE.Vector3; orbit: THREE.Line }[] = [];
  cmes: { c: CME; mesh: THREE.Mesh; r: number; toEarth: boolean }[] = [];
  private dots: THREE.Points | null = null; private dotMat: THREE.ShaderMaterial;
  constructor(scene: THREE.Scene, dpr: number) {
    scene.add(this.group);
    this.dotMat = new THREE.ShaderMaterial({ vertexShader: DOT_VERT, fragmentShader: DOT_FRAG, depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending, uniforms: { uPx: { value: dpr } } });
  }
  async init() {
    this.live = await loadLive(); const L = this.live; if (!L) return null;
    const trackMat = fadeLineMat(0x7cc4ff, 0.45);
    for (const c of L.spacecraft) {
      const pts = c.track.map((t) => ecl2gal(t[1] * AU, t[2] * AU, t[3] * AU));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), trackMat); this.group.add(line);
      this.crafts.push({ c, pos: null, line });
    }
    const orbMat = fadeLineMat(0xffc857, 0.25);
    for (const r of L.asteroids) {
      const P = 365.25 * Math.pow(r.a, 1.5), pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 180; k++) { const p = rockAt(r, r.epoch + P * k / 180); pts.push(ecl2gal(p[0] * AU, p[1] * AU, p[2] * AU)); }
      const orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), orbMat); orbit.visible = false; this.group.add(orbit);
      this.rocks.push({ r, pos: new THREE.Vector3(), orbit });
    }
    const n = this.crafts.length + this.rocks.length, g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const col = new Float32Array(n * 3); for (let k = 0; k < n; k++) col.set(k < this.crafts.length ? [0.49, 0.77, 1] : [1, 0.78, 0.34], k * 3);
    g.setAttribute("col", new THREE.BufferAttribute(col, 3));
    this.dots = new THREE.Points(g, this.dotMat); this.dots.frustumCulled = false; this.dots.renderOrder = 13; this.group.add(this.dots);
    return L;
  }
  async initCMEs() {
    const L = await loadCMEs(10);
    for (const c of L) {
      const half = Math.min(80, Math.max(5, c.half)) * Math.PI / 180;
      // Earth is hit if it lies inside the CME cone: angle between the CME axis (Stonyhurst lat/lon; lon 0 = towards Earth) and the Sun–Earth line < half-width
      const toEarth = Math.acos(Math.cos(c.lat * Math.PI / 180) * Math.cos(c.lon * Math.PI / 180)) * 180 / Math.PI < c.half, col = toEarth ? 0xff5c6c : 0xffb36b;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 12, 0, Math.PI * 2, 0, half),         // spherical cap around +Y
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: toEarth ? 0.08 : 0.035, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      const rim: THREE.Vector3[] = []; for (let k = 0; k <= 96; k++) { const a = k / 96 * Math.PI * 2; rim.push(new THREE.Vector3(Math.sin(half) * Math.cos(a), Math.cos(half), Math.sin(half) * Math.sin(a))); }
      mesh.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rim), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: toEarth ? 0.8 : 0.4, depthWrite: false })));
      mesh.renderOrder = 14; this.group.add(mesh);
      this.cmes.push({ c, mesh, r: 0, toEarth });
    }
    return this.cmes.length;
  }
  /** jdShown: timeline date; nowMs: wall clock for CMEs (they are a live, present-day phenomenon) */
  update(jdShown: number, camera: THREE.Camera, nowMs: number, show: boolean) {
    this.group.visible = show; if (!show || !this.dots) return;
    const pos = this.dots.geometry.getAttribute("position") as THREE.BufferAttribute, a = pos.array as Float32Array;
    this.crafts.forEach((k, i) => { const p = craftAt(k.c, jdShown); k.pos = p ? ecl2gal(p[0] * AU, p[1] * AU, p[2] * AU, k.pos ?? new THREE.Vector3()) : null; const v = k.pos ?? new THREE.Vector3(1e9, 0, 0); a.set([v.x, v.y, v.z], i * 3); });
    const off = this.crafts.length;
    this.rocks.forEach((k, i) => { const p = rockAt(k.r, jdShown); ecl2gal(p[0] * AU, p[1] * AU, p[2] * AU, k.pos); a.set([k.pos.x, k.pos.y, k.pos.z], (off + i) * 3); });
    pos.needsUpdate = true;
    // CMEs: front at 21.5 solar radii at time21_5, moving outward at the measured speed; direction in Stonyhurst coordinates (lon 0 = toward Earth)
    const earth = planetPos(2, yearOfJd(jdOf(2000 + (nowMs / 864e5 + 2440587.5 - 2451545) / 365.25)), new THREE.Vector3()).normalize();
    // solar north = IAU rotation pole (RA 286.13°, Dec 63.87°), made perpendicular to the Sun–Earth line
    const a0 = 286.13 * Math.PI / 180, d0 = 63.87 * Math.PI / 180, pole = eqToGal(Math.cos(d0) * Math.cos(a0), Math.cos(d0) * Math.sin(a0), Math.sin(d0));
    const north = pole.addScaledVector(earth, -pole.dot(earth)).normalize(), west = new THREE.Vector3().crossVectors(north, earth).normalize();
    for (const k of this.cmes) {
      const dt = (nowMs - k.c.t21) / 1000, r = 21.5 * RSUN_PC + k.c.speed * dt * 3.2407792894443654e-14;
      k.r = r; k.mesh.visible = dt > -3600 && r < 2.5 * AU;
      if (!k.mesh.visible) continue;
      const la = k.c.lat * Math.PI / 180, lo = k.c.lon * Math.PI / 180;
      const dir = earth.clone().multiplyScalar(Math.cos(la) * Math.cos(lo)).addScaledVector(west, Math.cos(la) * Math.sin(lo)).addScaledVector(north, Math.sin(la)).normalize();
      k.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); k.mesh.scale.setScalar(Math.max(r, 1e-9));
    }
    void camera; void PLANETS;
  }
}
