import type { ProjectScopeProjection } from './project-scope-projection.js'
import { stableJson } from '@guildhall/persistence'

export type ProjectStateClaimAuthority =
  | 'owner_selection'
  | 'canonical_mutation'
  | 'verified_observation'
  | 'runtime_observation'
  | 'imported_record'
  | 'agent_derivation'
  | 'agent_proposal'

export interface ProjectStateClaim<T = unknown> {
  id: string
  projectRevision: number
  subject: { kind: string; id: string }
  field: string
  value: T
  authority: ProjectStateClaimAuthority
  actor: string
  observedAt: string
  evidenceRefs: string[]
  /**
   * The physical or logical instance a fact describes. Claims from different
   * attempts are historical observations, not competing views of one fact.
   */
  basis?: {
    kind: string
    id: string
  }
  supersedes?: string
}

export interface ProjectStateClaimPolicy {
  field: string
  authorities: readonly ProjectStateClaimAuthority[]
  reconciliation: 'rerun_verification' | 'refresh_runtime' | 'inspect_canonical_state' | 'owner_scope_decision'
  /**
   * Claim values are normally exact structured values. A declared set field
   * compares its stable members rather than incidental producer ordering.
   */
  valueSemantics?: 'exact' | 'unordered_string_set'
}

/**
 * A fact is operational only when its identity is declared here. These are
 * deliberately field names rather than an open-ended agent vocabulary: an
 * agent can report a typed observation, but cannot invent a new kind of
 * project truth by naming it persuasively.
 */
export type ProjectStateClaimField =
  | 'project.selectedReleaseId'
  | 'project.scopeSelection'
  | 'project.charterConfirmation'
  | 'release.blockerTaskIds'
  | 'task.lifecycleStatus'
  | 'task.hierarchy'
  | 'task.dependencies'
  | 'task.capabilityBindings'
  | 'task.reviewCriterionDisposition'
  | 'task.reviewEvidenceDisposition'
  | 'proof.status'
  | 'runtime.status'
  | 'workspace.syncState'
  | 'repository.landingStatus'

/**
 * The shared registry for facts that cross product surfaces. Adding a field
 * here is an authority decision, not a route-local implementation detail.
 */
export const PROJECT_STATE_CLAIM_POLICIES: Readonly<Record<ProjectStateClaimField, ProjectStateClaimPolicy>> = {
  'project.selectedReleaseId': {
    field: 'project.selectedReleaseId',
    authorities: ['owner_selection', 'canonical_mutation'],
    reconciliation: 'owner_scope_decision',
  },
  'project.scopeSelection': {
    field: 'project.scopeSelection',
    authorities: ['owner_selection', 'canonical_mutation'],
    reconciliation: 'owner_scope_decision',
  },
  'project.charterConfirmation': {
    field: 'project.charterConfirmation',
    authorities: ['owner_selection', 'canonical_mutation', 'imported_record', 'agent_derivation'],
    reconciliation: 'owner_scope_decision',
  },
  'release.blockerTaskIds': {
    field: 'release.blockerTaskIds',
    authorities: ['canonical_mutation', 'agent_derivation'],
    reconciliation: 'inspect_canonical_state',
    valueSemantics: 'unordered_string_set',
  },
  'task.lifecycleStatus': {
    field: 'task.lifecycleStatus',
    authorities: ['canonical_mutation'],
    reconciliation: 'inspect_canonical_state',
  },
  'task.hierarchy': {
    field: 'task.hierarchy',
    authorities: ['canonical_mutation'],
    reconciliation: 'inspect_canonical_state',
  },
  'task.dependencies': {
    field: 'task.dependencies',
    authorities: ['canonical_mutation'],
    reconciliation: 'inspect_canonical_state',
    valueSemantics: 'unordered_string_set',
  },
  'task.capabilityBindings': {
    field: 'task.capabilityBindings',
    authorities: ['canonical_mutation'],
    reconciliation: 'inspect_canonical_state',
  },
  'task.reviewCriterionDisposition': {
    field: 'task.reviewCriterionDisposition',
    authorities: ['canonical_mutation', 'verified_observation', 'agent_derivation'],
    reconciliation: 'inspect_canonical_state',
  },
  'task.reviewEvidenceDisposition': {
    field: 'task.reviewEvidenceDisposition',
    authorities: ['canonical_mutation', 'verified_observation', 'agent_derivation'],
    reconciliation: 'rerun_verification',
  },
  'proof.status': {
    field: 'proof.status',
    authorities: ['canonical_mutation', 'verified_observation', 'agent_derivation'],
    reconciliation: 'rerun_verification',
  },
  'runtime.status': {
    field: 'runtime.status',
    authorities: ['runtime_observation'],
    reconciliation: 'refresh_runtime',
  },
  'workspace.syncState': {
    field: 'workspace.syncState',
    authorities: ['verified_observation', 'runtime_observation'],
    reconciliation: 'refresh_runtime',
  },
  'repository.landingStatus': {
    field: 'repository.landingStatus',
    authorities: ['canonical_mutation', 'verified_observation', 'agent_derivation'],
    reconciliation: 'inspect_canonical_state',
  },
}

