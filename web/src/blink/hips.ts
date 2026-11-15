// PAST IMAGES — the same field as two earlier NASA surveys saw it: 2MASS (2.2 µm, 1997–2001) and WISE (4.6 µm,
// 2010–11). They are read from the HiPS copies served by NASA's infrared archive (IRSA): tiles on a HEALPix grid,
// fetched directly by the browser and resampled here onto the Lab's own pixel grid. With them the time bar shows
// real pictures over 27 years instead of only the SPHEREx visits. WISE comes as FITS (true pixel values); IRSA
// serves 2MASS as JPEG only (8-bit, logarithmic stretch), which is enough for a picture: every measurement of the
// past epochs is taken from the catalogues, not from these images.
import { stampToSky } from "./engine";

export type PastKey = "tm" | "wise";
export type Survey = { key: PastKey; name: string; band: string; yr: number; url: string; /** order used on the Lab's 6.15" grid */ order: number; /** deepest order the tiles exist at */ maxOrder: number; fmt: "fits" | "jpg" };
export const SURVEYS: Survey[] = [
  { key: "tm", name: "2MASS", band: "2.2 µm", yr: 1999.5, url: "https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/K", order: 7, maxOrder: 9, fmt: "jpg" },
  { key: "wise", name: "WISE", band: "4.6 µm", yr: 2010.5, url: "https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/W2", order: 7, maxOrder: 8, fmt: "fits" },
];
const D2R = Math.PI / 180, TILE = 512, TB = 9;

/** HEALPix face and pixel coordinates inside the face (nested scheme), for nside a power of two */
export function hpxFaceXY(nside: number, ra: number, dec: number): [number, number, number] {
  const z = Math.sin(dec * D2R), phi = (((ra % 360) + 360) % 360) * D2R, za = Math.abs(z), tt = (phi / (Math.PI / 2)) % 4;
  if (za <= 2 / 3) {
    const t1 = nside * (0.5 + tt), t2 = nside * (z * 0.75), jp = Math.floor(t1 - t2), jm = Math.floor(t1 + t2);
    const ifp = Math.floor(jp / nside), ifm = Math.floor(jm / nside);
    return [ifp === ifm ? ifp | 4 : ifp < ifm ? ifp : ifm + 8, jm & (nside - 1), nside - (jp & (nside - 1)) - 1];
  }
  const ntt = Math.min(3, Math.floor(tt)), tp = tt - ntt, tmp = nside * Math.sqrt(3 * (1 - za));
  const jp = Math.min(Math.floor(tp * tmp), nside - 1), jm = Math.min(Math.floor((1 - tp) * tmp), nside - 1);
  return z >= 0 ? [ntt, nside - jm - 1, nside - jp - 1] : [ntt + 8, jp, jm];
}
const interleave = (x: number, y: number, bits: number) => { let v = 0; for (let b = 0; b < bits; b++) v += (((x >> b) & 1) + 2 * ((y >> b) & 1)) * 4 ** b; return v; };

/** a FITS image (first HDU): header cards, then big-endian pixels */
export function parseFitsImage(buf: ArrayBuffer): { w: number; h: number; data: Float32Array } | null {
  const u8 = new Uint8Array(buf), card: Record<string, string> = {}; let off = 0, end = false;
  while (!end && off + 2880 <= u8.length) {
    for (let c = 0; c < 36; c++) { let s = ""; for (let k = 0; k < 80; k++) s += String.fromCharCode(u8[off + c * 80 + k]);
      const key = s.slice(0, 8).trim(); if (key === "END") { end = true; break; } if (s[8] === "=") card[key] = s.slice(10).split("/")[0].trim(); }
    off += 2880;
  }
  const bitpix = +card.BITPIX, w = +card.NAXIS1, h = +card.NAXIS2, n = w * h, bs = card.BSCALE !== undefined ? +card.BSCALE : 1, bz = card.BZERO !== undefined ? +card.BZERO : 0, blank = card.BLANK !== undefined ? +card.BLANK : null;
  if (!end || !(n > 0) || off + (n * Math.abs(bitpix)) / 8 > u8.length) return null;
  const dv = new DataView(buf, off), out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const v = bitpix === -32 ? dv.getFloat32(k * 4) : bitpix === -64 ? dv.getFloat64(k * 8) : bitpix === 16 ? dv.getInt16(k * 2) : bitpix === 32 ? dv.getInt32(k * 4) : bitpix === 8 ? dv.getUint8(k) : NaN;
    out[k] = bitpix > 0 && blank !== null && v === blank ? NaN : v * bs + bz;
  }
  return { w, h, data: out };
}
/** a JPEG tile, rows from the top (browser only). The archive made these with a logarithmic stretch; undoing it
 *  (approximately: the exact constants are not published with the tiles) gives back intensities in which stars stand
 *  far above the sky noise, as in the other pictures */
