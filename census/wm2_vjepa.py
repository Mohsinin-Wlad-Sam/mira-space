"""A published world model on SPHEREx: Meta's V-JEPA 2 (ViT-L, 326 million weights, trained on over a million hours
of video) against MIRA's own sky model, on the same real stars.

Each example is a "little video" of one 14-arcminute patch of sky: the 2MASS picture (1999), the WISE picture (2010)
and the SPHEREx picture (2025-26), 16 frames in all. Half of the patches hold a real star that moved (Gaia-confirmed
or in MIRA's verified catalogue), half hold none. Two questions are put to V-JEPA 2, with its weights frozen:
  1. SURPRISE, with no training at all: shown 1999 and 2010, its predictor guesses what the 2025 frames will look
     like to it; is its error larger where something moved?
  2. PROBE: can one linear layer on its features tell the two kinds of patch apart? (Trained on patches from the
     training part of the sky, tested on the part kept aside.)
The same test patches are then given to MIRA's own model (census/wm2_run.py adds that line).

    python -m census.wm2_vjepa --data ~/skylens/wm2 --extract --shard 0/4 --gpu 6
    python -m census.wm2_vjepa --data ~/skylens/wm2 --probe
"""
import argparse, json, os, glob, time
import numpy as np, torch, torch.nn.functional as F

C, NT = 64, 12 * 4 ** 5
split = lambda p: 2 if p % 5 == 0 else 1 if p % 10 == 1 else 0

def clips(root, seed=3):
    """the patches: (tile, row0, col0, label, row and col of the mover inside the patch or -1, its motion)"""
    L = np.load(f"{root}/labels.npz"); P, I = L["P"], L["I"]; rng = np.random.default_rng(seed); out = []
    for t in range(NT):
        if split(t) == 1: continue
        pos = P[t][P[t][:, 0] > -1e3]; known = np.concatenate([pos[:, :2], I[t][I[t][:, 0] > -1e3]], 0)
        for q in pos:
            for _ in range(2 if split(t) == 0 else 1):
                r0 = int(np.clip(round(q[0]) - rng.integers(14, C - 14), 0, 512 - C)); c0 = int(np.clip(round(q[1]) - rng.integers(14, C - 14), 0, 512 - C))
                out.append((t, r0, c0, 1, q[0] - r0, q[1] - c0, q[4]))
                for _ in range(20):                                   # and a patch of the same tile with no known mover in or near it
                    a, b = int(rng.integers(0, 512 - C)), int(rng.integers(0, 512 - C))
                    if not len(known) or np.min(np.hypot(known[:, 0] - a - C / 2, known[:, 1] - b - C / 2)) > C * 0.9: out.append((t, a, b, 0, -1, -1, 0)); break
    return np.array(out, np.float32)

def show(v):
    """a tile crop as a picture between 0 and 1: sky level dark, stars bright (the same compression MIRA uses)"""
    f = v.flatten(1); med = f.median(1).values; sig = ((f - med[:, None]).abs().median(1).values * 1.4826).clamp_min(1.5)
    return (torch.asinh((v - med[:, None, None]) / sig[:, None, None] / 5) / 4 * 1.15 + 0.06).clamp(0, 1)

def video(tm, w2, sx, K):
    """(B, 16, 3, 256, 256), normalised as the model expects"""
    idx = lambda k: (torch.arange(C, device=tm.device)[None] + K[:, k, None]).long(); T = K[:, 0].long()[:, None, None]; iy, ix = idx(1)[:, :, None], idx(2)[:, None, :]
    fr = [F.interpolate(show(a[T, iy, ix].float())[:, None], size=256, mode="bilinear", align_corners=False)[:, 0] for a in (tm, w2, sx)]
    v = torch.stack([fr[0]] * 4 + [fr[1]] * 6 + [fr[2]] * 6, 1)[:, :, None].expand(-1, -1, 3, -1, -1)
    mean = torch.tensor([0.485, 0.456, 0.406], device=tm.device)[None, None, :, None, None]; std = torch.tensor([0.229, 0.224, 0.225], device=tm.device)[None, None, :, None, None]
    return ((v - mean) / std).half()

