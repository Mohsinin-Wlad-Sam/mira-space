# 1. Four project concepts

The concepts below share one product constraint: users should be able to find something interesting without bringing coordinates, while experts can inspect the underlying measurements. A time-lapse is useful evidence, but it is not the discovery mechanism.

For rough sizing, one full-resolution 2040×2040 float32 image plane is about **16.6 MB** before compression. A 128×128 cutout with image, variance, flags, zodiacal background, and wavelength data is roughly **0.33 MB** if each layer is 32-bit. Actual transfer depends on the FITS layout and which byte ranges the reader requests. Your measured benchmark—93 cutouts in 19 seconds—is the strongest available throughput estimate.

## A. SPHEREx Change Atlas

**Pitch:** Browse a ranked, explainable map of places where SPHEREx observations change, then inspect the exposures that produced each candidate.

**Who uses it / 60-second journey:** A student opens the Atlas, chooses “moving,” “brightening,” or “uncertain,” and sees candidate tiles on a sky map. They open one candidate, compare its observed positions or brightness across exposures, inspect flags and known-object matches, then share a link to the evidence. A researcher can start at a coordinate or filter by footprint, date, and candidate type.

**Discovery mechanism:** A ranked feed and heat map surface repeat-observation changes in selected fields. Each candidate has an evidence card showing the measured signal, relevant exposures, wavelength samples, artifact flags, and available crossmatches. Ranking should reflect evidence quality and uncertainty, not just raw difference magnitude.

**Why it is non-obvious:** The product is an inspectable census of *changes*, not an image browser. Its scientific value depends on knowing when two measurements are comparable: SPHEREx samples wavelength and time together, and its flags can identify detector artifacts that resemble astrophysical changes.

**Technical pipeline and estimates:**

- Start with bounded footprints: the deep fields, one ecliptic strip, one Galactic-plane patch, and the five challenge targets.
- Use the IRSA exposure inventory to find observations. Fetch cutouts from S3 by byte range; store a manifest of exposure IDs, timestamps, coverage, and usable layers.
- Detect candidates using native exposures or matched, same-wavelength measurements. Apply flag masks, local background handling, and conservative ranking.
- At about **0.33 MB per 128×128 cutout**, 1,000 cutouts are approximately **0.33 GB** of layer data. The measured 93-cutout benchmark projects to roughly **3.4 minutes per 1,000 cutouts** at the same serialized rate; treat this as a planning estimate, not a guaranteed ingest time.
- A small candidate catalog and cutout cache are practical to serve from static files or a cheap API. Full FITS processing should run offline for selected fields, not on every page load.

**Precomputed vs. on-demand:** Precompute field manifests, candidate ranks, cutouts, and crossmatch status for selected fields. On demand, resolve a user’s coordinate through TAP and fetch a limited set of exposures for inspection.

**42-hour feasibility: 3/5.** A tightly bounded, useful Atlas is feasible; a trustworthy all-sky change catalog is not. **Riskiest assumption:** native exposure data can be aligned and compared well enough across the chosen fields to rank real changes above calibration and detector artifacts.

**Judging estimate (Impact / Creativity / Validity / Relevance / Presentation):** **4 / 4 / 3 / 5 / 5.** Strong discovery story and clear NASA-data use; validity depends on conservative candidate vetting.

---

## B. The Infrared Color Clock

**Pitch:** Explore how sources change in brightness *and color* as SPHEREx’s wavelength sampling unfolds over time.

**Who uses it / 60-second journey:** A student chooses a phenomenon such as “color changes,” “pulsing,” or “moving,” then selects a curated source or field. The display reveals what SPHEREx actually measured: timestamped points with their wavelength, uncertainty, and flags. The user can compare that pattern to another source or open a sky stamp for context.

**Discovery mechanism:** A gallery of spectro-temporal patterns grouped by observable behavior—such as changing color, periodic brightness, or position shift—leads users from a visual pattern to a source and its evidence. The gallery can include known examples, unusual cases, and “data quality may explain this” cases.

**Why it is non-obvious:** A naïve light curve assumes repeated measurements in the same band. Here, an exposure’s wavelength depends on the LVF and the source’s position in the observation sequence. Treating all measurements as interchangeable brightness points can manufacture apparent color or time variation. This concept makes that coupling visible and useful.

**Technical pipeline and estimates:**

- For each selected source, query the exposure inventory and extract its exposure time, local wavelength, flux or aperture measurement, variance, and flags.
- Show measured samples with wavelength encoded on the plot; only compare points within an explicit wavelength tolerance or apply a documented spectral model.
- For the five targets and a small curated gallery, dozens to hundreds of cutouts are manageable. A 100-source gallery with 50 cutouts per source would be about **1.65 GB** at the rough cutout estimate above, before compression or caching.
- Use simple, interpretable summaries—same-wavelength slopes, color change, and period suggestions—with uncertainty visible. Avoid training a classifier before there is a validated labeled set.

