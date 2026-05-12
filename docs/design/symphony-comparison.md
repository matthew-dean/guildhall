---
title: Symphony comparison
---

# Symphony comparison

This note compares Guildhall against OpenAI's Symphony direction as described in:

- [An open-source spec for Codex orchestration: Symphony](https://openai.com/index/open-source-codex-orchestration-symphony/)
- [openai/symphony `SPEC.md`](https://github.com/openai/symphony/blob/main/SPEC.md)
- [openai/symphony Elixir README](https://github.com/openai/symphony/blob/main/elixir/README.md)
- [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/)

The comparison is intentionally about both feature coverage and UX. Symphony is
mostly an orchestration spec and prototype runner; Guildhall is already more of
a local product surface. That means "ahead" and "behind" are not just about code
paths. They are about who can start work, what they have to understand, how much
state is visible, and whether the system reduces or relocates operator burden.

## Executive read

Guildhall is directionally aligned with Symphony's core premise: long-running
agent work should be managed at the work-item level, not by manually babysitting
chat sessions. It is also ahead of Symphony's spec on product UX, local setup,
policy legibility, provider choice, in-browser task shaping, and explicit
human-facing controls.

The biggest gaps are external-control-plane integration and last-mile landing.
Symphony treats Linear as the source of work, keeps one isolated workspace per
issue, continuously reconciles tracker state, and explicitly shepherds work
through CI, conflicts, review, and handoff. Guildhall has richer local task and
review machinery, but its primary control plane is still project-local
`memory/TASKS.json` plus the dashboard.

## Key takeaways

- Guildhall is stronger on local product UX, transparent policy, and provider flexibility.
- Symphony is stronger on external tracker integration and PR/CI landing flow.
- The useful direction is not imitation; it is borrowing the right control-plane
  and landing ideas while preserving Guildhall's stronger operator surface.
