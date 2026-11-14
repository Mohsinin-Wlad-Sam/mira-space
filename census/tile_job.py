#!/usr/bin/env python3
"""One census tile = one HEALPix order-5 pixel. Streams inputs into RAM, writes <out>/tile_<N>.parquet + .qa.json.

usage: python -m census.tile_job TILE [--out DIR] [--cache-unwise NPZ] [--no-nhits]
"""
from __future__ import annotations

import argparse, json, os, pathlib, sys, time, warnings

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from astropy.coordinates import SkyCoord
import astropy.units as u

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from census.io_sources import read_unwise_tile, read_cube_tile  # noqa: E402
from census.link import link, inv_gnomonic, YR  # noqa: E402
from census.sphx_phot import forced_photometry, window, background, blend_groups  # noqa: E402

warnings.filterwarnings("ignore")
TREF = 57500.0          # WISE-era reference epoch for positions (2016.4)
T_SPHX = 60980.0        # mid-epoch of SPHEREx DR1 (Year 1)
NMGY_UJY = {1: 0.30954, 2: 0.171787}   # Vega nanomaggie -> uJy (W1/W2 zero points 309.54 / 171.787 Jy)
VERSION = "census-0.6"
FIT_MIN_UJY = float(os.environ.get("CENSUS_FIT_MIN_UJY", 150))  # fit only objects above SPHEREx cube depth (TractorJAX lesson)
SAT_W2_UJY = 1.0e6  # W2 brighter than ~1 Jy: SPHEREx photometry unreliable (saturation/nonlinearity)
WIN = dict(J=(1.20, 1.32), H=(1.55, 1.75), K=(2.10, 2.30), CH4=(3.20, 3.45), W=(3.85, 4.20), CO=(4.45, 4.80), H2O=(2.62, 2.80),
           ICE=(2.95, 3.15), C24=(2.40, 2.55), C36=(3.55, 3.75), PAa=(1.865, 1.885), PAc1=(1.80, 1.84), PAc2=(1.91, 1.95),
           SW1=(2.80, 3.80), SW2=(4.00, 5.00))


def lens_indices(Wf, We):
    """S/N-aware indices; denominators floored at 2 sigma (index is then a lower limit)."""
    def floor(k): return np.maximum(Wf[k], 2 * We[k])
    def snr(k): return Wf[k] / We[k]
    with np.errstate(all="ignore"):
        my = np.where(snr("W") > 5, np.log10(Wf["W"] / floor("CH4")), np.nan)
        mj = np.where((snr("J") > 5) & (snr("W") > 5), 0.5 * np.log10(Wf["J"] / floor("CH4")) + 0.5 * my, np.nan)
        # ranking statistic: significance that F(3.3um) < 0.5 F(4um window); a Rayleigh-Jeans star has ~1.5
        s_ch4 = (0.5 * Wf["W"] - Wf["CH4"]) / np.hypot(0.5 * We["W"], We["CH4"])
        q_ch4 = Wf["CH4"] / Wf["W"]                       # methane depth ratio (normal stars ~1.5, T dwarfs < 0.5)
        water = np.where(snr("K") > 10, np.log10(Wf["K"] / floor("H2O")), np.nan)
        ice = np.where((snr("C24") > 10) & (snr("C36") > 10), np.log10(np.sqrt(Wf["C24"] * Wf["C36"]) / floor("ICE")), np.nan)
        hot = np.where((snr("W") > 5) & (snr("K") > 5), np.log10(Wf["W"] / Wf["K"]), np.nan)
        pac = (Wf["PAc1"] + Wf["PAc2"]) / 2; epac = np.hypot(We["PAc1"], We["PAc2"]) / 2
        pas = (Wf["PAa"] - pac) / np.hypot(We["PAa"], epac)
        lim_ch4 = Wf["CH4"] < 2 * We["CH4"]
    return dict(idx_methane=mj, idx_methane_y=my, methane_sigma=s_ch4, methane_ratio=q_ch4, idx_water=water, idx_ice=ice, idx_hotdust=hot,
                paschen_sigma=pas, ch4_upper_limit=lim_ch4)


