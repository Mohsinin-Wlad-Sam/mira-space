// BLINK engine — any RA/Dec -> sky-registered SPHEREx frames, built in the browser from NASA's public archive.
//
//   1. static exposure index (census/sphx_index2.py, from IRSA's TAP inventory)  -> exposures whose footprint covers the position
//   2. per exposure: one HTTP Range read of the FITS header (TAN-SIP astrometry, timing, PSF width)
//   3. one Range read of only the detector rows that the requested field needs
//   4. resampling onto a common north-up, east-left tangent-plane grid centred on the requested position, so that
//      successive frames can be blinked, added and subtracted (SPHEREx rolls between visits: raw frames are rotated)
//   5. wavelength at each position from the detector's linear-variable-filter map; contamination flags from the
//      Rice-compressed FLAGS extension (only the rows around the target)
//
// Nothing is proxied or re-hosted: all pixels come straight from s3://nasa-irsa-spherex (public, CORS-enabled).
import { riceDecode32 } from "./rice";

export const S3 = "https://nasa-irsa-spherex.s3.amazonaws.com/";
export const PIX_ARCSEC = 6.15;                       // SPHEREx detector pixel scale
const D2R = Math.PI / 180;
const OMEGA_PIX = Math.pow(PIX_ARCSEC / 206264.806, 2); // pixel solid angle (sr): MJy/sr × Ω × 1e9 -> mJy per pixel
export const MJYSR_TO_MJY = OMEGA_PIX * 1e9;

export const DETECTORS = [
  { det: 1, lo: 0.75, hi: 1.12 }, { det: 2, lo: 1.10, hi: 1.66 }, { det: 3, lo: 1.64, hi: 2.44 },
  { det: 4, lo: 2.42, hi: 3.86 }, { det: 5, lo: 3.82, hi: 4.44 }, { det: 6, lo: 4.42, hi: 5.02 },
];

/** position (deg, ICRS) at `epoch` (Julian year) with proper motion in arcsec/yr (pmra includes cos δ) */
export type Target = { ra: number; dec: number; pmra?: number; pmdec?: number; epoch?: number; name?: string };
export type Exposure = { mjd: number; det: number; url: string; id: string; rel: string; poly: number[]; nin: number };
export type IndexInfo = { exposures: Exposure[]; total: number[]; nside: number; version: number };
export type IndexMeta = { exposures: number; releases: Record<string, number>; first: string; last: string; built: string; nside: number };

export type Frame = {
  exp: Exposure; mjd: number; det: number; visit: number;
  lam: number; bw: number;                            // wavelength and bandwidth (µm) at the target's position on the detector
  img: Float32Array;                                  // N×N, row 0 = north edge, column 0 = east edge; MJy/sr, sky background removed
  bg: number; noise: number;                          // removed background and robust pixel noise (MJy/sr)
  tx: number; ty: number;                             // predicted target position in the stamp (pixels) at this epoch
  aff: number[];                                      // stamp (i, j) -> detector (x, y): [x0, dx/di, dx/dj, y0, dy/di, dy/dj]
  flags: number; flagsNear: number;                   // OR of the flag bits within 1.5 px / 3.5 px of the target; -1 = not read
  psf: number; exptime: number; obsid: string; dateObs: string; version: string; roll: number;
  flagsAt?: { start: number; heap: number; ver: string; n1: number; n2: number }; // where this file's FLAGS table and heap begin, and the detector size (for on-demand masks)
};

export const mjdToYear = (mjd: number) => 2000 + (mjd - 51544.5) / 365.25;
export const mjdToDate = (mjd: number) => new Date((mjd - 40587) * 86400000).toISOString().slice(0, 10);

export function propagate(t: Target, mjd: number): [number, number] {
  if (!t.pmra && !t.pmdec) return [t.ra, t.dec];
  const dy = mjdToYear(mjd) - (t.epoch ?? 2016.0);
  return [t.ra + ((t.pmra ?? 0) / 3600) * dy / Math.cos(t.dec * D2R), t.dec + ((t.pmdec ?? 0) / 3600) * dy];
}

