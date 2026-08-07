---
title: Disagreement & handoff
help_topic: design.disagreement_and_handoff
help_summary: |
  Design notes on two open questions — how reviewer personas resolve
  substantive conflicts (4-layer escalation) and how agents hand off
  mid-task without overhead.
---

# Disagreement & handoff — design notes

**Status:** partially superseded · deterministic state resolution introduced 2026-07-23

This document captures two design questions that surfaced after the Guilds
subsystem landed. The original reviewer-conflict proposal below is retained
only as historical context. Its prose/keyword-based detection is not an
implementation path: model language is evidence, never an authority signal.
The binding direction is the typed, deterministic protocol below.

The questions:

1. **How do disagreements between reviewer personas get resolved?** Current
   fan-out aggregation is strict-all (any `revise` bounces the task). That
   punts on the real question — what happens when the Security Engineer
   wants a lock-down and the UX Engineer says the lock-down breaks the
   flow?
2. **How do agents hand off mid-task without losing context or ballooning
   worktree overhead?** E.g. UX Engineer builds the form → Copywriter
   tweaks microcopy → TS Engineer tightens types. Today there's no
   first-class pattern for that sequence.

---

## 1. Disagreement adjudication

### Current binding direction

Every conclusion that can affect plan, scope, readiness, proof, execution,
or release state is a typed claim over one stable subject and field. An agent
may submit a claim and evidence references, but it cannot write the resolved
fact itself.

```ts
type Claim = {
  id: string                 // idempotency identity, never reused with new data
  projectRevision: number    // claims never cross revisions
  subject: { kind: string; id: string }
  field: string              // registered field only
  value: unknown             // typed/schema-validated value for the field
  authority: Authority       // declared precedence class, not agent prestige
  actor: string
  observedAt: string
  evidenceRefs: string[]
  supersedes?: string        // explicit, same-subject/field, policy-authorized
}
```

The field registry provides a declared authority order, value semantics, and
one prescribed reconciliation action. It is a closed registry: an
unregistered field, ambiguous policy, divergent reuse of a claim ID, or
invalid supersession is rejected. Arrival order, reviewer wording, timestamps,
and model identity do not pick a winner.

For each `(subject, field)` group the resolver publishes exactly one of:

1. A canonical typed value, with every agreeing claim ID.
2. A canonical typed value **and** a `resolved_by_authority` disagreement:
   a stronger source has a declared precedence, but the contrary evidence is
   still visible and has a deterministic refresh/verification action.
3. An `unresolved` disagreement: equally authoritative incompatible claims.
   Work whose transition depends on the field cannot proceed until the policy
   action creates a new valid claim or an owner-scope decision is explicitly
   required by that field's policy.

The current shared resolver lives in
`src/runtime/project-decision-projection.ts`; all current-state presentations
must consume its projection rather than reinterpreting agent output locally.
The status, task, release, map, and diagnostics surfaces may present the
result differently, but may not independently resolve it.

Reviewer work follows the same rule. Review prose remains an audit trace.
Operational reviewer concerns must be IDs selected from the task/review-plan
contract (for example acceptance-criterion, proof-evidence, or review-lane
IDs). A reviewer can mark those IDs satisfied, unsatisfied, or advisory; it
cannot create a routing rule by describing a concern in different words.
Reviewer findings are now first-class typed review claims. Fan-out may route a
substantive conflict only when two findings disagree on the same target.

New reviewer records now write typed findings. Each finding names an existing
acceptance criterion or proof-evidence ID and says `satisfied`, `unsatisfied`,
or `advisory`. A `revise` result with no typed unsatisfied finding is invalid
rather than becoming a worker command. Historical records remain visible, but
neither their persona identity nor their revision text can trigger coordinator
adjudication.

### Legacy-record boundary

Older reviewer records may have persona labels, free-form revision items, or
legacy `winningConcerns` fields. Guildhall preserves those records for audit
only. They cannot route work, decide a winner, create a blocker, or satisfy a
review requirement. A migration may enrich an old record only when it can map
the record to an existing typed target and evidence reference without guessing.

The active policy has three outcomes:

1. Compatible findings return work with only typed unsatisfied targets and
   their task-local instructions.
2. Contradictory findings on a proof target rerun the canonical verification.
3. Contradictory findings on a scope target return the task to canonical task
   inspection and replanning; no reviewer persona wins by identity or prose.

If the protocol cannot derive a typed target, it fails closed as invalid review
evidence. That is a repairable system error, not an invitation to make a
free-form judgment.

## 2. Agent handoff within one task

### The problem

Today a task is worked by **one** worker agent start-to-finish, then
reviewed by N personas in parallel, then gate-checked. This is fine for
tasks whose work is homogeneous (build a component; fix a bug in the
server).

Some tasks are naturally heterogeneous:

1. UX Engineer builds the form skeleton.
2. Copywriter tweaks microcopy (button labels, error messages, empty
   states) against the house voice.
3. TypeScript Engineer tightens the types on the form state machine.

Today the UX Engineer is asked to do all three. They'll do #2 and #3 less
well than a specialist would, and the review round will flag both —
costing a revision cycle to fix what could have been done in sequence.

