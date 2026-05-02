---
title: Architecture
---

# Architecture

GuildHall is a layered system. Each layer has a single job; layers above build on layers below.

```
┌─────────────────────────────────────────────────────────────────┐
│ Web UI (Svelte)                              backend-host wire  │
├─────────────────────────────────────────────────────────────────┤
│ Runtime — orchestrator, reviewer fanout, remediation, intake    │
├─────────────────────────────────────────────────────────────────┤
│ Agents (spec / coordinator / worker / reviewer / gate-checker)  │
│ Guilds — personas, rubrics, deterministic checks                │
├─────────────────────────────────────────────────────────────────┤
│ Runtime bundle — glue assembling engine + tools + sessions      │
│ Engine — multi-turn LLM loop, tools, permissions, compaction    │
├─────────────────────────────────────────────────────────────────┤
│ Protocol — wire types  │ Tools  │ Skills  │ Hooks  │ MCP        │
├─────────────────────────────────────────────────────────────────┤
│ Providers — auth'd CLIs / OpenAI-compatible / Anthropic-compat │
├─────────────────────────────────────────────────────────────────┤
│ Core — Task, Gate, Goal, DesignSystem, models, workspace        │
│ Config — load/merge global + project + workspace YAML           │
│ Levers — the policy system (schema + storage + defaults)        │
│ Sessions — snapshot + restore agent conversations               │
│ Engineering defaults — best-practice system-prompt injections   │
└─────────────────────────────────────────────────────────────────┘
```

## Where to start reading

- Start with **[core](./core)** for data models (Task, Gate, Goal, DesignSystem).
- Then **[engine](./engine)** for the multi-turn LLM loop and tool protocol.
- Then **[runtime](./runtime)** for the orchestrator state machine.
- **[levers](./levers)** is the policy surface that threads through everything.

## Navigation

Use the sidebar to jump straight to any subsystem. Each page lists:

- **Purpose** — one-paragraph intent.
- **Public API** — exported types and functions users of that subsystem touch.
- **Key files** — the important files and what each does.
- **Related levers / config** — where behavior is tunable.
