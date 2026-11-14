### 1. TECHNICAL JUDGE (NASA Archive Software / Data Engineer)

1. **Astrometric calibration risks**:
   - [detect.ts](../../web/src/blink/detect.ts#L155-L165) ties visits to Gaia DR3 (`[VERIFIED]` catalog) using only a scalar median offset `(xi, eta)` per visit, ignoring residual roll/scale errors across the stamp from SPHEREx’s ~180° roll flip between visits (`[VERIFIED]`). Worse, if `<3` clean Gaia stars pass `snr >= 12`, `off[vi]` silently defaults to `{xi: 0, eta: 0}`, mixing uncalibrated and calibrated visits in the same fit.
   - [detect.ts](../../web/src/blink/detect.ts#L109-L114) drops per-visit centroids that shift `>1.5` px (`9.2″`) from the whole-run stack position, while the single-visit `loose` linker requires `snr >= 7`, creating a detection blind spot for $5 \le \text{SNR} < 7$ movers shifting $>9.2''$.
   - [measure.ts](../../web/src/blink/measure.ts#L203-L236) (`fitMotion`) fits single exposures without applying the per-visit Gaia offset `off[vi]`.
2. **Cross-epoch matching & linking bugs**:
   - [detect.ts](../../web/src/blink/detect.ts#L200-L208) assigns AllWISE (`[VERIFIED]`) counterparts greedily (`usedW.add`) in SNR order rather than by global minimum distance; a bright source can steal a neighbour’s counterpart up to 8″ away.
   - [detect.ts](../../web/src/blink/detect.ts#L119-L126) sorts `loose` pairs by lowest speed and marks endpoints `used = true` before verifying 3-visit colinearity.
   - [detect.ts](../../web/src/blink/detect.ts#L283) overwrites `r.epochs` with `[e, ...SPHEREx]` when linking an orphan WISE source, silently discarding any 2MASS (`[VERIFIED]`) epoch instead of re-projecting to 1999.5.
3. **Error model flaws**:
   - [detect.ts](../../web/src/blink/detect.ts#L76-L77) scales rate errors by $\max(1, \sqrt{\chi^2_\nu})$, [detect.ts](../../web/src/blink/detect.ts#L211) adds `sysPos(s.snr)` to WISE/2MASS positions, and [detect.ts](../../web/src/blink/detect.ts#L291) adds `pmFloor` (`pmRms`) again in quadrature—double-counting confusion systematics.
   - [measure.ts](../../web/src/blink/measure.ts#L197-L235) defines `PLX_SYS = 0.08` for roll-induced parallax bias but never folds it into `eplx`.
4. **Variability test bug**:
   - In [measure.ts](../../web/src/blink/measure.ts#L105-L133), `v.n = cnt[i]` is the number of *matched pairs* touching visit $i$, not independent exposures. Dividing `SYS[det]` by $\sqrt{\text{cnt}[i]}$ underestimates pixel-phase noise by $\sqrt{N_{\text{other}}}$ when one exposure pairs against many in another visit; `chi2` also tests against `log(ratio) = 0` rather than the weighted mean.
5. **Performance & NASA archive robustness**:
   - [engine.ts](../../web/src/blink/engine.ts#L294-L383) runs `N×N` TAN-SIP fixed-point inversions, Rice decoding, and 90-source PSF photometry on the main thread, firing 150–250 HTTP Range requests per field.
   - [engine.ts](../../web/src/blink/engine.ts#L253) mutates module-global `FLAG_DEFS` during concurrent fetches; [engine.ts](../../web/src/blink/engine.ts#L388) hardcodes `n1 = 2040` (`[VERIFIED]` H2RG active width); [engine.ts](../../web/src/blink/engine.ts#L325) assumes `FLAGS` immediately follows `IMAGE` at `dataStart + ceil(n1*n2*4/2880)*2880`, which breaks if IRSA (`[VERIFIED]`) changes HDU ordering (`[UNSURE]` across all future pipeline versions).
6. **Live demo risks, over-engineering & pre-submission tests**:
   - **Breaks in live demo**: 200+ S3 Range calls + live CDS VizieR (`[VERIFIED]`) queries over venue Wi-Fi; if Gaia times out, astrometric tie and blend rejection silently disable.
   - **Over-engineered**: 3D Horizons-to-CMB fly-through ([README.md](../../README.md#L23)) and LLM tool-calling assistant ([15_product_brief.md](../../docs/15_product_brief.md#L36)).
   - **Must test**: Pre-cached offline bundle for demo fields, CDS mirror timeout behavior, and `PLX_SYS` / `cnt[i]` fixes.

---

### 2. SPACE SCIENCE JUDGE (Infrared Astronomer — Brown Dwarfs & Planet Nine)

1. **Central question framing**:
   - *"Is there an undiscovered world moving near the Sun?"* ([15_product_brief.md](../../docs/15_product_brief.md#L7)) fits nearby cold brown dwarfs and free-floating planets (e.g., WISE 0855 at 2.28 pc, ~250 K `[VERIFIED]`), **but is scientifically flawed if presented as a "Planet Nine" search**. A solar-system Planet Nine at 400–800 AU ($T \sim 35\text{--}50\text{ K}$, $V \sim 19\text{--}22$ `[VERIFIED]`) exhibits 6-month parallactic reflex motion ($\sim 5\text{--}10''$) rather than a linear 15-year proper motion in WISE/2MASS, and is orders of magnitude fainter at 1–5 µm than SPHEREx Level-2 single-exposure depth (~18–19 AB mag `[VERIFIED]`). Frame the tool around **nearby substellar worlds (L/T/Y dwarfs) and high-proper-motion IR sources**.
2. **Defensible vs. vulnerable claims**:
   - **Defensible**: Recovering $\epsilon$ Indi B, Luhman 16, and WISE 0855 with on-the-fly 0.75–5 µm LVF spectra resolving the 3.3 µm $\text{CH}_4$ $\nu_3$ band (`[VERIFIED]`), and retracting the spurious "brightened/vanished" lists after catching the WISE flux bug ([15_product_brief.md](../../docs/15_product_brief.md#L70-L72)).
   - **Will be attacked**:
     - *Contradictory tables*: Barnard’s Star is listed as `−0.809, +10.432 ± 0.034 ″/yr` in [15_product_brief.md](../../docs/15_product_brief.md#L55) (using 2MASS/WISE/Gaia in `detect.ts`) vs. `−2.5 ± 0.4, +10.2 ± 0.4 ″/yr` in [README.md](../../README.md#L33) (SPHEREx-only wings); WISE 0855’s SPHEREx-only $\mu_\delta$ (`+2.7 ± 0.8 ″/yr`) is $2.5\sigma$ off literature (`+0.67 ″/yr` `[VERIFIED]`).
     - *Chromatic centroiding*: Claiming "position does not depend on wavelength" ([verify_census.mts](../../web/scripts/verify_census.mts#L65-L66)) when stacking 0.75–5 µm across 6.15″ pixels (`[VERIFIED]`) is false—a red source blended with a blue field star shifts photocenter with wavelength, mimicking motion when visit wavelength sampling differs.
     - *SPHEREx-only parallaxes* ([README.md](../../README.md#L34)): 6.15″ undersampled pixels with 180° roll flips cannot yield credible single-source parallaxes without reference-frame differential astrometry.
3. **Missing researcher instrument / plot**:
   - Overplotted **L/T/Y standard spectral templates** (e.g., SpeX Prism Library `[VERIFIED]`) with $\text{H}_2\text{O}$ ($1.4, 1.9, 2.7\text{ }\mu\text{m}$), $\text{CH}_4$ ($2.2, 3.3\text{ }\mu\text{m}$), and $\text{CO}$ ($4.6\text{ }\mu\text{m}$) bandheads (`[VERIFIED]`), plus a **Reduced Proper Motion diagram** ($H_{W2} = W2 + 5\log_{10}\mu + 5$ vs. $W1 - W2$) to separate brown dwarfs from subdwarfs/white dwarfs.
4. **How to present the census results (17,017 / 177,221; 22 candidates)**:
   - Present the 177,221 → 17,017 funnel as a **90.4% false-positive filter** proving SPHEREx eliminates unWISE (`[VERIFIED]`) linking artefacts (40% static blends, 43% noise).
   - Do **not** call the 6 confirmed candidates "not in any catalogue" until cross-matched against **CatWISE2020** (Marocco et al. 2021 `[VERIFIED]`) and **UltracoolSheet** (`[VERIFIED]`)—[detect.ts](../../web/src/blink/detect.ts#L305) only checks Gaia DR3, AllWISE (2010), and 2MASS.
5. **Scientific checks for the next 20 hours**:
   - Cross-match the 6 moving candidates and 52 $\text{CH}_4$ sources against CatWISE2020, SIMBAD (`[VERIFIED]`), and UltracoolSheet; report blue-stack vs. red-stack centroid offsets for all 6 to rule out chromatic blends.

---

### 3. BUSINESS JUDGE (Space-Industry Investor / Programme Manager)

1. **Is there a real customer?**:
   - End-users (researchers, volunteers) never pay for archival astronomy viewers (`[VERIFIED]`), and your two documents contradict each other: [13_business_plan.md](../../docs/13_business_plan.md#L7-L8) dismisses investor logic to pitch a grant-funded public good, while [15_product_brief.md](../../docs/15_product_brief.md#L88-L91) pitches institutional B2B/B2G sales (observatories, Space Domain Awareness, education). Align on one model: **free public science portal sustained by open-science grants + B2B archive-engineering contracts**.
2. **Comparable positioning & pricing**:
   - *Astronomy platforms* (Aladin Lite, WiseView, IRSA, Zooniverse `[VERIFIED]`) are free to users and funded by agency budgets or NASA ROSES / NSF / Sloan grants ($100k–$500k/yr `[VERIFIED]`).
   - *Commercial SDA firms* (LeoLabs, ExoAnalytic, Slingshot Aerospace `[VERIFIED]`) sell real-time LEO/GEO tracking and conjunction alerts via $50k–$5M+/yr enterprise/defense SaaS (`[UNSURE]` on exact contract floors)—nothing like a 6-month-cadence IR archive browser.
   - *Scientific open-source consultancies* (Quansight, QuantStack, 2i2c `[VERIFIED]`) charge institutions $25k–$250k/yr (`[UNSURE]` on exact average contract size) for custom cloud pipelines and managed hubs.
3. **One credible positioning sentence & 2–3 paying use cases**:
   - **Positioning sentence**: *"MIRA is a zero-backend, cloud-native FITS cutout and time-domain analysis engine that lets space archives and survey teams stream multi-epoch datasets directly from cloud object storage to any browser at near-zero server cost."*
   - **Credible paying/funded use cases**:
     1. *Cloud Archive Integration Contracts ($50k–$150k B2G/Consortia)*: Adapting MIRA’s HTTP-Range FITS + Rice-decompression engine for archives on AWS Open Data (`[VERIFIED]`) (IRSA, Euclid, Roman, Rubin brokers `[VERIFIED]`) to eliminate server cutout compute costs.
     2. *NASA ROSES Citizen-Science / Open-Source Grants ($100k–$300k/yr)*: Co-proposing under ROSES F.7/F.14 (`[VERIFIED]`) with a US university / Backyard Worlds (`[VERIFIED]`) lead PI.
     3. *Turnkey Planetarium & University Lab Kits ($2k–$15k/institution)*: Sponsored Arabic/French/English astro-lab deployments for MENA universities, planetariums, and observatories (e.g., Oukaïmeden `[VERIFIED]`).
4. **What in the pitch is naive**:
   - **Claiming Space Domain Awareness (SDA) / planetary defence buyers** ([15_product_brief.md](../../docs/15_product_brief.md#L90-L91)): SDA requires sub-minute tracking of fast satellites (`[VERIFIED]`), whereas MIRA links 6-month visits across 15-year baselines.
   - **Treating "$36.14/hr volunteer time = $360k/yr" as ROI** ([13_business_plan.md](../../docs/13_business_plan.md#L80), Independent Sector figure `[UNSURE]` for exact 2025/2026 rate): Grant reviewers evaluate cost per vetted discovery and software bus-factor, not theoretical wage replacement.
   - **Ignoring static-data egress**: `public/data/` is ~0.9 GB ([13_business_plan.md](../../docs/13_business_plan.md#L46)); viral hackathon traffic will hit free-tier bandwidth caps without CDN caching rules.

---

### Ranked List: 8 Most Valuable Changes for the Next 20 Hours

1. **Bundle a zero-network demo cache for the 5 challenge targets + 6 top candidates** (3 hrs): Pre-package the headers/stamps and Gaia/WISE/2MASS JSON responses so the live presentation cannot fail on venue Wi-Fi, S3 throttling, or CDS mirror timeouts.
2. **Vet and publish a complete dossier table for the 6 confirmed unknown-neighbour candidates** (3 hrs): Cross-match all 6 against CatWISE2020, SIMBAD, and UltracoolSheet; add a table to [15_product_brief.md](../../docs/15_product_brief.md) and the UI showing coordinates, $\mu_\alpha, \mu_\delta$, $W1/W2$, $3.3\text{ }\mu\text{m}$ $\text{CH}_4$ S/N, and blue-vs-red centroid offset.
3. **Reconcile the contradictory validation numbers between `README.md` and `docs/15_product_brief.md`** (1 hr): Explicitly label "SPHEREx-only (1-yr baseline)" vs. "SPHEREx + WISE + 2MASS (26-yr baseline)" in [README.md](../../README.md#L31-L38) and [15_product_brief.md](../../docs/15_product_brief.md#L51-L58) so judges do not suspect cherry-picked numbers on Barnard’s Star.
4. **Fix the 3 fast math bugs in `measure.ts` and `detect.ts`** (2.5 hrs):
   - Count unique exposures per visit (not pair count `cnt[i]`) when scaling `SYS[det]` in [measure.ts](../../web/src/blink/measure.ts#L121-L132) (`spread`).
   - Fold `PLX_SYS` into `eplx` and apply per-visit Gaia offsets `off[vi]` in [measure.ts](../../web/src/blink/measure.ts#L197-L235) (`fitMotion`).
   - Preserve/re-match 2MASS epochs when linking orphan WISE sources in [detect.ts](../../web/src/blink/detect.ts#L283) and sort WISE counterpart claims by global distance.
5. **Add L/T/Y spectral template overlays + molecular band markers (`CH4` 3.3 µm, `H2O`, `CO` 4.6 µm) to the Spectrograph** (3 hrs): Gives science judges immediate visual proof of brown dwarf classification on $\epsilon$ Indi B, WISE 0855, and the 52 $\text{CH}_4$ candidates.
6. **Add a $W1-W2$ vs. Reduced Proper Motion ($H_{W2}$) diagnostic plot** (2.5 hrs): Places the field’s moving sources against standard L/T/Y dwarf tracks without relying on noisy SPHEREx-only parallaxes.
7. **Harden `engine.ts` against FITS layout/concurrency edge cases** (2 hrs): Scope `FLAG_DEFS` per file/version instead of mutating a global array ([engine.ts](../../web/src/blink/engine.ts#L253)), replace hardcoded `n1 = 2040` ([engine.ts](../../web/src/blink/engine.ts#L388)) with `NAXIS1`, and surface a clear UI banner when `<3` Gaia stars are available for visit registration.
8. **Align the business & science narrative across `15_product_brief.md` and `13_business_plan.md`** (1.5 hrs): Drop the implausible Space Domain Awareness claim, distinguish nearby brown dwarfs/free-floating worlds from distant solar-system Planet Nine models, and lead with the 90.4% false-positive rejection funnel plus cloud-archive integration services.
