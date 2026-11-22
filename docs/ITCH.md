# Selling on itch.io (Windows)

Every CI run makes a copy of the program for itch.io and keeps it for 7 days as an artifact called **Dragon-Drop-itch-windows**
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

## Payments and taxes (from itch.io's creator docs, read 2026-11-22)

Not tax advice: show this to whoever helps with your taxes (a free small-business adviser, or an accountant).

- **Two payment modes** (account settings). **"Collected by itch.io, paid later"** (recommended): itch.io is the seller of record, is liable
  for chargebacks, always collects VAT and pays it, offers buyers every payment method, and makes the tax forms after **one tax interview** on
  itch.io (it asks for a tax number such as an SSN, EIN or local number; without one, 30% is held back, less where a US tax treaty applies).
  Money is in US dollars, can be paid out by PayPal or Payoneer once at least $5 is available, becomes available 7 days after a purchase, and a
  payout is reviewed for 7 to 14 days. **"Direct to you"**: you are the seller of record through your own PayPal or Stripe, liable for
  chargebacks, and you collect and pay VAT yourself (itch.io can collect it for you).
- **itch.io's share** is set by the seller ("open revenue sharing", 0% to 100%); the default is 10%. PayPal and Stripe each charge about
  $0.30 + 2.9% a purchase.
- **US sales tax**: itch.io's docs don't say how it is handled. Ask a small-business adviser.
- **Refunds**: itch.io handles them. Its terms let buyers ask when the program can't run, can't be reached or doesn't match the page; for
  technical problems buyers are asked to contact the seller first.
- **What sellers see of a buyer**: email address, name, IP address, country code and transaction IDs (and a billing address for EU purchases
  when it is collected). itch.io allows them only for records and bookkeeping, and the email only for news about that purchase; adding buyers
  to a mailing list needs their consent. The privacy policy says so.
- **Unclaimed money**: earnings left more than 12 months are charged 10% a month (itch.io's terms).

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
