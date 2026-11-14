// Small SVG plots for the BLINK panels (spectrum, light curve, motion). No dependencies; every mark is addressable so
// the plots stay linked to the movie (hover a point -> that exposure).
import { DETECTORS, mjdToDate } from "./engine";
import type { Phot, LightCurve, Motion } from "./measure";

export const DET_COLOR = ["#6ea8ff", "#56d0e0", "#74dd8f", "#f0d35b", "#ff9d4d", "#ff5d6c"];
export const detColor = (det: number) => DET_COLOR[det - 1] ?? "#fff";
/** perceptual-ish rainbow from 0.75 µm (blue) to 5 µm (red), used wherever a mark stands for a wavelength */
export function lamColor(um: number) {
  const t = Math.min(1, Math.max(0, (um - 0.75) / 4.25)), stops = [[110, 168, 255], [86, 208, 224], [116, 221, 143], [240, 211, 91], [255, 157, 77], [255, 93, 108]];
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i, c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
function niceTicks(lo: number, hi: number, n = 4): number[] {
  const span = hi - lo || 1, step0 = Math.pow(10, Math.floor(Math.log10(span / n))), step = [1, 2, 5, 10].map((m) => m * step0).find((s) => span / s <= n + 1) ?? step0 * 10;
  const out: number[] = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(10)); return out;
}
const fmtNum = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(2));

/** molecular and atomic features SPHEREx resolves; shown as faint guides */
export const FEATURES: { um: number; w: number; label: string; what: string }[] = [
  { um: 1.4, w: 0.12, label: "H₂O", what: "water vapour" }, { um: 1.9, w: 0.14, label: "H₂O", what: "water vapour" }, { um: 2.3, w: 0.1, label: "CO", what: "carbon monoxide (cool giants)" },
  { um: 2.7, w: 0.2, label: "H₂O", what: "water vapour" }, { um: 3.05, w: 0.12, label: "ice", what: "water ice on dust grains" }, { um: 3.3, w: 0.16, label: "CH₄", what: "methane (cold brown dwarfs, planets)" },
  { um: 4.27, w: 0.1, label: "CO₂", what: "carbon dioxide" }, { um: 4.67, w: 0.12, label: "CO", what: "carbon monoxide" },
];

