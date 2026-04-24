---
title: Disagreement & handoff
help_topic: design.disagreement_and_handoff
help_summary: |
  Design notes on two open questions — how reviewer personas resolve
  substantive conflicts (4-layer escalation) and how agents hand off
  mid-task without overhead.
---

# Disagreement & handoff — design notes

**Status:** draft · pre-SPEC · 2026-04-23

This document captures two open design questions that surfaced after the
Guilds subsystem landed. Both will fold into SPEC.md once the shapes are
validated through real task runs; keeping them here first so the spec stays
authoritative while the design settles.

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

### Current behavior (as of the Guilds landing)

`aggregateFanout` in `src/runtime/reviewer-fanout.ts` treats review as
**strict-all consensus**: every persona must approve for the task to
advance. Any single `revise` combines all dissenters' feedback into one
prompt for the worker and bounces the task to `in_progress`. Revision
counting + `maxRevisions` escalation mirrors the existing reviewer path.

This works for *additive* conflicts — "add focus ring" + "don't blow the
bundle budget" can both be satisfied by the worker choosing its
implementation carefully. It fails for *substantive* conflicts:

- Security Engineer: "Require email verification before a user can
  post."
- UX Engineer / Product Designer: "Email verification before first post
  kills new-user activation."

The worker in round 1 can't adjudicate between these because the decision
isn't technical — it's about which business value wins. Looping the
worker through N revisions just exhausts `maxRevisions` and escalates to
human, but by then the audit trail is a pile of failed attempts with no
structured decision record.

### The shape

Four layers of resolution, escalating only when the cheaper layer fails:

#### Layer 1 — Worker-as-synthesizer (default)

Worker reads all dissenting revisions, attempts a single change that
addresses every one. Suitable for additive conflicts. No new
infrastructure — this is today's behavior and stays the default.

#### Layer 2 — Coordinator-as-adjudicator (on detected conflict)

When the fan-out aggregation detects a substantive conflict — defined by
the heuristic in §1.1 below — the task routes to the **Coordinator**
(FR-02 domain owner) instead of bouncing to the worker.

The Coordinator receives:

- The full task spec + acceptance criteria.
- Every persona's verdict, tagged with guild slug.
- The set of dissenters and their revision items.
- The persisted conflict record (which personas, which rounds).
- The parent goal's guardrails (FR-23) so the decision can be checked
  against the business envelope.

The Coordinator emits a **binding decision** logged to DECISIONS.md:

```yaml
kind: reviewer-fanout-adjudication
task: task-123
trigger: same-persona-repeat-dissent
dissenters: [security-engineer, frontend-engineer]
decision: "Security requirement wins: ship with email verification.
  Refine UX by deferring the gate until second post (see rationale).
  Worker re-scoped accordingly."
winning_concerns: [security-engineer]
superseded_concerns: [frontend-engineer.ux-activation]
rationale: |
  Goal guardrail "SOC-2 compliance by Q3" is load-bearing; the
  activation delta is measurable but reversible. Deferring the gate to
  second post satisfies both within the envelope.
scope_instructions:
  - "Keep email verification before any posting action"
  - "Allow one draft post in an unverified state to preserve activation"
rolled_forward: true
policy_version: v1
```

The worker's next prompt is the **scoped instructions** only, not the
original conflict. This prevents the worker from relitigating the
Coordinator's decision.

Workers *never* adjudicate between expert personas. That authority lives
with the Coordinator (or human, §1.4).

#### Layer 3 — Reviewer deliberation (optional, opt-in)

For projects that want softer consensus: after round 1, each dissenting
persona sees the *other* dissenters' verdicts and gets a chance to
**amend** its own revision items. This produces synthesized verdicts
("Security Engineer: given the UX concern, deferring verification to
second post is acceptable") without coordinator intervention.

Cost: N extra LLM calls per round. Useful when the provider is cheap and
the roster is small, not when dispatching local models.

Opt-in via lever `reviewer_fanout_policy: deliberate_before_adjudicate`.

#### Layer 4 — Human-as-adjudicator (escalation)

If the Coordinator's remediation choices are exhausted (FR-32
`escalate_to_human`), the task raises an escalation with the full
dissent + adjudication history attached. The human issues a binding
decision recorded the same way the Coordinator's would be.

