# 04 · Project Concept — v0.2 (post peer review)

> **TOMBAUGH-102** — *a blink comparator that tells the truth in 102 colors.*
> "Pluto was found by blinking two plates. Blink SPHEREx naïvely and every star flickers — because each exposure sees it at a different wavelength. We built the first time-domain viewer that models SPHEREx's linear variable filter, so what you see change is real change."

v0.1 (as reviewed) is archived at `peer-review/concept_v0.1_as_reviewed.md`; the review synthesis is `peer-review/00_synthesis.md`.

---

## 1. Scientific core (unchanged thesis, sharpened method)

**Problem.** SPHEREx's LVF maps wavelength to detector position; consecutive exposures of a source sample different λ (17-step target groups, 3 detector pairs, 2 visits/yr). A raw flipbook therefore shows (a) *spectral flicker* (a Y dwarf is ~0 at 3.3 µm and bright at 4.6 µm), (b) time–wavelength confounding, (c) chromatic, position-dependent, undersampled PSFs, and (d) sub-pixel motions (Barnard ≈ 1.7 px/yr, WISE 0855 ≈ 1.3 px/yr at 6.15″/px).

**Method — Native-frame spectro-kinematic scene model (the research contribution).**
For every exposure *i* (detector frame, no resampling):

  model_i(x) = B_i(x) + Σ_k  S_k(λ_{k,i}) · ePSF_i( x − x_k(t_i) ; λ_{k,i} )

- sources *k* from Gaia DR3 / CatWISE2020, positions **propagated to t_i** with catalog PM (and parallax);
- λ_{k,i} from the `WCS-WAVE` lookup at the source's pixel; ePSF from the image's own 21×21 `EPSF` grid (×5 oversampled);
- S_k(λ) = smooth per-source spectrum (B-spline in λ, ~20–30 knots across 0.75–5 µm) fit **leave-one-visit-out** across all exposures;
- B_i = ZODI layer + low-order local background; OVERFLOW/TRANSIENT/NONLINEAR/PERSIST/… pixels masked.

