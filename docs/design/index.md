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
- [Project construction manifesto](./project-construction-manifesto) — the internal guild/construction model for planning, framing, building, inspecting, changing, and shipping software work.
- Guildhall 0.7.0 project construction planning — internal target spec at `docs/superpowers/specs/2026-05-20-guildhall-0-7-project-construction-planning.md` for turning ambitious product goals into a durable Build Map, active tranche, slices, tasks, and change orders.
- [Agent policy, learning, and model bakeoff](./agent-policy-and-model-bakeoff) — the split between 0.5.x decision-point unblockers and the 0.6.0 policy, bounded-improvisation, learning, and model-evaluation work.
- [UI structural audit](./ui-audit) — where the live shell is strong, where it still drifts, and what the component layer needs next.
- [Node vs Deno packaging for Guildhall 0.5.0](./deno-vs-node-packaging) — why the current release keeps the packaged Node path.
