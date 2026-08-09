import {
  TaskRuntimeState as TaskRuntimeStateSchema,
  TaskWorkspaceState as TaskWorkspaceStateSchema,
} from '@guildhall/core'
import {
  AdjudicationRecord as AdjudicationRecordSchema,
  AgentIssue as AgentIssueSchema,
  Escalation as EscalationSchema,
  GateResult as GateResultSchema,
  ReviewVerdict as ReviewVerdictSchema,
  Task as TaskSchema,
} from '@guildhall/core'
import type {
  AgentIssue,
  AgentNote,
  AdjudicationRecord,
  Escalation,
  GateResult,
  ReviewVerdict,
  Task,
  TaskEvidenceEvent,
  TaskRuntimeState,
  TaskWorkspaceState,
} from '@guildhall/core'
import {
  readProjectStateDatabaseTaskOverlay,
  readProjectStateDatabaseTaskOverlayStores,
  readProjectStateDatabaseCurrentAuthority,
  readProjectStateDatabaseTaskEvidenceCurrent,
  type ProjectStateDatabaseTaskEvidenceCurrent,
  type ProjectStateDatabaseTaskOverlay,
  type ProjectStateDatabaseTaskOverlayStores,
  type ProjectStateDatabaseTaskRuntime,
} from '@guildhall/sessions'
import {
  readTaskEvidence,
  readTaskRuntimeStore,
  readTaskWorkspaceStore,
} from './task-state-store.js'
import { effectiveTaskTitle } from '@guildhall/shared'
import {
  hasActiveProofRecovery,
  latestFallbackApprovalHasUnresolvedSubstantiveRevision,
  normalizeAcceptanceCriteriaForCurrentProof,
  taskDoneButProofMissing,
} from './proof-health.js'
import {
  latestRecordedCompletionProofAt,
  recordedCompletionProofCanSettleTaskStatus,
  taskHasRecordedCompletionProof,
} from './task-completion-proof.js'

type LegacyTask = Task & Record<string, unknown>

export interface EffectiveTask extends Record<string, unknown> {
  id: string
  runtime?: TaskRuntimeState
  workspace?: TaskWorkspaceState
  evidence: TaskEvidenceEvent[]
}

/**
 * The one current-status rule shared by rich and indexed projections.
 * Completion evidence can settle a stale blocked/pending task, but not when
 * a newer unresolved escalation still owns the task's current state.
 */
export function effectiveTaskStatus(task: unknown): string | undefined {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return undefined
  const record = task as Record<string, unknown>
  const status = typeof record.status === 'string' ? record.status : undefined
  // A fresh lifecycle deliberately supersedes historical completion. This is
  // broader than proof recovery: a task can be reopened to shape a new spec
  // for a later release while an earlier shipped release retains its evidence.
  // Never let that earlier evidence silently close the current work again.
  if (
    record.doneSummaryBundle &&
    typeof record.doneSummaryBundle === 'object' &&
    !Array.isArray(record.doneSummaryBundle) &&
    (record.doneSummaryBundle as Record<string, unknown>).status === 'reopened'
  ) return status
  if (hasActiveProofRecovery(record)) return status
  // Reopening a falsely completed task must not be immediately re-promoted by
  // older completion proof while the substantive review finding is unresolved.
  if (latestFallbackApprovalHasUnresolvedSubstantiveRevision(record)) return status
  // A max-revision stop is a deliberate recovery boundary. An earlier
  // approval can make the focused Start action eligible again, but it must not
  // silently turn the blocked task into a terminal done record first. The
  // boundary is a typed recovery fact; blocker prose is never authoritative.
  const recoveryCode = record.recoveryCode
  const activeEscalationRecoveryCodes = Array.isArray(record.escalations)
    ? record.escalations
      .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === 'object')
      .filter(candidate => !candidate.resolvedAt)
      .map(candidate => candidate.recoveryCode)
    : []
  if (
    status === 'blocked' &&
    (recoveryCode === 'max_revisions_actionable' || activeEscalationRecoveryCodes.includes('max_revisions_actionable'))
  ) return status
  // Promoted projects keep the current proof answer on the compact task point
  // because the rich completion bundle is intentionally outside the ordinary
  // read model. A ready task with a completed timestamp and a proven indexed
  // contract is stale status, not new work.
  const currentSummary = record.currentSummary
  const currentProof = currentSummary && typeof currentSummary === 'object' && !Array.isArray(currentSummary)
    ? (currentSummary as Record<string, unknown>).proof
    : null
  if (status === 'ready' && record.completedAt && currentProof && typeof currentProof === 'object' && !Array.isArray(currentProof) &&
      (currentProof as Record<string, unknown>).state === 'proven') {
    return 'done'
  }
  if (!recordedCompletionProofCanSettleTaskStatus(record) || taskDoneButProofMissing(record)) return status
  if (status === 'blocked') {
    const proofAt = latestRecordedCompletionProofAt(record)
    const proofTime = proofAt ? Date.parse(proofAt) : Number.NaN
    const activeEscalations = Array.isArray(record.escalations)
      ? record.escalations.filter((entry): entry is Record<string, unknown> => Boolean(
          entry && typeof entry === 'object' && !Array.isArray(entry) && !entry.resolvedAt,
        ))
      : []
    if (activeEscalations.some(escalation => {
      const raisedAt = Date.parse(String(escalation.raisedAt ?? ''))
      return !Number.isFinite(proofTime) || !Number.isFinite(raisedAt) || proofTime <= raisedAt
    })) return status
  }
  return 'done'
}

