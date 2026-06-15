import { defineStateMachine, transition, type TransitionReceipt } from './state-machine.js'

export type ExternalTaskProvider =
  | 'jira'
  | 'linear'
  | 'github_issues'
  | 'azure_devops'
  | 'asana'
  | 'custom'

export type ExternalStatusCategory =
  | 'todo'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'canceled'
  | 'unknown'

export interface ExternalIssuePersonRef {
  id: string
  label: string
  email?: string
}

export interface ExternalIssueRelationshipRef {
  provider?: ExternalTaskProvider
  issueKey?: string
  stableId?: string
  relationship?: string
  url?: string
}

export interface ExternalIssueRef {
  provider: ExternalTaskProvider
  cloudOrWorkspaceId?: string
  projectKey?: string
  issueKey?: string
  stableId?: string
  url: string
  issueType?: string
  title: string
  status?: {
    name: string
    category?: ExternalStatusCategory
  }
  priority?: string
  sprint?: string
  assignee?: ExternalIssuePersonRef
  reporter?: ExternalIssuePersonRef
  parentRef?: ExternalIssueRelationshipRef
  childRefs?: ExternalIssueRelationshipRef[]
  linkedRefs?: ExternalIssueRelationshipRef[]
  labels?: string[]
  components?: string[]
  updatedAt?: string
  version?: string
  etag?: string
  rawProviderFields?: Record<string, unknown>
  fieldMappings?: Record<string, string>
}

export type ExternalTaskMirrorStatus =
  | 'candidate'
  | 'mirrored'
  | 'active'
  | 'blocked'
  | 'done'
  | 'stale'
  | 'conflict'
  | 'archived'

export type ExternalTaskMirrorEvent =
  | 'mirror'
  | 'start'
  | 'block'
  | 'complete'
  | 'mark_stale'
  | 'mark_conflict'
  | 'refresh_clean'
  | 'archive'

export type ExternalTaskMirrorTransitionReceipt = TransitionReceipt<ExternalTaskMirrorStatus, ExternalTaskMirrorEvent>

export type ExternalWriteField =
  | 'comment'
  | 'pr_link'
  | 'status'
  | 'assignee'
  | 'priority'
  | 'sprint'
  | 'parent'
  | 'label'
  | 'resolution'

export interface ExternalAuthorityPolicy {
  mode: 'read_only' | 'propose_only' | 'allow_low_risk_writes'
  allowedWrites: ExternalWriteField[]
}

export interface ExternalTaskContextRoute {
  domain?: string
  handles?: string[]
}

export interface ExternalTaskContextBudget {
  included: number
  summarized: number
  handleOnly: number
  omitted: number
}

export interface ExternalTaskMirrorSourceSnapshot {
  identity: string
  title: string
  status?: string
  statusCategory?: ExternalStatusCategory
  priority?: string
  assigneeId?: string
  assigneeLabel?: string
  sprint?: string
  parentIdentity?: string
  issueType?: string
  labels?: string[]
  components?: string[]
  updatedAt?: string
  version: string
}

export interface ProposedExternalWrite {
  id?: string
  field: ExternalWriteField | string
  value: unknown
  evidenceRefs: string[]
  proposedAt: string
  proposedBy?: string
  reason?: string
  approvalStatus?: ExternalWriteProposalStatus
  policyDecision?: ExternalWritePolicyDecision
  decidedAt?: string
  decidedBy?: string
  rejectionReason?: string
  decisionEvidenceRefs?: string[]
}

export type ExternalWriteProposalStatus = 'pending_approval' | 'approved' | 'rejected'
export type ExternalWritePolicyDecision =
  | 'requires_explicit_approval'
  | 'rejected_by_policy'
  | 'approved_for_connector_execution'

export interface ExternalWriteApprovalRecord {
  proposalId: string
  field: ExternalWriteField | string
  value: unknown
  evidenceRefs: string[]
  proposedAt: string
  proposedBy: string
  status: ExternalWriteProposalStatus
  policyMode: ExternalAuthorityPolicy['mode']
  policyDecision: ExternalWritePolicyDecision
  reason: string
  decidedAt?: string
  decidedBy?: string
  decisionEvidenceRefs?: string[]
}

export type ExternalTaskSyncDirection = 'external_to_local' | 'local_to_external' | 'bidirectional'
export type ExternalTaskSyncStatus = 'clean' | 'pending' | 'stale' | 'conflict' | 'write_failed' | 'manual_required'

export interface ExternalTaskSyncState {
  direction: ExternalTaskSyncDirection
  field: string
  sourceVersion: string
  targetVersion: string
  status: ExternalTaskSyncStatus
  reason: string
  lastAttemptAt?: string
  lastSuccessAt?: string
  proposedWrite?: ProposedExternalWrite
}

