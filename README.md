<p align="center"><img src="web/public/brand/mira-emblem.png" width="160" alt="Mira logo"></p>

# Mira — watch the sky move

**NASA Space Apps Challenge 2026 · "Planet X and SPHEREx"** · team *assrar-dawla*

Type a position on the sky. Mira finds every NASA SPHEREx exposure that covers it, reads the pixels straight from
NASA's public archive, lines them up on the sky and plays them as a movie — then measures the spectrum, the light
curve and the motion of anything you click. No server, no sign-up: it all happens in the browser.

Behind the tool is a 16-year census: 43 billion WISE/NEOWISE detections (2010–2020) linked into moving objects and
measured again in SPHEREx's 102-colour all-sky map, browsable as an atlas and in 3D.

*Mira was called **SKYLENS** during development; older docs, HPC paths (`~/skylens`) and some identifiers keep that name.*

## What it does

| Part | What a visitor gets | Built from |
|---|---|---|
| **Blink** (`/explore/`) | A sky-registered movie of every SPHEREx pass over any RA/Dec or name. Modes: movie, spectral sweep (frames in wavelength order), deep stack (shift-and-add when following a mover), colour (six detectors → RGB), difference. Gaia DR3 and AllWISE overlays at each frame's date. NASA's quality flags on every frame. Field of view 3.3′–13′. Link, embed, PNG / WebM / CSV export. | SPHEREx Level-2 exposures read by HTTP Range from `s3://nasa-irsa-spherex`; exposure index built from IRSA's inventory |
| **On-the-fly measurements** | Spectrum of the target or any clicked source (PSF-weighted photometry at the wavelength each exposure saw, with 2MASS / WISE anchors and automatic methane detection); light curve from wavelength-matched pairs of exposures; proper motion and parallax fitted to centroids; halo photometry for saturated stars | the same exposures |
| **Sky atlas** (`/explore/#atlas`) | The whole infrared sky, WISE 2010 against SPHEREx 2025, in eight wavelengths; census layers (motion, methane, vanished, brightened, unusual, new candidates); live Solar System | IRSA HiPS + census feeds |
| **3D space** (`#space`) | Fly from the planets (JPL Horizons) through 400,000 census objects at their Gaia or AI distances out to the cosmic microwave background | census + NASA/ESA catalogues |
| **Lab** (`#lab`) | Ten experiments that start from a question: *Could SPHEREx see Planet X?*, *How far is that star? Measure it* (live parallax fit with bootstrap), a candidate-vetting queue, a batch tool for target lists, and six on the census | engine + census |
| **Method** (`#about`) | How it works, the challenge point by point, validation, limits | — |

## Validation (five challenge targets, through the same code the browser runs)

From `web/scripts/validate_blink.mts`, run of 14 Nov 2026 (index through 5 Oct 2026):

| Target | Measured by Mira from SPHEREx alone | Reference |
|---|---|---|
| Barnard's Star | saturated in 121 of 121 exposures (OVERFLOW flag shown); motion from the image wings −2.7 ± 0.4, +10.2 ± 0.4 ″/yr (indicative); halo brightness steady to 8% | −0.80, +10.36 ″/yr (Gaia DR3) |
| ε Indi B | motion +4.10 ± 0.17, −2.58 ± 0.17 ″/yr; parallax 0.36 ± 0.12″; 82% fainter at 3.3 µm than at 4.0 µm (methane); steady | +3.98, −2.47 ″/yr; 0.271″ |
| WISE 0855−0714 | seen only at 3.8–5 µm: 0.57 mJy at 4.6 µm; motion −8.4 ± 0.8, +2.7 ± 0.8 ″/yr from 7 exposures; its 2010 coordinates are recognised and followed | 0.57 mJy (WISE W2); −8.12, +0.67 ″/yr |
| RW Aurigae | saturated; halo photometry: 1.9× brighter at 3.8–4.4 µm in Sep 2025 than in Sep 2026 | T Tauri star with dimming events |
| R Draconis | saturated; halo photometry: 10× brighter at 0.75–1.1 µm in Sep 2026 than in Sep 2025, 1.2× at 2.4–3.9 µm | Mira variable, 246 d |

Engine checks against Astropy on the same NASA file: pixel positions to 0.004 px, resampled values to 0.005%, decoded
flag masks bit for bit.

## How Blink works

1. **Index** — `census/sphx_index2.py` turns IRSA's inventory of 1.6 M exposures into one small JSON per HEALPix
   nside-32 patch: up to 24 exposures per detector, whole-patch coverage first, spread over the visits.
2. **Read** — per exposure, one Range request for the FITS header and one for the detector rows the field needs (~0.4 MB of a 65 MB file).
3. **Register** — TAN-SIP astrometry (SIP inverted by iteration), bilinear resampling onto a north-up grid.
4. **Wavelength** — the linear-variable-filter map gives the wavelength at every pixel of each detector.
5. **Flags** — the FLAGS extension is a Rice-compressed table, one row per tile: only the rows needed are decoded
   (`web/src/blink/rice.ts`); defects that are not sky are blanked, saturation is reported.
6. **Measure** — `web/src/blink/measure.ts`: photometry, wavelength-matched light curves, motion + parallax.

## Run it

```bash
cd web
npm install
npm run dev        # http://localhost:5173/  (landing)  and  /explore/  (app)
npm run build      # typecheck + production build -> web/dist/
npx tsx scripts/validate_blink.mts     # the validation table above (needs the dev server and network)
```

Links: `/explore/?ra=<deg>&dec=<deg>&fov=<arcmin>` or `/explore/?target=<name>` open Blink on a position (add
`&embed=1` inside an `<iframe>`); `#atlas`, `#tour`, `#space`, `#lab`, `#about` open the other sections.

The census feeds and the exposure index live in `web/public/data/` (not in git; `web/sync_data.sh` pulls them from
the cluster). Deployment on a small instance, and how to re-index after each SPHEREx release, are in
[`docs/14_deployment_and_updates.md`](docs/14_deployment_and_updates.md).

## Repo map

| Path | Contents |
|---|---|
| `web/src/blink/` | the Blink engine, measurements, catalogues, plots and view |
| `web/src/main.ts`, `sky.ts`, `space.ts`, `labapp.ts`, `labpro.ts`, … | app shell, atlas, 3D view, Lab |
| `web/src/landing/` | landing page (React); all copy in `content.ts` |
| `census/` | census pipeline (linker, SPHEREx forced photometry, AI, exporters) and the exposure index builders |
| `deploy/` | Caddy / nginx / Docker configs and `update_spherex.sh` |
| `docs/13_business_plan.md` | how Mira stays free and alive |
| `docs/10_submission_draft.md` | submission text, slide outline |
| `docs/07_si_usage_log.md` | statement of AI tool use |
| `docs/01–12`, `docs/peer-review/` | research phase, design notes, reviews |

## Data and acknowledgements

NASA SPHEREx Level-2 spectral images and all-sky maps (NASA/IPAC Infrared Science Archive; a joint project of JPL
and Caltech funded by NASA). unWISE time-domain catalogue (Meisner et al. 2023). NASA WISE / NEOWISE and AllWISE.
ESA Gaia DR3. 2MASS. SIMBAD, VizieR and Aladin Lite (CDS, Strasbourg). JPL Horizons and SBDB; NASA DONKI, EPIC, SDO;
NASA Exoplanet Archive; NED; Planck. UltracoolSheet (Best et al.). Photos on the landing page: Unsplash (credits in the footer).

Mira is a hackathon project and is not affiliated with or endorsed by NASA.
