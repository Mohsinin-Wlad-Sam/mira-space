// Scientific plots for the Lab instruments, as dependency-free SVG. Every plot is a framed axis box with tick marks,
// tick labels, axis titles that carry the unit, a light grid, error bars and a legend; data marks stay addressable
// (data-k) so a point can be linked to the exposure it came from.
import { DETECTORS, mjdToYear } from "./engine";
import type { Phot, LightCurve, Motion } from "./measure";
import { parallaxFactors } from "./measure";

export const DET_COLOR = ["#6ea8ff", "#56d0e0", "#74dd8f", "#f0d35b", "#ff9d4d", "#ff5d6c"];
export const detColor = (det: number) => DET_COLOR[det - 1] ?? "#fff";
/** perceptual-ish rainbow from 0.75 µm (blue) to 5 µm (red), used wherever a mark stands for a wavelength */
export function lamColor(um: number) {
  const t = Math.min(1, Math.max(0, (um - 0.75) / 4.25)), stops = [[110, 168, 255], [86, 208, 224], [116, 221, 143], [240, 211, 91], [255, 157, 77], [255, 93, 108]];
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i, c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
/** molecular and atomic features SPHEREx resolves */
export const FEATURES: { um: number; w: number; label: string; what: string }[] = [
  { um: 1.4, w: 0.12, label: "H₂O", what: "water vapour" }, { um: 1.9, w: 0.14, label: "H₂O", what: "water vapour" }, { um: 2.3, w: 0.1, label: "CO", what: "carbon monoxide (cool giants)" },
  { um: 2.7, w: 0.2, label: "H₂O", what: "water vapour" }, { um: 3.05, w: 0.12, label: "ice", what: "water ice on dust grains" }, { um: 3.3, w: 0.16, label: "CH₄", what: "methane (cold brown dwarfs, planets)" },
  { um: 4.27, w: 0.1, label: "CO₂", what: "carbon dioxide" }, { um: 4.67, w: 0.12, label: "CO", what: "carbon monoxide" },
];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// ---------------------------------------------------------------- generic framed plot
export type Axis = { lo: number; hi: number; label: string; log?: boolean; ticks?: number[]; fmt?: (v: number) => string; invert?: boolean };
export type Mark = { x: number; y: number; ey?: number; k?: number; title?: string; color?: string; hollow?: boolean; label?: string };
export type Shape = "dot" | "square" | "diamond" | "cross";
export type Series = { name?: string; color: string; pts: Mark[]; shape?: Shape; size?: number; line?: boolean | "dash"; width?: number; marks?: boolean; hollow?: boolean };
export type PlotSpec = { w?: number; h?: number; title?: string; x: Axis; y: Axis; series: Series[]; equal?: boolean; current?: number;
  bands?: { x0: number; x1: number; label: string; title?: string }[]; hlines?: { y: number; label?: string; color?: string; dash?: boolean }[]; vlines?: { x: number; label?: string; color?: string }[];
  ribbons?: { x: number[]; y0: number[]; y1: number[]; color: string }[]; under?: string; empty?: string };

export function niceTicks(lo: number, hi: number, n = 5): number[] {
  const span = hi - lo || 1, step0 = Math.pow(10, Math.floor(Math.log10(span / n))), step = [1, 2, 5, 10].map((m) => m * step0).find((s) => span / s <= n + 0.5) ?? step0 * 10;
  const out: number[] = []; for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-6; v += step) out.push(+v.toPrecision(12)); return out;
}
function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [], d0 = Math.floor(Math.log10(lo)), d1 = Math.ceil(Math.log10(hi)), few = d1 - d0 <= 2;
  for (let d = d0; d <= d1; d++) for (const m of few ? [1, 2, 5] : [1]) { const v = m * Math.pow(10, d); if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); }
  return out;
}
export const fmtNum = (v: number) => { const a = Math.abs(v); if (a === 0) return "0"; if (a >= 1e5 || a < 1e-3) { const e = Math.floor(Math.log10(a)), m = v / Math.pow(10, e); return `${Math.abs(m - 1) < 1e-9 ? "" : m.toFixed(0) + "×"}10${[...String(e)].map((c) => (c === "-" ? "⁻" : "⁰¹²³⁴⁵⁶⁷⁸⁹"[+c])).join("")}`; }
  return a >= 100 ? v.toFixed(0) : a >= 10 ? String(+v.toFixed(1)) : a >= 1 ? String(+v.toFixed(2)) : String(+v.toPrecision(2)); };
