#!/usr/bin/env python3
"""Self-supervised spectral fingerprints for SPHEREx 102-channel census spectra (GPU).

  train  : masked, inverse-variance-weighted autoencoder 102 -> 16-d latent -> 102 on high-S/N isolated spectra
  encode : latent + anomaly score (reduced chi2 of the reconstruction) for every eligible object
  twins  : k nearest neighbours in latent space for featured objects (web feeds) -> web_data/twins/<id>.json
           + 'unusual' feed (highest anomaly scores) -> web_data/unusual.json
usage:
  python -m census.ai_spectra train  --census ~/skylens/census_out --model ~/skylens/ai/ae.pt --gpu 0
  python -m census.ai_spectra encode --census ~/skylens/census_out --model ~/skylens/ai/ae.pt --out ~/skylens/ai/latent.npz --gpu 0
  python -m census.ai_spectra twins  --latent ~/skylens/ai/latent.npz --web ~/skylens/web_data --gpu 0
Spectra are normalised by their median flux and compared in log space, so twins share *shape* (chemistry,
temperature), not brightness.
"""
from __future__ import annotations

import argparse, glob, json, os, pathlib, time

import numpy as np
import pyarrow.parquet as pq

ROW_COLS = ["tile", "obj", "ra_sx", "dec_sx", "sx_w2_snr", "isolated", "sx_saturated", "sx_overflow", "fitted",
            "spec_f16_mJy", "spec_err_f16_mJy"]


def load_spectra(census: str, max_rows: int | None = None, min_snr: float = 20.0, seed: int = 0, files_limit: int | None = None):
    files = sorted(glob.glob(os.path.join(os.path.expanduser(census), "tile_*.parquet")))
    rng = np.random.default_rng(seed); rng.shuffle(files)
    if files_limit: files = files[:files_limit]
    F, E, meta = [], [], []
    for f in files:
        try:
            t = pq.read_table(f, columns=ROW_COLS).to_pandas()
        except Exception:
            continue
        m = t.spec_f16_mJy.notna() & (t.sx_w2_snr > min_snr) & t.isolated & ~t.sx_saturated & ~t.sx_overflow
        t = t[m]
        if not len(t): continue
        F.append(np.stack([np.frombuffer(b, np.float16) for b in t.spec_f16_mJy]).astype(np.float32))
        E.append(np.stack([np.frombuffer(b, np.float16) for b in t.spec_err_f16_mJy]).astype(np.float32))
        meta.append(t[["tile", "obj", "ra_sx", "dec_sx", "sx_w2_snr"]].to_numpy())
        if max_rows and sum(len(x) for x in F) >= max_rows: break
    return np.concatenate(F), np.concatenate(E), np.concatenate(meta)


def normalise(F, E):
    """log10(f / median f) with weights; invalid channels get weight 0."""
    ok = np.isfinite(F) & np.isfinite(E) & (E > 0) & (F > 0)
    med = np.nanmedian(np.where(ok, F, np.nan), axis=1, keepdims=True)
    x = np.where(ok, np.log10(np.clip(F, 1e-6, None) / med), 0.0).astype(np.float32)
    sig = np.where(ok, (E / np.clip(F, 1e-6, None)) / np.log(10), 1.0)          # d log10 f
    w = np.where(ok, 1.0 / np.clip(sig, 0.02, None) ** 2, 0.0).astype(np.float32)  # 0.02 dex floor
    good = (ok.sum(1) > 70) & np.isfinite(med[:, 0]) & (med[:, 0] > 0)
    return np.clip(x, -3, 3), w, good


def model(torch, latent=16):
    nn = torch.nn
    enc = nn.Sequential(nn.Linear(204, 512), nn.GELU(), nn.Linear(512, 256), nn.GELU(), nn.Linear(256, latent))
    dec = nn.Sequential(nn.Linear(latent, 256), nn.GELU(), nn.Linear(256, 512), nn.GELU(), nn.Linear(512, 102))
    return enc, dec


