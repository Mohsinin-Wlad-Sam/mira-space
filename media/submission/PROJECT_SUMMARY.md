# MIRA in short (for the video)

**One line:** a public web observatory on NASA's SPHEREx: point at any place in the sky, watch 27 years of NASA pictures of it, see what moved, and measure it.

**The problem.** SPHEREx re-photographs the whole sky every six months in 102 infrared colours. Anything near the Sun that moves (cold brown dwarfs, a ninth planet if there is one) is in those pictures, but each is a 65 MB scientific file and nobody can look at them all. NASA asked for a public tool that plays any place through time.

| Part | What it does |
|---|---|
| Sky map | The whole sky on one time bar: 2MASS 1999, WISE 2010, SPHEREx filling in on its real dates, today. Sun, Moon and planets live; "My sky now". SPHEREx's 102 colours and what the sky is made of, with the spectrum under the pointer. Click anywhere to play that place as a little film |
| Lab | Picture in the centre, tools left, readings right, time bar below. Four answers for any place: what moved, how fast, what its light says, did it change |
| Lab tools | Field of view, Gaia/WISE overlays, NASA's flags, six detectors and 102 bands, Motion detector, Spectrograph, Photometer. Researcher set: Astrometer, Detection limits, every exposure, exports (FITS, CSV, Python, report), Watchlist, Sky model |
| Catalogue | 17,604 stars caught moving, each re-measured on raw SPHEREx exposures; 1,348 with no Gaia source; 635 in no reference database |
| AI | A model in the browser on any field; a scout that searched the whole sky; Meta's V-JEPA 2, fine-tuned; an assistant that explains and operates the page |
| Universe (3D) | The Sun's neighbourhood with live planets and real stars (not in the film) |
| For builders | API `/api/v1`, documentation, links and embeds, search that forgives typos |

**Proof.** Epsilon Indi B 4.70″/yr (Gaia 4.68); Barnard's Star 10.46 (10.39); WISE 0855 8.21 (published 8.15). Blind test: 92% of known movers found, no false alarm. 39.9 billion detections, 1.56 million claims, 202,528 re-measured, 17,604 confirmed. 1,628,230 exposures indexed. AI scout: of its 400 strongest new marks, 393 are known fast movers (Gaia or SIMBAD), 7 are not confirmed.

**Shots** (add `&embed=1` to hide the header, `&deck=1` to skip first-visit prompts)

| Shot | Address |
|---|---|
| The sky filling in | `/explore/#sky`, then "SPHEREx, day by day" |
| Drag the time bar 1999 to today | `/explore/#sky` |
| Every star caught moving | `/explore/#sky`, then "Stars caught moving" |
| A star crossing its field | `/explore/?target=barnard` or `?target=eps-indi-b`, press Play |
| Methane in its light | `/explore/?target=eps-indi-b&tool=spectrum` |
| The coldest brown dwarf | `/explore/?target=wise-0855&tool=motion` |
| The AI scout's marks | `/explore/#sky`, then "Marked by the sky model" |
| Search with a typo | type "barnad" |

**Story:** the sky is not still; here is a star that moved; its light says what it is; we found 17,604; anyone can do this.

**Rules:** 30 seconds or less, English, no NASA logo; an AI-drawn picture needs a visible mark (the only one is the Sky model's "Forecast").
