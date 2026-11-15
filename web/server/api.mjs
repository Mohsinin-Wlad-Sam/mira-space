// MIRA's data API, version 1. One handler shared by the dev server (vite.config.ts) and the production process
// (deploy/assistant-proxy.mjs). It answers from the same files the site reads (web/public/data, or MIRA_DATA): nothing
// here is computed that the site does not also show. No dependencies.
//
//   GET  /api/v1/status                       what data this server carries
//   GET  /api/v1/openapi.json                 this interface, as OpenAPI 3
//   GET  /api/v1/targets                      NASA's five test targets
//   GET  /api/v1/movers?ra&dec&radius...      the verified catalogue: cone search and filters (JSON or CSV)
//   GET  /api/v1/movers/{id}                  one confirmed mover, every column
//   GET  /api/v1/exposures?ra&dec...          the SPHEREx Level-2 exposures whose footprint holds a position
//   GET  /api/v1/coverage?ra&dec              when SPHEREx visited a position, and about when it comes back
//   GET  /api/v1/scout?ra&dec&radius          places the sky model marked, with the Gaia check and V-JEPA 2's score
//   POST /api/v1/crossmatch                   a list of positions against the catalogue, the survey and the scout
//
//   env: MIRA_DATA (folder of the data files; default ../public/data)   MIRA_API_PER10MIN (default 300)
//        MIRA_API_KEYS (comma-separated; when set, every call but status and openapi.json needs the header X-API-Key)
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const D2R = Math.PI / 180, S3 = "https://nasa-irsa-spherex.s3.amazonaws.com/", VERSION = "1.0";
const BANDS = { 1: [0.75, 1.12], 2: [1.10, 1.66], 3: [1.64, 2.44], 4: [2.42, 3.86], 5: [3.82, 4.44], 6: [4.42, 5.02] };
const TARGETS = [
  { key: "barnard", name: "Barnard's Star", ra: 269.452077, dec: 4.693365, pmra: -0.80155, pmdec: 10.36239, epoch: 2000 },
  { key: "eps-indi-b", name: "Epsilon Indi B", ra: 331.044147, dec: -56.782844, pmra: 3.98198, pmdec: -2.46683, epoch: 2000 },
  { key: "wise-0855", name: "WISE 0855-0714", ra: 133.818908, dec: -7.247048, pmra: -8.1237, pmdec: 0.6732, epoch: 2000 },
  { key: "rw-aur", name: "RW Aurigae" }, { key: "r-dra", name: "R Draconis" },
];
const dataDir = (env) => (env.MIRA_DATA ? env.MIRA_DATA.replace(/\/?$/, "/") : fileURLToPath(new URL("../public/data/", import.meta.url)));
const cache = new Map();
/** a data file, parsed once and kept (the catalogue is 3.5 MB, the others smaller); null when the server does not carry it */
function file(env, rel) {
  const k = dataDir(env) + rel; if (!cache.has(k)) cache.set(k, readFile(k, "utf8").then((t) => JSON.parse(t), () => null));
  return cache.get(k);
}
const sep = (ra1, dec1, ra2, dec2) => { const a = (dec2 - dec1) * D2R, b = (ra2 - ra1) * D2R, h = Math.sin(a / 2) ** 2 + Math.cos(dec1 * D2R) * Math.cos(dec2 * D2R) * Math.sin(b / 2) ** 2; return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / D2R; };
const mjdToDate = (mjd) => new Date((mjd - 40587) * 86400000).toISOString().slice(0, 10);
// HEALPix nested ang2pix and the footprint test: the same code as the site's (web/src/blink/engine.ts)
function ang2pixNest(nside, ra, dec) {
  const z = Math.sin(dec * D2R), phi = (((ra % 360) + 360) % 360) * D2R, za = Math.abs(z), tt = (phi / (Math.PI / 2)) % 4; let face, ix, iy;
  if (za <= 2 / 3) { const t1 = nside * (0.5 + tt), t2 = nside * (z * 0.75), jp = Math.floor(t1 - t2), jm = Math.floor(t1 + t2), ifp = Math.floor(jp / nside), ifm = Math.floor(jm / nside);
    face = ifp === ifm ? ifp | 4 : ifp < ifm ? ifp : ifm + 8; ix = jm & (nside - 1); iy = nside - (jp & (nside - 1)) - 1; }
  else { const ntt = Math.min(3, Math.floor(tt)), tp = tt - ntt, tmp = nside * Math.sqrt(3 * (1 - za)), jp = Math.min(Math.floor(tp * tmp), nside - 1), jm = Math.min(Math.floor((1 - tp) * tmp), nside - 1);
    if (z >= 0) { face = ntt; ix = nside - jm - 1; iy = nside - jp - 1; } else { face = ntt + 8; ix = jp; iy = jm; } }
  let ipf = 0; for (let b = 0; 1 << b < nside; b++) { ipf |= ((ix >> b) & 1) << (2 * b); ipf |= ((iy >> b) & 1) << (2 * b + 1); }
  return face * nside * nside + ipf;
}
function inFootprint(ra, dec, poly) {
  const a0 = ra * D2R, d0 = dec * D2R, pts = [];
  for (let k = 0; k < poly.length; k += 2) { const a = poly[k] * D2R, d = poly[k + 1] * D2R, c = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0); if (c <= 0) return false;
    pts.push([(Math.cos(d) * Math.sin(a - a0)) / c, (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / c]); }
  let sgn = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length], s = Math.sign(x1 * y2 - x2 * y1); if (!s) continue; if (!sgn) sgn = s; else if (s !== sgn) return false; }
  return true;
}

