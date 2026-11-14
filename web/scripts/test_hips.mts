// The past images (2MASS, WISE from IRSA's HiPS tiles) against catalogue star positions: which tile orientation puts
// the stars where the catalogues say they are, and how well. usage: npx tsx scripts/test_hips.mts [ra dec] [N]
import * as E from "../src/blink/engine.ts";
import { SURVEYS, pastImage } from "../src/blink/hips.ts";
import { allwise, twomass } from "../src/blink/catalogs.ts";
const a = process.argv.slice(2), fields: [number, number][] = a.length >= 2 ? [[+a[0], +a[1]]] : [[150.1, 2.2], [217.650336, 59.724274], [330.84, -56.79], [84.0, -72.0], [10.0, 41.7]];
const N = +(a[2] ?? 64);
for (const [ra, dec] of fields) {
  const R = (N * E.PIX_ARCSEC) / 2;
  const cats = { tm: await twomass(ra, dec, R, 60).catch(() => null), wise: await allwise(ra, dec, R, 60).catch(() => null) } as Record<string, any[] | null>;
  for (const s of SURVEYS.filter((q) => q.fmt === "fits")) {      // JPEG tiles need a browser to decode: tested in the page
    const stars = (cats[s.key] ?? []).slice(0, 25).map((c) => E.skyToStamp(ra, dec, N, c.ra, c.dec)).filter(([x, y]) => x > 3 && y > 3 && x < N - 4 && y < N - 4);
    const res: string[] = [];
    for (let o = 0; o < 8; o++) {
      const t0 = Date.now(), img = await pastImage(s, ra, dec, N, undefined, o); if (!img) { res.push(`o${o}: no image`); continue; }
      const v = [...img].filter(Number.isFinite).sort((p, q) => p - q), med = v[v.length >> 1], sig = med - v[Math.floor(v.length * 0.16)] || 1;
      // signal at the catalogue positions, and how far the local peak is from each
      let sum = 0, off = 0, n = 0;
      for (const [x, y] of stars) { const i = Math.round(x), j = Math.round(y); sum += (img[j * N + i] - med) / sig; let b = -Infinity, bi = 0, bj = 0; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const w = img[(j + dj) * N + i + di]; if (w > b) { b = w; bi = di; bj = dj; } } off += Math.hypot(bi + i - x, bj + j - y); n++; }
      res.push(`o${o}: ${(sum / Math.max(n, 1)).toFixed(1)}σ at stars, peak offset ${(off / Math.max(n, 1)).toFixed(2)} px (${Date.now() - t0} ms)`);
    }
    console.log(`${ra.toFixed(3)} ${dec >= 0 ? "+" : ""}${dec.toFixed(3)}  ${s.name}  ${stars.length} stars\n   ${res.join("\n   ")}`);
  }
}
