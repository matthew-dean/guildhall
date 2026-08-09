import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import fs from 'node:fs/promises'
import path from 'node:path'
import { acceptanceCriteriaFromStructuredSpec, explicitTaskStructuralIdentity, splitChildSourceIdentity, TaskQueue, type RequestIntake, type Task, type TaskRequest, type TaskStatus } from '@guildhall/core'
import {
  atomicWriteText,
  appendTaskEvidence,
  inferProjectRootFromMemoryDir,
  projectStatePathFromMemoryDir,
  readProjectStateDatabaseQueueRevision,
  readProjectStateDatabaseTaskEvidenceCurrent,
  upsertTaskRuntimeState,
  upsertTaskWorkspaceState,
  withProjectStateWriteLock,
} from '@guildhall/sessions'
import {
  appendExploringTranscript,
  replaceExploringTranscript,
  isMaterializableSplitAction,
  materializeSplitChildren,
  resolveEscalation,
  resolveSupersededEscalations,
  settleAlreadyRepresentedSplitRecommendations,
  settleMaterializedSplitReadiness,
  materializeProofSetupTask,
  isProofSetupTask,
} from '@guildhall/tools'
import {
  continueImportedSourceRecovery,
  importedTaskNeedsSourceRecovery,
  normalizeImportedDraftTask,
  promoteImportDraftToExploring,
} from './import-drafts.js'
import {
  answerPressureTestQuestion,
  createPressureTestIntake,
  inspectPressureTestEvidence,
  loadPressureTestIntake,
  renderPressureTestSpec,
  savePressureTestIntake,
  type PressureTestIntake,
} from './pressure-test-intake.js'
import { analyzeRequestIntake, type RequestIntakeOwnerInput } from './request-intake.js'
import { routeRequest, type RouteRequestResult, type RoutedAction } from './request-routing.js'
import {
  productBriefFromSpecCompletionBoundary,
  ownerSpecRevisionRequirements,
  validateProductBriefGrounding,
  validateSpecCompletionBoundary,
  validateSpecGrounding,
} from './spec-quality.js'
import { taskShapingBlockers } from '@guildhall/shared'
import { applyTaskShaping } from './task-decomposition.js'
import { transitionTaskStatus } from './task-transition.js'
import { cancelOwnerInputRequestsForTask, createOwnerInputRequest } from './owner-input-store.js'
import { buildSurfaceReviewPacketsForStructuredSpec } from './contract-surfaces.js'
import { buildEffectiveTask } from './effective-task.js'
import { assessTaskReadiness, hasExplicitNoSplitBoundary } from './task-readiness.js'
import { isConcreteProjectProofCommand, replaceGenericProjectProofPathsWithSetup } from './proof-paths.js'
import { resetCurrentPlanForProofRecovery, resetCurrentPlanForRevision } from './task-plan-recovery.js'
import {
  sanitizeTaskQueueForProjectWrite,
  readProjectCanonicalCurrentState,
  readProjectStateAuthorityAtBoundary,
  resolveSelectedReleaseTaskContract,
  preserveRuntimeOverlayOnTaskQueueParse,
  writeProjectTaskQueueAtCurrentStateBoundary,
  writePromotedTaskDetailMutation,
  writeProjectTaskQueueWithSummary,
  readProjectTaskQueueForRichMutation,
} from './project-state-boundary.js'

// ---------------------------------------------------------------------------
// FR-12: exploratory task intake.
//
// A fuzzy user ask becomes a task in the `exploring` state, with a transcript
// seed in user-local Guildhall history. The Spec Agent picks it up on the next
// orchestrator tick and drives a conversational intake.
//
// Approval transitions: exploring → spec_review. Until approved, the
// orchestrator will keep routing exploring tasks back to the Spec Agent.
// ---------------------------------------------------------------------------

function tasksPathFor(memoryDir: string): string {
  return projectStatePathFromMemoryDir(memoryDir, 'TASKS.json')
}

function progressPathFor(memoryDir: string): string {
  return projectStatePathFromMemoryDir(memoryDir, 'PROGRESS.md')
}

async function readQueue(memoryDir: string): Promise<TaskQueue> {
  const tasksPath = tasksPathFor(memoryDir)
  const raw = await readProjectTaskQueueForRichMutation(inferProjectRootFromMemoryDir(memoryDir)).catch((err: unknown) => {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: unknown }).code === 'ENOENT'
    ) {
      return null
    }
    throw err
  })
  if (raw === null) {
    return TaskQueue.parse({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [],
    })
  }
  // A bare array is the only supported bootstrap shorthand. Once persisted,
  // all task state crosses the SQLite current-state boundary.
  const now = new Date().toISOString()
  const parsed = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw
  const queue = TaskQueue.parse(Array.isArray(parsed)
    ? { version: 1, lastUpdated: now, tasks: parsed }
    : parsed)
  const queueWithRuntime = preserveRuntimeOverlayOnTaskQueueParse(parsed, queue)
  for (const task of queueWithRuntime.tasks) normalizeImportedDraftTask(task)
  return queueWithRuntime
}

async function writeQueue(
  memoryDir: string,
  queue: TaskQueue,
  options: { expectedQueueRevision?: number | null; expectedProjectRevision?: number | null } = {},
): Promise<void> {
  const tasksPath = tasksPathFor(memoryDir)
  const projectRoot = inferProjectRootFromMemoryDir(memoryDir)
  await writeProjectTaskQueueAtCurrentStateBoundary(tasksPath, queue, {
    projectId: path.basename(projectRoot),
    projectRoot,
    ...(options.expectedQueueRevision !== null && options.expectedQueueRevision !== undefined
      ? { expectedQueueRevision: options.expectedQueueRevision }
      : {}),
    ...(options.expectedProjectRevision !== null && options.expectedProjectRevision !== undefined
      ? { expectedProjectRevision: options.expectedProjectRevision }
      : {}),
  })
}

function hasDurableImplementationProgress(task: Task): boolean {
  const record = task as Task & {
    artifactIds?: unknown
    latestCheckpoint?: unknown
    terminalSummary?: unknown
  }
  if (record.latestCheckpoint) return true
  if (record.terminalSummary) return true
  if (typeof task.handoffStep === 'number') return true
  if (Array.isArray(record.artifactIds) && record.artifactIds.length > 0) return true
  return false
}

function nextTaskId(queue: TaskQueue): string {
  const used = new Set(queue.tasks.map((t) => t.id))
  let n = queue.tasks.length + 1
  while (used.has(`task-${String(n).padStart(3, '0')}`)) n++
  return `task-${String(n).padStart(3, '0')}`
}

export interface IntakeInput {
  memoryDir: string
  ask: string
  domain: string
  projectPath: string
  /** Workspace root, when different from the task-owned project path. */
  workspacePath?: string
  /** Optional override for the task id (otherwise auto-generated) */
  taskId?: string
  /** Optional explicit title; defaults to a complete first-line ask or generic fallback. */
  title?: string
  /**
   * Durable project sources selected by the invoking surface. They are copied
   * onto the task so the coordinator sees the same grounding the UI shows.
   */
  sourceRefs?: string[]
  /** User-facing routed request metadata for Thread projection. */
  request?: TaskRequest
  /** Optional precomputed intake state when another flow already resolved routing questions. */
  requestIntakeOverride?: RequestIntake
  /** Optional explicit owner-input descriptor. Use `null` to suppress inferred owner input. */
  ownerInputOverride?: RequestIntakeOwnerInput | null | undefined
}

export interface IntakeResult {
  taskId: string
  transcriptPath: string
}

/**
 * Create a new task in the `exploring` state from a fuzzy ask and seed its
 * transcript with the user's initial message.
 */
