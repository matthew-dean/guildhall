# @guildhall/runtime-bundle

Internal package — **not published to npm.**

Assembles the engine + agents + providers + hooks into one deployable runtime artifact, with session-resume plumbing so a `buildRuntime({ restoreSessionId })` call can pick up a crashed turn at its exact prior step.

This lives inside the [GuildHall](../../README.md) monorepo. It's inlined into the published `guildhall` CLI bundle at build time — install GuildHall itself to use it.

```bash
npm install guildhall
```

See the [root README](../../README.md) for what GuildHall is and why you'd want it.
