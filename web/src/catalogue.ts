// CATALOGUE — the verified survey. Every row is a survey-level claim of motion (16 years of WISE) that was re-measured
// on raw SPHEREx exposures and passed; the page says how many did not. A table you can filter and sort, a reduced
// proper-motion diagram and a sky chart of the same rows, and for the selected object the numbers behind the verdict
// and a button that runs the Lab on it.
import { sexa } from "./data";
import { plot, type Series } from "./blink/plots";

type Cols = { id: string[]; ra: number[]; dec: number[]; pm: number[]; pmra: number[]; pmdec: number[]; epm: number[]; conf: number[]; snr: number[]; J: (number | null)[]; H: (number | null)[]; K: (number | null)[];
  W1: (number | null)[]; W2: (number | null)[]; w12: (number | null)[]; ch4: (number | null)[]; w2_wise: (number | null)[]; known: number[]; gaia: string[]; G: (number | null)[]; gpm: (number | null)[]; plx: (number | null)[];
  kind: string[]; glat: number[]; dp: number[]; ds: number[]; yr: number[]; wpm: number[]; n: number[]; simbad: string[]; slow: number[]; methane: number[] };
type Meta = { built: string; remeasured: number; claims: Record<string, number>; funnel: Record<string, Record<string, number>>; confirmed_movers: number; movers_known: number; movers_gaia_other: number; movers_gaia_nopm: number; movers_no_gaia: number; kinds: Record<string, number>; cone_checked: number;
  high_latitude?: { n: number; known: number; gaia_other: number; gaia_nopm: number; no_gaia: number; plane_n: number; plane_known: number } };
type Change = { id: string; ra: number; dec: number; allwise: string; w1_2010: number; w2_2010: number; w1_now: number; w2_now: number; r1: number; r2: number; k_1999: number | null; k_now: number | null; verdict: string; simbad?: string };
export type CatCtx = { /** show an object, by survey id, on the map */ onMap?: (id: string) => void; onObserve: (t: { ra: number; dec: number; pmra?: number; pmdec?: number; epoch?: number; name?: string }) => void; toast?: (m: string) => void };
type Filter = "all" | "nogaia" | "red" | "methane" | "wd" | "fast" | "changes";
const FILTERS: [Filter, string, string][] = [["all", "All confirmed movers", "Every motion claim that passed the raw-exposure test"], ["nogaia", "No Gaia motion", "Confirmed movers with no matching proper motion in Gaia DR3: too red or too faint for Gaia, or missed"],
  ["red", "Red (W1−W2 > 0.6)", "Brighter at 4.6 µm than at 3.4 µm: the colour of cold brown dwarfs"], ["methane", "Methane dip", "3.3 µm flux below 60% of the 4.0 µm flux, measured on the raw exposures"], ["wd", "White dwarfs", "Faint for their Gaia colour"],
  ["fast", "Faster than 1″/yr", ""], ["changes", "Brightness changed", "Sources whose brightness today differs from AllWISE 2010 by more than 50% in both WISE bands"]];
const KIND_COLOR: Record<string, string> = { "M dwarf": "#ff9d4d", "late M or L dwarf": "#ff7a3d", "K dwarf": "#f0d35b", "F/G star": "#f0f0fa", "white dwarf": "#6ea8ff", subdwarf: "#b9c4ff", "L dwarf": "#ff7ad9", "T dwarf": "#ff5d6c", "Y dwarf": "#c9a4ff",
  "brown dwarf": "#ff7ad9", "methane dwarf": "#ff5d6c", "red: brown dwarf?": "#e58cff", "cool dwarf?": "#74dd8f", unclassified: "#8a8a96" };
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
const nf = (n: number) => n.toLocaleString("en-US");
const w2mag = (mjy: number) => -2.5 * Math.log10(mjy / 171787);
const PAGE = 40;

