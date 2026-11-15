"""When did SPHEREx image each part of the sky?  One small file for the Sky map's "SPHEREx, live" layer.

Reads the exposure index made by sphx_index2.py (<web>/sphx2/<pix>.json, HEALPix nside 32, nested) and writes
<web>/sphx2/coverage.json: for each of the 12,288 sky cells, the visits SPHEREx paid to it, as pairs of days
(first day, last day of the visit) counted from `mjd0`.  A visit is a run of exposures with no gap longer than
GAP days.  The index keeps up to K exposures per detector and cell, spread over the visits, so a visit's first day
can be a day or two late; the number of visits and their months are exact.

Run after every rebuild of the index (deploy/update_spherex.sh does):
    python3 -m census.sphx_coverage --web /path/to/web_data
"""
import argparse, json, math
from pathlib import Path

GAP = 20          # days without an exposure that separate two visits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--web", required=True, help="directory that contains sphx2/")
    a = ap.parse_args()
    d = Path(a.web) / "sphx2"
    meta = json.loads((d / "meta.json").read_text())
    nside = meta["nside"]; npix = 12 * nside * nside
    mjd0 = math.floor(meta["mjd_min"])
    visits, total, empty = [], 0, 0
    for p in range(npix):
        f = d / f"{p}.json"
        if not f.exists():
            visits.append([]); empty += 1; continue
        days = sorted({int(e[0] - mjd0) for e in json.loads(f.read_text())["e"]})
        v = []
        for x in days:
            if v and x - v[-1] <= GAP: v[-1] = x
            else: v += [x, x]
        visits.append(v); total += len(v) // 2
    out = dict(v=1, nside=nside, order="nested", mjd0=mjd0, first=meta["first"], last=meta["last"], days=int(meta["mjd_max"] - mjd0),
               exposures=meta["exposures"], gap=GAP, built=meta.get("built"), visits=visits)
    (d / "coverage.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"coverage.json: {npix} cells, {sum(1 for v in visits if v)} imaged at least once, {total} visits, through {meta['last']}"
          f" ({(d / 'coverage.json').stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
