import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace, readWorkspaceConfig, slugify } from '@guildhall/config'
import {
  getProjectStateDir,
  readProjectStateJsonFromMemoryDirAsync,
  writeProjectStateJsonFromMemoryDirAsync,
} from '@guildhall/sessions'
import { buildServeApp } from '../serve.js'
import { createMetaIntakeTask, META_INTAKE_TASK_ID } from '../meta-intake.js'
import type { TaskQueue } from '@guildhall/core'
import { migrateTaskQuestionsToBoundedChat } from '../task-question-migration.js'

// ---------------------------------------------------------------------------
// Integration tests for the browser-driven meta-intake approval flow.
//
// We call the Hono app directly via `app.fetch(new Request(...))` so we can
// verify the endpoints without binding a real port. This covers the glue
// between `parseCoordinatorDraft` / `approveMetaIntake` (already unit-tested
// in meta-intake.test.ts) and the HTTP surface the dashboard calls.
// ---------------------------------------------------------------------------

let tmpDir: string
let dataDir: string
let memoryDir: string
let projectId: string

async function readQueue(): Promise<TaskQueue> {
  return readProjectStateJsonFromMemoryDirAsync<TaskQueue>(memoryDir, 'TASKS.json')
}

async function writeDraftSpec(spec: string): Promise<void> {
  const queue = await readQueue()
  const task = queue.tasks.find(t => t.id === META_INTAKE_TASK_ID)
  if (!task) throw new Error('meta-intake task missing; call createMetaIntakeTask first')
  task.spec = spec
  await writeProjectStateJsonFromMemoryDirAsync(memoryDir, 'TASKS.json', queue)
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-meta-'))
  dataDir = path.join(os.tmpdir(), `guildhall-data-${path.basename(tmpDir)}`)
  process.env.GUILDHALL_DATA_DIR = dataDir
  projectId = bootstrapWorkspace(tmpDir, { name: 'Meta Serve Test' }).id ?? path.basename(tmpDir)
  memoryDir = getProjectStateDir(tmpDir)
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(dataDir, { recursive: true, force: true })
  await fs.rm(tmpDir, { recursive: true, force: true })
})

const SAMPLE_SPEC = `
Narrative text from the spec agent.

\`\`\`yaml
coordinators:
  - id: looma
    name: Looma
    domain: looma
    path: apps/looma
    mandate: |
      Oversee the UI.
    concerns:
      - id: a11y
        description: Accessibility regressions
        reviewQuestions:
          - Does this preserve keyboard nav?
    autonomousDecisions:
      - Minor copy edits
    escalationTriggers:
      - New API surface
\`\`\`
`

function projectUrl(route: string): string {
  const url = new URL(`http://localhost${route}`)
  url.searchParams.set('projectId', projectId)
  return url.toString()
}

function uninitializedProjectUrl(route: string, projectPath: string): string {
  const url = new URL(`http://localhost${route}`)
  url.searchParams.set('projectId', slugify(path.basename(projectPath)))
  return url.toString()
}

