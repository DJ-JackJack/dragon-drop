# Dragon Drop: questions and answers

The common questions, with short answers. If yours isn't here, [ask it here](https://github.com/DJ-JackJack/dragon-drop/issues/new/choose); the same link is in **Settings → Help**. Please never paste your access key or an API key into a question.

## Installing

**Windows says "Windows protected your PC" when I run the installer.**
The installer isn't signed with a code-signing certificate yet, so Windows doesn't recognise it. Click **More info**, then **Run anyway**. Only do this for an installer you downloaded from Dragon Drop's own release page.

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

**Codex (or Muse Code) asks whether to trust a folder.**
Say yes. It is Dragon Drop's own workspace folder (Documents\Dragon Drop\Claude), and the assistant reads the map tools' settings from it only once it trusts it.

**The assistant asks me to Allow or Don't allow something.**
Some actions wait for your OK before they happen: replacing a map's land, moving the sea level, putting the whole map back from a checkpoint, carving every river, rewriting the brief, removing a named place, label, region, river or lake name, and removing many things at once. Answer in the box (in the window, or on the phone page). With no answer within two minutes, nothing is done.

**Claude Code in my own terminal lost the map tools, or Settings says its command changed.**
If you connected Claude Code yourself with the command in **Settings → AI assistant** (not through Dragon Drop's own terminal panel), run `claude mcp remove --scope user mapmaker` in PowerShell, then copy the command from Settings and run it. You need this after **Make a new access key** (the old key stops working). After updating to 0.1.13 the old connection still works, but it holds your full access key: the same two steps swap it for the map tools key, which opens the map tools and nothing else. The terminal panel inside Dragon Drop needs nothing: it is set up again each time it starts.

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

## Updates, the phone page and the rest

**How do I update?**
**Settings → Updates → Check now**, then **Restart to update**. A copy installed through itch.io is updated by the itch app instead.

**Can I see the map on my phone?**
Yes, through Tailscale (a free private network between your own devices). Enter your PC's Tailscale name in **Settings → Phone page**; the setup guide's section 7 has the steps. It is off until you do.

**Dragon Drop won't start, or shows an error.**
**Settings → Open logs** opens the log files: include the last lines when you ask for help. If another program uses port 4747, Dragon Drop picks another port by itself.

**What does Dragon Drop send over the internet?**
Nothing of its own: it has no analytics or tracking. Your maps stay on your PC. When you use an AI assistant, what it reads of your map goes to that assistant's company, from your own account. Update checks ask GitHub whether there is a new version (a copy from itch.io leaves that to the itch app). The [privacy policy](PRIVACY.md) has the details.

**Which asset packs can I use?**
Folders of pictures, .zip files and asset packs made for other map programs (see [FORMATS.md](FORMATS.md)). Dragon Drop reads them where they are and never copies them. Check each pack's licence before you publish maps made with it.
