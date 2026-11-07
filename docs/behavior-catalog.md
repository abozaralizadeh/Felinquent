# Behavior Catalog

> **Status:** Draft v0.1 · 18 Oct 2026
> This is the single source of truth for what the cat can do. The product spec references these IDs, the [technical design](technical-design.md) turns them into intents, and [Art & UX](art-and-ux.md) lists the animations each one needs.

## Legend

- **Annoy** (annoyance level, which is also its cost in annoyance points):
  - 0 = none
  - 1 = mild (distracting)
  - 2 = blocking or disruptive
  - 3 = moves your stuff
- **Brain:**
  - **Reflex** = instant reaction in code.
  - **Rule** = the rules brain decides.
  - **LLM** = the LLM picks it when the LLM is on; otherwise the rules brain does.
- **Perm** (permission): none · **SR** = Screen Recording (window titles only) · **AX** = Accessibility.
- **Phase:** MVP / v1 / Later.

## Ambient (annoyance 0)

| ID | Behavior | What happens | Triggered by | Annoy | Brain | Perm | Phase |
|---|---|---|---|---|---|---|---|
| B-01 | Nap | Loafs, curls up or sprawls, with a slow breathing loop | Low energy, nothing better to do (the default) | 0 | Rule | none | MVP |
| B-56 | Yawn | A big yawn, a slow blink, then it sits on | Getting tired | 0 | Rule | none | MVP |
| B-57 | Look around | Sits and looks all round the room: up, ahead, at you, back over its shoulder | Curiosity, nothing better to do | 0 | Rule | none | MVP |
| B-02 | Wander & perch | Walks along window tops, jumps between windows, sits on a ledge with its legs dangling | Curiosity, just woke up | 0 | Rule (LLM may pick the target) | none | MVP |
| B-03 | Groom | Washes from the head down, in long bouts: licks a paw, wipes it over the ear and cheek a few times, then the nose, the chest and a hind leg, and ends with a content blink. It stays on one part for a while and never jumps back and forth | Idle filler; right after being petted or dropped ("I meant to do that") | 0 | Rule | none | MVP |
| B-04 | Watch the cursor | Its head follows your cursor | Cursor moving nearby while it's awake | 0 | Rule | none | MVP |
| B-05 | Stretch & yawn | A big stretch after a nap | Waking up | 0 | Rule | none | MVP |
| B-06 | Nap on the warmest window | Moves to the window of the app using the most CPU and sleeps there | Low energy plus a "hot" app | 0 | LLM | none | v1 |
| B-07 | Stare at nothing | Stares at an empty corner for 10-30 s, ears twitching | Rare, random | 0 | Rule | none | v1 |
| B-08 | Slow blink | Slow blinks at your cursor (a cat "I love you") | High trust, content | 0 | Rule | none | v1 |
| B-32 | Roll over | Play bow, belly up and wiggling, then happy | Energy and trust, any time | 0 | Rule | none | MVP |
| B-33 | Bounce | Three to six happy hops in place | Playful mood | 0 | Rule | none | MVP |
| B-34 | Sniff about | Strolls with its nose down and stops to sniff | Curiosity | 0 | Rule | none | MVP |
| B-35 | Dig | Sniffs, digs, looks proud | Curiosity and energy | 0 | Rule | none | MVP |
| B-36 | Howl | Head back, sings a long note | More at night | 0 | Rule | none | MVP |
| B-37 | Scratch | Scratches behind the ear with a hind leg: tilts its head, a quick burst of strokes, shakes its head, then licks a paw | Anytime | 0 | Rule | none | MVP |
| B-38 | Sit pretty | Comes to the cursor, sits up and begs | Attention need and trust, cursor a little way off | 1 | Rule | none | MVP |
| B-39 | Spooked by nothing | Puffs up, leaps back, runs, then washes as if nothing happened | Random, awake | 0 | Rule | none | MVP |
| B-40 | Sprawl | Lies flat on its side and rests, not asleep | Tired and lazy | 0 | Rule | none | MVP |
| B-41 | Somersault | Rolls head over heels, giggles | Playful mood | 0 | Rule | none | MVP |
| B-42 | Shy | Hides its face behind its paws, peeks out | Low trust | 0 | Rule | none | MVP |

