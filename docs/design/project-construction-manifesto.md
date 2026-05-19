---
title: Project construction manifesto
---

# Project construction manifesto

**Status:** working philosophy for `0.6.0+`

Guildhall is not just an agent runner. It is a guild for building software:
different experts, different trades, one shared job site, one evolving plan,
and enough visible structure that each next worker can act with confidence.

The product should feel like a guild hall organized around real work. The user
should be able to see what is being planned, what is being built, what is being
inspected, what changed, and what is ready to ship without reading a transcript
of every internal thought.

## Thesis

Software projects should not move through Guildhall as a loose pile of prompts
and task cards. They should move through a project-construction loop:

1. survey the site
2. draft the blueprint
3. frame the work
4. assign the trades
5. inspect against the plan
6. handle change orders
7. finish the punch list
8. decide whether the work is livable or shippable

This is not waterfall. A project does not need every blueprint for every room
before anyone can lay a foundation. But each layer of work should leave behind
enough durable structure that the next guild member is filling in a known
shape, not free-associating from scratch.

Guildhall's job is to keep that shape alive.

The shape is not chosen from a fixed catalog. Most projects do not arrive with
one obvious frame waiting to be filled in. The guild composes a sensible
structure from known constraints, user intent, project materials, unanswered
questions, and the standards that apply to the piece of work in front of it.
The goal is balance: plans, tasks, tests, UI, docs, and release criteria should
fit together as one coherent project, not as locally-correct parts that fight
each other.

Process serves the project and the product. Guildhall should never make the
construction model so detailed, ceremonial, or cumbersome that it stalls real
results or lowers real product quality. Planning is useful when it helps the
guild make better work with less confusion. It is harmful when it becomes an
excuse to flood the owner with questions the guild should be able to infer,
recommend, or safely bound.

Most software work is not clever in its mechanics. What is usually unique is
the idea, audience, presentation, content, user flow, constraints, and taste.
Guildhall should spend human attention there. For routine implementation
choices, it should infer a good default from the project and offer a small set
of options only when the choice meaningfully affects the product. Do not ask
the owner to choose from every database engine. Decide whether a database is
needed; if it is, recommend one engine with a short rationale and maybe one or
two realistic alternatives.

## What This Represents

This model covers the parts of software development where structure, balance,
review, and handoff matter most:

- **Product planning:** project goals, releases, phases, scope boundaries,
  dependencies, priorities, and active work tranches.
- **Requirements and specification:** task briefs, acceptance criteria,
  user-facing behavior, constraints, non-goals, and unresolved questions.
- **Architecture and integration planning:** component boundaries, API
  contracts, data flow, file ownership, migration paths, and compatibility
  risks.
- **Implementation:** source edits, tests, docs, scripts, migrations, and UI
  changes performed by worker agents against an accepted plan.
- **Verification:** deterministic commands, browser checks, screenshots,
  review gates, coverage, type checks, linting, smoke tests, and release
  readiness checks.
- **Review and governance:** expert review, disagreement resolution,
  change-order approval, audit trails, and lessons that become future policy.

It does not mean Guildhall should over-plan every tiny edit, or force every
project through the same predetermined plan. The model exists to make the path
legible and repeatable when work crosses a handoff boundary, affects product
behavior, changes shared contracts, or needs trust before it can ship.

Repeatability comes from the questions Guildhall asks and the artifacts it
requires, not from pretending every project has the same architecture.

The questions should be scarce and high-value. Ask the owner when the answer
changes product intent, audience, risk, budget, data ownership, user experience,
or release criteria. Infer, recommend, or choose a default when the question is
mostly mechanical and the project already gives enough evidence.

## The Construction Model

### Site Survey

Before work begins, Guildhall surveys the project site:

- repo shape
- package managers and commands
- existing docs and plans
- dirty state and worktree safety
- model/provider availability
- current project memory
- known constraints

The output is not a transcript. The output is a site record that future agents
can use: "this is where we are building, these are the utilities, these are the
hazards, and these are the known rules."

### Blueprint

A blueprint is the accepted shape of intended work. It can exist at multiple
levels:

- project charter
- release plan
- phase plan
- task spec
- API contract
- UI journey
- component contract
- verification plan

A blueprint should answer:

- What are we building?
- Why does it matter?
- What is in scope?
- What is out of scope?
- What does done mean?
- What evidence will prove it?
- What assumptions are still risky?

Blueprints can be revised, but revision should be explicit. If the plan changes
because reality taught us something, that is a change order, not a silent drift.

Blueprints should also be proportional. A small task needs a small blueprint.
A large release needs more framing. The right level of detail is the smallest
amount that lets the guild build, inspect, and recover without guessing about
owner intent.

