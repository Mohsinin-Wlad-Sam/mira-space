// Catalogue overlays and name resolution for BLINK, straight from the public astronomy services (all CORS-enabled):
//   Gaia DR3 (ESA) and CatWISE2020 (NASA WISE/NEOWISE) via VizieR; object names and known motions via SIMBAD / Sesame.
// CDS runs mirrors (Strasbourg, Harvard CfA, IDIA); we try them in turn and remember the one that answers.
import type { Target } from "./engine";

const VIZIER = ["https://vizier.cfa.harvard.edu", "https://vizier.idia.ac.za", "https://vizier.cds.unistra.fr"];
const SESAME = ["https://vizier.cfa.harvard.edu/viz-bin/nph-sesame", "https://vizier.idia.ac.za/viz-bin/nph-sesame", "https://cds.unistra.fr/cgi-bin/nph-sesame"];
const SIMBAD_TAP = ["https://simbad.cfa.harvard.edu/simbad/sim-tap/sync", "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"];
const D2R = Math.PI / 180;

async function firstOk<T>(urls: string[], get: (u: string) => Promise<T>): Promise<T> {
  let err: unknown;
  for (let k = 0; k < urls.length; k++) {
    try { const v = await get(urls[k]); if (k) urls.unshift(...urls.splice(k, 1)); return v; } catch (e) { err = e; }
  }
  throw err ?? new Error("service unavailable");
}
async function text(url: string, ms = 12000): Promise<string> {
  const ac = new AbortController(), h = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const t = await r.text();
    if (t.trimStart().startsWith("<")) throw new Error("service page, not data");
    return t;
  } finally { clearTimeout(h); }
}

/** a catalogue source: position (deg) at `epoch`, proper motion in arcsec/yr, parallax in mas */
export type CatSource = { ra: number; dec: number; pmra: number; pmdec: number; plx: number | null; mag: number | null; mag2?: number | null; epoch: number; id: string };
export const catPos = (s: CatSource, year: number): [number, number] => {
  const dt = year - s.epoch; return [s.ra + (s.pmra / 3600) * dt / Math.cos(s.dec * D2R), s.dec + (s.pmdec / 3600) * dt];
};

function parseTsv(t: string): Record<string, string>[] {
  const lines = t.split("\n").filter((l) => l && !l.startsWith("#"));
  const hi = lines.findIndex((l) => /^-+(\t-+)*$/.test(l.trim()));
  if (hi < 2) return [];
  const cols = lines[hi - 2].split("\t");
  return lines.slice(hi + 1).map((l) => { const v = l.split("\t"), o: Record<string, string> = {}; cols.forEach((c, k) => (o[c.trim()] = (v[k] ?? "").trim())); return o; });
}
const num = (s: string | undefined) => (s === undefined || s === "" ? NaN : +s);
function vizier(source: string, ra: number, dec: number, radiusArcsec: number, out: string, sort: string, max: number) {
  const q = `/viz-bin/asu-tsv?-source=${source}&-c=${ra.toFixed(6)}${dec >= 0 ? "+" : ""}${dec.toFixed(6)}&-c.rs=${radiusArcsec.toFixed(0)}&-out=${out}&-out.max=${max}&-sort=${sort}`;
  return firstOk(VIZIER, (b) => text(b + q).then(parseTsv));
}

/** Gaia DR3 sources (epoch 2016.0), brightest first */
export async function gaia(ra: number, dec: number, radiusArcsec: number, max = 400): Promise<CatSource[]> {
  const rows = await vizier("I/355/gaiadr3", ra, dec, radiusArcsec, "Source,RA_ICRS,DE_ICRS,pmRA,pmDE,Plx,Gmag,RPmag", "Gmag", max);
  return rows.map((r) => ({ ra: num(r.RA_ICRS), dec: num(r.DE_ICRS), pmra: (num(r.pmRA) || 0) / 1000, pmdec: (num(r.pmDE) || 0) / 1000, plx: isFinite(num(r.Plx)) ? num(r.Plx) : null,
    mag: isFinite(num(r.Gmag)) ? num(r.Gmag) : null, mag2: isFinite(num(r.RPmag)) ? num(r.RPmag) : null, epoch: 2016.0, id: `Gaia DR3 ${r.Source}` })).filter((s) => isFinite(s.ra) && isFinite(s.dec));
}
/** CatWISE2020 sources (WISE + NEOWISE 2010–2018; positions at epoch 2015.4, motions in arcsec/yr), brightest W2 first */
export async function catwise(ra: number, dec: number, radiusArcsec: number, max = 400): Promise<CatSource[]> {
  const rows = await vizier("II/365/catwise", ra, dec, radiusArcsec, "Name,RAPMdeg,DEPMdeg,pmRA,pmDE,W1mproPM,W2mproPM", "W2mproPM", max);
  return rows.map((r) => ({ ra: num(r.RAPMdeg), dec: num(r.DEPMdeg), pmra: num(r.pmRA) || 0, pmdec: num(r.pmDE) || 0, plx: null,
    mag: isFinite(num(r.W2mproPM)) ? num(r.W2mproPM) : null, mag2: isFinite(num(r.W1mproPM)) ? num(r.W1mproPM) : null, epoch: 2015.4, id: `CWISE ${r.Name}` })).filter((s) => isFinite(s.ra) && isFinite(s.dec));
}

