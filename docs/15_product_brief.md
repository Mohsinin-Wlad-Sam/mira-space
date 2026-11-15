# MIRA — product brief (v6, 15 Nov 2026)

*NASA Space Apps 2026 · challenge "Planet X and SPHEREx" · working document for reviewers*

## 0. Who it is for, and why it matters

NASA's SPHEREx cost about US$488 million (NASA/JPL press kit) and its images are public, but one image is a 65 MB
scientific file made for specialists' software. MIRA's first job is to make them something anyone can look at; its second, to give
those who want to go deeper real instruments. In order of audience size:

| Who | What they get | Evidence that it matters |
|---|---|---|
| Anyone curious, on a phone | A model of the space around the Sun; each star caught moving has a card in plain words with three real NASA pictures to compare (2MASS about 1999, WISE 2010, SPHEREx today) | The site needs no install, account or server. Not yet measured: the first pilot will count card openings |
| Students and teachers | A real-data lab without a telescope: measure a star's motion and check it against Gaia | ε Indi B: 4.70 against Gaia's 4.68″ per year, on NASA's own images |
| Citizen scientists | 635 confirmed movers with no Gaia source and no SIMBAD entry (36 of them placed on the map, the rest shown without a distance), with pictures and answer buttons (prototype: an answer is recorded by the site's own small endpoint when it runs (no account, nothing about the visitor kept) and the card shows all visitors' tally; without that endpoint it stays on the device) | A precedent, not a result of ours: NASA's Backyard Worlds: Planet 9, where 150,000 volunteers helped find about 3,000 brown dwarfs by spotting moving dots in WISE images (NASA/JPL, 13 Jan 2021) |
| Researchers | The Lab's instruments on raw exposures for any field; a verified catalogue; exports | Blind control run: 92% of known movers found, no false alarm among 5,757 still stars |

The interface follows that order: the **map** is the first screen and shows results as pictures and cards; the
**Lab** and the **Catalogue** table are the deep-analysis pages, one click from every card.

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
| Map (first screen) | What is out there, and what moved? | 3D neighbourhood of the Sun with the confirmed movers marked; a card per object with three real pictures (2MASS ~1999, WISE 2010, SPHEREx read on demand) and its measured path; answer buttons for the unnamed ones |
| Finder (sky chart + verified catalogue) | Where should I point? | target or field |
| Epoch imager | What does this field look like through time? | three NASA pictures of the same field on one time bar: 2MASS (~1999), WISE (2010), one deep SPHEREx image per visit (2025–26); playback control |
| Motion detector | Which sources in this field moved? | table: motion, significance, known/unknown; vectors on the image |
| Astrometer | How fast and how far? | RA/Dec against time with fit, proper motion, parallax → distance |
| Spectrograph | What is it? | 0.75–5 µm spectrum with molecular bands, temperature class |
| Photometer | Did its brightness change? | 1999 / 2010 / 2025–26 brightness history, visit-to-visit ratios |
| Planet X limits | What could still hide here? | detectable planet mass against distance for this field's measured depth |
| Cases | What have I concluded? | saved measurements, notes, FITS/CSV/Python export |
| Assistant (LLM with tool calls) | — | operates the instruments, explains results from the numbers on screen |

## 3. How the motion detector works (new)

1. Deep signal-to-noise stacks of the whole run and of each visit (white light, red 2.4–5 µm, blue 0.75–2.4 µm).
2. Sources detected at 5σ; each located at every visit by a windowed centroid on that visit's stack. A motion claim
   needs at least three dated positions (two always fit a line).
3. Each visit tied to Gaia: median offset of the field's own reference stars (with their Gaia motion and parallax).
4. Position error model measured on the same Gaia stars: floor + confusion term ∝ 1/SNR.
5. Counterparts in AllWISE (2010.5) and 2MASS (dated per source); a counterpart more than 3″ away must also match
   in brightness. Bright sources with no 2010 counterpart are linked to bright 2010 sources with no counterpart today.
6. Straight-line fit through all epochs (15–27 year baseline); significance against the field's Gaia-recovery scatter.
7. Claims only for isolated, unsaturated sources; a star whose motion disagrees with Gaia is flagged as contaminated.

Measured on reference fields (same code as the browser):

| Field | MIRA (″/yr) | Reference (″/yr) |
|---|---|---|
| ε Indi B | +3.986, −2.486 ± 0.019 | Gaia DR3 +3.982, −2.467 |
| Luhman 16 (no Gaia motion; linked to its 2010 and 1999 positions) | −2.759, +0.362 ± 0.019 | literature −2.75, +0.36 |
| Barnard's Star (saturated; wings; confirms Gaia) | −0.797, +10.432 ± 0.047 | Gaia DR3 −0.802, +10.362 |
| WISE 0855−0714 (tracked with its published motion; blended today) | −8.17, +0.75 ± 0.05 | Kirkpatrick et al. 2021 −8.12, +0.67 |
| census candidate 6661-325678 (not in Gaia) | −0.352, −0.016 ± 0.048 (7.3σ) | CatWISE2020 −0.357, +0.022 |
| empty high-latitude field, 40 sources | no detections | — |

