# 2026-05-23 Flow Audit Follow-Ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the release-facing flow issues found by the 2026-05-23 deep unattended Guildhall 0.7.0 audit.

**Architecture:** Treat the audit findings as four independently shippable slices: truthful start/readiness affordances, reliable activity projection, stricter question filtering, and release-smoke discipline. Prefer runtime truth in `src/runtime/serve.ts` and `src/runtime/thread.ts`, then let the Svelte surfaces render that truth instead of guessing.

**Tech Stack:** TypeScript, Hono runtime server, Svelte 5 UI, Vitest, Testing Library, local Guildhall service at `http://localhost:7777`.

---

## File Structure

- Modify `src/runtime/serve.ts`: add all-terminal start readiness and start no-op behavior; enrich `/api/project/activity` with live event metadata if needed.
- Modify `src/runtime/__tests__/serve-settings.test.ts`: cover all-terminal start readiness and start response semantics.
- Modify `src/runtime/__tests__/serve-task-endpoints.test.ts`: cover `/api/project/activity` freshness for live run events.
- Modify `src/runtime/thread.ts`: keep Thread activity in sync with Timeline/recent events and suppress receipt/promise fallback questions.
- Modify `src/runtime/__tests__/thread.test.ts`: add regressions for all-terminal recent activity, live worker freshness, and fake question suppression.
- Modify `src/runtime/inbox.ts` and `src/runtime/__tests__/inbox.test.ts`: ensure inbox uses the same question visibility rules as Thread.
- Modify `src/runtime/orchestrator.ts` and `src/runtime/__tests__/orchestrator.test.ts`: reduce empty-assistant retry churn after verified progress and make the recovery state explicit.
- Modify `src/web/lib/events.ts`, `src/web/surfaces/Header.svelte`, and `src/web/lib/__tests__/events.test.ts`: make the connection indicator less false-negative when APIs/events are otherwise healthy.
- Modify `src/web/surfaces/ProjectView.svelte`, `src/web/surfaces/project/ThreadTab.svelte`, and their tests: render all-terminal/no-action start states cleanly.
- Modify `internal/audits/flow-audit.md`: mark the follow-up checklist complete only after code and live smoke pass.

---

### Task 1: Make Done-Only Projects Truthfully Not Startable

**Files:**
- Modify: `src/runtime/serve.ts`
- Modify: `src/runtime/__tests__/serve-settings.test.ts`
- Modify: `src/web/surfaces/ProjectView.svelte`
- Modify: `src/web/surfaces/project/ThreadTab.svelte`
- Modify: `src/web/surfaces/__tests__/ProjectView.svelte.test.ts`
- Modify: `src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts`

- [x] **Step 1: Write runtime tests for all-terminal readiness**

Add a test in `src/runtime/__tests__/serve-settings.test.ts` near the existing `startReadiness` tests:

```ts
it('marks all-terminal projects as not startable', async () => {
  const now = new Date().toISOString()
  await fs.writeFile(path.join(memoryDir, 'TASKS.json'), JSON.stringify({
    version: 1,
    lastUpdated: now,
    tasks: [
      taskFixture({ id: 'done-1', status: 'done', title: 'Done one', createdAt: now, updatedAt: now }),
      taskFixture({ id: 'done-2', status: 'done', title: 'Done two', createdAt: now, updatedAt: now }),
    ],
  }, null, 2))

  const { app } = buildServeApp({ projectPath: tmpDir })
  const res = await app.fetch(new Request(projectUrl('/api/project')))
  expect(res.status).toBe(200)
  const body = await res.json() as { startReadiness?: { canStart?: boolean; code?: string; message?: string } }
  expect(body.startReadiness).toMatchObject({
    canStart: false,
    code: 'all_terminal',
    message: 'All tasks are already finished.',
  })
})
```

- [x] **Step 2: Write start endpoint test for all-terminal no-op**

Add a second test in the same file:

