# Workspace Import Journey Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current transcript/question-driven workspace-import UX with a real staged import wizard that helps the user review sources, inspect candidate tasks, and confirm concrete imports without mixed-abstraction confusion.

**Architecture:** Keep workspace import as a dedicated product surface at `/workspace-import`, not a generic Thread question stack. Add structured import-state data to the existing draft endpoint, let the frontend own the staged journey, and make approval accept an explicit selected task set. Thread should summarize and hand off to the import wizard instead of rendering bogus import questions inline.

**Tech Stack:** Hono API in `src/runtime/serve.ts`, import synthesis in `src/runtime/workspace-importer.ts`, Svelte product UI in `src/web/surfaces/project/WorkspaceImportTab.svelte`, Thread projection in `src/runtime/thread.ts` and `src/web/surfaces/project/ThreadTab.svelte`, Vitest runtime/web tests.

---

### Task 1: Add structured source-grouping data to the workspace-import draft API

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall/src/runtime/workspace-importer.ts`
- Modify: `/Users/matthew/git/oss/guildhall/src/runtime/serve.ts`
- Test: `/Users/matthew/git/oss/guildhall/src/runtime/__tests__/serve-settings.test.ts`

- [ ] Add grouping helpers that derive source-level buckets from the deterministic draft
- [ ] Include source group summaries in `GET /api/project/workspace-import/draft`
- [ ] Include overlap markers for already-existing imported/done/shelved tasks where possible
- [ ] Add tests for source grouping and counts

### Task 2: Let approval accept explicit task selections

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall/src/runtime/workspace-importer.ts`
- Modify: `/Users/matthew/git/oss/guildhall/src/runtime/serve.ts`
- Test: `/Users/matthew/git/oss/guildhall/src/runtime/__tests__/serve-settings.test.ts`
- Test: `/Users/matthew/git/oss/guildhall/src/runtime/__tests__/workspace-importer.test.ts`

- [ ] Extend workspace-import approval to accept a selected subset of candidate task ids
- [ ] Keep goals and milestones handled separately from task inclusion
- [ ] Preserve idempotence and duplicate-avoidance behavior
- [ ] Add approval tests for filtered imports vs full imports

### Task 3: Rebuild `/workspace-import` into a staged wizard

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall/src/web/surfaces/project/WorkspaceImportTab.svelte`
- Modify: `/Users/matthew/git/oss/guildhall/src/web/lib/Button.svelte` (only if needed for clearer actions)
- Test: `/Users/matthew/git/oss/guildhall/src/web/lib/__tests__/project-summary.test.ts` (if shared state helpers shift)

- [ ] Replace the flat goals/tasks/milestones dump with staged wizard state:
  - sources found
  - source scope selection
  - per-source preview
  - candidate task review
  - final confirmation
- [ ] Make one primary action per step, with explicit labels
- [ ] Add expandable source evidence instead of front-loading long prose
- [ ] Make candidate review chunked and grouped by source

### Task 4: Stop Thread from surfacing broken import questions as primary workflow

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall/src/runtime/thread.ts`
- Modify: `/Users/matthew/git/oss/guildhall/src/web/surfaces/project/ThreadTab.svelte`
- Modify: `/Users/matthew/git/oss/guildhall/src/web/surfaces/DoThisNext.svelte`
- Test: `/Users/matthew/git/oss/guildhall/src/runtime/__tests__/thread.test.ts`

- [ ] Suppress generic `agent_question` rendering for the reserved workspace-import task
- [ ] Replace it with a clear handoff state: import review is waiting in `/workspace-import`
- [ ] Make blocking copy explain that import review is a separate guided step, not a generic question card
- [ ] Add thread tests so reserved import no longer shows bogus co-active question cards

### Task 5: Kill the bogus fallback-question behavior for workspace import

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall/src/runtime/orchestrator.ts`
- Modify: `/Users/matthew/git/oss/guildhall/src/runtime/workspace-importer.ts`
- Test: `/Users/matthew/git/oss/guildhall/src/runtime/__tests__/orchestrator.test.ts`

- [ ] Prevent fallback question synthesis from generating “pick one” existing-task summaries for the reserved import task
- [ ] Treat workspace import as a structured import workflow rather than an open-question intake task
- [ ] Add a regression test for the exact Looma/Knit failure mode

### Task 6: Live-test against Looma + Knit and tighten the wording/sequence

**Files:**
- Modify: `/Users/matthew/git/oss/guildhall/docs/web-ui/flow-audit.md`
- Modify: any touched UI/runtime files as needed from live findings

- [ ] Run the rebuilt flow against `http://127.0.0.1:7777/project`
- [ ] Verify the user can:
  - understand what was found
  - review one source at a time
  - inspect candidate tasks
  - confirm a scoped import without ambiguity
- [ ] Record the real findings in the audit log
- [ ] Fix any wording or sequencing problems discovered in live use before calling the slice done
