import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  applyTaskTransition,
  type TaskTransitionEvent,
} from '@guildhall/runtime/task-transition'
import {
  AcceptanceCriteria,
  GateResult,
  type ExecutionPlanAction,
  type TaskEvidenceEvent,
  Task,
  type Task as TaskModel,
  TaskQueue,
  TaskStatus,
  WorkUnitAnalysis,
  StructuredSpec,
  TaskDelivery,
  type TaskQueue as TaskQueueModel,
  buildTaskSizePlan,
  buildDecompositionChildDrafts,
  parseAcceptanceCriteriaFromSpec,
  renderStructuredSpecMarkdown,
} from '@guildhall/core'
import { appendTaskEvidence, atomicWriteText, inferProjectRootFromMemoryDir, upsertTaskRuntimeState } from '@guildhall/sessions'
import { writeProjectTaskQueue } from '@guildhall/runtime/project-state-boundary'

const TASKS_PATH_SCHEMA = z.string().describe('Absolute path to the TASKS.json file')

const readTasksInputSchema = z.object({ tasksPath: TASKS_PATH_SCHEMA })
export type ReadTasksInput = z.input<typeof readTasksInputSchema>
export interface ReadTasksResult {
  queue: TaskQueueModel | null
  error?: string
}

export async function readTasks(input: ReadTasksInput): Promise<ReadTasksResult> {
  try {
    const raw = await readManagedTextFile(input.tasksPath, 'utf-8')
    return { queue: TaskQueue.parse(JSON.parse(raw)) }
  } catch (err) {
    return { queue: null, error: String(err) }
  }
}

