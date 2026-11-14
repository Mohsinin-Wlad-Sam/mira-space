#!/usr/bin/env python3
"""Planet-X-style candidates: possibly NEW cold, nearby worlds in the census.

Selection (every census object with an AI reading, census/ai_phys.py):
  * AI class brown dwarf with p > 0.6, AI distance < 50 pc with sigma_ln d < 0.45
  * clean SPHEREx photometry: S/N(4–5 µm) > 10, isolated, not saturated
  * cool colour W1 − W2 > 0.6 mag, and evidence it is nearby AND cold: significant 16-year motion (> 5σ, ≥ 8 epochs)
    or a methane dip (methane_sigma > 5, ratio < 0.6)
  * consistent: SPHEREx and WISE brightness agree within ×2 (rejects blends / mismatches)
  * physically plausible: sideways speed 4.74 μ d < 150 km/s (Galactic-disc kinematics; rejects mis-linked WISE tracks)
Then: drop everything in the UltracoolSheet (Best et al., ~3,900 known ultracool dwarfs, 10″ after epoch propagation),
and cross-match the survivors with Gaia DR3 (IRSA TAP): a Gaia parallax independently tests our AI distance.
out: <web>/candidates.json  ranked list with evidence fields (+ detail records for the dossier)
usage: python -m census.candidates --workers 48
"""
from __future__ import annotations

import argparse, glob, json, math, os, pathlib, sys, time
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pyarrow.parquet as pq

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from census.export_web import COLS, rec, spec_of  # noqa: E402
from census.ai_phys import gaia_chunk, load_ucs, unit, vmag, H  # noqa: E402


