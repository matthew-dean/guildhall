export type WorkVisibilityKind = 'primary' | 'supporting' | 'internal_step' | 'hidden'

export interface WorkVisibility {
  kind: WorkVisibilityKind
  label?: string
  countInProjectTotals: boolean
}

export type DeliveryStepKind =
  | 'make_change'
  | 'verify'
  | 'document'
  | 'review'
  | 'decide'
  | 'coordinate'
  | 'release'
  | 'handoff'
  | 'external_action'

export type DeliveryStepStatus = 'todo' | 'active' | 'blocked' | 'done' | 'waived'

export interface DeliveryStep {
  id: string
  title: string
  kind: DeliveryStepKind
  status: DeliveryStepStatus
  required: boolean
  blocksCompletion: boolean
  sourceTaskId?: string
  evidenceChannel?: string
  toolLabel?: string
}

export type WorkProgressState = 'done' | 'blocked' | 'active' | 'shelved' | 'pending'

export interface WorkProgressRollup {
  primaryState: WorkProgressState
  visibleChildCount: number
  visibleChildDoneCount: number
  internalStepCount: number
  requiredStepCount: number
  doneStepCount: number
  blockedStepCount: number
}

export interface TaskWorkProgress {
  id: string
  title?: string
  status?: string
  visibility: WorkVisibility
  deliverySteps: DeliveryStep[]
  rollup: WorkProgressRollup
}

export interface ProjectWorkProgress {
  counts: {
    visibleTotal: number
    visibleActive: number
    visibleBlocked: number
    visibleDone: number
    visibleShelved: number
    deliveryTotal: number
    deliveryRequired: number
    deliveryDone: number
    deliveryBlocked: number
  }
  byTaskId: Record<string, TaskWorkProgress>
}

type TaskRecord = Record<string, unknown>

const INTERNAL_STEP_WORK_KINDS = new Set(['test', 'verification'])
const TASK_DONE_STATUSES = new Set(['done'])
const TASK_BLOCKED_STATUSES = new Set(['blocked'])
const TASK_SHELVED_STATUSES = new Set(['shelved'])
const TASK_ACTIVE_STATUSES = new Set([
  'ready',
  'in_progress',
  'review',
  'gate_check',
  'exploring',
  'spec_review',
  'proposed',
])

export function deriveProjectWorkProgress(tasks: TaskRecord[]): ProjectWorkProgress {
  const byId = new Map<string, TaskRecord>()
  for (const task of tasks) {
    const id = stringValue(task.id)
    if (id) byId.set(id, task)
  }

  const taskProgressEntries = tasks
    .map(task => deriveTaskWorkProgress(task, byId))
    .filter((progress): progress is TaskWorkProgress => progress !== null)

  const byTaskId: Record<string, TaskWorkProgress> = {}
  for (const progress of taskProgressEntries) {
    byTaskId[progress.id] = progress
  }

  const counts: ProjectWorkProgress['counts'] = {
    visibleTotal: 0,
    visibleActive: 0,
    visibleBlocked: 0,
    visibleDone: 0,
    visibleShelved: 0,
    deliveryTotal: 0,
    deliveryRequired: 0,
    deliveryDone: 0,
    deliveryBlocked: 0,
  }

  for (const progress of taskProgressEntries) {
    if (progress.visibility.countInProjectTotals) {
      counts.visibleTotal += 1
      const status = progress.status ?? ''
      if (TASK_DONE_STATUSES.has(status)) counts.visibleDone += 1
      else if (TASK_BLOCKED_STATUSES.has(status)) counts.visibleBlocked += 1
      else if (TASK_SHELVED_STATUSES.has(status)) counts.visibleShelved += 1
      else if (TASK_ACTIVE_STATUSES.has(status) || status) counts.visibleActive += 1
    }

    for (const step of progress.deliverySteps) {
      counts.deliveryTotal += 1
      if (step.required) counts.deliveryRequired += 1
      if (step.status === 'done') counts.deliveryDone += 1
      if (step.status === 'blocked') counts.deliveryBlocked += 1
    }
  }

  return { counts, byTaskId }
}

