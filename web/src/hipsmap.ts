// REAL TILES UNDER THE SKY MAP. The whole-sky panoramas are about 5 arcminutes per pixel: fine for the whole sky,
// too coarse once the map is zoomed in, where a marker would then sit beside a blur instead of on its star. From a
// certain zoom on, the map therefore draws the surveys' own tiles (HiPS, on the HEALPix grid) read straight from
// NASA's infrared archive: 2MASS for 1999, WISE for 2010, and SPHEREx's all-sky cube for today (three of its 102
// wavelengths as blue, green and red). Tiles are placed by their own sky coordinates, so picture and markers agree
// to a fraction of a tile pixel (0.8" for 2MASS, 1.6" for WISE, 13" for SPHEREx).
import { hpxFaceXY } from "./blink/hips";

const IRSA = "https://irsa.ipac.caltech.edu/data/hips";
export type TileSet = { key: string; url: string; ext: string; max: number; frames?: number[] };
export const TILESETS: Record<"tm" | "wise" | "sx", TileSet> = {
  tm: { key: "tm", url: `${IRSA}/CDS/2MASS/Color`, ext: "jpg", max: 9 },
  wise: { key: "wise", url: `${IRSA}/CDS/AllWISE/RGB-W4-W2-W1`, ext: "jpg", max: 8 },
  sx: { key: "sx", url: `${IRSA}/SPHEREx/spherex_allsky_cube`, ext: "png", max: 5, frames: [16, 46, 85] },      // 1.10, 2.19 and 4.44 µm
};
const JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4], JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7], R2D = 180 / Math.PI;
/** sky position (degrees) of the point (x, y) of a HEALPix base face, x and y from 0 to 1 */
export function faceToSky(face: number, x: number, y: number): [number, number] {
  const jr = JRLL[face] - x - y; let nr: number, z: number;
  if (jr < 1) { nr = jr; z = 1 - (nr * nr) / 3; } else if (jr > 3) { nr = 4 - jr; z = (nr * nr) / 3 - 1; } else { nr = 1; z = ((2 - jr) * 2) / 3; }
  let t = JPLL[face] * nr + x - y; if (t < 0) t += 8; if (t >= 8) t -= 8;
  return [nr < 1e-12 ? 0 : ((Math.PI / 4) * t) / nr * R2D, Math.asin(Math.max(-1, Math.min(1, z))) * R2D];
}
const spread = (v: number, bits: number) => { let o = 0; for (let b = 0; b < bits; b++) o += ((v >> b) & 1) * 4 ** b; return o; };
const unspread = (v: number, bits: number) => { let o = 0; for (let b = 0; b < bits; b++) o += (Math.floor(v / 4 ** b) & 1) << b; return o; };

type Tile = { img: CanvasImageSource | null; state: "loading" | "ok" | "none"; used: number };
const cache = new Map<string, Tile>(); let active = 0, tick = 0; const queue: (() => void)[] = [];
const pump = () => { while (active < 6 && queue.length) { active++; queue.shift()!(); } };
function loadImage(url: string): Promise<HTMLImageElement | null> { return new Promise((res) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = () => res(null); im.src = url; }); }
function request(set: TileSet, order: number, t: number, done: () => void): Tile {
  const key = `${set.key}/${order}/${t}`; let T = cache.get(key); if (T) { T.used = ++tick; return T; }
  T = { img: null, state: "loading", used: ++tick }; cache.set(key, T); const me = T, base = `${set.url}/Norder${order}/Dir${Math.floor(t / 10000) * 10000}/Npix${t}`;
  queue.push(async () => {
    try {
      if (!set.frames) { const im = await loadImage(`${base}.${set.ext}`); me.img = im; me.state = im ? "ok" : "none"; }
      else {      // three wavelengths of the SPHEREx cube into one colour picture: 1.1 µm blue, 2.2 µm green, 4.4 µm red
        const ims = await Promise.all(set.frames.map((k) => loadImage(`${base}${k ? "_" + k : ""}.${set.ext}`)));
        if (ims.some((q) => !q)) me.state = "none";
        else { const W = ims[0]!.width, c = document.createElement("canvas"); c.width = c.height = W; const g = c.getContext("2d", { willReadFrequently: true })!, ch: Uint8ClampedArray[] = [];
          for (const im of ims) { g.drawImage(im!, 0, 0); ch.push(g.getImageData(0, 0, W, W).data.slice()); }
          const id = g.createImageData(W, W), d = id.data, lut = (gain: number) => Uint8ClampedArray.from({ length: 256 }, (_, v) => 255 * (1 - Math.exp(-(v * gain) / 70))), LB = lut(1.5), LG = lut(1.7), LR = lut(2.1);
          for (let q = 0; q < W * W; q++) { d[q * 4] = LR[ch[2][q * 4]]; d[q * 4 + 1] = LG[ch[1][q * 4]]; d[q * 4 + 2] = LB[ch[0][q * 4]]; d[q * 4 + 3] = 255; }
          g.putImageData(id, 0, 0); me.img = c; me.state = "ok"; }
      }
    } catch { me.state = "none"; }
    active--; pump(); done();
  });
  pump();
  if (cache.size > 140) { const old = [...cache.entries()].filter(([, v]) => v.state !== "loading").sort((a, b) => a[1].used - b[1].used).slice(0, 40); old.forEach(([k]) => cache.delete(k)); }
  return T;
}
/** one textured triangle: the part of the tile between three of its points, laid on the three screen points */
function tri(g: CanvasRenderingContext2D, img: CanvasImageSource, s: number[], d: number[]) {
  const [x0, y0, x1, y1, x2, y2] = d, [u0, v0, u1, v1, u2, v2] = s, den = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1); if (Math.abs(den) < 1e-9) return;
  const a = (x0 * (v1 - v2) + x1 * (v2 - v0) + x2 * (v0 - v1)) / den, c = (x0 * (u2 - u1) + x1 * (u0 - u2) + x2 * (u1 - u0)) / den, e = (x0 * (u1 * v2 - u2 * v1) + x1 * (u2 * v0 - u0 * v2) + x2 * (u0 * v1 - u1 * v0)) / den;
  const b = (y0 * (v1 - v2) + y1 * (v2 - v0) + y2 * (v0 - v1)) / den, f = (y0 * (u2 - u1) + y1 * (u0 - u2) + y2 * (u1 - u0)) / den, h = (y0 * (u1 * v2 - u2 * v1) + y1 * (u2 * v0 - u0 * v2) + y2 * (u0 * v1 - u1 * v0)) / den;
  const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3, gw = (x: number, y: number): [number, number] => { const dx = x - cx, dy = y - cy, L = Math.hypot(dx, dy) || 1; return [x + (dx / L) * 0.8, y + (dy / L) * 0.8]; };      // a hair wider, so that no seam shows
  g.save(); g.beginPath(); g.moveTo(...gw(x0, y0)); g.lineTo(...gw(x1, y1)); g.lineTo(...gw(x2, y2)); g.closePath(); g.clip(); g.transform(a, b, c, f, e, h); g.drawImage(img, 0, 0); g.restore();
}
export type MapView = { cw: number; ch: number; /** pixels per degree */ scale: number; /** screen point -> ICRS, null off the sphere */ toSky: (x: number, y: number) => [number, number] | null; /** ICRS -> screen */ toScreen: (ra: number, dec: number) => [number, number] };

