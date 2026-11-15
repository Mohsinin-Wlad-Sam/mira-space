# MIRA · submission pack (NASA Space Apps 2026, Planet X and SPHEREx)

Everything the project page needs, ready to paste or upload. Team **Mohsinin Wlad Dario**, local event Ben Guerir.

Deadline: Sunday 15 November 2026, 23:59 in the local event's time (Morocco). Check the countdown on the team page.

## 1. What to do, in order

| # | Step | Who | State |
|---|---|---|---|
| 1 | Make the repository public: GitHub → Settings → General → Danger zone → Change visibility (or `gh repo edit Mohsinin-Wlad-Sam/assrar-dawla --visibility public --accept-visibility-change-consequences`) | repository owner | **to do** |
| 2 | Choose a licence and add `LICENSE` (MIT or Apache-2.0 are the usual ones for a Space Apps project) | team | **to do** |
| 3 | Upload `media/mira_film_30s.mp4` to YouTube (Public or Unlisted) or Drive (anyone with the link). Title, description and thumbnail are in section 4 | any member | **to do** |
| 4 | Host the site (the Deploy section of `/docs/`, or `docs/14_deployment_and_updates.md`). Optional: without it, the project link is the repository | any member | optional |
| 5 | Paste the texts of section 3 into the project page; add the links | team owner | **to do** |
| 6 | Team photos into `web/public/deck/team/<mohammed|hamza|hiba|aya|abdelmonaim>.jpg`, then `node web/scripts/deck_pdf.mjs --out media/MIRA_deck.pdf` | team | optional |

## 2. Files

| File | What | Use |
|---|---|---|
| `media/mira_film_30s.mp4` | The film: 1080p, 24 pictures a second, **29.9 s** (the limit is 30), 63 MB | The demo link (upload it) |
| `media/mira_film_30s_small.mp4` | The same at 720p, 10 MB | When the upload is slow |
| `media/MIRA_deck.pdf` | Seven slides | The other allowed demo; also for a live talk |
| `media/submission/cover_1920x1080.jpg` | Title with the team's names | Project image |
| `media/submission/video_thumbnail_1280x720.jpg` | "17,604 stars caught moving" | YouTube thumbnail |
| `media/submission/screens/01…09` | The Sky map, the Lab, a star that moved, its spectrum, the 17,604 movers, the AI scout, the API, the landing page, the sky model | Pictures for the project page |

## 3. Texts for the project page

**Project name**

MIRA — The sky is not still

**High-level summary**

NASA's SPHEREx photographs the whole sky every six months in 102 colours of infrared light. The images are public,
but each is a 65-megabyte scientific file made for specialists. MIRA makes them something anyone can use in a
browser. Point at any place in the sky and it plays 27 years of NASA pictures of that place as a little film (2MASS
in 1999, WISE in 2010, then every SPHEREx visit), so that what moved is easy to spot. The Lab then measures it: how
fast it moves, what its light says it is, whether its brightness changed, each with its error and checked against
ESA's Gaia. A Sky map puts the whole survey on one time bar, with tonight's planets. Behind it are a catalogue of
17,604 moving stars, each re-measured on raw SPHEREx exposures; an AI scout that searched the whole sky, of whose
400 strongest new finds 362 are fast-moving stars that Gaia or SIMBAD already list; a data API; and full documentation. NASA's five test targets
open at once. No install, no account.

**Link to project demo**

`<link of the uploaded film>` (30-second video, English text on screen)

**Link to final project**

`<hosted address>` · code: https://github.com/Mohsinin-Wlad-Sam/assrar-dawla · documentation: `<hosted address>/docs/`

**Detailed project description**

*The problem.* SPHEREx re-images the sky every six months in 102 infrared bands. Anything near the Sun that moves is
in those pictures: cold brown dwarfs, and a ninth planet if there is one. But nobody can look at it all, existing
blink tools stop at WISE, and SPHEREx is hard to blink: its pixels are 6 arcseconds, the spacecraft rolls between
visits, and every exposure sees another colour.

*What we built.* (1) **The Lab**, the tool the challenge asks for. A name or a position in; out comes one time bar
through real pictures of that field (2MASS, WISE, one deep SPHEREx image per visit) and four answers: what moved,
how fast, what its light says, did it change. The picture stays in the centre; tools open when asked for: field
of view, Gaia and WISE overlays, NASA's flags, the 102 bands and six detector co-adds, spectra on the fly, dates in
and out, links and embeds, CSV, FITS and Astropy exports. (2) **The Sky map**: 27 years of NASA's all-sky pictures
on one time bar, SPHEREx filling in on its real dates, the planets where they are tonight. (3) **A verified
catalogue**: 39.9 billion WISE detections gave 1.56 million claims of motion; 202,528 were re-measured on raw
SPHEREx exposures; 17,604 motions are confirmed. (4) **World models**: a small network forecasts a field in the
browser; a scout trained on our university's GPUs looked at the whole sky three times and marked 3,801 places;
Meta's V-JEPA 2, fine-tuned on our confirmed movers, gives a second opinion. (5) **An API and documentation**, so
that others can build on it.

*How it works.* The browser reads NASA's archive directly: a small index says which exposures hold a position, and
only the needed part of each 65 MB file is fetched. Each visit is tied to Gaia by the field's own stars; "moved"
needs five sigma against the scatter with which those stars are recovered.

*Does it work?* Epsilon Indi B: 4.70 ± 0.02 arcseconds a year (Gaia: 4.68). Barnard's Star: 10.46 ± 0.05 (Gaia:
10.39). WISE 0855: 8.21 ± 0.05 (Kirkpatrick et al. 2021: 8.15). In a blind test on 459 fields the detector found
92% of known movers and raised no false alarm among 5,757 still stars. Of the 400 strongest places the AI scout
marked where our catalogue had nothing, 276 are fast-moving stars in Gaia DR3 and 86 more are in SIMBAD; 38 are in
neither and stay open.

