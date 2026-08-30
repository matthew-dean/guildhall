import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { Task } from '@guildhall/core'
import {
  promoteProjectStateDatabaseAuthority,
  readProjectStateDatabaseTaskPointWithRevision,
} from '@guildhall/sessions'

import { InMemoryGitDriver } from '../git-driver.js'
import { writeProjectTaskQueue } from '../project-state-boundary.js'
import { ensureAndRegisterTaskWorkspace } from '../task-workspace-registration.js'

let root: string
let tasksPath: string

function task(id = 'task-1'): Task {
  const now = '2026-08-09T00:00:00.000Z'
  return {
    id,
    title: 'Registered workspace',
    description: '',
    domain: 'core',
    projectPath: root,
    status: 'ready',
    priority: 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
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
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-workspace-registration-'))
  tasksPath = path.join(root, 'TASKS.json')
  writeProjectTaskQueue(tasksPath, {
    version: 1,
    lastUpdated: '2026-08-09T00:00:00.000Z',
    tasks: [task()],
  }, { projectRoot: root })
  promoteProjectStateDatabaseAuthority(root)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('ensureAndRegisterTaskWorkspace', () => {
  it('publishes the exact allocated workspace through the task handle', async () => {
    const driver = new InMemoryGitDriver()
    const result = await ensureAndRegisterTaskWorkspace({
      task: task(),
      mode: 'per_task',
      projectId: 'workspace-registration',
      projectPath: root,
      baseBranch: 'main',
      gitDriver: driver,
      tasksPath,
      stateProjectRoot: root,
      now: () => '2026-08-09T00:01:00.000Z',
    })

    const point = readProjectStateDatabaseTaskPointWithRevision(tasksPath, 'task-1')
    expect(result.created).toBe(true)
    expect(point?.overlay?.workspace?.payload).toEqual(result.workspace)
    expect(driver.state.removedWorktrees).toEqual([])
  })

  it('reuses the registered workspace after a fresh task read', async () => {
    const driver = new InMemoryGitDriver()
    const first = await ensureAndRegisterTaskWorkspace({
      task: task(),
      mode: 'per_task',
      projectId: 'workspace-registration',
      projectPath: root,
      baseBranch: 'main',
      gitDriver: driver,
      tasksPath,
      stateProjectRoot: root,
      now: () => '2026-08-09T00:01:00.000Z',
    })
    await fs.mkdir(first.worktreePath, { recursive: true })

    const restartedTask = { ...task(), ...first.workspace, workspace: first.workspace }
    const second = await ensureAndRegisterTaskWorkspace({
      task: restartedTask,
      mode: 'per_task',
      projectId: 'workspace-registration',
      projectPath: root,
      baseBranch: 'main',
      gitDriver: driver,
      tasksPath,
      stateProjectRoot: root,
      now: () => '2026-08-09T00:02:00.000Z',
    })

    expect(second.created).toBe(false)
    expect(second.workspace.workspaceAttemptId).toBe(first.workspace.workspaceAttemptId)
    expect(driver.state.createdWorktrees).toHaveLength(1)
  })

  it('removes a newly allocated worktree when registration cannot commit', async () => {
    const driver = new InMemoryGitDriver()
    await expect(ensureAndRegisterTaskWorkspace({
      task: task('missing-task'),
      mode: 'per_task',
      projectId: 'workspace-registration',
      projectPath: root,
      baseBranch: 'main',
      gitDriver: driver,
      tasksPath,
      stateProjectRoot: root,
      now: () => '2026-08-09T00:01:00.000Z',
    })).rejects.toThrow('Could not register promoted workspace')

    expect(driver.state.createdWorktrees).toHaveLength(1)
    expect(driver.state.removedWorktrees).toEqual([
      driver.state.createdWorktrees[0]!.worktreePath,
    ])
  })
})
