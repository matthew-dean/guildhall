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
})
