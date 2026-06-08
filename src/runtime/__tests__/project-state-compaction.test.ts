import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  getProjectLocalHistoryDir,
  getProjectProgressHeartbeatsPath,
  getProjectStateDir,
  getProjectSystemStatePath,
  getProjectTaskLocalHistoryDir,
} from '@guildhall/sessions'
import { compactProjectState } from '../project-state-compaction.js'

let tmp: string
let projectRoot: string
let stateDir: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-state-'))
  process.env.GUILDHALL_DATA_DIR = path.join(tmp, 'data')
  projectRoot = path.join(tmp, 'project')
  stateDir = getProjectStateDir(projectRoot)
  await fs.mkdir(stateDir, { recursive: true })
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(tmp, { recursive: true, force: true })
})

async function optIntoThinRepoState(): Promise<void> {
  await fs.writeFile(path.join(projectRoot, 'guildhall.yaml'), [
    'name: Boundary Test',
    'id: boundary-test',
    'storage:',
    '  repoState: thin',
    '',
  ].join('\n'), 'utf8')
}

describe('compactProjectState', () => {
  it('evacuates and removes repo-local state when thin project state is not opted in', async () => {
    await fs.writeFile(path.join(projectRoot, 'guildhall.yaml'), [
      'name: Boundary Test',
      'id: boundary-test',
      'storage:',
      '  repoState: off',
      '',
    ].join('\n'), 'utf8')
    await fs.writeFile(path.join(stateDir, 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'task-active',
          status: 'blocked',
          title: 'Active but too bulky',
          notes: ['must leave the repo when not opted in'],
        },
      ],
    }, null, 2), 'utf8')
    await fs.writeFile(path.join(stateDir, 'PROGRESS.md'), '# Progress\n\nOld repo-local progress.\n', 'utf8')
    await fs.writeFile(path.join(stateDir, 'agent-settings.yaml'), 'version: 1\n', 'utf8')
    await fs.writeFile(path.join(stateDir, 'TASKS.before-0.10.0-task-hierarchy-links.json'), '{"tasks":[]}\n', 'utf8')
    await fs.writeFile(path.join(stateDir, 'config.yaml'), 'local: true\n', 'utf8')

    const result = await compactProjectState({ projectRoot, dryRun: false })

    expect(result.repoStateMode).toBe('off')
    expect(result.evacuatedProjectStatePaths).toEqual(expect.arrayContaining([
      'TASKS.json',
      'PROGRESS.md',
      'agent-settings.yaml',
      'TASKS.before-0.10.0-task-hierarchy-links.json',
      'config.yaml',
    ]))
    expect(result.forbiddenTaskFieldsBefore).toBe(1)
    expect(result.forbiddenTaskFieldsAfter).toBe(0)
    await expect(fs.stat(path.join(stateDir, 'TASKS.json'))).rejects.toThrow(/ENOENT/)
    await expect(fs.stat(path.join(stateDir, 'PROGRESS.md'))).rejects.toThrow(/ENOENT/)
    await expect(fs.stat(path.join(stateDir, 'agent-settings.yaml'))).rejects.toThrow(/ENOENT/)
    await expect(fs.stat(path.join(stateDir, 'TASKS.before-0.10.0-task-hierarchy-links.json'))).rejects.toThrow(/ENOENT/)
    await expect(fs.stat(stateDir)).rejects.toThrow(/ENOENT/)

    const evacuatedTaskQueue = await fs.readFile(
      path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'TASKS.json'),
      'utf8',
    )
    expect(evacuatedTaskQueue).toContain('must leave the repo when not opted in')
  })

  it('copies repo-local TASKS.json as-is into system-local project state before evacuation', async () => {
    await fs.writeFile(path.join(projectRoot, 'guildhall.yaml'), [
      'name: Boundary Test',
      'id: boundary-test',
      'storage:',
      '  repoState: off',
      '',
    ].join('\n'), 'utf8')
    await fs.writeFile(path.join(stateDir, 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'task-active',
          status: 'ready',
          title: 'Still needs work',
        },
        {
          id: 'task-done',
          status: 'done',
          title: 'Already finished',
        },
      ],
    }, null, 2), 'utf8')
    await fs.mkdir(path.join(stateDir, 'tasks', 'archive'), { recursive: true })
    await fs.writeFile(path.join(stateDir, 'tasks', 'index.json'), JSON.stringify({
      version: 1,
      activeTaskIds: ['task-active'],
      archivedTaskIds: ['task-done'],
    }, null, 2), 'utf8')
    await fs.writeFile(path.join(stateDir, 'tasks', 'archive', 'task-done.json'), JSON.stringify({
      id: 'task-done',
      status: 'done',
      title: 'Already finished',
      summary: 'Readable done task history.',
    }, null, 2), 'utf8')

    const result = await compactProjectState({ projectRoot, dryRun: false })

    expect(result.repoStateMode).toBe('off')
    await expect(fs.stat(path.join(stateDir, 'TASKS.json'))).rejects.toThrow(/ENOENT/)
    const systemQueue = JSON.parse(
      await fs.readFile(getProjectSystemStatePath(projectRoot, 'TASKS.json'), 'utf8'),
    ) as { tasks: Array<{ id: string; status: string }> }
    expect(systemQueue.tasks).toEqual([
      expect.objectContaining({ id: 'task-active', status: 'ready' }),
      expect.objectContaining({ id: 'task-done', status: 'done' }),
    ])
    await expect(fs.readFile(getProjectSystemStatePath(projectRoot, 'tasks/index.json'), 'utf8'))
      .resolves.toContain('task-done')
    await expect(fs.readFile(getProjectSystemStatePath(projectRoot, 'tasks/archive/task-done.json'), 'utf8'))
      .resolves.toContain('Readable done task history.')
  })

  it('allows repo-local apply cleanup when thin project state is explicitly opted in', async () => {
    await optIntoThinRepoState()
    await fs.writeFile(path.join(stateDir, 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'task-active',
          status: 'blocked',
          title: 'Active but too bulky',
          notes: ['can be moved to local history after opt in'],
        },
      ],
    }, null, 2), 'utf8')

    const result = await compactProjectState({ projectRoot, dryRun: false })

    expect(result.activeTasksSanitized).toBe(1)
    const projectQueue = await fs.readFile(path.join(stateDir, 'TASKS.json'), 'utf8')
    expect(projectQueue).not.toContain('can be moved to local history after opt in')
  })

  it('archives terminal tasks into sharded project files and keeps TASKS.json active-only', async () => {
    await optIntoThinRepoState()
    await fs.writeFile(path.join(stateDir, 'TASKS.json'), JSON.stringify({
      version: 1,
      lastUpdated: '2026-05-01T00:00:00.000Z',
      tasks: [
        {
          id: 'task-done',
          status: 'done',
          title: 'Finished task',
          notes: Array.from({ length: 50 }, (_, i) => `note ${i}`),
        },
        {
          id: 'task-active',
          status: 'blocked',
          title: 'Still shared and active',
        },
      ],
    }, null, 2), 'utf8')
    await fs.writeFile(path.join(stateDir, 'PROGRESS.md'), [
      '# Progress',
      '',
      '### 💓 HEARTBEAT — 2026-05-01T00:00:00Z',
      '**Agent:** worker | **Domain:** app',
      '',
      'Touched files.',
      '',
      '---',
      '',
      '### 🏁 MILESTONE — 2026-05-01T01:00:00Z',
      '**Agent:** worker | **Domain:** app',
      '',
      'Completed the useful summary.',
      '',
      '---',
      '',
    ].join('\n'), 'utf8')
    await fs.writeFile(path.join(stateDir, 'codebase-map.yaml'), [
      'version: 1',
      'project:',
      '  summary: Large fixture',
      'files:',
      ...Array.from({ length: 300 }, (_, i) => [
        `  file-${i}.ts:`,
        `    path: file-${i}.ts`,
        '    language: typescript',
        '    kind: source',
        `    summary: ${'x'.repeat(1000)}`,
      ].join('\n')),
    ].join('\n'), 'utf8')

    const result = await compactProjectState({ projectRoot, dryRun: false })

    expect(result.archivedTasks).toBe(1)
    expect(result.activeTasksKept).toBe(1)
    expect(result.archivedTaskFilesCompacted).toBe(0)
    expect(result.codebaseMapCompacted).toBe(true)
    expect(result.progressHeartbeatsMoved).toBe(1)

    const compactQueue = JSON.parse(await fs.readFile(path.join(stateDir, 'TASKS.json'), 'utf8')) as { tasks: Array<{ id: string }> }
    expect(compactQueue.tasks.map(task => task.id)).toEqual(['task-active'])

    const archived = await fs.readFile(path.join(stateDir, 'tasks', 'archive', 'task-done.json'), 'utf8')
    expect(archived).toContain('Finished task')
    expect(archived).toContain('note 49')
    expect(archived).toContain('archivedEvidence')
    expect(archived).not.toContain('note 0')
    const fullEvidence = await fs.readFile(
      path.join(getProjectTaskLocalHistoryDir(projectRoot, 'task-done'), 'archive-evidence.json'),
      'utf8',
    )
    expect(fullEvidence).toContain('note 0')
    expect(fullEvidence).toContain('note 49')

    const index = await fs.readFile(path.join(stateDir, 'tasks', 'index.json'), 'utf8')
    expect(index).toContain('task-active')
    expect(index).toContain('task-done')

    const progress = await fs.readFile(path.join(stateDir, 'PROGRESS.md'), 'utf8')
    expect(progress).toContain('MILESTONE')
    expect(progress).not.toContain('HEARTBEAT')

    const heartbeats = await fs.readFile(getProjectProgressHeartbeatsPath(projectRoot), 'utf8')
    expect(heartbeats).toContain('HEARTBEAT')
    expect(heartbeats).toContain('Touched files.')

    const compactCodebaseMap = await fs.readFile(path.join(stateDir, 'codebase-map.yaml'), 'utf8')
    expect(compactCodebaseMap).toContain('committedFileCount: 250')
    expect(compactCodebaseMap).not.toContain('file-299.ts')
    const fullCodebaseMap = await fs.readFile(
      path.join(getProjectLocalHistoryDir(projectRoot), 'codebase-map', 'codebase-map.full.yaml'),
      'utf8',
    )
    expect(fullCodebaseMap).toContain('file-299.ts')
  })

  it('sanitizes active task runtime and evidence fields while preserving removed evidence locally', async () => {
    await optIntoThinRepoState()
    await fs.writeFile(path.join(stateDir, 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'task-active',
          status: 'blocked',
          title: 'Active but too bulky',
          notes: Array.from({ length: 30 }, (_, index) => `note ${index}`),
          reviewVerdicts: Array.from({ length: 30 }, (_, index) => ({ reviewer: `reviewer-${index}`, ok: false })),
          gateResults: [{ command: 'pnpm test', ok: false }],
          worktreePath: '/tmp/worktree',
          branchName: 'guildhall/task-active',
          revisionCount: 4,
          escalations: [
            { id: 'open', status: 'open', title: 'Needs owner', summary: 'Owner credentials needed.' },
            { id: 'old', status: 'resolved', title: 'Resolved', summary: 'No longer relevant.' },
          ],
        },
      ],
    }, null, 2), 'utf8')

    const result = await compactProjectState({ projectRoot, dryRun: false })

    expect(result.activeTasksKept).toBe(1)
    expect(result.activeTasksSanitized).toBe(1)
    expect(result.forbiddenTaskFieldsBefore).toBeGreaterThan(0)
    expect(result.forbiddenTaskFieldsAfter).toBe(0)

    const compactQueue = JSON.parse(await fs.readFile(path.join(stateDir, 'TASKS.json'), 'utf8')) as {
      tasks: Array<Record<string, unknown>>
    }
    const active = compactQueue.tasks[0]
    expect(active).toMatchObject({
      id: 'task-active',
      status: 'blocked',
      title: 'Active but too bulky',
      openEscalations: [{ id: 'open', status: 'open', title: 'Needs owner', summary: 'Owner credentials needed.' }],
    })
    expect(active).not.toHaveProperty('notes')
    expect(active).not.toHaveProperty('reviewVerdicts')
    expect(active).not.toHaveProperty('gateResults')
    expect(active).not.toHaveProperty('worktreePath')
    expect(active).not.toHaveProperty('branchName')
    expect(active).not.toHaveProperty('revisionCount')
    expect(active).not.toHaveProperty('escalations')
    expect(JSON.stringify(active)).not.toContain('old')

    const removedEvidence = await fs.readFile(
      path.join(getProjectTaskLocalHistoryDir(projectRoot, 'task-active'), 'project-state-boundary-evidence.json'),
      'utf8',
    )
    expect(removedEvidence).toContain('note 0')
    expect(removedEvidence).toContain('reviewer-29')
    expect(removedEvidence).toContain('guildhall/task-active')
  })
})
