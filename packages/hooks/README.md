# @guildhall/hooks

Internal package — **not published to npm.**

Hook protocol: `SESSION_START`, `SESSION_END`, user-prompt hooks. Lets external processes observe or gate the orchestrator at well-defined lifecycle points.

This lives inside the [GuildHall](../../README.md) monorepo. It's inlined into the published `guildhall` CLI bundle at build time — install GuildHall itself to use it.

```bash
npm install guildhall
```

See the [root README](../../README.md) for what GuildHall is and why you'd want it.
