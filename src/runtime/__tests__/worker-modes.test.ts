import { describe, expect, it } from 'vitest'
import { buildContext } from '../context-builder.js'
import { selectWorkerMode, modeEvidenceChecklist } from '../worker-modes.js'
import type { Task } from '@guildhall/core'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

function task(partial: Partial<Task>): Task {
  return {
    id: 'task-1',
    title: 'Fix failing Thread card test',
    description: 'The Thread card test is failing after request routing changed.',
    domain: 'web',
    projectPath: '/tmp/project',
    status: 'in_progress',
    priority: 'normal',
    acceptanceCriteria: [],
    dependsOn: [],
    outOfScope: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...partial,
  } as Task
}

describe('worker modes', () => {
  it('selects only the explicit structured execution mode', () => {
    expect(selectWorkerMode(task({ executionMode: 'diagnose', title: 'A lyrical unrelated title' }))).toMatchObject({
      id: 'diagnose',
      reason: expect.stringContaining('structured'),
    })
    expect(selectWorkerMode(task({ executionMode: 'tdd', title: 'A terse task' }))).toMatchObject({
      id: 'tdd',
      reason: expect.stringContaining('structured'),
    })
    expect(selectWorkerMode(task({ title: 'Debug failing provider setup', description: 'pnpm test fails with timeout' }))).toMatchObject({
      id: 'build',
    })
  })

  it('injects only the selected mode loop into worker context', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-worker-mode-'))
    const ctx = await buildContext(task({
      executionMode: 'tdd',
      title: 'Language Map extraction',
      description: 'Implement the accepted contract.',
    }), memoryDir)

    expect(ctx.workerMode?.id).toBe('tdd')
    expect(ctx.formatted).toContain('## Worker Mode: TDD')
    expect(ctx.formatted).toContain('Red: write or update the failing test first')
    expect(ctx.formatted).not.toContain('Diagnose loop')
  })

  it('exposes reviewer evidence checks for each mode', () => {
    expect(modeEvidenceChecklist('diagnose')).toContainEqual(expect.stringContaining('root cause'))
    expect(modeEvidenceChecklist('tdd')).toContainEqual(expect.stringContaining('red'))
    expect(modeEvidenceChecklist('build')).toContainEqual(expect.stringContaining('verification'))
  })
})
