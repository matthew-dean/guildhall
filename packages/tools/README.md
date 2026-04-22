# @guildhall/tools

Internal package — **not published to npm.**

Every tool GuildHall agents can call: `Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`, `TodoWrite`, and the rest. Each tool is a Zod schema + handler pair the engine dispatches per `tool_use` block.

This lives inside the [GuildHall](../../README.md) monorepo. It's inlined into the published `guildhall` CLI bundle at build time — install GuildHall itself to use it.

```bash
npm install guildhall
```

See the [root README](../../README.md) for what GuildHall is and why you'd want it.
