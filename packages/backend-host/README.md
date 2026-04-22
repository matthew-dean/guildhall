# @guildhall/backend-host

Internal package — **not published to npm.**

The OHJSON-framed event wire between the orchestrator and any UI subscribing to it. Encodes `task_transition`, `agent_turn_start`, tool-use events, etc. as single-line JSON with the `OHJSON::` prefix so a subscriber can parse the stream line-by-line.

This lives inside the [GuildHall](../../README.md) monorepo. It's inlined into the published `guildhall` CLI bundle at build time — install GuildHall itself to use it.

```bash
npm install guildhall
```

See the [root README](../../README.md) for what GuildHall is and why you'd want it.
