#!/usr/bin/env python3
"""16-year light curves (WISE W1/W2 2010-2020 epochs + SPHEREx 2025-26 synthetic W2) for featured objects.

Objects are grouped by HEALPix order-5 tile so each unWISE tile is streamed once. For every object the detections
are taken along its *moving* track (position at each epoch from the census proper motion), within 2.5".
Output: <web>/lc/<id>.json  {id, points:[{mjd, band, uJy, err}], spherex:{mjd, w2_uJy, err, cal}}
usage: python -m census.lightcurves --web ~/skylens/web_data --top 150
"""
from __future__ import annotations

import argparse, json, math, os, pathlib, sys
from collections import defaultdict

import numpy as np
from astropy_healpix import HEALPix
from astropy.coordinates import SkyCoord
import astropy.units as u
from scipy.spatial import cKDTree

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from census.io_sources import read_unwise_tile  # noqa: E402

NMGY_UJY = {1: 0.30954, 2: 0.171787}
CAL_W2 = 1.225          # SPHEREx flat-weighted 4-5 um / WISE W2 (median of validation tiles)
TREF_MJD = 57500.0      # census reference epoch (2016.4)
HP = HEALPix(nside=32, order="nested", frame="icrs")
TARGETS = {"barnard": (269.45207511, 4.69339088, -801.55, 10362.54), "eps-indi-b": (331.04414659, -56.78284420, 3981.98, -2466.83),
           "wise-0855": (133.81890825, -7.247048, -8123.7, 673.2), "rw-aur": (76.95642, 30.40108, 4.0, -24.0),
           "r-dra": (248.16917, 66.75236, -9.0, 12.0)}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--web", default="~/skylens/web_data"); ap.add_argument("--top", type=int, default=150)
    a = ap.parse_args()
    web = pathlib.Path(os.path.expanduser(a.web)); out = web / "lc"; out.mkdir(parents=True, exist_ok=True)
    objs = {}   # id -> (ra@2016.4, dec@2016.4, pmra"/yr, pmdec"/yr, sx_w2, sx_err)
    for oid, (ra, dec, pa, pd) in TARGETS.items():  # SIMBAD J2000 -> 2016.4
        dt = 16.4; objs[oid] = (ra + pa / 3.6e6 * dt / math.cos(math.radians(dec)), dec + pd / 3.6e6 * dt, pa / 1000, pd / 1000, None, None)
    tg = json.loads((web / "targets.json").read_text()) if (web / "targets.json").exists() else []
    name2id = {"Barnard's Star": "barnard", "Epsilon Indi B": "eps-indi-b", "WISE 0855-0714": "wise-0855", "RW Aurigae": "rw-aur", "R Draconis": "r-dra"}
    for t in tg:
        c = t.get("census")
        if c and t["name"] in name2id:
            o = objs[name2id[t["name"]]]; objs[name2id[t["name"]]] = (o[0], o[1], o[2], o[3], c.get("sx_w2_uJy"), c.get("sx_w2_err"))
    for feed in ("movers", "methane", "vanished", "brightened"):
        p = web / f"{feed}.json"
        if p.exists():
            for c in json.loads(p.read_text())["items"][: a.top]:
                rel = c.get("reliable_motion")
                objs[f"{c['tile']}-{c['obj']}"] = (c["ra"], c["dec"], (c.get("pmra") or 0) if rel else 0, (c.get("pmdec") or 0) if rel else 0,
                                                   c.get("sx_w2_uJy"), c.get("sx_w2_err"))
    by_tile = defaultdict(list)
    for oid, o in objs.items():
        if (out / f"{oid}.json").exists(): continue
        by_tile[int(HP.skycoord_to_healpix(SkyCoord(o[0] * u.deg, o[1] * u.deg)))].append(oid)
    print(f"{sum(len(v) for v in by_tile.values())} objects in {len(by_tile)} tiles", flush=True)
    for n, (tile, ids) in enumerate(by_tile.items(), 1):
        try:
            det, _ = read_unwise_tile(tile, ["ra", "dec", "flux", "dflux", "band", "MJDMEAN", "primary"])
        except Exception as e:  # noqa: BLE001
            print("tile", tile, "failed", e, flush=True); continue
        cosd = math.cos(math.radians(float(np.median(det["dec"]))))
        tree = cKDTree(np.c_[det["ra"] * cosd, det["dec"]] * 3600)
        for oid in ids:
            ra, dec, pmra, pmdec, sxw2, sxe = objs[oid]
            # candidates within the full 2010-2020 track, then exact per-epoch check
            span = 6.0 * max(1.0, math.hypot(pmra, pmdec))
            cand = tree.query_ball_point([ra * cosd * 3600, dec * 3600], span * 3 + 5)
            pts = []
            for j in cand:
                dt = (det["MJDMEAN"][j] - TREF_MJD) / 365.25
                r0 = ra + pmra / 3600 * dt / math.cos(math.radians(dec)); d0 = dec + pmdec / 3600 * dt
                if math.hypot((det["ra"][j] - r0) * math.cos(math.radians(dec)), det["dec"][j] - d0) * 3600 < 2.5:
                    b = int(det["band"][j])
                    pts.append(dict(mjd=round(float(det["MJDMEAN"][j]), 2), band=f"W{b}", uJy=round(float(det["flux"][j]) * NMGY_UJY[b], 3),
                                    err=round(float(det["dflux"][j]) * NMGY_UJY[b], 3)))
            pts.sort(key=lambda p: p["mjd"])
            sp = None if sxw2 is None else dict(mjd=60980.0, w2_uJy=round(sxw2 / CAL_W2, 3), err=None if sxe is None else round(sxe / CAL_W2, 3), cal=CAL_W2)
            (out / f"{oid}.json").write_text(json.dumps(dict(id=oid, points=pts, spherex=sp), separators=(",", ":")))
        if n % 20 == 0: print(f"{n}/{len(by_tile)} tiles", flush=True)
    print("done", flush=True)


if __name__ == "__main__":
    main()
