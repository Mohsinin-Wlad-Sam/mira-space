// WHERE THE WANDERERS ARE — the Sun, the Moon and the seven other planets in the sky on any date, seen from the
// Earth's centre. Plain arithmetic, no dependencies, so the Sky map can use it on a phone.
// Planets: JPL's approximate Keplerian elements (Standish, "Approximate Positions of the Planets", valid 1800–2050;
// about an arcminute for Mercury to Mars, Uranus and Neptune, up to about 10′ for Jupiter and Saturn).
// Moon: the Astronomical Almanac's low-precision series. Brightness: the classic V(1,0) formulas with a phase term,
// and Saturn's rings by their tilt. Checked against JPL Horizons on four dates between 1999 and 2027 (scripts/test_ephem.mts):
// planets within 8′, the Moon within 7′, brightness within a few tenths of a magnitude. Enough for a map of the whole
// sky; the 3D map uses JPL Horizons tracks near today.
const D = Math.PI / 180, OBL = 23.43928 * D;
type El = [number, number, number, number, number, number];
// a (au), e, I, L, long. of perihelion, long. of node (degrees), and their change per Julian century; J2000 ecliptic
const P: { name: string; el: El; rate: El; col: string; h: number; ph: number[] }[] = [
  { name: "Mercury", el: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593], rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081], col: "#c9c2b6", h: -0.42, ph: [0.0380, -0.000273, 0.000002] },
  { name: "Venus", el: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], rate: [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418], col: "#f6e3b0", h: -4.40, ph: [0.0009, 0.000239, -0.00000065] },
  { name: "Earth", el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0], col: "#5f8fe0", h: 0, ph: [] },
  { name: "Mars", el: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891], rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343], col: "#ff7a4a", h: -1.52, ph: [0.016] },
  { name: "Jupiter", el: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106], col: "#f0cfa0", h: -9.40, ph: [0.005] },
  { name: "Saturn", el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], rate: [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794], col: "#efdca0", h: -8.88, ph: [0.044] },
  { name: "Uranus", el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503], rate: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589], col: "#a6e3ea", h: -7.19, ph: [] },
  { name: "Neptune", el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], rate: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664], col: "#7d9cff", h: -6.87, ph: [] },
];
/** decimal year (J2000-based, 365.25-day years) of a JavaScript time */
export const yearOf = (ms = Date.now()) => 2000 + (ms / 864e5 + 2440587.5 - 2451545.0) / 365.25;
export const dateOf = (yr: number) => new Date(((yr - 2000) * 365.25 + 2451545.0 - 2440587.5) * 864e5);
const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** heliocentric position of planet k (0 Mercury … 7 Neptune; 2 is the Earth–Moon barycentre), J2000 ecliptic, au */
export function helio(k: number, yr: number): [number, number, number] {
  const p = P[k], T = (yr - 2000) / 100, [a, e, I, L, wb, O] = p.el.map((v, i) => v + p.rate[i] * T) as El;
  const w = (wb - O) * D, Om = O * D, inc = I * D, M = wrap(L - wb) * D;
  let E = M + e * Math.sin(M); for (let i = 0; i < 7; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Om), sO = Math.sin(Om), cI = Math.cos(inc), sI = Math.sin(inc);
  return [(cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp, (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp, sw * sI * xp + cw * sI * yp];
}
/** ecliptic longitude and latitude (degrees, J2000) -> right ascension and declination (degrees, ICRS) */
export function eclToEq(lon: number, lat: number): [number, number] {
  const cl = Math.cos(lat * D), x = cl * Math.cos(lon * D), y = cl * Math.sin(lon * D), z = Math.sin(lat * D);
  const ye = y * Math.cos(OBL) - z * Math.sin(OBL), ze = y * Math.sin(OBL) + z * Math.cos(OBL);
  return [((Math.atan2(ye, x) / D) + 360) % 360, Math.asin(Math.max(-1, Math.min(1, ze))) / D];
}
export type SkyBody = { key: string; name: string; kind: "sun" | "moon" | "planet"; ra: number; dec: number; /** ecliptic longitude and latitude, degrees */ lon: number; lat: number;
  /** distance from Earth, au */ dist: number; /** angle from the Sun, degrees: positive = east of it (evening sky), negative = west (morning sky) */ elong: number;
  /** apparent magnitude, approximate (smaller is brighter) */ mag: number; col: string; /** lit fraction of the disc, 0–1 */ lit: number };

/** the Sun, the Moon and the planets on the sky at decimal year `yr` */
export function bodiesAt(yr: number): SkyBody[] {
  const T = (yr - 2000) / 100, E = helio(2, yr), R = Math.hypot(...E), sunLon = ((Math.atan2(-E[1], -E[0]) / D) + 360) % 360, sunLat = Math.asin(-E[2] / R) / D;
  const [sra, sdec] = eclToEq(sunLon, sunLat), out: SkyBody[] = [{ key: "sun", name: "Sun", kind: "sun", ra: sra, dec: sdec, lon: sunLon, lat: sunLat, dist: R, elong: 0, mag: -26.7, col: "#ffd27a", lit: 1 }];
  // Moon (ecliptic of date, brought back to J2000 by the precession in longitude)
  const s = (a: number, b: number) => Math.sin((a + b * T) * D), c = (a: number, b: number) => Math.cos((a + b * T) * D);
  const ml = 218.32 + 481267.881 * T + 6.29 * s(135.0, 477198.87) - 1.27 * s(259.3, -413335.36) + 0.66 * s(235.7, 890534.22) + 0.21 * s(269.9, 954397.74) - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.5, 966404.03) - 1.397 * T;
  const mb = 5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89) - 0.28 * s(318.3, 6003.15) - 0.17 * s(217.6, -407332.21);
  const par = 0.9508 + 0.0518 * c(135.0, 477198.87) + 0.0095 * c(259.3, -413335.36) + 0.0078 * c(235.7, 890534.22) + 0.0028 * c(269.9, 954397.74);
  const mlon = ((ml % 360) + 360) % 360, [mra, mdec] = eclToEq(mlon, mb), mel = wrap(mlon - sunLon), mpsi = Math.acos(Math.cos(mb * D) * Math.cos(mel * D)) / D;
  out.push({ key: "moon", name: "Moon", kind: "moon", ra: mra, dec: mdec, lon: mlon, lat: mb, dist: (6378.14 / Math.sin(par * D)) / 149597870.7, elong: mel, mag: -12.7 + 0.026 * Math.abs(180 - mpsi) + 4e-9 * Math.abs(180 - mpsi) ** 4, col: "#e8ecf2", lit: (1 - Math.cos(mpsi * D)) / 2 });
  for (let k = 0; k < 8; k++) {
    if (k === 2) continue;
    const h = helio(k, yr), g = [h[0] - E[0], h[1] - E[1], h[2] - E[2]], dist = Math.hypot(...g), r = Math.hypot(...h), lon = ((Math.atan2(g[1], g[0]) / D) + 360) % 360, lat = Math.asin(g[2] / dist) / D;
    const [ra, dec] = eclToEq(lon, lat), alpha = Math.acos(Math.max(-1, Math.min(1, (r * r + dist * dist - R * R) / (2 * r * dist)))) / D;
    let mag = P[k].h + 5 * Math.log10(r * dist) + P[k].ph.reduce((q, cf, i) => q + cf * alpha ** (i + 1), 0);
    if (k === 5) { const sB = Math.abs(Math.sin((28.075 - 0.013 * T) * D) * Math.cos(lat * D) * Math.sin((lon - 169.508 - 1.395 * T) * D) - Math.cos((28.075 - 0.013 * T) * D) * Math.sin(lat * D)); mag += -2.6 * sB + 1.25 * sB * sB; }   // Saturn's rings, by their tilt toward us
    out.push({ key: "p" + k, name: P[k].name, kind: "planet", ra, dec, lon, lat, dist, elong: wrap(lon - sunLon), mag, col: P[k].col, lit: (1 + Math.cos(alpha * D)) / 2 });
  }
  return out;
}
// The longitudes (J2000) at which the ecliptic itself crosses the IAU constellation boundaries: exact for a body on
// the ecliptic, such as the Sun. A body a few degrees off it can stand in the neighbouring constellation near a
// border, so within 1.5° of a crossing both names are given, and beyond 4° of latitude none is.
const ZODIAC: [number, string][] = [[28.7, "Aries"], [53.4, "Taurus"], [90.1, "Gemini"], [118.0, "Cancer"], [138.0, "Leo"], [173.9, "Virgo"], [217.8, "Libra"], [241.0, "Scorpius"], [247.7, "Ophiuchus"], [266.3, "Sagittarius"], [299.7, "Capricornus"], [327.5, "Aquarius"], [351.6, "Pisces"]];
/** the constellation of the zodiac a body near the ecliptic stands in ("Leo"), or "Leo–Virgo border" within 1.5° of one; empty when it is more than 4° off the ecliptic */
export function zodiac(b: { lon: number; lat: number }) {
  if (Math.abs(b.lat) > 4) return "";
  const n = ZODIAC.length; let i = n - 1;                    // before Aries begins, it is still Pisces
  for (let k = 0; k < n; k++) if (b.lon >= ZODIAC[k][0]) i = k;
  const before = ZODIAC[(i + n - 1) % n][1], here = ZODIAC[i][1], after = ZODIAC[(i + 1) % n][1];
  if (wrap(b.lon - ZODIAC[i][0]) < 1.5) return `${before}–${here} border`;
  if (wrap(ZODIAC[(i + 1) % n][0] - b.lon) < 1.5) return `${here}–${after} border`;
  return here;
}
const MOON_PHASES = ["new Moon", "waxing crescent", "first quarter", "waxing gibbous", "full Moon", "waning gibbous", "last quarter", "waning crescent"];
/** when one can see it and with what, in plain words; needs no location (it only uses the angle from the Sun) */
export function whenSeen(b: SkyBody): { when: string; eye: string } {
  if (b.kind === "sun") return { when: "up during the day", eye: "never look at it directly" };
  const a = Math.abs(b.elong), time = a > 150 ? "up most of the night" : b.elong > 0 ? "in the evening sky, after sunset" : "in the morning sky, before sunrise";
  if (b.kind === "moon") return { when: a < 12 ? "lost in the Sun's glare (new Moon)" : time, eye: `${MOON_PHASES[Math.round((((b.elong % 360) + 360) % 360) / 45) % 8]}, ${Math.round(b.lit * 100)}% lit` };
  const eye = b.mag < 1.5 ? "easy to see without a telescope" : b.mag < 5 ? "visible to the naked eye under a dark sky" : b.mag < 6.5 ? "needs binoculars" : "needs a telescope";
  return a < (b.mag < -3 ? 8 : 13) ? { when: "too close to the Sun to see these weeks", eye } : { when: time, eye };
}
/** the same in one line */
export const seen = (b: SkyBody) => { const w = whenSeen(b); return b.kind === "sun" ? "this part of the sky is up during the day" : b.kind === "moon" ? `${w.eye} · ${w.when}` : w.when.startsWith("too close") ? w.when : `${w.when} · ${w.eye}`; };
/** how bright, in words anyone can check against the sky */
export function brightWords(b: SkyBody): string {
  const m = `about magnitude ${b.mag >= 0 ? "+" : "−"}${Math.abs(b.mag).toFixed(1)}`;
  return b.mag < -1.46 ? `${m}: brighter than every star of the night` : b.mag < 1 ? `${m}: as bright as the brightest stars` : b.mag < 5 ? `${m}: a modest star to the eye` : b.mag < 6.5 ? `${m}: at the limit of the naked eye` : `${m}: too faint for the naked eye`;
}
/** minutes its light took to reach us */
export const lightMinutes = (b: SkyBody) => b.dist * 8.3167;
