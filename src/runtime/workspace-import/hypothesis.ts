import type { WorkspaceInventory } from './detect.js'
import type { WorkspaceSignal } from './types.js'
import type { ImportSemanticKind } from '../import-semantic-kind.js'

/**
 * Deterministic hypothesis former (FR-34 step 3).
 *
 * Input: the raw `WorkspaceInventory` produced by `detectWorkspaceSignals`.
 * Output: a draft import that the human can preview in the dashboard and
 * that the workspace-importer agent refines during its reserved task.
 *
 * Intent mapping:
 *   - `goal`      → `goals[]`       (north-stars for the project)
 *   - `open_work` → `tasks[]`       (candidate tasks to seed TASKS.json)
 *   - `milestone` → `milestones[]`  (progress backfill — already-done work)
 *   - `context`   → `context[]`     (framing that informs future tasks)
 *
 * Dedup is deliberate, but identity is source-owned: README + ROADMAP + TODO
 * comments may echo each other only when their adapters emit the same signal
 * identity. Wording normalization is presentation cleanup only; it never
 * decides whether two work records are the same.
 */

export type DraftConfidence = 'high' | 'medium' | 'low'

export interface DraftSourceClaim {
  signalId?: string
  source: string
  title: string
  evidence: string
  references?: readonly string[]
  role?: 'capability' | 'reference' | 'brief_input'
  structure?: 'record' | 'note'
  scopeHint?: 'current' | 'later'
  releaseId?: string
  releaseLabel?: string
  confidence: DraftConfidence
  linkedTaskHints?: readonly string[]
  taskDisposition?: 'candidate' | 'context_only' | 'ignore'
}

export interface DraftGoal {
  id: string
  title: string
  rationale: string
  source: string
  references?: readonly string[]
  confidence: DraftConfidence
}

export interface DraftTask {
  /**
   * Stable suggested id derived from the normalized title. The reserved
   * importer task rewrites these before merging into TASKS.json so they
   * follow the project's `<area>-<n>` convention.
   */
  suggestedId: string
  title: string
  /** Source-owned identity. Never derive this from title or description. */
  sourceIdentity?: string
  /** Explicit structural identity for later evidence-graph reconciliation. */
  deliverableName?: string
  producedArtifact?: string
  /** Explicit graph metadata; never inferred from task prose. */
  workShape?: import('../evidence-work-graph-intake.js').EvidenceWorkShape
  statusHint?: import('../evidence-work-graph-intake.js').EvidenceStatusHint
  targetArea?: string
  buildsOn?: readonly string[]
  consumerSurfaces?: readonly string[]
  /** Explicit intake metadata; never inferred from the task title. */
  semanticKind?: ImportSemanticKind
  /** Explicit contract surface owned by this task; never inferred from title prose. */
  contractNames?: readonly string[]
  /** Explicit parent acceptance links; never inferred from criterion prose. */
  parentAcceptanceCriterionIds?: readonly string[]
  description: string
  whyThisMayMatter?: string
  assumptions?: readonly string[]
  missingInformation?: readonly string[]
  domain: string
  scope: 'current' | 'later'
  priority: 'critical' | 'high' | 'normal' | 'low'
  acceptanceCriteria?: ReadonlyArray<{
    id: string
    description: string
    scenario?: string
    expectation?: string
    verifiedBy?: string
    command?: string
    expectedExit?: 'zero' | 'non_zero'
    expectedOutputIncludes?: string[]
    evidenceHint?: string
    negativeCase?: string
  }>
  dependsOn?: readonly string[]
  proofPaths?: ReadonlyArray<Record<string, unknown>>
  releaseIds?: readonly string[]
  sourceClaims?: readonly DraftSourceClaim[]
  source: string
  references?: readonly string[]
  confidence: DraftConfidence
}

export interface DraftRelease {
  id: string
  label: string
  source: string
  scope?: 'current' | 'later'
  references?: readonly string[]
  confidence: DraftConfidence
}

export interface DraftMilestone {
  title: string
  evidence: string
  source: string
  references?: readonly string[]
}

