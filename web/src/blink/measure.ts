// Measurements on registered SPHEREx frames: photometry -> spectrum and light curve; centroids -> motion and parallax.
import { PIX_ARCSEC, MJYSR_TO_MJY, lamAt, badMask, mjdToYear, type Frame } from "./engine";

const D2R = Math.PI / 180;

export type Phot = { k: number; mjd: number; det: number; lam: number; bw: number; flux: number; err: number; snr: number; flagged: boolean; visit: number };

/** PSF-weighted flux (mJy) at stamp position (x, y).
 *  The PSF is modelled as a Gaussian of the exposure's measured FWHM (header PSF_FWHM) broadened by the pixel; the
 *  estimate Σ P·d / Σ P² is the least-squares amplitude of that profile, so it is a total flux (no aperture correction)
 *  and is optimal for faint sources. Local sky: median of an annulus 5–8 px away. Noise: annulus scatter. */
export function photometry(f: Frame, N: number, x: number, y: number): { flux: number; err: number } | null {
  const fwhm = isFinite(f.psf) && f.psf > 2 ? f.psf : 7.5;
  const sig = Math.sqrt(Math.pow(fwhm / 2.3548 / PIX_ARCSEC, 2) + 1 / 12), R = Math.min(4.5, 3 * sig + 0.5);
  const ring: number[] = [];
  const i0 = Math.max(0, Math.floor(x - 8)), i1 = Math.min(N - 1, Math.ceil(x + 8)), j0 = Math.max(0, Math.floor(y - 8)), j1 = Math.min(N - 1, Math.ceil(y + 8));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const r = Math.hypot(i - x, j - y), v = f.img[j * N + i]; if (r >= 5 && r <= 8 && isFinite(v)) ring.push(v); }
  if (ring.length < 12) return null;
  ring.sort((a, b) => a - b);
  const bg = ring[ring.length >> 1], s = (ring[Math.floor(ring.length * 0.75)] - ring[Math.floor(ring.length * 0.25)]) / 1.349;
  let sp = 0, spp = 0, norm = 0, lost = 0;
  for (let j = Math.floor(y - R); j <= Math.ceil(y + R); j++) for (let i = Math.floor(x - R); i <= Math.ceil(x + R); i++) {
    const r2 = (i - x) * (i - x) + (j - y) * (j - y); if (r2 > R * R) continue;
    const P = Math.exp(-r2 / (2 * sig * sig)) / (2 * Math.PI * sig * sig); norm += P;
    const v = i < 0 || j < 0 || i >= N || j >= N ? NaN : f.img[j * N + i];
    if (!isFinite(v)) { lost += P; continue; }
    sp += P * (v - bg); spp += P * P;
  }
  if (!(spp > 0) || lost > 0.25 * norm) return null;
  return { flux: (sp / spp) * MJYSR_TO_MJY, err: (s / Math.sqrt(spp)) * MJYSR_TO_MJY };
}

/** Brightness of a SATURATED star from the unsaturated halo of its image: the median surface brightness in a ring
 *  4–7 px from the centre minus that in a ring 10–13 px out, times the ring area (mJy-equivalent). Medians ignore
 *  diffraction spikes, bleed trails and neighbours. The halo holds an unknown, wavelength-dependent fraction of the
 *  light, so this is NOT an absolute flux — but at a given wavelength it is proportional to the star's brightness,
 *  which is all a light curve relative to the star's own mean needs. */
export function haloPhotometry(f: Frame, N: number, x: number, y: number): { flux: number; err: number } | null {
  const inner: number[] = [], outer: number[] = []; let nIn = 0;
  for (let j = Math.max(0, Math.floor(y - 13)); j <= Math.min(N - 1, Math.ceil(y + 13)); j++) for (let i = Math.max(0, Math.floor(x - 13)); i <= Math.min(N - 1, Math.ceil(x + 13)); i++) {
    const r = Math.hypot(i - x, j - y), v = f.img[j * N + i];
    if (r >= 4 && r <= 7) { nIn++; if (isFinite(v)) inner.push(v); } else if (r >= 10 && r <= 13 && isFinite(v)) outer.push(v);
  }
  if (inner.length < 40 || inner.length < 0.7 * nIn || outer.length < 40) return null;
  inner.sort((a, b) => a - b); outer.sort((a, b) => a - b);
  const mi = inner[inner.length >> 1], mo = outer[outer.length >> 1], so = (outer[Math.floor(outer.length * 0.75)] - outer[Math.floor(outer.length * 0.25)]) / 1.349;
  const area = Math.PI * (49 - 16);
  return { flux: (mi - mo) * area * MJYSR_TO_MJY, err: (1.25 * so / Math.sqrt(inner.length)) * area * MJYSR_TO_MJY * Math.SQRT2 };
}
/** halo measurements of a saturated source in every frame (see haloPhotometry); none are marked as flagged */
export function haloSeries(frames: Frame[], N: number, probe: { dx: number; dy: number }, track: boolean): Phot[] {
  const out: Phot[] = [];
  frames.forEach((f, k) => {
    const [x, y] = probeAt(f, N, probe, track), p = haloPhotometry(f, N, x, y); if (!p) return;
    const [lam, bw] = lamAt(f, x, y); if (!isFinite(lam)) return;
    out.push({ k, mjd: f.mjd, det: f.det, lam, bw, flux: p.flux, err: p.err, snr: p.flux / Math.max(p.err, 1e-9), flagged: false, visit: f.visit });
  });
  return out;
}

