// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import ProjectOverviewTab from '../ProjectOverviewTab.svelte'

describe('ProjectOverviewTab', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders same-task escalation inbox items with distinct escalation ids', () => {
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
          kind: 'open_escalation',
          severity: 'high',
          taskId: 'task-006',
          escalationId: 'esc-task-006-23',
          title: 'Set the platform fee policy',
          detail: 'Card component exists but template syntax mismatch prevents edit',
          actionHref: '/task/task-006',
        },
        {
          kind: 'open_escalation',
          severity: 'high',
          taskId: 'task-006',
          escalationId: 'esc-task-006-24',
          title: 'Set the platform fee policy',
          detail: 'Card component exists but template syntax mismatch prevents edit',
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
          kind: 'open_escalation',
          severity: 'high',
          taskId: 'task-006',
          escalationId: 'esc-task-006-23',
          title: 'We should have a system-wide policy of how much FLL charges on overhe...',
          taskDescription: 'We should have a system-wide policy of how much FLL charges on overhead for maintenance fees etc.',
          detail: 'Card component exists but template syntax mismatch prevents edit',
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
})
