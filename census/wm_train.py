"""MIRA's sky world model: a small network that is shown two real pictures of the same patch of sky taken about
eleven years apart (2MASS 2.2 um ~1999, WISE 4.6 um 2010) and learns to draw a later one.

What it has to learn for that is the one law this part of the sky obeys on human time scales: a star keeps the motion
it has. The training pictures are real (census/wm_data.py); because fast-moving stars are rare, artificial ones are
painted into both pictures with the right displacement, and the picture to predict carries them further along the same
line. Besides the predicted picture the network gives a map of what it thinks is moving and the motion it reads off.

It is tested on real stars only: the fast movers of MIRA's verified catalogue (Gaia-confirmed), whose tiles were never
used in training and into which nothing is painted. The numbers written to model.json are from that test.

The weights are exported as plain float32 so that web/src/blink/worldmodel.ts can run the network in the browser.

    python -m census.wm_train --data ~/skylens/wm --out ~/skylens/wm/run_c24 --base 24 --minutes 30 --gpu 0
"""
import argparse, json, math, os, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
from PIL import Image
from astropy.io import fits
from scipy.ndimage import convolve1d
from census.wm_data import tile_rc

S, VSCALE, PIX, GAP = 64, 8.0, 6.44, 11.0          # crop size (px), velocity unit (px per gap), pixel (arcsec), 2MASS->WISE gap (yr)
T1, T2 = 1999.5, 2010.5

def load_tm(path):
    a = np.asarray(Image.open(path).convert("L"), dtype=np.float32)
    a = np.power(1001.0, a / 255.0) - 1.0                                   # undo the archive's logarithmic stretch, as the Lab does
    k = np.array([1, 2, 1], np.float32) / 4
    return convolve1d(convolve1d(a, k, axis=0, mode="nearest"), k, axis=1, mode="nearest").astype(np.float32)

def load_w2(path):
    a = np.flipud(fits.getdata(path).astype(np.float32))                    # FITS rows run from the bottom: bring to the JPEG orientation
    m = np.nanmedian(a); return np.where(np.isfinite(a), a, m).astype(np.float32)

def load_set(root, ids, threads=24):
    def one(p):
        try: return p, load_tm(f"{root}/tm/{p}.jpg"), load_w2(f"{root}/w2/{p}.fits")
        except Exception: return p, None, None
    with ThreadPoolExecutor(threads) as ex: R = list(ex.map(one, ids))
    R = [r for r in R if r[1] is not None and r[1].shape == (512, 512) and r[2].shape == (512, 512)]
    return [r[0] for r in R], np.stack([r[1] for r in R]), np.stack([r[2] for r in R])

def norm_t(x, med=None, sig=None):
    """sky level to 0, noise to 1, bright stars compressed: the same arithmetic as norm() in worldmodel.ts"""
    f = x.flatten(1)
    if med is None:
        med = f.median(1).values; sig = (f - med[:, None]).abs().median(1).values * 1.4826
    sig = sig.clamp_min(1e-9)
    return torch.asinh((x - med[:, None, None]) / sig[:, None, None] / 5) / 4, med, sig

