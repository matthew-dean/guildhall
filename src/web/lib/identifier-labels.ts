import type { Task } from './types.js'

export type IdentifierKind = 'agent' | 'domain' | 'status' | 'priority' | 'progress' | 'task' | 'run-reason'
export type IdentifierTone = 'accent' | 'ok' | 'warn' | 'danger' | 'neutral'

export interface IdentifierLabel {
  label: string
  tone: IdentifierTone
}

const AGENT_LABELS: Record<string, IdentifierLabel> = {
  'spec-agent': { label: 'Spec writer', tone: 'accent' },
  'worker-agent': { label: 'Builder', tone: 'accent' },
  'reviewer-agent': { label: 'Review team', tone: 'warn' },
  'reviewer-fanout': { label: 'Review team', tone: 'warn' },
  'gate-checker-agent': { label: 'Gate checker', tone: 'ok' },
  'task-claimer': { label: 'Coordinator', tone: 'neutral' },
  'proposal-promoter': { label: 'Coordinator', tone: 'neutral' },
  coordinator: { label: 'Coordinator', tone: 'neutral' },
}

const DOMAIN_LABELS: Record<string, IdentifierLabel> = {
  _meta: { label: 'Setup', tone: 'neutral' },
  _workspace_import: { label: 'Workspace import', tone: 'neutral' },
}

const STATUS_LABELS: Record<string, IdentifierLabel> = {
  proposed: { label: 'Backlog', tone: 'neutral' },
  import_draft: { label: 'Needs task brief', tone: 'accent' },
  exploring: { label: 'Intake', tone: 'accent' },
  spec_review: { label: 'Awaiting approval', tone: 'warn' },
  parent: { label: 'Containing work', tone: 'neutral' },
  pending: { label: 'Ready', tone: 'neutral' },
  ready: { label: 'Ready', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'accent' },
  review: { label: 'In review', tone: 'accent' },
  gate_check: { label: 'Checking gates', tone: 'accent' },
  pending_pr: { label: 'Pending PR', tone: 'warn' },
  done: { label: 'Done', tone: 'ok' },
  blocked: { label: 'Blocked', tone: 'danger' },
  shelved: { label: 'Shelved', tone: 'warn' },
  assistant_complete: { label: 'Finished a thought', tone: 'neutral' },
  human_judgment_required: { label: 'Needs a decision', tone: 'warn' },
  spec_ambiguous: { label: 'Needs a clearer spec', tone: 'warn' },
  no_unattended_progress: { label: 'Nothing ready to run', tone: 'warn' },
}

const PRIORITY_LABELS: Record<string, IdentifierLabel> = {
  critical: { label: 'Critical', tone: 'danger' },
  high: { label: 'High', tone: 'warn' },
  normal: { label: 'Normal', tone: 'neutral' },
  low: { label: 'Low', tone: 'ok' },
}

const PROGRESS_LABELS: Record<string, IdentifierLabel> = {
  heartbeat: { label: 'Update', tone: 'accent' },
  milestone: { label: 'Milestone', tone: 'ok' },
  blocked: { label: 'Blocked', tone: 'danger' },
  escalation: { label: 'Needs attention', tone: 'danger' },
}

const RUN_REASON_LABELS: Record<string, IdentifierLabel> = {
  all_terminal: { label: 'Run finished', tone: 'ok' },
  awaiting_human: { label: 'Waiting on input', tone: 'warn' },
  blocked_only: { label: 'Blocked', tone: 'warn' },
  dependency_blocked: { label: 'Blocked on dependencies', tone: 'warn' },
  one_task: { label: 'One task finished', tone: 'ok' },
  stopped: { label: 'Run stopped', tone: 'neutral' },
}

export function labelForIdentifier(kind: IdentifierKind, value: string | undefined): IdentifierLabel {
  const raw = (value ?? '').trim()
  const key = raw.toLowerCase()
  if (!key) return { label: kind === 'task' ? 'Task' : 'Unknown', tone: 'neutral' }
  if (kind === 'agent') return AGENT_LABELS[key] ?? { label: titleize(key.replace(/-agent$/, '')), tone: 'neutral' }
  if (kind === 'domain') return DOMAIN_LABELS[key] ?? { label: titleize(key.replace(/^_+/, '')), tone: 'neutral' }
  if (kind === 'status') return STATUS_LABELS[key] ?? { label: titleize(key), tone: 'neutral' }
  if (kind === 'priority') return PRIORITY_LABELS[key] ?? { label: titleize(key), tone: 'neutral' }
  if (kind === 'progress') return PROGRESS_LABELS[key] ?? { label: titleize(key), tone: 'neutral' }
  if (kind === 'run-reason') return RUN_REASON_LABELS[key] ?? { label: titleize(key), tone: 'neutral' }
  return { label: friendlyTaskId(raw), tone: 'neutral' }
}

export function friendlyTaskId(taskId: string | undefined): string {
  const raw = (taskId ?? '').trim()
  if (!raw) return 'Task'
  const suffix = raw.match(/(\d+)$/)?.[1]
  return suffix ? `Task ${Number.parseInt(suffix, 10)}` : titleize(raw)
}

export function taskTitleMap(tasks: Task[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const task of tasks) out[task.id] = task.title ?? friendlyTaskId(task.id)
  return out
}

export function friendlyTaskLabel(taskId: string | undefined, titles: Record<string, string>): string {
  const raw = (taskId ?? '').trim()
  return raw ? titles[raw] ?? friendlyTaskId(raw) : 'Task'
}

export function humanizeRuntimeText(text: string, taskTitles: Record<string, string> = {}): string {
  return text
    .replace(/\s+—\s+Command failed:[\s\S]*$/i, '.')
    .replace(/\s+at\s+\/Users\/[^\s]+/g, ' in the project checkout')
    .replace(/\b([a-z_]+)\s*→\s*([a-z_]+)\b/g, (_match, from: string, to: string) => {
      return `${labelForIdentifier('status', from).label} -> ${labelForIdentifier('status', to).label}`
    })
    .replace(/\b([a-z_]+) \(unchanged\)/g, (_match, status: string) => {
      return `${labelForIdentifier('status', status).label} (unchanged)`
    })
    .replace(/\bmoved task to ([a-z_]+)\b/gi, (_match, status: string) => {
      return `moved the task to ${labelForIdentifier('status', status).label.toLowerCase()}`
    })
    .replace(/\bTask (task-[A-Za-z0-9_-]+) complete\b/g, (_match, taskId: string) => {
      return `${friendlyTaskLabel(taskId, taskTitles)} complete`
    })
    .replace(/(?<![/-])\b(task-[A-Za-z0-9_-]+)\b/g, (_match, taskId: string) => {
      return friendlyTaskLabel(taskId, taskTitles)
    })
}

function titleize(value: string): string {
  return value
    .replace(/^_+/, '')
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
