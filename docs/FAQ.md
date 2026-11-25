# Dragon Drop: questions and answers

The common questions, with short answers. If yours isn't here, [ask it here](https://github.com/DJ-JackJack/dragon-drop/issues/new/choose); the same link is in **Settings → Help**. Please never paste your access key or an API key into a question.

## Installing

**Windows says "Windows protected your PC" when I run the installer.**
The installer isn't signed with a code-signing certificate yet, so Windows doesn't recognise it. Click **More info**, then **Run anyway**. Only do this for an installer you downloaded from Dragon Drop's own release page. To be sure it's the real one, compare its SHA-256 hash with the release's `SHA256SUMS.txt` (from 0.1.14): in PowerShell, `Get-FileHash .\Dragon-Drop-Setup-<version>.exe`.

**My antivirus flagged or removed a file.**
The unsigned installer, and the small terminal program Dragon Drop uses to run your AI assistant (`OpenConsole.exe`), are sometimes flagged by mistake. If you downloaded Dragon Drop from its own release page, restore the file from your antivirus's quarantine and mark it as allowed. If you aren't sure where your copy came from, download it again from the release page instead.

**Do I need administrator rights?**
No. Dragon Drop installs for your Windows user only, and so does Claude Code's installer.

**Which Windows, and what kind of PC?**
Windows 11 is what Dragon Drop is tried on. Windows 10 should work: the automatic checks also install and start it on an older Windows (Server 2022). But nobody has tried it on Windows 10 itself. There is no Mac or Linux version.

On a 4-core PC, a full-size world map (2048 × 2048) opens and is painted in about 12 seconds the first time; with only 2 cores it takes about 25 to 30 seconds. Dragon Drop itself uses about half a gigabyte of memory with a map that size open.

**My Documents folder is in OneDrive.**
That works. OneDrive sometimes holds a map's file while it uploads it; Dragon Drop then waits for it and saves a moment later. Big maps change often, so you may prefer a maps folder outside OneDrive: **Settings → Your maps → Change…**.

## The AI assistant

**What do I need for the AI part?**
One of these:
- **Claude Code**: Dragon Drop installs it for you (the **Set up Claude Code** button), and you sign in with your own Claude account. It needs a paid Claude plan (Pro, Max, Team or Enterprise) or an Anthropic Console account: the free plan doesn't include Claude Code.
- **Another assistant** (Codex, Gemini CLI, OpenCode, Muse Code): choose it in **Settings → AI assistant**. Settings says what each one needs and whether it is paid for separately. (Antigravity CLI isn't offered: Google's terms for it forbid using it with other companies' products, and Google has suspended accounts over that.)
- **The chat in the window**: it uses an API key from console.anthropic.com, which you enter in Settings. Using it costs API credit.

You can make maps without any AI too: every tool works by hand.

**"Claude Code not found" after installing it.**
Close Dragon Drop and open it again. To check the install, open a new PowerShell window and type `claude --version`. If that fails, run `claude doctor` and look up its message at code.claude.com/docs/en/troubleshoot-install.

**Claude's sign-in says my plan doesn't include Claude Code.**
The free claude.ai plan doesn't include it. Upgrade the plan, or use the chat in the window with an API key.

**The terminal says `'codex' is not recognized as an internal or external command`.**
Codex (or Gemini CLI, OpenCode...) isn't installed on this PC yet: Dragon Drop installs only Claude Code by itself. Install the assistant from its maker (for Codex, OpenAI's installer: see the setup guide, section 6b), then close and reopen Dragon Drop so its terminal finds it.

**Codex (or Muse Code) asks whether to trust a folder.**
Say yes. It is Dragon Drop's own workspace folder (Documents\Dragon Drop\Claude), and the assistant reads the map tools' settings from it only once it trusts it.

**The assistant asks me to Allow or Don't allow something.**
Some actions wait for your OK before they happen: replacing a map's land, moving the sea level, putting the whole map back from a checkpoint, carving every river, rewriting the brief, removing a named place, label, region, river or lake name, and removing many things at once. Answer in the box in the Dragon Drop window. With no answer within two minutes, nothing is done.

