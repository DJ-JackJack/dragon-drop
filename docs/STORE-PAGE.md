# The itch.io page: draft text and the AI disclosure

> **Draft, 2026-11-22.** Text for the store page and honest answers to itch.io's AI disclosure, for the person to change and approve. Prices,
> the demo and the screenshots are the person's call. Rules kept here: other programs are named only as "compatible with" (Foundry VTT,
> Universal VTT), no other map tool or its file formats are named, no "D&D" (say "tabletop RPGs"), and no AI company's name or logo is part of the
> product's name or pictures (naming the assistants it works with, in plain text, is fine).

## The AI disclosure (itch.io's project settings)

itch.io asks every project whether it **contains generative AI output**, and if so in which kinds: Graphics, Sound, Text & dialog, Code.
Answering Yes tags the page "AI-Generated", with a tag for each kind; No tags it "No AI". itch.io's quality guidelines also ask that a project
involving AI says so plainly in its description. A wrong answer can be reported by buyers, so the honest one is the safe one.

Dragon Drop was built with an AI coding assistant, so the honest answer is **Yes**:

| Kind | Answer | Why |
|---|---|---|
| Code | **Yes** | Most of the program's code was written by an AI coding assistant (Claude Code), directed, tested and reviewed by the developer. |
| Text & dialog | **Yes** | The program's wording, help pages and guides were drafted with the same assistant. |
| Graphics | **Yes** (see the note) | The ~70 place markers (castle, temple, blacksmith...) are small vector drawings that the assistant wrote as code. The maps themselves are **not** generated images: they are painted by the program's own algorithms from the terrain, climate and rivers (no image model is involved, and nothing is downloaded). [Check: who made the app icon and the pictures used on the store page?] |
| Sound | No | There is no sound. |

If the markers had been drawn by a person, Graphics could be No. As things are, ticking it and explaining on the page is the honest route.

The page also needs to say that **the program has an AI assistant feature** that buyers run with their own AI account: that isn't
"generative AI output" shipped in the project, but buyers should know before they pay (see "What you need" below).

## Short description (one line, shown under the title)

A Windows map editor for tabletop RPGs: world maps, cities and battlemaps you sculpt by hand or build together with an AI assistant.

## The page

**Dragon Drop** is a map editor for game masters. Sculpt a continent, let the rivers find their own way down from the mountains, zoom in to a
city with streets that follow the hills, and drop down to a battlemap of a single tavern, all linked to each other. Do it by hand, or with an
AI assistant working on the same map beside you.

### World maps
- Terrain you sculpt or generate: landmasses, mountain ranges, erosion that weathers new peaks.
- Rivers and lakes worked out from the land and the rainfall, never drawn as lines: start a great spring or draw the course you want, and the
  water follows it. Name rivers and lakes and their labels follow the water.
- A climate you set by region gives the ground its look: tundra, steppe, savanna, marsh, rainforest, glaciers, volcanic ash and lava flows, and
  more, painted in a hand-drawn relief style.
- Around 70 kinds of place markers (castles, temples, ports, lighthouses and 30 shops and trades), curved labels, roads and borders.

### Cities
- Streets that route themselves along the land, houses that face them, walls with gates and towers, bridges where streets cross water,
  districts, parks and woods.
- Trace a found map: lay a picture under the city and read its buildings, streets and water off it.

### Battlemaps
- Rooms, stone walls with soft shadows, doors, windows, secret doors, lights with line-of-sight shadows, and a light level from bright to dark.
- Several levels, linked by stairs, ladders and holes, and roofs that hide what is under them.
- Your own asset packs (folders of pictures, zip files and asset packs), read where they are and never copied.
- Export a picture, a Universal VTT file, or a scene **compatible with Foundry VTT** (version 14, with its levels, stairs and roofs).

### Maps that know about each other
Make a city from a spot on your world map, and a battlemap from a spot in the city: each knows where it came from, and you can compare any two.

### An AI assistant, if you want one
Dragon Drop works with the AI coding assistants many people already pay for: **Claude Code, Codex, Gemini CLI, OpenCode and Muse Code**
run in a panel beside the map, with Dragon Drop's map tools connected. Ask it to raise a mountain range along a sketch, find a site for a port
town, or lay out a village's streets, and watch it work. It sees what you select, and it asks before anything big (replacing the land,
removing named places). **Your world stays yours**: it is told never to invent names or lore, and to suggest instead.
Everything also works by hand, without any AI.

### Also
- Shared undo, automatic saves and checkpoints, and backups before anything risky.
- A phone page that follows the map live, through your own private network (Tailscale), for checking the map from the table.

## What you need
- Windows 10 or 11, 64-bit. Tried on Windows 11. A 2048 x 2048 world map takes about 12 s to open on a 4-core PC, and Dragon Drop uses about
  half a gigabyte of memory.
- **For the AI assistant: your own account with an AI company, paid separately** (for example a paid Claude plan, a ChatGPT plan, or an API
  key; Settings says what each one needs). Dragon Drop never resells AI use and never sees your sign-in. What the assistant reads of your map
  goes to that company under its terms: see the privacy policy.
- No Mac or Linux version.

## What the page should link to
- The privacy policy (`docs/PRIVACY.md`, once published somewhere buyers can reach it).
- Where to ask for help (decided as part of going private: see `docs/GOING-PRIVATE.md`).
- The licence or EULA (not written yet: `docs/SELLING.md`, Legal and business).

## Screenshots to take (on a generated map, never the person's own campaign)
1. A world map in the painted style, with rivers, places and labels.
2. A city with walls, a river and a bridge.
3. A battlemap at dusk with lights and the room key.
4. The assistant panel beside the map, mid-task, with the Allow box showing.
5. Levels: a battlemap with the level below showing faintly.
