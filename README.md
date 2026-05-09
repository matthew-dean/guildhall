<div align="center">

# GuildHall

**A local service that helps agent teams work your software projects.**

[![npm](https://img.shields.io/npm/v/guildhall.svg)](https://www.npmjs.com/package/guildhall)
[![node](https://img.shields.io/node/v/guildhall.svg)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-FLL%20v1.2-blue.svg)](./LICENSE)

</div>

---

## What GuildHall is

GuildHall is not a chat tab and it is not a repo-local toy dashboard.

It runs as a **local service over your projects**. You open GuildHall, attach a
project folder, and let a team of agents work through tasks with explicit
stages, review, and gates.

The top level is a **Projects** view. Inside each project, GuildHall keeps the
queue, transcripts, settings, and live task state together.

## What it does

GuildHall helps with software work that benefits from a little structure:

- intake and shape tasks
- draft and review specs
- implement changes
- run reviews and gates
- keep a durable audit trail of what happened

The core idea is simple:

- you describe the work
- GuildHall routes it through the right agents
- you step in when judgment, clarification, or approval is needed

## What it is good at right now

Today, GuildHall has the strongest proof for **narrow, low-blast-radius
engineering tasks**:

- small cleanups
- focused fixes
- low-scope test or type follow-ups
- local repairs with clear acceptance criteria

That is the lane we have proven end to end, and the product is honest about
that.

## Install

Recommended on macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/matthew-dean/guildhall/main/scripts/install.sh | sh
```

Also supported:

```bash
npm install -g guildhall
```

## Quick start

Start GuildHall:

```bash
guildhall serve
```

That will:

- make sure the local GuildHall service is running
- open the web UI
- take you to the top-level **Projects** view

From there:

1. **Attach a project** by choosing an existing folder
2. If the folder already has `guildhall.yaml`, GuildHall registers it and opens it
3. If not, GuildHall opens it in an uninitialized state and walks you through setup inside the project shell

Setup covers:

1. **Identity** — project name and id
2. **Provider** — Claude Code CLI, Codex CLI, local OpenAI-compatible server, or API key
3. **Launch** — start with the dashboard or kick off bootstrap/meta-intake

## The model

Each project has durable local state on disk. The UI is a view over that state,
not the source of truth.

Typical files look like:

```text
<project>/
├── guildhall.yaml
├── .guildhall/
└── memory/
    ├── TASKS.json
    ├── agent-settings.yaml
    ├── sessions/
    └── transcripts/
```

At runtime, GuildHall coordinates a few core roles:

- **Spec** — shapes and clarifies work
- **Coordinator** — owns a domain and its tradeoffs
- **Worker** — implements changes
- **Reviewer** — checks the task from expert perspectives
- **Gate checker** — runs the deterministic completion bar

## Why it feels different

Most AI coding tools are still basically chat-shaped.

GuildHall is closer to a **project operations surface**:

- work is a queue, not a conversation transcript
- state persists to disk
- runs can continue beyond a single chat moment
- review and gates are part of the workflow instead of an afterthought
- decisions are exposed through explicit settings and levers

## Useful commands

```text
guildhall serve [path]    Start the local service if needed, then open GuildHall
guildhall start [path]    Start the local service without opening the browser
guildhall open [path]     Open the running service
guildhall stop            Stop the local service
guildhall init [path]     Initialize one project directly
guildhall run [id|path]   Run the orchestrator headlessly
guildhall help            Full command list
```

For the full CLI reference, see [docs/reference/cli.md](./docs/reference/cli.md).

## Learn more

- [Quick start](./docs/guide/quick-start.md)
- [Introduction](./docs/guide/introduction.md)
- [Core concepts](./docs/guide/concepts.md)
- [CLI reference](./docs/reference/cli.md)
- [Workspace config reference](./docs/reference/workspace-config.md)
- [0.5.0 release note](./docs/releases/0.5.0.md)

If you want the architecture and internal subsystem detail, the docs still have
that too:

- [Subsystems](./docs/subsystems/index.md)
- [Levers](./docs/levers/index.md)
- [Design notes](./docs/design/index.md)

## Contributing

This repo is spec-first for non-trivial changes:

- update the relevant design/spec material first
- keep behavioral changes explicit
- prefer narrow, test-backed changes over fuzzy rewrites

## License

[Fair Labor License (FLL) v1.2](./LICENSE)
