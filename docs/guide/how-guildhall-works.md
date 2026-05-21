---
title: How Guildhall works
---

# How Guildhall works

Guildhall is a local service that keeps a project’s work visible while agents
plan, build, inspect, and recover. The important idea is not that one agent has
a gigantic prompt. The important idea is that Guildhall assembles the right
state for the right role at the right moment, then asks that role to produce a
durable artifact that another role can inspect.

The theory of the case is simple: language models are useful when they are
given enough structure to stay coherent, enough flexibility to solve the real
problem, and enough audit trail that a human can tell what happened. Guildhall
is built around those three pressures.

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

The split is not theater. Each role has a different failure mode:

- A spec agent can over-plan or ask vague questions.
- A coordinator can lose the project-level thread.
- A worker can optimize for the local file and miss the system.
- A reviewer can rubber-stamp plausible prose.
- A gate checker can confuse passing commands with product quality.

Guildhall’s job is to make those failures harder. The spec agent has to turn
intent into acceptance criteria. The worker has to name what it reused. The
reviewer has to inspect against the blueprint and context. The gate checker has
to record concrete command output. The coordinator has to see whether the whole
project still makes sense.

## Structured flexibility

Guildhall does not try to make agents deterministic by pretending software work
is deterministic. It gives agents structured lanes and lets them exercise
judgment inside those lanes.

For example:

- A task blueprint can define goals, non-goals, likely files, risks, and
  verification, but it should still let the worker choose the best local edit.
- A question card can offer bounded choices, but it can also accept a custom
  answer when the owner sees a better path.
- A setting can inherit from global defaults, become project-specific, or later
  graduate into a global habit when the same preference repeats across
  projects.
- The Corpus Map can point to the likely abstraction, but the worker still has
  to read evidence and explain whether reuse, extension, or a new primitive is
  the right move.

This is the middle path between “just chat with an agent” and “force every
project through a rigid workflow.” Guildhall should shape the work enough that
agents do not drift, but not so much that they stop noticing what the project
actually needs.

## Making good output more likely

Guildhall assumes good output comes from a chain of smaller conditions:

1. The task is framed clearly enough that an agent knows what success means.
2. The agent sees the project state and constraints that matter for that task.
3. The agent knows which existing abstractions, tokens, helpers, tests, and
   conventions should be reused.
4. The agent produces a durable artifact: a blueprint, question, code diff,
   checkpoint, review finding, gate result, or decision.
5. Another role or deterministic check inspects that artifact.

That is why Guildhall invests in blueprints, context packets, Corpus Map,
design-system summaries, review rubrics, checkpoints, and gates. None of those
exist to make the app feel busy. They exist because otherwise agents can sound
confident while producing work that is locally plausible and globally wrong.

## Feedback loops

Guildhall asks for feedback at the point where feedback changes the result.

Human feedback belongs where intent, risk, taste, or release judgment is truly
uncertain. That includes choosing between product directions, approving a
design-system rule, deciding whether a project-specific behavior should become
a global preference, or accepting a change order.

Agent feedback belongs where another perspective can catch a class of mistake.
A reviewer may focus on architecture fit, product flow, accessibility,
security, test coverage, design-system consistency, or release readiness. The
important part is that the reviewer is not just “another pass.” It receives the
blueprint, the work, the relevant context, and a review lens.

Deterministic feedback belongs where commands can prove something: tests,
typechecks, builds, lint, browser checks, and release scripts. Guildhall records
those outcomes so future agents do not have to rediscover whether a claim was
actually verified.

## Auditability as product quality

Auditability is not an enterprise checkbox. It is how Guildhall keeps agentic
work from becoming a magic trick.

The system records:

- what the owner asked for
- what questions were asked and answered
- what blueprint was accepted
- what context the worker received
- what files changed
- what checkpoint the worker left behind
- what reviewers found
- what gates ran
- what decisions changed the plan
- what settings or learned behaviors affected execution

This matters because good work is not only “the diff looks okay today.” Good
work is being able to answer, tomorrow, why the change was made, what tradeoff
was accepted, what verification ran, and whether the agent followed the
project’s existing architecture instead of inventing a parallel one.

The audit trail should also stay digestible. Guildhall should surface the right
layer at the right time: a quick status when you need the current state, a
review packet when you need to inspect a task, and deeper history when
something looks wrong.

## The context principle

Agents should receive enough context to make good local decisions without
forcing the entire repository into the prompt. That means Guildhall prefers
compact maps, summaries, pointers, and current state over full-file dumps.

When an agent needs more, it can read the specific file, search the repo, or run
a command. The injected context is a navigation layer, not a substitute for
evidence.

This is especially important for reuse. Guildhall should steer agents toward
existing shared code before they edit:

- helpers, services, schemas, and packages for backend/runtime work
- components, design tokens, and interaction patterns for UI work
- tests and fixtures that show the intended contract
- docs and decisions that explain why the system has its current shape

If a second similar idea appears, the agent should consider whether an
abstraction is now justified. If the idea is still a one-off, the agent should
avoid creating a design system, helper package, or framework ceremony that the
project does not need yet.

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

## Where Guildhall stays quiet

More structure is not always better. A tiny project should not have to think
about release maps, coordinator rosters, design-system maturity, or settings
inheritance unless those concepts become useful.

Guildhall should keep advanced detail available, not mandatory. The coordinator
can ask a question when the project starts showing complexity, suggest a split
when a task is too broad, or surface a setting when repeated behavior suggests
the default is wrong. Until then, the system should do the ordinary thing
quietly.

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
