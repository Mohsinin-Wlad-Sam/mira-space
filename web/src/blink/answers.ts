// The three questions MIRA answers about any place in the sky, in plain words:
//   Is it moving?   Is it changing?   What is it made of?
// The numbers come from measure.ts; this module only decides what can honestly be said about them. It is used by the
// Observe view (the answer cards), by the Logbook (batch runs) and by the validation script.
import { FLAG_DEFS, DETECTORS, type Frame } from "./engine";
import { spectrum, haloSeries, binSpectrum, lightCurve, fitMotion, PLX_SYS, type Phot, type LightCurve, type Motion } from "./measure";

export type Analysis = { P: Phot[]; bins: ReturnType<typeof binSpectrum>; lc: LightCurve; halo: boolean; motion: Motion | null; motionFlagged: boolean; nFlagged: number; nSat: number; nFrames: number; span: number };
export type Tone = "pos" | "neutral" | "warn" | "wait";
/** one instrument readout: a headline number, what it is, a status tag and one plain sentence */
export type Answer = { tone: Tone; chip: string; big: string; unit: string; label: string; text: string };

/** run every measurement on the source at `probe` (offset in pixels from the target or from the field centre) */
export function analyzeFrames(frames: Frame[], N: number, center: [number, number], probe: { dx: number; dy: number }, follow: boolean, dets?: Set<number>): Analysis | null {
  if (frames.length < 3) return null;
  const fs = !dets || dets.size === 6 ? frames : frames.filter((f) => dets.has(f.det));
  const P = spectrum(frames, N, probe, follow).filter((p) => !dets || dets.has(p.det)), over = FLAG_DEFS.find((d) => d.name === "OVERFLOW"), obit = over ? 1 << over.bit : 2;
  const nFlagged = P.filter((p) => p.flagged).length, nSat = follow ? frames.filter((f) => f.flags > 0 && f.flags & obit).length : 0;
  let motion = fitMotion(frames, N, center, probe, follow, dets), motionFlagged = false;
  if (!motion && nFlagged > 0.5 * P.length) { motion = fitMotion(frames, N, center, probe, follow, dets, true); motionFlagged = !!motion; }
  // a saturated star: its core is lost, so follow the brightness of its unsaturated halo instead
  const halo = nSat > 0.5 * frames.length, lc = lightCurve(halo ? haloSeries(fs, N, probe, follow) : P);
  return { P, bins: binSpectrum(P, 0.05), lc, halo, motion, motionFlagged, nFlagged, nSat, nFrames: frames.length, span: frames.length ? (frames[frames.length - 1].mjd - frames[0].mjd) / 365.25 : 0 };
}

const median = (a: number[]) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
export const compass = (pmra: number, pmdec: number) => COMPASS[Math.round((((Math.atan2(pmra, pmdec) * 180) / Math.PI + 360) % 360) / 45) % 8];
export const monthYear = (mjd: number) => new Date((mjd - 40587) * 86400000).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
export const bandWords = (det: number) => { const d = DETECTORS[det - 1]; return `${d.lo.toFixed(d.lo < 1 ? 2 : 1)}–${d.hi.toFixed(1)} µm`; };
/** median flux of the clean measurements in a wavelength window (µm) */
export function bandFlux(P: Phot[], a: number, b: number): { f: number; e: number; n: number } | null {
  const v = P.filter((p) => !p.flagged && p.lam >= a && p.lam <= b);
  return v.length >= 2 ? { f: median(v.map((p) => p.flux)), e: median(v.map((p) => p.err)) / Math.sqrt(v.length), n: v.length } : null;
}
/** flux at 3.3 µm over flux at 4.0 µm: below ~0.6 means methane absorption */
export function methaneRatio(P: Phot[]): number | null {
  const ch4 = bandFlux(P, 3.2, 3.45), ref = bandFlux(P, 3.9, 4.2);
  return ch4 && ref && ref.f > 5 * ref.e ? ch4.f / ref.f : null;
}
/** total parallax uncertainty: statistical plus the orientation systematic (see measure.ts) */
export const plxError = (m: Motion) => (m.eplx === null ? NaN : Math.hypot(m.eplx, PLX_SYS));

