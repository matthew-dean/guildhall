import { taskDisplayLabel } from '../shared/task-display-label.js'

export type OrientationScopeKind =
  | 'release'
  | 'milestone'
  | 'proposed_feature_set'
  | 'campaign'
  | 'area'
  | 'feature'

export type OrientationReleaseKind = 'release' | 'milestone' | 'marker' | 'current_work'
export type OrientationReleaseState = 'planned' | 'active' | 'ready' | 'shipped' | 'deferred'
export type OrientationReleaseSource = 'owner_approved' | 'spec' | 'release_plan' | 'inferred'
export type OrientationReleaseProofStyle = 'script_only' | 'manual' | 'mixed' | 'unspecified'

export interface OrientationScope {
  id: string
  label: string
  kind: OrientationScopeKind
  source: OrientationReleaseSource
  nodeIds: string[]
  deferredNodeIds: string[]
}

export interface OrientationRelease {
  id: string
  label: string
  kind: OrientationReleaseKind
  state: OrientationReleaseState
  source: OrientationReleaseSource
  description: string | null
  nodeIds: string[]
  deferredNodeIds: string[]
  proofStyle: OrientationReleaseProofStyle
}

export interface ProjectOrientationCharter {
  goal: string | null
  targetAudience: string | null
  currentReleaseTarget: string | null
  successDefinition: string | null
  nonGoals: string[]
  source: 'owner_approved' | 'inferred' | 'missing'
}

export type OrientationMaturity =
  | 'idea'
  | 'brief'
  | 'spec'
  | 'needs_breakdown'
  | 'sliced'
  | 'ready'
  | 'active'
  | 'review'
  | 'proof_needed'
  | 'proven'
  | 'done'
  | 'blocked'
  | 'deferred'

export interface OrientationProgress {
  scopeId: string | null
  total: number
  briefed: number
  specced: number
  sliced: number
  ready: number
  active: number
  proven: number
  done: number
  blocked: number
  deferred: number
}

export interface OrientationSource {
  kind: 'task' | 'scope' | 'charter' | 'inferred'
  refs: string[]
  confidence: 'high' | 'medium' | 'low'
  freshness: 'fresh' | 'unknown' | 'stale'
  inferred: boolean
  refreshedAt: string
}

export interface OrientationProofSummary {
  state: 'none' | 'needed' | 'partial' | 'proven'
  verified: string[]
  missing: string[]
}

export interface OrientationExecutionBoundary {
  label: string
  mode: 'headless' | 'ui' | 'mixed' | 'unspecified'
  proofStyle: 'script_only' | 'manual' | 'mixed' | 'unspecified'
  detail: string
  source: OrientationSource
}

export interface OrientationProofContract {
  nodeId: string
  title: string
  state: OrientationProofSummary['state']
  required: string[]
  verified: string[]
  missing: string[]
  refs: string[]
}

export interface OrientationOwnerAction {
  label: string
  href: string
  reason: string
}

export interface OrientationBlocker {
  id: string
  label: string
  owningNodeId?: string
}

export interface OrientationRefs {
  taskIds: string[]
  threadIds: string[]
  artifactIds: string[]
  structuralDomainIds: string[]
  primitiveIds: string[]
  releaseCheckIds: string[]
}

export interface OrientationNode {
  id: string
  parentId: string | null
  kind: 'project' | 'area' | 'feature' | 'slice' | 'work' | 'proof' | 'release'
  title: string
  summary: string
  maturity: OrientationMaturity
  progress: OrientationProgress
  proof: OrientationProofSummary
  ownerAction: OrientationOwnerAction | null
  blockers: OrientationBlocker[]
  refs: OrientationRefs
  source: OrientationSource
  visibility: {
    kind: 'primary' | 'supporting' | 'internal_step' | 'hidden'
    countInProjectTotals: boolean
  }
  children: OrientationNode[]
}

export interface OrientationGap {
  kind:
    | 'missing_charter'
    | 'unplaced_task'
    | 'unanchored_thread'
    | 'unanchored_release_blocker'
    | 'source_conflict'
    | 'needs_breakdown'
    | 'proof_needed'
    | 'missing_execution_boundary'
    | 'missing_proof_contract'
  label: string
  refs: string[]
  severity: 'info' | 'warn' | 'blocker'
}

export interface ProjectOrientationSummary {
  headline: string
  purpose: string
  selectedReleaseLabel: string | null
  selectedScopeLabel: string | null
  includedCount: number
  includedWorkCount: number
  deferredCount: number
  deferredWorkCount: number
  pinnedNow: string[]
  topBlocker: string | null
  nextAction: string
  progress: OrientationProgress
}

export interface OrientationPin {
  id: string
  nodeId: string
  label: string
  kind: 'active_work' | 'owner_input' | 'review' | 'proof'
  href: string
}

export interface OrientationReleaseSummary {
  state: 'ready' | 'blocked' | 'active' | 'shaping' | 'unknown'
  blockers: OrientationBlocker[]
}

export interface OrientationSourceHealth {
  inferred: number
  conflicts: number
  gaps: number
}