function runtimeStoreFromOverlay(
  taskId: string,
  overlay: ReturnType<typeof readProjectStateDatabaseTaskOverlay>,
): Awaited<ReturnType<typeof readTaskRuntimeStore>> {
  const parsed = overlay?.runtime
    ? TaskRuntimeStateSchema.safeParse(overlay.runtime.payload)
    : null
  if (overlay?.runtime && !parsed?.success) {
    throw new Error(`Corrupt normalized runtime overlay for task ${taskId}`)
  }
  return {
    version: 1,
    lastUpdated: overlay?.runtime?.updatedAt ?? new Date(0).toISOString(),
    tasks: parsed?.success ? { [taskId]: parsed.data } : {},
  }
}

function workspaceStoreFromOverlay(
  taskId: string,
  overlay: ReturnType<typeof readProjectStateDatabaseTaskOverlay>,
): Awaited<ReturnType<typeof readTaskWorkspaceStore>> {
  const parsed = overlay?.workspace
    ? TaskWorkspaceStateSchema.safeParse(overlay.workspace.payload)
    : null
  if (overlay?.workspace && !parsed?.success) {
    throw new Error(`Corrupt normalized workspace overlay for task ${taskId}`)
  }
  return {
    version: 1,
    lastUpdated: overlay?.workspace?.updatedAt ?? new Date(0).toISOString(),
    workspaces: parsed?.success ? { [taskId]: parsed.data } : {},
  }
}

function eventId(taskId: string, kind: string, index: number, fallbackTimestamp?: string): string {
  const ts = fallbackTimestamp ? fallbackTimestamp.replace(/[^0-9A-Za-z]/g, '') : 'legacy'
  return `${taskId}-${kind}-${ts}-${index + 1}`
}

export function legacyRuntimeFromTask(task: LegacyTask): TaskRuntimeState | undefined {
  const hasRuntime =
    Object.prototype.hasOwnProperty.call(task, 'assignedTo') ||
    typeof task.revisionCount === 'number' ||
    typeof task.remediationAttempts === 'number' ||
    (task.workerRecovery && typeof task.workerRecovery === 'object') ||
    task.retryWindow !== undefined ||
    task.proofRecovery !== undefined ||
    task.currentLifecycle !== undefined ||
    typeof task.handoffStep === 'number' ||
    task.shelveReason !== undefined ||
    (task.escalations ?? []).some((escalation) => !escalation.resolvedAt) ||
    (task.agentIssues ?? []).some((issue) => !issue.resolvedAt)
  if (!hasRuntime) return undefined
  return {
    taskId: task.id,
    ...(Object.prototype.hasOwnProperty.call(task, 'assignedTo') ? { assignedTo: task.assignedTo } : {}),
    ...(typeof task.revisionCount === 'number' ? { revisionCount: task.revisionCount } : {}),
    ...(task.retryWindow ? { retryWindow: task.retryWindow } : {}),
    ...(task.proofRecovery ? { proofRecovery: task.proofRecovery as TaskRuntimeState['proofRecovery'] } : {}),
    ...(task.currentLifecycle ? { currentLifecycle: task.currentLifecycle as TaskRuntimeState['currentLifecycle'] } : {}),
    ...(typeof task.remediationAttempts === 'number' ? { remediationAttempts: task.remediationAttempts } : {}),
    ...(task.workerRecovery && typeof task.workerRecovery === 'object'
      ? { workerRecovery: task.workerRecovery as TaskRuntimeState['workerRecovery'] }
      : {}),
    ...(typeof task.handoffStep === 'number' ? { handoffStep: task.handoffStep } : {}),
    ...(task.shelveReason !== undefined ? { shelveReason: task.shelveReason } : {}),
    openEscalationIds: (task.escalations ?? [])
      .filter((escalation) => !escalation.resolvedAt)
      .map((escalation) => escalation.id),
    openIssueIds: (task.agentIssues ?? [])
      .filter((issue) => !issue.resolvedAt)
      .map((issue) => issue.id),
    updatedAt: task.updatedAt,
  }
}