/** position of the probe in a frame: it follows the target's motion when `track` is on */
export function probeAt(f: Frame, N: number, probe: { dx: number; dy: number }, track: boolean): [number, number] {
  const c = (N - 1) / 2; return track ? [f.tx + probe.dx, f.ty + probe.dy] : [c + probe.dx, c + probe.dy];
}

export function spectrum(frames: Frame[], N: number, probe: { dx: number; dy: number }, track: boolean): Phot[] {
  const bad = badMask(), out: Phot[] = [];
  frames.forEach((f, k) => {
    const [x, y] = probeAt(f, N, probe, track), p = photometry(f, N, x, y); if (!p) return;
    const [lam, bw] = lamAt(f, x, y); if (!isFinite(lam)) return;
    const atTarget = Math.hypot(x - f.tx, y - f.ty) < 1.5;
    out.push({ k, mjd: f.mjd, det: f.det, lam, bw, flux: p.flux, err: p.err, snr: p.flux / Math.max(p.err, 1e-9), flagged: atTarget && f.flags > 0 && (f.flags & bad) !== 0, visit: f.visit });
  });
  return out;
}

/** the object's own mean spectrum in bins of Δλ/λ = `res`, used as the reference that removes the "colour flicker" */
export function binSpectrum(P: Phot[], res = 0.04): { lam: number; flux: number; err: number; n: number }[] {
  const good = P.filter((p) => !p.flagged && isFinite(p.flux)).sort((a, b) => a.lam - b.lam), bins: { lam: number; flux: number; err: number; n: number }[] = [];
  let cur: Phot[] = [];
  const flush = () => { if (!cur.length) return; const fl = cur.map((p) => p.flux).sort((a, b) => a - b), med = fl[fl.length >> 1];
    const mad = fl.map((v) => Math.abs(v - med)).sort((a, b) => a - b)[fl.length >> 1] * 1.4826;
    bins.push({ lam: cur.reduce((s, p) => s + p.lam, 0) / cur.length, flux: med, err: cur.length > 2 ? mad / Math.sqrt(cur.length) : cur[0].err, n: cur.length }); cur = []; };
  for (const p of good) { if (cur.length && p.lam > cur[0].lam * (1 + res)) flush(); cur.push(p); }
  flush(); return bins;
}
/** one visit's level; `n` is the number of distinct exposures of that visit that entered a matched pair */
export type LcVisit = { visit: number; mjd: number; ratio: number; err: number; n: number };
export type LcSeries = { det: number; visits: LcVisit[]; amplitude: number; chi2: number; lo: LcVisit | null; hi: LcVisit | null };
export type LightCurve = { all: LcSeries; series: LcSeries[]; pairs: number; variable: boolean; best: LcSeries | null };

/** Brightness of each visit relative to the others, from wavelength-matched pairs of exposures.
 *  SPHEREx never observes a source twice at the same wavelength within a visit, and a spectrum can be very jagged
 *  (a T dwarf changes tenfold across one detector), so brightness can only be compared between exposures that saw the
 *  SAME wavelength: same detector, wavelengths within `tol` (a fraction of the filter's width). Every such pair from
 *  two different visits measures the log-ratio of those visits; the per-visit levels are then solved by least squares
 *  (as in photometric "ubercalibration"), with the geometric mean fixed to 1. */
