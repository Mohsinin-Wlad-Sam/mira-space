# 14 · Deployment and data updates

MIRA is a static site plus one optional 40-line process. The browser talks to NASA's archive (SPHEREx Level-2 images
on the public `nasa-irsa-spherex` bucket; the 2MASS and WISE pictures of the same field from IRSA's HiPS tiles) and to
public catalogue services (CDS VizieR mirrors, SIMBAD). What we host
is the app, a small exposure index and the pre-computed, verified survey. The only server-side code is the
assistant's proxy, which holds the model key; without it everything else works and the assistant says it is offline.

## What is served

| Path | What | Size |
|---|---|---|
| `/`, `/explore/`, `/assets/` | landing page and app. First load of the app ≈ 120 kB of gzipped JavaScript; the Catalogue, Cases, the assistant and the 3D view are fetched in the background after the first paint, so moving between sections never waits | ~4 MB |
| `/data/sphx2/` | exposure index: one JSON per HEALPix nside-32 patch (12,288 files) + `meta.json`; and `coverage.json`, the dates of SPHEREx's visits to each patch (the Sky map's "SPHEREx, day by day") | 192 MB (≈ 56 MB gzipped); a field reads one ~15 kB file; `coverage.json` is 363 kB (88 kB gzipped) |
| `/data/verified/` | the verified catalogue: `objects.json` (confirmed movers), `changes.json`, `candidates.json`, `meta.json` (the funnel), `detector_validation.json` | 3.5 MB |
| `/data/space`, `/data/universe`, `/space`, `/live`, `/data/candidates.json`, `/data/neighbors.json` | 3D catalogues, textures, hourly NASA feeds | ~35 MB |
| `/validation.json` | result of the last engine validation run (shown on the Method page) | 4 kB |
| `/api/assistant` | optional proxy to the language model (see below) | — |
| `/api/answers` | optional, same process: visitors' answers on the map's unstudied objects, one line each in a file (`MIRA_ANSWERS_FILE`); no account, nothing about the visitor stored | grows by ~60 bytes per answer |

The older survey feeds (`/data/obj`, `/data/sky`, `/data/twins`, `movers.json` …, ~290 MB) are no longer used by the
app and need not be deployed.

## Deploy on a small instance (e.g. AWS Lightsail / EC2 t4g.micro, 1 GB RAM, ARM)

```bash
# on your machine
cd web && npm ci && npm run build            # -> web/dist (app + everything under public/)
rsync -az --delete web/dist/ user@host:/srv/mira/
rsync -azR web/server deploy user@host:/opt/mira/     # the API and the assistant (-R keeps web/server beside deploy)

# on the instance (Debian/Ubuntu): Caddy gives automatic HTTPS
sudo apt install -y caddy nodejs
sudo SITE_ADDRESS=mira.example.org MIRA_ROOT=/srv/mira caddy run --config /opt/mira/deploy/Caddyfile
```

`deploy/nginx.conf` is the equivalent for nginx, and `deploy/Dockerfile` packs Caddy, the built site and the proxy
into one container. Memory use is that of a static file server (tens of MB). The app must be allowed to be framed by
other sites (do not add `X-Frame-Options`): embedding is a feature. Both maps and the Lab work embedded
(`?embed=1` hides the header and adds one "Open in MIRA" link); in the app, More → "Copy code to embed it" writes
the `<iframe>` for the view on screen. The `allow="geolocation"` attribute in that snippet is only needed for
"My sky now", which asks the visitor's browser for a position and uses it inside the page.

The data under `web/public/data/` are in the repository since 15 November 2026 (about 510 MB): a clone is enough to
build and deploy. `web/sync_data.sh` refreshes them from the cluster.

### Sizing on the AWS free plan

