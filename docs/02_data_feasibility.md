# 02 · Data & Feasibility Findings (measured 2026-11-14)

Everything below was **measured by us**, not assumed. Raw outputs: `data/feasibility/`. Scripts: `scripts/feasibility/`.

## 1. SPHEREx facts that drive the design (Explanatory Supplement v2.1, 2026-11-10)
| Quantity | Value | Design consequence |
|---|---|---|
| Bands / detectors | 6 H2RG + LVF; B1 0.744–1.116 µm (R39), B2 1.099–1.651 (R41), B3 1.636–2.421 (R41), B4 2.423–3.822 (R35), B5 3.809–4.420 (R112), B6 4.412–5.002 (R128) | Wavelength varies across each detector; each exposure samples a source at one λ per band |
| FOV / dichroic | 2 × (3.5° × 11.3°); SWIR (D1–3) & MWIR (D4–6) see the same sky (pairs 1/4, 2/5, 3/6) | Every exposure gives 2 simultaneous wavelengths |
| Pixel / PSF | 6.15″ px; PSF FWHM ≈ 7.5″ (header `PSF_FWHM`) | Undersampled-ish; motion of 1–2 px over the baseline → needs centroiding/differencing |
| Exposure | 113.58 s, SUR readout | Fast movers (MBAs ~30–60″/hr) shift ~1 px *within* a target group of 17 exposures |
| Cadence | target group = 17 pointings stepped 1 channel in ecliptic latitude; full spectrum needs all 3 detector pairs (days apart); each sky point revisited ~6 months (PA 0°/180° surveys); Surveys 3–4 offset by ½ channel | Two time-scales: hours–weeks (spectral sweep, SSO motion) and 6 months (stellar motion) |
| Depth (4 surveys) | 5σ 19.5–19.9 AB (0.75–3.8 µm), 17.8–18.8 AB (3.8–5.0 µm) per channel | Single exposure ≈ 0.75 mag shallower |
| Astrometry | Gaia-DR3 tied (scamp), sub-arcsec RMS; `FINAST` flag (0 good, 1 corners off, >1 bad) | Relative astrometry on local Gaia stars should reach ≪ 1 px |
| Saturation | full-well proxies F_over = 50 000 e⁻ (B1–3), 30 000 e⁻ (B4–6); SUR early-transient truncation; BLOOM/SNOWBALL/HALO flags | Barnard's Star, Eps Indi A, R Dra will saturate in some bands → PSF-wing photometry + flag-aware masking |
| Source masks | from Gaia-based Reference Catalog **and known Solar-System objects**; mask size can be wrong (Fig. 14) | Use flags as overlays, never as truth |
| HiPS cube | DR1 static 102-channel coadd, HEALPix order 5 tiles, 512² × 12.9″ px, ZODI subtracted, striping at bright lines | Good context layer and *static-sky prior*; not time-resolved |
| Spectrophotometry Tool | Tractor forced photometry, **positions not floated**, +3% systematic | Gap: nothing handles motion in the time domain |

FITS layout per L2 image (≈65.8 MB): `PRIMARY`, `IMAGE` (2040², f32, MJy/sr, zodi *not* subtracted), `FLAGS` (CompImageHDU int32), `VARIANCE`, `ZODI`, `EPSF` (441 rows = 21×21 regions, 33×33 ×5 oversampled), `WCS-WAVE` (9×9 control-point lookup table; `WCS(header, fobj=hdul, key='W')` with `sip=None`). Flag bits: 0 TRANSIENT, 1 OVERFLOW, 2 SUR_ERROR, 6 NONFUNC, 7 DICHROIC, 9 MISSING_DATA, 10 HOT, 11 COLD, 12 FULLSAMPLE, 14 PHANMISS, 15 NONLINEAR, 17 PERSIST, 19 OUTLIER, 20 CROSSTALK, 21 SOURCE, 22 GHOST, 23 GHOST_FPA, 24 GHOST_EXT, 25 STREAK, 26 BLOOM, 27 SNOWBALL, 28 HALO.

## 2. Exposure inventory for the five test targets (IRSA TAP, `spherex.plane ⋈ spherex.artifact`, CONTAINS point)
| Target | N exposures (D1..D6) | Releases | Visit clusters (gap > 15 d) |
|---|---|---|---|
| WISE 0855−0714 | **258** (36/48/45/36/48/45) | dr1 | MJD 60800.7 (n=30) · 60979.7–60993.9 (n=110) · 61020.8 (n=18) · 61151.2–61174.3 (n=100) → **~1.0 yr baseline** |
| Barnard's Star | **363** (60/62/60/60/62/59) | dr1 240 + qr3 123 | 7 clusters MJD 60902.9 → 61305.6 → **~1.1 yr** |
| R Draconis | **2,494** (585/89/574/584/89/573) | dr1 1639 + qr3 855 | near-continuous MJD 60789.9 → 61310.3 (NEP deep field) |
| RW Aurigae | 335 (56 per band) | – | MJD 60919 → 61300 |
| Eps Indi B | 459 (49/88/98/46/82/96) | – | MJD 60789.9 → 61315.5 |

