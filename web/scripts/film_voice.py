#!/usr/bin/env python3
"""The film's narration and music, mixed.

The narration is a neural voice (Kokoro-82M, Apache-2.0, run on this machine: one WAV per line, made beforehand). It
is not changed in pitch: only its silences are trimmed, a line that would run into the next is shortened a little in
time, and it gets a light tone correction and a small room. The music is the calm opening of the licensed piece; it
steps back a little while the voice speaks.

    python3 web/scripts/film_voice.py <folder with the lines> <voice name> <music file> <out.wav> [--ffmpeg path]
"""
import subprocess, sys, wave
import numpy as np

arg = lambda k, d: (sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d)
folder, voice, music, out = sys.argv[1:5]; FF = arg("--ffmpeg", "ffmpeg"); SR = 48000; DUR = 29.0
STARTS = [0.5, 3.9, 7.25, 9.7, 13.0, 16.1, 19.0, 22.6, 26.2]            # when each line begins, with the picture


def dec(path, ch=1, af=None):
    cmd = [FF, "-v", "error", "-i", path] + (["-af", af] if af else []) + ["-ac", str(ch), "-ar", str(SR), "-f", "f32le", "-"]
    x = np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, np.float32).astype(np.float64)
    return x if ch == 1 else x.reshape(-1, 2)


def trimmed(x):
    nz = np.nonzero(np.abs(x) > 0.006)[0]
    return x[max(0, nz[0] - int(0.02 * SR)):nz[-1] + int(0.12 * SR)] if len(nz) else x


TONE = "highpass=f=60,equalizer=f=120:t=q:w=0.9:g=2,equalizer=f=3000:t=q:w=1.2:g=1.5,acompressor=threshold=-22dB:ratio=2.5:attack=10:release=160:makeup=3"
n = int(DUR * SR); vo = np.zeros(n); ends = STARTS[1:] + [DUR - 0.15]
for k, t0 in enumerate(STARTS):
    f = f"{folder}/{voice}_{k}.wav"; x = trimmed(dec(f, af=TONE)); room = ends[k] - t0 - 0.12
    if len(x) / SR > room:                                             # a little faster, at the same pitch
        x = trimmed(dec(f, af=f"atempo={min(1.18, len(x) / SR / room):.3f}," + TONE))
    x = x / max(1e-9, np.abs(x).max()) * 0.9; a = int(t0 * SR); b = min(n, a + len(x)); vo[a:b] += x[:b - a]
    print(f"line {k + 1}: {t0:5.2f} to {t0 + len(x) / SR:5.2f} s{'  (runs into the next line)' if t0 + len(x) / SR > ends[k] else ''}")
rng = np.random.default_rng(3); m = int(0.7 * SR); ir = rng.standard_normal(m) * np.exp(-np.arange(m) / SR / 0.16); ir[:int(0.012 * SR)] = 0
N = 1 << int(np.ceil(np.log2(n + m))); wet = np.fft.irfft(np.fft.rfft(vo, N) * np.fft.rfft(ir, N), N)[:n]
voice_sig = vo + wet * (np.sqrt(np.mean(vo ** 2)) / max(1e-9, np.sqrt(np.mean(wet ** 2)))) * 0.11

mus = np.zeros((n, 2)); seg = dec(music, ch=2)[:n]; mus[:len(seg)] = seg; t = np.arange(n) / SR
mus *= np.interp(t, [0, 0.4, 27.2, 28.9, DUR], [0, 1, 1, 0, 0])[:, None]
mus *= 10 ** (-17 / 20) / max(1e-9, np.sqrt(np.mean(mus[SR:int(26 * SR)] ** 2)))
w = int(0.25 * SR); sp = np.sqrt(np.convolve(voice_sig ** 2, np.ones(w) / w, "same")); duck = 1 - 0.42 * np.clip(sp / 0.08, 0, 1)
duck = np.convolve(duck, np.ones(int(0.2 * SR)) / int(0.2 * SR), "same")
mix = mus * duck[:, None] + (voice_sig * 10 ** (-1.5 / 20))[:, None]
pk = 10 ** (-1 / 20); knee = 0.7 * pk; over = np.abs(mix) > knee
mix[over] = np.sign(mix[over]) * (knee + (pk - knee) * np.tanh((np.abs(mix[over]) - knee) / (pk - knee)))
with wave.open(out, "wb") as f:
    f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR); f.writeframes((np.clip(mix, -1, 1) * 32767).astype("<i2").tobytes())
print("written", out, "peak", round(20 * np.log10(np.abs(mix).max()), 1), "dBFS")
