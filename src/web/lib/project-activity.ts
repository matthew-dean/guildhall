import type { EventEnvelope, ProjectDetail, ServiceProjectSummary, Task } from './types.js'

export type ProjectActivityTone = 'idle' | 'active' | 'ok' | 'warn' | 'danger'

export interface ProjectActivityLine {
  tone: ProjectActivityTone
  pulse: boolean
  label: string
  message: string
  actorLabel?: string
  timeLabel?: string | null
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural
}

function titleForTask(tasks: Task[] | undefined, taskId: string | undefined): string | null {
  if (!taskId) return null
  const task = (tasks ?? []).find(item => item.id === taskId)
  return task?.title ?? null
}

function parseTimeLabel(at: string | undefined, now: Date): string | null {
  if (!at) return null
  const ts = Date.parse(at)
  if (!Number.isFinite(ts)) return null
  const deltaSeconds = Math.max(0, Math.floor((now.getTime() - ts) / 1000))
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`
  const deltaMinutes = Math.floor(deltaSeconds / 60)
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`
  const deltaHours = Math.floor(deltaMinutes / 60)
  if (deltaHours < 24) return `${deltaHours}h ago`
  const deltaDays = Math.floor(deltaHours / 24)
  return `${deltaDays}d ago`
}

function agentLabel(agentName: string | undefined): string {
  switch (agentName) {
    case 'worker-agent':
      return 'Worker'
    case 'spec-agent':
      return 'Spec agent'
    case 'reviewer-agent':
      return 'Reviewer'
    case 'proposal-promoter':
    case 'pre-rejection-policy':
      return 'Coordinator'
    default:
      if (!agentName) return 'Guildhall'
      if (agentName.includes('coord')) return 'Coordinator'
      return agentName.replace(/[-_]/g, ' ').replace(/\bagent\b/i, '').trim() || 'Guildhall'
  }
}

function activeTaskCount(detail: ProjectDetail | null | undefined): number {
  return (detail?.tasks ?? []).filter(task =>
    ['exploring', 'spec_review', 'ready', 'in_progress', 'review', 'gate_check'].includes(task.status ?? ''),
  ).length
}

function blockedTaskCount(detail: ProjectDetail | null | undefined): number {
  return (detail?.tasks ?? []).filter(task => (task.status ?? '') === 'blocked').length
}

function lineFromEvent(
  detail: ProjectDetail | null | undefined,
  event: EventEnvelope | null,
  now: Date,
): ProjectActivityLine | null {
  const inner = event?.event ?? event
  const type = inner?.type
  if (!type) return null
  const taskId = typeof inner.task_id === 'string' ? inner.task_id : typeof inner.taskId === 'string' ? inner.taskId : undefined
  const title = titleForTask(detail?.tasks, taskId) ?? taskId
  const timeLabel = parseTimeLabel(event?.at, now)

  switch (type) {
    case 'agent_started':
      return {
        tone: 'active',
        pulse: true,
        actorLabel: agentLabel(typeof inner.agent_name === 'string' ? inner.agent_name : undefined),
        label: 'Live',
        message: `Started ${title ?? 'work'}`,
        timeLabel,
      }
    case 'agent_finished':
      return {
        tone: 'ok',
        pulse: false,
        actorLabel: agentLabel(typeof inner.agent_name === 'string' ? inner.agent_name : undefined),
        label: 'Updated',
        message: `Finished ${title ?? 'work'}`,
        timeLabel,
      }
    case 'task_transition': {
      const toStatus = typeof inner.to_status === 'string' ? inner.to_status : ''
      if (toStatus === 'done') {
        return {
          tone: 'ok',
          pulse: false,
          actorLabel: 'Done',
          label: 'Done',
          message: title ? `${title} finished` : 'Task finished',
          timeLabel,
        }
      }
      if (toStatus === 'blocked') {
        return {
          tone: 'warn',
          pulse: false,
          actorLabel: 'Blocked',
          label: 'Blocked',
          message: typeof inner.reason === 'string' && inner.reason.length > 0 ? inner.reason : title ?? 'Task blocked',
          timeLabel,
        }
      }
      return {
        tone: 'active',
        pulse: true,
        actorLabel: agentLabel(typeof inner.agent_name === 'string' ? inner.agent_name : undefined),
        label: 'Live',
        message: title ? `${title} moved to ${toStatus.replace(/_/g, ' ')}` : `Task moved to ${toStatus.replace(/_/g, ' ')}`,
        timeLabel,
      }
    }
    case 'error':
      return {
        tone: 'danger',
        pulse: false,
        actorLabel: 'Error',
        label: 'Error',
        message: typeof inner.message === 'string' && inner.message.length > 0 ? inner.message : 'Run hit an error',
        timeLabel,
      }
    case 'escalation_raised':
    case 'agent_issue':
      return {
        tone: 'warn',
        pulse: false,
        actorLabel: 'Blocked',
        label: 'Blocked',
        message:
          (typeof inner.reason === 'string' && inner.reason.length > 0 ? inner.reason : null)
          ?? (typeof inner.message === 'string' && inner.message.length > 0 ? inner.message : null)
          ?? (title ? `${title} needs attention` : 'Task needs attention'),
        timeLabel,
      }
    case 'supervisor_started':
      return {
        tone: 'active',
        pulse: true,
        actorLabel: 'Coordinator',
        label: 'Live',
        message: 'Run started',
        timeLabel,
      }
    case 'supervisor_stopped':
      return {
        tone: 'idle',
        pulse: false,
        actorLabel: 'Coordinator',
        label: 'Stopped',
        message: typeof inner.reason === 'string' && inner.reason.length > 0 ? inner.reason : 'Run stopped',
        timeLabel,
      }
    case 'supervisor_error':
      return {
        tone: 'danger',
        pulse: false,
        actorLabel: 'Coordinator',
        label: 'Error',
        message: typeof inner.message === 'string' && inner.message.length > 0 ? inner.message : 'Coordinator error',
        timeLabel,
      }
    case 'provider_health_changed':
      return {
        tone: 'warn',
        pulse: false,
        actorLabel: 'Providers',
        label: 'Provider',
        message: typeof inner.message === 'string' && inner.message.length > 0 ? inner.message : 'Provider health changed',
        timeLabel,
      }
    default:
      return null
  }
}

