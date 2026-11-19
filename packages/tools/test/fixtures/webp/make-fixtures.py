"""
Makes the WebP test pictures and, beside each, the PNG it should decode to (the decoded pixels as Pillow's libwebp reads them).
    python3 make-fixtures.py        (needs Pillow built with WebP support; run it from this folder)
The pictures are made up here (no real maps or art): gradients, rings, noise and text-free shapes, so they are small and carry no one's work.
"""
import math, random
from PIL import Image, ImageDraw

random.seed(7)

def scene(w, h, alpha=False):
    """A picture with smooth gradients, hard edges, fine noise and (optionally) soft transparency: the things each part of the format deals with."""
    im = Image.new("RGBA", (w, h))
    px = im.load()
    for y in range(h):
        for x in range(w):
            r = int(255 * x / max(1, w - 1)); g = int(255 * y / max(1, h - 1)); b = int(128 + 120 * math.sin((x + y) / 9.0))
            n = random.randint(-6, 6)
            px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)), 255)
    d = ImageDraw.Draw(im)
    d.ellipse([w * 0.15, h * 0.2, w * 0.6, h * 0.8], fill=(200, 40, 40, 255), outline=(10, 10, 10, 255), width=2)
    d.rectangle([w * 0.55, h * 0.1, w * 0.9, h * 0.45], fill=(30, 90, 200, 255))
    d.line([0, h - 1, w - 1, 0], fill=(250, 250, 30, 255), width=3)
    if alpha:
        for y in range(h):
            for x in range(w):
                r, g, b, _ = px[x, y]
                a = int(255 * min(1.0, max(0.0, (x - w * 0.1) / (w * 0.5)))) if y < h * 0.7 else 0 if x % 7 < 3 else 255
                px[x, y] = (r, g, b, a)
    return im

def few_colours(w, h):
    """Four flat colours in blocks: the lossless coder turns this into a palette."""
    im = Image.new("RGBA", (w, h))
    d = ImageDraw.Draw(im)
    cols = [(20, 30, 40, 255), (200, 180, 60, 255), (60, 160, 90, 255), (0, 0, 0, 0)]
    for i in range(0, w, 8):
        for j in range(0, h, 8):
            d.rectangle([i, j, i + 7, j + 7], fill=cols[((i // 8) * 3 + (j // 8)) % 4])
    return im

def save(name, im, **kw):
    im.save(f"{name}.webp", "WEBP", **kw)
    Image.open(f"{name}.webp").convert("RGBA").save(f"{name}.png")

save("lossless-rgba", scene(64, 48, alpha=True), lossless=True, exact=True)
save("lossless-palette", few_colours(72, 40), lossless=True, exact=True)
save("lossless-1x1", Image.new("RGBA", (1, 1), (12, 200, 99, 255)), lossless=True)
save("lossy-q75-odd", scene(97, 61).convert("RGB"), quality=75)
save("lossy-q10", scene(80, 56).convert("RGB"), quality=10)
save("lossy-q100-sharp", scene(48, 48).convert("RGB"), quality=100, method=6)
save("lossy-alpha", scene(80, 64, alpha=True), quality=60, alpha_quality=100, exact=True)
save("lossy-alpha-lowquality", scene(80, 64, alpha=True), quality=40, alpha_quality=30)
save("lossy-wide", scene(257, 33).convert("RGB"), quality=85)

# an animated one (two frames): not decoded
a, b = scene(32, 32, alpha=True), scene(32, 32)
a.save("animated.webp", "WEBP", save_all=True, append_images=[b], duration=100, lossless=True)
