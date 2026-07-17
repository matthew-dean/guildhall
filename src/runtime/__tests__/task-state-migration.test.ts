import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Task } from '@guildhall/core'
import {
  getProjectLocalHistoryDir,
  getProjectSystemStatePath,
  promoteProjectStateDatabaseAuthority,
  writeProjectStateDatabaseSnapshot,
} from '@guildhall/sessions'
import { migrateTaskState } from '../task-state-migration.js'
import { readTaskEvidence, readTaskRuntimeStore, readTaskWorkspaceStore } from '../task-state-store.js'

function task(overrides: Partial<Task> = {}): Task {
  const now = '2026-05-24T20:00:00.000Z'
  return {
    id: 'task-auth-complete',
    title: 'Complete auth',
    description: 'Finish auth callback',
    domain: 'frontend',
    projectPath: 'frontend/',
    status: 'ready',
    priority: 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    notes: [{
      agentId: 'worker-agent',
      role: 'worker',
      content: 'Implemented auth callback.',
      timestamp: now,
    }],
    gateResults: [],
    reviewVerdicts: [{
      verdict: 'approve',
      reviewerPath: 'llm',
      reason: 'Approved',
      failingSignals: [],
      recordedAt: now,
    }],
    adjudications: [],
    escalations: [{
      id: 'esc-task-auth-complete-1',
      taskId: 'task-auth-complete',
      agentId: 'worker-agent',
      reason: 'decision_required',
      summary: 'Need verification',
      raisedAt: now,
      resolvedAt: '2026-05-24T21:00:00.000Z',
      resolvedBy: 'human',
      resolution: 'Try again',
    }],
    agentIssues: [],
    revisionCount: 6,
    remediationAttempts: 1,
    retryWindow: {
      startedAt: now,
      baseRevisionCount: 6,
    },
    worktreePath: '~/.guildhall/worktrees/fair-labor-license/task-auth-complete',
    branchName: 'guildhall/task-task-auth-complete',
    baseBranch: 'main',
    origination: 'human',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

async function seedProject(tasks: Task[]): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-migration-'))
  const stateDir = path.join(projectRoot, '.guildhall')
  await fs.mkdir(stateDir, { recursive: true })
  await fs.writeFile(
    path.join(stateDir, 'TASKS.json'),
    `${JSON.stringify({ version: 1, lastUpdated: '2026-05-24T20:00:00.000Z', tasks }, null, 2)}\n`,
    'utf-8',
  )
  return projectRoot
}

describe('migrateTaskState', () => {
  it('dry-runs without rewriting project task definitions', async () => {
    const projectRoot = await seedProject([task()])

    const result = await migrateTaskState({ projectRoot, apply: false })

    expect(result).toMatchObject({
      applied: false,
      tasksInspected: 1,
      runtimeRecords: 1,
      workspaceRecords: 1,
      evidenceRecords: 3,
      taskDefinitionsRewritten: 1,
    })
    const raw = await fs.readFile(path.join(projectRoot, '.guildhall', 'TASKS.json'), 'utf-8')
    expect(raw).toContain('reviewVerdicts')
    await expect(fs.stat(path.join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'tasks.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('applies idempotently and strips legacy fields after extracting evidence', async () => {
    const projectRoot = await seedProject([task()])

    const first = await migrateTaskState({ projectRoot, apply: true })
    const second = await migrateTaskState({ projectRoot, apply: true })

    expect(first.applied).toBe(true)
    expect(second.evidenceRecords).toBe(0)
    expect(first.manifestPath).toBe(`${first.backupPath}.manifest.json`)
    await expect(fs.readFile(first.manifestPath!, 'utf8')).resolves.toContain('0.8.0/task-state-split')
    const runtime = await readTaskRuntimeStore(projectRoot)
    expect(runtime.tasks['task-auth-complete']).toMatchObject({
      revisionCount: 6,
      remediationAttempts: 1,
    })
    const workspaces = await readTaskWorkspaceStore(projectRoot)
    expect(workspaces.workspaces['task-auth-complete']).toMatchObject({
      worktreePath: '~/.guildhall/worktrees/fair-labor-license/task-auth-complete',
      branchName: 'guildhall/task-task-auth-complete',
    })
    const evidence = await readTaskEvidence(projectRoot, 'task-auth-complete')
    expect(evidence).toHaveLength(3)
    expect(evidence.map((event) => event.kind)).toEqual(expect.arrayContaining(['note', 'review_verdict', 'escalation']))

    const raw = JSON.parse(await fs.readFile(path.join(projectRoot, '.guildhall', 'TASKS.json'), 'utf-8'))
    expect(raw.tasks[0]).not.toHaveProperty('reviewVerdicts')
    expect(raw.tasks[0]).not.toHaveProperty('worktreePath')
    expect(raw.tasks[0]).not.toHaveProperty('revisionCount')
    expect(raw.tasks[0]).toMatchObject({
      id: 'task-auth-complete',
      projectPath: 'frontend/',
    })
  })

  it('does not inspect or apply legacy state after SQLite promotion', async () => {
    const projectRoot = await seedProject([task()])
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await writeProjectStateDatabaseSnapshot(tasksPath, {
      projectRoot,
      queue: {
        version: 1,
        lastUpdated: '2026-07-15T12:00:00.000Z',
        tasks: [{ id: 'canonical-task', title: 'Canonical task', status: 'ready' }],
      },
      summary: { projectId: 'task-state-test', generatedAt: '2026-07-15T12:00:00.000Z' },
    })
    promoteProjectStateDatabaseAuthority(projectRoot)

    await expect(migrateTaskState({ projectRoot, apply: false })).resolves.toMatchObject({
      applied: false,
      tasksInspected: 0,
      taskDefinitionsRewritten: 0,
    })
    await expect(migrateTaskState({ projectRoot, apply: true }))
      .rejects.toThrow(/SQLite already owns current project state/)
  })
})
