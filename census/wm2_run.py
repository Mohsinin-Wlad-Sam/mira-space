"""The scout at work: the trained sky model looks at the whole sky (three pictures of each of 12,288 tiles) and
writes what the platform shows.

  scout.json   the test figures (on the fifth of the sky kept aside), the comparison with V-JEPA 2 on the same
               patches, for every confirmed mover of MIRA's catalogue whether the model marks it too and the motion it
               reads, and the places it marks where the catalogue has nothing (unverified: for the Lab to measure)

Several trained copies (different sizes and starting points) are averaged; a mark needs their average above the
threshold chosen on the threshold tiles.

    python -m census.wm2_run --data ~/skylens/wm2 --runs ~/skylens/wm2/run_c48_s1,... --objects ~/skylens/web_data/verified/objects.json --out ~/skylens/web_data/wm --gpu 0
"""
import argparse, json, math, os, time
import numpy as np, torch
from census.wm_data import tile_rc
from census.wm2_train import UNet2, NT, PIX, GAP, VS, ORDER, split, norm, peaks, evaluate

JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]; JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7]

def tile_sky(tile, row, col):
    """sky position (degrees) of a pixel of an order-5 tile: the inverse of wm_data.tile_rc"""
    tile = np.asarray(tile, np.int64); face = tile >> 10; rem = tile & 1023; tx = np.zeros_like(tile); ty = np.zeros_like(tile)
    for b in range(5): tx |= ((rem >> (2 * b)) & 1) << b; ty |= ((rem >> (2 * b + 1)) & 1) << b
    x = (tx * 512 + np.asarray(row, float) + 0.5) / 16384; y = (ty * 512 + np.asarray(col, float) + 0.5) / 16384
    jr = np.array(JRLL)[face] - x - y; nr = np.where(jr < 1, jr, np.where(jr > 3, 4 - jr, 1.0)); z = np.where(jr < 1, 1 - nr * nr / 3, np.where(jr > 3, nr * nr / 3 - 1, (2 - jr) * 2 / 3))
    t = np.array(JPLL)[face] * nr + x - y; t = np.where(t < 0, t + 8, t); t = np.where(t >= 8, t - 8, t)
    return np.degrees(np.pi / 4 * t / np.maximum(nr, 1e-12)), np.degrees(np.arcsin(np.clip(z, -1, 1)))

def gal(ra, dec):
    A = np.array([[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132], [0.4941094278755837, -0.4448296299600112, 0.7469822444972189], [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]])
    a, d = np.radians(ra), np.radians(dec); g = A @ np.stack([np.cos(d) * np.cos(a), np.cos(d) * np.sin(a), np.sin(d)]); return np.degrees(np.arctan2(g[1], g[0])) % 360, np.degrees(np.arcsin(g[2]))

def auc(score, y):
    o = np.argsort(score); r = np.empty(len(o)); r[o] = np.arange(1, len(o) + 1); n1 = y.sum(); n0 = len(y) - n1; return float((r[y == 1].sum() - n1 * (n1 + 1) / 2) / max(1, n1 * n0))

