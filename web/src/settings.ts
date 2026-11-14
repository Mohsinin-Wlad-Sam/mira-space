// User-adjustable map appearance + interaction, persisted per browser (a convenience only; defaults always work).
export const LOW_POWER = (() => {
  const nav = navigator as any;
  return matchMedia("(pointer: coarse)").matches || (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || !!nav.connection?.saveData;
})();

export type Settings = {
  survey: SurveyKey;
  colormap: string; stretch: "linear" | "sqrt" | "asinh" | "log" | "pow2";
  brightness: number; contrast: number; gamma: number;
  projection: "SIN" | "AIT" | "MOL" | "TAN" | "MER";
  grid: boolean; galactic: boolean;
  markerSize: number; trails: boolean; labels: boolean; density: number; maxMarkers: number;
  zoomSpeed: number; zoomToCursor: boolean; blinkMs: number; blinkFade: boolean; saver: boolean;
};
export const DEFAULTS: Settings = {
  survey: "spherex", colormap: "grayscale", stretch: "asinh", brightness: -0.18, contrast: 1.2, gamma: 1.6,
  projection: "AIT", grid: false, galactic: true,       // the whole sky at once, Milky Way horizontal: the standard all-sky map
  markerSize: 8, trails: true, labels: true, density: 1, maxMarkers: LOW_POWER ? 400 : 900,
  zoomSpeed: 1, zoomToCursor: true, blinkMs: 900, blinkFade: false, saver: LOW_POWER,
};
const KEY = "mira.settings.v4";
export function loadSettings(): Settings {
  try { const s = JSON.parse(localStorage.getItem(KEY) || "{}"); const o = { ...DEFAULTS, ...s }; if (!(o.survey in SURVEYS) || o.survey === "sxrgb") o.survey = DEFAULTS.survey; return o; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s: Settings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }

// The wavelength ladder: one sky, many kinds of light (all served by NASA/IPAC IRSA's HiPS mirror; nothing hosted by us)
export type SurveyKey = "galex" | "dss" | "2mass" | "spherex" | "sxrgb" | "wise" | "wisergb" | "iris" | "planck";
export const SURVEYS: Record<SurveyKey, { label: string; short: string; band: string; url: string; cube?: boolean; color?: boolean; rgb?: boolean; what: string }> = {
  galex: { short: "Ultraviolet", band: "0.15–0.23 µm", label: "GALEX ultraviolet · 2003–12", url: "https://irsa.ipac.caltech.edu/data/hips/CDS/GALEX/GR6-03-2014/AIS-Color", color: true,
    what: "Hot, young, massive stars and white dwarfs. Dust blocks UV, so the Milky Way's plane is dark (and GALEX avoided it)." },
  dss: { short: "Visible", band: "0.4–0.7 µm", label: "DSS2 optical colour · 1950s–90s", url: "https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color", color: true,
    what: "What your eyes would see: dark dust lanes hide the Galactic centre. Cold brown dwarfs are invisible here." },
  "2mass": { short: "Near-IR", band: "1.2–2.2 µm", label: "2MASS near-IR colour · 1998", url: "https://irsa.ipac.caltech.edu/data/hips/CDS/2MASS/Color", color: true,
    what: "Infrared slips through dust: the bulge of old red stars around the Galactic centre appears." },
  spherex: { short: "SPHEREx", band: "0.75–5 µm · 102 colours", label: "SPHEREx 2025 · one of 102 colours", url: "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube", cube: true,
    what: "SPHEREx maps the whole sky in 102 colours. Drag the rainbow bar to step through them." },
  sxrgb: { short: "SPHEREx colour", band: "1.2 · 3.3 · 4.6 µm", label: "SPHEREx false colour (methane-sensitive)", url: "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube", cube: true, rgb: true,
    what: "Blue = 1.2 µm, green = 3.3 µm (methane band), red = 4.6 µm. Normal stars look white; methane-rich brown dwarfs and dust-wrapped young stars glow red." },
  wise: { short: "WISE 2010", band: "4.6 µm", label: "AllWISE 4.6 µm · 2010", url: "https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/W2",
    what: "The same band as SPHEREx's red end, 15 years earlier: the time machine blinks between these two." },
  wisergb: { short: "Mid-IR", band: "3.4 · 4.6 · 22 µm", label: "AllWISE colour (W1 W2 W4)", url: "https://irsa.ipac.caltech.edu/data/hips/CDS/AllWISE/RGB-W4-W2-W1", color: true,
    what: "Warm dust glows at 22 µm (red): star-forming clouds and dusty dying stars light up." },
  iris: { short: "Far-IR", band: "12–100 µm", label: "IRAS/IRIS far-IR colour · 1983", url: "https://irsa.ipac.caltech.edu/data/hips/CDS/IRIS/color", color: true,
    what: "Cold interstellar dust at −250 °C: the 'infrared cirrus' that fills the Galaxy." },
  planck: { short: "Microwave", band: "0.35–3 mm", label: "Planck HFI colour · 2013", url: "https://irsa.ipac.caltech.edu/data/hips/CDS/PLANCK/R2/HFI/color", color: true,
    what: "Coldest dust and, far behind it, the afterglow of the Big Bang." },
};
export const LADDER: SurveyKey[] = ["galex", "dss", "2mass", "spherex", "wise", "wisergb", "iris", "planck"];   // "sxrgb" kept off: Aladin 3.8 blends same-cube layers incorrectly
export const COLORMAPS = ["magma", "inferno", "viridis", "cividis", "cubehelix", "grayscale", "redtemperature", "rdylbu", "spectral", "native"];
export const PROJECTIONS: [Settings["projection"], string][] = [["AIT", "Whole sky (Aitoff)"], ["MOL", "Whole sky (Mollweide)"], ["SIN", "Celestial sphere seen from outside"], ["TAN", "Gnomonic (flat)"], ["MER", "Mercator"]];