export interface ProjectOrientationSpine {
  projectId: string
  updatedAt: string
  selectedRelease: OrientationRelease | null
  /**
   * @deprecated Compatibility alias for selectedRelease work assignment.
   * New UI/runtime code should read selectedRelease.
   */
  scope: OrientationScope | null
  charter: ProjectOrientationCharter
  executionBoundary: OrientationExecutionBoundary
  proofContracts: OrientationProofContract[]
  summary: ProjectOrientationSummary
  roots: OrientationNode[]
  nodes: Record<string, OrientationNode>
  activePins: OrientationPin[]
  gaps: OrientationGap[]
  release: OrientationReleaseSummary
  sourceHealth: OrientationSourceHealth
}

export interface OrientationTaskInput {
  id: string
  title?: string
  description?: string
  domain?: string
  projectPath?: string
  status?: string
  priority?: string
  spec?: string
  structuredSpec?: unknown
  productBrief?: { approvedAt?: string | null } | null
  acceptanceCriteria?: Array<{ met?: boolean; [key: string]: unknown }>
  proofPaths?: unknown[]
  completionHandoff?: {
    verified?: string[]
    notVerified?: string[]
    remainingRisks?: string[]
  } | Record<string, unknown> | null
  hierarchy?: { parentId?: string; childIds?: string[] }
  dependsOn?: string[]
  releaseIds?: string[]
  workKind?: string
  workVisibility?: {
    kind?: 'primary' | 'supporting' | 'internal_step' | 'hidden' | string
    countInProjectTotals?: boolean
  }
  updatedAt?: string
  orientationSource?: OrientationSource
}

export interface OrientationWorkspaceImportDraftTask {
  id: string
  title: string
  description?: string
  domain?: string
  scope: 'current' | 'later'
  refs?: string[]
}

export interface OrientationWorkspaceImportDraft {
  tasks: OrientationWorkspaceImportDraftTask[]
  source: OrientationSource
}

export interface BuildProjectOrientationSpineInput {
  projectId: string
  now?: string
  charter?: Partial<ProjectOrientationCharter> | null
  selectedReleaseId?: string | null
  releases?: Array<Partial<OrientationRelease>> | null
  scope?: Partial<OrientationScope> | null
  tasks?: OrientationTaskInput[]
  releaseReadiness?: {
    verdict?: string
    blockers?: Array<{ id?: string; label?: string; title?: string }>
  } | null
  startReadiness?: {
    canStart: boolean
    code?: string
    message?: string
    actionHref?: string
  } | null
  workspaceImportDraft?: OrientationWorkspaceImportDraft | null
  sourceConflicts?: Array<{ id: string; summary: string; refs: string[] }>
  sourceRefs?: string[]
}

export interface ScopeEligibilityOptions {
  explicitTaskId?: string
  includedDependencyIds?: ReadonlySet<string>
}

export function taskNodeId(taskId: string): string {
  return `work:${taskId}`
}

export function taskEligibleForSelectedScope(
  task: Pick<OrientationTaskInput, 'id' | 'dependsOn'>,
  scope: OrientationScope | null | undefined,
  options: ScopeEligibilityOptions = {},
): { eligible: boolean; reason: 'no_scope' | 'included' | 'deferred' | 'explicit_target' | 'included_prerequisite' } {
  if (!scope) return { eligible: true, reason: 'no_scope' }
  if (options.explicitTaskId === task.id) return { eligible: true, reason: 'explicit_target' }
  const nodeId = taskNodeId(task.id)
  if (scope.nodeIds.includes(nodeId)) return { eligible: true, reason: 'included' }
  if (options.includedDependencyIds?.has(task.id)) return { eligible: true, reason: 'included_prerequisite' }
  if (scope.deferredNodeIds.includes(nodeId)) return { eligible: false, reason: 'deferred' }
  return { eligible: false, reason: 'deferred' }
}

function emptyProgress(scopeId: string | null): OrientationProgress {
  return {
    scopeId,
    total: 0,
    briefed: 0,
    specced: 0,
    sliced: 0,
    ready: 0,
    active: 0,
    proven: 0,
    done: 0,
    blocked: 0,
    deferred: 0,
  }
}

function addProgress(base: OrientationProgress, next: OrientationProgress): OrientationProgress {
  return {
    scopeId: base.scopeId,
    total: base.total + next.total,
    briefed: base.briefed + next.briefed,
    specced: base.specced + next.specced,
    sliced: base.sliced + next.sliced,
    ready: base.ready + next.ready,
    active: base.active + next.active,
    proven: base.proven + next.proven,
    done: base.done + next.done,
    blocked: base.blocked + next.blocked,
    deferred: base.deferred + next.deferred,
  }
}

function normalizeCharter(input: BuildProjectOrientationSpineInput): ProjectOrientationCharter {
  const charter = input.charter
  if (!charter) {
    return {
      goal: null,
      targetAudience: null,
      currentReleaseTarget: null,
      successDefinition: null,
      nonGoals: [],
      source: 'missing',
    }
  }
  return {
    goal: charter.goal ?? null,
    targetAudience: charter.targetAudience ?? null,
    currentReleaseTarget: charter.currentReleaseTarget ?? null,
    successDefinition: charter.successDefinition ?? null,
    nonGoals: charter.nonGoals ?? [],
    source: charter.source ?? 'inferred',
  }
}

function defaultScope(tasks: OrientationTaskInput[]): OrientationScope | null {
  if (tasks.length === 0) return null
  const nodeIds = tasks
    .filter(task => task.status !== 'shelved')
    .map(task => taskNodeId(task.id))
  const deferredNodeIds = tasks
    .filter(task => task.status === 'shelved')
    .map(task => taskNodeId(task.id))
  return {
    id: 'current-work',
    label: 'Current work',
    kind: 'proposed_feature_set',
    source: 'inferred',
    nodeIds,
    deferredNodeIds,
  }
}