function matchedLevels(P: Phot[], det: number, tol = 0.012): { V: LcVisit[]; pairs: number } {
  const good = P.filter((p) => !p.flagged && p.flux > 0 && p.snr > 4 && (det === 0 || p.det === det)).sort((a, b) => a.lam - b.lam);
  const ids = [...new Set(good.map((p) => p.visit))].sort((a, b) => a - b), n = ids.length, ix = new Map(ids.map((v, i) => [v, i]));
  if (n < 2) return { V: [], pairs: 0 };
  const A = Array.from({ length: n }, () => new Array(n).fill(0)), rhs = new Array(n).fill(0), cnt = new Array(n).fill(0), list: [number, number, number, number][] = [];
  const seen: Set<number>[] = Array.from({ length: n }, () => new Set<number>());          // distinct exposures of each visit that take part in a pair
  for (let i = 0; i < good.length; i++) for (let j = i + 1; j < good.length && good[j].lam <= good[i].lam * (1 + tol); j++) {
    const p = good[i], q = good[j]; if (p.det !== q.det || p.visit === q.visit) continue;
    const a = ix.get(p.visit)!, c = ix.get(q.visit)!, d = Math.log(q.flux / p.flux), w = 1 / (Math.pow(p.err / p.flux, 2) + Math.pow(q.err / q.flux, 2) + 2 * 0.03 * 0.03);
    A[a][a] += w; A[c][c] += w; A[a][c] -= w; A[c][a] -= w; rhs[c] += w * d; rhs[a] -= w * d; cnt[a]++; cnt[c]++; seen[a].add(i); seen[c].add(j); list.push([a, c, d, w]);
  }
  // visits linked by at least one chain of pairs form a group; levels are only comparable inside a group
  const root = ids.map((_, i) => i), find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  for (const [a, c] of list) root[find(a)] = find(c);
  const size = new Map<number, number>(); list.forEach(([a]) => size.set(find(a), (size.get(find(a)) ?? 0) + 1));
  const groups = [...size.entries()].sort((a, b) => b[1] - a[1]);
  if (!groups.length || (det === 0 && groups.length > 1)) return { V: [], pairs: list.length };   // detectors visited at different times: no common scale
  const keep = ids.map((_, i) => i).filter((i) => cnt[i] > 0 && find(i) === groups[0][0]), m = keep.length;
  if (m < 2) return { V: [], pairs: list.length };
  const B = keep.map((i) => keep.map((j) => A[i][j] + 1)), sol = solve(B, keep.map((i) => rhs[i]));       // "+1" pins the mean level (gauge)
  if (!sol) return { V: [], pairs: list.length };
  const x = new Array(n).fill(0); keep.forEach((i, q) => (x[i] = sol.x[q]));
  const used = list.filter(([a]) => find(a) === groups[0][0]);
  const chi = used.reduce((q, [a, c, d, w]) => q + w * Math.pow(x[c] - x[a] - d, 2), 0) / Math.max(1, used.length - (m - 1)), scale = Math.max(1, Math.sqrt(chi));
  const V = keep.map((i, q) => { const L = good.filter((p) => p.visit === ids[i]);
    return { visit: ids[i], mjd: L.reduce((t, p) => t + p.mjd, 0) / L.length, ratio: Math.exp(x[i]), err: Math.exp(x[i]) * Math.sqrt(Math.max(sol.inv[q][q] - 1 / (m * m), 1e-6)) * scale, n: seen[i].size }; }).sort((a, b) => a.mjd - b.mjd);
  return { V, pairs: list.length };
}
/** Repeatability of one exposure's flux on constant stars (ln units), by detector. SPHEREx's 6" pixels undersample the
 *  image, most severely at the shortest wavelengths, so the measured flux depends on where the star falls inside a
 *  pixel: field stars scatter by ~12% per exposure in detector 1 and ~5% beyond 2.4 µm, whatever their brightness.
 *  A visit level averaged over n exposure pairs carries this floor divided by √n. (index 0: all detectors together) */
