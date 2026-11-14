#!/usr/bin/env python3
"""Export finished census tiles into small JSON feeds for the web app (web/public/data/).

usage: python -m census.export_web --census ~/skylens/census_out --out ~/skylens/web_data
Feeds: summary.json, coverage.json, movers.json, methane.json, vanished.json, brightened.json, targets.json
Chunked sky for the web map (see write_sky): sky/meta.json, sky/<lens>/top.json, sky/<lens>/<band>_<cell>.json, obj/<tile//4>.json
"""
from __future__ import annotations

import argparse, glob, json, math, os, pathlib, time

import numpy as np
import pyarrow.parquet as pq

COLS = ["tile", "obj", "ra", "dec", "ra_sx", "dec_sx", "pmra", "pmdec", "epm", "n_ep", "reliable_motion", "fast_link",
        "w1_uJy", "w2_uJy", "w1_late_uJy", "w2_late_uJy", "w2_var_chi2", "fitted", "sx_w1_uJy", "sx_w2_uJy", "sx_w2_err",
        "sx_w2_snr", "decade_ratio_w2", "decade_z_w2", "flag_vanished", "flag_brightened", "isolated", "sx_saturated",
        "sx_overflow", "methane_sigma", "methane_ratio", "idx_water", "idx_ice", "idx_hotdust", "paschen_sigma",
        "sx_J_uJy", "sx_K_uJy", "sx_CH4_uJy", "sx_W_uJy", "blend_n"]
TARGETS = {  # SIMBAD J2000 (epoch 2000.0) + proper motion (mas/yr)
    "Barnard's Star": (269.45207511, 4.69339088, -801.55, 10362.54),
    "Epsilon Indi B": (331.04414659, -56.78284420, 3981.98, -2466.83),
    "WISE 0855-0714": (133.81890825, -7.247048, -8123.7, 673.2),
    "RW Aurigae": (76.95642, 30.40108, 4.0, -24.0),
    "R Draconis": (248.16917, 66.75236, -9.0, 12.0),
}


def rec(row, spec=None):
    d = {}
    for k, v in row.items():
        if isinstance(v, (np.floating, float)):
            d[k] = None if not np.isfinite(v) else round(float(v), 6 if k in ("ra", "dec", "ra_sx", "dec_sx") else 4)
        elif isinstance(v, (np.bool_, bool)):
            d[k] = bool(v)
        elif isinstance(v, (np.integer, int)):
            d[k] = int(v)
    d["pm"] = None if d.get("pmra") is None else round(math.hypot(d["pmra"], d["pmdec"]), 4)
    if spec is not None:
        d["spec"] = spec
    return d


def spec_of(t, i):
    s, e = t["spec_f16_mJy"].iloc[i], t["spec_err_f16_mJy"].iloc[i]
    if s is None:
        return None
    f = np.frombuffer(s, np.float16).astype(float); er = np.frombuffer(e, np.float16).astype(float)
    return [[None if not np.isfinite(a) else round(a, 4), None if not np.isfinite(b) else round(b, 4)] for a, b in zip(f, er)]


# ---------------------------------------------------------------------------- chunked sky (zoom-dependent loading)
# The browser loads a light all-sky "top" list per lens at start, then, when zoomed in (FoV < ~40 deg), only the
# 10-degree cells that intersect the view. Dossier details (scalars + spectrum) live in obj/<HEALPix order-4 = tile//4>.json,
# fetched only when an object is opened. Rows are compact arrays: [id, ra_sx, dec_sx, pmra, pmdec, score, w2_uJy].
CELL_DEG, CELL_TOP, SKY_TOP = 10.0, 150, 1500
LIGHT = ["id", "ra", "dec", "pmra", "pmdec", "score", "w2", "w2_late", "sx_ratio"]   # w2_late / sx_ratio: measured brightness history
DETAIL = ["tile", "obj", "ra", "dec", "ra_sx", "dec_sx", "pmra", "pmdec", "epm", "n_ep", "reliable_motion", "w1_uJy", "w2_uJy",
          "w2_late_uJy", "sx_w1_uJy", "sx_w2_uJy", "sx_w2_err", "sx_w2_snr", "decade_ratio_w2", "decade_z_w2", "flag_vanished",
          "flag_brightened", "isolated", "sx_saturated", "methane_sigma", "methane_ratio", "idx_water", "idx_ice", "idx_hotdust",
          "paschen_sigma", "w2_var_chi2", "sx_J_uJy", "sx_K_uJy", "blend_n", "ai_dist", "ai_sig", "ai_teff", "ai_cls", "ai_p"]
