<p align="center"><img src="web/public/brand/mira-emblem.png" width="160" alt="Mira logo"></p>

# Mira — the infrared sky has moved

**NASA Space Apps Challenge 2026 · "Planet X and SPHEREx"** · team *assrar-dawla*

Mira is a public, map-first web app built on a **16-year infrared sky census**: we linked 43 billion WISE/NEOWISE detections (2010–2020) into moving objects and measured every one again in NASA SPHEREx's 102-colour all-sky map (2025–26). Anyone can blink the sky between 2010 and 2025, light up what moved, what vanished, what is made of methane, or what the AI cannot explain — and open the evidence behind every object: every individual SPHEREx exposure, its spectrum, its 16-year light curve and its spectral twins.

*Mira was called **SKYLENS** during development; older docs, HPC paths (`~/skylens`) and some code identifiers still use that name.*

## What a visitor can do
| Feature | What it shows | Built from |
|---|---|---|
| **Blink 2010 ⇄ 2025** | the whole sky flips between WISE and SPHEREx; nearby stars jump | AllWISE W2 HiPS vs SPHEREx DR1 cube (both IRSA) |
| **Time machine** | slide or play 2010 → 2025: markers move along their measured motions while the imagery crossfades | census motions + both HiPS surveys |
| **Lenses** (Motion · Methane · Vanished · Brightened · Unusual) | glowing candidates anywhere on the sky | census feeds (static JSON) |
| **Guided tour** | Barnard's Star, WISE 0855, ε Indi B, RW Aur, a vanished source | census objects |
| **Wavelength bar** | scrub SPHEREx's 102 colours (0.75–5 µm) | SPHEREx HiPS cube slices |
| **Honest flipbook** | every SPHEREx exposure of an object, date + per-pixel wavelength, per-visit coadds, *de-flashed* mode | precomputed byte-range cutouts of L2 images |
| **102-colour spectrum** | molecular bands annotated | census forced photometry |
| **16-year light curve** | WISE epochs along the moving track + SPHEREx point | unWISE time-domain catalog + census |
| **Spectral twins** | 12 nearest AI fingerprints anywhere on the sky | GPU autoencoder over 10.4 M spectra |
| **3D neighbourhood** | the nearest stars (< 20 pc) in 3D, moving in real time; any object can be placed among them | Gaia DR3 astrometry |
| **View settings** | base survey (SPHEREx, AllWISE, 2MASS, DSS2), colour map, stretch, projection, grid | IRSA HiPS |

## Key results (validated)
- The blind motion census recovers the Sun's nearest fast movers, each **independently confirmed by SPHEREx at its predicted 2025 position**: Barnard's Star 10.24″/yr (lit. 10.36), WISE 0855−0714 8.25″/yr (8.15), Lacaille 9352 6.90″/yr, GJ 1 5.75″/yr, ε Indi A 4.72″/yr, ε Indi B 4.71″/yr.
- WISE 0855: WISE W2 449 µJy (2010–2020) vs SPHEREx 462 ± 31 µJy (2025) — constant over 16 years across two missions.
- RW Aurigae: W2 varied ×3.6 across the WISE era (dust dimming).
- Spectral twins of ε Indi B are methane-bearing brown dwarfs (8 of 10), learned without labels.

## Website
Two pages, built together by Vite:

| URL | Page | Source |
|---|---|---|
| `/` | Landing page (React): the story, live census numbers, links into the viewer | `web/index.html`, `web/src/landing/` |
| `/explore/` | Sky viewer (TypeScript + Aladin Lite, uPlot, three.js): everything in the table above | `web/explore/index.html`, `web/src/main.ts` and siblings |

They are separate pages on purpose: the landing's smooth scrolling and styles never touch the viewer's map. Both share one design (tokens in `web/src/landing/styles/tokens.css`, mirrored at the top of `web/src/style.css`).

```bash
cd web
npm install
npm run dev        # http://localhost:5173/ and /explore/
npm run build      # typecheck + production build -> web/dist/
npm run preview    # serve the build
npm run lint       # oxlint
```