export function buildProjectTicker(
  detail: ProjectDetail | null | undefined,
  latestEvent: EventEnvelope | null,
  now = new Date(),
): ProjectActivityLine {
  if (detail?.initializationNeeded) {
    return {
      tone: 'warn',
      pulse: false,
      actorLabel: 'Setup',
      label: 'Setup',
      message: 'Finish first-time Guildhall setup',
      timeLabel: null,
    }
  }

  const stopSummary = detail?.run?.stopSummary
  if (detail?.run?.status !== 'running' && stopSummary?.stopReason === 'awaiting_human') {
    return {
      tone: 'warn',
      pulse: false,
      actorLabel: 'Needs you',
      label: 'Needs you',
      message: stopSummary.stopMessage || 'Waiting on your input',
      timeLabel: null,
    }
  }
  if (detail?.run?.status !== 'running' && stopSummary?.stopReason === 'blocked_only') {
    return {
      tone: 'warn',
      pulse: false,
      actorLabel: 'Blocked',
      label: 'Blocked',
      message: stopSummary.stopMessage || 'Blocked work needs attention',
      timeLabel: null,
    }
  }

  const fromEvent = lineFromEvent(detail, latestEvent, now)
  if (fromEvent) return fromEvent

  const active = activeTaskCount(detail)
  const blocked = blockedTaskCount(detail)
  if (detail?.run?.status === 'running') {
    return {
      tone: 'active',
      pulse: true,
      actorLabel: 'Coordinator',
      label: 'Live',
      message:
        active > 0
          ? `Working on ${active} ${pluralize(active, 'task')}`
          : 'Run is active on this project',
      timeLabel: null,
    }
  }
  if (blocked > 0) {
    return {
      tone: 'warn',
      pulse: false,
      actorLabel: 'Blocked',
      label: 'Blocked',
      message: `${blocked} blocked ${pluralize(blocked, 'task')}`,
      timeLabel: null,
    }
  }
  if (active > 0) {
    return {
      tone: 'idle',
      pulse: false,
      actorLabel: 'Queued',
      label: 'Queued',
      message: `${active} ${pluralize(active, 'task')} queued to resume`,
      timeLabel: null,
    }
  }

  return {
    tone: 'idle',
    pulse: false,
    actorLabel: 'Idle',
    label: 'Idle',
    message: 'No recent activity',
    timeLabel: null,
  }
}

export function buildProjectCardTicker(project: ServiceProjectSummary): ProjectActivityLine {
  const counts = project.taskCounts ?? { total: 0, active: 0, draftReview: 0, blocked: 0, done: 0, shelved: 0 }
  if (project.initializationNeeded) {
    return { tone: 'warn', pulse: false, label: 'Setup', message: 'First-time Guildhall setup' }
  }
  if (project.run?.status === 'running') {
    return {
      tone: 'active',
      pulse: true,
      label: 'Live',
      message:
        project.highlights?.activeTaskTitle
          ?? (counts.active > 0 ? `Working on ${counts.active} ${pluralize(counts.active, 'task')}` : 'Run is active'),
    }
  }
  if (counts.blocked > 0) {
    return {
      tone: 'warn',
      pulse: false,
      label: 'Blocked',
      message:
        project.highlights?.blockedTaskTitle
          ?? `${counts.blocked} blocked ${pluralize(counts.blocked, 'task')}`,
    }
  }
  if ((counts.draftReview ?? 0) > 0 && counts.active === 0) {
    return {
      tone: 'warn',
      pulse: false,
      label: 'Needs shaping',
      message: `${counts.draftReview} imported ${pluralize(counts.draftReview, 'draft')} waiting`,
    }
  }
  if (counts.active > 0) {
    return {
      tone: 'idle',
      pulse: false,
      label: 'Paused',
      message:
        project.highlights?.activeTaskTitle
          ?? `${counts.active} ${pluralize(counts.active, 'task')} paused`,
    }
  }
  if (project.highlights?.recentCompletedTaskTitle) {
    return {
      tone: 'ok',
      pulse: false,
      label: 'Recent',
      message: project.highlights.recentCompletedTaskTitle,
    }
  }
  return {
    tone: 'idle',
    pulse: false,
    label: 'Idle',
    message: 'No recent activity',
  }
}
