#!/usr/bin/env -S uv run --with opencv-python-headless --with pillow --with numpy python
"""Builds real walk, trot and run cycles from one standing drawing, so the legs move in a true gait.

Usage: tools/rig-gait.py <sprite-dir> [--debug <file.png>]

Eight separately drawn walk frames never agree with each other well enough for a cycle, so this
does what cutout animation does. It cuts the four legs out of `stand.webp`, keeps the body as it is,
and moves every leg on its own clock:

- walk: lateral sequence (hind, fore on the same side, then the other side), each foot on the
  ground 66% of the cycle, so three feet carry the body most of the time, like a real cat.
- trot: diagonal pairs move together, half the cycle on the ground.
- run: a bound, the hind pair and the front pair, a third of the cycle on the ground, the body
  stretching and gathering and lifting off between.

A planted foot slides back at a steady speed, the body bobs twice per cycle (once a cycle in the
run), the head stays steadier than the body and the tail sways a little behind the beat. Every
frame comes from the same drawing, so nothing flickers.

Writes gw00..gw31 (walk), gt00..gt23 (trot) and gr00..gr19 (run) and prints the stride of each
gait in source pixels as JSON. A planted foot moves exactly one stride per cycle, so a player that
advances the cycle by distance walked over stride keeps the feet from sliding.
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

# Room around the drawing for a leg that reaches forward and a body that lifts off.
PAD_X, PAD_TOP = 26, 30

src = Image.open(folder / "stand.webp").convert("RGBA")
W0, H0 = src.size
W, H = W0 + 2 * PAD_X, H0 + PAD_TOP
canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
canvas.paste(src, (PAD_X, PAD_TOP))
rgba = np.asarray(canvas).astype(np.float32) / 255.0
alpha = rgba[..., 3]
P = np.dstack([rgba[..., :3] * alpha[..., None], alpha])  # premultiplied, so soft edges warp cleanly
lum = 0.3 * rgba[..., 0] + 0.59 * rgba[..., 1] + 0.11 * rgba[..., 2]
solid = alpha > 0.5
ys, xs = np.nonzero(solid)
ground, top = int(ys.max()), int(ys.min())


def runs(row: np.ndarray) -> list[tuple[int, int]]:
    edges = np.flatnonzero(np.diff(np.concatenate([[0], row.astype(np.int8), [0]])))
    return list(zip(edges[0::2].tolist(), edges[1::2].tolist()))


# 1. The feet: what touches the floor. Two legs side by side can touch at the paws, then the
#    widest run is two feet and is split at its darkest column (the outline between them).
band = solid[ground - int(0.05 * H0): ground + 1]
feet = [(l, r) for l, r in runs(band.any(axis=0)) if r - l > 0.02 * W0]
cost_band = (alpha * (lum + 0.15))[ground - int(0.05 * H0): ground + 1].sum(axis=0)
while len(feet) < 4:
    i = int(np.argmax([r - l for l, r in feet]))
    l, r = feet[i]
    lo, hi = l + int(0.3 * (r - l)), r - int(0.3 * (r - l))
    cut = lo + int(np.argmin(cost_band[lo:hi]))
    feet[i: i + 1] = [(l, cut), (cut, r)]
while len(feet) > 4:
    i = int(np.argmin([r - l for l, r in feet]))
    j = i - 1 if i == len(feet) - 1 or (i > 0 and feet[i][0] - feet[i - 1][1] < feet[i + 1][0] - feet[i][1]) else i + 1
    a_, b_ = sorted([i, j])
    feet[a_: b_ + 1] = [(feet[a_][0], feet[b_][1])]
centres = [(l + r) / 2 for l, r in feet]

# 2. The belly: the underside between the hind pair and the front pair. Everything below it
#    in each pair's half is leg.
gap_lo, gap_hi = feet[1][1], feet[2][0]
xg = int((gap_lo + gap_hi) / 2)
cols = range(gap_lo + (gap_hi - gap_lo) // 4, max(gap_lo + (gap_hi - gap_lo) // 4 + 1, gap_hi - (gap_hi - gap_lo) // 4))
under = []
for x in cols:
    col = solid[: ground + 1, x]
    filled = np.flatnonzero(col)
    under.append(filled.max() if len(filled) else ground)
y_cut = int(np.median(under)) + 2
L = ground - y_cut


def seam(cl: float, cr: float) -> np.ndarray:
    """The best line between two legs of a pair, from the floor up to the belly: it follows gaps and
    the drawn outline (dark pixels), like seam carving."""
    lo, hi = int(cl + 0.25 * (cr - cl)), int(cr - 0.25 * (cr - cl)) + 1
    c = (alpha * (lum + 0.15))[y_cut: ground + 1, lo:hi]
    n, w = c.shape
    acc = c.copy()
    back = np.zeros((n, w), np.int8)
    for y in range(n - 2, -1, -1):
        prev = acc[y + 1]
        options = np.stack([np.r_[np.inf, prev[:-1]], prev, np.r_[prev[1:], np.inf]])
        k = np.argmin(options + np.array([[0.04], [0.0], [0.04]]), axis=0)
        acc[y] += options[k, np.arange(w)] + np.where(k == 1, 0, 0.04)
        back[y] = k - 1
    path = np.zeros(n, np.int64)
    path[0] = int(np.argmin(acc[0]))
    for y in range(1, n):
        path[y] = min(w - 1, max(0, path[y - 1] + back[y - 1][path[y - 1]]))
    full = np.zeros(H, np.int64)
    full[y_cut: ground + 1] = lo + path
    return full


# 3. The four legs. Only the parts below the belly that reach the floor (a tail hanging low is not
#    a leg). In each pair the leg towards the tail is the near one, drawn in front of the body.
below = solid.copy()
below[: y_cut + 1] = False
count, labels = cv2.connectedComponents(below.astype(np.uint8), connectivity=8)
foot_rows = slice(ground - int(0.05 * H0), ground + 1)
touching = set(np.unique(labels[foot_rows][below[foot_rows]]).tolist()) - {0}
legzone = np.isin(labels, list(touching)) & (alpha > 0.01)
legzone[: y_cut + 1] = False
# A leg stays near its foot. Whatever reaches far behind the hind foot or past the front one is
# a tail or a chest hanging low, and stays with the body.
reach = 0.3 * np.mean([r - l for l, r in feet])
cols_ok = (np.arange(W) >= feet[0][0] - reach) & (np.arange(W) <= feet[3][1] + reach)
legzone &= cols_ok[None, :]
soft = (alpha > 0.01)
soft[: y_cut + 1] = False
# Soft edge pixels next to a leg belong to it too.
legzone |= soft & (cv2.dilate(legzone.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0)

X = np.arange(W, dtype=np.float32)[None, :].repeat(H, axis=0)
Y = np.arange(H, dtype=np.float32)[:, None].repeat(W, axis=1)
seam_h, seam_f = seam(centres[0], centres[1]), seam(centres[2], centres[3])
# A body that keeps its pixels a little below the cut and legs that start a little above it overlap,
# so their soft edges never leave a hairline gap between them.
OVERLAP = 3
seam_h[y_cut - OVERLAP: y_cut + 1] = seam_h[y_cut + 1]
seam_f[y_cut - OVERLAP: y_cut + 1] = seam_f[y_cut + 1]
grown = legzone.copy()
for k in range(1, OVERLAP + 1):
    grown[:-k] |= legzone[k:] & (alpha[:-k] > 0.01)
hind = grown & (X < xg)
front = grown & (X >= xg)
masks = {
    "near_hind": hind & (X < seam_h[:, None]),
    "far_hind": hind & (X >= seam_h[:, None]),
    "near_fore": front & (X < seam_f[:, None]),
    "far_fore": front & (X >= seam_f[:, None]),
}
legs_all = legzone.copy()
legs_all[: y_cut + 3] = False

# The outline colour, from the darkest pixels just inside the silhouette.
ring = (cv2.erode(solid.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=1) > 0) & ~(cv2.erode(solid.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=4) > 0)
ring_rgb = rgba[..., :3][ring & (alpha > 0.9)]
ring_l = lum[ring & (alpha > 0.9)]
ink = np.median(ring_rgb[ring_l <= np.quantile(ring_l, 0.25)], axis=0)
ink_l = float(0.3 * ink[0] + 0.59 * ink[1] + 0.11 * ink[2])


def layer(mask: np.ndarray, other: np.ndarray) -> np.ndarray:
    """A leg on its own, with a drawn outline along the cut where it touched the other leg."""
    out = P * mask[..., None]
    near_other = cv2.dilate(other.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    edge = mask & near_other & (Y > y_cut + 5)
    a_ = out[..., 3:4]
    want = np.where((lum > ink_l + 0.05)[..., None] & edge[..., None], 0.85, 0.0)
    rgb = out[..., :3] * (1 - want) + ink[None, None, :] * a_ * want
    return np.dstack([rgb, a_])


L_LAYERS = {
    "near_hind": layer(masks["near_hind"], masks["far_hind"]),
    "far_hind": layer(masks["far_hind"], masks["near_hind"]),
    "near_fore": layer(masks["near_fore"], masks["far_fore"]),
    "far_fore": layer(masks["far_fore"], masks["near_fore"]),
}
BODY = P * (~legs_all)[..., None]

# The tail: everything behind the rump, weighted more towards the tip. The rump is the back edge
# of the body just above the hind legs, and the tail turns about the point where it leaves it.
rump_rows = solid[int(y_cut - 0.2 * (y_cut - top)): y_cut - 2]
x_rump = int(np.min([np.flatnonzero(r).min() for r in rump_rows if r.any()]))
# A tail that hangs down reaches into those rows too, so the rump is never far behind the hind foot.
x_base = max(x_rump, int(feet[0][0] - 0.6 * (feet[0][1] - feet[0][0])))
x_min = int(xs.min())
span = max(8, x_base - x_min)
root_col = solid[: y_cut, max(0, x_base - 6)]
root_runs = runs(root_col)
# The run nearest the rump in that column is the root (a curled tail can cross the column twice).
root = max(root_runs, key=lambda r_: r_[1]) if root_runs else (y_cut - 20, y_cut - 10)
pivot = (float(x_base), float((root[0] + root[1]) / 2))
w_tail = np.clip((x_base - X) / span, 0, 1) ** 1.5
# The head: up front and above the neck. It moves less than the body, the way an animal keeps its eyes level.
y_neck = top + 0.5 * (y_cut - top)
w_head = np.clip((y_neck - Y) / (0.12 * H0) + 0.5, 0, 1) * np.clip((X - xg) / (0.12 * W0) + 0.5, 0, 1)
CX = float(xs.mean())


def smoother(u: float) -> float:
    return u * u * u * (u * (6 * u - 15) + 10)


def foot(ph: float, duty: float, amp: float, lift_h: float) -> tuple[float, float, float]:
    """Where a foot is, relative to standing straight: forward offset, how high it is lifted, and how
    far into the swing it is (0 while it is on the ground)."""
    if ph < duty:
        return amp * (1 - 2 * ph / duty), 0.0, 0.0
    u = (ph - duty) / (1 - duty)
    return -amp + 2 * amp * smoother(u), lift_h * math.sin(math.pi * u) ** 0.8, u


def warp(img: np.ndarray, mx: np.ndarray, my: np.ndarray) -> np.ndarray:
    return cv2.remap(img, mx.astype(np.float32), my.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))


def over(dst: np.ndarray, src_: np.ndarray) -> np.ndarray:
    return src_ + dst * (1 - src_[..., 3:4])


GAITS = {
    # duty: share of the cycle a foot is on the ground. angle: how far a leg swings, each way. lift: how
    # high a paw comes up, as a share of the leg. phase: when each leg starts its stance. bob: up and down
    # (share of height), bobs per cycle and when the body is lowest. stretch, pitch (deg) and tail (deg)
    # swing once per cycle. flick: how far the lower leg bends back in the air.
    "walk": dict(duty=0.66, angle=30, lift=0.12, phase={"near_hind": 0.0, "near_fore": 0.25, "far_hind": 0.5, "far_fore": 0.75},
                 bob=0.011, bobs=2, bob_at=0.30, stretch=0.0, pitch=0.0, tail=5.0, frames=32, flick=0.35, name="gw"),
    "trot": dict(duty=0.5, angle=32, lift=0.17, phase={"near_hind": 0.0, "far_fore": 0.02, "far_hind": 0.5, "near_fore": 0.52},
                 bob=0.016, bobs=2, bob_at=0.25, stretch=0.0, pitch=0.6, tail=7.0, frames=24, flick=0.5, name="gt"),
    # A half bound: the hind pair lands, then the front pair. The body flies twice per stride, once
    # stretched out after the hind legs push off, once gathered after the front legs do.
    "run": dict(duty=0.3, angle=40, lift=0.3, phase={"near_hind": 0.0, "far_hind": 0.06, "near_fore": 0.48, "far_fore": 0.56},
                bob=0.03, bobs=2, bob_at=0.18, stretch=0.06, pitch=4.0, tail=10.0, frames=20, flick=0.8, name="gr"),
}

ORDER_BACK = ["far_hind", "far_fore"]
ORDER_FRONT = ["near_hind", "near_fore"]
HIP_X = {k: float(X[m].mean()) for k, m in masks.items()}
BAND = max(0, y_cut - OVERLAP - 40)


def undo_body(xo, yo, bob_v, k, pitch, w=1.0):
    """Where a body pixel comes from: the body is stretched about its middle, tilted about the belly and
    bobbed, so this undoes the bob, the tilt and the stretch. `w` applies only part of it (down a leg)."""
    sy = yo - w * bob_v
    c, s_ = np.cos(-pitch * w), np.sin(-pitch * w)
    px, py = xo - CX, sy - y_cut
    sx, sy = CX + c * px - s_ * py, y_cut + s_ * px + c * py
    return CX + (sx - CX) / (1 + k * w), sy


def frame(g: dict, ph: float) -> np.ndarray:
    amp = L * math.tan(math.radians(g["angle"]))
    bob = g["bob"] * H0 * math.cos(2 * math.pi * g["bobs"] * (ph - g["bob_at"]))
    # Stretched out just after the hind legs push off, gathered as they swing under.
    k = g["stretch"] * math.cos(2 * math.pi * (ph - 0.42))
    # Nose up while the hind legs push, nose down when the front legs land (negative is nose up).
    pitch = -math.radians(g["pitch"]) * math.cos(2 * math.pi * (ph - 0.2))
    tail = math.radians(g["tail"])

    # Body: the head takes only part of the bob, and the tail sways a little behind the beat.
    sx, sy = undo_body(X, Y, bob * (1 - 0.7 * w_head), k, pitch)
    th = tail * w_tail * np.sin(2 * math.pi * (ph - 0.18 * w_tail))
    ct, st = np.cos(-th), np.sin(-th)
    dx, dy = sx - pivot[0], sy - pivot[1]
    sx, sy = pivot[0] + ct * dx - st * dy, pivot[1] + st * dx + ct * dy
    body = warp(BODY, sx, sy)

    out = np.zeros_like(P)
    legs = {}
    # Legs only live in a band from a little above the belly to the floor, so only that band is warped.
    Xb, Yb = X[BAND:], Y[BAND:]
    s_out = np.clip((Yb - y_cut) / L, 0, 1)
    # The top of a leg moves exactly as the body does (so nothing tears at the hip), the paw not at all:
    # it is where the gait puts it.
    qx, qy = undo_body(Xb, Yb, bob, k, pitch, 1 - s_out)
    for name, layer_img in L_LAYERS.items():
        f, lift_h, swing = foot((ph + g["phase"][name]) % 1, g["duty"], amp, g["lift"] * L)
        src_y = qy + lift_h * s_out
        s_src = np.clip((src_y - y_cut) / L, 0, 1)
        # Lower leg bends back while the paw is in the air.
        flick = -g["flick"] * amp * math.sin(math.pi * swing) * np.clip((s_src - 0.5) / 0.5, 0, 1) ** 2 if swing > 0 else 0
        src_x = qx - f * s_src ** 1.3 - flick
        full = np.zeros_like(P)
        full[BAND:] = warp(layer_img, src_x, src_y)
        legs[name] = full
    for name in ORDER_BACK:
        out = over(out, legs[name])
    out = over(out, body)
    for name in ORDER_FRONT:
        out = over(out, legs[name])
    return out


def save(p: np.ndarray, name: str) -> None:
    a_ = p[..., 3:4]
    rgb = np.clip(p[..., :3] / np.maximum(a_, 1e-4), 0, 1)
    img = np.dstack([rgb, np.clip(a_, 0, 1)])
    Image.fromarray((img * 255 + 0.5).astype(np.uint8), "RGBA").save(folder / f"{name}.webp", "WEBP", quality=92, method=4)


strides = {}
for gait, g in GAITS.items():
    n = g["frames"]
    if "--masks-only" not in args:
        for i in range(n):
            save(frame(g, i / n), f"{g['name']}{i:02d}")
    strides[gait] = round(2 * L * math.tan(math.radians(g["angle"])) / g["duty"], 1)

if debug:
    vis = (rgba[..., :3] * 255).astype(np.uint8).copy()
    for colour, key in zip([(255, 0, 0), (255, 170, 0), (0, 90, 255), (0, 200, 200)], masks):
        vis[masks[key]] = (0.45 * vis[masks[key]] + 0.55 * np.array(colour)).astype(np.uint8)
    vis[y_cut, :] = (255, 0, 255)
    cv2.circle(vis, (int(pivot[0]), int(pivot[1])), 4, (0, 0, 0), -1)
    Image.fromarray(vis).save(debug)

print(json.dumps({"id": folder.name, "leg": L, "width": W, "strides": strides}))
