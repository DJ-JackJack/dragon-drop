# Any Terminal Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop app's terminal panel runs a start command the user picks (default: Claude Code exactly as today), so any terminal AI assistant works in it.

**Architecture:** One new app-data setting, `terminalCommand` (empty string means Claude Code). `startTerminal` in `apps/desktop/main.cjs` keeps today's path when it is empty and otherwise runs the text through the shell in the workspace. The workspace also gets `AGENTS.md`, `GEMINI.md` and `.mcp.json`. The editor gets a dropdown plus text box in Settings and hides Claude-only buttons when a custom command runs.

**Tech Stack:** Electron (`main.cjs`, `preload.cjs`), `@lydell/node-pty`, React + TypeScript editor.

**Spec:** `docs/superpowers/specs/2026-11-18-any-terminal-assistant-design.md`

## Global Constraints

- Empty `terminalCommand` = today's Claude Code path, unchanged (install button, `--mcp-config`, hooks, Assist, "Continue last").
- Every new `dd:*` IPC handler checks `fromEditor(e)`.
- The Claude installer command stays fixed in `installCommand()`.
- `apps/desktop` writes only inside the Claude workspace and the app-data folder.
- Command text: at most 500 characters, trimmed, no control characters (`/[\x00-\x1f\x7f]/`). Anything else is refused and the setting is left unchanged.
- No em dashes in UI text, comments or commit messages.

## Review Focus

1. **Command not installed** (e.g. `codex` missing): the shell prints its error and the panel goes to "Ended" with "New conversation", never stuck on "Running". Smoke test runs a command that exits.
2. **Newline or control character in the command**: refused, setting unchanged. Smoke test asserts it.
3. **Switching back to Claude Code** (empty): the next start uses `findClaude` and `--mcp-config` again. Smoke test restores `""` and the existing fake-Claude check still passes after it.
4. **User edited `AGENTS.md` or `GEMINI.md`** (removed the managed mark): not rewritten. Reuses the `CLAUDE_MARK` check, so the same code path as `CLAUDE.md`.
5. **User's own `enabledMcpjsonServers` in the workspace `.claude/settings.json`**: kept, `mapmaker` added once. Smoke test asserts `mapmaker` is in the list exactly once.

---

### Task 1: Desktop side (setting, launch, workspace files, smoke test)

**Files:**
- Modify: `apps/desktop/main.cjs` (workspace writer near line 346, `withDragonDropHooks` near 315, `startTerminal` near 478, IPC near 579 and 628-634, smoke test near 710-757)
- Modify: `apps/desktop/preload.cjs`

**Interfaces:**
- Produces (bridge, used by Task 2):
  - `getSettings()` result gains `terminalCommand: string`.
  - `setTerminalCommand(text: string): Promise<{ ok: boolean; command: string }>` via `dd:set-terminal-command`. On a valid change it saves the setting and calls `killTerminal()` (the panel then gets `dd:term-exit` and shows "Ended"). On invalid text, `ok: false` and `command` is the unchanged value.
  - `termStart(...)` result gains `command: string` (the command that ran; `""` for Claude Code).
  - `termAttach()` result gains `command: string` (`settings.terminalCommand || ""`).

- [ ] **Step 1: Write the failing smoke assertions** in the smoke test, after the existing "Claude Code panel didn't notice the program ending" check:
  - `await window.dragonDrop.setTerminalCommand("echo a\necho b")` returns `ok === false`.
  - `setTerminalCommand("echo DD_CUSTOM_OK")` returns `{ ok: true, command: "echo DD_CUSTOM_OK" }`.
  - `termStart({ cols: 80, rows: 24 })` returns `ok === true, command === "echo DD_CUSTOM_OK"`; within 20 s, `termAttach().buffer` includes `DD_CUSTOM_OK`.
  - `setTerminalCommand("")` returns `ok === true`, then the existing `openClaude(false)` workspace checks run.
  - The workspace file list check also requires `AGENTS.md`, `GEMINI.md` and `.mcp.json`; `.mcp.json` contains `http://127.0.0.1:${port}/mcp`.
  - Parsed `.claude/settings.json` has `enabledMcpjsonServers` with `"mapmaker"` exactly once.

  Each failure calls `fatal(...)` with the value it saw, like its neighbours.

- [ ] **Step 2: Run to verify it fails**

  Run: `cd apps/desktop && npm run prepare:app && npm run smoke`
  Expected: FAIL (`setTerminalCommand is not a function`).