```ts
it('returns a no-op start response when all tasks are terminal', async () => {
  const now = new Date().toISOString()
  await fs.writeFile(path.join(memoryDir, 'TASKS.json'), JSON.stringify({
    version: 1,
    lastUpdated: now,
    tasks: [
      taskFixture({ id: 'done-1', status: 'done', title: 'Done one', createdAt: now, updatedAt: now }),
    ],
  }, null, 2))

  const { app } = buildServeApp({ projectPath: tmpDir })
  const res = await app.fetch(new Request(projectUrl('/api/project/start'), { method: 'POST', body: '{}' }))
  expect(res.status).toBe(200)
  const body = await res.json() as { status?: string; code?: string; stopSummary?: { reason?: string } }
  expect(body).toMatchObject({
    status: 'stopped',
    code: 'all_terminal',
    stopSummary: { reason: 'all_terminal' },
  })
})
```

- [x] **Step 3: Run the focused runtime tests and confirm failure**

Run:

```bash
pnpm vitest run src/runtime/__tests__/serve-settings.test.ts -- --runInBand
```

Expected: the new tests fail because `projectStartReadiness()` currently only checks setup/provider/import-draft readiness, and `/api/project/start` briefly starts the supervisor.

- [x] **Step 4: Add a terminal queue helper in `serve.ts`**

In `src/runtime/serve.ts`, add a helper near `startBlockerForImportDrafts`:

```ts
function terminalStartState(projectPath: string): {
  canStart: false
  code: 'all_terminal'
  message: string
  stopSummary: {
    reason: 'all_terminal'
    message: string
    counts: { total: number; done: number; blocked: number; shelved: number; actionable: number; terminal: number }
  }
} | null {
  const tasksPath = join(projectPath, 'memory', 'TASKS.json')
  if (!existsSync(tasksPath)) return null
  const raw = readJsonSafe(tasksPath)
  const tasks = tasksArray(raw)
  if (tasks.length === 0) return null
  const terminal = tasks.filter(task => ['done', 'blocked', 'shelved'].includes(task.status))
  const actionable = tasks.length - terminal.length
  if (actionable > 0) return null
  const done = tasks.filter(task => task.status === 'done').length
  const blocked = tasks.filter(task => task.status === 'blocked').length
  const shelved = tasks.filter(task => task.status === 'shelved').length
  const message = `No actionable tasks remain: ${done} done, ${blocked} blocked, ${shelved} shelved.`
  return {
    canStart: false,
    code: 'all_terminal',
    message: tasks.every(task => task.status === 'done')
      ? 'All tasks are already finished.'
      : message,
    stopSummary: {
      reason: 'all_terminal',
      message,
      counts: { total: tasks.length, done, blocked, shelved, actionable, terminal: terminal.length },
    },
  }
}
```

- [x] **Step 5: Use the helper in readiness and start**

In `projectStartReadiness()`, before provider preflight, add:

```ts
const terminal = terminalStartState(input.projectPath)
if (terminal) {
  return {
    canStart: false,
    code: terminal.code,
    message: terminal.message,
  }
}
```

In `app.post('/api/project/start')`, after the import-draft blocker and lever invariant checks but before provider preflight, add:

```ts
const terminal = terminalStartState(project.path)
if (terminal) {
  return c.json({
    status: 'stopped',
    mode: 'continuous',
    code: terminal.code,
    stopSummary: terminal.stopSummary,
  })
}
```

- [x] **Step 6: Update UI tests for disabled/no-action start**

Add tests that pass a project detail with:

```ts
startReadiness: {
  canStart: false,
  code: 'all_terminal',
  message: 'All tasks are already finished.',
}
```

Expected UI assertions:

```ts
expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
expect(screen.getByText(/All tasks are already finished/i)).toBeInTheDocument()
```

- [x] **Step 7: Run verification**

Run:

```bash
pnpm vitest run src/runtime/__tests__/serve-settings.test.ts src/web/surfaces/__tests__/ProjectView.svelte.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts -- --runInBand
```

Expected: all selected tests pass.

---

### Task 2: Make Thread Recent Activity Match Timeline For Immediate Stop Runs

