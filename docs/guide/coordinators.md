---
title: Internal routing
help_topic: guide.coordinators
help_summary: |
  Guildhall keeps one coordinating layer. It infers and stores internal routing
  slices so tasks can get the right context and review lenses without making
  the user manage a steward roster.
---

# Internal routing

Guildhall has **one coordinator on the user's system**. That coordinator uses
an internal routing map to decide:

- what kind of task this is
- what code or repo slice it belongs to
- what context to gather
- which review lenses matter

This routing map is an implementation detail, not the main thing the user is
supposed to manage.

## What the routing map is for

Guildhall still needs a stable way to tell:

- UI work from backend work
- repo-root work from subproject work
- release/setup work from product-task work

So the runtime stores internal slices under the existing `coordinators:` key in
`guildhall.yaml`. That key is historical. The important product truth is:

- users manage projects, tasks, and decisions
- Guildhall manages routing and review structure underneath

## How the map gets created

For a new project, Guildhall should infer the routing map from repo evidence
first. It should only stop to ask the user when:

1. confidence is low, and
2. the consequence of being wrong is high enough to matter

That means the normal flow is:

1. inspect the repo
2. infer the internal routing slices
3. move on
4. ask for confirmation only if a material ambiguity remains

## What the user may still inspect

Advanced users can still inspect the routing map in Settings/Facts to see:

- which domain labels Guildhall is using
- which paths those labels cover
- what concerns and escalation triggers were inferred

But that is there for transparency and debugging, not because Guildhall expects
users to design its internal staffing model by hand.
