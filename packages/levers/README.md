# @guildhall/levers

Internal package — **not published to npm.**

The lever system — every operational knob GuildHall exposes is a named lever with an enumerated set of positions, persisted in `memory/agent-settings.yaml`. This package defines the schema, the defaults, and the loader. See [SPEC.md §2.1](../../SPEC.md) for the full lever inventory.

This lives inside the [GuildHall](../../README.md) monorepo. It's inlined into the published `guildhall` CLI bundle at build time — install GuildHall itself to use it.

```bash
npm install guildhall
```

See the [root README](../../README.md) for what GuildHall is and why you'd want it.
