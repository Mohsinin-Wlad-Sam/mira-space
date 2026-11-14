// How often is the field detector right? Known moving stars (Gaia) and empty high-latitude fields through the same
// code as the Lab. Two passes per field:
//   1. as the Lab runs it, Gaia known: recovery of the catalogued motions.
//   2. BLIND: the stars under test are taken out of the Gaia list before the detector runs, so it knows nothing about
//      them from Gaia (no predicted 2010 / 1999 position, no "must agree with Gaia" rule). This is the situation of
//      an object Gaia does not list, such as a cold brown dwarf. The moving star at the field centre is removed in
//      every fold; the stars Gaia says are still are removed a third at a time, so that two thirds keep tying the
//      frame. A still star flagged "moved" in this pass is a false alarm; a moving one not flagged is a miss.
//   usage: npx tsx scripts/validate_detector.mts <fields.jsonl> <out.jsonl> [--data public/] [--par 4] [--cats dir]
//   fields: {id, kind: "mover" | "blank", ra, dec, pmra?, pmdec?}  (deg at 2016.0; arcsec/yr)
//   --cats: directory where the catalogue answers are kept, so a second run does not ask the services again
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as E from "../src/blink/engine.ts";
import { detectChanges, type ChangeRow, type FieldReport } from "../src/blink/detect.ts";
import { gaia, allwise, twomass } from "../src/blink/catalogs.ts";

