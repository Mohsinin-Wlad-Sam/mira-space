# SPHEREx Space Apps 2026 — Product Concepts, Brutal Critique, and Recommendation
**0. Three physics truths that decide every design below**
Before concepts, the truths every SPHEREx web tool gets wrong, and our obsession points:
1. **λ and t are confounded inside the ~1–3 week sweep.** A position receives ~96 exposures over ~1–3 weeks, each one a *different LVF band* (17 pointings step 1 channel apart per ~hour). The first "light curve" anyone flips through is secretly a spectral sweep. Real temporal change lives only in *same-band, cross-epoch* comparisons (~6-month revisit). A "blink" tool that ignores this measures LVF bands and zodiacal weather, not time.
2. **The 12.9″ static cube is not a 6.15″ sky.** The PSF FWHM is ~6.2″ (~1 px at L2, ~0.48 px at 12.9″). Moving objects are *baked in* as trails in the 6-month coadd, and the narrowest LVF bands (R ~127) are narrower than the cube's own channel width (102 channels over 0.75–5.0 µm ⇒ R ≲ 57). Any difference imaging must run at *matched resolution* (2×2-binned L2 ≈ 12.3″) with an EPSF-based forward model — not naive interpolation.
3. **Per-exposure depth is 17–19 AB with real zodiacal/stripe structure.** Every residual must use the shipped ZODI plane, the 22-bit FLAGS plane, variance-weighted S/N, and per-exposure photometric registration. Skipping any one of these and your "discovery feed" is a forecast of SPHEREx's own systematics.
---
## 1. Four genuine concepts
### Concept A — **Time-Lock: the wavelength-locked SPHEREx explorer**
**One-liner.** Point anywhere, get a physically honest time layer: same-band epochs from different surveys, per-pixel wavelengths, flag overlays, and a parallax/PM readout — not a flipbook.
**Who & 60-second journey.** A student types "Barnard's Star" → sees an Aladin-style map → toggles to "λ-locked" mode → gets a movie of the same 6 LVF bands at the Nov 2026 epoch vs the latest QR3 epoch (~6 months apart, ~96 frames each), a 102-channel spectrum from the cube, flux-time curve *per band*, Gaia/CatWISE/SkyBoT overlays → clicks "measure motion" and watches centroids fit a shift of ~10.3″/yr (Barnard's) over the baseline.
**Discovery mechanism.** Guided target quests (the five test targets first: Barnard's, Epsilon Indi B, WISE 0855, RW Aur, R Dra), a "Roll the sky" random-object button, and embeddable per-object dossiers. Discovery here is *learning to see correctly* — the hook is that the tool says things others get wrong (e.g., it labels the first 3 weeks as "spectral sweep, not a light curve").
**Why non-obvious.** Everyone's baseline instinct is a flipbook (judged idea). This inverts it: the naive view is a trap, and the product is the *corrections* — wavelength-locking, per-exposure WCS-WAVE truth, flag glyphs, resolution honesty.
**Pipeline & volumes.** Static all-sky: HiPS cube ≈ 1.3 TB total (never transferred; ~32 MB per deg² per pass as contiguous channel-plane tiles → a per-object spectrum is 1–3 range reads; measured: 93 cutouts in 19 s). L2 cutouts on demand: ~65–75 MB MEF; IMAGE+ZODI+FLAGS planes only (~50 MB). Web tier: static CDN + tiny API for TAP passthrough, SIMBAD/Gaia/CatWISE/skybot lookups with a memoized cache (all backend-friendly). GPU needed only for offline tile rendering, minutes.
**Precomputed vs on-demand.** Precomputed: RGB + per-band FITS tiles from the cube, target dossier JSONs for the 5 targets + ~50 random sky objects. On-demand: user-pointed L2 cutouts, spectra, overlays.
**Feasibility (42 h): 5/5. Riskiest assumption:** none technical — it's *presentational*: that "a correct baseline" is exciting enough. Mitigation: the motion-fit readout and contamination layers are the "wow" layer.
**Scores:** Impact 4 · Creativity 3 · Validity 5 · Relevance 5 · Presentation 4
---
### Concept B — **ChangeLens: the public residual atlas**
**One-liner.** For chosen footprints, predict every exposure from the static cube at each pixel's *own* wavelength (WCS-WAVE), subtract, and publish a ranked, vetted change feed — movers, variables, streaks, odd spectra — on an Aladin heatmap.
**Who & 60-second journey.** An REU student opens the feed → top card: "unexplained, 18.1 AB-equivalent, 6.4σ, in R Dra field" → clicks → variance-plane thumbnail, flag mask, SkyBot null, Gaia/CatWISE/SIMBAD null → classifies it, exports a one-line JSON report; in parallel a pro filters for "mover, |v|>0.5″/yr" and gets 12 candidates with shift vectors.
**Discovery mechanism.** The *feed itself*: ranked "Unexplained" pills, with every card carrying its own σ, variance thumbnail, flag mask, and provenance. Nothing requires coordinates to start.
**Why non-obvious.** Change detection is normally a pipeline's private output (WiseView is a *browser* for it). Here the diff is the product, every residual is *explainable on one screen*, and honesty is graded: injection-completeness printed on the same page ("5,000 synthetics injected, 94% recovered ≥5σ below 18 AB").
**Pipeline & volumes.** Footprint = R Dra ecliptic field (~2,500 exposures, ~12 deg²/frame). One-time ingest: ~125 GB (IMAGE+ZODI+FLAGS) via range reads (~3 h single-stream, minutes parallel — proven by the 93-cutout test). Compute per exposure: binned 1020² px × ~1 kflop ≈ 1 Gflop ⇒ 2,500 exp ≈ 2.5 Tflop ⇒ minutes–tens-of-minutes on one RTX 5000; **the pipeline is IO- and software-bound, not FLOP-bound. GPT/LLM-free.** Weekly QR3: only *new* exposures (~10²–10³/wk → 5–50 GB) re-differed; results cached as static JSON + thumbnails. Cross-vetting via SkyBoT (ephemeris at exposure *t*), Gaia DR3, CatWISE2020, SIMBAD (cached TAP).
**Precomputed vs on-demand.** Precomputed: per-band coadds, residual maps per exposure, same-band stacks, per-band centroid time series, ranked cards, injection tables. On-demand: map pan/zoom into cached tiles, classification writes.
**Feasibility (42 h): 3/5. Riskiest assumption:** after zodi subtraction, flag masking, and SkyBot vetting, ≥ a few cards survive as "unexplained" on one footprint. Fallback that keeps the story honest: a clean feed *is* the result, shown with completeness metrics; plus guaranteed known content (SkyBot asteroids, WISE 0855, Barnard's Star PMs).
**Scores:** Impact 5 · Creativity 4 · Validity 4 · Relevance 5 · Presentation 5
---
### Concept C — **Chroma: spectral oddity & "more-like-this" search**
**One-liner.** Find objects by *spectrum shape*, not by coordinates or difference imaging: every resolved source gets a 102-channel spectral vector (cube + new epochs), and a browser lets you mine outliers and similarity neighborhoods.
**Who & 60-second journey.** A brown-dwarf hunter sketches a methane-absorber profile → KNN returns 40 sources with similar 102-vecs → plots "this object's spectrum now vs 6 months ago" → clicks a cluster bubble labeled "12 carbon stars, −2 outliers" → opens one outlier's dossier with flags and proper-motion.
**Discovery mechanism.** Novelty + similarity. The killer UX: "Spectrum Roulette" — one click gives you a random *S/N-weighted, flag-masked* spectral vector with its nearest neighbors; and "this spectrum changed ≥xσ between epochs" as a query mode (spectral-variability — catches asteroids spinning in λ, YSOs, and post-shock novae that differencing misses).
**Why non-obvious.** Everyone diffs images; almost nobody treats "the 102 numbers at position *p*" as the primary searchable object. Also: unlike a learned embedding, a **variance-weighted cosine KNN on S/N-normalized 102-vectors is honest, explainable, and runs on CPU** — no embedding-overfitting validity trap for the judges.
**Pipeline & volumes.** Source catalogs from per-band same-band stacks in chosen footprints (CPU photutils/SEP); vector = Σ over exposures of (flux × weight)/√variance, flags masked, λ from WCS-WAVE per exposure, cube channels interpolated in ln λ; store ~100 B/vector. KNN: FAISS-class on CPU, seconds. GPU training is a *stretch*, not the core — avoiding it is a validity feature, not a cost.
**Precomputed vs on-demand.** Precomputed: vectors for all sources in footprints. On-demand: KNN queries, neighbor spectra, roulette.
**Feasibility (42 h): 3/5. Riskiest assumption:** "similar" means something physical to a judge — mitigated by showing nearest neighbors visually and by wavelength truth (vectors carry actual λ arrays, not abstract dims).
**Scores:** Impact 4 · Creativity 5 · Validity 3 · Relevance 4 · Presentation 4
---
### Concept D — **StreakWatch: the contamination & clean-epoch observatory**
**One-liner.** SPHEREx quality control as a public product: FLAG-driven snowballs/ghosts/streaks weather map, "cleanest epochs" picker for follow-up observers, and a streak atlas cross-matched to SkyBoT ephemerides.
**Who & 60-second journey.** An astronomer planning a ToO checks the streak density map for R Aur's field over the last 4 QR3 weeks → the tool lists the 3 cleanest epochs (flags, zodi, stripe metric) → meanwhile a citizen taps a streak streak-trail, matches it to a known NEA in SkyBoT, and pre-fills an MPC ADES-style report.
**Discovery mechanism.** The *streak atlas*: trails are auto-linked across exposures into orbits' worth of segments; unknown-direction residuals become findable. This is the module judges-from-SPHEREx will poke first because it's their operational pain.
**Why non-obvious.** Everyone hides flags; here flags are the UI. It also **decontaminates every other concept for free** (the same masks feed Concepts A–C), which is why in the final product it ships as a layer, not a standalone site.
**Pipeline & volumes.** FLAGS plane only (~16.6 MB/exposure uint32) → tiny vs B; trail linking = connected-component in (x,y,t) — cheap. Volumes: deep field = ~40 GB.
**Precomputed vs on-demand.** Precomputed: per-exposure flag-density rasters, clean-epoch tables, streak atlas. On-demand: sky-point lookups.
**Feasibility (42 h): 4/5. Riskiest assumption:** that flag semantics in L2 are as documented (we know 6 of 22 bit names; we commit to displaying *observed* bit patterns, never invented semantics).
**Scores:** Impact 3 · Creativity 4 · Validity 5 · Relevance 5 · Presentation 3 · **best deployed as a module**
| Concept | Pitch hook | Feasibility | Biggest risk | Avg. judges' score* |
|---|---|---|---|---|
| A Time-Lock | correct baseline | **5** | "it's just a viewer" | **4.2** |
| B ChangeLens | the feed | 3 | no unexplained survive vetting | **4.6** |
| C Chroma | spectral search | 3 | "similar" not physical | 4.0 |
| D StreakWatch | flags as product | 4 | bit semantics | 4.0 |
*\*subjective, for comparison only.*
---
## 2. Brutal critique of "Delta-Sky"
**Verdict: the right ambition, fatally over-scoped, and with one physics error at its foundation.** Delta-Sky is ~2.5 products (a WiseView-grade explorer + a change-detection pipeline + an embedding service + a citizen platform + an ops pipeline) wearing one trench coat. But the bones are salvageable; the critique below is what saves them.
### Physics flaws (ordered by lethality)
1. **"Predict every exposure from the 12.9″ cube" breaks for exactly the objects you want.** Moving objects are *memorized into the cube* as survey smears. A source moving 5–10″/yr (Barnard's: 10.35″/yr ⇒ 5.2″ across a 6-month coadd) leaves a trail at 12.9″ resolution of only ~0.4 px — inside the PSF core — while at 6.15″ it's ~0.84 px. Subtracting the cube yields *negative streaks along the trail plus positive entry/exit blobs*, not clean point residuals. **You are difference-imaging to find movers using a reference that already contains the movers.** Fix: model trails (SkyBoT ephemerides + linear PM fits), or detect at 12.9″ with a *trail kernel* so known movers subtract cleanly and *unknown* movers stick out. State loud and clear that "predict exposure from cube" is exact only for static sources — and make the mover path a first-class detection mode, not a ranking afterthought.
2. **The LVF/cube bandpass mismatch guarantees spectrally-correlated residuals.** 102 cube channels over 0.75–5.0 µm gives R ≲ 57; your narrowest LVF bands reach R ~127 — a single band spans 2–4 cube channels with a different transmission shape. For steep-spectrum sources (M/L/T dwarfs, strong methane bands, z-band blue stars) the residual color term is percent-level *and correlated across all exposures* → systematically at the top of any "variable" ranking. Fix: integrate (not interpolate): flux_exp(p) = ∫ T_LVF(λ; WCS-WAVE(p)) · Cube(p,λ) dλ, per pixel, plus a fitted per-exposure scalar zero-point from common sources before subtraction.
3. **The λ/t confound quietly re-enters the ranking.** "Detecting residuals" per exposure compares Nov bands against ~6-months-later bands of *different λ*. Mira variables (your own R Draconis demo, period ≈ 230 d) phase nearly in half-orbit between surveys — the survey's ~6-month cadence is an alias machine. You must rank on *same-band* stacks, or your #1 "variable" is a pulsation artifact by construction. This is fixable and would *impress* the SPHEREx team — but only if you say it out loud.
4. **Per-exposure noise reality vs the "detect everything" promise.** Depth is 17–19 AB per 113.6 s exposure. Single-exposure point-source thresholds hover at detection, so per-exposure deltas mostly find noise + systematics; the real products are *same-band stacked* variables and *survey-baseline* movers. Example that works: WISE 0855 at S/N 3–8/exposure stacks to S/N ~ 20 over ~17 same-band frames (σ_centroid ≈ 6.2″/2.355/20 ≈ 0.13″ ⇒ σ_PM ≈ 0.26″/yr over a 6-month baseline) — consistent with the PoC's −7.3″/yr vs literature −8.1″/yr, and it's a *selling point*, not a bug, if the feed explains it.
5. **Undersampled PSF / resolution dishonesty.** EPSF planes (21×21, field-angle-dependent) are provided *because* the PSF is undersampled at 6.15″ and worse at 12.9″. Any "photometry/centroid from the cube" claim must carry aperture corrections and a resolution label. Naive cube interpolation also creates ringing near bright sources; use the provided EPSF to build the forward model kernel.
6. **Zodiacal + stripes are data, not noise.** The ZODI plane exists per exposure for a reason; scan-synchronous striping correlates within an exposure and differs exposure-to-exposure *and vs the coadd*. Galactic-plane patches (one of your four footprints) are the worst case: cirrus gradients + high zodi ⇒ highest false-positive rate. Ecliptic fields (R Dra, deep fields) are the cleanest start. You picked 4 footprints; recommend starting with 1 (R Dra), and treating "Galactic plane works" as a stretch that even failing teaches a real lesson.
7. **SkyBot has a time; use it per-exposure.** Asteroid residuals must be vetted against SkyBoT at each exposure's mid-time, not at page load. Small, but a "STREAK bit already flagged it" cross-check is a free precision win.
### Compute & data volume (better than feared)
- L2: ~65–75 MB MEF; you need IMAGE+ZODI+FLAGS ≈ 50 MB/exp. R Dra ≈ 2,500 exp ⇒ ~125 GB one-time. At the proven range-read rate (93 cutouts/19 s), single-streaming is ~1–3 h; a ×50-parallel reader: minutes. Weekly QR3 incremental: only *new* exposures re-differ (5–50 GB/wk — a cron job, not an API).
- Forward model is cheap: binned 1020² px at ~1 kflop ⇒ ~1 Gflop/exp ⇒ ~2.5 Tflop for the field ⇒ **minutes on one RTX 5000**. This is *not* a GPU-cluster story; it's a data-engineering story. Budget your 42 h accordingly: the risk is software and validation, not FLOPs.
- Whole-sky cube is ~1.3 TB; you only ever pull ~32 MB/deg² tiles. Fine.
### Scope & what judges think
- **Backyard Worlds judge:** loves ADES/TNS exports and the citizen layer — but notes detection-first + citizens-last means the *human joy* arrives after the plumbing. WiseView proved the community wants to *do*, not watch. Fix: seed classification tasks inside the demo with injection-backed fake hunts.
- **WiseView judge:** respects injection; will ask "show your completeness curve" — if absent, the feed is astrology. Add it (5,000 synthetics, per-mag, per-band recovery).
- **SPHEREx team judge:** will poke exactly the seven points above. If you handle λ/t confounding, ZODI, FLAGS, resolution, and variance-plane S/N honestly — and say so in a "Known limitations" section — you turn their skepticism into your highest Validity score. If any feed card turns out to be a known object mislabeled "unexplained," the project dies on stage. Label humility: "unexplained = not yet matched," never "new discovery."
**Salvage verdict:** keep (a) as the baseline, rebuild (b) at one clean footprint with trail-aware subtraction, drop/simplify (c) to S/N-weighted KNN if it exists at all, and let (e) be a cron job that just keeps the JSON fresh.
---
## 3. Recommendation — **IRLIVE: The Living Infrared Sky**
A hybrid: **Concept A (baseline) + Concept B (one footprint, trail-aware) + Concept D as the contamination layer + citizen classify as a stretch.** It is broad (anyone, any object, whole sky browsable) and obsessive precisely where a flipbook lies. 
### Product spec (screens)
1. **Landing** — search box + "This week's unexplained" feed preview + "Roll the sky."
2. **Explorer** — Aladin-style map (pre-rendered cube RGB + per-band tiles from CDN); query-string deep links: `?obj=name|ra,dec&b=bands&t0&t1&mode=lw|tv&ov=gaia,catwise,skybot&fov=2'` — covers the URL-query + user-FOV bonus; `emb=1` renders the `<iframe>` dossier view. Controls: λ-locked vs true-time mode toggle, per-exposure median WCS-WAVE readout, ±epoch addition/subtraction with σ-scaled residual view, overlays (Gaia colored by astrometric goodness, CatWISE circles scaled by flux at matched wavelengths, SkyBoT marks at exposure mid-time), contamination heatmap (snowballs/ghosts/streak density + clean-epoch picker).
3. **Residual Atlas (R Dra field)** — change heatmap layer + ranked cards: S/N from the VARIANCE plane, flux ± σ, flag mask thumbnail, trail/PM vectors, SkyBoT-at-*t* result, Gaia/CatWISE/SIMBAD match-radius and result, "known / partially known / unexplained" pill, classify buttons, export JSON. Injection-completeness table printed underneath.
4. **Object dossiers** — 102-channel spectrum (cube + per-band epoch points), same-band light curve, motion fit panel (Barnard's: expect ~10.3″/yr; WISE 0855: our pipeline's −7.3″/yr vs literature −8.1″/yr), flags, provenance to IRSA file manifests.
### The "small details" list (what impresses SPHEREx scientists)
- λ/t confound disclosed in-UI; "spectral sweep" label on first ~3-week frames.
- Per-exposure effective wavelength shown from WCS-WAVE, not nominal band labels.
- Per-exposure ZODI subtraction; high-zodi exposures flagged on the player.
- All differencing at 2×2-binned 12.3″ matched to the 12.9″ cube; native 6.15″ view labeled "explorer-only."
- Photometric registration (per-exposure scalar zero-point from common sources) before subtraction.
- EPSF-based forward kernel; no naive cube interpolation; aperture corrections documented.
- FLAGS-plane masking before any stack; only the 6 known bit names used, as *observed patterns*.
- VARIANCE-driven S/N everywhere; every card shows its σ.
- Injection validation on-page (WiseView-grade completeness).
- "Unexplained ≠ new" terminology discipline; match radii & catalogs named on every card.
- AB vs Vega conversion stated where units mix (~+2.7 mag at 5 µm); MJy/sr vs Jy stated for cube vs point sources.
- Every thumbnail deep-links to IRSA filenames + a TAP permalink.
### MVP cut — guaranteed shippable in 42 h (≤6 people + agents; 8 GPUs as cron workers)
| Hours | Workstream |
|---|---|
| 0–6 | CDN tiles from cube; search → cutouts (existing range reader reused); overlay calls cached |
| 6–16 | Explorer + explorer modes; 5 target dossiers incl. motion fits (reuse PoC WISE 0855 pipeline) |
| 16–28 | R Dra trail-aware differencing (one footprint), vet cross-matches, injection table |
| 28–36 | Feed UI, contamination layer, embeds/URL schema |
| 36–40 | 7 slides + 30-s cut |
| 40–42 | Dry-run, checksums-to-manifest, "Known limitations" page |
Stretch (in order): Galactic-plane footprint (deliberately the hard case); KNN spectral search (Concept C-lite); ADES quick-form; weekly cron; classroom widget; public API for cutouts.
### 30-second demo storyline
> *0–8 s:* Type "WISE 0855-0714" → λ-locked 6-month movie + 102-channel spectrum; PM panel shows −7.3″/yr measured from QR3 alone vs −8.1″/yr literature (click to reveal method). *8–18 s:* Flip to "Unexplained #1" → variance+flags+tri-vet null shown; classify it as a citizen; injection table scrolls ("5,000 fakes, 94% recovery"). *18–26 s:* Roll the sky → random Barnard's-frame streak matched live to an asteroid from SkyBoT at that exposure's mid-time. *26–30 s:* "Every pixel has a past — and we keep it honest. IRLIVE."
### Recommendation scoreboard
Impact 4 · Creativity 4 · Validity 5 (the confound/zodi/flags discipline is the differentiator the SPHEREx team will grade hardest) · Relevance 5 (real DR1+QR3 data end-to-end, checksums shown) · Presentation 5 (feed + honest-limitation page + working PM measurement is a strong story). **Riskiest assumption:** an unexplained card survives vetting on one footprint — mitigated by honest "zero unexplained with 94% completeness at 18 AB *is* the result" framing plus guaranteed-known movers/vars as live content.
*All data quantities from the provided fact sheet and stated assumptions; no external references used.*