// ---------------------------------------------------------------- HEALPix nested ang2pix (nside a power of two)
export function ang2pixNest(nside: number, ra: number, dec: number) {
  const z = Math.sin(dec * D2R), phi = (((ra % 360) + 360) % 360) * D2R, za = Math.abs(z), tt = (phi / (Math.PI / 2)) % 4;
  let face: number, ix: number, iy: number;
  if (za <= 2 / 3) {
    const t1 = nside * (0.5 + tt), t2 = nside * (z * 0.75), jp = Math.floor(t1 - t2), jm = Math.floor(t1 + t2);
    const ifp = Math.floor(jp / nside), ifm = Math.floor(jm / nside);
    face = ifp === ifm ? ifp | 4 : ifp < ifm ? ifp : ifm + 8;
    ix = jm & (nside - 1); iy = nside - (jp & (nside - 1)) - 1;
  } else {
    const ntt = Math.min(3, Math.floor(tt)), tp = tt - ntt, tmp = nside * Math.sqrt(3 * (1 - za));
    const jp = Math.min(Math.floor(tp * tmp), nside - 1), jm = Math.min(Math.floor((1 - tp) * tmp), nside - 1);
    if (z >= 0) { face = ntt; ix = nside - jm - 1; iy = nside - jp - 1; } else { face = ntt + 8; ix = jp; iy = jm; }
  }
  let ipf = 0;
  for (let b = 0; 1 << b < nside; b++) { ipf |= ((ix >> b) & 1) << (2 * b); ipf |= ((iy >> b) & 1) << (2 * b + 1); }
  return face * nside * nside + ipf;
}

/** is (ra, dec) inside the convex footprint polygon [ra1, dec1, ...]? (gnomonic projection about the point) */
export function inFootprint(ra: number, dec: number, poly: number[]) {
  const a0 = ra * D2R, d0 = dec * D2R, pts: [number, number][] = [];
  for (let k = 0; k < poly.length; k += 2) {
    const a = poly[k] * D2R, d = poly[k + 1] * D2R, c = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
    if (c <= 0) return false;
    pts.push([(Math.cos(d) * Math.sin(a - a0)) / c, (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / c]);
  }
  let sgn = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length], s = Math.sign(x1 * y2 - x2 * y1);
    if (!s) continue;
    if (!sgn) sgn = s; else if (s !== sgn) return false;
  }
  return true;
}

// ---------------------------------------------------------------- exposure index
let BASE = "/";
export function setBase(b: string) { BASE = b; }
let metaP: Promise<IndexMeta | null> | null = null;
export function indexMeta(): Promise<IndexMeta | null> {
  return (metaP ??= fetch(`${BASE}data/sphx2/meta.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
}
async function getJson(url: string) {
  const r = await fetch(url);
  if (!r.ok || (r.headers.get("content-type") ?? "").includes("html")) return null;
  return r.json();
}
/** exposures listed for the sky patch containing (ra, dec); v2 index (nside 32) with v1 (nside 16) as fallback */
export async function findExposures(ra: number, dec: number): Promise<IndexInfo> {
  const v2 = await getJson(`${BASE}data/sphx2/${ang2pixNest(32, ra, dec)}.json`).catch(() => null);
  if (v2) {
    const roots = (v2.roots as string[]).map((r) => { const [rel, path] = r.split("|"), [week, ver] = path.split("/"); return { rel, week, ver }; });
    const exposures = (v2.e as [number, number, number, string, number[], number][]).map(([mjd, det, ri, tail, poly, nin]) => {
      const { rel, week, ver } = roots[ri], [seq, k] = tail.split("_");
      return { mjd, det, rel, poly, nin, id: `${week}_${seq}_${k}D${det}`, url: `${S3}${rel}/level2/${week}/${ver}/${det}/level2_${week}_${seq}_${k}D${det}_spx_${ver}.fits` };
    });
    return { exposures, total: v2.tot, nside: 32, version: 2 };
  }
  const v1 = await getJson(`${BASE}data/sphx/${ang2pixNest(16, ra, dec)}.json`).catch(() => null);
  if (!v1) throw new Error("The SPHEREx exposure index is not available");
  const exposures = (v1.e as [number, number, string, number[]][]).map(([mjd, det, p, poly]) => {
    const [rel, path] = p.split("|"), [week, ver, d, sd] = path.split("/"), [seq, dd] = sd.split("_");
    return { mjd, det, rel, poly, nin: 0, id: `${week}_${seq}_${dd}`, url: `${S3}${rel}/level2/${week}/${ver}/${d}/level2_${week}_${seq}_${dd}_spx_${ver}.fits` };
  });
  return { exposures, total: [], nside: 16, version: 1 };
}

/** exposures that really contain the (moving) target, thinned to `max`: every detector, every visit, evenly in time */
export function chooseExposures(all: Exposure[], t: Target, max: number, dets?: Set<number>): { cover: Exposure[]; pick: Exposure[] } {
  const cover = all.filter((e) => { const [ra, dec] = propagate(t, e.mjd); return inFootprint(ra, dec, e.poly); }).sort((a, b) => a.mjd - b.mjd);
  const wanted = cover.filter((e) => !dets || dets.has(e.det));
  if (wanted.length <= max) return { cover, pick: wanted };
  const byDet = new Map<number, Exposure[]>();
  wanted.forEach((e) => (byDet.get(e.det) ?? byDet.set(e.det, []).get(e.det)!).push(e));
  const per = Math.max(2, Math.floor(max / byDet.size)), pick: Exposure[] = [];
  for (const L of byDet.values()) {
    if (L.length <= per) { pick.push(...L); continue; }
    // split into visits (gaps > 20 days) and share the budget between them
    const visits: Exposure[][] = [[]];
    L.forEach((e, k) => { if (k && e.mjd - L[k - 1].mjd > 20) visits.push([]); visits[visits.length - 1].push(e); });
    const quota = visits.map(() => 0);
    for (let left = per, guard = 0; left > 0 && guard < 1000; guard++) { const i = guard % visits.length; if (quota[i] < visits[i].length) { quota[i]++; left--; } else if (quota.every((q, j) => q >= visits[j].length)) break; }
    // within a visit the exposures step across the filter, so position in the visit is wavelength: stagger the picks
    // from visit to visit, otherwise every visit samples the same few wavelengths and leaves the same gaps
    visits.forEach((v, i) => { const q = quota[i], ph = (i + 0.5) / visits.length; for (let k = 0; k < q; k++) pick.push(v[Math.min(v.length - 1, Math.floor(((k + ph) / q) * v.length))]); });
  }
  return { cover, pick: [...new Set(pick)].sort((a, b) => a.mjd - b.mjd) };
}

// ---------------------------------------------------------------- FITS headers
type Hdr = Record<string, number | string>;
function parseCards(buf: Uint8Array, start: number): { h: Hdr; end: number } | null {
  const td = new TextDecoder("ascii"), h: Hdr = {};
  for (let p = start; p + 80 <= buf.length; p += 80) {
    const card = td.decode(buf.subarray(p, p + 80));
    let key = card.slice(0, 8).trim(), rest: string;
    if (key === "END") return { h, end: Math.ceil((p + 80) / 2880) * 2880 };
    if (key === "HIERARCH") { const eq = card.indexOf("="); if (eq < 0) continue; key = card.slice(9, eq).trim(); rest = card.slice(eq + 1); }
    else if (card[8] === "=") rest = card.slice(10);
    else continue;
    let v = rest.trim();
    if (v.startsWith("'")) { const q = v.indexOf("'", 1); h[key] = v.slice(1, q < 0 ? undefined : q).trim(); }
    else { const sl = v.indexOf("/"); if (sl >= 0) v = v.slice(0, sl).trim(); h[key] = v === "T" ? 1 : v === "F" ? 0 : +v; }
  }
  return null;
}
async function range(url: string, a: number, b: number, signal?: AbortSignal): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` }, signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      if ((e as Error).name === "AbortError" || attempt >= 2) throw e;
      await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
    }
  }
}

