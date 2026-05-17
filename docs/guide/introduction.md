---
title: Introduction
---

# Introduction

Guildhall is a **local service for running software work over real projects**.
In practice, you usually point it at one project, open the project shell, and
run the day from there. From that shell outward, a **spec writer**,
**coordinators** who own domains, **workers**, **reviewers**, and
**gate-checkers** trade work through a persistent queue in `memory/TASKS.json`.

You can close your laptop. They keep going. You can step back in from the
service home, the project shell, or the CLI when scripting is the better tool.
Everything resumes from the next tick.

## What makes it different

Most "AI coding" tools are chat-shaped: you prompt, they respond. Guildhall is
queue-shaped: you add a task in the UI, the guild works it, and your role is to
curate intent and resolve escalations, not to babysit generation.

Three properties follow from this:

1. **Everything is explicit.** Every behavioral knob is a [named lever](../levers/) with enumerated positions. The Spec Agent can infer a starting point from conversation, but the result lands in plain YAML you can read and change.
2. **Everything is visible.** Tasks, lever settings, agent sessions, transcripts, and audit trails all live on disk under `memory/`. The browser UI is the main way to operate that state, but it never hides the files.
3. **Everything is reviewable.** Each task passes through named stages — `proposed → exploring → spec_review → ready → in_progress → review → gate_check → done` — and any reviewer persona (LLM or deterministic) can block promotion. See [task lifecycle](./task-lifecycle).

## Why the name

A medieval **guildhall**, where masters, journeymen, and apprentices work under
shared standards, and admission to each tier requires producing a verified
*masterpiece*. In Guildhall, that verification is the review + gate pipeline.

## Where to go next

- Start the service for a project: [Quick start](./quick-start).
- Tour the operating surface: [dashboard](./dashboard).
- Understand the vocabulary: [Core concepts](./concepts).
- Tune behavior: [Levers](../levers/).
- Dive into internals: [Architecture](../subsystems/).
