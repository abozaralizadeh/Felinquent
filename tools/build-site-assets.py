#!/usr/bin/env -S uv run --with pillow python
"""Packs the real sprites into the small images the website uses (site/assets/).

Usage: tools/build-site-assets.py

Each animation becomes one horizontal strip. Every frame sits on the same canvas, anchored at the
bottom centre like the player draws it, so the page can step through a strip with background-position
and the feet stay put. Strips are saved at twice the size they are shown at, for sharp screens.
"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / "src/playground/public/sprites"
OUT = ROOT / "site/assets"

# The hero cat: what it does on the top edge of the window. The wash is the frames of one bout from
# the head down (the page plays them in order with a lick nod on each part): to the paw, the paw
# licks, one wipe over the ear and cheek, the nose, the chest, a hind leg, a content blink.
NOD = ["n1", "n2", "n3", "n4", "n5"]
GROOM = (["groom1", "groom1t1", "groom1t2", "groom2"] + [f"groom2{n}" for n in NOD]
         + ["groom2t1", "groom2t2", "groom3", "groom3t1", "groom3t2", "groom4", "groom4t1", "groom4t2", "groom5", "groom5t1", "groom5t2", "groom6"]
         + [f"groom6{n}" for n in NOD] + ["groom6t1", "groom6t2", "groom7"] + [f"groom7{n}" for n in NOD]
         + ["groom7t1", "groom7t2", "groom8"] + [f"groom8{n}" for n in NOD] + ["groom8t1", "groom8t2", "groom9"])
# Turning round, as the app steps through it: side, head round, three quarters, front, the far side.
TURN = ["stand", "standt1", "standt2", "turn_s1", "turn_s1t1", "turn_s1t2", "turn_s2", "turn_s3", "turn_s4", "turn_s4t1", "turn_s4t2", "turn_s5"]
HERO = {
    "walk": [f"gw{i:02d}" for i in range(32)],
    "groom": GROOM,
    "turn": TURN,
    "poses": ["sit", "blink", "stand", "curious", "lookup", "swat_a", "swat_b", "proud", "yawn", "lowering", "loaf", "sleep", "love", "startled", "annoyed", "joy"],
}
HERO_SCALE = 0.6
CHARACTERS = ["tabby", "inky", "pearl", "mochi", "bandit", "biscuit", "chili", "clover", "hazel"]


def load(char: str, name: str) -> Image.Image:
    return Image.open(SPRITES / char / f"{name}.webp").convert("RGBA")


def strip(frames: list[Image.Image], w: int, h: int, scale: float) -> Image.Image:
    """Frames on a w x h canvas each, bottom centre, scaled."""
    fw, fh = round(w * scale), round(h * scale)
    out = Image.new("RGBA", (fw * len(frames), fh), (0, 0, 0, 0))
    for i, im in enumerate(frames):
        cell = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        cell.paste(im, ((w - im.width) // 2, h - im.height), im)
        out.paste(cell.resize((fw, fh), Image.LANCZOS), (i * fw, 0))
    return out


def save(im: Image.Image, name: str) -> None:
    path = OUT / name
    im.save(path, "WEBP", quality=82, method=6)
    print(f"{name}: {im.width}x{im.height}, {path.stat().st_size // 1024} KB")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)

    # One canvas for every hero frame, so all strips share a frame size.
    hero = {k: [load("tabby", n) for n in names] for k, names in HERO.items()}
    w = max(im.width for frames in hero.values() for im in frames)
    h = max(im.height for frames in hero.values() for im in frames)
    for k, frames in hero.items():
        save(strip(frames, w, h, HERO_SCALE), f"tabby-{k}.webp")
    print(f"hero canvas: {w}x{h} sprite px, poses: {', '.join(HERO['poses'])}")

    # Character cards: sitting, then the face it makes when you pet it.
    for c in CHARACTERS:
        frames = [load(c, "sit"), load(c, "love")]
        cw, ch = max(f.width for f in frames), max(f.height for f in frames)
        save(strip(frames, cw, ch, 0.8), f"card-{c}.webp")

    # Single poses for the little desktop in the hero, the feature cards and the footer.
    singles = [("pearl", "loaf"), ("mochi", "peek"), ("biscuit", "sleep"), ("inky", "sleep"), ("tabby", "dangle"), ("mochi", "startled"), ("biscuit", "joy")]
    for c, n in singles:
        im = load(c, n)
        save(im.resize((round(im.width * 0.5), round(im.height * 0.5)), Image.LANCZOS), f"{c}-{n}.webp")

    # Favicons from the app icon.
    icon = Image.open(ROOT / "src-tauri/icons/icon.png").convert("RGBA")
    icon.resize((32, 32), Image.LANCZOS).save(OUT / "favicon-32.png")
    icon.resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png")
    print("favicons: favicon-32.png, apple-touch-icon.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
