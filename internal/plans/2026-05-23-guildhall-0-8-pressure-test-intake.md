# Guildhall 0.8.0 Pressure-Test Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first 0.8.0 slice where a broad user request can route into a durable Pressure-Test Intake loop that asks one evidence-backed question at a time, persists domain state, and produces a buildable spec without making the user babysit hidden agent state.

**Architecture:** Introduce a small request-routing layer in the runtime, then add a `pressure-test-intake` practice as a typed project artifact and Thread card. Keep normal small tasks on the existing `exploring -> spec_review -> ready` path; only route release, feature, project, or high-ambiguity requests into the deeper intake loop. The UI should change from "New Task" to "New request", but the product win is the persisted intake state and Thread rendering, not the label change.

**Tech Stack:** TypeScript, Zod, Hono runtime routes, existing `TaskQueue` / `Thread` projection, Svelte 5 UI, Vitest, Playwright.

---

## Priority And Release Slices

0.8.0 should be pressure-test-first:

1. **Slice A: Request routing and durable intake state.** A freeform request can become a typed routed action, and release/feature/project requests can start Pressure-Test Intake with persistent domain state.
2. **Slice B: Thread interaction loop.** Thread renders request cards and pressure-test question cards from durable state; answering a question advances the domain loop without relying on transcript parsing.
3. **Slice C: Spec production.** Completed intake produces a task/spec or release plan with assumptions, deferrals, language-map candidates, acceptance criteria, and verification expectations.
4. **Slice D: Practices/personas library.** Build only the minimum `pressure-test-intake` practice metadata needed by routing and audit. Defer general user-authored practices/personas until this loop proves useful.
5. **Slice E: Runtime isolation and rich artifacts.** Keep Podman and rich HTML artifacts behind this intake foundation unless they are needed to pressure-test or render the intake plan itself.

## File Structure

- Create `src/runtime/request-routing.ts`: classify raw requests into routed actions and decide whether Pressure-Test Intake is required.
- Create `src/runtime/pressure-test-intake.ts`: Zod schemas, state persistence helpers, domain seeding, answer recording, and next-action selection.
- Modify `src/runtime/intake.ts`: keep `createExploringTask()` unchanged for ordinary tasks; add `createRoutedRequest()` wrapper that can create pressure-test records or fall back to existing task intake.
- Modify `src/runtime/serve.ts`: add `POST /api/project/request`, `POST /api/project/pressure-test/:id/answer`, and `GET /api/project/pressure-test/:id`.
- Modify `src/runtime/thread.ts`: add request and pressure-test turn types.
- Modify `src/agents/spec-agent.ts`: add a pressure-test operating contract and prevent the normal spec agent from batch-questioning pressure-test targets.
- Modify `src/web/surfaces/IntakeModal.svelte`: rename to New request behavior, remove up-front task typing for non-bug asks, and post to `/api/project/request`.
- Modify `src/web/surfaces/project/ThreadTab.svelte`: render request, split-preview, and pressure-test question turns.
- Add tests in `src/runtime/__tests__/request-routing.test.ts`, `src/runtime/__tests__/pressure-test-intake.test.ts`, update `serve-intake.test.ts`, `thread.test.ts`, `IntakeModal.svelte.test.ts`, and `ThreadTab.svelte.test.ts`.
- Update `internal/specs/2026-05-22-guildhall-0-8-practices-deep-intake-worker-modes-and-personas.md` only if implementation discovers a contract mismatch. Do not move this plan into public docs.

## Data Contracts

Use these names consistently:

```ts
type IntakeTargetType = 'release' | 'feature' | 'project' | 'task' | 'bug' | 'investigation' | 'memory' | 'note'
type RoutedActionKind =
  | 'task_spec'
  | 'pressure_test_intake'
  | 'project_question'
  | 'settings_proposal'
  | 'persona_practice_proposal'
  | 'repair_triage'
  | 'clarification'
```

Persist pressure-test state under the project memory directory:

```text
memory/pressure-test-intake/<intake-id>.json
```

Use project-owned state for the active intake and local Thread projection for richer history later. This slice does not implement detailed-history retention yet.

---

### Task 1: Request Routing Core

**Files:**
- Create: `src/runtime/request-routing.ts`
- Test: `src/runtime/__tests__/request-routing.test.ts`
- Modify: `src/runtime/index.ts`

- [ ] **Step 1: Write routing tests**

