---
title: Beads and one-task pivot
---

# Beads and one-task pivot

This note records the April 2026 pivot from "multi-agent operating system
first" toward a smaller, Ralph/Beads-shaped task completion kernel.

Sources:

- [Your Agent Orchestrator Is Too Clever](https://www.chrismdp.com/your-agent-orchestrator-is-too-clever/)
- [gastownhall/beads](https://github.com/gastownhall/beads)
- [Beads FAQ](https://github.com/gastownhall/beads/blob/main/docs/FAQ.md)

## Read

Beads is useful to Guildhall more as a set of operating principles than as a
dependency to embed immediately. Its strongest ideas are:

- **Ready-work detection:** agents ask for unblocked work instead of scanning a
  prose plan.
- **Atomic claim:** the transition into active work is explicit and prevents
  multiple agents from picking the same task.
- **Dependency graph:** blocked work is not "lower priority"; it is ineligible
  until dependencies clear.
- **Collision-resistant IDs:** hash-style IDs and graph edges reduce merge
  conflict risk when agents create work on branches.
- **Agent-first JSON:** task state is easy for agents to query without reading a
  wall of Markdown.
- **Finish in-flight work:** stale `in_progress` work is picked up before new
  work is claimed.

The technology choice is less compelling for Guildhall right now. Beads brings a
Dolt-backed issue database, CLI, hooks, sync, and its own workflow semantics.
Guildhall already has a local task model, dashboard, lifecycle, review/gate
state, and project memory. Replacing `memory/TASKS.json` with Beads now would
spend the pivot budget on storage migration instead of proving the completion
loop.

## Decision

Do not build Guildhall on Beads in the near term.

Borrow the smallest useful behavior first: **active work beats fresh work**.
When any task is already in `in_progress`, `review`, or `gate_check`, Guildhall
keeps driving those tasks to a terminal state before starting `proposed`,
`exploring`, `spec_review`, or `ready` work.

Within active work, Guildhall prefers the nearest-to-done status:

1. `gate_check`
2. `review`
3. `in_progress`

That ordering closes finished work quickly, produces a durable verdict/gate
record, and reduces half-complete task buildup.

Release target: the next npm publish is **0.3.0**. The release bar is not just
"tests pass"; Guildhall must complete at least one real task and merge it before
publishing. Dirty changes in the current pivot branch are treated as part of
this release batch.

## Product Shape

The next product kernel should be a one-task finisher:

1. Pick one active task if any exists.
2. Otherwise pick one ready task and claim it.
3. Run the worker loop until the task reaches `review`, blocks, or splits.
4. Run review and gates immediately before claiming unrelated work.
5. Require evidence before handoff: source inspection, concrete change or
   verification, self-critique, checkpoint, and progress log.
6. Commit or emit a review packet, then stop.

Coordinator fanout, reviewer persona fanout, external issue adapters, inferred
lever magic, and autonomous remediation should build around this loop only after
the one-task kernel reliably lands real work.
