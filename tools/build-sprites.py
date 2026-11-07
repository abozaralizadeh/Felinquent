#!/usr/bin/env -S uv run --with pillow --with numpy --with scipy python
"""Builds every sprite frame of every character from its source sheets.

Usage: tools/build-sprites.py <sheets-dir>

<sheets-dir> holds, per character id: <id>-sheet1.png (nine base poses), <id>-walk.png,
<id>-run.png, <id>-face.png, <id>-action.png, <id>-life.png, <id>-extra.png, <id>-groom.png, <id>-spin.png, <id>-seq.png, <id>-trans.png, <id>-react.png, <id>-play.png,
<id>-scratch.png, <id>-turn.png and (for some) <id>-turnstand.png (see docs/art-and-ux.md). A .jpg
works where there is no .png. The frames are written to src/playground/public/sprites/<id>/<name>.webp.
"""
import shutil
import statistics
import subprocess
import sys
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1])
# Optional second argument: only rebuild these sheets, for example "walk,run" ("all" for every sheet).
# Optional third: only these characters, for example "chili,clover".
only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 and sys.argv[2] != "all" else None
cut = [sys.executable, str(root / "tools" / "cut-sprites.py")]
IDS = ["tabby", "inky", "pearl", "mochi", "bandit", "biscuit", "chili", "clover", "hazel"]
if len(sys.argv) > 3:
    IDS = [i for i in IDS if i in sys.argv[3].split(",")]
# Sheets drawn after 6 Nov 2026 (and every sheet of the three animals added then) may have loose bits
# around a drawing (a sneeze puff, dizzy stars, motion lines, a dream bubble): those are dropped.
NEW_IDS = {"chili", "clover", "hazel"}
NEW_SHEETS = {"paw", "pawfix", "look", "lookstand", "ledge", "rest", "joy", "nose", "voice", "mood", "feel", "gazesit", "gazestand", "lick", "potty"}

