#!/usr/bin/env python3
"""AI physical parameters for every census source: distance, temperature and kind, from SPHEREx spectra + WISE motion.

A deep ensemble of heteroscedastic networks learns  spectrum shape (102 SPHEREx colours) + WISE W1-W2 + reduced
proper motion  ->  absolute W2 magnitude M_W2, log Teff and object class.  Labels come from
  * Gaia DR3 (IRSA TAP): parallax (plx/err > 5, RUWE < 1.4) -> M_W2;  GSP-Phot Teff;  DSC quasar/galaxy probabilities
  * UltracoolSheet v2.1 (Best et al., Zenodo 15802304): parallaxes + Teff for L/T/Y brown dwarfs Gaia cannot see
The distance follows from the distance modulus:  d = 10 ** ((W2 - M_W2 + 5) / 5) pc  with  sigma_ln d = ln10/5 * sigma_M.
Uncertainty = aleatoric (predicted) + epistemic (ensemble spread); hold-out = every 10th HEALPix tile (sky-separated).

stages (HPC):
  sample  : random fitted spectra per tile (+ every reliable mover) -> ai/phys_sample.npz          [CPU pool]
  xmatch  : Gaia DR3 + UltracoolSheet labels for the sample        -> ai/phys_labels.npz          [network]
  train   : one ensemble member per GPU                            -> ai/phys_m<k>.pt, metrics     [GPU]
  predict : every census row with a spectrum                       -> ai_out/tile_<N>.parquet      [GPU + CPU]
usage:
  python -m census.ai_phys sample  --workers 48
  python -m census.ai_phys xmatch  --ucs ~/skylens/ext/ucs_main.csv --ucs-fund ~/skylens/ext/ucs_fund.csv
  python -m census.ai_phys train   --member 0 --gpu 0     (members 0..K-1 in parallel)
  python -m census.ai_phys predict --gpus 0,3 --workers 32
"""
from __future__ import annotations

import argparse, glob, io, json, math, os, pathlib, sys, time

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

H = pathlib.Path.home() / "skylens"
COLS = ["tile", "obj", "ra", "dec", "pmra", "pmdec", "epm", "n_ep", "reliable_motion", "w1_uJy", "w2_uJy", "sx_w2_snr",
        "isolated", "sx_saturated", "fitted", "spec_f16_mJy", "spec_err_f16_mJy"]
