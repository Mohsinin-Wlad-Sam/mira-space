# Credits and attribution

Everything MIRA shows or plays that the team did not make itself, with its source and the terms under which it is used.

## The 30-second film (`web/film/`, rendered by `web/scripts/render_film.mjs`)

| What | Source | Credit and terms |
|---|---|---|
| Music | "Impact Prelude", Kevin MacLeod, incompetech.com. The stretch from 1:09 to 1:39, faded in and out and loudness-normalised | "Impact Prelude" Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0 License. http://creativecommons.org/licenses/by/4.0/ |
| Opening shot: the SPHEREx spacecraft in orbit (3.6 s) | "NASA's SPHEREx Prelaunch Media Reel", NASA ID `JPL-20250130-SPHERX-0001-SPHEREx_Media_Reel`, 0:29 to 0:33. https://images.nasa.gov/details/JPL-20250130-SPHERX-0001-SPHEREx_Media_Reel | Credit: NASA/JPL-Caltech. NASA describes the reel as "animations and b-roll for media and public use". No NASA logo or mission identifier appears in the excerpt; its use does not imply endorsement |
| Every other shot | Recorded from the running site | Real data (see below). The pictures drawn by the sky world model are AI-generated and carry a visible label |

**Why no commercial music or film footage.** The Space Apps submission guide says: "If you are using any copyrighted
materials, make sure you have permission to use them." A credit line is not permission, and platforms mute or
block videos that carry commercial tracks. The film therefore uses only material whose licence already grants the
use: a Creative Commons track and NASA's own media.

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
