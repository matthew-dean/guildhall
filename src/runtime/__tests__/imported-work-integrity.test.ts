import { describe, expect, it } from 'vitest'

import {
  importedContractWorkIsStructurallyIncomplete,
  taskHasConcreteContractNames,
} from '../imported-work-integrity.js'

describe('imported work integrity', () => {
  it('accepts source-backed backticked contract/type surface names as concrete', () => {
    const task = {
      title: 'Recover source-backed contract surface for author-involvement-modes contract and involvement-dial types',
      references: ['docs/specs/author-involvement-modes.md'],
      spec: [
        '## Contract / Type Surfaces',
        '- `author-involvement-modes contract`',
        '- `involvement-dial types`',
      ].join('\n'),
      acceptanceCriteria: [
        {
          description:
            'Proof targets `author-involvement-modes contract` and `involvement-dial types` instead of an unnamed placeholder.',
        },
      ],
    }

    expect(taskHasConcreteContractNames(task)).toBe(true)
    expect(importedContractWorkIsStructurallyIncomplete(task)).toBe(false)
  })

  it('accepts source-backed workflow pipeline surface names as concrete', () => {
    const task = {
      title: 'Recover source-backed contract surface for editor-writer feedback chain contract and weighted-feedback pipeline',
      references: ['docs/specs/editor-writer-feedback-chain.md'],
      spec: [
        '## Contract / Type / Workflow Surfaces',
        '- `editor-writer feedback chain contract`',
        '- `weighted-feedback pipeline`',
      ].join('\n'),
      acceptanceCriteria: [
        {
          description:
            'Proof targets `editor-writer feedback chain contract` and `weighted-feedback pipeline` instead of an unnamed placeholder.',
        },
      ],
    }

    expect(taskHasConcreteContractNames(task)).toBe(true)
    expect(importedContractWorkIsStructurallyIncomplete(task)).toBe(false)
  })

  it('does not classify generated database types as a contract-surface task', () => {
    const task = {
      title: 'TypeScript: generate proper types from Supabase (pnpm db:types)',
      references: ['PROJECT_STATE.md', 'docs/release-plan.md'],
    }

    expect(importedContractWorkIsStructurallyIncomplete(task)).toBe(false)
  })
})
