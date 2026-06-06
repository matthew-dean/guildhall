import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  getProjectLocalHistoryDir,
  getProjectProgressHeartbeatsPath,
  getProjectStateDir,
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

describe('compactProjectState', () => {
  it('archives terminal tasks into sharded project files and keeps TASKS.json active-only', async () => {
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
