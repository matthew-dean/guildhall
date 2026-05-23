---
title: Guide
---

# Guide

Guildhall is a local AI agent harness for software projects. Start with the
first-read pages if the words "agent harness," "blueprint," or "guild" are not
already obvious.

## First Read

- [What Guildhall is](./introduction) — the basic concept, including why the
  product uses the name Guildhall.
- [Start here](./quick-start) — install, open one project, and run a small task.
- [How Guildhall works](./how-guildhall-works) — how planning, context,
  workers, reviewers, gates, and memory fit together.
- [Core concepts](./concepts) — the vocabulary in one place when a term gets
  fuzzy.

After that, the docs follow the product domains you actually touch:

- **Projects** are the repos Guildhall can see.
- **Tasks** are the pieces of work you ask it to move.
- **Specs and levers** shape how work is planned, reviewed, recovered, and
  learned from.
- **Blueprints and inspections** are how Guildhall keeps work coherent without
  turning every run into a hidden chat transcript.

Setting up your first project? Start with [Start here](./quick-start).

## Projects

- [Projects and work](./dashboard) — service home, project cards, and the project shell.
- [Project files and workspace state](./workspaces) — what lives on disk.
- [Running Guildhall](./running) — browser controls first, CLI commands when you need them.
- [Guildhall app reference](../web-ui/) — screen-by-screen details when you need a specific app page.

## How Guildhall Works

- [How Guildhall works](./how-guildhall-works) — the system model: survey, blueprint, context, workers, reviewers, gates, and memory.
- [How Guildhall builds](./how-guildhall-builds) — the construction model behind planning, implementation, review, and release.
- [Agent context](./agent-context) — what agents receive before they act.
- [Corpus Map](./corpus-map) — how Guildhall indexes a project without dumping the whole repo into every prompt.
- [Memory, learning, and recovery](./memory-and-recovery) — how Guildhall learns reusable habits without turning them into mystery behavior.

## Tasks

- [Task lifecycle](./task-lifecycle) — how a task moves from idea to done.

## Specs And Levers

- [Onboarding and levers](./onboarding-and-levers) — how behavior settings get proposed and approved.
- [How Guildhall routes work](./coordinators) — how Guildhall routes work without making you manage a steward roster.
- [Agents and models](./agents-and-models) — roles and provider assignments.
- [Open model recommendations](./open-models) — tested open-model lanes and how to compare candidate models.
