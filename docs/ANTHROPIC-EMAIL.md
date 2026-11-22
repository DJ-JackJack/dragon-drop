# The email to Anthropic (draft)

> **Draft, 2026-11-22**, for the person to send from their own address and keep the answer (`SELLING.md`, Anthropic). Fill in the `[...]`
> places.
>
> **Where to send it.** Claude Code's legal page (code.claude.com/docs/en/legal-and-compliance) points to "contact sales" for questions about
> offering Claude Code in a product. That link now opens claude.com/contact-sales, which says the sales team only takes large deals (500 seats
> and up) and offers a chat with an "account advisor" instead. Try that chat first, pasting the text below; if it can't answer, send it through
> Anthropic's support site (support.claude.com, "Contact us"). Keep whatever comes back, with the date.

---

**Subject:** Running the unmodified Claude Code inside a desktop map editor: is this setup allowed?

Hello,

I'm [name], and I make Dragon Drop, a Windows map editor for tabletop RPGs (world maps, cities and battlemaps). I plan to sell it on itch.io
from [month]. It works with Claude Code, and before selling I want to be sure the way it does so follows your terms. Here is exactly what it
does:

1. **It doesn't bundle Claude Code.** A "Set up Claude Code" button runs your official installer command, visibly, in a terminal inside the
   program.
2. **Each user signs in themselves**, in Claude Code's own sign-in, with their own Claude subscription or API key. Dragon Drop never sees,
   stores or passes on their sign-in or tokens, and offers no claude.ai login of its own.
3. **It runs the unmodified `claude` program** in a terminal panel inside its window (a pseudo-terminal, like an editor's built-in
   terminal). The user types to it.
4. It starts Claude Code with **`--mcp-config`** pointing to Dragon Drop's own **MCP server** on the same PC (localhost only, protected by a
   key made for each install), which gives Claude tools to read and edit the user's maps. Risky changes wait for the user's Allow.
5. It writes **Claude Code hooks** into the `.claude/settings.json` of its own workspace folder (keeping anything the user put there). The hooks
   tell Dragon Drop when Claude Code is idle. While it is idle, an **"Ask Claude about this"** box lets the user send a one-line question of
   their own (with where their selection is on the map) into the terminal, when they press it. It never types anything else and never types
   while Claude Code is busy or waiting for an answer.
6. Separately, an **in-window chat** uses the user's own Anthropic API key with the Messages API.
7. We don't pay for, resell or pass on anyone's Claude use. Neither "Claude" nor "Anthropic" is in the product's name or logo; the store page
   says in plain text that it works with Claude Code.

My questions:

1. Is this setup allowed for a paid product, including for users who sign in with a Pro or Max subscription?
2. Your legal page says running Claude Code in a product needs your Commercial Terms. Does that apply here, and if so, how do I accept them
   for my account ([the account's email or organisation])?
3. Is the "Ask Claude about this" box (typing the user's own question when they press it) fine?
4. Is there anything you'd like me to change?

Thank you,

[name]
[contact address]
[the store page's address, once it exists]