## Attention-seeking (annoyance 1-2)

| ID | Behavior | What happens | Triggered by | Annoy | Brain | Perm | Phase |
|---|---|---|---|---|---|---|---|
| B-10 | Follow you | Walks over to the app you just switched to. Or follows your cursor about and pesters you: trots after it, stops close by, meows, headbutts it, begs, watches it, for 12 s or more | App switch or attention need | 1 | LLM | none | MVP |
| B-11 | Cross the window | Walks slowly across the active window, tail sweeping over the content | Attention need while you read or type | 1 | LLM | none | MVP |
| B-12 | Sit on the active window | Sits or loafs on it. Clicks under its body are blocked | High attention need while you're focused | 2 | LLM | none | MVP |
| B-13 | Sit on the important window | Picks the window that matters most (e.g. `Final_Thesis_v7.docx`, not Reddit) | High attention need | 2 | LLM | SR | v1 |
| B-14 | Headbutt the cursor | Rubs its head against your cursor | Attention need, cursor nearby | 1 | Rule | none | MVP |
| B-15 | Meow | Meows (a sound if enabled; otherwise a little "!" bubble) | Attention need, morning, treat time | 1 | LLM | none | MVP |
| B-16 | Ignore when called | (The click is now a poke, RF-05. The ignore stays as a menu or dog-whistle-style call.) It looks at you, then turns away | A call while trust is low or it's aloof or grumpy | 0 | LLM | none | MVP |
| B-17 | Keyboard walk | "Walks on the keyboard": fake gibberish (`jjjjjkkkk;;;`) appears near your text and fades in 3 s. **Nothing is actually typed** | Fast typing plus attention need | 2 | LLM | AX optional (caret position) | v1 |
| B-18 | Sit in front of the video | Sits over the video you're watching | A video app or title plus attention need | 2 | LLM | SR | v1 |
| B-48 | Play with the cursor | Treats your cursor as prey: watches it, crouches and wiggles, then pounces, leaps up at it or swipes, a few rounds, then washes as if nothing happened | Cursor moving close by, energy, playful | 1 | Rule | none | MVP |
| B-54 | Chase the cursor | Runs at your cursor and keeps after it while it moves: short dashes across the windows, leaps when it's above, swats when it catches up. Ends with a proud look and a wash when you stop moving it or after 8 to 30 s. At gremlin a fast cursor close by sets it off at once, no model needed (about one chase in 40 s at most); at normal now and then; never at chill | A fast cursor close by, energy, chaos | 1 | Rule and LLM | none | MVP |
| B-55 | Invite you to play | Runs up to your cursor, does a play bow ("chase me!"), springs away, bows again and hops for joy | Attention need and energy, playful | 1 | Rule | none | MVP |
| B-19 | Breakfast demand | Meows at your first activity of the day until you give it a treat | First input in the morning | 1 | LLM | none | Later |

## Mischief (annoyance 1-3, limited by chaos level)

