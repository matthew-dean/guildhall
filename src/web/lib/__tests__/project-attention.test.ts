import { describe, expect, it } from 'vitest'
import { dedupeProjectAttention, projectAttentionKey } from '../project-attention.js'

describe('project-attention', () => {
  it('normalizes duplicate spec approval notices to one attention key', () => {
    const startReadiness = {
      id: 'start-readiness',
      code: 'no_unattended_progress',
      message: 'Review 35 waiting specs before starting.',
      href: '/thread',
      priority: 10,
    }
    const idleSummary = {
      id: 'run-stop',
      reason: 'awaiting_human',
      message: 'Waiting on input: 35 awaiting approval.',
      href: '/thread',
      priority: 20,
    }

    expect(projectAttentionKey(startReadiness)).toBe('owner:spec_approval')
    expect(projectAttentionKey(idleSummary)).toBe('owner:spec_approval')
    expect(dedupeProjectAttention([startReadiness, idleSummary])).toEqual([
      expect.objectContaining({
        id: 'start-readiness',
        key: 'owner:spec_approval',
      }),
    ])
  })
})
