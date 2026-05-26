import { describe, expect, it } from 'vitest'

import { buildTaskSizePlan } from '../task-sizing.js'

describe('task sizing', () => {
  it('allows a narrow task to proceed without splitting', () => {
    const plan = buildTaskSizePlan({
      task: {
        id: 'task-copy',
        title: 'Clarify empty-state copy',
        description: 'Update one empty state message on the dashboard.',
        priority: 'normal',
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'The empty state uses friendlier wording.',
            verifiedBy: 'review',
            met: false,
          },
        ],
        outOfScope: ['No layout changes.'],
      },
      changedFiles: ['src/web/surfaces/Dashboard.svelte'],
      riskLanes: ['copy_clarity'],
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    expect(plan).toMatchObject({
      score: 2,
      band: 'small',
      action: 'proceed',
    })
    expect(plan.factors.map((factor) => factor.id)).toContain('narrow_verification')
    expect(plan.recommendedChildren).toEqual([])
  })

  it('requires splitting when one request spans multiple outcomes, surfaces, and risk lanes', () => {
    const plan = buildTaskSizePlan({
      task: {
        id: 'task-platform-launch',
        title: 'Launch billing, invite, and analytics changes',
        description: [
          'Add a billing settings screen, migrate existing workspace subscriptions,',
          'create invite email delivery, update analytics events, document rollout,',
          'and add an admin API endpoint.',
        ].join(' '),
        priority: 'high',
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'Billing settings can update a subscription.',
            verifiedBy: 'automated',
            command: 'pnpm test billing',
            met: false,
          },
          {
            id: 'ac-2',
            description: 'Invite emails are sent.',
            verifiedBy: 'automated',
            command: 'pnpm test invites',
            met: false,
          },
          {
            id: 'ac-3',
            description: 'Analytics events are documented.',
            verifiedBy: 'review',
            met: false,
          },
        ],
        outOfScope: [],
      },
      changedFiles: [
        'src/web/settings/Billing.svelte',
        'src/api/admin/subscriptions.ts',
        'src/email/invites.ts',
        'migrations/20260525_workspace_subscriptions.sql',
        'docs/reference/analytics.md',
      ],
      riskLanes: ['ux_comprehension', 'api_contract', 'data_integrity', 'migration_safety', 'privacy', 'release_risk'],
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    expect(plan.score).toBe(8)
    expect(plan.band).toBe('epic')
    expect(plan.action).toBe('split_required')
    expect(plan.factors.map((factor) => factor.id)).toEqual(expect.arrayContaining([
      'multiple_outcomes',
      'many_surfaces',
      'many_risk_lanes',
      'migration_or_release',
    ]))
    expect(plan.recommendedChildren.map((child) => child.title)).toEqual([
      'Implement the billing settings workflow',
      'Add the admin subscription API contract',
      'Migrate existing workspace subscription data',
      'Implement invite email delivery',
      'Update analytics documentation and rollout evidence',
    ])
  })
})
