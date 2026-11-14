# AI physical parameters and the 3D Space view

## What it does
Every census object with a SPHEREx spectrum (132,041,153 objects) gets an AI estimate of
- **absolute infrared brightness** M_W2 → **distance** d = 10^((W2 − M_W2 + 5)/5) pc,
- **temperature** (log Teff),
- **kind**: dwarf star, giant/evolved star, brown dwarf (L/T/Y), galaxy/quasar,

each with its own uncertainty. The web's 3D Space view places objects by Gaia DR3 parallax where it is good
(plx/err > 5, RUWE < 1.4), by UltracoolSheet parallax for brown dwarfs, and by the AI otherwise
(only when its distance uncertainty is below ±45% and the object is not extragalactic).

## Model (census/ai_phys.py)
- Input (209 features): SPHEREx spectrum shape log10(f/median f) over 102 channels plus a validity mask, WISE W1−W2,
  reduced proper motion H_W2 = W2 + 5 log μ + 5 (only when the 16-year motion is significant), sin|b|.
  Apparent brightness alone is never an input.
- Network: MLP 209 → 512 → 512 → 256, heads for (M, log σ_M), (log T, log σ_T) and 4 class logits.
- Loss: heteroscedastic Gaussian NLL with label errors added in quadrature (σ² = σ_pred² + σ_label²), plus class
  cross-entropy with inverse-frequency weights; brown dwarfs up-weighted ×20.
- Deep ensemble: 3 bootstrap members trained in parallel, one per RTX 5000 Ada GPU (20 epochs, ~40 s each,
  data GPU-resident). Total σ = sqrt(mean aleatoric² + ensemble variance).
- Labels: 2,469,419 sampled spectra (≤120 per HEALPix tile, S/N > 10, isolated, plus every reliable mover);
  Gaia DR3 cross-match via IRSA TAP (1.5″, epoch-propagated to 2016.0) gives 1,569,036 M_W2 and 1,542,826 Teff
  labels; UltracoolSheet v2.1 (Best et al., Zenodo 15802304) adds 1,487 brown-dwarf parallaxes / 1,265 L/T/Y types.
- Inference: all 12,274 tiles, 132 M objects, 90 s on 3 GPUs.

## Hold-out validation (every 10th HEALPix tile, never seen in training)
| test | objects | result | within ±1σ (ideal 68%) |
|---|---|---|---|
| distance, stars with Gaia parallax | 156,577 | 0.59 mag → **27%** | 72% |
| distance, brown dwarfs (UltracoolSheet) | 164 | 0.45 mag → **21%** | 55% (errors under-estimated) |
| distance, giants | 17,453 | 1.32 mag → 61% (bias +0.7 mag) | 65% |
| temperature | 155,038 | **4.0%** scatter | 75% |
| kind (4 classes) | 162,442 | **89.5%** correct; brown dwarfs 98% recovered, galaxies/QSOs 98% | – |
Main confusion: 10% of dwarfs are called giants (class weights favour the rare class).

## 3D catalogue (census/export_space.py → data/space/)
32-byte records: Galactic XYZ (pc), velocity (0.1 km/s), Teff, M_W2, class/source flags, σ_ln d, lens bits,
measured 2016→2025 brightness change, census id. 401,522 placeable objects (Gaia 333,304; UltracoolSheet 839; AI 67,379)
plus 2,627 named Gaia neighbours. core.bin 2.8 MB (phones), deep.bin 8.3 MB (desktop, on demand).
Velocities: tangential from the census' own 16-year proper motion × distance (4.74 km/s per ″/yr·pc) + Gaia RV where measured.
Rendering: apparent magnitude from the camera m = M + 5 log10 r − 5 per vertex, straight-line motion p0 + v t per vertex.
Checks: Barnard's Star 5.96 ly, 142.6 km/s, RV −110.4 km/s (lit. −110.6); closest approach 3.77 ly in AD ~11,700.

## Hosting
Total static data ≈ 0.7 GB (≈ 0.35 GB gzipped): flipbooks 443 MB, object details 136–190 MB, twins 47 MB,
sky lenses 27 MB, 3D 11 MB, backdrops 3 MB. Without flipbooks ≈ 0.25 GB. Sky imagery streams from IRSA.
