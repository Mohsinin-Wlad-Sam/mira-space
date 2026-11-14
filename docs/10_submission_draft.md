# 10 · Submission draft (project page, 7 slides, 30-second video)

Updated 14 Nov 2026 for the rebuilt product. Numbers come from `web/public/validation.json` (engine validation run)
and `web/public/data/summary.json` (census); re-run `npx tsx web/scripts/validate_blink.mts` before submitting if the
index has been refreshed.

## Project page fields

**Project name:** MIRA — Watch the sky move

**High-level summary (≈150 words)**
Pluto was found by blinking two photographs of the same sky. MIRA lets anyone do that with NASA's SPHEREx. Type a
position or a name: in about fifteen seconds your browser finds every SPHEREx exposure that covers it, reads just
those pixels from NASA's public archive, lines the frames up on the sky and plays them as a movie. Because each
SPHEREx exposure sees a different wavelength, MIRA also turns the same frames into a spectrum, a light curve and a
measured motion for anything you click, with NASA's quality flags on every frame. There is no server and no sign-up,
so it costs almost nothing to run and stays current with each data release. Behind it sits a census linking 40 billion
WISE detections (2010–2020) to SPHEREx, shown as an all-sky atlas, a 3D map and a lab of experiments — from
"Could SPHEREx see Planet X?" to vetting brown-dwarf candidates no catalogue knows.

**Link to project / demo:** ⟨hosted URL⟩ · repo: github.com/Mohsinin-Wlad-Sam/assrar-dawla

**Project details**

1. *The problem.* SPHEREx re-images the sky every six months in 102 infrared bands; nobody can look at it all.
   Existing blink tools stop at WISE; existing SPHEREx tools are built for experts and show one product at a time.
   And SPHEREx is hard to blink: it rolls between visits, and every exposure sees a different colour, so a constant
   star flickers.
2. *What we built.* **Blink**: RA/Dec or a name in, a sky-registered movie out. Five ways to play it — in time order,
   in wavelength order, as deep stacks per visit (shift-and-add when following a known mover), as a colour composite
   of the six detectors, and as differences between visits. Gaia DR3 and AllWISE overlays at each frame's date.
   Field of view and number of exposures are the user's choice, with the download size stated. Every view is a URL
   and can be embedded.
3. *How it works.* A small index built from IRSA's inventory (1.6 million exposures) tells the browser which files
   cover a position. For each, two HTTP Range requests fetch the FITS header and only the detector rows needed
   (≈0.4 MB of a 65 MB file) from `s3://nasa-irsa-spherex`. The frames are resampled north-up using each exposure's
   TAN-SIP astrometry; the wavelength at each pixel comes from the linear-variable-filter map; the Rice-compressed
   FLAGS extension is decoded in the browser for the rows that matter.
4. *Measurements.* PSF-weighted photometry → spectrum on the fly (with 2MASS and WISE anchors; methane detected
   automatically). Brightness compared only between exposures of different visits at the same wavelength → light
   curves that do not confuse colour with change. Centroids → proper motion and, for the nearest objects, parallax.
   Stars that saturate are followed by their halo.
5. *Validated on the five challenge targets* (same code as the browser): ε Indi B moves +4.11 ± 0.17, −2.57 ± 0.17 ″/yr
   (Gaia: +3.98, −2.47) and is 82% fainter at 3.3 µm than at 4.0 µm (methane); WISE 0855 is seen only at 3.8–5 µm at
   0.57 mJy (WISE: 0.57 mJy), and typing its 2010 coordinates is recognised and followed to where it is now;
   Barnard's Star saturates in 121 of 121 exposures and is reported as such, moving +10.2 ± 0.4 ″/yr north
   (Gaia: +10.36); R Draconis brightened 10× at 0.75–1.1 µm in a year but only 1.2× at 2.4–3.9 µm; RW Aurigae faded
   1.9× at 4 µm. Against Astropy on the same file: positions to 0.004 pixel, flag masks bit for bit.