export type SpecOpts = { current?: number; log?: boolean; anchors?: { um: number; mjy: number; label: string }[]; bins?: { lam: number; flux: number }[]; onPick?: (k: number) => void; onHover?: (k: number | null) => void };
export function drawSpectrum(el: HTMLElement, P: Phot[], o: SpecOpts = {}) {
  const W = 520, H = 250, L = 46, R = 12, T = 22, B = 30, l0 = 0.7, l1 = 5.1;
  const ok = P.filter((p) => isFinite(p.flux));
  if (ok.length < 3) { el.innerHTML = `<div class="bk-empty">Waiting for exposures…</div>`; return; }
  const vals = ok.filter((p) => !p.flagged).map((p) => p.flux).sort((a, b) => a - b), all = vals.length > 3 ? vals : ok.map((p) => p.flux).sort((a, b) => a - b);
  let hi = all[Math.min(all.length - 1, Math.floor(all.length * 0.985))] * 1.18, lo = Math.min(0, all[Math.floor(all.length * 0.02)] * 1.1);
  for (const a of o.anchors ?? []) if (a.mjy > hi && a.mjy < hi * 4) hi = a.mjy * 1.15;
  if (!(hi > lo)) hi = lo + 1;
  const useLog = !!o.log && hi > 0; const lmin = useLog ? Math.max(hi / 3000, Math.max(...ok.map((p) => p.err)) * 0.3 || hi / 1000) : 0;
  const X = (l: number) => L + ((l - l0) / (l1 - l0)) * (W - L - R);
  const Y = useLog ? (f: number) => T + (1 - (Math.log10(Math.max(f, lmin)) - Math.log10(lmin)) / (Math.log10(hi) - Math.log10(lmin))) * (H - T - B)
    : (f: number) => T + (1 - (f - lo) / (hi - lo)) * (H - T - B);
  const cy = (f: number) => Math.min(H - B, Math.max(T, Y(f)));
  let g = "";
  // detector bands
  DETECTORS.forEach((d, k) => { g += `<rect x="${X(d.lo)}" y="${H - B}" width="${X(d.hi) - X(d.lo)}" height="3" fill="${DET_COLOR[k]}" opacity=".9"/><text x="${(X(d.lo) + X(d.hi)) / 2}" y="${H - B + 13}" class="bk-ax" text-anchor="middle" fill="${DET_COLOR[k]}">D${d.det}</text>`; });
  for (const f of FEATURES) g += `<rect x="${X(f.um - f.w / 2)}" y="${T}" width="${X(f.um + f.w / 2) - X(f.um - f.w / 2)}" height="${H - T - B}" fill="#fff" opacity=".045"><title>${f.label}: ${f.what}</title></rect><text x="${X(f.um)}" y="${T - 7}" class="bk-ax" text-anchor="middle" opacity=".7">${f.label}</text>`;
  for (const l of [1, 2, 3, 4, 5]) g += `<text x="${X(l)}" y="${H - 4}" class="bk-ax" text-anchor="middle">${l} µm</text>`;
  const ticks = useLog ? [hi / 1000, hi / 100, hi / 10, hi].map((v) => +v.toPrecision(1)).filter((v) => v > lmin) : niceTicks(lo, hi, 4);
  for (const v of ticks) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#fff" opacity="${v === 0 ? 0.3 : 0.08}"/><text x="${L - 6}" y="${Y(v) + 3}" class="bk-ax" text-anchor="end">${fmtNum(v)}</text>`;
  g += `<text x="${L - 6}" y="${T - 8}" class="bk-ax" text-anchor="end">mJy</text>`;
  if (o.bins && o.bins.length > 2) g += `<polyline fill="none" stroke="#fff" stroke-width="1.2" opacity=".55" points="${o.bins.map((b) => `${X(b.lam).toFixed(1)},${cy(b.flux).toFixed(1)}`).join(" ")}"/>`;
  for (const p of ok) {
    const x = X(p.lam), col = p.flagged ? "#ff5d6c" : lamColor(p.lam);
    g += `<line x1="${x}" x2="${x}" y1="${cy(p.flux - p.err)}" y2="${cy(p.flux + p.err)}" stroke="${col}" opacity=".35"/>`;
    g += `<circle data-k="${p.k}" cx="${x.toFixed(1)}" cy="${cy(p.flux).toFixed(1)}" r="${p.k === o.current ? 5 : 2.6}" fill="${p.flagged ? "none" : col}" stroke="${p.k === o.current ? "#fff" : col}" stroke-width="${p.k === o.current ? 1.6 : 1}" class="bk-pt"/>`;
  }
  for (const a of o.anchors ?? []) g += `<g opacity=".95"><rect x="${X(a.um) - 4}" y="${cy(a.mjy) - 4}" width="8" height="8" fill="none" stroke="#fff" stroke-width="1.3" transform="rotate(45 ${X(a.um)} ${cy(a.mjy)})"/><text x="${X(a.um) + 8}" y="${cy(a.mjy) - 6}" class="bk-ax" fill="#fff">${esc(a.label)}</text></g>`;
  el.innerHTML = `<svg class="bk-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spectrum measured from the exposures">${g}</svg>`;
  wirePoints(el, o.onPick, o.onHover);
}
function wirePoints(el: HTMLElement, onPick?: (k: number) => void, onHover?: (k: number | null) => void) {
  const svg = el.querySelector("svg"); if (!svg) return;
  svg.addEventListener("click", (e) => { const k = (e.target as Element).getAttribute?.("data-k"); if (k !== null && k !== undefined) onPick?.(+k); });
  svg.addEventListener("pointermove", (e) => { const k = (e.target as Element).getAttribute?.("data-k"); onHover?.(k !== null && k !== undefined ? +k : null); });
  svg.addEventListener("pointerleave", () => onHover?.(null));
}