class Bad extends Error { constructor(msg, code = 400) { super(msg); this.code = code; } }
const num = (q, k, d, lo = -Infinity, hi = Infinity) => { const v = q.get(k); if (v === null || v === "") { if (d === undefined) throw new Bad(`missing parameter: ${k}`); return d; } const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw new Bad(`parameter ${k} must be a number${Number.isFinite(lo) ? ` between ${lo} and ${hi}` : ""}`); return n; };
const position = (q, need = true) => { if (!need && q.get("ra") === null && q.get("dec") === null) return null; return [num(q, "ra", undefined, 0, 360), num(q, "dec", undefined, -90, 90)]; };
const KNOWN = { 0: "no Gaia source", 1: "Gaia star with the same motion", 2: "Gaia source without a motion", 3: "Gaia star with another motion" };
const labUrl = (o) => `/explore/?ra=${o.ra}&dec=${o.dec}&fov=6.6${o.pmra !== undefined ? `&pmra=${o.pmra}&pmdec=${o.pmdec}&epoch=${o.yr ?? 2016}` : ""}${o.id ? `&name=${encodeURIComponent(o.id)}` : ""}`;

/** one row of the catalogue as an object; `full` adds every column */
function row(c, i, full, sc) {
  const o = { id: c.id[i], ra: c.ra[i], dec: c.dec[i], motion_arcsec_yr: c.pm[i], pmra: c.pmra[i], pmdec: c.pmdec[i], motion_error: c.epm[i], kind: c.kind[i], gaia: KNOWN[c.known[i]] ?? null, gaia_source_id: c.gaia[i] || null, gaia_motion_arcsec_yr: c.gpm[i] ?? null,
    parallax_mas: c.plx[i] ?? null, simbad: c.simbad[i] || null, galactic_latitude: c.glat[i], spherex_exposures: c.n[i] };
  if (sc) o.sky_model = { marks_it: sc.conf[i] >= sc.thr, confidence: sc.conf[i], motion_it_reads: sc.pm[i] };
  if (full) for (const k of Object.keys(c)) if (!(k in o) && !["pm", "epm", "known", "plx", "gpm", "glat", "n"].includes(k)) o[k] = c[k][i];
  o.lab = labUrl({ ra: c.ra[i], dec: c.dec[i], pmra: c.pmra[i], pmdec: c.pmdec[i], yr: c.yr[i], id: c.id[i] });
  return o;
}
const csv = (rows) => { if (!rows.length) return ""; const keys = Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== "object" || rows[0][k] === null); const esc = (v) => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n") + "\n"; };

async function catalogue(env) { const j = await file(env, "verified/objects.json"); if (!j) throw new Bad("this server does not carry the verified catalogue", 503); return j.cols; }
async function scoutOf(env) { const s = await file(env, "wm/scout.json"); return s ? { conf: s.objects.conf, pm: s.objects.pm, thr: s.threshold, marks: s.marks, sky: s.sky, test: s.test, gaia_check: s.gaia_check ?? null, vjepa: s.vjepa_finetuned ?? null, built: s.built } : null; }

