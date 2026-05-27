import { describe, expect, it } from 'vitest'
import { activeEscalations } from '../escalation.js'
import type { Task } from '../types.js'

describe('activeEscalations', () => {
  it('uses runtime open escalation ids when historical evidence was reconstructed without resolved markers', () => {
    const task: Task = {
      id: 'task-1',
      status: 'blocked',
      runtime: {
        openEscalationIds: ['esc-latest'],
      },
      escalations: [
        {
          id: 'esc-old',
          reason: 'human_judgment_required',
          summary: 'Worker made no visible progress after 2 passes.',
          agentId: 'worker-agent',
        },
        {
          id: 'esc-latest',
          reason: 'human_judgment_required',
          summary: 'Worker timed out after failing to mutate the likely target file.',
          agentId: 'worker-agent',
        },
      ],
    }

    expect(activeEscalations(task).map((escalation) => escalation.id)).toEqual(['esc-latest'])
  })
})
