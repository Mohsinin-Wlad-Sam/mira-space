# 10 · Submission draft (project page, 7 slides, 30-second video)

Updated 15 Nov 2026 for the instrument-based observatory. Numbers come from `web/public/data/verified/meta.json`
(the verification funnel), `web/scripts/test_detect.mts` (field detector) and `web/public/validation.json`
(engine validation); re-run them before submitting if the index has been refreshed.

## Project page fields

**Project name:** MIRA — a research observatory in the browser

**High-level summary (≈150 words)**
Planet X, if it exists, will be found the way Pluto was: as a faint dot that moved. NASA's SPHEREx photographs the
whole infrared sky every six months, but never twice at the same wavelength, so simply flipping its images shows
colour flicker, not motion. MIRA is a set of instruments that does the measuring. Type a position: your browser
reads every SPHEREx exposure of that field from NASA's archive, builds one deep image per visit, ties it to Gaia's
stars, compares each source with where the surveys of 2010 and 1999 saw it, and lists what moved, how surely, and
whether anyone knew — then gives its spectrum, its brightness history and what could still hide there. A time bar
lets you watch it happen at your own pace. Behind the instruments stands a survey of 39.9 billion WISE detections
whose 202,528 strongest claims we re-measured on raw SPHEREx exposures: 17,604 motions pass, and away from the
crowded Milky Way nearly nine in ten are stars Gaia already knows with the same motion — the rest are open to examine.

**Link to project / demo:** ⟨hosted URL⟩ · repo: github.com/Mohsinin-Wlad-Sam/assrar-dawla

**Project details**

1. *The problem.* SPHEREx re-images the sky every six months in 102 infrared bands; nobody can look at it all.
   Existing blink tools stop at WISE. And SPHEREx is hard to blink: its pixels are 6″, it rolls between visits, and
   every exposure sees a different colour, so a constant star flickers and the eye cannot tell a mover from noise.
