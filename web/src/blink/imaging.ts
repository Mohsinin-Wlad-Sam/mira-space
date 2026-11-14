// Small image operations shared by the Observe view, the Lab bake script and the Logbook.

/** robust display levels: black point just under the sky, white point at the given percentile */
export function levels(img: Float32Array, pct: number): [number, number] {
  const v: number[] = [], step = Math.max(1, Math.floor(img.length / 4096));
  for (let k = 0; k < img.length; k += step) if (Number.isFinite(img[k])) v.push(img[k]);
  if (v.length < 8) return [0, 1];
  v.sort((a, b) => a - b);
  const med = v[v.length >> 1], sig = Math.max(med - v[Math.floor(v.length * 0.16)], 1e-6), hi = v[Math.min(v.length - 1, Math.floor((v.length * pct) / 100))];
  return [med - 1.5 * sig, Math.max(hi, med + 6 * sig)];
}
/** bilinear shift: output pixel (i, j) takes the value at (i + sx, j + sy) of the source */
export function shiftImage(src: Float32Array, N: number, sx: number, sy: number): Float32Array {
  const out = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i + sx, y = j + sy, i0 = Math.floor(x), j0 = Math.floor(y);
    if (i0 < 0 || j0 < 0 || i0 >= N - 1 || j0 >= N - 1) { out[j * N + i] = NaN; continue; }
    const u = x - i0, v = y - j0, q = j0 * N + i0;
    out[j * N + i] = src[q] * (1 - u) * (1 - v) + src[q + 1] * u * (1 - v) + src[q + N] * (1 - u) * v + src[q + N + 1] * u * v;
  }
  return out;
}
/** robust co-add: per pixel, the brightest values are discarded before averaging (20% with 5+ images, the single
 *  maximum with 3–4), so a cosmic ray, ghost or passing asteroid in one exposure does not print through the stack */
export function robustStack(imgs: Float32Array[], npix: number): Float32Array {
  const out = new Float32Array(npix), n = imgs.length, v = new Float64Array(Math.max(1, n));
  for (let k = 0; k < npix; k++) {
    let m = 0; for (let q = 0; q < n; q++) { const x = imgs[q][k]; if (Number.isFinite(x)) v[m++] = x; }
    if (!m) { out[k] = NaN; continue; }
    const a = v.subarray(0, m).sort(), hi = m >= 5 ? m - Math.ceil(m * 0.2) : m >= 3 ? m - 1 : m, lo = m >= 10 ? Math.floor(m * 0.1) : 0;
    let sum = 0; for (let q = lo; q < hi; q++) sum += a[q];
    out[k] = sum / (hi - lo);
  }
  return out;
}
export const asinhT = (v: number, lo: number, hi: number) => Math.asinh((Math.max(0, v - lo) / Math.max(hi - lo, 1e-9)) * 10) / Math.asinh(10);
