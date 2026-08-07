import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, stableJson, writeManagedTextFile } from '@guildhall/persistence'
import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import { createHash } from 'node:crypto'
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
  extractStructuredSelfCritique,
  StructuredSpec,
  WorkerExecutionMode,
  TaskDelivery,
  BootstrapRepairOwnership,
  type TaskSplitRecommendation,
  type TaskQueue as TaskQueueModel,
  buildTaskSizePlan,
  buildDecompositionChildDrafts,
  acceptanceCriteriaFromStructuredSpec,
  splitChildSourceIdentity,
  renderStructuredSpecMarkdown,
} from '@guildhall/core'
import {
  appendTaskEvidence,
  atomicWriteText,
  inferProjectRootFromMemoryDir,
  readProjectStateDatabaseCurrentAuthorityFromTasksPath,
  readProjectStateDatabaseTaskEvidenceCurrent,
  upsertTaskRuntimeState,
  withProjectStateWriteLock,
} from '@guildhall/sessions'
import {
  FORBIDDEN_PROJECT_TASK_FIELDS,
  readProjectTaskQueueForMutationSync,
  readProjectTaskQueueSync,
  writePromotedTaskDetailMutation,
  writeProjectTaskQueue,
} from '@guildhall/runtime/project-state-boundary'
import { validateSpecGrounding } from '@guildhall/runtime/spec-quality'
import { taskDoneButProofMissing } from '@guildhall/runtime/proof-health'
import { ensureCommandProofPathsFromAcceptanceCriteria, isConcreteProjectProofCommand, proofIdentityMarkerForTask, proofSetupHasTaskIdentity } from '@guildhall/runtime/proof-paths'

const TASKS_PATH_SCHEMA = z.string().describe('Absolute path to the TASKS.json file')

const readTasksInputSchema = z.object({ tasksPath: TASKS_PATH_SCHEMA })
export type ReadTasksInput = z.input<typeof readTasksInputSchema>
export interface ReadTasksResult {
  queue: TaskQueueModel | null
  error?: string
}

export async function readTasks(input: ReadTasksInput): Promise<ReadTasksResult> {
  try {
    return { queue: TaskQueue.parse(readProjectTaskQueueSync(input.tasksPath)) }
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

const structuredUpdateTaskNoteSchema = z.object({
  agentId: z.string(),
  role: z.string(),
  content: z.string(),
  structured: z.record(z.string(), z.unknown()).optional(),
})

type StructuredUpdateTaskNote = z.infer<typeof structuredUpdateTaskNoteSchema>

const updateTaskNoteSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return parseJsonShapedNoteString(trimmed) ?? value
  }
}, z.union([structuredUpdateTaskNoteSchema, z.string().min(1)]))

function parseJsonShapedNoteString(value: string): { agentId: string; role: string; content: string } | null {
  const agentId = /"agentId"\s*:\s*"([^"]+)"/.exec(value)?.[1]
  const role = /"role"\s*:\s*"([^"]+)"/.exec(value)?.[1]
  const content = (
    /"content"\s*:\s*"([\s\S]*)"\s*}\s*$/.exec(value) ??
    /"content"\s*:\s*"([\s\S]*)$/.exec(value)
  )?.[1]
  if (!agentId || !role || content === undefined) return null
  return {
    agentId,
    role,
    content: content
      .replace(/"\s*}\s*$/, '')
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\'),
  }
}

function normalizeUpdateTaskNote(
  note: z.infer<typeof updateTaskNoteSchema> | undefined,
  metadata: Record<string, unknown>,
): StructuredUpdateTaskNote | undefined {
  if (note === undefined) return undefined
  const runtimeAgentId = typeof metadata['current_agent_id'] === 'string' && metadata['current_agent_id'].trim()
    ? metadata['current_agent_id'].trim()
    : ''
  const runtimeRole = runtimeAgentId === 'worker-agent'
    ? 'self-critique'
    : runtimeAgentId === 'reviewer-agent'
      ? 'reviewer'
      : runtimeAgentId === 'gate-checker-agent'
        ? 'gate-checker'
        : runtimeAgentId === 'coordinator'
          ? 'coordinator'
          : runtimeAgentId === 'human'
            ? 'human'
            : 'note'
  if (typeof note !== 'string') {
    const parsedContent = parseJsonShapedNoteString(note.content)
    const normalized = parsedContent ? { ...note, content: parsedContent.content } : note
    return runtimeAgentId
      ? { ...normalized, agentId: runtimeAgentId, role: runtimeRole }
      : normalized
  }
  const content = note.trim()
  if (!content) return undefined
  const agentId = runtimeAgentId || 'agent'
  const role = runtimeAgentId ? runtimeRole : 'note'
  return { agentId, role, content }
}

/**
 * A worker may save its machine handoff as one durable mutation and move to
 * review in the next mutation. Review admission reads the compact current
 * evidence projection rather than requiring the agent to repeat the packet
 * or reconstruct it from prose.
 */
