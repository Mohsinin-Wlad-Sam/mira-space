# Project Concept (v0.1 draft, pre-peer-review)

Working title: **TOMBAUGH-102: a spectro-temporal blink comparator for SPHEREx**

Clyde Tombaugh found Pluto in 1930 with a *blink comparator*: two plates of the same sky, flipped back and forth.
The challenge asks for a public SPHEREx "blink" tool. Our thesis is that doing this correctly for SPHEREx is a hard
research problem that nobody else at the hackathon will notice, and solving it is what makes a NASA scientist stop scrolling.

## 1. The core scientific insight (why a WiseView clone is *wrong* for SPHEREx)

SPHEREx is not a camera with filters. Each of its 6 H2RG detectors sits behind a **linear variable filter (LVF)**:
wavelength changes continuously across the detector (0.75-5.0 um, R=35-130). The survey steps the boresight by one
channel width per exposure (target groups of 17 pointings), so **every exposure of a given star samples it at a
different wavelength**.

Consequences for a naive flipbook of raw exposures:

1. **Spectral flicker masquerades as variability/motion.** A T/Y brown dwarf is ~10x brighter at 1.27 um than at
   1.6 um, nearly invisible in the 3.3 um CH4 band and brightest at 4.5 um. In a raw time-ordered flipbook it will
   "blink" wildly even though it is constant. Every star does this to a lesser degree.
2. **Time and wavelength are confounded.** Within a visit (about 1 hr per 17-exposure target group, about 1-3 weeks to
   cycle through all three detector pairs) the wavelength sweeps. Between visits (about 6 months) the source moves.
   A brightness change between frames is a mix of spectrum and variability.
3. **PSF is chromatic** (diffraction ∝ λ) and position-dependent (ePSF on a 21x21 grid per detector), so naive
   differencing leaves residuals.
4. **Motion is sub-pixel.** Pixels are 6.15", so Barnard's Star (10.4"/yr) moves about 1.7 px and WISE 0855 (8.1"/yr)
   about 1.3 px over the current about 1 yr baseline. You cannot see this by eye in a naive blink; you need centroid-level
   astrometry or difference imaging.

**Our tool is built around a forward model of the LVF.** Every frame we show is either *spectrally homogenized* or explicitly labeled
with its per-pixel wavelength, so what users perceive as change is real change.

## 2. Product pillars

### P1. Spectro-temporal blink engine (meets and exceeds every listed objective)
- Input RA/Dec (sexagesimal or degrees, or object name via Sesame), FOV slider, and URL-parameter embedding
  (`?ra=..&dec=..&fov=..&mode=..`).
- **Three frame modes:**
  - *Raw*: each exposure, time-ordered, with per-pixel wavelength annotation and flags.
  - *Epoch x Band coadds*: the WiseView analogue. Inverse-variance coadds per visit and per detector band (6 bands),
    zodi-subtracted and flag-masked, plus **synthetic WISE W1/W2 and 2MASS J/H/K bands** built by integrating the LVF
    samples against those filter curves.
  - ***Chromatic template subtraction* (novel)**: for each exposure *i*, subtract a static-sky model evaluated at that
    exposure's per-pixel wavelength map λᵢ(x,y), built from all *other* visits (leave-one-visit-out spectral
    interpolation per sky pixel). Static sources vanish at every wavelength. Movers show up as +/- dipoles and variables as
    monopoles. This removes the spectral flicker.
- Add/subtract epochs, motion-compensated stacking (user drags a proper-motion vector, frames re-registered
  along it, and a mover "snaps" into a sharp point).
