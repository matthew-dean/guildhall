import { describe, expect, it } from 'vitest'

import { analyzeContractTouches } from './contract-touch-detector.mjs'

describe('contract touch detector', () => {
  it('reports contract-owning changed files that have no decision block', () => {
    const result = analyzeContractTouches({
      changedFiles: [
        'src/core/task.ts',
        'src/runtime/delivery-spine.ts',
        'docs/guide/how-guildhall-works.md',
      ],
      documents: new Map(),
    })

    expect(result.advisory).toBe(true)
    expect(result.valid).toBe(false)
    expect(result.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: 'src/core/task.ts',
        likelyContractTypes: expect.arrayContaining(['persisted_state']),
      }),
      expect.objectContaining({
        file: 'docs/guide/how-guildhall-works.md',
        likelyContractTypes: expect.arrayContaining(['documentation_help']),
      }),
    ]))
  })

  it('passes when an internal spec records contract and schema migration decisions', () => {
    const result = analyzeContractTouches({
      changedFiles: [
        'src/core/task.ts',
        'src/runtime/delivery-spine.ts',
        'internal/specs/2026-06-05-guildhall-project-contract-governance.md',
      ],
      documents: new Map([
        ['internal/specs/2026-06-05-guildhall-project-contract-governance.md', [
          '## Contract Touch Decision',
          '',
          '- Work id: 0.10 primitive delivery spine',
          '- Touched contracts: persisted task delivery metadata',
          '- Proof provided: delivery-spine tests',
          '',
          '## Schema Migration Decision',
          '',
          '- Scope: project',
          '- Change class: backward-compatible reader change',
          '- Migration id: none',
          '- Tests added: delivery-spine.test.ts',
        ].join('\n')],
      ]),
    })

    expect(result.valid).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('requires schema decision evidence for memory-core persistence changes', () => {
    const result = analyzeContractTouches({
      changedFiles: [
        'src/memory-core/data-access.ts',
      ],
      documents: new Map(),
    })

    expect(result.valid).toBe(false)
    expect(result.missing).toEqual([
      expect.objectContaining({
        file: 'src/memory-core/data-access.ts',
        likelyContractTypes: expect.arrayContaining(['persisted_state']),
      }),
    ])
  })
})