export interface DraftContext {
  label: string
  excerpt: string
  source: string
  references?: readonly string[]
  domain?: string
  role?: 'capability' | 'reference' | 'brief_input'
  structure?: 'record' | 'note'
  scopeHint?: 'current' | 'later'
  releaseIds?: readonly string[]
  linkedTaskHints?: readonly string[]
}

export interface WorkspaceImportDraft {
  goals: readonly DraftGoal[]
  releases?: readonly DraftRelease[]
  tasks: readonly DraftTask[]
  milestones: readonly DraftMilestone[]
  context: readonly DraftContext[]
  /**
   * Totals for dashboard previews. `inputSignals` is the raw count across all
   * sources; `drafted` is how many ended up in the four buckets above;
   * `deduped` counts signals merged into an existing draft entry.
   */
  stats: {
    inputSignals: number
    drafted: number
    deduped: number
  }
}

function normalize(title: string): string {
  return title
    .toLowerCase()
    .replace(/\bui-([a-z0-9][a-z0-9-]*)\b/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stableHash(input: string): string {
  let h = 0x811c9dc5
  for (const ch of input) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36).slice(0, 7)
}

function compactGeneratedId(prefix: string, identity: string, fallback: number): string {
  const key = identity.trim()
  return `${prefix}-${stableHash(key || String(fallback))}`
}

function signalIdentity(sig: WorkspaceSignal, fallback: number): string {
  const signalId = sig.signalId?.trim()
  return signalId || `${sig.source}:ordinal:${fallback}`
}

function supportingText(title: string, evidence: string): string {
  return normalize(title) === normalize(evidence) ? '' : evidence
}

const CONFIDENCE_RANK: Record<DraftConfidence, number> = {
  high: 2,
  medium: 1,
  low: 0,
}

function mergeReferences(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): string[] | undefined {
  const out = new Set<string>()
  for (const r of a ?? []) out.add(r)
  for (const r of b ?? []) out.add(r)
  return out.size > 0 ? [...out] : undefined
}

function priorityFromConfidence(confidence: DraftConfidence): DraftTask['priority'] {
  if (confidence === 'high') return 'normal'
  if (confidence === 'medium') return 'normal'
  return 'low'
}

function draftTaskAssumptions(sig: WorkspaceSignal): string[] {
  const assumptions: string[] = []
  if (sig.source === 'roadmap' || sig.source === 'planning-docs') {
    assumptions.push('This item still reflects current project intent and has not already been completed or superseded elsewhere.')
  }
  if (sig.confidence === 'low') {
    assumptions.push('The source signal may be incomplete and should be confirmed against current repo reality before shaping proceeds.')
  }
  return assumptions
}

function draftTaskMissingInformation(sig: WorkspaceSignal): string[] {
  const missing: string[] = []
  const supporting = supportingText(sig.title, sig.evidence)
  if (!supporting) {
    missing.push('The source names the work, but not yet the concrete outcome or proof boundary.')
  }
  if (sig.confidence !== 'high') {
    missing.push('Guildhall still needs to confirm scope, current relevance, and success criteria during shaping.')
  }
  return missing
}

function domainFromSignal(sig: WorkspaceSignal): string {
  if (typeof sig.domainHint === 'string' && sig.domainHint.trim()) {
    return sig.domainHint.trim()
  }
  return 'core'
}

function scopeFromSignal(sig: WorkspaceSignal): DraftTask['scope'] {
  return sig.scopeHint === 'later' ? 'later' : 'current'
}

function releaseIdsFromSignal(sig: WorkspaceSignal): string[] | undefined {
  const releaseId = sig.releaseId?.trim()
  if (!releaseId) return undefined
  return [releaseId]
}

function releaseFromSignal(sig: WorkspaceSignal): DraftRelease | null {
  const releaseId = sig.releaseId?.trim()
  const label = sig.releaseLabel?.trim()
  if (!releaseId || !label) return null
  return {
    id: releaseId,
    label,
    source: sig.source,
    ...(sig.scopeHint ? { scope: scopeFromSignal(sig) } : {}),
    ...(sig.references ? { references: sig.references } : {}),
    confidence: sig.confidence,
  }
}

/**
 * Folds the raw inventory into a preview-ready draft. Pure function — no IO,
 * no randomness, no wall-clock. Given the same inventory you get the same
 * draft every call, which matters because the dashboard re-renders on every
 * inventory refresh and IDs must be stable.
 */
export function formWorkspaceHypothesis(
  inventory: WorkspaceInventory,
): WorkspaceImportDraft {
  const goalIndex = new Map<string, DraftGoal>()
  const releaseIndex = new Map<string, DraftRelease>()
  const taskIndex = new Map<string, DraftTask>()
  const milestoneIndex = new Map<string, DraftMilestone>()
  const contextIndex = new Map<string, DraftContext>()
  let deduped = 0

  const bump = (
    current: { confidence: DraftConfidence } | undefined,
    next: DraftConfidence,
  ): boolean => {
    if (!current) return true
    return CONFIDENCE_RANK[next] > CONFIDENCE_RANK[current.confidence]
  }

  for (const [signalIndex, sig] of inventory.signals.entries()) {
    addRelease(releaseIndex, sig, bump)
    if (sig.taskDisposition === 'ignore') continue
    if (sig.kind === 'goal') addGoal(goalIndex, sig, bump, signalIndex)
    else if (sig.kind === 'open_work') {
      if (sig.taskDisposition === 'context_only') addContext(contextIndex, sig, signalIndex)
      else addTask(taskIndex, sig, bump, signalIndex)
    }
    else if (sig.kind === 'milestone') addMilestone(milestoneIndex, sig, signalIndex)
    else if (sig.kind === 'context') addContext(contextIndex, sig, signalIndex)
  }

  // Count merges: signals − unique entries across all buckets.
  const uniques =
    goalIndex.size + releaseIndex.size + taskIndex.size + milestoneIndex.size + contextIndex.size
  deduped = Math.max(0, inventory.signals.length - uniques)

  const goals = [...goalIndex.values()]
  const context = [...contextIndex.values()]
  const preliminaryReleases = [...releaseIndex.values()]
  const tasks = assignCurrentReleaseScopes(
    enrichTasksWithRelatedContext(mergeSameIdentityTasks([...taskIndex.values()]), context),
    preliminaryReleases,
  )
  const releases = deriveReleaseScopesFromDraft(preliminaryReleases, tasks, context)
  const milestones = [...milestoneIndex.values()]

  return {
    goals,
    ...(releases.length > 0 ? { releases } : {}),
    tasks,
    milestones,
    context,
    stats: {
      inputSignals: inventory.signals.length,
      drafted: uniques,
      deduped,
    },
  }
}

function mergeSameIdentityTasks(tasks: DraftTask[]): DraftTask[] {
  const byKey = new Map<string, DraftTask>()
  for (const task of tasks) {
    const key = task.sourceIdentity || task.suggestedId
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, task)
      continue
    }
    byKey.set(key, {
      ...existing,
      scope: existing.scope === 'later' || task.scope === 'later' ? 'later' : 'current',
      priority: CONFIDENCE_RANK[task.confidence] > CONFIDENCE_RANK[existing.confidence]
        ? task.priority
        : existing.priority,
      confidence: CONFIDENCE_RANK[task.confidence] > CONFIDENCE_RANK[existing.confidence]
        ? task.confidence
        : existing.confidence,
      references: mergeReferences(existing.references, task.references),
      releaseIds: mergeReferences(existing.releaseIds, task.releaseIds),
      sourceClaims: mergeSourceClaims(existing.sourceClaims, task.sourceClaims),
    })
  }
  return [...byKey.values()]
}

