# 10 · Submission draft (project page, 7 slides, 30-second video)

Updated 15 Nov 2026 (map-first, impact-first). Our own numbers come from `web/public/data/verified/meta.json` (the
verification funnel), `detector_validation.json` (blind control run), `web/scripts/test_detect.mts` (field detector)
and `web/public/validation.json` (engine validation); re-run them before submitting if the index has been
refreshed. Outside figures are sourced in section "Why it matters" below.

## Project page fields

**Project name:** MIRA — the sky is not still

**High-level summary (≈150 words)**
NASA's SPHEREx is photographing the whole sky in 102 infrared colours, and every image is public. But one image is
a 65-megabyte scientific file in which each pixel has a different colour: today only specialists can look at what
the public paid for. MIRA opens it to everyone. Its front door is a map of the Sun's neighbourhood where every
point is a real star at its real distance; the 12,329 orange ones were caught moving and confirmed, one by one, on
SPHEREx images. Click one and two NASA pictures taken eleven years apart show it move. Some are cold worlds that no
optical catalogue lists and nobody has named: anyone can look at them and report what they see, the way 150,000
volunteers found about 3,000 brown dwarfs with NASA's Backyard Worlds. One click deeper is the Lab the challenge
asks for: type any position, watch that field through time, and measure what moved, how fast and what it is.
No install, no account, no server.

**Link to project / demo:** ⟨hosted URL⟩ · repo: github.com/Mohsinin-Wlad-Sam/assrar-dawla

**Project details**

0. *Why it matters, and to whom.* SPHEREx cost about US$488 million (NASA/JPL press kit) and its data are public,
   but unusable without a research pipeline. MIRA makes them usable by four groups, in this order of size:
   - **Anyone curious** (about 6 billion people are online, ITU 2025): a map that runs in a phone browser, where
     each star has a card in plain words and real pictures that show it moving.
   - **Students and teachers**: a real-data lab for a classroom without a telescope. Students measure a star's
     motion on NASA's own images and check it against ESA's Gaia (ε Indi B: 4.70 against 4.68″ per year).
   - **Citizen scientists**: NASA's Backyard Worlds: Planet 9 showed what the public can do, with 150,000
     volunteers helping to find about 3,000 brown dwarfs by spotting moving dots in WISE images (NASA, 13 Jan
     2021). MIRA brings that task to SPHEREx: confirmed movers that nobody has named are one click away, with their
     pictures and three answer buttons (prototype: answers stay on the device until the visitor sends them).
   - **Researchers**: instruments on raw exposures for any field, a verified catalogue, exports.
   The cost of reaching all of them is that of a static website: the browser reads NASA's archive directly.
1. *The problem.* SPHEREx re-images the sky every six months in 102 infrared bands; nobody can look at it all.
   Existing blink tools stop at WISE. And SPHEREx is hard to blink: its pixels are 6″, it rolls between visits, and
   every exposure sees a different colour, so a constant star flickers and the eye cannot tell a mover from noise.
