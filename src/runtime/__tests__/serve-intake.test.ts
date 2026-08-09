import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace } from '@guildhall/config'
import { TaskQueue } from '@guildhall/core'
import {
  getProjectStateDir,
  readProjectStateJsonAsync,
  readProjectStateTextAsync,
  writeProjectStateTextAsync,
} from '@guildhall/sessions'
import { buildServeApp } from '../serve.js'
import { materializeCompletedPressureTestIntake } from '../intake.js'
import {
  createPressureTestIntake,
  listPressureTestIntakes,
  loadPressureTestIntake,
  savePressureTestIntake,
} from '../pressure-test-intake.js'

let tmpDir: string
let dataDir: string
let projectId: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-intake-'))
  dataDir = path.join(os.tmpdir(), `guildhall-data-${path.basename(tmpDir)}`)
  process.env.GUILDHALL_DATA_DIR = dataDir
  projectId = bootstrapWorkspace(tmpDir, {
    name: 'Intake Test',
    coordinators: [
      {
        id: 'knit',
        name: 'Knit Coordinator',
        domain: 'knit',
        path: 'knit',
        mandate: '',
        concerns: [],
        autonomousDecisions: [],
        escalationTriggers: [],
      },
      {
        id: 'looma',
        name: 'Looma Coordinator',
        domain: 'looma',
        path: 'looma',
        mandate: '',
        concerns: [],
        autonomousDecisions: [],
        escalationTriggers: [],
      },
    ],
  }).id ?? path.basename(tmpDir)
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(dataDir, { recursive: true, force: true })
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function readQueue(): Promise<TaskQueue> {
  const parsed = await readProjectStateJsonAsync<unknown>(tmpDir, 'TASKS.json').catch((err: unknown) => {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: unknown }).code === 'ENOENT'
    ) {
      return {
        version: 1,
        lastUpdated: new Date().toISOString(),
        tasks: [],
      }
    }
    throw err
  })
  if (Array.isArray(parsed)) {
    return { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
  }
  return TaskQueue.parse(parsed)
}

function projectUrl(route: string): string {
  const url = new URL(`http://localhost${route}`)
  url.searchParams.set('projectId', projectId)
  return url.toString()
}

describe('POST /api/project/intake', () => {
  it('rejects empty intake asks before creating a task', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/intake'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ask: '   ' }),
    }))
    expect(res.status).toBe(400)
    const body = await res.json() as { error?: string }
    expect(body.error).toContain('Missing "ask"')

    const queue = await readQueue()
    expect(queue.tasks).toEqual([])
  })

  it('rejects intake when the project has no inferred coordinator domains yet', async () => {
    const bareDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-intake-bare-'))
    try {
      const bareProjectId = bootstrapWorkspace(bareDir, {
        name: 'Bare Intake',
        coordinators: [],
      }).id ?? path.basename(bareDir)
      const url = new URL('http://localhost/api/project/intake')
      url.searchParams.set('projectId', bareProjectId)

      const { app } = buildServeApp({ projectPath: bareDir })
      const res = await app.fetch(new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ask: 'Add starter tasks' }),
      }))

      expect(res.status).toBe(400)
      const body = await res.json() as { error?: string }
      expect(body.error).toContain('run repo inspection first')
    } finally {
      await fs.rm(bareDir, { recursive: true, force: true })
    }
  })

  it('uses the matching coordinator subproject for the requested domain', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/intake'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ask: 'Finish the auth callback redirect',
        domain: 'knit',
      }),
    }))
    expect(res.status).toBe(200)
    const queue = await readQueue()
    expect(queue.tasks[0]?.domain).toBe('knit')
    expect(queue.tasks[0]?.projectPath).toBe(path.join(tmpDir, 'knit'))
  })

  it('falls back to the first coordinator and its subproject path when domain is omitted', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/intake'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ask: 'Do the next thing',
      }),
    }))
    expect(res.status).toBe(200)
    const queue = await readQueue()
    expect(queue.tasks[0]?.domain).toBe('knit')
    expect(queue.tasks[0]?.projectPath).toBe(path.join(tmpDir, 'knit'))
  })
})

