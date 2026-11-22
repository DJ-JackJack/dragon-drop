/**
 * Where a person finds help: the questions and answers (docs/FAQ.md), the place to ask (the issue forms, .github/ISSUE_TEMPLATE) and the setup guide.
 * Shown in Settings → Help.
 *
 * While the code repository is public, they are its own pages. Before it goes private (docs/GOING-PRIVATE.md), set HELP_REPO to the public
 * help repository that `pnpm help-repo` fills: its pages have the same names at its top level. (If buyers ask on the itch.io page instead,
 * put those addresses in HELP_LINKS directly.)
 */
const HELP_REPO: string | null = null; // for example "https://github.com/<name>/dragon-drop-help"
const CODE_REPO = "https://github.com/DJ-JackJack/dragon-drop";

export const HELP_LINKS = HELP_REPO
  ? { faq: `${HELP_REPO}/blob/main/FAQ.md`, ask: `${HELP_REPO}/issues/new/choose`, guide: `${HELP_REPO}/blob/main/SETUP-WINDOWS.md` }
  : { faq: `${CODE_REPO}/blob/main/docs/FAQ.md`, ask: `${CODE_REPO}/issues/new/choose`, guide: `${CODE_REPO}/blob/main/docs/SETUP-WINDOWS.md` };
