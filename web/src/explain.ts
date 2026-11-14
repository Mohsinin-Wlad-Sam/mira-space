// Plain-language versions of the evidence graphs: a one-line takeaway, a picture a non-expert can read,
// and the scientist's plot one click away. Everything shown is computed from the same measurements.
import type { Obj } from "./data";

const HC_K = 14387.77;   // hc/k in µm·K
const FRIENDLY: Record<string, string> = { "H₂O": "water vapour", "CH₄": "methane", "H₂O ice": "water ice", "CO₂": "carbon dioxide", "CO": "carbon monoxide" };
const BANDS: [number, number, string, string][] = [
  [1.35, 1.45, "H₂O", "#5aa9ff"], [1.80, 1.95, "H₂O", "#5aa9ff"], [2.20, 2.40, "CH₄", "#c792ff"], [2.60, 2.85, "H₂O", "#5aa9ff"],
  [2.95, 3.15, "H₂O ice", "#7be0ff"], [3.20, 3.45, "CH₄", "#c792ff"], [4.20, 4.32, "CO₂", "#ffc857"], [4.45, 4.80, "CO", "#ff8f6b"]];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// planck F_nu shape vs wavelength (µm), arbitrary units
const bbNu = (lam: number, T: number) => Math.pow(lam, -3) / Math.expm1(HC_K / (lam * T));
// wavelength -> display hue: SPHEREx' 0.75–5 µm mapped onto a rainbow (violet = shortest, red = longest), as on the map's bar
function hue(lam: number) { const f = Math.min(1, Math.max(0, (lam - 0.75) / 4.25)); return 270 - 270 * f; }

export function describeTemp(T: number, kind: string): string {
  if (kind === "brown dwarf" || T < 2300) return T < 700 ? `a <b>very cold world</b> (≈${T} K, colder than an oven) — almost all of its light is infrared` :
    T < 1400 ? `a <b>cold brown dwarf</b> (≈${T} K) — too cool to burn hydrogen, glowing only in infrared` : `an <b>ultracool dwarf</b> (≈${T} K) — on the border between star and planet`;
  if (T < 3900) return `a <b>red dwarf star</b> (≈${T.toLocaleString()} K) — smaller and cooler than the Sun, the most common kind of star`;
  if (T < 5300) return `an <b>orange star</b> (≈${T.toLocaleString()} K), a bit cooler than the Sun`;
  if (T < 6300) return `a <b>Sun-like star</b> (≈${T.toLocaleString()} K)`;
  return `a <b>hot star</b> (≈${T.toLocaleString()} K) — hotter than the Sun, brightest at short wavelengths`;
}

