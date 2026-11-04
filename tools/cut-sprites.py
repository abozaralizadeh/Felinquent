#!/usr/bin/env -S uv run --with pillow --with numpy --with scipy python
"""Cuts a frame sheet on a flat green background into transparent WebP sprites.

Usage: tools/cut-sprites.py <sheet.png> <out-dir> name1 ... nameN
           [--scale 0.6] [--ref-dim w|h --ref-val N --ref-count K | --ref-pick 1,5]

Frames are read in grid order (left to right, top to bottom). Rows are found from where the
frames sit, so a sheet can have any number of columns and a short last row. A name of "-" skips
that frame. Each frame is trimmed, its feet are the bottom edge, and it is padded so its centre of
mass sits in the middle (so a walk cycle does not slide). With --ref-dim and --ref-val the median
width or height of the first K kept frames is scaled to N (in sheet pixels), so sheets drawn at
slightly different sizes match. --ref-pick names the grid positions to measure instead.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

args = sys.argv[1:]


def opt(name: str, default: str | None) -> str | None:
    if name in args:
        i = args.index(name)
        v = args[i + 1]
        del args[i : i + 2]
        return v
    return default


scale = float(opt("--scale", "0.6"))
align = opt("--align", "mass")  # "head" keeps the head still, for walk and run cycles
align_count = int(opt("--align-count", "9") or 9)
ref_dim = opt("--ref-dim", None)
ref_val = float(opt("--ref-val", "0") or 0)
ref_count = int(opt("--ref-count", "9") or 9)
# 1-based grid positions (skipped frames count) whose median size sets the scale, instead of the first K.
ref_pick = [int(v) - 1 for v in (opt("--ref-pick", "") or "").split(",") if v]
sheet, out_dir, names = Path(args[0]), Path(args[1]), args[2:]
out_dir.mkdir(parents=True, exist_ok=True)

img = np.asarray(Image.open(sheet).convert("RGB")).astype(np.float32)
r, g, b = img[..., 0], img[..., 1], img[..., 2]

# How "green screen" each pixel is: green far above both other channels.
spill = g - np.maximum(r, b)
alpha = np.clip(1.0 - (spill - 30.0) / 90.0, 0.0, 1.0)
alpha[spill < 30.0] = 1.0

# Remove green tint from soft edge pixels.
cap = np.maximum(r, b)
g2 = np.where(spill > 0, np.minimum(g, cap + 6.0), g)
rgb = np.stack([r, g2, b], axis=-1)

mask = alpha > 0.5
# Thin grid lines between cells (some sheets have them) are removed by an opening, which only
# affects the labelling. Thin real parts (whiskers, tail tips) come back through the dilation.
solid = ndimage.binary_opening(mask, structure=np.ones((9, 9)))
blobs, n = ndimage.label(ndimage.binary_dilation(solid, iterations=14))
if n < len(names):
    sys.exit(f"found only {n} poses, expected {len(names)}")
sizes = ndimage.sum(solid, blobs, index=range(1, n + 1))
keep = [i + 1 for i in np.argsort(sizes)[::-1][: len(names)]]
if min(sizes[k - 1] for k in keep) < 0.2 * float(np.median([sizes[k - 1] for k in keep])):
    print("warning: one frame is much smaller than the rest, check the sheet", file=sys.stderr)

found = []
for lab in keep:
    region = ndimage.binary_dilation(blobs == lab, iterations=12) & mask
    ys, xs = np.where(region)
    found.append((lab, ys.min(), ys.max(), xs.min(), xs.max(), (ys.min() + ys.max()) / 2, (xs.min() + xs.max()) / 2))

# Grid order: rows by vertical centre (a new row starts where the centres jump by more than half a
# frame), then left to right inside a row.
found.sort(key=lambda t: t[5])
tall_med = float(np.median([t[2] - t[1] for t in found]))
rows: list[list[tuple]] = []
for t in found:
    if rows and t[5] - rows[-1][-1][5] < 0.5 * tall_med:
        rows[-1].append(t)
    else:
        rows.append([t])
ordered = [t for row in rows for t in sorted(row, key=lambda t: t[6])]

frames = []
for lab, y0, y1, x0, x1, _, _ in ordered:
    region = ndimage.binary_dilation(blobs == lab, iterations=14)
    keepmask = region[y0 : y1 + 1, x0 : x1 + 1]
    a = alpha[y0 : y1 + 1, x0 : x1 + 1] * keepmask
    c = rgb[y0 : y1 + 1, x0 : x1 + 1]
    rgba = np.dstack([np.clip(c, 0, 255), a * 255.0]).astype(np.uint8)
    im = Image.fromarray(rgba, "RGBA")
    bbox = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    frames.append(im)

kept = [f for f, nm in zip(frames, names) if nm != "-"]
factor = scale
if ref_dim and ref_val > 0:
    pool = [frames[i] for i in ref_pick] if ref_pick else kept[:ref_count]
    dims = [f.width if ref_dim == "w" else f.height for f in pool]
    factor = scale * ref_val / float(np.median(dims))
    print(f"matching median {ref_dim} {np.median(dims):.0f} -> {ref_val:.0f} (scale {factor:.3f})")

def mass_x(im: Image.Image) -> float:
    al = np.asarray(im.getchannel("A")).astype(np.float32) / 255.0
    return float((al.sum(axis=0) * np.arange(al.shape[1])).sum() / max(al.sum(), 1.0))


def head_x(im: Image.Image) -> float:
    # The head is the top right of a side view. It moves far less than the tail or the legs do,
    # so anchoring on it keeps the body from jittering sideways during a cycle.
    al = np.asarray(im.getchannel("A")).astype(np.float32) / 255.0
    h, w = al.shape
    part = al[: int(h * 0.45), int(w * 0.45) :]
    return float(int(w * 0.45) + (part.sum(axis=0) * np.arange(part.shape[1])).sum() / max(part.sum(), 1.0))


# For a cycle, every frame gets the same canvas and the head sits at the same spot in it.
cycle = None
if align == "head":
    n = min(align_count, len(frames))
    anchors = [head_x(f) for f in frames[:n]]
    masses = [mass_x(f) for f in frames[:n]]
    left = max(anchors)
    right = max(f.width - a for f, a in zip(frames[:n], anchors))
    # Put the cycle's average centre of mass in the middle of the canvas, like the other poses.
    mean_mass = float(np.mean([left - a + m for a, m in zip(anchors, masses)]))
    wide = int(np.ceil(2 * max(mean_mass, left + right - mean_mass)))
    shift = wide / 2 - mean_mass
    tall = max(f.height for f in frames[:n])
    cycle = (anchors, left, wide, shift, tall)

for idx, (name, im) in enumerate(zip(names, frames)):
    if name == "-":
        continue
    if cycle is not None and idx < align_count:
        anchors, left, wide, shift, tall = cycle
        canvas = Image.new("RGBA", (wide, tall), (0, 0, 0, 0))
        canvas.paste(im, (int(round(left - anchors[idx] + shift)), tall - im.height))
    else:
        cx = mass_x(im)
        half = max(cx, im.width - cx)
        wide = int(np.ceil(half * 2))
        canvas = Image.new("RGBA", (wide, im.height), (0, 0, 0, 0))
        canvas.paste(im, (int(round(wide / 2 - cx)), 0))
    w, h = max(1, round(canvas.width * factor)), max(1, round(canvas.height * factor))
    canvas = canvas.resize((w, h), Image.LANCZOS)
    canvas.save(out_dir / f"{name}.webp", "WEBP", quality=92, method=6)
    print(name, w, h)
