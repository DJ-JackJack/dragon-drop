/**
 * The levels of a battlemap, as a small panel over the map: the level being worked on is lit, a click switches to another, and a level can be added above or
 * below, renamed, given other elevations, or removed. (Page Up and Page Down also change level.) The floor, walls and lights on screen are those of the lit level;
 * the level just below it shows faintly where it has no floor. See docs/FOUNDRY.md, "Stage 2 design".
 */
import { type BattleLevel, type LevelsFile, MAX_LEVELS, levelsByHeight } from "@mapmaker/core";
import { ask, confirmBox, notice } from "./dialogs.tsx";
import { store } from "./store.ts";

/** Ask for a number of feet; null if cancelled or not a number. */
async function askFeet(message: string, value: number): Promise<number | null> {
  const text = await ask(message, String(value), "Next");
  if (text === null) return null;
  const n = Number(text.replace(/\s*(ft|feet)?\s*$/i, ""));
  if (!Number.isFinite(n)) { await notice(`"${text}" isn't a number of feet.`); return null; }
  return n;
}

async function editLevel(l: BattleLevel) {
  const name = await ask("Name of this level", l.name, "Next");
  if (name === null) return;
  const bottom = await askFeet(`Where is the floor of "${name}"? (feet; 0 is the ground, below it is negative)`, l.bottom);
  if (bottom === null) return;
  const top = await askFeet(`Where is the ceiling of "${name}"? (feet; above the floor)`, l.top);
  if (top === null) return;
  store.updateLevel(l.id, { name, bottom, top });
}

async function removeLevel(l: BattleLevel) {
  const ok = await confirmBox(`Remove the level "${l.name}"? Its floor, walls, lights and objects go with it. A checkpoint is saved first, so Restore in the Checkpoints list brings it back.`, "Remove level");
  if (ok) store.removeLevel(l.id);
}

export function LevelBar({ levels }: { levels: LevelsFile }) {
  const sorted = levelsByHeight(levels.levels).reverse(); // the highest first, like a building seen from the side
  const full = levels.levels.length >= MAX_LEVELS;
  const first = levels.levels[0]?.id;
  return (
    <div className="level-bar" data-testid="level-bar" role="group" aria-label="Levels">
      <div className="level-head">Levels</div>
      <button className="level-add" disabled={full} onClick={() => store.addLevel("above")} title={full ? `A map can have at most ${MAX_LEVELS} levels` : "Add an empty level above the highest"} data-testid="level-add-above">＋ Level above</button>
      {sorted.map((l) => (
        <div key={l.id} className={`level-row${l.id === levels.active ? " on" : ""}`} data-testid={`level-row-${l.id}`}>
          <button className="level-pick" onClick={() => store.setLevel(l.id)} aria-current={l.id === levels.active ? "true" : undefined}
            title={l.id === levels.active ? "The level you are working on" : "Switch to this level (Page Up / Page Down)"}>
            <span className="level-name">{l.name}</span>
            <span className="level-ft">{l.bottom} to {l.top} ft</span>
          </button>
          <button className="level-small" onClick={() => void editLevel(l)} title="Rename, or change its elevations" aria-label={`Edit ${l.name}`}>✎</button>
          <button className="level-small" disabled={l.id === first} onClick={() => void removeLevel(l)} aria-label={`Remove ${l.name}`}
            title={l.id === first ? "The first level can't be removed: it holds the map's own files. Rename it, or clear its floor." : "Remove this level"}>🗑</button>
        </div>
      ))}
      <button className="level-add" disabled={full} onClick={() => store.addLevel("below")} title={full ? `A map can have at most ${MAX_LEVELS} levels` : "Add an empty level below the lowest"} data-testid="level-add-below">＋ Level below</button>
    </div>
  );
}
