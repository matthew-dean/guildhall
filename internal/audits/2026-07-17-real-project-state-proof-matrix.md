# Real-Project State Proof Matrix

**Date:** 2026-07-17
**Source:** fresh local Guildhall service at `http://localhost:7777`
**Projects:** Narrative Harness, Looma + Knit, Jess, and Fair Labor License

## Scope

This is a proof matrix, not a state interpretation from task files. The
project API is the source for current release, readiness, execution, counts,
deferred scope, and projection freshness. The migration CLI is the source for
generic migration status. `stale-server` is only an app-artifact freshness
check; it does not prove that a project projection is current.

The live service was fresh during this audit:

```json
{"stale":false}
```

The required projects were present in the service roster. The agreement audit
reported `missingProjects: []`, `mismatchCount: 0`, and `pass: true`. The
performance audit and orientation-spine audit also completed with `pass: true`
for the registered fleet.

## Project Matrix

| Project | Release proof | Current state proof | Deferred proof | Migration proof | State coverage |
| --- | --- | --- | --- | --- | --- |
| Narrative Harness | `scopeMode: named_release`; `Stage 1: Fixture And Evaluation Harness`; selected total `13` | `summaryFreshness: current`; release `state: blocked`; `9` blocked, `1` active, `3` ready; start code `owner_input_required`; `4` owner decisions; execution `stopped` | `releaseSummary.counts.deferred: 19`; release detail has `19` deferred nodes | Generic status: `56` applied, `1` pending manual `0.9.0/runtime-backed-project`, `0` blocked. State finalize and legacy-live-file cleanup each applied with `0` pending | named-release, blocked, deferred, partially migrated; stale/running not observed |
| Looma + Knit | `scopeMode: named_release`; `Stage 1: V1 Release Hardening`; selected total `16` | `summaryFreshness: current`; release `state: blocked`; `15` blocked, `1` active; start code `paused_live_work`; `canStart: true`; resume focus is `Component implementation`; no running execution was reported | `releaseSummary.counts.deferred: 26`; release detail has `26` deferred nodes | Generic status: `56` applied, `1` pending manual `0.9.0/runtime-backed-project`, `0` blocked. State finalize and legacy-live-file cleanup each applied with `0` pending | named-release, blocked, deferred, paused-not-running, partially migrated; stale/running not observed |
| Jess | `scopeMode: unreleased`; `release: null`; release detail `scope: null` | `summaryFreshness: current`; release state `unknown`; release totals are zero; start code `workspace_import_pending`; current task is `Review existing project work` | No selected release, so deferred count is `0`; this is no-release state, not proof that all project work is complete | Generic status: `52` applied, `1` pending manual `0.9.0/runtime-backed-project`, `0` blocked. State finalize and legacy-live-file cleanup each applied with `0` pending | no-release, partially migrated; stale/running/blocked/deferred not observed |
| Fair Labor License | `scopeMode: unreleased`; `release: null`; release detail `scope: null` | `summaryFreshness: current`; release state `unknown`; release totals are zero; start code `workspace_import_pending`; current task is `Review existing project work` | No selected release, so deferred count is `0`; this is no-release state, not proof that all project work is complete | Generic status: `52` applied, `1` pending manual `0.9.0/runtime-backed-project`, `0` blocked. State finalize and legacy-live-file cleanup each applied with `0` pending | no-release, partially migrated; stale/running/blocked/deferred not observed |

## State Proof Rows

