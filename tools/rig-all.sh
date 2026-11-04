#!/usr/bin/env bash
# Builds the walk, trot and run cycles of every character from its standing drawing (tools/rig-gait.py)
# and writes the stride of each gait to src/playground/gaits.ts, so the player keeps the feet planted.
# Run it after build-sprites.py (which rewrites stand.webp) and after any change to rig-gait.py.
set -euo pipefail
cd "$(dirname "$0")/.."
out=src/playground/gaits.ts
rows=""
for dir in src/playground/public/sprites/*/; do
  rm -f "$dir"g[wtr][0-9][0-9].webp
  line=$(tools/rig-gait.py "$dir" 2>/dev/null | tail -1)
  echo "$line"
  rows+="$line"$'\n'
done
python3 - "$out" <<EOF
import json, sys
rows = [json.loads(r) for r in """$rows""".strip().splitlines()]
lines = ["/**", " * Made by tools/rig-all.sh, do not edit. How far a planted foot travels in one cycle of each gait,", " * in sprite pixels, so the player can advance the cycle by distance walked and the feet do not slide.", " */", "export const GAIT_STRIDE: Record<string, { walk: number; trot: number; run: number }> = {"]
for r in sorted(rows, key=lambda r: r["id"]):
    s = r["strides"]
    lines.append(f'  {r["id"]}: {{ walk: {s["walk"]}, trot: {s["trot"]}, run: {s["run"]} }},')
lines.append("};")
open(sys.argv[1], "w").write("\n".join(lines) + "\n")
print("wrote", sys.argv[1])
EOF