describe('POST /api/project/request', () => {
  it('returns an actionable 400 when a completed intake has no coordinator domain', async () => {
    const bareDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-pressure-intake-bare-'))
    try {
      const bareProjectId = bootstrapWorkspace(bareDir, {
        name: 'Bare Pressure Intake',
        coordinators: [],
      }).id ?? path.basename(bareDir)
      const memoryDir = getProjectStateDir(bareDir)
      const intake = await createPressureTestIntake({
        memoryDir,
        target: { type: 'release', id: 'desktop-release', title: 'Desktop release' },
        rawRequest: 'Create the next desktop release.',
      })
      for (const domain of intake.domains) domain.status = 'closed'
      const finalDomain = intake.domains.at(-1)!
      finalDomain.status = 'closeout'
      finalDomain.closeoutAsked = true
      intake.activeDomainId = finalDomain.id
      intake.pendingQuestion = {
        id: `${finalDomain.id}-closeout`,
        domainId: finalDomain.id,
        prompt: 'Anything else?',
        why: 'Close the final topic.',
        evidence: [],
        askedAt: new Date().toISOString(),
      }
      await savePressureTestIntake(memoryDir, intake)

      const url = new URL(`http://localhost/api/project/pressure-test/${intake.id}/answer`)
      url.searchParams.set('projectId', bareProjectId)
      const { app } = buildServeApp({ projectPath: bareDir })
      const response = await app.fetch(new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: intake.pendingQuestion.id, answer: 'No.' }),
      }))

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        code: 'coordinator_required',
        intake: { status: 'complete' },
      })
    } finally {
      await fs.rm(bareDir, { recursive: true, force: true })
    }
  })

  it('starts pressure-test intake for release ideas', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      '# Intake Test\n\nGuildhall should turn rough owner intent into complete, verifiable work without offloading routine decisions.',
      'utf-8',
    )
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/request'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ask: 'For 0.8.0, pressure-test intake is my top priority.',
        title: 'Guildhall 0.8.0',
      }),
    }))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      routedActions?: Array<{ kind?: string; intakeTarget?: { type?: string; pressureTestRequired?: boolean } }>
      pressureTestIntake?: {
        status?: string
        activeDomainId?: string
        pendingQuestion?: { evidence?: string[] }
      }
    }
    expect(body.routedActions?.[0]).toMatchObject({
      kind: 'pressure_test_intake',
      intakeTarget: { type: 'release', pressureTestRequired: true },
    })
    expect(body.pressureTestIntake).toMatchObject({
      status: 'active',
      activeDomainId: 'product-goals',
      target: { title: 'Guildhall 0.8.0' },
    })
    expect(body.pressureTestIntake?.pendingQuestion?.evidence?.some(evidence =>
      evidence.includes('README.md:') &&
      evidence.includes('rough owner intent') &&
      evidence.includes('verifiable work'),
    )).toBe(true)
  })

  it('keeps slug-equivalent release intakes distinct without overwriting the first request', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const create = (ask: string, title: string) => app.fetch(new Request(projectUrl('/api/project/request'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ask, title }),
    }))

    const firstResponse = await create('Create the first packaged desktop release.', 'Stage 2: Desktop UI')
    const secondResponse = await create('Create a separate follow-up desktop release.', 'Stage 2 - Desktop UI')

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    const first = (await firstResponse.json() as { pressureTestIntake: { id: string } }).pressureTestIntake
    const second = (await secondResponse.json() as { pressureTestIntake: { id: string } }).pressureTestIntake
    expect(first.id).toBe('pti-stage-2-desktop-ui')
    expect(second.id).toBe('pti-stage-2-desktop-ui-2')
    await expect(loadPressureTestIntake({ memoryDir: tmpDir, intakeId: first.id })).resolves.toMatchObject({
      rawRequest: 'Create the first packaged desktop release.',
    })
    await expect(loadPressureTestIntake({ memoryDir: tmpDir, intakeId: second.id })).resolves.toMatchObject({
      rawRequest: 'Create a separate follow-up desktop release.',
    })
  })

  it('returns the persisted release intake when the same creation request is retried', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const requestBody = {
      ask: 'Create the next packaged desktop release.',
      title: 'Stage 2: Desktop UI',
    }
    const create = () => app.fetch(new Request(projectUrl('/api/project/request'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    }))

    const [firstResponse, retryResponse] = await Promise.all([create(), create()])

    expect(firstResponse.status).toBe(200)
    expect(retryResponse.status).toBe(200)
    const first = (await firstResponse.json() as { pressureTestIntake: { id: string; createdAt: string } }).pressureTestIntake
    const retry = (await retryResponse.json() as { pressureTestIntake: { id: string; createdAt: string } }).pressureTestIntake
    expect(retry).toMatchObject({ id: first.id, createdAt: first.createdAt })
    expect(listPressureTestIntakes(tmpDir).map(intake => intake.id)).toEqual([
      'pti-stage-2-desktop-ui',
    ])
  })

  it('materializes a completed release intake once and hands Thread the new task', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const request = await app.fetch(new Request(projectUrl('/api/project/request'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ask: 'Create the next release as a packaged desktop UI over the shipped CLI.',
        title: 'Stage 2: Desktop UI',
      }),
    }))
    expect(request.status).toBe(200)
    let intake = (await request.json() as {
      pressureTestIntake: {
        id: string
        status: string
        pendingQuestion: { id: string } | null
        handoff?: { taskId: string }
      }
    }).pressureTestIntake
    let taskId: string | undefined

    for (let step = 0; intake.status !== 'complete' && step < 32; step += 1) {
      expect(intake.pendingQuestion).not.toBeNull()
      const questionId = intake.pendingQuestion!.id
      const response = await app.fetch(new Request(projectUrl(`/api/project/pressure-test/${intake.id}/answer`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          questionId,
          answer: questionId.endsWith('-closeout')
            ? 'No.'
            : 'Authors complete one packaged fixture run with typed artifact parity and visible recovery.',
        }),
      }))
      expect(response.status).toBe(200)
      const body = await response.json() as { intake: typeof intake; taskId?: string }
      intake = body.intake
      taskId = body.taskId ?? taskId
    }

    expect(intake.status).toBe('complete')
    expect(taskId).toBeTruthy()
    expect(intake.handoff).toEqual({ taskId, status: 'materialized', materializedAt: expect.any(String) })
    const queue = await readQueue()
    expect(queue.tasks).toHaveLength(1)
    expect(queue.tasks[0]).toMatchObject({
      id: taskId,
      title: 'Stage 2: Desktop UI',
      status: 'exploring',
      request: {
        id: expect.stringContaining(intake.id),
        routingSummary: 'Completed pressure-test intake',
      },
    })
    expect(queue.tasks[0]?.description).toContain('## Domain Coverage')

    const persistedIntake = await loadPressureTestIntake({ memoryDir: tmpDir, intakeId: intake.id })
    const retry = await materializeCompletedPressureTestIntake({
      memoryDir: tmpDir,
      intake: persistedIntake,
      domain: 'knit',
      projectPath: path.join(tmpDir, 'knit'),
    })
    expect(retry).toMatchObject({ taskId })
    expect((await readQueue()).tasks).toHaveLength(1)
  })

  it('converges concurrent completed-intake materialization on one task and one handoff', async () => {
    const created = await createPressureTestIntake({
      memoryDir: tmpDir,
      target: { type: 'release', id: 'concurrent-release', title: 'Concurrent release' },
      rawRequest: 'Create one release task even when completion requests overlap.',
    })
    created.status = 'complete'
    created.activeDomainId = null
    created.pendingQuestion = null
    await savePressureTestIntake(tmpDir, created)
    const first = await loadPressureTestIntake({ memoryDir: tmpDir, intakeId: created.id })
    const second = await loadPressureTestIntake({ memoryDir: tmpDir, intakeId: created.id })

    const results = await Promise.all([
      materializeCompletedPressureTestIntake({
        memoryDir: tmpDir,
        intake: first,
        domain: 'knit',
        projectPath: path.join(tmpDir, 'knit'),
      }),
      materializeCompletedPressureTestIntake({
        memoryDir: tmpDir,
        intake: second,
        domain: 'knit',
        projectPath: path.join(tmpDir, 'knit'),
      }),
    ])

    expect(results[0]?.taskId).toBeTruthy()
    expect(results[1]?.taskId).toBe(results[0]?.taskId)
    expect((await readQueue()).tasks).toHaveLength(1)
    await expect(loadPressureTestIntake({ memoryDir: tmpDir, intakeId: created.id })).resolves.toMatchObject({
      handoff: {
        status: 'materialized',
        taskId: results[0]?.taskId,
        materializedAt: expect.any(String),
      },
    })
  })

  it('reloads completed-intake state after acquiring the materialization lock', async () => {
    const created = await createPressureTestIntake({
      memoryDir: tmpDir,
      target: { type: 'release', id: 'stale-release', title: 'Stale release' },
      rawRequest: 'Do not materialize stale completion state.',
    })
    created.status = 'complete'
    created.activeDomainId = null
    created.pendingQuestion = null
    await savePressureTestIntake(tmpDir, created)
    const staleComplete = await loadPressureTestIntake({ memoryDir: tmpDir, intakeId: created.id })
    const current = await loadPressureTestIntake({ memoryDir: tmpDir, intakeId: created.id })
    current.status = 'paused'
    await savePressureTestIntake(tmpDir, current)

    await expect(materializeCompletedPressureTestIntake({
      memoryDir: tmpDir,
      intake: staleComplete,
      domain: 'knit',
      projectPath: path.join(tmpDir, 'knit'),
    })).resolves.toBeNull()

    expect((await readQueue()).tasks).toHaveLength(0)
    const persisted = await loadPressureTestIntake({ memoryDir: tmpDir, intakeId: created.id })
    expect(persisted.status).toBe('paused')
    expect(persisted.handoff).toBeUndefined()
  })

  it('starts bounded chat for ordinary task intake instead of creating work immediately', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/request'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ask: 'Add a loading spinner to Providers.' }),
    }))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      boundedChat?: {
        id?: string
        objective?: { kind?: string }
        subObjectives?: Array<{ id?: string; prompt?: string }>
      }
    }
    expect(body.boundedChat?.objective?.kind).toBe('new_request')
    expect(body.boundedChat?.subObjectives?.[0]).toMatchObject({
      id: 'request-shaping',
      prompt: 'Before Guildhall shapes this into work, what requirements, acceptance criteria, test expectations, or deliverables matter most?',
    })

    const queue = await readQueue()
    expect(queue.tasks).toEqual([])
  })

  it('stores ambiguous policy requests with an owner-facing clarifying question instead of inventing intent', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const ask = 'Set the FLL overhead charge policy and decide whether we should also apply it across the product.'
    const res = await app.fetch(new Request(projectUrl('/api/project/request'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ask }),
    }))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      boundedChat?: {
        id?: string
        objective?: { kind?: string }
        subObjectives?: Array<{ id?: string; prompt?: string; choices?: string[] }>
      }
    }
    expect(body.boundedChat?.objective?.kind).toBe('new_request')
    expect(body.boundedChat?.subObjectives?.[0]).toMatchObject({
      id: 'request-scope',
      prompt: 'Should Guildhall draft the FLL overhead policy first, or also turn it into linked implementation work?',
      choices: [
        'Draft the policy/spec first',
        'Draft the policy and create linked implementation tasks',
        'Apply the policy now',
      ],
    })

    const queue = await readQueue()
    expect(queue.tasks).toEqual([])
  })

  it('turns a bounded-chat New Request clarification into a shaped task and closes the session', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const ask = 'Set the FLL overhead charge policy and decide whether we should also apply it across the product.'
    const start = await app.fetch(new Request(projectUrl('/api/project/request'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ask }),
    }))
    const started = await start.json() as {
      boundedChat?: { id?: string; subObjectives?: Array<{ id?: string }> }
    }
    const sessionId = started.boundedChat?.id
    const subObjectiveId = started.boundedChat?.subObjectives?.[0]?.id
    expect(sessionId).toBeTruthy()
    expect(subObjectiveId).toBe('request-scope')

    const answer = await app.fetch(new Request(projectUrl(`/api/project/bounded-chat/${encodeURIComponent(sessionId!)}/answer`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subObjectiveId,
        response: 'Draft the policy/spec first.',
      }),
    }))

    expect(answer.status).toBe(200)
    const answered = await answer.json() as {
      boundedChat?: {
        status?: string
        closure?: { outcome?: string; summary?: string }
        acceptedState?: { decisions?: Array<{ decision?: string }> }
      }
    }
    expect(answered.boundedChat).toMatchObject({
      status: 'fulfilled',
      closure: {
        outcome: 'fulfilled',
        summary: 'Guildhall shaped the new request into runnable work.',
      },
    })
    expect(answered.boundedChat?.acceptedState?.decisions?.map(item => item.decision)).toEqual([
      'Draft the policy/spec first.',
    ])

    const queue = await readQueue()
    expect(queue.tasks).toHaveLength(1)
    expect(queue.tasks[0]).toMatchObject({
      description: ask,
      status: 'exploring',
      request: {
        kind: 'task_spec',
        raw: ask,
        routingSummary: 'This request is being shaped into a task brief.',
      },
      requestIntake: {
        intent: 'ambiguous_spec_or_implementation',
        recommendedNextAction: 'ask_clarifying_question',
      },
    })
    expect(queue.tasks[0]?.openQuestions ?? []).toEqual([])
  })

  it('turns a bounded-chat task request into shaped work only after the intake answer arrives', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const ask = 'Add a loading spinner to Providers.'
    const start = await app.fetch(new Request(projectUrl('/api/project/request'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ask }),
    }))
    const started = await start.json() as {
      boundedChat?: { id?: string; subObjectives?: Array<{ id?: string }> }
    }
    const sessionId = started.boundedChat?.id
    const subObjectiveId = started.boundedChat?.subObjectives?.[0]?.id
    expect(sessionId).toBeTruthy()
    expect(subObjectiveId).toBe('request-shaping')

    const answer = await app.fetch(new Request(projectUrl(`/api/project/bounded-chat/${encodeURIComponent(sessionId!)}/answer`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subObjectiveId,
        response: 'Keep it in the existing Providers header, show it while provider health is loading, verify with UI tests, and do not add a second spinner elsewhere.',
      }),
    }))

    expect(answer.status).toBe(200)
    const answered = await answer.json() as {
      boundedChat?: {
        status?: string
        closure?: { outcome?: string }
        acceptedState?: { decisions?: Array<{ decision?: string }> }
      }
    }
    expect(answered.boundedChat?.status).toBe('fulfilled')
    expect(answered.boundedChat?.closure?.outcome).toBe('fulfilled')
    expect(answered.boundedChat?.acceptedState?.decisions?.map(item => item.decision)).toEqual([
      'Keep it in the existing Providers header, show it while provider health is loading, verify with UI tests, and do not add a second spinner elsewhere.',
    ])

    const queue = await readQueue()
    expect(queue.tasks).toHaveLength(1)
    expect(queue.tasks[0]).toMatchObject({
      description: ask,
      status: 'exploring',
      request: {
        kind: 'task_spec',
        raw: ask,
        routingSummary: 'This request is being shaped into a task brief.',
      },
      requestIntake: {
        intent: 'implementation',
        recommendedNextAction: 'proceed_to_implementation_spec',
      },
    })
    expect(queue.tasks[0]?.openQuestions ?? []).toEqual([])
  })

  it('keeps a bounded-chat New Request open when the owner is confused', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const ask = 'Set the FLL overhead charge policy and decide whether we should also apply it across the product.'
    const start = await app.fetch(new Request(projectUrl('/api/project/request'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ask }),
    }))
    const started = await start.json() as {
      boundedChat?: { id?: string; subObjectives?: Array<{ id?: string }> }
    }
    const sessionId = started.boundedChat?.id

    const answer = await app.fetch(new Request(projectUrl(`/api/project/bounded-chat/${encodeURIComponent(sessionId!)}/answer`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subObjectiveId: 'request-scope',
        response: "I don't understand the nature of the question.",
      }),
    }))

    expect(answer.status).toBe(200)
    const answered = await answer.json() as {
      boundedChat?: {
        status?: string
        activeSubObjectiveId?: string
        acceptedState?: { discardedResponses?: Array<{ reason?: string }> }
      }
    }
    expect(answered.boundedChat).toMatchObject({
      status: 'waiting_for_owner',
      activeSubObjectiveId: 'request-scope',
    })
    expect(answered.boundedChat?.acceptedState?.discardedResponses?.[0]?.reason).toBe('confused')

    const queue = await readQueue()
    expect(queue.tasks).toEqual([])
  })

  it('keeps project questions as bounded-chat conversation threads instead of task requests', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/request'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ask: 'What commands should I run before release?' }),
    }))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      boundedChat?: {
        id?: string
        objective?: { label?: string }
        plannerState?: { newRequest?: { routedRequestKind?: string; routingSummary?: string } }
        subObjectives?: Array<{ id?: string; prompt?: string }>
      }
    }
    expect(body.boundedChat).toMatchObject({
      objective: { label: 'Answer a project question' },
      plannerState: {
        newRequest: {
          routedRequestKind: 'project_question',
          routingSummary: 'Saved as a project question.',
        },
      },
      subObjectives: [{
        id: 'project-question-context',
        prompt: 'Guildhall can answer this in Thread. Is there a source, task, or recent blocker it should use first?',
      }],
    })

    const answer = await app.fetch(new Request(projectUrl(`/api/project/bounded-chat/${encodeURIComponent(body.boundedChat?.id ?? '')}/answer`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subObjectiveId: 'project-question-context',
        response: 'Use the release task evidence.',
      }),
    }))
    expect(answer.status).toBe(200)
    const answered = await answer.json() as {
      boundedChat?: { status?: string; closure?: { summary?: string }; acceptedState?: { taskDrafts?: string[] } }
    }
    expect(answered.boundedChat).toMatchObject({
      status: 'fulfilled',
      closure: { summary: 'Guildhall kept this as a project question thread.' },
      acceptedState: { taskDrafts: [] },
    })

    const queue = await readQueue()
    expect(queue.tasks).toEqual([])
  })
})

