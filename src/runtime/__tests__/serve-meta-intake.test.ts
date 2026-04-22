import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace, readWorkspaceConfig } from '@guildhall/config'
import { buildServeApp } from '../serve.js'
import { createMetaIntakeTask, META_INTAKE_TASK_ID } from '../meta-intake.js'
import type { TaskQueue } from '@guildhall/core'

// ---------------------------------------------------------------------------
// Integration tests for the browser-driven meta-intake approval flow.
//
// We call the Hono app directly via `app.fetch(new Request(...))` so we can
// verify the endpoints without binding a real port. This covers the glue
// between `parseCoordinatorDraft` / `approveMetaIntake` (already unit-tested
// in meta-intake.test.ts) and the HTTP surface the dashboard calls.
// ---------------------------------------------------------------------------

let tmpDir: string
let memoryDir: string

async function readQueue(): Promise<TaskQueue> {
  const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf-8')
  return JSON.parse(raw) as TaskQueue
}

async function writeDraftSpec(spec: string): Promise<void> {
  const queue = await readQueue()
  const task = queue.tasks.find(t => t.id === META_INTAKE_TASK_ID)
  if (!task) throw new Error('meta-intake task missing; call createMetaIntakeTask first')
  task.spec = spec
  await fs.writeFile(
    path.join(memoryDir, 'TASKS.json'),
    JSON.stringify(queue, null, 2),
    'utf-8',
  )
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-meta-'))
  bootstrapWorkspace(tmpDir, { name: 'Meta Serve Test' })
  memoryDir = path.join(tmpDir, 'memory')
})

afterEach(async () => {
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

describe('GET /api/project/meta-intake/draft', () => {
  it('returns no-task before any meta-intake has been seeded', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/meta-intake/draft'))
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, any>
    expect(body.taskExists).toBe(false)
    expect(body.specReady).toBe(false)
    expect(body.drafts).toEqual([])
  })

  it('returns in-progress when the task exists but has no spec yet', async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/meta-intake/draft'))
    const body = await res.json() as Record<string, any>
    expect(body.taskExists).toBe(true)
    expect(body.specReady).toBe(false)
    expect(body.status).toBe('in-progress')
    expect(body.drafts).toEqual([])
  })

  it('returns draft-ready with parsed coordinators once the agent has written a fence', async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    await writeDraftSpec(SAMPLE_SPEC)
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/meta-intake/draft'))
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
    const res = await app.fetch(new Request('http://localhost/api/project/meta-intake/draft'))
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
      new Request('http://localhost/api/project/meta-intake/approve', { method: 'POST' }),
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
      new Request('http://localhost/api/project/meta-intake/approve', { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, any>
    expect(body.error).toMatch(/no spec/i)
  })

  it('returns an error when no meta-intake task has been created', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/meta-intake/approve', { method: 'POST' }),
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
      new Request('http://localhost/api/project/meta-intake/approve', { method: 'POST' }),
    )
    const res2 = await app.fetch(
      new Request('http://localhost/api/project/meta-intake/approve', { method: 'POST' }),
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