export function drawLightCurve(el: HTMLElement, lc: LightCurve) {
  const W = 520, H = 240, L = 46, R = 14, T = 26, B = 30, S = [...lc.series, lc.all].filter((q) => q.visits.length >= 2);
  if (!S.length) { el.innerHTML = `<div class="bk-empty">Not enough exposures at matching wavelengths in two different visits yet. Try “All” exposures.</div>`; return; }
  const V = S.flatMap((q) => q.visits), t0 = Math.min(...V.map((v) => v.mjd)) - 8, t1 = Math.max(...V.map((v) => v.mjd)) + 8;
  const vmin = Math.max(0.03, Math.min(...V.map((v) => v.ratio - v.err))), vmax = Math.max(...V.map((v) => v.ratio + v.err)), useLog = vmax / vmin > 4;
  const lo = useLog ? vmin * 0.8 : Math.max(0, Math.min(0.7, vmin - 0.08)), hi = useLog ? vmax * 1.25 : Math.max(1.3, vmax + 0.08);
  const X = (m: number) => L + ((m - t0) / (t1 - t0)) * (W - L - R);
  const Y = (v: number) => { const q = Math.min(hi, Math.max(lo, v)); return T + (1 - (useLog ? (Math.log(q) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) : (q - lo) / (hi - lo))) * (H - T - B); };
  let g = `<line x1="${L}" x2="${W - R}" y1="${Y(1)}" y2="${Y(1)}" stroke="#fff" opacity=".35" stroke-dasharray="3 4"/><text x="${W - R}" y="${Y(1) - 5}" class="bk-ax" text-anchor="end">its own average</text>`;
  for (const v of useLog ? [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20].filter((q) => q > lo && q < hi) : niceTicks(lo, hi, 4)) g += `<text x="${L - 6}" y="${Y(v) + 3}" class="bk-ax" text-anchor="end">${v >= 10 ? v.toFixed(0) : v < 0.1 ? v.toFixed(2) : v.toFixed(1)}×</text><line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#fff" opacity=".06"/>`;
  const months = Math.max(1, Math.round((t1 - t0) / 30.4 / 5));
  for (let m = t0 + 8; m <= t1; m += 30.4 * months) g += `<text x="${X(m)}" y="${H - 8}" class="bk-ax" text-anchor="middle">${mjdToDate(m).slice(0, 7)}</text>`;
  for (const q of S) {
    const c = q.det ? detColor(q.det) : "#fff", wd = q.det ? 1.4 : 2.2;
    g += `<polyline fill="none" stroke="${c}" stroke-width="${wd}" opacity="${q.det ? 0.9 : 1}" points="${q.visits.map((v) => `${X(v.mjd).toFixed(1)},${Y(v.ratio).toFixed(1)}`).join(" ")}"/>`;
    for (const v of q.visits) g += `<line x1="${X(v.mjd)}" x2="${X(v.mjd)}" y1="${Y(v.ratio - v.err)}" y2="${Y(v.ratio + v.err)}" stroke="${c}"/><rect x="${X(v.mjd) - (q.det ? 3 : 4.5)}" y="${Y(v.ratio) - (q.det ? 3 : 4.5)}" width="${q.det ? 6 : 9}" height="${q.det ? 6 : 9}" fill="#000" stroke="${c}" stroke-width="${wd}"><title>${mjdToDate(v.mjd)} · ${q.det ? `detector ${q.det}` : "all detectors"}: ${v.ratio.toFixed(2)}× ± ${v.err.toFixed(2)} (${v.n} matched pairs)</title></rect>`;
  }
  const leg = [lc.all.visits.length >= 2 ? `<rect x="${L + 4}" y="6" width="9" height="9" fill="none" stroke="#fff" stroke-width="2"/><text x="${L + 18}" y="14" class="bk-ax" fill="#fff">all</text>` : "",
    ...DETECTORS.filter((d) => lc.series.some((q) => q.det === d.det)).map((d, k) => `<rect x="${L + 50 + k * 70}" y="7" width="7" height="7" fill="none" stroke="${detColor(d.det)}" stroke-width="1.5"/><text x="${L + 61 + k * 70}" y="14" class="bk-ax">${d.lo.toFixed(d.lo < 1 ? 2 : 1)}–${d.hi.toFixed(1)}</text>`)].join("");
  el.innerHTML = `<svg class="bk-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Brightness of each visit, per detector band">${g}${leg}</svg>`;
}