2. *What we built.* **The map** (first screen): the Sun's neighbourhood in 3D, out to the oldest light, with the
   confirmed movers marked. A click flies to a star and opens its card: what it is in plain words, its distance,
   how long it takes to cross a full Moon's width of sky, and two real pictures (2MASS about 1999, WISE 2010) on a
   slider with its measured path to today. **The Lab** (deep analysis, one click from every card): RA/Dec or a
   name in; out comes (a) **Evolution**, a time bar the user steers through three NASA pictures of the field
   (2MASS, WISE, then one deep SPHEREx image per visit); (b) the **Motion detector**, every source of the field
   judged moved, brighter, fainter, new or steady, with its significance and its Gaia identity; (c) the
   **Astrometer** (position against time, proper motion, parallax), **Spectrograph** (0.75–5 µm spectrum on the fly,
   methane detected automatically), **Photometer** (brightness against 1999 and 2010) and **Detection limits** (the
   planet or brown dwarf this field's depth would reveal). Field of view 3.3′–13′; Gaia and WISE overlays; NASA's
   pixel flags applied to every source; coordinates in the URL; embeddable; CSV, FITS and Python exports.
   **The catalogue** is the table behind the map, for those who want to filter, sort and export.
3. *How it works.* No server: a small index lists the exposures covering each patch of sky; the browser fetches the
   rows it needs from NASA's public bucket by HTTP Range (under 1 MB of a 65 MB file), registers them (TAN-SIP),
   decodes NASA's Rice-compressed flag table, and measures. Each visit is tied to Gaia with the field's own stars;
   "moved" needs 5σ against the scatter with which those stars are recovered.
4. *Does it work?* ε Indi B: +3.986, −2.486 ± 0.019″/yr (Gaia: +3.982, −2.467). Luhman 16, which has no Gaia
   motion, is linked to its 2010 and 1999 positions: −2.759, +0.362 (literature −2.75, +0.36). WISE 0855, tracked:
   −8.17, +0.75 ± 0.05 (published −8.12, +0.67). An empty field gives no detection. Blind test on 459 control fields
   (the stars under test removed from Gaia first, as for an object Gaia does not list): 199 of 216 known movers are
   flagged (92%), every one with the right motion, and none of 5,757 stationary stars is (false alarms below 0.05%).
   Against Astropy on the same file: positions to 0.004 px, flag masks bit for bit.
5. *The survey, verified.* 39.9 billion WISE detections (2010–2020) linked on a university cluster gave 1.56 million
   claims of motion or change. We re-measured 202,528 of them on raw SPHEREx exposures with the Lab's own engine:
   17,604 motions pass (away from the crowded Galactic plane 88% are known Gaia stars with the same motion: an
   independent check; in the plane the test fails and rows are hidden), 174 known L
   and T dwarfs recovered, 44 methane dips, and 17 brightness changes that hold against AllWISE — blazars, a Seyfert
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

1. **The sky is not still.** The map with its introduction card. One line: "NASA photographed the whole sky.
   MIRA lets anyone see what moves in it."
2. **The problem, for everyone.** A US$488 million mission whose public images only specialists can read: 65 MB
   files, 102 colours, never the same wavelength twice. Six billion people online, a few thousand who can use it.
3. **Click a star, watch it move.** The card of a brown dwarf no optical catalogue lists: two real NASA pictures,
   eleven years apart, its path to today, "18 light-years from the Sun".
4. **Take part.** NASA's own precedent: 150,000 volunteers, about 3,000 brown dwarfs. In MIRA: 36 confirmed movers
   on the map that nobody has named, with pictures and three answer buttons. A classroom can do it.
5. **One click deeper: the Lab.** ε Indi B: press play, three NASA pictures of the field follow one another and the
   brown dwarf walks along its dated track; "12 sources measured, 1 moved"; Astrometer (+3.99, −2.49″/yr against
   Gaia's +3.98, −2.47), Spectrograph with the methane band. "Read live from NASA's archives. No server."
6. **Verified, not just claimed.** The funnel: 39.9 billion → 1.56 million → 202,528 → 17,604. Blind control run:
   92% of known movers found without Gaia, no false alarm among 5,757 still stars. What failed the test is gone.
7. **Built to last, for everyone.** Static, free, embeddable, phone-ready; one script per data release; an
   assistant that explains and operates; who pays (grants for open science and education, work for archives and
   universities); limits; team.

## 30-second video (storyboard)

| t | Picture | Caption / voice |
|---|---|---|
| 0–5 s | The map: stars drifting as the time slider runs; the introduction card | "The sky is not still. NASA has photographed all of it. Almost nobody can look." |
| 5–12 s | Click "Show me one": fly to a brown dwarf; its card; the slider dragged from 1999 to 2010, the dot following the circle | "MIRA shows anyone a real star moving, in real NASA pictures." |
| 12–17 s | "Help look at one": an unnamed object, the three answer buttons | "Some of them nobody has named. You can help look, as 150,000 volunteers did for NASA." |
| 17–23 s | "Deep analysis": ε Indi B in the Lab, play pressed, the track growing; the Motion detector's table; the Astrometer plot | "One click deeper, instruments measure any place in the sky: what moved, how fast, what it is." |
| 23–26 s | Catalogue funnel and the blind-test line | "Every claim checked on NASA's raw images." |
| 26–30 s | Logo + URL | "MIRA. Find what moves." |
