---
title: Task drawer
help_topic: web.task_drawer
help_summary: |
  Slides open from the right when you click a task card. Tabs: Transcript,
  History, Spec, Experts, Provenance. Shows the full audit trail from
  memory/transcripts/ for that task.
---

# Task drawer

`src/web/surfaces/TaskDrawer.svelte`. Opens when you click any task card.

## Tabs

| Tab | Component | Content |
|---|---|---|
| **Transcript** | `drawer/TranscriptTab.svelte` | Live streaming view of whichever agent is currently working this task. Text deltas, tool calls, results. |
| **History** | `drawer/HistoryTab.svelte` | Complete transition log: status changes, reviewer verdicts, escalations. |
| **Spec** | `drawer/SpecTab.svelte` | The task's spec — intent, acceptance criteria, hard/soft gates. Editable when status allows. |
| **Experts** | `drawer/ExpertsTab.svelte` | Which guilds are applicable, which have reviewed, what they said. |
| **Provenance** | `drawer/ProvenanceTab.svelte` | Every lever position in effect for this task with setter + timestamp. |

## Why-stuck widget

`drawer/WhyStuck.svelte` appears when the task is `blocked`. It aggregates the most recent reviewer rejections, failed gate outputs, and escalation text into a single "here's why you're waiting on me" panel so humans don't have to piece it together.

## Inline actions

- Approve spec → advances `spec_review → ready`.
- Request revision → returns to `exploring`.
- Pause / Resume / Shelve — match the CLI commands of the same names.
- Resolve escalation — close with a resolution note.
