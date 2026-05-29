---
title: Guide
---

# Guide

Guildhall is a local AI agent harness for software projects. Start with one
small run, then come back for the vocabulary and the deeper machinery when the
app starts using words like "blueprint" with a straight face.

## First Read

- [Start here](./quick-start) — install, open one project, and run a small task.
- [Why Guildhall exists](./introduction) — the problem it solves, who it helps,
  and why the product uses the name Guildhall.
- [Core concepts](./concepts) — the vocabulary in one place when a term gets
  fuzzy.

After that, the docs follow the product domains you actually touch:

- **Projects** are the repos Guildhall can see.
- **Tasks** are the pieces of work you ask it to move.
- **Specs and levers** shape how work is planned, reviewed, recovered, and
  learned from.
- **Blueprints and inspections** keep work coherent without turning every run
  into a hidden chat transcript.

Setting up your first project? Start with [Start here](./quick-start).

## Projects

- [Projects and work](./dashboard) — service home, project cards, and the project shell.
- [Project files and workspace state](./workspaces) — what lives on disk.
- [Running Guildhall](./running) — browser controls first, CLI commands when you need them.
- [Guildhall app reference](../web-ui/) — screen-by-screen details when you need a specific app page.

## How it works

- [How the work loop works](./how-guildhall-works) — the system model: survey, blueprint, context, workers, reviewers, gates, and memory.
- [How Guildhall builds](./how-guildhall-builds) — the construction model behind planning, implementation, review, and release.
- [Ways to work](./ways-to-work) — whole-project work, feature-at-a-time requests, focused starts, setup lanes, and decision work.
- [Research-backed design](./research-backed-design) — the research and practice ideas behind smaller tasks, bounded questions, visible uncertainty, and audit trails.
- [Agent context](./agent-context) — what agents receive before they act.
- [Corpus Map](./corpus-map) — how Guildhall indexes a project without dumping the whole repo into every prompt.
- [Memory, learning, and recovery](./memory-and-recovery) — how Guildhall learns reusable habits without turning them into mystery behavior.
- [External agents and MCP](./external-agents) — how Codex, Claude Code, and other MCP-aware tools can read Guildhall project context.

## Tasks

- [Pressure-Test Intake](./pressure-test-intake) — how Guildhall pressure-tests every task, with deeper questions only when the work needs them.
- [Task lifecycle](./task-lifecycle) — how a task moves from idea to done.
- [Cleaner project notes](./task-state-boundary) — how Guildhall keeps shared project notes readable without losing the receipts.
- [Git Story Closure](./git-story-closure) — how Guildhall shows whether completed work is dirty, local, pushed, in a PR, merged, local-only, or deferred.

## Specs And Levers

- [Onboarding and levers](./onboarding-and-levers) — how behavior settings get proposed and approved.
- [How Guildhall routes work](./coordinators) — how Guildhall routes work without making you manage a steward roster.
- [Agents and models](./agents-and-models) — roles and provider assignments.
- [Open model recommendations](./open-models) — tested open-model lanes and how to compare candidate models.
