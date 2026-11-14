# SPHEREx Space Apps 2026: Product Science Strategy, Critique & Winning Blueprint

> **Executive Premise:** SPHEREx is not an imaging survey with fixed filters like WISE or ZTF; it is a **4D slitless spectro-temporal interferometer of the sky** where every exposure $i$ samples a source at a different wavelength $\lambda_i(x_i, y_i)$ along a Linear Variable Filter (LVF). If you build a naive image flipbook, **everything flashes** because $\lambda$ changes between frames (**the Color–Time Degeneracy**), and if you extract a spectrum at a fixed $(\alpha, \delta)$, fast movers walk out of the aperture across the 6 detector arrays (**the Motion–Spectrum Degeneracy**). The winning product must turn this exact hardware quirk from a nuisance into a **discovery superpower** for every class of astronomical object.

---

## TASK 1: Four Original, Broad, Non-Obvious Project Concepts

---

### Concept 1: **ChronoPrism** — The 4D Spectro-Temporal Decomposer & Anomaly Atlas

* **One-Line Pitch:** An interactive web laboratory and all-sky anomaly map that breaks SPHEREx’s wavelength–time degeneracy by decomposing any sky region into three orthogonal physical signals—**Motion ($\vec{\mu}$)**, **Static Spectrum ($S(\lambda)$)**, and **Chromatic Variability ($\Delta F(\lambda, t)$)**—turning blurry multi-band frames into sharp discoveries with a single slider.
* **Who Uses It & The 60-Second User Journey:**
  * **Users:** High school students, Backyard Worlds citizen scientists, and variable-star / solar-system astronomers.
  * **0–15s:** User opens the web app and sees a **Ternary Discovery Triangle** (*Pure Movers* $\leftrightarrow$ *Spectral Variables* $\leftrightarrow$ *Single-Epoch Transients/Asteroids*) populated with 5,000+ pre-vetted anomalous sources across the sky, plus the 5 featured challenge targets.
  * **15–35s:** They click an outlier near the *Mover* apex (e.g., WISE 0855-0714 or an uncatalogued $4.5\,\mu\text{m}$ source). The screen splits into a **6-Band Coadd Strip**, a **Live L2 Time-Lapse**, and an **Interactive 102-Channel Spectrum**. In the default fixed-sky frame, the spectrum has ragged step-jumps between Bands 1–6 and the coadd is smeared.
  * **35–60s:** They drag the **"Kinematic Refocus ($\mu_\alpha, \mu_\delta$)"** puck (or click *Auto-Solve Motion*). As $(\mu_\alpha, \mu_\delta)$ hits $(-8.1''/\text{yr}, +1.3''/\text{yr})$, the smeared blob snaps into a tight point source in Band 6 ($3.8\text{--}5.0\,\mu\text{m}$), and the disjointed spectral points lock into a textbook Y-dwarf methane/water absorption spectrum matched live against the 6,003 SPIFF templates.
* **The Discovery Mechanism (Zero-Prior-Knowledge Discovery):**
  * Users don't guess coordinates. They explore the **Ternary Residual Map**, where every dot is scored by *why* a simple static point-source model failed:
    1. **Kinematic Score ($\Delta \chi^2_{\text{PM}}$):** How much the 102-band spectral continuity and PSF sharpness improve when the aperture moves linearly with time $\vec{r}(t) = \vec{r}_0 + \vec{\mu}(t - t_0)$.
    2. **Chromatic Breathing Score ($\Delta \chi^2_{\text{var}}(\lambda)$):** How much fluxes at *matched wavelengths* ($\Delta\lambda / \lambda < 1/R$) diverge between epochs (6-month survey passes or weekly NEP passes).
    3. **Ephemeral Score ($\Delta \chi^2_{\text{burst}}$):** Single 17-pointing group excess that vanishes in other epochs (asteroids, flares).
* **Why It Is Non-Obvious:**
  * IRSA’s Spectrophotometry Tool extracts at a *fixed* coordinate; WiseView blinks broadband images without spectra. ChronoPrism realizes that **spectral smoothness across LVF steps is a proper-motion detector**, and **baseline SED division turns 102 disparate wavelength samples into a calibrated multi-year light curve**.
* **Technical Pipeline, Data Volume & Compute Estimates:**
  * **Cutout I/O:** Using parallel S3 byte-range requests on `nasa-irsa-spherex`, fetching a $32\times32$ px ($197''\times197''$) cutout across 5 extensions (`IMAGE`, `FLAGS`, `VARIANCE`, `ZODI`, `WCS-WAVE`) + Nearest `EPSF` tile reads ~24 KB per exposure. For 100 exposures, that is **2.4 MB in ~1.8 seconds**.
  * **Batch Precompute (8x RTX 5000 Ada GPUs):** Rather than reading full $2040\times2040$ frames blindly, we stream contiguous S3 stripes over 4 curated footprints (~400 sq. deg total: NEP deep field around R Dra, Taurus molecular cloud around RW Aur, an ecliptic plane strip, and high-latitude fields) + 10,000 targeted high-PM/variable candidates from Gaia DR3 + CatWISE2020. Extracting `EPSF`-weighted, `ZODI`-subtracted `(t, \lambda, F, \sigma_F, \text{flags})` tuples for 250,000 sources takes **~3.5 hours on 8 GPUs** and produces a **~450 MB Parquet/DuckDB database**.
* **Precomputed vs. On-Demand:**
  * **Precomputed:** Ternary anomaly catalog (250k sources), pre-extracted $(\lambda_i, t_i, F_i)$ light/spectral cubes for the top 2,000 anomalies + 5 challenge targets, SPIFF template cross-correlation grid.
  * **On-Demand (Any RA/Dec):** Instant IRSA TAP exposure lookup $\rightarrow$ S3 byte-range cutout pull (93 cutouts in <15s) $\rightarrow$ in-browser WebWorker/WASM joint $(\vec{\mu}, S(\lambda), \Delta m(t))$ decomposition.
* **42-Hour Feasibility & Riskiest Assumption:**
  * **Feasibility: 4 / 5.**
  * **Riskiest Assumption:** Cross-band relative flux calibration and sub-pixel centroiding on undersampled $6.15''$ pixels in Bands 1–3 ($\lambda < 2.4\,\mu\text{m}$); mitigated by strictly weighting by the local $21\times21$ `EPSF` model and `VARIANCE`.
