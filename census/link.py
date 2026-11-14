"""Link unWISE time-domain detections (16 epochs, 2010-2020, W1+W2) into objects with linear motion.

Step 1  static/slow objects: friends-of-friends on all detections with linking length R_LINK (2").
        Objects moving < ~3"/yr stay connected epoch to epoch; a weighted linear fit gives their motion.
Step 2  fast movers (> ~3"/yr): components seen in few epochs ("orphans") are linked by trajectory search:
        seed pairs from nearby epochs (dt <= 1.2 yr) with displacement consistent with MU_MIN..MU_MAX,
        prediction to every other epoch, support counted with per-epoch KD-trees, greedy selection.
Step 3  merge: fast-mover trajectories absorb any static components lying on their predicted track.
All positions are in a gnomonic tangent plane (arcsec) about the tile centre.
"""
from __future__ import annotations

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

UNWISE_PIX = 2.75  # arcsec
R_LINK = 2.0
MU_MIN, MU_MAX = 2.5, 12.0  # arcsec/yr for the trajectory search
YR = 365.25


def gnomonic(ra, dec, ra0, dec0):
    ra, dec, ra0, dec0 = map(np.radians, (ra, dec, ra0, dec0))
    cosc = np.sin(dec0) * np.sin(dec) + np.cos(dec0) * np.cos(dec) * np.cos(ra - ra0)
    x = np.cos(dec) * np.sin(ra - ra0) / cosc
    y = (np.cos(dec0) * np.sin(dec) - np.sin(dec0) * np.cos(dec) * np.cos(ra - ra0)) / cosc
    return np.degrees(x) * 3600, np.degrees(y) * 3600


def inv_gnomonic(x, y, ra0, dec0):
    x, y = np.radians(np.asarray(x) / 3600), np.radians(np.asarray(y) / 3600)
    ra0, dec0 = np.radians(ra0), np.radians(dec0)
    rho = np.hypot(x, y); c = np.arctan(rho)
    with np.errstate(invalid="ignore", divide="ignore"):
        dec = np.arcsin(np.cos(c) * np.sin(dec0) + np.where(rho > 0, y * np.sin(c) * np.cos(dec0) / rho, 0))
        ra = ra0 + np.arctan2(x * np.sin(c), rho * np.cos(dec0) * np.cos(c) - y * np.sin(dec0) * np.sin(c))
    return np.degrees(ra) % 360, np.degrees(dec)


def fit_motion(t, x, y, s, tref):
    """Weighted LSQ x = x0 + mu*(t-tref); returns x0,y0,mux,muy (arcsec, arcsec/yr), errors, chi2/dof."""
    w = 1 / s ** 2; dt = (t - tref) / YR
    S, St, Stt = w.sum(), (w * dt).sum(), (w * dt * dt).sum()
    det = S * Stt - St ** 2
    if det <= 1e-12 or len(t) < 3:
        x0 = (w * x).sum() / S; y0 = (w * y).sum() / S
        return x0, y0, 0.0, 0.0, 1 / np.sqrt(S), 1 / np.sqrt(S), np.inf, np.inf, np.nan
    def solve(v):
        Sv, Stv = (w * v).sum(), (w * dt * v).sum()
        return (Stt * Sv - St * Stv) / det, (S * Stv - St * Sv) / det
    x0, mux = solve(x); y0, muy = solve(y)
    r2 = w * ((x - x0 - mux * dt) ** 2 + (y - y0 - muy * dt) ** 2)
    dof = max(2 * len(t) - 4, 1)
    return x0, y0, mux, muy, np.sqrt(Stt / det), np.sqrt(Stt / det), np.sqrt(S / det), np.sqrt(S / det), r2.sum() / dof