export async function createExploringTask(input: IntakeInput): Promise<IntakeResult> {
  const queue = await readQueue(input.memoryDir)
  const id = input.taskId ?? nextTaskId(queue)
  if (queue.tasks.some((t) => t.id === id)) {
    throw new Error(`Task ${id} already exists`)
  }

  const now = new Date().toISOString()
  const title = compactStoredLabel(input.title, input.ask, 'New request')
  const requestIntakeAnalysis = analyzeRequestIntake({
    ask: input.ask,
    title,
    createdAt: now,
  })
  const requestIntake = input.requestIntakeOverride ?? requestIntakeAnalysis.requestIntake
  const ownerInput = input.ownerInputOverride !== undefined
    ? input.ownerInputOverride
    : requestIntakeAnalysis.ownerInput
  const sourceRefs = [...new Set((input.sourceRefs ?? []).map(ref => ref.trim()).filter(Boolean))]

  const task: Task = {
    id,
    title,
    description: input.ask,
    domain: input.domain,
    projectPath: input.projectPath,
    references: sourceRefs,
    sourceClaims: [],
    status: 'exploring',
    priority: 'normal',
    dependsOn: [],
    outOfScope: [],
    acceptanceCriteria: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    ...(input.request ? { request: input.request } : {}),
    requestIntake,
    createdAt: now,
    updatedAt: now,
  }

  queue.tasks.push(task)
  queue.lastUpdated = now
  await writeQueue(input.memoryDir, queue)

  if (ownerInput) {
    await createOwnerInputRequest({
      projectRoot: projectRootFromMemoryDir(input.memoryDir),
      projectId: path.basename(input.projectPath) || id,
      commandId: `request-intake:${id}:${ownerInputSourceId(ownerInput)}`,
      now,
      actor: 'request-intake',
      source: ownerInput.source.kind === 'request_intake'
        ? { ...ownerInput.source, intakeId: id }
        : ownerInput.source,
      target: ownerInput.target,
      question: {
        kind: 'text',
        prompt: ownerInput.prompt,
        ...(ownerInput.helperText ? { description: ownerInput.helperText } : {}),
        ...(ownerInput.choices ? { choices: ownerInput.choices } : {}),
      },
      objective: ownerInput.objective,
      sessionSource: `request-intake:${id}`,
    })
  }

  const appendResult = await appendExploringTranscript({
    memoryDir: input.memoryDir,
    taskId: id,
    role: 'user',
    content: input.ask,
  })
  if (!appendResult.success || !appendResult.path) {
    throw new Error(`Failed to seed transcript: ${appendResult.error ?? 'unknown'}`)
  }

  return { taskId: id, transcriptPath: appendResult.path }
}

function projectRootFromMemoryDir(memoryDir: string): string {
  return path.basename(memoryDir) === '.guildhall'
    ? path.dirname(memoryDir)
    : path.dirname(memoryDir)
}

function ownerInputSourceId(ownerInput: RequestIntakeOwnerInput): string {
  const source = ownerInput.source
  if (source.kind === 'request_intake') return `${source.kind}:${source.questionId ?? source.intakeId}`
  return `${source.kind}:owner-input`
}

export interface RoutedRequestResult {
  routedActions: RoutedAction[]
  routingDecision: RouteRequestResult['routingDecision']
  taskId?: string
  transcriptPath?: string
  pressureTestIntake?: PressureTestIntake
}

export interface MaterializedPressureTestIntake {
  taskId: string
  transcriptPath?: string
}

export async function answerPressureTestQuestionWithMaterialization(input: {
  memoryDir: string
  intakeId: string
  questionId: string
  answer: string
  materialization?: {
    domain: string
    projectPath: string
  }
}): Promise<{
  intake: PressureTestIntake
  materialized: MaterializedPressureTestIntake | null
}> {
  return withProjectStateWriteLock(tasksPathFor(input.memoryDir), async () => {
    const intake = await answerPressureTestQuestion(input)
    const materialized = input.materialization
      ? await materializeCompletedPressureTestIntakeUnlocked({
          memoryDir: input.memoryDir,
          intake,
          ...input.materialization,
        })
      : null
    return { intake, materialized }
  })
}

export async function materializeCompletedPressureTestIntake(input: {
  memoryDir: string
  intake: PressureTestIntake
  domain: string
  projectPath: string
}): Promise<MaterializedPressureTestIntake | null> {
  return withProjectStateWriteLock(tasksPathFor(input.memoryDir), async () => {
    const intake = await loadPressureTestIntake({
      memoryDir: input.memoryDir,
      intakeId: input.intake.id,
    })
    const result = await materializeCompletedPressureTestIntakeUnlocked({ ...input, intake })
    if (intake.handoff) {
      input.intake.handoff = { ...intake.handoff }
      input.intake.updatedAt = intake.updatedAt
    }
    return result
  })
}

async function materializeCompletedPressureTestIntakeUnlocked(input: {
  memoryDir: string
  intake: PressureTestIntake
  domain: string
  projectPath: string
}): Promise<MaterializedPressureTestIntake | null> {
  const { intake } = input
  if (intake.status !== 'complete' || intake.target.type === 'project') return null

  const queue = await readQueue(input.memoryDir)
  const requestId = `request-${intake.id}`
  const linkedTask = queue.tasks.find(task =>
    task.id === intake.handoff?.taskId || task.request?.id === requestId,
  )
  if (linkedTask) {
    if (intake.handoff?.taskId !== linkedTask.id) {
      intake.handoff = {
        status: 'materialized',
        taskId: linkedTask.id,
        materializedAt: new Date().toISOString(),
      }
      intake.updatedAt = intake.handoff.materializedAt
      await savePressureTestIntake(input.memoryDir, intake)
    }
    return { taskId: linkedTask.id }
  }

  const now = new Date().toISOString()
  const task = await createExploringTask({
    memoryDir: input.memoryDir,
    ask: [intake.rawRequest, '', renderPressureTestSpec(intake)].join('\n'),
    domain: input.domain,
    projectPath: input.projectPath,
    title: intake.target.title,
    request: {
      id: requestId,
      raw: intake.rawRequest,
      kind: 'task_spec',
      title: intake.target.title,
      routingSummary: 'Completed pressure-test intake',
      pressureTestRequired: true,
      createdAt: intake.createdAt,
    },
  })
  intake.handoff = {
    status: 'materialized',
    taskId: task.taskId,
    materializedAt: now,
  }
  intake.updatedAt = now
  await savePressureTestIntake(input.memoryDir, intake)
  return task
}

export async function createRoutedRequest(input: IntakeInput): Promise<RoutedRequestResult> {
  const routed = routeRequest({
    raw: input.ask,
    source: 'api',
    routeContext: { route: '/api/project/request' },
  })
  const action = routed.actions[0]
  if (action?.kind === 'pressure_test_intake') {
    const targetTitle = input.title?.trim() || action.intakeTarget.title
    const pressureTestIntake = await createPressureTestIntake({
      memoryDir: input.memoryDir,
      target: {
        type: action.intakeTarget.type === 'release' ? 'release' : 'feature',
        id: slugId(targetTitle),
        title: targetTitle,
      },
      rawRequest: input.ask,
    })
    const inspectedPressureTestIntake = await inspectPressureTestEvidence({
      memoryDir: input.memoryDir,
      intakeId: pressureTestIntake.id,
      projectPath: input.workspacePath ?? input.projectPath,
    })
    return {
      routedActions: routed.actions,
      routingDecision: routed.routingDecision,
      pressureTestIntake: inspectedPressureTestIntake,
    }
  }

  const task = await createExploringTask({
    ...input,
    title: input.title?.trim() || action?.label,
    ...(action ? {
      request: {
        id: `request-${Date.now().toString(36)}-${slugId(action.label)}`,
        raw: input.ask,
        kind: action.kind,
        title: action.label,
        routingSummary: routingSummaryForAction(action),
        pressureTestRequired: action.intakeTarget.pressureTestRequired,
        createdAt: new Date().toISOString(),
      },
    } : {}),
  })
  return {
    routedActions: routed.actions,
    routingDecision: routed.routingDecision,
    taskId: task.taskId,
    transcriptPath: task.transcriptPath,
  }
}

