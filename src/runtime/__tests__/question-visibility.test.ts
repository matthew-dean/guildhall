import { describe, expect, it } from 'vitest'

import { visibleOpenQuestions } from '../question-visibility.js'
import type { Task } from '@guildhall/core'

function taskWithQuestions(openQuestions: NonNullable<Task['openQuestions']>): Task {
  const now = new Date().toISOString()
  return {
    id: 'task-audit',
    title: 'Audit task',
    description: 'Test task.',
    domain: 'test',
    projectPath: '.',
    origination: 'human',
    status: 'exploring',
    priority: 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    createdAt: now,
    updatedAt: now,
    openQuestions,
  }
}

describe('visibleOpenQuestions', () => {
  it('keeps structured questions visible and hides narration-shaped records', () => {
    const task = taskWithQuestions([
      {
        id: 'q-fake',
        kind: 'text',
        prompt: 'I have enough from the glob results. Let me piece together what I know:',
        askedAt: new Date().toISOString(),
        askedBy: 'spec-agent',
      },
      {
        id: 'q-real',
        kind: 'text',
        prompt: 'Which checkout flow should be the first release path?',
        askedAt: new Date().toISOString(),
        askedBy: 'spec-agent',
      },
    ])

    expect(visibleOpenQuestions(task).map(question => (question as { id?: string }).id)).toEqual(['q-real'])
  })

  it('hides agent narration even when it is stored in the question slot', () => {
    const task = taskWithQuestions([
      {
        id: 'q-plan',
        kind: 'text',
        prompt: "I'm going to inspect the routes, update the brief, and write the spec.",
        askedAt: new Date().toISOString(),
        askedBy: 'spec-agent',
      },
    ])

    expect(visibleOpenQuestions(task)).toHaveLength(0)
  })

  it('hides evidence summaries even when they are stored as choice prompts', () => {
    const task = taskWithQuestions([
      {
        id: 'q-files',
        kind: 'choice',
        prompt: 'The existing schemas already have:',
        choices: [
          '`src/schemas/fixture.ts` - `FixtureManifest`, `ExpectedRecordSet`',
          '`src/schemas/evaluation.ts` - `PrototypeRun`, `RunEvaluation`',
        ],
        selectionMode: 'single',
        askedAt: new Date().toISOString(),
        askedBy: 'spec-agent',
      },
    ])

    expect(visibleOpenQuestions(task)).toHaveLength(0)
  })
})
