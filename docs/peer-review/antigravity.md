# Peer Review: **TOMBAUGH-102** (SPHEREx Spectro-Temporal Blink Comparator)

**Reviewer Profile:** Co-I / Science Team Perspective (SPHEREx & Backyard Worlds: Planet 9) + Principal Research Software Engineer  
**Verdict:** **Strongest conceptual thesis I have seen for this challenge—if and only if you survive five severe physical and engineering traps and ruthlessly prune scope in the next 45 hours.**

Your central thesis—that blinking raw SPHEREx exposures fails because the Linear Variable Filter (LVF) confounds $\lambda$ and $t$—is **100% spot-on**. Most hackathon teams will build a naive image carousel of L2 cutouts and wonder why every star flickers by $2\times–20\times$ in brightness. However, several parts of your v0.1 proposal will break against actual SPHEREx detector physics, undersampled PSF math, and S3 FITS compression mechanics.

Below is your requested breakdown.

---

## 1. The 5 Most Serious Scientific & Technical Flaws/Risks

### Flaw 1: Pixel-Level "Chromatic Template Subtraction" on Resampled $6.15''$ Pixels Will Produce Catastrophic Aliasing Dipoles
* **The Physics & Numbers:** SPHEREx pixels are $6.15''$, whereas the optical/NIR PSF FWHM in Bands 1–3 ($0.75–2.42\,\mu\text{m}$) is $\sim 1.5''–2.2''$ ($\text{FWHM} \approx 0.25–0.36\text{ pixels}$), only becoming diffraction-limited ($\text{FWHM} \approx 3.5''–4.5''$, still $<0.75\text{ px}$) in Bands 5–6. Because the PSF is **severely undersampled**, a point source’s pixel profile depends drastically on its sub-pixel centroid phase $(\Delta x, \Delta y) \in [-0.5, 0.5]^2$: the peak pixel contains anywhere from $\sim 25\%$ to $\sim 65\%$ of the total flux depending on whether the star lands on a pixel center or corner.
* **Why Your Architecture Breaks:** In §2 (P1) and §3, you propose reprojecting exposures onto a common tangent sky grid and subtracting a "per-sky-pixel spectral interpolation." Resampling an undersampled PSF with standard interpolation (bilinear/bicubic/lanczos) without PSF homogenization destroys flux conservation at the $20\%–40\%$ level and introduces sub-pixel phase aliasing. **Every static star in your difference image will show a bright $+/-$ dipole residual**, masquerading as thousands of fake moving objects.
* **The Fix:** **Never interpolate spectra per sky pixel on resampled images.** Instead, do **Catalog-Driven Native-Frame Forward Modeling**:
  1. Take static source positions from Gaia DR3 / CatWISE2020 (propagated to mean epoch) and estimate each source's low-order smooth spectrum $S_k(\lambda)$ across visits.
  2. In each exposure $i$'s **native detector coordinates**, evaluate the local $5\times$-oversampled $21\times 21$ `EPSF` at the exact sub-pixel position $(x_{k,i}, y_{k,i})$ and wavelength $\lambda_i$, scale by $S_k(\lambda_i)$, and subtract from `(IMAGE - ZODI)` *before* reprojecting residuals to the tangent plane.