**Precomputed vs. on-demand:** Precompute gallery measurements and summary features for selected objects. On demand, resolve coordinates, query exposures, and build the source’s wavelength-aware plot and stamps.

**42-hour feasibility: 4/5.** An honest gallery and coordinate lookup are feasible. **Riskiest assumption:** enough repeat measurements with useful wavelength overlap exist for the chosen examples to support the comparisons the interface promises.

**Judging estimate:** **4 / 4 / 4 / 5 / 4.** Distinctive SPHEREx-specific science and a strong demo; impact grows if users can discover examples rather than only inspect a fixed list.

---

## C. Infrared Neighborhoods

**Pitch:** Explore the sky as neighborhoods of sources, and discover how SPHEREx changes relate to motion, color, and nearby known objects.

**Who uses it / 60-second journey:** A learner opens a tile or searches a name. A map shows sources and crossmatches; selecting one reveals nearby objects and a comparison panel for SPHEREx and available WISE or Gaia context. The user filters the neighborhood by motion, infrared color, or observed variability and sees which objects warrant inspection.

**Discovery mechanism:** Users find *groups* and outliers—sources with unusual colors, motion, or behavior relative to nearby or similar sources—rather than hunting for one isolated anomaly. A simple “show unusual neighbors” control can expose a real contrast without requiring familiarity with catalog names.

**Why it is non-obvious:** The useful question is often not “is this source strange?” but “strange compared with what?” Local context can help separate an interesting source from a field artifact or common population behavior. The concept turns crossmatches into a way to find patterns, not just labels attached to a coordinate.

**Technical pipeline and estimates:**

- Create source lists and crossmatch tables only for selected tiles. A 1°×1° tile at 12.9″ sampling is about **280×280, or 78,000 pixels per plane**; source catalogs are far smaller than retaining every exposure plane.
- Precompute spatial indexes and crossmatch results for those tiles. Fetch per-exposure SPHEREx cutouts only when a source is selected.
- Use catalog and feature tables for neighborhood filtering. Keep crossmatch provenance and avoid presenting a catalog match as proof that two detections are the same object.
- A browser can render a few thousand points per tile; larger selections should be summarized or paged.

**Precomputed vs. on-demand:** Precompute tile source lists, crossmatches, and basic color/motion summaries. On demand, retrieve exposure evidence for selected sources and draw the local comparison.

**42-hour feasibility: 3/5.** A compelling single-tile prototype is feasible; a reliable all-sky neighborhood graph is not. **Riskiest assumption:** crossmatches and source measurements are sufficiently clean and consistent across the chosen tile to make “unusual relative to neighbors” meaningful.

**Judging estimate:** **4 / 4 / 3 / 4 / 4.** Broad and approachable, but risks feeling like a generic catalog viewer unless the neighborhood comparison yields a clear discovery.

---

## D. Sky Safari: an evidence-first citizen-science queue

**Pitch:** Give the public a short queue of real SPHEREx changes to investigate, with enough context to distinguish a discovery from an artifact.

**Who uses it / 60-second journey:** A visitor chooses a short “mission” such as “find moving sources” or “spot data artifacts.” Each task shows two or more observations, a wavelength/time strip, a flags panel, and possible known-object matches. The visitor marks a likely explanation, flags uncertainty, and sees how their assessment compares with prior reviews.

**Discovery mechanism:** A curated queue presents candidates selected from repeat-observation fields. Tasks are short, varied, and linked to visible evidence. Agreement or disagreement can prioritize candidates for expert review; it should not be marketed as confirmed discovery.

**Why it is non-obvious:** The activity is not a generic “spot the difference” game. Participants learn to use the measurement conditions—wavelength, epoch, uncertainty, and flags—and can contribute a structured triage result that helps order expert attention.

**Technical pipeline and estimates:**

- Build a queue from a bounded, precomputed candidate set. Each task can include a few small stamps plus an evidence record; at 0.33 MB per cutout, three cutouts are about **1 MB per task** before compression.
- Store task metadata, anonymous or session-level classifications, and aggregate consensus in a small API or database. Serve the visual assets from a CDN.
- Validate task labels on known examples, including flagged artifacts, before using consensus to rank unknown candidates.
- Provide downloadable evidence and classifications. Do not promise direct submissions to MPC or TNS without validating astrometry, format requirements, and review steps.

**Precomputed vs. on-demand:** Precompute and review the candidate queue and task assets. On demand, record classifications and update aggregate counts.

