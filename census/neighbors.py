#!/usr/bin/env python3
"""Solar neighbourhood (< 20 pc) for the 3D view: Gaia DR3 astrometry -> Galactic Cartesian position & velocity.

Positions in light-years (Sun at origin, x toward the Galactic centre, z toward the North Galactic Pole),
velocities in light-years per year (straight-line space motion; accurate to <1% over ~100 kyr locally).
Also: time and distance of closest approach to the Sun, t* = -(p.v)/|v|^2, d* = |p + v t*|.
usage: python census/neighbors.py --out web/public/data/neighbors.json
"""
from __future__ import annotations

import argparse, csv, io, json, math, urllib.parse, urllib.request

import numpy as np
from astropy.coordinates import SkyCoord, Galactic
import astropy.units as u

TAP = "https://irsa.ipac.caltech.edu/TAP/sync"
PC_LY = 3.26156
NAMES = {  # J2000 positions (deg) for labelling
    "Proxima Centauri": (217.42895, -62.67949), "Alpha Centauri A": (219.90206, -60.83399), "Alpha Centauri B": (219.89610, -60.83753),
    "Barnard's Star": (269.45208, 4.69339), "Wolf 359": (164.12027, 7.01447), "Lalande 21185": (165.83414, 35.96988),
    "Sirius": (101.28716, -16.71612), "Luyten 726-8": (24.75500, -17.95000), "Ross 154": (282.45568, -23.83623),
    "Ross 248": (355.47975, 44.17745), "Epsilon Eridani": (53.23268, -9.45826), "Lacaille 9352": (346.46681, -35.85307),
    "Ross 128": (176.93497, 0.80451), "61 Cygni A": (316.72475, 38.74942), "61 Cygni B": (316.73027, 38.74270),
    "Procyon": (114.82549, 5.22499), "Epsilon Indi A": (330.84022, -56.78598), "Epsilon Indi B": (331.04415, -56.78284),
    "Tau Ceti": (26.01701, -15.93748), "Luyten's Star": (111.85208, 5.22581), "Kapteyn's Star": (77.91904, -45.01842),
    "Gliese 710": (274.09700, -1.93880), "Luhman 16": (162.32850, -53.31944), "Altair": (297.69583, 8.86832),
    "Vega": (279.23473, 38.78369), "Gliese 445": (176.92250, 78.69111), "Fomalhaut": (344.41269, -29.62224), "GJ 1": (1.38382, -37.36889),
}
EXTRA = [  # objects too faint for Gaia: (name, ra, dec, parallax mas, pmra, pmdec mas/yr, rv km/s or None)
    ("WISE 0855-0714", 133.81890825, -7.247048, 439.0, -8123.7, 673.2, None),
]