| ID | Behavior | What happens | Triggered by | Annoy | Brain | Perm | Phase |
|---|---|---|---|---|---|---|---|
| B-20 | Swat the cursor | Paw swats at your cursor. Animation only: **your real cursor never moves** | Playful, cursor nearby | 1 | Rule | none | v1 |
| B-21 | Box | Climbs into a new or empty window as if it's a box | A new window opens | 1 | Rule | none | v1 |
| B-22 | Gift / hairball | Leaves a "gift" (toy mouse, hairball) on a window. Click it to clean up | Good mood (gift) or a long time ignored (hairball) | 2 | LLM | none | v1 |
| B-23 | Zoomies | Sprints around the screen for ~20 s. At gremlin it runs a chain of up to six legs across window tops, and whatever stands in its way goes flying | Around 3am, or high energy after a long nap | 1 | Rule | none | v1 |
| B-24 | Block the Dock | Lies across the Dock | High attention need | 2 | LLM | none | v1 |
| B-25 | Nudge a window | Pushes a window a little to the side (never off-screen) | Gremlin level only | 3 | LLM | AX | Later |
| B-26 | Its toy | Its own toy rolls in from the nearer screen edge (or is already lying about). It watches it go, sneaks up or runs after it, pounces and bats it along two to five times, then washes. Each animal has its own: Tabby's red yarn, Inky's catnip fish, Pearl's jingle ball, Mochi's stolen sock, Bandit's ball of foil, Biscuit's tennis ball, Chili's squeaky bone, Clover's carrot and Hazel's acorn. The round ones roll; the fish, the bone and the carrot skid and stop lying flat. The toy is a real thing in the mess (it bounces and falls off windows) and stays around, it doesn't fade like the other things | Playful | 1 | LLM | none | MVP |
| B-43 | Knock things off | Sneaks up to a thing standing on a window (a mug, a glass, a plant, a vase, a duck...), looks at it, stares at you, taps it, stares again, then pushes it two to four times until it teeters and falls. Glass and pottery break into pieces of their own drawing, water and soil spill, then it peeks over the edge and looks proud. Things only appear at normal (one at a time, every 2 to 5 min) and gremlin (up to three, every 30 to 90 s); in chill they fade away | A thing on a window, energy, chaos | 1 | LLM | none | MVP |
| B-44 | Claw a window | Sniffs, then scratches the title bar: claw marks stay on that window and strips of it flutter to the floor | Energy, chaos | 1 | Rule | none | MVP |
| B-45 | Hunt a fly | A fly buzzes in. It watches, chatters, wiggles and pounces: caught (proud, washes) or missed (dazed, looks away, washes) | Curiosity and energy | 0 | Rule | none | MVP |
| B-46 | Hard landing (gremlin) | A very hard landing can crack the window it lands on (a spiderweb of cracks with slivers falling). At most one every 25 s | A landing faster than 1000 px/s, gremlin only | 0 | Reflex | none | MVP |
| B-47 | Miss a jump | A big jump up sometimes falls short: it hangs off the ledge by its front paws, scrabbles, and climbs up (70%) or slips and falls, then sits dazed and washes. More often at gremlin (22%) than normal (8%) or chill (3%) | A jump up to a high window | 0 | Reflex | none | MVP |

All the breakage is drawn on the cat's own overlay, on top of your windows. Nothing in your apps is touched or captured: a "cracked" window is a drawing over it, and it goes away when the window moves, closes, or you use Panic.

## Reflexes (no LLM, instant)

| ID | Reflex | Input | Reaction | Phase |
|---|---|---|---|---|
| RF-01 | Pet | Cursor hovering and moving over the cat | Purrs. After ~8 s of petting: swats or bites, then walks off | MVP |
| RF-02 | Pick up / drop / throw | Drag the cat | Dangles while held. Dropped: lands on its feet. Thrown: flies and lands on a window or the floor, then grooms | MVP |
| RF-03 | Shoo | Shake it while holding, or drag it far away fast | Sulks (back turned, tail flicking) and remembers the spot. Comes back ≥ 3 min later ~50% of the time | MVP |
| RF-04 | Laser | Fast cursor wiggle near the cat | Crouches, wiggles its butt, pounces | MVP |
| RF-05 | Poke | Single click on the animal | A little scene, not one pose. It depends on the animal and on how many pokes it has had in the last 15 s (see RF-10). Replaces the old "call" click | MVP |
| RF-10 | Reaction scene | Set off by RF-05 | A scripted list of beats (look, react, leave): ears and eyes first, then the reaction, then the exit. Level 0 is curious or playful, 1 is warning or all out play, 2 is hiss and flee (dog: roll over, tumble), 3 is rage and a long sulk (dog: worn out, puppy eyes; fox: plays dead). Never the same twice in a row. Poked while asleep it wakes in the mood of its kind. A cross reaction keeps it sulky for 20 s to 3 min | MVP |
| RF-11 | Glance | Your cursor comes within about 260 px and moves | Sitting or loafing, it looks at the cursor and its head follows it everywhere: ahead, up, overhead, three quarters toward you, and back over its shoulder when the cursor goes behind it. It only turns its body round when the cursor stays behind for a couple of seconds or goes far behind. When the cursor stops in front of it, it may tilt its head (a dog more often). A needy animal does it nearly always, an aloof one about a third of the time | MVP |
| RF-13 | Grab its toy | Mouse down on its toy | The toy is in your hand (out of its mouth too, if it was carrying it) and swings as you move. Let go and it flies on with the speed of your hand, bounces off the screen edges, falls and rolls. The animal's own reflexes don't see that click | MVP |
| RF-12 | Ride a moving window | You drag the window it stands on | It rides along in real time (the Mac app reads the windows every frame while one moves). Dragged fast it crouches and holds on, then gives you a cross look. Flung and stopped dead, or yanked down hard, it is thrown off: it flies, lands startled, glares at you and washes. Things standing on the window (mugs, plants, its ball, broken pieces) slide when jerked and fly off the same way, but let go much sooner than the animal does | MVP |
| RF-06 | Treat | Menu → Give treat | Shake sound, it licks its lips, and it comes running. A Royal personality may walk slowly on purpose | v1 |

