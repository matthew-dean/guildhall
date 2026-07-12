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
  readTaskEvidence,
  readTaskRuntimeStore,
  readTaskWorkspaceStore,
} from './task-state-store.js'
import { effectiveTaskTitle } from '../shared/task-display-label.js'
import { taskDoneButProofMissing } from './proof-health.js'
import { taskHasRecordedCompletionProof } from './task-completion-proof.js'

type LegacyTask = Task & Record<string, unknown>

export interface EffectiveTask extends Record<string, unknown> {
  id: string
  runtime?: TaskRuntimeState
  workspace?: TaskWorkspaceState
  evidence: TaskEvidenceEvent[]
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
    task.retryWindow !== undefined ||
    task.proofRecovery !== undefined ||
    typeof task.handoffStep === 'number' ||
    (task.escalations ?? []).some((escalation) => !escalation.resolvedAt) ||
    (task.agentIssues ?? []).some((issue) => !issue.resolvedAt)
  if (!hasRuntime) return undefined
  return {
    taskId: task.id,
    ...(Object.prototype.hasOwnProperty.call(task, 'assignedTo') ? { assignedTo: task.assignedTo } : {}),
    ...(typeof task.revisionCount === 'number' ? { revisionCount: task.revisionCount } : {}),
    ...(task.retryWindow ? { retryWindow: task.retryWindow } : {}),
    ...(task.proofRecovery ? { proofRecovery: task.proofRecovery as TaskRuntimeState['proofRecovery'] } : {}),
    ...(typeof task.remediationAttempts === 'number' ? { remediationAttempts: task.remediationAttempts } : {}),
    ...(typeof task.handoffStep === 'number' ? { handoffStep: task.handoffStep } : {}),
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
    handoffStep: _handoffStep,
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
): Promise<EffectiveTask> {
  const [runtimeStore, workspaceStore, storedEvidence] = await Promise.all([
    readTaskRuntimeStore(projectRoot),
    readTaskWorkspaceStore(projectRoot),
    readTaskEvidence(projectRoot, task.id),
  ])
  return buildEffectiveTaskFromState(task, runtimeStore, workspaceStore, storedEvidence)
}

export async function buildEffectiveTasks(
  projectRoot: string,
  tasks: Task[],
): Promise<EffectiveTask[]> {
  const [runtimeStore, workspaceStore] = await Promise.all([
    readTaskRuntimeStore(projectRoot),
    readTaskWorkspaceStore(projectRoot),
  ])
  return await Promise.all(tasks.map(async task => buildEffectiveTaskFromState(
    task,
    runtimeStore,
    workspaceStore,
    await readTaskEvidence(projectRoot, task.id),
  )))
}

function buildEffectiveTaskFromState(
  task: Task,
  runtimeStore: Awaited<ReturnType<typeof readTaskRuntimeStore>>,
  workspaceStore: Awaited<ReturnType<typeof readTaskWorkspaceStore>>,
  storedEvidence: TaskEvidenceEvent[],
): EffectiveTask {
  const runtime = runtimeStore.tasks[task.id] ?? legacyRuntimeFromTask(task)
  const workspace = workspaceStore.workspaces[task.id] ?? legacyWorkspaceFromTask(task)
  const evidence = normalizeEvidenceProjection(storedEvidence.length > 0 ? storedEvidence : legacyEvidenceFromTask(task))
  const projected = legacyFieldsFromEvidence(evidence)
  const normalized = normalizeTerminalCompletionEvidence({
    ...task,
    ...projected,
    ...(runtime?.proofRecovery ? { proofRecovery: runtime.proofRecovery } : {}),
  })
  const proofPathStatusProjection = normalizeProofPathStatuses({
    ...task,
    ...projected,
    ...normalized,
  })
  return {
    ...task,
    title: effectiveTaskTitle(task) ?? task.title,
    ...projected,
    ...(runtime?.assignedTo !== undefined ? { assignedTo: runtime.assignedTo } : {}),
    ...(runtime?.revisionCount !== undefined ? { revisionCount: runtime.revisionCount } : {}),
    ...(runtime?.retryWindow !== undefined ? { retryWindow: runtime.retryWindow } : {}),
    ...(runtime?.remediationAttempts !== undefined ? { remediationAttempts: runtime.remediationAttempts } : {}),
    ...(runtime?.handoffStep !== undefined ? { handoffStep: runtime.handoffStep } : {}),
    ...(workspace?.worktreePath !== undefined ? { worktreePath: workspace.worktreePath } : {}),
    ...(workspace?.branchName !== undefined ? { branchName: workspace.branchName } : {}),
    ...(workspace?.baseBranch !== undefined ? { baseBranch: workspace.baseBranch } : {}),
    ...(runtime ? { runtime } : {}),
    ...(workspace ? { workspace } : {}),
    ...normalized,
    ...proofPathStatusProjection,
    evidence,
  }
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
  const completedAt = typeof task.completedAt === 'string' && task.completedAt.trim().length > 0
    ? task.completedAt.trim()
    : null
  const doneSummary = task.doneSummaryBundle && typeof task.doneSummaryBundle === 'object' && !Array.isArray(task.doneSummaryBundle)
    ? task.doneSummaryBundle as Record<string, unknown>
    : null
  const mergeRecord = task.mergeRecord && typeof task.mergeRecord === 'object' && !Array.isArray(task.mergeRecord)
    ? task.mergeRecord as Record<string, unknown>
    : null
  const hasDurableDoneEvidence = (doneSummary?.status === 'done' || taskHasRecordedCompletionProof(task)) &&
    !taskDoneButProofMissing({ ...task, status: 'done' })
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
    .map((event) => event.payload)
  const gateResults = evidence
    .filter((event) => event.kind === 'gate_result')
    .map((event) => event.payload)
  const reviewVerdicts = evidence
    .filter((event) => event.kind === 'review_verdict')
    .map((event) => event.payload)
  const adjudications = evidence
    .filter((event) => event.kind === 'adjudication')
    .map((event) => event.payload)
  const escalations = coalescePayloadsById(
    evidence.filter((event) => event.kind === 'escalation'),
  )
  const agentIssues = coalescePayloadsById(
    evidence.filter((event) => event.kind === 'agent_issue'),
  )
  const mergeRecords = evidence
    .filter((event) => event.kind === 'merge_record')
    .map((event) => event.payload)
  return {
    ...(notes.length > 0 ? { notes } : {}),
    ...(gateResults.length > 0 ? { gateResults } : {}),
    ...(reviewVerdicts.length > 0 ? { reviewVerdicts } : {}),
    ...(adjudications.length > 0 ? { adjudications } : {}),
    ...(escalations.length > 0 ? { escalations } : {}),
    ...(agentIssues.length > 0 ? { agentIssues } : {}),
    ...(mergeRecords.length > 0 ? { mergeRecord: mergeRecords[mergeRecords.length - 1] } : {}),
  }
}

function coalescePayloadsById(events: TaskEvidenceEvent[]): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>()
  const anonymous: Record<string, unknown>[] = []
  for (const event of events) {
    const payload = event.payload
    const id = typeof payload.id === 'string' && payload.id.length > 0 ? payload.id : ''
    if (!id) {
      anonymous.push(payload)
      continue
    }
    byId.set(id, payload)
  }
  return [...anonymous, ...byId.values()]
}
