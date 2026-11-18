"""
Painted Relief, pass 2: the anti-plastic renderer.

What made pass 1 look like plastic or clay, and the fix for each:
  * smooth large-scale shading over whole islands -> shade from LOCAL relief (high-pass)
  * no detail below ~10 px                       -> erosion-style fBm + micro-hills down to ~1.5 px
  * flat colour fields                           -> canopy speckle, forest clumps, hue drift, rock tints
  * solid icing-like snow                        -> broken snow keyed to fine ridges
  * straight, pale rivers                        -> traced, smoothed, meandering, darker polylines
  * soft sticker-like coasts                     -> thin dark coast edge, tighter shelf glow
  * plus valley occlusion (cavity darkening) and a final unsharp mask for crispness
"""
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

from render import fbm, noise_at, ridged, smoothstep


def eroded_fbm(Y, X, scale, octaves, rng, persistence=0.5, k=0.9):
    """fBm whose higher octaves are damped where accumulated slope is steep.
    Gives gully-and-spur texture that reads like eroded terrain."""
    total = np.zeros_like(Y)
    gx_acc = np.zeros_like(Y)
    gy_acc = np.zeros_like(Y)
    amp, norm, s = 1.0, 0.0, scale
    for _ in range(octaves):
        n = noise_at(Y, X, s, rng).astype(np.float32)
        gy, gx = np.gradient(n)
        gx_acc += gx * s * amp
        gy_acc += gy * s * amp
        w = 1.0 / (1.0 + k * (gx_acc * gx_acc + gy_acc * gy_acc))
        total += amp * n * w
        norm += amp
        amp *= persistence
        s = max(s / 2.0, 1.5)
    return total / norm


def chaikin(pts, iters=3):
    pts = np.asarray(pts, float)
    for _ in range(iters):
        if len(pts) < 3:
            return pts
        q = pts[:-1] * 0.75 + pts[1:] * 0.25
        r = pts[:-1] * 0.25 + pts[1:] * 0.75
        mid = np.empty((len(q) * 2, 2))
        mid[0::2], mid[1::2] = q, r
        pts = np.vstack([pts[:1], mid, pts[-1:]])
    return pts


def river_polylines(acc, rec, sea, thr):
    """Trace the D8 river network into polylines (head -> junction/sea)."""
    is_riv = ((acc > thr) & ~sea).ravel()
    idx = np.flatnonzero(is_riv)
    up = np.zeros(acc.size, np.int32)
    np.add.at(up, rec[idx], 1)
    heads = idx[up[idx] == 0]
    heads = heads[np.argsort(-acc.ravel()[heads])]  # big rivers claim their stem first
    visited = np.zeros(acc.size, bool)
    sea_f = sea.ravel()
    lines = []
    for h in heads:
        path, c = [h], h
        while True:
            visited[c] = True
            nxt = rec[c]
            if nxt == c:
                break
            path.append(nxt)
            if sea_f[nxt] or visited[nxt]:
                break
            c = nxt
        if len(path) > 2:
            lines.append(path)
    return lines