class UNet(nn.Module):
    def __init__(s, c=24):
        super().__init__()
        blk = lambda i, o: nn.ModuleList([nn.Conv2d(i, o, 3, padding=1), nn.Conv2d(o, o, 3, padding=1)])
        s.e1, s.e2, s.e3, s.b = blk(3, c), blk(c, 2 * c), blk(2 * c, 4 * c), blk(4 * c, 4 * c)
        s.d3, s.d2, s.d1 = blk(8 * c, 4 * c), blk(6 * c, 2 * c), blk(3 * c, c)
        s.out = nn.Conv2d(c, 4, 3, padding=1)
    @staticmethod
    def run(b, x): return F.relu(b[1](F.relu(b[0](x))))
    def forward(s, x):
        up = lambda t: F.interpolate(t, scale_factor=2, mode="nearest")
        e1 = s.run(s.e1, x); e2 = s.run(s.e2, F.max_pool2d(e1, 2)); e3 = s.run(s.e3, F.max_pool2d(e2, 2)); b = s.run(s.b, F.max_pool2d(e3, 2))
        d3 = s.run(s.d3, torch.cat([up(b), e3], 1)); d2 = s.run(s.d2, torch.cat([up(d3), e2], 1)); d1 = s.run(s.d1, torch.cat([up(d2), e1], 1))
        return s.out(d1)
    def named(s):
        return [("e1a", s.e1[0]), ("e1b", s.e1[1]), ("e2a", s.e2[0]), ("e2b", s.e2[1]), ("e3a", s.e3[0]), ("e3b", s.e3[1]), ("ba", s.b[0]), ("bb", s.b[1]),
                ("d3a", s.d3[0]), ("d3b", s.d3[1]), ("d2a", s.d2[0]), ("d2b", s.d2[1]), ("d1a", s.d1[0]), ("d1b", s.d1[1]), ("out", s.out)]

def blobs(pos, amp, sig, dev):
    """sum over sources of amp * Gaussian centred on pos (x, y), on an S x S grid: (B, S, S). pos (B,K,2), amp (B,K), sig (B,K)"""
    g = torch.arange(S, device=dev, dtype=torch.float32)
    dx = g[None, None, None, :] - pos[:, :, 0, None, None]; dy = g[None, None, :, None] - pos[:, :, 1, None, None]
    return (amp[:, :, None, None] * torch.exp(-(dx * dx + dy * dy) / (2 * sig[:, :, None, None] ** 2))).sum(1)

