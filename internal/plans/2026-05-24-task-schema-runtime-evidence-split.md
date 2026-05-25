# Task Schema Runtime And Evidence Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Guildhall task definitions from runtime state, workspace/git state, and evidence history so project-local `TASKS.json` stays portable and understandable.

**Architecture:** Keep project-local `.guildhall/TASKS.json` as the task-definition file. Move execution state, worktree/branch placement, review/gate/escalation history, notes, and remediation counters into system-local project history under `getProjectLocalHistoryDir(projectRoot)`. Add compatibility projection so old task files still render and run while writers move to the new stores.

**Tech Stack:** TypeScript, Zod schemas, existing `@guildhall/sessions` local-history helpers, Vitest, Svelte surfaces, Hono runtime endpoints.

---

## Source Evidence

- Audit: `internal/audits/2026-05-24-task-schema-boundary-audit.md`
- Existing system-local history root: `src/sessions/local-history.ts`
- Current overgrown schema: `src/core/task.ts`
- Current queue writers/readers: `src/runtime/intake.ts`, `src/runtime/workspace-importer.ts`, `src/runtime/orchestrator.ts`, `src/tools/task-queue.ts`
- Current evidence writers: `src/tools/escalation.ts`, `src/tools/report-issue.ts`, `src/tools/run-gates-tool.ts`, `src/runtime/orchestrator.ts`
- Current UI readers: `src/runtime/serve.ts`, `src/web/lib/types.ts`, `src/web/surfaces/TaskDrawer.svelte`, `src/web/surfaces/drawer/*.svelte`, `src/web/surfaces/project/*.svelte`

## Storage Model

### Project-local task definition

File: `<project>/.guildhall/TASKS.json`

This remains the durable, portable task list. It should contain:

- `id`
- `title`
- `description`
- `domain`
- `scopePath` or compatibility `projectPath`
- `request`
- `status`
- `priority`
- `spec`
- `acceptanceCriteria`
- `productBrief`
- `openQuestions`
- `outOfScope`
- `dependsOn`
- `origination`
- `proposedBy`
- `proposalRationale`
- `parentGoalId`
- `taskOverrides`
- `terminalSummary`
- `createdAt`
- `updatedAt`
- `completedAt`

It should not contain machine paths, worktree paths, branch placement, raw notes,
gate output, reviewer verdict arrays, adjudication arrays, resolved escalation
history, agent issue history, retry counters, or remediation counters.

### System-local runtime state

File: `getProjectLocalHistoryDir(projectRoot)/runtime/tasks.json`

Per-task runtime state:

```ts
interface TaskRuntimeState {
  taskId: string
  assignedTo?: string | null
  revisionCount?: number
  retryWindow?: {
    startedAt: string
    baseRevisionCount: number
  }
  remediationAttempts?: number
  handoffStep?: number
  openEscalationIds?: string[]
  openIssueIds?: string[]
  updatedAt: string
}
```

### System-local workspace/git state

File: `getProjectLocalHistoryDir(projectRoot)/runtime/task-workspaces.json`

Per-task workspace state:

```ts
interface TaskWorkspaceState {
  taskId: string
  worktreePath?: string
  branchName?: string
  baseBranch?: string
  mode?: 'none' | 'per_task' | 'per_attempt'
  createdAt?: string
  updatedAt: string
}
```

Git closure provenance should live in:

```text
getProjectLocalHistoryDir(projectRoot)/runtime/git-story.json
getProjectLocalHistoryDir(projectRoot)/tasks/<task-id>/git-story.jsonl
```

`taskOverrides.gitStory` may stay on the task definition when the user
explicitly marks a task `local_only` or `deferred`.

### System-local evidence history

Directory: `getProjectTaskLocalHistoryDir(projectRoot, taskId)`

Recommended files:

- `events.jsonl`: generic typed event ledger.
- `notes.jsonl`: agent notes and coordinator notes.
- `gate-results.jsonl`: gate outputs and command results.
- `review-verdicts.jsonl`: reviewer/persona verdict records.
- `adjudications.jsonl`: coordinator adjudication decisions.
- `escalations.jsonl`: escalation lifecycle records.
- `agent-issues.jsonl`: agent issue lifecycle records.
- `merge-records.jsonl`: merge, push, PR, and checkpoint provenance.