def render_textured(sim, W, H, sim_scale, lat_top=0.52, lat_bot=0.28, river_thr=500,
                    moist_bias=0.55, moist_noise=0.45, coast_moist=0.3, snowline=0.74,
                    overrides=(), moist_lat=0.0, snow_lat=0.3):
    """overrides: climate regions that ignore the physical gradient (e.g. a spirit's
    climate region). Each is a dict with 'w' (HxW weight 0..1) and any of
    'temp' / 'moist' (0..1 targets) and 'snow' (0..1 ground-snow cover)."""
    rng = sim["rng"]
    t0 = time.time()
    sh, sw = sim["sh"], sim["sw"]
    f32 = np.float32

    hs = ndi.zoom(sim["h"], (H / sh, W / sw), order=3).astype(f32)
    Y, X = np.mgrid[0:H, 0:W].astype(f32)
    sea = hs <= 0
    mz = np.clip(ndi.zoom(sim["mz"], (H / sh, W / sw), order=1), 0, 1).astype(f32)
    rug = smoothstep(mz, 0.08, 0.6).astype(f32)
    lat = np.abs(lat_top + (lat_bot - lat_top) * (Y / H))

    # ---- multi-scale relief -------------------------------------------------
    wy, wx = fbm(Y, X, 40, 3, rng) * 10, fbm(Y, X, 40, 3, rng) * 10
    mtn = eroded_fbm(Y + wy, X + wx, 36, 7, rng)                     # gullies/spurs
    mtn += 0.45 * (ridged(Y + wy, X + wx, 18, 4, rng) - 0.5)          # crisp crests
    hills = fbm(Y, X, 26, 4, rng) * 0.6 + fbm(Y, X, 7, 3, rng) * 0.4  # lowland micro-relief
    hs_d = np.where(sea, hs, hs + mtn * 0.13 * rug + hills * 0.02 * (1 - rug)).astype(f32)
    elev = np.clip(hs_d, 0, None)
    print(f"    relief {time.time()-t0:.1f}s")

    # ---- climate (less blurred, irregular edges) ----------------------------
    coast_d = ndi.distance_transform_edt(~sea).astype(f32)
    temp = 1.0 - lat ** 1.3 * 1.05 - elev * 0.3 + fbm(Y, X, 300, 3, rng) * 0.1
    moist = moist_bias + fbm(Y, X, 220, 4, rng) * moist_noise + np.exp(-coast_d / 60) * coast_moist
    up = ndi.maximum_filter1d(elev, size=90, axis=1, origin=44)
    moist -= np.clip(up - elev, 0, None) * 0.9
    moist = ndi.gaussian_filter(moist, 4) + fbm(Y, X, 45, 3, rng) * 0.12
    moist += moist_lat * (lat - lat.mean())  # wetter toward the cold end, drier toward the warm
    moist = smoothstep(moist, 0.08, 0.7).astype(f32)
    temp = smoothstep(ndi.gaussian_filter(temp, 4), 0.1, 0.95).astype(f32)
    for o in overrides:  # climate regions replace the gradient inside their borders
        w = o["w"].astype(f32)
        if "temp" in o:
            temp = temp * (1 - w) + o["temp"] * w
        if "moist" in o:
            moist = moist * (1 - w) + o["moist"] * w

    pal = np.array([
        [[186, 180, 160], [150, 150, 120], [96, 110, 86], [62, 84, 66]],    # cold: tundra -> blue-green taiga
        [[182, 170, 120], [140, 146, 88], [88, 112, 62], [58, 86, 50]],     # cool
        [[200, 184, 126], [142, 152, 72], [92, 124, 48], [56, 98, 36]],     # warm
        [[232, 214, 158], [200, 186, 110], [128, 146, 56], [64, 108, 32]],  # hot: desert -> olive -> broadleaf
    ], dtype=f32)
    ti = np.clip(temp, 0, 0.999) * 3
    mi = np.clip(moist, 0, 0.999) * 3
    land = np.stack([ndi.map_coordinates(pal[..., c], [ti, mi], order=1, mode="nearest")
                     for c in range(3)], axis=-1).astype(f32)

    # ---- vegetation texture -------------------------------------------------
    veg = smoothstep(moist, 0.35, 0.8) * (1 - rug * 0.8)
    clump = smoothstep(fbm(Y, X, 14, 3, rng), -0.05, 0.25)               # forest clumps
    canopy = fbm(Y, X, 2.5, 2, rng) * 0.6 + fbm(Y, X, 6, 2, rng) * 0.4  # speckle
    tf = np.clip(temp, 0, 1)[..., None]  # conifers read blue-green, broadleaf yellow-green
    dark_forest = np.array([38, 60, 50], f32) * (1 - tf) + np.array([48, 84, 28], f32) * tf
    land = land * (1 - (clump * veg * 0.45)[..., None]) + dark_forest * (clump * veg * 0.45)[..., None]
    land *= (1 + canopy * (0.09 + 0.12 * veg))[..., None]
    hue = fbm(Y, X, 70, 3, rng)                                          # olive <-> blue-green drift
    land[..., 0] *= 1 + hue * 0.06
    land[..., 2] *= 1 - hue * 0.06

    # ---- rock, cavities, snow -------------------------------------------------
    gy, gx = np.gradient(hs_d * 60)
    slope = np.hypot(gx, gy)
    rock_w = np.clip(smoothstep(elev, 0.14, 0.36) * 0.75 + smoothstep(slope, 0.5, 1.8) * 0.6, 0, 1) * rug
    rock_w *= smoothstep(elev, 0.03, 0.12)
    rn = fbm(Y, X, 20, 3, rng)
    rock = (np.array([194, 160, 120], f32) * (0.5 + 0.5 * rn)[..., None]
            + np.array([142, 116, 88], f32) * (0.5 - 0.5 * rn)[..., None])
    land = land * (1 - rock_w[..., None]) + rock * rock_w[..., None]

    ridge = hs_d - ndi.gaussian_filter(hs_d, 2.5)
    cavity = np.clip(-ridge, 0, None)
    sl = snowline - (lat ** 2) * snow_lat
    snow_w = smoothstep(elev - sl + ridge * 7 + mtn * 0.07, 0.0, 0.035) * rug
    snow_w *= 0.88 * smoothstep(fbm(Y, X, 3, 2, rng) + 0.35, 0.0, 0.5)  # broken, speckled snow
    for o in overrides:  # ground snow inside frozen climate regions, broken by terrain texture
        if o.get("snow"):
            cover = o["w"] * o["snow"] * smoothstep(fbm(Y, X, 4, 3, rng) + ridge * 20 + 0.75, 0.0, 0.45)
            snow_w = np.maximum(snow_w, np.where(sea, 0, cover))
    land = land * (1 - snow_w[..., None]) + np.array([236, 237, 240], f32) * snow_w[..., None]

    # ---- shading from LOCAL relief -------------------------------------------
    local = hs_d - 0.78 * ndi.gaussian_filter(hs_d, 28)
    gy, gx = np.gradient(local * 70)
    nz = 1.0 / np.sqrt(gx * gx + gy * gy + 1)

    def lamb(lx, ly, lz):
        n = np.sqrt(lx * lx + ly * ly + lz * lz)
        return (-gx * nz * lx - gy * nz * ly + nz * lz) / n

    def flat(lx, ly, lz):
        return lz / np.sqrt(lx * lx + ly * ly + lz * lz)

    shade = 0.7 * lamb(-1, -1, 1.0) + 0.3 * lamb(-0.4, -1, 1.6)
    shade_ref = 0.7 * flat(-1, -1, 1.0) + 0.3 * flat(-0.4, -1, 1.6)
    shade_f = np.clip(1 + 1.25 * (shade - shade_ref), 0.42, 1.38)
    shade_f *= 1 - np.clip(cavity * 9, 0, 0.35)                           # valley occlusion
    land *= shade_f[..., None]
    sshadow = np.clip((1 - shade_f) * 1.4, 0, 1) * snow_w
    land = land * (1 - sshadow[..., None]) + np.array([136, 146, 166], f32) * sshadow[..., None]

    # thin dark coast edge
    edge = (coast_d <= 1.6) & ~sea
    land[edge] *= 0.78
    print(f"    land {time.time()-t0:.1f}s")

    # ---- ocean -----------------------------------------------------------------
    sea_d = ndi.distance_transform_edt(sea).astype(f32)
    deep = np.array([60, 72, 116], f32)
    mid = np.array([92, 118, 160], f32)
    shallow = np.array([152, 180, 200], f32)
    on = fbm(Y, X, 50, 4, rng)
    shelf = np.exp(-(sea_d + on * 6) / 26)
    ocean = deep * (1 - shelf[..., None]) + mid * shelf[..., None]
    rim = np.exp(-sea_d / 5)
    ocean = ocean * (1 - rim[..., None] * 0.5) + shallow * (rim[..., None] * 0.5)
    ocean *= (1 + (fbm(Y, X, 120, 4, rng) * 0.05 + fbm(Y, X, 8, 2, rng) * 0.015))[..., None]

    rgb = np.where(sea[..., None], ocean, land)

    # lakes with a dark edge
    lakes = ndi.zoom(sim["lakes"].astype(f32), (H / sh, W / sw), order=1) > 0.5
    if lakes.any():
        lake_edge = lakes & ~ndi.binary_erosion(lakes, iterations=2)
        rgb[lakes] = np.array([110, 140, 176], f32)
        rgb[lake_edge] = np.array([74, 92, 118], f32)

    # ---- rivers: traced, smoothed, meandering --------------------------------
    ss = 2  # supersample for anti-aliasing
    riv = Image.new("L", (W * ss, H * ss), 0)
    dr = ImageDraw.Draw(riv)
    acc_f = sim["acc"].ravel()
    mean_n = noise_at(np.mgrid[0:sh, 0:sw][0].astype(float), np.mgrid[0:sh, 0:sw][1].astype(float), 6, rng)
    for path in river_polylines(sim["acc"], sim["rec"], sim["sea"], river_thr):
        ys, xs = np.divmod(np.array(path), sw)
        pts = np.stack([(xs + 0.5) * sim_scale, (ys + 0.5) * sim_scale], axis=1)
        # meander: offset perpendicular by noise
        if len(pts) > 3:
            d = np.gradient(pts, axis=0)
            nrm = np.stack([-d[:, 1], d[:, 0]], axis=1)
            nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-6
            off = mean_n[ys, xs] * sim_scale * 1.6
            off[0] = off[-1] = 0
            pts = pts + nrm * off[:, None]
        sm = chaikin(pts, 3)
        a = acc_f[path]
        a_s = np.interp(np.linspace(0, 1, len(sm)), np.linspace(0, 1, len(a)), a)
        for i in range(len(sm) - 1):
            w = 0.9 + np.log2(max(a_s[i], river_thr) / river_thr) * 0.55
            dr.line([tuple(sm[i] * ss), tuple(sm[i + 1] * ss)], fill=255, width=max(1, int(w * ss)))
    riv = riv.resize((W, H), Image.LANCZOS)
    riv = np.asarray(riv, f32)[..., None] / 255
    rgb = rgb * (1 - riv * 0.9) + np.array([70, 88, 116], f32) * (riv * 0.9)
    print(f"    water {time.time()-t0:.1f}s")

    # ---- grain + crispness ----------------------------------------------------
    grain = ndi.gaussian_filter(rng.normal(0, 1, (H, W)).astype(f32), 0.6)
    rgb *= (1 + grain[..., None] * 0.018)
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    img = img.filter(ImageFilter.UnsharpMask(radius=1.4, percent=55, threshold=1))
    print(f"  render (textured) {time.time()-t0:.1f}s")
    return img
