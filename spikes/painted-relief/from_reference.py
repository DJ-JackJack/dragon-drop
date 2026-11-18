"""
Spike: reference sketch -> Painted Relief map.

Reads a flat "landmass" sketch where
  * land is olive/yellow, water is blue-grey,
  * RED strokes mark mountain ranges,
  * a GREEN dot marks a city,
and builds a heightmap from it (coast distance + ridges along the red strokes +
noise), then erodes, routes rivers, and renders it with render.py's passes.

Usage:
    python3 from_reference.py REF.jpg --out out.jpg [--size 2048] [--font Cinzel.woff]
"""
import argparse
import os
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage as ndi

from render import erode_and_route, fbm, render, ridged, smoothstep
from render_textured import render_textured
from skimage.morphology import skeletonize


def read_reference(path, size):
    im = Image.open(path).convert("RGB")
    src = np.asarray(im).astype(int)
    R, G, B = src[..., 0], src[..., 1], src[..., 2]
    red = (R > 190) & (G < 110) & (B < 110)
    green = (G > R + 25) & (G > B + 25) & (G > 90)
    land = ((R > B + 35) & (G > B + 20)) | red | green
    land = ndi.binary_closing(ndi.binary_opening(land, iterations=2), iterations=3)

    s = size / src.shape[0]
    city = None
    if green.any():
        ys, xs = np.nonzero(green)
        city = (xs.mean() * s, ys.mean() * s,
                max(xs.max() - xs.min() + 1, ys.max() - ys.min() + 1), src.shape[1])

    def down(mask):
        return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).resize(
            (size, size), Image.BILINEAR), float) / 255

    return down(land), down(red), city


def build_heights(land_f, red_f, rng, mtn_width=8.0, mtn_height=0.7, coast_smooth=3.0,
                  spurs=1.0, keep_clear=None):
    """land_f / red_f are soft masks [0,1] on the simulation grid.
    mtn_width: half-width of the range core in px @1024 (the red stroke's own
    thickness is ignored: strokes are reduced to 1-px centrelines first).
    coast_smooth: blur (px @1024) that melts hex-grid stair-steps into natural coasts."""
    n = land_f.shape[0]
    Y, X = np.mgrid[0:n, 0:n].astype(float)

    # Naturalise the hex-stepped coastline: blur, warp slightly, re-threshold
    sc = n / 1024  # parameters below were tuned at 1024 px
    wy, wx = fbm(Y, X, 14 * sc, 3, rng) * 3.5 * sc, fbm(Y, X, 14 * sc, 3, rng) * 3.5 * sc
    soft = ndi.gaussian_filter(land_f, coast_smooth * sc)
    soft = ndi.map_coordinates(soft, [Y + wy, X + wx], order=1, mode="nearest")
    soft += fbm(Y, X, 4 * sc, 3, rng) * 0.08
    land = soft > 0.5
    d_in = ndi.distance_transform_edt(land)
    d_sea = ndi.distance_transform_edt(~land)

    base = 0.03 + 0.10 * (1 - np.exp(-d_in / (28 * sc))) + fbm(Y, X, 90 * sc, 4, rng) * 0.04

    # Mountain range on the red strokes' CENTRELINES (stroke width is ignored)
    spine = skeletonize(red_f > 0.25)
    d_red, (iy, ix) = ndi.distance_transform_edt(~spine, return_indices=True)
    # Seaward side of a ring range: compress distance so the range runs down
    # to the outer coast as cliffs (no lowland strip = no landing beach).
    cy, cx = np.argwhere(spine).mean(axis=0)
    outward = np.hypot(Y - cy, X - cx) > np.hypot(iy - cy, ix - cx)
    # ...but only on narrow coastal strips, so open lowlands seaward of a range
    # (e.g. the one landing zone) stay low.
    strip = outward * (1 - smoothstep(ndi.distance_transform_edt(land), 8 * sc, 16 * sc))
    strip = ndi.gaussian_filter(strip.astype(float), 2 * sc)
    d_red = d_red * (1 - 0.55 * strip)
    warp = fbm(Y, X, 30 * sc, 3, rng) * 2.5 * sc
    # Width and height vary ALONG the range: noise is sampled at each pixel's nearest
    # spine point, so a whole cross-section shares one width (narrow necks, broad massifs).
    wn = fbm(Y, X, 70 * sc, 3, rng)
    width_f = ndi.gaussian_filter(0.5 + 1.0 * smoothstep(wn[iy, ix], -0.35, 0.35), 4 * sc)  # 0.5x..1.5x
    hn = fbm(Y, X, 45 * sc, 3, rng)
    along = ndi.gaussian_filter(0.35 + 0.65 * smoothstep(hn[iy, ix], -0.35, 0.3), 4 * sc)  # passes
    w = mtn_width * sc * width_f
    core = np.exp(-((d_red + warp) / w) ** 2)
    foot = np.exp(-((d_red + warp) / (w * 2.2)) ** 2) * 0.22
    rid = ridged(Y + wy * 3, X + wx * 3, 12 * sc, 6, rng)
    mount = core * (0.35 + 0.65 * rid) * along + foot * (0.5 + 0.5 * rid)

    # Spurs: tapering ridges that branch off the range and wander inland
    if spurs > 0:
        bcore, bfoot, bmz = spur_field(spine, d_in, warp, rng, sc, mtn_width, spurs, keep_clear)
        mount = np.maximum(mount, bcore * (0.35 + 0.65 * rid) * 0.95 + bfoot * (0.5 + 0.5 * rid))
        core = np.maximum(core, bmz)
    mount *= smoothstep(d_in, 0.5, 2.5 * sc)

    h = np.where(land, np.maximum(base + mount * mtn_height, 0.006),
                 -(0.05 + 0.55 * (1 - np.exp(-d_sea / (40 * sc)))))
    mz = np.clip(core * 1.3 + foot, 0, 1) * land
    return h, ~land, mz


