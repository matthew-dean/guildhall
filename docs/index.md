---
layout: home
title: GuildHall
titleTemplate: A multi-agent OS for software projects

hero:
  name: GuildHall
  text: A multi-agent OS for software projects.
  tagline: One or more LLM agents work a codebase for hours — writing specs, coding, reviewing, gating each other — without asking you for anything until they have to.
  actions:
    - theme: brand
      text: Quick start
      link: /guide/quick-start
    - theme: alt
      text: Core concepts
      link: /guide/concepts
    - theme: alt
      text: View on GitHub
      link: https://github.com/anthropics/guildhall

features:
  - icon: 🎚️
    title: Lever-based policy
    details: Every operational knob is a named lever with an enumerated set of positions, persisted in <code>memory/agent-settings.yaml</code> with full provenance.
    link: /subsystems/levers
    linkText: Lever system
  - icon: 🏛️
    title: Guilds of experts
    details: Specialists, engineers, designers, and overseers — each a persona with principles, rubric, and deterministic checks.
    link: /subsystems/guilds
    linkText: Guilds
  - icon: 🔁
    title: Persistent, resumable
    details: Every agent's conversation is snapshotted to disk. Close your laptop; they pick up where they left off.
    link: /subsystems/sessions
    linkText: Sessions
  - icon: 🌳
    title: Git-native fanout
    details: Tasks run in parallel in isolated git worktrees. Merge policy is a lever, not a convention.
    link: /levers/worktree-isolation
    linkText: Worktree isolation
  - icon: 🔌
    title: Provider-agnostic
    details: Claude, OpenAI-compatible, Codex, local llama.cpp / LM Studio. Model assignment is per role.
    link: /subsystems/providers
    linkText: Providers
  - icon: 🛠️
    title: Extensible
    details: MCP servers, hooks, skills, custom guilds. Every extension point has a typed schema.
    link: /subsystems/mcp
    linkText: Extension points
---

## At a glance

```
   ┌──────────────────────────── your project ───────────────────────────┐
   │                                                                     │
   │   guildhall.yaml        memory/                                     │
   │   (coordinators,        ├── TASKS.json          ← the work queue    │
   │    models, ignore)      ├── agent-settings.yaml ← every lever       │
   │                         ├── sessions/           ← resumable state   │
   │                         └── transcripts/        ← full audit trail  │
   │                                                                     │
   │   .guildhall/config.yaml       (local provider creds; gitignored)   │
   └─────────────────────────────────────────────────────────────────────┘
                                      │
              ┌───────────────────────┼────────────────────────┐
              ▼                       ▼                        ▼
      ╭───────────────╮      ╭────────────────╮       ╭────────────────╮
      │  Spec Agent   │ ───▶ │  Coordinators  │  ───▶ │ Workers (N)    │
      │  (intake)     │      │  (per-domain)  │       │ in worktrees   │
      ╰───────────────╯      ╰────────────────╯       ╰────────┬───────╯
                                      ▲                        │
                                      │                        ▼
                             ╭────────┴───────╮        ╭───────────────╮
                             │ Gate-checkers  │ ◀──── │   Reviewers    │
                             │ (deterministic)│        │   (LLM/rules) │
                             ╰────────────────╯        ╰───────────────╯
```
