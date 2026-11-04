#!/usr/bin/env -S uv run --with pillow --with numpy --with scipy python
"""Builds every sprite frame of every character from its source sheets.

Usage: tools/build-sprites.py <sheets-dir>

<sheets-dir> holds, per character id: <id>-sheet1.png (nine base poses), <id>-walk.png,
<id>-run.png, <id>-face.png, <id>-action.png, <id>-life.png, <id>-extra.png, <id>-groom.png, <id>-spin.png, <id>-seq.png, <id>-trans.png, <id>-react.png, <id>-play.png,
<id>-scratch.png, <id>-turn.png and (for some) <id>-turnstand.png (see docs/art-and-ux.md). A .jpg
works where there is no .png. The frames are written to src/playground/public/sprites/<id>/<name>.webp.
"""
import statistics
import subprocess
import sys
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1])
# Optional second argument: only rebuild these sheets, for example "walk,run".
only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
cut = [sys.executable, str(root / "tools" / "cut-sprites.py")]
IDS = ["tabby", "inky", "pearl", "mochi", "bandit", "biscuit"]

BASE = ["sit", "walk_a", "walk_b", "sleep", "groom", "jump", "crouch", "loaf", "wave"]
SHEETS = {
    "walk": ["walk1", "walk2", "walk3", "walk4", "walk5", "walk6", "walk7", "walk8", "stand"],
    "run": ["run1", "run2", "run3", "run4", "run5", "run6", "prep", "fall", "land"],
    "face": ["blink", "yawn", "joy", "sulk", "surprise", "sneeze", "lookup", "meow", "curious"],
    "action": ["stretch", "knead_a", "knead_b", "swat_a", "swat_b", "scratch", "chase", "retch", "proud"],
    "life": ["sleep_b", "sleep_c", "wake", "dangle", "peek", "box", "gift", "back", "rub"],
    "extra": ["tiptoe", "perch", "push", "wiggle_a", "wiggle_b", "love", "tail_a", "tail_b", "hop"],
    "groom": ["groom1", "groom2", "groom3", "groom4", "groom5", "groom6", "groom7", "groom8", "groom9"],
    "spin": ["spin1", "spin2", "spin3", "spin4", "spin5", "spin6", "spin7", "spin8", "spin9"],
    "seq": ["stretch1", "stretch2", "stretch3", "shake", "presneeze", "sneeze2", "dazed", "retch1", "retch2"],
    "react": ["angry", "hiss", "puffed", "annoyed", "flustered", "play_bow", "leap", "belly", "bark"],
    "play": ["shy", "beg", "dig", "sniff", "tumble", "sprawl", "howl", "giggle", "startled"],
    "scratch": ["scratch1", "scratch2", "scratch3", "scratch4", "scratch5", "scratch6", "scratch7", "scratch8", "scratch9"],
}
# Sizes come from a frame that matches a drawing we already have: the scratch sheet's two plain
# sits, and the content sit that ends a wash (without this a groom started by shrinking a little).
PICK = {"scratch": ("sit", "7,9"), "groom": ("sit", "9")}

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
TRANS = [(f"stand2 {_} {_} {_} {_} {_} {_} {_} {_}", "stand", "1"), (f"{_} {_} sit2 lowering loaf2 drowsy curl deep waking", "sit", "3"), (f"{_} sitting_down {_} {_} {_} {_} {_} {_} {_}", "mid", "")]
for passes in TURN.values():
    passes["trans"] = TRANS
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


for cid in IDS:
    dest = root / "src" / "playground" / "public" / "sprites" / cid
    dest.mkdir(parents=True, exist_ok=True)
    for old in list(dest.glob("*.png")) + list(dest.glob("*.json")):
        old.unlink()
    if only is None:
        run([str(src / f"{cid}-sheet1.png"), str(dest), *BASE, "--scale", str(SCALE)])
    # The base poses set the drawing scale: sheets drawn a little bigger or smaller are matched to it.
    sit_h = size(dest / "sit.webp")[1] / SCALE
    walk_h = statistics.mean(size(dest / f"{n}.webp")[1] for n in ("walk_a", "walk_b")) / SCALE
    refs = {"walk": ["--ref-dim", "h", "--ref-val", str(walk_h), "--ref-count", "8"], "face": ["--ref-dim", "h", "--ref-val", str(sit_h)]}
    for kind, (base, pick) in PICK.items():
        refs[kind] = ["--ref-dim", "h", "--ref-val", str(size(dest / f"{base}.webp")[1] / SCALE), "--ref-pick", pick]
    for kind, names in SHEETS.items():
        if only is not None and kind not in only:
            continue
        sheet = sheet_of(cid, kind)
        if not sheet.exists():
            print(f"skip {cid} {kind}: no sheet")
            continue
        cyc = ["--align", "head", "--align-count", "8"] if kind == "walk" else ["--align", "head", "--align-count", "6"] if kind == "run" else []
        run([str(sheet), str(dest), *names, "--scale", str(SCALE), *refs.get(kind, []), *cyc])
    for kind, passes in TURN[cid].items():
        if only is not None and kind not in only and not (kind == "turnstand" and "turn" in only):
            continue
        sheet = sheet_of(cid, kind)
        if not sheet.exists():
            print(f"skip {cid} {kind}: no sheet")
            continue
        scales = []
        for names, base, pick in passes:
            if base == "mid":
                mid = (scales[0] * scales[1]) ** 0.5
                run([str(sheet), str(dest), *names.split(), "--scale", str(mid)])
                continue
            ref = size(dest / f"{base}.webp")[1] / SCALE
            said = run([str(sheet), str(dest), *names.split(), "--scale", str(SCALE), "--ref-dim", "h", "--ref-val", str(ref), "--ref-pick", pick])
            scales.append(float(said.split("(scale ")[1].split(")")[0]))
    if only is None or "turn" in only:
        for name, of in MIRRORS.items():
            with Image.open(dest / f"{of}.webp") as im:
                im.transpose(Image.FLIP_LEFT_RIGHT).save(dest / f"{name}.webp", "WEBP", quality=92, method=6)
    total = sum(f.stat().st_size for f in dest.glob("*.webp"))
    print(f"{cid}: {len(list(dest.glob('*.webp')))} frames, {total // 1024} KB")