```ts
import { describe, expect, it } from 'vitest'
import { routeRequest } from '../request-routing.js'

describe('routeRequest', () => {
  it('routes release ideas to pressure-test intake', () => {
    const result = routeRequest({
      raw: 'I have ideas for Guildhall 0.8.0. Pressure-test intake is my top priority.',
      source: 'thread',
      routeContext: { projectId: 'guildhall', route: '/projects/guildhall/thread' },
    })

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toMatchObject({
      kind: 'pressure_test_intake',
      intakeTarget: {
        type: 'release',
        title: 'Guildhall 0.8.0',
        pressureTestRequired: true,
      },
      requiresConfirmation: false,
    })
    expect(result.routingDecision.reason).toContain('release')
  })

  it('keeps a small concrete implementation ask on the normal task path', () => {
    const result = routeRequest({
      raw: 'Add a loading spinner to the Providers page.',
      source: 'modal',
      routeContext: { projectId: 'guildhall', route: '/projects/guildhall/settings' },
    })

    expect(result.actions[0]).toMatchObject({
      kind: 'task_spec',
      intakeTarget: {
        type: 'task',
        pressureTestRequired: false,
      },
    })
  })

  it('routes questions as read-only project questions', () => {
    const result = routeRequest({
      raw: 'Why is this project still blocked on useAuth.ts?',
      source: 'thread',
      routeContext: { projectId: 'fair-labor-license', route: '/projects/fair-labor-license/thread' },
    })

    expect(result.actions[0]).toMatchObject({
      kind: 'project_question',
      safety: 'read-only',
    })
  })
})
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm vitest run src/runtime/__tests__/request-routing.test.ts`

Expected: FAIL because `src/runtime/request-routing.ts` does not exist.

- [ ] **Step 3: Add the minimal router**

Implement deterministic routing first. Do not call a model in this slice.

```ts
import { z } from 'zod'

export const IntakeTarget = z.object({
  type: z.enum(['release', 'feature', 'project', 'task', 'bug', 'investigation', 'memory', 'note']),
  title: z.string(),
  source: z.string(),
  pressureTestRequired: z.boolean(),
  nextStep: z.enum(['pressure-test-intake', 'task-intake', 'answer-question', 'settings-proposal', 'proposal-review', 'repair-triage']),
})

export type IntakeTarget = z.infer<typeof IntakeTarget>

export const RoutedAction = z.object({
  id: z.string(),
  kind: z.enum([
    'task_spec',
    'pressure_test_intake',
    'project_question',
    'settings_proposal',
    'persona_practice_proposal',
    'repair_triage',
    'clarification',
  ]),
  label: z.string(),
  safety: z.enum(['read-only', 'project-write', 'global-write', 'external-write']),
  intakeTarget: IntakeTarget,
  requiresConfirmation: z.boolean(),
})

export type RoutedAction = z.infer<typeof RoutedAction>

export interface RouteRequestInput {
  raw: string
  source: 'modal' | 'thread' | 'api'
  routeContext: {
    projectId?: string
    route?: string
  }
}

export interface RouteRequestResult {
  actions: RoutedAction[]
  routingDecision: {
    reason: string
    matchedSignals: string[]
  }
}

export function routeRequest(input: RouteRequestInput): RouteRequestResult {
  const raw = input.raw.trim()
  const title = inferTitle(raw)
  const lower = raw.toLowerCase()
  const releaseMatch = raw.match(/\b(?:v)?(\d+\.\d+(?:\.\d+)?)\b/)

  if (/\bwhy\b|\bwhat is\b|\bhow does\b|\bblocked\b/.test(lower) && lower.endsWith('?')) {
    return one('project_question', title, 'read-only', 'investigation', false, 'question-like request', ['question'])
  }

  if (
    releaseMatch ||
    /\brelease\b|\bmilestone\b|\broadmap\b|\bpressure[- ]test\b|\bask me everything\b|\bproduct spec\b/.test(lower)
  ) {
    const releaseTitle = releaseMatch ? `Guildhall ${releaseMatch[1]}` : title
    return one('pressure_test_intake', releaseTitle, 'project-write', releaseMatch ? 'release' : 'feature', true, 'release or high-ambiguity product request', ['release_or_feature_intake'])
  }

  return one('task_spec', title, 'project-write', 'task', false, 'small concrete implementation request', ['task_like'])
}

function one(
  kind: RoutedAction['kind'],
  title: string,
  safety: RoutedAction['safety'],
  targetType: IntakeTarget['type'],
  pressureTestRequired: boolean,
  reason: string,
  matchedSignals: string[],
): RouteRequestResult {
  return {
    actions: [{
      id: `action-${slugify(title)}`,
      kind,
      label: title,
      safety,
      intakeTarget: {
        type: targetType,
        title,
        source: 'new-request',
        pressureTestRequired,
        nextStep: pressureTestRequired ? 'pressure-test-intake' : kind === 'project_question' ? 'answer-question' : 'task-intake',
      },
      requiresConfirmation: safety === 'global-write' || safety === 'external-write',
    }],
    routingDecision: { reason, matchedSignals },
  }
}

function inferTitle(raw: string): string {
  const firstLine = raw.split(/\r?\n/)[0]?.trim() ?? 'New request'
  return firstLine.length <= 72 ? firstLine : `${firstLine.slice(0, 69).trim()}...`
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'request'
}
```

- [ ] **Step 4: Export the router**

Add to `src/runtime/index.ts`:

```ts
export * from './request-routing.js'
```

- [ ] **Step 5: Run the test**

Run: `pnpm vitest run src/runtime/__tests__/request-routing.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/request-routing.ts src/runtime/index.ts src/runtime/__tests__/request-routing.test.ts
git commit -m "feat: add request routing core"
```

### Task 2: Persistent Pressure-Test Intake State

**Files:**
- Create: `src/runtime/pressure-test-intake.ts`
- Test: `src/runtime/__tests__/pressure-test-intake.test.ts`
- Modify: `src/runtime/index.ts`

