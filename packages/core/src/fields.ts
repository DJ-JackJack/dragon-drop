/** Whole-grid helpers on typed arrays: distance transforms, blurs, morphology, filters. */

const INF = 1e20;

/** 1D squared Euclidean distance transform (Felzenszwalb & Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Exact Euclidean distance (in px) from every cell to the nearest cell where `feature` is non-zero. */
export function distanceTo(feature: Uint8Array, W: number, H: number): Float32Array {
  const n = Math.max(W, H);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const tmp = new Float64Array(W * H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = feature[y * W + x] ? 0 : INF;
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) tmp[y * W + x] = d[y];
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = tmp[y * W + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) out[y * W + x] = Math.sqrt(d[x]);
  }
  return out;
}

/** Radii of three box blurs whose combination approximates a gaussian of this sigma. */
function boxRadii(sigma: number): number[] {
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => ((i < m ? wl : wu) - 1) / 2);
}

/** Box blur along rows (running sum, edges clamped). */
function boxRows(src: Float32Array, dst: Float32Array, W: number, H: number, r: number) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let acc = src[row] * (r + 1);
    for (let i = 1; i <= r; i++) acc += src[row + Math.min(i, W - 1)];
    for (let x = 0; x < W; x++) {
      dst[row + x] = acc * inv;
      acc += src[row + Math.min(x + r + 1, W - 1)] - src[row + Math.max(x - r, 0)];
    }
  }
}

/** Box blur along columns, a row at a time (cache-friendly). */
function boxCols(src: Float32Array, dst: Float32Array, W: number, H: number, r: number) {
  const inv = 1 / (2 * r + 1);
  const acc = new Float64Array(W);
  for (let x = 0; x < W; x++) {
    let a = src[x] * (r + 1);
    for (let i = 1; i <= r; i++) a += src[Math.min(i, H - 1) * W + x];
    acc[x] = a;
  }
  for (let y = 0; y < H; y++) {
    const row = y * W, add = Math.min(y + r + 1, H - 1) * W, sub = Math.max(y - r, 0) * W;
    for (let x = 0; x < W; x++) {
      dst[row + x] = acc[x] * inv;
      acc[x] += src[add + x] - src[sub + x];
    }
  }
}

/**
 * Gaussian blur with edge clamping. Small sigmas use an exact separable kernel; larger ones
 * use three box blurs (visually the same, and constant time per pixel at any sigma).
 */
export function gaussianBlur(src: Float32Array, W: number, H: number, sigma: number): Float32Array {
  if (sigma <= 0.01) return new Float32Array(src);
  if (sigma >= 2) {
    const a = new Float32Array(W * H), b = new Float32Array(W * H);
    const radii = boxRadii(sigma);
    boxRows(src, a, W, H, radii[0]);
    boxRows(a, b, W, H, radii[1]);
    boxRows(b, a, W, H, radii[2]);
    boxCols(a, b, W, H, radii[0]);
    boxCols(b, a, W, H, radii[1]);
    boxCols(a, b, W, H, radii[2]);
    return b;
  }
  return gaussianExact(src, W, H, sigma);
}

function gaussianExact(src: Float32Array, W: number, H: number, sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= W ? W - 1 : x + i;
        a += src[row + xx] * k[i + r];
      }
      tmp[row + x] = a;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= H ? H - 1 : y + i;
        a += tmp[yy * W + x] * k[i + r];
      }
      out[y * W + x] = a;
    }
  }
  return out;
}

/** Max over the previous `size` cells in each row (dir=+1: look left/west; -1: look right/east). */
export function upwindMax(src: Float32Array, W: number, H: number, size: number, dir: 1 | -1): Float32Array {
  const out = new Float32Array(W * H);
  const dq = new Int32Array(W);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let head = 0, tail = 0;
    for (let t = 0; t < W; t++) {
      const x = dir === 1 ? t : W - 1 - t;
      while (tail > head && src[row + dq[tail - 1]] <= src[row + x]) tail--;
      dq[tail++] = x;
      while (Math.abs(dq[head] - x) > size) head++;
      out[row + x] = src[row + dq[head]];
    }
  }
  return out;
}

/**
 * Max over the cells upwind within `size` px (including the cell itself), for wind travelling in direction (dx, dy)
 * (each -1, 0 or 1): wind from the north-west is (1, 1). Along a diagonal the cells are 1.41 px apart, so the window
 * shortens to cover the same distance. (Row-wise winds can use `upwindMax`.)
 */
export function upwindMaxDir(src: Float32Array, W: number, H: number, size: number, dx: number, dy: number): Float32Array {
  const out = new Float32Array(W * H);
  const steps = Math.max(1, Math.round(dx !== 0 && dy !== 0 ? size / Math.SQRT2 : size));
  for (const line of gridLines(W, H, dx, dy)) {
    const n = line.length, dq = new Int32Array(n);
    let head = 0, tail = 0;
    for (let t = 0; t < n; t++) {
      const v = src[line[t]];
      while (tail > head && src[line[dq[tail - 1]]] <= v) tail--;
      dq[tail++] = t;
      while (t - dq[head] > steps) head++;
      out[line[t]] = src[line[dq[head]]];
    }
  }
  return out;
}

