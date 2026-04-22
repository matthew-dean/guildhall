# @guildhall/engine

Internal package — **not published to npm.**

The inner turn loop: tool dispatch, `tool_result` plumbing, assistant↔tool message threading, mid-turn resume. This is the piece ported from [OpenHarness](https://github.com/HKUDS/OpenHarness) with attribution headers preserved on every ported file.

This lives inside the [GuildHall](../../README.md) monorepo. It's inlined into the published `guildhall` CLI bundle at build time — install GuildHall itself to use it.

```bash
npm install guildhall
```

See the [root README](../../README.md) for what GuildHall is and why you'd want it.
