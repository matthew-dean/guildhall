# Project Memory Check-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an intake check-in that summarizes what Guildhall currently knows, invites the owner to add changed context, and avoids treating that snapshot as permanent project truth.

**Architecture:** `src/runtime/thread.ts` attaches a small `contextSummary` object to the `direction` and `workspaceImport` setup turns. `src/web/surfaces/project/ThreadTab.svelte` renders that object as snapshot evidence, while the textarea / project brief remains the durable `memory/project-brief.md` owner direction. Tests cover both the runtime payload and rendered card.

**Tech Stack:** TypeScript runtime projection, Svelte Thread UI, Vitest happy-dom tests.

---

### Task 1: Runtime Thread Payload

**Files:**
- Modify: `src/runtime/thread.ts`
- Test: `src/runtime/__tests__/thread.test.ts`

- [x] Add `contextSummary?: { intro: string; facts: string[]; uncertainty: string }` to `SetupStepTurn`.
- [x] Build the field for `direction` and `workspaceImport` from project name, current direction guess, coordinator names, bootstrap state, and task counts.
- [x] Test that direction and existing-work setup turns include snapshot wording and do not claim facts are permanent.

### Task 2: Thread UI Rendering

**Files:**
- Modify: `src/web/surfaces/project/ThreadTab.svelte`
- Test: `src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts`

- [x] Add the matching optional type to the web `SetupStepTurn`.
- [x] Render the summary as a compact “What Guildhall knows right now” section.
- [x] Test that the section renders and the textarea still saves durable project direction.

### Task 3: Verification

**Files:**
- Modify: `docs/web-ui/flow-audit.md`

- [x] Run focused runtime and Thread tests.
- [x] Run `pnpm typecheck`.
- [x] Verify Font Something in the installed local app shows the check-in.
- [x] Record the behavior in the flow audit.