- [ ] **Step 1: Write persistence and domain-loop tests**

```ts
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  answerPressureTestQuestion,
  createPressureTestIntake,
  loadPressureTestIntake,
} from '../pressure-test-intake.js'

describe('pressure-test intake state', () => {
  it('creates a release-level intake with seeded domains and one active question', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    const intake = await createPressureTestIntake({
      memoryDir,
      target: { type: 'release', id: 'guildhall-0-8-0', title: 'Guildhall 0.8.0' },
      rawRequest: 'I want 0.8.0 to prioritize pressure-test intake.',
    })

    expect(intake.status).toBe('active')
    expect(intake.activeDomainId).toBe('product-goals')
    expect(intake.domains[0]).toMatchObject({
      id: 'product-goals',
      status: 'active',
      closeoutAsked: false,
    })
    expect(intake.pendingQuestion?.domainId).toBe('product-goals')

    const saved = await loadPressureTestIntake({ memoryDir, intakeId: intake.id })
    expect(saved.rawRequest).toContain('pressure-test intake')
  })

  it('records answers and asks a follow-up before closing vague product goals', async () => {
    const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
    const intake = await createPressureTestIntake({
      memoryDir,
      target: { type: 'release', id: 'guildhall-0-8-0', title: 'Guildhall 0.8.0' },
      rawRequest: 'I want better intake.',
    })

    const next = await answerPressureTestQuestion({
      memoryDir,
      intakeId: intake.id,
      questionId: intake.pendingQuestion!.id,
      answer: 'It should feel rigorous but not annoying.',
    })

    expect(next.activeDomainId).toBe('product-goals')
    expect(next.pendingQuestion?.prompt).toContain('concrete')
    expect(next.domains[0]?.askedQuestions[0]).toMatchObject({
      answered: true,
      answer: 'It should feel rigorous but not annoying.',
    })
  })
})
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm vitest run src/runtime/__tests__/pressure-test-intake.test.ts`

Expected: FAIL because `pressure-test-intake.ts` does not exist.

- [ ] **Step 3: Implement schemas and state persistence**

Use `atomicWriteText()` and Zod parsing so corrupted state fails loudly in tests.

