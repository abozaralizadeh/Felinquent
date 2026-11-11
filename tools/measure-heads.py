#!/usr/bin/env -S uv run --with pillow --with numpy --with opencv-python-headless python
"""Measures the head in every drawn frame of every character, and writes src/playground/heads.ts.

Usage: tools/measure-heads.py [--one-head] [--clamp 0.7,1.4] [--json out.json] [--reuse out.json]
           [--only id,id] [--keys k,k] [--no-write] [--merge] [--rules]

The drawings were made sheet by sheet, and build-sprites.py sized each sheet (or
each pass of a sheet) by the height or width of one of its frames, not by the animal's head, so the
animal is drawn bigger in some frames than in others. This finds the head in each drawn frame (the
keys in the Drawn arrays of sprites.ts, and the gait frames gw, gt, gr) and gives two things per frame:

- a size fix: what to multiply the frame's drawn size by so its head is the size of the head in
  sit.webp (sitting and lying poses) or stand.webp (standing and moving ones, see STANDING). With
  --one-head every frame is matched to the sitting head, stand.webp included.
- the mouth: where a toy held in the teeth sits, in the frame's pixels as it is now.

How (per character):

1. Two reference heads, cut from sit.webp and stand.webp by a polygon drawn by hand round the head
   (REFS: ears in at a lower weight, body out) with the mouth marked by eye.
2. Pass one, every frame: normalized colour template matching (cv2.matchTemplate, TM_CCOEFF_NORMED,
   the drawing's alpha as the mask) of both heads, as drawn and mirrored, at 17 sizes from 0.55 to
   1.8 and 9 turns from -40 to 40 degrees on a small copy, then the best three places refined twice
   (3% and 2.5 degree steps, then 1% and 1 degree) on bigger copies. The best gives the size, the
   place, the turn and so the mouth.
   Then the other way round: the head found in the frame is cut out and looked for in the reference
   drawing. A head drawn unlike the reference comes out too small one way and too big the other
   (up to 8% each), so the size used is the mean of the two ways.
3. Scores are put on one scale per character (0: drawings without a usable head, 1: plain three
   quarter views, see TRUE_KEYS and NULL_KEYS), because a white fluffy cat scores lower on a true
   match than a black dog on a wrong one.
4. Each pass of frames that build-sprites.py cut at one scale (passes()) gets a size from the
   biggest group of its frames that agree, counting only heads that look like the reference (a head
   in profile or turned to you is found in the right place but at a size up to 20% off). A frame
   whose own head was found well keeps its own size, the rest take their pass's size. The standing
   drawing and the rigged gaits are the standing size, a mirrored turn frame the size of its source.
5. Pass two: frames whose head was not found well are searched again only near their pass's size,
   with turns up to 60 degrees, for the mouth.
6. A fix outside --clamp is dropped (null), and so is anything in SKIP (checked by eye). A few
   passes the matching can't size are sized by eye (BY_EYE), and so are a few frames (BY_EYE_FRAME).

--json keeps every measurement (and --reuse reads it back, so pass one, the slow part, runs once:
about an hour for all nine characters on eight cores; frames drawn since are measured on top).
Plain runs write heads.ts; --only and --keys are for trying things and never write it. --merge
(with --only if you like) adds only the frames heads.ts doesn't have yet and keeps every other value
as it is, for new drawings:
  tools/measure-heads.py --reuse <json> --only biscuit,hazel --merge
--rules measures nothing: it applies the sizes set by rule (BY_BODY, BY_EYE_FRAME) to heads.ts as it
is, keeping every other value and every mouth.
"""
import json
import os
import re
import sys
from multiprocessing import Pool
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / "src/playground/public/sprites"
SPRITES_TS = ROOT / "src/playground/sprites.ts"
OUT_TS = ROOT / "src/playground/heads.ts"
CHARACTERS = ["tabby", "inky", "pearl", "mochi", "bandit", "biscuit", "chili", "clover", "hazel"]

