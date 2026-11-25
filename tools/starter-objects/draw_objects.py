"""
Draws the Starter Pack's objects: simple top-down pictures made for Dragon Drop and given to the public domain (CC0 1.0), so the Object tool, scattering,
tints, shadows and object layers can be tried before any asset packs are added (the 0.1.13 playtest found the Starter Pack had none). 256 px is one grid
square. Every random choice is seeded, so the pictures come out the same each time.

    python tools/starter-objects/draw_objects.py      (Python 3 with Pillow)

writes apps/server/starter/Dragon Drop Starter Pack/Objects/*.png. A picture added here needs its line in the pack's CREDITS.txt (a test checks).
"""
import math
import os
import random

from PIL import Image, ImageDraw

S = 4  # drawn at four times the size, then shrunk, for smooth edges
OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "apps", "server", "starter", "Dragon Drop Starter Pack", "Objects"))
LIGHT = (-0.3, -0.34)  # where the light comes from (the top left), as a share of a shape's size


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


class Pic:
    """A square picture `px` wide, drawn in its own pixels (scaled by S underneath)."""

    def __init__(self, px):
        self.px = px
        self.im = Image.new("RGBA", (px * S, px * S), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def layer(self):
        """A see-through layer to draw faint things on (laid over with `lay`)."""
        im = Image.new("RGBA", self.im.size, (0, 0, 0, 0))
        return im, ImageDraw.Draw(im)

    def lay(self, im):
        self.im.alpha_composite(im)

    def circle(self, cx, cy, r, fill=None, outline=None, width=1, d=None):
        (d or self.d).ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], fill=fill, outline=outline, width=round(width * S))

    def poly(self, pts, fill=None, outline=None, width=1, d=None):
        q = [(x * S, y * S) for x, y in pts]
        (d or self.d).polygon(q, fill=fill)
        if outline:
            (d or self.d).line(q + [q[0]], fill=outline, width=round(width * S), joint="curve")

    def line(self, pts, fill, width=1, d=None):
        (d or self.d).line([(x * S, y * S) for x, y in pts], fill=fill, width=max(1, round(width * S)), joint="curve")

    def rect(self, x0, y0, x1, y1, fill=None, outline=None, width=1, radius=0, d=None):
        (d or self.d).rounded_rectangle([x0 * S, y0 * S, x1 * S, y1 * S], radius=radius * S, fill=fill, outline=outline, width=round(width * S))

    def shaded_circle(self, cx, cy, r, dark, light, steps=16):
        """A round shape lit from the top left: drawn again and again, smaller and lighter, toward the light."""
        for k in range(steps):
            t = k / steps
            self.circle(cx + LIGHT[0] * r * t, cy + LIGHT[1] * r * t, r * (1 - 0.78 * t), fill=lerp(dark, light, t ** 0.75))

    def shaded_poly(self, pts, dark, light, steps=16):
        cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        size = max(math.hypot(x - cx, y - cy) for x, y in pts)
        for k in range(steps):
            t = k / steps
            sc, ox, oy = 1 - 0.75 * t, LIGHT[0] * size * t, LIGHT[1] * size * t
            self.poly([(cx + (x - cx) * sc + ox, cy + (y - cy) * sc + oy) for x, y in pts], fill=lerp(dark, light, t ** 0.75))

    def save(self, name):
        os.makedirs(OUT, exist_ok=True)
        self.im.resize((self.px, self.px), Image.LANCZOS).save(os.path.join(OUT, name + ".png"), optimize=True)
        print("wrote", name)


def leaves(p, rng, x, y, r, dark, light, per=34):
    """Small leaves over a round clump of foliage: darker toward the bottom right, lighter toward the top left, so it reads as leaves, not a ball."""
    for _ in range(int(r * r / per)):
        a, d = rng.random() * math.tau, r * 0.92 * math.sqrt(rng.random())
        lx, ly = x + math.cos(a) * d, y + math.sin(a) * d
        lit = 0.5 - 0.5 * ((lx - x) * 0.7 + (ly - y) * 0.7) / r  # 1 at the top left, 0 at the bottom right
        t = max(0.0, min(1.0, lit + rng.uniform(-0.35, 0.35)))
        p.circle(lx, ly, rng.uniform(2.2, 4.6) * (r / 40) ** 0.5, fill=lerp(dark, light, t))


def blob(rng, cx, cy, r, n=13, jitter=0.22):
    """An irregular round outline (a stone)."""
    out, a0 = [], rng.random() * math.tau
    for i in range(n):
        a = a0 + math.tau * i / n
        rr = r * (1 - jitter + 2 * jitter * rng.random())
        out.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr * (0.82 + 0.18 * rng.random())))
    return out