export interface ExternalTaskStaleState {
  detectedAt: string
  externalVersion: string
  localVersion: string
  reason: string
  changes: ExternalTaskSyncState[]
}

export interface ExternalTaskConflictState {
  detectedAt: string
  externalVersion: string
  localVersion: string
  reason: string
  changes: ExternalTaskSyncState[]
}

export interface ExternalTaskMirror {
  id: string
  projectPath: string
  externalRef: ExternalIssueRef
  localTaskId: string
  domain?: string
  contextRoute?: ExternalTaskContextRoute
  mirrorStatus: ExternalTaskMirrorStatus
  stateMachine: {
    id: 'external-task-mirror'
    version: 1
    state: ExternalTaskMirrorStatus
  }
  authorityPolicy: ExternalAuthorityPolicy
  lastSyncAt: string
  lastExternalVersion: string
  lastLocalVersion: string
  sourceSnapshot: ExternalTaskMirrorSourceSnapshot
  contextBudget?: ExternalTaskContextBudget
  contextManifest?: Record<string, unknown>
  syncState: ExternalTaskSyncState[]
  staleState?: ExternalTaskStaleState
  conflictState?: ExternalTaskConflictState
  evidenceRefs: string[]
  commentRefs: string[]
  prRefs: string[]
  proofPathRefs: string[]
  memoryCandidateRefs: string[]
  proposedExternalWrites: ProposedExternalWrite[]
  externalWriteApprovals: ExternalWriteApprovalRecord[]
  transitionReceipts: ExternalTaskMirrorTransitionReceipt[]
  createdAt: string
  updatedAt: string
}

export type ExternalTaskExecutionReadiness = 'ready' | 'recheck_required' | 'blocked_by_external_conflict'

export interface ExternalTaskExecutionPacket {
  id: string
  shapedAt: string
  providerNeutral: true
  mirrorId: string
  localTaskId: string
  projectPath: string
  readiness: ExternalTaskExecutionReadiness
  externalIssue: {
    identity: string
    provider: ExternalTaskProvider
    cloudOrWorkspaceId?: string
    projectKey?: string
    issueKey?: string
    stableId?: string
    url: string
    issueType?: string
    title: string
    status?: ExternalIssueRef['status']
    priority?: string
    sprint?: string
    assignee?: ExternalIssuePersonRef
    reporter?: ExternalIssuePersonRef
    parentRef?: ExternalIssueRelationshipRef
    relationships: {
      childRefs: ExternalIssueRelationshipRef[]
      linkedRefs: ExternalIssueRelationshipRef[]
    }
    labels: string[]
    components: string[]
    updatedAt?: string
    version: string
  }
  localContext: {
    localStatus?: string
    domain?: string
    activeBranch?: string
    activeWorktree?: string
    acceptedOutcome?: string
    definitionOfDone: string[]
    blockerState?: string
    structuralContext?: string
    contextHandles: string[]
    policyConstraints: string[]
    proofPathRefs: string[]
    prRefs: Array<{ url: string; title?: string; state?: string }>
    reviewThreadRefs: Array<{ id: string; summary: string }>
  }
  contextRoute?: ExternalTaskContextRoute
  contextBudget?: ExternalTaskContextBudget
  contextManifest: ExternalTaskPacketContextManifest
  authority: {
    policy: ExternalAuthorityPolicy
    pendingProposals: ProposedExternalWrite[]
    approvedProposals: ProposedExternalWrite[]
    rejectedProposals: ProposedExternalWrite[]
  }
  syncWarnings: ExternalTaskExecutionPacketWarning[]
  evidenceRefs: string[]
  commentRefs: string[]
  prRefs: string[]
  proofPathRefs: string[]
  memoryCandidateRefs: string[]
}

export interface ExternalTaskPacketContextManifest {
  alwaysIncluded: string[]
  summarized: string[]
  handleOnly: string[]
  omitted: Array<{ ref: string; reason: string }>
}

export interface ExternalTaskExecutionPacketWarning {
  kind: 'stale' | 'conflict'
  field: string
  reason: string
  sourceVersion: string
  targetVersion: string
}

export interface ExternalTaskExecutionPacketLocalTask {
  id?: string
  title?: string
  status?: string
  acceptedOutcome?: string
  definitionOfDone?: string[]
  blockerState?: string
  branchName?: string
  worktreePath?: string
}

export interface ExternalTaskExecutionPacketRepoContext {
  activeBranch?: string
  activeWorktree?: string
  structuralContext?: string
  contextHandles?: string[]
  policyConstraints?: string[]
  proofPathRefs?: string[]
  prRefs?: Array<{ url: string; title?: string; state?: string }>
  reviewThreadRefs?: Array<{ id: string; summary: string }>
}

