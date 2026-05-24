# Global Preference Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans for larger follow-up slices. This plan is small enough to execute inline with focused TDD.

**Goal:** Let Guildhall represent cross-project user preferences with a generic, dynamic schema that works beyond web development.

**Architecture:** Extend existing learning records instead of adding a new store. Suggested global preferences remain approval-gated, but user-preference candidates may carry a structured preference payload with an open subject taxonomy and array-based prefer/avoid positions.

**Tech Stack:** TypeScript runtime in `src/runtime/learning.ts` and `src/runtime/policy.ts`, Vitest coverage in `src/runtime/__tests__/learning.test.ts`, planning docs under `internal/`, public Next docs under `docs/`.

---

### Task 1: Structured Preference Payload

**Files:**
- Modify: `src/runtime/policy.ts`
- Modify: `src/runtime/learning.ts`
- Test: `src/runtime/__tests__/learning.test.ts`

- [x] Add a failing test that persists a game-development preference with multiple `prefer` and `avoid` items.
- [x] Add a failing test that records a structured user preference from a helper and keeps it suggested until approved.
- [x] Add optional structured preference types to `LearningCandidate` and `SuggestedLearning`.
- [x] Add a helper for building user-preference candidates with an open subject taxonomy.
- [x] Run focused Vitest coverage.

### Task 2: Spec and Docs

**Files:**
- Modify: `internal/specs/2026-05-22-guildhall-0-8-practices-deep-intake-worker-modes-and-personas.md`
- Modify: `docs/guide/memory-and-recovery.md`
- Modify: `docs/next/guide/memory-and-recovery.md`
- Modify: `docs/reference/agent-settings.md`
- Modify: `docs/next/reference/agent-settings.md`

- [x] Document Global Preference Review as a coordinator zoom-out move.
- [x] Define the generic preference envelope and dynamic subject taxonomy.
- [x] Clarify that `prefer` and `avoid` are arrays and can include strength, ordering, and exceptions.
- [x] Keep public docs product-facing and non-agentic.

### Task 3: Audit and Verification

**Files:**
- Modify: `internal/audits/flow-audit.md`

- [x] Add a completed checklist note for the structured global preference slice.
- [x] Run focused runtime tests.
- [x] Run public copy check if public docs changed.
