# @guildhall/sessions

Internal package — **not published to npm.**

Session snapshot and restore. Lets an in-flight turn survive a process crash: the next `guildhall run` resumes where the previous one left off, including any dangling tool_result.

This lives inside the [GuildHall](../../README.md) monorepo. It's inlined into the published `guildhall` CLI bundle at build time — install GuildHall itself to use it.

```bash
npm install guildhall
```

See the [root README](../../README.md) for what GuildHall is and why you'd want it.