async function movers(q, env) {
  const c = await catalogue(env), sc = await scoutOf(env), pos = position(q, false), radius = num(q, "radius", 1, 0, 30), lo = num(q, "min_pm", 0, 0, 100), hi = num(q, "max_pm", 1e9, 0, 1e9), limit = Math.round(num(q, "limit", 100, 1, 2000));
  const kind = (q.get("kind") ?? "").toLowerCase(), gaia = q.get("gaia") ?? "", plane = q.get("plane") === "1" || !!pos, out = [];
  if (gaia && !["absent", "listed"].includes(gaia)) throw new Bad("parameter gaia must be 'absent' or 'listed'");
  for (let i = 0; i < c.id.length; i++) {
    if (c.pm[i] < lo || c.pm[i] > hi) continue; if (kind && !String(c.kind[i]).toLowerCase().includes(kind)) continue;
    if (gaia === "absent" && c.known[i] !== 0) continue; if (gaia === "listed" && c.known[i] === 0) continue; if (!plane && Math.abs(c.glat[i]) < 10) continue;
    let d = null; if (pos) { if (Math.abs(c.dec[i] - pos[1]) > radius) continue; d = sep(pos[0], pos[1], c.ra[i], c.dec[i]); if (d > radius) continue; }
    out.push([d, i]);
  }
  out.sort((a, b) => (pos ? a[0] - b[0] : c.pm[b[1]] - c.pm[a[1]]));
  const rows = out.slice(0, limit).map(([d, i]) => { const o = row(c, i, false, sc); if (d !== null) o.separation_deg = +d.toFixed(5); return o; });
  return { table: rows, body: { query: Object.fromEntries(q), matched: out.length, returned: rows.length, note: pos ? undefined : "without a position, movers within 10 degrees of the Galactic plane are left out unless plane=1 (crowded, less reliable)", movers: rows } };
}
async function mover(id, env) { const c = await catalogue(env), i = c.id.indexOf(id); if (i < 0) throw new Bad(`no confirmed mover with id ${id}`, 404); return { body: row(c, i, true, await scoutOf(env)) }; }

