---
title: How Guildhall chooses work
---

# How Guildhall chooses work

Guildhall tries to answer one ordinary question clearly: what should happen
next, and why?

The default model is:

```text
Needs -> Delivery packages -> Tasks -> Dependencies -> Primitives -> Proof
```

You do not need to memorize that chain. It is the shape Guildhall uses so the
project view, Work queue, task drawer, and worker context can agree with each
other.

## Needs

A need is the reason the work matters. It might come from the product you are
building, a customer-facing app, a maintenance lane, a proof surface, or a
shared package that supplies implementation.

Guildhall calls these **drivers**. A driver is not just a folder. A folder says
where code lives; a driver says whose need decides priority.

For a local app and component library, that might mean:

- Knit drives the user-facing need.
- Looma supplies reusable UI primitives.
- Storybook supplies proof.

## Delivery packages

A delivery package is the thing you are trying to ship. It can contain smaller
tasks: implementation, docs, tests, proof, or cleanup.

Hierarchy is delivery shape. It says "these tasks belong to the same package."
It does not mean every child can run immediately.

## Tasks and dependencies

A task is the piece of work an agent can plan, run, review, and prove.

Dependencies are execution order. If a Storybook proof depends on component
implementation, Guildhall runs the implementation first. If a task has a
blocked dependency, the blocker appears in the queue and task drawer so you can
see why the task is not startable yet.

## Primitives

A primitive is a project piece that downstream work uses or must respect.

Primitives are broader than design-system components. They can be:

- UI components and tokens;
- API clients and response envelopes;
- auth guards and permission policies;
- data schemas and migrations;
- event buses and retry rules;
- shared test harnesses;
- workflow conventions.

When a task uses a primitive, Guildhall includes that primitive in the worker
context. When a primitive depends on another primitive, Guildhall expands that
chain too. For example, ContextMenu can use Menu, Menu can depend on MenuItem,
and MenuItem can depend on focus behavior.

That lets the worker see the structural rules before changing code.

## Proof

Proof is how Guildhall knows the work is real.

Proof can be a unit test, interaction test, e2e check, build gate, API
request, screenshot, Storybook story, docs verification, security regression,
or release check. The proof should match the work.

A primitive is not ready just because code exists. It needs observed proof or
an explicit owner decision. If proof is missing, Guildhall can still remember
the primitive, but downstream work stays honest about the gap.

## Path hints

Driver and primitive path hints are project-relative:

```text
./packages/looma
./apps/knit
./src/api/client
```

If you or an agent writes `packages/looma`, Guildhall normalizes it to
`./packages/looma`. Absolute paths are only accepted when they are inside the
project, and then Guildhall stores them as `./` paths. Paths outside the
project are rejected.

## What you see

Overview should explain the active delivery spine in a compact way: the driver,
the next runnable work, important blockers, primitives, and proof state.

Work separates shape from order: containing packages, runnable tasks, blocked
tasks, and proof work.

The task drawer shows local relationships: what the task supports, what blocks
it, what it blocks, which primitives it uses, and which primitives it proves.

Thread explains "why this next" when Guildhall needs a decision, a start, or a
correction.

## Advanced project relationships

Guildhall still has deeper machinery for multi-project ownership, handoffs, and
capability exchange. That machinery is useful when one registered project
really needs delivery from another project or authority boundary.

It is not the default way to understand local project work. For ordinary local
delivery, the model above is enough: needs, packages, tasks, dependencies,
primitives, and proof.
