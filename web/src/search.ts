// ONE SEARCH — results while you type, forgiving of spelling, and a few filters for those who do not know a name.
// The index is built in the browser from what the maps already load: the Sun, Moon and planets, NASA's test targets,
// landmarks, the 17,604 confirmed movers of the verified catalogue (by name, Gaia number, MIRA number and kind),
// the named bright stars, the stars with known planets, and MIRA's own tools and pages. Nothing is sent anywhere:
// only a name that is in none of these goes to the CDS name resolver, when the visitor asks for it.
import { loadVerified, cleanName } from "./movercard";
import { CHALLENGE } from "./blink/catalogs";

export type Hit = { name: string; sub: string; kind: string; q: string; go: "find" | "space" | "page" | "tool"; score: number };
export type Filters = { kind: string; pm: number; dist: number; nogaia: boolean };
type Item = { name: string; toks: string[]; flat: string; sub: string; kind: string; q: string; go: Hit["go"]; rank: number; cat?: { kind: string; pm: number; ly: number; nogaia: boolean } };

const GREEK: Record<string, string> = { alpha: "alf", beta: "bet", gamma: "gam", delta: "del", epsilon: "eps", zeta: "zet", theta: "tet", iota: "iot", kappa: "kap", lambda: "lam", omicron: "omi", sigma: "sig", upsilon: "ups", omega: "ome",
  α: "alf", β: "bet", γ: "gam", δ: "del", ε: "eps", ζ: "zet", η: "eta", θ: "tet", ι: "iot", κ: "kap", λ: "lam", μ: "mu", ν: "nu", ξ: "ksi", ο: "omi", π: "pi", ρ: "rho", σ: "sig", τ: "tau", υ: "ups", φ: "phi", χ: "chi", ψ: "psi", ω: "ome" };
const WORDS: Record<string, string> = { centre: "center", colour: "color", colours: "color", colors: "color", stars: "star", dwarfs: "dwarf", planets: "planet", nebulae: "nebula", galaxies: "galaxy", "barnards": "barnard", moving: "mover", movers: "mover" };
/** lower case, no accents, Greek letters and their names to the three-letter form catalogues use, light stemming */
export function tokens(s: string): string[] {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/([α-ω])/g, " $1 ").replace(/['’`]/g, "").replace(/[^a-z0-9α-ω+.\-]+/g, " ").trim().split(/\s+/).filter(Boolean)
    .map((t) => GREEK[t] ?? WORDS[t] ?? t);
}
/** edit distance with a cap: how many letters apart two words are (insert, delete, replace, swap of neighbours) */
function dist(a: string, b: string, max: number): number {
  const n = a.length, m = b.length; if (Math.abs(n - m) > max) return max + 1;
  let p2: number[] = [], p1 = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) { const cur = [i]; let best = i;
    for (let j = 1; j <= m; j++) { const c = a[i - 1] === b[j - 1] ? 0 : 1; let v = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1); cur[j] = v; if (v < best) best = v; }
    if (best > max) return max + 1; p2 = p1; p1 = cur; }
  return p1[m];
}
/** how well one typed word matches one word of an entry: 0 = not at all */
function wordScore(q: string, t: string): number {
  if (q === t) return 3; if (t.startsWith(q)) return 2 + q.length / (t.length + 4);
  if (t.length >= 3 && q.startsWith(t)) return 1.4;                        // "indi" for the catalogue's "ind"
  if (q.length >= 3 && t.includes(q)) return 1;
  if (q.length >= 4 && /[a-z]/.test(q)) { const cap = q.length >= 8 ? 2 : 1, d = dist(q, t.slice(0, Math.max(q.length, Math.min(t.length, q.length + 1))), cap); if (d <= cap) return 0.75 - 0.15 * d; }
  return 0;
}

let items: Item[] = [], ready: Promise<void> | null = null;
export const KINDS: string[] = [];
const add = (name: string, sub: string, kind: string, q: string, go: Hit["go"], rank: number, extra = "", cat?: Item["cat"]) => { const toks = tokens(`${name} ${extra}`); items.push({ name, toks, flat: tokens(name).join(" "), sub, kind, q, go, rank, cat }); };
const PAGES: [string, string, string, Hit["go"], string][] = [
  ["Sky map", "The whole sky on one time bar, planets live", "#sky", "page", "map 2d all sky panorama"], ["Space map", "Fly among the nearest stars in 3D", "#space", "page", "3d universe fly solar system"],
  ["Lab", "Measure any place: motion, spectrum, brightness", "#lab", "page", "measure analyse instruments"], ["Catalogue", "17,604 confirmed movers, each re-measured", "#catalogue", "page", "table list verified movers"],
  ["Cases", "Fields you saved", "#cases", "page", "logbook saved"], ["Documentation", "How every tool works, accuracy, plans, data API", "/docs/", "page", "docs help guide manual api accuracy plans pricing"],
  ["Motion detector", "Lab tool: which sources moved or changed", "changes", "tool", "moved changed detect"], ["Astrometer", "Lab tool: proper motion, parallax, distance", "motion", "tool", "position distance parallax"],
  ["Spectrograph", "Lab tool: the 0.75–5 µm spectrum", "spectrum", "tool", "spectrum spectra wavelength methane water"], ["Photometer", "Lab tool: brightness since 1999", "light", "tool", "brightness light curve variable"],
  ["Detection limits", "Lab tool: what could still hide here", "limits", "tool", "planet x nine hide depth"], ["Exposures", "Lab tool: every exposure, with NASA's flags", "frames", "tool", "flags contamination metadata"],
  ["Export", "Lab tool: tables, FITS, link, embed, Python", "export", "tool", "download csv fits embed astropy"], ["Layers", "Lab tool: Gaia stars, WISE 2010, NASA's flags on the picture", "layers", "tool", "overlay gaia wise"],
  ["Colours", "Lab tool: six detectors, 102 wavelengths", "colours", "tool", "bands detectors coadd rgb"], ["Watchlist", "Researcher tool: measure a list of targets", "watch", "tool", "batch list targets"],
  ["Sky world model", "Researcher tool: a network's forecast of this field", "wm", "tool", "ai forecast predict neural"],
];

