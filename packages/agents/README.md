# @guildhall/agents

Internal package — **not published to npm.**

Agent definitions — spec writer, coordinators, workers, reviewers, gate-checkers — each as a (system prompt + tool allowlist + model hint) triple that the orchestrator binds to a provider at tick time.

This lives inside the [GuildHall](../../README.md) monorepo. It's inlined into the published `guildhall` CLI bundle at build time — install GuildHall itself to use it.

```bash
npm install guildhall
```

See the [root README](../../README.md) for what GuildHall is and why you'd want it.