export function legacyWorkspaceFromTask(task: LegacyTask): TaskWorkspaceState | undefined {
  if (!task.worktreePath && !task.branchName && !task.baseBranch) return undefined
  return {
    taskId: task.id,
    ...(task.worktreePath ? { worktreePath: task.worktreePath } : {}),
    ...(task.branchName ? { branchName: task.branchName } : {}),
    ...(task.baseBranch ? { baseBranch: task.baseBranch } : {}),
    updatedAt: task.updatedAt,
  }
}

export function legacyEvidenceFromTask(task: LegacyTask): TaskEvidenceEvent[] {
  const events: TaskEvidenceEvent[] = []
  ;(task.notes ?? []).forEach((note: AgentNote, index: number) => {
    events.push({
      id: eventId(task.id, 'note', index, note.timestamp),
      taskId: task.id,
      kind: 'note',
      recordedAt: note.timestamp,
      payload: note,
    })
  })
  ;(task.gateResults ?? []).forEach((gate: GateResult, index: number) => {
    events.push({
      id: eventId(task.id, 'gate', index, gate.checkedAt),
      taskId: task.id,
      kind: 'gate_result',
      recordedAt: gate.checkedAt,
      payload: gate,
    })
  })
  ;(task.reviewVerdicts ?? []).forEach((verdict: ReviewVerdict, index: number) => {
    events.push({
      id: eventId(task.id, 'review', index, verdict.recordedAt),
      taskId: task.id,
      kind: 'review_verdict',
      recordedAt: verdict.recordedAt,
      payload: verdict,
    })
  })
  ;(task.adjudications ?? []).forEach((adjudication: AdjudicationRecord, index: number) => {
    events.push({
      id: eventId(task.id, 'adjudication', index, adjudication.decidedAt),
      taskId: task.id,
      kind: 'adjudication',
      recordedAt: adjudication.decidedAt,
      payload: adjudication,
    })
  })
  ;(task.escalations ?? []).forEach((escalation: Escalation, index: number) => {
    events.push({
      id: escalation.id || eventId(task.id, 'escalation', index, escalation.raisedAt),
      taskId: task.id,
      kind: 'escalation',
      recordedAt: escalation.raisedAt,
      payload: escalation,
    })
  })
  ;(task.agentIssues ?? []).forEach((issue: AgentIssue, index: number) => {
    events.push({
      id: issue.id || eventId(task.id, 'issue', index, issue.raisedAt),
      taskId: task.id,
      kind: 'agent_issue',
      recordedAt: issue.raisedAt,
      payload: issue,
    })
  })
  if (task.mergeRecord) {
    const record = task.mergeRecord as { mergedAt?: string }
    events.push({
      id: eventId(task.id, 'merge', 0, record.mergedAt ?? task.updatedAt),
      taskId: task.id,
      kind: 'merge_record',
      recordedAt: record.mergedAt ?? task.updatedAt,
      payload: task.mergeRecord as Record<string, unknown>,
    })
  }
  if (task.doneSummaryBundle) {
    const summary = task.doneSummaryBundle as { createdAt?: string }
    events.push({
      id: eventId(task.id, 'completion-summary', 0, summary.createdAt ?? task.updatedAt),
      taskId: task.id,
      kind: 'completion_summary',
      recordedAt: summary.createdAt ?? task.updatedAt,
      payload: task.doneSummaryBundle as Record<string, unknown>,
    })
  }
  return events.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
}

function repairSyntheticBootstrapOutputTruncation(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const payload = value as Record<string, unknown>
  if (payload.agentId !== 'coordinator') return value
  if (payload.role !== 'bootstrap-verification') return value
  const content = typeof payload.content === 'string' ? payload.content : ''
  if (!content.includes('Verification output:')) return value
  if (!content.trimEnd().endsWith('...')) return value
  return {
    ...payload,
    content: content.replace(
      /\n\.\.\.\s*$/,
      '\n[older Guildhall build truncated this bootstrap verification output before storing it; full output is unavailable]',
    ),
  }
}

function normalizeEvidenceProjection(events: TaskEvidenceEvent[]): TaskEvidenceEvent[] {
  return events.map((event) => ({
    ...event,
    payload: repairSyntheticBootstrapOutputTruncation(event.payload) as TaskEvidenceEvent['payload'],
  }))
}

