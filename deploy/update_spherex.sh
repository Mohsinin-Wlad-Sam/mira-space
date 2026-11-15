#!/bin/bash
# Bring MIRA up to date with the latest SPHEREx data release. Run on any machine with Python 3, astropy,
# astropy-healpix and scipy (about 4 GB of RAM; one minute once the inventory is downloaded), e.g. weekly from cron.
#   deploy/update_spherex.sh /path/to/site-root            # site-root is what the web server serves (contains data/)
# What it does: downloads IRSA's inventory of SPHEREx Level-2 exposures (TAP: spherex.plane + spherex.artifact),
# rebuilds the per-sky-patch exposure index and the dates of SPHEREx's visits to each part of the sky, and swaps them
# into place. No images are copied: the app reads those
# from NASA's archive.
set -euo pipefail
SITE=${1:?usage: update_spherex.sh <site-root>}
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK=${MIRA_WORK:-$HOME/.cache/mira}
mkdir -p "$WORK/web_data"
cd "$REPO"
python3 -m census.sphx_index2 --web "$WORK/web_data" --cache "$WORK/sphx_inventory.csv" --refresh --k "${MIRA_K:-24}"
# when SPHEREx imaged each part of the sky (the Sky map's "SPHEREx, live" layer), from the index just built
python3 -m census.sphx_coverage --web "$WORK/web_data"
mkdir -p "$SITE/data"
rsync -a --delete "$WORK/web_data/sphx2/" "$SITE/data/sphx2/"
python3 -c "import json;m=json.load(open('$SITE/data/sphx2/meta.json'));print('MIRA index now covers', m['exposures'], 'exposures through', m['last'])"
