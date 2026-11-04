#!/usr/bin/env -S uv run --with pillow --with numpy --with scipy python
"""Lines up drawings of one sitting body, so the body stays put when only a paw or the head moves.

Usage: tools/align-base.py <sprite-dir> <ref> name1 name2 ... [--share 0.22] [--min-iou 0.8] [--dry]

cut-sprites.py centres each drawing on its own centre of mass, which is right for a pose on its own
but not for a run of drawings of one sitting body: a paw raised to the ear moves the centre of mass,
so the haunches and the feet slide sideways from one drawing to the next. This moves each name
sideways in its canvas so its body sits where the reference's does.

Where the body is comes from three measures, and the middle one of the three is used, because each
one alone is thrown off by something: the bottom band (the lowest `share` of the reference: feet,
haunches, the base of the tail) laid over the reference's, which a big tail drawn differently throws
off; the front half of that band, which leaves the tail out but loses a paw that is lifted; and the
thick core of the lower body (the torso and the haunch, found with a distance transform), which a
curled-up body throws off. A drawing whose base does not match the reference well even at its best
(a different pose) is left alone. Running it again changes nothing. Frames are drawn bottom centre,
so a shift is a change of padding.
"""
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

args = sys.argv[1:]


def opt(name: str, default: str) -> str:
    if name in args:
        i = args.index(name)
        v = args[i + 1]
        del args[i : i + 2]
        return v
    return default


dry = "--dry" in args
if dry:
    args.remove("--dry")
share = float(opt("--share", "0.22"))
min_iou = float(opt("--min-iou", "0.8"))
folder, ref, names = Path(args[0]), args[1], args[2:]
LIMIT = 60  # the most a drawing is moved, in pixels


def alpha(im: Image.Image) -> np.ndarray:
    return np.asarray(im.getchannel("A")).astype(np.float32) / 255.0


ref_a = alpha(Image.open(folder / f"{ref}.webp"))
H = ref_a.shape[0]
band = max(8, int(H * share))
span = 2 * (ref_a.shape[1] + 2 * LIMIT)


def strip(a: np.ndarray) -> np.ndarray:
    # The bottom band, placed so the canvas centre is the strip's centre (frames are drawn bottom centre).
    h, w = a.shape
    s = np.zeros((band, span), np.float32)
    x0 = span // 2 - w // 2
    s[:, x0 : x0 + w] = a[h - band :, :] if h >= band else np.pad(a, ((band - h, 0), (0, 0)))
    return s


def core_x(a: np.ndarray) -> float:
    # The middle of the thickest part of the lower body (torso and haunch), from the canvas centre.
    h, w = a.shape
    solid = a > 0.5
    dist = ndimage.distance_transform_edt(solid)
    dist[: max(0, h - int(H * 0.55))] = 0
    core = dist > 0.5 * dist.max()
    return float(np.nonzero(core)[1].mean() - w / 2)


r = strip(ref_a)
cols = r.sum(axis=0)
xs = np.nonzero(cols > 0.5)[0]
mass = float((cols * np.arange(span)).sum() / cols.sum())
# Which way it faces: the head (the top third) is on the front side of the base.
top = ref_a[: H // 3]
head = float((top.sum(axis=0) * np.arange(top.shape[1])).sum() / max(top.sum(), 1.0)) - ref_a.shape[1] / 2 + span / 2
front = np.zeros(span, bool)
reach = 0.1 * (xs[-1] - xs[0])
if head >= mass:
    front[int(mass - reach) :] = True
else:
    front[: int(mass + reach)] = True
ref_core = core_x(ref_a)


def iou(f: np.ndarray, dx: int, win: np.ndarray | None = None) -> float:
    g = np.roll(f, dx, axis=1)
    rr = r
    if win is not None:
        g, rr = g[:, win], r[:, win]
    return float(np.minimum(rr, g).sum() / max(np.maximum(rr, g).sum(), 1.0))


SHIFTS = range(-LIMIT, LIMIT + 1)
for name in names:
    path = folder / f"{name}.webp"
    im = Image.open(path).convert("RGBA")
    a = alpha(im)
    if im.height < band * 0.8 or im.width + 2 * LIMIT > span:
        print(f"{folder.name}/{name}: not like {ref}, kept")
        continue
    f = strip(a)
    by_band = max(SHIFTS, key=lambda d: iou(f, d))
    fit = iou(f, by_band)
    if fit < min_iou:
        print(f"{folder.name}/{name}: base matches {ref} only {fit:.2f}, kept")
        continue
    by_front = max(SHIFTS, key=lambda d: iou(f, d, front))
    by_core = int(round(max(-LIMIT, min(LIMIT, ref_core - core_x(a)))))
    dx = int(np.median([by_band, by_front, by_core]))
    if dx == 0:
        continue
    print(f"{folder.name}/{name}: {'would move' if dry else 'moved'} {dx:+d}px onto {ref} (base {by_band:+d}, front {by_front:+d}, core {by_core:+d}, fit {fit:.2f})")
    if dry:
        continue
    # Move the drawing dx to the right of the canvas centre: widen the canvas by 2|dx| and paste it off centre.
    out = Image.new("RGBA", (im.width + 2 * abs(dx), im.height), (0, 0, 0, 0))
    out.paste(im, (abs(dx) + dx, 0))
    # Trim what is empty on both sides alike, so the canvas centre stays where it is.
    bbox = out.getchannel("A").getbbox()
    if bbox:
        cut = min(bbox[0], out.width - bbox[2])
        if cut > 0:
            out = out.crop((cut, 0, out.width - cut, out.height))
    # Written next to it and moved over, so a stopped run never leaves half a file.
    tmp = path.with_suffix(".tmp.webp")
    out.save(tmp, "WEBP", quality=92, method=6)
    os.replace(tmp, path)