*Who it is for.* Anyone curious (tonight's planets, any place as a film); classrooms (measure a star on NASA's own
images and compare with Gaia); volunteers (635 confirmed movers that no reference database names); researchers and
agencies (the fit with its errors, exports, lists of targets, the API, verification runs at each data release).
The public site is free: it costs about US$150 a year to run.

*Honest limits.* Blends within one 6-arcsecond pixel are flagged, not judged. SPHEREx alone sees motions above about
2.5 arcseconds a year; slower ones rest on the 2010 and 1999 positions. Planet Nine as proposed is too faint for
one SPHEREx field: the Detection limits tool says what each field excludes. A mark of the scout is a place to look
at, not a discovery.

**NASA data and resources**

- SPHEREx Level-2 spectral images (public bucket `nasa-irsa-spherex`) and the SPHEREx all-sky data cube, NASA/IPAC IRSA: https://irsa.ipac.caltech.edu/Missions/spherex.html
- IRSA SPHEREx tutorials: https://caltech-ipac.github.io/irsa-tutorials/spherex/
- 2MASS all-sky images and point-source catalogue (IRSA)
- WISE / AllWISE images and catalogue, unWISE time-domain catalogue, CatWISE2020 (IRSA)
- NASA JPL Horizons (check of the planets' positions) and JPL approximate planetary elements: https://ssd.jpl.nasa.gov/horizons/
- NASA Exoplanet Archive: https://exoplanetarchive.ipac.caltech.edu/
- Backyard Worlds: Planet 9 and WiseView (the precedent): http://byw.tools/wiseview

**Space agency partner and other data**

- ESA Gaia DR3 (reference frame of every field, validation, identities, distances), through CDS VizieR and SIMBAD
- ESA Planck all-sky map (far scale of the 3D view)
- CDS Strasbourg: SIMBAD, VizieR, Aladin Lite, the HiPS standard
- Software: Astropy, NumPy, SciPy, PyTorch (pipeline and training); three.js, Vite, React (site)
- V-JEPA 2 (Meta, open weights `facebook/vjepa2-vitl-fpc64-256`), fine-tuned on our examples
- Music of the film: 'Time and Space' by Scott Buckley, released under CC-BY 4.0, www.scottbuckley.com.au

**Use of AI**

Yes. AI coding assistants (Claude Code; Codex and Antigravity as reviewers) wrote and reviewed most of the code,
text and layout under the team's direction; every use is logged in `docs/07_si_usage_log.md` with what was checked
afterwards. A language model (K2 Horizon) runs the in-product assistant: it explains and operates the page and is
restricted to numbers the instruments computed. A small network trained by the team draws forecast pictures of a
field: these are AI-generated and carry a visible "AI-generated · prediction" label in the Lab. The film and the
slides show no AI-generated picture: every shot is recorded from the running site on NASA data. Two more networks
only point at places (a whole-sky scout trained by the team, and Meta's V-JEPA 2, fine-tuned): their marks are
checked against ESA's Gaia catalogue and shown as what they are. The idea, the scientific choices and the
validation are the team's. No NASA logo or mission identifier is used.

## 4. The video on YouTube

- **Title:** MIRA — The sky is not still (NASA Space Apps 2026, Planet X and SPHEREx)
- **Description:**

  ```
  Point at any place in the sky, watch 27 years of NASA pictures, see what moved.
  MIRA is team Mohsinin Wlad Dario's project for the NASA Space Apps Challenge 2026, "Planet X and SPHEREx".
  Every shot is recorded from the running site on real data: NASA SPHEREx, 2MASS and WISE (NASA/IPAC IRSA), ESA Gaia.
  Project: <hosted address>   Code: https://github.com/Mohsinin-Wlad-Sam/assrar-dawla

  Music: 'Time and Space' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au
  Not affiliated with or endorsed by NASA.
  ```
- **Thumbnail:** `media/submission/video_thumbnail_1280x720.jpg`
- **Visibility:** Public or Unlisted (both open without an account). Not "Private".
- The composer asks for the music line in the description; without it YouTube may show a claim.

## 5. If something goes wrong

| If | Then |
|---|---|
| The site is not hosted in time | The project link is the repository; the demo link is the film. Both are allowed. Judges can run the site with `cd web && npm ci && npm run dev` once the data pack is in `web/public/data/` (it is attached to the repository's release) |
| YouTube refuses or delays the video | Put `media/mira_film_30s_small.mp4` on Google Drive, "anyone with the link"; or use the film's address in the repository's release once the repository is public |
| The repository cannot be made public in time | `git archive -o mira_source.zip HEAD`, put the zip, the film and `media/MIRA_deck.pdf` in one public Drive folder, and give that folder as the project link |
| The video is questioned | Use the seven slides instead: `media/MIRA_deck.pdf` on Drive, or `<hosted address>/deck/` |
| A live presentation happens after all | `media/MIRA_deck.pdf` works with no network. Live: `cd web && npx vite preview --port 4173`, then `http://127.0.0.1:4173/deck/` (arrow keys, F for full screen); NASA's five targets open from prepared copies |
| The assistant says it is offline | It needs `MIRA_LLM_KEY` on the host. Everything else works without it |

## 6. Before pressing Submit

- [ ] The demo link opens in a private window, without signing in
- [ ] The video is 30 seconds or less (this one: 29.9 s) and in English
- [ ] The project link opens in a private window
- [ ] The summary and the description are pasted; the AI statement is pasted
- [ ] NASA data and partner data are listed
- [ ] No NASA logo anywhere; "not affiliated with NASA" is on the site (it is, in the footer and the documentation)
