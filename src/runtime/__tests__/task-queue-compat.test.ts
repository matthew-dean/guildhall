import { describe, expect, it } from 'vitest'
import { TaskQueue } from '@guildhall/core'
import { normalizeLegacyTaskQueueShape } from '../task-queue-compat.js'

describe('normalizeLegacyTaskQueueShape', () => {
  it('backfills durable task references from legacy imported request-intake evidence', () => {
    const normalized = normalizeLegacyTaskQueueShape({
      version: 1,
      lastUpdated: '2026-06-18T00:00:00.000Z',
      tasks: [
        {
          id: 'task-import-1',
          title: 'Define fixture schemas',
          description: 'Imported harness task.',
          domain: 'harness',
          projectPath: '/tmp/narrative-harness',
          status: 'import_draft',
          priority: 'high',
          dependsOn: [],
          outOfScope: [],
          acceptanceCriteria: [],
          notes: [],
          gateResults: [],
          revisionCount: 0,
          requestIntake: {
            intent: 'spec_only',
            recommendedNextAction: 'draft_spec',
            assumptions: [],
            missingInformation: [],
            evidenceRefs: [
              'import:/tmp/narrative-harness/docs/harness/implementation-roadmap.md',
              'import:/tmp/narrative-harness/docs/specs/story-memory-schemas.md',
            ],
            componentStack: [],
            clarifyingQuestions: [],
            createdAt: '2026-06-18T00:00:00.000Z',
            createdBy: 'workspace-importer',
          },
          createdAt: '2026-06-18T00:00:00.000Z',
          updatedAt: '2026-06-18T00:00:00.000Z',
        },
      ],
    }) as { tasks: Array<{ references?: string[] }> }

    expect(normalized.tasks[0]?.references).toEqual([
      '/tmp/narrative-harness/docs/harness/implementation-roadmap.md',
      '/tmp/narrative-harness/docs/specs/story-memory-schemas.md',
    ])
  })

  it('backfills required fields on legacy compact escalation records', () => {
    const normalized = normalizeLegacyTaskQueueShape({
      version: 1,
      lastUpdated: '2026-06-18T00:00:00.000Z',
      tasks: [
        {
          id: 'task-question',
          title: 'Question task',
          description: 'Needs one owner decision.',
          domain: 'core',
          status: 'exploring',
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          openQuestions: [],
          escalations: [{ id: 'esc-1', summary: 'Needs owner input' }],
          agentIssues: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: '2026-06-18T00:00:00.000Z',
          updatedAt: '2026-06-18T00:00:00.000Z',
        },
      ],
    }, '2026-06-19T00:00:00.000Z')

    const parsed = TaskQueue.parse(normalized)
    expect(parsed.tasks[0]?.escalations[0]).toMatchObject({
      id: 'esc-1',
      taskId: 'task-question',
      agentId: 'legacy-task-queue-compat',
      reason: 'human_judgment_required',
      summary: 'Needs owner input',
      raisedAt: '2026-06-19T00:00:00.000Z',
    })
  })
})
