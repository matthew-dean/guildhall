---
title: max_revisions
help_topic: lever.max_revisions
help_summary: |
  How many revision cycles a task can go through before it is forcibly
  marked blocked and surfaced for human attention. Default 3.
---

# `max_revisions`

**Scope:** domain • **Default:** `3`

Integer lever. Maximum number of `review → in_progress → review` loops allowed before the task is marked `blocked` and surfaced in the coordinator inbox.

## Storage

```yaml
max_revisions:
  position: 5
  rationale: "Complex migration domain — reviewers are picky."
```

## Why cap revisions

Without a cap, an LLM worker and an LLM reviewer can thrash indefinitely — each turn spinning without meaningful progress. The cap forces a human to look once the loop has failed to converge.

When a task hits the cap, the blocking reason includes every reviewer verdict from the revisions, so the human has the full history of "what was tried and rejected" without having to hunt.
