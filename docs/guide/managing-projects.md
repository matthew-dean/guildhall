---
title: Many projects
pageClass: gh-first-visit-page
---

# Many projects

Guildhall runs as a local service over projects. You should be able to turn on
more than one project, open them in separate tabs, and understand which one
needs attention without relying on invisible selected state.

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
Project URLs should stay project-scoped so a restart cannot silently jump a
click into a different repo.

## Use the projects home to triage

<picture class="gh-doc-picture">
  <source srcset="../assets/ui-audit/projects.avif" type="image/avif" />
  <img src="../assets/ui-audit/projects.png" alt="Guildhall projects home with Looma + Knit, T minus t, Fair Labor License, and Font something visible as local project cards." />
</picture>

The projects home should answer:

- which projects are active
- which projects are blocked
- which projects need you
- which projects have fresh progress
- which projects are ready for another start

Open the project shell when you need details. The projects home should help
you choose where to look next.

## Keep concurrency separate from project state

Starting one project should not make another project stop existing or lose its
run state. Concurrency limits belong to agent capacity and queue scheduling,
not to whether a project is allowed to be on.

When the service is busy, the UI should make that clear:

- project cards show their own activity
- the project shell shows project-scoped live events
- blocked work stays attached to the project that hit the blocker
- global capacity constraints are explained as capacity constraints

## Let planning shape bigger queues

As projects get larger, the right flow is not "run everything in created
order." Guildhall should help shape smaller active sets and keep broad future
work out of the runnable queue until it is ready.

Today, keep the first active set small and review imported drafts before
approving them.
