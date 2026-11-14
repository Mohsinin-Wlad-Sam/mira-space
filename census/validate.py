#!/usr/bin/env python3
"""Acceptance tests on finished census tiles (see docs/HPC_RUNBOOK.md §3).

usage: python -m census.validate --out ~/skylens/census_out
"""
from __future__ import annotations

import argparse, glob, json, math, os, pathlib

import numpy as np
import pyarrow.parquet as pq

TREF_YR = 2016.4  # census reference epoch (MJD 57500)
# name: (tile, ra_J2000, dec_J2000 [epoch 2000.0], pmra*, pmdec [mas/yr]) from SIMBAD
KNOWN = {
    "WISE0855": (10226, 133.81890825, -7.247048, -8123.7, 673.2),
    "Barnard": (7945, 269.45207511, 4.69339088, -801.55, 10362.54),
    "EpsIndiB": (11391, 331.04414659, -56.78284420, 3981.98, -2466.83),
}


def at_epoch(ra, dec, pmra, pmdec, yr):
    dt = yr - 2000.0
    return ra + pmra / 3.6e6 * dt / math.cos(math.radians(dec)), dec + pmdec / 3.6e6 * dt


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default="~/skylens/census_out"); a = ap.parse_args()
    out = pathlib.Path(os.path.expanduser(a.out))
    report, ok_all = {}, True
    for name, (tile, ra, dec, pa_, pd_) in KNOWN.items():
        p = out / f"tile_{tile}.parquet"
        if not p.exists():
            report[name] = "tile not processed"; ok_all = False; continue
        t = pq.read_table(p).to_pandas()
        r0, d0 = at_epoch(ra, dec, pa_, pd_, TREF_YR)
        dist = np.hypot((t.ra - r0) * math.cos(math.radians(d0)), t.dec - d0) * 3600
        i = int(np.argmin(dist)); o = t.iloc[i]
        dpm = math.hypot(o.pmra - pa_ / 1000, o.pmdec - pd_ / 1000)
        m = t[(t.methane_sigma > 5) & (t.sx_W_uJy / t.sx_w2_err > 10) & ~t.sx_overflow & ~t.sx_saturated & t.isolated]
        rank_y = int((m.methane_ratio < o.methane_ratio).sum()) + 1 if (np.isfinite(o.methane_ratio) and o.methane_sigma > 5) else None
        m2 = t[(t.sx_w2_snr > 5) & np.isfinite(t.idx_methane)]
        rank_j = int((m2.idx_methane > o.idx_methane).sum()) + 1 if np.isfinite(o.idx_methane) else None
        passed = (dist[i] < 5) and bool(o.reliable_motion) and (dpm < 0.3 if name == "WISE0855" else dpm < 0.5)
        ok_all &= passed
        report[name] = dict(match_arcsec=round(float(dist[i]), 2), pm=[round(float(o.pmra), 3), round(float(o.pmdec), 3)],
                            pm_lit=[pa_ / 1000, pd_ / 1000], dpm=round(dpm, 3), reliable=bool(o.reliable_motion),
                            sx_w2_snr=round(float(o.sx_w2_snr), 1), decade_ratio=round(float(o.decade_ratio_w2), 2),
                            methane_sigma=round(float(o.methane_sigma), 1), methane_ratio=round(float(o.methane_ratio), 3), methane_ratio_rank=rank_y, methane_rank=rank_j, n_ranked=len(m), PASS=bool(passed))
    # global false-flag rate and calibration
    qas = [json.load(open(f)) for f in glob.glob(str(out / "tile_*.qa.json"))]
    tot_flag, tot_bright = 0, 0
    for f in glob.glob(str(out / "tile_*.parquet")):
        t = pq.read_table(f, columns=["flag_vanished", "flag_brightened", "w2_late_uJy", "w2_late_err"]).to_pandas()
        s = t.w2_late_uJy / t.w2_late_err > 20
        tot_bright += int(s.sum()); tot_flag += int((t.flag_vanished | t.flag_brightened).sum())
    report["false_flag_rate"] = tot_flag / max(tot_bright, 1)
    report["cal_scatter_median"] = float(np.nanmedian([q.get("cal_scatter", np.nan) for q in qas])) if qas else None
    report["median_tile_s"] = float(np.median([q["total_s"] for q in qas])) if qas else None
    report["tiles"] = len(qas)
    report["ALL_MOVERS_PASS"] = bool(ok_all)
    print(json.dumps(report, indent=1, default=float))


if __name__ == "__main__":
    main()
