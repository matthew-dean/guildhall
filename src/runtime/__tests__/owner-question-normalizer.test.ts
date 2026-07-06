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

  it('rejects source-trail lead-ins that never ask an owner question', () => {
    expect(normalizeStructuredOwnerQuestion({
      kind: 'choice',
      prompt: "From what I've seen:",
      choices: [
        '`features.md` line 59: `- [ ] Templates` - unchecked, under "Organization & Structure"',
        'The roadmap does not list Templates as a priority parity gap',
      ],
    })).toBeNull()
  })
})
