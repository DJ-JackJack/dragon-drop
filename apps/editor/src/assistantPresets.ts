/**
 * The Settings → AI assistant choices: a name, the start command it fills in, and what that assistant's command-line tool needs to run, in a DM's words (its own
 * sign-in, and whether that is free, part of the company's app subscription, or paid for separately). Checked against each company's own pages in November 2026
 * (docs/SETUP-WINDOWS.md §6b has the same table); plans change, so Settings says where to look. A test keeps this list in step with the assistants the desktop app
 * connects (apps/desktop/assistants.cjs).
 */
const OLLAMA_NEEDS = "It runs on Ollama's models instead of the company's: free local models on your own PC (a good coding model needs a strong graphics card), or Ollama's cloud models with an Ollama account (pay as you go, or a monthly plan).";

export const ASSISTANT_PRESETS: readonly [label: string, command: string, needs: string][] = [
  ["Claude Code", "", "A paid Claude plan (Pro, Max or Ultra: the same subscription as the Claude app; Team and Enterprise too), or an Anthropic Console account billed by use. The free Claude plan doesn't include Claude Code."],
  ["Codex", "codex", "Sign in with a ChatGPT account: every ChatGPT plan includes it, the free one too, with usage limits that depend on the plan. An OpenAI API key, billed by use, works as well."],
  ["Gemini CLI (API key)", "gemini", "A Gemini API key from Google AI Studio, billed by use (or a business Gemini Code Assist licence). Since June 2026 a personal Google sign-in and the Google AI Pro and Ultra plans no longer work here."],
  ["OpenCode", "opencode", "The program is free and open source; the AI comes from what you connect to it: a few free models from OpenCode itself, OpenCode's paid plans, an API key, or a ChatGPT Plus/Pro or GitHub Copilot account you already have. Don't connect a Claude or Google AI subscription to it: Anthropic and Google forbid using those in other tools and have suspended accounts over it."],
  ["Muse Code", "muse", "Its own account at dev.meta.ai: a Muse Code subscription (Accounts Center, Subscriptions, Muse Code) or pay as you go with a Meta API key. A Muse app plan doesn't include it, and there is no free use."],
  ["Claude Code via Ollama", "ollama launch claude", OLLAMA_NEEDS],
  ["Codex via Ollama", "ollama launch codex", OLLAMA_NEEDS],
  ["OpenCode via Ollama", "ollama launch opencode", OLLAMA_NEEDS],
];

/** When the lines above were checked, said under them in Settings. */
export const ASSISTANT_NEEDS_CHECKED = "November 2026";