### The shape: agent-swap-preserve-state

A task can declare a **sequence of primary agents** in its spec, each
scoped to a portion of the acceptance criteria. The orchestrator runs them
in order, in the **same worktree**, swapping just the agent + its LLM
context between steps:

```yaml
# In the task's spec, authored by the Spec Agent at `exploring`
handoff_sequence:
  - agent: frontend-engineer
    scope: [ac-1, ac-2]           # build the form skeleton
  - agent: copywriter
    scope: [ac-3]                 # tweak microcopy
    tools: [readFile, editFile]   # copywriter gets edit access for this pass only
  - agent: typescript-engineer
    scope: [ac-4]                 # tighten types
```

The orchestrator:

1. Dispatches agent 1 with a prompt scoped to its ACs. Agent completes,
   writes a structured handoff note.
2. Agent 2 starts in the same worktree. Its context is fresh (no agent-1
   history), but it reads:
   - The handoff note from agent 1.
   - The worktree diff relative to the task's base branch.
   - Its own scoped ACs.
3. Agent 2 completes, writes its own handoff note.
4. Agent 3 starts the same way. When agent 3 finishes, the task flips to
   `review` with the full fan-out pass.

### Why worktree swap, not worktree fan-out

For this handoff scenario:

- **Sequential, not parallel** — only one agent holds the worktree at a
  time. No merge conflicts to resolve.
- **Preserve working state** — agent 2 builds *on top of* agent 1's
  uncommitted changes. No "sync back to main" step.
- **Cheap** — no new worktree creation, no disk duplication.
- **Context is the only thing that swaps** — QueryEngine + message
  history are reset per agent; session persistence is keyed by
  `<task-id>:<handoff-step>` so each agent's trajectory is independently
  resumable.

The alternative (5 temp worktrees the orchestrator rotates through) only
earns its keep when agents need genuine isolation — e.g. *parallel*
workers trying different approaches. That's a different feature (FR-24
fanout_N already handles parallel worker dispatch in isolated
worktrees).

### Handoff note structure

Each agent writes, before the swap:

```markdown
## Handoff from The Frontend Engineer

**Scope completed:** AC-1 (form renders), AC-2 (submit wired)
**Scope pending:** AC-3 (microcopy), AC-4 (types)

**State at handoff:**
- Modified: src/components/SignupForm.tsx (new), src/routes/signup.ts
- New dependencies: none
- Tests: one render smoke test added, AC-2 still lacks a submission test

**Known gaps the next agent should know about:**
- Button labels are placeholder ("Submit", "Cancel") — Copywriter should
  replace per the voice.
- `FormState` type is `any` in two places where I couldn't decide the
  variant shape — TypeScript Engineer will resolve.

**Handoff to:** copywriter → typescript-engineer → review
```

The next agent's prompt leads with this note, verbatim.

### Integration with the guilds subsystem

The Spec Agent at `exploring` is responsible for declaring
`handoff_sequence` when the task has multiple specialist lanes. It does
this by consulting the applicable personas' `specContribution` — if the
Copywriter and the Frontend Engineer both apply, the spec may propose a
sequence.

By default (no `handoff_sequence` declared), the task runs as today: one
engineer start-to-finish.

### Why not just fan out at implementation time (parallel workers)?

Because:

- Parallel workers in isolated worktrees (FR-24 fanout_N) produce
  **competing** solutions to the same task. That's useful for
  exploration.
- Sequential handoff produces a **single** solution where each specialist
  contributes their slice. That's what this shape is for.

These are complementary, not redundant.

### 2.1 Open questions

- Does the Spec Agent reliably choose when to propose a handoff
  sequence, or do we need an explicit "this task needs multiple
  specialist lanes" signal during intake?
- How are *conflicts introduced by the later agent* handled? (E.g. the
  Copywriter tightens button labels, which changes the form state
  machine the TS Engineer then tightens types on.) Probably: each swap
  re-reads the worktree diff and each agent's scope stays bounded to
  their ACs.
- What happens if agent 2 fails partway through? The worktree has agent
  1's work + partial agent 2 changes. Coordinator remediation (FR-32)
  decides: resume agent 2 from checkpoint, revert agent 2's changes and
  retry, or escalate. Same remediation machinery as today, keyed by
  handoff-step.
- Tool authority per step: the Copywriter doesn't normally get
  `editFile`. Handoff steps may **temporarily** grant additional tools
  scoped to the step. The spec must declare the escalation.

### 2.2 Non-goals

- No multi-agent concurrency within one handoff step. One agent holds
  the worktree at a time in a sequence.
- No automatic sequence inference — the Spec Agent proposes; the user
  approves. No silent routing.

---

## Next steps

1. Project reviewer records and coordinator outputs through the shared
   project-state resolver so every user-facing surface reports the same
   contested targets and recovery action.
2. Replace legacy review records during normal rewrite only when their typed
   subject and evidence can be established without inference.
3. Keep the separate handoff design above isolated until it has a typed
   task-contract proposal and a real workload to validate it.
