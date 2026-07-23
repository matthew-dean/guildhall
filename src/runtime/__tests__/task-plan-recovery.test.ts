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

  it('clears an obsolete blueprint while preserving the approved brief', () => {
    const task = {
      id: 'story-context-task',
      acceptanceCriteria: [{ id: 'ac-1', description: 'Old generated criterion.' }],
      structuredSpec: { completionBoundary: { splitPolicy: 'conditional' } },
      spec: '## Old generated contract',
      productBrief: {
        userJob: 'Keep author-owned context immutable.',
        approvedBy: 'codex_delegated_owner',
      },
      notes: [],
    } as unknown as Task

    resetCurrentPlanForProofRecovery(task, {
      reason: 'The approved scope needs a fresh source-backed spec.',
      now: '2026-07-23T02:00:00.000Z',
      preserveProductBrief: true,
    })

    expect(task.productBrief).toMatchObject({ approvedBy: 'codex_delegated_owner' })
    expect(task.spec).toBeUndefined()
    expect(task.structuredSpec).toBeUndefined()
    expect(task.acceptanceCriteria).toEqual([])
  })
})
