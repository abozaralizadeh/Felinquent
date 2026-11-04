"""Draws the Felinquent app icon (an original cat face) and writes icon.png, icon.icns and icon.ico.
Run from the repo root on a Mac: python3 tools/make-icon.py. No dependencies beyond Python and macOS sips/iconutil."""
import os, struct, subprocess, tempfile, zlib

N = 512
SS = 2
OUT = "src-tauri/icons"
OR, OR_D, LINE, BELLY, PINK, BG = (242, 166, 80), (217, 130, 42), (106, 63, 38), (253, 231, 191), (248, 180, 168), (255, 236, 214)


def ell(x, y, cx, cy, rx, ry):
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1


def tri(x, y, a, b, c):
    def s(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    d = [s((x, y), a, b), s((x, y), b, c), s((x, y), c, a)]
    return not (any(v < 0 for v in d) and any(v > 0 for v in d))


def px(x, y):
    X, Y = x / SS, y / SS
    r = 0.22 * N
    cx, cy = min(max(X, r), N - r), min(max(Y, r), N - r)
    if (X - cx) ** 2 + (Y - cy) ** 2 > r * r:
        return None
    col = BG
    for s in (-1, 1):
        ex = N / 2 + s * 118
        if tri(X, Y, (ex - s * 70, 215), (ex + s * 20, 70), (ex + s * 92, 215)): col = LINE
        if tri(X, Y, (ex - s * 58, 212), (ex + s * 18, 92), (ex + s * 80, 212)): col = OR
        if tri(X, Y, (ex - s * 38, 206), (ex + s * 16, 120), (ex + s * 58, 206)): col = PINK
    if ell(X, Y, N / 2, 300, 196, 168): col = LINE
    if ell(X, Y, N / 2, 300, 186, 158): col = OR
    for dx in (-26, 0, 26):
        if abs(X - (N / 2 + dx)) < 7 and 150 < Y < 205: col = OR_D
    if ell(X, Y, N / 2, 372, 66, 44): col = BELLY
    for s in (-1, 1):
        ex = N / 2 + s * 82
        if ell(X, Y, ex, 300, 32, 42): col = (59, 36, 23)
        if ell(X, Y, ex + 2, 306, 18, 26): col = (27, 22, 32)
        if ell(X, Y, ex - 10, 284, 12, 12): col = (255, 255, 255)
        if ell(X, Y, ex + 10, 322, 6, 6): col = (255, 255, 255)
        if ell(X, Y, N / 2 + s * 128, 352, 26, 15): col = (255, 150, 150)
        # a smile: the lower half of a ring on each side of the nose
        mx = N / 2 + s * 13
        if Y > 380 and ell(X, Y, mx, 380, 14, 11) and not ell(X, Y, mx, 380, 10.5, 7.5): col = LINE
    if tri(X, Y, (N / 2 - 18, 350), (N / 2 + 18, 350), (N / 2, 372)): col = (240, 140, 154)
    return col


def chunk(t, d):
    c = struct.pack(">I", len(d)) + t + d
    return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)


rows = []
for yy in range(N):
    row = bytearray()
    for xx in range(N):
        r = g = b = a = 0
        for sy in range(SS):
            for sx in range(SS):
                c = px(xx * SS + sx, yy * SS + sy)
                if c is None:
                    continue
                r, g, b, a = r + c[0], g + c[1], b + c[2], a + 1
        row += bytes((0, 0, 0, 0)) if a == 0 else bytes((r // a, g // a, b // a, 255 * a // (SS * SS)))
    rows.append(b"\x00" + bytes(row))
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", N, N, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")
os.makedirs(OUT, exist_ok=True)
open(f"{OUT}/icon.png", "wb").write(png)

tmp = tempfile.mkdtemp()
iconset = f"{tmp}/icon.iconset"
os.makedirs(iconset)
def resize(size, dest):
    subprocess.run(["sips", "-z", str(size), str(size), f"{OUT}/icon.png", "--out", dest], check=True, capture_output=True)
for size in (16, 32, 128, 256, 512):
    resize(size, f"{iconset}/icon_{size}x{size}.png")
resize(32, f"{iconset}/icon_16x16@2x.png")
resize(64, f"{iconset}/icon_32x32@2x.png")
resize(256, f"{iconset}/icon_128x128@2x.png")
resize(512, f"{iconset}/icon_256x256@2x.png")
open(f"{iconset}/icon_512x512@2x.png", "wb").write(png)
subprocess.run(["iconutil", "-c", "icns", iconset, "-o", f"{OUT}/icon.icns"], check=True)

sizes = [16, 32, 48, 256]
imgs = []
for s in sizes:
    p = f"{tmp}/ico_{s}.png"
    resize(s, p)
    imgs.append(open(p, "rb").read())
ico = struct.pack("<HHH", 0, 1, len(sizes))
off = 6 + 16 * len(sizes)
body = b""
for s, img in zip(sizes, imgs):
    ico += struct.pack("<BBBBHHII", 0 if s == 256 else s, 0 if s == 256 else s, 0, 0, 1, 32, len(img), off + len(body))
    body += img
open(f"{OUT}/icon.ico", "wb").write(ico + body)
print("wrote icon.png, icon.icns, icon.ico")
