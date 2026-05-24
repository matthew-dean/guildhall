# Git Story Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Guildhall show and enforce the git state behind finished work so tasks cannot silently end with dirty files, unpushed commits, missing upstreams, stale worktrees, or unresolved PR state, while respecting each project's desired automation level.

**Architecture:** Add a Git Story domain beside the existing `GitDriver` and `mergeRecord` path. The snapshot inspector derives live closure state from `git status --porcelain=v1 -b`, branch/upstream data, task worktree metadata, and existing `mergeRecord`; each project copies the system Git Story config into a project Git Story Policy, and that policy decides whether closure writes are suggested, confirm-before-write, or automatic.

**Tech Stack:** TypeScript, Zod, existing `GitDriver` / `NodeGitDriver`, Hono runtime routes, Svelte 5, Vitest, optional `gh` CLI inspection.

**Implementation status (2026-05-24):** MVP implemented. The runtime model,
read-only inspection, project/task summaries, Release blockers, Projects Home,
Thread, Provenance, and policy-gated closure endpoints are in place. The
project policy endpoint returns a copied-from-system view without rewriting
project config while `.gitignore` cleanup is happening in a separate lane.
Completed task work auto-commits when the resolved project policy says
`commit: auto`; `ask` and `never` still avoid automatic git writes. Automatic
push/open-PR orchestration remains behind explicit policy-aware callers for the
0.8.0 MVP.

---

## File Structure

- Create `src/runtime/git-story.ts`: Zod schemas, closure-state rules, snapshot summarization, and pure helpers.
- Create `src/runtime/__tests__/git-story.test.ts`: pure state-classification tests and in-memory inspection tests.
- Modify `src/runtime/git-driver.ts`: add read-only git inspection methods to `GitDriver`, `NodeGitDriver`, and `InMemoryGitDriver`.
- Modify `src/core/task.ts`: add optional `gitStory` durable override fields for `local_only` and `deferred`.
- Modify `src/levers/schema.ts` and `src/levers/defaults.ts`: add system Git Story config plus project Git Story Policy settings copied from system config during project setup/discovery.
- Modify `src/runtime/serve.ts`: expose project git story summary and add release-readiness blockers.
- Modify `src/web/lib/types.ts`: add API types for `GitStorySummary` and task-level `gitStory`.
- Modify `src/web/surfaces/ProjectsHome.svelte`: show compact git health chip when a project is not clean.
- Modify `src/web/surfaces/project/ThreadTab.svelte`: show task Git Story cards for unresolved closure states.
- Modify `src/web/surfaces/drawer/ProvenanceTab.svelte`: render detailed git story fields next to `mergeRecord`.
- Modify `src/web/surfaces/project/ReleaseTab.svelte`: render git story blockers.
- Add or update tests in `src/runtime/__tests__/serve-providers.test.ts`, `src/runtime/__tests__/serve-task-endpoints.test.ts`, `src/web/surfaces/__tests__/ProjectsHome.svelte.test.ts`, `src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts`, and `src/web/surfaces/project/__tests__/ReleaseTab.svelte.test.ts` as needed.

## Data Contracts

Use these names consistently:

```ts
export const GitStoryClosureState = z.enum([
  'clean',
  'dirty_uncommitted',
  'committed_local',
  'no_upstream',
  'pushed',
  'pr_open',
  'merged',
  'local_only',
  'deferred',
  'conflict',
  'unknown',
])

export const GitStorySnapshot = z.object({
  state: GitStoryClosureState,
  repoRoot: z.string(),
  inspectedPath: z.string(),
  branch: z.string().optional(),
  upstream: z.string().optional(),
  ahead: z.number().int().nonnegative().default(0),
  behind: z.number().int().nonnegative().default(0),
  changedCount: z.number().int().nonnegative().default(0),
  untrackedCount: z.number().int().nonnegative().default(0),
  samplePaths: z.array(z.string()).default([]),
  localCommits: z.array(z.object({
    sha: z.string(),
    subject: z.string(),
  })).default([]),
  pr: z.object({
    url: z.string(),
    state: z.string().optional(),
    mergeStateStatus: z.string().optional(),
  }).optional(),
  taskId: z.string().optional(),
  worktreePath: z.string().optional(),
  mergeRecordResult: z.string().optional(),
  reason: z.string(),
  inspectedAt: z.string(),
})
```

