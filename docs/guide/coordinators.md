---
title: How Guildhall routes work
help_topic: guide.coordinators
help_summary: |
  Guildhall keeps one coordinating layer. It routes tasks to the right context
  and review lenses without making you manage a roster.
---

# How Guildhall routes work

Guildhall keeps **one coordinator on your system**. Behind the scenes, it uses
a routing map to decide:

- what kind of task this is
- what code or repo slice it belongs to
- what context to gather
- which review lenses matter

That map is there to keep work pointed in the right direction. You usually do
not need to manage it directly.

## What New Request can become

The New Request path uses routing before Guildhall creates work. A request can
become:

- a normal task brief;
- a Pressure-Test Intake for a broad release or feature;
- a project question;
- a settings proposal;
- a practice or review-lens proposal;
- repair triage;
- a clarification card.

If the request contains more than one intent, Guildhall splits it into
reviewable actions. If a similar card already exists, it can reuse that card so
the project does not grow a second copy of the same conversation in a fake
moustache.

## What the routing map is for

Guildhall still needs a stable way to tell:

- UI work from backend work
- repo-root work from subproject work
- release/setup work from product-task work

Guildhall stores those slices under the existing `coordinators:` key in
`./guildhall.yaml`. That key is historical. The useful product rule is simpler:

- you manage projects, tasks, and decisions
- Guildhall manages routing and review structure underneath

## How the map gets created

For a new project, Guildhall starts by reading the repo and sketching a routing
map. It stops to ask only when the answer changes the project:

1. confidence is low, and
2. the consequence of being wrong is high enough to matter

That means the normal flow is:

1. inspect the repo
2. infer the routing slices
3. move on
4. ask for confirmation only if a material ambiguity remains

## What you can inspect

When you want the details, Settings/Facts shows:

- which domain labels Guildhall is using
- which paths those labels cover
- what concerns and escalation triggers were inferred

That view is for transparency and debugging. It is not a new staffing model you
have to design by hand.
