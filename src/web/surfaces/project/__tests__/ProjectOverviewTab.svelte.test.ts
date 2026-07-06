// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectOverviewTab from '../ProjectOverviewTab.svelte'

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('ProjectOverviewTab', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project/project-graph') {
        return json({ projectGraph: { localProjects: [], structuralDomains: [], dependencyEdges: [], contractSurfaces: [] } })
      }
      return json({})
    }))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('folds orientation spine state into the existing overview sections', () => {
    const { container } = render(ProjectOverviewTab, {
      detail: {
        id: 'narrative-harness',
        name: 'Narrative Harness',
        path: '/Users/matthew/git/oss/narrative-harness',
        tasks: [],
        orientationSpine: {
          scope: { label: 'Current MVP' },
          charter: {
            goal: 'Build a fiction-first evaluation and reasoning harness.',
            targetAudience: 'fiction authors and agent reviewers',
          },
          summary: {
            headline: 'Current MVP is blocked on proof.',
            purpose: 'Build a fiction-first evaluation and reasoning harness.',
            selectedScopeLabel: 'Current MVP',
            includedWorkCount: 3,
            deferredWorkCount: 2,
            progress: {
              scopedNodeCount: 3,
              speccedCount: 2,
              provenCount: 1,
              blockedCount: 1,
              deferredCount: 2,
            },
            pinnedNow: [{
              nodeId: 'work:task-anti-sameness',
              label: 'Anti-sameness safeguards',
              reason: 'Proof needed before release readiness.',
              href: '/task/task-anti-sameness',
            }],
            topBlocker: {
              label: 'Anti-sameness proof missing',
              severity: 'high',
              owner: 'guildhall',
            },
            nextAction: {
              label: 'Prove anti-sameness safeguards',
              href: '/task/task-anti-sameness',
              reason: 'This is the active release blocker.',
            },
          },
          gaps: [{
            kind: 'proof_needed',
            label: 'Anti-sameness proof missing',
            severity: 'warn',
            refs: ['task-anti-sameness'],
          }],
          roots: [{
            id: 'work:task-anti-sameness',
            title: 'Anti-sameness safeguards',
            maturity: 'proof_needed',
            proof: { state: 'needed' },
            refs: { taskIds: ['task-anti-sameness'] },
            blockers: [],
          }],
          nodes: {
            'work:task-anti-sameness': {
              id: 'work:task-anti-sameness',
              title: 'Anti-sameness safeguards',
              maturity: 'proof_needed',
              proof: { state: 'needed' },
              refs: { taskIds: ['task-anti-sameness'] },
              blockers: [],
            },
          },
          sourceHealth: { status: 'ok' },
        },
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting for owner action.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'narrative-harness',
    })

    expect(container.querySelector('.orientation-state')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'State of the Union' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Current scope map' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'What needs attention' })).not.toBeInTheDocument()
    expect(container.querySelector('.project-map-section')).toBeNull()
    expect(container.querySelector('.overview-orientation')).toBeTruthy()
    expect(container.querySelector('.orientation-summary-list')).toBeTruthy()
    expect(container.querySelector('.orientation-map-preview')).toBeTruthy()
    expect(screen.getByText('Current MVP')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Project map' })).toBeInTheDocument()
    expect(screen.getByText('Open map')).toBeInTheDocument()
    expect(screen.getByText(/3 work items in view/)).toBeInTheDocument()
    expect(screen.getByText(/1 verified/)).toBeInTheDocument()
    expect(screen.getAllByText(/1 blocked/).length).toBeGreaterThan(0)
    expect(screen.getByText(/1 missing verification/)).toBeInTheDocument()
    expect(screen.getByText(/2 deferred/)).toBeInTheDocument()
    expect(screen.getByText(/Current focus: Anti-sameness safeguards/)).toBeInTheDocument()
    expect(screen.getByText(/Anti-sameness proof missing/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Do this next' })).toBeInTheDocument()
  })

  it('shows current release readiness from child repo git state', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'looma-knit',
        name: 'Looma + Knit',
        path: '/Users/matthew/git/oss/looma-knit',
        tasks: [],
        releaseReadiness: {
          release: { id: 'stage-1', label: 'Stage 1: V1 Release Hardening', kind: 'release', state: 'active', source: 'release_plan' },
          scope: { id: 'stage-1', label: 'Stage 1: V1 Release Hardening', kind: 'release', state: 'active', source: 'release_plan' },
          ready: false,
          totals: {
            tasks: 9,
            done: 0,
            unfinishedCount: 9,
            humanBlockingCount: 1,
            gitStoryBlockingCount: 2,
            dirtyCheckoutBlockingCount: 1,
          },
          gitStory: {
            ready: false,
            state: 'dirty_uncommitted',
            blockers: [
              {
                id: 'repo:looma',
                label: 'Looma: codex/component-audit-roadmap',
                state: 'pushed',
                reason: 'codex/component-audit-roadmap is pushed.',
                nextAction: 'Open a PR or mark this pushed branch as the intended repository state.',
              },
              {
                id: 'repo:knit',
                label: 'Knit: main',
                state: 'dirty_uncommitted',
                reason: '28 changed files are not committed.',
                nextAction: 'Review the diff, then commit or mark the work local-only/deferred.',
              },
            ],
            snapshots: [
              { repoId: 'looma', repoLabel: 'Looma', state: 'pushed' },
              { repoId: 'knit', repoLabel: 'Knit', state: 'dirty_uncommitted' },
            ],
          },
        },
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'looma-knit',
    })

    expect(screen.getByRole('heading', { name: 'Current release' })).toBeInTheDocument()
    expect(screen.getByText('Not complete')).toBeInTheDocument()
    expect(screen.queryByText('Not ready')).toBeNull()
    expect(screen.getByText('Stage 1: V1 Release Hardening')).toBeInTheDocument()
    expect(screen.getByText(/0 \/ 9 done/)).toBeInTheDocument()
    expect(screen.getByText(/9 unfinished/)).toBeInTheDocument()
    expect(screen.getByText(/Looma: codex\/component-audit-roadmap/)).toBeInTheDocument()
    expect(screen.getByText(/Knit: main/)).toBeInTheDocument()
  })

  it('separates completed release work from repository follow-up blockers', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'narrative-harness',
        name: 'Narrative Harness',
        path: '/Users/matthew/git/oss/narrative-harness',
        tasks: [],
        releaseReadiness: {
          release: { id: 'near-term-proof-scope', label: 'Near-term proof scope', kind: 'scope', state: 'active', source: 'current_scope' },
          scope: { id: 'near-term-proof-scope', label: 'Near-term proof scope', kind: 'scope', state: 'active', source: 'current_scope' },
          ready: false,
          notReadyReason: 'Repository follow-up required.',
          totals: {
            tasks: 14,
            done: 14,
            unfinishedCount: 0,
            humanBlockingCount: 0,
            gitStoryBlockingCount: 1,
            dirtyCheckoutBlockingCount: 0,
          },
          gitStory: {
            ready: false,
            state: 'ahead_unpushed',
            blockers: [{
              id: 'repo:narrative-harness',
              label: 'main',
              state: 'ahead_unpushed',
              reason: 'main has 6 local commits not pushed to origin/main.',
              nextAction: 'Push the local commits or mark them intentionally local.',
            }],
            snapshots: [{ repoId: 'narrative-harness', repoLabel: 'Narrative Harness', state: 'ahead_unpushed' }],
          },
        },
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'narrative-harness',
    })

    expect(screen.getByText('Work complete')).toBeInTheDocument()
    expect(screen.queryByText('Not complete')).not.toBeInTheDocument()
    expect(screen.getByText('Near-term proof scope')).toBeInTheDocument()
    expect(screen.getByText(/14 \/ 14 done/)).toBeInTheDocument()
    expect(screen.getByText(/main has 6 local commits not pushed to origin\/main/)).toBeInTheDocument()
  })

  it('labels proof waits as waiting instead of blocking when scoped blocked count is zero', () => {
    const { container } = render(ProjectOverviewTab, {
      detail: {
        id: 'narrative-harness',
        name: 'Narrative Harness',
        path: '/Users/matthew/git/oss/narrative-harness',
        tasks: [],
        orientationSpine: {
          scope: { label: 'Current task scope' },
          charter: {
            goal: 'Build a headless fiction harness.',
            targetAudience: 'Authors and agent builders.',
          },
          summary: {
            headline: 'Current task scope is waiting on proof.',
            purpose: 'Build a headless fiction harness.',
            selectedScopeLabel: 'Current task scope',
            includedWorkCount: 6,
            deferredWorkCount: 12,
            progress: {
              total: 18,
              specced: 6,
              blocked: 0,
              deferred: 12,
            },
            pinnedNow: ['Implement a no-UI runner that builds a packet from fixture records.'],
            topBlocker: 'Define fixture, expected-record, prototype-run, and evaluation schemas is waiting for spec review.',
            nextAction: 'Review waiting work: Define fixture, expected-record, prototype-run, and evaluation schemas is waiting for spec review.',
          },
          gaps: [{
            kind: 'proof_needed',
            label: 'Proof needed: Implement a no-UI runner that builds a packet from fixture records.',
            severity: 'warn',
            refs: ['task-import-14yqvl7'],
          }],
          roots: [],
          nodes: {},
          sourceHealth: { inferred: 4, gaps: 1 },
        },
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting for proof.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'narrative-harness',
    })

    const orientation = container.querySelector('.overview-orientation')
    expect(orientation).toBeTruthy()
    expect(orientation?.textContent).toContain('0 blocked')
    expect(orientation?.textContent).toContain('Waiting on: Define fixture, expected-record, prototype-run, and evaluation schemas is waiting for spec review.')
    expect(orientation?.textContent).not.toContain('Blocking: Define fixture')
  })

  it('presents all-terminal scoped work as calm finished state instead of attention needed', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'narrative-harness',
        name: 'Narrative Harness',
        path: '/Users/matthew/git/oss/narrative-harness',
        startReadiness: {
          canStart: false,
          code: 'all_terminal',
          message: 'No actionable tasks remain: 11 done, 0 blocked, 3 shelved.',
        },
        actionModel: {
          primaryAction: null,
          secondaryActions: [],
          runControl: {
            label: 'No runnable tasks',
            startEnabled: false,
            disabledReason: 'No actionable tasks remain: 11 done, 0 blocked, 3 shelved.',
          },
          ownerInput: { active: false },
          setup: { state: 'ready', freshIntakeNeeded: false },
        },
        tasks: [
          { id: 'done-1', title: 'Done one', status: 'done' },
          { id: 'shelved-1', title: 'Shelved duplicate', status: 'shelved' },
        ],
        orientationSpine: {
          scope: { label: 'Current MVP' },
          charter: {
            goal: 'The first MVP is headless: script-only proofs of all systems.',
            targetAudience: 'fiction authors and agent reviewers',
          },
          summary: {
            headline: 'Current MVP has no actionable work.',
            purpose: 'The first MVP is headless: script-only proofs of all systems.',
            selectedScopeLabel: 'Current MVP',
            includedWorkCount: 14,
            deferredWorkCount: 0,
            progress: {
              total: 14,
              specced: 11,
              done: 11,
              blocked: 0,
              proven: 0,
              deferred: 3,
            },
            pinnedNow: [],
            topBlocker: null,
            nextAction: null,
          },
          gaps: [],
          roots: [],
          nodes: {},
          sourceHealth: { status: 'ok', gaps: 0, inferred: 0 },
        },
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Run finished',
        actorLabel: 'Guildhall',
        message: 'No actionable tasks remain: 11 done, 0 blocked, 3 shelved.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'narrative-harness',
    })

    expect(screen.getByText('Closed scope')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Scope status' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Do this next' })).not.toBeInTheDocument()
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No actionable tasks remain: 11 done, 0 blocked, 3 shelved.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No runnable work' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Ready to resume' })).not.toBeInTheDocument()
    expect(screen.getByText(/3 deferred/)).toBeInTheDocument()
    expect(screen.getByText(/0 missing verification/)).toBeInTheDocument()
    expect(screen.getByText('The selected scope is complete. Choose another release or open Work to inspect completed and deferred items.')).toBeInTheDocument()
    expect(screen.queryByText('The next run is blocked until the project blocker is resolved.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Blocked/ })).not.toBeInTheDocument()
  })

  it('renders the shared primary project action instead of choosing a local inbox winner', () => {
    const { container } = render(ProjectOverviewTab, {
      detail: {
        id: 'fair-labor-license',
        name: 'Fair Labor License',
        path: '/Users/matthew/git/oss/fair-labor-license',
        tasks: [
          {
            id: 'task-stripe-brief',
            title: 'Clean up the Stripe checkout brief',
            status: 'ready',
          },
        ],
        startReadiness: { canStart: true },
        actionModel: {
          primaryAction: {
            source: 'task',
            label: 'Clean up the Stripe checkout brief',
            detail: 'Finish the active brief cleanup before reconciling stale discovery.',
            buttonLabel: 'Open Work',
            href: '/work',
            tone: 'warn',
          },
          secondaryActions: [{
            source: 'inbox',
            label: 'Review project discovery update',
            detail: 'Review the reconciliation later.',
            buttonLabel: 'Review update',
            href: '/workspace-import?mode=reconcile',
            tone: 'warn',
          }],
          runControl: {
            label: 'Resume',
            startEnabled: true,
          },
          ownerInput: { active: false },
          setup: { state: 'ready', freshIntakeNeeded: false },
        },
      },
      inboxLoaded: true,
      inboxItems: [
        {
          kind: 'project_understanding',
          severity: 'high',
          title: 'Review project discovery update',
          detail: 'Review the reconciliation later.',
          actionHref: '/workspace-import?mode=reconcile',
        },
      ],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting for owner action.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'fair-labor-license',
    })

    expect(screen.getByRole('heading', { name: 'Clean up the Stripe checkout brief' })).toBeInTheDocument()
    expect(screen.getByText('Finish the active brief cleanup before reconciling stale discovery.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open work/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review project discovery update' })).not.toBeInTheDocument()
  })

  it('renders same-task alert inbox items with distinct action hrefs', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'fair-labor-license',
        name: 'Fair Labor License',
        path: '/Users/matthew/git/oss/fair-labor-license',
        tasks: [],
      },
      inboxLoaded: true,
      inboxItems: [
        {
          kind: 'import_draft_queue',
          severity: 'medium',
          taskId: 'task-006',
          title: 'Set the platform fee policy',
          detail: 'Review the imported draft and decide whether to shape it now.',
          actionHref: '/task/task-006',
        },
        {
          kind: 'import_draft_queue',
          severity: 'medium',
          taskId: 'task-006',
          title: 'Set the platform fee policy',
          detail: 'Review the second imported draft and decide whether to shape it now.',
          actionHref: '/task/task-006?source=second',
        },
      ],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting for owner action.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'fair-labor-license',
    })

    expect(screen.getByRole('heading', { name: 'Fair Labor License' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Set the platform fee policy/ })).toHaveLength(2)
  })

  it('shows full task content on the overview detail path even when the title is compact', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'fair-labor-license',
        name: 'Fair Labor License',
        path: '/Users/matthew/git/oss/fair-labor-license',
        tasks: [],
      },
      inboxLoaded: true,
      inboxItems: [
        {
          kind: 'import_draft_queue',
          severity: 'medium',
          taskId: 'task-006',
          title: 'We should have a system-wide policy of how much FLL charges on overhe...',
          detail: 'We should have a system-wide policy of how much FLL charges on overhead for maintenance fees etc.',
          actionHref: '/task/task-006',
        },
      ],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting for owner action.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'fair-labor-license',
    })

    expect(screen.getAllByText('We should have a system-wide policy of how much FLL charges on overhead for maintenance fees etc.').length).toBeGreaterThan(0)
  })

  it('uses the project-discovery action label instead of a generic Open button', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'looma-knit',
        name: 'Looma + Knit',
        path: '/Users/matthew/git/oss/looma-knit',
        tasks: [],
      },
      inboxLoaded: true,
      inboxItems: [
        {
          kind: 'project_understanding',
          severity: 'high',
          title: 'Review project discovery update',
          detail: 'More planning docs and migrations can now be scanned. Review the reconciliation to update or dismiss stale imported work.',
          actionHref: '/workspace-import?mode=reconcile',
        },
      ],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting for owner action.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'looma-knit',
    })

    expect(screen.getByRole('button', { name: /review update/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^open$/i })).not.toBeInTheDocument()
  })

  it('uses start readiness as the authoritative next action over lower-priority discovery items', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'fair-labor-license',
        name: 'Fair Labor License',
        path: '/Users/matthew/git/oss/fair-labor-license',
        tasks: [
          {
            id: 'task-oauth',
            title: 'Configure Google OAuth credentials',
            status: 'blocked',
            blockReason: 'Owner credentials are required.',
          },
        ],
        startReadiness: {
          canStart: false,
          code: 'owner_input_required',
          message: 'Choose a recovery path for the blocked task',
          actionHref: '/task/task-oauth',
        },
      },
      inboxLoaded: true,
      inboxItems: [
        {
          kind: 'project_understanding',
          severity: 'high',
          title: 'Review project discovery update',
          detail: 'More planning docs and migrations can now be scanned.',
          actionHref: '/workspace-import?mode=reconcile',
        },
        {
          kind: 'workspace_import_pending',
          severity: 'medium',
          taskId: 'task-oauth',
          title: 'Configure Google OAuth credentials',
          detail: 'Owner credentials are required.',
          actionHref: '/workspace-import',
        },
      ],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting for owner action.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'fair-labor-license',
    })

    expect(screen.getByRole('heading', { name: 'Choose a recovery path for the blocked task' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open item/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Review project discovery update' })).not.toBeInTheDocument()
  })

  it('communicates scoped orientation instead of stale draft backlog when a migration blocks execution', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'looma-knit',
        name: 'Looma + Knit',
        path: '/Users/matthew/git/oss/looma-knit',
        tasks: [
          { id: 'task-import-a', title: 'Version diff view (deferred)', status: 'import_draft' },
          { id: 'task-current', title: 'Lock overlay positioning vocabulary before more overlay APIs ship', status: 'ready' },
        ],
        workProgress: {
          counts: {
            visibleTotal: 294,
            visibleActive: 290,
            visibleBlocked: 0,
            visibleDone: 1,
            visibleShelved: 3,
            deliveryTotal: 4,
            deliveryRequired: 4,
            deliveryDone: 4,
            deliveryBlocked: 0,
          },
          byTaskId: {},
        },
        startReadiness: {
          canStart: false,
          code: 'required_migration_pending',
          message: 'Run required Guildhall migration 0.11.0/execution-planning-decomposition before starting this project.',
          actionHref: '/migrations',
        },
        actionModel: {
          primaryAction: {
            source: 'start_readiness',
            label: 'Required migration',
            detail: 'Run required Guildhall migration 0.11.0/execution-planning-decomposition before starting this project.',
            buttonLabel: 'Migrate project',
            href: '/migrations',
            tone: 'danger',
            code: 'required_migration_pending',
          },
          secondaryActions: [],
          runControl: {
            label: 'Migrate',
            startEnabled: false,
            disabledReason: 'Run required Guildhall migration 0.11.0/execution-planning-decomposition before starting this project.',
            href: '/migrations',
          },
          ownerInput: { active: false },
          setup: { state: 'blocked', freshIntakeNeeded: false },
        },
        orientationSpine: {
          scope: { label: 'Current task scope' },
          charter: {
            goal: 'Keep Looma generic while letting Knit product needs drive Looma primitive priority.',
            targetAudience: 'Looma and Knit maintainers',
          },
          summary: {
            headline: 'Stage 1: V1 Release Hardening is the current scoped milestone.',
            purpose: 'Keep Looma generic while letting Knit product needs drive Looma primitive priority.',
            selectedScopeLabel: 'Current task scope',
            includedWorkCount: 48,
            deferredWorkCount: 25,
            progress: {
              total: 73,
              specced: 1,
              proven: 0,
              blocked: 0,
              deferred: 25,
            },
            pinnedNow: ['Lock overlay positioning vocabulary before more overlay APIs ship'],
            topBlocker: 'Run required Guildhall migration 0.11.0/execution-planning-decomposition before starting this project.',
            nextAction: 'Resolve the current start blocker.',
          },
          gaps: [],
          roots: [],
          nodes: {},
          sourceHealth: { status: 'ok', inferred: 50, gaps: 1 },
        },
      },
      inboxLoaded: true,
      inboxItems: [
        {
          kind: 'required_migration',
          severity: 'high',
          migrationId: '0.11.0/execution-planning-decomposition',
          title: 'Required migration: Convert legacy split recommendations into execution-planning records',
          detail: 'Run this migration before the project can update.',
          actionHref: '/migrations',
          blocking: true,
          dismissible: false,
          source: { system: 'migrations', id: '0.11.0/execution-planning-decomposition' },
        },
        {
          kind: 'import_draft_queue',
          severity: 'medium',
          taskId: 'task-import-a',
          title: '250 imported drafts need task briefs',
          detail: 'Start with "Version diff view (deferred)". 249 more imported drafts are waiting behind it.',
          actionHref: '/task/task-import-a',
        },
      ],
      projectTicker: {
        label: 'Needs migration',
        actorLabel: 'Guildhall',
        message: 'Required migration blocks project execution.',
        tone: 'warn',
        pulse: false,
      },
      activeProjectId: 'looma-knit',
    })

    expect(screen.getByRole('heading', { name: 'Required migration' })).toBeInTheDocument()
    expect(screen.getByText(/48 work items in view/)).toBeInTheDocument()
    expect(screen.getByText(/25 deferred/)).toBeInTheDocument()
    expect(screen.getByText('48 Current scope')).toBeInTheDocument()
    expect(screen.getByText('25 Deferred')).toBeInTheDocument()
    expect(screen.queryByText(/250 imported drafts need task briefs/)).not.toBeInTheDocument()
    expect(screen.queryByText(/294 total work items/)).not.toBeInTheDocument()
    expect(screen.queryByText(/255 Being shaped/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Ready to resume' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Execution blocked' })).toBeInTheDocument()
  })

  it('treats ready tasks with incomplete worker handoffs as brief cleanup on the dashboard', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'fair-labor-license',
        name: 'Fair Labor License',
        path: '/Users/matthew/git/oss/fair-labor-license',
        startReadiness: {
          canStart: false,
          code: 'no_unattended_progress',
          message: '"Set FLL overhead charge policy" needs a clearer brief before unattended work can run.',
          actionHref: '/work?task=task-006',
          focusTaskId: 'task-006',
          focusTaskTitle: 'Set FLL overhead charge policy',
          focusKind: 'brief_cleanup',
          count: 1,
        },
        tasks: [
          {
            id: 'task-006',
            title: 'Set FLL overhead charge policy',
            status: 'ready',
            domain: 'frontend',
            productBrief: {
              approvedAt: '2026-06-02T12:00:00.000Z',
              userJob: '',
            },
            acceptanceCriteria: [],
            spec: '',
          },
        ],
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting for owner action.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'fair-labor-license',
    })

    expect(screen.getByText('1 Being shaped')).toBeInTheDocument()
    expect(screen.queryByText('1 Ready')).not.toBeInTheDocument()
    expect(screen.getAllByText('Needs brief').length).toBeGreaterThan(0)
    expect(screen.getByText('Needs brief: add enough detail before this can start.')).toBeInTheDocument()
    expect(screen.queryByText(/ready for the next worker slot/i)).not.toBeInTheDocument()
  })

  it('does not invite new work when a migration blocks an empty project', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'commerce-project',
        name: 'Commerce project',
        path: '/Users/matthew/git/oss/commerce-project',
        tasks: [],
        startReadiness: {
          canStart: false,
          code: 'required_migration_pending',
          message: 'Run required Guildhall migration 0.8.0/project-state-layout before starting this project.',
          actionHref: '/migrations',
        },
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Needs migration',
        actorLabel: 'Needs migration',
        message: 'Run required Guildhall migration 0.8.0/project-state-layout before starting this project.',
        tone: 'warn',
        pulse: false,
      },
      activeProjectId: 'commerce-project',
    })

    expect(screen.getByText('Run the required migration before creating or running work.')).toBeInTheDocument()
    expect(screen.getByText('The next run is blocked until the required migration is applied.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Migrate project' }).querySelector('svg')).toBeInTheDocument()
    expect(screen.queryByText('No tasks yet. Create a request when you are ready.')).not.toBeInTheDocument()
  })

  it('uses a compact chip for blocked-work status instead of a separate status panel', () => {
    const { container } = render(ProjectOverviewTab, {
      detail: {
        id: 'fair-labor-license',
        name: 'Fair Labor License',
        path: '/Users/matthew/git/oss/fair-labor-license',
        tasks: [
          {
            id: 'task-006',
            title: 'Set FLL overhead charge policy',
            status: 'blocked',
            blockReason: 'Guildhall found useful context but did not save the next draft.',
          },
        ],
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting for owner action.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'fair-labor-license',
    })

    expect(screen.getByText('Needs triage')).toBeInTheDocument()
    expect(screen.queryByText(/^Status$/i)).not.toBeInTheDocument()
    expect(container.querySelector('.blocked-work-list .overview-task-row')).toBeTruthy()
  })

  it('recovers full overview task titles from descriptions when imported titles are compact', () => {
    const compactTitle = 'Continue the Knit-to-Looma promotion work from the now-complete first M6 queue into the next generic surfaces, while the'
    const fullTitle = 'Continue the Knit-to-Looma promotion work from the now-complete first M6 queue into the next generic surfaces, while the primitive normalization wave continues in Knit.'

    render(ProjectOverviewTab, {
      detail: {
        id: 'looma-knit',
        name: 'Looma + Knit',
        path: '/Users/matthew/git/oss/looma-knit',
        tasks: [
          {
            id: 'task-import-1v8sume',
            title: compactTitle,
            description: `looma/PROJECT_STATE.md: 3. ${fullTitle}`,
            status: 'blocked',
            blockReason: 'Spec shaping can be retried.',
          },
        ],
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting for owner action.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'looma-knit',
    })

    expect(screen.getAllByText(fullTitle).length).toBeGreaterThanOrEqual(2)
    expect(screen.queryAllByText(compactTitle)).toHaveLength(0)
  })

  it('keeps blocked-work chips as compact categories instead of dependency task titles', () => {
    const { container } = render(ProjectOverviewTab, {
      detail: {
        id: 'fair-labor-license',
        name: 'Fair Labor License',
        path: '/Users/matthew/git/oss/fair-labor-license',
        tasks: [
          {
            id: 'task-006-split-implement-invite-email-delivery',
            title: 'Add OAuth providers — Google and Apple sign-in',
            status: 'done',
          },
          {
            id: 'task-oauth-google-provider-credentials',
            title: 'Create Google OAuth provider credentials',
            status: 'blocked',
            blockReason: 'Waiting on Google Cloud OAuth client setup outside the repo.',
            dependsOn: ['task-006-split-implement-invite-email-delivery'],
          },
          {
            id: 'task-oauth-apple-provider-credentials',
            title: 'Create Apple OAuth provider credentials',
            status: 'blocked',
            blockReason: 'Waiting on Apple Developer Sign in with Apple setup outside the repo.',
            dependsOn: ['task-006-split-implement-invite-email-delivery'],
          },
          {
            id: 'task-oauth-supabase-provider-configuration',
            title: 'Configure Supabase Google and Apple auth providers',
            status: 'blocked',
            blockReason: 'Waiting on Google and Apple provider credentials, plus permission or owner action to update Supabase Auth provider settings.',
            dependsOn: [
              'task-oauth-google-provider-credentials',
              'task-oauth-apple-provider-credentials',
            ],
          },
        ],
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting for owner action.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'fair-labor-license',
    })

    const chipLabels = Array.from(container.querySelectorAll('.blocked-work-list .chip')).map(chip => chip.textContent?.trim() ?? '')

    expect(chipLabels).toEqual(['Provider settings', 'Provider settings', 'Provider settings'])
    expect(chipLabels).not.toContain('Add OAuth providers — Google and Apple sign-in')
    expect(chipLabels).not.toContain('Create Google OAuth provider credentials, Create Apple OAuth provider credentials')
  })

  it('uses the shared overview task row for moving and blocked task cards', () => {
    const { container } = render(ProjectOverviewTab, {
      detail: {
        id: 'fair-labor-license',
        name: 'Fair Labor License',
        path: '/Users/matthew/git/oss/fair-labor-license',
        tasks: [
          {
            id: 'task-006',
            title: 'Set FLL overhead charge policy',
            status: 'in_progress',
            domain: 'frontend',
          },
          {
            id: 'task-007',
            title: 'Complete auth flow — profile management + email confirmation',
            status: 'blocked',
            blockReason: 'Security vulnerability in callback.vue.',
          },
        ],
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting for owner action.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'fair-labor-license',
    })

    expect(container.querySelector('.motion-list .overview-task-row')).toBeTruthy()
    expect(container.querySelector('.blocked-work-list .overview-task-row')).toBeTruthy()
    expect(screen.getAllByText('Paused').length).toBeGreaterThan(0)
    expect(screen.getByText('Needs triage')).toBeInTheDocument()
  })

  it('does not show resolved historical escalations as blocked work', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'fair-labor-license',
        name: 'Fair Labor License',
        path: '/Users/matthew/git/oss/fair-labor-license',
        tasks: [
          {
            id: 'task-listings-basic',
            title: 'Basic project listing',
            status: 'in_progress',
            runtime: { openEscalationIds: [] },
            escalations: [
              {
                id: 'esc-task-listings-basic-3',
                summary: "Verification commands don't work in this environment but implementation is complete",
                raisedAt: '2026-05-26T01:07:11.799Z',
              },
            ],
          },
        ],
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Live',
        actorLabel: 'Coordinator',
        message: 'Basic project listing is in progress.',
        tone: 'active',
        pulse: true,
      },
      activeProjectId: 'fair-labor-license',
    })

    expect(screen.getByText('No blocked tasks are visible right now.')).toBeInTheDocument()
    expect(screen.queryByText("Verification commands don't work in this environment but implementation is complete")).not.toBeInTheDocument()
    expect(screen.queryByText('Needs triage')).not.toBeInTheDocument()
  })

  it('does not show ready tasks with stale block reasons as blocked work', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'fair-labor-license',
        name: 'Fair Labor License',
        path: '/Users/matthew/git/oss/fair-labor-license',
        tasks: [
          {
            id: 'task-stripe-integration',
            title: 'Stripe Connect',
            status: 'ready',
            blockReason: 'Guildhall could not create a task worktree: missing future server directory.',
          },
        ],
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'fair-labor-license',
    })

    expect(screen.getByText('No blocked tasks are visible right now.')).toBeInTheDocument()
    expect(screen.queryByText('Needs triage')).not.toBeInTheDocument()
  })

  it('puts work mix in the orientation section while keeping live work in the work section', () => {
    const { container } = render(ProjectOverviewTab, {
      detail: {
        id: 'fair-labor-license',
        name: 'Fair Labor License',
        path: '/Users/matthew/git/oss/fair-labor-license',
        run: { status: 'running' },
        tasks: [
          {
            id: 'task-listings-basic',
            title: 'Basic project listing',
            status: 'in_progress',
            domain: 'frontend',
          },
          {
            id: 'task-stripe-integration',
            title: 'Stripe Connect',
            status: 'ready',
          },
        ],
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Live',
        actorLabel: 'Coordinator',
        message: 'Working on 2 tasks',
        tone: 'active',
        pulse: true,
      },
      activeProjectId: 'fair-labor-license',
    })

    const orientation = container.querySelector('.overview-orientation')
    expect(orientation?.textContent).toContain('Work mix')
    expect(orientation?.textContent).not.toContain('Plan status')
    expect(orientation?.querySelector('.motion-list')).toBeFalsy()

    const workSection = container.querySelector('.overview-work-section')
    expect(workSection?.textContent).toContain('Moving now')
    expect(workSection?.querySelector('.motion-list')).toBeTruthy()
  })

  it('surfaces runtime health, memory health, and primary proof paths', async () => {
    const source = readFileSync('src/web/surfaces/project/ProjectOverviewTab.svelte', 'utf-8')
    expect(source).not.toMatch(/semantic (?:on|off)|compaction (?:on|off|ready|pending)|Mastra substrate/)

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project/project-graph') {
        return json({
          projectGraph: {
            currentProject: { id: 'guildhall', label: 'Guildhall' },
            localProjects: [
              { id: 'guildhall', label: 'Guildhall', role: 'current' },
              { id: 'narrative-harness', label: 'Narrative Harness', role: 'index' },
            ],
            structuralDomains: [
              { id: 'domain:runtime', label: 'Runtime' },
              { id: 'domain:overview', label: 'Overview' },
            ],
            dependencyEdges: [{ id: 'edge-1', unresolved: true }],
            contractSurfaces: [
              { id: 'surface:overview', label: 'Overview summary model' },
              { id: 'surface:project-graph', label: 'Project graph API' },
            ],
          },
        })
      }
      return json({})
    }))

    render(ProjectOverviewTab, {
      detail: {
        id: 'guildhall',
        name: 'Guildhall',
        path: '/Users/matthew/git/oss/guildhall',
        run: { status: 'stopped' },
        runtime: {
          status: 'stopped',
          health: { status: 'healthy' },
          migration: { mode: 'host-run' },
        },
        memoryHealth: {
          total: 6,
          active: 3,
          proposed: 2,
          used: 1,
          memoryCore: {
            adapter: 'mastra',
            fallbackUsed: false,
            semanticRecallEnabled: false,
            observationalMemoryEnabled: false,
            observationalProcessorReady: false,
            compactionStatus: 'active',
            semanticValidity: 'valid',
            repoLocalWrites: [],
          },
        },
        tasks: [
          {
            id: 'task-runtime-ui',
            title: 'Runtime UI',
            status: 'ready',
            proofPaths: [{
              id: 'proof-runtime',
              title: 'Verify runtime card',
              summary: 'Check that runtime health is visible.',
              status: 'planned',
            }],
          },
        ],
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'guildhall',
    })

    expect(screen.getAllByText('Runtime stopped').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Compatibility mode/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Memory health').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Memory protected/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/auto-compacted/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/semantically valid/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/source-backed/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/project repo protected/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/3 active/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/active memories/)).not.toBeInTheDocument()
    expect(screen.getByText('Signals')).toBeInTheDocument()
    expect(screen.getByText('Verification')).toBeInTheDocument()
    expect(screen.getAllByText('Verify runtime card').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Project graph/i })).not.toBeInTheDocument()
  })

  it('keeps project knowledge summary compact and action-light', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      projectGraph: {
        currentProject: { id: 'narrative-harness', label: 'Narrative Harness' },
        localProjects: [{ id: 'narrative-harness', label: 'Narrative Harness', role: 'current' }],
        localProjectIndex: [
          { id: 'narrative-harness', label: 'Narrative Harness', role: 'current' },
          { id: 'guildhall', label: 'Guildhall', role: 'indexed' },
        ],
        structuralDomains: [{ id: 'domain:story-memory', label: 'Story memory' }],
        dependencyEdges: [],
        contractSurfaces: [{ id: 'surface:story-context', label: 'Story context contract' }],
      },
    })))

    const { container } = render(ProjectOverviewTab, {
      detail: {
        id: 'narrative-harness',
        name: 'Narrative Harness',
        path: '/Users/matthew/git/oss/narrative-harness',
        runtime: { status: 'running', health: { status: 'healthy' }, migration: { mode: 'host-run' } },
        memoryHealth: { active: 4, proposed: 1 },
        tasks: [
          { id: 'task-active', title: 'Reviewer lane MVP', status: 'in_progress' },
          { id: 'task-done', title: 'Draft context schema', status: 'done' },
        ],
        structuralMapReview: {
          state: 'accepted',
          counts: { domains: 1, crossCuttingDomains: 1, packages: 2, executableUnits: 3 },
        },
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Live',
        actorLabel: 'Guildhall',
        message: 'Project is running.',
        tone: 'active',
        pulse: true,
      },
      activeProjectId: 'narrative-harness',
    })

    expect(container.querySelectorAll('.card-list-item.knowledge-summary-item')).toHaveLength(2)
    expect(container.querySelectorAll('.knowledge-card')).toHaveLength(0)
    expect(screen.getByRole('button', { name: /Work 2 total work items/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /History No recent changes/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Runtime Runtime healthy/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Checks No verification/i })).not.toBeInTheDocument()
    expect(screen.getAllByText('Compatibility mode').length).toBeGreaterThan(0)
    expect(screen.getByText('Memory status unavailable · 4 active, 1 proposed.')).toBeInTheDocument()
    expect(screen.queryByText(/active memories/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Structure Accepted/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Project graph/i })).not.toBeInTheDocument()
  })

  it('puts the primary next action beside the compact orientation summary before secondary overview cards', () => {
    const { container } = render(ProjectOverviewTab, {
      detail: {
        id: 'looma-knit',
        name: 'Looma + Knit',
        path: '/Users/matthew/git/oss/looma-knit',
        tasks: [
          { id: 'task-active', title: 'Finish reviewer routing', status: 'in_progress' },
          { id: 'task-ready', title: 'Document next proof', status: 'ready' },
        ],
        actionModel: {
          primaryAction: {
            source: 'task',
            label: 'Finish reviewer routing',
            detail: 'Keep the active implementation moving before starting other work.',
            buttonLabel: 'Open Work',
            href: '/work',
            tone: 'accent',
          },
          secondaryActions: [],
          runControl: { label: 'Resume', startEnabled: true },
          ownerInput: { active: false },
          setup: { state: 'ready', freshIntakeNeeded: false },
        },
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Live',
        actorLabel: 'Guildhall',
        message: 'Project is running.',
        tone: 'active',
        pulse: true,
      },
      activeProjectId: 'looma-knit',
    })

    const orientation = container.querySelector('.overview-orientation')
    expect(orientation).toBeTruthy()
    expect(orientation?.querySelector('.next-action')).toBeTruthy()
    expect(orientation?.querySelector('.orientation-summary-list')).toBeTruthy()
    expect(orientation?.textContent).toContain('Work mix')
    expect(orientation?.textContent).not.toContain('Plan status')
    expect(orientation?.querySelector('.motion-list')).toBeFalsy()

    const nextHeading = orientation?.querySelector('.next-action h2')
    expect(nextHeading).toHaveTextContent('Finish reviewer routing')

    const workSection = container.querySelector('.overview-work-section')
    expect(workSection?.querySelector('.motion-list')).toBeTruthy()
  })

  it('routes knowledge summary sections to their logical project surfaces', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      projectGraph: {
        currentProject: { id: 'guildhall', label: 'Guildhall' },
        localProjects: [{ id: 'guildhall', label: 'Guildhall', role: 'current' }],
        structuralDomains: [{ id: 'domain:runtime', label: 'Runtime' }],
        dependencyEdges: [],
        contractSurfaces: [{ id: 'surface:overview', label: 'Overview summary model' }],
      },
    })))

    window.history.replaceState({}, '', '/projects/guildhall/overview')
    render(ProjectOverviewTab, {
      detail: {
        id: 'guildhall',
        name: 'Guildhall',
        path: '/Users/matthew/git/oss/guildhall',
        runtime: { status: 'stopped', health: { status: 'healthy' }, migration: { mode: 'host-run' } },
        memoryHealth: { active: 2, proposed: 0 },
        tasks: [
          {
            id: 'task-proof',
            title: 'Verify overview links',
            status: 'ready',
            proofPaths: [{ id: 'proof-route', title: 'Rendered route smoke', status: 'pending' }],
          },
        ],
        structuralMapReview: {
          state: 'accepted',
          counts: { domains: 1, crossCuttingDomains: 0, packages: 1, executableUnits: 1 },
        },
        recentEvents: [{ type: 'task.updated', taskId: 'task-proof', createdAt: '2026-06-04T12:00:00.000Z' }],
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'guildhall',
    })

    await fireEvent.click(screen.getByRole('button', { name: /Work 1 total work item/i }))
    expect(window.location.pathname).toBe('/projects/guildhall/work')

    await fireEvent.click(screen.getByRole('button', { name: /History 1 recent change/i }))
    expect(window.location.pathname).toBe('/projects/guildhall/timeline')
  })

  it('links to Structure without exposing structural map edit controls', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'guildhall',
        name: 'Guildhall',
        path: '/Users/matthew/git/oss/guildhall',
        tasks: [],
        structuralMapReview: {
          state: 'accepted',
          generatedAt: '2026-06-01T12:00:00.000Z',
          counts: {
            packages: 2,
            domains: 1,
            crossCuttingDomains: 1,
            executableUnits: 1,
            gitRoots: 1,
            ignoredGitRoots: 1,
            conflicts: 1,
            questions: 1,
          },
          gitRoots: [{ id: 'git:root', label: 'Project root', path: '.', confidence: 'high' }],
          ignoredGitRoots: [{ id: 'git:ignored-vendor', label: 'Vendor fixture', path: 'vendor/fixture', confidence: 'low' }],
          packages: [
            { id: 'package:guildhall-core', label: '@guildhall/core', path: 'packages/core', confidence: 'high' },
            { id: 'package:guildhall-web', label: '@guildhall/web', path: 'src/web', confidence: 'medium' },
          ],
          domains: [{ id: 'domain:runtime', label: 'Runtime', confidence: 'high' }],
          crossCuttingDomains: [{ id: 'cross-cutting:design-system-reuse', label: 'Design-system reuse', confidence: 'medium' }],
          executableUnits: [{ id: 'exec:guildhall-core:test', label: 'test', command: 'pnpm --filter @guildhall/core test', confidence: 'high' }],
          conflicts: [{ id: 'conflict-domain-runtime', message: 'Runtime appears in package and path evidence.', severity: 'medium' }],
          questions: [{ id: 'question-runtime-owner', prompt: 'Should runtime own provider routing?' }],
        },
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'guildhall',
    })

    expect(screen.getByRole('heading', { name: 'Signals' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Structure Accepted/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Package-only' })).not.toBeInTheDocument()
  })

  it('summarizes visible work items and delivery steps from shared progress', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'guildhall',
        name: 'Guildhall',
        path: '/Users/matthew/git/oss/guildhall',
        tasks: [
          {
            id: 'logical-work',
            title: 'Import review flow',
            status: 'in_progress',
          },
          {
            id: 'runtime-proof',
            title: 'Runtime proof for import review flow',
            status: 'blocked',
            workVisibility: { kind: 'internal_step', countInProjectTotals: false },
            hierarchy: { parentId: 'logical-work', childIds: [], order: 0 },
          },
        ],
        workProgress: {
          counts: {
            visibleTotal: 1,
            visibleActive: 1,
            visibleBlocked: 0,
            visibleDone: 0,
            visibleShelved: 0,
            deliveryTotal: 2,
            deliveryRequired: 2,
            deliveryDone: 1,
            deliveryBlocked: 1,
          },
          byTaskId: {
            'logical-work': {
              id: 'logical-work',
              title: 'Import review flow',
              status: 'in_progress',
              visibility: { kind: 'primary', countInProjectTotals: true },
              deliverySteps: [
                {
                  id: 'build',
                  title: 'Build import review flow',
                  kind: 'make_change',
                  status: 'done',
                  required: true,
                  blocksCompletion: true,
                },
                {
                  id: 'task:runtime-proof',
                  title: 'Runtime proof for import review flow',
                  kind: 'verify',
                  status: 'blocked',
                  required: true,
                  blocksCompletion: true,
                  sourceTaskId: 'runtime-proof',
                },
              ],
              rollup: {
                primaryState: 'blocked',
                visibleChildCount: 0,
                visibleChildDoneCount: 0,
                internalStepCount: 1,
                requiredStepCount: 2,
                doneStepCount: 1,
                blockedStepCount: 1,
              },
            },
          },
        },
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'guildhall',
    })

    expect(screen.getByText('1 total work item')).toBeInTheDocument()
    expect(screen.getByText('1 active or shaping · 0 completed · 0 blocked.')).toBeInTheDocument()
    expect(screen.getByText('1 / 2 delivery steps done · 1 blocked.')).toBeInTheDocument()
    expect(screen.getByLabelText('Work mix: 1 tasks')).toBeInTheDocument()
    expect(screen.queryByText('2 total tasks')).not.toBeInTheDocument()
  })

  it('does not leak archived generated tasks into overview signals', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'narrative-harness',
        name: 'Narrative Harness',
        path: '/Users/matthew/git/oss/narrative-harness',
        tasks: [
          {
            id: 'live-contract-work',
            title: 'Define fixture, expected-record, prototype-run, and evaluation contracts',
            status: 'ready',
            proofPaths: [{ title: 'Fixture contract proof', status: 'pending' }],
          },
          {
            id: 'archived-generated-child',
            title: 'Define the cited contracts for Implement fixture-and-expected-record schemas (from schema-contract-roadmap)',
            status: 'archived',
            proofPaths: [{ title: 'Define the cited contracts for Implement fixture-and-expected-record schemas (from schema-contract-roadmap)', status: 'blocked' }],
          },
        ],
      },
      inboxLoaded: true,
      inboxItems: [],
      projectTicker: {
        label: 'Not running',
        actorLabel: 'Guildhall',
        message: 'Project is waiting.',
        tone: 'idle',
        pulse: false,
      },
      activeProjectId: 'narrative-harness',
    })

    expect(screen.getAllByText('Define fixture, expected-record, prototype-run, and evaluation contracts').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('Define the cited contracts for Implement fixture-and-expected-record schemas (from schema-contract-roadmap)')).toHaveLength(0)
    expect(screen.getByLabelText('Work mix: 1 tasks')).toBeInTheDocument()
  })
})