**Claude Code in my own terminal lost the map tools.**
If you connected Claude Code yourself with the command in **Settings → AI assistant** (not through Dragon Drop's own terminal panel), it stops working after **Make a new access key**. Run `claude mcp remove --scope user mapmaker` in PowerShell, then copy the command from Settings again and run it. The terminal panel inside Dragon Drop needs nothing: it is set up again each time it starts.

**Can I use a smaller or local model?**
Yes, with an assistant that can talk to one (OpenCode, for example), and **Settings → AI assistant → Map tools: A smaller set**. The assistant then sees about 40 map tools with short instructions, which fits a model with about 32,000 tokens of context or more. A model that can't read pictures can't look at the map; it works from the lists and summaries instead. [MODELS.md](MODELS.md) lists the models that have been tried and how they did.

**Does the AI invent names for my world?**
It shouldn't: its instructions say that names, history and lore are yours, and that it should propose names and wait for you. Larger models follow that better than smaller ones, and when you ask it to name something it may write the name straight away. Every change can be undone, and names it wrote can be renamed or removed.

## Maps and files

**Where are my maps?**
In **Documents\Dragon Drop\projects** unless you chose another folder. **Settings → Your maps** shows the folder and opens it. Each map is a folder of its own.

**How do I move a map to another PC, or back it up?**
Copy the map's folder (with Dragon Drop closed, to be safe). On the other PC, put it in Dragon Drop's maps folder. It appears in the list of maps.

**I changed something by mistake.**
**Undo** (Ctrl+Z) takes back your changes and the assistant's, one at a time. **Checkpoints** (Map panel → History) are saved copies of the whole map: Dragon Drop saves one automatically every 15 minutes while you work (it keeps the newest six), and you can save your own before a big change. **Open backups folder** there shows the copies kept when an update changed how maps are stored, and pictures you removed.

**I deleted a map.**
Deleted maps are moved, not erased: look in the **Deleted maps** folder inside your maps folder, and move the map's folder back out.

**A map won't open after an update.**
A map saved by a newer Dragon Drop can't be opened by an older one: update Dragon Drop. An older map is copied to its `backups` folder before it is changed to the new format, so nothing is lost.

### My map has too many rivers, or I want none

Rivers aren't drawn one by one: they come from the land and the rain, so they can't be deleted like a road. In the Map panel's **Climate**, slide **Rivers** toward few, tick **Dry land has few rivers** (an older map's deserts can look too wet without it; new maps have it on), or tick **No rivers from the rain** for none at all. A river from a river source, or one drawn with the Rivers tool, still flows, so a desert can keep its one great river. The AI assistant can do the same for you.

## Updates and the rest

**How do I update?**
**Settings → Help and updates → Check now**, then **Restart to update**. A copy installed through itch.io is updated by the itch app instead.

**Can the map look hand-drawn?**
Yes: choose **Ink** under Style in the Map panel. The coast is inked with ripple lines, and mountains, hills and woods are drawn as small symbols from the terrain.

**Can I make one name bigger or smaller?**
Yes. Select it with the Select tool: a label has a **Size**, and a place, a named river or lake, or a settlement's named street, building or district has a **Name size** (drag it, or **Usual size** to put it back). A realm's is its **Size** button in the realm list. **Label size** in the Map panel makes every name bigger or smaller at once, and the **Export** dialog starts at the same Label size, so the picture's names look as they do on screen.

**Can a settlement's ground look less flat, or use my own textures?**
Yes. In the Map panel's **Ground colours and textures** (under Land and climate), each kind of ground has **Look…**: a gradient between a lighter and a darker shade (in patches, from its edges, or with the height of the land), how strong and how big, and a **texture** from your asset packs, tiled as big as you set. Every kind already has a gentle gradient of its own; Undo takes back any change.

**My notes are in another program. Can a place open them?**
Yes: in the place's panel, **Your notes** takes a web address, an Obsidian or OneNote link, or a file or folder on your PC, and **Open** opens it in its own program.

**Can I colour in kingdoms and provinces?**
Yes: the world map's **Realm** tool (`B`) paints realms onto the land, each in its own colour with its name in the middle. They stop at the coast and meet their neighbours exactly.

**Can I show the map to my players on a TV?**
Yes: the battlemap's **Player screen** (in the Map panel) opens a second window for the TV, without anything GM only. With the fog on it shows only what you reveal with the **Reveal** tool: click a room and the players see it.

**Can it make a dungeon or a village for me?**
Yes, without Claude too: the Map panel's **Generate** box makes a dungeon or cave on a battlemap and a village on a settlement map, in one click, to edit as you like. The same seed makes the same map again.

**Can I reuse a room I already built?**
Yes. On a battlemap, the **Prefab** tool (`C`) saves a rectangle of it by name (floor, walls, doors, objects, lights) and places it again on any battlemap, turned or mirrored.

**Can I keep things secret from my players?**
Yes. Tick **GM only** on a place, label, road, object, light or a building's name: it shows faintly for you, and exports for players leave it out (you can still export your own copy with everything).

**Can I see the map on my phone?**
No. Dragon Drop only answers your own PC, so nothing on your network or the internet can reach your maps. You can still talk to Claude from your phone with Claude Code's Remote Control (the setup guide, section 6); the map itself changes in the Dragon Drop window on your PC.

**Dragon Drop won't start, or shows an error.**
**Settings → Open logs** opens the log files: include the last lines when you ask for help. If another program uses port 4747, Dragon Drop picks another port by itself.

**What does Dragon Drop send over the internet?**
Nothing of its own: it has no analytics or tracking. Your maps stay on your PC. When you use an AI assistant, what it reads of your map goes to that assistant's company, from your own account. Update checks ask GitHub whether there is a new version (a copy from itch.io leaves that to the itch app). The [privacy policy](PRIVACY.md) has the details.

**Which asset packs can I use?**
Folders of pictures, .zip files and asset packs made for other map programs (see [FORMATS.md](FORMATS.md)). Dragon Drop reads them where they are and never copies them. Check each pack's licence before you publish maps made with it.

**Do I need asset packs at all?**
No. Battlemaps have floors, walls, doors and lights of their own, and Dragon Drop comes with a small Starter Pack of ten floor textures (grass, dirt, sand, cobblestones, wooden planks and more) and twelve objects (a barrel, a crate, a table, a chair, a campfire, a tree, rocks and bushes). The floors are photographs from Poly Haven and the objects were drawn for Dragon Drop, all released as CC0: you may use them for anything, including maps you sell, with no credit needed. Asset packs add more.
