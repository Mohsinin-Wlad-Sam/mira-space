#!/usr/bin/env python3
"""Precompute 'honest flipbook' stamps for objects: every SPHEREx L2 exposure covering the object.

For each object (ra, dec at a reference epoch + proper motion):
  IRSA TAP inventory -> per exposure: byte-range read of the IMAGE (and ZODI) rows around the object's position
  *at that exposure's date* (motion-propagated), per-pixel wavelength at the object from WCS-WAVE.
Output per object: <out>/<id>.bin (float16 stamps [N,S,S], ZODI-subtracted MJy/sr, NaN = flagged/no data)
                   <out>/<id>.json (per-frame mjd, band, detector, lam_um, bw_um, visit, sub-pixel offset).
usage: python -m census.flipbook --name "WISE 0855-0714" --ra 133.81890825 --dec -7.247048 --pmra -8123.7 --pmdec 673.2 --epoch 2000.0
       python -m census.flipbook --targets   (the five challenge targets)
"""
from __future__ import annotations

import argparse, csv, io, json, math, pathlib, re, sys, time, urllib.parse, urllib.request, warnings
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.wcs import WCS
import astropy.units as u

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts" / "bundler"))
from s3fits import RemoteFITS  # noqa: E402

warnings.filterwarnings("ignore")
TAP = "https://irsa.ipac.caltech.edu/TAP/sync"
TARGETS = {
    "barnard": ("Barnard's Star", 269.45207511, 4.69339088, -801.55, 10362.54),
    "eps-indi-b": ("Epsilon Indi B", 331.04414659, -56.78284420, 3981.98, -2466.83),
    "wise-0855": ("WISE 0855-0714", 133.81890825, -7.247048, -8123.7, 673.2),
    "rw-aur": ("RW Aurigae", 76.95642, 30.40108, 4.0, -24.0),
    "r-dra": ("R Draconis", 248.16917, 66.75236, -9.0, 12.0),
}


def mjd_to_year(mjd): return 2000.0 + (mjd - 51544.5) / 365.25


def position_at(ra, dec, pmra, pmdec, epoch, mjd):
    dt = mjd_to_year(mjd) - epoch
    return ra + pmra / 3.6e6 * dt / math.cos(math.radians(dec)), dec + pmdec / 3.6e6 * dt


def inventory(ra, dec):
    q = ("SELECT p.energy_bandpassname AS band, p.time_bounds_lower AS mjd, a.uri "
         "FROM spherex.plane p JOIN spherex.artifact a ON a.planeid = p.planeid "
         f"WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly) ORDER BY p.time_bounds_lower")
    d = urllib.parse.urlencode({"QUERY": q, "FORMAT": "csv"}).encode()
    txt = urllib.request.urlopen(TAP, d, timeout=300).read().decode()
    return list(csv.DictReader(io.StringIO(txt)))


def stamp(row, obj, size):
    ra, dec, pmra, pmdec, epoch = obj
    mjd = float(row["mjd"])
    r, d = position_at(ra, dec, pmra, pmdec, epoch, mjd)
    for attempt in range(3):
        try:
            rf = RemoteFITS(row["uri"])
            hdr = rf.hdus["IMAGE"].header
            w = WCS(hdr)
            x, y = (float(v) for v in w.world_to_pixel(SkyCoord(r * u.deg, d * u.deg)))
            h = size // 2
            xi, yi = int(round(x)), int(round(y))
            if not (h <= xi < 2040 - h and h <= yi < 2040 - h):
                return None
            y0, y1, x0, x1 = yi - h, yi + h, xi - h, xi + h
            img = rf.rows("IMAGE", y0, y1, x0, x1) - rf.rows("ZODI", y0, y1, x0, x1)
            hl = rf.spectral_hdulist(); sw = WCS(hl["IMAGE"].header, fobj=hl, key="W"); sw.sip = None
            lam, bw = sw.pixel_to_world(x, y)
            det = int(hdr.get("DETECTOR", int(row["band"][-1])))
            return dict(mjd=mjd, band=row["band"].replace("SPHEREx-", ""), detector=det,
                        lam_um=round(float(lam.to(u.um).value), 4), bw_um=round(float(bw.to(u.um).value), 4),
                        dx=round(x - xi, 3), dy=round(y - yi, 3), img=img.astype(np.float32))
        except Exception:
            time.sleep(1 + attempt)
    return None


def build(oid, name, ra, dec, pmra, pmdec, epoch, out: pathlib.Path, size=40, workers=24, max_frames=600):
    t0 = time.time()
    r25, d25 = position_at(ra, dec, pmra, pmdec, epoch, 60980.0)
    rows = inventory(r25, d25)
    if len(rows) > max_frames:  # keep an even subsample in time (deep fields can have thousands)
        idx = np.linspace(0, len(rows) - 1, max_frames).round().astype(int); rows = [rows[i] for i in idx]
    with ThreadPoolExecutor(workers) as ex:
        frames = [f for f in ex.map(lambda rw: stamp(rw, (ra, dec, pmra, pmdec, epoch), size), rows) if f]
    frames.sort(key=lambda f: f["mjd"])
    # visits: gaps > 15 days
    visit, last = 0, None
    for f in frames:
        if last is not None and f["mjd"] - last > 15: visit += 1
        f["visit"] = visit; last = f["mjd"]
    cube = np.stack([f.pop("img") for f in frames]).astype(np.float16) if frames else np.zeros((0, size, size), np.float16)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{oid}.bin").write_bytes(cube.tobytes())
    meta = dict(id=oid, name=name, ra=ra, dec=dec, pmra=pmra, pmdec=pmdec, epoch=epoch, size=size, n=len(frames),
                pix_arcsec=6.15, units="MJy/sr (ZODI-subtracted)", frames=frames, n_inventory=len(rows),
                built=time.strftime("%Y-%m-%dT%H:%M:%S"), seconds=round(time.time() - t0, 1))
    (out / f"{oid}.json").write_text(json.dumps(meta, separators=(",", ":")))
    print(f"{oid}: {len(frames)}/{len(rows)} frames in {time.time()-t0:.0f}s, {cube.nbytes/1e6:.2f} MB")
    return meta


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--targets", action="store_true"); ap.add_argument("--only", default=None)
    ap.add_argument("--name"); ap.add_argument("--id"); ap.add_argument("--ra", type=float); ap.add_argument("--dec", type=float)
    ap.add_argument("--pmra", type=float, default=0); ap.add_argument("--pmdec", type=float, default=0); ap.add_argument("--epoch", type=float, default=2000.0)
    ap.add_argument("--out", default="web/public/data/flipbook"); ap.add_argument("--size", type=int, default=40)
    ap.add_argument("--workers", type=int, default=24)
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    if a.targets:
        for oid, (name, ra, dec, pa, pd) in TARGETS.items():
            if a.only and oid not in a.only.split(","): continue
            build(oid, name, ra, dec, pa, pd, 2000.0, out, a.size, a.workers)
    else:
        oid = a.id or re.sub(r"[^a-z0-9]+", "-", (a.name or f"{a.ra}_{a.dec}").lower()).strip("-")
        build(oid, a.name or oid, a.ra, a.dec, a.pmra, a.pmdec, a.epoch, out, a.size, a.workers)