export function projectStateClaimPolicy(field: string): ProjectStateClaimPolicy | null {
  return PROJECT_STATE_CLAIM_POLICIES[field as ProjectStateClaimField] ?? null
}

export function requireProjectStateClaimPolicy(field: string): ProjectStateClaimPolicy {
  const policy = projectStateClaimPolicy(field)
  if (!policy) throw new Error(`No registered project-state claim policy for ${field}.`)
  return policy
}

/**
 * Production claim resolution must use the closed registry. The lower-level
 * resolver remains injectable for isolated policy tests, never for routes or
 * agent integrations that would otherwise create competing authority rules.
 */
export function resolveRegisteredProjectStateClaimSet(
  input: { projectRevision: number; claims: readonly ProjectStateClaim[] },
): ProjectStateClaimResolution {
  return resolveProjectStateClaimSet({
    ...input,
    policies: Object.values(PROJECT_STATE_CLAIM_POLICIES),
  })
}

export interface ProjectStateConflict {
  id: string
  subject: { kind: string; id: string }
  field: string
  claimIds: string[]
  reconciliation: ProjectStateClaimPolicy['reconciliation']
}

export type ProjectStateClaimRejectionCode =
  | 'invalid_claim'
  | 'duplicate_claim_id'
  | 'invalid_supersession'
  | 'unregistered_field'
  | 'ambiguous_policy'

export interface RejectedProjectStateClaim {
  claimId: string
  code: ProjectStateClaimRejectionCode
}

export interface ProjectStateClaimResolution {
  resolved: ResolvedProjectStateClaim[]
  rejected: RejectedProjectStateClaim[]
  /**
   * Every durable disagreement, including one where a stronger source wins.
   * A caller may use the canonical value, but cannot pretend that every agent
   * observed the same thing.
   */
  disagreements: ProjectStateDisagreement[]
}

export interface ProjectStateDisagreement {
  id: string
  subject: { kind: string; id: string }
  field: string
  /** The claims which supplied canonical state, empty for an unresolved tie. */
  canonicalClaimIds: string[]
  /** Active claims whose typed value differs from canonical state. */
  contradictoryClaimIds: string[]
  state: 'resolved_by_authority' | 'unresolved'
  reconciliation: ProjectStateClaimPolicy['reconciliation']
}

export interface ResolvedProjectStateClaim<T = unknown> {
  subject: { kind: string; id: string }
  field: string
  value?: T
  claimIds: string[]
  conflict?: ProjectStateConflict
}

export interface ProjectStateObservationAgreement {
  state: 'confirmed' | 'stale' | 'contradictory' | 'unavailable'
  reconciliation?: ProjectStateClaimPolicy['reconciliation']
  canonicalClaimIds: string[]
  observationClaimId: string
  reason?: 'incomparable_subject_or_field' | 'invalid_canonical_claim' | 'invalid_observation_claim'
  /** Present whenever the shared resolver recorded a typed disagreement. */
  disagreement?: ProjectStateDisagreement
}

const DEFAULT_CLAIM_AUTHORITIES: readonly ProjectStateClaimAuthority[] = [
  'owner_selection',
  'canonical_mutation',
  'verified_observation',
  'runtime_observation',
  'imported_record',
  'agent_derivation',
  'agent_proposal',
]

function stableClaimValue(value: unknown, policy: ProjectStateClaimPolicy | undefined): string {
  if (policy?.valueSemantics === 'unordered_string_set') {
    const members = Array.isArray(value)
      ? [...new Set(value.filter((member): member is string => typeof member === 'string'))].sort()
      : []
    return stableJson(members)
  }
  return stableJson(value)
}