def link(det: dict, ra0: float, dec0: float, tref: float = 57500.0):
    """Return (obj_id per detection, list of object dicts). det: arrays from io_sources.read_unwise_tile."""
    x, y = gnomonic(det["ra"], det["dec"], ra0, dec0)
    t = det["MJDMEAN"]; ep = det["EPOCH"].astype(int)
    s = np.hypot(det["dx"], det["dy"]) * UNWISE_PIX / np.sqrt(2)
    s = np.sqrt(s ** 2 + 0.15 ** 2)  # astrometric floor
    n = len(x)
    # ---- step 1: friends-of-friends -------------------------------------------------------------------------
    pairs = cKDTree(np.c_[x, y]).query_pairs(R_LINK, output_type="ndarray")
    g = coo_matrix((np.ones(len(pairs), np.int8), (pairs[:, 0], pairs[:, 1])), shape=(n, n))
    ncomp, lab = connected_components(g, directed=False)
    order = np.argsort(lab, kind="stable"); bounds = np.r_[0, np.cumsum(np.bincount(lab, minlength=ncomp))]
    comp_nep = np.zeros(ncomp, int); comp_xy = np.zeros((ncomp, 2)); comp_t = np.zeros(ncomp)
    for c in range(ncomp):
        idx = order[bounds[c]:bounds[c + 1]]
        comp_nep[c] = len(np.unique(ep[idx]))
        w = 1 / s[idx] ** 2
        comp_xy[c] = (np.c_[x[idx], y[idx]] * w[:, None]).sum(0) / w.sum(); comp_t[c] = t[idx].mean()
    obj_of_comp = np.arange(ncomp)
    # ---- step 2: fast-mover trajectory search over orphan components --------------------------------------
    orphan = np.where((comp_nep <= 6))[0]
    ep_of = {}
    for c in orphan:
        idx = order[bounds[c]:bounds[c + 1]]
        e = int(np.bincount(ep[idx]).argmax()); ep_of[c] = e
    o_ep = np.array([ep_of[c] for c in orphan]) if len(orphan) else np.array([], int)
    epochs = np.unique(ep)
    ep_t = {e: np.median(t[ep == e]) for e in epochs}
    trees = {e: (cKDTree(comp_xy[orphan[o_ep == e]]), orphan[o_ep == e]) for e in epochs if np.any(o_ep == e)}
    cands = []
    for ea in epochs:
        if ea not in trees: continue
        ta_tree, ta_ids = trees[ea]
        for eb in epochs:
            if eb <= ea or eb not in trees: continue
            dtyr = (ep_t[eb] - ep_t[ea]) / YR
            if not (0.3 <= dtyr <= 1.2): continue
            tb_tree, tb_ids = trees[eb]
            nb = ta_tree.query_ball_tree(tb_tree, MU_MAX * dtyr)
            for ia, lst in enumerate(nb):
                for ib in lst:
                    a, b = ta_ids[ia], tb_ids[ib]
                    d = comp_xy[b] - comp_xy[a]; sep = np.hypot(*d)
                    if sep < MU_MIN * dtyr: continue
                    cands.append((a, b, d[0] / dtyr, d[1] / dtyr))
    movers = []
    if cands:
        cands = np.array(cands)
        a = cands[:, 0].astype(int); mux, muy = cands[:, 2], cands[:, 3]
        support = np.zeros(len(cands), int); members = [[] for _ in range(len(cands))]
        for e, (tree, ids) in trees.items():
            dtyr = (ep_t[e] - comp_t[a]) / YR
            px = comp_xy[a, 0] + mux * dtyr; py = comp_xy[a, 1] + muy * dtyr
            tol = 2.0 + 0.3 * np.abs(dtyr)
            dd, ii = tree.query(np.c_[px, py], distance_upper_bound=float(tol.max()))
            ok = np.isfinite(dd) & (dd <= tol)
            support += ok
            for k in np.where(ok)[0]: members[k].append(ids[ii[k]])
        used = set()
        for k in np.argsort(-support):
            if support[k] < 5: break
            mem = [m for m in set(members[k]) if m not in used]
            if len(mem) < 5: continue
            used.update(mem); root = mem[0]
            obj_of_comp[mem] = root; movers.append(root)
    # ---- step 3: merge static components lying on a fast-mover track ---------------------------------------
    # (handled implicitly when components are orphans; non-orphan components on a track are left separate)
    obj = obj_of_comp[lab]
    # ---- per-object fits ------------------------------------------------------------------------------------
    uo, inv = np.unique(obj, return_inverse=True)
    oorder = np.argsort(inv, kind="stable"); ob = np.r_[0, np.cumsum(np.bincount(inv))]
    mover_set = set(movers)
    out = []
    for k, o in enumerate(uo):
        idx = oorder[ob[k]:ob[k + 1]]
        x0, y0, mx, my, ex0, ey0, emx, emy, chi = fit_motion(t[idx], x[idx], y[idx], s[idx], tref)
        snr = det["flux"][idx] / np.maximum(det["dflux"][idx], 1e-6)
        snr_med = float(np.median(snr))
        nep = len(np.unique(ep[idx]))
        pm, epm = float(np.hypot(mx, my)), float(max(emx, emy))
        # reliability (calibrated on tile 10226: WISE 0855 S/N 28, chi2 3.4 vs false tracks S/N 3-5.5, chi2 98-343)
        # bright stars: chi2 is dominated by unWISE astrometric systematics, not by mis-linking
        reliable_motion = (nep >= 8) and np.isfinite(chi) and (pm > 10 * epm) and (
            ((chi < 8.0) and (snr_med >= 6.0)) or ((snr_med >= 30.0) and (chi < 200.0) and (nep >= 10)) or ((snr_med >= 100.0) and (chi < 2000.0) and (nep >= 12)))
        rec = dict(n_det=len(idx), n_ep=nep, x0=x0, y0=y0, pmx=mx, pmy=my, epmx=emx, epmy=emy,
                   chi2=chi, fast=o in mover_set, t0=t[idx].min(), t1=t[idx].max(), snr_med=snr_med,
                   reliable_motion=bool(reliable_motion), idx=idx)
        out.append(rec)
    # ---- step 3: movers absorb "ghost" objects lying on their track (e.g. 2010-11 epochs before the WISE gap) ----
    tmean = np.array([t[r["idx"]].mean() for r in out])
    few = np.array([r["n_ep"] <= 6 for r in out])
    cand_ids = np.where(few)[0]
    if len(cand_ids):
        ctree = cKDTree(np.c_[[out[i]["x0"] for i in cand_ids], [out[i]["y0"] for i in cand_ids]])
        absorbed = set()
        for k, r in enumerate(out):
            pm = np.hypot(r["pmx"], r["pmy"])
            if not (r["reliable_motion"] and pm > 1.0):
                continue
            span = max(abs(57500 - 55200), abs(59300 - 57500)) / YR
            for jj in ctree.query_ball_point([r["x0"], r["y0"]], pm * span + 5.0):
                j = cand_ids[jj]
                if j == k or j in absorbed: continue
                dt = (tmean[j] - tref) / YR
                if np.hypot(out[j]["x0"] - (r["x0"] + r["pmx"] * dt), out[j]["y0"] - (r["y0"] + r["pmy"] * dt)) < 3.0:
                    r["idx"] = np.r_[r["idx"], out[j]["idx"]]; absorbed.add(j)
            idx = r["idx"]
            x0, y0, mx, my, _, _, emx, emy, chi = fit_motion(t[idx], x[idx], y[idx], s[idx], tref)
            r.update(x0=x0, y0=y0, pmx=mx, pmy=my, epmx=emx, epmy=emy, chi2=chi, n_det=len(idx), n_ep=len(np.unique(ep[idx])))
        if absorbed:
            keep = [i for i in range(len(out)) if i not in absorbed]
            remap = -np.ones(len(out), int); remap[keep] = np.arange(len(keep))
            for k, r in enumerate(out):
                if k in absorbed: continue
            newinv = np.empty_like(inv)
            for k in keep:
                newinv[out[k]["idx"]] = remap[k]
            out = [out[i] for i in keep]
            inv = newinv
    return inv, out
