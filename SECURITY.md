# Security

Dragon Drop is a desktop map editor. It runs a small server on your own computer (reachable only from your computer) and keeps your maps
and your API key on your machine. There is no account system and the app sends no analytics.

## Reporting a vulnerability

Please report it privately, not in a public issue:

1. Open the repository's **Security** tab and choose **Report a vulnerability** (GitHub's private vulnerability reporting).
2. Say what you found, how to reproduce it, which version you tested (Settings shows it), and what you think an attacker could do.

This is a small project with one maintainer, and there is no bug bounty. What happens next:

- **Within 7 days**: a reply saying the report arrived, and whether it is understood or more is needed.
- **Within 14 days**: whether it is accepted as a security problem, and how serious it is.
- **A fix**: for a serious problem (someone else could reach your maps or your PC, or the access key could leak), a new version within 30 days,
  sooner if it is being used against people. Lesser problems are fixed in the next normal release.
- The fix is released as an ordinary update (the in-app updater and the itch app bring it), and the details are published once it has been
  out for about two weeks, so that most copies have updated first. Reporters are credited in the release notes if they want to be.

Please give that time before telling anyone else.

## What is in scope

- The Windows app and installer: the sandboxed editor window, the bridge between the window and the app, the embedded terminal, the settings and
  how the API key is stored, the in-app updater.
- The local server: its HTTP API, WebSocket and MCP endpoint, the Host/Origin checks and the access token that protects them.
- The release process: the GitHub workflow that builds and publishes the installer, and the files it publishes.
- The access key: it must not end up in a file in the Documents folder (often synced to the cloud). The app keeps the files that hold it in its own app-data folder, and hands it to the terminal assistant in the environment.
- Map files and imported files (images, zip files, asset packs) that could crash the app or run something they shouldn't.
  WebP pictures are read by libwebp compiled to WebAssembly (`tools/webp-wasm/`): the module imports nothing, so it can't reach the disk or the network, and each picture is read in a fresh instance. A WebP that makes it do anything but fail or return wrong pixels is in scope; so is a libwebp version with a known fault (the build is pinned to 1.6.0, above the 1.3.2 fix for CVE-2023-4863).

## What is out of scope

- Problems in Claude Code or the Claude API themselves: report those to Anthropic through their own program.
- Anything that needs you to have already given an attacker control of your computer or your Windows account.
- The AI model saying something wrong: that is a quality problem, not a security one. A prompt that makes the app do something the tools
  were not meant to allow (edit outside a locked selection, run a command, reach the network) **is** in scope.

## Supported versions

Only the latest release gets fixes. The in-app updater (Settings) brings you to it.
