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
  /**
   * Producers allowed to report a typed observation. When omitted, only an
   * authority that can decide the field may report it. This separates a
   * useful dissent from permission to change the fact.
   */
  observationAuthorities?: readonly ProjectStateClaimAuthority[]
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
  | 'release.lifecycleState'
  | 'release.membershipTaskIds'
  | 'release.readiness'
  | 'release.blockerTaskIds'
  | 'task.lifecycleStatus'
  | 'task.specReviewAuthority'
  | 'task.hierarchy'
  | 'task.dependencies'
  | 'task.capabilityBindings'
  | 'task.reviewCriterionDisposition'
  | 'task.reviewEvidenceDisposition'
  | 'proof.status'
  | 'runtime.status'
  | 'runtime.activeTaskId'
  | 'project.executionFocus'
  | 'project.executionEligibility'
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
  'release.lifecycleState': {
    field: 'release.lifecycleState',
    authorities: ['canonical_mutation'],
    observationAuthorities: ['canonical_mutation', 'agent_derivation'],
    reconciliation: 'inspect_canonical_state',
  },
  'release.membershipTaskIds': {
    field: 'release.membershipTaskIds',
    authorities: ['canonical_mutation'],
    observationAuthorities: ['canonical_mutation', 'agent_derivation'],
    reconciliation: 'inspect_canonical_state',
    valueSemantics: 'unordered_string_set',
  },
  'release.readiness': {
    field: 'release.readiness',
    authorities: ['canonical_mutation', 'agent_derivation'],
    reconciliation: 'inspect_canonical_state',
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
  'task.specReviewAuthority': {
    field: 'task.specReviewAuthority',
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
  'runtime.activeTaskId': {
    field: 'runtime.activeTaskId',
    authorities: ['runtime_observation'],
    reconciliation: 'refresh_runtime',
  },
  'project.executionFocus': {
    field: 'project.executionFocus',
    // Planned scope focus and a live worker's active task are different facts.
    authorities: ['canonical_mutation'],
    reconciliation: 'inspect_canonical_state',
  },
  'project.executionEligibility': {
    field: 'project.executionEligibility',
    authorities: ['canonical_mutation', 'agent_derivation'],
    reconciliation: 'inspect_canonical_state',
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
  | 'unauthorized_authority'
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
    (policy.observationAuthorities === undefined ||
      (policy.observationAuthorities.length > 0 &&
        new Set(policy.observationAuthorities).size === policy.observationAuthorities.length &&
        policy.observationAuthorities.every(authority => DEFAULT_CLAIM_AUTHORITIES.includes(authority)))) &&
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
    const policy = policiesByField.get(claim.field)!
    const observationAuthorities = policy.observationAuthorities ?? policy.authorities
    if (!observationAuthorities.includes(claim.authority)) {
      reject(claim, 'unauthorized_authority')
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
      // A claim without authority cannot replace the resolved fact, but it is
      // still an observed disagreement that must remain inspectable.
      const contradictoryClaimIds = group
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

export interface ProjectDecisionExecution {
  state: 'runnable' | 'running' | 'paused' | 'blocked' | 'complete' | 'conflicted'
  code: string
  /**
   * The single decision focus identity. `focusTaskTitle` remains a temporary
   * wire-compatibility field, but it is derived from this reference whenever
   * a canonical task snapshot is available.
   */
  focus?: ProjectDecisionTaskRef
  focusTaskId?: string
  focusTaskTitle?: string
  focusKind?: string
  /** Exact selected-scope records behind an owner-review decision. */
  reviewTaskIds?: string[]
  count?: number
  progressState?: 'partial_work_saved'
  message?: string
}

export interface ProjectDecisionTaskRef {
  taskId: string
  displayTitle: string
  /** The task point's owning project revision when the caller has one. */
  taskRevision?: number
}

export interface ProjectDecisionProjection {
  version: 1
  projectRevision: number | null
  queueRevision: number | null
  generatedAt: string
  /** Canonical selected-scope execution state before a live supervisor overlays it. */
  planExecution?: ProjectDecisionExecution
  execution: ProjectDecisionExecution
  release: {
    state: 'ready' | 'not_ready' | 'unavailable' | 'conflicted'
    lifecycleState?: string
    releaseId?: string
    blockerTaskIds: string[]
    proofBlockerTaskIds: string[]
  }
  ownerInput: { state: 'none' | 'required'; requestId?: string }
  ownerReview: { state: 'none' | 'required'; taskId?: string; taskIds?: string[] }
  primaryAction: {
    kind: 'open_work' | 'resume' | 'review_proof' | 'answer_owner_input' | 'review_spec' | 'review_release' | 'resolve_conflict' | 'none'
    targetId?: string
    reasonCode: string
  }
  conflicts: ProjectStateConflict[]
}

export interface ProjectDecisionProjectionInput {
  projectRevision?: number | null
  queueRevision?: number | null
  generatedAt: string
  start: Pick<ProjectScopeProjection['start'], 'canStart' | 'code' | 'focusTaskId' | 'focusTaskTitle' | 'focusKind' | 'reviewTaskIds' | 'count' | 'progressState' | 'message'>
  release: {
    scopeMode: 'named_release' | 'unreleased' | 'unavailable'
    state: 'ready' | 'blocked' | 'active' | 'shaping' | 'unknown'
    release: { id: string } | null
    lifecycleState?: string
    blockers: Array<{ owningTaskId?: string; code?: string }>
  }
  ownerInput?: { openCount: number; next?: { id: string; taskId?: string } | null } | null
  ownerReview?: { openCount: number; taskIds?: string[]; next?: { taskId: string } | null } | null
  runStatus?: string | null
  /**
   * The supervisor owns this observation. A plan's saved next task is not a
   * substitute for a worker that is actually running right now.
   */
  runtimeExecution?: {
    activeTaskId?: string | null
    activeTaskTitle?: string | null
  } | null
  /**
   * Canonical task identities captured in the same project-state snapshot as
   * the decision. A route never supplies an independently cached title here.
   */
  canonicalTaskRefs?: readonly ProjectDecisionTaskRef[]
  conflicts?: ProjectStateConflict[]
}

function attachCanonicalFocus(
  execution: ProjectDecisionExecution,
  canonicalTaskRefs: readonly ProjectDecisionTaskRef[] | undefined,
): ProjectDecisionExecution {
  const taskId = execution.focusTaskId?.trim()
  if (!taskId) return execution
  const canonical = canonicalTaskRefs?.find(task => task.taskId === taskId)
  // A canonical snapshot is deliberately stronger than a saved decision
  // string. This prevents an advanced ID from retaining a previous task's
  // title after an approval or runtime transition.
  const displayTitle = canonical?.displayTitle.trim() || execution.focusTaskTitle?.trim()
  if (!displayTitle) return execution
  return {
    ...execution,
    focus: {
      taskId,
      displayTitle,
      ...(canonical?.taskRevision !== undefined ? { taskRevision: canonical.taskRevision } : {}),
    },
    focusTaskId: taskId,
    focusTaskTitle: displayTitle,
  }
}

function executionState(input: ProjectDecisionProjectionInput): ProjectDecisionExecution {
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
      ...(start.reviewTaskIds?.length ? { reviewTaskIds: [...start.reviewTaskIds] } : {}),
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
      ...(start.reviewTaskIds?.length ? { reviewTaskIds: [...start.reviewTaskIds] } : {}),
      ...(typeof start.count === 'number' ? { count: start.count } : {}),
      ...(start.progressState ? { progressState: start.progressState } : {}),
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
      ...(start.reviewTaskIds?.length ? { reviewTaskIds: [...start.reviewTaskIds] } : {}),
      ...(typeof start.count === 'number' ? { count: start.count } : {}),
      ...(start.progressState ? { progressState: start.progressState } : {}),
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
    ...(start.reviewTaskIds?.length ? { reviewTaskIds: [...start.reviewTaskIds] } : {}),
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
  reviewTaskIds?: string[]
  count?: number
  progressState?: 'partial_work_saved'
} {
  const focus = decision.execution.focus
  const code = decision.execution.focusKind === 'brief_cleanup' &&
    decision.execution.code === 'no_unattended_progress'
    ? 'owner_input_required'
    : decision.execution.code
  return {
    canStart: decision.execution.state === 'runnable' ||
      decision.execution.state === 'running' ||
      decision.execution.state === 'paused',
    code,
    ...(decision.execution.message ? { message: decision.execution.message } : {}),
    ...(focus?.taskId ?? decision.execution.focusTaskId ? { focusTaskId: focus?.taskId ?? decision.execution.focusTaskId } : {}),
    ...(focus?.displayTitle ?? decision.execution.focusTaskTitle ? { focusTaskTitle: focus?.displayTitle ?? decision.execution.focusTaskTitle } : {}),
    ...(decision.execution.focusKind ? { focusKind: decision.execution.focusKind } : {}),
    ...(decision.execution.reviewTaskIds?.length ? { reviewTaskIds: [...decision.execution.reviewTaskIds] } : {}),
    ...(typeof decision.execution.count === 'number' ? { count: decision.execution.count } : {}),
    ...(decision.execution.progressState ? { progressState: decision.execution.progressState } : {}),
  }
}

/**
 * Compose a compact live-work list from the shared decision packet. The
 * supervisor-owned active task always leads; saved rows remain historical
 * context and may not displace it with a stale local status.
 */
export function projectDecisionInFlight<T extends {
  id: string
  title: string
  status: string
  domain: string
  lastActivityAt?: string
}>(
  decision: ProjectDecisionProjection | null | undefined,
  items: readonly T[],
): T[] {
  const activeTaskId = decision?.execution.state === 'running'
    ? decision.execution.focusTaskId
    : undefined
  if (!activeTaskId) return [...items]
  const active = items.find(item => item.id === activeTaskId)
  const activeItem = {
    ...(active ?? {
      id: activeTaskId,
      title: decision?.execution.focusTaskTitle ?? activeTaskId,
      status: 'in_progress',
      domain: '',
    }),
    id: activeTaskId,
    title: decision?.execution.focusTaskTitle ?? active?.title ?? activeTaskId,
    status: 'in_progress',
    ...(decision?.generatedAt ? { lastActivityAt: decision.generatedAt } : {}),
  } as T
  return [activeItem, ...items.filter(item => item.id !== activeTaskId)]
}

function primaryActionForDecision(input: {
  conflicts: ProjectStateConflict[]
  ownerInput: ProjectDecisionProjection['ownerInput']
  ownerReview: ProjectDecisionProjection['ownerReview']
  execution: ProjectDecisionProjection['execution']
  release: ProjectDecisionProjection['release']
}): ProjectDecisionProjection['primaryAction'] {
  const { conflicts, ownerInput, ownerReview, execution, release } = input
  return release.lifecycleState === 'shipped'
    ? { kind: 'none' as const, reasonCode: 'release_shipped' }
    : conflicts.length > 0
    ? { kind: 'resolve_conflict' as const, targetId: conflicts[0]!.id, reasonCode: 'state_conflict' }
    : ownerInput.state === 'required'
      ? { kind: 'answer_owner_input' as const, targetId: ownerInput.requestId, reasonCode: 'owner_input_required' }
      : ownerReview.state === 'required'
        ? { kind: 'review_spec' as const, targetId: ownerReview.taskId, reasonCode: 'owner_review_required' }
      : execution.state === 'blocked' && execution.code === 'owner_input_required'
        ? { kind: 'answer_owner_input' as const, targetId: execution.focusTaskId, reasonCode: execution.code }
        : execution.state === 'blocked' && execution.code === 'owner_review_required'
          ? { kind: 'review_spec' as const, targetId: execution.focusTaskId, reasonCode: execution.code }
          : execution.state === 'blocked' && execution.code === 'no_unattended_progress' && execution.focusKind === 'brief_cleanup'
            ? { kind: 'answer_owner_input' as const, targetId: execution.focusTaskId, reasonCode: 'owner_input_required' }
            : execution.state === 'blocked' && execution.code === 'no_unattended_progress' && execution.focusKind === 'spec_review'
              ? { kind: 'review_spec' as const, targetId: execution.focusTaskId, reasonCode: 'owner_review_required' }
      : execution.state === 'runnable'
        ? { kind: 'open_work' as const, targetId: execution.focusTaskId, reasonCode: execution.code }
        : execution.state === 'paused'
          ? { kind: 'resume' as const, targetId: execution.focusTaskId, reasonCode: execution.code }
          : execution.state === 'running'
            ? { kind: 'open_work' as const, targetId: execution.focusTaskId, reasonCode: execution.code }
            : execution.state === 'complete' && release.state === 'ready' && release.lifecycleState !== 'shipped'
              ? { kind: 'review_release' as const, targetId: release.releaseId, reasonCode: 'release_ready' }
              : release.proofBlockerTaskIds.length > 0
                ? { kind: 'review_proof' as const, targetId: release.proofBlockerTaskIds[0], reasonCode: 'proof_evidence_missing' }
                : { kind: 'none' as const, reasonCode: execution.code }
}

/**
 * The action builder may prioritize a bounded task row more specifically than
 * scope readiness alone can. Fold that typed result into the decision packet
 * at summary-write time so routes never choose between two saved primaries.
 */
export function applyProjectActionModelPrimaryAction(
  decision: ProjectDecisionProjection,
  action: {
    source?: string
    taskId?: string
    taskLabel?: string
    code?: string
    label?: string
    detail?: string
  } | null | undefined,
): ProjectDecisionProjection {
  if (!action || decision.conflicts.length > 0 || decision.ownerInput.state === 'required' || decision.ownerReview.state === 'required') return decision
  if (decision.release.lifecycleState === 'shipped') return decision
  if (
    decision.execution.state === 'complete' &&
    decision.release.state === 'ready'
  ) return decision
  const taskId = action.taskId?.trim()
  if (!taskId) return decision
  const kind = action.source === 'owner_input'
    ? 'answer_owner_input' as const
    : action.code === 'proof_evidence_missing'
      ? 'review_proof' as const
      : decision.execution.state === 'paused'
        ? 'resume' as const
        : 'open_work' as const
  const actionTitle = action.taskLabel?.trim() || action.label?.trim() || decision.execution.focusTaskTitle || taskId
  // The shared action model may surface a concrete blocked task after saved
  // readiness picked unrelated resumable work. Keep every summary consumer on
  // that same focus instead of leaving orientation on the stale task.
  const actionOwnsExecutionFocus = action.source === 'start_readiness' || action.code === 'blocked_work'
  const execution = actionOwnsExecutionFocus
    ? {
        ...decision.execution,
        state: action.code === 'ready_work'
          ? 'runnable' as const
          : action.code === 'blocked_work'
            ? 'blocked' as const
            : decision.execution.state,
        code: action.code ?? decision.execution.code,
        focusKind: action.code === 'blocked_work' ? 'blocked_work' : decision.execution.focusKind,
        focusTaskId: taskId,
        focusTaskTitle: actionTitle,
        focus: { taskId, displayTitle: actionTitle },
        ...(action.detail?.trim() ? { message: action.detail.trim() } : {}),
      }
    : decision.execution
  return {
    ...decision,
    execution,
    primaryAction: {
      kind,
      targetId: taskId,
      reasonCode: action.code ?? decision.primaryAction.reasonCode,
    },
  }
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
  if (status !== 'running' && status !== 'stopping') {
    if (decision.execution.state !== 'running') return decision
    const execution = decision.planExecution ?? {
      state: 'blocked' as const,
      code: 'plan_execution_missing',
      message: 'Guildhall stopped. Refresh the saved project plan before starting more work.',
    }
    return {
      ...decision,
      execution,
      primaryAction: primaryActionForDecision({
        conflicts: decision.conflicts,
        ownerInput: decision.ownerInput,
        ownerReview: decision.ownerReview,
        execution,
        release: decision.release,
      }),
    }
  }
  if (decision.conflicts.some(conflict => conflict.field === 'execution')) return decision
  // A live supervisor can still be flushing state after it has produced a
  // concrete owner handoff. Preserve that handoff as the decision authority;
  // callers receive runtime status separately for the pause/control surface.
  // Otherwise every route would replace "Review brief" with generic work
  // activity for the same project snapshot.
  if (
    decision.planExecution?.state === 'blocked' &&
    (
      decision.planExecution.code === 'owner_input_required' ||
      decision.planExecution.code === 'owner_review_required' ||
      (
        decision.planExecution.code === 'no_unattended_progress' &&
        (decision.planExecution.focusKind === 'brief_cleanup' || decision.planExecution.focusKind === 'spec_review')
      )
    )
  ) {
    return {
      ...decision,
      execution: decision.planExecution,
      primaryAction: primaryActionForDecision({
        conflicts: decision.conflicts,
        ownerInput: decision.ownerInput,
        ownerReview: decision.ownerReview,
        execution: decision.planExecution,
        release: decision.release,
      }),
    }
  }
  const activeTaskId = runtimeExecution?.activeTaskId?.trim()
  const activeTaskTitle = runtimeExecution?.activeTaskTitle?.trim()
  const execution: ProjectDecisionExecution = {
    state: 'running',
    code: status,
    ...(activeTaskId ? { focusTaskId: activeTaskId } : {}),
    ...(activeTaskTitle ? { focusTaskTitle: activeTaskTitle } : {}),
    ...(activeTaskId ? { focusKind: 'active_work' } : {}),
    ...(decision.execution.reviewTaskIds?.length ? { reviewTaskIds: [...decision.execution.reviewTaskIds] } : {}),
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
      ownerReview: decision.ownerReview,
      execution,
      release: decision.release,
    }),
  }
}

export function buildProjectDecisionProjection(input: ProjectDecisionProjectionInput): ProjectDecisionProjection {
  const conflicts = input.conflicts ?? []
  const planExecution = attachCanonicalFocus(executionState({
    ...input,
    runStatus: 'stopped',
    runtimeExecution: null,
  }), input.canonicalTaskRefs)
  const execution = attachCanonicalFocus(executionState(input), input.canonicalTaskRefs)
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
    ...(input.release.lifecycleState ? { lifecycleState: input.release.lifecycleState } : {}),
    blockerTaskIds,
    proofBlockerTaskIds,
  }
  const ownerInput = input.ownerInput && input.ownerInput.openCount > 0
    ? { state: 'required' as const, ...(input.ownerInput.next?.id ? { requestId: input.ownerInput.next.id } : {}) }
    : { state: 'none' as const }
  const ownerReview = input.ownerReview && input.ownerReview.openCount > 0
    ? {
        state: 'required' as const,
        ...(input.ownerReview.next?.taskId ? { taskId: input.ownerReview.next.taskId } : {}),
        ...(input.ownerReview.taskIds?.length ? { taskIds: [...input.ownerReview.taskIds] } : {}),
      }
    : { state: 'none' as const }
  const primaryAction = primaryActionForDecision({ conflicts, ownerInput, ownerReview, execution, release })
  return {
    version: 1,
    projectRevision: input.projectRevision ?? null,
    queueRevision: input.queueRevision ?? null,
    generatedAt: input.generatedAt,
    planExecution,
    execution,
    release,
    ownerInput,
    ownerReview,
    primaryAction,
    conflicts,
  }
}
