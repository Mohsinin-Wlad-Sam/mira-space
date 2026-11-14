// A minimal FITS writer: the registered frames as an image cube with celestial WCS, plus a table of the exposures.
// So a researcher can take what MIRA built into DS9, Aladin, CARTA or astropy without re-doing the registration.
import { PIX_ARCSEC, type Frame } from "./engine";

const card = (key: string, value: string | number | boolean, comment = "") => {
  const v = typeof value === "boolean" ? (value ? "T" : "F").padStart(20) : typeof value === "number" ? (Number.isInteger(value) ? String(value) : value.toPrecision(15).replace(/\.?0+($|E)/, "$1")).padStart(20) : `'${value.replace(/'/g, "''").padEnd(8)}'`.padEnd(20);
  return `${key.padEnd(8)}= ${v}${comment ? ` / ${comment}` : ""}`.slice(0, 80).padEnd(80);
};
const note = (text: string) => `COMMENT ${text}`.slice(0, 80).padEnd(80);
function header(cards: string[]): Uint8Array {
  const all = [...cards, "END".padEnd(80)].join(""), out = new Uint8Array(Math.ceil(all.length / 2880) * 2880).fill(32);
  for (let k = 0; k < all.length; k++) out[k] = all.charCodeAt(k) & 0x7f;
  return out;
}
const pad = (n: number) => new Uint8Array((2880 - (n % 2880)) % 2880);

/** registered cube [frame, y, x] in MJy/sr (sky background removed), north up, east left; HDU 2 lists the exposures */
export function fitsCube(frames: Frame[], N: number, center: [number, number], object: string): Blob {
  const n = frames.length, s = PIX_ARCSEC / 3600;
  const h0 = header([card("SIMPLE", true, "MIRA registered SPHEREx cutouts"), card("BITPIX", -32), card("NAXIS", 3), card("NAXIS1", N), card("NAXIS2", N), card("NAXIS3", n, "one plane per exposure"), card("EXTEND", true),
    card("OBJECT", object.slice(0, 60)), card("BUNIT", "MJy/sr", "surface brightness, sky background removed"), card("RADESYS", "ICRS"),
    card("CTYPE1", "RA---TAN"), card("CTYPE2", "DEC--TAN"), card("CTYPE3", "FRAME"), card("CUNIT1", "deg"), card("CUNIT2", "deg"),
    card("CRVAL1", center[0]), card("CRVAL2", center[1]), card("CRVAL3", 1), card("CRPIX1", (N + 1) / 2), card("CRPIX2", (N + 1) / 2), card("CRPIX3", 1),
    card("CDELT1", -s, "[deg] east to the left"), card("CDELT2", s, "[deg] north up"), card("CDELT3", 1),
    card("ORIGIN", "MIRA"), card("TELESCOP", "SPHEREx"), card("DATE", new Date().toISOString().slice(0, 19)),
    note("Bilinear resampling of SPHEREx Level-2 exposures (NASA/IPAC IRSA) onto a common"), note("tangent-plane grid. Each plane saw a different wavelength: see HDU EXPOSURES."),
    note("Not a NASA product. Photometry on resampled data is approximate.")]);
  const data = new DataView(new ArrayBuffer(n * N * N * 4));
  frames.forEach((f, k) => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) data.setFloat32((k * N * N + y * N + x) * 4, f.img[(N - 1 - y) * N + x], false); });   // FITS rows run south to north
  const ROW = 8 + 2 + 4 + 4 + 4 + 4 + 4 + 24;
  const h1 = header([card("XTENSION", "BINTABLE", "binary table"), card("BITPIX", 8), card("NAXIS", 2), card("NAXIS1", ROW), card("NAXIS2", n), card("PCOUNT", 0), card("GCOUNT", 1), card("TFIELDS", 8), card("EXTNAME", "EXPOSURES"),
    card("TTYPE1", "MJD"), card("TFORM1", "D"), card("TUNIT1", "d"), card("TTYPE2", "DETECTOR"), card("TFORM2", "I"), card("TTYPE3", "WAVELENGTH"), card("TFORM3", "E"), card("TUNIT3", "um"),
    card("TTYPE4", "BANDWIDTH"), card("TFORM4", "E"), card("TUNIT4", "um"), card("TTYPE5", "BACKGROUND"), card("TFORM5", "E"), card("TUNIT5", "MJy/sr"), card("TTYPE6", "NOISE"), card("TFORM6", "E"), card("TUNIT6", "MJy/sr"),
    card("TTYPE7", "FLAGS"), card("TFORM7", "J"), card("TTYPE8", "OBSID"), card("TFORM8", "24A"), note("WAVELENGTH is at the target; FLAGS is the OR of NASA's flag bits within 1.5 px of it (-1 = not read).")]);
  const tab = new DataView(new ArrayBuffer(n * ROW)), bytes = new Uint8Array(tab.buffer);
  frames.forEach((f, k) => { const o = k * ROW; tab.setFloat64(o, f.mjd, false); tab.setInt16(o + 8, f.det, false); tab.setFloat32(o + 10, f.lam, false); tab.setFloat32(o + 14, f.bw, false); tab.setFloat32(o + 18, f.bg, false);
    tab.setFloat32(o + 22, f.noise, false); tab.setInt32(o + 26, f.flags, false); const id = `${f.obsid}D${f.det}`.slice(0, 24).padEnd(24); for (let q = 0; q < 24; q++) bytes[o + 30 + q] = id.charCodeAt(q) & 0x7f; });
  return new Blob([h0, data.buffer, pad(data.byteLength), h1, tab.buffer, pad(tab.byteLength)] as BlobPart[], { type: "application/fits" });
}

/** astropy code that reproduces the cutouts from NASA's archive, for the Export tab */
export function pythonSnippet(frames: Frame[], N: number, center: [number, number], object: string): string {
  return `# Reproduce this MIRA observation of ${object} with astropy (needs: astropy, fsspec, aiohttp).
# Each SPHEREx Level-2 file is 65 MB; .section reads only the pixels the cutout needs.
from astropy.io import fits
from astropy.wcs import WCS
from astropy.nddata import Cutout2D
from astropy.coordinates import SkyCoord
import astropy.units as u

target = SkyCoord(${center[0].toFixed(6)} * u.deg, ${center[1].toFixed(6)} * u.deg, frame="icrs")
size = ${N} * ${PIX_ARCSEC} * u.arcsec          # ${((N * PIX_ARCSEC) / 60).toFixed(1)} arcmin field
urls = [
${frames.map((f) => `    "${f.exp.url}",  # ${f.dateObs.slice(0, 10)}  D${f.det}  ${f.lam.toFixed(3)} um`).join("\n")}
]
cutouts = []
for url in urls:
    with fits.open(url, use_fsspec=True) as hdul:
        wcs = WCS(hdul["IMAGE"].header)
        cut = Cutout2D(hdul["IMAGE"].section, position=target, size=size, wcs=wcs, mode="partial")
        flags = Cutout2D(hdul["FLAGS"].section, position=target, size=size, wcs=wcs, mode="partial")
        cutouts.append((hdul["IMAGE"].header["MJD-AVG"], cut.data, flags.data, cut.wcs))
print(len(cutouts), "cutouts in MJy/sr; detector orientation differs between exposures (MIRA re-projects them north-up)")
`;
}