// ---------------------------------------------------------------- astrometry: TAN + SIP
type Wcs = { a0: number; d0: number; m: number[]; inv: number[]; crpix: [number, number]; A: [number, number, number][]; B: [number, number, number][]; n1: number; n2: number };
function wcsOf(h: Hdr): Wcs {
  const c1 = +(h.CDELT1 ?? 1), c2 = +(h.CDELT2 ?? 1);
  const m11 = h.CD1_1 !== undefined ? +h.CD1_1 : +(h.PC1_1 ?? 1) * c1, m12 = h.CD1_2 !== undefined ? +h.CD1_2 : +(h.PC1_2 ?? 0) * c1;
  const m21 = h.CD2_1 !== undefined ? +h.CD2_1 : +(h.PC2_1 ?? 0) * c2, m22 = h.CD2_2 !== undefined ? +h.CD2_2 : +(h.PC2_2 ?? 1) * c2;
  const det = m11 * m22 - m12 * m21;
  const sip = (pre: string) => { const out: [number, number, number][] = [], ord = +(h[`${pre}_ORDER`] ?? 0);
    for (let p = 0; p <= ord; p++) for (let q = 0; q <= ord - p; q++) { const v = h[`${pre}_${p}_${q}`]; if (v !== undefined && +v !== 0) out.push([p, q, +v]); }
    return out; };
  return { a0: +h.CRVAL1 * D2R, d0: +h.CRVAL2 * D2R, m: [m11, m12, m21, m22], inv: [m22 / det, -m12 / det, -m21 / det, m11 / det],
    crpix: [+h.CRPIX1, +h.CRPIX2], A: sip("A"), B: sip("B"), n1: +h.NAXIS1, n2: +h.NAXIS2 };
}
const poly2 = (c: [number, number, number][], u: number, v: number) => { let s = 0; for (const [p, q, k] of c) s += k * Math.pow(u, p) * Math.pow(v, q); return s; };
/** sky (deg) -> 0-based detector pixel. The forward SIP polynomials (A, B) are inverted by fixed-point iteration. */
function worldToPix(w: Wcs, ra: number, dec: number): [number, number] {
  const a = ra * D2R, d = dec * D2R, sd0 = Math.sin(w.d0), cd0 = Math.cos(w.d0), cosc = sd0 * Math.sin(d) + cd0 * Math.cos(d) * Math.cos(a - w.a0);
  const xi = (Math.cos(d) * Math.sin(a - w.a0)) / cosc / D2R, eta = (cd0 * Math.sin(d) - sd0 * Math.cos(d) * Math.cos(a - w.a0)) / cosc / D2R;
  const U = w.inv[0] * xi + w.inv[1] * eta, V = w.inv[2] * xi + w.inv[3] * eta;        // = u + A(u,v), v + B(u,v)
  let u = U, v = V;
  if (w.A.length || w.B.length) for (let it = 0; it < 5; it++) { const nu = U - poly2(w.A, u, v), nv = V - poly2(w.B, u, v); u = nu; v = nv; }
  return [w.crpix[0] + u - 1, w.crpix[1] + v - 1];
}
/** tangent-plane offsets (deg; ξ east, η north) about (ra0, dec0) -> sky */
function tanToSky(ra0: number, dec0: number, xi: number, eta: number): [number, number] {
  const x = xi * D2R, y = eta * D2R, d0 = dec0 * D2R, den = Math.cos(d0) - y * Math.sin(d0);
  return [ra0 + Math.atan2(x, den) / D2R, Math.atan2(Math.sin(d0) + y * Math.cos(d0), Math.hypot(x, den)) / D2R];
}
/** sky -> stamp pixel (i right = west, j down = south) for a stamp of N pixels centred on (ra0, dec0) */
export function skyToStamp(ra0: number, dec0: number, N: number, ra: number, dec: number): [number, number] {
  const a = ra * D2R, d = dec * D2R, a0 = ra0 * D2R, d0 = dec0 * D2R, cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  const xi = (Math.cos(d) * Math.sin(a - a0)) / cosc / D2R, eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc / D2R;
  const s = PIX_ARCSEC / 3600, c = (N - 1) / 2;
  return [c - xi / s, c - eta / s];
}
export function stampToSky(ra0: number, dec0: number, N: number, i: number, j: number): [number, number] {
  const s = PIX_ARCSEC / 3600, c = (N - 1) / 2;
  return tanToSky(ra0, dec0, -(i - c) * s, -(j - c) * s);
}

