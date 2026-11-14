# 03 · Literature & Resources (verified)

All arXiv IDs below were **checked by title via the arXiv API on 2026-11-14**. Several IDs proposed by the reviewer models were wrong (e.g. 2409.16368, 1805.08217) and have been corrected. Do not add a citation to slides without the same check.

Legend: ★ = directly used in the build · ◆ = validation ground truth · ○ = background / framing

## A. SPHEREx mission, instrument, pipeline, data
| ID | Reference | Why it matters to us |
|---|---|---|
| ★ 2511.02985 | Bock et al. — *The SPHEREx Satellite Mission* (ApJ 2026) | Canonical survey design and depths (5σ 19.5–19.9 AB / 17.8–18.8 AB after 4 maps); cite for all instrument numbers |
| ★ 2511.15823 | Akeson et al. — *SPHEREx Image and Spectrophotometry Processing Pipeline* (ApJS 2026) | L2 product definition, flags, Tractor forced photometry |
| ★ 2603.29835 | Korngut et al. — *SPHEREx Instrument: calibration, testing, in-orbit performance* | PSF, LVF response, saturation behaviour |
| ★ 2602.09139 | *Spectral response of SPHEREx* | Per-pixel LVF bandpasses → synthetic W1/W2/J/H/K and template convolution |
| ★ IRSA doc | SPHEREx Explanatory Supplement v2.1 (2026-11-10) | Cadence (17-pointing target groups, PA 0/180 surveys), flags, HiPS cube, saturation (F_over), astrometry (FINAST) |
| ★ 2603.25790 | *Spectral Map Making with SPHEREx* | Team's own mapping approach — know it before claiming novelty |
| ★ 2611.12846 | Saydjari, Hogg et al. — *Forward modeling LVF data: PAH & Paα maps* | **Closest methodological cousin**: pixel-level forward model of LVF to kill striping. We do the *time-domain, point-source* analogue → cite as inspiration |
| ★ 2610.16007 | Bahk & Hwang — *TractorJAX: GPU-accelerated SPHEREx forced photometry* | 11.9 ms per 100×100 cutout on H100; GPU scene-modeling is feasible on our RTX 5000 Adas |
| ★ 2608.21639 | *Image persistence flagging for SPHEREx* | PERSIST flag semantics → "latent causality tracer" |
| ★ 2608.09862 | Fazar et al. — *Bestiary of low-level electrical artifacts in SPHEREx* | Artifact taxonomy for the vetting UI / bogus labels |
| ★ 2605.27501 | *SPHEREx confirms predictions for satellite trail pollution in LEO* | STREAK flag; satellites as "fake movers" |
| ○ 2607.02809 | *Tracing the SAA boundary with SPHEREx transient-flag rates* | TRANSIENT flag behaviour |
| ○ 2605.00851 | *Atmospheric He and O with SPHEREx* | Confirms **680 km LEO** orbit; airglow lines (He 1.083 µm) that stripe images |
| ○ 2025ApJS..281...10C | Crill et al. 2025 — SPHEREx Sky Simulator | Possible source of realistic injection tests |
| ○ 1606.07039, 1805.05489, 1412.4872 | Doré et al. science-case papers | Solar-system & stellar science motivation |