function shape(sh: Shape, x: number, y: number, r: number, attrs: string) {
  if (sh === "square") return `<rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${(2 * r).toFixed(1)}" height="${(2 * r).toFixed(1)}" ${attrs}/>`;
  if (sh === "diamond") return `<path d="M${x.toFixed(1)} ${(y - r * 1.3).toFixed(1)}l${(r * 1.3).toFixed(1)} ${(r * 1.3).toFixed(1)}l${(-r * 1.3).toFixed(1)} ${(r * 1.3).toFixed(1)}l${(-r * 1.3).toFixed(1)} ${(-r * 1.3).toFixed(1)}z" ${attrs}/>`;
  if (sh === "cross") return `<path d="M${(x - r).toFixed(1)} ${(y - r).toFixed(1)}l${(2 * r).toFixed(1)} ${(2 * r).toFixed(1)}M${(x - r).toFixed(1)} ${(y + r).toFixed(1)}l${(2 * r).toFixed(1)} ${(-2 * r).toFixed(1)}" ${attrs} fill="none"/>`;
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" ${attrs}/>`;
}
/** draw a framed plot into `el`; returns the data -> pixel functions */
export function plot(el: HTMLElement, s: PlotSpec, on: { pick?: (k: number) => void; hover?: (k: number | null) => void } = {}) {
  const named = s.series.filter((q) => q.name), W = s.w ?? 560;
  // legend rows are laid out first: they decide the top margin
  const leg: { x: number; row: number; q: Series }[] = []; let lx = 0, row = 0;
  for (const q of named) { const wd = 22 + q.name!.length * 6.1; if (lx + wd > W - 70 && lx > 0) { row++; lx = 0; } leg.push({ x: lx, row, q }); lx += wd + 10; }
  const L = 62, R = 16, T = (s.title ? 22 : 8) + (named.length ? (row + 1) * 15 + 4 : 0) + (s.bands?.length ? 12 : 0), B = 42;
  let H = s.h ?? 300;
  if (s.equal) { const pw = W - L - R, ph = (pw * (s.y.hi - s.y.lo)) / (s.x.hi - s.x.lo); H = Math.round(ph + T + B); }
  const pw = W - L - R, ph = H - T - B;
  const tx = (a: Axis, v: number) => (a.log ? (Math.log10(Math.max(v, 1e-300)) - Math.log10(a.lo)) / (Math.log10(a.hi) - Math.log10(a.lo)) : (v - a.lo) / (a.hi - a.lo));
  const X = (v: number) => L + (s.x.invert ? 1 - tx(s.x, v) : tx(s.x, v)) * pw, Y = (v: number) => T + (s.y.invert ? tx(s.y, v) : 1 - tx(s.y, v)) * ph;
  const cl = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  let g = `<rect x="${L}" y="${T}" width="${pw}" height="${ph}" class="pl-box"/>`;
  if (s.title) g += `<text x="${L}" y="14" class="pl-title">${esc(s.title)}</text>`;
  leg.forEach(({ x, row: r, q }) => { const y = (s.title ? 22 : 8) + r * 15 + 8, x0 = L + x;
    g += (q.line ? `<line x1="${x0}" x2="${x0 + 16}" y1="${y}" y2="${y}" stroke="${q.color}" stroke-width="${q.width ?? 1.6}" ${q.line === "dash" ? 'stroke-dasharray="4 3"' : ""}/>` : "") +
      (q.marks === false ? "" : shape(q.shape ?? "dot", x0 + 8, y, 3.4, `fill="${q.hollow ? "none" : q.color}" stroke="${q.color}" stroke-width="1.3"`)) + `<text x="${x0 + 21}" y="${y + 3.5}" class="pl-leg">${esc(q.name!)}</text>`; });
  for (const b of s.bands ?? []) { const x0 = cl(X(b.x0), L, L + pw), x1 = cl(X(b.x1), L, L + pw); if (Math.abs(x1 - x0) < 1) continue;
    g += `<rect x="${Math.min(x0, x1)}" y="${T}" width="${Math.abs(x1 - x0)}" height="${ph}" class="pl-band"><title>${esc(b.title ?? b.label)}</title></rect><text x="${(x0 + x1) / 2}" y="${T - 3}" class="pl-tick" text-anchor="middle">${esc(b.label)}</text>`; }
  const xt = s.x.ticks ?? (s.x.log ? logTicks(s.x.lo, s.x.hi) : niceTicks(s.x.lo, s.x.hi, 6)), yt = s.y.ticks ?? (s.y.log ? logTicks(s.y.lo, s.y.hi) : niceTicks(s.y.lo, s.y.hi, 5));
  for (const v of xt) { const x = X(v); if (x < L - 0.5 || x > L + pw + 0.5) continue; g += `<line x1="${x}" x2="${x}" y1="${T}" y2="${T + ph}" class="pl-grid"/><line x1="${x}" x2="${x}" y1="${T + ph}" y2="${T + ph + 4}" class="pl-ax"/><text x="${x}" y="${T + ph + 15}" class="pl-tick" text-anchor="middle">${(s.x.fmt ?? fmtNum)(v)}</text>`; }
  for (const v of yt) { const y = Y(v); if (y < T - 0.5 || y > T + ph + 0.5) continue; g += `<line x1="${L}" x2="${L + pw}" y1="${y}" y2="${y}" class="pl-grid"/><line x1="${L - 4}" x2="${L}" y1="${y}" y2="${y}" class="pl-ax"/><text x="${L - 7}" y="${y + 3.5}" class="pl-tick" text-anchor="end">${(s.y.fmt ?? fmtNum)(v)}</text>`; }
  g += `<text x="${L + pw / 2}" y="${H - 8}" class="pl-lab" text-anchor="middle">${esc(s.x.label)}</text><text transform="translate(13 ${T + ph / 2}) rotate(-90)" class="pl-lab" text-anchor="middle">${esc(s.y.label)}</text>`;
  for (const r of s.ribbons ?? []) { const up = r.x.map((x, k) => `${X(x).toFixed(1)},${cl(Y(r.y1[k]), T, T + ph).toFixed(1)}`), dn = r.x.map((x, k) => `${X(x).toFixed(1)},${cl(Y(r.y0[k]), T, T + ph).toFixed(1)}`).reverse(); g += `<polygon points="${[...up, ...dn].join(" ")}" fill="${r.color}" opacity=".16"/>`; }
  for (const h of s.hlines ?? []) { const y = Y(h.y); if (y < T || y > T + ph) continue; g += `<line x1="${L}" x2="${L + pw}" y1="${y}" y2="${y}" stroke="${h.color ?? "#f0f0fa"}" stroke-width="1.1" ${h.dash === false ? "" : 'stroke-dasharray="5 4"'} opacity=".8"/>${h.label ? `<text x="${L + pw - 5}" y="${y - 4}" class="pl-note" text-anchor="end" fill="${h.color ?? "#f0f0fa"}">${esc(h.label)}</text>` : ""}`; }
  for (const v of s.vlines ?? []) { const x = X(v.x); if (x < L || x > L + pw) continue; g += `<line x1="${x}" x2="${x}" y1="${T}" y2="${T + ph}" stroke="${v.color ?? "#f0f0fa"}" stroke-width="1" stroke-dasharray="3 4" opacity=".7"/>${v.label ? `<text x="${x + 4}" y="${T + 11}" class="pl-note" fill="${v.color ?? "#f0f0fa"}">${esc(v.label)}</text>` : ""}`; }
  g += `<clipPath id="pc${(plot as any)._n = ((plot as any)._n ?? 0) + 1}"><rect x="${L}" y="${T}" width="${pw}" height="${ph}"/></clipPath><g clip-path="url(#pc${(plot as any)._n})">`;
  for (const q of s.series) {
    const P = q.pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && (!s.y.log || p.y > 0));
    if (q.line && P.length > 1) g += `<polyline fill="none" stroke="${q.color}" stroke-width="${q.width ?? 1.6}" ${q.line === "dash" ? 'stroke-dasharray="5 4"' : ""} points="${P.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ")}"/>`;
    if (q.marks === false) continue;
    for (const p of P) {
      const x = X(p.x), y = Y(p.y), c = p.color ?? q.color, cur = p.k !== undefined && p.k === s.current, r = (q.size ?? 3) * (cur ? 1.7 : 1);
      if (p.ey && p.ey > 0) { const y0 = Y(s.y.log ? Math.max(p.y - p.ey, s.y.lo) : p.y - p.ey), y1 = Y(p.y + p.ey); g += `<path d="M${x.toFixed(1)} ${y0.toFixed(1)}V${y1.toFixed(1)}M${(x - 2.5).toFixed(1)} ${y0.toFixed(1)}h5M${(x - 2.5).toFixed(1)} ${y1.toFixed(1)}h5" stroke="${c}" stroke-width="1" opacity=".75" fill="none"/>`; }
      g += shape(q.shape ?? "dot", x, y, r, `fill="${q.hollow || p.hollow ? "#000" : c}" stroke="${cur ? "#fff" : c}" stroke-width="${cur ? 1.8 : 1.3}"${p.k !== undefined ? ` data-k="${p.k}" class="bk-pt"` : ""}`).replace("/>", `>${p.title ? `<title>${esc(p.title)}</title>` : ""}</${(q.shape ?? "dot") === "dot" ? "circle" : (q.shape === "square" ? "rect" : "path")}>`);
      if (p.label) g += `<text x="${x + r + 4}" y="${y - r - 2}" class="pl-note">${esc(p.label)}</text>`;
    }
  }
  g += `</g>`;
  el.innerHTML = `<svg class="pl" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.title ?? s.y.label + " against " + s.x.label)}">${g}</svg>${s.under ? `<p class="pl-under">${s.under}</p>` : ""}`;
  const svg = el.querySelector("svg")!;
  if (on.pick) svg.addEventListener("click", (e) => { const k = (e.target as Element).getAttribute?.("data-k"); if (k !== null && k !== undefined) on.pick!(+k); });
  if (on.hover) { svg.addEventListener("pointermove", (e) => { const k = (e.target as Element).getAttribute?.("data-k"); on.hover!(k !== null && k !== undefined ? +k : null); }); svg.addEventListener("pointerleave", () => on.hover!(null)); }
  return { X, Y };
}
const pad = (lo: number, hi: number, f = 0.08): [number, number] => { const d = (hi - lo || Math.abs(hi) || 1) * f; return [lo - d, hi + d]; };
const yearFmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

// ---------------------------------------------------------------- spectrograph
export type SpecOpts = { current?: number; log?: boolean; anchors?: { um: number; mjy: number; label: string }[]; bins?: { lam: number; flux: number }[]; onPick?: (k: number) => void; onHover?: (k: number | null) => void };
export function drawSpectrum(el: HTMLElement, P: Phot[], o: SpecOpts = {}) {
  const ok = P.filter((p) => Number.isFinite(p.flux));
  if (ok.length < 3) { el.innerHTML = `<div class="bk-empty">Waiting for exposures…</div>`; return; }
  const cleanV = ok.filter((p) => !p.flagged).map((p) => p.flux).sort((a, b) => a - b), all = cleanV.length > 3 ? cleanV : ok.map((p) => p.flux).sort((a, b) => a - b);
  let hi = all[Math.min(all.length - 1, Math.floor(all.length * 0.985))] * 1.2, lo = Math.min(0, all[Math.floor(all.length * 0.02)] * 1.1);
  for (const a of o.anchors ?? []) if (a.mjy > hi && a.mjy < hi * 4) hi = a.mjy * 1.15;
  if (!(hi > lo)) hi = lo + 1;
  const useLog = !!o.log && hi > 0, ylo = useLog ? Math.max(hi / 2000, 0.3 * (ok.map((p) => p.err).sort((a, b) => a - b)[ok.length >> 1] || hi / 1000)) : lo;
  const series: Series[] = DETECTORS.map((d) => ({ name: `D${d.det} ${d.lo.toFixed(d.lo < 1 ? 2 : 1)}–${d.hi.toFixed(1)}`, color: detColor(d.det), size: 2.6,
    pts: ok.filter((p) => p.det === d.det && !p.flagged).map((p) => ({ x: p.lam, y: p.flux, ey: p.err, k: p.k, title: `${p.lam.toFixed(3)} µm · ${p.flux.toPrecision(3)} ± ${p.err.toPrecision(2)} mJy` })) })).filter((q) => q.pts.length);
  const fl = ok.filter((p) => p.flagged);
  if (fl.length) series.push({ name: "flagged by NASA", color: "#ff5d6c", shape: "cross", size: 2.8, pts: fl.map((p) => ({ x: p.lam, y: p.flux, k: p.k })) });
  if (o.bins && o.bins.length > 2) series.push({ name: "median", color: "#f0f0fa", line: true, marks: false, width: 1.4, pts: o.bins.map((b) => ({ x: b.lam, y: b.flux })) });
  if (o.anchors?.length) series.push({ name: "catalogues (2MASS ~1999, WISE 2010)", color: "#f0f0fa", shape: "diamond", hollow: true, size: 3.6, pts: o.anchors.map((a) => ({ x: a.um, y: a.mjy, label: a.label })) });
  plot(el, { h: 320, x: { lo: 0.7, hi: 5.1, label: "Wavelength (µm)", ticks: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] }, y: { lo: ylo, hi, label: "Flux density (mJy)", log: useLog }, series, current: o.current,
    bands: FEATURES.map((f) => ({ x0: f.um - f.w / 2, x1: f.um + f.w / 2, label: f.label, title: `${f.label}: ${f.what}` })), hlines: useLog ? [] : [{ y: 0, dash: false, color: "#ffffff55" }] }, { pick: o.onPick, hover: o.onHover });
}

