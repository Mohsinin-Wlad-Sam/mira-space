#!/usr/bin/env python3
"""3D catalogue for the web 'Space' view: every placeable census object in Galactic XYZ with its 3D velocity.

Distances: Gaia DR3 parallax where it is good (plx/err > 5, RUWE < 1.4), UltracoolSheet parallax for brown dwarfs,
otherwise the AI ensemble (census/ai_phys.py) when its uncertainty is small and the object is stellar.
Velocities: tangential from the census' own 16-year proper motion at that distance (4.74 km/s per (″/yr · pc)),
plus Gaia DR3 radial velocity when measured (otherwise radial = 0, flagged).

Binary record (little-endian, 32 bytes):
  f32 x, y, z [pc]   Galactic heliocentric (x -> Galactic centre, y -> rotation, z -> north Galactic pole), epoch 2025.84
  i16 vx, vy, vz [0.1 km/s]
  u16 teff [K]       i16 M_W2 [0.01 mag]
  u8  cls | src<<3 | hasRV<<6     (cls 0 dwarf, 1 giant, 2 brown dwarf, 3 extragalactic; src 1 Gaia, 2 UltracoolSheet, 3 AI, 4 named)
  u8  sigma_ln_d * 200 (clipped 255)
  u8  lens bits (1 motion, 2 methane, 4 vanished, 8 brightened, 16 unusual, 32 named)
  u8  log2(F_2025 / F_2016) * 16 + 128   (measured brightness change; 128 = none)
  u16 tile (65535 = not a census object: name index in meta.names = obj)
  u32 obj
Tiers: space/core.bin (always loaded, phones too) and space/deep.bin (desktop, on demand).
usage: python -m census.export_space --web ~/skylens/web_data --workers 48
"""
from __future__ import annotations

import argparse, glob, json, math, os, pathlib, sys, time
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pyarrow.parquet as pq

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from census.ai_phys import RG, unit, vmag, H  # noqa: E402