```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { atomicWriteText } from '@guildhall/sessions'

const DomainStatus = z.enum(['seeded', 'inspected', 'active', 'follow-up', 'closeout', 'closed', 'deferred', 'dropped', 'reopened'])

export const PressureTestQuestion = z.object({
  id: z.string(),
  domainId: z.string(),
  prompt: z.string(),
  why: z.string(),
  evidence: z.array(z.string()).default([]),
  askedAt: z.string(),
})

export const PressureTestIntake = z.object({
  id: z.string(),
  rawRequest: z.string(),
  target: z.object({
    type: z.enum(['project', 'release', 'feature', 'task']),
    id: z.string(),
    title: z.string(),
  }),
  status: z.enum(['active', 'paused', 'complete']),
  activeDomainId: z.string().nullable(),
  pendingQuestion: PressureTestQuestion.nullable(),
  domains: z.array(z.object({
    id: z.string(),
    title: z.string(),
    whyItMatters: z.string(),
    status: DomainStatus,
    knownFacts: z.array(z.object({ fact: z.string(), source: z.string() })).default([]),
    openUnknowns: z.array(z.string()).default([]),
    askedQuestions: z.array(z.object({
      questionId: z.string(),
      prompt: z.string(),
      answered: z.boolean(),
      answer: z.string().optional(),
    })).default([]),
    followUpCandidates: z.array(z.string()).default([]),
    closeoutAsked: z.boolean().default(false),
    summary: z.string().optional(),
  })),
  outputs: z.object({
    assumptions: z.array(z.string()).default([]),
    decisions: z.array(z.string()).default([]),
    languageMapCandidates: z.array(z.string()).default([]),
    taskSplitCandidates: z.array(z.string()).default([]),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type PressureTestIntake = z.infer<typeof PressureTestIntake>

export async function createPressureTestIntake(input: {
  memoryDir: string
  target: PressureTestIntake['target']
  rawRequest: string
}): Promise<PressureTestIntake> {
  const now = new Date().toISOString()
  const id = `pti-${input.target.id.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`
  const domains = seedDomains(input.target.type)
  domains[0]!.status = 'active'
  const intake: PressureTestIntake = {
    id,
    rawRequest: input.rawRequest,
    target: input.target,
    status: 'active',
    activeDomainId: domains[0]!.id,
    pendingQuestion: firstQuestion(domains[0]!, now),
    domains,
    outputs: { assumptions: [], decisions: [], languageMapCandidates: [], taskSplitCandidates: [] },
    createdAt: now,
    updatedAt: now,
  }
  await savePressureTestIntake(input.memoryDir, intake)
  return intake
}
```

- [ ] **Step 4: Implement answer handling**

Add a first deterministic producer heuristic. It should prefer a concrete follow-up when the answer uses vague quality words.

```ts
export async function answerPressureTestQuestion(input: {
  memoryDir: string
  intakeId: string
  questionId: string
  answer: string
}): Promise<PressureTestIntake> {
  const intake = await loadPressureTestIntake({ memoryDir: input.memoryDir, intakeId: input.intakeId })
  const domain = intake.domains.find(d => d.id === intake.activeDomainId)
  if (!domain || !intake.pendingQuestion || intake.pendingQuestion.id !== input.questionId) {
    throw new Error(`Question ${input.questionId} is not pending`)
  }

  domain.askedQuestions.push({
    questionId: input.questionId,
    prompt: intake.pendingQuestion.prompt,
    answered: true,
    answer: input.answer,
  })

  if (/\b(rigorous|annoying|fast|safe|simple|good|strict|polished|clear|friendly)\b/i.test(input.answer)) {
    domain.status = 'follow-up'
    intake.pendingQuestion = {
      id: `${domain.id}-q-${domain.askedQuestions.length + 1}`,
      domainId: domain.id,
      prompt: `What is one concrete example or threshold that would make "${input.answer}" true for ${intake.target.title}?`,
      why: 'The answer names a quality bar, but workers need an observable example or threshold.',
      evidence: [],
      askedAt: new Date().toISOString(),
    }
  } else {
    domain.status = 'closeout'
    domain.closeoutAsked = true
    intake.pendingQuestion = {
      id: `${domain.id}-closeout`,
      domainId: domain.id,
      prompt: `Is there anything else Guildhall should know about ${domain.title.toLowerCase()} before this domain closes?`,
      why: 'Pressure-test intake closes each domain deliberately so hidden constraints do not vanish.',
      evidence: domain.knownFacts.map(f => `${f.source}: ${f.fact}`),
      askedAt: new Date().toISOString(),
    }
  }

  intake.updatedAt = new Date().toISOString()
  await savePressureTestIntake(input.memoryDir, intake)
  return intake
}
```

- [ ] **Step 5: Export the module**

Add to `src/runtime/index.ts`:

```ts
export * from './pressure-test-intake.js'
```

- [ ] **Step 6: Run the test**

Run: `pnpm vitest run src/runtime/__tests__/pressure-test-intake.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/pressure-test-intake.ts src/runtime/index.ts src/runtime/__tests__/pressure-test-intake.test.ts
git commit -m "feat: persist pressure-test intake state"
```

### Task 3: Runtime API For New Requests

**Files:**
- Modify: `src/runtime/intake.ts`
- Modify: `src/runtime/serve.ts`
- Test: `src/runtime/__tests__/serve-intake.test.ts`

- [ ] **Step 1: Add API tests**

Add cases to `serve-intake.test.ts`:

```ts
it('POST /api/project/request starts pressure-test intake for release ideas', async () => {
  const res = await app.fetch(new Request(projectUrl('/api/project/request'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ask: 'For 0.8.0, pressure-test intake is my top priority.' }),
  }))

  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body).toMatchObject({
    routedActions: [{
      kind: 'pressure_test_intake',
      intakeTarget: { type: 'release', pressureTestRequired: true },
    }],
    pressureTestIntake: {
      status: 'active',
      activeDomainId: 'product-goals',
    },
  })
})

it('POST /api/project/request preserves ordinary task intake behavior', async () => {
  const res = await app.fetch(new Request(projectUrl('/api/project/request'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ask: 'Add a loading spinner to Providers.' }),
  }))

  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.routedActions[0].kind).toBe('task_spec')
  expect(body.taskId).toMatch(/^task-/)
})
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm vitest run src/runtime/__tests__/serve-intake.test.ts`

Expected: FAIL because `/api/project/request` is not registered.

- [ ] **Step 3: Add `createRoutedRequest()`**

In `src/runtime/intake.ts`, add a wrapper after `createExploringTask()`:

```ts
export async function createRoutedRequest(input: IntakeInput): Promise<{
  routedActions: import('./request-routing.js').RoutedAction[]
  routingDecision: import('./request-routing.js').RouteRequestResult['routingDecision']
  taskId?: string
  pressureTestIntake?: import('./pressure-test-intake.js').PressureTestIntake
}> {
  const { routeRequest } = await import('./request-routing.js')
  const { createPressureTestIntake } = await import('./pressure-test-intake.js')
  const routed = routeRequest({
    raw: input.ask,
    source: 'api',
    routeContext: { route: '/api/project/request' },
  })
  const action = routed.actions[0]

  if (action?.kind === 'pressure_test_intake') {
    const pressureTestIntake = await createPressureTestIntake({
      memoryDir: input.memoryDir,
      target: {
        type: action.intakeTarget.type === 'release' ? 'release' : 'feature',
        id: slugId(action.intakeTarget.title),
        title: action.intakeTarget.title,
      },
      rawRequest: input.ask,
    })
    return { routedActions: routed.actions, routingDecision: routed.routingDecision, pressureTestIntake }
  }

  const task = await createExploringTask(input)
  return { routedActions: routed.actions, routingDecision: routed.routingDecision, taskId: task.taskId }
}
```

- [ ] **Step 4: Add the Hono route**

In `src/runtime/serve.ts`, register:

```ts
app.post('/api/project/request', async c => {
  if (project.initializationNeeded) {
    return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
  }
  const body = await c.req.json().catch(() => ({}))
  const ask = String(body.ask ?? '').trim()
  if (!ask) return c.json({ error: 'Please describe the request.' }, 400)
  const coordinators = project.config?.coordinators ?? []
  const defaultDomain = coordinators[0]?.domain
  const domain = String(body.domain ?? defaultDomain ?? '').trim()
  if (!domain) {
    return c.json({ error: 'Guildhall has not inferred repo structure here yet - run repo inspection first' }, 400)
  }
  const result = await createRoutedRequest({
    memoryDir: join(project.path, 'memory'),
    projectPath: project.path,
    domain,
    ask,
    title: typeof body.title === 'string' ? body.title : undefined,
  })
  return c.json(result)
})
```

Use the same closure-scoped `project` pattern as `/api/project/intake`; do not introduce a separate selected-project rule.

- [ ] **Step 5: Add pressure-test answer endpoints**

Register:

```ts
app.get('/api/project/pressure-test/:id', async c => {
  const intake = await loadPressureTestIntake({
    memoryDir: join(project.path, 'memory'),
    intakeId: c.req.param('id'),
  })
  return c.json({ intake })
})

app.post('/api/project/pressure-test/:id/answer', async c => {
  const body = await c.req.json().catch(() => ({}))
  const questionId = String(body.questionId ?? '').trim()
  const answer = String(body.answer ?? '').trim()
  if (!questionId || !answer) return c.json({ error: 'Question and answer are required.' }, 400)
  const intake = await answerPressureTestQuestion({
    memoryDir: join(project.path, 'memory'),
    intakeId: c.req.param('id'),
    questionId,
    answer,
  })
  return c.json({ intake })
})
```

- [ ] **Step 6: Run API tests**

Run: `pnpm vitest run src/runtime/__tests__/serve-intake.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/intake.ts src/runtime/serve.ts src/runtime/__tests__/serve-intake.test.ts
git commit -m "feat: add request and pressure-test APIs"
```

### Task 4: Thread Projection

**Files:**
- Modify: `src/runtime/thread.ts`
- Test: `src/runtime/__tests__/thread.test.ts`

- [ ] **Step 1: Add Thread tests for pressure-test turns**

Add a test that writes a pressure-test intake JSON file and expects two visible turns:

```ts
it('projects active pressure-test intake as request and question turns', async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
  const memoryDir = path.join(projectPath, 'memory')
  await mkdir(path.join(memoryDir, 'pressure-test-intake'), { recursive: true })
  await writeFile(path.join(memoryDir, 'pressure-test-intake', 'pti-guildhall-0-8-0.json'), JSON.stringify({
    id: 'pti-guildhall-0-8-0',
    rawRequest: '0.8.0 should prioritize pressure-test intake.',
    target: { type: 'release', id: 'guildhall-0-8-0', title: 'Guildhall 0.8.0' },
    status: 'active',
    activeDomainId: 'product-goals',
    pendingQuestion: {
      id: 'product-goals-q-1',
      domainId: 'product-goals',
      prompt: 'What must Pressure-Test Intake get right first?',
      why: 'This decides the release slice.',
      evidence: [],
      askedAt: '2026-05-23T00:00:00.000Z',
    },
    domains: [],
    outputs: { assumptions: [], decisions: [], languageMapCandidates: [], taskSplitCandidates: [] },
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
  }))

  const thread = buildThread({ projectPath, snapshot: emptyProjectSnapshot(projectPath) })
  expect(thread.turns.find(t => t.id === 'request:pti-guildhall-0-8-0')).toMatchObject({
    kind: 'request',
    status: 'done',
  })
  expect(thread.turns.find(t => t.id === 'pressure-test:pti-guildhall-0-8-0:product-goals-q-1')).toMatchObject({
    kind: 'pressure_test_question',
    status: 'active',
  })
})
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm vitest run src/runtime/__tests__/thread.test.ts`

Expected: FAIL because `ThreadTurn` does not include request or pressure-test turns.

- [ ] **Step 3: Add turn types**

Add:

```ts
export interface RequestTurn extends TurnBase {
  kind: 'request'
  requestId: string
  rawRequest: string
  title: string
  routingSummary: string
}

export interface PressureTestQuestionTurn extends TurnBase {
  kind: 'pressure_test_question'
  intakeId: string
  targetTitle: string
  domainId: string
  domainTitle: string
  question: {
    id: string
    prompt: string
    why: string
    evidence: string[]
  }
  answerEndpoint: string
}
```

Extend `ThreadTurn` with both interfaces.

- [ ] **Step 4: Project pressure-test files**

Add a helper in `thread.ts`:

```ts
function pressureTestTurns(projectPath: string): ThreadTurn[] {
  const dir = join(projectPath, 'memory', 'pressure-test-intake')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .flatMap(name => {
      const raw = readJsonSafe(join(dir, name))
      const parsed = PressureTestIntake.safeParse(raw)
      if (!parsed.success) return []
      const intake = parsed.data
      const turns: ThreadTurn[] = [{
        kind: 'request',
        id: `request:${intake.id}`,
        requestId: intake.id,
        rawRequest: intake.rawRequest,
        title: intake.target.title,
        routingSummary: 'Routed to Pressure-Test Intake',
        at: intake.createdAt,
        persona: 'intake',
        status: 'done',
        phase: 'intake',
      }]
      if (intake.status === 'active' && intake.pendingQuestion) {
        const domain = intake.domains.find(d => d.id === intake.pendingQuestion?.domainId)
        turns.push({
          kind: 'pressure_test_question',
          id: `pressure-test:${intake.id}:${intake.pendingQuestion.id}`,
          intakeId: intake.id,
          targetTitle: intake.target.title,
          domainId: intake.pendingQuestion.domainId,
          domainTitle: domain?.title ?? intake.pendingQuestion.domainId,
          question: {
            id: intake.pendingQuestion.id,
            prompt: intake.pendingQuestion.prompt,
            why: intake.pendingQuestion.why,
            evidence: intake.pendingQuestion.evidence,
          },
          answerEndpoint: `/api/project/pressure-test/${encodeURIComponent(intake.id)}/answer`,
          at: intake.pendingQuestion.askedAt,
          persona: 'intake',
          status: 'active',
          phase: 'intake',
        })
      }
      return turns
    })
}
```

Sort these turns with the existing chronological thread list.

- [ ] **Step 5: Run Thread tests**

Run: `pnpm vitest run src/runtime/__tests__/thread.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/thread.ts src/runtime/__tests__/thread.test.ts
git commit -m "feat: project pressure-test intake in thread"
```

### Task 5: New Request UI

**Files:**
- Modify: `src/web/surfaces/IntakeModal.svelte`
- Modify: `src/web/surfaces/Header.svelte` if it contains "New task" button copy.
- Test: `src/web/surfaces/__tests__/IntakeModal.svelte.test.ts`

- [ ] **Step 1: Update UI tests**

Change the current create-task test to expect:

```ts
expect(screen.getByRole('heading', { name: 'New request' })).toBeInTheDocument()
await user.type(screen.getByLabelText('What do you want Guildhall to help with?'), 'For 0.8.0, pressure-test intake is my top priority.')
await user.click(screen.getByRole('button', { name: 'Send request' }))
expect(fetchMock).toHaveBeenCalledWith(
  expect.stringContaining('/api/project/request?projectId=looma-knit'),
  expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ ask: 'For 0.8.0, pressure-test intake is my top priority.' }),
  }),
)
```

- [ ] **Step 2: Run the failing UI test**

Run: `pnpm vitest run src/web/surfaces/__tests__/IntakeModal.svelte.test.ts`

Expected: FAIL because the modal still says New Task and posts to `/api/project/intake`.

- [ ] **Step 3: Update modal copy and endpoint**

Change:

```svelte
<h2 id="intake-title">New request</h2>
```

For non-bug requests, remove the visible Type select from the first screen. Keep bug filing available as a secondary affordance only if the current UI still needs it for stack traces.

Use:

```svelte
<label class="field">
  <span>What do you want Guildhall to help with?</span>
  <Textarea
    bind:value={ask}
    rows={5}
    placeholder="Describe the idea, task, question, release, or thing that feels stuck."
  />
</label>
```

Submit to:

```ts
const res = await projectFetch('/api/project/request', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
```

Button text:

```svelte
{busy ? 'Sending...' : 'Send request'}
```

- [ ] **Step 4: Run UI tests**

Run: `pnpm vitest run src/web/surfaces/__tests__/IntakeModal.svelte.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/surfaces/IntakeModal.svelte src/web/surfaces/__tests__/IntakeModal.svelte.test.ts
git commit -m "feat: make intake modal a new request surface"
```

### Task 6: Pressure-Test Thread Cards

**Files:**
- Modify: `src/web/surfaces/project/ThreadTab.svelte`
- Test: `src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts`

- [ ] **Step 1: Add rendering and answer tests**

Add a mocked `/api/project/thread` response containing a `pressure_test_question` turn. Assert:

```ts
expect(screen.getByText('Guildhall 0.8.0')).toBeInTheDocument()
expect(screen.getByText('What must Pressure-Test Intake get right first?')).toBeInTheDocument()
expect(screen.getByText('This decides the release slice.')).toBeInTheDocument()
await user.type(screen.getByLabelText('Your answer'), 'It must inspect repo evidence before asking me.')
await user.click(screen.getByRole('button', { name: 'Send answer' }))
expect(fetchMock).toHaveBeenCalledWith(
  expect.stringContaining('/api/project/pressure-test/pti-guildhall-0-8-0/answer'),
  expect.objectContaining({ method: 'POST' }),
)
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm vitest run src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts`

Expected: FAIL because the turn kind is not rendered.

- [ ] **Step 3: Extend local turn union**

Add `RequestTurn` and `PressureTestQuestionTurn` interfaces matching `src/runtime/thread.ts`.

- [ ] **Step 4: Render request and pressure-test cards**

Use existing `InteractionCardLayout`, `Textarea`, and `Button`. Keep the card narrow:

```svelte
{:else if turn.kind === 'pressure_test_question'}
  <InteractionCardLayout
    tone="active"
    title={turn.targetTitle}
    eyebrow={`Pressure-test intake - ${turn.domainTitle}`}
  >
    <Stack gap="3">
      <p class="question-prompt">{turn.question.prompt}</p>
      <p class="muted">{turn.question.why}</p>
      {#if turn.question.evidence.length}
        <details>
          <summary>Evidence Guildhall already checked</summary>
          <ul>
            {#each turn.question.evidence as item}
              <li>{item}</li>
            {/each}
          </ul>
        </details>
      {/if}
      <label class="field">
        <span>Your answer</span>
        <Textarea bind:value={pressureAnswers[turn.id]} rows={3} />
      </label>
      <Row justify="end">
        <Button variant="primary" disabled={busyTurnId === turn.id} onclick={() => answerPressureTest(turn)}>
          Send answer
        </Button>
      </Row>
    </Stack>
  </InteractionCardLayout>
```

- [ ] **Step 5: Add submit handler**

```ts
let pressureAnswers = $state<Record<string, string>>({})

async function answerPressureTest(turn: PressureTestQuestionTurn): Promise<void> {
  const answer = pressureAnswers[turn.id]?.trim()
  if (!answer) return
  busyTurnId = turn.id
  try {
    await scopedProjectFetch(turn.answerEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questionId: turn.question.id, answer }),
    })
    pressureAnswers[turn.id] = ''
    await loadThread()
    await refreshProject()
  } finally {
    busyTurnId = null
  }
}
```

- [ ] **Step 6: Run ThreadTab tests**

Run: `pnpm vitest run src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/surfaces/project/ThreadTab.svelte src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts
git commit -m "feat: render pressure-test intake in thread"
```

### Task 7: Spec-Agent Pressure-Test Contract

**Files:**
- Modify: `src/agents/spec-agent.ts`
- Test: `src/agents/__tests__/guildhall-agent.test.ts` or a new focused prompt snapshot test if prompt tests already exist there.

- [ ] **Step 1: Add prompt contract assertion**

Add a test that constructs the spec-agent prompt and asserts it contains:

```ts
expect(prompt).toContain('Pressure-Test Intake')
expect(prompt).toContain('ask exactly one question')
expect(prompt).toContain('producer self-critique')
expect(prompt).toContain('Transcript is evidence, not the planner')
```

- [ ] **Step 2: Run the failing prompt test**

Run: `pnpm vitest run src/agents/__tests__/guildhall-agent.test.ts`

Expected: FAIL until the prompt includes the pressure-test contract.

- [ ] **Step 3: Add the pressure-test operating section**

In `SPEC_AGENT_PROMPT`, add:

```md
## Pressure-Test Intake

When the task or injected context marks a target as `pressureTestIntake`, your job is discovery and pressure-testing, not fast spec drafting.

- Build or update the domain map before asking the user anything.
- Inspect repo, docs, Corpus Map, project memory, and accepted plans before asking.
- Ask exactly one user-facing question for the active domain.
- After an answer, run a producer self-critique: what was vague, contradictory, underexplored, or newly revealed?
- Stay in the same domain while useful follow-ups remain.
- Ask the closeout question before closing a domain.
- Update pressure-test state after every answer.
- Transcript is evidence, not the planner. The persisted pressure-test state decides the next question.
```

- [ ] **Step 4: Run prompt tests**

Run: `pnpm vitest run src/agents/__tests__/guildhall-agent.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/spec-agent.ts src/agents/__tests__/guildhall-agent.test.ts
git commit -m "feat: teach spec agent pressure-test intake"
```

### Task 8: Completion And Spec Output

**Files:**
- Modify: `src/runtime/pressure-test-intake.ts`
- Modify: `src/runtime/intake.ts`
- Test: `src/runtime/__tests__/pressure-test-intake.test.ts`

- [ ] **Step 1: Add completion tests**

```ts
it('completes intake into a spec-ready task payload when domains are closed', async () => {
  const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
  const intake = await createPressureTestIntake({
    memoryDir,
    target: { type: 'feature', id: 'request-intake', title: 'Request intake' },
    rawRequest: 'Make New request smart.',
  })

  const completed = await completePressureTestIntakeForTest({
    memoryDir,
    intakeId: intake.id,
    domainSummaries: {
      'product-goals': 'Users type one broad request and Guildhall routes it into the right flow.',
      workflows: 'Thread shows the request immediately, then asks one focused question.',
      risks: 'Do not batch giant questionnaires or hide routing decisions.',
    },
  })

  expect(completed.status).toBe('complete')
  expect(completed.outputs.assumptions).toContain('Deferred domains are explicit in the generated spec.')
  expect(renderPressureTestSpec(completed)).toContain('Acceptance Criteria')
})
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm vitest run src/runtime/__tests__/pressure-test-intake.test.ts`

Expected: FAIL because completion helpers do not exist.

- [ ] **Step 3: Implement completion renderer**

Add:

```ts
export function renderPressureTestSpec(intake: PressureTestIntake): string {
  const closed = intake.domains.filter(d => d.status === 'closed' || d.summary)
  const deferrals = intake.domains.filter(d => d.status === 'deferred')
  return [
    `# ${intake.target.title}`,
    '',
    '## Domain Coverage',
    ...closed.map(d => `- **${d.title}:** ${d.summary ?? 'Covered by intake.'}`),
    '',
    '## Assumptions And Deferrals',
    ...(deferrals.length ? deferrals.map(d => `- **${d.title}:** deferred`) : ['- No deferred domains.']),
    '',
    '## Acceptance Criteria',
    '- Given the accepted intake, when a worker starts implementation, then it can identify the user workflow, non-goals, risks, and verification path without guessing.',
    '- Given a reviewer inspects this work, when it checks the spec, then every pressure-tested domain is summarized or explicitly deferred.',
  ].join('\n')
}
```

- [ ] **Step 4: Connect completion to task creation**

Add a function that creates a `spec_review` task from the completed intake. The first version may be explicit API-driven; do not auto-create tasks while an intake still has active domains.

- [ ] **Step 5: Run completion tests**

Run: `pnpm vitest run src/runtime/__tests__/pressure-test-intake.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/pressure-test-intake.ts src/runtime/intake.ts src/runtime/__tests__/pressure-test-intake.test.ts
git commit -m "feat: produce specs from completed pressure-test intake"
```

### Task 9: Browser Proof On A Real Project

**Files:**
- Modify only if browser proof finds defects.
- Update: `artifact:flow-audit` through `.guildhall/artifacts.yaml` registry.

- [ ] **Step 1: Build and run Guildhall**

Run:

```bash
pnpm build
guildhall serve --port 7777 --project /Users/matthew/git/oss/narrative-harness
```

Expected: local service starts on `http://localhost:7777`.

