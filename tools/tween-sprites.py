#!/usr/bin/env -S uv run --with opencv-python-headless --with pillow --with numpy python
"""Makes in-between frames for a cycle of sprites, so motion plays smooth and not as a slideshow.

Usage: tools/tween-sprites.py <sprite-dir> <count> <loop|once> name1 name2 ... [--tag u]

For every neighbouring pair (and last to first when "loop") it writes <count> new frames named
<name>t1 ... <name>t<count>, which sit between <name> and the next one. --tag changes the "t", for a
second link out of the same frame (groom5 to groom6 is groom5t1, groom5 back to groom2 groom5u1). The frames are made by
optical flow (DIS) in both directions, each half warped to the middle moment and blended, with the
colour premultiplied by alpha so soft edges do not smear. Frames of different size are padded to a common canvas,
feet on the bottom edge and centred.
"""
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

args = sys.argv[1:]
tag = "t"
if "--tag" in args:
    i = args.index("--tag")
    tag = args[i + 1]
    del args[i : i + 2]
folder, count, mode, names = Path(args[0]), int(args[1]), args[2], args[3:]


def canvas_size() -> tuple[int, int]:
    sizes = [Image.open(folder / f"{n}.webp").size for n in names]
    return max(w for w, _ in sizes), max(h for _, h in sizes)


W, H = canvas_size()


def load(name: str) -> np.ndarray:
    src = Image.open(folder / f"{name}.webp").convert("RGBA")
    # Frames of one cycle may differ in size: feet stay on the bottom edge, the middle stays in the middle.
    pad = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pad.paste(src, ((W - src.width) // 2, H - src.height))
    im = np.asarray(pad).astype(np.float32) / 255.0
    rgb = im[..., :3] * im[..., 3:4]  # premultiplied
    return np.dstack([rgb, im[..., 3:4]])


dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
dis.setFinestScale(0)
dis.setPatchSize(12)
dis.setPatchStride(4)
dis.setVariationalRefinementIterations(8)


def gray(p: np.ndarray) -> np.ndarray:
    # Flow runs on the sprite over mid grey, so the silhouette edge has contrast too.
    bg = 0.5 * (1.0 - p[..., 3:4])
    comp = p[..., :3] + bg
    return (cv2.cvtColor(comp, cv2.COLOR_RGB2GRAY) * 255.0).astype(np.uint8)


def warp(p: np.ndarray, flow: np.ndarray) -> np.ndarray:
    h, w = flow.shape[:2]
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    return cv2.remap(p, gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))


def between(a: np.ndarray, b: np.ndarray, t: float) -> np.ndarray:
    ga, gb = gray(a), gray(b)
    f01 = dis.calc(ga, gb, None)  # a(x) ~ b(x + f01)
    f10 = dis.calc(gb, ga, None)
    # Flow from the middle moment back to each end (Super SloMo style approximation).
    ft0 = -(1 - t) * t * f01 + t * t * f10
    ft1 = (1 - t) * (1 - t) * f01 - t * (1 - t) * f10
    wa = warp(a, ft0)
    wb = warp(b, ft1)
    # Where the two warped halves disagree (a leg crossing another) a blend shows two ghost legs, so
    # there the nearer pose wins outright. Where they agree it is a normal cross-fade.
    diff = np.abs(wa - wb).max(axis=2, keepdims=True)
    m = np.clip((diff - 0.12) / 0.25, 0, 1)
    w = (1 - m) * t + m * (1.0 if t >= 0.5 else 0.0)
    return (1 - w) * wa + w * wb


def save(p: np.ndarray, name: str) -> None:
    # Legs that swap places blend into faint ghosts. A contrast curve on alpha drops them and keeps edges crisp.
    alpha = np.clip((p[..., 3:4] - 0.30) / 0.45, 0, 1)
    alpha = alpha * alpha * (3 - 2 * alpha)
    p = p.copy()
    p[..., :3] = p[..., :3] / np.maximum(p[..., 3:4], 1e-3)
    p[..., 3:4] = alpha
    rgba = np.dstack([np.clip(p[..., :3], 0, 1), alpha])
    Image.fromarray((rgba * 255.0 + 0.5).astype(np.uint8), "RGBA").save(folder / f"{name}.webp", "WEBP", quality=92, method=6)


frames = [load(n) for n in names]
pairs = len(names) if mode == "loop" else len(names) - 1
for i in range(pairs):
    a, b = frames[i], frames[(i + 1) % len(names)]
    for k in range(1, count + 1):
        save(between(a, b, k / (count + 1)), f"{names[i]}{tag}{k}")
print(f"{folder.name}: {pairs * count} in-betweens for {names[0]}..{names[-1]}")
