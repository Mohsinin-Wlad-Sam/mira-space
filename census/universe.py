#!/usr/bin/env python3
"""Data for the large scales of the 3D view, all from official archives:
  * cosmic web: NED (NASA/IPAC Extragalactic Database) galaxies with spectroscopic redshifts 0.002 < z < 0.06
  * deep universe: a 1-in-N sample of NED quasars, z up to ~7
  * edge of the observable universe: Planck PR2 SMICA CMB temperature map (IRSA mirror of the Planck Legacy Archive)
Comoving distances with the Planck 2018 cosmology (astropy). Galactic heliocentric frame, parsecs.
out: <web>/universe/galaxies.bin (Float32 x,y,z ; Float32 z_redshift) + quasars.bin + meta.json + cmb_4096.jpg / cmb_2048.jpg
usage: python -m census.universe --web ~/skylens/web_data
"""
from __future__ import annotations

import argparse, csv, io, json, pathlib, time, urllib.parse, urllib.request

import numpy as np

NED = "https://ned.ipac.caltech.edu/tap"
CMB = "https://irsa.ipac.caltech.edu/data/Planck/release_2/all-sky-maps/maps/component-maps/cmb/COM_CMB_IQU-smica_1024_R2.02_full.fits"


def tap(url, q, out: pathlib.Path):
    if out.exists() and out.stat().st_size > 1000: return out.read_text()
    d = urllib.parse.urlencode(dict(REQUEST="doQuery", LANG="ADQL", FORMAT="csv", QUERY=q, PHASE="RUN")).encode()
    job = urllib.request.urlopen(urllib.request.Request(url + "/async", d), timeout=300).geturl()
    while True:
        ph = urllib.request.urlopen(job + "/phase", timeout=120).read().decode().strip()
        if ph in ("COMPLETED", "ERROR", "ABORTED"): break
        time.sleep(10)
    if ph != "COMPLETED": raise SystemExit(urllib.request.urlopen(job + "/error").read()[:400])
    txt = urllib.request.urlopen(job + "/results/result", timeout=1800).read().decode(); out.write_text(txt); return txt


def ned_sync(q):
    d = urllib.parse.urlencode(dict(REQUEST="doQuery", LANG="ADQL", FORMAT="csv", QUERY=q)).encode()
    for k in range(4):
        try: return urllib.request.urlopen(urllib.request.Request(NED + "/sync", d), timeout=900).read().decode()
        except Exception as e: print("  retry", k, e, flush=True); time.sleep(10)
    return ""


def ned_chunked(where, zbins, out: pathlib.Path, top: int | None = None):
    """NED's async TAP fails on large jobs; sync queries in redshift slices work."""
    if out.exists() and out.stat().st_size > 1000: return out.read_text()
    parts = ["ra,dec,z"]
    for z0, z1 in zip(zbins[:-1], zbins[1:]):
        t = ned_sync(f"SELECT {'TOP ' + str(top) + ' ' if top else ''}ra, dec, z FROM NEDTAP.objdir WHERE {where} AND z >= {z0:.5f} AND z < {z1:.5f}")
        rows = [r for r in t.splitlines()[1:] if r.strip() and not r.startswith("<")]
        parts += rows; print(f"  z {z0:.4f}-{z1:.4f}: {len(rows)}", flush=True)
    txt = "\n".join(parts); out.write_text(txt); return txt