function claimBasisKey(claim: Pick<ProjectStateClaim, 'basis'>): string {
  return claim.basis ? `${claim.basis.kind}:${claim.basis.id}` : 'current'
}

function claimKey(claim: Pick<ProjectStateClaim, 'subject' | 'field' | 'basis'>): string {
  return `${claim.subject.kind}:${claim.subject.id}:${claim.field}:${claimBasisKey(claim)}`
}

function claimConflictId(claims: readonly ProjectStateClaim[]): string {
  const first = claims[0]!
  return `conflict:${first.subject.kind}:${first.subject.id}:${first.field}:${[...claims].map(claim => claim.id).sort().join(',')}`
}

function disagreementId(claims: readonly ProjectStateClaim[]): string {
  const first = claims[0]!
  return `disagreement:${first.subject.kind}:${first.subject.id}:${first.field}:${[...claims].map(claim => claim.id).sort().join(',')}`
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function claimFingerprint(claim: ProjectStateClaim): string | null {
  try {
    const value = stableJson(claim.value)
    if (typeof value !== 'string') return null
    JSON.parse(value)
    return stableJson({
      projectRevision: claim.projectRevision,
      subject: claim.subject,
      field: claim.field,
      value,
      authority: claim.authority,
      actor: claim.actor,
      observedAt: claim.observedAt,
      evidenceRefs: claim.evidenceRefs,
      basis: claim.basis,
      supersedes: claim.supersedes,
    })
  } catch {
    return null
  }
}

function isStructurallyValidClaim(claim: ProjectStateClaim, projectRevision: number): boolean {
  return claim.projectRevision === projectRevision &&
    isNonEmptyString(claim.id) &&
    isNonEmptyString(claim.subject?.kind) &&
    isNonEmptyString(claim.subject?.id) &&
    isNonEmptyString(claim.field) &&
    isNonEmptyString(claim.actor) &&
    Number.isFinite(Date.parse(claim.observedAt)) &&
    Array.isArray(claim.evidenceRefs) &&
    claim.evidenceRefs.every(isNonEmptyString) &&
    (claim.basis === undefined || (isNonEmptyString(claim.basis.kind) && isNonEmptyString(claim.basis.id))) &&
    claimFingerprint(claim) !== null
}

function canonicalClaimValue(value: unknown, policy: ProjectStateClaimPolicy | undefined): unknown {
  return JSON.parse(stableClaimValue(value, policy))
}

function policyAuthorities(policy: ProjectStateClaimPolicy | undefined): readonly ProjectStateClaimAuthority[] {
  return policy?.authorities ?? DEFAULT_CLAIM_AUTHORITIES
}

function isStructurallyValidPolicy(policy: ProjectStateClaimPolicy): boolean {
  return isNonEmptyString(policy.field) &&
    policy.authorities.length > 0 &&
    new Set(policy.authorities).size === policy.authorities.length &&
    policy.authorities.every(authority => DEFAULT_CLAIM_AUTHORITIES.includes(authority)) &&
    ['rerun_verification', 'refresh_runtime', 'inspect_canonical_state', 'owner_scope_decision'].includes(policy.reconciliation) &&
    (policy.valueSemantics === undefined || policy.valueSemantics === 'exact' || policy.valueSemantics === 'unordered_string_set')
}

function canSupersedeClaim(input: {
  successor: ProjectStateClaim
  predecessor: ProjectStateClaim
  policy: ProjectStateClaimPolicy | undefined
}): boolean {
  const { successor, predecessor } = input
  if (successor.id === predecessor.id ||
    successor.projectRevision !== predecessor.projectRevision ||
    claimKey(successor) !== claimKey(predecessor)) return false
  const authorities = policyAuthorities(input.policy)
  const successorRank = authorities.indexOf(successor.authority)
  const predecessorRank = authorities.indexOf(predecessor.authority)
  return successorRank !== -1 && predecessorRank !== -1 && successorRank <= predecessorRank
}

/**
 * Resolve only claims from one project revision. Same-ranked incompatible
 * claims remain explicit conflicts; the resolver never uses prose, actor name,
 * or an arbitrary write order to settle project state.
 */
export function resolveProjectStateClaimSet(
  input: {
    projectRevision: number
    claims: readonly ProjectStateClaim[]
    policies: readonly ProjectStateClaimPolicy[]
  },
): ProjectStateClaimResolution {
  const policyRecordsByField = new Map<string, ProjectStateClaimPolicy[]>()
  for (const policy of input.policies) {
    const existing = policyRecordsByField.get(policy.field) ?? []
    existing.push(policy)
    policyRecordsByField.set(policy.field, existing)
  }
  const ambiguousPolicyFields = new Set<string>()
  const policiesByField = new Map<string, ProjectStateClaimPolicy>()
  for (const [field, policies] of policyRecordsByField) {
    const policyShapes = new Set(policies.map(policy => stableJson(policy)))
    const policy = policies[0]!
    if (!isStructurallyValidPolicy(policy) || policyShapes.size !== 1) {
      ambiguousPolicyFields.add(field)
      continue
    }
    policiesByField.set(field, policy)
  }
  const rejected = new Map<string, ProjectStateClaimRejectionCode>()
  const reject = (claim: ProjectStateClaim, code: ProjectStateClaimRejectionCode) => {
    rejected.set(claim.id || '<missing-claim-id>', code)
  }
  const structurallyValid = input.claims.filter(claim => {
    if (!isStructurallyValidClaim(claim, input.projectRevision)) {
      reject(claim, 'invalid_claim')
      return false
    }
    if (ambiguousPolicyFields.has(claim.field)) {
      reject(claim, 'ambiguous_policy')
      return false
    }
    if (!policiesByField.has(claim.field)) {
      reject(claim, 'unregistered_field')
      return false
    }
    return true
  })
  const claimsById = new Map<string, ProjectStateClaim[]>()
  for (const claim of structurallyValid) {
    const existing = claimsById.get(claim.id) ?? []
    existing.push(claim)
    claimsById.set(claim.id, existing)
  }
  for (const claims of claimsById.values()) {
    const fingerprints = new Set(claims.map(claimFingerprint))
    if (fingerprints.size > 1) {
      for (const claim of claims) reject(claim, 'duplicate_claim_id')
    }
  }
  let eligibleClaims = [...claimsById.values()]
    .filter(claims => !rejected.has(claims[0]!.id))
    // Replaying the exact same durable claim is idempotent, not a second
    // opinion. Divergent payloads for one ID were rejected above.
    .map(claims => [...claims].sort((left, right) => claimFingerprint(left)!.localeCompare(claimFingerprint(right)!))[0]!)
  const eligibleById = new Map(eligibleClaims.map(claim => [claim.id, claim]))
  for (const claim of eligibleClaims) {
    if (!claim.supersedes) continue
    const predecessor = eligibleById.get(claim.supersedes)
    if (predecessor && !canSupersedeClaim({
      successor: claim,
      predecessor,
      policy: policiesByField.get(claim.field),
    })) {
      reject(claim, 'invalid_supersession')
    }
  }
  eligibleClaims = eligibleClaims.filter(claim => !rejected.has(claim.id))
  const supersededClaimIds = new Set(eligibleClaims
    .map(claim => claim.supersedes)
    .filter((claimId): claimId is string => isNonEmptyString(claimId)))
  const groups = new Map<string, ProjectStateClaim[]>()
  for (const claim of eligibleClaims) {
    if (supersededClaimIds.has(claim.id)) continue
    const key = claimKey(claim)
    const existing = groups.get(key) ?? []
    existing.push(claim)
    groups.set(key, existing)
  }
  const resolved: ResolvedProjectStateClaim[] = []
  const disagreements: ProjectStateDisagreement[] = []
  for (const group of groups.values()) {
    const first = group[0]!
    const policy = policiesByField.get(first.field)
    const authorities = policyAuthorities(policy)
    const eligible = group.filter(claim => authorities.includes(claim.authority))
    if (eligible.length === 0) continue
    const rank = (claim: ProjectStateClaim): number => authorities.indexOf(claim.authority)
    const highestRank = Math.min(...eligible.map(rank))
    const strongest = eligible.filter(claim => rank(claim) === highestRank)
    const values = new Set(strongest.map(claim => stableClaimValue(claim.value, policy)))
    if (values.size === 1) {
      const winner = [...strongest].sort((left, right) => left.id.localeCompare(right.id))[0]!
      const winnerValue = stableClaimValue(winner.value, policy)
      const contradictoryClaimIds = eligible
        .filter(claim => stableClaimValue(claim.value, policy) !== winnerValue)
        .map(claim => claim.id)
        .sort()
      resolved.push({
        subject: winner.subject,
        field: winner.field,
        value: canonicalClaimValue(winner.value, policy),
        claimIds: strongest.map(claim => claim.id).sort(),
      })
      if (contradictoryClaimIds.length > 0) {
        disagreements.push({
          id: disagreementId(group),
          subject: winner.subject,
          field: winner.field,
          canonicalClaimIds: strongest.map(claim => claim.id).sort(),
          contradictoryClaimIds,
          state: 'resolved_by_authority',
          reconciliation: policy?.reconciliation ?? 'inspect_canonical_state',
        })
      }
      continue
    }
    const conflict: ProjectStateConflict = {
      id: claimConflictId(strongest),
      subject: first.subject,
      field: first.field,
      claimIds: strongest.map(claim => claim.id).sort(),
      reconciliation: policy?.reconciliation ?? 'inspect_canonical_state',
    }
    resolved.push({
      subject: first.subject,
      field: first.field,
      claimIds: conflict.claimIds,
      conflict,
    })
    disagreements.push({
      id: disagreementId(group),
      subject: first.subject,
      field: first.field,
      canonicalClaimIds: [],
      contradictoryClaimIds: conflict.claimIds,
      state: 'unresolved',
      reconciliation: conflict.reconciliation,
    })
  }
  return {
    resolved: resolved.sort((left, right) => claimKey(left).localeCompare(claimKey(right))),
    rejected: [...rejected.entries()]
      .map(([claimId, code]) => ({ claimId, code }))
      .sort((left, right) => left.claimId.localeCompare(right.claimId) || left.code.localeCompare(right.code)),
    disagreements: disagreements.sort((left, right) => left.id.localeCompare(right.id)),
  }
}

export function resolveProjectStateClaims(
  input: {
    projectRevision: number
    claims: readonly ProjectStateClaim[]
    policies: readonly ProjectStateClaimPolicy[]
  },
): ResolvedProjectStateClaim[] {
  return resolveProjectStateClaimSet(input).resolved
}

/**
 * Compare an agent/runtime observation against the resolved fact for the same
 * field. A lower-authority observation cannot replace canonical state, but a
 * disagreement is still explicit and carries the policy's repair action.
 */
export function reconcileProjectStateObservation(input: {
  projectRevision: number
  canonicalClaim: ProjectStateClaim
  observationClaim: ProjectStateClaim
  policy: ProjectStateClaimPolicy
}): ProjectStateObservationAgreement {
  const fallback = {
    canonicalClaimIds: [input.canonicalClaim.id],
    observationClaimId: input.observationClaim.id,
  }
  if (input.canonicalClaim.projectRevision !== input.projectRevision ||
    input.observationClaim.projectRevision !== input.projectRevision) {
    return { state: 'stale', reconciliation: input.policy.reconciliation, ...fallback }
  }
  if (claimKey(input.canonicalClaim) !== claimKey(input.observationClaim)) {
    const sameSubjectAndField =
      input.canonicalClaim.subject.kind === input.observationClaim.subject.kind &&
      input.canonicalClaim.subject.id === input.observationClaim.subject.id &&
      input.canonicalClaim.field === input.observationClaim.field
    return {
      state: sameSubjectAndField ? 'stale' : 'unavailable',
      reconciliation: input.policy.reconciliation,
      ...(sameSubjectAndField ? {} : { reason: 'incomparable_subject_or_field' as const }),
      ...fallback,
    }
  }
  const resolution = resolveProjectStateClaimSet({
    projectRevision: input.projectRevision,
    claims: [input.canonicalClaim, input.observationClaim],
    policies: [input.policy],
  })
  if (resolution.rejected.some(rejection => rejection.claimId === input.canonicalClaim.id)) {
    return { state: 'unavailable', reconciliation: input.policy.reconciliation, reason: 'invalid_canonical_claim', ...fallback }
  }
  if (resolution.rejected.some(rejection => rejection.claimId === input.observationClaim.id)) {
    return { state: 'unavailable', reconciliation: input.policy.reconciliation, reason: 'invalid_observation_claim', ...fallback }
  }
  const resolved = resolution.resolved.find(candidate =>
    candidate.subject.kind === input.canonicalClaim.subject.kind &&
    candidate.subject.id === input.canonicalClaim.subject.id &&
    candidate.field === input.canonicalClaim.field,
  )
  if (!resolved) {
    return { state: 'unavailable', reconciliation: input.policy.reconciliation, ...fallback }
  }
  const disagreement = resolution.disagreements.find(candidate =>
    candidate.subject.kind === input.canonicalClaim.subject.kind &&
    candidate.subject.id === input.canonicalClaim.subject.id &&
    candidate.field === input.canonicalClaim.field,
  )
  if (resolved.conflict) {
    return {
      state: 'contradictory',
      reconciliation: resolved.conflict.reconciliation,
      canonicalClaimIds: resolved.claimIds,
      observationClaimId: input.observationClaim.id,
      ...(disagreement ? { disagreement } : {}),
    }
  }
  if (resolved.value === undefined) {
    return { state: 'unavailable', reconciliation: input.policy.reconciliation, ...fallback }
  }
  return stableClaimValue(resolved.value, input.policy) === stableClaimValue(input.observationClaim.value, input.policy)
    ? {
        state: 'confirmed',
        canonicalClaimIds: resolved.claimIds,
        observationClaimId: input.observationClaim.id,
      }
    : {
        state: 'contradictory',
        reconciliation: input.policy.reconciliation,
        ...fallback,
        ...(disagreement ? { disagreement } : {}),
      }
}

/** Compare two reports through their registered field policy only. */
export function reconcileRegisteredProjectStateObservation(input: {
  projectRevision: number
  canonicalClaim: ProjectStateClaim
  observationClaim: ProjectStateClaim
}): ProjectStateObservationAgreement {
  if (input.canonicalClaim.field !== input.observationClaim.field) {
    return {
      state: 'unavailable',
      canonicalClaimIds: [input.canonicalClaim.id],
      observationClaimId: input.observationClaim.id,
      reason: 'incomparable_subject_or_field',
    }
  }
  return reconcileProjectStateObservation({
    ...input,
    policy: requireProjectStateClaimPolicy(input.canonicalClaim.field),
  })
}

export interface ProjectDecisionProjection {
  version: 1
  projectRevision: number | null
  queueRevision: number | null
  generatedAt: string
  execution: {
    state: 'runnable' | 'running' | 'paused' | 'blocked' | 'complete' | 'conflicted'
    code: string
    focusTaskId?: string
    focusTaskTitle?: string
    focusKind?: string
    count?: number
    message?: string
  }
  release: {
    state: 'ready' | 'not_ready' | 'unavailable' | 'conflicted'
    releaseId?: string
    blockerTaskIds: string[]
    proofBlockerTaskIds: string[]
  }
  ownerInput: { state: 'none' | 'required'; requestId?: string }
  primaryAction: {
    kind: 'open_work' | 'resume' | 'review_proof' | 'answer_owner_input' | 'review_release' | 'resolve_conflict' | 'none'
    targetId?: string
    reasonCode: string
  }
  conflicts: ProjectStateConflict[]
}

export interface ProjectDecisionProjectionInput {
  projectRevision?: number | null
  queueRevision?: number | null
  generatedAt: string
  start: Pick<ProjectScopeProjection['start'], 'canStart' | 'code' | 'focusTaskId' | 'focusTaskTitle' | 'focusKind' | 'count' | 'message'>
  release: {
    scopeMode: 'named_release' | 'unreleased' | 'unavailable'
    state: 'ready' | 'blocked' | 'active' | 'shaping' | 'unknown'
    release: { id: string } | null
    blockers: Array<{ owningTaskId?: string; code?: string }>
  }
  ownerInput?: { openCount: number; next?: { id: string; taskId?: string } | null } | null
  runStatus?: string | null
  /**
   * The supervisor owns this observation. A plan's saved next task is not a
   * substitute for a worker that is actually running right now.
   */
  runtimeExecution?: {
    activeTaskId?: string | null
    activeTaskTitle?: string | null
  } | null
  conflicts?: ProjectStateConflict[]
}

function executionState(input: ProjectDecisionProjectionInput): ProjectDecisionProjection['execution'] {
  const { start } = input
  if (input.conflicts?.some(conflict => conflict.field === 'execution')) {
    return { state: 'conflicted', code: 'state_conflict', message: 'Execution facts disagree.' }
  }
  if (input.runStatus === 'running' || input.runStatus === 'stopping') {
    const activeTaskId = input.runtimeExecution?.activeTaskId?.trim()
    const activeTaskTitle = input.runtimeExecution?.activeTaskTitle?.trim()
    return {
      state: 'running',
      code: input.runStatus,
      ...(activeTaskId ? { focusTaskId: activeTaskId } : {}),
      ...(activeTaskTitle ? { focusTaskTitle: activeTaskTitle } : {}),
      ...(activeTaskId ? { focusKind: 'active_work' } : {}),
      ...(typeof start.count === 'number' ? { count: start.count } : {}),
      message: input.runStatus === 'stopping'
        ? 'Guildhall is stopping the selected work.'
        : activeTaskTitle
          ? `Guildhall is working on "${activeTaskTitle}".`
          : activeTaskId
            ? 'Guildhall is working on the selected task.'
            : 'Guildhall is advancing the selected work.',
    }
  }
  if (start.code === 'ready_work') {
    return {
      state: 'runnable',
      code: start.code,
      ...(start.focusTaskId ? { focusTaskId: start.focusTaskId } : {}),
      ...(start.focusTaskTitle ? { focusTaskTitle: start.focusTaskTitle } : {}),
      ...(start.focusKind ? { focusKind: start.focusKind } : {}),
      ...(typeof start.count === 'number' ? { count: start.count } : {}),
      ...(start.message ? { message: start.message } : {}),
    }
  }
  if (start.code === 'paused_live_work') {
    return {
      state: 'paused',
      code: start.code,
      ...(start.focusTaskId ? { focusTaskId: start.focusTaskId } : {}),
      ...(start.focusTaskTitle ? { focusTaskTitle: start.focusTaskTitle } : {}),
      ...(start.focusKind ? { focusKind: start.focusKind } : {}),
      ...(typeof start.count === 'number' ? { count: start.count } : {}),
      ...(start.message ? { message: start.message } : {}),
    }
  }
  if (start.code === 'all_terminal') return { state: 'complete', code: start.code, ...(start.message ? { message: start.message } : {}) }
  return {
    state: 'blocked',
    code: start.code ?? 'unavailable',
    ...(start.focusTaskId ? { focusTaskId: start.focusTaskId } : {}),
    ...(start.focusTaskTitle ? { focusTaskTitle: start.focusTaskTitle } : {}),
    ...(start.focusKind ? { focusKind: start.focusKind } : {}),
    ...(typeof start.count === 'number' ? { count: start.count } : {}),
    ...(start.message ? { message: start.message } : {}),
  }
}

/**
 * Presentation layers receive readiness only from the shared decision packet.
 * This intentionally contains no task detail, inbox ranking, or prose parser.
 */
export function projectDecisionStartReadiness(decision: ProjectDecisionProjection): {
  canStart: boolean
  code: string
  message?: string
  focusTaskId?: string
  focusTaskTitle?: string
  focusKind?: string
  count?: number
} {
  return {
    canStart: decision.execution.state === 'runnable' ||
      decision.execution.state === 'running' ||
      decision.execution.state === 'paused',
    code: decision.execution.code,
    ...(decision.execution.message ? { message: decision.execution.message } : {}),
    ...(decision.execution.focusTaskId ? { focusTaskId: decision.execution.focusTaskId } : {}),
    ...(decision.execution.focusTaskTitle ? { focusTaskTitle: decision.execution.focusTaskTitle } : {}),
    ...(decision.execution.focusKind ? { focusKind: decision.execution.focusKind } : {}),
    ...(typeof decision.execution.count === 'number' ? { count: decision.execution.count } : {}),
  }
}

function primaryActionForDecision(input: {
  conflicts: ProjectStateConflict[]
  ownerInput: ProjectDecisionProjection['ownerInput']
  execution: ProjectDecisionProjection['execution']
  release: ProjectDecisionProjection['release']
}): ProjectDecisionProjection['primaryAction'] {
  const { conflicts, ownerInput, execution, release } = input
  return conflicts.length > 0
    ? { kind: 'resolve_conflict' as const, targetId: conflicts[0]!.id, reasonCode: 'state_conflict' }
    : ownerInput.state === 'required'
      ? { kind: 'answer_owner_input' as const, targetId: ownerInput.requestId, reasonCode: 'owner_input_required' }
      : execution.state === 'runnable'
        ? { kind: 'open_work' as const, targetId: execution.focusTaskId, reasonCode: execution.code }
        : execution.state === 'paused'
          ? { kind: 'resume' as const, targetId: execution.focusTaskId, reasonCode: execution.code }
          : execution.state === 'running'
            ? { kind: 'open_work' as const, targetId: execution.focusTaskId, reasonCode: execution.code }
            : execution.state === 'complete' && release.state === 'ready'
              ? { kind: 'review_release' as const, targetId: release.releaseId, reasonCode: 'release_ready' }
              : release.proofBlockerTaskIds.length > 0
                ? { kind: 'review_proof' as const, targetId: release.proofBlockerTaskIds[0], reasonCode: 'proof_evidence_missing' }
                : { kind: 'none' as const, reasonCode: execution.code }
}

/**
 * Runtime liveness is a separately-owned fact. Refresh only the execution
 * branch of an existing decision so a live worker can never inherit a stale
 * plan focus or cause a route-local re-ranking of project work.
 */
export function applyRuntimeExecutionToProjectDecision(
  decision: ProjectDecisionProjection,
  runtimeExecution: {
    status?: string | null
    activeTaskId?: string | null
    activeTaskTitle?: string | null
  } | null | undefined,
): ProjectDecisionProjection {
  const status = runtimeExecution?.status
  if (status !== 'running' && status !== 'stopping') return decision
  if (decision.conflicts.some(conflict => conflict.field === 'execution')) return decision
  const activeTaskId = runtimeExecution?.activeTaskId?.trim()
  const activeTaskTitle = runtimeExecution?.activeTaskTitle?.trim()
  const execution: ProjectDecisionProjection['execution'] = {
    state: 'running',
    code: status,
    ...(activeTaskId ? { focusTaskId: activeTaskId } : {}),
    ...(activeTaskTitle ? { focusTaskTitle: activeTaskTitle } : {}),
    ...(activeTaskId ? { focusKind: 'active_work' } : {}),
    ...(typeof decision.execution.count === 'number' ? { count: decision.execution.count } : {}),
    message: status === 'stopping'
      ? 'Guildhall is stopping the selected work.'
      : activeTaskTitle
        ? `Guildhall is working on "${activeTaskTitle}".`
        : activeTaskId
          ? 'Guildhall is working on the selected task.'
          : 'Guildhall is advancing the selected work.',
  }
  return {
    ...decision,
    execution,
    primaryAction: primaryActionForDecision({
      conflicts: decision.conflicts,
      ownerInput: decision.ownerInput,
      execution,
      release: decision.release,
    }),
  }
}

export function buildProjectDecisionProjection(input: ProjectDecisionProjectionInput): ProjectDecisionProjection {
  const conflicts = input.conflicts ?? []
  const execution = executionState(input)
  const blockerTaskIds = input.release.blockers
    .flatMap(blocker => blocker.owningTaskId ? [blocker.owningTaskId] : [])
    .filter((taskId, index, all) => all.indexOf(taskId) === index)
  const proofBlockerTaskIds = input.release.blockers
    .filter(blocker => blocker.code === 'proof_evidence_missing')
    .flatMap(blocker => blocker.owningTaskId ? [blocker.owningTaskId] : [])
    .filter((taskId, index, all) => all.indexOf(taskId) === index)
  const release = {
    state: conflicts.some(conflict => conflict.field === 'release')
      ? 'conflicted' as const
      : input.release.scopeMode === 'unavailable'
        ? 'unavailable' as const
        : input.release.state === 'ready'
          ? 'ready' as const
          : 'not_ready' as const,
    ...(input.release.release?.id ? { releaseId: input.release.release.id } : {}),
    blockerTaskIds,
    proofBlockerTaskIds,
  }
  const ownerInput = input.ownerInput && input.ownerInput.openCount > 0
    ? { state: 'required' as const, ...(input.ownerInput.next?.id ? { requestId: input.ownerInput.next.id } : {}) }
    : { state: 'none' as const }
  const primaryAction = primaryActionForDecision({ conflicts, ownerInput, execution, release })
  return {
    version: 1,
    projectRevision: input.projectRevision ?? null,
    queueRevision: input.queueRevision ?? null,
    generatedAt: input.generatedAt,
    execution,
    release,
    ownerInput,
    primaryAction,
    conflicts,
  }
}
