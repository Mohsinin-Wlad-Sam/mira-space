# Credits and attribution

Everything MIRA shows or plays that the team did not make itself, with its source and the terms under which it is used.

## The film (`web/film/`, 29.0 seconds; photographed by `web/scripts/render_film.mjs`, sound by `web/scripts/film_score.py`)

| What | Source | Credit and terms |
|---|---|---|
| Music | "Time and Space" by Scott Buckley, www.scottbuckley.com.au. The stretch from 2:01 to 2:27: six quiet seconds, then the orchestra's entry, which the film puts on its title; it plays through the Lab and the whole sky and falls away over half a second at 26 seconds, as the picture fades, leaving a quiet reverberation added here | 'Time and Space' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au. On YouTube the composer asks for this line in the video description |
| Sound design | Made for the film from filtered noise and one low tone (`film_score.py --cut 5`): a breath of air into the orchestra's entry and a low note under it, a soft click when the time bar seats and at each stop of the years, the plotter drawing the spectrum | The team's own |
| The opening (0 to 6.5 s) | An artist's rendering, marked on screen as computer-generated with AI assistance: a dark frozen world and a brown dwarf beyond Neptune, with the far Sun behind dust. Computed ray by ray in the film's own page (`web/film/index.html`): the frozen world's relief is traced into its surface normals; the dust is marched with shadow rays toward the Sun, emission and absorption; rays that leave see NASA's SPHEREx all-sky picture, dimmed, as the far Milky Way, and a field of stars; the Sun gets the spikes and the streak a lens gives a point of light; four rays a pixel on the bodies; a film tone curve. At the end the light is split into its colours as the picture dissolves into the title | The team's own, made with an AI coding assistant; the only outside picture in it is NASA's SPHEREx all-sky panorama used as the background (NASA/JPL-Caltech, NASA/IPAC IRSA). It shows no real place and makes no claim |
| The Lab (9 to 22 s) | The running site in a frame, marked "live capture" down the side: NASA's real pictures of the field of Epsilon Indi B (2MASS 1999, WISE 2010, SPHEREx 2025 to 2026), the Lab's own time bar, tools and readings | Real data; every figure on screen is the instrument's own |
| The whole sky (22 to 26 s) | MIRA's SPHEREx panorama, made from NASA's SPHEREx all-sky cube, in Mollweide projection (galactic coordinates), with the 17,604 confirmed movers at their real places, each drawn along its measured motion, then the 635 that neither Gaia nor SIMBAD lists | Data: NASA/JPL-Caltech, NASA/IPAC IRSA; the team's measurements on NASA SPHEREx exposures |
| The look | A little film grain and a soft glow around the brightest lights, added over the whole film when it is encoded (ffmpeg) | The team's own |

The opening is the only synthetic picture in the film and carries its mark for as long as it is on screen. The film
does not show the Sky model's forecast (the one picture a network draws in the product, which carries its own
"AI-generated · prediction" label in the Lab).

**Music we were asked about and did not use.** Recordings from film scores (for example "Oppenheimer" or
"Interstellar") are commercial works: using them needs a licence the team does not have.

**Why no commercial music or film footage.** The Space Apps submission guide says: "If you are using any copyrighted
materials, make sure you have permission to use them." A credit line is not permission, and platforms mute or
block videos that carry commercial tracks. The film therefore uses only material whose licence already grants the
use: a Creative Commons track and the site's own pictures of NASA data.

## Data

| Data | Provider | Used for |
|---|---|---|
| SPHEREx Level-2 exposures; the DR1 all-sky data cube (HiPS) | NASA/JPL-Caltech; served by NASA/IPAC Infrared Science Archive (IRSA) | The Lab's pictures and measurements; the Sky map's SPHEREx pictures, composition layers and spectra |
| 2MASS (Two Micron All Sky Survey) | UMass and IPAC/Caltech, funded by NASA and NSF; HiPS by CDS, served by IRSA | The 1999 pictures and catalogue positions |
| WISE / AllWISE | NASA/JPL-Caltech/UCLA; HiPS by CDS, served by IRSA | The 2010 pictures and catalogue positions |
| Gaia DR3 | ESA/Gaia/DPAC | Star positions, motions and distances; the reference frame of every field |
| SIMBAD, VizieR, Aladin Lite, the HiPS standard | Centre de Données astronomiques de Strasbourg (CDS) | Names, catalogue queries, the close-look view |
| NASA Exoplanet Archive | NASA/Caltech IPAC | Stars with known planets on the 3D map |
| JPL Horizons; JPL approximate planetary elements (E. M. Standish) | NASA/JPL | The check of planet positions; the planets' orbits |
| UltracoolSheet | W. Best et al. | Known brown dwarfs |
| Planck all-sky map (3D map, far scales) | ESA/Planck Collaboration | The cosmic microwave background sphere |

## Software

three.js (MIT) · Aladin Lite (CDS) · Vite (MIT) · React (MIT) · TypeScript (Apache-2.0) · Astropy and astropy-healpix (BSD-3) ·
NumPy, SciPy (BSD-3) · PyTorch (BSD-3) · Pillow (HPND) · Playwright (Apache-2.0) and FFmpeg (LGPL/GPL), for rendering the film.

## Type and pictures

Barlow, Barlow Semi Condensed and JetBrains Mono (SIL Open Font License), from Google Fonts. Photographs on the
landing page: Unsplash (credits in the page footer). Planet textures in `web/public/space/tex/` are NASA maps (public domain): NASA 3D Resources (Mars, Jupiter, Saturn, Neptune), GIBS Blue Marble and VIIRS Black Marble (Earth), the SVS CGI Moon Kit (Moon).
Screenshots in the deck are of MIRA itself. Team photographs are the members' own.

## Models and AI tools

The assistant runs on K2 Horizon (Institute of Foundation Models). The sky world model was trained by the team
(`census/wm_train.py`). Every use of an AI tool in building MIRA is logged in `docs/07_si_usage_log.md`.

MIRA is not affiliated with or endorsed by NASA or any of the providers above.
