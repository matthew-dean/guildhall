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

## Spec

### Problem

Guildhall currently has enough orchestration surface to look busy without
guaranteeing the thing the user needs most: one task carried all the way to a
trustworthy stopping point. The pivot narrows the core product promise to
single-task completion first. Multi-agent fanout, policy inference, and external
tracker integration stay valuable, but only after the one-task loop is boring.

### Scope

The pivot covers the local runtime path that starts from an already-local
Guildhall task and drives it forward. It includes task selection, claim,
worker/review/gate progression, evidence requirements, stop conditions, and a
review packet. It does not include replacing `TASKS.json`, adding Beads/Dolt,
adding Linear/Jira/GitHub adapters, or removing the existing dashboard.

### Runtime Invariants

- **Active beats fresh.** Any task in `gate_check`, `review`, or `in_progress`
  is selected before `proposed`, `exploring`, `spec_review`, or `ready`.
- **Nearest-to-done wins.** Among active tasks, `gate_check` wins over
  `review`, which wins over `in_progress`.
- **Policy cleanups are cheap and first.** Worker pre-rejection policy cleanup
  remains ahead of active selection because it resolves already-touched work
  without a model call.
- **Claim is deterministic.** A `ready` task is already approved. The
  orchestrator claims it by setting `status: "in_progress"` and
  `assignedTo: "worker-agent"`; it does not ask a coordinator to perform that
  mechanical assignment.
- **One worker owns implementation.** The normal path has one worker working one
  task until it reaches `review`, blocks, or explicitly splits.
- **Handoff needs evidence.** The worker cannot move to `review` without source
  inspection plus concrete edit/write/verification activity.
- **Review and gates happen before new work.** Once a task reaches `review` or
  `gate_check`, Guildhall processes that task before claiming unrelated work.
- **Stop points are explicit.** A run may stop after a task reaches terminal
  status, after producing a review packet/commit, or after a split/block.
- **Fallbacks are explicit and cost-aware.** A stale preferred provider may
  fall back to another configured provider, but falling back to a paid/cloud
  provider is disabled by default and must be enabled in global or project-local
  config. The active provider and any fallback from preference must be visible
  in the project header.
- **No first-try dead end.** A first failed implementation/review/gate attempt
  should prefer revision and continuation over `blocked`, unless the runtime is
  missing required credentials, tools, permissions, or human input.

### Task Eligibility

The picker treats tasks as one of four classes:

1. **Policy cleanup:** worker-pre-rejected `shelved` tasks whose policy has not
   been applied.
2. **Active completion:** `gate_check`, `review`, `in_progress`.
3. **Fresh intake:** `proposed`, `exploring`, `spec_review`, `ready`.
4. **Terminal/held:** `done`, `blocked`, `shelved`, `pending_pr`, or any task
   with an unresolved escalation.

Dependency-aware readiness is a later slice. When it lands, tasks with unmet
`dependsOn` edges should be treated as ineligible, not merely lower priority.

### Claim Contract

A deterministic claim produces a normal processed tick:

- before status: `ready`
- after status: `in_progress`
- agent id: `task-claimer`
- task mutation:
  - `assignedTo = "worker-agent"`
  - `status = "in_progress"`
  - `updatedAt = now`
  - append a short note recording that the orchestrator claimed the task
- progress log: heartbeat `ready -> in_progress`

The worker starts on the next tick. This keeps each tick observable and avoids
mixing claim and implementation in one opaque operation.

### Evidence Contract

The existing review handoff guard stays load-bearing:

- `TASKS.json` is state, not implementation.
- A self-critique alone is not enough.
- The runtime must see implementation-file inspection and a concrete edit,
  write, or verification command before `update-task status=review` succeeds.

Future slices should make the evidence packet more structured, but the current
guard already blocks the most dangerous paper-complete path.

### Review Packet Contract

The final packet should be a durable per-task artifact under
`memory/tasks/<task-id>/review-packet.md`. It should contain:

- task title, id, domain, and status
- acceptance criteria with met/unmet state
- changed files or explicit "no files changed"
- commands run and results
- reviewer verdicts and hard gate results
- unresolved uncertainties, escalations, or follow-up tasks
- safe next action for the human or orchestrator

