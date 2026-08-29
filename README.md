<div align="center">

# GuildHall

**A local workspace where a guild of AI experts plans, builds, reviews, and finishes software work.**

[![npm](https://img.shields.io/npm/v/guildhall.svg)](https://www.npmjs.com/package/guildhall)
[![node](https://img.shields.io/node/v/guildhall.svg)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-FLL%20v1.2-blue.svg)](./LICENSE)

[Documentation](https://guildhall.cc/)

</div>

---

## What GuildHall is

Most agent tools give you a chat box, a pile of tools, and the vague
instruction to go be clever. GuildHall is for people who would rather **run the
work** than babysit a prompt loop.

GuildHall is a **local workspace for software projects**. It gives you a guided
process for handing work to a guild of specialists: coordinators, spec agents,
workers, reviewers, and gate-checkers. They do not just improvise forever.
GuildHall surveys the repo, drafts a blueprint, frames the work, assigns the
trade work, inspects the result, and records change orders when the plan needs
to move.

The UI is the point. You open GuildHall, attach a project folder, and work from
a real product surface instead of memorizing 1,000 CLI spells. The CLI exists,
but mostly for power users and automation. For everyone else, `guildhall serve`
is the friendly front door.

Under the hood, GuildHall runs as a **local service over your projects**.

The top level is a **Projects** view. Inside each project, GuildHall keeps the
blueprints, tasks, transcripts, settings, and live project state together.

## What it does

GuildHall helps with software work that benefits from explicit structure:

- survey a project and its existing plans
- draft and review task blueprints
- frame runnable work into a smaller active set
- implement changes as bounded trade work
- run inspections, reviews, and gates
- record change orders when reality changes the plan
- keep a durable audit trail of what happened

The core idea is simple:

- you describe the work
- GuildHall shapes it into a blueprint
- GuildHall routes it through the right guild roles
- you step in when judgment, clarification, or approval is needed

That structure is what makes it different from open-ended harnesses. GuildHall
is designed to **guide agents toward good results**, not just let them wander
around your repo in an infinite while loop and hope for character development.

It is also designed for **longer-running software tasks**, where work may need
to move through multiple agents, pauses, approvals, and retries without losing
the thread.

## What it is good at right now

Today, GuildHall has the strongest proof for **narrow, low-blast-radius
engineering tasks**:

- small cleanups
- focused fixes
- low-scope test or type follow-ups
- local repairs with clear acceptance criteria

That is the lane currently proven end to end, and the product is honest about
that.

GuildHall is still in **early development**. Ideas, feedback, issue reports,
and contributions are all very welcome.

It is best suited to coding-oriented models and inference providers that are
pretty good at **tool-calling** and **writing code**. It does **not** require
best-in-class expensive inference to be useful. You do not need to burn Codex-
or-Opus money just to get value out of it.

## Install

Recommended on macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/matthew-dean/guildhall/main/scripts/install.sh | sh
```

That command downloads the latest `guildhall-macos.tar.gz` asset from the
current GitHub Release and verifies it against the matching `.sha256` asset.
To install a specific release instead:

```bash
curl -fsSL https://raw.githubusercontent.com/matthew-dean/guildhall/main/scripts/install.sh | GUILDHALL_VERSION=0.13.1 sh
```

Also supported:

```bash
npm install -g guildhall
```

The npm path expects Node.js 22 or newer. The macOS installer bundles its own
Node runtime.

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
3. **Launch** — open the project shell and let GuildHall guide setup from there

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

- **Spec** — drafts the blueprint and clarifies open questions
- **Coordinator** — keeps the project or domain coherent
- **Worker** — performs bounded trade work against the accepted blueprint
- **Reviewer** — inspects the task from expert perspectives
- **Gate checker** — runs the deterministic completion bar

## Why it feels different

Most AI coding tools are still basically chat-shaped.

GuildHall is closer to a **software construction surface**:

- work is framed against a blueprint, not just a conversation transcript
- state persists to disk
- runs can continue beyond a single chat moment
- inspections, review, and gates are part of the workflow instead of an afterthought
- change orders make scope or sequencing shifts explicit
- decisions are exposed through explicit settings and levers

## Useful commands

```text
guildhall serve [path]    Start the local service if needed, then open GuildHall
guildhall start           Start the local service without opening the browser
guildhall open [path]     Open the running service
guildhall stop            Stop the local service
guildhall init [path]     Initialize one project directly
guildhall register <path> Register an existing initialized project
guildhall list            List registered projects
guildhall run [id|path]   Run the orchestrator headlessly
guildhall help            Full command list
```

For the full CLI reference, see [docs/cli/reference.md](./docs/cli/reference.md).

## Learn more

- [Documentation](https://guildhall.cc/)
- [Quick start](./docs/guide/quick-start.md)
- [How Guildhall builds](./docs/guide/how-guildhall-builds.md)
- [Introduction](./docs/guide/introduction.md)
- [Core concepts](./docs/guide/concepts.md)
- [CLI reference](./docs/cli/reference.md)
- [Workspace config reference](./docs/reference/workspace-config.md)
- [0.5.0 release note](./docs/releases/0.5.0.md)

## Contributing

This repo is spec-first for non-trivial changes:

- update the relevant design/spec material first
- keep behavioral changes explicit
- prefer narrow, test-backed changes over fuzzy rewrites

## License

[Fair Labor License (FLL) v1.2](./LICENSE)
