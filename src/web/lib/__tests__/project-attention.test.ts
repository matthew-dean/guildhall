import { describe, expect, it } from 'vitest'
import { dedupeProjectAttention, projectAttentionKey } from '../project-attention.js'

describe('project-attention', () => {
  it('normalizes duplicate spec approval notices to one attention key', () => {
    const startReadiness = {
      id: 'start-readiness',
      code: 'no_unattended_progress',
      reason: 'spec_review',
      message: 'Review 35 waiting specs before starting.',
      href: '/thread',
      priority: 10,
    }
    const idleSummary = {
      id: 'run-stop',
      code: 'no_unattended_progress',
      reason: 'spec_review',
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

  it('keeps the same semantic notice key when provider prose changes completely', () => {
    const structured = {
      id: 'start-readiness',
      code: 'no_unattended_progress',
      reason: 'spec_review',
      href: '/thread',
    }
    expect(projectAttentionKey({
      ...structured,
      message: 'Review the next specification.',
    })).toBe(projectAttentionKey({
      ...structured,
      message: 'The current work packet requires a pass through the decision gate.',
    }))
  })

  it('does not classify an untyped message by vocabulary', () => {
    const notice = {
      id: 'notice-a',
      message: 'Review the draft and answer the question about blocked proof.',
    }
    expect(projectAttentionKey(notice)).not.toBe('owner:spec_approval')
    expect(projectAttentionKey(notice)).toBe('notice:notice-a::notice:unspecified')
  })

  it('keeps distinct untyped notices that happen to share a destination', () => {
    const notices = [{ id: 'notice-a', href: '/thread' }, { id: 'notice-b', href: '/thread' }]
    expect(dedupeProjectAttention(notices)).toHaveLength(2)
  })
})