- **Editing the landing page:** all copy, links and photos (Unsplash) live in `web/src/landing/content.ts`.
- **Viewer links:** `/explore/#tour` starts the guided tour, `/explore/#about` opens the method and validation page, `/explore/#hood` opens the 3D neighbourhood, and `/explore/#ra=<deg>&dec=<deg>&fov=<deg>` points the sky (add `&blink=1` to start blinking). Old links of the form `/#ra=…` redirect to the viewer.
- **Sky images** stream straight from NASA/IPAC IRSA HiPS; we host none.

### Data feeds
Both pages read static files from `/data/` (`web/public/data/` in development). Nothing is committed: `web/sync_data.sh` pulls `~/skylens/web_data/` from the HPC into `web/public/data/` (needs an open SSH ControlMaster; `--once` for a single sync). Without data the site still loads: the landing shows fixed numbers and the lenses stay empty.

| File(s) | Contents | Written by |
|---|---|---|
| `summary.json` | census progress, headline numbers, SPHEREx channel wavelengths | `census/export_web.py` |
| `movers.json`, `methane.json`, `vanished.json`, `brightened.json` | top candidates of each lens | `census/export_web.py` |
| `targets.json` | the five challenge targets with their census matches | `census/export_web.py` |
| `coverage.json` | which sky tiles are processed | `census/export_web.py` |
| `sky/meta.json`, `sky/<lens>/top.json`, `sky/<lens>/<band>_<cell>.json` | map markers, chunked into 10° cells loaded as you pan and zoom | `census/export_web.py` |
| `obj/<cell>.json` | dossier details (values + spectrum), grouped by HEALPix order-4 cell | `census/export_web.py` |
| `unusual.json` | Unusual lens: highest AI anomaly scores | `census/ai_spectra.py twins` |
| `twins/<id>.json` | spectral twins of featured objects | `census/ai_spectra.py twins` |
| `lc/<id>.json` | 16-year light curves of featured objects | `census/lightcurves.py` |
| `flipbook/<id>.json` + `.bin` | flipbook frames (metadata + float16 stamps) | `census/flipbook_batch.py` (`census/flipbook.py` for one object) |
| `neighbors.json` | stars within 20 pc for the 3D view | `census/neighbors.py` (run locally; writes straight to `web/public/data/`) |

### Deploying
Any static host (planned: Cloudflare Pages). Sync the feeds into `web/public/data/` before `npm run build` so they ship in `web/dist/data/`, or upload a fresh `data/` folder next to the built site later.

## Repo map
| Path | Contents |
|---|---|
| `web/` | the website: landing page (`src/landing/`) and sky viewer (`src/main.ts` and siblings). See [Website](#website) |
| `census/` | pipeline: streaming readers, cross-epoch linker, SPHEREx forced photometry, tile job, launcher, exporters, flipbooks, light curves, AI |
| `docs/09_resources_and_flagships.md` | resources, flagship features, compute plan |
| `docs/10_submission_draft.md` | submission draft: project page fields, slide outline, video storyboard |
| `docs/HPC_RUNBOOK.md` | how to run, monitor and finish the census on the cluster |
| `docs/01–08` | research phase: challenge analysis, data feasibility, literature, earlier concepts, peer reviews |
| `docs/07_si_usage_log.md` | SI (AI) tool usage statement |

## Production
Everything heavy ran once on the MBZUAI GPU cluster. The hosted site is static files (≈20 MB app + feeds; flipbooks ≈1 MB per featured object) and reads NASA's public archive directly — no servers doing science, no GPUs.

## Data & acknowledgements
NASA SPHEREx DR1 spectral images and all-sky cube (IRSA, doi:10.26131/IRSA678, 10.26131/IRSA679) — a joint project of JPL and Caltech funded by NASA. unWISE time-domain catalog (Meisner et al. 2023, doi:10.26131/IRSA580). NASA WISE/NEOWISE. AllWISE, 2MASS and DSS2 HiPS via IRSA. Gaia DR3 (ESA). Aladin Lite (CDS).
