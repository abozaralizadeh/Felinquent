#!/usr/bin/env -S uv run --with opencv-python-headless --with pillow --with numpy python
"""Builds the walk, trot and run cycles of an animal that hops (a rabbit, a squirrel) from its drawn hops.

Usage: tools/hop-gait.py <sprite-dir> [--debug <file.png>] [--only walk|trot|run] [--verbose]

rig-gait.py moves four legs on their own clocks, which is right for a cat or a dog. A rabbit and a
squirrel move both hind feet together: they gather, push off, fly, land on the front paws, swing the
hind feet past them and gather again. That is drawn (the hop and bound sheets), so this places the
drawn moments of one hop on the ground and fills the gaps with optical flow in-betweens:

- While the hind feet are on the ground (gathered, pushing off) the hind feet stay where they are.
- While the front paws are on the ground (landing, the hind feet swinging through) the front paws stay.
- In the air the drawing travels between the two and lifts on an arc.

The player moves the animal at a steady speed and advances the cycle by distance over stride, so each
frame is drawn shifted back by how far the body has moved: a planted foot does not slide even though
the body itself glides. A walk is a small hop with a rest between, a trot keeps hopping, the run
bounds. Every frame of a gait has the same canvas, centred on where the body is.

Writes gw00..gw31, gt00..gt23 and gr00..gr19 like rig-gait.py and prints the strides as JSON.
"""
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

args = sys.argv[1:]
folder = Path(args[0])
debug = Path(args[args.index("--debug") + 1]) if "--debug" in args else None
only = args[args.index("--only") + 1] if "--only" in args else None
VERBOSE = "--verbose" in args
# Share of the drawing where the two warped drawings still disagree, above which there is no in-between.
MISS = 0.22
cid = folder.resolve().name

# Each character's drawn hop. A key is (drawing, phase, what is on the ground): "hind", "front" or
# "air". The cycle ends where it began, one stride on. "size" scales the drawings as cut (1 keeps
# them at the scale of the standing drawing, which build-sprites.py matched them to; check the heads
# side by side); "stride" is in widths of the standing drawing; "lift" in heights of it.
HOPS = {
    "clover": {
        "walk": {"keys": [("walk6", 0.0, "hind"), ("walk6", 0.34, "hind"), ("walk2", 0.46, "hind"), ("walk3", 0.58, "air"), ("walk4", 0.68, "front"), ("walk5", 0.80, "front")],
                 "size": 1.0, "stride": 0.55, "lift": 0.12},
        "trot": {"keys": [("walk6", 0.0, "hind"), ("walk6", 0.12, "hind"), ("walk2", 0.28, "hind"), ("walk3", 0.48, "air"), ("walk4", 0.64, "front"), ("walk5", 0.80, "front")],
                 "size": 1.0, "stride": 0.85, "lift": 0.18},
        # The run sheet was drawn about 11% smaller than the standing drawing (by the heads).
        "run": {"keys": [("run5", 0.0, "hind"), ("run6", 0.14, "hind"), ("run1", 0.28, "hind"), ("run2", 0.48, "air"), ("run4", 0.66, "front"), ("run3", 0.82, "front")],
                "size": 1.12, "stride": 1.6, "lift": 0.16},
    },
    # The squirrel's walk sheet: 6 gathered, 7 pushing off with the front up, 2 reaching out in the
    # air, 3 touching down, 4 landed with the hind feet high, 5 the hind feet swinging under.
    "hazel": {
        "walk": {"keys": [("walk6", 0.0, "hind"), ("walk6", 0.30, "hind"), ("walk7", 0.40, "hind"), ("walk2", 0.52, "air"), ("walk3", 0.62, "front"), ("walk4", 0.70, "front"), ("walk5", 0.82, "front")],
                 "size": 1.0, "stride": 0.6, "lift": 0.10},
        "trot": {"keys": [("walk6", 0.0, "hind"), ("walk6", 0.08, "hind"), ("walk7", 0.20, "hind"), ("walk2", 0.40, "air"), ("walk3", 0.52, "front"), ("walk4", 0.62, "front"), ("walk5", 0.78, "front")],
                 "size": 1.0, "stride": 0.9, "lift": 0.16},
        # The bound: 5 gathered, 6 pushing off, 1 and 2 stretched out in the air, 3 landing, 4 the hind feet coming under.
        "run": {"keys": [("run5", 0.0, "hind"), ("run6", 0.16, "hind"), ("run1", 0.34, "air"), ("run2", 0.48, "air"), ("run3", 0.62, "front"), ("run4", 0.78, "front")],
                "size": 1.2, "stride": 1.6, "lift": 0.16},
    },
}
COUNTS = {"walk": ("gw", 32), "trot": ("gt", 24), "run": ("gr", 20)}

