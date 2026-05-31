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

For design-system work, review context should include the local control catalog
and, when the catalog is thin, a small outside reference set. The reviewer is
checking more than "does a component exist?" A useful catalog tells agents when
to use a control, when not to use it, what nearby alternatives exist, what each
variant and important prop means, and which layout primitive owns spacing. When
that guidance is missing, reviewers can lean on established control-pattern
references such as WAI-ARIA Authoring Practices for semantics and keyboard
behavior, Material Design or Apple HIG for component intent, and usability
research for selection-control choices. The result should still be adapted to
the project's own design system rather than copied wholesale.

That review should include affordance quality, not only correctness. Long,
searchable, user-specific, or remote option sets usually deserve a
combobox/typeahead/autocomplete instead of a strict select, because typing to
narrow a list is faster than scanning a wall of options. Short, stable lists
can still be radios, segmented controls, or selects when seeing all choices is
the easier path. Reviewers should expect loading, empty, no-results, keyboard,
and screen-reader behavior to be part of the component contract.

Design review starts by preserving the author's intent: the audience, product
job, taste direction, constraints, and scope that made this work worth doing.
From there, Guildhall can still raise the bar. It can point out blind spots,
rough affordances, missing states, or places where the interface would become
clearer and more pleasant with a small system addition. When the stronger move
is broader, Guildhall keeps it visible: replacing a brittle bespoke control
with a tested primitive, or removing a third-party package whose overhead is
larger than the product need, becomes a design opportunity for you to accept,
defer, or reject.

Those stronger review lenses also apply to work already in motion. When
Guildhall learns better design-system guidance, it can recheck active UI tasks
and record design findings for work that may have started before the stronger
lens existed. That keeps existing projects from being stranded on older
assumptions while still giving you the choice to accept, defer, or reject the
new opportunity.

The same backstop applies outside design. Current Guildhall improvements can
also recheck active work for spec readiness, review calibration, proof paths,
runtime access, memory context, architecture fit, and accessibility. The pass is
deliberately conservative: it is a cheap inspection that records a small
advisory note only when the task clearly matches a lens. Deeper analysis waits
until the task naturally reaches spec, implementation, review, or gate check.

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
