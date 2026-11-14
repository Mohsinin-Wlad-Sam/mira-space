#!/usr/bin/env python3
"""PoC: 'decade lens' — WISE-era (unWISE neo7 W2 coadd) vs SPHEREx-era (DR1 cube synthetic-W2) at the same place.

Both inputs are browser-fetchable (unwise.me and the nasa-irsa-spherex bucket send CORS *).
SPHEREx synthetic W2 = mean of cube channel planes within 4.0-5.2 um (W2 passband, flat weighting for the PoC).
Both images are resampled onto one tangent-plane grid, PSF-matched by Gaussian smoothing, flux-scaled on field stars,
and differenced:  movers show as +/- dipoles, long-term variables as monopoles.
Writes data/poc/decade_<name>.png.
"""
import io, pathlib, sys, tarfile, warnings
import numpy as np, requests
from astropy.io import fits
from astropy.wcs import WCS
from astropy.coordinates import SkyCoord
import astropy.units as u
from scipy.ndimage import gaussian_filter, map_coordinates

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from lens_poc import tile_for, channels, plane_rows  # noqa: E402
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "bundler"))
from s3fits import RemoteFITS  # noqa: E402
warnings.filterwarnings("ignore")


def unwise_w2(ra, dec, size=240):
    r = requests.get("https://unwise.me/cutout_fits", params=dict(version="neo7", ra=ra, dec=dec, size=size, bands=2,
                     file_img_m="on"), timeout=60)
    tf = tarfile.open(fileobj=io.BytesIO(r.content))
    m = [n for n in tf.getnames() if n.endswith("img-m.fits")][0]
    h = fits.open(io.BytesIO(tf.extractfile(m).read()))[0]
    h.header["RADESYS"] = "ICRS"; h.header["EQUINOX"] = 2000.0  # unWISE cutouts carry EQUINOX=-1 -> bogus FK4
    return h.data.astype(np.float32), WCS(h.header), h.header


def celestial(hdr):
    hdr = hdr.copy()
    for k in list(hdr.keys()):
        if (k.endswith("3") and k[:-1] in ("NAXIS", "CTYPE", "CUNIT", "CRPIX", "CRVAL", "CDELT", "CNAME")) or \
                k.startswith(("PS3_", "PV3_", "PC3_", "CD3_")) or k in ("PC1_3", "PC2_3", "CD1_3", "CD2_3"):
            del hdr[k]
    hdr["NAXIS"] = 2; hdr["WCSAXES"] = 2
    return WCS(hdr)


def run(name, ra, dec, size=240):
    uw, uwcs, uh = unwise_w2(ra, dec, size)
    npix, key = tile_for(ra, dec)
    rf = RemoteFITS(key)
    lam = np.array(channels(rf)[[c for c in channels(rf).columns.names if "CENT" in c.upper() or "WAVE" in c.upper()][0]], float)
    cw = celestial(rf.hdus["IMAGE"].header)
    # region of cube rows covering the unWISE cutout
    ny, nx = uw.shape
    corners = uwcs.pixel_to_world([0, nx - 1, 0, nx - 1], [0, 0, ny - 1, ny - 1])
    cx, cy = cw.world_to_pixel(corners)
    y0, y1 = int(max(0, np.floor(cy.min()) - 3)), int(min(512, np.ceil(cy.max()) + 4))
    chans = [i for i, l in enumerate(lam) if 4.0 <= l <= 5.2]
    cube = np.nanmean([plane_rows(rf, c, y0, y1) for c in chans], axis=0)
    # resample cube synthetic-W2 onto the unWISE grid
    yy, xx = np.indices(uw.shape)
    sky = uwcs.pixel_to_world(xx.ravel(), yy.ravel())
    px, py = cw.world_to_pixel(sky)
    sp = map_coordinates(np.nan_to_num(cube), [py - y0, px], order=1, mode="nearest").reshape(uw.shape)
    # PSF match: unWISE W2 FWHM ~6.4" on 2.75" px; cube effective ~14" -> smooth unWISE to ~14"
    sig = np.sqrt(max(14.0 ** 2 - 6.4 ** 2, 1)) / 2.355 / 2.75
    uws = gaussian_filter(uw, sig)
    # flux scale on bright field pixels (robust ratio), then normalised difference
    m = (uws > np.nanpercentile(uws, 99.0)) & (sp > np.nanpercentile(sp, 99.0))
    scale = np.nanmedian(sp[m] / uws[m])
    diff = sp - scale * uws
    noise = 1.4826 * np.nanmedian(np.abs(diff - np.nanmedian(diff)))
    t = uwcs.world_to_pixel(SkyCoord(ra * u.deg, dec * u.deg))
    print(f"{name}: unWISE {uw.shape} + cube tile Npix{npix} rows {y0}-{y1}, {len(chans)} channels "
          f"({len(chans)*(y1-y0)*2048/1e6:.1f} MB); scale={scale:.3g}; diff range {np.nanmin(diff)/noise:.0f}..{np.nanmax(diff)/noise:.0f} sigma")
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    fig, ax = plt.subplots(1, 3, figsize=(13, 4.5))
    for a, img, title, cm in [(ax[0], uws, "WISE era: unWISE W2 (neo7 coadd)", "magma"),
                              (ax[1], sp, "SPHEREx era: DR1 cube synthetic W2", "magma"),
                              (ax[2], diff / noise, "decade lens: SPHEREx - WISE (sigma)", "RdBu_r")]:
        if cm == "RdBu_r":
            a.imshow(img, origin="lower", cmap=cm, vmin=-25, vmax=25)
        else:
            v = np.nanpercentile(img, [5, 99.7]); a.imshow(img, origin="lower", cmap=cm, vmin=v[0], vmax=v[1])
        a.set_title(title, fontsize=10); a.set_xticks([]); a.set_yticks([])
    fig.suptitle(f"{name}: decade lens (both inputs fetched by URL, CORS-enabled)")
    out = pathlib.Path("data/poc"); out.mkdir(parents=True, exist_ok=True)
    fig.savefig(out / f"decade_{name}.png", dpi=90, bbox_inches="tight")


if __name__ == "__main__":
    run("Barnard", 269.4486, 4.7397)   # Barnard's Star, approx. mid-epoch position
