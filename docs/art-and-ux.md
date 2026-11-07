# Art & UX Design

> **Status:** Draft v0.1 · 18 Oct 2026
> **Related:** [Behavior catalog](behavior-catalog.md) · Product spec · [Technical design](technical-design.md)

## 1. Character

- **A regular house cat, drawn as a cartoon.** Not anime, not a mascot with human features. The joke only works if it reads as *a real cat*.
- **Personality through posture, not a face:** the loaf, the tail, the ears. Ears are the mood meter: forward = curious, sideways = annoyed, flat = grumpy.
- **A strong silhouette at ~90 pt tall,** so you can recognize it while it's small and moving.
- **No talking.** Thoughts appear in rare bubbles (optional, see §6), and sounds are cat sounds.

## 2. Style direction

**Flat 2D cartoon with a bold dark outline**, in the spirit of Bongo Cat and the original fox concept:

- A 2-3 px outline at 1x, 3-5 flat colors per coat plus one shade color, no gradients.
- **Coats are palette swaps.** Draw with fixed color "slots" (base, patches, belly, pink nose/ears, eyes, outline), so a new coat is a recolor and not a redraw.
- It reads well on any wallpaper (light or dark) because of the outline.
- Flat colors keep frames consistent and easy to clean up.

**Alternative:** pixel art (32-64 px base). Easier to animate by hand, but the genre is crowded with pixel cats (Mochi, many Steam pets). Decide at the end of P1 with a side-by-side test.

**Coats:**
- **Launch:** Ginger tabby, Tuxedo.
- **Packs later:** Calico, Siamese, Black cat (Halloween), Grey, "Chonk" (a size variant).

## 3. Sprite spec

| Item | Spec |
|---|---|
| Frame canvas | 128 × 128 at 1x, exported at **2x (256 × 256)** for Retina |
| Cat size | ~90 pt tall standing, ~110 pt long walking (size M) |
| Anchor | Bottom center between the paws (pivot 0.5, 1.0), so it sits exactly on ledges |
| Facing | Right only; mirrored at runtime |
| Timing | Drawn at 60 fps. Loops and one-offs are timed in seconds (a lick about 1.4 a second, the ear scratch about 5.6 strokes a second, a turn 0.6 s); the gaits advance by distance walked; sleep breathing is slow |
| Format | PNG with alpha, packed into sheets (PixiJS/TexturePacker JSON-hash format, or an Aseprite export) |
| Naming | `<anim>_<frame>`, e.g. `walk_00`…`walk_07` |
| Hit area | Body bounding box in MVP; per-frame alpha mask later |
| Props | Toy mouse, hairball, yarn ball, treat: 48 × 48 each |

## 4. Animation list