def query():
    q = ("SELECT source_id, ra, dec, parallax, pmra, pmdec, radial_velocity, radial_velocity_error, rv_nb_transits, phot_g_mean_mag, bp_rp "
         "FROM gaia_dr3_source WHERE parallax > 50 AND parallax_over_error > 10")
    d = urllib.parse.urlencode({"QUERY": q, "FORMAT": "csv"}).encode()
    return list(csv.DictReader(io.StringIO(urllib.request.urlopen(TAP, d, timeout=600).read().decode())))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default="web/public/data/neighbors.json"); a = ap.parse_args()
    rows = query()
    f = lambda v: float(v) if v not in ("", None) else np.nan
    ra = np.array([f(r["ra"]) for r in rows]); dec = np.array([f(r["dec"]) for r in rows]); plx = np.array([f(r["parallax"]) for r in rows])
    pmra = np.array([f(r["pmra"]) for r in rows]); pmdec = np.array([f(r["pmdec"]) for r in rows]); rv = np.array([f(r["radial_velocity"]) for r in rows])
    g = np.array([f(r["phot_g_mean_mag"]) for r in rows]); bprp = np.array([f(r["bp_rp"]) for r in rows])
    # Gaia DR3 radial velocities: keep only well-measured ones (spurious RVs of a few hundred km/s create fake close encounters)
    rve = np.array([f(r["radial_velocity_error"]) for r in rows]); nbt = np.array([f(r["rv_nb_transits"]) for r in rows])
    good_rv = np.isfinite(rv) & (rve < 2.0) & (nbt >= 6) & (np.abs(rv) < 150)
    print("radial velocities kept:", int(good_rv.sum()), "of", int(np.isfinite(rv).sum()))
    rv = np.where(good_rv, rv, np.nan)
    src = ["gaia"] * len(rows); sids = [r["source_id"] for r in rows]
    for (nm, r_, d_, p_, pa, pd, v_) in EXTRA:
        ra = np.r_[ra, r_]; dec = np.r_[dec, d_]; plx = np.r_[plx, p_]; pmra = np.r_[pmra, pa]; pmdec = np.r_[pmdec, pd]
        rv = np.r_[rv, np.nan if v_ is None else v_]; g = np.r_[g, np.nan]; bprp = np.r_[bprp, 6.0]; src.append(nm); sids.append("")
    has_rv = np.isfinite(rv)
    c = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, distance=(1000 / plx) * u.pc, pm_ra_cosdec=pmra * u.mas / u.yr,
                 pm_dec=pmdec * u.mas / u.yr, radial_velocity=np.nan_to_num(rv) * u.km / u.s, frame="icrs").transform_to(Galactic())
    p = np.c_[c.cartesian.x.to_value(u.pc), c.cartesian.y.to_value(u.pc), c.cartesian.z.to_value(u.pc)] * PC_LY
    v = np.c_[c.velocity.d_x.to_value(u.pc / u.yr), c.velocity.d_y.to_value(u.pc / u.yr), c.velocity.d_z.to_value(u.pc / u.yr)] * PC_LY
    vv = (v ** 2).sum(1); tstar = np.where(vv > 0, -(p * v).sum(1) / vv, 0.0); dstar = np.linalg.norm(p + v * tstar[:, None], axis=1)
    # names by position (within 1 arcmin of J2000 position, accounting for proper motion to 2016)
    names = [""] * len(ra)
    for nm, (r0, d0) in NAMES.items():
        dd = np.hypot((ra - r0) * np.cos(np.radians(d0)), dec - d0) * 60
        k = int(np.nanargmin(dd))
        if dd[k] < 3.0 and not names[k]: names[k] = nm
    for i, s in enumerate(src):
        if s != "gaia": names[i] = s
    label = [names[i] or f"Gaia DR3 {sids[i]}" for i in range(len(ra))]
    stars = []
    for i in range(len(ra)):
        if not np.all(np.isfinite(p[i])): continue
        stars.append([round(float(x), 4) for x in p[i]] + [round(float(x), 7) for x in v[i]] +
                     [None if not np.isfinite(g[i]) else round(float(g[i]), 2), None if not np.isfinite(bprp[i]) else round(float(bprp[i]), 2),
                      int(has_rv[i]), names[i], round(float(tstar[i])), round(float(dstar[i]), 3), label[i]])
    # notable approaches within +-100 kyr (only stars with measured radial velocity)
    appr = sorted([s for s in stars if s[8] and abs(s[10]) < 1e5 and s[11] < 10], key=lambda s: s[11])[:20]
    json.dump(dict(units="ly, ly/yr, Galactic (x->GC, z->NGP), epoch J2016", fields=["x", "y", "z", "vx", "vy", "vz", "g", "bp_rp", "has_rv", "name", "t_closest_yr", "d_closest_ly", "label"],
                   n=len(stars), stars=stars, approaches=[dict(name=s[12], t=s[10], d=s[11]) for s in appr]),
              open(a.out, "w"), separators=(",", ":"))
    print(len(stars), "stars;", "named:", sum(1 for s in stars if s[9]))
    for s in stars:
        if s[9] in ("Barnard's Star", "Proxima Centauri", "Gliese 710", "Ross 248", "WISE 0855-0714"):
            print(f"  {s[9]:18s} now {np.linalg.norm(s[:3]):6.2f} ly  closest {s[11]:6.2f} ly at {2016 + s[10]:+.0f} yr  has_rv={s[8]}")


if __name__ == "__main__":
    main()
