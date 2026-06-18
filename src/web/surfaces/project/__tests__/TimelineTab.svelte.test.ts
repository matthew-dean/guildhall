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
    expect(screen.getByText('2 connection checks hidden.')).toBeTruthy()
  })

  it('opens raw live agent events when the project is running', () => {
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

    expect(screen.getByText('Live agent stream')).toBeTruthy()
    expect(screen.getByText(/2 raw agent events from the current recent stream/)).toBeTruthy()
    const details = document.querySelector('details.raw-trace')
    expect(details?.hasAttribute('open')).toBe(true)
    expect(screen.getByText('Show live agent event details')).toBeTruthy()
  })
})
