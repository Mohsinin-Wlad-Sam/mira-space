#!/usr/bin/env python3
"""Proof of concept: S3 byte-range cutouts of SPHEREx L2 images + detection/motion of WISE 0855-0714.

- Reads only the needed rows of IMAGE/ZODI/VARIANCE/FLAGS from s3://nasa-irsa-spherex (anonymous) via fsspec.
- Builds per-visit, per-band inverse-variance coadds on a common tangent-plane grid (nearest-pixel, PoC only).
- Reports S/N of WISE 0855 per exposure and per visit, and the centroid shift between visits.

Usage: python3 scripts/poc/wise0855_poc.py [--bands D5,D6] [--size 0.08]
"""
import argparse, csv, json, math, pathlib, sys, time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from astropy.coordinates import SkyCoord
import astropy.units as u
import warnings
warnings.filterwarnings("ignore")

# AllWISE-epoch position (designation J085510.83-071442.5, epoch ~2010.56) and literature PM (Luhman & Esplin 2016)
RA0, DEC0, EPOCH0_MJD = 133.79513, -7.24515, 55400.0
PMRA, PMDEC = -8.12, 0.67  # arcsec/yr (pmra includes cos dec)


def predicted(mjd):
    dt = (mjd - EPOCH0_MJD) / 365.25
    dec = DEC0 + PMDEC * dt / 3600
    ra = RA0 + PMRA * dt / 3600 / math.cos(math.radians(DEC0))
    return ra, dec


def cutout(row, size_deg):
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "bundler"))
    from s3fits import RemoteFITS
    mjd = float(row["mjd"])
    ra, dec = predicted(mjd)
    err = None
    for attempt in range(3):
        try:
            rf = RemoteFITS(row["uri"])
            hdr = rf.hdus["IMAGE"].header
            w = WCS(hdr)
            x, y = w.world_to_pixel(SkyCoord(ra * u.deg, dec * u.deg))
            half = int(size_deg * 3600 / 6.15 / 2)
            xi, yi = int(round(float(x))), int(round(float(y)))
            if not (half <= xi < 2040 - half and half <= yi < 2040 - half):
                return None
            y0, y1, x0, x1 = yi - half, yi + half + 1, xi - half, xi + half + 1
            img = rf.rows("IMAGE", y0, y1, x0, x1) - rf.rows("ZODI", y0, y1, x0, x1)
            var = rf.rows("VARIANCE", y0, y1, x0, x1)
            flg = np.zeros(img.shape, np.int32)  # PoC: bad pixels are NaN in IMAGE; FLAGS decoding in bundler
            hl = rf.spectral_hdulist(); swcs = WCS(hl["IMAGE"].header, fobj=hl, key="W"); swcs.sip = None
            lam = float(swcs.pixel_to_world(float(x), float(y))[0].to(u.um).value)
            return dict(mjd=mjd, band=row["band"], img=img, var=var, flg=flg, lam=lam,
                        wcs=w[y0:y1, x0:x1], psf_fwhm=hdr.get("PSF_FWHM", 7.5))
        except Exception as e:
            err = e; time.sleep(1 + attempt)
    print("fail", row["uri"], err, file=sys.stderr)
    return None


def psf_flux(c, ra, dec, fwhm_arcsec):
    """Gaussian-PSF matched-filter flux at a sky position (PoC; real tool uses EPSF extension)."""
    x, y = c["wcs"].world_to_pixel(SkyCoord(ra * u.deg, dec * u.deg))
    yy, xx = np.indices(c["img"].shape)
    s = fwhm_arcsec / 2.355 / 6.15
    p = np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * s * s)); p /= p.sum()
    good = (c["var"] > 0) & np.isfinite(c["img"]) & np.isfinite(c["var"]) & ((c["flg"] & ((1 << 0) | (1 << 1) | (1 << 6) | (1 << 9) | (1 << 19) | (1 << 25) | (1 << 27))) == 0)
    bkg = np.nanmedian(c["img"][good])
    wgt = np.where(good, p / np.where(good, c["var"], 1.0), 0.0)
    f = np.sum(wgt * np.where(good, c["img"] - bkg, 0.0)) / np.sum(wgt * p)
    sig = 1 / math.sqrt(np.sum(wgt * p))
    return f, sig