Add a system config contract and a project policy contract near the existing
landing strategy levers. Project policy starts as a copy of system config; repo
discovery can add evidence and suggestions, but should not silently override
the copied user preference.

```ts
export const GitStoryAutomationLevel = z.enum([
  'ask',
  'auto',
  'never',
])

export const GitStoryCompletionTarget = z.enum([
  'leave_dirty',
  'commit_local',
  'push_branch',
  'open_pr',
  'merge_landing_branch',
])

export const GitStoryPolicy = z.object({
  completionTarget: GitStoryCompletionTarget.default('open_pr'),
  commit: GitStoryAutomationLevel.default('ask'),
  push: GitStoryAutomationLevel.default('ask'),
  pullRequest: GitStoryAutomationLevel.default('ask'),
  merge: GitStoryAutomationLevel.default('ask'),
  localOnlyAllowed: z.boolean().default(true),
  deferAllowed: z.boolean().default(true),
  requireCleanRelease: z.boolean().default(true),
  allowForcePush: z.boolean().default(false),
  allowSharedBranchRebase: z.boolean().default(false),
  copiedFromSystemAt: z.string().optional(),
  discoveredFrom: z.array(z.string()).default([]),
})
```

`ask` is the shipped system default for writes. `auto` is valid when the user
chooses it globally or for a project. `never` means Guildhall should show the
state but not offer that write action for the project.

For task overrides, keep the durable state intentionally small:

```ts
gitStory: z.object({
  override: z.enum(['local_only', 'deferred']).optional(),
  reason: z.string().optional(),
  recordedAt: z.string().optional(),
  recordedBy: z.string().optional(),
}).optional()
```

Do not overload `mergeRecord`. `mergeRecord` is the terminal landing attempt;
Git Story is live state plus explicit user override when work is intentionally
not landing.

---

### Task 1: Pure Git Story State Model

**Files:**
- Create: `src/runtime/git-story.ts`
- Create: `src/runtime/__tests__/git-story.test.ts`
- Modify: `src/runtime/index.ts`

- [ ] **Step 1: Write failing state-classification tests**

```ts
import { describe, expect, it } from 'vitest'
import { classifyGitStoryState } from '../git-story.js'

describe('classifyGitStoryState', () => {
  it('reports dirty work before unpublished commits', () => {
    expect(classifyGitStoryState({
      changedCount: 2,
      untrackedCount: 1,
      ahead: 3,
      hasUpstream: true,
    })).toBe('dirty_uncommitted')
  })

  it('reports no upstream when the branch has no upstream and no dirty work', () => {
    expect(classifyGitStoryState({
      changedCount: 0,
      untrackedCount: 0,
      ahead: 0,
      hasUpstream: false,
    })).toBe('no_upstream')
  })

  it('reports local commits ahead of upstream', () => {
    expect(classifyGitStoryState({
      changedCount: 0,
      untrackedCount: 0,
      ahead: 2,
      hasUpstream: true,
    })).toBe('committed_local')
  })

  it('reports open PR before pushed', () => {
    expect(classifyGitStoryState({
      changedCount: 0,
      untrackedCount: 0,
      ahead: 0,
      hasUpstream: true,
      prState: 'OPEN',
    })).toBe('pr_open')
  })

  it('lets explicit local-only and deferred overrides win', () => {
    expect(classifyGitStoryState({
      changedCount: 4,
      untrackedCount: 0,
      ahead: 0,
      hasUpstream: true,
      override: 'local_only',
    })).toBe('local_only')
    expect(classifyGitStoryState({
      changedCount: 0,
      untrackedCount: 0,
      ahead: 2,
      hasUpstream: true,
      override: 'deferred',
    })).toBe('deferred')
  })

  it('reports merged when mergeRecord proves landing', () => {
    expect(classifyGitStoryState({
      changedCount: 0,
      untrackedCount: 0,
      ahead: 0,
      hasUpstream: true,
      mergeRecordResult: 'merged',
    })).toBe('merged')
  })
})
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm vitest run src/runtime/__tests__/git-story.test.ts`