LENS_SORT = {"movers": ("pmtot", False), "methane": ("methane_ratio", True), "vanished": ("decade_z_w2", True), "brightened": ("decade_z_w2", False)}


AI_OUT = pathlib.Path.home() / "skylens" / "ai_out"


def merge_ai(t, tile):
    """AI physical parameters (census/ai_phys.py): distance, temperature, kind, when predicted for this tile."""
    import pandas as pd
    p = AI_OUT / f"tile_{tile}.parquet"
    cols = ["ai_dist", "ai_sig", "ai_teff", "ai_cls", "ai_p"]
    if not p.exists() or not len(t):
        for c in cols: t[c] = np.nan
        return t
    a = pq.read_table(p).to_pandas()
    P = a[["p0", "p1", "p2", "p3"]].to_numpy(np.float32)
    a = pd.DataFrame(dict(obj=a.obj, ai_dist=a.dist_pc, ai_sig=a.sM_w2 * math.log(10) / 5, ai_teff=a.teff, ai_cls=P.argmax(1).astype(float), ai_p=P.max(1)))
    return t.merge(a, on="obj", how="left")


def sky_cell(ra, dec):
    """Equal-area-ish grid: 18 declination bands, round(36 cos(dec_c)) RA cells per band. Mirrored in web/src/sky.ts."""
    j = np.clip(np.floor((np.asarray(dec) + 90) / CELL_DEG).astype(int), 0, int(180 / CELL_DEG) - 1)
    n = np.maximum(1, np.round(36 * np.cos(np.radians(-90 + (j + 0.5) * CELL_DEG)))).astype(int)
    i = np.floor((np.asarray(ra) % 360) / 360 * n).astype(int) % n
    return j, i


def _r(v, d):
    return None if v is None or not np.isfinite(v) else round(float(v), d)