This packet is not a substitute for tests or commits. It is the human-readable
receipt that the loop actually did work.

## Implementation Todos

- [x] **Task 1: Active-work-first picker.** `gate_check`, `review`, and
  `in_progress` outrank fresh intake states; fanout capacity fills from active
  work first.
- [x] **Task 2: Deterministic ready claim.** Replace the coordinator model hop
  for `ready -> in_progress` with an orchestrator-owned claim tick.
- [x] **Task 3: One-task run mode.** Add a runtime mode that exits after one
  task reaches terminal/review-packet/split/block instead of continuing the
  whole board.
- [x] **Task 4: Dependency-aware readiness.** Treat unmet `dependsOn` edges as
  ineligible when selecting fresh work.
- [x] **Task 5: Review packet artifact.** Write
  `memory/tasks/<task-id>/review-packet.md` after review/gates.
- [x] **Task 6: Legacy queue normalization.** Decide and implement the migration
  for old `status: "pending"` tasks so the repo's own dogfood queue is runnable.
- [x] **Task 7: UI posture update.** Surface the one-task finisher posture in
  Thread/Planner so users can see why Guildhall is finishing current work before
  starting more.
- [x] **Task 8: Provider fallback visibility.** Preserve the provider chosen by
  start preflight, expose preferred/active/fallback state through
  `/api/project`, require explicit opt-in for paid/cloud fallback, and show a
  project-header notice when the run falls back.
- [x] **Task 9: Complete-and-merge dogfood.** Run Guildhall on a disposable git
  project until it completes a task and merges the resulting branch/worktree.
- [x] **Task 10: 0.3.0 release packaging.** After complete-and-merge evidence,
  bump to `0.3.0`, rerun publish gates, and prepare the npm publish.

## Current Progress

Implemented first because it is low-risk and attacks the main failure mode:

- Update task selection so `gate_check`, `review`, and `in_progress` outrank
  fresh intake states.
- Keep worker pre-rejection policy cleanup ahead of everything else because it
  is a cheap state-resolution path for already-touched work.
- Add focused tests for serial and fanout selection.
- Replace the coordinator assignment prompt for `ready` tasks with a
  deterministic `task-claimer` tick that sets `assignedTo: "worker-agent"` and
  moves the task to `in_progress`.
- Add `stopAfterOneTask` runtime support so a run can keep processing one task
  through worker, review, and gates, then stop before claiming unrelated ready
  work.
- Make task selection dependency-aware: tasks with `dependsOn` edges are not
  eligible until every dependency exists and is `done`.
- Write a compact review packet when a task lands in `done`, `pending_pr`,
  `blocked`, or `shelved`, including acceptance criteria, gate results,
  reviewer verdicts, unresolved items, and safe next action.
- Normalize legacy `status: "pending"` task records to modern `ready` at the
  core schema boundary, so old queues parse consistently across runtime and
  tool paths.
- Add a dashboard `Finish one` run mode backed by `stopAfterOneTask`, plus a
  Planner focus strip that shows the next eligible task and dependency-blocked
  count.
- Direct UI testing found two posture gaps and folded them into Task 7:
  dependency-blocked cards now render as `Waiting`, and the task drawer starts
  `Finish one` mode instead of a generic continuous run.
- Direct UI testing also found a stop-state truthfulness bug: repeated stop
  requests against an already-stopping run now report that the run is still
  stopping until the supervisor actually reaches `stopped` or `error`.
- The npm-publish gate is now close enough to exercise mechanically:
  `pnpm test`, `pnpm lint:deps`, `pnpm docs:build`, `pnpm build`,
  `git diff --check`, and `pnpm pack --dry-run` all pass. The release script
  also runs `docs:build` and restores `package.json` after dry-runs.
- A fanout slot reservation race found by the release gate is fixed: batch
  dispatch now reserves a slot for every picked task before concurrent
  dispatch, so generated prompts and dispatch bookkeeping agree on task slots.
