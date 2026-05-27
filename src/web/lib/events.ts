/**
 * Tiny pub/sub used to decouple the SSE connection from subscribers.
 * The router opens a single EventSource; any surface can subscribe.
 *
 * We intentionally do NOT use a Svelte store here — $state inside each
 * subscriber is sufficient, and a store would drag in reactivity that
 * we don't need at the SSE boundary.
 */

import type { EventEnvelope } from './types.js'
import { currentProjectId, withProjectQuery } from './project-routes.js'
import { friendlyTaskId, labelForIdentifier } from './identifier-labels.js'
import { friendlyRuntimeMessage } from './runtime-message.js'

type Listener = (ev: EventEnvelope) => void

const listeners = new Set<Listener>()
let current: EventSource | null = null
let currentUrl: string | null = null

export type SseStatus = 'connecting' | 'live' | 'reconnecting' | 'error'
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
  const projectId = currentProjectId()
  if (!projectId) {
    disconnectStream()
    return
  }
  const nextUrl = withProjectQuery('/api/project/events', projectId)
  if (current && currentUrl === nextUrl) return
  if (current) current.close()
  currentUrl = nextUrl
  setStatus('connecting')
  const es = new EventSource(nextUrl)
  current = es
  es.onopen = () => setStatus('live')
  es.onerror = () => setStatus(status === 'live' || status === 'reconnecting' ? 'reconnecting' : 'error')
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

export function disconnectStream(): void {
  if (current) current.close()
  current = null
  currentUrl = null
  setStatus('connecting')
}

export function summarizeEvent(env: EventEnvelope): string {
  const inner = env.event ?? (env as EventEnvelope as EventEnvelope & Record<string, unknown>)
  const type = (inner.type as string) ?? ''
  const taskLabel = (value: unknown) => typeof value === 'string' ? friendlyTaskId(value) : 'Task'
  const agentLabel = (value: unknown) => typeof value === 'string' ? labelForIdentifier('agent', value).label : 'Guildhall'
  const statusLabel = (value: unknown) => typeof value === 'string' ? labelForIdentifier('status', value).label : 'Unknown'
  const runReasonLabel = (value: unknown) => typeof value === 'string' ? labelForIdentifier('run-reason', value).label : ''
  const messageLabel = (value: unknown) => friendlyRuntimeMessage(typeof value === 'string' ? value : '')
  const reasonLabel = (value: unknown) => {
    if (typeof value !== 'string') return ''
    return friendlyRuntimeMessage(value.replace(/^[a-z][a-z0-9_]*:\s*/i, '').trim() || value)
  }
  const codeLabel = (value: unknown) => typeof value === 'string' ? labelForIdentifier('status', value).label : 'Issue'
  switch (type) {
    case 'task_transition':
      return `${taskLabel(inner.task_id)} ${statusLabel(inner.from_status)} → ${statusLabel(inner.to_status)} (${agentLabel(inner.agent_name)}${inner.reason ? ': ' + reasonLabel(inner.reason) : ''})`
    case 'escalation_raised':
      return `Needs attention: ${taskLabel(inner.task_id)}${inner.agent_name ? ' by ' + agentLabel(inner.agent_name) : ''}${inner.reason ? ' — ' + reasonLabel(inner.reason) : ''}`
    case 'error':
      return 'ERROR: ' + messageLabel(inner.message)
    case 'agent_issue':
      return `${codeLabel(inner.code)}: ${taskLabel(inner.task_id)}${inner.reason ? ' — ' + reasonLabel(inner.reason) : ''}`
    case 'agent_started':
      return `${agentLabel(inner.agent_name)} started ${taskLabel(inner.task_id)}`
    case 'agent_finished':
      return `${agentLabel(inner.agent_name)} finished ${taskLabel(inner.task_id)}`
    case 'supervisor_started':
    case 'supervisor_stopped':
    case 'supervisor_error':
      return (
        type.replace('supervisor_', '') +
        (inner.reason ? ` (${runReasonLabel(inner.reason)})` : '') +
        (inner.message ? ': ' + messageLabel(inner.message) : '')
      )
    case 'provider_health_changed':
      return 'provider health' + (inner.message ? ': ' + inner.message : '')
    case 'assistant_complete':
      return 'Finished a thought'
    case 'heartbeat':
    case 'connected':
      return ''
    default:
      if (inner.message) return `${labelForIdentifier('status', type).label}: ${messageLabel(inner.message)}`
      if (inner.reason) return `${labelForIdentifier('status', type).label}: ${reasonLabel(inner.reason)}`
      return labelForIdentifier('status', type).label
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
  if (type === 'agent_started' || type === 'agent_finished') return 'supervisor'
  if (type.startsWith('supervisor_')) return 'supervisor'
  if (type === 'provider_health_changed') return 'issue'
  return ''
}