function currentEvidenceProjectionToEvents(
  taskId: string,
  current: ProjectStateDatabaseTaskEvidenceCurrent | null | undefined,
): TaskEvidenceEvent[] {
  if (!current) return []
  return Object.entries(current.byKind).flatMap(([kind, records]) => records.map(record => ({
    id: `${taskId}-current-${kind}-${record.id}`,
    taskId,
    kind: kind as TaskEvidenceEvent['kind'],
    recordedAt: record.recordedAt,
    payload: record.payload as TaskEvidenceEvent['payload'],
  }))).sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
}

export function stripLegacyRuntimeFields<T extends Record<string, unknown>>(task: T): Record<string, unknown> {
  const {
    assignedTo: _assignedTo,
    notes: _notes,
    gateResults: _gateResults,
    reviewVerdicts: _reviewVerdicts,
    adjudications: _adjudications,
    escalations: _escalations,
    agentIssues: _agentIssues,
    revisionCount: _revisionCount,
    retryWindow: _retryWindow,
    remediationAttempts: _remediationAttempts,
    workerRecovery: _workerRecovery,
    handoffStep: _handoffStep,
    shelveReason: _shelveReason,
    proofRecovery: _proofRecovery,
    currentLifecycle: _currentLifecycle,
    doneSummaryBundle: _doneSummaryBundle,
    worktreePath: _worktreePath,
    branchName: _branchName,
    baseBranch: _baseBranch,
    mergeRecord: _mergeRecord,
    ...definition
  } = task
  return definition
}

export async function buildEffectiveTask(
  projectRoot: string,
  task: Task,
  options: {
    evidence?: 'full' | 'current' | 'none'
    /** Use an overlay captured by the caller's authoritative read snapshot. */
    overlay?: ProjectStateDatabaseTaskOverlay | null
    /** Use the authority captured by the caller's authoritative read snapshot. */
    authority?: 'database' | 'legacy'
  } = {},
): Promise<EffectiveTask> {
  const overlay = options.overlay !== undefined
    ? options.overlay
    : readProjectStateDatabaseTaskOverlay(projectRoot, task.id)
  const databaseAuthority = (options.authority ?? readProjectStateDatabaseCurrentAuthority(projectRoot)) === 'database'
  if (databaseAuthority && overlay === null) {
    throw new Error(`Normalized task state is unavailable for promoted task ${task.id}`)
  }
  // Database-authoritative projects have a bounded current projection. Reopen
  // history only when a caller explicitly asks for a historical/detail view.
  const evidenceMode = options.evidence ?? (databaseAuthority ? 'current' : 'full')
  const [runtimeStore, workspaceStore, storedEvidence] = await Promise.all([
    overlay?.runtime === undefined
      ? databaseAuthority
        ? Promise.resolve({ version: 1, lastUpdated: new Date(0).toISOString(), tasks: {} })
        : readTaskRuntimeStore(projectRoot)
      : Promise.resolve(runtimeStoreFromOverlay(task.id, overlay)),
    overlay?.workspace === undefined
      ? databaseAuthority
        ? Promise.resolve({ version: 1, lastUpdated: new Date(0).toISOString(), workspaces: {} })
        : readTaskWorkspaceStore(projectRoot)
      : Promise.resolve(workspaceStoreFromOverlay(task.id, overlay)),
    evidenceMode === 'full'
      ? readTaskEvidence(projectRoot, task.id)
      : evidenceMode === 'current'
        ? Promise.resolve(currentEvidenceProjectionToEvents(task.id, overlay?.evidenceCurrent ?? readProjectStateDatabaseTaskEvidenceCurrent(projectRoot, task.id)))
        : Promise.resolve([]),
  ])
  return buildEffectiveTaskFromState(task, runtimeStore, workspaceStore, storedEvidence, {
    allowLegacyState: !databaseAuthority,
    includeLegacyEvidence: !databaseAuthority,
  })
}

/** Build one effective task from an already captured database point snapshot. */
export function buildEffectiveTaskFromDatabaseOverlay(
  task: Task,
  overlay: ProjectStateDatabaseTaskOverlay | null,
  additionalEvidence: readonly TaskEvidenceEvent[] = [],
): EffectiveTask {
  if (overlay === null) throw new Error(`Normalized task state is unavailable for promoted task ${task.id}`)
  return buildEffectiveTaskFromState(
    task,
    runtimeStoreFromOverlay(task.id, overlay),
    workspaceStoreFromOverlay(task.id, overlay),
    [...currentEvidenceProjectionToEvents(task.id, overlay.evidenceCurrent), ...additionalEvidence],
    { allowLegacyState: false, includeLegacyEvidence: false },
  )
}

