# Guildhall Construction Runtime Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the construction manifesto affect Guildhall agent/runtime behavior through prompts, derived construction-mode metadata, tests, and docs.

**Architecture:** Start with a small, testable substrate: role prompts encode the construction responsibilities, a pure helper derives construction mode from task status/blocker shape, and docs link the manifesto to the implementation spec. Avoid a schema migration until UI needs are proven.

**Tech Stack:** TypeScript, Vitest, VitePress docs, existing Guildhall agent factories and task types.

---

## File Structure

- Modify `src/agents/spec-agent.ts`: add blueprint/proportional-question instructions.
- Modify `src/agents/coordinator-agent.ts`: add general-contractor/proportional-escalation instructions.
- Modify `src/agents/worker-agent.ts`: add trade-work/change-order instructions.
- Modify `src/agents/reviewer-agent.ts`: add inspection/change-order instructions.
- Modify `src/agents/__tests__/guildhall-agent.test.ts`: prompt invariant tests.
- Create `src/core/construction-mode.ts`: pure helper for derived construction modes.
- Modify `src/core/index.ts`: export the helper.
- Create `src/core/__tests__/construction-mode.test.ts`: status and blocker mapping tests.
- Modify `docs/design/project-construction-manifesto.md`: link to the implementation spec.
- Modify `docs/web-ui/flow-audit.md`: track implementation progress.

## Task 1: Protect Agent Prompt Behavior

**Files:**
- Modify: `src/agents/spec-agent.ts`
- Modify: `src/agents/coordinator-agent.ts`
- Modify: `src/agents/worker-agent.ts`
- Modify: `src/agents/reviewer-agent.ts`
- Modify: `src/agents/__tests__/guildhall-agent.test.ts`

- [x] **Step 1: Add failing prompt invariant tests**

Add tests in `src/agents/__tests__/guildhall-agent.test.ts` that assert:

```ts
expect(prompt).toContain('Construction mode: blueprint')
expect(prompt).toContain('Process serves the project and the product')
expect(prompt).toContain('Infer routine implementation choices from the repo')
expect(prompt).toContain('general contractor')
expect(prompt).toContain('Keep process proportional')
expect(prompt).toContain('trade work against an accepted')
expect(prompt).toContain('Treat that as a change-order request')
expect(prompt).toContain('you are an inspector')
expect(prompt).toContain('change-order-style decision')
```

- [x] **Step 2: Implement prompt changes**

Update the four agent prompts so:

- spec agent drafts proportional blueprints
- coordinator reviews specs as blueprints and rejects unnecessary owner burden
- worker performs trade work against the blueprint
- reviewer inspects against the blueprint and asks for change-order decisions

- [x] **Step 3: Run focused agent prompt tests**

Run:

```bash
pnpm vitest run src/agents/__tests__/guildhall-agent.test.ts --coverage=false
```

Expected: all tests pass.

## Task 2: Add Derived Construction Mode Helper

**Files:**
- Create: `src/core/construction-mode.ts`
- Modify: `src/core/index.ts`
- Create: `src/core/__tests__/construction-mode.test.ts`

- [x] **Step 1: Write tests for status mapping**

Create `src/core/__tests__/construction-mode.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { constructionModeForTask } from '../construction-mode.js'
import type { Task } from '../task.js'

function task(partial: Partial<Task>): Task {
  return {
    id: 't-1',
    title: 'Example',
    description: '',
    status: 'proposed',
    domain: 'default',
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    ...partial,
  } as Task
}

describe('constructionModeForTask', () => {
  it.each([
    ['proposed', 'survey'],
    ['exploring', 'blueprint'],
    ['spec_review', 'blueprint'],
    ['ready', 'frame'],
    ['in_progress', 'build'],
    ['review', 'inspect'],
    ['gate_check', 'inspect'],
    ['done', 'punch_list'],
    ['shelved', 'punch_list'],
  ] as const)('maps %s to %s', (status, mode) => {
    expect(constructionModeForTask(task({ status }))).toBe(mode)
  })

  it('maps blocked spec ambiguity to change_order', () => {
    expect(
      constructionModeForTask(
        task({
          status: 'blocked',
          blocker: 'Spec is wrong: API scope changed after implementation evidence.',
        }),
      ),
    ).toBe('change_order')
  })
})
```

- [x] **Step 2: Implement the helper**

Create `src/core/construction-mode.ts`:

