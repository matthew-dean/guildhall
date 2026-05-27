import type { CoordinatorConfig, EventEnvelope, ProjectDetail, Task } from './types.js'

export const THREAD_PHASE_ORDER = ['setup', 'intake', 'spec', 'ready', 'inflight', 'blocked', 'done'] as const
export type ThreadPhase = (typeof THREAD_PHASE_ORDER)[number]

export const THREAD_PHASE_LABELS: Record<ThreadPhase, string> = {
  setup: 'Setup',
  intake: 'Intake',
  spec: 'Spec',
  ready: 'Ready',
  inflight: 'Work',
  blocked: 'Blocked',
  done: 'Completed updates',
}

export interface ThreadPhaseLike {
  phase: ThreadPhase
  kind: string
  skippable?: boolean
  liveAgent?: unknown
  taskStatus?: string
  activity?: Array<{ label?: string; tone?: string }>
}

export interface ThreadPhaseGroup<T extends ThreadPhaseLike> {
  phase: ThreadPhase
  turns: T[]
  label: string
}

export function buildThreadPhaseGroups<T extends ThreadPhaseLike>(turns: T[]): Array<ThreadPhaseGroup<T>> {
  return THREAD_PHASE_ORDER
    .map((phase) => ({
      phase,
      turns: turns.filter((turn) => turn.phase === phase),
    }))
    .map((group) => ({
      ...group,
      label:
        group.phase === 'setup' &&
        group.turns.every((turn) => turn.kind === 'setup_step' && turn.skippable)
          ? 'Optional'
          : group.phase === 'inflight' &&
              group.turns.some((turn) => isRecoveryTurnLike(turn))
            ? 'Needs recovery'
            : THREAD_PHASE_LABELS[group.phase],
    }))
    .filter((group) => group.turns.length > 0)
}

function isRecoveryTurnLike(turn: ThreadPhaseLike): boolean {
  if (turn.kind !== 'inflight' || turn.liveAgent || turn.taskStatus !== 'in_progress') return false
  const activity = turn.activity ?? []
  const hasFailure = activity.some(item =>
    item.tone === 'danger' ||
    /failed|timed out|empty assistant|error/i.test(item.label ?? ''),
  )
  const hasDurableProgress = activity.some(item =>
    item.tone === 'ok' ||
    /write file|wrote |checkpoint|committed|changed/i.test(item.label ?? ''),
  )
  return hasFailure && hasDurableProgress
}

export function sortEventsChronologically(items: EventEnvelope[]): EventEnvelope[] {
  return [...items].sort((left, right) => {
    const a = left.at ? Date.parse(left.at) : 0
    const b = right.at ? Date.parse(right.at) : 0
    return a - b
  })
}

export interface WorkSurfaceModel {
  tasks: Task[]
  importDraftCount: number
  nextImportDraft: Task | null
  needsMeta: boolean
  running: boolean
  events: EventEnvelope[]
}

export type ProjectActivityTone = 'neutral' | 'running' | 'ok' | 'warn' | 'danger'

export interface ProjectActivityInFlightTask {
  id: string
  title?: string
  status?: string
  domain?: string
  lastActivityAt?: string
  lastActivityLabel?: string
  lastActivityTone?: ProjectActivityTone
}

export interface ProjectActivitySummary {
  running?: boolean
  runStatus?: string
  counts: Record<string, number>
  inFlight: ProjectActivityInFlightTask[]
}

export function buildProjectActivitySummary(summary: ProjectActivitySummary): ProjectActivitySummary {
  return {
    running: summary.running,
    runStatus: summary.runStatus,
    counts: { ...summary.counts },
    inFlight: summary.inFlight.map((task) => ({ ...task })),
  }
}

