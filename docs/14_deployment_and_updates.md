# 14 · Deployment and data updates

MIRA is a static site. There is no application server, database or API key: the browser talks to NASA's archive
(SPHEREx Level-2 images on the public `nasa-irsa-spherex` bucket), to IRSA's HiPS maps, and to CDS catalogue mirrors.
What we host is the app, a small exposure index, and the pre-computed census feeds.

## What is served

| Path | What | Size |
|---|---|---|
| `/`, `/explore/`, `/assets/` | landing page and app (the app's first load is ~90 kB of gzipped JavaScript; the Aladin atlas, three.js and the Lab load only when opened) | ~4 MB |
| `/data/sphx2/` | exposure index: one JSON per HEALPix nside-32 patch (12,288 files) + `meta.json` | 192 MB (≈ 56 MB gzipped); a visit reads one ~15 kB file |
| `/data/obj`, `/data/sky`, `/data/twins`, `*.json` | census feeds for the atlas, dossiers and 3D view | ~290 MB |
| `/data/space`, `/data/universe`, `/space`, `/live` | 3D catalogues, textures, hourly NASA feeds | ~35 MB |
| `/validation.json` | result of the last validation run (shown on the About page) | 4 kB |

Total ≈ 0.6 GB on disk. Any static host works; file count (≈ 17,000) rules out some free tiers, so the reference
deployment is a small instance.

## Deploy on a small instance (e.g. AWS Lightsail / EC2 t4g.micro, 1 GB RAM, ARM)

```bash
# on your machine
cd web && npm ci && npm run build            # -> web/dist (app + everything under public/)
rsync -az --delete web/dist/ user@host:/srv/mira/

# on the instance (Debian/Ubuntu): Caddy gives automatic HTTPS
sudo apt install -y caddy
sudo SITE_ADDRESS=mira.example.org MIRA_ROOT=/srv/mira caddy run --config deploy/Caddyfile
```

`deploy/nginx.conf` is the equivalent for nginx, and `deploy/Dockerfile` packs Caddy and the built site into one
container. Memory use is that of a static file server (tens of MB). The app must be allowed to be framed by other
sites (do not add `X-Frame-Options`): embedding is a feature.

The census feeds under `web/public/data/` are not in git (they are produced on the cluster); `web/sync_data.sh`
pulls them. For a deployment without cluster access, copy `web/public/data/` from a machine that has them.

## Keeping up with SPHEREx data releases

SPHEREx releases new exposures weekly. MIRA needs only their *footprints*:

```bash
deploy/update_spherex.sh /srv/mira           # ~10 min to download IRSA's inventory, ~1 min to build the index
```

The script re-downloads the inventory through IRSA's TAP service, rebuilds `data/sphx2/` with
`census/sphx_index2.py` and swaps it in. The app header ("SPHEREx data through …") and the About page read the new
date from `meta.json`. Suggested cron entry on a machine with Python: `17 6 * * 2  /path/to/deploy/update_spherex.sh /srv/mira`.

Why an index at all? IRSA's TAP service answers a position query in 15–90 s and does not allow cross-origin
browser requests; the static index answers in one small file read and keeps the site serverless.

The hourly feeds for the atlas and 3D view (JPL Horizons, SBDB, SDO, EPIC, DONKI) are refreshed by
`scripts/live_fetch.py` (cron, hourly; optional `NASA_API_KEY`).

## Checking that it still works

```bash
cd web && npm run dev &                      # or point the script at the deployed site
npx tsx scripts/validate_blink.mts [https://your-site/]
```

runs the five challenge targets through the engine (network access to NASA's archive required), prints the
measured motions, flags and variability, and writes `public/validation.json`. If NASA changes a file layout, this is
where it shows first. Layouts are read from the FITS headers (header lengths, heap offsets, flag names), not assumed.

## If cross-origin access ever changes

Everything the app fetches from other origins is listed in `web/src/blink/engine.ts` (`S3`) and
`web/src/blink/catalogs.ts` (CDS mirrors). If NASA's bucket stopped sending CORS headers, a reverse-proxy rule on
the instance (`/s3/* -> https://nasa-irsa-spherex.s3.amazonaws.com/*`, Range passthrough) and a one-line change of
`S3` would restore service; the instance would then carry the image traffic (~0.4 MB per exposure viewed).