function draftSyntheticTaskId(id: string): string {
  return `workspace-import:${id}`
}

function augmentTasksWithWorkspaceImportDraft(input: {
  tasks: OrientationTaskInput[]
  workspaceImportDraft?: OrientationWorkspaceImportDraft | null
  now: string
}): { tasks: OrientationTaskInput[]; scope: OrientationScope | null } {
  const draft = input.workspaceImportDraft
  if (!draft || draft.tasks.length === 0) {
    return { tasks: input.tasks, scope: null }
  }

  const augmented = [...input.tasks]
  const titleToTask = new Map<string, OrientationTaskInput>()
  for (const task of augmented) titleToTask.set(normalizeText(taskTitle(task)), task)

  const currentNodeIds: string[] = []
  const deferredNodeIds: string[] = []
  const importerTask = augmented.find(task => task.id === 'task-workspace-import')
  if (importerTask) currentNodeIds.push(taskNodeId(importerTask.id))

  for (const draftTask of draft.tasks) {
    const existing = titleToTask.get(normalizeText(draftTask.title))
    const taskId = existing?.id ?? draftSyntheticTaskId(draftTask.id)

    if (!existing) {
      const synthetic: OrientationTaskInput = {
        id: taskId,
        title: draftTask.title,
        description: draftTask.description ?? draftTask.title,
        domain: draftTask.domain,
        status: draftTask.scope === 'later' ? 'shelved' : 'import_draft',
        updatedAt: input.now,
        workVisibility: {
          kind: draftTask.scope === 'later' ? 'supporting' : 'primary',
          countInProjectTotals: true,
        },
        orientationSource: {
          ...draft.source,
          refs: draftTask.refs?.length ? draftTask.refs : draft.source.refs,
          inferred: true,
          refreshedAt: input.now,
        },
      }
      augmented.push(synthetic)
      titleToTask.set(normalizeText(draftTask.title), synthetic)
    }

    const nodeId = taskNodeId(taskId)
    if (draftTask.scope === 'later') deferredNodeIds.push(nodeId)
    else currentNodeIds.push(nodeId)
  }

  return {
    tasks: augmented,
    scope: {
      id: 'current-work',
      label: 'Current work',
      kind: 'proposed_feature_set',
      source: 'inferred',
      nodeIds: [...new Set(currentNodeIds)],
      deferredNodeIds: [...new Set(deferredNodeIds)],
    },
  }
}

function slugifyReleaseId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'current-release'
}

function releaseToScope(release: OrientationRelease | null): OrientationScope | null {
  if (!release) return null
  const kind: OrientationScopeKind =
    release.kind === 'milestone'
      ? 'milestone'
      : release.kind === 'release'
        ? 'release'
        : 'proposed_feature_set'
  return {
    id: release.id,
    label: release.label,
    kind,
    source: release.source,
    nodeIds: release.nodeIds,
    deferredNodeIds: release.deferredNodeIds,
  }
}

function normalizeRelease(input: BuildProjectOrientationSpineInput, tasks: OrientationTaskInput[]): OrientationRelease | null {
  const releases = input.releases ?? []
  const selected =
    releases.find(release => release.id && release.id === input.selectedReleaseId) ??
    releases.find(release => release.state === 'active') ??
    releases.find(release => release.state === 'planned') ??
    releases[0]
  if (selected) {
    const id = selected.id ?? slugifyReleaseId(selected.label ?? 'selected-release')
    const assignedByTask = tasks
      .filter(task => task.releaseIds?.includes(id))
      .map(task => taskNodeId(task.id))
    return expandReleaseWithDescendants({
      id,
      label: selected.label ?? 'Selected release',
      kind: selected.kind ?? 'release',
      state: selected.state ?? 'active',
      source: selected.source ?? 'release_plan',
      description: selected.description ?? null,
      nodeIds: selected.nodeIds?.length ? selected.nodeIds : assignedByTask,
      deferredNodeIds: selected.deferredNodeIds ?? [],
      proofStyle: selected.proofStyle ?? 'unspecified',
    }, tasks)
  }
  return null
}

function expandReleaseWithDescendants(release: OrientationRelease, tasks: OrientationTaskInput[]): OrientationRelease {
  const scope = expandScopeWithDescendants(releaseToScope(release)!, tasks)
  return {
    ...release,
    nodeIds: scope.nodeIds,
    deferredNodeIds: scope.deferredNodeIds,
  }
}

function normalizeScope(input: BuildProjectOrientationSpineInput, tasks: OrientationTaskInput[]): OrientationScope | null {
  if (!input.scope) return defaultScope(tasks)
  const fallback = defaultScope(tasks)
  const base = {
    id: input.scope.id ?? fallback?.id ?? 'current-work',
    label: input.scope.label ?? fallback?.label ?? 'Current work',
    kind: input.scope.kind ?? fallback?.kind ?? 'proposed_feature_set',
    source: input.scope.source ?? fallback?.source ?? 'inferred',
    nodeIds: input.scope.nodeIds ?? fallback?.nodeIds ?? [],
    deferredNodeIds: input.scope.deferredNodeIds ?? [],
  }
  return expandScopeWithDescendants(base, tasks)
}

