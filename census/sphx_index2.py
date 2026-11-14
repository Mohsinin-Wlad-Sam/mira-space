#!/usr/bin/env python3
"""SPHEREx exposure index v2: any RA/Dec -> the exposures that cover it, with no server.

Why v2: the first index used 13 deg² sky patches, larger than a detector footprint (3.5° × 3.5°), so only ~1 in 5 of the
listed exposures covered a given position. v2 uses HEALPix nside 32 (3.4 deg², 12,288 patches) and prefers exposures whose
footprint contains the WHOLE patch, so nearly every listed exposure is usable for any position inside it.

Per patch and detector we keep up to K exposures, spread over the survey visits (6-month passes) so every epoch is
represented: a flipbook must show time. The inventory comes from IRSA's TAP service (spherex.plane + spherex.artifact);
re-run this script after each SPHEREx data release (weekly quick releases, annual data releases) and re-sync `sphx2/`.

out: <web>/sphx2/<pix>.json  {"v":2,"nside":32,"pix":p,"roots":[...],"tot":[n_det1..6],"e":[[mjd,det,root,"seq_k",[8 corner numbers],n_in],...]}
       file URL = S3/{rel}/level2/{week}/{ver}/{det}/level2_{week}_{seq}_{k}D{det}_spx_{ver}.fits with roots[root] = "rel|week/ver"
     <web>/sphx2/meta.json   release inventory, date range, build time (shown in the app as "data through ...")
usage: python -m census.sphx_index2 --web ~/skylens/web_data --k 24 [--refresh]
"""
from __future__ import annotations

import argparse, csv, json, os, pathlib, shutil, sys, time
from collections import Counter

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from census.sphx_index import tap_async, wkb_polygon  # noqa: E402

NSIDE = 32
D2R = np.pi / 180


def unit(lon, lat):
    lon = np.asarray(lon) * D2R; lat = np.asarray(lat) * D2R
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], -1)


