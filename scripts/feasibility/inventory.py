#!/usr/bin/env python3
"""Inventory SPHEREx L2 exposures covering a sky position (IRSA TAP), cluster them into visits.

Usage:  python3 scripts/feasibility/inventory.py NAME RA_DEG DEC_DEG [--gap 15]
Writes data/feasibility/list_NAME.csv and prints per-band counts + visit clusters.
Stdlib only (no astroquery needed).
"""
import argparse, collections, csv, io, pathlib, urllib.parse, urllib.request

TAP = "https://irsa.ipac.caltech.edu/TAP/sync"


def query(ra: float, dec: float) -> str:
    adql = (
        "SELECT p.energy_bandpassname AS band, p.time_bounds_lower AS mjd, "
        "p.obs_publisher_did AS did, a.uri "
        "FROM spherex.plane p JOIN spherex.artifact a ON a.planeid = p.planeid "
        f"WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly) "
        "ORDER BY p.time_bounds_lower"
    )
    data = urllib.parse.urlencode({"QUERY": adql, "FORMAT": "csv"}).encode()
    return urllib.request.urlopen(TAP, data, timeout=300).read().decode()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("name"); ap.add_argument("ra", type=float); ap.add_argument("dec", type=float)
    ap.add_argument("--gap", type=float, default=15.0, help="days separating visit clusters")
    a = ap.parse_args()
    txt = query(a.ra, a.dec)
    out = pathlib.Path("data/feasibility"); out.mkdir(parents=True, exist_ok=True)
    (out / f"list_{a.name}.csv").write_text(txt)
    rows = list(csv.DictReader(io.StringIO(txt)))
    if not rows:
        print("no coverage"); return
    print(a.name, len(rows), "exposures")
    print(" per band:", dict(sorted(collections.Counter(r["band"] for r in rows).items())))
    print(" releases:", dict(collections.Counter(r["uri"].split("/")[3] for r in rows)))
    ts = sorted(float(r["mjd"]) for r in rows)
    clusters = [[ts[0]]]
    for t in ts[1:]:
        (clusters[-1].append(t) if t - clusters[-1][-1] < a.gap else clusters.append([t]))
    for c in clusters:
        print(f"  visit MJD {c[0]:.1f}-{c[-1]:.1f}  span {c[-1]-c[0]:5.1f} d  n={len(c)}")
    print(" S3 key of first exposure:", rows[0]["uri"].replace("ibe/data/spherex/", "s3://nasa-irsa-spherex/"))


if __name__ == "__main__":
    main()
