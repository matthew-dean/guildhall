// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProjectOverviewTab from '../ProjectOverviewTab.svelte'

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('ProjectOverviewTab', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
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
          detail: 'Guildhall can now scan more planning docs and migrations. Review the reconciliation so it can update or dismiss stale imported work.',
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
          detail: 'Guildhall can now scan more planning docs and migrations.',
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

    expect(screen.getByText('Run the required Guildhall migration before creating or running work.')).toBeInTheDocument()
    expect(screen.getByText('The next run is blocked until the required migration is applied.')).toBeInTheDocument()
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
    expect(container.querySelector('.dependency-list .overview-task-row')).toBeTruthy()
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
    expect(container.querySelector('.dependency-list .overview-task-row')).toBeTruthy()
    expect(screen.getAllByText('In progress').length).toBeGreaterThan(0)
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

  it('surfaces runtime health, memory health, and primary proof paths', () => {
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
    expect(screen.getByText('Primary proof paths')).toBeInTheDocument()
    expect(screen.getByText('Verify runtime card')).toBeInTheDocument()
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
    expect(screen.getByText('Accepted')).toBeInTheDocument()
    expect(screen.getByText('2 packages')).toBeInTheDocument()
    expect(screen.getByText('Runtime')).toBeInTheDocument()
    expect(screen.getByText('Design-system reuse')).toBeInTheDocument()
    expect(screen.getByText('@guildhall/core')).toBeInTheDocument()
    expect(screen.getByText('pnpm --filter @guildhall/core test')).toBeInTheDocument()
    expect(screen.getByText('vendor/fixture')).toBeInTheDocument()
    expect(screen.getByText('Runtime appears in package and path evidence.')).toBeInTheDocument()
    expect(screen.getByText('Should runtime own provider routing?')).toBeInTheDocument()
  })

  it('posts structural map owner actions and updates the review state', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({
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
    }))

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
    await waitFor(() => expect(screen.getByText('Accepted')).toBeInTheDocument())
  })
})
