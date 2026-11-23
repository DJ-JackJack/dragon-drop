/**
 * What walls are built of: the five built-in looks (core WALL_LOOKS), then the pictures in the asset packs (wall strips, or square textures such as brick
 * floors, tiled along the wall). The Wall and Room tools use it for new walls, the inspector for chosen ones.
 */
import { WALL_BASE, WALL_LOOKS, WALL_LOOK_NAMES, type WallLook, assetLabel, parseAssetId } from "@mapmaker/core";
import { assetUrl } from "./assetsApi.ts";
import { PackGrid } from "./PackGrid.tsx";

export interface WallChoice { look: WallLook; asset: string | null }

/** What a wall style is called, for a button: the picture's name, or the look's. */
export function wallChoiceLabel(c: WallChoice): string {
  return c.asset ? assetLabel(parseAssetId(c.asset)?.path ?? c.asset) : WALL_LOOK_NAMES[c.look];
}

/** The small swatch on a button: the look's colour, or the picture. */
export function WallSwatch({ c }: { c: WallChoice }) {
  const style = c.asset ? { backgroundImage: `url(${assetUrl(c.asset, 64)})` } : { background: `rgb(${WALL_BASE[c.look].join(",")})` };
  return <span className="swatch now" style={style} />;
}

export function WallLookPicker({ value, onPick }: { value: WallChoice; onPick: (c: WallChoice) => void }) {
  return (
    <div className="wall-picker" data-testid="wall-looks">
      <div className="materials">
        {WALL_LOOKS.map((l) => (
          <button key={l} className={`swatch${!value.asset && value.look === l ? " on" : ""}`} style={{ background: `rgb(${WALL_BASE[l].join(",")})` }}
            title={WALL_LOOK_NAMES[l]} aria-label={WALL_LOOK_NAMES[l]} onClick={() => onPick({ look: l, asset: null })} data-testid={`wall-look-${l}`} />
        ))}
      </div>
      <PackGrid
        kinds={[{ cat: "walls", label: "walls" }, { cat: "terrain", label: "square textures" }]} testId="pack-walls" item="pack-wall" placeholder="Search: stone, brick, wood…"
        noneFound="No wall pictures were found in your asset packs: try Square textures (a brick or plank floor makes a good wall), or a look above."
        noFolder="To build walls from the pictures in your asset packs, choose your asset folder in Settings (Maps and assets)."
        stateOf={(it) => ({ on: it.id === value.asset })}
        onChoose={(it) => onPick({ look: value.look, asset: it.id })}
      />
    </div>
  );
}

/** What a door's or window's picture is called: the picture's name, or the built-in one's. */
export function portalLabel(kind: "door" | "window", picture: string | null | undefined): string {
  return picture ? assetLabel(parseAssetId(picture)?.path ?? picture) : kind === "door" ? "Wooden door" : "Glass";
}

/** The small swatch for a door or window: its picture, or the built-in one's colour. */
export function PortalSwatch({ kind, picture }: { kind: "door" | "window"; picture: string | null | undefined }) {
  const style = picture ? { backgroundImage: `url(${assetUrl(picture, 64)})` } : { background: kind === "door" ? "rgb(158,106,58)" : "rgb(160,206,230)" };
  return <span className="swatch now" style={style} />;
}

/** What a door or window looks like: the built-in one (a wooden door, glass) or a picture from the asset packs' doors and windows. */
export function PortalPicker({ kind, value, onPick }: { kind: "door" | "window"; value: string | null; onPick: (picture: string | null) => void }) {
  return (
    <div className="wall-picker" data-testid={`${kind}-looks`}>
      <div className="row">
        <button className={value ? "" : "on"} onClick={() => onPick(null)} data-testid={`${kind}-builtin`}><PortalSwatch kind={kind} picture={null} /> {portalLabel(kind, null)}</button>
      </div>
      <PackGrid
        kinds={[{ cat: "portals", label: "doors and windows" }]} testId="pack-portals" item="pack-portal" placeholder={kind === "door" ? "Search: door, gate, oak…" : "Search: window, shutter…"}
        noneFound="No doors or windows were found in your asset packs (Dragon Drop knows them by the words door, gate, window, portcullis... in their folder or file names)."
        noFolder="To use the doors and windows in your asset packs, choose your asset folder in Settings (Maps and assets)."
        stateOf={(it) => ({ on: it.id === value })}
        onChoose={(it) => onPick(it.id)}
      />
    </div>
  );
}
