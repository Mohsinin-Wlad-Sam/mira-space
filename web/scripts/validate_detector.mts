// How often is the field detector right? Known moving stars (Gaia) and empty high-latitude fields through the same
// code as the Lab: recovery of the known motions, and false alarms among stars Gaia says do not move.
//   usage: npx tsx scripts/validate_detector.mts <fields.jsonl> <out.jsonl> [--data public/] [--par 4]
//   fields: {id, kind: "mover" | "blank", ra, dec, pmra?, pmdec?}  (deg at 2016.0; arcsec/yr)
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as E from "../src/blink/engine.ts";
import { detectChanges } from "../src/blink/detect.ts";
import { gaia, allwise, twomass } from "../src/blink/catalogs.ts";

const args = process.argv.slice(2), opt = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [inF, outF] = args, DATA = opt("--data", "public/").replace(/\/?$/, "/"), PAR = +opt("--par", "4"), N = 64;
const realFetch = globalThis.fetch, cache = new Map<string, string | null>();
globalThis.fetch = (async (u: any, init?: any) => { const url = String(u); if (!url.startsWith("local:/")) return realFetch(u, init);
  let body = cache.get(url); if (body === undefined) { body = await readFile(DATA + url.slice(7), "utf8").catch(() => null); if (cache.size > 300) cache.delete(cache.keys().next().value!); cache.set(url, body); }
  return body === null ? new Response("", { status: 404 }) : new Response(body, { status: 200, headers: { "content-type": "application/json" } }); }) as typeof fetch;
E.setBase("local:/");
const retry = async <T,>(f: () => Promise<T>, n = 3): Promise<T | null> => { for (let k = 0; k < n; k++) { try { return await f(); } catch { await new Promise((r) => setTimeout(r, 2000 * (k + 1))); } } return null; };
async function one(c: any) {
  const t0 = Date.now(), t = { ra: c.ra, dec: c.dec, pmra: c.pmra, pmdec: c.pmdec, epoch: 2016.0 };
  const b = await E.build(t, { size: N, maxFrames: 60, concurrency: 6 });
  if (b.frames.length < 6) return { id: c.id, kind: c.kind, ok: 0, frames: b.frames.length };
  const R = ((N * E.PIX_ARCSEC) / 2) * 1.45, pm = Math.hypot(c.pmra ?? 0, c.pmdec ?? 0);
  const [g, w, m] = await Promise.all([retry(() => gaia(b.center[0], b.center[1], R + pm * 12, 600)), retry(() => allwise(b.center[0], b.center[1], R + pm * 18, 600)), retry(() => twomass(b.center[0], b.center[1], R + pm * 30, 600))]);
  if (!g?.length || !w?.length) return { id: c.id, kind: c.kind, ok: 0, frames: b.frames.length, nocat: 1 };
  const mid = b.frames[b.frames.length >> 1], rep = detectChanges(b.frames, N, b.center, { gaia: g, wise: w, tm: (m?.length ? m : null) as any }, [mid.tx, mid.ty], undefined);
  if (!rep) return { id: c.id, kind: c.kind, ok: 0, frames: b.frames.length, norep: 1 };
  const clean = (r: any) => !r.tags.some((x: string) => x === "SATURATED" || x === "BLENDED" || x === "EDGE");
  const tr = rep.rows.find((r) => r.isTarget) ?? null;
  // stars Gaia says are (nearly) still, measured cleanly on a long baseline: any "moved" among them is a false alarm
  const still = rep.rows.filter((r) => clean(r) && r.gaia && r.gaia.plx !== null && Math.hypot(r.gaia.pmra, r.gaia.pmdec) < 0.04 && r.pm && r.pm.base > 5 && r.snr >= 12);
  const others = rep.rows.filter((r) => r !== tr || c.kind === "blank");
  return { id: c.id, kind: c.kind, ok: 1, frames: b.frames.length, visits: b.visits, gpm: pm ? +pm.toFixed(3) : null,
    t: tr ? { tags: tr.tags, snr: +tr.snr.toFixed(0), pm: tr.pm ? [+tr.pm.ra.toFixed(4), +tr.pm.dec.toFixed(4), +Math.hypot(tr.pm.etot, rep.cal.pmRms ?? 0.03).toFixed(4), +tr.pm.sig.toFixed(1), +tr.pm.base.toFixed(1)] : null, gaia: !!tr.gaia } : null,
    n: rep.counts.measured, ref: rep.cal.nRef, pmRms: rep.cal.pmRms ? +rep.cal.pmRms.toFixed(4) : null, lim: rep.limits.pm ? +rep.limits.pm.toFixed(3) : null,
    still: still.length, stillMoved: still.filter((r) => r.tags.includes("MOVED")).length,
    dpm: still.slice(0, 40).map((r) => +Math.hypot(r.pm!.ra - r.gaia!.pmra, r.pm!.dec - r.gaia!.pmdec).toFixed(4)),
    movedNoGaia: others.filter((r) => r.tags.includes("MOVED") && !(r.gaia && r.gaia.plx !== null)).length, movedGaia: others.filter((r) => r.tags.includes("MOVED") && r.gaia && r.gaia.plx !== null).length,
    bright: others.filter((r) => r.tags.includes("BRIGHTER") || r.tags.includes("FAINTER")).length, variable: others.filter((r) => r.tags.includes("VARIABLE")).length, fresh: rep.counts.fresh, gone: rep.counts.gone, sec: +((Date.now() - t0) / 1000).toFixed(0) };
}
const done = new Set<string>();
if (existsSync(outF)) for (const l of readFileSync(outF, "utf8").split("\n")) { if (l) try { done.add(JSON.parse(l).id); } catch { /* */ } }
const todo = readFileSync(inF, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((c: any) => !done.has(c.id));
console.error(`${todo.length} fields to do`); let k = 0, fin = 0;
await Promise.all(Array.from({ length: PAR }, async () => { while (k < todo.length) { const c = todo[k++]; let r: any; try { r = await one(c); } catch (e) { r = { id: c.id, kind: c.kind, ok: 0, err: String((e as Error).message).slice(0, 100) }; }
  appendFileSync(outF, JSON.stringify(r) + "\n"); if (++fin % 20 === 0) console.error(fin, "/", todo.length); } }));
console.error("done");
