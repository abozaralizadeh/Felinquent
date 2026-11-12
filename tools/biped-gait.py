#!/usr/bin/env -S uv run --with opencv-python-headless --with pillow --with numpy --with scipy python
"""Builds the walk, trot and run cycles of a character that walks on two legs from its drawn cycles.

Usage: tools/biped-gait.py <sprite-dir>

rig-gait.py moves four legs from the standing drawing and hop-gait.py places a rabbit's drawn hops.
A character on two legs (one from a package, ADR-069) has its walk drawn (walk1..walk8 on the walk
sheet) and its run (run1..run6), so this fills each loop with optical flow in-betweens
(tween-sprites.py) and names the frames like the other tools: gw00..gw31 (the walk with three
in-betweens per step), gt00..gt23 (the same walk with two, for a quicker trot) and gr00..gr19 (the run,
20 frames picked evenly from the loop with three in-betweens per step).

The stride (how far a planted foot travels in one cycle, so the player keeps it from sliding) is
measured on the drawings: at the contact frame the two shoes are the two biggest dark blobs low in
the drawing, and a cycle is two steps, so the stride is twice the distance between them.
Prints the strides as JSON like the other gait tools.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
folder = Path(sys.argv[1])
tween = [sys.executable, str(HERE / "tween-sprites.py")]


def tweens(names: list[str], count: int, tag: str) -> list[str]:
    """The loop through `names` with `count` in-betweens after each drawing, in order."""
    subprocess.run(tween + [str(folder), str(count), "loop", *names, "--tag", tag], check=True, capture_output=True)
    return [f for n in names for f in [n, *(f"{n}{tag}{i}" for i in range(1, count + 1))]]


def write(prefix: str, frames: list[str]) -> None:
    for i, name in enumerate(frames):
        Image.open(folder / f"{name}.webp").save(folder / f"{prefix}{i:02d}.webp", "WEBP", quality=92, method=6)


def shoes_apart(name: str) -> float:
    """The distance between the two shoes in a frame, in its own pixels (0 if not found)."""
    a = np.asarray(Image.open(folder / f"{name}.webp").convert("RGBA")).astype(int)
    h = a.shape[0]
    dark = (a[..., 3] > 128) & (a[..., :3].max(-1) < 70)
    dark[: int(h * 0.7)] = False
    from scipy import ndimage  # noqa: PLC0415 (only here)

    lab, n = ndimage.label(dark)
    if n < 2:
        return 0.0
    sizes = ndimage.sum(dark, lab, range(1, n + 1))
    big = np.argsort(sizes)[-2:] + 1
    xs = [ndimage.center_of_mass(dark, lab, int(i))[1] for i in big]
    return abs(xs[0] - xs[1])


walk = [f"walk{i}" for i in range(1, 9)]
run = [f"run{i}" for i in range(1, 7)]
missing = [n for n in walk + run if not (folder / f"{n}.webp").exists()]
if missing:
    sys.exit(f"missing drawings: {' '.join(missing)}")
for old in folder.glob("g[wtr][0-9][0-9].webp"):
    old.unlink()
write("gw", tweens(walk, 3, "q"))
write("gt", tweens(walk, 2, "r"))
loop = tweens(run, 3, "s")
write("gr", [loop[round(i * len(loop) / 20) % len(loop)] for i in range(20)])
# The contact frames: the widest gap between the shoes in each cycle.
step_w = max(shoes_apart(n) for n in walk)
step_r = max(shoes_apart(n) for n in run)
strides = {"walk": round(2 * step_w, 1) or 90.0, "trot": round(2 * step_w, 1) or 90.0, "run": round(2 * step_r, 1) or 140.0}
print(json.dumps({"id": folder.name, "strides": strides}))
