---
title: Why Guildhall exists
---

# Why Guildhall exists

Guildhall is a **local AI agent harness for software projects**. It wraps large
language models with project state, task plans, review rules, recovery paths,
and a browser UI where you can see what is happening.

A chat assistant can help with a task. Guildhall helps with the work around the
task: what should be done, what context matters, what changed, what passed
review, and what still needs a decision.

The point is trust. Guildhall gives agent-run work a place to plan, build,
check, and recover. You still make the product calls, but you should not have
to babysit every step or reconstruct the run from a transcript.

## Why people use it

AI coding tools are powerful, but the work around them can get weirdly manual:
you keep context in your head, split work by hand, notice when the model
drifts, rerun checks, and reconstruct what happened from a long transcript.
That is a lot of unpaid stage management.

Guildhall gives that work a place to live.

### If you write code

Use Guildhall when you want agents to respect the project instead of just the
prompt. It can point workers toward existing files, helpers, design tokens,
tests, and conventions; keep task scope visible; and require evidence before a
task is called done.

It is especially useful when the work is bigger than one prompt but smaller
than “hire a team”: feature slices, cleanup passes, docs alignment, test
coverage, UI hardening, release prep, and the middle bits that usually take six
tabs to keep straight.

### If you know the product better than the code

Use Guildhall when you can explain what should exist, who it is for, and what
good would look like. You do not have to pretend to know every file or package.
Guildhall can turn clear product intent into smaller blueprints, ask scoped
questions, and keep implementation evidence visible enough that a technical
reviewer can still inspect the work.

That does not make it a no-code magic wand. It is better thought of as a way
to turn rough intent into organized technical work: specs that match the
vision, tasks that are complete enough to build, acceptance criteria that can
be verified, and reviews that inspect the work from more than one angle.

## What makes it different

Most "AI coding" tools are chat-shaped: you prompt, they respond. Guildhall is
harness-shaped: you help frame the work, agents build against the accepted
plan, inspectors check the result, and you step in for product calls and
meaningful changes, not for babysitting.

Four properties follow from this:

1. **Everything is explicit.** Behavior lives in named settings instead of
   disappearing into a prompt.
2. **Everything is visible.** Tasks, blueprints, transcripts, blockers, and
   review results stay attached to project state.
3. **Everything is reviewable.** Work moves through stages and can be blocked
   by reviewers or deterministic gates.
4. **Narration is not progress.** A confident transcript line is not enough.
   Progress leaves durable evidence: a blueprint, decision, diff, check,
   review finding, or change order.

## Why the name

The name comes from a **guild hall**: a shared place where skilled trades work
under common standards. That is only the metaphor. The real product promise is
more practical: different helpers, one project room, visible progress, fewer
"wait, what did it just do?" moments.

## Why the construction language

Real projects are built by many people and many tools following shared plans,
standards, inspections, and change orders. Guildhall borrows that discipline:
not rigid bureaucracy, but enough structure that the next agent knows what it
is building into.

## Next

- Start the service for a project: [Start here](./quick-start).
- Learn the operating loop: [How the work loop works](./how-guildhall-works).
- Tour the operating surface: [Projects and work](./dashboard).
- Understand the vocabulary: [Core concepts](./concepts).
- Tune behavior: [Levers](../levers/).
