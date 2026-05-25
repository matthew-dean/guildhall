---
title: Running Guildhall
---

# Running Guildhall

Running Guildhall means letting the local service advance project tasks through
the construction loop. The service asks coordinators what can move next,
dispatches workers for trade work, collects inspections, and runs gates before
work is called done.

## From Projects & Workspaces

```bash
guildhall serve
```

`guildhall serve` is the friendly entrypoint: it makes sure the local service
is running, opens the browser UI, and usually drops you into either the
current project's shell or the service home.

From there, use the **Start** / **Stop** controls in the project shell. This
is the main operating path: you can inspect Thread, Work, Needs you, task
drawers, and release state without leaving the UI.

Projects & Workspaces uses the same runtime as the CLI. Curated progress is
written to `./.guildhall/PROGRESS.md`; detailed events, heartbeat updates, full
transcripts, checkpoints, and bulky evidence live in user-local Guildhall
history so they do not fill project commits.

Progress also leaves durable evidence: a task blueprint, decision,
change order, implementation diff, verification result, review finding, or
learning record. Transcript motion alone is not enough.

## From the CLI

Use the CLI when you want a blocking terminal process, scripting, CI smoke
runs, or a domain-scoped debugging session.

```bash
guildhall run                    # run the current project
guildhall run my-app             # run a specific registered project by id
guildhall run --domain ui        # only the ui domain
guildhall run --max-ticks 10     # stop after 10 ticks (for testing)
guildhall run --one-task         # stop after one task reaches a handoff point
```

`guildhall run` blocks until Ctrl-C or until there are no ticks left.

For service-style usage without a foreground terminal:

```bash
guildhall start
guildhall open
guildhall stop
```

## Fanout

By default Guildhall runs one task at a time per domain. Set
[`concurrent_task_dispatch`](../levers/concurrent-task-dispatch) to `fanout_N`
to run up to N tasks in parallel. Combined with
[`worktree_isolation: per_task`](../levers/worktree-isolation), each parallel
task runs in its own git worktree.

## Stop, pause, and stage transitions

- **Stop**: Ctrl-C the `run` process, use `guildhall stop`, or press **Stop**
  in the project shell. The current agent turn finishes gracefully; state is
  snapshotted.
- **Pause or shelve a task**: use the task drawer or project actions in the UI.
- **Resume spec shaping**: answer or follow up from Thread or the task drawer.

## What a "tick" does

Each tick:

1. For each domain (filtered by `--domain` if set): ask the coordinator to evaluate its queue.
2. Dispatch any ready tasks to workers (respecting `concurrent_task_dispatch`).
3. For any tasks in `review`: run reviewer fan-out as inspection.
4. For any tasks in `gate_check`: run hard gates.
5. Persist state; emit events.

The Thread, Work, and Closure views show the same state machine without needing
to read Guildhall's source code.