- Live Codex dogfood exposed and fixed the completion-loop bugs that unit tests
  did not catch:
  - provider errors now fail the tick instead of being swallowed as no-op
    `in_progress -> in_progress` turns;
  - the Codex setup/round-trip path uses a supported `gpt-5.3-codex` model id;
  - Codex tool schemas are normalized with `properties: {}` for empty object
    tools;
  - runtime agents now receive `cwd: config.projectPath`, so relative file
    tools operate on the target project rather than Guildhall's own checkout;
  - `update-task` exposes real JSON-schema properties, rejects empty no-op
    updates, and ignores empty optional strings so broad model calls cannot
    erase existing specs;
  - no-tool nudging stops after a tool has already run, so a final summary after
    a real handoff does not turn a successful worker pass into an error.
  - `update-task` now accepts structured `gateResults`, so gate-checker agents
    can persist hard-gate evidence and review packets can render commands
    instead of saying "None recorded."
- A disposable Codex-backed one-task run completed end to end:
  `ready -> in_progress -> review -> gate_check -> done`, wrote a checkpoint,
  passed the task-specific gate with structured `gateResults`, and emitted
  `memory/tasks/dogfood-001/review-packet.md`.
- Provider fallback is now surfaced instead of hidden: `/api/project/start`
  stores the selected provider on the supervisor run, `/api/project` reports the
  preferred and active provider, paid/cloud fallback requires
  `allowPaidProviderFallback`, and the project top bar shows a fallback notice
  when they differ.
- A disposable Codex-backed merge dogfood run completed and merged:
  `/tmp/guildhall-merge-dogfood` reached `ready -> in_progress -> review ->
  gate_check -> done`, recorded `mergeRecord.result: "merged"` for
  `guildhall/task-merge-001 -> main`, and left `main` at commit
  `4a282a0 Complete merge dogfood task`.
- Release packaging is staged for `0.3.0`: `package.json` is bumped, the full
  publish gate passed with 1679 tests, 37 dependency warnings and 0 errors,
  docs/build green, `git diff --check` clean, and `pnpm pack --dry-run`
  produced `guildhall-0.3.0.tgz`.

## Revised Testing Plan

Use a disposable initialized workspace for UI runs unless the operator
explicitly wants to dogfood against this checkout. This avoids mutating
Guildhall's own `memory/` while still exercising the built dashboard bundle.

1. **Unit/runtime gates:** run focused orchestrator, picker/fanout,
   task-normalization, task-tool, agent-prompt, and supervisor tests.
2. **Static gates:** run `pnpm typecheck`, `git diff --check`, and `pnpm build`.
3. **Planner smoke:** open `/planner` in the in-app browser and verify `Finish
   one`, `Start`, `Stop`, run state, next focus, and dependency-blocked count.
4. **Dependency visibility:** verify unmet-dependency tasks are not merely
   shown as `Ready`; cards must say `Waiting`.
5. **Drawer smoke:** open a task drawer, verify the footer run action says
   `Finish one`, and verify it posts one-task mode.
6. **One-task state transition:** only when a safe provider/runtime is
   intentionally available, click `Finish one` and verify the UI enters
   `Finishing one task`, disables both start buttons, and enables `Stop`.
7. **Stop state:** verify stop responses and project snapshots stay truthful
   while a run is draining.
8. **Release gate:** run the publish-path checks together:
   `pnpm test && pnpm lint:deps && pnpm docs:build && pnpm build &&
   git diff --check && pnpm pack --dry-run`.
9. **Dry release rehearsal:** before real npm publish, run
   `pnpm release:dry <version> --allow-branch --allow-dirty --tag next` from a
   deliberate dirty branch only if validating script mechanics; otherwise run
   it from a clean release branch.
10. **Real completion dogfood:** run one intentionally small task through
    `Finish one` or `guildhall run --one-task` with a live provider and verify
    it reaches `done`, `pending_pr`, `blocked`, or a review packet without
    starting unrelated work.

The April 29 Codex dogfood used a disposable workspace under `/tmp`, a single
`ready` task that appended a line to `NOTES.md`, and a project success gate of
`grep -q "Guildhall one-task dogfood completed." NOTES.md`. It reached `done`
in four ticks and verified that the one-task finisher can complete a tiny task
with a live provider.

Future slices should add:

- Capturing changed files and verification commands explicitly in the review
  packet instead of relying on later audit of git state and progress logs.
