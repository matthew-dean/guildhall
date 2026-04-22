# @guildhall/providers

Internal package — **not published to npm.**

Adapters that normalize model providers into the shared `@guildhall/protocol` envelope. Covers:

- **Claude via OAuth** (piggybacks on the Claude Code CLI credentials)
- **Codex via OAuth** (piggybacks on the Codex CLI credentials)
- **Local LM Studio / llama.cpp** (OpenAI-compatible base URL)
- **Anthropic API key** and **OpenAI API key** paste-in

This lives inside the [GuildHall](../../README.md) monorepo. It's inlined into the published `guildhall` CLI bundle at build time — install GuildHall itself to use it.

```bash
npm install guildhall
```

See the [root README](../../README.md) for what GuildHall is and why you'd want it.
