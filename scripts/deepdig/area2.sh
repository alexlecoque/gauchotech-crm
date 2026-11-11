#!/bin/zsh
# Usage: scripts/deepdig/area2.sh <area-key> <scrape.csv>  — area.sh plus the owner research step
set -e
AREA=$1; CSV=$2
HERE=$(cd "$(dirname "$0")" && pwd)
P=$(cd "$HERE/../.." && pwd)
cd "$P"
PORT=${DIG_PORT:-9411}
echo "== dig unknowns $(date '+%H:%M')"
DIG_PORT=$PORT caffeinate -dims node "$HERE/dig.mjs" "$CSV" "$AREA"
D1=${CSV%.csv}-deepdig.csv
echo "== dig targets $(date '+%H:%M')"
DIG_PORT=$PORT caffeinate -dims node "$HERE/dig.mjs" "$D1" "$AREA" --verdicts new_target
D2=${D1%.csv}-deepdig.csv
echo "== verify $(date '+%H:%M')"
DIG_PORT=$(( PORT + 1 )) caffeinate -dims node "$HERE/verify.mjs" "$D2" "$AREA"
echo "== owners $(date '+%H:%M')"
DIG_PORT=$(( PORT + 2 )) caffeinate -dims node "$HERE/owners.mjs" "${D2%.csv}-verified.csv" "$AREA"
echo "== done $(date '+%H:%M')"