BASE = ["sit", "walk_a", "walk_b", "sleep", "groom", "jump", "crouch", "loaf", "wave"]
SHEETS = {
    "walk": ["walk1", "walk2", "walk3", "walk4", "walk5", "walk6", "walk7", "walk8", "stand"],
    "run": ["run1", "run2", "run3", "run4", "run5", "run6", "prep", "fall", "land"],
    "face": ["blink", "yawn", "joy", "sulk", "surprise", "sneeze", "lookup", "meow", "curious"],
    "action": ["stretch", "knead_a", "knead_b", "swat_a", "swat_b", "scratch", "chase", "retch", "proud"],
    "life": ["sleep_b", "sleep_c", "wake", "dangle", "peek", "box", "gift", "back", "rub"],
    # The ball-pushing pose of the extra sheet has a ball painted in, so it is not cut: the paw sheet has empty paws.
    "extra": ["tiptoe", "perch", "-", "wiggle_a", "wiggle_b", "love", "tail_a", "tail_b", "hop"],
    "groom": ["groom1", "groom2", "groom3", "groom4", "groom5", "groom6", "groom7", "groom8", "groom9"],
    "spin": ["spin1", "spin2", "spin3", "spin4", "spin5", "spin6", "spin7", "spin8", "spin9"],
    "seq": ["stretch1", "stretch2", "stretch3", "shake", "presneeze", "sneeze2", "dazed", "retch1", "retch2"],
    "react": ["angry", "hiss", "puffed", "annoyed", "flustered", "play_bow", "leap", "belly", "bark"],
    "play": ["shy", "beg", "dig", "sniff", "tumble", "sprawl", "howl", "giggle", "startled"],
    "scratch": ["scratch1", "scratch2", "scratch3", "scratch4", "scratch5", "scratch6", "scratch7", "scratch8", "scratch9"],
    # Sitting, a front paw reaches out and taps, comes back, then a swat (empty paws, nothing held).
    "paw": ["paw1", "paw2", "paw3", "paw4", "paw5", "paw6", "paw7", "paw8", "paw9"],
    # The tap and the swat's follow-through drawn again with the body upright (on the paw sheet the
    # whole body leaned down, which no in-between can follow). Frames 1 and 3 are copies, for the size.
    "pawfix": ["-", "paw4", "-", "paw8"],
    # Following something with the head, sitting (sg_) and standing (tg_): down, ahead, up a little,
    # up high, straight up, at you, and an ear twitch (sitting) or a freeze (standing). Frames 6 and 7
    # were meant to look back over the shoulder, but most animals came out looking away into the
    # distance instead, so they are not cut: something behind is watched by turning round.
    "look": ["sg_down", "sg_ahead", "sg_up", "sg_high", "sg_top", "-", "-", "sg_you", "sg_ear"],
    "lookstand": ["tg_down", "tg_ahead", "tg_up", "tg_high", "tg_top", "-", "-", "tg_you", "tg_freeze"],
    # Singing, barking, laughing and calling, sitting.
    "voice": ["howl1", "howl2", "howl3", "bark1", "bark2", "giggle1", "giggle2", "chatter1", "meow2"],
    # Getting cross and scared, standing. The second sideways step of the puffed up walk (frame 8)
    # turned the animal round on two sheets out of six, so it is not cut.
    "mood": ["cross", "angry1", "angry2", "hiss1", "hiss2", "puff1", "puff2", "-", "jumpback"],
    # Feelings, sitting.
    "feel": ["annoyed1", "annoyed2", "fluster1", "shy1", "beg1", "beg2", "headbutt1", "headbutt2", "proud2"],
    # The head in every direction (7 Nov 2026), sitting (sq_, sb_) and standing (tq_, tb_): turned three
    # quarters toward you looking down, level and up; looking back over the shoulder down, level, up and
    # high; and a head tilt, ahead and at you. With the look sheets that is every angle a head goes to.
    "gazesit": ["sq_down", "sq_level", "sq_up", "sb_down", "sb_level", "sb_up", "sb_high", "sg_tilt", "sg_tiltyou"],
    "gazestand": ["tq_down", "tq_level", "tq_up", "tb_down", "tb_level", "tb_up", "tb_high", "tg_tilt", "tg_tiltyou"],
    # Licking with the tongue drawn moving (7 Nov 2026): a paw at the mouth with no tongue, the tip, the
    # flat tongue on the paw, curled back, going in; the chest lick out and up; and licking the lips.
    "lick": ["lick1", "lick2", "lick3", "lick4", "lick5", "chest1", "chest2", "lips1", "lips2"],
}
# Sizes come from a frame that matches a drawing we already have: the scratch sheet's two plain
# sits, and the content sit that ends a wash (without this a groom started by shrinking a little).
PICK = {"scratch": ("sit", "7,9"), "groom": ("sit", "9"), "paw": ("sit", "1,9"), "pawfix": ("paw3", "1"),
        "look": ("sit", "2"), "lookstand": ("stand", "2"), "voice": ("sit", "3,4"), "mood": ("stand", "1"), "feel": ("sit", "1,2"),
        "gazesit": ("sit", "2"), "gazestand": ("stand", "2"), "lick": ("sit", "8,9")}

