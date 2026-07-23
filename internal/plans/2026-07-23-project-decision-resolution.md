# Project Decision Resolution

## Problem

Guildhall currently saves overlapping answers to the same question: a project
summary has `nextAction`, an action-model cache has a primary action, the
release summary has blockers, and diagnostic routes can independently rebuild
readiness. They can all be individually defensible while still contradicting
one another. That is not a display problem. It means an agent or surface can
say it observed a fact while another calls the same fact invented.

The Narrative Harness replay makes the failure concrete:

- the compact project read says a task is ready to run;
- its cached primary action says that same task needs a brief;
- the diagnostic read says missing completion proof is the immediate action;
- release readiness says the release cannot ship because of that proof debt.

Two of those facts may coexist: work can be runnable while the release is not
ready to ship. The failure is that the existing model does not express those
as distinct decisions, and lets several readers choose their own winner.

## Outcome

Every project revision has one compact `ProjectDecisionProjection`. It is the
only authority for ordinary product surfaces to answer:

- What can Guildhall execute now?
- Can the selected release ship now?
- What is the primary user action, and why?
- Is there an unresolved disagreement that limits what Guildhall may claim or
  do?

Overview, Work, Map, Thread, fleet cards, `Start`, diagnostic responses, and
release readiness format this packet. They may add bounded evidence detail;
they must not recalculate the decision or rank an alternate action.

## Four Separate Layers

This is not a second project-state system. It is the decision end of the
existing canonical project-state boundary.

1. **Fact claim**: a typed assertion about one field of one subject at one
   project revision. It records actor, authority kind, evidence references,
   observation time, and canonical JSON value. Raw agent prose is neither a
   value parser nor an authority.
2. **Field policy**: a finite registry declaring which authority kinds may
   settle a field and how otherwise-valid claims are compared.
3. **Resolved fact**: the deterministic result of applying the policy to
   claims for that revision. It includes the winning claim ID or an explicit
   conflict ID.
4. **Project decision**: a compact projection derived only from resolved
   facts: execution, delivery/release, primary action, and conflicts.

An agent can contribute a claim. It cannot declare a final project decision.
The resolver is code at the shared boundary, and the API exposes the evidence
that led to its result.

## Claim Contract

```ts
type DecisionSubject = 'project' | 'release' | 'task' | 'proof' | 'runtime'

type DecisionAuthority =
  | 'owner_selection'
  | 'canonical_mutation'
  | 'verified_observation'
  | 'runtime_observation'
  | 'imported_record'
  | 'agent_derivation'
  | 'agent_proposal'

interface ProjectStateClaim<T = unknown> {
  id: string
  projectRevision: number
  subject: { kind: DecisionSubject; id: string }
  field: string
  value: T
  valueHash: string
  authority: DecisionAuthority
  actor: string
  observedAt: string
  evidenceRefs: string[]
  supersedes?: string
}
```

Claims are validated at the existing write boundary, not stored as a second
general-purpose agent ledger. A claim whose schema, project revision, subject,
field, or evidence contract is invalid is rejected rather than silently
downgraded into a suggestion. An agent proposal must become a valid mutation in
the canonical task, runtime, proof, release, or owner-input record before it
can affect a decision. A model-produced sentence may be saved as
display/audit evidence, but it cannot create an operational claim by being
parsed for wording.

## Field Policies

Authority is field-specific. There is deliberately no global rule such as
"human wins" or "latest agent wins."

| Field family | Settling authority | Agent role |
| --- | --- | --- |
| Selected release and owner-set scope | `owner_selection`, then canonical mutation | propose a scoped change only |
| Task lifecycle, hierarchy, dependencies | canonical mutation backed by the normalized task boundary | produce a validated mutation request |
| Runtime liveness and active run | current runtime observation | report current process evidence |
| Completion and proof status | verified observation tied to task lifecycle and command/evidence IDs | prepare/run verification, never settle from prose |
| Repository landing | verified observation / canonical landing record | report typed Git evidence |
| Charter, audience, intent | owner-authored/confirmed field; otherwise explicitly `inferred` | infer with source refs, never call it confirmed |
| Primary action | derived only from resolved execution, release, and owner-input facts | no direct claim allowed |

The policy registry owns allowed authorities, value semantics, and the required
reconciliation action. Project-revision checks are enforced now. Lifecycle
freshness is a required follow-up before proof or review claims can be used to
settle a reopened task; it is not yet safe to imply that a timestamp alone
settles that question.

### Registered Operational Fields

The resolver has a closed registry for the facts Guildhall currently projects
across surfaces: selected release and scope, charter confirmation, release
blocker task IDs, task lifecycle/hierarchy/dependencies/capability bindings,
review criterion and evidence dispositions, proof status, runtime status, and
repository landing status. A route or agent cannot add a new field ad hoc.

