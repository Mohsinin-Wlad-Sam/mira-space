// Sky marker layer: zoom-dependent chunk loading, view culling, screen-density LOD, exact proper-motion propagation,
// sprite rendering synchronised with Aladin's own draw pass (so dots never lag or drift from the imagery).
//
// Data (written by census/export_web.py:write_sky):
//   sky/meta.json                    cell grid + which cells exist per lens
//   sky/<lens>/top.json              strongest ~1500 per lens, whole sky (loaded at start)
//   sky/<lens>/<band>_<cell>.json    up to 150 per 10-degree cell (loaded only when zoomed in and in view)
// Row: [id, ra, dec, pmra (″/yr, μα*), pmdec (″/yr), score, w2_uJy, w2_late_uJy?, sx/late ratio?] at the SPHEREx epoch MJD 60980.
// The last two (when exported) give three measured brightness anchors: WISE mean (≈2016.4), WISE late (≈2019.9), SPHEREx (2025.84).

export type Row = [string, number, number, number | null, number | null, number | null, number | null, (number | null)?, (number | null)?];
export type Hit = { lens: string; row: Row; x: number; y: number };
export type LiveSky = { name: string; ra: number; dec: number; kind: string; color: string; note: string; key: string; size: number };
export type Horizon = { ring: [number, number][]; zenith: [number, number]; cardinal: { n: string; p: [number, number] }[]; label: string };
type Meta = { cell_deg: number; cols: string[]; lenses: Record<string, { total: number; top: number; cells: Record<string, number> }> };
type Chunk = { rows: Row[]; v: Float32Array; m: Float32Array };  // unit vectors + motion vectors (rad/yr)

export const REF_YEAR = 2025.84;          // MJD 60980, the census' SPHEREx reference epoch
export const WISE_EPOCH = 2010.5;         // AllWISE imagery mean epoch
const T_MEAN = 2016.4, T_LATE = 2019.9;   // flux-weighted epochs of the WISE all-epoch and late (>MJD 58450) means
const PSF_AS = 7;                          // effective image PSF (″) used to size re-rendered stars
const D2R = Math.PI / 180, AS2R = D2R / 3600;
const CELL_ZOOM_FOV = 40;                 // below this FoV, fetch 10-degree cells in view
const MAX_CHUNKS = 220;                   // LRU cap for cached cells
const MAX_INFLIGHT = 6;

// ICRS -> Galactic rotation (Hipparcos convention)
const GAL = [[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
  [0.4941094278755837, -0.4448296299600112, 0.7469822444972189], [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]];

function cellOf(ra: number, dec: number, deg: number): string {
  const nb = Math.round(180 / deg);
  const j = Math.min(nb - 1, Math.max(0, Math.floor((dec + 90) / deg)));
  const n = Math.max(1, Math.round(36 * Math.cos((-90 + (j + 0.5) * deg) * D2R)));
  const i = ((Math.floor((((ra % 360) + 360) % 360) / 360 * n)) % n + n) % n;
  return `${j}_${i}`;
}
function prep(rows: Row[]): Chunk {
  const v = new Float32Array(rows.length * 3), m = new Float32Array(rows.length * 3);
  rows.forEach((r, k) => {
    const a = r[1] * D2R, d = r[2] * D2R, ca = Math.cos(a), sa = Math.sin(a), cd = Math.cos(d), sd = Math.sin(d);
    v[k * 3] = cd * ca; v[k * 3 + 1] = cd * sa; v[k * 3 + 2] = sd;
    const pa = (r[3] ?? 0) * AS2R, pd = (r[4] ?? 0) * AS2R;          // tangent-plane motion: e_ra * μα* + e_dec * μδ
    m[k * 3] = -sa * pa - sd * ca * pd; m[k * 3 + 1] = ca * pa - sd * sa * pd; m[k * 3 + 2] = cd * pd;
  });
  return { rows, v, m };
}

export type SkyOpts = { colors: Record<string, string>; size: number; trails: boolean; labels: boolean; maxMarkers: number; density: number; restage?: boolean };

// Measured brightness at a given year relative to the WISE all-epoch mean: log-linear between the three anchors, held outside.
export function fluxFactor(row: Row, year: number): number {
  const w2 = row[6], late = row[7], ratio = row[8];
  if (!w2 || !late || w2 <= 0 || late <= 0) return 1;
  const r1 = Math.min(50, Math.max(0.02, late / w2)), r2 = ratio && ratio > 0 ? Math.min(50, Math.max(0.02, r1 * ratio)) : r1;
  const lerp = (a: number, b: number, f: number) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * Math.min(1, Math.max(0, f)));
  if (year <= T_MEAN) return 1;
  if (year <= T_LATE) return lerp(1, r1, (year - T_MEAN) / (T_LATE - T_MEAN));
  return lerp(r1, r2, (year - T_LATE) / (REF_YEAR - T_LATE));
}