// ---------------------------------------------------------------- photometer
/** brightness of each SPHEREx visit against the source's own mean, from wavelength-matched exposure pairs */
export function drawLightCurve(el: HTMLElement, lc: LightCurve) {
  const S = [...lc.series, lc.all].filter((q) => q.visits.length >= 2);
  if (!S.length) { el.innerHTML = `<div class="bk-empty">Not enough exposures at matching wavelengths in two different visits. Use “All” exposures.</div>`; return; }
  const V = S.flatMap((q) => q.visits), yr = (m: number) => mjdToYear(m), [x0, x1] = pad(Math.min(...V.map((v) => yr(v.mjd))), Math.max(...V.map((v) => yr(v.mjd))), 0.1);
  const vmin = Math.max(0.02, Math.min(...V.map((v) => v.ratio - v.err))), vmax = Math.max(...V.map((v) => v.ratio + v.err)), useLog = vmax / vmin > 4;
  const series: Series[] = S.map((q) => ({ name: q.det ? `D${q.det} ${DETECTORS[q.det - 1].lo.toFixed(q.det === 1 ? 2 : 1)}–${DETECTORS[q.det - 1].hi.toFixed(1)} µm` : "all detectors", color: q.det ? detColor(q.det) : "#f0f0fa", shape: q.det ? "dot" : "square",
    size: q.det ? 3 : 3.6, line: true, width: q.det ? 1.2 : 2, pts: q.visits.map((v) => ({ x: yr(v.mjd), y: v.ratio, ey: v.err, title: `${v.ratio.toFixed(2)} ± ${v.err.toFixed(2)} (${v.n} matched pairs)` })) }));
  plot(el, { h: 290, x: { lo: x0, hi: x1, label: "Date of the SPHEREx visit (year)", fmt: (v) => v.toFixed(1) }, y: { lo: useLog ? vmin * 0.8 : Math.max(0, Math.min(0.7, vmin - 0.08)), hi: useLog ? vmax * 1.25 : Math.max(1.3, vmax + 0.08), label: "Brightness ÷ its own mean", log: useLog },
    series, hlines: [{ y: 1, label: "no change" }] });
}
/** 25 years of brightness: catalogue fluxes (2MASS ~1999, AllWISE 2010) and SPHEREx in the same bands */
export type HistPoint = { yr: number; f: number; e?: number; src: string };
export function drawHistory(el: HTMLElement, bands: { name: string; color: string; pts: HistPoint[] }[]) {
  const all = bands.flatMap((b) => b.pts).filter((p) => p.f > 0);
  if (all.length < 2) { el.innerHTML = `<div class="bk-empty">No catalogue counterpart (2MASS, AllWISE) for this source: nothing older to compare with.</div>`; return; }
  const lo = Math.min(...all.map((p) => p.f)) / 1.8, hi = Math.max(...all.map((p) => p.f)) * 1.8;
  plot(el, { h: 280, x: { lo: 1997, hi: 2028, label: "Year of observation", ticks: [2000, 2005, 2010, 2015, 2020, 2025], fmt: yearFmt }, y: { lo, hi, label: "Flux density (mJy)", log: true },
    series: bands.filter((b) => b.pts.length).map((b) => ({ name: b.name, color: b.color, line: "dash" as const, width: 1, size: 3.4,
      pts: b.pts.filter((p) => p.f > 0).map((p) => ({ x: p.yr, y: p.f, ey: p.e, hollow: !p.src.startsWith("SPHEREx"), title: `${p.src} ${p.yr.toFixed(1)}: ${p.f.toPrecision(3)} mJy` })) })),
    vlines: [{ x: 1999.5, label: "2MASS" }, { x: 2010.5, label: "WISE" }, { x: 2025.3, label: "SPHEREx" }] });
}