def centroid(c, ra, dec, box=3):
    x, y = c["wcs"].world_to_pixel(SkyCoord(ra * u.deg, dec * u.deg))
    xi, yi = int(round(float(x))), int(round(float(y)))
    sub = c["img"][yi - box:yi + box + 1, xi - box:xi + box + 1]
    sub = sub - np.nanmedian(c["img"])
    sub = np.clip(np.nan_to_num(sub), 0, None)
    yy, xx = np.indices(sub.shape)
    if sub.sum() <= 0:
        return None
    cx, cy = (xx * sub).sum() / sub.sum() + xi - box, (yy * sub).sum() / sub.sum() + yi - box
    sky = c["wcs"].pixel_to_world(cx, cy)
    return sky.ra.deg, sky.dec.deg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bands", default="SPHEREx-D5,SPHEREx-D6")
    ap.add_argument("--size", type=float, default=0.08)
    ap.add_argument("--list", default="data/feasibility/list_WISE0855.csv")
    a = ap.parse_args()
    rows = [r for r in csv.DictReader(open(a.list)) if r["band"] in a.bands.split(",")]
    t0 = time.time()
    with ThreadPoolExecutor(24) as ex:
        cuts = [c for c in ex.map(lambda r: cutout(r, a.size), rows) if c]
    print(f"{len(cuts)}/{len(rows)} cutouts in {time.time()-t0:.1f}s via S3 range reads")
    # cluster into visits
    cuts.sort(key=lambda c: c["mjd"])
    visits = [[cuts[0]]]
    for c in cuts[1:]:
        (visits[-1].append(c) if c["mjd"] - visits[-1][-1]["mjd"] < 15 else visits.append([c]))
    summary = []
    for v in visits:
        mjd = np.mean([c["mjd"] for c in v]); ra, dec = predicted(mjd)
        fl = [psf_flux(c, ra, dec, c["psf_fwhm"]) for c in v]
        snr = [f / s for f, s in fl if np.isfinite(f) and s > 0]
        cents = [centroid(c, ra, dec) for c in v if psf_flux(c, ra, dec, c["psf_fwhm"])[0] / psf_flux(c, ra, dec, c["psf_fwhm"])[1] > 3]
        cents = [p for p in cents if p]
        mra = float(np.median([p[0] for p in cents])) if cents else float("nan")
        mde = float(np.median([p[1] for p in cents])) if cents else float("nan")
        summary.append(dict(mjd=float(mjd), n=len(v), lam_range=[min(c["lam"] for c in v), max(c["lam"] for c in v)],
                            snr_median=float(np.median(snr)), snr_max=float(np.max(snr)),
                            snr_stack=float(math.sqrt(sum(max(s, 0) ** 2 for s in snr))),
                            n_centroids=len(cents), ra=mra, dec=mde))
        print(f"visit MJD {mjd:.1f} n={len(v)} λ={summary[-1]['lam_range'][0]:.2f}-{summary[-1]['lam_range'][1]:.2f}um "
              f"S/N per-exp median={np.median(snr):.1f} max={np.max(snr):.1f} stacked~{summary[-1]['snr_stack']:.1f} "
              f"centroid=({mra:.6f},{mde:.6f}) from {len(cents)}")
    good = [s for s in summary if s["n_centroids"] >= 3]
    if len(good) >= 2:
        a0, a1 = good[0], good[-1]
        dt = (a1["mjd"] - a0["mjd"]) / 365.25
        dra = (a1["ra"] - a0["ra"]) * 3600 * math.cos(math.radians(DEC0)); dde = (a1["dec"] - a0["dec"]) * 3600
        print(f"motion between visits over {dt:.2f} yr: dRA*={dra:+.2f}\" dDec={dde:+.2f}\" -> "
              f"pmRA*={dra/dt:+.2f} pmDec={dde/dt:+.2f} \"/yr (lit: {PMRA:+.2f}, {PMDEC:+.2f}; parallax 0.44\" not removed)")
    out = pathlib.Path("data/poc"); out.mkdir(parents=True, exist_ok=True)
    (out / "wise0855_poc_summary.json").write_text(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
