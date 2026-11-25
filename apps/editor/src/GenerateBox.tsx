/**
 * The Map panel's Generate box (core generators.ts): a dungeon or cave over the battlemap level on screen, or a village on a settlement map, in one click.
 * Seeded: the seed of the last one made shows here, so typing it again makes the same map. It asks first when something would be replaced; Undo takes it back.
 */
import { useState, useSyncExternalStore } from "react";
import type { GenSize, VillageSize } from "@mapmaker/core";
import { store } from "./store.ts";

const SIZE_NAMES: Record<GenSize, string> = { small: "Small", medium: "Medium", large: "Large" };
const VILLAGE_NAMES: Record<VillageSize, string> = { hamlet: "Hamlet", village: "Village", large: "Large village" };

export function GenerateBox({ kind, hasContent }: { kind: "battle" | "city"; hasContent: boolean }) {
  const last = useSyncExternalStore(store.subscribe, () => store.getState().generated);
  const [style, setStyle] = useState<"dungeon" | "cave">("dungeon");
  const [size, setSize] = useState<GenSize>("medium");
  const [village, setVillage] = useState<VillageSize>("village");
  const [doors, setDoors] = useState(true);
  const [torches, setTorches] = useState(true);
  const [seed, setSeed] = useState("");
  const [asking, setAsking] = useState(false);
  const busy = !!last?.busy;
  const go = () => {
    const n = Number(seed.trim());
    const s = seed.trim() && Number.isFinite(n) ? { seed: Math.abs(Math.round(n)) } : {};
    store.generate(kind === "city" ? { what: "village", size: village, ...s } : { what: style, size, doors, torches, ...s });
    setAsking(false);
  };
  const what = kind === "city" ? "village" : style;
  const replaces = kind === "city" ? "the streets and buildings on this settlement (its land, water and trees stay)" : "the floor, walls, doors and lights on this level (objects, notes, stairs and roofs stay)";
  return (
    <div className="gen-box" data-testid="generate-box">
      <h3>Generate</h3>
      {kind === "battle" ? (
        <>
          <div className="seg" role="group" aria-label="What to make">
            <button className={style === "dungeon" ? "on" : ""} onClick={() => setStyle("dungeon")} data-testid="gen-dungeon">Dungeon</button>
            <button className={style === "cave" ? "on" : ""} onClick={() => setStyle("cave")} data-testid="gen-cave">Cave</button>
          </div>
          <label className="field">Size
            <select value={size} onChange={(e) => setSize(e.target.value as GenSize)} data-testid="gen-size">
              {(Object.keys(SIZE_NAMES) as GenSize[]).map((k) => <option key={k} value={k}>{SIZE_NAMES[k]}</option>)}
            </select>
          </label>
          {style === "dungeon" && (
            <>
              <label className="check"><input type="checkbox" checked={doors} onChange={(e) => setDoors(e.target.checked)} /> Doors (a few secret)</label>
              <label className="check"><input type="checkbox" checked={torches} onChange={(e) => setTorches(e.target.checked)} /> Torches</label>
            </>
          )}
        </>
      ) : (
        <label className="field">Size
          <select value={village} onChange={(e) => setVillage(e.target.value as VillageSize)} data-testid="gen-size">
            {(Object.keys(VILLAGE_NAMES) as VillageSize[]).map((k) => <option key={k} value={k}>{VILLAGE_NAMES[k]}</option>)}
          </select>
        </label>
      )}
      <label className="field">Seed (empty: a new one each time)
        <input value={seed} inputMode="numeric" placeholder={last?.what === what && last.seed ? String(last.seed) : "new"} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))} data-testid="gen-seed" />
      </label>
      {asking ? (
        <div className="ask-replace">
          <p className="muted">This replaces {replaces}. Undo takes it back.</p>
          <div className="row">
            <button className="danger" onClick={go} data-testid="gen-confirm">Replace</button>
            <button onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button className="primary" disabled={busy} onClick={() => (hasContent ? setAsking(true) : go())} data-testid="gen-go">{busy ? "Making…" : `Make a ${what === "village" ? (village === "large" ? "large village" : village) : what}`}</button>
          {last?.seed && last.what === what && !busy && <button onClick={() => setSeed(String(last.seed))} title="Put the last one's seed in the box, to make it again">Seed {last.seed}</button>}
        </div>
      )}
      <p className="muted">{kind === "battle" ? "Rooms and corridors, or winding caverns, to edit as you like. Nothing is named or described: that stays yours." : "A road that follows the land, lanes, cottages, an inn and a temple, to edit as you like. Nothing is named."}</p>
    </div>
  );
}
