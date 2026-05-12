import { describe, expect, it } from 'vitest'

import {
  escapeAngleBracketPlaceholders,
  stripAcceptanceCriteriaSection,
} from '../spec-render.js'

describe('stripAcceptanceCriteriaSection', () => {
  it('removes the acceptance-criteria section while keeping surrounding sections', () => {
    const spec = [
      '## Summary',
      '',
      'Keep the auth callback flow intact.',
      '',
      '## Acceptance Criteria',
      '',
      '- Redirect to `/<slug>` when membership resolves.',
      '- Redirect to `/signup` otherwise.',
      '',
      '## Out of Scope',
      '',
      '- No multi-workspace picker.',
    ].join('\n')

    expect(stripAcceptanceCriteriaSection(spec)).toBe([
      '## Summary',
      '',
      'Keep the auth callback flow intact.',
      '',
      '## Out of Scope',
      '',
      '- No multi-workspace picker.',
    ].join('\n'))
  })

  it('leaves the spec unchanged when there is no acceptance-criteria heading', () => {
    const spec = '## Summary\n\nNo duplicate section here.'
    expect(stripAcceptanceCriteriaSection(spec)).toBe(spec)
  })

  it('escapes angle-bracket placeholders so markdown does not eat them', () => {
    expect(
      escapeAngleBracketPlaceholders(
        'Redirect to /<slug> when membership resolves.',
      ),
    ).toBe('Redirect to /&lt;slug&gt; when membership resolves.')
  })
})
