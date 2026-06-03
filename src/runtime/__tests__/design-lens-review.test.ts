import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { Task, TaskQueue } from '@guildhall/core'

import { readDesignFeedbackStore } from '../design-feedback.js'
import { reviewInProcessWorkForDesignLens } from '../design-lens-review.js'

describe('design lens review', () => {
  it('records recheck findings for in-process UI work and ignores terminal tasks', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-design-lens-review-'))
    try {
      await writeQueue(memoryDir, [
        task({
          id: 'task-ui-combobox',
          title: 'Improve account picker',
          description: 'Replace the long select list with a combobox and review the bespoke dropdown implementation.',
          status: 'in_progress',
        }),
        task({
          id: 'task-terminal-ui',
          title: 'Polish dashboard toolbar',
          description: 'UI toolbar cleanup.',
          status: 'done',
        }),
        task({
          id: 'task-backend',
          title: 'Tune cache eviction',
          description: 'Backend storage cleanup.',
          status: 'ready',
        }),
      ])

      const result = await reviewInProcessWorkForDesignLens({
        memoryDir,
        now: () => '2026-05-29T12:00:00.000Z',
      })

      expect(result.examinedTaskIds).toEqual(['task-ui-combobox'])
      expect(result.createdFindingIds).toEqual(['design-lens-review-task-ui-combobox'])
      const store = await readDesignFeedbackStore(memoryDir)
      expect(store.findings).toHaveLength(1)
      expect(store.findings[0]).toMatchObject({
        id: 'design-lens-review-task-ui-combobox',
        source: { kind: 'design-lens-review', artifactId: 'task:task-ui-combobox' },
        suggestedClassification: 'architecture-opportunity',
        classification: 'architecture-opportunity',
      })
      expect(store.findings[0]?.summary).toContain('semantic text hierarchy')
      expect(store.findings[0]?.summary).toContain('token or variant budget')
      expect(store.candidates[0]).toMatchObject({
        findingIds: ['design-lens-review-task-ui-combobox'],
        classification: 'architecture-opportunity',
      })
    } finally {
      await fs.rm(memoryDir, { recursive: true, force: true })
    }
  })

  it('is idempotent across repeated reviews', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-design-lens-review-repeat-'))
    try {
      await writeQueue(memoryDir, [
        task({
          id: 'task-layout',
          title: 'Normalize panel spacing',
          description: 'UI layout work should use design-system spacing primitives.',
          status: 'review',
        }),
      ])

      await reviewInProcessWorkForDesignLens({ memoryDir })
      const result = await reviewInProcessWorkForDesignLens({ memoryDir })

      expect(result.createdFindingIds).toEqual([])
      expect(result.skippedFindingIds).toEqual(['design-lens-review-task-layout'])
      const store = await readDesignFeedbackStore(memoryDir)
      expect(store.findings).toHaveLength(1)
      expect(store.candidates).toHaveLength(1)
    } finally {
      await fs.rm(memoryDir, { recursive: true, force: true })
    }
  })

  it('does not treat generated out-of-scope UI language as an in-scope design signal', async () => {
    const memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-design-lens-review-out-of-scope-'))
    try {
      await writeQueue(memoryDir, [
        task({
          id: 'task-policy-note',
          title: 'Append policy release note',
          description: 'Append one exact sentence to RELEASE_NOTES.md and do not edit any other file.',
          status: 'in_progress',
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
            'No browser surface is affected.',
          ].join('\n'),
          outOfScope: [
            'Any design system, UI, API, product surface, or CSS work.',
            'Browser surfaces are not applicable.',
          ],
          notes: [{
            agentId: 'run-automation',
            role: 'approver',
            content: 'Fully automated mode approved this spec after checking the generated out-of-scope boundaries.',
            timestamp: '2026-05-29T12:00:00.000Z',
          }],
        }),
      ])

      const result = await reviewInProcessWorkForDesignLens({
        memoryDir,
        now: () => '2026-05-29T12:00:00.000Z',
      })

      expect(result.examinedTaskIds).toEqual([])
      expect(result.createdFindingIds).toEqual([])
      const store = await readDesignFeedbackStore(memoryDir)
      expect(store.findings).toHaveLength(0)
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