KMS_PC_YR = 1.0227121650537077e-6     # 1 km/s in pc/yr
REC = np.dtype([("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("vx", "<i2"), ("vy", "<i2"), ("vz", "<i2"), ("teff", "<u2"), ("M", "<i2"),
                ("flags", "u1"), ("sig", "u1"), ("lens", "u1"), ("dflux", "u1"), ("tile", "<u2"), ("obj", "<u4")])
assert REC.itemsize == 32
LENS_BIT = {"movers": 1, "methane": 2, "vanished": 4, "brightened": 8, "unusual": 16}
CCOLS = ["obj", "ra_sx", "dec_sx", "pmra", "pmdec", "epm", "n_ep", "reliable_motion", "w2_uJy", "w2_late_uJy", "decade_ratio_w2",
         "isolated", "sx_saturated"]


def lens_ids(web: pathlib.Path):
    ids = {}
    for lens, bit in LENS_BIT.items():
        if lens == "unusual":
            p = web / "unusual.json"
            if p.exists():
                for it in json.loads(p.read_text())["items"]: ids[(it["tile"], it["obj"])] = ids.get((it["tile"], it["obj"]), 0) | bit
            continue
        for f in glob.glob(str(web / "sky" / lens / "*.json")):
            for r in json.loads(open(f).read())["rows"]:
                t, o = map(int, r[0].split("-")); ids[(t, o)] = ids.get((t, o), 0) | bit
    return ids


def _tile(args):
    tile, objs, census, aiout = args
    import pandas as pd
    try:
        c = pq.read_table(f"{census}/tile_{tile}.parquet", columns=CCOLS).to_pandas()
    except Exception:
        return None
    c = c[c.obj.isin(objs)]
    p = pathlib.Path(f"{aiout}/tile_{tile}.parquet")
    if p.exists():
        a = pq.read_table(p).to_pandas(); c = c.merge(a.drop(columns=["tile"]), on="obj", how="left")
    else:
        for k in ("M_w2", "sM_w2", "dist_pc", "teff", "slogT", "p0", "p1", "p2", "p3"): c[k] = np.nan
    c["tile"] = tile
    return c


def galactic_xyz_vel(ra, dec, d, pmra, pmdec, rv):
    """ICRS position/proper motion (″/yr) + distance (pc) + RV (km/s) -> Galactic position (pc) and velocity (km/s)."""
    r = np.radians(ra); dd = np.radians(dec)
    ca, sa, cd, sd = np.cos(r), np.sin(r), np.cos(dd), np.sin(dd)
    u = np.stack([cd * ca, cd * sa, sd], -1)
    ea = np.stack([-sa, ca, np.zeros_like(ca)], -1); ed = np.stack([-sd * ca, -sd * sa, cd], -1)
    vt = 4.740470463533348 * d[:, None] * (ea * pmra[:, None] + ed * pmdec[:, None])      # km/s
    v = vt + np.nan_to_num(rv)[:, None] * u
    return (u * d[:, None]) @ RG.T, v @ RG.T


def main():
    import pandas as pd
    ap = argparse.ArgumentParser()
    ap.add_argument("--web", default=str(H / "web_data")); ap.add_argument("--census", default=str(H / "census_out"))
    ap.add_argument("--aiout", default=str(H / "ai_out")); ap.add_argument("--workers", type=int, default=32)
    ap.add_argument("--core-field", type=int, default=45000); ap.add_argument("--deep-field", type=int, default=260000)
    ap.add_argument("--max-sig", type=float, default=0.45)
    a = ap.parse_args(); web = pathlib.Path(a.web).expanduser(); t0 = time.time()
    L = lens_ids(web); print(f"lens objects: {len(L):,}", flush=True)
    S = np.load(H / "ai" / "phys_sample.npz"); lab = dict(np.load(H / "ai" / "phys_labels.npz"))
    samp = pd.DataFrame(dict(tile=S["tile"], obj=S["obj"], g_plx=lab["plx"], g_eplx=lab["eplx"], g_rv=lab["rv"], src_lab=lab["src"], M_lab=lab["M"], sM_lab=lab["sM"]))
    samp = samp.drop_duplicates(["tile", "obj"])
    # field stars: a random draw from the AI sample (sky-uniform per tile), preferring Gaia-measured distances
    rng = np.random.default_rng(1)
    want = {}
    for (t, o) in L: want.setdefault(t, set()).add(o)
    fld = samp.sample(frac=1.0, random_state=1)
    fld = fld.head(a.core_field + a.deep_field + 200000)
    for t, o in zip(fld.tile, fld.obj): want.setdefault(int(t), set()).add(int(o))
    jobs = [(t, sorted(o), a.census, a.aiout) for t, o in want.items()]
    parts = []
    with ProcessPoolExecutor(a.workers) as ex:
        for i, r in enumerate(ex.map(_tile, jobs, chunksize=16)):
            if r is not None and len(r): parts.append(r)
            if i % 2000 == 0: print(f"{i}/{len(jobs)} tiles {time.time()-t0:.0f}s", flush=True)
    D = pd.concat(parts, ignore_index=True).merge(samp, on=["tile", "obj"], how="left")
    D["lens"] = [L.get((t, o), 0) for t, o in zip(D.tile, D.obj)]
    # ---- distance: Gaia > UltracoolSheet > AI
    gaia_ok = (D.src_lab == 1) & np.isfinite(D.g_plx) & (D.g_plx / D.g_eplx > 5)
    ucs_ok = (D.src_lab == 2) & np.isfinite(D.M_lab)
    w2 = vmag(D.w2_uJy.to_numpy(), 2)
    d = np.where(gaia_ok, 1000.0 / D.g_plx, np.nan)
    d = np.where(ucs_ok, 10 ** ((w2 - D.M_lab + 5) / 5), d)
    sig = np.where(gaia_ok, D.g_eplx / D.g_plx, np.nan); sig = np.where(ucs_ok, D.sM_lab * math.log(10) / 5, sig)
    ai = ~(gaia_ok | ucs_ok) & np.isfinite(D.dist_pc)
    d = np.where(ai, D.dist_pc, d); sig = np.where(ai, D.sM_w2 * math.log(10) / 5, sig)
    src = np.where(gaia_ok, 1, np.where(ucs_ok, 2, np.where(ai, 3, 0)))
    P = D[["p0", "p1", "p2", "p3"]].to_numpy(float); cls = np.where(np.isfinite(P).all(1), np.nan_to_num(P).argmax(1), 0)
    extragal = np.nan_to_num(P[:, 3]) > 0.5
    ok = np.isfinite(d) & (d > 0.5) & (d < 60000) & np.isfinite(sig) & ((sig < a.max_sig) | (src != 3)) & ~(extragal & (src == 3))
    D, d, sig, src, cls, w2 = D[ok].reset_index(drop=True), d[ok], sig[ok], src[ok], cls[ok], w2[ok]
    print(f"placeable: {len(D):,} (Gaia {np.sum(src==1):,}, UltracoolSheet {np.sum(src==2):,}, AI {np.sum(src==3):,})", flush=True)
    pm_ok = (D.reliable_motion | ((np.hypot(D.pmra, D.pmdec) > 5 * D.epm) & (D.n_ep >= 8))).to_numpy()
    pmra = np.where(pm_ok, D.pmra, 0.0); pmdec = np.where(pm_ok, D.pmdec, 0.0)
    rv = np.where(src == 1, D.g_rv, np.nan)
    xyz, v = galactic_xyz_vel(D.ra_sx.to_numpy(), D.dec_sx.to_numpy(), d, pmra, pmdec, rv)
    M = w2 - 5 * np.log10(d) + 5
    with np.errstate(all="ignore"):
        r1 = D.w2_late_uJy / D.w2_uJy; r2 = r1 * np.where(D.isolated & ~D.sx_saturated, D.decade_ratio_w2, 1.0)
        dfl = np.clip(np.nan_to_num(np.log2(np.clip(r2, 1e-3, 1e3)) * 16 + 128, nan=128), 0, 255)
    teff = np.clip(np.nan_to_num(D.teff, nan=0), 0, 65000)
    rec = np.zeros(len(D), REC)
    rec["x"], rec["y"], rec["z"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    for k, i in (("vx", 0), ("vy", 1), ("vz", 2)): rec[k] = np.clip(np.round(v[:, i] * 10), -32767, 32767)
    rec["teff"] = teff; rec["M"] = np.clip(np.round(np.nan_to_num(M) * 100), -32767, 32767)
    rec["flags"] = cls | (src << 3) | (np.isfinite(rv) << 6); rec["sig"] = np.clip(np.round(sig * 200), 0, 255)
    rec["lens"] = D.lens.to_numpy(); rec["dflux"] = dfl; rec["tile"] = D.tile.to_numpy(); rec["obj"] = D.obj.to_numpy()
    # ---- named nearby stars (Gaia DR3 within ~20 pc, from census/neighbors.py) so the Sun's neighbourhood is complete
    names, nb = [], web / "neighbors.json"
    if nb.exists():
        J = json.loads(nb.read_text()); st = J["stars"]         # Galactic ly and ly/yr (epoch 2016) -> pc and km/s
        LY = 3.261563777
        BT = np.array([[-0.2, 12000], [0.0, 9700], [0.3, 7400], [0.6, 6200], [0.8, 5600], [1.0, 5200], [1.2, 4800], [1.5, 4400], [1.85, 3900],
                       [2.2, 3600], [2.6, 3400], [3.0, 3200], [3.5, 3000], [4.0, 2800], [4.6, 2600], [5.0, 2400]])   # Gaia BP-RP -> Teff (dwarfs)
        nrec = np.zeros(len(st), REC)
        for i, s in enumerate(st):
            p_ = np.array(s[0:3]) / LY; v_ = np.array(s[3:6]) / LY / KMS_PC_YR
            p_ = p_ + v_ * KMS_PC_YR * (2025.84 - 2016.0)
            nrec[i]["x"], nrec[i]["y"], nrec[i]["z"] = p_
            nrec[i]["vx"], nrec[i]["vy"], nrec[i]["vz"] = np.clip(np.round(v_ * 10), -32767, 32767)
            g, bprp = s[6], s[7]; dpc = float(np.linalg.norm(p_))
            nrec[i]["teff"] = int(np.interp(bprp, BT[:, 0], BT[:, 1])) if bprp is not None else 1000
            MG = g - 5 * np.log10(max(dpc, 0.1)) + 5 if g is not None else np.nan
            MW2 = MG - (0.3 + 1.35 * bprp) if g is not None and bprp is not None else 12.0     # rough G-W2 colour for rendering only
            nrec[i]["M"] = int(np.clip(round(MW2 * 100), -32767, 32767))
            nrec[i]["flags"] = 0 | (4 << 3) | (int(s[8]) << 6); nrec[i]["sig"] = 2
            nrec[i]["lens"] = 32; nrec[i]["dflux"] = 128; nrec[i]["tile"] = 65535; nrec[i]["obj"] = i
            names.append(s[12])
        print(f"named neighbours: {len(nrec)}")
    else:
        nrec = np.zeros(0, REC)
    # ---- tiers
    is_lens = rec["lens"] > 0
    order = np.argsort(rng.random(len(rec)))
    field = order[~is_lens[order]]
    lensi = np.where(is_lens)[0]
    Lb = rec["lens"][lensi].astype(int)
    pri = 4 * ((Lb & 2) > 0) + 3 * ((Lb & 16) > 0) + 2 * ((Lb & 1) > 0) + 1 * ((Lb & 12) > 0) + rng.random(len(lensi))   # rare lenses first
    core_lens = lensi[np.argsort(-pri)][:60000]
    core = np.concatenate([core_lens, field[:a.core_field]])
    deep = np.setdiff1d(np.concatenate([lensi, field[:a.core_field + a.deep_field]]), core)
    out = web / "space.tmp"; out.mkdir(exist_ok=True)
    np.concatenate([nrec, rec[core]]).tofile(out / "core.bin"); rec[deep].tofile(out / "deep.bin")
    meta = dict(record=32, fields=[n for n in REC.names], epoch=2025.84, frame="Galactic heliocentric (pc), velocities km/s relative to the Sun",
                classes=["dwarf star", "giant / evolved star", "brown dwarf (L/T/Y)", "galaxy / quasar"],
                sources=["", "Gaia DR3 parallax", "UltracoolSheet parallax", "AI (SPHEREx spectrum + WISE motion)", "Gaia DR3 (named neighbour)"],
                core=dict(file="core.bin", n=int(len(nrec) + len(core)), named=int(len(nrec))), deep=dict(file="deep.bin", n=int(len(deep))),
                names=names, counts=dict(gaia=int((src == 1).sum()), ucs=int((src == 2).sum()), ai=int((src == 3).sum())),
                built=time.strftime("%Y-%m-%d %H:%M"))
    (out / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
    import shutil
    if (web / "space").exists(): shutil.rmtree(web / "space")
    os.replace(out, web / "space")
    print(f"space: core {meta['core']['n']:,} ({os.path.getsize(web/'space'/'core.bin')/1e6:.1f} MB), deep {len(deep):,} "
          f"({os.path.getsize(web/'space'/'deep.bin')/1e6:.1f} MB) in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
