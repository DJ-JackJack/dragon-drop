# Controls: what Dragon Drop does and how it compares

Press **?** in the editor (or the **?** button in the top bar) for this list inside the program. The tool letters in the sheet come from the same list as the toolbar, so they can't drift.

## The screen

| Where | What |
|---|---|
| Left edge | The **tool rail**: every tool of the kind of map you have open, with its key. The tool letters come from one list per kind of map, so the rail, the keys and the `?` sheet agree. |
| Under the top bar | The **tool bar**: the settings of the tool in use, and a line saying what to do next with it. |
| Top bar | Map picker, **+ New map**, **Undo**, **Redo**, and the switches **Map panel** and **Claude**. Both panels are on by default and can be hidden; the choice is remembered. |
| Right | The **Map panel** (tabs **Map**, **History**, and **Assets** on battlemaps), then the **Claude** panel. |

When a panel is shown or hidden, a view that still shows the whole map is fitted again; any other view keeps the same point of the map in the middle.

## Settlement maps

A settlement map has its own tools (the sheet from `?` lists them): `H` Pan, `V` Select, `K` Ruler, `B` Building, `O` Outline, `S` Street, `W` Wall (click the first point to close a ring; double-click or `Enter` ends an open wall), `P` Paint ground, `L` Land (hills, ridges, valleys, plateaus, slopes), `T` Trees, `N` Name (click a street, building or wall to name it, open ground to write a label), `D` District (click the corners; the first corner, a double-click or `Enter` finishes), `M` Battlemap here (click a spot for 30 × 20 squares round it, as on the world map, or drag a box). The view keys (`0`, `+`, `-`, arrows, `Space`) are the same as everywhere. On a settlement map, with something selected, `Q` and `E` turn the buildings 15° (with the Building tool and nothing selected they set the angle of the next one), the arrow keys nudge the selection half a metre (`Shift`: 5 m; quick presses are one undo step), `Delete` removes it, dragging on bare ground with Select draws a box that selects, and `Shift`-click adds to the selection. `Ctrl+C` and `Ctrl+V` copy and paste the selection (it lands under the pointer; a copied building, street or wall has no name), and `Ctrl+D` duplicates it 5 m along and down, as on a battlemap.

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
| Copy, paste, duplicate | `Ctrl+C`, `Ctrl+V` (lands under the pointer), `Ctrl+D` (a copy a little along and down). Battlemap: objects, lights, walls and light zones; room notes (they are numbered) and floors are not copied. World map: places (the copy is named "<name> (copy)") and labels. Each is one undo step. If you copied a picture (in a browser or another program) after copying map things, `Ctrl+V` adds the picture to References instead: whichever you copied last is pasted |
| Show or hide the trace picture | `U` (the trace picture is a reference picture laid over the map with **Trace over map**; its bar under the map lines it up) |
| Save now | `Ctrl+S` (the map also saves itself a moment after every change; you get a "Saved" note when it is on disk) |
| Brush size | `[` and `]` (and the slider) |
| Grid on or off | `G` |
| Cancel, clear the selection (and stop comparing with another map) | `Esc` |
| Finish a wall, line or outline | `Enter` or double-click; `Backspace` takes back the last point |
| Delete what is selected | `Delete` or `Backspace` |
| Turn or flip an object (battlemaps) | `Q` and `E` turn it 15° (a prefab about to be placed: a quarter turn), `X` flips it; hold `Shift` or `Alt` while placing or moving to skip the snap (with `Shift`, once the drag has started: pressed at the click it adds to the selection) |

(On a battlemap the ruler, `M`, goes from the middle of one square to the middle of another; hold `Shift` to measure from the exact spot.)