**42-hour feasibility: 4/5.** A polished, small queue is feasible if candidate evidence is prepared first. **Riskiest assumption:** the initial candidate set is diverse and clear enough for non-experts to make useful judgments.

**Judging estimate:** **4 / 4 / 3 / 4 / 5.** Highly demonstrable and approachable; scientific validity depends on disciplined wording and a tested queue.

# 2. Brutal critique of “Delta-Sky”

Delta-Sky has a strong product shape: a public discovery feed, a coordinate explorer, and shareable evidence. Its main danger is that the most ambitious part—the change catalog—could look convincing while being scientifically untrustworthy. The static HiPS cube is a useful reference layer, but the proposal treats it like a calibrated model of each native exposure.

## The residual-catalog method is the weakest link

The suggested method predicts each exposure by evaluating the static 102-channel HiPS cube at the pixel’s wavelength, subtracts that prediction from the exposure, and detects residuals. This is a reasonable *prototype hypothesis*, not yet a validated change-detection pipeline.

- **The sampling scales differ.** Native SPHEREx pixels are 6.15″; HiPS pixels are 12.9″, or about **2.1 native pixels across**. Resampling the cube onto the exposure grid does not recover the missing spatial detail. PSF differences, pixel phase, and interpolation can create structured residuals around ordinary sources.
- **The PSFs and reduction products differ.** A valid difference normally needs a controlled treatment of resolution, background, variance, coverage, and masks. Merely sampling a reference image at the exposure’s nominal wavelength does not ensure the reference has the same effective PSF or response.
- **“Wavelength per pixel” needs careful interpretation.** L2’s WCS-WAVE is spatially varying. Using it is more physically appropriate than assigning one band to a whole stamp, but it does not by itself solve calibration differences, spectral interpolation, or how to compare a spectrum that varies across the source.
- **The cube is not an independent no-change model.** As a coadded reference made from survey observations, it may contain the sources and artifacts being sought. If a moving source contributes to the cube at one or more positions, subtraction can leave misleading positive/negative features or suppress the signal. A static cube can be a useful context image; it should not be assumed to be a clean temporal baseline.
- **Coverage is not uniform.** Deep fields can have many exposures, while other regions have sparse or differently sampled observations. A sky heat map of raw residual counts risks mapping coverage and reduction behavior instead of astrophysical change.
- **The pipeline needs null tests.** Before ranking unknown residuals, test known stable sources and known moving or variable targets, measure false-positive rates, and show the relevant flags and uncertainties. Without that, “ranked change catalog” overstates what the data support.

## The product scope is too wide for 42 hours

“Anywhere” lookup, five target classes, six selected sky regions, a crossmatched change catalog, learned similarity search, classification, reporting, and weekly ingestion are several products. The ambitious, unbounded parts are exactly where the work depends on the most assumptions.

At the measured rate, **93 cutouts took 19 seconds**. A simple serialized extrapolation is about **3.4 minutes per 1,000 cutouts** or **5.7 hours per 100,000**. Those numbers ignore query setup, retries, FITS parsing, processing, and review. Eight GPUs do not remove the main bottlenecks: fetching, calibration-aware image comparison, reference construction, candidate vetting, and getting a useful labeled training set. Embeddings are unlikely to be the limiting factor.

“Weekly QR ingestion” also needs a real update contract: new data discovery, schema/version checks, repeatable processing, candidate reconciliation, and failure reporting. A manual, versioned refresh is a credible first release. An automatic weekly pipeline should be a stretch goal.

## Some features raise credibility and expectation risks

- **Known vs. unexplained** is too binary. A missing Gaia, CatWISE, or SIMBAD match does not establish a new or unknown object. Use labels such as “matched,” “no match in queried catalogs,” and “match uncertain,” with provenance.
- **“More like this” embeddings** are premature without a defined task, vetted labels or a carefully justified unsupervised approach, and an evaluation showing that similarity means something useful. They may impress in a pitch and weaken the scientific case in a live review.
- **Classification and export** need limits. A citizen label is triage, not confirmation. MPC ADES or TNS export should be described as an evidence package or draft until the astrometry, required metadata, and validation workflow are established.
- **“Explore anywhere” is a risky promise.** Coverage, number of usable epochs, and wavelength overlap will differ by position. The interface should report what exists before implying every coordinate produces a meaningful time series.

## Likely judge reaction

The idea is relevant and visually demonstrable, and a ranked feed has a clearer discovery purpose than a flipbook. Backyard Worlds and WiseView judges will likely ask how the method handles PSF mismatch, flags, real versus instrumental variation, and comparison to established workflows. SPHEREx team members may probe how the static cube was constructed and whether it can serve as an epoch-independent reference.