ZP = {1: 309.54e6, 2: 171.787e6}                # Vega zero points in uJy
CLASSES = ["dwarf star", "giant / evolved star", "brown dwarf (L/T/Y)", "galaxy / quasar"]
NC = len(CLASSES)
# ICRS -> Galactic rotation (Hipparcos convention)
RG = np.array([[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
               [+0.4941094278755837, -0.4448296299600112, +0.7469822444972189],
               [-0.8676661490190047, -0.1980763734312015, +0.4559837761750669]])


def vmag(uJy, band):
    with np.errstate(all="ignore"):
        return -2.5 * np.log10(np.asarray(uJy, float) / ZP[band])


def unit(ra, dec):
    r, d = np.radians(ra), np.radians(dec)
    return np.stack([np.cos(d) * np.cos(r), np.cos(d) * np.sin(r), np.sin(d)], -1)


def gal_b(ra, dec):
    return np.degrees(np.arcsin(np.clip((unit(ra, dec) @ RG.T)[:, 2], -1, 1)))


def normalise(F, E):
    """log10(f / median f) per channel with 0/1 validity mask (same convention as ai_spectra)."""
    ok = np.isfinite(F) & np.isfinite(E) & (E > 0) & (F > 0)
    with np.errstate(all="ignore"):
        med = np.nanmedian(np.where(ok, F, np.nan), axis=1, keepdims=True)
        x = np.where(ok, np.log10(np.clip(F, 1e-6, None) / med), 0.0)
    good = (ok.sum(1) > 60) & np.isfinite(med[:, 0]) & (med[:, 0] > 0)
    return np.clip(np.nan_to_num(x), -3, 3).astype(np.float32), ok.astype(np.float32), good


def scalars(w1, w2, pmra, pmdec, epm, n_ep, b):
    """Colour, reduced proper motion (a classic luminosity proxy) and latitude. Never the apparent magnitude alone."""
    c12 = np.clip(np.nan_to_num(vmag(w1, 1) - vmag(w2, 2), nan=0.3), -1, 4)
    mu = np.hypot(pmra, pmdec)                       # arcsec/yr
    sig = (mu > 5 * np.maximum(epm, 1e-4)) & (n_ep >= 8)
    with np.errstate(all="ignore"):
        H = np.where(sig, vmag(w2, 2) + 5 * np.log10(np.maximum(mu, 1e-4)) + 5, 0.0)
    H = np.nan_to_num(H)
    return np.stack([c12, np.where(sig, (H - 10) / 4, 0), sig.astype(float), np.sin(np.radians(np.abs(b))),
                     np.clip(np.log10(np.maximum(mu, 1e-4)) + 2, -2, 3) * sig], 1).astype(np.float32)


def decode(t):
    F = np.stack([np.frombuffer(x, np.float16) for x in t["spec_f16_mJy"]]).astype(np.float32)
    E = np.stack([np.frombuffer(x, np.float16) for x in t["spec_err_f16_mJy"]]).astype(np.float32)
    return F, E


def features(t):
    F, E = decode(t)
    x, m, good = normalise(F, E)
    s = scalars(t.w1_uJy.to_numpy(), t.w2_uJy.to_numpy(), t.pmra.to_numpy(), t.pmdec.to_numpy(), t.epm.to_numpy(),
                t.n_ep.to_numpy(), gal_b(t.ra.to_numpy(), t.dec.to_numpy()))
    return np.concatenate([x * m, m, s], 1), good


# ---------------------------------------------------------------- sample
def _sample_tile(args):
    f, per_tile, seed = args
    try:
        t = pq.read_table(f, columns=COLS).to_pandas()
    except Exception:
        return None
    t = t[t.spec_f16_mJy.notna() & ~t.sx_saturated]
    if not len(t): return None
    rng = np.random.default_rng(seed)
    base = t[(t.sx_w2_snr > 10) & t.isolated]
    pick = base.sample(min(per_tile, len(base)), random_state=int(rng.integers(1 << 30))) if len(base) else base
    movers = t[t.reliable_motion & (t.sx_w2_snr > 5)]                 # nearby-star / brown-dwarf rich
    t = (pick if not len(movers) else __import__("pandas").concat([pick, movers])).drop_duplicates(["tile", "obj"])
    X, good = features(t)
    t = t[good]; X = X[good]
    return dict(X=X.astype(np.float16), tile=t.tile.to_numpy(np.int32), obj=t.obj.to_numpy(np.int32),
                ra=t.ra.to_numpy(), dec=t.dec.to_numpy(), pmra=t.pmra.to_numpy(np.float32), pmdec=t.pmdec.to_numpy(np.float32),
                w2=vmag(t.w2_uJy.to_numpy(), 2).astype(np.float32))


def cmd_sample(a):
    from concurrent.futures import ProcessPoolExecutor
    files = sorted(glob.glob(str(pathlib.Path(a.census).expanduser() / "tile_*.parquet")))
    out = {}; t0 = time.time()
    with ProcessPoolExecutor(a.workers) as ex:
        for i, r in enumerate(ex.map(_sample_tile, [(f, a.per_tile, i) for i, f in enumerate(files)], chunksize=8)):
            if r:
                for k, v in r.items(): out.setdefault(k, []).append(v)
            if i % 1000 == 0: print(f"{i}/{len(files)} tiles {time.time()-t0:.0f}s", flush=True)
    out = {k: np.concatenate(v) for k, v in out.items()}
    p = H / "ai" / "phys_sample.npz"; p.parent.mkdir(exist_ok=True)
    np.savez(p, **out); print(f"sample: {len(out['tile']):,} objects -> {p} ({time.time()-t0:.0f}s)")


# ---------------------------------------------------------------- xmatch
GAIA_COLS = ("source_id, parallax, parallax_error, phot_g_mean_mag, bp_rp, radial_velocity, radial_velocity_error, rv_nb_transits, "
             "teff_gspphot, teff_gspphot_lower, teff_gspphot_upper, logg_gspphot, classprob_dsc_combmod_quasar, "
             "classprob_dsc_combmod_galaxy, ruwe, pmra AS gpmra, pmdec AS gpmdec")


def _votable(ids, ra, dec):
    rows = "".join(f"<TR><TD>{i}</TD><TD>{r:.7f}</TD><TD>{d:.7f}</TD></TR>" for i, r, d in zip(ids, ra, dec))
    return ('<?xml version="1.0"?><VOTABLE version="1.3" xmlns="http://www.ivoa.net/xml/VOTable/v1.3"><RESOURCE><TABLE>'
            '<FIELD name="srcid" datatype="long"/><FIELD name="ura" datatype="double"/><FIELD name="udec" datatype="double"/>'
            f'<DATA><TABLEDATA>{rows}</TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>')


def gaia_chunk(ids, ra, dec, radius_arcsec=1.5, tries=4):
    """IRSA TAP async upload crossmatch. Gaia epoch 2016.0; input positions must be at 2016.0."""
    import requests, pandas as pd
    q = (f"SELECT u.srcid, {', '.join('g.' + c.strip() for c in GAIA_COLS.split(','))} FROM TAP_UPLOAD.u u, gaia_dr3_source g "
         f"WHERE CONTAINS(POINT('ICRS',g.ra,g.dec),CIRCLE('ICRS',u.ura,u.udec,{radius_arcsec/3600:.7f}))=1")
    for k in range(tries):
        try:
            r = requests.post("https://irsa.ipac.caltech.edu/TAP/async", data=dict(REQUEST="doQuery", LANG="ADQL", FORMAT="csv",
                              PHASE="RUN", UPLOAD="u,param:t", QUERY=q), files=dict(t=("u.xml", _votable(ids, ra, dec))), timeout=300)
            job = r.url if "/async/" in r.url else r.headers.get("Location")
            for _ in range(720):
                ph = requests.get(job + "/phase", timeout=60).text.strip()
                if ph in ("COMPLETED", "ERROR", "ABORTED"): break
                time.sleep(5)
            if ph != "COMPLETED": raise RuntimeError(f"phase {ph}: {requests.get(job + '/error', timeout=60).text[:300]}")
            return pd.read_csv(io.StringIO(requests.get(job + "/results/result", timeout=600).text))
        except Exception as e:
            print(f"  gaia chunk retry {k}: {e}", flush=True); time.sleep(20 * (k + 1))
    return None


def load_ucs(main_csv, fund_csv):
    import pandas as pd
    m = pd.read_csv(main_csv, low_memory=False)
    f = pd.read_csv(fund_csv, low_memory=False)[["name", "teff_evo", "teff_evo_err"]]
    m = m.merge(f, on="name", how="left")
    m = m[np.isfinite(m.ra_j2000_formula) & np.isfinite(m.dec_j2000_formula)]
    dt = 16.4                                    # J2000 -> 2016.4 (census reference epoch)
    pa_, pd_ = np.nan_to_num(m.pmra_formula.to_numpy(float)), np.nan_to_num(m.pmdec_formula.to_numpy(float))
    dec = m.dec_j2000_formula.to_numpy(float) + pd_ / 3.6e6 * dt
    ra = m.ra_j2000_formula.to_numpy(float) + pa_ / 3.6e6 * dt / np.cos(np.radians(dec))
    return m.assign(ra16=ra, dec16=dec)


def cmd_xmatch(a):
    import pandas as pd
    from concurrent.futures import ThreadPoolExecutor
    from scipy.spatial import cKDTree
    S = dict(np.load(H / "ai" / "phys_sample.npz"))
    n = len(S["tile"]); sid = np.arange(n)
    # census ra/dec are at 2016.4; Gaia at 2016.0
    dec0 = S["dec"] - S["pmdec"] * 0.4 / 3600
    ra0 = S["ra"] - S["pmra"] * 0.4 / 3600 / np.cos(np.radians(S["dec"]))
    cache = H / "ai" / "gaia_chunks"; cache.mkdir(parents=True, exist_ok=True)
    chunks = [(k, sid[k:k + a.chunk]) for k in range(0, n, a.chunk)]

    def run(c):
        k, ii = c; p = cache / f"c{k:09d}.parquet"
        if p.exists(): return p
        d = gaia_chunk(ii, ra0[ii], dec0[ii])
        if d is None: return None
        d.to_parquet(p); return p
    t0 = time.time(); done = 0
    with ThreadPoolExecutor(a.threads) as ex:
        for p in ex.map(run, chunks):
            done += 1
            if done % 5 == 0: print(f"gaia {done}/{len(chunks)} chunks {time.time()-t0:.0f}s", flush=True)
    G = pd.concat([pd.read_parquet(p) for p in sorted(cache.glob("c*.parquet"))], ignore_index=True)
    # nearest = brightest when several Gaia sources fall in the circle: keep the one with the brightest G
    G = G.sort_values("phot_g_mean_mag").drop_duplicates("srcid")
    L = {k: np.full(n, np.nan, np.float32) for k in ("M", "sM", "logT", "slogT", "plx", "eplx", "rv", "erv", "pq", "pg", "logg")}
    L["cls"] = np.full(n, -1, np.int8); L["src"] = np.zeros(n, np.int8)       # src: 1 Gaia, 2 UltracoolSheet
    L["gaia_id"] = np.zeros(n, np.int64)
    i = G.srcid.to_numpy(int)
    plx, eplx = G.parallax.to_numpy(float), G.parallax_error.to_numpy(float)
    good = (plx / eplx > 5) & (G.ruwe.to_numpy(float) < 1.4)
    L["gaia_id"][i] = G.source_id.to_numpy()
    L["plx"][i], L["eplx"][i] = plx, eplx
    rv_ok = (G.radial_velocity_error < 2) & (G.rv_nb_transits >= 6) & (G.radial_velocity.abs() < 400)
    L["rv"][i] = np.where(rv_ok, G.radial_velocity, np.nan); L["erv"][i] = np.where(rv_ok, G.radial_velocity_error, np.nan)
    with np.errstate(all="ignore"):
        M = S["w2"][i] + 5 * np.log10(plx) - 10
        L["M"][i[good]] = M[good]; L["sM"][i[good]] = (2.1715 * eplx / plx)[good]
        T = G.teff_gspphot.to_numpy(float); Tl, Tu = G.teff_gspphot_lower.to_numpy(float), G.teff_gspphot_upper.to_numpy(float)
        okT = np.isfinite(T) & (T > 2500) & (T < 40000)
        L["logT"][i[okT]] = np.log10(T[okT]); L["slogT"][i[okT]] = np.maximum(0.01, (np.log10(Tu) - np.log10(Tl))[okT] / 2)
    L["logg"][i] = G.logg_gspphot
    pq_, pg_ = G.classprob_dsc_combmod_quasar.to_numpy(float), G.classprob_dsc_combmod_galaxy.to_numpy(float)
    L["pq"][i], L["pg"][i] = pq_, pg_
    cls = np.full(len(G), -1)
    logg = G.logg_gspphot.to_numpy(float)
    cls[good] = 0
    cls[good & ((logg < 3.5) | (M < -2.5))] = 1           # giants: low gravity or very luminous in W2
    cls[(np.nan_to_num(pq_) + np.nan_to_num(pg_) > 0.95) & ~good] = 3
    L["cls"][i] = cls; L["src"][i[good]] = 1
    # UltracoolSheet: L/T/Y dwarfs (spectral type >= L0 = 10) with parallaxes
    if a.ucs and os.path.exists(os.path.expanduser(a.ucs)):
        U = load_ucs(os.path.expanduser(a.ucs), os.path.expanduser(a.ucs_fund))
        tree = cKDTree(unit(S["ra"], S["dec"]))
        d, j = tree.query(unit(U.ra16.to_numpy(), U.dec16.to_numpy()), distance_upper_bound=np.radians(3 / 3600))
        hit = np.isfinite(d)
        U, j = U[hit], j[hit]
        uplx, ueplx = U.plx_formula.to_numpy(float), U.plxerr_formula.to_numpy(float)
        ok = np.isfinite(uplx) & (uplx / ueplx > 5)
        with np.errstate(all="ignore"):
            M = S["w2"][j] + 5 * np.log10(uplx) - 10
        L["M"][j[ok]] = M[ok]; L["sM"][j[ok]] = (2.1715 * ueplx / uplx)[ok]; L["src"][j[ok]] = 2
        T = U.teff_evo.to_numpy(float); okT = np.isfinite(T)
        L["logT"][j[okT]] = np.log10(T[okT]); L["slogT"][j[okT]] = np.maximum(0.01, (U.teff_evo_err.to_numpy(float) / T / np.log(10))[okT])
        spt = U.sptnum_formula.to_numpy(float)
        L["cls"][j[spt >= 10]] = 2
        print(f"UltracoolSheet: {hit.sum()} matched, {ok.sum()} with parallax, {(spt >= 10).sum()} L/T/Y")
    np.savez(H / "ai" / "phys_labels.npz", **L)
    print(f"labels: M {np.isfinite(L['M']).sum():,}  Teff {np.isfinite(L['logT']).sum():,}  classes "
          f"{np.bincount(L['cls'][L['cls'] >= 0], minlength=NC).tolist()}  ({time.time()-t0:.0f}s)")


# ---------------------------------------------------------------- model
def net(torch, nin):
    nn = torch.nn
    class Net(nn.Module):
        def __init__(s):
            super().__init__()
            s.body = nn.Sequential(nn.Linear(nin, 512), nn.GELU(), nn.Dropout(0.05), nn.Linear(512, 512), nn.GELU(),
                                   nn.Linear(512, 256), nn.GELU())
            s.reg = nn.Linear(256, 4)            # M, log sM, logT, log slogT
            s.cls = nn.Linear(256, NC)
        def forward(s, x):
            h = s.body(x); r = s.reg(h)
            return r[:, 0] * 4 + 5, r[:, 1].clamp(-5, 2), r[:, 2] * 0.3 + 3.6, r[:, 3].clamp(-7, 0), s.cls(h)
    return Net()


def split(tile):
    return (tile % 10) == 0          # hold-out tiles (sky-separated validation)


def cmd_train(a):
    import torch
    torch.manual_seed(a.member); np.random.seed(a.member)
    dev = f"cuda:{a.gpu}" if torch.cuda.is_available() else "cpu"
    S = np.load(H / "ai" / "phys_sample.npz"); L = dict(np.load(H / "ai" / "phys_labels.npz"))
    # everything GPU-resident (2.5M x 209 floats = 2 GB): batches are pure device-side gathers
    X = torch.tensor(S["X"].astype(np.float32)).to(dev); va = split(S["tile"])
    y = {k: torch.tensor(np.nan_to_num(L[k], nan=0.0)).to(dev) for k in ("M", "sM", "logT", "slogT")}
    hasM = torch.tensor(np.isfinite(L["M"])).to(dev); hasT = torch.tensor(np.isfinite(L["logT"])).to(dev); cls = torch.tensor(L["cls"].astype(np.int64)).to(dev)
    lab = np.isfinite(L["M"]) | np.isfinite(L["logT"]) | (L["cls"] >= 0)
    tr = np.where(lab & ~va)[0]
    tr = np.random.default_rng(a.member).choice(tr, len(tr), replace=True)       # bootstrap -> ensemble diversity
    # up-weight rare classes (brown dwarfs, giants) so the network does not ignore them
    cc = np.bincount(L["cls"][L["cls"] >= 0], minlength=NC).astype(float)
    cw = torch.tensor(np.clip(cc.sum() / np.maximum(cc, 1) / NC, 0.2, 50), dtype=torch.float32, device=dev)
    w_obj = np.ones(len(L["cls"]), np.float32); w_obj[L["cls"] == 2] = a.bd_weight
    W = torch.tensor(w_obj).to(dev)
    vi = torch.tensor(np.where(lab & va)[0]).to(dev)
    m = net(torch, X.shape[1]).to(dev)
    opt = torch.optim.AdamW(m.parameters(), lr=1.5e-3, weight_decay=1e-4)
    steps = a.epochs * (len(tr) // a.batch + 1)
    sch = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=1.5e-3, total_steps=steps)
    ce = torch.nn.CrossEntropyLoss(weight=cw, reduction="none")

    def loss(ii):
        xb = X[ii]; M, lsM, T, lsT, lg = m(xb)
        hm, ht = hasM[ii], hasT[ii]; c = cls[ii]; w = W[ii]
        vM = torch.exp(2 * lsM) + y["sM"][ii] ** 2 + 0.01
        vT = torch.exp(2 * lsT) + y["slogT"][ii] ** 2 + 1e-5
        lM = 0.5 * ((M - y["M"][ii]) ** 2 / vM + torch.log(vM))
        lT = 0.5 * ((T - y["logT"][ii]) ** 2 / vT + torch.log(vT))
        lc = ce(lg, c.clamp_min(0)) * (c >= 0)
        tot = (w * (lM * hm + lT * ht + 0.5 * lc)).sum() / len(ii)
        return tot
    t0 = time.time()
    for ep in range(a.epochs):
        m.train(); perm = torch.tensor(tr[np.random.permutation(len(tr))]).to(dev); s = 0.0
        for k in range(0, len(perm), a.batch):
            l = loss(perm[k:k + a.batch]); opt.zero_grad(); l.backward(); opt.step(); sch.step(); s += float(l)
        m.eval()
        with torch.no_grad(): vl = sum(float(loss(vi[k:k + 65536])) for k in range(0, len(vi), 65536))
        print(f"member {a.member} epoch {ep+1}/{a.epochs} train {s/(len(perm)/a.batch):.3f} val {vl:.1f} ({time.time()-t0:.0f}s)", flush=True)
    torch.save(dict(state=m.state_dict(), nin=X.shape[1]), H / "ai" / f"phys_m{a.member}.pt")


def load_ensemble(torch, dev):
    ms = []
    for p in sorted((H / "ai").glob("phys_m*.pt")):
        ck = torch.load(p, map_location=dev); m = net(torch, ck["nin"]); m.load_state_dict(ck["state"]); ms.append(m.to(dev).eval())
    return ms


def ens_predict(torch, ms, X, dev):
    with torch.no_grad():
        outs = [m(torch.tensor(X, device=dev)) for m in ms]
    Ms = torch.stack([o[0] for o in outs]); vMs = torch.stack([torch.exp(2 * o[1]) for o in outs])
    Ts = torch.stack([o[2] for o in outs]); vTs = torch.stack([torch.exp(2 * o[3]) for o in outs])
    P = torch.stack([torch.softmax(o[4], 1) for o in outs]).mean(0)
    M = Ms.mean(0); sM = torch.sqrt(vMs.mean(0) + Ms.var(0, unbiased=False)); epi = Ms.std(0, unbiased=False)
    T = Ts.mean(0); sT = torch.sqrt(vTs.mean(0) + Ts.var(0, unbiased=False))
    return [v.cpu().numpy() for v in (M, sM, epi, T, sT, P)]


def cmd_validate(a):
    """Metrics on hold-out tiles -> ai/phys_metrics.json (+ docs)."""
    import torch
    dev = f"cuda:{a.gpu}" if torch.cuda.is_available() else "cpu"
    S = np.load(H / "ai" / "phys_sample.npz"); L = dict(np.load(H / "ai" / "phys_labels.npz")); ms = load_ensemble(torch, dev)
    va = np.where(split(S["tile"]))[0]
    X = S["X"][va].astype(np.float32)
    R = [ens_predict(torch, ms, X[k:k + 65536], dev) for k in range(0, len(X), 65536)]
    M, sM, epi, T, sT, P = (np.concatenate([r[i] for r in R]) for i in range(6))
    out = dict(n_members=len(ms), n_holdout=int(len(va)))
    for name, sel in [("all", np.ones(len(va), bool)), ("gaia", L["src"][va] == 1), ("ultracool", L["src"][va] == 2),
                      ("giants", L["cls"][va] == 1)]:
        h = sel & np.isfinite(L["M"][va])
        if h.sum() < 5: continue
        d = M[h] - L["M"][va][h]; z = d / np.hypot(sM[h], L["sM"][va][h])
        out[f"M_{name}"] = dict(n=int(h.sum()), bias=float(np.median(d)), robust_sigma=float(1.4826 * np.median(np.abs(d - np.median(d)))),
                                frac_within_1sigma=float(np.mean(np.abs(z) < 1)), median_pred_sigma=float(np.median(sM[h])),
                                dist_frac_err=float(1.4826 * np.median(np.abs(d - np.median(d))) * math.log(10) / 5))
    h = np.isfinite(L["logT"][va])
    if h.sum():
        d = T[h] - L["logT"][va][h]
        out["Teff"] = dict(n=int(h.sum()), robust_frac=float(1.4826 * np.median(np.abs(d)) * math.log(10)), frac_within_1sigma=float(np.mean(np.abs(d / np.hypot(sT[h], L["slogT"][va][h])) < 1)))
    c = L["cls"][va]; h = c >= 0
    if h.sum():
        pr = P[h].argmax(1); cm = np.zeros((NC, NC), int); np.add.at(cm, (c[h], pr), 1)
        out["class"] = dict(accuracy=float((pr == c[h]).mean()), confusion=cm.tolist(), labels=CLASSES)
    (H / "ai" / "phys_metrics.json").write_text(json.dumps(out, indent=1)); print(json.dumps(out, indent=1))


# ---------------------------------------------------------------- predict
_ms = None


def _pred_tile(args):
    f, gpu, outdir = args
    global _ms
    import torch
    dev = f"cuda:{gpu}" if torch.cuda.is_available() else "cpu"
    if _ms is None:
        torch.set_num_threads(2); _ms = load_ensemble(torch, dev)
    tile = int(pathlib.Path(f).stem.split("_")[1]); po = pathlib.Path(outdir) / f"tile_{tile}.parquet"
    if po.exists() and po.stat().st_mtime > pathlib.Path(f).stat().st_mtime: return 0
    try:
        t = pq.read_table(f, columns=COLS).to_pandas()
    except Exception:
        return 0
    t = t[t.spec_f16_mJy.notna()]
    if not len(t): return 0
    X, good = features(t); t = t[good]; X = X[good]
    if not len(t): return 0
    M, sM, epi, T, sT, P = ens_predict(torch, _ms, X, dev)
    w2 = vmag(t.w2_uJy.to_numpy(), 2)
    tab = pa.table(dict(tile=t.tile.to_numpy(np.int32), obj=t.obj.to_numpy(np.int32), M_w2=M.astype(np.float32), sM_w2=sM.astype(np.float32),
                        epi_M=epi.astype(np.float32), dist_pc=(10 ** ((w2 - M + 5) / 5)).astype(np.float32),
                        teff=(10 ** T).astype(np.float32), slogT=sT.astype(np.float32),
                        **{f"p{k}": P[:, k].astype(np.float16) for k in range(NC)}))
    tmp = po.with_suffix(f".tmp{os.getpid()}"); pq.write_table(tab, tmp, compression="zstd"); os.replace(tmp, po)
    return len(t)


def cmd_predict(a):
    import multiprocessing as mp
    files = sorted(glob.glob(str(pathlib.Path(a.census).expanduser() / "tile_*.parquet")))
    outdir = H / "ai_out"; outdir.mkdir(exist_ok=True)
    gpus = [int(g) for g in a.gpus.split(",")]
    jobs = [(f, gpus[i % len(gpus)], str(outdir)) for i, f in enumerate(files)]
    ctx = mp.get_context("spawn"); t0 = time.time(); n = 0
    # one pool per GPU so each worker process keeps its ensemble resident on one device
    pools = {g: ctx.Pool(max(1, a.workers // len(gpus))) for g in gpus}
    res = [pools[j[1]].apply_async(_pred_tile, (j,)) for j in jobs]
    for i, r in enumerate(res):
        n += r.get()
        if i % 500 == 0: print(f"{i}/{len(jobs)} tiles, {n:,} objects, {time.time()-t0:.0f}s", flush=True)
    for p in pools.values(): p.close()
    print(f"predicted {n:,} objects in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("cmd", choices=["sample", "xmatch", "train", "validate", "predict"])
    ap.add_argument("--census", default=str(H / "census_out")); ap.add_argument("--workers", type=int, default=32)
    ap.add_argument("--per-tile", type=int, default=120); ap.add_argument("--chunk", type=int, default=25000)
    ap.add_argument("--threads", type=int, default=6)
    ap.add_argument("--ucs", default=str(H / "ext" / "ucs_main.csv")); ap.add_argument("--ucs-fund", default=str(H / "ext" / "ucs_fund.csv"))
    ap.add_argument("--member", type=int, default=0); ap.add_argument("--gpu", type=int, default=0); ap.add_argument("--gpus", default="0")
    ap.add_argument("--epochs", type=int, default=25); ap.add_argument("--batch", type=int, default=2048); ap.add_argument("--bd-weight", type=float, default=20.0)
    a = ap.parse_args()
    dict(sample=cmd_sample, xmatch=cmd_xmatch, train=cmd_train, validate=cmd_validate, predict=cmd_predict)[a.cmd](a)