function workerHandoffContractFingerprint(task: z.infer<typeof Task>): string {
  // This is an opaque system stamp, not a model-authored field. It binds a
  // worker's self-critique to exactly the acceptance and proof contract that
  // Guildhall will evaluate at review admission.
  const contract = {
    taskId: task.id,
    acceptanceCriteria: task.acceptanceCriteria,
    proofPaths: task.proofPaths ?? [],
    delivery: task.delivery ?? null,
    parentAcceptanceCriterionIds: task.parentAcceptanceCriterionIds ?? [],
  }
  return createHash('sha256').update(stableJson(contract)).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stampWorkerSelfCritiqueContract(
  note: NonNullable<TaskModel['notes']>[number],
  task: z.infer<typeof Task>,
): NonNullable<TaskModel['notes']>[number] {
  if (note.agentId !== 'worker-agent' || note.role !== 'self-critique' || !isRecord(note.structured)) return note
  if (extractStructuredSelfCritique({ content: '', structured: note.structured }) === null) return note
  return {
    ...note,
    structured: {
      ...note.structured,
      guildhallHandoffContract: workerHandoffContractFingerprint(task),
    },
  }
}

function persistedWorkerSelfCritique(
  projectRoot: string,
  task: z.infer<typeof Task>,
): Record<string, unknown> | null {
  const notes = readProjectStateDatabaseTaskEvidenceCurrent(projectRoot, task.id)?.byKind.note ?? []
  const expectedContract = workerHandoffContractFingerprint(task)
  for (const record of [...notes].reverse()) {
    const payload = record.payload
    const agentId = typeof payload.agentId === 'string' ? payload.agentId.trim() : ''
    const role = typeof payload.role === 'string' ? payload.role.trim() : ''
    if (agentId !== 'worker-agent' || role !== 'self-critique') continue
    if (!isRecord(payload.structured) || payload.structured.guildhallHandoffContract !== expectedContract) continue
    const structured = extractStructuredSelfCritique({ content: '', structured: payload.structured })
    if (structured !== null) return structured
  }
  return null
}

function normalizeStructuredSpecDisplayField(value: unknown): unknown {
  if (typeof value === 'string' || value === undefined) return value
  // These fields are rendered explanatory material. Preserve a malformed
  // model shape deterministically for review instead of throwing away an
  // otherwise valid typed planning contract. Operational fields such as
  // acceptance criteria and proof contracts remain schema-strict.
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function normalizeStructuredSpecInput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  return {
    ...record,
    verification: Array.isArray(record.verification)
      ? record.verification.map(normalizeStructuredSpecDisplayField)
      : record.verification,
    componentApiShape: normalizeStructuredSpecDisplayField(record.componentApiShape),
    performanceReliabilitySecurity: normalizeStructuredSpecDisplayField(record.performanceReliabilitySecurity),
  }
}

const updateTaskInputSchema = z.object({
  tasksPath: TASKS_PATH_SCHEMA,
  taskId: z.string().optional(),
  title: z.string().optional(),
  domain: z.string().optional(),
  status: TaskStatus.optional(),
  executionMode: WorkerExecutionMode.optional(),
  bootstrapRepairOwnership: BootstrapRepairOwnership.optional(),
  assignedTo: z.string().nullable().optional(),
  note: updateTaskNoteSchema.optional(),
  blockReason: z.string().optional(),
  humanJudgment: z.string().optional(),
  spec: z.string().optional(),
  structuredSpec: z.preprocess(normalizeStructuredSpecInput, StructuredSpec).optional(),
  acceptanceCriteria: z.array(AcceptanceCriteria).optional(),
  parentAcceptanceCriterionIds: z.array(z.string().min(1)).optional(),
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

type PlanningSourceEvidence = { path: string; commands: string[] }

function planningSourceClaims(metadata: Record<string, unknown>): NonNullable<TaskRecord['sourceClaims']> {
  const raw = metadata['planning_source_evidence']
  if (!Array.isArray(raw)) return []
  const claims = raw.flatMap((entry): NonNullable<TaskRecord['sourceClaims']> => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    const sourcePath = typeof record.path === 'string' ? record.path.trim() : ''
    if (!sourcePath) return []
    const commands = Array.isArray(record.commands)
      ? record.commands.filter((command): command is string => typeof command === 'string' && command.trim().length > 0)
      : []
    return [{
      signalId: `agent-read:${sourcePath}`,
      source: 'agent-session-read',
      title: `Inspected ${sourcePath}`,
      evidence: commands.length > 0
        ? `Exact executable lines observed: ${commands.join('; ')}`
        : 'The current planning agent inspected this source through Guildhall.',
      references: [sourcePath],
      role: 'reference',
      structure: 'record',
      confidence: 'high',
      linkedTaskHints: [],
    }]
  })
  return claims
}

function mergePlanningSourceClaims(
  existing: NonNullable<TaskRecord['sourceClaims']>,
  observed: NonNullable<TaskRecord['sourceClaims']>,
): NonNullable<TaskRecord['sourceClaims']> {
  const byId = new Map<string, NonNullable<TaskRecord['sourceClaims']>[number]>()
  for (const claim of [...existing, ...observed]) {
    const key = claim.signalId ?? `${claim.source}:${claim.title}`
    byId.set(key, claim)
  }
  return [...byId.values()]
}

function changedExistingAcceptanceCommand(
  task: TaskRecord,
  nextCriteria: readonly TaskRecord['acceptanceCriteria'][number][],
): { criterionId: string; current: string; next: string } | null {
  const nextById = new Map(nextCriteria.map((criterion) => [criterion.id, criterion] as const))
  for (const current of task.acceptanceCriteria) {
    const currentCommand = typeof current.command === 'string' ? current.command.trim() : ''
    if (!currentCommand) continue
    const nextCommand = typeof nextById.get(current.id)?.command === 'string'
      ? nextById.get(current.id)!.command!.trim()
      : ''
    if (nextCommand !== currentCommand) {
      return { criterionId: current.id, current: currentCommand, next: nextCommand }
    }
  }
  return null
}

function acceptanceContractIsActive(task: TaskRecord): boolean {
  return ['ready', 'in_progress', 'review', 'gate_check', 'pending_pr', 'done'].includes(task.status)
}

function knownCommandProofs(
  task: TaskRecord,
  currentEvidence?: { byKind?: Record<string, Array<{ payload?: unknown }>> } | null,
): string[] {
  const evidenceGates = (currentEvidence?.byKind?.['gate_result'] ?? [])
    .map((event) => GateResult.safeParse(event.payload))
    .filter((result): result is { success: true; data: z.infer<typeof GateResult> } => result.success)
    .map((result) => result.data)
  const commands = [
    ...task.acceptanceCriteria.map((criterion) => criterion.command),
    ...(task.proofPaths ?? []).map((path) => path?.kind === 'command' ? path.command : undefined),
    ...task.gateResults
      .filter((gate) => gate.type === 'hard' && gate.passed)
      .map((gate) => gate.command),
    ...evidenceGates
      .filter((gate) => gate.type === 'hard' && gate.passed)
      .map((gate) => gate.command),
  ]
    .filter((command): command is string => typeof command === 'string' && command.trim().length > 0)
    .map((command) => command.trim())
  return [...new Set(commands)]
}

function validateStructuredProofContract(
  task: TaskRecord,
  spec: z.infer<typeof StructuredSpec>,
  currentEvidence?: { byKind?: Record<string, Array<{ payload?: unknown }>> } | null,
): string | null {
  const existingCommands = knownCommandProofs(task, currentEvidence)
  if (existingCommands.length === 0) return null

  const disposition = spec.proofContract?.existingCommandDisposition
  if (!disposition) {
    return 'This task has recorded command-backed proof. structuredSpec.proofContract must explicitly preserve, replace, or retire that proof instead of silently omitting it.'
  }

  const nextCommands = new Set(
    spec.acceptanceCriteria
      .map((criterion) => criterion.command?.trim())
      .filter((command): command is string => Boolean(command)),
  )
  if (disposition === 'preserve') {
    const missing = existingCommands.filter((command) => !nextCommands.has(command))
    if (missing.length > 0) {
      return `structuredSpec.proofContract preserves recorded command proof, but these commands are missing from its acceptance criteria: ${missing.join(', ')}.`
    }
  }
  if (disposition === 'replace' && nextCommands.size === 0) {
    return 'structuredSpec.proofContract replaces recorded command proof, so it must provide at least one replacement command in acceptance criteria.'
  }
  return null
}

function inferMetadataTaskId(metadata: Record<string, unknown> = {}): string | null {
  const taskId = metadata['current_task_id']
  return typeof taskId === 'string' && taskId.trim().length > 0 ? taskId.trim() : null
}

export async function updateTask(
  rawInput: UpdateTaskInput,
  metadata: Record<string, unknown> = {},
): Promise<UpdateTaskResult> {
  let tasksPath: string | null = null
  try {
    tasksPath = updateTaskInputSchema.parse(rawInput).tasksPath
  } catch {
    // Preserve the existing validation error shape in the normal path.
  }
  if (tasksPath) {
    return withProjectStateWriteLock(tasksPath, () => updateTaskUnlocked(rawInput, metadata))
  }
  return updateTaskUnlocked(rawInput, metadata)
}

async function updateTaskUnlocked(
  rawInput: UpdateTaskInput,
  metadata: Record<string, unknown> = {},
): Promise<UpdateTaskResult> {
  try {
    const input = updateTaskInputSchema.parse(rawInput)
    const queueRead = readProjectTaskQueueForMutationSync(input.tasksPath)
    const queue = TaskQueue.parse(queueRead.queue)
    const originalTaskIds = new Set(queue.tasks.map(candidate => candidate.id))
    const originalReleases = JSON.stringify(queue.releases ?? [])
    const originalSelectedReleaseId = queue.selectedReleaseId
    const taskId = input.taskId ?? inferMetadataTaskId(metadata) ?? inferSingleActiveTaskId(queue)
    if (!taskId) {
      return {
        success: false,
        error: 'Missing taskId (or metadata.current_task_id) and could not infer a single active task',
      }
    }
    const task = queue.tasks.find((t) => t.id === taskId)
    if (!task) return { success: false, taskId, error: `Task ${taskId} not found` }
    const originalTask = structuredClone(task)
    const currentAgentId = typeof metadata['current_agent_id'] === 'string'
      ? metadata['current_agent_id'].trim()
      : ''

    if (!hasTaskMutation(input)) {
      return {
        success: false,
        taskId,
        error:
          'No task mutation provided. Set at least one of title, domain, status, assignedTo, note, blockReason, humanJudgment, executionMode, bootstrapRepairOwnership, spec, structuredSpec, acceptanceCriteria, parentAcceptanceCriterionIds, workUnitAnalysis, delivery, gateResults, or completedAt.',
      }
    }
    if (input.spec !== undefined && input.structuredSpec !== undefined) {
      return {
        success: false,
        taskId,
        error: 'Provide either spec markdown or structuredSpec JSON, not both.',
      }
    }

    // Rendered Markdown is a view of the structured contract. A model must not
    // choose a different planning path by changing headings, bullets, or prose
    // style. These writers are deterministic migration/import boundaries; old
    // records are upgraded at intake instead of becoming a second live API.
    const legacyMarkdownWriter = !currentAgentId ||
      currentAgentId === 'human' ||
      currentAgentId === 'system' ||
      currentAgentId === 'workspace-importer' ||
      currentAgentId === 'coordinator-recovery'
    if (input.spec !== undefined && !legacyMarkdownWriter) {
      return {
        success: false,
        taskId,
        error:
          'Freeform spec Markdown cannot be written by an agent. Submit structuredSpec JSON; Guildhall renders Markdown from that contract and keeps prose display-only.',
      }
    }

    const normalizedNote = normalizeUpdateTaskNote(input.note, metadata)
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
    const normalizedSpec = input.spec !== undefined
      ? normalizeSpecForTaskProjectPath(input.spec, task.projectPath)
      : undefined
    const normalizedStructuredSpec = input.structuredSpec !== undefined
      ? StructuredSpec.parse(input.structuredSpec)
      : undefined
    const renderedStructuredSpec = normalizedStructuredSpec
      ? normalizeSpecForTaskProjectPath(renderStructuredSpecMarkdown(normalizedStructuredSpec), task.projectPath)
      : undefined
    if (normalizedStructuredSpec) {
      const currentEvidence = readProjectStateDatabaseTaskEvidenceCurrent(
        projectRootForTaskState(input.tasksPath, task),
        task.id,
      )
      const proofContractError = validateStructuredProofContract(task, normalizedStructuredSpec, currentEvidence)
      if (proofContractError) return { success: false, taskId, error: proofContractError }
    }
    const nextSpec = renderedStructuredSpec ?? normalizedSpec
    const observedSourceClaims = planningSourceClaims(metadata)
    const effectiveSourceClaims = mergePlanningSourceClaims(task.sourceClaims ?? [], observedSourceClaims)
    if (nextSpec) {
      const grounding = validateSpecGrounding({
        ...task,
        sourceClaims: effectiveSourceClaims,
        references: [...new Set([
          ...(task.references ?? []),
          ...observedSourceClaims.flatMap((claim) => claim.references),
        ])],
        spec: nextSpec,
        ...(normalizedStructuredSpec ? { structuredSpec: normalizedStructuredSpec } : {}),
      })
      if (!grounding.ok) {
        return {
          success: false,
          taskId,
          error:
            `Spec is not grounded in the visible task/source context. ${grounding.errors.join(' ')}` +
            ' Remove unsupported implementation details or preserve the missing fact as a review/open-question boundary before saving the spec.',
        }
      }
    }
    const normalizedAcceptanceCriteria = input.acceptanceCriteria !== undefined
      ? z.array(AcceptanceCriteria).parse(input.acceptanceCriteria)
        .map((criterion) => normalizeAcceptanceCriterionForTaskProjectPath(criterion, task.projectPath))
      : undefined
    if (normalizedAcceptanceCriteria && acceptanceContractIsActive(task)) {
      const changedCommand = changedExistingAcceptanceCommand(task, normalizedAcceptanceCriteria)
      if (changedCommand) {
        return {
          success: false,
          taskId,
          error:
            `Acceptance command ${changedCommand.criterionId} is an active executable contract and cannot be replaced or removed by update-task. ` +
            'Return the task to exploring/spec_review and save a deliberate re-plan before changing its proof command.',
        }
      }
    }
    const baseAcceptanceCriteria = normalizedAcceptanceCriteria ?? task.acceptanceCriteria
    const workerSelfCritiqueFromMutation = currentAgentId === 'worker-agent' && normalizedNote?.role === 'self-critique'
      ? extractStructuredSelfCritique({ content: '', structured: normalizedNote.structured })
      : null
    const workerSelfCritique = workerSelfCritiqueFromMutation ?? (
      currentAgentId === 'worker-agent' && input.status === 'review'
        ? persistedWorkerSelfCritique(projectRootForTaskState(input.tasksPath, task), task)
        : null
    )
    const effectiveAcceptanceCriteria = materializeProofCommandFromWorkerHandoff(
      task,
      baseAcceptanceCriteria,
      workerSelfCritique,
    )
    const derivedAcceptanceCriteria = !sameJson(effectiveAcceptanceCriteria, baseAcceptanceCriteria)
      ? effectiveAcceptanceCriteria
      : undefined
    if (currentAgentId === 'worker-agent' && input.status === 'review') {
      if (!workerSelfCritique) {
        return {
          success: false,
          taskId,
          error:
            'Worker review handoff requires one durable self-critique with typed acceptanceCriteria, changedFiles, verificationCommands, and proofEvidenceIds. Persist it in this update or an earlier worker update; Guildhall never derives a handoff from prose.',
        }
      }
      const expectedIds = effectiveAcceptanceCriteria.map((criterion) => criterion.id)
      const actualIds = (Array.isArray(workerSelfCritique.acceptanceCriteria)
        ? workerSelfCritique.acceptanceCriteria
        : [])
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
        .map((entry: Record<string, unknown>) => typeof entry.id === 'string' ? entry.id.trim() : '')
      const expectedSet = new Set(expectedIds)
      const actualSet = new Set(actualIds)
      const idsMatch = expectedIds.length === actualIds.length &&
        actualIds.every((id) => id.length > 0 && expectedSet.has(id)) &&
        expectedIds.every((id) => actualSet.has(id))
      if (!idsMatch) {
        return {
          success: false,
          taskId,
          error:
            `Worker self-critique acceptance criterion IDs must exactly match the current task contract (${expectedIds.join(', ') || 'none'}); do not invent or omit criterion IDs in the handoff packet.`,
        }
      }
      if (isProofSetupTask(task) && !effectiveAcceptanceCriteria.some((criterion) =>
        typeof criterion.command === 'string' && isConcreteProjectProofCommand(criterion.command),
      )) {
        return {
          success: false,
          taskId,
          error:
            'Proof-setup work cannot enter review until its exact task-specific command is stored on the acceptance criterion. Provider prose and broad build/test commands are not proof.',
        }
      }
      if (isProofSetupTask(task) && !proofSetupHasTaskIdentity({
        ...task,
        acceptanceCriteria: effectiveAcceptanceCriteria,
      })) {
        return {
          success: false,
          taskId,
          error:
            'Proof-setup work cannot enter review until the command criterion requires its stable guildhall-proof task marker. Command output identity is machine evidence; provider prose is not.',
        }
      }
      const handoffStep = typeof task.handoffStep === 'number' ? task.handoffStep : 0
      const hasPendingHandoffStep = Array.isArray(task.handoffSequence) && handoffStep + 1 < task.handoffSequence.length
      if (hasPendingHandoffStep && !workerSelfCritique.handoff) {
        return {
          success: false,
          taskId,
          error:
            'This task has another specialist step. Worker self-critique requires structured.handoff with completed, knownGaps, and optional nextFocus fields; Guildhall never extracts handoff state from prose or Markdown headings.',
        }
      }
    }
    const selectedRelease = queue.selectedReleaseId
      ? queue.releases?.find((release) => release.id === queue.selectedReleaseId)
      : undefined
    const taskIsInSelectedScriptOnlyRelease = selectedRelease?.proofStyle === 'script_only' &&
      task.releaseIds?.includes(selectedRelease.id) === true
    const hasBareScriptProofCriterion = taskIsInSelectedScriptOnlyRelease &&
      normalizedAcceptanceCriteria?.some((criterion) =>
        typeof criterion.command === 'string' && !isConcreteProjectProofCommand(criterion.command),
      ) === true
    if (hasBareScriptProofCriterion) {
      return {
        success: false,
        taskId,
        error:
          'Script-only release criteria must name a task-specific proof command or omit the command until Guildhall creates proof-setup work. Bare workspace test/build commands cannot become current proof contracts.',
      }
    }
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
    if (explicitStatus === 'done' && isProofSetupTask(task)) {
      const proofContract = {
        ...task,
        acceptanceCriteria: effectiveAcceptanceCriteria,
      }
      const hasConcreteCommand = effectiveAcceptanceCriteria.some((criterion) =>
        typeof criterion.command === 'string' && isConcreteProjectProofCommand(criterion.command),
      )
      const hasTaskIdentity = proofSetupHasTaskIdentity(proofContract)
      if (!hasConcreteCommand || !hasTaskIdentity) {
        return {
          success: false,
          taskId,
          error:
            'Proof-setup work cannot enter done until its typed acceptance contract contains a concrete task-specific command and stable guildhall-proof marker. Provider prose and a met checkbox are not completion evidence.',
        }
      }
      const proofPaths = ensureCommandProofPathsFromAcceptanceCriteria(proofContract, new Date().toISOString(), currentAgentId || 'update-task')
      const candidate = {
        ...proofContract,
        proofPaths,
        gateResults: [
          ...(task.gateResults ?? []),
          ...(input.gateResults ?? []),
        ],
      }
      if (taskDoneButProofMissing(candidate)) {
        return {
          success: false,
          taskId,
          error:
            'Proof-setup work cannot enter done until the exact task-specific command has a passing machine verification record. A self-critique or provider explanation cannot substitute for the proof run.',
        }
      }
    }
    if (
      currentAgentId === 'spec-agent' &&
      explicitStatus === 'spec_review' &&
      !task.spec?.trim() &&
      !(input.spec?.trim()) &&
      input.structuredSpec === undefined
    ) {
      return {
        success: false,
        taskId,
        error:
          'A task cannot enter spec_review without a durable spec. Save the product brief and spec first, then move it to spec_review.',
      }
    }
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
    if (observedSourceClaims.length > 0) {
      task.sourceClaims = effectiveSourceClaims
      task.references = [...new Set([
        ...(task.references ?? []),
        ...observedSourceClaims.flatMap((claim) => claim.references),
      ])]
    }
    if (input.executionMode !== undefined) task.executionMode = WorkerExecutionMode.parse(input.executionMode)
    if (input.bootstrapRepairOwnership !== undefined) {
      task.bootstrapRepairOwnership = BootstrapRepairOwnership.parse(input.bootstrapRepairOwnership)
    }
    if (input.domain !== undefined && input.domain.trim() !== '') task.domain = input.domain.trim()
    if (input.parentAcceptanceCriterionIds !== undefined) {
      if (input.parentAcceptanceCriterionIds.length > 0) {
        task.parentAcceptanceCriterionIds = [...new Set(input.parentAcceptanceCriterionIds)]
      } else {
        delete task.parentAcceptanceCriterionIds
      }
    }
    if (statusTransition?.kind === 'applied') task.status = statusTransition.nextState
    if (input.assignedTo !== undefined) {
      if ((input.assignedTo ?? '').trim() === '') delete task.assignedTo
      else task.assignedTo = input.assignedTo
    }
    if (input.blockReason !== undefined && input.blockReason.trim() !== '') task.blockReason = input.blockReason
    if (input.humanJudgment !== undefined && input.humanJudgment.trim() !== '') task.humanJudgment = input.humanJudgment
    if (normalizedStructuredSpec !== undefined) {
      task.structuredSpec = normalizedStructuredSpec
    } else if (normalizedSpec !== undefined) {
      delete task.structuredSpec
    }
    if (nextSpec !== undefined && nextSpec.trim() !== '') {
      task.spec = nextSpec
      if (normalizedStructuredSpec && normalizedAcceptanceCriteria === undefined) {
        task.acceptanceCriteria = acceptanceCriteriaFromStructuredSpec(normalizedStructuredSpec)
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
      task.acceptanceCriteria = z.array(AcceptanceCriteria).parse(effectiveAcceptanceCriteria)
    } else if (derivedAcceptanceCriteria !== undefined) {
      task.acceptanceCriteria = z.array(AcceptanceCriteria).parse(derivedAcceptanceCriteria)
    }
    if (task.acceptanceCriteria.some((criterion) =>
      typeof criterion.command === 'string' && isConcreteProjectProofCommand(criterion.command),
    )) {
      task.proofPaths = ensureCommandProofPathsFromAcceptanceCriteria(task, new Date().toISOString(), currentAgentId || 'update-task')
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
    const shouldRefreshSizePlan =
      (nextSpec !== undefined && nextSpec.trim() !== '') ||
      input.workUnitAnalysis !== undefined
    if (shouldRefreshSizePlan) {
      const sizePlanCreatedAt = new Date().toISOString()
      task.sizePlan = buildTaskSizePlan({
        task,
        // Risk lanes are a structured review-planning output. The task
        // title/spec prose is not a classifier input for sizing.
        riskLanes: task.reviewRisk?.lanes ?? [],
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
    const noteEvidence = normalizedNote
      ? stampWorkerSelfCritiqueContract({ ...normalizedNote, timestamp: task.updatedAt }, task)
      : null

    const taskProjectRoot = projectRootForTaskState(input.tasksPath, task, metadata)
    const taskIdsUnchanged = queue.tasks.length === originalTaskIds.size &&
      queue.tasks.every(candidate => originalTaskIds.has(candidate.id))
    const queueEnvelopeUnchanged = JSON.stringify(queue.releases ?? []) === originalReleases &&
      queue.selectedReleaseId === originalSelectedReleaseId
    const databaseAuthority = readProjectStateDatabaseCurrentAuthorityFromTasksPath(input.tasksPath) === 'database'
    const isPointMutation = taskIdsUnchanged && queueEnvelopeUnchanged
    if (databaseAuthority && isPointMutation) {
      const promotedMutation = writePromotedTaskDetailMutation(input.tasksPath, taskId, {
        projectId: path.basename(taskProjectRoot),
        projectRoot: taskProjectRoot,
        mutate: (current) => applyDefinitionDelta(
          current,
          originalTask as unknown as Record<string, unknown>,
          task as unknown as Record<string, unknown>,
        ),
      })
      if (!promotedMutation) {
        throw new Error(`Could not persist promoted task definition for task ${taskId}`)
      }
    } else if (!databaseAuthority || !isPointMutation) {
      writeProjectTaskQueue(input.tasksPath, queue, {
        ...(queueRead.expectedQueueRevision !== null
          ? { expectedQueueRevision: queueRead.expectedQueueRevision }
        : {}),
      })
    }
    await persistUpdateTaskRuntimeState(input.tasksPath, task, metadata)
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

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameDefinitionValue(key: string, left: unknown, right: unknown): boolean {
  // The SQLite projection may omit schema-defaulted source collections while
  // the in-memory Task parser exposes them as []. They mean the same thing;
  // treating that representation difference as a concurrent edit prevents an
  // agent from attaching the source evidence it just observed.
  if (
    (key === 'references' || key === 'sourceClaims') &&
    ((left === undefined && Array.isArray(right) && right.length === 0) ||
      (right === undefined && Array.isArray(left) && left.length === 0))
  ) return true
  if (key === 'acceptanceCriteria') {
    const normalized = (value: unknown): unknown => {
      const parsed = z.array(AcceptanceCriteria).safeParse(value)
      return parsed.success ? parsed.data : value
    }
    return sameJson(normalized(left), normalized(right))
  }
  return sameJson(left, right)
}

function applyDefinitionDelta(
  currentTask: Record<string, unknown>,
  baselineTask: Record<string, unknown>,
  nextTask: Record<string, unknown>,
): Record<string, unknown> | null {
  const changedKeys = new Set([
    ...Object.keys(baselineTask),
    ...Object.keys(nextTask),
  ].filter((key) => !FORBIDDEN_PROJECT_TASK_FIELDS.includes(key as typeof FORBIDDEN_PROJECT_TASK_FIELDS[number])))
  const next = { ...currentTask }
  for (const key of changedKeys) {
    const baselineValue = baselineTask[key]
    const nextValue = nextTask[key]
    if (sameDefinitionValue(key, baselineValue, nextValue)) continue
    if (!sameDefinitionValue(key, currentTask[key], baselineValue)) return null
    if (nextValue === undefined) delete next[key]
    else next[key] = nextValue
  }
  next.id = String(nextTask.id ?? currentTask.id)
  return next
}

function projectRootForTaskState(
  tasksPath: string,
  task: z.infer<typeof Task>,
  metadata: Record<string, unknown> = {},
): string {
  const workspaceProjectPath = typeof metadata['current_task_workspace_project_path'] === 'string'
    ? metadata['current_task_workspace_project_path'].trim()
    : ''
  if (workspaceProjectPath && path.isAbsolute(workspaceProjectPath)) return workspaceProjectPath
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
  // Promoted task definitions intentionally omit runtime-owned fields. A
  // schema default such as revisionCount=0 must not overwrite the existing
  // runtime overlay when update-task only changes definition/evidence state.
  // Status ownership is the one runtime field this mutation is allowed to
  // update; the orchestrator owns revision/recovery counters.
  await upsertTaskRuntimeState(projectRootForTaskState(tasksPath, task, metadata), task.id, {
    assignedTo: Object.prototype.hasOwnProperty.call(task, 'assignedTo') ? task.assignedTo ?? null : null,
    updatedAt: task.updatedAt,
  })
}

async function appendUpdateTaskEvidence(input: {
  tasksPath: string
  task: z.infer<typeof Task>
  taskId: string
  metadata?: Record<string, unknown>
  note: NonNullable<TaskModel['notes']>[number] | null
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
  const savedChildPlans = sizePlan.recommendedChildren ?? []
  const plannedChildren = savedChildPlans.length > 0
    ? savedChildPlans
    : buildDecompositionChildDrafts({ task: parent })
  if (plannedChildren.length === 0) return { status: 'noop', childTaskIds: [] }
  // A split is executable only when every new child has an explicit identity
  // or an already-materialized task id. Never turn display wording or array
  // position into durable child identity.
  if (plannedChildren.some(child =>
    !child.identity &&
    (!child.createdTaskId || !queue.tasks.some(task => task.id === child.createdTaskId)),
  )) {
    return { status: 'noop', childTaskIds: [] }
  }
  const usesSavedChildPlans = savedChildPlans.length > 0
  const splitLabel = legacySplitLabel(sizePlan.action)

  const representedSplit = savedChildPlans.length > 0
    ? settleAlreadyRepresentedSplitRecommendations(queue, parent, timestamp)
    : null
  if (representedSplit) {
    return { status: 'already_represented', childTaskIds: representedSplit.childTaskIds }
  }

  const existingChildIds = new Set(parent.hierarchy?.childIds ?? [])
  const planned = plannedChildren.map((childPlan, index) => {
    const existingById = childPlan.createdTaskId
      ? queue.tasks.find((task) => task.id === childPlan.createdTaskId)
      : undefined
    const childIdentity = childPlan.identity
      ? splitChildSourceIdentity(parent, childPlan.identity)
      : undefined
    const existingByIdentity = childIdentity
      ? queue.tasks.find((task) =>
        task.id !== parent.id &&
        task.status !== 'archived' &&
        task.status !== 'cancelled' &&
        task.sourceIdentity === childIdentity,
      )
      : undefined
    const task = existingById ?? existingByIdentity ?? createSplitChildTask({
      parent,
      identity: childPlan.identity!,
      sourceIdentity: childIdentity,
      title: childPlan.title,
      reason: childPlan.reason,
      suggestedDomain: childPlan.suggestedDomain,
      suggestedTaskKind: childPlan.suggestedTaskKind,
      queue,
      timestamp,
    })
    if (!queue.tasks.some((candidate) => candidate.id === task.id)) queue.tasks.push(task)
    if (usesSavedChildPlans) childPlan.createdTaskId = task.id
    if ((task.releaseIds ?? []).length === 0 && (parent.releaseIds ?? []).length > 0) task.releaseIds = [...(parent.releaseIds ?? [])]
    if ((task.references ?? []).length === 0 && (parent.references ?? []).length > 0) task.references = [...(parent.references ?? [])]
    task.hierarchy = {
      ...(task.hierarchy ?? {}),
      parentId: parent.id,
      order: index,
      childIds: task.hierarchy?.childIds ?? [],
      relation: 'decomposes',
    }
    attachInternalDeliveryStep(parent, task)
    existingChildIds.add(task.id)
    return { childPlan, task }
  })

  const workUnitIdToId = new Map<string, string>()
  planned.forEach(({ childPlan, task }) => {
    if (childPlan.identity) workUnitIdToId.set(childPlan.identity, task.id)
  })
  for (const { childPlan, task } of planned) {
    task.dependsOn = (childPlan.dependsOn ?? [])
      .map((dependency) => workUnitIdToId.get(dependency) ?? dependency)
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
    rationale: 'Planned decomposition was materialized into linked child work.',
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

  // `executionPlanActions` is the idempotency authority. A note is audit
  // material only; never use its wording as a duplicate detector because a
  // different model/provider can phrase the same split differently.
  parent.notes.push({
    agentId: 'task-sizing',
    role: 'coordinator',
    structured: {
      event: 'split_work_applied',
      childTaskIds: planned.map(({ task }) => task.id),
    },
    content: `Linked child tasks for ${parent.id}: ${planned.map(({ task }) => task.id).join(', ')}.`,
    timestamp,
  })
  return { status: 'materialized', childTaskIds: planned.map(({ task }) => task.id) }
}

export const materializeRequiredSplitChildren = materializeSplitChildren

export const PROOF_SETUP_SEMANTIC_KIND = 'proof_setup'

export function isProofSetupTask(
  task: Pick<TaskRecord, 'semanticKind'>,
): boolean {
  return task.semanticKind === PROOF_SETUP_SEMANTIC_KIND
}

/**
 * A proof worker reports its observed command in the structured handoff. Keep
 * that command in the acceptance contract so later gates, reviewers, and
 * release projections all read one authority. This is a typed projection, not
 * an interpretation of the worker's explanation.
 */
function materializeProofCommandFromWorkerHandoff(
  task: TaskRecord,
  criteria: TaskRecord['acceptanceCriteria'],
  selfCritique: Record<string, unknown> | null,
): TaskRecord['acceptanceCriteria'] {
  if (!isProofSetupTask(task)) return criteria
  if (criteria.some((criterion) =>
    typeof criterion.command === 'string' && isConcreteProjectProofCommand(criterion.command),
  )) return criteria

  const verificationCommands = Array.isArray(selfCritique?.verificationCommands)
    ? selfCritique.verificationCommands
      .filter((entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
      )
      .filter((entry) => entry.status === 'passed')
      .map((entry) => typeof entry.command === 'string' ? entry.command.trim() : '')
      .filter((command) => isConcreteProjectProofCommand(command))
    : []
  const command = verificationCommands[0]
  const parentId = task.hierarchy?.parentId ?? task.delivery?.supports?.[0]
  const criterion = criteria[0]
  if (!command || !parentId || !criterion) return criteria

  const marker = proofIdentityMarkerForTask(parentId)
  return [
    {
      ...criterion,
      command,
      expectedExit: criterion.expectedExit ?? 'zero',
      expectedOutputIncludes: [...new Set([...(criterion.expectedOutputIncludes ?? []), marker])],
      // A worker handoff reports a command; only the observed hard gate may
      // mark a command-backed criterion as met.
      met: false,
    },
    ...criteria.slice(1),
  ]
}

/**
 * A script-only release still needs executable proof when the source-backed
 * spec does not name a command. Keep the accepted task contract intact and
 * materialize the missing verification work as an internal child. This is a
 * real work item in the same hierarchy, not a read-time blocker or a second
 * proof model.
 */
export function materializeProofSetupTask(
  queue: TaskQueueRecord,
  parent: TaskRecord,
  timestamp: string,
  options: {
    /** Release-local follow-up work must not inherit a shipped release. */
    releaseIds?: readonly string[]
    /** Keep a shipped parent immutable when only a later release needs proof. */
    linkParent?: boolean
  } = {},
): { status: 'materialized' | 'already_represented'; childTaskId: string } {
  // A proof-setup task is already the executable proof boundary. Treating it
  // as a parent would create an unbounded proof-setup -> proof-setup chain.
  if (isProofSetupTask(parent)) {
    return { status: 'already_represented', childTaskId: parent.id }
  }
  const requestedReleaseIds = new Set(options.releaseIds ?? [])
  const proofReleaseIds = options.releaseIds ?? parent.releaseIds ?? []
  const existing = queue.tasks.find((candidate) => {
    if (candidate.hierarchy?.parentId !== parent.id || !isProofSetupTask(candidate)) return false
    if (['archived', 'cancelled'].includes(candidate.status)) return false
    if (requestedReleaseIds.size > 0 &&
      !(candidate.proofForReleaseId && requestedReleaseIds.has(candidate.proofForReleaseId))) return false
    // A proof child shared with a shipped release is historical evidence. A
    // later release gets a fresh child even when the old child also names the
    // later release, so the current proof contract never mutates history.
    const hasShippedMembership = candidate.proofForReleaseId
      ? queue.releases?.some(release => release.id === candidate.proofForReleaseId && release.state === 'shipped') === true
      : false
    return !hasShippedMembership
  })
  if (existing) {
    return { status: 'already_represented', childTaskId: existing.id }
  }

  const baseId = `${parent.id}-proof-setup`
  let id = baseId
  let suffix = 2
  while (queue.tasks.some((task) => task.id === id)) {
    id = `${baseId}-${suffix}`
    suffix += 1
  }

  const child = buildProofSetupTaskContract(parent, timestamp, {
    id,
    releaseIds: proofReleaseIds,
  })

  queue.tasks.push(child)
  if (options.linkParent !== false) {
    parent.hierarchy = {
      ...(parent.hierarchy ?? {}),
      order: parent.hierarchy?.order ?? 0,
      childIds: [...new Set([...(parent.hierarchy?.childIds ?? []), child.id])],
      relation: parent.hierarchy?.relation ?? 'contains',
    }
    attachInternalDeliveryStep(parent, child)
    parent.notes.push({
      agentId: 'proof-recovery',
      role: 'coordinator',
      content: `Added linked verification work ${child.id} to establish the missing concrete project proof command.`,
      timestamp,
    })
  }
  return { status: 'materialized', childTaskId: child.id }
}

/**
 * Turn a selected release's known proof blockers into its existing internal
 * verification work in one deterministic mutation. The caller supplies the
 * blocker identities from the shared scope projection; this helper only
 * maintains the task graph and never re-derives readiness from prose.
 */
export function prepareReleaseProofRecovery(
  queue: TaskQueueRecord,
  input: {
    parentTaskIds: readonly string[]
    releaseId: string
    timestamp: string
  },
): {
  materializedTaskIds: string[]
  reopenedTaskIds: string[]
  representedTaskIds: string[]
  rejectedParentTaskIds: string[]
} {
  const materializedTaskIds: string[] = []
  const reopenedTaskIds: string[] = []
  const representedTaskIds: string[] = []
  const rejectedParentTaskIds: string[] = []
  const release = queue.releases?.find(candidate => candidate.id === input.releaseId)
  for (const parentTaskId of [...new Set(input.parentTaskIds)].sort()) {
    const parent = queue.tasks.find(task => task.id === parentTaskId)
    const isReleaseMember = Boolean(
      release && (
        (release.nodeIds ?? []).includes(`work:${parentTaskId}`)
      ),
    )
    if (!parent || !isReleaseMember || ['archived', 'cancelled', 'shelved'].includes(parent.status)) {
      rejectedParentTaskIds.push(parentTaskId)
      continue
    }
    const result = materializeProofSetupTask(queue, parent, input.timestamp, {
      releaseIds: [input.releaseId],
    })
    const proofTask = queue.tasks.find(task => task.id === result.childTaskId)
    if (!proofTask) continue
    if (result.status === 'materialized') materializedTaskIds.push(proofTask.id)
    else representedTaskIds.push(proofTask.id)

    // A proof child in a terminal handoff or review state is not runnable when
    // its parent still lacks current proof. The failed/absent proof is the
    // authoritative outcome, so return that same bounded child to ready work
    // instead of leaving Start to rediscover an already-represented blocker.
    // Do not override genuinely blocked work: it may carry an external
    // constraint that recovery cannot truthfully erase.
    if (['done', 'pending_pr', 'review'].includes(proofTask.status)) {
      const priorStatus = proofTask.status
      proofTask.status = 'ready'
      proofTask.assignedTo = null
      delete proofTask.completedAt
      proofTask.updatedAt = input.timestamp
      proofTask.notes.push({
        agentId: 'proof-recovery',
        role: 'coordinator',
        content: `Returned ${proofTask.id} from ${priorStatus} because the selected release still lacks current proof for ${parent.id}.`,
        timestamp: input.timestamp,
      })
      reopenedTaskIds.push(proofTask.id)
    }
  }
  return { materializedTaskIds, reopenedTaskIds, representedTaskIds, rejectedParentTaskIds }
}

/**
 * Build the one canonical proof-setup task contract. Existing generated proof
 * children use this same builder during migration so creation and repair
 * cannot drift into two subtly different task shapes.
 */
export function buildProofSetupTaskContract(
  parent: TaskRecord,
  timestamp: string,
  options: { id?: string; releaseIds?: readonly string[]; proofForReleaseId?: string; command?: string } = {},
): TaskModel {
  const id = options.id ?? `${parent.id}-proof-setup`
  const requestedReleaseIds = [...new Set(options.releaseIds ?? parent.releaseIds ?? [])]
  const proofForReleaseId = options.proofForReleaseId ?? (requestedReleaseIds.length === 1 ? requestedReleaseIds[0] : undefined)
  const childStructuredSpec = StructuredSpec.parse({
    whatThisIs: `A bounded proof-setup task for ${parent.title}.`,
    problemContext: 'The selected script-only release requires one exact project-backed command before the containing task can be released.',
    goals: [
      'Inspect the registered project surface and establish the smallest task-specific proof command.',
      'Record that command in the typed acceptance contract and run it to produce durable evidence.',
    ],
    nonGoals: [
      'Do not use a broad workspace convention such as pnpm test or pnpm build as task proof.',
      'Do not expand the containing task or implement sibling product work.',
    ],
    proposedDesign: 'Use the existing project package/CLI/test conventions, adding one focused proof entry only when the visible project surface has no suitable command.',
    keyDecisions: [
      'The exact command is discovered from the project surface by the worker and stored as structured acceptance data.',
      'The command result, not provider narration, settles proof.',
    ],
    acceptanceCriteria: [{
      scenario: 'Given the containing task has no concrete project-backed proof command, when proof setup is complete',
      expectation: 'One exact task-specific command is recorded and its passing result is attached to the selected release proof path.',
      verificationMode: 'review',
      evidenceHint: 'Inspect the acceptance criterion command, matching command proof path, and passing verification record.',
      expectedOutputIncludes: [proofIdentityMarkerForTask(parent.id)],
      ...(options.command ? { command: options.command } : {}),
    }],
    verification: [
      'Run the exact command recorded on the proof-command-recorded acceptance criterion.',
      'Confirm the command proof path has a passing verification record for its required evidence.',
    ],
    completionBoundary: {
      productOutcome: `The selected release has concrete proof for ${parent.title}.`,
      whatGuildhallCanCompleteInCode: 'Repo-local proof command, focused fixture/test/CLI wiring, and durable proof evidence.',
      externalDependencies: 'None known from the containing task.',
      ownerOnlySetup: 'None known from the containing task.',
      verificationEnvironment: 'The registered project checkout and its existing package/CLI/test tooling.',
      whatCountsAsDone: 'The exact task-specific command is recorded, runs successfully, and its proof evidence is attached.',
      whatMustBeSplitOrBlocked: 'A genuinely external dependency or product decision outside this proof contract.',
      splitPolicy: 'none',
    },
  })

  return Task.parse({
    id,
    title: `Establish concrete proof for ${parent.title}`,
    description: [
      `Establish the exact project-backed command that proves ${parent.title}.`,
      'Use registered project evidence and the selected release proof contract.',
      'Do not use a bare workspace convention such as pnpm test or pnpm build.',
      `This verification work supports containing task ${parent.id}.`,
    ].join('\n'),
    domain: parent.domain,
    projectPath: parent.projectPath,
    status: 'ready',
    priority: parent.priority,
    dependsOn: [],
    outOfScope: [],
    structuredSpec: childStructuredSpec,
    spec: renderStructuredSpecMarkdown(childStructuredSpec),
    acceptanceCriteria: acceptanceCriteriaFromStructuredSpec(childStructuredSpec),
    notes: [{
      agentId: 'proof-recovery',
      role: 'coordinator',
      content: `Created because ${parent.id} was approved without a concrete project-backed proof command.`,
      timestamp,
    }],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    revisionCount: 0,
    origination: 'system',
    proposedBy: 'proof-recovery',
    semanticKind: PROOF_SETUP_SEMANTIC_KIND,
    workKind: 'verification',
    taskKind: 'verification',
    workVisibility: {
      kind: 'internal_step',
      countInProjectTotals: false,
    },
    ...(proofForReleaseId ? { proofForReleaseId } : {}),
    // Internal verification work inherits its execution eligibility through
    // hierarchy. It never joins the visible release membership relation.
    releaseIds: [],
    references: [...(parent.references ?? [])],
    delivery: {
      ...(parent.delivery ?? {}),
      supports: [parent.id, ...(parent.delivery?.supports ?? [])]
        .filter((supportId, index, all) => all.indexOf(supportId) === index),
    },
    hierarchy: {
      parentId: parent.id,
      order: parent.hierarchy?.childIds?.length ?? 0,
      childIds: [],
      relation: 'decomposes',
    },
    businessEnvelope: parent.businessEnvelope,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}

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

export function settleAlreadyRepresentedSplitRecommendations(
  queue: TaskQueueRecord,
  parent: TaskRecord,
  timestamp: string,
): { childTaskIds: string[] } | null {
  const plannedChildren = parent.sizePlan?.recommendedChildren ?? []
  const existingSiblingIds = splitRecommendationsAlreadyRepresentedBySiblings(queue, parent, plannedChildren)
  if (!existingSiblingIds) return null
  removeDuplicateNestedSplitChildIds(queue, parent, plannedChildren)
  settleMaterializedSplitParent({
    parent,
    timestamp,
    recommendation: 'ready',
    summary: 'This task is ready; sibling tasks already cover the split work.',
    reason: 'Planned child work already matches existing sibling tasks under the same parent; do not split this task again unless the child structure changes.',
    childTaskIds: existingSiblingIds,
  })
  return { childTaskIds: existingSiblingIds }
}

export function settleMaterializedSplitReadiness(
  queue: TaskQueueRecord,
  parent: TaskRecord,
  timestamp: string,
): { childTaskIds: string[] } | null {
  const plannedChildren = parent.sizePlan?.recommendedChildren ?? []
  const splitIdentityOwner = parent.hierarchy?.parentId
    ? queue.tasks.find(task => task.id === parent.hierarchy?.parentId) ?? parent
    : parent
  const representedIds = plannedChildren.map(childPlan => {
    if (childPlan.createdTaskId && queue.tasks.some(task => task.id === childPlan.createdTaskId)) {
      return childPlan.createdTaskId
    }
    if (childPlan.identity) {
      return queue.tasks.find(task =>
        task.sourceIdentity === splitChildSourceIdentity(splitIdentityOwner, childPlan.identity!),
      )?.id
    }
    return undefined
  })
  const linkedChildIds = linkedChildTaskIds(queue, parent)
  const hasExactRecommendationCoverage = plannedChildren.length > 0 && representedIds.every(Boolean)
  const representedChildIds = hasExactRecommendationCoverage
    ? representedIds.filter((id): id is string => Boolean(id))
    : linkedChildIds
  if (representedChildIds.length === 0) return null
  if (hasExactRecommendationCoverage) {
    plannedChildren.forEach((childPlan, index) => {
      childPlan.createdTaskId = representedChildIds[index]
    })
  } else if (parent.sizePlan && isLegacySplitAction(parent.sizePlan.action)) {
    parent.sizePlan.recommendedChildren = representedChildIds.map((childTaskId) => {
      const child = queue.tasks.find(task => task.id === childTaskId)
      return {
        title: child?.title ?? childTaskId,
        reason: 'Existing linked child task represents the parent decomposition boundary.',
        dependsOn: child?.dependsOn ?? [],
        suggestedDomain: child?.domain,
        createdTaskId: childTaskId,
      }
    })
  }
  const reason = hasExactRecommendationCoverage
    ? 'Split has already been materialized into linked child tasks; do not split this parent again unless the child structure changes.'
    : 'Linked child tasks already represent this parent decomposition boundary; reconcile child scope instead of splitting this parent again.'
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
  recommendations: Array<{ identity?: string; createdTaskId?: string }>,
): string[] | null {
  const containingParentId = parent.hierarchy?.parentId
  if (!containingParentId || recommendations.length === 0) return null
  const containingParent = queue.tasks.find(task => task.id === containingParentId)
  if (!containingParent) return null
  const representedIds = recommendations.map(recommendation => {
    if (recommendation.createdTaskId && queue.tasks.some(task => task.id === recommendation.createdTaskId)) {
      return recommendation.createdTaskId
    }
    if (!recommendation.identity) return undefined
    return queue.tasks.find(task =>
      task.id !== parent.id &&
      task.hierarchy?.parentId === containingParentId &&
      task.sourceIdentity === splitChildSourceIdentity(containingParent, recommendation.identity!),
    )?.id
  })
  if (representedIds.some(id => !id)) return null
  return representedIds.filter((id): id is string => Boolean(id))
}

function removeDuplicateNestedSplitChildIds(
  queue: TaskQueueRecord,
  parent: TaskRecord,
  recommendations: Array<{ identity?: string; createdTaskId?: string }>,
): void {
  const hierarchy = parent.hierarchy
  const nestedChildIds = hierarchy?.childIds ?? []
  const containingParent = parent.hierarchy?.parentId
    ? queue.tasks.find(task => task.id === parent.hierarchy?.parentId)
    : undefined
  const recommendationIdentities = new Set(recommendations
    .map(recommendation => recommendation.identity
      ? splitChildSourceIdentity(containingParent ?? parent, recommendation.identity)
      : undefined)
    .filter((identity): identity is string => Boolean(identity)))
  const nestedDuplicates = queue.tasks.filter(task =>
    task.hierarchy?.parentId === parent.id &&
    recommendationIdentities.has(task.sourceIdentity ?? ''),
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
  recommendation?: 'ready' | 'requires_child_work'
  summary: string
  reason: string
  childTaskIds?: string[]
}): void {
  const { parent, timestamp, recommendation = 'requires_child_work', summary, reason, childTaskIds = [] } = input
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
        splitPolicy: 'none',
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
        'Required child work has already been materialized into linked child tasks.',
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
      evidence: ['Required child work has already been materialized into linked child tasks.'],
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
  identity: string
  sourceIdentity?: string
  title: string
  reason: string
  suggestedDomain?: string
  suggestedTaskKind?: TaskSplitRecommendation['suggestedTaskKind']
  queue: TaskQueueRecord
  timestamp: string
}): TaskRecord {
  const id = uniqueSplitChildTaskId(input.queue, input.parent.id, input.identity)
  const workKind = input.suggestedTaskKind ?? 'implementation'
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
    ...(input.sourceIdentity ? { sourceIdentity: input.sourceIdentity } : {}),
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
    releaseIds: [...(input.parent.releaseIds ?? [])],
    references: [...(input.parent.references ?? [])],
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

function uniqueSplitChildTaskId(queue: TaskQueueRecord, parentId: string, identity: string): string {
  const base = `${parentId}-split-${slugForTaskId(identity)}`
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
    case 'archived':
    case 'cancelled':
      throw new Error(`Task status ${to} is terminal and has no lifecycle transition event.`)
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
    input.executionMode !== undefined ||
    input.bootstrapRepairOwnership !== undefined ||
    input.spec !== undefined ||
    input.structuredSpec !== undefined ||
    input.acceptanceCriteria !== undefined ||
    input.parentAcceptanceCriterionIds !== undefined ||
    input.workUnitAnalysis !== undefined ||
    input.delivery !== undefined ||
    input.gateResults !== undefined ||
    input.completedAt !== undefined
}

function inferSingleActiveTaskId(queue: TaskQueueModel): string | null {
  const candidates = queue.tasks.filter((t) =>
    ['in_progress', 'review', 'gate_check', 'spec_review'].includes(t.status),
  )
  return candidates.length === 1 ? candidates[0]!.id : null
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
      executionMode: { type: 'string', enum: ['build', 'diagnose', 'tdd'], description: 'Structured worker loop selection. Never inferred from task prose.' },
      bootstrapRepairOwnership: { type: 'string', enum: ['task', 'workspace'], description: 'Structured bootstrap repair boundary. Never inferred from task prose.' },
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
          structured: { type: 'object', description: 'Required for worker self-critique notes: machine-readable acceptanceCriteria, changedFiles, verificationCommands, and proofEvidenceIds. Non-final specialist handoffs also require handoff.completed, handoff.knownGaps, and optional handoff.nextFocus. State never comes from note prose.' },
        },
        required: ['agentId', 'role', 'content'],
      },
      blockReason: { type: 'string' },
      humanJudgment: { type: 'string' },
      spec: { type: 'string', description: 'Legacy migration/import input only. Agent spec writes must use structuredSpec.' },
      structuredSpec: { type: 'object', description: 'Authoritative structured JSON spec payload. Guildhall renders this into markdown deterministically.' },
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
            expectedExit: { type: 'string', enum: ['zero', 'non_zero'] },
            expectedOutputIncludes: { type: 'array', items: { type: 'string' } },
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
    const queueRead = readProjectTaskQueueForMutationSync(input.tasksPath)
    const queue = TaskQueue.parse(queueRead.queue)
    const newTask = Task.parse({
      ...input.task,
      notes: [],
      gateResults: [],
      revisionCount: 0,
    })
    queue.tasks.push(newTask)
    queue.lastUpdated = new Date().toISOString()
    writeProjectTaskQueue(input.tasksPath, queue, {
      ...(queueRead.expectedQueueRevision !== null
        ? { expectedQueueRevision: queueRead.expectedQueueRevision }
        : {}),
    })
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
