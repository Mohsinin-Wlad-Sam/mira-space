# 10 · Submission draft (project page, 7 slides, 30-second video)

**The texts to paste, the files to upload and what to do if something goes wrong are in `media/submission/README.md`.**
This document is the longer working version.

Updated 15 Nov 2026 (two maps in one frame, live planets, SPHEREx's survey by date; impact first). Our own numbers come from `web/public/data/verified/meta.json` (the
verification funnel), `detector_validation.json` (blind control run), `web/scripts/test_detect.mts` (field detector)
and `web/public/validation.json` (engine validation); re-run them before submitting if the index has been
refreshed. Outside figures are sourced in section "Why it matters" below.

## Project page fields

**Project name:** MIRA — the sky is not still

**High-level summary (≈190 words)**
NASA's SPHEREx photographs the whole sky every six months in 102 colours of infrared light, and every image is
public. But one image is a 65-megabyte scientific file made for specialists. MIRA turns them into something anyone
can use, in the browser. The **Sky** map puts 27 years of NASA's all-sky pictures on one time bar (2MASS 1999, WISE
2010, SPHEREx filling in on its real dates), shows the planets where they are tonight over your own horizon, and
uses what only SPHEREx has: pictures of what the sky is made of (starlight, carbon dust, hydrogen) and the spectrum
of any patch under the pointer. **Space** is a 3D model of the Sun's neighbourhood where planets and stars move.
The **Lab** is the tool the challenge asks for: point at any place, play it through time like a little video, and
get four answers: what moved, how fast, what its light says, did it change. Tools open only when asked for; NASA's
five test targets open at once. Behind it is a catalogue of 17,604 moving stars, each re-measured on raw SPHEREx
exposures; world models (one runs in the browser, a scout searched the whole sky: 276 of its 400 strongest new finds
are confirmed by ESA's Gaia); a data API and full documentation. No install, no account.

**Link to project demo (choose one; both exist):**
- 30-second film: `media/mira_film_30s.mp4` in the repository (1080p, 24 pictures a second, 30.0 s; a 720p copy
  beside it). Upload it to YouTube or Drive with public access and paste that link. In the YouTube description put:
  'Time and Space' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au
- Seven slides: the deck at `⟨hosted URL⟩/deck/` (the product runs inside the slides), or its PDF `media/MIRA_deck.pdf`.

**Link to final project:** ⟨hosted URL⟩ · documentation ⟨hosted URL⟩/docs/ · repository github.com/Mohsinin-Wlad-Sam/assrar-dawla (must be public)

**Project details**

0. *Why it matters, and to whom.* SPHEREx cost about US$488 million (NASA/JPL press kit) and its data are public,
   but unusable without a research pipeline. MIRA makes them usable by four groups, in this order of size:
   - **Anyone curious**: two maps that run in a phone browser with no install or account. They answer what people
     ask of the sky (where are the planets tonight, what is above my horizon), show three NASA surveys of the whole
     sky on one time bar, and give each star caught moving a card in plain words with three real pictures to compare.
   - **Students and teachers**: a real-data lab for a classroom without a telescope. Students measure a star's
     motion on NASA's own images and check it against ESA's Gaia (ε Indi B: 4.70 against 4.68″ per year).
   - **Citizen scientists**: NASA's Backyard Worlds: Planet 9 showed what the public can do, with 150,000
     volunteers helping to find about 3,000 brown dwarfs by spotting moving dots in WISE images (NASA, 13 Jan
     2021). MIRA tries the same idea on its own catalogue: 635 confirmed movers with no Gaia source and no SIMBAD
     entry are one click away, with their pictures and three answer buttons. This is a prototype: an answer is recorded by the site's own small endpoint when it runs (no account, nothing about the visitor kept) and the card shows all visitors' tally; without that endpoint it stays on the device.
   - **Mission teams and science centres**: SPHEREx's survey played as it really advanced, from the dates of its
     1.6 million public exposures, and any view (a map or a Lab field) embedded on another page with one line.
   - **Researchers**: instruments on raw exposures for any field, a verified catalogue, exports.
   The cost of reaching all of them is that of a static website: the browser reads NASA's archive directly.
   What we will measure in a first pilot (one month, three classrooms and an open call): how many visitors open a
   card, how many answers are sent on the 635 objects, and on how many of them five or more visitors agree.
1. *The problem.* SPHEREx re-images the sky every six months in 102 infrared bands; nobody can look at it all.
   Existing blink tools stop at WISE. And SPHEREx is hard to blink: its pixels are 6″, it rolls between visits, and
   every exposure sees a different colour, so a constant star flickers and the eye cannot tell a mover from noise.
2. *What we built.* **Two maps in one frame**: highlights on the left, one time bar at the bottom, a card on the
   right. *Sky* is a flat map of the whole sky that pans and zooms like any map. Its time bar runs from 1999 to a
   year ahead: 2MASS fades into WISE, the stars caught moving in the WISE years appear, then SPHEREx's picture fills
   in place by place on the dates of its exposures (taken from the exposure index), each mover lighting up when
   SPHEREx reached it. The Sun, the Moon and the planets stand where they are on the date shown, live at "today"
   (JPL's orbital elements, within 8′ of JPL Horizons); "My sky now" shades what is below the visitor's horizon and
   says which planets are up and when the others rise. A slider goes through SPHEREx's 102 wavelengths, each read
   from NASA's archive when asked for. Any place opens a card that plays it as a little film: 2MASS, WISE, then each SPHEREx visit.
   *Space* is the Sun's neighbourhood in 3D out to the oldest light, whose sky is NASA's own SPHEREx all-sky
   picture; among the planets time runs in days, among the stars in millennia. On both, a click on a confirmed mover
   opens a film-style card tied to it by a target ring: what it is in plain words, its distance, how long it takes
   to cross a full Moon's width of sky, and three real pictures (2MASS about 1999, WISE 2010, and SPHEREx's own,
   read from NASA's archive on demand) on a slider with its measured path to today.
   **The Lab** (deep analysis, one click from every card): RA/Dec or a
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

**Questions we expect, and our answers**

- *Too niche?* The first screens are for everyone: tonight's planets and your own horizon, pictures, plain
  sentences, an assistant that explains on request.
  Researchers are the fourth audience, not the first.
- *Only a visualisation?* The pictures are the way in. Behind them are measurements with errors, checked against
  Gaia, and a catalogue made by re-measuring 202,528 claims on raw exposures.
- *Does it need a cluster?* No. A visitor needs a browser (a Lab field is 30–60 MB and 10–20 s; the measuring
  takes a fraction of a second on a laptop or phone). The cluster was used once for the survey; the verification
  itself runs on a laptop at about one object per second.
- *Explainable?* Sentence first, then picture, then number; a legend for every mark; "Explain it to me" on every
  card and every Lab panel.

**NASA data:** SPHEREx Level-2 spectral images and the SPHEREx all-sky cube (NASA/IPAC IRSA); unWISE time-domain catalogue,
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

**Use of Super Intelligence (SI) tools (text for the form):**
Yes. AI coding assistants (Claude Code; Codex and Antigravity as reviewers) wrote and reviewed most of the code,
text and layout under the team's direction; every use is logged in `docs/07_si_usage_log.md` with what was checked
afterwards. A language model (K2 Horizon) runs the in-product assistant: it explains and operates the page and is
restricted to numbers the instruments computed. A small neural network trained by the team (the "sky world model")
draws forecast pictures of a field: these are AI-generated and carry a visible "AI-generated · prediction" label in
the Lab. The film and the deck show no AI-generated picture: every shot is recorded from the running site on NASA
data; the film's music is "Time and Space" by Scott Buckley (CC BY 4.0). Two more networks only point at places
(a whole-sky "scout" trained by the team, and Meta's published V-JEPA 2, fine-tuned): their marks are checked against
ESA's Gaia catalogue and shown as what they are. The idea, the scientific choices and the validation are the team's.

## 7 slides (built: `web/deck/index.html`, served at `/deck/`)

Arrow keys or a clicker turn the slides; F goes full screen. Slides 1, 3 and 4 run the live product inside the slide.
Each slide is one statement and one picture; the detail is in the documentation.

1. **Title.** MIRA · The sky is not still. Team Mohsinin Wlad Dario, the five names, Ben Guerir, the challenge.
   Behind it the Sky map plays its 27 years.
2. **The challenge.** "The sky moves. Almost nobody can watch it." One sentence of what NASA asked; a real picture
   of a star that moved; 102 colours, 6 months, 27 years.
3. **The product: Sky.** Live in the slide. Three phrases.
4. **The product: Lab.** Live on Epsilon Indi B. Four questions; six of the challenge's tips ticked.
5. **Validity.** 17,604 confirmed · 92% found blind with no false alarm · 0.011″ a year · 276 of the AI scout's 400
   new finds confirmed by Gaia; the funnel; the scout's marks on the Sky map.
6. **Impact and plan.** Explorer (free), Researcher, Mission; US$150 a year; no customer yet.
7. **Next, and who we are.** Each data release re-runs the search; the team with affiliations (photos go in
   `web/public/deck/team/<first name>.jpg`); data and AI credits.

## 30-second film (built: `web/film/index.html`, rendered to `media/mira_film_30s.mp4`)

Five shots, each one the running site. No 3D scene, no AI-generated picture, fifteen words on screen before the name.

| t | Picture | Words on screen |
|---|---|---|
| 0–6 s | The Sky map alone: SPHEREx's survey filling the sky on its real dates, the camera moving in | none |
| 6–12.5 s | The Lab's picture of one place: Epsilon Indi B crossing its field, 1999 to 2026, in 2MASS, WISE and SPHEREx | the year · Epsilon Indi B · It moved. |
| 12.5–18.6 s | The Lab's Spectrograph drawing the object's SPHEREx spectrum | Methane · A brown dwarf. 12 light-years away. |
| 18.6–26 s | The Sky map with every confirmed mover, the camera moving back (the orchestra enters on the cut) | 17,604 · Stars caught moving |
| 26–30 s | The name | MIRA · The sky is not still · one credit line |

Photographed at 144 frames a second from the site, finished on our university's GPUs (`web/scripts/film_finish.py`):
24 pictures a second with a half-open shutter, lens glow, grain, black bars. Music: "Time and Space" by Scott Buckley,
CC BY 4.0, with sound design made for the film (`web/scripts/film_score.py`). Full credits: `docs/17_credits.md`.
