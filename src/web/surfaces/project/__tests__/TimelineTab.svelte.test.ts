// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import TimelineTab from '../TimelineTab.svelte'
import { path } from '../../../lib/nav.svelte.js'

describe('TimelineTab', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/projects/looma-knit/timeline')
    path.value = '/projects/looma-knit/timeline'
    path.state = {}
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('shows the empty state before any coordinator events exist', () => {
    render(TimelineTab, {
      props: {
        detail: {
          id: 'looma-knit',
          name: 'Looma + Knit',
          path: '/repo/looma-knit',
          tasks: [],
          recentEvents: [],
        },
      },
    })

    expect(screen.getByText('Coordinator timeline')).toBeTruthy()
    expect(
      screen.getByText('No events recorded yet. Start the coordinator to populate the timeline.'),
    ).toBeTruthy()
  })

  it('renders recent events newest-first and opens task events in the drawer route', async () => {
    const user = userEvent.setup()
    render(TimelineTab, {
      props: {
        detail: {
          id: 'looma-knit',
          name: 'Looma + Knit',
          path: '/repo/looma-knit',
          tasks: [],
          recentEvents: [
            {
              at: '2026-05-19T15:00:00.000Z',
              event: {
                type: 'task_transition',
                task_id: 'task-a',
                from_status: 'ready',
                to_status: 'in_progress',
                agent_name: 'worker-agent',
                reason: 'claimed ready task',
              },
            },
            {
              at: '2026-05-19T15:01:00.000Z',
              event: { type: 'error', message: 'bootstrap failed' },
            },
            {
              at: '2026-05-19T15:02:00.000Z',
              event: { type: 'agent_started', task_id: 'task-b', agent_name: 'coordinator' },
            },
          ],
        },
      },
    })

    const rows = screen.getAllByText(/15:0/)
    expect(rows.map(row => row.textContent)).toEqual(['15:02:00', '15:01:00', '15:00:00'])
    expect(screen.getByText('ERROR: bootstrap failed')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Task A Ready/ }))

    expect(path.value).toBe('/projects/looma-knit/task/task-a')
    expect(path.state).toEqual({ backgroundPath: '/projects/looma-knit/timeline' })
  })

  it('appends retained pages in reverse chronological order and reports what loaded', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.searchParams.get('cursor') === '2') {
        return new Response(JSON.stringify({
          events: [
            { at: '2026-05-19T14:58:00.000Z', event: { type: 'error', message: 'oldest' } },
            { at: '2026-05-19T14:59:00.000Z', event: { type: 'error', message: 'older' } },
          ],
          cursor: 2,
          limit: 100,
          total: 4,
          hasMore: false,
        }), { headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        events: [
          { at: '2026-05-19T15:00:00.000Z', event: { type: 'error', message: 'newer' } },
          { at: '2026-05-19T15:01:00.000Z', event: { type: 'error', message: 'newest' } },
        ],
        cursor: 0,
        limit: 100,
        total: 4,
        hasMore: true,
        nextCursor: 2,
      }), { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TimelineTab, {
      props: {
        detail: {
          id: 'looma-knit',
          name: 'Looma + Knit',
          path: '/repo/looma-knit',
          tasks: [],
        },
      },
    })

    await screen.findByText('ERROR: newest')
    expect(screen.getAllByText(/15:0/).map(row => row.textContent)).toEqual(['15:01:00', '15:00:00'])

    await user.click(screen.getByRole('button', { name: 'Show earlier updates' }))

    expect((await screen.findByRole('status')).textContent).toContain('Loaded 2 earlier updates.')
    expect(screen.getAllByText(/14:5|15:0/).map(row => row.textContent)).toEqual([
      '15:01:00',
      '15:00:00',
      '14:59:00',
      '14:58:00',
    ])
    expect(screen.queryByRole('button', { name: 'Show earlier updates' })).toBeNull()
  })

  it('skips duplicate-only retained pages in one load-older action', async () => {
    const user = userEvent.setup()
    const newest = { at: '2026-05-19T15:01:00.000Z', event: { type: 'error', message: 'newest' } }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const cursor = new URL(String(input), 'http://localhost').searchParams.get('cursor')
      if (cursor === '1') {
        return new Response(JSON.stringify({
          events: [newest],
          cursor: 1,
          limit: 100,
          total: 3,
          hasMore: true,
          nextCursor: 2,
        }))
      }
      if (cursor === '2') {
        return new Response(JSON.stringify({
          events: [{ at: '2026-05-19T14:59:00.000Z', event: { type: 'error', message: 'older' } }],
          cursor: 2,
          limit: 100,
          total: 3,
          hasMore: false,
        }))
      }
      return new Response(JSON.stringify({
        events: [newest],
        cursor: 0,
        limit: 100,
        total: 3,
        hasMore: true,
        nextCursor: 1,
      }))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TimelineTab, {
      props: {
        detail: {
          id: 'looma-knit',
          name: 'Looma + Knit',
          path: '/repo/looma-knit',
          tasks: [],
        },
      },
    })

    await screen.findByText('ERROR: newest')
    await user.click(screen.getByRole('button', { name: 'Show earlier updates' }))

    expect((await screen.findByRole('status')).textContent).toContain('Loaded 1 earlier update.')
    expect(screen.getAllByText('ERROR: newest')).toHaveLength(1)
    expect(screen.getByText('ERROR: older')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(screen.queryByRole('button', { name: 'Show earlier updates' })).toBeNull()
  })

  it('retires earlier-history control when it only finds hidden transport events', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const cursor = new URL(String(input), 'http://localhost').searchParams.get('cursor')
      if (cursor === '1') {
        return new Response(JSON.stringify({
          events: [{ at: '2026-05-19T14:59:00.000Z', event: { type: 'assistant_delta', message: 'internal trace' } }],
          cursor: 1,
          limit: 100,
          total: 2,
          hasMore: true,
          nextCursor: 2,
        }), { headers: { 'content-type': 'application/json' } })
      }
      if (cursor === '2') {
        return new Response(JSON.stringify({
          events: [{ at: '2026-05-19T14:58:00.000Z', event: { type: 'provider_health_changed', message: 'healthy' } }],
          cursor: 2,
          limit: 100,
          total: 2,
          hasMore: false,
        }), { headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        events: [{ at: '2026-05-19T15:00:00.000Z', event: { type: 'error', message: 'newest' } }],
        cursor: 0,
        limit: 100,
        total: 3,
        hasMore: true,
        nextCursor: 1,
      }), { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TimelineTab, {
      props: { detail: { id: 'looma-knit', name: 'Looma + Knit', path: '/repo/looma-knit', tasks: [] } },
    })

    await screen.findByText('ERROR: newest')
    await user.click(screen.getByRole('button', { name: 'Show earlier updates' }))

    expect((await screen.findByRole('status')).textContent).toContain('No earlier user-visible updates.')
    expect(screen.queryByRole('button', { name: 'Show earlier updates' })).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('hides provider health noise from the default timeline', () => {
    render(TimelineTab, {
      props: {
        detail: {
          id: 'looma-knit',
          name: 'Looma + Knit',
          path: '/repo/looma-knit',
          tasks: [],
          recentEvents: [
            {
              at: '2026-05-19T15:00:00.000Z',
              event: { type: 'provider_health_changed', message: 'OpenAI-compatible API is now healthy' },
            },
            {
              at: '2026-05-19T15:01:00.000Z',
              event: { type: 'provider_health_changed', message: 'OpenAI-compatible API is now healthy' },
            },
            {
              at: '2026-05-19T15:02:00.000Z',
              event: {
                type: 'task_transition',
                task_id: 'task-a',
                from_status: 'ready',
                to_status: 'in_progress',
                agent_name: 'worker-agent',
              },
            },
          ],
        },
      },
    })

    expect(screen.getByText(/Task A Ready/)).toBeTruthy()
    expect(screen.queryByText(/provider health/i)).toBeNull()
    expect(screen.queryByText('2 connection checks hidden.')).toBeNull()
  })

  it('does not put raw live agent events in the owner timeline', () => {
    render(TimelineTab, {
      props: {
        detail: {
          id: 'looma-knit',
          name: 'Looma + Knit',
          path: '/repo/looma-knit',
          run: { status: 'running', mode: 'one_task' },
          tasks: [],
          recentEvents: [
            {
              at: '2026-05-19T15:00:00.000Z',
              event: { type: 'assistant_delta', task_id: 'task-a', agent_name: 'worker-agent', message: 'Checking files' },
            },
            {
              at: '2026-05-19T15:01:00.000Z',
              event: { type: 'tool_started', task_id: 'task-a', agent_name: 'worker-agent', message: 'rg' },
            },
            {
              at: '2026-05-19T15:02:00.000Z',
              event: { type: 'agent_started', task_id: 'task-a', agent_name: 'worker-agent' },
            },
          ],
        },
      },
    })

    expect(screen.getByText('Builder started Task A')).toBeTruthy()
    expect(screen.queryByText('Live agent stream')).toBeNull()
    expect(screen.queryByText('Show live agent event details')).toBeNull()
    expect(screen.queryByText('Checking files')).toBeNull()
  })
})
