# The itch.io page, field by field

> **Draft, 2026-11-22**, for the person to change and approve. It follows itch.io's project edit page from top to bottom: each field, what
> to put in it, and the text to paste. Prices, the demo and the name are the person's call. Rules kept here: other programs are named only as
> "compatible with" (Foundry VTT, Universal VTT), no other map tool or its file formats are named, no "D&D" (say "tabletop RPGs"), and no AI
> company's name or logo is part of the product's name or pictures (naming the assistants it works with, in plain text, is fine). Facts about
> the form are from itch.io's creator docs (getting started, pricing, quality guidelines, design, access control), read 2026-11-22.

## Before the page: the account

- **Payments** (account settings, Payouts): **"Collected by itch.io, paid later"** is recommended. itch.io is then the seller of record, collects
  and pays VAT, handles chargebacks and makes the tax forms, after one tax interview. Details in `ITCH.md`, "Payments and taxes".
- **butler** installed and logged in (`ITCH.md`, One-time setup), to upload the program.

## The edit page ("Create new project", then Edit)

| Field | What to put |
|---|---|
| **Title** | Dragon Drop *(see `SELLING.md`, the name check: two other products already use this name)* |
| **Project URL** | `[your-itch-name].itch.io/dragon-drop` (made from the title; can be changed) |
| **Short description or tagline** | the line under "Short description" below |
| **Classification** | Tools |
| **Kind of project** | Downloadable |
| **Release status** | Released (or "In development" for early access, which needs a minimum price) |
| **Pricing** | Paid, minimum price **[the person's]**. Buyers may pay more. *Optional:* a free demo is a separate upload ticked "This file is a demo and can be downloaded for free"; there is no demo build yet. |
| **Uploads** | Pushed with butler to the `windows` channel (`ITCH.md`, Each release), with **Windows** ticked only. A project can only be bought once it has an upload. |
| **Description** | the text under "The description" below (itch's editor takes headings and lists) |
| **Genre** | Leave empty if nothing fits a tool |
| **Tags** (up to 10; prefer the ones itch suggests as you type, no synonyms) | worldbuilding, map-making, tabletop, ttrpg, fantasy, procedural-generation, level-editor, battlemap, game-master, windows *(check each against itch's suggestions)* |
| **AI generation disclosure** | see "The AI disclosure" below |
| **App store links** | none |
| **Custom noun** | map editor |
| **Community** | Discussion board, if itch.io's community is where buyers ask for help (`GOING-PRIVATE.md`); otherwise comments off and a link to the help place |
| **Visibility & access** | **Draft** while it is being made; **Restricted** (with a password) to let a few people try the page; **Public** at launch. |
| **Cover image** | 630 x 500 px (smallest 315 x 250, same shape): a crop of the painted world map with the name in the program's own lettering (Cinzel). Not made yet: it needs the final name. |
| **Screenshots** | 3 to 5, any size: see "Screenshots" below |
| **Trailer** | optional, a YouTube or Vimeo link |
| **Metadata → Release info** | the release date |
| **Metadata → External links** | the privacy policy, the licence agreement (EULA) and the help place, once they are published |

## The AI disclosure

itch.io's quality guidelines ask every page to say, in the AI Disclosure section of the edit page, whether it contains generative AI output,
and to describe it in the description too; disclosed pages are listed under "AI Assisted". They also say that **self-contained algorithms
(pathfinding, procedural generation) don't need a disclosure**: so the painted maps, which the program makes itself, don't count. A wrong
answer can be reported by buyers, so the honest one is the safe one. Dragon Drop was built with an AI coding assistant, so the honest answer
is **Yes**:

| Kind | Answer | Why |
|---|---|---|
| Code | **Yes** | Most of the program's code was written by an AI coding assistant (Claude Code), directed, tested and reviewed by the developer. |
| Text & dialog | **Yes** | The program's wording, help pages and guides were drafted with the same assistant. |
| Graphics | **Yes** (see the note) | The ~70 place markers (castle, temple, blacksmith...) are small vector drawings that the assistant wrote as code. The maps themselves are **not** generated images: the program paints them with its own algorithms from the terrain, climate and rivers (no image model, nothing downloaded). **[Check: who made the app icon?]** The store screenshots are of the program itself. |
| Sound | No | There is no sound. |

If the markers had been drawn by a person, Graphics could be No. As things are, ticking it and explaining on the page is the honest route.
The disclosure form's exact wording wasn't in the docs: answer it on the page itself and keep this table's reasons.

The page also has to say that **the program has an AI assistant feature** that buyers run with their own paid AI account: that isn't AI output
shipped in the project, but buyers must know before they pay (it is in "What you need").

## Short description

A Windows map editor for tabletop RPGs: world maps, cities and battlemaps you sculpt by hand or build together with an AI assistant.

## The description

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

### How it was made
Dragon Drop's code and wording were written with an AI coding assistant, directed, tested and reviewed by its developer. The maps are painted
by the program's own algorithms, not by an image generator.

### What you need
- Windows 10 or 11, 64-bit. Tried on Windows 11. A 2048 x 2048 world map takes about 12 s to open on a 4-core PC, and Dragon Drop uses about
  half a gigabyte of memory.
- **For the AI assistant: your own account with an AI company, paid separately** (for example a paid Claude plan, a ChatGPT plan, or an API
  key; Settings says what each one needs). Dragon Drop never resells AI use and never sees your sign-in. What the assistant reads of your map
  goes to that company under its terms: see the privacy policy.
- No Mac or Linux version.

## Screenshots

On generated maps, never the person's own campaign. A first set was made 2026-11-22 at 1920 x 1080, in the editor on a throwaway map
server, with made-up names (in `store-screenshots/` at the top of the checkout, which git ignores):

1. `1-world.png`: a generated continent in the painted style, with climate regions (a desert south, a wet east), places, roads, a named
   lake and labels.
2. `2-city.png`: a city made from a spot on that world map, zoomed in on a stone bridge, with streets lined with houses and district names.
3. `3-battlemap.png`: a tavern at night, lit by its lights (through the windows too), with the numbered room key in the Map panel.
4. *Still to take, in the installed program with a real assistant signed in:* the assistant panel beside the map, mid-task, with the Allow
   box showing.
5. `5-levels.png`: the tavern's upper floor, with the stairs and the ground floor showing faintly below.
