# Guildhall 0.11.0 Implementation Tracker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this tracker task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the provider-guidance and task-lifecycle cleanup work that should
not crowd the 0.10 operating-map release.

**Release boundary:** 0.11.0 starts after 0.10.0 proves bounded owner input,
project graph authority, contract surfaces, external task authority, and the
agent memory bridge. Do not pull OpenRouter back into 0.10 unless the owner
explicitly changes the release boundary.

## Source Plans

- `internal/plans/2026-05-28-guildhall-0-11-openrouter-support.md`
- `internal/specs/2026-06-01-guildhall-0-10-state-machines-project-graph.md`

## Milestone 1: OpenRouter Guided Setup

**Purpose:** Offer OpenRouter as a trustworthy hosted-provider setup path with
clear routing, attribution, privacy/cost posture, and recommendation evidence.

- [ ] Add named OpenRouter provider profile and request extras.
- [ ] Add role-aware presets and recommendation evidence thresholds.
- [ ] Add guided provider UI, browser proof, and listing-readiness packet.
- [ ] Update public provider docs only after the setup path is implemented and
  proven with live or fixture-backed evidence.

## Milestone 2: Task Lifecycle Migration

**Purpose:** Move broad task lifecycle cleanup out of ad hoc status fields and
onto explicit node/linkage state machines after the 0.10 state-machine
substrate has proven itself.

- [ ] Define conversion scripts for legacy task status shapes that should become
  graph linkages or state-machine receipts.
- [ ] Migrate parent/child relationships into task hierarchy node links instead
  of treating parentage as a task state.
- [ ] Route task lifecycle writes through explicit transition helpers and
  receipts.
- [ ] Keep owner-facing labels separate from persisted lifecycle states.