## Desktops

The animal lives on one desktop (a Space on the Mac). Switch to another and it stays behind, going on with its life among that desktop's windows. Go back before it comes over and it's still there. Otherwise it comes over after a while: mostly a few seconds to half a minute, now and then a minute or two (sooner for a needy one, later for an aloof one), walking in from the side its desktop is on. You swiped right, so its desktop is on the left, so it comes in from the left. Asleep, it naps on for about a minute, then wakes up to the quiet and comes looking. A treat from the menu calls it over at once. Apps in full screen count as desktops: it comes over there too, and goes outside while one plays a video or shows slides (RM-02). Each desktop keeps its own mess. With "Displays have separate Spaces", a switch on another display isn't its business.

## Its own tricks

| ID | Behavior | What happens | Triggered by | Annoy | Brain | Perm | Phase |
|---|---|---|---|---|---|---|---|
| B-49 | Do a trick | One of the little routines it made up itself (`src/core/tricks.ts`): a few poses, a few steps or hops, toward you or away. The first time it shows one the bubble names it ("new trick: the needy snub"). Each bout offers its best trick of that kind; rude ones never at chill, lively ones only with energy | A bout of the trick's kind | 1 | LLM | none | MVP |

- **Where tricks come from.** When it wakes from a nap it sometimes makes one up (at most one every three hours): it takes a scene (roll, bounce, sniff, dig, beg, spook, tumble, shy, stalk, a greeting, a snub, a stretch) or a trick it knows, the ones you liked more often, and changes it one to three times: a pose for a related one, a longer or shorter hold, a look at you, the other way round, a beat twice, the start of one and the end of another, a beat less, a move more.
- **Checked before it's kept.** Each new trick is played in the real executor on a pretend screen. It must finish within 40 s, end on its feet and on the screen, show at least three poses, and not be a near copy of a scene or a trick it knows. Only poses every character has are allowed; a trick can't click, type or touch another app.
- **Variety by design.** The library is a grid: calm to wild, alone to at you, polite to rude (18 cells, two tricks each, 36 at most). A new trick only pushes out a worse one from the same cell, worse meaning you reacted badly to it or it was shown a lot and nobody cared.
- **Learned like any action.** A pet or treat right after a trick counts for it, a shoo against it (see Freshness).

## Its toy

Every animal has a toy of its own (ADR-042). You can grab it with the mouse, carry it about and throw it, or drop it at the cursor with "Throw its toy" in the menu bar menu (a buried toy comes out of hiding). When a toy you threw comes to rest, the animal is told where it landed and the model picks what to do about it, from these and the old ones (bat it about, have a wash and ignore it). You can take it back out of its mouth too.