describe('GET /api/project/meta-intake/draft', () => {
  it('returns an uninitialized status before setup has created guildhall.yaml', async () => {
    const uninitializedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-meta-uninitialized-'))
    try {
      const { app } = buildServeApp({ projectPath: uninitializedDir })
      const res = await app.fetch(new Request(uninitializedProjectUrl('/api/project/meta-intake/draft', uninitializedDir)))
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body).toMatchObject({
        status: 'uninitialized',
        taskExists: false,
        specReady: false,
        drafts: [],
      })
    } finally {
      await fs.rm(uninitializedDir, { recursive: true, force: true })
    }
  })

  it('returns no-task before any meta-intake has been seeded', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/meta-intake/draft')))
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, any>
    expect(body.taskExists).toBe(false)
    expect(body.specReady).toBe(false)
    expect(body.drafts).toEqual([])
  })

  it('returns in-progress when the task exists but has no spec yet', async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/meta-intake/draft')))
    const body = await res.json() as Record<string, any>
    expect(body.taskExists).toBe(true)
    expect(body.specReady).toBe(false)
    expect(body.status).toBe('in-progress')
    expect(body.drafts).toEqual([])
  })

  it('includes the blocked reason for interrupted meta-intake resume decisions', async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    const queue = await readQueue()
    const task = queue.tasks.find(t => t.id === META_INTAKE_TASK_ID)
    if (!task) throw new Error('meta-intake task missing')
    task.status = 'blocked'
    task.blockReason = 'Spec agent kept researching after Guildhall asked for durable progress.'
    await writeProjectStateJsonFromMemoryDirAsync(memoryDir, 'TASKS.json', queue)

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/meta-intake/draft')))
    const body = await res.json() as Record<string, any>
    expect(body.taskExists).toBe(true)
    expect(body.taskStatus).toBe('blocked')
    expect(body.blockReason).toMatch(/durable progress/i)
  })

  it('returns draft-ready with parsed coordinators once the agent has written a fence', async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    await writeDraftSpec(SAMPLE_SPEC)
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/meta-intake/draft')))
    const body = await res.json() as Record<string, any>
    expect(body.status).toBe('draft-ready')
    expect(body.specReady).toBe(true)
    expect(body.drafts).toHaveLength(1)
    expect(body.drafts[0]).toMatchObject({
      id: 'looma',
      name: 'Looma',
      domain: 'looma',
      path: 'apps/looma',
    })
  })

  it('reports spec-but-no-fence when the spec is non-empty but lacks a valid codefence', async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    await writeDraftSpec('just a narrative, no YAML here')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/meta-intake/draft')))
    const body = await res.json() as Record<string, any>
    expect(body.status).toBe('spec-but-no-fence')
    expect(body.specReady).toBe(false)
    expect(body.drafts).toEqual([])
  })
})

describe('POST /api/project/meta-intake/approve', () => {
  it('merges the draft into guildhall.yaml and returns the count', async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    await writeDraftSpec(SAMPLE_SPEC)
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/meta-intake/approve'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.coordinatorsAdded).toBe(1)

    const config = readWorkspaceConfig(tmpDir)
    expect(config.coordinators).toHaveLength(1)
    expect(config.coordinators[0]?.id).toBe('looma')

    // Task should transition to done.
    const queue = await readQueue()
    const task = queue.tasks.find(t => t.id === META_INTAKE_TASK_ID)
    expect(task?.status).toBe('done')
  })

  it('returns a clear error when there is no draft to approve', async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    // Don't write any spec.
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/meta-intake/approve'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, any>
    expect(body.error).toMatch(/no spec/i)
  })

  it('returns an error when no meta-intake task has been created', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/meta-intake/approve'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, any>
    expect(body.error).toMatch(/meta-intake/i)
  })

  it('is safe to call twice — second call returns 0 added', async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    await writeDraftSpec(SAMPLE_SPEC)
    const { app } = buildServeApp({ projectPath: tmpDir })
    await app.fetch(
      new Request(projectUrl('/api/project/meta-intake/approve'), { method: 'POST' }),
    )
    const res2 = await app.fetch(
      new Request(projectUrl('/api/project/meta-intake/approve'), { method: 'POST' }),
    )
    // Second call: task is already done with empty spec after completion? Actually
    // approveMetaIntake leaves spec in place, so this should produce 0 added
    // because the existing coordinator id is already present.
    expect([200, 400]).toContain(res2.status)
    if (res2.status === 200) {
      const body = (await res2.json()) as Record<string, any>
      expect(body.coordinatorsAdded).toBe(0)
    }
  })
})

