# Research Notes: AI-Assisted Mapmaker

*Compiled 2026-11-15. These are the findings the build plan ([PLAN.md](PLAN.md)) depends on. Items marked **(verify)** came from third-party sources or general knowledge and should be confirmed before we build on them.*

---

## 1. What Claude can and can't do here

| Capability | Status | What it means for the design |
|---|---|---|
| **See images** (reference uploads, rendered previews) | Yes. Recent models read images up to **2576 px on the long edge** (about 4,800 image tokens at most), and the coordinates Claude reports map 1:1 to image pixels. | Claude can read a reference, point to locations on it, and check renders of its own work. Previews should stay at or under 2576 px. |
| **Generate images itself** | **No.** Claude outputs text and tool calls, not pixels. | The program must do all the drawing. Claude acts as the planner and the hands, working through a structured tool API. An image-generation model can be added later as an optional plug-in. |
| **Call tools / MCP servers** | Yes, both in Claude Desktop and Claude Code (MCP) and through the API (tool use). | The core product is a map engine with a semantic tool API that Claude drives. |
| **Check its own work visually** | Yes, when a tool returns an image. Anthropic's guidance for current models is that giving the model tools to crop and visually verify its work is a more effective lever than more thinking. | Build `render_preview`, `view_reference(crop)` and side-by-side comparison tools from day one. |
| **Forward an image uploaded in chat to an MCP tool** | **No.** An uploaded image is tokenized for the model. The raw file never reaches the MCP server. [(1)](https://llmastery-co-uk.pages.dev/posts/2025/01/mcp-files-resources-part1) [(2)](https://claudeissues.com/issue/62875-feature-expose-image-path-data-to-mcp-tools-when-backend-model-doesnt-support-im) | Any pixel-level work on a reference (tracing a coastline, extracting colour regions) needs the file inside the app. So the app gets a **Reference Tray** where you drop images, and Claude reads them through tools. In Claude Code, Claude can also read image files on disk directly. |
| **Images returned *by* tools** | Claude sees them. Reported quirks **(verify)**: Claude Desktop caps tool results at around 1 MB, images may not render inline for the user, and some clients show the image to the model only on the next pass. [(3)](https://claudeissues.com/issue/77338-bug-mcp-tool-result-images-are-not-visible-to-the-model-on-the-same-turn-as-the) | Previews are compressed (WebP/JPEG) and kept under about 1 MB. The live map always shows in the app window, so the user never depends on inline chat images. |

### Ways to have the conversation

1. **Local MCP server + Claude Desktop.** Claude Desktop runs local MCP servers, and they install in one click as `.mcpb` Desktop Extensions (a zip with a manifest, built with the `mcpb` CLI). [(4)](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop) [(5)](https://claude.com/docs/connectors/building/mcpb) This uses your existing Claude plan, with no API bill.
2. **Claude Code.** Supports MCP over stdio and HTTP and can read image files directly. Good for power use and development.
3. **claude.ai web or mobile.** Supports only *remote* custom connectors, and Claude connects to them **from Anthropic's cloud, not from your device**. [(6)](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp.md) A server on your own machine needs a public tunnel or cloud hosting before claude.ai can reach it.
4. **Chat panel built into the app (Claude API).** Best UX: one window, and images go straight into the chat. Costs are per token and need an API key. Current list prices per million tokens (input/output): Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50. A rough estimate for a 40-turn editing session with previews is **$1–5 on Opus 5.5** and about half that on Sonnet 5.5, assuming prompt caching. (Back-of-envelope, not measured.)
5. **MCP Apps (interactive UI inside the chat).** This became the first official MCP extension in January 2026. A server can return an HTML UI (`ui://` resource) that Claude Desktop and claude.ai render inline. [(7)](https://thenewstack.io/anthropic-extends-mcp-with-an-app-framework/) [(8)](https://alpic.ai/blog/mcp-apps-goes-official-claude-chatgpt-support) There is a May 2026 report of UIs not rendering. [(9)](https://github.com/modelcontextprotocol/ext-apps/issues/671) It's a nice extra (a live map viewer inside the chat) but not something to depend on at first.

**Conclusion:** build the tool layer so it doesn't care which transport carries it. Ship option 1 (Desktop and Code over MCP) first, because it costs nothing extra to run. Options 4 and 5 then become thin adapters over the same tools.

---

## 2. Existing tools: what to learn and what to avoid

| Tool | Type | Takeaway |
|---|---|---|
| **Azgaar's Fantasy Map Generator** | Open source (MIT per current wiki **(verify)**), client-side JS, D3/SVG, Voronoi cells (about 10k), template-based heightmaps, rivers, biomes, cultures, states. [(10)](https://git.korz.dev/backups/Fantasy-Map-Generator/src/commit/05c53d276aaa1153f8d61c6ab515f79fccd6744f/wiki/Architecture.md) | Proven pipeline for world maps (heightmap → climate → rivers → biomes). Voronoi cells are coarse to sculpt by hand, so we'll use a raster heightmap. Its algorithms are a good reference, and importing Azgaar `.map` files is a cheap optional feature. |
| **Wonderdraft / Inkarnate** | Manual world-map painters. | The look people expect: parchment, ink coastlines with ripple lines, stamped mountain and forest symbols, curved labels. These are *render styles* over terrain data. |
| **Dungeondraft** | Manual battlemap editor ($29.99). Exports Universal VTT. | The battlemap baseline: material painting, wall tool with auto shadows, asset stamping, lights, UVTT export. Its asset packs (`.dungeondraft_pack`) are Godot PCK-based. Generic extractors exist, but the format may be customised **(verify)**. |
| **Dungeon Alchemist** | AI-assisted 3D room layouts, exports top-down maps and Foundry data. [(11)](https://char-gen.com/blogs/best-ai-battlemap-generators-dnd-2026) | Proves that "describe it → furnished, walled, lit map" is wanted. Its weakness is limited control, which conversation plus direct editing addresses. |
| **Text-to-image map generators** | Pretty images. | No real grid, walls or editability, and inconsistent results. Our structured approach avoids these problems. |
| **Foundry VTT MCP** (adambdooley) | MCP bridge into Foundry. Its battlemap generation runs through ComfyUI. [(12)](https://glama.ai/mcp/servers/Gnuminator/Foundry-VTT-MCP) | Precedent for AI-image battlemaps. Shows the optional "AI paint" path needs a local GPU stack. |
| **Watabou generators** (One Page Dungeon, city generator) | Procedural layouts. | Good references for procedural dungeons and settlements. |

The gap no one fills: **an editable, structured map where you can talk to Claude about it, both with reference images and by hand**, exporting real VTT walls and lights.

---

## 3. VTT export targets

- **Universal VTT** (`.uvtt` / `.dd2vtt` / `.df2vtt`, all the same JSON format). [(13)](https://arkenforge.com/universal-vtt-files/) [(14)](https://help.roll20.net/hc/en-us/articles/41643201127831-Universal-Virtual-Tabletop-UVTT-Support) Fields:
  - `format`
  - `resolution {map_origin, map_size (grid squares), pixels_per_grid}`
  - `line_of_sight` (wall polylines)
  - `objects_line_of_sight`
  - `portals [{position, bounds, rotation (radians), closed, freestanding}]`
  - `environment {baked_lighting, ambient_light}`
  - `lights [{position, range, intensity, color, shadows}]`
  - `image` (base64 PNG/WebP)

  All positions are in **grid units**. Roll20 imports it natively. Foundry imports it through the community **Universal Battlemap Importer** module. Wall handling is consistent across tools; lights less so.
- **Foundry VTT native scene JSON.** Walls in pixel coordinates (`c: [x0,y0,x1,y1]` plus door and sense flags), ambient lights and grid settings, imported with a scene's "Import Data". **Foundry v14 added Scene Levels** (walls and lights can belong to specific floors) and needs a fresh install rather than an in-place update. [(15)](https://foundryvtt.com/releases/14.359) [(16)](https://foundryvtt.com/api/v14/interfaces/foundry.documents.types.SceneData.html) We should target the Foundry version you actually run.
- Because our walls are vector objects from the start, export is exact. There's no need to detect walls from the image.

---

## 4. Assets and licensing

| Source | License | Use |
|---|---|---|
| **Kenney** (e.g. *Scribble Dungeons*) | CC0, commercial OK. [(17)](https://kenney-assets.itch.io/scribble-dungeons) | Bundled starter props |
| **Screaming Brain Studios** *Top Down Dungeon Pack* (2,256 tiles) | CC0. [(18)](https://screamingbrainstudios.itch.io/top-down-dungeon-pack) | Bundled starter tiles |
| **ambientCG, Poly Haven** | CC0 texture libraries **(verify)** | Ground and floor materials (grass, dirt, stone, wood) |
| **game-icons.net** | CC BY 3.0 (attribution) **(verify)** | World-map symbols (towns, castles, ports) |
| **Forgotten Adventures** | Proprietary. Fine for personal use and free fan content *with credit*. **Any paid use needs an approved commercial license.** FA *Battlemaps* content is personal use only. [(19)](https://forgotten-adventures.net/info) [(20)](https://new.forgotten-adventures.net/?p=3735) | **Never bundled.** The app imports *your own* downloaded asset folders for personal use. |
| **2-Minute Tabletop, Tom Cartos, etc.** | Each has its own license **(verify)** | Same: import your own copies |

**Design consequences:**
1. Ship a small CC0 starter pack plus **procedural materials** (shader-generated grass, stone, water), so the app looks decent with no downloads.
2. Build a strong **"import asset folder"** feature: auto-detect footprint, tag from folder names, and let Claude tag assets visually from contact sheets.
3. Track the license of every asset so the app can warn when an export uses non-commercial assets.

**Dungeondraft packs (added in draft 2):** a `.dungeondraft_pack` is a Godot PCK archive (`GDPC` magic, header, then a file table of path, offset, size and MD5, then data). [(24)](https://gist.github.com/AzureDVBB/3df6de89a0d290d75dfbcd06f46210fc) Art is PNG under `textures/` (e.g. `textures/objects/…`). Tags live in `data/default.dungeondraft_tags`. Assets are authored at **256 px per grid square**, though some packs ship at 300. [(25)](https://github-wiki-see.page/m/Megasploot/Dungeondraft/wiki/Custom-Assets-Guide) [(26)](https://dungeondraft-unofficial-manual.gitbook.io/manual/custom-assets-and-mods/importing-assets/packing-your-assets)

---

## 5. Algorithms and rendering tech

- **Terrain generation:** layered simplex/fBm noise with domain warping. Template "brushes" (continent, archipelago, ridge) like Azgaar's. **Hydraulic erosion:** droplet-based, or the Mei et al. 2007 GPU grid method. Open WebGL2 implementations exist, for example MIT-licensed `ctkrug/erosion`. [(21)](https://github.com/ctkrug/erosion) [(22)](https://github.com/LanLou123/Webgl-Erosion)
- **Rivers:** pit-fill (priority-flood), then D8 flow direction and flow accumulation, then threshold into river polylines. Rivers always flow downhill and merge but never split, which is physically right by construction.
- **Biomes:** temperature (latitude plus elevation lapse) and moisture (distance to water plus prevailing-wind rain shadow), mapped through a Whittaker-style lookup. Paintable overrides.
- **Coastlines and contours:** marching squares on the heightmap, Chaikin smoothing, optional fractal detail for an ink style.
- **Battlemap layout:** BSP or room-graph dungeons, cellular-automata caves, Poisson-disk scatter (trees, rocks, debris), A* roads and paths over a cost map, Wave Function Collapse for tile-like interiors (optional).
- **Polygon operations:** Clipper2 (union, difference, offset) for rooms, walls and regions.
- **Rendering:** **PixiJS v8** (WebGL2 with WebGPU option). It has a 2D camera for large worlds, sprites, meshes, render textures and custom shaders. WebGPU isn't automatically faster, since Pixi is often CPU-bound. [(23)](https://pixijs.com/blog/pixi-v8-launches) Material blending is a custom splat-map shader with height-based blending and noisy edges. Vector layers (coasts, rivers, roads, walls) are tessellated to meshes. Exports at 8k–16k px are rendered **in tiles** to stay under the GPU's maximum texture size.

---

## 6. Update 2026-11-16: what the other tools teach us

*A second look at the tools, after the editor, battlemaps and Dungeondraft packs were built. Most sources are product pages, changelogs, feature-request boards and review roundups, so treat the details as indicative, not exact. I found nothing on a "Wonderdraft 2" or "Dungeondraft 2".*

**What each tool does that we don't (yet)**

| Tool | What stands out | Idea for us |
|---|---|---|
| **Dungeon Alchemist** | Pick a room's theme and it furnishes and lights it; a Randomize button for a new layout; real-time lighting preview; exports walls, doors and lights to Foundry ([reviews](https://gamingnexus.com/Article/11852/Dungeon-Alchemist)). Its own users ask for: a **separate indoor/ambient light** (indoor light follows the sun and windows do nothing, [request](https://dungeonalchemist.featurebase.app/p/separate-ambient-indoor-lighting-lighting-overhaul)), **saved time-of-day lighting presets** ([request](https://dungeonalchemist.featurebase.app/p/outdoor-lighting-period-templates-presets)), **linked maps** from building to city to world ([request](https://dungeonalchemist.featurebase.app/p/feature-request-linked-maps-for-city-and-world-building)) and **text to map** ([request](https://dungeonalchemist.featurebase.app/p/ai-text-to-map-generation)). Complaints: windows export as invisible walls, slow large maps, curved rooms were hard ([Foundry users](https://redlib.ssps.io/r/FoundryVTT/comments/1g5fo8f/what_are_peoples_thoughts_on_using_dungeon)). | Light presets (dawn, day, dusk, night, torchlit) and per-area ambient (indoors dim, outdoors bright). Our windows already export as real windows. World to region to battlemap links already exist; extend to city and building. Conversation is our "text to map". |
| **Inkarnate 2.0** (Dec 2025) | **Scene Stamps** (turn a scene into a reusable asset), custom layers with masks and blend modes, transparent PNG export, autosave and snapshots, copy and paste between scenes, any stamp usable as a brush tip ([changelog](https://feedback.inkarnate.com/changelog/inkarnate-20-star)). | **Prefabs**: save a room, building or camp (floor, walls, objects, lights) and place it again, which Claude can do by name. We already have checkpoints (snapshots) and autosave. |
| **Foundry VTT v14** | **Scene Levels**: one scene with several floors at set elevations; walls and lights can belong to one level, several or all; vision works across levels; shared fog exploration ([release notes](https://foundryvtt.com/releases/14.359)). A community importer already builds Dungeon Alchemist exports into levels. | **Multi-floor battlemaps** (a tower, a dungeon with stairs), exported as Foundry levels. Biggest feature on this list. |
| **Dungeondraft** | Smart tiling, smart scatter, built-in lighting, built-in dungeon and cave generator, object tags, a **printer-friendly export filter**, a modding API ([site](https://www.dungeondraft.net/)). Popular mods fill its gaps: manage layers, **move walls like paths**, **drop shadows under objects**, **recolour objects without a new asset**, search across walls and patterns, bulk select, multi-file export ([mods list](https://dndungeon.com/blogs/faq/best-dungeondraft-mods-2026)). | Drop shadows and tinting for objects (matters once real packs load), an ink-saving print export, editing wall points by dragging, a layers list. |
| **Wonderdraft** | Brushed land with auto-beautified coasts, rivers and roads from a few clicks, symbols painted in groups, label presets, 512 to 8192 px maps ([site](http://wonderdraft.net/)). | The hand-drawn symbol look (hills, trees, mountains as icons) as an alternative to Painted Relief. |
| **Azgaar's Fantasy Map Generator** | Wiki topics include heightmap editor and image overlay, river and coastline editors, **Journeys**, **Scale and distance**, Markers, **GIS data export**, an Omnibar (search) and an **Ollama text generation** hook ([wiki](https://github.com/Azgaar/Fantasy-Map-Generator/wiki)). | **Travel time between places** (walking days across terrain), a search and jump palette, heightmap export for other tools. |
| **Watabou One Page Dungeon** | Seeds and tags in the URL, "partly symmetrical" layouts that look human-made, **numbered notes with a key**, SVG and PNG export ([page](https://watabou.itch.io/one-page-dungeon)). | **Room labels and a numbered key** on battlemaps (we only have them on world maps), seeds for generated layouts. |
| **Foundry MCP servers** | Several let an AI create scenes, walls, doors and lights inside a running Foundry; map images come from a local ComfyUI ([examples](https://glama.ai/mcp/servers/Gnuminator/Foundry-VTT-MCP)); "Mimir Mapgen" writes Dungeondraft map files from a scene description ([listing](https://mcpmarket.com/tools/skills/mimir-mapgen)). | I found none that produces an editable battlemap with walls and lights for a non-Foundry tool. That is still our gap. Importing `.dungeondraft_map` files would let Claude work on maps people already have. |

**Ranked ideas** (value to a DM, then effort)

1. Room labels, numbered key and notes on battlemaps (small).
2. Light presets and per-area ambient: time of day, indoors versus outdoors (small to medium; builds on the light level).
3. Travel time and distance between places on world maps (small to medium; needs the map's scale settled).
4. Prefabs: save and place a room or building by name (medium).
5. Multi-floor battlemaps with Foundry levels export (large).
6. Object drop shadows and tinting; drag to edit wall points; layers list (medium; after real packs are tested).
7. Printer-friendly (ink-saving) export (small to medium).
8. Hand-drawn symbol style for world maps (large, art-heavy).
9. Import Dungeondraft maps and Azgaar `.map` files (medium).
10. Seeded dungeon generator with tags (medium; Claude can already compose layouts, so lower).

## Sources

1. [Files and Resources with MCP – Part 1](https://llmastery-co-uk.pages.dev/posts/2025/01/mcp-files-resources-part1)
2. [Feature request: expose image path/data to MCP tools](https://claudeissues.com/issue/62875-feature-expose-image-path-data-to-mcp-tools-when-backend-model-doesnt-support-im)
3. [Bug: MCP tool-result images not visible on same turn](https://claudeissues.com/issue/77338-bug-mcp-tool-result-images-are-not-visible-to-the-model-on-the-same-turn-as-the)
4. [Getting started with local MCP servers on Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
5. [MCPB (Desktop Extensions) docs](https://claude.com/docs/connectors/building/mcpb)
6. [Custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp.md)
7. [The New Stack – Anthropic extends MCP with an app framework](https://thenewstack.io/anthropic-extends-mcp-with-an-app-framework/)
8. [Alpic – MCP Apps goes official](https://alpic.ai/blog/mcp-apps-goes-official-claude-chatgpt-support)
9. [ext-apps issue #671 – UI not rendering](https://github.com/modelcontextprotocol/ext-apps/issues/671)
10. [Azgaar FMG architecture (mirror)](https://git.korz.dev/backups/Fantasy-Map-Generator/src/commit/05c53d276aaa1153f8d61c6ab515f79fccd6744f/wiki/Architecture.md)
11. [CharGen – Best AI battlemap generators 2026](https://char-gen.com/blogs/best-ai-battlemap-generators-dnd-2026) (vendor blog, biased)
12. [Foundry VTT MCP](https://glama.ai/mcp/servers/Gnuminator/Foundry-VTT-MCP)
13. [Arkenforge – Universal VTT files](https://arkenforge.com/universal-vtt-files/)
14. [Roll20 – UVTT support](https://help.roll20.net/hc/en-us/articles/41643201127831-Universal-Virtual-Tabletop-UVTT-Support)
15. [Foundry VTT v14 release notes](https://foundryvtt.com/releases/14.359)
16. [Foundry v14 SceneData API](https://foundryvtt.com/api/v14/interfaces/foundry.documents.types.SceneData.html)
17. [Kenney – Scribble Dungeons](https://kenney-assets.itch.io/scribble-dungeons)
18. [Screaming Brain Studios – Top Down Dungeon Pack](https://screamingbrainstudios.itch.io/top-down-dungeon-pack)
19. [Forgotten Adventures – license info](https://forgotten-adventures.net/info)
20. [Forgotten Adventures – commercial licensing](https://new.forgotten-adventures.net/?p=3735)
21. [ctkrug/erosion (WebGL2 hydraulic erosion)](https://github.com/ctkrug/erosion)
22. [LanLou123/Webgl-Erosion](https://github.com/LanLou123/Webgl-Erosion)
23. [PixiJS v8 launch post](https://pixijs.com/blog/pixi-v8-launches)
24. [Dungeondraft pack unpacker (Python gist)](https://gist.github.com/AzureDVBB/3df6de89a0d290d75dfbcd06f46210fc)
25. [Dungeondraft Custom Assets Guide (Megasploot wiki)](https://github-wiki-see.page/m/Megasploot/Dungeondraft/wiki/Custom-Assets-Guide)
26. [Dungeondraft unofficial manual – packing assets](https://dungeondraft-unofficial-manual.gitbook.io/manual/custom-assets-and-mods/importing-assets/packing-your-assets)
