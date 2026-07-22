import { describe, expect, it } from 'vitest'
import { buildReviewerSummarySections } from './reviewer-summary.js'

describe('buildReviewerSummarySections', () => {
  it('reads advisory scores from structured verdict fields', () => {
    expect(buildReviewerSummarySections([{
      reviewerId: 'api-designer',
      reviewerName: 'The API Designer',
      advisoryScores: {
        recommendationPriority: 'medium',
        expectedValue: 'high',
        deferredRisk: 'low',
      },
    }])).toEqual([{
      guildName: 'The API Designer',
      scores: {
        recommendationPriority: 'medium',
        expectedValue: 'high',
        deferredRisk: 'low',
      },
    }])
  })

  it('does not turn reviewer prose into advisory state', () => {
    const machine = [{
      reviewerId: 'api-designer',
      reviewerName: 'The API Designer',
      advisoryScores: { recommendationPriority: 'high' as const },
    }]
    const alternateMachine = [{
      ...machine[0],
      advisoryScores: { recommendationPriority: 'high' as const },
    }]
    expect(buildReviewerSummarySections(machine)).toEqual(buildReviewerSummarySections(alternateMachine))
    expect(buildReviewerSummarySections([{
      reviewerId: 'api-designer',
      reviewerName: 'The API Designer',
    }])).toEqual([])
  })
})