async function indexOf(env, ra, dec) {
  const pix = ang2pixNest(32, ra, dec), j = await file(env, `sphx2/${pix}.json`); if (!j) throw new Bad("this server does not carry the SPHEREx exposure index", 503);
  const roots = j.roots.map((r) => { const [rel, path] = r.split("|"), [week, ver] = path.split("/"); return { rel, week, ver }; });
  return { pix, list: j.e.map(([mjd, det, ri, tail, poly, nin]) => { const { rel, week, ver } = roots[ri], [seq, k] = tail.split("_"); return { mjd, det, rel, poly, nin, id: `${week}_${seq}_${k}D${det}`, url: `${S3}${rel}/level2/${week}/${ver}/${det}/level2_${week}_${seq}_${k}D${det}_spx_${ver}.fits` }; }) };
}
async function exposures(q, env) {
  const [ra, dec] = position(q), det = q.get("detector") ? Math.round(num(q, "detector", 0, 1, 6)) : 0, a = num(q, "mjd_min", 0), b = num(q, "mjd_max", 1e9), limit = Math.round(num(q, "limit", 500, 1, 5000)), { pix, list } = await indexOf(env, ra, dec);
  const hit = list.filter((e) => (!det || e.det === det) && e.mjd >= a && e.mjd <= b && inFootprint(ra, dec, e.poly)).sort((x, y) => x.mjd - y.mjd), per = {}; hit.forEach((e) => (per[e.det] = (per[e.det] ?? 0) + 1));
  const rows = hit.slice(0, limit).map((e) => ({ id: e.id, mjd: e.mjd, date: mjdToDate(e.mjd), detector: e.det, band_um_min: BANDS[e.det][0], band_um_max: BANDS[e.det][1], release: e.rel, url: e.url }));
  return { table: rows, body: { query: { ra, dec }, healpix_nside32_nested: pix, covering: hit.length, returned: rows.length, per_detector: per,
    note: "Level-2 exposures whose footprint holds the position. Each file is about 65 MB on NASA's public bucket; a cutout is read with HTTP range requests (see the Python example in the documentation). The index keeps up to 24 exposures per detector and patch, so a field can have more than are listed.", exposures: rows } };
}
async function coverage(q, env) {
  const [ra, dec] = position(q), c = await file(env, "sphx2/coverage.json"); if (!c) throw new Bad("this server does not carry the survey coverage", 503);
  const pix = ang2pixNest(c.nside, ra, dec), days = c.visits[pix] ?? [], dates = days.map((d) => mjdToDate(c.mjd0 + d)), gaps = days.slice(1).map((d, i) => d - days[i]).filter((g) => g > 60), half = gaps.length ? gaps.sort((x, y) => x - y)[gaps.length >> 1] : 182;
  return { body: { query: { ra, dec }, healpix_nside32_nested: pix, visits: dates, n_visits: dates.length, survey: { first: c.first, last: c.last, exposures: c.exposures },
    next_visit_about: days.length ? mjdToDate(c.mjd0 + days[days.length - 1] + half) : null,
    note: "A visit is a run of exposures of this 1.8-degree patch with no gap longer than 20 days. The next visit is an estimate (the last one plus the usual interval here), not a schedule." } };
}
async function scout(q, env) {
  const s = await scoutOf(env); if (!s) throw new Bad("this server does not carry the sky model's results", 503);
  const pos = position(q, false), radius = num(q, "radius", 2, 0, 180), limit = Math.round(num(q, "limit", 50, 1, 400)), conf = q.get("gaia") ?? "";
  let L = s.marks.map((m) => ({ ra: m.ra, dec: m.dec, confidence: m.conf, motion_it_reads_arcsec_yr: m.pm, direction_deg_east_of_north: m.pa, galactic_latitude: m.glat,
    gaia_fast_mover: m.gaia ? { source_id: m.gaia.id, motion_arcsec_yr: m.gaia.pm, G: m.gaia.g } : null, simbad_fast_mover: m.simbad ? { name: m.simbad.name.replace(/\s+/g, " "), kind: m.simbad.kind, motion_arcsec_yr: m.simbad.pm, spectral_type: m.simbad.sp } : null, vjepa2_says_mover: m.vj ?? null, sky: `/explore/#sky=${encodeURIComponent(`${m.ra} ${m.dec >= 0 ? "+" : ""}${m.dec}`)}`, lab: labUrl({ ra: m.ra, dec: m.dec }) }));
  if (conf === "absent") L = L.filter((m) => !m.gaia_fast_mover); else if (conf === "listed") L = L.filter((m) => m.gaia_fast_mover); else if (conf === "open") L = L.filter((m) => !m.gaia_fast_mover && !m.simbad_fast_mover);
  if (pos) L = L.map((m) => ({ ...m, separation_deg: +sep(pos[0], pos[1], m.ra, m.dec).toFixed(4) })).filter((m) => m.separation_deg <= radius).sort((x, y) => x.separation_deg - y.separation_deg);
  return { table: L.slice(0, limit), body: { built: s.built, whole_sky: s.sky, test: { recall: s.test.recall, false_marks_per_sq_deg: s.test.false_per_sqdeg, movers_tested: s.test.n }, gaia_check: s.gaia_check, vjepa2_finetuned: s.vjepa ? { auc_test: s.vjepa.auc_test, patches: s.vjepa.patches } : null,
    note: "Marks where MIRA's catalogue has nothing. A mark is a place to look at, not a discovery: 'gaia_fast_mover' says whether ESA's Gaia DR3 lists a star moving at least 0.25 arcsec a year within 30 arcsec; 'simbad_fast_mover' the same for SIMBAD (at least 0.15), asked only where Gaia had none. gaia=open keeps the marks that are in neither.", matched: L.length, marks: L.slice(0, limit) } };
}
async function crossmatch(body, env) {
  const P = body?.positions; if (!Array.isArray(P) || !P.length) throw new Bad("body must be JSON: { positions: [{ ra, dec, id? }, ...], radius_arcsec? }"); if (P.length > 5000) throw new Bad("at most 5000 positions per call");
  const rad = Math.min(600, Math.max(1, Number(body.radius_arcsec ?? 30))) / 3600, c = await catalogue(env), s = await scoutOf(env), cov = await file(env, "sphx2/coverage.json");
  // the catalogue in one-degree declination bands, so that each position looks at a few hundred rows at most
  const bands = new Map(); for (let i = 0; i < c.id.length; i++) { const b = Math.floor(c.dec[i]); (bands.get(b) ?? bands.set(b, []).get(b)).push(i); }
  const out = P.map((p, n) => { const ra = Number(p.ra), dec = Number(p.dec); if (!Number.isFinite(ra) || !Number.isFinite(dec) || dec < -90 || dec > 90) return { id: p.id ?? n, error: "ra and dec must be numbers in degrees" };
    let best = -1, bd = rad; for (const b of [Math.floor(dec) - 1, Math.floor(dec), Math.floor(dec) + 1]) for (const i of bands.get(b) ?? []) { if (Math.abs(c.dec[i] - dec) > rad) continue; const d = sep(ra, dec, c.ra[i], c.dec[i]); if (d <= bd) { bd = d; best = i; } }
    let mark = null, md = Math.max(rad, 30 / 3600); if (s) for (const m of s.marks) { if (Math.abs(m.dec - dec) > md) continue; const d = sep(ra, dec, m.ra, m.dec); if (d <= md) { md = d; mark = m; } }
    const days = cov ? cov.visits[ang2pixNest(cov.nside, ra, dec)] ?? [] : null;
    return { id: p.id ?? n, ra, dec, confirmed_mover: best < 0 ? null : { ...row(c, best, false, s), separation_arcsec: +(bd * 3600).toFixed(2) },
      sky_model_mark: mark ? { confidence: mark.conf, motion_it_reads_arcsec_yr: mark.pm, in_gaia: !!mark.gaia, separation_arcsec: +(md * 3600).toFixed(1) } : null,
      spherex_visits: days ? days.length : null, last_visit: days && days.length ? mjdToDate(cov.mjd0 + days[days.length - 1]) : null, lab: labUrl({ ra, dec }) }; });
  return { body: { radius_arcsec: +(rad * 3600).toFixed(1), positions: P.length, with_a_confirmed_mover: out.filter((o) => o.confirmed_mover).length, with_a_sky_model_mark: out.filter((o) => o.sky_model_mark).length, results: out } };
}
async function status(env) {
  const [m, o, s] = await Promise.all([file(env, "sphx2/meta.json"), file(env, "verified/objects.json"), file(env, "wm/scout.json")]);
  return { body: { name: "MIRA data API", version: VERSION, documentation: "/docs/#api", openapi: "/api/v1/openapi.json",
    spherex: m ? { exposures_indexed: m.exposures, first: m.first, last: m.last, index_built: m.built } : null, catalogue: o ? { confirmed_movers: o.cols.id.length } : null,
    sky_model: s ? { places_marked: s.sky.marks, built: s.built } : null,
    endpoints: ["/api/v1/status", "/api/v1/targets", "/api/v1/movers", "/api/v1/movers/{id}", "/api/v1/exposures", "/api/v1/coverage", "/api/v1/scout", "POST /api/v1/crossmatch"] } };
}

