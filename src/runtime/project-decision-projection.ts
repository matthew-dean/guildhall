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

export interface RejectedProjectStateClaim {
  claimId: string
  code: ProjectStateClaimRejectionCode
}

export interface ProjectStateClaimResolution {
  resolved: ResolvedProjectStateClaim[]
  rejected: RejectedProjectStateClaim[]
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

function claimKey(claim: Pick<ProjectStateClaim, 'subject' | 'field'>): string {
  return `${claim.subject.kind}:${claim.subject.id}:${claim.field}`
}

function claimConflictId(claims: readonly ProjectStateClaim[]): string {
  const first = claims[0]!
  return `conflict:${first.subject.kind}:${first.subject.id}:${first.field}:${[...claims].map(claim => claim.id).sort().join(',')}`
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
    claimFingerprint(claim) !== null
}

function canonicalClaimValue(value: unknown, policy: ProjectStateClaimPolicy | undefined): unknown {
  return JSON.parse(stableClaimValue(value, policy))
}

function policyAuthorities(policy: ProjectStateClaimPolicy | undefined): readonly ProjectStateClaimAuthority[] {
  return policy?.authorities ?? DEFAULT_CLAIM_AUTHORITIES
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
  const policiesByField = new Map(input.policies.map(policy => [policy.field, policy]))
  const rejected = new Map<string, ProjectStateClaimRejectionCode>()
  const reject = (claim: ProjectStateClaim, code: ProjectStateClaimRejectionCode) => {
    rejected.set(claim.id || '<missing-claim-id>', code)
  }
  const structurallyValid = input.claims.filter(claim => {
    if (isStructurallyValidClaim(claim, input.projectRevision)) return true
    reject(claim, 'invalid_claim')
    return false
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
      resolved.push({
        subject: winner.subject,
        field: winner.field,
        value: canonicalClaimValue(winner.value, policy),
        claimIds: strongest.map(claim => claim.id).sort(),
      })
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
  }
  return {
    resolved: resolved.sort((left, right) => claimKey(left).localeCompare(claimKey(right))),
    rejected: [...rejected.entries()]
      .map(([claimId, code]) => ({ claimId, code }))
      .sort((left, right) => left.claimId.localeCompare(right.claimId) || left.code.localeCompare(right.code)),
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
    return {
      state: 'unavailable',
      reconciliation: input.policy.reconciliation,
      reason: 'incomparable_subject_or_field',
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
  if (!resolved || resolved.value === undefined) {
    return { state: 'unavailable', reconciliation: input.policy.reconciliation, ...fallback }
  }
  if (resolved.conflict) {
    return {
      state: 'contradictory',
      reconciliation: resolved.conflict.reconciliation,
      canonicalClaimIds: resolved.claimIds,
      observationClaimId: input.observationClaim.id,
    }
  }
  return stableClaimValue(resolved.value, input.policy) === stableClaimValue(input.observationClaim.value, input.policy)
    ? {
        state: 'confirmed',
        canonicalClaimIds: resolved.claimIds,
        observationClaimId: input.observationClaim.id,
      }
    : { state: 'contradictory', reconciliation: input.policy.reconciliation, ...fallback }
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
  start: Pick<ProjectScopeProjection['start'], 'canStart' | 'code' | 'focusTaskId' | 'focusTaskTitle' | 'focusKind' | 'message'>
  release: {
    scopeMode: 'named_release' | 'unreleased' | 'unavailable'
    state: 'ready' | 'blocked' | 'active' | 'shaping' | 'unknown'
    release: { id: string } | null
    blockers: Array<{ owningTaskId?: string; code?: string }>
  }
  ownerInput?: { openCount: number; next?: { id: string; taskId?: string } | null } | null
  runStatus?: string | null
  conflicts?: ProjectStateConflict[]
}

function executionState(input: ProjectDecisionProjectionInput): ProjectDecisionProjection['execution'] {
  const { start } = input
  if (input.conflicts?.some(conflict => conflict.field === 'execution')) {
    return { state: 'conflicted', code: 'state_conflict', message: 'Execution facts disagree.' }
  }
  if (input.runStatus === 'running' || input.runStatus === 'stopping') {
    return {
      state: 'running',
      code: input.runStatus,
      ...(start.focusTaskId ? { focusTaskId: start.focusTaskId } : {}),
      ...(start.focusTaskTitle ? { focusTaskTitle: start.focusTaskTitle } : {}),
      ...(start.focusKind ? { focusKind: start.focusKind } : {}),
      ...(start.message ? { message: start.message } : {}),
    }
  }
  if (start.code === 'ready_work') {
    return {
      state: 'runnable',
      code: start.code,
      ...(start.focusTaskId ? { focusTaskId: start.focusTaskId } : {}),
      ...(start.focusTaskTitle ? { focusTaskTitle: start.focusTaskTitle } : {}),
      ...(start.focusKind ? { focusKind: start.focusKind } : {}),
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
  const primaryAction = conflicts.length > 0
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
              : proofBlockerTaskIds.length > 0
                ? { kind: 'review_proof' as const, targetId: proofBlockerTaskIds[0], reasonCode: 'proof_evidence_missing' }
                : { kind: 'none' as const, reasonCode: execution.code }
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
