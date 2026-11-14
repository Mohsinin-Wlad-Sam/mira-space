// What is in this field? Sources detected in the deep stacks (blue: 0.75–2.4 µm, red: 3.8–5 µm), cross-matched with
// Gaia DR3 and AllWISE. The rows worth a second look are the ones the catalogues do not explain: seen only in the red,
// absent from Gaia, or moving fast.
import { clippedStats, stampToSky, type Frame } from "./engine";
import { robustStack } from "./imaging";
import { catPos, angSep, type CatSource } from "./catalogs";

export type FieldSource = { n: number; x: number; y: number; ra: number; dec: number; snrBlue: number; snrRed: number; gaia: CatSource | null; wise: CatSource | null; notes: string[]; isTarget: boolean };

function snrMap(frames: Frame[], N: number): Float32Array | null {
  if (frames.length < 3) return null;
  const st = robustStack(frames.map((f) => f.img), N * N), { med, sig } = clippedStats(st);
  if (!(sig > 0)) return null;
  for (let k = 0; k < st.length; k++) st[k] = (st[k] - med) / sig;
  return st;
}
function peaks(m: Float32Array, N: number, thr: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let j = 2; j < N - 2; j++) for (let i = 2; i < N - 2; i++) {
    const v = m[j * N + i]; if (!(v > thr)) continue;
    let top = true, s = 0, sx = 0, sy = 0;
    for (let b = -1; b <= 1 && top; b++) for (let a = -1; a <= 1; a++) { const q = m[(j + b) * N + i + a]; if (q > v) { top = false; break; } const w = Math.max(0, Number.isFinite(q) ? q : 0); s += w; sx += w * (i + a); sy += w * (j + b); }
    if (top && s > 0) out.push([sx / s, sy / s, v]);
  }
  return out;
}
const at = (m: Float32Array | null, N: number, x: number, y: number) => { if (!m) return NaN; let v = -Infinity; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const i = Math.round(x) + a, j = Math.round(y) + b; if (i >= 0 && j >= 0 && i < N && j < N && m[j * N + i] > v) v = m[j * N + i]; } return v; };

export function findSources(frames: Frame[], N: number, center: [number, number], cat: { gaia: CatSource[]; wise: CatSource[]; gaiaOk: boolean }, year: number, target: [number, number] | null): FieldSource[] {
  const blue = snrMap(frames.filter((f) => f.det <= 3), N), red = snrMap(frames.filter((f) => f.det >= 5), N), found: [number, number, number][] = [];
  for (const m of [blue, red]) if (m) for (const p of peaks(m, N, 5)) { const k = found.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1.8); if (k < 0) found.push(p); else if (p[2] > found[k][2]) found[k] = p; }
  found.sort((a, b) => b[2] - a[2]);
  return found.slice(0, 40).map(([x, y], n) => {
    const [ra, dec] = stampToSky(center[0], center[1], N, x, y), sb = at(blue, N, x, y), sr = at(red, N, x, y);
    let g: CatSource | null = null, gd = 6.5; for (const q of cat.gaia) { const [gr, gdec] = catPos(q, year), d = angSep(ra, dec, gr, gdec); if (d < gd) { gd = d; g = q; } }
    let w: CatSource | null = null, wd = 6.5; for (const q of cat.wise) { const d = angSep(ra, dec, q.ra, q.dec); if (d < wd) { wd = d; w = q; } }
    const notes: string[] = [], pm = g ? Math.hypot(g.pmra, g.pmdec) : 0, isTarget = !!target && Math.hypot(x - target[0], y - target[1]) < 1.8;
    if (sr >= 5 && !(sb >= 3)) notes.push("red only");
    if (!g && cat.gaiaOk) notes.push("not in Gaia");
    if (!w && cat.wise.length) notes.push("not in WISE 2010");
    if (pm >= 0.1) notes.push(`moves ${pm.toFixed(2)}″/yr`);
    if (w && w.mag != null && w.mag2 != null && w.mag2 - w.mag > 0.8) notes.push("red in WISE");
    return { n: n + 1, x, y, ra, dec, snrBlue: sb, snrRed: sr, gaia: g, wise: w, notes, isTarget };
  });
}
