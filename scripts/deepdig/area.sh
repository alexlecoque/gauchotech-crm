#!/bin/zsh
# Usage: scripts/deepdig/area.sh <area-key> <scrape.csv>
# Deep-dig the unknown-POS shops of a scrape CSV, re-dig the scrape targets (finds moved pages), then verify every
# Square/Clover target live. Writes <scrape>-deepdig.csv, -deepdig-deepdig.csv and -deepdig-deepdig-verified.csv.
set -e
AREA=$1; CSV=$2
HERE=$(cd "$(dirname "$0")" && pwd)
P=$(cd "$HERE/../.." && pwd)
cd "$P"
echo "== dig unknowns $(date '+%H:%M')"
DIG_PORT=${DIG_PORT:-9411} caffeinate -dims node "$HERE/dig.mjs" "$CSV" "$AREA"
D1=${CSV%.csv}-deepdig.csv
echo "== dig targets $(date '+%H:%M')"
DIG_PORT=${DIG_PORT:-9411} caffeinate -dims node "$HERE/dig.mjs" "$D1" "$AREA" --verdicts new_target
D2=${D1%.csv}-deepdig.csv
echo "== verify $(date '+%H:%M')"
DIG_PORT=$(( ${DIG_PORT:-9411} + 1 )) caffeinate -dims node "$HERE/verify.mjs" "$D2" "$AREA"
echo "== done $(date '+%H:%M')"