| ID | Animation | Frames | Loop | Used by | Phase |
|---|---|---|---|---|---|
| A-01 | idle_sit (breathing, tail flick) | 4 | ✓ | Many | MVP |
| A-02 | loaf | 4 | ✓ | B-01, B-12 | MVP |
| A-03 | sleep_curl (breathing) | 4 | ✓ | B-01 | MVP |
| A-04 | walk (rigged, lateral sequence) and trot (diagonal pairs) | 32 + 24 | ✓ | B-02, B-10, B-11 | MVP |
| A-05 | run (rigged half bound) | 20 | ✓ | RF-06, B-23 | MVP |
| A-06 | jump_up / jump_down / land | 3 + 3 + 2 | no | B-02 | MVP |
| A-07 | perch_dangle (legs over the edge) | 4 | ✓ | B-02 | MVP |
| A-08 | groom: bouts from the head down (lick a paw, wipe over the ear and cheek, nose, chest, a hind leg, a content blink), each lick a nod of one drawing at about 1.4 a second | 9 + in-betweens + nods | ✓ | B-03 | MVP |
| A-09 | stretch_yawn | 8 | no | B-05 | MVP |
| A-10 | look (head in 5 directions) | 5 poses | no | B-04 | MVP |
| A-11 | meow | 4 | no | B-15 | MVP |
| A-12 | purr (eyes closed, slight vibration) | 2 | ✓ | RF-01 | MVP |
| A-13 | swat / bite | 4 | no | RF-01, B-20 | MVP |
| A-14 | crouch_wiggle + pounce | 4 + 4 | no | RF-04 | MVP |
| A-15 | headbutt | 6 | no | B-14 | MVP |
| A-16 | sulk (back turned, tail flick) | 4 | ✓ | RF-03 | MVP |
| A-17 | dangle (held) | 4 | ✓ | RF-02 | MVP |
| A-18 | fall / thrown spin | 2 + 4 | ✓ | RF-02 | MVP |
| A-19 | turn_away (ignore) | 4 | no | B-16 | MVP |
| A-20 | sprawl | 2 | ✓ | B-01 | v1 |
| A-21 | knead | 6 | ✓ | Content mood | v1 |
| A-22 | slow_blink (the sitting drawing with only the eyes closed, `patch-blink.py`) | 1 + fades | no | B-08 | v1 |
| A-23 | keyboard_walk (high steps) | 8 | ✓ | B-17 | v1 |
| A-24 | hairball_cough | 8 | no | B-22 | v1 |
| A-25 | box_peek | 4 | ✓ | B-21 | v1 |
| A-26 | stare (ears twitching) | 3 | ✓ | B-07 | v1 |
| A-27 | push_toy (an empty paw pushes, then eye contact; the toy is a real thing on the overlay, not part of the drawing) | 6 | no | B-26 | v1 |
| A-28 | zoomies (fast run, puffed tail) | 6 | ✓ | B-23 | v1 |
| A-29 | ear scratch with a hind leg (head tilts, the leg comes up, a dozen strokes at about 5.6 a second, a head shake) | 9 + 16 in-betweens | no | B-37 | MVP |
| A-30 | turn round on the spot, standing and sitting (side, head round, three quarters, front, the far three quarters, the far side) | 5 + 5, the far side mirrored | no | B-02, all walks | MVP |
| A-31 | hang off a ledge (the leap drawing turned up about 70 degrees, paws on the title bar edge, a scrabbling wobble), then climb up or slip | reuses the leap | ✓ | B-47 | MVP |
| A-32 | knock-off scene: sneak, curious look, stare at you, tap, push in short shoves with a stare before the last one, peek over the edge, proud | reuses stare, swat, push_toy, peek, proud | no | B-43 | MVP |
| A-33 | watch and watch_stand: the head follows the cursor through five heights (down, ahead, up, high, straight up) and looks round at you when it is behind; with no cursor it looks about on its own. The same drawings give the sitting glances (up, high, down, at you) and an ear twitch | 7 + 7 + in-betweens | ✓ | B-04, B-48, RF-11 | MVP |
| A-34 | perch and peek: on a ledge the hind legs swing, it dozes, looks down, kicks, looks at you; peeking it ducks, looks up and back | 6 + 3 + in-betweens | ✓ | B-02, B-21 | MVP |
| A-35 | loaf and sprawl idles: a loaf blinks, looks up, looks back and drowses; a sprawl stretches, rolls over and wriggles belly up | 9 + in-betweens | ✓ | B-01, B-32, B-40 | MVP |
| A-36 | play bow (down, look, spring up), happy hops with a binky now and then, a hop | 8 + in-betweens | ✓ | B-33, B-48, RF-05 | MVP |
| A-37 | sniff (three nose moves), dig (three, looping), stalk and pounce wiggle | 9 + in-betweens | ✓ | B-34, B-35, B-48 | MVP |
| A-38 | voice: howl (rising, one per animal: a dog howls, the chihuahua yaps fast), bark, giggle, chatter, a second meow | 9 + in-betweens | ✓ | B-15, B-36, B-45 | MVP |
| A-39 | mood: cross, angry (two, a lashing tail), hiss (two), puffed up (two), jump back | 8 + in-betweens | ✓ | RF-01, RF-03, B-39 | MVP |
| A-40 | feelings: annoyed (two), flustered, shy, beg (two), headbutt (two), proud | 9 + in-betweens | ✓ | B-14, B-38, B-42 | MVP |
| A-42 | the head in every direction: three quarters toward you looking down, level and up; back over the shoulder down, level, up and high; a head tilt ahead and at you. Sitting and standing. With A-33 that is every angle a head goes to | 9 + 9 + in-betweens | ✓ | RF-11, B-04, B-57 | MVP |
| A-43 | licking with a moving tongue: paw at the mouth, the tip out, flat on the paw, curled back, in (about 1.4 strokes a second); the chest lick out and up; licking the lips (after a treat, and now and then while sitting) | 9 + in-betweens | ✓ | A-08, RF-06 | MVP |
| A-44 | its toy in its mouth: the toy is drawn in front of the animal at its mouth (a table of where the mouth is in each pose) while it carries it, sits, sniffs or walks | reuses the poses | no | B-50 to B-52 | MVP |
| A-45 | potty: a pee squat and its loop, a poop squat with a straining face and its loop, a shy face when the cursor comes close mid-poop, a look back over the shoulder at what it did, raking over it with the front paws (a cat, a fox and a raccoon turn round to face it; a dog kicks back), a paw shake. One sheet per animal, three in-betweens on every link (into, out of and round each loop) so nothing snaps. The look back leaves the squat the way it came in and turns the head with a quick cross-fade. The puddle, the drips down the window front, the piles and the stink lines are drawn on the overlay (`mess-draw.ts`), not on the animal | 9 + 42 in-betweens | ✓ | B-58, B-59 | MVP |
| A-41 | hop gait for the rabbit and the squirrel: the drawn hop (gather, push off, fly, land on the front paws, swing the hind feet through) placed on the ground with `hop-gait.py`, a walk that pauses between small hops, a steady trot hop and a bounding run | 32 + 24 + 20 | ✓ | all walks | MVP |

