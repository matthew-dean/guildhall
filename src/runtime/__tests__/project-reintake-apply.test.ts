import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  applyProjectReintakeDraft,
  planProjectReintake,
  writeProjectReintakeDraft,
} from '../project-reintake.js'

const now = '2026-05-30T20:00:00.000Z'

function task(overrides: Record<string, unknown>) {
  return {
    id: 'task-1',
    title: 'Task',
    description: '',
    domain: 'core',
    projectPath: '/workspace',
    status: 'import_draft',
    priority: 'normal',
    dependsOn: [],
    outOfScope: [],
    acceptanceCriteria: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

async function makeState(tasks: unknown[]) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-reintake-'))
  await fs.writeFile(path.join(dir, 'TASKS.json'), JSON.stringify({ version: 1, lastUpdated: now, tasks }, null, 2))
  await fs.writeFile(path.join(dir, 'PROGRESS.md'), '# Progress\n')
  return dir
}

const loomaAudit = [
  '# Component audit',
  '',
  '| Deliverable | Need | Foundation | Consumer |',
  '| --- | --- | --- | --- |',
  '| Dialog | shipped as `ui-dialog` | native dialog + overlay manager | Knit BaseDialog already uses it |',
  '| AlertDialog | missing P0 gap | builds on Dialog and Button | Knit destructive confirmation flow |',
].join('\n')

describe('project re-intake apply', () => {
  it('applies reframes in place and appends a re-intake note', async () => {
    const memoryDir = await makeState([
      task({ id: 'task-039', title: 'Build AlertDialog primitive', description: 'Old', status: 'blocked' }),
    ])
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'looma/docs/component-library-audit.md', content: loomaAudit }],
      tasks: [task({ id: 'task-039', title: 'Build AlertDialog primitive', description: 'Old', status: 'blocked' })],
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result).toMatchObject({ success: true, appliedGroups: 1 })

    const queue = JSON.parse(await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf-8'))
    const reframed = queue.tasks.find((candidate: { id?: string }) => candidate.id === 'task-039')
    expect(reframed).toMatchObject({
      title: 'Build AlertDialog',
      status: 'import_draft',
      acceptanceCriteria: expect.arrayContaining([expect.objectContaining({ id: 'source-implementation' })]),
    })
    expect(reframed.notes.some((note: { content?: string }) => note.content?.includes('Re-intake reframed this task'))).toBe(true)
  })

  it('shelves stale weak pre-implementation specs instead of carrying them forward', async () => {
    const legacyTask = task({
      id: 'task-tooltip',
      title: 'Build Tooltip primitive',
      status: 'ready',
      productBrief: {
        userJob: 'Ship Tooltip.',
        successMetric: 'Tooltip is reviewable.',
      },
      spec: '## Summary\nBuild Tooltip.\n\n## Acceptance Criteria\n- The feature is reviewable.',
      acceptanceCriteria: [{ id: 'legacy', description: 'Feature is reviewable.', verifiedBy: 'review', met: false }],
    })
    const memoryDir = await makeState([legacyTask])
    const draft = planProjectReintake({
      now,
      sources: [],
      tasks: [legacyTask],
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result.success).toBe(true)

    const queue = JSON.parse(await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf-8'))
    expect(queue.tasks.find((candidate: { id?: string }) => candidate.id === 'task-tooltip')).toMatchObject({
      status: 'shelved',
      shelveReason: expect.objectContaining({
        code: 'no_op',
        detail: expect.stringContaining('weak legacy spec shape'),
      }),
    })
  })

  it('archives without deleting and creates graph tasks with dependency proof fields', async () => {
    const memoryDir = await makeState([
      task({ id: 'task-old', title: 'Retry project discovery update', status: 'blocked' }),
    ])
    const existingTasks = [task({ id: 'task-old', title: 'Retry project discovery update', status: 'blocked' })]
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'looma/docs/component-library-audit.md', content: loomaAudit }],
      tasks: existingTasks,
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result.success).toBe(true)

    const queue = JSON.parse(await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf-8'))
    expect(queue.tasks.find((candidate: { id?: string }) => candidate.id === 'task-old')).toMatchObject({
      status: 'shelved',
      shelveReason: expect.objectContaining({ code: 'no_op', source: 'policy' }),
    })
    expect(queue.tasks.find((candidate: { id?: string }) => candidate.id === 'task-alert-dialog-integration')).toMatchObject({
      dependsOn: ['task-alert-dialog'],
      acceptanceCriteria: expect.arrayContaining([expect.objectContaining({ id: 'integration-regression-test' })]),
      proofPaths: expect.arrayContaining([expect.objectContaining({ kind: 'browser' })]),
    })
  })

  it('applies only selected groups', async () => {
    const memoryDir = await makeState([
      task({ id: 'task-old', title: 'Retry project discovery update', status: 'blocked' }),
    ])
    const existingTasks = [task({ id: 'task-old', title: 'Retry project discovery update', status: 'blocked' })]
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'looma/docs/component-library-audit.md', content: loomaAudit }],
      tasks: existingTasks,
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, selectedGroupIds: ['archive-unsupported'], now })
    expect(result).toMatchObject({ success: true, appliedGroups: 1 })

    const queue = JSON.parse(await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf-8'))
    expect(queue.tasks.some((candidate: { id?: string }) => candidate.id === 'task-alert-dialog')).toBe(false)
    expect(queue.tasks.find((candidate: { id?: string }) => candidate.id === 'task-old')?.status).toBe('shelved')
  })

  it('rejects apply when TASKS changed since draft creation', async () => {
    const memoryDir = await makeState([])
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'internal/notes/settings-copy.md', content: 'The settings footer says "Host-run" but should say "Runs on host" in src/web/surfaces/project/SettingsTab.svelte.' }],
      tasks: [],
    })
    await writeProjectReintakeDraft(memoryDir, draft)
    await fs.writeFile(path.join(memoryDir, 'TASKS.json'), JSON.stringify({ version: 1, lastUpdated: now, tasks: [task({ id: 'new-task' })] }, null, 2))

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('changed since the re-intake draft'),
    })
  })
})
