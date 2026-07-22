import { describe, expect, it } from 'vitest'
import {
  readStructuredReviewResult,
  readStructuredSelfCritique,
  renderStructuredReviewFeedback,
  reviewVerdictHasStructuredApproval,
} from '../review-contract.js'

describe('review contracts', () => {
  it('ignores prose verdicts and parses the stable machine payload', () => {
    const result = readStructuredReviewResult([
      '**Verdict:** Approved, obviously.',
      '**Reasoning:** lyrical model-specific prose that should not matter.',
      '```json',
      JSON.stringify({
        verdict: 'approve',
        acceptedCriteriaIds: ['ac-1'],
        proofEvidenceIds: ['proof-1'],
        revisionItems: [],
        riskItems: [],
        followUpItems: [],
        advisoryScores: {},
      }),
      '```',
    ].join('\n'))

    expect(result).toMatchObject({
      verdict: 'approve',
      acceptedCriteriaIds: ['ac-1'],
      proofEvidenceIds: ['proof-1'],
    })
  })

  it('does not turn a prose-only worker handoff into structured proof', () => {
    expect(readStructuredSelfCritique([
      '**Self-critique:** The work is done and all checks passed.',
      'Files changed: src/index.ts.',
    ].join('\n'))).toBeNull()
  })

  it('accepts a standalone machine JSON document without requiring a prose wrapper', () => {
    expect(readStructuredReviewResult(JSON.stringify({
      verdict: 'approve',
      acceptedCriteriaIds: ['ac-1'],
      proofEvidenceIds: [],
    }))).toMatchObject({
      verdict: 'approve',
      acceptedCriteriaIds: ['ac-1'],
    })
    expect(readStructuredSelfCritique(JSON.stringify({
      acceptanceCriteria: [{ id: 'ac-1', status: 'met' }],
      changedFiles: ['src/index.ts'],
      verificationCommands: [{ command: 'pnpm test', status: 'passed' }],
      proofEvidenceIds: [],
    }))).toMatchObject({
      acceptanceCriteria: [{ id: 'ac-1', status: 'met' }],
      changedFiles: ['src/index.ts'],
    })
  })

  it('accepts worker proof only when every machine field has the right shape', () => {
    const result = readStructuredSelfCritique([
      'The prose can use any vocabulary here.',
      '```json',
      JSON.stringify({
        acceptanceCriteria: [{ id: 'ac-1', status: 'met' }],
        changedFiles: ['src/index.ts'],
        verificationCommands: [{ command: 'pnpm test', status: 'passed' }],
        proofEvidenceIds: ['proof-1'],
      }),
      '```',
    ].join('\n'))

    expect(result).toEqual({
      acceptanceCriteria: [{ id: 'ac-1', status: 'met' }],
      changedFiles: ['src/index.ts'],
      verificationCommands: [{ command: 'pnpm test', status: 'passed' }],
      proofEvidenceIds: ['proof-1'],
    })
  })

  it('requires exact accepted criterion IDs for an LLM approval', () => {
    expect(reviewVerdictHasStructuredApproval({
      verdict: 'approve',
      reviewerPath: 'llm',
      acceptedCriteriaIds: ['ac-1'],
    }, ['ac-1'])).toBe(true)
    expect(reviewVerdictHasStructuredApproval({
      verdict: 'approve',
      reviewerPath: 'llm',
      reasoning: '**Verdict:** Approved',
    }, ['ac-1'])).toBe(false)
  })

  it('keeps the decision identical when model prose changes or contradicts it', () => {
    const machineResult = JSON.stringify({
      verdict: 'revise',
      acceptedCriteriaIds: ['ac-1'],
      proofEvidenceIds: ['proof-1'],
      revisionItems: ['revise the machine-readable gap list'],
      riskItems: [],
      followUpItems: [],
      advisoryScores: { recommendationPriority: 'high' },
    })

    const terse = readStructuredReviewResult([
      'The work needs revision.',
      '```json',
      machineResult,
      '```',
    ].join('\n'))
    const ornate = readStructuredReviewResult([
      '**Verdict:** approved forever.',
      '**Reasoning:** a completely different model could use any genre, vocabulary, tone, or phrase order here.',
      '```json',
      machineResult,
      '```',
    ].join('\n'))

    expect(terse).toEqual(ornate)
    expect(ornate?.verdict).toBe('revise')
  })

  it('renders worker feedback from structured fields and ignores surrounding prose', () => {
    const feedback = renderStructuredReviewFeedback([
      'This explanation may use any model vocabulary and must not reach the worker.',
      '```json',
      JSON.stringify({
        verdict: 'revise',
        acceptedCriteriaIds: ['ac-1'],
        proofEvidenceIds: ['proof-1'],
        revisionItems: ['Use the recorded proof path.'],
        riskItems: ['The release remains unproven.'],
        followUpItems: ['Consider a broader benchmark later.'],
        advisoryScores: {},
      }),
      '```',
    ].join('\n'))

    expect(feedback).toContain('Use the recorded proof path.')
    expect(feedback).toContain('Accepted criteria IDs: ac-1')
    expect(feedback).not.toContain('This explanation may use any model vocabulary')
    expect(renderStructuredReviewFeedback('A prose-only review with no machine object.')).toBe('')
  })

  it('uses a structured note contract when reviewer prose is arbitrary', () => {
    const feedback = renderStructuredReviewFeedback(
      'A totally different model can explain this however it likes.',
      {
        verdict: 'revise',
        acceptedCriteriaIds: ['ac-1'],
        proofEvidenceIds: [],
        revisionItems: ['Use the shared review boundary.'],
        riskItems: [],
        followUpItems: [],
        advisoryScores: {},
      },
    )

    expect(feedback).toContain('Use the shared review boundary.')
    expect(feedback).toContain('Accepted criteria IDs: ac-1')
    expect(feedback).not.toContain('totally different model')
  })

  it('rejects conflicting text and structured reviewer contracts', () => {
    expect(readStructuredReviewResult(
      '{"verdict":"approve","acceptedCriteriaIds":[],"proofEvidenceIds":[],"revisionItems":[],"riskItems":[],"followUpItems":[],"advisoryScores":{}}',
      {
        verdict: 'revise',
        acceptedCriteriaIds: [],
        proofEvidenceIds: [],
        revisionItems: [],
        riskItems: [],
        followUpItems: [],
        advisoryScores: {},
      },
    )).toBeNull()
  })

  it('uses persisted structured handoff facts regardless of the note prose', () => {
    const structured = {
      acceptanceCriteria: [{ id: 'ac-1', status: 'met' as const }],
      changedFiles: ['src/index.ts'],
      verificationCommands: [{ command: 'pnpm test', status: 'passed' as const }],
      proofEvidenceIds: ['proof-1'],
    }

    const result = readStructuredSelfCritique(
      'A completely different model could write any prose here, in any language or format.',
      structured,
    )

    expect(result).toEqual(structured)
  })

  it('fails closed when a model emits conflicting machine results', () => {
    const approve = JSON.stringify({ verdict: 'approve', acceptedCriteriaIds: ['ac-1'], proofEvidenceIds: [] })
    const revise = JSON.stringify({ verdict: 'revise', acceptedCriteriaIds: [], proofEvidenceIds: [] })
    expect(readStructuredReviewResult(`\`\`\`json\n${approve}\n\`\`\`\n\`\`\`json\n${revise}\n\`\`\``)).toBeNull()
  })
})