### Flaw 2: Four of the Five Test Targets Are Either Heavily Saturated (`OVERFLOW`) or Buried in Single-Frame Noise
* **The Numbers:** SPHEREx's 113.6 s single-exposure saturation limit is $m_{\text{AB}} \approx 9.5–10.5$ ($\text{Vega} \approx 8.5–9.5$ in NIR), where H2RG pixels saturate during up-the-ramp sampling (`OVERFLOW` / `NONLINEAR` bits set). Conversely, the single-exposure $5\sigma$ point-source sensitivity is $m_{\text{AB}} \approx 18.5–19.2$ in Bands 1–3, $\sim 18.2$ in Band 4, and $\sim 16.8–17.5$ in Bands 5–6.
* **Target-by-Target Reality Check:**
  1. **R Draconis (Mira):** $J \approx 3.1, K \approx 1.8\text{ Vega}$ ($m_{\text{AB}} \sim 3.5–4.0$). Saturated by **$6\text{ magnitudes}$ ($\sim 250\times$ saturation)** in its core across Bands 1–5.
  2. **Barnard's Star:** $J = 5.24, H = 4.83, K = 4.52\text{ Vega}$ ($m_{\text{AB}} \sim 5.6–6.4$). Saturated by **$4\text{ magnitudes}$ ($\sim 40\times$ saturation)**. Core pixels are clipped/NaN and leave H2RG persistence trails ("latents") in subsequent target-group exposures.
  3. **RW Aurigae:** $J = 8.38, K = 7.02, W1 = 6.2\text{ Vega}$. Saturates the central pixel in Bands 2–4 during bright accretion states.
  4. **$\varepsilon$ Indi B (T1+T6 binary):** $J = 11.9, K = 11.2\text{ Vega}$—ideal unsaturated SNR, **but** it sits $402''$ ($65\text{ px}$) from **$\varepsilon$ Indi A** ($V = 4.69, K = 2.24\text{ Vega}$), whose extended PSF wing and stray-light halo create a steep local background gradient.
  5. **WISE 0855–0714 (Y4 dwarf, $T_{\text{eff}} \approx 250\text{ K}$):** The exact opposite trap! It has $J > 25\text{ AB}$ and $H \approx 23.8\text{ AB}$. In Bands 1, 2, 3, and 6 (~85% of the 258 exposures), **WISE 0855 has $\text{SNR} < 0.1$ per exposure—it is completely invisible.** Even at its $4.5\,\mu\text{m}$ peak ($W2 = 13.89\text{ Vega} = 17.23\text{ AB}, F_\nu \approx 460\,\mu\text{Jy}$), it only achieves $\text{SNR} \approx 3–7$ per single exposure *strictly inside the $4.4–4.9\,\mu\text{m}$ opacity window* (Band 5 / red edge of Band 4).
* **The Fix:**
  * For **WISE 0855**, your UI must default to (or highlight) a **$4.4–4.9\,\mu\text{m}$ Synthetic W2 / CO-Window Coadd**; otherwise a judge blinking all 258 frames will see pure zodiacal noise in 220 of them.
  * For **Barnard's Star, R Dra, and RW Aur**, your forced ePSF photometry **must mask pixels with `FLAGS & (OVERFLOW | NONLINEAR)` and fit the ePSF wings at radii $r = 1.5–4.5\text{ px}$ ($9''–28''$)**, plus fit a local planar background for $\varepsilon$ Indi B.

### Flaw 3: S3 Byte-Range Cutout Math Fails on Tile-Compressed `FLAGS` and High Exposure Counts
* **The Numbers:** In `nasa-irsa-spherex` L2 MEF files, `IMAGE`, `VARIANCE`, and `ZODI` are uncompressed `FLOAT32` ($2040 \times 2040 \times 4\text{ B} = 16.65\text{ MB}$ per HDU). To extract a $64 \times 64\text{ px}$ ($6.5' \times 6.5'$) stamp via contiguous S3 byte-range read, you must fetch 64 full rows: $64 \times 2040 \times 4\text{ B} = 522\text{ KB}$ per HDU ($\sim 1.6\text{ MB}$ for the 3 float HDUs).
* **The Trap:**
  1. **`FLAGS` is a Rice/GZIP tile-compressed `BINTABLE` (`CompImageHDU`)**, not a flat 2D array! You cannot calculate a static byte offset `(y0 * 2040 + x0) * 4` into `FLAGS` without first parsing the `BINTABLE` heap descriptors (`PCOUNT`/`THEAP`) and decompressing the tiles.
  2. For 350 exposures (Barnard / $\varepsilon$ Ind B) or 2,494 exposures (R Dra), doing 4–6 S3 range requests per file means **1,500 to 12,000 HTTP requests** and **0.6 to 4.5 GB of data transfer** per query. Even from an EC2 instance in `us-east-1`, live Python FITS header parsing + decompression + WCS reprojection for 350 files will take **15–40 seconds** (and time out on R Dra).
* **The Fix:**
  1. **Pre-bake all 5 challenge targets** (plus 5–10 bonus targets) into compact `.zarr` or flat binary `.bin`/`.npz` cutout cubes ($N_{\text{exp}} \times 64 \times 64$ in `float16` image/zodi/variance + `uint32` flags + 1D $\lambda_i, t_i$ arrays $\approx 8\text{ MB}$ total for 350 frames!) served statically from CDN/disk in **$<150\text{ ms}$**.
  2. For arbitrary live `(RA, Dec)` queries, cap initial live streaming at $N=60$ exposures (or read `FLAGS` in a single range read of the compressed `BINTABLE` heap since the whole compressed `FLAGS` HDU is only $\sim 150–400\text{ KB}$!), and stream frames progressively to the browser via Server-Sent Events (SSE) or chunked binary.

