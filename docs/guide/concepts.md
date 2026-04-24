---
title: Core concepts
---

# Core concepts

A quick tour of the vocabulary. Each term links to a deeper page.

## Workspace

A directory containing a `guildhall.yaml` and a `memory/` folder. One workspace = one project the guild works on. See [Workspaces](./workspaces).

## Task

A unit of work with a status, a domain, an optional spec, acceptance criteria, hard gates, and review verdicts. Tasks move through a fixed lifecycle: `proposed → exploring → spec_review → ready → in_progress → review → gate_check → done` (terminal: `done`, `shelved`, `blocked`). See [Task lifecycle](./task-lifecycle).

## Domain

A named slice of the project (e.g. `ui`, `backend`, `infra`) owned by one coordinator. Every task declares a domain. Tasks never cross domains silently — cross-domain work becomes an explicit handoff.

## Coordinator

The persona that owns a domain. Defined in `guildhall.yaml` with a **mandate**, **concerns**, and lists of **autonomous decisions** and **escalation triggers**. The coordinator decides whether tasks in its domain advance; see [Coordinators & domains](./coordinators).

## Agent

A stateful, tool-using conversation. Five built-in roles: **spec**, **coordinator**, **worker**, **reviewer**, **gateChecker**. Each role maps to a model (configurable per project). See [Agents & models](./agents-and-models) and the [agents subsystem](../subsystems/agents).

## Guild

A persona with principles, a review rubric, and deterministic checks that sits at the table for relevant tasks. Examples: *Accessibility Specialist*, *Color Theorist*, *Frontend Engineer*. Guilds attach to tasks via an applicability predicate; multiple guilds can review one task (fan-out). See [Guilds](../subsystems/guilds).

## Lever

A named decision point — e.g. `merge_policy`, `reviewer_mode`, `worktree_isolation` — with enumerated positions and full provenance (*who set it, when, why*). Every behavioral variation is a lever, not a hardcoded default. See [Levers](../levers/).

## Hard gate / soft gate

**Hard gates** are deterministic checks a task must pass before it can complete (lint, typecheck, test, custom shell). **Soft gates** are rubric items scored by a reviewer. Together they form the completeness bar. See [Subsystems → Core → Gates](../subsystems/core#gates).

## Business envelope

The project-level `Goals` + `Guardrails` document that defines what the guild is allowed to do and what it isn't. `business_envelope_strictness` controls enforcement mode. See [Subsystems → Runtime](../subsystems/runtime#business-envelope).

## Skill

A bundled instruction set (markdown + YAML frontmatter) an agent can invoke. Skills are how you teach the guild reusable procedures without baking them into prompts. See [Skills](../subsystems/skills).

## Hook

A user-defined command, prompt, HTTP call, or agent invocation that fires at lifecycle events (`session_start`, `pre_tool_use`, `post_tool_use`, etc.). Hooks let you plug in audit loggers, external approvals, and custom side effects. See [Hooks](../subsystems/hooks).

## MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server — stdio, HTTP, or WebSocket — whose tools become agent-callable. See [MCP](../subsystems/mcp).

## Session

A persisted snapshot of an agent's conversation: messages, model, usage, tool metadata. Enables **warm resume** — you can interrupt an agent and it will pick up from the last snapshot. See [Sessions](../subsystems/sessions).