# Sheets that hold standing and sitting drawings are cut in passes: grid order, "-" skips a frame,
# standing frames sized by a standing view (to match "stand"), sitting and lying frames by a sitting
# one (to match "sit"), and "mid" (halfway down) at the scale between the two. One scale for the
# whole sheet would make sitting down or standing up shrink or grow, because each sheet was drawn
# with its own idea of how big a sit is next to a stand. The turn sheets also came out in a
# different layout for each animal, so each has its own map.
_ = "-"
TURN = {
    "tabby": {"turn": [(f"{_} turn_s1 {_} {_} {_} {_} {_} {_} {_}", "stand", "1"), (f"{_} {_} {_} {_} turn_t1 turn_t2 turn_t3 {_} slow_blink", "sit", "4")],
              "turnstand": [(f"{_} turn_s2 turn_s3 {_}", "stand", "1")]},
    "inky": {"turn": [(f"{_} turn_s1 {_} {_} {_} {_} {_} {_} {_}", "stand", "1"), (f"{_} {_} {_} {_} {_} turn_t1 turn_t2 turn_t3 slow_blink", "sit", "5")],
             "turnstand": [(f"{_} turn_s2 turn_s3 {_}", "stand", "1")]},
    "mochi": {"turn": [(f"{_} turn_s1 turn_s2 turn_s3 {_} {_} {_} {_} {_} {_} {_} {_}", "stand", "1"), (f"{_} {_} {_} {_} {_} turn_t1 turn_t2 turn_t3 {_} {_} {_} slow_blink", "sit", "5")]},
    "biscuit": {"turn": [(f"{_} turn_s1 turn_s2 turn_s3 {_} {_} {_} {_} {_}", "stand", "1"), (f"{_} {_} {_} {_} {_} turn_t1 turn_t2 turn_t3 slow_blink", "sit", "5")]},
}
TURN["pearl"] = TURN["tabby"]
TURN["bandit"] = TURN["mochi"]
# The new animals' turn sheets: Chili's is laid out like Biscuit's.
TURN["chili"] = TURN["biscuit"]
TURN["clover"] = {"turn": [(f"{_} turn_s1 turn_s2 {_} {_} {_} {_} {_} {_}", "stand", "1"), (f"{_} {_} {_} {_} turn_t1 turn_t2 {_} turn_t3 slow_blink", "sit", "4")],
                  "turnstand": [(f"{_} {_} turn_s3 {_}", "stand", "1")]}
TURN["hazel"] = {"turn": [(f"{_} turn_s1 turn_s2 turn_s3 {_} {_} {_} {_} {_} {_} {_}", "stand", "1"), (f"{_} {_} {_} {_} {_} turn_t1 turn_t2 turn_t3 {_} {_} slow_blink", "sit", "5")]}
TRANS = [(f"stand2 {_} {_} {_} {_} {_} {_} {_} {_}", "stand", "1"), (f"{_} {_} sit2 lowering loaf2 drowsy curl deep waking", "sit", "3"), (f"{_} sitting_down {_} {_} {_} {_} {_} {_} {_}", "mid", "")]
# Motion sheets with two or three bodies on them, cut in passes like the turn: the perch and the peek,
# the loaf and lying on the side, the play bow and the hop for joy, sniffing, digging and stalking.
# A fourth item "w" sizes a pass by width instead of height (for lying poses).
MOTION_PASSES = {
    "ledge": [(f"perch_fwd perch_back perch_down perch_doze perch_kick perch_you {_} {_} {_}", "perch", "1,2"), (f"{_} {_} {_} {_} {_} {_} peek_back peek_duck peek_up", "peek", "7")],
    "rest": [(f"loaf_blink loaf_up loaf_back loaf_drowse {_} {_} {_} {_} {_}", "loaf", "1,4", "w"), (f"{_} {_} {_} {_} sprawl_stretch roll1 roll2 belly_l belly_r", "sprawl", "5", "w")],
    # The second deep bow (tail to the other side) turned the whole body round on half the sheets, so it is not cut.
    "joy": [(f"bow_down bow_l {_} bow_up {_} {_} {_} {_} binky", "play_bow", "2", "w"), (f"{_} {_} {_} {_} hop_crouch hop_up hop_land wiggle {_}", "sit", "8")],
    "nose": [(f"sniff1 sniff2 sniff3 {_} {_} {_} {_} {_} {_}", "sniff", "1", "w"), (f"{_} {_} {_} dig1 dig2 dig3 {_} {_} {_}", "dig", "4,5", "w"), (f"{_} {_} {_} {_} {_} {_} stalk1 stalk2 stalk3", "wiggle_a", "7,8", "w")],
    # Nature calling (7 Nov 2026): the squat (a dog lifts a leg), relieved; the hunched squat, straining;
    # a look back at it; covering it (a cat rakes with a front paw, a dog kicks back); a paw shake (a
    # dog's big double kick); and a sheepish look at you mid-squat. Sized by the standing look back.
    "potty": [("pee1 pee2 poop1 poop2 pottyback cover1 cover2 pawshake sheepish", "stand", "5", "w")],
}
for passes in TURN.values():
    passes["trans"] = TRANS
    passes.update(MOTION_PASSES)