export const externalTaskMirrorMachine = defineStateMachine<
  ExternalTaskMirrorStatus,
  ExternalTaskMirrorEvent,
  ExternalTaskMirror
>({
  id: 'external-task-mirror',
  version: 1,
  initial: 'candidate',
  terminal: ['archived'],
  states: {
    candidate: {
      on: {
        mirror: { to: 'mirrored', require: ['externalRef', 'localTaskId'] },
        archive: { to: 'archived' },
      },
    },
    mirrored: {
      on: {
        start: { to: 'active' },
        block: { to: 'blocked' },
        complete: { to: 'done' },
        mark_stale: { to: 'stale' },
        mark_conflict: { to: 'conflict' },
        archive: { to: 'archived' },
      },
    },
    active: {
      on: {
        block: { to: 'blocked' },
        complete: { to: 'done' },
        mark_stale: { to: 'stale' },
        mark_conflict: { to: 'conflict' },
        archive: { to: 'archived' },
      },
    },
    blocked: {
      on: {
        start: { to: 'active' },
        complete: { to: 'done' },
        mark_stale: { to: 'stale' },
        mark_conflict: { to: 'conflict' },
        archive: { to: 'archived' },
      },
    },
    done: {
      on: {
        mark_stale: { to: 'stale' },
        mark_conflict: { to: 'conflict' },
        archive: { to: 'archived' },
      },
    },
    stale: {
      on: {
        refresh_clean: { to: 'mirrored' },
        mark_conflict: { to: 'conflict' },
        archive: { to: 'archived' },
      },
    },
    conflict: {
      on: {
        refresh_clean: { to: 'mirrored' },
        archive: { to: 'archived' },
      },
    },
    archived: { on: {} },
  },
})

export function externalIssueIdentity(ref: ExternalIssueRef): string {
  const workspace = ref.cloudOrWorkspaceId ?? 'workspace'
  const project = ref.projectKey ?? 'project'
  const issue = ref.stableId ?? ref.issueKey ?? ref.url
  return `${ref.provider}:${workspace}:${project}:${issue}`
}

export function createExternalTaskMirror(input: {
  id: string
  projectPath: string
  externalRef: ExternalIssueRef
  localTaskId: string
  authorityPolicy: ExternalAuthorityPolicy
  contextRoute?: ExternalTaskContextRoute
  contextBudget?: ExternalTaskContextBudget
  contextManifest?: Record<string, unknown>
  evidenceRefs?: string[]
  mirroredBy: string
  now?: string
}): ExternalTaskMirror {
  const now = input.now ?? new Date().toISOString()
  const version = externalVersion(input.externalRef)
  const mirror: ExternalTaskMirror = {
    id: input.id,
    projectPath: input.projectPath,
    externalRef: input.externalRef,
    localTaskId: input.localTaskId,
    domain: input.contextRoute?.domain,
    contextRoute: input.contextRoute,
    mirrorStatus: 'candidate',
    stateMachine: {
      id: 'external-task-mirror',
      version: 1,
      state: 'candidate',
    },
    authorityPolicy: input.authorityPolicy,
    lastSyncAt: now,
    lastExternalVersion: version,
    lastLocalVersion: version,
    sourceSnapshot: sourceSnapshotFromExternalRef(input.externalRef),
    contextBudget: input.contextBudget,
    contextManifest: input.contextManifest,
    syncState: [],
    evidenceRefs: input.evidenceRefs ?? [`external:${externalIssueIdentity(input.externalRef)}`],
    commentRefs: [],
    prRefs: [],
    proofPathRefs: [],
    memoryCandidateRefs: [],
    proposedExternalWrites: [],
    externalWriteApprovals: [],
    transitionReceipts: [],
    createdAt: now,
    updatedAt: now,
  }
  applyExternalTaskMirrorTransition(mirror, {
    event: 'mirror',
    actor: input.mirroredBy,
    now,
  })
  return mirror
}

export function updateExternalTaskMirrorLocalStatus(
  mirror: ExternalTaskMirror,
  input: {
    localStatus: 'active' | 'blocked' | 'done'
    localVersion: string
    proposedExternalWrite?: ProposedExternalWrite
    evidenceRefs?: string[]
    updatedBy: string
    now?: string
  },
): ExternalTaskMirror {
  const next = cloneMirror(mirror)
  const now = input.now ?? new Date().toISOString()
  if (input.proposedExternalWrite) {
    next.proposedExternalWrites = [...next.proposedExternalWrites, input.proposedExternalWrite]
    next.syncState = [
      ...next.syncState.filter(item => item.field !== input.proposedExternalWrite?.field || item.direction !== 'local_to_external'),
      {
        direction: 'local_to_external',
        field: input.proposedExternalWrite.field,
        sourceVersion: input.localVersion,
        targetVersion: next.lastExternalVersion,
        status: 'pending',
        reason: 'local_execution_proposed_external_update',
        proposedWrite: input.proposedExternalWrite,
      },
    ]
  }
  next.lastLocalVersion = input.localVersion
  const event: ExternalTaskMirrorEvent =
    input.localStatus === 'done'
      ? 'complete'
      : input.localStatus === 'blocked'
        ? 'block'
        : 'start'
  if (next.stateMachine.state !== input.localStatus) {
    applyExternalTaskMirrorTransition(next, {
      event,
      actor: input.updatedBy,
      evidenceRefs: input.evidenceRefs,
      now,
    })
  } else {
    next.updatedAt = now
  }
  return next
}