const P = (name, description, extra = {}) => ({ name, in: "query", description, schema: { type: "number" }, ...extra });
const OPENAPI = { openapi: "3.0.3", info: { title: "MIRA data API", version: VERSION, description: "Read access to what MIRA measured and indexed: the verified catalogue of stars caught moving, the index of NASA SPHEREx Level-2 exposures, the survey's visit dates, and the places the sky model marked. Positions are ICRS degrees. Motions are arcseconds a year." },
  servers: [{ url: "/api/v1" }], components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "X-API-Key", description: "Only on deployments that set MIRA_API_KEYS" } } },
  paths: {
    "/status": { get: { summary: "What data this server carries", responses: { 200: { description: "Counts and dates" } } } },
    "/targets": { get: { summary: "NASA's five test targets", responses: { 200: { description: "Names, positions, links" } } } },
    "/movers": { get: { summary: "Confirmed movers: cone search and filters", parameters: [P("ra", "Right ascension, degrees (with dec: a cone search, nearest first)"), P("dec", "Declination, degrees"), P("radius", "Cone radius in degrees (default 1, at most 30)"), P("min_pm", "Smallest motion, arcsec a year"), P("max_pm", "Largest motion, arcsec a year"),
      P("kind", "Part of a kind, for example 'T dwarf', 'white dwarf'", { schema: { type: "string" } }), P("gaia", "'absent' (no Gaia source) or 'listed'", { schema: { type: "string", enum: ["absent", "listed"] } }), P("limit", "Rows returned (default 100, at most 2000)"), P("format", "'json' (default) or 'csv'", { schema: { type: "string", enum: ["json", "csv"] } })], responses: { 200: { description: "Matching movers" } } } },
    "/movers/{id}": { get: { summary: "One confirmed mover, every column", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "Catalogue id, for example 11391-389871" }], responses: { 200: { description: "The record" }, 404: { description: "No such id" } } } },
    "/exposures": { get: { summary: "SPHEREx Level-2 exposures that hold a position", parameters: [P("ra", "Right ascension, degrees", { required: true }), P("dec", "Declination, degrees", { required: true }), P("detector", "1 to 6"), P("mjd_min", "Earliest date, MJD"), P("mjd_max", "Latest date, MJD"), P("limit", "Rows returned (default 500)"), P("format", "'json' or 'csv'", { schema: { type: "string", enum: ["json", "csv"] } })], responses: { 200: { description: "Exposures with their file addresses on NASA's public bucket" } } } },
    "/coverage": { get: { summary: "When SPHEREx visited a position", parameters: [P("ra", "Right ascension, degrees", { required: true }), P("dec", "Declination, degrees", { required: true })], responses: { 200: { description: "Visit dates and an estimate of the next one" } } } },
    "/scout": { get: { summary: "Places the sky model marked where the catalogue has nothing", parameters: [P("ra", "Right ascension, degrees (optional)"), P("dec", "Declination, degrees"), P("radius", "Degrees (default 2)"), P("gaia", "'absent', 'listed', or 'open' (in neither Gaia nor SIMBAD)", { schema: { type: "string", enum: ["absent", "listed", "open"] } }), P("limit", "Rows returned (default 50, at most 400)")], responses: { 200: { description: "Marks, each with the Gaia check and V-JEPA 2's score" } } } },
    "/crossmatch": { post: { summary: "A list of positions against the catalogue, the survey and the sky model", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["positions"], properties: { positions: { type: "array", maxItems: 5000, items: { type: "object", required: ["ra", "dec"], properties: { id: { type: "string" }, ra: { type: "number" }, dec: { type: "number" } } } }, radius_arcsec: { type: "number", default: 30 } } } } } }, responses: { 200: { description: "One result per position" } } } },
  } };