- [ ] **Step 3: Implement**
  - `validTerminalCommand(text: unknown): string | null` in `main.cjs`: returns the trimmed string per Global Constraints, else `null`.
  - `dd:set-terminal-command` handler and `preload.cjs` entry `setTerminalCommand: (t) => ipcRenderer.invoke("dd:set-terminal-command", t)`. Save only when the value changed; kill the terminal only then.
  - `dd:settings` adds `terminalCommand: settings.terminalCommand || ""`; `dd:term-attach` adds `command`.
  - `withDragonDropHooks(cfg)` also returns `enabledMcpjsonServers`: the existing array (if it is one) with `"mapmaker"` appended when missing.
  - `writeClaudeWorkspace`: write `.mcp.json` with the same `{ mcpServers: { mapmaker: { type: "http", url } } }` as `mapmaker.mcp.json`. Write `AGENTS.md` and `GEMINI.md` with `CLAUDE_MD` using the same "rewrite only if it still has `CLAUDE_MARK`" rule (loop over the three names).
  - `startTerminal`: when `settings.terminalCommand` is set, skip `findClaude` and run it through the shell in `workspace`. On Windows: `file = process.env.ComSpec || "cmd.exe"`, args as the single command-line string `"/c " + command` (node-pty accepts a string on Windows, so cmd parses the user's text as typed). Elsewhere: `process.env.SHELL || "/bin/sh"`, `["-lc", command]`. `resume` is ignored for custom commands. Return `command` in the result (`""` on the Claude path).

- [ ] **Step 4: Run to verify it passes**

  Run: `cd apps/desktop && npm run prepare:app && npm run smoke`
  Expected: `SMOKE OK (...)`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/main.cjs apps/desktop/preload.cjs
git commit -m "Desktop: run any start command in the terminal panel"
```

### Task 2: Editor side (Settings dropdown, panel cosmetics)

**Files:**
- Modify: `apps/editor/src/desktop.d.ts`
- Modify: `apps/editor/src/DesktopSettings.tsx` (the "Claude Code and Remote Control" fieldset, lines 104-119)
- Modify: `apps/editor/src/ClaudeTerminal.tsx`
- Modify: `apps/editor/src/RightPanel.tsx:21`

**Interfaces:**
- Consumes: Task 1's `setTerminalCommand`, `terminalCommand` in `getSettings`, `command` in `termStart` / `termAttach`.

- [ ] **Step 1: Types.** Add the fields and `setTerminalCommand(text: string): Promise<{ ok: boolean; command: string }>` to `DragonDropBridge` in `desktop.d.ts`.

- [ ] **Step 2: Settings.** Rename the fieldset legend to "AI assistant". Add:
  - `const PRESETS: [label: string, command: string][]` with exactly: `["Claude Code", ""]`, `["Codex", "codex"]`, `["Gemini CLI", "gemini"]`, `["OpenCode", "opencode"]`, `["Claude Code via Ollama", "ollama launch claude"]`, `["Codex via Ollama", "ollama launch codex"]`, `["OpenCode via Ollama", "ollama launch opencode"]`.
  - A `<select>` whose value is the matching preset, or "Custom" when the text matches none; choosing one fills the text box.
  - A text input (placeholder `claude`, `data-testid="terminal-command"`), and a Save button that calls `setTerminalCommand` and refreshes. Shows an error line when `ok` is false.
  - Muted copy: "The terminal on the right runs this. Saving ends the running session. Tools other than Claude Code need the map tools added once: their address is below."
  - Show the plain `s.mcpUrl` with its own Copy button, beside the existing `claude mcp add` line.
  - Keep the Claude Code status line and "Open Claude Code" button only when the saved command is empty.

- [ ] **Step 3: Panel.** In `ClaudeTerminal`, keep `const [command, setCommand] = useState("")`, set from `termStart` and `termAttach` results. When `command !== ""`:
  - The title reads `Terminal` with the command in a muted span beside it.
  - Hide "Pop out", "Continue last", and the Assist bar unless `claude !== "unknown"` (so `ollama launch claude` keeps Assist once its hooks report).
  - The ended text says "The program has ended."

  In `RightPanel.tsx`, rename the tab label from `"Claude Code"` to `"Terminal"`.

- [ ] **Step 4: Verify**

  Run: `pnpm typecheck && pnpm test && pnpm e2e`
  Expected: all pass.
  Run: `cd apps/desktop && npm run prepare:app && npm run smoke`
  Expected: `SMOKE OK (...)`.
  Manual: in `npm start`, pick "Codex" (or any installed CLI) in Settings, save, click "New conversation", and see it start in the panel; pick "Claude Code" and see Claude start with Assist working.

- [ ] **Step 5: Commit**

```bash
git add apps/editor/src/desktop.d.ts apps/editor/src/DesktopSettings.tsx apps/editor/src/ClaudeTerminal.tsx apps/editor/src/RightPanel.tsx
git commit -m "Editor: pick the terminal's start command in Settings"
```

### Task 3: Docs

**Files:**
- Modify: `CLAUDE.md` (the "Claude Code first-run setup" bullet)

- [ ] **Step 1:** Add one sentence: the terminal panel runs `settings.terminalCommand` (empty = Claude Code with `--mcp-config` and hooks; anything else runs through the shell in the workspace, which also has `AGENTS.md`, `GEMINI.md` and `.mcp.json`).
- [ ] **Step 2: Commit** the spec, this plan and `CLAUDE.md`:

```bash
git add CLAUDE.md docs/superpowers
git commit -m "Docs: any terminal assistant"
```