# The new animals' perch on the extra sheet came out standing up on the hind legs, so their perch is
# the first drawing of the ledge sheet instead, sized from the sit (on the others a perch is about 6%
# taller than a sit). A fifth item is that factor.
for cid in NEW_IDS:
    # (a new dict: Chili shares Biscuit's turn map)
    TURN[cid] = {**TURN[cid], "ledge": [(f"perch_fwd perch_back perch_down perch_doze perch_kick perch_you {_} {_} {_}", "sit", "1,2", "h", 1.06), MOTION_PASSES["ledge"][1]]}
# Their spin sheets were drawn smaller than the rest: matched to the standing drawing.
NEW_PICK = {"spin": ("stand", "1,2,3,4,5,6,7,8,9")}
# The walk sheets of the rabbit and the squirrel came out at another scale than their base sheets
# (the standing rabbit's head about 13% too big, the squirrel's about 12% too small), and everything
# sized from the standing drawing (the look, the mood, the turn, the hops) with them. Measured on the
# heads and the pupils against the base sheet's side views.
SHEET_SCALE = {("clover", "walk"): 0.87, ("hazel", "walk"): 1.12}
# The potty sheets came out at their own scale per animal (sized by the standing look back, whose
# turned head is wider or narrower than a stand). Measured by laying the squat's head over the
# standing look-ahead drawing's head at a few scales and picking the one where they match.
SHEET_SCALE.update({(c, "potty"): f for c, f in {"tabby": 1.15, "inky": 0.86, "pearl": 1.1, "mochi": 1.05, "bandit": 0.9, "biscuit": 0.84, "chili": 1.0, "clover": 0.88, "hazel": 0.78}.items()})
# The far half of a turn is the near half mirrored, ending on the other side's own drawing, so the
# pose after a turn is exactly the last turn frame.
MIRRORS = {"turn_s4": "turn_s2", "turn_s5": "stand", "turn_t4": "turn_t2", "turn_t5": "sit"}
SCALE = 0.6


def run(args: list[str]) -> str:
    out = subprocess.run(cut + args, capture_output=True, text=True)
    if out.returncode:
        sys.exit(out.stderr or out.stdout)
    if out.stderr:
        print(out.stderr.strip())
    return out.stdout


def sheet_of(cid: str, kind: str) -> Path:
    png = src / f"{cid}-{kind}.png"
    return png if png.exists() else src / f"{cid}-{kind}.jpg"


def size(path: Path) -> tuple[int, int]:
    with Image.open(path) as im:
        return im.size


def body(path: Path) -> tuple[int, int]:
    """The width and height of the drawing itself. A frame's canvas can be wider than the drawing
    (it is centred on the body, and align-base.py shifts sitting drawings in theirs), so a pass sized
    by width measures this, like cut-sprites.py measures the frames it cuts."""
    with Image.open(path) as im:
        box = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
        return (box[2] - box[0], box[3] - box[1]) if box else im.size


