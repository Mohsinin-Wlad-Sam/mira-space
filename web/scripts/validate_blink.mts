// Validation run for BLINK: the five challenge targets through the same engine the browser uses.
// Reads SPHEREx exposures from NASA's public archive, so it needs network access and the exposure index
// (web/public/data/sphx2, served by `npm run dev` or any static server).
//   usage: npx tsx scripts/validate_blink.mts [base URL, default http://127.0.0.1:5173/]   ->  public/validation.json
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as E from "../src/blink/engine.ts";
import * as M from "../src/blink/measure.ts";
import { CHALLENGE, allwise, magToMjy, angSep } from "../src/blink/catalogs.ts";

E.setBase(process.argv[2] ?? "http://127.0.0.1:5173/");
const N = 32, out: any[] = [], median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
for (const t of CHALLENGE) {
  const t0 = Date.now();
  const b = await E.build(t, { size: N, maxFrames: 144, concurrency: 8 });
  const dets = t.key === "wise-0855" ? new Set([5, 6]) : undefined;      // as in the app: this target only exists at 4-5 µm
  const over = E.FLAG_DEFS.find((d) => d.name === "OVERFLOW")!, nSat = b.frames.filter((f) => f.flags > 0 && f.flags & (1 << over.bit)).length, sat = nSat > 0.5 * b.frames.length;
  const probe = { dx: 0, dy: 0 }, Pall = M.spectrum(b.frames, N, probe, true), P = Pall.filter((p) => !dets || dets.has(p.det));
  let motion = M.fitMotion(b.frames, N, b.center, probe, true, dets), flaggedFit = false;
  if (!motion && sat) { motion = M.fitMotion(b.frames, N, b.center, probe, true, dets, true); flaggedFit = !!motion; }
  const lc = M.lightCurve(sat ? M.haloSeries(b.frames, N, probe, true) : P);
  const band = (a: number, c: number) => { const v = Pall.filter((p) => !p.flagged && p.lam >= a && p.lam <= c).map((p) => p.flux); return v.length >= 2 ? median(v) : null; };
  const f33 = band(3.2, 3.45), f40 = band(3.9, 4.2), f46 = band(4.4, 4.8);
  // WISE W2 anchor from AllWISE at the target's 2010.5 position
  let w2: number | null = null;
  try { const [ra, dec] = E.propagate(t, 51544.5 + 10.5 * 365.25), W = await allwise(ra, dec, 20); const m = W.filter((s) => angSep(ra, dec, s.ra, s.dec) < 6 && s.mag != null).sort((a, c) => angSep(ra, dec, a.ra, a.dec) - angSep(ra, dec, c.ra, c.dec))[0]; if (m) w2 = magToMjy(m.mag!, "W2"); } catch { /* catalogue service unavailable */ }
  // per detector: the target's median flux and the 5-sigma point-source limit of one exposure in this field (mJy)
  const perDet = [1, 2, 3, 4, 5, 6].map((d) => { const v = Pall.filter((p) => p.det === d); return { det: d, n: v.length, lam: v.length ? +median(v.map((p) => p.lam)).toFixed(2) : null,
    flux_mJy: v.filter((p) => !p.flagged).length >= 2 ? +median(v.filter((p) => !p.flagged).map((p) => p.flux)).toPrecision(3) : null, limit5_mJy: v.length ? +(5 * median(v.map((p) => p.err))).toPrecision(3) : null }; });
  const top = lc.best ?? lc.all;
  const r = { key: t.key, name: t.name, covered: b.covered, frames: b.frames.length, failed: b.failed, visits: b.visits, span_yr: +((b.frames[b.frames.length - 1].mjd - b.frames[0].mjd) / 365.25).toFixed(2),
    first: E.mjdToDate(b.frames[0].mjd), last: E.mjdToDate(b.frames[b.frames.length - 1].mjd), saturated_frames: nSat, saturated: sat,
    lit: { pmra: t.pmra, pmdec: t.pmdec, plx: (t.plx ?? 0) / 1000, source: t.lit },
    motion: motion && { pmra: +motion.pmra.toFixed(3), epmra: +motion.epmra.toFixed(3), pmdec: +motion.pmdec.toFixed(3), epmdec: +motion.epmdec.toFixed(3), plx: motion.plx === null ? null : +motion.plx.toFixed(3), eplx: motion.eplx === null ? null : +motion.eplx.toFixed(3),
      n: motion.n, rms: +motion.rms.toFixed(2), from_flagged: flaggedFit },
    methane_ratio: f33 !== null && f40 ? +(f33 / f40).toFixed(3) : null, f46_mJy: f46 === null ? null : +f46.toFixed(3), w2_catwise_mJy: w2 === null ? null : +w2.toFixed(3),
    detectors: perDet,
    lightcurve: { variable: lc.variable, pairs: lc.pairs, halo: sat, band: lc.best?.det ?? 0, amplitude: +top.amplitude.toFixed(2), lo: top.lo && E.mjdToDate(top.lo.mjd), hi: top.hi && E.mjdToDate(top.hi.mjd), all_amplitude: +lc.all.amplitude.toFixed(2) },
    seconds: +((Date.now() - t0) / 1000).toFixed(1) };
  out.push(r); console.log(JSON.stringify(r));
}
const meta = await E.indexMeta();
writeFileSync(fileURLToPath(new URL("../public/validation.json", import.meta.url)), JSON.stringify({ built: new Date().toISOString().slice(0, 16) + "Z", stamp_px: N, max_frames: 144, index: meta, targets: out }, null, 1));