export const readTasksTool = defineTool({
  name: 'read-tasks',
  description:
    'Read the full task queue. Always call this at the start of any coordination or work session to get current state.',
  inputSchema: readTasksInputSchema,
  jsonSchema: {
    type: 'object',
    properties: { tasksPath: { type: 'string' } },
    required: ['tasksPath'],
  },
  isReadOnly: () => true,
  execute: async (input) => {
    const result = await readTasks(input)
    if (!result.queue) {
      return {
        output: `Error reading tasks: ${result.error ?? 'unknown'}`,
        is_error: true,
        metadata: result as unknown as Record<string, unknown>,
      }
    }
    return {
      output: JSON.stringify(result.queue, null, 2),
      is_error: false,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

const updateTaskNoteSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}, z.object({
  agentId: z.string(),
  role: z.string(),
  content: z.string(),
}))

const updateTaskInputSchema = z.object({
  tasksPath: TASKS_PATH_SCHEMA,
  taskId: z.string().optional(),
  title: z.string().optional(),
  domain: z.string().optional(),
  status: TaskStatus.optional(),
  assignedTo: z.string().nullable().optional(),
  note: updateTaskNoteSchema.optional(),
  blockReason: z.string().optional(),
  humanJudgment: z.string().optional(),
  spec: z.string().optional(),
  structuredSpec: StructuredSpec.optional(),
  acceptanceCriteria: z.array(AcceptanceCriteria).optional(),
  workUnitAnalysis: WorkUnitAnalysis.optional(),
  delivery: TaskDelivery.optional(),
  gateResults: z.array(GateResult).optional(),
  completedAt: z.string().optional(),
})

export type UpdateTaskInput = z.input<typeof updateTaskInputSchema>
export interface UpdateTaskResult {
  success: boolean
  taskId?: string
  error?: string
}

type TaskRecord = TaskModel
type TaskQueueRecord = TaskQueueModel

function inferMetadataTaskId(metadata: Record<string, unknown> = {}): string | null {
  const taskId = metadata['current_task_id']
  return typeof taskId === 'string' && taskId.trim().length > 0 ? taskId.trim() : null
}

export async function updateTask(
  rawInput: UpdateTaskInput,
  metadata: Record<string, unknown> = {},
): Promise<UpdateTaskResult> {
  try {
    const input = updateTaskInputSchema.parse(rawInput)
    const raw = await readManagedTextFile(input.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))
    const taskId = input.taskId ?? inferMetadataTaskId(metadata) ?? inferSingleActiveTaskId(queue)
    if (!taskId) {
      return {
        success: false,
        error: 'Missing taskId (or metadata.current_task_id) and could not infer a single active task',
      }
    }
    const task = queue.tasks.find((t) => t.id === taskId)
    if (!task) return { success: false, taskId, error: `Task ${taskId} not found` }

    if (!hasTaskMutation(input)) {
      return {
        success: false,
        taskId,
        error:
          'No task mutation provided. Set at least one of title, domain, status, assignedTo, note, blockReason, humanJudgment, spec, structuredSpec, acceptanceCriteria, workUnitAnalysis, delivery, gateResults, or completedAt.',
      }
    }
    if (input.spec !== undefined && input.structuredSpec !== undefined) {
      return {
        success: false,
        taskId,
        error: 'Provide either spec markdown or structuredSpec JSON, not both.',
      }
    }

    const currentAgentId = typeof metadata['current_agent_id'] === 'string'
      ? metadata['current_agent_id'].trim()
      : ''
    if (
      currentAgentId === 'worker-agent' &&
      input.gateResults?.some((result) => result.type === 'hard')
    ) {
      return {
        success: false,
        taskId,
        error:
          'Workers cannot author hard gate results. Run command-backed proof through run-gates or let acceptance-command-gates record observed command exits.',
      }
    }

    const nextStatus = input.status ? TaskStatus.parse(input.status) : undefined
    const wouldPromoteSpecReview =
      nextStatus === 'spec_review' ||
      (
        nextStatus === undefined &&
        (
          (input.spec !== undefined && input.spec.trim() !== '') ||
          input.structuredSpec !== undefined
        ) &&
        task.status === 'exploring'
      )
    if (wouldPromoteSpecReview && input.spec && hasUnansweredMarkdownOpenQuestions(input.spec)) {
      return {
        success: false,
        taskId,
        error:
          'Spec contains unanswered human questions in markdown. Use post-user-question to persist structured questions before moving the task to spec_review.',
      }
    }

    const normalizedSpec = input.spec !== undefined
      ? normalizeSpecForTaskProjectPath(input.spec, task.projectPath)
      : undefined
    const normalizedStructuredSpec = input.structuredSpec !== undefined
      ? StructuredSpec.parse(input.structuredSpec)
      : undefined
    const renderedStructuredSpec = normalizedStructuredSpec
      ? normalizeSpecForTaskProjectPath(renderStructuredSpecMarkdown(normalizedStructuredSpec), task.projectPath)
      : undefined
    const normalizedAcceptanceCriteria = input.acceptanceCriteria !== undefined
      ? z.array(AcceptanceCriteria).parse(input.acceptanceCriteria)
        .map((criterion) => normalizeAcceptanceCriterionForTaskProjectPath(criterion, task.projectPath))
      : undefined
    if (
      currentAgentId === 'worker-agent' &&
      normalizedAcceptanceCriteria?.some((criterion) =>
        criterion.met === true &&
        typeof criterion.command === 'string' &&
        criterion.command.trim().length > 0,
      )
    ) {
      return {
        success: false,
        taskId,
        error:
          'Workers cannot mark command-backed acceptance criteria as met. Run the command through hard gates and record the observed result.',
      }
    }

    const explicitStatus = nextStatus
    const statusTransition = explicitStatus && explicitStatus !== task.status
      ? applyTaskTransition({
        task,
        event: eventForExplicitStatus(task.status, explicitStatus),
        actor: currentAgentId || 'update-task',
        evidenceRefs: [`update-task:status:${task.status}->${explicitStatus}`],
        now: new Date().toISOString(),
        requiredEvidencePresent: explicitStatus === 'done' ? updateIncludesCompletionEvidence(input, task) : undefined,
      })
      : null
    if (statusTransition?.kind === 'rejected') {
      return {
        success: false,
        taskId,
        error:
          `Task ${taskId} cannot ${eventForExplicitStatus(task.status, explicitStatus!).replaceAll('_', ' ')} ` +
          `from ${task.status}: ${statusTransition.reason}`,
      }
    }

    if (input.title !== undefined) task.title = input.title
    if (input.domain !== undefined && input.domain.trim() !== '') task.domain = input.domain.trim()
    if (statusTransition?.kind === 'applied') task.status = statusTransition.nextState
    if (input.assignedTo !== undefined) {
      if ((input.assignedTo ?? '').trim() === '') delete task.assignedTo
      else task.assignedTo = input.assignedTo
    }
    if (input.blockReason !== undefined && input.blockReason.trim() !== '') task.blockReason = input.blockReason
    if (input.humanJudgment !== undefined && input.humanJudgment.trim() !== '') task.humanJudgment = input.humanJudgment
    const nextSpec = renderedStructuredSpec ?? normalizedSpec
    if (normalizedStructuredSpec !== undefined) {
      task.structuredSpec = normalizedStructuredSpec
    } else if (normalizedSpec !== undefined) {
      delete task.structuredSpec
    }
    if (nextSpec !== undefined && nextSpec.trim() !== '') {
      task.spec = nextSpec
      if (input.title === undefined) {
        const derivedTitle = deriveImportedTaskTitle(task)
        if (derivedTitle) task.title = derivedTitle
      }
      if (normalizedStructuredSpec && normalizedAcceptanceCriteria === undefined) {
        task.acceptanceCriteria = parseAcceptanceCriteriaFromSpec(nextSpec)
      } else if (task.acceptanceCriteria.length === 0) {
        const derivedCriteria = parseAcceptanceCriteriaFromSpec(nextSpec)
        if (derivedCriteria.length > 0) task.acceptanceCriteria = derivedCriteria
      }
    }
    if (
      input.status === undefined &&
      (
        (input.spec !== undefined && input.spec.trim() !== '') ||
        input.structuredSpec !== undefined
      ) &&
      task.status === 'exploring'
    ) {
      task.status = 'spec_review'
    }
    normalizeAssignmentForStatus(task, {
      explicitAssignedTo: input.assignedTo !== undefined,
      explicitStatus,
    })
    if (normalizedAcceptanceCriteria !== undefined && normalizedAcceptanceCriteria.length > 0) {
      task.acceptanceCriteria = z.array(AcceptanceCriteria).parse(normalizedAcceptanceCriteria)
    }
    if (input.workUnitAnalysis !== undefined) {
      task.workUnitAnalysis = WorkUnitAnalysis.parse(input.workUnitAnalysis)
    }
    if (input.delivery !== undefined) {
      task.delivery = TaskDelivery.parse(input.delivery)
    }
    const gateEvidence = input.gateResults !== undefined && input.gateResults.length > 0
      ? z.array(GateResult).parse(input.gateResults)
      : []
    if (input.completedAt !== undefined && input.completedAt.trim() !== '') task.completedAt = input.completedAt
    const noteEvidence = input.note
      ? { ...input.note, timestamp: new Date().toISOString() }
      : null
    const shouldRefreshSizePlan =
      (nextSpec !== undefined && nextSpec.trim() !== '') ||
      input.workUnitAnalysis !== undefined
    if (shouldRefreshSizePlan) {
      const sizePlanCreatedAt = new Date().toISOString()
      task.sizePlan = buildTaskSizePlan({
        task,
        riskLanes: inferSizingRiskLanes(task),
        createdAt: sizePlanCreatedAt,
      })
      const representedSplit = isMaterializableSplitAction(task.sizePlan.action)
        ? settleMaterializedSplitReadiness(queue, task, sizePlanCreatedAt)
        : null
      if (!representedSplit && isMaterializableSplitAction(task.sizePlan.action) && task.status === 'ready') {
        materializeSplitChildren(queue, task, sizePlanCreatedAt)
      }
    }
    task.updatedAt = new Date().toISOString()
    queue.lastUpdated = new Date().toISOString()

    await persistUpdateTaskRuntimeState(input.tasksPath, task, metadata)
    writeProjectTaskQueue(input.tasksPath, queue)
    await appendUpdateTaskEvidence({
      tasksPath: input.tasksPath,
      task,
      taskId,
      metadata,
      note: noteEvidence,
      gateResults: gateEvidence,
    })
    return { success: true, taskId }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

function projectRootForTaskState(
  tasksPath: string,
  task: z.infer<typeof Task>,
  metadata: Record<string, unknown> = {},
): string {
  const metadataProjectPath = typeof metadata['current_task_project_path'] === 'string'
    ? metadata['current_task_project_path'].trim()
    : ''
  if (metadataProjectPath && path.isAbsolute(metadataProjectPath)) return metadataProjectPath
  const stateDir = path.dirname(tasksPath)
  if (path.basename(stateDir) === 'project-state' && path.isAbsolute(task.projectPath)) {
    return task.projectPath
  }
  return inferProjectRootFromMemoryDir(stateDir)
}

async function persistUpdateTaskRuntimeState(
  tasksPath: string,
  task: z.infer<typeof Task>,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await upsertTaskRuntimeState(projectRootForTaskState(tasksPath, task, metadata), task.id, {
    assignedTo: Object.prototype.hasOwnProperty.call(task, 'assignedTo') ? task.assignedTo ?? null : null,
    ...(typeof task.revisionCount === 'number' ? { revisionCount: task.revisionCount } : {}),
    ...(task.retryWindow ? { retryWindow: task.retryWindow } : {}),
    ...(typeof task.remediationAttempts === 'number' ? { remediationAttempts: task.remediationAttempts } : {}),
    updatedAt: task.updatedAt,
  })
}

async function appendUpdateTaskEvidence(input: {
  tasksPath: string
  task: z.infer<typeof Task>
  taskId: string
  metadata?: Record<string, unknown>
  note: { agentId: string; role: string; content: string; timestamp: string } | null
  gateResults: Array<z.infer<typeof GateResult>>
}): Promise<void> {
  if (!input.note && input.gateResults.length === 0) return
  const projectRoot = projectRootForTaskState(input.tasksPath, input.task, input.metadata ?? {})
  const events: Array<Omit<TaskEvidenceEvent, 'taskId'>> = []
  if (input.note) {
    events.push({
      id: `${input.taskId}-note-${input.note.timestamp.replace(/[^0-9A-Za-z]/g, '')}`,
      kind: 'note',
      recordedAt: input.note.timestamp,
      payload: input.note,
    })
  }
  for (const result of input.gateResults) {
    events.push({
      id: `${input.taskId}-gate-${result.gateId}-${result.checkedAt.replace(/[^0-9A-Za-z]/g, '')}`,
      kind: 'gate_result',
      recordedAt: result.checkedAt,
      payload: result,
    })
  }
  for (const event of events) {
    await appendTaskEvidence(projectRoot, input.taskId, event)
  }
}

export function materializeSplitChildren(
  queue: TaskQueueRecord,
  parent: TaskRecord,
  timestamp: string,
): { status: 'noop' | 'materialized' | 'already_represented'; childTaskIds: string[] } {
  const sizePlan = parent.sizePlan
  if (!sizePlan || !isMaterializableSplitAction(sizePlan.action)) return { status: 'noop', childTaskIds: [] }
  const legacyRecommendations = sizePlan.recommendedChildren ?? []
  const recommendations = legacyRecommendations.length > 0
    ? legacyRecommendations
    : buildDecompositionChildDrafts({ task: parent })
  if (recommendations.length === 0) return { status: 'noop', childTaskIds: [] }
  const usesLegacyRecommendations = legacyRecommendations.length > 0
  const splitLabel = legacySplitLabel(sizePlan.action)
  const splitNote = legacySplitNote(sizePlan.action)

  const representedSplit = legacyRecommendations.length > 0
    ? settleAlreadyRepresentedSplitRecommendations(queue, parent, timestamp)
    : null
  if (representedSplit) {
    return { status: 'already_represented', childTaskIds: representedSplit.childTaskIds }
  }

  const existingChildIds = new Set(parent.hierarchy?.childIds ?? [])
  const planned = recommendations.map((recommendation, index) => {
    const existingById = recommendation.createdTaskId
      ? queue.tasks.find((task) => task.id === recommendation.createdTaskId)
      : undefined
    const existingByTitle = queue.tasks.find((task) =>
      task.id !== parent.id &&
      task.hierarchy?.parentId === parent.id &&
      normalizeTaskTitle(task.title) === normalizeTaskTitle(recommendation.title),
    )
    const task = existingById ?? existingByTitle ?? createSplitChildTask({
      parent,
      title: recommendation.title,
      reason: recommendation.reason,
      suggestedDomain: recommendation.suggestedDomain,
      index,
      queue,
      timestamp,
    })
    if (!queue.tasks.some((candidate) => candidate.id === task.id)) queue.tasks.push(task)
    if (usesLegacyRecommendations) recommendation.createdTaskId = task.id
    task.hierarchy = {
      ...(task.hierarchy ?? {}),
      parentId: parent.id,
      order: index,
      childIds: task.hierarchy?.childIds ?? [],
      relation: 'decomposes',
    }
    attachInternalDeliveryStep(parent, task)
    existingChildIds.add(task.id)
    return { recommendation, task }
  })

  const titleToId = new Map(planned.map(({ recommendation, task }) => [
    normalizeTaskTitle(recommendation.title),
    task.id,
  ]))
  const workUnitIdToId = new Map<string, string>()
  const workUnits = parent.workUnitAnalysis?.units ?? []
  planned.forEach(({ recommendation, task }, index) => {
    const matchingUnit =
      workUnits[index]?.title === recommendation.title
        ? workUnits[index]
        : workUnits.find((unit) => normalizeTaskTitle(unit.title) === normalizeTaskTitle(recommendation.title))
    if (matchingUnit?.id) workUnitIdToId.set(matchingUnit.id, task.id)
  })
  for (const { recommendation, task } of planned) {
    task.dependsOn = (recommendation.dependsOn ?? [])
      .map((dependency) => workUnitIdToId.get(dependency) ?? titleToId.get(normalizeTaskTitle(dependency)) ?? dependency)
      .filter((dependency, index, all) => dependency !== task.id && all.indexOf(dependency) === index)
    task.updatedAt = timestamp
  }
  parent.hierarchy = {
    ...(parent.hierarchy ?? {}),
    order: parent.hierarchy?.order ?? 0,
    childIds: [...existingChildIds],
    relation: parent.hierarchy?.relation ?? 'contains',
  }
  recordAppliedSplitExecutionAction({
    queue,
    parent,
    childTaskIds: planned.map(({ task }) => task.id),
    timestamp,
    actor: 'task-sizing',
    rationale: 'Legacy split sizing was materialized into linked child work.',
  })
  settleMaterializedSplitParent({
    parent,
    timestamp,
    recommendation: 'ready',
    summary: `${splitLabel} work has been turned into linked child tasks; continue through the child tasks instead of splitting this parent again.`,
    reason: 'Split has already been materialized into linked child tasks; do not split this parent again unless the child structure changes.',
    childTaskIds: planned.map(({ task }) => task.id),
  })
  if (!['blocked', 'review', 'gate_check', 'done', 'shelved'].includes(parent.status)) {
    if (parent.status !== 'ready') {
      const transitionResult = applyTaskTransition({
        task: parent,
        event: 'mark_ready',
        actor: 'task-sizing',
        evidenceRefs: ['task:split-children-materialized'],
        now: timestamp,
      })
      if (transitionResult.kind === 'applied') parent.status = transitionResult.nextState
    }
  }
  delete parent.assignedTo

  const notePrefix = `${splitNote}: created linked child tasks`
  if (!parent.notes.some((note) => note.agentId === 'task-sizing' && note.content.startsWith(notePrefix))) {
    parent.notes.push({
      agentId: 'task-sizing',
      role: 'coordinator',
      content: `${notePrefix}: ${planned.map(({ task }) => task.id).join(', ')}.`,
      timestamp,
    })
  }
  return { status: 'materialized', childTaskIds: planned.map(({ task }) => task.id) }
}

export const materializeRequiredSplitChildren = materializeSplitChildren

export function isMaterializableSplitAction(action: string | undefined): boolean {
  return action === 'split_required' || action === 'split_recommended' || action === 'decompose_before_execution'
}

function isLegacySplitAction(action: string | undefined): boolean {
  return action === 'split_required' || action === 'split_recommended'
}

function legacySplitLabel(action: string | undefined): string {
  if (action === 'split_required') return 'Decomposition-required'
  if (action === 'split_recommended') return 'Decomposition-planned'
  return 'Decomposition-required'
}

function legacySplitNote(action: string | undefined): string {
  if (action === 'split_required') return 'Decomposition required'
  if (action === 'split_recommended') return 'Decomposition planned'
  return 'Decomposition required'
}

export function settleAlreadyRepresentedSplitRecommendations(
  queue: TaskQueueRecord,
  parent: TaskRecord,
  timestamp: string,
): { childTaskIds: string[] } | null {
  const recommendations = parent.sizePlan?.recommendedChildren ?? []
  const existingSiblingIds = splitRecommendationsAlreadyRepresentedBySiblings(queue, parent, recommendations)
  if (!existingSiblingIds) return null
  removeDuplicateNestedSplitChildIds(queue, parent, recommendations)
  settleMaterializedSplitParent({
    parent,
    timestamp,
    recommendation: 'ready',
    summary: 'This task is ready; sibling tasks already cover the split work.',
    reason: 'Split recommendations already match existing sibling tasks under the same parent; do not split this task again unless the child structure changes.',
    childTaskIds: existingSiblingIds,
  })
  return { childTaskIds: existingSiblingIds }
}

export function settleMaterializedSplitReadiness(
  queue: TaskQueueRecord,
  parent: TaskRecord,
  timestamp: string,
): { childTaskIds: string[] } | null {
  const recommendations = parent.sizePlan?.recommendedChildren ?? []
  const representedIds = recommendations.map(recommendation => {
    if (recommendation.createdTaskId && queue.tasks.some(task => task.id === recommendation.createdTaskId)) {
      return recommendation.createdTaskId
    }
    return queue.tasks.find(task =>
      task.hierarchy?.parentId === parent.id &&
      normalizeTaskTitle(task.title) === normalizeTaskTitle(recommendation.title),
    )?.id
  })
  const linkedChildIds = linkedChildTaskIds(queue, parent)
  const hasExactRecommendationCoverage = recommendations.length > 0 && representedIds.every(Boolean)
  const representedChildIds = hasExactRecommendationCoverage
    ? representedIds.filter((id): id is string => Boolean(id))
    : linkedChildIds
  if (representedChildIds.length === 0) return null
  if (hasExactRecommendationCoverage) {
    recommendations.forEach((recommendation, index) => {
      recommendation.createdTaskId = representedChildIds[index]
    })
  } else if (parent.sizePlan && isLegacySplitAction(parent.sizePlan.action)) {
    parent.sizePlan.recommendedChildren = representedChildIds.map((childTaskId) => {
      const child = queue.tasks.find(task => task.id === childTaskId)
      return {
        title: child?.title ?? childTaskId,
        reason: 'Existing linked child task represents the parent split boundary.',
        dependsOn: child?.dependsOn ?? [],
        suggestedDomain: child?.domain,
        createdTaskId: childTaskId,
      }
    })
  }
  const reason = hasExactRecommendationCoverage
    ? 'Split has already been materialized into linked child tasks; do not split this parent again unless the child structure changes.'
    : 'Linked child tasks already represent this parent split; reconcile child scope instead of splitting this parent again.'
  settleMaterializedSplitParent({
    parent,
    timestamp,
    recommendation: 'ready',
    summary: 'Split work is represented by linked child tasks; continue through the child tasks instead of splitting this parent again.',
    reason,
    childTaskIds: representedChildIds,
  })
  parent.hierarchy = {
    ...(parent.hierarchy ?? {}),
    order: parent.hierarchy?.order ?? 0,
    childIds: representedChildIds,
    relation: parent.hierarchy?.relation ?? 'contains',
  }
  recordAppliedSplitExecutionAction({
    queue,
    parent,
    childTaskIds: representedChildIds,
    timestamp,
    actor: 'task-sizing',
    rationale: 'Linked child tasks already represent the parent split boundary.',
  })
  return { childTaskIds: representedChildIds }
}

function linkedChildTaskIds(queue: TaskQueueRecord, parent: TaskRecord): string[] {
  const orderedIds = parent.hierarchy?.childIds ?? []
  const childIds = new Set<string>()
  for (const id of orderedIds) {
    if (queue.tasks.some(task => task.id === id && task.hierarchy?.parentId === parent.id)) childIds.add(id)
  }
  for (const task of queue.tasks) {
    if (task.hierarchy?.parentId === parent.id) childIds.add(task.id)
  }
  return [...childIds]
}

function splitRecommendationsAlreadyRepresentedBySiblings(
  queue: TaskQueueRecord,
  parent: TaskRecord,
  recommendations: Array<{ title: string }>,
): string[] | null {
  const containingParentId = parent.hierarchy?.parentId
  if (!containingParentId || recommendations.length === 0) return null
  const siblingsByTitle = new Map<string, string>()
  for (const task of queue.tasks) {
    if (task.id !== parent.id && task.hierarchy?.parentId !== containingParentId) continue
    siblingsByTitle.set(normalizeTaskTitle(task.title), task.id)
  }
  const representedIds = recommendations.map(recommendation =>
    siblingsByTitle.get(normalizeTaskTitle(recommendation.title)),
  )
  if (representedIds.some(id => !id)) return null
  return representedIds.filter((id): id is string => Boolean(id))
}

function removeDuplicateNestedSplitChildIds(
  queue: TaskQueueRecord,
  parent: TaskRecord,
  recommendations: Array<{ title: string }>,
): void {
  const hierarchy = parent.hierarchy
  const nestedChildIds = hierarchy?.childIds ?? []
  const recommendationTitles = new Set(recommendations.map(recommendation => normalizeTaskTitle(recommendation.title)))
  const nestedDuplicates = queue.tasks.filter(task =>
    task.hierarchy?.parentId === parent.id &&
    recommendationTitles.has(normalizeTaskTitle(task.title)),
  )
  const nestedDuplicateIds = new Set(nestedDuplicates.map(task => task.id))
  if (nestedDuplicateIds.size === 0) return
  for (const task of nestedDuplicates) {
    if (!task.hierarchy) continue
    task.hierarchy = {
      ...task.hierarchy,
      parentId: undefined,
      order: task.hierarchy.order ?? 0,
    }
  }
  parent.hierarchy = {
    ...(hierarchy ?? {}),
    order: hierarchy?.order ?? 0,
    childIds: nestedChildIds.filter(childId => !nestedDuplicateIds.has(childId)),
  }
}

function settleMaterializedSplitParent(input: {
  parent: TaskRecord
  timestamp: string
  recommendation?: 'ready' | 'split'
  summary: string
  reason: string
  childTaskIds?: string[]
}): void {
  const { parent, timestamp, recommendation = 'split', summary, reason, childTaskIds = [] } = input
  const splitBoundary = settledSplitBoundaryText(childTaskIds)
  if (parent.sizePlan && isMaterializableSplitAction(parent.sizePlan.action)) {
    parent.sizePlan = {
      ...parent.sizePlan,
      action: 'proceed_with_warning',
      reasons: [
        ...parent.sizePlan.reasons.filter(existing => existing !== reason),
        reason,
      ],
    }
  }
  parent.taskReadiness = {
    taskKind: parent.taskReadiness?.taskKind ?? parent.taskKind ?? 'implementation',
    recommendation,
    summary,
    dimensions: settledSplitReadinessDimensions(parent.taskReadiness?.dimensions ?? []),
    definitionOfDone: parent.taskReadiness?.definitionOfDone ?? {
      items: ['All required sibling tasks are done or explicitly deferred.'],
      evidenceRequired: ['Linked task outcomes are recorded before the containing work is closed.'],
      updatedAt: timestamp,
      createdBy: 'task-sizing',
    },
    blockerPlans: parent.taskReadiness?.blockerPlans ?? [],
    contextBudget: parent.taskReadiness?.contextBudget
      ? {
          ...parent.taskReadiness.contextBudget,
          risk: recommendation === 'ready' ? 'low' : parent.taskReadiness.contextBudget.risk,
          fitsInOneWorkerBrief: recommendation === 'ready' ? true : parent.taskReadiness.contextBudget.fitsInOneWorkerBrief,
          reasons: parent.taskReadiness.contextBudget.reasons.length > 0
            ? parent.taskReadiness.contextBudget.reasons
            : ['This work is already represented by linked tasks.'],
        }
      : {
          estimatedTokens: 0,
          risk: recommendation === 'ready' ? 'low' : 'medium',
          fitsInOneWorkerBrief: recommendation === 'ready',
          reasons: ['This work is already represented by linked tasks.'],
        },
    assessedAt: parent.taskReadiness?.assessedAt ?? timestamp,
    assessedBy: parent.taskReadiness?.assessedBy ?? 'task-sizing',
  }
  rewriteSettledSplitBoundary(parent, splitBoundary)
  parent.updatedAt = timestamp
}

function recordAppliedSplitExecutionAction(input: {
  queue: TaskQueueRecord
  parent: TaskRecord
  childTaskIds: string[]
  timestamp: string
  actor: string
  rationale: string
}): void {
  input.queue.executionPlanActions ??= []
  const normalizedChildIds = [...new Set(input.childTaskIds)]
  const existing = input.queue.executionPlanActions.find(action =>
    action.type === 'split_work' &&
    action.targetWorkId === input.parent.id &&
    action.status === 'applied' &&
    sameStringSet(action.createdChildIds, normalizedChildIds),
  )
  if (existing) return
  const action: ExecutionPlanAction = {
    id: uniqueExecutionPlanActionId(input.queue, input.parent.id, input.timestamp),
    type: 'split_work',
    targetWorkId: input.parent.id,
    status: 'applied',
    authority: 'execution_planning',
    rationale: input.rationale,
    createdChildIds: normalizedChildIds,
    createdAt: input.timestamp,
    createdBy: input.actor,
    appliedAt: input.timestamp,
    appliedBy: input.actor,
  }
  input.queue.executionPlanActions.push(action)
}

function uniqueExecutionPlanActionId(queue: TaskQueueRecord, parentId: string, timestamp: string): string {
  const suffix = timestamp.replace(/[^0-9A-Za-z]/g, '')
  const base = `${parentId}-split-${suffix}`
  const existingIds = new Set((queue.executionPlanActions ?? []).map(action => action.id))
  if (!existingIds.has(base)) return base
  let index = 2
  while (existingIds.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every(value => rightSet.has(value))
}

function settledSplitBoundaryText(childTaskIds: string[]): string {
  const suffix = childTaskIds.length > 0 ? `: ${childTaskIds.join(', ')}` : '.'
  return `Already split into linked child tasks${suffix}`
}

function rewriteSettledSplitBoundary(parent: TaskRecord, splitBoundary: string): void {
  if (parent.structuredSpec) {
    parent.structuredSpec = StructuredSpec.parse({
      ...parent.structuredSpec,
      completionBoundary: {
        ...parent.structuredSpec.completionBoundary,
        whatMustBeSplitOrBlocked: splitBoundary,
      },
    })
    parent.spec = renderStructuredSpecMarkdown(parent.structuredSpec)
    return
  }
  if (!parent.spec || parent.spec.trim().length === 0) return
  const boundaryLine = /(^\s*(?:[-*]\s*)?What must be split or blocked\s*:\s*).+$/im
  if (boundaryLine.test(parent.spec)) {
    parent.spec = parent.spec.replace(boundaryLine, `$1${splitBoundary}`)
  }
}

function settledSplitReadinessDimensions(
  dimensions: NonNullable<TaskRecord['taskReadiness']>['dimensions'],
): NonNullable<TaskRecord['taskReadiness']>['dimensions'] {
  const hasSizeDimension = dimensions.some(dimension => dimension.id === 'size')
  const settled = dimensions.map(dimension => {
    if (dimension.id !== 'size') return dimension
    return {
      ...dimension,
      status: 'ok' as const,
      summary: 'Size is handled by linked child tasks.',
      evidence: [
        ...dimension.evidence.filter(evidence => !/too (large|broad)|split/i.test(evidence)),
        'Split recommendations have already been materialized into linked child tasks.',
      ],
    }
  })
  if (hasSizeDimension) return settled
  return [
    ...settled,
    {
      id: 'size',
      status: 'ok' as const,
      summary: 'Size is handled by linked child tasks.',
      evidence: ['Split recommendations have already been materialized into linked child tasks.'],
    },
  ]
}

function attachInternalDeliveryStep(parent: TaskRecord, child: TaskRecord): void {
  if (child.workKind !== 'test' && child.workKind !== 'verification') return
  child.workVisibility = {
    ...(child.workVisibility ?? {}),
    kind: 'internal_step',
    countInProjectTotals: false,
  }
  const stepId = `task:${child.id}`
  const hasStep = parent.deliverySteps?.some(step => step.id === stepId || step.sourceTaskId === child.id)
  if (hasStep) return
  parent.deliverySteps = [
    ...(parent.deliverySteps ?? []),
    {
      id: stepId,
      title: child.title,
      kind: 'verify',
      status: deliveryStepStatusForTask(child.status),
      required: true,
      blocksCompletion: true,
      sourceTaskId: child.id,
    },
  ]
}

function deliveryStepStatusForTask(status: string | undefined): 'todo' | 'active' | 'blocked' | 'done' | 'waived' {
  switch (status) {
    case 'done':
    case 'pending_pr':
      return 'done'
    case 'blocked':
      return 'blocked'
    case 'in_progress':
    case 'review':
    case 'gate_check':
      return 'active'
    case 'shelved':
      return 'waived'
    default:
      return 'todo'
  }
}

function createSplitChildTask(input: {
  parent: TaskRecord
  title: string
  reason: string
  suggestedDomain?: string
  index: number
  queue: TaskQueueRecord
  timestamp: string
}): TaskRecord {
  const id = uniqueSplitChildTaskId(input.queue, input.parent.id, input.title, input.index)
  const workKind = splitChildWorkKind(input.title)
  const domain = splitChildDomain({
    suggestedDomain: input.suggestedDomain,
    parentDomain: input.parent.domain,
    queue: input.queue,
  })
  return Task.parse({
    id,
    title: input.title,
    description: [
      input.reason,
      '',
      `Split from containing work ${input.parent.id}: ${input.parent.title}.`,
    ].join('\n'),
    domain,
    projectPath: input.parent.projectPath,
    status: 'exploring',
    priority: input.parent.priority,
    dependsOn: [],
    outOfScope: [],
    acceptanceCriteria: [],
    notes: [
      {
        agentId: 'task-sizing',
        role: 'coordinator',
        content: `Created from execution-planning decomposition of ${input.parent.id}. ${input.reason}`,
        timestamp: input.timestamp,
      },
    ],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    revisionCount: 0,
    origination: 'system',
    proposedBy: 'task-sizing',
    proposalRationale: input.reason,
    workKind,
    delivery: {
      ...(input.parent.delivery ?? {}),
      supports: [
        input.parent.id,
        ...(input.parent.delivery?.supports ?? []),
      ].filter((supportId, index, all) => all.indexOf(supportId) === index),
    },
    businessEnvelope: input.parent.businessEnvelope,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  })
}

const RESERVED_SPLIT_SOURCE_DOMAINS = new Set(['_meta', '_workspace_import'])

function splitChildDomain(input: {
  suggestedDomain?: string
  parentDomain?: string
  queue: TaskQueueRecord
}): string {
  if (input.suggestedDomain && !RESERVED_SPLIT_SOURCE_DOMAINS.has(input.suggestedDomain)) return input.suggestedDomain
  if (input.parentDomain && !RESERVED_SPLIT_SOURCE_DOMAINS.has(input.parentDomain)) return input.parentDomain
  const existingProjectDomain = input.queue.tasks
    .map((task) => task.domain)
    .find((domain): domain is string => typeof domain === 'string' && domain.length > 0 && !RESERVED_SPLIT_SOURCE_DOMAINS.has(domain))
  return existingProjectDomain ?? 'general'
}

function splitChildWorkKind(title: string): TaskRecord['workKind'] {
  const normalized = normalizeTaskTitle(title)
  if (/\bprimitive\b|\bmenuitem\b|\bmenu item\b/.test(normalized)) return 'primitive'
  if (/\bstorybook\b|\bstory\b/.test(normalized)) return 'story'
  if (/\btest\b|\be2e\b|\bproof\b|\bverification\b/.test(normalized)) return 'test'
  if (/\bcomponent\b|\bimplementation\b/.test(normalized)) return 'component'
  return 'implementation'
}

function uniqueSplitChildTaskId(queue: TaskQueueRecord, parentId: string, title: string, index: number): string {
  const base = `${parentId}-split-${slugForTaskId(title) || index + 1}`
  let candidate = base
  let suffix = 2
  while (queue.tasks.some((task) => task.id === candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

function slugForTaskId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
}

function normalizeTaskTitle(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeAssignmentForStatus(
  task: z.infer<typeof Task>,
  opts: { explicitAssignedTo: boolean; explicitStatus?: z.infer<typeof TaskStatus> },
): void {
  if (opts.explicitAssignedTo) return

  switch (task.status) {
    case 'in_progress':
      task.assignedTo = 'worker-agent'
      return
    case 'review':
      task.assignedTo = 'reviewer-agent'
      return
    case 'gate_check':
      task.assignedTo = 'gate-checker-agent'
      return
    case 'ready':
    case 'spec_review':
    case 'exploring':
    case 'proposed':
    case 'pending_pr':
    case 'done':
    case 'shelved':
    case 'blocked':
      if (opts.explicitStatus) delete task.assignedTo
      return
  }
}

function eventForExplicitStatus(from: z.infer<typeof TaskStatus>, to: z.infer<typeof TaskStatus>): TaskTransitionEvent {
  switch (to) {
    case 'import_draft':
      return 'mark_import_draft'
    case 'exploring':
      return from === 'import_draft' ? 'start_intake' : 'recover_to_exploring'
    case 'spec_review':
      return from === 'blocked' ? 'recover_to_spec_review' : 'mark_spec_review'
    case 'ready':
      return from === 'blocked' ? 'recover_to_ready' : 'mark_ready'
    case 'in_progress':
      if (from === 'review' || from === 'gate_check') return 'revise'
      if (from === 'blocked') return 'recover_to_in_progress'
      return 'start_worker'
    case 'review':
      return from === 'blocked' ? 'recover_to_review' : 'request_review'
    case 'gate_check':
      return 'start_gate_check'
    case 'pending_pr':
      return 'await_pull_request'
    case 'done':
      return 'complete'
    case 'blocked':
      return 'block'
    case 'shelved':
      return 'shelve'
    case 'proposed':
      return 'recover_to_exploring'
  }
}

function updateIncludesCompletionEvidence(input: UpdateTaskInput, task: z.infer<typeof Task>): boolean {
  if (input.completedAt?.trim()) return true
  if (input.gateResults?.some((result) => result.type === 'hard' && result.passed)) return true
  if (Array.isArray(input.acceptanceCriteria)) {
    for (const criterion of input.acceptanceCriteria) {
      const parsed = AcceptanceCriteria.safeParse(criterion)
      if (parsed.success && parsed.data.met === true) return true
    }
  }
  if (task.gateResults.some((result) => result.type === 'hard' && result.passed)) return true
  return task.acceptanceCriteria.length > 0 && task.acceptanceCriteria.every((criterion) => criterion.met === true)
}

function hasTaskMutation(input: UpdateTaskInput): boolean {
  return input.title !== undefined ||
    input.domain !== undefined ||
    input.status !== undefined ||
    input.assignedTo !== undefined ||
    input.note !== undefined ||
    input.blockReason !== undefined ||
    input.humanJudgment !== undefined ||
    input.spec !== undefined ||
    input.structuredSpec !== undefined ||
    input.acceptanceCriteria !== undefined ||
    input.workUnitAnalysis !== undefined ||
    input.delivery !== undefined ||
    input.gateResults !== undefined ||
    input.completedAt !== undefined
}

function inferSizingRiskLanes(task: z.infer<typeof Task>): string[] {
  const text = [
    task.title,
    task.description,
    task.spec,
    ...task.acceptanceCriteria.map((criterion) => criterion.description),
  ].join('\n').toLowerCase()
  const lanes = new Set<string>()
  if (/\b(ui|ux|screen|settings|toolbar|dashboard|form|copy)\b/.test(text)) lanes.add('ux_comprehension')
  if (/\b(api|endpoint|route|contract|status code)\b/.test(text)) lanes.add('api_contract')
  if (/\b(database|migration|migrate|backfill|schema|subscription|analytics|persistence)\b/.test(text)) lanes.add('data_integrity')
  if (/\b(migration|migrate|backfill|schema)\b/.test(text)) lanes.add('migration_safety')
  if (/\b(auth|privacy|pii|token|tenant|permission)\b/.test(text)) lanes.add('privacy')
  if (/\b(release|rollout|flag|deploy|launch)\b/.test(text)) lanes.add('release_risk')
  if (/\b(docs?|readme|guide|analytics)\b/.test(text)) lanes.add('docs_truth')
  return [...lanes]
}

function inferSingleActiveTaskId(queue: TaskQueueModel): string | null {
  const candidates = queue.tasks.filter((t) =>
    ['in_progress', 'review', 'gate_check', 'spec_review'].includes(t.status),
  )
  return candidates.length === 1 ? candidates[0]!.id : null
}

function hasUnansweredMarkdownOpenQuestions(spec: string): boolean {
  const section = extractMarkdownSection(spec, 'Open Questions')
  if (!section) return false
  const lines = section
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
    .filter(Boolean)
  if (lines.length === 0) return false
  const meaningful = lines.filter((line) => !/^(none|n\/a|no open questions|no questions)\.?$/i.test(line))
  if (meaningful.length === 0) return false
  return meaningful.some((line) => /\?/.test(line) || /^(who|what|when|where|why|how|should|can|do|does|is|are)\b/i.test(line))
}

function extractMarkdownSection(markdown: string, heading: string): string | null {
  const lines = markdown.split('\n')
  const headingPattern = new RegExp(`^#{2,6}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')
  const start = lines.findIndex((line) => headingPattern.test(line.trim()))
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^#{2,6}\s+/.test(line.trim()))
  const sectionLines = end < 0 ? rest : rest.slice(0, end)
  return sectionLines.join('\n').trim() || null
}

function normalizeSpecForTaskProjectPath(spec: string, taskProjectPath: string): string {
  const prefix = duplicatedProjectPathPrefix(taskProjectPath)
  if (!prefix) return spec
  return stripDuplicatedPathPrefix(spec, prefix)
}

function normalizeAcceptanceCriterionForTaskProjectPath(
  criterion: z.infer<typeof AcceptanceCriteria>,
  taskProjectPath: string,
): z.infer<typeof AcceptanceCriteria> {
  const prefix = duplicatedProjectPathPrefix(taskProjectPath)
  if (!prefix) return criterion
  return {
    ...criterion,
    description: stripDuplicatedPathPrefix(criterion.description, prefix),
    ...(criterion.command ? { command: stripDuplicatedPathPrefix(criterion.command, prefix) } : {}),
  }
}

function duplicatedProjectPathPrefix(taskProjectPath: string): string | null {
  const base = path.basename(path.resolve(taskProjectPath || '.')).trim()
  return base && base !== '.' && base !== '/' ? base : null
}

function stripDuplicatedPathPrefix(value: string, prefix: string): string {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return value.replace(new RegExp(`\\b${escaped}/`, 'g'), '')
}

function deriveImportedTaskTitle(task: z.infer<typeof Task>): string | null {
  const currentTitle = typeof task.title === 'string' ? task.title.trim() : ''
  if (!looksLikeImportedFragmentTitle(currentTitle)) return null
  const area = importedAreaLabel(task)
  const summary = firstSpecSummaryLine(task.spec)
  if (!area || !summary) return null
  return `${area}: ${lowercaseFirst(summary.replace(/[.!?]+$/, '').trim())}`
}

function looksLikeImportedFragmentTitle(title: string): boolean {
  if (!title) return false
  return /\(deferred\)/i.test(title) || /^version diff view$/i.test(title.trim())
}

function importedAreaLabel(task: z.infer<typeof Task>): string | null {
  const notes = Array.isArray(task.notes) ? task.notes : []
  const importerNote = notes.find((note) =>
    note?.role === 'importer' &&
    (note?.agentId === 'workspace-importer' || note?.agentId === 'workspace-importer-agent'),
  )
  const content = typeof importerNote?.content === 'string' ? importerNote.content : ''
  if (!content) return null
  if (/[/\\]knit[/\\]/i.test(content)) return 'Knit'
  if (/[/\\]looma[/\\]/i.test(content)) return 'Looma'
  return null
}

function firstSpecSummaryLine(spec: string | undefined): string | null {
  if (typeof spec !== 'string' || !spec.trim()) return null
  const anchor = /^##\s+(?:Summary|What this is)\s*$/im.exec(spec)
  const normalized = anchor ? spec.slice(anchor.index + anchor[0].length).trim() : spec.trim()
  const nextHeadingIndex = normalized.search(/\n##\s|\n###\s/)
  const summaryBlock = (nextHeadingIndex >= 0 ? normalized.slice(0, nextHeadingIndex) : normalized).trim()
  if (!summaryBlock) return null
  const firstParagraph = summaryBlock.split(/\n\s*\n/)[0]?.trim() ?? ''
  if (!firstParagraph) return null
  const singleLine = firstParagraph.replace(/\s+/g, ' ').trim()
  if (!singleLine) return null
  return (singleLine.match(/^(.+?[.!?])(?:\s|$)/)?.[1] ?? singleLine).trim()
}

function lowercaseFirst(value: string): string {
  if (!value) return value
  return value[0]!.toLowerCase() + value.slice(1)
}

export const updateTaskTool = defineTool({
  name: 'update-task',
  description:
    "Update a task's title, status, spec, structuredSpec, acceptance criteria, assignment, or notes. Use this to transition tasks through the lifecycle.",
  inputSchema: updateTaskInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      tasksPath: { type: 'string', description: 'Absolute path to TASKS.json' },
      taskId: { type: 'string', description: 'Task id. Omit only when exactly one task is active.' },
      title: { type: 'string' },
      domain: { type: 'string' },
      status: {
        type: 'string',
        enum: [
          'proposed',
          'exploring',
          'spec_review',
          'ready',
          'in_progress',
          'review',
          'gate_check',
          'pending_pr',
          'done',
          'shelved',
          'blocked',
        ],
      },
      assignedTo: { type: 'string' },
      note: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          role: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['agentId', 'role', 'content'],
      },
      blockReason: { type: 'string' },
      humanJudgment: { type: 'string' },
      spec: { type: 'string' },
      structuredSpec: { type: 'object', description: 'Structured JSON spec payload. Guildhall renders this into markdown deterministically.' },
      acceptanceCriteria: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            scenario: { type: 'string' },
            expectation: { type: 'string' },
            verifiedBy: { type: 'string', enum: ['automated', 'review', 'human'] },
            command: { type: 'string' },
            evidenceHint: { type: 'string' },
            negativeCase: { type: 'string' },
            met: { type: 'boolean' },
          },
          required: ['id', 'description', 'verifiedBy'],
        },
      },
      workUnitAnalysis: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Semantic summary of how many independently deliverable work units the task contains.',
          },
          units: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                deliverable: { type: 'string' },
                rationale: { type: 'string' },
                suggestedDomain: { type: 'string' },
                dependsOn: { type: 'array', items: { type: 'string' } },
              },
              required: ['id', 'title', 'deliverable', 'rationale'],
            },
          },
          proofOnlyItems: {
            type: 'array',
            items: { type: 'string' },
            description: 'Verification, review, or evidence items that prove a unit but are not separate deliverables.',
          },
          createdAt: { type: 'string' },
          createdBy: { type: 'string' },
        },
        required: ['summary', 'units', 'createdAt'],
      },
      gateResults: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            gateId: { type: 'string' },
            type: { type: 'string', enum: ['hard', 'soft'] },
            passed: { type: 'boolean' },
            output: { type: 'string' },
            checkedAt: { type: 'string', description: 'ISO timestamp when the gate ran' },
          },
          required: ['gateId', 'type', 'passed', 'checkedAt'],
        },
      },
      completedAt: { type: 'string', description: 'ISO timestamp when the task completed' },
    },
    required: ['tasksPath'],
  },
  isReadOnly: () => false,
  execute: async (input, ctx) => {
    const result = await updateTask(input, ctx.metadata ?? {})
    return {
      output: result.success
        ? `Updated task ${result.taskId ?? input.taskId ?? '(inferred task)'}`
        : `Error updating task ${input.taskId ?? '(missing taskId)'}: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

const addTaskInputSchema = z.object({
  tasksPath: TASKS_PATH_SCHEMA,
  task: Task.omit({ notes: true, gateResults: true, revisionCount: true }),
})

export type AddTaskInput = z.input<typeof addTaskInputSchema>
export interface AddTaskResult {
  success: boolean
  taskId?: string
  error?: string
}

export async function addTask(input: AddTaskInput): Promise<AddTaskResult> {
  try {
    const raw = await readManagedTextFile(input.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))
    const newTask = Task.parse({
      ...input.task,
      notes: [],
      gateResults: [],
      revisionCount: 0,
    })
    queue.tasks.push(newTask)
    queue.lastUpdated = new Date().toISOString()
    writeProjectTaskQueue(input.tasksPath, queue)
    return { success: true, taskId: newTask.id }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const addTaskTool = defineTool({
  name: 'add-task',
  description: 'Add a new task to the task queue. Used by coordinators and spec agents to create work items.',
  inputSchema: addTaskInputSchema,
  jsonSchema: { type: 'object' },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await addTask(input)
    return {
      output: result.success
        ? `Added task ${result.taskId}`
        : `Error adding task: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})
