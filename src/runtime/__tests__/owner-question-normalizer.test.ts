import { describe, expect, it } from 'vitest'
import { normalizeStructuredOwnerQuestion } from '../owner-question-normalizer.js'

describe('normalizeStructuredOwnerQuestion', () => {
  it('rejects evidence summaries masquerading as choice prompts', () => {
    expect(normalizeStructuredOwnerQuestion({
      kind: 'choice',
      prompt: 'The existing schemas already have:',
      choices: [
        '`src/schemas/fixture.ts` — `FixtureManifest`, `ExpectedRecordSet`',
        '`src/schemas/evaluation.ts` — `PrototypeRun`, `RunEvaluation`',
      ],
    })).toBeNull()
  })
})