/** Spectrum story: rainbow barcode + measured light vs. a plain glowing ball at the same temperature. */
export function spectrumStory(el: HTMLElement, lam: number[], spec: [number | null, number | null][], o: Obj, T: number, kind: string, scientist: () => void) {
  const idx = lam.map((_, i) => i).filter((i) => spec[i] && spec[i][0] !== null && (spec[i][0] as number) > 0).sort((a, b) => lam[a] - lam[b]);
  if (idx.length < 20) { el.innerHTML = `<div class="soon">Too faint for SPHEREx to split its light into colours.</div>`; return; }
  const L = idx.map((i) => lam[i]), F = idx.map((i) => spec[i][0] as number);
  // scale the blackbody to the data using channels outside molecular bands (least squares in log space)
  // scale the glowing-ball curve to the upper envelope of the measurement (85th percentile of measured/ball):
  // molecules only remove light, so the least-absorbed colours sit closest to the ball
  // reference = the object's own smooth upper envelope: where its light would be if molecules did not carve dips into it
  const Fsm = F.map((_, k) => { let t = 0, n = 0; for (let j = Math.max(0, k - 1); j <= Math.min(F.length - 1, k + 1); j++) { t += F[j]; n++; } return t / n; });
  const envMax = L.map((l) => Math.max(...Fsm.filter((_, j) => Math.abs(L[j] - l) <= 0.35)));
  const B = L.map((l, k) => { const w = envMax.filter((_, j) => Math.abs(L[j] - l) <= 0.25); return Math.max(Fsm[k], w.reduce((a, b) => a + b, 0) / w.length); });
  void bbNu;
  // deepest molecular dip
  const dips = BANDS.map(([a, b, name, col]) => {
    const ks = L.map((l, k) => [l, k] as const).filter(([l]) => l >= a && l <= b).map(([, k]) => k);
    if (ks.length < 2) return null;
    const r = ks.reduce((t, k) => t + F[k] / B[k], 0) / ks.length;
    return { a, b, name, col, r };
  }).filter(Boolean) as { a: number; b: number; name: string; col: string; r: number }[];
  // name methane at 3.3 µm first when it is significant: it is the census' signature of cold worlds
  const ch4 = dips.find((d) => d.name === "CH₄" && d.a > 3 && d.r < 0.75);
  const deep = ch4 ?? dips.filter((d) => d.r < 0.75).sort((x, y) => x.r - y.r)[0];
  const peakL = L[F.indexOf(Math.max(...F))];
  const excess = (o.idx_hotdust ?? 0) > 0.5;
  // ---- svg: one smoothed line, the reference curve, a single callout. Nothing else.
  const W = 420, H = 190, padL = 6, padR = 6, top = 30, bot = 26;
  const lmin = 0.75, lmax = 5.0, X = (l: number) => padL + (l - lmin) / (lmax - lmin) * (W - padL - padR);
  const Fs = F.map((_, k) => { let t = 0, n = 0; for (let j = Math.max(0, k - 1); j <= Math.min(F.length - 1, k + 1); j++) { t += F[j]; n++; } return t / n; });   // 3-channel smoothing
  const ymax = Math.max(...Fs, ...B) * 1.08;
  const Y = (v: number) => top + (1 - v / ymax) * (H - top - bot);
  const path = (vals: number[]) => vals.map((v, k) => `${k ? "L" : "M"}${X(L[k]).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const grad = `<linearGradient id="spg" x1="0" x2="1">${[0.75, 1.5, 2.5, 3.5, 5].map((l) => `<stop offset="${((l - lmin) / (lmax - lmin)).toFixed(2)}" stop-color="hsl(${hue(l)},85%,62%)"/>`).join("")}</linearGradient>`;
  let callout = "";
  if (deep) {
    const xm = (X(deep.a) + X(deep.b)) / 2, ks = L.map((l, k) => [l, k] as const).filter(([l]) => l >= deep.a && l <= deep.b).map(([, k]) => k);
    const yLow = Math.max(...ks.map((k) => Y(Fs[k]))), yRef = Math.min(...ks.map((k) => Y(B[k])));
    callout = `<line x1="${xm}" x2="${xm}" y1="${yRef + 2}" y2="${yLow - 3}" stroke="${deep.col}" stroke-width="1.2" stroke-dasharray="2 2"/>
      <text x="${xm}" y="${Math.max(12, yRef - 8)}" fill="${deep.col}" font-size="12" font-weight="600" text-anchor="middle">${FRIENDLY[deep.name]} −${Math.round((1 - deep.r) * 100)}%</text>`;
  }
  const ticks = [[1, "1 µm"], [3, "3 µm"], [5, "5 µm"]].map(([l, t]) => `<text x="${X(l as number).toFixed(1)}" y="${H - 6}" fill="#8b97b3" font-size="10" text-anchor="${l === 5 ? "end" : "middle"}">${t}</text>`).join("");
  // ---- takeaway
  const lead = `It is ${describeTemp(Math.round(T / 10) * 10, kind)}.`;
  const dipTxt = deep ? ` <b style="color:${deep.col}">${FRIENDLY[deep.name][0].toUpperCase() + FRIENDLY[deep.name].slice(1)}</b> in its atmosphere swallows about <b>${Math.round((1 - deep.r) * 100)}%</b> of its light near ${((deep.a + deep.b) / 2).toFixed(1)} µm.` : "";
  const dustTxt = excess ? ` It glows <b>more than a star should</b> at the long-wavelength end — the sign of warm dust around it.` : "";
  const peakTxt = peakL > 3.5 ? ` Its light peaks at ${peakL.toFixed(1)} µm — far beyond what eyes can see.` : peakL < 1.2 ? ` It is brightest at the short, near-visible end.` : "";
  el.innerHTML = `<p class="story">${lead}${dipTxt}${dustTxt}${peakTxt}</p>
    <svg class="specstory" viewBox="0 0 ${W} ${H}" role="img" aria-label="Brightness of this object across SPHEREx's infrared colours">
      <defs>${grad}</defs>
      <line x1="${padL}" x2="${W - padR}" y1="${Y(0)}" y2="${Y(0)}" stroke="#ffffff22"/>
      <path d="${path(B)}" fill="none" stroke="#fff" stroke-width="1.2" stroke-dasharray="4 4" opacity=".55"/>
      <path d="${path(Fs)}" fill="none" stroke="url(#spg)" stroke-width="2.6" stroke-linejoin="round"/>
      ${callout}${ticks}
    </svg>
    <div class="legendline"><span><i class="sw" style="background:linear-gradient(90deg,#7d5cff,#ff5c6c)"></i>its light, colour by colour</span>
      <span><i class="sw dash"></i>its light without the dips</span></div>
    <p class="note">Left = shorter infrared waves, right = longer. Higher = brighter. Where its line sinks below the dashed one, molecules in or around it are absorbing light.</p>
    <button class="btn sm ghost sci">Scientist view</button>`;
  (el.querySelector(".sci") as HTMLButtonElement).onclick = () => scientist();
}

/** Light-curve story: brightness relative to 2010, on a plain timeline with mission eras. */
export async function lightStory(el: HTMLElement, id: string, saturated: boolean, scientist: () => void) {
  const r = await fetch(`${import.meta.env.BASE_URL}data/lc/${id}.json`, { cache: "no-store" });
  if (!r.ok || (r.headers.get("content-type") ?? "").includes("html")) return false;
  const d = await r.json() as { points: { mjd: number; band: string; uJy: number }[]; spherex: { mjd: number; w2_uJy: number } | null };
  const yr = (mjd: number) => 2000 + (mjd - 51544.5) / 365.25;
  const w2 = d.points.filter((p) => p.band === "W2" && p.uJy > 0).map((p) => ({ t: yr(p.mjd), v: p.uJy })).sort((a, b) => a.t - b.t);
  if (w2.length < 3) return false;
  const early = w2.filter((p) => p.t < 2012); const base = (early.length ? early : w2.slice(0, 3)).map((p) => p.v).sort((a, b) => a - b);
  const b0 = base[Math.floor(base.length / 2)];
  const pts = w2.map((p) => ({ t: p.t, r: p.v / b0 }));
  const sx = d.spherex && d.spherex.w2_uJy > 0 && !saturated ? { t: yr(d.spherex.mjd), r: d.spherex.w2_uJy / b0 } : null;
  const last = sx ?? pts[pts.length - 1];
  const rs = pts.map((p) => p.r); const amp = Math.max(...rs) / Math.min(...rs);
  const ch = last.r - 1;
  const head = Math.abs(ch) < 0.12 && amp < 1.3 ? `<b>Steady.</b> Its infrared brightness barely changed in 16 years (within ${Math.round((amp - 1) * 50)}%).`
    : ch <= -0.5 ? `<b>Faded by ${Math.round(-ch * 100)}%</b> between 2010 and ${Math.round(last.t)}. Something dimmed it — dust passing in front, or an outburst ending.`
    : ch >= 0.5 ? `<b>${(last.r).toFixed(1)}× brighter</b> in ${Math.round(last.t)} than in 2010.`
    : `Its brightness <b>${ch > 0 ? "rose" : "fell"} ${Math.round(Math.abs(ch) * 100)}%</b> by ${Math.round(last.t)}${amp > 1.5 ? `, and swung up and down by ×${amp.toFixed(1)} along the way` : ""}.`;
  const W = 420, H = 190, t0 = 2009.5, t1 = 2026.5, top = 18, bot = 30;
  const ymax = Math.max(1.3, ...rs, sx?.r ?? 0) * 1.12;
  const X = (t: number) => 10 + (t - t0) / (t1 - t0) * (W - 20), Y = (v: number) => top + (1 - v / ymax) * (H - top - bot);
  const line = pts.map((p, k) => `${k ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.r).toFixed(1)}`).join("");
  el.innerHTML = `<p class="story">${head}</p>
    <svg class="lcstory" viewBox="0 0 ${W} ${H}" role="img" aria-label="Brightness over time relative to 2010">
      <rect x="${X(2010)}" y="${top}" width="${X(2020.9) - X(2010)}" height="${H - top - bot}" fill="#ffc85710"/>
      <rect x="${X(2025.3)}" y="${top}" width="${X(2026.3) - X(2025.3)}" height="${H - top - bot}" fill="#ff5cf014"/>
      <text x="${X(2015.4)}" y="${H - bot + 22}" fill="#ffc857" font-size="10" text-anchor="middle">WISE spacecraft 2010–2020</text>
      <text x="${X(2025.8)}" y="${H - bot + 22}" fill="#ff8ad8" font-size="10" text-anchor="middle">SPHEREx</text>
      <line x1="${X(t0)}" x2="${X(t1)}" y1="${Y(1)}" y2="${Y(1)}" stroke="#fff" stroke-dasharray="3 4" opacity=".45"/>
      <text x="${X(t1) - 2}" y="${Y(1) - 5}" fill="#cfd6e6" font-size="9" text-anchor="end">2010 level</text>
      <path d="${line}" fill="none" stroke="#ffc857" stroke-width="1.6" opacity=".8"/>
      ${pts.map((p) => `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.r).toFixed(1)}" r="2.2" fill="#ffc857"/>`).join("")}
      ${sx ? `<line x1="${X(pts[pts.length - 1].t)}" y1="${Y(pts[pts.length - 1].r)}" x2="${X(sx.t)}" y2="${Y(sx.r)}" stroke="#ff8ad8" stroke-dasharray="2 4" opacity=".7"/>
        <circle cx="${X(sx.t).toFixed(1)}" cy="${Y(sx.r).toFixed(1)}" r="7" fill="#ff5cf0" stroke="#fff" stroke-width="1.5"/>
        <text x="${X(sx.t) - 10}" y="${Y(sx.r) - 11}" fill="#fff" font-size="10" text-anchor="end">${Math.round(sx.r * 100)}% of 2010</text>` : ""}
    </svg>
    <p class="note">Each yellow dot is one WISE visit (about every six months); the pink dot is SPHEREx a decade later, measured in the same colour band. The dashed line is how bright it was in 2010.</p>
    <button class="btn sm ghost sci">Scientist view</button>`;
  (el.querySelector(".sci") as HTMLButtonElement).onclick = () => scientist();
  return true;
}

/** Twins on a little all-sky map: same chemistry, different places. */
export function twinsSky(twins: { ra: number; dec: number }[], self: { ra: number; dec: number }): string {
  const W = 360, H = 180;
  const aitoff = (ra: number, dec: number) => {
    let l = ((ra + 180) % 360) - 180; l = -l * Math.PI / 180; const b = dec * Math.PI / 180;   // RA increases to the left, as on the sky
    const a = Math.acos(Math.cos(b) * Math.cos(l / 2)), s = a ? Math.sin(a) / a : 1;
    return [W / 2 + (2 * Math.cos(b) * Math.sin(l / 2) / s) * (W / (4 * Math.PI)) * 1.0 * 1.98, H / 2 - (Math.sin(b) / s) * (H / Math.PI) * 0.98];
  };
  const grid = [-60, -30, 0, 30, 60].map((d) => { const ps = Array.from({ length: 37 }, (_, k) => aitoff(-180 + k * 10, d)); return `<path d="${ps.map((p, k) => `${k ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("")}" stroke="#ffffff14" fill="none"/>`; }).join("");
  const [sx, sy] = aitoff(self.ra, self.dec);
  return `<svg class="twinsky" viewBox="0 0 ${W} ${H}"><ellipse cx="${W / 2}" cy="${H / 2}" rx="${W / 2 - 2}" ry="${H / 2 - 2}" fill="#0a0d18" stroke="#ffffff30"/>${grid}
    ${twins.map((t, k) => { const [x, y] = aitoff(t.ra, t.dec); return `<line x1="${sx}" y1="${sy}" x2="${x}" y2="${y}" stroke="#c792ff33"/><circle class="tw" data-k="${k}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="#c792ff"><title>twin #${k + 1}</title></circle>`; }).join("")}
    <circle cx="${sx}" cy="${sy}" r="6" fill="#fff"/><text x="${sx + 9}" y="${sy + 4}" fill="#fff" font-size="10">this object</text></svg>`;
}
export { esc };