**Things and marks (drawn on the overlay, not the animal).** Nine props from one illustrated sheet (cut with `tools/cut-props.py` into `public/props/*.webp` at 3x their height on screen: mug 30 px, glass 34, plant 40, vase 42, yarn 26, pencils 46, teacup 24, duck 28, toy mouse 18). Each animal's own toy comes from a second sheet in the same style (jingle ball 21, catnip fish 18, sock 23, foil ball 20, tennis ball 22, squeaky bone 14, carrot 17, acorn 21; the tabby keeps the yarn); the cutter keeps the rows of the other sheet in `prop-aspect.ts`. Broken pieces are cut from the same drawing, so a broken mug looks like that mug. Cracks are a spiderweb with a dark under-stroke and a light line; claw marks are three or four short parallel scratches with a chip; strips use the window chrome colour (light #ececec, dark #3a3a3c). The fly is a small dark body with a wing blur and red eyes, 1.7 times the old size so it reads on a big screen. What it leaves when it has to go: a poop swirl, a log, pellets and a row of pellets from one magenta sheet (16, 9, 9 and 6 px tall on screen; `cut-props.py --grow` keeps the pellets of a row as one drawing), and a puddle drawn in code that spreads while it pees, sends a few drips down the window front and dries to a faint ring. Poops get wavy stink lines for their first four minutes. A click on one cleans it up with a sparkle.

**MVP: 19 animations, ~100 frames per coat.** The placeholder cat in P0-P1 can be a simple shape with just walk, sit and sleep.

## 5. Art pipeline

The character art is AI-assisted. Each character comes as sheets of nine poses on a flat green background, and the tools in `tools/` turn them into the frames the player uses:

1. `build-sprites.py <sheets-dir>` cuts every sheet of every character (`cut-sprites.py` does one sheet). It keys out the green, removes thin grid lines, centres each frame on its body, matches sizes between sheets and writes WebP files to `src/playground/public/sprites/<id>/`. Sheets that mix standing and sitting frames (the turn, the sit-down and lie-down sequence) are cut in passes, one per body, each scaled to match the drawing it starts from, so nothing grows or shrinks when one drawing follows another. The far side of a turn is the near side mirrored.
2. `patch-blink.py <dir>` rebuilds `blink.webp` as the sitting frame with only the eyes closed. It finds the eyes by comparing the two drawings and copies each closed eye over by the shift of the fur around it, so a blink never moves the body.
3. `tween-all.sh` first lines up the sitting drawings (`align-base.py`): the faces, the wash and the ear scratch move sideways in their canvas until their feet, haunches and torso sit where the plain sit's do, so the body stays put while a paw moves. Then it adds two optical-flow in-betweens between drawings that follow each other (`tween-sprites.py`): the wash, the turn, the ear scratch, kneading, the hairball heave, a meow and the one-off sequences (sitting down, standing up, lying down, waking, stretching, sneezing). Where the two halves disagree the nearer pose wins, so there are no ghost limbs. A lick is a nod of one drawing (`nod-sprites.py`): the head tips forward round its base and the bend fades out down the neck.
4. `rig-all.sh` builds the walk, trot and run from `stand.webp` with `rig-gait.py`. The four legs are cut out and moved like a cutout puppet: each swings about its hip, lifts while in the air and stays planted for a set part of the cycle (the duty factor). Walk: lateral sequence, each foot down two thirds of the time, 32 frames. Trot: diagonal pairs, 24 frames. Run: a half bound with two short flights, 20 frames. The body bobs twice a cycle and the tail sways. The rabbit and the squirrel move both hind feet together, so they hop instead (`hop-gait.py`): their drawn hop is placed on the ground, hind feet still while gathering and pushing off, front paws still while landing and swinging the hind feet through, an arc in the air, flow in-betweens between the drawings (a clean cut half way where two drawings are too far apart to blend). The walk is a small hop with a pause, the trot keeps hopping, the run bounds. The stride of each gait goes to `src/playground/gaits.ts`, so the player advances the cycle by distance walked and planted feet don't slide.
5. `build-site-assets.py` packs frames for the website (`site/assets/`): Tabby's walk, grooming and sixteen poses as strips on one shared canvas, a sitting and a petted card for each character and a few single poses. Run it again after the sprites change.
6. `build-icons.py` builds the app icon (`icon.icns`, `icon.png`, the Windows `icon.ico`), the menu bar icon (`tray.png`) and the website's favicon, header logo and home screen icon from two drawings of the tabby in `src-tauri/icons/art/`: a loaf, used from 64 px up, and the head alone, used where a whole body would turn into a blob (16 and 32 points, the menu bar, the favicon). Give it new drawings on flat green and it keys them like the sheets.