Expected: FAIL because `src/runtime/git-story.ts` does not exist.

- [ ] **Step 3: Add the minimal pure model**

Implement `classifyGitStoryState()` and export the Zod schemas from the Data
Contracts section. Use this priority order:

1. `override === 'local_only'`
2. `override === 'deferred'`
3. `mergeRecordResult === 'conflict'`
4. `mergeRecordResult === 'merged' || mergeRecordResult === 'pushed'`
5. dirty or untracked files
6. no upstream
7. ahead commits
8. open PR
9. pushed upstream
10. clean

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run src/runtime/__tests__/git-story.test.ts`

Expected: PASS.

- [ ] **Step 5: Export from runtime index**

Add an export to `src/runtime/index.ts`:

```ts
export * from './git-story.js'
```

- [ ] **Step 6: Commit**

```bash
git add src/runtime/git-story.ts src/runtime/__tests__/git-story.test.ts src/runtime/index.ts
git commit -m "feat: add git story state model"
```

---

### Task 2: Read-Only Git Inspection

**Files:**
- Modify: `src/runtime/git-driver.ts`
- Test: `src/runtime/__tests__/git-story.test.ts`

- [ ] **Step 1: Add failing inspector tests with `InMemoryGitDriver`**

Add tests that configure an in-memory status response for:

- dirty checkout with sample paths;
- branch with no upstream;
- branch ahead of upstream with two local commits;
- clean branch with an open PR record.

Each test should assert `inspectGitStory()` returns the expected
`GitStorySnapshot.state`, `branch`, `upstream`, counts, sample paths, and local
commits.

- [ ] **Step 2: Extend `GitDriver` with read-only methods**

Add methods:

```ts
statusSummary(repoRoot: string): Promise<GitStatusSummary>
localCommits(repoRoot: string, upstream: string): Promise<Array<{ sha: string; subject: string }>>
pullRequestForBranch(repoRoot: string, branch: string): Promise<PullRequestResult>
```

Define `GitStatusSummary` in `git-driver.ts` with:

```ts
export interface GitStatusSummary {
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  changedCount: number
  untrackedCount: number
  samplePaths: string[]
  clean: boolean
}
```

- [ ] **Step 3: Implement `NodeGitDriver.statusSummary()`**

Use:

```bash
git status --porcelain=v1 -b
```

Parse the first `##` line for branch/upstream/ahead/behind. Count lines whose
status starts with `??` as untracked; count all other non-header status lines
as changed. Keep the first ten paths as `samplePaths`.

- [ ] **Step 4: Implement local commits and PR lookup**

For local commits, run:

```bash
git log --format=%H%x09%s <upstream>..HEAD
```

For PR lookup, use `gh pr view --json url,state,mergeStateStatus` and return
`ok:false` when `gh` is unavailable or the branch has no PR. The absence of a
PR is not an error state.

- [ ] **Step 5: Update `InMemoryGitDriver`**

Add deterministic setters or public state maps for status summaries, local
commits, and PR results. Keep the default as clean on `main` so existing tests
do not need setup.

- [ ] **Step 6: Implement `inspectGitStory()`**

`inspectGitStory(driver, input)` should:

- call `statusSummary()` on `input.inspectedPath`;
- call `localCommits()` only when `upstream` exists;
- call `pullRequestForBranch()` only when `branch` exists and `gh` lookup is
  enabled;
- fold task metadata and overrides into `GitStorySnapshot`;
- return `unknown` with a useful `reason` if git inspection throws.

- [ ] **Step 7: Run focused tests**

