"""The larger sky world model ("scout"): the whole sky at three dates, learned from real moving stars.

Pictures (census/wm2_data.py): 2MASS 2.2 um about 1999, WISE 4.6 um 2010, SPHEREx 4.5-4.7 um 2025-26, as order-5
HiPS tiles of 12.9" pixels: 12,288 tiles cover the sky. Examples (census/wm2_gaia.py + MIRA's verified catalogue):
every Gaia DR3 star faster than 0.15"/yr and every confirmed mover Gaia does not list.

What the network is asked, on real data:
  1. FORECAST. Shown only the 1999 and 2010 pictures of a patch, draw what SPHEREx sees there in 2025-26, and say
     where each moving star will then be. This is the world-model task: predict the next observation.
  2. SCOUT. Shown all three pictures, mark what moved and read off its motion.
Artificial movers are still painted in (fast or cold ones are rare), but the labels that count are real stars.

A fifth of the sky (tiles with index divisible by 5) is never trained on and gives the test figures; another
tenth (index % 10 == 1) is used only to choose the detection threshold.

    python -m census.wm2_train --prep --data ~/skylens/wm2 --objects ~/skylens/web_data/verified/objects.json
    python -m census.wm2_train --data ~/skylens/wm2 --out ~/skylens/wm2/run_a --base 48 --minutes 35 --gpu 0 --seed 1
"""
import argparse, json, math, os, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
from PIL import Image
from census.wm_data import tile_rc

ORDER, NT, S, PIX = 5, 12 * 4 ** 5, 96, 12.88
T_TM, T_W2, T_SX = 1999.5, 2010.5, 2025.8
GAP, VS = T_SX - T_W2, 6.0                      # years between the last two pictures; velocity unit (px over that gap)
POS_PM, IGN_PM, KP, KI = 0.4, 0.15, 12, 96      # arcsec/yr: examples above POS_PM count, between the two they are left out of the loss
split = lambda p: 2 if p % 5 == 0 else 1 if p % 10 == 1 else 0      # 0 train, 1 threshold, 2 test

