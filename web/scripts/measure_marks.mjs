// MEASURE THE OPEN MARKS. The sky model marked 400 places where MIRA's catalogue has nothing; 362 turned out to be
// fast-moving stars that Gaia or SIMBAD list. This puts the others through the Lab's own chain (the same code as the
// Watchlist: SPHEREx exposures from NASA's archive, Gaia / AllWISE / 2MASS from CDS, the motion detector), one after
// another, in a headless browser against the dev server, and writes what the Lab found at each place.
//
//   PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs node web/scripts/measure_marks.mjs [--url http://127.0.0.1:5173] [--out web/public/data/wm/open_marks.json]
import { readFileSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("url", "http://127.0.0.1:5173"), out = arg("out", "web/public/data/wm/open_marks.json"), scoutFile = arg("scout", "web/public/data/wm/scout.json");
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const marks = JSON.parse(readFileSync(scoutFile, "utf8")).marks.map((m, i) => ({ ...m, i })).filter((m) => !m.gaia && !m.simbad);
console.log(marks.length, "open marks");
const browser = await chromium.launch({ channel: "chrome", headless: true }), page = await (await browser.newContext()).newPage();
await page.goto(`${base}/explore/?embed=1&deck=1#lab`); await page.waitForTimeout(4000);
const results = [];
for (const [k, m] of marks.entries()) {
  const t0 = Date.now();
  const r = await page.evaluate(async (m) => {
    const { measureField } = await import("/src/blink/watchlist.ts");
    const sepArcsec = (a, b) => Math.hypot((a.ra - b.ra) * Math.cos((b.dec * Math.PI) / 180), a.dec - b.dec) * 3600;
    try {
      const f = await Promise.race([measureField({ ra: m.ra, dec: m.dec, name: `mark ${m.i}` }, { size: 32, maxFrames: 36 }), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 150000))]);
      if (f.error || !f.report) return { error: f.error ?? "no report", frames: f.frames, covered: f.covered };
      const rows = f.report.rows.map((q) => ({ n: q.n, ra: q.ra, dec: q.dec, sep: +sepArcsec(q, m).toFixed(1), tags: q.tags, snr: Math.round(q.snr), pm: q.pm && q.pm.base > 5 ? +q.pm.tot.toFixed(3) : null, epm: q.pm ? +Math.hypot(q.pm.etot, f.report.cal.pmRms ?? 0.03).toFixed(3) : null,
        sig: q.pm ? +q.pm.sig.toFixed(1) : null, base: q.pm ? +q.pm.base.toFixed(1) : null, gaia: q.gaia ? { pm: q.gaia.pmra !== null && q.gaia.pmdec !== null ? +Math.hypot(q.gaia.pmra, q.gaia.pmdec).toFixed(3) : null, plx: q.gaia.plx ?? null } : null, wise: !!q.wise, tm: !!q.tm }));
      return { frames: f.frames, covered: f.covered, sources: rows.length, moved: rows.filter((q) => q.tags.includes("MOVED")), near: rows.filter((q) => q.sep <= 40).sort((a, b) => a.sep - b.sep).slice(0, 4), counts: f.report.counts, limit: f.report.limits.pm ?? null };
    } catch (e) { return { error: String(e).slice(0, 120) }; }
  }, m).catch((e) => ({ error: String(e).slice(0, 120) }));
  // what the Lab says about the place: a source that moved, close to the mark
  const mv = (r.moved ?? []).filter((q) => q.sep <= 60).sort((a, b) => a.sep - b.sep)[0] ?? null, near = (r.near ?? [])[0] ?? null;
  const verdict = r.error ? "not read" : mv ? (mv.gaia && mv.gaia.pm !== null ? "moved, and Gaia lists the star" : "moved, no Gaia motion") : near && near.tags.some((t) => t === "SATURATED" || t === "BLENDED" || t === "EDGE") ? "not judged" : near ? "steady" : "no source";
  results.push({ i: m.i, ra: m.ra, dec: m.dec, conf: m.conf, model_pm: m.pm, vj: m.vj ?? null, verdict, best: mv ?? near, ...r, moved: undefined, near: undefined, n_moved: (r.moved ?? []).length });
  console.log(`${k + 1}/${marks.length}  ${m.ra.toFixed(3)} ${m.dec.toFixed(3)}  ${verdict}${mv ? `  ${mv.pm}±${mv.epm}″/yr at ${mv.sep}″` : ""}  ${Math.round((Date.now() - t0) / 1000)} s`);
  const tally = {}; results.forEach((q) => (tally[q.verdict] = (tally[q.verdict] ?? 0) + 1));
  writeFileSync(out, JSON.stringify({ about: "The sky model's marks that neither Gaia nor SIMBAD lists as a fast mover, measured by the Lab's own chain (web/scripts/measure_marks.mjs): 3.3-arcminute fields, 36 exposures.", made: new Date().toISOString(), measured: results.length, of: marks.length, tally, marks: results }));
}
await browser.close(); console.log("written", out);