function expandScopeWithDescendants(scope: OrientationScope, tasks: OrientationTaskInput[]): OrientationScope {
  const childIdsByParent = buildChildMap(tasks)
  const included = new Set(scope.nodeIds)
  const deferred = new Set(scope.deferredNodeIds)
  const visit = (taskId: string) => {
    for (const childId of childIdsByParent.get(taskId) ?? []) {
      const nodeId = taskNodeId(childId)
      if (included.has(nodeId) || deferred.has(nodeId)) continue
      included.add(nodeId)
      visit(childId)
    }
  }
  for (const nodeId of [...included]) {
    if (nodeId.startsWith('work:')) visit(nodeId.slice('work:'.length))
  }
  return {
    ...scope,
    nodeIds: [...included],
    deferredNodeIds: [...deferred],
  }
}

function taskTitle(task: OrientationTaskInput): string {
  return taskDisplayLabel(task, task.id)
}

function hasSpec(task: OrientationTaskInput): boolean {
  return Boolean(task.spec?.trim()) || task.structuredSpec != null || task.status === 'spec_review'
}

function hasBrief(task: OrientationTaskInput): boolean {
  return Boolean(task.productBrief?.approvedAt)
}

function proofForTask(task: OrientationTaskInput): OrientationProofSummary {
  const handoff = task.completionHandoff && typeof task.completionHandoff === 'object'
    ? task.completionHandoff as {
        verified?: string[]
        notVerified?: string[]
        remainingRisks?: string[]
      }
    : null
  const verified = handoff?.verified ?? []
  const missing = [...(handoff?.notVerified ?? []), ...(handoff?.remainingRisks ?? [])].filter(Boolean)
  const plannedProof = Array.isArray(task.proofPaths) ? task.proofPaths.length : 0
  if (plannedProof === 0 && verified.length === 0 && missing.length === 0) {
    return { state: 'needed', verified, missing: ['Verification evidence has not been attached yet.'] }
  }
  if (missing.length > 0) return { state: verified.length > 0 ? 'partial' : 'needed', verified, missing }
  if (verified.length > 0) return { state: 'proven', verified, missing }
  if (plannedProof > 0) return { state: 'needed', verified, missing: ['Planned proof exists, but no proof evidence has been attached yet.'] }
  return { state: 'none', verified, missing }
}

function taskHasChildren(task: OrientationTaskInput, childIdsByParent: Map<string, string[]>): boolean {
  return (task.hierarchy?.childIds?.length ?? 0) > 0 || (childIdsByParent.get(task.id)?.length ?? 0) > 0
}

function maturityForTask(
  task: OrientationTaskInput,
  childIdsByParent: Map<string, string[]>,
  scope: OrientationScope | null,
): OrientationMaturity {
  if (!taskEligibleForSelectedScope(task, scope).eligible) return 'deferred'
  if (task.status === 'shelved') return 'deferred'
  if (task.status === 'blocked') return 'blocked'
  if (task.status === 'in_progress') return 'active'
  if (task.status === 'review' || task.status === 'gate_check') return 'review'
  if (task.status === 'done') return proofForTask(task).state === 'proven' ? 'proven' : 'done'
  const childBearing = taskHasChildren(task, childIdsByParent)
  if (task.status === 'ready' && !childBearing && (task.workKind === 'app_spec' || task.workKind === 'feature_spec')) {
    return 'needs_breakdown'
  }
  const proof = proofForTask(task)
  if (task.status === 'ready' && proof.state === 'needed') return 'proof_needed'
  if (proof.state === 'partial') return 'proof_needed'
  if (task.status === 'ready') return childBearing ? 'sliced' : 'ready'
  if (hasSpec(task)) return 'spec'
  if (hasBrief(task)) return 'brief'
  return 'idea'
}

function progressForTask(task: OrientationTaskInput, maturity: OrientationMaturity, scopeId: string | null): OrientationProgress {
  const progress = emptyProgress(scopeId)
  progress.total = 1
  if (hasBrief(task)) progress.briefed = 1
  if (hasSpec(task)) progress.specced = 1
  if (maturity === 'sliced') progress.sliced = 1
  if (maturity === 'ready') progress.ready = 1
  if (maturity === 'active') progress.active = 1
  if (maturity === 'proven') progress.proven = 1
  if (maturity === 'done' || maturity === 'proven') progress.done = 1
  if (maturity === 'blocked') progress.blocked = 1
  if (maturity === 'deferred') progress.deferred = 1
  return progress
}

function emptyRefs(taskId: string): OrientationRefs {
  return {
    taskIds: [taskId],
    threadIds: [],
    artifactIds: [],
    structuralDomainIds: [],
    primitiveIds: [],
    releaseCheckIds: [],
  }
}

function parentIdFor(task: OrientationTaskInput, tasksById: Map<string, OrientationTaskInput>): string | null {
  const parentId = task.hierarchy?.parentId?.trim()
  return parentId && tasksById.has(parentId) ? parentId : null
}

function buildChildMap(tasks: OrientationTaskInput[]): Map<string, string[]> {
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const childIdsByParent = new Map<string, Set<string>>()
  const addChild = (parentId: string, childId: string) => {
    const set = childIdsByParent.get(parentId) ?? new Set<string>()
    set.add(childId)
    childIdsByParent.set(parentId, set)
  }
  for (const task of tasks) {
    for (const childId of task.hierarchy?.childIds ?? []) {
      if (tasksById.has(childId)) addChild(task.id, childId)
    }
    const parentId = parentIdFor(task, tasksById)
    if (parentId) addChild(parentId, task.id)
  }
  return new Map([...childIdsByParent].map(([parentId, childIds]) => [parentId, [...childIds]]))
}