/** ASTROMETER — where the source is in every exposure, hence its motion (and, for the nearest, its distance) */
export function answerMove(A: Analysis | null, cat?: { pmra?: number; pmdec?: number; source?: string } | null): Answer {
  if (!A) return { tone: "wait", chip: "Measuring", big: "…", unit: "", label: "locating it in every exposure", text: "" };
  const m = A.motion;
  if (!m) return { tone: "warn", chip: "No fix", big: "—", unit: "", label: "motion not measurable here",
    text: `A motion needs the source to stand out clearly in two or more visits${A.nSat > 0.3 * A.nFrames ? `: this star overflows the camera in ${A.nSat} of ${A.nFrames} exposures, so its centre cannot be located` : A.nFlagged > 0.5 * A.P.length ? ": here most exposures of it are flagged by NASA, so its centre cannot be located" : "; it is too faint or too crowded here"}.` };
  const tot = Math.hypot(m.pmra, m.pmdec), etot = Math.hypot(m.epmra, m.epmdec) / Math.SQRT2, sig = tot / Math.max(etot, 1e-6);
  if (sig <= 4) return { tone: "neutral", chip: "At rest", big: `< ${(3 * etot).toFixed(2)}`, unit: "″/yr", label: "no motion detected (3σ limit)",
    text: `Nothing slower than this could be noticed over SPHEREx's first ${(m.span / 365.25).toFixed(1)} years of images.` };
  const ep = plxError(m), plxOk = m.plx !== null && m.plx / ep > 5 && !A.motionFlagged, catTot = cat && Math.hypot(cat.pmra ?? 0, cat.pmdec ?? 0) > 0.05 ? Math.hypot(cat.pmra ?? 0, cat.pmdec ?? 0) : 0;
  return { tone: "pos", chip: "Moving", big: tot.toFixed(tot < 1 ? 2 : 1), unit: "″/yr", label: `proper motion · toward the ${compass(m.pmra, m.pmdec)}`,
    text: `${tot > 0.4 ? `It crosses the width of the full Moon in about ${Math.round(1800 / tot / 10) * 10} years.` : "A slow drift across the sky."}` +
      (A.motionFlagged ? ` The star overflows the camera, so the figure is approximate.` : "") +
      (plxOk ? ` Its yearly swing against the background, measured on the SPHEREx exposures alone, puts it <b>${(3.2616 / (m.plx! + ep)).toFixed(0)}–${(3.2616 / (m.plx! - ep)).toFixed(0)} light-years</b> away.` : "") +
      (catTot ? ` ${cat!.source?.includes("Gaia") ? "Gaia" : "Catalogue"} value: ${catTot.toFixed(catTot < 1 ? 2 : 1)}″/yr.` : "") };
}
/** PHOTOMETER — brightness from visit to visit, compared only at matching wavelengths */
export function answerChange(A: Analysis | null): Answer {
  if (!A) return { tone: "wait", chip: "Measuring", big: "…", unit: "", label: "comparing visits", text: "" };
  const lc = A.lc, halo = A.halo ? " Its core overflows the camera, so this follows the glow around it." : "";
  if (lc.all.visits.length < 2 && !lc.series.length) return { tone: "warn", chip: "Not yet", big: "—", unit: "", label: "too few matching exposures",
    text: `SPHEREx must catch the source at the same colour in two different visits; there are too few such pairs so far${A.nFrames < 100 ? " — read all exposures to add more" : ""}.` };
  const top = lc.best ?? lc.all, calm = lc.best ? lc.series.filter((q) => q !== lc.best).sort((a, b) => a.amplitude - b.amplitude)[0] : null;
  if (lc.variable && top.lo && top.hi) return { tone: "pos", chip: "Variable", big: `${top.amplitude.toFixed(top.amplitude > 3 ? 0 : 1)}×`, unit: "", label: `brighter in ${monthYear(top.hi.mjd)} than in ${monthYear(top.lo.mjd)}${lc.best ? ` · ${bandWords(lc.best.det)}` : ""}`,
    text: `${calm && calm.amplitude < 0.6 * top.amplitude ? `At ${bandWords(calm.det)} it changed only ${calm.amplitude.toFixed(1)}×: its colour shifts as it varies.` : "A real change in brightness, well above the measurement scatter."}${halo}` };
  // steady: quote the scatter of the visit levels, using only visits tied down by three or more matched pairs
  const base = lc.all.visits.length >= 2 ? lc.all : [...lc.series].sort((p, q) => q.visits.reduce((t, v) => t + v.n, 0) - p.visits.reduce((t, v) => t + v.n, 0))[0], good = (base?.visits ?? []).filter((v) => v.n >= 3);
  if (good.length < 2) return { tone: "warn", chip: "Not yet", big: "—", unit: "", label: "too few matching exposures",
    text: `Only ${lc.pairs} pairs of exposures saw the source at the same wavelength in different visits${A.nFrames < 100 ? "; read all exposures to add more" : ""}.` };
  const rms = Math.sqrt(good.reduce((t, v) => t + Math.pow(v.ratio - 1, 2), 0) / good.length);
  return { tone: "neutral", chip: "Steady", big: `±${Math.max(2, Math.round(rms * 100))}%`, unit: "", label: `scatter of ${good.length} visits · ${A.span.toFixed(1)} yr`,
    text: `No change beyond the measurement scatter.${halo}` };
}
/** SPECTROGRAPH — brightness at each wavelength, hence what the light says about the object */
export function answerMade(A: Analysis | null, blend?: { mag: number | null; sep: number } | null): Answer {
  if (!A) return { tone: "wait", chip: "Measuring", big: "…", unit: "", label: "reading each colour", text: "" };
  if (A.nSat > 0.3 * A.nFrames) return { tone: "warn", chip: "Saturated", big: `${A.nSat}/${A.nFrames}`, unit: "", label: "exposures overflow the camera",
    text: `Too bright for SPHEREx: NASA flags each of these exposures, and the colours cannot be trusted. Its motion and variability are still measured, from the wings and the halo of its image.` };
  const clean = A.P.filter((p) => !p.flagged), snr = median(clean.map((p) => p.snr)), bl = blend ? ` A Gaia star lies ${blend.sep.toFixed(0)}″ away, about one SPHEREx pixel: some of this light is its own.` : "";
  const r = methaneRatio(A.P), blue = bandFlux(A.P, 1.0, 1.35), red = bandFlux(A.P, 4.4, 4.95);
  const peak = A.bins.filter((b) => b.n >= 2).sort((a, b) => b.flux - a.flux)[0] ?? A.bins.sort((a, b) => b.flux - a.flux)[0];
  if (r !== null && r < 0.6) return { tone: "pos", chip: "Methane", big: `${Math.round((1 - Math.max(0, r)) * 100)}%`, unit: "", label: "of its light absorbed at 3.3 µm",
    text: `That gap is methane. It only survives in atmospheres colder than about 1,300 K: a brown dwarf, or a giant planet.${bl}` };
  if (!(snr > 3) && !(red && red.f > 5 * red.e)) return { tone: "warn", chip: "Faint", big: "—", unit: "", label: "too faint in single exposures", text: `Use the stacked view to bring it out, or pick a brighter neighbour.${bl}` };
  if (blue && red && red.f > 5 * red.e && red.f > 3 * Math.max(blue.f, blue.e)) return { tone: "pos", chip: "Cold or dusty", big: blue.f > 2 * blue.e ? `${(red.f / blue.f).toFixed(0)}×` : "≫", unit: "", label: "brighter at 4.7 µm than at 1.2 µm",
    text: `Far redder than a star: something very cold, or wrapped in dust.${bl}` };
  const starlike = blue && red && blue.f > 5 * blue.e && blue.f > 2 * Math.max(red.f, red.e);
  return { tone: "neutral", chip: starlike ? "Star-like" : "Featureless", big: peak ? peak.lam.toFixed(peak.lam < 2 ? 2 : 1) : "—", unit: peak ? "µm" : "", label: "brightest wavelength",
    text: `${starlike ? "Its light fades smoothly toward the infrared, like an ordinary star's" : "A fairly even spread of light from 0.75 to 5 µm"}, without the deep gaps that molecules such as methane carve.${bl}` };
}