/** Index lists of every straight line across a W×H grid in direction (dx, dy). */
function gridLines(W: number, H: number, dx: number, dy: number): Int32Array[] {
  const lines: Int32Array[] = [];
  const starts: [number, number][] = [];
  // a line starts at a cell whose predecessor (x - dx, y - dy) is off the grid
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = x - dx, py = y - dy;
    if (px < 0 || py < 0 || px >= W || py >= H) starts.push([x, y]);
  }
  for (const [x0, y0] of starts) {
    const idx: number[] = [];
    for (let x = x0, y = y0; x >= 0 && y >= 0 && x < W && y < H; x += dx, y += dy) idx.push(y * W + x);
    lines.push(Int32Array.from(idx));
  }
  return lines;
}

/** Sliding min (or max) over a (2r+1)-cell window along each line (monotonic deque). */
function slideLines(src: Float32Array, lines: Int32Array[], r: number, max: boolean): Float32Array {
  const out = new Float32Array(src.length);
  let dq = new Int32Array(0);
  const vals = new Float32Array(Math.max(...lines.map((l) => l.length)));
  for (const line of lines) {
    const n = line.length;
    if (dq.length < n) dq = new Int32Array(n);
    // work on a sign-flipped copy so one loop serves both: max(v) == -min(-v)
    const sgn = max ? -1 : 1;
    for (let t = 0; t < n; t++) vals[t] = sgn * src[line[t]];
    let head = 0, tail = 0, next = 0;
    for (let t = 0; t < n; t++) {
      const hi = t + r < n - 1 ? t + r : n - 1;
      for (; next <= hi; next++) {
        const v = vals[next];
        while (tail > head && vals[dq[tail - 1]] >= v) tail--;
        dq[tail++] = next;
      }
      while (dq[head] < t - r) head++;
      out[line[t]] = sgn * vals[dq[head]];
    }
  }
  return out;
}

const lineCache = new Map<string, Int32Array[][]>();

/**
 * Removes peaks that are narrow in every direction (spires, lone pinnacles) while keeping
 * anything that extends at least 2r+1 cells in some direction (ridges, ranges, plateaus):
 * the maximum of grey-scale openings with line segments in four orientations.
 * Used so a lone spire doesn't block the wind like a whole range.
 */
export function removeSpires(src: Float32Array, W: number, H: number, r: number): Float32Array {
  if (r < 1) return src;
  const key = `${W}x${H}`;
  let dirs = lineCache.get(key);
  if (!dirs) {
    dirs = [[1, 0], [0, 1], [1, 1], [1, -1]].map(([dx, dy]) => gridLines(W, H, dx, dy));
    lineCache.set(key, dirs);
  }
  const out = new Float32Array(src.length);
  for (const lines of dirs) {
    const opened = slideLines(slideLines(src, lines, r, false), lines, r, true);
    if (lines === dirs[0]) out.set(opened);
    else for (let i = 0; i < out.length; i++) if (opened[i] > out[i]) out[i] = opened[i];
  }
  return out;
}

/** Binary morphology with a 3x3 cross; `iterations` times. */
export function erode(mask: Uint8Array, W: number, H: number, iterations = 1): Uint8Array {
  let cur = mask;
  for (let it = 0; it < iterations; it++) {
    const out = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        out[i] = cur[i] && cur[i - 1] && cur[i + 1] && cur[i - W] && cur[i + W] ? 1 : 0;
      }
    }
    cur = out;
  }
  return cur;
}

export function dilate(mask: Uint8Array, W: number, H: number, iterations = 1): Uint8Array {
  let cur = mask;
  for (let it = 0; it < iterations; it++) {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        out[i] = cur[i] || (x > 0 && cur[i - 1]) || (x < W - 1 && cur[i + 1]) || (y > 0 && cur[i - W]) || (y < H - 1 && cur[i + W]) ? 1 : 0;
      }
    }
    cur = out;
  }
  return cur;
}

/** Remove connected components (4-connected) smaller than minSize cells. */
export function removeSmall(mask: Uint8Array, W: number, H: number, minSize: number): Uint8Array {
  const out = new Uint8Array(mask);
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const comp: number[] = [];
  for (let s = 0; s < W * H; s++) {
    if (!out[s] || seen[s]) continue;
    let sp = 0;
    stack[sp++] = s;
    seen[s] = 1;
    comp.length = 0;
    while (sp) {
      const i = stack[--sp];
      comp.push(i);
      const x = i % W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W];
      for (const j of nb) {
        if (j < 0 || j >= W * H || seen[j] || !out[j]) continue;
        seen[j] = 1;
        stack[sp++] = j;
      }
    }
    if (comp.length < minSize) for (const i of comp) out[i] = 0;
  }
  return out;
}