Existing files such as `checkpoint.json`, `review-packet.md`, transcripts,
context debug snapshots, `DECISIONS.md`, and progress heartbeats should remain
valid. This plan does not require collapsing those files.

## Effective Task Projection

Most application code should consume an effective task, not raw
`TaskDefinition`.

```ts
interface EffectiveTask extends TaskDefinition {
  runtime?: TaskRuntimeState
  workspace?: TaskWorkspaceState
  currentBlocker?: TaskBlockerSummary
  latestGateSummary?: GateSummary
  latestReviewSummary?: ReviewSummary
  latestGitStory?: GitStorySnapshot
  terminalSummary?: TaskTerminalSummary
}
```

Rules:

- Old task files with legacy fields must still project correctly.
- New writers must write to the new store first.
- UI payloads can keep the current shape during the transition, but their
  backing data must come from projection APIs rather than raw task arrays.
- Compatibility projection should be read-only for legacy fields. Do not keep
  re-persisting legacy fields after the new stores exist.

## Task 1: Add Schemas And Storage Helpers

**Files:**

- Create: `src/core/task-runtime.ts`
- Create: `src/runtime/task-state-store.ts`
- Modify: `src/core/index.ts`
- Test: `src/runtime/__tests__/task-state-store.test.ts`

- [ ] **Step 1: Write failing tests for runtime/evidence paths**

  Cover:

  - `runtime/tasks.json` is under `getProjectLocalHistoryDir(projectRoot)`.
  - task evidence files are under `getProjectTaskLocalHistoryDir(projectRoot, taskId)`.
  - helpers create parent directories.
  - `~` paths are expanded only at runtime edges, not stored back as task definition.

- [ ] **Step 2: Define Zod schemas**

  Add schemas for:

  - `TaskRuntimeState`
  - `TaskRuntimeStateStore`
  - `TaskWorkspaceState`
  - `TaskWorkspaceStateStore`
  - `TaskEvidenceEvent`
  - specific event payloads for notes, gates, review verdicts, adjudications, escalations, agent issues, merge records.

- [ ] **Step 3: Implement atomic read/write helpers**

  Add:

  - `runtimeStatePath(projectRoot)`
  - `taskWorkspaceStatePath(projectRoot)`
  - `readTaskRuntimeStore(projectRoot)`
  - `writeTaskRuntimeStore(projectRoot, store)`
  - `upsertTaskRuntimeState(projectRoot, taskId, patch)`
  - `readTaskWorkspaceStore(projectRoot)`
  - `upsertTaskWorkspaceState(projectRoot, taskId, patch)`
  - `appendTaskEvidence(projectRoot, taskId, kind, payload)`
  - `readTaskEvidence(projectRoot, taskId, opts)`

- [ ] **Step 4: Verify**

  Run:

  ```bash
  pnpm test src/runtime/__tests__/task-state-store.test.ts
  ```

## Task 2: Split Task Definition Schema From Legacy Task Shape

**Files:**

- Modify: `src/core/task.ts`
- Create: `src/core/task-definition.ts` if `task.ts` becomes too large
- Test: `src/core/__tests__/task.test.ts`

- [ ] **Step 1: Add `TaskDefinition` schema**

  `TaskDefinition` should accept the task-owned fields listed above. It should
  include a compatibility alias for `projectPath`, but the normalized output
  should prefer `scopePath`.

- [ ] **Step 2: Keep `Task` as compatibility type temporarily**

  For 0.8.0, do not break every caller at once. Keep legacy `Task` parsing able
  to read old queues, but add comments and tests that new code should prefer:

  - `TaskDefinition`
  - `EffectiveTask`
  - task runtime/evidence store helpers

- [ ] **Step 3: Add normalization helpers**

  Add:

  - `normalizeTaskDefinition(raw)`
  - `legacyRuntimeFromTask(rawTask)`
  - `legacyWorkspaceFromTask(rawTask)`
  - `legacyEvidenceFromTask(rawTask)`
  - `stripLegacyRuntimeFields(task)`

- [ ] **Step 4: Verify legacy fixtures still parse**

  Use fixtures covering:

  - relative `projectPath`
  - absolute `projectPath`
  - home-relative `worktreePath`
  - legacy verdict/escalation/note arrays
  - null `assignedTo`

## Task 3: Add Compatibility Projection

**Files:**