* **Judging Criteria Scores:**
  * **Impact (5/5):** Solves a fundamental problem for the entire SPHEREx community (moving + variable spectrophotometry).
  * **Creativity (5/5):** Shifting velocity to watch a fragmented spectrum snap into focus is an unforgettable interactive mechanic.
  * **Validity (5/5):** Directly grounded in SPHEREx LVF physics, `EPSF`, `ZODI`, and `FLAGS`.
  * **Relevance (5/5):** Uses all 102 bands, all 6 detectors, and every L2 MEF extension.
  * **Presentation (5/5):** Visually dramatic transformation on all 5 test targets.

---

### Concept 2: **EpochBridge (2010–2026)** — The 16-Year Synthetic-WISE & SPHEREx Time Machine

* **One-Line Pitch:** Bridges the 2024 death of NEOWISE by synthetically integrating SPHEREx’s 102 spectral channels through exact WISE W1 ($3.4\,\mu\text{m}$) and W2 ($4.6\,\mu\text{m}$) filter transmission curves on the fly—giving humanity a seamless **16-year infrared movie (2010–2026)** that explodes into 102-color spectroscopy at the final frame to reveal *why* the object changed.
* **Who Uses It & The 60-Second User Journey:**
  * **Users:** Backyard Worlds veteran flippers, WiseView power users, YSO/AGN variability researchers, and students.
  * **0–15s:** User clicks **"16-Year Time Machine"** or selects WISE 0855-0714 / RW Aurigae from the **Biggest 16-Year Jumps** feed.
  * **15–40s:** A familiar WiseView-style W1/W2 false-color blink comparator plays smoothly from **2010 (WISE cryogenic) $\rightarrow$ 2014–2024 (NEOWISE epochs via unWISE CORS cutouts) $\rightarrow$ 2025–2026 (SPHEREx synthetic W1/W2 coadds)**. Because SPHEREx’s $6.15''$ pixels match WISE’s $\sim 6''$ PSF FWHM, the transition is visually seamless: WISE 0855 marches $130''$ across the frame; RW Aurigae visibly dims and reddens during its circumstellar dust occultations.
  * **40–60s:** User clicks **"Unfold 2026 Spectrum"** on the final SPHEREx epoch. The broadband W1/W2 dot expands like a prism into 102 spectral channels, showing *which exact molecular or dust feature* caused the W1/W2 brightness change, plus intra-year SPHEREx epoch differencing.
* **The Discovery Mechanism (Zero-Prior-Knowledge Discovery):**
  * **"The Decade Diff Feed":** By integrating SPHEREx DR1/QR3 spectra across the W1 ($2.8\text{--}3.8\,\mu\text{m}$, ~22 SPHEREx channels) and W2 ($4.0\text{--}5.0\,\mu\text{m}$, ~18 SPHEREx channels) filter profiles and comparing directly against CatWISE2020 / AllWISE catalogs, we pre-populate a ranked gallery of:
    1. ** vanishing / Appearing Stars:** Sources whose synthetic SPHEREx W1 or W2 magnitude changed by $>1.0\text{ mag}$ since CatWISE2020 (YSO dippers like RW Aur, Mira pulsators like R Dra, FU Ori outbursts).
    2. **10-Year Astrometric Leapers:** Sources in SPHEREx Band 5/6 with no static CatWISE counterpart within $6''$, paired with a orphaned 2015 CatWISE source $10\text{--}120''$ away.
* **Why It Is Non-Obvious:**
  * Everyone treats SPHEREx as a 1-year baseline survey (where slow movers only shift $0.5\text{--}1$ pixel!). Realizing that SPHEREx Band 5 ($2.42\text{--}3.82\,\mu\text{m}$) and Band 6 ($3.82\text{--}5.00\,\mu\text{m}$) fully encompass WISE W1 and W2 at the *exact same angular resolution ($6.15''$)* turns SPHEREx into **NEOWISE’s spectroscopic continuation**, unlocking a 16-year lever arm ($32\times$ higher proper-motion sensitivity) while solving WiseView's biggest limitation (no spectra to classify what you find).