def spur_field(spine, d_in, warp, rng, sc, mtn_width, density=1.0, keep_clear=None):
    """Grow tapering spur ridges from points on the range spine, heading inland
    (up the distance-from-coast gradient) with a wandering random walk, plus the
    occasional sub-branch. Returns (core, foothills, mountain-zone) fields."""
    n = spine.shape[0]
    gy, gx = np.gradient(ndi.gaussian_filter(d_in, 3 * sc))
    canvas = Image.new("L", (n, n), 0)
    draw = ImageDraw.Draw(canvas)

    def clear(x, y, check_coast=True):
        if not (0 <= x < n - 1 and 0 <= y < n - 1):
            return False
        if check_coast and d_in[int(y), int(x)] < 4 * sc:  # don't run a spur into the sea
            return False
        if keep_clear and np.hypot(x - keep_clear[0], y - keep_clear[1]) < keep_clear[2]:
            return False
        return True

    def grow(x, y, heading, length, t0=1.0, t1=0.2, depth=0):
        steps = int(length / sc)
        pts = [(x, y)]
        for i in range(steps):
            target = np.arctan2(gy[int(y), int(x)], gx[int(y), int(x)])
            heading += rng.normal(0, 0.16) + 0.06 * np.angle(np.exp(1j * (target - heading)))
            x, y = x + np.cos(heading) * sc, y + np.sin(heading) * sc
            if not clear(x, y, check_coast=i > 6 * sc):  # spines sit near the outer coast
                break
            pts.append((x, y))
        for i in range(len(pts) - 1):
            t = t0 + (t1 - t0) * i / max(len(pts) - 1, 1)
            draw.line([pts[i], pts[i + 1]], fill=int(40 + 215 * t), width=1)
        if depth == 0 and len(pts) > 12 and rng.random() < 0.45:  # sub-branch
            k = int(len(pts) * rng.uniform(0.35, 0.7))
            bx, by = pts[k]
            tk = t0 + (t1 - t0) * k / (len(pts) - 1)
            grow(bx, by, heading + rng.choice([-1, 1]) * rng.uniform(0.6, 1.1),
                 length * rng.uniform(0.3, 0.5), tk * 0.85, 0.15, depth + 1)

    pts = np.argwhere(spine)
    spacing = 50 * sc / max(density, 1e-3)
    chosen = []
    for idx in rng.permutation(len(pts)):
        p = pts[idx]
        if all(np.hypot(*(p - q)) > spacing for q in chosen):
            chosen.append(p)
    for y, x in chosen:
        if rng.random() > 0.9 or not clear(x, y, check_coast=False):
            continue
        heading = np.arctan2(gy[y, x], gx[y, x]) + rng.normal(0, 0.5)
        grow(float(x), float(y), heading, rng.uniform(18, 50) * sc)

    arr = np.asarray(canvas, float) / 255
    if not (arr > 0).any():
        z = np.zeros_like(arr)
        return z, z, z
    d_b, (by, bx) = ndi.distance_transform_edt(arr == 0, return_indices=True)
    tap = ndi.gaussian_filter(arr[by, bx], 2 * sc)
    wb = mtn_width * sc * 0.65 * (0.45 + 0.55 * tap)
    bcore = np.exp(-((d_b + warp * 0.6) / wb) ** 2) * tap
    bfoot = np.exp(-((d_b + warp * 0.6) / (wb * 2.2)) ** 2) * 0.16 * tap
    return bcore, bfoot, bcore