Implications: (i) For WISE 0855 the expected motion over the current baseline is ≈ 8.1″ ≈ 1.3 px; for Barnard ≈ 11″ ≈ 1.8 px — *visible only with sub-pixel methods or difference imaging*; (ii) R Dra gives a genuine, densely-sampled infrared light curve through ~2 Mira cycles — but every point is at a different wavelength.

## 3. Access paths benchmarked
| Path | Result | Verdict |
|---|---|---|
| IRSA TAP sync (`/TAP/sync`) | works, ~5–20 s per position query; **no CORS header** | backend only |
| IRSA cutout (`<url>?center=ra,decd&size=deg`) | HTTP 200 in **6.2 s (0.02°) / 8.3 s (0.1°)**; ~**4.0 MB** each (EPSF + WCS-WAVE dominate); **no CORS**; one 503 observed | too slow for 250–2,500 frames live; fine for prebake |
| S3 `nasa-irsa-spherex` (us-east-1, anonymous) | `Access-Control-Allow-Origin: *`, GET/HEAD; **byte-range 206 in ~1 s** from UAE; full file 65.8 MB; prefixes `dr1/`, `qr3/`, `qr2/` + calibration dirs (`epsf/`, `spectral_wcs/`, `spectral_channels/`, `solid_angle_pixel_map/`, `hips5_cube/`…) | **primary path**: our cutout service reads only the needed rows (a 64-px cutout ≈ 64 × 8160 B ≈ 0.5 MB of IMAGE) |
| unWISE cutouts (unwise.me) | 200, `Access-Control-Allow-Origin: *`, ~1.4 s | browser-direct for the WISE bridge |
| IMCCE SkyBoT cone search | 204/200, CORS `*` | browser-direct known-SSO overlay |
| JPL SB-Ident | 200, ~23 s, no CORS | backend, cached |
| Gaia ESA TAP | 429 rate-limited | use IRSA/VizieR mirror via backend, cache |

## 4. Architecture decision (from measurements)
- **Cutout bundle service** (stateless FastAPI, S3 range reads, async fan-out 32–64 in flight, ideally hosted in AWS us-east-1 next to the bucket): returns one compact binary per query containing every exposure's IMAGE−ZODI, VARIANCE, FLAGS, λ-map, ePSF row, WCS, MJD, detector, PA. Estimated payload for 258 exposures × 64² px × (2+2+4 B) ≈ **8.5 MB** (gzip ~5 MB).
- **Prebaked static bundles** for the 5 challenge targets + tour targets (zero-latency demo; resilient to IRSA outages).
- **TAP-driven discovery** → new weekly QR data appear automatically ("easy to update").

## 5. Proof of concept — WISE 0855 "first light" (`scripts/poc/wise0855_poc.py`, `scripts/bundler/s3fits.py`)
Exact byte-range reader (`s3fits.RemoteFITS`): HDU index of a 65.8 MB L2 file in ~2.5 s (6 header reads), a 64-row slice of IMAGE in ~0.26 s, spectral WCS from the 720-byte `WCS-WAVE` table in ~0.26 s. HDU layout (bytes): IMAGE @25 920 (16.6 MB) · FLAGS @16 689 600 (**11.8 MB compressed**) · VARIANCE @28 494 720 · ZODI @45 152 640 · EPSF @61 804 800 (3.9 MB) · WCS-WAVE @65 669 760 (720 B).

**93 D5+D6 cutouts (0.08°) of WISE 0855 fetched in 18–19 s from the UAE** (24 threads) — vs. >10 min with astropy+fsspec block reads.

| Visit (MJD) | N exp | λ range (µm) | per-exposure S/N median / max | stacked S/N |
|---|---|---|---|---|
| 60801.1 | 11 | 4.04–5.00 | 3.2 / 7.4 | 14.8 |
| 60989.1 | 37 | 3.82–4.98 | 3.4 / 7.2 | 25.2 |
| 61021.7 | 9 | 4.05–4.74 | 5.5 / 6.2 | 15.9 |
| 61161.2 | 36 | 3.83–4.97 | 4.8 / 8.4 | 30.4 |

**SPHEREx-only proper motion (crude 7×7-px centroid, no parallax term, no ePSF): μα\* = −7.31″/yr, μδ = +1.81″/yr over 0.99 yr, vs literature −8.12, +0.67.** The centroid method is biased toward zero motion; ePSF fitting + local Gaia re-registration + parallax term are expected to close the gap. Conclusion: the premise holds — the coldest known brown dwarf is detected per-visit at S/N 15–30 and its motion is measurable from SPHEREx alone.

## 6. Open quantitative questions to settle in hour 0–6 of the build
1. ~~Per-exposure S/N of WISE 0855~~ → measured above (3–8 per exposure in 3.8–5.0 µm).
2. Which bands saturate for Barnard (K≈4.5), Eps Indi A (K≈2.2), R Dra (K≈0–1) — inspect OVERFLOW/TRANSIENT flags in real cutouts.
3. Per-exposure astrometric residuals on local Gaia stars (sets the proper-motion precision floor).
4. Whether FLAGS tile-compression allows cheap row-range reads (else decompress whole HDU server-side: ~2 MB compressed).
