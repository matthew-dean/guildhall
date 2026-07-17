import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import fs from 'node:fs/promises'
import path from 'node:path'
import { TaskQueue, type RequestIntake, type Task, type TaskRequest, type TaskStatus } from '@guildhall/core'
import {
  atomicWriteText,
  appendTaskEvidence,
  inferProjectRootFromMemoryDir,
  projectStatePathFromMemoryDir,
  readProjectStateDatabaseQueueRevision,
  upsertTaskRuntimeState,
  upsertTaskWorkspaceState,
} from '@guildhall/sessions'
import {
  appendExploringTranscript,
  isMaterializableSplitAction,
  materializeSplitChildren,
  resolveEscalation,
  resolveSupersededEscalations,
  settleAlreadyRepresentedSplitRecommendations,
  settleMaterializedSplitReadiness,
} from '@guildhall/tools'
import {
  continueImportedSourceRecovery,
  importedTaskNeedsSourceRecovery,
  normalizeImportedDraftTask,
  promoteImportDraftToExploring,
} from './import-drafts.js'
import {
  createPressureTestIntake,
  inspectPressureTestEvidence,
  type PressureTestIntake,
} from './pressure-test-intake.js'
import { analyzeRequestIntake, type RequestIntakeOwnerInput } from './request-intake.js'
import { routeRequest, type RouteRequestResult, type RoutedAction } from './request-routing.js'
import {
  extractAcceptanceCriteriaFromSpec,
  productBriefFromSpecCompletionBoundary,
  validateSpecCompletionBoundary,
} from './spec-quality.js'
import { taskShapingBlockers } from '../shared/task-shaping-blockers.js'
import { applyTaskShaping } from './task-decomposition.js'
import { transitionTaskStatus } from './task-transition.js'
import { createOwnerInputRequest } from './owner-input-store.js'
import { buildSurfaceReviewPacketsForStructuredSpec } from './contract-surfaces.js'
import { buildEffectiveTask } from './effective-task.js'
import {
  sanitizeTaskQueueForProjectWrite,
  readProjectStateAuthorityAtBoundary,
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
  for (const task of queue.tasks) normalizeImportedDraftTask(task)
  return queue
}