export function buildExternalTaskExecutionPacket(
  mirror: ExternalTaskMirror,
  input: {
    shapedAt?: string
    localTask?: ExternalTaskExecutionPacketLocalTask
    repoContext?: ExternalTaskExecutionPacketRepoContext
  } = {},
): ExternalTaskExecutionPacket {
  const shapedAt = input.shapedAt ?? mirror.updatedAt
  const externalRef = mirror.externalRef
  const version = externalVersion(externalRef)
  const pendingProposals = mirror.proposedExternalWrites
    .filter(write => (write.approvalStatus ?? 'pending_approval') === 'pending_approval')
    .map(normalizeProposedWriteForPacket)
  const approvedProposals = mirror.proposedExternalWrites
    .filter(write => write.approvalStatus === 'approved')
    .map(normalizeProposedWriteForPacket)
  const rejectedProposals = mirror.proposedExternalWrites
    .filter(write => write.approvalStatus === 'rejected')
    .map(normalizeProposedWriteForPacket)
  const syncWarnings = mirror.syncState
    .filter(isPacketWarningSyncState)
    .map((item): ExternalTaskExecutionPacketWarning => ({
      kind: item.status,
      field: item.field,
      reason: item.reason,
      sourceVersion: item.sourceVersion,
      targetVersion: item.targetVersion,
    }))
    .sort(comparePacketWarnings)

  return {
    id: `external-task-packet:${mirror.id}:${mirror.lastExternalVersion}:${mirror.lastLocalVersion}`,
    shapedAt,
    providerNeutral: true,
    mirrorId: mirror.id,
    localTaskId: mirror.localTaskId,
    projectPath: mirror.projectPath,
    readiness: executionReadinessForMirror(mirror),
    externalIssue: {
      identity: externalIssueIdentity(externalRef),
      provider: externalRef.provider,
      cloudOrWorkspaceId: externalRef.cloudOrWorkspaceId,
      projectKey: externalRef.projectKey,
      issueKey: externalRef.issueKey,
      stableId: externalRef.stableId,
      url: externalRef.url,
      issueType: externalRef.issueType,
      title: externalRef.title,
      status: externalRef.status,
      priority: externalRef.priority,
      sprint: externalRef.sprint,
      assignee: externalRef.assignee,
      reporter: externalRef.reporter,
      parentRef: externalRef.parentRef,
      relationships: {
        childRefs: normalizeRelationshipRefs(externalRef.childRefs),
        linkedRefs: normalizeRelationshipRefs(externalRef.linkedRefs),
      },
      labels: sorted(externalRef.labels) ?? [],
      components: sorted(externalRef.components) ?? [],
      updatedAt: externalRef.updatedAt,
      version,
    },
    localContext: {
      localStatus: input.localTask?.status ?? mirror.mirrorStatus,
      domain: mirror.domain ?? mirror.contextRoute?.domain,
      activeBranch: input.repoContext?.activeBranch ?? input.localTask?.branchName,
      activeWorktree: input.repoContext?.activeWorktree ?? input.localTask?.worktreePath,
      acceptedOutcome: input.localTask?.acceptedOutcome,
      definitionOfDone: sorted(input.localTask?.definitionOfDone) ?? [],
      blockerState: input.localTask?.blockerState,
      structuralContext: input.repoContext?.structuralContext,
      contextHandles: sorted([
        ...(mirror.contextRoute?.handles ?? []),
        ...(input.repoContext?.contextHandles ?? []),
      ]) ?? [],
      policyConstraints: sorted(input.repoContext?.policyConstraints) ?? [],
      proofPathRefs: sorted([
        ...mirror.proofPathRefs,
        ...(input.repoContext?.proofPathRefs ?? []),
      ]) ?? [],
      prRefs: normalizePrRefs([
        ...mirror.prRefs.map(url => ({ url })),
        ...(input.repoContext?.prRefs ?? []),
      ]),
      reviewThreadRefs: normalizeReviewThreadRefs(input.repoContext?.reviewThreadRefs),
    },
    contextRoute: mirror.contextRoute,
    contextBudget: mirror.contextBudget,
    contextManifest: normalizePacketContextManifest(mirror.contextManifest),
    authority: {
      policy: {
        mode: mirror.authorityPolicy.mode,
        allowedWrites: sortedExternalWriteFields(mirror.authorityPolicy.allowedWrites),
      },
      pendingProposals,
      approvedProposals,
      rejectedProposals,
    },
    syncWarnings,
    evidenceRefs: sorted(mirror.evidenceRefs) ?? [],
    commentRefs: sorted(mirror.commentRefs) ?? [],
    prRefs: sorted(mirror.prRefs) ?? [],
    proofPathRefs: sorted(mirror.proofPathRefs) ?? [],
    memoryCandidateRefs: sorted(mirror.memoryCandidateRefs) ?? [],
  }
}

