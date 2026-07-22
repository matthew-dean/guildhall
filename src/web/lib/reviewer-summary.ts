import type { ReviewVerdict } from './types.js'

export interface ReviewerAdvisoryScores {
  recommendationPriority?: 'low' | 'medium' | 'high'
  expectedValue?: 'low' | 'medium' | 'high'
  deferredRisk?: 'low' | 'medium' | 'high'
}

export interface ReviewerSummarySection {
  guildName: string
  scores: ReviewerAdvisoryScores
}

/**
 * Build the review-score display from the persisted machine record.
 *
 * Reviewer reasoning is intentionally absent from this function. A model may
 * use any prose structure, vocabulary, or language without changing what the
 * drawer considers a recorded advisory score.
 */
export function buildReviewerSummarySections(
  verdicts: readonly Pick<ReviewVerdict, 'reviewerId' | 'reviewerName' | 'advisoryScores'>[],
): ReviewerSummarySection[] {
  return verdicts
    .map((verdict) => {
      const scores = verdict.advisoryScores ?? {}
      if (!scores.recommendationPriority && !scores.expectedValue && !scores.deferredRisk) return null
      return {
        guildName: verdict.reviewerName?.trim() || verdict.reviewerId?.trim() || 'Review team',
        scores,
      }
    })
    .filter((section): section is ReviewerSummarySection => section !== null)
}
