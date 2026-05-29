---
title: Memory, learning, and recovery
pageClass: gh-first-visit-page
---

# Memory, learning, and recovery

Memory is part of how Guildhall works, not just a task cleanup feature. It is
how the product remembers useful project facts, asks before turning repeated
preferences into defaults, and recovers from stuck work without starting from
scratch.

When a worker gets stuck, the coordinator classifies the failure, chooses a
bounded recovery playbook, and records what happened. When the result teaches
Guildhall something durable, the lesson lands in the right layer instead of
becoming mystery behavior.

The important product rule is simple: **Guildhall may learn, but learned
behavior stays inspectable and reversible.**

## Bounded recovery

Recovery is not open-ended wandering. Each recovery path has a name,
construction mode, path bounds, allowed tools, success signals, and stop
signals.

Examples include:

- rereading a focused file before editing again
- rerunning the authoritative command that failed
- repairing a touched-file verification failure
- refreshing a stale edit target after an `oldString` miss
- proposing a change order when evidence shows the blueprint is wrong
- stopping with a concrete question when the setup issue is outside the task
- reframing a confusing task before implementation begins

Thread and blocker summaries explain the real reason, not raw internal schema
names. The audit trail keeps the typed classification and playbook record for
future inspection.

Reframe is deliberately stage-aware. If implementation, review, or gate checks
have already started, Guildhall preserves the work trace and uses a change
order, pause, follow-up, or revision instead of erasing the task back to intake.

## Memory layers

Guildhall uses two storage lanes. Compact shared state lives in `./.guildhall/`
so another checkout can understand the same project without a fresh intake.
Bulky or private history lives under `~/.guildhall/data/projects/<project-hash>/`
so transcripts, checkpoints, debug snapshots, and full task evidence do not
fill every pull request.

The compact layer is a navigation layer, not a magic replacement for evidence.
When a saved lesson, task summary, preference suggestion, or playbook proposal
can change future behavior, Guildhall keeps source links back to the fuller
local history that produced it. You can read the short version first, then
open the evidence when the reason matters.

Guildhall separates lessons by scope, because “remember this” can mean very
different things:

| Layer | Used for | Where to inspect |
|---|---|---|
| This project | Repo-specific commands, paths, facts, and workflow habits. | Settings -> Memory -> This project |
| Across projects | Repeated user preferences that can apply beyond one repo. | Settings -> Memory -> Across projects |
| Project playbooks | Repeatable project-local procedures that can enter worker context when a matching task appears. | Settings -> Memory -> Project playbooks |
| Ideas for Guildhall | Product improvements for Guildhall itself. They do not change runtime behavior. | Settings -> Memory -> Ideas for Guildhall |

Project facts do not silently become global preferences. Product ideas do not
silently change how Guildhall runs. If a behavior would increase autonomy or
apply more broadly, it needs explicit approval.

Cross-project preferences use a flexible shape instead of a fixed list of
software categories. A preference can describe a package manager, a game engine,
a writing tone, a release habit, or any other subject Guildhall has evidence
for. The useful parts are the same: what area the preference belongs to, what
you prefer, what you avoid, how strong the signal is, and whether there are
exceptions.

For example, one preference might say you prefer `pnpm` and avoid `npm` for
JavaScript package management. Another might say you prefer a lightweight game
engine and avoid an editor-first engine unless the project already uses it.
Guildhall keeps those as suggestions until you choose to use them everywhere or
only in the current project.

## Memory and habits

Open **Settings -> Memory** inside a project to review what Guildhall wants to
reuse.

Common actions:

- **Use this** activates a project memory.
- **Use everywhere** activates a repeated preference across projects.
- **Use only here** turns a cross-project suggestion into an active project
  habit and resolves the original global suggestion.
- **Use playbook** activates a project-local procedural memory.
- **Ignore** dismisses a suggestion without deleting the evidence trail.
- **Give product feedback** opens a prefilled GitHub issue draft for inert
  product ideas.

The normal task flow does not ask you to approve every lesson. Suggested items
stay off until you choose to use them.

## What future agents receive

Accepted memory can enter future agent context as an effective memory packet.
Guildhall filters by scope, type, domain, task kind, file area, confidence,
risk, and freshness so a worker sees the project facts and habits that are
likely to matter now, not every note Guildhall has ever written.

High-risk or merely proposed memory stays out of automatic worker context until
it is accepted. When memory is withheld, Guildhall keeps the reason so the
decision can be audited later.

Outside tools can inspect the same memory layer through MCP. See
[External agents and MCP](./external-agents) for the resource list.

## Product feedback

Product ideas are for improving Guildhall itself. They include the suggestion,
evidence, affected project, and source id, but they remain inert until someone
chooses to act.

The **Give product feedback** button opens a draft issue in the Guildhall GitHub
repo. Guildhall does not submit the issue automatically.