# ------------------------------------------------------------------ preparation: pictures and labels in a few arrays
def prep(root, objects, threads=96):
    t0 = time.time(); tm = np.zeros((NT, 512, 512), np.uint8); w2 = np.zeros_like(tm); sx = np.zeros_like(tm); bad = []
    def one(p):
        try:
            name = lambda d: f"{root}/{d}/{p}.jpg" if os.path.exists(f"{root}/{d}/{p}.jpg") else f"{root}/{d}/{p}"       # (the downloader saved the JPEG tiles without their extension)
            tm[p] = np.asarray(Image.open(name("tm")).convert("L")); w2[p] = np.asarray(Image.open(name("w2")).convert("L"))
            st = np.stack([np.asarray(Image.open(f"{root}/sx{k}/{p}.png").convert("L"), dtype=np.float32) for k in (86, 90, 94)]); n = (st > 0).sum(0)
            sx[p] = np.where(n > 0, st.sum(0) / np.maximum(n, 1), 0).astype(np.uint8)
        except Exception: bad.append(p)
    with ThreadPoolExecutor(threads) as ex: list(ex.map(one, range(NT)))
    print(f"pictures read in {time.time() - t0:.0f}s, {len(bad)} tiles unreadable", flush=True)
    for n, a in (("tm", tm), ("w2", w2), ("sx", sx)): np.save(f"{root}/{n}.npy", a)
    # --- real movers: Gaia (epoch 2016.0, mas/yr) and the confirmed movers Gaia does not list (epoch = their SPHEREx date)
    import csv
    ra, dec, pmra, pmdec, ep, src = [], [], [], [], [], []
    have_gaia = os.path.exists(f"{root}/gaia_pm150.csv")           # without it (ESA's archive was unreachable on the day) the examples are MIRA's verified movers alone
    if have_gaia:
        with open(f"{root}/gaia_pm150.csv") as f:
            for r in csv.DictReader(f):
                try: ra.append(float(r["ra"])); dec.append(float(r["dec"])); pmra.append(float(r["pmra"]) / 1000); pmdec.append(float(r["pmdec"]) / 1000); ep.append(2016.0); src.append(0)
                except Exception: pass
    ng = len(ra); c = json.load(open(objects))["cols"]
    for k in range(len(c["id"])):
        if not have_gaia or c["known"][k] != 1: ra.append(c["ra"][k]); dec.append(c["dec"][k]); pmra.append(c["pmra"][k]); pmdec.append(c["pmdec"][k]); ep.append(c["yr"][k]); src.append(1 if c["known"][k] != 1 else 0)
    ra, dec, pmra, pmdec, ep, src = (np.array(x, float) for x in (ra, dec, pmra, pmdec, ep, src)); pm = np.hypot(pmra, pmdec)
    print(f"{ng} Gaia stars faster than 0.15 arcsec/yr from ESA; {len(ra) - ng} of MIRA's confirmed movers added", flush=True)
    at = lambda t: tile_rc(ra + pmra * (t - ep) / 3600 / np.maximum(0.02, np.cos(np.radians(dec))), np.clip(dec + pmdec * (t - ep) / 3600, -89.999, 89.999), ORDER)
    (t1, r1, c1), (t2, r2, c2), (t3, r3, c3) = at(T_TM), at(T_W2), at(T_SX); same = (t1 == t2) & (t2 == t3)
    # is the star there in the 2010 and the SPHEREx pictures? (peak over the tile's own noise)
    vis = np.zeros(len(ra), bool); order = np.argsort(t3)
    def z(img):
        m = np.median(img); s = max(1.5, np.median(np.abs(img.astype(np.float32) - m)) * 1.4826); return (img.astype(np.float32) - m) / s
    cur = -1
    for i in order:
        if not same[i]: continue
        p = int(t3[i])
        if p != cur: cur = p; zw, zs = z(w2[p]), z(sx[p])
        a, b = int(round(r2[i])), int(round(c2[i])); e, g = int(round(r3[i])), int(round(c3[i]))
        if not (1 <= a < 511 and 1 <= b < 511 and 1 <= e < 511 and 1 <= g < 511): continue
        vis[i] = zw[a - 1:a + 2, b - 1:b + 2].max() >= 5 and zs[e - 1:e + 2, g - 1:g + 2].max() >= 4
    pos = same & vis & (pm >= POS_PM); ign = same & ~pos
    P = np.full((NT, KP, 6), -1e4, np.float32); I = np.full((NT, KI, 2), -1e4, np.float32); npz = np.zeros(NT, np.int32); cnt = np.zeros(NT, np.int32)
    for i in np.nonzero(pos)[0]:
        p = int(t3[i]); k = npz[p]
        if k < KP: P[p, k] = (r3[i], c3[i], r3[i] - r2[i], c3[i] - c2[i], pm[i], src[i]); npz[p] += 1
    for i in np.nonzero(ign)[0]:
        p = int(t3[i]); k = cnt[p]
        if k < KI: I[p, k] = (r3[i], c3[i]); cnt[p] += 1
    np.savez(f"{root}/labels.npz", P=P, I=I, npos=npz)
    np.savez(f"{root}/stars.npz", ra=ra, dec=dec, pmra=pmra, pmdec=pmdec, ep=ep, src=src, pm=pm, tile=t3, r3=r3, c3=c3, same=same, vis=vis)
    print(f"examples: {int(pos.sum())} real movers faster than {POS_PM} arcsec/yr and visible in both pictures ({int((pos & (src == 1)).sum())} of them not in Gaia), in {int((npz > 0).sum())} tiles; {int(ign.sum())} left out of the loss. {time.time() - t0:.0f}s", flush=True)

# ------------------------------------------------------------------ the network
class Block(nn.Module):
    def __init__(s, i, o):
        super().__init__(); s.a = nn.Conv2d(i, o, 3, padding=1); s.b = nn.Conv2d(o, o, 3, padding=1); s.n1 = nn.GroupNorm(8, o); s.n2 = nn.GroupNorm(8, o)
    def forward(s, x): return F.relu(s.n2(s.b(F.relu(s.n1(s.a(x))))))