- [ ] **Step 2: Browser-test New request**

Open `http://localhost:7777/projects/narrative-harness/thread`.

Submit this request exactly:

```text
For the next Narrative Harness milestone, pressure-test the fixture and evaluation harness before any implementation tasks are split.
```

Expected:

- The modal says `New request`.
- The request appears immediately in Thread.
- Guildhall routes it to Pressure-Test Intake.
- The first question is about a concrete domain, not a generic "what do you want?"
- The question explains why it matters and shows evidence if any was found.

- [ ] **Step 3: Answer with a vague quality bar**

Answer:

```text
It needs to be rigorous but not tedious.
```

Expected:

- The next question stays in the same domain.
- It asks for a concrete example or threshold.
- The pressure-test JSON state records the answered question.

- [ ] **Step 4: Record results in `artifact:flow-audit`**

Resolve `artifact:flow-audit` through `.guildhall/artifacts.yaml`, then add a dated checklist result under Current Follow-Ups. Include route, request text, outcome, and remaining blockers.

- [ ] **Step 5: Commit**

```bash
git add internal/audits/flow-audit.md
git commit -m "test: record pressure-test intake browser proof"
```

### Task 10: Full Verification

**Files:**
- All changed files.

- [ ] **Step 1: Run focused runtime tests**

