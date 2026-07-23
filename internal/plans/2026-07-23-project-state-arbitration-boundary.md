---
title: Project-State Arbitration Boundary
status: active
work_id: 0.13.69/project-state-arbitration
---

# Project-State Arbitration Boundary

## Problem

Guildhall can currently produce incompatible answers for the same project fact.
This is not only an agent-quality problem. A task's definition, indexed current
state, runtime/evidence overlay, and saved projection can be read through
different paths. Two agents can therefore report different status for the same
task without a durable way to identify the authoritative value, retain the
disagreement, or prevent execution from trusting the convenient answer.

Narrative Harness exposed the failure: its task detail showed an approved,
structured task in `exploring`, while a migration's aggregate queue scan did
not recognize the same durable handoff. Both paths claimed SQLite authority.

## Invariants

1. A project fact is addressed by `{ subjectKind, subjectId, field }` and is
   registered before any agent or route may use it operationally.
2. One captured project revision produces one `TaskStateSnapshot`: immutable
   task definition, generated current state, bounded evidence references, and
   its revision. A reader never combines these from separate reads.
3. `status` has one current-state owner. It is not independently authoritative
   in a task-definition payload, a compact index, and an effective overlay.
4. An agent submits an observation, not its own authority. The broker assigns
   producer identity and authority from the authenticated mutation path.
5. A canonical mutation, its claim, and its resolution commit in one SQLite
   transaction. A stale revision fails and recomputes; it never rewrites a
   stale aggregate queue.
6. Equal-authority incompatible claims are an integrity conflict. Execution
   fails closed and the product exposes the conflict and repair action.
   Lower-authority disagreement remains visible but cannot replace the
   canonical fact.
7. Owner questions and owner review are separate registered facts. Delegated
   Codex approval is an explicit owner action; Guildhall automation never
   manufactures either one.

## Model

`ProjectStateClaim` evolves from an in-memory reducer input into a durable,
revision-bound record:

- immutable claim id, project revision, optional runtime epoch/sequence,
  registered subject/field, typed value, broker-assigned producer/authority,
  evidence locators and digests, and supersession link;
- field registry with value schema, allowed producers, evidence/freshness
  requirements, authority ordering, merge behavior, and repair action;
- resolution snapshot containing resolved facts, rejected claims, active
  disagreements, and an arbitration revision.

Raw agent prose and transcripts stay outside this model. Evidence is a bounded
reference; prose may explain a claim but never determines it.

## Implementation Sequence

1. Introduce `TaskStateSnapshot` at `project-state-boundary`: detail, list,
   migration, and mutation planning all use the same normalized task point,
   overlays, and revisions. Make raw queue-detail readers storage-private.
2. Make definition/current ownership explicit. Remove `status` as an
   authoritative definition field, migrate existing duplicate values through
   CAS-protected point/batch writes, and fail closed on residual disagreement.
3. Add SQLite claim, resolution, disagreement, and evidence-reference tables.
   Canonical task/release/runtime mutations append their broker-owned claims in
   the same transaction.
4. Persist resolved snapshots and serve them through the project-state
   boundary. Summary, action model, coordinator, start readiness, and routes
   consume the snapshot; presentation components do not re-rank it.
5. Route external/agent observations through one broker API. Owner selection
   remains available only through owner or delegated-owner mutations.
6. Migrate saved projects, invalidate stale summaries, then replay Narrative
   Harness through Overview, Map, Work, Thread, Release, task detail, and Run.

## Proof

- Seed a promoted task whose old detail `status` conflicts with its indexed
  current state. Every public reader returns one conflict id/revision and no
  execution action; a canonical repair yields one newer matching snapshot.
- Prove mutation plus canonical claim and resolution share a SQLite revision;
  prove stale concurrent writes retry from a new snapshot instead of replaying
  an aggregate queue.
- Prove lower-authority disagreement is visible, equal-authority conflict
  blocks execution, supersession is deterministic, and invalid/stale evidence
  is rejected.
- Prove every project surface and coordinator reads the same selected scope,
  execution state, blockers, owner-review count, owner-question count, and
  arbitration revision.
- Vary all model prose while structured claim output remains unchanged; run
  `pnpm model:independence`.

## Contract Touch Decision

- Touched: normalized task detail/index ownership, project state reads and
  writes, migration planning, claim reconciliation, saved project summary,
  coordinator/start decisions, and cross-surface conflict presentation.
- Considered but deferred: raw transcript retention, release membership model,
  task hierarchy/decomposition semantics, provider routing, and external
  connector authorization.
- Apply/revert: migrations create revisioned snapshots and mark old summaries
  stale. Revert leaves the durable records auditable but does not revive a
  second runtime authority.

### Compact Review Authority Decision

- Work id: `0.13.69/project-state-arbitration`.
- Touched contracts: indexed task `currentSummary`, compact task-to-summary
  reconstruction, owner-review count, start readiness, and decision primary
  action.
- Change: persist only `specReviewAuthority: owner | coordinator` for a task
  currently in `spec_review`. Full gate rationale remains detail-only.
- Why: a compact projection otherwise knows a task is under review but cannot
  determine who owns that review. Detail and summary can then issue opposite
  instructions from the same project revision.
- Safety: absent authority on a legacy review retains the existing owner
  default. A coordinator value must be explicitly indexed. Owner questions
  take precedence over review requests in both start readiness and the
  decision packet.
- Proof: a promoted, indexed-only summary of an owner-gated review produces
  `ownerReview`, `owner_review_required`, and `review_spec`; a coordinator
  review does not. No detail payload or model prose is read.

## Schema Migration Decision

- Persisted schema: per-task definition/current ownership, claim ledger,
  resolution snapshot, disagreement records, and bounded evidence references.
- Change class: authority consolidation; required before promoted work may run
  from an arbitrated field.
- Safety: every rewrite uses the snapshot's queue/project revision; a mismatch
  rereads and recomputes. No migration imports current truth from prose or
  historical transcript text.
- Rollback: new tables are additive. A code revert may read legacy state only
  through an explicit compatibility migration; it must not write duplicate
  status ownership back into canonical task definitions.
