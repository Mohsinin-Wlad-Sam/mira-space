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
T_HIT, T_END, DUR, CUT = float(arg("--hit", 18.64)), float(arg("--end", 26.0)), float(arg("--dur", 30.0)), int(arg("--cut", 2))
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
g = np.interp(t, [0, 1.6, T_HIT - 0.9, T_HIT - 0.05, DUR], [0, 2.0, 2.0, 1.0, 1.0])
if CUT == 3: g *= np.interp(t, [0, 10.6, 11.4, 21.2, 21.9, DUR], [1, 1, 0.6, 0.6, 1, 1])      # under the demonstrations the music steps back
dry *= g[:, None]
fl = int((0.6 if CUT == 5 else 0.03) * SR); dry[m - fl:m] *= (np.linspace(1, 0, fl) ** (1.5 if CUT == 5 else 1.0))[:, None]      # the fifth cut lets the orchestra fall away over half a second, with the picture

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
if CUT == 5:
    # the fifth cut: near silence, a breath of air into the orchestra's entry and a low note under it, the Lab's small
    # clicks, and nothing at all at the cut to black
    def swish(dur, fc): tt = np.arange(int(dur * SR)) / SR; return lowpass(rng.standard_normal(len(tt)), fc) * np.sin(np.pi * tt / dur) ** 2
    dr = 1.6; tt = np.arange(int(dr * SR)) / SR; nz = rng.standard_normal(len(tt)); add((lowpass(nz, 900) * 0.9 + lowpass(nz, 5200) * (tt / dr) ** 2 * 0.6) * (tt / dr) ** 2.4, T_HIT - dr, -18)
    add(tone_drop(70, 34, 2.6, 0.8, 0.3), T_HIT, -10)
    det = lambda: lowpass(rng.standard_normal(int(0.03 * SR)), 1600) * np.exp(-np.arange(int(0.03 * SR)) / (0.006 * SR))
    for q in (10.0, 12.0, 13.4, 14.9): add(det(), q, -22)
    add(swish(1.5, 2200), 16.3, -34)
elif CUT == 4:
    # the fourth cut: almost nothing but the music. Glass passing in front of the lens, a soft click when the time bar
    # seats and at each stop of the years, the plotter drawing the spectrum
    def swish(dur, fc): tt = np.arange(int(dur * SR)) / SR; return lowpass(rng.standard_normal(len(tt)), fc) * np.sin(np.pi * tt / dur) ** 2
    for k in range(6): add(swish(0.5, 2600 - 250 * k), 3.05 + 0.488 * k, -33)
    det = lambda: lowpass(rng.standard_normal(int(0.03 * SR)), 1600) * np.exp(-np.arange(int(0.03 * SR)) / (0.006 * SR))
    for q in (10.5, 13.1, 14.3, 15.6): add(det(), q, -24)
    add(swish(1.5, 2200), 16.95, -36)
elif CUT == 3:
    # the third cut: a pulse and a ping in the dark, clicks as the files fall, detents as the Lab is built, ticks as the
    # years run, two chimes when an instrument answers, a breath into the finale, a low note under the name
    add(tone_drop(44, 32, 2.8, 1.0, 0.5), 0.05, -11)
    ping = lambda f, d: np.sin(2 * np.pi * f * np.arange(int(d * SR)) / SR) * np.exp(-np.arange(int(d * SR)) / (0.18 * SR)) * np.minimum(1, np.arange(int(d * SR)) / (0.004 * SR))
    for k, (dt_, db_) in enumerate([(0.0, -22), (0.33, -30), (0.66, -38)]): add(ping(1760, 0.9), 0.45 + dt_, db_)
    tick = np.sin(2 * np.pi * 2100 * np.arange(int(0.012 * SR)) / SR) * np.exp(-np.arange(int(0.012 * SR)) / (0.0025 * SR))
    q = 2.05
    while q < 5.35: add(tick, q, -31 + rng.uniform(-2, 2)); q += 0.24 - 0.19 * (q - 2.05) / 3.3
    dr = 1.5; tt = np.arange(int(dr * SR)) / SR; nz = rng.standard_normal(len(tt)); add((lowpass(nz, 900) * 0.9 + lowpass(nz, 5200) * (tt / dr) ** 2 * 0.6) * (tt / dr) ** 2.4, T_HIT - dr, -17)
    add(tone_drop(70, 34, 2.4, 0.7, 0.3), T_HIT, -10)
    det = lambda: lowpass(rng.standard_normal(int(0.03 * SR)), 1800) * np.exp(-np.arange(int(0.03 * SR)) / (0.006 * SR))
    for q in (7.0, 7.62, 8.12, 8.72, 9.22): add(det(), q, -20); add(np.sin(2 * np.pi * 180 * np.arange(int(0.07 * SR)) / SR) * np.exp(-np.arange(int(0.07 * SR)) / (0.02 * SR)), q, -24)
    for q in np.arange(12.4, 15.1, 0.09): add(tick, q, -34 + rng.uniform(-2, 2))
    for q in (17.25, 19.95): add(ping(1318, 0.7) + 0.6 * ping(1976, 0.7), q, -25)
    dr = 0.7; tt = np.arange(int(dr * SR)) / SR; add(lowpass(rng.standard_normal(len(tt)), 3000) * np.sin(np.pi * tt / dr) ** 2, 21.2, -21)
    add(det(), 25.8, -22); add(tone_drop(46, 36, 3.0, 1.4, 0.25), T_END, -13)
