// Data layer: static JSON feeds exported by census/export_web.py into /data/. Missing feeds -> null (UI shows placeholders).
export type Obj = {
  tile: number; obj: number; ra: number; dec: number; ra_sx: number; dec_sx: number;
  pmra: number | null; pmdec: number | null; epm: number | null; pm: number | null; n_ep: number;
  reliable_motion: boolean; w1_uJy: number | null; w2_uJy: number | null; w2_late_uJy: number | null;
  sx_w1_uJy: number | null; sx_w2_uJy: number | null; sx_w2_err: number | null; sx_w2_snr: number | null;
  decade_ratio_w2: number | null; decade_z_w2: number | null; flag_vanished: boolean; flag_brightened: boolean;
  isolated: boolean; sx_saturated: boolean; methane_sigma: number | null; methane_ratio: number | null;
  idx_water: number | null; idx_ice: number | null; idx_hotdust: number | null; paschen_sigma: number | null;
  w2_var_chi2: number | null; blend_n: number; spec?: [number | null, number | null][];
  ai_dist?: number | null; ai_sig?: number | null; ai_teff?: number | null; ai_cls?: number | null; ai_p?: number | null;   // AI ensemble (census/ai_phys.py)
};
export type Feed = { name: string; n: number; total?: number; items: Obj[] };
export type Summary = {
  updated: string; tiles_done: number; tiles_total: number; sky_fraction: number; lam_um: number[] | null;
  feeds: Record<string, number>; n_obj: number; n_rows: number; n_spec: number; n_reliable_motion: number; n_det: number;
};
export type Target = { name: string; ra: number; dec: number; pmra: number; pmdec: number; processed: boolean; census?: Obj; match_arcsec?: number };

const cache = new Map<string, unknown>();
export async function load<T>(name: string, fresh = false): Promise<T | null> {
  if (!fresh && cache.has(name)) return cache.get(name) as T;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/${name}.json`, { cache: "no-store" });
    if (!r.ok || (r.headers.get("content-type") ?? "").includes("html")) return null;
    const j = (await r.json()) as T;
    cache.set(name, j);
    return j;
  } catch { return null; }
}
export const FEEDS = ["movers", "methane", "vanished", "brightened"] as const;

export async function allObjects(): Promise<Obj[]> {
  const out: Obj[] = [];
  for (const f of FEEDS) { const d = await load<Feed>(f); if (d) out.push(...d.items); }
  const t = await load<Target[]>("targets");
  if (t) for (const x of t) if (x.census) out.push(x.census);
  return out;
}
export const key = (o: Obj) => `${o.tile}-${o.obj}`;
export async function findObject(k: string): Promise<{ o: Obj; feeds: string[] } | null> {
  const feeds: string[] = []; let hit: Obj | null = null;
  for (const f of FEEDS) {
    const d = await load<Feed>(f); const m = d?.items.find((o) => key(o) === k);
    if (m) { hit = m; feeds.push(f); }
  }
  const t = await load<Target[]>("targets");
  const tm = t?.find((x) => x.census && key(x.census) === k);
  if (tm?.census) { hit = hit ?? tm.census; feeds.push("target:" + tm.name); }
  return hit ? { o: hit, feeds } : null;
}

export const fmt = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !isFinite(v) ? "–" : v.toFixed(d));
export const sexa = (ra: number, dec: number) => {
  // round once in the smallest unit, then carry (no "60.0s" or "60″")
  const ts = Math.round(((ra % 360 + 360) % 360) / 15 * 36000), hh = Math.floor(ts / 36000) % 24, mm = Math.floor(ts / 600) % 60, ss = (ts % 600) / 10;
  const s = dec < 0 ? "−" : "+", as = Math.round(Math.abs(dec) * 3600), dd = Math.floor(as / 3600), dm = Math.floor(as / 60) % 60, ds = as % 60;
  return `${String(hh).padStart(2, "0")}h${String(mm).padStart(2, "0")}m${ss.toFixed(1).padStart(4, "0")}s ${s}${String(dd).padStart(2, "0")}°${String(dm).padStart(2, "0")}′${String(ds).padStart(2, "0")}″`;
};

// ---------------------------------------------------------------- chunked detail (obj/<tile//4>.json), fetched on demand
export const BASE = import.meta.env.BASE_URL + "data/";
const detailCache = new Map<number, Promise<Record<string, any> | null>>();
function f16(h: number) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}
function decodeF16(b64: string): number[] {
  const bin = atob(b64), out: number[] = [];
  for (let i = 0; i + 1 < bin.length; i += 2) out.push(f16(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8)));
  return out;
}
export async function loadDetail(id: string): Promise<Obj | null> {
  const tile = parseInt(id.split("-")[0], 10); if (!isFinite(tile)) return null;
  const g = Math.floor(tile / 4);
  if (!detailCache.has(g)) detailCache.set(g, fetch(`${BASE}obj/${g}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  const d = (await detailCache.get(g))?.[id]; if (!d) return null;
  const o = { ...d } as any;
  o.pm = o.pmra === null || o.pmra === undefined ? null : Math.hypot(o.pmra, o.pmdec);
  if (d.spec_b64) {
    const [a, b] = (d.spec_b64 as string).split("|"); const fl = decodeF16(a), er = decodeF16(b);
    o.spec = fl.map((v, i) => [isFinite(v) ? v : null, isFinite(er[i]) ? er[i] : null]);
    delete o.spec_b64;
  }
  return o as Obj;
}