if cid not in HOPS:
    sys.exit(f"{cid}: not a hopper (see HOPS)")


def crop(im: Image.Image) -> Image.Image:
    box = im.getchannel("A").point(lambda a: 255 if a > 20 else 0).getbbox()
    return im.crop(box) if box else im


stand = crop(Image.open(folder / "stand.webp").convert("RGBA"))
SW, SH = stand.size


def feet(im: Image.Image) -> tuple[float, float]:
    """Where the hind feet and the front paws touch the ground, from the centre of the drawing:
    the left and right ends of what is in the bottom few rows."""
    a = np.asarray(im.getchannel("A")) > 128
    h = a.shape[0]
    band = a[int(h * 0.93) :]
    cols = np.where(band.any(axis=0))[0]
    if len(cols) == 0:
        cols = np.where(a.any(axis=0))[0]
    return float(cols.min()) - im.width / 2, float(cols.max()) - im.width / 2


def premult(im: Image.Image, W: int, H: int) -> np.ndarray:
    pad = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pad.paste(im, ((W - im.width) // 2, H - im.height))
    p = np.asarray(pad).astype(np.float32) / 255.0
    return np.dstack([p[..., :3] * p[..., 3:4], p[..., 3:4]])


dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
dis.setFinestScale(0)
dis.setPatchSize(12)
dis.setPatchStride(4)
dis.setVariationalRefinementIterations(8)


def gray(p: np.ndarray) -> np.ndarray:
    comp = p[..., :3] + 0.5 * (1.0 - p[..., 3:4])
    return (cv2.cvtColor(comp, cv2.COLOR_RGB2GRAY) * 255.0).astype(np.uint8)


def warp(p: np.ndarray, flow: np.ndarray) -> np.ndarray:
    h, w = flow.shape[:2]
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    return cv2.remap(p, gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))


def between(a: np.ndarray, b: np.ndarray, t: float) -> np.ndarray:
    """Like tween-sprites.py: flow both ways, warped to the moment, blended, the nearer pose winning where they disagree."""
    if t <= 0:
        return a
    if t >= 1:
        return b
    ga, gb = gray(a), gray(b)
    f01 = dis.calc(ga, gb, None)
    f10 = dis.calc(gb, ga, None)
    ft0 = -(1 - t) * t * f01 + t * t * f10
    ft1 = (1 - t) * (1 - t) * f01 - t * (1 - t) * f10
    wa, wb = warp(a, ft0), warp(b, ft1)
    diff = np.abs(wa - wb).max(axis=2, keepdims=True)
    # When the two drawings are too far apart for the flow (a stretched landing and a gathered
    # crouch), both warps come out smeared: then cut cleanly from one drawing to the other half way.
    union = (wa[..., 3] > 0.5) | (wb[..., 3] > 0.5)
    miss = float((diff[..., 0] > 0.25)[union].mean()) if union.any() else 0.0
    if VERBOSE:
        print(f"  between t={t:.2f} miss={miss:.2f}", file=sys.stderr)
    if miss > MISS:
        return a if t < 0.5 else b
    # The drawings of a hop differ far more than two frames of a paw: where they disagree at all the
    # nearer one wins outright, or an ear shows twice.
    m = np.clip((diff - 0.05) / 0.1, 0, 1)
    w = (1 - m) * t + m * (1.0 if t >= 0.5 else 0.0)
    return (1 - w) * wa + w * wb


def to_image(p: np.ndarray) -> Image.Image:
    alpha = np.clip((p[..., 3:4] - 0.30) / 0.45, 0, 1)
    alpha = alpha * alpha * (3 - 2 * alpha)
    rgb = p[..., :3] / np.maximum(p[..., 3:4], 1e-3)
    return Image.fromarray((np.dstack([np.clip(rgb, 0, 1), alpha]) * 255.0 + 0.5).astype(np.uint8), "RGBA")


def smooth(t: float) -> float:
    return t * t * (3 - 2 * t)


def build(gait: str, spec: dict) -> float:
    prefix, n = COUNTS[gait]
    keys = spec["keys"]
    names = sorted({k[0] for k in keys})
    raw = {k: crop(Image.open(folder / f"{k}.webp").convert("RGBA")) for k in names}
    k = spec["size"]
    ims = {name: im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS) for name, im in raw.items()}
    S = spec["stride"] * SW
    L = spec["lift"] * SH
    # Where each key sits: its centre, in ground coordinates, with the first hind feet at 0.
    hx0, fx0 = feet(ims[keys[0][0]])
    f0 = -hx0 + fx0
    xs = []
    for name, _, ground in keys:
        hx, fx = feet(ims[name])
        xs.append(-hx if ground == "hind" else f0 + S - fx if ground == "front" else None)
    # The cycle closes on the first key one stride on.
    cyc = keys + [(keys[0][0], 1.0, "hind")]
    xs.append(xs[0] + S)
    for i, x in enumerate(xs):
        if x is None:
            a = max(j for j in range(i) if xs[j] is not None)
            b = min(j for j in range(i + 1, len(xs)) if xs[j] is not None)
            xs[i] = xs[a] + (xs[b] - xs[a]) * (cyc[i][1] - cyc[a][1]) / (cyc[b][1] - cyc[a][1])
    # The arc: from the last key with the hind feet down to the first with the front paws down.
    up = max(c[1] for c in cyc if c[2] == "hind" and c[1] < 1)
    down = min(c[1] for c in cyc if c[2] == "front")

    W = max(im.width for im in ims.values())
    H = max(im.height for im in ims.values())
    P = {name: premult(im, W, H) for name, im in ims.items()}
    frames = []
    for f in range(n):
        ph = f / n
        i = max(j for j in range(len(cyc) - 1) if cyc[j][1] <= ph)
        a, b = cyc[i], cyc[i + 1]
        t = (ph - a[1]) / (b[1] - a[1])
        if VERBOSE:
            print(f"{gait} {f}: {a[0]} -> {b[0]}", file=sys.stderr)
        img = P[a[0]] if a[0] == b[0] else between(P[a[0]], P[b[0]], smooth(t))
        x = xs[i] + (xs[i + 1] - xs[i]) * t
        lift = L * math.sin(math.pi * (ph - up) / (down - up)) if up < ph < down else 0.0
        frames.append((img, x - S * ph, lift))
    # Centre the cycle on the body: on average the drawing sits where the body is.
    c = sum(f[1] for f in frames) / n
    reach = max(abs(f[1] - c) for f in frames)
    CW = int(math.ceil(W + 2 * reach + 8))
    CH = int(math.ceil(H + L + 4))
    for idx, (img, off, lift) in enumerate(frames):
        dx = CW / 2 + (off - c) - W / 2
        dy = CH - H - lift
        M = np.float32([[1, 0, dx], [0, 1, dy]])
        out = cv2.warpAffine(img, M, (CW, CH), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
        to_image(out).save(folder / f"{prefix}{idx:02d}.webp", "WEBP", quality=92, method=6)
    return S


strides = {g: round(build(g, spec), 1) for g, spec in HOPS[cid].items() if only in (None, g)}
if debug:
    shots = [Image.open(folder / f"gw{i:02d}.webp") for i in range(0, 32, 2)]
    sheet = Image.new("RGBA", (sum(s.width for s in shots), max(s.height for s in shots)), (235, 235, 240, 255))
    x = 0
    for s in shots:
        sheet.alpha_composite(s, (x, sheet.height - s.height))
        x += s.width
    sheet.save(debug)
print(json.dumps({"id": cid, "strides": strides}))