def write_sky(allc, out):
    import shutil
    for sub in ("sky", "obj"):
        tmp = out / (sub + ".tmp")
        shutil.rmtree(tmp, ignore_errors=True); tmp.mkdir(parents=True)
    sky, objd = out / "sky.tmp", out / "obj.tmp"
    allc = allc.copy(); allc["pmtot"] = np.hypot(allc.pmra, allc.pmdec)
    allc["id"] = allc.tile.astype(str) + "-" + allc.obj.astype(str)
    allc["band"], allc["cell"] = sky_cell(allc.ra_sx.values, allc.dec_sx.values)
    lens_rows = {
        "movers": allc[allc.reliable_motion & (allc.pmtot > 0.3) & allc.is_mover],
        "methane": allc[allc.is_methane], "vanished": allc[allc.flag_vanished], "brightened": allc[allc.flag_brightened]}
    keep_ids, meta = set(), dict(cell_deg=CELL_DEG, cell_top=CELL_TOP, cols=LIGHT, lenses={})
    for lens, df in lens_rows.items():
        k, asc = LENS_SORT[lens]
        df = df.sort_values(k, ascending=asc)
        # motion only where it is reliable (otherwise the dot stays put); positions are at the SPHEREx epoch (MJD 60980)
        light = lambda d: [[r.id, _r(r.ra_sx, 6), _r(r.dec_sx, 6), _r(r.pmra, 4) if r.reliable_motion else None,
                            _r(r.pmdec, 4) if r.reliable_motion else None, _r(getattr(r, k), 3), _r(r.w2_uJy, 1),
                            _r(r.w2_late_uJy, 1), _r(r.decade_ratio_w2, 3) if (r.isolated and not r.sx_saturated) else None]
                           for r in d.itertuples(index=False)]
        (sky / lens).mkdir()
        top = df.head(SKY_TOP); keep_ids.update(top.id)
        (sky / lens / "top.json").write_text(json.dumps(dict(n=len(top), total=int(len(df)), rows=light(top)), separators=(",", ":")))
        cells = {}
        for (b, c), g in df.groupby(["band", "cell"], sort=False):
            g2 = g.head(CELL_TOP); keep_ids.update(g2.id)
            (sky / lens / f"{b}_{c}.json").write_text(json.dumps(dict(n=len(g2), total=int(len(g)), rows=light(g2)), separators=(",", ":")))
            cells[f"{b}_{c}"] = int(len(g))
        meta["lenses"][lens] = dict(total=int(len(df)), top=len(top), cells=cells)
    # details for every object that can appear on the map, grouped by HEALPix order-4 (tile // 4): <= 3072 files of ~60 kB
    det = allc[allc.id.isin(keep_ids)].drop_duplicates("id")
    import base64
    groups = {}
    for row in det[DETAIL + ["id", "spec_f16_mJy", "spec_err_f16_mJy"]].to_dict("records"):
        d = {}
        for c in DETAIL:
            v = row[c]
            if isinstance(v, (bool, np.bool_)): d[c] = bool(v)
            elif isinstance(v, (int, np.integer)): d[c] = int(v)
            elif isinstance(v, (float, np.floating)): d[c] = None if not np.isfinite(v) else round(float(v), 6 if c in ("ra", "dec", "ra_sx", "dec_sx") else 4)
            else: d[c] = None
        snr = row["sx_w2_snr"]
        if snr is not None and np.isfinite(snr) and snr > 5 and row["spec_f16_mJy"] is not None:   # base64 float16 mJy "flux|error"
            d["spec_b64"] = base64.b64encode(row["spec_f16_mJy"]).decode() + "|" + base64.b64encode(row["spec_err_f16_mJy"]).decode()
        groups.setdefault(int(row["tile"]) // 4, {})[row["id"]] = d
    for g, items in groups.items():
        (objd / f"{g}.json").write_text(json.dumps(items, separators=(",", ":")))
    meta["n_detail"] = len(det); meta["detail_files"] = len(groups)
    (sky / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
    for sub in ("sky", "obj"):   # swap atomically-ish so a concurrent rsync never sees a half-written tree
        old = out / (sub + ".old"); shutil.rmtree(old, ignore_errors=True)
        if (out / sub).exists(): os.replace(out / sub, old)
        os.replace(out / (sub + ".tmp"), out / sub); shutil.rmtree(old, ignore_errors=True)
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--census", default="~/skylens/census_out"); ap.add_argument("--out", default="~/skylens/web_data")
    ap.add_argument("--top", type=int, default=1500)
    a = ap.parse_args()
    src = pathlib.Path(os.path.expanduser(a.census)); out = pathlib.Path(os.path.expanduser(a.out)); out.mkdir(parents=True, exist_ok=True)
    files = sorted(glob.glob(str(src / "tile_*.parquet")))
    parts, lam, tiles, totals = [], None, [], dict(n_obj=0, n_rows=0, n_spec=0, n_reliable_motion=0, n_det=0)
    bad_tiles = []
    for f in files:
        tile = int(pathlib.Path(f).stem.split("_")[1]); tiles.append(tile)
        qf = src / f"tile_{tile}.qa.json"
        q = json.loads(qf.read_text()) if qf.exists() else {}
        lam = lam or q.get("lam_um")
        for k in totals: totals[k] += int(q.get(k, 0) or 0)
        # tile quality gate for SPHEREx-based feeds (motions from WISE are kept regardless)
        cs, es = q.get("cal_scatter"), q.get("err_scale", 1.0)
        tile_ok = cs is not None and np.isfinite(cs) and cs <= 0.20 and (es or 1.0) <= 5.0
        if not tile_ok: bad_tiles.append(tile)
        t = pq.read_table(f, columns=COLS + ["spec_f16_mJy", "spec_err_f16_mJy"]).to_pandas()
        sx_ok = tile_ok & (t.sx_w2_snr > 10)
        methane = sx_ok & (t.methane_sigma > 5) & (t.sx_W_uJy / t.sx_w2_err > 10) & t.isolated & ~t.sx_saturated & \
            ~t.sx_overflow & (t.methane_ratio < 0.5) & (t.methane_ratio > -0.05) & (t.decade_ratio_w2 > 0.5) & (t.decade_ratio_w2 < 2.0)
        # bright-star halos produce spurious WISE-era "movers": drop movers near much brighter sources (not the star itself)
        from scipy.spatial import cKDTree
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
        pm_tot = np.hypot(t.pmra, t.pmdec)
        # fast movers must be independently confirmed: SPHEREx detects them in 2025 where the WISE motion predicts
        sx_confirmed = (t.sx_w2_snr > 5) & t.fitted
        movers = t.reliable_motion & (pm_tot > 0.3) & ~in_halo & ((pm_tot < 1.0) | sx_confirmed)
        sel = movers | (tile_ok & (t.flag_vanished | t.flag_brightened) & ~in_halo) | methane
        t = t[sel].copy(); t["is_methane"] = methane[sel].values; t["is_mover"] = movers[sel].values
        t = merge_ai(t, tile)
        parts.append(t)
    import pandas as pd
    allc = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=COLS)
    def feed(df, key, asc, name):
        total = int(len(df))
        df = df.sort_values(key, ascending=asc).head(a.top).reset_index(drop=True)
        items = [rec({k: df[k].iloc[i] for k in COLS}, spec_of(df, i)) for i in range(len(df))]
        (out / f"{name}.json").write_text(json.dumps(dict(name=name, n=len(items), total=total, items=items), separators=(",", ":")))
        return len(items)
    n = {}
    if len(allc):
        mv = allc[allc.reliable_motion & (np.hypot(allc.pmra, allc.pmdec) > 0.3) & allc.is_mover].copy(); mv["pmtot"] = np.hypot(mv.pmra, mv.pmdec)
        n["movers"] = feed(mv, "pmtot", False, "movers")
        me = allc[allc.is_methane]
        n["methane"] = feed(me, "methane_ratio", True, "methane")
        n["vanished"] = feed(allc[allc.flag_vanished], "decade_z_w2", True, "vanished")
        n["brightened"] = feed(allc[allc.flag_brightened], "decade_z_w2", False, "brightened")
    # challenge targets: nearest census object to the PM-propagated position (epoch 2016.4)
    tg = []
    for name, (ra, dec, pmra, pmdec) in TARGETS.items():
        r0 = ra + pmra / 3.6e6 * 16.4 / math.cos(math.radians(dec)); d0 = dec + pmdec / 3.6e6 * 16.4
        best = None
        for f in files:
            t = pq.read_table(f, columns=["ra", "dec"]).to_pandas()
            if not len(t) or abs(np.median(t.dec) - d0) > 3: continue
            dist = np.hypot((t.ra - r0) * math.cos(math.radians(d0)), t.dec - d0) * 3600
            i = int(np.argmin(dist))
            if dist.iloc[i] < 6 and (best is None or dist.iloc[i] < best[0]):
                best = (float(dist.iloc[i]), f, i)
        entry = dict(name=name, ra=ra, dec=dec, pmra=pmra, pmdec=pmdec, processed=best is not None)
        if best:
            t = pq.read_table(best[1], columns=COLS + ["spec_f16_mJy", "spec_err_f16_mJy"]).to_pandas()
            entry["census"] = rec({k: t[k].iloc[best[2]] for k in COLS}, spec_of(t, best[2])); entry["match_arcsec"] = round(best[0], 2)
        tg.append(entry)
    (out / "targets.json").write_text(json.dumps(tg, separators=(",", ":")))
    if len(allc):
        m = write_sky(allc, out)
        print("sky:", {k: (v["total"], len(v["cells"])) for k, v in m["lenses"].items()}, "detail", m["n_detail"], "in", m["detail_files"], "files")
    # coverage: HEALPix order-5 tile corners
    cov = []
    try:
        from astropy_healpix import HEALPix
        hp = HEALPix(nside=32, order="nested")
    except ImportError:
        tiles_cov = []
    else:
        tiles_cov = tiles
    if tiles_cov:
        lon, lat = hp.boundaries_lonlat(np.array(tiles), step=1)
        for k, tl in enumerate(tiles):
            cov.append([tl] + [round(float(x), 3) for pair in zip(lon[k].to_value("deg"), lat[k].to_value("deg")) for x in pair])
    (out / "coverage.json").write_text(json.dumps(cov, separators=(",", ":")))
    summary = dict(updated=time.strftime("%Y-%m-%dT%H:%M:%S%z"), tiles_done=len(tiles), tiles_total=12288,
                   sky_fraction=round(len(tiles) / 12288, 4), lam_um=lam, feeds=n,
                   tiles_quality_excluded=len(bad_tiles), **totals)
    (out / "summary.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps({k: v for k, v in summary.items() if k != "lam_um"}))


if __name__ == "__main__":
    main()