**Files:**
- Modify: `src/web/lib/project-activity.ts`
- Modify: `src/web/lib/__tests__/project-activity.test.ts`
- Modify: `src/runtime/thread.ts`
- Modify: `src/runtime/__tests__/thread.test.ts`

- [x] **Step 1: Add project ticker regression for all-terminal supervisor events**

In `src/web/lib/__tests__/project-activity.test.ts`, add a case where recent events contain `supervisor_started` followed by `supervisor_stopped` with `reason: 'all_terminal'`.

Expected:

```ts
expect(result.message).toContain('Run finished')
expect(result.detail).toContain('No actionable tasks remain')
```

- [x] **Step 2: Add Thread regression for run-level recent activity**

In `src/runtime/__tests__/thread.test.ts`, add:

```ts
it('surfaces immediate all-terminal start-stop activity in Thread', () => {
  const now = new Date().toISOString()
  writeTasks([
    taskFixture({ id: 'done-1', title: 'Done one', status: 'done', updatedAt: now }),
  ])
  const thread = buildThread({
    projectPath: tmpDir,
    runStatus: 'stopped',
    recentEvents: [
      { at: now, workspaceId: 'test', event: { type: 'supervisor_started', message: 'Orchestrator started for test' } },
      { at: now, workspaceId: 'test', event: { type: 'supervisor_stopped', reason: 'all_terminal', message: 'No actionable tasks remain: 1 done, 0 blocked, 0 shelved.' } },
    ],
  })
  expect(JSON.stringify(thread)).toContain('No actionable tasks remain')
})
```

- [x] **Step 3: Implement run-level activity projection**

In `src/runtime/thread.ts`, add a small run activity summary before returning an empty/all-caught-up Thread state:

```ts
function latestSupervisorActivity(events: BuildThreadOptions['recentEvents']): string | null {
  const latest = [...(events ?? [])].reverse().find(envelope =>
    ['supervisor_started', 'supervisor_stopped', 'supervisor_error'].includes(String(envelope.event?.type ?? '')),
  )
  const message = latest?.event?.message
  return typeof message === 'string' && message.trim() ? message.trim() : null
}
```

Use it in the all-caught-up turn text so Thread does not say `No recent activity` while Timeline shows a fresh run.

- [x] **Step 4: Run verification**

Run:

```bash
pnpm vitest run src/runtime/__tests__/thread.test.ts src/web/lib/__tests__/project-activity.test.ts -- --runInBand
```

Expected: selected tests pass and Thread/Timeline both show the immediate start-stop truth.

---

### Task 3: Keep `/api/project/activity` Fresh During Long Worker Loops

**Files:**
- Modify: `src/runtime/serve.ts`
- Modify: `src/runtime/__tests__/serve-task-endpoints.test.ts`
- Modify: `src/web/lib/project-data.ts`
- Modify: `src/web/lib/__tests__/project-data.test.ts`

- [x] **Step 1: Add activity endpoint regression with recent live events**

In `src/runtime/__tests__/serve-task-endpoints.test.ts`, add a test where a task is `in_progress`, supervisor recent events include a recent `tool_completed` and `error`, and `/api/project/activity` must include a `lastActivityAt` and `lastActivityLabel`.

Expected response shape:

```ts
expect(body.inFlight[0]).toMatchObject({
  id: 't1',
  status: 'in_progress',
  lastActivityLabel: 'Failed command',
})
expect(body.inFlight[0].lastActivityAt).toBe(now)
```

- [x] **Step 2: Extend activity endpoint in `serve.ts`**

In `/api/project/activity`, attach the latest recent event per task:

```ts
const recentByTask = new Map<string, { at?: string; label?: string; tone?: string }>()
for (const envelope of supervisor.recent(project.id, undefined, project.path)) {
  const taskId = typeof envelope.event?.task_id === 'string' ? envelope.event.task_id : null
  if (!taskId) continue
  recentByTask.set(taskId, {
    at: envelope.at,
    label: summarizeProjectEvent(envelope.event),
    tone: toneForProjectEvent(envelope.event),
  })
}
```