/** 2MASS point sources (1997–2001): J, H, Ks magnitudes — independent brightness anchors for the on-the-fly spectrum */
export async function twomass(ra: number, dec: number, radiusArcsec: number, max = 300): Promise<(CatSource & { j: number; h: number; k: number })[]> {
  const rows = await vizier("II/246/out", ra, dec, radiusArcsec, "2MASS,RAJ2000,DEJ2000,Jmag,Hmag,Kmag", "Kmag", max);
  return rows.map((r) => ({ ra: num(r.RAJ2000), dec: num(r.DEJ2000), pmra: 0, pmdec: 0, plx: null, mag: num(r.Kmag), epoch: 1999.5, id: `2MASS J${r["2MASS"]}`, j: num(r.Jmag), h: num(r.Hmag), k: num(r.Kmag) })).filter((s) => isFinite(s.ra));
}
/** catalogue magnitudes -> flux density (mJy) at the band's wavelength (Vega zero points: 2MASS Cohen+ 2003, WISE Jarrett+ 2011) */
export const BANDS = { J: { um: 1.235, zp: 1594 }, H: { um: 1.662, zp: 1024 }, Ks: { um: 2.159, zp: 666.7 }, W1: { um: 3.353, zp: 309.54 }, W2: { um: 4.603, zp: 171.787 } } as const;
export const magToMjy = (mag: number, band: keyof typeof BANDS) => BANDS[band].zp * Math.pow(10, -0.4 * mag) * 1000;
export function angSep(ra1: number, dec1: number, ra2: number, dec2: number) {
  const dx = (ra1 - ra2) * Math.cos(((dec1 + dec2) / 2) * D2R) * 3600, dy = (dec1 - dec2) * 3600; return Math.hypot(dx, dy);
}

// ---------------------------------------------------------------- names
/** SIMBAD's object-type codes in plain words (the common ones; others are shown as they are) */
const OTYPES: Record<string, string> = { "BD*": "brown dwarf", "LM*": "low-mass star", "PM*": "high proper-motion star", "BY*": "red dwarf (BY Draconis variable)", "TT*": "young star (T Tauri)", "Or*": "young star (Orion variable)",
  "Y*O": "young stellar object", "Mi*": "Mira variable", "LP*": "long-period variable", "AB*": "asymptotic giant branch star", "RG*": "red giant", "C*": "carbon star", "S*": "S-type star", "V*": "variable star", "Pu*": "pulsating variable",
  "RR*": "RR Lyrae variable", "Ce*": "Cepheid", "dS*": "δ Scuti variable", "Er*": "eruptive variable", "Ro*": "rotating variable", "EB*": "eclipsing binary", "SB*": "spectroscopic binary", "**": "double star", "WD*": "white dwarf",
  "Em*": "emission-line star", "Be*": "Be star", "HB*": "horizontal-branch star", "sg*": "supergiant", "*": "star", "No*": "nova", "SN*": "supernova", "PN": "planetary nebula", "HII": "H II region", "SNR": "supernova remnant", "MoC": "molecular cloud",
  "GlC": "globular cluster", "OpC": "open cluster", "Cl*": "star cluster", "G": "galaxy", "GiC": "galaxy in a cluster", "GiG": "galaxy in a group", "AGN": "active galaxy", "Sy1": "Seyfert 1 galaxy", "Sy2": "Seyfert 2 galaxy", "QSO": "quasar", "BLL": "BL Lac object",
  "Bla": "blazar", "rG": "radio galaxy", "ClG": "galaxy cluster", "Pl": "exoplanet", "IR": "infrared source", "X": "X-ray source", "Rad": "radio source" };
