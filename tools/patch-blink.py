#!/usr/bin/env -S uv run --with opencv-python-headless --with pillow --with numpy python
"""Rebuilds blink.webp as the sitting drawing with only the eyes closed.

Usage: tools/patch-blink.py <sprite-dir>

The blink frame on the face sheet is a separate drawing: the body sits a little differently, so
swapping to it for a blink made the whole cat twitch. This warps the blink drawing onto the sitting
one (optical flow) only to find where they still differ in the head (the eyes), then copies each
closed eye over by the shift of the fur around it, feathered, onto `sit.webp`. Run it after
build-sprites.py (which cuts a fresh blink from the sheet). Running it again changes almost nothing.
"""
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

folder = Path(sys.argv[1])
sit_img = Image.open(folder / "sit.webp").convert("RGBA")
blink_img = Image.open(folder / "blink.webp").convert("RGBA")
W, H = sit_img.size


def on_canvas(im: Image.Image) -> np.ndarray:
    # Same canvas as the sitting frame: feet on the bottom edge, centred.
    pad = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pad.paste(im, ((W - im.width) // 2, H - im.height))
    a = np.asarray(pad).astype(np.float32) / 255.0
    return np.dstack([a[..., :3] * a[..., 3:4], a[..., 3:4]])


def gray(p: np.ndarray) -> np.ndarray:
    comp = p[..., :3] + 0.5 * (1 - p[..., 3:4])
    return (cv2.cvtColor(comp, cv2.COLOR_RGB2GRAY) * 255).astype(np.uint8)


sit = on_canvas(sit_img)
blink = on_canvas(blink_img)
ys = np.nonzero(sit[..., 3] > 0.5)[0]
top, bottom = ys.min(), ys.max()
head = np.zeros((H, W), bool)
head[top: int(top + 0.55 * (bottom - top))] = True

# 1. Where the eyes are: warp the blink drawing onto the sitting one with optical flow, and see
#    where they still differ in the head. (The warped picture is only used to find them.)
dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
flow = dis.calc(gray(sit), gray(blink), None)
gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
warped = cv2.remap(blink, gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
diff = np.abs(warped - sit).max(axis=2)
mask = ((diff > 0.18) & head & (sit[..., 3] > 0.9)).astype(np.uint8)
mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
# The bits of one eye (iris, outline, highlight) join into one blob, filled to its outline.
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
n, labels, stats, cents = cv2.connectedComponentsWithStats(mask)
# Then each grows into the open eye of the sitting drawing around it: the pixels near it that are
# not fur coloured (the flow sometimes matches part of an open eye to the closed lid).
fur = np.median(sit[..., :3][head & (sit[..., 3] > 0.95)], axis=0)
odd = (np.linalg.norm(sit[..., :3] - fur, axis=2) > 0.25) & head & (sit[..., 3] > 0.9)
yy, xx = np.mgrid[0:H, 0:W]
eyes = np.zeros_like(mask)
for i in sorted(range(1, n), key=lambda i: -stats[i, cv2.CC_STAT_AREA])[:2]:
    if stats[i, cv2.CC_STAT_AREA] > 0.0004 * W * H:
        seed = labels == i
        cx, cy = cents[i]
        near = (xx - cx) ** 2 + (yy - cy) ** 2 < (0.1 * W) ** 2
        m, lab = cv2.connectedComponents((odd & near).astype(np.uint8))
        grown = seed.copy()
        for j in set(np.unique(lab[cv2.dilate(seed.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0])) - {0}:
            grown |= lab == j
        hull = cv2.convexHull(np.argwhere(grown)[:, ::-1].astype(np.int32))
        cv2.fillConvexPoly(eyes, hull, 1)
n, labels = cv2.connectedComponents(eyes)

# 2. Each eye on its own: how far the face around it moved between the two drawings (the median of
#    the flow over a ring of fur around the eye). The blink eye is copied over by that one shift,
#    so it stays crisp instead of being smeared by the flow inside the eye.
out = sit.copy()
area = 0
for i in range(1, n):
    one = (labels == i) & (eyes > 0)
    if not one.any():
        continue
    one = one.astype(np.uint8)
    ring = (cv2.dilate(one, np.ones((5, 5), np.uint8), iterations=8) > 0) & ~(cv2.dilate(one, np.ones((5, 5), np.uint8), iterations=3) > 0) & (sit[..., 3] > 0.9)
    dx, dy = float(np.median(flow[..., 0][ring])), float(np.median(flow[..., 1][ring]))
    moved = cv2.warpAffine(blink, np.float32([[1, 0, dx], [0, 1, dy]]), (W, H), flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    # 3. Paste the eye with a margin of fur, feathered.
    keep = cv2.dilate(one, np.ones((5, 5), np.uint8), iterations=4)
    soft = cv2.GaussianBlur(keep.astype(np.float32), (0, 0), 3.0)[..., None]
    out = out * (1 - soft) + moved * soft
    area += int(keep.sum())
a = out[..., 3:4]
rgb = np.clip(out[..., :3] / np.maximum(a, 1e-4), 0, 1)
Image.fromarray((np.dstack([rgb, np.clip(a, 0, 1)]) * 255 + 0.5).astype(np.uint8), "RGBA").save(folder / "blink.webp", "WEBP", quality=92, method=4)
print(f"{folder.name}: blink patched ({area} px of eyes)")