Run:

```bash
pnpm vitest run \
  src/runtime/__tests__/request-routing.test.ts \
  src/runtime/__tests__/pressure-test-intake.test.ts \
  src/runtime/__tests__/serve-intake.test.ts \
  src/runtime/__tests__/thread.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused web tests**

Run:

```bash
pnpm vitest run \
  src/web/surfaces/__tests__/IntakeModal.svelte.test.ts \
  src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Run build**

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 5: Run browser regression**

Run: `pnpm test:ui`

Expected: PASS. If Playwright browsers are missing, run `pnpm test:ui:install` once, then rerun `pnpm test:ui`.

- [ ] **Step 6: Final commit**

```bash
git add src internal
git commit -m "feat: ship pressure-test intake foundation"
```

## Acceptance Criteria

- The primary project creation affordance reads `New request`.
- Ordinary concrete tasks still create existing exploring tasks.
- Release, feature, project, and high-ambiguity asks route to Pressure-Test Intake.
- Pressure-Test Intake persists domain state in `memory/pressure-test-intake/*.json`.
- Thread renders the raw request and the active pressure-test question from durable state.
- The intake loop asks one question at a time for the active domain.
- Vague answers trigger concrete follow-ups instead of prematurely closing the domain.
- Every question records why Guildhall is asking and what evidence it already has.
- Completed intake can render a spec with domain coverage, assumptions, deferrals, acceptance criteria, and verification expectations.
- Live browser testing proves the flow on the active target project named in `artifact:flow-audit`.

## Deferred From This Plan

- General user-authored practice/persona management.
- Long Thread detailed-history retention and compaction.
- Split-preview editing for multi-action requests beyond deterministic single-action routing.
- Podman project runtime implementation.
- Rich HTML artifact rendering for pressure-test plans.
- Model-backed routing. Deterministic routing should prove the product loop first.

## Self-Review

- Spec coverage: covers request routing, Pressure-Test Intake state, one-question loop, Thread cards, New request UI, spec output, and browser proof.
- Placeholder scan: no `TBD`, `TODO`, or unspecified "add tests" steps remain.
- Type consistency: `pressure_test_intake`, `PressureTestIntake`, `RequestTurn`, and `PressureTestQuestionTurn` are used consistently across runtime, API, and UI tasks.
