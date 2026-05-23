// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import ProjectsHome from '../ProjectsHome.svelte'
import { path } from '../../lib/nav.svelte.js'
import type { ServiceDetail } from '../../lib/types.js'

const servicePayload: ServiceDetail = {
  pid: 1234,
  selectedProject: { id: 'looma-knit', path: '/repo/looma-knit', name: 'Looma + Knit' },
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
    vi.restoreAllMocks()
    cleanup()
  })

  it('opens a project through its stable project-scoped route', async () => {
    const fetchMock = vi.fn(async () => json(servicePayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Looma knit')

    await userEvent.click(screen.getAllByRole('button', { name: /open project/i })[0]!)

    expect(path.value).toBe('/projects/looma-knit/thread')
    expect(window.location.pathname).toBe('/projects/looma-knit/thread')
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

  it('starts and stops projects with project ids in the endpoint', async () => {
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

    await userEvent.click(screen.getByRole('button', { name: /start/i }))
    await userEvent.click(screen.getAllByRole('button', { name: /stop/i })[0]!)

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/start'))).toBe(true)
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/stop'))).toBe(true)
    })
  })

  it('shows empty-state and attach flow without trapping the user', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/service/attach-project') {
        return json({
          selectedProject: { id: 'new-project', path: '/repo/new-project', name: 'New Project' },
        })
      }
      return json({ pid: 1234, projects: [] } satisfies ServiceDetail)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('No projects yet')

    await userEvent.click(screen.getByRole('button', { name: /attach project/i }))

    await waitFor(() => expect(path.value).toBe('/projects/new-project/thread'))
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

  it('surfaces start and stop failures on the projects page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/start')) {
        return json({ error: 'model unavailable' }, { status: 409 })
      }
      if (url.startsWith('/api/project/stop')) {
        return json({ error: 'stop failed' }, { status: 500 })
      }
      return json(servicePayload)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(ProjectsHome)
    await screen.findByText('Fair Labor License')

    await userEvent.click(screen.getByRole('button', { name: /start/i }))
    await screen.findByText('model unavailable')
    await userEvent.click(screen.getByRole('button', { name: /stop/i }))
    await screen.findByText('stop failed')
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
