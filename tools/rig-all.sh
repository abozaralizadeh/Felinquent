#!/usr/bin/env bash
# Builds the walk, trot and run cycles of every character and writes the stride of each gait to
# src/playground/gaits.ts, so the player keeps the feet planted. Four-legged walkers are rigged from
# their standing drawing (tools/rig-gait.py); animals that hop (the rabbit, the squirrel) get their
# drawn hops placed on the ground (tools/hop-gait.py).
# Usage: tools/rig-all.sh [sprite dirs...]  (no dirs: all of them; the other rows of gaits.ts are kept)
# Run it after build-sprites.py (which rewrites stand.webp) and after any change to the rig tools.
set -euo pipefail
cd "$(dirname "$0")/.."
out=src/playground/gaits.ts
if [ $# -eq 0 ]; then set -- src/playground/public/sprites/*/; fi
rows=""
for dir in "$@"; do
  dir="${dir%/}/"
  id=$(basename "$dir")
  case "$id" in
    clover|hazel) tool=tools/hop-gait.py ;;
    *) tool=tools/rig-gait.py ;;
  esac
  rm -f "$dir"g[wtr][0-9][0-9].webp
  line=$($tool "$dir" 2>/dev/null | tail -1)
  echo "$line"
  rows+="$line"$'\n'
done
python3 - "$out" <<EOF
import json, re, sys
old = {}
try:
    for m in re.finditer(r"^  (\w+): \{ walk: ([\d.]+), trot: ([\d.]+), run: ([\d.]+) \},$", open(sys.argv[1]).read(), re.M):
        old[m.group(1)] = {"walk": float(m.group(2)), "trot": float(m.group(3)), "run": float(m.group(4))}
except FileNotFoundError:
    pass
for r in """$rows""".strip().splitlines():
    r = json.loads(r)
    old[r["id"]] = r["strides"]
lines = ["/**", " * Made by tools/rig-all.sh, do not edit. How far a planted foot travels in one cycle of each gait,", " * in sprite pixels, so the player can advance the cycle by distance walked and the feet do not slide.", " */", "export const GAIT_STRIDE: Record<string, { walk: number; trot: number; run: number }> = {"]
for cid in sorted(old):
    s = old[cid]
    lines.append(f'  {cid}: {{ walk: {s["walk"]}, trot: {s["trot"]}, run: {s["run"]} }},')
lines.append("};")
open(sys.argv[1], "w").write("\n".join(lines) + "\n")
print("wrote", sys.argv[1])
EOF
