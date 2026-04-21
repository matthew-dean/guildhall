# Guildhall Pivot Plan

**Status:** v0.2 in progress
**Companion docs:** [SPEC.md](SPEC.md), [PORT-MAPPING.md](PORT-MAPPING.md)

## 1. Why we're pivoting

Forge v0.1 specced the right system and got ~60% of the data layer built, but the agent execution layer is stubbed — agents are Mastra prompt wrappers that don't actually drive tool loops end-to-end. Rather than build an agent loop from scratch, we port one from [OpenHarness](https://github.com/HKUDS/OpenHarness) (MIT, Python, Claude Code port, 10k+ stars, actively maintained).

**The insight:** Forge's spec → review → gate orchestration is the *opinion layer*, and OpenHarness's engine is the *execution layer*. They compose. Forge's orchestration is the spine. OH's agent loop is the muscle.

A second insight came up during design: the `exploring` phase — conversational spec-building as the first state of every task — unifies the "intake wizard" idea with Forge's spec-first rule and bounds human interaction to exactly one moment per task.

## 2. Architecture after the pivot

```
┌──────────────────────────────────────────────────────────────────┐
│  Guildhall orchestration (TypeScript, ours)                      │
│    exploring → spec_review → ready → in_progress → review        │
│                  → gate_check → done                             │
│    coordinator domains, mandates, CrossDomainRequest,            │
│    TASKS.json, MEMORY.md, DECISIONS.md, PROGRESS.md              │
│    memory/exploring/<task-id>.md                                 │
└─────────────────────────────┬────────────────────────────────────┘
                              │ invokes per lifecycle stage
┌─────────────────────────────▼────────────────────────────────────┐
│  Agent-loop primitives (TypeScript, ported from OpenHarness)     │
│    QueryEngine: conversation history + tool loop                 │
│    Permission modes (default / plan / full_auto)                 │
│    Context compaction (auto / manual / reactive)                 │
│    Session persistence (mid-turn resume)                         │
│    Skills registry, Hook executor, MCP client                    │
│    Structured event stream (OHJSON: → Guildhall wire protocol)   │
└──────────────────────────────────────────────────────────────────┘
```

Each of Guildhall's agent roles (Spec, Coordinator, Worker, Reviewer, Gate Checker) is a specialized invocation of the ported QueryEngine with role-specific prompt, tools, and skill set. OH's top-level orchestration (REPL, autopilot, swarm) is discarded — Guildhall's lifecycle replaces it.

## 3. What we keep / rewrite / drop

### Keep (Forge v0.1 → Guildhall)
- `packages/core/*` — data models (Task, Gate, Coordinator, workspace schemas). Solid.
- `packages/config/*` — workspace config loading, registry, guildhall.yaml parsing. Fully built.
- `packages/tools/*` — file, shell, task-queue, memory tools. Execution logic real, just needs rewiring.
- `guildhall.workspace.ts` (renamed from guildhall.workspace.ts) — Looma + Knit coordinator definitions.
- Memory layout (TASKS.json, MEMORY.md, DECISIONS.md, PROGRESS.md).

### Rewrite
- `packages/agents/*` — agent definitions become invocations of the ported QueryEngine, not Mastra Agent factories.
- `packages/runtime/orchestrator.ts` — close the feedback loop: parse agent responses, persist state transitions, run gates, enforce maxRevisions.
- `packages/runtime/context-builder.ts` — wire actual FS reads for MEMORY.md / PROGRESS.md / DECISIONS.md.

