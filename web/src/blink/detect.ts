// What changed in this field?
// Every source in the SPHEREx exposures is located at every visit on deep stacks, tied to Gaia's reference frame with
// the catalogued stars of the same field, and compared with where and how bright the surveys of 2010 (AllWISE) and
// ~1999 (2MASS) recorded it. Out comes a table: what moved, what brightened or faded, what is new, what is gone, each
// with its significance. The yardstick is the field itself: how well the Gaia stars are recovered here (position
// error against signal-to-noise, motion scatter, brightness zero point), so the thresholds adapt to depth, crowding
// and the number of visits. Claims are only made for sources that are isolated, unsaturated and bright enough.
import { PIX_ARCSEC, clippedStats, skyToStamp, stampToSky, mjdToYear, lamAt, badMask, FLAG_DEFS, type Frame } from "./engine";
import { robustStack } from "./imaging";
import { centroid, photometry, lightCurve, parallaxFactors, type Phot } from "./measure";
import { catPos, magToMjy, type CatSource } from "./catalogs";

export type Tag = "MOVED" | "BRIGHTER" | "FAINTER" | "VARIABLE" | "NEW" | "SATURATED" | "BLENDED" | "EDGE";
export type Band = { f: number; e: number; n: number } | null;                                  // mJy
export type Delta = { ratio: number; z: number; then: number; now: number; band: string; year: number };   // now / then
export type Epoch = { yr: number; xi: number; eta: number; err: number; src: "SPHEREx" | "WISE 2010" | "2MASS"; snr?: number };
export type MotionFit = { ra: number; dec: number; era: number; edec: number; tot: number; etot: number; sig: number; base: number; t0: number; xi0: number; eta0: number; chi2: number; n: number; using: string };
export type TM = CatSource & { j: number; h: number; k: number };
export type ChangeRow = {
  n: number; x: number; y: number; ra: number; dec: number; snr: number; red: boolean; track: boolean;
  gaia: CatSource | null; wise: CatSource | null; tm: TM | null; linked: boolean; /** found at its older positions with the published motion of the visitor's target */ tracked?: boolean;
  J: Band; H: Band; K: Band; W1: Band; W2: Band;
  epochs: Epoch[]; pm: MotionFit | null; pmSx: MotionFit | null;
  dW1: Delta | null; dW2: Delta | null; dK: Delta | null;
  lc: { variable: boolean; amp: number; pairs: number } | null;
  tags: Tag[]; why: string; known: string; isTarget: boolean; P: Phot[];
};
export type GoneRow = { wise: CatSource; x: number; y: number; w1: number | null; w2: number | null };
export type FieldReport = {
  rows: ChangeRow[]; gone: GoneRow[];
  cal: { nRef: number; astroRms: number | null; pmRms: number | null; posA: number; posB: number; zp: Record<string, { zp: number; sc: number; n: number }> };
  visits: { yr: number; n: number }[]; yr: number; span: number; catalogs: { gaia: boolean; wise: boolean; tm: boolean };
  counts: { moved: number; movedUnknown: number; brighter: number; fainter: number; variable: number; fresh: number; gone: number; measured: number };
  limits: { pm: number | null; w1: number | null; w2: number | null };
};

const median = (a: number[]) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const mad = (a: number[], m: number) => median(a.map((v) => Math.abs(v - m))) * 1.4826;

/** signal-to-noise image of a set of exposures: each divided by its own noise, then robustly averaged */
function snStack(fs: Frame[], N: number): Float32Array | null {
  if (fs.length < 2) return null;
  const imgs = fs.map((f) => { const s = 1 / Math.max(f.noise, 1e-9), o = new Float32Array(f.img.length); for (let q = 0; q < o.length; q++) o[q] = f.img[q] * s; return o; });
  const st = robustStack(imgs, N * N), { med, sig } = clippedStats(st);
  if (!(sig > 0)) return null;
  for (let q = 0; q < st.length; q++) st[q] = (st[q] - med) / sig;
  return st;
}
function peaks(m: Float32Array, N: number, thr: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let j = 3; j < N - 3; j++) for (let i = 3; i < N - 3; i++) {
    const v = m[j * N + i]; if (!(v > thr)) continue;
    let top = true;
    for (let b = -1; b <= 1 && top; b++) for (let a = -1; a <= 1; a++) if (m[(j + b) * N + i + a] > v) { top = false; break; }
    if (top) out.push([i, j, v]);
  }
  return out;
}
type Maps = (Float32Array | null)[];           // [all detectors, red (2.4–5 µm), blue (0.75–2.4 µm)]
const mapsOf = (fs: Frame[], N: number): Maps => [snStack(fs, N), snStack(fs.filter((f) => f.det >= 4), N), snStack(fs.filter((f) => f.det <= 3), N)];
type Cen = { x: number; y: number; snr: number; red: boolean };
function best(maps: Maps, N: number, psf: number, proto: Frame, x: number, y: number): Cen | null {
  let b: Cen | null = null;
  maps.forEach((m, q) => { if (!m) return; const r = centroid({ ...proto, img: m, psf } as Frame, N, x, y); if (r && (!b || r.snr > b.snr)) b = { ...r, red: q === 1 }; });
  return b;
}
/** weighted straight-line motion through dated positions (arcsec, years); errors scaled by the misfit when it is poor */
function fitLine(pts: Epoch[], using: string): MotionFit | null {
  if (pts.length < 2) return null;
  const W = pts.reduce((s, p) => s + 1 / (p.err * p.err), 0), t0 = pts.reduce((s, p) => s + p.yr / (p.err * p.err), 0) / W;
  const S = pts.reduce((s, p) => s + (p.yr - t0) ** 2 / (p.err * p.err), 0);
  if (!(S > 0)) return null;
  const mx = pts.reduce((s, p) => s + p.xi / (p.err * p.err), 0) / W, my = pts.reduce((s, p) => s + p.eta / (p.err * p.err), 0) / W;
  const ra = pts.reduce((s, p) => s + ((p.yr - t0) * (p.xi - mx)) / (p.err * p.err), 0) / S, dec = pts.reduce((s, p) => s + ((p.yr - t0) * (p.eta - my)) / (p.err * p.err), 0) / S;
  const dof = 2 * pts.length - 4, chi2 = dof > 0 ? pts.reduce((s, p) => s + ((p.xi - mx - ra * (p.yr - t0)) ** 2 + (p.eta - my - dec * (p.yr - t0)) ** 2) / (p.err * p.err), 0) / dof : 0;
  const k = Math.max(1, Math.sqrt(chi2)), e = k / Math.sqrt(S), tot = Math.hypot(ra, dec), yrs = pts.map((p) => p.yr);
  return { ra, dec, era: e, edec: e, tot, etot: e, sig: tot / e, base: Math.max(...yrs) - Math.min(...yrs), t0, xi0: mx, eta0: my, chi2, n: pts.length, using };
}
function bandOf(P: Phot[], a: number, b: number): Band {
  const v = P.filter((p) => !p.flagged && Number.isFinite(p.flux) && p.lam >= a && p.lam <= b);
  if (v.length < 2) return null;
  const f = v.map((p) => p.flux), m = median(f);
  return { f: m, e: (Math.max(mad(f, m), median(v.map((p) => p.err))) * 1.2533) / Math.sqrt(v.length), n: v.length };
}
const sn = (b: Band) => (b && b.e > 0 ? b.f / b.e : 0);