function deriveReleaseScopesFromDraft(
  releases: readonly DraftRelease[],
  tasks: readonly DraftTask[],
  context: readonly DraftContext[],
): DraftRelease[] {
  const releaseUsage = new Map<string, { currentTask: boolean; later: boolean }>()
  const touch = (releaseId: string, update: Partial<{ currentTask: boolean; later: boolean }>) => {
    const existing = releaseUsage.get(releaseId) ?? { currentTask: false, later: false }
    releaseUsage.set(releaseId, {
      currentTask: existing.currentTask || Boolean(update.currentTask),
      later: existing.later || Boolean(update.later),
    })
  }
  for (const task of tasks) {
    for (const releaseId of task.releaseIds ?? []) {
      touch(releaseId, task.scope === 'current' ? { currentTask: true } : { later: true })
    }
  }
  for (const item of context) {
    for (const releaseId of item.releaseIds ?? []) {
      touch(releaseId, item.scopeHint === 'current' ? { currentTask: false } : { later: true })
    }
  }
  return releases.map(release => {
    const usage = releaseUsage.get(release.id)
    const scope = usage?.currentTask ? 'current' : 'later'
    return { ...release, scope }
  })
}

function addRelease(
  index: Map<string, DraftRelease>,
  sig: WorkspaceSignal,
  bump: (cur: { confidence: DraftConfidence } | undefined, next: DraftConfidence) => boolean,
): void {
  const release = releaseFromSignal(sig)
  if (!release) return
  const existing = index.get(release.id)
  if (!existing) {
    index.set(release.id, release)
    return
  }
  const refs = mergeReferences(existing.references, release.references)
  const shouldBump = bump(existing, release.confidence)
  const mergedScope = existing.scope === 'current' || release.scope === 'current' ? 'current' : existing.scope ?? release.scope
  if (shouldBump) {
    index.set(release.id, {
      ...release,
      ...(mergedScope ? { scope: mergedScope } : {}),
      ...(refs ? { references: refs } : {}),
    })
    return
  }
  if (refs || mergedScope) {
    index.set(release.id, {
      ...existing,
      ...(refs ? { references: refs } : {}),
      ...(mergedScope ? { scope: mergedScope } : {}),
    })
  }
}

