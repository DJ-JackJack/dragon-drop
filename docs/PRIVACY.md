# Dragon Drop privacy policy

> **Draft, 2026-11-22, not yet published.** Fill in the two `[...]` places before it goes on the store page. Each statement was checked
> against the code on that date (what the app connects to, what it stores and where); if the app starts sending anything new, this page has to
> change in the same release.

*Last changed: [date it goes live]*

Dragon Drop is a map editor that runs on your own Windows PC. It has no accounts, no analytics, no advertising and no crash reports.
We (the developer) never see your maps, your settings or anything you do in it.

## What stays on your PC

- **Your maps**: in `Documents\Dragon Drop\projects`, or the folder you chose in Settings. That includes each map's checkpoints, backups,
  exports, reference pictures, notes (the brief) and the chat history of the in-window chat.
- **Settings and logs**: in Dragon Drop's own folder in your Windows user's app data (`%APPDATA%\Dragon Drop`). The logs are kept on your
  PC and never sent anywhere; you send them yourself only if you choose to when asking for help.
- **Your Anthropic API key** (only if you use the in-window chat): in that same folder, encrypted with your Windows sign-in where Windows
  offers it. We never receive it.
- **Asset packs**: read where they are. Dragon Drop doesn't copy or upload them (though a picture of a battlemap that an AI assistant looks at
  shows them, like the rest of the map).

## What leaves your PC, and to whom

Dragon Drop itself connects to the internet only for the things below.

- **Update checks** (the copy from the GitHub release page): Dragon Drop asks GitHub whether there is a newer version and downloads it
  from there. GitHub sees your IP address and that a copy of Dragon Drop asked. You can turn automatic checks off in **Settings → Updates**.
  The copy from itch.io doesn't check: the itch app updates it.
- **The AI assistant, if you use one**: this is the only way your map's content leaves your PC, and only while you use it.
  - **The in-window chat** sends your messages, the pictures you attach, and what Claude reads of your map (pictures of the map, lists of
    places and labels, the brief) to Anthropic, using your own API key.
  - **An assistant in the terminal panel** (Claude Code, Codex, Gemini CLI, OpenCode, Antigravity CLI, Muse Code or another you choose) is
    a separate program from its own company, signed in with your own account. It sends what it reads, through the map tools and from its
    workspace folder, to its company.

  What each company does with it, including whether it is used to train their models, is set by **that company's terms and your plan
  with them**, not by us. Some plans use your conversations for training unless you turn that off, and some cheaper plans require it.
  Check the settings of the account you sign in with.
- **Installing Claude Code**: the **Set up Claude Code** button runs Anthropic's own installer, which downloads Claude Code from Anthropic.
- **Links** in Settings → Help open in your web browser, on the site they point to.
- **The phone page**: off until you turn it on. It goes through Tailscale, your own private network between your own devices, and needs
  your access key. We have no part in that connection.

## Buying Dragon Drop

If you buy Dragon Drop on itch.io, itch.io handles the payment and your account there under
[its own privacy policy](https://itch.io/docs/legal/privacy-policy). We see what itch.io shows sellers about a purchase:
[check what the itch.io dashboard shows sellers and describe it here].

## Writing to us

If you contact us for help, we keep your message and your contact details for as long as it takes to answer and follow up, and we don't share
them with anyone. Please never send your access key, an API key or a password.

## Children

Dragon Drop is not meant for children under 13, and we don't knowingly collect anything from them. Dragon Drop doesn't collect anything
from anyone else either.

## Changes

If this policy changes, the new version is published here with a new date, and the release notes of the version that changed it say so.

## Contact

[contact address: an email or the store page's community]
