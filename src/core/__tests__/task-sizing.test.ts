import { describe, expect, it } from 'vitest'

import { buildDecompositionChildDrafts, buildTaskSizePlan } from '../task-sizing.js'

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

  it('treats an exact single-file release-notes patch as tiny instead of split-worthy release work', () => {
    const plan = buildTaskSizePlan({
      task: {
        id: 'task-release-note-patch',
        title: 'release-note-patch',
        description: 'Append the exact bullet to RELEASE_NOTES.md and do not edit any other file.',
        priority: 'normal',
        spec: [
          '## Summary',
          'Append the exact bullet `- Added benchmark artifact evidence.` to `RELEASE_NOTES.md`.',
          '',
          '## Acceptance Criteria',
          '1. `RELEASE_NOTES.md` ends with the exact requested bullet.',
          '2. No other files change.',
          '',
          '## Completion Boundary',
          '- **Product outcome:** `RELEASE_NOTES.md` contains the requested bullet at the end of the file.',
          '- **What Guildhall can complete in code:** Append the exact line to `RELEASE_NOTES.md` and leave every other file untouched.',
          '- **External dependencies:** None. This is a local-only file patch.',
          '- **Owner-only setup:** None.',
          '- **Verification environment:** Local filesystem on the current machine.',
          '- **What counts as done:** `grep -q \"benchmark artifact evidence\" RELEASE_NOTES.md` exits 0 and `git diff --stat` shows only `RELEASE_NOTES.md`.',
          '- **What must be split or blocked:** Nothing.',
        ].join('\n'),
        acceptanceCriteria: [
          { id: 'ac-1', description: 'RELEASE_NOTES.md ends with the exact requested bullet.', verifiedBy: 'automated', met: false },
          { id: 'ac-2', description: 'No other files change.', verifiedBy: 'automated', met: false },
        ],
        outOfScope: ['Do not edit any file other than RELEASE_NOTES.md.'],
        workUnitAnalysis: {
          summary: 'One deliverable: update the target release-note artifact. The other bullets are proof of that same deliverable.',
          units: [{
            id: 'unit-1',
            title: 'Patch release note artifact',
            deliverable: 'RELEASE_NOTES.md contains the requested appended bullet and no sibling artifact is changed.',
            rationale: 'The request has one acceptance boundary and one target artifact.',
            dependsOn: [],
          }],
          proofOnlyItems: ['grep evidence', 'no-other-files diff evidence'],
          createdAt: '2026-05-30T12:00:00.000Z',
          createdBy: 'coordinator-test',
        },
      },
      changedFiles: ['RELEASE_NOTES.md'],
      createdAt: '2026-05-30T12:00:00.000Z',
    })

    expect(plan).toMatchObject({
      score: 1,
      band: 'tiny',
      action: 'proceed',
      reviewBudgetHint: 'lean',
    })
    expect(plan.factors.map((factor) => factor.id)).toContain('semantic_single_deliverable')
    expect(plan.factors.map((factor) => factor.id)).not.toContain('migration_or_release')
    expect(plan.recommendedChildren).toEqual([])
  })

  it('does not treat multiple done/proof bullets for one file patch as separate work units', () => {
    const plan = buildTaskSizePlan({
      task: {
        id: 'task-policy-note',
        title: 'policy note patch',
        description: 'Append the exact sentence to STATUS_NOTE.md and do not edit any other file.',
        priority: 'normal',
        spec: [
          '## Summary',
          'Append the exact sentence `Guildhall benchmark artifact updated.` to `STATUS_NOTE.md`.',
          '',
          '## Acceptance Criteria',
          '1. `STATUS_NOTE.md` contains the exact sentence at the end of the file.',
          '2. Existing content remains unchanged.',
          '3. No other files change.',
          '',
          '## Completion Boundary',
          '- **Product outcome:** `STATUS_NOTE.md` contains the requested sentence.',
          '- **What Guildhall can complete in code:** Append the exact sentence to `STATUS_NOTE.md`.',
          '- **External dependencies:** None. This is a local-only file patch.',
          '- **Owner-only setup:** None.',
          '- **Verification environment:** Local filesystem on the current machine.',
          '- **What counts as done:**',
          '  1. `grep -q "Guildhall benchmark artifact updated." STATUS_NOTE.md` exits 0.',
          '  2. `git diff --stat` shows only `STATUS_NOTE.md` changed.',
          '  3. The original lines in `STATUS_NOTE.md` remain untouched.',
          '- **What must be split or blocked:** Nothing.',
        ].join('\n'),
        acceptanceCriteria: [
          { id: 'ac-1', description: 'STATUS_NOTE.md contains the exact sentence at the end of the file.', verifiedBy: 'automated', met: false },
          { id: 'ac-2', description: 'Existing content remains unchanged.', verifiedBy: 'automated', met: false },
          { id: 'ac-3', description: 'No other files change.', verifiedBy: 'automated', met: false },
        ],
        workUnitAnalysis: {
          summary: 'One deliverable with three proof checks.',
          units: [{
            id: 'unit-1',
            title: 'Patch status note artifact',
            deliverable: 'STATUS_NOTE.md contains the requested sentence while preserving existing content.',
            rationale: 'Content, preservation, and diff checks all verify the same artifact change.',
            dependsOn: [],
          }],
          proofOnlyItems: ['content check', 'diff scope check', 'preservation check'],
          createdAt: '2026-05-30T12:05:00.000Z',
          createdBy: 'coordinator-test',
        },
      },
      changedFiles: ['STATUS_NOTE.md'],
      createdAt: '2026-05-30T12:05:00.000Z',
    })

    expect(plan.score).toBe(1)
    expect(plan.action).toBe('proceed')
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
        workUnitAnalysis: {
          summary: 'Five independently deliverable units are present.',
          units: [
            {
              id: 'unit-billing-ui',
              title: 'Implement billing settings workflow',
              deliverable: 'Billing settings screen updates subscriptions.',
              rationale: 'The UI workflow can be built and reviewed independently.',
              suggestedDomain: 'frontend',
              dependsOn: [],
            },
            {
              id: 'unit-admin-api',
              title: 'Add admin subscription API contract',
              deliverable: 'Admin API returns subscription status.',
              rationale: 'The API contract is independently testable from the UI.',
              suggestedDomain: 'backend',
              dependsOn: [],
            },
            {
              id: 'unit-subscription-migration',
              title: 'Migrate workspace subscription data',
              deliverable: 'Existing workspace subscriptions are backfilled safely.',
              rationale: 'Data migration needs its own proof and rollback boundary.',
              suggestedDomain: 'data',
              dependsOn: [],
            },
            {
              id: 'unit-invite-email',
              title: 'Implement invite email delivery',
              deliverable: 'Invite emails are sent.',
              rationale: 'Email delivery is a separate backend behavior.',
              suggestedDomain: 'backend',
              dependsOn: [],
            },
            {
              id: 'unit-analytics-rollout',
              title: 'Update analytics documentation and rollout evidence',
              deliverable: 'Analytics events and rollout evidence are documented.',
              rationale: 'Docs and rollout proof can be accepted separately from code changes.',
              suggestedDomain: 'docs',
              dependsOn: [],
            },
          ],
          proofOnlyItems: [],
          createdAt: '2026-05-25T12:00:00.000Z',
          createdBy: 'coordinator-test',
        },
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
    expect(plan.action).toBe('decompose_before_execution')
    expect(plan.recommendedChildren).toEqual([])
    expect(plan.factors.map((factor) => factor.id)).toEqual(['semantic_work_units'])
    const childDrafts = buildDecompositionChildDrafts({
      task: {
        id: 'task-billing',
        title: 'Billing settings',
        description: 'Add billing settings, create an admin API endpoint, migrate subscription data, send invite emails, and document analytics rollout.',
        priority: 'critical',
        workUnitAnalysis: {
          summary: 'Five independently deliverable work units.',
          units: [
            {
              id: 'unit-billing-ui',
              title: 'Implement the billing settings workflow',
              deliverable: 'Billing settings can update subscriptions.',
              rationale: 'The UI workflow can be built and reviewed independently.',
              suggestedDomain: 'frontend',
              dependsOn: [],
            },
            {
              id: 'unit-admin-api',
              title: 'Add the admin subscription API contract',
              deliverable: 'Admin API returns subscription status.',
              rationale: 'The API contract can be verified independently from UI work.',
              suggestedDomain: 'backend',
              dependsOn: [],
            },
            {
              id: 'unit-migration',
              title: 'Migrate existing workspace subscription data',
              deliverable: 'Existing workspace subscriptions are backfilled.',
              rationale: 'Data migration safety needs its own proof loop.',
              suggestedDomain: 'data',
              dependsOn: ['unit-admin-api'],
            },
            {
              id: 'unit-invite-email',
              title: 'Implement invite email delivery',
              deliverable: 'Invite emails are sent.',
              rationale: 'Email delivery is a separate backend behavior.',
              suggestedDomain: 'backend',
              dependsOn: [],
            },
            {
              id: 'unit-analytics-rollout',
              title: 'Update analytics documentation and rollout evidence',
              deliverable: 'Analytics events and rollout evidence are documented.',
              rationale: 'Docs and rollout proof can be accepted separately from code changes.',
              suggestedDomain: 'docs',
              dependsOn: [],
            },
          ],
          proofOnlyItems: [],
          createdAt: '2026-05-25T12:00:00.000Z',
          createdBy: 'coordinator-test',
        },
      },
      changedFiles: [
        'src/web/settings/Billing.svelte',
        'src/api/admin/subscriptions.ts',
        'src/email/invites.ts',
        'migrations/20260525_workspace_subscriptions.sql',
        'docs/reference/analytics.md',
      ],
      riskLanes: ['ux_comprehension', 'api_contract', 'data_integrity', 'migration_safety', 'privacy', 'release_risk'],
    })
    expect(childDrafts.map((child) => child.suggestedDomain)).toEqual([
      'frontend',
      'backend',
      'data',
      'backend',
      'docs',
    ])
    expect(childDrafts.every((child) => child.reason.trim().length > 0)).toBe(true)
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

  it('treats broad imported replacement waves as split-required even when source text is short', () => {
    const plan = buildTaskSizePlan({
      task: {
        id: 'task-import-twwvys',
        title: 'Finish the Knit primitive replacement wave beyond the already-migrated toast, dialog base, toolbar button, and tree menu',
        description: 'looma/PROJECT_STATE.md: 1. Finish the Knit primitive replacement wave beyond the already-migrated toast, dialog base, toolbar button, and tree menus.',
        priority: 'normal',
        spec: [
          '## Summary',
          'Build Finish the Knit primitive replacement wave beyond the already-migrated toast, dialog base, toolbar button, and tree menu from the current project evidence.',
          '## Acceptance Criteria',
          '1. Given the existing project conventions and source evidence, when Finish the Knit primitive replacement wave is implemented, then the feature appears in the appropriate repo surface.',
          '## Completion Boundary',
          'Product outcome: A user can use Finish the Knit primitive replacement wave in the intended project surface.',
          'What Guildhall can complete in code: Implement the source intent from the imported planning note.',
          'External dependencies: None.',
          'Owner-only setup: None.',
          'Verification environment: Local repo checks and browser proof.',
          'What counts as done: The source intent is implemented.',
          'What must be split or blocked: Nothing to split.',
        ].join('\n'),
      },
      createdAt: '2026-06-12T21:00:00.000Z',
    })

    expect(plan.action).toBe('decompose_before_execution')
    expect(plan.factors.map((factor) => factor.id)).toContain('broad_imported_program')
    expect(plan.recommendedChildren).toEqual([])
    expect(buildDecompositionChildDrafts({
      task: {
        id: 'task-import-twwvys',
        title: 'Finish the Knit primitive replacement wave beyond the already-migrated toast, dialog base, toolbar button, and tree menu',
        description: 'looma/PROJECT_STATE.md: 1. Finish the Knit primitive replacement wave beyond the already-migrated toast, dialog base, toolbar button, and tree menus.',
        priority: 'normal',
        spec: [
          '## Summary',
          'Build Finish the Knit primitive replacement wave beyond the already-migrated toast, dialog base, toolbar button, and tree menu from the current project evidence.',
        ].join('\n'),
      },
    }).map((child) => child.title)).toEqual([
      'Audit the remaining replacement scope',
      'Implement the first independently verifiable replacement',
      'Verify and update the migration record',
    ])
  })
})
