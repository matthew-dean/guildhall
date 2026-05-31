# Re-intake Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe Project Settings -> Memory re-intake flow that proposes and applies a reviewed project task-graph cleanup.

**Architecture:** Add a pure `project-reintake` runtime planner that builds reviewable change groups from source evidence plus current task state. Add draft persistence/apply helpers, expose them through `/api/project/reintake/*`, then add a compact Settings -> Memory entry point and `/settings/reintake` review surface.

**Tech Stack:** TypeScript runtime modules, Vitest, Svelte 5 settings UI, existing `TASKS.json`/project-state helpers.

---

### Task 1: Pure Re-intake Planner

**Files:**
- Create: `src/runtime/project-reintake.ts`
- Test: `src/runtime/__tests__/project-reintake.test.ts`

- [ ] Write tests for reframe, preserve-done, archive-stale, merge-duplicates, create-integration, and single-edit-no-split.
- [ ] Implement planner types and deterministic planner helpers.
- [ ] Verify with `pnpm vitest run src/runtime/__tests__/project-reintake.test.ts --reporter=dot`.

### Task 2: Draft Persistence And Apply

**Files:**
- Modify: `src/runtime/project-reintake.ts`
- Test: `src/runtime/__tests__/project-reintake-apply.test.ts`

- [ ] Write apply tests for id preservation, archive without deletion, created-task proof fields, selected groups, and stale queue fingerprint rejection.
- [ ] Implement draft file read/write and apply helpers.
- [ ] Verify with `pnpm vitest run src/runtime/__tests__/project-reintake.test.ts src/runtime/__tests__/project-reintake-apply.test.ts --reporter=dot`.

### Task 3: API Wiring

**Files:**
- Modify: `src/runtime/serve.ts`
- Test: `src/runtime/__tests__/serve-settings.test.ts`

- [ ] Write API tests for status, rerun, draft, apply, dismiss, and uninitialized errors.
- [ ] Add `/api/project/reintake/*` endpoints.
- [ ] Verify with `pnpm vitest run src/runtime/__tests__/serve-settings.test.ts --reporter=dot --test-timeout 10000`.

### Task 4: Settings UI

**Files:**
- Modify: `src/web/surfaces/project/SettingsTab.svelte`
- Test: `src/web/surfaces/project/__tests__/SettingsTab.svelte.test.ts`

- [ ] Write UI tests for Settings -> Memory entry point, start action, draft counts, review route, apply selected, and no visible `reset` copy in the re-intake surface.
- [ ] Add the compact Memory panel and review surface.
- [ ] Verify with `pnpm vitest run src/web/surfaces/project/__tests__/SettingsTab.svelte.test.ts --reporter=dot --test-timeout 10000`.

### Task 5: Final Verification

- [ ] Run focused runtime/UI tests.
- [ ] Run `pnpm typecheck`.
- [ ] Update `internal/audits/flow-audit.md`.
