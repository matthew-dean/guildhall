# Guildhall Construction Runtime Integration Spec

## Purpose

Turn the project-construction manifesto from documentation into runtime product
behavior.

Guildhall should operate as a guild building software from evolving plans:
survey the site, draft the blueprint, frame the work, assign trades, inspect
the result, record change orders, and finish the punch list. The runtime should
make that model visible and useful without turning process into bureaucracy.

## Product Thesis

Process serves the project and product. Guildhall should create enough
structure for agents to act deterministically where determinism helps, while
protecting the human owner from unnecessary process and routine implementation
questions.

The correct behavior is not "ask the owner everything." The correct behavior is
"infer or recommend routine choices, ask when owner intent or product quality
depends on the answer, and leave durable artifacts when the plan changes."

## Scope

This spec covers the first implementation slice for `0.6.0` construction-model
behavior:

- agent instructions
- construction-mode metadata
- proportional-question guidance
- durable artifact expectations
- change-order representation
- Thread/task payload visibility
- focused runtime tests

This spec does not implement the full project-manager release-shaping layer.
It prepares the substrate so later release planning can use the same concepts
instead of inventing a parallel model.

## Definitions

### Construction Mode

A task or agent turn can be in one primary construction mode:

- `survey`: gather reusable project facts and constraints.
- `blueprint`: define intended work, acceptance criteria, non-goals, and
  verification.
- `frame`: group work into phases, dependencies, active tranches, and task
  boundaries.
- `build`: implement a bounded piece against the accepted blueprint.
- `inspect`: compare completed work against the blueprint and standards.
- `change_order`: revise scope, sequencing, or assumptions based on evidence.
- `punch_list`: finish or explicitly defer small remaining work.

### Durable Artifact

Narration is not progress. Progress requires one of:

- project map
- release or phase plan
- task blueprint/spec
- acceptance criteria
- explicit question
- decision record
- change order
- implementation diff
- verification result
- review finding
- gate result
- learning or policy update

### Proportional Process

The level of process must match risk and blast radius.

Agents should ask the owner when the answer affects:

- product intent
- audience
- presentation
- content
- user flow
- risk
- data ownership
- budget/cost
- release criteria
- meaningful scope boundaries

Agents should infer, recommend, or choose defaults for routine implementation
mechanics when the project gives enough evidence.

## Required Behavior

### 1. Spec Agent Produces Blueprints, Not Question Dumps

The spec agent must treat exploring work as blueprint drafting.

It should:

- infer routine implementation choices from repo evidence
- ask no more than the smallest set of high-value owner questions needed for
  the next durable artifact
- prefer bounded `choice`, `yesno`, or `confirm` questions over open-ended text
- recommend one default plus at most one or two alternatives when a routine
  technical choice matters
- create or update a product brief before asking questions when the questions
  need context
- move to `spec_review` once it has enough blueprint detail for build and
  inspection

It must not:

- ask broad kickoff questions when the repo and task provide a safe starting
  point
- ask the owner to select from exhaustive technical menus
- treat transcript narration as progress
- write a product brief about the agent's process instead of the desired
  project outcome

### 2. Coordinator Acts as General Contractor

The coordinator must inspect specs as blueprints.

It should:

- approve buildable blueprints
- return over-questioned specs to exploring with a recommendation request
- escalate only when owner intent or risk genuinely cannot be inferred
- record meaningful plan changes as decisions or change orders
- keep ready-task claiming in the runtime, not in coordinator prose

It must not:

- approve specs that offload routine implementation strategy to the owner
- escalate routine mechanical choices when repo evidence supports a default
- let ready work drift into invisible or unscoped project state

### 3. Worker Performs Trade Work Against the Blueprint

The worker must treat the spec as the accepted blueprint.

It should:

- read likely target files and verification context first
- make the smallest change that satisfies acceptance criteria
- use repo-consistent defaults for routine implementation choices
- repair self-authored verification failures without asking the owner
- record a self-critique and verification proof before handoff
- raise a change-order-style escalation when evidence proves the blueprint is
  wrong

It must not:

- invent missing helpers before checking actual repo structure
- ask the owner about ordinary file organization, imports, components, or
  library choices when the repo already answers the question
- push forward on a bad blueprint without naming the changed assumption and
  evidence

### 4. Reviewer Performs Inspection Against the Blueprint

The reviewer must inspect the work against the accepted blueprint and selected
rubrics.

It should:

- judge each acceptance criterion independently
- distinguish task-local regressions from pre-existing project issues
- request revision only for unmet blueprint requirements or meaningful
  task-local risk
- request a change-order-style decision when the blueprint itself is wrong

It must not:

- reject correct task-local work because it imagines a broader renovation
- turn a plan problem into vague "needs revision" feedback

### 5. Runtime Preserves Construction Context

The runtime should surface construction state where it already has enough
information:

- `exploring` and `spec_review` map to `blueprint`
- `ready` maps to `frame`
- `in_progress` maps to `build`
- `review` maps to `inspect`
- `gate_check` maps to `inspect`
- `blocked` with plan/scope/spec ambiguity maps to `change_order`
- `done` with unresolved follow-ups maps to `punch_list`

This does not require a large schema migration in the first slice. It can start
as derived metadata in Thread/task payloads and explicit agent prompts.

### 6. Questions Must Carry a Reason

When the spec agent asks the owner a question, the task UI should be able to
answer:

- what artifact this question blocks
- why Guildhall could not safely infer the answer
- what recommended option exists, if any

First slice can enforce this through prompt tests and existing question shape.
Later slices can add explicit structured fields.

### 7. Change Orders Become First-Class

When a worker or reviewer discovers that the blueprint is wrong, the system
should record:

- old assumption
- new evidence
- proposed change
- scope or sequencing impact
- whether owner approval is required

First slice can represent this in escalation/note text and tests. Later slices
can add a typed `changeOrders` collection on tasks.

## Non-Goals

- Do not build the full release-planning/project-manager screen in this slice.
- Do not introduce a large task schema migration until UI and runtime needs are
  proven.
- Do not make construction terminology mandatory on every UI label.
- Do not slow task execution with new human approval steps for routine
  technical choices.
- Do not make agents over-plan tiny tasks.

## Acceptance Criteria

1. Spec-agent prompt frames exploring as blueprint work and includes
   proportional-question rules.
2. Coordinator prompt frames the role as general contractor and rejects
   unnecessary owner-question burden.
3. Worker prompt frames implementation as trade work against a blueprint and
   describes change-order escalation.
4. Reviewer prompt frames review as inspection and distinguishes task-local
   revisions from blueprint change orders.
5. Prompt-level regression tests protect the construction model, proportional
   question rule, and change-order language.
6. Runtime or Thread payload has a small derived construction mode helper with
   tests, unless the implementation plan explicitly defers it to the next
   slice.
7. Docs and flow audit point from the manifesto to this implementation spec and
   plan.
8. Verification passes:
   - `pnpm vitest run src/agents/__tests__/guildhall-agent.test.ts --coverage=false`
   - `pnpm typecheck`
   - `pnpm docs:build && pnpm docs:check-help-sync`

## Open Questions

None for this first slice. The typed `changeOrders` schema and a full project
journey UI should be designed as follow-up work after the derived-mode and
prompt behavior prove useful.