def label(img, text, xy, size, font_path, color=(18, 18, 22), glow=(255, 255, 255),
          spacing=0.18):
    """Letter-spaced caps with a soft glow, centred on xy."""
    try:
        font = ImageFont.truetype(font_path, size)
    except Exception:
        font = ImageFont.truetype("DejaVuSerif.ttf", size)
    widths = [font.getbbox(ch)[2] for ch in text]
    gap = size * spacing
    total = sum(widths) + gap * (len(text) - 1)
    x0, y0 = xy[0] - total / 2, xy[1] - size * 0.6
    txt = Image.new("RGBA", img.size, (0, 0, 0, 0))
    glo = Image.new("RGBA", img.size, (0, 0, 0, 0))
    dt, dg = ImageDraw.Draw(txt), ImageDraw.Draw(glo)
    x = x0
    for ch, w in zip(text, widths):
        dg.text((x, y0), ch, font=font, fill=glow + (235,), stroke_width=3, stroke_fill=glow + (235,))
        dt.text((x, y0), ch, font=font, fill=color + (255,))
        x += w + gap
    glo = glo.filter(ImageFilter.GaussianBlur(3))
    out = Image.alpha_composite(img.convert("RGBA"), glo)
    return Image.alpha_composite(out, txt).convert("RGB")


def scale_bar(img, km_per_px, font_path, xy=None, miles=None):
    """Alternating black/white bar in miles, Cinzel labels with glow.
    Picks a round step so the bar spans roughly 12% of the map width."""
    W, H = img.size
    px_per_mile = 1.609344 / km_per_px
    if miles is None:
        target = W * 0.12 / px_per_mile / 3
        step = min([1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000],
                   key=lambda v: abs(np.log(v / target)))
        miles = tuple(step * i for i in range(4))
    x0, y0 = xy or (int(W * 0.05), int(H * 0.955))
    bh = max(6, int(H * 0.004))
    d = ImageDraw.Draw(img)
    total = miles[-1] * px_per_mile
    d.rectangle([x0 - 3, y0 - 3, x0 + total + 3, y0 + bh + 3], fill=(255, 255, 255))
    for i in range(len(miles) - 1):
        a, b = x0 + miles[i] * px_per_mile, x0 + miles[i + 1] * px_per_mile
        d.rectangle([a, y0, b, y0 + bh], fill=(20, 20, 24) if i % 2 == 0 else (245, 242, 232),
                    outline=(20, 20, 24))
    size = int(H * 0.009)
    for m in miles:
        img = label(img, str(m), (x0 + m * px_per_mile, y0 - size * 0.9), size, font_path, spacing=0)
    img = label(img, "MILES", (x0 + total + size * 2.6, y0 + bh * 0.4), size, font_path, spacing=0.1)
    return img


