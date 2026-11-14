# 08 · Direction v2 — SKYLENS (replaces the brown-dwarf-focused TOMBAUGH-102 as the product)

> **SKYLENS — look through the infrared sky in color, chemistry and time.**
> A public web app that lets anyone point physics "lenses" at *any* part of the sky and see what things are made of, what moved, and what changed, using NASA SPHEREx's 102 colors bridged to 15 years of WISE. Click anything that lights up and its full SPHEREx history opens: a wavelength-honest time-lapse, an on-the-fly spectrum, a motion check, flags and cross-matches. All of it is shareable by URL.

Why the change: the team lead judged v1 (LVF-aware blink comparator + brown-dwarf PMs + Planet Nine) **too niche**. v2 is **broad** (every object class, the whole sky, students to professionals) and **discovery-first** (no coordinates needed), and it keeps v1's obsessive physics as the inside of every feature. Independent ideation by Codex gpt-6-luna, Antigravity and K2 Horizon (`docs/ideation/`) converged on the same ingredients (lenses, 16-yr WISE↔SPHEREx bridge, evidence-first discovery feed, flags as UI), and all three warned against cube-minus-exposure residual catalogs and black-box embeddings. This design follows those warnings.

## 1. The product: three ways to discover, one place to verify

### Discover A — Chemistry lenses ("what is it made of?"), anywhere on the sky
Lenses are physical band-index tests computed **in the browser** from the DR1 102-channel all-sky cube, which we read by byte range from NASA's public bucket (each channel plane is a contiguous 1 MB block per 1.8° tile, CORS *). Sources are detected in the field, measured with local-background photometry, and scored. Hits glow as markers on the sky map.

| Lens | Test (µm) | Lights up |
|---|---|---|
| Methane worlds | J(1.20–1.32) & window(4.45–4.80) ≫ CH4(3.20–3.45) | T/Y brown dwarfs (cold "Planet X" cousins) |
| Water ice | 3.0-µm ice absorption vs 2.4/3.6 continuum | ice-mantled young stars, cold cloud cores |
| Water vapor | 1.9/2.7 µm H2O bands vs 2.2/1.6 µm | Mira/AGB stars (R Dra), M dwarfs |
| Hot dust | 4.6 µm excess over a stellar 1.6/2.2 µm baseline | disks around young stars (RW Aur), AGN |
| Hydrogen glow | Paα 1.875 / Brα 4.05 line-to-continuum | HII regions, YSO accretion, emission-line stars |
| CO2 / comets | 4.26 µm emission | comets, ice-rich bodies |
| Quasar Hα (z≈4–6) | Hα redshifted into 3.3–4.6 µm vs neighbors | high-z quasars ("from the couch", 2603.10135) |
| Custom | user paints three windows on the spectrum | anything |

### Discover B — Time lenses ("what moved, what changed?")
- **Decade lens (anywhere, on demand):** WISE era (unWISE neo7 W1/W2, CORS) vs SPHEREx era (cube synthesized through the W1/W2 passbands), registered, PSF-matched and flux-scaled. **Movers appear as ± dipoles** (anything with μ ≳ 0.5″/yr moves ≥ 1 SPHEREx pixel over about 10 yr); **long-term variables appear as monopoles**. Proven on Barnard's Star (`data/poc/decade_Barnard.png`).
- **Year lens (small FOV, on demand):** SPHEREx survey A vs B from L2 exposures (our range reader), compared **at matched wavelength** (|Δλ|/λ < 1/R) or after dividing by the source's baseline spectrum, so no wavelength flicker leaks in.
- **Hour lens:** the 17-exposure target-group sequence shows asteroids streaking; IMCCE SkyBoT marks known bodies at each exposure's mid-time.

### Discover C — Twins ("find more like this")
From any object's spectrum, build a normalized matched filter and score every source in the field for **spectral similarity**. The score is explainable: a feature radar shows *why* it matched (CH4 depth, 4.6-µm excess, ice, H2O, slope, motion). No black-box embedding.

### Verify — the Object Dossier (the challenge's required tool, done right)
Name or RA/Dec (catalog positions propagated to the SPHEREx epoch), or a click on any lens hit, opens:
- **Time-lapse** of every L2 exposure: *raw with per-frame wavelength label* · *per-band (6 detector) coadds per visit* · *spectrum-normalized "de-flashed" blink* · *add/subtract epochs* · *FOV control* · Gaia (epoch-propagated), CatWISE and SkyBoT overlays · **22-bit flag X-ray** with plain-language explanations.
- **Spectrum on the fly** from L2 exposures (motion-tracked extraction) and from the cube, with molecular bands annotated and an SPIFF/Sonora template match.
- **Light curve that doesn't lie**: same-wavelength or baseline-normalized points only, wavelength encoded in colour.
- **Motion refocus**: proper-motion slider + auto-fit; the smeared source snaps sharp (μ ± σ shown).
- **Evidence card**: catalog matches labelled "matched / no match in queried catalogs / uncertain" (never "new"), share URL, embed `<iframe>`, JSON + GIF export, "copy the astropy snippet that reproduces this".

