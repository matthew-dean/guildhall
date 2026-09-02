---
name: guildhall-flow-audit
description: Audit and harden Guildhall UI/runtime flows with cross-surface state agreement, deterministic geometry checks, installed-app proof, and durable findings. Use for flow audits, user testing, localhost:7777 bugs, contradictory running/queued/blocked/owner-input states, ambiguous next actions, clipped or overflowing layouts, and browser-backed UI fixes.
---

# Audit a Guildhall Flow

## Establish the job and authority

1. Use `guildhall-read-project-state` to resolve the project and
   `artifact:flow-audit` before changing code.
2. Write the concrete user job: the user can tell what is happening now, what
   is queued or blocked, what they can do next, and whether the system works.
3. Read the authoritative API state and identify the shared summary/action
   model that owns the displayed concept.

## Compare every surface

Compare the same snapshot across the authoritative API, top action, work list
or cards, Thread, bottom/status chrome, and other visible cards. Treat any
disagreement about running, queued, blocked, owner input, approval, readiness,
or next action as a shared runtime-model defect before a copy or layout defect.
Do not re-rank or reinterpret raw state inside a view.

## Prove behavior and geometry

- Use `defineFlowUserJob`, `readProjectFlowState`,
  `expectNoClippedContent`, and `expectProjectFlowStateAgreement` from
  `tests/rendered-ui/flow-audit-assertions.ts`.
- Check the reported desktop or split viewport, a narrower desktop viewport,
  and mobile when the route has a mobile layout.
- Require visible content to remain unclipped. Put unavoidable horizontal
  overflow inside a named scroll region.
- Add a rendered regression and, when the miss escaped judgment, a calibration
  case under `internal/calibration/cases/ux`.

## Prove the installed product

When the target is `localhost:7777`, run these sequentially—never alongside a
Playwright web-server run because they rewrite `.svelte-kit` and `dist`:

1. `pnpm build`
2. `pnpm dev:install`
3. `guildhall stop && guildhall start`
4. Confirm `/api/stale-server` reports `stale:false`.
5. Verify the real route in a browser.

Update `artifact:flow-audit` in the same turn for completed, deferred, newly
discovered, or blocked work. Do not claim completion when browser/runtime proof
still fails.
