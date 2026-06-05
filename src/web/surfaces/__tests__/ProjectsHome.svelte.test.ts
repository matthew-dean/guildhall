// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import ProjectsHome from '../ProjectsHome.svelte'
import { path } from '../../lib/nav.svelte.js'
import { getCachedService } from '../../lib/service-cache.js'
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
  beforeEach(() => {
    installBrowserFakes()
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

  it('does not invent an in-page project details pane from card selection', async () => {
    const fetchMock = vi.fn(async () => json(servicePayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Looma knit')

    await userEvent.click(screen.getByRole('button', { name: 'Project: Looma knit' }))

    expect(path.value).toBe('/')
    expect(window.location.pathname).toBe('/')
    expect(screen.getByText('Where it is')).toBeTruthy()
    expect(screen.getByText('Current status')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show Looma knit details on this page' })).toBeNull()
  })

  it('shows full project details with chip counts and recent/next work', async () => {
    const fetchMock = vi.fn(async () => json(servicePayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Fair Labor License')

    await userEvent.click(screen.getByRole('button', { name: 'Project: Fair Labor License' }))

    expect(screen.getByText(/Fair Labor License is a platform for helping OSS projects/)).toBeTruthy()
    expect(screen.getByText('Recently completed')).toBeTruthy()
    expect(screen.getByText('Project onboarding brief')).toBeTruthy()
    expect(screen.getByText('Next up')).toBeTruthy()
    expect(screen.getByText('Unblock: Stripe Connect payment flow')).toBeTruthy()
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)
    expect(screen.getByText('blocked task')).toBeTruthy()
    expect(screen.getByText('total tasks')).toBeTruthy()
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
    expect(screen.getAllByText('Migrate')).toHaveLength(2)
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

    const card = screen.getByRole('button', { name: 'Project: Commerce' })
    expect(card.textContent).toContain('needs input')
    expect(card.textContent).not.toContain('ready')
    expect(screen.queryByRole('button', { name: /start intake/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^resume$/i })).toBeNull()
  })

  it('summarizes the project floor and exposes card work mix visuals', async () => {
    const fetchMock = vi.fn(async () => json(servicePayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Guild hall')

    expect(screen.getByLabelText('1 running now')).toBeTruthy()
    expect(screen.getByLabelText('3 active tasks')).toBeTruthy()
    expect(screen.getByLabelText('Builder: working')).toBeTruthy()
    expect(screen.getAllByLabelText(/Project work mix:/)).toHaveLength(2)
    expect(screen.getByLabelText(/Project work mix: 2 active, 0 drafts, 0 blocked, 3 done/)).toBeTruthy()
    await userEvent.hover(screen.getByLabelText('3 active tasks'))
    expect((await screen.findByRole('tooltip')).textContent).toContain('tasks currently queued or in progress')
    await userEvent.unhover(screen.getByLabelText('3 active tasks'))
    await userEvent.hover(screen.getByText('3 active'))
    expect(screen.queryByRole('tooltip')).toBeNull()
    await userEvent.unhover(screen.getByText('3 active'))
    await userEvent.hover(screen.getByLabelText('Looma knit: running now. Agents are working on 2 tasks.'))
    expect((await screen.findByRole('tooltip')).textContent).toContain('Looma knit: running now. Agents are working on 2 tasks.')
  })

  it('uses specific project-avatar tooltips instead of repeated filler copy', async () => {
    const fetchMock = vi.fn(async () => json(servicePayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Fair Labor License')

    expect(screen.queryByLabelText(/assigned or relevant/i)).toBeNull()
    expect(screen.getByLabelText('Coordinator: 1 blocker to triage in Fair Labor License.')).toBeTruthy()
    expect(screen.getByLabelText('Builder: 1 active task waiting for a run in Fair Labor License.')).toBeTruthy()
    expect(screen.getByLabelText('Reviewer: 1 blocked and 1 done task in Fair Labor License.')).toBeTruthy()
    expect(screen.getAllByText('Coordinator').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Builder').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Reviewer').length).toBeGreaterThan(0)

    await userEvent.hover(screen.getByLabelText('Coordinator: 1 blocker to triage in Fair Labor License.'))
    expect((await screen.findByRole('tooltip')).textContent).toBe('Coordinator: 1 blocker to triage in Fair Labor License.')
  })

  it('assigns stable role palette tones to dashboard and project avatars', async () => {
    const fetchMock = vi.fn(async () => json(servicePayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Fair Labor License')

    expect(screen.getByLabelText('Coordinator: directing live work').classList.contains('avatar-tone-coordinator')).toBe(true)
    expect(screen.getByLabelText('Spec: at table').classList.contains('avatar-tone-spec')).toBe(true)
    expect(screen.getByLabelText('Builder: working').classList.contains('avatar-tone-builder')).toBe(true)
    expect(screen.getByLabelText('Reviewer: inspecting blocks').classList.contains('avatar-tone-reviewer')).toBe(true)
    expect(screen.getByLabelText('Builder: 1 active task waiting for a run in Fair Labor License.').classList.contains('avatar-tone-builder')).toBe(true)
    expect(screen.getByLabelText('Reviewer: 1 blocked and 1 done task in Fair Labor License.').classList.contains('avatar-tone-reviewer')).toBe(true)
  })

  it('resumes and pauses projects with project ids in the endpoint', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/start')) {
        expect(url).toContain('projectId=fair-labor-license')
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/stop')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      return json(servicePayload)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Fair Labor License')

    const startButton = screen.getByRole('button', { name: /^resume$/i })
    expect(startButton.classList.contains('v-agent')).toBe(true)
    await userEvent.click(startButton)
    await userEvent.click(screen.getAllByRole('button', { name: /pause/i })[0]!)

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/start'))).toBe(true)
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/stop'))).toBe(true)
    })
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
    const fetchMock = vi.fn(async () => json(structuredClone(servicePayload)))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Looma knit')
    const cachedAfterInitialLoad = getCachedService()

    await vi.advanceTimersByTimeAsync(30000)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(getCachedService()).toBe(cachedAfterInitialLoad)
  })

  it('surfaces resume and pause failures on the projects page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/start')) {
        return json({ error: 'model unavailable' }, { status: 409 })
      }
      if (url.startsWith('/api/project/stop')) {
        return json({ error: 'pause failed' }, { status: 500 })
      }
      return json(servicePayload)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Fair Labor License')

    await userEvent.click(screen.getByRole('button', { name: /^resume$/i }))
    await screen.findByText('model unavailable')
    await userEvent.click(screen.getByRole('button', { name: /pause/i }))
    await screen.findByText('pause failed')
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
