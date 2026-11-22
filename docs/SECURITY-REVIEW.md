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
| `RunAsNode` | **still on** | the map server runs as a child process through `ELECTRON_RUN_AS_NODE` (see R2) |

Tried 2026-11-22 on a locally built copy (`npm run dist:dir`): its start-up check passes (sandbox, server, access key, terminal, the
Claude Code check), and with `NODE_OPTIONS` set to load a missing file it still starts (the variable is ignored). The build checks the fuses
every time (`apps/desktop/scripts/check-fuses.mjs`, in the workflow's "List what was built" step).

## Checked and sound

- **The window**: sandboxed, context isolation on, no Node in the page; it can't leave `http://localhost:<port>/` (other links open in the
  browser, and only `http(s)` ones); pop-ups are refused; every permission request (camera, microphone, location, notifications...) is refused
  but clipboard writing and full screen.
- **The bridge** (`preload.cjs` → `ipcMain`): every handler checks that the call comes from the editor's own address (`fromEditor`), and the
  inputs are checked: a map id against a pattern before opening its backups folder, the phone address against a host-name pattern, the API
  key's length, the start command's length and control characters. Folders are chosen in Windows' own dialog, never from the page.
- **The page can't run foreign code**: the editor sets no raw HTML anywhere (no `dangerouslySetInnerHTML`, `innerHTML`, `document.write`), map
  text is shown through React, which escapes it; the Content-Security-Policy allows only the program's own scripts (no inline script) and
  connections only back to its own server; every response is `nosniff` and `no-referrer`; asset and reference pictures are served only as
  PNG, JPEG or WebP (anything else as a download), SVG and HTML never.
- **The server**: on 127.0.0.1 only, Host and Origin checked first, then the access key on every `/api`, `/mcp` and `/ws` request (compared in
  constant time); the window's cookie is HttpOnly and SameSite=Strict; the phone page is off until the person turns it on. (Tested by the
  smoke test: a request without the key gets 401.)
- **Installing Claude Code**: the command is fixed in the code (Anthropic's official installer), shown running in the panel; the page can
  start it but can't choose what runs.
- **Claude Code's hooks** post to the server and get an empty answer (a hook's output can reach Claude). The key travels in a header file in
  the app-data folder, never in the Documents workspace (a test scans the workspace for it).
- **The terminal** never types on its own unless Claude Code's hooks say it is idle, and then only the one line the person asked to send.
- **Assistants and risky actions**: removing or replacing things waits for the person's Allow in the editor or on the phone (a prompt
  injection in a place's notes, telling the AI to delete every place, is in the model check and is stopped).

## Left, for the person and for the reviewer

- **R1. Anything that runs script in the page can drive the terminal.** That is what the terminal panel is: the page can start the
  terminal, set its start command (Settings) and type into it. So the whole defence is that nothing foreign can run in the page (above).
  Keep it that way: no raw HTML, no scripts or pages from elsewhere, the policy as strict as it is. **This is where a reviewer should look
  hardest.**
- **R2. `RunAsNode` is still on.** Anyone who can already start programs on the PC can use `Dragon Drop.exe` (once signed) as a plain
  Node.js. To switch it off, the map server has to be started with Electron's `utilityProcess` instead of `ELECTRON_RUN_AS_NODE` (the server,
  its compute workers and the smoke test would all need trying again). Worth doing within a few releases of signing.
- **R3. Updates are trusted on GitHub's word until the program is signed** (they come over HTTPS from the release page). After signing,
  each copy also checks the update's signature (`SIGNING.md`). Either way, whoever controls the GitHub account can ship code to every copy:
  two-factor sign-in on it matters most of all (`SELLING.md`).
- **R4. F12 opens the browser's developer tools** in the sold program too. Only the person at the PC can press it, and it helps with
  support, so it is left on. Switch it off if a reviewer prefers.
- **R5. The access key is stored unencrypted** in the app-data folder (`settings.json`, and the window's cookie). Only programs running as the
  same Windows user can read it, and those can already do anything that user can. Fine as it is.
- **R6. Fixed 2026-11-22: no workspace file holds the key any more.** Antigravity's file held it (Antigravity can't read it from the
  environment); Antigravity was taken out for its terms (`AI-PROVIDERS.md`), and Dragon Drop now takes its entry out of the file an earlier
  version wrote (`RETIRED_TARGETS` in `assistants.cjs`).
- **R7. Claude Code's workspace pre-approves the map tools** (`mcp__mapmaker` in `.claude/settings.json`), so ordinary edits don't ask:
  every edit can be undone, and the risky ones ask in Dragon Drop itself.

## Keeping Electron current

`apps/desktop` is on Electron 45.3.2; 45.4.1 is out (2026-11-22). Dependabot opens the update on Mondays; merge it once its checks pass and
release it within two weeks when the release notes mention security fixes (`RELEASING.md`).