export function drawMotion(el: HTMLElement, m: Motion, o: { current?: number; onPick?: (k: number) => void } = {}) {
  const W = 520, H = 230, pad = 34, S = H - 2 * pad;
  const used = m.pts.filter((p) => p.used); if (!used.length) { el.innerHTML = ""; return; }
  const xs = used.map((p) => p.xi), ys = used.map((p) => p.eta), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const half = Math.max(3, (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2) * 1.25);
  // left: track on the sky (east to the left); right: offsets against time
  const PX = (xi: number) => pad + S / 2 - ((xi - cx) / half) * (S / 2), PY = (eta: number) => pad + S / 2 - ((eta - cy) / half) * (S / 2);
  const t0 = used[0].mjd, t1 = used[used.length - 1].mjd, x0 = pad * 2 + S + 26, TX = (mj: number) => x0 + ((mj - t0) / Math.max(1, t1 - t0)) * (W - x0 - 12);
  const col = (mj: number) => { const f = (mj - t0) / Math.max(1, t1 - t0); return `hsl(${200 - 170 * f},85%,${62}%)`; };
  let g = `<rect x="${pad}" y="${pad}" width="${S}" height="${S}" fill="none" stroke="#fff" opacity=".18"/><text x="${pad}" y="${pad - 8}" class="bk-ax">path on the sky · ${(2 * half).toFixed(0)}″ box · N up, E left</text>`;
  const model = (mj: number) => { const dt = (mj - m.t0) / 365.25; return [m.xi0 + m.pmra * dt, m.eta0 + m.pmdec * dt]; };
  const [a1, b1] = model(t0), [a2, b2] = model(t1);
  g += `<line x1="${PX(a1)}" y1="${PY(b1)}" x2="${PX(a2)}" y2="${PY(b2)}" stroke="#fff" stroke-width="1.2" opacity=".7"/>`;
  for (const p of m.pts) g += `<circle data-k="${p.k}" cx="${PX(p.xi).toFixed(1)}" cy="${PY(p.eta).toFixed(1)}" r="${p.k === o.current ? 5 : 2.6}" fill="${p.used ? col(p.mjd) : "none"}" stroke="${p.k === o.current ? "#fff" : p.used ? "none" : "#ffffff55"}" class="bk-pt"/>`;
  g += `<text x="${PX(a1)}" y="${PY(b1) + 14}" class="bk-ax" text-anchor="middle">${mjdToDate(t0).slice(0, 7)}</text><text x="${PX(a2)}" y="${PY(b2) - 8}" class="bk-ax" text-anchor="middle">${mjdToDate(t1).slice(0, 7)}</text>`;
  // right panel: two stacked series
  const hh = (S - 14) / 2, series = [{ key: "xi" as const, label: "east (″)", top: pad }, { key: "eta" as const, label: "north (″)", top: pad + hh + 14 }];
  for (const s of series) {
    const v = used.map((p) => p[s.key]), lo = Math.min(...v) - 0.8, hi = Math.max(...v) + 0.8, YY = (q: number) => s.top + (1 - (q - lo) / (hi - lo)) * hh;
    g += `<rect x="${x0}" y="${s.top}" width="${W - x0 - 12}" height="${hh}" fill="none" stroke="#fff" opacity=".12"/><text x="${x0 + 5}" y="${s.top + 12}" class="bk-ax">${s.label}</text>`;
    const q = (mj: number) => model(mj)[s.key === "xi" ? 0 : 1];
    g += `<line x1="${TX(t0)}" y1="${YY(q(t0))}" x2="${TX(t1)}" y2="${YY(q(t1))}" stroke="#fff" opacity=".7"/>`;
    for (const p of m.pts) if (p.used) g += `<circle data-k="${p.k}" cx="${TX(p.mjd).toFixed(1)}" cy="${YY(p[s.key]).toFixed(1)}" r="${p.k === o.current ? 4.5 : 2.2}" fill="${col(p.mjd)}" stroke="${p.k === o.current ? "#fff" : "none"}" class="bk-pt"/>`;
  }
  g += `<text x="${x0}" y="${H - 6}" class="bk-ax">${mjdToDate(t0)}</text><text x="${W - 12}" y="${H - 6}" class="bk-ax" text-anchor="end">${mjdToDate(t1)}</text>`;
  el.innerHTML = `<svg class="bk-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Measured positions over time">${g}</svg>`;
  wirePoints(el, o.onPick);
}
