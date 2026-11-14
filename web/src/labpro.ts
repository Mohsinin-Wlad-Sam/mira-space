// MIRA Lab — experiments that run the BLINK engine on NASA's SPHEREx exposures, live in the browser:
//   planetx   could SPHEREx see a planet beyond Neptune? (photometric + astrometric detectability)
//   parallax  measure a nearby object's motion and distance yourself, with bootstrap uncertainties
//   hunt      vet the census's brown-dwarf candidates one by one and export a report
//   batch     run a whole target list through the engine and get a table
import { build, FLAG_DEFS, PIX_ARCSEC, mjdToDate, type Frame, type Target } from "./blink/engine";
import { spectrum, haloSeries, lightCurve, fitMotion, parallaxFactors, PLX_SYS, type Motion } from "./blink/measure";
import { CHALLENGE, parseCoords, resolveName } from "./blink/catalogs";
import { detColor, drawMotion } from "./blink/plots";
import type { BlinkTarget } from "./blink/view";
import { sexa } from "./data";

const BASE = import.meta.env.BASE_URL;
export type LabCtx = { onBlink: (t: BlinkTarget) => void };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const verdict = (ok: boolean | null, html: string) => `<div class="verdict ${ok === null ? "" : ok ? "yes" : "no"}">${html}</div>`;
const how = (html: string) => `<details class="how"><summary>How we did it</summary><p>${html}</p></details>`;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const pm = (v: number, d = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;
function save(blob: Blob, name: string) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

/** a result worth showing to a friend: one PNG with the question, the answer and where it came from */
export function shareCard(question: string, answer: string, detail: string) {
  const W = 1200, H = 630, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d")!;
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  for (let k = 0; k < 220; k++) { const x = (Math.sin(k * 91.7) * 0.5 + 0.5) * W, y = (Math.sin(k * 37.3 + 1) * 0.5 + 0.5) * H; g.fillStyle = `rgba(240,240,250,${0.15 + 0.5 * ((k * 7) % 10) / 10})`; g.fillRect(x, y, 1.6, 1.6); }
  g.strokeStyle = "rgba(240,240,250,.35)"; g.lineWidth = 1; g.strokeRect(40.5, 40.5, W - 81, H - 81);
  const wrap = (text: string, x: number, y: number, maxW: number, lh: number) => { let line = ""; for (const w of text.split(" ")) { if (g.measureText(line + w).width > maxW && line) { g.fillText(line.trim(), x, y); y += lh; line = ""; } line += w + " "; } g.fillText(line.trim(), x, y); return y + lh; };
  g.fillStyle = "rgba(240,240,250,.7)"; g.font = '500 22px "JetBrains Mono", monospace'; g.fillText("MIRA LAB  ·  MEASURED FROM NASA SPHEREX DATA", 80, 112);
  g.fillStyle = "rgb(240,240,250)"; g.font = '700 46px "Barlow Semi Condensed", "Barlow", Arial, sans-serif'; let y = wrap(question.toUpperCase(), 80, 196, W - 160, 54);
  g.font = '700 76px "Barlow Semi Condensed", "Barlow", Arial, sans-serif'; y = wrap(answer.toUpperCase(), 80, y + 56, W - 160, 82);
  g.fillStyle = "rgba(240,240,250,.82)"; g.font = '400 27px "Barlow", Arial, sans-serif'; wrap(detail, 80, y + 6, W - 160, 38);
  g.fillStyle = "rgba(240,240,250,.6)"; g.font = '500 20px "JetBrains Mono", monospace'; g.fillText(`${location.host}/explore/  ·  ${new Date().toISOString().slice(0, 10)}`, 80, H - 78);
  c.toBlob((b) => b && save(b, "mira_result.png"));
}

// ============================================================================ Planet X: could SPHEREx see it?
const H_PLANCK = 6.62607015e-34, C_LIGHT = 2.99792458e8, K_B = 1.380649e-23, AU_KM = 1.495978707e8, R_EARTH_KM = 6371, R_SUN_KM = 695700, T_SUN = 5772, PC_AU = 206264.806;
/** Planck function B_ν (W m⁻² Hz⁻¹ sr⁻¹) at wavelength λ (µm) and temperature T (K) */
const planck = (um: number, T: number) => { const nu = C_LIGHT / (um * 1e-6), x = (H_PLANCK * nu) / (K_B * T); return x > 600 ? 0 : (2 * H_PLANCK * nu * nu * nu) / (C_LIGHT * C_LIGHT) / Math.expm1(x); };
/** sunlight at 1 au (W m⁻² Hz⁻¹): the Sun as a 5,772 K blackbody */
const sunAt1au = (um: number) => Math.PI * planck(um, T_SUN) * Math.pow(R_SUN_KM / AU_KM, 2);
/** flux density (mJy) of a body of radius R (Earth radii), geometric albedo p and temperature T at d au from the Sun and Earth:
 *  reflected sunlight p (R/d)² F☉(1 au)/d² plus its own blackbody glow π B_ν(T) (R/d)² */
function bodyFlux(um: number, R: number, p: number, T: number, dAU: number) {
  const k = Math.pow((R * R_EARTH_KM) / (dAU * AU_KM), 2);
  return { reflected: ((p * k * sunAt1au(um)) / (dAU * dAU)) * 1e29, thermal: Math.PI * planck(um, T) * k * 1e29 };
}
const DET_UM = [0.93, 1.37, 2.03, 3.1, 4.12, 4.72];
type World = { k: string; name: string; twin?: string; d0pc?: number; R?: number; p?: number; T?: number; d: number; unit: "au" | "pc"; range: [number, number]; note: string };
const WORLDS: World[] = [
  { k: "p9", name: "Planet Nine, as proposed", R: 2.9, p: 0.4, T: 45, d: 500, unit: "au", range: [60, 3000], note: "About six Earth masses on a 300–800 au orbit (Brown & Batygin 2021). Its size and how much sunlight it reflects are assumptions: change them." },
  { k: "nep", name: "A second Neptune", R: 3.86, p: 0.3, T: 59, d: 200, unit: "au", range: [30, 3000], note: "Neptune itself is at 30 au. Giant planets are dark in methane bands, so the true near-infrared albedo may be lower." },
  { k: "jup", name: "A second Jupiter", R: 10.97, p: 0.4, T: 125, d: 1000, unit: "au", range: [30, 30000], note: "Reflected light plus a 125 K blackbody. Real giant planets leak extra heat near 5 µm, so this is a lower limit there." },
  { k: "w0855", name: "A twin of WISE 0855 (the coldest brown dwarf)", twin: "wise-0855", d0pc: 2.28, d: 4, unit: "pc", range: [0.5, 60], note: "Scaled from what MIRA measured for the real one at 7.4 light-years: it only shines at 4–5 µm." },
  { k: "epsb", name: "A twin of ε Indi B (methane brown dwarfs)", twin: "eps-indi-b", d0pc: 3.64, d: 20, unit: "pc", range: [1, 400], note: "Scaled from MIRA's measured spectrum of the real pair at 11.9 light-years." },
];

export function planetx(P: HTMLElement, S: HTMLElement): () => void {
  let val: any = null, w = WORLDS[0], d = w.d, R = w.R ?? 1, alb = w.p ?? 0.4, stackN = 1;
  S.innerHTML = `<label class="lrow"><span>The object</span><select id="pw">${WORLDS.map((x) => `<option value="${x.k}">${esc(x.name)}</option>`).join("")}</select></label>
    <label class="lrow"><span>Distance</span><input type="range" id="pd" min="0" max="1" step="0.002"><b id="pdv"></b></label>
    <label class="lrow" id="prow"><span>Radius</span><input type="range" id="pr" min="0.5" max="14" step="0.1"><b id="prv"></b></label>
    <label class="lrow" id="arow"><span>Reflectivity</span><input type="range" id="pa" min="0.05" max="0.9" step="0.05"><b id="pav"></b></label>
    <label class="lrow"><span>Exposures added</span><input type="range" id="pn" min="0" max="8" step="1" value="0"><b id="pnv"></b></label>
    <p class="note" id="pnote"></p><div id="pres"></div>
    <button class="btn sm ghost" id="pshare">Save this result as an image</button>` +
    how(`Reflected sunlight: geometric albedo × (radius ÷ distance)² × the Sun's flux at 1 au ÷ distance². Own glow: a blackbody of the object's temperature. “Twins” are the spectra MIRA measured for the real objects, dimmed with the square of distance.
      The detection limits are not from a brochure: they are the 5σ point-source noise MIRA measured in single SPHEREx exposures of two ordinary fields (the validation run), per detector; adding N exposures lowers them by √N.
      Parallax swing = 206,265″ ÷ distance in au, seen twice a year from opposite sides of Earth's orbit; orbital drift assumes a circular orbit around the Sun. Stars and brown dwarfs are given a typical 30 km/s sideways speed.`);
  const $ = <T extends HTMLElement>(q: string) => S.querySelector(q) as T;
  const limits = () => { const L = [0.2, 0.16, 0.15, 0.13, 0.26, 0.47];        // fallback: the values of the Nov 2026 validation run
    if (val) for (let k = 0; k < 6; k++) { const v = (val.targets as any[]).filter((t) => !t.saturated).map((t) => t.detectors?.[k]?.limit5_mJy).filter((x: any) => x > 0); if (v.length) L[k] = v.reduce((a: number, b: number) => a + b, 0) / v.length; }
    return L; };
  const fluxes = (dist: number): number[] => {
    if (w.twin) { const t = (val?.targets as any[] | undefined)?.find((x) => x.key === w.twin), base = t?.detectors?.map((q: any) => q.flux_mJy ?? 0) ?? (w.twin === "wise-0855" ? [0, 0, 0, 0, 0.45, 0.46] : [1.2, 21.3, 13.7, 9, 50.3, 18.7]);
      const f = Math.pow(w.d0pc! / dist, 2); return base.map((b: number, k: number) => (w.twin === "wise-0855" && k < 4 ? 0 : b * f)); }   // below 4 µm the real one is blended with a background star
    return DET_UM.map((um) => { const q = bodyFlux(um, R, alb, w.T!, dist); return q.reflected + q.thermal; });
  };
  const fromSlider = (v: number) => w.range[0] * Math.pow(w.range[1] / w.range[0], v), toSlider = (x: number) => Math.log(x / w.range[0]) / Math.log(w.range[1] / w.range[0]);
  function pick(k: string) { w = WORLDS.find((x) => x.k === k)!; d = w.d; R = w.R ?? 1; alb = w.p ?? 0.4;
    ($("#pd") as HTMLInputElement).value = String(toSlider(d)); ($("#pr") as HTMLInputElement).value = String(R); ($("#pa") as HTMLInputElement).value = String(alb);
    $("#prow").style.display = $("#arow").style.display = w.twin ? "none" : ""; $("#pnote").textContent = w.note; draw(); }
  let last = { q: "", a: "", s: "" };
  function draw() {
    const L = limits(), F = fluxes(d), Ls = L.map((x) => x / Math.sqrt(stackN)), dAU = w.unit === "au" ? d : d * PC_AU;
    $("#pdv").textContent = w.unit === "au" ? `${d < 100 ? d.toFixed(0) : Math.round(d / 10) * 10} au` : `${d.toFixed(d < 10 ? 1 : 0)} pc · ${(d * 3.2616).toFixed(0)} ly`;
    $("#prv").textContent = `${R.toFixed(1)} Earths`; $("#pav").textContent = `${Math.round(alb * 100)}%`; $("#pnv").textContent = stackN === 1 ? "1 (single)" : `${stackN}`;
    // chart: flux per detector against the single-exposure and stacked limits
    const W = 620, H = 380, l = 64, r = 20, t = 30, b = 46, lo = -5, hi = Math.max(2, Math.ceil(Math.log10(Math.max(...F, 1)) + 0.5));
    const X = (k: number) => l + ((k + 0.5) / 6) * (W - l - r), Y = (mJy: number) => t + (1 - (Math.log10(Math.max(mJy, 1e-9)) - lo) / (hi - lo)) * (H - t - b), bw = ((W - l - r) / 6) * 0.42;
    let g = "";
    for (let e = lo; e <= hi; e++) g += `<line x1="${l}" x2="${W - r}" y1="${Y(Math.pow(10, e))}" y2="${Y(Math.pow(10, e))}" stroke="#fff" opacity=".07"/><text x="${l - 8}" y="${Y(Math.pow(10, e)) + 4}" class="bk-ax" text-anchor="end">${e >= 0 ? Math.pow(10, e) : e >= -3 ? Math.pow(10, e).toFixed(-e) : `10^${e}`}</text>`;
    g += `<text x="${l - 8}" y="${t - 12}" class="bk-ax" text-anchor="end">mJy</text>`;
    F.forEach((f, k) => { const seen = f > Ls[k], y = Math.min(H - b, Y(f));
      g += `<rect x="${X(k) - bw / 2}" y="${y}" width="${bw}" height="${Math.max(0, H - b - y)}" fill="${detColor(k + 1)}" opacity="${seen ? 0.95 : 0.3}"/>
        <line x1="${X(k) - bw}" x2="${X(k) + bw}" y1="${Y(L[k])}" y2="${Y(L[k])}" stroke="#fff" stroke-width="1.4" stroke-dasharray="4 4"/>
        ${stackN > 1 ? `<line x1="${X(k) - bw}" x2="${X(k) + bw}" y1="${Y(Ls[k])}" y2="${Y(Ls[k])}" stroke="#fff" stroke-width="2.2"/>` : ""}
        <text x="${X(k)}" y="${H - b + 16}" class="bk-ax" text-anchor="middle" fill="${detColor(k + 1)}">${DET_UM[k]} µm</text><text x="${X(k)}" y="${H - b + 30}" class="bk-ax" text-anchor="middle">${f > 0 ? (seen ? `${(f / Ls[k]).toFixed(f / Ls[k] > 10 ? 0 : 1)}× limit` : "too faint") : "no light"}</text>`; });
    g += `<text x="${W - r}" y="${t - 12}" class="bk-ax" text-anchor="end">- - one exposure, 5σ${stackN > 1 ? ` · —— ${stackN} exposures added` : ""}</text>`;
    P.innerHTML = `<svg class="bk-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Predicted brightness in SPHEREx's six detectors against the detection limits">${g}</svg>`;
    // motion on the sky
    const par = 206264.806 / dAU, orbit = w.unit === "au" ? 1.2958e6 * Math.pow(dAU, -1.5) : 30 / (4.74047 * d), swing = 2 * par;
    const seenSingle = F.map((f, k) => f > L[k]), seenStack = F.map((f, k) => f > Ls[k]), names = (m: boolean[]) => m.map((v, k) => (v ? `${DET_UM[k]} µm` : "")).filter(Boolean).join(", ");
    // farthest distance at which the best detector still sees it
    let dmax = 0; for (let q = 0; q <= 400; q++) { const x = w.range[0] * Math.pow((w.range[1] * 30) / w.range[0], q / 400), f = fluxes(x); if (f.some((v, k) => v > Ls[k])) dmax = x; }
    const far = w.unit === "au" ? `${dmax < 1000 ? Math.round(dmax / 10) * 10 : Math.round(dmax / 100) * 100} au` : `${dmax.toFixed(dmax < 10 ? 1 : 0)} pc (${(dmax * 3.2616).toFixed(0)} light-years)`;
    const moveTxt = `Between two SPHEREx passes six months apart it would jump by up to <b>${swing >= 60 ? `${(swing / 60).toFixed(1)}′` : `${swing.toFixed(1)}″`}</b> from parallax alone (${(swing / PIX_ARCSEC).toFixed(swing / PIX_ARCSEC < 10 ? 1 : 0)} pixels)${w.unit === "au" ? `, and drift ${orbit.toFixed(orbit < 10 ? 1 : 0)}″ a year along its orbit` : `, and drift about ${orbit.toFixed(2)}″ a year`}.`;
    const any1 = seenSingle.some(Boolean), anyN = seenStack.some(Boolean);
    const ans = any1 ? "Yes, in single exposures" : anyN ? `Only by adding ${stackN} exposures` : "No: too faint";
    $("#pres").innerHTML = verdict(any1 ? true : anyN ? null : false, any1 ? `<b>Yes.</b> SPHEREx would catch it in single exposures at ${names(seenSingle)}. ${moveTxt} A blink would show it at once — if someone looked.`
      : anyN ? `<b>Only in a stack.</b> Adding ${stackN} exposures brings it out at ${names(seenStack)}. ${moveTxt} So the stack has to follow its motion (“Follow target” in Blink), and nobody knows that motion in advance: every plausible path must be tried.`
      : `<b>No.</b> Even with ${stackN} exposure${stackN > 1 ? "s" : ""} added it stays below SPHEREx's limit${F.some((f) => f > 0) ? ` by a factor of ${Math.min(...F.map((f, k) => (f > 0 ? Ls[k] / f : Infinity))).toFixed(0)}` : ""}. ${moveTxt}`) +
      `<p class="note">With this setting SPHEREx could see such an object out to about <b>${far}</b>.${w.k === "p9" ? " That is why Planet Nine, if it exists, is a job for a deep optical survey such as Rubin — and why SPHEREx's strength is cold, self-luminous neighbours instead." : ""}</p>`;
    last = { q: `Could SPHEREx see ${w.name.replace(/^A /, "a ").replace(/^Planet/, "Planet")} at ${$("#pdv").textContent}?`, a: ans, s: `Visible out to about ${far.replace(/<[^>]+>/g, "")} with ${stackN} exposure${stackN > 1 ? "s" : ""} added. It would shift ${(swing / PIX_ARCSEC).toFixed(0)} SPHEREx pixels between two passes.` };
  }
  ($("#pw") as HTMLSelectElement).onchange = (e) => pick((e.target as HTMLSelectElement).value);
  $("#pd").oninput = (e) => { d = fromSlider(+(e.target as HTMLInputElement).value); draw(); };
  $("#pr").oninput = (e) => { R = +(e.target as HTMLInputElement).value; draw(); };
  $("#pa").oninput = (e) => { alb = +(e.target as HTMLInputElement).value; draw(); };
  $("#pn").oninput = (e) => { stackN = Math.pow(2, +(e.target as HTMLInputElement).value); draw(); };
  $("#pshare").onclick = () => shareCard(last.q, last.a, last.s);
  fetch(`${BASE}validation.json`).then((r) => (r.ok ? r.json() : null)).then((v) => { val = v; draw(); }).catch(() => {});
  pick("p9");
  return () => {};
}

// ============================================================================ measure a distance yourself
/** residuals from the straight-line motion, against the fitted parallax curve */
function drawWobble(el: HTMLElement, m: Motion, center: [number, number]) {
  const W = 620, H = 300, l = 52, r = 16, used = m.pts.filter((p) => p.used), t0 = used[0].mjd - 15, t1 = used[used.length - 1].mjd + 15, plx = m.plx ?? 0;
  const X = (mjd: number) => l + ((mjd - t0) / (t1 - t0)) * (W - l - r);
  const rows = [{ key: "xi" as const, lab: "east–west swing (″)", pf: 0, mu: m.pmra, z: m.xi0, top: 26 }, { key: "eta" as const, lab: "north–south swing (″)", pf: 1, mu: m.pmdec, z: m.eta0, top: 160 }];
  let g = "";
  for (const row of rows) {
    const res = used.map((p) => ({ mjd: p.mjd, v: p[row.key] - (row.z + (row.mu * (p.mjd - m.t0)) / 365.25), visit: p.visit })), amp = Math.max(1.2, plx * 1.3, median(res.map((q) => Math.abs(q.v))) * 3), h = 108;
    const Y = (v: number) => row.top + (1 - (Math.max(-amp, Math.min(amp, v)) + amp) / (2 * amp)) * h;
    g += `<rect x="${l}" y="${row.top}" width="${W - l - r}" height="${h}" fill="none" stroke="#fff" opacity=".14"/><line x1="${l}" x2="${W - r}" y1="${Y(0)}" y2="${Y(0)}" stroke="#fff" opacity=".2"/>
      <text x="${l + 6}" y="${row.top + 14}" class="bk-ax">${row.lab}</text><text x="${l - 6}" y="${Y(amp) + 9}" class="bk-ax" text-anchor="end">+${amp.toFixed(1)}</text><text x="${l - 6}" y="${Y(-amp)}" class="bk-ax" text-anchor="end">−${amp.toFixed(1)}</text>`;
    let path = ""; for (let mjd = t0; mjd <= t1; mjd += 4) path += `${X(mjd).toFixed(1)},${Y(plx * parallaxFactors(center[0], center[1], mjd)[row.pf]).toFixed(1)} `;
    g += `<polyline fill="none" stroke="#fff" stroke-width="1.6" points="${path}"/>`;
    for (const q of res) g += `<circle cx="${X(q.mjd).toFixed(1)}" cy="${Y(q.v).toFixed(1)}" r="2" fill="#7cc4ff" opacity=".45"/>`;
    const by = new Map<number, typeof res>(); res.forEach((q) => (by.get(q.visit) ?? by.set(q.visit, []).get(q.visit)!).push(q));
    for (const L of by.values()) if (L.length >= 3) { const v = median(L.map((q) => q.v)), mj = L.reduce((s, q) => s + q.mjd, 0) / L.length, e = (median(L.map((q) => Math.abs(q.v - v))) * 1.4826) / Math.sqrt(L.length);
      g += `<line x1="${X(mj)}" x2="${X(mj)}" y1="${Y(v - e)}" y2="${Y(v + e)}" stroke="#7df0a6" stroke-width="1.6"/><rect x="${X(mj) - 5}" y="${Y(v) - 5}" width="10" height="10" fill="#000" stroke="#7df0a6" stroke-width="1.8"/>`; }
  }
  g += `<text x="${l}" y="${H - 8}" class="bk-ax">${mjdToDate(t0 + 15)}</text><text x="${W - r}" y="${H - 8}" class="bk-ax" text-anchor="end">${mjdToDate(t1 - 15)}</text><text x="${W / 2}" y="${H - 8}" class="bk-ax" text-anchor="middle">white curve: the swing a ${plx.toFixed(2)}″ parallax predicts · green: each visit</text>`;
  el.innerHTML = `<svg class="bk-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Parallax wobble after removing the steady motion">${g}</svg>`;
}

export function parallax(P: HTMLElement, S: HTMLElement): () => void {
  let ac: AbortController | null = null;
  const picks = [CHALLENGE[1], CHALLENGE[0]];
  S.innerHTML = `<p>As Earth circles the Sun, a nearby star seems to swing back and forth against the distant ones. The size of that swing is its distance — the first rung of every distance in astronomy. Here you measure it from SPHEREx exposures.</p>
    <label class="lrow"><span>Target</span><select id="xt">${picks.map((t) => `<option value="${t.key}">${esc(t.name)} — ${esc(t.blurb.toLowerCase())}</option>`).join("")}<option value="">another object…</option></select></label>
    <label class="lrow" id="xrow" style="display:none"><span>Name</span><input id="xq" class="linput" placeholder="e.g. Luhman 16, Wolf 359, GJ 1111" autocomplete="off"></label>
    <button class="btn" id="xgo">Measure it</button><div id="xres"></div>` +
    how(`The engine reads up to 144 SPHEREx exposures of the target, finds the source's centre in each clean one (Gaussian-windowed centroid; detections below 8σ and flagged exposures are dropped), and fits position, proper motion and parallax by weighted least squares with outlier rejection.
      Uncertainties: the fit is repeated 300 times on exposures drawn at random with replacement (a bootstrap), and the middle 68% of the results is quoted; for the parallax a 0.08″ systematic term is added in quadrature. Parallax factors use Earth's position from a low-precision solar theory (good to 0.01%). A parallax is only quoted when three or more visits span more than 300 days.`);
  const $ = <T extends HTMLElement>(q: string) => S.querySelector(q) as T;
  ($("#xt") as HTMLSelectElement).onchange = (e) => ($("#xrow").style.display = (e.target as HTMLSelectElement).value ? "none" : "");
  P.innerHTML = `<div class="lab-wait">Choose a target and press “Measure it”. It takes about 20 seconds: the exposures come straight from NASA's archive.</div>`;
  $("#xgo").onclick = async () => {
    ac?.abort(); ac = new AbortController(); const res = $("#xres"), key = ($("#xt") as HTMLSelectElement).value;
    let t: BlinkTarget | null = key ? { ...CHALLENGE.find((c) => c.key === key)! } : null;
    if (!t) { const q = ($("#xq") as HTMLInputElement).value.trim(); if (!q) return; res.innerHTML = `<div class="soon">Looking up “${esc(q)}”…</div>`;
      const xy = parseCoords(q); t = xy ? { ra: xy[0], dec: xy[1] } : await resolveName(q).catch(() => null);
      if (!t) { res.innerHTML = verdict(false, `Could not find “${esc(q)}”.`); return; } }
    const N = 32; res.innerHTML = `<div class="soon" id="xprog">Finding SPHEREx exposures…</div>`;
    try {
      const b = await build(t, { size: N, maxFrames: 144, concurrency: 6, signal: ac.signal, onFrame: (_f, done, total) => { const e = S.querySelector("#xprog"); if (e) e.textContent = `Reading exposures from NASA's archive · ${done} / ${total}`; } });
      const over = FLAG_DEFS.find((q) => q.name === "OVERFLOW"), sat = b.frames.filter((f) => f.flags > 0 && over && f.flags & (1 << over.bit)).length > 0.5 * b.frames.length;
      const fit = (F: Frame[]) => fitMotion(F, N, b.center, { dx: 0, dy: 0 }, true, undefined, sat), m = fit(b.frames);
      if (!m) { P.innerHTML = `<div class="lab-wait">No measurement.</div>`; res.innerHTML = verdict(false, `Too few clean, well-detected exposures over two or more visits (${b.frames.length} read). Faint or very crowded targets cannot be measured this way.`); return; }
      // bootstrap: resample the exposures 300 times
      const bs: Motion[] = [];
      for (let k = 0; k < 300; k++) { const F = Array.from({ length: b.frames.length }, () => b.frames[Math.floor(Math.random() * b.frames.length)]).sort((x, y) => x.mjd - y.mjd), q = fit(F); if (q) bs.push(q); }
      const ci = (get: (q: Motion) => number | null): [number, number] => { const v = bs.map(get).filter((x): x is number => x !== null && isFinite(x)).sort((x, y) => x - y); return v.length > 20 ? [v[Math.floor(v.length * 0.16)], v[Math.floor(v.length * 0.84)]] : [NaN, NaN]; };
      const [a1, a2] = ci((q) => q.pmra), [d1, d2] = ci((q) => q.pmdec), [b1, b2] = ci((q) => q.plx);
      // total parallax uncertainty: bootstrap scatter plus the orientation systematic
      const half = Math.hypot((b2 - b1) / 2, PLX_SYS), p1 = (m.plx ?? NaN) - half, p2 = (m.plx ?? NaN) + half;
      P.innerHTML = `<div id="xa"></div><div id="xb"></div>`;
      drawMotion(P.querySelector("#xa") as HTMLElement, m); if (m.plx !== null) drawWobble(P.querySelector("#xb") as HTMLElement, m, b.center);
      const plxOk = m.plx !== null && isFinite(p1) && p1 > 0 && m.plx / half > 3, tot = Math.hypot(m.pmra, m.pmdec), lit = t.plx ? 3261.56 / t.plx : null;
      const ly = plxOk ? [3.2616 / p2, 3.2616 / m.plx!, 3.2616 / p1] : null;
      res.innerHTML = (sat ? verdict(null, `<b>Saturated star.</b> Its core overflows the detector in most exposures, so the centre comes from the wings of the image: treat the numbers as indicative.`) : "") +
        verdict(plxOk ? true : null, `${plxOk ? `<b>You measured its distance: ${ly![1].toFixed(1)} light-years</b> (between ${ly![0].toFixed(1)} and ${ly![2].toFixed(1)}).` : `<b>It moves ${tot.toFixed(2)}″ a year</b>, but its parallax swing is too small to pin down from these exposures${m.plx === null ? " (it needs three visits over more than 300 days)" : ""}.`}
          ${lit ? ` The accepted distance is <b>${lit.toFixed(lit < 100 ? 1 : 0)} light-years</b> (${esc(t.source ?? "catalogue")}).` : ""}`) +
        `<table class="ltab"><tr><th></th><th>you, from SPHEREx</th><th>68% range</th><th>catalogue</th></tr>
          <tr><td>motion east</td><td>${pm(m.pmra)} ″/yr</td><td>${pm(a1)} … ${pm(a2)}</td><td>${t.pmra !== undefined ? pm(t.pmra) : "–"}</td></tr>
          <tr><td>motion north</td><td>${pm(m.pmdec)} ″/yr</td><td>${pm(d1)} … ${pm(d2)}</td><td>${t.pmdec !== undefined ? pm(t.pmdec) : "–"}</td></tr>
          <tr><td>parallax</td><td>${m.plx === null ? "–" : `${m.plx.toFixed(3)}″`}</td><td>${isFinite(p1) ? `${p1.toFixed(2)} … ${p2.toFixed(2)}` : "–"}</td><td>${t.plx ? `${(t.plx / 1000).toFixed(3)}″` : "–"}</td></tr></table>
        <p class="note">${m.n} exposures used of ${b.frames.length} read · ${m.visits} visits over ${(m.span / 365.25).toFixed(1)} years · scatter ${m.rms.toFixed(2)}″ per exposure (a SPHEREx pixel is 6.15″) · ${bs.length} bootstrap fits. The parallax range includes ${PLX_SYS}″ for a systematic effect: SPHEREx flips over between visits six months apart, in step with the parallax swing, so small image asymmetries imitate it.</p>
        <button class="btn sm ghost" id="xshare">Save this result as an image</button>`;
      (S.querySelector("#xshare") as HTMLElement).onclick = () => shareCard(`How far away is ${t!.name ?? "this star"}?`, plxOk ? `${ly![1].toFixed(1)} light-years` : `It moves ${tot.toFixed(1)}″ a year`,
        plxOk ? `Measured from the parallax swing in ${m.n} NASA SPHEREx exposures (between ${ly![0].toFixed(1)} and ${ly![2].toFixed(1)} light-years).${lit ? ` Accepted value: ${lit.toFixed(1)}.` : ""}` : `Measured from ${m.n} NASA SPHEREx exposures over ${(m.span / 365.25).toFixed(1)} years.`);
    } catch (e) { if ((e as Error).name !== "AbortError") res.innerHTML = verdict(false, `Could not read the exposures: ${esc((e as Error).message)}.`); }
  };
  return () => ac?.abort();
}

// ============================================================================ candidate hunt
const HUNT_KEY = "mira.hunt.v1";
type Verdicts = Record<string, { v: string; t: string }>;
const loadVerdicts = (): Verdicts => { try { return JSON.parse(localStorage.getItem(HUNT_KEY) || "{}"); } catch { return {}; } };
export function hunt(P: HTMLElement, S: HTMLElement, ctx: LabCtx): () => void {
  const V = loadVerdicts(), OPT: [string, string][] = [["", "not looked at yet"], ["moving", "moves, looks real"], ["red", "only seen at 4–5 µm"], ["unsure", "cannot tell"], ["artifact", "artifact or blend"], ["static", "does not move"]];
  S.innerHTML = `<p>MIRA's census found objects that look like cold, nearby brown dwarfs — they move, or show methane — and are in <b>no catalogue of known brown dwarfs</b>. Nobody has checked them one by one. That takes a person.</p>
    <div class="verdict" id="hstat"></div>
    <p><b>What to check in Blink</b></p>
    <ol class="hlist"><li>Turn on <b>WISE 2010</b>: has the source moved away from its orange 2010 marker?</li><li>Use <b>Deep stack</b> with <b>Follow target</b>: is there a point source under the crosshair?</li>
      <li>Open <b>Spectrum</b>: is it brighter at 4–5 µm than at 1–2 µm? Does it dip at 3.3 µm?</li><li>Look at the <b>flags</b> and the “Blended” note: is a neighbour doing the work?</li></ol>
    <button class="btn sm ghost" id="hcsv">Download my report (CSV)</button>` +
    how(`Selection (census/candidates.py): AI class “brown dwarf” with probability above 0.6, AI distance below 50 pc, clean SPHEREx photometry (S/N above 10, isolated, unsaturated), WISE colour W1−W2 above 0.6 mag, and either a significant 16-year motion or a methane dip; sideways speed below 150 km/s; WISE and SPHEREx brightness consistent within a factor of two. Everything within 10″ of an entry of the UltracoolSheet (about 3,900 known ultracool dwarfs) is removed. The same selection recovers 125 known brown dwarfs. Your verdicts are stored only in this browser.`);
  P.innerHTML = `<div class="lab-wait">Loading the candidates…</div>`;
  let items: any[] = [];
  const stat = () => { const n = items.filter((it) => V[`${it.tile}-${it.obj}`]?.v).length; (S.querySelector("#hstat") as HTMLElement).innerHTML = items.length ? `<b>${n} of ${items.length}</b> candidates vetted by you${n ? ` · ${items.filter((it) => ["moving", "red"].includes(V[`${it.tile}-${it.obj}`]?.v)).length} look real` : ""}.` : ""; };
  fetch(`${BASE}data/candidates.json`).then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (!j?.items?.length) { P.innerHTML = `<div class="lab-wait">The candidate list is not available on this deployment.</div>`; return; }
    items = j.items;
    P.innerHTML = `<div class="hunt">${items.map((it: any, k: number) => { const id = `${it.tile}-${it.obj}`, mu = Math.hypot(it.pmra ?? 0, it.pmdec ?? 0);
      return `<div class="hrow" data-id="${id}"><span class="hn mono">${String(k + 1).padStart(2, "0")}</span>
        <div class="hmain"><b class="mono">${sexa(it.ra_sx, it.dec_sx)}</b><span>${it.moving ? `moves ${mu.toFixed(2)}″/yr · ` : ""}${it.has_methane ? "methane dip · " : ""}AI: ~${(it.ai_dist * 3.2616).toFixed(0)} light-years, ${Math.round(it.ai_teff / 10) * 10} K · W1−W2 = ${(+it.c12).toFixed(2)}${it.gaia_dist ? ` · Gaia sees it at ${(it.gaia_dist * 3.2616).toFixed(0)} ly` : ""}</span></div>
        <select aria-label="Your verdict">${OPT.map(([v, l]) => `<option value="${v}" ${V[id]?.v === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <button class="btn sm" data-k="${k}">Blink it</button></div>`; }).join("")}</div>`;
    P.querySelectorAll<HTMLSelectElement>(".hrow select").forEach((s) => (s.onchange = () => { const id = (s.closest(".hrow") as HTMLElement).dataset.id!; if (s.value) V[id] = { v: s.value, t: new Date().toISOString() }; else delete V[id];
      try { localStorage.setItem(HUNT_KEY, JSON.stringify(V)); } catch { /* private mode */ } stat(); }));
    P.querySelectorAll<HTMLButtonElement>(".hrow button").forEach((b) => (b.onclick = () => { const it = items[+b.dataset.k!];
      ctx.onBlink({ ra: it.ra_sx, dec: it.dec_sx, pmra: it.reliable_motion ? it.pmra : 0, pmdec: it.reliable_motion ? it.pmdec : 0, epoch: 2025.84, name: `Candidate ${String(+b.dataset.k! + 1).padStart(2, "0")}`, otype: "possible new brown dwarf · unconfirmed", source: "MIRA census, WISE 2010–2020" }); }));
    stat();
  }).catch(() => { P.innerHTML = `<div class="lab-wait">The candidate list is not available.</div>`; });
  (S.querySelector("#hcsv") as HTMLElement).onclick = () => { const rows = ["n,ra_deg,dec_deg,pmra_arcsec_yr,pmdec_arcsec_yr,ai_distance_pc,ai_teff_K,w1_w2_mag,verdict,vetted_utc"];
    items.forEach((it, k) => { const q = V[`${it.tile}-${it.obj}`]; rows.push([k + 1, it.ra_sx, it.dec_sx, it.pmra ?? "", it.pmdec ?? "", it.ai_dist, it.ai_teff, it.c12, q?.v ?? "", q?.t ?? ""].join(",")); });
    save(new Blob([rows.join("\n") + "\n"], { type: "text/csv" }), "mira_candidate_vetting.csv"); };
  return () => {};
}

// ============================================================================ batch: a whole list through the engine
type Row = { q: string; name: string; ra?: number; dec?: number; frames?: number; covered?: number; sat?: boolean; motion?: Motion | null; variable?: string; ch4?: number | null; f46?: number | null; err?: string; t?: Target };
export function batch(P: HTMLElement, S: HTMLElement, ctx: LabCtx): () => void {
  let ac: AbortController | null = null, rows: Row[] = [];
  S.innerHTML = `<p>For researchers with a target list: MIRA reads the SPHEREx exposures of each position and reports, per target, whether it saturates, whether it moves, whether it varies and whether it shows methane — the same measurements as in Blink, in one table.</p>
    <textarea id="bq" class="linput" rows="7" spellcheck="false">Luhman 16
Wolf 359
331.0965 -56.8007
08h55m10.83s -07d14m42.5s
Teegarden's star
GJ 1111</textarea>
    <p class="note">One name or position per line, up to 12. About 15 seconds each (72 exposures, 3.3′ field).</p>
    <button class="btn" id="bgo">Run the list</button> <button class="btn sm ghost" id="bcsv" style="display:none">Download table (CSV)</button>` +
    how(`Each line is resolved (coordinates, or SIMBAD through CDS Sesame), then run through the BLINK engine with 72 exposures on a 32-pixel field. Motion: weighted least-squares fit of the centroids, quoted with its 1σ error; “significant” means above 4σ. Variability: wavelength-matched pairs between visits (halo photometry when saturated). Methane: median flux at 3.20–3.45 µm against 3.90–4.20 µm. Known proper motions from SIMBAD are used only to keep the source centred.`);
  P.innerHTML = `<div class="lab-wait">The table appears here as each target finishes.</div>`;
  const render = () => { P.innerHTML = `<div class="tablewrap"><table class="ltab btab"><thead><tr><th>Target</th><th>Exposures</th><th>Motion ″/yr (E, N)</th><th>Moves?</th><th>Varies?</th><th>3.3/4.0 µm</th><th>4.6 µm</th><th></th></tr></thead><tbody>${rows.map((r, k) => {
      if (r.err) return `<tr><td>${esc(r.name)}</td><td colspan="7" class="dim">${esc(r.err)}</td></tr>`;
      if (r.frames === undefined) return `<tr><td>${esc(r.name)}</td><td colspan="7" class="dim">${r.ra === undefined ? "waiting…" : "reading exposures…"}</td></tr>`;
      const m = r.motion, tot = m ? Math.hypot(m.pmra, m.pmdec) : 0, sig = m ? tot / Math.max(Math.hypot(m.epmra, m.epmdec) / Math.SQRT2, 1e-6) : 0;
      return `<tr><td><b>${esc(r.name)}</b><br><span class="mono dim">${r.ra!.toFixed(4)} ${r.dec! >= 0 ? "+" : ""}${r.dec!.toFixed(4)}</span></td><td>${r.frames} of ${r.covered}${r.sat ? `<br><span class="bad">saturated</span>` : ""}</td>
        <td class="mono">${m ? `${pm(m.pmra)} ± ${m.epmra.toFixed(2)}<br>${pm(m.pmdec)} ± ${m.epmdec.toFixed(2)}` : "–"}</td><td>${m ? (sig > 4 ? `<b>yes</b>, ${sig.toFixed(0)}σ${r.sat ? " (indicative)" : ""}` : "no") : "–"}</td>
        <td>${esc(r.variable ?? "–")}</td><td class="mono">${r.ch4 == null ? "–" : `${r.ch4.toFixed(2)}${r.ch4 < 0.6 ? " · CH₄" : ""}`}</td><td class="mono">${r.f46 == null ? "–" : `${r.f46.toPrecision(3)} mJy`}</td>
        <td><button class="btn sm ghost" data-k="${k}">Blink</button></td></tr>`; }).join("")}</tbody></table></div>`;
    P.querySelectorAll<HTMLButtonElement>("button[data-k]").forEach((b) => (b.onclick = () => { const r = rows[+b.dataset.k!]; if (r.t) ctx.onBlink({ ...r.t, name: r.name }); })); };
  (S.querySelector("#bgo") as HTMLElement).onclick = async () => {
    ac?.abort(); ac = new AbortController(); const my = ac, N = 32;
    rows = (S.querySelector("#bq") as HTMLTextAreaElement).value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 12).map((q) => ({ q, name: q })); render();
    for (const r of rows) {
      if (my.signal.aborted) return;
      try {
        const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, ""), ch = CHALLENGE.find((c) => norm(c.name) === norm(r.q)), xy = parseCoords(r.q);
        const t: BlinkTarget | null = ch ? { ...ch } : xy ? { ra: xy[0], dec: xy[1] } : await resolveName(r.q).catch(() => null);
        if (!t) { r.err = "not found"; render(); continue; }
        r.t = t; r.ra = t.ra; r.dec = t.dec; if (t.name && !xy) r.name = t.name; render();
        const b = await build(t, { size: N, maxFrames: 72, concurrency: 6, signal: my.signal });
        if (!b.frames.length) { r.err = b.covered ? "exposures could not be read" : "no SPHEREx exposure covers it yet"; render(); continue; }
        const over = FLAG_DEFS.find((q) => q.name === "OVERFLOW"), sat = b.frames.filter((f) => f.flags > 0 && over && f.flags & (1 << over.bit)).length > 0.5 * b.frames.length, pr = { dx: 0, dy: 0 };
        const Ph = spectrum(b.frames, N, pr, true), lc = lightCurve(sat ? haloSeries(b.frames, N, pr, true) : Ph), band = (a: number, c: number) => { const v = Ph.filter((p) => !p.flagged && p.lam >= a && p.lam <= c).map((p) => p.flux); return v.length >= 2 ? median(v) : null; };
        const f33 = band(3.2, 3.45), f40 = band(3.9, 4.2), top = lc.best ?? lc.all;
        Object.assign(r, { frames: b.frames.length, covered: b.covered, sat, motion: fitMotion(b.frames, N, b.center, pr, true, undefined, sat), ra: b.center[0], dec: b.center[1],
          variable: lc.pairs < 12 ? "too few pairs" : lc.variable ? `yes, ×${top.amplitude.toFixed(top.amplitude > 3 ? 1 : 2)}` : "steady", ch4: f33 !== null && f40 ? f33 / f40 : null, f46: band(4.4, 4.8) });
      } catch (e) { if ((e as Error).name === "AbortError") return; r.err = (e as Error).message; }
      render();
    }
    (S.querySelector("#bcsv") as HTMLElement).style.display = "";
  };
  (S.querySelector("#bcsv") as HTMLElement).onclick = () => { const out = ["query,name,ra_deg,dec_deg,exposures_read,exposures_covering,saturated,pmra_arcsec_yr,pmra_err,pmdec_arcsec_yr,pmdec_err,variability,ratio_3.3_4.0um,flux_4.6um_mJy"];
    for (const r of rows) out.push([`"${r.q}"`, `"${r.name}"`, r.ra ?? "", r.dec ?? "", r.frames ?? "", r.covered ?? "", r.sat ? 1 : 0, r.motion?.pmra.toFixed(3) ?? "", r.motion?.epmra.toFixed(3) ?? "", r.motion?.pmdec.toFixed(3) ?? "", r.motion?.epmdec.toFixed(3) ?? "", `"${r.variable ?? r.err ?? ""}"`, r.ch4?.toFixed(3) ?? "", r.f46?.toPrecision(4) ?? ""].join(","));
    save(new Blob([out.join("\n") + "\n"], { type: "text/csv" }), "mira_batch.csv"); };
  return () => ac?.abort();
}