export function recordExternalWriteProposal(
  mirror: ExternalTaskMirror,
  input: {
    id: string
    field: ExternalWriteField | string
    value: unknown
    reason?: string
    evidenceRefs: string[]
    proposedBy: string
    now?: string
  },
): ExternalTaskMirror {
  const next = cloneMirror(mirror)
  const now = input.now ?? new Date().toISOString()
  const evidenceRefs = sorted(input.evidenceRefs) ?? []
  const policyRejection = externalWritePolicyRejection(next.authorityPolicy, input.field, evidenceRefs)
  const approvalStatus: ExternalWriteProposalStatus = policyRejection ? 'rejected' : 'pending_approval'
  const policyDecision: ExternalWritePolicyDecision = policyRejection
    ? 'rejected_by_policy'
    : 'requires_explicit_approval'
  const reason = input.reason ?? defaultExternalWriteProposalReason(policyRejection)
  const proposedWrite: ProposedExternalWrite = {
    id: input.id,
    field: input.field,
    value: input.value,
    evidenceRefs,
    proposedAt: now,
    proposedBy: input.proposedBy,
    reason,
    approvalStatus,
    policyDecision,
    ...(policyRejection ? { rejectionReason: policyRejection } : {}),
  }

  next.proposedExternalWrites = [
    ...next.proposedExternalWrites.filter(write => write.id !== input.id),
    proposedWrite,
  ]
  next.externalWriteApprovals = [
    ...approvalRecords(next).filter(record => record.proposalId !== input.id),
    {
      proposalId: input.id,
      field: input.field,
      value: input.value,
      evidenceRefs,
      proposedAt: now,
      proposedBy: input.proposedBy,
      status: approvalStatus,
      policyMode: next.authorityPolicy.mode,
      policyDecision,
      reason,
    },
  ]
  next.syncState = upsertLocalExternalWriteSyncState(next.syncState, {
    field: input.field,
    sourceVersion: next.lastLocalVersion,
    targetVersion: next.lastExternalVersion,
    status: approvalStatus === 'rejected' ? 'manual_required' : 'manual_required',
    reason: approvalStatus === 'rejected' ? `external_write_rejected:${policyRejection}` : 'external_write_waiting_for_approval',
    proposedWrite,
    now,
  })
  next.updatedAt = now
  return next
}

export function approveExternalWriteProposal(
  mirror: ExternalTaskMirror,
  input: {
    proposalId: string
    approvedBy: string
    evidenceRefs?: string[]
    now?: string
  },
): ExternalTaskMirror {
  return decideExternalWriteProposal(mirror, {
    proposalId: input.proposalId,
    status: 'approved',
    decidedBy: input.approvedBy,
    decisionEvidenceRefs: input.evidenceRefs,
    now: input.now,
    reason: 'external_write_approved_waiting_for_connector',
  })
}

export function rejectExternalWriteProposal(
  mirror: ExternalTaskMirror,
  input: {
    proposalId: string
    rejectedBy: string
    reason: string
    evidenceRefs?: string[]
    now?: string
  },
): ExternalTaskMirror {
  return decideExternalWriteProposal(mirror, {
    proposalId: input.proposalId,
    status: 'rejected',
    decidedBy: input.rejectedBy,
    decisionEvidenceRefs: input.evidenceRefs,
    now: input.now,
    reason: input.reason,
  })
}

