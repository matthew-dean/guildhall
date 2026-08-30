// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import ProjectsHome from '../ProjectsHome.svelte'
import { path } from '../../lib/nav.svelte.js'
import { getCachedService, setCachedService } from '../../lib/service-cache.js'
import type { ServiceDetail } from '../../lib/types.js'

const servicePayload: ServiceDetail = {
  pid: 1234,
  defaultProviderStatus: {
    preferredProvider: 'openai-api',
    preferredProviderLabel: 'OpenAI-compatible API',
    activeModel: 'Qwen/Qwen3.5-35B-A3B',
    models: {
      worker: 'Qwen/Qwen3.5-35B-A3B',
    },
  },
  projects: [
    {
      id: 'looma-knit',
      path: '/repo/looma-knit',
      name: 'looma-knit',
      summary: 'Collaborative editor workbench.',
      taskCounts: { total: 7, active: 2, draftReview: 0, blocked: 0, done: 3, shelved: 0 },
      highlights: { activeTaskTitle: 'Knit: add link editor controls' },
      run: { status: 'running', mode: 'continuous', startedAt: '2026-05-19T15:00:00.000Z' },
    },
    {
      id: 'fair-labor-license',
      path: '/repo/fair-labor-license',
      name: 'Fair Labor License',
      summary:
        'Fair Labor License is a platform for helping OSS projects, independent developers, and small software companies adopt and operate software licensing with the Fair Labor License.',
      taskCounts: { total: 4, active: 1, draftReview: 0, blocked: 1, done: 1, shelved: 0 },
      highlights: {
        activeTaskTitle: 'Bootstrap database migrations',
        blockedTaskTitle: 'Stripe Connect payment flow',
        recentCompletedTaskTitle: 'Project onboarding brief',
      },
      run: { status: 'stopped', mode: 'continuous' },
    },
  ],
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function installBrowserFakes() {
  window.history.replaceState({}, '', '/')
  path.value = '/'
}

describe('ProjectsHome', () => {
  it('uses a responsive grid for project cards instead of flex wrapping', () => {
    const source = readFileSync('src/web/surfaces/ProjectsHome.svelte', 'utf-8')

    expect(source).toContain('grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr))')
    expect(source).not.toContain('flex: 1 1 24rem')
    expect(source).not.toContain('flex-wrap: wrap;\n    gap: var(--s-2);\n    align-items: stretch;')
  })

  it('renders registered project cards from the single lightweight shell request', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/service/projects') {
        return json({
          pid: 1234,
          projects: servicePayload.projects.map(project => ({
            id: project.id,
            path: project.path,
            name: project.name,
            summary: project.summary,
            projectStatusLoading: true,
            run: project.run,
          })),
        } satisfies ServiceDetail)
      }
      return json(servicePayload)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)

    await screen.findByText('Looma knit')
    expect(screen.getByText('Loading project status...')).toBeTruthy()
    const loadingCards = screen.getAllByRole('status', { name: /still loading project state/i })
    expect(loadingCards).toHaveLength(2)
    expect(loadingCards[0]?.closest('section')?.classList.contains('project-card-loading')).toBe(true)
    expect(loadingCards[0]?.querySelectorAll('.gh-skeleton').length).toBeGreaterThan(0)
    expect(loadingCards[0]?.querySelector('.loading-bars')).toBeNull()
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain('/api/service/projects')
    expect(fetchMock.mock.calls.map(([input]) => String(input)).some(input => input.startsWith('/api/service?'))).toBe(false)
  })

  it('keeps project loading and unavailable states independent within the fleet response', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/service/projects')
      return json({
        pid: 1234,
        projects: [
          {
            id: 'looma-knit',
            path: '/repo/looma-knit',
            name: 'Looma + Knit',
            summary: 'The compact project shell is ready.',
            projectStatusLoading: true,
            run: { status: 'running', mode: 'continuous' },
          },
          {
            id: 'fair-labor-license',
            path: '/repo/fair-labor-license',
            name: 'Fair Labor License',
            summary: 'A saved summary exists, but the current projection is unavailable.',
            projectStatusError: 'The saved project summary is not available yet.',
            taskCounts: { total: 4, active: 1, draftReview: 0, blocked: 1, done: 1, shelved: 0 },
            run: { status: 'stopped', mode: 'continuous' },
          },
          {
            id: 'font-something',
            path: '/repo/font-something',
            name: 'Font Something',
            taskCounts: { total: 2, active: 0, draftReview: 0, blocked: 0, done: 2, shelved: 0 },
            run: { status: 'stopped', mode: 'continuous' },
          },
        ],
      } satisfies ServiceDetail)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)

    await screen.findByText('Looma + Knit')
    expect(screen.getByRole('status', { name: /Looma \+ Knit/i })).toBeTruthy()
    expect(screen.getByText('Status unavailable')).toBeTruthy()
    expect(screen.getByText('2 of 2 tasks are done.')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain('/api/service')
    expect(fetchMock.mock.calls.map(([input]) => String(input)).some(input => input.startsWith('/api/service?projectId='))).toBe(false)
  })

  beforeEach(() => {
    installBrowserFakes()
    setCachedService(null)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    cleanup()
  })

  it('opens a project through its stable project-scoped route', async () => {
    const fetchMock = vi.fn(async () => json(servicePayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Looma knit')

    await userEvent.click(screen.getAllByRole('button', { name: /open project/i })[0]!)

    expect(path.value).toBe('/projects/looma-knit/overview')
    expect(window.location.pathname).toBe('/projects/looma-knit/overview')
  })

  it('does not make the project card a second ambiguous navigation control', async () => {
    const fetchMock = vi.fn(async () => json(servicePayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Looma knit')

    expect(screen.queryByRole('button', { name: 'Project: Looma knit' })).toBeNull()
    expect(screen.queryByText('Where it is')).toBeNull()
    expect(screen.queryByText('Current status')).toBeNull()
  })

  it('does not hide a dense project telemetry drawer behind card selection', async () => {
    const fetchMock = vi.fn(async () => json(servicePayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Fair Labor License')

    expect(screen.queryByText(/Fair Labor License is a platform for helping OSS projects/)).toBeNull()
    expect(screen.queryByText('Recently completed')).toBeNull()
    expect(screen.queryByText('Next up')).toBeNull()
    expect(screen.queryByLabelText('Project task counts')).toBeNull()
    expect(screen.getAllByRole('button', { name: /open project/i })).toHaveLength(2)
  })

  it('names the selected spec review instead of showing an inert review count', async () => {
    const fetchMock = vi.fn(async () => json({
      projects: [{
        id: 'looma-knit',
        path: '/repo/looma-knit',
        name: 'Looma + Knit',
        taskCounts: { total: 16, active: 0, draftReview: 0, blocked: 0, done: 6, shelved: 0 },
        run: { status: 'stopped', mode: 'continuous' },
        startReadiness: {
          canStart: false,
          code: 'owner_review_required',
          message: '10 specs are ready for your review before work can continue.',
          focusTaskId: 'task-review-menu',
          focusKind: 'spec_review',
          count: 10,
        },
        actionModel: {
          primaryAction: {
            label: 'Review a spec',
            taskId: 'task-review-menu',
            taskLabel: 'LOO-EBUYE7 Shape the focused review flow',
            buttonLabel: 'Review spec',
            href: '/task/task-review-menu',
            tone: 'warn',
            code: 'owner_review_required',
          },
          secondaryActions: [],
          ownerInput: { active: false },
          runControl: null,
        },
      }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)

    expect(await screen.findByText('LOO-EBUYE7 Shape the focused review flow')).toBeTruthy()
    expect(screen.queryByText('10 specs are ready for your review before work can continue.')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Review spec' }))
    expect(path.value).toBe('/projects/looma-knit/task/task-review-menu')
  })

  it('opens the fleet needs-you view instead of a random project inbox', async () => {
    const fetchMock = vi.fn(async () => json(servicePayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Looma knit')

    await userEvent.click(screen.getByRole('button', { name: /needs you/i }))

    expect(path.value).toBe('/needs-you')
    expect(window.location.pathname).toBe('/needs-you')
  })

  it('shows the machine default model group and links to global providers', async () => {
    const fetchMock = vi.fn(async () => json(servicePayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Models')

    expect(screen.getByText('Models')).toBeTruthy()
    expect(screen.queryByText('OpenAI-compatible API')).toBeNull()
    expect(screen.queryByText('Qwen3.5-35B-A3B')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /open model settings/i }))

    expect(path.value).toBe('/providers')
    expect(window.location.pathname).toBe('/providers')
  })

  it('counts needs-you projects, not every grouped draft item', async () => {
    const fetchMock = vi.fn(async () => json({
      ...servicePayload,
      projects: [
        ...servicePayload.projects,
        {
          id: 'font-something',
          path: '/repo/font-something',
          name: 'Font Something',
          taskCounts: { total: 8, active: 2, draftReview: 3, blocked: 1, done: 2, shelved: 0 },
          run: { status: 'stopped', mode: 'continuous' },
        },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)

    expect(await screen.findByRole('button', { name: /needs you 2/i })).toBeTruthy()
  })

  it('uses the shared fleet attention count instead of re-counting card urgency', async () => {
    const fetchMock = vi.fn(async () => json({
      ...servicePayload,
      fleetAttention: { projectCount: 4, totalItems: 5 },
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)

    expect(await screen.findByRole('button', { name: /needs you 4/i })).toBeTruthy()
  })

  it('does not duplicate identical status and maturity chips on paused cards', async () => {
    const fetchMock = vi.fn(async () => json({
      ...servicePayload,
      projects: [
        {
          id: 'narrative-harness',
          path: '/repo/narrative-harness',
          name: 'Narrative Harness',
          taskCounts: { total: 6, active: 6, draftReview: 0, blocked: 0, done: 0, shelved: 0 },
          run: { status: 'stopped', mode: 'continuous' },
        },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Narrative Harness')

    expect(screen.getAllByText('Paused')).toHaveLength(1)
  })

  it('uses project questions as the only top-level check-in chip', async () => {
    const fetchMock = vi.fn(async () => json({
      ...servicePayload,
      projects: [
        {
          id: 'narrative-harness',
          path: '/repo/narrative-harness',
          name: 'Narrative Harness',
          taskCounts: { total: 6, active: 6, draftReview: 0, blocked: 0, done: 0, shelved: 0 },
          projectCheckIn: {
            needed: true,
            label: 'Project questions',
            title: 'Project check-in needed',
            detail: 'Answer the first project questions so Guildhall has the newer project context.',
          },
          run: { status: 'stopped', mode: 'continuous' },
        },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Narrative Harness')

    expect(screen.getAllByText('Project questions')).toHaveLength(1)
    expect(screen.queryByText('Check-in')).toBeNull()
  })

  it('does not advertise Start intake or Resume when service readiness says a migration blocks the project', async () => {
    const fetchMock = vi.fn(async () => json({
      ...servicePayload,
      projects: [
        {
          id: 'commerce',
          path: '/repo/commerce',
          name: 'Commerce',
          taskCounts: { total: 0, active: 0, draftReview: 0, blocked: 0, done: 0, shelved: 0 },
          run: { status: 'stopped', mode: 'continuous' },
          projectCheckIn: {
            needed: true,
            label: 'Project questions',
            title: 'Project check-in needed',
            detail: 'Start the check-in pass.',
          },
          startReadiness: {
            canStart: false,
            code: 'required_migration_pending',
            message: 'Run the required Guildhall migration before starting this project.',
            actionHref: '/migrations',
          },
        },
        {
          id: 'font-something',
          path: '/repo/font-something',
          name: 'Font Something',
          taskCounts: { total: 3, active: 2, draftReview: 0, blocked: 0, done: 1, shelved: 0 },
          highlights: { activeTaskTitle: 'Revise type scale' },
          run: { status: 'stopped', mode: 'continuous' },
          projectCheckIn: {
            needed: true,
            label: 'Project questions',
            title: 'Project check-in needed',
            detail: 'Start the check-in pass.',
          },
          startReadiness: {
            canStart: false,
            code: 'required_migration_pending',
            message: 'Run the required Guildhall migration before starting this project.',
            actionHref: '/migrations',
          },
        },
      ],
    } satisfies ServiceDetail))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Commerce')

    expect(screen.getAllByText('Needs migration').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Run the required Guildhall migration before starting this project.')).toHaveLength(2)
    expect(screen.queryByText('ready')).toBeNull()
    expect(screen.queryByText('2 paused')).toBeNull()
    expect(screen.queryByText('Project questions')).toBeNull()
    expect(screen.queryByRole('button', { name: /start intake/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^resume$/i })).toBeNull()
  })

  it('does not label zero-task owner-input projects as ready on the card', async () => {
    const fetchMock = vi.fn(async () => json({
      ...servicePayload,
      projects: [
        {
          id: 'commerce',
          path: '/repo/commerce',
          name: 'Commerce',
          taskCounts: { total: 0, active: 0, draftReview: 0, blocked: 0, done: 0, shelved: 0 },
          run: { status: 'stopped', mode: 'continuous' },
          startReadiness: { canStart: true },
          actionModel: {
            primaryAction: {
              source: 'owner_input',
              label: 'Answer in Thread',
              detail: 'Shape the first spec before Guildhall creates work.',
              buttonLabel: 'Open Thread',
              href: '/thread',
              tone: 'warn',
            },
            secondaryActions: [],
            runControl: {
              label: 'Waiting on setup',
              startEnabled: false,
              disabledReason: 'Shape the first spec before Guildhall creates work.',
              href: '/thread',
            },
            ownerInput: {
              active: true,
              label: 'Answer in Thread',
              detail: 'Shape the first spec before Guildhall creates work.',
              href: '/thread',
            },
            setup: {
              state: 'blocked',
              freshIntakeNeeded: false,
              href: '/thread',
              detail: 'Shape the first spec before Guildhall creates work.',
            },
          },
        },
      ],
    } satisfies ServiceDetail))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Commerce')

    expect(screen.getByLabelText('Project status: Needs you')).toBeTruthy()
    expect(screen.getByText('Answer in Thread')).toBeTruthy()
    expect(screen.queryByText('Shape the first spec before Guildhall creates work.')).toBeNull()
    expect(screen.queryByText('No task activity yet.')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Open Thread' }))
    expect(path.value).toBe('/projects/commerce/thread')
    expect(screen.queryByRole('button', { name: /start intake/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^resume$/i })).toBeNull()
  })

  it('opens directly into the project chooser without aggregate telemetry', async () => {
    const fetchMock = vi.fn(async () => json(servicePayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Looma knit')

    expect(screen.queryByText('Guild hall')).toBeNull()
    expect(screen.queryByText('Work mix')).toBeNull()
    expect(screen.getAllByRole('button', { name: /open project/i })).toHaveLength(2)
  })

  it('keeps project cards to current state and one entry action', async () => {
    const fetchMock = vi.fn(async () => json(servicePayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Fair Labor License')

    const card = screen.getByText('Fair Labor License').closest('section')!
    expect(card).toBeTruthy()
    expect(card.textContent).toContain('1 blocked task needs attention.')
    expect(card.querySelector('[aria-label^="Project work mix:"]')).toBeNull()
    expect(card.querySelector('[aria-label="Guild members assigned to this project"]')).toBeNull()
    expect(card.querySelector('[aria-label="Project task summary"]')).toBeNull()
    expect(card.querySelector('[aria-label^="Recent task activity"]')).toBeNull()
    expect(screen.getAllByRole('button', { name: /open project/i })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^resume$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^pause$/i })).toBeNull()
    expect(card.querySelector('.path')).toBeNull()
  })

  it('does not start or pause processing from the project chooser', async () => {
    const fetchMock = vi.fn(async () => json(servicePayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Fair Labor License')

    expect(screen.queryByRole('button', { name: /^resume$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^pause$/i })).toBeNull()
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/start'))).toBe(false)
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/stop'))).toBe(false)
  })

  it('shows empty-state and attach flow without trapping the user', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/service/attach-project') {
        return json({
          project: { id: 'new-project', path: '/repo/new-project', name: 'New Project' },
        })
      }
      return json({ pid: 1234, projects: [] } satisfies ServiceDetail)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('No projects yet')

    await userEvent.click(screen.getByRole('button', { name: /attach project/i }))

    await waitFor(() => expect(path.value).toBe('/projects/new-project/overview'))
  })

  it('keeps project-list errors visible instead of looking empty or stuck', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('service unavailable')
    })
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('service unavailable')
    expect(screen.getByText('No projects yet')).toBeTruthy()
  })

  it('does not rewrite the dashboard state when a background poll returns the same service snapshot', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/service/projects') {
        return json({
          ...structuredClone(servicePayload),
          projects: servicePayload.projects.map(project => ({
            id: project.id,
            path: project.path,
            name: project.name,
            summary: project.summary,
            projectStatusLoading: true,
            run: project.run,
          })),
        } satisfies ServiceDetail)
      }
      return json(structuredClone(servicePayload))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    for (let i = 0; i < 8; i += 1) await Promise.resolve()
    expect(screen.getByText('Looma knit')).toBeTruthy()
    expect(getCachedService()).not.toBeNull()
    const cachedAfterInitialLoad = getCachedService()

    await vi.advanceTimersByTimeAsync(30000)

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(getCachedService()).toBe(cachedAfterInitialLoad)
  })

  it('handles cancelled attach without navigating away from the projects list', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/service/attach-project') return json({ cancelled: true })
      return json(servicePayload)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Looma knit')
    await userEvent.click(screen.getByRole('button', { name: /attach project/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/service/attach-project')).toBe(true)
    })
    expect(path.value).toBe('/')
  })
})
