---
title: Many projects
pageClass: gh-first-visit-page
---

# Many projects

Guildhall runs as a local service over your projects. You can keep several
projects registered, open them in separate tabs, and see which one needs
attention without guessing which hidden session is "selected."

## Register projects once

After a project has been set up and has a `guildhall.yaml`, it gets a stable
id in the global registry under `~/.guildhall/`.

```bash
guildhall register ~/projects/fair-labor-license
guildhall register ~/projects/looma-knit
guildhall register ~/projects/t-minus-t
guildhall list
```

The browser projects home reads that registry and opens each project by slug.
Project URLs stay scoped by slug, so a restart cannot silently jump a click
into the wrong repo.

## Use the projects home to triage

<picture class="gh-doc-picture">
  <source srcset="../assets/ui-audit/0-7-0/projects.avif" type="image/avif" />
  <img src="../assets/ui-audit/0-7-0/projects.png" alt="Guildhall projects home with Looma + Knit, Font something, Fair Labor License, Tiny demo, Narrative Harness, and Linecraft visible as local project cards." />
</picture>

The projects home answers:

- what the overall **Work mix** looks like
- which project owns the current **Attention** item
- which projects are **Running now**
- which projects have **Needs you** work
- which project cards are paused, queued, stable, inspecting, or waiting on task briefs

Open the project shell when you need details. The projects home is just the map
room: enough signal to choose where to look next.

## Keep concurrency separate from project state

Starting one project does not make another project vanish or lose its run
state. Concurrency limits belong to helper capacity and queue scheduling, not
to whether a project is allowed to exist.

When the service is busy, the UI shows where the pressure is:

- project cards show their own activity
- the project shell shows project-scoped live events
- blocked work stays attached to the project that hit the blocker
- global capacity constraints are explained as capacity constraints

## Let planning shape bigger queues

As projects get larger, "run everything in created order" gets chaotic fast.
Guildhall helps shape smaller active sets and keeps broad future work out of
the runnable queue until it has a blueprint.

Today, keep the first active set small and review imported drafts before
approving them.

Over time, this becomes the project-manager layer: survey existing material,
frame releases and phases, promote one active tranche, inspect the results,
then reshape the plan with explicit change orders when reality teaches the
guild something new.
