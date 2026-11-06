#!/usr/bin/env -S uv run --with pillow --with numpy --with scipy python
"""Builds the app icon, the menu bar icon and the website's icons from two drawings of the tabby.

Usage: tools/build-icons.py [loaf.png head.png]

`loaf` is the tabby lying in a loaf, used from 64 px up. `head` is just its head, used where a
whole body would turn into a blob: the icon at 16 and 32 points, the menu bar and the favicon.
Each can be a transparent PNG or a drawing on flat green, which is keyed out like the sprite
sheets. Given new drawings, the keyed cut-outs are saved to src-tauri/icons/art/ first; with no
arguments the tool rebuilds everything from those.

Writes src-tauri/icons/icon.icns, icon.png, icon.ico and tray.png, and site/assets/favicon-32.png,
brand-64.png and apple-touch-icon.png.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri/icons"
ART = ICONS / "art"
SITE = ROOT / "site/assets"

# Apple's grid for a macOS icon on a 1024 canvas: an 824 px tile, rounded, with room for the shadow.
N = 1024
TILE = (100, 100, 924, 924)
RADIUS = 185
# Warm cream, like the website.
TOP = (255, 248, 238)
BOTTOM = (250, 224, 190)
GLOW = (255, 214, 160)


def cut_out(path: Path) -> Image.Image:
    """The drawing on a transparent background, trimmed to the drawing."""
    im = Image.open(path)
    if im.mode == "RGBA" and np.asarray(im)[..., 3].min() < 250:
        rgba = np.asarray(im).astype(np.float32)
    else:
        # Green screen, keyed the same way as tools/cut-sprites.py.
        img = np.asarray(im.convert("RGB")).astype(np.float32)
        r, g, b = img[..., 0], img[..., 1], img[..., 2]
        spill = g - np.maximum(r, b)
        alpha = np.clip(1.0 - (spill - 30.0) / 90.0, 0.0, 1.0)
        alpha[spill < 30.0] = 1.0
        g2 = np.where(spill > 0, np.minimum(g, np.maximum(r, b) + 6.0), g)
        rgba = np.dstack([r, g2, b, alpha * 255.0])
    # Only the drawing itself: specks that float free of it go.
    solid = rgba[..., 3] > 128
    blobs, n = ndimage.label(ndimage.binary_dilation(solid, iterations=6))
    if n > 1:
        sizes = ndimage.sum(solid, blobs, index=range(1, n + 1))
        rgba[..., 3] *= blobs == (int(np.argmax(sizes)) + 1)
    out = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")
    return out.crop(out.getbbox())


def rounded(size: int, box: tuple[int, int, int, int], radius: int) -> Image.Image:
    """A smooth rounded-square mask, drawn at four times the size and scaled down."""
    k = 4
    m = Image.new("L", (size * k, size * k), 0)
    ImageDraw.Draw(m).rounded_rectangle([v * k for v in box], radius=radius * k, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def background() -> Image.Image:
    """The tile's fill: cream fading warmer toward the bottom, with a soft glow behind the cat."""
    y = np.linspace(0.0, 1.0, N)[:, None, None]
    grad = np.array(TOP, np.float32) * (1 - y) + np.array(BOTTOM, np.float32) * y
    grad = np.repeat(grad, N, axis=1)
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    d = np.hypot(xx - N / 2, (yy - N * 0.56) * 1.15) / (N * 0.42)
    glow = np.clip(1.0 - d, 0.0, 1.0)[..., None] ** 1.6 * 0.55
    rgb = grad * (1 - glow) + np.array(GLOW, np.float32) * glow
    return Image.fromarray(rgb.clip(0, 255).astype(np.uint8), "RGB").convert("RGBA")


def place(canvas: Image.Image, art: Image.Image, box: tuple[int, int, int, int], ground: bool) -> None:
    """Scales `art` to fit `box` and puts it at the bottom centre, with a soft shadow under it."""
    x0, y0, x1, y1 = box
    s = min((x1 - x0) / art.width, (y1 - y0) / art.height)
    a = art.resize((round(art.width * s), round(art.height * s)), Image.LANCZOS)
    x = (x0 + x1 - a.width) // 2
    y = y1 - a.height
    if ground:
        sh = Image.new("L", canvas.size, 0)
        w = a.width * 0.42
        ImageDraw.Draw(sh).ellipse([N / 2 - w, y1 - 26, N / 2 + w, y1 + 22], fill=70)
        sh = sh.filter(ImageFilter.GaussianBlur(16))
        canvas.alpha_composite(Image.merge("RGBA", [*Image.new("RGB", canvas.size, (140, 70, 20)).split(), sh]))
    canvas.alpha_composite(a, (x, y))