export function refreshExternalTaskMirror(
  mirror: ExternalTaskMirror,
  input: {
    latestExternalRef: ExternalIssueRef
    refreshedBy: string
    now?: string
  },
): ExternalTaskMirror {
  const next = cloneMirror(mirror)
  const now = input.now ?? new Date().toISOString()
  const latestVersion = externalVersion(input.latestExternalRef)
  const localVersion = next.lastExternalVersion
  const changes = classifyExternalChanges({
    mirror: next,
    latestExternalRef: input.latestExternalRef,
    latestVersion,
    localVersion,
    now,
  })

  next.externalRef = input.latestExternalRef
  next.lastSyncAt = now
  next.lastExternalVersion = latestVersion
  next.syncState = [
    ...next.syncState.filter(item => item.direction !== 'external_to_local'),
    ...changes,
  ]

  const conflicts = changes.filter(item => item.status === 'conflict')
  if (conflicts.length > 0) {
    next.conflictState = {
      detectedAt: now,
      externalVersion: latestVersion,
      localVersion,
      reason: 'external_authority_changed_completion_or_ownership',
      changes: conflicts,
    }
    next.staleState = undefined
    if (next.stateMachine.state !== 'conflict') {
      applyExternalTaskMirrorTransition(next, {
        event: next.stateMachine.state === 'stale' ? 'mark_conflict' : 'mark_conflict',
        actor: input.refreshedBy,
        now,
      })
    } else {
      next.updatedAt = now
    }
    return next
  }

  if (changes.length > 0) {
    next.staleState = {
      detectedAt: now,
      externalVersion: latestVersion,
      localVersion,
      reason: 'external_changed_after_local_shape',
      changes,
    }
    next.conflictState = undefined
    if (next.stateMachine.state !== 'stale') {
      applyExternalTaskMirrorTransition(next, {
        event: 'mark_stale',
        actor: input.refreshedBy,
        now,
      })
    } else {
      next.updatedAt = now
    }
    return next
  }

  next.staleState = undefined
  next.conflictState = undefined
  if (next.stateMachine.state === 'stale' || next.stateMachine.state === 'conflict') {
    applyExternalTaskMirrorTransition(next, {
      event: 'refresh_clean',
      actor: input.refreshedBy,
      now,
    })
  } else {
    next.updatedAt = now
  }
  return next
}

function executionReadinessForMirror(mirror: ExternalTaskMirror): ExternalTaskExecutionReadiness {
  if (mirror.conflictState || mirror.mirrorStatus === 'conflict') return 'blocked_by_external_conflict'
  if (mirror.staleState || mirror.mirrorStatus === 'stale') return 'recheck_required'
  return 'ready'
}

function normalizePacketContextManifest(manifest: Record<string, unknown> | undefined): ExternalTaskPacketContextManifest {
  return {
    alwaysIncluded: normalizeStringList(manifest?.alwaysIncluded),
    summarized: normalizeStringList(manifest?.summarized),
    handleOnly: normalizeStringList(manifest?.handleOnly),
    omitted: normalizeOmittedManifest(manifest?.omitted),
  }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return sorted(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())) ?? []
}

function normalizeOmittedManifest(value: unknown): Array<{ ref: string; reason: string }> {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item): Array<{ ref: string; reason: string }> => {
      if (!item || typeof item !== 'object') return []
      const record = item as Record<string, unknown>
      const ref = typeof record.ref === 'string' ? record.ref.trim() : ''
      const reason = typeof record.reason === 'string' ? record.reason.trim() : ''
      return ref && reason ? [{ ref, reason }] : []
    })
    .sort((left, right) => compareStrings(`${left.ref}:${left.reason}`, `${right.ref}:${right.reason}`))
}

function normalizeRelationshipRefs(value: ExternalIssueRelationshipRef[] | undefined): ExternalIssueRelationshipRef[] {
  return [...(value ?? [])].sort((left, right) => compareStrings(issueRelationshipIdentity(left), issueRelationshipIdentity(right)))
}

function normalizePrRefs(value: Array<{ url: string; title?: string; state?: string }>): Array<{ url: string; title?: string; state?: string }> {
  return value
    .filter(ref => ref.url.trim().length > 0)
    .map(ref => ({
      url: ref.url,
      ...(ref.title ? { title: ref.title } : {}),
      ...(ref.state ? { state: ref.state } : {}),
    }))
    .sort((left, right) => compareStrings(left.url, right.url))
}

function normalizeReviewThreadRefs(value: Array<{ id: string; summary: string }> | undefined): Array<{ id: string; summary: string }> {
  return [...(value ?? [])]
    .filter(ref => ref.id.trim().length > 0 && ref.summary.trim().length > 0)
    .sort((left, right) => compareStrings(left.id, right.id))
}

function normalizeProposedWriteForPacket(write: ProposedExternalWrite): ProposedExternalWrite {
  return {
    ...write,
    evidenceRefs: sorted(write.evidenceRefs) ?? [],
    ...(write.decisionEvidenceRefs ? { decisionEvidenceRefs: sorted(write.decisionEvidenceRefs) ?? [] } : {}),
  }
}

function isPacketWarningSyncState(
  item: ExternalTaskSyncState,
): item is ExternalTaskSyncState & { status: 'stale' | 'conflict' } {
  return item.status === 'stale' || item.status === 'conflict'
}

function comparePacketWarnings(left: ExternalTaskExecutionPacketWarning, right: ExternalTaskExecutionPacketWarning): number {
  return compareStrings(
    `${left.kind}:${left.field}:${left.reason}`,
    `${right.kind}:${right.field}:${right.reason}`,
  )
}

