// On-demand SPHEREx flipbook + spectrum for ANY RA/Dec, built in the browser from NASA's public data:
//  1. static exposure index (census/sphx_index.py, from IRSA's TAP inventory) -> exposures covering the position
//  2. for each: one HTTP Range read of the header (TAN-SIP WCS) from the public S3 bucket (CORS-enabled)
//  3. one Range read of just the image rows around the target (motion-propagated for moving objects)
//  4. wavelength of that pixel from the detector's linear-variable-filter table (WCS-WAVE, precomputed per detector)
// No server: all requests go to NASA/IRSA's own S3.
const BASE = import.meta.env.BASE_URL;
const S3 = "https://nasa-irsa-spherex.s3.amazonaws.com/";
const D2R = Math.PI / 180;
export type Target = { ra: number; dec: number; pmra?: number | null; pmdec?: number | null; epochYear?: number; name?: string };
export type LiveFrame = { mjd: number; band: string; detector: number; lam_um: number; bw_um: number; dx: number; dy: number; visit: number };

// ---------------------------------------------------------------- HEALPix nested ang2pix (nside power of 2)
export function ang2pixNest(nside: number, ra: number, dec: number) {
  const z = Math.sin(dec * D2R), phi = ((ra % 360) + 360) % 360 * D2R, za = Math.abs(z), tt = phi / (Math.PI / 2) % 4;
  let face: number, ix: number, iy: number;
  if (za <= 2 / 3) {
    const temp1 = nside * (0.5 + tt), temp2 = nside * (z * 0.75), jp = Math.floor(temp1 - temp2), jm = Math.floor(temp1 + temp2);
    const ifp = Math.floor(jp / nside), ifm = Math.floor(jm / nside);
    face = ifp === ifm ? (ifp | 4) : ifp < ifm ? ifp : ifm + 8;
    ix = jm & (nside - 1); iy = nside - (jp & (nside - 1)) - 1;
  } else {
    const ntt = Math.min(3, Math.floor(tt)), tp = tt - ntt, tmp = nside * Math.sqrt(3 * (1 - za));
    let jp = Math.floor(tp * tmp), jm = Math.floor((1 - tp) * tmp); jp = Math.min(jp, nside - 1); jm = Math.min(jm, nside - 1);
    if (z >= 0) { face = ntt; ix = nside - jm - 1; iy = nside - jp - 1; } else { face = ntt + 8; ix = jp; iy = jm; }
  }
  let ipf = 0; for (let b = 0; (1 << b) < nside; b++) { ipf |= ((ix >> b) & 1) << (2 * b); ipf |= ((iy >> b) & 1) << (2 * b + 1); }
  return face * nside * nside + ipf;
}

// ---------------------------------------------------------------- geometry helpers
function inQuad(ra: number, dec: number, poly: number[]) {     // gnomonic projection about the point; sign of cross products
  const a0 = ra * D2R, d0 = dec * D2R, pts: [number, number][] = [];
  for (let k = 0; k < poly.length; k += 2) {
    const a = poly[k] * D2R, d = poly[k + 1] * D2R, c = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
    if (c <= 0) return false;
    pts.push([Math.cos(d) * Math.sin(a - a0) / c, (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / c]);
  }
  let sgn = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; const cr = x1 * y2 - x2 * y1; const s = Math.sign(cr); if (!s) continue; if (!sgn) sgn = s; else if (s !== sgn) return false; }
  return true;
}
function propagate(t: Target, mjd: number): [number, number] {
  if (!t.pmra && !t.pmdec) return [t.ra, t.dec];
  const dy = 2000 + (mjd - 51544.5) / 365.25 - (t.epochYear ?? 2025.84);
  const dec = t.dec + (t.pmdec ?? 0) / 3600 * dy;
  return [t.ra + (t.pmra ?? 0) / 3600 * dy / Math.cos(t.dec * D2R), dec];
}

