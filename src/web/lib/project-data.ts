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
  importDrafts: Task[]
  importDraftCount: number
  nextImportDraft: Task | null
  workAreasByTaskId: Record<string, WorkArea>
  workAreaOptions: WorkArea[]
  needsMeta: boolean
  running: boolean
  events: EventEnvelope[]
}

export type WorkAreaKind =
  | 'child_project'
  | 'structural_domain'
  | 'cross_cutting_domain'
  | 'coordinator_domain'
  | 'task_domain'
  | 'source_path_fallback'
  | 'project'

export type WorkAreaSource =
  | 'project_graph'
  | 'structural_map'
  | 'routing_context'
  | 'task'
  | 'source_ref'
  | 'description_fallback'
  | 'fallback'

export type WorkAreaConfidence = 'accepted' | 'inferred' | 'fallback'

export interface WorkArea {
  id: string
  label: string
  kind: WorkAreaKind
  source: WorkAreaSource
  confidence: WorkAreaConfidence
  path?: string
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
  const visibleWorkTasks = visibleProjectTasks(detail)
  const importDrafts = visibleWorkTasks.filter(task => task.status === 'import_draft')
  const tasks = visibleWorkTasks.filter(task => task.status !== 'import_draft')
  const coordinators = detail.config?.coordinators ?? []
  const workAreasByTaskId = buildWorkAreasByTaskId(detail, visibleWorkTasks)
  return {
    tasks,
    importDrafts,
    importDraftCount: importDrafts.length,
    nextImportDraft: importDrafts[0] ?? null,
    workAreasByTaskId,
    workAreaOptions: workAreaOptions(visibleWorkTasks, workAreasByTaskId),
    needsMeta: coordinators.length === 0,
    running: (detail.run?.status ?? 'stopped') === 'running',
    events: sortEventsChronologically(detail.recentEvents ?? []),
  }
}

function visibleProjectTasks(detail: ProjectDetail): Task[] {
  const allTasks = detail.tasks ?? []
  const progressByTaskId = detail.workProgress?.byTaskId ?? {}
  const primaryActionTaskId = detail.actionModel?.primaryAction?.taskId
  return allTasks.filter(task => {
    if (task.id && task.id === primaryActionTaskId) return true
    if (['in_progress', 'review', 'gate_check'].includes(task.status ?? '')) return true
    const id = typeof task.id === 'string' ? task.id : ''
    const progress = id ? progressByTaskId[id] as { visibility?: { kind?: string; countInProjectTotals?: boolean } } | undefined : undefined
    if (!progress?.visibility) return true
    if (progress.visibility.countInProjectTotals === false) return false
    return progress.visibility.kind !== 'internal_step' && progress.visibility.kind !== 'hidden'
  })
}

function buildWorkAreasByTaskId(detail: ProjectDetail, tasks: Task[]): Record<string, WorkArea> {
  const byTaskId: Record<string, WorkArea> = {}
  for (const task of tasks) {
    byTaskId[task.id] = resolveWorkArea(detail, task)
  }
  return byTaskId
}

function workAreaOptions(tasks: Task[], byTaskId: Record<string, WorkArea>): WorkArea[] {
  const seen = new Map<string, WorkArea>()
  for (const task of tasks) {
    const area = byTaskId[task.id]
    if (!area || seen.has(area.id)) continue
    seen.set(area.id, area)
  }
  return [...seen.values()].sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }))
}

export function resolveWorkArea(detail: ProjectDetail, task: Task): WorkArea {
  return (
    workAreaFromAcceptedStructuralMap(detail, task) ??
    workAreaFromRoutingContext(detail, task) ??
    workAreaFromTaskDomain(detail, task) ??
    workAreaFromSourceRef(task) ??
    workAreaFromDescription(task) ??
    {
      id: 'project',
      label: 'Project',
      kind: 'project',
      source: 'fallback',
      confidence: 'fallback',
    }
  )
}

function workAreaFromAcceptedStructuralMap(detail: ProjectDetail, task: Task): WorkArea | null {
  const review = detail.structuralMapReview
  if (review?.state !== 'accepted') return null
  const pathHints = taskPathHints(task)
  const candidates = [
    ...(review.domains ?? []).map(node => ({ ...node, kind: 'structural_domain' as const })),
    ...(review.crossCuttingDomains ?? []).map(node => ({ ...node, kind: 'cross_cutting_domain' as const })),
  ]
  for (const candidate of candidates) {
    const path = normalizeRelativePath(candidate.path ?? '')
    if (!path) continue
    if (pathHints.some(hint => pathMatchesArea(hint, path))) {
      return {
        id: candidate.id || `structural:${path}`,
        label: candidate.label || labelFromAreaId(candidate.id || path),
        kind: candidate.kind,
        source: 'structural_map',
        confidence: 'accepted',
        path,
      }
    }
  }
  return null
}

