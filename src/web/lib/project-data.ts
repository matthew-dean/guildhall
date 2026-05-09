import type { CoordinatorConfig, EventEnvelope, ProjectDetail, Task } from './types.js'

export const THREAD_PHASE_ORDER = ['setup', 'intake', 'spec', 'ready', 'inflight', 'blocked', 'done'] as const
export type ThreadPhase = (typeof THREAD_PHASE_ORDER)[number]

export const THREAD_PHASE_LABELS: Record<ThreadPhase, string> = {
  setup: 'Setup',
  intake: 'Intake',
  spec: 'Spec',
  ready: 'Ready',
  inflight: 'In flight',
  blocked: 'Blocked',
  done: 'Done',
}

export interface ThreadPhaseLike {
  phase: ThreadPhase
  kind: string
  skippable?: boolean
  liveAgent?: unknown
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
              group.turns.length > 0 &&
              group.turns.every((turn) => turn.kind === 'inflight' && !turn.liveAgent)
            ? 'Paused'
            : THREAD_PHASE_LABELS[group.phase],
    }))
    .filter((group) => group.turns.length > 0)
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
  needsMeta: boolean
  running: boolean
  events: EventEnvelope[]
}

export function buildWorkSurface(detail: ProjectDetail): WorkSurfaceModel {
  const tasks = detail.tasks ?? []
  const coordinators = detail.config?.coordinators ?? []
  return {
    tasks,
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
  shelved: 8,
  done: 9,
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
        (coordinator) => (coordinator.id ?? coordinator.name ?? '').toString() === selectedCoordinatorId,
      )
    : allCoordinators
  const tasks = detail.tasks ?? []
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
      ? columns.find((column) => (column.c.id ?? column.c.name ?? '') === selectedCoordinatorId) ?? null
      : null,
    running: (detail.run?.status ?? 'stopped') === 'running',
  }
}
