---
title: Introduction
---

# Introduction

Guildhall is a **local service for running AI-assisted work inside your
existing software projects**. It gives agents shared project state, task plans,
tools, review rules, recovery paths, and a browser surface where you can see
what is happening.

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

## What makes it different

Most "AI coding" tools are chat-shaped: you prompt, they respond. Guildhall is
harness-shaped: you help frame the work, agents build against the accepted
plan, inspectors check the result, and you step in for product calls and
meaningful changes, not for babysitting.

Three properties follow from this:

1. **Everything is explicit.** Every behavioral knob is a [named lever](../levers/) with enumerated positions. The Spec Agent can infer a starting point from conversation, but the result lands in plain YAML you can read and change.
2. **Everything is visible.** Tasks, blueprints, lever settings, agent sessions, transcripts, and audit trails all live on disk under `./memory/`. The browser UI is the main way to operate that state, but it never hides the files.
3. **Everything is reviewable.** Each task passes through named stages — `proposed → exploring → spec_review → ready → in_progress → review → gate_check → done` — and any reviewer persona (LLM or deterministic) can block promotion. See [task lifecycle](./task-lifecycle).
4. **Narration is not progress.** A transcript line is not enough. Progress leaves a durable artifact: a blueprint, question, decision, implementation diff, verification result, review finding, change order, or learning record.

## Why the construction language

Real projects are built by many people and many tools following shared plans,
standards, inspections, and change orders. Guildhall borrows that discipline:
not rigid bureaucracy, but enough structure that the next agent knows what it
is building into.

## Next

- Start the service for a project: [Quick start](./quick-start).
- Learn the operating model: [How Guildhall builds](./how-guildhall-builds).
- Tour the operating surface: [dashboard](./dashboard).
- Understand the vocabulary: [Core concepts](./concepts).
- Tune behavior: [Levers](../levers/).
- Dive into internals: [Architecture](../subsystems/).