class UNet2(nn.Module):
    def __init__(s, c=48):
        super().__init__()
        s.e1, s.e2, s.e3, s.e4, s.b = Block(4, c), Block(c, 2 * c), Block(2 * c, 4 * c), Block(4 * c, 8 * c), Block(8 * c, 8 * c)
        s.d4, s.d3, s.d2, s.d1 = Block(16 * c, 4 * c), Block(8 * c, 2 * c), Block(4 * c, c), Block(2 * c, c); s.out = nn.Conv2d(c, 4, 3, padding=1)
    def forward(s, x):
        up = lambda t: F.interpolate(t, scale_factor=2, mode="nearest"); mp = lambda t: F.max_pool2d(t, 2)
        e1 = s.e1(x); e2 = s.e2(mp(e1)); e3 = s.e3(mp(e2)); e4 = s.e4(mp(e3)); b = s.b(mp(e4))
        d4 = s.d4(torch.cat([up(b), e4], 1)); d3 = s.d3(torch.cat([up(d4), e3], 1)); d2 = s.d2(torch.cat([up(d3), e2], 1)); d1 = s.d1(torch.cat([up(d2), e1], 1))
        return s.out(d1)          # channels: forecast of the SPHEREx picture, "moved" logit, motion (row, col) in units of VS pixels

def norm(x, valid=None):
    """per picture: sky level to 0, noise to 1 (never less than 1.5 counts of the 8-bit tiles), bright stars compressed"""
    f = x.flatten(1); med = f.median(1).values; sig = ((f - med[:, None]).abs().median(1).values * 1.4826).clamp_min(1.5)
    z = torch.asinh((x - med[:, None, None]) / sig[:, None, None] / 5) / 4
    return (z if valid is None else z * valid), med, sig

def blobs(pos, amp, sig, n, dev):
    g = torch.arange(n, device=dev, dtype=torch.float32)
    dc = g[None, None, None, :] - pos[:, :, 1, None, None]; dr = g[None, None, :, None] - pos[:, :, 0, None, None]
    return amp[:, :, None, None] * torch.exp(-(dc * dc + dr * dr) / (2 * sig[:, :, None, None] ** 2))          # (B, K, n, n)

