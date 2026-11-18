"use strict";
// The few things the editor may ask the desktop shell to do. Nothing else from Node reaches the page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dragonDrop", {
  platform: process.platform,
  version: ipcRenderer.sendSync("dd:version"),
  getSettings: () => ipcRenderer.invoke("dd:settings"),
  setApiKey: (key) => ipcRenderer.invoke("dd:set-api-key", String(key ?? "")),
  chooseProjectsFolder: () => ipcRenderer.invoke("dd:choose-projects"),
  chooseAssetsFolder: () => ipcRenderer.invoke("dd:choose-assets"),
  clearAssetsFolder: () => ipcRenderer.invoke("dd:clear-assets"),
  openProjectsFolder: () => ipcRenderer.invoke("dd:open-projects"),
  openLogs: () => ipcRenderer.invoke("dd:open-logs"),
  openClaude: (launch = true) => ipcRenderer.invoke("dd:open-claude", { launch }),
  termStart: (opts) => ipcRenderer.invoke("dd:term-start", opts || {}),
  claudeInstall: (opts) => ipcRenderer.invoke("dd:claude-install", opts || {}),
  claudeCheck: () => ipcRenderer.invoke("dd:claude-check"),
  onClaudeInstalled: (cb) => { const h = (_e, r) => cb(r); ipcRenderer.on("dd:claude-installed", h); return () => ipcRenderer.removeListener("dd:claude-installed", h); },
  termAttach: () => ipcRenderer.invoke("dd:term-attach"),
  termStatus: () => ipcRenderer.invoke("dd:term-status"),
  termWrite: (data) => ipcRenderer.send("dd:term-write", String(data)),
  termResize: (cols, rows) => ipcRenderer.send("dd:term-resize", cols, rows),
  termKill: () => ipcRenderer.invoke("dd:term-kill"),
  onTermData: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on("dd:term-data", h); return () => ipcRenderer.removeListener("dd:term-data", h); },
  onTermExit: (cb) => { const h = (_e, code) => cb(code); ipcRenderer.on("dd:term-exit", h); return () => ipcRenderer.removeListener("dd:term-exit", h); },
  getUpdateState: () => ipcRenderer.invoke("dd:update-state"),
  checkForUpdates: () => ipcRenderer.invoke("dd:check-update"),
  installUpdate: () => ipcRenderer.invoke("dd:install-update"),
  setAutoUpdate: (on) => ipcRenderer.invoke("dd:set-auto-update", !!on),
});