@torch.no_grad()
def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--data", required=True); ap.add_argument("--runs", required=True); ap.add_argument("--objects", required=True); ap.add_argument("--out", required=True); ap.add_argument("--gpu", type=int, default=0); ap.add_argument("--maxfalse", type=float, default=0.03)
    a = ap.parse_args(); root = os.path.expanduser(a.data); out = os.path.expanduser(a.out); os.makedirs(out, exist_ok=True); dev = torch.device(f"cuda:{a.gpu}"); t0 = time.time()
    # the round trip pixel -> sky -> pixel must close
    rng = np.random.default_rng(1); tt = rng.integers(0, NT, 2000); rr = rng.uniform(0, 511, 2000); cc = rng.uniform(0, 511, 2000); ra, dec = tile_sky(tt, rr, cc); t2, r2, c2 = tile_rc(ra, dec, ORDER)
    assert (t2 == tt).mean() > 0.995 and np.median(np.hypot(r2 - rr, c2 - cc)) < 0.08, "tile <-> sky conversion does not close"
    import re
    runs = [os.path.expanduser(r) for r in a.runs.split(",") if r]; res = []; nets = []
    for r in runs:      # a copy whose own evaluation did not finish still has its trained weights: its size is in its folder's name
        base = int(re.search(r"_c(\d+)_", r).group(1)); n = UNet2(base).to(dev).to(memory_format=torch.channels_last); n.load_state_dict(torch.load(f"{r}/net.pt", map_location=dev)); n.eval(); nets.append(n)
        q = json.load(open(f"{r}/result.json")) if os.path.exists(f"{r}/result.json") else {}; steps = q.get("steps")
        if steps is None:
            m = re.findall(r"^step (\d+) ", open(f"{r}/train.log").read(), re.M); steps = int(m[-1]) if m else 0
        res.append({"base": base, "params": sum(p.numel() for p in n.parameters()), "minutes": q.get("minutes", 30.0), "steps": steps, "tiles": q.get("tiles")})
    L = np.load(f"{root}/labels.npz"); D = tuple(torch.from_numpy(np.load(f"{root}/{n}.npy")).to(dev) for n in ("tm", "w2", "sx")) + (torch.from_numpy(L["P"]).to(dev), torch.from_numpy(L["I"]).to(dev))
    def maps(ids, seen=1.0):
        tm, w2, sx = D[:3]; H = []; V = []
        for i in range(0, len(ids), 8):
            t = ids[i:i + 8]; a_, b_, c_ = tm[t].float(), w2[t].float(), sx[t].float(); valid = (c_ > 0).float(); z1, _, _ = norm(a_); z2, _, _ = norm(b_); z3, _, _ = norm(c_, valid)
            x = torch.stack([z1, z2, z3 * seen, torch.full_like(z1, seen)], 1).contiguous(memory_format=torch.channels_last); h = 0; v = 0
            for n in nets:
                with torch.autocast("cuda", dtype=torch.bfloat16): o = n(x).float()
                h = h + torch.sigmoid(o[:, 1]) / len(nets); v = v + o[:, 2:4] / len(nets)
            H.append(h.half()); V.append(v.half())
        return torch.cat(H), torch.cat(V)
    sp = np.array([split(p) for p in range(NT)]); okt = (D[1].flatten(1).float().mean(1) > 0).cpu().numpy(); va = torch.from_numpy(np.nonzero((sp == 1) & okt)[0]).to(dev); te = torch.from_numpy(np.nonzero((sp == 2) & okt)[0]).to(dev)
    Hv, Vv = maps(va); table = [evaluate(Hv, Vv, va, D, thr) for thr in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.88, 0.94)]; del Hv, Vv
    good = [r for r in table if r["false_per_sqdeg"] <= a.maxfalse] or [table[-1]]; thr = max(good, key=lambda r: r["recall"])["thr"]
    Ht, Vt = maps(te); test = evaluate(Ht, Vt, te, D, thr); Hf, Vf = maps(te, 0.0); fore = evaluate(Hf, Vf, te, D, thr); del Hf, Vf
    print("threshold", thr, "test", json.dumps(test), flush=True); print("forecast", json.dumps(fore), flush=True)
    # --- the same test patches V-JEPA 2 was given: our score for a patch is the strongest mark inside it
    cmp = None
    for tag, C in (("vjepa", 64), ("vjz", 24)):
        f = f"{root}/{tag}_test.npz"
        if not os.path.exists(f): continue
        from census import wm2_vjepa
        K = (wm2_vjepa.clips_zoom if tag == "vjz" else wm2_vjepa.clips)(root); V2 = np.load(f); k = K[V2["idx"]]; pos = {int(t): i for i, t in enumerate(te.tolist())}; ours = np.zeros(len(k))
        for j, q in enumerate(k):
            i = pos.get(int(q[0])); r0, c0 = int(q[1]), int(q[2])
            if i is not None: ours[j] = float(Ht[i, max(0, r0):r0 + C, max(0, c0):c0 + C].float().max())
        vj = json.load(open(f"{root}/{tag}_result.json")); cmp = cmp or {}
        cmp[tag] = {"what": vj.get("test"), "patches": int(len(k)), "with_a_real_mover": int(V2["y"].sum()), "vjepa2_probe_auc": vj["probe_auc"], "vjepa2_surprise_auc": vj["surprise_auc"], "mira_auc": auc(ours, V2["y"])}
        print("comparison", tag, json.dumps(cmp[tag]), flush=True)
    del Ht, Vt
    # --- the whole sky
    S = np.load(f"{root}/stars.npz"); c = json.load(open(os.path.expanduser(a.objects)))["cols"]; n_obj = len(c["id"]); assert len(S["ra"]) == n_obj, "the examples were not built from the catalogue alone"
    heat_o = np.zeros(n_obj, np.float32); pm_o = np.zeros(n_obj, np.float32); by_tile = {}
    for k in np.nonzero(S["same"])[0]: by_tile.setdefault(int(S["tile"][k]), []).append(k)
    marks = []; ids = np.nonzero(okt)[0]
    for i in range(0, len(ids), 256):
        chunk = torch.from_numpy(ids[i:i + 256]).to(dev); H, V = maps(chunk)
        for j, t in enumerate(chunk.tolist()):
            h = H[j].float()
            for k in by_tile.get(t, []):
                y, x = int(round(float(S["r3"][k]))), int(round(float(S["c3"][k])))
                if 2 <= y < 510 and 2 <= x < 510:
                    w = h[y - 2:y + 3, x - 2:x + 3]; heat_o[k] = float(w.max()); q = int(w.argmax()); vv = V[j, :, y - 2 + q // 5, x - 2 + q % 5].float() * VS; pm_o[k] = float(vv.norm()) * PIX / GAP
            ys, xs = peaks(h, thr)
            for y, x in zip(ys.tolist(), xs.tolist()):
                if not (6 <= y < 506 and 6 <= x < 506): continue
                vv = (V[j, :, y, x].float() * VS).tolist(); marks.append((t, y, x, float(h[y, x]), vv[0], vv[1]))
        if i % 2048 == 0: print(f"sky {i}/{len(ids)} tiles, {len(marks)} marks, {time.time() - t0:.0f}s", flush=True)
    M = np.array(marks, np.float64).reshape(-1, 6); ra, dec = tile_sky(M[:, 0], M[:, 1], M[:, 2]); ra0, dec0 = tile_sky(M[:, 0], M[:, 1] - M[:, 4], M[:, 2] - M[:, 5]); gl, gb = gal(ra, dec)
    pm = np.hypot(M[:, 4], M[:, 5]) * PIX / GAP; pa = (np.degrees(np.arctan2((ra - ra0) * np.cos(np.radians(dec)), dec - dec0)) + 360) % 360
    # which marks are stars the catalogue already has (any of its 17,604, slow ones included)
    known = np.zeros(len(M), bool); tiles_m = M[:, 0].astype(int)
    for j in range(len(M)):
        ks = by_tile.get(int(tiles_m[j]), [])
        if ks: known[j] = np.min(np.hypot(S["r3"][ks] - M[j, 1], S["c3"][ks] - M[j, 2])) <= 3.5
    plane = np.abs(gb) < 10; new = ~known & ~plane; order = np.argsort(-M[:, 3])
    cand = [{"ra": round(float(ra[j]), 5), "dec": round(float(dec[j]), 5), "conf": round(float(M[j, 3]), 3), "pm": round(float(pm[j]), 2), "pa": round(float(pa[j])), "glat": round(float(gb[j]), 1)} for j in order if new[j]][:400]
    fast = np.array([(c["pm"][k] or 0) for k in range(n_obj)]); vis = S["vis"] & S["same"]
    summ = lambda lo, hi: {"lo": lo, "hi": hi, "n": int(((fast >= lo) & (fast < hi) & vis).sum()), "marked": int(((fast >= lo) & (fast < hi) & vis & (heat_o >= thr)).sum())}
    scout = {"name": "MIRA sky model, scout", "built": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), "copies": [{"weights_millions": round(q["params"] / 1e6, 1), "minutes": q["minutes"], "steps": q["steps"]} for q in res],
             "pictures": "2MASS 2.2 um (1999), WISE 4.6 um (2010), SPHEREx 4.5-4.7 um (2025-26); 12,288 order-5 HiPS tiles of 12.9 arcsec pixels from NASA/IPAC IRSA", "tiles": next((q["tiles"] for q in res if q.get("tiles")), None), "threshold": thr, "threshold_table": table,
             "test": test, "test_forecast": fore, "comparison": cmp,
             "sky": {"tiles": int(len(ids)), "marks": int(len(M)), "marks_on_catalogue_stars": int(known.sum()), "marks_in_the_galactic_plane": int((plane & ~known).sum()), "marks_elsewhere": int(new.sum())},
             "catalogue": {"n": n_obj, "by_motion": [summ(0.15, 0.25), summ(0.25, 0.4), summ(0.4, 0.6), summ(0.6, 1.0), summ(1.0, 2.0), summ(2.0, 99)]},
             "objects": {"id": c["id"], "conf": [round(float(v), 2) for v in heat_o], "pm": [round(float(v), 2) for v in pm_o]}, "marks": cand,
             "note": "Marks away from catalogue stars are unverified: many will be stars Gaia knows that MIRA's catalogue does not hold, or artefacts. The Lab measures a place; the model only points at it."}
    json.dump(scout, open(f"{out}/scout.json", "w")); print("sky", json.dumps(scout["sky"]), "catalogue", json.dumps(scout["catalogue"]["by_motion"]), f"{time.time() - t0:.0f}s", flush=True)

if __name__ == "__main__":
    main()
