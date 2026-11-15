"""What only SPHEREx can show of the whole sky: its 102 wavelengths, turned into things the Sky map can use at once.

Input: the 102 all-sky preview frames of NASA's SPHEREx DR1 data cube (IRSA HiPS, order 3, 8-bit, asinh stretch between
0 and 40 MJy/sr as stated in the cube's `properties` file). census/wm_data.py downloads them; this script needs only
numpy and Pillow and runs in a couple of minutes on a laptop, so it is part of the update after each data release.

Output (Galactic panoramas, longitude 0..360 from the left edge, latitude +90 at the top, as the maps read them):
  frames/<k>.jpg      1024 x 512, one per wavelength: the wavelength slider no longer waits for the archive
  layer_stars.jpg     starlight, 1.0-1.3 um
  layer_pah.jpg       carbon dust (PAH) glowing at 3.3 um, with the light on either side of the band subtracted
  layer_hydrogen.jpg  hot hydrogen gas: the Brackett-alpha line at 4.05 um, neighbours subtracted
  layer_warm.jpg      cool stars and warm dust, 4.7-5.0 um (the cube has the Solar System's own dust glow already removed)
  layer_mix.jpg       the three in one picture: red = carbon dust, green = starlight, blue = hydrogen
  spectra.bin + spectra.json   the median spectrum of every 1.5-degree cell of the sky (240 x 120 x 100, one byte each)

    python -m census.sx_layers --frames ~/skylens/wm/sx --out ~/skylens/sx_layers [--check]
"""
import argparse, json, os, sys, time
import numpy as np
from PIL import Image
from census.build_sky_backdrop import panorama

LAM = [0.753, 0.771, 0.790, 0.809, 0.828, 0.848, 0.868, 0.889, 0.910, 0.932, 0.955, 0.978, 1.001, 1.025, 1.050, 1.075, 1.102, 1.113, 1.139, 1.167, 1.195, 1.224, 1.254, 1.284, 1.315, 1.346, 1.378, 1.412, 1.446, 1.481, 1.517, 1.554, 1.592,
       1.631, 1.656, 1.695, 1.735, 1.775, 1.818, 1.861, 1.905, 1.949, 1.995, 2.041, 2.089, 2.139, 2.189, 2.240, 2.292, 2.345, 2.399, 2.445, 2.506, 2.575, 2.646, 2.719, 2.794, 2.871, 2.951, 3.033, 3.118, 3.204, 3.293, 3.383, 3.476, 3.570,
       3.667, 3.768, 3.833, 3.867, 3.901, 3.935, 3.970, 4.005, 4.040, 4.076, 4.112, 4.148, 4.184, 4.220, 4.257, 4.294, 4.331, 4.368, 4.405, 4.435, 4.467, 4.500, 4.533, 4.566, 4.600, 4.635, 4.669, 4.704, 4.739, 4.773]
CUT = 40.0

def destretch(p, how="A"):
    """8-bit preview value -> MJy/sr. A: value = sinh(p/255 * asinh(40)) (Aladin's asinh between the cuts 0 and 40);
    B: the stretch with a softening of 10 that DS9 uses, kept for the comparison printed by --check."""
    x = p.astype(np.float32) / 255.0
    return np.sinh(x * np.arcsinh(CUT)) if how == "A" else CUT * np.sinh(x * np.arcsinh(10.0)) / 10.0

