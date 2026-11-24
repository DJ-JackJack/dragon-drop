# Going private: the plan

> **Draft, 2026-11-22**, for the person to decide on. Making the `dragon-drop` repository private before selling is the plan; this is what
> breaks when it happens, and the order that avoids leaving anyone stuck. Prepared 2026-11-22 (nothing switched on yet): build files are
> kept 1 and 7 days, `pnpm help-repo` makes the help repository's pages, and the move release needs only two addresses filled in (below).

## What stops working the moment it is private

1. **Updates for copies installed from the GitHub release page** (the person's own and friends'). Each copy asks the public release page for
   `latest.yml`; once private, that page is gone for them and Settings shows "Couldn't check for updates" at every start. The copy keeps working,
   but it never updates again. (itch.io copies are not affected: the itch app updates them.)
2. **Settings → Help**: its three links (questions and answers, ask a question, the setup guide) go to the repository, and so do the README's and
   the guides' links. Only people added to the repository can open them once it is private.
3. **Security reports**: GitHub's private vulnerability reporting, which `SECURITY.md` points to, exists only on public repositories.
4. **Free GitHub features for public repositories**: secret scanning and push protection (on private repositories they are a paid add-on),
   and branch and tag protection (on private repositories they need GitHub Pro, about $4 a month). Dependabot keeps working.
5. **Build minutes**: public repositories build for free. Private ones get a monthly allowance on the free plan, and Windows builds count double.
   A run of the checks is about 2 minutes on Linux and about 8 on Windows, so about 18 minutes of allowance per push, release or Dependabot
   pull request. That fits the free allowance at the current pace, but check GitHub's billing page: GitHub changed how it counts this in 2026.
   **Stored build files count too, and they are the bigger problem**: a private account gets 0.5 GB of Actions storage free, and every run keeps
   an installer and an itch copy (about 270 MB together) for 30 days. On 2026-11-22 `dragon-drop` held 114 of them, about 15.7 GB (free while
   public). The old repository showed what happens: it went private on 2026-11-20 holding 8.5 GB of build files, and GitHub warned two days later
   that the free 0.5 GB was used up and the rest would be billed. **Done 2026-11-22**: `retention-days` in `.github/workflows/desktop.yml` is 1 for the installer (only the same
   run's jobs need it) and 7 for the itch copy (long enough to push a release to itch.io). **Still to do before going private**: delete the old
   build files (Actions, each run's Artifacts, or `gh api -X DELETE` on each one); the ones made before the change keep their 30 days.
6. **Old releases**: the public release pages of 0.1.8 onwards disappear with the repository. The **signpost** repository (the old name,
   public) keeps its one release, v0.1.9, with a free installer anyone can download. That copy updates to `dragon-drop`, which then fails as in 1.

## Decisions first (the person's)

- **Where updates come from after the move.** Recommended: **itch.io only**. Buyers install through the itch app, which updates them, or
  download from the page by hand. Friends with a GitHub copy get a free itch.io download key (itch lets the seller make them).
  *Optional:* the itch copy could say in Settings when a newer version is on itch.io. itch has an address that gives a page's latest version, but
  it is undocumented and only works once the page is public, so treat it as a nice extra and never as the only way to update.
  The other choices are worse: a public repository holding only installers gives the paid program away, and an update server with licence keys is
  a project of its own.
- **Where buyers ask for help.** Two good options:
  - **A small public help repository** (`dragon-drop-help`, say) holding only the questions and answers, the setup guide, the privacy policy and
    `SECURITY.md`, with the issue forms. The links in the app just change address, private vulnerability reporting keeps working there, and it
    can be shown as a website (GitHub Pages) for free. No code goes in it, ever. **Recommended**, because everything that exists keeps working.
  - **The itch.io page's community** (a forum on the game's page; buyers already have itch accounts), plus an email address for security
    reports. Less to look after, but the guides then have to live on the itch page.
  Either way, an email address for security reports and privacy questions is worth having.
- **GitHub Pro** (about $4 a month) for branch and tag protection on the private repository, and a larger build allowance. Optional, but the
  release pipeline is what ships code to buyers.
- **The signpost's v0.1.9 release**: leave it (old copies can still reach 0.1.9, and anyone can download that free 0.1.9), or delete it
  (copies older than 0.1.8 then stay where they are; these are friends' copies). Recommended: delete it once friends are on the itch copy.

## The order

1. **Set up the new help place** (the help repository or the itch community) and put the guides and the privacy policy there. For a help
   repository: create it on GitHub (public), then `pnpm help-repo <a folder> --repo https://github.com/<name>/dragon-drop-help --store
   <the itch page>` writes its pages (the questions and answers, the setup guide without the parts for running from the code, map files,
   formats, models, privacy policy, licence agreement, security page, a README and the issue forms) with every link moved off the code
   repository; it stops if one is left. Read them through, commit them there, and switch on private vulnerability reporting in that
   repository. Run it again whenever a guide changes.
2. **Release one last public version, "the move", from the public repository.** In it:
   - Settings → Help and updates on a GitHub copy says that Dragon Drop has moved, with a button to the new page, and no longer checks GitHub (so no
     error message once the repository is private). The program keeps working as it is. **Ready: set `MOVED_TO` in `apps/desktop/main.cjs`
     to the itch page's address** (tried 2026-11-22 in a development run with `DRAGON_DROP_MOVED_TO`).
   - Settings → Help points at the new help place. **Ready: set `HELP_REPO` in `apps/editor/src/helpLinks.ts`** (or, for the itch community,
     put its addresses in `HELP_LINKS`). The issue forms' `config.yml` is moved by `pnpm help-repo`.
   - The questions and answers say where updates come from now.
   - `SECURITY.md` says where to report from now on.
3. **Wait** until the person's own copy and the friends' copies show that version (Settings → Help and updates), and give friends their itch keys.
4. **Make `dragon-drop` private** (Settings → General → Danger zone → Change visibility). Then:
   - Releases still happen, as private GitHub releases: they are where the itch copy comes from (`docs/ITCH.md`). The workflow could push to
     itch.io by itself with butler (it needs an itch API key as a repository secret): worth doing then.
   - `RELEASING.md`'s "Every installed copy reads that `latest.yml`" stops being true: rewrite that guide for itch.
   - Keep repeating the secret scan before releases (push protection is off on a private repository on the free plan).
5. **The signpost**: delete its release if that was the decision. Never push anything else to it.
6. **The help links and the itch page** are checked from a browser that isn't signed in to GitHub.

## What doesn't change
- Maps, settings and the program on every PC. Nobody loses anything; GitHub copies only stop updating.
- The third-party licence notices ship inside the program, as now.
- A licence for the code isn't needed once nobody else can see it, but buyers still need an EULA (`SELLING.md`, Legal and business).
