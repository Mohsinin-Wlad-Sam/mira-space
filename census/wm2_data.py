"""The whole sky, three times, for the larger sky world model (census/wm2_train.py).

Order-5 HiPS tiles (512 x 512 pixels of 12.9", 1.83 degrees on a side; 12,288 tiles cover the sky), all from NASA's
infrared archive (IRSA):
  tm    2MASS K, 2.2 um, about 1999          (JPEG)
  w2    AllWISE W2, 4.6 um, 2010-11          (JPEG)
  sx86, sx90, sx94   SPHEREx DR1 all-sky cube at 4.47, 4.60 and 4.74 um, 2025-26   (PNG; averaged later, which fills
        the strips each single wavelength misses)

    python -m census.wm2_data --out ~/skylens/wm2 --threads 96 [--part 0/2]
"""
import argparse, os, sys, time, threading
from concurrent.futures import ThreadPoolExecutor
import requests
from census.wm_data import get

IRSA = "https://irsa.ipac.caltech.edu/data/hips"
SETS = {"tm": (f"{IRSA}/CDS/2MASS/K", ".jpg"), "w2": (f"{IRSA}/CDS/AllWISE/W2", ".jpg"), "sx86": (f"{IRSA}/SPHEREx/spherex_allsky_cube", "_86.png"), "sx90": (f"{IRSA}/SPHEREx/spherex_allsky_cube", "_90.png"),
        "sx94": (f"{IRSA}/SPHEREx/spherex_allsky_cube", "_94.png")}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); ap.add_argument("--threads", type=int, default=64); ap.add_argument("--part", default="0/1")
    a = ap.parse_args(); out = os.path.expanduser(a.out); k, n = (int(x) for x in a.part.split("/"))
    for s in SETS: os.makedirs(f"{out}/{s}", exist_ok=True)
    jobs = [(s, p) for p in range(12 * 4 ** 5) if p % n == k for s in SETS]
    loc = threading.local(); done = [0, 0]; t0 = time.time()
    def work(j):
        s = getattr(loc, "s", None)
        if s is None: s = loc.s = requests.Session(); s.headers["User-Agent"] = "sky-world-model-builder"
        name, p = j; base, ext = SETS[name]
        ok = get(f"{base}/Norder5/Dir{(p // 10000) * 10000}/Npix{p}{ext}", f"{out}/{name}/{p}{os.path.splitext(ext)[1]}", s, tries=3)
        done[0] += 1; done[1] += 0 if ok else 1
        if done[0] % 2000 == 0: print(f"{done[0]}/{len(jobs)} fetched, {done[1]} missing, {time.time() - t0:.0f}s", flush=True)
    with ThreadPoolExecutor(a.threads) as ex: list(ex.map(work, jobs))
    print(f"DONE {done[0]} jobs, {done[1]} missing, {time.time() - t0:.0f}s", flush=True)

if __name__ == "__main__":
    sys.exit(main())