* **Technical Pipeline, Data Volume & Compute Estimates:**
  * **Synthetic Photometry Math:** For any sky position or pixel tile, integrate `IMAGE - ZODI` (masked by `FLAGS`) weighted by the tabulated WISE $R_{\text{W1}}(\lambda)$ and $R_{\text{W2}}(\lambda)$ photon response curves evaluated at `WCS-WAVE`.
  * **unWISE Integration:** Fetch multi-epoch unWISE coadd cutouts directly in the browser via CORS (~15 epochs from 2010–2024, ~500 KB total per target in <2s).
  * **Precompute Volume:** Integrating the DR1 102-channel HiPS cube (12.9" px, contiguous planes) through $R_{\text{W1}}(\lambda)$ and $R_{\text{W2}}(\lambda)$ across the *entire sky* (HEALPix $N_{\text{side}}=512$, $3.14\times10^6$ pixels $\times 102$ floats = 1.28 GB total) takes **<12 minutes on 1 GPU**! We then refine the top 5,000 all-sky CatWISE2020 flux/position discrepancies using native $6.15''$ L2 S3 cutouts in **~2 hours**.
* **Precomputed vs. On-Demand:**
  * **Precomputed:** All-sky Synthetic-W1/W2 vs. CatWISE2020 change map (HiPS layer) + top 5,000 native-L2 verified jumpers/variables.
  * **On-Demand:** Live browser fetch of unWISE 2010–2024 epochs + SPHEREx L2 2025–2026 cutouts, computing synthetic W1/W2 frames and 102-band spectra on the fly for any RA/Dec.
* **42-Hour Feasibility & Riskiest Assumption:**
  * **Feasibility: 5 / 5.**
  * **Riskiest Assumption:** UnWISE cutout server latency or rate-limiting during live demos; trivially mitigated by caching the top 200 targets + 5 challenge targets on our CDN and falling back to CatWISE2020 overlay vectors if unWISE takes >3s.
* **Judging Criteria Scores:**
  * **Impact (5/5):** Directly empowers the Backyard Worlds / WiseView community (who are likely judging!) with the tool they desperately need post-NEOWISE.
  * **Creativity (4.5/5):** Using a 102-band spectrometer to synthesize legacy broadband filters for a 16-year movie, then unfolding the prism at the end.
  * **Validity (5/5):** Exact filter transmission curve integration with error propagation from `VARIANCE`.
  * **Relevance (5/5):** Coadds SPHEREx bands physically, adds/subtracts epochs, overlays WISE/Gaia.
  * **Presentation (5/5):** Watching a star move for 14 years in WISE and then burst into a 102-channel spectrum in 2026 is a killer 30-second pitch.

---

### Concept 3: **QR-Pulse** — The Live Weekly SPHEREx Sky Digest & Track-Before-Detect Engine

* **One-Line Pitch:** Turns SPHEREx’s weekly Quick Release (QR3) drops into a live public discovery feed ("What Changed in the Infrared Sky This Week?"), automatically catching serendipitous asteroids, erupting variables, and cold movers across the latest orbital scan strips.
* **Who Uses It & The 60-Second User Journey:**
  * **Users:** Amateur astronomers, planetarium educators, solar system hunters, and transient researchers.
  * **0–15s:** User lands on **"Issue #46 — Weekly Sky Pulse (Nov 2026)"**, featuring an interactive 3D/2D sky globe highlighting the exact sun-synchronous $90^\circ$-elongation great circles SPHEREx scanned this week, color-coded by anomaly density.
  * **15–40s:** User clicks one of three live feed tabs: **☄️ Solar System Crossers**, **🌟 Pulsating & Erupting Stars**, or **🧊 Cold Unmatched Movers**. Selecting an asteroid or comet caught in this week's strip opens a synchronized **Orbital Track Player**: as SPHEREx stepped across the sky over 1–3 weeks, the asteroid moved, sampling different LVF wavelengths at different positions.
  * **40–60s:** QR-Pulse shifts each L2 cutout into the asteroid's ephemeris rest frame (via IMCCE SkyBoT), subtracts the static background stars from 6 months ago, and extracts a **clean 0.75–5.0 $\mu\text{m}$ reflectance + thermal emission spectrum** of the moving asteroid, or lets the user inspect R Draconis's latest weekly pulsation phase.
* **The Discovery Mechanism (Zero-Prior-Knowledge Discovery):**
  * Instead of a static archive, discovery is driven by a **Weekly Diff Stream**: every new QR3 exposure is compared against DR1 exposures of the same field taken ~6 months earlier (matching exposures whose `WCS-WAVE` at the source position differs by $<2\%$, or normalizing by the DR1 baseline SED).
  * Furthermore, any `FLAGS & SOURCE` detection in a new QR3 image with no Gaia DR3 / CatWISE2020 match within $6''$ is automatically queried against SkyBoT:
    * **Matched to known SSO:** Automatically builds a **moving-target spectrophotometric stack** (solving a major challenge for planetary scientists!).
    * **Unmatched:** Promoted to the **Citizen Vetting Deck** with a 1-click `FLAGS` inspector to rule out `SNOWBALL`, `PERSIST`, and `GHOST`.
* **Why It Is Non-Obvious:**
  * Most teams treat SPHEREx as a static deep-sky catalog. Recognizing that SPHEREx's LEO sun-synchronous orbit scans along the $90^\circ$ solar elongation circle every week—sweeping across thousands of main-belt asteroids, NEOs, comets, and variable stars—turns the **weekly QR3 data release bonus requirement** into the central product hook.
* **Technical Pipeline, Data Volume & Compute Estimates:**
  * **Weekly Ingestion Pipeline:** Query IRSA TAP for exposures with `release_date > T - 7 days` (typically ~1,500–2,500 exposures/week).
  * Rather than downloading full images for all 2,000 exposures, our ingestion script pulls the `FLAGS` extension (bit-packed, highly compressible) and sparse source peaks for ~200 representative exposures along the weekly strip (~3 GB total read in 15 minutes), cross-matches against a local DuckDB spatial index of Gaia DR3 / CatWISE2020 + SkyBoT cone searches, and extracts $32\times32$ multi-epoch cutouts around the top 500 weekly events.
* **Precomputed vs. On-Demand:**
  * **Precomputed (Automated Cron/CLI Script):** The Weekly QR3 Digest JSON/Parquet pack (~50 MB per week, static CDN hosted) containing the top 500 vetted weekly changes, asteroid moving-frame spectra, and the 5 test targets.
  * **On-Demand:** Enter *any* asteroid name/number, comet, or RA/Dec $\rightarrow$ query SkyBoT + IRSA TAP $\rightarrow$ assemble a live Lagrangian (moving-frame) or Eulerian (fixed-frame) cutout movie and spectrum via S3 range reads.
* **42-Hour Feasibility & Riskiest Assumption:**
  * **Feasibility: 4 / 5.**
  * **Riskiest Assumption:** IMCCE SkyBoT API latency or downtime when querying hundreds of fields; mitigated by pre-propagating orbital elements locally using `astropy`/`skyfield` + MPC `MPCORB.DAT` on our GPUs/CPUs in 5 minutes!
* **Judging Criteria Scores:**
  * **Impact (4.5/5):** Gives the public a reason to come back to SPHEREx *every single week* for the next 2+ years.
  * **Creativity (5/5):** Moving-frame asteroid spectrophotometry + Weekly Sky Newspaper UX.
  * **Validity (4.5/5):** Cleanly separates stationary background stars from moving targets using 6-month baseline subtraction.
  * **Relevance (5/5):** Directly nails the "easy to update with weekly data releases" bonus criterion and "spot moving objects".
  * **Presentation (4.5/5):** Highly engaging story ("Here is what SPHEREx discovered in the last 7 days").

---

### Concept 4: **SpectraBlink Studio** — Browser-Native WebGL2 Chemical & Kinematic Lens Synthesizer

* **One-Line Pitch:** A zero-install, GPU-accelerated browser studio that streams all 6 SPHEREx detector arrays and per-pixel `WCS-WAVE` maps into WebGL2 shaders—allowing anyone to apply real-time **"Chemical Lenses"** (methane, water ice, carbon monoxide, dust continuum) and **"Shift-and-Add Velocity Lenses"** directly to multi-epoch sky video.
* **Who Uses It & The 60-Second User Journey:**
  * **Users:** Students, astrophysicists, citizen scientists, and science communicators who want hands-on exploration without writing Python.
  * **0–15s:** User opens SpectraBlink Studio and picks one of the **Interactive Discovery Lenses** on the toolbar: *🧊 Cold Brown Dwarf ($\mathrm{CH_4}$ $3.3/4.5\,\mu\text{m}$ Ratio)*, *💧 Pulsating AGB Water Band ($1.9/2.7\,\mu\text{m}$)*, *🌑 Dusty Disk Dipper ($K - [4.5\,\mu\text{m}]$)*, or *🚀 High-PM Shift-and-Add*.
  * **15–40s:** Watching R Draconis (~2,500 NEP exposures binned into 25 temporal phases), the user toggles between the **Continuum Lens** ($1.25\,\mu\text{m} + 2.2\,\mu\text{m}$) and the **Water/CO Absorption Lens** ($1.9\,\mu\text{m} + 2.7\,\mu\text{m} + 4.6\,\mu\text{m}$). On screen, background stars stay completely rock-steady gray while R Draconis pulses wildly in false color as its molecular atmosphere expands and cools!
  * **40–60s:** The user lasso-selects any pixel group, toggles the **22-Bit Contamination X-Ray** (`PERSIST`, `GHOST`, `SNOWBALL` highlighted in neon wireframe), subtracts Epoch 1 from Epoch 2, and exports a permanent, embeddable URL (`?ra=248.97&dec=67.82&lens=h2o_co&fov=180&flags=hide_bad`) for a paper or classroom slide.
* **The Discovery Mechanism (Zero-Prior-Knowledge Discovery):**
  * **Physical Band-Algebra Presets ("Chemical Goggles"):** Instead of confronting novices with 102 raw channels, the studio provides 8 scientifically calibrated **Spectral Index Shaders** that highlight specific astrophysics inside any $5'\times5'$ field of view:
    * *Methane/Y-Dwarf Index:* $(F_{4.4\text{--}4.8\mu\text{m}} - F_{3.2\text{--}3.5\mu\text{m}}) / \sigma$ — makes WISE 0855 and $\epsilon$ Indi B pop out like neon beacons while ordinary stars cancel to zero!
    * *Water/Mira Index:* $F_{2.6\text{--}2.9\mu\text{m}} / F_{2.1\text{--}2.3\mu\text{m}}$ — isolates pulsating AGB stars (R Dra) and M/L dwarfs.
    * *CO / YSO Disk Index:* $F_{4.5\text{--}4.9\mu\text{m}} / F_{1.5\text{--}1.7\mu\text{m}}$ — highlights dusty T Tauri variables (RW Aur).
* **Why It Is Non-Obvious:**
  * Existing tools treat images and spectra as separate worlds. By packing `(IMAGE - ZODI, VARIANCE, FLAGS, WCS-WAVE)` into floating-point WebGL2 3D textures in the client browser, the user can perform **arbitrary band coadds, spectral ratios, epoch subtractions, and bitmask toggling at 60 FPS** without a backend round-trip.
* **Technical Pipeline, Data Volume & Compute Estimates:**
  * **Browser / Edge Architecture:** A lightweight FastAPI/Cloudflare Worker metadata proxy queries IRSA TAP and returns the exact S3 byte-range offsets for the user's FOV ($1'\text{--}15'$). The browser fetches the byte ranges directly from `s3://nasa-irsa-spherex` (CORS `*` enabled!), decompresses/parses FITS sub-tiles in a WebWorker, and uploads a `(N_epochs, H, W, 4)` `Float32Array` texture to WebGL2.
  * **Data Volume:** 100 cutouts of $64\times64$ px $\times 4$ planes = 6.5 MB over the wire ($\sim 3\text{--}4$ seconds on standard broadband; <200 ms for cached targets). For R Dra (~2,500 exposures), a server-side pre-binner compresses the 2,500 exposures into a 50-epoch $\times$ 102-channel tensor (8 MB) on our CDN.
* **Precomputed vs. On-Demand:**
  * **Precomputed:** CDN-cached tensors for the 5 test targets + 100 curated gallery objects across the 8 Chemical Lenses.
  * **On-Demand:** Any coordinate or target name resolved via SIMBAD/Gaia, pulled live from S3 into the WebGL2 shader pipeline.
* **42-Hour Feasibility & Riskiest Assumption:**
  * **Feasibility: 4.5 / 5.**
  * **Riskiest Assumption:** Browser memory/GPU limits when loading >300 exposures at large FOVs ($>15'$); easily handled by adaptive spatial binning and server-side streaming epoch compression for deep-field targets like R Dra.
* **Judging Criteria Scores:**
  * **Impact (4.5/5):** Makes 102-band spectral cubes as intuitive and fast to manipulate as WiseView.
  * **Creativity (5/5):** Real-time WebGL "Chemical Goggles" that null out normal stars and highlight molecular physics in video.
  * **Validity (5/5):** Every pixel operation honors `WCS-WAVE`, `ZODI`, `VARIANCE`, and all 22 `FLAGS` bits.
  * **Relevance (5/5):** Hits *every single bonus point* in the prompt (coadd per 6 detectors, spectra on the fly, add/subtract epochs, user FOV, Gaia/WISE overlays, URL embedding, contamination flags).
  * **Presentation (5/5):** Instant visual payoff—toggling the Methane or Water lens makes the target light up on screen immediately.

---

## TASK 2: Brutal Scientific & Engineering Critique of "Delta-Sky"

The candidate concept **Delta-Sky** has the right **product structure** (combining an *Explore Anywhere* inspector with a *Coordinate-Free Discovery Feed*), and that duality should be kept. However, its proposed **core technical implementation for parts (b), (c), and (d)** contains **fatal astrophysics flaws and compute traps** that SPHEREx and WiseView judges will immediately penalize.

Here is the unvarnished critique:

### 1. Fatal Physics Flaw #1: Subtracting the $12.9''$ HiPS Cube from $6.15''$ L2 Exposures Creates Millions of False-Positive "Bullseyes" and Dipoles
* **The Resolution & Undersampling Disaster:**
  * Native SPHEREx L2 detectors have **$6.15''\times 6.15''$ pixels**. In Bands 1–3 ($0.75\text{--}2.42\,\mu\text{m}$), the optical PSF FWHM is $\sim 2.0\text{--}3.5''$—meaning SPHEREx is **severely undersampled**! Depending on whether a star lands on a pixel center vs. a pixel corner (sub-pixel phase), the peak pixel surface brightness varies by **$2\times\text{ to }3\times$**. That is why the SPHEREx pipeline provides a $21\times21$ gridded `EPSF` extension in every L2 MEF.
  * Conversely, the DR1 static 102-channel HiPS cube has **$12.9''$ pixels** ($4.4\times$ larger pixel area) formed by averaging and reprojecting multiple dithers onto a HEALPix grid, smearing the effective PSF out to $\text{FWHM} \sim 14\text{--}18''$.
  * **What happens when you evaluate the $12.9''$ HiPS cube at $(x, y, \lambda)$ and subtract it from a $6.15''$ L2 image?** Every single constant star in the sky produces a **massive positive spike in the center pixel ($+40\%$ to $+150\%$ of peak flux) surrounded by a negative moat**, or a sharp positive-negative dipole if sub-pixel registration is off by even $0.8''$!
  * In a Galactic plane patch or the NEP deep field, **99.9% of your "ranked change catalog" will be static field stars suffering from PSF/pixel-scale mismatch.**

### 2. Fatal Physics Flaw #2: Moving & Variable Objects Are Already Baked Into the DR1 Cube (Self-Subtraction)
* The DR1 HiPS cube is not an independent historical survey from 10 years ago—it was **coadded from the very same DR1 L2 exposures** you are subtracting it from!
* **Self-Subtracting Fast Movers:** Take WISE 0855-0714 ($\mu \approx 8.1''/\text{yr}$) or Epsilon Indi B ($\mu \approx 4.7''/\text{yr}$). Over the ~6-month DR1 survey window, they move by **$2.3''\text{ to }4.0''$**. That motion is **less than one-third of a single $12.9''$ HiPS pixel!** Therefore, the moving object sits right inside the same $12.9''$ HiPS voxel as the L2 exposure. Subtracting the HiPS cube from the L2 image **subtracts the moving object from itself**, destroying your S/N on the very targets (WISE 0855, $\epsilon$ Indi B, Planet X) the challenge is named after!
* **Corrupting Variable Stars:** For R Draconis or RW Aurigae, the HiPS cube contains a sigma-clipped mean of high and low states, where different wavelength channels were observed at different pulsation phases. Subtracting it creates unphysical sawtooth spectral artifacts across the 102 channels.

### 3. Fatal Physics Flaw #3: Zodiacal Light (`ZODI`), Stray Light Striping, and Discrete Channel Binning
* L2 `IMAGE` extensions report total sky surface brightness in $\text{MJy/sr}$, **dominated at $1.5\text{--}5.0\,\mu\text{m}$ by Zodiacal light** (interplanetary dust scattering and thermal emission). Because Zodiacal brightness depends on solar elongation and look direction through the dust cloud at epoch $t$, two L2 exposures of the same star taken 6 months apart have **different `ZODI` backgrounds by up to $10\text{--}30\%$** plus roll-angle dependent LVF gradient stripes.
* If Delta-Sky subtracts the static HiPS cube without explicitly modeling `(L2_IMAGE - L2_ZODI) - local_pedestal(x, y)`, the "change heatmap layer on Aladin" will simply be a **checkerboard of $3.5^\circ\times 11.3^\circ$ detector footprints and Zodiacal stripes**.
* Moreover, the HiPS cube is quantized into 102 discrete channel bins $\lambda_k$, whereas an L2 pixel has continuous $\lambda(x,y)$ via `WCS-WAVE`. Near steep spectral edges (like the $2.7\,\mu\text{m}$ water band or $4.3\,\mu\text{m}$ $\mathrm{CO_2}$/CO edge), linear interpolation across $12.9''$ HiPS planes leaves systematic spectral-slope residuals on every red star.

### 4. Fatal ML Flaw in (c): Learned Spectro-Temporal Embeddings on Sparse, Irregular $(\lambda_i, t_i)$ Point Clouds
* Outside the ecliptic poles, SPHEREx samples a source in 17-pointing groups separated by ~6 months. Every source has a **different, irregular sampling pattern in $(\lambda_i, t_i)$** depending on its ecliptic latitude, spacecraft roll angle, and which pixels were masked by `FLAGS` (`PERSIST`, `SAA`/`SNOWBALL`, `GHOST`).
* If you train a neural network / autoencoder on these irregular spectro-temporal tensors during a 42-hour hackathon, **the latent space will encode the observing cadence, ecliptic latitude, and S/N mask**, *not* astrophysics. Clicking *"More like this"* on RW Aurigae will return random stars that happened to lie on the same spacecraft scan stripe and lost Band 4 to a cosmic ray snowball.

### 5. Compute, I/O, and Scope Reality Check (42 Hours Left)
* **The S3 Egress Bottleneck:** Processing the NEP & SEP deep fields + an ecliptic strip + a Galactic plane patch at full L2 pixel resolution requires pulling ~15,000–30,000 L2 MEF files. Even reading single detector extensions (~16 MB each $\times 6$ detectors), full-frame pixel differencing across 20,000 exposures is **1.5–2.0 TB of S3 reads** plus billions of `WCS-WAVE` polynomial evaluations and HEALPix lookups. You will burn 24 of your 42 hours debugging deadlocked S3 readers and background subtraction artifacts.
* **Feature Sprawl in (d):** Building MPC ADES XML/PSV format validators, Transient Name Server (TNS) submission exporters, and a full citizen-science voting backend in 42 hours is low-leverage plumbing. Judges won't test whether your MPC ADES XML passes the Minor Planet Center schema parser during a 30-second video; they *will* test whether Barnard's Star, WISE 0855, and R Draconis look physically right and feel magical to interact with.

### 6. What the Judges Will Actually Think
* **SPHEREx Science Team Judges:** *"They ignored the `EPSF` and subtracted a $12.9''$ HiPS cube from undersampled $6.15''$ L2 pixels. Look at the PSF residual rings around every bright star in their heatmap. Also, where is the `ZODI` subtraction?"* $\rightarrow$ **Validity drops to 2.5/5.**
* **Backyard Worlds / WiseView Judges (Meisner / Caselden / Kirkpatrick):** *"WiseView works because we align matched-resolution coadds and use sliding time windows or synthetic W1/W2 comparisons. Here, WISE 0855 self-subtracted in their DR1 cube diff, and their neural similarity search returned noise."*

---

## TASK 3: The Winning Recommendation — **Delta-Sky: ChronoPrism Edition**

We keep Delta-Sky’s winning **two-pillar product architecture** (*Explore Anywhere* + *Coordinate-Free Discovery Engine & Similarity Search*) and **replace the broken pixel-cube subtraction and black-box ML** with the rigorous physics from **Concepts 1, 2, and 4**.

### Why This Hybrid Wins Across All 5 Criteria
1. **Replace $12.9''$ HiPS Pixel Subtraction with Two Physically Exact Discovery Pipelines:**
   * **Pipeline A (16-Year Synthetic-WISE Differencing for Movers & Long-Term Variables):** Integrate SPHEREx L2 / HiPS spectra through exact WISE W1 ($3.4\,\mu\text{m}$) and W2 ($4.6\,\mu\text{m}$) filter curves and diff against **CatWISE2020 + unWISE (2010–2024)**. Because CatWISE2020 is an independent 2010–2020 baseline at matching $\sim 6''$ resolution, **nothing self-subtracts**, fast movers jump $20\text{--}130''$, and long-term variables stand out cleanly!
   * **Pipeline B (L2 Source-Space Spectro-Temporal Decomposition for Intra-SPHEREx Changes & QR3):** At catalog coordinates (Gaia DR3 + CatWISE2020) *plus* unmatched L2 `FLAGS & SOURCE` peaks in our target zones and latest weekly QR3 strip, extract `EPSF`-weighted, `ZODI`-subtracted fluxes $(t_i, \lambda_i, F_i, \sigma_i)$. Fit a joint model of **Trajectory $\vec{\mu}$ + Smooth Baseline SED $S(\lambda)$ + Epoch Offset $\Delta m(t)$**. Rank anomalies by exact reduced-$\chi^2$ breakdown into **Movers**, **Chromatic Variables**, and **SkyBoT-Vetted Solar System / Transient Events**.
2. **Replace Black-Box Neural Embeddings with a 12-D Physics & SPIFF Template Vector:**
   * Represent every source by an explicit, normalized 12-D astrophysical feature vector:
     $$\vec{v} = \big[\,\text{W1}-\text{W2},\; J-K_s,\; \text{CH}_4(3.3/4.5\,\mu\text{m}),\; \text{H}_2\text{O}(2.7/2.2\,\mu\text{m}),\; \text{CO}(4.6/4.0\,\mu\text{m}),\; \text{Ice}(3.1\,\mu\text{m}),\; \log_{10}|\vec{\mu}|,\; \text{RMS}_{\text{var}}(\text{opt}),\; \text{RMS}_{\text{var}}(\text{IR}),\; \Delta(\text{IR}-\text{opt})\text{ slope},\; T_{\text{eff,SPIFF}},\; \text{S/N}_{4.5\mu\text{m}}\,\big]$$
   * Clicking **"More Like This"** runs instant weighted cosine similarity in this 12-D physical space—and displays a **Radar/Spider Chart** showing *why* two objects matched (e.g., *"Matched WISE 0855: extreme $4.5\,\mu\text{m}$ excess + deep $3.3\,\mu\text{m}$ $\mathrm{CH_4}$ trough + $|\vec{\mu}| > 1''/\text{yr}$"*).

---

### 1. Complete Product Specification (Screens & Features)

```
+---------------------------------------------------------------------------------------------------+
|  DELTA-SKY: CHRONOPRISM  | [Search RA/Dec, Name, or Asteroid...] | Lens: [Natural IR v] | [Share] |
+----------------------------------+-----------------------------------+----------------------------+
|  A. DISCOVERY FEED & TERNARY MAP |  B. MULTI-EPOCH & CHEMICAL VIEWER |  C. 4D PRISM & KINEMATICS  |
|                                  |                                   |                            |
|     /\   Chromatic Variables     |  +-----------------------------+  |  102-Band Dynamic Spectrum |
|    /  \    (R Dra, RW Aur)       |  |   WebGL2 Live Cutout Canvas |  |  Flux (MJy/sr or uJy)      |
|   /  * \                         |  |   - 2010-2024 unWISE Blink  |  |   ^    .. .  [SPIFF T8/Y]  |
|  /   .  \                        |  |   - 2025-2026 SPHEREx L2    |  |   |  .     .    ...        |
| / *      \                       |  |   - Diff (Epoch B - Epoch A)|  |   +------------------> um  |
| +--------+                       |  |   - Gaia DR3 PM Vectors     |  |   0.75   2.0   3.5   5.0   |
| Movers    SSO/Transients         |  |   - 22-Bit FLAGS X-Ray      |  |                            |
| (0855, Barnard's)                |  +-----------------------------+  |  Kinematic Refocus Slider: |
|                                  |  [|<] [Play] [>|]  Speed [1x]     |  pmRA:  [-8.10 "/yr] ===O= |
| Filter: [All] [QR3 This Week]    |  Mode: [Blink] [Diff A-B] [16-Yr] |  pmDec: [+1.30 "/yr] ==O== |
|                                  |  Chemical Lens:                   |  [Auto-Lock PM] [Reset 0]  |
| > 1. WISE 0855-0714 (Y4 Mover)   |  [6-Band RGB] [CH4 Cold] [H2O/CO] |                            |
| > 2. R Draconis (Mira H2O Pulse) |                                   |  Light Curve (SED-Normed): |
| > 3. RW Aurigae (Dust Occult)    |  6-Detector Coadd Strip:          |  Delta-m (mag) vs MJD      |
| > 4. (1036) Ganymed (QR3 SSO)    |  [B1][B2][B3][B4][B5][B6: 4.5um]  |  *  *   *       *  *       |
| > 5. J1755+6612 (NEP Unexplained)|                                   |  [More Like This (12-D)]   |
+----------------------------------+-----------------------------------+----------------------------+
```

#### Screen-by-Screen Feature Breakdown:
1. **Left Panel — Coordinate-Free Discovery Deck & Ternary Selector:**
   * **Interactive Ternary Plot & Aladin Sky Mini-Map:** Every pre-vetted anomaly is plotted by its normalized $(\chi^2_{\text{Mover}}, \chi^2_{\text{Variable}}, \chi^2_{\text{Transient/SSO}})$ weights and shown on a multi-order Aladin Lite v3 sky map (with toggleable HiPS layers: SPHEREx DR1, CatWISE2020, Gaia DR3 density, and our **16-Year Synthetic-WISE Change HiPS Layer**).
   * **Category Tabs:** *Featured 5 Test Targets*, *16-Year Movers*, *Chromatic Variables*, *Solar System Crossers (SkyBoT)*, and *🔥 Latest Weekly QR3 Strip*.
   * **Auto-Vetting Badges:** Every card shows instant cross-match pills: `Gaia DR3 (PM known)`, `CatWISE2020 (ΔW2 = +1.4 mag)`, `SkyBoT (Asteroid #433)`, or `🚨 UNEXPLAINED (No Gaia/SIMBAD match)`.
2. **Center Panel — WebGL2 Multi-Epoch, Diff & Chemical Lens Viewport:**
   * **4 Viewing Modes:**
     1. *SPHEREx L2 Time-Lapse:* Real-time playback of S3 range-read cutouts aligned to north-up WCS, with optional **SED-Normalized Brightness** (dividing out the static baseline spectrum $S(\lambda)$ so constant stars don't flash as $\lambda$ changes!).
     2. *16-Year EpochBridge (2010–2026):* Smoothly plays 2010–2024 unWISE W1/W2 epochs directly into 2025–2026 SPHEREx Synthetic-W1/W2 coadds.
     3. *Epoch Algebra (Add / Subtract / Shift-and-Add):* Select any two epoch ranges (e.g., Survey 1 vs. Survey 2, or Bright State vs. Faint State) to view `(Epoch B - Epoch A) / sqrt(Var_A + Var_B)` in units of $\sigma$, or stack along a trial velocity vector $(\mu_\alpha, \mu_\delta)$.
     4. *6-Detector Array Coadd Strip:* Persistent 6-thumbnail bar showing inverse-variance coadds separated cleanly by detector Bands 1 through 6 ($0.75\text{--}5.0\,\mu\text{m}$).
   * **Chemical Lens Bar (1-Click Band Ratios):** *Natural 6-Band RGB*, *Methane Cold-World Lens ($4.5\,\mu\text{m} / 3.3\,\mu\text{m}$)*, *Water/Mira Lens ($2.7\,\mu\text{m} / 2.2\,\mu\text{m}$)*, *CO & Dust Disk Lens ($4.6\,\mu\text{m} / 1.6\,\mu\text{m}$)*, and *Custom Bandpass Painter* (drag directly on the spectrum plot to define Blue, Green, and Red wavelength windows!).
   * **Contamination Flag X-Ray & Overlays:** Interactive bitmask pills for all 22 `FLAGS` bits (grouped into *Optical Ghosts/Streaks*, *Detector Persistence/Overflow*, *Cosmic Ray Snowballs*, and *Pipeline Source*) + Gaia DR3 proper-motion arrows (propagated to exact `MJD-OBS`) + CatWISE2020 + SkyBoT asteroid ellipses.
3. **Right Panel — Synchronized 102-Band Dynamic Spectrum, Kinematic Refocuser & Light Curve:**
   * **On-the-Fly 102-Band Spectrum (`EPSF` + `ZODI` + `VARIANCE` aware):** Displays flux density ($F_\nu$ in $\text{MJy/sr}$ or point-source $\mu\text{Jy}$) vs. exact `WCS-WAVE` $\lambda$ ($0.75\text{--}5.0\,\mu\text{m}$). Points are color-coded by observation epoch (or pulsation phase for R Dra).
   * **The "Kinematic Refocuser" (`pmRA`, `pmDec` Sliders + Auto-Fit):** Dragging the proper-motion sliders dynamically shifts the extraction aperture across epochs $\vec{r}(t) = \vec{r}_0 + \vec{\mu}(t - t_0)$ in real time—watching the 6-band coadds sharpen and the 102-channel spectrum lock together!
   * **SED-Normalized Multi-Year Light Curve:** Plots $\Delta m(t) = -2.5 \log_{10}[F_i(\lambda_i, t_i) / S_{\text{baseline}}(\lambda_i)]$ vs. time (from 2010 unWISE through 2026 SPHEREx QR3), cleanly separating temporal variability from wavelength sweep.
   * **SPIFF Template Overlay & "More Like This" Drawer:** Overlays the best-fitting brown dwarf / stellar template from the 6,003 SPIFF library + key molecular absorption bands ($\mathrm{H_2O}, \mathrm{CH_4}, \mathrm{CO}, \mathrm{CO_2}$, silicate/water ice) and opens the 12-D Physical Similarity Radar to jump to the 10 closest twins in the catalog.

---

### 2. The "Small Details" List That Will Make SPHEREx Scientists Cheer

To score a perfect **5/5 on Validity and Relevance**, include these 8 instrument-specific details that 99% of hackathon teams will miss:

1. **Explicit `IMAGE - ZODI` Subtraction Toggle (Default ON):** Raw SPHEREx L2 `IMAGE` extensions include zodiacal foreground. Always subtract the `ZODI` extension before coadding, blinking, or extracting spectra, and include a UI toggle (*"Show Zodiacal Foreground"*) so users can see how bright the interplanetary dust glow actually is at $3\text{--}5\,\mu\text{m}$!
2. **Continuous Per-Pixel Wavelength Evaluation via `WCS-WAVE`:** Never assume an exposure has a single filter wavelength. Evaluate the 2D polynomial `WCS-WAVE` header at the exact sub-pixel centroid $(x(t), y(t))$ of the target in every frame, and display the LVF wavelength gradient across the image cutout as a subtle rainbow axis tick along the cutout border.
3. **Conversion from Surface Brightness ($\text{MJy/sr}$) to Point-Source Flux ($\mu\text{Jy}$ or AB Mag) Using the $21\times21$ `EPSF`:** Multiply by the solid angle per pixel $\Omega_{\text{px}} = (6.15'' / 206265)^2 = 8.89 \times 10^{-10}\text{ sr}$ ($1\text{ MJy/sr} \cdot \Omega_{\text{px}} = 889.1\,\mu\text{Jy/px}$) and apply optimal PSF-weighted photometry:
   $$F_{\text{pt}} = \Omega_{\text{px}} \frac{\sum_{p} P_p (I_p - Z_p) / V_p}{\sum_{p} P_p^2 / V_p}, \quad \sigma_F = \Omega_{\text{px}} \left(\sum_{p} \frac{P_p^2}{V_p}\right)^{-1/2}$$
   where $P_p$ is bilinearly interpolated from the nearest cell of the $21\times21$ `EPSF` extension and $V_p$ is `VARIANCE`.
4. **SED-Normalized Blinking ("De-Flashing the LVF"):** In raw L2 movies, a red star appears faint when sampled at $0.9\,\mu\text{m}$ and blindingly bright when sampled at $4.5\,\mu\text{m}$. Provide a **"Normalize by Baseline Spectrum $S(\lambda)$"** switch in the video player: each cutout is divided by the source's median flux at that frame's central wavelength $\lambda_i$, so **static stars stay constant brightness while only true variables and movers change!**
5. **Named 22-Bit `FLAGS` Decoder with Physical Explanations:** Don't show raw hex integers like `0x000420`. Decode all 22 bits into human-readable badges (`SOURCE`, `PERSIST`, `GHOST`, `STREAK`, `SNOWBALL`, `OVERFLOW`, `NONFUNC`, `SATURATED`, etc.) and show how toggling *"Mask Persistence & Ghosts"* removes fake single-epoch spikes from the light curve and spectrum.
6. **Proper-Motion Aperture Tracking Across the 6 Detector Arrays:** For Barnard's Star ($10.3''/\text{yr}$, moving $1.7\text{ px/yr}$) and WISE 0855 ($-8.1''/\text{yr}$), show a side-by-side comparison on the spectrum panel: **Fixed RA/Dec Extraction (IRSA baseline)** vs. **ChronoPrism Motion-Tracked Extraction ($\vec{r}(t)$)**. This visually proves why fixed-position photometry fails on fast movers.
7. **Exact WISE W1/W2 Bandpass Integration on SPHEREx Spectra:** Show the shaded WISE W1 ($3.4\,\mu\text{m}$) and W2 ($4.6\,\mu\text{m}$) filter transmission curves right on top of the 102-channel SPHEREx spectrum plot, plotting the historical 2010–2024 unWISE/CatWISE fluxes alongside the 2026 SPHEREx synthetic W1/W2 points.
8. **Deterministic URL State & 1-Click AstroPy Notebook Snippet:** Every view serializes cleanly into the URL query string (`?target=WISE0855&ra=133.78&dec=-7.24&pmra=-8110&pmdec=1280&lens=ch4&zodi=sub&flags=clean`) *and* has a **"Copy 15-Line `astropy` + `s3fs` Reproducibility Code"** button that gives scientists the exact Python snippet to reproduce the cutout and spectrum on their laptop.

---

### 3. Guaranteed Shippable 42-Hour MVP Cut vs. Stretch Goals

With $\le 6$ people + AI coding agents and 42 hours remaining, enforce a **strict feature freeze at Hour 30** so Hours 30–42 are dedicated to polish, caching, deployment, and the 30-second video.

| Layer | Guaranteed 42-Hour MVP (Ship This First — Hours 0 to 30) | Stretch Goals (Only if MVP is locked by Hour 30) |
| :--- | :--- | :--- |
| **1. Data & Precompute (8x RTX 5000 Ada)** | • Pre-extract complete, `ZODI`-subtracted, `EPSF`-weighted cutout + spectrum + light-curve JSON/binary bundles for **the 5 required test targets** + **500 curated anomalies** across 4 regions (NEP R Dra field, Taurus RW Aur field, high-PM brown dwarfs, and 1 weekly QR3 strip) (~1.2 GB static CDN pack, instant 0-latency load).<br>• Compute the 12-D physical feature vector + SPIFF template matches for all 505 targets. | • Expand precomputed catalog to 50,000 sources across full NEP/SEP deep fields.<br>• Generate an all-sky HEALPix HiPS overlay layer of Synthetic-W1/W2 minus CatWISE2020 from the DR1 12.9" HiPS cube. |
| **2. Live On-Demand Backend API** | • Fast Python (FastAPI) service using your validated S3 byte-range reader (93 cutouts in 19s) + IRSA TAP exposure inventory + SIMBAD/Gaia DR3/SkyBoT lookup for **any user-entered RA/Dec or object name**.<br>• Returns compressed binary arrays (`IMAGE-ZODI`, `VARIANCE`, `FLAGS`, `WCS-WAVE`, `EPSF` summary) to the browser. | • Live on-demand unWISE 2010–2024 cutout stitching for arbitrary coordinates (for MVP, pre-bundle unWISE epochs for the 505 curated targets and fetch live for on-demand queries with a 3s timeout). |
| **3. Web UI & Discovery Workflow** | • **3-Panel Studio UI** (React/Vite + Tailwind + WebGL2/Canvas2D + Aladin Lite v3 + Plotly/uPlot).<br>• **Ternary Discovery Map & Ranked Feed** (Movers, Chromatic Variables, QR3 Transients/Asteroids).<br>• **6-Detector Coadd Bar** + **Chemical Lens Presets** ($\mathrm{CH_4}$, $\mathrm{H_2O}$/CO, Dust, Natural).<br>• **Kinematic Refocuser Sliders (`pmRA`, `pmDec`)** updating the spectrum & coadd live.<br>• **22-Bit `FLAGS` X-Ray Overlay** + Epoch Add/Subtract + URL query sharing. | • Custom draggable RGB bandpass painter on the 102-channel spectrum.<br>• Interactive Lomb-Scargle periodogram phase-folder for R Draconis.<br>• 1-click export of MPC ADES / Backyard Worlds vetting cards. |

---

### 4. The 30-Second Demo Storyline (Designed to Score 5/5 on Presentation)

> **Format:** Fast-paced, zero-fluff screen recording with crisp voiceover. Every single frame shows real SPHEREx L2 data and hits all 5 test targets.

* **0:00 – 0:05 | The Hook & The Problem:**
  * *Visual:* Split screen of raw SPHEREx exposures blinking wildly at a fixed coordinate on **Barnard’s Star** and **WISE 0855-0714**, with a fragmented, broken 102-band spectrum.
  * *Voiceover:* *"SPHEREx maps the entire sky in 102 infrared colors—but because every exposure changes wavelength, raw time-lapses flash wildly, and moving objects walk right out of fixed spectrographs. Meet **Delta-Sky: ChronoPrism**."*
* **0:05 – 0:13 | Kinematic Refocusing & The 16-Year Time Machine (Movers: WISE 0855, $\epsilon$ Indi B, Barnard's Star):**
  * *Visual:* Click **WISE 0855-0714** on the Ternary Discovery Map. Toggle the **Methane Cold-World Lens ($4.5/3.3\,\mu\text{m}$)**—the cold Y-dwarf lights up in Band 6 while field stars vanish. Play the **16-Year unWISE $\rightarrow$ SPHEREx Synthetic-W2 movie**, then drag the **Kinematic Refocus slider** to $-8.1''/\text{yr}$: watch the smeared SPHEREx coadd snap into a sharp point and the 102-band spectrum lock onto a SPIFF Y-dwarf template.
  * *Voiceover:* *"Pick an anomaly from our Ternary Map—or enter any coordinate via fast S3 byte-range reads. Watch WISE 0855 march across 16 years of WISE and synthetic SPHEREx frames, then slide the Kinematic Refocuser to lock its moving 102-channel methane spectrum in real time."*
* **0:13 – 0:22 | Chemical Goggles & Molecular Breathing (Variables: R Draconis & RW Aurigae):**
  * *Visual:* Click **R Draconis** (2,500 NEP exposures). Toggle **"SED-Normalized Blink"** and the **Water/CO Lens**. Background stars freeze rock-steady while R Dra pulses dramatically; the 102-band spectrum animates across pulsation phases showing deep $1.9\,\mu\text{m}$ and $2.7\,\mu\text{m}$ $\mathrm{H_2O}$ bands breathing in and out, while **RW Aurigae** shows dust occultation dimming. Toggle the **22-Bit Contamination X-Ray** to mask out a cosmic ray `SNOWBALL` and `PERSIST` ghost.
  * *Voiceover:* *"Normalize by the baseline spectrum to stop wavelength flashing: across 2,500 exposures of R Draconis, watch its water and carbon monoxide bands breathe over its pulsation cycle, unmasking true astrophysical changes while filtering out 22-bit contamination flags."*
* **0:22 – 0:30 | Weekly QR3 Live Feed, Similarity Search & Call to Action:**
  * *Visual:* Click **"This Week's QR3 Pulse"** $\rightarrow$ click an asteroid caught crossing the LVF to reveal its moving-frame reflectance+thermal spectrum, then click **"More Like This"** on $\epsilon$ Indi B to surface uncatalogued brown dwarf candidates via the 12-D Physics Radar. End on the shareable URL banner.
  * *Voiceover:* *"Updated automatically with weekly QR3 releases, SkyBoT asteroid tracking, and 12-dimensional physical similarity search, ChronoPrism turns SPHEREx's 102 bands into a public discovery engine for everyone."*