for cid in IDS:
    dest = root / "src" / "playground" / "public" / "sprites" / cid
    dest.mkdir(parents=True, exist_ok=True)
    for old in list(dest.glob("*.png")) + list(dest.glob("*.json")):
        old.unlink()
    if only is None:
        run([str(src / f"{cid}-sheet1.png"), str(dest), *BASE, "--scale", str(SCALE), *(["--solo"] if cid in NEW_IDS else [])])
    # The base poses set the drawing scale: sheets drawn a little bigger or smaller are matched to it.
    sit_h = size(dest / "sit.webp")[1] / SCALE
    walk_h = statistics.mean(size(dest / f"{n}.webp")[1] for n in ("walk_a", "walk_b")) / SCALE
    refs = {"walk": ["--ref-dim", "h", "--ref-val", str(walk_h), "--ref-count", "8"], "face": ["--ref-dim", "h", "--ref-val", str(sit_h)]}
    for kind, names in SHEETS.items():
        if only is not None and kind not in only:
            continue
        sheet = sheet_of(cid, kind)
        if not sheet.exists():
            print(f"skip {cid} {kind}: no sheet")
            continue
        if cid in NEW_IDS and kind == "extra":
            names = ["-" if n == "perch" else n for n in names]
        pick_of = {**PICK, **NEW_PICK} if cid in NEW_IDS else PICK
        if kind in pick_of:
            # Measured now, because the frame it is matched to may come from a sheet cut just before.
            base, pick = pick_of[kind]
            refs[kind] = ["--ref-dim", "h", "--ref-val", str(size(dest / f"{base}.webp")[1] / SCALE), "--ref-pick", pick]
        cyc = ["--align", "head", "--align-count", "8"] if kind == "walk" else ["--align", "head", "--align-count", "6"] if kind == "run" else []
        solo = ["--solo"] if cid in NEW_IDS or kind in NEW_SHEETS else []
        ref = list(refs.get(kind, []))
        if (cid, kind) in SHEET_SCALE and "--ref-val" in ref:
            i = ref.index("--ref-val") + 1
            ref[i] = str(float(ref[i]) * SHEET_SCALE[(cid, kind)])
        run([str(sheet), str(dest), *names, "--scale", str(SCALE), *ref, *cyc, *solo])
    for kind, passes in TURN[cid].items():
        if only is not None and kind not in only and not (kind == "turnstand" and "turn" in only):
            continue
        sheet = sheet_of(cid, kind)
        if not sheet.exists():
            print(f"skip {cid} {kind}: no sheet")
            continue
        scales = []
        solo = ["--solo"] if cid in NEW_IDS or kind in NEW_SHEETS else []
        for names, base, pick, *dim in passes:
            if base == "mid":
                mid = (scales[0] * scales[1]) ** 0.5
                run([str(sheet), str(dest), *names.split(), "--scale", str(mid), *solo])
                continue
            d = dim[0] if dim else "h"
            ref = (body(dest / f"{base}.webp")[0] if d == "w" else size(dest / f"{base}.webp")[1]) / SCALE * (dim[1] if len(dim) > 1 else 1) * SHEET_SCALE.get((cid, kind), 1.0)
            said = run([str(sheet), str(dest), *names.split(), "--scale", str(SCALE), "--ref-dim", d, "--ref-val", str(ref), "--ref-pick", pick, *solo])
            scales.append(float(said.split("(scale ")[1].split(")")[0]))
    if cid in NEW_IDS and (dest / "perch_fwd.webp").exists():
        shutil.copyfile(dest / "perch_fwd.webp", dest / "perch.webp")
    if (only is None or "turn" in only) and (dest / "turn_s2").with_suffix(".webp").exists():
        for name, of in MIRRORS.items():
            with Image.open(dest / f"{of}.webp") as im:
                im.transpose(Image.FLIP_LEFT_RIGHT).save(dest / f"{name}.webp", "WEBP", quality=92, method=6)
    total = sum(f.stat().st_size for f in dest.glob("*.webp"))
    print(f"{cid}: {len(list(dest.glob('*.webp')))} frames, {total // 1024} KB")