const SYS = [0.08, 0.12, 0.1, 0.07, 0.05, 0.05, 0.05];
function spread(det: number, V: LcVisit[]): LcSeries {
  if (V.length < 2) return { det, visits: V, amplitude: 1, chi2: 0, lo: null, hi: null };
  const lo = V.reduce((a, b) => (b.ratio < a.ratio ? b : a)), hi = V.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  const chi2 = V.reduce((q, v) => q + Math.pow(Math.log(v.ratio) / Math.hypot(v.err / v.ratio, SYS[det] / Math.sqrt(Math.max(1, v.n))), 2), 0) / (V.length - 1);
  return { det, visits: V, amplitude: hi.ratio / Math.max(lo.ratio, 1e-3), chi2, lo, hi };
}
export function lightCurve(P: Phot[]): LightCurve {
  const all = matchedLevels(P, 0), series = [1, 2, 3, 4, 5, 6].map((d) => spread(d, matchedLevels(P, d).V)).filter((q) => q.visits.length >= 2);
  // a claim of variability needs several matched pairs in every visit: thin data easily fakes a trend
  const A = spread(0, all.V), sig = (q: LcSeries) => q.visits.length >= 2 && q.visits.every((v) => v.n >= 3) && (q.det ? q.chi2 > 9 && q.amplitude > 1.25 : q.chi2 > 6 && q.amplitude > 1.15);
  const S = series.filter(sig).sort((a, b) => b.amplitude - a.amplitude);
  // ... and it must not hang on one detector: a second detector has to show the same visit brighter than the same other
  // visit (real variables change at every wavelength at once), unless the single detector's case is overwhelming
  const at = (q: LcSeries, v: number) => q.visits.find((x) => x.visit === v)?.ratio;
  const backed = (a: LcSeries) => series.some((b) => { if (b === a || !a.hi || !a.lo) return false; const h = at(b, a.hi.visit), l = at(b, a.lo.visit); return h !== undefined && l !== undefined && h > l * 1.08; });
  const best = S.find((a) => backed(a) || (a.chi2 > 40 && a.visits.every((v) => v.n >= 5))) ?? null;
  return { all: A, series, pairs: all.pairs, variable: !!best || (sig(A) && A.visits.every((v) => v.n >= 4)), best };
}

// ---------------------------------------------------------------- astrometry
/** Gaussian-windowed centroid near (x, y); null when the source is too faint or touches missing pixels */
export function centroid(f: Frame, N: number, x: number, y: number): { x: number; y: number; snr: number } | null {
  const fwhm = isFinite(f.psf) && f.psf > 2 ? f.psf : 7.5, sig = Math.sqrt(Math.pow(fwhm / 2.3548 / PIX_ARCSEC, 2) + 1 / 12) * 1.3, R = 3.5;
  let cx = x, cy = y;
  for (let it = 0; it < 6; it++) {
    let s = 0, sx = 0, sy = 0;
    for (let j = Math.floor(cy - R); j <= Math.ceil(cy + R); j++) for (let i = Math.floor(cx - R); i <= Math.ceil(cx + R); i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) return null;
      const r2 = (i - cx) * (i - cx) + (j - cy) * (j - cy); if (r2 > R * R) continue;
      const v = f.img[j * N + i]; if (!isFinite(v)) return null;
      const w = Math.exp(-r2 / (2 * sig * sig)) * Math.max(v, 0); s += w; sx += w * i; sy += w * j;
    }
    if (!(s > 0)) return null;
    // the Gaussian window halves the shift of a Gaussian source: undo that (factor (σw² + σp²)/σw² ≈ 1.6)
    const nx = sx / s, ny = sy / s, g = 1.6; cx += (nx - cx) * g; cy += (ny - cy) * g;
    if (Math.hypot(cx - x, cy - y) > 3) return null;
  }
  const p = photometry(f, N, cx, cy); if (!p) return null;
  return { x: cx, y: cy, snr: p.flux / Math.max(p.err, 1e-9) };
}

/** barycentric position of the Earth (au, equatorial J2000) — low-precision solar theory, good to ~1e-4 au */
export function earthXYZ(mjd: number): [number, number, number] {
  const n = mjd - 51544.5, L = (280.46 + 0.9856474 * n) * D2R, g = (357.528 + 0.9856003 * n) * D2R;
  const lam = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R, R = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g), eps = (23.439 - 4e-7 * n) * D2R;
  return [-R * Math.cos(lam), -R * Math.cos(eps) * Math.sin(lam), -R * Math.sin(eps) * Math.sin(lam)];
}
/** parallax factors (east, north): displacement in arcsec per arcsec of parallax */
export function parallaxFactors(ra: number, dec: number, mjd: number): [number, number] {
  const [X, Y, Z] = earthXYZ(mjd), a = ra * D2R, d = dec * D2R;
  return [X * Math.sin(a) - Y * Math.cos(a), X * Math.cos(a) * Math.sin(d) + Y * Math.sin(a) * Math.sin(d) - Z * Math.cos(d)];
}

function solve(A: number[][], b: number[]): { x: number[]; inv: number[][] } | null {
  const n = b.length, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)), b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c]; for (let k = c; k < 2 * n + 1; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f) for (let k = c; k < 2 * n + 1; k++) M[r][k] -= f * M[c][k]; }
  }
  return { x: M.map((r) => r[2 * n]), inv: M.map((r) => r.slice(n, 2 * n)) };
}

/** Systematic floor on SPHEREx-only parallaxes (arcsec). The telescope's roll flips by ~180° between visits six months
 *  apart — the same rhythm as the parallax swing — so any centroid bias tied to detector orientation imitates parallax
 *  and does not average out. Sized from the two validation objects with known parallaxes (ε Indi B, Barnard's Star). */