Residual frames r_i = data_i − model_i are free of spectral flicker *and* of static stars. Movers appear as un-modelled point sources, variables as scaled residuals. This is the point-source/time-domain analogue of Saydjari, Hogg et al. (2611.12846) LVF forward modelling and of the Tractor scene modelling used by IRSA (2511.15823) — but with **moving, time-propagated positions**, which no existing SPHEREx tool does (IRSA's Spectrophotometry Tool holds positions fixed).

Implementation: JAX/PyTorch batched over exposures on our RTX 5000 Adas (TractorJAX shows ~12 ms per 100×100 cutout on an H100, 2610.16007), run offline per bundle; a light JS version runs in-browser on clicked sources.

## 2. What ships (scope frozen for the 45-h window)

### Tier 0 — the spine (must work, end-to-end, for all 5 targets)
1. **Bundle builder** (Python, offline): TAP inventory → exact S3 byte-range reads → native stamps of IMAGE−ZODI, VARIANCE, FLAGS, λ-map, ePSF row, WCS, MJD, detector, PA → compact binary + JSON manifest. Prebaked for: Barnard, ε Indi (A+B in one FOV), WISE 0855, RW Aur, R Dra, **Pluto**, + 2 tour targets.
2. **Web viewer** (Vite + TS + WebGL2):
   - **Blink modes**: *Raw* (λ HUD + **LVF rainbow curtain**), *Visit × Band coadds* (6 bands + **synthetic W1/W2/J/H/K** from LVF response curves), ***De-flickered residuals*** (scene model), *Add/Subtract* (epoch A − epoch B; leave-one-visit-out templates).
   - **FOV** selector (bundles carry generous stamps; live mode trades FOV for latency), zoom/stretch/invert, blink speed, separate PA 0°/180° surveys (WiseView's "scan direction" analogue).
   - **Overlays**: Gaia DR3 **propagated to each frame's epoch**, CatWISE2020 motion vectors, SIMBAD labels, known SSOs at each exposure time (SkyBoT), flags as colour layers, Aladin Lite context (2MASS/unWISE/**SPHEREx DR1 HiPS cube**).
   - **Smart target resolution**: name or RA/Dec → if the catalog says it moves, show *where it is now* (WISE 0855's challenge coordinates are WISE-epoch; by 2025.9 it is ~2′ away).
   - **URL state & embed mode** (`?target=…&ra=…&dec=…&fov=…&mode=…&band=…&pm=…`).
3. **Click → motion-tracked spectrum + light curve** with molecular annotations (H2O, CH4 2.2/3.3, CO2 4.3, CO 4.6, H2O ice 3.0, PAH 3.3, Paα/Brα), saturation-aware (wing fit, badge), and **template χ² typing** against SPIFF/Rustamkulov SPHEREx empirical spectra + Sonora Elf Owl v2.
4. **Velocity-gram**: SNR(μα*, μδ) from spectrally-weighted shift-and-stack (weights = template flux at λ_i); click the peak → frames re-register in the mover's rest frame and the object "snaps" sharp. Readout: μ ± σ.
5. **Validation table** (the Validity slide): SPHEREx-only PMs for Barnard, ε Indi B (and A — common proper motion), WISE 0855 vs Gaia DR3 / literature; WISE 0855 SPHEREx spectrum vs JWST/NIRSpec (2311.17316) and Rustamkulov (2607.00543); R Dra light curve vs AAVSO phase.
6. **Discovery report export**: GIF (gifenc) + JSON (coords, epochs, PM fit, spectrum, cross-matches, flags), citable and Zooniverse/Backyard-Worlds-ready.

### Tier 1 — differentiators (in priority order)
7. **16-year bridge** (WISE 0855, Barnard, ε Indi B): unWISE epochal coadds 2010–2024 + SPHEREx synthetic-W1/W2 2025–26 in one flipbook + joint PM(+parallax) fit; on-screen caveat on the contaminated 2010 W1 epoch (2505.12105).
8. **Methane-blink RGB** (J-peak / CH4-trough / 4.6-µm window): T/Y dwarfs glow magenta.
9. **Pluto cameo**: Horizons track over SPHEREx frames; Tombaugh's 1930 plates side-by-side; Pluto's CH4-ice spectrum.
10. **Spectral synthetic-object injector**: drop a Y/T dwarf (distance, PM, Teff) into the *real* exposures via LVF + ePSF + VARIANCE → interactive completeness ("could SPHEREx have seen it here?").
11. **R Dra spectro-temporal panel**: per-visit spectra + synthetic-band light curves (J vs 3.3 µm vs 4.6 µm), phase-binned using its near-continuous NEP coverage.
12. **Persistence/latent tracer**: for a blip at detector pixel (x,y), show what that pixel saw 1–2 exposures earlier.

### Tier 2 — "Planet X" layer (honest, cheap)
13. Static sky layer: Brown & Batygin (2021) synthetic P9 reference population (100k clones, CaltechDATA) minus ZTF/PS1/DES exclusions (2401.17977) → "where it could still hide"; plus one **GPU injection–recovery demo** of the distance-family (parallax) shift-and-stack over one field with a completeness curve. Framed as method + limits, not a discovery claim.

### Explicitly out of scope (unless everything above is done)
In-browser CNN/normalizing flow; 4-language UI; sonification; all-sky search; citizen vetting backend. (A learned spectral classifier is allowed only if it beats χ² on held-out SPIFF spectra.)

## 3. Architecture
```
         offline (our GPUs / HPC)                         online (cheap)
IRSA TAP ─► bundle builder ─► scene model (JAX) ─►  static bundles + manifests ─► CDN (Cloudflare Pages/R2)
   │        (S3 byte ranges)   velocity-grams                                       │
   │                           injection–recovery                                   ▼
   └──────────────► live cutout API (FastAPI, us-east-1, capped/progressive) ─► browser viewer (WebGL2, uPlot, Aladin Lite)
                                                         SkyBoT / unWISE (CORS *) ◄─┘
```
- New weekly QR data → re-run the bundle builder (cron) → "easy to update".
- Demo never depends on a live backend (bundles are static); live mode is a bonus.

## 4. Why this wins (rubric mapping)
- **Relevance 5**: every objective + every listed consideration, on pixel-level SPHEREx DR1/QR3 data, with Gaia/WISE.
- **Validity 5**: forward model grounded in the instrument's own ePSF/LVF calibration; quantitative validation vs Gaia/JWST; injection–recovery; limitations slide; uncertainty badges.
- **Creativity 5**: first LVF-aware time-domain viewer; velocity-gram; methane-blink; spectral injection; 16-yr bridge.
- **Impact 5**: extends WiseView/Backyard Worlds past the end of NEOWISE (Aug 2024) into the SPHEREx era; open-source; embeddable.
- **Presentation 5**: Tombaugh → "blinking lies" → de-flicker → WISE 0855 snaps into focus → measured vs Gaia → where Planet X can still hide.

## 5. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Saturation (Barnard, R Dra, ε Indi A) | mask OVERFLOW/TRANSIENT/NONLINEAR; ePSF-wing fits; badge results; use ε Indi **B** for spectra |
| Scene-model residuals around bright stars | mask cores; show residual χ² map; fall back to visit-coadd differencing labelled "approximate" |
| IRSA/S3 slowness | prebaked bundles; builder runs near us-east-1 or overnight on HPC |
| Parallax ill-conditioned | PM-only fit by default; parallax only with 16-yr bridge or prior |
| Scope creep | tiers above; kill criteria in `05_build_plan.md` |