def batch(B, D, dev, gen, train_ids, pos_ids):
    tm, w2, sx, P, I = D; r = lambda *s: torch.rand(*s, device=dev, generator=gen)
    half = r(B) < 0.6; ti = torch.where(half, pos_ids[torch.randint(0, len(pos_ids), (B,), device=dev, generator=gen)], train_ids[torch.randint(0, len(train_ids), (B,), device=dev, generator=gen)])
    Pt = P[ti]; has = Pt[:, 0, 0] > -1e3; near = half & has & (r(B) < 0.8)
    kk = torch.randint(0, KP, (B,), device=dev, generator=gen); pick = Pt[torch.arange(B, device=dev), kk]; pick = torch.where((pick[:, :1] > -1e3), pick, Pt[:, 0])
    y0 = torch.where(near, (pick[:, 0] - S / 2 + (r(B) - 0.5) * 56).round().long(), torch.randint(0, 512 - S + 1, (B,), device=dev, generator=gen)).clamp(0, 512 - S)
    x0 = torch.where(near, (pick[:, 1] - S / 2 + (r(B) - 0.5) * 56).round().long(), torch.randint(0, 512 - S + 1, (B,), device=dev, generator=gen)).clamp(0, 512 - S)
    ar = torch.arange(S, device=dev); iy = (y0[:, None] + ar)[:, :, None]; ix = (x0[:, None] + ar)[:, None, :]; T = ti[:, None, None]
    a, b, c = tm[T, iy, ix].float(), w2[T, iy, ix].float(), sx[T, iy, ix].float()
    pp = Pt.clone(); pp[:, :, 0] -= y0[:, None]; pp[:, :, 1] -= x0[:, None]; ii = I[ti].clone(); ii[:, :, 0] -= y0[:, None]; ii[:, :, 1] -= x0[:, None]
    k = int(torch.randint(0, 8, (1,), generator=gen, device=dev))              # one of the eight flips / rotations, for pictures and labels alike
    if k & 1: a, b, c = a.flip(1), b.flip(1), c.flip(1); pp[:, :, 0] = S - 1 - pp[:, :, 0]; pp[:, :, 2] = -pp[:, :, 2]; ii[:, :, 0] = S - 1 - ii[:, :, 0]
    if k & 2: a, b, c = a.flip(2), b.flip(2), c.flip(2); pp[:, :, 1] = S - 1 - pp[:, :, 1]; pp[:, :, 3] = -pp[:, :, 3]; ii[:, :, 1] = S - 1 - ii[:, :, 1]
    if k & 4: a, b, c = a.transpose(1, 2), b.transpose(1, 2), c.transpose(1, 2); pp = pp[:, :, [1, 0, 3, 2, 4, 5]]; ii = ii[:, :, [1, 0]]
    real = (pp[:, :, 0] > -2) & (pp[:, :, 0] < S + 1) & (pp[:, :, 1] > -2) & (pp[:, :, 1] < S + 1)
    # --- painted movers: fast ones and cold ones (absent from the 1999 picture) are too rare among the real examples
    K = 2; act = (torch.arange(K, device=dev)[None] < torch.multinomial(torch.tensor([0.45, 0.4, 0.15], device=dev), B, replacement=True, generator=gen)[:, None])
    q3 = 5 + r(B, K, 2) * (S - 10); sp = torch.exp(math.log(0.45) + r(B, K) * (math.log(12) - math.log(0.45))); th = r(B, K) * 2 * math.pi; v = torch.stack([sp * torch.sin(th), sp * torch.cos(th)], -1)
    q2 = q3 - v; q1 = q2 - v * ((T_W2 - T_TM) / GAP); act &= ((q2 > 2) & (q2 < S - 3)).all(-1)
    _, _, sa = norm(a); _, _, sb = norm(b); _, _, sc = norm(c)
    snr = torch.exp(math.log(7) + r(B, K) * (math.log(60) - math.log(7))); cold = r(B, K) < 0.4; one = act.float(); w = 0.75 + 0.3 * r(B, K)
    a = (a + (blobs(q1, snr * sa[:, None] * one * (~cold).float() * torch.exp(0.5 * torch.randn(B, K, device=dev, generator=gen)), w * 0.8, S, dev)).sum(1)).clamp(0, 255)
    b = (b + (blobs(q2, snr * sb[:, None] * one, w * 0.85, S, dev)).sum(1)).clamp(0, 255); c = (c + (blobs(q3, snr * sc[:, None] * one * torch.exp(0.3 * torch.randn(B, K, device=dev, generator=gen)), w * 0.85, S, dev)).sum(1)).clamp(0, 255)
    # --- inputs: with the SPHEREx picture (scout) or without it (forecast)
    valid = (c > 0).float(); z1, _, _ = norm(a); z2, _, _ = norm(b); z3, _, _ = norm(c, valid); seen = (r(B) > 0.35).float()[:, None, None]
    x = torch.stack([z1, z2, z3 * seen, seen.expand(B, S, S)], 1)
    allp = torch.cat([pp[:, :, :2], q3], 1); allv = torch.cat([pp[:, :, 2:4], v], 1); on = torch.cat([real, act], 1).float(); u = torch.ones_like(on)
    wk = blobs(allp, on, u, S, dev); heat = wk.amax(1); vt = (wk[:, :, None] * allv[:, :, :, None, None]).sum(1) / wk.sum(1, keepdim=True).clamp_min(1e-6) / VS; vm = (heat > 0.3).float()
    igm = blobs(ii, ((ii[:, :, 0] > -2) & (ii[:, :, 0] < S + 1)).float(), 1.6 * torch.ones(B, KI, device=dev), S, dev).amax(1) > 0.2      # slow or unseen real movers: neither right nor wrong
    return x, heat, vt, vm, (~igm).float(), z3, valid * (1 - seen)

def peaks(h, thr):
    m = F.max_pool2d(h[None, None], 5, 1, 2)[0, 0]; ys, xs = torch.nonzero((h >= thr) & (h >= m), as_tuple=True); return ys, xs

