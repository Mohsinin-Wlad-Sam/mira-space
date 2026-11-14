#!/usr/bin/env python3
"""Build flipbooks for the top candidates of each web feed (ids = '<tile>-<obj>', as used by the web app).

usage: python -m census.flipbook_batch --web ~/skylens/web_data --top 150 --parallel 4 --workers 16
"""
from __future__ import annotations

import argparse, json, os, pathlib, sys, time
from concurrent.futures import ProcessPoolExecutor, as_completed

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from census.flipbook import build  # noqa: E402

TREF_YEAR = 2016.4  # census reference epoch (positions ra/dec in the feeds)


def job(o, out, workers):
    oid = f"{o['tile']}-{o['obj']}"
    if (out / f"{oid}.json").exists():
        return oid, "exists"
    pmra = (o.get("pmra") or 0.0) * 1000 if o.get("reliable_motion") else 0.0   # ″/yr -> mas/yr
    pmdec = (o.get("pmdec") or 0.0) * 1000 if o.get("reliable_motion") else 0.0
    try:
        m = build(oid, oid, o["ra"], o["dec"], pmra, pmdec, TREF_YEAR, out, 40, workers, max_frames=400)
        return oid, f"{m['n']} frames"
    except Exception as e:  # noqa: BLE001
        return oid, f"FAILED {e}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--web", default="~/skylens/web_data"); ap.add_argument("--top", type=int, default=150)
    ap.add_argument("--parallel", type=int, default=4); ap.add_argument("--workers", type=int, default=16)
    a = ap.parse_args()
    web = pathlib.Path(os.path.expanduser(a.web)); out = web / "flipbook"; out.mkdir(parents=True, exist_ok=True)
    objs, seen = [], set()
    for feed in ("movers", "methane", "vanished", "brightened"):
        p = web / f"{feed}.json"
        if not p.exists(): continue
        for o in json.loads(p.read_text())["items"][: a.top]:
            k = (o["tile"], o["obj"])
            if k not in seen: seen.add(k); objs.append(o)
    print(f"{len(objs)} objects to build", flush=True)
    t0 = time.time()
    with ProcessPoolExecutor(a.parallel) as ex:
        futs = [ex.submit(job, o, out, a.workers) for o in objs]
        for n, f in enumerate(as_completed(futs), 1):
            oid, status = f.result()
            if n % 10 == 0 or "FAILED" in status:
                print(f"{n}/{len(objs)} {oid}: {status} ({(time.time()-t0)/60:.1f} min)", flush=True)


if __name__ == "__main__":
    main()