function compactStoredLabel(
  preferred: string | undefined,
  fallbackContent: string,
  fallbackLabel: string,
  max = 60,
): string {
  const preferredLabel = preferredStoredLabel(preferred)
  if (preferredLabel) return preferredLabel
  const fallbackCandidate = completeShortLabel(fallbackContent, max)
  return fallbackCandidate ?? fallbackLabel
}

function preferredStoredLabel(value: string | undefined): string | null {
  const firstLine = value?.split(/\n/).find(line => line.trim().length > 0)?.trim()
  if (!firstLine) return null
  const singleLine = firstLine.replace(/\s+/g, ' ').trim()
  if (!singleLine) return null
  return singleLine
}

function completeShortLabel(value: string | undefined, max = 60): string | null {
  const firstLine = value?.split(/\n/).find(line => line.trim().length > 0)?.trim()
  if (!firstLine) return null
  const singleLine = firstLine.replace(/\s+/g, ' ').trim()
  if (!singleLine || /\.\.\.$/.test(singleLine)) return null
  if (singleLine.length <= max) return singleLine
  const sentence = singleLine.match(/^(.+?[.!?])(?:\s|$)/)?.[1]?.trim()
  if (sentence && sentence.length <= max && !/\.\.\.$/.test(sentence)) return sentence
  if (/\s/.test(singleLine)) return singleLine
  return null
}

function slugId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'request'
}

function routingSummaryForAction(action: RoutedAction): string {
  switch (action.kind) {
    case 'task_spec':
      return 'Routed to Task Intake'
    case 'project_question':
      return 'Routed to Project Question'
    case 'settings_proposal':
      return 'Routed to Settings Proposal'
    case 'persona_practice_proposal':
      return 'Routed to Persona/Practice Proposal'
    case 'repair_triage':
      return 'Routed to Repair Triage'
    case 'clarification':
      return 'Routed to Clarification'
    case 'pressure_test_intake':
      return 'Routed to Pressure-Test Intake'
  }
}

export interface ApproveSpecInput {
  memoryDir: string
  taskId: string
  /** Optional note left on the task by the approving human */
  approvalNote?: string
  /** Explicit owner actor. Automation must never supply the delegated value. */
  approvalActor?: 'human' | 'codex_delegated_owner'
}

export interface ApproveSpecResult {
  success: boolean
  newStatus?: TaskStatus
  error?: string
}

/**
 * Mark a task's spec as approved. A one-task spec moves to `ready`; a spec
 * that names multiple child tasks creates them and keeps this task as `parent`.
 */
function isProjectRevisionRace(error: unknown): boolean {
  return error instanceof Error && /Stale (?:targeted )?project mutation|project state changed|expected (?:project )?revision/i.test(error.message)
}

function isMissingCurrentTaskEvidenceRevisionRace(error: unknown): boolean {
  return error instanceof Error && error.message === 'Normalized current task evidence is unavailable for promoted project'
}

export function readCurrentTaskEvidenceForSpecApproval(
  projectRoot: string,
  taskId: string,
  readCurrentEvidence = readProjectStateDatabaseTaskEvidenceCurrent,
) {
  try {
    return readCurrentEvidence(projectRoot, taskId)
  } catch (error) {
    if (!isMissingCurrentTaskEvidenceRevisionRace(error)) throw error
    return null
  }
}

export async function approveSpec(input: ApproveSpecInput): Promise<ApproveSpecResult> {
  // Approval changes task state and can add a release-local proof child. If a
  // release selection changes while that decision is in flight, discard the
  // old decision and derive both facts again from one current snapshot.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await approveSpecFromCurrentSnapshot(input)
    } catch (error) {
      if (attempt === 0 && isProjectRevisionRace(error)) continue
      throw error
    }
  }
  throw new Error('Spec approval could not obtain a stable project snapshot.')
}

