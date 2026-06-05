import type { EventEnvelope, ProjectDetail, ServiceProjectSummary, Task } from './types.js'
import { friendlyTaskId, labelForIdentifier } from './identifier-labels.js'
import { friendlyRuntimeMessage, isGitUnavailableMessage } from './runtime-message.js'

export type ProjectActivityTone = 'idle' | 'active' | 'ok' | 'warn' | 'danger'

export interface ProjectActivityLine {
  tone: ProjectActivityTone
  pulse: boolean
  label: string
  message: string
  detail?: string | undefined
  actorLabel?: string
  timeLabel?: string | null
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural
}

function titleForTask(tasks: Task[] | undefined, taskId: string | undefined): string | null {
  if (!taskId) return null
  const task = (tasks ?? []).find(item => item.id === taskId)
  return task?.title ?? friendlyTaskId(taskId)
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
  if (!agentName) return 'Guildhall'
  return labelForIdentifier('agent', agentName).label
}

function runReasonLabel(reason: string | undefined): string {
  if (!reason) return 'Run stopped'
  return labelForIdentifier('run-reason', reason).label
}

function activeTaskCount(detail: ProjectDetail | null | undefined): number {
  return (detail?.tasks ?? []).filter(task =>
    ['exploring', 'spec_review', 'ready', 'in_progress', 'review', 'gate_check'].includes(task.status ?? ''),
  ).length
}

function importDraftCount(detail: ProjectDetail | null | undefined): number {
  return (detail?.tasks ?? []).filter(task => (task.status ?? '') === 'import_draft').length
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
        message: title
          ? `${title} moved to ${labelForIdentifier('status', toStatus).label.toLowerCase()}`
          : `Task moved to ${labelForIdentifier('status', toStatus).label.toLowerCase()}`,
        timeLabel,
      }
    }
    case 'error':
      return {
        tone: 'danger',
        pulse: false,
        actorLabel: isGitUnavailableMessage(inner.message) ? 'Git' : 'Error',
        label: 'Error',
        message: typeof inner.message === 'string' && inner.message.length > 0 ? friendlyRuntimeMessage(inner.message) : 'Run hit an error',
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
        message: `Run finished: ${runReasonLabel(typeof inner.reason === 'string' ? inner.reason : undefined)}`,
        detail: typeof inner.message === 'string' && inner.message.length > 0
          ? inner.message
          : undefined,
        timeLabel,
      }
    case 'supervisor_error':
      return {
        tone: 'danger',
        pulse: false,
        actorLabel: isGitUnavailableMessage(inner.message) ? 'Git' : 'Coordinator',
        label: 'Error',
        message: typeof inner.message === 'string' && inner.message.length > 0 ? friendlyRuntimeMessage(inner.message) : 'Coordinator error',
        timeLabel,
      }
    case 'provider_health_changed':
      return {
        tone: 'warn',
        pulse: false,
        actorLabel: 'Providers',
        label: 'Provider',
        message:
          typeof inner.message === 'string' && inner.message.length > 0
            ? friendlyRuntimeMessage(inner.message)
            : 'Provider health changed',
        timeLabel,
      }
    default:
      return null
  }
}

function ownerInputTickerMessage(message: string | undefined): string {
  if (/question|answer/i.test(message ?? '')) return 'Waiting for your answer'
  if (/spec/i.test(message ?? '')) return 'Spec review pending'
  if (/brief/i.test(message ?? '')) return 'Brief review pending'
  if (/recover|blocked|escalation/i.test(message ?? '')) return 'Recovery decision pending'
  return 'Waiting on your input'
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
      message: 'Finish first-time setup',
      timeLabel: null,
    }
  }

  if (detail?.startReadiness?.code === 'owner_input_required') {
    return {
      tone: 'warn',
      pulse: false,
      actorLabel: 'Needs you',
      label: 'Needs you',
      message: ownerInputTickerMessage(detail.startReadiness.message),
      timeLabel: null,
    }
  }

  if (detail?.startReadiness?.code === 'required_migration_pending') {
    return {
      tone: 'warn',
      pulse: false,
      actorLabel: 'Needs migration',
      label: 'Needs migration',
      message: detail.startReadiness.message || 'Run the required migration before starting this project.',
      timeLabel: null,
    }
  }

  if (detail?.run?.status === 'error') {
    return {
      tone: 'danger',
      pulse: false,
      actorLabel: 'Run error',
      label: 'Error',
      message: friendlyRuntimeMessage(detail.run.error ?? 'Run failed.'),
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

  const active = activeTaskCount(detail)
  const importDrafts = importDraftCount(detail)
  const blocked = blockedTaskCount(detail)
  const eventType = latestEvent?.event?.type ?? latestEvent?.type
  const eventReason = latestEvent?.event?.reason ?? latestEvent?.reason
  const staleStoppedEvent =
    eventType === 'supervisor_stopped' &&
    eventReason !== 'all_terminal' &&
    (importDrafts > 0 || blocked > 0 || active > 0)
  const staleGitUnavailableEvent =
    isGitUnavailableMessage(latestEvent?.event?.message ?? latestEvent?.message) &&
    !hasCurrentGitUnavailableStory(detail)
  const fromEvent = staleStoppedEvent || staleGitUnavailableEvent ? null : lineFromEvent(detail, latestEvent, now)
  if (fromEvent) return fromEvent

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
  if (importDrafts > 0) {
    return {
      tone: 'warn',
      pulse: false,
      actorLabel: 'Needs brief',
      label: 'Needs brief',
      message: `${importDrafts} imported ${pluralize(importDrafts, 'draft')} ${importDrafts === 1 ? 'needs' : 'need'} task briefs`,
      timeLabel: null,
    }
  }
  if (active > 0) {
    return {
      tone: 'idle',
      pulse: false,
      actorLabel: 'Paused',
      label: 'Paused',
      message: `${active} ${pluralize(active, 'task')} paused until you resume`,
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

export function hasCurrentGitUnavailableStory(detail: ProjectDetail | null | undefined): boolean {
  const snapshots = detail?.gitStory?.snapshots ?? []
  const blockers = detail?.gitStory?.blockers ?? []
  return [...snapshots, ...blockers].some(item =>
    item.state === 'unknown' && isGitUnavailableMessage(item.reason),
  )
}

export function buildProjectCardTicker(project: ServiceProjectSummary): ProjectActivityLine {
  const counts = project.taskCounts ?? { total: 0, active: 0, draftReview: 0, blocked: 0, done: 0, shelved: 0 }
  if (project.initializationNeeded) {
    return { tone: 'warn', pulse: false, label: 'Setup', message: 'First-time setup' }
  }
  if (project.startReadiness?.code === 'required_migration_pending') {
    return {
      tone: 'warn',
      pulse: false,
      label: 'Needs migration',
      message: project.startReadiness.message ?? 'Run the required migration before starting this project.',
    }
  }
  if (project.startReadiness?.code === 'owner_input_required') {
    return {
      tone: 'warn',
      pulse: false,
      label: 'Needs you',
      message: project.startReadiness.message ?? 'Waiting on your input.',
    }
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
      label: 'Needs brief',
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