# Per character, per reference drawing: a polygon round the head (ears in, body out; it only has to
# cut, the drawing's own alpha gives the outline) and the mouth, in the drawing's pixels, y down.
REFS: dict[str, dict[str, dict]] = {
    "tabby": {
        "sit": {"poly": [(40, 0), (232, 0), (232, 150), (200, 155), (170, 163), (120, 163), (85, 158), (60, 150), (40, 140)], "face": [(60, 70), (85, 45), (120, 33), (160, 38), (195, 55), (212, 85), (222, 120), (205, 145), (170, 160), (120, 160), (80, 150), (58, 120)], "mouth": (172, 134)},
        "stand": {"poly": [(110, 0), (331, 0), (331, 140), (290, 145), (255, 152), (200, 155), (160, 152), (130, 140), (110, 130)], "face": [(130, 70), (155, 45), (190, 33), (235, 38), (265, 55), (282, 85), (292, 115), (280, 135), (250, 148), (200, 150), (160, 145), (135, 120)], "mouth": (249, 129)},
    },
    "inky": {
        "sit": {"poly": [(37, 0), (253, 0), (253, 140), (225, 150), (190, 158), (140, 160), (100, 155), (70, 145), (37, 130)], "face": [(70, 75), (100, 50), (140, 35), (185, 45), (215, 70), (228, 100), (232, 128), (215, 148), (185, 156), (140, 156), (100, 148), (75, 125)], "mouth": (184, 143)},
        "stand": {"poly": [(150, 0), (360, 0), (360, 135), (325, 143), (295, 152), (245, 156), (200, 150), (175, 135), (165, 120), (150, 100)], "face": [(175, 75), (205, 50), (250, 38), (290, 45), (315, 70), (325, 95), (332, 120), (318, 140), (290, 150), (245, 152), (205, 145), (185, 125)], "mouth": (282, 135)},
    },
    "pearl": {
        "sit": {"poly": [(37, 0), (253, 0), (253, 130), (225, 142), (190, 152), (140, 155), (95, 150), (60, 140), (37, 125)], "face": [(65, 70), (95, 48), (140, 38), (190, 45), (222, 70), (232, 95), (236, 115), (220, 138), (190, 148), (140, 150), (95, 142), (68, 115)], "mouth": (186, 124)},
        "stand": {"poly": [(145, 0), (327, 0), (327, 125), (295, 133), (260, 142), (215, 146), (175, 140), (155, 125), (145, 105)], "face": [(160, 70), (190, 48), (230, 38), (270, 45), (295, 70), (300, 95), (305, 112), (290, 130), (260, 140), (215, 142), (180, 135), (162, 110)], "mouth": (261, 122)},
    },
    "mochi": {
        "sit": {"poly": [(36, 0), (242, 0), (242, 170), (215, 175), (180, 182), (130, 183), (85, 178), (55, 165), (36, 150)], "face": [(60, 100), (90, 70), (135, 55), (185, 60), (205, 80), (215, 110), (225, 140), (215, 165), (180, 178), (130, 178), (90, 168), (65, 140)], "mouth": (177, 160)},
        "stand": {"poly": [(150, 0), (351, 0), (351, 155), (315, 160), (285, 170), (230, 175), (185, 168), (160, 150), (150, 130)], "face": [(165, 95), (195, 70), (240, 55), (285, 62), (305, 85), (312, 110), (318, 135), (305, 155), (275, 168), (225, 170), (185, 160), (165, 135)], "mouth": (280, 150)},
    },
    "bandit": {
        "sit": {"poly": [(37, 0), (251, 0), (251, 130), (225, 140), (195, 152), (140, 158), (95, 152), (55, 140), (37, 125)], "face": [(60, 75), (90, 50), (140, 40), (190, 45), (220, 70), (230, 95), (235, 115), (220, 135), (190, 150), (140, 155), (95, 145), (60, 120)], "mouth": (185, 130)},
        "stand": {"poly": [(130, 0), (323, 0), (323, 125), (300, 135), (265, 145), (210, 150), (170, 142), (150, 128), (130, 105)], "face": [(140, 75), (170, 50), (215, 40), (260, 45), (290, 70), (300, 95), (305, 112), (290, 130), (260, 142), (210, 145), (170, 135), (145, 110)], "mouth": (265, 130)},
    },
    "biscuit": {
        "sit": {"poly": [(40, 0), (269, 0), (269, 120), (240, 125), (215, 135), (180, 145), (140, 145), (110, 138), (90, 135), (40, 135)], "face": [(110, 40), (150, 25), (195, 30), (220, 50), (225, 80), (222, 110), (205, 130), (175, 140), (140, 140), (115, 125), (105, 95), (105, 60)], "mouth": (192, 122)},
        "stand": {"poly": [(115, 0), (355, 0), (355, 115), (320, 120), (295, 130), (265, 140), (220, 142), (195, 135), (175, 135), (150, 140), (115, 135)], "face": [(195, 40), (235, 25), (280, 30), (305, 50), (310, 80), (305, 105), (290, 125), (260, 137), (220, 137), (200, 120), (190, 90), (190, 60)], "mouth": (275, 121)},
    },
    "chili": {
        "sit": {"poly": [(30, 0), (232, 0), (232, 148), (205, 152), (180, 157), (140, 155), (110, 150), (85, 143), (65, 125), (40, 100), (30, 100)], "face": [(70, 85), (95, 55), (130, 42), (175, 45), (200, 65), (212, 100), (216, 128), (205, 150), (175, 158), (130, 155), (95, 145), (72, 120)], "mouth": (180, 149)},
        "stand": {"poly": [(85, 0), (267, 0), (267, 135), (240, 142), (205, 152), (165, 150), (135, 140), (115, 125), (85, 112)], "face": [(120, 85), (145, 55), (180, 42), (225, 45), (250, 65), (262, 100), (266, 125), (255, 142), (220, 152), (175, 150), (140, 140), (122, 115)], "mouth": (229, 139)},
    },
    "clover": {
        "sit": {"poly": [(20, 0), (214, 0), (214, 170), (195, 180), (170, 190), (140, 195), (100, 190), (65, 180), (55, 165), (20, 150)], "face": [(65, 140), (80, 110), (110, 85), (150, 80), (180, 95), (195, 120), (205, 150), (200, 170), (180, 185), (140, 190), (100, 185), (70, 170)], "mouth": (163, 177)},
        "stand": {"poly": [(100, 0), (268, 0), (268, 155), (250, 168), (220, 180), (185, 182), (160, 175), (140, 155), (140, 125), (125, 100), (100, 85)], "face": [(140, 130), (150, 105), (175, 80), (215, 65), (245, 80), (260, 105), (268, 135), (262, 160), (240, 172), (200, 175), (165, 170), (145, 150)], "mouth": (231, 161)},
    },
    "hazel": {
        "sit": {"poly": [(125, 0), (282, 0), (282, 140), (270, 155), (245, 165), (205, 170), (170, 165), (145, 155), (130, 140), (125, 120)], "face": [(135, 110), (150, 80), (185, 60), (230, 62), (258, 85), (270, 110), (278, 130), (268, 150), (240, 162), (195, 165), (160, 155), (140, 135)], "mouth": (234, 148)},
        "stand": {"poly": [(190, 40), (330, 40), (330, 195), (310, 205), (280, 212), (240, 215), (210, 208), (195, 190), (190, 150)], "face": [(200, 160), (215, 130), (245, 115), (285, 115), (310, 135), (322, 160), (328, 180), (318, 198), (290, 208), (250, 210), (215, 200), (200, 180)], "mouth": (292, 195)},
    },
}


# Frames that were cut from one sheet in one pass share one resize factor in build-sprites.py, so
# their animal was drawn at one size: the size is measured per pass, from the frames whose head is
# found, and given to every frame of the pass (one size for a whole animation, nothing pulses).
_TURN_STAND = {
    "tabby": [["turn_s1"], ["turn_s2", "turn_s3"]],
    "inky": [["turn_s1"], ["turn_s2", "turn_s3"]],
    "pearl": [["turn_s1"], ["turn_s2", "turn_s3"]],
    "clover": [["turn_s1", "turn_s2"], ["turn_s3"]],
}
NEW_IDS = {"chili", "clover", "hazel"}


# Each animal's own moves (ADR-067): one sheet, cut at one size (both rows of OWN_PASSES in
# build-sprites.py share the factor), so one pass.
OWN_SIG = {
    "biscuit": "dshake1 dshake2 dshake3 dshake4 wag1 wag2 wag3 chew1 chew2 chew3".split(),
    "chili": "pawup shiver dshake1 dshake2 dshake4 pawup_sit blanket1 blanket2 blanket3".split(),
    "mochi": "listen1 listen2 mouse_up mouse_top mouse_dive mouse_in mouse_out nosepush1 nosepush2".split(),
    "bandit": "inspect toss hold1 hold2 wash1 wash2 wash3 rummage1 rummage2".split(),
    "clover": "thump1 thump2 binky2 flop1 flop2 nibble1 nibble2 earwash1 earwash2".split(),
    "hazel": "nut1 nut2 nut3 cheeks pat1 pat2 flick cling_up cling_down".split(),
}


