<div align="center">

# GuildHall

**A multi-agent operating system for software projects.**

One or more LLM agents work a codebase for hours at a stretch — writing specs, coding, reviewing, and gating each other — without asking you for anything until they have to. Every decision traces to a named lever in `memory/agent-settings.yaml`.

[![npm](https://img.shields.io/npm/v/guildhall.svg)](https://www.npmjs.com/package/guildhall)
[![node](https://img.shields.io/node/v/guildhall.svg)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-FLL%20v1.2-blue.svg)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-1047%20passing-brightgreen.svg)](#tests)

</div>

---

## The pitch

Most "AI coding" tools are chat-shaped. GuildHall isn't.

You give it a project directory. It spins up a guild of agents — a **spec writer**, **coordinators** who own domains, **workers**, **reviewers**, **gate-checkers** — and they trade tasks through a persistent queue in `memory/TASKS.json`. You can close your laptop. They keep going. You can interrupt, edit the queue, change a lever, and they pick up from the next tick.

The metaphor: a medieval guildhall, where masters, journeymen, and apprentices work under shared standards, and admission to each tier requires producing a verified masterpiece.

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

## Quick start

```bash
# Inside the project you want the guild to work on:
npx guildhall init
```

That's it. `init` writes a `guildhall.yaml` and pops open a dashboard at <http://localhost:7842/setup> that walks through:

1. **Identity** — workspace name + slug
2. **Provider** — Claude (via Claude Code CLI), Codex (via Codex CLI), local `llama.cpp` / LM Studio, or paste-in Anthropic / OpenAI API keys
3. **Launch** — either kick off the agent-guided bootstrap (the meta-intake agent interviews you about the codebase and drafts coordinators), or skip to the dashboard and hand-edit the YAML

Everything the wizard sets is editable later from the Settings page.

## What makes it different

### 🎚️ Lever-based policy model — "deterministic magic"

Every operational knob is a **named lever** with an enumerated set of positions, persisted in `memory/agent-settings.yaml`. No hidden hardcoded defaults. When the system behaves a certain way, you can trace it to a lever position and know exactly who set it (`system-default`, a specific user, or a coordinator at a specific time).

The *magic* comes from the Spec Agent inferring levers from a natural conversation about your project. The *determinism* comes from every lever being explicit, auditable, and overridable.

Examples of levers you'll actually feel:

| Lever | Effect |
|---|---|
| `concurrent_task_dispatch: fanout_4` | Four tasks run in parallel, each in their own git worktree |
| `merge_policy: ff_only_with_push` | Successful tasks fast-forward into `main` and push to origin |
| `completion_approval: gates_sufficient` | No human approval needed — gate-checkers are the final word |
| `spec_completeness: emergent` | Tasks advance to `ready` without a full upfront spec |
| `reviewer_mode: llm_with_deterministic_fallback` | LLM reviews first; if it whiffs, run the deterministic rule set |

See [SPEC.md §2.1](./SPEC.md) for the full table.

### 🏗️ Persistent, resumable, auditable

Every tick writes to disk. Kill the process; start it again; it resumes mid-turn where it left off. Every task carries its full history: spec, review verdicts, gate results, escalations, merge records. You can replay a run from the transcripts.

### 🪢 Git-native fanout

With `concurrent_task_dispatch: fanout_N` + `worktree_isolation: per_task`, the orchestrator creates one git worktree per task on a `guildhall/task-<id>` branch, dispatches a worker into each with a unique `GUILDHALL_SLOT` / `GUILDHALL_PORT_BASE`, and merges per `merge_policy` when each finishes.

### 🤝 Provider-agnostic

Doesn't care whether you run frontier Claude, Codex via OAuth, or a llama.cpp server on localhost. The same agent guild works with all of them — the quality tradeoff is explicit, not hidden behind a "sorry, that model isn't supported."

## Commands

```
guildhall init [path]              Launch dashboard + browser-based setup
guildhall serve [path]             Start only the dashboard (project must already be initialized)
guildhall run [id|path]            Run the orchestrator headlessly
guildhall intake "<ask>" --domain  Queue a new task from the CLI
guildhall help                     Full command list
```

## Repo layout

GuildHall is a single npm package (`guildhall`) with a flat source tree. `src/` is split into modules, each one reachable from the others only through its `index.ts` — the `@guildhall/<module>` path alias. A per-module dep-cruiser rule forbids relative imports that cross a module boundary, so the internal API surface stays explicit without the overhead of a workspace.

```
src/
├── core/               ← task/queue/status types, Zod schemas
├── protocol/           ← provider-agnostic message & event shapes
├── engine/             ← the inner loop: tools, tool_result plumbing, resume
├── sessions/           ← snapshot & restore for mid-turn crashes
├── compaction/         ← conversation-history compression
├── config/             ← guildhall.yaml loader / validator
├── levers/             ← agent-settings.yaml schema + defaults
├── providers/          ← Claude-OAuth / Codex-OAuth / LM-Studio / API-key adapters
├── skills/             ← bundled skill markdown (commit, debug, plan, review, …)
├── hooks/              ← SESSION_START / SESSION_END / user-prompt hooks
├── tools/              ← every tool the agents can call (Read/Edit/Write/Bash/…)
├── mcp/                ← MCP client for out-of-process tool servers
├── agents/             ← agent definitions (spec, worker, reviewer, coordinator, …)
├── backend-host/       ← OHJSON-framed event wire (for UIs)
├── runtime/            ← orchestrator + CLI entrypoints
└── runtime-bundle/     ← assembles engine + agents + providers into one artifact
```

Boundaries are enforced by [`.dependency-cruiser.cjs`](./.dependency-cruiser.cjs) (`pnpm lint:deps`) rather than by splitting into publishable packages.

## Tests <a id="tests"></a>

```
pnpm typecheck
pnpm test
pnpm lint:deps   # module-boundary check
```

Current gate: **1047 tests, 73 test files, all passing.** The `runtime/` module alone has 475 tests covering the orchestrator, fanout dispatch, worktree lifecycle, session resume, and the full lever matrix.

## Publishing

```bash
# Dry-run the whole pipeline (bumps the manifest, runs gates, packs the tarball, reverts):
pnpm release:dry 0.3.0

# Actual release: bumps package.json, runs typecheck + lint:deps + tests, builds,
# publishes guildhall to npm, commits, tags v0.3.0.
pnpm release 0.3.0
```

See [scripts/publish.mjs](./scripts/publish.mjs) for what it actually does.

## Contributing

This repo is accepting PRs, but the bar is spec-first: all non-trivial changes update [SPEC.md](./SPEC.md) before implementation. Every lever addition requires a row in §2.1 and a referencing FR. Every port from [OpenHarness](https://github.com/HKUDS/OpenHarness) gets an attribution header (upstream path + SHA + explicit changes).

## License

[Fair Labor License (FLL) v1.2](./LICENSE). Free for individuals and organizations that compensate their workers fairly; paid commercial license required otherwise. Evaluation use is free for 90 days.

---

<div align="center">
<sub>
Built on top of <a href="https://github.com/HKUDS/OpenHarness">OpenHarness</a> engine primitives.<br/>
Operational-model additions absorbed from the internal <code>linkcore</code> and <code>jess</code> prototypes.
</sub>
</div>
