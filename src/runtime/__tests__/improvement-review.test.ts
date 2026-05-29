import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { Task, TaskQueue } from '@guildhall/core'

import { reviewInProcessWorkForGuildhallImprovements } from '../improvement-review.js'

describe('Guildhall improvement review', () => {
  it('adds conservative advisory notes for active work touched by known Guildhall improvements', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-improvement-review-'))
    try {
      await writeQueue(memoryDir, [
        task({
          id: 'task-release-proof',
          title: 'Prepare release proof',
          description: 'Run browser smoke verification and capture release evidence.',
          status: 'in_progress',
        }),
        task({
          id: 'task-done-proof',
          title: 'Old proof task',
          description: 'Browser proof is already complete.',
          status: 'done',
        }),
      ])

      const result = await reviewInProcessWorkForGuildhallImprovements({
        memoryDir,
        now: () => '2026-05-29T12:00:00.000Z',
      })

      expect(result.notedTaskIds).toEqual(['task-release-proof'])
      const queue = await readQueue(memoryDir)
      const release = queue.tasks.find(candidate => candidate.id === 'task-release-proof')
      expect(release?.notes).toHaveLength(1)
      expect(release?.notes[0]).toMatchObject({
        agentId: 'guildhall-improvement-review',
        role: 'improvement-review',
      })
      expect(release?.notes[0]?.content).toContain('[guildhall-improvement-review:proof-path]')
      expect(queue.tasks.find(candidate => candidate.id === 'task-done-proof')?.notes).toHaveLength(0)
    } finally {
      await fs.rm(memoryDir, { recursive: true, force: true })
    }
  })

  it('keeps the pass idempotent and bounded', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-improvement-review-budget-'))
    try {
      await writeQueue(memoryDir, [
        task({ id: 'task-one', title: 'Runtime setup', description: 'Podman runtime mount setup.', status: 'ready' }),
        task({ id: 'task-two', title: 'Review update', description: 'Review rubric calibration update.', status: 'review' }),
        task({ id: 'task-three', title: 'Memory context', description: 'Refresh corpus map context.', status: 'ready' }),
      ])

      const first = await reviewInProcessWorkForGuildhallImprovements({
        memoryDir,
        maxTaskNotes: 2,
        maxDesignFindings: 0,
        now: () => '2026-05-29T12:00:00.000Z',
      })
      const second = await reviewInProcessWorkForGuildhallImprovements({
        memoryDir,
        maxTaskNotes: 2,
        maxDesignFindings: 0,
        now: () => '2026-05-29T12:01:00.000Z',
      })

      expect(first.notedTaskIds).toEqual(['task-one', 'task-two'])
      expect(second.notedTaskIds).toEqual(['task-three'])
      expect(second.skippedTaskIds).toEqual(['task-one', 'task-two'])
      const queue = await readQueue(memoryDir)
      expect(queue.tasks.flatMap(candidate => candidate.notes).filter(note => note.role === 'improvement-review')).toHaveLength(3)
    } finally {
      await fs.rm(memoryDir, { recursive: true, force: true })
    }
  })
})

async function writeQueue(memoryDir: string, tasks: Task[]): Promise<void> {
  const queue: TaskQueue = {
    version: 1,
    lastUpdated: '2026-05-29T12:00:00.000Z',
    tasks,
  }
  await fs.writeFile(path.join(memoryDir, 'TASKS.json'), JSON.stringify(queue, null, 2))
}

async function readQueue(memoryDir: string): Promise<TaskQueue> {
  return JSON.parse(await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf-8')) as TaskQueue
}

function task(overrides: Partial<Task> & Pick<Task, 'id' | 'title' | 'description' | 'status'>): Task {
  return {
    id: overrides.id,
    title: overrides.title,
    description: overrides.description,
    domain: overrides.domain ?? 'app',
    projectPath: overrides.projectPath ?? '/workspace/app',
    status: overrides.status,
    priority: overrides.priority ?? 'normal',
    spec: overrides.spec,
    acceptanceCriteria: overrides.acceptanceCriteria ?? [],
    outOfScope: overrides.outOfScope ?? [],
    dependsOn: overrides.dependsOn ?? [],
    notes: overrides.notes ?? [],
    gateResults: overrides.gateResults ?? [],
    reviewVerdicts: overrides.reviewVerdicts ?? [],
    adjudications: overrides.adjudications ?? [],
    revisionCount: overrides.revisionCount ?? 0,
    remediationAttempts: overrides.remediationAttempts ?? 0,
    escalations: overrides.escalations ?? [],
    agentIssues: overrides.agentIssues ?? [],
    origination: overrides.origination ?? 'human',
    createdAt: overrides.createdAt ?? '2026-05-29T12:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-05-29T12:00:00.000Z',
  }
}