Run: `pnpm vitest run src/runtime/__tests__/git-story.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/runtime/git-driver.ts src/runtime/git-story.ts src/runtime/__tests__/git-story.test.ts
git commit -m "feat: inspect git story snapshots"
```

---

### Task 3: Persist Local-Only And Deferred Overrides

**Files:**
- Modify: `src/core/task.ts`
- Modify: `src/runtime/serve.ts`
- Test: `src/runtime/__tests__/serve-task-endpoints.test.ts`

- [ ] **Step 1: Write failing endpoint tests**

Add tests for:

- `POST /api/project/tasks/:taskId/git-story/local-only` stores
  `{ override: 'local_only', reason, recordedAt, recordedBy }`;
- `POST /api/project/tasks/:taskId/git-story/defer` stores
  `{ override: 'deferred', reason, recordedAt, recordedBy }`;
- both endpoints reject empty reasons with HTTP 400.

- [ ] **Step 2: Add `gitStory` to `Task` schema**

Add:

```ts
gitStory: z.object({
  override: z.enum(['local_only', 'deferred']).optional(),
  reason: z.string().optional(),
  recordedAt: z.string().optional(),
  recordedBy: z.string().optional(),
}).optional(),
```

- [ ] **Step 3: Add endpoint handlers**

Use the existing task mutation pattern in `serve.ts`. The handlers should:

- read `reason` from JSON body;
- trim and require it;
- update only the matching task;
- set `recordedBy` to `user`;
- save `TASKS.json`;
- return the updated task.

- [ ] **Step 4: Run focused tests**

Run: `pnpm vitest run src/runtime/__tests__/serve-task-endpoints.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/task.ts src/runtime/serve.ts src/runtime/__tests__/serve-task-endpoints.test.ts
git commit -m "feat: record git story closure overrides"
```

---

### Task 4: Project Git Story Summary API

**Files:**
- Modify: `src/runtime/serve.ts`
- Modify: `src/web/lib/types.ts`
- Test: `src/runtime/__tests__/serve-task-endpoints.test.ts`

- [ ] **Step 1: Write failing API tests**

Test `GET /api/project/git-story` with:

- clean base checkout and no task worktrees;
- dirty base checkout;
- done task with `mergeRecord.result = skipped`;
- task worktree with dirty snapshot;
- task marked local-only.

Assert the response includes:

```ts
{
  ready: boolean,
  state: GitStoryClosureState,
  blockers: Array<{
    id: string
    label: string
    state: GitStoryClosureState
    nextAction: string
  }>,
  snapshots: GitStorySnapshot[]
}
```

- [ ] **Step 2: Implement the route**

Add `GET /api/project/git-story` near release-readiness routes. It should:

- inspect `project.path`;
- load `TASKS.json`;
- inspect each task `worktreePath` that exists;
- create synthetic blockers for `mergeRecord.result === 'skipped'` even if the
  current checkout is clean;
- aggregate `ready = blockers.length === 0`;
- choose the worst state using deterministic severity:
  `conflict`, `unknown`, `dirty_uncommitted`, `committed_local`,
  `no_upstream`, `pr_open`, `deferred`, `local_only`, `pushed`, `merged`,
  `clean`.

- [ ] **Step 3: Add web types**

Add `GitStoryClosureState`, `GitStorySnapshot`, and `GitStorySummary` to
`src/web/lib/types.ts`.

- [ ] **Step 4: Run focused tests**

Run: `pnpm vitest run src/runtime/__tests__/serve-task-endpoints.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/serve.ts src/web/lib/types.ts src/runtime/__tests__/serve-task-endpoints.test.ts
git commit -m "feat: expose project git story summary"
```

---

### Task 5: Release Readiness Git Blockers

**Files:**
- Modify: `src/runtime/serve.ts`
- Modify: `src/web/surfaces/project/ReleaseTab.svelte`
- Test: `src/web/surfaces/project/__tests__/ReleaseTab.svelte.test.ts`

- [ ] **Step 1: Write failing readiness tests**