2. *What we built.* **The Lab**: RA/Dec or a name in; out comes (a) **Evolution**, one deep image per visit on a
   time bar that reaches back to 1999, steered by the user; (b) the **Motion detector**, a table of every source in
   the field — moved, brighter, fainter, new or steady — with its significance and its Gaia identity; (c) the
   **Astrometer** (position against time, proper motion, parallax), **Spectrograph** (0.75–5 µm spectrum on the fly,
   methane detected automatically), **Photometer** (brightness against 1999 and 2010) and **Detection limits** (the
   planet or brown dwarf this field's depth would reveal). Field of view 3.3′–13′; Gaia and WISE overlays; NASA's
   pixel flags applied to every source; coordinates in the URL; embeddable; CSV, FITS and Python exports.
3. *How it works.* No server: a small index lists the exposures covering each patch of sky; the browser fetches the
   rows it needs from NASA's public bucket by HTTP Range (under 1 MB of a 65 MB file), registers them (TAN-SIP),
   decodes NASA's Rice-compressed flag table, and measures. Each visit is tied to Gaia with the field's own stars;
   "moved" needs 5σ against the scatter with which those stars are recovered.
4. *Does it work?* ε Indi B: +3.991, −2.496 ± 0.015″/yr (Gaia: +3.982, −2.467). Luhman 16, which has no Gaia
   motion, is linked to its 2010 and 1999 positions: −2.758, +0.364 (literature −2.75, +0.36). An empty field gives
   no detection. On 364 control fields: 170 of 173 cleanly measured Gaia movers are flagged (98%), none of 4,665
   stationary Gaia stars is. Against Astropy on the same file: positions to 0.004 px, flag masks bit for bit.
5. *The survey, verified.* 39.9 billion WISE detections (2010–2020) linked on a university cluster gave 1.56 million
   claims of motion or change. We re-measured 202,528 of them on raw SPHEREx exposures with the Lab's own engine:
   17,604 motions pass (away from the crowded Galactic plane 88% are known Gaia stars with the same motion: an
   independent check; in the plane the test fails and rows are hidden), 174 known L
   and T dwarfs recovered, 51 methane dips, and 17 brightness changes that hold against AllWISE — blazars, a Seyfert
   galaxy, a young star and the site of supernova 2022gzi. The lists that failed the test are not shown.
6. *An assistant that works the instruments.* "Open Luhman 16 and tell me how fast it moves": a language model
   (K2 Horizon) reads the numbers on the page and operates the Lab and the Catalogue through tool calls; the key
   stays on a 40-line proxy, and the panels remain the reference.
7. *Honest limits.* Blends within one 6″ pixel are flagged, not judged. SPHEREx alone sees motions above ~2.5″/yr;
   slower ones rest on the 2010 and 1999 positions. Planet Nine as proposed is below SPHEREx's depth: the limits
   panel says what each field excludes. Catalogue rows are confirmed motions, not discoveries.

**NASA data:** SPHEREx Level-2 spectral images (NASA/IPAC IRSA, public cloud bucket); unWISE time-domain catalogue,
AllWISE, CatWISE2020 (NASA WISE/NEOWISE); 2MASS; JPL Horizons, NASA Exoplanet Archive (3D view).

**Space agency partner data:** ESA Gaia DR3 (reference frame, validation, identities, distances); ESA Hipparcos;
ESA/Planck (3D view).

**Sustainability (business plan):** `docs/13_business_plan.md` — the public site is free because the browser reads
NASA's archive directly (running cost under US$150 a year); funding from grants and from institutions that want the
verification run or the instruments on their own data. New SPHEREx releases need one re-index script; users' cases
stay in their browser and export as files.

**References:** `docs/03_literature.md`; SPHEREx Explanatory Supplement (IRSA); Astropy Collaboration (2022);
Meisner et al. (2023, unWISE time-domain); Marocco et al. (2021, CatWISE2020); Gaia Collaboration (2023, DR3);
Skrutskie et al. (2006, 2MASS); Brown & Batygin (2021); Luhman (2013, 2014).

**Use of AI tools:** `docs/07_si_usage_log.md` — AI coding assistants were used for development and review, and a
language model runs the in-product assistant. Every scientific number shown is produced by our own code on NASA
data and checked against independent references; the assistant is told to use only those numbers.

## 7 slides

1. **Find what moves.** The Lab's start screen. One line: "Point at a field; the instruments tell you what moved."
2. **The problem.** A new sky every six months, 102 colours, 6″ pixels, never the same wavelength twice: flipping
   images shows flicker, not motion.
3. **The Lab.** ε Indi B: the Evolution view with the dated track from 1999 to 2026, and the Motion detector's
   table ("13 sources measured, 1 moved"). "Read live from NASA's archive. No server."
4. **Instruments.** Astrometer plot (27 years, +3.99, −2.50″/yr against Gaia's +3.98, −2.47); Spectrograph with the
   methane band; Detection limits.
5. **Verified, not just claimed.** The funnel: 39.9 billion → 1.56 million → 202,528 → 17,604; 81% known to Gaia;
   what failed the test is gone.
6. **An assistant that operates it.** One question, the Lab opens Luhman 16 and answers with the measured motion.
7. **Built to last.** Static, free, embeddable; one script per data release; who pays (grants, verification as a
   service, teaching); limits; team.

## 30-second video (storyboard)

| t | Picture | Caption / voice |
|---|---|---|
| 0–4 s | Start screen; typing "08h55m10.83s −07d14m42.5s" | "A planet nobody has seen would give itself away one way: it moves." |
| 4–10 s | ε Indi B: exposures stream in; the time bar dragged from 1999 to 2026, the orange track growing | "MIRA reads NASA's SPHEREx exposures and shows a field through time — at your pace." |
| 10–16 s | Motion detector table; row 1 "moved 4.7″ per year"; Astrometer plot | "It measures every source and tells you what moved, and how surely." |
| 16–21 s | Spectrograph with the methane band shaded | "Its spectrum says what it is: methane, a cold world." |
| 21–26 s | Catalogue funnel, then the assistant opening Luhman 16 | "A survey checked on raw NASA data, and an assistant that works the instruments." |
| 26–30 s | Logo + URL | "MIRA. Find what moves." |
