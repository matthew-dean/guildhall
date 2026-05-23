---
title: Introduction
---

# Introduction

Guildhall is a **local service for running software work over real projects**.
It works like a guild hall for software construction: one project job site,
visible plans, different trades, inspections before completion, and a record of
what changed.

In practice, you usually point it at one project, open the project shell, and
run the day from there. From that shell outward, a **spec writer** drafts the
blueprint, **coordinators** keep the job coherent, **workers** perform bounded
trade work, **reviewers** inspect the result, and **gate-checkers** enforce the
hard checks. Their shared task state lives in `memory/TASKS.json`.

You can close your laptop. They keep going. You can step back in from the
service home, the project shell, or the CLI when scripting is the better tool.
Everything resumes from the next tick.

## What makes it different

Most "AI coding" tools are chat-shaped: you prompt, they respond. Guildhall is
construction-shaped: you help frame the work, the guild builds against the
accepted plan, inspectors check the result, and you step in for product calls
and meaningful changes, not for babysitting.

Three properties follow from this:

1. **Everything is explicit.** Every behavioral knob is a [named lever](../levers/) with enumerated positions. The Spec Agent can infer a starting point from conversation, but the result lands in plain YAML you can read and change.
2. **Everything is visible.** Tasks, blueprints, lever settings, agent sessions, transcripts, and audit trails all live on disk under `memory/`. The browser UI is the main way to operate that state, but it never hides the files.
3. **Everything is reviewable.** Each task passes through named stages — `proposed → exploring → spec_review → ready → in_progress → review → gate_check → done` — and any reviewer persona (LLM or deterministic) can block promotion. See [task lifecycle](./task-lifecycle).
4. **Narration is not progress.** A transcript line is not enough. Progress leaves durable evidence: a blueprint, question, decision, implementation diff, verification result, review finding, change order, or learning record.

## Why the name

A medieval **guildhall**, where masters, journeymen, and apprentices work under
shared standards, and admission to each tier requires producing a verified
*masterpiece*. In Guildhall, that verification is the review + gate pipeline.

The construction metaphor matters because real projects are built by many
trades following shared plans, codes, inspections, and change orders. Guildhall
borrows that discipline: not rigid bureaucracy, but enough structure that the
next guild member knows what they are building into.

## Next

- Start the service for a project: [Quick start](./quick-start).
- Learn the operating model: [How Guildhall builds](./how-guildhall-builds).
- Tour the operating surface: [Projects and work](./dashboard).
- Understand the vocabulary: [Core concepts](./concepts).
- Tune behavior: [Levers](../levers/).
