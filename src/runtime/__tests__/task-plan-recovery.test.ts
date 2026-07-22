import { describe, expect, it } from 'vitest'
import type { Task } from '@guildhall/core'
import { resetCurrentPlanForProofRecovery } from '../task-plan-recovery.js'

describe('proof-setup recovery', () => {
  it('preserves the executable boundary instead of reopening generic intake', () => {
    const task = {
      id: 'proof-setup-task',
      semanticKind: 'proof_setup',
      acceptanceCriteria: [{ id: 'ac-1', description: 'Run the exact proof.' }],
      proofPaths: [{ id: 'proof-path', kind: 'command', command: 'pnpm run prove' }],
      structuredSpec: { completionBoundary: { splitPolicy: 'none' } },
      notes: [],
    } as unknown as Task

    resetCurrentPlanForProofRecovery(task, {
      reason: 'The last command did not emit its machine marker.',
      now: '2026-07-22T03:00:00.000Z',
    })

    expect(task.acceptanceCriteria).toHaveLength(1)
    expect(task.proofPaths).toHaveLength(1)
    expect(task.structuredSpec).toBeDefined()
    expect(task.notes.at(-1)?.structured).toEqual({
      event: 'proof_setup_plan_preserved',
      source: 'guildhall',
    })
  })
})
