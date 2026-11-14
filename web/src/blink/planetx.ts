// What could hide in a field of a given depth? Model fluxes at 4.6 µm of bodies near the Sun against distance:
// planets (reflected sunlight plus their own blackbody) and brown dwarfs (scaled from measured ones).
const H_PLANCK = 6.62607015e-34, C_LIGHT = 2.99792458e8, K_B = 1.380649e-23, AU_KM = 1.495978707e8, R_EARTH_KM = 6371, R_SUN_KM = 695700, T_SUN = 5772;
export const PC_AU = 206264.806, LY_AU = 63241.1;
/** Planck function B_ν (W m⁻² Hz⁻¹ sr⁻¹) */
const planck = (um: number, T: number) => { const nu = C_LIGHT / (um * 1e-6), x = (H_PLANCK * nu) / (K_B * T); return x > 600 ? 0 : (2 * H_PLANCK * nu * nu * nu) / (C_LIGHT * C_LIGHT) / Math.expm1(x); };
const sunAt1au = (um: number) => Math.PI * planck(um, T_SUN) * Math.pow(R_SUN_KM / AU_KM, 2);
/** mJy from a body of radius R (Earth radii), geometric albedo p, temperature T, at d au: reflected sunlight + its own blackbody */
export function bodyFlux(um: number, R: number, p: number, T: number, dAU: number) { const k = Math.pow((R * R_EARTH_KM) / (dAU * AU_KM), 2); return ((p * k * sunAt1au(um)) / (dAU * dAU) + Math.PI * planck(um, T) * k) * 1e29; }

export type Body = { key: string; name: string; color: string; note: string; flux: (dAU: number) => number; range: [number, number]; dash?: boolean };
/** reference bodies. Planet radii, albedos and temperatures are assumptions stated in `note`; the two brown dwarfs are
 *  scaled as 1/d² from catalogue 4.6 µm fluxes of the real objects (AllWISE W2). */
export const BODIES: Body[] = [
  { key: "p9", name: "Planet Nine as proposed (≈6 Earth masses)", color: "#c9a4ff", range: [30, 5000], note: "radius 2.9 Earth radii, albedo 0.4, 45 K (assumed); proposed orbit 300–800 au (Brown & Batygin 2021)", flux: (d) => bodyFlux(4.6, 2.9, 0.4, 45, d) },
  { key: "nep", name: "a second Neptune", color: "#6ea8ff", range: [30, 20000], note: "radius 3.86 Earth radii, albedo 0.3, 59 K", flux: (d) => bodyFlux(4.6, 3.86, 0.3, 59, d) },
  { key: "jup", name: "a second Jupiter", color: "#f0d35b", range: [30, 200000], note: "radius 10.97 Earth radii, albedo 0.4, 125 K blackbody (real giant planets are brighter than a blackbody near 5 µm)", flux: (d) => bodyFlux(4.6, 10.97, 0.4, 125, d) },
  { key: "y", name: "a 250 K brown dwarf (WISE 0855 twin)", color: "#ff9d4d", range: [2000, 3e6], dash: true, note: "0.57 mJy at 4.6 µm at 2.28 pc (AllWISE W2 of WISE 0855−0714)", flux: (d) => 0.567 * Math.pow((2.28 * PC_AU) / d, 2) },
  { key: "t", name: "a methane brown dwarf (ε Indi B twin)", color: "#ff5d6c", range: [2000, 3e6], dash: true, note: "27 mJy at 4.6 µm at 3.64 pc (AllWISE W2 of ε Indi Ba+Bb)", flux: (d) => 27.5 * Math.pow((3.64 * PC_AU) / d, 2) },
];
/** largest distance (au) at which `b` is brighter than `limit` mJy, or null if never within its range */
export function reach(b: Body, limit: number): number | null {
  let lo = b.range[0], hi = b.range[1]; if (b.flux(lo) < limit) return null; if (b.flux(hi) >= limit) return hi;
  for (let k = 0; k < 60; k++) { const m = Math.sqrt(lo * hi); if (b.flux(m) >= limit) lo = m; else hi = m; } return lo;
}
/** apparent shift (arcsec) between two visits six months apart, from the Earth's orbit alone (2 au baseline) */
export const halfYearShift = (dAU: number) => (2 / dAU) * 206264.806;
export const fmtDist = (dAU: number) => (dAU >= LY_AU * 0.5 ? `${(dAU / LY_AU).toFixed(dAU / LY_AU < 10 ? 1 : 0)} light-years` : `${dAU >= 1000 ? Math.round(dAU / 10) * 10 : Math.round(dAU)} au`.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