function buildNodes(
  tasks: OrientationTaskInput[],
  scope: OrientationScope | null,
  now: string,
): { roots: OrientationNode[]; byId: Map<string, OrientationNode>; gaps: OrientationGap[] } {
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const childIdsByParent = buildChildMap(tasks)
  const byId = new Map<string, OrientationNode>()
  const gaps: OrientationGap[] = []

  const build = (task: OrientationTaskInput): OrientationNode => {
    const existing = byId.get(taskNodeId(task.id))
    if (existing) return existing
    const maturity = maturityForTask(task, childIdsByParent, scope)
    const children = (childIdsByParent.get(task.id) ?? [])
      .map(childId => tasksById.get(childId))
      .filter((child): child is OrientationTaskInput => Boolean(child))
      .map(build)
    const childProgress = children.reduce((progress, child) => addProgress(progress, child.progress), emptyProgress(scope?.id ?? null))
    const ownProgress = progressForTask(task, maturity, scope?.id ?? null)
    const proof = proofForTask(task)
    const node: OrientationNode = {
      id: taskNodeId(task.id),
      parentId: parentIdFor(task, tasksById) ? taskNodeId(parentIdFor(task, tasksById)!) : null,
      kind: task.workKind === 'feature' || task.workKind === 'feature_spec' ? 'feature' : 'work',
      title: taskTitle(task),
      summary: task.description ?? taskTitle(task),
      maturity,
      progress: addProgress(ownProgress, childProgress),
      proof,
      ownerAction: null,
      blockers: [],
      refs: emptyRefs(task.id),
      source: task.orientationSource ?? {
        kind: 'task',
        refs: [`task:${task.id}`],
        confidence: 'high',
        freshness: task.updatedAt ? 'fresh' : 'unknown',
        inferred: false,
        refreshedAt: now,
      },
      visibility: visibilityForTask(task),
      children,
    }
    if (maturity === 'needs_breakdown') {
      gaps.push({
        kind: 'needs_breakdown',
        label: `${taskTitle(task)} is too broad and needs smaller tasks.`,
        refs: [`task:${task.id}`],
        severity: 'warn',
      })
    }
    if (maturity === 'proof_needed') {
      gaps.push({
        kind: 'proof_needed',
        label: `Proof needed: ${taskTitle(task)}.`,
        refs: [`task:${task.id}`],
        severity: 'warn',
      })
    }
    byId.set(node.id, node)
    return node
  }

  const taskRoots = tasks
    .filter(task => !parentIdFor(task, tasksById))
    .map(build)
  const roots = groupFlatRootsByDomain(taskRoots, tasks, scope, now, byId)
  return { roots, byId, gaps }
}

