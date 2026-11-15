// WATCHLIST — a researcher tool: give a list of targets, get one table. Each target is put through the same chain
// as a single field in the Lab (SPHEREx exposures from NASA's archive, Gaia / AllWISE / 2MASS from CDS, the motion
// detector), one after another so that the archive is not flooded. The table can be exported; a row opens the field.
import { build, propagate, skyToStamp, PIX_ARCSEC, type Target } from "./engine";
import { gaia, allwise, twomass, parseCoords, resolveName, CHALLENGE } from "./catalogs";
import { detectChanges, type FieldReport, type ChangeRow, type TM } from "./detect";

export type FieldResult = { target: Target; frames: number; covered: number; center: [number, number]; report: FieldReport | null; row: ChangeRow | null; error?: string };

/** measure one field without a screen: read the exposures and the catalogues, run the detector */
export async function measureField(t: Target, o: { size?: number; maxFrames?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<FieldResult> {
  const N = o.size ?? 32;
  const b = await build(t, { size: N, maxFrames: o.maxFrames ?? 36, signal: o.signal, concurrency: 6, onFrame: (_f, d, n) => o.onProgress?.(d, n), onSkip: (d, n) => o.onProgress?.(d, n) });
  const out: FieldResult = { target: t, frames: b.frames.length, covered: b.covered, center: b.center, report: null, row: null };
  if (b.frames.length < 4) { out.error = b.covered ? "too few exposures could be read" : "not observed by SPHEREx yet"; return out; }
  const [ra, dec] = b.center, r = ((N * PIX_ARCSEC) / 2) * 1.45, pm = Math.hypot(t.pmra ?? 0, t.pmdec ?? 0);
  const [g, w, tm] = await Promise.allSettled([gaia(ra, dec, r + pm * 12, 400), allwise(ra, dec, r + pm * 18, 400), twomass(ra, dec, r + pm * 30, 400)]);
  const mid = b.frames[b.frames.length >> 1], xy = skyToStamp(ra, dec, N, ...propagate(t, mid.mjd));
  try {
    out.report = detectChanges(b.frames, N, b.center, { gaia: g.status === "fulfilled" && g.value.length ? g.value : null, wise: w.status === "fulfilled" && w.value.length ? w.value : null,
      tm: tm.status === "fulfilled" && tm.value.length ? (tm.value as TM[]) : null }, xy, undefined, pm > 0.02 ? { pmra: t.pmra!, pmdec: t.pmdec! } : null);
  } catch { out.error = "the detector failed on this field"; }
  out.row = out.report?.rows.find((q) => q.isTarget) ?? null;
  return out;
}
const word = (r: ChangeRow | null) => (!r ? "no source" : r.tags.includes("MOVED") ? "moved" : r.tags.includes("BRIGHTER") ? "brighter" : r.tags.includes("FAINTER") ? "fainter" : r.tags.includes("NEW") ? "new" : r.tags.includes("VARIABLE") ? "variable"
  : r.tags.some((t) => t === "SATURATED" || t === "BLENDED" || t === "EDGE") ? "not judged" : "steady");

type Api = { open: (t: any) => void; esc: (s: string) => string; toast: (m: string) => void; save: (b: Blob, name: string) => void };
let text = "", results: (FieldResult & { q: string })[] = [], running: AbortController | null = null, size = 32, depth = 36;

export function renderWatchlist(el: HTMLElement, api: Api) {
  const esc = api.esc, done = results.length;
  el.innerHTML = `<p class="bk-reading"><b>Watchlist</b> One target per line: a name, or a position (RA Dec, in degrees or as 17h57m48s +04°41′). Every target goes through the Lab's whole chain; the result is one table.</p>
    <textarea class="wl-in" id="wl-in" spellcheck="false" placeholder="Barnard's Star&#10;Luhman 16&#10;331.0967 -56.8008&#10;…up to 25 targets">${esc(text)}</textarea>
    <div class="wl-bar"><button class="btn sm" id="wl-run">${running ? "Stop" : "Measure the list"}</button><button class="link" id="wl-five">NASA's five test targets</button>
      <span class="mono">field <select id="wl-size" class="bk-rate" style="height:26px">${[32, 64].map((s) => `<option value="${s}" ${s === size ? "selected" : ""}>${((s * PIX_ARCSEC) / 60).toFixed(1)}′</option>`).join("")}</select>
      exposures <select id="wl-depth" class="bk-rate" style="height:26px">${[36, 72].map((s) => `<option value="${s}" ${s === depth ? "selected" : ""}>${s}</option>`).join("")}</select></span></div>
    <div class="wl-prog"><i id="wl-prog"></i></div><div class="mono" id="wl-msg" style="font-size:10.5px;color:var(--dim);min-height:16px"></div>
    ${done ? `<div class="bk-tw"><table class="bk-table rows" id="wl-tab"><thead><tr><th>target</th><th>result</th><th>motion (″/yr)</th><th>Gaia (″/yr)</th><th>now ÷ 2010</th><th>sources · moved</th><th>exposures</th></tr></thead><tbody>
      ${results.map((r, k) => { const p = r.row, m = p?.pm && p.pm.base > 5 ? p.pm : null, g = p?.gaia && p.gaia.plx !== null ? Math.hypot(p.gaia.pmra, p.gaia.pmdec) : null, d = p?.dW2 ?? p?.dW1 ?? null, c = r.report?.counts;
        return `<tr data-k="${k}"><td>${esc(r.target.name ?? r.q)}</td><td>${r.error ? `<span class="dim">${esc(r.error)}</span>` : `<em class="tag ${word(p) === "moved" ? "pos" : word(p) === "steady" ? "" : "warn"}">${word(p)}</em>`}</td>
          <td class="num">${m ? `${m.tot.toFixed(m.tot < 1 ? 3 : 2)} <small>± ${Math.hypot(m.etot, r.report?.cal.pmRms ?? 0.03).toFixed(3)}</small>` : "–"}</td><td class="num">${g === null ? "–" : g.toFixed(3)}</td><td class="num">${d ? `${d.ratio.toFixed(2)}×` : "–"}</td>
          <td class="num">${c ? `${c.measured} · ${c.moved}` : "–"}</td><td class="num">${r.frames} / ${r.covered}</td></tr>`; }).join("")}</tbody></table></div>
      <div class="bk-bar2"><span class="mono">${done} measured · click a row to open the field</span><span><button class="link" id="wl-csv">CSV</button><button class="link" id="wl-json">JSON</button></span></div>` : ""}
    <p class="bk-cap show">Each field is read at ${((size * PIX_ARCSEC) / 60).toFixed(1)}′ with ${depth} exposures, so a run takes about half a minute per target. “Moved” needs 5σ against the scatter with which Gaia stars are recovered in the same field, exactly as in the Motion detector. A list is kept in this browser only.</p>`;
  const $ = <T extends HTMLElement>(s: string) => el.querySelector(s) as T, ta = $<HTMLTextAreaElement>("#wl-in");
  ta.oninput = () => (text = ta.value);
  $("#wl-five").onclick = () => { text = CHALLENGE.map((t) => t.name).join("\n"); renderWatchlist(el, api); };
  $<HTMLSelectElement>("#wl-size").onchange = (e) => (size = +(e.target as HTMLSelectElement).value);
  $<HTMLSelectElement>("#wl-depth").onchange = (e) => (depth = +(e.target as HTMLSelectElement).value);
  el.querySelectorAll<HTMLTableRowElement>("#wl-tab tbody tr").forEach((tr) => (tr.onclick = () => { const r = results[+tr.dataset.k!]; if (r) api.open(r.target); }));
  const rowsOut = () => results.map((r) => { const p = r.row, m = p?.pm && p.pm.base > 5 ? p.pm : null, d = p?.dW2 ?? p?.dW1 ?? null;
    return { query: r.q, name: r.target.name ?? "", ra_deg: +r.center[0].toFixed(6), dec_deg: +r.center[1].toFixed(6), result: r.error ?? word(p), pm_arcsec_yr: m ? +m.tot.toFixed(4) : null, pm_ra: m ? +m.ra.toFixed(4) : null, pm_dec: m ? +m.dec.toFixed(4) : null,
      pm_err: m ? +Math.hypot(m.etot, r.report?.cal.pmRms ?? 0.03).toFixed(4) : null, pm_sigma: m ? +m.sig.toFixed(1) : null, baseline_yr: m ? +m.base.toFixed(1) : null, gaia_pm: p?.gaia && p.gaia.plx !== null ? +Math.hypot(p.gaia.pmra, p.gaia.pmdec).toFixed(4) : null,
      now_over_2010: d ? +d.ratio.toFixed(3) : null, sources: r.report?.counts.measured ?? 0, moved_in_field: r.report?.counts.moved ?? 0, exposures_read: r.frames, exposures_covering: r.covered }; });
  const csvB = el.querySelector<HTMLElement>("#wl-csv"), jsB = el.querySelector<HTMLElement>("#wl-json");
  if (csvB) csvB.onclick = () => { const R = rowsOut(), head = Object.keys(R[0]); api.save(new Blob([`# MIRA watchlist · ${new Date().toISOString()} · SPHEREx Level-2 exposures (NASA/IPAC IRSA), Gaia DR3, AllWISE, 2MASS (CDS)\n${head.join(",")}\n${R.map((r) => head.map((h) => { const v = (r as any)[h]; return typeof v === "string" ? `"${v.replace(/"/g, "'")}"` : v ?? ""; }).join(",")).join("\n")}\n`], { type: "text/csv" }), "mira_watchlist.csv"); };
  if (jsB) jsB.onclick = () => api.save(new Blob([JSON.stringify({ tool: "MIRA watchlist", made: new Date().toISOString(), field_arcmin: +((size * PIX_ARCSEC) / 60).toFixed(1), exposures: depth, rows: rowsOut() }, null, 1)], { type: "application/json" }), "mira_watchlist.json");
  $("#wl-run").onclick = async () => {
    if (running) { running.abort(); running = null; renderWatchlist(el, api); return; }
    const lines = ta.value.split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 25); if (!lines.length) { api.toast("Enter at least one target"); return; }
    text = ta.value; results = []; const ac = (running = new AbortController()); renderWatchlist(el, api);
    const msg = () => el.querySelector<HTMLElement>("#wl-msg"), bar = () => el.querySelector<HTMLElement>("#wl-prog");
    for (let k = 0; k < lines.length && !ac.signal.aborted; k++) {
      const q = lines[k]; let t: Target | null = null;
      const ch = CHALLENGE.find((c) => c.name.toLowerCase() === q.toLowerCase() || c.key === q), xy = parseCoords(q);
      if (ch) t = { ...ch }; else if (xy) t = { ra: xy[0], dec: xy[1] }; else t = await resolveName(q).catch(() => null);
      if (!t) { results.push({ q, target: { ra: NaN, dec: NaN, name: q }, frames: 0, covered: 0, center: [NaN, NaN], report: null, row: null, error: "name not found" }); renderWatchlist(el, api); continue; }
      try {
        const r = await measureField(t, { size, maxFrames: depth, signal: ac.signal, onProgress: (d, n) => { const m = msg(), b = bar(); if (m) m.textContent = `${k + 1} / ${lines.length} · ${t!.name ?? q}: exposure ${d} of ${n}`; if (b) b.style.width = `${((k + d / Math.max(1, n)) / lines.length) * 100}%`; } });
        if (ac.signal.aborted) break; results.push({ ...r, q });
      } catch (e) { if ((e as Error).name === "AbortError") break; results.push({ q, target: t, frames: 0, covered: 0, center: [t.ra, t.dec], report: null, row: null, error: "could not be read" }); }
      renderWatchlist(el, api); const b = bar(); if (b) b.style.width = `${((k + 1) / lines.length) * 100}%`;
    }
    if (running === ac) running = null; renderWatchlist(el, api);
  };
  if (running) { const b = el.querySelector<HTMLElement>("#wl-prog"); if (b) b.style.width = `${(results.length / Math.max(1, text.split(/\n+/).filter((s) => s.trim()).length)) * 100}%`; }
}
