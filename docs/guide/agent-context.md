---
title: Agent context
---

# Agent context

Guildhall does not hand every helper a raw dump of your repo. That would be
expensive, noisy, and weirdly confident for something that still has to read the
actual files. Instead, it builds a focused context packet for the task, role,
and current state.

That packet is assembled just in time before the agent acts. It is meant to
answer:

- What task is this?
- What plan has already been accepted?
- What has already happened?
- What files or areas are likely relevant?
- Which abstractions are already available?
- What verification or review standard applies?
- What decisions or blockers must not be reopened?

If the project does not have a [Corpus Map](./corpus-map) yet, Guildhall creates one during
context assembly from the task project or active worktree. The map is therefore
available from the first meaningful agent pass in a normal project, not only
after a manual setup command.

## What the context builder includes

A typical worker or reviewer prompt can include these blocks:

| Block | Purpose |
|---|---|
| Current task | Task id, title, status, construction mode, priority, spec overview, acceptance criteria, out-of-scope notes. |
| Product brief | Reader or customer job, success metric, anti-patterns, and rollout notes when the task touches product surface area. |
| Latest required revisions | Reviewer feedback that still needs action. |
| Latest checkpoint | Last durable worker checkpoint, files touched, verification evidence, and next planned action. |
| Active worktree | Dirty files to resume before broad exploration. |
| Likely target files | Files inferred from spec text, commands, notes, and checkpoints. |
| [Corpus Map](./corpus-map) | Compact codebase orientation, existing abstractions, design-system maturity, and read-next pointers. |
| Business envelope | Parent goal, success condition, and guardrails. |
| Design system | Approved or draft UI primitives, tokens, copy voice, and accessibility baseline. |
| Review rubrics | The inspection criteria selected for this task. |
| Review packet | Changed files, self-critique, and verification evidence for review/gate stages. |
| Relevant memory | Matching sections from `MEMORY.md`, capped to stay useful. |
| Recent progress | Tail of `./.guildhall/PROGRESS.md`. |
| Recent decisions | Matching entries from `./.guildhall/DECISIONS.md`. |
| Exploring transcript | Tail of the active intake conversation from local history during `exploring`. |

Not every role gets every block. Guildhall keeps empty or irrelevant sections
out of the final prompt.

## Role-specific shape

### Spec agent

The spec agent receives task state, relevant project memory, exploring
transcript, applicable expert contributions, and enough project context to ask
bounded questions or write a blueprint.

It uses [Corpus Map](./corpus-map) guidance as an abstraction inventory when the task already
points at implementation areas. For UI work, that means checking whether the
design system is absent, thin, emerging, or established before inventing new
controls or styling rules. The map is a starting point, not a replacement for
reading source files.

### Coordinator

The coordinator focuses on coherence: whether a task is ready, whether a
blueprint is sufficient, whether a change order is needed, and whether the
project or domain plan still makes sense.

It does not need a full source dump. It needs the plan, current state, blockers,
dependencies, and evidence that a task is buildable or not.

### Worker

The worker receives the strongest operational packet:

- accepted blueprint
- likely target files
- active worktree state
- latest checkpoint
- revision feedback
- selected review rubrics
- [Corpus Map](./corpus-map) guidance
- design-system summary when relevant
- verification expectations

Before editing, the worker identifies the existing primitive, helper,
package, design token, component, area, or file pattern it is extending. If no
abstraction fits, it explains whether the change stays local or becomes a
small shared primitive because the same idea is now appearing
in multiple places.

After the worker changes files and hands the task forward, the orchestrator
refreshes the [Corpus Map](./corpus-map) from the touched-file evidence it has. That keeps the
next reviewer or worker oriented around what actually changed without forcing a
full repo scan every time.

### Reviewer

The reviewer receives the blueprint, review packet, selected rubrics, Corpus
[Corpus Map](./corpus-map), and relevant context. Review is not only “does this compile?” It asks
whether the work fits the accepted plan and the existing project architecture.

If a worker ignored a relevant mapped abstraction and created a parallel
solution, that is a review defect.

For UI work, the reviewer also checks whether the worker reused approved
tokens and primitives, or whether the design-system summary indicates a
legitimate gap that deserves a small shared addition.

### Gate checker

The gate checker mostly needs deterministic commands, task state, and recorded
verification evidence. It enforces checks; it does not replace review or your
judgment.

## What agents do not automatically receive

Agents do not automatically receive:

- every source file in the repository
- every historical transcript
- every session snapshot
- every memory entry
- every design-system detail
- every generated file or report

They can ask for more by reading files, searching, or running commands. The
default context keeps them oriented without drowning them.

## Why this matters

Good context makes the right action easier:

- The spec agent asks fewer vague questions.
- The worker reuses existing abstractions.
- The reviewer catches architectural drift.
- The coordinator sees what is moving now, what is queued, and what needs your
  answer.

More context is not always better. Guildhall’s job is to make relevant context
available without turning every small task into a cognitive tax.