function deriveTaskWorkProgress(task: TaskRecord, byId: Map<string, TaskRecord>): TaskWorkProgress | null {
  const id = stringValue(task.id)
  if (!id) return null
  const childTasks = directChildTasks(task, byId)
  const visibility = deriveWorkVisibility(task)
  const internalChildTasks = childTasks.filter(child => deriveWorkVisibility(child).kind === 'internal_step')
  const visibleChildProgress = childTasks
    .map(child => deriveTaskWorkProgress(child, byId))
    .filter((progress): progress is TaskWorkProgress => Boolean(progress && progress.visibility.countInProjectTotals))
  const deliverySteps = [
    ...explicitDeliverySteps(task),
    ...proofPathDeliverySteps(task),
    ...internalChildTasks.map(internalStepFromTask).filter((step): step is DeliveryStep => step !== null),
  ]
  const rollup = deriveRollup(task, visibleChildProgress, deliverySteps, internalChildTasks.length)

  return {
    id,
    title: stringValue(task.title),
    status: stringValue(task.status),
    visibility,
    deliverySteps,
    rollup,
  }
}

function deriveWorkVisibility(task: TaskRecord): WorkVisibility {
  const explicit = objectValue(task.workVisibility)
  const explicitKind = stringValue(explicit?.kind)
  if (explicitKind === 'primary' || explicitKind === 'supporting' || explicitKind === 'internal_step' || explicitKind === 'hidden') {
    const explicitCount = explicit?.countInProjectTotals
    return {
      kind: explicitKind,
      label: stringValue(explicit?.label),
      countInProjectTotals: typeof explicitCount === 'boolean'
        ? explicitCount
        : explicitKind === 'primary' || explicitKind === 'supporting',
    }
  }

  const parentId = stringValue(objectValue(task.hierarchy)?.parentId)
  const workKind = stringValue(task.workKind)
  if (parentId && workKind && INTERNAL_STEP_WORK_KINDS.has(workKind)) {
    return { kind: 'internal_step', countInProjectTotals: false }
  }

  return { kind: 'primary', countInProjectTotals: true }
}

function directChildTasks(task: TaskRecord, byId: Map<string, TaskRecord>): TaskRecord[] {
  const hierarchy = objectValue(task.hierarchy)
  const childIds = arrayValue(hierarchy?.childIds).map(stringValue).filter((id): id is string => Boolean(id))
  if (childIds.length > 0) {
    return childIds.map(id => byId.get(id)).filter((child): child is TaskRecord => Boolean(child))
  }
  const id = stringValue(task.id)
  if (!id) return []
  return Array.from(byId.values()).filter(child => stringValue(objectValue(child.hierarchy)?.parentId) === id)
}

function explicitDeliverySteps(task: TaskRecord): DeliveryStep[] {
  return arrayValue(task.deliverySteps)
    .map((raw, index) => normalizeDeliveryStep(raw, `delivery:${index}`))
    .filter((step): step is DeliveryStep => step !== null)
}

function normalizeDeliveryStep(raw: unknown, fallbackId: string): DeliveryStep | null {
  const record = objectValue(raw)
  if (!record) return null
  const title = stringValue(record.title) ?? stringValue(record.label)
  if (!title) return null
  const step: DeliveryStep = {
    id: stringValue(record.id) ?? fallbackId,
    title,
    kind: semanticStepKind(stringValue(record.kind)),
    status: semanticStepStatus(stringValue(record.status)),
    required: booleanValue(record.required, true),
    blocksCompletion: booleanValue(record.blocksCompletion, true),
  }
  const sourceTaskId = stringValue(record.sourceTaskId)
  const evidenceChannel = stringValue(record.evidenceChannel)
  const toolLabel = stringValue(record.toolLabel)
  if (sourceTaskId) step.sourceTaskId = sourceTaskId
  if (evidenceChannel) step.evidenceChannel = evidenceChannel
  if (toolLabel) step.toolLabel = toolLabel
  return step
}

