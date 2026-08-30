# Orphan Branch Recovery Audit - 2026-08-12

## Purpose

Audit every local Guildhall branch not merged into `main` for work that could
have been unintentionally abandoned. This is a recovery inventory, not
permission to merge historical branches. Current product work is governed by
the 2026-08-09 stop-ship usability mandate in
`internal/audits/flow-audit.md`: every current product surface is presumed to
have failed until a fresh-owner job proves it earns a place.

## Method

- Compared `git branch --no-merged main` with the active PR branch
  `fix/pressure-test-completion-handoff`.
- Used `git cherry` to identify patch-equivalent commits already incorporated.
- Read all recent candidate diffs and checked the current source for their
  underlying behaviors.
- Kept worktrees and branches intact. This audit makes recovery decisions; it
  does not delete historical evidence or publish stale work.

## Decisions

| Branch | Finding | Recovery decision |
| --- | --- | --- |
| `fix/durable-pressure-test-intake-allocation` | Its one process-safe allocation patch (`ec18c183`) is patch-equivalent to current-branch `0fd2fd4b`. | Already incorporated. Do not merge or cherry-pick. The checked-out worktree can be retired only in a separate cleanup pass. |
| `review/pr20-overview-work` | Its reconciliation patch (`1172826a`) is patch-equivalent to current work. Its earlier state fixes are present in the current action model/projection/Thread code: active stopping state, decision code projection, and clearing stale detail payloads. | Already incorporated in substance. Do not merge the branch. Preserve it only as review evidence until PR #20 closes. |
| `codex/0.13-docs-sidecar` | Docker/Colima wording is already present in the current public docs. Its 0.13 screenshots depict product surfaces now declared failed by the stop-ship audit. | Keep only as historical evidence. Do not publish or reintroduce the screenshots. Capture new public screenshots only after the product reset. |
| `feature/worktree-cleanup-invariants` | It would block an otherwise landed task when cleanup fails. Current worktree cleanup is newer and intentionally retains a safely landed task for durable retry, preserving unlanded investigation work instead of turning cleanup into a false product blocker. | Superseded. Do not cherry-pick. Revisit only if a new live test proves the current retry semantics lose data or conceal a failed cleanup. |
| `feature/memory-core-prototype` | Six June prototype commits introduced early memory-core storage, ingestion, compaction, and pressure-audit work. Current code has a later memory-core implementation, memory migrations, project-state compaction, and system-local memory integration. | Do not merge the prototype. The only retained value is its scalability/audit questions; compare those to current compaction tests when changing memory behavior. |
| `feature/0.7-construction-foundation` | Large June construction-planning feature: construction state, summaries, drawer/thread context, Build Map UI, and Settings/Work panels. It is an old product model and adds exactly the extra views and explanatory state the current mandate rejects. | Explicitly reject as a merge source. Product intent may be reconsidered only if a future owner job proves a distinct decision needs it; no old UI surface is grandfathered in. |
| `feature/cognitive-overhead-reduction-worker-g`, `-h`, `-l`, `-m`, `-n` | All five patches are patch-equivalent to commits already in the current branch history. Their contents include `DoThisNext`, `FleetNeedsYou`, `NeedsYou`, expanded settings panels, and design-token work. These are not missing improvements; they are part of the present interface now under stop-ship review. | Already incorporated, and not candidates for restoration. Treat their surviving surfaces as reset candidates, not assets to preserve. |
| `guildhall/task-task-001` | Old benchmark/task-tree checkpoint with large May planning, benchmark fixtures, model comparisons, and prose-contract audit material. No current task depends on its code; current model-independence and calibrated-review gates supersede its enforcement approach. | Retain as historical research only. Do not merge its task-tree/UI/runtime changes. Pull a specific benchmark or calibration fixture only after it proves a gap in the current suite. |
| `feature/guildhall-0.7.0-release` | One internal planning-doc commit. | No runtime or product value to recover. Leave untouched. |

## Important non-decision

The audit does **not** say the current product is healthy because recent branch
patches were incorporated. The opposite lesson is important: the current
interface contains accumulated “improvement” work from several of these
branches, including duplicate live/status/needs-you surfaces. The stop-ship
reset must evaluate and remove those surfaces from the fresh-owner flow.

## Recovery guardrails for future work

1. Do not mass-merge or cherry-pick orphan branches. Every recovered change
   must name the current owner decision it improves and pass the one-minute
   orientation test.
2. Do not use historical component tests as evidence that an old surface should
   survive. Tests establish old behavior, not present product value.
3. When a future bug points at historical work, recover the smallest typed
   runtime invariant or regression test into the current model. Do not revive
   a past panel, route, summary, or information architecture to get it.
4. Leave branch deletion and worktree pruning for a separate, explicitly
   authorized cleanup pass after PR #20 and the product reset have a stable
   landing branch.