const hits = new Map();
function limited(ip, env) { const now = Date.now(), L = (hits.get(ip) ?? []).filter((t) => now - t < 600000); L.push(now); hits.set(ip, L); if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 600000) hits.delete(k); return L.length > +(env.MIRA_API_PER10MIN ?? 300); }
const readBody = (req, max = 2e6) => new Promise((ok, no) => { let n = 0; const parts = []; req.on("data", (d) => { n += d.length; if (n > max) { no(new Bad("body too large", 413)); req.destroy(); } else parts.push(d); }); req.on("end", () => { try { ok(JSON.parse(Buffer.concat(parts).toString("utf8") || "{}")); } catch { no(new Bad("body is not JSON")); } }); req.on("error", no); });

export async function handleApi(req, res, env = process.env) {
  const u = new URL(req.url ?? "/", "http://x"), path = u.pathname.replace(/^\/api\/v1/, "").replace(/\/+$/, "") || "/status", q = u.searchParams;
  const send = (code, body, type = "application/json; charset=utf-8") => { res.statusCode = code; res.setHeader("Content-Type", type); res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key"); res.setHeader("Cache-Control", "no-store"); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
  try {
    if (req.method === "OPTIONS") return send(204, "");
    if (path === "/openapi.json") return send(200, OPENAPI);
    if (path === "/status") return send(200, (await status(env)).body);
    const keys = (env.MIRA_API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (keys.length && !keys.includes(String(req.headers["x-api-key"] ?? ""))) throw new Bad("this deployment asks for a key: send it in the header X-API-Key", 401);
    if (limited(String(req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "?").split(",")[0], env)) throw new Bad("too many calls in ten minutes", 429);
    let r;
    if (path === "/crossmatch") { if (req.method !== "POST") throw new Bad("POST a JSON body: { positions: [{ ra, dec }] }", 405); r = await crossmatch(await readBody(req), env); }
    else if (req.method !== "GET") throw new Bad("GET only", 405);
    else if (path === "/targets") r = { body: { targets: TARGETS.map((t) => ({ ...t, lab: `/explore/?target=${t.key}` })) } };
    else if (path === "/movers") r = await movers(q, env);
    else if (path.startsWith("/movers/")) r = await mover(decodeURIComponent(path.slice(8)), env);
    else if (path === "/exposures") r = await exposures(q, env);
    else if (path === "/coverage") r = await coverage(q, env);
    else if (path === "/scout") r = await scout(q, env);
    else throw new Bad(`no such endpoint: ${path}. See /api/v1/openapi.json`, 404);
    if (q.get("format") === "csv" && r.table) return send(200, csv(r.table), "text/csv; charset=utf-8");
    send(200, r.body);
  } catch (e) { send(e instanceof Bad ? e.code : 500, { error: e instanceof Bad ? e.message : "the server could not answer" }); if (!(e instanceof Bad)) console.error("api", e); }
}