@torch.no_grad()
def extract(root, shard, gpu):
    from transformers import AutoModel
    k, n = (int(x) for x in shard.split("/")); dev = torch.device(f"cuda:{gpu}"); K = clips(root); mine = np.arange(len(K))[k::n]
    tm, w2, sx = (torch.from_numpy(np.load(f"{root}/{q}.npy")).to(dev) for q in ("tm", "w2", "sx"))
    m = AutoModel.from_pretrained("facebook/vjepa2-vitl-fpc64-256", dtype=torch.float16).to(dev).eval()
    per = 256; ctx = torch.arange(0, 5 * per, device=dev); tgt = torch.arange(5 * per, 8 * per, device=dev); feats, sur, smap = [], [], []; t0 = time.time()
    for i in range(0, len(mine), 16):
        kk = torch.from_numpy(K[mine[i:i + 16]]).to(dev); x = video(tm, w2, sx, kk); B = len(kk)
        o = m(pixel_values_videos=x, context_mask=[ctx[None].repeat(B, 1)], target_mask=[tgt[None].repeat(B, 1)])
        h = o.last_hidden_state.float(); e = (o.predictor_output.last_hidden_state.float() - o.predictor_output.target_hidden_state.float()).abs().mean(-1)        # (B, 768): error per token of the 2025 frames
        feats.append(torch.cat([h.mean(1), h[:, :512].mean(1), h[:, 512:1280].mean(1), h[:, 1280:].mean(1)], 1).cpu()); sur.append(e.mean(1).cpu()); smap.append(e.view(B, 3, 16, 16).mean(1).cpu())
        if i % 800 == 0: print(f"{i}/{len(mine)} {time.time() - t0:.0f}s", flush=True)
    np.savez(f"{root}/vjepa_{k}.npz", idx=mine, feats=torch.cat(feats).numpy(), sur=torch.cat(sur).numpy(), smap=torch.cat(smap).numpy()); print("saved", len(mine), flush=True)

def auc(score, y):
    o = np.argsort(score); r = np.empty(len(o)); r[o] = np.arange(1, len(o) + 1); n1 = y.sum(); n0 = len(y) - n1
    return float((r[y == 1].sum() - n1 * (n1 + 1) / 2) / max(1, n1 * n0))

def probe(root):
    K = clips(root); parts = [np.load(f) for f in sorted(glob.glob(f"{root}/vjepa_*.npz"))]; idx = np.concatenate([p["idx"] for p in parts]); X = np.concatenate([p["feats"] for p in parts]); S = np.concatenate([p["sur"] for p in parts]); M = np.concatenate([p["smap"] for p in parts])
    k = K[idx]; y = k[:, 3].astype(int); sp = np.array([split(int(t)) for t in k[:, 0]]); tr, te = sp == 0, sp == 2
    res = {"model": "V-JEPA 2 ViT-L (facebook/vjepa2-vitl-fpc64-256), frozen", "weights_millions": 326, "patches": {"train": int(tr.sum()), "test": int(te.sum()), "test_with_a_real_mover": int(y[te].sum())}}
    res["surprise_auc"] = auc(S[te], y[te])
    # where its error is largest inside a patch: is that where the star is?
    pos = te & (y == 1); am = M[pos].reshape(pos.sum(), -1).argmax(1); pr, pc = am // 16, am % 16; tr_, tc_ = k[pos, 4] / 4, k[pos, 5] / 4
    res["surprise_points_at_the_star"] = float((np.hypot(pr + 0.5 - tr_, pc + 0.5 - tc_) <= 1.5).mean()); res["chance_of_that"] = float(np.pi * 1.5 ** 2 / 256)
    dev = "cuda" if torch.cuda.is_available() else "cpu"; Xt = torch.from_numpy(X).to(dev); mu, sd = Xt[tr].mean(0), Xt[tr].std(0) + 1e-6; Xt = (Xt - mu) / sd; yt = torch.from_numpy(y).float().to(dev)
    torch.manual_seed(0); lin = torch.nn.Linear(X.shape[1], 1).to(dev); opt = torch.optim.AdamW(lin.parameters(), lr=1e-3, weight_decay=0.05); trm = torch.from_numpy(tr).to(dev)
    for ep in range(400):
        opt.zero_grad(); F.binary_cross_entropy_with_logits(lin(Xt[trm])[:, 0], yt[trm]).backward(); opt.step()
    with torch.no_grad(): sc = lin(Xt)[:, 0].cpu().numpy()
    res["probe_auc"] = auc(sc[te], y[te]); res["probe_auc_train"] = auc(sc[tr], y[tr])
    pm = k[:, 6]; res["probe_by_motion"] = [{"lo": lo, "hi": hi, "n": int(((pm >= lo) & (pm < hi) & te).sum()), "auc": auc(sc[te & ((y == 0) | ((pm >= lo) & (pm < hi)))], y[te & ((y == 0) | ((pm >= lo) & (pm < hi)))])} for lo, hi in ((0.4, 0.6), (0.6, 1.0), (1.0, 2.0), (2.0, 99))]
    np.savez(f"{root}/vjepa_test.npz", idx=idx[te], y=y[te], probe=sc[te], sur=S[te])
    json.dump(res, open(f"{root}/vjepa_result.json", "w"), indent=1); print(json.dumps(res))

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--data", required=True); ap.add_argument("--extract", action="store_true"); ap.add_argument("--probe", action="store_true"); ap.add_argument("--shard", default="0/1"); ap.add_argument("--gpu", type=int, default=0)
    a = ap.parse_args(); root = os.path.expanduser(a.data)
    if a.extract: extract(root, a.shard, a.gpu)
    if a.probe: probe(root)