### 1.1 Detection heuristic: when to trigger Layer 2

The cheap heuristic to avoid false positives:

1. **Same-persona-repeat-dissent**: the same persona emits `revise`
   across two consecutive rounds with overlapping `revisionItems` (≥50%
   token overlap on the item text).
2. **Mutual-exclusion keywords**: any revision item contains a
   negation-of-another-item pattern (`"do NOT do X"` where another
   persona asked for X). Detected via a simple regex scan; false
   positives are fine because the coordinator can always return "no
   conflict, retry with worker."
3. **Explicit escalation by a persona**: any persona's revision item
   that names another persona's concern as "blocking my review" (e.g.
   Security Engineer: "Cannot approve while the UX flow bypasses auth
   as suggested by the UX Engineer"). Detected via a structured hint
   the persona prompt can emit: `**Conflict:** <other-slug>` line.

Tuning: start with just (1). Add (2) and (3) only if round-1 worker
synthesis proves unreliable in practice.

### 1.2 The lever

```yaml
reviewer_fanout_policy:
  - strict           # current: strict-all, worker synthesizes or loops to maxRevisions
  - coordinator_adjudicates_on_conflict  # recommended default once implemented
  - deliberate_before_adjudicate         # Layer 3 opt-in
  - advisory                             # any approval passes; dissents become notes
  - majority                             # ≥50% of applicable personas must approve
```

Scope: per-domain. A high-stakes domain (billing, auth) can pick
`coordinator_adjudicates_on_conflict` while a low-stakes one
(internal-tool UI) stays `strict`.

### 1.3 Audit trail requirements

Every adjudication decision writes:

- A **DECISIONS.md** entry in the shape shown in §Layer 2 above.
- Per-persona `ReviewVerdict` records on the task stay unchanged —
  they're the inputs the adjudicator reasoned over.
- A new `AdjudicationRecord` on the task: `{round, trigger,
  dissenters[], winningConcerns[], supersededConcerns[], rationale,
  scopeInstructions[], decidedBy, decidedAt}`. Persisted alongside
  `reviewVerdicts`.

The dashboard's Experts tab (separate work — see dashboard observability)
renders each persona's verdict **plus** the adjudication that superseded
it, so the audit trail is visible without grepping DECISIONS.md.

### 1.4 Roles that are NOT the adjudicator

- **A dedicated "Adjudicator" persona** — unnecessary. The Coordinator
  already carries domain context + decision authority per FR-02.
  Adding a parallel role would split that authority.
- **The Project Manager** (overseer) — adjudicates process conflicts,
  not substantive ones. A PM shouldn't decide whether security beats UX.
- **The worker** — never. Workers execute within scope; they don't
  decide which experts' scopes win.

### 1.5 Open questions

- How do we detect "overlapping revision items" robustly? Token overlap
  works for most cases; semantic overlap requires an embedding-ish call
  which adds cost.
- Should the Coordinator's adjudication decision be *itself* reviewable
  by a human before the worker sees it, for high-stakes domains? Probably
  yes under a strict governance posture; should be a lever position.
- What happens when two Coordinators' domains both apply (cross-domain
  conflict)? Use the CrossDomainRequest protocol from FR-02; extend it
  with an `adjudication` request type.

---

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

Neither item blocks the in-flight dashboard observability work. Once
that's landed:

1. **Disagreement adjudication (§1)** — add the
   `reviewer_fanout_policy` lever with positions `strict` (current)
   and `coordinator_adjudicates_on_conflict`. Ship the
   same-persona-repeat-dissent heuristic. Dashboard renders the
   adjudication record alongside the dissenting verdicts.
2. **Agent handoff (§2)** — start with a minimal `handoff_sequence`
   field on Task and orchestrator support for two-step sequences
   (engineer → engineer). Copywriter/specialist edit access comes
   later once the edit-tool grant mechanism is designed.

Both absorb into SPEC.md once a real workload has stressed them and the
shape holds up.