**Frames per character.** Fourteen sheets, most of nine poses (base, walk, run, face, action, life, extra, groom, spin, seq, trans, react, play, scratch), a turn sheet (and for some a standing turn), and thirteen motion sheets (paw, look, lookstand, ledge, rest, joy, nose, voice, mood, feel, gazesit, gazestand, lick; most also have a small pawfix sheet that redraws the tap and the swat sitting upright). About 700 files per character (695 or 696): the sheet poses, the mirrored far side of the turn, flow in-betweens for every chain of drawings, lick nods and the rigged gait frames. The drawn walk and run frames are cut but only the hoppers play them.

**In the player** (`src/playground/sprites.ts`):
- A change of pose cross-fades over 0.24 s (a blink 0.06 s, gait to gait 0.12 s), with premultiplied "lighter" compositing so the overlap stays solid. Frames inside one loop (walk, trot, run, the spin) swap without a fade.
- Drawings that follow each other glide: the player blends the two neighbours. Frames that hardly differ (a nod, the eyes closing, a meow) blend all the way; where a paw moves far they blend only for about a third of each step, so a moving paw never shows as two see-through paws.
- The wash, the ear scratch, the meow, the slow blink, the one-off sequences and every reaction and play pose (a howl, a bark, a hiss, begging, digging, a hop for joy...) are little programs of holds and moves in seconds, played by the time since the pose began. The long idles (sitting, a loaf, a perch, a peek, a sprawl) add rare events at uneven times: a glance up or down, an ear twitch, a look back, drowsing, legs swinging over the edge. Sitting down after a walk plays the sit-down first, getting up plays the stand-up.
- Watching (`watch`, `watch_stand`) moves the head toward the cursor in three directions, each a chain from down to up: in profile (down, ahead, up, high, straight up), three quarters toward you (for a cursor right on it or over its head) and back over the shoulder (down, level, up, high). Up and down glide; from one direction to the next the head comes level first and the drawing swaps with a quick 0.08 s fade, never straight from profile to behind. A small dead band stops it twitching, and when the cursor stops for about a second it may tilt its head, then straighten up. A frame that fails to load is drawn as the drawing it was made from, so nothing ever vanishes. A wash is one bout after another (A-08), each a bit different, and never jumps back and forth between body parts. The ear scratch fits in the 4.8 s the executor gives it.
- The gait comes from the speed: a walk, a trot once the walk would need more than 2.9 steps a second, a run. Turning round takes 0.6 s and plays the drawn turn (A-30) one drawing at a time, slow at both ends, with no blending (a front view over a side view looks see-through). Its last drawing is the base drawing facing the new way, so the walk goes on from it.
- Sitting is mostly still: breathing, about four blinks a minute at uneven times, a look up, head tilt, proud look or yawn about every 45 s held 3 s, and a small shift of weight about every 30 s. About every two and a half minutes a slow blink: it turns its face to you, closes its eyes slowly and turns back. A sleeper breathes between two frames and dreams about once a minute.
- Code adds the rest: a tremble for anger, a wiggle for the play bow, rolling for the tumble, and drawn effects (an anger mark, a startled "!", sweat drops, dust).
- The executor picks which watch: `watch` while it sits, `watch_stand` while it is about to move again (eyes on the rolling ball, between goes at the cursor). Both turn the whole body round when the cursor stays well behind it, because the drawings only look back over the shoulder.
- Tricks the animal makes up (B-49) need no new art: a trick is a short list of the poses above, walks and leaps, played by the same player. The red ball is a drawn prop on the overlay, never part of the character drawing.