// ---------------------------------------------------------------- FITS header + TAN-SIP world->pixel
type Hdr = Record<string, number | string>;
function parseCards(buf: Uint8Array, start: number): { h: Hdr; end: number } | null {
  const td = new TextDecoder("ascii"); const h: Hdr = {};
  for (let p = start; p + 80 <= buf.length; p += 80) {
    const card = td.decode(buf.subarray(p, p + 80)), key = card.slice(0, 8).trim();
    if (key === "END") return { h, end: Math.ceil((p + 80) / 2880) * 2880 };
    if (card[8] !== "=") continue;
    let v = card.slice(10); const sl = v.indexOf("/"); if (!v.trim().startsWith("'") && sl >= 0) v = v.slice(0, sl);
    v = v.trim(); h[key] = v.startsWith("'") ? v.slice(1, v.lastIndexOf("'")).trim() : +v;
  }
  return null;
}
function worldToPix(h: Hdr, ra: number, dec: number): [number, number] {
  const a0 = +h.CRVAL1 * D2R, d0 = +h.CRVAL2 * D2R, a = ra * D2R, d = dec * D2R;
  const c = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  const xi = Math.cos(d) * Math.sin(a - a0) / c / D2R, eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / c / D2R;
  const c1 = +(h.CDELT1 ?? 1), c2 = +(h.CDELT2 ?? 1);
  const m11 = (h.CD1_1 !== undefined ? +h.CD1_1 : +(h.PC1_1 ?? 1) * c1), m12 = (h.CD1_2 !== undefined ? +h.CD1_2 : +(h.PC1_2 ?? 0) * c1);
  const m21 = (h.CD2_1 !== undefined ? +h.CD2_1 : +(h.PC2_1 ?? 0) * c2), m22 = (h.CD2_2 !== undefined ? +h.CD2_2 : +(h.PC2_2 ?? 1) * c2);
  const det = m11 * m22 - m12 * m21, u = (m22 * xi - m12 * eta) / det, v = (-m21 * xi + m11 * eta) / det;
  let U = u, V = v;                                            // inverse SIP (AP/BP)
  const ord = +(h.AP_ORDER ?? 0);
  for (let p = 0; p <= ord; p++) for (let q = 0; q <= ord - p; q++) {
    const ap = h[`AP_${p}_${q}`], bp = h[`BP_${p}_${q}`], t = Math.pow(u, p) * Math.pow(v, q);
    if (ap !== undefined) U += +ap * t; if (bp !== undefined) V += +bp * t;
  }
  return [+h.CRPIX1 + U - 1, +h.CRPIX2 + V - 1];               // 0-based pixel
}
async function range(url: string, a: number, b: number, signal?: AbortSignal) {
  const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` }, signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

let LVF: Record<string, { grid: number[]; lam: number[][]; bw: number[][] }> | null = null;
function lvfAt(det: number, x: number, y: number): [number, number] {
  const t = LVF?.[String(det)]; if (!t) return [NaN, NaN];
  const g = t.grid, n = g.length, fx = Math.min(n - 1.001, Math.max(0, x / g[n - 1] * (n - 1))), fy = Math.min(n - 1.001, Math.max(0, y / g[n - 1] * (n - 1)));
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
  const bil = (M: number[][]) => M[j][i] * (1 - u) * (1 - v) + M[j][i + 1] * u * (1 - v) + M[j + 1][i] * (1 - u) * v + M[j + 1][i + 1] * u * v;
  return [bil(t.lam), bil(t.bw)];
}

export type Built = { frames: LiveFrame[]; stamps: Float32Array; size: number; phot: { lam: number; flux: number; err: number; mjd: number }[]; covered: number };
/** build up to `maxFrames` stamps (size×size px) around the target; progress(done, total) */
export async function buildLive(t: Target, progress: (d: number, n: number, msg: string) => void, maxFrames = 72, size = 32, signal?: AbortSignal): Promise<Built> {
  LVF ??= (await (await fetch(`${BASE}space/lvf.json`)).json()).det;
  const pix = ang2pixNest(16, t.ra, t.dec);
  const r = await fetch(`${BASE}data/sphx/${pix}.json`); if (!r.ok || (r.headers.get("content-type") ?? "").includes("html")) throw new Error("SPHEREx exposure index not available");
  const idx = (await r.json()) as { e: [number, number, string, number[]][] };
  const cover = idx.e.filter((e) => { const [ra, dec] = propagate(t, e[0]); return inQuad(ra, dec, e[3]); });
  // spread the chosen frames over time and all six detectors
  const byDet = new Map<number, typeof cover>(); cover.forEach((e) => (byDet.get(e[1]) ?? byDet.set(e[1], []).get(e[1])!).push(e));
  const per = Math.max(2, Math.ceil(maxFrames / Math.max(1, byDet.size))), pick: typeof cover = [];
  for (const L of byDet.values()) { if (L.length <= per) pick.push(...L); else for (let k = 0; k < per; k++) pick.push(L[Math.round(k * (L.length - 1) / (per - 1))]); }
  pick.sort((a, b) => a[0] - b[0]);
  const H = size / 2, out: { f: LiveFrame; img: Float32Array }[] = []; let done = 0;
  progress(0, pick.length, `${cover.length} SPHEREx exposures cover this spot; reading ${pick.length}`);
  const one = async (e: (typeof cover)[number]) => {
    const [rel, path] = e[2].split("|"), [week, ver, det, sd] = path.split("/"), [seq, dd] = sd.split("_");
    const url = `${S3}${rel}/level2/${week}/${ver}/${det}/level2_${week}_${seq}_${dd}_spx_${ver}.fits`;
    let head = await range(url, 0, 40319, signal);
    const p0 = parseCards(head, 0); if (!p0) throw new Error("header");
    let p1 = parseCards(head, p0.end);
    if (!p1) { head = await range(url, 0, 80639, signal); p1 = parseCards(head, p0.end); } if (!p1) throw new Error("header");
    const h = p1.h, N1 = +h.NAXIS1, N2 = +h.NAXIS2, dataStart = p1.end;
    const [ra, dec] = propagate(t, e[0]); const [px, py] = worldToPix(h, ra, dec);
    const xi = Math.round(px), yi = Math.round(py);
    if (xi < H || yi < H || xi >= N1 - H || yi >= N2 - H) return;
    const y0 = yi - H, rows = await range(url, dataStart + y0 * N1 * 4, dataStart + (y0 + size) * N1 * 4 - 1, signal);
    const dv = new DataView(rows.buffer, rows.byteOffset, rows.byteLength), img = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) img[y * size + x] = dv.getFloat32(((y * N1) + xi - H + x) * 4, false);
    // remove the local background (zodiacal light + sky) with the stamp's median: SPHEREx L2 ZODI is not read, to save bandwidth
    const v = Array.from(img).filter(isFinite).sort((a, b) => a - b), med = v.length ? v[Math.floor(v.length / 2)] : 0;
    for (let k = 0; k < img.length; k++) img[k] -= med;
    const [lam, bw] = lvfAt(+det, px, py);
    out.push({ f: { mjd: e[0], band: `D${det}`, detector: +det, lam_um: +lam.toFixed(4), bw_um: +bw.toFixed(4), dx: +(px - xi).toFixed(3), dy: +(py - yi).toFixed(3), visit: 0 }, img });
  };
  const queue = [...pick]; const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) { const e = queue.shift()!; try { await one(e); } catch (err) { if ((err as Error).name === "AbortError") throw err; } done++; progress(done, pick.length, `read ${done} of ${pick.length} exposures`); }
  });
  await Promise.all(workers);
  out.sort((a, b) => a.f.mjd - b.f.mjd);
  let visit = 0; out.forEach((o, k) => { if (k && o.f.mjd - out[k - 1].f.mjd > 20) visit++; o.f.visit = visit; });
  const stamps = new Float32Array(out.length * size * size); out.forEach((o, k) => stamps.set(o.img, k * size * size));
  // on-the-fly spectrum: aperture photometry at the target. Smooth (anti-aliased) r = 2 px aperture so the summed area does
  // not jump with the sub-pixel position; MJy/sr × pixel solid angle (6.15″)² -> mJy. No aperture correction (relative spectrum).
  const OMEGA = Math.pow(6.15 / 206264.806, 2);
  const phot = out.map((o) => {
    let s = 0, wsum = 0; const ring: number[] = []; const cx = H + o.f.dx, cy = H + o.f.dy;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const r = Math.hypot(x - cx, y - cy), v2 = o.img[y * size + x]; if (!isFinite(v2)) continue;
      const w = Math.max(0, Math.min(1, 2.5 - r)); if (w > 0) { s += w * v2; wsum += w; } else if (r >= 5 && r <= 8) ring.push(v2); }
    ring.sort((a, b) => a - b); const bg = ring.length ? ring[Math.floor(ring.length / 2)] : 0, sig = ring.length ? (ring[Math.floor(ring.length * 0.75)] - ring[Math.floor(ring.length * 0.25)]) / 1.349 : 0;
    return { lam: o.f.lam_um, flux: (s - bg * wsum) * OMEGA * 1e9, err: sig * Math.sqrt(Math.max(wsum, 1)) * OMEGA * 1e9, mjd: o.f.mjd };
  }).filter((p) => isFinite(p.flux) && isFinite(p.lam));
  return { frames: out.map((o) => o.f), stamps, size, phot, covered: cover.length };
}
