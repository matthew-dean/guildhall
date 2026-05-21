---
title: Task drawer
help_topic: web.task_drawer
help_summary: |
  Slides open from the right when you click a task card. Tabs: Now when live
  context exists, then Spec, Transcript, Experts, History, and Provenance.
  Shows the task evidence and audit trail.
---

# Task drawer

The task drawer opens when you click a task card. It keeps the current state,
spec, transcript, reviews, history, and provenance for one task in the same
place so you do not have to reconstruct what happened from scattered logs.

## Tabs

| Tab | What it answers |
|---|---|
| **Now** | What is happening right now? Shows active handoffs, questions, live work, or resume actions when current context exists. |
| **Spec** | What is the task supposed to accomplish? Shows intent, acceptance criteria, and hard or soft gates. Editable when the task status allows it. |
| **Transcript** | What did the agent actually do and say? Shows the task conversation and tool-use trail. |
| **Experts** | Who reviewed this and what did they think? Shows applicable guilds, review status, and reviewer feedback. |
| **History** | How did the task move through the system? Shows status changes, review verdicts, escalations, and gate outcomes. |
| **Provenance** | Which project policies shaped this task? Shows lever positions, who set them, and when. |

## When a task is stuck

When a task is blocked, the drawer should summarize why in one place: recent
reviewer rejections, failed gate output, escalation text, and the next decision
Guildhall needs from you.

## Inline actions

- Approve a spec when the task is ready to leave review.
- Send a follow-up when the agent needs correction or extra context.
- Re-draft a spec, re-run review, or re-run gates when the current stage needs another pass.
- Pause, shelve, or unshelve work directly from the drawer.
- Resolve an escalation with a short note once the blocker is handled.
