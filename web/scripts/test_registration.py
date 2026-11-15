"""Are the Sky map's pictures where its coordinates say they are?

For each all-sky picture the map draws (2MASS, WISE, SPHEREx and the SPHEREx layers), this looks where well-known
bright stars actually appear in the picture and compares with where the map's own projection puts their catalogue
position (J2000, ICRS -> Galactic, the same matrix as web/src/skymap.ts). Prints the offsets in arcminutes.

    python3 web/scripts/test_registration.py            (needs numpy and Pillow)
"""
import math, sys, os
import numpy as np
from PIL import Image
STARS = {"Betelgeuse": (88.7929, 7.4071), "Antares": (247.3519, -26.4320), "Aldebaran": (68.9802, 16.5093), "Arcturus": (213.9153, 19.1824), "Sirius": (101.2872, -16.7161), "Canopus": (95.9880, -52.6957),
         "Vega": (279.2347, 38.7837), "Capella": (79.1723, 45.9980), "Rigel": (78.6345, -8.2016), "Procyon": (114.8255, 5.2250), "Achernar": (24.4285, -57.2368), "Altair": (297.6958, 8.8683), "Pollux": (116.3290, 28.0262),
         "Fomalhaut": (344.4127, -29.6222), "Regulus": (152.0930, 11.9672), "Spica": (201.2983, -11.1613), "Gacrux": (187.7915, -57.1132), "Mira": (34.8366, -2.9776), "R Doradus": (69.1900, -62.0775),
         "Alphard": (141.8968, -8.6586), "Mirach": (17.4330, 35.6206), "Dubhe": (165.9320, 61.7510), "Kochab": (222.6764, 74.1555), "Scheat": (345.9436, 28.0828), "Menkar": (45.5699, 4.0897), "Hamal": (31.7934, 23.4624),
         "Alpheratz": (2.0969, 29.0904), "Diphda": (10.8974, -17.9866), "Eltanin": (269.1516, 51.4889), "Arneb": (83.1826, -17.8223)}
A_G = np.array([[-0.0548755604162154, -0.8734370902348850, -0.4838350155487132], [0.4941094278755837, -0.4448296299600112, 0.7469822444972189], [-0.8676661490190047, -0.1980763734312015, 0.4559837761750669]])
def gal(ra, dec):
    a, d = math.radians(ra), math.radians(dec); e = np.array([math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d)]); g = A_G @ e
    return math.degrees(math.atan2(g[1], g[0])) % 360, math.degrees(math.asin(g[2]))
def run(path):
    im = np.asarray(Image.open(path).convert("L"), dtype=np.float32); H, W = im.shape; pix = 360 * 60 / W; R = max(4, round(40 / pix)); out = []
    for name, (ra, dec) in STARS.items():
        l, b = gal(ra, dec)
        if abs(b) < 5: continue                                   # in the plane a single star does not stand out
        x, y = l / 360 * W - 0.5, (90 - b) / 180 * H - 0.5; xi, yi = int(round(x)), int(round(y))
        if not (R + 2 <= yi < H - R - 2): continue
        cols = np.arange(xi - R, xi + R + 1) % W; win = im[yi - R:yi + R + 1][:, cols]; med = np.median(win); sd = np.median(np.abs(win - med)) * 1.4826 + 1e-6
        # a star is either a bright spot or, where the survey masked it, a hole: take whichever stands out more
        hi, lo = win.max() - med, med - win.min(); z = win - med if hi >= lo else med - win
        if max(hi, lo) < 6 * sd and max(hi, lo) < 40: continue
        w = np.clip(z - 0.5 * z.max(), 0, None); gy, gx = np.mgrid[-R:R + 1, -R:R + 1]; cx, cy = (w * gx).sum() / w.sum(), (w * gy).sum() / w.sum()
        dx, dy = (xi + cx - x) * pix * math.cos(math.radians(b)), (yi + cy - y) * pix
        out.append((name, math.hypot(dx, dy), "spot" if hi >= lo else "hole"))
    d = sorted(o[1] for o in out)
    return {"file": os.path.basename(path), "pixel_arcmin": round(pix, 2), "stars": len(out), "median_arcmin": round(d[len(d) // 2], 2) if d else None, "p90_arcmin": round(d[int(0.9 * (len(d) - 1))], 2) if d else None, "worst": max(out, key=lambda o: o[1]) if out else None}
if __name__ == "__main__":
    root = os.path.join(os.path.dirname(__file__), "..", "public", "space")
    for f in ["mw_2mass_4096.jpg", "mw_wise_4096.jpg", "mw_spherex_4096.jpg", "sx/layer_stars.jpg", "sx/frames/12.jpg"]:
        p = os.path.join(root, f)
        if os.path.exists(p): print(run(p))