Typical recovery of Gaia stars in a field: 0.01–0.02 ″/yr rms.

Control run: 459 fields (240 known Gaia movers of 0.15–2.5″/yr, 219 empty high-latitude fields). Because the
detector uses Gaia (to predict a known star's 2010 and 1999 positions and to reject a motion that contradicts
Gaia), the run was made twice per field: as the Lab runs, and **blind**, with the stars under test removed from the
Gaia list first, as for an object Gaia does not list.

- Known movers measured cleanly (216 of 240): flagged with Gaia known 213 (99%); **blind 199 (92%)**, every one with
  Gaia's motion (median difference 0.011″/yr). Blind recovery by motion: 53 of 61 at 0.15–0.25″/yr, 61 of 64 at
  0.25–0.4, 52 of 53 at 0.4–0.7, 33 of 38 at 0.7–2.5.
- False alarms, blind: of 5,757 stars that Gaia says are still, **none** is flagged (below 0.05% at 95% confidence).
- Not checked one by one: 35 of 8,865 sources without a Gaia motion flagged in these fields (0.4%); in the empty
  fields, 42 of 6,908 sources flagged as varying between visits, 16 sources of 2010 not seen today, 1 brightness
  change, no new source.

## 4. The survey behind it, and what verification showed

Cluster run (4 × 128-core nodes): 39.9 billion WISE/NEOWISE detections (2010–2020) linked into objects, 1.56 million
survey-level claims of change. On 14 Nov 2026 **202,528 of those claims were re-measured on raw SPHEREx exposures**
(position on a tracked deep stack against the predicted and the "never moved" positions; WISE-band fluxes; methane
ratio), ~40 objects per second.

- Motion ≥ 0.3″/yr: 177,221 claims → **17,017 confirmed** (9.6%; 29% of those brighter than 1 mJy), 43% not detected
  at all, 40% only an unrelated source nearby, 4% saturated. With a sample of slower claims: 17,604 confirmed movers.
- Away from the crowded Galactic plane (|b| ≥ 10°): 15,065, of which **13,210 are known Gaia stars with the same
  motion** (88%): an independent check of the method. 907 have no Gaia source at all; 272 of these carry a SIMBAD
  name, and 41 of the unnamed ones are red (W1−W2 > 0.6). SIMBAD spectral types identify 174 recovered L and T dwarfs.
  Within 10° of the plane only 44% of the 2,539 rows match Gaia: several stars share one SPHEREx pixel there and the
  position test loses its meaning, so those rows are hidden by default.
- "Brightened" / "vanished" lists: not real. For ordinary confirmed stars SPHEREx and WISE agree to 5%
  (ratio 0.943 ± 0.04 in W1, 0.944 ± 0.05 in W2), so the tool can see 30% changes; the survey-level lists were driven
  by wrong WISE fluxes. Against AllWISE, 17 of 1,981 clean cases hold: blazars, a Seyfert galaxy, a young star and the
  site of SN 2022gzi.
- Methane list: 44 confirmed dips out of 1,635 measurable (3.3 µm flux below 60% of the 4.0 µm flux and lower by at
  least 3σ; 51 on the ratio alone).
- The 22 candidates, through the field detector and against other catalogues (`web/public/data/verified/candidates.json`,
  Cases page): 19 detected, 9 moved at ≥ 5σ over 16–28 years, 8 of them with the motion CatWISE2020 lists. CatWISE2020
  lists 19 of the 22 (17 with the survey's motion); 2 turn out to have a Gaia DR3 entry; 6 have a SIMBAD entry (two as
  brown-dwarf candidates), none a spectral type. All 9 with a measurable 3.3/4.0 µm ratio are below 0.6
  (methane-like). None of the 19 detected is absent from every catalogue: the open question for each is what it is,
  which needs a spectrum.

The catalogue the app shows is the **verified** one, with the counts above stated as they are.

## 5. Staying current, and user data

- New SPHEREx release → `deploy/update_spherex.sh` rebuilds the exposure index (60 s on one node); every instrument
  then reads the new exposures; saved cases show a "new data" badge.
- Verification is restart-safe and incremental (`web/scripts/verify_census.mts`), so each release re-tests open claims.
- User data stays in the browser (cases, notes), exportable as JSON/CSV/FITS; nothing is uploaded.

## 6. Who pays

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
