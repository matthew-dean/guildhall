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
8. A decision focus is an atomic reference to a canonical task point. It has
   one task id, that point's display title, and its snapshot revision. A saved
   action may not carry an independently preserved title, recover identity
   from an href, or mix fields from a different snapshot.

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

### Decision-Focus Repair

The first production use of this boundary repairs an actual disagreement:
Narrative Harness advanced its owner-review task id after approval, while a
saved decision retained the prior task's title. This was not a model judgment
dispute. It was a partial merge that represented one focus as independent
`focusTaskId` and `focusTaskTitle` fields.

`0.13.70/atomic-decision-focus` makes the decision own one `focus` reference.
The title is copied only from the normalized task point captured in the same
SQLite snapshot. Legacy scalar fields remain temporarily for wire
compatibility, but are derived from the atomic reference. If a canonical task
cannot be found, the decision must refresh or conflict rather than inventing a
label. The migration invalidates old summaries and rebuilds their shared
decision from indexed task points.

## Durable Decision Snapshot: First Vertical Slice

`0.13.71/durable-decision-snapshot` moves the existing closed claim resolver
from a testable runtime helper into the project-state boundary. It does **not**
create a second source of task or release truth.

### Stored Rows

The additive SQLite schema has three bounded tables:

1. `project_state_claims`: immutable typed observations. A row carries the
   claim id and fingerprint, project revision, subject, registered field,
   typed JSON value, broker-assigned authority/actor, observed time, evidence
   locators, basis, and optional supersession id. The value is structured data;
   raw agent prose is neither stored nor accepted as a field value.
2. `project_state_disagreements`: the resolver's compact result for active
   contradictory claims. It records the revision, registered subject/field,
   canonical/contradictory ids, state, and the policy reconciliation action.
   It is replaceable derived state, not a competing fact ledger.
3. `project_state_decisions`: exactly one compact decision packet for a
   project revision. It stores the resolved decision JSON plus a deterministic
   digest of the claim set and its resolution. It is intentionally one row per
   current project: fleet reads get no task inventory or evidence bodies.

Claims and the resolved packet are committed in the same SQLite transaction as
the current summary/scope projection. The packet's `projectRevision` and
`queueRevision` must match that transaction's canonical snapshot. The read
bundle returns it from the same read transaction as queue, summary, scope, and
runtime. A mismatched, absent, or malformed packet means the summary is stale;
routes do not reconstruct a competing decision from individual cards.

### Initial Claim Producers

This first slice materializes only canonical facts already owned by the
normalized snapshot: selected release, the planned execution focus, and
execution eligibility. Their producer is the project-state boundary with
`canonical_mutation` authority. It is a snapshot derivation, not an agent
claiming authority for itself.

The planned focus is deliberately distinct from `runtime.activeTaskId`. The
former is a selected-scope planning fact; the latter is a live supervisor fact.
They can differ without being a disagreement, and neither is allowed to rename
the other.

External agents are deliberately not accepted by this migration. The next
slice adds a broker append API with authenticated producer identity and policy
validation for verifier/runtime/Git observations. Until then, agent prose
cannot create an operational disagreement record by itself.

### Conflict Behavior

For any two claims with the same revision, subject, field, and basis:

- a stronger registered authority wins, while the losing observation remains a
  visible `resolved_by_authority` disagreement;
- same-authority incompatible values create `unresolved`; the decision is
  `conflicted`, Start is unavailable, and every surface points to the
  registry's one reconciliation action;
- stale revisions, unknown fields, malformed evidence, and invalid
  supersession are rejected, never guessed around;
- an owner decision is valid only for registered scope choices. Work sizing,
  execution focus, review state, proof, runtime, and repository facts resolve
  through their owning machine-readable source.

### Schema Migration Decision

- Persisted schema: additive v36 tables `project_state_claims`,
  `project_state_disagreements`, and `project_state_decisions` with revision
  and subject/field indexes.
- Migration id: `0.13.71/durable-decision-snapshot`.
- Existing-data impact: current normalized task/release rows are backfilled as
  broker-owned canonical claims during the next summary refresh. Existing
  summaries without a same-revision decision packet are stale; no transcript
  or old summary prose is backfilled.
- Safety: every writer uses its existing project/queue revision compare-and-
  swap, then writes canonical claims, resolution, summary, scope, and decision
  in one SQLite transaction. A stale writer rolls back as a unit.
- Compatibility: legacy readers may see their existing summary during rollout,
  but promoted read bundles reject a current summary whose decision packet is
  absent or revision-mismatched. There is no reader-side decision fallback.
- Fixtures/tests: a compact fixture proves canonical task/release claims and a
  matching packet; a lower-authority disagreement remains inspectable; an
  equal-authority contradiction fails closed; a stale packet cannot be served
  as current.
- Apply/revert: apply by opening the database and refreshing the compact
  projection. Revert by disabling packet consumption and rebuilding summaries;
  additive rows remain inert audit data and no task/release mutation is lost.

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
