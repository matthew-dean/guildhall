import { describe, expect, it } from 'vitest'
import { parseReviewerSummarySections } from './reviewer-summary.js'

describe('parseReviewerSummarySections', () => {
  it('extracts advisory scoring per persona section', () => {
    const summary = `
**Aggregated revisions from 2 personas:**

### From The API Designer

The route is inconsistent.

**Advisory scoring (from your perspective):**
- Recommendation priority: medium
- Expected value if taken: high
- Risk if deferred: low

### From The Security Engineer

Validate the boundary.

**Advisory scoring (from your perspective):**
- Recommendation priority: high
- Expected value if taken: medium
- Risk if deferred: high
`.trim()

    expect(parseReviewerSummarySections(summary)).toEqual([
      {
        guildName: 'The API Designer',
        scores: {
          recommendationPriority: 'medium',
          expectedValue: 'high',
          deferredRisk: 'low',
        },
      },
      {
        guildName: 'The Security Engineer',
        scores: {
          recommendationPriority: 'high',
          expectedValue: 'medium',
          deferredRisk: 'high',
        },
      },
    ])
  })
})