def pick_spread(mjd: np.ndarray, k: int) -> np.ndarray:
    """indices of up to k exposures spread over visits (gaps > 20 d) and evenly inside each visit; mjd sorted ascending"""
    n = len(mjd)
    if n <= k: return np.arange(n)
    cuts = np.flatnonzero(np.diff(mjd) > 20) + 1
    visits = np.split(np.arange(n), cuts)
    quota = np.zeros(len(visits), int); left = k
    while left > 0:                                           # round-robin: one slot per visit until used up
        gave = False
        for i, v in enumerate(visits):
            if left and quota[i] < len(v): quota[i] += 1; left -= 1; gave = True
        if not gave: break
    out = []
    for v, q in zip(visits, quota):
        if q >= len(v): out += list(v)
        elif q == 1: out.append(v[len(v) // 2])
        elif q > 1: out += [v[int(round(i))] for i in np.linspace(0, len(v) - 1, q)]
    return np.array(sorted(set(out)))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--web", default="~/skylens/web_data"); ap.add_argument("--k", type=int, default=24)
    ap.add_argument("--cache", default="~/skylens/ai/sphx_inventory.csv"); ap.add_argument("--refresh", action="store_true", help="re-download the inventory from IRSA")
    a = ap.parse_args(); web = pathlib.Path(a.web).expanduser(); cache = pathlib.Path(a.cache).expanduser(); t0 = time.time()
    if a.refresh and cache.exists(): cache.unlink()
    tap_async("SELECT p.energy_bandpassname, p.time_bounds_lower, p.poly, a.uri FROM spherex.plane p JOIN spherex.artifact a ON a.planeid = p.planeid", cache)
    from astropy_healpix import HEALPix
    import astropy.units as u
    from scipy.spatial import cKDTree

    # ---- inventory -> arrays
    mjd, det, root, tail, corners = [], [], [], [], []
    roots: dict[str, int] = {}; rel_n: Counter = Counter()
    with open(cache) as f:
        for r in csv.DictReader(f):
            try:
                parts = r["uri"].split("/")                    # ibe/data/spherex/<rel>/level2/<week>/<ver>/<det>/level2_<week>_<seq>_<k>D<det>_spx_<ver>.fits
                rel, week, ver, d, fn = parts[3], parts[5], parts[6], int(parts[7]), parts[8]
                bits = fn.split("_"); seq, kd = bits[3], bits[4]
                poly = wkb_polygon(r["poly"])
                if len(poly) != 4 or not kd.endswith(f"D{d}"): continue
            except Exception:
                continue
            key = f"{rel}|{week}/{ver}"
            mjd.append(float(r["time_bounds_lower"])); det.append(d); root.append(roots.setdefault(key, len(roots))); tail.append(f"{seq}_{kd[:-2]}")
            corners.append([c for xy in poly for c in xy]); rel_n[rel] += 1
    mjd = np.array(mjd); det = np.array(det, np.int8); root = np.array(root, np.int32); corners = np.array(corners).reshape(-1, 4, 2); n = len(mjd)
    root_names = [None] * len(roots)
    for kname, i in roots.items(): root_names[i] = kname
    print(f"{n:,} exposures, {len(roots)} week/version roots, releases {dict(rel_n)}, {time.time()-t0:.0f}s", flush=True)

    # ---- geometry: footprint corners as unit vectors, edge normals (inward), centre + radius
    V = unit(corners[..., 0], corners[..., 1])                                        # (n,4,3)
    C = V.mean(1); C /= np.linalg.norm(C, axis=1, keepdims=True)
    N = np.cross(V, np.roll(V, -1, axis=1))                                           # edge normals (n,4,3)
    N *= np.sign(np.einsum("nij,nj->ni", N, C))[..., None]                            # orient toward the footprint centre
    rad = np.arccos(np.clip(np.einsum("nij,nj->ni", V, C), -1, 1)).max(1)             # circumradius (rad)

    hp = HEALPix(nside=NSIDE, order="nested"); npix = hp.npix
    pc_lon, pc_lat = hp.healpix_to_lonlat(np.arange(npix))
    PC = unit(pc_lon.deg, pc_lat.deg)                                                 # pixel centres (npix,3)
    blon, blat = hp.boundaries_lonlat(np.arange(npix), step=2)                        # 8 boundary points per pixel
    PB = np.concatenate([unit(blon.deg, blat.deg), PC[:, None, :]], 1)                # (npix,9,3) test points
    pix_rad = np.arccos(np.clip(np.einsum("pij,pj->pi", PB, PC), -1, 1)).max()
    tree = cKDTree(PC)
    chord = 2 * np.sin((rad + pix_rad) / 2)

    # ---- (exposure, pixel) pairs and how many of the pixel's 9 test points the footprint contains
    pe, pp, pn = [], [], []
    CH = 100_000
    for s in range(0, n, CH):
        sl = slice(s, min(n, s + CH))
        lists = tree.query_ball_point(C[sl], chord[sl])
        e_idx = np.repeat(np.arange(sl.start, sl.stop), [len(L) for L in lists]); p_idx = np.fromiter((p for L in lists for p in L), np.int32)
        dots = np.einsum("mij,mkj->mik", N[e_idx], PB[p_idx])                         # (m,4 edges,9 points)
        nin = (dots > 0).all(1).sum(1).astype(np.int8)
        keep = nin > 0
        pe.append(e_idx[keep]); pp.append(p_idx[keep]); pn.append(nin[keep])
        if (s // CH) % 4 == 0: print(f"  pairs: {sl.stop:,}/{n:,} exposures, {time.time()-t0:.0f}s", flush=True)
    pe = np.concatenate(pe); pp = np.concatenate(pp); pn = np.concatenate(pn)
    print(f"{len(pe):,} exposure-pixel pairs ({(pn == 9).mean()*100:.0f}% contain the whole pixel), {time.time()-t0:.0f}s", flush=True)

    # ---- per pixel × detector: choose K, whole-pixel coverage first, spread over the visits
    order = np.lexsort((mjd[pe], det[pe], pp)); pe, pp, pn = pe[order], pp[order], pn[order]
    starts = np.flatnonzero(np.r_[True, pp[1:] != pp[:-1]]); ends = np.r_[starts[1:], len(pp)]
    out = web / "sphx2.tmp"
    if out.exists(): shutil.rmtree(out)
    out.mkdir(parents=True)
    total = 0; usable = 0; nfile = 0
    for s, e in zip(starts, ends):
        pix = int(pp[s]); E = pe[s:e]; NIN = pn[s:e]; D = det[E]
        rows = []; tot = [0] * 6; used_roots: dict[int, int] = {}
        for d in range(1, 7):
            m = D == d; Ed, Nd = E[m], NIN[m]; tot[d - 1] = int(m.sum())
            if not len(Ed): continue
            full = Nd == 9
            sel = list(Ed[full][pick_spread(mjd[Ed[full]], a.k)]) if full.any() else []
            if len(sel) < a.k and (~full).any():                                      # fill up with the best partial coverage
                rest = Ed[~full]; rn = Nd[~full]
                best = rest[np.argsort(-rn, kind="stable")][: 3 * (a.k - len(sel))]
                best = best[np.argsort(mjd[best])]
                sel += list(best[pick_spread(mjd[best], a.k - len(sel))])
            nin_of = dict(zip(Ed.tolist(), Nd.tolist()))
            for x in sel:
                x = int(x); ri = used_roots.setdefault(int(root[x]), len(used_roots))
                rows.append([round(float(mjd[x]), 5), d, ri, tail[x], [round(float(c), 3) for c in corners[x].ravel()], int(nin_of[x])])
        rows.sort(key=lambda r: r[0]); total += len(rows); usable += sum(1 for r in rows if r[5] == 9); nfile += 1
        rn = [None] * len(used_roots)
        for gi, li in used_roots.items(): rn[li] = root_names[gi]
        (out / f"{pix}.json").write_text(json.dumps(dict(v=2, nside=NSIDE, pix=pix, roots=rn, tot=tot, e=rows), separators=(",", ":")))
    if (web / "sphx2").exists(): shutil.rmtree(web / "sphx2")
    os.replace(out, web / "sphx2")
    iso = lambda m: time.strftime("%Y-%m-%d", time.gmtime((m - 40587) * 86400))
    meta = dict(v=2, nside=NSIDE, order="nested", k_per_detector=a.k, exposures=n, entries=total, whole_pixel_entries=usable, pixels=nfile,
                releases=dict(rel_n), first=iso(mjd.min()), last=iso(mjd.max()), mjd_min=float(mjd.min()), mjd_max=float(mjd.max()), built=time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()),
                source="IRSA TAP spherex.plane + spherex.artifact",
                url="https://nasa-irsa-spherex.s3.amazonaws.com/{rel}/level2/{week}/{ver}/{det}/level2_{week}_{seq}_{k}D{det}_spx_{ver}.fits")
    (web / "sphx2" / "meta.json").write_text(json.dumps(meta))
    print(json.dumps(meta, indent=1)); print(f"done in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