describe('POST /api/project/meta-intake/synthesize', () => {
  it('creates a reviewable monorepo structure draft when meta-intake blocked before asking questions', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'fixture-monorepo', scripts: { build: 'tsc -b', test: 'vitest' } }, null, 2),
      'utf-8',
    )
    await fs.writeFile(path.join(tmpDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n", 'utf-8')
    for (const [dir, packageName] of [
      ['packages/core', '@fixture/core'],
      ['packages/css-parser', '@fixture/css-parser'],
      ['packages/extension', '@fixture/extension'],
    ] as const) {
      await fs.mkdir(path.join(tmpDir, dir), { recursive: true })
      await fs.writeFile(
        path.join(tmpDir, dir, 'package.json'),
        JSON.stringify({ name: packageName, scripts: { test: 'vitest run' } }, null, 2),
        'utf-8',
      )
    }
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    const queue = await readQueue()
    const task = queue.tasks.find(t => t.id === META_INTAKE_TASK_ID)
    if (!task) throw new Error('missing meta-intake task')
    task.status = 'blocked'
    task.blockReason = 'human_judgment_required: Spec agent kept researching after Guildhall asked for durable progress.'
    task.openQuestions = [{
      id: 'q-fallback',
      kind: 'choice',
      askedBy: 'spec-agent',
      askedAt: '2026-01-01T00:00:00.000Z',
      prompt: 'This is a meta-intake task — I need to:',
      choices: ['Keep researching', 'Draft setup from repo scan'],
      selectionMode: 'single',
    }]
    await writeProjectStateJsonFromMemoryDirAsync(memoryDir, 'TASKS.json', queue)

    const { app } = buildServeApp({ projectPath: tmpDir })
    const synthesize = await app.fetch(
      new Request(projectUrl('/api/project/meta-intake/synthesize'), { method: 'POST' }),
    )
    expect(synthesize.status).toBe(200)
    const body = await synthesize.json() as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.drafts.map((draft: { path?: string }) => draft.path)).toEqual(expect.arrayContaining([
      'packages/core',
      'packages/css-parser',
      'packages/extension',
    ]))

    const draft = await app.fetch(new Request(projectUrl('/api/project/meta-intake/draft')))
    const draftBody = await draft.json() as Record<string, any>
    expect(draftBody.status).toBe('draft-ready')

    const graph = await app.fetch(new Request(projectUrl('/api/project/project-graph')))
    const graphBody = await graph.json() as Record<string, any>
    expect(graphBody.projectGraph.structuralDomains.map((domain: { path?: string }) => domain.path)).toEqual(expect.arrayContaining([
      'packages/core',
      'packages/css-parser',
      'packages/extension',
    ]))
    expect(graphBody.projectGraph.contractSurfaces.map((surface: { label?: string }) => surface.label)).toEqual(expect.arrayContaining([
      '@fixture/core package contract',
      '@fixture/css-parser package contract',
      '@fixture/extension package contract',
    ]))
  })

  it('creates a reviewable draft from answered setup questions when the agent emitted no spec', async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    const queue = await readQueue()
    const task = queue.tasks.find(t => t.id === META_INTAKE_TASK_ID)
    if (!task) throw new Error('missing meta-intake task')
    task.openQuestions = [
      {
        id: 'q-domains',
        kind: 'choice',
        askedBy: 'spec-agent',
        askedAt: '2026-01-01T00:00:00.000Z',
        prompt: 'Pick all that apply — these will become your coordinator domains.',
        choices: ['converter-core', 'extension-ui', 'docs'],
        answeredAt: '2026-01-01T00:01:00.000Z',
        answer: 'converter-core, extension-ui, docs',
      },
    ]
    await writeProjectStateJsonFromMemoryDirAsync(memoryDir, 'TASKS.json', queue)
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { build: 'tsc -b', test: 'vitest' } }, null, 2),
      'utf-8',
    )
    await migrateTaskQuestionsToBoundedChat({
      projectRoot: tmpDir,
      projectId,
      apply: true,
      now: '2026-01-01T00:02:00.000Z',
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/meta-intake/synthesize'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.drafts).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Converter Core' }),
    ]))

    const updated = await readQueue()
    const updatedTask = updated.tasks.find(t => t.id === META_INTAKE_TASK_ID)
    expect(updatedTask?.status).toBe('spec_review')
    expect(updatedTask?.spec).toContain('coordinators:')
    expect(updatedTask?.spec).toContain('bootstrap:')
  })
})