// ---------------------------------------------------------------- wavelength (linear variable filter)
type LvfTable = { grid: number[]; lam: number[][]; bw: number[][] };
let LVF: Record<string, LvfTable> | null = null;
export async function loadLvf() { LVF ??= (await (await fetch(`${BASE}space/lvf.json`)).json()).det; }
/** central wavelength and bandwidth (µm) seen by detector pixel (x, y) */
export function lvfAt(det: number, x: number, y: number): [number, number] {
  const t = LVF?.[String(det)]; if (!t) return [NaN, NaN];
  const g = t.grid, n = g.length, fx = Math.min(n - 1.001, Math.max(0, (x / g[n - 1]) * (n - 1))), fy = Math.min(n - 1.001, Math.max(0, (y / g[n - 1]) * (n - 1)));
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
  const bil = (M: number[][]) => M[j][i] * (1 - u) * (1 - v) + M[j][i + 1] * u * (1 - v) + M[j + 1][i] * (1 - u) * v + M[j + 1][i + 1] * u * v;
  return [bil(t.lam), bil(t.bw)];
}
/** wavelength at stamp position (i, j) of a frame */
export function lamAt(f: Frame, i: number, j: number): [number, number] {
  const a = f.aff; return lvfAt(f.det, a[0] + a[1] * i + a[2] * j, a[3] + a[4] * i + a[5] * j);
}