### Foundation

The foundation is the prepared ground that makes execution safe:

- isolated worktree
- clean or intentionally packaged git state
- dependencies installed
- environment variables understood
- baseline verification command known
- likely mutation files identified
- owner/user intent captured

No worker should be asked to build on a foundation it cannot inspect.

### Framing

Framing turns the blueprint into a buildable structure:

- break work into phases or tranches
- identify dependencies
- define task boundaries
- assign which guild role owns which decision
- connect questions to the task they affect
- decide what can run now and what must wait

The frame is what prevents a project from becoming 75 disconnected drafts or a
thread full of unrelated cards. It gives the backlog a shape.

### Trade Work

Trade work is implementation. Workers modify the project, but they do so
against the blueprint and frame:

- read the relevant files
- make bounded edits
- run the named verification
- repair self-authored failures
- record progress as durable artifacts
- escalate only when the next decision is genuinely not theirs to make

Workers should be flexible about solving local problems. They should not invent
a new project plan while pretending to execute the old one.

### Inspection

Inspection is review against the plan and the actual structure:

- does the implementation satisfy the blueprint?
- did it respect the frame and non-goals?
- do tests and browser checks prove the right thing?
- did it create hidden regressions?
- does a specialist need to review design, security, data, accessibility, or
  release risk?

Inspection should be visible in the UI. A user should know whether work is
waiting for the guild, waiting for a deterministic gate, or waiting for their
decision.

### Change Orders

A change order is how Guildhall changes course without losing trust.

Use a change order when:

- new evidence invalidates part of the blueprint
- a task is too broad and needs splitting
- a dependency appears
- implementation reveals a safer path
- the user changes the desired outcome
- the release plan needs reshaping

Change orders should name the old assumption, the new evidence, the proposed
change, and the effect on scope or sequencing.

### Punch List

The punch list is the final set of small but real finishing work:

- polish
- docs alignment
- missing tests
- release notes
- cleanup
- known follow-ups that do not block shipping

The punch list keeps "done" honest. It also protects shipping from endless
polish by separating livability from perfection.

### Occupancy

Occupancy is the release-readiness question:

- Can the user use this?
- Can the project continue from here without hidden context?
- Are the important risks documented?
- Are the gates green enough for the release standard?
- Is remaining work explicitly deferred?

For Guildhall itself, this maps to release readiness. For user projects, it can
mean a merged PR, a packaged artifact, a deployed feature, or a stable next
phase.

## Guild Roles

The house is not built by one generic agent pretending to be every trade.
Guildhall should make roles explicit enough that agents know what kind of
judgment they are allowed to exercise.

- **Owner:** the user or project stakeholder. Sets intent, approves meaningful
  scope changes, and decides when tradeoffs are acceptable.
- **Coordinator:** the general contractor. Keeps the project journey coherent,
  routes work to the right role, watches blockers, and protects the shared
  plan.
- **Project manager:** the preconstruction and sequencing role. Groups work
  into releases, phases, dependencies, priorities, and active tranches.
- **Spec agent:** the architect/drafter for a specific task. Turns notes and
  evidence into a task blueprint with acceptance criteria and questions.
- **Worker:** the trade contractor. Implements against the accepted blueprint,
  verifies, and repairs bounded self-authored failures.
- **Reviewer:** the inspector. Compares the built work against the blueprint,
  project constraints, and release standard.
- **Specialist:** a code official or expert trade. Reviews focused domains
  like accessibility, security, performance, data integrity, design quality,
  packaging, or docs.

These roles can be implemented by the same underlying model, different models,
or human review. The important part is that each role carries different
instructions, authority, artifacts, and exit criteria.

## The Durable Artifact Rule

Narration is not progress.

An agent turn only counts as project progress when it creates or updates a
durable artifact:

- project map
- release or phase plan
- task blueprint
- acceptance criteria
- explicit question
- decision record
- change order
- implementation diff
- verification result
- review finding
- gate result
- learning or policy update

Thread transcripts are useful evidence, but they are not the work. If an agent
only says "I understand and will write the spec next," Guildhall should treat
that as no durable progress and either continue, retry with sharper
instructions, or escalate honestly.

## Agent Operating Pattern

Every guild agent should know which construction mode it is in before it acts:

- **survey:** learn the site and produce reusable facts
- **blueprint:** define intended work
- **frame:** organize work into buildable pieces
- **build:** implement a bounded piece
- **inspect:** compare work against plan and codes
- **change-order:** revise the plan based on evidence
- **punch-list:** finish or defer small remaining work

Each agent handoff should include:

- current mode
- accepted blueprint or missing blueprint
- owned artifact
- allowed mutation surface
- verification command or inspection standard
- known assumptions
- safe next move
- escalation rule

