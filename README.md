<p align="center"><img src="web/public/brand/mira-emblem.png" width="160" alt="Mira logo"></p>

# MIRA — a research observatory in the browser

**NASA Space Apps Challenge 2026 · "Planet X and SPHEREx"** · team *assrar-dawla*

Give MIRA a position on the sky. Its instruments read every NASA SPHEREx exposure of that field straight from the
public archive and measure it: **which sources moved** since 1999 and 2010 and how fast; for the nearest ones, a
parallax; a 0.75–5 µm spectrum with its molecular bands; whether they brightened or faded; and what could still
hide there. No server, no sign-up,
no telescope time.

The motivating problem is Planet X: an unknown cold body near the Sun shows itself only by moving against the
stars. The same instruments serve any star, brown dwarf or variable source.

*MIRA was called **SKYLENS** during development; older docs, HPC paths (`~/skylens`) and some identifiers keep that name.*

## What it is

| Section | What you do there | Built from |
|---|---|---|
| **Lab** (`/explore/`) | The working environment. One field, six instruments: **Evolution** (one time bar you steer through three NASA pictures of the same field: 2MASS ~1999, WISE 2010, then one deep SPHEREx image per visit, so a mover walks across the frame), **Motion detector** (every source: moved / brighter / fainter / new / steady, with significance and its Gaia identity), **Astrometer** (position against time, proper motion, parallax), **Spectrograph** (0.75–5 µm spectrum, molecular bands, methane), **Photometer** (brightness against 1999 and 2010, and visit to visit), **Detection limits** (which planet or brown dwarf the field's depth would reveal). Plus every exposure with NASA's flags, and exports (CSV, FITS cube, Python, link, embed). | SPHEREx Level-2 exposures read by HTTP Range from `s3://nasa-irsa-spherex`; Gaia DR3, AllWISE, 2MASS from CDS mirrors |
| **Catalogue** (`#catalogue`) | The survey, verified: filter and sort the confirmed movers, see them on a reduced proper-motion diagram and an all-sky chart, read the evidence for each, open it in the Lab | 39.9 billion WISE detections linked on a cluster, each claim re-measured on raw SPHEREx exposures |
| **Cases** (`#cases`) | Your saved measurements, notes, target lists, exports; the survey's candidates with their verification | browser storage only |
| **Universe** (`#universe`) | Where these objects are: the Sun's neighbourhood in 3D, out to the oldest light | Gaia, Hipparcos, census, NASA/ESA catalogues |
| **Assistant** | Reads the page, explains it, and operates the instruments ("open Luhman 16 and tell me how fast it moves") | K2 Horizon through a small server-side proxy |
| **Method** (`#about`) | How a field is measured, the tests, the verification funnel, the limits | — |

## How well it works

Field detector, same code as the Lab (`web/scripts/test_detect.mts`):

| Field | MIRA: SPHEREx + AllWISE 2010 + 2MASS ~1999 (″/yr) | Reference (″/yr) |
|---|---|---|
| ε Indi B | +3.986, −2.486 ± 0.019 | +3.982, −2.467 (Gaia DR3) |
| Luhman 16 (no Gaia motion; linked to its 2010 and 1999 positions) | −2.759, +0.362 ± 0.019 | −2.75, +0.36 (literature) |
| Barnard's Star (saturated: measured on the wings of its image; confirms Gaia) | −0.797, +10.432 ± 0.047 | −0.802, +10.362 (Gaia DR3) |
| WISE 0855−0714 (tracked with its published motion; today it shares a pixel with a star) | −8.17, +0.75 ± 0.05 | −8.12, +0.67 (Kirkpatrick et al. 2021) |
| Survey candidate 6661-325678 (not in Gaia) | −0.352, −0.016 ± 0.048 (7.3σ) | −0.357, +0.022 (CatWISE2020) |
| Empty high-latitude field, 40 sources | nothing flagged | — |

Control run (`web/scripts/validate_detector.mts` on the cluster, summarised by `census/validate_summary.py`): 459
fields, 240 centred on known Gaia movers (0.15–2.5″/yr) and 219 empty ones. The detector normally uses Gaia (to
predict where a known star was in 2010 and 1999, and to reject a motion that contradicts Gaia), so the test that
counts is the **blind** one: the stars under test are removed from the Gaia list before the detector runs, as for
an object Gaia does not list.

| | Gaia known | Blind |
|---|---|---|
| Known movers measured cleanly (216 of 240; the others are blended, saturated or at the edge and are not judged) flagged "moved" | 213 (99%) | **199 (92%)** |
| … with Gaia's motion (within 3σ or 0.03″/yr); median difference | 213; 0.010″/yr | 199; 0.011″/yr |
| … blind, by motion: 0.15–0.25 · 0.25–0.4 · 0.4–0.7 · 0.7–2.5″/yr | | 53 of 61 · 61 of 64 · 52 of 53 · 33 of 38 |
| Stars Gaia says are still (< 0.04″/yr) flagged "moved": false alarms | (0 of 5,964: by construction) | **0 of 5,757** (below 0.05% at 95% confidence) |

In the same fields 35 of 8,865 sources without a Gaia motion are flagged "moved" (0.4%; real or false, not checked
one by one). In the 219 empty fields (6,908 sources): 1 brightness change, no new source, 42 flagged as varying
between visits (0.6%) and 16 sources of 2010 not seen today, none checked one by one. Per-field results:
`web/public/data/verified/detector_validation_fields.jsonl`.

SPHEREx exposures alone, 1.5-year baseline (`web/scripts/validate_blink.mts`, run of 14 Nov 2026):

| Target | Measured from SPHEREx alone | Reference |
|---|---|---|
| ε Indi B | motion +4.11 ± 0.17, −2.57 ± 0.17 ″/yr; parallax 0.36 ± 0.12″ (indicative); 82% fainter at 3.3 µm than at 4.0 µm (methane) | +3.98, −2.47 ″/yr; 0.271″ |
| WISE 0855−0714 | seen only at 3.8–5 µm: 0.57 mJy at 4.6 µm; motion −8.4 ± 0.8, +2.7 ± 0.8 ″/yr from 7 exposures; its 2010 coordinates are recognised and followed | 0.57 mJy (WISE W2); −8.12, +0.67 ″/yr |
| Barnard's Star | saturated in 121 of 121 exposures; motion from the image wings −2.5 ± 0.4, +10.2 ± 0.4 ″/yr (indicative) | −0.80, +10.36 ″/yr |
| RW Aurigae | saturated; halo photometry: 1.9× brighter at 3.8–4.4 µm in Sep 2025 than in Sep 2026 | T Tauri star with dimming events |
| R Draconis | saturated; halo photometry: 10× brighter at 0.75–1.1 µm in Sep 2026 than in Sep 2025 | Mira variable, 246 d |

The two tables differ on purpose: the first uses the 2010 and 1999 catalogue positions (15–27 years), the second
only SPHEREx's own 1.5 years. Engine checks against Astropy on the same NASA file: pixel positions to 0.004 px,
resampled values to 0.005%, decoded flag masks bit for bit.

## The survey and its verification

| Step | Objects |
|---|---|
| WISE / NEOWISE detections linked into objects (2010–2020) | 39.9 billion |
| Survey-level claims of motion or change | 1,564,553 |
| Re-measured on raw SPHEREx exposures (14 Nov 2026, ~50 min on three cluster nodes) | 202,528 |
| Motion above 0.3″/yr: confirmed / tested | 17,017 / 177,221 (9.6%; 29% of those brighter than 1 mJy) |
| … not detected at all · only an unrelated source nearby | 43% · 40% |
| Confirmed movers (including a sample of slower ones) | 17,604 |
| … away from the crowded Galactic plane (\|b\| ≥ 10°) | 15,065 |
| … of those, known Gaia stars with the same motion | 13,210 (88%: an independent check of the method) |
| … of those, no Gaia source at all · of which unnamed in SIMBAD and red (W1−W2 > 0.6) | 907 · 41 |
| … within 10° of the plane (2,539 rows) that match Gaia | 44%: crowding defeats the test there, so these rows are hidden by default |
| Known L and T dwarfs recovered (SIMBAD spectral types) | 174 |
| The 22 survey candidates, through the Lab's detector | 19 detected · 9 moved at ≥ 5σ over 16–28 years, 8 of them with the motion CatWISE2020 lists · CatWISE2020 lists 19 of the 22, 17 with the survey's motion · 2 have a Gaia DR3 entry after all · 6 have a SIMBAD entry, none a spectral type · all 9 with a measurable 3.3/4.0 µm ratio are below 0.6 |
| Methane dips confirmed (3.3 µm flux below 60% of the 4.0 µm flux, and lower by at least 3σ) | 44 of 1,635 measurable |
| Brightness changes that hold against AllWISE | 17 of 1,981 clean cases: blazars, a Seyfert galaxy, a young star, the site of SN 2022gzi |

The survey-level "brightened", "vanished" and "methane" lists (hundreds of thousands of objects) did not survive
this test and are not shown. Catalogue rows are confirmed motions, not discoveries.

## How a field is measured

1. **Index** — `census/sphx_index2.py` turns IRSA's inventory of 1.6 M exposures into one small JSON per HEALPix
   nside-32 patch.
2. **Read** — per exposure: the FITS header, the detector rows the field needs and the matching rows of NASA's
   Rice-compressed flag table (`web/src/blink/engine.ts`, `rice.ts`), under 1 MB of a 65 MB file.
3. **Register** — TAN-SIP astrometry, bilinear resampling onto a north-up grid; the wavelength of every pixel from
   the filter map of its detector.
4. **Detect** — `web/src/blink/detect.ts`: deep signal-to-noise stacks per visit; sources located at every visit;
   each visit tied to Gaia with the field's own stars; counterparts in AllWISE and 2MASS; straight-line fit;
   verdicts against the scatter with which Gaia stars are recovered in that field.
5. **Measure one source** — `measure.ts`: PSF-weighted photometry at each exposure's wavelength, visit-to-visit
   brightness from wavelength-matched pairs, per-exposure astrometry with parallax.

## Run it

```bash
cd web
npm install
npm run dev        # http://localhost:5173/  (landing)  and  /explore/  (the observatory)
npm run build      # typecheck + production build -> web/dist/
npx tsx scripts/test_detect.mts        # the field detector on reference fields (needs the dev server and network)
npx tsx scripts/validate_blink.mts     # the five challenge targets through the engine
```

Links: `/explore/?ra=<deg>&dec=<deg>&fov=<arcmin>` or `/explore/?target=<name>` open the Lab on a field (add
`&embed=1` inside an `<iframe>`); `#catalogue`, `#cases`, `#universe`, `#about` open the other sections.

The assistant needs a model key on the server side: in development put `MIRA_LLM_KEY=…` in `web/.env.local`
(ignored by git); in production run `deploy/assistant-proxy.mjs`. Without a key the rest of the site works unchanged.

**Reproducing the numbers.** Inputs: the survey tiles (`census/` pipeline, on the cluster), the exposure index
(`census/sphx_index2.py`), Gaia DR3 sources with proper motion above 100 mas/yr (ESA archive), AllWISE / 2MASS /
Gaia cone searches (VizieR) and SIMBAD. Steps and selection rules: `census/verify_select.py` → `verify_lists.py` →
`web/scripts/verify_census.mts` → `census/verify_merge.py` (the rule for “moved” is in its header and in
`meta.json`), `web/scripts/candidates_report.mts`, `web/scripts/validate_detector.mts`. Outputs:
`web/public/data/verified/*.json`.

The exposure index and the verified catalogue live in `web/public/data/` (not in git; `web/sync_data.sh` pulls them
from the cluster). Deployment on a small instance, and how to re-index and re-verify after each SPHEREx release, are
in [`docs/14_deployment_and_updates.md`](docs/14_deployment_and_updates.md).

## Repo map

| Path | Contents |
|---|---|
| `web/src/blink/` | the engine (`engine.ts`, `rice.ts`), the field detector (`detect.ts`), measurements, catalogues, plots, detection limits and the Lab view (`view.ts`) |
| `web/src/catalogue.ts`, `logbook.ts`, `assistant.ts`, `space.ts`, `main.ts` | Catalogue, Cases, assistant panel, 3D view, shell |
| `web/server/assistant.mjs`, `deploy/assistant-proxy.mjs` | the assistant's server side (dev and production) |
| `web/scripts/` | `verify_census.mts` (raw-exposure re-measurement), `candidates_report.mts`, `validate_detector.mts`, `test_detect.mts`, `validate_blink.mts` |
| `web/src/landing/` | landing page (React); all copy in `content.ts` |
| `census/` | survey pipeline (linker, SPHEREx photometry, exporters), `verify_select.py`, `verify_lists.py`, `verify_merge.py` |
| `deploy/` | Caddy / nginx / Docker configs, `update_spherex.sh`, the assistant proxy |
| `docs/15_product_brief.md` | the concept in two pages |
| `docs/13_business_plan.md` | who pays, for what, and why it stays free |
| `docs/10_submission_draft.md` | submission text, slide outline |
| `docs/07_si_usage_log.md` | statement of AI tool use |
| `docs/peer-review/` | reviews by external models, including the judges' critiques of this version |

## Data and acknowledgements

NASA SPHEREx Level-2 spectral images (NASA/IPAC Infrared Science Archive; a joint project of JPL and Caltech funded
by NASA). unWISE time-domain catalogue (Meisner et al. 2023). NASA WISE / NEOWISE, AllWISE and CatWISE2020. ESA Gaia
DR3 and Hipparcos. 2MASS. SIMBAD and VizieR (CDS, Strasbourg). JPL Horizons and SBDB; NASA Exoplanet Archive; NED;
Planck. UltracoolSheet (Best et al.). Photos on the landing page: Unsplash (credits in the footer).

MIRA is a hackathon project and is not affiliated with or endorsed by NASA.