def passes(ch: str) -> list[tuple[str, list[str]]]:
    out = [
        ("base", ["sit", "walk_a", "walk_b", "sleep", "groom", "jump", "crouch", "loaf", "wave"]),
        ("walk", [f"walk{i}" for i in range(1, 9)] + ["stand"]),
        ("run", ["run1", "run2", "run3", "run4", "run5", "run6", "prep", "fall", "land"]),
        ("face", ["blink", "yawn", "joy", "sulk", "surprise", "sneeze", "lookup", "meow", "curious"]),
        ("action", ["stretch", "knead_a", "knead_b", "swat_a", "swat_b", "scratch", "chase", "retch", "proud"]),
        ("life", ["sleep_b", "sleep_c", "wake", "dangle", "peek", "box", "gift", "back", "rub"]),
        ("extra", ["tiptoe", "wiggle_a", "wiggle_b", "love", "tail_a", "tail_b", "hop"] + ([] if ch in NEW_IDS else ["perch"])),
        ("groom", [f"groom{i}" for i in range(1, 10)]),
        ("spin", [f"spin{i}" for i in range(1, 10)]),
        ("seq", ["stretch1", "stretch2", "stretch3", "shake", "presneeze", "sneeze2", "dazed", "retch1", "retch2"]),
        ("react", ["angry", "hiss", "puffed", "annoyed", "flustered", "play_bow", "leap", "belly", "bark"]),
        ("play", ["shy", "beg", "dig", "sniff", "tumble", "sprawl", "howl", "giggle", "startled"]),
        ("scratch", [f"scratch{i}" for i in range(1, 10)]),
        ("paw", ["paw1", "paw2", "paw3", "paw5", "paw6", "paw7", "paw9"]),
        ("pawfix", ["paw4", "paw8"]),
        ("look", ["sg_down", "sg_ahead", "sg_up", "sg_high", "sg_top", "sg_you", "sg_ear"]),
        ("lookstand", ["tg_down", "tg_ahead", "tg_up", "tg_high", "tg_top", "tg_you", "tg_freeze"]),
        ("voice", ["howl1", "howl2", "howl3", "bark1", "bark2", "giggle1", "giggle2", "chatter1", "meow2"]),
        ("mood", ["cross", "angry1", "angry2", "hiss1", "hiss2", "puff1", "puff2", "jumpback"]),
        ("feel", ["annoyed1", "annoyed2", "fluster1", "shy1", "beg1", "beg2", "headbutt1", "headbutt2", "proud2"]),
        ("gazesit", ["sq_down", "sq_level", "sq_up", "sb_down", "sb_level", "sb_up", "sb_high", "sg_tilt", "sg_tiltyou"]),
        ("gazestand", ["tq_down", "tq_level", "tq_up", "tb_down", "tb_level", "tb_up", "tb_high", "tg_tilt", "tg_tiltyou"]),
        ("lick", ["lick1", "lick2", "lick3", "lick4", "lick5", "chest1", "chest2", "lips1", "lips2"]),
        ("potty", ["pee1", "pee2", "poop1", "poop2", "pottyback", "cover1", "cover2", "pawshake", "sheepish"]),
        ("trans_stand", ["stand2"]),
        ("trans_sit", ["sit2", "lowering", "loaf2", "drowsy", "curl", "deep", "waking"]),
        ("trans_mid", ["sitting_down"]),
        ("perch", ["perch_fwd", "perch_back", "perch_down", "perch_doze", "perch_kick", "perch_you"] + (["perch"] if ch in NEW_IDS else [])),
        ("peek", ["peek_back", "peek_duck", "peek_up"]),
        ("loaf", ["loaf_blink", "loaf_up", "loaf_back", "loaf_drowse"]),
        ("sprawl", ["sprawl_stretch", "roll1", "roll2", "belly_l", "belly_r"]),
        ("bow", ["bow_down", "bow_l", "bow_up", "binky"]),
        ("hop", ["hop_crouch", "hop_up", "hop_land", "wiggle"]),
        ("sniff", ["sniff1", "sniff2", "sniff3"]),
        ("dig", ["dig1", "dig2", "dig3"]),
        ("stalk", ["stalk1", "stalk2", "stalk3"]),
        ("turn_sit", ["turn_t1", "turn_t2", "turn_t3", "slow_blink"]),
    ]
    for i, keys in enumerate(_TURN_STAND.get(ch, [["turn_s1", "turn_s2", "turn_s3"]])):
        out.append((f"turn_stand{i + 1}", keys))
    if ch in OWN_SIG:
        out.append(("sig", OWN_SIG[ch]))
    if ch in ("clover", "hazel"):
        # Their gaits are their drawn hops placed on the ground (tools/hop-gait.py), one cycle each.
        out += [(f"gait_{g}", [f"g{g}{i:02d}" for i in range(n)]) for g, n in (("w", 32), ("t", 24), ("r", 20))]
    return out


# A frame that is another frame mirrored (the far half of a turn), or the standing drawing with the
# legs moved (the rigged gaits of the cats and dogs), has that frame's size.
MIRRORED = {"turn_s4": "turn_s2", "turn_s5": "stand", "turn_t4": "turn_t2", "turn_t5": "sit"}
RIGGED = re.compile(r"^g[wtr]\d\d$")

# Standing and moving poses: their head is measured against the standing drawing's head. Everything
# else (sitting, lying, loafing, perched, peeking) against the sitting drawing's head.
STANDING = set(
    "walk_a walk_b jump crouch walk1 walk2 walk3 walk4 walk5 walk6 walk7 walk8 stand run1 run2 run3 run4 run5 run6 prep fall land "
    "stretch chase retch dangle gift rub tiptoe wiggle_a wiggle_b stretch2 stretch3 shake retch1 retch2 angry hiss puffed play_bow leap "
    "dig sniff startled turn_s1 turn_s2 turn_s3 turn_s4 turn_s5 stand2 tg_down tg_ahead tg_up tg_high tg_top tg_you tg_freeze "
    "tq_down tq_level tq_up tb_down tb_level tb_up tb_high tg_tilt tg_tiltyou bow_down bow_l bow_up binky sniff1 sniff2 sniff3 "
    "dig1 dig2 dig3 stalk1 stalk2 stalk3 cross angry1 angry2 hiss1 hiss2 puff1 puff2 jumpback "
    "pee1 pee2 poop1 poop2 pottyback cover1 cover2 pawshake sheepish "
    "dshake1 dshake2 dshake3 dshake4 wag1 wag2 wag3 pawup shiver listen1 listen2 mouse_up mouse_top mouse_dive mouse_in "
    "mouse_out nosepush1 nosepush2 rummage1 rummage2 thump1 thump2 binky2 nibble1 nibble2 pat1 pat2 flick cling_up cling_down".split()
)


def standing(key: str) -> bool:
    return key in STANDING or bool(RIGGED.match(key))


BG = 128.0
EAR_WEIGHT = float(os.environ.get("EAR_WEIGHT", "0.3"))
FEAT = os.environ.get("FEAT", "rgb")
GRAD_W = float(os.environ.get("GRAD_W", "1.0"))
SCALES = np.geomspace(0.55, 1.8, 17)
ANGLES = np.arange(-40, 40.1, 10.0)
D1 = 0.22  # coarse resolution
D2 = 0.5  # first refinement
D3 = 0.8  # last refinement


def drawn_keys() -> tuple[list[str], list[str]]:
    src = SPRITES_TS.read_text()
    union = re.search(r"type Drawn\s*=(.*?);", src, re.S).group(1)
    keys: list[str] = []
    for name in re.findall(r"typeof (\w+)\)\[number\]", union):
        arr = re.search(r"const " + name + r"\s*=\s*\[(.*?)\]\s*as const", src, re.S).group(1)
        keys += re.findall(r'"([^"]+)"', arr)
    gaits: list[str] = []
    for p, n in re.findall(r'gait\("(g[wtr])",\s*(\d+)\)', src):
        gaits += [f"{p}{i:02d}" for i in range(int(n))]
    return list(dict.fromkeys(keys)), gaits


def load(ch: str, key: str) -> tuple[np.ndarray, np.ndarray]:
    """The frame on a grey background (float RGB) and its alpha (0 to 1)."""
    im = np.asarray(Image.open(SPRITES / ch / f"{key}.webp").convert("RGBA"), dtype=np.float32)
    a = im[:, :, 3:4] / 255.0
    rgb = im[:, :, :3] * a + BG * (1 - a)
    return rgb, a[:, :, 0]