export async function buildEffectiveTasks(
  projectRoot: string,
  tasks: Task[],
  options: {
    evidence?: 'full' | 'current' | 'none'
    /** Use overlays captured by the caller's authoritative read snapshot. */
    databaseStores?: ProjectStateDatabaseTaskOverlayStores | null
    /** Use the authority captured by the caller's authoritative read snapshot. */
    authority?: 'database' | 'legacy'
  } = {},
): Promise<EffectiveTask[]> {
  const databaseStores = options.databaseStores !== undefined
    ? options.databaseStores
    : readProjectStateDatabaseTaskOverlayStores(projectRoot)
  const databaseAuthority = (options.authority ?? readProjectStateDatabaseCurrentAuthority(projectRoot)) === 'database'
  if (databaseAuthority && databaseStores === null) {
    throw new Error('Normalized task state is unavailable for promoted project')
  }
  const [runtimeStore, workspaceStore] = databaseStores
    ? [
        runtimeStoreFromOverlayStores(databaseStores.runtime),
        workspaceStoreFromOverlayStores(databaseStores.workspace),
      ]
    : await Promise.all([
        readTaskRuntimeStore(projectRoot),
        readTaskWorkspaceStore(projectRoot),
      ])
  const evidenceMode = options.evidence ?? (databaseStores ? 'current' : 'full')
  return await Promise.all(tasks.map(async task => buildEffectiveTaskFromState(
    task,
    runtimeStore,
    workspaceStore,
    evidenceMode === 'full'
      ? await readTaskEvidence(projectRoot, task.id)
      : evidenceMode === 'current'
        ? currentEvidenceProjectionToEvents(task.id, databaseStores?.evidenceCurrent.get(task.id) ?? null)
        : [],
    { allowLegacyState: databaseStores === null, includeLegacyEvidence: databaseStores === null && evidenceMode === 'full' },
  )))
}

function runtimeStoreFromOverlayStores(
  states: ProjectStateDatabaseTaskRuntime[],
): Awaited<ReturnType<typeof readTaskRuntimeStore>> {
  return {
    version: 1,
    lastUpdated: states.at(-1)?.updatedAt ?? new Date(0).toISOString(),
    tasks: Object.fromEntries(states.map(state => {
      const parsed = TaskRuntimeStateSchema.safeParse(state.payload)
      if (!parsed.success) throw new Error(`Corrupt normalized runtime overlay for task ${state.taskId}`)
      return [state.taskId, parsed.data] as const
    })),
  } as Awaited<ReturnType<typeof readTaskRuntimeStore>>
}

function workspaceStoreFromOverlayStores(
  states: ProjectStateDatabaseTaskRuntime[],
): Awaited<ReturnType<typeof readTaskWorkspaceStore>> {
  return {
    version: 1,
    lastUpdated: states.at(-1)?.updatedAt ?? new Date(0).toISOString(),
    workspaces: Object.fromEntries(states.map(state => {
      const parsed = TaskWorkspaceStateSchema.safeParse(state.payload)
      if (!parsed.success) throw new Error(`Corrupt normalized workspace overlay for task ${state.taskId}`)
      return [state.taskId, parsed.data] as const
    })),
  } as Awaited<ReturnType<typeof readTaskWorkspaceStore>>
}

