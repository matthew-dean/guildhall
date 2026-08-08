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
is the main operating path: you can inspect Thread, Work, attention items, task
drawers, and release state without leaving the UI.

## Local runtime setup

Guildhall 0.13 is supported as a local macOS app. Runtime-backed project work
supports Docker and Podman, but Guildhall does not install either as a surprise
side effect. The package install leaves your host alone: no runtime install, VM
creation, image pull, or container startup.

For a lightweight isolated macOS setup, use Docker through Colima:

```bash
brew install colima docker
colima start
docker info
```

Docker Desktop and Podman are supported alternatives.

Open **Settings -> Ready** and look at **Local runtime**:

- **Ready** means Docker or Podman is installed and its service is running.
  Guildhall still starts project containers only when work needs them.
- **Runtime unavailable** means Guildhall cannot find Docker or Podman. Install
  Docker with Colima, Docker Desktop, or Podman, then check again.
- **Setup needed** means Podman is installed but its machine has not been
  created. Run the approved Podman setup from the app.
- **Stopped** means Guildhall found a runtime, but its service is not running.
  Start Colima, Docker Desktop, or the Podman machine, then check again.
- **Host-run compatibility mode** remains available when setup is skipped,
  fails, or you deliberately want work to run on the host.

Setup choices and results are saved in host-owned Guildhall runtime state, not
inside the project checkout. Project containers also stay off by default; they
start on demand when an AI run needs the runtime.

The 0.13 runtime image is part of the release. The release manifest records the
expected Debian, Node, Python, runtime API, image tags, and final digest before
the package is shipped. Guildhall pulls or checks the release image only during
approved runtime setup or first runtime use.

Projects & Workspaces uses the same runtime as the CLI. Curated progress is
written to `./.guildhall/PROGRESS.md`; detailed events, heartbeat updates, full
transcripts, checkpoints, and bulky evidence live in user-local Guildhall
history so they do not fill project commits.

Progress also leaves evidence you can inspect: a task blueprint, decision,
change order, implementation diff, verification result, review finding, or
learning record. Transcript motion alone is not enough.

When a task reaches the end of the loop, Guildhall records how the result was
launched, verified, reviewed, and backed by evidence. The completion handoff is
the readable closeout: what shipped, what was checked, what was out of scope,
and any remaining risk.

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

The Thread, Work, and Release views show those steps without making you read
Guildhall's source code.
