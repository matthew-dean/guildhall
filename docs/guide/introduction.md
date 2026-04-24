---
title: Introduction
---

# Introduction

GuildHall is a **multi-agent operating system** for software projects. You point it at a project directory and it spins up a guild of agents — a **spec writer**, **coordinators** who own domains, **workers**, **reviewers**, **gate-checkers** — that trade tasks through a persistent queue in `memory/TASKS.json`.

You can close your laptop. They keep going. You can interrupt, edit the queue, change a lever, and they resume from the next tick.

## What makes it different

Most "AI coding" tools are chat-shaped: you prompt, they respond. GuildHall is queue-shaped: you add a task, the guild works it, and your role is to curate intent and resolve escalations, not to babysit generation.

Three properties follow from this:

1. **Everything is explicit.** Every behavioral knob is a [named lever](../levers/) with enumerated positions. No hidden hardcoded defaults. The magic is that the Spec Agent *infers* levers from conversation — but once set, they live in plain YAML you can grep.

2. **Everything is persistent.** Tasks, lever settings, agent sessions, transcripts, and audit trails all live on disk under `memory/`. The dashboard is a window into that state, not the state itself.

3. **Everything is reviewable.** Each task passes through named stages — `proposed → exploring → spec_review → ready → in_progress → review → gate_check → done` — and any reviewer persona (LLM or deterministic) can block promotion. See [task lifecycle](./task-lifecycle).

## The metaphor

A medieval **guildhall**, where masters, journeymen, and apprentices work under shared standards, and admission to each tier requires producing a verified *masterpiece*. In GuildHall, that verification is the review + gate pipeline.

## Where to go next

- Install and run it: [Quick start](./quick-start).
- Understand the vocabulary: [Core concepts](./concepts).
- Tune behavior: [Levers](../levers/).
- Dive into internals: [Architecture](../subsystems/).