def make_batch(B, tm, w2, st, dev, gen):
    T = tm.shape[0]; K = 3
    ti = torch.randint(0, T, (B,), device=dev, generator=gen); y0 = torch.randint(0, 512 - S + 1, (B,), device=dev, generator=gen); x0 = torch.randint(0, 512 - S + 1, (B,), device=dev, generator=gen)
    ar = torch.arange(S, device=dev); iy = (y0[:, None] + ar)[:, :, None]; ix = (x0[:, None] + ar)[:, None, :]
    a = tm[ti[:, None, None], iy, ix].float(); b = w2[ti[:, None, None], iy, ix].float()
    k = int(torch.randint(0, 8, (1,), generator=gen, device=dev))             # one of the eight flips / rotations per batch
    if k & 1: a, b = a.flip(1), b.flip(1)
    if k & 2: a, b = a.flip(2), b.flip(2)
    if k & 4: a, b = a.transpose(1, 2), b.transpose(1, 2)
    r = lambda *s: torch.rand(*s, device=dev, generator=gen)
    _, mb, sb = norm_t(b)
    same = r(B) < 0.15                                                        # some pairs are two WISE-like pictures (a later survey of the same kind)
    a = torch.where(same[:, None, None], b + 0.8 * sb[:, None, None] * torch.randn(B, S, S, device=dev, generator=gen), a)
    _, ma, sa = norm_t(a)
    # --- artificial movers
    nk = torch.multinomial(torch.tensor([0.22, 0.46, 0.22, 0.10], device=dev), B, replacement=True, generator=gen)
    act = torch.arange(K, device=dev)[None] < nk[:, None]
    p2 = 4 + r(B, K, 2) * (S - 8); ok = torch.zeros(B, K, dtype=torch.bool, device=dev); v = torch.zeros(B, K, 2, device=dev)
    for _ in range(5):                                                        # speed 0.25 to 14 px per gap (0.15 to 8 arcsec per year), any direction, old position inside the picture
        sp = torch.exp(math.log(0.25) + r(B, K) * (math.log(14) - math.log(0.25))); th = r(B, K) * 2 * math.pi
        cand = torch.stack([sp * torch.cos(th), sp * torch.sin(th)], -1); p1c = p2 - cand
        good = ((p1c > 1.5) & (p1c < S - 2.5)).all(-1) & ~ok
        v = torch.where(good[..., None], cand, v); ok |= good
    snr2 = torch.exp(math.log(8) + r(B, K) * (math.log(3000) - math.log(8)))
    col = torch.where(same[:, None], 0.08 * torch.randn(B, K, device=dev, generator=gen), st["cmu"] + st["csd"] * torch.randn(B, K, device=dev, generator=gen))
    snr1 = snr2 * 10 ** col; act &= ok & (snr1 >= 6)
    s1 = torch.where(same[:, None], torch.full((B, K), st["psf2"], device=dev), torch.full((B, K), st["psf1"], device=dev)) * (0.85 + 0.3 * r(B, K)); s2 = st["psf2"] * (0.85 + 0.3 * r(B, K))
    A1 = snr1 * sa[:, None] * act; A2 = snr2 * sb[:, None] * act
    tau = 0.3 + r(B) * 4.2; p1 = p2 - v; p3 = p2 + tau[:, None, None] * v
    f1 = a + blobs(p1, A1, s1, dev); f1 = torch.where(same[:, None, None], f1, f1.clamp_max(1000.0)); f2 = b + blobs(p2, A2, s2, dev); tg = b + blobs(p3, A2, s2, dev)
    z1, _, _ = norm_t(f1); z2, m2, sg2 = norm_t(f2); zt, _, _ = norm_t(tg, m2, sg2)
    one = act.float(); u = torch.ones(B, K, device=dev)
    heat = (one[:, :, None, None] * torch.exp(-((torch.arange(S, device=dev)[None, None, None, :] - p2[:, :, 0, None, None]) ** 2 + (torch.arange(S, device=dev)[None, None, :, None] - p2[:, :, 1, None, None]) ** 2) / 2)).amax(1)
    near = blobs(p2, one, 1.5 * u, dev) + blobs(p3, one, 1.5 * u, dev)
    # the motion to read off around each mover (px per gap, in units of VSCALE)
    g = torch.arange(S, device=dev, dtype=torch.float32)
    wk = one[:, :, None, None] * torch.exp(-((g[None, None, None, :] - p2[:, :, 0, None, None]) ** 2 + (g[None, None, :, None] - p2[:, :, 1, None, None]) ** 2) / 2)      # (B,K,S,S)
    vt = (wk[:, :, None] * v[:, :, :, None, None]).sum(1) / wk.sum(1, keepdim=True).clamp_min(1e-6) / VSCALE; vm = (wk.amax(1) > 0.3).float()
    x = torch.stack([z1, z2, (tau / 4)[:, None, None].expand(B, S, S)], 1)
    return x, z2, zt, heat, near, vt, vm

def peaks(h, thr=0.5):
    """local maxima of a (S, S) map above thr: list of (x, y, value)"""
    m = F.max_pool2d(h[None, None], 5, 1, 2)[0, 0]; ys, xs = torch.nonzero((h >= thr) & (h >= m), as_tuple=True)
    return [(int(x), int(y), float(h[y, x])) for x, y in zip(xs, ys)]

