// Checks the built program's Electron fuses (switches compiled into Dragon Drop.exe, set by package.json's build.electronFuses):
// Node options and debugger arguments can't be used to run other code inside it, and it loads only its own checked app.asar.
// RunAsNode is off too: the map server is an Electron utility process (main.cjs startServer), not this program run as plain Node.
// Usage: node scripts/check-fuses.mjs "release/win-unpacked/Dragon Drop.exe"
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getCurrentFuseWire, FuseV1Options } = require("@electron/fuses");

const exe = process.argv[2];
if (!exe) { console.error("usage: node scripts/check-fuses.mjs <path to Dragon Drop.exe>"); process.exit(2); }

const WANT = {
  RunAsNode: false,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  GrantFileProtocolExtraPrivileges: false,
};

const wire = await getCurrentFuseWire(exe);
let bad = 0;
for (const [name, want] of Object.entries(WANT)) {
  const v = wire[FuseV1Options[name]];
  const on = v === 49 || v === "1"; // the wire holds the characters "0" and "1"
  const ok = on === want;
  if (!ok) bad++;
  console.log(`${ok ? "ok " : "BAD"} ${name}: ${on ? "on" : "off"} (want ${want ? "on" : "off"})`);
}
if (bad) { console.error(`${bad} fuse(s) not as they should be: check build.electronFuses in apps/desktop/package.json`); process.exit(1); }
