---
title: Design notes
---

# Design notes

Working notes for open product and implementation questions. These pages are
less polished on purpose: they capture current thinking, tradeoffs, and
evidence, not promises about what ships next.

- [Disagreement & handoff](./disagreement-and-handoff) — how reviewer conflicts resolve, and how mid-task handoff works.
- [Symphony comparison](./symphony-comparison) — feature and UX matrix against OpenAI's Symphony orchestration spec.
- [Beads and one-task pivot](./beads-and-one-task-pivot) — what Guildhall borrows from Beads/Ralph loops and the first one-task finisher slice.
- [Provider abstraction and throughput](./provider-abstraction-and-throughput) — protocol-first provider taxonomy, shared client pooling, bounded lane scheduling, and the path from one-task autonomy to queue throughput.
- [Agent policy and model bakeoff](./agent-policy-and-model-bakeoff) — the split between 0.5.x decision-point unblockers and 0.6.0 policy/model-evaluation work.
- [UI structural audit](./ui-audit) — where the live shell is strong, where it still drifts, and what the component layer needs next.
- [Node vs Deno packaging for Guildhall 0.5.0](./deno-vs-node-packaging) — why the current release keeps the packaged Node path.
