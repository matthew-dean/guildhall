export interface ReviewerAdvisoryScores {
  recommendationPriority?: 'low' | 'medium' | 'high'
  expectedValue?: 'low' | 'medium' | 'high'
  deferredRisk?: 'low' | 'medium' | 'high'
}

export interface ReviewerSummarySection {
  guildName: string
  scores: ReviewerAdvisoryScores
}

function parseLevel(
  block: string,
  label: string,
): 'low' | 'medium' | 'high' | undefined {
  const match = block.match(new RegExp(`${label}:\\s*(low|medium|high)`, 'i'))
  return match ? match[1]!.toLowerCase() as 'low' | 'medium' | 'high' : undefined
}

export function parseReviewerSummarySections(summary: string): ReviewerSummarySection[] {
  const sections: ReviewerSummarySection[] = []
  const matches = summary.matchAll(
    /### From ([^\n]+)\n\n([\s\S]*?)(?=\n### From |\n### Non-blocking follow-up ideas|\n### Reviewer availability notes|$)/g,
  )
  for (const match of matches) {
    const guildName = match[1]?.trim()
    const body = match[2]?.trim() ?? ''
    if (!guildName) continue
    const advisoryBlock = body.match(
      /\*\*Advisory scoring[^:]*:\*\*\s*([\s\S]*?)(?:\n\s*\*\*|$)/i,
    )?.[1] ?? ''
    sections.push({
      guildName,
      scores: {
        recommendationPriority: parseLevel(advisoryBlock, 'Recommendation priority'),
        expectedValue: parseLevel(advisoryBlock, 'Expected value if taken'),
        deferredRisk: parseLevel(advisoryBlock, 'Risk if deferred'),
      },
    })
  }
  return sections
}