export class SkyLayer {
  al: any; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; dpr: number;
  meta: Meta | null = null; base = ""; year = REF_YEAR; trailFrom = 2010.5;
  on = new Set<string>(); top = new Map<string, Chunk>(); cells = new Map<string, Chunk>();   // cells key: lens/band_cell
  lru: string[] = []; inflight = new Map<string, AbortController>(); queue: string[] = [];
  sprites = new Map<string, HTMLCanvasElement>(); hits: Hit[] = []; extra = new Map<string, Chunk>();  // e.g. "unusual"
  labels: { name: string; v: Float32Array; m: Float32Array }[] = [];
  opts: SkyOpts; selected: string | null = null; ring: HTMLElement; frameGal = false; onStats?: (s: string) => void;
  private lastWanted = ""; private frameCount = 0; private wanted: string[] = []; restaged = 0;
  live: LiveSky[] = []; liveHits: { it: LiveSky; x: number; y: number }[] = []; horizon: Horizon | null = null;
  setLive(items: LiveSky[]) { this.live = items; this.redraw(); }
  setHorizon(h: Horizon | null) { this.horizon = h; this.redraw(); }
  pickLive(x: number, y: number, r: number) { let b: LiveSky | null = null, bd = r; for (const h of this.liveHits) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; b = h.it; } } return b; }
  private v3(ra: number, dec: number) { const a = ra * D2R, d = dec * D2R; return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)]; }
  private drawLive(ctx: CanvasRenderingContext2D, W: number, H: number, fov: number) {
    this.liveHits = [];
    if (this.horizon) {                                   // the visitor's horizon right now
      ctx.save(); ctx.strokeStyle = "rgba(91,227,166,.75)"; ctx.lineWidth = 1.6; ctx.setLineDash([7, 5]); ctx.beginPath();
      let prev: [number, number] | null = null;
      for (const [ra, dec] of this.horizon.ring) { const v = this.v3(ra, dec); const p = this.vec2pix(v[0], v[1], v[2]);
        if (p && prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < Math.max(W, H) * 0.5) ctx.lineTo(p[0], p[1]); else if (p) ctx.moveTo(p[0], p[1]); prev = p; }
      ctx.stroke(); ctx.setLineDash([]);
      ctx.font = "700 13px 'Barlow Condensed', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const c of this.horizon.cardinal) { const v = this.v3(c.p[0], c.p[1]); const p = this.vec2pix(v[0], v[1], v[2]); if (!p) continue;
        ctx.fillStyle = "rgba(4,20,14,.8)"; ctx.beginPath(); ctx.arc(p[0], p[1], 10, 0, 7); ctx.fill(); ctx.fillStyle = "#5be3a6"; ctx.fillText(c.n, p[0], p[1] + 1); }
      const z = this.v3(this.horizon.zenith[0], this.horizon.zenith[1]), zp = this.vec2pix(z[0], z[1], z[2]);
      if (zp) { ctx.strokeStyle = "#5be3a6"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(zp[0], zp[1], 7, 0, 7); ctx.moveTo(zp[0] - 11, zp[1]); ctx.lineTo(zp[0] + 11, zp[1]); ctx.moveTo(zp[0], zp[1] - 11); ctx.lineTo(zp[0], zp[1] + 11); ctx.stroke();
        ctx.textAlign = "left"; ctx.font = "600 11px 'Barlow Condensed', sans-serif"; ctx.fillStyle = "#5be3a6"; ctx.fillText(this.horizon.label, zp[0] + 14, zp[1] - 10); }
      ctx.restore();
    }
    ctx.save(); ctx.font = "600 12px 'Barlow Condensed', sans-serif"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    for (const it of this.live) {
      if ((it.kind === "craft" || it.kind === "rock") && fov > 100) continue;
      const v = this.v3(it.ra, it.dec), p = this.vec2pix(v[0], v[1], v[2]); if (!p || p[0] < -20 || p[1] < -20 || p[0] > W + 20 || p[1] > H + 20) continue;
      const [x, y] = p, r = it.size;
      ctx.fillStyle = it.color; ctx.strokeStyle = it.color; ctx.lineWidth = 1.5;
      if (it.kind === "sun") { const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.6); g.addColorStop(0, "#fff6d8"); g.addColorStop(0.35, "#ffd27aee"); g.addColorStop(1, "#ffd27a00");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, 7); ctx.fill(); }
      else if (it.kind === "moon") { ctx.fillStyle = "#e8ecf2"; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.fillStyle = "rgba(10,12,20,.75)"; ctx.beginPath(); ctx.arc(x + r * 0.45, y - r * 0.15, r * 0.85, 0, 7); ctx.fill(); }
      else if (it.kind === "planet") { ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, 7); ctx.fill(); ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.arc(x, y, r * 1.25, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
        if (it.name === "Saturn") { ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r * 0.5, -0.4, 0, 7); ctx.stroke(); } }
      else { ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); if (it.kind === "rock") ctx.fill(); else ctx.stroke(); }
      const showLabel = it.kind === "sun" || it.kind === "moon" || it.kind === "planet" || fov < 40;
      if (showLabel) { const t = it.name.toUpperCase(); ctx.fillStyle = "rgba(0,0,0,.55)"; const w = ctx.measureText(t).width; ctx.fillRect(x + r + 5, y - 9, w + 8, 18); ctx.fillStyle = it.color; ctx.fillText(t, x + r + 9, y); }
      this.liveHits.push({ it, x, y });
    }
    ctx.restore();
  }

  constructor(al: any, host: HTMLElement, opts: SkyOpts, lowPower: boolean) {
    this.al = al; this.opts = opts; this.dpr = Math.min(devicePixelRatio || 1, lowPower ? 1.25 : 2);
    this.canvas = document.createElement("canvas"); this.canvas.className = "skylayer";
    host.appendChild(this.canvas); this.ctx = this.canvas.getContext("2d")!;
    this.ring = document.createElement("div"); this.ring.className = "selring"; host.appendChild(this.ring);
    this.resize(); addEventListener("resize", () => { this.resize(); this.redraw(); });
    // draw inside Aladin's overlay pass: same frame, same view state as the imagery
    const view = al.view, orig = view.drawAllOverlays.bind(view);
    view.drawAllOverlays = () => { orig(); this.draw(); };
  }
  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.canvas.width = Math.round(r.width * this.dpr); this.canvas.height = Math.round(r.height * this.dpr);
    this.canvas.style.width = r.width + "px"; this.canvas.style.height = r.height + "px";
  }
  redraw() { try { this.al.view.requestRedraw(); } catch { this.draw(); } }
  setYear(y: number) { this.year = y; this.redraw(); }
  setOpts(o: Partial<SkyOpts>) { Object.assign(this.opts, o); this.sprites.clear(); this.redraw(); }

  async init(base: string) {
    this.base = base;
    try { this.meta = await (await fetch(`${base}sky/meta.json`, { cache: "no-store" })).json(); } catch { this.meta = null; }
    return this.meta;
  }
  async loadTop(lens: string): Promise<{ n: number; total: number } | null> {
    try {
      const j = await (await fetch(`${this.base}sky/${lens}/top.json`, { cache: "no-store" })).json();
      this.top.set(lens, prep(j.rows)); this.redraw(); return { n: j.n, total: j.total };
    } catch { return null; }
  }
  setExtra(lens: string, rows: Row[]) { this.extra.set(lens, prep(rows)); this.redraw(); }
  setLabels(items: { name: string; ra: number; dec: number; pmra: number | null; pmdec: number | null }[]) {
    this.labels = items.map((t) => { const c = prep([[t.name, t.ra, t.dec, t.pmra, t.pmdec, null, null]]); return { name: t.name, v: c.v, m: c.m }; });
    this.redraw();
  }
  setLenses(on: Iterable<string>) { this.on = new Set(on); this.lastWanted = ""; this.redraw(); }
  select(id: string | null) { this.selected = id; this.redraw(); }

  // ---------------------------------------------------------------- chunk management
  private wantCells(fov: number, w: number, h: number) {
    if (!this.meta || fov > CELL_ZOOM_FOV) return [];
    const deg = this.meta.cell_deg, keys = new Set<string>();
    // sample the view (plus a 15% margin for prefetch) finely enough that no 10° cell can slip between samples
    const nx = 14, ny = Math.max(6, Math.round(14 * h / w));
    for (let a = 0; a <= nx; a++) for (let b = 0; b <= ny; b++) {
      const p = this.pix2icrs(-0.15 * w + a / nx * 1.3 * w, -0.15 * h + b / ny * 1.3 * h);
      if (p) keys.add(cellOf(p[0], p[1], deg));
    }
    const out: string[] = [];
    for (const lens of this.on) { const cl = this.meta.lenses[lens]?.cells; if (!cl) continue; for (const k of keys) if (cl[k]) out.push(`${lens}/${k}`); }
    return out;
  }
  private schedule(want: string[]) {
    this.wanted = want;
    const sig = want.join(","); if (sig === this.lastWanted) return; this.lastWanted = sig;
    for (const k of want) this.touch(k);
    const ws = new Set(want);
    for (const [k, ac] of this.inflight) if (!ws.has(k)) { ac.abort(); this.inflight.delete(k); }   // panned away: cancel
    this.queue = want.filter((k) => !this.cells.has(k) && !this.inflight.has(k));
    this.pump();
  }
  private pump() {
    while (this.inflight.size < MAX_INFLIGHT && this.queue.length) {
      const k = this.queue.shift()!; const ac = new AbortController(); this.inflight.set(k, ac);
      fetch(`${this.base}sky/${k}.json`, { signal: ac.signal }).then((r) => r.json()).then((j) => {
        this.cells.set(k, prep(j.rows)); this.lru.push(k);
        while (this.lru.length > MAX_CHUNKS) { const old = this.lru.shift()!; this.cells.delete(old); }
        this.redraw();
      }).catch(() => { /* aborted or missing */ }).finally(() => { this.inflight.delete(k); this.pump(); });
    }
  }
  touch(k: string) { const i = this.lru.indexOf(k); if (i >= 0) { this.lru.splice(i, 1); this.lru.push(k); } }

  // ---------------------------------------------------------------- coordinates
  pix2icrs(x: number, y: number): [number, number] | null {
    let p: any; try { p = this.al.pix2world(x, y); } catch { return null; }
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) return null;
    if (!this.frameGal) return [p[0], p[1]];
    // view in Galactic: convert back to ICRS (transpose of GAL)
    const l = p[0] * D2R, b = p[1] * D2R, g = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
    const x0 = GAL[0][0] * g[0] + GAL[1][0] * g[1] + GAL[2][0] * g[2], y0 = GAL[0][1] * g[0] + GAL[1][1] * g[1] + GAL[2][1] * g[2], z0 = GAL[0][2] * g[0] + GAL[1][2] * g[1] + GAL[2][2] * g[2];
    return [((Math.atan2(y0, x0) / D2R) + 360) % 360, Math.asin(Math.max(-1, Math.min(1, z0))) / D2R];
  }
  // unit vector (ICRS) -> screen px (CSS), or null if not visible
  private vec2pix(x: number, y: number, z: number): [number, number] | null {
    if (this.frameGal) { const gx = GAL[0][0] * x + GAL[0][1] * y + GAL[0][2] * z, gy = GAL[1][0] * x + GAL[1][1] * y + GAL[1][2] * z, gz = GAL[2][0] * x + GAL[2][1] * y + GAL[2][2] * z; x = gx; y = gy; z = gz; }
    const lon = ((Math.atan2(y, x) / D2R) + 360) % 360, lat = Math.asin(Math.max(-1, Math.min(1, z))) / D2R;
    let p: any; try { p = this.al.world2pix(lon, lat); } catch { return null; }
    return p && isFinite(p[0]) && isFinite(p[1]) ? [p[0], p[1]] : null;
  }
  // exact linear space motion on the sphere: r(t) = normalize(r0 + μ t)  (perspective acceleration neglected: < 4″ by 2100 for Barnard's Star)
  private at(c: { v: Float32Array; m: Float32Array }, k: number, dt: number, out: number[]) {
    const x = c.v[k * 3] + c.m[k * 3] * dt, y = c.v[k * 3 + 1] + c.m[k * 3 + 1] * dt, z = c.v[k * 3 + 2] + c.m[k * 3 + 2] * dt, n = Math.hypot(x, y, z);
    out[0] = x / n; out[1] = y / n; out[2] = z / n;
  }
  posAt(row: Row, year: number): [number, number] {
    const c = prep([row]); const o = [0, 0, 0]; this.at(c, 0, year - REF_YEAR, o);
    return [((Math.atan2(o[1], o[0]) / D2R) + 360) % 360, Math.asin(o[2]) / D2R];
  }

  private sprite(color: string, sel = false): HTMLCanvasElement {
    const key = color + (sel ? "*" : ""); let s = this.sprites.get(key); if (s) return s;
    s = document.createElement("canvas"); s.width = s.height = 64; const g = s.getContext("2d")!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    // a crisp ring with a faint glow: marks the object without hiding the sky under it
    grd.addColorStop(0, color + "55"); grd.addColorStop(0.3, color + "33"); grd.addColorStop(0.7, color + "11"); grd.addColorStop(1, color + "00");
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = color; g.lineWidth = 4.5; g.beginPath(); g.arc(32, 32, 17, 0, 2 * Math.PI); g.stroke();
    g.fillStyle = color; g.beginPath(); g.arc(32, 32, 4.5, 0, 2 * Math.PI); g.fill();
    this.sprites.set(key, s); return s;
  }

  // ---------------------------------------------------------------- draw (called from Aladin's overlay pass)
  draw() {
    const ctx = this.ctx, dpr = this.dpr, W = this.canvas.width / dpr, H = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); this.hits = [];
    let fov = 180; try { fov = this.al.getFov()[0]; } catch { /* */ }
    try { this.frameGal = String(this.al.getFrame?.() ?? "").toLowerCase().startsWith("gal"); } catch { /* */ }
    this.schedule(this.wantCells(fov, W, H));
    // view cone for culling (centre vector + radius generous enough for any projection)
    const ctr = this.pix2icrs(W / 2, H / 2); let cosR = -2;
    const cv = [0, 0, 1];
    if (ctr && fov < 120) { const a = ctr[0] * D2R, d = ctr[1] * D2R; cv[0] = Math.cos(d) * Math.cos(a); cv[1] = Math.cos(d) * Math.sin(a); cv[2] = Math.sin(d);
      cosR = Math.cos(Math.min(179, fov * 0.5 * Math.hypot(1, H / W) * 1.25 + 0.5) * D2R); }
    const dt = this.year - REF_YEAR, dtTrail = this.trailFrom - REF_YEAR;
    // which epoch does the imagery show? SPHEREx (2025.84) from then on, WISE (2010.5) before; in between both are blended
    const imgEpoch = this.year >= REF_YEAR - 0.05 ? REF_YEAR : this.year <= WISE_EPOCH + 0.05 ? WISE_EPOCH : NaN;
    const asPerPx = fov * 3600 / W, psfPx = PSF_AS / asPerPx;
    const restage = this.opts.restage !== false && isFinite(imgEpoch) && fov < 6;      // stars resolved: redraw movers at their new places
    const sz = this.opts.size * (fov > 90 ? 0.55 : fov > 20 ? 0.75 : fov > 2 ? 0.9 : 1.1);
    const binPx = Math.max(6, 22 / this.opts.density), bins = new Map<number, number>(), perBin = fov > CELL_ZOOM_FOV ? 1 : 2;
    let budget = this.opts.maxMarkers, drawn = 0, loadedCells = 0, moved = 0; const seen = new Set<string>(); const o = [0, 0, 0], o2 = [0, 0, 0];
    const lensOrder = [...this.on];
    const sources: [string, Chunk][] = [];
    for (const lens of lensOrder) {
      const t = this.top.get(lens) ?? this.extra.get(lens); if (t) sources.push([lens, t]);
      if (fov <= CELL_ZOOM_FOV) for (const k of this.wanted) { const c = this.cells.get(k); if (c && k.startsWith(lens + "/")) { sources.push([lens, c]); loadedCells++; } }
    }
    type D = { x: number; y: number; col: string; a: number; s: number; tx?: number; ty?: number; mx?: number; my?: number; mr?: number; f?: number };
    const draws: D[] = [];
    // round-robin across lenses so one lens cannot starve the others of the marker budget
    const iters = sources.map(() => 0); let active = true;
    while (active && budget > 0) {
      active = false;
      for (let s = 0; s < sources.length && budget > 0; s++) {
        const [lens, c] = sources[s]; let k = iters[s];
        for (; k < c.rows.length; k++) {
          const row = c.rows[k];
          if (cosR > -2 && c.v[k * 3] * cv[0] + c.v[k * 3 + 1] * cv[1] + c.v[k * 3 + 2] * cv[2] < cosR) continue;   // outside view
          if (seen.has(lens + row[0])) continue;
          this.at(c, k, dt, o); const p = this.vec2pix(o[0], o[1], o[2]); if (!p) continue;
          const [x, y] = p; if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
          const bin = (Math.floor(y / binPx) * 4096 + Math.floor(x / binPx)), bc = bins.get(bin) ?? 0;
          if (bc >= perBin && row[0] !== this.selected) continue;                  // screen-density LOD
          bins.set(bin, bc + 1); seen.add(lens + row[0]);
          const col = this.opts.colors[lens] ?? "#ffffff";
          const ff = fluxFactor(row, this.year);                                    // measured brightness history
          const d: D = { x, y, col, a: Math.min(1, Math.max(0.22, Math.sqrt(ff))), s: sz * Math.min(1.7, Math.max(0.6, Math.pow(ff, 0.22))) };
          const moving = row[3] !== null && !!(row[3] || row[4]);
          if (this.opts.trails && moving) {                                         // motion trail since WISE (2010)
            this.at(c, k, dtTrail, o2); const q = this.vec2pix(o2[0], o2[1], o2[2]);
            if (q && Math.hypot(q[0] - x, q[1] - y) > 1.5) { d.tx = q[0]; d.ty = q[1]; }
          }
          if (restage && moving) {                                                  // where the imagery shows it
            this.at(c, k, imgEpoch - REF_YEAR, o2); const q = this.vec2pix(o2[0], o2[1], o2[2]);
            const r = Math.min(46, Math.max(3, psfPx * (1.1 + 0.55 * Math.log10(Math.max(1, (row[6] ?? 300) / 300)))));
            if (q && Math.hypot(q[0] - x, q[1] - y) > Math.max(2.5, r * 0.5)) { d.mx = q[0]; d.my = q[1]; d.mr = r; d.f = ff; moved++; }
          }
          draws.push(d);
          this.hits.push({ lens, row, x, y }); drawn++; budget--;
          if (row[0] === this.selected) { this.ring.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; this.ring.classList.add("on"); }
          k++; break;   // one per source per round
        }
        iters[s] = k; if (k < c.rows.length) active = true;
      }
    }
    // 1) masks over the imaged star (it has since moved away), 2) the star re-rendered where its motion puts it now
    for (const d of draws) if (d.mr) {
      const g = ctx.createRadialGradient(d.mx!, d.my!, 0, d.mx!, d.my!, d.mr! * 1.6);
      g.addColorStop(0, "rgba(4,2,10,.94)"); g.addColorStop(0.55, "rgba(4,2,10,.75)"); g.addColorStop(1, "rgba(4,2,10,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(d.mx!, d.my!, d.mr! * 1.6, 0, 2 * Math.PI); ctx.fill();
      ctx.setLineDash([2, 3]); ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(d.mx!, d.my!, Math.max(3, d.mr! * 0.7), 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.globalCompositeOperation = "lighter";
    for (const d of draws) if (d.mr) {
      const r = d.mr! * Math.min(1.6, Math.max(0.5, Math.pow(d.f ?? 1, 0.25))), a = Math.min(1, 0.35 + 0.65 * Math.sqrt(d.f ?? 1));
      const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, r * 1.5);
      g.addColorStop(0, `rgba(255,248,230,${a})`); g.addColorStop(0.25, `rgba(255,214,150,${a * 0.85})`); g.addColorStop(0.6, `rgba(255,120,60,${a * 0.3})`); g.addColorStop(1, "rgba(255,80,40,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(d.x, d.y, r * 1.5, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.lineCap = "round";
    for (const d of draws) if (d.tx !== undefined) {
      const g = ctx.createLinearGradient(d.tx, d.ty!, d.x, d.y); g.addColorStop(0, d.col + "00"); g.addColorStop(1, d.col + "cc");
      ctx.strokeStyle = g; ctx.lineWidth = Math.max(1, d.s * 0.16); ctx.beginPath(); ctx.moveTo(d.tx, d.ty!); ctx.lineTo(d.x, d.y); ctx.stroke();
    }
    for (const d of draws) { ctx.globalAlpha = d.a; ctx.drawImage(this.sprite(d.col), d.x - d.s, d.y - d.s, 2 * d.s, 2 * d.s); }
    ctx.globalAlpha = 1;
    this.restaged = moved;
    if (this.selected && !this.hits.some((h) => h.row[0] === this.selected)) this.ring.classList.remove("on");
    if (this.live.length || this.horizon) this.drawLive(ctx, W, H, fov);
    // labels for famous objects
    if (this.opts.labels && fov < 60) {
      ctx.font = "600 12px 'Barlow Condensed', sans-serif"; ctx.textBaseline = "middle";
      for (const L of this.labels) {
        this.at(L, 0, dt, o); const p = this.vec2pix(o[0], o[1], o[2]); if (!p || p[0] < 0 || p[1] < 0 || p[0] > W || p[1] > H) continue;
        const t = L.name.toUpperCase(); ctx.fillStyle = "rgba(0,0,0,.55)"; const w = ctx.measureText(t).width;
        ctx.fillRect(p[0] + 12, p[1] - 9, w + 10, 18); ctx.fillStyle = "#fff"; ctx.fillText(t, p[0] + 17, p[1]);
        ctx.strokeStyle = "rgba(255,255,255,.6)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p[0] + 4, p[1]); ctx.lineTo(p[0] + 12, p[1]); ctx.stroke();
      }
    }
    if ((this.frameCount++ & 15) === 0) this.onStats?.(`${drawn} shown · ${loadedCells ? `${loadedCells} cells loaded` : "all-sky top list"}${this.inflight.size ? ` · loading ${this.inflight.size}` : ""}${this.restaged ? ` · ${this.restaged} stars redrawn at ${this.year.toFixed(0)} positions` : ""}`);
  }
  pick(x: number, y: number, radius: number): Hit | null {
    let best: Hit | null = null, bd = radius;
    for (const h of this.hits) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h; } }
    return best;
  }
}