export function detectChanges(frames: Frame[], N: number, center: [number, number], cat: { gaia: CatSource[] | null; wise: CatSource[] | null; tm: TM[] | null },
  target: [number, number] | null, masks?: (Int32Array | null)[], track?: { pmra: number; pmdec: number } | null): FieldReport | null {
  if (frames.length < 4) return null;
  const c = (N - 1) / 2, PIX = PIX_ARCSEC, proto = frames[0], psf = median(frames.map((f) => (Number.isFinite(f.psf) && f.psf > 2 ? f.psf : 7.5)));
  const tan = (x: number, y: number): [number, number] => [-(x - c) * PIX, -(y - c) * PIX];          // (east, north) arcsec about the field centre
  const pix = (xi: number, eta: number): [number, number] => [c - xi / PIX, c - eta / PIX];
  const sky = (ra: number, dec: number) => { const [x, y] = skyToStamp(center[0], center[1], N, ra, dec); return tan(x, y); };
  const yrAll = frames.reduce((s, f) => s + mjdToYear(f.mjd), 0) / frames.length;
  const haveG = !!cat.gaia?.length, haveW = !!cat.wise?.length, haveT = !!cat.tm?.length;
  const G = cat.gaia ?? [], W = cat.wise ?? [], T = cat.tm ?? [];
  // ---- deep stacks: the whole run, and one set per visit
  const all = mapsOf(frames, N);
  if (!all[0] && !all[1] && !all[2]) return null;
  const vids = [...new Set(frames.map((f) => f.visit))].sort((a, b) => a - b);
  const V = vids.map((v) => { const fs = frames.filter((f) => f.visit === v); return { v, n: fs.length, yr: fs.reduce((s, f) => s + mjdToYear(f.mjd), 0) / fs.length, mjd: fs.reduce((s, f) => s + f.mjd, 0) / fs.length, maps: mapsOf(fs, N) }; })
    .filter((q) => q.maps.some(Boolean));
  // ---- detections on the whole-run stacks, then their position at every visit (kept only if it stays on the source)
  type Src = { x: number; y: number; snr: number; red: boolean; vis: ({ xi: number; eta: number; snr: number } | null)[]; track?: boolean };
  const found: Src[] = [];
  all.forEach((m) => { if (!m) return; for (const [i, j] of peaks(m, N, 5)) { const r = best(all, N, psf, proto, i, j); if (!r || r.snr < 5) continue;
    const k = found.findIndex((q) => Math.hypot(q.x - r.x, q.y - r.y) < 1.6); if (k < 0) found.push({ ...r, vis: [] }); else if (r.snr > found[k].snr) found[k] = { ...r, vis: [] }; } });
  found.sort((a, b) => b.snr - a.snr); found.length = Math.min(found.length, 90);
  for (const s of found) s.vis = V.map((q) => { const r = best(q.maps, N, psf, proto, s.x, s.y); if (!r || r.snr < 5 || Math.hypot(r.x - s.x, r.y - s.y) > 1.5) return null; const [xi, eta] = tan(r.x, r.y); return { xi, eta, snr: r.snr }; });
  // ---- things seen in single visits only, away from every steady source: link them into tracks (fast movers)
  const loose: (Cen & { v: number; used?: boolean })[] = [];
  V.forEach((q, vi) => q.maps.forEach((m) => { if (!m) return; for (const [i, j] of peaks(m, N, 7)) { const r = best(q.maps, N, psf, proto, i, j); if (!r || r.snr < 7) continue;
    if (found.some((s) => Math.hypot(s.x - r.x, s.y - r.y) < 2.2)) continue;
    if (!loose.some((l) => l.v === vi && Math.hypot(l.x - r.x, l.y - r.y) < 1.6)) loose.push({ v: vi, ...r }); } }));
  if (V.length >= 2) {
    const pairs: { a: number; b: number; speed: number }[] = [];
    loose.forEach((p, a) => loose.forEach((q, b) => { if (q.v <= p.v) return; const dt = V[q.v].yr - V[p.v].yr, sp = (Math.hypot(q.x - p.x, q.y - p.y) * PIX) / Math.max(dt, 0.05);
      if (dt > 0.2 && sp >= 1.5 && sp <= 25 && Math.max(p.snr, q.snr) / Math.min(p.snr, q.snr) < 2.5) pairs.push({ a, b, speed: sp }); }));
    pairs.sort((u, w) => u.speed - w.speed);
    for (const { a, b } of pairs) {
      const p = loose[a], q = loose[b]; if (p.used || q.used) continue;
      const dt = V[q.v].yr - V[p.v].yr, vx = (q.x - p.x) / dt, vy = (q.y - p.y) / dt, members = [p, q];
      // a third or fourth visit must fall on the same straight line
      loose.forEach((r) => { if (r.used || r === p || r === q || members.some((m) => m.v === r.v)) return; const t = V[r.v].yr - V[p.v].yr; if (Math.hypot(r.x - (p.x + vx * t), r.y - (p.y + vy * t)) < 1.0) members.push(r); });
      if (members.length < Math.min(3, V.length) && Math.min(p.snr, q.snr) < 12) continue;         // two faint points alone are not a track
      members.forEach((m) => (m.used = true));
      const tm = members.reduce((s, m) => s + V[m.v].yr, 0) / members.length, x = p.x + vx * (tm - V[p.v].yr), y = p.y + vy * (tm - V[p.v].yr);
      found.push({ x, y, snr: Math.max(...members.map((m) => m.snr)), red: members.some((m) => m.red), track: true,
        vis: V.map((_, vi) => { const m = members.find((r) => r.v === vi); if (!m) return null; const [xi, eta] = tan(m.x, m.y); return { xi, eta, snr: m.snr }; }) });
    }
  }
  if (!found.length) return null;
  // ---- Gaia counterparts at the SPHEREx epoch; the brightest star inside the pixel dominates the image
  const gNow = G.map((g) => { const [ra, dec] = catPos(g, yrAll); return sky(ra, dec); });
  const wPos = W.map((w) => sky(w.ra, w.dec)), tPos = T.map((t) => sky(t.ra, t.dec));
  const within = (P: [number, number][], xi: number, eta: number, r: number) => P.map((p, k) => ({ k, d: Math.hypot(p[0] - xi, p[1] - eta) })).filter((q) => q.d < r).sort((a, b) => a.d - b.d);
  const hasPm = (g: CatSource | null) => !!g && g.plx !== null;
  const chroma = (s: Src) => { if (s.track) return 0; const r = all[1] ? centroid({ ...proto, img: all[1], psf } as Frame, N, s.x, s.y) : null, b = all[2] ? centroid({ ...proto, img: all[2], psf } as Frame, N, s.x, s.y) : null;
    return r && b && r.snr >= 10 && b.snr >= 10 ? Math.hypot(r.x - b.x, r.y - b.y) * PIX : 0; };
  const rows0 = found.map((s) => {
    const [xi, eta] = tan(s.x, s.y), nb = within(gNow, xi, eta, 4.5).sort((a, b) => (G[a.k].mag ?? 30) - (G[b.k].mag ?? 30));
    const gi = nb.length ? nb[0].k : -1, g = gi >= 0 ? G[gi] : null;
    // a second star of comparable brightness within 10" makes the SPHEREx image a blend. Without a Gaia counterpart
    // the comparison is with the source's own signal: the brighter it is, the brighter a neighbour must be to matter
    const gLim = Math.max(13, 19 - 2.5 * Math.log10(Math.max(s.snr, 12) / 12));
    const crowd = g ? within(gNow, gNow[gi][0], gNow[gi][1], 10).some((q) => q.k !== gi && (G[q.k].mag ?? 30) < (g.mag ?? 30) + 2) : within(gNow, xi, eta, 10).some((q) => (G[q.k].mag ?? 30) < gLim);
    return { s, xi, eta, g, gi, crowd, chroma: chroma(s) };
  });
  const edge = (s: Src) => s.x < 6 || s.y < 6 || s.x > N - 7 || s.y > N - 7;
  const blend = (s: Src) => found.some((o) => o !== s && Math.hypot(o.x - s.x, o.y - s.y) < 2.4 && o.snr > 0.3 * s.snr);
  // stars that saturate SPHEREx: their own measurements are unusable and their halo spoils the neighbours
  const zones: { xi: number; eta: number; r: number; id: string; yr: number; old?: boolean }[] = [];
  W.forEach((w, k) => { const m = Math.min(w.mag2 ?? 99, (w.mag ?? 99) + 0.6); if (m < 7.8) zones.push({ xi: wPos[k][0], eta: wPos[k][1], r: 22 + 13 * (7.8 - m), id: w.id, yr: 2010.5 }); });
  T.forEach((t, k) => { if (Number.isFinite(t.k) && t.k < 7.8 && !zones.some((z) => Math.hypot(z.xi - tPos[k][0], z.eta - tPos[k][1]) < 10)) zones.push({ xi: tPos[k][0], eta: tPos[k][1], r: 22 + 13 * (7.8 - t.k), id: t.id, yr: t.epoch }); });
  // a bright star that moves floods today's exposures where it is now, not where the old surveys recorded it: its
  // glare gets a second zone at today's position (from its Gaia motion), and the old one is remembered as old
  for (const z of [...zones]) {
    let bk = -1, bm = 99;
    G.forEach((g, k) => { if (g.plx === null || Math.hypot(g.pmra, g.pmdec) * Math.abs(yrAll - z.yr) < 6) return; const [ra, dec] = catPos(g, z.yr), [x, y] = sky(ra, dec);
      if (Math.hypot(x - z.xi, y - z.eta) < 4 && (g.mag ?? 30) < bm) { bm = g.mag ?? 30; bk = k; } });
    if (bk < 0) continue; z.old = true;
    if (!zones.some((q) => !q.old && Math.hypot(q.xi - gNow[bk][0], q.eta - gNow[bk][1]) < 10)) zones.push({ xi: gNow[bk][0], eta: gNow[bk][1], r: 1.3 * z.r, id: z.id, yr: yrAll });   // SPHEREx's own glare reaches further than the old surveys' did
  }
  const zoneOf = (xi: number, eta: number) => zones.find((z) => Math.hypot(z.xi - xi, z.eta - eta) < z.r);
  // ---- tie every visit to Gaia: the median offset of the reference stars in that visit
  const refs = rows0.filter((r) => hasPm(r.g) && (r.g!.mag ?? 30) < 18.5 && r.s.snr >= 12 && !r.s.track && !edge(r.s) && !blend(r.s) && !r.crowd && !zoneOf(r.xi, r.eta));
  const predG = (g: CatSource, yr: number, mjd: number): [number, number] => { const [ra, dec] = catPos(g, yr), [xi, eta] = sky(ra, dec), pf = parallaxFactors(ra, dec, mjd), plx = (g.plx ?? 0) / 1000; return [xi + plx * pf[0], eta + plx * pf[1]]; };
  const off = V.map((q, vi) => { const dx: number[] = [], dy: number[] = [];
    for (const r of refs) { const m = r.s.vis[vi]; if (!m || m.snr < 8) continue; const [px, py] = predG(r.g!, q.yr, q.mjd); dx.push(m.xi - px); dy.push(m.eta - py); }
    return dx.length >= 3 ? { xi: median(dx), eta: median(dy), n: dx.length } : { xi: 0, eta: 0, n: 0 }; });
  // a visit with too few reference stars borrows the median offset of the calibrated ones (never a silent zero) and
  // carries a larger error; `loose` marks it
  const okOff = off.filter((o) => o.n >= 3), loose0 = okOff.length ? { xi: median(okOff.map((o) => o.xi)), eta: median(okOff.map((o) => o.eta)) } : { xi: 0, eta: 0 };
  off.forEach((o) => { if (!o.n) { o.xi = loose0.xi; o.eta = loose0.eta; } });
  const resid: number[] = [];
  refs.forEach((r) => V.forEach((q, vi) => { const m = r.s.vis[vi]; if (!m || m.snr < 8 || !off[vi].n) return; const [px, py] = predG(r.g!, q.yr, q.mjd); resid.push(m.xi - off[vi].xi - px, m.eta - off[vi].eta - py); }));
  const calibrated = off.some((o) => o.n >= 3), astroRms = resid.length >= 6 ? mad(resid, median(resid)) : null;
  const floor = Math.min(0.6, Math.max(0.1, astroRms ?? 0.3));
  const epochsOf = (s: Src): Epoch[] => V.map((q, vi) => { const m = s.vis[vi]; if (!m) return null;
    return { yr: q.yr, xi: m.xi - off[vi].xi, eta: m.eta - off[vi].eta, err: Math.hypot(((psf / 2.35) / m.snr) * 1.5, floor, off[vi].n ? 0 : 0.35), src: "SPHEREx" as const, snr: m.snr }; }).filter(Boolean) as Epoch[];
  const meanPos = (ep: Epoch[]): [number, number, number] | null => { if (!ep.length) return null; const w = ep.reduce((s, p) => s + 1 / (p.err * p.err), 0);
    return [ep.reduce((s, p) => s + p.xi / (p.err * p.err), 0) / w, ep.reduce((s, p) => s + p.eta / (p.err * p.err), 0) / w, ep.reduce((s, p) => s + p.yr / (p.err * p.err), 0) / w]; };
  // ---- how far from the truth does a source of a given signal-to-noise land? Faint sources are pulled by neighbours
  //      below the detection limit (confusion); this error does not shrink with more visits. Measured on Gaia stars.
  const dev: { d: number; snr: number }[] = [];
  rows0.forEach((r) => { if (!hasPm(r.g) || edge(r.s) || blend(r.s) || r.s.track || zoneOf(r.xi, r.eta)) return; const m = meanPos(epochsOf(r.s)); if (!m) return;
    const [px, py] = predG(r.g!, m[2], 51544.5 + (m[2] - 2000) * 365.25); dev.push({ d: Math.hypot(m[0] - px, m[1] - py), snr: r.s.snr }); });
  const hi = dev.filter((q) => q.snr >= 40), lo = dev.filter((q) => q.snr < 40);
  const posA = hi.length >= 4 ? Math.min(0.6, Math.max(0.08, median(hi.map((q) => q.d)) / 1.18)) : 0.25;
  const posB = lo.length >= 5 ? Math.min(25, Math.max(4, median(lo.map((q) => q.d * q.snr)) / 1.18)) : 9;
  const sysPos = (snr: number) => Math.hypot(posA, posB / Math.max(snr, 1));
  // ---- brightness of every source in every exposure
  const bad = badMask(), over = FLAG_DEFS.find((d) => d.name === "OVERFLOW"), obit = over ? 1 << over.bit : 0;
  const base = rows0.map(({ s, xi, eta, g, crowd, chroma: chr }) => {
    const ep = epochsOf(s), pmSx = ep.length >= 2 ? fitLine(ep, "SPHEREx visits") : null;
    // (the fitted path is in Gaia's frame; the image itself is displaced by that visit's offset, so add it back)
    const mv = pmSx && pmSx.sig > 4 && pmSx.tot > 0.5 ? pmSx : null;
    const P: Phot[] = []; let nOver = 0, nMask = 0;
    frames.forEach((f, k) => {
      const yr = mjdToYear(f.mjd), o = off[V.findIndex((q) => q.v === f.visit)] ?? { xi: 0, eta: 0 };
      const [x, y] = mv ? pix(mv.xi0 + mv.ra * (yr - mv.t0) + o.xi, mv.eta0 + mv.dec * (yr - mv.t0) + o.eta) : [s.x, s.y];
      const p = photometry(f, N, x, y); if (!p) return;
      const [lam, bw] = lamAt(f, x, y); if (!Number.isFinite(lam)) return;
      let fl = 0; const mk = masks?.[k];
      if (mk) { nMask++; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const i = Math.round(x) + a, j = Math.round(y) + b; if (i >= 0 && j >= 0 && i < N && j < N) fl |= mk[j * N + i]; } if (fl & obit) nOver++; }
      P.push({ k, mjd: f.mjd, det: f.det, lam, bw, flux: p.flux, err: p.err, snr: p.flux / Math.max(p.err, 1e-9), flagged: (fl & bad) !== 0, visit: f.visit });
    });
    return { s, xi, eta, g, crowd, chr, ep, pmSx, P, satMask: nMask > 3 && nOver > 0.4 * nMask,
      J: bandOf(P, 1.17, 1.33), H: bandOf(P, 1.5, 1.78), K: bandOf(P, 2.0, 2.3), W1: bandOf(P, 2.9, 3.8), W2: bandOf(P, 4.1, 5.0) };
  });
  // ---- counterparts in 2010 and ~1999. With a Gaia motion we know where to look; otherwise the same place, and a
  //      counterpart further than 3" away must also have the same brightness
  const same = (now: Band, then: number | null, f: number) => (now && then && now.f > 3 * now.e ? Math.abs(Math.log(now.f / then)) < Math.log(f) : null);
  const w1Of = (w: CatSource) => (w.mag2 != null ? magToMjy(w.mag2, "W1") : null), w2Of = (w: CatSource) => (w.mag != null ? magToMjy(w.mag, "W2") : null);
  const usedW = new Set<number>();
  const rows: ChangeRow[] = base.map((b, n) => {
    const { s, xi, eta, g } = b, isT = !!target && Math.hypot(s.x - target[0], s.y - target[1]) < 2;
    // the visitor's own target, when it has a published motion that Gaia does not list (a cold brown dwarf): its older
    // positions are looked for where that motion says they were. This is tracking a known object, not a blind search.
    const tp = isT && !hasPm(g) && track && Math.hypot(track.pmra, track.pmdec) > 0.05 ? track : null;
    const back = (yr: number): [number, number] => { if (hasPm(g)) { const [ra, dec] = catPos(g!, yr); return sky(ra, dec); } return tp ? [xi - tp.pmra * (yrAll - yr), eta - tp.pmdec * (yrAll - yr)] : [xi, eta]; };
    // 2010: the nearest source within 3"; failing that (a slow mover has drifted a few arcsec), the nearest one within
    // 8" that has the same brightness, for sources bright enough for that comparison to mean something
    const [wx, wy] = back(2010.5), wn = within(wPos, wx, wy, hasPm(g) ? 4 : tp ? 6 : 8);
    const wc = wn.find((q) => q.d <= 3) ?? (tp ? wn[0] : s.snr >= 12 ? wn.find((q) => same(b.W1, w1Of(W[q.k]), 1.6) || same(b.W2, w2Of(W[q.k]), 1.6)) : undefined);
    const w = wc ? W[wc.k] : null; if (wc) usedW.add(wc.k);
    // comparing with another survey adds the confusion error of this source once (it is common to all SPHEREx visits)
    const sys = sysPos(s.snr), ext: Epoch[] = [];
    if (w && wc) ext.push({ yr: w.epoch, xi: wPos[wc.k][0], eta: wPos[wc.k][1], err: Math.hypot(w.epos ?? 0.3, 0.1, sys), src: "WISE 2010" });
    // ~1999: with a Gaia motion, or once 2010 and today give a line, look where that line was; otherwise the same place
    let [tx, ty] = back(1999.5), tr = tp ? 6 : 3;
    const line = !hasPm(g) && ext.length && b.ep.length ? fitLine([...b.ep, ...ext], "") : null;
    if (line && line.base > 5) { tx = line.xi0 + line.ra * (1999.5 - line.t0); ty = line.eta0 + line.dec * (1999.5 - line.t0); tr = Math.min(6, Math.max(2.5, 1 + 3 * line.etot * (line.t0 - 1999.5))); }
    const tc = within(tPos, tx, ty, tr)[0], tm = tc ? T[tc.k] : null;
    if (tm && tc) ext.push({ yr: tm.epoch, xi: tPos[tc.k][0], eta: tPos[tc.k][1], err: Math.hypot(tm.epos ?? 0.2, 0.1, sys), src: "2MASS" });
    const pm = b.ep.length && ext.length ? fitLine([...b.ep, ...ext], ["SPHEREx", ...ext.map((e) => e.src)].join(" + ") + (tp ? ", found with its published motion" : "")) : b.pmSx;
    const tags: Tag[] = [], zone = zoneOf(xi, eta);
    const self = zone && !zone.old && Math.hypot(zone.xi - xi, zone.eta - eta) < 9;
    const split = b.chr > Math.max(1.5, 4 * sysPos(s.snr));        // red and blue centres differ: two sources of different colour
    if (b.satMask || self) tags.push("SATURATED"); else if (zone || blend(s) || b.crowd || split) tags.push("BLENDED");
    if (edge(s)) tags.push("EDGE");
    const lcv = !tags.includes("SATURATED") && b.P.length >= 8 ? lightCurve(b.P) : null;
    const [ra, dec] = stampToSky(center[0], center[1], N, s.x, s.y);
    return { n: n + 1, x: s.x, y: s.y, ra, dec, snr: s.snr, red: s.red, track: !!s.track, gaia: g, wise: w, tm, linked: false, tracked: !!tp && ext.length > 0, J: b.J, H: b.H, K: b.K, W1: b.W1, W2: b.W2,
      epochs: [...ext, ...b.ep].sort((p, q) => p.yr - q.yr), pm, pmSx: b.pmSx, dW1: null, dW2: null, dK: null,
      lc: lcv ? { variable: lcv.variable, amp: (lcv.best ?? lcv.all).amplitude, pairs: lcv.pairs } : null,
      tags, why: zone && !self ? (zone.old ? `where ${zone.id} stood in ${zone.yr.toFixed(0)}: the old surveys are flooded by it here` : `in the halo of ${zone.id}`) : split ? `its red and blue light are centred ${b.chr.toFixed(1)}″ apart: two sources in one pixel` : "", known: "", isTarget: isT, P: b.P };
  });
  const clean = (r: ChangeRow) => !r.tags.includes("SATURATED") && !r.tags.includes("BLENDED") && !r.tags.includes("EDGE");
  // ---- depth of this field in the two WISE bands (5 sigma, mJy)
  const lim = (b: "W1" | "W2") => { const v = rows.filter(clean).map((r) => r[b]).filter(Boolean).map((x) => x!.e); return v.length >= 3 ? 5 * median(v) : null; };
  const l1 = lim("W1"), l2 = lim("W2");
  // ---- 15- and 25-year brightness change on the field's own zero point. "Then" is everything the old survey saw
  //      inside one SPHEREx resolution element, so two old sources merged into one new one are not a brightening
  const sg = psf / 2.355, wgt = (d: number) => Math.exp(-(d * d) / (4 * sg * sg));
  const sumThen = (P: [number, number][], flux: (k: number) => number | null, xi: number, eta: number, own: number | null) => {
    if (own === null || !(own > 0)) return null; let s = 0;
    for (const q of within(P, xi, eta, 14)) { const f = flux(q.k); if (f) s += f * wgt(q.d); }
    return { sum: Math.max(s, own), frac: own / Math.max(s, own) };
  };
  const zp: FieldReport["cal"]["zp"] = {};
  const cmp = (key: "dW1" | "dW2" | "dK", band: string, now: (r: ChangeRow) => Band, then: (r: ChangeRow, xi: number, eta: number) => { sum: number; frac: number } | null, year: (r: ChangeRow) => number) => {
    const L = rows.map((r) => { const a = now(r), [xi, eta] = tan(r.x, r.y), b = then(r, xi, eta); return a && b && a.f > 0 ? { r, a, b, q: Math.log(a.f / b.sum) } : null; });
    const good = L.filter((l) => l && clean(l.r) && l.a.f > 8 * l.a.e) as { q: number }[];
    const z0 = good.length >= 5 ? median(good.map((l) => l.q)) : 0, sc = good.length >= 5 ? Math.max(0.05, mad(good.map((l) => l.q), z0)) : 0.15;
    zp[band] = { zp: Math.exp(z0), sc, n: good.length };
    L.forEach((l) => { if (!l) return; if (l.b.frac < 0.6 && !l.r.tags.includes("BLENDED") && !l.r.tags.includes("SATURATED")) { l.r.tags.push("BLENDED"); l.r.why ||= "two catalogued sources inside one SPHEREx pixel"; }
      l.r[key] = { ratio: Math.exp(l.q - z0), z: (l.q - z0) / Math.hypot(sc, l.a.e / l.a.f, 0.05), then: l.b.sum, now: l.a.f / Math.exp(z0), band, year: year(l.r) }; });
  };
  cmp("dW1", "W1", (r) => r.W1, (r, xi, eta) => (r.wise ? sumThen(wPos, (k) => w1Of(W[k]), xi, eta, w1Of(r.wise)) : null), () => 2010.5);
  cmp("dW2", "W2", (r) => r.W2, (r, xi, eta) => (r.wise ? sumThen(wPos, (k) => w2Of(W[k]), xi, eta, w2Of(r.wise)) : null), () => 2010.5);
  cmp("dK", "Ks", (r) => r.K, (r, xi, eta) => (r.tm && Number.isFinite(r.tm.k) ? sumThen(tPos, (k) => (Number.isFinite(T[k].k) ? magToMjy(T[k].k, "Ks") : null), xi, eta, magToMjy(r.tm.k, "Ks")) : null), (r) => r.tm?.epoch ?? 1999.5);
  // ---- motion: how well do we recover the Gaia stars? That scatter is the noise floor for everything else
  const dpm: number[] = [];
  rows.forEach((r) => { if (hasPm(r.gaia) && r.pm && r.pm.base > 5 && clean(r) && r.snr >= 15) dpm.push(r.pm.ra - r.gaia!.pmra, r.pm.dec - r.gaia!.pmdec); });
  const pmRms = dpm.length >= 6 ? Math.max(0.008, mad(dpm, median(dpm))) : null, pmFloor = pmRms ?? 0.03;
  // ---- a bright source with no 2010 counterpart, and a bright 2010 source with nothing there today: the same object?
  const bright = (o: CatSource) => { const f1 = w1Of(o), f2 = w2Of(o); return (l1 !== null && f1 !== null && f1 > 4 * l1) || (l2 !== null && f2 !== null && f2 > 4 * l2); };
  const orphanW = W.map((w, k) => ({ w, k, xi: wPos[k][0], eta: wPos[k][1] })).filter((o) => !usedW.has(o.k) && bright(o.w) && Math.abs(o.xi) < (c - 4) * PIX && Math.abs(o.eta) < (c - 4) * PIX);
  const linkedW = new Set<number>();
  const excess = (r: ChangeRow) => [r.dW1, r.dW2].some((d) => d && d.ratio > 3 && d.z > 5) && ![r.dW1, r.dW2].some((d) => d && d.ratio < 2);
  if (haveW) for (const r of rows) {
    // candidates: no 2010 counterpart at all, or a "counterpart" several times too faint to be the same object
    if (r.tags.includes("SATURATED") || r.tags.includes("EDGE") || (hasPm(r.gaia) && !r.track) || Math.max(sn(r.W1), sn(r.W2)) < 10) continue;
    if (r.wise && !excess(r)) continue;
    const [xi, eta] = tan(r.x, r.y), sx = r.pmSx, vis = r.epochs.filter((e) => e.src === "SPHEREx");
    const esx = sx ? Math.hypot(sx.etot, (floor * 1.5) / Math.max(sx.base, 0.3)) : Infinity, sure = !!sx && vis.length >= 2 && vis.every((e) => (e.snr ?? 0) >= 8) && sx.tot > 3 * esx;
    let pick: (typeof orphanW)[number] | null = null, score = Infinity;
    for (const o of orphanW) {
      if (linkedW.has(o.k)) continue;
      const d = Math.hypot(xi - o.xi, eta - o.eta); if (d < 2.5 || d / (yrAll - 2010.5) > 12) continue;
      const ok1 = same(r.W1, w1Of(o.w), 2.2), ok2 = same(r.W2, w2Of(o.w), 2.2);
      if (ok1 === false || ok2 === false || (ok1 === null && ok2 === null)) continue;                  // must look like the same object
      // if SPHEREx alone sees it move, the 2010 position must lie back along that path; otherwise only short hops are linked
      if (sure) { const bx = sx!.xi0 + sx!.ra * (2010.5 - sx!.t0), by = sx!.eta0 + sx!.dec * (2010.5 - sx!.t0), tol = Math.min(40, Math.max(8, 3 * esx * (yrAll - 2010.5))); if (Math.hypot(bx - o.xi, by - o.eta) > tol) continue; }
      else if (d > 25) continue;
      if (d < score) { score = d; pick = o; }
    }
    if (pick) {
      linkedW.add(pick.k); r.wise = pick.w; r.linked = true; r.dW1 = r.dW2 = null;
      const e: Epoch = { yr: pick.w.epoch, xi: pick.xi, eta: pick.eta, err: Math.hypot(pick.w.epos ?? 0.3, 0.1, sysPos(r.snr)), src: "WISE 2010" };
      r.epochs = [e, ...r.epochs.filter((q) => q.src === "SPHEREx")].sort((a, b) => a.yr - b.yr);
      r.pm = fitLine(r.epochs, "SPHEREx + WISE 2010, linked"); r.tm = null;
      if (r.pm && haveT) { const L = r.pm, bx = L.xi0 + L.ra * (1999.5 - L.t0), by = L.eta0 + L.dec * (1999.5 - L.t0), tc = within(tPos, bx, by, Math.min(12, Math.max(3, 1 + 3 * L.etot * (L.t0 - 1999.5))))[0];
        if (tc) { const t2 = T[tc.k]; r.tm = t2; r.epochs = [{ yr: t2.epoch, xi: tPos[tc.k][0], eta: tPos[tc.k][1], err: Math.hypot(t2.epos ?? 0.2, 0.1, sysPos(r.snr)), src: "2MASS" as const }, ...r.epochs].sort((a, b) => a.yr - b.yr);
          r.pm = fitLine(r.epochs, "SPHEREx + WISE 2010 + 2MASS, linked"); } }
    }
  }
  // ---- how deep the catalogue rows in hand go. The services return the brightest rows first, up to a cap: in a
  //      crowded or wide field the list stops well above the survey's own limit, and a source fainter than its last row
  //      cannot be called absent from that survey. (Three quarters of a magnitude of margin.)
  const faintest = (v: (number | null | undefined)[]) => { const m = v.filter((x): x is number => typeof x === "number" && Number.isFinite(x)); return m.length ? Math.max(...m) : null; };
  const wEnd = faintest(W.map((w) => w.mag)), tEnd = faintest(T.map((t) => t.k));
  const reach = { w1: wEnd !== null ? magToMjy(wEnd - 0.75, "W1") : Infinity, w2: wEnd !== null ? magToMjy(wEnd - 0.75, "W2") : Infinity, k: tEnd !== null ? magToMjy(tEnd - 0.75, "Ks") : Infinity };
  const shortList = (wEnd !== null && wEnd < 15.5) || W.length >= 400;
  // ---- verdicts
  for (const r of rows) {
    const ok = clean(r), vis = r.epochs.filter((e) => e.src === "SPHEREx");
    if (r.pm) {
      const e = Math.hypot(r.pm.etot, pmFloor), sig = r.pm.tot / e; r.pm.sig = sig;
      const long = r.pm.base > 5, alone = !long && vis.length >= 3 && vis.every((q) => (q.snr ?? 0) >= 8) && sig >= 6 && r.pm.chi2 < 6;
      // a star with a Gaia motion must agree with it: if not, the image is contaminated, not moving
      const agrees = !hasPm(r.gaia) || Math.hypot(r.pm.ra - r.gaia!.pmra, r.pm.dec - r.gaia!.pmdec) < Math.max(4 * e, 0.04);
      if (!agrees && ok) { r.tags.push("BLENDED"); r.why ||= "position disagrees with Gaia's motion: contaminated image"; }
      // two dated positions always lie on a line: a claim needs a third one that could have contradicted it
      else if ((ok || r.linked) && r.pm.n >= 3 && sig >= 5 && r.pm.tot >= 0.08 && ((long && r.snr >= 12) || alone || r.linked || (r.track && sig >= 6))) r.tags.unshift("MOVED");
      // a saturated star is not judged on its own; but when Gaia says it moves and the wings of its image give the same motion, that is a confirmation
      else if (r.tags.includes("SATURATED") && !r.tags.includes("BLENDED") && !r.tags.includes("EDGE") && hasPm(r.gaia) && Math.hypot(r.gaia!.pmra, r.gaia!.pmdec) >= 0.08 && r.pm.n >= 3 && long && sig >= 8 &&
        Math.hypot(r.pm.ra - r.gaia!.pmra, r.pm.dec - r.gaia!.pmdec) < Math.max(3 * e, 0.04)) { r.tags.unshift("MOVED"); r.why = "saturated: measured on the wings of its image; the motion agrees with Gaia"; }
      // the visitor's target tracked with its published motion: a measurement over the long baseline that agrees with it confirms it, blended or not
      else if (r.tracked && track && !r.tags.includes("SATURATED") && !r.tags.includes("EDGE") && r.pm.n >= 3 && long && sig >= 8 &&
        Math.hypot(r.pm.ra - track.pmra, r.pm.dec - track.pmdec) < Math.max(3 * e, 0.04, 0.03 * r.pm.tot)) { r.tags.unshift("MOVED"); r.why = `tracked with its published motion${r.tags.includes("BLENDED") ? "; today it shares a pixel with another source" : ""}`; }
      else if (ok && r.pm.n < 3 && sig >= 5 && r.pm.tot >= 0.08) r.why ||= "only two dated positions: this motion cannot be tested yet";
    }
    const ok2 = clean(r), ds = [r.dW1, r.dW2].filter(Boolean) as Delta[], strong = ds.filter((d) => Math.abs(d.z) >= 5 && Math.abs(Math.log(d.ratio)) > 0.26);
    if (ok2 && r.snr >= 15 && strong.length && !ds.some((d) => Math.sign(Math.log(d.ratio)) !== Math.sign(Math.log(strong[0].ratio)) && Math.abs(d.z) > 2)) r.tags.unshift(strong[0].ratio > 1 ? "BRIGHTER" : "FAINTER");
    if (ok2 && r.snr >= 30 && r.lc?.variable) r.tags.push("VARIABLE");
    // "new" only means something for a source the old surveys would have seen, and that is there at more than one visit
    const deep = (sn(r.W1) >= 5 && r.W1!.f > Math.max(0.25, reach.w1)) || (sn(r.W2) >= 5 && r.W2!.f > Math.max(0.3, reach.w2)) || (sn(r.K) >= 5 && r.K!.f > Math.max(2, reach.k));
    if (ok2 && !r.wise && !r.gaia && !r.tm && haveW && haveG && r.snr >= 12 && deep && vis.filter((q) => (q.snr ?? 0) >= 6).length >= Math.min(2, V.length) &&
      !within(wPos, ...tan(r.x, r.y), 7).length && !within(tPos, ...tan(r.x, r.y), 7).length) r.tags.unshift("NEW");
    r.known = r.gaia ? r.gaia.id : r.wise ? r.wise.id : r.tm ? r.tm.id : !(haveG || haveW) ? "catalogues unavailable" : deep || !shortList ? "not in Gaia, AllWISE or 2MASS" : "fainter than the catalogue rows read for this field";
  }
  for (const z of zones) {
    if (z.old || Math.abs(z.xi) > (c - 2) * PIX || Math.abs(z.eta) > (c - 2) * PIX) continue;
    if (rows.some((r) => { const [xi, eta] = tan(r.x, r.y); return Math.hypot(xi - z.xi, eta - z.eta) < 9; })) continue;
    const [x, y] = pix(z.xi, z.eta), [ra, dec] = stampToSky(center[0], center[1], N, x, y), w = W.find((q) => q.id === z.id) ?? null, tm = T.find((q) => q.id === z.id) ?? null;
    rows.push({ n: 0, x, y, ra, dec, snr: 0, red: false, track: false, gaia: null, wise: w, tm, linked: false, J: null, H: null, K: null, W1: null, W2: null, epochs: [], pm: null, pmSx: null,
      dW1: null, dW2: null, dK: null, lc: null, tags: ["SATURATED"], why: "too bright for SPHEREx: the core is lost", known: z.id, isTarget: !!target && Math.hypot(x - target[0], y - target[1]) < 2, P: [] });
  }
  // ---- sources of 2010 that should be plainly visible today and are not (saturating stars are not "gone")
  const gone: GoneRow[] = orphanW.filter((o) => !linkedW.has(o.k) && !zoneOf(o.xi, o.eta) && !rows.some((r) => { const [xi, eta] = tan(r.x, r.y); return Math.hypot(xi - o.xi, eta - o.eta) < (r.snr > 30 ? 20 : 8); }))
    .map((o) => ({ wise: o.w, x: pix(o.xi, o.eta)[0], y: pix(o.xi, o.eta)[1], w1: w1Of(o.w), w2: w2Of(o.w) }));
  rows.sort((a, b) => score(b) - score(a) || b.snr - a.snr).forEach((r, k) => (r.n = k + 1));
  const has = (t: Tag) => rows.filter((r) => r.tags.includes(t)).length;
  const pmErr = rows.filter((r) => clean(r) && r.pm && r.pm.base > 5 && r.snr > 15).map((r) => Math.hypot(r.pm!.etot, pmFloor));
  return { rows, gone, cal: { nRef: refs.length, astroRms: calibrated ? astroRms : null, pmRms, posA, posB, zp },
    visits: V.map((q) => ({ yr: q.yr, n: q.n })), yr: yrAll, span: V.length ? V[V.length - 1].yr - V[0].yr : 0,
    catalogs: { gaia: haveG, wise: haveW, tm: haveT },
    counts: { moved: has("MOVED"), movedUnknown: rows.filter((r) => r.tags.includes("MOVED") && !hasPm(r.gaia)).length, brighter: has("BRIGHTER"), fainter: has("FAINTER"), variable: has("VARIABLE"), fresh: has("NEW"), gone: gone.length, measured: rows.filter(clean).length },
    limits: { pm: pmErr.length ? 5 * median(pmErr) : null, w1: l1, w2: l2 } };
}
/** rows that changed come first, the strongest change on top */
function score(r: ChangeRow) {
  const t = r.tags;
  return (t.includes("MOVED") ? 1000 + Math.min(r.pm?.sig ?? 0, 500) : 0) + (t.includes("BRIGHTER") || t.includes("FAINTER") ? 600 + Math.min(Math.max(Math.abs(r.dW1?.z ?? 0), Math.abs(r.dW2?.z ?? 0)), 300) : 0) +
    (t.includes("NEW") ? 500 : 0) + (t.includes("VARIABLE") ? 200 : 0) + (r.isTarget ? 50 : 0);
}