// ---------------------------------------------------------------- contamination flags
export type FlagDef = { bit: number; name: string; desc: string };
/** flag planes of SPHEREx L2 (pipeline 7.x); replaced by the definitions found in each file's FLAGS header (MSKN/MSKD) */
export let FLAG_DEFS: FlagDef[] = [
  [0, "TRANSIENT", "Transient detected during sample-up-the-ramp"], [1, "OVERFLOW", "Overflow (saturation) detected during sample-up-the-ramp"],
  [2, "SUR_ERROR", "Error in onboard processing"], [6, "NONFUNC", "Permanently unusable"], [7, "DICHROIC", "Low efficiency due to dichroic"],
  [9, "MISSING_DATA", "Onboard data lost"], [10, "HOT", "Hot pixel"], [11, "COLD", "Anomalously low signal"], [12, "FULLSAMPLE", "Pixel full sample history is available"],
  [14, "PHANMISS", "Phantom correction was not applied"], [15, "NONLINEAR", "Nonlinearity correction cannot be applied reliably"], [17, "PERSIST", "Persistent charge above threshold"],
  [19, "OUTLIER", "Pixel flagged by Detect Outliers"], [20, "CROSSTALK", "Pixel affected by crosstalk"], [21, "SOURCE", "Pixel mapped to a known source"],
  [22, "GHOST", "Affected by a bright source inside the exposure"], [23, "GHOST_FPA", "Affected by a bright source on another detector"],
  [24, "GHOST_EXT", "Affected by a bright source outside the field of view"], [25, "STREAK", "Pixel affected by a streak"], [26, "BLOOM", "Pixel part of a bloom artifact"],
  [27, "SNOWBALL", "Pixel part of a snowball artifact"], [28, "HALO", "Pixel part of a transient halo"],
].map(([bit, name, desc]) => ({ bit: bit as number, name: name as string, desc: desc as string }));
/** informational planes: they describe the pixel but do not mean the measurement is compromised */
export const INFO_FLAGS = new Set(["SOURCE", "FULLSAMPLE"]);
/** restore flag definitions that were read from a file's header in an earlier session (fields kept in the browser) */
export function setFlagDefs(d: { bit: number; name: string; desc: string }[] | null | undefined) { if (d?.length) FLAG_DEFS = d; }
export const badMask = () => FLAG_DEFS.filter((d) => !INFO_FLAGS.has(d.name)).reduce((m, d) => m | (1 << d.bit), 0);
export const flagNames = (v: number, onlyBad = false) => (v < 0 ? [] : FLAG_DEFS.filter((d) => v & (1 << d.bit) && !(onlyBad && INFO_FLAGS.has(d.name))).map((d) => d.name));

const flagHdrCache = new Map<string, { hdrLen: number; theap: number; block: number }>();   // by pipeline version
async function flagsLayout(url: string, ver: string, flagsStart: number, signal?: AbortSignal) {
  const hit = flagHdrCache.get(ver); if (hit) return hit;
  let buf = await range(url, flagsStart, flagsStart + 23039, signal), p = parseCards(buf, 0);
  if (!p) { buf = await range(url, flagsStart, flagsStart + 57599, signal); p = parseCards(buf, 0); }
  // if a future pipeline reorders the extensions or changes the compression, flags are reported as "not read" instead of being misread
  if (!p || p.h.ZCMPTYPE !== "RICE_1" || +p.h.ZTILE2 !== 1 || (p.h.EXTNAME !== undefined && !/FLAG/i.test(String(p.h.EXTNAME)))) throw new Error("unexpected FLAGS layout");
  const defs: FlagDef[] = [];
  for (const k of Object.keys(p.h)) if (k.startsWith("MSKN")) { const n = k.slice(4), bit = Math.round(Math.log2(+(p.h[`MSKM${n}`] ?? 2 ** +n))); defs.push({ bit, name: String(p.h[k]), desc: String(p.h[`MSKD${n}`] ?? "") }); }
  if (defs.length) FLAG_DEFS = defs.sort((a, b) => a.bit - b.bit);
  const lay = { hdrLen: p.end, theap: +(p.h.THEAP ?? +p.h.NAXIS1 * +p.h.NAXIS2), block: +(p.h.ZVAL1 ?? 32) };
  flagHdrCache.set(ver, lay); return lay;
}
type RowDesc = { len: number; off: number };
/** descriptors (length, heap offset) of the compressed flag rows y0..y1: 8 bytes per row, one small request */
async function readFlagDesc(url: string, at: NonNullable<Frame["flagsAt"]>, n1: number, y0: number, y1: number, signal?: AbortSignal): Promise<RowDesc[]> {
  const desc = await range(url, at.start + 8 * y0, at.start + 8 * (y1 + 1) - 1, signal), dv = new DataView(desc.buffer, desc.byteOffset, desc.byteLength);
  const rows: RowDesc[] = [];
  for (let k = 0; k <= y1 - y0; k++) rows.push({ len: dv.getInt32(8 * k, false), off: dv.getInt32(8 * k + 4, false) });
  if (rows.some((r) => !(r.len > 0) || r.len > n1 * 5 || r.off < 0)) throw new Error("bad FLAGS descriptors");
  return rows;
}
/** decode the wanted rows (indices into `desc`); neighbouring rows are fetched together */
async function readFlagHeap(url: string, at: NonNullable<Frame["flagsAt"]>, n1: number, desc: RowDesc[], want: number[], signal?: AbortSignal): Promise<Map<number, Int32Array>> {
  const lay = flagHdrCache.get(at.ver)!, out = new Map<number, Int32Array>(), w = [...new Set(want)].filter((k) => k >= 0 && k < desc.length).sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const k of w) { const last = runs[runs.length - 1]; if (last && k - last[last.length - 1] <= 3) last.push(k); else runs.push([k]); }
  await Promise.all(runs.map(async (run) => {
    const lo = Math.min(...run.map((k) => desc[k].off)), hi = Math.max(...run.map((k) => desc[k].off + desc[k].len));
    const heap = await range(url, at.heap + lo, at.heap + hi - 1, signal);
    for (const k of run) out.set(k, riceDecode32(heap.subarray(desc[k].off - lo, desc[k].off - lo + desc[k].len), n1, lay.block));
  }));
  return out;
}
/** flag values for detector rows y0..y1 (inclusive) */
async function readFlagRows(url: string, at: NonNullable<Frame["flagsAt"]>, n1: number, y0: number, y1: number, signal?: AbortSignal): Promise<Int32Array[]> {
  const desc = await readFlagDesc(url, at, n1, y0, y1, signal), m = await readFlagHeap(url, at, n1, desc, desc.map((_, k) => k), signal);
  return desc.map((_, k) => m.get(k)!);
}
/** detector defects that are not sky: hot, dead or lost pixels, outliers, and cosmic-ray transients (a TRANSIENT or
 *  SUR_ERROR that comes with OVERFLOW is a saturated star, which is real and stays visible) */