def _tile(args):
    f, aiout = args
    import pandas as pd
    tile = int(pathlib.Path(f).stem.split("_")[1]); pa = pathlib.Path(aiout) / f"tile_{tile}.parquet"
    if not pa.exists(): return None
    a = pq.read_table(pa).to_pandas()
    a = a[(a.p2 > 0.6) & (a.dist_pc < 50) & (a.sM_w2 * math.log(10) / 5 < 0.45)]
    if not len(a): return None
    t = pq.read_table(f, columns=COLS + ["spec_f16_mJy", "spec_err_f16_mJy"]).to_pandas()
    t = t.merge(a[["obj", "dist_pc", "sM_w2", "teff", "p2"]], on="obj")
    if not len(t): return None
    c12 = vmag(t.w1_uJy.to_numpy(), 1) - vmag(t.w2_uJy.to_numpy(), 2)
    pm = np.hypot(t.pmra, t.pmdec)
    moving = (pm > 5 * t.epm) & (t.n_ep >= 8) & (pm > 0.05)
    methane = (t.methane_sigma > 5) & (t.methane_ratio < 0.6) & (t.methane_ratio > -0.05)
    vt = 4.74047 * np.where(moving, pm, 0) * t.dist_pc                       # km/s sideways at the AI distance
    ok = (t.sx_w2_snr > 10) & t.isolated & ~t.sx_saturated & (c12 > 0.6) & (moving | methane) & (vt < 150) & (t.decade_ratio_w2 > 0.5) & (t.decade_ratio_w2 < 2.0)   # disc-like speeds: rejects mislinked "movers"
    t = t[ok].copy()
    if not len(t): return None
    t["c12"] = c12[ok.to_numpy()]; t["moving"] = moving[ok].to_numpy(); t["methane"] = methane[ok].to_numpy()
    out = []
    for i in range(len(t)):
        r = rec({k: t[k].iloc[i] for k in COLS}, spec_of(t, i))
        r.update(ai_dist=round(float(t.dist_pc.iloc[i]), 2), ai_sig=round(float(t.sM_w2.iloc[i] * math.log(10) / 5), 3), ai_teff=round(float(t.teff.iloc[i])),
                 ai_cls=2, ai_p=round(float(t.p2.iloc[i]), 3), c12=round(float(t.c12.iloc[i]), 2), moving=bool(t.moving.iloc[i]), has_methane=bool(t.methane.iloc[i]))
        out.append(r)
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--census", default=str(H / "census_out")); ap.add_argument("--aiout", default=str(H / "ai_out"))
    ap.add_argument("--web", default=str(H / "web_data")); ap.add_argument("--workers", type=int, default=48); ap.add_argument("--top", type=int, default=400)
    a = ap.parse_args(); t0 = time.time()
    files = sorted(glob.glob(os.path.join(a.census, "tile_*.parquet")))
    C = []
    with ProcessPoolExecutor(a.workers) as ex:
        for i, r in enumerate(ex.map(_tile, [(f, a.aiout) for f in files], chunksize=16)):
            if r: C += r
            if i % 2000 == 0: print(f"{i}/{len(files)} tiles, {len(C)} candidates, {time.time()-t0:.0f}s", flush=True)
    print(f"pre-selection: {len(C)}", flush=True)
    # ---- known? UltracoolSheet within 10" (positions propagated to the census reference epoch 2016.4)
    from scipy.spatial import cKDTree
    U = load_ucs(str(H / "ext" / "ucs_main.csv"), str(H / "ext" / "ucs_fund.csv"))
    tree = cKDTree(unit(U.ra16.to_numpy(), U.dec16.to_numpy()))
    ra = np.array([c["ra"] for c in C]); dec = np.array([c["dec"] for c in C])
    d, j = tree.query(unit(ra, dec), distance_upper_bound=math.radians(10 / 3600))
    for c, dd, jj in zip(C, d, j):
        c["known_ucs"] = U.name.iloc[jj] if np.isfinite(dd) else None
    new = [c for c in C if not c["known_ucs"]]
    print(f"in UltracoolSheet: {len(C) - len(new)} (sanity check: the selection recovers known brown dwarfs); new: {len(new)}", flush=True)
    # ---- rank: AI confidence, closeness, methane depth, motion significance
    for c in new:
        pm = math.hypot(c["pmra"] or 0, c["pmdec"] or 0); sig = pm / max(c["epm"] or 1e-3, 1e-3)
        c["score"] = round(c["ai_p"] * (1 + min(3, (c["methane_sigma"] or 0) / 10)) * (1 + min(3, sig / 10)) / max(c["ai_dist"], 3) * 50, 3)
    new.sort(key=lambda c: -c["score"]); new = new[:a.top]
    # ---- independent test with Gaia DR3 (parallax where Gaia sees it)
    if new:
        ids = np.arange(len(new)); r0 = np.array([c["ra"] for c in new]); d0 = np.array([c["dec"] for c in new])
        g = gaia_chunk(ids, r0, d0, radius_arcsec=3.0)
        if g is not None:
            g = g.sort_values("phot_g_mean_mag").drop_duplicates("srcid")
            for _, row in g.iterrows():
                c = new[int(row.srcid)]
                if np.isfinite(row.parallax) and row.parallax_error and row.parallax / row.parallax_error > 3:
                    c["gaia_dist"] = round(1000 / row.parallax, 2); c["gaia_id"] = str(int(row.source_id))
    known = [c for c in C if c["known_ucs"]]
    agree = [abs(math.log(c["ai_dist"] / c["gaia_dist"])) < 0.5 for c in new if c.get("gaia_dist")]
    meta = dict(built=time.strftime("%Y-%m-%d %H:%M"), preselected=len(C), recovered_known=len(known), new=len(new),
                gaia_matched=sum(1 for c in new if c.get("gaia_dist")), gaia_agree=int(sum(agree)),
                known_examples=[c["known_ucs"] for c in known[:12]], criteria=__doc__.split("Selection")[1].split("usage")[0].strip())
    (pathlib.Path(a.web) / "candidates.json").write_text(json.dumps(dict(meta=meta, items=new), separators=(",", ":")))
    print(json.dumps(meta, indent=1)[:2000])


if __name__ == "__main__":
    main()
