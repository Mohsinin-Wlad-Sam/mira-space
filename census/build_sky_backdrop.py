"""The 3D map's sky backdrop from NASA's own SPHEREx all-sky picture.

IRSA serves the SPHEREx all-sky data cube as a HiPS (102 wavelengths, one "Allsky" preview per wavelength). This
script takes three groups of wavelengths (near 1.1, 2.2 and 4.4 um), averages each group, and writes a false-colour
panorama in Galactic coordinates in the layout the 3D map reads (x = Galactic longitude 0..360 from the left edge,
y = latitude +90 at the top). Re-run it after a new SPHEREx data release to refresh the backdrop.

    python census/build_sky_backdrop.py [--out web/public/space] [--check web/public/space/mw_2mass_4096.jpg]
"""
import argparse, io, urllib.request
import numpy as np
from PIL import Image

HIPS = "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube"
GROUPS = {"b": range(13, 20), "g": range(43, 50), "r": range(80, 90)}      # 0-based cube frames: ~1.03-1.17, 2.04-2.35, 4.26-4.57 um
A_G = np.array([[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],      # ICRS -> Galactic
                [0.4941094278755837, -0.4448296299600112, 0.7469822444972189],
                [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]])

def allsky(frame):
    url = f"{HIPS}/Norder3/Allsky{'' if frame == 0 else '_' + str(frame)}.png"
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "sky-backdrop-builder"}), timeout=120) as r:
        return np.asarray(Image.open(io.BytesIO(r.read())).convert("L"), dtype=np.float32)

def face_xy(nside, ra, dec):
    """HEALPix face and in-face pixel coordinates (nested scheme), vectorised; angles in radians."""
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

def panorama(W, swap=False):
    H = W // 2; X, Y = np.meshgrid(np.arange(W) + 0.5, np.arange(H) + 0.5)
    l = X / W * 2 * np.pi; b = np.pi / 2 - Y / H * np.pi
    g = np.stack([np.cos(b) * np.cos(l), np.cos(b) * np.sin(l), np.sin(b)], -1)
    e = g @ A_G                                    # x_icrs = A_G^T x_gal
    ra = np.arctan2(e[..., 1], e[..., 0]); dec = np.arcsin(np.clip(e[..., 2], -1, 1))
    face, ix, iy = face_xy(512, ra, dec)           # order 3 tiles of 64 x 64 pixels = nside 512
    tile = face * 64 + interleave(ix >> 6, iy >> 6, 3); sx = ix & 63; sy = iy & 63
    col, row = (sx, sy) if swap else (sy, sx)      # image tiles: column = HEALPix y, row = HEALPix x (as in web/src/blink/hips.ts)
    return (tile // 27) * 64 + row, (tile % 27) * 64 + col

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default="web/public/space"); ap.add_argument("--check", default=""); a = ap.parse_args()
    chan = {}
    for k, frames in GROUPS.items():
        imgs = [allsky(f) for f in frames]; chan[k] = np.mean(imgs, 0); print(k, "frames", list(frames), chan[k].shape, flush=True)
    for W in (4096, 2048):
        best = None
        for swap in ((False, True) if a.check and W == 2048 else (False,)):
            yy, xx = panorama(W, swap); rgb = []
            for k in "rgb":
                # black a little above the typical sky (the diffuse glow of the zodiacal light would otherwise wash the
                # backdrop out), white near the brightest parts of the Milky Way
                v = chan[k][yy, xx]; lo, hi = np.percentile(v, 45), np.percentile(v, 99.85)
                rgb.append(np.clip((v - lo) / max(hi - lo, 1e-6), 0, 1) ** 1.15)
            img = (np.stack(rgb, -1) * 255).astype(np.uint8)
            if a.check and W == 2048:
                ref = np.asarray(Image.open(a.check).convert("L").resize((W, W // 2)), dtype=np.float32); mine = img.mean(-1)
                c = np.corrcoef(ref.ravel(), mine.ravel())[0, 1]; print("orientation", "swapped" if swap else "as in hips.ts", "correlation with the 2MASS panorama:", round(float(c), 3), flush=True)
                if best is None or c > best[0]: best = (c, img)
            else: best = (1, img)
        Image.fromarray(best[1]).save(f"{a.out}/mw_spherex_{W}.jpg", quality=82); print("wrote", f"{a.out}/mw_spherex_{W}.jpg", flush=True)

if __name__ == "__main__":
    main()
