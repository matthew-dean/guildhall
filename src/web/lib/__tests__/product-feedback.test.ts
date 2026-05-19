import { describe, expect, it } from 'vitest'
import { buildProductFeedbackIssueUrl } from '../product-feedback.js'

describe('buildProductFeedbackIssueUrl', () => {
  it('builds a prefilled Guildhall GitHub issue for product suggestions', () => {
    const href = buildProductFeedbackIssueUrl({
      suggestion: {
        id: 'product-recovery-visibility',
        title: 'Show recovery attempts in Thread',
        summary: 'Users need a calmer view of bounded recovery attempts.',
        evidence: [
          'Worker repaired a touched-file typecheck failure.',
          'Thread only showed raw recovery notes.',
        ],
      },
      project: {
        name: 'Looma + Knit',
        path: '/Users/matthew/git/oss/looma-knit',
      },
    })

    const url = new URL(href)
    expect(url.origin + url.pathname).toBe('https://github.com/matthew-dean/guildhall/issues/new')
    expect(url.searchParams.get('title')).toBe('Product feedback: Show recovery attempts in Thread')
    expect(url.searchParams.get('body')).toContain('Users need a calmer view of bounded recovery attempts.')
    expect(url.searchParams.get('body')).toContain('- Worker repaired a touched-file typecheck failure.')
    expect(url.searchParams.get('body')).toContain('Project: Looma + Knit')
    expect(url.searchParams.get('body')).toContain('/Users/matthew/git/oss/looma-knit')
    expect(url.searchParams.get('body')).toContain('Suggestion id: product-recovery-visibility')
  })
})