function isDefect(v: number): boolean {
  const bit = (n: string) => { const d = FLAG_DEFS.find((x) => x.name === n); return d ? 1 << d.bit : 0; };
  if (v & (bit("HOT") | bit("COLD") | bit("NONFUNC") | bit("MISSING_DATA") | bit("OUTLIER") | bit("SNOWBALL"))) return true;
  return !!(v & (bit("TRANSIENT") | bit("SUR_ERROR"))) && !(v & (bit("OVERFLOW") | bit("BLOOM")));
}

// ---------------------------------------------------------------- one exposure -> one registered frame
export type ReadOpts = { size: number; center: [number, number]; flags?: boolean; signal?: AbortSignal };
/** read one exposure and resample it onto the stamp grid; null if the field falls off the detector */
export async function readFrame(exp: Exposure, t: Target, o: ReadOpts): Promise<Frame | null> {
  const N = o.size, [ra0, dec0] = o.center;
  let head = await range(exp.url, 0, 40319, o.signal);
  const p0 = parseCards(head, 0); if (!p0) throw new Error("FITS primary header");
  let p1 = parseCards(head, p0.end);
  if (!p1) { head = await range(exp.url, 0, 86399, o.signal); p1 = parseCards(head, p0.end); }
  if (!p1) throw new Error("FITS image header");
  const h = p1.h, w = wcsOf(h), dataStart = p1.end;
  if (+h.BITPIX !== -32 || +h.NAXIS !== 2) throw new Error("unexpected IMAGE layout");
  const bscale = +(h.BSCALE ?? 1), bzero = +(h.BZERO ?? 0);

  // detector coordinates of every stamp pixel
  const X = new Float32Array(N * N), Y = new Float32Array(N * N);
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const [ra, dec] = stampToSky(ra0, dec0, N, i, j), [x, y] = worldToPix(w, ra, dec), k = j * N + i;
    X[k] = x; Y[k] = y; if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  const c = (N - 1) / 2, [cx, cy] = worldToPix(w, ra0, dec0);
  if (cx < 3 || cy < 3 || cx > w.n1 - 4 || cy > w.n2 - 4) return null;       // field centre not on the detector
  const y0 = Math.max(0, Math.floor(ymin)), y1 = Math.min(w.n2 - 1, Math.ceil(ymax) + 1);
  const x0 = Math.max(0, Math.floor(xmin)), x1 = Math.min(w.n1 - 1, Math.ceil(xmax) + 1), nx = x1 - x0 + 1, ny = y1 - y0 + 1;
  if (nx < 2 || ny < 2) return null;

  // the target on the detector (it may move between exposures)
  const [tra, tdec] = propagate(t, exp.mjd), [tdx, tdy] = worldToPix(w, tra, tdec), [tx, ty] = skyToStamp(ra0, dec0, N, tra, tdec);
  const onDet = tdx >= 2 && tdy >= 2 && tdx <= w.n1 - 3 && tdy <= w.n2 - 3;

  const rowsP = range(exp.url, dataStart + y0 * w.n1 * 4, dataStart + (y1 + 1) * w.n1 * 4 - 1, o.signal);
  // flags live in a Rice-compressed table, one detector row per tile: fetch the row directory now, the rows we need later
  const ver = String(h.VERSION ?? p0.h.VERSION ?? "") + "|" + exp.url.split("/").slice(-3, -2)[0] + "|" + dataStart;
  const flagsStart = dataStart + Math.ceil((w.n1 * w.n2 * 4) / 2880) * 2880;
  let flags = -1, flagsNear = -1, flagsAt: Frame["flagsAt"];
  const descP = o.flags === false ? null : (async () => {
    const lay = await flagsLayout(exp.url, ver, flagsStart, o.signal);
    flagsAt = { start: flagsStart + lay.hdrLen, heap: flagsStart + lay.hdrLen + lay.theap, ver, n1: w.n1, n2: w.n2 };
    return readFlagDesc(exp.url, flagsAt, w.n1, y0, y1, o.signal);
  })().catch((e) => { if ((e as Error).name === "AbortError") throw e; return null; });
  descP?.catch(() => {});       // when the read is abandoned, the rows fail first and nobody waits for this one: its failure is expected, not an error

  const raw = await rowsP, dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const sub = new Float32Array(nx * ny);
  for (let yy = 0; yy < ny; yy++) for (let xx = 0; xx < nx; xx++) sub[yy * nx + xx] = dv.getFloat32((yy * w.n1 + x0 + xx) * 4, false) * bscale + bzero;

  // isolated spikes (one pixel far above all four neighbours) are candidates for hot pixels and cosmic rays: ask NASA's
  // flags about exactly those pixels and blank the ones marked as detector defects. Unflagged spikes are left alone —
  // they may be real (an asteroid, a flare).
  // (candidates: far above the noise and sharper than their surroundings — single hot pixels first, then pairs and
  // star cores; only what NASA flags as a defect is blanked, so real stars survive the check)
  const s0 = clippedStats(sub), cand: [number, number, number][] = [];
  if (s0.sig > 0) for (let yy = 1; yy < ny - 1; yy++) for (let xx = 1; xx < nx - 1; xx++) {
    const k = yy * nx + xx, v = sub[k] - s0.med; if (!(v > 12 * s0.sig)) continue;
    let sum = 0; for (const q of [k - 1, k + 1, k - nx, k + nx, k - nx - 1, k - nx + 1, k + nx - 1, k + nx + 1]) sum += Number.isFinite(sub[q]) ? sub[q] - s0.med : 0;
    const sharp = v / Math.max(sum / 8, s0.sig); if (sharp > 3) cand.push([xx, yy, sharp]);
  }
  const spikes = cand.sort((a, b) => b[2] - a[2]).slice(0, 24).map(([xx, yy]) => [xx, yy] as [number, number]);
  const desc = await descP;
  if (desc && flagsAt) {
    try {
      const fy = Math.round(tdy), fx = Math.round(tdx), want = spikes.map(([, yy]) => yy);
      if (onDet) for (let yy = fy - 3; yy <= fy + 3; yy++) want.push(yy - y0);
      const rows = await readFlagHeap(exp.url, flagsAt, w.n1, desc, want, o.signal);
      for (const [xx, yy] of spikes) { const r = rows.get(yy); if (r && isDefect(r[x0 + xx])) sub[yy * nx + xx] = NaN; }
      if (onDet) {
        flags = 0; flagsNear = 0;
        for (let yy = fy - 3; yy <= fy + 3; yy++) { const r = rows.get(yy - y0); if (!r) continue;
          for (let xx = Math.max(0, fx - 3); xx <= Math.min(w.n1 - 1, fx + 3); xx++) { const d = Math.hypot(xx - tdx, yy - tdy); if (d <= 3.5) flagsNear |= r[xx]; if (d <= 1.5) flags |= r[xx]; } }
      }
    } catch (e) { if ((e as Error).name === "AbortError") throw e; }
  }

  // bilinear resampling onto the north-up grid
  const img = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) {
    const fx = X[k] - x0, fy = Y[k] - y0, i0 = Math.floor(fx), j0 = Math.floor(fy);
    if (i0 < 0 || j0 < 0 || i0 >= nx - 1 || j0 >= ny - 1) { img[k] = NaN; continue; }
    const u = fx - i0, v = fy - j0, q = j0 * nx + i0;
    img[k] = sub[q] * (1 - u) * (1 - v) + sub[q + 1] * u * (1 - v) + sub[q + nx] * (1 - u) * v + sub[q + nx + 1] * u * v;
  }
  // sky background (zodiacal light dominates): sigma-clipped median of the stamp
  const { med: bg, sig: noise } = clippedStats(img);
  for (let k = 0; k < img.length; k++) img[k] -= bg;

  const at = (i: number, j: number) => [X[j * N + i], Y[j * N + i]];
  const [ax, ay] = at(0, 0), [bx, by] = at(N - 1, 0), [gx, gy] = at(0, N - 1);
  const aff = [ax, (bx - ax) / (N - 1), (gx - ax) / (N - 1), ay, (by - ay) / (N - 1), (gy - ay) / (N - 1)];
  const [lam, bw] = lvfAt(exp.det, onDet ? tdx : cx, onDet ? tdy : cy);
  return { exp, mjd: +(h["MJD-AVG"] ?? exp.mjd), det: exp.det, visit: 0, lam, bw, img, bg, noise, tx: onDet ? tx : c, ty: onDet ? ty : c, aff, flags, flagsNear, flagsAt,
    psf: +(h.PSF_FWHM ?? NaN), exptime: +(h.XPOSURE ?? NaN), obsid: String(h.OBSID ?? exp.id), dateObs: String(h["DATE-AVG"] ?? h["DATE-OBS"] ?? ""), version: String(p0.h.VERSION ?? ""),
    roll: Math.atan2(aff[4], aff[1]) / D2R };
}

