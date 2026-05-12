# Guildhall 0.6.0 — Persona Provenance & UI Review

## Status

Proposed for `0.6.0`.

## Purpose

Guildhall needs two related capabilities:

1. it should already be able to pull in a strong UI/product review perspective
   internally when a flow or screen needs critique
2. users should be able to inspect who has contributed to a project, what each
   persona or perspective worked on, and what they influenced

These are not separate ideas.

If Guildhall is going to claim that it has perspectives, reviewers, and
coordinating judgment, the system needs:

- a real internal review path that uses those perspectives well
- a visible provenance surface that lets the user understand what happened

The internal capability makes Guildhall smarter.
The provenance surface makes Guildhall legible.

`0.6.0` should introduce both, with the internal capability shipping first in
importance even if the provenance screen is the more visible feature.

## Problem

Today Guildhall still fails a basic trust test in some flows:

- the UI can be confusing even after many iterations
- the system often behaves as though “a perspective exists” without making it
  clear when that perspective was actually used
- users cannot easily tell:
  - who shaped a task
  - who reviewed it
  - what concerns were raised
  - what feedback mattered
  - what was accepted, overruled, or ignored

This creates two bad outcomes:

1. Guildhall misses obvious product and UX issues before calling work “done”
2. users cannot build confidence that Guildhall is making good judgments across
   multiple steps, unattended

If Guildhall is supposed to feel like a real guild hall instead of an opaque
agent console, both of those need to improve.

## Product thesis

Guildhall should expose:

- the structure of the work
- the history of decisions
- the perspectives that materially influenced outcomes

Guildhall should not expose:

- fake org-chart complexity
- persona machinery for its own sake
- a theatrical “cast of agents” with no accountable output

The rule is:

> perspectives should be visible through their contributions, not through
> decorative identity alone.

That means:

- the coordinator may pull in a UI review perspective
- the user does not need to manually “assign the UI reviewer”
- if that perspective affected the result, Guildhall should show that clearly

## Release target

This is a `0.6.0` feature batch because it builds on the `0.5.x` pivot toward:

- one coordinator per project
- internal routing and perspective selection
- Thread as the command surface
- inference-first setup and task shaping

`0.5.x` is about making Guildhall understandable and finishable.
`0.6.0` should make Guildhall’s judgment more inspectable and more trustworthy.

## Scope

### In for `0.6.0`

1. **Internal UI review perspective**
2. **Persona provenance model**
3. **Project-level personas / perspectives screen**
4. **Task-level contribution summaries**
5. **Basic “ask why” affordances through existing surfaces**

### Out for `0.6.0`

1. freeform chat with arbitrary personas
2. user-managed persona rosters
3. persona marketplaces / custom persona authoring
4. full historical analytics dashboards about persona performance
5. automated scoring of persona quality for end users

## Feature 1 — Internal UI review perspective

### Goal

Guildhall should be able to perform screenshot-grounded UI critique as part of
normal project reasoning, not only when a human explicitly asks for it in chat.

### Why this matters

There are repeated UX failures that code-only review does not catch well:

- confused hierarchy
- contradictory CTAs
- broken ownership signaling
- spacing and layout drift
- misleading copy
- “what am I supposed to do next?” failures

Guildhall should not need a user to manually force those observations every
time.

### Product behavior

The coordinator should be able to invoke a **UI review perspective** when:

- a task changes a user-facing flow
- a Thread / setup / Work / Release surface is substantially altered
- the user explicitly asks for UI critique
- Guildhall is about to mark a UX-heavy task done

### Inputs

The UI review perspective should prefer rendered evidence:

- live screenshots
- current visible CTA labels
- card hierarchy
- current state/ownership signaling
- relevant before/after diffs when available

Code can still be included, but code is secondary evidence for this perspective.

### Output shape

The UI review perspective should produce structured feedback, not freeform vibes:

- `summary`
- `severity`
- `surface`
- `issue type`
  - hierarchy
  - action model
  - copy clarity
  - spacing/layout
  - state semantics
  - responsiveness