const otypeWords = (c?: string | null) => (c ? OTYPES[c.trim()] ?? c.trim() : undefined);
export type Resolved = Target & { otype?: string; sptype?: string; plx?: number; source: string };
/** resolve an object name with CDS Sesame (SIMBAD, then NED, then VizieR). SIMBAD positions are ICRS at epoch J2000. */
export async function resolveName(name: string): Promise<Resolved | null> {
  const t = await firstOk(SESAME, (b) => text(`${b}/-oI/SNV?${encodeURIComponent(name)}`)).catch(() => "");
  const j = t.match(/^%J\s+(-?[\d.]+)\s+([+-]?[\d.]+)/m); if (!j) return null;
  const p = t.match(/^%P\s+(-?[\d.]+)\s+(-?[\d.]+)/m), x = t.match(/^%X\s+(-?[\d.]+)/m), c = t.match(/^%C\.0\s+(.+)$/m), s = t.match(/^%S\s+(\S+)/m), i = t.match(/^%I\.0\s+(.+)$/m);
  return { ra: +j[1], dec: +j[2], pmra: p ? +p[1] / 1000 : 0, pmdec: p ? +p[2] / 1000 : 0, epoch: 2000.0, name: (i?.[1] ?? name).replace(/^(NAME|V\*|\*)\s+/, "").trim(),
    plx: x ? +x[1] : undefined, otype: otypeWords(c?.[1]), sptype: s?.[1], source: "SIMBAD" };
}

/** Is a known fast mover passing through this position? Coordinates in papers are quoted at very different epochs, and
 *  a nearby brown dwarf drifts arcminutes in a decade — so a typed position may be where the object WAS. We look for
 *  SIMBAD objects moving > 0.3″/yr whose track (1990–2030) comes within `tol` arcsec of the position. */
export async function knownMoverNear(ra: number, dec: number, tol = 20): Promise<(Resolved & { year: number; sep: number }) | null> {
  const q = `SELECT TOP 40 main_id, ra, dec, pmra, pmdec, plx_value, otype, sp_type FROM basic WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra.toFixed(6)}, ${dec.toFixed(6)}, 0.12)) = 1 AND pmra IS NOT NULL AND (pmra * pmra + pmdec * pmdec) > 90000`;
  const j = await firstOk(SIMBAD_TAP, (b) => text(`${b}?request=doQuery&lang=adql&format=json&query=${encodeURIComponent(q)}`).then((s) => JSON.parse(s))).catch(() => null);
  let best: (Resolved & { year: number; sep: number }) | null = null;
  for (const r of (j?.data ?? []) as any[]) {
    const [id, ra0, dec0, pmra, pmdec, plx, otype, sp] = r, cosd = Math.cos(dec * D2R);
    // closest approach of the linear track to the typed position (offsets in arcsec; SIMBAD epoch is J2000)
    const dx = (ra - ra0) * cosd * 3600, dy = (dec - dec0) * 3600, mu2 = (pmra * pmra + pmdec * pmdec) / 1e6;
    const tc = Math.max(-10, Math.min(30, (dx * pmra / 1000 + dy * pmdec / 1000) / mu2));
    const sep = Math.hypot(dx - (pmra / 1000) * tc, dy - (pmdec / 1000) * tc);
    if (sep <= tol && (!best || sep < best.sep)) best = { ra: ra0, dec: dec0, pmra: pmra / 1000, pmdec: pmdec / 1000, epoch: 2000.0, name: String(id).replace(/^(NAME|V\*|\*)\s+/, "").trim(),
      plx: plx ?? undefined, otype: otypeWords(otype), sptype: sp ?? undefined, source: "SIMBAD", year: 2000 + tc, sep };
  }
  return best;
}

