#!/usr/bin/env bash
# Makes every in-between frame of every character: flow in-betweens between drawings that follow each
# other (tween-sprites.py) and licks made by nodding one drawing (nod-sprites.py). The walk, trot and
# run are rigged instead (tools/rig-all.sh). Order after new sheets: build-sprites.py, patch-blink.py
# on each folder, this, then rig-all.sh. src/playground/sprites.ts plays them.
set -euo pipefail
cd "$(dirname "$0")/.."
T=tools/tween-sprites.py
N=tools/nod-sprites.py
A=tools/align-base.py
# Every character, or only the sprite folders given (several can run at once, one per folder).
dirs=("$@")
[ ${#dirs[@]} -eq 0 ] && dirs=(src/playground/public/sprites/*/)
for dir in "${dirs[@]}"; do
  dir="${dir%/}/"
  id=$(basename "$dir")
  # Everything this script makes, so a shorter chain leaves nothing stale behind.
  rm -f "$dir"*[0-9]t[0-9].webp "$dir"groom[0-9][un][0-9].webp "$dir"{stand,sit,sit2,sitting_down,knead_a,knead_b,lowering,loaf2,drowsy,curl,waking,wake,presneeze}[tvdlfm][0-9].webp

  # First line up the sitting drawings on their feet and haunches, so the body does not slide while
  # a paw moves (washing, the ear scratch, the faces seen from the side like the sit). The faces drawn
  # from another side (proud, annoyed, flustered, giggle, love) fade in from the sit and stay as they
  # are. The wash and the scratch are one body all through, so they all move (a lower bar: a paw or a
  # leg in the air covers some of the base). The scratch lines up on its own first drawing.
  $A "$dir" sit blink meow yawn lookup curious joy surprise
  $A "$dir" sit groom1 groom2 groom3 groom4 groom5 groom6 groom7 groom8 groom9 scratch1 --min-iou 0.6
  $A "$dir" scratch1 scratch2 scratch3 scratch4 scratch5 scratch6 scratch7 scratch8 scratch9 --min-iou 0.6
  # Sitting down after a walk and standing up start and end on the standing body, so line those two
  # drawings up on it (they are a different pose, hence the low bar).
  $A "$dir" stand sitting_down stand2 --min-iou 0.4

  # Grooming: the nine regions in order (one link each way round), then the extra links a wash
  # needs: from the cheek back to the paw, and (the puppy does not wash its face) from the paw to the nose.
  $T "$dir" 2 loop groom1 groom2 groom3 groom4 groom5 groom6 groom7 groom8 groom9
  $T "$dir" 2 once groom5 groom2 --tag u
  $T "$dir" 2 once groom2 groom6 --tag u
  # Licks: one drawing nodding onto the paw, the chest and the leg, and a smaller one at the nose.
  top8=0.6
  case $id in tabby | inky | pearl) top8=0.42 ;; esac
  $N "$dir" 6 7 groom2 groom7
  $N "$dir" 6 7 groom8 --top "$top8"
  $N "$dir" 6 4 groom6

  # Turning round, standing and sitting: side, head round, three quarters, front, the far three
  # quarters and the far side (the last two are the first ones mirrored).
  $T "$dir" 2 once stand turn_s1 turn_s2 turn_s3 turn_s4 turn_s5
  $T "$dir" 2 once sit turn_t1 turn_t2 turn_t3 turn_t4 turn_t5

  # The ear scratch with a hind leg, start to end.
  $T "$dir" 2 once scratch1 scratch2 scratch3 scratch4 scratch5 scratch6 scratch7 scratch8 scratch9

  # Poses that used to swap two drawings: kneading, the hairball heave, a meow.
  $T "$dir" 3 loop knead_a knead_b
  $T "$dir" 2 loop retch1 retch2
  $T "$dir" 2 once sit meow --tag m

  # One-off sequences: sitting down after a walk (out of the standing drawing), standing up, lying down to sleep, settling into
  # a loaf, waking, stretching, sneezing.
  $T "$dir" 2 once stand sitting_down --tag d
  $T "$dir" 2 once sitting_down sit2 sit
  $T "$dir" 2 once sit stand2 --tag v
  $T "$dir" 2 once stand2 stand
  $T "$dir" 2 once sit2 lowering --tag l
  $T "$dir" 2 once lowering loaf2 drowsy curl sleep
  $T "$dir" 2 once loaf2 loaf --tag f
  $T "$dir" 2 once waking wake sit
  $T "$dir" 2 once stretch1 stretch2 stretch3 shake
  $T "$dir" 2 once presneeze sneeze2 dazed
done