async function jpegTile(blob: Blob): Promise<Float32Array | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  const bmp = await createImageBitmap(blob); if (bmp.width !== TILE || bmp.height !== TILE) return null;
  const cv = document.createElement("canvas"); cv.width = cv.height = TILE; const g = cv.getContext("2d", { willReadFrequently: true })!; g.drawImage(bmp, 0, 0);
  const px = g.getImageData(0, 0, TILE, TILE).data, out = new Float32Array(TILE * TILE); for (let k = 0; k < out.length; k++) out[k] = Math.pow(1001, px[k * 4] / 255) - 1;
  return out;
}
const tiles = new Map<string, Promise<Float32Array | null>>();
function tile(s: Survey, order: number, npix: number): Promise<Float32Array | null> {
  const url = `${s.url}/Norder${order}/Dir${Math.floor(npix / 10000) * 10000}/Npix${npix}.${s.fmt}`;
  let p = tiles.get(url);
  if (!p) {
    // a tile is shared by every picture that needs it: it is not cancelled when one of them goes away, and only a tile
    // the archive says does not exist (404) is remembered as missing
    p = (async () => { const ac = new AbortController(), h = setTimeout(() => ac.abort(), 30000);
      try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) { if (r.status !== 404) tiles.delete(url); return null; }
        if (s.fmt === "jpg") return await jpegTile(await r.blob());
        const f = parseFitsImage(await r.arrayBuffer()); return f && f.w === TILE && f.h === TILE ? f.data : null; }
      catch { tiles.delete(url); return null; } finally { clearTimeout(h); } })();
    tiles.set(url, p); if (tiles.size > 24) tiles.delete(tiles.keys().next().value!);
  }
  return p;
}
/** Where the HEALPix pixel (x, y) of a tile's cell sits in the tile's array. In a FITS tile: column y, row 511 − x
 *  (FITS stores rows from the bottom). A JPEG tile is the same picture with rows from the top: column y, row x.
 *  Established against catalogue star positions (scripts/test_hips.mts); `orient` exists for that test. */
export const ORIENT: Record<Survey["fmt"], number> = { fits: 6, jpg: 4 };
const cell = (x: number, y: number, o: number) => { const [a, b] = o & 4 ? [y, x] : [x, y], col = o & 1 ? TILE - 1 - a : a, row = o & 2 ? TILE - 1 - b : b; return row * TILE + col; };

/** sample a survey on any N x N grid: `toSky(i, j)` gives the sky position of a (fractional) pixel. Each output pixel
 *  is the mean of 2 x 2 samples a quarter of a pixel off its centre. */
async function sample(s: Survey, order: number, N: number, toSky: (i: number, j: number) => [number, number], signal?: AbortSignal, orient = ORIENT[s.fmt]): Promise<Float32Array | null> {
  const nside = 2 ** (order + TB), SUB = [-0.25, 0.25], n4 = N * N * 4, tn = new Int32Array(n4), tp = new Int32Array(n4), want = new Set<number>(); let q = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) for (const dj of SUB) for (const di of SUB) {
    const [ra, dec] = toSky(i + di, j + dj), [face, ix, iy] = hpxFaceXY(nside, ra, dec);
    tn[q] = face * 4 ** order + interleave(ix >> TB, iy >> TB, order); tp[q] = cell(ix & (TILE - 1), iy & (TILE - 1), orient); want.add(tn[q]); q++;
  }
  if (want.size > 9) return null;
  const got = new Map<number, Float32Array | null>(); await Promise.all([...want].map(async (t) => got.set(t, await tile(s, order, t)))); if (signal?.aborted) return null;
  if (![...got.values()].some(Boolean)) return null;
  const out = new Float32Array(N * N); let ok = 0;
  for (let k = 0; k < N * N; k++) { let sum = 0, m = 0; for (let u = 0; u < 4; u++) { const d = got.get(tn[k * 4 + u]), v = d ? d[tp[k * 4 + u]] : NaN; if (Number.isFinite(v)) { sum += v; m++; } } out[k] = m ? sum / m : NaN; if (m) ok++; }
  return ok > 0.5 * N * N ? out : null;
}
/** a light 3 x 3 smoothing (weights 1 2 1) */
function smooth3(img: Float32Array, N: number): Float32Array {
  const sm = new Float32Array(N * N), W = [1, 2, 1];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let sum = 0, w = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const x = i + a, y = j + b; if (x < 0 || y < 0 || x >= N || y >= N) continue; const v = img[y * N + x]; if (Number.isFinite(v)) { sum += v * W[a + 1] * W[b + 1]; w += W[a + 1] * W[b + 1]; } }
    sm[j * N + i] = w ? sum / w : NaN; }
  return sm;
}
/** the survey's picture of the field, on the Lab's stamp grid (N x N, 6.15" pixels, north up, east left); null if it cannot be read */
export async function pastImage(s: Survey, ra0: number, dec0: number, N: number, signal?: AbortSignal, orient = ORIENT[s.fmt]): Promise<Float32Array | null> {
  const out = await sample(s, s.order, N, (i, j) => stampToSky(ra0, dec0, N, i, j), signal, orient);
  // 2MASS stars are sharper (2.5") than a 6" pixel and its tiles are 8-bit: a light smoothing brings the picture to the
  // resolution of the WISE and SPHEREx ones, so that the three epochs can be compared by eye
  return out && s.fmt === "jpg" ? smooth3(out, N) : out;
}
/** A cutout at the survey's own sharpness: N x N pixels of `pix` arcsec centred on (ra0, dec0), north up, east left.
 *  Used where a slow mover has to be seen shifting by a few arcseconds (the map's object card). */
export async function pastCutout(s: Survey, ra0: number, dec0: number, N: number, pix: number, signal?: AbortSignal): Promise<Float32Array | null> {
  const order = Math.max(3, Math.min(s.maxOrder, Math.ceil(9 - Math.log2(pix / 0.8052)))), c = (N - 1) / 2, D = Math.PI / 180, d0 = dec0 * D, sc = pix / 3600 * D;
  const toSky = (i: number, j: number): [number, number] => { const x = -(i - c) * sc, y = -(j - c) * sc, den = Math.cos(d0) - y * Math.sin(d0);
    return [ra0 + Math.atan2(x, den) / D, Math.atan2(Math.sin(d0) + y * Math.cos(d0), Math.hypot(x, den)) / D]; };
  const out = await sample(s, order, N, toSky, signal);
  return out && s.fmt === "jpg" ? smooth3(out, N) : out;      // the 8-bit 2MASS tiles are always smoothed a little (0.7 pixel): it removes their block noise
}
