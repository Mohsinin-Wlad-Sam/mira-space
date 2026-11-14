#!/usr/bin/env python3
"""Static SPHEREx exposure index so the browser can build a flipbook for ANY RA/Dec with no server.

IRSA's TAP inventory (spherex.plane + artifact, 1.6 M exposures) is not reachable from browsers (no CORS), but the L2
images on the public S3 bucket are. We dump the inventory once on the cluster and write, per HEALPix order-4 pixel
(3,072 sky patches of 13.4 deg²), a time-sampled list of exposures overlapping it: up to K per detector, spread evenly
over the mission. The page then reads only each exposure's header + the few image rows it needs (HTTP Range).

out: <web>/sphx/<pix>.json  {"pix":p,"e":[[mjd, det, "path", [ra1,dec1,...,ra4,dec4]], ...]}
     path = "<week>/<l2b-version>/<det>/<seq>_<1Dd>"  ->  ibe/data/spherex/<rel>/level2/<week>/<ver>/<det>/level2_<week>_<seq>_<1Dd>_spx_<ver>.fits
usage: python -m census.sphx_index --web ~/skylens/web_data --k 24
"""
from __future__ import annotations

import argparse, binascii, csv, io, json, math, os, pathlib, struct, time, urllib.parse, urllib.request
from collections import defaultdict

import numpy as np

TAP = "https://irsa.ipac.caltech.edu/TAP"


def tap_async(query: str, out: pathlib.Path):
    if out.exists() and out.stat().st_size > 1e6: return out
    d = urllib.parse.urlencode(dict(REQUEST="doQuery", LANG="ADQL", FORMAT="csv", QUERY=query, PHASE="RUN")).encode()
    r = urllib.request.urlopen(urllib.request.Request(TAP + "/async", d), timeout=300); job = r.geturl()
    print("job", job, flush=True)
    while True:
        ph = urllib.request.urlopen(job + "/phase", timeout=120).read().decode().strip()
        if ph in ("COMPLETED", "ERROR", "ABORTED"): break
        time.sleep(15)
    if ph != "COMPLETED": raise SystemExit(urllib.request.urlopen(job + "/error").read()[:500])
    with urllib.request.urlopen(job + "/results/result", timeout=3600) as src, open(out, "wb") as dst:
        while True:
            b = src.read(1 << 22)
            if not b: break
            dst.write(b)
    return out


def wkb_polygon(h: str):
    """EWKB polygon (SRID 4326) -> list of (lon, lat), first ring, closing point dropped."""
    b = binascii.unhexlify(h); le = b[0] == 1; f = "<" if le else ">"
    typ = struct.unpack(f + "I", b[1:5])[0]; off = 5
    if typ & 0x20000000: off += 4                              # SRID present
    nr = struct.unpack(f + "I", b[off:off + 4])[0]; off += 4
    n = struct.unpack(f + "I", b[off:off + 4])[0]; off += 4
    pts = struct.unpack(f + "d" * (2 * n), b[off:off + 16 * n])
    xy = [(pts[2 * k] % 360, pts[2 * k + 1]) for k in range(n)]
    return xy[:-1] if len(xy) > 1 and xy[0] == xy[-1] else xy


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--web", default="~/skylens/web_data"); ap.add_argument("--k", type=int, default=24)
    ap.add_argument("--cache", default="~/skylens/ai/sphx_inventory.csv")
    a = ap.parse_args(); web = pathlib.Path(a.web).expanduser(); cache = pathlib.Path(a.cache).expanduser()
    from astropy_healpix import HEALPix
    import astropy.units as u
    t0 = time.time()
    tap_async("SELECT p.energy_bandpassname, p.time_bounds_lower, p.poly, a.uri FROM spherex.plane p JOIN spherex.artifact a ON a.planeid = p.planeid", cache)
    print(f"inventory {cache.stat().st_size/1e6:.0f} MB in {time.time()-t0:.0f}s", flush=True)
    hp = HEALPix(nside=16, order="nested")
    per = defaultdict(lambda: defaultdict(list))            # pix -> det -> [(mjd, path, poly)]
    n = 0
    with open(cache) as f:
        for r in csv.DictReader(f):
            uri = r["uri"]
            try:
                parts = uri.split("/")                         # ibe/data/spherex/dr1/level2/<week>/<ver>/<det>/level2_<week>_<seq>_<1Dd>_spx_<ver>.fits
                rel, week, ver, det, fn = parts[3], parts[5], parts[6], parts[7], parts[8]
                seq, dd = fn.split("_")[3], fn.split("_")[4]
                poly = wkb_polygon(r["poly"])
            except Exception:
                continue
            lon = np.array([p[0] for p in poly]); lat = np.array([p[1] for p in poly])
            # centre via unit vectors (robust across RA = 0); radius = farthest corner
            v = np.c_[np.cos(np.radians(lat)) * np.cos(np.radians(lon)), np.cos(np.radians(lat)) * np.sin(np.radians(lon)), np.sin(np.radians(lat))]
            c = v.mean(0); c /= np.linalg.norm(c); rad = float(np.degrees(np.arccos(np.clip(v @ c, -1, 1))).max()) + 0.6
            clon, clat = math.degrees(math.atan2(c[1], c[0])) % 360, math.degrees(math.asin(c[2]))
            for p in hp.cone_search_lonlat(clon * u.deg, clat * u.deg, radius=rad * u.deg):
                per[int(p)][int(det)].append((float(r["time_bounds_lower"]), f"{rel}|{week}/{ver}/{det}/{seq}_{dd}", [round(x, 3) for xy in poly for x in xy]))
            n += 1
            if n % 200000 == 0: print(f"{n:,} exposures, {len(per)} pixels, {time.time()-t0:.0f}s", flush=True)
    out = web / "sphx.tmp"; out.mkdir(parents=True, exist_ok=True)
    total = 0
    for pix, dets in per.items():
        rows = []
        for det, L in dets.items():
            L.sort(key=lambda x: x[0])
            if len(L) > a.k: L = [L[int(round(i))] for i in np.linspace(0, len(L) - 1, a.k)]   # evenly spread over the mission
            rows += [[round(m, 5), det, pth, poly] for m, pth, poly in L]
        rows.sort(key=lambda x: x[0]); total += len(rows)
        (out / f"{pix}.json").write_text(json.dumps(dict(pix=pix, nside=16, e=rows), separators=(",", ":")))
    import shutil
    if (web / "sphx").exists(): shutil.rmtree(web / "sphx")
    os.replace(out, web / "sphx")
    meta = dict(nside=16, order="nested", k_per_detector=a.k, exposures=n, entries=total, pixels=len(per), built=time.strftime("%Y-%m-%d %H:%M"),
                url="https://nasa-irsa-spherex.s3.amazonaws.com/{rel}/level2/{week}/{ver}/{det}/level2_{week}_{seq}_{dd}_spx_{ver}.fits")
    (web / "sphx" / "meta.json").write_text(json.dumps(meta))
    print(f"index: {n:,} exposures -> {total:,} entries in {len(per)} pixels ({time.time()-t0:.0f}s)")


if __name__ == "__main__":
    main()