| State | Required evidence | Pass condition | Current real-project example |
| --- | --- | --- | --- |
| No release | Compact overview and release detail both show `releaseSummary.scopeMode: unreleased`, `release: null`; release detail has no scope | No release identity or selected-release membership is invented; zero release totals are reported as no selected scope | Jess and Fair Labor License |
| Named release | Compact overview, Work, Map, fleet, Activity, release summary, and release detail agree on release id, label, kind, source, selected membership, and counts | `scripts/project-state-agreement-audit.mjs` returns no mismatches, including selected-release identity and membership | Narrative Harness and Looma + Knit |
| Stale | The affected projection reports `summaryFreshness: stale` or `missing`, or Thread reports `currentThreadFreshness`/`historyFreshness: stale`; stale projections carry `requiresRefresh: true` where the contract exposes it | The stale projection is named, its source revision is compared with the current project/queue revision, and the UI/API does not present it as current. `stale-server` must be checked separately | No stale project projection was observed in this run; all four projects reported current summary, current Thread, aligned release detail, and matching revisions |
| Running | Compact project state and the run-control surface report `execution.status: running` (or the equivalent current `run.status`), with mode and focus/scope; fleet and project surfaces agree | Running is visible as live work, not inferred from an old `startedAt`; stop/resume controls and Thread state agree with the same run | No running project was observed. Narrative Harness was `stopped`; Looma + Knit was `paused_live_work` with `canStart: true`, which is resumable but not running |
| Blocked | Release summary `state: blocked`, blocking counts and blocker identities; start-readiness code/message; disabled or redirected run control; release detail blocker totals | Blocker identity and counts agree across Overview, Work/Map, Activity, Thread, fleet, and Release. A blocked release is not described as ready | Narrative Harness: `9` selected blockers and owner input. Looma + Knit: `15` selected blockers |
| Deferred | Named release summary `counts.deferred` plus release detail `scope.deferredNodeIds`; selected counts must exclude deferred work from the active selected total | Deferred work is visible as later work and is not counted as current release work or silently treated as blocked/done | Narrative Harness: `19`; Looma + Knit: `26` |
| Partially migrated | `guildhall migrate status <path>` shows both applied and pending migrations; inspect state-boundary migrations separately with `--migration` | Report the pending migration and its safety/meaning. Do not call a project-state cutover partial when `0.13.0/project-state-finalize` and `0.13.0/project-state-legacy-live-file-cleanup` are applied | All four projects have one pending manual runtime migration, while both current-state boundary migrations are applied |

## Commands

These are the read-only probes used for this matrix:

```sh
curl -sS http://localhost:7777/api/stale-server
curl -sS http://localhost:7777/api/service
pnpm audit:project-state-agreement
pnpm audit:project-state-performance
pnpm audit:project-spine
guildhall migrate status /Users/matthew/git/oss/narrative-harness
guildhall migrate status /Users/matthew/git/oss/looma-knit
guildhall migrate status /Users/matthew/git/oss/jess
guildhall migrate status /Users/matthew/git/oss/fair-labor-license
```

For migration boundary proof, run the status command once per project with
each of these filters:

```sh
--migration 0.13.0/project-state-finalize
--migration 0.13.0/project-state-legacy-live-file-cleanup
```

The agreement audit reads `/api/service/projects`, compact Overview/Work/Map,
Activity, release summary/detail, Spine, Thread, and the focused task detail.
It compares release identity, selected membership, blockers, counts, action
model, start readiness, projection freshness, revisions, and compact/rich
release invariants. The performance audit checks fleet, service, attention,
compact project, focused task, and Thread reads for loading/errors, latency,
and bounded payload size. The spine audit classifies orientation and reports
included, deferred, roots, pins, gaps, and progress.

## Code Contract References

- `src/sessions/project-state-database.ts` defines the current-state metadata,
  authority, revision, and `current`/`stale`/`missing` freshness vocabulary.
- `src/runtime/thread-read-projection.ts` defines current Thread and history
  freshness against the project and queue revisions.
- `scripts/project-state-agreement-audit.mjs` is the cross-surface agreement
  and release-projection proof.
- `scripts/project-state-performance-audit.mjs` is the bounded API/read-model
  proof.
- `scripts/project-orientation-spine-audit.mjs` is the real-project
  orientation and deferred-work proof.
- `src/runtime/cli.ts` exposes the read-only `guildhall migrate status` and
  `--migration` filters; `src/runtime/migrations.ts` defines the pending
  manual runtime migration and the applied state-boundary migrations.

## Limits

This run proves the four requested projects in current, no-release,
named-release, blocked, deferred, paused-not-running, and partially migrated
states. It does not fabricate a stale projection or start a real coordinator
just to create a transient state. Stale and running remain required transition
probes: capture the same matrix while a projection is explicitly stale and
while a real project run reports `status: running`, then rerun the agreement
audit before claiming those states are covered.

## 2026-07-17 data-layer closeout

The storage and read-model proof is now complete for the current registered
roster. Historical payload maintenance produced 457 classified artifacts
across seven project databases, totaling 6,272,664 bytes, with zero
unclassified entries. Review transport and evacuation files are registered;
legacy migration snapshots are digest-verified and archived before source
removal. The installed service is fresh, all seven projects refresh without
errors, the performance audit passes, and the agreement audit reports
`mismatchCount: 0`.

The stale/running rows above remain intentionally marked as transition probes:
they are not storage-authority failures, and no claim is made that a static
audit snapshot proves those transient states. The project status command may
still show the manual `0.9.0/runtime-backed-project` migration; that is an
explicit project migration and is separate from the completed retention
cutover.