async function writeQueue(memoryDir: string, queue: TaskQueue): Promise<void> {
  const tasksPath = tasksPathFor(memoryDir)
  const projectRoot = inferProjectRootFromMemoryDir(memoryDir)
  const expectedQueueRevision = readProjectStateDatabaseQueueRevision(tasksPath)
  await writeProjectTaskQueueAtCurrentStateBoundary(tasksPath, queue, {
    projectId: path.basename(projectRoot),
    projectRoot,
    ...(expectedQueueRevision !== null ? { expectedQueueRevision } : {}),
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

  const task: Task = {
    id,
    title,
    description: input.ask,
    domain: input.domain,
    projectPath: input.projectPath,
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

export async function createRoutedRequest(input: IntakeInput): Promise<RoutedRequestResult> {
  const routed = routeRequest({
    raw: input.ask,
    source: 'api',
    routeContext: { route: '/api/project/request' },
  })
  const action = routed.actions[0]
  if (action?.kind === 'pressure_test_intake') {
    const pressureTestIntake = await createPressureTestIntake({
      memoryDir: input.memoryDir,
      target: {
        type: action.intakeTarget.type === 'release' ? 'release' : 'feature',
        id: slugId(action.intakeTarget.title),
        title: action.intakeTarget.title,
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
export async function approveSpec(input: ApproveSpecInput): Promise<ApproveSpecResult> {
  const queue = await readQueue(input.memoryDir)
  const task = queue.tasks.find((t) => t.id === input.taskId)
  if (!task) return { success: false, error: `Task ${input.taskId} not found` }
  if (task.status !== 'spec_review') {
    return {
      success: false,
      error: `Task ${input.taskId} is in status '${task.status}', expected 'spec_review'`,
    }
  }
  if (!task.spec || task.spec.trim().length === 0) {
    return {
      success: false,
      error: `Task ${input.taskId} has no spec yet; cannot approve`,
    }
  }
  backfillAcceptanceCriteriaFromSpec(task)
  if (!task.productBrief?.userJob?.trim() || !task.productBrief?.successMetric?.trim()) {
    const derivedBrief = productBriefFromSpecCompletionBoundary(task.spec)
    if (derivedBrief) {
      task.productBrief = {
        ...derivedBrief,
        authoredAt: new Date().toISOString(),
      }
    }
  }
  const specQuality = validateSpecCompletionBoundary(task)
  if (!specQuality.ok) {
    return {
      success: false,
      error: `Spec is not ready for approval: ${specQuality.errors.join(' ')}`,
    }
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
  const representedParentSplit = isMaterializableSplitAction(task.sizePlan?.action) && !shouldKeepFixedSpecRunnable(task)
    ? settleMaterializedSplitReadiness(queue, task, now)
    : null
  const duplicateSiblingSplit = splitRecommendationsDuplicateExistingSiblings(queue, task)
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
    }
    transitionTaskStatus({
      task,
      event: 'mark_ready',
      actor: 'human',
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
      actor: 'human',
      evidenceRefs: ['task:approve-spec'],
      now,
    })
  }
  if (task.status === 'spec_review' && task.taskReadiness?.recommendation === 'needs_research_spike') {
    settleBoundedChildContractWorkWithoutMaterializedChildren(task)
    transitionTaskStatus({
      task,
      event: 'mark_ready',
      actor: 'human',
      evidenceRefs: ['task:approve-spec:research-spike'],
      now,
    })
  }
  if (task.status === 'spec_review' && isBoundedChildContractWorkWithoutMaterializedChildren(task)) {
    settleBoundedChildContractWorkWithoutMaterializedChildren(task)
    transitionTaskStatus({
      task,
      event: 'mark_ready',
      actor: 'human',
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
  approveReintakeBriefWithSpec(task, now)
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
      agentId: 'human',
      role: 'approver',
      content: input.approvalNote,
      timestamp: now,
    })
  }

  await writeQueue(input.memoryDir, queue)

  await appendExploringTranscript({
    memoryDir: input.memoryDir,
    taskId: task.id,
    role: 'system',
    content: input.approvalNote
      ? `Spec approved by human. Note: ${input.approvalNote}`
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

function backfillAcceptanceCriteriaFromSpec(task: Task): void {
  if (task.acceptanceCriteria.length > 0 || !task.spec) return
  const extracted = extractAcceptanceCriteriaFromSpec(task.spec)
  if (extracted.length === 0) return
  task.acceptanceCriteria = extracted
  task.notes.push({
    agentId: 'spec-quality',
    role: 'blueprint-review',
    content: `Backfilled ${extracted.length} acceptance criteria from the approved spec markdown before approval.`,
    timestamp: new Date().toISOString(),
  })
}

function shouldKeepFixedSpecRunnable(task: Task): boolean {
  const text = [
    task.title,
    task.description,
    task.spec,
    task.productBrief?.userJob,
    task.productBrief?.successMetric,
  ].filter(Boolean).join('\n')
  if (!/\bcompletion boundary\b/i.test(text)) return false
  const splitBoundary = task.spec?.match(/what must be split or blocked\s*:\s*([^\n]+)/i)?.[1] ?? ''
  if (!/^(none|nothing|not required|nothing to split)/i.test(splitBoundary.trim())) return false
  return (
    /\bPantry Pulse\b/i.test(text) ||
    task.productBrief?.authoredBy === 'project-reintake'
  )
}

function isBoundedChildContractWorkWithoutMaterializedChildren(task: Task): boolean {
  if (!isMaterializableSplitAction(task.sizePlan?.action)) return false
  if ((task.sizePlan?.recommendedChildren?.length ?? 0) > 0) return false
  const hasContainingWork = Boolean(task.hierarchy?.parentId) || (task.delivery?.supports?.length ?? 0) > 0
  if (!hasContainingWork) return false
  const text = [task.title, task.description, task.spec].filter(Boolean).join('\n')
  return /\b(contract|schema|fixture|expected-record|prototype-run|evaluation)\b/i.test(text)
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

function approveReintakeBriefWithSpec(task: Task, now: string): void {
  const brief = task.productBrief
  if (!brief || brief.authoredBy !== 'project-reintake') return
  if (typeof brief.approvedAt === 'string' && brief.approvedAt.trim().length > 0) return
  brief.approvedBy = 'human'
  brief.approvedAt = now
  brief.nonGoals = removeDraftApprovalWarnings(brief.nonGoals)
  brief.antiPatterns = removeDraftApprovalWarnings(brief.antiPatterns)
}

function removeDraftApprovalWarnings(items: string[] | undefined): string[] | undefined {
  if (!Array.isArray(items)) return items
  return items.filter(item => !/treat this draft as approved until/i.test(item))
}

function splitRecommendationsDuplicateExistingSiblings(queue: TaskQueue, task: Task): boolean {
  const parentId = task.hierarchy?.parentId
  const recommendations = task.sizePlan?.recommendedChildren ?? []
  if (!parentId || recommendations.length === 0) return false
  const existingTitles = new Set(
    queue.tasks
      .filter(candidate => candidate.id === task.id || candidate.hierarchy?.parentId === parentId)
      .map(candidate => normalizeTitle(candidate.title)),
  )
  if (existingTitles.size === 0) return false
  return recommendations.every(recommendation => existingTitles.has(normalizeTitle(recommendation.title)))
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
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
}

export interface RerunTaskStageInput {
  memoryDir: string
  taskId: string
  stage: 'spec' | 'review' | 'gate'
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
      },
    })
  } else if (input.message && !input.preserveStatus && task.status !== 'blocked') {
    task.status = 'exploring'
    task.updatedAt = new Date().toISOString()
    queue.lastUpdated = task.updatedAt
    await writeQueue(input.memoryDir, queue)
  } else if (input.message) {
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
  const effectiveTask = await buildEffectiveTask(projectRoot, task) as unknown as Task
  // Promoted reads keep resolved escalation history in the evidence detail
  // store rather than on the compact task definition. Reframe must resolve
  // that canonical history, not silently operate on an overlay-free row.
  if (Array.isArray(effectiveTask.escalations)) {
    task.escalations = [...effectiveTask.escalations]
  }
  if (task.status === 'done' || task.status === 'shelved' || task.status === 'pending_pr') {
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
  if (task.status === 'in_progress' || task.status === 'review' || task.status === 'gate_check') {
    notes.push({
      agentId: 'system',
      role: 'system',
      content: 'Cleared an active agent claim with no durable worker checkpoint, artifact, handoff, or terminal output so this task can be reframed before implementation continues.',
      timestamp: now,
    })
  }
  notes.push({
    agentId: 'human',
    role: 'human',
    content: reason
      ? `Asked to reframe this task. Reason: ${reason}`
      : 'Asked to reframe this task from current project memory.',
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
            resolution: 'Superseded by a task reframe request.',
          }
    ))
  }

  delete task.blockReason
  task.status = 'exploring'
  task.assignedTo = 'spec-agent'
  task.productBrief = undefined
  task.spec = undefined
  task.acceptanceCriteria = []
  task.notes = notes
  task.updatedAt = now
  queue.lastUpdated = now

  await upsertTaskRuntimeState(projectRoot, task.id, {
    assignedTo: 'spec-agent',
    updatedAt: now,
  })
  await appendExploringTranscript({
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

const DUPLICATE_TITLE_STOPWORDS = new Set([
  'add',
  'build',
  'create',
  'implement',
  'write',
  'draft',
  'task',
  'tests',
  'test',
  'view',
  'deferred',
  'the',
  'a',
  'an',
  'to',
  'for',
  'of',
  'and',
])

function normalizedTitleTokens(title: string | undefined): string[] {
  return (title ?? '')
    .toLowerCase()
    .replace(/[→>\-–—/:()"'`.,[\]{}]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(token => !DUPLICATE_TITLE_STOPWORDS.has(token))
}

function similarityScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  let overlap = 0
  for (const token of leftSet) {
    if (rightSet.has(token)) overlap += 1
  }
  return overlap / Math.max(leftSet.size, rightSet.size)
}

function findFinishedDuplicate(tasks: TaskQueue['tasks'], task: Task): { id: string; title: string } | null {
  const targetTokens = normalizedTitleTokens(task.title)
  if (targetTokens.length < 4) return null
  for (const candidate of tasks) {
    if (candidate.id === task.id) continue
    if (candidate.status !== 'done' && candidate.status !== 'shelved') continue
    if (candidate.domain !== task.domain) continue
    if (candidate.projectPath !== task.projectPath) continue
    const score = similarityScore(targetTokens, normalizedTitleTokens(candidate.title))
    if (score >= 0.75) {
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
  const task = queue.tasks.find((t) => t.id === input.taskId)
  if (!task) return { success: false, error: `Task ${input.taskId} not found` }
  if (task.status === 'shelved' || task.status === 'blocked') {
    return { success: false, error: `Task ${input.taskId} is ${task.status}` }
  }
  if (task.status === 'done' && input.stage !== 'spec') {
    return { success: false, error: `Task ${input.taskId} is done; rerun the spec stage before review or gate` }
  }

  const now = new Date().toISOString()

  if (input.stage === 'spec') {
    if (task.id === 'task-meta-intake' || task.id === 'task-workspace-import') {
      return {
        success: false,
        error: 'Reserved setup tasks have their own rerun controls.',
      }
    }
    task.status = 'exploring'
    task.assignedTo = null
    detachStaleShelvedReverseChildren(queue, task, now)
    task.updatedAt = now
    queue.lastUpdated = now
    task.notes.push({
      agentId: 'human',
      role: 'human',
      content: 'Human requested a fresh spec pass from the current project reality.',
      timestamp: now,
    })
    await writeQueue(input.memoryDir, queue)
    await appendExploringTranscript({
      memoryDir: input.memoryDir,
      taskId: task.id,
      role: 'system',
      content:
        'Human requested a fresh spec pass. Re-read the task, update the brief/spec from current project reality, and ask only the minimum clarifying questions needed.',
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
