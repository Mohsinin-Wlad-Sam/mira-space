// Live Solar System on the 2D sky map: where the planets, Moon, Sun, spacecraft and passing asteroids appear from Earth
// at the date on the map's timeline, plus the visitor's own horizon "right now". Lazy-loaded (pulls in three.js math).
import * as THREE from "three";
import { PLANETS, planetPos, ecl2gal, moonPos } from "./bodies";
import { loadLive, craftAt, rockAt, jdOf, rockSize } from "./live";

export type LiveItem = { name: string; ra: number; dec: number; kind: "planet" | "moon" | "sun" | "craft" | "rock"; color: string; note: string; key: string; size: number };
const RG = [[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132], [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]];
const AU_PC = 4.84813681109536e-6, D2R = Math.PI / 180;
function galToRaDec(v: THREE.Vector3): [number, number] {
  const n = v.clone().normalize();
  const x = RG[0][0] * n.x + RG[1][0] * n.y + RG[2][0] * n.z, y = RG[0][1] * n.x + RG[1][1] * n.y + RG[2][1] * n.z, z = RG[0][2] * n.x + RG[1][2] * n.y + RG[2][2] * n.z;
  return [((Math.atan2(y, x) / D2R) + 360) % 360, Math.asin(Math.max(-1, Math.min(1, z))) / D2R];
}
const PCOL = ["#b8b2a8", "#f3dfb0", "#5f8fe0", "#e0794a", "#e8c79a", "#ead9a8", "#a6d8e0", "#6f8fe8"];
const nowYear = () => 1970 + Date.now() / (365.25 * 864e5);

export async function skyLiveAt(year: number): Promise<LiveItem[]> {
  const out: LiveItem[] = [];
  const L = await loadLive();          // installs the JPL Horizons ephemerides for planets, Earth and Moon
  const earth = planetPos(2, year, new THREE.Vector3());
  // Sun and planets (JPL Keplerian elements)
  const [sra, sdec] = galToRaDec(earth.clone().negate());
  out.push({ name: "Sun", ra: sra, dec: sdec, kind: "sun", color: "#ffd27a", note: "the Sun's place in the sky on this date: this part of the sky is up during the day", key: "sun", size: 11 });
  PLANETS.forEach((p, k) => {
    if (k === 2) return;
    const g = planetPos(k, year, new THREE.Vector3()).sub(earth); const [ra, dec] = galToRaDec(g);
    out.push({ name: p.name, ra, dec, kind: "planet", color: PCOL[k], note: `${(g.length() / AU_PC).toFixed(2)} au from Earth`, key: "p" + k, size: k >= 4 ? 8 : 6 });
  });
  // Moon: JPL Horizons hourly track near today; low-precision lunar theory (~0.5°) otherwise
  const mh = moonPos(year);
  if (mh) { const [hra, hdec] = galToRaDec(mh.clone().sub(earth)); out.push({ name: "Moon", ra: hra, dec: hdec, kind: "moon", color: "#e8ecf2", note: `${Math.round(mh.distanceTo(earth) / AU_PC * 149597870.7).toLocaleString()} km from Earth · JPL Horizons`, key: "moon", size: 9 }); }
  const d = jdOf(year) - 2451545.0;
  const Lp = 218.316 + 13.176396 * d, Mm = (134.963 + 13.064993 * d) * D2R, F = (93.272 + 13.229350 * d) * D2R;
  const Dm = (297.850 + 12.190749 * d) * D2R, Ms = (357.529 + 0.98560028 * d) * D2R;
  const lam = (Lp + 6.289 * Math.sin(Mm) + 1.274 * Math.sin(2 * Dm - Mm) + 0.658 * Math.sin(2 * Dm) - 0.186 * Math.sin(Ms) + 0.214 * Math.sin(2 * Mm) - 0.114 * Math.sin(2 * F)) * D2R, bet = 5.128 * Math.sin(F) * D2R;
  const mv = ecl2gal(Math.cos(bet) * Math.cos(lam), Math.cos(bet) * Math.sin(lam), Math.sin(bet)); const [mra, mdec] = galToRaDec(mv);
  if (!mh) out.push({ name: "Moon", ra: mra, dec: mdec, kind: "moon", color: "#e8ecf2", note: "approximate position (±0.3°, low-precision lunar theory)", key: "moon", size: 9 });
  // spacecraft and asteroids from the live feed (only near today, where their tracks/orbits are current)
  if (L && Math.abs(year - nowYear()) < 0.4) {
    const jd = jdOf(year);
    for (const c of L.spacecraft) { const p = craftAt(c, jd); if (!p) continue; const g = ecl2gal(p[0] * AU_PC, p[1] * AU_PC, p[2] * AU_PC).sub(earth); const [ra, dec] = galToRaDec(g);
      out.push({ name: c.name, ra, dec, kind: "craft", color: "#7cc4ff", note: `${(g.length() / AU_PC).toFixed(g.length() / AU_PC < 1 ? 3 : 1)} au from Earth · JPL Horizons`, key: "c" + c.id, size: 6 }); }
    for (const r of L.asteroids) { const p = rockAt(r, jd); const g = ecl2gal(p[0] * AU_PC, p[1] * AU_PC, p[2] * AU_PC).sub(earth); const [ra, dec] = galToRaDec(g); const D = rockSize(r);
      out.push({ name: r.name.replace(/[()]/g, "").trim(), ra, dec, kind: "rock", color: "#ffc857", note: `asteroid${D ? `, ~${D < 1 ? Math.round(D * 1000) + " m" : D.toFixed(1) + " km"}` : ""} · closest to Earth ${r.when.slice(0, 11)} at ${(r.dist_au * 389.17).toFixed(1)}× the Moon's distance`, key: "a" + r.des, size: 5 }); }
  }
  return out;
}

/** horizon circle (alt = 0) and cardinal points for an observer, as RA/Dec, at wall-clock time `date` */
export function horizon(lat: number, lon: number, date = new Date()) {
  const jd = date.getTime() / 864e5 + 2440587.5, T = (jd - 2451545.0) / 36525;
  const gmst = (280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T) % 360;
  const lst = ((gmst + lon) % 360 + 360) % 360, phi = lat * D2R;
  // alt/az -> RA/Dec
  const toRaDec = (alt: number, az: number): [number, number] => {
    const a = alt * D2R, A = az * D2R;
    const sd = Math.sin(a) * Math.sin(phi) + Math.cos(a) * Math.cos(phi) * Math.cos(A), dec = Math.asin(sd);
    const H = Math.atan2(-Math.sin(A) * Math.cos(a), Math.sin(a) * Math.cos(phi) - Math.cos(a) * Math.sin(phi) * Math.cos(A));
    return [((lst - H / D2R) % 360 + 360) % 360, dec / D2R];
  };
  const ring: [number, number][] = []; for (let az = 0; az <= 360; az += 3) ring.push(toRaDec(0, az));
  return { ring, zenith: toRaDec(90, 0), cardinal: [["N", 0], ["E", 90], ["S", 180], ["W", 270]].map(([n, az]) => ({ n: n as string, p: toRaDec(0, az as number) })), lst };
}
