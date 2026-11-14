// The unknown-neighbour candidates through the field detector (same code as the Lab), plus what CatWISE2020 and
// SIMBAD already say about each. Output: public/data/verified/candidates.json
//   usage: npx tsx scripts/candidates_report.mts [base URL of a server holding public/, default http://127.0.0.1:5173/]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as E from "../src/blink/engine.ts";
import { detectChanges } from "../src/blink/detect.ts";
import { gaia, allwise, twomass } from "../src/blink/catalogs.ts";

E.setBase(process.argv[2] ?? "http://127.0.0.1:5173/");
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const items = JSON.parse(readFileSync(here("../public/data/candidates.json"), "utf8")).items as any[];
const N = 64, TREF = 2016.41, median = (a: number[]) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const retry = async <T,>(f: () => Promise<T>, n = 3): Promise<T | null> => { for (let k = 0; k < n; k++) { try { return await f(); } catch { await new Promise((r) => setTimeout(r, 1500 * (k + 1))); } } return null; };
async function catwise(ra: number, dec: number) {
  const u = `https://irsa.ipac.caltech.edu/cgi-bin/Gator/nph-query?catalog=catwise_2020&spatial=cone&radius=8&radunits=arcsec&objstr=${ra.toFixed(6)}+${dec.toFixed(6)}&outfmt=1&selcols=source_name,ra,dec,pmra,pmdec,sigpmra,sigpmdec,w1mpro,w2mpro`;
  const t = await (await fetch(u, { signal: AbortSignal.timeout(40000) })).text();
  const rows = t.split("\n").filter((l) => l && !l.startsWith("\\") && !l.startsWith("|")).map((l) => l.trim().split(/\s+/));
  if (!rows.length) return null;
  const r = rows[0]; return { name: `CWISE ${r[0]}`, pmra: +r[5], pmdec: +r[6], epm: Math.hypot(+r[7], +r[8]) / Math.SQRT2, w1: +r[9], w2: +r[10] };
}
async function simbad(ra: number, dec: number, r = 8) {
  const q = `SELECT TOP 1 main_id, otype, sp_type FROM basic WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra.toFixed(6)}, ${dec.toFixed(6)}, ${(r / 3600).toFixed(6)})) = 1`;
  const t = await (await fetch("https://simbad.cfa.harvard.edu/simbad/sim-tap/sync?request=doQuery&lang=adql&format=tsv&query=" + encodeURIComponent(q), { signal: AbortSignal.timeout(25000) })).text();
  const L = t.trim().split("\n"); if (L.length < 2) return "";
  const v = L[1].split("\t").map((x) => x.trim().replace(/^"|"$/g, "")); return `${v[0]} (${v[1]}${v[2] ? ", " + v[2] : ""})`;
}
const out: any[] = [];
for (const c of items) {
  const id = `${c.tile}-${c.obj}`, t0 = Date.now(), t = { ra: c.ra, dec: c.dec, pmra: c.pmra, pmdec: c.pmdec, epoch: TREF, name: `MIRA ${id}` };
  try {
    const b = await E.build(t, { size: N, maxFrames: 72, concurrency: 8 });
    // one catalogue at a time, patiently: the public mirrors throttle bursts
    const R = ((N * E.PIX_ARCSEC) / 2) * 1.45, g = await retry(() => gaia(b.center[0], b.center[1], R, 600), 5), w = await retry(() => allwise(b.center[0], b.center[1], R + 30, 600), 5), m = await retry(() => twomass(b.center[0], b.center[1], R + 40, 600), 5);
    const masks = await Promise.all(b.frames.map((f) => E.readMask(f, N).catch(() => null)));
    const mid = b.frames[b.frames.length >> 1], rep = b.frames.length >= 4 ? detectChanges(b.frames, N, b.center, { gaia: g?.length ? g : null, wise: w?.length ? w : null, tm: (m?.length ? m : null) as any }, mid ? [mid.tx, mid.ty] : null, masks as any) : null;
    const r = rep?.rows.find((q) => q.isTarget) ?? null;
    const cosd = Math.cos((c.dec * Math.PI) / 180), cw = await retry(() => catwise(c.ra - (c.pmra * 1.0) / 3600 / cosd, c.dec - (c.pmdec * 1.0) / 3600), 2);
    const sb = await retry(() => simbad(c.ra - (c.pmra * 16.41) / 3600 / cosd, c.dec - (c.pmdec * 16.41) / 3600), 2);
    const bandMed = (a: number, z: number) => { const v = (r?.P ?? []).filter((p) => !p.flagged && p.lam >= a && p.lam <= z); return v.length >= 2 ? { f: median(v.map((p) => p.flux)), e: median(v.map((p) => p.err)) / Math.sqrt(v.length) } : null; };
    const ch = bandMed(3.2, 3.45), rf = bandMed(3.9, 4.2), e = r?.pm ? Math.hypot(r.pm.etot, rep?.cal.pmRms ?? 0.03) : null;
    const rec = { id, ra: c.ra, dec: c.dec, census_pm: [c.pmra, c.pmdec], frames: b.frames.length, visits: b.visits, detected: !!r, snr: r ? +r.snr.toFixed(1) : null, tags: r?.tags ?? [], why: r?.why ?? "",
      pm: r?.pm ? { ra: +r.pm.ra.toFixed(4), dec: +r.pm.dec.toFixed(4), err: +e!.toFixed(4), sigma: +r.pm.sig.toFixed(1), baseline: +r.pm.base.toFixed(1), using: r.pm.using } : null,
      gaia: r?.gaia ? { id: r.gaia.id, pmra: r.gaia.pmra, pmdec: r.gaia.pmdec, plx: r.gaia.plx, G: r.gaia.mag } : null, allwise: r?.wise?.id ?? null, twomass: r?.tm?.id ?? null,
      flux: r ? { J: r.J?.f ?? null, H: r.H?.f ?? null, K: r.K?.f ?? null, W1: r.W1?.f ?? null, W2: r.W2?.f ?? null } : null, dW1: r?.dW1 ? +r.dW1.ratio.toFixed(2) : null, dW2: r?.dW2 ? +r.dW2.ratio.toFixed(2) : null,
      ch4: ch && rf && rf.f > 4 * rf.e ? +(ch.f / rf.f).toFixed(2) : null, field: rep ? { sources: rep.counts.measured, ref_stars: rep.cal.nRef, gaia_recovery: rep.cal.pmRms ? +rep.cal.pmRms.toFixed(3) : null, limit_pm: rep.limits.pm ? +rep.limits.pm.toFixed(2) : null } : null,
      catwise: cw, simbad: sb ?? "", cats: { gaia: !!g?.length, wise: !!w?.length, tm: !!m?.length }, sec: +((Date.now() - t0) / 1000).toFixed(0) };
    out.push(rec); console.log(JSON.stringify(rec));
  } catch (err) { out.push({ id, ra: c.ra, dec: c.dec, census_pm: [c.pmra, c.pmdec], error: String((err as Error).message).slice(0, 100) }); console.log(id, "ERROR", (err as Error).message); }
}
writeFileSync(here("../public/data/verified/candidates.json"), JSON.stringify({ built: new Date().toISOString().slice(0, 16) + "Z", n: out.length, items: out }, null, 1));
console.log("written", out.length);
