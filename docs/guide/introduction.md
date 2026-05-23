---
title: Introduction
---

# Introduction

Guildhall is a **local AI agent harness for software projects**. It sits around
large language models and gives them shared project state, task plans, tools,
review rules, recovery paths, and a browser surface where you can see what is
happening.

A chat assistant can help with a task. Guildhall tries to help with the shape
around the task: what should be done, who is doing it, what context they saw,
what changed, what passed review, and what still needs a decision.

The name comes from a **guild hall**: a shared place where skilled trades work
under common standards. That is only the metaphor. In the product, the
"trades" are AI agents with different responsibilities: a **spec agent** turns
rough intent into a blueprint, a **coordinator** keeps the work coherent,
**workers** make bounded changes, **reviewers** inspect the result, and
**gate-checkers** run hard checks.

In practice, you point Guildhall at one project, open the project shell, and
run the day from there. Guildhall can keep running while the service is active
and your computer is awake. If the machine sleeps, the process pauses with it;
when you start the service again, Guildhall resumes from saved project state.

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
coverage, UI hardening, release prep, and the slightly cursed middle bits that
usually take six tabs and a coffee refill.

### If you know the product better than the code

Use Guildhall when you can explain what should exist, who it is for, and what
good would look like. You do not have to pretend to know every file or package.
Guildhall can turn clear product intent into smaller blueprints, ask scoped
questions, and keep implementation evidence visible enough that a technical
reviewer can still inspect the work.

That does not make it a no-code magic wand. It is better thought of as a way
to translate strong product thinking into organized technical work, with
pauses when the answer changes scope, quality, risk, or taste.

## What makes it different

Most "AI coding" tools are chat-shaped: you prompt, they respond. Guildhall is
harness-shaped: you help frame the work, agents build against the accepted
plan, inspectors check the result, and you step in for product calls and
meaningful changes, not for babysitting.

Three properties follow from this:

1. **Everything is explicit.** Behavior lives in named settings instead of
   disappearing into prompt vibes.
2. **Everything is visible.** Tasks, blueprints, transcripts, blockers, and
   review results stay attached to project state.
3. **Everything is reviewable.** Work moves through stages and can be blocked
   by reviewers or deterministic gates.
4. **Narration is not progress.** A confident transcript line is not enough.
   Progress leaves durable evidence: a blueprint, decision, diff, check,
   review finding, or change order.

## Why the construction language

Real projects are built by many people and many tools following shared plans,
standards, inspections, and change orders. Guildhall borrows that discipline:
not rigid bureaucracy, but enough structure that the next agent knows what it
is building into.

## Next

- Start the service for a project: [Quick start](./quick-start).
- Learn the operating model: [How Guildhall builds](./how-guildhall-builds).
- Tour the operating surface: [Projects and work](./dashboard).
- Understand the vocabulary: [Core concepts](./concepts).
- Tune behavior: [Levers](../levers/).