## B. Brown dwarfs, ultracool dwarfs, the test targets
| ID | Reference | Use |
|---|---|---|
| ★◆ 2607.00543 | Rustamkulov et al. — *SPHEREx 0.75–5 µm spectra for a sequence of nearby brown dwarfs* (L0–Y4, 37 objects) | Ground-truth SPHEREx spectra incl. Y dwarfs (WISE 0855 is the only Y4) → validate our on-the-fly spectra |
| ★◆ 2604.22012 | Gagné, Faherty, …, Kuchner, Meisner, Caselden + Backyard Worlds volunteers — *SPHEREx pipeline & spectral library for UCDs (SPIFF)*, 6,003 L0–Y1 spectra, templates, auto spectral typing (mocadb.ca) | **Templates for our classifier and matched filter**; the challenge authors' own work — build on it, cite it prominently |
| ★ 2604.26771 | *SPHEREx Ultracool Dwarf spectrophotometric Atlas (SUDA)* | Teff/logg/metallicity calibration |
| ★ 2608.08908 | *Atmospheric diversity of giant-planet analogs 3–5 µm with SPHEREx* | Y/T-dwarf 3–5 µm features (CH4, CO, CO2) for "methane-blink" |
| ◆ 2311.17316 | Luhman et al. — *JWST/NIRSpec 1–5 µm spectrum of WISE 0855* | Ground truth for WISE 0855 spectral shape |
| ◆ 2505.12105 | Wright & Foley — *Flux and Color of WISE 0855* (W1 = 19.3, W1−W2 = 5.4) | 2010 WISE epoch contaminated by a background source → caveat for the 16-yr bridge |
| ◆ 1404.6501 | Luhman 2014 — discovery of WISE 0855 | PM/parallax reference |
| ★ 2402.00756 / 2505.03994 | Mukherjee et al. — *Sonora Elf Owl* grid; Wogan et al. CO2 correction (use **v2** on Zenodo 10381250 / 10385821 / 10385987) | Model templates (Y/T/L) for matched filter, classifier, injection |
| ○ 2107.07434 | Marley et al. — Sonora Bobcat | Alternative grid |
| ○ 2305.07719 | Lueber et al. — ML intercomparison of BD model grids (incl. ε Indi Ba/Bb) | Justifies template/ML classification; ε Indi B benchmark |
| ○ 2507.00957 | Biswas — model-trained ML classification of T/Y dwarfs | Precedent for synthetic-trained classifiers |
| ○ 2507.12264 | Vasist et al. — NPE retrieval of a Y0 dwarf | If we do amortized inference (stretch) |

## C. Motion-based discovery (WISE heritage, citizen science)
| ID | Reference | Use |
|---|---|---|
| ★ 1705.02919 | Kuchner et al. 2017 — First Backyard Worlds discovery | The flipbook paradigm we generalize; shows volunteers go 0.9 mag below single-exposure limit |
| ★ 1710.02526 | Meisner, Lang & Schlegel 2018 — *Time-resolved WISE/NEOWISE coadds* | Epoch-coadd design we mirror per SPHEREx visit; bridge data |
| ★ 2209.14327 | Meisner et al. — *unTimely* time-domain unWISE catalog | 2010–2020 epochal detections for the 16-yr bridge |
| ★ 2012.13084 | Marocco et al. — *CatWISE2020* (motions ±20–100 mas/yr) | Motion overlay + prior |
| ○ ASCL 1806.004 | Caselden et al. — *WiseView* | Feature-parity baseline (sliding window, diff, shift-and-add, synthetic injection, Gaia overlay) |
| ○ 2008.06396, 2108.05321, 2112.04678, 2411.01378, 2106.01387 | Backyard Worlds discoveries (Y dwarfs, Ross 19B, planetary-mass companion, subdwarfs) | Impact narrative: volunteers make real discoveries |

## D. Moving-object detection methods
| ID | Reference | Use |
|---|---|---|
| ★ 2109.03296 | Smotherman et al. — *KBMOD: moving objects in difference images* (GPU, CNN stamp filter) | GPU shift-and-stack precedent |
| ★ 2509.26279 | Stetzler et al. — *Efficient shift-and-stack on detection catalogs* | Fast catalog-level variant |
| ★ 2610.37594 | Zhai & Zhai — *Fast, memory-efficient synthetic tracking* | Hierarchical shift-sum → velocity-gram in the browser |
| ○ 1309.3248 | Shao et al. — synthetic tracking | Origin of the technique |
| ★ 1601.02655 | Zackay, Ofek & Gal-Yam — *ZOGY proper image subtraction* | Optimal difference statistic; color-refraction extension relevant to chromatic PSF |
| ★ 1805.01203 | Perdelwitz, Völschow & Müller — *parallactic fitting for distant SSOs* (one-parameter heliocentric-distance fit; recovered Makemake in WISE) | Basis of our distance-family search |

