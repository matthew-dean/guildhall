/**
 * Tiny pub/sub used to decouple the SSE connection from subscribers.
 * The router opens a single EventSource; any surface can subscribe.
 *
 * We intentionally do NOT use a Svelte store here — $state inside each
 * subscriber is sufficient, and a store would drag in reactivity that
 * we don't need at the SSE boundary.
 */

import type { EventEnvelope } from './types.js'

type Listener = (ev: EventEnvelope) => void

const listeners = new Set<Listener>()
let current: EventSource | null = null

export type SseStatus = 'connecting' | 'live' | 'error'
type StatusListener = (s: SseStatus) => void
const statusListeners = new Set<StatusListener>()
let status: SseStatus = 'connecting'

export function onEvent(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function onStatus(fn: StatusListener): () => void {
  statusListeners.add(fn)
  fn(status)
  return () => statusListeners.delete(fn)
}

function setStatus(next: SseStatus) {
  if (status === next) return
  status = next
  for (const fn of statusListeners) fn(next)
}

export function connectStream(): void {
  if (current) current.close()
  setStatus('connecting')
  const es = new EventSource('/api/project/events')
  current = es
  es.onopen = () => setStatus('live')
  es.onerror = () => setStatus('error')
  es.onmessage = e => {
    setStatus('live')
    try {
      const data = JSON.parse(e.data) as EventEnvelope
      if (data.type === 'connected' || data.type === 'heartbeat') return
      for (const fn of listeners) fn(data)
    } catch {
      /* malformed event frames are dropped — the next one will be parseable */
    }
  }
}

export function summarizeEvent(env: EventEnvelope): string {
  const inner = env.event ?? (env as EventEnvelope as EventEnvelope & Record<string, unknown>)
  const type = (inner.type as string) ?? ''
  switch (type) {
    case 'task_transition':
      return `${inner.task_id} ${inner.from_status} → ${inner.to_status} (${inner.agent_name ?? ''}${inner.reason ? ': ' + inner.reason : ''})`
    case 'escalation_raised':
      return `ESCALATION ${inner.task_id}${inner.agent_name ? ' by ' + inner.agent_name : ''} — ${inner.reason ?? ''}`
    case 'error':
      return 'ERROR: ' + (inner.message ?? '')
    case 'agent_issue':
      return `issue [${inner.severity}/${inner.code}] ${inner.task_id} — ${inner.reason ?? ''}`
    case 'supervisor_started':
    case 'supervisor_stopped':
    case 'supervisor_error':
      return type.replace('supervisor_', '') + (inner.message ? ': ' + inner.message : '')
    case 'heartbeat':
    case 'connected':
      return ''
    default:
      return type + ' ' + JSON.stringify(inner).slice(0, 200)
  }
}

export function eventTaskId(env: EventEnvelope): string | null {
  const inner = env.event ?? env
  const id = (inner as { task_id?: string; taskId?: string }).task_id
    ?? (inner as { task_id?: string; taskId?: string }).taskId
  return typeof id === 'string' ? id : null
}

export function eventCssClass(env: EventEnvelope): string {
  const type = env.event?.type ?? env.type ?? ''
  if (type === 'task_transition') return 'transition'
  if (type === 'escalation_raised') return 'escalation'
  if (type === 'error') return 'error'
  if (type === 'agent_issue') return 'issue'
  if (type.startsWith('supervisor_')) return 'supervisor'
  return ''
}