- Create: `src/runtime/effective-task.ts`
- Modify: `src/runtime/context-builder.ts`
- Modify: `src/runtime/thread.ts`
- Modify: `src/runtime/inbox.ts`
- Modify: `src/runtime/serve.ts`
- Test: `src/runtime/__tests__/effective-task.test.ts`

- [ ] **Step 1: Write projection tests**

  Tests should prove:

  - A clean new task definition projects with no legacy fields.
  - An old FLL-style task with `reviewVerdicts`, `adjudications`,
    `escalations`, `worktreePath`, `branchName`, `baseBranch`, `retryWindow`,
    and `notes` projects the same UI summaries as before.
  - When both new store data and legacy fields exist, new store data wins.

- [ ] **Step 2: Implement `buildEffectiveTask`**

  Inputs:

  - project root
  - raw task definition or legacy task
  - runtime state store
  - workspace state store
  - evidence summaries
  - optional git story snapshot

- [ ] **Step 3: Replace UI/API projection reads first**

  Start with read-only consumers:

  - project detail payload
  - Thread cards
  - Inbox/Needs You
  - Release readiness
  - Task Drawer payload

- [ ] **Step 4: Keep old API response shape stable**

  During 0.8.0, the web UI can still receive fields named `reviewVerdicts`,
  `gateResults`, `mergeRecord`, or `gitStory` if needed. The important change
  is that these fields are populated by projection, not by asking callers to
  read raw project-local task state.

## Task 4: Migrate Writers Off Legacy Fields

**Files:**

- Modify: `src/tools/task-queue.ts`
- Modify: `src/tools/escalation.ts`
- Modify: `src/tools/report-issue.ts`
- Modify: `src/tools/run-gates-tool.ts`
- Modify: `src/tools/checkpoint.ts`
- Modify: `src/runtime/orchestrator.ts`
- Modify: `src/runtime/reviewer-fanout.ts` only if needed for call shape
- Test: focused tool and orchestrator tests

- [ ] **Step 1: Notes**

  Change note writes from `task.notes.push(...)` to
  `appendTaskEvidence(projectRoot, taskId, 'note', payload)`.

  Compatibility:

  - Do not delete legacy note reads yet.
  - New note writes should not mutate `TASKS.json`.

- [ ] **Step 2: Gate results**

  Change `run-gates` and guild gate writes from `task.gateResults` to
  `gate-results.jsonl`.

  Projection should keep latest hard-gate status available to Release and
  Task Drawer.

- [ ] **Step 3: Review verdicts and adjudications**

  Change reviewer fan-out to append:

  - `review-verdicts.jsonl`
  - `adjudications.jsonl`

  Update repeated-dissent detection to read prior verdict rounds from evidence.

- [ ] **Step 4: Escalations and agent issues**

  Change escalation/issue tools to:

  - append lifecycle events to evidence
  - update current runtime state with open escalation/issue ids
  - update task `status` and `blockReason` only for the user-facing current state

  Resolved escalation and issue history must not stay in project-local task
  definitions.

- [ ] **Step 5: Runtime counters**

  Move these from task writes to `runtime/tasks.json`:

  - `assignedTo`
  - `revisionCount`
  - `retryWindow`
  - `remediationAttempts`
  - `handoffStep`

  Update all helpers such as `currentRevisionCycleCount` to accept effective
  runtime state.

- [ ] **Step 6: Workspace/git state**

  Move these from task writes to `runtime/task-workspaces.json`:

  - `worktreePath`
  - `branchName`
  - `baseBranch`

  Update:

  - `ensureWorktreeForDispatch` callers
  - worktree cleanup/reuse
  - changed-file summaries
  - `git-story.ts`
  - `git-story-policy.ts`
  - Release readiness

- [ ] **Step 7: Merge/git provenance**

  Change `mergeRecord` writes to task evidence and/or `runtime/git-story.json`.
  Keep `terminalSummary` on the task if it helps the task list render without
  reading full evidence.

## Task 5: Add Migration And Cleanup

**Files:**

- Create: `src/runtime/task-state-migration.ts`
- Modify: `src/runtime/memory-migration.ts`
- Modify: `src/runtime/cli.ts`
- Modify: `src/runtime/serve.ts`
- Test: `src/runtime/__tests__/task-state-migration.test.ts`

