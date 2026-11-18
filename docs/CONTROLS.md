# Controls: what Dragon Drop does and how it compares

Press **?** in the editor (or the **?** button in the top bar) for this list inside the program. The tool letters in the sheet come from the same list as the toolbar, so they can't drift.

## Moving around

| Do | How |
|---|---|
| Zoom | Mouse wheel (toward the pointer), or `+` and `-` (about the middle of the window). A trackpad pinch works too. |
| Fit the whole map | `0` or `Ctrl+0`, or the **Fit** button |
| Move the view | Hold `Space` and drag, middle-button drag, right-button drag, or the **Pan** tool (`H`), or the arrow keys (`Shift` for bigger steps) when nothing is selected |

## Editing

| Do | How |
|---|---|
| Undo, redo | `Ctrl+Z`; `Ctrl+Shift+Z` or `Ctrl+Y` (Claude's edits are in the same history) |
| Select several | `Shift`-click adds to the selection or takes from it. Battlemap, Select tool: drag a box on bare ground (a wall or light zone is taken only if the box covers all of it; `Shift` adds to what is selected). World map, Select tool: `Shift`-drag a box (places and labels only; a plain drag on bare ground still moves the view). Drag one of the selected to move them all together; `Delete` removes them all. Each is one undo step. On a world map Claude's `get_selection` still sees only the one you added last |
| Nudge | Arrow keys move what is selected (battlemap: a quarter square for objects, half a square for the rest, a whole square with `Shift`; world map: about 2 screen pixels, 20 with `Shift`). Quick presses add up to one undo step. With nothing selected the arrow keys move the view instead |
| Copy, paste, duplicate | `Ctrl+C`, `Ctrl+V` (lands under the pointer), `Ctrl+D` (a copy a little along and down). Battlemap: objects, lights, walls and light zones; room notes (they are numbered) and floors are not copied. World map: places (the copy is named "<name> (copy)") and labels. Each is one undo step |
| Save now | `Ctrl+S` (the map also saves itself a moment after every change; you get a "Saved" note when it is on disk) |
| Brush size | `[` and `]` (and the slider) |
| Grid on or off | `G` |
| Cancel, clear the selection | `Esc` |
| Finish a wall, line or outline | `Enter` or double-click; `Backspace` takes back the last point |
| Delete what is selected | `Delete` or `Backspace` |
| Turn or flip an object (battlemaps) | `Q` and `E` turn it 15°, `X` flips it; hold `Alt` while placing or moving to skip the quarter-square snap |

World-map tools: `H` Pan, `V` Select, `E` Select area, `R` Raise, `L` Lower, `S` Smooth, `F` Flatten, `A` Land, `W` Water, `P` Place, `T` Label, `O` Roads, `C` Climate, `D` Detail map, `M` Battlemap here. Battlemap tools: `H` Pan, `V` Select, `B` Brush, `A` Area, `R` Room, `W` Wall, `D` Door, `S` Secret door, `N` Window, `I` Invisible wall, `L` Light, `Z` Shade, `K` Note, `P` Object. A tool's tooltip shows its key.

## How this compares (checked 2026-11-18)

Where I could read a program's own documentation I did; where I couldn't, the source is named and may be out of date. Mouse buttons and keys are what each program documents as its default.

| | Dragon Drop | Foundry VTT | Dungeondraft | Dungeon Scrawl | Azgaar's generator | Wonderdraft |
|---|---|---|---|---|---|---|
| Pan | Space-drag, middle-drag, right-drag, `H` tool, arrows | right-drag; `Ctrl`+arrows | hold wheel or Space | Space, middle button, Pan tool; two-finger swipe on a Mac | arrow keys | middle button; Space + click |
| Zoom | wheel, `+` `-` | wheel; Page Up/Down; `Ctrl`+numpad `+` `-` | `Ctrl`+wheel | wheel; `+` `-`; pinch | `+` `-`; double-click; `0` resets | `Ctrl`+wheel (one source) |
| Fit the map | `0`, `Ctrl+0`, Fit button | `Tab` resets the view | | | `0` | `Ctrl+0` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+Y` | `Ctrl+Z` (no redo listed) | `Ctrl+Z` / `Ctrl+Y` | `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+Y` | `Ctrl+Z` / `Ctrl+Y` | `Ctrl+Z` |
| Brush size | `[` `]` | | wheel or `[` `]` | | `+` `-` `[` `]` | `[` `]` or wheel |
| Grid | `G` | | `G` | | `;` | |
| Save | `Ctrl+S` | n/a | | `Ctrl+S` | `Ctrl+S` | `Ctrl+S` |
| Delete | `Delete`, `Backspace` | `Delete` | `Delete`, `Backspace` | `Delete`, `Backspace` | `Delete` | |

Sources: [Foundry VTT's controls page](https://foundryvtt.com/article/controls) (official, read directly); the [Dungeondraft guide's shortcut page](https://dungeondraft-encyclopaedia.gitbook.io/guide/general-info/mouse-and-keyboard-shortcuts) (community, read directly); the [Fantasy Map Generator's hotkeys](https://github.com/Azgaar/Fantasy-Map-Generator/wiki/Hotkeys) (project wiki, read directly); Dungeon Scrawl's [help pages on Roll20](https://help.roll20.net/hc/en-us/articles/39314977484311-Navigating-Dungeon-Scrawl) (official, but the site refused to be read directly, so this is from search summaries); Wonderdraft's [community wiki](https://r.datuan.dev/r/wonderdraft/wiki/) (also from search summaries, and its two summaries disagreed about zoom). Inkarnate documents its tooltips and a shortcut bar in the editor but its [help pages](https://help.inkarnate.com/articles/6452044-editor-overview) don't list the pan and zoom bindings, so it is left out of the table.

### Where we match, and where we chose differently

- **Matches the others, wherever they have the feature:** undo and redo, `Delete`, `Esc`, `[` `]` for brush size, `G` for the grid, `Ctrl+S`, and panning with Space or the middle button.
- **The wheel zooms** (as in Foundry and Dungeon Scrawl). Dungeondraft and Wonderdraft use the wheel for brush size and `Ctrl`+wheel for zoom. We kept the wheel for zoom because moving around a big map is what you do most; `[` and `]` change brush size. `Ctrl`+wheel zooms here too, so that habit works.
- **Right-drag pans** (as in Foundry). We don't open a context menu on right-click.
- **Tool letters.** There is no standard across map programs. `H` (hand), `V` (select), `B` (brush) and `T` (text, for labels) are the same as in graphics programs; the rest are the first letter of the tool where it was free.

### Not built yet (suggestions, in the order I'd do them)

1. ~~Duplicate and copy/paste~~ *(done)*. There is no `Alt`-drag to duplicate: `Alt` already means "put it anywhere" when placing or moving an object.
2. ~~Select several things at once~~ *(done)*.
3. ~~Arrow keys nudging the selected thing~~ *(done)*: with nothing selected they still move the view.
4. `Page Up` and `Page Down` to change level, once battlemaps have levels (Dungeondraft uses them for that).
5. `Shift`-drag to skip snapping when moving objects, as Foundry does (we use `Alt` when placing objects).
