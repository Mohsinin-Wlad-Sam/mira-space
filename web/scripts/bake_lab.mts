// Bake the small data files the Lab and the start screen need, with the same engine the browser uses, so they open
// instantly and never depend on the archive being reachable during a demonstration.
//   usage: npx tsx scripts/bake_lab.mts [base URL of a running MIRA, default http://127.0.0.1:5173/]
//   out:   public/lab/lab.json  (plates for the blink comparator, frames + spectrum for the spectroscope, centroids
//                               for the parallax ruler, measured detection limits)     public/lab/demo.json
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as E from "../src/blink/engine.ts";
import * as M from "../src/blink/measure.ts";
import { robustStack, shiftImage } from "../src/blink/imaging.ts";
import { CHALLENGE } from "../src/blink/catalogs.ts";

E.setBase(process.argv[2] ?? "http://127.0.0.1:5173/");
const out = (name: string) => fileURLToPath(new URL(`../public/lab/${name}`, import.meta.url));
const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
/** 8-bit picture: (value − sky) / noise, asinh-stretched between −2σ and `top`σ, as base64 */
function plate(img: Float32Array, top: number): string {
  const { med, sig } = E.clippedStats(img), b = Buffer.alloc(img.length);
  for (let k = 0; k < img.length; k++) { const v = (img[k] - med) / (sig || 1); b[k] = Number.isFinite(v) ? Math.round(255 * Math.min(1, Math.max(0, Math.asinh(((v + 2) / (top + 2)) * 10) / Math.asinh(10)))) : 0; }
  return b.toString("base64");
}
const crop = (img: Float32Array, N: number, cx: number, cy: number, n: number) => { const s = shiftImage(img, N, cx - (N - 1) / 2, cy - (N - 1) / 2), o = new Float32Array(n * n), a = (N - n) / 2; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) o[j * n + i] = s[(j + a) * N + i + a]; return o; };