| ID | Behavior | What happens | Triggered by | Annoy | Brain | Perm | Phase |
|---|---|---|---|---|---|---|---|
| B-50 | Fetch | Runs to the toy, sniffs, picks it up in its mouth and brings it back to your cursor, drops it there, begs and waits for the next throw. Dogs love it | You threw the toy, trust | 0 | LLM | none | MVP |
| B-51 | Carry it off | Picks the toy up and takes it to the spot farthest from you that it can get to, drops it, lies down by it and washes | You threw the toy (a fox or a raccoon especially) | 0 | LLM | none | MVP |
| B-52 | Bury it | Picks it up, walks off a little way, digs and buries it, then looks proud. It's gone until you throw it again from the menu | You threw the toy (the squirrel especially) | 0 | LLM | none | MVP |
| B-53 | Give it a sniff | Walks over, sniffs it, gives it a nudge with a paw, then lies down next to it | You threw the toy (the rabbit especially) | 0 | LLM | none | MVP |

## When it has to go

Now and then it has to pee or poop, and it does it right where it is, on a window top or the Dock. Rare on purpose. Two needs fill up while it's awake (slower while it sleeps): about one pee every 5 waking hours and one poop every 12 at normal, every 3 and 7 hours at gremlin, never at chill. A dog pees more often, the rabbit and the squirrel poop more, and a treat adds a little. When a need is full that comes first: the next pick is the potty move, and the rest of that bout follows (a sniff, a wash, a wander). The governor still decides, so it holds on in a meeting, while you're away, in quiet hours and on a full-screen video, and asks again 45 s later. A very full need wakes a sleeper. It's all drawn on its own layer, nothing touches the real window.

What it leaves rides along with the window, goes when the window closes, and dries or fades by itself (a puddle in 6 to 9 minutes, a poop in 12 to 20, pellets in 8 to 12). Click one to clean it up (a little sparkle, and the animal notices). At most six at a time. A fly sometimes visits an old poop.

| ID | Behavior | What happens | Triggered by | Annoy | Brain | Perm | Phase |
|---|---|---|---|---|---|---|---|
| B-58 | Pee | Sniffs a spot, squats and pees: a puddle spreads under its rear and runs down the front of the window. It looks back at it, then a cat, a fox or a raccoon turns round to face it and rakes over it, a dog kicks back without turning (most of the time), and the rabbit and the squirrel just leave. Sometimes it shakes a paw, then it looks proud | The pee need is full, normal or gremlin | 1 | Rule and LLM | none | MVP |
| B-59 | Poop | Sniffs, squats with a straining face (it goes shy if your cursor comes close), and leaves a pile that fits the animal: a swirl for a dog, a log for a cat, a fox or a raccoon, pellets for the rabbit and a row of them for the squirrel. Then it looks back, covers it up like B-58, and often gets the zoomies (a cat about half the time) | The poop need is full, normal or gremlin | 1 | Rule and LLM | none | MVP |

## Freshness (what it learns and what bores it)

Every choice the rules make is tilted by three things (`src/core/habits.ts`), per action and per trick:

- **Liked or not.** A pet or a treat within 2 minutes of a choice counts for it, a shoo against it (a shoo counts 1.5 times). This slowly forgets (half-life two weeks), so it follows what you like this month. Once it knows something it draws a guess from what it learned each time (Thompson sampling), so a probably-liked thing still gets tried and a liked one sometimes gets a rest. From 0.5 times to 1.6 times.
- **Bored.** Doing something makes it a bit stale, and that wears off over a couple of hours (half-life 90 min). Napping, washing and stretching hardly get stale; play and mischief do. Down to 0.2 times.
- **Curious.** Something it has hardly done, or not for a week or two, gets up to 1.5 times. A newcomer has done nothing, so nothing stands out at first; the bonus grows over the first hundred choices. Something you clearly dislike gets no bonus (else it would come back for being rare).

Measured with `npm run month` (30 simulated days, a made-up human who pets some things and shoos others, normal chaos): 54 different actions and tricks a day, never the same twice in a row, about 9% of choices are tricks, the liked share goes from 14% to 21% over the month (with learning off it drifts from 12% to 7%) and the hated share from 3% to 2% (off: 4% to 6%).

## Respect modes (the brain can't override these)

