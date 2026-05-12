---
title: Design notes
---

# Design notes

Working notes for open product and implementation questions. These pages are
less polished on purpose: they capture current thinking, tradeoffs, and
evidence, not promises about what ships next.

- [Disagreement & handoff](./disagreement-and-handoff) — how reviewer conflicts settle, and what happens when work changes hands mid-task.
- [UI structural audit](./ui-audit) — where the live shell is strong, where it still drifts, and what the component layer needs next.
- [Symphony comparison](./symphony-comparison) — feature and UX comparison against OpenAI's Symphony direction.
- [Beads and one-task pivot](./beads-and-one-task-pivot) — what Guildhall borrows from Beads/Ralph loops and why the one-task finisher matters.
- [Provider abstraction and throughput](./provider-abstraction-and-throughput) — provider plumbing, lane scheduling, and the path from one-task autonomy to higher throughput.
- [Node vs Deno packaging for Guildhall 0.5.0](./deno-vs-node-packaging) — why the current release keeps the packaged Node path.