Then include this on each `inFlight` row:

```ts
const recent = recentByTask.get(id)
inFlight.push({
  id,
  title,
  status: st,
  domain,
  ...(recent?.at ? { lastActivityAt: recent.at } : {}),
  ...(recent?.label ? { lastActivityLabel: recent.label } : {}),
  ...(recent?.tone ? { lastActivityTone: recent.tone } : {}),
})
```

- [x] **Step 3: Keep labels short and user-facing**

Add helper functions in `serve.ts`:

```ts
function summarizeProjectEvent(ev: Record<string, unknown> | undefined): string {
  const type = String(ev?.type ?? '')
  const tool = String(ev?.tool_name ?? '').replace(/[-_]/g, ' ')
  if (type === 'tool_started' && tool) return `Started ${tool}`
  if (type === 'tool_completed' && ev?.is_error && tool) return `Failed ${tool}`
  if (type === 'tool_completed' && tool) return `Finished ${tool}`
  if (type === 'error') return String(ev?.message ?? 'Agent error')
  if (type === 'line_complete') return String(ev?.message ?? 'Agent update')
  return type.replace(/_/g, ' ') || 'Agent activity'
}

function toneForProjectEvent(ev: Record<string, unknown> | undefined): 'neutral' | 'running' | 'ok' | 'warn' | 'danger' {
  const type = String(ev?.type ?? '')
  if (type === 'error') return /empty assistant/i.test(String(ev?.message ?? '')) ? 'warn' : 'danger'
  if (type === 'tool_completed') return ev?.is_error ? 'danger' : 'ok'
  if (type === 'tool_started') return 'running'
  if (type === 'line_complete') return 'running'
  return 'neutral'
}
```

- [x] **Step 4: Update web data types**

In `src/web/lib/project-data.ts` and related types, preserve the new fields so project header/Thread can use them without casting.

- [x] **Step 5: Run verification**

Run:

```bash
pnpm vitest run src/runtime/__tests__/serve-task-endpoints.test.ts src/web/lib/__tests__/project-data.test.ts -- --runInBand
```

Expected: selected tests pass and activity consumers receive live event labels.

---

### Task 4: Suppress Receipt/Promise Fallback Questions Everywhere

**Files:**
- Modify: `src/runtime/question-visibility.ts`
- Modify: `src/runtime/thread.ts`
- Modify: `src/runtime/inbox.ts`
- Modify: `src/runtime/orchestrator.ts`
- Modify: `src/runtime/__tests__/thread.test.ts`
- Modify: `src/runtime/__tests__/inbox.test.ts`
- Modify: `src/runtime/__tests__/orchestrator.test.ts`

- [x] **Step 1: Add regression for output-promise choices**

Create tests with a structured/fallback question whose choices are:

```ts
[
  'I will draft the blueprint',
  'I will update the product brief',
  'I will persist progress with tools',
]
```

Expected in Thread/Inbox/orchestrator picking:

```ts
expect(visibleQuestions).toHaveLength(0)
expect(taskIsWaitingOnUser).toBe(false)
```

- [x] **Step 2: Centralize the predicate**

In `src/runtime/question-visibility.ts`, add:

```ts
const receiptOrPromisePatterns = [
  /\bi (?:will|can|have|now)\b.*\b(persist|draft|update|write|post|set|move|create|record)\b/i,
  /\bposted the .*question\b/i,
  /\bpersisted progress with tools\b/i,
  /\bset task status\b/i,
  /\bupdated the product brief\b/i,
]

export function isOperationalReceiptQuestion(question: QuestionRecord): boolean {
  const text = questionText(question)
  const choices = question.kind === 'choice' ? question.choices.map(choice => choice.label).join('\n') : ''
  const combined = `${text}\n${choices}`
  return receiptOrPromisePatterns.some(pattern => pattern.test(combined))
}
```

- [x] **Step 3: Use the predicate in all question surfaces**

Filter with `isOperationalReceiptQuestion()` anywhere Thread, Inbox, or orchestrator task picking decides whether a question is answerable.