const N = 32, lab: any = { built: new Date().toISOString().slice(0, 16) + "Z", n: N, blink: [] };
// ---- 1. blink comparator: first visit against last visit, pinned to the sky
for (const [key, dets, top, story] of [
  ["barnard", null, 400, "Barnard's Star, the fastest-moving star in the sky: six light-years away. Its centre is burnt out because it is too bright for the camera; NASA flags those pixels."],
  ["eps-indi-b", null, 120, "Epsilon Indi B: two brown dwarfs, too small to shine like stars, twelve light-years away."],
  ["wise-0855", [5, 6], 14, "WISE 0855, the coldest brown dwarf known: about −25 °C. It only shows in the reddest light SPHEREx sees, so these plates use detectors 5 and 6 alone."]] as const) {
  const t = CHALLENGE.find((c) => c.key === key)!, b = await E.build(t, { size: N, maxFrames: 144, concurrency: 8 });
  const fs = b.frames.filter((f) => !dets || (dets as readonly number[]).includes(f.det)), nv = b.visits, visits = Array.from({ length: nv }, (_, v) => fs.filter((f) => f.visit === v)).filter((L) => L.length >= 3);
  const A = visits[0], B = visits[visits.length - 1], mid = (L: E.Frame[]) => L.reduce((s, f) => s + f.mjd, 0) / L.length;
  const pos = (L: E.Frame[]) => [median(L.map((f) => f.tx)), median(L.map((f) => f.ty))];
  const pa = pos(A), pb = pos(B), shift = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) * E.PIX_ARCSEC;
  lab.blink.push({ key, name: t.name, story, a: plate(robustStack(A.map((f) => f.img), N * N), top), b: plate(robustStack(B.map((f) => f.img), N * N), top), dateA: E.mjdToDate(mid(A)).slice(0, 7), dateB: E.mjdToDate(mid(B)).slice(0, 7),
    posA: pa.map((v) => +v.toFixed(2)), posB: pb.map((v) => +v.toFixed(2)), shift: +shift.toFixed(1), months: Math.round((mid(B) - mid(A)) / 30.44), nA: A.length, nB: B.length, pm: +Math.hypot(t.pmra ?? 0, t.pmdec ?? 0).toFixed(2), ly: +(3261.56 / (t.plx ?? 1)).toFixed(1) });
  console.log(key, "plates", A.length, B.length, "shift", shift.toFixed(1), "arcsec");
  if (key === "eps-indi-b") {
    // ---- 2. spectroscope: every exposure cropped around the (moving) target, in wavelength order, plus the spectrum
    const n = 20, P = M.spectrum(b.frames, N, { dx: 0, dy: 0 }, true), ok = P.filter((p) => !p.flagged && Number.isFinite(p.flux));
    const fr = ok.map((p) => ({ p, f: b.frames[p.k] })).sort((x, y) => x.p.lam - y.p.lam);
    // one brightness scale for all frames, in units of each frame's noise, so the object visibly fades and returns
    lab.dial = { key, name: t.name, n, frames: fr.map(({ p, f }) => ({ lam: +p.lam.toFixed(4), det: f.det, flux: +p.flux.toFixed(3), err: +p.err.toFixed(3), date: f.dateObs.slice(0, 10), img: plate(crop(f.img, N, f.tx, f.ty, n), 60) })) };
    // a comparison star in the same frames: the brightest other source of the all-visit stack
    const st = robustStack(b.frames.map((f) => f.img), N * N), c0 = (N - 1) / 2; let best = -1, bx = 0, by = 0;
    for (let j = 4; j < N - 4; j++) for (let i = 4; i < N - 4; i++) { const v = st[j * N + i]; if (Number.isFinite(v) && v > best && Math.hypot(i - c0, j - c0) > 6) { best = v; bx = i; by = j; } }
    const S = M.spectrum(b.frames, N, { dx: bx - c0, dy: by - c0 }, false).filter((p) => !p.flagged && p.snr > 3);
    lab.dial.star = M.binSpectrum(S, 0.05).map((q) => ({ lam: +q.lam.toFixed(3), flux: +q.flux.toFixed(3) }));
    console.log("dial frames", lab.dial.frames.length, "comparison star points", lab.dial.star.length);
    // ---- 3. parallax ruler: centroids, with the steady motion already fitted
    const m = M.fitMotion(b.frames, N, b.center, { dx: 0, dy: 0 }, true)!;
    lab.parallax = { key, name: t.name, center: b.center, t0: m.t0, xi0: m.xi0, eta0: m.eta0, pmra: m.pmra, pmdec: m.pmdec, plx: m.plx, eplx: Math.hypot(m.eplx ?? 0, M.PLX_SYS), n: m.n,
      pts: m.pts.filter((q) => q.used).map((q) => ({ mjd: +q.mjd.toFixed(3), xi: +q.xi.toFixed(3), eta: +q.eta.toFixed(3), visit: q.visit })), lit_plx: (t.plx ?? 0) / 1000, lit_ly: +(3261.56 / (t.plx ?? 1)).toFixed(2) };
    console.log("parallax", m.plx?.toFixed(3), "±", lab.parallax.eplx.toFixed(3), "from", m.n, "exposures");
    // ---- start screen: the visits as a short loop
    writeFileSync(out("demo.json"), JSON.stringify({ n: N, plates: visits.map((L) => plate(robustStack(L.map((f) => f.img), N * N), 120)), dates: visits.map((L) => E.mjdToDate(mid(L)).slice(0, 7)),
      caption: `Real SPHEREx images of one patch of sky, ${E.mjdToDate(mid(A)).slice(0, 7)} to ${E.mjdToDate(mid(B)).slice(0, 7)}. The bright dot that creeps is <b>Epsilon Indi B</b>, a pair of brown dwarfs 12 light-years away.` }));
  }
}
writeFileSync(out("lab.json"), JSON.stringify(lab));
console.log("wrote lab.json", (JSON.stringify(lab).length / 1024).toFixed(0), "kB");
