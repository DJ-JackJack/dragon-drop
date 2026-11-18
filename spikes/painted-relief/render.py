"""
Look-dev spike: "Painted Relief" world-map style (target: reference map #2).

Throwaway prototype. Proves the look can be produced procedurally from data
(heightmap -> erosion -> hydrology -> climate -> layered colour passes) before
we port the passes to TypeScript generators + PixiJS shaders.

Usage:
    python3 render.py --seed 7 --out preview.png [--font path/to/Cinzel.woff]
"""
import argparse
import heapq
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage as ndi

# ----------------------------------------------------------------------------
# Noise
# ----------------------------------------------------------------------------

def noise_at(Y, X, scale, rng):
    """Smooth value noise in [-1, 1] sampled at float coords (Y, X)."""
    gh = int(np.ceil((Y.max() - Y.min()) / scale)) + 6
    gw = int(np.ceil((X.max() - X.min()) / scale)) + 6
    grid = rng.random((gh, gw))
    ys = (Y - Y.min()) / scale + 2
    xs = (X - X.min()) / scale + 2
    v = ndi.map_coordinates(grid, [ys, xs], order=3, mode="reflect")
    return (v - 0.5) * 2.0


def fbm(Y, X, scale, octaves, rng, persistence=0.5, lacunarity=2.0):
    total, amp, norm, s = 0.0, 1.0, 0.0, scale
    for _ in range(octaves):
        total = total + amp * noise_at(Y, X, s, rng)
        norm += amp
        amp *= persistence
        s /= lacunarity
    return total / norm


def ridged(Y, X, scale, octaves, rng, persistence=0.55, lacunarity=2.1):
    """Ridged multifractal: sharp crests, good for mountain ranges."""
    total, amp, norm, s = 0.0, 1.0, 0.0, scale
    weight = 1.0
    for _ in range(octaves):
        n = 1.0 - np.abs(noise_at(Y, X, s, rng))
        n = n * n * weight
        weight = np.clip(n * 1.6, 0, 1)
        total = total + amp * n
        norm += amp
        amp *= persistence
        s /= lacunarity
    return total / norm


def smoothstep(x, a, b):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ----------------------------------------------------------------------------
# Hydrology on the simulation grid
# ----------------------------------------------------------------------------

NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def priority_flood(h, sea):
    """Fill depressions so every land cell drains to the sea (Barnes et al.)."""
    H, W = h.shape
    filled = h.copy()
    closed = sea.copy()
    heap = []
    # Seed: land cells touching sea or map edge.
    edge = np.zeros_like(sea)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    touch = ndi.binary_dilation(sea, structure=np.ones((3, 3))) & ~sea
    seeds = np.argwhere((touch | edge) & ~sea)
    for y, x in seeds:
        heapq.heappush(heap, (filled[y, x], y, x))
        closed[y, x] = True
    eps = 1e-5
    fl = filled  # local alias
    while heap:
        z, y, x = heapq.heappop(heap)
        for dy, dx in NB:
            ny, nx = y + dy, x + dx
            if 0 <= ny < H and 0 <= nx < W and not closed[ny, nx]:
                closed[ny, nx] = True
                if fl[ny, nx] <= z:
                    fl[ny, nx] = z + eps
                heapq.heappush(heap, (fl[ny, nx], ny, nx))
    return filled


