#!/usr/bin/env -S uv run --with pillow --with numpy python
"""Measures where the paws are in every drawn frame, and writes src/playground/ground.ts.

Usage: tools/measure-ground.py [--print]

cut-sprites.py makes the lowest pixel of a drawing its bottom edge, and the bottom edge goes on the
ground. In many drawings that lowest pixel is the tail: a tail curled round in front of a sitting
cat is drawn a little lower than the paws (it is nearer to us), and a tail hanging off a ledge is
far lower. Then the paws float above the window or the floor. This finds, per drawn frame, how far
the paws (or the seat, on a ledge) are above the bottom edge, so the drawing can be put down with
its paws on the ground and its tail lower.

How:

- Most poses: the drawings face right and the tail is behind, so the paws are the lowest pixel at
  or in front of the drawing's centre of mass.
- The sitting turn (turn_t*): halfway round the drawings face us and then left, so the paws are the
  higher of the two lowest points, left and right of the centre of mass (the tail is the other one).
- Sitting on a ledge (perch_*): the legs and the tail hang, so the seat is the lowest row where the
  drawing is still wide (60% of its widest row in the lower two thirds); below it only legs and a
  tail hang.
- Hand-set values (FIXED) where both of those are fooled, read off the drawing by eye (a squirrel's
  tail is as wide as its body).
- Left at the bottom edge (SKIP): poses in the air or held differently, where the lowest pixel is
  meant to be where it is (jumps, falls, hops, hanging off a ledge, peeking over one, a play bow,
  the box, the gaits).

Only drawn frames are measured (the keys in the Drawn arrays of sprites.ts, less the RETIRED ones). An in-between takes its
value from the two drawings it sits between, like the size fix (groundOf in sprites.ts). Values under
2 px are left out. Run it again after drawings are added or recut.
"""
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / "src/playground/public/sprites"
SPRITES_TS = ROOT / "src/playground/sprites.ts"
OUT = ROOT / "src/playground/ground.ts"

SKIP = re.compile(
    r"^(dangle|peek.*|jump|jumpback|leap|fall|binky|hop.*|startled|tumble|run\d|walk.*|spin\d|roll\d"
    r"|stalk3|bow_.*|play_bow|box|wiggle.*|g[wtr]\d+)$"
)
PERCH = re.compile(r"^perch")
TURN = re.compile(r"^turn_t\d$")
# Read off the drawings by eye: the squirrel's tail hangs right under its paws, and the rabbit's kick
# is a wide row below its seat.
FIXED = {
    "hazel": {"perch_fwd": 101, "perch_doze": 90, "perch_back": 43, "perch_down": 38, "perch_you": 0, "perch_kick": 0},
    "clover": {"perch_kick": 57},
}
MIN = 2


def drawn_keys() -> list[str]:
    src = SPRITES_TS.read_text()
    union = re.search(r"type Drawn\s*=(.*?);", src, re.S).group(1)
    keys: list[str] = []
    for name in re.findall(r"typeof (\w+)\)\[number\]", union):
        arr = re.search(r"const " + name + r"\s*=\s*\[(.*?)\]\s*as const", src, re.S).group(1)
        keys += re.findall(r'"([^"]+)"', arr)
    retired = set(re.findall(r'"([^"]+)"', re.search(r"const RETIRED = new Set<SpriteKey>\(\[(.*?)\]\)", src, re.S).group(1)))
    return [k for k in dict.fromkeys(keys) if k not in retired]


def lowest(part: np.ndarray) -> int:
    rows = np.nonzero(part.any(axis=1))[0]
    return int(part.shape[0] - 1 - rows.max()) if len(rows) else 0


def front(a: np.ndarray) -> int:
    """How far the lowest pixel at or in front of the centre of mass is above the bottom edge."""
    return lowest(a[:, int(np.nonzero(a)[1].mean()) :])


def either(a: np.ndarray) -> int:
    """The higher of the lowest points left and right of the centre of mass: the paws, whichever way it faces."""
    cx = int(np.nonzero(a)[1].mean())
    return max(lowest(a[:, :cx]), lowest(a[:, cx:]))


def seat(a: np.ndarray) -> int:
    """How far the lowest wide row (the seat on a ledge, not a hanging leg or tail) is above the bottom edge."""
    h = a.shape[0]
    width = a.sum(axis=1)
    widest = width[h // 3 :].max()
    y = next(y for y in range(h - 1, -1, -1) if width[y] >= 0.6 * widest)
    return int(h - 1 - y)


def measure(ch: str, key: str) -> int:
    if SKIP.match(key):
        return 0
    if key in FIXED.get(ch, {}):
        return FIXED[ch][key]
    f = SPRITES / ch / f"{key}.webp"
    if not f.exists():
        return 0
    a = np.asarray(Image.open(f).getchannel("A")) > 8
    return seat(a) if PERCH.match(key) else either(a) if TURN.match(key) else front(a)


def main() -> None:
    keys = drawn_keys()
    table: dict[str, dict[str, int]] = {}
    for d in sorted(p for p in SPRITES.iterdir() if p.is_dir()):
        row = {k: v for k in keys if (v := measure(d.name, k)) >= MIN}
        table[d.name] = row
    if "--print" in sys.argv:
        for ch, row in table.items():
            print(ch, len(row), " ".join(f"{k}:{v}" for k, v in row.items()))
        return
    lines = [
        "/**",
        " * Generated by tools/measure-ground.py, do not edit.",
        " *",
        " * Per character, per drawn frame: how far the paws (or the seat, sitting on a ledge) are above",
        " * the frame's bottom edge, in the frame's own pixels before the size fix. The bottom edge is the",
        " * lowest pixel, which is often the tail (curled round in front, or hanging off a ledge). Frames",
        " * not listed have their paws on the bottom edge. In-betweens take theirs from their two drawings.",
        " */",
        "export const GROUND: Record<string, Record<string, number>> = {",
    ]
    for ch, row in table.items():
        lines.append(f"  {ch}: {{ " + ", ".join(f"{k}: {v}" for k, v in row.items()) + " },")
    lines.append("};")
    OUT.write_text("\n".join(lines) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {sum(len(r) for r in table.values())} frames")


main()