World-map tools: `H` Pan, `V` Select, `E` Select area, `K` Ruler, `R` Raise, `L` Lower, `S` Smooth, `F` Flatten, `A` Land, `W` Water, `P` Place, `T` Label, `O` Roads, `I` Rivers, `B` Realm (kingdoms and provinces, painted with a brush), `N` Ground (paint a kind of ground over the climate's), `C` Climate, `D` Detail map, `M` Battlemap here, `Y` Settlement here. Battlemap tools: `H` Pan, `V` Select, `M` Ruler (`K` is taken by Note there), `B` Brush, `A` Area, `Y` Path (a road, track or stream; its letter is a fork in the road, as `P` is taken), `R` Room, `W` Wall, `D` Door, `S` Secret door, `N` Window, `I` Invisible wall, `L` Light, `Z` Shade, `K` Note, `P` Object, `C` Prefab (a saved room, building or camp: Place or Save), `F` Roof, `T` Stairs, `J` Ladder, `O` Hole, and Reveal (for the player screen; no key: every letter is taken on battlemaps). On the player screen itself, `G` shows or hides the grid and a double-click (or `F11`) is full screen. A tool's tooltip shows its key. The ruler works the same on every map: click points, double-click or `Enter` finishes, `Backspace` takes back the last point, `Esc` clears; other map programs measure with a ruler tool too, usually on a letter of its own.

## How this compares (checked 2026-11-18)

Where I could read a program's own documentation I did; where I couldn't, the source is named and may be out of date. Mouse buttons and keys are what each program documents as its default.

| | Dragon Drop | Foundry VTT | Dungeon Scrawl | Azgaar's generator |
|---|---|---|---|---|
| Pan | Space-drag, middle-drag, right-drag, `H` tool, arrows | right-drag; `Ctrl`+arrows | Space, middle button, Pan tool; two-finger swipe on a Mac | arrow keys |
| Zoom | wheel, `+` `-` | wheel; Page Up/Down; `Ctrl`+numpad `+` `-` | wheel; `+` `-`; pinch | `+` `-`; double-click; `0` resets |
| Fit the map | `0`, `Ctrl+0`, Fit button | `Tab` resets the view | | `0` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+Y` | `Ctrl+Z` (no redo listed) | `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+Y` | `Ctrl+Z` / `Ctrl+Y` |
| Brush size | `[` `]` | | | `+` `-` `[` `]` |
| Grid | `G` | | | `;` |
| Save | `Ctrl+S` | n/a | `Ctrl+S` | `Ctrl+S` |
| Delete | `Delete`, `Backspace` | `Delete` | `Delete`, `Backspace` | `Delete` |

Sources: [Foundry VTT's controls page](https://foundryvtt.com/article/controls) (official, read directly); the [Fantasy Map Generator's hotkeys](https://github.com/Azgaar/Fantasy-Map-Generator/wiki/Hotkeys) (project wiki, read directly); Dungeon Scrawl's [help pages on Roll20](https://help.roll20.net/hc/en-us/articles/39314977484311-Navigating-Dungeon-Scrawl) (official, but the site refused to be read directly, so this is from search summaries). Inkarnate documents its tooltips and a shortcut bar in the editor but its [help pages](https://help.inkarnate.com/articles/6452044-editor-overview) don't list the pan and zoom bindings, so it is left out of the table.

### Where we match, and where we chose differently

- **Matches the others, wherever they have the feature:** undo and redo, `Delete`, `Esc`, `[` `]` for brush size, `G` for the grid, `Ctrl+S`, and panning with Space or the middle button.
- **The wheel zooms** (as in Foundry and Dungeon Scrawl). Some other map editors use the wheel for brush size and `Ctrl`+wheel for zoom. We kept the wheel for zoom because moving around a big map is what you do most; `[` and `]` change brush size. `Ctrl`+wheel zooms here too, so that habit works.
- **Right-drag pans** (as in Foundry). We don't open a context menu on right-click.
- **Tool letters.** There is no standard across map programs. `H` (hand), `V` (select), `B` (brush) and `T` (text, for labels) are the same as in graphics programs; the rest are the first letter of the tool where it was free.

### Added after the first comparison

The first version of this page listed five things the other programs have and we didn't. All five are done: copy, paste and duplicate; selecting several things at once; arrow keys that nudge the selection; `Shift` to skip snapping while dragging; and `Page Up` / `Page Down` to change level (a battlemap can hold several levels: see [FOUNDRY.md](FOUNDRY.md), stage 2). (There is no `Alt`-drag to duplicate: `Alt` already means "put it anywhere".)