def template(ch: str, ref: str) -> dict:
    rgb, a = load(ch, ref)
    spec = REFS[ch][ref]
    poly = np.zeros(a.shape, np.uint8)
    cv2.fillPoly(poly, [np.array(spec["poly"], np.int32)], 1)
    face = np.zeros(a.shape, np.uint8)
    cv2.fillPoly(face, [np.array(spec["face"], np.int32)], 1)
    mask = a * poly * np.where(face > 0, 1.0, EAR_WEIGHT).astype(np.float32)
    ys, xs = np.nonzero(mask > 0.05)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    mx, my = spec["mouth"]
    return {"rgb": rgb[y0:y1, x0:x1].copy(), "mask": mask[y0:y1, x0:x1].copy(), "mouth": (mx - x0, my - y0), "origin": (x0, y0), "ref": ref}


def warp(t: dict, s: float, ang: float, d: float, mirror: bool):
    """The template scaled by s*d and turned by ang degrees, on a canvas that holds it all, and the
    affine map from the reference drawing's pixels to that canvas."""
    rgb, mask = t["rgb"], t["mask"]
    h, w = mask.shape
    x0, y0 = t["origin"]
    # reference pixels to crop pixels (mirrored if asked)
    A = np.array([[1.0, 0, -x0], [0, 1.0, -y0], [0, 0, 1]])
    if mirror:
        rgb, mask = rgb[:, ::-1], mask[:, ::-1]
        A = np.array([[-1.0, 0, w - 1], [0, 1, 0], [0, 0, 1]]) @ A
    # Shrink first with area averaging, so the warp itself only does a mild resample.
    pre = min(1.0, s * d * 1.4)
    if pre < 1.0:
        rgb = cv2.resize(np.ascontiguousarray(rgb), None, fx=pre, fy=pre, interpolation=cv2.INTER_AREA)
        mask = cv2.resize(np.ascontiguousarray(mask), None, fx=pre, fy=pre, interpolation=cv2.INTER_AREA)
        A = np.array([[pre, 0, 0.5 * pre - 0.5], [0, pre, 0.5 * pre - 0.5], [0, 0, 1]]) @ A
    hh, ww = mask.shape
    k = s * d / pre
    c = ((ww - 1) / 2, (hh - 1) / 2)
    M = cv2.getRotationMatrix2D(c, ang, k)
    corners = np.array([[0, 0, 1], [ww, 0, 1], [0, hh, 1], [ww, hh, 1]], np.float64) @ M.T
    lo = corners.min(0)
    hi = corners.max(0)
    M[:, 2] -= lo
    size = (int(np.ceil(hi[0] - lo[0])), int(np.ceil(hi[1] - lo[1])))
    out_rgb = cv2.warpAffine(np.ascontiguousarray(rgb), M, size, flags=cv2.INTER_LINEAR, borderValue=(BG, BG, BG))
    out_mask = cv2.warpAffine(np.ascontiguousarray(mask), M, size, flags=cv2.INTER_LINEAR, borderValue=0)
    A = np.vstack([M, [0, 0, 1]]) @ A
    return feats(out_rgb.astype(np.float32)), out_mask.astype(np.float32), A


