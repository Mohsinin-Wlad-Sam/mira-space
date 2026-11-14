# 05 · Build Plan (45 h) — from Sat 14 Nov 01:00 to Sun 15 Nov 23:59 (+04)

Hard deadline: **Sun 15 Nov 23:59 local** (project page submitted, demo attached). Internal freeze: **Sun 20:00**.

## 0. Data contract (freeze in hour 1 — everything else depends on it)
`bundles/<target>/manifest.json`
```jsonc
{ "target": "wise0855", "center": {"ra":…, "dec":…}, "stamp_px": 96, "pixscale": 6.15,
  "frames": [ { "i":0, "mjd":…, "band":"D6", "detector":6, "pa_survey":0|180, "visit":2,
                "lam_um":4.71, "bw_um":0.037, "x0":…, "y0":…, "wcs": {…TAN-SIP subset…},
                "zodi_med":…, "finast":0, "flags_summary": {…} } ],
  "sources": [ {"id":"gaia:…", "ra":…, "dec":…, "pmra":…, "pmdec":…, "plx":…, "ref_epoch":2016.0} ],
  "products": { "frames": "frames.f16", "var": "var.f16", "flags": "flags.u32", "lam": "lam.f16",
                "model": "model.f16", "resid": "resid.f16", "epsf": "epsf.f32",
                "coadds": "coadds.f16", "spectra": "spectra.json", "vgram": "vgram.f32" } }
```
Binary arrays are little-endian, shape `[N_frames, stamp, stamp]`, gzip-served. The frontend must run on `frames`+`var`+`flags`+`lam` alone; `model`/`resid`/`vgram` are progressive enhancements.

## 1. Roles (team ≤ 6; each lead pairs with AI coding agents)
| Role | Owns |
|---|---|
| **D — Data/Backend** (1–2) | bundle builder, S3 range reader, TAP, live API, CDN upload |
| **S — Science/GPU** (1–2) | scene model, PM/velocity-gram, spectra + χ² typing, validation table, injection–recovery, bridge fit |
| **F — Frontend** (2) | viewer, modes, overlays, plots, URL state, export, tours |
| **P — Story/Design** (shared, ≥1 person part-time from hour 24) | 7-slide deck, 30-s video, project page, SI-usage statement, references list |

## 2. Schedule with exit and kill criteria
| Window (local) | D | S | F | Exit criterion / kill switch |
|---|---|---|---|---|
| **Sat 01–04** | builder v0: TAP → S3 ranges → stamps for WISE 0855 (D5/D6) and Barnard | confirm per-exposure S/N of W0855 (PoC), saturation flags on Barnard/R Dra/ε Indi A | Vite+TS skeleton, WebGL2 frame renderer on mock bundle, URL state | one real bundle loads in browser. *Kill*: if S3 reads >5 s/frame from UAE → run builder on HPC/AWS overnight |
| Sat 04–10 (sleep in shifts) | bundles for all 5 targets + Pluto; flags decoded; λ-maps; ePSF rows | visit×band coadds; synthetic W1/W2/J/H/K from response curves; Gaia/CatWISE propagation | raw mode with λ HUD + rainbow curtain; coadd mode; flags layers; Gaia overlay | **MVP: WiseView-parity flipbook for 5 targets** |
| Sat 10–16 | live API (FastAPI, capped N, progressive) | **scene model v1** (JAX) → residual frames; leave-one-visit-out spectra | add/subtract mode; residual mode; Aladin context (SPHEREx HiPS); FOV | de-flicker visibly works on ε Indi B field. *Kill*: if residuals are worse than coadd differencing by 16:00 → ship coadd differencing as default, scene model as "beta" |
| Sat 16–22 | unWISE epochs for bridge; SkyBoT tables per bundle | velocity-gram + PM fits; **validation table v1** (Barnard, ε Indi B, W0855) | click→spectrum/light-curve (uPlot), molecular annotations, χ² typing readout; velocity-gram panel + lock-in | numbers in the table with ± |
| Sat 22 – Sun 04 | CDN deploy (Cloudflare Pages + R2), caching | 16-yr bridge joint fit; methane RGB; R Dra panel; Pluto (Horizons) | bridge view; methane RGB; Pluto tour; export (GIF+JSON) | public URL works on a clean machine |
| Sun 04–10 | hardening, retries, fallback banner | spectral injector; injection–recovery curve (1 field); P9 layer (CaltechDATA pop + exclusions) | injector UI; P9 layer; uncertainty badges; guided tours (5 targets) | **feature freeze at Sun 12:00** |
| Sun 10–16 | perf on slow networks | figures for slides; limitations list | polish, accessibility (keyboard, colour-blind palettes) | — |
| Sun 16–20 | final bundle rebuild with latest QR3 | sanity re-check of every number on slides | screen-recording takes | **code freeze 20:00** |
| Sun 20–23:30 | submission page, repo README, references | — | — | **submit by 23:30** (30-min buffer) |

## 3. Demo deliverables (P)
- **30-second video** (preferred; English captions): 0–5 s Tombaugh plates blink → 5–11 s raw SPHEREx flicker vs de-flickered → 11–19 s WISE 0855 velocity-gram lock-in + 16-yr bridge → 19–25 s validation numbers vs Gaia/JWST + Planet-X layer → 25–30 s URL + "blinking that tells the truth."
- **7 slides** (backup): problem · LVF physics · method · results/validation · Planet X & completeness · impact & users · limitations & next steps.
- Project page: summary, NASA data used (SPHEREx DR1/QR3 L2, NEOWISE/unWISE, Gaia DR3), **SI-tools usage statement**, full references (code, data, papers, images).

## 4. Compute plan
- Builder + scene model on the workstation RTX 5000 Ada; scale to the 8-GPU node for (a) injection–recovery grids, (b) velocity-grams over large FOVs, (c) rebuilding bundles from fresh QR data.
- Data locality: if UAE↔us-east-1 range reads are slow, run the builder on a spot instance in us-east-1 (≈ $1–3 total) and copy bundles back.

## 5. Hosting (to finalize after build)
- Static viewer + bundles: Cloudflare Pages/R2 (free tier; zero egress fees) or GitHub Pages.
- Live API: one small container near us-east-1 (Fly.io / AWS Lambda / t4g.small, ≈ $0–12/month), aggressive caching. The demo does not depend on it.
