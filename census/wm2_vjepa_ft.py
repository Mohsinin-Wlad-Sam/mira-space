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

def video(tm, w2, sx, K, reps, flip, dev):
    # the pictures stay in memory-mapped files: only the small patches go to the GPU, which the model needs for itself
    cut = lambda a: torch.from_numpy(np.stack([np.asarray(a[int(t), int(r):int(r) + Z, int(c):int(c) + Z]) for t, r, c in K[:, :3]])).to(dev).float()
    fr = [show(cut(a)) for a in (tm, w2, sx)]
    if flip & 1: fr = [f.flip(1) for f in fr]
    if flip & 2: fr = [f.flip(2) for f in fr]
    if flip & 4: fr = [f.transpose(1, 2) for f in fr]
    fr = [F.interpolate(f[:, None], size=256, mode="bilinear", align_corners=False)[:, 0] for f in fr]
    v = torch.stack([fr[0]] * reps + [fr[1]] * reps + [fr[2]] * reps, 1)[:, :, None].expand(-1, -1, 3, -1, -1)
    mean = torch.tensor([0.485, 0.456, 0.406], device=dev)[None, None, :, None, None]; std = torch.tensor([0.229, 0.224, 0.225], device=dev)[None, None, :, None, None]
    return (v - mean) / std

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--data", required=True); ap.add_argument("--gpu", type=int, default=0); ap.add_argument("--lr", type=float, default=2e-5); ap.add_argument("--epochs", type=int, default=6); ap.add_argument("--reps", type=int, default=2); ap.add_argument("--batch", type=int, default=16); ap.add_argument("--tag", default="a"); ap.add_argument("--marks", default="")
    a = ap.parse_args(); root = os.path.expanduser(a.data); dev = torch.device(f"cuda:{a.gpu}"); torch.manual_seed(0)
    from transformers import AutoModel
    K = clips_zoom(root); sp = np.array([split(int(t)) for t in K[:, 0]]); tr_all = np.nonzero(sp == 0)[0]; te = np.nonzero(sp == 2)[0]; rng = np.random.default_rng(0)
    hold = np.isin(K[tr_all, 0].astype(int) % 7, [3]); va = tr_all[hold]; tr = tr_all[~hold]
    tm, w2, sx = (np.load(f"{root}/{q}.npy", mmap_mode="r") for q in ("tm", "w2", "sx"))
    m = AutoModel.from_pretrained("facebook/vjepa2-vitl-fpc64-256").to(dev); head = nn.Sequential(nn.LayerNorm(1024), nn.Linear(1024, 1)).to(dev)
    opt = torch.optim.AdamW([{"params": m.parameters(), "lr": a.lr}, {"params": head.parameters(), "lr": 1e-3}], weight_decay=0.05); steps = a.epochs * (len(tr) // a.batch); sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=[a.lr, 1e-3], total_steps=steps, pct_start=0.1)
    def score(ids):
        m.eval(); out = []
        with torch.no_grad():
            for i in range(0, len(ids), 48):
                kk = K[ids[i:i + 48]]
                with torch.autocast("cuda", dtype=torch.bfloat16): h = m(pixel_values_videos=video(tm, w2, sx, kk, a.reps, 0, dev), skip_predictor=True).last_hidden_state
                out.append(head(h.float().mean(1))[:, 0].cpu())
        return torch.cat(out).numpy()
    log = []; best = (-1, None); t0 = time.time(); step = 0
    for ep in range(a.epochs):
        m.train(); perm = rng.permutation(tr)
        for i in range(0, len(perm) - a.batch + 1, a.batch):
            kk = K[perm[i:i + a.batch]]; y = torch.from_numpy(kk[:, 3]).to(dev)
            with torch.autocast("cuda", dtype=torch.bfloat16): h = m(pixel_values_videos=video(tm, w2, sx, kk, a.reps, int(rng.integers(0, 8)), dev), skip_predictor=True).last_hidden_state
            loss = F.binary_cross_entropy_with_logits(head(h.float().mean(1))[:, 0], y)
            opt.zero_grad(set_to_none=True); loss.backward(); nn.utils.clip_grad_norm_(m.parameters(), 1.0); opt.step(); sched.step(); step += 1
            if step % 50 == 0: print(f"epoch {ep} step {step}/{steps} loss {loss.item():.3f} {time.time() - t0:.0f}s", flush=True)
        av = auc(score(va), K[va, 3].astype(int)); st = score(te); at = auc(st, K[te, 3].astype(int)); log.append({"epoch": ep + 1, "auc_held_out_training_sky": av, "auc_test": at, "seconds": round(time.time() - t0)})
        print(json.dumps(log[-1]), flush=True)
        if av > best[0]: best = (av, {"epoch": ep + 1, "auc_test": at, "scores": st})
    pm = K[te, 6]; y = K[te, 3].astype(int); sc = best[1]["scores"]
    res = {"model": "V-JEPA 2 ViT-L, fine-tuned", "lr": a.lr, "frames_per_picture": a.reps, "patches": {"train": int(len(tr)), "choose_epoch": int(len(va)), "test": int(len(te))}, "epochs": log, "chosen_epoch": best[1]["epoch"], "auc_test": best[1]["auc_test"],
           "by_motion": [{"lo": lo, "hi": hi, "n": int(((pm >= lo) & (pm < hi)).sum()), "auc": auc(sc[(y == 0) | ((pm >= lo) & (pm < hi))], y[(y == 0) | ((pm >= lo) & (pm < hi))])} for lo, hi in ((0.4, 0.6), (0.6, 1.0), (1.0, 2.0), (2.0, 99))], "minutes": round((time.time() - t0) / 60, 1)}
    # a second opinion on the places MIRA's own model marked where the catalogue has nothing (census/wm2_run.py): none of them was an example
    mk = os.path.expanduser(a.marks)
    if mk:
        for _ in range(90):
            if os.path.exists(mk): break
            time.sleep(20)
        if os.path.exists(mk):
            from census.wm_data import tile_rc
            M = json.load(open(mk))["marks"]; t, r, c = tile_rc(np.array([q["ra"] for q in M]), np.array([q["dec"] for q in M]), 5)
            KM = np.stack([t, np.clip(np.round(r) - Z // 2, 0, 512 - Z), np.clip(np.round(c) - Z // 2, 0, 512 - Z), np.zeros(len(M)), np.zeros(len(M)), np.zeros(len(M)), np.zeros(len(M))], 1).astype(np.float32)
            K_all = K; K = KM; sm = score(np.arange(len(KM))); K = K_all
            json.dump({"scores": [round(float(1 / (1 + np.exp(-v))), 3) for v in sm], "auc_test": res["auc_test"]}, open(f"{root}/vjft_{a.tag}_marks.json", "w")); print("marks scored", len(M), flush=True)
    np.savez(f"{root}/vjft_{a.tag}_test.npz", idx=te, y=y, score=sc); json.dump(res, open(f"{root}/vjft_{a.tag}.json", "w"), indent=1); print("RESULT", json.dumps(res), flush=True)

if __name__ == "__main__":
    main()