function addGoal(
  index: Map<string, DraftGoal>,
  sig: WorkspaceSignal,
  bump: (cur: { confidence: DraftConfidence } | undefined, next: DraftConfidence) => boolean,
  signalIndex: number,
): void {
  if (!sig.title.trim()) return
  const identity = signalIdentity(sig, signalIndex)
  const key = identity
  if (!key) return
  const existing = index.get(key)
  if (!existing) {
    index.set(key, {
      id: compactGeneratedId('goal', identity, index.size + 1),
      title: sig.title,
      rationale: supportingText(sig.title, sig.evidence),
      source: sig.source,
      ...(sig.references ? { references: sig.references } : {}),
      confidence: sig.confidence,
    })
    return
  }
  const shouldBump = bump(existing, sig.confidence)
  const merged: DraftGoal = {
    ...existing,
    confidence: shouldBump ? sig.confidence : existing.confidence,
  }
  const refs = mergeReferences(existing.references, sig.references)
  if (refs) merged.references = refs
  if (shouldBump) {
    merged.rationale = supportingText(sig.title, sig.evidence)
    merged.source = sig.source
  }
  index.set(key, merged)
}

function addTask(
  index: Map<string, DraftTask>,
  sig: WorkspaceSignal,
  bump: (cur: { confidence: DraftConfidence } | undefined, next: DraftConfidence) => boolean,
  signalIndex: number,
): void {
  if (!sig.title.trim()) return
  const sourceIdentity = signalIdentity(sig, signalIndex)
  const key = `signal:${sourceIdentity}`
  if (!key) return
  const existing = index.get(key)
  const sourceClaim = sourceClaimFromSignal(sig, signalIndex)
  if (!existing) {
    index.set(key, {
      suggestedId: compactGeneratedId('task-import', sourceIdentity, index.size + 1),
      title: sig.title,
      sourceIdentity,
      description: supportingText(sig.title, sig.evidence),
      ...(supportingText(sig.title, sig.evidence) ? { whyThisMayMatter: sig.evidence } : {}),
      assumptions: draftTaskAssumptions(sig),
      missingInformation: draftTaskMissingInformation(sig),
      domain: domainFromSignal(sig),
      scope: scopeFromSignal(sig),
      priority: priorityFromConfidence(sig.confidence),
      source: sig.source,
      ...(sig.references ? { references: sig.references } : {}),
      ...(releaseIdsFromSignal(sig) ? { releaseIds: releaseIdsFromSignal(sig) } : {}),
      sourceClaims: [sourceClaim],
      confidence: sig.confidence,
    })
    return
  }
  const shouldBump = bump(existing, sig.confidence)
  const merged: DraftTask = {
    ...existing,
    confidence: shouldBump ? sig.confidence : existing.confidence,
    domain:
      existing.domain === 'core' && domainFromSignal(sig) !== 'core'
        ? domainFromSignal(sig)
        : existing.domain,
    scope:
      existing.scope === 'later' || scopeFromSignal(sig) === 'later'
        ? 'later'
        : 'current',
    priority: shouldBump
      ? priorityFromConfidence(sig.confidence)
      : existing.priority,
  }
  const refs = mergeReferences(existing.references, sig.references)
  if (refs) merged.references = refs
  const releaseIds = mergeReferences(existing.releaseIds, releaseIdsFromSignal(sig))
  if (releaseIds) merged.releaseIds = releaseIds
  merged.sourceClaims = mergeSourceClaims(existing.sourceClaims, [sourceClaim])
  if (shouldBump) {
    if (scopeFromSignal(sig) === 'later') merged.title = sig.title
    merged.description = supportingText(sig.title, sig.evidence)
    merged.whyThisMayMatter = supportingText(sig.title, sig.evidence) ? sig.evidence : existing.whyThisMayMatter
    merged.assumptions = draftTaskAssumptions(sig)
    merged.missingInformation = draftTaskMissingInformation(sig)
    merged.source = sig.source
  }
  index.set(key, merged)
}

