# Security review of the desktop side (Claude's own, 2026-11-22)

> A first review by Claude, the AI that wrote most of the code, of the parts `SELLING.md` asks a security reviewer to look at: the window
> and its bridge to the page, the terminal, the updater, the installer of Claude Code, and how they meet the local server. **It doesn't
> replace a review by a person who does security reviews**: it is where that person can start. Read: `apps/desktop/main.cjs`,
> `preload.cjs`, `assistants.cjs`, `package.json`, `apps/server/src/http.ts` (headers, access key, what is served), the editor's source
> for raw HTML, and the built program's Electron fuses.

## Fixed in this review

**The program's built-in switches (Electron "fuses") were all at their defaults.** Two of them let anyone who can start a program on the PC
run their own code *inside* Dragon Drop: the `NODE_OPTIONS` environment variable (`--require some-script.js`) and debugger arguments
(`--inspect`). Once the program is signed, that would let other code run under Dragon Drop's signature, which antivirus programs trust
more. Now (`apps/desktop/package.json`, `build.electronFuses`):

| Fuse | Now | Why |
|---|---|---|
| `EnableNodeOptionsEnvironmentVariable` | off | `NODE_OPTIONS` can't load code into the program |
| `EnableNodeCliInspectArguments` | off | no debugger can be attached through `--inspect` |
| `EnableEmbeddedAsarIntegrityValidation` | on | the program checks its `app.asar` against a hash written into `Dragon Drop.exe` at build time, so a changed archive doesn't load |
| `OnlyLoadAppFromAsar` | on | the program loads only its archive, never a loose folder put beside it |
| `GrantFileProtocolExtraPrivileges` | off | the window never uses `file://` pages |
| `RunAsNode` | off (since 2026-11-22) | `Dragon Drop.exe` can't be used as a plain Node.js: the map server is an Electron utility process (see R2) |

Tried 2026-11-22 on a locally built copy (`npm run dist:dir`): its start-up check passes (sandbox, server, access key, terminal, the
Claude Code check), and with `NODE_OPTIONS` set to load a missing file it still starts (the variable is ignored). The build checks the fuses
every time (`apps/desktop/scripts/check-fuses.mjs`, in the workflow's "List what was built" step).

## Checked and sound

- **The window**: sandboxed, context isolation on, no Node in the page; it can't leave `http://localhost:<port>/` (other links open in the
  browser, and only `http(s)` ones); pop-ups are refused; every permission request (camera, microphone, location, notifications...) is refused
  but clipboard writing and full screen.
- **The bridge** (`preload.cjs` → `ipcMain`): every handler checks that the call comes from the editor's own address (`fromEditor`), and the
  inputs are checked: a map id against a pattern before opening its backups folder, the API
  key's length, the start command's length and control characters. Folders are chosen in Windows' own dialog, never from the page.
- **The page can't run foreign code**: the editor sets no raw HTML anywhere (no `dangerouslySetInnerHTML`, `innerHTML`, `document.write`), map
  text is shown through React, which escapes it; the Content-Security-Policy allows only the program's own scripts (no inline script) and
  connections only back to its own server; every response is `nosniff` and `no-referrer`. A map's reference pictures and previews are served
  only as PNG, JPEG or WebP (`sendPicture` in `http.ts`; anything else in those folders is not found), with a policy that forbids everything and
  a sandbox; asset pictures likewise. *(Until 2026-11-22 an `.html` or `.svg` file in a map's `refs` folder was sent as a page, with no policy:
  found in the adversarial review.)* The bridge also refuses any page under `/api/` (`fromEditor`).
- **The server**: on 127.0.0.1 only, Host and Origin checked first, then the access key on every `/api`, `/mcp` and `/ws` request (compared in
  constant time); the window's cookie is HttpOnly and SameSite=Strict; nothing from outside this PC is let in (the phone page was taken out 2026-11-23). (Tested by the
  smoke test: a request without the key gets 401.)
- **Installing Claude Code**: the command is fixed in the code (Anthropic's official installer), shown running in the panel; the page can
  start it but can't choose what runs.
- **Claude Code's hooks** post to the server and get an empty answer (a hook's output can reach Claude). The key travels in a header file in
  the app-data folder, never in the Documents workspace (a test scans the workspace for it).
- **The terminal** never types on its own unless Claude Code's hooks say it is idle, and then only the one line the person asked to send.
- **Assistants and risky actions**: removing or replacing things waits for the person's Allow in the editor (a prompt
  injection in a place's notes, telling the AI to delete every place, is in the model check and is stopped).

## Found in the adversarial review (2026-11-22) and fixed

- **The window went to IPv6 first.** It opened `http://localhost:<port>/?t=<key>`, and Electron tries `[::1]` before `127.0.0.1` (tried: a test
  server on `[::1]` got the key), while the server listens on `127.0.0.1` only. Another program or Windows user listening on `[::1]` at that port
  would have been sent the access key and treated as the editor (the bridge, the terminal). The window, its navigation rule and `fromEditor` now
  use `127.0.0.1` (`editorOrigin` in `main.cjs`), and the start-up check fails if the window is on another address.