// ---------------------------------------------------------------- astrometer
export type TrackPoint = { yr: number; xi: number; eta: number; err: number; src: string };
export type TrackFit = { ra: number; dec: number; etot: number; t0: number; xi0: number; eta0: number };
/** position against time on a long baseline: east and north offsets (arcsec) with the fitted straight line */
export function drawTrack(el: HTMLElement, pts: TrackPoint[], fit: TrackFit | null, ref?: { ra: number; dec: number; name: string } | null) {
  if (pts.length < 2) { el.innerHTML = `<div class="bk-empty">Only one dated position: no motion can be measured.</div>`; return; }
  const t0 = fit?.t0 ?? pts[pts.length - 1].yr, x0 = fit?.xi0 ?? pts[pts.length - 1].xi, y0 = fit?.eta0 ?? pts[pts.length - 1].eta;
  const [ta, tb] = pad(Math.min(...pts.map((p) => p.yr)), Math.max(...pts.map((p) => p.yr)), 0.06), kinds = [...new Set(pts.map((p) => p.src))];
  const sh: Record<string, Shape> = { "2MASS": "square", "WISE 2010": "diamond", SPHEREx: "dot" }, colr: Record<string, string> = { "2MASS": "#f0d35b", "WISE 2010": "#ff9d4d", SPHEREx: "#7df0a6" };
  el.innerHTML = `<div class="pl-pair"><div></div><div></div></div>`;
  const hosts = el.querySelectorAll<HTMLElement>(".pl-pair > div");
  ([["xi", "East offset Δα cos δ (″)", fit?.ra, ref?.ra], ["eta", "North offset Δδ (″)", fit?.dec, ref?.dec]] as const).forEach(([key, label, slope, rs], q) => {
    const o = key === "xi" ? x0 : y0, v = pts.map((p) => p[key] - o), [lo, hi] = pad(Math.min(...v.map((y, k) => y - pts[k].err), slope !== undefined ? slope * (ta - t0) : 0, slope !== undefined ? slope * (tb - t0) : 0), Math.max(...v.map((y, k) => y + pts[k].err), slope !== undefined ? slope * (ta - t0) : 0, slope !== undefined ? slope * (tb - t0) : 0), 0.12);
    const series: Series[] = kinds.map((kd) => ({ name: q === 0 ? (kd === "SPHEREx" ? "SPHEREx visit" : kd === "2MASS" ? "2MASS (~1999)" : "AllWISE (2010)") : undefined, color: colr[kd] ?? "#fff", shape: sh[kd] ?? "dot", size: 3.6,
      pts: pts.filter((p) => p.src === kd).map((p) => ({ x: p.yr, y: p[key] - o, ey: p.err, title: `${kd} ${p.yr.toFixed(2)}: ${(p[key] - o).toFixed(2)} ± ${p.err.toFixed(2)}″` })) }));
    if (slope !== undefined) series.unshift({ name: q === 0 ? "fitted motion" : undefined, color: "#f0f0fa", line: true, marks: false, width: 1.5, pts: [{ x: ta, y: slope * (ta - t0) }, { x: tb, y: slope * (tb - t0) }] });
    if (rs !== undefined && ref) series.unshift({ name: q === 0 ? ref.name : undefined, color: "#78dcff", line: "dash", marks: false, width: 1.2, pts: [{ x: ta, y: rs * (ta - t0) }, { x: tb, y: rs * (tb - t0) }] });
    plot(hosts[q], { h: q === 0 ? 246 : 212, x: { lo: ta, hi: tb, label: "Year of observation", fmt: yearFmt }, y: { lo, hi, label }, series,
      ribbons: slope !== undefined && fit ? [{ x: [ta, t0, tb], y0: [slope * (ta - t0) - fit.etot * Math.abs(ta - t0), 0, slope * (tb - t0) - fit.etot * Math.abs(tb - t0)], y1: [slope * (ta - t0) + fit.etot * Math.abs(ta - t0), 0, slope * (tb - t0) + fit.etot * Math.abs(tb - t0)], color: "#f0f0fa" }] : [] });
  });
}
/** every SPHEREx exposure: offsets against date with the fitted model (proper motion, and the parallax loop when fitted) */
export function drawMotion(el: HTMLElement, m: Motion, o: { current?: number; onPick?: (k: number) => void; center?: [number, number] } = {}) {
  const used = m.pts.filter((p) => p.used); if (!used.length) { el.innerHTML = ""; return; }
  const yr = (mjd: number) => mjdToYear(mjd), [ta, tb] = pad(yr(used[0].mjd), yr(used[used.length - 1].mjd), 0.05);
  const model = (mjd: number): [number, number] => { const dt = (mjd - m.t0) / 365.25, pf = m.plx !== null && o.center ? parallaxFactors(o.center[0], o.center[1], mjd) : [0, 0]; return [m.xi0 + m.pmra * dt + (m.plx ?? 0) * pf[0], m.eta0 + m.pmdec * dt + (m.plx ?? 0) * pf[1]]; };
  const grid = Array.from({ length: 80 }, (_, k) => used[0].mjd - 20 + ((used[used.length - 1].mjd - used[0].mjd + 40) * k) / 79);
  el.innerHTML = `<div class="pl-pair"><div></div><div></div></div>`;
  const hosts = el.querySelectorAll<HTMLElement>(".pl-pair > div");
  (["xi", "eta"] as const).forEach((key, q) => {
    const idx = q, v = used.map((p) => p[key] - (q ? m.eta0 : m.xi0)), mv = grid.map((g) => model(g)[idx] - (q ? m.eta0 : m.xi0)), [lo, hi] = pad(Math.min(...v, ...mv), Math.max(...v, ...mv), 0.12);
    plot(hosts[q], { h: q === 0 ? 240 : 212, x: { lo: ta, hi: tb, label: "Date (year)", fmt: (t) => t.toFixed(1) }, y: { lo, hi, label: q ? "North offset Δδ (″)" : "East offset Δα cos δ (″)" }, current: o.current,
      series: [{ name: q ? undefined : m.plx !== null ? "model: motion + parallax" : "model: straight-line motion", color: "#f0f0fa", line: true, marks: false, width: 1.5, pts: grid.map((g, k) => ({ x: yr(g), y: mv[k] })) },
        { name: q ? undefined : "one exposure", color: "#7df0a6", size: 2.4, pts: used.map((p) => ({ x: yr(p.mjd), y: p[key] - (q ? m.eta0 : m.xi0), ey: p.err, k: p.k })) },
        ...(m.pts.some((p) => !p.used) ? [{ name: q ? undefined : "rejected", color: "#ff5d6c", shape: "cross" as const, size: 2.6, pts: m.pts.filter((p) => !p.used).map((p) => ({ x: yr(p.mjd), y: p[key] - (q ? m.eta0 : m.xi0), k: p.k })) }] : [])] }, { pick: o.onPick });
  });
}