async function approveSpecFromCurrentSnapshot(input: ApproveSpecInput): Promise<ApproveSpecResult> {
  const approvalActor = input.approvalActor ?? 'human'
  const projectRoot = inferProjectRootFromMemoryDir(input.memoryDir)
  const canonicalState = await readProjectCanonicalCurrentState(projectRoot)
  const currentQueue = {
    version: 1,
    ...canonicalState.rawQueue,
    tasks: canonicalState.tasks.map(task => ({ ...task })),
  }
  const parsedQueue = TaskQueue.parse(currentQueue)
  const queue = preserveRuntimeOverlayOnTaskQueueParse(currentQueue, parsedQueue)
  const task = queue.tasks.find((t) => t.id === input.taskId)
  if (!task) return { success: false, error: `Task ${input.taskId} not found` }
  if (task.status !== 'spec_review') {
    return {
      success: false,
      error: `Task ${input.taskId} is in status '${task.status}', expected 'spec_review'`,
    }
  }
  if (!task.structuredSpec) {
    return {
      success: false,
      error: `Task ${input.taskId} has no structured spec yet; rendered Markdown cannot be approved as the planning authority`,
    }
  }
  if (task.acceptanceCriteria.length === 0) {
    task.acceptanceCriteria = acceptanceCriteriaFromStructuredSpec(task.structuredSpec)
  }
  if (!task.productBrief?.userJob?.trim() || !task.productBrief?.successMetric?.trim()) {
    const derivedBrief = productBriefFromSpecCompletionBoundary(task)
    if (derivedBrief) {
      const candidateBrief = { ...derivedBrief, authoredAt: new Date().toISOString() }
      const grounding = validateProductBriefGrounding(task, candidateBrief)
      if (!grounding.ok) {
        return {
          success: false,
          error: `Product brief is not grounded in the visible task/source context: ${grounding.errors.join(' ')}`,
        }
      }
      task.productBrief = candidateBrief
    }
  }
  const specQuality = validateSpecCompletionBoundary(task)
  if (!specQuality.ok) {
    return {
      success: false,
      error: `Spec is not ready for approval: ${specQuality.errors.join(' ')}`,
    }
  }
  const currentTaskEvidence = readCurrentTaskEvidenceForSpecApproval(projectRoot, task.id)
  const ownerRevisionRequirements = ownerSpecRevisionRequirements(task, currentTaskEvidence)
  const specGrounding = validateSpecGrounding(task, {
    ownerRevisionInstructions: ownerRevisionRequirements.instructions,
    requiredAcceptanceCommands: ownerRevisionRequirements.requiredAcceptanceCommands,
  })
  if (!specGrounding.ok) {
    return {
      success: false,
      error: `Spec is not grounded in the typed task/source contract: ${specGrounding.errors.join(' ')}`,
    }
  }

  // The selected-release contract comes from the shared canonical boundary.
  // Approval must not choose a different membership interpretation than
  // release readiness, Start, or a task command mutation.
  const selectedReleaseTask = resolveSelectedReleaseTaskContract(canonicalState, task.id)
  const requiresScriptProof = selectedReleaseTask.requiresScriptProof &&
    !isProofSetupTask(task)
  let proofSetupTaskId: string | null = null
  const hasConcreteScriptProof = (task.proofPaths ?? []).some(path => (
    path &&
    typeof path === 'object' &&
    !Array.isArray(path) &&
    typeof (path as { command?: unknown }).command === 'string' &&
    isConcreteProjectProofCommand(String((path as { command: string }).command))
  )) || task.acceptanceCriteria.some(criterion => (
    typeof criterion.command === 'string' &&
    isConcreteProjectProofCommand(criterion.command)
  ))
  if (requiresScriptProof && !hasConcreteScriptProof) {
    const now = new Date().toISOString()
    const proofSetup = materializeProofSetupTask(queue, task, now, {
      releaseIds: selectedReleaseTask.release?.id ? [selectedReleaseTask.release.id] : [],
    })
    proofSetupTaskId = proofSetup.childTaskId
    task.proofPaths = replaceGenericProjectProofPathsWithSetup(task)
    task.acceptanceCriteria = task.acceptanceCriteria.map((criterion) => {
      if (
        typeof criterion.command !== 'string' ||
        isConcreteProjectProofCommand(criterion.command)
      ) return criterion
      const { command: _command, ...withoutCommand } = criterion
      return {
        ...withoutCommand,
        met: false,
        source: 'inferred' as const,
        verificationState: 'stale' as const,
        verificationSource: 'proof-recovery',
        staleReason: 'The saved workspace convention was not a task-specific proof command; linked proof-setup work must establish the current command.',
      }
    })
    task.notes.push({
      agentId: 'proof-recovery',
      role: 'coordinator',
      content: `Kept the approved product/spec boundary and linked verification work ${proofSetup.childTaskId} because the selected script-only release needs a concrete project proof command.`,
      timestamp: now,
    })
    queue.lastUpdated = now
  }

  const now = new Date().toISOString()
  const surfaceReviewPackets = buildSurfaceReviewPacketsForStructuredSpec({
    structuredSpec: task.structuredSpec,
    currentSpecRef: `task:${task.id}`,
    siblingSpecRefsBySurfaceId: siblingSpecRefsBySurfaceId(queue, task.id),
  })
  if (surfaceReviewPackets.length > 0) {
    task.contractSurfaceReviewPackets = surfaceReviewPackets
    task.notes.push({
      agentId: 'contract-surface',
      role: 'blueprint-review',
      content: `Generated ${surfaceReviewPackets.length} contract-surface review packet${surfaceReviewPackets.length === 1 ? '' : 's'} from structured spec deltas during approval.`,
      timestamp: now,
    })
  }
  applyTaskShaping(task, { now, recordNote: false })
  const duplicateSiblingSplit = splitRecommendationsDuplicateExistingSiblings(queue, task)
  // A nested task whose recommendations are already represented by siblings
  // must take the sibling path first. Treating those siblings as this task's
  // children would create a hierarchy cycle.
  const representedParentSplit = isMaterializableSplitAction(task.sizePlan?.action) &&
    !shouldKeepFixedSpecRunnable(task) &&
    !duplicateSiblingSplit
    ? settleMaterializedSplitReadiness(queue, task, now)
    : null
  let splitMaterialized = false
  let attemptedSplitMaterialization = false
  if (
    isMaterializableSplitAction(task.sizePlan?.action) &&
    !shouldKeepFixedSpecRunnable(task) &&
    !representedParentSplit &&
    !duplicateSiblingSplit
  ) {
    attemptedSplitMaterialization = true
    splitMaterialized = materializeSplitChildren(queue, task, now).status === 'materialized'
  } else {
    if (representedParentSplit) {
      // `settleMaterializedSplitReadiness` has already rewritten stale parent split metadata.
    } else if (duplicateSiblingSplit) {
      settleAlreadyRepresentedSplitRecommendations(queue, task, now)
    } else if (
      (task.sizePlan?.action === 'split_required' || task.sizePlan?.action === 'decompose_before_execution') &&
      shouldKeepFixedSpecRunnable(task)
    ) {
      task.sizePlan = {
        ...task.sizePlan,
        action: 'proceed_with_warning',
        recommendedChildren: [],
        reasons: [
          ...task.sizePlan.reasons,
          'Kept as runnable fixed-spec work because the accepted completion boundary says nothing must be split or blocked.',
        ],
      }
      if (task.decomposition?.action === 'split') {
        task.decomposition = {
          ...task.decomposition,
          action: 'keep',
          reasons: task.decomposition.reasons.filter(reason => reason.code !== 'too_broad'),
        }
      }
      // Sizing and readiness are one state transition. Reassess after settling
      // the explicit bounded-work decision so the release summary cannot say
      // "ready" while task detail still says "requires child work".
      task.taskReadiness = assessTaskReadiness(task, { now })
    }
    transitionTaskStatus({
      task,
      event: 'mark_ready',
      actor: approvalActor,
      evidenceRefs: ['task:approve-spec'],
      now,
    })
  }
  if (
    attemptedSplitMaterialization &&
    !splitMaterialized &&
    task.status === 'spec_review' &&
    (task.taskReadiness?.recommendation === 'ready' || task.taskReadiness?.recommendation === 'needs_research_spike')
  ) {
    settleBoundedChildContractWorkWithoutMaterializedChildren(task)
    transitionTaskStatus({
      task,
      event: 'mark_ready',
      actor: approvalActor,
      evidenceRefs: ['task:approve-spec'],
      now,
    })
  }
  if (
    task.status === 'spec_review' &&
    task.taskReadiness?.recommendation === 'needs_research_spike' &&
    task.sizePlan?.action !== 'split_required' &&
    task.sizePlan?.action !== 'decompose_before_execution'
  ) {
    settleBoundedChildContractWorkWithoutMaterializedChildren(task)
    transitionTaskStatus({
      task,
      event: 'mark_ready',
      actor: approvalActor,
      evidenceRefs: ['task:approve-spec:research-spike'],
      now,
    })
  }
  if (task.status === 'spec_review' && isBoundedChildContractWorkWithoutMaterializedChildren(task)) {
    settleBoundedChildContractWorkWithoutMaterializedChildren(task)
    transitionTaskStatus({
      task,
      event: 'mark_ready',
      actor: approvalActor,
      evidenceRefs: ['task:approve-spec:bounded-child-contract'],
      now,
    })
  }
  if (task.status === 'spec_review') {
    return {
      success: false,
      error: attemptedSplitMaterialization
        ? `Spec approval did not create runnable work for ${task.id}: Guildhall still needs child work but could not materialize any child tasks.`
        : `Spec approval did not advance ${task.id}; the task is still waiting for spec review.`,
    }
  }
  approveBriefWithSpec(task, now, approvalActor)
  task.updatedAt = now
  resolveSupersededEscalations(task, {
    now,
    resolvedBy: 'system',
    resolution:
      'Superseded by approved spec; the approved scope is enough for Guildhall to continue without owner re-intake.',
  })
  queue.lastUpdated = now

  if (input.approvalNote) {
    task.notes.push({
      agentId: approvalActor,
      role: 'approver',
      content: input.approvalNote,
      timestamp: now,
    })
  }

  await writeQueue(input.memoryDir, queue, {
    expectedQueueRevision: canonicalState.queueRevision,
    expectedProjectRevision: canonicalState.projectRevision,
  })
  await upsertTaskRuntimeState(projectRoot, task.id, {
    assignedTo: null,
    proofRecovery: undefined,
    updatedAt: now,
  })

  await appendExploringTranscript({
    memoryDir: input.memoryDir,
    taskId: task.id,
    role: 'system',
    content: input.approvalNote
      ? `Spec approved by human. Note: ${input.approvalNote}`
      : proofSetupTaskId
        ? `Spec approved. Guildhall kept the product boundary and created linked verification work ${proofSetupTaskId} to establish the selected release's concrete proof command.`
      : splitMaterialized
        ? 'Spec approved. Guildhall created the nested work and kept this item as the containing work.'
        : representedParentSplit
          ? 'Spec approved. Existing linked work already represents the split, so Guildhall kept this item as containing work.'
        : 'Spec approved by human. Task advanced to ready.',
  })

  return { success: true, newStatus: task.status }
}

function siblingSpecRefsBySurfaceId(queue: TaskQueue, currentTaskId: string): Record<string, string[]> {
  const refs: Record<string, string[]> = {}
  for (const candidate of queue.tasks) {
    if (candidate.id === currentTaskId) continue
    for (const delta of candidate.structuredSpec?.contractSurfaceDeltas ?? []) {
      if (!delta.surfaceId) continue
      refs[delta.surfaceId] ??= []
      refs[delta.surfaceId]!.push(`task:${candidate.id}`)
    }
  }
  return refs
}

function shouldKeepFixedSpecRunnable(task: Task): boolean {
  if (!hasExplicitNoSplitBoundary(task)) return false
  return task.acceptanceCriteria.length > 0
}

function isBoundedChildContractWorkWithoutMaterializedChildren(task: Task): boolean {
  if (!isMaterializableSplitAction(task.sizePlan?.action)) return false
  if ((task.sizePlan?.recommendedChildren?.length ?? 0) > 0) return false
  const hasContainingWork = Boolean(task.hierarchy?.parentId) || (task.delivery?.supports?.length ?? 0) > 0
  if (!hasContainingWork) return false
  return (
    (task.structuredSpec?.contractSurfaceDeltas?.length ?? 0) > 0 ||
    (task.contractSurfaceReviewPackets?.length ?? 0) > 0
  )
}

