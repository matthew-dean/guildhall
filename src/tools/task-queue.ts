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
  type TaskEvidenceEvent,
  Task,
  TaskQueue,
  TaskStatus,
  WorkUnitAnalysis,
  StructuredSpec,
  TaskDelivery,
  buildTaskSizePlan,
  parseAcceptanceCriteriaFromSpec,
  renderStructuredSpecMarkdown,
} from '@guildhall/core'
import { appendTaskEvidence, atomicWriteText, inferProjectRootFromMemoryDir } from '@guildhall/sessions'
import { writeProjectTaskQueue } from '../runtime/project-state-boundary.js'

const TASKS_PATH_SCHEMA = z.string().describe('Absolute path to the TASKS.json file')

const readTasksInputSchema = z.object({ tasksPath: TASKS_PATH_SCHEMA })
export type ReadTasksInput = z.input<typeof readTasksInputSchema>
export interface ReadTasksResult {
  queue: z.infer<typeof TaskQueue> | null
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

type TaskRecord = z.infer<typeof Task>
type TaskQueueRecord = z.infer<typeof TaskQueue>

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
          'No task mutation provided. Set at least one of title, status, assignedTo, note, blockReason, humanJudgment, spec, structuredSpec, acceptanceCriteria, workUnitAnalysis, delivery, gateResults, or completedAt.',
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
      if (isMaterializableSplitAction(task.sizePlan.action) && task.status === 'ready') {
        materializeSplitChildren(queue, task, sizePlanCreatedAt)
      }
    }
    task.updatedAt = new Date().toISOString()
    queue.lastUpdated = new Date().toISOString()

    writeProjectTaskQueue(input.tasksPath, queue)
    await appendUpdateTaskEvidence({
      tasksPath: input.tasksPath,
      taskId,
      note: noteEvidence,
      gateResults: gateEvidence,
    })
    return { success: true, taskId }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

async function appendUpdateTaskEvidence(input: {
  tasksPath: string
  taskId: string
  note: { agentId: string; role: string; content: string; timestamp: string } | null
  gateResults: Array<z.infer<typeof GateResult>>
}): Promise<void> {
  if (!input.note && input.gateResults.length === 0) return
  const projectRoot = inferProjectRootFromMemoryDir(path.dirname(input.tasksPath))
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
): void {
  const sizePlan = parent.sizePlan
  if (!sizePlan || !isMaterializableSplitAction(sizePlan.action)) return
  const recommendations = sizePlan.recommendedChildren ?? []
  if (recommendations.length === 0) return
  const splitLabel = sizePlan.action === 'split_required' ? 'Split-required' : 'Split-recommended'
  const splitNote = sizePlan.action === 'split_required' ? 'Split required' : 'Split recommended'

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
    recommendation.createdTaskId = task.id
    task.hierarchy = {
      ...(task.hierarchy ?? {}),
      parentId: parent.id,
      order: index,
      childIds: task.hierarchy?.childIds ?? [],
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
  }
  parent.taskReadiness = {
    taskKind: parent.taskReadiness?.taskKind ?? parent.taskKind ?? 'implementation',
    recommendation: 'split',
    summary: `${splitLabel} work is represented by linked child tasks.`,
    dimensions: parent.taskReadiness?.dimensions ?? [],
    definitionOfDone: parent.taskReadiness?.definitionOfDone ?? {
      items: ['All required child tasks are done or explicitly deferred.'],
      evidenceRequired: ['Linked child task outcomes are recorded before the containing work is closed.'],
      updatedAt: timestamp,
      createdBy: 'task-sizing',
    },
    blockerPlans: parent.taskReadiness?.blockerPlans ?? [],
    contextBudget: parent.taskReadiness?.contextBudget ?? {
      estimatedTokens: 0,
      risk: 'medium',
      fitsInOneWorkerBrief: false,
      reasons: ['This work was split into linked child tasks.'],
    },
    assessedAt: parent.taskReadiness?.assessedAt ?? timestamp,
    assessedBy: parent.taskReadiness?.assessedBy ?? 'task-sizing',
  }
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
}

export const materializeRequiredSplitChildren = materializeSplitChildren

export function isMaterializableSplitAction(action: string | undefined): boolean {
  return action === 'split_required' || action === 'split_recommended'
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
  return Task.parse({
    id,
    title: input.title,
    description: [
      input.reason,
      '',
      `Split from containing work ${input.parent.id}: ${input.parent.title}.`,
    ].join('\n'),
    domain: input.suggestedDomain ?? input.parent.domain,
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
        content: `Created from ${input.parent.sizePlan?.action === 'split_required' ? 'split-required' : 'split-recommended'} parent ${input.parent.id}. ${input.reason}`,
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

function inferSingleActiveTaskId(queue: z.infer<typeof TaskQueue>): string | null {
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
