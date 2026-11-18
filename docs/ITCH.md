# Selling on itch.io (Windows)

Every CI run makes a copy of the program for itch.io and keeps it for 30 days as an artifact called **Dragon-Drop-itch-windows**
(Actions, open the run, Artifacts). It is the same program as the installer with two differences:

- `resources/channel.json` says `{"channel":"itch"}`, which turns the in-app updater off. The itch app brings updates; Settings says so and
  hides "Check for updates". (Two updaters fighting over one folder is how installs get broken.)
- `.itch.toml` tells the itch app which program to launch.

The release workflow does **not** put this copy on the public GitHub Release: it is only an artifact, so the paid build isn't free to download.

## One-time setup

1. Create the game page on itch.io (a **Downloadable** project, Windows) and set the price. Decide on a free demo or a pay-what-you-want minimum.
2. Install [butler](https://itch.io/docs/butler/) and log in: `butler login`.
3. Look at the page's settings for what itch asks creators about AI. The maps are procedurally painted (no generated images); the assistant is
   an AI. Answer honestly and say so on the page.
4. Say plainly on the page that the AI assistant needs the buyer's own account with an AI provider (separate cost) and that the editor
   works without it.

## Each release

1. Tag the release as usual (the GitHub release stays the free/dev channel and the source of in-app updates for the installer build).
2. Download the **Dragon-Drop-itch-windows** artifact from that tag's run and unzip it into a folder called `Dragon Drop`.
3. Push it:

   ```
   butler push "Dragon Drop" YOUR-ITCH-NAME/dragon-drop:windows --userversion 0.1.8
   ```

   `windows` is the channel; butler works out what changed, so buyers download only the difference. Use the same version number as the tag.
4. Check it from the itch app on a clean Windows account: install, start, open Settings (the Updates section should say the itch app updates it).

## Things to know

- The installer build and the itch build share one settings and maps folder (the user's app data and `Documents\Dragon Drop`), so
  someone who has both sees the same maps.
- Windows SmartScreen will warn about an unsigned program. The itch app does not hide that. Sign the build before selling (a certificate
  goes into the workflow's build step; ask for this to be wired up when you have one).
- `docs/PLAN.md` and the README describe the project; the legal, technical and security checklist for selling is in `docs/SELLING.md`.