- **The build could be taken over by a bad dependency.** The installer job had write access on every push, and the checkout kept the token for
  later steps (which run every package's install scripts). Now every job reads only (`permissions: contents: read`, `persist-credentials: false`),
  and only a separate `publish` job, for version tags, may write: it runs no install scripts, only the release action on the files built before.
- **The access key couldn't be changed.** Settings → Access key → Make a new access key (`dd:new-access-key`): the old key stops everywhere.
- **The PC's environment reached the server**: a `MAPMAKER_ASK_BEFORE_RISKY=0` there turned off the Allow box, and an `ANTHROPIC_BASE_URL` would have
  sent the chat elsewhere. The Windows app now passes the server no `MAPMAKER_*` or `ANTHROPIC_*` variable it didn't set itself.
- **A small file could claim a huge picture** (a 137 KB PNG of 12,000 pixels square took 828 MB and a second to read). Pictures over 40 million
  pixels are refused before they are read (`PICTURE_MAX_PIXELS`), and reference pictures are read on a worker thread (`ToolContext.pictures`).
- **The AI's Undo took back the DM's own changes**, outside a locked area too, without asking. It now undoes and redoes only its own changes, and
  under a lock only those made under it (`NotYourChangeError`, `checkAiHistory` in `session.ts`). Renaming a named place, label, region, river or
  lake, name or district now asks the DM, like removing one, and a named lake can't be drained by a point on it.
- The developer setup's editor port (5173) is no longer let in by the sold app (`MAPMAKER_DEV_EDITOR_PORT`, set empty by the Windows app).
- *(second pass)* **The Allow box could act on another map**: a risky call waits up to two minutes, and another call could open another map (a
  copy of it has the same names) meanwhile. `runTool` now refuses the action if the open map or level changed while the DM decided, and the box
  names the map. A pack whose author wrote "no" as text is now held to it too (`forbidsUse`), and the worker's errors no longer carry file paths.

## Left, for the person and for the reviewer

- **R1. Anything that runs script in the page can drive the terminal.** That is what the terminal panel is: the page can start the
  terminal, set its start command (Settings) and type into it. So the whole defence is that nothing foreign can run in the page (above).
  Keep it that way: no raw HTML, no scripts or pages from elsewhere, the policy as strict as it is. **This is where a reviewer should look
  hardest.**
- **R2. Fixed 2026-11-22: `RunAsNode` is off.** It was on because the map server ran as `Dragon Drop.exe` with `ELECTRON_RUN_AS_NODE`, which
  let any program use the (once signed) exe as a plain Node.js. The server is now an Electron utility process (`utilityProcess.fork` in
  `main.cjs` `startServer`; it is told to start by `MAPMAKER_START` and to stop through its parent port), its compute workers run inside it as
  before, and the fuse is off and checked in every build. Tried on a locally built copy: its start-up check passes, and with
  `ELECTRON_RUN_AS_NODE=1` set it still starts as Dragon Drop, not as Node.
- **R3. Updates are trusted on GitHub's word until the program is signed** (they come over HTTPS from the release page). After signing,
  each copy also checks the update's signature (`SIGNING.md`). Either way, whoever controls the GitHub account can ship code to every copy:
  two-factor sign-in on it matters most of all (`SELLING.md`).
- **R4. Fixed 2026-11-22: no developer tools in the installed app** (`devTools: !app.isPackaged`, and F12 / Ctrl+Shift+I only in a
  development run). "Press F12 and paste this" is how a scammer would get a person to run code in the page, which can drive the terminal (R1);
  support has the log folder instead. The installed app's start-up check fails if the tools open.
- **R5. The access key is stored unencrypted** in the app-data folder (`settings.json`, and the window's cookie). Only programs running as the
  same Windows user can read it, and those can already do anything that user can. Fine as it is.
- **R6. Fixed 2026-11-22: no workspace file holds the key any more.** Antigravity's file held it (Antigravity can't read it from the
  environment); Antigravity was taken out for its terms (`AI-PROVIDERS.md`), and Dragon Drop now takes its entry out of the file an earlier
  version wrote (`RETIRED_TARGETS` in `assistants.cjs`).
- **R7. Claude Code's workspace pre-approves the map tools** (`mcp__mapmaker` in `.claude/settings.json`), so ordinary edits don't ask:
  every edit can be undone, and the risky ones ask in Dragon Drop itself.
- **R8. Narrowed 2026-11-22: an assistant that can run commands has only the map tools key.** The terminal's assistant used to be handed the
  access key itself (`DRAGON_DROP_KEY`), so a command it ran could talk to the server as the editor does, Allow box included. It now gets a key
  of its own, the map tools key (`settings.toolsToken`, `MAPMAKER_TOOLS_TOKEN`; also in the map tools file, the hooks' header file and Settings'
  command for Claude Code in your own terminal), which the server takes only for `/mcp` and `/api/claude-hook` (`TOOLS_ROUTES`,
  `toolsAuthorised` in `http.ts`): not for the editor's connection, where the Allow box is answered, nor for the rest of `/api`, nor for the
  editor's cookie. What is left: the assistant runs as the same Windows user, so a command could still read the access key from the app-data
  folder or change the map files directly. Claude Code asks before running any command (only the map tools are pre-approved); for another
  assistant, keep its own "ask before commands" setting on. Make a new access key in Settings makes a new map tools key too.

## Keeping Electron current

`apps/desktop` is on Electron 45.3.2; 45.4.1 is out (2026-11-22). Dependabot opens the update on Mondays; merge it once its checks pass and
release it within two weeks when the release notes mention security fixes (`RELEASING.md`).