The logo and all text are made separately and are never part of the character art.

## 6. UI surfaces

### 6.1 Menu bar

- **Icon:** the tabby's head in colour, the same drawing as the app icon's small sizes, 18 points tall. It reads on light and dark menu bars thanks to its brown outline. (A version whose eyes close while the cat sleeps is an idea, not built.)

```text
Mrrlo is napping on Word            ← status line
────────────────────────
Pet · Give treat · Call
Shoo for 1 hour · Call the cat back (ends a shoo; a treat does too)
Chaos: ○ Chill  ● Normal  ○ Gremlin
────────────────────────
Today's diary…
Settings…
Open logs folder
Quit
```

**As built (0.1.1).** The Mac app has the plain version of this menu, with no status line, diary or settings window yet. A tick shows what's on right now: the current character and chaos level, Panic while the cat is hidden, Shoo while it's away, the local model, Start at login. The page owns that state and sends it to the menu after every change, so the ticks follow the hotkey and the treat too.

```text
Felinquent 0.1.1                     (greyed out)
────────────────────────
Give a treat
Character            ▸  ✓ Tabby · Inky · Pearl · Mochi · Bandit · Biscuit
Chaos level          ▸  Chill · ✓ Normal · Gremlin
Panic: hide the cat (Cmd+Opt+Shift+P)
Shoo for 1 hour                      (click again to call it back)
────────────────────────
✓ Use the local model (needs Ollama)
  Start at login
────────────────────────
Forget everything it learned
Open logs folder
Quit Felinquent
```

### 6.2 Settings window

These tabs match the product spec §7: General · Cat · Behavior · Brain · Privacy · About. It's a small native-looking window: no big dashboards, no stats charts.

### 6.3 Onboarding: "a cat has moved in" (v1)

1. Three kittens tumble onto the screen, each with a one-line vibe: *"sleeps a lot"*, *"follows you everywhere"*, *"chaos"*, *"judges you"*. Pick one.
2. Name it. The box starts with *Mrrlo*, and you can type anything else.
3. A 20-second tutorial **with the real cat:** pet it (hover), pick it up (drag), shoo it (shake), call it (click).
4. The privacy promise on one card, in plain words.
5. Brain: *"It already works. Want it smarter? Download a small brain (~1-2 GB)."* [Later] [Download]
6. **Permissions are asked only when a feature needs them** (just in time), with a cute explanation and a "Not now" button.

### 6.4 Thought bubble

- Small and rounded, in a lowercase cat voice, up to three short lines, with two little dots down to the head (a thought, not speech). Up for 6 s, fades in and out, and stays on the display the animal is on.
- **At most one per 8 min at chill, 4 min at normal, 150 s at gremlin.** Emoji allowed.
- What it says: the model's line when it is about something real right now, else a written line for that moment (`src/core/lines.ts`: a poke, a pet, a broken mug, a fly that got away, a new window, how long you've been in one app).
- Examples: *"this window is warm. it's mine now."* · *"you said my name. i heard. no."* · *"3am. time to run."*

### 6.5 Diary card (v1)

- A shareable image: the cat's portrait, the date, and a 3-4 line diary in the cat's voice.
- Example: *"sat on the important document 3 times. got petted twice. unacceptable."*
- App names only, never window titles unless you allow them.
- Small watermark: the app name + website.

## 7. Sound

| Sound | Default | Notes |
|---|---|---|
| Purr | On, quiet | Only while petted |
| Meow / chirp / trill | **Off** (opt-in) | Office-safe default |
| Treat bag shake | On | Only when you give a treat |
| Landing thud | Off | |

Sounds follow the system volume and are always muted in meeting mode.

## 8. Brand

- **Voice:** deadpan. The cat doesn't care. Lowercase thoughts.
- **Look:** warm cream background, ink outline (like the fox concept), one accent color per coat.
- **App icon:** the tabby lying in a loaf with a sly look, drawn in the same style as the characters, on a warm cream tile with a soft shadow (Apple's grid: an 824 px rounded tile on a 1024 canvas). At 16 and 32 points it shows the head alone.
- **Taglines (draft):** *"Not useful. Just real."* · *"It doesn't care about your deadline."* · *"A cat for people who can't have a cat."*

## 9. Accessibility

- **Reduce Motion:** no zoomies, slower movement, fewer jumps.
- An option for a high-contrast outline.
- VoiceOver labels in the menu and settings.
- **Everything has a menu equivalent:** pet, treat, call and shoo can be done without precise mouse moves.
- The panic hotkey can be configured.
