# 09 · Resources (measured) and flagship features — the 16-Year Infrared Sky Census behind SKYLENS

## 1. What we actually have (measured on 2026-11-14, 01:50–02:30 +04)
| Resource | Measured | Notes |
|---|---|---|
| GPU nodes (direct ssh, no SLURM) | `gpu-01..04`, each **8× RTX 5000 Ada (32 GB), 128 CPUs, 772 GB RAM** | shared with other users; at measurement: gpu-01 had 6 idle GPUs, 726 GB free RAM; gpu-02 fully busy; gpu-03/04 had 4–5 idle GPUs |
| Fair-use budget | **8 GPUs total** → plan: gpu-01 GPUs {0,2,4,5,6,7} + gpu-03 GPUs {6,7} (re-check `nvidia-smi` before launch) | CPUs/RAM of the node are the real workhorse for the census |
| SLURM workstation | 1 node from `ws-ia` (1× RTX 5000 Ada, 48 CPUs, 230 GB) | web build / validation / LLM notes |
| Storage | NFS `/home` (shared by all nodes), **1 TB user quota**; HF cache = **318 GB** (restorable via `~/hf_cache_restore`) | inputs are never written to disk (streamed to RAM) |
| Network gpu-01 → NASA S3 | **SPHEREx (us-east-1): 1.2 Gbit/s @96 streams; WISE (us-west-2): 0.57 Gbit/s @96 streams** (scales with streams) | per node; several nodes run in parallel |
| Laptop | ~140 Mbit/s to S3; dev + frontend + demo | |

**Consequence:** the census inputs (DR1 cube IMAGE ≈ 1.31 TB + unWISE time-domain columns ≈ 2.4 TB of 4.4 TB) stream in **≈6–10 h on one node, ≈3–4 h across three**. CPU per tile ≈ 40 s (laptop) → 12,288 tiles × 40 s / ~100 concurrent workers ≈ 1.4 h. **An all-sky census in one night is feasible.** Full L2 reprocessing (107 TB) is not (≈5+ days) — L2 is used per object on demand and for top candidates only.

## 2. Storage plan (1 TB quota)
- Inputs: **0 bytes on disk** (RAM streaming, ~2–4 GB per worker).
- Outputs: per-tile Parquet ≈ 5–15 MB (spectra only for SPHEREx S/N>5 objects) → **≈ 60–180 GB all-sky**, plus QA JSON. Written to `~/skylens/census_out/` and synced off-HPC (laptop / CDN) progressively.
- AI stage: training sets ≤ 30 GB; model checkpoints ≤ 5 GB.
- **HF cache: keep for now.** If free space < 250 GB at launch, delete only models listed in `docs/hpc_hf_models.md` as "deletable", after the user confirms; restore later with `~/hf_cache_restore`.
- Never touch `~/research/` (directed research paper).

## 3. Flagship features (each is impossible without the compute, cheap to host)
All are static files queried in the browser (DuckDB-WASM over tiled Parquet, Aladin Lite HiPS layers), plus live per-object data straight from NASA's S3 (CORS `*`).

### F1 · **The Vanishing Sky** — what disappeared or appeared in 16 years
All-sky list of infrared sources bright in WISE (2010–2020) and gone in SPHEREx (2025–26), or new in SPHEREx with no WISE counterpart. Each one is vetted (movers' "ghosts" removed, flags, edges, calibration) and labelled *matched / no match in queried catalogs*. Physical classes: young-star fades and outbursts, dust-obscured stellar events (failed-supernova candidates are found exactly this way), Miras, changing-look AGN, artifacts.
*Hook:* "We searched the entire sky for stars that vanished."

### F2 · **New Neighbors** — the 16-year motion census (Planet X's cousins)
Every moving object in WISE+SPHEREx with a 102-color spectrum attached. Cold-world candidates (methane signature, no Gaia counterpart) are ranked and exported in Backyard Worlds-ready form.
*Proof:* the pipeline blind-recovered **WISE 0855: μ = (−8.22, +0.69) ± 0.03″/yr vs literature (−8.12, +0.67)** on a full real tile (2.28M detections → 440k objects in 15 s, one CPU).

### F3 · **A spectrum for every star** — and its twins
102-channel SPHEREx spectra for 10⁸-scale sources. **GPU-trained classifier** (labels: Gaia, SIMBAD, SPIFF brown dwarfs, known variables and quasars) gives class probabilities with calibration curves. **Spectral Twins**: a learned embedding with an all-sky nearest-neighbour index, sharded by tile and queried in the browser. "Find more like this" works anywhere on the sky.

### F4 · **The Sky's Heartbeat** — 16-year light curves
WISE W1/W2 epochs 2010–2020 plus SPHEREx synthetic W1/W2 for 2025–26 for every source, with a feed of extreme variables (outbursts, deep fades, steady trends) and spectral context for each.

### F5 · **Ask the Sky** — natural-language queries, transparent SQL
"Cold fast movers within 20° of the Galactic plane with no Gaia match" compiles to SQL that is shown to the user and runs in the browser over the census. The model sees only the schema, never invents results.

### F6 · **AI vetting notes, written offline**
For the top ~1,000 candidates, a local LLM on our GPUs (non-Chinese open models already in the cache: Llama-3.1-70B-AWQ / Gemma-3-27B / Granite-4.1) drafts a short vetting note **strictly from computed facts** (measurements, flags, cross-matches) with links to the evidence. Hosting cost: zero (static text). The overnight AI agents also do pipeline QA tile by tile.

### F7 · **The Honest Flipbook** (the challenge's required tool, for any object)
WISE epochs plus every SPHEREx exposure. LVF-aware modes (per-frame wavelength, 6-band coadds, spectrum-normalized blink, add/subtract), FOV, 22-bit flag X-ray, Gaia/CatWISE/SkyBoT overlays, motion refocus, URL/embed, JSON/GIF export.

### F8 · **Sky Safari** — discovery for people who know nothing
Guided quests seeded by the five challenge targets, then real census candidates. Classification votes; triage, not confirmation.

## 4. Compute plan (overnight, agents supervise)
| Stage | Where | Est. time |
|---|---|---|
| A. Census pass (link + SPHEREx photometry + change/vanish/appear + lens indices; optional per-pixel spectral-anomaly map from the cube already in RAM) | gpu-01 + gpu-03 (+gpu-04 if free), ~100 workers total, tile queue ordered: challenge targets → validation fields → all-sky | 4–8 h |
| B. Cross-match & labels (Gaia DR3, SIMBAD types, SPIFF, VSX, Milliquas) | CPU | 1–2 h |
| C. AI: classifier + embedding (spectra + motion + variability), calibration, anomaly score | 8 GPUs | 2–4 h |
| D. Candidate refinement with L2 exposures (top ~5k): SPHEREx-only positions/motion, per-exposure photometry, dossier bundles | gpu nodes (network) | 2–3 h |
| E. LLM vetting notes (top ~1k) | 2–4 GPUs | 1–2 h |
| F. Export: tiled Parquet, HiPS layers, sync off-HPC | CPU | 1 h |

Validation shipped with the data: recovery of Gaia/CatWISE proper motions, SPIFF brown dwarfs, known variables and quasars; completeness/contamination per class; the WISE 0855 / Barnard / ε Indi / R Dra / RW Aur dossiers.