- [x] **Step 4: Run focused tests**

Run:

```bash
pnpm vitest run src/runtime/__tests__/thread.test.ts src/runtime/__tests__/inbox.test.ts src/runtime/__tests__/orchestrator.test.ts -- --runInBand
```

Expected: existing operational-receipt tests still pass, and the new output-promise cases are suppressed.

---

### Task 5: Reduce Empty-Assistant Retry Churn After Verified Tool Progress

**Files:**
- Modify: `src/runtime/orchestrator.ts`
- Modify: `src/runtime/__tests__/orchestrator.test.ts`
- Modify: `src/runtime/wire-events.ts`
- Modify: `src/runtime/__tests__/wire-events.test.ts`

- [x] **Step 1: Add regression for repeated empty replies after verified progress**

In `src/runtime/__tests__/orchestrator.test.ts`, add a case where the worker performs a real tool write/checkpoint, then repeatedly throws `Model returned an empty assistant message`.

Expected:

```ts
expect(result.stopReason).not.toBe('max_ticks')
expect(task.status).toBe('blocked')
expect(task.blockReason).toContain('empty assistant reply after verified progress')
```

- [x] **Step 2: Replace indefinite clean retry with bounded recovery**

In `src/runtime/orchestrator.ts`, update the empty-assistant handling so that after:

- one ordinary retry,
- one conversation reset,
- and verified tool/file/checkpoint progress,

Guildhall records a recovery checkpoint and blocks or pauses the task with an explicit resumable reason instead of continuing the same noisy loop.

Implementation shape:

```ts
if (emptyAssistantAfterVerifiedProgress && emptyReplyAttempts >= 2) {
  await writeRecoveryCheckpoint({
    task,
    intent: 'empty assistant reply after verified progress',
    details: message,
  })
  return blockTaskForRecovery({
    task,
    reason: 'empty assistant reply after verified progress',
    details: 'The model stopped returning usable assistant text after tool progress. Guildhall saved a recovery checkpoint so the task can resume cleanly.',
  })
}
```

- [x] **Step 3: Make activity copy calm**

In `src/runtime/wire-events.ts`, map this failure to a warning-style event label such as:

```ts
'Saved a recovery checkpoint after the model stopped responding clearly.'
```

Avoid repeatedly surfacing raw “empty assistant message” in user-facing activity.

- [x] **Step 4: Run focused tests**

Run:

```bash
pnpm vitest run src/runtime/__tests__/orchestrator.test.ts src/runtime/__tests__/wire-events.test.ts -- --runInBand
```

Expected: retries remain covered, but repeated empty-message churn becomes a bounded recovery state.

---

### Task 6: Make Header Connection State Less Misleading

**Files:**
- Modify: `src/web/lib/events.ts`
- Modify: `src/web/lib/__tests__/events.test.ts`
- Modify: `src/web/surfaces/Header.svelte`

- [x] **Step 1: Add event status regression**

In `src/web/lib/__tests__/events.test.ts`, add a test that simulates:

1. EventSource opens.
2. EventSource errors.
3. A later message or successful reconnect arrives.

Expected statuses:

```ts
expect(statuses).toContain('live')
expect(statuses.at(-1)).toBe('live')
```

- [x] **Step 2: Track stale vs connecting distinctly**

Update the status type:

```ts
export type SseStatus = 'connecting' | 'live' | 'reconnecting' | 'error'
```

Set `reconnecting` only after a previously live stream errors:

```ts
es.onerror = () => setStatus(status === 'live' ? 'reconnecting' : 'error')
```

Keep `onmessage` and `onopen` setting `live`.

- [x] **Step 3: Update header labels**

In `Header.svelte`:

```ts
const sseTone = $derived<'active' | 'warn' | 'idle'>(
  sseStatus === 'live' ? 'active' : sseStatus === 'reconnecting' ? 'warn' : 'idle',
)
const sseLabel = $derived(
  sseStatus === 'live' ? 'connected' : sseStatus === 'reconnecting' ? 'reconnecting' : 'connecting',
)
```

