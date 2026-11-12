#!/usr/bin/env bash
# In-betweens for each animal's own moves (ADR-067, the <id>-sig sheets): only the links where one
# body moves a little (a head, a paw, a tail). Moves that change the whole body (a shake, a dive, a
# flop) swap drawings fast instead, like a cartoon does, because flow can't follow them.
# tween-all.sh runs this at the end; run it alone after cutting the sig sheets again (LIKE=biscuit
# for a character from a package whose own moves are drawn like Biscuit's):
#   tools/tween-own.sh src/playground/public/sprites/<id>/ ...
# Tags on the shared drawings (sit, stand, loaf) differ per animal, because sprites.ts keeps one list
# of what every in-between is made from.
set -euo pipefail
cd "$(dirname "$0")/.."
T=tools/tween-sprites.py
A=tools/align-base.py
dirs=("$@")
[ ${#dirs[@]} -eq 0 ] && dirs=(src/playground/public/sprites/*/)
for dir in "${dirs[@]}"; do
  dir="${dir%/}/"
  id=$(basename "$dir")
  # LIKE=<id>: a package character (ADR-069) whose own moves are drawn like that animal's.
  case ${LIKE:-$id} in
    biscuit)
      rm -f "$dir"{chew1,chew2,chew3,wag1,wag2,wag3}[tux][0-9].webp "$dir"loafx[0-9].webp
      $A "$dir" chew1 chew2 chew3 --min-iou 0.6
      $A "$dir" wag1 wag2 wag3 --min-iou 0.6
      # Lying down with the toy from the loaf, chewing (mouth open, eyes shut), a look up at you.
      $T "$dir" 2 once loaf chew1 --tag x
      $T "$dir" 2 loop chew1 chew2
      $T "$dir" 2 once chew1 chew3 --tag u
      # The tail going side to side, one way and back.
      $T "$dir" 2 once wag1 wag2 wag3
      ;;
    chili)
      rm -f "$dir"{blanket1,blanket2,blanket3,sit}u[0-9].webp "$dir"blanket[123]t[0-9].webp "$dir"{shiver,pawup}x[0-9].webp
      $A "$dir" sit pawup_sit --min-iou 0.6
      $A "$dir" blanket1 blanket2 blanket3 --min-iou 0.6
      # A front paw up, unsure, sitting; under the blanket: ears and nose, peeking out, asleep.
      $T "$dir" 2 once sit pawup_sit --tag u
      # Shivering: from the crouch down onto its seat with a paw up, and up into a sit after.
      $T "$dir" 2 once shiver pawup --tag x
      $T "$dir" 2 once pawup sit --tag x
      $T "$dir" 2 once blanket1 blanket2
      $T "$dir" 2 once blanket1 blanket3 --tag u
      ;;
    mochi)
      rm -f "$dir"{listen1,nosepush1,nosepush2}t[0-9].webp
      $A "$dir" listen1 listen2 --min-iou 0.6
      $A "$dir" nosepush1 nosepush2 --min-iou 0.6
      # Head down listening, the head tilting to place the sound; pushing earth over with the nose.
      $T "$dir" 2 once listen1 listen2
      $T "$dir" 2 loop nosepush1 nosepush2
      ;;
    bandit)
      rm -f "$dir"{wash1,wash2,wash3,rummage1,rummage2,hold1}t[0-9].webp "$dir"sitx[0-9].webp
      $A "$dir" wash1 wash2 wash3 --min-iou 0.6
      $A "$dir" rummage1 rummage2 --min-iou 0.6
      $A "$dir" sit hold1 hold2 --min-iou 0.55
      # Rubbing its hands in the water round and round; rummaging; something held at the chest, then nibbled.
      $T "$dir" 2 loop wash1 wash2 wash3
      $T "$dir" 2 loop rummage1 rummage2
      $T "$dir" 2 once sit hold1 --tag x
      $T "$dir" 2 once hold1 hold2
      ;;
    clover)
      rm -f "$dir"{thump1,nibble1,nibble2,earwash1}t[0-9].webp "$dir"standu[0-9].webp
      $A "$dir" stand thump1 thump2 --min-iou 0.6
      $A "$dir" nibble1 nibble2 --min-iou 0.6
      $A "$dir" earwash1 earwash2 --min-iou 0.6
      # Up on alert, the stamp; nibbling; an ear pulled down and licked.
      $T "$dir" 2 once stand thump1 --tag u
      $T "$dir" 2 once thump1 thump2
      $T "$dir" 2 loop nibble1 nibble2
      $T "$dir" 2 once earwash1 earwash2
      ;;
    hazel)
      rm -f "$dir"{nut1,nut2,nut3,pat1,pat2}[tu][0-9].webp "$dir"sitc[0-9].webp
      $A "$dir" sit nut1 nut2 nut3 cheeks --min-iou 0.55
      $A "$dir" pat1 pat2 --min-iou 0.6
      # Sitting up, the nut to the mouth and nibbled, the cheeks stuffed; patting the earth down.
      $T "$dir" 2 once sit nut3 --tag c
      $T "$dir" 2 once nut3 nut1
      $T "$dir" 2 loop nut1 nut2
      $T "$dir" 2 once nut1 cheeks --tag u
      $T "$dir" 2 loop pat1 pat2
      ;;
  esac
done
