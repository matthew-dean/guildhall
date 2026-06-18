import { describe, expect, it } from 'vitest'
import {
  classifyScopeAuthorityAction,
  createScopeAuthorityRequest,
} from '../scope-authority.js'

describe('scope authority', () => {
  it('does not require owner authority for ordinary work decomposition', () => {
    expect(classifyScopeAuthorityAction({
      type: 'split_work',
      targetWorkId: 'task-broad',
      reason: 'The accepted work is too broad for one worker pass.',
    })).toMatchObject({
      needsOwnerDecision: false,
      authority: 'execution_planning',
    })
  })

  it('requires owner authority when adding new accepted scope', () => {
    expect(classifyScopeAuthorityAction({
      type: 'add_scope',
      targetWorkId: 'release-mvp',
      reason: 'Add the UI editor feature to the current MVP.',
    })).toMatchObject({
      needsOwnerDecision: true,
      authority: 'scope_authority',
      requestType: 'add_scope',
    })
  })

  it('requires owner authority to move current bounded-scope work to later unless the owner explicitly asked', () => {
    expect(classifyScopeAuthorityAction({
      type: 'defer_scope',
      targetWorkId: 'feature-editor',
      reason: 'Move UI editor out of Current MVP.',
      ownerRequested: false,
    })).toMatchObject({
      needsOwnerDecision: true,
      requestType: 'defer_scope',
    })

    expect(classifyScopeAuthorityAction({
      type: 'defer_scope',
      targetWorkId: 'feature-editor',
      reason: 'Owner asked to move UI editor to Later.',
      ownerRequested: true,
    })).toMatchObject({
      needsOwnerDecision: false,
      authority: 'execution_planning',
    })
  })

  it('requires owner authority for external permission and irreversible operations', () => {
    expect(classifyScopeAuthorityAction({
      type: 'external_permission',
      reason: 'Grant production Stripe access.',
    })).toMatchObject({
      needsOwnerDecision: true,
      requestType: 'external_permission',
    })

    expect(classifyScopeAuthorityAction({
      type: 'irreversible_operation',
      reason: 'Delete production records.',
    })).toMatchObject({
      needsOwnerDecision: true,
      requestType: 'irreversible_operation',
    })
  })

  it('creates owner-facing scope authority requests without using decomposition language', () => {
    const request = createScopeAuthorityRequest({
      id: 'scope-1',
      type: 'change_release_boundary',
      targetWorkId: 'release-mvp',
      question: 'Should UI editor work be part of Current MVP, or moved to Later?',
      whyItMatters: 'This changes what Guildhall is allowed to work on next.',
      createdAt: '2026-06-17T00:00:00.000Z',
      createdBy: 'coordinator',
    })

    expect(request.status).toBe('open')
    expect(request.question).toContain('?')
    expect(`${request.question} ${request.whyItMatters}`).not.toMatch(/split|decompos|recommend/i)
  })
})