function buildEffectiveTaskFromState(
  task: Task,
  runtimeStore: Awaited<ReturnType<typeof readTaskRuntimeStore>>,
  workspaceStore: Awaited<ReturnType<typeof readTaskWorkspaceStore>>,
  storedEvidence: TaskEvidenceEvent[],
  options: { allowLegacyState?: boolean; includeLegacyEvidence?: boolean } = {},
): EffectiveTask {
  const definitionTask = (options.allowLegacyState === false ? stripLegacyRuntimeFields(task) : task) as LegacyTask
  const runtime = runtimeStore.tasks[task.id] ?? (options.allowLegacyState === false ? undefined : legacyRuntimeFromTask(task))
  const workspace = workspaceStore.workspaces[task.id] ?? (options.allowLegacyState === false ? undefined : legacyWorkspaceFromTask(task))
  const evidence = normalizeEvidenceProjection(storedEvidence.length > 0
    ? storedEvidence
    : options.includeLegacyEvidence === false ? [] : legacyEvidenceFromTask(task))
  const projected = legacyFieldsFromEvidence(evidence)
  const proofRecoveryInput = runtime?.proofRecovery
    ? {
        ...definitionTask,
        ...projected,
        proofRecovery: runtime.proofRecovery,
      }
    : definitionTask
  const effectiveRuntime = (() => {
    const base = runtime?.proofRecovery && !hasActiveProofRecovery(proofRecoveryInput)
      ? { ...runtime, proofRecovery: undefined }
      : runtime
    const currentLifecycle = base?.currentLifecycle
    const hasNewCompletion = currentLifecycle
      ? evidence.some(event => {
          if (event.kind !== 'completion_summary') return false
          const recordedAt = Date.parse(event.recordedAt)
          const reopenedAt = Date.parse(currentLifecycle.reopenedAt)
          const payload = event.payload as Record<string, unknown>
          return Number.isFinite(recordedAt) && Number.isFinite(reopenedAt) &&
            recordedAt > reopenedAt && payload.status === 'done'
        })
      : false
    const lifecycleBase = currentLifecycle && hasNewCompletion
      ? { ...base, currentLifecycle: undefined }
      : base
    if (!lifecycleBase || !hasActiveProofRecovery(proofRecoveryInput)) return lifecycleBase
    const supersededEscalationIds = new Set(
      (proofRecoveryInput.escalations ?? [])
        .filter((escalation) => escalation.reason === 'max_revisions_exceeded')
        .map((escalation) => escalation.id),
    )
    // Promoted task points intentionally omit the full escalation collection.
    // In that case there is no authoritative basis for clearing runtime IDs;
    // retain them until a durable task definition explicitly supersedes them.
    const openEscalationIds = supersededEscalationIds.size > 0
      ? (lifecycleBase.openEscalationIds ?? []).filter((id) => !supersededEscalationIds.has(id))
      : lifecycleBase.openEscalationIds
    return {
      ...lifecycleBase,
      openEscalationIds,
    }
  })()
  const normalized = normalizeTerminalCompletionEvidence({
    ...definitionTask,
    ...projected,
    ...(effectiveRuntime?.proofRecovery ? { proofRecovery: effectiveRuntime.proofRecovery } : {}),
  })
  const effectiveDefinition = {
    ...definitionTask,
    ...projected,
    ...(effectiveRuntime?.proofRecovery ? { proofRecovery: effectiveRuntime.proofRecovery } : {}),
    ...normalized,
  }
  const currentLifecycleStatus = effectiveRuntime?.currentLifecycle &&
    ['done', 'pending_pr'].includes(String(effectiveDefinition.status))
    ? effectiveRuntime.currentLifecycle.status
    : undefined
  const lifecycleDefinition = currentLifecycleStatus
    ? { ...effectiveDefinition, status: currentLifecycleStatus, assignedTo: null, completedAt: undefined }
    : effectiveDefinition
  const proofAware = normalizeAcceptanceCriteriaForCurrentProof(lifecycleDefinition)
  const proofAwareRecord = proofAware as Record<string, unknown>
  const effectiveDefinitionRecord = lifecycleDefinition as Record<string, unknown>
  const proofAwarenessProjection = {
    ...(proofAware.acceptanceCriteria !== lifecycleDefinition.acceptanceCriteria
      ? { acceptanceCriteria: proofAware.acceptanceCriteria }
      : {}),
    ...(proofAwareRecord.acceptanceCriteriaProofState !== effectiveDefinitionRecord.acceptanceCriteriaProofState
      ? { acceptanceCriteriaProofState: proofAwareRecord.acceptanceCriteriaProofState }
      : {}),
  }
  const proofPathStatusProjection = normalizeProofPathStatuses({
    ...lifecycleDefinition,
    ...proofAwarenessProjection,
  })
  const effectiveTask = {
    ...definitionTask,
    title: effectiveTaskTitle(definitionTask) ?? task.title,
    ...projected,
    ...(effectiveRuntime?.assignedTo !== undefined ? { assignedTo: effectiveRuntime.assignedTo } : {}),
    revisionCount: effectiveRuntime?.revisionCount ?? task.revisionCount ?? 0,
    ...(effectiveRuntime?.retryWindow !== undefined ? { retryWindow: effectiveRuntime.retryWindow } : {}),
    ...(effectiveRuntime?.remediationAttempts !== undefined ? { remediationAttempts: effectiveRuntime.remediationAttempts } : {}),
    ...(effectiveRuntime?.workerRecovery !== undefined ? { workerRecovery: effectiveRuntime.workerRecovery } : {}),
    ...(effectiveRuntime?.handoffStep !== undefined ? { handoffStep: effectiveRuntime.handoffStep } : {}),
    ...(effectiveRuntime?.shelveReason !== undefined ? { shelveReason: effectiveRuntime.shelveReason } : {}),
    ...(effectiveRuntime?.proofRecovery ? { proofRecovery: effectiveRuntime.proofRecovery } : {}),
    ...(effectiveRuntime?.currentLifecycle ? { currentLifecycle: effectiveRuntime.currentLifecycle } : {}),
    ...(workspace?.worktreePath !== undefined ? { worktreePath: workspace.worktreePath } : {}),
    ...(workspace?.branchName !== undefined ? { branchName: workspace.branchName } : {}),
    ...(workspace?.baseBranch !== undefined ? { baseBranch: workspace.baseBranch } : {}),
    ...(effectiveRuntime ? { runtime: effectiveRuntime } : {}),
    ...(workspace ? { workspace } : {}),
    ...normalized,
    ...(currentLifecycleStatus ? { status: currentLifecycleStatus, assignedTo: null, completedAt: undefined } : {}),
    ...proofAwarenessProjection,
    ...proofPathStatusProjection,
    // EffectiveTask is the runtime contract. Current SQLite definitions omit
    // evidence-owned collections by design, so every consumer gets explicit
    // empty collections when the bounded projection has no entries.
    notes: Array.isArray(lifecycleDefinition.notes) ? lifecycleDefinition.notes : [],
    gateResults: Array.isArray(lifecycleDefinition.gateResults) ? lifecycleDefinition.gateResults : [],
    reviewVerdicts: Array.isArray(lifecycleDefinition.reviewVerdicts) ? lifecycleDefinition.reviewVerdicts : [],
    adjudications: Array.isArray(lifecycleDefinition.adjudications) ? lifecycleDefinition.adjudications : [],
    escalations: Array.isArray(lifecycleDefinition.escalations) ? lifecycleDefinition.escalations : [],
    agentIssues: Array.isArray(lifecycleDefinition.agentIssues) ? lifecycleDefinition.agentIssues : [],
    evidence,
  }
  const status = effectiveTaskStatus(effectiveTask)
  return status && status !== effectiveTask.status
    ? { ...effectiveTask, status }
    : effectiveTask
}