@torch.no_grad()
def test_real(net, root, dev, log):
    """real fast movers, real pictures, nothing painted in"""
    mv = json.load(open(f"{root}/test/movers.json")); ids = sorted({m["tile"] for m in mv})
    ids, tm, w2 = load_set(f"{root}/test", ids); at = {p: k for k, p in enumerate(ids)}
    rows = []; fp = 0; fields = 0
    for m in mv:
        if m["tile"] not in at: continue
        pos = []
        for t in (T1, T2):
            dt = t - m["yr"]; ra = m["ra"] + m["pmra"] * dt / 3600 / math.cos(math.radians(m["dec"])); dec = m["dec"] + m["pmdec"] * dt / 3600
            tl, rr, cc = tile_rc(np.array([ra]), np.array([dec])); pos.append((int(tl[0]), float(rr[0]), float(cc[0])))
        if pos[0][0] != m["tile"] or pos[1][0] != m["tile"]: continue
        (_, r1, c1), (_, r2, c2) = pos
        y0 = int(min(448, max(0, round(r2) - 32))); x0 = int(min(448, max(0, round(c2) - 32)))
        if not (3 < r2 - y0 < S - 4 and 3 < c2 - x0 < S - 4 and 1 < r1 - y0 < S - 2 and 1 < c1 - x0 < S - 2): continue
        k = at[m["tile"]]; a = torch.from_numpy(tm[k, y0:y0 + S, x0:x0 + S].copy()).to(dev)[None]; b = torch.from_numpy(w2[k, y0:y0 + S, x0:x0 + S].copy()).to(dev)[None]
        z1, _, _ = norm_t(a); z2, _, _ = norm_t(b)
        o = net(torch.stack([z1, z2, torch.full_like(z1, 1.39 / 4)], 1))[0]; h = torch.sigmoid(o[1]); P = peaks(h)
        tx, ty = c2 - x0, r2 - y0; hit = [p for p in P if math.hypot(p[0] - tx, p[1] - ty) <= 2.5]
        fields += 1; fp += sum(1 for p in P if math.hypot(p[0] - tx, p[1] - ty) > 3.5)
        vtrue = (c2 - c1, r2 - r1); row = {"id": m["id"], "pm": m["pm"], "hit": bool(hit), "shift_px": math.hypot(*vtrue)}
        # how visible the star is in each picture: its peak over the noise
        for nm, z in (("s1", a[0]), ("s2", b[0])):
            cx, cy = (c1 - x0, r1 - y0) if nm == "s1" else (tx, ty); med = float(z.median()); sg = float((z - med).abs().median()) * 1.4826 + 1e-9
            xi, yi = int(round(cx)), int(round(cy)); row[nm] = float((z[max(0, yi - 1):yi + 2, max(0, xi - 1):xi + 2].max() - med) / sg)
        if hit:
            p = max(hit, key=lambda q: q[2]); vx, vy = float(o[2, p[1], p[0]]) * VSCALE, float(o[3, p[1], p[0]]) * VSCALE
            row["pm_model"] = math.hypot(vx, vy) * PIX / GAP; row["err"] = math.hypot(vx - vtrue[0], vy - vtrue[1]) * PIX / GAP
        rows.append(row)
    vis = [r for r in rows if r["s1"] >= 6 and r["s2"] >= 6]            # stars that both pictures actually show
    def summ(R):
        H = [r for r in R if r["hit"]]
        return {"n": len(R), "recall": (len(H) / len(R)) if R else 0.0, "pm_err_median": float(np.median([r["err"] for r in H])) if H else None}
    bins = [(0.3, 0.5), (0.5, 1.0), (1.0, 2.0), (2.0, 99)]
    out = {**summ(vis), "fp_per_field": fp / max(1, fields), "all": summ(rows), "fields": fields,
           "by_pm": [{"lo": lo, "hi": hi, **summ([r for r in vis if lo <= r["pm"] < hi])} for lo, hi in bins]}
    log(f"REAL TEST {json.dumps(out)}")
    return out, rows

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--data", required=True); ap.add_argument("--out", required=True); ap.add_argument("--base", type=int, default=24)
    ap.add_argument("--minutes", type=float, default=30); ap.add_argument("--gpu", type=int, default=0); ap.add_argument("--batch", type=int, default=192); ap.add_argument("--lr", type=float, default=2e-3)
    a = ap.parse_args(); root = os.path.expanduser(a.data); out = os.path.expanduser(a.out); os.makedirs(out, exist_ok=True)
    dev = torch.device(f"cuda:{a.gpu}"); torch.manual_seed(1); gen = torch.Generator(device=dev); gen.manual_seed(1)
    logf = open(f"{out}/train.log", "a")
    def log(s): print(s, flush=True); logf.write(s + "\n"); logf.flush()
    t0 = time.time(); ids = json.load(open(f"{root}/train/tiles.json")); ids = [p for p in ids if os.path.exists(f"{root}/train/tm/{p}.jpg") and os.path.exists(f"{root}/train/w2/{p}.fits")]
    ids, tm, w2 = load_set(f"{root}/train", ids); log(f"{len(ids)} tile pairs read in {time.time() - t0:.0f}s")
    # orientation check: stars must coincide in the two pictures
    cc = []
    for k in range(0, len(ids), max(1, len(ids) // 40)):
        x = np.log1p(np.clip(tm[k] - np.median(tm[k]), 0, None)); y = np.log1p(np.clip(w2[k] - np.median(w2[k]), 0, None)); cc.append([np.corrcoef(x.ravel(), t.ravel())[0, 1] for t in (y, np.flipud(y), np.fliplr(y), y.T)])
    cc = np.nanmean(np.array(cc), 0); log(f"alignment check, correlation as loaded / flipped rows / flipped columns / transposed: {np.round(cc, 3).tolist()}")
    assert cc[0] == cc.max(), "tile orientation is not what the loader assumes"
    # how real stars look in the two pictures: widths and brightness ratio (in units of each picture's noise)
    rng = np.random.default_rng(0); wid1, wid2, ratio = [], [], []
    for k in rng.choice(len(ids), min(300, len(ids)), replace=False):
        A, Bm = tm[k], w2[k]; ma, mb = np.median(A), np.median(Bm); sa = np.median(np.abs(A - ma)) * 1.4826 + 1e-9; sb = np.median(np.abs(Bm - mb)) * 1.4826 + 1e-9
        zb = (Bm - mb) / sb; za = (A - ma) / sa
        ys, xs = np.nonzero((zb > 40) & (zb < 2000) & (zb == np.maximum.reduce([np.roll(np.roll(zb, i, 0), j, 1) for i in (-1, 0, 1) for j in (-1, 0, 1)])))
        for y, x in list(zip(ys, xs))[:12]:
            if not (4 <= y < 508 and 4 <= x < 508): continue
            pb = zb[y - 3:y + 4, x - 3:x + 4]; pa = za[y - 3:y + 4, x - 3:x + 4]
            if pb.max() > zb[y, x] or pa.max() < 6: continue
            gy, gx = np.mgrid[-3:4, -3:4]
            for P, L in ((np.clip(pb, 0, None), wid2), (np.clip(pa, 0, None), wid1)):
                w = P.sum(); cx, cy = (P * gx).sum() / w, (P * gy).sum() / w; L.append(math.sqrt(max(0.05, ((P * ((gx - cx) ** 2 + (gy - cy) ** 2)).sum() / w) / 2)))
            ratio.append(math.log10(pa.max() / zb[y, x]))
    st = {"psf1": float(np.clip(np.median(wid1), 0.5, 1.4)) if wid1 else 0.8, "psf2": float(np.clip(np.median(wid2), 0.5, 1.4)) if wid2 else 0.7, "cmu": float(np.median(ratio)) if ratio else -0.4, "csd": float(np.clip(np.std(ratio), 0.25, 0.7)) if ratio else 0.45}
    log(f"real stars: width 2MASS {st['psf1']:.2f} px, WISE {st['psf2']:.2f} px; log10 brightness ratio {st['cmu']:.2f} +- {st['csd']:.2f} ({len(ratio)} stars)")
    tmg = torch.from_numpy(tm).to(dev).half(); w2g = torch.from_numpy(w2.clip(-3e4, 3e4)).to(dev).half(); del tm, w2
    net = UNet(a.base).to(dev); npar = sum(p.numel() for p in net.parameters()); log(f"network: {npar} weights")
    opt = torch.optim.AdamW(net.parameters(), lr=a.lr, weight_decay=1e-4); budget = a.minutes * 60; hist = []; step = 0; t0 = time.time(); ema = None
    while True:
        el = time.time() - t0
        if el > budget: break
        lr = a.lr * (0.02 + 0.98 * 0.5 * (1 + math.cos(math.pi * min(1, el / budget)))) * min(1, (step + 1) / 300)
        for g in opt.param_groups: g["lr"] = lr
        x, z2, zt, heat, near, vt, vm = make_batch(a.batch, tmg, w2g, st, dev, gen)
        with torch.autocast("cuda", dtype=torch.bfloat16):
            o = net(x)
        o = o.float(); nxt = z2 + o[:, 0]
        l_img = ((1 + 20 * near.clamp_max(1)) * (nxt - zt).abs()).mean()
        l_heat = F.binary_cross_entropy_with_logits(o[:, 1], heat, pos_weight=torch.tensor(8.0, device=dev))
        l_vel = (F.smooth_l1_loss(o[:, 2:4], vt, reduction="none", beta=0.05) * vm[:, None]).sum() / vm.sum().clamp_min(1) / 2
        loss = l_img + 0.5 * l_heat + 2.0 * l_vel
        opt.zero_grad(set_to_none=True); loss.backward(); nn.utils.clip_grad_norm_(net.parameters(), 2.0); opt.step(); step += 1
        v = [float(loss), float(l_img), float(l_heat), float(l_vel)]; ema = v if ema is None else [0.98 * e + 0.02 * q for e, q in zip(ema, v)]
        if step % 200 == 0:
            hist.append({"step": step, "min": round(el / 60, 2), "loss": round(ema[0], 5), "img": round(ema[1], 5), "heat": round(ema[2], 5), "vel": round(ema[3], 5)})
            log(f"step {step} {el / 60:.1f} min loss {ema[0]:.4f} img {ema[1]:.4f} heat {ema[2]:.4f} vel {ema[3]:.4f} lr {lr:.5f}")
        if step % 4000 == 0: torch.save(net.state_dict(), f"{out}/net.pt")
    torch.save(net.state_dict(), f"{out}/net.pt"); net.eval()
    # --- painted movers on backgrounds (for the record), then the real test
    with torch.no_grad():
        x, z2, zt, heat, near, vt, vm = make_batch(1024, tmg, w2g, st, dev, gen); o = net(x).float()
        err_model = float((z2 + o[:, 0] - zt).abs().mean()); err_static = float((z2 - zt).abs().mean())
        sel = vm > 0; vel_err = float(((o[:, 2:4] - vt) * VSCALE).pow(2).sum(1).sqrt()[sel].median()) * PIX / GAP
    log(f"painted movers: picture error {err_model:.5f} against {err_static:.5f} for 'nothing moves'; motion error {vel_err:.3f} arcsec/yr (median)")
    test, rows = test_real(net, root, dev, log)
    # --- export for the browser
    off = 0; layers = []; chunks = []
    for name, cv in net.named():
        w = cv.weight.detach().float().cpu().numpy().ravel(); b = cv.bias.detach().float().cpu().numpy().ravel()
        layers.append({"k": name, "cin": cv.in_channels, "cout": cv.out_channels, "ks": 3, "w": off, "b": off + w.size}); chunks += [w, b]; off += w.size + b.size
    blob = np.concatenate(chunks).astype("<f4"); blob.tofile(f"{out}/model.bin")
    meta = {"name": "MIRA sky world model", "weights": "model.bin", "layers": layers, "vscale": VSCALE, "params": int(npar), "bytes": int(blob.nbytes), "base": a.base, "crop": S, "pixel_arcsec": PIX,
            "about": f"A U-Net of {npar / 1e6:.2f} million weights, trained for {a.minutes:.0f} minutes on one GPU on {len(ids)} pairs of real 2MASS (1999) and WISE (2010) pictures from NASA's archive, each 0.92 degrees on a side, "
                     "with artificial moving stars painted in. It predicts a later picture, a map of what moves and the motion.",
            "trained": {"pairs": len(ids), "steps": step, "minutes": a.minutes, "batch": a.batch, "samples": step * a.batch, "stars": st, "painted": {"picture_error": err_model, "picture_error_static": err_static, "motion_err_arcsec_yr": vel_err}},
            "test": test, "built": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())}
    json.dump(meta, open(f"{out}/model.json", "w")); json.dump({"hist": hist, "rows": rows}, open(f"{out}/train_log.json", "w"))
    log(f"exported {blob.nbytes / 1e6:.1f} MB to {out}")

if __name__ == "__main__":
    main()
