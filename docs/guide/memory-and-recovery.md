---
title: Memory and recovery
pageClass: gh-first-visit-page
---

# Memory and recovery

Guildhall can now do more than stop at the first awkward blocker. When a worker
gets stuck, the coordinator classifies the failure, chooses a bounded recovery
playbook, and records what happened. When the result teaches Guildhall
something durable, the lesson lands in the right layer instead of becoming
mystery behavior.

The important product rule is simple: **Guildhall may learn, but learned
behavior stays inspectable and reversible.**

## Bounded recovery

Recovery is not open-ended wandering. Each recovery path has a name, path
bounds, allowed tools, success signals, and stop signals.

Examples include:

- rereading a focused file before editing again
- rerunning the authoritative command that failed
- repairing a touched-file verification failure
- refreshing a stale edit target after an `oldString` miss
- stopping with a concrete human question when the setup issue is outside the
  task

Thread and blocker summaries should explain the human reason, not raw internal
schema names. The audit trail keeps the typed classification and playbook record
for future inspection.

## Memory layers

Guildhall separates lessons by scope:

| Layer | Used for | Where to inspect |
|---|---|---|
| This project | Repo-specific commands, paths, facts, and workflow habits. | Settings -> Learning -> This project |
| Across projects | Repeated user preferences that can apply beyond one repo. | Settings -> Learning -> Across projects |
| Project playbooks | Repeatable project-local procedures that can enter worker context when a matching task appears. | Settings -> Learning -> Project playbooks |
| Ideas for Guildhall | Product improvements for Guildhall itself. They do not change runtime behavior. | Settings -> Learning -> Ideas for Guildhall |

Project facts do not silently become global preferences. Product ideas do not
silently change how Guildhall runs. If a behavior would increase autonomy or
apply more broadly, it needs explicit approval.

## Memory and habits

Open **Settings -> Learning** inside a project to review what Guildhall wants to
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

## Product feedback

Product ideas are for improving Guildhall itself. They include the suggestion,
evidence, affected project, and source id, but they remain inert until a human
decides to act.

The **Give product feedback** button opens a draft issue in the Guildhall GitHub
repo. Guildhall does not submit the issue automatically.
