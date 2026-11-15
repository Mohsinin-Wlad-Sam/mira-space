// PREPARED FIELDS — a field the Lab has read (its exposures, NASA's flags, the 1999 and 2010 pictures, the catalogue
// stars) packed into one compressed file, so that NASA's five test targets open at once instead of after half a
// minute of reading the archive. The file holds exactly what the Lab keeps in the browser after a live reading; it
// is used only while the exposure index it was read with is still the current one (after a new data release the
// Lab reads live again until the files are rebuilt: web/scripts/prebake_fields.mjs).
type TA = Float32Array | Float64Array | Int32Array | Uint32Array | Int16Array | Uint16Array | Uint8Array;
const KINDS: [string, { new (b: ArrayBuffer, o: number, n: number): TA; BYTES_PER_ELEMENT: number }][] = [["f32", Float32Array], ["f64", Float64Array], ["i32", Int32Array], ["u32", Uint32Array], ["i16", Int16Array], ["u16", Uint16Array], ["u8", Uint8Array]];
const MAGIC = "MIRAF1";

/** an object holding typed arrays -> one gzip file */
export async function packField(rec: unknown): Promise<Blob> {
  const chunks: Uint8Array[] = []; let off = 0;
  const walk = (v: any): any => {
    if (v === null || typeof v !== "object") return typeof v === "number" && !Number.isFinite(v) ? { __nan: String(v) } : v;
    const kind = KINDS.find(([, C]) => v instanceof C);
    if (kind) { const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength), pad = (8 - (off % 8)) % 8; if (pad) { chunks.push(new Uint8Array(pad)); off += pad; } const at = off; chunks.push(bytes.slice()); off += bytes.length; return { __ta: kind[0], o: at, n: v.length }; }
    if (Array.isArray(v)) return v.map(walk);
    const o: Record<string, unknown> = {}; for (const k of Object.keys(v)) o[k] = walk(v[k]); return o;
  };
  const head = new TextEncoder().encode(JSON.stringify(walk(rec))), pre = new Uint8Array(16); pre.set(new TextEncoder().encode(MAGIC)); new DataView(pre.buffer).setUint32(8, head.length, true);
  const hpad = new Uint8Array((8 - (head.length % 8)) % 8), raw = new Blob([pre, head, hpad, ...chunks] as BlobPart[]);
  return new Response(raw.stream().pipeThrough(new CompressionStream("gzip"))).blob();
}
/** the reverse; null if the file is not one of ours */
export async function unpackField(gz: Blob): Promise<any | null> {
  try {
    const buf = await new Response(gz.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer(), u8 = new Uint8Array(buf);
    if (new TextDecoder().decode(u8.subarray(0, 6)) !== MAGIC) return null;
    const hl = new DataView(buf).getUint32(8, true), head = JSON.parse(new TextDecoder().decode(u8.subarray(16, 16 + hl))), base = 16 + hl + ((8 - (hl % 8)) % 8);
    const walk = (v: any): any => {
      if (v === null || typeof v !== "object") return v;
      if (typeof v.__nan === "string") return Number(v.__nan);
      if (typeof v.__ta === "string") { const C = KINDS.find(([k]) => k === v.__ta)![1]; return new C(buf.slice(base + v.o, base + v.o + v.n * C.BYTES_PER_ELEMENT), 0, v.n); }
      if (Array.isArray(v)) return v.map(walk);
      for (const k of Object.keys(v)) v[k] = walk(v[k]); return v;
    };
    return walk(head);
  } catch { return null; }
}
/** a short, stable file name for a field key */
export const fieldFile = (key: string) => { let h = 5381; for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0; return `f${h.toString(16)}.bin`; };

let index: Promise<Record<string, string>> | null = null;
/** the prepared copy of a field, if the site carries one */
export async function prebaked(base: string, key: string): Promise<any | null> {
  const ix = await (index ??= fetch(`${base}data/lab/index.json`).then((r) => (r.ok ? r.json() : {})).then((j: any) => j.fields ?? {}).catch(() => ({})));
  const file = ix[key]; if (!file) return null;
  try { const r = await fetch(`${base}data/lab/${file}`); return r.ok ? await unpackField(await r.blob()) : null; } catch { return null; }
}
