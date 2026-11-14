// Field change detector on known fields: prints what it finds. usage: npx tsx scripts/test_detect.mts [key ...]
import * as E from "../src/blink/engine.ts";
import { detectChanges } from "../src/blink/detect.ts";
import { gaia, allwise, twomass, CHALLENGE } from "../src/blink/catalogs.ts";
E.setBase(process.env.BASE ?? "http://127.0.0.1:5173/");
const extra: any[] = [
  { key: "luhman16", name: "Luhman 16", ra: 162.328814, dec: -53.319466, pmra: -2.754, pmdec: 0.358, epoch: 2000 },
  { key: "cand1", name: "candidate 6661-325678", ra: 162.880127, dec: -14.671423, pmra: -0.3541, pmdec: 0.0156, epoch: 2016.41 },
  { key: "blank", name: "blank field", ra: 150.1, dec: 2.2 },
];
const want = process.argv.slice(2), list = [...CHALLENGE, ...extra].filter((t: any) => !want.length || want.includes(t.key));
const N = +(process.env.N ?? 64), MAXF = +(process.env.F ?? 72);
for (const t of list as any[]) {
  const t0 = Date.now(), b = await E.build(t, { size: N, maxFrames: MAXF, concurrency: 8 });
  const R = (N * E.PIX_ARCSEC) / 2 * 1.5 + 30;
  const [g, w, m] = await Promise.all([gaia(b.center[0], b.center[1], R, 600).catch(() => null), allwise(b.center[0], b.center[1], R + 160, 600).catch(() => null), twomass(b.center[0], b.center[1], R + 200, 600).catch(() => null)]);
  const masks = process.env.MASKS ? await Promise.all(b.frames.map((f) => E.readMask(f, N).catch(() => null))) : undefined;
  const tgt = b.frames.length ? [b.frames[b.frames.length >> 1].tx, b.frames[b.frames.length >> 1].ty] as [number, number] : null;
  const t1 = Date.now(), rep = detectChanges(b.frames, N, b.center, { gaia: g, wise: w, tm: m as any }, tgt, masks as any);
  console.log(`\n=== ${t.name}  frames ${b.frames.length}  visits ${b.visits}  cats G${g?.length} W${w?.length} 2M${m?.length}  build ${((t1 - t0) / 1000).toFixed(0)} s  detect ${Date.now() - t1} ms`);
  if (!rep) { console.log("no report"); continue; }
  console.log("cal:", JSON.stringify({ nRef: rep.cal.nRef, astroRms: rep.cal.astroRms?.toFixed(2), pmRms: rep.cal.pmRms?.toFixed(3), zp: Object.fromEntries(Object.entries(rep.cal.zp).map(([k, v]) => [k, `${v.zp.toFixed(2)}±${v.sc.toFixed(2)} n${v.n}`])) }), "counts:", JSON.stringify(rep.counts), "pos:", rep.cal.posA.toFixed(2), rep.cal.posB.toFixed(1), "limits:", rep.limits.pm?.toFixed(3), rep.limits.w1?.toFixed(3), rep.limits.w2?.toFixed(3), "visits", rep.visits.map((v) => v.yr.toFixed(2) + ":" + v.n).join(" "));
  for (const r of rep.rows.slice(0, +(process.env.ROWS ?? 14))) {
    const pm = r.pm ? `${r.pm.ra.toFixed(3)},${r.pm.dec.toFixed(3)} ±${r.pm.etot.toFixed(3)} (${r.pm.sig.toFixed(1)}σ, ${r.pm.base.toFixed(1)}yr, ${r.pm.using})` : "–";
    const d = (x: any) => (x ? `${x.ratio.toFixed(2)}(${x.z.toFixed(1)}σ)` : "–");
    console.log(`#${String(r.n).padStart(2)} ${r.isTarget ? "T" : " "} snr ${r.snr.toFixed(0).padStart(4)} ${r.tags.join(",").padEnd(18)} pm ${pm} | gaia ${r.gaia ? `${r.gaia.pmra.toFixed(3)},${r.gaia.pmdec.toFixed(3)} G${r.gaia.mag?.toFixed(1)}` : "–"} | dW1 ${d(r.dW1)} dW2 ${d(r.dW2)} dK ${d(r.dK)} | lc ${r.lc ? (r.lc.variable ? "VAR " : "") + r.lc.amp.toFixed(2) : "–"} | ${r.known} ${r.why}${r.linked ? " (linked)" : ""}${r.track ? " [track]" : ""}`);
  }
  if (rep.gone.length) console.log("gone:", rep.gone.slice(0, 6).map((q) => `${q.wise.id} W1 ${q.w1?.toFixed(2)} W2 ${q.w2?.toFixed(2)}`).join("; "));
}