function externalWritePolicyRejection(
  policy: ExternalAuthorityPolicy,
  field: ExternalWriteField | string,
  evidenceRefs: string[],
): string | null {
  if (evidenceRefs.length === 0) return 'missing_evidence'
  if (policy.mode === 'read_only') return 'policy_read_only'
  if (!policy.allowedWrites.includes(field as ExternalWriteField)) return 'write_not_allowed_by_policy'
  return null
}

function defaultExternalWriteProposalReason(rejection: string | null): string {
  if (rejection === 'missing_evidence') return 'External write proposal rejected because it has no local evidence references.'
  if (rejection === 'policy_read_only') return 'External write proposal rejected because the mirror is read-only.'
  if (rejection === 'write_not_allowed_by_policy') return 'External write proposal rejected because the field is not allowed by project policy.'
  return 'External write proposal is waiting for explicit approval.'
}

function approvalRecords(mirror: ExternalTaskMirror): ExternalWriteApprovalRecord[] {
  return mirror.externalWriteApprovals ?? []
}

function decideExternalWriteProposal(
  mirror: ExternalTaskMirror,
  input: {
    proposalId: string
    status: Extract<ExternalWriteProposalStatus, 'approved' | 'rejected'>
    decidedBy: string
    decisionEvidenceRefs?: string[]
    now?: string
    reason: string
  },
): ExternalTaskMirror {
  const next = cloneMirror(mirror)
  const now = input.now ?? new Date().toISOString()
  const proposal = next.proposedExternalWrites.find(write => write.id === input.proposalId)
  if (!proposal) throw new Error(`External write proposal ${input.proposalId} does not exist`)
  if (proposal.approvalStatus === 'rejected' && input.status === 'approved') {
    throw new Error(`External write proposal ${input.proposalId} was rejected and cannot be approved`)
  }
  const decisionEvidenceRefs = sorted(input.decisionEvidenceRefs) ?? []
  const decidedProposal: ProposedExternalWrite = {
    ...proposal,
    approvalStatus: input.status,
    policyDecision: input.status === 'approved'
      ? 'approved_for_connector_execution'
      : proposal.policyDecision ?? 'requires_explicit_approval',
    decidedAt: now,
    decidedBy: input.decidedBy,
    decisionEvidenceRefs,
    ...(input.status === 'rejected' ? { rejectionReason: input.reason } : {}),
  }
  next.proposedExternalWrites = next.proposedExternalWrites.map(write =>
    write.id === input.proposalId ? decidedProposal : write,
  )
  next.externalWriteApprovals = [
    ...approvalRecords(next),
    {
      proposalId: input.proposalId,
      field: proposal.field,
      value: proposal.value,
      evidenceRefs: sorted(proposal.evidenceRefs) ?? [],
      proposedAt: proposal.proposedAt,
      proposedBy: proposal.proposedBy ?? 'unknown',
      status: input.status,
      policyMode: next.authorityPolicy.mode,
      policyDecision: input.status === 'approved'
        ? 'approved_for_connector_execution'
        : proposal.policyDecision ?? 'requires_explicit_approval',
      reason: input.reason,
      decidedAt: now,
      decidedBy: input.decidedBy,
      decisionEvidenceRefs,
    },
  ]
  next.syncState = upsertLocalExternalWriteSyncState(next.syncState, {
    field: proposal.field,
    sourceVersion: next.lastLocalVersion,
    targetVersion: next.lastExternalVersion,
    status: input.status === 'approved' ? 'pending' : 'manual_required',
    reason: input.status === 'approved' ? 'external_write_approved_waiting_for_connector' : 'external_write_rejected',
    proposedWrite: decidedProposal,
    now,
  })
  next.updatedAt = now
  return next
}

function upsertLocalExternalWriteSyncState(
  syncState: ExternalTaskSyncState[],
  input: {
    field: ExternalWriteField | string
    sourceVersion: string
    targetVersion: string
    status: ExternalTaskSyncStatus
    reason: string
    proposedWrite: ProposedExternalWrite
    now: string
  },
): ExternalTaskSyncState[] {
  return [
    ...syncState.filter(item => item.direction !== 'local_to_external' || item.field !== input.field),
    {
      direction: 'local_to_external',
      field: input.field,
      sourceVersion: input.sourceVersion,
      targetVersion: input.targetVersion,
      status: input.status,
      reason: input.reason,
      lastAttemptAt: input.now,
      proposedWrite: input.proposedWrite,
    },
  ]
}