### Drop
- Mastra `Agent` class as the primary agent primitive. (Mastra's `createTool` wrapper may stay as a thin schema helper; revisit after protocol port.)
- OH's top-level REPL, autopilot, and swarm entry points.
- OH's multi-channel bots (Slack/Telegram/Discord/Feishu) — not in scope.
- OH's React/Ink TUI frontend — future Tauri GUI replaces it.

### Add (new)
- `packages/protocol/*` — ported OHJSON: wire protocol and stream events. Foundation for all engine ↔ frontend comms.
- `packages/engine/*` — ported QueryEngine, tool registry, permission checker, compaction.
- `packages/skills/*` — skill registry + loader.
- `packages/hooks/*` — hook executor.
- `packages/sessions/*` — session persistence (mid-turn resume).
- Spec Agent in `exploring` mode — conversational spec authoring (no OH equivalent; this is ours).
- `memory/exploring/` per-task transcript log.
- `NOTICE` at repo root attributing OpenHarness + Claude Code.

## 4. Phased roadmap

Each phase ends in a runnable state and mergeable PR(s).

### Phase 1 — Protocol foundation (this week)
- [x] Rename project dir + npm scope → `@guildhall/*`
- [ ] Port `protocol.py` + `stream_events.py` → `@guildhall/protocol` Zod schemas
- [ ] Port `messages.py` → `@guildhall/protocol` (ConversationMessage, ContentBlock discriminated union)
- [ ] Port associated tests
- **Exit:** `pnpm typecheck` + `pnpm test` green on `@guildhall/protocol`

### Phase 2 — Engine core
- Port `engine/messages.py`, `engine/query_engine.py`, `engine/query.py` → `@guildhall/engine`
- Port `runtime.py` (RuntimeBundle assembly) adapted to Guildhall's config
- Port session storage (`services/session_storage.py`) → `@guildhall/sessions`
- **Exit:** A single-turn agent invocation runs end-to-end (prompt → tool call → response) emitting structured events

### Phase 3 — Extensibility
- Port skills (`skills/`) → `@guildhall/skills`
- Port hooks (`hooks/`) → `@guildhall/hooks`
- Port MCP client (`mcp/`) → `@guildhall/mcp`
- **Exit:** Skills load from disk; hooks fire on lifecycle events

### Phase 4 — Guildhall orchestration
- Rewrite `packages/agents/*` on top of ported QueryEngine
- Close the orchestrator feedback loop (parse responses, persist state, run gates, enforce maxRevisions)
- Wire JIT context (NFR-02 caps + FS reads)
- **Exit:** One task runs `ready → done` end-to-end (no `exploring` yet)

### Phase 5 — Exploring phase
- Implement Spec Agent in `exploring` mode: conversational intake with live spec-draft panel
- Persist transcripts to `memory/exploring/<task-id>.md`
- Implement FR-13 (task decomposition) and FR-14 (coordinator bootstrapping)
- **Exit:** One task runs `exploring → done` end-to-end

### Phase 6 — Web UI (in this repo, OSS)
- Local web UI subscribes to the event protocol via SSE or WebSocket
- GH-Actions-style progress view
- Split-pane exploratory view (chat + live spec draft)
- **Exit:** `guildhall serve` opens a browser; one task runs `exploring → done` through the UI

### Phase 7 — Tauri shell (separate repo: `guild-pro`, out of scope for this repo)
- Tauri app at `~/git/oss/guild-pro/` consumes the same protocol
- Native notifications, dock badges, menu-bar glance view
- Packaging, code signing, auto-update
- Tracked separately — do not conflate with OSS roadmap

## 5. Test strategy (per NFR-05)

- Each ported module ships with its tests in the same PR
- Python pytest → TypeScript vitest — structurally isomorphic; helper to map `pytest.fixture` → vitest setup
- Pydantic validation error tests → Zod validation error tests
- asyncio-specific tests (locks, queues, futures) → Promise/Mutex equivalents
- Where OH test depends on Python-specific behavior, write an equivalent TS test rather than skipping

## 6. Attribution & license

- Both projects are MIT. `NOTICE` at repo root credits OpenHarness and the Claude Code lineage.
- Every ported file opens with a `/* Ported from openharness/src/openharness/<path>.py@<sha> — MIT */` header.
- PR descriptions cross-reference the upstream file being ported.

## 7. Open questions

- **Mastra's `createTool`** — keep as a schema helper or replace with a lightweight internal equivalent? Decide after protocol port.
- **LM Studio as default model** — Forge specced local-first. Does ported QueryEngine work against LM Studio's OpenAI-compatible endpoint out of the box? Verify in Phase 2.
- **CLI name** — `guildhall`, `gh` (collides with GitHub CLI), `gild`, `hall`? Default to `guildhall` until phase 4; bikeshed later.
- **License** — Fair Labor License proposed by user; verify exact license name/text before committing (see note in repo root; no LICENSE file yet).
