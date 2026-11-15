"""Pictures for the sky world model (census/wm_train.py): the same patches of sky as two NASA surveys saw them about
eleven years apart, read from the HiPS copies at NASA's infrared archive (IRSA).

  2MASS K   2.2 um, 1997-2001   JPEG tiles (IRSA serves no FITS for it)
  AllWISE W2 4.6 um, 2010-11    FITS tiles

Order 6 tiles are used: 512 x 512 pixels of 6.44", close to SPHEREx's 6.15" pixel, 0.92 degrees on a side.
Two sets are written under --out:
  train/  random tiles away from the Galactic plane (backgrounds; moving sources are painted in during training)
  test/   the tiles that hold real, Gaia-confirmed fast movers of MIRA's verified catalogue: never trained on
plus sx/, the 102 all-sky preview frames of the SPHEREx DR1 cube (for census/sx_layers.py).

    python -m census.wm_data --out ~/skylens/wm --objects ~/skylens/web_data/verified/objects.json --n 2400
"""
import argparse, json, os, random, sys, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np, requests

IRSA = "https://irsa.ipac.caltech.edu/data/hips"
TM, W2, SX = f"{IRSA}/CDS/2MASS/K", f"{IRSA}/CDS/AllWISE/W2", f"{IRSA}/SPHEREx/spherex_allsky_cube"
ORDER = 6

def face_xy(nside, ra, dec):
    """HEALPix face and in-face pixel coordinates (nested), vectorised, angles in degrees; nside a power of two."""
    ra = np.radians(np.asarray(ra, float)); dec = np.radians(np.asarray(dec, float))
    z = np.sin(dec); za = np.abs(z); tt = (ra % (2 * np.pi)) / (np.pi / 2)
    face = np.zeros(z.shape, np.int64); ix = np.zeros_like(face); iy = np.zeros_like(face)
    eq = za <= 2 / 3
    t1 = nside * (0.5 + tt[eq]); t2 = nside * z[eq] * 0.75
    jp = np.floor(t1 - t2).astype(np.int64); jm = np.floor(t1 + t2).astype(np.int64)
    ifp = jp // nside; ifm = jm // nside
    face[eq] = np.where(ifp == ifm, ifp | 4, np.where(ifp < ifm, ifp, ifm + 8))
    ix[eq] = jm & (nside - 1); iy[eq] = nside - (jp & (nside - 1)) - 1
    po = ~eq; ntt = np.minimum(3, np.floor(tt[po])).astype(np.int64); tp = tt[po] - ntt; tmp = nside * np.sqrt(3 * (1 - za[po]))
    jp = np.minimum(np.floor(tp * tmp).astype(np.int64), nside - 1); jm = np.minimum(np.floor((1 - tp) * tmp).astype(np.int64), nside - 1)
    north = z[po] >= 0
    face[po] = np.where(north, ntt, ntt + 8); ix[po] = np.where(north, nside - jm - 1, jp); iy[po] = np.where(north, nside - jp - 1, jm)
    return face, ix, iy

def interleave(x, y, bits):
    v = np.zeros_like(x)
    for b in range(bits): v |= ((x >> b) & 1) << (2 * b); v |= ((y >> b) & 1) << (2 * b + 1)
    return v

SUB = 16
def tile_rc(ra, dec, order=ORDER):
    """tile number and (row, col) in the JPEG orientation (row = HEALPix x, col = HEALPix y), to 1/16 pixel"""
    ns = 2 ** (order + 9); face, ix, iy = face_xy(ns * SUB, ra, dec)
    px, py = ix // SUB, iy // SUB
    tile = face * 4 ** order + interleave(px >> 9, py >> 9, order)
    return tile, (ix / SUB) - ((px >> 9) << 9) - 0.5 + 0.5 / SUB, (iy / SUB) - ((py >> 9) << 9) - 0.5 + 0.5 / SUB