def run(tile: int, out: pathlib.Path, cache_unwise: str | None = None, with_nhits: bool = True) -> dict:
    T = {}; t0 = time.time()
    if cache_unwise and os.path.exists(cache_unwise):
        det = dict(np.load(cache_unwise)); nb_u = 0
    else:
        det, nb_u = read_unwise_tile(tile)
    T["read_unwise_s"] = time.time() - t0
    ra0, dec0 = float(np.median(det["ra"])), float(np.median(det["dec"]))
    t1 = time.time(); inv, objs = link(det, ra0, dec0, TREF); T["link_s"] = time.time() - t1
    # ---- WISE photometry & variability per object (vectorised over detections) ----
    nobj = len(objs)
    n_ep = np.array([o["n_ep"] for o in objs]); keep = n_ep >= 3
    band = det["band"]; f = det["flux"].astype(float); df = np.maximum(det["dflux"].astype(float), 1e-6)
    late = det["MJDMEAN"] > 58450.0
    st = {}
    for b in (1, 2):
        mb = band == b; w = mb / df ** 2
        sw = np.bincount(inv, w, nobj)
        mean = np.where(sw > 0, np.bincount(inv, w * f, nobj) / np.maximum(sw, 1e-30), np.nan)
        chi = np.bincount(inv, w * (f - mean[inv]) ** 2, nobj); nb = np.bincount(inv, mb, nobj)
        wl = (mb & late) / df ** 2; swl = np.bincount(inv, wl, nobj)
        lmean = np.where(swl > 0, np.bincount(inv, wl * f, nobj) / np.maximum(swl, 1e-30), np.nan)
        st[b] = dict(mean=mean * NMGY_UJY[b], emean=NMGY_UJY[b] / np.sqrt(np.maximum(sw, 1e-30)),
                     chi2=chi / np.maximum(nb - 1, 1), n=nb,
                     late=lmean * NMGY_UJY[b], elate=NMGY_UJY[b] / np.sqrt(np.maximum(swl, 1e-30)))
    # ---- positions at SPHEREx epoch ----
    x0 = np.array([o["x0"] for o in objs]); y0 = np.array([o["y0"] for o in objs])
    pmx = np.array([o["pmx"] for o in objs]); pmy = np.array([o["pmy"] for o in objs])
    epm = np.array([o["epmx"] for o in objs]); rel = np.array([o["reliable_motion"] for o in objs])
    use_pm = rel | ((np.hypot(pmx, pmy) > 5 * epm) & (n_ep >= 8))
    dts = (T_SPHX - TREF) / YR
    xs = x0 + np.where(use_pm, pmx * dts, 0); ys = y0 + np.where(use_pm, pmy * dts, 0)
    ra_ref, dec_ref = inv_gnomonic(x0, y0, ra0, dec0)
    ra_sx, dec_sx = inv_gnomonic(xs, ys, ra0, dec0)
    # ---- SPHEREx cube photometry ----
    t2 = time.time(); cube, nh, lam, wcs, nb_c = read_cube_tile(tile, with_nhits=with_nhits); T["read_cube_s"] = time.time() - t2
    k_idx = np.where(keep)[0]
    px, py = (np.asarray(a) for a in wcs.world_to_pixel(SkyCoord(ra_sx[keep] * u.deg, dec_sx[keep] * u.deg)))
    w2m = np.nan_to_num(st[2]["mean"][keep]); w1m = np.nan_to_num(st[1]["mean"][keep])
    fitted = (w2m >= FIT_MIN_UJY) | (w1m >= FIT_MIN_UJY)
    t3 = time.time()
    flux, err, sig_c, noise_c = forced_photometry(cube, lam, px, py, brightness=np.maximum(w1m, w2m), fit_mask=fitted)
    T["phot_s"] = time.time() - t3
    fitted &= np.isfinite(flux[:, 0]) | np.isfinite(flux[:, -1])
    edge = np.minimum.reduce([px, py, 511 - px, 511 - py])
    sx_saturated = np.maximum(w1m, w2m) > SAT_W2_UJY
    # isolation: brightest fitted neighbour within 2.5 cube px (32"), relative to self (deblending-safe if < 0.3)
    from scipy.spatial import cKDTree as _KD
    bri = np.maximum(w1m, w2m)
    nbr_ratio = np.zeros(len(px))
    fidx0 = np.where(fitted)[0]
    if len(fidx0) > 1:
        pr = _KD(np.c_[px[fidx0], py[fidx0]]).query_pairs(2.5, output_type="ndarray")
        if len(pr):
            a, b = fidx0[pr[:, 0]], fidx0[pr[:, 1]]
            np.maximum.at(nbr_ratio, a, bri[b] / np.maximum(bri[a], 1e-9)); np.maximum.at(nbr_ratio, b, bri[a] / np.maximum(bri[b], 1e-9))
    isolated = nbr_ratio < 0.3
    if nh is not None:
        nhp, flp = nh
        ixc, iyc = np.clip(np.rint(px).astype(int), 0, 511), np.clip(np.rint(py).astype(int), 0, 511)
        nhits_med = np.median(nhp[:, iyc, ixc], axis=0)
        sx_overflow = np.any((flp[:, iyc, ixc] & 2) > 0, axis=0)   # cube FLAGS bit 1 = OVERFLOW
    else:
        nhits_med = np.full(len(px), np.nan); sx_overflow = np.zeros(len(px), bool)
    # ---- blend groups (cube resolution) and group-level decade change ----
    grp = np.full(len(px), -1)
    fidx = np.where(fitted)[0]
    grp[fidx] = blend_groups(px[fidx], py[fidx], 1.0)
    nf_g = grp.max() + 1
    grp[grp < 0] = nf_g + np.arange((grp < 0).sum())   # unfitted objects: singleton groups
    ng = grp.max() + 1
    blend_n = np.bincount(grp, minlength=ng)[grp]
    sw2, esw2 = window(flux, err, lam, *WIN["SW2"])
    sw1, esw1 = window(flux, err, lam, *WIN["SW1"])
    wl2, ewl2 = st[2]["late"][keep], st[2]["elate"][keep]
    wl2z = np.nan_to_num(wl2)
    G_w = np.bincount(grp, wl2z, ng); G_ew = np.sqrt(np.bincount(grp, np.nan_to_num(ewl2) ** 2, ng))
    G_sx = np.bincount(grp, np.where(fitted, np.nan_to_num(sw2), 0), ng)
    G_esx = np.sqrt(np.bincount(grp, np.where(fitted, np.nan_to_num(esw2), 0) ** 2, ng))
    G_dom = np.zeros(ng); np.maximum.at(G_dom, grp, wl2z)
    dom_frac = np.where(G_w > 0, G_dom / np.maximum(G_w, 1e-12), np.nan)
    is_dom = (wl2z == G_dom[grp]) & fitted
    good_cal = (dom_frac[grp] > 0.95) & is_dom & ~sx_overflow & ~sx_saturated & (wl2 / ewl2 > 50) & (sw2 / esw2 > 30) & (st[2]["chi2"][keep] < 3) & (edge > 8)
    CAL_DEFAULT = 1.225  # median of validation tiles 10226/11391 (census-0.2)
    cal2 = float(np.nanmedian(sw2[good_cal] / wl2[good_cal])) if good_cal.sum() > 20 else CAL_DEFAULT
    cal_scatter = float(np.nanpercentile(sw2[good_cal] / wl2[good_cal], 84) - np.nanpercentile(sw2[good_cal] / wl2[good_cal], 16)) / 2 / cal2 \
        if good_cal.sum() > 20 else np.nan

    def zscore(scale):
        pred = cal2 * G_w; epred = np.hypot(cal2 * G_ew, 0.05 * pred)
        return (G_sx - pred) / np.hypot(scale * G_esx, epred), G_sx / np.where(pred > 0, pred, np.nan)
    z0, _ = zscore(1.0)
    faint = (G_w > 0) & (G_w < 150) & (G_esx > 0) & np.isfinite(z0)
    err_scale = float(np.clip(1.4826 * np.nanmedian(np.abs(z0[faint] - np.nanmedian(z0[faint]))), 1.0, 20.0)) if faint.sum() > 50 else 1.0
    zG, rG = zscore(err_scale)
    err *= err_scale; esw2 *= err_scale; esw1 *= err_scale
    ok_geom = (edge > 8) & ((nhits_med > 0) | ~np.isfinite(nhits_med)) & ~sx_overflow & ~sx_saturated & isolated
    snrG_w = G_w / np.maximum(G_ew, 1e-12)
    vanished = is_dom & ok_geom & (dom_frac[grp] > 0.8) & (snrG_w[grp] > 20) & (rG[grp] < 0.2) & (zG[grp] < -10) & \
        (st[2]["n"][keep] >= 6)
    brightened = is_dom & ok_geom & (dom_frac[grp] > 0.8) & (snrG_w[grp] > 5) & (rG[grp] > 2.5) & (zG[grp] > 10)
    # ---- "appeared": SPHEREx synth-W2 peaks with no WISE-era object within 2 px ----
    m = (lam >= 4.0) & (lam <= 5.0)
    w2img = np.nan_to_num(cube[m].mean(0) - background(cube[m]).mean(0))
    nz2 = np.nanmedian(np.abs(w2img[::2, ::2] - np.nanmedian(w2img))) * 1.4826
    from scipy.ndimage import maximum_filter
    from scipy.spatial import cKDTree
    pk = (w2img == maximum_filter(w2img, 5)) & (w2img > 10 * max(nz2, 1e-6))
    pky, pkx = np.where(pk)
    all_px, all_py = wcs.world_to_pixel(SkyCoord(ra_sx * u.deg, dec_sx * u.deg))
    appeared = []
    if len(pkx):
        d_near, _ = cKDTree(np.c_[all_px, all_py]).query(np.c_[pkx, pky])
        sel = (d_near > 2.0) & (pkx > 8) & (pkx < 503) & (pky > 8) & (pky < 503)
        if sel.any():
            sky = wcs.pixel_to_world(pkx[sel], pky[sel])
            appeared = [dict(ra=float(c.ra.deg), dec=float(c.dec.deg), peak_sigma=float(w2img[y, x] / nz2))
                        for c, x, y in zip(sky, pkx[sel], pky[sel])]
    # ---- lens indices ----
    Wf, We = {}, {}
    for k, (lo, hi) in WIN.items():
        Wf[k], We[k] = window(flux, err, lam, lo, hi)
    li = lens_indices(Wf, We)
    # ---- table ----
    snr_sx = sw2 / esw2
    has_spec = fitted & (snr_sx > 5)
    f32 = lambda a: np.asarray(a, np.float32)
    cols = dict(
        tile=np.full(len(k_idx), tile, np.int32), obj=k_idx.astype(np.int32),
        ra=ra_ref[keep], dec=dec_ref[keep], ra_sx=ra_sx[keep], dec_sx=dec_sx[keep],
        pmra=f32(pmx[keep]), pmdec=f32(pmy[keep]), epm=f32(epm[keep]), n_ep=n_ep[keep].astype(np.int16),
        chi2_motion=f32([objs[i]["chi2"] for i in k_idx]), reliable_motion=rel[keep],
        fast_link=np.array([objs[i]["fast"] for i in k_idx]),
        w1_uJy=f32(st[1]["mean"][keep]), w2_uJy=f32(st[2]["mean"][keep]),
        w1_var_chi2=f32(st[1]["chi2"][keep]), w2_var_chi2=f32(st[2]["chi2"][keep]),
        w1_late_uJy=f32(st[1]["late"][keep]), w2_late_uJy=f32(wl2), w2_late_err=f32(ewl2),
        fitted=fitted, sx_w1_uJy=f32(sw1), sx_w1_err=f32(esw1), sx_w2_uJy=f32(sw2), sx_w2_err=f32(esw2), sx_w2_snr=f32(snr_sx),
        blend_n=blend_n.astype(np.int32), blend_dom_frac=f32(dom_frac[grp]),
        decade_ratio_w2=f32(rG[grp]), decade_z_w2=f32(zG[grp]), flag_vanished=vanished, flag_brightened=brightened,
        edge_dist_px=f32(edge), nhits_med=f32(nhits_med), sx_overflow=sx_overflow, sx_saturated=sx_saturated, nbr_ratio=f32(nbr_ratio), isolated=isolated,
        **{k: (v if v.dtype == bool else f32(v)) for k, v in li.items()},
        **{f"sx_{k}_uJy": f32(Wf[k]) for k in ("J", "H", "K", "CH4", "W", "CO")},
    )
    sigpm = (np.hypot(pmx[keep], pmy[keep]) > 5 * epm[keep]) & (n_ep[keep] >= 8)
    rowkeep = fitted | rel[keep] | sigpm
    cols = {k: np.asarray(v)[rowkeep] for k, v in cols.items()}
    tab = pa.table(cols)
    f16 = lambda a: np.asarray(np.asarray(a) / 1000.0, np.float16).tobytes()  # mJy (float16 max 65504)
    rk = np.where(rowkeep)[0]
    tab = tab.append_column("spec_f16_mJy", pa.array([f16(flux[i]) if has_spec[i] else None for i in rk], pa.binary()))
    tab = tab.append_column("spec_err_f16_mJy", pa.array([f16(err[i]) if has_spec[i] else None for i in rk], pa.binary()))
    out.mkdir(parents=True, exist_ok=True)
    tmp = out / f".tile_{tile}.parquet.tmp{os.getpid()}"
    pq.write_table(tab, tmp, compression="zstd")
    os.replace(tmp, out / f"tile_{tile}.parquet")   # atomic: concurrent nodes never see half-written files
    qa = dict(version=VERSION, tile=tile, n_det=int(len(det["ra"])), n_obj=int(nobj), n_kept=int(keep.sum()),
              n_fitted=int(fitted.sum()), n_rows=int(rowkeep.sum()), n_isolated=int((isolated & fitted).sum()), n_spec=int(has_spec.sum()), n_reliable_motion=int(rel.sum()),
              n_vanished=int(vanished.sum()), n_brightened=int(brightened.sum()), n_appeared=len(appeared),
              appeared=appeared[:200], cal_w2=cal2, cal_scatter=cal_scatter, n_cal=int(good_cal.sum()), err_scale=err_scale,
              psf_sigma_px=[None if not np.isfinite(s) else round(float(s), 3) for s in sig_c],
              noise_mjysr=[None if not np.isfinite(s) else round(float(s), 5) for s in noise_c],
              lam_um=lam.round(4).tolist(), bytes_unwise=int(nb_u), bytes_cube=int(nb_c), timings=T,
              total_s=time.time() - t0, out_bytes=os.path.getsize(out / f"tile_{tile}.parquet"))
    (out / f"tile_{tile}.qa.json").write_text(json.dumps(qa, indent=1))
    return qa


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("tile", type=int); ap.add_argument("--out", default="census_out")
    ap.add_argument("--cache-unwise"); ap.add_argument("--no-nhits", action="store_true")
    a = ap.parse_args()
    qa = run(a.tile, pathlib.Path(a.out), a.cache_unwise, not a.no_nhits)
    print(json.dumps({k: v for k, v in qa.items() if k not in ("appeared", "psf_sigma_px", "noise_mjysr", "lam_um")}, indent=1))
