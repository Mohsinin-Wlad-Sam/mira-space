# 14 · Deployment and data updates

MIRA is a static site plus one optional 40-line process. The browser talks to NASA's archive (SPHEREx Level-2 images
on the public `nasa-irsa-spherex` bucket) and to public catalogue services (CDS VizieR mirrors, SIMBAD). What we host
is the app, a small exposure index and the pre-computed, verified survey. The only server-side code is the
assistant's proxy, which holds the model key; without it everything else works and the assistant says it is offline.

## What is served

| Path | What | Size |
|---|---|---|
| `/`, `/explore/`, `/assets/` | landing page and app. First load of the app ≈ 120 kB of gzipped JavaScript; the Catalogue, Cases, the assistant and the 3D view are fetched in the background after the first paint, so moving between sections never waits | ~4 MB |
| `/data/sphx2/` | exposure index: one JSON per HEALPix nside-32 patch (12,288 files) + `meta.json` | 192 MB (≈ 56 MB gzipped); a field reads one ~15 kB file |
| `/data/verified/` | the verified catalogue: `objects.json` (confirmed movers), `changes.json`, `candidates.json`, `meta.json` (the funnel), `detector_validation.json` | 3.5 MB |
| `/data/space`, `/data/universe`, `/space`, `/live`, `/data/candidates.json`, `/data/neighbors.json` | 3D catalogues, textures, hourly NASA feeds | ~35 MB |
| `/validation.json` | result of the last engine validation run (shown on the Method page) | 4 kB |
| `/api/assistant` | optional proxy to the language model (see below) | — |

The older survey feeds (`/data/obj`, `/data/sky`, `/data/twins`, `movers.json` …, ~290 MB) are no longer used by the
app and need not be deployed.

## Deploy on a small instance (e.g. AWS Lightsail / EC2 t4g.micro, 1 GB RAM, ARM)

```bash
# on your machine
cd web && npm ci && npm run build            # -> web/dist (app + everything under public/)
rsync -az --delete web/dist/ user@host:/srv/mira/
rsync -az web/server deploy user@host:/opt/mira/      # only needed for the assistant

# on the instance (Debian/Ubuntu): Caddy gives automatic HTTPS
sudo apt install -y caddy nodejs
sudo SITE_ADDRESS=mira.example.org MIRA_ROOT=/srv/mira caddy run --config /opt/mira/deploy/Caddyfile
```

`deploy/nginx.conf` is the equivalent for nginx, and `deploy/Dockerfile` packs Caddy, the built site and the proxy
into one container. Memory use is that of a static file server (tens of MB). The app must be allowed to be framed by
other sites (do not add `X-Frame-Options`): embedding is a feature.

The data under `web/public/data/` are not in git (they are produced on the cluster); `web/sync_data.sh` pulls them.
For a deployment without cluster access, copy `web/public/data/` from a machine that has them.

### The assistant (optional)

```bash
# the key lives in a root-only env file, never in the repository or in the built site
sudo install -m 600 /dev/stdin /etc/mira.env <<'EOF'
MIRA_LLM_KEY=<key of an OpenAI-compatible endpoint>
MIRA_LLM_URL=https://api.ifm.ai/v1
MIRA_LLM_MODEL=IFM/K2-Horizon-375B-A23B
EOF
sudo systemd-run --unit mira-assistant --property EnvironmentFile=/etc/mira.env node /opt/mira/deploy/assistant-proxy.mjs
```

Caddy / nginx forward `/api/*` to `127.0.0.1:8787`. The proxy owns the instructions and the list of tools, accepts
only the conversation and a snapshot of the page, limits each address to 40 calls per 10 minutes and the whole site
to 4,000 a day (`MIRA_LLM_PER10MIN`, `MIRA_LLM_DAILY`), and uses about 40 MB of memory. Any OpenAI-compatible endpoint
with tool calling works. During development the same handler runs inside the Vite dev server and reads
`web/.env.local` (ignored by git).

## Keeping up with SPHEREx data releases

SPHEREx releases new exposures weekly. MIRA needs only their *footprints*:

```bash
deploy/update_spherex.sh /srv/mira           # ~10 min to download IRSA's inventory, ~1 min to build the index
```

The script re-downloads the inventory through IRSA's TAP service, rebuilds `data/sphx2/` with
`census/sphx_index2.py` and swaps it in. The Lab ("archive through …") and the Method page read the new date from
`meta.json`; saved cases show a "new data" badge. Suggested cron entry on a machine with Python:
`17 6 * * 2  /path/to/deploy/update_spherex.sh /srv/mira`.

Why an index at all? IRSA's TAP service answers a position query in 15–90 s and does not allow cross-origin
browser requests; the static index answers in one small file read and keeps the site serverless.

### What adapts by itself when NASA's files or services change

- FITS header lengths, the position of the FLAGS table, flag names and bit positions, the PSF width and the pipeline
  version are read from each exposure; nothing about them is hard-coded per release.
- Release and week folders come from the index (`roots`), so a new data release needs no code change.
- Catalogue queries go to three VizieR mirrors in turn, are retried once, and a failure is reported in the panel
  ("Gaia not reachable: positions are uncalibrated") instead of breaking the page.
- The assistant's endpoint, model and limits are environment variables.

## Re-verifying the survey (cluster, optional)

The verified catalogue is produced once and is static. After a major SPHEREx release it can be refreshed:

```bash
python -m census.verify_select  --workers 72                       # every survey-level claim -> verify/cands.parquet
python -m census.verify_lists                                      # work lists A (priority), B (motions), C (samples)
node_modules/.bin/tsx scripts/verify_census.mts in/A.part00 out/A_00.jsonl --data pub/ --par 20 --frames 30   # per shard; restart-safe
python census/verify_merge.py --dir <dir with verified_raw.parquet, gaia_hpm_union.csv, cats.jsonl, gaia_cone.jsonl>
npx tsx scripts/candidates_report.mts                              # the candidates through the Lab's own detector
```

On 14 Nov 2026 the full run (202,548 objects, 30 exposures each) took about 50 minutes on three 128-core nodes, at
up to 60 objects per second; it is limited by the network, not by computing.

## Checking that it still works

```bash
cd web && npm run dev &                      # or point the scripts at the deployed site
npx tsx scripts/validate_blink.mts           # the five challenge targets through the engine -> public/validation.json
npx tsx scripts/test_detect.mts              # the field detector on reference fields (prints what it finds)
npm run build                                # type-check + production build
```
