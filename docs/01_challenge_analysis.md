# 01 · Challenge Analysis — "Planet X and SPHEREx" (NASA Space Apps 2026)

Source: https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/ (Difficulty: **Advanced**; Subjects: Astrophysics, Planets & Moons, Software)

## 1. What is asked (verbatim objectives, condensed)
> Create a **public-facing web tool** to display images of the sky from SPHEREx, making it easy for anyone to quickly see how they change over time. Users enter **RA/Dec**; the tool displays a **series of images of that patch like a little video**, making it easy to spot moving objects.

**Mandatory test targets**

| Target | Why it is a good test | Physical numbers we must reproduce |
|---|---|---|
| Barnard's Star (M4V, 1.83 pc) | Largest known stellar proper motion | μ ≈ 10.39″/yr → ≈1.7 SPHEREx px/yr; NIR-bright → **saturation/OVERFLOW handling** |
| Epsilon Indi B (T1+T6 binary, 3.6 pc) | Pair of brown dwarfs orbiting a star | μ ≈ 4.7″/yr; A–B separation ≈ 6.7′ → **FOV choice** shows common proper motion; Ba–Bb unresolved (0.7″) |
| WISE 0855−0714 (Y4, ~285 K, 2.3 pc) | Coldest known brown dwarf, fast mover | RA 08h55m10.831s, Dec −07°14′42.53″; μ ≈ 8.1″/yr; **essentially invisible <3 µm** → only SPHEREx bands 5–6 |
| RW Aurigae (T Tauri binary) | Variable star (dimming events) | Low ecliptic latitude → sparse cadence (~335 exposures) |
| R Draconis (Mira, P ≈ 246 d) | Variable star | ~6° from the North Ecliptic Pole → **~2,500 exposures**, near-continuous light curve |

**"Potential considerations" (each one is a scoring opportunity)**
1. Easy to update with the latest data releases (weekly QR).
2. Creative display of the 102 bands; e.g., co-add per detector array (6) for S/N. **"Extra kudos if your tool can generate spectra on the fly."**
3. Add / subtract images taken at different times.
4. User-selectable field of view (speed vs. data transfer trade-off).
5. Overlay Gaia (DR3) and WISE.
6. Query by coordinates in the URL (embeddable).
7. Display metadata such as contamination flags.
8. Use Astropy, Aladin (CDS).

**Resources tab** (everyone will use these): IRSA SPHEREx page, IRSA SPHEREx tutorial notebooks, WiseView (byw.tools/wiseview), Gaia DR3 at MAST; CSA partner resources (NEOSSat, CADC). Note: NEOSSat is a natural *Space Agency Partner* hook (asteroid/debris tracking) — optional cross-mission add-on.

## 2. Who is behind it (audience = judges for this challenge)
The language ("Planet X", Backyard Worlds, WiseView, Pluto-by-blinking) points to the **Backyard Worlds: Planet 9** team (Marc Kuchner, NASA GSFC; Dan Caselden, AMNH—WiseView author; Aaron Meisner, NOIRLab; Jackie Faherty, AMNH; J. Davy Kirkpatrick, IPAC). These same people are co-authors of the **SPHEREx UCD pipeline & SPIFF library** (Gagné+2026, arXiv:2604.22012) and the **SPHEREx brown-dwarf spectral sequence** (Rustamkulov+2026, arXiv:2607.00543). → Our tool must speak their language (motion, W1/W2, CatWISE, unTimely, Zooniverse) and *extend* their tools, not reinvent them.

## 3. Rules & logistics that constrain the plan
- **Dates:** hackathon **Nov 14–15, 2026**; submit before **Sun Nov 15, 23:59 local time**. Teams may not start before the hackathon. → **~45 h build window.**
- **Team:** ≤ 6 members, one challenge. Universal Event teams need ≥ 2.
- **Demo:** 7-slide deck **or** 30-second video (English or English subtitles). Judges look at the demo *and* the full project.
- **SI (AI) tools allowed**; the submission **must describe how SI tools were used**.
- **References field must list all external code/text/images used.**
- **Eligibility:** NASA reviews teams for prohibited bilateral activity with **China or Chinese-owned entities**. ⚠️ Using ByteDance/Volcano Engine (Doubao) models and then disclosing them in the SI section is an avoidable eligibility risk → we do **not** use them (decision pending team confirmation).
- Global Nominees announced Dec 3, 2026; winners after executive judging.

## 4. Judging rubric (1–5 each) and how we score 5s
| Criterion | What a 5 looks like | Our lever |
|---|---|---|
| Impact | Broad audience, inspiring, could change the field | Usable by Backyard Worlds' ~100k volunteers *and* pros; discovery-report export; multilingual |
| Creativity | Never attempted before | LVF-aware "chromatic" differencing, spectral matched-filter motion search, 16-yr WISE→SPHEREx bridge |
| Validity | Scientifically sound, fully developed, user-friendly | Quantitative validation: SPHEREx-only proper motions vs Gaia; injection–recovery completeness |
| Relevance | NASA data is the core | SPHEREx L2 images (DR1+QR3) at pixel level + WISE/NEOWISE + Gaia |
| Presentation | Compelling story | "Pluto was found by blinking. With 102 colors, blinking lies to you." |

## 5. Competitive landscape (what already exists — we must clearly exceed it)
- **WiseView** (AMNH): blink of unWISE epochal coadds; sliding window, scan-direction split, difference imaging, shift-and-add (pmRA/pmDec), synthetic-object injection, Gaia overlay, URL state. → *Baseline parity list for our tool.*
- **IRSA SPHEREx Data Explorer / Spectrophotometry Tool**: search, cutouts, Tractor forced photometry with **fixed positions** (no motion), 3% systematic floor; Mosaic tool; **102-channel HiPS all-sky cube (DR1, static, 12.9″ px)**; MOST (moving object search tool); Source Discovery Tool.
- **SPIFF** (Gagné+2026): Python spectrophotometry for *fast-moving* point sources in SPHEREx; 6,003 UCD spectra; templates; automated spectral typing (mocadb.ca).
- Expect most hackathon teams to build: TAP/SIA query → IRSA cutouts → GIF/flipbook + Aladin + Gaia overlay. **Nobody else will model the LVF.**
