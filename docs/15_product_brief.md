# MIRA — product brief (v5, 15 Nov 2026)

*NASA Space Apps 2026 · challenge "Planet X and SPHEREx" · working document for reviewers*

## 1. One question

**Is there an undiscovered world moving near the Sun — and how would we know?**

"Planet X" stands for any unknown body that betrays itself only by moving against the background stars: a distant
planet, a free-floating planet, a cold brown dwarf a few light-years away (WISE 0855, 250 K, 7 light-years, was only
found in 2014). Such objects are faint, visible only in the infrared, and lost among billions of ordinary sources.
Three things separate them from the crowd: **they move, they are cold (methane, 4–5 µm light), and they are not in
any catalogue**. MIRA is the set of instruments that tests exactly those three things on NASA's SPHEREx data.

Why it is not a simple problem: SPHEREx never photographs a place twice at the same wavelength (each exposure sees a
different colour at each position), its pixels are 6.15″, and its epochs are only 6 months apart. Blinking raw frames
shows colour flicker, not motion. Finding a mover needs registration, per-visit deep stacks, a reference frame
(Gaia), and older epochs (WISE 2010, 2MASS 1999).

## 2. What MIRA is

A **digital research observatory**: a browser workspace (the Lab) with instruments that read NASA's public SPHEREx
Level-2 exposures directly from the archive (HTTP range requests, no server), plus a survey catalogue computed once
on an HPC cluster. Every instrument serves the chain *find → measure → identify → decide*:

| Instrument | Question it answers | Output |
|---|---|---|
| Finder (sky chart + verified catalogue) | Where should I point? | target or field |
| Epoch imager | What does this field look like through time? | deep image per visit, continuous time slider 1999 → 2010 → 2025–26, playback control |
| Motion detector | Which sources in this field moved? | table: motion, significance, known/unknown; vectors on the image |
| Astrometer | How fast and how far? | RA/Dec against time with fit, proper motion, parallax → distance |
| Spectrograph | What is it? | 0.75–5 µm spectrum with molecular bands, temperature class |
| Photometer | Did its brightness change? | 1999 / 2010 / 2025–26 brightness history, visit-to-visit ratios |
| Planet X limits | What could still hide here? | detectable planet mass against distance for this field's measured depth |
| Cases | What have I concluded? | saved measurements, notes, FITS/CSV/Python export |
| Assistant (LLM with tool calls) | — | operates the instruments, explains results from the numbers on screen |

## 3. How the motion detector works (new)

1. Deep signal-to-noise stacks of the whole run and of each visit (white light, red 2.4–5 µm, blue 0.75–2.4 µm).
2. Sources detected at 5σ; each located at every visit by a windowed centroid on that visit's stack.
3. Each visit tied to Gaia: median offset of the field's own reference stars (with their Gaia motion and parallax).
4. Position error model measured on the same Gaia stars: floor + confusion term ∝ 1/SNR.
5. Counterparts in AllWISE (2010.5) and 2MASS (dated per source); a counterpart more than 3″ away must also match
   in brightness. Bright sources with no 2010 counterpart are linked to bright 2010 sources with no counterpart today.
6. Straight-line fit through all epochs (15–27 year baseline); significance against the field's Gaia-recovery scatter.
7. Claims only for isolated, unsaturated sources; a star whose motion disagrees with Gaia is flagged as contaminated.

Measured on reference fields (same code as the browser):

| Field | MIRA (″/yr) | Reference (″/yr) |
|---|---|---|
| ε Indi B | +3.991, −2.496 ± 0.015 | Gaia DR3 +3.982, −2.467 |
| Luhman 16 (no Gaia motion; linked to its 2010 and 1999 positions) | −2.758, +0.364 ± 0.013 | literature −2.75, +0.36 |
| Barnard's Star (saturated; wings) | −0.809, +10.432 ± 0.034 | Gaia DR3 −0.802, +10.362 |
| census candidate 6661-325678 (not in Gaia) | −0.335, −0.006 ± 0.041 (8σ) | CatWISE2020 −0.357, +0.022 |
| empty high-latitude field, 40 sources | no detections | — |

Typical recovery of Gaia stars in a field: 0.01–0.02 ″/yr rms.

## 4. The survey behind it, and what verification showed

Cluster run (4 × 128-core nodes): 39.9 billion WISE/NEOWISE detections (2010–2020) linked into objects, 1.56 million
survey-level claims of change. On 14 Nov 2026 **202,548 of those claims were re-measured on raw SPHEREx exposures**
(position on a tracked deep stack against the predicted and the "never moved" positions; WISE-band fluxes; methane
ratio), ~40 objects per second.

- Motion ≥ 0.3″/yr: 177,221 claims → **17,017 confirmed** (9.6%; 29% of those brighter than 1 mJy), 43% not detected
  at all, 40% only an unrelated source nearby, 4% saturated. With a sample of slower claims: 17,604 confirmed movers.
- Of those, **14,323 are known Gaia stars with the same motion** (81%): an independent check of the method. 1,348
  have no Gaia source at all; 308 of these carry a SIMBAD name, and 42 of the unnamed ones are red (W1−W2 > 0.6).
  SIMBAD spectral types identify 174 recovered L and T dwarfs.
- "Brightened" / "vanished" lists: not real. For ordinary confirmed stars SPHEREx and WISE agree to 5%
  (ratio 0.943 ± 0.04 in W1, 0.944 ± 0.05 in W2), so the tool can see 30% changes; the survey-level lists were driven
  by wrong WISE fluxes. Against AllWISE, 19 of 1,989 clean cases hold: blazars, a Seyfert galaxy, a young star and the
  site of SN 2022gzi.
- Methane list: 51 confirmed dips out of 1,635 measurable.
- The 22 candidates, through the field detector and against other catalogues: see `web/public/data/verified/candidates.json`
  and the Cases page. CatWISE2020 already lists most of them as moving sources; none has a spectral type in SIMBAD.

The catalogue the app shows is the **verified** one, with the counts above stated as they are.

## 5. Staying current, and user data

- New SPHEREx release → `deploy/update_spherex.sh` rebuilds the exposure index (60 s on one node); every instrument
  then reads the new exposures; saved cases show a "new data" badge.
- Verification is restart-safe and incremental (`web/scripts/verify_census.mts`), so each release re-tests open claims.
- User data stays in the browser (cases, notes), exportable as JSON/CSV/FITS; nothing is uploaded.

## 6. Who it is for, and money

Free public tool (NASA data, near-zero marginal cost: the browser reads NASA's bucket). Institutions pay for what
they already buy elsewhere at a price: measurements on their own terms. Grants first (open-science programmes with a
partner as lead); then verification as a service for survey and citizen-science teams (hand over a candidate list,
get each one re-measured on raw exposures); the engine adapted to other cloud-hosted archives; a teaching Lab for
universities and planetariums. Demand for the paid offers is a hypothesis to test with free pilots
(`docs/13_business_plan.md`).

## 7. Known limits

- A faint mover blended with a star inside one 6″ pixel is not separated blind (WISE 0855 today sits 8″ from a
  G = 16 star); it is measured when tracked with a known motion.
- SPHEREx-only motion needs ≳ 2.5″/yr (1-year baseline, 0.3″ per visit); slower motions need the 2010/1999 epochs.
- Planet Nine itself is below SPHEREx's single-exposure depth for most published models; the "limits" instrument
  says what is and is not excluded, it does not claim a detection.
