---
title: Coordinators & domains
---

# Coordinators & domains

A **coordinator** owns a **domain** — a named slice of the project. Tasks belong to exactly one domain, and the coordinator for that domain decides whether tasks advance.

## Defining a coordinator

Coordinators live under `coordinators:` in `guildhall.yaml`:

```yaml
coordinators:
  - id: ui
    name: UI Coordinator
    domain: ui
    path: packages/ui         # relative to projectPath
    mandate: |
      The UI package is a stack-agnostic component library. Components must be
      generic, accessible (WCAG 2.1 AA), and documented with a contract README
      and story.
    concerns:
      - id: accessibility
        description: All components must meet WCAG 2.1 AA.
        reviewQuestions:
          - Is this component keyboard-navigable?
          - Are appropriate ARIA roles and attributes present?
      - id: api-genericity
        description: Component APIs must be domain-neutral.
        reviewQuestions:
          - Does this API reference any app-specific concepts?
    autonomousDecisions:
      - Approve minor spec revisions that do not change scope
      - Decide API naming for new primitives
    escalationTriggers:
      - Any change to the public token API surface
      - Adding a new package to the monorepo
```

## What the coordinator does

At every tick, for every task in its domain, the coordinator agent:

1. Evaluates proposals (promote to `exploring`, defer, or reject).
2. Reviews drafted specs (promote to `ready` or request revisions).
3. Selects reviewer personas (guilds) to fan out to.
4. Adjudicates reviewer disagreements according to [`reviewer_fanout_policy`](../levers/reviewer-fanout-policy).
5. Decides completion approval per [`completion_approval`](../levers/completion-approval).

## Autonomous decisions vs escalation triggers

A coordinator will act alone within its listed `autonomousDecisions`. Anything that matches an `escalationTriggers` item raises an **escalation** in the inbox instead. This is the main way you define "don't do X without asking me."

## Meta-intake: generating coordinators

For a new project, run:

```bash
guildhall meta-intake
```

A meta-intake agent interviews you about the codebase, reads what it needs to read, and drafts coordinator definitions. Run `guildhall approve-meta-intake` to merge the draft into `guildhall.yaml`.
