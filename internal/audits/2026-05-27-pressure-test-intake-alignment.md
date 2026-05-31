---
title: Pressure-test intake alignment audit
---

# Pressure-test intake alignment audit

Date: 2026-05-27

This audit checks whether Guildhall's pressure-test and intake system matches
the product intent: every project phase and every task should get automatic,
agent-run guardrails for completeness, trust, verification, review, and owner
vision fit. The user should not choose a "pressure-test path" or decide how
much pressure a task deserves. Guildhall owns that degree of pressure and should
apply whatever inspection, verification, and review are needed to make the work
trustworthy.

## Current alignment

- Request routing now treats pressure testing as required for every
  build-changing routed action. Small task intake, settings proposals,
  persona/practice proposals, repair triage, and broad pressure-test intake all
  carry `pressureTestRequired: true`; only the next visible route changes.
- The task request schema persists the pressure-test requirement, so the routed
  decision is not lost after Thread creates a task.
- Ordinary task intake now writes a durable `pressureTestSummary` into
  `requestIntake`, including the system-owned degree of pressure, quality bar,
  owner-question policy, and core checks for intent, scope, acceptance criteria,
  verification, review lenses, and release boundary.
- Broad release/feature intake now inspects workspace evidence before returning
  the first pressure-test question, instead of asking from a blank state.
- The deeper Pressure-Test Intake domain map now includes task boundaries,
  acceptance criteria, verification/TDD, and reviewer lenses alongside product
  goals, workflows, and risks/non-goals.
- The Spec Agent prompt now states the general rule: every task must be
  pressure-tested, and the system chooses the degree of pressure needed to reach
  the quality bar. It explicitly checks owner intent, completeness, acceptance
  criteria, verification, review lenses, non-goals, and release boundaries
  before a blueprint is ready.
- Existing downstream gates already support the bigger story: spec completion
  boundary validation, review planning, reviewer fan-out, worker self-critique,
  verification evidence, and blocked review handoff when proof is missing.

## Misalignments and gaps

- The automatic `pressureTestSummary` is still deterministic and coarse. It
  records the pressure contract, but it does not yet incorporate repo evidence,
  source coverage, task-size calibration, review-planning output, or escaped
  misses.
- Pressure-test state still does not model owner-vision fit and source evidence
  coverage as first-class domains.
- `renderPressureTestSpec` is still thin. It summarizes closed domains and
  deferrals, but it does not emit a complete implementation-ready packet with
  verification commands, reviewer lanes, TDD approach, task splits, or evidence
  gaps.
- Follow-up detection is still keyword-based. It can catch soft words like
  "clear" or "polished," but it is not a real completeness critique.
- Some older internal plans still describe Pressure-Test Intake as only for
  release/high-ambiguity requests. Those should be treated as historical design
  debt unless intentionally updated.
- The user-facing route name "Task Intake" can still imply a separate,
  non-pressure-tested path unless nearby UI copy makes the automatic guardrail
  visible.

## 0.9.0 implementation priority

1. Evolve `pressureTestSummary` from a deterministic contract into an evidence
   artifact. It should record inferred intent, evidence consulted, assumptions,
   missing facts, verification plan, reviewer lenses, and whether Guildhall can
   proceed without owner judgment.
2. Expand pressure-test domains further into owner-vision fit, source evidence
   coverage, rollout/release boundary, and deferrals.
3. Teach the Spec Agent to refresh the automatic pressure-test summary as
   durable task state, not only as prompt behavior.
4. Upgrade the completed pressure-test spec renderer into a real build packet:
   acceptance criteria, verification commands, reviewer lanes, split candidates,
   assumptions, deferrals, and open owner-only calls.
5. Replace keyword follow-up detection with an agent or deterministic rubric
   that asks "what would make this fail review or drift from owner intent?"
6. Sweep UI copy where routed actions are displayed so "Task Intake" reads as
   the shorter pressure-tested path, not the no-pressure-test path.
7. Update old internal plans only where they are still active references; do not
   rewrite historical notes just to erase the trail.
