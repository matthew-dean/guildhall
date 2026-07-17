import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { bootstrapWorkspace } from '@guildhall/config'
import {
  appendTaskEvidence,
  getProjectSystemStatePath,
  promoteProjectStateDatabaseAuthority,
} from '@guildhall/sessions'
import * as sessions from '@guildhall/sessions'
import { buildServeApp } from '../serve.js'
import { writeProjectTaskQueueWithSummary } from '../project-state-boundary.js'
import { writeProjectSummaryProjection } from '../project-summary-projection.js'

async function readProgress(root: string, projectId: string): Promise<string> {
  const { app } = buildServeApp({ projectPath: root })
  const response = await app.fetch(new Request(
    `http://localhost/api/project/progress?projectId=${encodeURIComponent(projectId)}`,
  ))
  expect(response.status).toBe(200)
  return ((await response.json()) as { progress: string }).progress
}

describe('GET /api/project/progress', () => {
  it('keeps the legacy PROGRESS.md read before promotion', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-progress-legacy-'))
    try {
      const workspace = bootstrapWorkspace(root, { name: 'Progress Legacy Test' })
      const progressPath = getProjectSystemStatePath(root, 'PROGRESS.md')
      await fs.mkdir(path.dirname(progressPath), { recursive: true })
      await fs.writeFile(
        progressPath,
        '# Progress\n\n### Worker blocked\nLegacy progress remains visible.\n---\n',
        'utf8',
      )

      const progress = await readProgress(root, workspace.id ?? 'progress-legacy-test')

      expect(progress).toContain('Legacy progress remains visible.')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('reads promoted progress from current database evidence instead of PROGRESS.md', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-progress-promoted-'))
    try {
      const workspace = bootstrapWorkspace(root, { name: 'Progress Promoted Test' })
      const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
      writeProjectTaskQueueWithSummary(tasksPath, {
        version: 1,
        lastUpdated: '2026-07-15T00:00:00.000Z',
        releases: [],
        tasks: [{ id: 'task-promoted', title: 'Promoted task', status: 'ready' }],
      }, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)
      const progressPath = getProjectSystemStatePath(root, 'PROGRESS.md')
      await fs.mkdir(path.dirname(progressPath), { recursive: true })
      await fs.writeFile(progressPath, '# Legacy progress\n\nStale legacy content.\n', 'utf8')
      await appendTaskEvidence(root, 'task-promoted', {
        id: 'note-promoted-progress',
        kind: 'note',
        recordedAt: '2026-07-15T00:01:00.000Z',
        payload: {
          agentId: 'mcp',
          role: 'evidence',
          content: 'Current database evidence is visible.',
          source: 'focused-test',
          timestamp: '2026-07-15T00:01:00.000Z',
        },
      })
      writeProjectSummaryProjection(tasksPath, {
        projectId: workspace.id,
        projectRoot: root,
        queue: {
          version: 1,
          lastUpdated: '2026-07-15T00:00:00.000Z',
          releases: [],
          tasks: [{ id: 'task-promoted', title: 'Promoted task', status: 'ready' }],
        },
      })

      const progress = await readProgress(root, workspace.id ?? 'progress-promoted-test')

      expect(progress).toContain('Current database evidence is visible.')
      expect(progress).not.toContain('Stale legacy content.')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('reports a stale promoted projection without rebuilding from the queue', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-progress-stale-'))
    try {
      const workspace = bootstrapWorkspace(root, { name: 'Progress Stale Projection Test' })
      const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
      writeProjectTaskQueueWithSummary(tasksPath, {
        version: 1,
        lastUpdated: '2026-07-15T00:00:00.000Z',
        releases: [],
        tasks: [{ id: 'task-missing-projection', title: 'Missing projection task', status: 'ready' }],
      }, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)
      const queueRead = vi.spyOn(sessions, 'readProjectStateDatabaseQueueDefinition').mockImplementation(() => {
        throw new Error('progress GET must not rebuild from the queue')
      })

      const { app } = buildServeApp({ projectPath: root })
      const response = await app.fetch(new Request(
        `http://localhost/api/project/progress?projectId=${encodeURIComponent(workspace.id ?? 'progress-stale-projection-test')}`,
      ))
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        progress: '',
        freshness: 'stale',
        requiresRefresh: true,
      })
      expect(queueRead).not.toHaveBeenCalled()
    } finally {
      vi.restoreAllMocks()
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