export const PLX_SYS = 0.08;
export type AstroPoint = { k: number; mjd: number; xi: number; eta: number; err: number; used: boolean; visit: number };
export type Motion = { pts: AstroPoint[]; pmra: number; pmdec: number; epmra: number; epmdec: number; plx: number | null; eplx: number | null; rms: number; t0: number;
  xi0: number; eta0: number; n: number; visits: number; span: number; withParallax: boolean };
/** fit position + proper motion (+ parallax when ≥ 3 visits span > 300 days) to the centroids of one source.
 *  Offsets are in arcsec on the tangent plane (ξ east, η north) about the field centre. */
export function fitMotion(frames: Frame[], N: number, center: [number, number], probe: { dx: number; dy: number }, track: boolean, dets?: Set<number>, useFlagged = false): Motion | null {
  const c = (N - 1) / 2, bad = badMask(), pts: AstroPoint[] = [];
  frames.forEach((f, k) => {
    if (dets && !dets.has(f.det)) return;
    const [x, y] = probeAt(f, N, probe, track), m = centroid(f, N, x, y); if (!m || m.snr < 8) return;
    if (!useFlagged && Math.hypot(x - f.tx, y - f.ty) < 1.5 && f.flags > 0 && f.flags & bad) return;   // saturated or contaminated at the source
    const fw = (isFinite(f.psf) ? f.psf : 7.5) / PIX_ARCSEC;
    pts.push({ k, mjd: f.mjd, xi: -(m.x - c) * PIX_ARCSEC, eta: -(m.y - c) * PIX_ARCSEC, err: Math.hypot((fw / 2.35 / m.snr) * 1.5, 0.12) * PIX_ARCSEC, used: true, visit: f.visit });
  });
  if (pts.length < 6) return null;
  const visits = new Set(pts.map((p) => p.visit)).size, span = pts[pts.length - 1].mjd - pts[0].mjd;
  if (visits < 2 || span < 60) return null;
  const withParallax = visits >= 3 && span > 300, np = withParallax ? 5 : 4;
  const t0 = pts.reduce((s, p) => s + p.mjd, 0) / pts.length;
  const PF = pts.map((p) => parallaxFactors(center[0], center[1], p.mjd));
  let sol: { x: number[]; inv: number[][] } | null = null, rms = 0, scale = 1;
  for (let it = 0; it < 4; it++) {
    const A = Array.from({ length: np }, () => new Array(np).fill(0)), b = new Array(np).fill(0);
    const add = (row: number[], y: number, w: number) => { for (let i = 0; i < np; i++) { b[i] += w * row[i] * y; for (let j = 0; j < np; j++) A[i][j] += w * row[i] * row[j]; } };
    pts.forEach((p, q) => { if (!p.used) return; const dt = (p.mjd - t0) / 365.25, w = 1 / (p.err * p.err);
      add([1, 0, dt, 0, PF[q][0]].slice(0, np), p.xi, w); add([0, 1, 0, dt, PF[q][1]].slice(0, np), p.eta, w); });
    sol = solve(A, b); if (!sol) return null;
    const x = sol.x, res = pts.map((p, q) => { const dt = (p.mjd - t0) / 365.25, pl = withParallax ? x[4] : 0;
      return Math.hypot(p.xi - (x[0] + x[2] * dt + pl * PF[q][0]), p.eta - (x[1] + x[3] * dt + pl * PF[q][1])); });
    const used = res.filter((_, q) => pts[q].used).sort((a, b2) => a - b2), med = used[used.length >> 1] || 1e-3;
    rms = Math.sqrt(used.reduce((s, r) => s + r * r, 0) / Math.max(1, used.length));
    const chi = pts.reduce((s, p, q) => s + (p.used ? Math.pow(res[q] / p.err, 2) : 0), 0) / Math.max(1, 2 * used.length - np);
    scale = Math.max(1, Math.sqrt(chi));
    if (it < 3) pts.forEach((p, q) => (p.used = res[q] < Math.max(3.5 * med, 0.5)));
    if (pts.filter((p) => p.used).length < 6) return null;
  }
  const x = sol!.x, e = (i: number) => Math.sqrt(Math.max(sol!.inv[i][i], 0)) * scale;
  return { pts, pmra: x[2], pmdec: x[3], epmra: e(2), epmdec: e(3), plx: withParallax ? x[4] : null, eplx: withParallax ? e(4) : null, rms, t0, xi0: x[0], eta0: x[1],
    n: pts.filter((p) => p.used).length, visits, span, withParallax };
}
export const yearOf = mjdToYear;
