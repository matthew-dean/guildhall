import { describe, expect, it } from 'vitest'
import type { Task } from '@guildhall/core'
import { normalizeImportedDraftTask, shouldUseImportDraftState } from '../import-drafts.js'

function importedExploringTask(notes: Task['notes']): Task {
  return {
    id: 'task-imported-shaping',
    title: 'Generate the project types',
    description: 'Imported from the project state document.',
    status: 'exploring',
    domain: 'project',
    requestIntake: {
      createdBy: 'workspace-importer',
      evidenceRefs: ['import:PROJECT_STATE.md'],
    },
    notes,
    acceptanceCriteria: [],
  } as unknown as Task
}

describe('imported draft state', () => {
  it('does not treat ordinary source-backed work as a workspace import', () => {
    const task = {
      ...importedExploringTask([]),
      requestIntake: undefined,
      sourceClaims: [{ claim: 'The package exposes a CLI.', references: ['package.json'] }],
    } as unknown as Task

    expect(shouldUseImportDraftState(task)).toBe(false)
  })

  it('preserves exploring after Guildhall records imported-draft shaping progress', () => {
    const task = importedExploringTask([
      {
        agentId: 'system',
        role: 'state-repair',
        content: 'Cleared stale execution state from imported draft shaping.',
        structured: {
          event: 'imported_draft_shaping',
        },
        timestamp: '2026-07-13T20:00:00.000Z',
      },
    ])

    expect(shouldUseImportDraftState(task)).toBe(false)
    expect(normalizeImportedDraftTask(task)).toBe(false)
    expect(task.status).toBe('exploring')
  })

  it('does not let a model-written phrase count as shaping progress', () => {
    const task = importedExploringTask([
      {
        agentId: 'model',
        role: 'state-repair',
        content: 'This imported draft shaping is complete.',
        timestamp: '2026-07-13T20:00:00.000Z',
      },
    ])

    expect(shouldUseImportDraftState(task)).toBe(true)
  })

  it('still normalizes an unmarked legacy imported exploration into a draft', () => {
    const task = importedExploringTask([])

    expect(shouldUseImportDraftState(task)).toBe(true)
    expect(normalizeImportedDraftTask(task)).toBe(true)
    expect(task.status).toBe('import_draft')
  })
})