- `evidence`
  - screenshot ref
  - quoted label text
  - relevant component/file
- `recommendation`

### Review rubric

At minimum, the perspective should answer:

1. What is the main point of this screen?
2. What does the primary button do?
3. Is the next step obvious?
4. Is ownership clear:
   - needs you
   - Guildhall next
   - Guildhall working
   - done
5. Are status labels semantically consistent with actual runtime behavior?
6. Is the hierarchy calm, or are too many things emphasized at once?
7. Is there any visible contradiction between:
   - title
   - CTA
   - state chip
   - body copy

### `0.6.0` acceptance bar

For `0.6.0`, the UI review perspective does not need to be universal.

It does need to be:

- available to the coordinator as a real perspective
- used in selected product-facing flows
- grounded in screenshots or rendered evidence
- persisted into provenance so the user can see it happened

## Feature 2 — Persona provenance model

### Goal

Users should be able to answer:

- who worked on this?
- who reviewed it?
- who objected?
- what feedback changed the result?
- what does this persona usually contribute?

### Core principle

Guildhall should show **contribution history**, not just persona names.

The provenance model should distinguish between:

- worked on
- reviewed
- raised concerns
- approved
- escalated
- recommended
- coordinated

### Data model

Guildhall should persist persona contribution records in a structured way.

At minimum:

```yaml
personaContribution:
  personaId: ui-review
  personaLabel: UI review
  role: reviewer
  scope:
    type: task
    id: task-003
  action:
    kind: review
    summary: Flagged contradictory ownership and CTA language in Thread card
  outcome:
    status: accepted
    evidenceRefs:
      - screenshot:thread-task-003-state
      - file: src/web/surfaces/project/ThreadTab.svelte
  at: 2026-05-11T22:00:00Z
```

This should be flexible enough to cover:

- internal perspectives
- named reviewer personas
- worker lanes
- coordinator decisions

### Provenance rules

1. A persona should only appear in project history if it actually contributed.
2. Contributions should be grouped by project and task.
3. A persona’s visible profile should derive from real work, not static lore.
4. Rejected or superseded feedback still matters and should remain inspectable.
5. The coordinator’s role should be visible as coordination and adjudication,
   not as “did all the work.”

## Feature 3 — Personas screen

### Goal

Give the user a place to inspect the active and historical contribution record
for Guildhall’s perspectives and personas in this project.

### Proposed location

Add a new project-level screen under Settings or Facts first, not primary nav.

Likely label:

- `Perspectives`
or
- `Who helped`

Avoid:

- `Stewards`
- `Coordinators`
- `Agents roster`

because those teach the wrong mental model.

### Screen contents

For each persona/perspective:

- name
- role
  - coordinator
  - worker
  - reviewer
  - UI review
  - release readiness
  - etc.
- what it has contributed to recently
- what it most often looks at
- last contribution time
- accepted / superseded / unresolved items

### Example sections

#### Coordinator

- coordinated 14 task transitions
- requested 3 human decisions
- adjudicated 2 reviewer conflicts

#### UI review

- reviewed 5 product surfaces
- flagged 3 hierarchy issues
- 2 recommendations accepted

#### Worker

- implemented 4 tasks
- 3 merged
- 1 returned for revision

### Interaction model

This screen should support:

- project-wide overview
- click into a persona to see contribution history
- jump from contribution history to:
  - task
  - decision
  - review
  - screenshot-backed critique

It should not try to be a conversational control panel in `0.6.0`.

## Feature 4 — Task-level provenance summaries

Thread, task drawer, or task details should show concise contribution rolls like:

- `Drafted by Spec author`
- `Reviewed by UI review and Reviewer`
- `Re-scoped by Coordinator`
- `Returned with changes by Reviewer`

This should help the user understand what happened without needing to open the
full personas screen every time.

## Feature 5 — “Ask why” affordances

`0.6.0` can introduce a narrow, structured form of persona questioning without
turning personas into freeform chatbots.

Examples:

- `Why did Guildhall flag this?`
- `Why did review bounce this back?`
- `Why did the coordinator choose this path?`