### Flaw 4: 5-Parameter Astrometry $(\alpha_0, \delta_0, \mu_{\alpha*}, \mu_\delta, \varpi)$ Is Mathematically Degenerate Over 2 SPHEREx Visits
* **The Math:** Outside the NEP/SEP deep fields, SPHEREx observes within $\sim 90^\circ$ solar elongation, visiting a given field once every $\sim 6\text{ months}$ (leading vs. trailing orbit). With DR1 + QR3 spanning $\sim 1\text{ year}$, most fields have **only 2 main visits** (each lasting $\sim 1–2\text{ weeks}$ across the 6 detectors).
* **Why It Fails:** Two visits give you 2 epoch clusters at $t_0$ and $t_0 + 0.5\text{ yr}$ (or 3 clusters at $0, 0.5, 1.0\text{ yr}$), always at maximum parallax factor $\Pi \approx \pm 1$. Fitting 5 parameters $(\alpha_0, \delta_0, \mu_{\alpha*}, \mu_\delta, \varpi)$ to 2 sky epochs has a **singular/ill-conditioned Fisher matrix**—proper motion $\mu$ and parallax $\varpi$ are collinear when only 2 epochs exist! Furthermore, single-exposure centroid precision on undersampled $6.15''$ pixels is limited by intra-pixel response non-uniformity and LVF chromatic differential distortion to $\sigma_{\text{sys}} \approx 0.05–0.08\text{ px}$ ($300–500\text{ mas}$) per frame, or $\sim 50–80\text{ mas}$ per visit coadd.
* **The Fix:**
  * Fit a **4-parameter proper-motion model** $(\alpha_0, \delta_0, \mu_{\alpha*}, \mu_\delta)$ when using SPHEREx visits alone (which still nails Barnard's $10.36''/\text{yr}$, WISE 0855's $8.12''/\text{yr}$, and $\varepsilon$ Ind B's $4.70''/\text{yr}$ at $>50\sigma$!), **OR**
  * Break the degeneracy using your **16-year unWISE (2010–2024) + SPHEREx (2025–2026) joint fit**, or apply a Gaia/photometric distance prior when solving for $\varpi$. Be explicit about this conditioning in your UI—SPHEREx scientists will immediately test you on this.

### Flaw 5: Planet Nine Is $\sim 70\times$ Fainter Than SPHEREx's Confusion Limit, and P4+P5+P6 Scope Bloat Will Sink Your 45 Hours
* **The Numbers:** In the Brown & Batygin (2021) / Fortney et al. (2016) reference models, a $5–10\,M_\oplus$ Planet Nine at $300–600\text{ AU}$ has reflected solar flux $m_{\text{AB}}(0.75–1.5\,\mu\text{m}) \approx 19.5–22.5$ and $4.5\,\mu\text{m}$ thermal emission $m_{\text{AB}} \approx 21–24$. Because of its $6.15''$ pixels, SPHEREx reaches the **extragalactic/stellar confusion limit** at $m_{\text{AB}} \approx 19.5–20.0$ in Bands 1–3 regardless of how many exposures you stack.
* **The Engineering Risk:** Building a wide-area offline GPU shift-and-stack pipeline (P4), training a synthetic real/bogus CNN and normalizing flow, exporting to ONNX WebGPU (P5), sonification, and a 4-language UI (P6) in **45 hours** will starve your core web comparator (P1–P3). Worse, astronomy judges *distrust* black-box CNNs trained overnight on synthetic injections.

---

## 2. What Makes Judges Say "This Is New" vs. "IRSA Already Does This" (Scope Triage)

### What IRSA & WiseView Already Do (Don't Compete Here on Basic Features)
* **IRSA SPHEREx Spectrophotometry Tool** already performs forced photometry at a **static** $(\text{RA}, \text{Dec})$.
* **IRSA HiPS Cube & Data Explorer** already browse static 102-channel cubes and raw L2 images.
* **WiseView** already does WISE W1/W2 sliding-window coadds and proper-motion shift-and-stack up to Aug 2024.

### What Will Make SPHEREx & Backyard Worlds Scientists Sit Up ("This Is Genuinely New!")
1. **De-Flickering the LVF (Forward-Model Chromatic Residual Blink):** Side-by-side blinking of raw SPHEREx (chaotic spectral flickering) vs. your spectrally homogenized / template-subtracted frames (static sky vanishes; movers pop out cleanly).
2. **Kinematic Forced Spectrophotometry ($\boldsymbol{\mu}$-Tracked 102-Channel Spectrum):** IRSA's forced photometry tool uses a *fixed* sky coordinate. Over a 1-year baseline, Barnard's Star moves $1.7\text{ px}$ ($10.4''$) and WISE 0855 moves $1.3\text{ px}$ ($8.1''$). A fixed aperture misses the star by nearly a full pixel between Visit 1 and Visit 2, creating artificial flux steps between epochs! Moving the ePSF extraction aperture along $(\alpha_0 + \mu_{\alpha*}\Delta t_i, \delta_0 + \mu_\delta \Delta t_i)$ produces the **first proper-motion-corrected SPHEREx spectrum**.
3. **Saturated-Core ePSF-Wing Recovery:** Showing clean SPHEREx spectra and light curves for Barnard's Star ($K=4.5$) and R Dra ($K=1.8$) by masking `OVERFLOW` cores and fitting the $5\times$ oversampled ePSF wings.
4. **The 16-Year NEOWISE $\rightarrow$ SPHEREx Bridge (2010–2026):** Backyard Worlds volunteers lost their primary data stream when NEOWISE ended in August 2024. Showing a continuous 2010–2026 W1/W2 flipbook where SPHEREx Synthetic W1 ($3.4\,\mu\text{m}$) and W2 ($4.6\,\mu\text{m}$) seamlessly extend WiseView into 2025–2026 directly answers the Backyard Worlds team's biggest scientific need.

### Ruthless 45-Hour Triage: Cut vs. Double Down

| Pillar / Feature | Verdict | Why |
| :--- | :--- | :--- |
| **P1: 3-Mode Blink Engine** (Raw w/ $\lambda$ HUD, Band/Synthetic-WISE Coadds, Native Forward-Model Residual) | **DOUBLE DOWN** | This is the heart of the challenge and your main visual proof. |
| **P2: $\boldsymbol{\mu}$-Tracked Forced ePSF Photometry + ePSF Wing De-Saturation + Rank-1 Variable Decomposition** | **DOUBLE DOWN** | Directly solves all 5 test targets (movers + saturated Miras/T Tauri). |
| **P3: 16-Yr unWISE + SPHEREx Bridge & Astrometric Fit** | **DOUBLE DOWN** | Guaranteed emotional & scientific hit with Backyard Worlds judges. |
| **P4: Offline All-Sky GPU Search + Citizen Vetting Queue** | **PIVOT / SLASH** | Cut the wide-area pipeline & citizen queue. Replace with a **per-cutout GPU/WebGL 2D Velocity Matched-Filter ("Velocity-Gram")** over $(\mu_\alpha, \mu_\delta)$. |
| **P5: Browser ONNX Real/Bogus CNN & Normalizing Flow** | **CUT COMPLETELY** | Saves ~14 hours. Replace with **exact analytic template $\chi^2$ fitting** against Sonora/empirical brown dwarf templates (faster, zero training bugs, higher scientific validity). |
| **P6: Multilingual UI (4 langs) & Sonification** | **CUT COMPLETELY** | Zero judging points relative to time spent. Keep **5 one-click Target Story Tours** and **1-click GIF/JSON export**. |

---

## 3. Five Additional Creative Ideas (Concrete & Feasible in 45 Hours)

1. **Synthetic "Methane-Blink" ($\text{CH}_4$-On / $\text{CH}_4$-Off / CO-Window) RGB False-Color Mode:**
   * *Concept:* WiseView only has broad W1 ($3.4\,\mu\text{m}$) and W2 ($4.6\,\mu\text{m}$). SPHEREx resolves the molecular bands *inside* W1/W2. Add a 1-click **"Brown Dwarf Molecular RGB"** filter that integrates LVF frames into:
     * **Blue:** $1.20–1.32\,\mu\text{m}$ ($J$-band peak)
     * **Green:** $3.20–3.45\,\mu\text{m}$ (deep $\text{CH}_4$ fundamental absorption trough)
     * **Red:** $4.45–4.80\,\mu\text{m}$ (CO/$\text{CH}_4$-free opacity window peak)
   * *Payoff:* Main-sequence stars appear white/cyan; T and Y dwarfs ($\varepsilon$ Indi B, WISE 0855) drop out completely in Green and glow **electric magenta/red** while moving!
2. **Interactive 2D Proper-Motion "Velocity-Gram" Radar ($\text{SNR}(\mu_\alpha, \mu_\delta)$ Heatmap):**
   * *Concept:* Compute the spectrally weighted shift-and-stack matched filter $\text{SNR}(\mu_\alpha, \mu_\delta) = \frac{\sum_i w(\lambda_i) I_i(\mathbf{x}_0 + \boldsymbol{\mu}\Delta t_i)}{\sqrt{\sum_i w^2(\lambda_i) \sigma_i^2}}$ across a $81 \times 81$ grid of trial proper motions $\mu_{\alpha*}, \mu_\delta \in [-12, +12]''/\text{yr}$ (takes $<50\text{ ms}$ on your RTX 5000 Ada or $<300\text{ ms}$ in WebGL2).
   * *Payoff:* Display this 2D $(\mu_{\alpha*}, \mu_\delta)$ radar plot next to the blink viewer. Barnard's Star, $\varepsilon$ Indi B, and WISE 0855 appear as blazing hot spots in velocity space. Clicking a peak in the radar plot automatically locks the image blink engine into that mover's co-moving rest frame!
3. **The "LVF Rainbow Curtain" Synchronized Slit-Scan Overlay:**
   * *Concept:* Toggleable semi-transparent iso-wavelength contours ($\lambda(x,y)$ from `WCS-WAVE`) overlaid on the image cutout. As the user scrubs through a 17-exposure target group, the rainbow wavelength gradient visibly sweeps across the star on the sky, while a synchronized vertical cursor sweeps across the 102-channel spectrum plot below, lighting up each flux point as it is sampled.
   * *Payoff:* Instantly teaches any viewer *why* SPHEREx works the way it does in 3 seconds without a single equation.
4. **H2RG "Latent & Ghost Causality Tracer" (Detector-Coordinate Back-Projection):**
   * *Concept:* When a user clicks an uncataloged transient/blip in exposure $i$ at detector pixel $(x_{\text{det}}, y_{\text{det}})$, check not only the `PERSIST` and `GHOST` bits in `FLAGS`, but also query where detector pixel $(x_{\text{det}}, y_{\text{det}})$ pointed on the sky in exposures $i-1$ and $i-2$ (113–227 seconds earlier in the target group).
   * *Payoff:* Pop up an alert: *"Caution: Detector pixel (1412, 903) was illuminated by a $K=5.2$ star 113.6s ago in exposure $i-1$ (Persistence risk: HIGH)."* Instrument scientists on the judging panel will love this.
5. **Interactive "Lagrange-Point / Parallax Loop" Simulator Overlay:**
   * *Concept:* Allow the user to drop a synthetic T8/Y1 brown dwarf at a chosen distance ($d = 2\text{ pc}$ to $500\text{ AU}$) and proper motion into the *actual* SPHEREx exposure timestamps/wavelengths of the current field, folded through the real `EPSF` and `VARIANCE` maps.
   * *Payoff:* Turns your completeness/Planet X argument from a static slide into an interactive sandbox where judges can test "Could SPHEREx see a $300\text{ K}$ object at $3\text{ pc}$ in this exact field?"

---

## 4. Specific Resources (Papers, Libraries, Datasets, Services)

### Key Papers (Verified DOIs / arXiv IDs)
* **Crill et al. (2020), *SPIE*, [arXiv:2008.13726](https://arxiv.org/abs/2008.13726) / DOI:`10.1117/12.2567224`** — *SPHEREx: NASA's near-infrared spectrophotometric all-sky survey*: Authoritative instrument parameters, LVF bandpass design ($R=35–130$), target-group stepping strategy, and payload optical layout.
* **Doré et al. (2014), [arXiv:1412.4872](https://arxiv.org/abs/1412.4872) & Doré et al. (2018), [arXiv:1805.05489](https://arxiv.org/abs/1805.05489)** — Foundational SPHEREx science definition papers detailing sensitivity curves, confusion limits, zodiacal light modeling, and extra-solar/Solar System science cases.
* **Kuchner et al. (2017), *ApJL* 841, L19, [arXiv:1705.02919](https://arxiv.org/abs/1705.02919)** — The original *Backyard Worlds: Planet 9* paper explaining how citizen scientists spot dipoles and movers in multi-epoch WISE flipbooks (cite this to connect directly to your judges).
* **Caselden et al. (2018), *ASCL:1806.004*** — *WiseView: Visualizing motion and variability of faint WISE sources*: Reference baseline for sliding-window coadds and difference-image visualization that your tool supersedes for SPHEREx.
* **Meisner et al. (2018), *AJ* 156, 69, [arXiv:1805.08217](https://arxiv.org/abs/1805.08217)** — Time-resolved unWISE coadds (the exact dataset you need for your 16-year 2010–2026 astrometric and photometric bridge).
* **Kirkpatrick et al. (2021), *ApJS* 253, 7, [arXiv:2011.11616](https://arxiv.org/abs/2011.11616) & Kirkpatrick et al. (2024), *ApJS* 271, 55, [arXiv:2312.03639](https://arxiv.org/abs/2312.03639)** — The $20\text{ pc}$ census of brown dwarfs (including WISE 0855, $\varepsilon$ Indi B, and empirical NIR-to-MIR colors/astrometry for validation).
* **Luhman (2014), *ApJL* 786, L18, [arXiv:1404.6501](https://arxiv.org/abs/1404.6501) & Luhman et al. (2024), *AJ* 168, 230, [arXiv:2409.16368](https://arxiv.org/abs/2409.16368)** — Discovery of WISE 0855–0714 and its JWST NIRSpec/MIRI $0.8–28\,\mu\text{m}$ spectrum (ground truth for validating your SPHEREx $4.5\,\mu\text{m}$ detection of WISE 0855!).
* **Marley et al. (2021), *ApJ* 920, 85, [arXiv:2107.07434](https://arxiv.org/abs/2107.07434) & Mukherjee et al. (2024), *ApJ* 963, 73, [arXiv:2401.08065](https://arxiv.org/abs/2401.08065)** — *Sonora Bobcat* and *Sonora Elf Owl* substellar atmosphere and spectral grids ($0.5–5.0\,\mu\text{m}$, including disequilibrium $\text{CH}_4/\text{CO}/\text{CO}_2/\text{NH}_3$ chemistry).
* **Zackay, Ofek, & Gal-Yam (2016), *ApJ* 830, 27, [arXiv:1601.02655](https://arxiv.org/abs/1601.02655)** — Proper image subtraction (ZOGY) and optimal PSF-weighted matched filtering.
* **Brown & Batygin (2021), *AJ* 162, 219, [arXiv:2108.09868](https://arxiv.org/abs/2108.09868) & Brown, Batygin & Blake (2024), *AJ* 168, 8, [arXiv:2404.14594](https://arxiv.org/abs/2404.14594)** — Planet Nine orbital parameter posteriors and Pan-STARRS1/ZTF observational exclusion zones.
* *(Note on "Rustamkulov+2026" in your draft: I cannot verify that specific 2026 citation; rely on verified empirical catalogs like the IRTF/SpeX Prism Library [Burgasser 2014] and JWST NIRSpec brown dwarf spectra [Luhman+2024; Beiler+2024, arXiv:2407.08518] alongside any SPHEREx DR1 empirical templates released on IRSA).*

### Software Libraries (Python & JS)
* **`astropy` (`astropy.wcs`, `astropy.io.fits`, `astropy.coordinates`) & `reproject` (`reproject_interp` / `reproject_adaptive`)** — Python WCS transformations, `WCS-WAVE` lookup table evaluation, and tangent-plane projection.
* **`photutils` (`photutils.psf.EPSFModel`)** — Directly ingest the $5\times$ oversampled $21\times 21$ SPHEREx ePSF grid for sub-pixel forced photometry and wing fitting.
* **`s3fs` + `aiohttp` / `aioboto3`** — Parallel async byte-range reads from `s3://nasa-irsa-spherex` (`anon=True`).
* **`jax` / `torch`** — GPU-accelerated native-frame scene modeling, ePSF fitting across 2,500 exposures in $<0.5\text{ s}$, and 2D $(\mu_\alpha, \mu_\delta)$ velocity-gram generation on your RTX 5000 Ada nodes.
* **`aladin-lite` (v3, WebGL2)** — Embed the SPHEREx DR1 102-channel HiPS cube, unWISE, 2MASS, and Gaia DR3 catalog overlays with zero custom tile-server work.
* **`uPlot` (or `Plotly.js`)** — `uPlot` renders 2,500+ time-series points and 102-channel error-bar spectra at 60 fps with a 45 KB footprint and instant cursor synchronization.
* **`gifenc` (by Matt DesLauriers, pure JS)** — Fast in-browser GIF encoder (<10 KB) to export blink animations for Backyard Worlds discovery reports in `<200 ms`.

### Datasets, Spectral Templates & Services
* **Sonora Bobcat / Elf Owl Zenodo Grids (`zenodo.org/records/5063476` & `zenodo.org/records/10385987`)** — Pre-convolve ~200 representative M/L/T/Y spectra ($T_{\text{eff}} = 250–2400\text{ K}$) down to SPHEREx's 102 channels ($\approx 80\text{ KB}$ JSON file shipped straight to the browser!).
* **SVO Filter Profile Service (`svo2.cab.inta-csic.es/theory/fps/`)** — Exact transmission curves for WISE W1/W2 and 2MASS $J/H/K_s$ to weight your synthetic broadbands.
* **unWISE Time-Resolved Cutouts / Catalog (`unwise.me` / NOIRLab Astro Data Lab / IRSA `unwise_neo7`)** — Multi-epoch W1/W2 cutouts (2010–2024) for your 16-year bridge.
* **Brown & Batygin (2021) P9 Synthetic Reference Population (`data.caltech.edu/records/20100`, DOI:`10.22002/D1.20100`)** — 100,000 synthetic Planet Nine clones with $(\text{RA}, \text{Dec}, d, V)$ to generate a real sky probability density map.
* **IMCCE SkyBoT (`vo.imcce.fr/webservices/skybot/`)** — Fast cone-search API at `(RA, Dec, MJD)` to flag known Main-Belt/NEO asteroids crossing any SPHEREx exposure.

---

## 5. Recommended 45-Hour Build Order (MVP First, 4–6 Team + AI Agents)

Split your team into **Stream A (Backend / Data / Science on GPU Server)** and **Stream B (Frontend WebGL / Interactive UX)**, joined by a **frozen JSON/Binary Data Contract in Hour 2**.

### Phase 1: Hours 0–6 — Data Contract & Pre-Baked Target Cubes (No Live S3 Yet!)
1. **Hour 0–2 (All):** Freeze the binary/JSON bundle schema for a target field:
   * `meta.json`: `N_exp`, `mjd[]`, `lambda_center[]`, `band[]`, `ra_center`, `dec_center`, `gaia_sources[]`, `unwise_epochs[]`.
   * `frames.bin`: `float16` array of `[N_exp, 5, 64, 64]` containing `(IMAGE - ZODI)`, `VARIANCE`, `MODEL_STATIC`, `RESIDUAL`, and `uint16` compressed `FLAGS`.
2. **Hour 2–6 (Stream A - 2 people):** Write the Python extractor on your GPU machine. Download all L2 files for the **5 challenge targets** (Barnard, $\varepsilon$ Ind B, WISE 0855, RW Aur, R Dra) to local NVMe. Extract $64\times 64$ native stamps, evaluate `WCS-WAVE` at the target and across the stamp, decompress `FLAGS`, and save the 5 static target bundles.
3. **Hour 2–6 (Stream B - 2–3 people):** Scaffold the Vite + TypeScript + WebGL2 + `uPlot` + Aladin Lite v3 single-page app. Load a mock/first real bundle (Barnard's Star) and render the basic flipbook with play/pause, speed slider, colormap/stretch controls, and `FLAGS` bitmask overlay toggles.

### Phase 2: Hours 6–18 — The Core Scientific Engine (De-Flicker + Forced Photometry)
4. **Hour 6–12 (Stream A):** Implement **Kinematic Forced ePSF Photometry** (with `OVERFLOW` core masking + $r=1.5–4.5\text{ px}$ wing fitting for Barnard/R Dra) and **Native-Frame Static Sky Forward Modeling** (leave-one-visit-out smooth spectral spline + ePSF subtraction). Regenerate the 5 target bundles with clean `RESIDUAL` planes and synthetic W1/W2/$\text{CH}_4$-RGB coadds.
5. **Hour 12–18 (Stream A):** Build the **Rank-1 SVD / GP Spectro-Temporal Decomposition** ($F(\lambda, t) = S(\lambda)\cdot A(t)$) for R Dra and RW Aur, the **2D $(\mu_\alpha, \mu_\delta)$ Velocity-Gram GPU kernel**, and the pre-convolved Sonora Elf Owl / SpeX 102-channel template JSON library.
6. **Hour 6–18 (Stream B):** Build the 3-mode Blink Comparator UI:
   * Side-by-side or toggle view: **Raw (Flickering)** vs. **Synthetic Band Coadds** vs. **Chromatic Residual (De-Flickered)**.
   * Synchronized **102-channel Spectrum + Light Curve** panel (`uPlot`) with molecular band overlays ($\text{H}_2\text{O}, \text{CH}_4, \text{CO}, \text{CO}_2$) and live template $\chi^2$ classifier readout.
   * Proper-motion vector handle: drag $(\mu_\alpha, \mu_\delta)$ on the canvas or click the 2D Velocity-Gram heatmap to dynamically shift-and-stack the frames in WebGL2.

### Phase 3: Hours 18–30 — The 16-Year WISE Bridge & Live S3 Cutout Endpoint
7. **Hour 18–24 (Stream A):** Pull unWISE time-resolved epochs (2010–2024 W1/W2) for the 5 targets, cross-calibrate flux to SPHEREx Synthetic W1/W2 (2025–2026), and compute the joint 16-year astrometric fit $(\alpha_0, \delta_0, \mu_{\alpha*}, \mu_\delta, \varpi)$ with residuals vs. Gaia DR3 / Kirkpatrick+2021.
8. **Hour 24–30 (Stream A):** Build the FastAPI live `(RA, Dec)` endpoint using `irsa-tap` (`spherex.plane` $\bowtie$ `spherex.artifact`) + `aiohttp` S3 byte-range reader with local disk caching and SSE streaming so arbitrary sky coordinates work in ~5–8 seconds.
9. **Hour 18–30 (Stream B):** Add the **"LVF Rainbow Curtain"** wavelength overlay, Gaia DR3 proper-motion-propagated vectors, SkyBoT asteroid markers, URL state sharing (`?ra=..&dec=..&target=..`), and 1-click GIF/JSON candidate card export.

### Phase 4: Hours 30–45 — Story Tours, Validation Polish & 30-Second Video
10. **Hour 30–36 (All):** Build **5 One-Click Interactive Target Tours** at the top of the app (`[1. Barnard's Star]`, `[2. WISE 0855 (Y4)]`, `[3. Eps Indi B]`, `[4. R Dra (Mira)]`, `[5. RW Aur]`) that load the pre-baked bundles in $<100\text{ ms}$ and step through a 3-tooltip scientific narrative for each.
11. **Hour 36–42 (All):** Record the 30-second video and build the 7-slide deck (include the quantitative Astrometric Validation table and R Dra de-saturated light curve!).
12. **Hour 42–45 (All):** Code freeze. Deploy static frontend to Cloudflare Pages / Vercel (backed by pre-baked CDN files so the demo *cannot* fail even if your backend or IRSA goes down during judging).

---

## 6. Single Best Suggestion for the 30-Second Demo Video Storyline

**Core Rule:** Judges watch 50+ videos. Do **not** start with a title slide, team introductions, or architecture diagrams. Start in the first **0.5 seconds** with the visual failure of a naive SPHEREx flipbook, and solve it before second 10.

### Second-by-Second Script (~72 words spoken at natural pace)

* **0:00 – 0:06 | THE PROBLEM (Split screen, Left side active):**  
  * *Visual:* Raw time-ordered SPHEREx exposures of **$\varepsilon$ Indi B** and **WISE 0855** blinking rapidly. The stars flash violently from bright to invisible as the LVF wavelength sweeps across $\text{CH}_4$ and $\text{H}_2\text{O}$ bands. The rainbow $\lambda(x,y)$ curtain sweeps across the frame.  
  * *Voiceover:* *"Clyde Tombaugh found Pluto by blinking plates. Today, blinking SPHEREx fails—because its linear variable filter samples a different wavelength every exposure, making constant stars flicker wildly."*

* **0:06 – 0:15 | THE BREAKTHROUGH (Right side snaps on + Velocity Radar):**  
  * *Visual:* Click **[Chromatic Forward-Model Subtraction]**. Instantly, the flickering background stars vanish into flat gray noise. **Barnard's Star** and **$\varepsilon$ Indi B** glide smoothly across the frame. Click the hot spot on the **2D Velocity-Gram** and the **Synthetic $\text{CH}_4$/CO RGB toggle**: **WISE 0855** ($250\text{ K}$) lights up as a neon-red moving dot.  
  * *Voiceover:* *"Meet TOMBAUGH-102. By subtracting a forward spectral scene model in native detector space, the static sky vanishes. Even 250-Kelvin Y-dwarf WISE 0855 pops out in our synthetic methane-window blink."*

* **0:15 – 0:24 | THE SCIENCE ON THE FLY (Bottom panel animates):**  
  * *Visual:* Click $\varepsilon$ Indi B $\rightarrow$ the **$\mu$-tracked 102-channel spectrum** assembles in real time with $\text{H}_2\text{O}$ and $\text{CH}_4$ absorption bands labeled ($\text{T1+T6 fit } \chi^2_{\nu}=1.04$). Switch in 1 click to **R Draconis** $\rightarrow$ show ePSF-wing de-saturation recovering a 2,494-point Mira pulsation curve and phase-resolved spectra.  
  * *Voiceover:* *"One click runs motion-tracked ePSF photometry—recovering 102-channel brown dwarf spectra, de-saturating bright Miras like R Draconis across 2,500 exposures..."*

* **0:24 – 0:30 | THE 16-YEAR BRIDGE & IMPACT (Full-screen climax):**  
  * *Visual:* Toggle **[16-Year WISE $\rightarrow$ SPHEREx Bridge (2010–2026)]**. Watch WISE 0855 race $130''$ across 14 years of unWISE frames and seamlessly cross into 2025–2026 SPHEREx synthetic-W2 frames with a sub-arcsecond astrometric track and live URL at the bottom.  
  * *Voiceover:* *"...and bridging 14 years of WISE directly into SPHEREx. Try all five challenge targets live right now."*