describe('project check-in bounded chat endpoints', () => {
  it('starts and answers project check-in through bounded chat', async () => {
    await writeProjectStateTextAsync(
      tmpDir,
      'project-brief.md',
      [
        'Narrative Harness is fiction-writing software for building, drafting, and revising a coherent novel.',
        'The project includes author voice, reader knowledge, coherence reviewers, and quiet commercial editor direction.',
      ].join('\n'),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const start = await app.fetch(new Request(projectUrl('/api/project/project-check-in'), {
      method: 'POST',
    }))

    expect(start.status).toBe(200)
    const started = await start.json() as {
      boundedChat?: {
        id?: string
        objective?: { kind?: string }
        subObjectives?: Array<{ id?: string; prompt?: string }>
      }
    }
    expect(started.boundedChat?.objective?.kind).toBe('project_check_in')
    expect(started.boundedChat?.subObjectives?.[0]?.prompt).toContain('Intake Test')
    expect(started.boundedChat?.subObjectives?.[0]?.prompt).toContain('direction')

    const sessionId = started.boundedChat?.id
    const subObjectiveId = started.boundedChat?.subObjectives?.[0]?.id
    expect(sessionId).toBeTruthy()
    expect(subObjectiveId).toBeTruthy()

    const answer = await app.fetch(new Request(projectUrl(`/api/project/bounded-chat/${encodeURIComponent(sessionId!)}/answer`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subObjectiveId,
        response: 'Probably reviewer stuff, but only if it helps us know whether a novel is actually good.',
      }),
    }))

    expect(answer.status).toBe(200)
    const answered = await answer.json() as {
      boundedChat?: {
        status?: string
        closure?: { outcome?: string }
        acceptedState?: { decisions?: Array<{ decision?: string }> }
      }
    }
    expect(answered.boundedChat).toMatchObject({
      status: 'fulfilled',
      closure: { outcome: 'fulfilled' },
    })
    expect(answered.boundedChat?.acceptedState?.decisions?.map(item => item.decision)).toContain(
      'Probably reviewer stuff, but only if it helps us know whether a novel is actually good.',
    )
  })

  it('reuses the same active project check-in session when reopened later', async () => {
    await writeProjectStateTextAsync(
      tmpDir,
      'project-brief.md',
      [
        'Narrative Harness is fiction-writing software for building, drafting, and revising a coherent novel.',
        'The project includes author voice, reader knowledge, coherence reviewers, and quiet commercial editor direction.',
        'The UI should feel quiet and commercially credible.',
      ].join('\n'),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const start = await app.fetch(new Request(projectUrl('/api/project/project-check-in'), {
      method: 'POST',
    }))
    const started = await start.json() as {
      boundedChat?: { id?: string; subObjectives?: Array<{ id?: string }> }
    }
    const sessionId = started.boundedChat?.id
    const subObjectiveId = started.boundedChat?.subObjectives?.[0]?.id
    expect(sessionId).toBeTruthy()
    expect(subObjectiveId).toBeTruthy()

    await app.fetch(new Request(projectUrl(`/api/project/bounded-chat/${encodeURIComponent(sessionId!)}/answer`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subObjectiveId,
        response: "I don't understand the question yet.",
      }),
    }))

    const reopen = await app.fetch(new Request(projectUrl('/api/project/project-check-in'), {
      method: 'POST',
    }))
    expect(reopen.status).toBe(200)
    const reopened = await reopen.json() as {
      existing?: boolean
      boundedChat?: {
        id?: string
        activeSubObjectiveId?: string
      }
    }
    expect(reopened.existing).toBe(true)
    expect(reopened.boundedChat?.id).toBe(sessionId)
    expect(reopened.boundedChat?.activeSubObjectiveId).toBeTruthy()
  })

  it('closes project check-in with a persisted done receipt after the final answer', async () => {
    await writeProjectStateTextAsync(
      tmpDir,
      'project-brief.md',
      [
        'Narrative Harness is fiction-writing software for building, drafting, and revising a coherent novel.',
        'The project includes author voice, reader knowledge, coherence reviewers, and quiet commercial editor direction.',
        'The UI should feel quiet and commercially credible.',
      ].join('\n'),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const start = await app.fetch(new Request(projectUrl('/api/project/project-check-in'), {
      method: 'POST',
    }))
    const started = await start.json() as {
      boundedChat?: { id?: string; subObjectives?: Array<{ id?: string }> }
    }
    const sessionId = started.boundedChat?.id
    const subObjectiveId = started.boundedChat?.subObjectives?.[0]?.id

    let finished = started as {
      boundedChat?: {
        status?: string
        activeSubObjectiveId?: string
        subObjectives?: Array<{ id?: string; status?: string }>
        closure?: { outcome?: string; summary?: string }
      }
    }
    for (let step = 0; finished.boundedChat?.status !== 'fulfilled' && step < 8; step += 1) {
      const activeId = finished.boundedChat?.activeSubObjectiveId ??
        finished.boundedChat?.subObjectives?.find(item => item.status === 'active')?.id ??
        (step === 0 ? subObjectiveId : undefined)
      expect(activeId).toBeTruthy()
      const response = await app.fetch(new Request(projectUrl(`/api/project/bounded-chat/${encodeURIComponent(sessionId!)}/answer`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subObjectiveId: activeId,
          response: 'Prioritize author-voice and coherence review for the next release; use a quiet professional editorial-tool UI and defer broader editor workflows.',
        }),
      }))
      const body = await response.json() as typeof finished & { error?: string }
      expect(response.status, JSON.stringify(body)).toBe(200)
      finished = body
    }

    expect(finished.boundedChat).toMatchObject({
      status: 'fulfilled',
      closure: {
        outcome: 'fulfilled',
        summary: 'Guildhall recorded the project check-in direction.',
      },
    })

    const persistedRaw = await readProjectStateTextAsync(tmpDir, path.join('bounded-chat', `${sessionId}.json`))
    const persisted = JSON.parse(persistedRaw) as {
      acceptedState?: { decisions?: Array<{ decision: string }> }
      closure?: { outcome?: string; summary?: string }
    }
    expect(persisted.acceptedState?.decisions?.map(item => item.decision)).toContain(
      'Prioritize author-voice and coherence review for the next release; use a quiet professional editorial-tool UI and defer broader editor workflows.',
    )
    expect(persisted.closure).toMatchObject({
      outcome: 'fulfilled',
      summary: 'Guildhall recorded the project check-in direction.',
    })
  })
})

