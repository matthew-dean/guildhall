import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  appendTaskEvidence,
  readTaskEvidence,
  readTaskRuntimeStore,
  readTaskWorkspaceStore,
  runtimeStatePath,
  taskEvidencePath,
  taskWorkspaceStatePath,
  upsertTaskRuntimeState,
  upsertTaskWorkspaceState,
} from '../task-state-store.js'
import { getProjectLocalHistoryDir, getProjectTaskLocalHistoryDir } from '@guildhall/sessions'

describe('task state store', () => {
  it('stores runtime state in system-local project history', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-state-'))

    await upsertTaskRuntimeState(projectRoot, 'task-1', {
      assignedTo: 'worker-agent',
      revisionCount: 2,
      updatedAt: '2026-05-24T20:00:00.000Z',
    })

    expect(runtimeStatePath(projectRoot)).toBe(path.join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'tasks.json'))
    const store = await readTaskRuntimeStore(projectRoot)
    expect(store.tasks['task-1']).toMatchObject({
      taskId: 'task-1',
      assignedTo: 'worker-agent',
      revisionCount: 2,
    })
  })

  it('stores task workspaces separately from task definitions', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-workspace-'))

    await upsertTaskWorkspaceState(projectRoot, 'task-1', {
      worktreePath: '~/.guildhall/worktrees/demo/task-1',
      branchName: 'guildhall/task-1',
      baseBranch: 'main',
      updatedAt: '2026-05-24T20:00:00.000Z',
    })

    expect(taskWorkspaceStatePath(projectRoot)).toBe(path.join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'task-workspaces.json'))
    const store = await readTaskWorkspaceStore(projectRoot)
    expect(store.workspaces['task-1']).toMatchObject({
      taskId: 'task-1',
      worktreePath: '~/.guildhall/worktrees/demo/task-1',
      branchName: 'guildhall/task-1',
      baseBranch: 'main',
    })
  })

  it('appends task evidence under the system-local task history directory', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-evidence-'))

    await appendTaskEvidence(projectRoot, 'task-1', {
      id: 'note-1',
      kind: 'note',
      recordedAt: '2026-05-24T20:00:00.000Z',
      payload: {
        agentId: 'worker-agent',
        role: 'worker',
        content: 'Implemented the thing.',
        timestamp: '2026-05-24T20:00:00.000Z',
      },
    })

    expect(taskEvidencePath(projectRoot, 'task-1', 'note')).toBe(path.join(getProjectTaskLocalHistoryDir(projectRoot, 'task-1'), 'notes.jsonl'))
    const events = await readTaskEvidence(projectRoot, 'task-1', { kind: 'note' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      id: 'note-1',
      taskId: 'task-1',
      kind: 'note',
      payload: {
        content: 'Implemented the thing.',
      },
    })
  })
})