function workAreaFromRoutingContext(detail: ProjectDetail, task: Task): WorkArea | null {
  const routing = detail.taskRoutingContexts?.[task.id]
  const area = routing?.likelyArea ?? routing?.primaryDomain
  if (!area?.id && !area?.label && !area?.path) return null
  const id = area.id || `routing:${normalizeRelativePath(area.path ?? '') || slugifyLabel(area.label ?? 'area')}`
  return {
    id,
    label: area.label || labelFromAreaId(id),
    kind: id.includes('cross') ? 'cross_cutting_domain' : 'structural_domain',
    source: 'routing_context',
    confidence: 'inferred',
    ...(area.path ? { path: normalizeRelativePath(area.path) } : {}),
  }
}

function workAreaFromTaskDomain(detail: ProjectDetail, task: Task): WorkArea | null {
  const domain = task.domain?.trim()
  if (!domain) return null
  if (['workspace-import', 'import', 'import_draft'].includes(domain)) return null
  const coordinator = (detail.config?.coordinators ?? []).find(candidate => candidate.domain === domain || candidate.id === domain)
  const label = coordinator?.name || coordinator?.domain || domain
  return {
    id: `task-domain:${domain}`,
    label: humanizeLabel(label),
    kind: coordinator ? 'coordinator_domain' : 'task_domain',
    source: 'task',
    confidence: 'inferred',
  }
}

function workAreaFromSourceRef(task: Task): WorkArea | null {
  const sourcePath = firstSourcePath(task)
  if (!sourcePath) return null
  return sourcePathWorkArea(sourcePath, 'source_ref')
}

function workAreaFromDescription(task: Task): WorkArea | null {
  const sourcePath = firstPathFromText(task.description ?? '')
  if (!sourcePath) return null
  return sourcePathWorkArea(sourcePath, 'description_fallback')
}

function sourcePathWorkArea(sourcePath: string, source: Extract<WorkAreaSource, 'source_ref' | 'description_fallback'>): WorkArea {
  const normalized = normalizeRelativePath(sourcePath)
  const root = normalized.split('/')[0] || normalized
  return {
    id: `source-root:${root}`,
    label: humanizeLabel(root),
    kind: 'source_path_fallback',
    source,
    confidence: 'fallback',
    path: normalized,
  }
}

function taskPathHints(task: Task): string[] {
  return [
    firstPathFromText(task.description ?? ''),
    firstSourcePath(task),
    task.projectPath ?? '',
  ]
    .map(normalizeRelativePath)
    .filter(Boolean)
}

function firstSourcePath(task: Task): string {
  for (const note of task.notes ?? []) {
    const text = note.content ?? ''
    const whyMatch = text.match(/Why this may matter:\s*([^:\n]+(?:\/[^:\n]+)+):/i)
    if (whyMatch?.[1]) return whyMatch[1]
    const importedMatch = text.match(/Imported from:\s*(.+)$/im)
    if (importedMatch?.[1]) {
      const path = firstPathFromText(importedMatch[1])
      if (path) return path
    }
    const generic = firstPathFromText(text)
    if (generic) return generic
  }
  return ''
}

function firstPathFromText(text: string): string {
  const match = text.match(/(?:^|\s)((?:~?\/)?[A-Za-z0-9._@()[\]-]+(?:\/[A-Za-z0-9._@()[\]-]+)+):?/)
  return match?.[1] ?? ''
}

function normalizeRelativePath(value: string): string {
  const trimmed = value.trim().replace(/^file:\/\//, '')
  if (!trimmed) return ''
  const absoluteLike = trimmed.startsWith('/') || trimmed.startsWith('~/')
  const withoutHome = trimmed.replace(/^~\//, '')
  const parts = withoutHome.split('/').filter(Boolean)
  const markerIndex = absoluteLike ? findWorkspaceMarkerIndex(parts) : -1
  return absoluteLike && markerIndex > 0 ? parts.slice(markerIndex).join('/') : parts.join('/')
}

function findWorkspaceMarkerIndex(parts: string[]): number {
  const gitMarker = parts.lastIndexOf('git')
  if (gitMarker >= 0 && parts[gitMarker + 3]) return gitMarker + 3
  const repoMarker = parts.findIndex(part => ['repo', 'repos', 'workspace', 'workspaces'].includes(part))
  if (repoMarker >= 0 && parts[repoMarker + 1]) return repoMarker + 1
  const sourceMarker = parts.findIndex((part, index) =>
    index > 0 &&
    ['src', 'app', 'apps', 'packages', 'services', 'service', 'lib', 'libs', 'crates', 'cmd', 'internal', 'docs', 'test', 'tests', 'web'].includes(part),
  )
  if (sourceMarker > 0) return sourceMarker
  return -1
}

function pathMatchesArea(candidatePath: string, areaPath: string): boolean {
  return candidatePath === areaPath ||
    candidatePath.startsWith(`${areaPath}/`) ||
    areaPath.startsWith(`${candidatePath}/`)
}

function labelFromAreaId(id: string): string {
  return humanizeLabel(id.replace(/^[^:]+:/, ''))
}

function humanizeLabel(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'Project'
  return trimmed
    .split(/[._/-]+/)
    .filter(Boolean)
    .map(part => part.length <= 3 && part === part.toUpperCase() ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function slugifyLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'area'
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
  const tasks = visibleProjectTasks(detail).filter(task => task.status !== 'import_draft')
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