def feats(rgb: np.ndarray) -> np.ndarray:
    """What is matched: the colour, and (FEAT=grad) the strength of its edges as a fourth channel."""
    if FEAT == "rgb":
        return rgb
    lum = rgb.mean(axis=2)
    gx = cv2.Sobel(lum, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(lum, cv2.CV_32F, 0, 1, ksize=3)
    g = np.sqrt(gx * gx + gy * gy) * GRAD_W
    return np.dstack([rgb, g]).astype(np.float32)


def score_map(img: np.ndarray, tpl: np.ndarray, msk: np.ndarray) -> np.ndarray:
    if tpl.shape[0] > img.shape[0] or tpl.shape[1] > img.shape[1] or tpl.shape[0] < 4 or tpl.shape[1] < 4:
        return np.full((1, 1), -1.0, np.float32)
    r = cv2.matchTemplate(img, tpl, cv2.TM_CCOEFF_NORMED, mask=msk)
    r[~np.isfinite(r)] = -1
    return r


def prep(rgb: np.ndarray, pad: int, d: float) -> np.ndarray:
    big = cv2.copyMakeBorder(rgb, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(BG, BG, BG))
    return feats(cv2.resize(big, None, fx=d, fy=d, interpolation=cv2.INTER_AREA))


_T: dict = {}


def init(ch: str, refs: list[str] | None = None):
    _T.clear()
    _T["ch"] = ch
    _T["refs"] = {r: template(ch, r) for r in (refs or REFS[ch])}
    _T["cache"] = {}


def coarse_tpl(ref: str, m: bool, s: float, a: float):
    k = (ref, m, round(float(s), 4), round(float(a), 2))
    c = _T["cache"]
    if k not in c:
        c[k] = warp(_T["refs"][ref], s, a, D1, m)
    return c[k]


def to_frame(A: np.ndarray, ox: int, oy: int, d: float, pad: int) -> np.ndarray:
    """The map from reference pixels to frame pixels, for a template canvas placed at (ox, oy) in the padded image at resolution d."""
    P = np.array([[1 / d, 0, (ox + 0.5) / d - 0.5 - pad], [0, 1 / d, (oy + 0.5) / d - 0.5 - pad], [0, 0, 1]])
    return (P @ A)[:2]


def local(img: np.ndarray, d: float, pad: int, ref: str, m: bool, s: float, a: float, cx: float, cy: float, slack: int):
    """Matches one template near a centre (frame pixels) and gives the score, the map and the new centre."""
    f, tmsk, A = warp(_T["refs"][ref], s, a, d, m)
    th, tw = tmsk.shape
    px, py = (cx + pad + 0.5) * d - 0.5, (cy + pad + 0.5) * d - 0.5
    x0 = int(max(0, px - tw / 2 - slack))
    y0 = int(max(0, py - th / 2 - slack))
    x1 = int(min(img.shape[1], px + tw / 2 + slack + 1))
    y1 = int(min(img.shape[0], py + th / 2 + slack + 1))
    r = score_map(img[y0:y1, x0:x1], f, tmsk)
    y, x = np.unravel_index(int(np.argmax(r)), r.shape)
    T = to_frame(A, x0 + x, y0 + y, d, pad)
    c = T @ np.array([*head_centre(ref), 1.0])
    return float(r[y, x]), T, float(c[0]), float(c[1])


def head_centre(ref: str) -> tuple[float, float]:
    t = _T["refs"][ref]
    h, w = t["mask"].shape
    return t["origin"][0] + w / 2, t["origin"][1] + h / 2


def search(rgb: np.ndarray, scales, angles, mirrors, lo: float = 0.0, hi: float = 9.0, keep: int = 3, ranges: dict | None = None) -> dict:
    """The best place, size and turn of a reference head in one frame: a coarse search over every
    size and turn, then the best few refined twice at finer steps and higher resolution."""
    pad = int(0.4 * max(max(t["mask"].shape) for t in _T["refs"].values()))
    img1 = prep(rgb, pad, D1)
    cands = []
    for ref in _T["refs"]:
        for m in mirrors:
            for s in scales if ranges is None else np.geomspace(ranges[ref][0], ranges[ref][1], 5):
                for a in angles:
                    f, tmsk, A = coarse_tpl(ref, m, s, a)
                    r = score_map(img1, f, tmsk)
                    y, x = np.unravel_index(int(np.argmax(r)), r.shape)
                    T = to_frame(A, x, y, D1, pad)
                    c = T @ np.array([*head_centre(ref), 1.0])
                    cands.append((float(r[y, x]), ref, m, float(s), float(a), float(c[0]), float(c[1])))
    cands.sort(key=lambda c: -c[0])
    picked = []
    for c in cands:
        if all(abs(np.log(c[3] / p[3])) > 0.1 or abs(c[5] - p[5]) + abs(c[6] - p[6]) > 25 or c[1] != p[1] or c[2] != p[2] for p in picked):
            picked.append(c)
        if len(picked) == keep:
            break
    img2 = prep(rgb, pad, D2)
    img3 = prep(rgb, pad, D3)
    best = None
    for _, ref, m, s0, a0, cx, cy in picked:
        if ranges is not None:
            lo, hi = ranges[ref][0] * 0.97, ranges[ref][1] * 1.03
        top = None
        for s in s0 * np.geomspace(0.94, 1.06, 5):
            if not lo <= s <= hi:
                continue
            for a in np.arange(a0 - 5, a0 + 5.1, 2.5):
                v, T, nx, ny = local(img2, D2, pad, ref, m, s, a, cx, cy, int(6 + 0.08 * 200 * s * D2))
                if top is None or v > top[0]:
                    top = (v, s, a, nx, ny)
        if top is None:
            continue
        _, s1, a1, cx1, cy1 = top
        for s in s1 * np.geomspace(0.97, 1.03, 7):
            if not lo <= s <= hi:
                continue
            for a in np.arange(a1 - 2, a1 + 2.1, 1.0):
                v, T, nx, ny = local(img3, D3, pad, ref, m, s, a, cx1, cy1, 5)
                if best is None or v > best["score"]:
                    best = {"score": v, "ref": ref, "mirror": m, "scale": float(s), "angle": float(a), "T": T.tolist()}
    if best is None:
        return {"score": -1.0, "ref": None, "mirror": False, "scale": None, "angle": None, "T": None}
    best["coarse"] = [round(c[0], 3) for c in cands[:3]]
    return best


def finish(key: str, rgb: np.ndarray, best: dict) -> dict:
    best["key"] = key
    best["size"] = [rgb.shape[1], rgb.shape[0]]
    if best["T"] is not None:
        T = np.array(best["T"])
        mxy = T @ np.array([*REFS[_T["ch"]][best["ref"]]["mouth"], 1.0])
        best["mouth_img"] = [float(mxy[0]), float(mxy[1])]
    else:
        best["mouth_img"] = None
    return best


def measure(key: str) -> dict:
    """Pass one: any size from SCALES, any turn from ANGLES, as drawn and mirrored."""
    rgb, _ = load(_T["ch"], key)
    return finish(key, rgb, search(rgb, SCALES, ANGLES, [False, True]))


def measure_near(job: tuple[str, dict]) -> dict:
    """Pass two: a frame whose head was not found, searched again only near the size its sheet was
    drawn at (lo to hi in the units of each reference) and with more turn."""
    key, ranges = job
    rgb, _ = load(_T["ch"], key)
    return finish(key, rgb, search(rgb, None, np.arange(-60, 60.1, 10.0), [False, True], ranges=ranges))


def measure_back(job: tuple[str, dict]) -> dict:
    """The other way round: the head as found in the frame, cut out with the reference's polygon
    carried over, searched for in the reference drawing. A head drawn unlike the reference (turned
    more, another face, ears flat) comes out too small one way and too big the other, so the size
    used is the mean of the two, as for the standing head next to the sitting one."""
    key, r = job
    ch = _T["ch"]
    rgb, a = load(ch, key)
    T = np.array(r["T"])
    spec = REFS[ch][r["ref"]]

    def carry(pts) -> np.ndarray:
        return (np.array([[*p, 1.0] for p in pts]) @ T.T).round().astype(np.int32)

    poly = np.zeros(a.shape, np.uint8)
    cv2.fillPoly(poly, [carry(spec["poly"])], 1)
    face = np.zeros(a.shape, np.uint8)
    cv2.fillPoly(face, [carry(spec["face"])], 1)
    mask = a * poly * np.where(face > 0, 1.0, EAR_WEIGHT).astype(np.float32)
    ys, xs = np.nonzero(mask > 0.05)
    out = {"key": key, "of": [r["ref"], r["scale"], r["angle"], r["mirror"]], "back": None, "back_score": -1.0}
    if len(xs) < 50:
        return out
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    crop, cmask = rgb[y0:y1, x0:x1], mask[y0:y1, x0:x1]
    if r["mirror"]:
        crop, cmask = crop[:, ::-1], cmask[:, ::-1]
    tpl = {"rgb": np.ascontiguousarray(crop), "mask": np.ascontiguousarray(cmask), "mouth": (0, 0), "origin": (0, 0), "ref": "back"}
    # Found turned by a, the frame's head goes back by -a (by +a once it is mirrored back).
    turn = r["angle"] if r["mirror"] else -r["angle"]
    refs = _T["refs"]
    _T["refs"] = {"back": tpl}
    try:
        ref_rgb, _ = load(ch, r["ref"])
        b = search(ref_rgb, SCALES, np.arange(turn - 10, turn + 10.1, 5.0), [False], keep=2)
    finally:
        _T["refs"] = refs
        for c in [c for c in _T["cache"] if c[0] == "back"]:
            del _T["cache"][c]
    out.update(back=b["scale"], back_score=b["score"])
    return out


def run(ch: str, fn, jobs: list, refs: list[str] | None = None) -> list[dict]:
    with Pool(os.cpu_count(), initializer=init, initargs=(ch, refs)) as pool:
        return pool.map(fn, jobs, chunksize=1)


# Scores mean different things for different animals (a white fluffy cat scores lower on a true
# match than a black dog does on a wrong one), so each character's scores are put on one scale first:
# 0 is the median score of drawings with no usable head (back views, spins, curled up asleep, a face
# straight on) and 1 the median of plain three quarter views like the reference (the walk drawings).
TRUE_KEYS = "walk1 walk2 walk3 walk4 walk5 walk6 walk7 walk8 walk_a walk_b sg_ahead tg_ahead sit2 stand2".split()
NULL_KEYS = "back spin5 spin6 spin7 sb_level sb_up tb_level turn_t3 turn_s3 sleep curl deep sleep_b tumble roll2".split()
# A size is only taken from a head that looks like the reference (a three quarter view): a head in
# profile, turned to you or with another expression is still found in the right place, but at a
# size that is off by up to 20%. A mouth is taken from any head found in the right place.
Z_SIZE = 0.40  # a head found at least this well counts toward its pass's size
Z_PASS3 = 0.45  # a pass's size needs three frames that agree, one of them at least this good,
Z_PASS = 0.55  # or two frames, one of them at least this good,
Z_SURE = 0.75  # or one frame this good
Z_OWN = 0.60  # a frame this good keeps its own size (the drawings of one sheet differ too)...
OWN_FAR = 0.15  # ...unless it is further than this (log) from its pass's size and below Z_FIRM
Z_FIRM = 0.85
Z_LOOSE = 0.10  # three or more frames of a pass this good that agree on a size: their mouths count,
LOOSE_SIZE = 5  # and this many give the pass its size
Z_MOUTH = 0.40  # a mouth from a frame on its own, whose pass has no size
Z_NEAR = 0.0  # pass two: a head found this well near the size of its pass gives the mouth
AGREE = 0.07  # frames within this (log) of each other agree on a size
MOUTH_FAR = 0.15  # a mouth from pass one needs its size this close (log) to its pass's
CLAMP = [0.7, 1.4]
# Checked by eye on the montages (tools output with --json, drawn over the frames): frames where the
# rules above still took a wrong head, per character.
SKIP: dict[str, dict[str, tuple[str, ...]]] = {
    "inky": {"mouth": ("retch",)},  # on the neck, the mouth is open further right
    "pearl": {"mouth": ("wave",)},  # on the cheek
    "hazel": {"mouth": ("bark", "tb_high")},  # on the eye, on the cheek
}
# Passes whose heads are found in the right place but whose size the matching can't pin down (the
# answer moves by more than 10% with how much the ears count), sized by eye instead: the frame shrunk
# by a few factors next to the reference, the factor where eyes, nose and brow spots match. In units
# of the reference head named.
BY_EYE: dict[str, dict[str, tuple[float, str]]] = {
    # chili's angry sheet: cross matches at 0.95 to 1.14 times the standing head depending on the ear
    # weight; by eye 1.12 (the collar bell says the whole drawing is about 1.2 times stand.webp).
    "chili": {"mood": (1.12, "stand")},
}


# Frames sized by eye (ADR-067): the own-move sheets mix sitting, lying and standing drawings that
# came out at different sizes on one sheet, and many of their heads are turned down, in profile or
# with the eyes shut, so the matching can't size them. Laid next to sit.webp, stand.webp and the loaf
# at a few factors, matching the head, the eyes, the collar bell and the tail (the rabbit's cotton
# tail, the raccoon's rings). Frames that swap fast in a loop (gnawing, nibbling) share one factor,
# so nothing pulses. The size fix itself, as in HEADS.
BY_EYE_FRAME: dict[str, dict[str, float]] = {
    "biscuit": {"chew1": 1.02, "chew2": 1.02, "chew3": 1.02},
    "bandit": {k: 1.0 for k in "inspect toss hold1 hold2 wash1 wash2 wash3 rummage1 rummage2".split()},
    # The stamp crouches lower than the alert pose before it: its head size made it as tall and wider.
    "clover": {"nibble1": 1.05, "nibble2": 1.05, "flop1": 1.15, "flop2": 1.15, "earwash1": 1.0, "earwash2": 1.0, "thump2": 1.08},
    "hazel": {"nut1": 0.97, "nut2": 0.97, "nut3": 0.98, "cheeks": 1.0, "pat1": 1.06, "pat2": 1.06, "flick": 1.0, "cling_up": 1.06, "cling_down": 1.06},
}


# The sitting-down and lying-down sheet (stand2, sitting_down, sit2, lowering, loaf2, drowsy, curl,
# deep, waking) was already cut to the height of sit.webp by build-sprites.py, but its heads are drawn
# smaller, so sizing it by the head made the whole body up to 16% bigger than the sit it sits down
# into (biscuit, mochi, bandit), and it popped every time the animal sat or lay down. Its passes are
# sized by the body instead: sit2 has the sit's posture, so the size that gives it the same silhouette
# area as sit.webp is the size of the sheet. stand2 keeps its head size (it is cut to the standing
# height) except where that is clearly off (BY_EYE_FRAME).
BY_BODY = ("trans_sit", "trans_mid")
BY_EYE_FRAME["hazel"]["stand2"] = 0.88
BY_EYE_FRAME["pearl"] = {"stand2": 0.96}


def body_size(ch: str) -> float:
    """The size fix that gives sit2.webp the silhouette area of sit.webp."""
    def area(key: str) -> int:
        a = np.array(Image.open(SPRITES / ch / f"{key}.webp").convert("RGBA"))[:, :, 3]
        return int((a > 128).sum())
    return float(np.sqrt(area("sit") / area("sit2")))


def apply_rules(ch: str, final: dict) -> list[str]:
    """Sizes set by rule over the measured ones: the body-sized passes and the frames sized by eye."""
    changed = []
    body = {x for name, keys in passes(ch) if name in BY_BODY for x in keys}
    fix = round(body_size(ch), 3) if body else None
    for key, val in final.items():
        new = BY_EYE_FRAME.get(ch, {}).get(key, fix if key in body else val[0])
        if new != val[0]:
            changed.append(f"{ch}.{key} {val[0]}->{new}")
            val[0] = new
    return changed


def calibrate(res: dict) -> tuple[float, float]:
    """The scores of no usable head and of a plain head for this character (see TRUE_KEYS)."""
    null = float(np.median([res[x]["score"] for x in NULL_KEYS if x in res]))
    true = float(np.median([res[x]["score"] for x in TRUE_KEYS if x in res]))
    return null, true


def set_z(rs, cal: tuple[float, float]) -> None:
    for r in rs:
        r["z"] = (r["score"] - cal[0]) / (cal[1] - cal[0])


def sit_units(r: dict, k: float) -> float:
    """A measured size in units of the sitting drawing's head (measured both ways where it could be)."""
    return r.get("both", r["scale"]) * (k if r["ref"] == "stand" else 1.0)


BACK_SCORE = 0.5  # the way back must find the reference's head at least this well
BACK_FAR = 0.3  # and the two ways may not differ by more than this (log), or only the first counts


def edge(r: dict) -> bool:
    """A size at the very end of the search range: the template ran out of sizes, not a real match."""
    return r["scale"] is None or r["scale"] < SCALES[0] * 1.02 or r["scale"] > SCALES[-1] / 1.02


def biggest_group(c: list) -> list:
    """Of (size, z, key) triples, the biggest group that agrees on a size (better heads weigh more)."""
    best = None
    for v, _, _ in c:
        group = [e for e in c if abs(np.log(e[0] / v)) <= AGREE]
        support = sum(0.1 + max(0.0, e[1]) for e in group)
        if best is None or support > best[0]:
            best = (support, group)
    return best[1] if best else []


def pass_sizes(ch: str, k: float, res: dict) -> dict:
    """The size each pass was drawn at, from the biggest group of its frames that agree on a size;
    and, looser, a group of three or more that agree (whose mouths are trusted)."""
    out = {}
    for name, keys in passes(ch):
        z = {}
        if name in BY_EYE.get(ch, {}):
            v, ref = BY_EYE[ch][name]
            v = v * (k if ref == "stand" else 1.0)
            out[name] = {"size": v, "n": 0, "spread": [v, v], "members": ["by eye"], "left_out": [], "of": len([x for x in keys if x in res]), "by_eye": True}
            continue
        c = [(sit_units(res[x], k), res[x]["z"], x) for x in keys if x in res and res[x]["z"] >= Z_SIZE and not edge(res[x])]
        group = biggest_group(c)
        if group:
            top = max(e[1] for e in group)
            if (len(group) >= 3 and top >= Z_PASS3) or (len(group) >= 2 and top >= Z_PASS) or top >= Z_SURE:
                vs = [e[0] for e in group]
                z.update(size=float(np.median(vs)), n=len(group), spread=[min(vs), max(vs)], members=[e[2] for e in group], left_out=[e[2] for e in c if e not in group])
        loose = biggest_group([(sit_units(res[x], k), res[x]["z"], x) for x in keys if x in res and res[x]["z"] >= Z_LOOSE and not edge(res[x])])
        if len(loose) >= 3:
            z.update(loose=float(np.median([e[0] for e in loose])), loose_members=[e[2] for e in loose])
            if "size" not in z and len(loose) >= LOOSE_SIZE:
                # Many frames that agree are worth one good one, even when each head alone is doubtful.
                vs = [e[0] for e in loose]
                z.update(size=z["loose"], n=len(loose), spread=[min(vs), max(vs)], members=z["loose_members"], left_out=[])
        if z:
            z["of"] = len([x for x in keys if x in res])
            out[name] = z
    return out


def mouth_ok(key: str, r: dict, k: float, z: dict) -> bool:
    """Whether pass one found this frame's head well enough to give its mouth."""
    if r["z"] < Z_LOOSE or edge(r):
        return False
    if key in z.get("loose_members", []):
        return True
    ps = z.get("size", z.get("loose"))
    if ps is None:
        return r["z"] >= Z_MOUTH
    return abs(np.log(sit_units(r, k) / ps)) <= MOUTH_FAR or r["z"] >= Z_SURE


def decide(ch: str, k: float, res: dict, near: dict, sizes: dict, one_head: bool) -> tuple[dict, dict]:
    """The size fix and the mouth of every frame, and notes on what was left out and why."""
    pass_of = {x: name for name, keys in passes(ch) for x in keys}
    hop = ch in ("clover", "hazel")
    notes = {"own_size": [], "pass_size": [], "clamped": [], "no_size": [], "no_mouth": [], "mouth_near": [], "skipped": []}
    size: dict[str, float | None] = {}
    for key, r in res.items():
        ps = sizes.get(pass_of.get(key, ""), {}).get("size")
        if key == "sit":
            s = 1.0
        elif key == "stand" or (RIGGED.match(key) and not hop):
            s = k
        elif key in MIRRORED:
            continue
        elif key in SKIP.get(ch, {}).get("size", ()):
            s = None
            notes["skipped"].append(f"{key}(size)")
        elif r["z"] >= Z_OWN and not edge(r) and (ps is None or abs(np.log(sit_units(r, k) / ps)) <= OWN_FAR or r["z"] >= Z_FIRM):
            s = sit_units(r, k)
            notes["own_size"].append(key)
        else:
            s = ps
            if ps is not None:
                notes["pass_size"].append(key)
        size[key] = s
    for key, of in MIRRORED.items():
        if key in res:
            size[key] = size.get(of)
    final = {}
    for key, r in res.items():
        s = size.get(key)
        fix = None
        if s is not None:
            target = k if standing(key) and not one_head else 1.0
            fix = target / s
            if not CLAMP[0] <= fix <= CLAMP[1]:
                notes["clamped"].append(f"{key} {fix:.3f}")
                fix = None
        if key in BY_EYE_FRAME.get(ch, {}):
            fix = BY_EYE_FRAME[ch][key]
        if fix is None:
            notes["no_size"].append(key)
        z = sizes.get(pass_of.get(key) or pass_of.get(MIRRORED.get(key, ""), ""), {})
        m = r if mouth_ok(key, r, k, z) else None
        if m is None and key in near and near[key]["z"] >= Z_NEAR:
            m = near[key]
            notes["mouth_near"].append(key)
        if m is not None and key in SKIP.get(ch, {}).get("mouth", ()):
            m = None
            notes["skipped"].append(f"{key}(mouth)")
        if m is not None:
            W, H = m["size"]
            mx, my = m["mouth_img"]
            final[key] = [None if fix is None else round(fix, 3), int(round(mx + 0.5 - W / 2)), int(round(H - (my + 0.5)))]
        else:
            notes["no_mouth"].append(key)
            final[key] = [None if fix is None else round(fix, 3), None, None]
    apply_rules(ch, final)
    return final, notes


def write_ts(final: dict, ks: dict, one_head: bool) -> None:
    def num(v):
        if v is None:
            return "null"
        if isinstance(v, float):
            return f"{v:.3f}".rstrip("0").rstrip(".")
        return str(v)

    lines = [
        "/**",
        " * Generated by tools/measure-heads.py, do not edit.",
        " *",
        " * The drawings were made sheet by sheet at different sizes, so the animal's",
        " * head is bigger in some frames than in others. Per character, per drawn frame:",
        " * [size fix, mouth x, mouth y].",
        " *",
        " * - size fix: multiply the frame's drawn size by this (round its bottom centre) and its head is",
        (" *   the size of the head in sit.webp." if one_head else " *   the size of the head in sit.webp (sitting and lying poses) or stand.webp (standing and moving"),
        ("" if one_head else " *   ones; STAND_HEAD below says how the two compare)."),
        " *   A frame whose head was found well has its own value, the others of its sheet share the",
        " *   sheet's. A mirrored frame has the value of the frame it mirrors. null: keep as drawn (no",
        " *   head that could be measured, or a fix outside the clamp; tools/measure-heads.py lists them).",
        " * - mouth x, mouth y: where a toy held in the teeth sits, in the frame's own pixels as it is now",
        " *   (before the size fix): x from the horizontal centre, positive forward (right), y up from the",
        " *   bottom edge. null: the head was not found well enough in this frame (back views, spins,",
        " *   curled up, a head turned away), so there is no mouth to give.",
        " *",
        " * In-between frames are not listed: take them from the two drawings they sit between.",
        " */",
    ]
    lines = [l for l in lines if l != ""]
    lines.append("export const HEADS: Record<string, Record<string, readonly [number | null, number | null, number | null]>> = {")
    for ch in CHARACTERS:
        if ch not in final:
            continue
        body = ", ".join(f"{key}: [{', '.join(num(v) for v in val)}]" for key, val in final[ch].items())
        lines.append(f"  {ch}: {{ {body} }},")
    lines.append("};")
    lines.append("")
    lines.append("/** How big the head in stand.webp is next to the head in sit.webp (measured both ways). */")
    lines.append("export const STAND_HEAD: Record<string, number> = { " + ", ".join(f"{ch}: {num(round(ks[ch], 3))}" for ch in CHARACTERS if ch in ks) + " };")
    OUT_TS.write_text("\n".join(lines) + "\n")


def read_ts() -> tuple[dict, dict]:
    """HEADS and STAND_HEAD as heads.ts has them now (for --merge)."""
    src = OUT_TS.read_text()

    def val(v: str):
        v = v.strip()
        return None if v == "null" else float(v) if "." in v else int(v)

    heads: dict[str, dict] = {}
    for ch, body in re.findall(r"^  (\w+): \{ (.*) \},$", src, re.M):
        heads[ch] = {key: [val(v) for v in vals.split(",")] for key, vals in re.findall(r"(\w+): \[([^\]]*)\]", body)}
    line = re.search(r"STAND_HEAD[^=]*= \{(.*)\};", src).group(1)
    ks = {ch: float(v) for ch, v in re.findall(r"(\w+): ([\d.]+)", line)}
    return heads, ks


def main() -> None:
    args = sys.argv[1:]

    def opt(name: str, default: str | None) -> str | None:
        if name in args:
            i = args.index(name)
            v = args[i + 1]
            del args[i : i + 2]
            return v
        return default

    only = opt("--only", None)
    keys_opt = opt("--keys", None)
    out_json = opt("--json", None)
    reuse = opt("--reuse", None)
    one_head = "--one-head" in args
    clamp = opt("--clamp", None)
    if clamp:
        CLAMP[:] = [float(v) for v in clamp.split(",")]
    no_write = "--no-write" in args
    merge = "--merge" in args
    if "--rules" in args:
        cur, cur_ks = read_ts()
        changed = [c for ch in (only.split(",") if only else CHARACTERS) if ch in cur for c in apply_rules(ch, cur[ch])]
        print("\n".join(changed) or "nothing to change")
        if not no_write:
            write_ts(cur, cur_ks, one_head)
            print(f"wrote {OUT_TS.relative_to(ROOT)}, {len(changed)} sizes changed")
        return
    chars = only.split(",") if only else CHARACTERS
    drawn, gaits = drawn_keys()
    old = json.loads(Path(reuse).read_text()) if reuse else {}
    allres: dict[str, dict] = {}
    final_all: dict[str, dict] = {}
    ks: dict[str, float] = {}
    for ch in chars:
        keys = keys_opt.split(",") if keys_opt else drawn + gaits
        keys = [x for x in keys if (SPRITES / ch / f"{x}.webp").exists()]
        if ch in old and "p1" in old[ch]:
            k = old[ch]["k"]
            res = {r["key"]: r for r in old[ch]["p1"] if r["key"] in keys}
            # Frames drawn since that run are measured now.
            missing = [x for x in keys if x not in res]
            if missing:
                print(f"{ch}: measuring {len(missing)} new frames")
                res.update({r["key"]: r for r in run(ch, measure, missing)})
        else:
            # How big the standing head is next to the sitting one, measured both ways.
            a = run(ch, measure, ["stand"], ["sit"])[0]
            b = run(ch, measure, ["sit"], ["stand"])[0]
            k = float(np.sqrt(a["scale"] / b["scale"]))
            res = {r["key"]: r for r in run(ch, measure, keys)}
        ks[ch] = k
        cal = calibrate(res)
        set_z(res.values(), cal)
        # Every head that may give a size is measured the other way round too (cached like pass two).
        for r in res.values():
            r.pop("both", None)
        want = [key for key, r in res.items() if r["T"] is not None and r["z"] >= Z_LOOSE and not edge(r) and key not in MIRRORED]
        cached = {b["key"]: b for b in old.get(ch, {}).get("back", [])}
        back = {key: cached[key] for key in want if key in cached and cached[key]["of"] == [res[key]["ref"], res[key]["scale"], res[key]["angle"], res[key]["mirror"]]}
        todo = [(key, res[key]) for key in want if key not in back]
        if todo:
            for b in run(ch, measure_back, todo):
                back[b["key"]] = b
        for key, b in back.items():
            r = res[key]
            if b["back"] and b["back_score"] >= BACK_SCORE and abs(np.log(r["scale"] * b["back"])) <= BACK_FAR:
                r["both"] = float(np.sqrt(r["scale"] / b["back"]))
        sizes = pass_sizes(ch, k, res)
        pass_of = {x: name for name, ks_ in passes(ch) for x in ks_}
        jobs = []
        for key, r in res.items():
            z = sizes.get(pass_of.get(key) or pass_of.get(MIRRORED.get(key, ""), ""), {})
            ps = z.get("size", z.get("loose"))
            if ps is None or mouth_ok(key, r, k, z):
                continue
            jobs.append((key, {"sit": (round(ps * 0.92, 4), round(ps * 1.08, 4)), "stand": (round(ps / k * 0.92, 4), round(ps / k * 1.08, 4))}))
        # Pass two results are kept between runs while the size they were searched near is the same.
        cached = {r["key"]: r for r in old.get(ch, {}).get("near", [])}
        near = {key: cached[key] for key, rg in jobs if key in cached and cached[key].get("ranges") == {a: list(b) for a, b in rg.items()}}
        todo = [j for j in jobs if j[0] not in near]
        if todo:
            for job, r in zip(todo, run(ch, measure_near, todo)):
                r["ranges"] = {a: list(b) for a, b in job[1].items()}
                near[r["key"]] = r
        set_z(near.values(), cal)
        final, notes = decide(ch, k, res, near, sizes, one_head)
        allres[ch] = {"k": k, "cal": cal, "p1": list(res.values()), "near": list(near.values()), "back": list(back.values()), "sizes": sizes, "final": final, "notes": notes}
        final_all[ch] = final
        report(ch, k, cal, res, near, sizes, final, notes)
        if out_json:
            Path(out_json).write_text(json.dumps(allres))
    if merge and not no_write:
        # Only the frames heads.ts doesn't have yet are added; everything already there stays as it is.
        cur, cur_ks = read_ts()
        added = []
        for ch, final in final_all.items():
            for key, val in final.items():
                if key not in cur.setdefault(ch, {}):
                    cur[ch][key] = val
                    added.append(f"{ch}.{key}")
        write_ts(cur, {**ks, **cur_ks}, one_head)
        print(f"wrote {OUT_TS.relative_to(ROOT)}, added {len(added)}: {' '.join(added)}")
    elif not no_write and not keys_opt and not only:
        write_ts(final_all, ks, one_head)
        print(f"wrote {OUT_TS.relative_to(ROOT)}")


def report(ch: str, k: float, cal: tuple[float, float], res: dict, near: dict, sizes: dict, final: dict, notes: dict) -> None:
    print(f"\n== {ch}: stand head / sit head {k:.3f}, {len(res)} frames, score of no head {cal[0]:.2f}, of a plain head {cal[1]:.2f}")
    for name, keys in passes(ch):
        z = sizes.get(name, {})
        if "size" in z:
            out = f" [{' '.join(z['members'])}]" + (f" (left out: {' '.join(z['left_out'])})" if z["left_out"] else "")
            if z.get("by_eye"):
                print(f"  {name:12s} {z['size']:.3f} by eye")
            else:
                print(f"  {name:12s} {z['size']:.3f} from {z['n']}/{z['of']}, {z['spread'][0]:.3f} to {z['spread'][1]:.3f}{out}")
        else:
            print(f"  {name:12s} no size" + (f" (mouths from {' '.join(z['loose_members'])} at {z['loose']:.3f})" if "loose" in z else ""))
    for what in ("clamped", "no_size", "no_mouth", "mouth_near", "skipped"):
        if notes[what]:
            print(f"  {what}: {' '.join(notes[what])}")
    fixes = sorted(((v[0], key) for key, v in final.items() if v[0] is not None), key=lambda t: abs(np.log(t[0])), reverse=True)
    print("  biggest fixes:", " ".join(f"{key} {f:.3f}" for f, key in fixes[:12]))


if __name__ == "__main__":
    main()