| Item | Choice | Why |
|---|---|---|
| Instance | EC2 **t4g.small** (2 vCPU, 2 GB, Arm); t3.small if x86 is wanted | Static files and one Node process of about 40 MB. A t4g.micro (1 GB) is enough when the build is done elsewhere |
| Disk | **30 GB** gp3 | Site 0.7 GB (0.4 without the older feeds), the system, room for the index of the next releases |
| Network | One public IPv4 address; ports 80 and 443 open, 22 from your own address only | Caddy obtains the certificate once a domain name points at the address |
| System | Ubuntu 24.04 (arm64), Caddy, Node 20 or newer | No database |
| Optional | CloudFront in front | A first visit to both maps downloads about 40 MB; a cache keeps that off the instance |

Cost against the credits: about US$18 a month at list prices (instance about 12, disk 2.4, the address 3.7; the
first 100 GB a month sent out are free), so about US$110 over the plan's six months, inside the US$100 given at
sign-up plus part of the US$100 earned by the first tasks. With a t4g.micro, about US$12 a month. The prices are
the public us-east-1 list as we know them: check them in AWS's calculator before launching. Accounts opened after
15 July 2025 get the credits and a plan that ends after six months or when the credits run out; t4g.small,
t3.small, t4g.micro and t3.micro are among the instance types that plan allows
([AWS announcement](https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan),
[EC2 documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html)).

### Production as deployed (16 November 2026)

| Item | Value |
|---|---|
| Instance | EC2 `mira-prod`: **t4g.micro** (2 vCPU, 1 GB, Arm), Ubuntu 24.04, Paris (`eu-west-3a`). The build is done on a laptop, so 1 GB is enough. CPU credits are in `standard` mode: a very busy hour can slow it down, but it can never add a charge |
| Disk | 20 GB gp3, encrypted (3.6 GB used) |
| Address | fixed (Elastic IP): `15.224.146.58` |
| Open ports | 80 and 443 to everyone; 22 only from the laptop that deployed it (security group `mira-web`: change that one rule when your address changes) |
| Site | `/srv/mira` (20,494 files, 521 MB), served by Caddy with `deploy/Caddyfile` |
| API and assistant | `deploy/mira-api.service` (Node 22, user `mira`, on `127.0.0.1:8787`). Settings in `/etc/mira/mira.env`, which only root can read: the model key, `MIRA_DATA=/srv/mira/data`, `MIRA_API_STORE` and `MIRA_ANSWERS_FILE` under `/var/lib/mira`, and `MIRA_API_ADMIN`, made on the server (read it with `sudo grep MIRA_API_ADMIN /etc/mira/mira.env`) |
| Names it answers on | `SITE_ADDRESS` in `/etc/systemd/system/caddy.service.d/mira.conf`; Caddy obtains and renews the certificates |

Cost at Paris list prices (AWS price list, read on 16 November 2026): the instance US$0.0094 an hour (6.86 a month), the
disk 1.86, the address 3.65: **about US$12.40 a month**.

To publish a new build:

```bash
cd web && npm run build
rsync -az --delete -e "ssh -i ~/.ssh/mira-prod-eu-west-3.pem" dist/ ubuntu@15.224.146.58:/srv/mira/
# only when web/server or deploy changed:
cd .. && rsync -azR -e "ssh -i ~/.ssh/mira-prod-eu-west-3.pem" web/server deploy ubuntu@15.224.146.58:app/
ssh -i ~/.ssh/mira-prod-eu-west-3.pem ubuntu@15.224.146.58 'sudo rsync -a --delete app/ /opt/mira/ && sudo systemctl restart mira-api'
```

A domain name: at the registrar, two `A` records (the bare name and `www`) to `15.224.146.58`; then put both names in
`SITE_ADDRESS` and `sudo systemctl restart caddy`. The certificate arrives by itself within a minute.

### The data API (same process as the assistant)

