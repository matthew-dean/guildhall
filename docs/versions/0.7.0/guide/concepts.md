---
title: Core concepts
---

# Core concepts

A quick tour of the vocabulary. Each term links to a deeper page.

## Agent harness

The layer around AI models that gives them work, context, tools, state,
permissions, review rules, and recovery paths. A chat assistant answers a
conversation. An agent harness runs a workflow.

Guildhall is an agent harness for local software projects.

## Project / workspace

In the product, you mostly think in **projects**. In the runtime and config
layers, the same unit is still often called a **workspace**.

Either way, it means one directory containing a `./guildhall.yaml` and a
`./memory/` folder. See [Workspaces](./workspaces).

## Task

A framed piece of work with a status, a domain, an optional blueprint/spec,
acceptance criteria, hard gates, and review verdicts. Tasks move through a
fixed lifecycle: `proposed → exploring → spec_review → ready → in_progress →
review → gate_check → done` (terminal: `done`, `shelved`, `blocked`). See
[Task lifecycle](./task-lifecycle).

## Blueprint

An accepted plan for a project, release, phase, or task. A blueprint names what
is being built, why it matters, what is in and out of scope, how it will be
verified, and what assumptions are still risky. See
[How Guildhall builds](./how-guildhall-builds).

## Framing

The work of turning broad intent into buildable structure: phases, task
boundaries, dependencies, active tranches, attached questions, likely files,
and verification standards. Framing is what prevents a project from becoming a
pile of drafts.

## Domain

A named slice of the project (e.g. `ui`, `backend`, `infra`) owned by one coordinator. Every task declares a domain. Tasks never cross domains silently — cross-domain work becomes an explicit handoff.

## Coordinator

The general-contractor role for a domain. Defined in `./guildhall.yaml` with a
**mandate**, **concerns**, and lists of **autonomous decisions** and
**escalation triggers**. The coordinator decides whether tasks in its domain
advance and keeps the local plan coherent; see
[Coordinators & domains](./coordinators).

## Agent

A stateful, tool-using conversation. Five built-in roles: **spec**,
**coordinator**, **worker**, **reviewer**, **gateChecker**. Each role maps to
a model and provider choice, with machine-wide defaults and optional
project-level overrides. See [Agents & models](./agents-and-models).

## Guild

The metaphor behind the product name. A guild hall is a shared place where
different skilled trades coordinate work under common standards.

In Guildhall, a **guild** is a specialist persona with principles, a review
rubric, and deterministic checks for relevant tasks. Examples:
*Accessibility Specialist*, *Color Theorist*, *Frontend Engineer*. Guilds
attach to tasks via an applicability predicate; multiple guilds can inspect
one task (fan-out).

## Change order

An explicit revision to the accepted plan. Use a change order when new evidence
changes scope, sequencing, assumptions, or task shape. Change orders stay
visible because silent drift destroys trust.

## Punch list

The small remaining finish work after the main build is coherent: cleanup,
docs alignment, missing tests, release notes, polish, and deferred follow-ups.
The punch list separates shipping blockers from nice-to-have finish work.

## Lever

A named decision point — e.g. `merge_policy`, `reviewer_mode`, `worktree_isolation` — with enumerated positions and full provenance (*who set it, when, why*). Every behavioral variation is a lever, not a hardcoded default. Onboarding can infer initial lever positions from the meta-intake conversation, but approved values still land in plain YAML with rationale. See [Levers](../levers/) and [Onboarding and levers](./onboarding-and-levers).

## Hard gate / soft gate

**Hard gates** are deterministic checks a task must pass before it can complete (lint, typecheck, test, custom shell). **Soft gates** are rubric items scored by a reviewer. Together they form the completeness bar.

## Business envelope

The project-level `Goals` + `Guardrails` document that defines what Guildhall is allowed to do and what it is not. `business_envelope_strictness` controls enforcement mode.

## Skill

A bundled instruction set an agent can invoke. Skills are how you teach Guildhall reusable procedures without baking them into prompts.

## Hook

A user-defined command, prompt, HTTP call, or agent invocation that fires at lifecycle events (`session_start`, `pre_tool_use`, etc.). Hooks let you plug in audit loggers, external approvals, and custom side effects.

## MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server — stdio, HTTP, or WebSocket — whose tools become agent-callable.

## Session

A persisted snapshot of an agent's conversation: messages, model, usage, tool metadata. Enables **warm resume** — you can interrupt an agent and it will pick up from the last snapshot.
