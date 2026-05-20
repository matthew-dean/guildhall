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
      taskCounts: { total: 4, active: 1, draftReview: 0, blocked: 0, done: 1, shelved: 0 },
      highlights: {},
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
    await userEvent.click(screen.getByRole('button', { name: /stop/i }))

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