function titleFromDomain(domain: string | undefined): string {
  const raw = domain?.trim()
  if (!raw) return 'Unsorted work'
  if (raw.startsWith('_')) return raw.slice(1).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return raw.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function summarizeArea(title: string, children: OrientationNode[]): string {
  const proofNeeded = children.filter(child => child.maturity === 'proof_needed').length
  const blocked = children.filter(child => child.maturity === 'blocked').length
  const active = children.filter(child => child.maturity === 'active' || child.maturity === 'review').length
  const pieces = [
    `${children.length} ${children.length === 1 ? 'work item' : 'work items'}`,
    active ? `${active} active` : null,
    proofNeeded ? `${proofNeeded} need proof` : null,
    blocked ? `${blocked} blocked` : null,
  ].filter(Boolean)
  return `${title} capability lane: ${pieces.join(' · ')}.`
}

function maturityForArea(children: OrientationNode[]): OrientationMaturity {
  if (children.some(child => child.maturity === 'active' || child.maturity === 'review')) return 'active'
  if (children.some(child => child.maturity === 'blocked')) return 'blocked'
  if (children.some(child => child.maturity === 'proof_needed')) return 'proof_needed'
  if (children.every(child => child.maturity === 'proven' || child.maturity === 'done')) return 'done'
  if (children.some(child => child.maturity === 'ready')) return 'ready'
  if (children.some(child => child.maturity === 'spec')) return 'spec'
  if (children.some(child => child.maturity === 'brief')) return 'brief'
  return 'idea'
}

function groupFlatRootsByDomain(
  roots: OrientationNode[],
  tasks: OrientationTaskInput[],
  scope: OrientationScope | null,
  now: string,
  byId: Map<string, OrientationNode>,
): OrientationNode[] {
  if (roots.length < 2) return roots
  if (roots.some(root => root.children.length > 0 || root.kind === 'feature' || root.kind === 'area')) return roots
  const tasksByNodeId = new Map(tasks.map(task => [taskNodeId(task.id), task]))
  const groups = new Map<string, OrientationNode[]>()
  for (const root of roots) {
    const task = tasksByNodeId.get(root.id)
    const key = task?.domain?.trim() || 'unsorted'
    const list = groups.get(key) ?? []
    list.push(root)
    groups.set(key, list)
  }
  if (groups.size < 2) return roots
  const areaRoots: OrientationNode[] = []
  for (const [domain, children] of groups) {
    const title = titleFromDomain(domain)
    const areaId = `area:${normalizeText(domain || 'unsorted').replace(/\s+/g, '-') || 'unsorted'}`
    const normalizedChildren = children.map(child => ({ ...child, parentId: areaId }))
    for (const child of normalizedChildren) byId.set(child.id, child)
    const progress = normalizedChildren.reduce(
      (current, child) => addProgress(current, child.progress),
      emptyProgress(scope?.id ?? null),
    )
    const area: OrientationNode = {
      id: areaId,
      parentId: null,
      kind: 'area',
      title,
      summary: summarizeArea(title, normalizedChildren),
      maturity: maturityForArea(normalizedChildren),
      progress,
      proof: {
        state: normalizedChildren.some(child => child.proof.state === 'needed' || child.proof.state === 'partial')
          ? 'needed'
          : normalizedChildren.some(child => child.proof.state === 'proven')
            ? 'proven'
            : 'none',
        verified: normalizedChildren.flatMap(child => child.proof.verified),
        missing: normalizedChildren.flatMap(child => child.proof.missing),
      },
      ownerAction: null,
      blockers: normalizedChildren.flatMap(child => child.blockers),
      refs: {
        taskIds: normalizedChildren.flatMap(child => child.refs.taskIds),
        threadIds: normalizedChildren.flatMap(child => child.refs.threadIds),
        artifactIds: normalizedChildren.flatMap(child => child.refs.artifactIds),
        structuralDomainIds: domain ? [`domain:${domain}`] : [],
        primitiveIds: normalizedChildren.flatMap(child => child.refs.primitiveIds),
        releaseCheckIds: normalizedChildren.flatMap(child => child.refs.releaseCheckIds),
      },
      source: {
        kind: 'inferred',
        refs: normalizedChildren.flatMap(child => child.source.refs),
        confidence: 'medium',
        freshness: 'fresh',
        inferred: true,
        refreshedAt: now,
      },
      visibility: { kind: 'primary', countInProjectTotals: true },
      children: normalizedChildren,
    }
    byId.set(area.id, area)
    areaRoots.push(area)
  }
  return areaRoots.sort((left, right) => left.title.localeCompare(right.title))
}

function visibilityForTask(task: OrientationTaskInput): OrientationNode['visibility'] {
  const kind = task.workVisibility?.kind
  if (kind === 'primary' || kind === 'supporting' || kind === 'internal_step' || kind === 'hidden') {
    return {
      kind,
      countInProjectTotals: typeof task.workVisibility?.countInProjectTotals === 'boolean'
        ? task.workVisibility.countInProjectTotals
        : kind === 'primary' || kind === 'supporting',
    }
  }
  if (task.hierarchy?.parentId && (task.workKind === 'verification' || task.workKind === 'test')) {
    return { kind: 'internal_step', countInProjectTotals: false }
  }
  return { kind: 'primary', countInProjectTotals: true }
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function sharedTokenCount(left: string, right: string): number {
  const leftTokens = new Set(normalizeText(left).split(/\s+/).filter(token => token.length > 2))
  const rightTokens = normalizeText(right).split(/\s+/).filter(token => token.length > 2)
  return rightTokens.filter(token => leftTokens.has(token)).length
}

function attachReleaseBlockers(
  blockers: BuildProjectOrientationSpineInput['releaseReadiness'] extends infer T
    ? T extends { blockers?: infer B } ? B : never
    : never,
  nodesById: Map<string, OrientationNode>,
): { blockers: OrientationBlocker[]; gaps: OrientationGap[] } {
  const gaps: OrientationGap[] = []
  const nodes = [...nodesById.values()]
  const result = (Array.isArray(blockers) ? blockers : []).map((blocker, index) => {
    const label = blocker.label ?? blocker.title ?? blocker.id ?? `Release blocker ${index + 1}`
    const normalized = normalizeText(label)
    const owningNode = nodes.find(node =>
      normalized.includes(normalizeText(node.title)) ||
      sharedTokenCount(label, node.title) >= 1,
    )
    const output: OrientationBlocker = {
      id: blocker.id ?? `release-blocker-${index + 1}`,
      label,
      ...(owningNode ? { owningNodeId: owningNode.id } : {}),
    }
    if (!owningNode) {
      gaps.push({
        kind: 'unanchored_release_blocker',
        label: `Guildhall found a release blocker it cannot connect to a task yet: ${label}`,
        refs: [output.id],
        severity: 'warn',
      })
    }
    return output
  })
  return { blockers: result, gaps }
}

function activePins(nodes: OrientationNode[]): OrientationPin[] {
  const pins: OrientationPin[] = []
  const visit = (node: OrientationNode) => {
    if (node.maturity === 'active' || node.maturity === 'review' || node.maturity === 'proof_needed') {
      pins.push({
        id: `pin:${node.id}`,
        nodeId: node.id,
        label: node.title,
        kind: node.maturity === 'proof_needed' ? 'proof' : node.maturity === 'review' ? 'review' : 'active_work',
        href: `/task/${encodeURIComponent(node.refs.taskIds[0] ?? node.id)}`,
      })
    }
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return pins.slice(0, 5)
}

function sourceConflictGaps(conflicts: BuildProjectOrientationSpineInput['sourceConflicts'] = []): OrientationGap[] {
  return conflicts.map(conflict => ({
    kind: 'source_conflict' as const,
    label: conflict.summary,
    refs: conflict.refs,
    severity: 'warn' as const,
  }))
}

function taskText(task: OrientationTaskInput): string {
  return [
    task.title,
    task.description,
    task.spec,
    task.structuredSpec ? JSON.stringify(task.structuredSpec) : null,
    ...(task.acceptanceCriteria ?? []).map(criterion =>
      [criterion.description, criterion.text].filter(Boolean).join(' '),
    ),
  ].filter(Boolean).join('\n')
}

function buildExecutionBoundary(input: {
  charter: ProjectOrientationCharter
  tasks: OrientationTaskInput[]
  now: string
  sourceRefs: string[]
}): OrientationExecutionBoundary {
  const releaseText = [
    input.charter.currentReleaseTarget,
    input.charter.successDefinition,
  ].filter(Boolean).join('\n')
  const text = [
    releaseText,
    input.charter.goal,
    input.charter.targetAudience,
    ...input.tasks.map(taskText),
  ].filter(Boolean).join('\n')
  const releaseDeclaresHeadless = /\b(headless|script[- ]only|scripted|cli|command[- ]line|smoke test|automated proof)\b/i.test(releaseText)
  const hasHeadless = releaseDeclaresHeadless || /\b(headless|script[- ]only|scripted|cli|command[- ]line|smoke test|automated proof)\b/i.test(text)
  const hasUi = /\b(ui|browser|screen|visual|frontend|interface)\b/i.test(text)
  const mode = releaseDeclaresHeadless ? 'headless' : hasHeadless && hasUi ? 'mixed' : hasHeadless ? 'headless' : hasUi ? 'ui' : 'unspecified'
  const proofStyle = /script[- ]only|scripted|cli|command[- ]line|smoke test|automated proof/i.test(text)
    ? 'script_only'
    : hasHeadless && hasUi
      ? 'mixed'
      : hasUi
        ? 'manual'
        : 'unspecified'
  const label = mode === 'headless'
    ? 'Headless proof'
    : mode === 'mixed'
      ? 'Mixed proof'
      : mode === 'ui'
        ? 'UI-visible proof'
        : 'Proof mode missing'
  const detail = mode === 'unspecified'
    ? 'Guildhall has not collected whether the selected scope should be proven headlessly, through UI review, or both.'
    : proofStyle === 'script_only'
      ? 'Selected scope should be proven with scripts or commands before it is treated as ready.'
      : proofStyle === 'manual'
        ? 'Selected scope includes UI or manual proof expectations.'
        : 'Selected scope includes more than one proof style.'
  const refs = input.sourceRefs.length > 0 ? input.sourceRefs : [`project:${input.charter.source}`]
  return {
    label,
    mode,
    proofStyle,
    detail,
    source: {
      kind: input.charter.source === 'owner_approved' ? 'charter' : 'inferred',
      refs,
      confidence: mode === 'unspecified' ? 'low' : input.charter.source === 'owner_approved' ? 'high' : 'medium',
      freshness: 'fresh',
      inferred: input.charter.source !== 'owner_approved',
      refreshedAt: input.now,
    },
  }
}

function flattenNodes(nodes: OrientationNode[]): OrientationNode[] {
  const result: OrientationNode[] = []
  const visit = (node: OrientationNode) => {
    result.push(node)
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return result
}

function proofContractsForNodes(
  roots: OrientationNode[],
  boundary: OrientationExecutionBoundary,
): OrientationProofContract[] {
  return flattenNodes(roots)
    .filter(node => node.kind === 'work' || node.kind === 'feature' || node.kind === 'slice')
    .map(node => {
      const required = boundary.proofStyle === 'script_only'
        ? [`Script or command proof for ${node.title}.`]
        : [`Verification evidence for ${node.title}.`]
      const missing = node.proof.missing.length > 0
        ? node.proof.missing
        : node.proof.state === 'proven'
          ? []
          : required
      return {
        nodeId: node.id,
        title: node.title,
        state: node.proof.state,
        required,
        verified: node.proof.verified,
        missing,
        refs: node.source.refs,
      }
    })
}

function sourceHealth(nodes: OrientationNode[], gaps: OrientationGap[]): OrientationSourceHealth {
  const allNodes: OrientationNode[] = []
  const visit = (node: OrientationNode) => {
    allNodes.push(node)
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return {
    inferred: allNodes.filter(node => node.source.inferred).length,
    conflicts: gaps.filter(gap => gap.kind === 'source_conflict').length,
    gaps: gaps.length,
  }
}

function summarizeStartReadiness(input: {
  workLabel: string | null
  startReadiness: NonNullable<BuildProjectOrientationSpineInput['startReadiness']>
}): { headline: string; topBlocker: string; nextAction: string } | null {
  const { workLabel, startReadiness } = input
  if (startReadiness.canStart) return null
  const genericWorkLabel = workLabel ?? 'Current work'
  const message = typeof startReadiness.message === 'string' && startReadiness.message.trim()
    ? startReadiness.message.trim()
    : 'Project start is blocked until the current issue is resolved.'
  switch (startReadiness.code) {
    case 'import_drafts_waiting':
      return {
        headline: `${genericWorkLabel} needs import review.`,
        topBlocker: 'Imported drafts need review.',
        nextAction: 'Open the first imported draft.',
      }
    case 'workspace_import_refresh_needed':
      return {
        headline: `${genericWorkLabel} needs import refresh.`,
        topBlocker: 'Workspace import is under-scoped.',
        nextAction: 'Refresh the workspace import.',
      }
    case 'no_unattended_progress':
      return {
        headline: `${genericWorkLabel} needs a decision.`,
        topBlocker: message,
        nextAction: 'Resolve the current start blocker.',
      }
    default:
      return {
        headline: `${genericWorkLabel} needs attention.`,
        topBlocker: message,
        nextAction: 'Resolve the current start blocker.',
      }
  }
}

function buildSummary(input: {
  projectId: string
  charter: ProjectOrientationCharter
  selectedRelease: OrientationRelease | null
  scope: OrientationScope | null
  progress: OrientationProgress
  pins: OrientationPin[]
  blockers: OrientationBlocker[]
  startReadiness?: BuildProjectOrientationSpineInput['startReadiness']
}): ProjectOrientationSummary {
  const purpose = input.charter.goal ?? `Project ${input.projectId} needs a confirmed purpose.`
  const releaseLabel = input.selectedRelease?.label ?? null
  const workLabel = releaseLabel ?? input.scope?.label ?? null
  const readinessSummary = input.startReadiness
    ? summarizeStartReadiness({
        workLabel,
        startReadiness: input.startReadiness,
      })
    : null
  const topBlocker = readinessSummary?.topBlocker ?? input.blockers[0]?.label ?? null
  const hasActionableWork =
    input.progress.ready > 0 ||
    input.progress.active > 0 ||
    input.progress.blocked > 0 ||
    input.progress.sliced > 0 ||
    input.progress.total > input.progress.done + input.progress.deferred
  const headline = readinessSummary?.headline ?? (
    workLabel
      ? topBlocker
        ? `${workLabel} is blocked on proof.`
        : hasActionableWork
          ? `${workLabel} is being shaped.`
          : `${workLabel} has no actionable work.`
      : 'No current work is selected yet.'
  )
  return {
    headline,
    purpose,
    selectedReleaseLabel: releaseLabel,
    selectedScopeLabel: workLabel,
    includedCount: input.scope?.nodeIds.length ?? 0,
    includedWorkCount: input.scope?.nodeIds.length ?? 0,
    deferredCount: input.scope?.deferredNodeIds.length ?? 0,
    deferredWorkCount: input.scope?.deferredNodeIds.length ?? 0,
    pinnedNow: input.pins.map(pin => pin.label),
    topBlocker,
    nextAction: readinessSummary?.nextAction ?? (topBlocker ? `Review blocker: ${topBlocker}` : 'Review current work.'),
    progress: input.progress,
  }
}

export function buildProjectOrientationSpine(input: BuildProjectOrientationSpineInput): ProjectOrientationSpine {
  const now = input.now ?? new Date().toISOString()
  const baseTasks = input.tasks ?? []
  const draftAugmentation = augmentTasksWithWorkspaceImportDraft({
    tasks: baseTasks,
    workspaceImportDraft: input.workspaceImportDraft,
    now,
  })
  const tasks = draftAugmentation.tasks
  const charter = normalizeCharter(input)
  const selectedRelease = normalizeRelease(input, tasks)
  const scope = releaseToScope(selectedRelease) ?? draftAugmentation.scope ?? normalizeScope(input, tasks)
  const { roots, byId, gaps: nodeGaps } = buildNodes(tasks, scope, now)
  const { blockers, gaps: blockerGaps } = attachReleaseBlockers(input.releaseReadiness?.blockers ?? [], byId)
  const executionBoundary = buildExecutionBoundary({
    charter,
    tasks,
    now,
    sourceRefs: input.sourceRefs ?? [],
  })
  const proofContracts = proofContractsForNodes(roots, executionBoundary)
  const gaps: OrientationGap[] = [
    ...(charter.source === 'missing'
      ? [{
          kind: 'missing_charter' as const,
          label: 'Project goal, target audience, and selected bounded scope need confirmation.',
          refs: [`project:${input.projectId}`],
          severity: 'warn' as const,
        }]
      : []),
    ...(executionBoundary.mode === 'unspecified'
      ? [{
          kind: 'missing_execution_boundary' as const,
          label: 'Confirm whether the selected scope is headless, UI-visible, or mixed before unattended resume.',
          refs: [`project:${input.projectId}`],
          severity: 'blocker' as const,
        }]
      : []),
    ...proofContracts
      .filter(contract => contract.state === 'needed' && contract.required.length === 0)
      .map(contract => ({
        kind: 'missing_proof_contract' as const,
        label: `Define what proof counts for ${contract.title}.`,
        refs: contract.refs,
        severity: 'warn' as const,
      })),
    ...nodeGaps,
    ...blockerGaps,
    ...sourceConflictGaps(input.sourceConflicts),
  ]
  const pins = activePins(roots)
  const progress = roots.reduce(
    (current, node) => addProgress(current, node.progress),
    emptyProgress(scope?.id ?? null),
  )
  const releaseState: OrientationReleaseSummary['state'] = blockers.length > 0
    ? 'blocked'
    : scope
      ? 'shaping'
      : 'unknown'
  return {
    projectId: input.projectId,
    updatedAt: now,
    selectedRelease,
    scope,
    charter,
    executionBoundary,
    proofContracts,
    summary: buildSummary({
      projectId: input.projectId,
      charter,
      selectedRelease,
      scope,
      progress,
      pins,
      blockers,
      startReadiness: input.startReadiness,
    }),
    roots,
    nodes: Object.fromEntries(byId.entries()),
    activePins: pins,
    gaps,
    release: {
      state: releaseState,
      blockers,
    },
    sourceHealth: sourceHealth(roots, gaps),
  }
}
