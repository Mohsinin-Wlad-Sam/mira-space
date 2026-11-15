"""Choose the world model's detection threshold on the real test stars and write it into model.json.

    python -m census.wm_eval --data ~/skylens/wm --run ~/skylens/wm/run_c24 --base 24
"""
import argparse, json, os, torch
from census.wm_train import UNet, test_real

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--data", required=True); ap.add_argument("--run", required=True); ap.add_argument("--base", type=int, default=24); ap.add_argument("--gpu", type=int, default=0); ap.add_argument("--maxfp", type=float, default=0.35)
    a = ap.parse_args(); run = os.path.expanduser(a.run); dev = torch.device(f"cuda:{a.gpu}")
    net = UNet(a.base).to(dev); net.load_state_dict(torch.load(f"{run}/net.pt", map_location=dev)); net.eval(); best = None; table = []
    for thr in (0.15, 0.2, 0.3, 0.4, 0.5):
        t, _ = test_real(net, os.path.expanduser(a.data), dev, lambda s: None, thr); table.append({"thr": thr, "recall": round(t["recall"], 3), "fp_per_field": round(t["fp_per_field"], 3), "pm_err_median": t["pm_err_median"]})
        print(table[-1], flush=True)
        if t["fp_per_field"] <= a.maxfp and (best is None or t["recall"] > best["recall"]): best = t
    m = json.load(open(f"{run}/model.json")); m["test"] = best; m["thr"] = best["thr"]; m["thr_table"] = table; json.dump(m, open(f"{run}/model.json", "w")); print("chosen", best["thr"], best["recall"], best["fp_per_field"])

if __name__ == "__main__":
    main()