## E. Planet Nine / "Planet X"
| ID | Reference | Use |
|---|---|---|
| ★ 2108.09868 | Brown & Batygin 2021 — *The orbit of Planet Nine* | Orbital posterior |
| ★ 2110.13117 | Brown & Batygin — ZTF search + **synthetic P9 reference population** (CaltechDATA 8fjad-x7y61, 100k clones) | "Where to look" sky layer |
| ★ 2401.17977 | Brown, Holman & Batygin 2024 — Pan-STARRS1 search (78% of parameter space excluded, V≈21.5) | Exclusion overlay; honest depth context |
| ○ 1604.07424 | Fortney et al. 2016 — *Hunt for P9: atmosphere, spectra, detectability* | 3–5 µm thermal window; spectral template idea |
| ○ 1611.00015, 1712.04950 | Meisner et al. — WISE P9 searches (W1 < 16.7 excluded) | Prior IR search depth |
| ○ 2504.17288, 2506.12854 | Phan/Chen et al. — IRAS/AKARI P9 candidates | Recent IR searches |
| ○ 2504.05473 | Socas-Navarro & Trujillo — targeted parallax-based P9 search | Parallax-shift method |
| ○ 2507.22297 | Russell & White — P9 radius/albedo; reference population 3.0 | Brightness expectation V≈21.9–22.7 |
| ○ 1902.10103 | Batygin et al. — Planet Nine hypothesis review | Framing |

## F. SPHEREx time-domain & solar-system science
| ID | Reference | Use |
|---|---|---|
| ★ 2602.07129 | Karambelkar, De et al. — *SPHEREx IR transients (FU Ori, novae) via NEOWISE synergy* | Precedent for NEOWISE↔SPHEREx bridging |
| ★ 2402.08705 | Lisse, Bauer & Kim — *Planetary defense use of SPHEREx SSO catalog* | SSO science case |
| ★ 2602.08037 | SOLO — asteroid light-curve monitoring for SPHEREx | SSO photometry context |
| ○ 2512.07318, 2601.06759, 2510.26308 | SPHEREx 3I/ATLAS papers | Comet spectra (H2O, CO2, CO) — tour target |
| ○ 2203.11229 | Mahlke et al. — asteroid taxonomy | Asteroid spectral classes |
| ○ 2603.10135 | Davies et al. — *Three hundred quasars from the couch* | "Discovery from the couch" narrative with SPHEREx spectra |

## G. Software & data services
- **Python**: astropy (WCS incl. `key='W'` spectral lookup table), s3fs/fsspec (anonymous byte-range), reproject, photutils (ePSF), sep, pyvo, JAX/PyTorch (GPU), zarr.
- **JS**: Aladin Lite v3 (HiPS incl. SPHEREx 102-ch cube), uPlot (fast spectra/light curves), regl/WebGL2 (frame rendering, velocity-gram), gifenc (GIF export), onnxruntime-web (optional).
- **Data**: `s3://nasa-irsa-spherex/{dr1,qr3}/level2/…` (CORS *), IRSA TAP `spherex.plane ⋈ spherex.artifact`, spectral calibration tarball (`SPHERExSpectralFiles_202607.tar`: channel maps, per-pixel response CSVs), unWISE cutouts (unwise.me, CORS *), IMCCE SkyBoT (CORS *), JPL Horizons/SB-Ident, Gaia DR3 (via IRSA/VizieR mirror), CatWISE2020 (IRSA), SVO filter service (W1/W2/2MASS curves), Sonora Elf Owl v2 (Zenodo), SPIFF templates (mocadb.ca), P9 reference population (CaltechDATA).
