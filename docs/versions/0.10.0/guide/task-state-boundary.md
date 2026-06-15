---
title: Cleaner project notes
help_topic: guide.task_state_boundary
help_summary: |
  Guildhall keeps the project notes you share small and readable, while saving
  the detailed receipts locally when you need to inspect what happened.
---

# Cleaner Project Notes

Guildhall writes things down as it works.

That is one of the reasons it exists. A normal chat can lose the thread:
what you asked for, what the agent changed, what failed, what passed, and why a
task was called done. Guildhall keeps that trail so you can come back later and
see the shape of the work.

But there is a catch: not every receipt belongs in your repo.

A good project record should tell you what the task is, what decision was made,
and where to look for proof. It should not turn `./.guildhall/TASKS.json` into
a junk drawer full of transcripts, command output, local paths, retries,
checkpoints, and every little thing an agent muttered along the way.

So Guildhall keeps two layers:

- **The project notebook** lives in `./.guildhall/`. It is compact enough to
  review, commit, and share with another checkout.
- **The receipt box** lives under `~/.guildhall/data/projects/<project-hash>/`.
  It can hold the longer evidence without making your repo noisy or weird.

Most of the time, you should not have to think about this. You open Thread,
Overview, Closure, or the task drawer, and Guildhall shows the useful story:
what happened, what still needs attention, and where the evidence came from.

The split mostly matters when you look at Git. Your shared project files stay
small. Your machine keeps the bulkier proof. If a summary points to evidence
that only exists locally, Guildhall says so.

## Cleaning Up Older Projects

Older Guildhall projects may already have crowded task files. You can preview a
cleanup first:

```sh
guildhall migrate task-state .
```

Then apply it:

```sh
guildhall migrate task-state --apply .
```

Guildhall saves the detailed evidence locally before rewriting the smaller
project task file.
