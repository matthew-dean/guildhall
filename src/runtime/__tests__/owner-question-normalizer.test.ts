import { describe, expect, it } from 'vitest'
import { normalizeLegacyOwnerQuestion, normalizeStructuredOwnerQuestion } from '../owner-question-normalizer.js'

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

  it('accepts an explicit question without caring about its prose style', () => {
    expect(normalizeStructuredOwnerQuestion({
      kind: 'text',
      prompt: 'Which release should contain this proof work?',
    })).toEqual({
      kind: 'text',
      prompt: 'Which release should contain this proof work?',
    })
    expect(normalizeStructuredOwnerQuestion({
      kind: 'text',
      prompt: 'Would you prefer the terse version or the detailed version?',
    })).toEqual({
      kind: 'text',
      prompt: 'Would you prefer the terse version or the detailed version?',
    })
  })

  it('does not manufacture a question from assistant narration', () => {
    expect(normalizeLegacyOwnerQuestion({
      prompt: 'I have enough context. The key question I need to ask is: Which release should contain this work?',
    })).toBeNull()
  })

  it('rejects question-shaped records that are actually statements', () => {
    expect(normalizeStructuredOwnerQuestion({
      kind: 'choice',
      prompt: 'The existing schemas already have:',
      choices: ['A', 'B'],
    })).toBeNull()
  })
})