export function ensureIndex(base: string): Promise<void> {
  return (ready ??= (async () => {
    for (const [n, k] of [["Sun", "Star"], ["Moon", "Moon"], ["Mercury", "Planet"], ["Venus", "Planet"], ["Mars", "Planet"], ["Jupiter", "Planet"], ["Saturn", "Planet"], ["Uranus", "Planet"], ["Neptune", "Planet"]]) add(n, "where it is in the sky right now", k, n, "find", 6, "planet solar system");
    for (const t of CHALLENGE) add(t.name, t.blurb.split(/[.;]/)[0], "NASA test target", t.key, "find", 5, t.key.replace(/-/g, " "));
    add("Luhman 16", "the nearest brown dwarfs, 6.5 light-years away", "Brown dwarf pair", "Luhman 16", "find", 4, "brown dwarf nearest");
    for (const [n, x] of [["Centre of the Milky Way", "galactic center sagittarius a"], ["Large Magellanic Cloud", "lmc galaxy"], ["Small Magellanic Cloud", "smc galaxy"], ["Andromeda galaxy", "m31"], ["Orion Nebula", "m42"], ["Pleiades", "m45 seven sisters cluster"],
      ["SPHEREx deep field · north", "ecliptic pole"], ["SPHEREx deep field · south", "ecliptic pole"]]) add(n, "a landmark of the sky", "Landmark", n, "find", 4, x);
    for (const [n, sub, q, go, x] of PAGES) add(n, sub, go === "tool" ? "Tool" : "Page", q, go, 3, x);
    const [V, bright, exo] = await Promise.all([loadVerified(base) as Promise<any>, fetch(`${base}space/bright.json`).then((r) => r.json()).catch(() => null), fetch(`${base}space/exoplanets.json`).then((r) => r.json()).catch(() => null)]);
    if (V) { const seen = new Set<string>();
      for (let k = 0; k < V.id.length; k++) {
        const nm = V.simbad[k] ? cleanName(String(V.simbad[k]).replace(/\s*\(.*$/, "")) : "", name = nm || (V.gaia[k] ? `Gaia DR3 ${V.gaia[k]}` : `MIRA ${V.id[k]}`), kind = V.kind[k] as string, ly = V.plx?.[k] > 1 ? 3261.56 / V.plx[k] : NaN;
        if (!seen.has(kind)) { seen.add(kind); KINDS.push(kind); }
        add(name, `${kind} · ${V.pm[k].toFixed(2)}″ per year${Number.isFinite(ly) ? ` · ${ly.toFixed(ly < 100 ? 1 : 0)} light-years` : ""}`, "Moving star", V.id[k], "find", nm ? 2 + Math.min(1, V.pm[k] / 5) : 0.6 + Math.min(1, V.pm[k] / 5),
          `${V.id[k]} ${V.gaia[k] ?? ""} ${kind} ${V.known[k] ? "" : "unknown new"} mover`, { kind, pm: V.pm[k], ly, nogaia: !V.gaia[k] });
      }
      KINDS.sort(); }
    if (bright?.stars) for (const s of bright.stars) if (s.name) add(s.name, `bright star · ${(s.d * 3.2616).toFixed(s.d < 30 ? 1 : 0)} light-years · magnitude ${s.V}`, "Bright star", s.name, "space", 3.2, `hip ${s.hip} star`);
    if (exo?.hosts) for (const h of exo.hosts) add(h[0], `${h[6].length} known planet${h[6].length > 1 ? "s" : ""} · ${h[6][0]?.[6] ?? ""}`.replace(/ · $/, ""), "Star with planets", h[0], "space", 1.6, "exoplanet planet host");
  })());
}
export const filtering = (f: Filters) => !!(f.kind || f.pm || f.dist || f.nogaia);

export function search(q: string, f: Filters, limit = 9): { hits: Hit[]; total: number } {
  const Q = tokens(q), flatQ = Q.join(" "), filt = filtering(f), out: Hit[] = []; let total = 0;
  if (!Q.length && !filt) return { hits: [], total: 0 };
  for (const it of items) {
    if (filt) { const c = it.cat; if (!c || (f.kind && c.kind !== f.kind) || (f.pm && c.pm < f.pm) || (f.dist && !(c.ly <= f.dist)) || (f.nogaia && !c.nogaia)) continue; }
    let score = 0, ok = true;
    for (const w of Q) { let best = 0; for (const t of it.toks) { const s = wordScore(w, t); if (s > best) { best = s; if (s >= 3) break; } } if (!best) { ok = false; break; } score += best; }
    if (!ok) continue;
    if (Q.length) { score /= Q.length; if (it.flat === flatQ) score += 4; else if (it.flat.startsWith(flatQ)) score += 2; else if (it.flat.includes(flatQ)) score += 0.8; }
    else score = (it.cat?.pm ?? 0) / 3;
    total++; score += it.rank * 0.35;
    if (out.length < limit || score > out[out.length - 1].score) { out.push({ name: it.name, sub: it.sub, kind: it.kind, q: it.q, go: it.go, score }); out.sort((a, b) => b.score - a.score); if (out.length > limit) out.pop(); }
  }
  return { hits: out, total };
}
