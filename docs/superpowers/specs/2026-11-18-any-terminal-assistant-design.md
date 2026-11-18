# Any terminal assistant in the built-in terminal

## Why
Other people may use Dragon Drop with whatever terminal AI they already have (Codex, Gemini CLI, OpenCode, Ollama running one of those on a local model, Claude Code). Few users are expected, so this stays small: the terminal panel becomes a plain terminal that runs one start command.

## Goals
- A setting, "Start command", in the desktop Settings dialog. A dropdown fills it with a common command; the text box can be edited to anything.
- Presets: Claude Code (default, today's behaviour), `codex`, `gemini`, `opencode`, `ollama launch claude`, `ollama launch codex`, `ollama launch opencode`.
- Settings shows the map tools address (`http://127.0.0.1:<port>/mcp`) with a Copy button, so users of other tools can register it themselves.

## Non-goals
- Wiring each tool's MCP config for the user (option 2, rejected as more upkeep than the expected users justify).
- Assist mode for tools other than Claude Code.

## Anti-goals
- Breaking today's Claude Code path: install button, sign-in hint, `--mcp-config`, hooks, Assist, "Continue last" all keep working when the default is chosen.

## Approaches considered
1. **Plain start command plus presets that only fill the box (picked).** Least code, works with any CLI including `ollama launch ...`; users of non-Claude tools register the MCP address themselves.
2. Preset table that also writes each tool's MCP config. Works out of the box, but every preset needs upkeep as the CLIs change.
3. Option 1 now, built to grow into 2. Same as 1 for now; not worth designing for.

## Design
- **Setting:** `settings.terminalCommand` in the app-data `settings.json` (empty means Claude Code as today). New bridge call `setTerminalCommand(text)`, checked with `fromEditor` like the other `dd:*` handlers; `getSettings` returns it plus `mcpUrl`.
- **Starting:** `startTerminal` keeps today's code when the setting is empty. Otherwise it runs the text through the shell in the workspace folder (`cmd.exe /c <text>` on Windows, `$SHELL -lc <text>` elsewhere), same pty, same output path. A command that isn't installed prints the shell's error and the panel shows "Ended".
- **Workspace:** also writes `AGENTS.md` (Codex, OpenCode, Copilot read it) and `GEMINI.md`, same text as `CLAUDE.md`, same "managed by Dragon Drop" mark so a user's edits are kept. While another assistant is chosen it also writes `.mcp.json` with the mapmaker server and pre-approves it (`enabledMcpjsonServers: ["mapmaker"]`) so `ollama launch claude` gets the map tools without a flag. With the default, neither is written (and our `.mcp.json` entry is removed again): Claude Code in the panel already gets the map tools from `--mcp-config`, and a second definition of the same server could ask the person to approve it. (My call; it makes the Ollama + Claude preset work out of the box without touching the default path.)
- **Panel cosmetics (custom command only):** title reads "Terminal" with the command beside it; the install overlay, sign-in hint, "Continue last" and "Pop out" are hidden; the Assist bar is hidden unless Claude's hooks are reporting (so `ollama launch claude` keeps Assist).
- **Safety:** the page can already type anything into the terminal, so letting it choose the start command adds no new power. The Claude installer command stays fixed in `main.cjs`. Assist already refuses to type until hooks report (`assist.ts`), so other tools can't be typed at by accident.
- **Check:** the `--smoke-test` sets the command to `echo DD_CUSTOM_OK` and asserts it shows in the terminal, then restores the default.

## Left to the builder
- Exact wording and layout of the Settings fieldset and the panel title.
- Whether the Settings "Claude Code" section is renamed "AI assistant" (suggested).

## Out of scope
- How well a chosen model handles the map tools (for example a small local model through Ollama). That is the user's choice of model, not something the app compensates for.