def barrel():
    p, c, R = Pic(256), 128, 100
    p.circle(c + 4, c + 5, R + 2, fill=(40, 26, 16))
    p.shaded_circle(c, c, R, (92, 56, 30), (168, 112, 64))
    for i in range(20):  # the staves
        a = math.tau * i / 20
        p.line([(c + math.cos(a) * 70, c + math.sin(a) * 70), (c + math.cos(a) * (R - 2), c + math.sin(a) * (R - 2))], (66, 40, 22), 2)
    p.circle(c, c, R - 5, outline=(78, 78, 82), width=8)  # the hoops
    p.circle(c - 1, c - 1, R - 7, outline=(128, 128, 132), width=2)
    p.circle(c, c, 74, outline=(78, 78, 82), width=7)
    p.shaded_circle(c, c, 68, (118, 76, 42), (176, 124, 76))  # the lid, its boards across
    for y in (-34, -11, 12, 35):
        w = math.sqrt(max(0, 66 ** 2 - y ** 2))
        p.line([(c - w, c + y), (c + w, c + y)], (82, 52, 28), 2)
    p.circle(c + 30, c + 22, 6, fill=(36, 24, 14))  # the bung
    p.save("Barrel")


def crate():
    p, a, b, f = Pic(256), 24, 232, 22
    rng = random.Random(7)
    p.rect(a + 4, a + 5, b + 4, b + 5, fill=(40, 26, 14), radius=4)
    p.rect(a, a, b, b, fill=(166, 120, 72), radius=4)
    g, gd = p.layer()  # the grain, faint
    for _ in range(26):
        y = rng.uniform(a + f, b - f)
        x0 = rng.uniform(a + f, b - f - 60)
        p.line([(x0, y), (x0 + rng.uniform(30, 90), y + rng.uniform(-2, 2))], (110, 72, 38, 90), 1.2, d=gd)
    p.lay(g)
    for k in range(1, 4):  # the boards
        y = a + k * (b - a) / 4
        p.line([(a + f, y), (b - f, y)], (96, 62, 32), 2.4)
    brace = [(a + f, b - f - 18), (a + f + 18, b - f), (b - f, a + f + 18), (b - f - 18, a + f)]
    p.poly(brace, fill=(150, 104, 58), outline=(92, 60, 30), width=2)
    for x0, y0, x1, y1 in ((a, a, b, a + f), (a, b - f, b, b), (a, a, a + f, b), (b - f, a, b, b)):  # the frame
        p.rect(x0, y0, x1, y1, fill=(128, 86, 48), outline=(84, 54, 28), width=2)
    for x, y in ((a + 11, a + 11), (b - 11, a + 11), (a + 11, b - 11), (b - 11, b - 11), (128, a + 11), (128, b - 11), (a + 11, 128), (b - 11, 128)):
        p.circle(x, y, 3.2, fill=(58, 58, 62))
    p.save("Crate")


def table():
    p, c, R = Pic(384), 192, 166
    rng = random.Random(11)
    p.circle(c + 5, c + 6, R + 2, fill=(40, 24, 12))
    p.shaded_circle(c, c, R, (98, 62, 34), (156, 106, 62), steps=20)
    g, gd = p.layer()
    for _ in range(14):  # the grain: faint rings round the middle
        r = rng.uniform(20, R - 14)
        p.circle(c + rng.uniform(-6, 6), c + rng.uniform(-6, 6), r, outline=(70, 42, 20, 70), width=1.3, d=gd)
    p.lay(g)
    p.circle(c, c, R - 7, outline=(80, 50, 26), width=3)
    p.save("Round Table")


def chair():
    p = Pic(256)
    p.rect(62, 82, 202, 214, fill=(40, 26, 14), radius=14)
    p.rect(58, 76, 198, 208, fill=(150, 100, 58), outline=(84, 54, 28), width=3, radius=14)
    for x in (93, 128, 163):
        p.line([(x, 82), (x, 202)], (110, 72, 38), 2)
    p.rect(50, 44, 206, 84, fill=(112, 72, 40), outline=(70, 44, 22), width=3, radius=10)  # the back
    for x in (64, 192):
        p.circle(x, 64, 11, fill=(90, 58, 30), outline=(60, 38, 18), width=2)
    p.save("Chair")


