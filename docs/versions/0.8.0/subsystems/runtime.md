---
title: Runtime
help_topic: subsystem.runtime
help_summary: |
  The Orchestrator is the top-level state machine. Each tick evaluates every
  domain, dispatches workers, runs reviewer fanout, executes gates, and
  persists shared state to ./.guildhall/ and local history to ~/.guildhall/data/projects/.
---

# Runtime

**Source:** `./src/runtime/`

The runtime is the top-level orchestration layer. It owns the task state machine, coordinates agents, enforces levers, and surfaces events to the browser UI.

## Orchestrator

`Orchestrator` (see `./src/runtime/orchestrator.ts`) is the main state machine. Its loop:

1. Load current shared state from `./.guildhall/`.
2. For each domain: ask the coordinator agent to evaluate its queue.
3. For each `ready` task: dispatch a worker (respecting [`concurrent_task_dispatch`](../levers/concurrent-task-dispatch)).
4. For each `review` task: run reviewer fanout.
5. For each `gate_check` task: run hard gates.
6. Land accepted work per [`landing_strategy`](../levers/merge-policy).
7. Persist; emit events.

Call `runOrchestrator({ cwd, maxTicks, domainFilter })` to drive one or more ticks.

## Context builder

`./src/runtime/context-builder.ts` assembles per-turn context just-in-time for each agent:

- Applicable guilds (via `selectApplicableGuilds`).
- Current design system (`./src/core/design-system.ts`).
- Project memory (shared summaries plus relevant local transcripts and prior tasks).
- Current lever positions.

This keeps prompts tight — agents get only what they need for the current decision, not the whole project state.

## Business envelope

`./src/runtime/business-envelope.ts` evaluates proposed work against the project's `Goals` and `Guardrails`. [`business_envelope_strictness`](../levers/business-envelope-strictness) decides whether a guardrail violation blocks, warns, or is ignored.

## Reviewer dispatch and fanout

- `./src/runtime/reviewer-dispatch.ts` — picks the review engine per [`reviewer_mode`](../levers/reviewer-mode).
- `./src/runtime/reviewer-fanout.ts` — runs multiple persona reviewers and aggregates per [`reviewer_fanout_policy`](../levers/reviewer-fanout-policy).

## Remediation

`./src/runtime/remediation.ts` handles self-healing actions. [`remediation_autonomy`](../levers/remediation-autonomy) decides whether to act autonomously, confirm destructive actions, confirm all, or pause everything on issue.

## Intake and setup shaping

- `./src/runtime/intake.ts` — task-shaping flow used by the browser UI when work needs a clearer spec before it can run.
- `./src/runtime/meta-intake.ts` — setup flow used by the browser UI to inspect a repo, infer internal routing, and draft starter tasks.

## CLI and server entry points

- `./src/runtime/cli.ts` — `guildhall <command>` dispatch.
- `./src/runtime/serve.ts` — the Hono HTTP server backing the browser UI.