- [ ] **Step 1: Write migration tests from live-shaped fixtures**

  Fixtures should include:

  - FLL auth-complete style task with 60 verdicts and 5 adjudications.
  - FLL db-bootstrap style done task with resolved escalations.
  - Looma + Knit style queue with many notes.
  - Narrative Harness style home-relative worktree paths.
  - Mixed relative and absolute `projectPath` values.

- [ ] **Step 2: Implement dry-run migration summary**

  The migration should report:

  - number of tasks inspected
  - fields extracted
  - evidence records written
  - runtime records written
  - workspace records written
  - task definitions that would be rewritten
  - compatibility warnings

- [ ] **Step 3: Implement idempotent extraction**

  Requirements:

  - Do not duplicate evidence records when migration runs twice.
  - Preserve original task ids and timestamps.
  - Store a migration marker in system-local history, not in project source.
  - Back up the original project-local `TASKS.json` under system-local history
    before rewriting it.

- [ ] **Step 4: Rewrite project-local `TASKS.json` only after extraction passes**

  The rewritten file should strip:

  - `assignedTo`
  - `notes`
  - `gateResults`
  - `reviewVerdicts`
  - `adjudications`
  - resolved `escalations`
  - resolved `agentIssues`
  - `revisionCount`
  - `retryWindow`
  - `remediationAttempts`
  - `handoffStep`
  - `worktreePath`
  - `branchName`
  - `baseBranch`
  - `mergeRecord`

  Keep:

  - current unresolved blocker projection if needed
  - user-authored task fields
  - explicit task overrides

- [ ] **Step 5: Add CLI and service hooks**

  CLI:

  ```bash
  guildhall migrate task-state --project /path/to/project --dry-run
  guildhall migrate task-state --project /path/to/project --apply
  ```

  Service:

  - On project read, run compatibility projection.
  - Surface a non-scary maintenance notice if task-state migration is available.
  - Do not block normal reads on migration.

## Task 6: Update APIs And MCP

**Files:**

- Modify: `src/runtime/serve.ts`
- Modify: `src/mcp-server/project-reader.ts`
- Modify: `src/mcp-server/evidence.ts`
- Modify: `src/mcp-server/server.ts`
- Test: `src/runtime/__tests__/serve-task-endpoints.test.ts`
- Test: `src/mcp-server/__tests__/server.test.ts`

- [ ] **Step 1: Add evidence endpoints**

  Add project-scoped endpoints:

  - `GET /api/project/task/:id/evidence`
  - `GET /api/project/task/:id/history`
  - `GET /api/project/task/:id/review`
  - `GET /api/project/task/:id/git-story`

- [ ] **Step 2: Update task action endpoints**

  Ensure task actions update the proper layer:

  - status changes update task definition and runtime projection as needed
  - resume/mark-done resolves current runtime blockers and appends evidence
  - git actions update workspace/git state and git evidence

- [ ] **Step 3: Update MCP evidence append**

  `guildhall.append_task_evidence` should write to task evidence files, not only
  `PROGRESS.md`. Keep `PROGRESS.md` as a human-readable mirror if useful.

## Task 7: Update Web UI

**Files:**

- Modify: `src/web/lib/types.ts`
- Modify: `src/web/lib/project-data.ts`
- Modify: `src/web/lib/project-summary.ts`
- Modify: `src/web/lib/project-activity.ts`
- Modify: `src/web/surfaces/TaskDrawer.svelte`
- Modify: `src/web/surfaces/drawer/HistoryTab.svelte`
- Modify: `src/web/surfaces/drawer/ExpertsTab.svelte`
- Modify: `src/web/surfaces/drawer/ProvenanceTab.svelte`
- Modify: `src/web/surfaces/drawer/CurrentTab.svelte`
- Modify: `src/web/surfaces/project/ThreadTab.svelte`
- Modify: `src/web/surfaces/project/ReleaseTab.svelte`
- Modify: `src/web/surfaces/project/ProjectOverviewTab.svelte`
- Test: focused Svelte tests for each touched surface

- [ ] **Step 1: Stop treating raw task fields as history**

  Drawer tabs should fetch or receive projected evidence summaries. They should
  not assume `task.notes`, `task.reviewVerdicts`, `task.adjudications`, or
  `task.gateResults` are arrays on the task definition.

- [ ] **Step 2: Show storage/source distinctions where useful**

  UI should communicate:

  - current blocker
  - recent evidence
  - git story state
  - release closure

  It should not show implementation terms like "runtime store" or "evidence
  ledger" in normal user copy.

