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
| Timing | ~12 fps for most loops; walk 10-12 fps; sleep breathing ~6 fps |
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
| A-08 | groom | 8 | ✓ | B-03 | MVP |
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
| A-27 | push_toy (paw push, eye contact) | 6 | no | B-26 | v1 |
| A-28 | zoomies (fast run, puffed tail) | 6 | ✓ | B-23 | v1 |

**MVP: 19 animations, ~100 frames per coat.** The placeholder cat in P0-P1 can be a simple shape with just walk, sit and sleep.

## 5. Art pipeline

The character art is AI-assisted. Each character comes as sheets of nine poses on a flat green background, and the tools in `tools/` turn them into the frames the player uses:

1. `build-sprites.py <sheets-dir>` cuts every sheet of every character (`cut-sprites.py` does one sheet). It keys out the green, removes thin grid lines, centres each frame on its body, matches sizes between sheets and writes WebP files to `src/playground/public/sprites/<id>/`.
2. `patch-blink.py <dir>` rebuilds `blink.webp` as the sitting frame with only the eyes closed. It finds the eyes by comparing the two drawings and copies each closed eye over by the shift of the fur around it, so a blink never moves the body.
3. `tween-all.sh` adds two optical-flow in-betweens after each grooming frame (`tween-sprites.py` does one cycle). Where the two halves disagree the nearer pose wins, so there are no ghost limbs.
4. `rig-all.sh` builds the walk, trot and run from `stand.webp` with `rig-gait.py`. The four legs are cut out and moved like a cutout puppet: each swings about its hip, lifts while in the air and stays planted for a set part of the cycle (the duty factor). Walk: lateral sequence, each foot down two thirds of the time, 32 frames. Trot: diagonal pairs, 24 frames. Run: a half bound with two short flights, 20 frames. The body bobs twice a cycle and the tail sways. The stride of each gait goes to `src/playground/gaits.ts`, so the player advances the cycle by distance walked and planted feet don't slide.
5. `build-site-assets.py` packs frames for the website (`site/assets/`): Tabby's walk, grooming and sixteen poses as strips on one shared canvas, a sitting and a petted card for each character, a few single poses and the favicons. Run it again after the sprites change.

**Frames per character.** Eleven sheets of nine (base, walk, run, face, action, life, extra, groom, spin, seq, trans) plus two more (react, play). 193 frames are played: the sheet poses, 18 groom in-betweens and 76 rigged gait frames. The drawn walk and run frames are cut but not played.

**In the player** (`src/playground/sprites.ts`):
- A change of pose cross-fades over 0.24 s (a blink 0.06 s, gait to gait 0.12 s), with premultiplied "lighter" compositing so the overlap stays solid. Frames inside one loop (walk, trot, run, grooming, the spin) swap without a fade.
- The gait comes from the speed: a walk, a trot once the walk would need more than 2.9 steps a second, a run. Turning round squashes the sprite through its edge over 0.22 s.
- Sitting is mostly still: breathing, about four blinks a minute at uneven times, a look up, head tilt, proud look or yawn about every 45 s held 3 s, and a small shift of weight about every 30 s. A sleeper breathes between two frames and dreams about once a minute.
- Code adds the rest: a tremble for anger, a wiggle for the play bow, rolling for the tumble, and drawn effects (an anger mark, a startled "!", sweat drops, dust).

The logo and all text are made separately and are never part of the character art.

## 6. UI surfaces

### 6.1 Menu bar

- **Icon:** a tiny cat head as a template image (works in light and dark menu bars). Its eyes close while the cat sleeps.

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

**As built (0.1.0).** The Mac app has the plain version of this menu, with no status line, diary or settings window yet. A tick shows what's on right now: the current character and chaos level, Panic while the cat is hidden, Shoo while it's away, the local model, Start at login. The page owns that state and sends it to the menu after every change, so the ticks follow the hotkey and the treat too.

```text
Felinquent 0.1.0                     (greyed out)
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

- Small and rounded, in a lowercase cat voice, ≤ 80 characters, fading after 4 s.
- **Max 1 per 10 minutes.** Emoji allowed.
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
- **App icon:** the cat as a loaf silhouette.
- **Taglines (draft):** *"Not useful. Just real."* · *"It doesn't care about your deadline."* · *"A cat for people who can't have a cat."*

## 9. Accessibility

- **Reduce Motion:** no zoomies, slower movement, fewer jumps.
- An option for a high-contrast outline.
- VoiceOver labels in the menu and settings.
- **Everything has a menu equivalent:** pet, treat, call and shoo can be done without precise mouse moves.
- The panic hotkey can be configured.