// ---------------------------------------------------------------- coordinates as people type them
/** "269.45 4.69", "17 57 48.5 +04 41 36", "17h57m48.5s +04d41m36s", "08:55:10.83 -07:14:42.5" -> degrees; null if not coordinates */
export function parseCoords(q: string): [number, number] | null {
  const s = q.trim().replace(/[−–]/g, "-").replace(/,/g, " ");
  const dec2 = s.match(/^([+-]?\d+(?:\.\d+)?)\s*(?:d|deg|°)?\s+([+-]?\d+(?:\.\d+)?)\s*(?:d|deg|°)?$/i);
  if (dec2) { const ra = +dec2[1], dec = +dec2[2]; return ra >= 0 && ra <= 360 && Math.abs(dec) <= 90 ? [ra, dec] : null; }
  const parts = s.replace(/[hms°'"′″d:]/gi, " ").trim().split(/\s+/);
  if (parts.length !== 6 || parts.some((p) => !/^[+-]?\d+(\.\d+)?$/.test(p))) return null;
  const v = parts.map(Number), sign = parts[3].startsWith("-") ? -1 : 1;
  const ra = (v[0] + v[1] / 60 + v[2] / 3600) * 15, dec = sign * (Math.abs(v[3]) + v[4] / 60 + v[5] / 3600);
  return ra >= 0 && ra <= 360 && Math.abs(dec) <= 90 ? [ra, dec] : null;
}

// ---------------------------------------------------------------- the five challenge targets (SIMBAD, ICRS, epoch J2000)
export type Challenge = Resolved & { key: string; name: string; otype: string; blurb: string; test: string; fov: number; lit: string; frames?: number; tab?: "spectrum" | "light" | "motion" };
export const CHALLENGE: Challenge[] = [
  { key: "barnard", name: "Barnard's Star", ra: 269.45207696, dec: 4.69336497, pmra: -0.801551, pmdec: 10.362394, epoch: 2000, plx: 546.976, sptype: "M4V", otype: "red dwarf", source: "Gaia DR3 via SIMBAD",
    blurb: "The fastest-moving star in the sky", test: "10.4″ per year: it shifts by more than a pixel between SPHEREx visits. So bright that it saturates — watch the OVERFLOW flag.", fov: 32, lit: "Gaia DR3", tab: "motion" },
  { key: "eps-indi-b", name: "Epsilon Indi B", ra: 331.04414659, dec: -56.7828442, pmra: 3.981977, pmdec: -2.466832, epoch: 2000, plx: 270.658, sptype: "T1+T6", otype: "brown-dwarf pair", source: "Gaia DR3 via SIMBAD",
    blurb: "Two brown dwarfs orbiting a nearby star", test: "A methane world: it nearly vanishes at 3.3 µm and returns at 4 µm. MIRA measures its motion and parallax from SPHEREx frames alone.", fov: 32, lit: "Gaia DR3" },
  { key: "wise-0855", name: "WISE 0855−0714", ra: 133.81890825, dec: -7.247048, pmra: -8.1237, pmdec: 0.6732, epoch: 2000, plx: 439.0, sptype: "Y", otype: "coldest known brown dwarf", source: "Kirkpatrick et al. 2021 via SIMBAD",
    blurb: "The coldest known brown dwarf (~285 K)", test: "Invisible below 4 µm and 8.1″ per year fast: only SPHEREx's two reddest detectors, stacked along its motion, can show it.", fov: 32, lit: "Kirkpatrick+ 2021" },
  { key: "rw-aur", name: "RW Aurigae", ra: 76.95652603, dec: 30.40143817, pmra: 0.00723, pmdec: -0.02033, epoch: 2000, plx: 15.42, sptype: "K1–K5e", otype: "T Tauri binary", source: "SIMBAD",
    blurb: "A young star dimmed by its own dust", test: "A variable: its infrared light is compared visit to visit at matched wavelengths. It saturates, so MIRA measures its halo.", fov: 32, lit: "van Leeuwen 2007", frames: 144, tab: "light" },
  { key: "r-dra", name: "R Draconis", ra: 248.16761083, dec: 66.75497942, pmra: -0.020643, pmdec: 0.006149, epoch: 2000, plx: 1.2509, sptype: "M5–M9e", otype: "Mira variable, period 246 d", source: "Gaia DR3 via SIMBAD",
    blurb: "A pulsating red giant near the ecliptic pole", test: "Near the ecliptic pole, where SPHEREx returns week after week: watch it brighten tenfold at 1 µm while barely changing at 4 µm.", fov: 32, lit: "Gaia DR3", frames: 144, tab: "light" },
];
