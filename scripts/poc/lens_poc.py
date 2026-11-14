#!/usr/bin/env python3
"""PoC: 'spectral lenses' on the static DR1 102-channel all-sky cube, read by byte range (as a browser would).

For a sky position: find the HEALPix order-5 tile, read the SPECTRAL_CHANNELS table, fetch only the
rows of the channel planes a lens needs, and compute a per-pixel lens score. Methane lens:
    score = log10( sqrt(F_J * F_W) / F_CH4 )   with J=1.20-1.32 um, CH4=3.20-3.45 um, W(window)=4.45-4.80 um
T/Y dwarfs (bright at J and 4.6 um, dark in the 3.3 um CH4 band) light up; ordinary stars do not.
Writes data/poc/lens_<name>.png and prints the rank of the target among bright pixels in the field.
"""
import io, math, pathlib, sys, time, warnings
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from astropy.coordinates import SkyCoord
import astropy.units as u
from astropy_healpix import HEALPix

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "bundler"))
from s3fits import RemoteFITS, get_range  # noqa: E402

warnings.filterwarnings("ignore")
ROOT = "dr1/hips5_cube/hips_20261026/Norder5"
LENS = {"J": (1.20, 1.32), "CH4": (3.20, 3.45), "W": (4.45, 4.80)}


def tile_for(ra, dec):
    hp = HEALPix(nside=32, order="nested", frame="icrs")
    n = int(hp.skycoord_to_healpix(SkyCoord(ra * u.deg, dec * u.deg)))
    return n, f"{ROOT}/Dir{(n // 10000) * 10000}/Npix{n}_cube.fits"


def channels(rf):
    h = rf.hdus["SPECTRAL_CHANNELS"]
    raw = get_range(rf.url, h.header_start, h.data_start + ((h.data_size + 2879) // 2880) * 2880)
    t = fits.open(io.BytesIO(fits.PrimaryHDU().header.tostring().encode() + raw))[1].data
    return t


def plane_rows(rf, c, y0, y1):
    h = rf.hdus["IMAGE"]; nx = h.header["NAXIS1"]; ny = h.header["NAXIS2"]
    base = h.data_start + c * nx * ny * 4
    raw = get_range(rf.url, base + y0 * nx * 4, base + y1 * nx * 4)
    return np.frombuffer(raw, ">f4").reshape(y1 - y0, nx).astype(np.float32)


def run(name, ra, dec, half=60):
    t0 = time.time()
    npix, key = tile_for(ra, dec)
    rf = RemoteFITS(key)
    tab = channels(rf)
    cols = tab.columns.names
    lamcol = [c for c in cols if "CENT" in c.upper() or "WAVE" in c.upper() or "LAMBDA" in c.upper()][0]
    lam = np.array(tab[lamcol], float)
    hdr = rf.hdus["IMAGE"].header.copy()
    for k in list(hdr.keys()):
        if k.endswith("3") and k[:-1] in ("NAXIS", "CTYPE", "CUNIT", "CRPIX", "CRVAL", "CDELT", "CNAME") or \
                k.startswith(("PS3_", "PV3_", "PC3_", "CD3_")) or k in ("PC1_3", "PC2_3", "CD1_3", "CD2_3"):
            del hdr[k]
    hdr["NAXIS"] = 2; hdr["WCSAXES"] = 2
    w = WCS(hdr)
    x, y = w.world_to_pixel(SkyCoord(ra * u.deg, dec * u.deg))
    xi, yi = int(round(float(x))), int(round(float(y)))
    y0, y1 = max(0, yi - half), min(512, yi + half)
    x0, x1 = max(0, xi - half), min(512, xi + half)
    sel = {k: [i for i, l in enumerate(lam) if lo <= l <= hi] for k, (lo, hi) in LENS.items()}
    jobs = [(k, c) for k, cs in sel.items() for c in cs]
    with ThreadPoolExecutor(12) as ex:
        planes = list(ex.map(lambda kc: (kc[0], plane_rows(rf, kc[1], y0, y1)[:, x0:x1]), jobs))
    F = {k: np.nanmean([p for kk, p in planes if kk == k], axis=0) for k in LENS}
    nbytes = len(jobs) * (y1 - y0) * 512 * 4
    eps = 0.02  # MJy/sr floor
    score = np.log10(np.sqrt(np.clip(F["J"], eps, None) * np.clip(F["W"], eps, None)) / np.clip(F["CH4"], eps, None))
    bright = (F["W"] > np.nanpercentile(F["W"], 99.0))
    tx, ty = xi - x0, yi - y0
    # target score = max within 2 px of predicted position (cube epoch ~2025.9; PM handled by search radius)
    win = score[max(0, ty - 2):ty + 3, max(0, tx - 2):tx + 3]
    tscore = float(np.nanmax(win))
    rank = int(np.sum(score[bright] > tscore)) + 1
    print(f"{name}: tile Npix{npix}, {len(jobs)} channel strips ({nbytes/1e6:.1f} MB) in {time.time()-t0:.1f}s; "
          f"channels J={sel['J']} CH4={sel['CH4']} W={sel['W']}; target lens score={tscore:.2f}; "
          f"rank {rank} among {int(bright.sum())} brightest-4.6um pixels; field median score={np.nanmedian(score[bright]):.2f}")
    try:
        import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
        fig, ax = plt.subplots(1, 3, figsize=(13, 4.4))
        for a, (img, title) in zip(ax, [(F["J"], "J 1.20-1.32 um"), (F["W"], "4.45-4.80 um window"), (score, "methane lens score")]):
            v = np.nanpercentile(img, [2, 99.5])
            a.imshow(img, origin="lower", cmap="magma", vmin=v[0], vmax=v[1]); a.set_title(title); a.plot(tx, ty, "c+", ms=14)
            a.set_xticks([]); a.set_yticks([])
        fig.suptitle(f"{name}: SPHEREx DR1 cube, methane lens (cyan + = catalog position)")
        out = pathlib.Path("data/poc"); out.mkdir(parents=True, exist_ok=True)
        fig.savefig(out / f"lens_{name}.png", dpi=90, bbox_inches="tight")
    except Exception as e:
        print("plot skipped", e)


if __name__ == "__main__":
    # positions approx. at epoch ~2025.9 (propagated with literature PM)
    run("EpsIndiB", 331.0965, -56.8006)   # ε Indi Ba/Bb (T1+T6)
    run("WISE0855", 133.7600, -7.2422)    # Y4 (from our SPHEREx PoC centroid)
