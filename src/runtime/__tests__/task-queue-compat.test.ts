import { describe, expect, it } from 'vitest'
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
})