- [ ] **Step 3: Keep Overview and Release alive**

  Overview and Release must still show:

  - blocked/dependency status
  - next run preview
  - git story blockers
  - project health
  - recent meaningful events

  These should come from effective project/task summaries.

- [ ] **Step 4: Mobile/browser verification**

  Browser-smoke FLL and one busier project after implementation:

  - Task Drawer History loads evidence.
  - Experts tab loads review verdicts.
  - Provenance shows git story without requiring task-local worktree fields.
  - Overview and Release show no raw missing-field errors.
  - Mobile has no horizontal overflow.

## Task 8: Tests, Release Gate, And Rollout

**Files:**

- Modify: `internal/plans/2026-05-24-guildhall-0-8-mvp-tracker.md`
- Modify: `internal/audits/flow-audit.md`
- Test: focused suites listed below

- [ ] **Step 1: Add release blocker to 0.8 tracker**

  Add "Task State Boundary" as a 0.8.0 MVP release blocker because it affects
  trust, portability, git story closure, and evidence storage.

- [ ] **Step 2: Run focused suites**

  Run:

  ```bash
  pnpm test src/core/__tests__/task.test.ts
  pnpm test src/runtime/__tests__/task-state-store.test.ts src/runtime/__tests__/task-state-migration.test.ts src/runtime/__tests__/effective-task.test.ts
  pnpm test src/tools/__tests__/task-queue.test.ts src/tools/__tests__/escalation.test.ts src/tools/__tests__/report-issue.test.ts
  pnpm test src/runtime/__tests__/orchestrator.test.ts src/runtime/__tests__/git-story.test.ts src/runtime/__tests__/serve-task-endpoints.test.ts src/runtime/__tests__/serve-release-readiness.test.ts
  pnpm test src/web/surfaces/__tests__/TaskDrawer.svelte.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts src/web/surfaces/project/__tests__/ReleaseTab.svelte.test.ts src/web/surfaces/__tests__/ProjectView.svelte.test.ts
  ```

- [ ] **Step 3: Run broad verification**

  Run:

  ```bash
  pnpm typecheck
  pnpm build
  git diff --check
  ```

- [ ] **Step 4: Dev-install and browser-smoke**

  Run:

  ```bash
  pnpm dev:install
  guildhall stop
  guildhall start
  ```

  Browser-smoke:

  - `/projects/fair-labor-license/overview`
  - `/projects/fair-labor-license/thread`
  - `/projects/fair-labor-license/release`
  - one busier project with many task notes or escalations

- [ ] **Step 5: Migration proof**

  On a copy or disposable fixture first:

  ```bash
  guildhall migrate task-state --project /Users/matthew/git/oss/fair-labor-license --dry-run
  guildhall migrate task-state --project /Users/matthew/git/oss/fair-labor-license --apply
  ```

  Verify:

  - old UI summaries still render
  - system-local evidence contains the extracted records
  - project-local `TASKS.json` no longer stores runtime/evidence fields
  - Git Story still reports real dirty/no-upstream state
  - no new writes recreate legacy fields after a task tick

## Acceptance Criteria

- New task writes no longer add runtime/evidence fields to project-local
  `TASKS.json`.
- Legacy task files continue to render and run through compatibility projection.
- FLL-style task records migrate idempotently into system-local runtime and
  evidence stores.
- Task worktree paths and branch names live in system-local workspace state.
- Git Story no longer depends on task-local `worktreePath`.
- Review verdicts, adjudications, notes, gate output, escalation history, and
  issue history live in system-local evidence files.
- Task Drawer, Thread, Overview, and Release still show the same or clearer
  user-facing state.
- Public docs do not expose internal storage details unless a user-facing
  storage/reference page explicitly needs them.

## Open Decisions

- Whether to rename `projectPath` to `scopePath` in 0.8.0 or keep the API field
  stable and normalize internally first.
- Whether unresolved escalations should be stored as a small task-local
  `currentBlocker` projection or entirely in runtime state with projection at
  read time.
- Whether `terminalSummary` belongs in the task definition or should be fully
  projected from evidence.
- Whether service startup should auto-apply task-state migration or only offer a
  maintenance action. Conservative default for 0.8.0: compatibility projection
  always, explicit apply for destructive cleanup.