Add a test that renders release readiness with `gitStory.blockers` and expects:

- the Release tab is not ready;
- the blocker section title mentions Git Story;
- dirty/unpushed/no-upstream items show their next action.

- [ ] **Step 2: Add git story to `/api/project/release-readiness`**

Reuse the same summary helper from `/api/project/git-story`; do not duplicate
inspection logic. Add:

```ts
gitStory: {
  ready: boolean
  state: GitStoryClosureState
  blockers: GitStoryBlocker[]
}
```

Include `gitStory.blockers.length` in `blockingCount`.

- [ ] **Step 3: Render the Release section**

In `ReleaseTab.svelte`, render a section only when blockers exist. Keep copy
plain:

```text
Git story needs closure
```

Each row should show state, label, and next action.

- [ ] **Step 4: Run focused tests**

Run: `pnpm vitest run src/web/surfaces/project/__tests__/ReleaseTab.svelte.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/serve.ts src/web/surfaces/project/ReleaseTab.svelte src/web/surfaces/project/__tests__/ReleaseTab.svelte.test.ts
git commit -m "feat: block release readiness on git story"
```

---

### Task 6: Thread, Provenance, And Projects Home Surfaces

**Files:**
- Modify: `src/web/surfaces/ProjectsHome.svelte`
- Modify: `src/web/surfaces/project/ThreadTab.svelte`
- Modify: `src/web/surfaces/drawer/ProvenanceTab.svelte`
- Test: `src/web/surfaces/__tests__/ProjectsHome.svelte.test.ts`
- Test: `src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts`

- [ ] **Step 1: Write failing UI tests**

Projects home:

- given a project with `gitStory.state = 'dirty_uncommitted'`, renders a compact
  warning chip;
- clicking the chip opens the project Release or Thread view.

Thread:

- a done task with `gitStory.state = 'committed_local'` shows a Git Story card;
- a `local_only` task shows the recorded reason and does not use danger tone.

Provenance:

- snapshot details render next to terminal outcome when provided on the task.

- [ ] **Step 2: Add project summary fetch**

Extend the existing service/project payload with `gitStory?: GitStorySummary`.
Prefer reusing `/api/project/git-story` in the service assembler instead of
adding a second browser fetch for every card.

- [ ] **Step 3: Render Projects home chip**

Use the same visual language as the provider default chip: short label,
state-specific tone, no large explanatory block.

Labels:

- `dirty_uncommitted`: `Dirty`
- `committed_local`: `Unpushed`
- `no_upstream`: `No upstream`
- `pr_open`: `PR open`
- `conflict`: `Git conflict`
- `unknown`: `Git unknown`

- [ ] **Step 4: Render Thread card**

Only render when state is not `clean`, `merged`, or `pushed`. Show:

- state label;
- one-line reason;
- next action;
- actions for `Mark local-only` and `Defer` when appropriate.

- [ ] **Step 5: Render Provenance details**

Add a `Git story` card with branch, upstream, ahead/behind, changed count,
sample paths, PR URL, override reason, and inspected time.

- [ ] **Step 6: Run focused UI tests**

Run:

```bash
pnpm vitest run src/web/surfaces/__tests__/ProjectsHome.svelte.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/surfaces/ProjectsHome.svelte src/web/surfaces/project/ThreadTab.svelte src/web/surfaces/drawer/ProvenanceTab.svelte src/web/surfaces/__tests__/ProjectsHome.svelte.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts
git commit -m "feat: surface git story closure state"
```

---

### Task 7: Policy-Gated Commit, Push, And Open-PR Actions

**Files:**
- Modify: `src/runtime/serve.ts`
- Modify: `src/runtime/git-driver.ts`
- Modify: `src/web/surfaces/project/ThreadTab.svelte`
- Test: `src/runtime/__tests__/serve-task-endpoints.test.ts`
- Test: `src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts`

- [ ] **Step 1: Start with policy evaluation tests**

Verify `ask`, `auto`, and `never` policies for commit, push, and PR actions:

