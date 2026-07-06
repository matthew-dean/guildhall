import { describe, expect, it } from 'vitest'

import { taskNeedsImportedBriefShaping, taskShapingBlockers } from '../task-shaping-blockers.js'

describe('taskShapingBlockers', () => {
  it('keeps active imported exploring work in the shaping queue', () => {
    const task = {
      status: 'exploring',
      notes: [{ agentId: 'workspace-importer', role: 'importer' }],
      acceptanceCriteria: [],
    }

    expect(taskNeedsImportedBriefShaping(task)).toBe(true)
    expect(taskShapingBlockers(task)).toEqual([
      {
        code: 'imported_brief_shaping',
        summary: 'Imported current work needs a real brief before Guildhall can build unattended.',
      },
    ])
  })

  it('does not preserve stale shaping blockers on terminal tasks', () => {
    const task = {
      status: 'done',
      notes: [{ agentId: 'workspace-importer', role: 'importer' }],
      taskReadiness: {
        recommendation: 'needs_research_spike',
        summary: 'This imported task still needs source-backed recovery.',
      },
    }

    expect(taskNeedsImportedBriefShaping(task)).toBe(false)
    expect(taskShapingBlockers(task)).toEqual([])
  })
})