- Overlays: Gaia DR3 (positions **propagated to each frame's epoch** with Gaia proper motion), CatWISE2020 motions,
  SIMBAD, known asteroids/comets at each exposure time (IMCCE SkyBoT / JPL SB-Ident), plus Aladin Lite context (DSS/2MASS/unWISE/SPHEREx HiPS cube).
- Flags: per-pixel bitmask layers (SOURCE, PERSIST, GHOST, STREAK, SNOWBALL, OVERFLOW, ...) toggleable as color overlays.

### P2. Spectra and light curves on the fly
- Click a source and run forced ePSF photometry in every exposure at its (moving) position, giving (t, λ, F, σ, flags).
- **102-channel spectrum** with molecular-band annotations (H2O 1.4/1.9/2.7 um, CH4 2.2/3.3 um, CO2 4.3 um, CO 4.6 um,
  H2O-ice 3.0 um, PAH 3.3 um, Paα/Brα).
- **Spectro-temporal decomposition** for variables: F(λ,t) = S(λ)·A(t) (rank-1), or low-rank/GP for Miras whose
  spectral shape changes with phase (R Dra: about 2,500 exposures near the NEP deep field). This gives a *spectrally
  corrected light curve* and *phase-resolved spectra*.
- Instant classification: template χ² / tiny neural classifier (in-browser) against SPHEREx empirical brown-dwarf
  spectra (Rustamkulov+2026; SPHEREx UCD library) and model grids (Sonora Elf Owl, ATMO2020), stellar SEDs, and quasars.
  Output: spectral type, Teff posterior, and "is this a brown dwarf?" probability.

### P3. SPHEREx astrometry: proper motion and parallax from 6" pixels
- Per-exposure ePSF centroid, re-registered on local Gaia stars (removes per-image WCS systematics).
- Fit (α₀, δ₀, μα*, μδ, ϖ) with SPHEREx's actual LEO/Earth-orbit parallax factors.
- **Validation slide:** Barnard's Star, Eps Indi B and WISE 0855 measured from SPHEREx alone vs Gaia/Spitzer literature values.
- **16-year bridge:** join unWISE time-resolved coadds (2010-2024, W1/W2) with SPHEREx synthetic-W1/W2 epochs (2025-26)
  into one continuous infrared flipbook and astrometric fit. WISE 0855 moves about 130" over the baseline, which is visible to anyone.

### P4. "Planet X Engine" (offline GPU pipeline, results browsable in the web tool)
- **Kinematic and spectral matched filter**: shift-and-stack exposures along trial trajectories, weighting each exposure
  by the template flux expected at its wavelength λᵢ (Y-dwarf template, cold-giant-planet model from Fortney+2016).
  - Nearby brown dwarfs: grid over proper motion (up to about 10"/yr) and parallax.
  - Distant planets (Planet Nine / "Planet X"): apparent motion over weeks is dominated by Earth's reflex parallax, a
    **one-parameter family in heliocentric distance** plus a small orbital drift (cf. Perdelwitz+2018 parallactic fitting),
    so the search space is tiny and GPU-feasible over large areas.
- **Injection-recovery** to produce honest completeness maps (what we could and could not have found).
- **Planet Nine probability layer**: Brown & Batygin (2021) synthetic reference population on the sky, with regions
  already excluded by ZTF/PS1/DES searches (Brown+2024), so users see *where* to look.
- Candidates go into a **citizen vetting queue** in the web tool, with an AI real/bogus score.

### P5. AI that costs nothing to host
- **Real/bogus CNN** on multi-epoch difference stamps, trained on our GPUs with injected synthetic movers and SPHEREx
  artifacts (labels from FLAGS: ghosts, persistence, crosstalk, snowballs, satellite streaks). Exported to ONNX and run
  **in the user's browser** (onnxruntime-web, WebGPU/WASM), so inference costs nothing.
- **Spectral classifier / amortized posterior** (small MLP / normalizing flow) trained on model grids convolved with SPHEREx
  response, also in-browser.
- An LLM is optional (an "explain this object" narrator); it is not core.

### P6. Public engagement and accessibility
- Guided tours: "Find Barnard's Star moving", "Watch a Mira breathe" (R Dra), "Why the brown dwarf blinks" (an explainer of the LVF).
- Sonification of spectra and light curves (accessibility).
- Shareable discovery reports: one click packages the candidate (coords, frames GIF, astrometry, spectrum, catalog
  cross-matches) as a citable JSON/PNG, for Backyard Worlds-style follow-up.
- Multilingual UI (EN/AR/FR/ES).

## 3. Architecture (cheap to host)
- **Frontend**: static site (Vite + TypeScript, WebGL canvas for frames, Plotly/uPlot for spectra, Aladin Lite v3 for
  context, onnxruntime-web for models). Hosted free (Cloudflare Pages / GitHub Pages).
- **Cutout service**: stateless FastAPI that does S3 *byte-range* reads of `nasa-irsa-spherex` (anonymous, us-east-1),
  extracts IMAGE/VARIANCE/FLAGS/ZODI rows plus the WCS-WAVE and ePSF rows for each exposure, reprojects to a common tangent grid
  and returns a compact binary bundle (float16/uint32). It is cached and runs on a small instance near us-east-1 or on Lambda.
  The IRSA cutout service (6-8 s and 4 MB per cutout, no CORS) is too slow for 250+ frames.
- **Metadata**: IRSA TAP (`spherex.plane` ⋈ `spherex.artifact`) for exposure discovery; automatically picks up new QR
  weekly releases, so it stays current with new data.
- **Prebaked demo bundles** for the five challenge targets as static files (instant demo and resilience to IRSA outages).
- **Offline GPU pipeline** (up to 8x RTX 5000 Ada): JAX/PyTorch scene modeling, shift-and-stack, injection-recovery,
  model training. Results are published as static HiPS/catalog files.

## 4. Why this can win
- *Relevance*: hits every listed objective and every "potential consideration" (6-array coadds, spectra on the fly,
  add/subtract, FOV, Gaia/WISE overlays, URL embedding, flags, Aladin, update-friendly).
- *Validity*: physics-correct handling of LVF data, quantitative validation against Gaia, injection-recovery completeness.
- *Creativity*: chromatic template subtraction, spectral matched-filter motion search, 16-yr WISE→SPHEREx bridge,
  parallax-family Planet X search, browser-side AI.
- *Impact*: directly usable by Backyard Worlds' about 100k volunteers (the challenge authors' community) and by professional astronomers.
- *Presentation*: "Pluto was found by blinking; with 102 colors, blinking lies to you. Here is how we fixed it."

## 5. Known risks (to be stress-tested)
- Saturation for bright targets (Barnard's Star, Eps Indi A, R Dra); need PSF-wing photometry and OVERFLOW handling.
- Undersampled PSF limits difference imaging; may need scene modeling instead of pixel-level templates.
- Data volume and latency for live queries (250-2,500 exposures per position).
- 48-hour build window; strict MVP prioritization required.
- Planet Nine depth: SPHEREx may not reach predicted P9 brightness. We present it as a method plus completeness, not a promised discovery.