- `ask` shows a confirmation state before writing;
- `auto` lets the orchestrator/API perform the action after task completion;
- `never` shows the state but suppresses the write action;
- project policy values copied from system config win over shipped defaults;
- project-specific overrides win over copied system values.

The confirmation state for `ask` must include:

- target repo/worktree path;
- branch;
- selected files for commit;
- exact next command family;
- risk note for push/PR actions.

- [ ] **Step 2: Add commit endpoint**

Add `POST /api/project/tasks/:taskId/git-story/commit` with body:

```ts
{
  message: string
  files: string[]
  confirmed?: true
  automationSource?: 'user_confirmation' | 'project_policy'
}
```

Reject empty message, empty file list, and files outside the inspected
repo/worktree. Require either `confirmed: true` for `ask` policy or
`automationSource: 'project_policy'` for `auto` policy. Use `git add -- <files>`
and `git commit -m`.

- [ ] **Step 3: Add push endpoint**

Add `POST /api/project/tasks/:taskId/git-story/push` with body:

```ts
{
  confirmed?: true
  automationSource?: 'user_confirmation' | 'project_policy'
}
```

Require confirmation for `ask`, allow policy execution for `auto`, and reject
when policy is `never`. Use existing `GitDriver.push()`. If push fails with
fetch-first/non-fast-forward wording, return HTTP 409 with
`nextAction = "Fetch and merge the remote branch, rerun verification, then push again."`
Do not force-push.

- [ ] **Step 4: Add open-PR endpoint**

Add `POST /api/project/tasks/:taskId/git-story/open-pr` with body:

```ts
{
  title: string
  body?: string
  confirmed?: true
  automationSource?: 'user_confirmation' | 'project_policy'
}
```

Require confirmation for `ask`, allow policy execution for `auto`, and reject
when policy is `never`. Use existing `GitDriver.openPullRequest()`. Return
existing PR URL if `gh` reports one.

- [ ] **Step 5: Run focused endpoint and UI tests**

Run:

```bash
pnpm vitest run src/runtime/__tests__/serve-task-endpoints.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/serve.ts src/runtime/git-driver.ts src/web/surfaces/project/ThreadTab.svelte src/runtime/__tests__/serve-task-endpoints.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts
git commit -m "feat: add policy-gated git story actions"
```

---

### Task 8: Final Verification And Browser Smoke

**Files:**
- Modify: `internal/audits/flow-audit.md`
- Modify: `internal/plans/2026-05-24-guildhall-0-8-mvp-tracker.md`

- [ ] **Step 1: Run focused test suite**

Run:

```bash
pnpm vitest run src/runtime/__tests__/git-story.test.ts src/runtime/__tests__/serve-task-endpoints.test.ts src/web/surfaces/__tests__/ProjectsHome.svelte.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts src/web/surfaces/project/__tests__/ReleaseTab.svelte.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repo health checks**

Run:

```bash
pnpm typecheck
pnpm build
git diff --check
```

Expected: all pass. Existing third-party Svelte warnings are acceptable if they
match the current known `svelte-sonner` / `runed` warning shape.

- [ ] **Step 3: Browser smoke**

Start the local Guildhall server and verify:

- Projects home shows a non-clean git chip for a deliberately dirty fixture or
  test project.
- Thread shows a Git Story card for one done task with unresolved state.
- Provenance drawer shows snapshot details.
- Release readiness blocks on the unresolved git story.
- Marking a task local-only/deferred removes the accidental blocker but keeps a
  visible recorded reason.

- [ ] **Step 4: Update tracker and flow audit**

Mark the Git Story Closure checklist items complete in
`internal/plans/2026-05-24-guildhall-0-8-mvp-tracker.md` and summarize the
browser evidence in `internal/audits/flow-audit.md`.

- [ ] **Step 5: Commit**

```bash
git add internal/audits/flow-audit.md internal/plans/2026-05-24-guildhall-0-8-mvp-tracker.md
git commit -m "docs: record git story closure verification"
```