```ts
import type { Task } from './task.js'

export type ConstructionMode =
  | 'survey'
  | 'blueprint'
  | 'frame'
  | 'build'
  | 'inspect'
  | 'change_order'
  | 'punch_list'

export function constructionModeForTask(task: Pick<Task, 'status'> & Partial<Pick<Task, 'blocker'>>): ConstructionMode {
  if (task.status === 'blocked') {
    const blocker = task.blocker ?? ''
    if (/\b(spec|scope|assumption|plan|blueprint|decision|change order)\b/i.test(blocker)) {
      return 'change_order'
    }
    return 'inspect'
  }

  switch (task.status) {
    case 'proposed':
      return 'survey'
    case 'exploring':
    case 'spec_review':
      return 'blueprint'
    case 'ready':
      return 'frame'
    case 'in_progress':
      return 'build'
    case 'review':
    case 'gate_check':
      return 'inspect'
    case 'done':
    case 'shelved':
      return 'punch_list'
    default:
      return 'survey'
  }
}
```

- [x] **Step 3: Export from core index**

Add to `src/core/index.ts`:

```ts
export * from './construction-mode.js'
```

- [x] **Step 4: Run focused core tests**

Run:

```bash
pnpm vitest run src/core/__tests__/construction-mode.test.ts --coverage=false
```

Expected: all tests pass.

## Task 3: Wire Construction Mode Into Thread Payloads

**Files:**
- Modify: `src/runtime/thread.ts`
- Modify: `src/web/lib/types.ts`
- Modify: `src/runtime/__tests__/thread.test.ts`

- [x] **Step 1: Locate task-to-thread payload mapping**

Run:

```bash
rg -n "constructionMode|thread|TaskCard|taskStatus|status:" src/runtime/serve.ts src/web/lib src/web/surfaces/project -S
```

Result: `buildThread` in `src/runtime/thread.ts` is the task-to-thread
projection used by `/api/project/thread` and drawer task turns.

- [x] **Step 2: Add `constructionMode` to task/thread item payloads**

Import and apply:

```ts
import { constructionModeForTask } from '@guildhall/core'
```

Add a field on task-like payloads:

```ts
constructionMode: constructionModeForTask(task)
```

Keep this additive. Do not rename existing `status` fields.

- [x] **Step 3: Add or update a test**

In the closest existing serve/thread test, assert an exploring task includes:

```ts
expect(item.constructionMode).toBe('blueprint')
```

and an in-progress task includes:

```ts
expect(item.constructionMode).toBe('build')
```

- [x] **Step 4: Run focused serve/thread tests**

Run the smallest matching test command discovered in Step 1:

```bash
pnpm vitest run src/runtime/__tests__/thread.test.ts --coverage=false
```

Expected: all tests pass.

## Task 4: Link Docs and Audit Trail

**Files:**
- Modify: `docs/design/project-construction-manifesto.md`
- Modify: `docs/web-ui/flow-audit.md`

- [x] **Step 1: Link manifesto to implementation spec**

Add one sentence near the integration plan:

```md
The implementation substrate is tracked in
`docs/superpowers/specs/2026-05-19-guildhall-construction-runtime-integration.md`
and its matching plan.
```

- [x] **Step 2: Update flow audit checklist**

Mark prompt-invariant work complete only after tests pass. Mark derived-mode
and Thread payload work complete only after their tests pass.

- [x] **Step 3: Run docs checks**

Run:

```bash
pnpm docs:build && pnpm docs:check-help-sync
```

Expected: docs build and help sync pass.

## Task 5: Final Verification

**Files:**
- No new files.

- [x] **Step 1: Run focused checks**

Run:

```bash
pnpm vitest run src/agents/__tests__/guildhall-agent.test.ts src/core/__tests__/construction-mode.test.ts src/runtime/__tests__/thread.test.ts --coverage=false
```

Expected: all tests pass.

- [x] **Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: pass.

- [x] **Step 3: Run docs checks**

Run:

```bash
pnpm docs:build && pnpm docs:check-help-sync
```

Expected: pass.

- [x] **Step 4: Commit**

Run:

```bash
git add src/agents/spec-agent.ts src/agents/coordinator-agent.ts src/agents/worker-agent.ts src/agents/reviewer-agent.ts src/agents/__tests__/guildhall-agent.test.ts src/core/construction-mode.ts src/core/index.ts src/core/__tests__/construction-mode.test.ts src/runtime/thread.ts src/runtime/__tests__/thread.test.ts src/web/lib/types.ts docs/design/project-construction-manifesto.md docs/superpowers/specs/2026-05-19-guildhall-construction-runtime-integration.md docs/superpowers/plans/2026-05-19-guildhall-construction-runtime-integration.md docs/web-ui/flow-audit.md
git commit -m "Build construction model into agent runtime"
```

Expected: commit succeeds.

## Self-Review

- Spec coverage: tasks cover prompt behavior, derived construction mode,
  additive runtime payload, docs links, and verification.
- Placeholder scan: no `TBD`, `TODO`, or "fill in later" steps.
- Type consistency: `ConstructionMode` values match the spec definitions.
