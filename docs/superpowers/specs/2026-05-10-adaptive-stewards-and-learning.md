# Adaptive Coordinator Learning

## Goal

Let Guildhall improve from real product failures and real user corrections
without turning the interface into a complicated control panel.

Guildhall should be able to:

- notice when a flaw suggests the coordinator needs a stronger review lens
- learn how a specific user prefers Guildhall to behave
- apply those preferences in future flows
- promote durable learnings into project policy and future Guildhall defaults

The important product constraint is:

- **the learning should be powerful, but mostly invisible by default**

## Problem

Right now Guildhall can produce bad or awkward outcomes, and a user can give
good corrections, but those corrections do not yet have a clear structured
life after the moment they are spoken.

Three separate product needs are hiding inside that gap:

1. **Failure diagnosis**
   - when Guildhall creates a confusing or weak outcome, we should ask whether
     the guild itself was missing the right perspective

2. **User adaptation**
   - when a user repeatedly corrects Guildhall, that should influence future
     behavior for that user and project

3. **Product evolution**
   - when those corrections repeat across many uses, they should become
     evidence-backed suggestions for better built-in defaults, stronger review
     rules, or stronger default coordinator behavior in future Guildhall releases

## Product Rules

### 1. No interface explosion

This capability must not add a forest of knobs to normal workflow surfaces.

Default experience:

- Guildhall quietly learns
- Guildhall occasionally proposes a clear recommendation
- the user can inspect or override if they want

Advanced controls can exist, but should live in deeper settings or admin-like
surfaces, not on every card.

### 2. Learning must be inspectable

Guildhall should not mutate behavior in spooky hidden ways.

If Guildhall changes how it behaves because of user preference or project
policy, there should be an inspectable explanation somewhere like:

- what was learned
- where it came from
- what it currently affects

### 3. Learning must be layered

Guildhall should not mix all learning into one blob.

We need three levels:

- **user-local**
  - how one person prefers Guildhall to behave
- **project-level**
  - how this project wants Guildhall to work
- **product-level**
  - patterns that should influence future Guildhall defaults

### 4. Corrections should feel lightweight

The user should not have to “train the system” in a laborious way.

Corrections should mostly come from ordinary product use:

- rejecting a draft
- revising wording
- repeatedly preferring compact vs verbose output
- choosing one recommended option over another
- flagging a missing perspective

Guildhall should notice those patterns and turn them into small, inspectable
proposals.

## Core Concepts

## Adaptive Coordinator Lenses

Guildhall should not expose a roster of long-lived stewards as the primary
mental model. Instead, the single local coordinator should be able to pull in
the right review lenses when needed.

Guildhall should eventually be able to ask:

- should the coordinator have applied a different lens here?
- is a missing review lens causing repeat failures?
- is an existing lens under-specified?

Examples:

- cold-user clarity lens
- onboarding lens
- simplification lens
- accessibility lens
- product quality lens
- integration-risk lens

The user should not need to configure these manually in normal use. Guildhall
should ship with defaults and only surface coordinator adaptation when a
repeated failure suggests it matters.

## Preference Memory

Guildhall should remember durable user preferences like:

- prefers compact guided flows
- wants fewer internal/runtime terms
- prefers one source at a time
- prefers stronger recommended defaults
- wants more evidence before approval

These should be modeled as structured preferences, not just raw transcript
text.

## Policy Memory

Some corrections are not personal taste. They are project policy.

Examples:

- this project wants stronger review rigor
- this project wants no giant drafts
- this project wants source-by-source intake review
- this project wants a specific review lens involved before approval

Project policy should be reviewable and sharable inside the project.

## Product Suggestions

Some repeated corrections should become candidates for future product
improvement.

That does not mean Guildhall self-modifies product defaults automatically.
It means Guildhall can record:

- repeated confusion points
- repeated correction patterns
- repeated coordinator-lens gaps
- repeated winning flow choices

Those become evidence for future Guildhall development.

The important nuance is that Guildhall should not "mark something as upstream"
in a magical way. A better model is:

