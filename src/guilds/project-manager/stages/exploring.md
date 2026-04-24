# Stage: `exploring`

The Spec Agent is in conversational intake with a human (FR-12). Output is a spec appropriate to lever `spec_completeness`, plus an inferred set of lever positions and (if needed) a task decomposition (FR-13). Depth of the spec is a lever decision, not a personal preference.

## What "good" looks like

- **Elicit in project terms, infer in system terms.** Ask about the work, the past, the guardrails. Do NOT ask "how autonomous should I be?" — that breaks the magic UX (FR-12 constraint). Lever positions come from fluency, vocabulary, past practice, stated risk tolerance.
- **Write inference rationale as you go.** Each lever position you set goes into `memory/agent-settings.yaml` with a `# reason:` comment so a future agent can audit *why* the position was chosen. Never set a lever silently.
- **The transcript is the artifact.** `memory/exploring/<task-id>.md` must capture every load-bearing exchange. The spec is a summary; the transcript is the source of truth.
- **Acceptance criteria are independently verifiable.** If a criterion reads "the code is clean," rewrite it. If it reads "typecheck passes AND the /login route 302s for valid creds," ship it.
- **Record planned escalations, don't guess.** If the user cannot answer a load-bearing question, write it into the spec as a planned escalation trigger — future agents will resolve it rather than inherit a fabricated answer.
- **Decompose when the ask is a group.** If the work is really N tasks with dependencies, propose a task group (FR-13). Parent completes when children complete.

## Sub-stages

1. **Outcome framing** — one sentence of success. No acceptance criteria yet.
2. **Scope drawing** — in/out, blast radius (FR-12). Out-of-scope list is load-bearing.
3. **Acceptance drafting** — numbered, verifiable. Depth per `spec_completeness`.
4. **Routing + envelope** — coordinator domain, parent goal, guardrails check.
5. **Lever inference** — persist with rationale.
6. **Decomposition check** — one task or a group?
7. **Draft review** — user approves → `spec_review`.

## How this stage is evaluated

The Spec Agent is done when:
- The user approves the draft (default gate; overridable by `task_origination`).
- `memory/exploring/<task-id>.md` exists and is non-empty.
- Every lever set has an inference rationale.
- Ambiguities are either resolved or recorded as planned escalation triggers — never silently assumed.

## Handoff

- Transition to `spec_review` with the approved draft.
- If decomposed, emit the child-task graph with explicit dependency edges.
- Log a milestone progress entry naming the parent goal.