This is how Guildhall becomes smarter without becoming vague. Agents get room
to solve problems, but their freedom is bounded by the current construction
mode and the artifact they are responsible for.

It is also how Guildhall avoids making the owner manage the guild. Agents
should default to informed recommendations, not open-ended questionnaires. When
they need input, they should ask one bounded question, explain why it matters,
and prefer a small set of sensible options over a blank page.

## How This Changes Product Flow

### Intake

Intake should produce a site survey and project charter, not just a pile of
initial tasks. If confidence is low, Guildhall asks the owner a focused
question. If confidence is high, it writes the durable starting plan and keeps
moving.

### Workspace Import

Workspace import should not create dozens of unshaped drafts by default. It
should first group source material into a project frame:

- source documents
- inferred areas
- candidate releases or phases
- candidate tasks
- confidence level
- evidence for each candidate

The user can approve candidates individually or in bulk, but approval should be
informed by the frame. A draft is appropriate when evidence is insufficient or
the consequence of being wrong is meaningful.

### Task Shaping

Task shaping is blueprint work. A task card should show:

- starting notes or source material
- what Guildhall thinks the task is
- why it thinks that
- open questions attached to that task
- acceptance criteria
- verification plan
- approve/edit/reject actions inline

The details pane can provide deeper inspection, but the thread should remain a
complete path for moving work forward.

### Execution

Execution is trade work. Workers should receive the accepted blueprint, known
site facts, previous attempts, verification standard, and allowed mutation
surface. If they hit a normal trade problem, they repair it. If they discover a
plan problem, they propose a change order.

### Review

Review is inspection. It should not merely say whether the worker "did work."
It should compare actual output to the blueprint, named codes, user intent, and
release standard. Reviewer disagreement should create a visible decision point,
not hidden churn.

### Learning

Learning is how the guild improves its building code:

- project-specific lessons become project memory or project skills
- user-wide expectations become global preferences
- product-wide failures become Guildhall runtime or UI tasks

Learning should not blindly rewrite the current project plan. It should be
routed by the coordinator and inspected like any other artifact.

## UI Implications

Guildhall needs to show the project journey without exposing every internal
mechanism.

The UI should give users these views:

- **Journey:** where the project is in survey, blueprint, framing, build,
  inspection, punch list, and occupancy.
- **Blueprints:** accepted plans at project, release, phase, and task levels.
- **Build Now:** the active tranche of work that can safely run.
- **Questions:** decisions grouped under the task or plan they affect.
- **Inspections:** review findings, gate results, failed checks, and why they
  matter.
- **Change Orders:** explicit scope or sequencing changes and their rationale.
- **Punch List:** remaining work split into shipping blockers and deferred
  follow-ups.

Thread remains the live command surface. The project page should also expose
the shared frame so users can understand where each card fits without reading a
machinery manual of inner workings.

## Integration Plan

### 0.5.x: Make Current Work Honest

- Do not count narration-only transcript updates as progress.
- Keep task-scoped questions inside the task.
- Keep the details pane optional.
- Make blocked/running/paused states truthful.
- Ensure imported drafts expose their source notes and evidence.
- Require worker handoffs to include prior attempts and verification context.

### 0.6.0: Build the Planning Layer

- Add a project manager role that groups tasks into releases, phases,
  dependencies, priorities, and active tranches.
- Promote project journey as a first-class artifact.
- Add blueprint/change-order records for meaningful plan changes.
- Add policy packets that tell agents their construction mode, authority,
  allowed mutation surface, verification standard, and escalation rule.
- Add learning routes that separate project memory, user preference, and
  Guildhall product improvements.

### Later: Extract the Substrate

Guildhall may eventually expose its task, delegation, learning, and audit
substrate as reusable packages. That is post-`0.6.0`. The near-term product goal
is to prove the construction model inside Guildhall before extracting it.

## Design Tests

Use these questions when evaluating a Guildhall feature or agent behavior:

- What part of the construction journey does this represent?
- What durable artifact does it create or inspect?
- Is the current blueprint visible?
- Do the plan, task, implementation, verification, and release criteria fit
  together as a balanced whole?
- Is the user being asked for one clear decision?
- Is Guildhall asking because owner intent is genuinely needed, or because the
  agent failed to infer a routine implementation choice?
- Is the level of process proportional to the risk and blast radius?
- Can the next agent act more deterministically because of this work?
- If the plan changed, is there a change order?
- If work is blocked, is the blocker attached to the right task or plan?
- If the project shipped now, what would still be on the punch list?

If a feature cannot answer those questions, it is probably still an agent
console behavior wearing product UI clothing.
