#!/usr/bin/env -S uv run --with opencv-python-headless --with pillow --with numpy --with scipy python
"""Makes a lick (a nod of the head) out of one drawing, so licking moves one drawing instead of
swapping between two different ones.

Usage: tools/nod-sprites.py <sprite-dir> <count> <degrees> name1 name2 ... [--top 0.6]
           [--at name=x,y,r] [--show out.png]

For every name it writes <name>n1 ... <name>n<count-1>: one nod down and back up, <name> itself
being the start and end of it. The head is found on its own: the fattest round part of the upper
body (the deepest point of the distance transform in the top 60%). It tips forward round the base
of the head by up to <degrees>, the bend fading out down the neck, so the body and the feet stay
still. The canvas grows a little at the sides and top (bottom centre unchanged) so the head is never
cut off. --top changes how much of the upper body is searched, --at gives a head by hand (centre
and radius as shares of the drawing's width and height), and --show draws each head, to check by eye.
"""
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

args = sys.argv[1:]
show = None
if "--show" in args:
    i = args.index("--show")
    show = Path(args[i + 1])
    del args[i : i + 2]
top_share = 0.6
if "--top" in args:
    i = args.index("--top")
    top_share = float(args[i + 1])
    del args[i : i + 2]
given: dict[str, tuple[float, float, float]] = {}
while "--at" in args:
    i = args.index("--at")
    n, v = args[i + 1].split("=")
    x, y, r = (float(u) for u in v.split(","))
    given[n] = (x, y, r)
    del args[i : i + 2]
folder, count, deg, names = Path(args[0]), int(args[1]), float(args[2]), args[3:]
PAD = 0.06  # share of the width added at each side, and of the height on top


def head_of(alpha: np.ndarray) -> tuple[float, float, float]:
    solid = alpha > 0.5
    dist = ndimage.distance_transform_edt(solid)
    h = alpha.shape[0]
    top = dist.copy()
    top[int(h * top_share) :, :] = 0
    y, x = np.unravel_index(int(np.argmax(top)), top.shape)
    return float(x), float(y), float(top[y, x])


marks = []
for name in names:
    src = Image.open(folder / f"{name}.webp").convert("RGBA")
    px, py = int(round(src.width * PAD)), int(round(src.height * PAD))
    canvas = Image.new("RGBA", (src.width + 2 * px, src.height + py), (0, 0, 0, 0))
    canvas.paste(src, (px, py))
    im = np.asarray(canvas).astype(np.float32) / 255.0
    pre = np.dstack([im[..., :3] * im[..., 3:4], im[..., 3:4]])  # premultiplied, so edges do not smear
    if name in given:
        fx, fy, fr = given[name]
        cx, cy, r = px + fx * src.width, py + fy * src.height, fr * src.height
    else:
        cx, cy, r = head_of(im[..., 3])
    # The base of the head, a little below its middle: the head turns round it.
    pivx, pivy = cx, cy + 0.85 * r
    marks.append((name, canvas, cx, cy, r))
    hgt, wid = im.shape[:2]
    gx, gy = np.meshgrid(np.arange(wid, dtype=np.float32), np.arange(hgt, dtype=np.float32))
    d = np.hypot(gx - cx, gy - cy) / r
    # Full turn inside the head, fading to nothing by twice its radius (the neck bends, the body does not).
    w = np.clip(2.1 - d, 0.0, 1.0)
    w = w * w * (3 - 2 * w)
    for k in range(1, count):
        amount = (1 - np.cos(2 * np.pi * k / count)) / 2
        th = -np.radians(deg) * amount * w  # inverse map: turn back to find the source
        vx, vy = gx - pivx, gy - pivy
        sx = pivx + vx * np.cos(th) - vy * np.sin(th)
        sy = pivy + vx * np.sin(th) + vy * np.cos(th) - 0.05 * r * amount * w
        out = cv2.remap(pre, sx.astype(np.float32), sy.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
        a = out[..., 3:4]
        rgb = np.where(a > 1e-3, out[..., :3] / np.maximum(a, 1e-3), 0)
        rgba = np.dstack([np.clip(rgb, 0, 1), np.clip(a, 0, 1)])
        Image.fromarray((rgba * 255.0 + 0.5).astype(np.uint8), "RGBA").save(folder / f"{name}n{k}.webp", "WEBP", quality=92, method=6)
    print(f"{folder.name}/{name}: head at {cx:.0f},{cy:.0f} r {r:.0f}, {count - 1} nod frames")

if show:
    cell = 260
    sheet = Image.new("RGB", (cell * len(marks), cell), (200, 200, 205))
    for i, (name, canvas, cx, cy, r) in enumerate(marks):
        s = (cell - 10) / max(canvas.width, canvas.height)
        im = canvas.resize((int(canvas.width * s), int(canvas.height * s)), Image.LANCZOS)
        ox, oy = i * cell + (cell - im.width) // 2, cell - im.height - 2
        sheet.paste(im, (ox, oy), im)
        dr = ImageDraw.Draw(sheet)
        dr.ellipse([ox + (cx - r) * s, oy + (cy - r) * s, ox + (cx + r) * s, oy + (cy + r) * s], outline=(220, 0, 0), width=2)
        dr.text((i * cell + 4, 2), name, fill=(0, 0, 0))
    sheet.save(show)