Each field declares its permitted source classes and recovery action. For
example, runtime disagreement means refresh runtime evidence; proof evidence
disagreement means rerun verification; a disagreement about canonical task
structure means inspect the task boundary. Ordinary task sizing and
decomposition have no owner-approval path: an agent may propose or apply a
validated canonical mutation through the task boundary. Owner selection is
reserved for actual project-scope choices such as release and charter intent.

## Deterministic Reconciliation

For a subject/field/revision tuple:

1. Reject malformed, superseded, stale-revision, or evidence-incompatible
   claims.
2. Apply the field's allowed authorities and freshness rule.
3. Select the unique highest-ranked compatible claim.
4. If equally authoritative claims have the same canonical value, coalesce
   them and preserve both evidence trails.
5. If equally authoritative claims disagree, emit `state_conflict`; do not
   invent a winner. The policy supplies a typed reconciliation action such as
   rerun a command, refresh a runtime observation, inspect a canonical task
   mutation, or request an owner scope decision.

An explicit conflict is a deterministic outcome. It prevents the dependent
decision from claiming certainty, but it does not automatically stop unrelated
ready work. For example, a conflict about a release's proof status can block
shipping while independent execution remains runnable.

## Project Decision Projection

```ts
interface ProjectDecisionProjection {
  version: 1
  projectRevision: number
  queueRevision: number | null
  generatedAt: string
  execution: {
    state: 'runnable' | 'running' | 'paused' | 'blocked' | 'complete' | 'conflicted'
    code: string
    focusTaskId?: string
    focusTaskTitle?: string
    reason?: string
  }
  release: {
    state: 'ready' | 'not_ready' | 'unavailable' | 'conflicted'
    releaseId?: string
    blockerTaskIds: string[]
    proofBlockerTaskIds: string[]
  }
  ownerInput: { state: 'none' | 'required'; requestId?: string }
  primaryAction: {
    kind: 'open_work' | 'resume' | 'review_proof' | 'answer_owner_input'
      | 'review_release' | 'resolve_conflict' | 'none'
    targetId?: string
    reasonCode: string
  }
  conflicts: Array<{
    id: string
    subject: { kind: DecisionSubject; id: string }
    field: string
    claimIds: string[]
    reconciliation: 'rerun_verification' | 'refresh_runtime'
      | 'inspect_canonical_state' | 'owner_scope_decision'
  }>
}
```

`execution` and `release` are intentionally separate. The UI can truthfully
say “this task can run now; the release still needs proof” without choosing one
fact to erase the other. `primaryAction` is a small typed command derived from
those fields, then rendered by the shared action component. It replaces the
persisted `nextAction` and `actionModel` as independent decision sources.

## Migration

1. Add the typed decision projection to the existing project-summary payload,
   keyed to the existing SQLite project and queue revision. Do not add a
   separate unbounded agent transcript store.
2. Build it in both current summary writers from canonical indexed state and
   runtime/owner envelopes. The old `nextAction`, `releaseSummary`, and
   `actionModel` remain only as same-version display compatibility during this
   commit, never as an input to a new decision.
3. Change compact Overview/Work/Map/Thread, diagnostic project reads, Start,
   and release-readiness to render the packet. Add the packet revision to each
   response.
4. Pass typed claims into the resolver from the existing canonical mutation and
   observation boundaries. Do not add a generic claim table or persist a second
   durable version of task, proof, runtime, or release truth.
5. Remove `nextAction` and `actionModel` from persisted summary authority after
   every consumer uses `ProjectDecisionProjection`. Bump the summary schema and
   rebuild all derived projections; do not preserve dual-reader behavior.
6. Extend the normalized review/proof records with stable criterion, evidence,
   lifecycle, and verification-run IDs. The claim resolver remains a
   non-persistent reconciliation boundary; reviewer prose stays audit material
   and never becomes a second state store. Once lifecycle freshness is
   available, reject completion/proof claims that predate a task reopen.

## Verification

- A response matrix asserts identical decision version, execution state,
  focus task, release blocker IDs, primary-action kind, and conflict IDs across
  Overview, Work, Map, Thread, project detail, and release readiness.
- A fixture with runnable work plus missing proof proves execution remains
  runnable while release remains `not_ready`.
- A stale cached task action cannot change the decision.
- Two equal-authority contradictory proof/runtime claims produce a visible
  `state_conflict` and the prescribed typed recovery action, never a winner
  selected by prose or timestamp alone.
- A lifecycle reopen invalidates old completion/proof claims.
- Installed Narrative Harness replay asserts the same decision packet before
  and after restart, and checks the visible controls against it at desktop and
  mobile widths.

## Non-Goals

- This does not make every agent output permanent state.
- This does not make owner approval a gate for ordinary decomposition or task
  sizing.
- This does not collapse release readiness into execution readiness.
- This does not allow prose matching, model confidence, or a UI component to
  decide project state.