- [x] **Step 4: Run focused tests**

Run:

```bash
pnpm vitest run src/web/lib/__tests__/events.test.ts src/web/__tests__/App.svelte.test.ts -- --runInBand
```

Expected: header no longer gets stuck in a false “connecting” state while events/API are healthy.

---

### Task 7: Add Release Smoke Discipline For Served Bundle Freshness

**Files:**
- Modify: `internal/audits/flow-audit.md`
- Modify: `scripts/release-artifacts.test.ts` only if the release-smoke command needs a code-enforced contract.
- Optionally create: `scripts/release-smoke.mjs`

- [x] **Step 1: Add a checklist section for release smoke**

Append a concrete 0.7 release-smoke checklist to `internal/audits/flow-audit.md`:

```md
- [x] Before release smoke, restart the served bundle and verify `/api/stale-server`
  reports `stale: false`; do not treat browser findings as release signal while
  the stale-server banner is visible.
```

- [x] **Step 2: Script the stale-server preflight if manual checks keep failing**

If this remains easy to forget, create `scripts/release-smoke.mjs`:

```js
const base = process.env.GUILDHALL_SMOKE_URL ?? 'http://localhost:7777'
const stale = await fetch(`${base}/api/stale-server`).then(r => r.json())
if (stale?.stale) {
  console.error('Guildhall served bundle is stale. Restart the local service before release smoke.')
  process.exit(1)
}
const version = await fetch(`${base}/api/version`).then(r => r.json())
console.log(`Guildhall ${version.version ?? 'unknown'} served bundle is fresh.`)
```

- [x] **Step 3: Add package script only if useful**

If a script is created, add:

```json
"smoke:release": "node scripts/release-smoke.mjs"
```

- [x] **Step 4: Verify manually**

Run:

```bash
pnpm smoke:release
curl -s http://localhost:7777/api/version
curl -s http://localhost:7777/api/stale-server
```

Expected: smoke refuses to proceed when the stale-server banner would appear.

---

### Task 8: Final Cross-Project Regression Pass

**Files:**
- Modify: `internal/audits/flow-audit.md`

- [x] **Step 1: Run unit and type gates**

Run:

```bash
pnpm typecheck
pnpm test -- --runInBand
```

Expected: both pass. If existing unrelated failures remain, record them explicitly in `internal/audits/flow-audit.md`.

- [x] **Step 2: Restart local 0.7 service**

Run the project’s normal dev-install/restart flow for the served bundle. Then verify:

```bash
curl -s http://localhost:7777/api/version
curl -s http://localhost:7777/api/stale-server
```

Expected: version is the intended release version and stale-server response is not stale.

- [x] **Step 3: Browser smoke the exact audit projects**

Open and inspect:

```text
http://localhost:7777/projects/t-minus-t
http://localhost:7777/projects/commerce-project
http://localhost:7777/projects/font-something
http://localhost:7777/projects/fair-labor-license
http://localhost:7777/projects/narrative-harness
http://localhost:7777/projects/looma-knit
```

Expected:

- done-only projects do not offer misleading Start affordances;
- Thread and Timeline agree on immediate start-stop runs;
- active long-running work shows fresh activity;
- real user questions appear as questions;
- operational receipts and output promises do not.

- [x] **Step 4: Update the audit checklist**

In `internal/audits/flow-audit.md`, mark the 2026-05-23 follow-up item complete only after the final smoke has real evidence.

---

## Self-Review

- Spec coverage: The plan covers every 2026-05-23 flow-audit follow-up: all-terminal Start truth, Thread/Timeline consistency, activity freshness, fake question suppression, empty assistant recovery, connection status, and stale served-bundle discipline.
- Placeholder scan: No placeholder markers or unspecified edge handling remains. Each task names files, tests, implementation shape, and verification commands.
- Type consistency: Runtime response additions use existing `startReadiness` shape plus explicit `code: 'all_terminal'`; activity additions use optional fields so existing consumers do not break while UI catches up.
