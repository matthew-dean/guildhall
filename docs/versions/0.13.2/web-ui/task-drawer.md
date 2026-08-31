---
title: Task drawer
help_topic: web.task_drawer
help_summary: |
  Slides open from the right when you click a task card. Tabs: Overview,
  Action when needed, Spec, Journey, Transcript, Experts, History, and Origin.
  Shows the task evidence and audit trail.
---

# Task drawer

The task drawer opens when you click a task card. It keeps the current state,
spec, transcript, reviews, history, and provenance for one task in the same
place so you do not have to reconstruct what happened from scattered logs.

The header starts with a compact project breadcrumb. The project name is the
prefix when Guildhall knows it; the project id is the fallback. A short task key
stays visible beside the title because split tasks can have similar names.

## Tabs

| Tab | What it answers |
|---|---|
| **Overview** | What is this work, where is it now, and what matters next? |
| **Action** | What can I do right now? Appears when the task has an active handoff, question, approval, recovery, or resume action. |
| **Spec** | What is the task supposed to accomplish? Shows intent, acceptance criteria, and hard or soft gates. Editable when the task status allows it. |
| **Journey** | What happened from start to finish? Shows task size, split recommendations, planned review, worker pass, changed files, reviewer pass, verification, done summary, and outcome as a readable story. |
| **Transcript** | What did the agent actually say? Shows the source conversation and durable task notes. Once a task is done, Journey becomes the friendly default and Transcript becomes backup evidence. |
| **Experts** | Who reviewed this and what did they think? Shows applicable guilds, review status, and reviewer feedback. |
| **History** | What does the lower-level log say? Shows revisions, gate output, and escalations. |
| **Origin** | Where did this work come from and which project policies shaped it? Shows source context, lever positions, who set them, and when. |

## Review plan

When Guildhall has planned a review, the Spec tab shows a compact review plan.
It tells you the review level, the main risks Guildhall is checking, the
reviewer budget, and the evidence or checks the task needs before it can be
accepted.

The card starts small on purpose. You can see the shape of the review without
reading a wall of process. If you want the details, expand it to see reviewer
groups, deterministic checks, required evidence, and any lenses Guildhall chose
not to use.

## Task size

When Guildhall has sized a task, Journey shows the score in plain language:
tiny, small, medium, large, or epic. Small work can move ahead. Medium work gets
a little extra caution. Large work gets split recommendations. Epic work shows
the linked nested work Guildhall created so each runnable item stays clear,
reviewable, and tied back to the same containing work. If an older item has a
split-required plan but has not been split yet, Overview says it is ready to
split, shows the work it will create, and offers **Split this work**.

For new work, that button should be the exception. If a spec says the work is
more than one runnable item, approving the spec creates the nested work and
keeps the original as the containing work.

The point is not ceremony. It is to stop one task from quietly turning into five
different jobs with one tired reviewer at the end.

## Request shape

For tasks created from **New request**, Journey can show how Guildhall read the
ask before it became work. If the request might mean "write a policy/spec" or
"implement the thing," Guildhall records that ambiguity, names the pieces that
fit together, and asks a focused question before pretending it knows.

Those pieces are the component stack: the policy decision, spec, implementation
surfaces, data or API changes, docs, release work, and verification that may
need to become linked nested work. It is a small breadcrumb trail for why the
coordinator split the work, asked a question, or kept it as one item.

Overview also lets you move through the hierarchy. Containing work, dependency,
and nested-work links replace the open drawer item while keeping the same
project page behind it, so you can walk the split without losing your place.

## Done tasks

When a task is done, Guildhall writes a compact done-task summary bundle. Journey
shows the useful version first: what happened, what changed, what checked it,
what reviewers saw, and what residue is still open.

Transcript is still available as the source conversation, but it stops being the
main artifact after completion. Older transcript bodies can be compacted into
summary plus evidence references; if full evidence is no longer available,
Guildhall says that directly instead of pretending.

## Changed files

Journey lists changed files from the worker checkpoint and git story. Directories
stay out of that list, because they are not files you can inspect.

Click a file to read it inline. Guildhall reads from the project or the task
worktree only, caps large previews, and tells you when a file cannot be read.
The current viewer is intentionally simple; a richer diff view belongs on top of
a real code/diff viewer library instead of a hand-rolled renderer.

## When a task is stuck

When a task is blocked, the drawer summarizes why in one place: recent
reviewer rejections, failed gate output, escalation text, and the next decision
Guildhall needs from you.

## Inline actions

- Approve a spec when the task is ready to leave review.
- Send a follow-up when the agent needs correction or extra context.
- Re-draft a spec, re-run review, or re-run gates when the current stage needs another pass.
- Pause, shelve, or unshelve work directly from the drawer.
- Resolve an escalation with a short note once the blocker is handled.