def city_marker(img, xy, r=6):
    d = ImageDraw.Draw(img)
    x, y = xy
    d.ellipse([x - r - 3, y - r - 3, x + r + 3, y + r + 3], fill=(255, 255, 255))
    d.ellipse([x - r, y - r, x + r, y + r], fill=(22, 22, 26))
    d.ellipse([x - r * 0.45, y - r * 0.45, x + r * 0.45, y + r * 0.45], fill=(235, 225, 190))
    return img


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("ref")
    ap.add_argument("--size", type=int, default=2048)
    ap.add_argument("--sim-scale", type=int, default=2)
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--lat-top", type=float, default=0.52)
    ap.add_argument("--lat-bot", type=float, default=0.28)
    ap.add_argument("--font", default="DejaVuSerif.ttf")
    ap.add_argument("--city-name", default="City")
    ap.add_argument("--region", default="", help="label,x,y (render px) e.g. 'THE LOWLANDS,1700,1790'")
    ap.add_argument("--out", default="render.jpg")
    ap.add_argument("--style", choices=["textured", "smooth"], default="textured",
                    help="textured = pass-2 renderer; smooth = original pass-1 look")
    ap.add_argument("--cache", default="", help="npz file to cache the terrain simulation")
    ap.add_argument("--mtn-width", type=float, default=8.0, help="range core half-width, px @1024")
    ap.add_argument("--mtn-height", type=float, default=0.7)
    ap.add_argument("--coast-smooth", type=float, default=3.0)
    ap.add_argument("--spurs", type=float, default=1.0, help="density of inland spur ridges (0 = none)")
    ap.add_argument("--keep-clear", type=float, default=75,
                    help="no spurs within this radius (px @1024) of the city (keeps the landing zone open)")
    ap.add_argument("--min-lake", type=float, default=60, help="min lake area, cells @1024")
    ap.add_argument("--snowline", type=float, default=0.74, help="higher = less snow (>=1.0: none)")
    ap.add_argument("--city-km", type=float, default=0.0,
                    help="real width of the city whose green dot sets the scale; adds a scale bar")
    ap.add_argument("--moist-lat", type=float, default=0.0, help="+ = wetter toward the cold edge")
    ap.add_argument("--snow-lat", type=float, default=0.3, help="how much snowline drops toward the cold edge")
    ap.add_argument("--climate-region", "--dominion", dest="climate_region", action="append", default=[],
                    help="climate override: 'LABEL;cx;cy;r;temp;moist;snow;edge' in reference px, "
                         "temp/moist/snow 0..1 (use - to leave unchanged), edge = border softness px")
    ap.add_argument("--mi-per-ref-px", type=float, default=0.0,
                    help="set the scale directly (miles per reference-sketch pixel); adds a scale bar")
    a = ap.parse_args()

    rng = np.random.default_rng(a.seed)
    t0 = time.time()
    n = a.size // a.sim_scale
    land_f, red_f, city = read_reference(a.ref, n)
    keys = ("h", "filled", "sea", "acc", "rec", "lakes", "mz")
    if a.cache and os.path.exists(a.cache):
        z = np.load(a.cache)
        sim = {k: z[k] for k in keys}
        print("  loaded cached simulation")
    else:
        kc = (city[0], city[1], a.keep_clear * n / 1024) if city else None
        h, sea, mz = build_heights(land_f, red_f, rng, a.mtn_width, a.mtn_height, a.coast_smooth,
                                   a.spurs, kc)
        print(f"  heights {time.time()-t0:.1f}s")
        hl, f, rec, acc, lakes = erode_and_route(h, sea, passes=4)
        print(f"  erosion+hydrology {time.time()-t0:.1f}s")
        sim = dict(h=hl, filled=f, sea=sea, acc=acc, rec=rec, lakes=lakes, mz=mz)
        if a.cache:
            np.savez_compressed(a.cache, **sim)
    # Drop tiny lakes (noise hollows in the mountains read as blue speckle)
    sim["lakes"] = ndi.binary_opening(sim["lakes"], iterations=3)  # drop thin valley slivers
    lab, nl = ndi.label(sim["lakes"])
    if nl:
        sizes = ndi.sum(sim["lakes"], lab, range(1, nl + 1))
        keep = np.concatenate([[False], sizes >= a.min_lake * (n / 1024) ** 2])
        sim["lakes"] = keep[lab]
    sim.update(sh=n, sw=n, rng=np.random.default_rng(a.seed + 1000))
    river_thr = int(260 * (n / 500) ** 2 * 0.5)
    overrides, dom_labels = [], []
    if a.climate_region:
        ref_w = city[3] if city else 4096
        k = a.size / ref_w
        Yr, Xr = np.mgrid[0:a.size, 0:a.size].astype(float)
        drng = np.random.default_rng(a.seed + 7)
        warp = fbm(Yr, Xr, 60, 3, drng) * 40  # organic, not circular, borders
        for spec in a.climate_region:
            name, cx, cy, r, t, m, sn, edge = spec.split(";")
            cx, cy, r, edge = float(cx) * k, float(cy) * k, float(r) * k, max(float(edge) * k, 1)
            dist = np.hypot(Xr - cx, Yr - cy) + warp
            o = {"w": 1 - smoothstep(dist, r - edge, r + edge)}
            for key, v in (("temp", t), ("moist", m), ("snow", sn)):
                if v.strip() != "-":
                    o[key] = float(v)
            overrides.append(o)
            dom_labels.append((name, cx, cy))
    if a.style == "textured":
        img = render_textured(sim, a.size, a.size, a.sim_scale, lat_top=a.lat_top,
                              lat_bot=a.lat_bot, river_thr=river_thr, snowline=a.snowline,
                              overrides=overrides, moist_lat=a.moist_lat, snow_lat=a.snow_lat)
    else:
        img = render(sim, a.size, a.size, a.sim_scale, a.font, labels=False,
                     lat_top=a.lat_top, lat_bot=a.lat_bot, polar_ice=False,
                     river_thr=river_thr,
                     moist_bias=0.55, moist_noise=0.45, coast_moist=0.3,
                     snowline=0.74, lowland_relief=0.12)

    for name, x, y in dom_labels:
        img = label(img, name, (x, y), int(a.size * 0.0105), a.font, color=(120, 20, 20), spacing=0.2)
    if a.region:
        name, rx, ry = a.region.split(",")
        img = label(img, name, (float(rx), float(ry)), int(a.size * 0.012), a.font,
                    spacing=0.3)
    if city:
        cx, cy = city[0] * a.sim_scale, city[1] * a.sim_scale
        img = city_marker(img, (cx, cy), r=int(a.size * 0.0028))
        img = label(img, a.city_name, (cx, cy + a.size * 0.016), int(a.size * 0.0135), a.font,
                    spacing=0.06)
        print(f"  city at render px ({cx:.0f}, {cy:.0f})")
        km_per_px = 0
        if a.mi_per_ref_px > 0:
            km_per_px = a.mi_per_ref_px * 1.609344 * (city[3] / a.size)
        elif a.city_km > 0:
            km_per_px = a.city_km / city[2] * (city[3] / a.size)
        if km_per_px:
            img = scale_bar(img, km_per_px, a.font)
            print(f"  scale: {km_per_px:.3f} km/render px; map is {km_per_px * a.size:.0f} km wide")
    img.save(a.out, quality=90)
    print(f"wrote {a.out}  ({time.time()-t0:.1f}s)")
