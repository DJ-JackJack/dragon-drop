/** Provided by the desktop app's preload script; missing when the editor runs in an ordinary browser. */
interface DragonDropBridge {
  platform: string;
  version: string;
  getSettings(): Promise<{ version: string; projectsDir: string; hasApiKey: boolean; port: number; defaultPort: number; autoUpdate: boolean; assetsDir: string | null; mcpUrl: string; mcpCommand: string; mcpCommandShown: string; terminalCommand: string; logDir: string; encrypted: boolean } | null>;
  setApiKey(key: string): Promise<boolean>;
  chooseProjectsFolder(): Promise<string | null>;
  chooseAssetsFolder(): Promise<string | null>;
  clearAssetsFolder(): Promise<void>;
  openProjectsFolder(): Promise<void>;
  openLogs(): Promise<void>;
  openClaude(launch?: boolean): Promise<{ ok: boolean; reason?: string; workspace?: string; claudePath?: string }>;
  termStart(opts: { cols: number; rows: number; resume?: boolean }): Promise<{ ok: boolean; reason?: string; command?: string }>;
  /** Set what the terminal runs ("" is Claude Code). A valid change saves and ends the running terminal. */
  setTerminalCommand(text: string): Promise<{ ok: boolean; command: string }>;
  /** Run Claude Code's official installer visibly in the terminal panel; `onClaudeInstalled` reports how it went. */
  claudeInstall(opts: { cols: number; rows: number }): Promise<{ ok: boolean; reason?: string }>;
  claudeCheck(): Promise<{ installed: boolean; path: string | null; version: string | null }>;
  onClaudeInstalled(cb: (r: { ok: boolean; code: number; found: boolean }) => void): () => void;
  termAttach(): Promise<{ alive: boolean; buffer: string; command: string }>;
  /** Is the terminal running, how long has it been silent, and does its last screen look busy or like a question? */
  termStatus(): Promise<{ alive: boolean; quietMs: number; looksBusy: boolean }>;
  termWrite(data: string): void;
  termResize(cols: number, rows: number): void;
  termKill(): Promise<void>;
  onTermData(cb: (data: string) => void): () => void;
  onTermExit(cb: (code: number) => void): () => void;
  getUpdateState(): Promise<{ status: string; version: string | null; message: string; channel?: string } | null>;
  checkForUpdates(): Promise<{ status: string; version: string | null; message: string; channel?: string } | null>;
  installUpdate(): Promise<void>;
  setAutoUpdate(on: boolean): Promise<boolean>;
}
interface Window {
  dragonDrop?: DragonDropBridge;
}