def enc(v, lo, hi, g=0.5):
    return np.clip(255 * np.power(np.clip((v - lo) / max(hi - lo, 1e-9), 0, 1), g), 0, 255).astype(np.uint8)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--frames", required=True); ap.add_argument("--out", required=True); ap.add_argument("--how", default="A"); ap.add_argument("--check", action="store_true")
    a = ap.parse_args(); src = os.path.expanduser(a.frames); out = os.path.expanduser(a.out); os.makedirs(f"{out}/frames", exist_ok=True); t0 = time.time()
    raw = {}
    for k in range(102):
        f = f"{src}/{k}.png"
        if os.path.exists(f): raw[k] = np.asarray(Image.open(f).convert("L"))
    ks = sorted(raw); print(f"{len(ks)} frames read, {raw[ks[0]].shape}", flush=True)
    lam = {k: LAM[k] if k < len(LAM) else None for k in ks}
    # the cube's own list has 102 wavelengths; the last few beyond this table are read from the properties file if present
    pf = f"{src}/properties"
    if os.path.exists(pf):
        import re; m = re.search(r"data_cube_crval3_arr\s*=\s*([^\n]+)", open(pf).read())
        if m: L = [float(x) for x in m.group(1).split()]; lam = {k: L[k] for k in ks if k < len(L)}
    ks = [k for k in ks if lam.get(k)]
    if a.check:
        # the sky brightness MIRA's Lab measured itself on single SPHEREx exposures at one high-latitude place
        ref = {1.0: 0.23, 2.0: 0.16, 3.0: 0.115, 4.0: 0.23, 4.4: 0.33, 5.0: 0.74}; ra, dec = 133.76, -7.24
        from census.wm_data import face_xy, interleave
        face, ix, iy = face_xy(512, np.array([ra]), np.array([dec])); tile = face * 64 + interleave(ix >> 6, iy >> 6, 3); row = (tile // 27) * 64 + (ix & 63); col = (tile % 27) * 64 + (iy & 63)
        for w, r in ref.items():
            k = min(ks, key=lambda q: abs(lam[q] - w)); p = raw[k][max(0, row[0] - 4):row[0] + 5, max(0, col[0] - 4):col[0] + 5]
            print(f"check {w} um (frame {k}, {lam[k]} um): preview level {np.median(p):.0f} -> A {np.median(destretch(p, 'A')):.3f}  B {np.median(destretch(p, 'B')):.3f} MJy/sr; the Lab measured {r}", flush=True)
    W = 3840; ri, ci = panorama(W); H = W // 2
    lin = {k: destretch(raw[k], a.how)[ri, ci] for k in ks}; print(f"panoramas {W}x{H} in {time.time() - t0:.0f}s", flush=True)
    def band(lo, hi): sel = [k for k in ks if lo <= lam[k] <= hi]; return np.mean([lin[k] for k in sel], 0), sel
    def near(w): return min(ks, key=lambda q: abs(lam[q] - w))
    blk = lambda x, n: x.reshape(x.shape[0] // n, n, x.shape[1] // n, n)
    # --- one picture per wavelength, 960 x 480 (shown stretched to the panorama), on one brightness scale per frame
    for k in ks:
        small = blk(lin[k], 4).mean((1, 3)); lo, hi = np.percentile(small, 2), np.percentile(small, 99.7)
        Image.fromarray(enc(np.arcsinh((small - lo) / max(hi - lo, 1e-6) * 12) / np.arcsinh(12), 0, 1, 1.0)).resize((1024, 512), Image.BILINEAR).save(f"{out}/frames/{k}.jpg", quality=82)
    # --- layers
    def save(name, v, plo=3, phi=99.6, g=0.5, size=(4096, 2048)):
        lo, hi = np.percentile(v, plo), np.percentile(v, phi); im = Image.fromarray(enc(v, lo, hi, g)).resize(size, Image.LANCZOS); im.save(f"{out}/{name}.jpg", quality=86); return lo, hi
    stars, s_sel = band(1.0, 1.3)
    cl, c1 = band(2.95, 3.13); cr, c2 = band(3.46, 3.68); kp = near(3.293); wl, wr = np.mean([lam[k] for k in c1]), np.mean([lam[k] for k in c2])
    cont = cl + (cr - cl) * (lam[kp] - wl) / (wr - wl); pah = lin[kp] - cont
    kb = near(4.052); ka, kc = near(3.97), near(4.148); hyd = lin[kb] - 0.5 * (lin[ka] + lin[kc])
    warm, z_sel = band(4.7, 5.01)
    smooth = lambda x: blk(x, 2).mean((1, 3))                                    # 2 x 2 means: the difference maps are noisy at full sharpness
    info = {"stars": save("layer_stars", stars), "pah": save("layer_pah", smooth(pah), 30, 99.8), "hydrogen": save("layer_hydrogen", smooth(hyd), 40, 99.9), "warm": save("layer_warm", warm, 2, 99.0, 0.6)}
    def ch(v, plo, phi, g=0.5): lo, hi = np.percentile(v, plo), np.percentile(v, phi); return enc(v, lo, hi, g)
    mix = np.stack([ch(smooth(pah), 30, 99.8), ch(smooth(stars), 3, 99.6), ch(smooth(hyd), 40, 99.9)], -1)
    Image.fromarray(mix).resize((4096, 2048), Image.LANCZOS).save(f"{out}/layer_mix.jpg", quality=86)
    # --- the spectrum of every 1.5-degree cell: median over its 16 x 16 samples (stars drop out, the glow stays)
    n = 16; cube = np.zeros((len(ks), H // n, W // n), np.uint8)
    for q, k in enumerate(ks):
        med = np.median(blk(lin[k], n).transpose(0, 2, 1, 3).reshape(H // n, W // n, n * n), -1)
        cube[q] = np.clip(np.round(32 * np.log1p(np.clip(med, 0, None) / 0.02)), 0, 255)
    cube.transpose(1, 2, 0).copy().tofile(f"{out}/spectra.bin")                 # [row][col][wavelength]
    json.dump({"w": W // n, "h": H // n, "n": len(ks), "frames": ks, "lam": [lam[k] for k in ks], "unit": "MJy/sr", "decode": "v = 0.02 * (exp(code / 32) - 1)", "saturates_at": CUT, "stretch": a.how,
               "layers": {"pah": {"line": lam[kp], "left": [lam[k] for k in c1], "right": [lam[k] for k in c2]}, "hydrogen": {"line": lam[kb], "sides": [lam[ka], lam[kc]]}, "stars": [lam[k] for k in s_sel], "warm": [lam[k] for k in z_sel]},
               "source": "SPHEREx DR1 all-sky data cube for visualisation, NASA/IPAC IRSA HiPS (8-bit previews)", "built": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())}, open(f"{out}/spectra.json", "w"))
    print(f"done in {time.time() - t0:.0f}s: {len(ks)} frames, layers {info}", flush=True)

if __name__ == "__main__":
    sys.exit(main())
