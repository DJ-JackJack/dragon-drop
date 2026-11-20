/**
 * Spike: can buildings be read out of a city map picture? Colour classes -> connected blobs -> a rotated rectangle for each.
 * Run: node node_modules/tsx/dist/cli.mjs spikes/city-reader/read.ts <picture.png> <out-prefix> [x0 y0 x1 y1 for a zoomed overlay]
 * Throwaway: this decides whether the approach is worth building into core; it is not part of the app.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { decodeImage, encodePng } from "../../packages/tools/src/images.ts";

const [, , src, outPrefix, ...crop] = process.argv;
const img = decodeImage(new Uint8Array(readFileSync(src)))!;
const { w, h, data } = img;

// ---- 1. colour classes
const RED = 1, GREY = 2, YELLOW = 3;
const cls = new Uint8Array(w * h);
function hsv(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hue = 0;
  if (d > 0) hue = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: hue * 60, s: mx ? d / mx : 0, v: mx / 255 };
}
for (let i = 0; i < w * h; i++) {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  const c = hsv(r, g, b);
  if ((c.h < 22 || c.h > 340) && c.s > 0.32 && c.v > 0.3 && c.v < 0.8 && r > g + 30) cls[i] = RED;
  else if (c.s < 0.2 && c.v > 0.36 && c.v < 0.7 && Math.abs(r - b) < 40 && c.h > 40 && c.h < 130) cls[i] = GREY;
  else if (c.h > 36 && c.h < 54 && c.s > 0.5 && c.v > 0.55 && c.v < 0.85) cls[i] = YELLOW;
}

// ---- 2. connected blobs of one class (4-connected), holes filled, then a rotated rectangle by principal axes
interface Blob { cls: number; area: number; cx: number; cy: number; w: number; h: number; angle: number; fit: number; x0: number; y0: number; x1: number; y1: number }
const seen = new Uint8Array(w * h);
const blobs: Blob[] = [];
const stack: number[] = [];
for (let s = 0; s < w * h; s++) {
  if (!cls[s] || seen[s]) continue;
  const k = cls[s];
  const px: number[] = [];
  seen[s] = 1; stack.push(s);
  while (stack.length) {
    const p = stack.pop()!; px.push(p);
    const x = p % w, y = (p / w) | 0;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q >= 0 && !seen[q] && cls[q] === k) { seen[q] = 1; stack.push(q); }
    }
  }
  if (px.length < 25) continue;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (const p of px) { const x = p % w, y = (p / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  // fill the holes (ridge lines and the like): flood the outside of the blob's box, whatever is not outside counts as inside
  const bw = x1 - x0 + 3, bh = y1 - y0 + 3, mask = new Uint8Array(bw * bh);
  for (const p of px) mask[((((p / w) | 0) - y0 + 1) * bw) + (p % w) - x0 + 1] = 1;
  const out = new Uint8Array(bw * bh), st2 = [0];
  out[0] = 1;
  while (st2.length) {
    const p = st2.pop()!, x = p % bw, y = (p / bw) | 0;
    for (const q of [x > 0 ? p - 1 : -1, x < bw - 1 ? p + 1 : -1, y > 0 ? p - bw : -1, y < bh - 1 ? p + bw : -1]) if (q >= 0 && !out[q] && !mask[q]) { out[q] = 1; st2.push(q); }
  }
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < bw * bh; i++) if (!out[i]) { n++; sx += i % bw; sy += (i / bw) | 0; }
  const cx = sx / n, cy = sy / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < bw * bh; i++) if (!out[i]) { const dx = (i % bw) - cx, dy = ((i / bw) | 0) - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy), ca = Math.cos(angle), sa = Math.sin(angle);
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (let i = 0; i < bw * bh; i++) if (!out[i]) { const dx = (i % bw) - cx, dy = ((i / bw) | 0) - cy, u = dx * ca + dy * sa, v = -dx * sa + dy * ca; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
  const bwid = u1 - u0 + 1, bhei = v1 - v0 + 1;
  blobs.push({ cls: k, area: n, cx: cx + x0 - 1, cy: cy + y0 - 1, w: bwid, h: bhei, angle, fit: n / (bwid * bhei), x0, y0, x1, y1 });
}

// ---- 3. numbers
const name = ["", "red", "grey", "yellow"];
for (const k of [RED, GREY, YELLOW]) {
  const bs = blobs.filter((b) => b.cls === k);
  const areas = bs.map((b) => b.area).sort((a, b) => a - b);
  const med = areas[(areas.length / 2) | 0] ?? 0;
  const good = bs.filter((b) => b.fit > 0.78 && b.area > 60 && b.area < med * 6).length;
  const huge = bs.filter((b) => b.area >= med * 6).length;
  const ragged = bs.filter((b) => b.fit <= 0.78).length;
  console.log(`${name[k].padEnd(7)} blobs ${String(bs.length).padStart(5)}   median area ${med}px   tidy rectangles ${good}   ragged ${ragged}   very large (merged or not a roof) ${huge}`);
}
console.log(`picture ${w} x ${h}; ${blobs.length} blobs in all`);

// ---- 4. overlay: the picture with each blob's rectangle drawn on it
const colour: Record<number, [number, number, number]> = { [RED]: [0, 255, 255], [GREY]: [255, 0, 255], [YELLOW]: [0, 120, 255] };
const ov = { w, h, data: new Uint8ClampedArray(data) };
const px = (x: number, y: number, c: [number, number, number]) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= w || y >= h) return; const o = (y * w + x) * 4; ov.data[o] = c[0]; ov.data[o + 1] = c[1]; ov.data[o + 2] = c[2]; };
const line = (ax: number, ay: number, bx: number, by: number, c: [number, number, number]) => { const n = Math.ceil(Math.hypot(bx - ax, by - ay)); for (let i = 0; i <= n; i++) px(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, c); };
for (const b of blobs) {
  if (b.area >= 6000) continue; // (not buildings: the sea, the parks, a whole district)
  const ca = Math.cos(b.angle), sa = Math.sin(b.angle), hw = b.w / 2, hh = b.h / 2;
  const cs: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => [b.cx + u * ca - v * sa, b.cy + u * sa + v * ca]);
  const c = b.fit > 0.78 ? colour[b.cls] : [255, 255, 0] as [number, number, number];
  for (let i = 0; i < 4; i++) line(cs[i][0], cs[i][1], cs[(i + 1) % 4][0], cs[(i + 1) % 4][1], c);
}
writeFileSync(`${outPrefix}-overlay.png`, encodePng(ov));
if (crop.length === 4) {
  const [x0, y0, x1, y1] = crop.map(Number), k = 3, cw = (x1 - x0) * k, ch = (y1 - y0) * k;
  const z = { w: cw, h: ch, data: new Uint8ClampedArray(cw * ch * 4) };
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const o = (y * cw + x) * 4, s = (((y / k) | 0) + y0) * w + ((x / k) | 0) + x0, so = s * 4; z.data[o] = ov.data[so]; z.data[o + 1] = ov.data[so + 1]; z.data[o + 2] = ov.data[so + 2]; z.data[o + 3] = 255; }
  writeFileSync(`${outPrefix}-zoom.png`, encodePng(z));
}
