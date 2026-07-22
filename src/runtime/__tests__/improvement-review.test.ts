import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { Task, TaskQueue } from '@guildhall/core'
import {
  promoteProjectStateDatabaseAuthority,
  projectStatePathFromMemoryDir,
  readTaskEvidence,
} from '@guildhall/sessions'

import { reviewInProcessWorkForGuildhallImprovements } from '../improvement-review.js'
import {
  readProjectTaskQueueForMutationSync,
  readProjectTaskQueueSync,
  writeProjectTaskQueueWithSummary,
} from '../project-state-boundary.js'

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
          taskKind: 'verification',
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
      const evidence = await readTaskEvidence(memoryDir, 'task-release-proof', { kind: 'note' })
      expect(evidence).toHaveLength(1)
      expect(evidence[0]?.payload).toMatchObject({
        agentId: 'guildhall-improvement-review',
        role: 'improvement-review',
      })
      expect(evidence[0]?.payload.content).toContain('[guildhall-improvement-review:proof-path]')
      expect(await readTaskEvidence(memoryDir, 'task-done-proof', { kind: 'note' })).toHaveLength(0)
    } finally {
      await fs.rm(memoryDir, { recursive: true, force: true })
    }
  })

  it('keeps the pass idempotent and bounded', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-improvement-review-budget-'))
    try {
      await writeQueue(memoryDir, [
        task({ id: 'task-one', title: 'Runtime setup', description: 'Podman runtime mount setup.', status: 'ready', taskKind: 'verification' }),
        task({ id: 'task-two', title: 'Review update', description: 'Review rubric calibration update.', status: 'review', reviewRisk: { lanes: ['calibration_governance'], recipes: [], requiredArtifacts: [], artifactPolicy: 'advisory', assessedAt: '2026-05-29T12:00:00.000Z', assessedBy: 'test' } }),
        task({ id: 'task-three', title: 'Memory context', description: 'Refresh corpus map context.', status: 'ready', taskKind: 'learning' }),
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
      const evidence = await Promise.all(['task-one', 'task-two', 'task-three'].map(taskId =>
        readTaskEvidence(memoryDir, taskId, { kind: 'note' }),
      ))
      expect(evidence.flat().filter(event => event.payload.role === 'improvement-review')).toHaveLength(3)
    } finally {
      await fs.rm(memoryDir, { recursive: true, force: true })
    }
  })

  it('does not rewrite promoted task detail when recording an advisory note', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-improvement-review-db-'))
    try {
      await writeQueue(memoryDir, [
        task({
          id: 'task-db-proof',
          title: 'Prepare release proof',
          description: 'Run browser smoke verification and capture release evidence.',
          status: 'in_progress',
          taskKind: 'verification',
        }),
      ])

      await reviewInProcessWorkForGuildhallImprovements({
        memoryDir,
        maxDesignFindings: 0,
        now: () => '2026-05-29T12:00:00.000Z',
      })

      const tasksPath = projectStatePathFromMemoryDir(memoryDir, 'TASKS.json')
      const queue = readProjectTaskQueueForMutationSync(tasksPath).queue as TaskQueue
      expect(queue.tasks[0]?.notes.filter(note => note.role === 'improvement-review')).toEqual([])
      expect(await readTaskEvidence(memoryDir, 'task-db-proof', { kind: 'note' })).toEqual([
        expect.objectContaining({
          kind: 'note',
          payload: expect.objectContaining({ role: 'improvement-review' }),
        }),
      ])
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
  const tasksPath = projectStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  await fs.mkdir(path.dirname(tasksPath), { recursive: true })
  writeProjectTaskQueueWithSummary(tasksPath, queue, { projectRoot: memoryDir })
  promoteProjectStateDatabaseAuthority(memoryDir)
}

async function readQueue(memoryDir: string): Promise<TaskQueue> {
  return readProjectTaskQueueSync(projectStatePathFromMemoryDir(memoryDir, 'TASKS.json')) as TaskQueue
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
