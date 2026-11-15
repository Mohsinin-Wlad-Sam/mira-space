"""The film's sound: thirty seconds cut from one licensed piece, with a little sound design made here.

Music: "Time and Space" by Scott Buckley, released under CC BY 4.0 (www.scottbuckley.com.au). The piece has a quiet
piano part and then, at about 2:07, a full orchestra coming in on one beat. The cut puts that beat on the film's
fourth shot (the whole sky with every star caught moving) and lets the last second ring out in a reverberation when
the name appears. Everything else here is synthesised from sines and noise: a low drop at the start, a rise into the
orchestra's entry, soft ticks while the years run, a low note under the name. No other recording is used.

    python3 web/scripts/film_score.py timeandspace.mp3 out.wav [--hit 18.64] [--end 26.0]
"""
import subprocess, sys, wave
import numpy as np

SR = 48000
arg = lambda k, d: (sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d)
src, out = sys.argv[1], sys.argv[2]
T_HIT, T_END, DUR = float(arg("--hit", 18.64)), float(arg("--end", 26.0)), 30.0
FFMPEG = arg("--ffmpeg", "ffmpeg")

raw = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-i", src, "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
x = np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)
mono = x.mean(1)

# where the orchestra comes in: the steepest rise of the loudness between 2:06 and 2:09
hop = 240; e = np.sqrt(np.mean(mono[: len(mono) // hop * hop].reshape(-1, hop) ** 2, 1)); a, b = int(126.0 * SR / hop), int(129.0 * SR / hop)
sm = np.convolve(e, np.ones(8) / 8, "same"); k = a + int(np.argmax(sm[a + 12:b] / (sm[a:b - 12] + 1e-4))) + 6
# step back to the first frame of that rise
while k > a and e[k - 1] > 2.2 * np.median(e[k - 60:k - 10]): k -= 1
hit = k * hop / SR
print(f"orchestra enters at {hit:.3f} s of the piece; the film takes {hit - T_HIT:.2f} s to {hit - T_HIT + T_END:.2f} s")

n = int(DUR * SR); t = np.arange(n) / SR; i0 = int(round((hit - T_HIT) * SR)); dry = np.zeros((n, 2)); m = int(T_END * SR); dry[:m] = x[i0:i0 + m]
# the quiet part is raised so that it is heard on small speakers, and comes down again just before the entry
g = np.interp(t, [0, 1.6, T_HIT - 0.9, T_HIT - 0.05, DUR], [0, 2.0, 2.0, 1.0, 1.0]); dry *= g[:, None]
dry[m - int(0.03 * SR):m] *= np.linspace(1, 0, int(0.03 * SR))[:, None]

def lowpass(v, fc):
    al = 1 - np.exp(-2 * np.pi * fc / SR); o = np.empty_like(v); acc = 0.0
    for i in range(len(v)): acc += al * (v[i] - acc); o[i] = acc
    return o
def fftconv(sig, ir):
    L = 1 << int(np.ceil(np.log2(len(sig) + len(ir)))); return np.fft.irfft(np.fft.rfft(sig, L) * np.fft.rfft(ir, L), L)[: len(sig) + len(ir)]

# the room the last bar rings out in: decaying noise, darker as it fades
rng = np.random.default_rng(7); L_ir = int(4.6 * SR); ti = np.arange(L_ir) / SR
wet = np.zeros((n, 2)); s0 = int((T_END - 2.6) * SR); send = dry[s0:m] * np.linspace(0, 1, m - s0)[:, None] ** 1.5
for c in range(2):
    ir = rng.standard_normal(L_ir) * np.exp(-ti * 6.91 / 4.2); ir = lowpass(ir, 3800) ; ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
    w = fftconv(send[:, c], ir); w = w[: n - s0]; wet[s0:s0 + len(w), c] = w
wet *= 0.9 * np.sqrt(np.mean(dry[m - SR:m] ** 2)) / (np.sqrt(np.mean(wet[m:m + SR] ** 2)) + 1e-9)

fx = np.zeros(n)
def add(sig, at, gain_db): k0 = int(at * SR); k1 = min(n, k0 + len(sig)); fx[k0:k1] += sig[: k1 - k0] * 10 ** (gain_db / 20)
def tone_drop(f0, f1, dur, tau, second=0.0):
    tt = np.arange(int(dur * SR)) / SR; f = f1 + (f0 - f1) * np.exp(-tt / (dur * 0.25)); ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) + second * np.sin(2 * ph)) * np.exp(-tt / tau) * np.minimum(1, tt / 0.015)
add(tone_drop(62, 31, 4.5, 1.5, 0.35), 0.05, -12)                 # the opening: one low drop
add(tone_drop(70, 34, 2.4, 0.7, 0.3), T_HIT, -10)                 # under the orchestra's entry
add(tone_drop(46, 36, 4.0, 1.9, 0.25), T_END, -13)               # under the name
# a rise of air into the entry
dr = 1.5; tt = np.arange(int(dr * SR)) / SR; nz = rng.standard_normal(len(tt)); rise = lowpass(nz, 900) * 0.9 + lowpass(nz, 5200) * (tt / dr) ** 2 * 0.6
add(rise * (tt / dr) ** 2.4, T_HIT - dr, -17)
# soft ticks while the years run past (1999 to 2026)
tick = np.sin(2 * np.pi * 2100 * np.arange(int(0.012 * SR)) / SR) * np.exp(-np.arange(int(0.012 * SR)) / (0.0025 * SR))
for q in np.arange(6.45, 11.6, 0.118): add(tick, q, -33 + rng.uniform(-2, 2))
# the plotter drawing the spectrum, and a small click when the word arrives
dr = 2.5; tt = np.arange(int(dr * SR)) / SR; add(lowpass(rng.standard_normal(len(tt)), 2400) * np.sin(np.pi * tt / dr) ** 0.7, 12.75, -37)
add(np.sin(2 * np.pi * 1320 * np.arange(int(0.05 * SR)) / SR) * np.exp(-np.arange(int(0.05 * SR)) / (0.012 * SR)), 15.42, -27)

mix = dry + wet + fx[:, None]
mix *= np.interp(t, [0, 0.05, DUR - 0.9, DUR - 0.03, DUR], [0, 1, 1, 0, 0])[:, None]
# loudness: the orchestra's part at about -15 dBFS RMS, peaks held under -1 dBFS by a soft knee
loud = np.sqrt(np.mean(mix[int(T_HIT * SR):m] ** 2)); mix *= 10 ** (-15 / 20) / loud
pk = 10 ** (-1 / 20); knee = 0.7 * pk; over = np.abs(mix) > knee
mix[over] = np.sign(mix[over]) * (knee + (pk - knee) * np.tanh((np.abs(mix[over]) - knee) / (pk - knee)))
with wave.open(out, "wb") as f:
    f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR); f.writeframes((np.clip(mix, -1, 1) * 32767).astype("<i2").tobytes())
db = lambda v: 20 * np.log10(np.sqrt(np.mean(v ** 2)) + 1e-9)
print("loudness by part (dBFS RMS):", {k: round(db(mix[int(a * SR):int(b * SR)]), 1) for k, (a, b) in {"0-6": (0, 6), "6-12.5": (6, 12.5), "12.5-18.6": (12.5, T_HIT), "18.6-26": (T_HIT, T_END), "26-30": (T_END, DUR)}.items()}, "peak", round(20 * np.log10(np.abs(mix).max()), 1))
