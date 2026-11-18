/** Planning image exports: one image up to MAX_SINGLE_PX on a side, tiles of TILE_PX above that. */
export const MAX_SINGLE_PX = 8192;
export const TILE_PX = 4096;

export interface ExportPlan {
  width: number;
  height: number;
  tiled: boolean;
  cols: number;
  rows: number;
  tiles: { col: number; row: number; x: number; y: number; w: number; h: number }[];
}

export function planExport(mapW: number, mapH: number, factor: number): ExportPlan {
  const width = Math.round(mapW * factor), height = Math.round(mapH * factor);
  const tiled = Math.max(width, height) > MAX_SINGLE_PX;
  if (!tiled) return { width, height, tiled, cols: 1, rows: 1, tiles: [{ col: 0, row: 0, x: 0, y: 0, w: width, h: height }] };
  const cols = Math.ceil(width / TILE_PX), rows = Math.ceil(height / TILE_PX);
  const tiles = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * TILE_PX, y = row * TILE_PX;
      tiles.push({ col, row, x, y, w: Math.min(TILE_PX, width - x), h: Math.min(TILE_PX, height - y) });
    }
  }
  return { width, height, tiled, cols, rows, tiles };
}