def get(url, path, sess, tries=4):
    if os.path.exists(path) and os.path.getsize(path) > 2000: return True
    for k in range(tries):
        try:
            r = sess.get(url, timeout=60)
            if r.status_code == 404: return False
            if r.ok and len(r.content) > 2000:
                tmp = path + ".part"; open(tmp, "wb").write(r.content); os.replace(tmp, path); return True
        except Exception: pass
        time.sleep(1.5 * (k + 1))
    return False

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); ap.add_argument("--objects", default=""); ap.add_argument("--n", type=int, default=2400)
    ap.add_argument("--threads", type=int, default=24); ap.add_argument("--minpm", type=float, default=0.3); ap.add_argument("--maxtest", type=int, default=1400)
    a = ap.parse_args(); out = os.path.expanduser(a.out)
    for d in ("train/tm", "train/w2", "test/tm", "test/w2", "sx"): os.makedirs(f"{out}/{d}", exist_ok=True)
    from astropy_healpix import healpix_to_lonlat
    from astropy.coordinates import SkyCoord
    import astropy.units as u
    # --- real movers held out for testing
    test = {}
    if a.objects:
        c = json.load(open(os.path.expanduser(a.objects)))["cols"]; n = len(c["id"])
        rows = [k for k in range(n) if (c["pm"][k] or 0) >= a.minpm and c["gpm"][k] is not None and c["W2"][k] is not None and abs(c["glat"][k] or 0) >= 6]
        rows.sort(key=lambda k: -c["pm"][k]); rows = rows[: a.maxtest]
        ra = np.array([c["ra"][k] for k in rows]); dec = np.array([c["dec"][k] for k in rows]); t, r0, c0 = tile_rc(ra, dec)
        movers = []
        for q, k in enumerate(rows):
            movers.append({"id": c["id"][k], "ra": c["ra"][k], "dec": c["dec"][k], "pmra": c["pmra"][k], "pmdec": c["pmdec"][k], "pm": c["pm"][k], "yr": c["yr"][k], "W2": c["W2"][k], "K": c["K"][k],
                           "gpm": c["gpm"][k], "kind": c["kind"][k], "known": c["known"][k], "tile": int(t[q]), "row": float(r0[q]), "col": float(c0[q])})
            test[int(t[q])] = 1
        json.dump(movers, open(f"{out}/test/movers.json", "w"))
        print(f"{len(movers)} real movers (>= {a.minpm} arcsec/yr) in {len(test)} tiles held out", flush=True)
    # --- random backgrounds
    rng = random.Random(7); npix = 12 * 4 ** ORDER; train = []
    while len(train) < a.n:
        cand = [rng.randrange(npix) for _ in range(4000)]
        lon, lat = healpix_to_lonlat(np.array(cand), nside=2 ** ORDER, order="nested")
        b = SkyCoord(lon, lat, frame="icrs").galactic.b.to_value(u.deg)
        for p, bb in zip(cand, b):
            if abs(bb) >= 6 and p not in test and p not in train: train.append(p)
            if len(train) >= a.n: break
    json.dump(train, open(f"{out}/train/tiles.json", "w"))
    jobs = [("train", p) for p in train] + [("test", p) for p in test]
    jobs += [("sx", k) for k in range(102)]
    loc = __import__("threading").local(); done = [0, 0]; t0 = time.time()
    def work(j):
        s = getattr(loc, "s", None)
        if s is None: s = loc.s = requests.Session(); s.headers["User-Agent"] = "sky-world-model-builder"
        kind, p = j
        if kind == "sx": ok = get(f"{SX}/Norder3/Allsky{'' if p == 0 else '_' + str(p)}.png", f"{out}/sx/{p}.png", s)
        else:
            d = (p // 10000) * 10000
            ok = get(f"{TM}/Norder{ORDER}/Dir{d}/Npix{p}.jpg", f"{out}/{kind}/tm/{p}.jpg", s) and get(f"{W2}/Norder{ORDER}/Dir{d}/Npix{p}.fits", f"{out}/{kind}/w2/{p}.fits", s)
        done[0] += 1; done[1] += 0 if ok else 1
        if done[0] % 100 == 0: print(f"{done[0]}/{len(jobs)} fetched, {done[1]} missing, {time.time() - t0:.0f}s", flush=True)
    with ThreadPoolExecutor(a.threads) as ex: list(ex.map(work, jobs))
    print(f"DONE {done[0]} jobs, {done[1]} missing, {time.time() - t0:.0f}s", flush=True)

if __name__ == "__main__":
    sys.exit(main())
