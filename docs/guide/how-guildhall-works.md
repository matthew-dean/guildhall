---
title: How Guildhall works
---

# How Guildhall works

Guildhall is a local service that keeps a project’s work visible while agents
plan, build, inspect, and recover. The important idea is not that one agent has
a gigantic prompt. The important idea is that Guildhall assembles the right
state for the right role at the right moment.

At a high level, each run has these layers:

1. **Project state**: the registered project, `guildhall.yaml`, provider setup,
   local commands, memory files, and current task queue.
2. **Planning state**: project goals, task blueprints, open questions,
   acceptance criteria, out-of-scope boundaries, and change orders.
3. **Codebase orientation**: the Corpus Map and likely target files that point
   agents toward existing modules, helpers, components, design tokens, tests,
   and conventions.
4. **Execution state**: active worktree, checkpoint, previous attempts,
   verification output, and unresolved reviewer feedback.
5. **Inspection state**: reviewer rubrics, guild specialists, gate results,
   release readiness, and human decisions.
6. **Learning state**: project habits and cross-project preferences that can be
   accepted, ignored, or scoped.

## The roles

Guildhall splits work by responsibility:

| Role | What it does | What it should not do |
|---|---|---|
| Spec agent | Turns rough intent into a buildable blueprint. | Guess product intent when a real owner decision is needed. |
| Coordinator | Keeps a domain or project coherent. | Treat every task as isolated local work. |
| Worker | Performs bounded implementation against an accepted blueprint. | Invent parallel abstractions because they are locally convenient. |
| Reviewer | Inspects work against the blueprint, rubrics, and context. | Approve confidence without evidence. |
| Gate checker | Runs deterministic checks and records outcomes. | Replace human or reviewer judgment. |

## The context principle

Agents should receive enough context to make good local decisions without
forcing the entire repository into the prompt. That means Guildhall prefers
compact maps, summaries, pointers, and current state over full-file dumps.

When an agent needs more, it can read the specific file, search the repo, or run
a command. The injected context is a navigation layer, not a substitute for
evidence.

Two pages cover the most important pieces:

- [Agent context](./agent-context) explains what each agent receives before it
  acts.
- [Corpus Map](./corpus-map) explains how Guildhall builds and refreshes the
  compact codebase map.

## The work loop

Guildhall’s default loop is:

1. Survey the project and capture facts.
2. Draft or revise the blueprint.
3. Ask bounded questions only when the answer changes intent or risk.
4. Promote ready work into implementation.
5. Give the worker scoped context, likely files, and Corpus Map guidance.
6. Record checkpoints and verification evidence as work changes.
7. Inspect the result with reviewers and deterministic gates.
8. Finish, revise, escalate, or record a change order.

This is why Guildhall has visible task states, transcripts, review packets,
checkpoints, and settings provenance. The product is not just the final diff.
The product is also the evidence trail that lets you trust the diff.

## What makes this different from a long chat

A long chat can remember a lot, but it is fragile. Important state gets buried
in prose, and each new task depends on the model rediscovering the project.

Guildhall tries to make durable state first-class:

- task status and acceptance criteria live in structured task state
- questions live as answerable cards
- project settings live as levers with provenance
- codebase orientation, including design-system maturity, lives in the Corpus
  Map
- review findings live on the task
- verification output is tied to gates and checkpoints
- learned behavior must be accepted before it becomes policy

The result should feel less like “one clever conversation” and more like a
small local team with a shared project room.
