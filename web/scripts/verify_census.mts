// Re-measure census candidates on the raw SPHEREx Level-2 exposures, with the same engine the browser runs.
// For every candidate: where is it really (against the position its WISE-era motion predicts, and against "it never
// moved"), how bright is it in the WISE bands now, is the methane dip there, did it change between SPHEREx visits.
//
//   usage: npx tsx scripts/verify_census.mts <in.jsonl> <out.jsonl> [--data public/] [--par 6] [--frames 45]
//   in:    one JSON object per line: {id, ra, dec, pmra, pmdec}   (deg at epoch 2016.41 = MJD 57500; arcsec/yr)
//   out:   one JSON object per line (appended; ids already present are skipped, so the job can be restarted)
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as E from "../src/blink/engine.ts";
import * as M from "../src/blink/measure.ts";
import { shiftImage, robustStack } from "../src/blink/imaging.ts";

const args = process.argv.slice(2), opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [inF, outF] = args;
const DATA = opt("--data", "public/").replace(/\/?$/, "/"), PAR = +opt("--par", "6"), MAXF = +opt("--frames", "45");
const N = 24, PIX = E.PIX_ARCSEC, TREF = 2016.41, DETS = new Set(opt("--dets", "2,3,4,5,6").split(",").map(Number));

// the exposure index and the filter map come from disk; everything else (NASA's bucket) goes over the network
const realFetch = globalThis.fetch, cache = new Map<string, string | null>();
globalThis.fetch = (async (u: any, init?: any) => {
  const url = String(u);
  if (!url.startsWith("local:/")) return realFetch(u, init);
  let body = cache.get(url);
  if (body === undefined) {
    body = await readFile(DATA + url.slice(7), "utf8").catch(() => null);
    if (cache.size > 400) cache.delete(cache.keys().next().value!);
    cache.set(url, body);
  }
  return body === null ? new Response("", { status: 404 }) : new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
E.setBase("local:/");

type Cand = { id: string; ra: number; dec: number; pmra: number; pmdec: number };
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const mad = (a: number[], m: number) => median(a.map((v) => Math.abs(v - m))) * 1.4826;
const r3 = (v: number | null | undefined, d = 3) => (v === null || v === undefined || !isFinite(v) ? null : +v.toFixed(d));

/** robust flux of the clean measurements in a wavelength window: [median mJy, error of the median, n] */
function band(P: M.Phot[], a: number, b: number): [number | null, number | null, number] {
  const v = P.filter((p) => !p.flagged && isFinite(p.flux) && p.lam >= a && p.lam <= b);
  if (v.length < 2) return [null, null, v.length];
  const f = v.map((p) => p.flux), m = median(f), e = Math.max(mad(f, m), median(v.map((p) => p.err))) * 1.2533 / Math.sqrt(v.length);
  return [r3(m, 4), r3(e, 4), v.length];
}

async function verify(c: Cand) {
  const t0 = Date.now(), t: E.Target = { ra: c.ra, dec: c.dec, pmra: c.pmra, pmdec: c.pmdec, epoch: TREF };
  const b = await E.build(t, { size: N, maxFrames: MAXF, dets: DETS, concurrency: 6 });
  const F = b.frames;
  const base = { id: c.id, n: F.length, cov: b.covered, fail: b.failed, vis: b.visits };
  if (F.length < 4) return { ...base, ok: 0, sec: r3((Date.now() - t0) / 1000, 1) };
  const over = E.FLAG_DEFS.find((d) => d.name === "OVERFLOW"), obit = over ? 1 << over.bit : 0, bad = E.badMask();
  const nSat = F.filter((f) => f.flags > 0 && f.flags & obit).length, nFlag = F.filter((f) => f.flags > 0 && f.flags & bad).length;
  // 1. where is the source, relative to where the WISE-era motion says it should be in each exposure?
  const cen: { e: number; n: number; w: number; yr: number; det: number }[] = [];
  for (const f of F) {
    if (f.flags > 0 && f.flags & bad) continue;
    const m = M.centroid(f, N, f.tx, f.ty); if (!m || m.snr < 6) continue;
    const fw = (isFinite(f.psf) ? f.psf : 7.5) / PIX, err = Math.hypot((fw / 2.35 / m.snr) * 1.5, 0.12) * PIX;
    cen.push({ e: -(m.x - f.tx) * PIX, n: -(m.y - f.ty) * PIX, w: 1 / (err * err), yr: E.mjdToYear(f.mjd), det: f.det });
  }
  let off: any = null, probe = { dx: 0, dy: 0 };
  // 1a. the same question on a deep "white-light" stack: every clean exposure, whatever its wavelength, shifted so
  //     that the predicted position falls on the stamp centre and weighted by its noise. A position does not depend
  //     on wavelength, so this reaches sources far too faint to centroid in single exposures.
  const c0 = (N - 1) / 2, clean = F.filter((f) => !(f.flags > 0 && f.flags & bad) && f.noise > 0);
  let stk: any = null;
  if (clean.length >= 4) {
    const imgs = clean.map((f) => { const im = shiftImage(f.img, N, f.tx - c0, f.ty - c0), s = 1 / f.noise; for (let q = 0; q < im.length; q++) im[q] *= s; return im; });
    const st = robustStack(imgs, N * N), psf = median(clean.map((f) => (isFinite(f.psf) && f.psf > 2 ? f.psf : 7.5)));
    const fake = { ...clean[0], img: st, psf } as E.Frame, m = M.centroid(fake, N, c0, c0);
    if (m && m.snr >= 5) {
      const yr = clean.reduce((q, f) => q + E.mjdToYear(f.mjd), 0) / clean.length, err = Math.hypot((psf / 2.35 / m.snr) * 1.5, 0.25);
      stk = { e: r3(-(m.x - c0) * PIX), n: r3(-(m.y - c0) * PIX), err: r3(err), snr: r3(m.snr, 1), k: clean.length, yr: r3(yr) };
      if (Math.hypot(m.x - c0, m.y - c0) < 3) probe = { dx: m.x - c0, dy: m.y - c0 };
    } else stk = { snr: m ? r3(m.snr, 1) : 0, k: clean.length };
  }
  if (cen.length >= 3) {
    const me = median(cen.map((q) => q.e)), mn = median(cen.map((q) => q.n)), se = mad(cen.map((q) => q.e), me), sn = mad(cen.map((q) => q.n), mn);
    const keep = cen.filter((q) => Math.abs(q.e - me) < Math.max(3 * se, 1.2) && Math.abs(q.n - mn) < Math.max(3 * sn, 1.2));
    const W = keep.reduce((s, q) => s + q.w, 0), oe = keep.reduce((s, q) => s + q.w * q.e, 0) / W, on = keep.reduce((s, q) => s + q.w * q.n, 0) / W, yr = keep.reduce((s, q) => s + q.w * q.yr, 0) / W;
    const sc = Math.sqrt(keep.reduce((s, q) => s + q.w * ((q.e - oe) ** 2 + (q.n - on) ** 2), 0) / W / 2);
    // error of the mean: the larger of the formal one and the observed scatter, with a 0.25" floor for the WCS of single exposures
    const err = Math.hypot(Math.max(1 / Math.sqrt(W), sc / Math.sqrt(keep.length)), 0.25 / Math.sqrt(Math.max(1, new Set(keep.map((q) => Math.round(q.yr * 6))).size)));
    off = { e: r3(oe), n: r3(on), err: r3(err), k: keep.length, yr: r3(yr), sc: r3(sc) };
    if (!stk?.err && Math.hypot(oe, on) < 3 * PIX) probe = { dx: -oe / PIX, dy: -on / PIX };
  }
  // 2. brightness at the place where the source really is
  const P = M.spectrum(F, N, probe, true);
  const bands = { J: band(P, 1.17, 1.33), H: band(P, 1.5, 1.78), K: band(P, 2.0, 2.3), W1: band(P, 2.9, 3.8), CH4: band(P, 3.2, 3.45), REF: band(P, 3.9, 4.2), W2: band(P, 4.1, 5.0), CO: band(P, 4.5, 4.8) };
  // 3. motion from SPHEREx alone (needs two visits), and change between visits at matched wavelengths
  const mo = M.fitMotion(F, N, b.center, probe, true);
  const lc = M.lightCurve(P), top = lc.best ?? lc.all;
  return { ...base, ok: 1, sat: nSat, flag: nFlag, stk, off, f: bands,
    pm: mo && { ra: r3(mo.pmra), dec: r3(mo.pmdec), era: r3(mo.epmra), edec: r3(mo.epmdec), n: mo.n, vis: mo.visits, span: r3(mo.span, 0), rms: r3(mo.rms, 2) },
    lc: { v: lc.variable ? 1 : 0, amp: r3(top.amplitude, 2), chi2: r3(top.chi2, 1), pairs: lc.pairs, det: lc.best?.det ?? 0, vis: top.visits.map((v) => [r3(v.mjd, 0), r3(v.ratio), r3(v.err), v.n]) },
    t: [r3(E.mjdToYear(F[0].mjd)), r3(E.mjdToYear(F[F.length - 1].mjd))], sec: r3((Date.now() - t0) / 1000, 1) };
}

const done = new Set<string>();
if (existsSync(outF)) for (const l of readFileSync(outF, "utf8").split("\n")) { if (l) try { done.add(JSON.parse(l).id); } catch { /* partial last line */ } }
const todo: Cand[] = readFileSync(inF, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((c: Cand) => !done.has(c.id));
console.error(`${inF}: ${todo.length} to do, ${done.size} already done`);
let k = 0, fin = 0; const T0 = Date.now();
await Promise.all(Array.from({ length: PAR }, async () => {
  while (k < todo.length) {
    const c = todo[k++];
    let r: any;
    try { r = await verify(c); } catch (e) { r = { id: c.id, ok: 0, err: String((e as Error).message ?? e).slice(0, 120) }; }
    appendFileSync(outF, JSON.stringify(r) + "\n");
    if (++fin % 50 === 0) console.error(`${fin}/${todo.length}  ${(fin / ((Date.now() - T0) / 1000)).toFixed(2)}/s`);
  }
}));
console.error(`done ${fin} in ${((Date.now() - T0) / 1000).toFixed(0)} s`);