These should open a scoped explanation view tied to:

- one task
- one review
- one decision
- one contribution record

Not a global persona chat thread.

## User stories

### Story 1 — trust the UI critique

As a user, when Guildhall changes a product-facing flow, I want to know that it
has applied a real UI review perspective so I do not have to manually catch
every obvious hierarchy or CTA problem myself.

### Story 2 — understand who influenced a task

As a user, when a task was revised, approved, or blocked, I want to know which
persona or perspective influenced that outcome.

### Story 3 — inspect contribution history

As a user, when I open a project, I want a screen where I can see what each
persona has actually done, not just what role names exist in theory.

### Story 4 — explain decisions without exposing machinery

As a user, I want to understand why Guildhall did something without having to
understand the runtime’s internal staffing model.

## UX principles

1. **Contribution over identity**
   - show what a persona did, not just who it is
2. **Evidence over mythology**
   - link to the task, review, or screenshot-backed finding
3. **Scoped explanations**
   - explain one decision at a time
4. **No fake cast list**
   - do not show personas that never actually contributed
5. **Hide machinery, expose judgment**
   - the user should see the result of perspective use, not be asked to manage it

## Implementation notes

### Internal capability first

The UI review perspective should be wired into the coordinator/runtime before
the personas screen becomes rich. Otherwise the screen risks becoming a facade
for a capability that is not actually being exercised.

### Provenance storage

The contribution record should likely live near existing task history,
review-verdict, and decision persistence rather than as a separate cosmetic log.

It needs to be queryable by:

- project
- task
- persona
- action kind

### Screenshot grounding

If Guildhall claims UI review happened, the provenance record should say what
rendered evidence it used whenever possible.

### Backfill

`0.6.0` does not need a perfect historical migration for all older projects.
A partial backfill is acceptable if:

- new contributions are recorded cleanly
- old data remains readable
- no fake precision is invented

## Risks

### 1. Persona theater

Risk:
- the screen becomes a decorative “AI team” feature with weak operational value

Mitigation:
- only show real contribution records
- keep the screen tied to evidence and outcomes

### 2. Overexposure of internal complexity

Risk:
- the feature reintroduces the steward/coordinator problem under a new name

Mitigation:
- keep the primary model project/task/decision-centric
- make personas inspectable, not user-managed

### 3. Weak UI review quality

Risk:
- “UI review” becomes generic taste commentary

Mitigation:
- require rendered evidence
- require structured issue types and recommendations
- tie feedback to real acceptance or rejection outcomes

### 4. Provenance noise

Risk:
- every tiny system event becomes a visible contribution record

Mitigation:
- only persist meaningful contributions
- batch low-level activity into human-readable summaries

## Success criteria

`0.6.0` is successful if:

1. Guildhall can invoke a real UI review perspective for product-facing work.
2. That perspective produces structured, evidence-backed findings.
3. Users can inspect which personas/perspectives contributed to a project.
4. Users can inspect which personas/perspectives contributed to a task.
5. The feature improves trust and legibility without reintroducing user-managed
   persona bureaucracy.

## What ships first

Recommended implementation order:

1. contribution record shape
2. UI review perspective wired into coordinator/runtime
3. task-level provenance summaries
4. project-level personas screen
5. scoped “ask why” affordances

## Open questions

1. Should the screen be called `Perspectives`, `Who helped`, or something else?
2. Should UI review be a distinct perspective, or a subtype of reviewer work?
3. How much of the contribution model belongs in Thread versus task details?
4. Should contribution records include confidence or only outcomes?
5. Which perspectives should be first-class defaults in `0.6.0` besides UI
   review?

## Recommendation

Slate this for `0.6.0`.

Do not treat it as a cosmetic feature.

The internal UI review perspective is part of Guildhall’s quality bar.
The personas screen is part of Guildhall’s trust and legibility bar.

Together they move Guildhall closer to the product it is trying to be:

- one coordinator
- multiple real perspectives
- visible contribution history
- better judgment
- less mystery