### Sky Safari — discovery with zero knowledge
A feed and sky map of **precomputed lens hits** over ~200 tiles in diverse environments (deep fields, star-forming clouds, Galactic plane, high latitude, ecliptic), computed overnight on our GPUs/HPC, plus guided quests ("Find a cold world", "Catch a moving star", "Watch a star breathe": the 5 challenge targets are the tutorial). Users classify hits; triage, not confirmation.

## 2. Evidence that it works (measured 2026-11-14)
| Mechanism | Test | Result |
|---|---|---|
| L2 time-lapse data path | 93 WISE 0855 cutouts via S3 byte ranges | 19 s; W0855 S/N 3–8/exposure, 15–30/visit; SPHEREx-only PM −7.3″/yr (lit. −8.1) |
| Cube lens data path | 17 channel strips (4.2 MB) per 26′ field | ~3.5 s |
| Methane lens selectivity | rank of target among the 144 brightest 4.6-µm sources | **ε Indi B #1**, WISE 0855 #7 (J-weak Y dwarf → needs a Y-variant lens) |
| Decade lens | Barnard's Star, unWISE W2 vs cube synth-W2, 4.8 MB | huge dipole (~100″ displacement); field-star residual dipoles → need sub-pixel registration + PSF-kernel fit |
| Browser-direct access | CORS on S3 bucket, unwise.me, SkyBoT | all `*` |
| Archive scale | `SELECT COUNT(*) FROM spherex.plane` | 1,628,318 L2 images (~107 TB) → never process all; lenses use the cube (≈3.9 TB, read only needed planes) |

## 3. The small details (what SPHEREx/WiseView scientists will check)
1. ZODI subtracted by default, with a toggle that shows the zodiacal glow.
2. Per-pixel, per-exposure wavelength from `WCS-WAVE`; never a nominal band label.
3. MJy/sr → µJy via pixel solid angle with ePSF-weighted photometry; units always stated.
4. Same-wavelength or spectrum-normalized comparisons only; the λ/t confound is explained in the UI.
5. All 22 FLAGS bits decoded; masks shown per exposure; cube NHITS/FLAGS used for lens reliability.
6. Catalog positions propagated with PM to each frame's MJD (WISE 0855's challenge coordinates are ~2′ out of date).
7. Resolution honesty: 6.15″ native L2 vs 12.9″ cube vs 2.75″ unWISE pixels, labelled; PSF-matched before any difference.
8. unWISE headers carry `EQUINOX=-1` (bogus FK4) → force ICRS (found today).
9. Striping near bright lines in the cube (Paα, Brα, He 1.083) → lens hits on extended emission flagged "diffuse".
10. Every number has ± and provenance; "unexplained" = "no match in the catalogs we queried".

## 4. Architecture & cost
- **Static frontend** (Vite + TS, Aladin Lite v3, WebGL2, uPlot) on Cloudflare Pages: free.
- **Browser does the science** for lenses and decade lens (NASA S3 + unWISE + SkyBoT, all CORS).
- **Small API** (FastAPI): IRSA TAP inventory, catalog proxies (Gaia/CatWISE/SIMBAD, cached), L2 cutout bundling for dossiers. One small instance near us-east-1 (≈ $0–12/month).
- **Offline GPUs/HPC**: Sky Safari precompute (~200 tiles × ~40 channel planes ≈ 8 GB of reads), demo bundles, validation. Optional small spectral classifier (stretch).

## 5. 41-hour plan (replaces the scope in `05_build_plan.md`; same roles)
| Window (+04) | Data/API | Science | Frontend |
|---|---|---|---|
| Sat 03–10 | TAP+cutout API; bundles for 5 targets; catalog proxies | lens library v1 (source detection, local bkg, indices, noise) in Python, port to TS | app shell, Aladin map, URL state, dossier skeleton (time-lapse modes, flags X-ray) |
| Sat 10–18 | Sky Safari tile list + precompute runner | decade lens registration (Gaia-anchored) + PSF kernel fit; Y-dwarf lens variant | lens UI (in-browser cube reads, glowing markers), spectrum panel (cube + L2), overlays |
| Sat 18 – Sun 02 | precompute ~200 tiles; vetting pills | year lens (matched-λ); motion refocus fit; twins matched filter | decade lens view; twins; light curve; export/share/embed |
| Sun 02–12 | deploy CDN + API; caching | validation table (PMs vs Gaia; W0855 vs JWST; lens recovery of known T dwarfs/Miras/YSOs) | Sky Safari feed + quests; accessibility; polish → **feature freeze 12:00** |
| Sun 12–23:30 | hardening | numbers check | 30-s video + 7 slides + project page + SI statement → **submit by 23:30** |

**Kill switches:** if the in-browser lens is too slow, precompute lens hits server-side per tile. If decade-lens residuals stay messy, show it as "WISE→SPHEREx blink" (side by side and flicker) plus a dipole detector only above 10σ. Twins and year lens are cut first.

## 6. 30-second demo
0–5 s Tombaugh blinked plates to find Pluto; SPHEREx sees 102 colors → 5–12 s point the **Methane lens** at a random field, a cold world glows; click it → 12–19 s dossier: de-flashed time-lapse, spectrum with the CH4 trough, motion refocus snaps it sharp → 19–25 s **Decade lens**: Barnard's Star leaps 100″ from WISE to SPHEREx; R Dra "breathes" through the water lens → 25–30 s Sky Safari feed + share link: "Point a lens. Find something real."
