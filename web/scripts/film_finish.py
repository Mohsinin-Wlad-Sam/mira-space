"""Finish the film on a GPU: 144 photographed frames a second in, a 24-pictures-a-second film out.

What a camera would have done, done to frames photographed from the running site (web/scripts/render_film.mjs):
  - a half-open shutter: each picture is the average, in linear light, of the first three of its six sub-frames, so
    anything that moves is blurred along its path and nothing else is
  - the lens: a soft glow around the brightest points, and the horizontal streak an anamorphic lens draws through them
  - the stock: a gentle curve, cool shadows and warm highlights, darker corners, grain that changes every picture
The black bars and the credit line in them are left exactly as photographed. Nothing is added to the picture that
was not in the frames: no star, no object, no text.

    python web/scripts/film_finish.py --frames in/ --audio score.wav --out film.mp4 [--preview 3,9,16,20,27.5]
"""
import argparse, os, subprocess
import numpy as np, torch, torch.nn.functional as F
from PIL import Image

ap = argparse.ArgumentParser(); ap.add_argument("--frames", required=True); ap.add_argument("--out", required=True); ap.add_argument("--audio", default=""); ap.add_argument("--gpu", type=int, default=0)
ap.add_argument("--sub", type=int, default=6); ap.add_argument("--shutter", type=int, default=3); ap.add_argument("--fps", type=int, default=24); ap.add_argument("--seconds", type=float, default=30.0)
ap.add_argument("--preview", default=""); ap.add_argument("--bar", type=int, default=138); ap.add_argument("--ffmpeg", default="ffmpeg"); ap.add_argument("--crf", type=int, default=15)
a = ap.parse_args(); dev = torch.device(f"cuda:{a.gpu}" if torch.cuda.is_available() else "cpu")

def load(k):
    return torch.from_numpy(np.asarray(Image.open(os.path.join(a.frames, f"f{k:05d}.jpg")).convert("RGB")).copy()).to(dev).permute(2, 0, 1).float() / 255
def kern(sigma):
    r = max(1, int(3 * sigma + 0.5)); x = torch.arange(-r, r + 1, device=dev).float(); k = torch.exp(-x * x / (2 * sigma * sigma)); return k / k.sum()
def blur(img, sx, sy):      # img: C x H x W
    v = img[:, None]
    if sx > 0: k = kern(sx); v = F.conv2d(F.pad(v, (len(k) // 2, len(k) // 2, 0, 0), mode="reflect" if len(k) // 2 < v.shape[-1] else "replicate"), k[None, None, None, :])
    if sy > 0: k = kern(sy); v = F.conv2d(F.pad(v, (0, 0, len(k) // 2, len(k) // 2), mode="reflect"), k[None, None, :, None])
    return v[:, 0]
lum = lambda v: 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
col = lambda r, g, b: torch.tensor([r, g, b], device=dev)[:, None, None]

def finish(j, gen):
    sub = [load(a.sub * j + q) for q in range(a.shutter)]; lin = torch.stack([s ** 2.2 for s in sub]).mean(0); H, W = lin.shape[1:]; y0, y1 = a.bar, H - a.bar
    pic = lin[:, y0:y1]; L = lum(pic)
    # the lens
    hl = pic * (F.relu(L - 0.30) / (L + 1e-4))[None]; small = F.avg_pool2d(hl[None], 4)[0]
    glow = F.interpolate(blur(small, 6, 6)[None], size=pic.shape[1:], mode="bilinear", align_corners=False)[0] + 0.5 * F.interpolate(blur(small, 22, 22)[None], size=pic.shape[1:], mode="bilinear", align_corners=False)[0]
    st = (F.relu(L - 0.72) ** 1.5)[None]; s4 = F.avg_pool2d(st[None], (1, 4))[0]; streak = F.interpolate(blur(s4, 46, 0)[None], size=pic.shape[1:], mode="bilinear", align_corners=False)[0]; streak = blur(streak, 0, 1.3)
    pic = pic + 0.20 * glow * col(1.0, 0.86, 0.70) + 1.1 * streak * col(0.26, 0.52, 1.0)
    # the stock
    d = pic.clamp(0, 8) ** (1 / 2.2); d = d / (1 + 0.10 * d) * 1.10; Ld = lum(d).clamp(0, 1)
    d = d + ((1 - Ld) ** 3 * (Ld > 0.012))[None] * col(-0.004, 0.003, 0.011) + (Ld ** 2)[None] * col(0.014, 0.004, -0.012)
    d = Ld[None] + (d - Ld[None]) * 1.08
    yy, xx = torch.meshgrid(torch.linspace(-1, 1, d.shape[1], device=dev), torch.linspace(-1, 1, d.shape[2], device=dev), indexing="ij"); d = d * (1 - 0.22 * ((xx * xx + 0.55 * yy * yy) / 1.55).clamp(0, 1) ** 1.2)[None]
    g = torch.randn((1, 1, d.shape[1] * 2 // 3, d.shape[2] * 2 // 3), device=dev, generator=gen); g = F.interpolate(g, size=d.shape[1:], mode="bicubic", align_corners=False)[0]
    c = torch.randn((1, 3, d.shape[1] // 3, d.shape[2] // 3), device=dev, generator=gen); c = F.interpolate(c, size=d.shape[1:], mode="bilinear", align_corners=False)[0]
    d = d + (0.019 * g + 0.005 * c) * (0.30 + 0.70 * (1 - lum(d).clamp(0, 1)) ** 0.7)[None]
    full = lin.clamp(0, 1) ** (1 / 2.2); full[:, y0:y1] = d
    return (full.clamp(0, 1) * 255 + 0.5).byte().permute(1, 2, 0).contiguous().cpu().numpy()

gen = torch.Generator(device=dev); n = int(round(a.seconds * a.fps))
if a.preview:
    os.makedirs(a.out, exist_ok=True)
    for t in [float(v) for v in a.preview.split(",")]:
        j = min(n - 1, int(round(t * a.fps))); gen.manual_seed(1000 + j); Image.fromarray(finish(j, gen)).save(os.path.join(a.out, f"p{t:05.1f}.jpg"), quality=93)
    print("previews in", a.out)
else:
    cmd = [a.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "1920x1080", "-r", str(a.fps), "-i", "-"] + (["-i", a.audio] if a.audio else []) + \
          ["-c:v", "libx264", "-preset", "slow", "-crf", str(a.crf), "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"] + (["-c:a", "aac", "-b:a", "256k"] if a.audio else []) + ["-t", str(a.seconds), "-movflags", "+faststart", a.out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for j in range(n):
        gen.manual_seed(1000 + j); p.stdin.write(finish(j, gen).tobytes())
        if j % a.fps == 0: print(f"{j // a.fps} s of {a.seconds:.0f}", flush=True)
    p.stdin.close(); p.wait(); print("written", a.out, "exit", p.returncode)
