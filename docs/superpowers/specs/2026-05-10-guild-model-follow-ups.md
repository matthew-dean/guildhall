# Guild Model Follow-ups

## Purpose

This note captures the next immediate design thread after the steward-to-
coordinator pivot:

- how Guildhall should handle research
- how it should handle requirements and discovery
- who handles deployment/distribution/marketing questions
- when internet search and visual inspection are part of the guild model

The goal is to return to these questions directly after the current
coordination-model correction, not let them fade into background philosophy.

## What Changed

Guildhall is pivoting away from a user-facing steward roster as the primary
mental model.

The preferred direction is:

- one coordinating layer per project
- a minimal user-facing work model, with internal routing left to Guildhall
- perspective selection underneath
- context assembly underneath

That resolves one class of confusion, but it also exposes a broader question:

- what perspectives and lifecycle phases should Guildhall actually know about?

## Open Product Questions

### 1. Market research

Guildhall does not yet define market research strongly enough.

Open questions:

- who in the guild performs market/competitive research?
- how is that research captured?
- how does it influence planning, positioning, and task shaping?
- what evidence should be saved: links, screenshots, notes, comparisons,
  pricing, launch patterns, user expectations?

Current design instinct:

- market research should be an explicit perspective/capability
- it should be able to search the internet
- it should be able to inspect product screenshots and live interfaces
- it should write structured findings back into project context

### 2. Product research and requirements gathering

Guildhall is stronger on task execution than on upstream product discovery.

Open questions:

- do we define a distinct research/discovery phase?
- do we define a distinct requirements/success-definition phase?
- when should Guildhall ask the user for missing product truth versus trying
  to infer it?
- when should a scoped conversation be used instead of a rigid wizard?

Current design instinct:

- Guildhall should explicitly model:
  - research
  - requirements
  - planning
  - build
  - release
  - learn

### 3. Deployment and distribution

Guildhall does not yet clearly define who advises on deployment and
distribution strategy.

Open questions:

- should deployment/readiness be a perspective that can be pulled into review?
- should distribution/packaging/installer questions be part of release?
- how should Guildhall reason about app-store, direct-download, npm, desktop,
  or local-service distribution choices?

Current design instinct:

- deployment/distribution should be explicit release-adjacent perspectives,
  not invisible assumptions

### 4. Marketing and launch

Guildhall does not yet have a clean story for go-to-market or launch support.

Open questions:

- should marketing be a guild perspective?
- should Guildhall help with positioning, launch readiness, and messaging?
- where do these artifacts live: notes, plans, tasks, release checklists?

Current design instinct:

- marketing/launch should exist as an optional project capability, not be
  assumed absent

### 5. Internet search and visual review

Some guild capabilities require information outside the repo.

Open questions:

- when should Guildhall search the internet by default?
- which perspectives should be expected to use screenshots/live-product review?
- should UX/UI critique require visual grounding in actual rendered states?

Current design instinct:

- internet search should be normal for market/product/release questions when
  repo-local truth is not enough
- visual/product reviewers should be vision-capable
- UX/UI review should prefer rendered-app evidence over code-only judgment

## Provisional Lifecycle Model

Guildhall likely needs a fuller lifecycle than its current execution-heavy
shape.

Provisional phases:

1. Research
2. Requirements
3. Planning
4. Build
5. Release
6. Learn

These phases do not all need to be front-and-center in the UI at once, but
Guildhall should know they exist so it does not silently assume the user
already solved them elsewhere.

## Immediate Next Design Thread

Return here next to answer:

1. Which perspectives are core defaults versus optional?
2. Which phases are first-class in `0.5.x` versus later?
3. Which of those perspectives need internet access?
4. Which need vision-capable review?
5. How should those findings write back into structured Guildhall state?