@torch.no_grad()
def run_tiles(net, D, ids, dev, seen=1.0, bs=24):
    """heat and motion maps of whole tiles"""
    tm, w2, sx = D[:3]; H = []; V = []
    for i in range(0, len(ids), bs):
        t = ids[i:i + bs]; a, b, c = tm[t].float(), w2[t].float(), sx[t].float(); valid = (c > 0).float(); z1, _, _ = norm(a); z2, _, _ = norm(b); z3, _, _ = norm(c, valid)
        with torch.autocast("cuda", dtype=torch.bfloat16): o = net(torch.stack([z1, z2, z3 * seen, torch.full_like(z1, seen)], 1))
        o = o.float(); H.append(torch.sigmoid(o[:, 1]).half()); V.append(o[:, 2:4].half())
    return torch.cat(H), torch.cat(V)

@torch.no_grad()
def evaluate(H, V, ids, D, thr):
    """real movers of these tiles found (a mark within 2.5 px of where the star is today), and marks on nothing known"""
    P, I = D[3], D[4]; bins = [(0.4, 0.6), (0.6, 1.0), (1.0, 2.0), (2.0, 99)]; hit = {b: [0, 0] for b in bins}; errs = []; fp = 0; edge = 6
    for k, t in enumerate(ids.tolist()):
        ys, xs = peaks(H[k].float(), thr); pk = torch.stack([ys, xs], 1).float(); p = P[t]; p = p[p[:, 0] > -1e3]; ig = I[t]; ig = ig[ig[:, 0] > -1e3]
        inside = (pk[:, 0] >= edge) & (pk[:, 0] < 512 - edge) & (pk[:, 1] >= edge) & (pk[:, 1] < 512 - edge); pk = pk[inside]
        known = torch.cat([p[:, :2], ig], 0)
        if len(pk): fp += int((torch.cdist(pk, known).amin(1) > 3.5).sum()) if len(known) else len(pk)
        for q in p:
            if not (edge <= q[0] < 512 - edge and edge <= q[1] < 512 - edge): continue
            b = next(b for b in bins if b[0] <= float(q[4]) < b[1]); hit[b][1] += 1
            if len(pk):
                d = (pk - q[None, :2]).norm(dim=1); j = int(d.argmin())
                if float(d[j]) <= 2.5:
                    hit[b][0] += 1; y, x = int(pk[j, 0]), int(pk[j, 1]); vv = V[k, :, y, x].float() * VS; errs.append(float((vv - q[2:4]).norm()) * PIX / GAP)
    n = sum(v[1] for v in hit.values()); f = sum(v[0] for v in hit.values()); area = len(ids) * (41252.96 / NT) * ((512 - 2 * edge) / 512) ** 2
    return {"thr": thr, "n": n, "recall": f / max(1, n), "by_pm": [{"lo": b[0], "hi": b[1], "n": v[1], "recall": v[0] / max(1, v[1])} for b, v in hit.items()], "false_per_sqdeg": fp / area, "false": fp, "sqdeg": area,
            "pm_err_median": float(np.median(errs)) if errs else None}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--data", required=True); ap.add_argument("--out", default=""); ap.add_argument("--objects", default=""); ap.add_argument("--prep", action="store_true")
    ap.add_argument("--base", type=int, default=48); ap.add_argument("--minutes", type=float, default=35); ap.add_argument("--gpu", type=int, default=0); ap.add_argument("--seed", type=int, default=1); ap.add_argument("--batch", type=int, default=96); ap.add_argument("--lr", type=float, default=1.2e-3)
    a = ap.parse_args(); root = os.path.expanduser(a.data)
    if a.prep: return prep(root, os.path.expanduser(a.objects))
    out = os.path.expanduser(a.out); os.makedirs(out, exist_ok=True); dev = torch.device(f"cuda:{a.gpu}"); torch.manual_seed(a.seed); gen = torch.Generator(device=dev); gen.manual_seed(a.seed)
    logf = open(f"{out}/train.log", "a")
    def log(s): print(s, flush=True); logf.write(s + "\n"); logf.flush()
    L = np.load(f"{root}/labels.npz"); D = tuple(torch.from_numpy(np.load(f"{root}/{n}.npy")).to(dev) for n in ("tm", "w2", "sx")) + (torch.from_numpy(L["P"]).to(dev), torch.from_numpy(L["I"]).to(dev))
    sp = np.array([split(p) for p in range(NT)]); ok = (D[1].flatten(1).float().mean(1) > 0).cpu().numpy(); npos = L["npos"]
    tr = torch.from_numpy(np.nonzero((sp == 0) & ok)[0]).to(dev); trp = torch.from_numpy(np.nonzero((sp == 0) & ok & (npos > 0))[0]).to(dev); va = torch.from_numpy(np.nonzero((sp == 1) & ok)[0]).to(dev); te = torch.from_numpy(np.nonzero((sp == 2) & ok)[0]).to(dev)
    net = UNet2(a.base).to(dev).to(memory_format=torch.channels_last); npar = sum(p.numel() for p in net.parameters())
    log(f"{len(tr)} tiles to learn from ({len(trp)} with real movers), {len(va)} for the threshold, {len(te)} for the test; network {npar / 1e6:.1f} million weights")
    opt = torch.optim.AdamW(net.parameters(), lr=a.lr, weight_decay=1e-4); budget = a.minutes * 60; hist = []; step = 0; t0 = time.time(); ema = None
    while time.time() - t0 < budget:
        el = time.time() - t0; lr = a.lr * (0.02 + 0.98 * 0.5 * (1 + math.cos(math.pi * min(1, el / budget)))) * min(1, (step + 1) / 400)
        for g in opt.param_groups: g["lr"] = lr
        x, heat, vt, vm, keep, z3, fmask = batch(a.batch, D, dev, gen, tr, trp)
        with torch.autocast("cuda", dtype=torch.bfloat16): o = net(x.contiguous(memory_format=torch.channels_last))
        o = o.float()
        l_heat = (F.binary_cross_entropy_with_logits(o[:, 1], heat, pos_weight=torch.tensor(10.0, device=dev), reduction="none") * keep).sum() / keep.sum().clamp_min(1)
        l_vel = (F.smooth_l1_loss(o[:, 2:4], vt, reduction="none", beta=0.05) * vm[:, None]).sum() / vm.sum().clamp_min(1) / 2
        l_fc = ((o[:, 0] - z3).abs() * fmask).sum() / fmask.sum().clamp_min(1)
        loss = l_heat + 2.0 * l_vel + 0.5 * l_fc
        opt.zero_grad(set_to_none=True); loss.backward(); nn.utils.clip_grad_norm_(net.parameters(), 2.0); opt.step(); step += 1
        v = [loss.item(), l_heat.item(), l_vel.item(), l_fc.item()]; ema = v if ema is None else [0.98 * e + 0.02 * q for e, q in zip(ema, v)]
        if step % 250 == 0:
            hist.append({"step": step, "min": round(el / 60, 2), "loss": round(ema[0], 5), "heat": round(ema[1], 5), "vel": round(ema[2], 5), "forecast": round(ema[3], 5)})
            log(f"step {step} {el / 60:.1f} min loss {ema[0]:.4f} heat {ema[1]:.4f} vel {ema[2]:.4f} forecast {ema[3]:.4f}")
        if step % 3000 == 0: torch.save(net.state_dict(), f"{out}/net.pt")
    torch.save(net.state_dict(), f"{out}/net.pt"); net.eval()
    Hv, Vv = run_tiles(net, D, va, dev); table = [evaluate(Hv, Vv, va, D, thr) for thr in (0.3, 0.5, 0.7, 0.85, 0.93)]
    for r in table: log(f"threshold tiles: {json.dumps({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items() if k != 'by_pm'})}")
    good = [r for r in table if r["false_per_sqdeg"] <= 0.05] or [table[-1]]; thr = max(good, key=lambda r: r["recall"])["thr"]
    Ht, Vt = run_tiles(net, D, te, dev); test = evaluate(Ht, Vt, te, D, thr); Hf, Vf = run_tiles(net, D, te, dev, seen=0.0); fore = evaluate(Hf, Vf, te, D, thr)
    log(f"TEST scout {json.dumps(test)}"); log(f"TEST forecast (1999 and 2010 only) {json.dumps(fore)}")
    json.dump({"base": a.base, "seed": a.seed, "params": npar, "steps": step, "minutes": a.minutes, "batch": a.batch, "thr": thr, "threshold_table": table, "test": test, "test_forecast": fore, "hist": hist,
               "tiles": {"train": len(tr), "threshold": len(va), "test": len(te)}}, open(f"{out}/result.json", "w"))
    log("done")

if __name__ == "__main__":
    main()