- Guildhall can prepare a structured product suggestion
- a human or builder can review it
- it can then be submitted into the real product-development workflow, likely
  as a GitHub issue or similar UX/product backlog item

## Suggested Product Shape

### Normal user-facing behavior

In ordinary flows, the user mostly sees:

- better results
- better defaults
- occasional small banners/prompts like:
  - `Guildhall noticed you usually prefer compact review steps. Keep using that?`
  - `This kind of issue may need a stronger product-clarity check. Keep that on for this project?`

No giant settings UI should appear by default.

### Lightweight learning surface

Add a future surface such as:

- `Settings → How Guildhall works`

This is where a user can inspect:

- learned user preferences
- project-level operating preferences
- active coordinator learnings and why they exist
- suggested adjustments waiting for approval

This is the right place for inspection and editing, not everyday cards.

### Future product feedback surface

Add a future internal-facing surface such as:

- `Diagnostics → Product learnings`

This would be for Guildhall builders, not normal end users. It would collect:

- common correction themes
- confusing flow hotspots
- repeated coordinator-lens diagnoses
- flow variants that lead to better outcomes

And from there it should support a lightweight submission path such as:

- `Submit as UX suggestion`
- `Open product issue`
- `Draft GitHub issue`

## Data Model Direction

Guildhall should store three explicit record types.

### 1. Learned preference

Examples:

- subject: `user`
- scope: `local` or `project`
- key: `review_density`
- value: `compact`
- evidence: list of accepted/rejected choices or corrections
- confidence: low / medium / high

### 2. Steward recommendation

Examples:

- reason: repeated clarity corrections during approvals
- suggested steward: `clarity`
- scope: `project`
- state: `suggested` / `accepted` / `dismissed`

### 3. Product suggestion

Examples:

- pattern: `users repeatedly reject mixed-abstraction approval cards`
- evidence count
- surfaces affected
- recommendation: `change default flow`
- destination: `github_issue` or similar product-feedback sink

## Phased Rollout

## 0.5.0 Scope Cut

### In for 0.5.0

These are the pieces that feel important enough to ship in the first adaptive
version:

- structured user/project preference memory
- application of those preferences to at least one real guided journey
- a lightweight inspection/reset surface so the learning is not spooky

The intended proof is simple:

- the user corrects Guildhall once or a few times
- Guildhall behaves better the next time
- the user can inspect or reset what was learned
- the interface still feels calm

### Stretch for 0.5.0

This is useful if it stays very small and confidence-based:

- lightweight steward-gap suggestions

That means suggestions like:

- `This project may need a stronger clarity steward`

but not a large steward-management UI or a full persona-composition system.

### Out of 0.5.0

These belong later:

- rich user-created/addable steward systems
- a full diagnostics/product-learnings surface
- automatic GitHub issue submission pipelines
- broad product-suggestion workflow tooling

Those are valuable, but they are not required to deliver the first real win:

- Guildhall learns from the user in a visible, calm, non-spooky way
- and uses that learning to improve future guided flows

### Phase 1: Structured local preference memory

Build the minimum useful loop:

- record user corrections/preferences in structured form
- apply them to future flows for that user/project
- keep UI impact minimal

No steward adaptation yet.

### Phase 2: Steward-gap suggestions

Add diagnostic reasoning:

- after repeated failures or corrections, Guildhall can suggest a new or
  stronger steward perspective

Still lightweight in UI.

### Phase 3: Product learnings pipeline

Add a builder-facing path for turning repeated local/project learnings into:

- structured product suggestions
- candidate product philosophy updates
- default steward changes
- default flow changes

## Non-Goals

This design does not require:

- fully automatic persona creation
- public marketplace stewards in the first version
- user-facing machine-learning dashboards
- silent automatic mutation of core Guildhall behavior

The first win is simpler:

- corrections become structured
- structured corrections improve the next run
- repeated patterns become visible

## Success Criteria

This feature is working when:

- a user can correct Guildhall naturally during normal use
- Guildhall produces better future results for that user without UI clutter
- project-specific preferences become durable and inspectable
- repeated failure patterns can point to steward or product-design gaps
- Guildhall builders can see which local learnings deserve to become product
  defaults