def rock(seed):
    p, rng = Pic(256), random.Random(100 + seed)
    pts = blob(rng, 128, 130, rng.uniform(78, 96), n=rng.choice((11, 13, 15)))
    p.poly([(x + 5, y + 6) for x, y in pts], fill=(34, 32, 30))
    base = rng.choice(((92, 90, 86), (98, 92, 84), (86, 88, 90)))
    p.shaded_poly(pts, base, lerp(base, (214, 210, 200), 0.62), steps=18)
    g, gd = p.layer()  # a crack or two and some grit, faint
    for _ in range(rng.randint(1, 2)):
        x, y, a = 128 + rng.uniform(-30, 30), 130 + rng.uniform(-30, 30), rng.random() * math.tau
        line = [(x, y)]
        for _ in range(6):
            a += rng.uniform(-0.5, 0.5)
            x, y = x + math.cos(a) * 9, y + math.sin(a) * 9
            line.append((x, y))
        p.line(line, (50, 48, 44, 130), 1.3, d=gd)
    for _ in range(120):
        a, d = rng.random() * math.tau, 70 * math.sqrt(rng.random())
        p.circle(128 + math.cos(a) * d, 130 + math.sin(a) * d, rng.uniform(0.8, 1.8), fill=(40, 38, 36, 60) if rng.random() < 0.6 else (240, 236, 226, 70), d=gd)
    p.lay(g)
    p.poly(pts, outline=(52, 50, 46), width=2)
    p.save(f"Rock {seed}")


def bush(seed):
    p, rng = Pic(256), random.Random(200 + seed)
    hue = [((36, 78, 32), (116, 168, 70)), ((30, 70, 40), (98, 160, 92)), ((52, 76, 28), (140, 170, 66))][seed - 1]
    clumps = []
    for _ in range(rng.randint(9, 13)):
        a, d = rng.random() * math.tau, rng.uniform(0, 62)
        clumps.append((128 + math.cos(a) * d, 128 + math.sin(a) * d, rng.uniform(28, 44)))
    for x, y, r in clumps:  # the shadow under it all
        p.circle(x + 5, y + 6, r + 3, fill=(20, 38, 18))
    for x, y, r in sorted(clumps, key=lambda q: -(q[0] + q[1])):  # back (bottom right) to front (top left)
        p.shaded_circle(x, y, r, hue[0], hue[1], steps=12)
        leaves(p, rng, x, y, r, lerp(hue[0], (0, 0, 0), 0.15), lerp(hue[1], (255, 255, 230), 0.12))
    if seed == 3:  # berries
        for _ in range(14):
            a, d = rng.random() * math.tau, rng.uniform(0, 80)
            p.circle(128 + math.cos(a) * d, 128 + math.sin(a) * d, 4, fill=(168, 34, 40), outline=(90, 18, 22), width=1)
    p.save(f"Bush {seed}")


def tree():
    p, rng, c = Pic(768), random.Random(301), 384
    clumps = []
    for _ in range(46):
        a, d = rng.random() * math.tau, 250 * math.sqrt(rng.random())
        clumps.append((c + math.cos(a) * d, c + math.sin(a) * d, rng.uniform(56, 96)))
    for x, y, r in clumps:
        p.circle(x + 10, y + 12, r + 6, fill=(18, 34, 16))
    for x, y, r in sorted(clumps, key=lambda q: -(q[0] + q[1])):
        p.shaded_circle(x, y, r, (30, 66, 28), (104, 156, 66), steps=14)
        leaves(p, rng, x, y, r, (24, 54, 22), (126, 172, 78), per=46)
    p.save("Tree")


def campfire():
    p, rng, c = Pic(256), random.Random(401), 128
    p.shaded_circle(c, c, 66, (40, 36, 34), (78, 70, 64))  # ash
    for i in range(10):  # the ring of stones
        a = math.tau * i / 10 + rng.uniform(-0.08, 0.08)
        pts = blob(rng, c + math.cos(a) * 84, c + math.sin(a) * 84, rng.uniform(17, 22), n=9, jitter=0.18)
        p.poly([(x + 2, y + 3) for x, y in pts], fill=(30, 28, 26))
        p.shaded_poly(pts, (92, 88, 84), (186, 180, 170), steps=10)
    for ang in (20, 80, 140):  # three logs across the fire
        a = math.radians(ang)
        dx, dy, nx, ny = math.cos(a) * 54, math.sin(a) * 54, -math.sin(a) * 9, math.cos(a) * 9
        p.poly([(c - dx + nx, c - dy + ny), (c + dx + nx, c + dy + ny), (c + dx - nx, c + dy - ny), (c - dx - nx, c - dy - ny)], fill=(96, 60, 32), outline=(52, 32, 16), width=2)
        p.circle(c + dx, c + dy, 9, fill=(150, 112, 70), outline=(52, 32, 16), width=2)
    g, gd = p.layer()  # the glow and the flames
    for k in range(10):
        p.circle(c, c, 46 - k * 4, fill=(255, 120 + k * 8, 30, 26 + k * 6), d=gd)
    p.lay(g)
    for k, (col, r) in enumerate((((255, 140, 30), 26), ((255, 190, 60), 17), ((255, 236, 150), 9))):
        p.circle(c - k * 2, c - k * 3, r, fill=col)
    p.save("Campfire")


if __name__ == "__main__":
    barrel()
    crate()
    table()
    chair()
    for i in (1, 2, 3):
        rock(i)
        bush(i)
    tree()
    campfire()