/** full flag mask for a frame's stamp (nearest detector pixel), fetched on demand */
export async function readMask(f: Frame, N: number, signal?: AbortSignal): Promise<Int32Array | null> {
  if (!f.flagsAt) return null;
  const a = f.aff, ys: number[] = [], n1 = f.flagsAt.n1, n2 = f.flagsAt.n2;
  for (const [i, j] of [[0, 0], [N - 1, 0], [0, N - 1], [N - 1, N - 1]]) ys.push(a[3] + a[4] * i + a[5] * j);
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(n2 - 1, Math.ceil(Math.max(...ys)));
  const rows = await readFlagRows(f.exp.url, f.flagsAt, n1, y0, y1, signal), out = new Int32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = Math.round(a[0] + a[1] * i + a[2] * j), y = Math.round(a[3] + a[4] * i + a[5] * j);
    out[j * N + i] = y >= y0 && y <= y1 && x >= 0 && x < n1 ? rows[y - y0][x] : 0;
  }
  return out;
}

export function clippedStats(a: Float32Array): { med: number; sig: number } {
  let v = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return { med: 0, sig: 0 };
  let med = v[v.length >> 1], sig = 0;
  for (let it = 0; it < 3; it++) {
    const dev = v.map((x) => Math.abs(x - med)).sort((x, y) => x - y); sig = 1.4826 * dev[dev.length >> 1];
    if (!(sig > 0)) break;
    const lo = med - 3 * sig, hi = med + 3 * sig; v = v.filter((x) => x >= lo && x <= hi); med = v[v.length >> 1];
  }
  return { med, sig };
}

