#!/usr/bin/env -S uv run --with pillow --with numpy --with scipy python
"""Builds every sprite frame of every character from its source sheets.

Usage: tools/build-sprites.py <sheets-dir>

<sheets-dir> holds, per character id: <id>-sheet1.png (nine base poses), <id>-walk.png,
<id>-run.png, <id>-face.png, <id>-action.png, <id>-life.png, <id>-extra.png, <id>-groom.png, <id>-spin.png, <id>-seq.png, <id>-trans.png, <id>-react.png and <id>-play.png (see docs/art-and-ux.md). The frames are written
to src/playground/public/sprites/<id>/<name>.webp.
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
    "trans": ["stand2", "sitting_down", "sit2", "lowering", "loaf2", "drowsy", "curl", "deep", "waking"],
}
SCALE = 0.6


def run(args: list[str]) -> None:
    out = subprocess.run(cut + args, capture_output=True, text=True)
    if out.returncode:
        sys.exit(out.stderr or out.stdout)
    if out.stderr:
        print(out.stderr.strip())


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
    for kind, names in SHEETS.items():
        if only is not None and kind not in only:
            continue
        sheet = src / f"{cid}-{kind}.png"
        if not sheet.exists():
            print(f"skip {cid} {kind}: no sheet")
            continue
        cyc = ["--align", "head", "--align-count", "8"] if kind == "walk" else ["--align", "head", "--align-count", "6"] if kind == "run" else []
        run([str(sheet), str(dest), *names, "--scale", str(SCALE), *refs.get(kind, []), *cyc])
    total = sum(f.stat().st_size for f in dest.glob("*.webp"))
    print(f"{cid}: {len(list(dest.glob('*.webp')))} frames, {total // 1024} KB")