describe('GET /api/project/source-note', () => {
  it('returns a project-scoped source note for in-app preview', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'docs', 'PROJECT_STATE.md'), '# Project state\n\nKnown facts.')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/source-note?path=docs%2FPROJECT_STATE.md')))

    expect(res.status).toBe(200)
    const body = await res.json() as { displayPath?: string; content?: string; truncated?: boolean }
    expect(body.displayPath).toBe('docs/PROJECT_STATE.md')
    expect(body.content).toContain('# Project state')
    expect(body.content).toContain('Known facts.')
    expect(body.truncated).toBe(false)
  })

  it('renders directory source references as a bounded tree preview', async () => {
    await fs.mkdir(path.join(tmpDir, 'supabase', 'migrations'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'supabase', 'migrations', '001_initial.sql'), 'create table profiles(id uuid);')
    await fs.writeFile(path.join(tmpDir, 'supabase', 'migrations', '002_indexes.sql'), 'create index profiles_id_idx on profiles(id);')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/source-note?path=supabase%2Fmigrations')))

    expect(res.status).toBe(200)
    const body = await res.json() as { kind?: string; displayPath?: string; content?: string; truncated?: boolean }
    expect(body.kind).toBe('directory')
    expect(body.displayPath).toBe('supabase/migrations')
    expect(body.content).toContain('# Directory: supabase/migrations')
    expect(body.content).toContain('- 001_initial.sql')
    expect(body.content).toContain('- 002_indexes.sql')
    expect(body.truncated).toBe(false)
  })

  it('recovers moved source references by dropping stale leading path segments', async () => {
    await fs.mkdir(path.join(tmpDir, 'supabase', 'migrations'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'supabase', 'migrations', '001_initial.sql'), 'create table profiles(id uuid);')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/source-note?path=database%2Fsupabase%2Fmigrations')))

    expect(res.status).toBe(200)
    const body = await res.json() as { displayPath?: string; content?: string; kind?: string }
    expect(body.kind).toBe('directory')
    expect(body.displayPath).toBe('supabase/migrations')
    expect(body.content).toContain('Requested path: `database/supabase/migrations`')
    expect(body.content).toContain('Resolved current path: `supabase/migrations`')
  })

  it('returns a helpful missing-source preview with nearby files instead of a dead 404', async () => {
    await fs.mkdir(path.join(tmpDir, 'frontend', 'app', 'composables'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'frontend', 'app', 'composables', 'useSupabase.ts'), 'export const useSupabase = () => null')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/source-note?path=frontend%2Fapp%2Fcomposables%2FuseAuth.ts')))

    expect(res.status).toBe(200)
    const body = await res.json() as { missing?: boolean; displayPath?: string; content?: string }
    expect(body.missing).toBe(true)
    expect(body.displayPath).toBe('frontend/app/composables/useAuth.ts')
    expect(body.content).toContain('# Source not found: useAuth.ts')
    expect(body.content).toContain('- useSupabase.ts')
  })

  it('wraps code files in a language fence so previews render as code', async () => {
    await fs.mkdir(path.join(tmpDir, 'frontend', 'app', 'composables'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'frontend', 'app', 'composables', 'useSupabase.ts'), 'export const useSupabase = () => null')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/source-note?path=frontend%2Fapp%2Fcomposables%2FuseSupabase.ts')))

    expect(res.status).toBe(200)
    const body = await res.json() as { content?: string }
    expect(body.content).toContain('# File: frontend/app/composables/useSupabase.ts')
    expect(body.content).toContain('```ts')
    expect(body.content).toContain('export const useSupabase')
  })

  it('rejects source note paths outside the current project', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-source-outside-'))
    try {
      const outsidePath = path.join(outsideDir, 'secret.md')
      await fs.writeFile(outsidePath, 'not part of this project')
      const { app } = buildServeApp({ projectPath: tmpDir })

      const url = projectUrl(`/api/project/source-note?path=${encodeURIComponent(outsidePath)}`)
      const res = await app.fetch(new Request(url))

      expect(res.status).toBe(403)
      const body = await res.json() as { error?: string }
      expect(body.error).toContain('inside the project')
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })

  it('rejects source note symlinks that escape the current project', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-source-symlink-'))
    try {
      const outsidePath = path.join(outsideDir, 'secret.md')
      await fs.writeFile(outsidePath, 'not part of this project')
      await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true })
      await fs.symlink(outsidePath, path.join(tmpDir, 'docs', 'linked-secret.md'))
      const { app } = buildServeApp({ projectPath: tmpDir })

      const res = await app.fetch(new Request(projectUrl('/api/project/source-note?path=docs%2Flinked-secret.md')))

      expect(res.status).toBe(403)
      const body = await res.json() as { error?: string }
      expect(body.error).toContain('inside the project')
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })
})