function sourceClaimFromSignal(sig: WorkspaceSignal, signalIndex = 0): DraftSourceClaim {
  return {
    signalId: signalIdentity(sig, signalIndex),
    source: sig.source,
    title: sig.title,
    evidence: sig.evidence,
    ...(sig.references ? { references: sig.references } : {}),
    ...(sig.role ? { role: sig.role } : {}),
    ...(sig.structure ? { structure: sig.structure } : {}),
    ...(sig.scopeHint ? { scopeHint: sig.scopeHint } : {}),
    ...(sig.releaseId ? { releaseId: sig.releaseId } : {}),
    ...(sig.releaseLabel ? { releaseLabel: sig.releaseLabel } : {}),
    confidence: sig.confidence,
    ...(sig.linkedTaskHints ? { linkedTaskHints: sig.linkedTaskHints } : {}),
    ...(sig.taskDisposition ? { taskDisposition: sig.taskDisposition } : {}),
  }
}

function mergeSourceClaims(
  left: readonly DraftSourceClaim[] | undefined,
  right: readonly DraftSourceClaim[] | undefined,
): DraftSourceClaim[] | undefined {
  const claims = [...(left ?? []), ...(right ?? [])]
  if (claims.length === 0) return undefined
  const byKey = new Map<string, DraftSourceClaim>()
  for (const [index, claim] of claims.entries()) {
    const key = claim.signalId
      ? `source:${claim.source}:signal:${claim.signalId}`
      : `${claim.source}:ordinal:${index}`
    if (!byKey.has(key)) byKey.set(key, claim)
  }
  return [...byKey.values()]
}

function addMilestone(
  index: Map<string, DraftMilestone>,
  sig: WorkspaceSignal,
  signalIndex: number,
): void {
  if (!sig.title.trim()) return
  const key = signalIdentity(sig, signalIndex)
  if (!key) return
  const existing = index.get(key)
  if (!existing) {
    index.set(key, {
      title: sig.title,
      evidence: sig.evidence,
      source: sig.source,
      ...(sig.references ? { references: sig.references } : {}),
    })
    return
  }
  const refs = mergeReferences(existing.references, sig.references)
  if (refs) index.set(key, { ...existing, references: refs })
}

