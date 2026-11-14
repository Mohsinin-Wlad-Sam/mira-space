# Peer-review synthesis (2026-11-14)

Reviewers: **K2 Horizon 375B** (IFM, via opencode) → `k2-horizon.md`; **Antigravity** (agy CLI) → `antigravity.md`.
Not obtained: **Codex** (CLI logged in, but every model returns "not supported when using Codex with a ChatGPT account"), **Gemini CLI** (needs interactive browser auth), **Volcano Engine/Doubao** (deliberately skipped: NASA China-affiliation eligibility review, see `01_challenge_analysis.md §3`).

Both reviewers were fact-checked against primary sources (Explanatory Supplement v2.1, arXiv API, our own TAP measurements). **Models produced several confident errors** — recorded here so no one copies them into slides.

## 1. Reviewer errors we rejected (with evidence)
| Claim | Reviewer | Truth | Source |
|---|---|---|---|
| SPHEREx is at Sun–Earth L2 | K2 | 680 km sun-synchronous LEO | Supplement §1.4; arXiv:2605.00851; 2508.20332 |
| Exposure = 112.5 s | K2 | 113.58 s (flight) | Supplement Table 2 |
| Barnard's Star J≈K≈9.9 | K2 | J=5.24, K=4.52 → heavily saturated | 2MASS |
| "~6–8 (λ,F) samples per epoch" | K2 | ~100–110 exposures per visit (full 102-channel spectrum each visit) | our TAP inventory |
| Perdelwitz+2018, Fortney+2016, Rustamkulov+2026 "unverifiable" | K2, AG | All exist: 1805.01203, 1604.07424, 2607.00543 | arXiv API |
| WISE 0855 invisible in Band 6 | AG | Band 6 (4.41–5.0 µm) is where W0855 peaks; PoC measures it | Supplement Table 2; Luhman 2311.17316 |
| Meisner 2018 = 1805.08217; Luhman 2024 = 2409.16368 | AG | 1710.02526; 2311.17316 (the AG IDs are unrelated papers) | arXiv API |
| Bands 1–3 PSF FWHM 1.5–2.2″ | AG | Delivered `PSF_FWHM` ≈ 7.5″ in headers | L2 header |

## 2. Points both reviewers agree on (accepted)
1. **The LVF "blinking lies" thesis is the strongest idea in the challenge.** Keep it as the narrative spine.
2. **Pixel-level differencing on resampled, undersampled frames will create dipoles at every star.** → Do *native-frame forward modelling*: catalog sources (Gaia/CatWISE, PM-propagated) × smooth per-source spectrum S_k(λ) × local ePSF at each exposure's exact sub-pixel position, subtracted in detector coordinates; reproject only residuals.
3. **Saturation is the norm for 3 of 5 targets** (Barnard, R Dra, ε Indi A; RW Aur partially). → OVERFLOW/TRANSIENT/NONLINEAR masking + ePSF-wing fitting (r ≈ 1.5–4.5 px); label results with "wing photometry" badges.
4. **Parallax from 2–3 visits at 6″/px is ill-conditioned.** → Fit 4-parameter PM by default; parallax only with the 16-yr unWISE+SPHEREx joint fit or a distance prior; show the parallax ellipse as illustration.
5. **Planet Nine is beyond SPHEREx depth** (predicted V≈21.9–22.7, 4.5 µm much fainter than 17.8–18.8 AB). → No "all-sky P9 engine". Keep a static "where to look" layer (B&B reference population minus ZTF/PS1/DES exclusions) + one honest injection–recovery demo.
6. **Prebake the demo targets** as static bundles on a CDN; live arbitrary-coordinate mode is secondary, capped and progressive.
7. **Cut/defer**: browser CNN + normalizing flow, 4-language UI, sonification. Prefer exact template χ² against SPHEREx empirical (SPIFF, Rustamkulov) + Sonora Elf Owl templates.
8. **Add an explicit limitations slide** and **uncertainty badges** on every number — raises Validity.
9. **R Dra's spectrum changes with phase**, so a static-spectrum model is wrong for it → per-visit spectra + band light curves (R Dra's near-continuous NEP coverage actually allows phase-binned spectra — K2 assumed only 3 epochs, which is false for R Dra).

## 3. New ideas adopted from reviewers
| Idea | From | Cost | Why it wins |
|---|---|---|---|
| **Velocity-gram radar**: SNR(μα, μδ) heatmap from spectrally-weighted shift-and-stack; click a peak → blink locks into the mover's rest frame | AG | ~4 h (WebGL/JS or precomputed) | Turns "shift-and-add" into discovery UX; visual, quantitative |
| **Methane-blink RGB**: B=1.20–1.32 µm (J peak), G=3.20–3.45 µm (CH4 trough), R=4.45–4.80 µm (window) | AG | ~2 h | T/Y dwarfs glow magenta while moving — impossible with WISE |
| **LVF rainbow curtain**: iso-λ contours sweep across the star while the spectrum fills in | AG | ~3 h | Teaches the instrument in 3 s |
| **Pluto cameo**: Tombaugh's discovery re-enacted with SPHEREx, Horizons track, CH4-ice spectrum | K2 | ~3 h | Perfect storytelling anchor for "Planet X" |
| **Latent/persistence causality tracer**: back-project a blip's detector pixel to what it saw 1–2 exposures earlier | AG | ~3 h | Instrument scientists on the panel will love it |
| **Spectral synthetic-object injection** (WiseView's injector, but with a real Y-dwarf spectrum through the LVF + ePSF) | AG/us | ~3 h | Interactive completeness: "could SPHEREx see a 300 K object at 3 pc here?" |
| "Catch the asteroid" mode with SkyBoT trails & STREAK flags | K2 | ~4 h | Engagement + teaches flags |
| Chromatic-PSF centroid vector field | K2 | ~3 h | Shows *why* naive subtraction fails |
| WISE 0855 W1-2010 contamination caveat in the bridge | K2 | 10 min | Honesty; cite 2505.12105 |

## 4. Our response on contested points
- **"Cut the on-the-fly spectrum (IRSA already does it)"** (K2): *Rejected.* IRSA's tool holds positions fixed; a 1–2 px drift between visits biases fluxes. Motion-tracked spectra are new, and the challenge explicitly gives "extra kudos" for spectra on the fly.
- **"Cut all AI"** (both): *Partially accepted.* AI is not core. GPUs are used for science (forward model, injection–recovery, velocity-grams over many fields). A small learned classifier is a stretch goal only if it beats template χ² on held-out SPIFF spectra.
