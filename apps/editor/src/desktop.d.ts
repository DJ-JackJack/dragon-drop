/** Provided by the desktop app's preload script; missing when the editor runs in an ordinary browser. */
interface DragonDropBridge {
  platform: string;
  version: string;
  getSettings(): Promise<{ version: string; projectsDir: string; hasApiKey: boolean; port: number; defaultPort: number; autoUpdate: boolean; assetsDir: string | null; mcpUrl: string; mcpCommand: string; mcpCommandShown: string; mcpHeader: string; terminalCommand: string; toolSet: "all" | "essentials"; assistant: { assistant: string | null; name: string | null; auto: boolean; file: string | null; hint: string }; logDir: string; encrypted: boolean } | null>;
  setApiKey(key: string): Promise<boolean>;
  chooseProjectsFolder(): Promise<string | null>;
  chooseAssetsFolder(): Promise<string | null>;
  clearAssetsFolder(): Promise<void>;
  openProjectsFolder(): Promise<void>;
  /** Open a map's backups folder, or its own folder while it has no backups (`opened` says which). */
  openBackups(id: string): Promise<{ ok: boolean; opened: "backups" | "map" | null }>;
  /** Make a new access key: the old one stops working everywhere (the server starts again, and the window reloads with the new one). */
  newAccessKey(): Promise<boolean>;
  openLogs(): Promise<void>;
  /** Open the open-source licences file; ok is false when it isn't there (a developer build). */
  openLicences(): Promise<{ ok: boolean }>;
  openClaude(launch?: boolean): Promise<{ ok: boolean; reason?: string; workspace?: string; claudePath?: string }>;
  termStart(opts: { cols: number; rows: number; resume?: boolean }): Promise<{ ok: boolean; reason?: string; command?: string }>;
  /** Show the assistant all the map tools or the smaller set (for smaller models). A change saves and ends the running terminal. */
  setToolSet(set: "all" | "essentials"): Promise<"all" | "essentials">;
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
  getUpdateState(): Promise<{ status: string; version: string | null; message: string; channel?: string; movedTo?: string } | null>;
  checkForUpdates(): Promise<{ status: string; version: string | null; message: string; channel?: string; movedTo?: string } | null>;
  installUpdate(): Promise<void>;
  setAutoUpdate(on: boolean): Promise<boolean>;
}
interface Window {
  dragonDrop?: DragonDropBridge;
}