const args = process.argv.slice(2), opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [inF, outF] = args, DATA = opt("--data", "public/").replace(/\/?$/, "/"), PAR = +opt("--par", "4"), CATS = opt("--cats", ""), N = 64, FOLDS = 3;
if (CATS) mkdirSync(CATS, { recursive: true });
const realFetch = globalThis.fetch, cache = new Map<string, string | null>();
globalThis.fetch = (async (u: any, init?: any) => { const url = String(u); if (!url.startsWith("local:/")) return realFetch(u, init);
  let body = cache.get(url); if (body === undefined) { body = await readFile(DATA + url.slice(7), "utf8").catch(() => null); if (cache.size > 300) cache.delete(cache.keys().next().value!); cache.set(url, body); }
  return body === null ? new Response("", { status: 404 }) : new Response(body, { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch;
E.setBase("local:/");
// the catalogue mirrors refuse bursts: one query at a time per field, and a patient wait before asking again
const retry = async <T,>(f: () => Promise<T>, n = 5): Promise<T | null> => { for (let k = 0; k < n; k++) { try { return await f(); } catch { await new Promise((r) => setTimeout(r, 2500 * 2 ** k * (0.7 + 0.6 * Math.random()))); } } return null; };
const r4 = (v: number) => +v.toFixed(4);
const clean = (r: ChangeRow) => !r.tags.some((x) => x === "SATURATED" || x === "BLENDED" || x === "EDGE");
/** the row of another run of the detector that is the same source on the image (detection does not depend on Gaia) */
const same = (rep: FieldReport, r: ChangeRow) => { let b: ChangeRow | null = null, bd = 1; for (const q of rep.rows) { if (!(q.snr > 0)) continue; const d = Math.hypot(q.x - r.x, q.y - r.y); if (d < bd) { bd = d; b = q; } } return b; };
const brief = (r: ChangeRow) => ({ tags: r.tags, snr: +r.snr.toFixed(0), pm: r.pm ? [r4(r.pm.ra), r4(r.pm.dec), r4(r.pm.tot / Math.max(r.pm.sig, 1e-9)), +r.pm.sig.toFixed(1), +r.pm.base.toFixed(1)] : null, gaia: !!r.gaia, linked: r.linked, w: !!r.wise, tm: !!r.tm });

async function one(c: any) {
  const t0 = Date.now(), t = { ra: c.ra, dec: c.dec, pmra: c.pmra, pmdec: c.pmdec, epoch: 2016.0 };
  const b = await E.build(t, { size: N, maxFrames: 60, concurrency: 6 });
  if (b.frames.length < 6) return { id: c.id, kind: c.kind, ok: 0, frames: b.frames.length };
  const R = ((N * E.PIX_ARCSEC) / 2) * 1.45, pm = Math.hypot(c.pmra ?? 0, c.pmdec ?? 0), cf = CATS ? `${CATS}/${c.id}.json` : "";
  let cat: { g: any[]; w: any[]; m: any[] | null } | null = cf && existsSync(cf) ? JSON.parse(readFileSync(cf, "utf8")) : null;
  if (!cat) {
    const g = await retry(() => gaia(b.center[0], b.center[1], R + pm * 12, 600)), w = g?.length ? await retry(() => allwise(b.center[0], b.center[1], R + pm * 18, 600)) : null;
    if (!g?.length || !w?.length) return { id: c.id, kind: c.kind, ok: 0, frames: b.frames.length, nocat: 1 };
    cat = { g, w, m: await retry(() => twomass(b.center[0], b.center[1], R + pm * 30, 600)) };
    if (cf) writeFileSync(cf, JSON.stringify(cat));
  }
  const { g, w } = cat, tm = (cat.m?.length ? cat.m : null) as any, mid = b.frames[b.frames.length >> 1], tgt: [number, number] = [mid.tx, mid.ty];
  const rep = detectChanges(b.frames, N, b.center, { gaia: g, wise: w, tm }, tgt, undefined);
  if (!rep) return { id: c.id, kind: c.kind, ok: 0, frames: b.frames.length, norep: 1 };
  const tr = rep.rows.find((r) => r.isTarget) ?? null;
  // stars Gaia says are (nearly) still, measured cleanly on a long baseline: any "moved" among them is a false alarm
  const still = rep.rows.filter((r) => clean(r) && r.gaia && r.gaia.plx !== null && Math.hypot(r.gaia.pmra, r.gaia.pmdec) < 0.04 && r.pm && r.pm.base > 5 && r.snr >= 12);
  const others = rep.rows.filter((r) => r !== tr || c.kind === "blank");
  // ---- blind pass
  const B = { n: 0, moved: 0, lost: 0, unjudged: 0, other: 0, mv: [] as number[][], dpm: [] as number[], t: null as any };
  const hide = c.kind === "mover" && tr?.gaia ? tr.gaia : null;
  for (let f = 0; f < FOLDS; f++) {
    const mine = still.filter((r, i) => i % FOLDS === f && r !== tr), drop = new Set<any>(mine.map((r) => r.gaia)); if (hide) drop.add(hide);
    if (!drop.size) continue;
    const rb = detectChanges(b.frames, N, b.center, { gaia: g.filter((s) => !drop.has(s)), wise: w, tm }, tgt, undefined);
    if (!rb) { B.lost += mine.length; continue; }
    for (const r of mine) { const q = same(rb, r); if (!q) { B.lost++; continue; } B.n++;
      if (!clean(q)) B.unjudged++; if (q.gaia) B.other++;
      if (q.pm && B.dpm.length < 60) B.dpm.push(r4(Math.hypot(q.pm.ra - r.gaia!.pmra, q.pm.dec - r.gaia!.pmdec)));
      if (q.tags.includes("MOVED")) { B.moved++; B.mv.push([r4(q.pm!.tot), +q.pm!.sig.toFixed(1), +q.pm!.base.toFixed(1), +q.snr.toFixed(0), q.gaia ? 1 : 0, q.linked ? 1 : 0]); } }
    if (f === 0 && hide) { const q = rb.rows.find((r) => r.isTarget) ?? same(rb, tr!); B.t = q ? brief(q) : { lost: 1 }; }
  }
  return { id: c.id, kind: c.kind, ok: 1, frames: b.frames.length, visits: b.visits, gpm: pm ? +pm.toFixed(3) : null, gp: pm ? [c.pmra, c.pmdec] : null, tmass: tm ? 1 : 0,
    t: tr ? brief(tr) : null, b: B,
    n: rep.counts.measured, ref: rep.cal.nRef, pmRms: rep.cal.pmRms ? r4(rep.cal.pmRms) : null, lim: rep.limits.pm ? +rep.limits.pm.toFixed(3) : null,
    still: still.length, stillMoved: still.filter((r) => r.tags.includes("MOVED")).length,
    dpm: still.slice(0, 40).map((r) => r4(Math.hypot(r.pm!.ra - r.gaia!.pmra, r.pm!.dec - r.gaia!.pmdec))),
    movedNoGaia: others.filter((r) => r.tags.includes("MOVED") && !(r.gaia && r.gaia.plx !== null)).length, movedGaia: others.filter((r) => r.tags.includes("MOVED") && r.gaia && r.gaia.plx !== null).length,
    noGaia: others.filter((r) => r.snr > 0 && !(r.gaia && r.gaia.plx !== null)).length,
    bright: others.filter((r) => r.tags.includes("BRIGHTER") || r.tags.includes("FAINTER")).length, variable: others.filter((r) => r.tags.includes("VARIABLE")).length, fresh: rep.counts.fresh, gone: rep.counts.gone, sec: +((Date.now() - t0) / 1000).toFixed(0) };
}
const done = new Set<string>();
if (existsSync(outF)) for (const l of readFileSync(outF, "utf8").split("\n")) { if (l) try { done.add(JSON.parse(l).id); } catch { /* */ } }
const todo = readFileSync(inF, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((c: any) => !done.has(c.id));
console.error(`${todo.length} fields to do`); let k = 0, fin = 0;
await Promise.all(Array.from({ length: PAR }, async () => { while (k < todo.length) { const c = todo[k++]; let r: any; try { r = await one(c); } catch (e) { r = { id: c.id, kind: c.kind, ok: 0, err: String((e as Error).message).slice(0, 100) }; }
  appendFileSync(outF, JSON.stringify(r) + "\n"); if (++fin % 20 === 0) console.error(fin, "/", todo.length); } }));
console.error("done");