export function buildWorkSurface(detail: ProjectDetail): WorkSurfaceModel {
  const allTasks = detail.tasks ?? []
  const importDrafts = allTasks.filter(task => task.status === 'import_draft')
  const tasks = allTasks.filter(task => task.status !== 'import_draft')
  const coordinators = detail.config?.coordinators ?? []
  return {
    tasks,
    importDraftCount: importDrafts.length,
    nextImportDraft: importDrafts[0] ?? null,
    needsMeta: coordinators.length === 0,
    running: (detail.run?.status ?? 'stopped') === 'running',
    events: sortEventsChronologically(detail.recentEvents ?? []),
  }
}

const COORDINATOR_STATUS_ORDER: Record<string, number> = {
  blocked: 0,
  in_progress: 1,
  review: 2,
  gate_check: 3,
  spec_review: 4,
  exploring: 5,
  ready: 6,
  proposed: 7,
  import_draft: 8,
  shelved: 9,
  done: 10,
}

const COORDINATOR_GLYPHS: Record<string, string> = {
  done: '■',
  in_progress: '◉',
  review: '◎',
  gate_check: '◎',
  spec_review: '◐',
  exploring: '◐',
  ready: '○',
  proposed: '·',
  import_draft: '·',
  blocked: '✕',
  shelved: '–',
}

export interface CoordinatorColumn {
  c: CoordinatorConfig
  domainTasks: Task[]
  active: number
  blocked: number
  awaitingApproval: number
  done: number
  spark: string
  visibleTasks: Task[]
}

export interface CoordinatorsSurfaceModel {
  allCoordinators: CoordinatorConfig[]
  selectedCoordinatorId: string | null
  coordinators: CoordinatorConfig[]
  columns: CoordinatorColumn[]
  selectedColumn: CoordinatorColumn | null
  running: boolean
}

function sparkline(domainTasks: Task[]): string {
  if (domainTasks.length === 0) return '(empty)'
  return domainTasks
    .slice(-24)
    .map((task) => COORDINATOR_GLYPHS[task.status ?? ''] ?? '?')
    .join('')
}

function prioritizedTasks(domainTasks: Task[]): Task[] {
  return [...domainTasks]
    .sort((left, right) => {
      const a = COORDINATOR_STATUS_ORDER[left.status ?? ''] ?? 99
      const b = COORDINATOR_STATUS_ORDER[right.status ?? ''] ?? 99
      if (a !== b) return a - b
      return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
    })
    .slice(0, 4)
}

export function buildCoordinatorsSurface(detail: ProjectDetail, subView: string | null | undefined): CoordinatorsSurfaceModel {
  const allCoordinators = detail.config?.coordinators ?? []
  const selectedCoordinatorId = subView && subView !== 'all' ? decodeURIComponent(subView) : null
  const coordinators = selectedCoordinatorId
    ? allCoordinators.filter(
        (coordinator) => (coordinator.id ?? coordinator.domain ?? '').toString() === selectedCoordinatorId,
      )
    : allCoordinators
  const tasks = (detail.tasks ?? []).filter(task => task.status !== 'import_draft')
  const columns = coordinators.map((coordinator) => {
    const domainTasks = tasks.filter((task) => task.domain === coordinator.domain)
    return {
      c: coordinator,
      domainTasks,
      active: domainTasks.filter((task) =>
        ['in_progress', 'review', 'gate_check', 'exploring'].includes(task.status ?? ''),
      ).length,
      blocked: domainTasks.filter((task) => task.status === 'blocked').length,
      awaitingApproval: domainTasks.filter((task) => task.status === 'spec_review').length,
      done: domainTasks.filter((task) => task.status === 'done').length,
      spark: sparkline(domainTasks),
      visibleTasks: prioritizedTasks(domainTasks),
    }
  })
  return {
    allCoordinators,
    selectedCoordinatorId,
    coordinators,
    columns,
    selectedColumn: selectedCoordinatorId
      ? columns.find((column) => (column.c.id ?? column.c.domain ?? '') === selectedCoordinatorId) ?? null
      : null,
    running: (detail.run?.status ?? 'stopped') === 'running',
  }
}
