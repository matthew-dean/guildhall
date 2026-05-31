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

  it('does not add improvement-review notes only because run-once automation copy mentions review or handoff', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-improvement-review-automation-'))
    try {
      await writeQueue(memoryDir, [
        task({
          id: 'task-tiny',
          title: 'policy-note-patch',
          description: 'Append one exact sentence to STATUS_NOTE.md and do not edit any other file.',
          status: 'ready',
          notes: [{
            agentId: 'run-once',
            role: 'automation',
            content: [
              'Run-once automation policy: fully_automated.',
              'Requested proof mode: commands.',
              'This task was created through the scriptable run-once lane; normal Guildhall pressure-test, review, gate, and handoff rules still apply.',
            ].join('\n'),
            timestamp: '2026-05-29T12:00:00.000Z',
          }],
        }),
      ])

      const result = await reviewInProcessWorkForGuildhallImprovements({
        memoryDir,
        maxDesignFindings: 0,
        now: () => '2026-05-29T12:01:00.000Z',
      })

      expect(result.notedTaskIds).toEqual([])
      const queue = await readQueue(memoryDir)
      expect(queue.tasks[0]?.notes.filter(note => note.role === 'improvement-review')).toEqual([])
    } finally {
      await fs.rm(memoryDir, { recursive: true, force: true })
    }
  })

  it('does not add improvement-review notes only because generated bookkeeping mentions review boundaries', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-improvement-review-generated-'))
    try {
      await writeQueue(memoryDir, [
        task({
          id: 'task-policy-note',
          title: 'policy-note-patch',
          description: 'Append one exact sentence to RELEASE_NOTES.md and do not edit any other file.',
          status: 'ready',
          spec: [
            '# Spec',
            '',
            'Append the requested sentence to RELEASE_NOTES.md.',
            '',
            '## Out of Scope',
            '',
            '- Any design system, UI, API, product surface, or CSS work.',
            '',
            '## Security Review',
            '',
            'No browser, runtime, or release surface is affected.',
          ].join('\n'),
          outOfScope: [
            'Any design system, UI, API, product surface, or CSS work.',
            'No release process changes.',
          ],
          notes: [
            {
              agentId: 'run-once',
              role: 'automation',
              content: 'Run-once automation policy: fully_automated. Normal review and gate rules still apply.',
              timestamp: '2026-05-29T12:00:00.000Z',
            },
            {
              agentId: 'run-automation',
              role: 'approver',
              content: 'Fully automated mode approved this spec for implementation.',
              timestamp: '2026-05-29T12:00:00.000Z',
            },
            {
              agentId: 'blueprint-review',
              role: 'blueprint-review',
              content: 'Blueprint review found the task bounded enough for one artifact patch.',
              timestamp: '2026-05-29T12:00:00.000Z',
            },
          ],
        }),
      ])

      const result = await reviewInProcessWorkForGuildhallImprovements({
        memoryDir,
        maxDesignFindings: 0,
        now: () => '2026-05-29T12:01:00.000Z',
      })

      expect(result.notedTaskIds).toEqual([])
      const queue = await readQueue(memoryDir)
      expect(queue.tasks[0]?.notes.filter(note => note.role === 'improvement-review')).toEqual([])
    } finally {
      await fs.rm(memoryDir, { recursive: true, force: true })
    }
  })

  it('does not add improvement-review notes for a tiny artifact task only because its generated spec mentions handoff or review verification', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-improvement-review-handoff-'))
    try {
      await writeQueue(memoryDir, [
        task({
          id: 'task-release-note',
          title: 'policy-note-overreach',
          description: 'Append one exact sentence to RELEASE_NOTES.md and do not edit any other file.',
          status: 'ready',
          spec: [
            '## Summary',
            '',
            'Append the requested sentence to `RELEASE_NOTES.md`.',
            '',
            '## Acceptance Criteria',
            '',
            '1. **AC-01: Existing content preserved** — verified by review.',
            '',
            '## Handoff sequence',
            '',
            'Not needed — this is a single atomic edit.',
          ].join('\n'),
          acceptanceCriteria: [{
            id: 'AC-01',
            description: 'Existing content preserved.',
            verifiedBy: 'review',
            command: 'tail -1 RELEASE_NOTES.md',
            met: false,
          }],
          sizePlan: {
            taskId: 'task-release-note',
            score: 1,
            band: 'tiny',
            action: 'proceed',
            factors: [],
            recommendedChildren: [],
            reviewBudgetHint: 'lean',
            reasons: ['Single command-backed artifact patch.'],
            createdAt: '2026-05-29T12:00:00.000Z',
            createdBy: 'test',
          },
        }),
      ])

      const result = await reviewInProcessWorkForGuildhallImprovements({
        memoryDir,
        maxDesignFindings: 0,
        now: () => '2026-05-29T12:01:00.000Z',
      })

      expect(result.notedTaskIds).toEqual([])
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