function normalizeProofPathStatuses(task: Record<string, unknown>): Record<string, unknown> {
  if (task.status !== 'done') return {}
  const proofPaths = Array.isArray(task.proofPaths) ? task.proofPaths : []
  if (proofPaths.length === 0) return {}
  const derivedStatus = taskDoneButProofMissing(task) ? 'blocked' : 'verified'
  let changed = false
  const normalizedProofPaths = proofPaths.map((proofPath) => {
    if (!proofPath || typeof proofPath !== 'object' || Array.isArray(proofPath)) return proofPath
    const existingStatus = (proofPath as { status?: unknown }).status
    if (typeof existingStatus === 'string' && existingStatus.trim().length > 0) return proofPath
    changed = true
    return { ...proofPath, status: derivedStatus }
  })
  return changed ? { proofPaths: normalizedProofPaths } : {}
}

function normalizeTerminalCompletionEvidence(task: Record<string, unknown>): Record<string, unknown> {
  if (task.status === 'done' || task.status === 'shelved' || task.status === 'archived' || task.status === 'cancelled') return {}
  if (latestFallbackApprovalHasUnresolvedSubstantiveRevision(task)) return {}
  const completedAt = typeof task.completedAt === 'string' && task.completedAt.trim().length > 0
    ? task.completedAt.trim()
    : null
  const doneSummary = task.doneSummaryBundle && typeof task.doneSummaryBundle === 'object' && !Array.isArray(task.doneSummaryBundle)
    ? task.doneSummaryBundle as Record<string, unknown>
    : null
  // A fresh spec pass supersedes older merge/proof evidence for the current
  // lifecycle. Keep that evidence in history, but do not re-promote the task
  // to done while the reopened summary is the latest completion record.
  if (doneSummary?.status === 'reopened') return {}
  const mergeRecord = task.mergeRecord && typeof task.mergeRecord === 'object' && !Array.isArray(task.mergeRecord)
    ? task.mergeRecord as Record<string, unknown>
    : null
  const proofMissingForDone = taskDoneButProofMissing({ ...task, status: 'done' })
  const hasDurableDoneEvidence = (doneSummary?.status === 'done' || taskHasRecordedCompletionProof(task)) &&
    !proofMissingForDone
  if (!completedAt || !hasDurableDoneEvidence) return {}
  const proofRecovery = task.proofRecovery && typeof task.proofRecovery === 'object' && !Array.isArray(task.proofRecovery)
    ? task.proofRecovery as Record<string, unknown>
    : null
  const reopenedAt = typeof proofRecovery?.reopenedAt === 'string' && proofRecovery.reopenedAt.trim().length > 0
    ? Date.parse(proofRecovery.reopenedAt)
    : NaN
  const durableCompletedAt = typeof doneSummary?.completedAt === 'string'
    ? doneSummary.completedAt
    : typeof mergeRecord?.mergedAt === 'string'
      ? mergeRecord.mergedAt
      : completedAt
  if (Number.isFinite(reopenedAt) && Date.parse(durableCompletedAt) <= reopenedAt) return {}

  return {
    status: 'done',
    assignedTo: null,
    completedAt: durableCompletedAt,
  }
}

