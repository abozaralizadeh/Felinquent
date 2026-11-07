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
  rm -f "$dir"*[0-9]t[0-9].webp "$dir"groom[0-9][un][0-9].webp "$dir"{stand,sit,sit2,sitting_down,knead_a,knead_b,lowering,loaf2,drowsy,curl,waking,wake,presneeze}[tvdlfmp][0-9].webp "$dir"paw[0-9][up][0-9].webp
  rm -f "$dir"{sit,stand}[ghkwxqby][0-9].webp "$dir"groom[27]y[0-9].webp "$dir"{sg_,tg_,sq_,sb_,tq_,tb_,lick,chest,lips,perch_,peek,loaf,sprawl,roll,belly,bow_,hop_,sniff,dig,stalk,howl,bark,giggle,chatter,cross,angry,hiss,puff,annoyed,fluster,shy,beg,headbutt,proud}*[tuvwxgchky][0-9].webp

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
  # The paw reach and the swat are one sitting body with a front leg moving.
  $A "$dir" sit paw1 paw2 paw3 paw4 paw5 paw6 paw7 paw8 paw9 --min-iou 0.6
  # The motion sheets drawn on one body: the head following something, singing and barking, the
  # feelings (sitting); looking and getting cross (standing); the loaf, the perch and the peek.
  $A "$dir" sit sg_down sg_ahead sg_up sg_high sg_top sg_you sg_ear howl1 howl2 howl3 bark1 bark2 chatter1 meow2 annoyed1 annoyed2 proud2 --min-iou 0.6
  $A "$dir" stand tg_down tg_ahead tg_up tg_high tg_top tg_you tg_freeze cross angry1 angry2 --min-iou 0.6
  # The head in every direction (three quarters toward you, over the shoulder, the tilts) and the
  # licks with a moving tongue: the same sitting or standing body with only the head (and a paw) moving.
  $A "$dir" sit sq_down sq_level sq_up sb_down sb_level sb_up sb_high sg_tilt sg_tiltyou --min-iou 0.6
  $A "$dir" stand tq_down tq_level tq_up tb_down tb_level tb_up tb_high tg_tilt tg_tiltyou --min-iou 0.6
  $A "$dir" sit lick1 lick2 lick3 lick4 lick5 chest1 chest2 lips1 lips2 --min-iou 0.55
  $A "$dir" angry1 hiss1 hiss2 --min-iou 0.5
  $A "$dir" loaf loaf_blink loaf_up loaf_back loaf_drowse --min-iou 0.6
  $A "$dir" perch_fwd perch_back perch_down perch_doze perch_kick perch_you --min-iou 0.6
  $A "$dir" peek peek_back peek_duck peek_up --min-iou 0.5

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

  # A paw reaching out to tap or push something, then back (push_toy), and a swat: wind-up, strike,
  # follow-through, then back through the half way paw. Into it from the sit and out of it to the sit.
  $T "$dir" 2 once sit paw1 --tag p
  $T "$dir" 2 once paw1 paw2 paw3 paw4 paw5 paw9
  $T "$dir" 2 once paw9 sit --tag p
  $T "$dir" 2 once paw1 paw6 --tag u
  $T "$dir" 2 once paw6 paw7 paw8
  $T "$dir" 2 once paw8 paw5 --tag u

  # Following something with the head, sitting and standing: from the plain pose to looking ahead,
  # then down, ahead, up, high and straight up as one chain, and from ahead to you and to an ear twitch.
  $T "$dir" 2 once sit sg_ahead --tag g
  $T "$dir" 2 once sg_down sg_ahead sg_up sg_high sg_top
  $T "$dir" 2 once sg_ahead sg_you --tag u
  $T "$dir" 2 once sg_ahead sg_ear --tag v
  $T "$dir" 2 once stand tg_ahead --tag g
  $T "$dir" 2 once tg_down tg_ahead tg_up tg_high tg_top
  $T "$dir" 2 once tg_ahead tg_you --tag u
  $T "$dir" 2 once tg_ahead tg_freeze --tag v
  # The other directions: three quarters toward you and over the shoulder, each down to up as a chain
  # (going from one direction to another swaps drawings, like a turnaround: flow can't turn a head that
  # far), from the plain pose into each, and the head tilts.
  $T "$dir" 2 once sq_down sq_level sq_up
  $T "$dir" 2 once sb_down sb_level sb_up sb_high
  $T "$dir" 2 once sit sq_level --tag q
  $T "$dir" 2 once sit sb_level --tag b
  $T "$dir" 2 once sg_ahead sg_tilt --tag y
  $T "$dir" 2 once sq_level sg_tiltyou --tag y
  $T "$dir" 2 once tq_down tq_level tq_up
  $T "$dir" 2 once tb_down tb_level tb_up tb_high
  $T "$dir" 2 once stand tq_level --tag q
  $T "$dir" 2 once stand tb_level --tag b
  $T "$dir" 2 once tg_ahead tg_tilt --tag y
  $T "$dir" 2 once tq_level tg_tiltyou --tag y

  # Licking with the tongue: from the paw raised to the mouth into the tongue cycle (tip, flat on the
  # paw, curled back, in) and round; the chest lick in and out; licking the lips after a treat.
  $T "$dir" 2 once groom2 lick1 --tag y
  $T "$dir" 2 loop lick1 lick2 lick3 lick4 lick5
  $T "$dir" 2 once lick1 groom2 --tag y
  $T "$dir" 2 once groom7 chest1 --tag y
  $T "$dir" 2 loop chest1 chest2
  $T "$dir" 2 once chest1 groom7 --tag y
  $T "$dir" 2 once sit lips1 --tag y
  $T "$dir" 2 loop lips1 lips2
  $T "$dir" 2 once lips1 sit --tag y

  # On a ledge: the tail swinging, looking down, dozing, a lazy kick, looking at you. Peeking: along
  # the ledge, ducking, up high.
  $T "$dir" 3 loop perch_fwd perch_back
  $T "$dir" 2 once perch_fwd perch_down --tag u
  $T "$dir" 2 once perch_fwd perch_doze --tag v
  $T "$dir" 2 once perch_fwd perch_kick --tag w
  $T "$dir" 2 once perch_fwd perch_you --tag x
  $T "$dir" 2 once peek peek_back
  $T "$dir" 2 once peek peek_duck --tag u
  $T "$dir" 2 once peek peek_up --tag v

  # Resting: the loaf blinking, looking up, looking back, getting drowsy; lying on the side
  # stretching and flicking the tail; belly up wriggling.
  $T "$dir" 2 once loaf loaf_blink
  $T "$dir" 2 once loaf loaf_up --tag u
  $T "$dir" 2 once loaf loaf_back --tag v
  $T "$dir" 2 once loaf loaf_drowse --tag w
  $T "$dir" 2 once sprawl sprawl_stretch
  $T "$dir" 2 once sprawl roll1 --tag u
  $T "$dir" 2 once belly belly_l
  $T "$dir" 2 loop belly_l belly_r

  # Play: into the bow, the bow, springing up; hopping for joy, and a twisting leap out of the crouch.
  $T "$dir" 2 once bow_down bow_l bow_up
  $T "$dir" 2 loop hop_crouch hop_up hop_land
  $T "$dir" 2 once hop_crouch binky --tag u

  # The nose: sniffing along, digging (paw, paw, a look), the stalking wiggle and the launch.
  $T "$dir" 2 loop sniff1 sniff2 sniff3
  $T "$dir" 2 loop dig1 dig2
  $T "$dir" 2 once dig2 dig3 --tag u
  $T "$dir" 2 once dig3 dig1
  $T "$dir" 2 loop stalk1 stalk2
  $T "$dir" 2 once stalk2 stalk3 --tag u

  # The voice: a howl rising and falling, a bark, giggling, chattering at something up high, a big call.
  $T "$dir" 2 once sit howl1 --tag h
  $T "$dir" 2 once howl1 howl2 howl3 sit
  $T "$dir" 2 once sit bark1 --tag k
  $T "$dir" 2 loop bark1 bark2
  $T "$dir" 2 loop giggle1 giggle2
  $T "$dir" 2 once sg_high chatter1 --tag c
  $T "$dir" 2 once sit meow2 --tag w

  # Getting cross: the tail lashing, a hiss, puffed up, standing.
  $T "$dir" 2 once stand cross --tag x
  $T "$dir" 2 once cross angry1
  $T "$dir" 2 loop angry1 angry2
  $T "$dir" 2 once cross hiss1 --tag u
  $T "$dir" 2 loop hiss1 hiss2
  $T "$dir" 2 loop puff1 puff2

  # Feelings, sitting: a tail thump, peeking through a paw, sitting pretty, rubbing a cheek, smug.
  $T "$dir" 2 loop annoyed1 annoyed2
  $T "$dir" 2 once flustered fluster1
  $T "$dir" 2 once shy shy1
  $T "$dir" 2 once beg beg1
  $T "$dir" 2 loop beg1 beg2
  $T "$dir" 2 loop headbutt1 headbutt2
  $T "$dir" 2 once proud proud2
done