def d8_receivers(f, sea):
    H, W = f.shape
    idx = np.arange(H * W).reshape(H, W)
    best = np.zeros_like(f)
    rec = idx.copy()
    pad = np.pad(f, 1, mode="edge")
    pidx = np.pad(idx, 1, mode="edge")
    for dy, dx in NB:
        dist = np.hypot(dy, dx)
        nb = pad[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
        drop = (f - nb) / dist
        better = drop > best
        best = np.where(better, drop, best)
        rec = np.where(better, pidx[1 + dy:1 + dy + H, 1 + dx:1 + dx + W], rec)
    rec[sea] = idx[sea]
    return rec.ravel(), best


def flow_accumulation(f, rec):
    order = np.argsort(-f.ravel(), kind="stable")
    acc = [1.0] * f.size
    r = rec.tolist()
    for i in order.tolist():
        j = r[i]
        if j != i:
            acc[j] += acc[i]
    return np.array(acc).reshape(f.shape)


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def generate(seed, W, H, sim_scale):
    rng = np.random.default_rng(seed)
    t0 = time.time()

    # --- base landmass on the simulation grid --------------------------------
    sh, sw = H // sim_scale, W // sim_scale
    Y, X = np.mgrid[0:sh, 0:sw].astype(float)

    # Domain warp for organic coastlines
    wy = fbm(Y, X, 90, 4, rng) * 40
    wx = fbm(Y, X, 90, 4, rng) * 40
    base = fbm(Y + wy, X + wx, 160, 7, rng, persistence=0.52)

    # A handful of island "cores" so we get an archipelago, not noise soup
    cores = np.zeros_like(base)
    spines = np.zeros_like(base)
    for _ in range(rng.integers(9, 15)):
        cy, cx = rng.uniform(0.2, 0.8) * sh, rng.uniform(0.1, 0.9) * sw
        r = rng.uniform(0.04, 0.12) * sw
        ry, rx = r * rng.uniform(0.35, 0.7), r
        a = rng.uniform(0, np.pi)
        dy, dx = (Y + wy * 0.8) - cy, (X + wx * 0.8) - cx
        u = (dx * np.cos(a) + dy * np.sin(a)) / rx
        v = (-dx * np.sin(a) + dy * np.cos(a)) / ry
        k = rng.uniform(0.5, 1.0)
        cores += k * np.exp(-(u * u + v * v) * 1.3)
        # mountain spine roughly along the long axis, offset to one side
        v0 = rng.uniform(-0.35, 0.35)
        spines = np.maximum(spines, k * np.exp(-((v - v0) / 0.32) ** 2) * (1 - smoothstep(np.abs(u), 0.6, 1.05)))

    # Keep land away from the poles / map border
    lat = (Y / sh - 0.5) * 2
    edge_x = np.minimum(X, sw - 1 - X) / sw
    falloff = smoothstep(edge_x, 0.0, 0.08) * (1 - smoothstep(np.abs(lat), 0.78, 0.98))

    h = (0.75 * base + 0.55 * cores) * falloff - 0.25 * (1 - falloff)

    # Sea level by target land fraction
    land_frac = 0.33
    h = h - np.quantile(h, 1 - land_frac)
    land = h > 0

    # --- mountains: ridged noise inside "orogeny" bands -----------------------
    inland = ndi.distance_transform_edt(land)
    zone = smoothstep(fbm(Y + wy, X + wx, 200, 3, rng), 0.05, 0.4) * 0.7
    rid = ridged(Y + wy * 0.5, X + wx * 0.5, 45, 6, rng)
    mz = np.clip(spines + zone, 0, 1)
    mount = (0.35 + 0.65 * rid) * mz * smoothstep(inland, 1, 10)
    hl = np.where(land, h / h.max() * 0.25 + mount * 0.75 + 0.01, h / -h.min() * 0.6)
    print(f"  landmass {time.time()-t0:.1f}s")

    # --- stream-power erosion (a few passes) ----------------------------------
    sea = hl <= 0
    hl, f, rec, acc, lakes = erode_and_route(hl, sea, passes=6)
    print(f"  erosion+hydrology {time.time()-t0:.1f}s")

    return dict(h=hl, filled=f, sea=sea, acc=acc, rec=rec, lakes=lakes, mz=mz * smoothstep(inland, 1, 10),
                sh=sh, sw=sw, rng=rng)


def erode_and_route(hl, sea, passes=6, k=0.0016, diffusion=0.12):
    """Stream-power erosion passes, then final flow routing, rivers and lakes."""
    for _ in range(passes):
        f = priority_flood(hl, sea)
        rec, slope = d8_receivers(f, sea)
        acc = flow_accumulation(f, rec)
        ero = k * np.power(acc, 0.5) * slope
        hl = np.where(sea, hl, hl - np.clip(ero, 0, 0.05))
        lap = ndi.laplace(hl)  # thermal / diffusion smoothing on land
        hl = np.where(sea, hl, hl + diffusion * lap)
        hl = np.where(sea, hl, np.maximum(hl, 0.002))
    f = priority_flood(hl, sea)
    rec, slope = d8_receivers(f, sea)
    acc = flow_accumulation(f, rec)
    lakes = (f - hl > 0.012) & ~sea
    return hl, f, rec, acc, lakes


def render(sim, W, H, sim_scale, font_path, labels, lat_top=-1.0, lat_bot=1.0,
           polar_ice=True, river_thr=260, moist_bias=0.45, moist_noise=0.9,
           coast_moist=0.12, snowline=0.56, lowland_relief=0.04):
    """lat_top / lat_bot: signed latitude at the top and bottom edges
    (0 = equator, ±1 = pole). Default spans pole to pole.
    The remaining keyword args are climate/look knobs (defaults = random-world spike)."""
    rng = sim["rng"]
    t0 = time.time()
    sh, sw = sim["sh"], sim["sw"]

    # --- upsample to render resolution + fine relief detail -------------------
    hs = ndi.zoom(sim["h"], (H / sh, W / sw), order=3)
    Y, X = np.mgrid[0:H, 0:W].astype(float)
    sea = hs <= 0
    elev = np.clip(hs, 0, None)
    mz = np.clip(ndi.zoom(sim["mz"], (H / sh, W / sw), order=1), 0, 1)
    dwy, dwx = fbm(Y, X, 30, 3, rng) * 8, fbm(Y, X, 30, 3, rng) * 8
    detail = (ridged(Y + dwy, X + dwx, 22, 6, rng) - 0.5) + 0.5 * (ridged(Y, X, 48, 4, rng) - 0.5)
    rug = lowland_relief + (1 - lowland_relief) * smoothstep(mz, 0.1, 0.6)
    hs_d = np.where(sea, hs, hs + detail * 0.075 * rug)
    elev = np.clip(hs_d, 0, None)
    lat = np.abs(lat_top + (lat_bot - lat_top) * (Y / H))

    # --- climate --------------------------------------------------------------
    coast_d = ndi.distance_transform_edt(~sea)
    temp = 1.0 - lat ** 1.3 * 1.05 - elev * 0.3 + fbm(Y, X, 300, 3, rng) * 0.1
    moist = moist_bias + fbm(Y, X, 220, 4, rng) * moist_noise + np.exp(-coast_d / 60) * coast_moist
    # Rain shadow: westerlies dropping rain on windward slopes
    up = ndi.maximum_filter1d(elev, size=90, axis=1, origin=44)
    moist -= np.clip(up - elev, 0, None) * 0.9
    temp = ndi.gaussian_filter(temp, 6)
    moist = smoothstep(ndi.gaussian_filter(moist, 10), 0.08, 0.7)
    temp = smoothstep(temp, 0.1, 0.95)

    # --- biome palette: temperature x moisture (soft, painted) ----------------
    pal = np.array([
        # dry ................................................ wet
        [[188, 180, 152], [166, 166, 134], [110, 124, 86], [84, 104, 70]],    # cold
        [[190, 176, 124], [148, 154, 90], [102, 126, 62], [66, 100, 46]],     # cool
        [[208, 192, 130], [146, 158, 76], [96, 128, 50], [52, 98, 34]],       # warm
        [[240, 224, 164], [210, 196, 120], [118, 148, 56], [40, 94, 30]],     # hot
    ], dtype=float)
    ti = np.clip(temp, 0, 0.999) * (pal.shape[0] - 1)
    mi = np.clip(moist, 0, 0.999) * (pal.shape[1] - 1)
    land_rgb = np.stack([
        ndi.map_coordinates(pal[..., c], [ti, mi], order=1, mode="nearest")
        for c in range(3)], axis=-1)

    # Mountain flanks: tan/peach rock, then snow on high ridges
    gy, gx = np.gradient(hs_d * 55)
    slope = np.hypot(gx, gy)
    rock_w = np.clip(smoothstep(elev, 0.14, 0.38) * 0.7 + smoothstep(slope, 0.3, 1.1) * 0.55 * rug, 0, 1)
    rock_w *= smoothstep(elev, 0.04, 0.14)
    rock = np.array([196, 160, 118], float)
    land_rgb = land_rgb * (1 - rock_w[..., None]) + rock * rock_w[..., None]

    ridge = hs_d - ndi.gaussian_filter(hs_d, 3)
    snowline = snowline - (lat ** 2) * 0.3
    snow_w = smoothstep(elev - snowline + ridge * 4 + detail * 0.06, -0.01, 0.04)
    snow = np.array([246, 246, 250], float)
    land_rgb = land_rgb * (1 - snow_w[..., None]) + snow * snow_w[..., None]

    # --- hillshade (multi-directional, flat = neutral) -----------------------
    nz = 1.0 / np.sqrt(gx * gx + gy * gy + 1)
    nx_, ny_ = -gx * nz, -gy * nz

    def lamb(lx, ly, lz):
        n = np.sqrt(lx * lx + ly * ly + lz * lz)
        return (nx_ * lx + ny_ * ly + nz * lz) / n

    flat = 1.0 / np.sqrt(1 + 1 + 1.1 ** 2) * 1.1
    shade = 0.65 * lamb(-1, -1, 1.1) + 0.2 * lamb(-1, 0.3, 1.4) + 0.15 * lamb(0.2, -1, 1.4)
    flat_ref = 0.65 * flat + 0.2 * (1.4 / np.sqrt(1 + 0.09 + 1.96)) + 0.15 * (1.4 / np.sqrt(0.04 + 1 + 1.96))
    shade_f = np.clip(1 + 1.1 * (shade - flat_ref), 0.5, 1.3)
    # Snow shadows go cool blue-grey rather than dark brown
    land_rgb = land_rgb * shade_f[..., None]
    cool = np.array([150, 168, 200], float)
    shadow_amt = np.clip((1 - shade_f) * 1.6, 0, 1) * snow_w
    land_rgb = land_rgb * (1 - shadow_amt[..., None]) + cool * shadow_amt[..., None]

    # Painterly variation
    land_rgb *= (1 + fbm(Y, X, 30, 4, rng)[..., None] * 0.07)

    # --- ocean ----------------------------------------------------------------
    sea_d = ndi.distance_transform_edt(sea)
    shelf = np.exp(-sea_d / 30) * (0.85 + 0.15 * fbm(Y, X, 60, 3, rng))
    streak = smoothstep(fbm(Y * 3, X * 0.7, 120, 3, rng), 0.25, 0.6) * np.exp(-sea_d / 160) * 0.2
    deep = np.array([64, 76, 122], float)
    mid = np.array([92, 120, 166], float)
    shallow = np.array([140, 172, 198], float)
    s = np.clip(shelf + streak, 0, 1)[..., None]
    ocean = deep * (1 - s) + mid * s
    s2 = np.clip(np.exp(-sea_d / 9), 0, 1)[..., None]
    ocean = ocean * (1 - s2 * 0.45) + shallow * (s2 * 0.45)
    ocean *= (1 + fbm(Y, X, 90, 4, rng)[..., None] * 0.04)

    rgb = np.where(sea[..., None], ocean, land_rgb)

    # Lakes
    lakes = ndi.zoom(sim["lakes"].astype(float), (H / sh, W / sw), order=1) > 0.5
    rgb = np.where(lakes[..., None], np.array([118, 152, 190], float), rgb)

    # --- rivers ---------------------------------------------------------------
    acc, rec = sim["acc"], sim["rec"]
    riv = Image.new("L", (W, H), 0)
    dr = ImageDraw.Draw(riv)
    thr = river_thr
    ys, xs = np.nonzero((acc > thr) & ~sim["sea"])
    for y, x in zip(ys, xs):
        j = rec[y * sw + x]
        ry, rx = divmod(j, sw)
        wdt = 1 + int(np.log2(acc[y, x] / thr) * 0.7)
        dr.line([((x + .5) * sim_scale, (y + .5) * sim_scale),
                 ((rx + .5) * sim_scale, (ry + .5) * sim_scale)], fill=200, width=wdt)
    riv = np.asarray(riv.filter(ImageFilter.GaussianBlur(0.8)), float)[..., None] / 255
    rcol = np.array([98, 118, 150], float)
    rgb = rgb * (1 - riv * 0.85) + rcol * (riv * 0.85)

    # --- polar ice ------------------------------------------------------------
    ice_n = fbm(Y, X, 160, 5, rng)
    ice_w = smoothstep(lat + ice_n * 0.09, 0.83, 0.87)
    ice_h = ndi.gaussian_filter(ice_n + fbm(Y, X, 60, 3, rng) * 0.1, 6.0)
    igy, igx = np.gradient(ice_h * 40)
    ishade = np.clip(1 - (igx + igy) * 0.6, 0.92, 1.01)
    ice = np.array([238, 241, 245], float)[None, None, :] * ishade[..., None]
    ice = ice * 0.93 + np.array([170, 185, 205]) * 0.07 * (1 - ishade[..., None] + 0.5)
    if polar_ice:
        rgb = rgb * (1 - ice_w[..., None]) + ice * ice_w[..., None]

    # --- paper grain ----------------------------------------------------------
    grain = rng.normal(0, 1, (H, W))
    grain = ndi.gaussian_filter(grain, 0.7)
    rgb *= (1 + grain[..., None] * 0.012)

    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    print(f"  render {time.time()-t0:.1f}s")

    # --- labels ---------------------------------------------------------------
    if labels:
        img = draw_labels(img, sea, font_path)
    return img


def draw_labels(img, sea, font_path):
    """Place a few ocean labels in the largest open-water areas."""
    W, H = img.size
    padded = np.pad(sea, 1, constant_values=False)
    d = ndi.distance_transform_edt(padded)[1:-1, 1:-1]
    d[: int(H * 0.12)] = 0
    d[int(H * 0.88):] = 0
    names = ["OPEN  OCEAN", "INNER  SEA", "THE  SOUNDS"]
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    for name in names:
        y, x = np.unravel_index(np.argmax(d), d.shape)
        if d[y, x] < 30:
            break
        size = int(min(46, d[y, x] * 0.5))
        try:
            font = ImageFont.truetype(font_path, size)
        except Exception:
            font = ImageFont.truetype("DejaVuSerif.ttf", size)
        bb = font.getbbox(name)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        pos = (int(np.clip(x - tw // 2, 10, W - tw - 10)), int(np.clip(y - th // 2, 10, H - th - 10)))
        ImageDraw.Draw(glow).text(pos, name, font=font, fill=(255, 255, 255, 230),
                                  stroke_width=3, stroke_fill=(255, 255, 255, 230))
        ImageDraw.Draw(layer).text(pos, name, font=font, fill=(18, 18, 22, 255))
        yy, xx = np.ogrid[:H, :W]
        d[(yy - y) ** 2 + (xx - x) ** 2 < (tw * 1.4) ** 2] = 0
    glow = glow.filter(ImageFilter.GaussianBlur(3))
    out = Image.alpha_composite(img.convert("RGBA"), glow)
    out = Image.alpha_composite(out, layer)
    return out.convert("RGB")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=1000)
    ap.add_argument("--sim-scale", type=int, default=2)
    ap.add_argument("--font", default="DejaVuSerif.ttf")
    ap.add_argument("--no-labels", action="store_true")
    ap.add_argument("--out", default="preview.png")
    a = ap.parse_args()
    print(f"seed {a.seed}")
    sim = generate(a.seed, a.width, a.height, a.sim_scale)
    img = render(sim, a.width, a.height, a.sim_scale, a.font, not a.no_labels)
    img.save(a.out, quality=90)
    print(f"wrote {a.out}")