def to_xyz(ra, dec, dpc):
    from astropy.coordinates import SkyCoord
    import astropy.units as u
    g = SkyCoord(ra * u.deg, dec * u.deg).galactic
    l, b = g.l.radian, g.b.radian
    return np.c_[dpc * np.cos(b) * np.cos(l), dpc * np.cos(b) * np.sin(l), dpc * np.sin(b)].astype(np.float32)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--web", default="~/skylens/web_data"); ap.add_argument("--cache", default="~/skylens/ai"); ap.add_argument("--no-qso", action="store_true")
    a = ap.parse_args(); web = pathlib.Path(a.web).expanduser() / "universe"; web.mkdir(parents=True, exist_ok=True); cache = pathlib.Path(a.cache).expanduser()
    from astropy.cosmology import Planck18
    import astropy.units as u
    meta = {}
    # ---- galaxies (spectroscopic redshifts only: zunc small)
    txt = ned_chunked("prefphytype = 'G' AND zunc IS NOT NULL AND zunc < 0.0005", np.linspace(0.002, 0.06, 59), cache / "ned_galaxies.csv")
    R = list(csv.DictReader(io.StringIO(txt)))
    ra = np.array([float(r["ra"]) for r in R]); dec = np.array([float(r["dec"]) for r in R]); z = np.array([float(r["z"]) for r in R])
    d = Planck18.comoving_distance(z).to(u.pc).value
    xyz = to_xyz(ra, dec, d); np.c_[xyz, z.astype(np.float32)].astype(np.float32).tofile(web / "galaxies.bin")
    meta["galaxies"] = dict(n=int(len(z)), z_max=0.06, source="NED objdir, prefphytype G, spectroscopic z (zunc < 0.0005)")
    print("galaxies", len(z), flush=True)
    # ---- quasars (optional: NED's synchronous TAP times out on these slices; skipped with --no-qso)
    if a.no_qso:
        meta["quasars"] = dict(n=0, note="skipped"); a.skip_q = True
    else: a.skip_q = False
    if not a.skip_q:
      pass
    # (quasar block below runs only when requested)
    if not a.skip_q:
        txt = ned_chunked("prefphytype = 'QSO'", np.r_[np.linspace(0.05, 3.0, 60), np.linspace(3.05, 7.5, 10)], cache / "ned_qso.csv", top=2000)
        R = list(csv.DictReader(io.StringIO(txt)))
        ra = np.array([float(r["ra"]) for r in R]); dec = np.array([float(r["dec"]) for r in R]); z = np.array([float(r["z"]) for r in R])
        ok = (z > 0.05) & (z < 7.6); ra, dec, z = ra[ok], dec[ok], z[ok]
        d = Planck18.comoving_distance(z).to(u.pc).value
        np.c_[to_xyz(ra, dec, d), z.astype(np.float32)].astype(np.float32).tofile(web / "quasars.bin")
        meta["quasars"] = dict(n=int(len(z)), source="NED objdir, prefphytype QSO with redshift; up to 2,000 per Δz = 0.05 slice (a sample, not the full set)")
        print("quasars", len(z), flush=True)
    # ---- CMB (Planck SMICA) -> Galactic equirectangular image (Planck's own map is in Galactic coordinates)
    fp = cache / "planck_smica_1024.fits"
    if not fp.exists(): urllib.request.urlretrieve(CMB, fp)
    from astropy.io import fits
    from astropy_healpix import HEALPix
    from PIL import Image
    h = fits.open(fp); t = h[1].data["I_STOKES"].astype(np.float64).ravel(); hdr = h[1].header
    hp = HEALPix(nside=hdr["NSIDE"], order=hdr["ORDERING"].lower())
    for W in (2048, 4096):
        Hh = W // 2; lon = (np.arange(W) + 0.5) / W * 360.0; lat = 90 - (np.arange(Hh) + 0.5) / Hh * 180.0
        L, B = np.meshgrid(lon, lat)
        v = t[hp.lonlat_to_healpix(L.ravel() * u.deg, B.ravel() * u.deg)].reshape(Hh, W) * 1e6   # K -> µK
        v = np.clip(v / 300.0, -1, 1)                                   # ±300 µK
        # Planck-like diverging map: blue (cold) -> white -> red (hot)
        r = np.clip(1.0 + np.minimum(v, 0) * 0.85 + np.maximum(v, 0) * 0.0, 0, 1); g = np.clip(1.0 - np.abs(v) * 0.85, 0, 1); bb = np.clip(1.0 - np.maximum(v, 0) * 0.9, 0, 1)
        r = np.where(v > 0, 1.0, 1 + v * 0.9); bb = np.where(v < 0, 1.0, 1 - v * 0.9)
        Image.fromarray((np.dstack([r, g, bb]) * 255).astype(np.uint8)).save(web / f"cmb_{W}.jpg", quality=88)
    meta["cmb"] = dict(source="Planck PR2 SMICA (IRSA mirror)", scale="±300 µK, blue cold / red hot", frame="Galactic, equirectangular, l = 0 at left, increasing to the right",
                       radius_pc=float(Planck18.comoving_distance(1090).to(u.pc).value))
    (web / "meta.json").write_text(json.dumps(meta, indent=1)); print(json.dumps(meta))


if __name__ == "__main__":
    main()