function proofPathDeliverySteps(task: TaskRecord): DeliveryStep[] {
  return arrayValue(task.proofPaths)
    .map((raw, index): DeliveryStep | null => {
      const proof = objectValue(raw)
      if (!proof) return null
      const id = stringValue(proof.id) ?? `${index + 1}`
      const proofKind = stringValue(proof.kind)
      const title = stringValue(proof.title) ?? stringValue(proof.label) ?? `Proof ${index + 1}`
      const step: DeliveryStep = {
        id: `proof:${id}`,
        title,
        kind: 'verify',
        status: semanticStepStatus(stringValue(proof.status)),
        required: true,
        blocksCompletion: true,
      }
      const sourceTaskId = stringValue(task.id)
      const evidenceChannel = evidenceChannelForProofKind(proofKind)
      if (sourceTaskId) step.sourceTaskId = sourceTaskId
      if (evidenceChannel) step.evidenceChannel = evidenceChannel
      if (proofKind) step.toolLabel = proofKind
      return step
    })
    .filter((step): step is DeliveryStep => step !== null)
}

function internalStepFromTask(task: TaskRecord): DeliveryStep | null {
  const id = stringValue(task.id)
  const title = stringValue(task.title)
  if (!id || !title) return null
  return {
    id: `task:${id}`,
    title,
    kind: stepKindForWorkKind(stringValue(task.workKind)),
    status: semanticStepStatus(stringValue(task.status)),
    required: true,
    blocksCompletion: true,
    sourceTaskId: id,
  }
}

function deriveRollup(
  task: TaskRecord,
  visibleChildren: TaskWorkProgress[],
  deliverySteps: DeliveryStep[],
  internalStepCount: number,
): WorkProgressRollup {
  const requiredSteps = deliverySteps.filter(step => step.required && step.blocksCompletion)
  const doneStepCount = requiredSteps.filter(step => step.status === 'done' || step.status === 'waived').length
  const blockedStepCount = requiredSteps.filter(step => step.status === 'blocked').length
  const visibleChildDoneCount = visibleChildren.filter(child => child.rollup.primaryState === 'done').length
  const status = stringValue(task.status) ?? ''
  const primaryState: WorkProgressState = blockedStepCount > 0 || TASK_BLOCKED_STATUSES.has(status)
    ? 'blocked'
    : TASK_DONE_STATUSES.has(status) && doneStepCount === requiredSteps.length && visibleChildDoneCount === visibleChildren.length
      ? 'done'
      : TASK_SHELVED_STATUSES.has(status)
        ? 'shelved'
        : TASK_ACTIVE_STATUSES.has(status) || deliverySteps.some(step => step.status === 'active')
          ? 'active'
          : 'pending'

  return {
    primaryState,
    visibleChildCount: visibleChildren.length,
    visibleChildDoneCount,
    internalStepCount,
    requiredStepCount: requiredSteps.length,
    doneStepCount,
    blockedStepCount,
  }
}

function semanticStepKind(kind: string | undefined): DeliveryStepKind {
  switch (kind) {
    case 'make_change':
    case 'implementation':
      return 'make_change'
    case 'verify':
    case 'test':
    case 'gate':
    case 'contract':
    case 'browser_proof':
      return 'verify'
    case 'document':
    case 'docs':
      return 'document'
    case 'review':
      return 'review'
    case 'decide':
    case 'decision':
      return 'decide'
    case 'coordinate':
    case 'manual_setup':
      return 'coordinate'
    case 'release':
    case 'migration':
      return 'release'
    case 'handoff':
      return 'handoff'
    case 'external_action':
      return 'external_action'
    default:
      return 'make_change'
  }
}

function stepKindForWorkKind(workKind: string | undefined): DeliveryStepKind {
  if (workKind === 'verification' || workKind === 'test') return 'verify'
  return semanticStepKind(workKind)
}

function semanticStepStatus(status: string | undefined): DeliveryStepStatus {
  switch (status) {
    case 'done':
    case 'passed':
    case 'complete':
      return 'done'
    case 'blocked':
    case 'failed':
      return 'blocked'
    case 'in_progress':
    case 'running':
    case 'active':
    case 'review':
    case 'gate_check':
      return 'active'
    case 'waived':
    case 'skipped':
      return 'waived'
    default:
      return 'todo'
  }
}

function evidenceChannelForProofKind(kind: string | undefined): string | undefined {
  if (!kind) return undefined
  if (kind === 'browser' || kind === 'runtime' || kind === 'manual') return 'runtime_observation'
  if (kind === 'test' || kind === 'automated') return 'automated_check'
  if (kind === 'artifact' || kind === 'doc') return 'artifact'
  return kind
}

function objectValue(value: unknown): TaskRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as TaskRecord : null
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