/** label visits (survey passes, separated by gaps > 20 days) in place; frames must be sorted by time */
export function labelVisits(frames: Frame[]) {
  let v = 0; frames.forEach((f, k) => { if (k && f.mjd - frames[k - 1].mjd > 20) v++; f.visit = v; });
  return v + 1;
}

// ---------------------------------------------------------------- build (parallel, progressive)
export type BuildOpts = { size: number; maxFrames: number; dets?: Set<number>; signal?: AbortSignal; concurrency?: number;
  onPlan?: (p: { covered: number; picked: number; listed: number; center: [number, number]; mbytes: number }) => void;
  onFrame?: (f: Frame, done: number, total: number) => void; onSkip?: (done: number, total: number) => void };
export type Build = { frames: Frame[]; size: number; center: [number, number]; covered: number; listed: number; failed: number; visits: number; index: IndexInfo };

export async function build(t: Target, o: BuildOpts): Promise<Build> {
  await loadLvf();
  const index = await findExposures(t.ra, t.dec);
  const { cover, pick } = chooseExposures(index.exposures, t, o.maxFrames, o.dets);
  // the field is fixed on the sky, centred where the target is at the middle of the SPHEREx observations
  const mid = cover.length ? (cover[0].mjd + cover[cover.length - 1].mjd) / 2 : 60900, center = propagate(t, mid);
  const rowsPer = o.size * 1.42 + 3, mbytes = (pick.length * (rowsPer * 2040 * 4 + 45000 + 45000)) / 1e6;
  o.onPlan?.({ covered: cover.length, picked: pick.length, listed: index.exposures.length, center, mbytes });
  const frames: Frame[] = []; let done = 0, failed = 0;
  const queue = [...pick];
  const worker = async () => {
    while (queue.length) {
      const e = queue.shift()!;
      try {
        const f = await readFrame(e, t, { size: o.size, center, signal: o.signal });
        done++;
        if (f) { frames.push(f); o.onFrame?.(f, done, pick.length); } else o.onSkip?.(done, pick.length);
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
        done++; failed++; o.onSkip?.(done, pick.length);
      }
    }
  };
  await Promise.all(Array.from({ length: o.concurrency ?? 6 }, worker));
  frames.sort((a, b) => a.mjd - b.mjd);
  return { frames, size: o.size, center, covered: cover.length, listed: index.exposures.length, failed, visits: labelVisits(frames), index };
}