If the team says “we subtract the cube and detect anomalies” without validation, the catalog may be judged as a residual-artifact finder. If the team instead shows a small, carefully vetted set of candidates, exposes the measurement conditions, and describes the cube as a browse/reference layer, the concept becomes much stronger.

# 3. Recommendation: a bounded, explainable Change Atlas

I recommend a **Change Atlas** hybrid: the product is an evidence-ranked discovery feed, with an LVF-aware inspector for each candidate. Keep the broad promise—anyone can browse changes across selected regions or inspect a coordinate—but make the initial catalog conservative and bounded.

Use native exposure comparisons where wavelength and observing conditions permit. Use the static HiPS cube for sky context and orientation. Do not make cube-minus-exposure residuals the sole candidate detector until the team has validated their false-positive behavior.

## Product spec

### 1. Discover

- A sky map and ranked candidate feed for selected footprints.
- Filters such as **moving**, **brightness change**, **possible artifact**, and **needs review**.
- A coverage indicator showing where repeat observations and useful wavelength overlap exist.
- A short guided path for newcomers: “Open a candidate → compare observations → inspect flags → share evidence.”

### 2. Candidate inspector

- Two or more exposure stamps with clear timestamps.
- A timeline that distinguishes observation time from wavelength sampling.
- Flux or position measurements with uncertainty where supported.
- Flags shown per exposure, with plain-language explanations for the flags present.
- Nearby catalog matches marked as matches or possible matches, with catalog provenance.
- A direct link to the coordinate explorer and a shareable URL encoding the target and selected observations.

### 3. Explore a coordinate

- Name or RA/Dec lookup, with a message when coverage is sparse.
- Exposure list showing date, wavelength range/sample, and usable flags.
- A blink or timeline view as one inspection tool.
- A wavelength-aware plot that does not imply a same-band light curve where measurements are not comparable.
- Optional Gaia, WISE, or other catalog context when available.

### 4. Triage

- A few structured labels such as “likely motion,” “brightness change,” “flagged artifact,” and “unclear.”
- A candidate evidence download or share link.
- A visible note that classifications are triage, not confirmation.

## Small details that will impress SPHEREx scientists

- Show each exposure’s **actual time and sampled wavelength**; don’t describe the roughly hour-long, 17-pointing sequence as a set of equivalent same-band epochs.
- Keep **6.15″ native pixels** and **12.9″ HiPS pixels** clearly identified. Don’t suggest resampling makes them spatially equivalent.
- Expose flags on the observations used in a comparison; at minimum, make it easy to see SOURCE, PERSIST, GHOST, STREAK, SNOWBALL, and OVERFLOW when present.
- Show variance or an uncertainty cue alongside brightness. Do not let a high-contrast display imply a high-significance detection.
- Make the cube’s role clear: useful context and a static reference image, with its resolution and coadded nature stated.
- Separate “no catalog match found” from “unexplained.”
- Show coverage and missing data as part of the result. An empty plot should explain whether there were no exposures, no comparable wavelengths, or no usable measurements.

## MVP that should ship in 42 hours

1. Choose **two or three bounded fields** with repeat data and include the five named targets wherever usable.
2. Build a small static manifest of exposures and candidate entries. Hand-review the displayed candidates; avoid claiming a complete survey or an all-sky discovery catalog.
3. Implement the candidate inspector with stamps, timestamp, sampled wavelength, uncertainty cue, and flags.
4. Add a minimal map/feed and a coordinate lookup that reports available observations for a position.
5. Make the URLs shareable and provide an evidence download.
6. In the demo, show at least one real signal and one artifact or ambiguous case. Explain how the flags and measurement context affect interpretation.

A successful MVP should have a few convincing cases and a workflow that lets people inspect them. A “live” query can be limited to retrieving the exposure inventory and evidence for a user’s coordinate; don’t imply that it runs a full survey pipeline per request.

## Stretch goals

- Expand the footprint after testing the change ranking on stable and known-variable sources.
- Add controlled same-wavelength light-curve comparisons and simple spectral summaries.
- Add a citizen-review queue and consensus after validating it on known examples.
- Add a manual, versioned weekly QR refresh with a visible data-release label.
- Add “more like this” only after defining and evaluating a useful similarity task.
- Explore cube-based residuals as an additional signal after testing PSF, resolution, coverage, and moving-source contamination effects.

## 30-second demo storyline

“Pick a changing-sky tile. The Atlas surfaces a candidate, and its evidence card shows the observations that triggered it. Open the inspector: the measurements are tagged with their actual times and wavelengths, and one exposure carries a contamination flag. Compare the other exposures, see whether the signal persists, then share the evidence link. This is how anyone can move from a sky change to a reviewable scientific question.”

The strongest story is not “we made a video of the sky.” It is “we help people find and inspect a change, while showing the observing conditions that determine whether it is real.”