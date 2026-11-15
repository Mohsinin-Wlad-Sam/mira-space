"""Every Gaia DR3 star that moves faster than 0.15 arcsec a year, from ESA's Gaia archive (one asynchronous TAP job).
These are the real examples the larger sky world model learns from and is tested against (census/wm2_train.py).

    python -m census.wm2_gaia --out ~/skylens/wm2/gaia_pm150.csv
"""
import argparse, os, sys, time, requests

TAP = "https://gea.esac.esa.int/tap-server/tap/async"
Q = "SELECT source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag, bp_rp FROM gaiadr3.gaia_source WHERE pm > 150"

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); a = ap.parse_args(); out = os.path.expanduser(a.out)
    r = requests.post(TAP, data={"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "PHASE": "RUN", "QUERY": Q}, allow_redirects=False, timeout=120)
    job = r.headers.get("Location"); print("job", job, flush=True); t0 = time.time()
    while True:
        ph = requests.get(job + "/phase", timeout=60).text.strip(); print(ph, f"{time.time() - t0:.0f}s", flush=True)
        if ph in ("COMPLETED", "ERROR", "ABORTED"): break
        time.sleep(5)
    if ph != "COMPLETED": sys.exit("the archive did not finish the query")
    c = requests.get(job + "/results/result", timeout=600).content; open(out, "wb").write(c); print("rows", c.count(b"\n") - 1, "bytes", len(c))

if __name__ == "__main__":
    main()
