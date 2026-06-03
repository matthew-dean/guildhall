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
  field: ExternalWriteField | string
  value: unknown
  evidenceRefs: string[]
  proposedAt: string
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
  transitionReceipts: ExternalTaskMirrorTransitionReceipt[]
  createdAt: string
  updatedAt: string
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
  return value ? [...value].sort() : undefined
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