// ---------------------------------------------------------------- detection limits
export type LimitCurve = { name: string; color: string; pts: { d: number; f: number }[]; dash?: boolean };
/** flux at 4.6 µm of model bodies against distance from the Sun, with this field's measured depth */
export function drawLimits(el: HTMLElement, curves: LimitCurve[], limits: { single: number | null; stack: number | null; n: number }) {
  const AU_LY = 63241.1, fmtD = (v: number) => (v >= AU_LY * 0.99 ? `${fmtNum(+(v / AU_LY).toPrecision(2))} ly` : `${v >= 1000 ? (v / 1000).toFixed(0) + ",000" : v.toFixed(0)} au`);
  plot(el, { h: 330, x: { lo: 30, hi: 3e6, label: "Distance from the Sun", log: true, ticks: [100, 1000, 1e4, AU_LY, AU_LY * 10], fmt: fmtD }, y: { lo: 1e-6, hi: 1e3, label: "Flux density at 4.6 µm (mJy)", log: true, ticks: [1e-6, 1e-4, 1e-2, 1, 100] },
    series: curves.map((c) => ({ name: c.name, color: c.color, line: c.dash ? ("dash" as const) : true, marks: false, width: 1.8, pts: c.pts.map((p) => ({ x: p.d, y: p.f })) })),
    hlines: [...(limits.single ? [{ y: limits.single, label: "this field: one exposure, 5σ", color: "#ff9d4d" }] : []), ...(limits.stack ? [{ y: limits.stack, label: `this field: ${limits.n} exposures combined, 5σ`, color: "#7df0a6" }] : [])],
    ribbons: limits.stack ? [{ x: [30, 3e6], y0: [limits.stack, limits.stack], y1: [1e3, 1e3], color: "#7df0a6" }] : [] });
}