export function mountCatalogue(host: HTMLElement, ctx: CatCtx) {
  const BASE = import.meta.env.BASE_URL;
  host.innerHTML = `<div class="ct">
    <header class="ct-head"><div><div class="eyebrow">Catalogue · survey claims re-measured on raw SPHEREx exposures</div><h1 class="display">What moved, verified.</h1></div><div class="ct-funnel" id="ct-funnel"></div></header>
    <div class="ct-body">
      <section class="ct-list">
        <div class="ct-filters" id="ct-filters" title="Properties combine: a row must have every one that is switched on">${FILTERS.map(([k, t, tip]) => `<button data-f="${k}" title="${esc(tip)}">${t}<i></i></button>`).join("")}</div>
        <div class="ct-bar"><label>Motion from <input id="ct-min" type="number" min="0" step="0.1" value="" placeholder="0.15"> to <input id="ct-max" type="number" min="0" step="0.1" value="" placeholder="any"> ″/yr</label>
          <input id="ct-q" type="search" placeholder="Find an identifier (census, Gaia, SIMBAD name)" spellcheck="false"><span class="mono" id="ct-count"></span><button class="link" id="ct-csv">CSV</button></div>
        <label class="ct-plane" title="Within 10° of the plane of the Milky Way several stars share one SPHEREx pixel: fewer than half of the motions that pass the test there match Gaia, against 88% elsewhere"><input type="checkbox" id="ct-plane"> include the crowded Galactic plane <span id="ct-planen"></span></label>
        <div class="ct-tw"><table class="ct-table" id="ct-table"></table></div>
        <div class="ct-pager" id="ct-pager"></div>
      </section>
      <aside class="ct-side">
        <div class="ct-obj" id="ct-obj"></div>
        <div class="ct-tabs"><button data-v="rpm" class="on" title="Reduced proper motion against colour: separates nearby cold objects from distant stars">Diagram</button><button data-v="sky" title="Where the rows of the table are on the sky">Sky chart</button></div>
        <div class="ct-view" id="ct-view"></div>
      </aside>
    </div></div>`;
  const $ = <T extends HTMLElement>(s: string) => host.querySelector(s) as T;
  let C: Cols | null = null, meta: Meta | null = null, changes: Change[] = [];
  let plane = false;
  let rows: number[] = [], sel = -1, page = 0, filter: "all" | "changes" = "all", sortKey: keyof Cols = "conf", sortDir = -1, view: "rpm" | "sky" = "rpm", q = "", minPm = NaN, maxPm = NaN, selChange: Change | null = null;

  /** properties a row must have, all of them (the chips above the table combine) */
  const props = new Set<Filter>();
  const pass = (i: number): boolean => {
    const c = C!;
    if (!plane && Math.abs(c.glat[i]) < 10 && !q) return false;
    if (props.has("nogaia") && c.known[i] === 1) return false;
    if (props.has("red") && !((c.w12[i] ?? -9) > 0.6)) return false;
    if (props.has("methane") && !c.methane[i]) return false;
    if (props.has("wd") && c.kind[i] !== "white dwarf") return false;
    if (props.has("fast") && !(c.pm[i] >= 1)) return false;
    if (isFinite(minPm) && c.pm[i] < minPm) return false; if (isFinite(maxPm) && c.pm[i] > maxPm) return false;
    if (q && !(c.id[i].includes(q) || c.gaia[i].includes(q) || c.simbad[i].toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  };
  function apply(keepSel = false) {
    if (!C) return;
    rows = []; for (let i = 0; i < C.id.length; i++) if (pass(i)) rows.push(i);
    const k = C[sortKey] as (number | string | null)[];
    rows.sort((a, b) => { const x = k[a], y = k[b]; if (x === y) return 0; if (x === null || x === "") return 1; if (y === null || y === "") return -1; return (x < y ? -1 : 1) * sortDir; });
    if (!keepSel || !rows.includes(sel)) sel = rows[0] ?? -1; page = keepSel ? Math.max(0, Math.floor(rows.indexOf(sel) / PAGE)) : 0;
    render();
  }
  const knownTxt = (i: number) => (C!.known[i] === 1 ? `Gaia DR3 ${C!.gaia[i]}` : C!.known[i] === 2 ? "Gaia star nearby, different motion" : C!.known[i] === 3 ? "Gaia source without a measured motion" : "no Gaia source");
  const COLS: { k: keyof Cols; t: string; tip: string; f: (i: number) => string; cls?: string }[] = [
    { k: "pm", t: "motion ″/yr", tip: "Proper motion from the census position (2016) to the SPHEREx position (2025–26)", f: (i) => `${C!.pm[i].toFixed(C!.pm[i] < 1 ? 3 : 2)} <small>± ${C!.epm[i].toFixed(3)}</small>`, cls: "num" },
    { k: "conf", t: "checked σ", tip: "How strongly the raw exposures exclude “it did not move”: distance of the SPHEREx position from the never-moved position, in units of its error", f: (i) => C!.conf[i].toFixed(0), cls: "num" },
    { k: "kind", t: "kind", tip: "From Gaia colour and absolute magnitude when Gaia has the star; otherwise from the SPHEREx colours", f: (i) => `<i class="dot" style="background:${KIND_COLOR[C!.kind[i]] ?? "#888"}"></i>${esc(C!.kind[i])}` },
    { k: "known", t: "known?", tip: "Is this motion already in ESA's Gaia DR3 catalogue?", f: (i) => (C!.known[i] === 1 ? `Gaia <small>G ${C!.G[i]?.toFixed(1) ?? "–"}</small>` : `<b class="hl">${C!.known[i] === 0 ? "no Gaia source" : C!.known[i] === 3 ? "no Gaia motion" : "Gaia differs"}</b>`) },
    { k: "W2", t: "4.6 µm mJy", tip: "Brightness on the raw SPHEREx exposures at 4.1–5.0 µm", f: (i) => C!.W2[i]?.toPrecision(3) ?? "–", cls: "num" },
    { k: "w12", t: "W1−W2", tip: "Colour between 3.4 and 4.6 µm in magnitudes: above 0.6 means cold", f: (i) => C!.w12[i]?.toFixed(2) ?? "–", cls: "num" },
    { k: "simbad", t: "name in SIMBAD", tip: "Identification in the SIMBAD database, when one lies at the position", f: (i) => esc(C!.simbad[i].replace(/^NAME /, "")) || "–", cls: "nm" }];
  function render() {
    if (!C || !meta) return;
    host.querySelectorAll<HTMLElement>("#ct-filters button").forEach((b) => { const f = b.dataset.f as Filter; b.classList.toggle("on", f === "all" ? filter === "all" && !props.size : f === "changes" ? filter === "changes" : filter === "all" && props.has(f)); });
    const ch = filter === "changes";
    $("#ct-count").textContent = ch ? `${changes.length} sources` : `${nf(rows.length)} rows`;
    const tb = $("#ct-table");
    if (ch) {
      tb.innerHTML = `<thead><tr><th>source</th><th>3.4 µm: 2010 → now (mJy)</th><th>4.6 µm: 2010 → now (mJy)</th><th>now ÷ 2010</th><th>name in SIMBAD</th></tr></thead><tbody>${changes.map((r, k) => `<tr data-c="${k}" class="${selChange === r ? "cur" : ""}">
        <td><em class="tag ${r.verdict === "brighter" ? "pos" : "warn"}">${r.verdict}</em> <small>${esc(r.allwise)}</small></td><td class="num">${r.w1_2010.toPrecision(3)} → ${r.w1_now.toPrecision(3)}</td><td class="num">${r.w2_2010.toPrecision(3)} → ${r.w2_now.toPrecision(3)}</td>
        <td class="num">${r.r2.toFixed(r.r2 < 10 ? 1 : 0)}×</td><td class="nm">${esc((r.simbad ?? "").replace(/^NAME /, "")) || "–"}</td></tr>`).join("")}</tbody>`;
      tb.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((tr) => (tr.onclick = () => { selChange = changes[+tr.dataset.c!]; render(); }));
      $("#ct-pager").innerHTML = `<span class="mono">AllWISE 2010 against SPHEREx 2025–26, both WISE bands, isolated sources only</span>`;
    } else {
      const P = rows.slice(page * PAGE, page * PAGE + PAGE);
      tb.innerHTML = `<thead><tr><th>#</th>${COLS.map((c) => `<th data-k="${c.k}" title="${esc(c.tip)}" class="${sortKey === c.k ? (sortDir < 0 ? "desc" : "asc") : ""}">${c.t}</th>`).join("")}</tr></thead>
        <tbody>${P.map((i, k) => `<tr data-i="${i}" class="${i === sel ? "cur" : ""}"><td class="num dim">${page * PAGE + k + 1}</td>${COLS.map((c) => `<td class="${c.cls ?? ""}">${c.f(i)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="8" class="dim">No object passes these filters.</td></tr>`}</tbody>`;
      tb.querySelectorAll<HTMLElement>("th[data-k]").forEach((th) => (th.onclick = () => { const k = th.dataset.k as keyof Cols; if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === "kind" || k === "simbad" ? 1 : -1; } apply(true); }));
      tb.querySelectorAll<HTMLTableRowElement>("tbody tr[data-i]").forEach((tr) => (tr.onclick = () => { sel = +tr.dataset.i!; render(); }));
      const np = Math.max(1, Math.ceil(rows.length / PAGE));
      $("#ct-pager").innerHTML = `<button class="link" id="ct-prev" ${page ? "" : "disabled"}>‹ previous</button><span class="mono">page ${page + 1} of ${nf(np)}</span><button class="link" id="ct-next" ${page < np - 1 ? "" : "disabled"}>next ›</button>`;
      ($("#ct-prev") as HTMLButtonElement).onclick = () => { page = Math.max(0, page - 1); sel = rows[page * PAGE]; render(); };
      ($("#ct-next") as HTMLButtonElement).onclick = () => { page = Math.min(np - 1, page + 1); sel = rows[page * PAGE]; render(); };
    }
    renderObject(); renderView();
  }
  /** the numbers behind one row, in sentences, and the way into the Lab */
  function renderObject() {
    const el = $("#ct-obj"), c = C!;
    if (filter === "changes") {
      const r = selChange ?? changes[0]; if (!r) { el.innerHTML = `<p class="dim">No verified brightness change.</p>`; return; }
      el.innerHTML = `<div class="eyebrow">${esc(r.allwise ? `WISEA ${r.allwise}` : r.id)}</div><h2>${r.verdict === "brighter" ? `${r.r2.toFixed(1)} times brighter than in 2010` : `${Math.round((1 - r.r2) * 100)}% fainter than in 2010`}</h2>
        <p class="mono">${sexa(r.ra, r.dec)}</p>
        <p>At 4.6 µm WISE measured <b>${r.w2_2010.toPrecision(3)} mJy</b> in 2010; the SPHEREx exposures of 2025–26 give <b>${r.w2_now.toPrecision(3)} mJy</b>. At 3.4 µm: ${r.w1_2010.toPrecision(3)} → ${r.w1_now.toPrecision(3)} mJy.${r.k_1999 && r.k_now ? ` At 2.2 µm, 2MASS (~1999) ${r.k_1999.toPrecision(3)} → ${r.k_now.toPrecision(3)} mJy.` : ""} ${r.simbad ? `SIMBAD lists it as <b>${esc(r.simbad.replace(/^NAME /, ""))}</b>.` : "SIMBAD has no object at this position."}</p>
        <div class="ct-act"><button class="btn sm" id="ct-open">Measure it in the Lab</button><a class="btn sm ghost" target="_blank" rel="noopener" href="https://simbad.cfa.harvard.edu/simbad/sim-coo?Coord=${r.ra}+${r.dec}&Radius=20&Radius.unit=arcsec">SIMBAD ↗</a></div>`;
      ($("#ct-open") as HTMLElement).onclick = () => ctx.onObserve({ ra: r.ra, dec: r.dec, name: r.allwise ? `WISEA ${r.allwise}` : undefined });
      return;
    }
    const i = sel; if (i < 0) { el.innerHTML = `<p class="dim">Select a row.</p>`; return; }
    const dist = c.plx[i] && c.plx[i]! > 2 ? `${(3261.56 / c.plx[i]!).toFixed(c.plx[i]! > 50 ? 1 : 0)} light-years away (Gaia parallax)` : "";
    const dirs = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"], dir = dirs[Math.round((((Math.atan2(c.pmra[i], c.pmdec[i]) * 180) / Math.PI + 360) % 360) / 45) % 8];
    el.innerHTML = `<div class="eyebrow">census ${esc(c.id[i])} · ${esc(c.kind[i])}${dist ? ` · ${dist}` : ""}</div>
      <h2>${c.simbad[i] ? esc(c.simbad[i].replace(/^NAME /, "").replace(/ \(.*$/, "")) : c.known[i] === 1 ? `Gaia DR3 ${c.gaia[i]}` : "Not in Gaia"}</h2>
      <p class="mono">${sexa(c.ra[i], c.dec[i])} <small>(${c.yr[i].toFixed(1)})</small></p>
      <p><b>Moves ${c.pm[i].toFixed(c.pm[i] < 1 ? 3 : 2)}″ per year</b> toward ${dir}. The WISE years (2010–2020) predicted where it would be in ${c.yr[i].toFixed(0)}; on ${c.n[i]} raw SPHEREx exposures it sits <b>${c.dp[i].toFixed(1)}″</b> from that place and <b>${c.ds[i].toFixed(1)}″</b> from where it would be had it not moved (${c.conf[i].toFixed(0)}σ).
        ${c.known[i] === 1 ? `Gaia lists the same star with ${c.gpm[i]?.toFixed(3)}″ per year: the two agree.` : c.known[i] === 2 ? `A Gaia star lies within 4″ but with a different motion (${c.gpm[i]?.toFixed(3)}″ per year).` : c.known[i] === 3 ? "Gaia has a source here but measured no motion for it." : "<b class=\"hl\">Gaia DR3 has no source here.</b>"}
        ${c.methane[i] ? ` Its 3.3 µm flux is ${Math.round((1 - (c.ch4[i] ?? 0)) * 100)}% below the 4.0 µm flux: methane.` : ""}</p>
      <div class="ct-sed" id="ct-sed"></div>
      <div class="ct-act"><button class="btn sm" id="ct-map" title="Fly to this object on the map and see it move in two real pictures">See it on the map</button><button class="btn sm ghost" id="ct-open" title="Read the SPHEREx exposures of this object now and run every instrument on it">Deep analysis in the Lab</button>
        <a class="btn sm ghost" target="_blank" rel="noopener" href="https://simbad.cfa.harvard.edu/simbad/sim-coo?Coord=${c.ra[i]}+${c.dec[i]}&Radius=20&Radius.unit=arcsec">SIMBAD ↗</a></div>`;
    ($("#ct-map") as HTMLElement).onclick = () => ctx.onMap?.(c.id[i]);
    ($("#ct-open") as HTMLElement).onclick = () => ctx.onObserve({ ra: c.ra[i], dec: c.dec[i], pmra: c.pmra[i], pmdec: c.pmdec[i], epoch: c.yr[i], name: c.simbad[i] ? c.simbad[i].replace(/^NAME /, "").replace(/ \(.*$/, "") : c.known[i] === 1 ? `Gaia DR3 ${c.gaia[i]}` : `MIRA ${c.id[i]}` });
    const pts = ([[1.25, c.J[i]], [1.65, c.H[i]], [2.15, c.K[i]], [3.35, c.W1[i]], [4.6, c.W2[i]]] as [number, number | null][]).filter((p) => p[1] !== null && p[1]! > 0) as [number, number][];
    if (pts.length >= 2) { const lo = Math.min(...pts.map((p) => p[1])) / 2, hi = Math.max(...pts.map((p) => p[1])) * 2;
      plot($("#ct-sed"), { h: 190, x: { lo: 0.9, hi: 5.2, label: "Wavelength (µm)", ticks: [1, 2, 3, 4, 5] }, y: { lo, hi, label: "Flux (mJy)", log: true }, series: [{ color: "#f0f0fa", line: true, size: 3.4, pts: pts.map(([x, y]) => ({ x, y })) }] }); }
  }
  function renderView() {
    const el = $("#ct-view"), c = C!;
    // the diagram is about motion: for the brightness changes only the sky chart applies
    const hadView = view; if (filter === "changes") view = "sky";
    host.querySelectorAll<HTMLElement>(".ct-tabs button").forEach((b) => { b.classList.toggle("on", b.dataset.v === view); b.style.display = filter === "changes" && b.dataset.v === "rpm" ? "none" : ""; });
    const list = filter === "changes" ? [] : rows;
    if (view === "rpm") {
      // reduced proper motion: brightness scaled by motion stands in for absolute brightness, so nearby faint objects
      // (white dwarfs, brown dwarfs) fall below the main run of stars
      const kinds = Object.keys(KIND_COLOR), step = Math.max(1, Math.floor(list.length / 2500));
      const series: Series[] = kinds.map((kd) => ({ name: kd, color: KIND_COLOR[kd], size: 1.9, pts: list.filter((i, q) => c.kind[i] === kd && (q % step === 0 || i === sel) && c.W2[i] && c.W2[i]! > 0 && c.w12[i] !== null)
        .map((i) => ({ x: c.w12[i]!, y: w2mag(c.W2[i]!) + 5 * Math.log10(c.pm[i]) + 5, k: i })) })).filter((s2) => s2.pts.length);
      if (sel >= 0 && c.W2[sel] && c.w12[sel] !== null) series.push({ name: "selected", color: "#fff", shape: "square", hollow: true, size: 6, pts: [{ x: c.w12[sel]!, y: w2mag(c.W2[sel]!) + 5 * Math.log10(c.pm[sel]) + 5 }] });
      el.innerHTML = `<div id="ct-rpm"></div><p class="ct-note">Each point is a row of the table${step > 1 ? ` (1 in ${step} drawn)` : ""}. Left to right: redder between 3.4 and 4.6 µm, that is colder. Top to bottom: fainter for its motion, that is intrinsically fainter. Cold brown dwarfs sit at the right; white dwarfs low on the left. Click a point to select it.</p>`;
      plot($("#ct-rpm"), { h: 400, x: { lo: -0.6, hi: 3.2, label: "Colour W1 − W2 (mag)" }, y: { lo: 6, hi: 24, label: "Reduced proper motion H(W2) = W2 + 5 log μ + 5", invert: true, ticks: [8, 12, 16, 20, 24] }, series, vlines: [{ x: 0.6, label: "colder →" }] },
        { pick: (k) => { sel = k; if (!rows.includes(k)) { filter = "all"; props.clear(); apply(true); } else { page = Math.floor(rows.indexOf(k) / PAGE); render(); } } });
    } else {
      el.innerHTML = `<canvas id="ct-sky" width="1120" height="600"></canvas><p class="ct-note" id="ct-skynote">All-sky chart in equatorial coordinates (right ascension increases to the left); the dotted line is the plane of the Milky Way. Click a point to select it, or anywhere else to measure that field in the Lab.</p>`;
      const cvs = $("#ct-sky") as HTMLCanvasElement, g = cvs.getContext("2d")!, W = cvs.width, H = cvs.height, sx = (W - 40) / (4 * Math.SQRT2), sy = (H - 40) / (2 * Math.SQRT2), S = Math.min(sx, sy);
      const proj = (ra: number, dec: number): [number, number] => { let l = ((ra - 180 + 540) % 360) - 180; l = (-l * Math.PI) / 180; const p = (dec * Math.PI) / 180, z = Math.sqrt(1 + Math.cos(p) * Math.cos(l / 2));
        return [W / 2 + (S * 2 * Math.SQRT2 * Math.cos(p) * Math.sin(l / 2)) / z, H / 2 - (S * Math.SQRT2 * Math.sin(p)) / z]; };
      const inv = (px: number, py: number): [number, number] | null => { const x = (px - W / 2) / S, y = -(py - H / 2) / S, zz = 1 - (x / 4) ** 2 - (y / 2) ** 2; if (zz < 0.5) return null; const z = Math.sqrt(zz);
        const l = 2 * Math.atan2(z * x, 2 * (2 * zz - 1)), p = Math.asin(z * y); return [(((180 - (l * 180) / Math.PI) % 360) + 360) % 360, (p * 180) / Math.PI]; };
      g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.strokeStyle = "rgba(240,240,250,.16)"; g.lineWidth = 1; g.font = '11px "JetBrains Mono", monospace'; g.fillStyle = "rgba(240,240,250,.6)";
      for (let d = -60; d <= 60; d += 30) { g.beginPath(); for (let r = 0; r <= 360; r += 3) { const [x, y] = proj(r === 360 ? 359.999 : r === 0 ? 0.001 : r, d); if (r) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); const [x, y] = proj(359.9, d); g.fillText(`${d > 0 ? "+" : ""}${d}°`, x + 6, y + 4); }
      for (let r = 0; r < 360; r += 30) { g.beginPath(); for (let d = -90; d <= 90; d += 3) { const [x, y] = proj(r === 0 ? 0.001 : r, d); if (d > -90) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); if (r % 90 === 0) { const [x, y] = proj(r === 0 ? 0.5 : r, 0); g.fillText(`${r / 15}h`, x + 4, y - 5); } }
      g.beginPath(); for (let r = 0; r <= 360; r += 2) { const [x, y] = proj(r === 0 ? 0.001 : r === 360 ? 359.999 : r, 90); if (r) g.lineTo(x, y); } g.strokeStyle = "rgba(240,240,250,.45)";
      g.beginPath(); for (let k = 0; k <= 180; k++) { const [x, y] = proj(0.001, -90 + k); if (k) g.lineTo(x, y); else g.moveTo(x, y); } for (let k = 0; k <= 180; k++) { const [x, y] = proj(359.999, 90 - k); g.lineTo(x, y); } g.closePath(); g.stroke();
      // Galactic plane (b = 0), from the standard rotation: pole at RA 192.85948, Dec +27.12825, node at l = 122.93192
      g.fillStyle = "rgba(240,240,250,.5)"; for (let l = 0; l < 360; l += 1.5) { const lr = ((122.93192 - l) * Math.PI) / 180, dp = (27.12825 * Math.PI) / 180, dec = Math.asin(Math.cos(dp) * Math.cos(lr)), ra = 192.85948 + (Math.atan2(Math.sin(lr), -Math.sin(dp) * Math.cos(lr)) * 180) / Math.PI;
        const [x, y] = proj(((ra % 360) + 360) % 360, (dec * 180) / Math.PI); g.fillRect(x, y, 1.5, 1.5); }
      const pos: [number, number, number][] = [];
      if (filter === "changes") changes.forEach((r, k) => { const [x, y] = proj(r.ra, r.dec); pos.push([x, y, -1 - k]); g.fillStyle = r.verdict === "brighter" ? "#7df0a6" : "#ffc857"; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); });
      else for (const i of list) { const [x, y] = proj(c.ra[i], c.dec[i]); pos.push([x, y, i]); g.fillStyle = KIND_COLOR[c.kind[i]] ?? "#888"; g.globalAlpha = list.length > 4000 ? 0.55 : 0.9; g.fillRect(x - 1, y - 1, list.length > 4000 ? 2 : 3, list.length > 4000 ? 2 : 3); }
      g.globalAlpha = 1;
      if (sel >= 0 && filter !== "changes") { const [x, y] = proj(c.ra[sel], c.dec[sel]); g.strokeStyle = "#fff"; g.lineWidth = 2; g.strokeRect(x - 7, y - 7, 14, 14); }
      cvs.onclick = (e) => { const r = cvs.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H; let best = -9999, bd = 9;
        for (const [x, y, i] of pos) { const d2 = Math.hypot(x - px, y - py); if (d2 < bd) { bd = d2; best = i; } }
        if (best >= 0) { sel = best; page = Math.floor(rows.indexOf(best) / PAGE); render(); return; }
        if (best <= -1 && best > -9999) { selChange = changes[-1 - best]; render(); return; }
        const sk = inv(px, py); if (!sk) return;
        $("#ct-skynote").innerHTML = `Position <b class="mono">${sexa(sk[0], sk[1])}</b> · <button class="link" id="ct-here">measure this field in the Lab</button>`;
        ($("#ct-here") as HTMLElement).onclick = () => ctx.onObserve({ ra: sk[0], dec: sk[1] }); };
    }
    view = hadView;
  }
  function renderFunnel() {
    const m = meta!, f = m.funnel.motion_fast, b = m.funnel.brightness_checked, me = m.funnel.methane, h = m.high_latitude;
    const step = (n: string, t: string, cls = "") => `<div class="${cls}"><b>${n}</b><span>${t}</span></div>`;
    $("#ct-funnel").innerHTML = [step("39.9 billion", "WISE detections, 2010–2020, linked into objects"), step(nf(m.claims.total), "survey-level claims of motion or change"), step(nf(m.remeasured), "re-measured on raw SPHEREx exposures"),
      step(nf(m.confirmed_movers), `motions pass the test · ${nf(f.undetected + f.elsewhere)} of ${nf(f.tested)} fast claims were not there`, "ok"),
      ...(h ? [step(nf(h.n), "of them away from the crowded Galactic plane", "ok"), step(`${nf(h.known)} · ${Math.round((100 * h.known) / h.n)}%`, "are known Gaia stars with the same motion", "ok"), step(nf(h.n - h.known), "have no matching motion in Gaia", "hl")]
        : [step(nf(m.movers_known), "are known Gaia stars with the same motion", "ok"), step(nf(m.confirmed_movers - m.movers_known), "have no matching motion in Gaia", "hl")]),
      step(`${me?.confirmed ?? 0} · ${b ? b.brighter + b.fainter : 0}`, "methane dips · real brightness changes", "hl")].join(`<i>→</i>`);
    $("#ct-planen").textContent = h ? `(${nf(h.plane_n)} rows, ${Math.round((100 * h.plane_known) / Math.max(1, h.plane_n))}% match Gaia)` : "";
    counts();
  }
  function counts() {
    host.querySelectorAll<HTMLElement>("#ct-filters button").forEach((bt) => { const k = bt.dataset.f as Filter, c = C!; let n = 0;
      if (k === "changes") n = changes.length; else for (let i = 0; i < c.id.length; i++) { if (!plane && Math.abs(c.glat[i]) < 10) continue;
        if (k === "all" || (k === "nogaia" && c.known[i] !== 1) || (k === "red" && (c.w12[i] ?? -9) > 0.6) || (k === "methane" && c.methane[i]) || (k === "wd" && c.kind[i] === "white dwarf") || (k === "fast" && c.pm[i] >= 1)) n++; }
      (bt.querySelector("i") as HTMLElement).textContent = nf(n); });
  }
  // ---- events
  host.querySelectorAll<HTMLButtonElement>("#ct-filters button").forEach((b) => (b.onclick = () => { const f = b.dataset.f as Filter; selChange = null;
    if (f === "all" || f === "changes") { filter = f; props.clear(); } else { filter = "all"; if (props.has(f)) props.delete(f); else props.add(f); }
    apply(); }));
  host.querySelectorAll<HTMLButtonElement>(".ct-tabs button").forEach((b) => (b.onclick = () => { view = b.dataset.v as "rpm" | "sky"; renderView(); }));
  ($("#ct-min") as HTMLInputElement).oninput = (e) => { minPm = parseFloat((e.target as HTMLInputElement).value); apply(); };
  ($("#ct-max") as HTMLInputElement).oninput = (e) => { maxPm = parseFloat((e.target as HTMLInputElement).value); apply(); };
  ($("#ct-q") as HTMLInputElement).oninput = (e) => { q = (e.target as HTMLInputElement).value.trim(); apply(); };
  ($("#ct-plane") as HTMLInputElement).onchange = (e) => { plane = (e.target as HTMLInputElement).checked; counts(); apply(); };
  $("#ct-csv").onclick = () => { if (!C) return; const c = C, head = ["census_id", "ra_deg", "dec_deg", "epoch", "pm_arcsec_yr", "pmra", "pmdec", "pm_err", "confirmation_sigma", "kind", "gaia_dr3", "gaia_status", "galactic_latitude_deg", "G", "plx_mas", "J_mJy", "H_mJy", "K_mJy", "W1_mJy", "W2_mJy", "W1_W2_mag", "ch4_ratio", "simbad"];
    const body = rows.map((i) => [c.id[i], c.ra[i], c.dec[i], c.yr[i], c.pm[i], c.pmra[i], c.pmdec[i], c.epm[i], c.conf[i], c.kind[i], c.gaia[i], c.known[i], c.glat[i], c.G[i] ?? "", c.plx[i] ?? "", c.J[i] ?? "", c.H[i] ?? "", c.K[i] ?? "", c.W1[i] ?? "", c.W2[i] ?? "", c.w12[i] ?? "", c.ch4[i] ?? "", `"${c.simbad[i]}"`].join(","));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([`# MIRA verified catalogue · built ${meta?.built} · gaia_status: 1 same motion, 2 different motion, 3 no Gaia motion, 0 no Gaia source\n${head.join(",")}\n${body.join("\n")}\n`], { type: "text/csv" })); a.download = `mira_verified_${filter}.csv`; a.click(); };
  // ---- data
  const get = (f: string) => fetch(`${BASE}data/verified/${f}`).then((r) => (r.ok && !(r.headers.get("content-type") ?? "").includes("html") ? r.json() : null)).catch(() => null);
  $("#ct-table").innerHTML = `<tbody><tr><td class="dim">Loading the verified catalogue…</td></tr></tbody>`;
  const ready = Promise.all([get("objects.json"), get("meta.json"), get("changes.json")]).then(([o, m, ch]) => {
    if (!o || !m) { $("#ct-table").innerHTML = `<tbody><tr><td class="dim">The verified catalogue is not installed on this server (data/verified).</td></tr></tbody>`; return; }
    C = o.cols as Cols; meta = m as Meta; changes = (ch?.rows ?? []) as Change[]; renderFunnel(); apply();
  });

  return {
    ready,
    /** what the page shows, for the assistant */
    context() {
      if (!C || !meta) return { loaded: false };
      const c = C, row = (i: number) => ({ id: c.id[i], ra: c.ra[i], dec: c.dec[i], motion_arcsec_yr: c.pm[i], confirmation_sigma: c.conf[i], kind: c.kind[i], gaia: c.known[i] === 1 ? `Gaia DR3 ${c.gaia[i]}` : knownTxt(i), w1_w2: c.w12[i], flux_4p6um_mJy: c.W2[i], methane_ratio: c.ch4[i], simbad: c.simbad[i] || null });
      return { loaded: true, galactic_plane_included: plane, filters: filter === "changes" ? ["changes"] : props.size ? [...props] : ["all"], sort: `${String(sortKey)} ${sortDir < 0 ? "descending" : "ascending"}`, motion_range: [isFinite(minPm) ? minPm : null, isFinite(maxPm) ? maxPm : null], matching: filter === "changes" ? changes.length : rows.length, total: c.id.length,
        funnel: { claims: meta.claims.total, remeasured: meta.remeasured, passed_position_test: meta.confirmed_movers, away_from_galactic_plane: meta.high_latitude?.n, of_those_known_gaia_same_motion: meta.high_latitude?.known, of_those_no_matching_gaia_motion: meta.high_latitude ? meta.high_latitude.n - meta.high_latitude.known : null, methane: meta.funnel.methane?.confirmed, brightness_changes: changes.length },
        top_rows: filter === "changes" ? changes.slice(0, 12) : rows.slice(page * PAGE, page * PAGE + 12).map(row), selected: filter === "changes" ? selChange : sel >= 0 ? row(sel) : null };
    },
    /** let the assistant drive the table */
    act(a: { filter?: string; filters?: string[]; include_plane?: boolean; min_motion?: number | null; max_motion?: number | null; search?: string; sort?: string; descending?: boolean; select?: string; view?: string; open?: boolean }) {
      if (!C) return "catalogue still loading";
      const want = (Array.isArray(a.filters) ? a.filters : a.filter ? [a.filter] : []).filter((f) => FILTERS.some((x) => x[0] === f)) as Filter[];
      if (want.length) { props.clear(); if (want.includes("changes")) filter = "changes"; else { filter = "all"; want.forEach((f) => { if (f !== "all") props.add(f); }); } selChange = null; }
      if (typeof a.include_plane === "boolean") { plane = a.include_plane; ($("#ct-plane") as HTMLInputElement).checked = plane; counts(); }
      if (a.min_motion !== undefined) { minPm = a.min_motion ?? NaN; ($("#ct-min") as HTMLInputElement).value = isFinite(minPm) ? String(minPm) : ""; }
      if (a.max_motion !== undefined) { maxPm = a.max_motion ?? NaN; ($("#ct-max") as HTMLInputElement).value = isFinite(maxPm) ? String(maxPm) : ""; }
      if (a.search !== undefined) { q = a.search; ($("#ct-q") as HTMLInputElement).value = q; }
      if (a.sort && COLS.some((x) => x.k === a.sort)) { sortKey = a.sort as keyof Cols; sortDir = a.descending === false ? 1 : -1; }
      if (a.view === "rpm" || a.view === "sky") view = a.view;
      apply();
      if (a.select) { const i = C.id.indexOf(a.select); if (i >= 0) { sel = i; if (!rows.includes(i)) { filter = "all"; props.clear(); apply(true); } else { page = Math.floor(rows.indexOf(i) / PAGE); render(); } } }
      if (a.open && sel >= 0) ($("#ct-open") as HTMLElement | null)?.click();
      return `${filter === "changes" ? changes.length : rows.length} rows match`;
    },
  };
}
