# The AI companies' terms, read for selling Dragon Drop

Read 2026-11-22 for `SELLING.md` ("each provider's terms read for a commercial app"). This is a summary to act on and to show a lawyer, not legal
advice. These terms change often (Anthropic's and Google's changed several times in 2026), so read them again just before launch.

## What Dragon Drop does with an assistant

The same for every company, and it decides which parts of their terms matter:

- Dragon Drop **does not include** any assistant. The buyer installs it (for Claude Code, Dragon Drop's button runs Anthropic's own installer),
  and signs in to it in its own sign-in, with their own account and plan. Dragon Drop never sees or stores that sign-in.
- Dragon Drop **starts the company's own, unmodified program** in a terminal panel, the way an editor's built-in terminal does, and the buyer
  types to it. It doesn't run it in the background and doesn't send prompts to it for the buyer (the one exception: the Ask box types the buyer's
  own question, with where their selection is, when the buyer presses it).
- Dragon Drop is an **MCP server** (a standard way to give an assistant tools): it writes the assistant's project settings file so the
  assistant finds the map tools. Every assistant here supports MCP servers as a documented feature.
- Dragon Drop **doesn't sell or pass on AI use**: each buyer pays their own company. The in-window chat uses the buyer's own Anthropic API key.

## Company by company

| Company and program | What the terms say that matters here | Risk | What to do |
|---|---|---|---|
| **Anthropic**: Claude Code, the in-window chat | Read 2026-11-18 (`SELLING.md`). Since February 2026 a Claude subscription may be used only in Anthropic's own programs, not through other tools that take its sign-in; Dragon Drop runs the official Claude Code, which is allowed. Running Claude Code inside a product needs the Commercial Terms accepted. | Low, once the two open steps are done | Email Anthropic's sales and accept the Commercial Terms (`SELLING.md`). Never suggest OpenCode or another tool with a Claude subscription. |
| **OpenAI**: Codex | Codex is open source (Apache 2.0). Signing in with ChatGPT puts the use under the ChatGPT Terms of Use (or the API agreement with an API key). OpenAI's own help suggests running the Codex program in an editor's terminal for editors it has no add-on for, which is what Dragon Drop does. Brand rules: no implied endorsement, no logos, no OpenAI model names in a product's name. | Low | Name it in plain text only ("works with Codex"). |
| **Google**: Gemini CLI with an API key | The Gemini API is meant for building with; the buyer uses their own key from AI Studio. On the free tier Google may use prompts to improve its products. Since June 2026 keys must be restricted to the Gemini API (AI Studio's keys are). | Low | Nothing new. The privacy policy already says training depends on the buyer's plan. |
| **Google**: Antigravity CLI | **The terms forbid using the service "in connection with products not provided by us"**, and say that using other software or tools to reach it is a breach that can get the person's Antigravity and Gemini CLI accounts suspended. Since February 2026 Google has suspended many accounts over tools that took Antigravity's sign-in. Forum answers differ on whether starting Google's own `agy` from another program is covered: one moderator read it narrowly (only tools that take the sign-in), Google staff have said that wrapping `agy` for other tools isn't permitted and pointed to API keys, and Google says it gives no legal interpretations there. Nothing official says a program like Dragon Drop is fine. | **High: the penalty falls on the buyer's Google accounts** | **Recommended:** before selling, take Antigravity out of the Settings choices (anyone can still type `agy` as their own command), point Google users to Gemini CLI with an API key, and ask Google in writing (antigravity-support@google.com, or the Antigravity forum) whether Dragon Drop's setup is allowed. Bring it back only on a written yes. The person decides. |
| **Meta**: Muse Code | Its acceptable use policy has nothing against working with an MCP server. It asks for human oversight and confirmation before consequential actions, which the Allow box gives. On Muse Code's cheapest plan Meta uses the prompts to improve its models. The "Terms of Service" link on Muse Code's page goes to Meta's general policy centre; the Meta Model API Terms of Service themselves are still to read. | Low, probably | Read the Meta Model API Terms of Service before launch. |
| **OpenCode** (open source, MIT) | OpenCode has no terms of its own for this; the terms that apply are those of whatever the buyer connects to it. Anthropic forbids connecting it with a Claude subscription, and Google with an Antigravity or Google AI sign-in, and both have blocked or suspended accounts over that. | Low for Dragon Drop, real for buyers who connect the wrong account | Add to OpenCode's line in Settings: "Don't connect it with a Claude or Google AI subscription: Anthropic and Google forbid that and have suspended accounts." |
| **Ollama** (open source, MIT) | Local models run on the buyer's PC under each model's own licence; Ollama's cloud models are under Ollama's terms. | Low | Nothing. |

## Names and logos

Every company forbids implying that it endorses a product. So the store page and the app name the assistants in plain text ("works with
Claude Code, Codex, Gemini CLI, OpenCode and Muse Code"), never with their logos, and no company's name is part of Dragon Drop's name or
pictures. This is already true of the app; `STORE-PAGE.md` follows it.

## Sources (read 2026-11-22)

- Google Antigravity's Additional Terms of Service: antigravity.google/terms
- Google AI Developers Forum, Antigravity category: the thread "Is invoking the official Antigravity CLI (agy --print) from a third-party developer
  tool an acceptable use?" and related threads on account suspensions
- OpenAI Help Center, Codex articles (which terms apply; running the Codex program in an editor's terminal), and openai.com/brand
- Meta Model API Acceptable Use Policy: dev.meta.ai/legal/acceptable-use-policy
- Reports of Anthropic's February 2026 change for subscriptions in other tools (The Register, 2026-02-20, and others); Anthropic's own
  legal and compliance page for Claude Code (read 2026-11-18)
