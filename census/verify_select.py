"""Gather every census object that claims a change (motion, 15-year brightness change, methane dip) into one table,
ready to be re-measured on the raw SPHEREx exposures by web/scripts/verify_census.mts.

usage: python -m census.verify_select --census ~/skylens/census_out --out ~/skylens/verify [--workers 64]
writes: <out>/cands.parquet  (one row per object, lens bits: 1 mover, 2 methane, 4 vanished, 8 brightened)
"""
import argparse, glob, json, os, pathlib
from multiprocessing import Pool

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from scipy.spatial import cKDTree

COLS = ["tile", "obj", "ra", "dec", "pmra", "pmdec", "epm", "n_ep", "chi2_motion", "reliable_motion", "fast_link", "w1_uJy", "w2_uJy",
        "w1_var_chi2", "w2_var_chi2", "w1_late_uJy", "w2_late_uJy", "w2_late_err", "fitted", "sx_w1_uJy", "sx_w2_uJy", "sx_w2_err", "sx_w2_snr",
        "blend_n", "nbr_ratio", "decade_ratio_w2", "decade_z_w2", "flag_vanished", "flag_brightened", "isolated", "sx_saturated", "sx_overflow",
        "methane_sigma", "methane_ratio", "sx_J_uJy", "sx_K_uJy", "sx_W_uJy", "edge_dist_px"]


def one(f):
    tile = int(pathlib.Path(f).stem.split("_")[1])
    qf = pathlib.Path(f).with_suffix("").with_suffix(".qa.json") if False else pathlib.Path(str(f).replace(".parquet", ".qa.json"))
    q = json.loads(qf.read_text()) if qf.exists() else {}
    cs, es = q.get("cal_scatter"), q.get("err_scale", 1.0)
    tile_ok = cs is not None and np.isfinite(cs) and cs <= 0.20 and (es or 1.0) <= 5.0
    try:
        t = pq.read_table(f, columns=COLS).to_pandas()
    except Exception as e:  # noqa: BLE001
        return None, (tile, str(e))
    if not len(t):
        return None, None
    sx_ok = tile_ok & (t.sx_w2_snr > 10)
    methane = sx_ok & (t.methane_sigma > 5) & (t.sx_W_uJy / t.sx_w2_err > 10) & t.isolated & ~t.sx_saturated & ~t.sx_overflow & \
        (t.methane_ratio < 0.5) & (t.methane_ratio > -0.05) & (t.decade_ratio_w2 > 0.5) & (t.decade_ratio_w2 < 2.0)
    bright = t[(t.w2_uJy > 1e5)]
    in_halo = np.zeros(len(t), bool)
    if len(bright):
        cosd = np.cos(np.radians(np.nanmedian(t.dec)))
        tree = cKDTree(np.c_[bright.ra.values * cosd, bright.dec.values] * 3600)
        for r_as, fmin in ((45.0, 1e5), (150.0, 1e6)):
            d, j = tree.query(np.c_[t.ra.values * cosd, t.dec.values] * 3600, distance_upper_bound=r_as)
            ok = np.isfinite(d)
            fb = np.where(ok, bright.w2_uJy.values[np.minimum(j, len(bright) - 1)], 0)
            in_halo |= ok & (d > 1.0) & (fb > fmin) & (fb > 20 * np.nan_to_num(t.w2_uJy.values, nan=0.0))
    pm = np.hypot(t.pmra, t.pmdec)
    sx_confirmed = (t.sx_w2_snr > 5) & t.fitted
    movers = t.reliable_motion & (pm > 0.3) & ~in_halo & ((pm < 1.0) | sx_confirmed)
    # slower but significant motions too: the raw-exposure check will decide (kept apart with bit 16)
    slow = t.reliable_motion & (pm > 0.15) & (pm <= 0.3) & (pm > 8 * t.epm) & ~in_halo & (t.n_ep >= 10)
    van = tile_ok & t.flag_vanished & ~in_halo
    bri = tile_ok & t.flag_brightened & ~in_halo
    lens = movers.astype(int) * 1 + methane.astype(int) * 2 + van.astype(int) * 4 + bri.astype(int) * 8 + slow.astype(int) * 16
    sel = lens > 0
    t = t[sel].copy(); t["lens"] = lens[sel].values.astype(np.int16); t["in_halo"] = in_halo[sel]; t["tile_ok"] = bool(tile_ok)
    return t, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--census", default="~/skylens/census_out"); ap.add_argument("--out", default="~/skylens/verify"); ap.add_argument("--workers", type=int, default=64)
    a = ap.parse_args()
    src = pathlib.Path(os.path.expanduser(a.census)); out = pathlib.Path(os.path.expanduser(a.out)); out.mkdir(parents=True, exist_ok=True)
    files = sorted(glob.glob(str(src / "tile_*.parquet")))
    parts, bad = [], []
    with Pool(a.workers) as p:
        for k, (t, err) in enumerate(p.imap_unordered(one, files, chunksize=8)):
            if t is not None: parts.append(t)
            if err: bad.append(err)
            if k % 1000 == 0: print(k, "/", len(files), sum(len(x) for x in parts), flush=True)
    allc = pd.concat(parts, ignore_index=True)
    allc["pm"] = np.hypot(allc.pmra, allc.pmdec)
    allc.to_parquet(out / "cands.parquet", index=False)
    print("rows", len(allc), {n: int(((allc.lens & b) > 0).sum()) for n, b in (("movers", 1), ("methane", 2), ("vanished", 4), ("brightened", 8), ("slow", 16))}, "unreadable", len(bad))


if __name__ == "__main__":
    main()
