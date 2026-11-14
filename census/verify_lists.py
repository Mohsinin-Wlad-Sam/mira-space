"""Work lists for the raw-exposure verification (web/scripts/verify_census.mts), from verify/cands.parquet.

A  the claims most worth checking first: the unknown-neighbour candidates, methane objects with a brown-dwarf colour,
   brightness changes whose trend was already visible inside the WISE years, and every motion above 0.5"/yr
B  the remaining motions above 0.3"/yr, brightest first
C  random samples of each remaining class, to measure how often the survey-level claim survives (purity)

usage: python -m census.verify_lists [--dir ~/skylens/verify]
"""
import argparse, json, os, pathlib

import numpy as np
import pandas as pd


def rows(df):
    return [dict(id=r.id, ra=round(r.ra, 6), dec=round(r.dec, 6), pmra=round(float(r.pmra), 4), pmdec=round(float(r.pmdec), 4)) for r in df.itertuples()]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dir", default="~/skylens/verify"); a = ap.parse_args()
    d = pathlib.Path(os.path.expanduser(a.dir)); (d / "in").mkdir(exist_ok=True)
    t = pd.read_parquet(d / "cands.parquet"); t["id"] = t.tile.astype(str) + "-" + t.obj.astype(str)
    rng = np.random.default_rng(7)
    L = lambda b: (t.lens & b) > 0  # noqa: E731
    late = t.w2_late_uJy / t.w2_uJy
    A = []
    cj = d / "candidates.json"
    if cj.exists():
        A += [dict(id=f"{o['tile']}-{o['obj']}", ra=o["ra"], dec=o["dec"], pmra=o["pmra"], pmdec=o["pmdec"]) for o in json.loads(cj.read_text())["items"]]
    pri = t[(L(2) & (t.w2_uJy > 1.5 * t.w1_uJy)) | (L(8) & (late > 1.25)) | (L(4) & ((late < 0.8) | (t.w2_var_chi2 > 50))) | (L(1) & (t.pm >= 0.5))]
    A += rows(pri)
    seen = {o["id"] for o in A}
    mv = t[L(1) & (t.pm < 0.5) & ~t.id.isin(seen)].copy()
    mv["b"] = np.maximum(mv.w1_uJy.fillna(0), mv.w2_uJy.fillna(0)); mv = mv.sort_values("b", ascending=False)
    B = rows(mv)
    samp = []
    for b, n in ((8, 4000), (4, 4000), (2, 4000), (16, 6000)):
        s = t[L(b) & ~t.id.isin(seen)]
        samp.append(s.iloc[rng.choice(len(s), min(n, len(s)), replace=False)])
    C = rows(pd.concat(samp).drop_duplicates("id"))
    for name, lst in (("A", A), ("B", B), ("C", C)):
        uniq = {}
        for o in lst: uniq.setdefault(o["id"], o)
        (d / "in" / f"{name}.jsonl").write_text("\n".join(json.dumps(o) for o in uniq.values()) + "\n")
        print(name, len(uniq))


if __name__ == "__main__":
    main()
