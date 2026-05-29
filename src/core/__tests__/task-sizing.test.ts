import { describe, expect, it } from 'vitest'

import { buildTaskSizePlan } from '../task-sizing.js'

describe('task sizing', () => {
  it('treats deterministic single-file smoke tasks as tiny', () => {
    const plan = buildTaskSizePlan({
      task: {
        id: 'task-smoke-file',
        title: 'New request',
        description: 'Create a file named guildhall_smoke.txt in the project root containing exactly GUILDHALL_SMOKE_OK.',
        priority: 'normal',
        spec: [
          '## Summary',
          'Create a single file `guildhall_smoke.txt` in the project root containing exactly the string `GUILDHALL_SMOKE_OK`.',
          '',
          '## Product Brief',
          '- **User job**: Verify the Guildhall pipeline works end-to-end by creating a marker file.',
          '- **Success metric**: `guildhall_smoke.txt` exists at the project root with content `GUILDHALL_SMOKE_OK`.',
          '- **Rollout plan**: None — this is a one-shot smoke test.',
          '',
          '## Acceptance Criteria',
          '1. File exists at the project root.',
          '2. File content is exactly `GUILDHALL_SMOKE_OK`.',
          '',
          '## Out of Scope',
          '- No other files are created or modified.',
          '- No documentation updates.',
          '- No API, UI, or product surface changes.',
        ].join('\n'),
        acceptanceCriteria: [
          { id: 'ac-1', description: 'File exists at the project root.', verifiedBy: 'automated', met: false },
          { id: 'ac-2', description: 'File content is exactly GUILDHALL_SMOKE_OK.', verifiedBy: 'automated', met: false },
        ],
        outOfScope: ['No other files are created or modified.'],
      },
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    expect(plan).toMatchObject({
      score: 1,
      band: 'tiny',
      action: 'proceed',
      reviewBudgetHint: 'lean',
    })
    expect(plan.factors.map((factor) => factor.id)).toContain('deterministic_single_file')
    expect(plan.recommendedChildren).toEqual([])
  })

  it('lets a dependency-free single-file web app proceed as one focused task', () => {
    const plan = buildTaskSizePlan({
      task: {
        id: 'task-pantry-pulse',
        title: 'Build Pantry Pulse web app',
        description: 'Build a dependency-free single-page Pantry Pulse web app in this project root.',
        priority: 'normal',
        spec: [
          '## Summary',
          'Build a dependency-free single-page Pantry Pulse web app.',
          'Use plain HTML, CSS, and JavaScript only; do not require npm install or a dev server.',
          '',
          '## File Structure',
          'Single file: `index.html` in the project root. Contains all HTML, CSS, and JavaScript.',
          '',
          '## Acceptance Criteria',
          '1. Page loads with a Pantry Pulse heading.',
          '2. At least seven seeded pantry items are displayed.',
          '3. All / Expiring soon filter updates the list.',
          '4. Mark used updates the visible item count.',
          '5. Warm domestic palette avoids generic blue accents.',
        ].join('\n'),
        acceptanceCriteria: [
          { id: 'ac-1', description: 'Page loads with a Pantry Pulse heading.', verifiedBy: 'browser', met: false },
          { id: 'ac-2', description: 'At least seven seeded pantry items are displayed.', verifiedBy: 'browser', met: false },
          { id: 'ac-3', description: 'All / Expiring soon filter updates the list.', verifiedBy: 'browser', met: false },
          { id: 'ac-4', description: 'Mark used updates the visible item count.', verifiedBy: 'browser', met: false },
          { id: 'ac-5', description: 'Warm domestic palette avoids generic blue accents.', verifiedBy: 'review', met: false },
        ],
        outOfScope: ['No build step.'],
      },
      changedFiles: ['index.html'],
      riskLanes: ['visual_design', 'ux_comprehension', 'accessibility'],
      createdAt: '2026-05-29T12:00:00.000Z',
    })

    expect(plan).toMatchObject({
      score: 3,
      band: 'medium',
      action: 'proceed_with_warning',
      reviewBudgetHint: 'balanced',
    })
    expect(plan.factors.map((factor) => factor.id)).toContain('single_file_web_app')
    expect(plan.recommendedChildren).toEqual([])
  })

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

  it('does not count out-of-scope migrations or persistence as in-scope split pressure', () => {
    const plan = buildTaskSizePlan({
      task: {
        id: 'task-pantry-pulse',
        title: 'Pantry Pulse app spec',
        description: 'Build a small local web app that tracks pantry items and marks items as used.',
        priority: 'normal',
        spec: [
          '## Summary',
          'Build a single-page app with seeded pantry data.',
          '## Out of Scope',
          '- Remote persistence.',
          '- Real database setup or migrations.',
          '- Deployment or rollout.',
        ].join('\n'),
        acceptanceCriteria: [
          { id: 'ac-1', description: 'Page title and heading both read Pantry Pulse.', verifiedBy: 'browser', met: false },
          { id: 'ac-2', description: 'Mark used removes an item.', verifiedBy: 'browser', met: false },
          { id: 'ac-3', description: 'The visible count updates.', verifiedBy: 'browser', met: false },
        ],
        outOfScope: [
          'Remote persistence.',
          'Real database setup or migrations.',
          'Deployment or rollout.',
        ],
      },
      riskLanes: ['ux_comprehension', 'accessibility', 'verification'],
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    expect(plan.action).toBe('proceed_with_warning')
    expect(plan.factors.map((factor) => factor.id)).not.toContain('migration_or_release')
    expect(plan.recommendedChildren).toEqual([])
  })
})
