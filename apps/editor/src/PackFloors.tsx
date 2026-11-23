/** The floor picker's part for the asset packs: every floor texture in the packs, searched and by pack; a click adds it to the map and paints with it. */
import { useState } from "react";
import type { AssetItem, MapMeta } from "@mapmaker/core";
import { floorTextureFor } from "./floorTextures.ts";
import { PackGrid } from "./PackGrid.tsx";

export function PackFloors({ meta, current, onChosen, onBrowse }: { meta: MapMeta | null; current: number; onChosen: (material: number) => void; onBrowse: () => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const onMap = new Map((meta?.battle?.palette ?? []).map((e) => [e.asset.toLowerCase(), e.id]));
  const choose = (it: AssetItem) => {
    const r = floorTextureFor(meta, it);
    if ("problem" in r) { setProblem(r.problem); return; }
    onChosen(r.id);
  };
  return (
    <PackGrid
      kinds={[{ cat: "terrain", label: "floors" }, { cat: "patterns", label: "patterns" }]} testId="pack-floors" item="pack-floor" placeholder="Search: grass, cobble, planks…"
      noneFound="No floor textures were found in your asset packs. Dragon Drop knows a floor texture by the words in its folder or file name (floor, ground, terrain, tiles, textures, grass, cobblestone...), or by its look."
      noFolder="To paint with the floors in your asset packs, choose your asset folder in Settings (Maps and assets)."
      stateOf={(it) => { const id = onMap.get(it.id.toLowerCase()); return { on: id !== undefined && id === current, added: id !== undefined, ...(id !== undefined && { note: "already on this map" }) }; }}
      onChoose={choose} onBrowse={onBrowse} problem={problem}
    />
  );
}