function settleBoundedChildContractWorkWithoutMaterializedChildren(task: Task): boolean {
  if (!isBoundedChildContractWorkWithoutMaterializedChildren(task) || !task.sizePlan) return false
  task.sizePlan = {
    ...task.sizePlan,
    action: 'proceed_with_warning',
    recommendedChildren: [],
    reasons: [
      ...task.sizePlan.reasons,
      'Kept as runnable bounded child contract work because no materializable split children were planned.',
    ],
  }
  if (task.taskReadiness?.recommendation === 'requires_child_work') {
    task.taskReadiness = {
      ...task.taskReadiness,
      recommendation: 'ready',
      summary: 'Task is ready for a focused worker pass.',
    }
  }
  if (task.decomposition?.action === 'split') {
    task.decomposition = {
      ...task.decomposition,
      action: 'keep',
      reasons: task.decomposition.reasons.filter(reason => reason.code !== 'too_broad'),
    }
  }
  return true
}

function approveBriefWithSpec(task: Task, now: string, approvalActor: 'human' | 'codex_delegated_owner'): void {
  const brief = task.productBrief
  if (!brief) return
  if (typeof brief.approvedAt !== 'string' || brief.approvedAt.trim().length === 0) {
    brief.approvedBy = approvalActor
    brief.approvedAt = now
  }
  if (brief.authoredBy === 'project-reintake') {
    brief.nonGoals = removeDraftApprovalWarnings(brief.nonGoals)
    brief.antiPatterns = removeDraftApprovalWarnings(brief.antiPatterns)
  }
}

function removeDraftApprovalWarnings(items: string[] | undefined): string[] | undefined {
  if (!Array.isArray(items)) return items
  return items.filter(item => !/treat this draft as approved until/i.test(item))
}

function splitRecommendationsDuplicateExistingSiblings(queue: TaskQueue, task: Task): boolean {
  const parentId = task.hierarchy?.parentId
  const recommendations = task.sizePlan?.recommendedChildren ?? []
  if (!parentId || recommendations.length === 0) return false
  const containingParent = queue.tasks.find(candidate => candidate.id === parentId)
  if (!containingParent) return false
  const existingIdentities = new Set(
    queue.tasks
      .filter(candidate => candidate.id === task.id || candidate.hierarchy?.parentId === parentId)
      .map(candidate => explicitTaskStructuralIdentity(candidate))
      .filter((identity): identity is string => identity !== null),
  )
  if (existingIdentities.size === 0) return false
  return recommendations.every(recommendation => {
    if (recommendation.createdTaskId && queue.tasks.some(candidate => candidate.id === recommendation.createdTaskId)) {
      return true
    }
    if (!recommendation.identity) return false
    return existingIdentities.has(
      `sourceIdentity:${splitChildSourceIdentity(containingParent, recommendation.identity)}`,
    )
  })
}

// ---------------------------------------------------------------------------
// Maintenance intake: a human-filed bug report becomes a `proposed` task.
//
// Distinct from createExploringTask: the reporter already knows what's broken,
// so we skip the conversational intake and drop the task straight into the
// queue as `proposed` with priority 'high'. The coordinator picks it up on the
// next tick and routes it like any other proposed work.
// ---------------------------------------------------------------------------

export interface BugReportInput {
  memoryDir: string
  projectPath: string
  title: string
  body: string
  stackTrace?: string
  env?: Record<string, string>
  domain: string
  /** Default 'high'. Set to 'normal' for minor bugs, 'critical' for outages. */
  priority?: 'low' | 'normal' | 'high' | 'critical'
}

export interface BugReportResult {
  taskId: string
}

/**
 * Extract the first file path from a stack trace. Matches the common Node/JS
 * frame formats: `at fn (/path/to/file.ts:12:3)` and `at /path/to/file.ts:12:3`.
 * Returns undefined when nothing file-shaped appears.
 */
export function parseStackTraceTopFile(stack: string): string | undefined {
  const lines = stack.split(/\r?\n/)
  for (const line of lines) {
    const paren = line.match(/\(([^()]+?):\d+(?::\d+)?\)/)
    if (paren) return paren[1]
    const bare = line.match(/\bat\s+([^\s()]+?):\d+(?::\d+)?/)
    if (bare) return bare[1]
  }
  return undefined
}