def cmd_train(a):
    import torch
    dev = f"cuda:{a.gpu}" if torch.cuda.is_available() else "cpu"
    t0 = time.time(); F, E, _ = load_spectra(a.census, a.max_rows); x, w, good = normalise(F, E); x, w = x[good], w[good]
    print(f"training spectra: {len(x):,} (load {time.time()-t0:.0f}s) on {dev}", flush=True)
    X = torch.tensor(x); W = torch.tensor(w); M = (W > 0).float()
    enc, dec = model(torch); enc.to(dev); dec.to(dev)
    opt = torch.optim.AdamW(list(enc.parameters()) + list(dec.parameters()), lr=2e-3, weight_decay=1e-4)
    n = len(X); idx = torch.randperm(n); nval = min(50000, n // 20); val, tr = idx[:nval], idx[nval:]
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=a.epochs * (len(tr) // a.batch + 1))
    def loss_on(ii):
        xb, wb, mb = X[ii].to(dev), W[ii].to(dev), M[ii].to(dev)
        z = enc(torch.cat([xb * mb, mb], 1)); r = dec(z)
        return ((r - xb) ** 2 * wb).sum() / wb.sum().clamp_min(1)
    for ep in range(a.epochs):
        perm = tr[torch.randperm(len(tr))]; tot = 0.0
        enc.train(); dec.train()
        for k in range(0, len(perm), a.batch):
            ii = perm[k:k + a.batch]
            # random channel dropout teaches the model to fill gaps (robust to missing coverage)
            l = loss_on(ii); opt.zero_grad(); l.backward(); opt.step(); sched.step(); tot += float(l) * len(ii)
        enc.eval(); dec.eval()
        with torch.no_grad(): vl = float(loss_on(val))
        print(f"epoch {ep+1}/{a.epochs} train {tot/len(tr):.3f} val {vl:.3f} ({time.time()-t0:.0f}s)", flush=True)
    pathlib.Path(os.path.expanduser(a.model)).parent.mkdir(parents=True, exist_ok=True)
    torch.save(dict(enc=enc.state_dict(), dec=dec.state_dict(), val=vl, n=len(x)), os.path.expanduser(a.model))


def cmd_encode(a):
    import torch
    dev = f"cuda:{a.gpu}" if torch.cuda.is_available() else "cpu"
    ck = torch.load(os.path.expanduser(a.model), map_location=dev); enc, dec = model(torch)
    enc.load_state_dict(ck["enc"]); dec.load_state_dict(ck["dec"]); enc.to(dev).eval(); dec.to(dev).eval()
    F, E, meta = load_spectra(a.census, None, a.min_snr); x, w, good = normalise(F, E)
    Z, A = [], []
    with torch.no_grad():
        for k in range(0, len(x), 65536):
            xb = torch.tensor(x[k:k + 65536], device=dev); wb = torch.tensor(w[k:k + 65536], device=dev); mb = (wb > 0).float()
            z = enc(torch.cat([xb * mb, mb], 1)); r = dec(z)
            # anomaly = RMS misfit in dex over valid channels (S/N-independent; chi2 is dominated by bright stars)
            rms = torch.sqrt(((r - xb) ** 2 * mb).sum(1) / mb.sum(1).clamp_min(1))
            Z.append(z.cpu().numpy()); A.append(rms.cpu().numpy())
    Z, A = np.concatenate(Z), np.concatenate(A)
    np.savez_compressed(os.path.expanduser(a.out), z=Z[good].astype(np.float16), anomaly=A[good].astype(np.float32),
                        meta=meta[good], x=x[good].astype(np.float16))
    print(f"encoded {good.sum():,} spectra -> {a.out}", flush=True)


def cmd_twins(a):
    import torch
    dev = f"cuda:{a.gpu}" if torch.cuda.is_available() else "cpu"
    d = np.load(os.path.expanduser(a.latent), allow_pickle=True)
    Z = torch.tensor(d["z"].astype(np.float32), device=dev); meta = d["meta"]; A = d["anomaly"]; X = d["x"]
    key = {(int(t), int(o)): i for i, (t, o, *_r) in enumerate(meta)}
    web = pathlib.Path(os.path.expanduser(a.web)); outd = web / "twins"; outd.mkdir(parents=True, exist_ok=True)
    queries = {}
    for feed in ("movers", "methane", "vanished", "brightened"):
        p = web / f"{feed}.json"
        if p.exists():
            for c in json.loads(p.read_text())["items"]: queries[f"{c['tile']}-{c['obj']}"] = (c["tile"], c["obj"])
    tg = json.loads((web / "targets.json").read_text()) if (web / "targets.json").exists() else []
    tmap = {"Barnard's Star": "barnard", "Epsilon Indi B": "eps-indi-b", "WISE 0855-0714": "wise-0855", "RW Aurigae": "rw-aur", "R Draconis": "r-dra"}
    for t in tg:
        if t.get("census") and t["name"] in tmap: queries[tmap[t["name"]]] = (t["census"]["tile"], t["census"]["obj"])
    n = 0
    for qid, k in queries.items():
        i = key.get((int(k[0]), int(k[1])))
        if i is None: continue
        dist = torch.linalg.vector_norm(Z - Z[i], dim=1); dist[i] = float("inf")
        vals, idx = torch.topk(dist, a.k, largest=False)
        tw = [dict(tile=int(meta[j][0]), obj=int(meta[j][1]), ra=float(meta[j][2]), dec=float(meta[j][3]), d=round(float(v), 3),
                   shape=[round(float(s), 3) for s in X[j]]) for v, j in zip(vals.cpu().numpy(), idx.cpu().numpy())]
        (outd / f"{qid}.json").write_text(json.dumps(dict(id=qid, shape=[round(float(s), 3) for s in X[i]], twins=tw), separators=(",", ":")))
        n += 1
    # unusual feed: top anomaly scores (bright, isolated) — each with its nearest 'normal' neighbours for context
    snr = meta[:, 4].astype(float)
    A_rank = np.where((snr > 30) & (snr < 3000), A, -np.inf)       # skip near-saturated stars
    top = np.argsort(-A_rank)[: a.unusual]
    items = [dict(tile=int(meta[j][0]), obj=int(meta[j][1]), ra_sx=float(meta[j][2]), dec_sx=float(meta[j][3]),
                  snr=float(meta[j][4]), anomaly=round(float(A[j]), 2), shape=[round(float(s), 3) for s in X[j]]) for j in top]
    (web / "unusual.json").write_text(json.dumps(dict(name="unusual", n=len(items), items=items), separators=(",", ":")))
    print(f"twins for {n} objects; unusual feed {len(items)}", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("cmd", choices=["train", "encode", "twins"])
    ap.add_argument("--census", default="~/skylens/census_out"); ap.add_argument("--model", default="~/skylens/ai/ae.pt")
    ap.add_argument("--out", default="~/skylens/ai/latent.npz"); ap.add_argument("--latent", default="~/skylens/ai/latent.npz")
    ap.add_argument("--web", default="~/skylens/web_data"); ap.add_argument("--gpu", type=int, default=0)
    ap.add_argument("--max-rows", type=int, default=3_000_000); ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--batch", type=int, default=4096); ap.add_argument("--min-snr", type=float, default=20.0)
    ap.add_argument("--k", type=int, default=12); ap.add_argument("--unusual", type=int, default=1500)
    a = ap.parse_args()
    {"train": cmd_train, "encode": cmd_encode, "twins": cmd_twins}[a.cmd](a)