else:
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
if CUT == 5: mix *= np.interp(t, [0, T_END - 0.3, T_END + 0.4, DUR], [1, 1, 0.5, 0.5])[:, None]      # the cut to black: what rings on is far quieter than what stopped
mix *= np.interp(t, [0, 0.05, DUR - (1.1 if CUT >= 3 else 0.9), DUR - (0.2 if CUT >= 3 else 0.03), DUR], [0, 1, 1, 0, 0])[:, None]
# loudness: the orchestra's part at about -15 dBFS RMS, peaks held under -1 dBFS by a soft knee
loud = np.sqrt(np.mean(mix[int(T_HIT * SR):m] ** 2)); mix *= 10 ** (-15 / 20) / loud
pk = 10 ** (-1 / 20); knee = 0.7 * pk; over = np.abs(mix) > knee
mix[over] = np.sign(mix[over]) * (knee + (pk - knee) * np.tanh((np.abs(mix[over]) - knee) / (pk - knee)))
with wave.open(out, "wb") as f:
    f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR); f.writeframes((np.clip(mix, -1, 1) * 32767).astype("<i2").tobytes())
db = lambda v: 20 * np.log10(np.sqrt(np.mean(v ** 2)) + 1e-9)
if CUT == 5: print("loudness (dBFS RMS):", {k: round(db(mix[int(a * SR):int(b * SR)]), 1) for k, (a, b) in {"0-6.5": (0, 6.5), "6.5-11": (6.5, 11), "11-22": (11, 22), "22-26": (22, 26), "26-27.5": (26, 27.5), "27.5-29": (27.5, DUR)}.items()}, "peak", round(20 * np.log10(np.abs(mix).max()), 1)); sys.exit(0)
if CUT == 4: print("loudness (dBFS RMS):", {k: round(db(mix[int(a * SR):int(b * SR)]), 1) for k, (a, b) in {"0-6.6": (0, 6.6), "6.6-12.9": (6.6, 12.9), "12.9-22": (12.9, 22), "22.4-26.3": (22.4, 26.3), "26.3-28": (26.3, 28), "28-29": (28, DUR)}.items()}, "peak", round(20 * np.log10(np.abs(mix).max()), 1)); sys.exit(0)
if CUT == 3: print("loudness (dBFS RMS):", {k: round(db(mix[int(a * SR):int(b * SR)]), 1) for k, (a, b) in {"0-2": (0, 2), "2-5.5": (2, 5.5), "5.5-11": (5.5, 11), "11-21.5": (11, 21.5), "21.5-26.5": (21.5, 26.5), "26.5-29": (26.5, DUR)}.items()}, "peak", round(20 * np.log10(np.abs(mix).max()), 1)); sys.exit(0)
print("loudness by part (dBFS RMS):", {k: round(db(mix[int(a * SR):int(b * SR)]), 1) for k, (a, b) in {"0-6": (0, 6), "6-12.5": (6, 12.5), "12.5-18.6": (12.5, T_HIT), "18.6-26": (T_HIT, T_END), "26-30": (T_END, DUR)}.items()}, "peak", round(20 * np.log10(np.abs(mix).max()), 1))