function classifyExternalChanges(input: {
  mirror: ExternalTaskMirror
  latestExternalRef: ExternalIssueRef
  latestVersion: string
  localVersion: string
  now: string
}): ExternalTaskSyncState[] {
  const latest = sourceSnapshotFromExternalRef(input.latestExternalRef)
  const baseline = input.mirror.sourceSnapshot
  const changedFields = comparableSnapshotFields()
    .filter(field => !sameValue(baseline[field], latest[field]))
  const pendingWrites = new Map(input.mirror.proposedExternalWrites.map(write => [write.field, write]))

  return changedFields.map((field): ExternalTaskSyncState => {
    const syncField = syncFieldName(field)
    const proposedWrite = pendingWrites.get(syncField) ?? pendingWrites.get(field)
    const status: ExternalTaskSyncStatus = isAuthoritySensitiveChange(field, input.latestExternalRef, proposedWrite)
      ? 'conflict'
      : 'stale'
    return {
      direction: 'external_to_local',
      field: syncField,
      sourceVersion: input.latestVersion,
      targetVersion: input.localVersion,
      status,
      reason: status === 'conflict'
        ? 'external_authority_changed_completion_or_ownership'
        : 'external_changed_after_local_shape',
      lastAttemptAt: input.now,
      ...(proposedWrite ? { proposedWrite } : {}),
    }
  })
}

function isAuthoritySensitiveChange(
  field: keyof ExternalTaskMirrorSourceSnapshot,
  latestExternalRef: ExternalIssueRef,
  proposedWrite: ProposedExternalWrite | undefined,
): boolean {
  if (proposedWrite) return true
  if (field === 'priority' || field === 'assigneeId' || field === 'parentIdentity' || field === 'issueType') return true
  if (field === 'statusCategory') return latestExternalRef.status?.category === 'done' || latestExternalRef.status?.category === 'canceled'
  return false
}

function syncFieldName(field: keyof ExternalTaskMirrorSourceSnapshot): string {
  if (field === 'assigneeId' || field === 'assigneeLabel') return 'assignee'
  if (field === 'parentIdentity') return 'parent'
  if (field === 'statusCategory') return 'status'
  return field
}

function sourceSnapshotFromExternalRef(ref: ExternalIssueRef): ExternalTaskMirrorSourceSnapshot {
  return {
    identity: externalIssueIdentity(ref),
    title: ref.title,
    status: ref.status?.name,
    statusCategory: ref.status?.category,
    priority: ref.priority,
    assigneeId: ref.assignee?.id,
    assigneeLabel: ref.assignee?.label,
    sprint: ref.sprint,
    parentIdentity: ref.parentRef ? issueRelationshipIdentity(ref.parentRef) : undefined,
    issueType: ref.issueType,
    labels: sorted(ref.labels),
    components: sorted(ref.components),
    updatedAt: ref.updatedAt,
    version: externalVersion(ref),
  }
}

function externalVersion(ref: ExternalIssueRef): string {
  return ref.version ?? ref.etag ?? ref.updatedAt ?? externalIssueIdentity(ref)
}

function issueRelationshipIdentity(ref: ExternalIssueRelationshipRef): string {
  return [
    ref.provider ?? 'provider',
    ref.issueKey ?? ref.stableId ?? ref.url ?? 'issue',
    ref.relationship ?? 'related',
  ].join(':')
}

function comparableSnapshotFields(): Array<keyof ExternalTaskMirrorSourceSnapshot> {
  return [
    'title',
    'status',
    'statusCategory',
    'priority',
    'assigneeId',
    'sprint',
    'parentIdentity',
    'issueType',
    'labels',
    'components',
  ]
}

function sorted(value: string[] | undefined): string[] | undefined {
  return value ? [...value].sort(compareStrings) : undefined
}

function sortedExternalWriteFields(value: ExternalWriteField[]): ExternalWriteField[] {
  return [...value].sort(compareStrings) as ExternalWriteField[]
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right)
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function applyExternalTaskMirrorTransition(
  mirror: ExternalTaskMirror,
  input: {
    event: ExternalTaskMirrorEvent
    actor: string
    now: string
    evidenceRefs?: string[]
  },
): void {
  const result = transition(externalTaskMirrorMachine, {
    entityId: mirror.id,
    currentState: mirror.stateMachine.state,
    event: input.event,
    context: mirror,
    actor: input.actor,
    evidenceRefs: input.evidenceRefs ?? mirror.evidenceRefs,
    now: input.now,
  })
  if (result.kind === 'rejected') {
    throw new Error(`External task mirror ${mirror.id} cannot ${input.event} from ${mirror.stateMachine.state}: ${result.reason}`)
  }
  mirror.stateMachine.state = result.nextState
  mirror.mirrorStatus = result.nextState
  mirror.transitionReceipts.push(result.receipt)
  mirror.updatedAt = input.now
}

function cloneMirror(mirror: ExternalTaskMirror): ExternalTaskMirror {
  return structuredClone(mirror) as ExternalTaskMirror
}
