## Technical judge

1. **Astrometric calibration is the first credibility gap.** `detectChanges` describes each visit as Gaia-tied, but the inspected detector measures positions on a fixed stamp grid; the shown visit logic does not perform a Gaia-based fit for translation, rotation, or scale. Meanwhile `fitLine` reports formal errors from centroid errors, with no per-visit registration covariance. A 0.01–0.02″/yr recovery claim over a short baseline needs the calibration residuals and shared systematics shown, not just a floor chosen in the error model.

2. **The cross-epoch match can attach the wrong object.** Nearest Gaia within 4.5″, brightness-based WISE/2MASS matching, and greedy loose-source pairing are vulnerable in crowded fields and blends. Pairing detections by speed and marking points “used” can lock in a false track; a straight-line residual test alone does not resolve ambiguity or solar-system curvature. Provide match radii, rejected alternatives, and track likelihoods.

3. **The uncertainty and variability claims are optimistic.** `fitLine` scales errors only when reduced χ² exceeds one; it assumes independent position errors and linear motion. The light curve uses matched-wavelength pairs, but the hand-set `SYS` floors and significance thresholds are not demonstrated on a held-out constant-star sample. Report null false-positive rates by detector, crowding, brightness, and visit count.

4. **Live-demo risks:** NASA range requests and browser CORS/Range behavior, catalog mirrors, and large indexes are external dependencies. Add clear per-stage status, timeout/retry messaging, and a known-good fallback field. The business brief’s 213 MB index and 0.7 GB feeds are a serious first-load and hosting concern; verify what actually ships.

5. **Over-engineered for judging:** the 40-billion-detection census, 3D universe, and broad assistant pitch distract from the core blink-and-identify tool. Before submission, test astrometry against injected movers and stationary controls, crowded/blended fields, RA wrap/high declination, saturated sources, missing visits, and API failure. Show results of those tests; do not present the claimed precision without them.

## Space science judge

1. **“Is there an undiscovered world moving near the Sun?” is compelling but too broad for this instrument.** SPHEREx is an all-sky infrared spectral survey with 102 bands; it is not a dedicated moving-object survey. **VERIFIED:** NASA/JPL describes its 102-band all-sky mission ([JPL mission page](https://www.jpl.nasa.gov/missions/spherex/)). Lead with “inspect SPHEREx epochs for infrared movers and test candidates against archival catalogs”; keep Planet X as motivation, not implied search completeness.

2. **Defensible:** the product can help visualize motion, compare epochs, and inspect spectral/photometric behavior of selected sources. **UNSURE:** the brief’s 6″ pixels, cadence, depth, and specific candidate-confirmation methodology are repository claims that need a traceable instrument/data citation and reproducible validation. “Cold means methane at 4–5 µm” is too simplistic: methane features and colors depend on atmosphere, temperature, and bandpass; a dip in low-resolution photometry is not a spectral classification.

3. **The headline counts need denominators and labels.** “17,017 of 177,221 motion claims confirmed” means about 9.6% confirmed under this test; it does not establish the remainder are false, nor that the confirmed set is complete. State the 43% not detected, 40% unrelated-neighbor, 4% saturated outcomes alongside it. The 22 are **candidates**, with only six confirmed at the predicted location under the stated test; “unknown” is not “new world.” **VERIFIED:** infrared searches for Planet Nine have used WISE/NEOWISE data and model-dependent detectability ([Meisner et al.](https://arxiv.org/abs/1712.04950)).

4. **Missing researcher plot:** per-epoch sky-plane astrometry with error bars and residuals, overlaid with Gaia-propagated stationary position and the candidate’s predicted track; add a spectrum/photometry plot with actual wavelength coverage and uncertainties. In 20 hours: independently inspect all six confirmed candidates, publish their cutouts and catalog crossmatches, run stationary Gaia controls and known movers through the identical pipeline, and report per-field completeness/false positives. Avoid claiming Planet Nine limits until sensitivity is calibrated against explicit models.

## Business judge

1. **There is a user, but the buyer is not yet demonstrated.** Researchers and citizen scientists may use a free archive browser; institutions pay only if it saves staff time or supports a deliverable. The brief names grants and bespoke services but has no interview evidence, procurement path, or maintenance owner.

2. **Positioning sentence:** “MIRA turns public SPHEREx exposures into a shareable, measured time sequence for vetting infrared sources against archival catalogs.”

3. **Credible paid use cases:** (a) custom deployment and support for an observatory/archive’s own multi-epoch imagery; (b) batch candidate vetting and reprocessing for a survey team; (c) curated kiosk/workshop package for a planetarium or university. These are plausible service offerings, not validated demand. **UNSURE:** the brief’s claims about comparable tools’ prices and grant sizes are unverified here; do not imply market validation from a free NASA archive or open-source analogies.

4. **Naive pitch elements:** “near-zero marginal cost” omits maintenance, bandwidth, monitoring, and support; “no server” does not mean no operational burden. “Works for Euclid, Rubin, Roman, NEO Surveyor” is an unproven portability claim across distinct formats, access policies, and data models. A 0.5 FTE maintainer plus broad international grant plan is not a business model until a lead institution and funding eligibility are secured.

## Ranked changes for the next 20 hours

1. Reframe the headline around SPHEREx epoch inspection; make Planet X motivation, not a discovery promise.
2. Put the 17,017/177,221 outcomes and all failure categories in one prominent, plain-language panel.
3. Add candidate-level astrometry plots with residuals, errors, Gaia reference, and predicted track.
4. Independently inspect and document the six confirmed candidates; expose coordinates and reproducible cutouts.
5. Run known movers and stationary Gaia controls through the same end-to-end pipeline; report the results.
6. Quantify false positives and recovery versus brightness, crowding, visits, and motion using held-out controls.
7. Exercise the live app against archive/API failure and add a polished fallback field with clear status messages.
8. Remove unsupported market, portability, and precision claims from the pitch; state one buyer and one measurable value proposition.
