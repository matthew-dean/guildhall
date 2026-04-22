# @guildhall/runtime

Internal package — **not published to npm.**

The orchestrator. Owns the tick loop, the task queue (`memory/TASKS.json`), fanout dispatch, worktree creation & cleanup, merge dispatch, session snapshot & restore, and the `guildhall` CLI entrypoint.

This lives inside the [GuildHall](../../README.md) monorepo. It's inlined into the published `guildhall` CLI bundle at build time — install GuildHall itself to use it.

```bash
npm install guildhall
```

See the [root README](../../README.md) for what GuildHall is and why you'd want it.