def tile(art: Image.Image, box: tuple[int, int, int, int], ground: bool) -> Image.Image:
    """The rounded tile with the drawing on it, on a 1024 canvas, no shadow."""
    t = background()
    place(t, art, box, ground)
    # A faint warm edge, so the tile still shows on a white window.
    edge = rounded(N, TILE, RADIUS)
    inner = rounded(N, (TILE[0] + 3, TILE[1] + 3, TILE[2] - 3, TILE[3] - 3), RADIUS - 3)
    ring = ImageChops.subtract(edge, inner).point(lambda v: v * 0.35)
    t.alpha_composite(Image.merge("RGBA", [*Image.new("RGB", (N, N), (176, 104, 44)).split(), ring]))
    t.putalpha(edge)
    return t


def mac(t: Image.Image) -> Image.Image:
    """The tile with the drop shadow macOS icons carry."""
    sh = rounded(N, TILE, RADIUS).filter(ImageFilter.GaussianBlur(12)).point(lambda v: v * 0.3)
    out = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    out.alpha_composite(Image.merge("RGBA", [*Image.new("RGB", (N, N), (0, 0, 0)).split(), sh]), (0, 10))
    out.alpha_composite(t)
    return out


def shrink(im: Image.Image, size: int) -> Image.Image:
    """Scaled down, with a touch of sharpening at the small sizes so the face stays crisp."""
    out = im.resize((size, size), Image.LANCZOS)
    if size <= 64:
        out = out.filter(ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=2))
    return out


def main() -> int:
    ART.mkdir(parents=True, exist_ok=True)
    if len(sys.argv) == 3:
        for src, name in zip(sys.argv[1:], ["loaf", "head"]):
            art = cut_out(Path(src))
            # The icon draws it at most about 700 px tall, so a 1024 px copy is plenty.
            art.thumbnail((1024, 1024), Image.LANCZOS)
            art.save(ART / f"{name}.png", optimize=True)
            print(f"art: {name}.png from {src}")
    elif len(sys.argv) != 1:
        print(__doc__)
        return 2
    loaf = Image.open(ART / "loaf.png").convert("RGBA")
    head = Image.open(ART / "head.png").convert("RGBA")

    # The loaf sits on the bottom of the tile, the head fills it.
    big = tile(loaf, (190, 190, 834, 850), ground=True)
    small = tile(head, (150, 150, 874, 878), ground=False)
    big_mac, small_mac = mac(big), mac(small)

    # macOS: 16 and 32 points show the head, 128 points and up the loaf.
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "icon.iconset"
        iconset.mkdir()
        for pt in (16, 32, 128, 256, 512):
            src = small_mac if pt <= 32 else big_mac
            shrink(src, pt).save(iconset / f"icon_{pt}x{pt}.png")
            shrink(src, pt * 2).save(iconset / f"icon_{pt}x{pt}@2x.png")
        subprocess.run(["iconutil", "-c", "icns", "-o", str(ICONS / "icon.icns"), str(iconset)], check=True)
    shrink(big_mac, 512).save(ICONS / "icon.png", optimize=True)

    # Windows: the tile fills the icon, the head up to 32 px.
    def square(t: Image.Image, size: int) -> Image.Image:
        return shrink(t.crop(TILE).resize((N, N), Image.LANCZOS), size)

    sizes = [16, 24, 32, 48, 64, 128, 256]
    ico = [square(small if s <= 32 else big, s) for s in sizes]
    ico[-1].save(ICONS / "icon.ico", sizes=[(s, s) for s in sizes], append_images=ico[:-1])

    # Menu bar: the head alone, 18 points tall (36 px for sharp screens).
    th = 36
    head.resize((round(head.width * th / head.height), th), Image.LANCZOS).filter(
        ImageFilter.UnsharpMask(radius=0.5, percent=50, threshold=2)
    ).save(ICONS / "tray.png", optimize=True)

    # Website: favicon and header logo (the head), and the home screen icon (full square, the
    # phone rounds it itself).
    square(small, 32).save(SITE / "favicon-32.png", optimize=True)
    square(small, 64).save(SITE / "brand-64.png", optimize=True)
    full = background()
    place(full, loaf, (120, 110, 904, 900), ground=True)
    full.convert("RGB").resize((180, 180), Image.LANCZOS).save(SITE / "apple-touch-icon.png", optimize=True)

    print("icons: icon.icns, icon.png, icon.ico, tray.png; site: favicon-32.png, brand-64.png, apple-touch-icon.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
