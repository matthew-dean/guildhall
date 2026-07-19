---
title: Design notes
---

# Design notes

Working notes for open product and implementation questions. These pages are
less polished on purpose: they capture current thinking, tradeoffs, and
evidence, not promises about what ships next.

- [Disagreement & handoff](./disagreement-and-handoff) — how reviewer conflicts resolve, and how mid-task handoff works.
- [Symphony comparison](./symphony-comparison) — feature and UX matrix against OpenAI's Symphony orchestration spec.
- [Provider abstraction and throughput](./provider-abstraction-and-throughput) — protocol-first provider taxonomy, shared client pooling, bounded lane scheduling, and the path from one-task autonomy to queue throughput.
- [UX review calibration and work-review integration](./ux-review-calibration-and-work-review-integration) — product-agnostic failure corpora, reviewer recipe calibration, and how calibrated UX review plugs into task review/fanout/gates.
- [Review effort, review budget, and calibration harness](./review-effort-budget-and-calibration-harness) — how Guildhall chooses review depth across all reviewer lanes, tests quality/cost tradeoffs, and explains review effort in public docs.
- [Agent policy, learning, and model bakeoff](./agent-policy-and-model-bakeoff) — the split between 0.5.x decision-point unblockers and the 0.6.0 policy, bounded-improvisation, learning, and model-evaluation work.
Historical UI snapshots, packaging decisions, and architecture notes live under
[`archive/`](./archive/README.md). The active project-state architecture is defined only by
`internal/plans/2026-07-14-project-state-architecture-pivot.md`.
