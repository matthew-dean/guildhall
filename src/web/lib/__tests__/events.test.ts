// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectStream,
  disconnectStream,
  eventCssClass,
  eventTaskId,
  onEvent,
  onStatus,
  summarizeEvent,
} from '../events.js'
import { path } from '../nav.svelte.js'

type FakeEventSourceInstance = {
  url: string
  close: ReturnType<typeof vi.fn>
  onopen: (() => void) | null
  onerror: (() => void) | null
  onmessage: ((event: { data: string }) => void) | null
}

const instances: FakeEventSourceInstance[] = []

class FakeEventSource {
  url: string
  close = vi.fn()
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null

  constructor(url: string) {
    this.url = url
    instances.push(this)
  }
}

describe('event stream wiring', () => {
  beforeEach(() => {
    instances.length = 0
    window.history.replaceState({}, '', '/projects/looma-knit/thread')
    path.value = '/projects/looma-knit/thread'
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    disconnectStream()
    vi.restoreAllMocks()
  })

  it('opens one project-scoped stream, publishes parseable events, and drops heartbeats', () => {
    const statuses: string[] = []
    const events: unknown[] = []
    const offStatus = onStatus(status => statuses.push(status))
    const offEvent = onEvent(event => events.push(event))

    connectStream()
    connectStream()
    expect(instances).toHaveLength(1)
    expect(instances[0]!.url).toBe('/api/project/events?projectId=looma-knit')

    instances[0]!.onopen?.()
    instances[0]!.onmessage?.({ data: JSON.stringify({ type: 'heartbeat' }) })
    instances[0]!.onmessage?.({
      data: JSON.stringify({
        type: 'task_transition',
        task_id: 'task-1',
        from_status: 'ready',
        to_status: 'in_progress',
      }),
    })
    instances[0]!.onmessage?.({ data: '{not-json' })
    instances[0]!.onerror?.()

    expect(statuses).toEqual(['connecting', 'live', 'error'])
    expect(events).toEqual([
      {
        type: 'task_transition',
        task_id: 'task-1',
        from_status: 'ready',
        to_status: 'in_progress',
      },
    ])

    offEvent()
    offStatus()
  })

  it('switches streams when the active project route changes', () => {
    window.history.replaceState({}, '', '/projects/events-alpha/thread')
    path.value = '/projects/events-alpha/thread'
    connectStream()
    window.history.replaceState({}, '', '/projects/fair-labor-license/thread')
    path.value = '/projects/fair-labor-license/thread'
    connectStream()

    expect(instances).toHaveLength(2)
    expect(instances[0]!.close).toHaveBeenCalled()
    expect(instances[1]!.url).toBe('/api/project/events?projectId=fair-labor-license')
  })

  it('can close the stream while a project route performs its initial data load', () => {
    connectStream()
    expect(instances).toHaveLength(1)

    disconnectStream()
    expect(instances[0]!.close).toHaveBeenCalled()

    connectStream()
    expect(instances).toHaveLength(2)
    expect(instances[1]!.url).toBe('/api/project/events?projectId=looma-knit')
  })
})

describe('event display helpers', () => {
  it('summarizes live event types into concise ticker text', () => {
    expect(summarizeEvent({
      type: 'task_transition',
      task_id: 'task-1',
      from_status: 'ready',
      to_status: 'review',
      agent_name: 'worker-agent',
      reason: 'done',
    } as any)).toBe('Task 1 Ready → In review (Builder: done)')
    expect(summarizeEvent({ type: 'escalation_raised', task_id: 'task-2', reason: 'blocked' } as any)).toBe('Needs attention: Task 2 — blocked')
    expect(summarizeEvent({ type: 'error', message: 'boom' } as any)).toBe('ERROR: boom')
    expect(summarizeEvent({ type: 'agent_issue', severity: 'warn', code: 'stuck', task_id: 'task-3', reason: 'quiet' } as any)).toBe('Issue [warn/stuck] Task 3 — quiet')
    expect(summarizeEvent({ type: 'agent_started', agent_name: 'spec-agent', task_id: 'task-4' } as any)).toBe('Spec writer started Task 4')
    expect(summarizeEvent({ type: 'agent_finished', agent_name: 'reviewer-agent', task_id: 'task-5' } as any)).toBe('Review team finished Task 5')
    expect(summarizeEvent({ type: 'supervisor_stopped', reason: 'all_terminal' } as any)).toBe('stopped (Run finished)')
    expect(summarizeEvent({ type: 'provider_health_changed', message: 'ok' } as any)).toBe('provider health: ok')
    expect(summarizeEvent({ type: 'connected' } as any)).toBe('')
  })

  it('extracts task ids and CSS classes from both wrapped and flat envelopes', () => {
    expect(eventTaskId({ event: { type: 'agent_started', task_id: 'task-1' } } as any)).toBe('task-1')
    expect(eventTaskId({ type: 'agent_started', taskId: 'task-2' } as any)).toBe('task-2')
    expect(eventTaskId({ type: 'agent_started' } as any)).toBeNull()

    expect(eventCssClass({ type: 'task_transition' } as any)).toBe('transition')
    expect(eventCssClass({ event: { type: 'escalation_raised' } } as any)).toBe('escalation')
    expect(eventCssClass({ type: 'error' } as any)).toBe('error')
    expect(eventCssClass({ type: 'agent_issue' } as any)).toBe('issue')
    expect(eventCssClass({ type: 'agent_started' } as any)).toBe('supervisor')
    expect(eventCssClass({ type: 'supervisor_error' } as any)).toBe('supervisor')
    expect(eventCssClass({ type: 'provider_health_changed' } as any)).toBe('issue')
    expect(eventCssClass({ type: 'unknown' } as any)).toBe('')
  })
})
