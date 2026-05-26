// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import FleetNeedsYou from '../FleetNeedsYou.svelte'
import { path } from '../../lib/nav.svelte.js'
import type { ServiceDetail } from '../../lib/types.js'

const servicePayload: ServiceDetail = {
  pid: 1234,
  projects: [
    { id: 'looma-knit', path: '/repo/looma-knit', name: 'Looma + Knit' },
    { id: 'fair-labor-license', path: '/repo/fair-labor-license', name: 'Fair Labor License' },
  ],
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('FleetNeedsYou', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/needs-you')
    path.value = '/needs-you'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('groups needs-you items by project and routes item actions with the project id', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/service') return json(servicePayload)
      if (url.pathname === '/api/project/inbox' && url.searchParams.get('projectId') === 'looma-knit') {
        return json({
          items: [
            {
              kind: 'agent_question_pending',
              severity: 'high',
              title: 'Choose migration source',
              detail: 'Pick the source of truth.',
              taskId: 'task-migration',
              actionHref: '/task/task-migration',
            },
          ],
        })
      }
      if (url.pathname === '/api/project/inbox' && url.searchParams.get('projectId') === 'fair-labor-license') {
        return json({
          items: [
            {
              kind: 'spec_approval',
              severity: 'medium',
              title: 'Approve auth spec',
              detail: 'Spec is ready for review.',
              taskId: 'task-auth',
              actionHref: '/thread',
            },
          ],
        })
      }
      return json({ items: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(FleetNeedsYou)

    await screen.findByText('Looma + Knit')
    await screen.findByText('Fair Labor License')
    expect(screen.getByText('Choose migration source')).toBeTruthy()
    expect(screen.getByText('Approve auth spec')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^queue$/i })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /project needs you/i })).toBeNull()

    await userEvent.click(screen.getByText('Choose migration source'))

    expect(path.value).toBe('/projects/looma-knit/task/task-migration')
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('projectId=looma-knit'))).toBe(true)
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('projectId=fair-labor-license'))).toBe(true)
    })
  })

  it('starts project inbox requests in parallel so the fleet inbox does not hang behind one slow project', async () => {
    const inboxResolvers = new Map<string, (response: Response) => void>()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/service') {
        return json({
          pid: 1234,
          projects: [
            { id: 'one', path: '/repo/one', name: 'One' },
            { id: 'two', path: '/repo/two', name: 'Two' },
            { id: 'three', path: '/repo/three', name: 'Three' },
          ],
        })
      }
      if (url.pathname === '/api/project/inbox') {
        const projectId = url.searchParams.get('projectId') ?? ''
        return await new Promise<Response>(resolve => {
          inboxResolvers.set(projectId, resolve)
        })
      }
      return json({ items: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(FleetNeedsYou)

    await waitFor(() => {
      expect(inboxResolvers.size).toBe(3)
    })

    inboxResolvers.get('one')?.(json({ items: [{
      kind: 'agent_question_pending',
      severity: 'high',
      title: 'First question',
      detail: 'Answer this.',
      actionHref: '/thread',
    }] }))
    inboxResolvers.get('two')?.(json({ items: [] }))
    inboxResolvers.get('three')?.(json({ items: [] }))

    await screen.findByText('First question')
  })

  it('renders repeated inbox rows without crashing the fleet queue', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/service') return json({
        pid: 1234,
        projects: [{ id: 'looma-knit', path: '/repo/looma-knit', name: 'Looma + Knit' }],
      })
      if (url.pathname === '/api/project/inbox') {
        return json({
          items: [
            {
              kind: 'spec_fill_pending',
              severity: 'medium',
              title: 'Block menu',
              detail: 'Optional cleanup.',
              taskId: 'task-block-menu',
              actionHref: '/task/task-block-menu?tab=spec',
            },
            {
              kind: 'spec_fill_pending',
              severity: 'medium',
              title: 'Block menu',
              detail: 'Optional cleanup.',
              taskId: 'task-block-menu',
              actionHref: '/task/task-block-menu?tab=spec',
            },
          ],
        })
      }
      return json({ items: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(FleetNeedsYou)

    await screen.findByText('Looma + Knit')
    expect(screen.getAllByText('Block menu')).toHaveLength(2)
  })
})
