# 10 · Submission draft (project page, 7 slides, 30-second video)

Numbers marked ⟨…⟩ are filled from the final census export before submission.

## Project page fields

**Project name:** SKYLENS — The infrared sky has moved

**High-level summary (≈150 words):**
In 1930 Pluto was found by blinking two photographs of the same sky. SKYLENS does it for the whole infrared sky, sixteen years apart. We linked ⟨43 billion⟩ NASA WISE detections (2010–2020) into ⟨N⟩ moving objects and measured every one again in NASA SPHEREx's 102-colour all-sky map (2025–26). The result is a public, map-first web app: blink the whole sky between 2010 and 2025, switch on lenses that light up what moved, what vanished, what is made of methane, or what our AI cannot explain, and open the evidence for any object — every individual SPHEREx exposure in a wavelength-aware flipbook, its 102-colour spectrum, its 16-year light curve and its spectral twins. Our blind census recovers the Sun's fastest neighbours (Barnard's Star, WISE 0855, Lacaille 9352, ε Indi A/B) and confirms each with SPHEREx at its predicted 2025 position. It runs as static files and needs no servers.

**Link to project / demo:** ⟨hosted URL⟩ · repo: github.com/Mohsinin-Wlad-Sam/assrar-dawla

**Project details — what it does, how it works, benefits, tools:**
1. *The problem.* SPHEREx sees every source at a different wavelength in each exposure (linear variable filters), so naïvely blinking it makes constant stars flicker; and one year of SPHEREx is too short to see most stars move.
2. *The idea.* Join SPHEREx to WISE: 16 years of baseline, two independent missions, 102 colours.
3. *How.* For each of 12,288 sky tiles we stream the unWISE time-domain catalog (16 epochs) and the SPHEREx DR1 102-channel cube from NASA's public cloud into memory, link detections across epochs into moving objects (fast-mover trajectory search), propagate each object to the SPHEREx epoch and measure it in 102 channels with deblended forced photometry. Quality gates: isolation, saturation, per-tile calibration (SPHEREx/WISE scatter ≈7%), empirical error scaling. Per-object products: flipbooks from byte-range reads of individual L2 exposures, light curves along the moving track, and a GPU-trained autoencoder fingerprint for spectral twins and anomalies.
4. *Benefits.* Discovery without coordinates for anyone (students to Backyard Worlds volunteers); professional-grade evidence for every candidate; continues WISE's motion science past the end of NEOWISE; free to host.
5. *Tools.* Python (numpy, scipy, astropy, astropy-healpix, pyarrow, PyTorch), TypeScript (Vite, Aladin Lite v3, uPlot), MBZUAI GPU cluster (CPU census, 1 GPU for AI).

**NASA data:** SPHEREx DR1 spectral images (L2) and all-sky 102-channel cube (IRSA); NEOWISE/WISE via the unWISE time-domain catalog (IRSA); AllWISE W2 HiPS (IRSA).

**Space agency partner data:** none required (CSA NEOSSat considered; out of scope).

**References:** see `docs/03_literature.md` (Bock+2025 SPHEREx mission 2511.02985; Akeson+2025 pipeline 2511.15823; Meisner+2023 unTimely 2209.14327; Gagné+2026 SPIFF 2604.22012; Rustamkulov+2026 2607.00543; Luhman+2024 2311.17316; Kuchner+2017 1705.02919; TractorJAX 2610.16007; Saydjari+2026 2611.12846), software (astropy, Aladin Lite, uPlot, PyTorch, pyarrow), data DOIs above.

**Use of SI (AI) tools:** see `docs/07_si_usage_log.md`.

## 7 slides
1. **The infrared sky has moved.** Hero image (magma SPHEREx globe) + one line + URL.
2. **The problem.** Pluto found by blinking · SPHEREx's 102 colours make naïve blinking lie (flipbook GIF: raw vs de-flashed) · one SPHEREx year is too short for motion.
3. **The idea: a 16-year census.** WISE 2010–2020 (43 B detections) ⇄ SPHEREx 2025–26 (102 colours). Diagram: stream → link → propagate → measure → flags.
4. **Validated.** Table: Barnard 10.24 vs 10.36 ″/yr; WISE 0855 8.25 vs 8.15; Lacaille 9352; GJ 1; ε Indi A/B — all confirmed by SPHEREx at predicted positions. WISE 0855 449 vs 462 µJy over 16 yr.
5. **Discover without coordinates.** Screens: lenses, blink, tour; ⟨counts⟩ movers / methane worlds / vanished / unusual.
6. **Evidence for every object.** Dossier: flipbook (every exposure), spectrum, 16-yr light curve, AI spectral twins (ε Indi B's twins are methane dwarfs).
7. **Impact & honesty.** For students → professionals; continues NEOWISE motion science; free static hosting; limits stated (12.9″ blends, saturation, "unexplained ≠ new"). Team + thanks.

## 30-second video (storyboard)
| t | Picture | Caption / voice |
|---|---|---|
| 0–4 s | Black → magma SPHEREx globe zoom-out, headline | "In 1930, Pluto was found by blinking two photos of the sky." |
| 4–9 s | Tour flies to Barnard's Star; BLINK flips 2010 ⇄ 2025, star jumps | "We blinked the entire infrared sky — sixteen years apart." |
| 9–15 s | Lenses switch on; glowing points across the globe | "43 billion WISE detections, re-measured in SPHEREx's 102 colours." |
| 15–22 s | Dossier: flipbook (raw → de-flashed), spectrum, light curve | "Every object comes with its evidence — every exposure, its spectrum, its history." |
| 22–27 s | Twins grid; Unusual lens | "Our AI finds its twins — and flags what it has never seen." |
| 27–30 s | URL + logo | "SKYLENS. The infrared sky has moved — go find something." |
