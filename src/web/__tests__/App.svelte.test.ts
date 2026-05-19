// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import App from '../App.svelte'
import { path } from '../lib/nav.svelte.js'

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

class FakeEventSource {
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  close = vi.fn()

  constructor(public url: string) {}
}

const modelsPayload = {
  globalModels: {
    spec: 'qwen/qwen3.6-35b-a3b',
    coordinator: 'qwen/qwen3.6-35b-a3b',
    worker: 'qwen/qwen3.6-35b-a3b',
    reviewer: 'qwen/qwen3.6-35b-a3b',
    gateChecker: 'qwen/qwen3.6-35b-a3b',
  },
  effectiveModels: {},
  loadedModels: ['qwen/qwen3.6-35b-a3b'],
  missingModels: [],
  catalog: [{ id: 'qwen/qwen3.6-35b-a3b', provider: 'openai-api', notes: 'fast infra default' }],
}

describe('App shell', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/providers')
    path.value = '/providers'
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('renders the routed shell and exposes the legacy openTask bridge', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/version')) return json({ version: '0.5.1' })
      if (url.startsWith('/api/stale-server')) return json({ stale: false })
      if (url.startsWith('/api/config/models')) return json(modelsPayload)
      if (url.startsWith('/api/project/task/task-123')) {
        return json({
          task: {
            id: 'task-123',
            title: 'Bridge-opened task',
            description: 'Opened from the legacy bridge.',
            status: 'ready',
            domain: 'frontend',
            priority: 'normal',
            acceptanceCriteria: [],
            origination: 'human',
          },
          threadTurns: [],
          recentEvents: [],
          contextDebug: [],
        })
      }
      if (url.startsWith('/api/project')) {
        return json({
          id: 'looma-knit',
          name: 'Looma + Knit',
          path: '/repo/looma-knit',
          run: { status: 'stopped', mode: 'continuous' },
          tasks: [],
          inbox: { items: [], blockers: { bootstrap: false, workspaceImport: false } },
        })
      }
      if (url.startsWith('/api/setup/providers')) {
        return json({
          preferredProvider: 'codex',
          providers: {
            codex: { label: 'Codex', detail: 'Local CLI session', detected: true },
          },
        })
      }
      return json({ projects: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(App)

    await screen.findByText('Providers')
    await screen.findByText('Codex')
    expect(screen.getByText('Guildhall')).toBeTruthy()

    window.history.replaceState({}, '', '/projects/looma-knit/thread')
    path.value = '/projects/looma-knit/thread'
    ;(window as unknown as { __guildhall: { openTask: (id: string) => void } }).__guildhall.openTask('task-123')

    await waitFor(() => {
      expect(window.location.pathname).toBe('/projects/looma-knit/task/task-123')
    })
  })

  it('wraps project-scoped fetch calls without overwriting explicit project ids', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/thread')
    path.value = '/projects/looma-knit/thread'
    const seen: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input))
      if (String(input).startsWith('/api/version')) return json({ version: '0.5.1' })
      if (String(input).startsWith('/api/stale-server')) return json({ stale: false })
      if (String(input).startsWith('/api/config/models')) return json(modelsPayload)
      if (String(input).startsWith('/api/project')) {
        return json({
          id: 'looma-knit',
          name: 'Looma + Knit',
          path: '/repo/looma-knit',
          run: { status: 'stopped', mode: 'continuous' },
          tasks: [],
          inbox: { items: [], blockers: { bootstrap: false, workspaceImport: false } },
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(App)
    await waitFor(() => {
      expect(screen.getAllByText('Looma + Knit').length).toBeGreaterThan(0)
    })

    await fetch('/api/project')
    await fetch('/api/project?projectId=fair-labor-license')

    expect(seen).toContain('/api/project?projectId=looma-knit')
    expect(seen).toContain('/api/project?projectId=fair-labor-license')
  })
})