`deploy/assistant-proxy.mjs` also answers `/api/v1/*` (`web/server/api.mjs`): cone search of the verified catalogue,
the SPHEREx exposures that hold a position, visit dates, the sky model's marks, a batch cross-match. It reads the
same files the site serves: start it with `MIRA_DATA=/srv/mira/data`. `MIRA_API_KEYS` (comma-separated) makes it ask
for a key; `MIRA_API_PER10MIN` sets the limit per address (300). Reference and a console: `/docs/#api`.

**Keys, credits and usage.** The same process hands out API keys and counts what each one uses
(`web/server/keys.mjs`; console at `/console/`). Set `MIRA_API_STORE` to a file the process can write (for example
`/srv/mira/api-keys.json`: it holds fingerprints of the keys, never the keys), and `MIRA_API_ADMIN` to a long secret
if you want to grant credits (`POST /api/v1/keys/{id}/credits` with the header `X-Admin-Key`). `MIRA_API_FREE_CREDITS`
(2,000), `MIRA_API_KEY_PER10MIN` (3,000) and `MIRA_API_NEW_KEYS_PER_DAY` (5 per address) set the allowances. With
`MIRA_API_KEYS` set, the API is closed to callers without a key and only the operator makes new ones. No payment
provider is connected: a key that runs out is refused (HTTP 402) until credits are granted. Check an installation
with `node web/scripts/test_api_keys.mjs`.

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
to 4,000 a day (`MIRA_LLM_PER10MIN`, `MIRA_LLM_DAILY`), and uses about 40 MB of memory. It answers browsers only
from its own site: the request's `Origin` must match the `Host` the reverse proxy passes on (Caddy does this by
itself; the nginx file sets `Host`), and other origins can be allowed with `MIRA_ALLOWED_ORIGINS` (comma-separated).
The client address used for the limit is taken from `X-Forwarded-For` only when the request comes from the local
reverse proxy. `MIRA_LLM_MAX_TOKENS` (4,000) covers the model's reasoning as well as its answer. Tested standalone
the way a reverse proxy calls it (site host, same-site origin, forwarded address); not yet tested on a public host. Any OpenAI-compatible endpoint
with tool calling works. During development the same handler runs inside the Vite dev server and reads
`web/.env.local` (ignored by git).

## Keeping up with SPHEREx data releases

SPHEREx releases new exposures weekly. MIRA needs only their *footprints*:

```bash
deploy/update_spherex.sh /srv/mira           # ~10 min to download IRSA's inventory, ~1 min to build the index
```

The script re-downloads the inventory through IRSA's TAP service, rebuilds `data/sphx2/` with
`census/sphx_index2.py`, derives `coverage.json` from it with `census/sphx_coverage.py` (when SPHEREx imaged each
part of the sky: what the Sky map plays between 2025 and today) and swaps both in. The Lab ("archive through …") and the Method page read the new date from
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
- The 1999 and 2010 pictures are optional: if IRSA's tiles cannot be read, the time bar keeps its markers and says
  that no picture exists for those dates.
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

On 14 Nov 2026 the full run (202,528 objects, 30 exposures each) took about 50 minutes on three 128-core nodes, at
up to 60 objects per second; it is limited by the network, not by computing.

## Checking that it still works

```bash
cd web && npm run dev &                      # or point the scripts at the deployed site
npx tsx scripts/validate_blink.mts           # the five challenge targets through the engine -> public/validation.json
npx tsx scripts/test_detect.mts              # the field detector on reference fields (prints what it finds)
npx tsx scripts/test_hips.mts                # the 2010 WISE picture against catalogue star positions (tile reading)
# the control run of the detector, Gaia known and blind (cluster or any machine; about 10 minutes on 6 processes
# once the catalogue answers are kept with --cats):
npx tsx scripts/validate_detector.mts fields.jsonl out.jsonl --data public/ --par 3 --cats cats/
python ../census/validate_summary.py out.jsonl --out public/data/verified/detector_validation.json
npm run build                                # type-check + production build
```
