# Security

Dragon Drop is a desktop map editor. It runs a small server on your own computer (reachable only from your computer) and keeps your maps
and your API key on your machine. There is no account system and the app sends no analytics.

## Reporting a vulnerability

Please report it privately, not in a public issue:

1. Open the repository's **Security** tab and choose **Report a vulnerability** (GitHub's private vulnerability reporting).
2. Say what you found, how to reproduce it, which version you tested (Settings shows it), and what you think an attacker could do.

You'll get an acknowledgement, and a fix or a plan once the problem is understood. Please give a reasonable time to fix it before telling
anyone else; reporters are credited in the release notes if they want to be. This is a small project: there is no bug bounty.

## What is in scope

- The Windows app and installer: the sandboxed editor window, the bridge between the window and the app, the embedded terminal, the settings and
  how the API key is stored, the in-app updater.
- The local server: its HTTP API, WebSocket and MCP endpoint, the Host/Origin checks and the access token that protects them.
- The release process: the GitHub workflow that builds and publishes the installer, and the files it publishes.
- Map files and imported files (images, zip files, asset packs) that could crash the app or run something they shouldn't.

## What is out of scope

- Problems in Claude Code or the Claude API themselves: report those to Anthropic through their own program.
- Anything that needs you to have already given an attacker control of your computer or your Windows account.
- The AI model saying something wrong: that is a quality problem, not a security one. A prompt that makes the app do something the tools
  were not meant to allow (edit outside a locked selection, run a command, reach the network) **is** in scope.

## Supported versions

Only the latest release gets fixes. The in-app updater (Settings) brings you to it.
