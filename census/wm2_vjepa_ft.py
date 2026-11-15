"""V-JEPA 2, fine-tuned: can Meta's published world model learn to tell a star that moved from one that did not?

The frozen model could not (census/wm2_vjepa.py: 0.58 where 0.5 is chance). Here its weights are allowed to change:
each example is a little video of one star (the 2MASS, WISE and SPHEREx pictures of a 5-arcminute patch, enlarged ten
times), a real mover or a still star of similar brightness from the same tile. Trained on the training part of the
sky, a tenth of it kept aside to choose the best epoch, tested on the fifth of the sky never trained on.

    python -m census.wm2_vjepa_ft --data ~/skylens/wm2 --gpu 6 --lr 2e-5 --tag a
"""
import argparse, json, os, time
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
from census.wm2_vjepa import clips_zoom, show, split, Z, auc

def video(tm, w2, sx, K, reps, flip):
    dev = tm.device; idx = lambda k: (torch.arange(Z, device=dev)[None] + K[:, k, None]).long(); T = K[:, 0].long()[:, None, None]; iy, ix = idx(1)[:, :, None], idx(2)[:, None, :]
    fr = [show(a[T, iy, ix].float()) for a in (tm, w2, sx)]
    if flip & 1: fr = [f.flip(1) for f in fr]
    if flip & 2: fr = [f.flip(2) for f in fr]
    if flip & 4: fr = [f.transpose(1, 2) for f in fr]
    fr = [F.interpolate(f[:, None], size=256, mode="bilinear", align_corners=False)[:, 0] for f in fr]
    v = torch.stack([fr[0]] * reps + [fr[1]] * reps + [fr[2]] * reps, 1)[:, :, None].expand(-1, -1, 3, -1, -1)
    mean = torch.tensor([0.485, 0.456, 0.406], device=dev)[None, None, :, None, None]; std = torch.tensor([0.229, 0.224, 0.225], device=dev)[None, None, :, None, None]
    return (v - mean) / std

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--data", required=True); ap.add_argument("--gpu", type=int, default=0); ap.add_argument("--lr", type=float, default=2e-5); ap.add_argument("--epochs", type=int, default=6); ap.add_argument("--reps", type=int, default=2); ap.add_argument("--batch", type=int, default=24); ap.add_argument("--tag", default="a")
    a = ap.parse_args(); root = os.path.expanduser(a.data); dev = torch.device(f"cuda:{a.gpu}"); torch.manual_seed(0)
    from transformers import AutoModel
    K = clips_zoom(root); sp = np.array([split(int(t)) for t in K[:, 0]]); tr_all = np.nonzero(sp == 0)[0]; te = np.nonzero(sp == 2)[0]; rng = np.random.default_rng(0)
    hold = np.isin(K[tr_all, 0].astype(int) % 7, [3]); va = tr_all[hold]; tr = tr_all[~hold]
    tm, w2, sx = (torch.from_numpy(np.load(f"{root}/{q}.npy")).to(dev) for q in ("tm", "w2", "sx"))
    m = AutoModel.from_pretrained("facebook/vjepa2-vitl-fpc64-256").to(dev); head = nn.Sequential(nn.LayerNorm(1024), nn.Linear(1024, 1)).to(dev)
    opt = torch.optim.AdamW([{"params": m.parameters(), "lr": a.lr}, {"params": head.parameters(), "lr": 1e-3}], weight_decay=0.05); steps = a.epochs * (len(tr) // a.batch); sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=[a.lr, 1e-3], total_steps=steps, pct_start=0.1)
    def score(ids):
        m.eval(); out = []
        with torch.no_grad():
            for i in range(0, len(ids), 48):
                kk = torch.from_numpy(K[ids[i:i + 48]]).to(dev)
                with torch.autocast("cuda", dtype=torch.bfloat16): h = m(pixel_values_videos=video(tm, w2, sx, kk, a.reps, 0), skip_predictor=True).last_hidden_state
                out.append(head(h.float().mean(1))[:, 0].cpu())
        return torch.cat(out).numpy()
    log = []; best = (-1, None); t0 = time.time(); step = 0
    for ep in range(a.epochs):
        m.train(); perm = rng.permutation(tr)
        for i in range(0, len(perm) - a.batch + 1, a.batch):
            kk = torch.from_numpy(K[perm[i:i + a.batch]]).to(dev); y = kk[:, 3]
            with torch.autocast("cuda", dtype=torch.bfloat16): h = m(pixel_values_videos=video(tm, w2, sx, kk, a.reps, int(rng.integers(0, 8))), skip_predictor=True).last_hidden_state
            loss = F.binary_cross_entropy_with_logits(head(h.float().mean(1))[:, 0], y)
            opt.zero_grad(set_to_none=True); loss.backward(); nn.utils.clip_grad_norm_(m.parameters(), 1.0); opt.step(); sched.step(); step += 1
            if step % 50 == 0: print(f"epoch {ep} step {step}/{steps} loss {loss.item():.3f} {time.time() - t0:.0f}s", flush=True)
        av = auc(score(va), K[va, 3].astype(int)); st = score(te); at = auc(st, K[te, 3].astype(int)); log.append({"epoch": ep + 1, "auc_held_out_training_sky": av, "auc_test": at, "seconds": round(time.time() - t0)})
        print(json.dumps(log[-1]), flush=True)
        if av > best[0]: best = (av, {"epoch": ep + 1, "auc_test": at, "scores": st})
    pm = K[te, 6]; y = K[te, 3].astype(int); sc = best[1]["scores"]
    res = {"model": "V-JEPA 2 ViT-L, fine-tuned", "lr": a.lr, "frames_per_picture": a.reps, "patches": {"train": int(len(tr)), "choose_epoch": int(len(va)), "test": int(len(te))}, "epochs": log, "chosen_epoch": best[1]["epoch"], "auc_test": best[1]["auc_test"],
           "by_motion": [{"lo": lo, "hi": hi, "n": int(((pm >= lo) & (pm < hi)).sum()), "auc": auc(sc[(y == 0) | ((pm >= lo) & (pm < hi))], y[(y == 0) | ((pm >= lo) & (pm < hi))])} for lo, hi in ((0.4, 0.6), (0.6, 1.0), (1.0, 2.0), (2.0, 99))], "minutes": round((time.time() - t0) / 60, 1)}
    np.savez(f"{root}/vjft_{a.tag}_test.npz", idx=te, y=y, score=sc); json.dump(res, open(f"{root}/vjft_{a.tag}.json", "w"), indent=1); print("RESULT", json.dumps(res), flush=True)

if __name__ == "__main__":
    main()
