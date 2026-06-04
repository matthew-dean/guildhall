# Project Intake Context and Structure Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Jess-style project ingestion valuable by turning the accepted structure map into intuitive task-start context, while reducing Structure to a small correction and maintenance surface.

**Architecture:** Reuse the accepted structural map that already feeds agent context. Add one shared runtime summary builder that converts structural routing into user-facing task context, expose it on `/api/project`, render it near task-start decisions, and simplify Structure so it shows map health, corrections, contracts, and handoffs rather than repeating the same package list several ways.

**Tech Stack:** TypeScript runtime, Hono API, Svelte 5 runes UI, Vitest, existing Guildhall UI primitives.

---

## Component Strategy

- `src/runtime/structural-task-context.ts`
  - New shared runtime adapter from accepted structural map + task records to small user-facing context summaries.
  - Owns labels like likely work area, likely checks, why Guildhall chose this, and uncertainty.
  - Does not mutate map state.

- `src/runtime/serve.ts`
  - Adds `taskRoutingContexts` to `/api/project` using the new adapter.
  - Keeps graph/task-start meaning in shared API data instead of local UI inference.

- `src/web/lib/types.ts`
  - Adds permissive UI types for `TaskRoutingContext` and `ProjectDetail.taskRoutingContexts`.

- `src/web/surfaces/project/ThreadTab.svelte`
  - Renders a compact “Guildhall will start with…” context block near active task/question/start cards.
  - Provides a clear correction path: “Change this context” reuses the existing correction/reply composer instead of adding a new bespoke editor.

- `src/web/surfaces/project/structure/ProjectGraphPanel.svelte`
  - Simplifies Structure into:
    - a plain summary of what the map is used for,
    - a compact area list,
    - explicit correction/maintenance actions,
    - contracts and handoffs only when relevant.
  - Keeps “Link capability” behind a modal because cross-project assignment is an edge case.

- Tests:
  - Runtime tests for context summary from accepted structural maps.
  - Thread UI test for task-start context visibility and correction action.
  - Structure UI test that the page does not over-render contracts/assignable framing.

## Task 1: Runtime Task Context Summary

**Files:**
- Create: `src/runtime/structural-task-context.ts`
- Modify: `src/runtime/index.ts`
- Test: `src/runtime/__tests__/structural-task-context.test.ts`

- [ ] Add a failing test that creates an accepted structural map with one package, one domain, and one executable unit, then asserts `summarizeStructuralTaskContext` returns:
  - `status: "matched"`
  - a likely area label
  - a domain label
  - at least one check command
  - human-readable reasons.

- [ ] Implement `summarizeStructuralTaskContext(input)` by calling `buildStructuralContextSlice` and `routeTaskWithStructuralMap`, resolving node IDs back to labels and paths.

- [ ] Return `status: "unavailable"` when no accepted map exists and `status: "unmatched"` when no domain/package/check is inferred.

- [ ] Export the type and function from `src/runtime/index.ts`.

- [ ] Run:
  - `pnpm vitest run src/runtime/__tests__/structural-task-context.test.ts --reporter=dot`

## Task 2: API Wiring

**Files:**
- Modify: `src/runtime/serve.ts`
- Modify: `src/web/lib/types.ts`
- Test: `src/runtime/__tests__/serve-settings.test.ts` or focused existing project API test.

- [ ] Add `taskRoutingContexts` to `/api/project`.

- [ ] Build it once per project response from the same normalized tasks already returned by the endpoint.

- [ ] Keep the field optional and keyed by task id:

```ts
taskRoutingContexts: {
  [taskId: string]: TaskRoutingContext
}
```

- [ ] Add UI types matching the JSON shape.

- [ ] Run the focused API test.

## Task 3: Thread Task-Start Context

**Files:**
- Modify: `src/web/surfaces/project/ThreadTab.svelte`
- Test: `src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts`

- [ ] Add helper `routingContextForTask(taskId)`.

- [ ] Render a compact disclosure titled `Guildhall will start with` for active `agent_question`, `inflight`, and brief/task-start surfaces when context is matched.

- [ ] Include:
  - likely area,
  - related domain,
  - checks,
  - why this context was selected,
  - correction button wired to the existing reply/correction composer.

- [ ] Avoid chips for proposed/domain status. Use plain labels, small definition rows, and existing buttons.

- [ ] Run the focused Thread test.

## Task 4: Structure Page Simplification

**Files:**
- Modify: `src/web/surfaces/project/structure/ProjectGraphPanel.svelte`
- Test: `src/web/surfaces/project/structure/__tests__/ProjectStructurePanel.svelte.test.ts`

- [ ] Change the top copy from “what Guildhall understands” to “what Guildhall uses when starting work.”

- [ ] Replace the large two-column map with a compact area list:
  - area name,
  - path,
  - contracts count,
  - one action to correct/mark temporary once that runtime action exists.

- [ ] Move contract details behind a `details` disclosure or show only in a separate “Contracts that affect review” section.

- [ ] Keep “Link capability” as a small secondary action that opens the existing modal.

- [ ] Remove repeated “No contracts recorded” rows for every area.

- [ ] Run the focused Structure test.

## Task 5: Verification

**Files:**
- Modify: `internal/audits/flow-audit.md`

- [ ] Run:
  - `pnpm vitest run src/runtime/__tests__/structural-task-context.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts src/web/surfaces/project/structure/__tests__/ProjectStructurePanel.svelte.test.ts --reporter=dot`
  - `pnpm typecheck`
  - `pnpm build`
  - `git diff --check`

- [ ] Restart the local Guildhall service if needed:
  - `pnpm dev:install`
  - `guildhall stop`
  - `guildhall start`

- [ ] Browser-proof Jess:
  - `/projects/jess/thread?thread=setup` or an active task thread shows task-start context when a task has matched structure.
  - `/projects/jess/structure` reads as a maintenance surface, not a repeated ontology dump.

- [ ] Append evidence to `internal/audits/flow-audit.md`.
