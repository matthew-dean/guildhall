// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
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

  it('renders the shared primary project action instead of choosing a local inbox winner', () => {
    render(ProjectOverviewTab, {
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

  it('treats ready tasks with incomplete worker handoffs as brief cleanup on the dashboard', () => {
    render(ProjectOverviewTab, {
      detail: {
        id: 'fair-labor-license',
        name: 'Fair Labor License',
        path: '/Users/matthew/git/oss/fair-labor-license',
        startReadiness: {
          canStart: false,
          code: 'no_unattended_progress',
          message: 'One task needs a clearer brief and acceptance criteria before unattended work can run.',
          actionHref: '/thread',
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
    expect(screen.getByText('Needs brief: finish the handoff before a worker can start.')).toBeInTheDocument()
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

  it('puts live work before the work mix so current motion is visible at a glance', () => {
    render(ProjectOverviewTab, {
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

    const text = document.body.textContent ?? ''
    expect(text.indexOf('Moving now')).toBeGreaterThan(-1)
    expect(text.indexOf('Work mix')).toBeGreaterThan(-1)
    expect(text.indexOf('Moving now')).toBeLessThan(text.indexOf('Work mix'))
  })

  it('surfaces runtime health, memory health, graph facts, and primary proof paths', async () => {
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
    expect(screen.getAllByText(/3 active/).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /Project graph/i }).length).toBeGreaterThan(0)
    expect(screen.getByText('Primary proof paths')).toBeInTheDocument()
    expect(screen.getAllByText('Verify runtime card').length).toBeGreaterThan(0)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Structure 2 graph domains/i })).toBeInTheDocument()
      expect(screen.queryByText('Map not reviewed')).not.toBeInTheDocument()
      expect(screen.getByText('1 connected project')).toBeInTheDocument()
      expect(screen.getByText('2 graph domains · 2 contract surfaces · 1 open dependency request')).toBeInTheDocument()
    })
  })

  it('condenses project knowledge into one-third overview cards', async () => {
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

    expect(container.querySelectorAll('.card-list-item.knowledge-summary-item')).toHaveLength(6)
    expect(container.querySelectorAll('.knowledge-card')).toHaveLength(0)
    expect(screen.getByRole('button', { name: /Work 2 total tasks/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Structure Accepted/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Runtime Runtime healthy/i })).toBeInTheDocument()
    expect(screen.getByText('Compatibility mode · 4 active memories · 1 proposed.')).toBeInTheDocument()
    expect(screen.getByText('2 domains · 2 packages · 3 commands.')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Project graph 0 connected projects/i })).toBeInTheDocument()
      expect(screen.getByText('1 graph domain · 1 contract surface · 0 open dependency requests')).toBeInTheDocument()
    })
  })

  it('puts the primary next action in a full-width priority row before secondary overview cards', () => {
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

    const priority = container.querySelector('.overview-priority')
    expect(priority).toBeTruthy()
    expect(priority?.querySelector('.next-action')).toBeTruthy()
    expect(priority?.querySelector('.motion-list')).toBeFalsy()

    const nextHeading = priority?.querySelector('.next-action h2')
    expect(nextHeading).toHaveTextContent('Finish reviewer routing')

    const firstGrid = container.querySelector('.overview-grid')
    expect(firstGrid?.querySelector('.motion-list')).toBeTruthy()
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

    await fireEvent.click(screen.getByRole('button', { name: /Work 1 total task/i }))
    expect(window.location.pathname).toBe('/projects/guildhall/work')

    await fireEvent.click(screen.getByRole('button', { name: /Structure Accepted/i }))
    expect(window.location.pathname).toBe('/projects/guildhall/structure')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Project graph 0 connected projects/i })).toBeInTheDocument()
    })
    await fireEvent.click(screen.getByRole('button', { name: /Project graph 0 connected projects/i }))
    expect(window.location.pathname).toBe('/projects/guildhall/structure')

    await fireEvent.click(screen.getByRole('button', { name: /Runtime Runtime stopped/i }))
    expect(window.location.pathname).toBe('/projects/guildhall/settings/ready')

    await fireEvent.click(screen.getByRole('button', { name: /Proof 1 tracked proof path/i }))
    expect(window.location.pathname).toBe('/projects/guildhall/work')

    await fireEvent.click(screen.getByRole('button', { name: /History 1 recent change/i }))
    expect(window.location.pathname).toBe('/projects/guildhall/timeline')
  })

  it('surfaces structural map review facts for owner inspection', () => {
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

    expect(screen.getByRole('heading', { name: 'Project map' })).toBeInTheDocument()
    expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0)
    expect(screen.getByText('2 packages')).toBeInTheDocument()
    expect(screen.getAllByText('Runtime').length).toBeGreaterThan(0)
    expect(screen.getByText('Design-system reuse')).toBeInTheDocument()
    expect(screen.getByText('@guildhall/core')).toBeInTheDocument()
    expect(screen.getByText('pnpm --filter @guildhall/core test')).toBeInTheDocument()
    expect(screen.getByText('vendor/fixture')).toBeInTheDocument()
    expect(screen.getByText('Runtime appears in package and path evidence.')).toBeInTheDocument()
    expect(screen.getByText('Should runtime own provider routing?')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Thread' })).toHaveAttribute('href', '/projects/guildhall/thread')
    expect(screen.queryByRole('button', { name: /defer/i })).not.toBeInTheDocument()
  })

  it('posts structural map owner actions and updates the review state', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project/project-graph') {
        return json({ projectGraph: { localProjects: [], structuralDomains: [], dependencyEdges: [], contractSurfaces: [] } })
      }
      return json({
        structuralMapReview: {
          id: 'structural-map-1',
          state: 'accepted',
          generatedAt: '2026-06-01T12:00:00.000Z',
          counts: {
            packages: 1,
            domains: 1,
            crossCuttingDomains: 0,
            executableUnits: 0,
            gitRoots: 1,
            ignoredGitRoots: 0,
            conflicts: 0,
            questions: 0,
          },
          gitRoots: [{ id: 'git:root', label: 'Project root', path: '.', confidence: 'high' }],
          packages: [{ id: 'package:guildhall-core', label: '@guildhall/core', path: 'packages/core', confidence: 'high' }],
          domains: [{ id: 'domain:runtime', label: 'Runtime', confidence: 'high' }],
          crossCuttingDomains: [],
          executableUnits: [],
          ignoredGitRoots: [],
          conflicts: [],
          questions: [],
        },
      })
    })

    render(ProjectOverviewTab, {
      detail: {
        id: 'guildhall',
        name: 'Guildhall',
        path: '/Users/matthew/git/oss/guildhall',
        tasks: [],
        structuralMapReview: {
          id: 'structural-map-1',
          state: 'owner_review',
          generatedAt: '2026-06-01T12:00:00.000Z',
          counts: {
            packages: 1,
            domains: 1,
            crossCuttingDomains: 0,
            executableUnits: 0,
            gitRoots: 1,
            ignoredGitRoots: 0,
            conflicts: 0,
            questions: 1,
          },
          gitRoots: [{ id: 'git:root', label: 'Project root', path: '.', confidence: 'high' }],
          packages: [{ id: 'package:guildhall-core', label: '@guildhall/core', path: 'packages/core', confidence: 'high' }],
          domains: [{ id: 'domain:runtime', label: 'Runtime', confidence: 'high' }],
          crossCuttingDomains: [],
          executableUnits: [],
          ignoredGitRoots: [],
          conflicts: [],
          questions: [{ id: 'confirm-domain-routing', prompt: 'Review routing.' }],
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

    await fireEvent.click(screen.getByRole('button', { name: /accept map/i }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/project/structural-map/action?projectId=guildhall',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ mapId: 'structural-map-1', action: { kind: 'accept' }, projectId: 'guildhall' }),
      }),
    )
    await waitFor(() => expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0))
  })
})