function legacyFieldsFromEvidence(evidence: TaskEvidenceEvent[]): Record<string, unknown> {
  const notes = evidence
    .filter((event) => event.kind === 'note')
    .map((event) => {
      const payload = event.payload as Record<string, unknown>
      // Evidence is the durable record; the task-shaped projection still has
      // to satisfy the current Task schema when an older or external writer
      // stored a partial note payload. Keep the evidence intact and make the
      // projection deterministic instead of letting one malformed event take
      // down every current-state read.
      return {
        agentId: typeof payload.agentId === 'string' && payload.agentId.length > 0
          ? payload.agentId
          : `evidence:${event.id}`,
        role: typeof payload.role === 'string' && payload.role.length > 0 ? payload.role : 'system',
        content: typeof payload.content === 'string' ? payload.content : JSON.stringify(payload),
        ...(payload.structured && typeof payload.structured === 'object' && !Array.isArray(payload.structured)
          ? { structured: payload.structured }
          : {}),
        timestamp: typeof payload.timestamp === 'string' ? payload.timestamp : event.recordedAt,
      }
    })
  const gateResults = evidence
    .filter((event) => event.kind === 'gate_result')
    .flatMap((event) => parseEvidencePayload(GateResultSchema, event.payload))
  const reviewVerdicts = evidence
    .filter((event) => event.kind === 'review_verdict')
    .flatMap((event) => parseEvidencePayload(ReviewVerdictSchema, event.payload))
  const adjudications = evidence
    .filter((event) => event.kind === 'adjudication')
    .flatMap((event) => parseEvidencePayload(AdjudicationRecordSchema, event.payload))
  const escalations = coalescePayloadsById(
    evidence
      .filter((event) => event.kind === 'escalation')
      .flatMap((event) => parseEvidencePayload(EscalationSchema, event.payload))
  ).sort((left, right) => {
    const leftRaisedAt = typeof left.raisedAt === 'string' ? left.raisedAt : ''
    const rightRaisedAt = typeof right.raisedAt === 'string' ? right.raisedAt : ''
    return leftRaisedAt.localeCompare(rightRaisedAt)
  })
  const agentIssues = coalescePayloadsById(
    evidence
      .filter((event) => event.kind === 'agent_issue')
      .flatMap((event) => parseEvidencePayload(AgentIssueSchema, event.payload))
  )
  const mergeRecords = evidence
    .filter((event) => event.kind === 'merge_record')
    .flatMap((event) => parseEvidencePayload(TaskSchema.shape.mergeRecord, event.payload))
  const completionSummaries = evidence
    .filter((event) => event.kind === 'completion_summary')
    .flatMap((event) => parseEvidencePayload(TaskSchema.shape.doneSummaryBundle, event.payload))
  return {
    ...(notes.length > 0 ? { notes } : {}),
    ...(gateResults.length > 0 ? { gateResults } : {}),
    ...(reviewVerdicts.length > 0 ? { reviewVerdicts } : {}),
    ...(adjudications.length > 0 ? { adjudications } : {}),
    ...(escalations.length > 0 ? { escalations } : {}),
    ...(agentIssues.length > 0 ? { agentIssues } : {}),
    ...(mergeRecords.length > 0 ? { mergeRecord: mergeRecords[mergeRecords.length - 1] } : {}),
    ...(completionSummaries.length > 0 ? { doneSummaryBundle: completionSummaries[completionSummaries.length - 1] } : {}),
  }
}

function parseEvidencePayload(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } },
  payload: unknown,
): Record<string, unknown>[] {
  const parsed = schema.safeParse(payload)
  if (parsed.success && parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) {
    return [parsed.data as Record<string, unknown>]
  }
  // A malformed historical payload remains available in the raw evidence
  // stream, but it cannot cross into the current Task projection. Emitting it
  // here makes every strict consumer re-parse old history and turns one stale
  // record into a project-wide read failure. Current state must be schema-clean;
  // history is where incompatible legacy evidence belongs.
  return []
}

function coalescePayloadsById(payloads: Record<string, unknown>[]): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>()
  const anonymous: Record<string, unknown>[] = []
  for (const payload of payloads) {
    const id = typeof payload.id === 'string' && payload.id.length > 0 ? payload.id : ''
    if (!id) {
      anonymous.push(payload)
      continue
    }
    byId.set(id, payload)
  }
  return [...anonymous, ...byId.values()]
}
