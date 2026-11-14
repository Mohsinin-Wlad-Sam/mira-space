# Live NASA data and the Lab

## Feeds
| feed | used for | access |
|---|---|---|
| NASA DONKI CME analyses | solar storms as expanding fronts in 3D (speed, direction, width) | browser-direct (CORS), static fallback |
| NASA NeoWs | asteroids passing Earth today | browser-direct (CORS), static fallback |
| NASA Image and Video Library | photos in planet / spacecraft / live-object cards | browser-direct (CORS) |
| JPL Horizons | heliocentric tracks of 13 spacecraft, ±60 days | static, refreshed by `scripts/live_fetch.py` |
| JPL CAD + SBDB | asteroids within 0.05 au of Earth in the next 60 days, with orbits | static |
| NASA SDO (HMI continuum) | today's Sun on the 3D Sun's Earth-facing side | static (no CORS on images) |
| NASA EPIC (DSCOVR) | latest Earth photo on the 3D Earth's sunlit side | static (no CORS on images) |
| NASA Exoplanet Archive | 4,834 planetary systems (`census/exoplanets.py`) | static, refresh occasionally |

## Refresh
Hosting stays static. Run hourly (cron, GitHub Actions, or a Cloudflare scheduled job) before/at deploy:

    NASA_API_KEY=<free key from api.nasa.gov> python3 scripts/live_fetch.py --out web/public/live

`DEMO_KEY` works but is limited to ~30 requests/hour per IP (visitors' browsers each have their own quota; the static copy covers them when it runs out).
Output: `web/public/live/{live.json, sun_hmi.jpg, sun_171.jpg, earth.jpg}` ≈ 0.7 MB.

## Lab (3D Space → Lab, or the map's Lab button)
Tests on the loaded catalogue: HR diagram (brush to show those objects in 3D), age–velocity relation (dwarfs < 50 pc:
median tangential speed rises from ~34 km/s for the hottest to ~53 km/s for the coolest), reach of Gaia vs AI distances,
solar apex from the median 3D velocity of neighbours < 50 pc (measured l = 56°, b = 16° vs the classic apex 56°, 23°).
Simulations: probe intercept of a moving star (exact quadratic intercept, straight-line stellar motion);
N-body flyby of a visiting star through the Solar System (leapfrog, G = 4π² au³/yr²/M☉, 0.01-yr steps, Sun + Earth, Mars, 4 giants).
