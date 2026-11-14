#!/usr/bin/env python3
"""Run census tiles in parallel with a priority queue, resume, retries and a disk budget.

usage:
  python -m census.run_many --out ~/skylens/census_out --workers 48 --priority validation   # first
  python -m census.run_many --out ~/skylens/census_out --workers 96 --priority allsky --shard 0/3
Shards: run '--shard i/N' on N different nodes so each takes every N-th tile of the queue.
"""
from __future__ import annotations

import argparse, json, os, pathlib, random, shutil, subprocess, sys, time
from concurrent.futures import ProcessPoolExecutor, as_completed

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# HEALPix order-5 NESTED tiles containing the challenge targets and validation fields (computed with astropy_healpix)
VALIDATION_TILES = {
    "WISE0855": 10226, "EpsIndi": 11391, "Barnard": 7945,
}


def target_tiles():
    from astropy_healpix import HEALPix
    from astropy.coordinates import SkyCoord
    import astropy.units as u
    hp = HEALPix(nside=32, order="nested", frame="icrs")
    pts = {"RDra": (248.1689, 66.7525), "RWAur": (76.9564, 30.4011), "NEP": (270.0, 66.56), "SEP": (90.0, -66.56),
           "Pleiades": (56.75, 24.12), "Taurus": (68.0, 26.0), "GalCen_off": (266.0, -24.0), "HighLat": (180.0, 60.0)}
    out = dict(VALIDATION_TILES)
    for k, (ra, de) in pts.items():
        out[k] = int(hp.skycoord_to_healpix(SkyCoord(ra * u.deg, de * u.deg)))
    return out


def queue(priority: str, seed: int = 7):
    v = list(dict.fromkeys(target_tiles().values()))
    if priority == "validation":
        return v
    rest = [t for t in range(12288) if t not in set(v)]
    random.Random(seed).shuffle(rest)  # random order -> any partial run is a uniform sky sample
    return v + rest


def one(tile: int, out: str, timeout: int) -> dict:
    t0 = time.time()
    if (pathlib.Path(out) / f"tile_{tile}.parquet").exists() and not os.environ.get("CENSUS_REDO"):
        return dict(tile=tile, ok=True, s=0.0, skipped=True)   # done meanwhile by another node
    cmd = ["nice", "-n", "10", sys.executable, "-m", "census.tile_job", str(tile), "--out", out]
    err = ""
    for attempt in range(3):
        try:
            p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            err = f"timeout after {timeout}s"; break          # pathological tile: give up, final pass retries
        if p.returncode == 0:
            return dict(tile=tile, ok=True, s=time.time() - t0)
        err = p.stderr[-1500:]
        time.sleep(5 * (attempt + 1))
    (pathlib.Path(out) / f"tile_{tile}.err.txt").write_text(err)
    return dict(tile=tile, ok=False, s=time.time() - t0)


def du_gb(path: pathlib.Path) -> float:
    return sum(f.stat().st_size for f in path.glob("tile_*.parquet")) / 1e9


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(pathlib.Path.home() / "skylens" / "census_out"))
    ap.add_argument("--workers", type=int, default=48)
    ap.add_argument("--priority", choices=["validation", "allsky"], default="validation")
    ap.add_argument("--shard", default="0/1")
    ap.add_argument("--budget-gb", type=float, default=200.0, help="stop when outputs exceed this")
    ap.add_argument("--timeout", type=int, default=1800)
    ap.add_argument("--reverse", action="store_true", help="process the shard's queue from the end (to help another node)")
    ap.add_argument("--redo-older-than", default=None, help="rerun tiles whose qa version sorts below this (e.g. census-0.6)")
    a = ap.parse_args()
    out = pathlib.Path(os.path.expanduser(a.out)); out.mkdir(parents=True, exist_ok=True)
    i, n = map(int, a.shard.split("/"))
    def done(t):
        if not (out / f"tile_{t}.parquet").exists():
            return False
        if a.redo_older_than:
            try:
                v = json.loads((out / f"tile_{t}.qa.json").read_text()).get("version", "")
            except Exception:
                return False
            return v >= a.redo_older_than
        return True
    todo = [t for k, t in enumerate(queue(a.priority)) if k % n == i and not done(t)]
    if a.reverse:
        todo = todo[::-1]
    if a.redo_older_than:
        os.environ["CENSUS_REDO"] = "1"   # tiles to redo already exist on disk
    print(f"{len(todo)} tiles to run on shard {i}/{n}, {a.workers} workers, budget {a.budget_gb} GB", flush=True)
    log = open(out / f"run_log_shard{i}.jsonl", "a")
    done = 0; t0 = time.time()
    with ProcessPoolExecutor(a.workers) as ex:
        futs = {}
        it = iter(todo)
        for _ in range(a.workers):
            t = next(it, None)
            if t is not None: futs[ex.submit(one, t, str(out), a.timeout)] = t
        while futs:
            for f in as_completed(list(futs)):
                futs.pop(f)
                r = f.result(); done += 1
                log.write(json.dumps(r) + "\n"); log.flush()
                if done % 20 == 0:
                    used = du_gb(out); rate = done / (time.time() - t0) * 3600
                    print(f"{done}/{len(todo)} done, {rate:.0f} tiles/h, outputs {used:.1f} GB, "
                          f"free disk {shutil.disk_usage(out).free/1e12:.1f} TB", flush=True)
                    if used > a.budget_gb:
                        print("BUDGET REACHED - stopping submissions", flush=True); it = iter(())
                t = next(it, None)
                if t is not None: futs[ex.submit(one, t, str(out), a.timeout)] = t
                break


if __name__ == "__main__":
    main()
