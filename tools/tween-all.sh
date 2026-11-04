#!/usr/bin/env bash
# Adds in-between frames to the groom cycle of every character (see tween-sprites.py). The walk, trot
# and run are rigged instead (tools/rig-all.sh). Order after new sheets: build-sprites.py, patch-blink.py
# on each folder, this, then rig-all.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
T=tools/tween-sprites.py
for dir in src/playground/public/sprites/*/; do
  rm -f "$dir"*[0-9]t[0-9].webp
  $T "$dir" 2 loop groom1 groom2 groom3 groom4 groom5 groom6 groom7 groom8 groom9
done