function addContext(
  index: Map<string, DraftContext>,
  sig: WorkspaceSignal,
  signalIndex: number,
): void {
  if (!sig.title.trim()) return
  const releaseIds = releaseIdsFromSignal(sig)
  const key = signalIdentity(sig, signalIndex)
  const existing = index.get(key)
  if (existing) {
    const mergedReferences = mergeReferences(existing.references, sig.references)
    const mergedHints = mergeReferences(existing.linkedTaskHints, sig.linkedTaskHints)
    const mergedReleaseIds = mergeReferences(existing.releaseIds, releaseIds)
    const nextExcerpt = existing.excerpt.length >= sig.evidence.length
      ? existing.excerpt
      : sig.evidence
    const nextScopeHint =
      existing.scopeHint === 'current' || sig.scopeHint === 'current'
        ? 'current'
        : existing.scopeHint ?? sig.scopeHint
    index.set(key, {
      ...existing,
      excerpt: nextExcerpt,
      ...(nextScopeHint ? { scopeHint: nextScopeHint } : {}),
      ...(mergedReferences ? { references: mergedReferences } : {}),
      ...(mergedReleaseIds ? { releaseIds: mergedReleaseIds } : {}),
      ...(mergedHints ? { linkedTaskHints: mergedHints } : {}),
    })
    return
  }
  index.set(key, {
    label: sig.title,
    excerpt: sig.evidence,
    source: sig.source,
    ...(sig.references ? { references: sig.references } : {}),
    ...(sig.domainHint ? { domain: sig.domainHint } : {}),
    ...(sig.role ? { role: sig.role } : {}),
    ...(sig.structure ? { structure: sig.structure } : {}),
    ...(sig.scopeHint ? { scopeHint: sig.scopeHint } : {}),
    ...(releaseIds ? { releaseIds } : {}),
    ...(sig.linkedTaskHints?.length ? { linkedTaskHints: [...sig.linkedTaskHints] } : {}),
  })
}

function enrichTasksWithRelatedContext(
  tasks: DraftTask[],
  context: readonly DraftContext[],
): DraftTask[] {
  if (tasks.length === 0 || context.length === 0) return tasks
  return tasks.map(task => {
    const relatedReferences = relatedContextReferences(task, context)
    if (relatedReferences.length === 0) return task
    return {
      ...task,
      references: mergeReferences(task.references, relatedReferences),
    }
  })
}

function assignCurrentReleaseScopes(
  tasks: DraftTask[],
  releases: readonly DraftRelease[],
): DraftTask[] {
  if (tasks.length === 0 || releases.length === 0) return tasks
  const releasesWithRefs = releases.map(release => ({
    release,
    refs: new Set(release.references ?? []),
  }))
  return tasks.map(task => {
    if (task.releaseIds?.length) return task
    const assignmentRefs = (task.sourceClaims ?? [])
      .flatMap(claim => claim.references ?? [])
    const sameDomainRefs = (task.references ?? []).filter(ref => referenceMatchesDomain(ref, task.domain))
    const refs = [...new Set([
      ...assignmentRefs,
      ...sameDomainRefs,
    ])]
    const matchingRefs = refs.length > 0 ? refs : task.references ?? []
    const matching = releasesWithRefs
      .filter(entry => {
        if (task.scope === 'later' && entry.release.scope !== 'later') return false
        if (task.scope !== 'later' && entry.release.scope === 'later') return false
        if (releases.length === 1 && task.scope !== 'later') return true
        return matchingRefs.some(ref => entry.refs.has(ref))
      })
      .map(entry => entry.release.id)
    const selected = task.scope === 'later'
      ? [...new Set(matching)]
      : selectAutomaticCurrentReleaseIds(matching)
    if (selected.length === 0) return task
    return {
      ...task,
      releaseIds: selected,
    }
  })
}

function referenceMatchesDomain(ref: string, domain: string): boolean {
  if (!domain || domain === 'general' || domain === 'core') return true
  return ref.toLowerCase().split(/[\\/]+/).includes(domain.toLowerCase())
}

function selectAutomaticCurrentReleaseIds(
  matchingIds: readonly string[],
): string[] {
  const unique = [...new Set(matchingIds)]
  // A release label is presentation text, not a sequencing contract. If
  // references match more than one release, preserve the ambiguity instead
  // of guessing from words such as "Stage 1". Explicit release membership
  // or a future structured sequence field must resolve it.
  return unique.length === 1 ? unique : []
}

function relatedContextReferences(
  task: DraftTask,
  context: readonly DraftContext[],
): string[] {
  const taskIdentity = task.sourceIdentity || task.suggestedId
  const existingRefs = new Set(task.references ?? [])
  return context
    .filter(entry => (entry.linkedTaskHints ?? []).includes(taskIdentity))
    .flatMap(entry => entry.references ?? [])
    .filter(ref => ref.length > 0 && !existingRefs.has(ref))
    .slice(0, 4)
}
