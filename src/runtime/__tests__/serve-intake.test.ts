import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace } from '@guildhall/config'
import { TaskQueue } from '@guildhall/core'
import { getProjectStateDir } from '@guildhall/sessions'
import { buildServeApp } from '../serve.js'

let tmpDir: string
let dataDir: string
let tasksPath: string
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
  tasksPath = path.join(getProjectStateDir(tmpDir), 'TASKS.json')
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(dataDir, { recursive: true, force: true })
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function readQueue(): Promise<TaskQueue> {
  const raw = await fs.readFile(tasksPath, 'utf-8')
  const parsed = JSON.parse(raw)
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
      body: JSON.stringify({ ask: 'For 0.8.0, pressure-test intake is my top priority.' }),
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
    })
    expect(body.pressureTestIntake?.pendingQuestion?.evidence?.some(evidence =>
      evidence.includes('README.md:') &&
      evidence.includes('rough owner intent') &&
      evidence.includes('verifiable work'),
    )).toBe(true)
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
        routingSummary: 'Routed to Task Intake',
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
        routingSummary: 'Routed to Task Intake',
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

  it('keeps project questions visible as routed project-question requests', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/request'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ask: 'What commands should I run before release?' }),
    }))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      routedActions?: Array<{ kind?: string; safety?: string; intakeTarget?: { nextStep?: string } }>
      taskId?: string
    }
    expect(body.routedActions?.[0]).toMatchObject({
      kind: 'project_question',
      safety: 'read-only',
      intakeTarget: { nextStep: 'answer-question' },
    })
    expect(body.taskId).toMatch(/^task-/)
    const queue = await readQueue()
    expect(queue.tasks[0]?.request).toMatchObject({
      kind: 'project_question',
      raw: 'What commands should I run before release?',
      routingSummary: 'Routed to Project Question',
    })
  })
})

describe('project check-in bounded chat endpoints', () => {
  it('starts and answers project check-in through bounded chat', async () => {
    await fs.writeFile(
      path.join(getProjectStateDir(tmpDir), 'project-brief.md'),
      [
        'Narrative Harness is fiction-writing software for building, drafting, and revising a coherent novel.',
        'The project includes author voice, reader knowledge, coherence reviewers, and quiet commercial editor direction.',
      ].join('\n'),
      'utf-8',
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
    expect(started.boundedChat?.subObjectives?.[0]?.prompt).toContain('Intake Test tasks')

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
        subObjectives?: Array<{ prompt?: string; followUpDepth?: number }>
      }
    }
    expect(answered.boundedChat?.status).toBe('waiting_for_owner')
    expect(answered.boundedChat?.subObjectives?.[0]).toMatchObject({
      followUpDepth: 1,
      prompt: 'Should reviewer-lane MVPs judge internal story coherence, reader engagement, author voice preservation, or all three?',
    })
  })

  it('reuses the same active project check-in session when reopened later', async () => {
    await fs.writeFile(
      path.join(getProjectStateDir(tmpDir), 'project-brief.md'),
      [
        'Narrative Harness is fiction-writing software for building, drafting, and revising a coherent novel.',
        'The project includes author voice, reader knowledge, coherence reviewers, and quiet commercial editor direction.',
        'The UI should feel quiet and commercially credible.',
      ].join('\n'),
      'utf-8',
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
        response: 'Reviewer-lane MVPs first, especially author voice and coherence reviewers. Save editor UX for later.',
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
    expect(reopened.boundedChat?.activeSubObjectiveId).toBe('visual-direction-mode')
  })

  it('closes project check-in with a persisted done receipt after the final answer', async () => {
    await fs.writeFile(
      path.join(getProjectStateDir(tmpDir), 'project-brief.md'),
      [
        'Narrative Harness is fiction-writing software for building, drafting, and revising a coherent novel.',
        'The project includes author voice, reader knowledge, coherence reviewers, and quiet commercial editor direction.',
        'The UI should feel quiet and commercially credible.',
      ].join('\n'),
      'utf-8',
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

    await app.fetch(new Request(projectUrl(`/api/project/bounded-chat/${encodeURIComponent(sessionId!)}/answer`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subObjectiveId,
        response: 'Reviewer-lane MVPs first, especially author voice and coherence reviewers. Save editor UX for later.',
      }),
    }))

    const finish = await app.fetch(new Request(projectUrl(`/api/project/bounded-chat/${encodeURIComponent(sessionId!)}/answer`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subObjectiveId: 'visual-direction-mode',
        response: 'Professional editorial tool.',
      }),
    }))

    expect(finish.status).toBe(200)
    const finished = await finish.json() as {
      boundedChat?: {
        status?: string
        closure?: { outcome?: string; summary?: string }
      }
    }
    expect(finished.boundedChat).toMatchObject({
      status: 'fulfilled',
      closure: {
        outcome: 'fulfilled',
        summary: 'Guildhall recorded the project check-in direction.',
      },
    })

    const persistedRaw = await fs.readFile(
      path.join(getProjectStateDir(tmpDir), 'bounded-chat', `${sessionId}.json`),
      'utf-8',
    )
    const persisted = JSON.parse(persistedRaw) as {
      acceptedState?: { decisions?: Array<{ decision: string }> }
      closure?: { outcome?: string; summary?: string }
    }
    expect(persisted.acceptedState?.decisions?.map(item => item.decision)).toEqual([
      'Reviewer-lane MVPs first, especially author voice and coherence reviewers. Save editor UX for later.',
      'Professional editorial tool.',
    ])
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
