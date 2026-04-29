---
title: Running the orchestrator
---

# Running the orchestrator

The orchestrator is the process that advances tasks. It ticks through each domain, asks coordinators to evaluate their queues, dispatches workers, collects reviews, and runs gates.

## From the CLI

```bash
guildhall run                    # run the default workspace
guildhall run my-app             # run a specific workspace by id
guildhall run --domain ui        # only the ui domain
guildhall run --max-ticks 10     # stop after 10 ticks (for testing)
guildhall run --one-task         # finish one task, then stop
```

`guildhall run` blocks until Ctrl-C or until there are no ticks left. Progress is appended to `memory/PROGRESS.md`, events are streamed to `memory/events.ndjson`, and the full transcript per task lives under `memory/transcripts/`.

## From the dashboard

```bash
guildhall serve
```

Opens the dashboard at `http://localhost:7842`. The **Run** control on the project page starts and stops the orchestrator with the same semantics as the CLI.

## Fanout

By default the orchestrator runs one task at a time per domain. Set [`concurrent_task_dispatch`](../levers/concurrent-task-dispatch) to `fanout_N` to run up to N tasks in parallel. Combined with [`worktree_isolation: per_task`](../levers/worktree-isolation), each parallel task runs in its own git worktree.

## Stop, pause, resume

- **Stop**: Ctrl-C the `run` process (or Stop in the dashboard). The current agent turn finishes gracefully; state is snapshotted.
- **Pause a task**: `guildhall pause <task-id>` moves it to `blocked` with a pause reason. Resume with `guildhall resume`.
- **Shelve a task**: `guildhall shelve <task-id>` terminally parks it.

## What a "tick" does

Each tick:

1. For each domain (filtered by `--domain` if set): ask the coordinator to evaluate its queue.
2. Dispatch any ready tasks to workers (respecting `concurrent_task_dispatch`).
3. For any tasks in `review`: run reviewer fan-out.
4. For any tasks in `gate_check`: run hard gates.
5. Persist state; emit events.

See [`src/runtime`](../subsystems/runtime) for the full state machine.
