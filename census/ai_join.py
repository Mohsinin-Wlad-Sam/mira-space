#!/usr/bin/env python3
"""AI estimates for the confirmed movers: distance, temperature and kind.

The ensemble of census/ai_phys.py predicted, for every source of the first whole-sky pass that had a SPHEREx spectrum,
an absolute magnitude (hence a distance), a temperature and a kind, each with its uncertainty. This joins those
predictions to the verified catalogue (web_data/verified/objects.json, ids "tile-object") and checks them on the
movers themselves, against what Gaia measured for the same stars:

  distance   against 1000 / parallax, for movers with a Gaia parallax of at least 2 mas
  the same   on the tiles the ensemble never trained on (every tenth HEALPix tile), which is the honest figure
  kind       how many of the catalogue's known L and T dwarfs the ensemble calls brown dwarfs

    python -m census.ai_join            ->  web_data/verified/ai.json
"""
import collections, json, math, os
import numpy as np
import pyarrow.parquet as pq

H = os.path.expanduser("~/skylens"); CLASSES = ["dwarf star", "giant or evolved star", "brown dwarf", "galaxy or quasar"]

def main():
    obj = json.load(open(f"{H}/web_data/verified/objects.json"))["cols"]; n = len(obj["id"]); by = collections.defaultdict(list)
    for i, s in enumerate(obj["id"]): t, o = s.split("-"); by[int(t)].append((int(o), i))
    d = np.full(n, np.nan); sig = np.full(n, np.nan); teff = np.full(n, np.nan); st = np.full(n, np.nan); cls = np.full(n, -1); pmax = np.full(n, np.nan); pbd = np.full(n, np.nan); tile = np.zeros(n, int)
    for t, L in by.items():
        f = f"{H}/ai_out/tile_{t}.parquet"
        if not os.path.exists(f): continue
        T = pq.read_table(f).to_pydict(); idx = {o: k for k, o in enumerate(T["obj"])}
        for o, i in L:
            k = idx.get(o); tile[i] = t
            if k is None: continue
            P = [float(T[f"p{q}"][k]) for q in range(4)]; d[i] = T["dist_pc"][k]; sig[i] = math.hypot(T["sM_w2"][k], T["epi_M"][k]); teff[i] = T["teff"][k]; st[i] = T["slogT"][k]
            cls[i] = int(np.argmax(P)); pmax[i] = max(P); pbd[i] = P[2]
    has = np.isfinite(d) & (d > 0); plx = np.array([v if v is not None else np.nan for v in obj["plx"]], float); known = np.array(obj["known"]); kind = np.array(obj["kind"])
    ok = has & np.isfinite(plx) & (plx >= 2) & (known == 1); r = np.log(d[ok] / (1000 / plx[ok])); hold = ok & (tile % 10 == 0); rh = np.log(d[hold] / (1000 / plx[hold]))
    rob = lambda v: float(1.4826 * np.median(np.abs(v - np.median(v)))) if len(v) else None
    within = lambda v, s: float(np.mean(np.abs(v) <= s * (math.log(10) / 5))) if len(v) else None
    bd_known = has & np.isin(kind, ["T dwarf", "L dwarf"]); check = {
        "movers": n, "with_an_estimate": int(has.sum()), "no_gaia_source_with_an_estimate": int((has & (known == 0)).sum()),
        "distance": {"compared_with": "1000 / Gaia parallax, movers with a parallax of at least 2 mas", "n": int(ok.sum()), "median_ratio": float(np.exp(np.median(r))), "scatter_percent": round(100 * (math.exp(rob(r)) - 1), 1),
                     "within_its_own_error": round(within(r, sig[ok]), 3)},
        "distance_on_tiles_never_trained_on": {"n": int(hold.sum()), "median_ratio": float(np.exp(np.median(rh))) if hold.sum() else None, "scatter_percent": round(100 * (math.exp(rob(rh)) - 1), 1) if hold.sum() else None,
                                               "within_its_own_error": round(within(rh, sig[hold]), 3) if hold.sum() else None},
        "kind": {"known_L_and_T_dwarfs": int(bd_known.sum()), "called_brown_dwarf": int((bd_known & (cls == 2)).sum()), "others_called_brown_dwarf": int((has & ~bd_known & (cls == 2)).sum()),
                 "by_class": {CLASSES[c]: int((cls == c).sum()) for c in range(4)}},
        "ensemble_holdout": json.load(open(f"{H}/ai/phys_metrics.json")) if os.path.exists(f"{H}/ai/phys_metrics.json") else None}
    f5 = lambda v, k=1: None if not np.isfinite(v) else round(float(v), k)
    out = {"about": "Estimates by a neural ensemble (census/ai_phys.py) from each source's SPHEREx spectrum, its WISE colour and its motion. Not measurements: each comes with its own uncertainty.",
           "classes": CLASSES, "check": check,
           "d": [f5(v) for v in d], "dlo": [f5(v / 10 ** (s / 5)) if np.isfinite(v) else None for v, s in zip(d, sig)], "dhi": [f5(v * 10 ** (s / 5)) if np.isfinite(v) else None for v, s in zip(d, sig)],
           "teff": [None if not np.isfinite(v) else int(round(v / 10) * 10) for v in teff], "et": [None if not np.isfinite(v) else int(round(t * (10 ** s - 1) / 10) * 10) for t, s, v in zip(teff, st, teff)],
           "cls": [int(c) for c in cls], "p": [f5(v, 2) for v in pmax], "pbd": [f5(v, 3) for v in pbd]}
    json.dump(out, open(f"{H}/web_data/verified/ai.json", "w")); print(json.dumps({k: v for k, v in check.items() if k != "ensemble_holdout"}, indent=1))

if __name__ == "__main__":
    main()