/** draw the survey's tiles over what is in view; returns how many of the tiles needed are in */
export function drawTiles(g: CanvasRenderingContext2D, set: TileSet, v: MapView, alpha: number, onLoad: () => void): { need: number; have: number; order: number } {
  const order = Math.max(1, Math.min(set.max, Math.floor(Math.log2(Math.max(1, (v.scale * 58.6) / 640))))), N = 2 ** order, side = (v.scale * 58.6) / N, step = Math.max(24, Math.min(96, side / 2.5)), want = new Set<number>();
  for (let y = 0; y <= v.ch + step; y += step) for (let x = 0; x <= v.cw + step; x += step) { const p = v.toSky(Math.min(x, v.cw), Math.min(y, v.ch)); if (!p) continue; const [face, ix, iy] = hpxFaceXY(N, p[0], p[1]); want.add(face * 4 ** order + spread(ix, order) + 2 * spread(iy, order)); }
  if (want.size > 90) return { need: want.size, have: 0, order };
  let have = 0; const n = order <= 2 ? 12 : order <= 3 ? 8 : order <= 4 ? 6 : order <= 6 ? 4 : 3; g.globalAlpha = alpha; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  for (const t of want) {
    const T = request(set, order, t, onLoad); if (T.state !== "ok" || !T.img) continue; have++;
    const face = Math.floor(t / 4 ** order), rem = t % 4 ** order, tx = unspread(rem, order), ty = unspread(Math.floor(rem / 2), order), W = (T.img as HTMLImageElement).width || 512;
    const P: [number, number][][] = []; for (let i = 0; i <= n; i++) { P.push([]); for (let j = 0; j <= n; j++) P[i].push(v.toScreen(...faceToSky(face, (tx + i / n) / N, (ty + j / n) / N))); }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const a = P[i][j], b = P[i + 1][j], c = P[i][j + 1], d = P[i + 1][j + 1]; const xs = [a[0], b[0], c[0], d[0]], ys = [a[1], b[1], c[1], d[1]];
      if (Math.max(...xs) - Math.min(...xs) > 170 * v.scale || Math.max(...xs) < -8 || Math.min(...xs) > v.cw + 8 || Math.max(...ys) < -8 || Math.min(...ys) > v.ch + 8) continue;     // off screen, or torn by the edge of the map
      // in the picture, a tile's columns run along HEALPix y and its rows along x
      const u0 = (j / n) * W, u1 = ((j + 1) / n) * W, v0 = (i / n) * W, v1 = ((i + 1) / n) * W;
      tri(g, T.img, [u0, v0, u0, v1, u1, v0], [a[0], a[1], b[0], b[1], c[0], c[1]]); tri(g, T.img, [u1, v1, u1, v0, u0, v1], [d[0], d[1], c[0], c[1], b[0], b[1]]);
    }
  }
  g.globalAlpha = 1; return { need: want.size, have, order };
}