| ID | Mode | Detected by | What the cat does | Phase |
|---|---|---|---|---|
| RM-01 | Meeting | Camera or mic in use, or a meeting app in front | No blocking, no sound; naps in a far corner | MVP |
| RM-02 | Fullscreen video / presentation | An app in full screen in front while something keeps the display awake (a video playing, slides showing). A full-screen app you just work in doesn't count | Leaves the screen ("goes outside"), back when it stops | MVP |
| RM-03 | Screen sharing | Best-effort detection | Same as meeting | v1 |
| RM-04 | Shoo for 1 hour | Menu | Walks off the screen for an hour. Click it again to call the cat back early, and a treat ends it too. The menu ticks it while it lasts | MVP |
| RM-05 | Panic | Hotkey or menu | Vanishes instantly. The same hotkey or menu item brings it back. The menu ticks it while the cat is hidden | MVP |
| RM-06 | Quiet hours | Schedule in settings | Sleep only | v1 |
| RM-07 | Low battery | < 20% and unplugged | Mostly sleeps; the LLM brain is paused | v1 |

## Fairness rules (enforced by the governor)

- No attention behavior twice in a row.
- At most 2 blocks of the same window per hour.
- After a shoo (RF-03), no B-12 or B-13 on that window for at least 3 min.
- Blocks end by themselves at the chaos level's max duration (30 / 90 / 180 s).
- Once the hourly annoyance points are spent, only annoyance-0 behaviors are allowed.

## Pace (how long between things)

One thing at a time, at the animal's speed. Cats are active only a small part of the day, so most of the time the animal should be sitting, loafing or asleep.

- **Bouts.** The day is made of bouts: rest (4 to 10 min), explore (1.5 to 3.5 min), play (1 to 2 min), social (1 to 2.5 min) and mischief (1.5 to 3.5 min). The body picks the next bout from what came before (after play it rests, after rest it explores), its needs and the chaos level (chill makes rest longer and mischief shorter, gremlin the other way round). A bout opens with a move that makes the change read: it stretches after lying down and washes after playing. Inside a bout it does one to three things with a pause between them (rest 20 to 45 s, play 7 to 14 s, times 1.6 at chill and 0.55 at gremlin).
- **The model plans inside the bout.** With the local model on, it picks the steps and where they happen, as a tiny story, and may add a thought. It doesn't pick the bout: a 1b model asked to pick mostly chose "explore" and never mischief.

- **Rest after every action.** Before it picks the next behavior the animal sits for a while, counted from the end of the last one: 8 to 22 s at the normal chaos level (chill 25 to 60, gremlin 3 to 8), times its species gap (a dog rests about half as long as a cat), times its laziness. After a lively act (zoomies, chasing, a poke reaction) the rest is 1.4 times longer. Waking up skips it.
- **Poses are held.** In every scene and reaction a pose lasts at least 1.1 s (a flinch at least 0.6 s), so you can read it before the next one starts.
- **It calms down at the end.** A scene that ends on something lively gets a short sit after it. When nothing is going on the animal sits, turns back from a huff after 12 s and lies down after 30 s.
- **Walks start and stop.** It slows before it stops, stops to turn round, and trots or runs only when it's going fast. It never walks a step or two (under 40 px it stays put) and never runs a short way (under 160 px it walks).
- **One-off moves happen once.** A stretch, swat, meow, headbutt, sneeze or bark lasts as long as the move does (about 2 to 3 s), then the animal sits for the rest of its stay. Kneading goes on for up to 12 s, then it loafs.
- **Sitting is mostly still.** It breathes, blinks about four times a minute at uneven times (real cats blink even less), looks up, tilts its head, looks proud or yawns about once every 45 s and holds it 3 s, and shifts its weight about every half minute.
- **Hanging about is calm.** Between strolls half the stops are just sitting, and a third of them end without a stroll. A dog sniffing about stays nose down 2.5 to 4.5 s at each spot.

## Adding or changing a behavior

1. Add or edit its row here (ID, trigger, annoyance level, brain, permission, phase).
2. Add the intent name to the intent enum and its limits to the governor table in the [technical design](technical-design.md#6-slow-brain).
3. Add any new animations to the list in [Art & UX](art-and-ux.md#4-animation-list).
4. If it needs a new signal or permission, update [Safety & privacy](safety-and-privacy.md#3-data-inventory).
5. Add a brain-eval scenario and a unit test for its governor rules.
