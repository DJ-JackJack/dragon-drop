# The AI companies' terms, read for selling Dragon Drop

Read 2026-11-22 for `SELLING.md` (Meta's Model API terms and Anthropic's Claude Code page read again the same day, after the first draft) ("each provider's terms read for a commercial app"). This is a summary to act on and to show a lawyer, not legal
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
| **Anthropic**: Claude Code, the in-window chat | Read again 2026-11-22, no change in substance. The Claude Code legal page allows an end user signing in to the unmodified Claude Code with their own subscription, "including where a platform hosts Claude Code". Preinstalling or running Claude Code in a product needs the **Commercial Terms** accepted, with the program unmodified, no sign-in method removed, and no paying for or reselling the users' Claude use. No third party may offer claude.ai login or handle its sign-ins. Products may say in plain text that they run Claude Code, but may not use the Claude Code or Anthropic names or logos in their name or logo. Nothing on the page covers starting it in a terminal panel, writing its hooks, `--mcp-config`, or typing a question for the user (the Ask box): that is what the email asks. Anthropic's consumer terms forbid reaching the service by "automated or non-human means" except with an API key; the Ask box types only what the buyer wrote, when they press it, but it is worth asking. Commercial Terms effective 2025-06-17; Usage Policy effective 2026-11-12. | Low, once the two open steps are done | Send the email in `ANTHROPIC-EMAIL.md` and accept the Commercial Terms (`SELLING.md`). Never suggest OpenCode or another tool with a Claude subscription. |
| **OpenAI**: Codex | Codex is open source (Apache 2.0). Signing in with ChatGPT puts the use under the ChatGPT Terms of Use (or the API agreement with an API key). OpenAI's own help suggests running the Codex program in an editor's terminal for editors it has no add-on for, which is what Dragon Drop does. Brand rules: no implied endorsement, no logos, no OpenAI model names in a product's name. | Low | Name it in plain text only ("works with Codex"). |
| **Google**: Gemini CLI with an API key | The Gemini API is meant for building with; the buyer uses their own key from AI Studio. On the free tier Google may use prompts to improve its products. Since June 2026 keys must be restricted to the Gemini API (AI Studio's keys are). | Low | Nothing new. The privacy policy already says training depends on the buyer's plan. |
| **Google**: Antigravity CLI | **The terms forbid using the service "in connection with products not provided by us"**, and say that using other software or tools to reach it is a breach that can get the person's Antigravity and Gemini CLI accounts suspended. Since February 2026 Google has suspended many accounts over tools that took Antigravity's sign-in. Forum answers differ on whether starting Google's own `agy` from another program is covered: one moderator read it narrowly (only tools that take the sign-in), Google staff have said that wrapping `agy` for other tools isn't permitted and pointed to API keys, and Google says it gives no legal interpretations there. Nothing official says a program like Dragon Drop is fine. | **High: the penalty falls on the buyer's Google accounts** | **Recommended:** before selling, take Antigravity out of the Settings choices (anyone can still type `agy` as their own command), point Google users to Gemini CLI with an API key, and ask Google in writing (antigravity-support@google.com, or the Antigravity forum) whether Dragon Drop's setup is allowed. Bring it back only on a written yes. The person decides. |
| **Meta**: Muse Code | Read 2026-11-22: the **Meta Model API Terms of Service** (last updated 2026-10-09; they govern Muse Code subscriptions too, with Meta's Subscription Terms) and the acceptable use policy. The terms **allow "Integrated Products"**: software that lets end users reach Meta's services. They forbid bundling or changing Meta's downloadable programs, sharing keys or sign-ins, and using a subscription's sign-in outside Muse Code; Dragon Drop does none of these (the buyer installs Muse Code from Meta and signs in themselves). MCP servers are a documented Muse Code feature, with Meta's warning to connect only servers you trust (they run outside its sandbox). The acceptable use policy asks for human oversight and confirmation before consequential actions (the Allow box) and that products tell users their known risks and limits. **Muse Code subscriptions start in "Contributor mode"**: Meta may train on what is sent unless it is turned off (`/settings`, Contributor mode, per PC); Meta asks that nothing sensitive or confidential is sent in that mode. Users must be **18 or over**. An Integrated Product must have a privacy policy, and must require its users to follow Meta's terms. No Meta names or marks may be used beyond plain text. | Low | Done in the drafts: the privacy policy says Contributor mode is on by default and how to turn it off; the EULA has buyers follow each assistant's terms and age limits. Not read word for word: the terms' last sections and exhibits (the page was too long), and Meta's Subscription Terms. |
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
- Meta Model API Acceptable Use Policy: dev.meta.ai/legal/acceptable-use-policy; Meta Model API Terms of Service (last updated 2026-10-09):
  dev.meta.ai/legal/terms-of-service; Muse Code subscriptions, MCP and hooks, sign-in: dev.meta.ai/docs/muse-code/subscriptions, /extending, /auth
- Reports of Anthropic's February 2026 change for subscriptions in other tools (The Register, 2026-02-20, and others); Anthropic's own
  legal and compliance page for Claude Code (read 2026-11-18 and again 2026-11-22: code.claude.com/docs/en/legal-and-compliance), the Agent
  SDK overview, the Commercial Terms (anthropic.com/legal/commercial-terms), the Consumer Terms (anthropic.com/legal/consumer-terms) and the Usage
  Policy (anthropic.com/legal/aup)