export async function createBugReportTask(input: BugReportInput): Promise<BugReportResult> {
  const queue = await readQueue(input.memoryDir)
  const id = nextTaskId(queue)
  const now = new Date().toISOString()

  const title = `Bug: ${compactStoredLabel(
    input.title.replace(/^Bug:\s*/i, ''),
    input.body,
    'Bug report',
  )}`

  const description = [
    input.body.trim(),
    input.stackTrace
      ? `\n**Stack trace:**\n\n\`\`\`\n${input.stackTrace.trim()}\n\`\`\``
      : '',
    input.env && Object.keys(input.env).length > 0
      ? `\n**Environment:**\n${Object.entries(input.env).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n')

  const task: Task = {
    id,
    title,
    description,
    domain: input.domain,
    projectPath: input.projectPath,
    references: [],
    sourceClaims: [],
    status: 'proposed',
    priority: input.priority ?? 'high',
    dependsOn: [],
    outOfScope: [],
    acceptanceCriteria: [],
    notes: [
      {
        agentId: 'human',
        role: 'reporter',
        content: 'Filed via bug-report intake.',
        timestamp: now,
      },
    ],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: now,
    updatedAt: now,
  }

  queue.tasks.push(task)
  queue.lastUpdated = now
  await writeQueue(input.memoryDir, queue)

  return { taskId: id }
}

export interface ResumeExploringInput {
  memoryDir: string
  taskId: string
  /** Optional — if the task is currently blocked on an escalation, resolve it */
  resolveEscalationId?: string
  resolution?: string
  /** The next human message to inject into the transcript */
  message?: string
  /**
   * For an already-dispatched task, a Thread reply is a steering note for the
   * current worker/reviewer. It should not reopen spec intake.
   */
  preserveStatus?: boolean | undefined
  /** Typed document boundary for an explicit owner revision request. */
  revisionTarget?: 'brief' | 'spec' | undefined
}

const OWNER_COMMAND_PREFIX = /^(?:pnpm|npm|npx|yarn|bun|node|python(?:3)?|pytest|vitest|playwright|cargo|rustc|git)\b/
const OWNER_INLINE_PACKAGE_COMMAND = /\b((?:pnpm|yarn|bun)\s+(?:run\s+)?[A-Za-z0-9@._:/-]+|npm\s+(?:run\s+)?[A-Za-z0-9@._:/-]+)\b/gi
const OWNER_INLINE_CARGO_COMMAND = /\b(cargo\s+(?:test|check|build|clippy|fmt)(?:\s+(?!(?:and|then|but)\b)[A-Za-z0-9@._:/=+-]+)*)/gi

export function extractOwnerRequiredAcceptanceCommands(message: string): string[] {
  const quoted = [...message.matchAll(/`([^`\n]+)`/g)]
    .map(match => match[1]!.trim())
    .filter(value => OWNER_COMMAND_PREFIX.test(value))
  const inlinePackageCommands = [...message.matchAll(OWNER_INLINE_PACKAGE_COMMAND)]
    .map(match => match[1]!.trim())
  const inlineCargoCommands = [...message.matchAll(OWNER_INLINE_CARGO_COMMAND)]
    .map(match => match[1]!.trim().replace(/[.,;:]+$/, ''))
  return [...new Set([...quoted, ...inlinePackageCommands, ...inlineCargoCommands])]
}

function ownerRevisionEvent(input: Pick<ResumeExploringInput, 'message' | 'revisionTarget'>) {
  if (!input.revisionTarget) return undefined
  const requiredAcceptanceCommands = input.revisionTarget === 'spec' && input.message
    ? extractOwnerRequiredAcceptanceCommands(input.message)
    : []
  return {
    event: 'document_revision_requested' as const,
    target: input.revisionTarget,
    ...(requiredAcceptanceCommands.length > 0 ? { requiredAcceptanceCommands } : {}),
  }
}

export interface RerunTaskStageInput {
  memoryDir: string
  taskId: string
  stage: 'spec' | 'review' | 'gate'
  /** Records a delegated owner request without granting the runtime approval authority. */
  actor?: 'human' | 'codex_delegated_owner'
  /** Reopen a stale current plan for a source-backed spec re-intake. */
  recoveryReason?: string
  /** Only proof recovery writes the proof-specific runtime marker. */
  recoveryKind?: 'proof' | 'blueprint'
}

export interface RerunTaskStageResult {
  success: boolean
  newStatus?: TaskStatus
  error?: string
}

export interface ShapeImportDraftInput {
  memoryDir: string
  taskId: string
}

export interface ShapeImportDraftResult {
  success: boolean
  newStatus?: TaskStatus
  error?: string
}

export interface ReframeTaskInput {
  memoryDir: string
  taskId: string
  reason?: string | undefined
  /** Records a delegated owner request without granting the runtime approval authority. */
  actor?: 'human' | 'codex_delegated_owner'
  /** Explicitly marks a proof reframe; never infer this from reason prose. */
  recoveryKind?: 'proof'
}

export interface ReframeTaskResult {
  success: boolean
  newStatus?: TaskStatus
  error?: string
}

export interface EnrichTaskInput {
  memoryDir: string
  taskId: string
  mode?: 'split' | 'checklist' | 'general'
  instruction?: string
}

/**
 * Resume an exploring-phase conversation: optionally resolve a pending
 * escalation, optionally append a new user message to the transcript, and
 * ensure the task is back in `exploring` so the Spec Agent will pick it up
 * again.
 */
export async function resumeExploring(input: ResumeExploringInput): Promise<{ success: boolean; error?: string }> {
  let queue = await readQueue(input.memoryDir)
  let task = queue.tasks.find((t) => t.id === input.taskId)
  if (!task) return { success: false, error: `Task ${input.taskId} not found` }
  if (task.status === 'done' || task.status === 'shelved') {
    return { success: false, error: `Task ${input.taskId} is ${task.status}` }
  }

  if (input.resolveEscalationId) {
    const result = await resolveEscalation({
      tasksPath: tasksPathFor(input.memoryDir),
      progressPath: progressPathFor(input.memoryDir),
      taskId: task.id,
      escalationId: input.resolveEscalationId,
      resolution: input.resolution ?? 'Resolved during intake resume',
      resolvedBy: 'human',
      nextStatus: 'exploring',
    })
    if (!result.success) return { success: false, error: result.error ?? 'unknown' }
    queue = await readQueue(input.memoryDir)
    task = queue.tasks.find((t) => t.id === input.taskId)
    if (!task) return { success: false, error: `Task ${input.taskId} not found after escalation resolution` }
  }

  const projectRoot = inferProjectRootFromMemoryDir(input.memoryDir)
  const tasksPath = tasksPathFor(input.memoryDir)
  const promotedAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'

  if (input.message && !promotedAuthority) {
    task.notes.push({
      agentId: 'human',
      role: 'human',
      content: input.message,
      timestamp: new Date().toISOString(),
      ...(ownerRevisionEvent(input) ? { structured: ownerRevisionEvent(input) } : {}),
    })
  }

  if (input.message && input.preserveStatus) {
    await appendExploringTranscript({
      memoryDir: input.memoryDir,
      taskId: task.id,
      role: 'user',
      content: input.message,
    })
  } else if (input.message) {
    await appendExploringTranscript({
      memoryDir: input.memoryDir,
      taskId: task.id,
      role: 'user',
      content: input.message,
    })
  }

  if (input.message && promotedAuthority) {
    const now = new Date().toISOString()
    const promoted = writePromotedTaskDetailMutation(tasksPath, task.id, {
      projectId: path.basename(projectRoot),
      projectRoot,
      mutate: current => {
        if (!input.preserveStatus && current.status !== 'blocked') current.status = 'exploring'
        if (input.revisionTarget === 'brief') delete current.productBrief
        if (input.revisionTarget === 'spec') {
          resetCurrentPlanForRevision(current as unknown as Task, { clearEvidence: false })
        }
        current.updatedAt = now
        return current
      },
    })
    if (!promoted) return { success: false, error: `Task ${input.taskId} could not be updated in the current-state database` }
    await appendTaskEvidence(projectRoot, task.id, {
      id: `note-${task.id}-${now.replace(/[^0-9A-Za-z]/g, '')}-resume`,
      kind: 'note',
      recordedAt: now,
      payload: {
        agentId: 'human',
        role: 'human',
        content: input.message,
        timestamp: now,
        ...(ownerRevisionEvent(input) ? { structured: ownerRevisionEvent(input) } : {}),
      },
    })
  } else if (input.message) {
    if (!input.preserveStatus && task.status !== 'blocked') task.status = 'exploring'
    if (input.revisionTarget === 'brief') delete task.productBrief
    if (input.revisionTarget === 'spec') {
      resetCurrentPlanForRevision(task, { clearEvidence: false })
    }
    task.updatedAt = new Date().toISOString()
    queue.lastUpdated = task.updatedAt
    await writeQueue(input.memoryDir, queue)
  }

  return { success: true }
}

export async function reframeTask(input: ReframeTaskInput): Promise<ReframeTaskResult> {
  const queue = await readQueue(input.memoryDir)
  const task = queue.tasks.find((t) => t.id === input.taskId)
  if (!task) return { success: false, error: `Task ${input.taskId} not found` }
  const projectRoot = inferProjectRootFromMemoryDir(input.memoryDir)
  // Reframe is an explicit corrective action, so it may inspect the bounded
  // task-detail history needed to distinguish a current completion from one
  // already superseded by a fresh lifecycle.
  const effectiveTask = await buildEffectiveTask(projectRoot, task, { evidence: 'full' }) as unknown as Task
  // Promoted reads keep resolved escalation history in the evidence detail
  // store rather than on the compact task definition. Reframe must resolve
  // that canonical history, not silently operate on an overlay-free row.
  if (Array.isArray(effectiveTask.escalations)) {
    task.escalations = [...effectiveTask.escalations]
  }
  const historicalCompletionAlreadyReopened = task.status === 'done' &&
    effectiveTask.doneSummaryBundle?.status === 'reopened'
  if ((task.status === 'done' && !historicalCompletionAlreadyReopened) || task.status === 'shelved' || task.status === 'pending_pr') {
    return { success: false, error: `Task ${input.taskId} is ${task.status}` }
  }
  if (
    (task.status === 'in_progress' || task.status === 'review' || task.status === 'gate_check') &&
    hasDurableImplementationProgress(effectiveTask)
  ) {
    return {
      success: false,
      error: `Task ${input.taskId} already started implementation; pause or finish the current work before reframing so work traces stay connected.`,
    }
  }

  const now = new Date().toISOString()
  const oldStatus = task.status
  const oldTitle = task.title
  const reason = input.reason?.trim()
  const actor = input.actor === 'codex_delegated_owner' ? 'codex_delegated_owner' : 'human'
  const reframeRequest = [
    'Reframe this existing task from the current project memory and source state.',
    '',
    'The current task is too hard for a person to understand or act on. Rebuild the task brief/spec in plain language before any implementation work continues.',
    '',
    'Use the current project memory, resolved user answers, source notes, current code state, and the task origin. Do not preserve stale recovery wording, old imported-roadmap fragments, duplicate questions, or internal process terms as the user-facing explanation.',
    '',
    'The reframed task must answer these questions in normal language:',
    '- What are we trying to ship or decide?',
    '- Why does it matter?',
    '- What is the next concrete step?',
    '- If user input is needed, what exact decision is needed, what are the choices, and how should the user answer?',
    '- What kind of request is this: policy/spec, implementation, question/research, or ambiguous?',
    '- What components fit together: policy decision, spec, implementation surfaces, data/API/docs, release, and verification?',
    '- If the request is bigger than one worker/review loop, turn it into a parent feature/epic with linked child tasks instead of one oversized task.',
    '',
    'Write new acceptance criteria only after the task is understandable. Keep provenance in notes/history; do not make the user read raw checkpoint or handoff packets to understand the work.',
    ...(reason ? ['', `User note: ${reason}`] : []),
  ].join('\n')

  const notes = Array.isArray(task.notes) ? [...task.notes] : []
  await cancelOwnerInputRequestsForTask({
    projectRoot,
    taskId: task.id,
    now,
    ...(reason ? { reason } : {}),
  })
  if (task.status === 'in_progress' || task.status === 'review' || task.status === 'gate_check') {
    notes.push({
      agentId: 'system',
      role: 'system',
      content: 'Cleared an active agent claim with no durable worker checkpoint, artifact, handoff, or terminal output so this task can be reframed before implementation continues.',
      timestamp: now,
    })
  }
  notes.push({
    agentId: actor,
    role: actor,
    content: reason
      ? `Asked to reframe this task. Reason: ${reason}`
      : 'Asked to reframe this task from current project memory.',
    structured: {
      event: 'reframe_requested',
      source: actor,
    },
    timestamp: now,
  })

  if (Array.isArray(task.escalations)) {
    task.escalations = task.escalations.map(escalation => (
      escalation.resolvedAt
        ? escalation
        : {
            ...escalation,
            resolvedAt: now,
            resolvedBy: actor,
            resolution: 'Superseded by a task reframe request.',
          }
    ))
  }

  delete task.blockReason
  delete task.recoveryCode
  // Reframing begins a new current lifecycle. Historical completion stays in
  // the evidence ledger, but it must not settle the newly reopened task.
  if (task.doneSummaryBundle?.status === 'done') {
    task.doneSummaryBundle = {
      ...task.doneSummaryBundle,
      status: 'reopened',
      reopenedAt: now,
      reopenReason: 'A task reframe requested a fresh source-backed plan.',
      createdAt: now,
      createdBy: 'reframe-task',
    }
  }
  task.completedAt = undefined
  task.status = 'exploring'
  task.assignedTo = 'spec-agent'
  task.productBrief = undefined
  task.spec = undefined
  task.acceptanceCriteria = []
  // Reframing is a new planning pass. Do not let readiness, sizing, review,
  // or decomposition decisions from the discarded frame make the fresh
  // exploring task look runnable before the spec lane has rebuilt it.
  task.structuredSpec = undefined
  task.contractSurfaceReviewPackets = undefined
  task.acceptanceCriteriaProofState = undefined
  task.taskReadiness = undefined
  task.reviewRisk = undefined
  task.definitionOfDone = undefined
  task.blockerPlans = undefined
  task.contextBudget = undefined
  task.decomposition = undefined
  task.coordinatorReflections = undefined
  task.workUnitAnalysis = undefined
  task.sizePlan = undefined
  task.taskKind = undefined
  task.notes = notes
  task.updatedAt = now
  queue.lastUpdated = now

  await replaceExploringTranscript({
    memoryDir: input.memoryDir,
    taskId: task.id,
    role: 'user',
    content: reframeRequest,
  })
  await writeQueue(input.memoryDir, queue)

  notes.push({
    agentId: 'system',
    role: 'system',
    content: `Reframe requested for "${oldTitle}" from ${oldStatus}. The task will be rebuilt in plain language before continuing.`,
    timestamp: now,
  })
  await writeQueue(input.memoryDir, queue)

  // The promoted queue writer rebuilds runtime overlays from the task it
  // receives. Attach the recovery contract after the final definition write
  // so this reframe cannot immediately erase its own proof marker.
  await upsertTaskRuntimeState(projectRoot, task.id, {
    assignedTo: 'spec-agent',
    currentLifecycle: {
      reopenedAt: now,
      status: 'exploring',
      source: 'rerun_spec',
    },
    ...(input.recoveryKind === 'proof'
      ? {
          proofRecovery: {
            reopenedAt: now,
            kind: 'proof' as const,
            reason: reason || 'The current proof plan was cleared for a fresh source-backed spec pass.',
          },
        }
      : {}),
    updatedAt: now,
  })

  return { success: true, newStatus: 'exploring' }
}

export async function enrichTask(input: EnrichTaskInput): Promise<ReframeTaskResult> {
  const queue = await readQueue(input.memoryDir)
  const task = queue.tasks.find((t) => t.id === input.taskId)
  if (!task) return { success: false, error: `Task ${input.taskId} not found` }
  const projectRoot = inferProjectRootFromMemoryDir(input.memoryDir)
  const effectiveTask = await buildEffectiveTask(projectRoot, task) as unknown as Task
  if (Array.isArray(effectiveTask.escalations)) task.escalations = [...effectiveTask.escalations]
  if (task.status === 'done' || task.status === 'shelved' || task.status === 'pending_pr') {
    return { success: false, error: `Task ${input.taskId} is ${task.status}` }
  }
  if (task.status === 'in_progress' || task.status === 'review' || task.status === 'gate_check') {
    return {
      success: false,
      error: `Task ${input.taskId} already started implementation; pause or finish the current work before enriching so work traces stay connected.`,
    }
  }

  const now = new Date().toISOString()
  const oldStatus = task.status
  const mode = input.mode ?? 'general'
  const instruction = input.instruction?.trim()
  const modeInstruction = mode === 'split'
    ? 'Enrich this task by deciding whether it should become containing work with smaller linked nested work. Preserve useful existing brief/spec context, but split external setup, owner-only work, implementation, and live verification into separate nested work items when they have different owners or verification boundaries.'
    : mode === 'checklist'
      ? 'Enrich this task by adding a concrete external blocker checklist and any missing owner setup steps. Preserve useful existing brief/spec context.'
      : 'Enrich this task with missing context, clearer next steps, and any structured checklist or nested work needed before implementation continues. Preserve useful existing brief/spec context.'
  const enrichmentRequest = [
    modeInstruction,
    '',
    'Do not treat enrichment as proof that the old task was wrong. Keep valid context. Add the missing structure the user needs to make progress.',
    '',
    'If the work should be split, keep the current item as the containing work and draft linked nested work with clear owners, dependencies, and verification boundaries.',
    'If the blocker needs external setup, produce the external checklist as concrete steps the owner can complete before Guildhall resumes verification.',
    ...(instruction ? ['', `User note: ${instruction}`] : []),
  ].join('\n')

  const notes = Array.isArray(task.notes) ? [...task.notes] : []
  notes.push({
    agentId: 'human',
    role: 'human',
    content: instruction
      ? `Asked to enrich this task (${mode}). Note: ${instruction}`
      : `Asked to enrich this task (${mode}).`,
    timestamp: now,
  })

  if (Array.isArray(task.escalations)) {
    task.escalations = task.escalations.map(escalation => (
      escalation.resolvedAt
        ? escalation
        : {
            ...escalation,
            resolvedAt: now,
            resolvedBy: 'human',
            resolution: 'Superseded by a task enrichment request.',
          }
    ))
  }

  delete task.blockReason
  task.status = 'exploring'
  task.assignedTo = 'spec-agent'
  task.notes = notes
  task.updatedAt = now
  queue.lastUpdated = now

  await appendExploringTranscript({
    memoryDir: input.memoryDir,
    taskId: task.id,
    role: 'user',
    content: enrichmentRequest,
  })
  await writeQueue(input.memoryDir, queue)

  notes.push({
    agentId: 'system',
    role: 'system',
    content: `Enrichment requested from ${oldStatus}. Missing structure will be added before continuing.`,
    timestamp: now,
  })
  await writeQueue(input.memoryDir, queue)

  return { success: true, newStatus: 'exploring' }
}

export async function shapeImportDraft(
  input: ShapeImportDraftInput,
): Promise<ShapeImportDraftResult> {
  const queue = await readQueue(input.memoryDir)
  const task = queue.tasks.find((t) => t.id === input.taskId)
  if (!task) return { success: false, error: `Task ${input.taskId} not found` }
  if (task.status === 'done' || task.status === 'shelved' || task.status === 'blocked') {
    return { success: false, error: `Task ${input.taskId} is ${task.status}` }
  }
  const hasShapingBlocker = taskShapingBlockers(task).length > 0 || importedTaskNeedsSourceRecovery(task)
  if (task.status !== 'import_draft' && !(task.status === 'exploring' && hasShapingBlocker)) {
    return {
      success: false,
      error: `Task ${input.taskId} is in status '${task.status}', expected 'import_draft'`,
    }
  }

  const duplicateOf = findFinishedDuplicate(queue.tasks, task)
  if (duplicateOf) {
    const now = new Date().toISOString()
    task.status = 'shelved'
    task.assignedTo = null
    task.updatedAt = now
    task.shelveReason = {
      code: 'duplicate',
      rejectedBy: 'system:import-draft-dedupe',
      rejectedAt: now,
      detail: `Duplicate of ${duplicateOf.id} (${duplicateOf.title}).`,
    }
    task.notes.push({
      agentId: 'system',
      role: 'system',
      content: `Duplicate of ${duplicateOf.id} (${duplicateOf.title}). Guildhall shelved this imported draft instead of reshaping it again.`,
      timestamp: now,
    })
    queue.lastUpdated = now
    await writeQueue(input.memoryDir, queue)
    return { success: true, newStatus: 'shelved' }
  }

  if (task.status === 'exploring') {
    await continueImportedSourceRecovery(task, input.memoryDir)
  } else {
    await promoteImportDraftToExploring(task, input.memoryDir)
  }
  queue.lastUpdated = task.updatedAt ?? new Date().toISOString()
  await writeQueue(input.memoryDir, queue)
  return { success: true, newStatus: 'exploring' }
}

function findFinishedDuplicate(tasks: TaskQueue['tasks'], task: Task): { id: string; title: string } | null {
  const identity = explicitTaskStructuralIdentity(task)
  if (!identity) return null
  for (const candidate of tasks) {
    if (candidate.id === task.id) continue
    if (candidate.status !== 'done' && candidate.status !== 'shelved') continue
    if (candidate.domain !== task.domain) continue
    if (candidate.projectPath !== task.projectPath) continue
    if (explicitTaskStructuralIdentity(candidate) === identity) {
      return { id: candidate.id, title: candidate.title ?? candidate.id }
    }
  }
  return null
}

function detachStaleShelvedReverseChildren(queue: TaskQueue, task: Task, now: string): void {
  if ((task.hierarchy?.childIds ?? []).length > 0) return
  for (const candidate of queue.tasks) {
    if (candidate.hierarchy?.parentId !== task.id || candidate.status !== 'shelved') continue
    candidate.hierarchy = {
      ...candidate.hierarchy,
      parentId: undefined,
      order: candidate.hierarchy.order ?? 0,
    }
    candidate.updatedAt = now
  }
}

export async function rerunTaskStage(
  input: RerunTaskStageInput,
): Promise<RerunTaskStageResult> {
  const queue = await readQueue(input.memoryDir)
  const projectRoot = inferProjectRootFromMemoryDir(input.memoryDir)
  const task = queue.tasks.find((t) => t.id === input.taskId)
  if (!task) return { success: false, error: `Task ${input.taskId} not found` }
  if (task.status === 'shelved' || task.status === 'blocked') {
    return { success: false, error: `Task ${input.taskId} is ${task.status}` }
  }
  if (task.status === 'done' && input.stage !== 'spec') {
    return { success: false, error: `Task ${input.taskId} is done; rerun the spec stage before review or gate` }
  }

  const now = new Date().toISOString()
  const actor = input.actor === 'codex_delegated_owner' ? 'codex_delegated_owner' : 'human'

  if (input.stage === 'spec') {
    if (task.id === 'task-meta-intake' || task.id === 'task-workspace-import') {
      return {
        success: false,
        error: 'Reserved setup tasks have their own rerun controls.',
      }
    }
    // A completion summary is historical evidence, not a second authority for
    // the task's current lifecycle. Record that the summary was superseded so
    // the coordinator cannot re-close this task before the fresh spec pass.
    if (task.doneSummaryBundle?.status === 'done') {
      task.doneSummaryBundle = {
        ...task.doneSummaryBundle,
        status: 'reopened',
        reopenedAt: now,
        reopenReason: 'A fresh spec pass was requested from current project reality.',
        createdAt: now,
        createdBy: 'rerun-stage',
      }
    }
    // A fresh spec pass always starts a new current lifecycle. Clear any
    // stale terminal index value even when an earlier reopen already changed
    // the summary to `reopened`; the old completion remains in evidence.
    task.completedAt = undefined
    task.status = 'exploring'
    task.assignedTo = null
    // A fresh spec pass always replaces the old executable contract. The
    // shared reset preserves a bounded proof-setup blueprint in place, while
    // a blueprint recovery alone retains the approved product brief.
    resetCurrentPlanForProofRecovery(task, {
      reason:
        input.recoveryReason?.trim() ||
        'The current plan was cleared for a fresh source-backed spec pass.',
      now,
      agentId: actor,
      role: actor,
      ...(input.recoveryKind === 'blueprint' ? { preserveProductBrief: true } : {}),
    })
    detachStaleShelvedReverseChildren(queue, task, now)
    task.updatedAt = now
    queue.lastUpdated = now
    task.notes.push({
      agentId: actor,
      role: actor,
      content: 'A delegated owner requested a fresh spec pass from the current project reality.',
      structured: {
        event: 'reframe_requested',
        source: actor,
      },
      timestamp: now,
    })
    await writeQueue(input.memoryDir, queue)
    await appendExploringTranscript({
      memoryDir: input.memoryDir,
      taskId: task.id,
      role: 'system',
      content:
        'A delegated owner requested a fresh spec pass. Any earlier spec approval in this history is superseded and is historical evidence only. Re-read the task, submit a new current brief/spec from project reality, and ask only the minimum clarifying questions needed.',
    })
    await upsertTaskRuntimeState(projectRoot, task.id, {
      assignedTo: null,
      currentLifecycle: {
        reopenedAt: now,
        status: 'exploring',
        source: 'rerun_spec',
      },
      ...(input.recoveryKind === 'proof' ? {
        proofRecovery: {
          reopenedAt: now,
          kind: 'proof',
          reason:
            input.recoveryReason?.trim() ||
            'The current proof plan was cleared for a fresh source-backed spec pass.',
        },
      } : {}),
      updatedAt: now,
    })
    return { success: true, newStatus: 'exploring' }
  }

  if (input.stage === 'review') {
    if (!['review', 'gate_check'].includes(task.status)) {
      return {
        success: false,
        error: `Task ${input.taskId} is in status '${task.status}', expected 'review' or 'gate_check'`,
      }
    }
    transitionTaskStatus({
      task,
      event: 'restart_review',
      actor: 'human',
      evidenceRefs: ['task:human-restart-review'],
      now,
    })
    task.assignedTo = 'reviewer-agent'
    task.updatedAt = now
    queue.lastUpdated = now
    task.notes.push({
      agentId: 'human',
      role: 'human',
      content: 'Human requested a fresh review pass.',
      timestamp: now,
    })
    await writeQueue(input.memoryDir, queue)
    return { success: true, newStatus: 'review' }
  }

  if (task.status !== 'gate_check') {
    return {
      success: false,
      error: `Task ${input.taskId} is in status '${task.status}', expected 'gate_check'`,
    }
  }
  task.status = 'gate_check'
  task.assignedTo = 'gate-checker-agent'
  task.updatedAt = now
  queue.lastUpdated = now
  task.notes.push({
    agentId: 'human',
    role: 'human',
    content: 'Human requested a fresh gate-check pass.',
    timestamp: now,
  })
  await writeQueue(input.memoryDir, queue)
  return { success: true, newStatus: 'gate_check' }
}
