# Deterministic Project-State Dispute Resolution

## Purpose

Guildhall may have several agents observe the same project fact. It must never
settle their disagreement by prose quality, arrival order, a view-local guess,
or an agent asking the owner to choose an implementation detail. This document
defines one extension of the existing `ProjectStateClaim` registry and shared
project decision projection.

It does not introduce a second project model. Releases, scope membership, task
definitions, runtime state, workspace state, proof evidence, and project
orientation remain the project model. Claims are typed observations and
decisions about those fields.

## What Counts As A Disagreement

A disagreement exists when two active, typed claims describe the same:

- project revision,
- subject and registered field, and
- physical/logical basis,

but have incompatible structured values. Claims about different worktree
attempts, different commits, or an older project revision are historical or
stale evidence, not a vote against the current fact.

Examples:

| Fact | Canonical authority | Possible observation | Automatic resolution |
| --- | --- | --- | --- |
| selected release | normalized queue selection | stale orientation summary | queue selection wins; summary is stale |
| release membership | normalized membership relation | imported plan snapshot | membership wins; refresh importer projection |
| task lifecycle | canonical task mutation | worker says it is done | task record wins; worker prose is evidence only |
| proof result | exact recorded command/verifier result | reviewer says proof passed | verifier wins; rerun the command if evidence is stale |
| workspace merge | Git index and `MERGE_HEAD` | worker says conflict is resolved | Git wins; refresh Git state |
| active worker | runtime supervisor record | saved project summary | runtime wins for liveness; refresh runtime projection |

## Required Protocol

1. An agent may submit only a registered field with a structured value,
   evidence references, the project revision it observed, and a basis when the
   fact belongs to a particular attempt, commit, process, or worktree.
2. A claim does not mutate project state directly. Canonical mutations go
   through the owning boundary with compare-and-swap revision checks.
3. The claim policy registry declares the allowed authorities, value semantics,
   and one reconciliation action for every operational field. New fields are a
   contract change, never a route-local string.
4. The resolver groups claims by `(subject, field, basis)`. It selects the
   strongest permitted authority only when its structured value is unambiguous.
   Equal-authority disagreement remains an explicit unresolved conflict.
5. The resolver produces a typed resolution record: winner claim IDs,
   contradictory claim IDs, stale claim IDs, and the one next action. It does
   not generate a prose answer from either agent.
6. The shared project decision/action projection consumes those records. All
   product surfaces render the same result; no page re-ranks raw task data or
   resolves a disagreement itself.
7. A reconciliation action is automatic when the policy calls for a Git read,
   verifier run, runtime refresh, or canonical state inspection. Owner input is
   valid only for explicit scope/irreversible product choices, never for
   ordinary work sizing, merge recovery, proof parsing, or agent coordination.

## Persistence And Idempotency

The current resolver already rejects unknown fields, duplicate divergent claim
IDs, invalid supersession, and claims from another revision/basis. To finish
the model, its inputs and results need durable normalized storage:

- `project_state_claims`: immutable claim envelope, unique by claim ID and
  fingerprint; indexed by project revision, subject, field, and basis.
- `project_state_disagreements`: derived/open record with canonical and
  contradictory claim IDs, state, reconciliation action, and resolved-at
  revision.
- `project_state_decisions`: compact resolved decision projection at the same
  project revision as the queue/scope snapshot.

Canonical writes append their canonical claim in the same SQLite transaction.
Runtime and verifier observations append only their own claim. A later
observation must carry the revision and basis it actually observed; it cannot
overwrite the prior fact by retrying a generic update. Projection rebuild is
idempotent from these three tables.

The old raw transcript remains bounded operational evidence. It is not a claim
authority and cannot be loaded to answer a project-state question.

## Field Ownership

The existing closed `ProjectStateClaimField` registry is the starting point.
The migration must finish wiring these fields through the protocol rather than
adding aliases:

- `project.selectedReleaseId` and `project.scopeSelection`: queue selection,
  normalized release membership, and scope rows.
- `task.lifecycleStatus`, hierarchy, dependencies, and capability bindings:
  canonical task mutation boundary.
- `proof.status`: verifier/recorded command evidence.
- `runtime.status`: supervisor runtime record.
- `workspace.syncState`: Git observation for a named workspace attempt.
- `repository.landingStatus`: verified Git landing state.
- `release.blockerTaskIds`: derived from the canonical selected scope and
  typed proof/task state, never a page-local count.

Orientation, Thread summaries, model output, imported prose, and UI cards may
describe these fields. They cannot own them.

## Migration Plan

1. Add the normalized claim, disagreement, and resolved-decision tables with
   an idempotent migration. Backfill only canonical current facts from the
   existing queue/scope/runtime/proof stores; do not manufacture claims from
   transcript prose.
2. Make each authoritative mutation boundary append the matching canonical
   claim in its transaction. Reject a write that changes a registered field
   without its claim.
3. Route Git, verifier, runtime supervisor, importer, and worker observations
   through claim appenders. They may schedule the policy action but not write a
   competing task/release value.
4. Build the project decision projection solely from resolved claims plus the
   canonical snapshot. Persist it at the same revision.
5. Replace remaining Overview, Work, Thread, Activity, Release, and map
   consumers with that decision packet for every shared state label, count,
   primary action, and selected-scope identity.
6. Delete reader-side fallback selection and any summary/orientation fields
   that mirror authoritative state once all consumers are migrated.

## Verification Matrix

Each migration step needs a deterministic two-agent test. The test varies both
agent prose while holding structured claims constant.

- A stale orientation says `release-a`; the queue says `release-b`. Every
  surface opens and counts `release-b`.
- A worker reports a merge resolved; Git reports `MERGE_HEAD` and an unmerged
  path. The task remains in typed workspace recovery.
- A reviewer says proof passed; the command result lacks the required typed
  evidence. The release remains unready and schedules verifier recovery.
- A stale supervisor event names task A; runtime currently owns task B. The
  action, Activity, Work, Thread, and status chrome lead with B.
- Two equal-authority canonical scope writes at one revision disagree. No
  surface chooses either; the project decision exposes one explicit conflict
  and the policy requests the only allowed scope decision.
- Claims for a replaced worktree attempt are stale, never contradictory.

The installed-app replay must assert the same selected release ID, scope task
count, deferred count, active task, blockers, and primary action across
Overview, Work, Thread, Activity, Release, and the start response.
