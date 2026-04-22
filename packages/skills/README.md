# @guildhall/skills

Internal package — **not published to npm.**

Bundled skill markdown: `commit`, `debug`, `diagnose`, `plan`, `review`, `simplify`, `test`. These ship as static assets inside the published CLI bundle (at `dist/bundled/content/`) and load on demand when an agent invokes a skill.

This lives inside the [GuildHall](../../README.md) monorepo. It's inlined into the published `guildhall` CLI bundle at build time — install GuildHall itself to use it.

```bash
npm install guildhall
```

See the [root README](../../README.md) for what GuildHall is and why you'd want it.
