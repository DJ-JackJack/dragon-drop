# Dragon Drop privacy policy

> **Draft, 2026-11-22, not yet published.** Laid out in the usual sections of a privacy policy (who is responsible, what is collected, why,
> who receives it, transfers, how long, your rights, security, children, changes, contact). Fill in the `[...]` places before it goes on the
> store page, and have free legal help look at it if you can get it. Each statement about the program was checked against the code on 2026-11-22 (what it connects to,
> what it stores and where). If the app starts sending anything new, this page has to change in the same release.

*Last changed: [date it goes live]*

## 1. Who we are

Dragon Drop is made and sold by [seller's legal name] ("we", "us"), [country]. We are responsible for the personal information described
in section 4. Contact: [contact address].

## 2. In short

- Dragon Drop is a map editor that runs on your own Windows PC. It has **no accounts, no analytics, no advertising and no crash reports**.
- **We never receive your maps, your settings or anything you do in the program.**
- Your map's content leaves your PC only if you use an AI assistant, and then it goes to **the AI company you chose, under your own account
  with them**, not to us.
- The only personal information we receive is what itch.io shows sellers about a purchase, and what you send us if you write to us.

## 3. What stays on your PC

We never receive any of this:

- **Your maps**: in `Documents\Dragon Drop\projects`, or the folder you chose in Settings, including each map's checkpoints, backups,
  exports, reference pictures, notes (the brief) and the in-window chat's history.
- **Settings and logs**: in Dragon Drop's own folder in your Windows user's app data (`%APPDATA%\Dragon Drop`). The logs are never sent
  anywhere; you send them yourself only if you choose to when asking for help.
- **Your Anthropic API key** (only if you use the in-window chat): in that same folder, encrypted with your Windows sign-in where Windows
  offers it.
- **Asset packs**: read where they are, never copied or uploaded (but a picture of a battlemap that an AI assistant looks at shows them, like
  the rest of the map).

## 4. Personal information we receive, why, and on what basis

| What | Where it comes from | Why we use it | Legal basis (EU and UK law) |
|---|---|---|---|
| Your name, email address, IP address, country and the purchase's transaction ID | itch.io, when you buy Dragon Drop: itch.io shows sellers these details of each purchase. For buyers in the EU, it may also include a billing address. | To keep records of sales, as tax law requires, to help you with your purchase, and to tell you about something specifically about your purchase (for example a serious problem in your version). We never add you to a mailing list without asking. | Performing our contract with you; our legal obligations (tax records) |
| Your messages and contact details | You, when you write to us for help or report a problem | To answer you and follow up | Performing our contract with you; our legitimate interest in helping buyers |

We don't use this information for advertising, we don't sell it, and we don't use it to make automated decisions about you.

## 5. What leaves your PC, and to whom

Dragon Drop itself connects to the internet only for these things. Except where it says otherwise, they go to the company named, not to us.

- **Update checks** (only the copy from the GitHub release page): Dragon Drop asks GitHub whether there is a newer version and downloads it
  from there. GitHub sees your IP address and that a copy of Dragon Drop asked. You can turn this off in **Settings → Updates**. The copy
  from itch.io doesn't check: the itch app updates it, under itch.io's privacy policy.
- **An AI assistant, if you use one.** This is the only way your map's content leaves your PC, and only while you use it.
  - **The in-window chat** sends your messages, the pictures you attach, and what Claude reads of your map (pictures of the map, lists of
    places and labels, the brief) to Anthropic, using your own API key.
  - **An assistant in the terminal panel** (Claude Code, Codex, Gemini CLI, OpenCode, Muse Code or another you choose) is a
    separate program from its own company, signed in with your own account. It sends what it reads, through the map tools and from its
    workspace folder, to its company.

  What each company does with it, including whether it is **used to train their models**, is set by **that company's terms and your plan
  with them**, not by us. Some plans train on your conversations unless you turn that off: for example, Meta's Muse Code subscriptions start
  in "Contributor mode", which lets Meta train on what you send (Muse Code's `/settings`, Contributor mode, turns it off on that PC), and
  Google may use prompts sent with a free Gemini API key. Check the settings of the account you sign in with.
- **Installing Claude Code**: the **Set up Claude Code** button runs Anthropic's own installer, which downloads Claude Code from Anthropic.
- **Links** in Settings → Help open in your web browser, on the site they point to.

## 6. Who we share personal information with

- **itch.io** (United States) sells Dragon Drop for us and handles the payment, under
  [its own privacy policy](https://itch.io/docs/legal/privacy-policy). Your itch.io account and the payment itself are between you and
  itch.io and its payment companies.
- [An email provider, if we answer you by email: name it here.]
- Nobody else, unless the law requires it.

## 7. Transfers outside your country

itch.io is in the United States, so purchase details are handled there. [Where the seller is, and how transfers from the EU or UK are
covered, for example by itch.io's own safeguards: ask free legal help if you can get it.]

## 8. How long we keep it

- **Purchase records**: as long as tax and accounting law requires where we are [for example 6 or 7 years: a free small-business adviser can say], then
  deleted.
- **Messages to us**: until your question is answered, and [12 months] after, in case it comes up again; then deleted.
- What stays on your PC is yours to keep or delete. Uninstalling Dragon Drop leaves your maps in `Documents\Dragon Drop`.

## 9. Your rights

Depending on where you live, you have the right to ask us for a copy of the personal information we hold about you, to have it corrected or
deleted, to object to or restrict how we use it, and to receive it in a format you can take elsewhere. Write to [contact address]; we answer
within one month. If you are in the EU or UK and unhappy with our answer, you can complain to your data protection authority.

**California residents**: we don't sell or share personal information, and we don't use it for targeted advertising.

## 10. Security

We keep the little personal information we have in [where: for example the itch.io dashboard and one email account protected by a strong
password and two-factor sign-in]. In the program, the local server only answers this PC,
and every request must carry an access key made for your install.

## 11. Children

Dragon Drop is not meant for children under 13, and we don't knowingly collect anything from them. Some AI assistants have their own age
limits (some require you to be 18 or over).

## 12. Changes

If this policy changes, the new version is published here with a new date, and the release notes of the version that changed it say so.

## 13. Contact

[contact address]. Please never send your access key, an API key or a password.