6. *The census and the atlas.* 40 billion WISE detections linked into objects with motions (4.0 million reliable),
   448 million measured again in SPHEREx's 102 colours; an AI ensemble estimates distance, temperature and kind
   (distance error 27% on held-out Gaia stars). A selection of cold, nearby, moving or methane-bearing objects
   recovers 125 known brown dwarfs and leaves 22 that are in no catalogue: candidates, for people to check in Blink.
7. *Benefits.* Students and volunteers get the method that found Pluto, on the newest NASA data; researchers get a
   15-second quick look, a batch tool for target lists, and exports; educators get a live demonstration. Limits are
   stated next to the claims.
8. *Tools.* TypeScript, Vite, Aladin Lite, three.js, uPlot (app); Python with Astropy, astropy-healpix, NumPy, SciPy,
   PyArrow, PyTorch (census, index); a university GPU cluster for the one-off census.

**NASA data:** SPHEREx Level-2 spectral images (NASA/IPAC IRSA, public cloud bucket) and all-sky maps (HiPS);
WISE/NEOWISE via the unWISE time-domain catalogue and AllWISE; JPL Horizons and SBDB; DONKI; EPIC; SDO; NASA
Exoplanet Archive; NED.

**Space agency partner data:** ESA Gaia DR3 (overlays, validation, 3D distances); ESA/Planck CMB map (3D view).

**Sustainability (business plan):** `docs/13_business_plan.md` — a static site with near-zero running cost; free for
users; funded by open-science and citizen-science grants with partner institutions, then by services to
observatories, planetariums and other surveys. No advertising, no tracking.

**References:** `docs/03_literature.md`; SPHEREx Explanatory Supplement (IRSA); Astropy Collaboration (2022);
Boch & Fernique, Aladin Lite; Gaia Collaboration (2023); Meisner et al. (2023); Cutri et al. (2013, AllWISE);
Skrutskie et al. (2006, 2MASS); Wenger et al. (2000, SIMBAD); Brown & Batygin (2021); Kirkpatrick et al. (2021);
CFITSIO Rice compression (Pence et al.). Photos on the landing page: Unsplash (credited in the footer).

**Use of AI tools:** `docs/07_si_usage_log.md` — AI coding assistants were used for development and review; every
scientific number shown was produced by our own code on NASA data and checked against independent references.

## 7 slides

1. **Watch the sky move.** Blink start screen. One line: "Type a position; get every SPHEREx pass as a movie." URL.
2. **The problem.** A billion sources, a new sky every six months, 102 colours. SPHEREx rolls, and every exposure is
   a different colour: naive blinking lies.
3. **Blink.** Screenshot of ε Indi B: movie, timeline coloured by wavelength, flags, spectrum with the methane dip.
   "15 seconds, 0.4 MB per exposure, straight from NASA's archive. No server."
4. **Measured, not just shown.** Three panels: spectrum with 2MASS/WISE anchors; R Draconis light curve by band;
   ε Indi B motion + parallax (vs Gaia).
5. **The five challenge targets.** The validation table; WISE 0855's 2010 coordinates recognised and followed.
6. **Beyond the tool.** Atlas (16 years of change), 3D, Lab: "Could SPHEREx see Planet X?", 22 candidates to vet.
7. **Built to last.** Static, free, embeddable, re-indexed in a minute per release; business plan in one table; limits; team.

## 30-second video (storyboard)

| t | Picture | Caption / voice |
|---|---|---|
| 0–4 s | Start screen; typing "08h55m10.83s −07d14m42.5s" | "Pluto was found by blinking two photos of the sky." |
| 4–9 s | The note "you entered where WISE 0855 was in 2010"; frames stream in | "MIRA does it with NASA's SPHEREx — for any spot, in seconds." |
| 9–15 s | ε Indi B movie → spectral sweep; the methane dip lights up in the spectrum | "Every exposure is a different colour. Together they are a spectrum." |
| 15–21 s | Motion tab: the track and the parallax swing; "12 light-years" | "Measure how it moves — and how far it is." |
| 21–26 s | Atlas zoom-out, 3D fly-through, Lab "Could SPHEREx see Planet X?" | "A census of sixteen years, a lab of questions." |
| 26–30 s | Logo + URL | "MIRA. Watch the sky move." |
