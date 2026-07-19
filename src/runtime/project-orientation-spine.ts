import { taskDisplayLabel } from '../shared/task-display-label.js'
import { summarizeCurrentProof } from '../shared/current-proof.js'
import {
  executionScopeRows,
  releaseLabelFromId,
  summarizeProjectScopeOutsideWork,
  taskScopeEligibility,
  taskScopeNodeId,
  type ProjectScope,
  type ProjectScopeProjection,
} from './project-scope-projection.js'
import { taskDoneButProofMissing, taskHasScriptProofPath, taskProofIsStale } from './proof-health.js'
import { classifyCompletionProof, recordedCompletionProofForTask } from './task-completion-proof.js'
import { explicitMarkdownSourceRefsFromTask } from './task-source-refs.js'
import { taskTitleOverlap } from './task-title-overlap.js'
import { deriveTaskWorkVisibility } from './work-visibility.js'

export type OrientationScopeKind =
  | 'release'
  | 'milestone'
  | 'proposed_feature_set'
  | 'campaign'
  | 'area'
  | 'feature'

export type OrientationReleaseKind = 'release' | 'milestone' | 'marker' | 'current_work'
export type OrientationReleaseState = 'planned' | 'active' | 'ready' | 'blocked' | 'shipped' | 'deferred'
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
  kind: 'task' | 'scope' | 'charter' | 'inferred' | 'import'
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
  expectationCount: number
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
  nextAction?: string
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
    | 'missing_source_provenance'
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
  /** Durable lifecycle state; state above is computed readiness. */
  lifecycleState?: OrientationReleaseState
  blockers: OrientationBlocker[]
}

export interface OrientationSourceHealth {
  inferred: number
  documented?: number
  deferred?: number
  conflicts: number
  gaps: number
}

export interface OrientationSourceTrailRow {
  label: string
  value: string
  detail: string
  tone: 'ok' | 'warn' | 'neutral' | 'accent'
}

export interface OrientationScopeRow {
  taskId: string
  nodeId: string
  title: string
  scope: 'included' | 'deferred'
  eligibilityReason: string
  hierarchyRole: string
  status: string
  handoffState: string
  blocksStart: boolean
  blocksRelease: boolean
  humanBlocking: boolean
  sourceRefs: string[]
}

export interface ProjectOrientationSpine {
  projectId: string
  updatedAt: string
  selectedRelease: OrientationRelease | null
  releases: OrientationRelease[]
  selectedTaskScope: OrientationScope | null
  /**
   * @deprecated Compatibility alias for selectedTaskScope.
   * New UI/runtime code should read selectedTaskScope.
   */
  scope: OrientationScope | null
  charter: ProjectOrientationCharter
  executionBoundary: OrientationExecutionBoundary
  proofContracts: OrientationProofContract[]
  summary: ProjectOrientationSummary
  roots: OrientationNode[]
  nodes: Record<string, OrientationNode>
  activePins: OrientationPin[]
  scopeRows: OrientationScopeRow[]
  scopeRowCounts: { included: number; deferred: number }
  gaps: OrientationGap[]
  release: OrientationReleaseSummary
  sourceHealth: OrientationSourceHealth
  sourceTrail: OrientationSourceTrailRow[]
}

export interface OrientationReleaseTruth {
  state: 'ready' | 'blocked' | 'active' | 'shaping' | 'unknown'
  /** Durable lifecycle is separate from computed readiness. */
  lifecycleState?: OrientationReleaseState
  counts: {
    total: number
    done: number
    unfinished: number
    deferred: number
    proofBlocked: number
  }
  blockers?: Array<{ id?: string; label?: string; title?: string }>
}

/**
 * Apply the compact release authority to the descriptive spine. The spine can
 * retain source structure and historical detail, but it cannot keep claiming
 * that a closed release is waiting on an older task-level proof contract.
 */
export function reconcileOrientationSpineWithReleaseTruth(
  spine: ProjectOrientationSpine,
  truth: OrientationReleaseTruth,
): ProjectOrientationSpine {
  const releaseIsProven = truth.state === 'ready' && truth.counts.proofBlocked === 0
  const terminalIncludedTaskIds = new Set(
    spine.scopeRows
      .filter(row => row.scope === 'included' && (
        ['done', 'pending_pr'].includes(row.status)
        || (releaseIsProven && row.status === 'ready')
      ))
      .map(row => row.taskId),
  )
  // Release membership identifies what belongs to the scope; it does not
  // prove that every member is still terminal. A point mutation may reopen a
  // task before the aggregate release snapshot is refreshed, so only rows
  // whose current bounded status is terminal may be repaired here. A selected
  // node with no current row is the one exception: it has no newer bounded
  // status to contradict the ready aggregate, and must not retain a stale
  // proof pin just because its execution child owns the row.
  if (releaseIsProven && truth.counts.total > 0 && truth.counts.done >= truth.counts.total) {
    const rowTaskIds = new Set(spine.scopeRows.map(row => row.taskId))
    for (const nodeId of spine.selectedTaskScope?.nodeIds ?? spine.selectedRelease?.nodeIds ?? []) {
      const taskId = nodeId.startsWith('work:') ? nodeId.slice('work:'.length) : null
      if (taskId && !rowTaskIds.has(taskId)) terminalIncludedTaskIds.add(taskId)
    }
  }
  const proofGapBelongsToClosedTask = (gap: OrientationGap): boolean => gap.kind === 'proof_needed' && gap.refs.some(ref => {
    const taskId = ref.replace(/^task:/, '').replace(/^work:/, '')
    return terminalIncludedTaskIds.has(taskId)
  })
  const patchNode = (node: OrientationNode): OrientationNode => {
    const taskId = node.id.startsWith('work:') ? node.id.slice('work:'.length) : null
    const terminal = releaseIsProven && terminalIncludedTaskIds.has(taskId ?? '')
    const children = node.children.map(patchNode)
    return {
      ...node,
      ...(terminal ? {
        maturity: 'done' as const,
        proof: {
          ...node.proof,
          state: 'proven' as const,
          missing: [],
        },
      } : {}),
      children,
    }
  }
  const blockers = (truth.blockers ?? []).map(blocker => ({
    id: blocker.id ?? blocker.title ?? blocker.label ?? 'release-blocker',
    label: blocker.label ?? blocker.title ?? blocker.id ?? 'Current release needs attention.',
  }))
  const label = truth.state === 'ready'
    ? spine.selectedRelease?.label ?? spine.summary.selectedScopeLabel ?? 'Current scope'
    : spine.summary.selectedScopeLabel ?? spine.selectedRelease?.label ?? 'Current scope'
  const selectedReleaseLifecycleState = truth.lifecycleState
    ?? (spine.selectedRelease?.state === 'shipped' ? 'shipped' as const : undefined)
  const selectedReleaseIsShipped = selectedReleaseLifecycleState === 'shipped'
  const selectedReleaseState = selectedReleaseIsShipped
    ? 'shipped' as const
    : truth.state === 'ready'
      ? 'ready' as const
      : truth.state === 'blocked'
        ? 'blocked' as const
        : spine.selectedRelease?.state
  const existingTopBlocker = typeof spine.summary.topBlocker === 'string' ? spine.summary.topBlocker : null
  const existingTopBlockerIsProof = /proof/i.test(existingTopBlocker ?? '')
  const retainedCompletionNote = releaseIsProven && !existingTopBlockerIsProof ? existingTopBlocker : null
  const progress = {
    ...spine.summary.progress,
    total: truth.counts.total + truth.counts.deferred,
    done: truth.counts.done,
    deferred: truth.counts.deferred,
    blocked: truth.state === 'blocked' ? truth.counts.unfinished : 0,
    proven: Math.max(0, truth.counts.done - truth.counts.proofBlocked),
  }
  const patchedRoots = spine.roots.map(patchNode)
  const patchedScopeRows = spine.scopeRows.map(row => terminalIncludedTaskIds.has(row.taskId)
    ? {
        ...row,
        status: 'done',
        handoffState: 'done',
        blocksStart: false,
        blocksRelease: false,
        humanBlocking: false,
      }
    : row)
  const proofContracts = spine.proofContracts.map(contract => {
    const taskId = contract.nodeId.startsWith('work:') ? contract.nodeId.slice('work:'.length) : null
    if (!releaseIsProven || !taskId || !terminalIncludedTaskIds.has(taskId)) return contract
    return {
      ...contract,
      state: 'proven' as const,
      missing: [],
    }
  })
  const patchedGaps = releaseIsProven
    ? spine.gaps.filter(gap => !proofGapBelongsToClosedTask(gap))
    : spine.gaps
  const activePins = spine.activePins.filter(pin => {
    const taskId = pin.nodeId.startsWith('work:') ? pin.nodeId.slice('work:'.length) : null
    return !taskId || !terminalIncludedTaskIds.has(taskId)
  })
  const nodes = Object.keys(spine.nodes).length > 0
    ? Object.fromEntries((() => {
        const output: Array<[string, OrientationNode]> = []
        const visit = (node: OrientationNode) => {
          output.push([node.id, node])
          node.children.forEach(visit)
        }
        patchedRoots.forEach(visit)
        return output
      })())
    : spine.nodes
  return {
    ...spine,
    selectedRelease: spine.selectedRelease
      ? { ...spine.selectedRelease, ...(selectedReleaseState ? { state: selectedReleaseState } : {}) }
      : null,
    releases: spine.releases.map(release => release.id === spine.selectedRelease?.id
      ? { ...release, ...(selectedReleaseState ? { state: selectedReleaseState } : {}) }
      : release),
    summary: {
      ...spine.summary,
      headline: truth.state === 'ready'
        ? `${label} is complete.`
        : truth.state === 'blocked'
          ? `${label} needs attention.`
          : `${label} is in progress.`,
      selectedReleaseLabel: spine.selectedRelease?.label ?? spine.summary.selectedReleaseLabel,
      selectedScopeLabel: label,
      includedCount: truth.counts.total,
      includedWorkCount: truth.counts.total,
      deferredCount: truth.counts.deferred,
      deferredWorkCount: truth.counts.deferred,
      topBlocker: blockers[0]?.label ?? retainedCompletionNote,
      nextAction: truth.state === 'ready'
        ? retainedCompletionNote ? spine.summary.nextAction : 'Review completed scope.'
        : blockers[0]?.label ?? spine.summary.nextAction,
      pinnedNow: activePins.map(pin => pin.label),
      progress,
    },
    roots: patchedRoots,
    nodes,
    activePins,
    scopeRows: patchedScopeRows,
    proofContracts,
    gaps: patchedGaps,
    sourceHealth: {
      ...spine.sourceHealth,
      gaps: patchedGaps.length,
    },
    release: {
      state: truth.state,
      ...(selectedReleaseLifecycleState ? { lifecycleState: selectedReleaseLifecycleState } : {}),
      blockers,
    },
  }
}

/** The durable Map read model omits the duplicate node lookup table. */
export function compactProjectOrientationSpineForMap(
  spine: ProjectOrientationSpine,
): ProjectOrientationSpine {
  const currentScopeRows = spine.scopeRows.filter(row => row.scope !== 'deferred').slice(0, 12)
  const laterScopeRows = spine.scopeRows.filter(row => row.scope === 'deferred').slice(0, 4)
  return {
    ...spine,
    roots: spine.roots.map(compactOrientationMapNode),
    nodes: {},
    scopeRows: [...currentScopeRows, ...laterScopeRows].map(compactOrientationMapScopeRow),
    proofContracts: spine.proofContracts.map(compactOrientationMapProofContract),
    gaps: spine.gaps.slice(0, 5).map(gap => ({ ...gap, refs: gap.refs.slice(0, 2) })),
    activePins: spine.activePins.slice(0, 3),
    sourceTrail: spine.sourceTrail.slice(0, 5),
    // Map is a navigator. The full scope ledger belongs to Work, where it is
    // explicitly paged instead of inflating the project skeleton.
    scope: null,
  }
}

function compactOrientationMapNode(node: OrientationNode): OrientationNode {
  const total = node.progress.total ?? 0
  const progress: Partial<OrientationProgress> = { total }
  for (const key of ['specced', 'active', 'proven', 'done', 'blocked', 'deferred'] as const) {
    if (node.progress[key] > 0) progress[key] = node.progress[key]
  }
  const hasProgress = Object.keys(progress).length > 1 || total > 0
  const visibility = node.visibility.kind ? { kind: node.visibility.kind } : undefined
  const taskIds = node.refs.taskIds.slice(0, 1)
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    maturity: node.maturity,
    ...(hasProgress ? { progress } : {}),
    ...(taskIds.length > 0 ? { refs: { taskIds } } : {}),
    ...(visibility ? { visibility } : {}),
    children: node.children.map(compactOrientationMapNode),
  } as unknown as OrientationNode
}

function compactOrientationMapScopeRow(row: OrientationScopeRow): OrientationScopeRow {
  return {
    ...row,
    sourceRefs: row.sourceRefs.slice(0, 2),
  }
}

function compactOrientationMapProofContract(contract: OrientationProofContract): OrientationProofContract {
  return {
    ...contract,
    required: contract.required.slice(0, 1),
    verified: contract.verified.slice(0, 1),
    missing: contract.missing.slice(0, 1),
    refs: contract.refs.slice(0, 2),
  }
}

export interface OrientationTaskInput {
  id: string
  title?: string
  description?: string
  references?: string[]
  sourceClaims?: Array<{ references?: string[] }>
  domain?: string
  projectPath?: string
  status?: string
  priority?: string
  spec?: string
  structuredSpec?: unknown
  productBrief?: { approvedAt?: string | null } | null
  acceptanceCriteria?: Array<{ met?: boolean; [key: string]: unknown }>
  proofPaths?: unknown[]
  doneSummaryBundle?: unknown
  gateResults?: unknown[]
  reviewVerdicts?: unknown[]
  latestReviewerSummary?: string
  latestSelfCritique?: string
  completionHandoff?: {
    verified?: string[]
    notVerified?: string[]
    remainingRisks?: string[]
  } | Record<string, unknown> | null
  hierarchy?: { parentId?: string; childIds?: string[]; relation?: string }
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
  releaseIds?: string[]
}

export interface OrientationWorkspaceImportDraftRelease {
  id: string
  label: string
  source?: OrientationReleaseSource
  description?: string | null
  kind?: OrientationReleaseKind
  state?: OrientationReleaseState
  proofStyle?: OrientationReleaseProofStyle
}

export interface OrientationWorkspaceImportDraftContext {
  id: string
  title: string
  description?: string
  domain?: string
  refs?: string[]
  role?: 'capability' | 'reference' | 'brief_input'
  scopeHint?: 'current' | 'later'
  releaseIds?: string[]
  linkedTaskHints?: string[]
}

export interface OrientationWorkspaceImportDraft {
  releases?: OrientationWorkspaceImportDraftRelease[]
  tasks: OrientationWorkspaceImportDraftTask[]
  contexts?: OrientationWorkspaceImportDraftContext[]
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
    blockers?: Array<{ id?: string; label?: string; title?: string; nextAction?: string }>
  } | null
  startReadiness?: {
    canStart: boolean
    code?: string
    message?: string
    actionHref?: string
    focusTaskId?: string
    focusTaskTitle?: string
    focusKind?: string
  } | null
  scopeProjection?: ProjectScopeProjection | null
  runStatus?: 'running' | 'stopping' | 'stopped' | 'error' | string | null
  workspaceImportDraft?: OrientationWorkspaceImportDraft | null
  sourceConflicts?: Array<{ id: string; summary: string; refs: string[] }>
  sourceRefs?: string[]
}

export interface ScopeEligibilityOptions {
  explicitTaskId?: string
  includedDependencyIds?: ReadonlySet<string>
  tasksById?: ReadonlyMap<string, Pick<OrientationTaskInput, 'id' | 'hierarchy'>>
}

export function taskNodeId(taskId: string): string {
  return taskScopeNodeId(taskId)
}

function isProjectSetupTask(taskId: string): boolean {
  return taskId === 'task-meta-intake' || taskId === 'task-workspace-import'
}

export function taskEligibleForSelectedScope(
  task: Pick<OrientationTaskInput, 'id' | 'dependsOn' | 'hierarchy'>,
  scope: OrientationScope | null | undefined,
  options: ScopeEligibilityOptions = {},
): {
  eligible: boolean
  reason: 'no_scope' | 'included' | 'included_ancestor' | 'deferred' | 'explicit_target' | 'included_prerequisite'
} {
  if (options.explicitTaskId === task.id) return { eligible: true, reason: 'explicit_target' }
  return taskScopeEligibility(task, scope as ProjectScope | null | undefined, options)
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
  const scopedTasks = tasks.filter(task => !isProjectSetupTask(task.id))
  if (scopedTasks.length === 0) return null
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const nodeIds = tasks
    .filter(task => {
      if (isProjectSetupTask(task.id) || task.status === 'shelved') return false
      return visibilityForTask(task, tasksById).countInProjectTotals
    })
    .map(task => taskNodeId(task.id))
  const deferredNodeIds = tasks
    .filter(task => !isProjectSetupTask(task.id) && task.status === 'shelved')
    .map(task => taskNodeId(task.id))
  return {
    id: 'current-work',
    label: 'Current task scope',
    kind: 'proposed_feature_set',
    source: 'inferred',
    nodeIds,
    deferredNodeIds,
  }
}

function draftSyntheticTaskId(id: string): string {
  return `workspace-import:${id}`
}

export function augmentTasksWithWorkspaceImportDraft(input: {
  tasks: OrientationTaskInput[]
  workspaceImportDraft?: OrientationWorkspaceImportDraft | null
  now: string
}): {
  tasks: OrientationTaskInput[]
  scope: OrientationScope | null
  releases: Array<Partial<OrientationRelease>>
  selectedReleaseId: string | null
  contexts: OrientationWorkspaceImportDraftContext[]
} {
  const draft = input.workspaceImportDraft
  if (!draft || draft.tasks.length === 0) {
    return {
      tasks: input.tasks,
      scope: null,
      releases: draft?.releases ?? [],
      selectedReleaseId: draft?.releases?.[0]?.id ?? null,
      contexts: draft?.contexts ?? [],
    }
  }

  const augmented = input.tasks.map(task => ({
    ...task,
    ...(task.references ? { references: [...task.references] } : {}),
    ...(task.releaseIds ? { releaseIds: [...task.releaseIds] } : {}),
  }))
  const idToTask = new Map<string, OrientationTaskInput>()
  const titleToTask = new Map<string, OrientationTaskInput>()
  for (const task of augmented) {
    idToTask.set(task.id, task)
    titleToTask.set(normalizeText(taskTitle(task)), task)
  }

  const currentNodeIds: string[] = []
  const deferredNodeIds: string[] = []
  const releaseNodeIds = new Map<string, Set<string>>()
  const releaseDeferredNodeIds = new Map<string, Set<string>>()
  const currentReleaseIds = new Set<string>()

  for (const draftTask of draft.tasks) {
    const existing = idToTask.get(draftTask.id) ?? titleToTask.get(normalizeText(draftTask.title))
    const scopedReplacement = scopedReleaseReplacementForDraftTask(draftTask, existing, augmented)
    const taskId = existing?.id ?? draftSyntheticTaskId(draftTask.id)
    const importedRefs = draftTask.refs?.map(stripImportPrefix).filter(Boolean) ?? []

    if (scopedReplacement) {
      if ((!scopedReplacement.references || scopedReplacement.references.length === 0) && importedRefs.length > 0) {
        scopedReplacement.references = importedRefs
      }
      continue
    }

    if (existing && (!existing.references || existing.references.length === 0) && importedRefs.length > 0) {
      existing.references = importedRefs
    }

    if (!existing) {
      const synthetic: OrientationTaskInput = {
        id: taskId,
        title: draftTask.title,
        description: draftTask.description ?? draftTask.title,
        domain: draftTask.domain,
        ...(importedRefs.length > 0 ? { references: importedRefs } : {}),
        ...(draftTask.releaseIds?.length ? { releaseIds: [...draftTask.releaseIds] } : {}),
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
      idToTask.set(synthetic.id, synthetic)
      titleToTask.set(normalizeText(draftTask.title), synthetic)
    } else if (draftTask.releaseIds?.length && (existing.releaseIds ?? []).length === 0) {
      existing.releaseIds = [...new Set([...(existing.releaseIds ?? []), ...draftTask.releaseIds])]
    }

    const nodeId = taskNodeId(taskId)
    const taskReleaseIds = existing?.releaseIds?.length
      ? existing.releaseIds
      : draftTask.releaseIds ?? []
    if (draftTask.scope === 'later') {
      deferredNodeIds.push(nodeId)
      for (const releaseId of taskReleaseIds) {
        const bucket = releaseDeferredNodeIds.get(releaseId) ?? new Set<string>()
        bucket.add(nodeId)
        releaseDeferredNodeIds.set(releaseId, bucket)
      }
    } else {
      currentNodeIds.push(nodeId)
      for (const releaseId of taskReleaseIds) {
        currentReleaseIds.add(releaseId)
        const bucket = releaseNodeIds.get(releaseId) ?? new Set<string>()
        bucket.add(nodeId)
        releaseNodeIds.set(releaseId, bucket)
      }
    }
  }

  for (const context of draft.contexts ?? []) {
    if (context.scopeHint !== 'later' || !context.releaseIds?.length) continue
    const nodeId = capabilityNodeId(context.id)
    deferredNodeIds.push(nodeId)
    for (const releaseId of context.releaseIds) {
      const bucket = releaseDeferredNodeIds.get(releaseId) ?? new Set<string>()
      bucket.add(nodeId)
      releaseDeferredNodeIds.set(releaseId, bucket)
    }
  }

  const releaseInputs = [...(draft.releases ?? [])]
  const existingReleaseIds = new Set(releaseInputs.map(release => release.id))
  for (const releaseId of currentReleaseIds) {
    if (existingReleaseIds.has(releaseId)) continue
    releaseInputs.push({
      id: releaseId,
      label: releaseLabelFromId(releaseId),
      source: draft.source.inferred ? 'inferred' : 'owner_approved',
      state: 'active',
    })
  }

  const releases = releaseInputs.map(release => ({
    id: release.id,
    label: release.label,
    kind: release.kind ?? 'release',
    state: release.state ?? (currentReleaseIds.has(release.id) ? 'active' : 'planned'),
    source: release.source ?? 'release_plan',
    description: release.description ?? null,
    nodeIds: [...(releaseNodeIds.get(release.id) ?? [])],
    deferredNodeIds: [...(releaseDeferredNodeIds.get(release.id) ?? [])],
    proofStyle: release.proofStyle ?? 'unspecified',
  }))
  const selectedReleaseId =
    releases.find(release => release.id && currentReleaseIds.has(release.id))?.id ??
    releases[0]?.id ??
    null

  return {
    tasks: augmented,
    scope: {
      id: 'current-work',
      label: 'Current task scope',
      kind: 'proposed_feature_set',
      source: 'inferred',
      nodeIds: [...new Set(currentNodeIds)],
      deferredNodeIds: [...new Set(deferredNodeIds)],
    },
    releases,
    selectedReleaseId,
    contexts: draft.contexts ?? [],
  }
}

function slugifyReleaseId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'current-release'
}

function scopedReleaseReplacementForDraftTask(
  draftTask: OrientationWorkspaceImportDraftTask,
  existing: OrientationTaskInput | undefined,
  tasks: OrientationTaskInput[],
): OrientationTaskInput | null {
  if (!existing || !draftTask.releaseIds?.length) return null
  const draftReleaseIds = new Set(draftTask.releaseIds)
  if ((existing.releaseIds ?? []).some(releaseId => draftReleaseIds.has(releaseId))) return null
  const draftTitle = draftTask.title.trim()
  if (!draftTitle) return null
  return tasks.find((candidate) => {
    if (candidate.id === existing.id) return false
    if (candidate.status === 'archived' || candidate.status === 'cancelled' || candidate.status === 'shelved') return false
    if (!(candidate.releaseIds ?? []).some(releaseId => draftReleaseIds.has(releaseId))) return false
    if (taskTitleOverlap(taskTitle(candidate), draftTitle) < 0.8) return false
    return taskTitle(candidate).length >= taskTitle(existing).length
  }) ?? null
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

function orientationScopeFromProjection(projection: ProjectScopeProjection | null | undefined): OrientationScope | null {
  const scope = projection?.selectedScope
  if (!scope) return null
  return {
    id: scope.id,
    label: scope.label,
    kind: scope.kind,
    source: scope.source,
    nodeIds: [...scope.nodeIds],
    deferredNodeIds: [...scope.deferredNodeIds],
  }
}

function normalizeRelease(
  input: BuildProjectOrientationSpineInput & { proofStyleFallback?: OrientationReleaseProofStyle },
  tasks: OrientationTaskInput[],
): OrientationRelease | null {
  const releases = input.releases ?? []
  const selected =
    releases.find(release => release.id && release.id === input.selectedReleaseId) ??
    releases.find(release => release.state === 'active') ??
    releases.find(release => release.state === 'planned') ??
    releases[0]
  if (selected) {
    const id = selected.id ?? slugifyReleaseId(selected.label ?? 'selected-release')
    const assignedByTask = tasks
      .filter(task => task.releaseIds?.includes(id) && task.status !== 'shelved')
      .map(task => taskNodeId(task.id))
    return expandReleaseWithDescendants({
      id,
      label: selected.label ?? 'Selected release',
      kind: selected.kind ?? 'release',
      state: normalizedReleaseState(selected, assignedByTask),
      source: selected.source ?? 'release_plan',
      description: selected.description ?? null,
      nodeIds: selected.nodeIds?.length ? selected.nodeIds : assignedByTask,
      deferredNodeIds: selected.deferredNodeIds ?? [],
      proofStyle: selected.proofStyle === 'unspecified' || !selected.proofStyle
        ? input.proofStyleFallback ?? 'unspecified'
        : selected.proofStyle,
    }, tasks)
  }
  return null
}

function normalizedReleaseState(
  release: Partial<OrientationRelease>,
  assignedNodeIds: readonly string[],
): OrientationReleaseState {
  const explicit = release.state ?? 'active'
  if (explicit === 'shipped' || explicit === 'ready' || explicit === 'deferred') return explicit
  const currentCount = (release.nodeIds?.length ?? 0) || assignedNodeIds.length
  if (currentCount > 0) return explicit
  if ((release.deferredNodeIds?.length ?? 0) > 0) return 'planned'
  return explicit === 'active' ? 'planned' : explicit
}

function expandReleaseWithDescendants(release: OrientationRelease, tasks: OrientationTaskInput[]): OrientationRelease {
  const scope = normalizeScopeTaskLists(releaseToScope(release)!, tasks)
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
    label: input.scope.label ?? fallback?.label ?? 'Current task scope',
    kind: input.scope.kind ?? fallback?.kind ?? 'proposed_feature_set',
    source: input.scope.source ?? fallback?.source ?? 'inferred',
    nodeIds: input.scope.nodeIds ?? fallback?.nodeIds ?? [],
    deferredNodeIds: input.scope.deferredNodeIds ?? [],
  }
  return normalizeScopeTaskLists(base, tasks)
}

function normalizeScopeTaskLists(scope: OrientationScope, tasks: OrientationTaskInput[]): OrientationScope {
  const taskById = new Map(tasks.map(task => [task.id, task]))
  const childIdsByParent = new Map<string, Set<string>>()
  const addChild = (parentId: string, childId: string) => {
    const set = childIdsByParent.get(parentId) ?? new Set<string>()
    set.add(childId)
    childIdsByParent.set(parentId, set)
  }
  for (const task of tasks) {
    for (const childId of task.hierarchy?.childIds ?? []) {
      if (taskById.has(childId)) addChild(task.id, childId)
    }
    const parentId = task.hierarchy?.parentId?.trim()
    if (parentId && taskById.has(parentId)) addChild(parentId, task.id)
  }
  const included = new Set(
    scope.nodeIds.filter((nodeId) => {
      if (!nodeId.startsWith('work:')) return true
      const task = taskById.get(nodeId.slice('work:'.length))
      return task ? visibilityForTask(task, taskById).countInProjectTotals : false
    }),
  )
  const deferred = new Set(
    scope.deferredNodeIds.filter((nodeId) => {
      if (!nodeId.startsWith('work:')) return true
      const task = taskById.get(nodeId.slice('work:'.length))
      return task ? visibilityForTask(task, taskById).countInProjectTotals : false
    }),
  )
  for (const nodeId of [...included]) {
    if (!nodeId.startsWith('work:')) continue
    const task = taskById.get(nodeId.slice('work:'.length))
    if (task?.status === 'shelved') {
      included.delete(nodeId)
      deferred.add(nodeId)
    }
  }
  for (const nodeId of [...included, ...deferred]) {
    if (!nodeId.startsWith('work:')) continue
    const parentId = nodeId.slice('work:'.length)
    const parent = taskById.get(parentId)
    if (!parent) continue
    const parentWasDeferred = deferred.has(taskNodeId(parentId)) && !included.has(taskNodeId(parentId))
    const visibleChildren = [...(childIdsByParent.get(parentId) ?? [])]
      .map(childId => taskById.get(childId))
      .filter((child): child is OrientationTaskInput => Boolean(child))
      .filter(child => child.status !== 'archived' && child.status !== 'cancelled')
      .filter(child => isMaterializedExecutionChild(parent, child))
      .filter(child => visibilityForTask(child, taskById).countInProjectTotals)
    if (visibleChildren.length === 0) continue
    included.delete(taskNodeId(parentId))
    deferred.delete(taskNodeId(parentId))
    for (const child of visibleChildren) {
      const childNodeId = taskNodeId(child.id)
      if (parentWasDeferred || child.status === 'shelved' || deferred.has(childNodeId)) {
        included.delete(childNodeId)
        deferred.add(childNodeId)
      } else {
        deferred.delete(childNodeId)
        included.add(childNodeId)
      }
    }
  }
  return {
    ...scope,
    nodeIds: [...included],
    deferredNodeIds: [...deferred],
  }
}

function isMaterializedExecutionChild(parent: OrientationTaskInput, child: OrientationTaskInput): boolean {
  return child.hierarchy?.relation === 'decomposes' || child.id.startsWith(`${parent.id}-split-`)
}

function taskTitle(task: OrientationTaskInput): string {
  return taskDisplayLabel(task, task.id)
}

function taskCountsTowardScopeProgress(
  task: Pick<OrientationTaskInput, 'id'>,
  scope: OrientationScope | null,
): boolean {
  if (!scope) return true
  const nodeId = taskNodeId(task.id)
  return scope.nodeIds.includes(nodeId) || scope.deferredNodeIds.includes(nodeId)
}

function hasSpec(task: OrientationTaskInput): boolean {
  return Boolean(task.spec?.trim()) || task.structuredSpec != null || task.status === 'spec_review'
}

function hasBrief(task: OrientationTaskInput): boolean {
  return Boolean(task.productBrief?.approvedAt)
}

function proofForTask(
  task: OrientationTaskInput,
  options: { suppressMissingProof?: boolean; requireModeledProof?: boolean; forceModeledProofMissing?: boolean } = {},
): OrientationProofSummary {
  const recorded = recordedCompletionProofForTask(task)
  const classified = classifyCompletionProof(recorded, taskProofIsStale(task))
  const current = summarizeCurrentProof(task as Record<string, unknown>)
  const handoff = task.completionHandoff && typeof task.completionHandoff === 'object'
    ? task.completionHandoff as {
        verified?: string[]
        notVerified?: string[]
        remainingRisks?: string[]
      }
    : null
  const verified = [...current.verified, ...classified.current, ...(handoff?.verified ?? [])]
  const missing = [...current.missing, ...(handoff?.notVerified ?? []), ...(handoff?.remainingRisks ?? [])].filter(Boolean)
  const plannedProof = Array.isArray(task.proofPaths) ? task.proofPaths.length : 0
  const base = { expectationCount: plannedProof }
  if (
    task.status === 'done' &&
    !taskHasScriptProofPath(task) &&
    (options.forceModeledProofMissing || (options.requireModeledProof && verified.length === 0))
  ) {
    return {
      state: 'needed',
      verified,
      missing: ['Script-only scope needs a command proof path for this completed task.'],
      ...base,
    }
  }
  if (options.suppressMissingProof && task.status === 'done') {
    return {
      state: verified.length > 0 ? 'proven' : 'none',
      verified,
      missing: [],
      ...base,
    }
  }
  if (taskProofIsStale(task as unknown)) {
    return {
      state: 'needed',
      verified,
      missing: missing.length > 0 ? missing : ['Required proof evidence has not been attached yet.'],
      ...base,
    }
  }
  if (task.status === 'done' && taskDoneButProofMissing(task as unknown)) {
    return {
      state: 'needed',
      verified,
      missing: missing.length > 0 ? missing : ['Required proof evidence has not been attached yet.'],
      ...base,
    }
  }
  // Historical evidence can remain attached after a current plan is reopened
  // or cleared. It belongs in the audit trail, but cannot prove a new
  // non-terminal plan that has not declared what evidence it requires.
  if (task.status !== 'done' && plannedProof === 0) {
    return {
      state: 'needed',
      // Historical gates and reviews remain available in the evidence/history
      // surfaces, but they cannot be presented as current proof after the
      // plan has been reopened or cleared.
      verified: [],
      missing: missing.length > 0 ? missing : ['Current proof contract has not been attached yet.'],
      ...base,
    }
  }
  if (plannedProof === 0 && verified.length === 0 && missing.length === 0) {
    return { state: 'needed', verified, missing: ['Verification evidence has not been attached yet.'], ...base }
  }
  if (missing.length > 0) return { state: verified.length > 0 ? 'partial' : 'needed', verified, missing, ...base }
  if (verified.length > 0) return { state: 'proven', verified, missing, ...base }
  if (plannedProof > 0) return { state: 'needed', verified, missing: ['Planned proof exists, but no proof evidence has been attached yet.'], ...base }
  return { state: 'none', verified, missing, ...base }
}

function hasExplicitProofExpectation(task: OrientationTaskInput): boolean {
  const handoff = task.completionHandoff && typeof task.completionHandoff === 'object'
    ? task.completionHandoff as {
        notVerified?: string[]
        remainingRisks?: string[]
      }
    : null
  return (
    (Array.isArray(task.proofPaths) && task.proofPaths.length > 0) ||
    ((handoff?.notVerified?.length ?? 0) > 0) ||
    ((handoff?.remainingRisks?.length ?? 0) > 0)
  )
}

function taskIsBlocked(task: OrientationTaskInput): boolean {
  return task.status === 'blocked'
}

function duplicateProofMissingTaskIds(
  tasks: OrientationTaskInput[],
  scope: OrientationScope | null,
  tasksById: ReadonlyMap<string, OrientationTaskInput>,
): Set<string> {
  const scopedTasks = tasks.filter(task => taskEligibleForSelectedScope(task, scope, { tasksById }).eligible)
  const blockedScopedTasks = scopedTasks.filter(task => taskIsBlocked(task))
  const result = new Set<string>()
  for (const task of scopedTasks) {
    if (task.status !== 'done') continue
    if (!taskDoneButProofMissing(task as unknown)) continue
    const duplicateOwner = blockedScopedTasks.find(blocked => {
      if (blocked.id === task.id) return false
      if (taskTitleOverlap(blocked.title, task.title) < 0.8) return false
      return taskTitle(blocked).length >= taskTitle(task).length
    })
    if (duplicateOwner) result.add(task.id)
  }
  return result
}

function taskHasChildren(task: OrientationTaskInput, childIdsByParent: Map<string, string[]>): boolean {
  return (task.hierarchy?.childIds?.length ?? 0) > 0 || (childIdsByParent.get(task.id)?.length ?? 0) > 0
}

function childTasksFor(
  task: OrientationTaskInput,
  childIdsByParent: Map<string, string[]>,
  tasksById: ReadonlyMap<string, OrientationTaskInput>,
): OrientationTaskInput[] {
  return [...new Set([...(task.hierarchy?.childIds ?? []), ...(childIdsByParent.get(task.id) ?? [])])]
    .map(childId => tasksById.get(childId))
    .filter((child): child is OrientationTaskInput => Boolean(child))
}

function unfinishedChildRollupMaturity(
  task: OrientationTaskInput,
  childIdsByParent: Map<string, string[]>,
  scope: OrientationScope | null,
  tasksById: ReadonlyMap<string, OrientationTaskInput>,
  suppressedProofTaskIds: ReadonlySet<string>,
  proofBlockedTaskIds: ReadonlySet<string>,
  proofStyle: OrientationExecutionBoundary['proofStyle'],
): OrientationMaturity | null {
  const children = childTasksFor(task, childIdsByParent, tasksById)
    .filter(child => child.status !== 'archived' && child.status !== 'cancelled')
    .filter(child => taskEligibleForSelectedScope(child, scope, { tasksById }).eligible)
  if (children.length === 0) return null

  const unfinished = children.filter((child) => {
    if (child.status === 'shelved') return false
    if (child.status !== 'done') return true
    const proof = proofForTask(child, {
      suppressMissingProof: suppressedProofTaskIds.has(child.id),
      requireModeledProof: proofStyle === 'script_only',
      forceModeledProofMissing: proofBlockedTaskIds.has(child.id),
    })
    return (hasExplicitProofExpectation(child) || proofStyle === 'script_only') &&
      (proof.state === 'needed' || proof.state === 'partial')
  })
  if (unfinished.length === 0) return null
  if (unfinished.some(child => child.status === 'blocked')) return 'blocked'
  if (unfinished.some(child => child.status === 'in_progress')) return 'active'
  if (unfinished.some(child => child.status === 'review' || child.status === 'gate_check')) return 'review'
  if (unfinished.some((child) => {
    if (child.status !== 'done') return false
    const proof = proofForTask(child, {
      suppressMissingProof: suppressedProofTaskIds.has(child.id),
      requireModeledProof: proofStyle === 'script_only',
      forceModeledProofMissing: proofBlockedTaskIds.has(child.id),
    })
    return (hasExplicitProofExpectation(child) || proofStyle === 'script_only') &&
      (proof.state === 'needed' || proof.state === 'partial')
  })) return 'proof_needed'
  return 'sliced'
}

function maturityForTask(
  task: OrientationTaskInput,
  childIdsByParent: Map<string, string[]>,
  scope: OrientationScope | null,
  tasksById: ReadonlyMap<string, OrientationTaskInput>,
  suppressedProofTaskIds: ReadonlySet<string>,
  proofBlockedTaskIds: ReadonlySet<string>,
  proofStyle: OrientationExecutionBoundary['proofStyle'],
): OrientationMaturity {
  if (!taskEligibleForSelectedScope(task, scope, { tasksById }).eligible) return 'deferred'
  if (task.status === 'shelved') return 'deferred'
  if (task.status === 'blocked') return 'blocked'
  if (task.status === 'in_progress') return 'active'
  if (task.status === 'review' || task.status === 'gate_check') return 'review'
  const childRollup = unfinishedChildRollupMaturity(task, childIdsByParent, scope, tasksById, suppressedProofTaskIds, proofBlockedTaskIds, proofStyle)
  if (childRollup === 'active' || childRollup === 'review' || childRollup === 'blocked') return childRollup
  if (task.status === 'done') {
    if (childRollup) return childRollup
    const proof = proofForTask(task, {
      suppressMissingProof: suppressedProofTaskIds.has(task.id),
      requireModeledProof: proofStyle === 'script_only',
      forceModeledProofMissing: proofBlockedTaskIds.has(task.id),
    })
    if (proof.state === 'proven') return 'proven'
    if ((hasExplicitProofExpectation(task) || proofStyle === 'script_only') && (proof.state === 'needed' || proof.state === 'partial')) return 'proof_needed'
    return 'done'
  }
  const childBearing = taskHasChildren(task, childIdsByParent)
  if (task.status === 'ready' && !childBearing && (task.workKind === 'app_spec' || task.workKind === 'feature_spec')) {
    return 'needs_breakdown'
  }
  const proof = proofForTask(task, {
    suppressMissingProof: suppressedProofTaskIds.has(task.id),
    requireModeledProof: proofStyle === 'script_only',
    forceModeledProofMissing: proofBlockedTaskIds.has(task.id),
  })
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
  if (maturity === 'ready' || (maturity === 'proof_needed' && task.status === 'ready')) progress.ready = 1
  if (maturity === 'active' || maturity === 'review') progress.active = 1
  if (maturity === 'proven') progress.proven = 1
  if (maturity === 'done' || maturity === 'proven') progress.done = 1
  if (maturity === 'blocked') progress.blocked = 1
  if (maturity === 'deferred') progress.deferred = 1
  return progress
}

function progressForSelectedScope(
  tasks: OrientationTaskInput[],
  scope: OrientationScope | null,
  proofStyle: OrientationExecutionBoundary['proofStyle'],
  proofBlockedTaskIds: ReadonlySet<string> = new Set(),
): OrientationProgress {
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const childIdsByParent = buildChildMap(tasks)
  const suppressedProofTaskIds = duplicateProofMissingTaskIds(tasks, scope, tasksById)
  return tasks.reduce((progress, task) => {
    if (isProjectSetupTask(task.id) || task.status === 'archived' || task.status === 'cancelled') return progress
    if (!visibilityForTask(task, tasksById).countInProjectTotals) return progress
    if (!taskCountsTowardScopeProgress(task, scope)) return progress
    const maturity = maturityForTask(task, childIdsByParent, scope, tasksById, suppressedProofTaskIds, proofBlockedTaskIds, proofStyle)
    return addProgress(progress, progressForTask(task, maturity, scope?.id ?? null))
  }, emptyProgress(scope?.id ?? null))
}

function progressFromScopeProjection(
  projection: ProjectScopeProjection,
  scopeId: string | null,
  fallback: OrientationProgress,
): OrientationProgress {
  return {
    ...fallback,
    scopeId,
    total: Math.max(fallback.total, projection.counts.included + projection.counts.deferred),
    ready: projection.counts.ready,
    active: Math.max(projection.counts.active, fallback.active),
    done: projection.counts.done,
    blocked: projection.counts.ownerBlocked + projection.counts.proofBlocked,
    deferred: Math.max(fallback.deferred, projection.counts.deferred),
  }
}

function scopeRowsFromProjection(projection: ProjectScopeProjection | null | undefined): OrientationScopeRow[] {
  if (!projection) return []
  return executionScopeRows(projection.rows).map(row => ({
    taskId: row.taskId,
    nodeId: taskNodeId(row.taskId),
    title: row.title,
    scope: row.scope,
    eligibilityReason: row.eligibilityReason,
    hierarchyRole: row.hierarchyRole,
    status: row.status,
    handoffState: row.handoffState,
    blocksStart: row.blocksStart,
    blocksRelease: row.blocksRelease,
    humanBlocking: row.humanBlocking,
    sourceRefs: [...row.sourceRefs],
  }))
}

function mergeScopeRowsIntoScope(scope: OrientationScope, rows: OrientationScopeRow[]): OrientationScope {
  if (rows.length === 0) return scope
  const nodeIds = new Set(scope.nodeIds ?? [])
  const deferredNodeIds = new Set(scope.deferredNodeIds ?? [])
  for (const row of rows) {
    if (row.scope === 'included') {
      deferredNodeIds.delete(row.nodeId)
      nodeIds.add(row.nodeId)
    } else {
      nodeIds.delete(row.nodeId)
      deferredNodeIds.add(row.nodeId)
    }
  }
  return {
    ...scope,
    nodeIds: [...nodeIds],
    deferredNodeIds: [...deferredNodeIds],
  }
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
  proofStyle: OrientationExecutionBoundary['proofStyle'],
  proofBlockedTaskIds: ReadonlySet<string> = new Set(),
): { roots: OrientationNode[]; byId: Map<string, OrientationNode>; gaps: OrientationGap[] } {
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const childIdsByParent = buildChildMap(tasks)
  const suppressedProofTaskIds = duplicateProofMissingTaskIds(tasks, scope, tasksById)
  const byId = new Map<string, OrientationNode>()
  const gaps: OrientationGap[] = []

  const build = (task: OrientationTaskInput): OrientationNode => {
    const existing = byId.get(taskNodeId(task.id))
    if (existing) return existing
    const maturity = maturityForTask(task, childIdsByParent, scope, tasksById, suppressedProofTaskIds, proofBlockedTaskIds, proofStyle)
    const visibility = visibilityForTask(task, tasksById)
    const children = (childIdsByParent.get(task.id) ?? [])
      .map(childId => tasksById.get(childId))
      .filter((child): child is OrientationTaskInput => Boolean(child))
      .map(build)
      .filter(child => child.visibility.kind !== 'hidden')
    const childProgress = children.reduce(
      (progress, child) => child.visibility.countInProjectTotals
        ? addProgress(progress, child.progress)
        : progress,
      emptyProgress(scope?.id ?? null),
    )
    const ownProgress = visibility.countInProjectTotals && taskCountsTowardScopeProgress(task, scope)
      ? progressForTask(task, maturity, scope?.id ?? null)
      : emptyProgress(scope?.id ?? null)
    const proof = proofForTask(task, {
      suppressMissingProof: suppressedProofTaskIds.has(task.id),
      requireModeledProof: proofStyle === 'script_only',
      forceModeledProofMissing: proofBlockedTaskIds.has(task.id),
    })
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
        kind: (task.references ?? []).length > 0 ? 'import' : 'task',
        refs: sourceRefsForTask(task),
        confidence: 'high',
        freshness: task.updatedAt ? 'fresh' : 'unknown',
        inferred: false,
        refreshedAt: now,
      },
      visibility,
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
    .filter(root => root.visibility.kind !== 'hidden')
  const roots = groupFlatRootsByDomain(taskRoots, tasks, scope, now, byId)
  return { roots, byId, gaps }
}

function capabilityNodeId(contextId: string): string {
  return `capability:${contextId}`
}

function summarizeCapabilityArea(title: string, children: OrientationNode[]): string {
  const count = children.length
  const deferred = children.filter(child => child.maturity === 'deferred').length
  const current = count - deferred
  const pieces = [
    `${count} mapped ${count === 1 ? 'capability' : 'capabilities'}`,
    current > 0 ? `${current} shaping current understanding` : null,
    deferred > 0 ? `${deferred} documented for later` : null,
  ].filter(Boolean)
  return `${title} project skeleton: ${pieces.join(' · ')}.`
}

function stripImportPrefix(ref: string): string {
  return ref.startsWith('import:') ? ref.slice('import:'.length) : ref
}

function humanizeFileStem(stem: string): string {
  return stem
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function orientationAreaDescriptorFromRefs(
  refs: readonly string[] | undefined,
): { key: string; title: string } | null {
  const normalizedRefs = (refs ?? [])
    .map(ref => stripImportPrefix(ref).replaceAll('\\', '/'))
    .filter(Boolean)
  if (normalizedRefs.length === 0) return null

  const hasPath = (pattern: RegExp) => normalizedRefs.some(ref => pattern.test(ref))
  if (hasPath(/(?:^|\/)docs\/harness\/remaining-spec-decomposition-inventory\.md$/i)) {
    return { key: 'spec-decomposition-inventory', title: 'Spec Decomposition Inventory' }
  }
  if (hasPath(/(?:^|\/)docs\/harness\/implementation-roadmap\.md$/i)) {
    return { key: 'implementation-roadmap', title: 'Implementation Roadmap' }
  }
  if (hasPath(/(?:^|\/)docs\/harness\/architecture-notes\.md$/i)) {
    return { key: 'architecture-notes', title: 'Architecture Notes' }
  }
  if (hasPath(/(?:^|\/)docs\/specs\/[^/]+\.md$/i)) {
    return { key: 'story-intelligence-specs', title: 'Story Intelligence Specs' }
  }
  const firstSpecRef = normalizedRefs.find(ref => /(?:^|\/)specs\/[^/]+\.md$/i.test(ref))
  if (firstSpecRef) {
    const stem = firstSpecRef.split('/').pop()
    if (stem) {
      return {
        key: `spec:${normalizeText(stem).replace(/\s+/g, '-') || 'spec'}`,
        title: `${humanizeFileStem(stem)} Spec`,
      }
    }
  }

  const firstDocRef = normalizedRefs.find(ref => /(?:^|\/)docs\/.+\.md$/i.test(ref))
  if (!firstDocRef) return null
  const stem = firstDocRef.split('/').pop()
  if (!stem) return null
  return {
    key: normalizeText(stem).replace(/\s+/g, '-') || 'docs',
    title: humanizeFileStem(stem),
  }
}

function mergeWorkspaceImportContexts(input: {
  roots: OrientationNode[]
  byId: Map<string, OrientationNode>
  contexts: OrientationWorkspaceImportDraftContext[]
  scope: OrientationScope | null
  now: string
}): OrientationNode[] {
  if (input.contexts.length === 0) return input.roots
  const roots = [...input.roots]
  const areaIndex = new Map<string, number>()
  roots.forEach((root, index) => areaIndex.set(root.id, index))

  const grouped = new Map<string, OrientationWorkspaceImportDraftContext[]>()
  for (const context of input.contexts) {
    const area = orientationAreaDescriptorFromRefs(context.refs) ?? (
      context.domain?.trim()
        ? { key: context.domain.trim(), title: titleFromDomain(context.domain.trim()) }
        : { key: 'unsorted', title: 'Unsorted work' }
    )
    const list = grouped.get(area.key) ?? []
    list.push(context)
    grouped.set(area.key, list)
  }

  for (const [groupKey, contexts] of grouped) {
    const areaDescriptor =
      orientationAreaDescriptorFromRefs(contexts.flatMap(context => context.refs ?? [])) ?? (
        contexts[0]?.domain?.trim()
          ? { key: contexts[0].domain.trim(), title: titleFromDomain(contexts[0].domain.trim()) }
          : { key: groupKey || 'unsorted', title: groupKey === 'unsorted' ? 'Unsorted work' : titleFromDomain(groupKey) }
      )
    const areaId = `area:${normalizeText(areaDescriptor.key || 'unsorted').replace(/\s+/g, '-') || 'unsorted'}`
    const title = areaDescriptor.title
    const children = contexts.map((context) => {
      const maturity: OrientationMaturity = context.scopeHint === 'later'
        ? 'deferred'
        : context.role === 'brief_input'
          ? 'brief'
          : 'idea'
      const node: OrientationNode = {
        id: capabilityNodeId(context.id),
        parentId: areaId,
        kind: 'feature',
        title: context.title,
        summary: context.description ?? context.title,
        maturity,
        progress: emptyProgress(input.scope?.id ?? null),
        proof: { state: 'none', verified: [], missing: [], expectationCount: 0 },
        ownerAction: null,
        blockers: [],
        refs: {
          taskIds: [],
          threadIds: [],
          artifactIds: [],
          structuralDomainIds: [],
          primitiveIds: [],
          releaseCheckIds: [],
        },
        source: {
          kind: 'inferred',
          refs: context.refs?.length ? context.refs : ['workspace-import:draft'],
          confidence: 'medium',
          freshness: 'fresh',
          inferred: true,
          refreshedAt: input.now,
        },
        visibility: { kind: 'supporting', countInProjectTotals: false },
        children: [],
      }
      input.byId.set(node.id, node)
      return node
    })

    const existingIndex = areaIndex.get(areaId)
    if (existingIndex != null) {
      const existing = roots[existingIndex]!
      const mergedChildren = [...existing.children, ...children]
      const updated: OrientationNode = {
        ...existing,
        children: mergedChildren,
      }
      roots[existingIndex] = updated
      input.byId.set(updated.id, updated)
      continue
    }

    const area: OrientationNode = {
      id: areaId,
      parentId: null,
      kind: 'area',
      title,
      summary: summarizeCapabilityArea(title, children),
      maturity: 'idea',
      progress: emptyProgress(input.scope?.id ?? null),
      proof: { state: 'none', verified: [], missing: [], expectationCount: 0 },
      ownerAction: null,
      blockers: [],
        refs: {
          taskIds: [],
          threadIds: [],
          artifactIds: [],
          structuralDomainIds: areaDescriptor.key ? [`domain:${areaDescriptor.key}`] : [],
          primitiveIds: [],
          releaseCheckIds: [],
        },
      source: {
        kind: 'inferred',
        refs: children.flatMap(child => child.source.refs),
        confidence: 'medium',
        freshness: 'fresh',
        inferred: true,
        refreshedAt: input.now,
      },
      visibility: { kind: 'supporting', countInProjectTotals: false },
      children,
    }
    roots.push(area)
    input.byId.set(area.id, area)
    areaIndex.set(area.id, roots.length - 1)
  }

  return roots.sort((left, right) => left.title.localeCompare(right.title))
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
  const structuredRoots = roots.filter(root => root.children.length > 0 || root.kind === 'area')
  const flatRoots = roots.filter(root => root.children.length === 0 && root.kind !== 'area')
  if (flatRoots.length < 2) return roots
  const tasksByNodeId = new Map(tasks.map(task => [taskNodeId(task.id), task]))
  const groups = new Map<string, OrientationNode[]>()
  const groupMeta = new Map<string, { title: string; structuralDomainId?: string }>()
  for (const root of flatRoots) {
    const task = tasksByNodeId.get(root.id)
    const importedArea = orientationAreaDescriptorFromRefs(task?.references)
    const key = importedArea?.key || task?.domain?.trim() || 'unsorted'
    const list = groups.get(key) ?? []
    list.push(root)
    groups.set(key, list)
    if (!groupMeta.has(key)) {
      groupMeta.set(key, {
        title: importedArea?.title ?? titleFromDomain(task?.domain?.trim() || 'unsorted'),
        structuralDomainId: key && key !== 'unsorted' ? `domain:${key}` : undefined,
      })
    }
  }
  if (groups.size < 2) return roots
  const areaRoots: OrientationNode[] = []
  for (const [domain, children] of groups) {
    const meta = groupMeta.get(domain)
    const title = meta?.title ?? titleFromDomain(domain)
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
        expectationCount: normalizedChildren.reduce((count, child) => count + child.proof.expectationCount, 0),
      },
      ownerAction: null,
      blockers: normalizedChildren.flatMap(child => child.blockers),
      refs: {
        taskIds: normalizedChildren.flatMap(child => child.refs.taskIds),
        threadIds: normalizedChildren.flatMap(child => child.refs.threadIds),
        artifactIds: normalizedChildren.flatMap(child => child.refs.artifactIds),
        structuralDomainIds: meta?.structuralDomainId ? [meta.structuralDomainId] : [],
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
  return [
    ...structuredRoots,
    ...areaRoots.sort((left, right) => left.title.localeCompare(right.title)),
  ]
}

function visibilityForTask(
  task: OrientationTaskInput,
  tasksById: ReadonlyMap<string, OrientationTaskInput>,
): OrientationNode['visibility'] {
  const parentId = task.hierarchy?.parentId?.trim() || null
  const parent = parentId ? tasksById.get(parentId) ?? null : null
  return deriveTaskWorkVisibility(task as never, parent as never)
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function materiallyDifferentScope(
  left: OrientationTaskInput,
  right: OrientationTaskInput,
  scope: OrientationScope | null,
  tasksById: ReadonlyMap<string, OrientationTaskInput>,
): boolean {
  const leftEligibility = taskEligibleForSelectedScope(left, scope, { tasksById })
  const rightEligibility = taskEligibleForSelectedScope(right, scope, { tasksById })
  if (leftEligibility.eligible !== rightEligibility.eligible) return true
  const leftReleases = (left.releaseIds ?? []).join('\n')
  const rightReleases = (right.releaseIds ?? []).join('\n')
  return leftReleases !== rightReleases
}

function duplicateScopeConflictGaps(
  tasks: OrientationTaskInput[],
  scope: OrientationScope | null,
): OrientationGap[] {
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const candidates = tasks.filter((task) => {
    if (task.status === 'archived' || task.status === 'cancelled') return false
    if (nodeIdIsWorkspaceImportPreview(taskScopeNodeId(task.id))) return false
    return visibilityForTask(task, tasksById).countInProjectTotals
  })
  const gaps: OrientationGap[] = []
  const seenPairs = new Set<string>()
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const left = candidates[i]!
      const right = candidates[j]!
      if (taskTitleOverlap(taskTitle(left), taskTitle(right)) < 0.65) continue
      if (!materiallyDifferentScope(left, right, scope, tasksById)) continue
      const key = [left.id, right.id].sort().join('\n')
      if (seenPairs.has(key)) continue
      seenPairs.add(key)
      const richer = taskTitle(left).length >= taskTitle(right).length ? left : right
      const other = richer === left ? right : left
      const refs = [
        `task:${richer.id}`,
        `task:${other.id}`,
        ...sourceRefsForTask(richer),
        ...sourceRefsForTask(other),
      ]
      gaps.push({
        kind: 'source_conflict',
        label: `Possible duplicate work is split across scopes: "${taskTitle(richer)}" overlaps "${taskTitle(other)}".`,
        refs: [...new Set(refs)],
        severity: 'warn',
      })
    }
  }
  return gaps
}

function sourceRefsForTask(task: OrientationTaskInput): string[] {
  const refs = [
    ...(task.references ?? []),
    ...((task.sourceClaims ?? []).flatMap(claim => claim.references ?? [])),
    ...explicitMarkdownSourceRefsFromTask({
      title: task.title,
      description: task.description,
      spec: task.spec,
      structuredSpec: task.structuredSpec,
      acceptanceCriteria: task.acceptanceCriteria?.map(criterion => ({
        description: typeof criterion.description === 'string' ? criterion.description : undefined,
        text: typeof criterion.text === 'string' ? criterion.text : undefined,
        command: typeof criterion.command === 'string' ? criterion.command : undefined,
      })),
      gateResults: task.gateResults,
      reviewVerdicts: task.reviewVerdicts,
    }),
  ]
    .map(ref => typeof ref === 'string' ? ref.trim() : '')
    .filter(Boolean)
    .map(ref => ref.startsWith('import:') ? ref : `import:${ref}`)
  return refs.length > 0 ? refs : [`task:${task.id}`]
}

function isSourceDocumentRef(ref: string): boolean {
  if (ref.startsWith('task:') || ref.startsWith('artifact:')) return false
  if (ref.startsWith('import:')) return true
  return /[/\\]/.test(ref) || /\.(md|mdx|txt|json|ya?ml)$/i.test(ref)
}

function missingSourceProvenanceGaps(rows: OrientationScopeRow[]): OrientationGap[] {
  const missing = rows.filter(row =>
    !row.sourceRefs.some(isSourceDocumentRef),
  )
  if (missing.length === 0) return []
  return [{
    kind: 'missing_source_provenance',
    label: `Selected scope map has ${missing.length} work ${missing.length === 1 ? 'item' : 'items'} without source document references.`,
    refs: missing.map(row => `task:${row.taskId}`),
    severity: 'warn',
  }]
}

function sourceRefLabel(ref: string): string {
  const value = ref.startsWith('import:') ? ref.slice('import:'.length) : ref
  const parts = value.split(/[/\\]/).filter(Boolean)
  return parts.at(-1) ?? value
}

function countLabel(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`
}

function sourceIsInferred(source: unknown): boolean {
  if (!source) return true
  if (typeof source === 'string') return source === 'inferred' || source === 'missing'
  if (typeof source === 'object' && 'inferred' in source) return Boolean((source as { inferred?: unknown }).inferred)
  return false
}

function sourceLabelFor(source: unknown): string {
  if (!source) return 'Missing'
  if (typeof source === 'string') return source.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const typed = source as { kind?: string; confidence?: string; inferred?: boolean }
  const kind = typed.kind
    ? typed.kind.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : typed.inferred ? 'Inferred' : 'Recorded'
  return typed.confidence ? `${kind} · ${typed.confidence.replace(/_/g, ' ')} confidence` : kind
}

function collectSourceNodes(roots: OrientationNode[], nodesById: Map<string, OrientationNode>): OrientationNode[] {
  const nodes: OrientationNode[] = []
  const seen = new Set<string>()
  const add = (node: OrientationNode | undefined) => {
    if (!node || seen.has(node.id)) return
    seen.add(node.id)
    nodes.push(node)
    node.children.forEach(add)
  }
  for (const node of nodesById.values()) add(node)
  roots.forEach(add)
  return nodes
}

function buildSourceTrail(input: {
  charter: ProjectOrientationCharter
  executionBoundary: OrientationExecutionBoundary
  scope: OrientationScope | null
  selectedRelease: OrientationRelease | null
  summary: ProjectOrientationSummary
  roots: OrientationNode[]
  nodesById: Map<string, OrientationNode>
  taskCount: number
}): OrientationSourceTrailRow[] {
  const taskRefs = new Set<string>()
  const artifactRefs = new Set<string>()
  const sourceDocRefs = new Set<string>()
  for (const node of collectSourceNodes(input.roots, input.nodesById)) {
    for (const ref of node.source.refs ?? []) {
      if (ref.startsWith('task:')) taskRefs.add(ref)
      if (ref.startsWith('artifact:')) artifactRefs.add(ref)
      if (isSourceDocumentRef(ref)) sourceDocRefs.add(ref)
    }
    for (const artifactId of node.refs.artifactIds) artifactRefs.add(`artifact:${artifactId}`)
  }
  for (const ref of [
    ...(input.executionBoundary.source.refs ?? []),
    ...sourceRefsFromReleaseSource(input.selectedRelease?.source),
  ]) {
    if (ref.startsWith('task:')) taskRefs.add(ref)
    if (ref.startsWith('artifact:')) artifactRefs.add(ref)
    if (isSourceDocumentRef(ref)) sourceDocRefs.add(ref)
  }
  const sourceDocNames = [...sourceDocRefs].map(sourceRefLabel).filter(Boolean)
  const scopeLabel = input.summary.selectedScopeLabel ?? input.scope?.label ?? input.summary.selectedReleaseLabel ?? input.selectedRelease?.label ?? 'Current scope'
  const workRecordCount = Math.max(taskRefs.size, input.summary.includedWorkCount) || input.taskCount
  const workRecordDetail = artifactRefs.size > 0
    ? `${artifactRefs.size} artifact references are attached to mapped work.`
    : sourceDocRefs.size > 0
      ? `${countLabel(sourceDocRefs.size, 'source document')} attached to mapped work.`
      : 'Task records are mapped, but source documents are not attached yet.'
  return [
    {
      label: 'Charter',
      value: sourceLabelFor(input.charter.source),
      detail: sourceIsInferred(input.charter.source)
        ? 'Purpose and audience are inferred from durable project state and should be confirmed when they matter.'
        : 'Purpose and audience were supplied or approved directly.',
      tone: sourceIsInferred(input.charter.source) ? 'warn' : 'ok',
    },
    {
      label: 'Scope',
      value: sourceLabelFor(input.selectedRelease?.source ?? input.scope?.source),
      detail: `${scopeLabel} contains ${input.summary.includedWorkCount} assigned work items and ${input.summary.deferredWorkCount} later.`,
      tone: sourceIsInferred(input.selectedRelease?.source ?? input.scope?.source) ? 'warn' : 'ok',
    },
    {
      label: 'Source docs',
      value: countLabel(sourceDocRefs.size, 'source document'),
      detail: sourceDocNames.length > 0
        ? sourceDocNames.slice(0, 4).join(', ')
        : 'No source documents are attached to mapped claims yet.',
      tone: sourceDocRefs.size > 0 ? 'ok' : 'warn',
    },
    {
      label: 'Work records',
      value: `${workRecordCount} task records`,
      detail: workRecordDetail,
      tone: artifactRefs.size > 0 || sourceDocRefs.size > 0 ? 'ok' : 'warn',
    },
    {
      label: 'Proof mode',
      value: input.executionBoundary.label,
      detail: input.executionBoundary.detail,
      tone: input.executionBoundary.mode === 'headless' || input.executionBoundary.mode === 'mixed' ? 'accent' : input.executionBoundary.mode === 'unspecified' ? 'warn' : 'neutral',
    },
  ]
}

function sourceRefsFromReleaseSource(source: OrientationRelease['source'] | OrientationSource | undefined): string[] {
  return source && typeof source === 'object' ? source.refs ?? [] : []
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
  const seen = new Set<string>()
  const result = (Array.isArray(blockers) ? blockers : [])
    .filter((blocker, index) => {
      const label = blocker.label ?? blocker.title ?? blocker.id ?? `Release blocker ${index + 1}`
      const key = `${blocker.id ?? ''}\n${normalizeText(label)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((blocker, index) => {
    const label = blocker.label ?? blocker.title ?? blocker.id ?? `Release blocker ${index + 1}`
    const owningNode = releaseBlockerOwnerNode(blocker.id ?? null, label, nodes)
    const output: OrientationBlocker = {
      id: blocker.id ?? `release-blocker-${index + 1}`,
      label,
      ...(blocker.nextAction ? { nextAction: blocker.nextAction } : {}),
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

function releaseBlockerOwnerNode(
  blockerId: string | null,
  label: string,
  nodes: OrientationNode[],
): OrientationNode | null {
  if (blockerId?.startsWith('start-readiness:')) return null
  if (blockerId) {
    const direct = nodes.find(node => node.refs.taskIds.includes(blockerId) || node.id === `work:${blockerId}`)
    if (direct) return direct
  }
  const normalized = normalizeText(label)
  const exact = nodes.find(node => {
    const title = normalizeText(node.title)
    return title.length > 0 && (normalized === title || normalized.startsWith(`${title} `) || normalized.includes(`${title} `))
  })
  if (exact) return exact
  return nodes.find(node => sharedTokenCount(label, node.title) >= 2) ?? null
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

function startReadinessFocusPin(
  startReadiness: BuildProjectOrientationSpineInput['startReadiness'],
): OrientationPin | null {
  if (!startReadiness?.focusTaskId || !startReadiness.focusTaskTitle) return null
  const nodeId = taskScopeNodeId(startReadiness.focusTaskId)
  const focusKind = startReadiness.focusKind ?? ''
  const kind: OrientationPin['kind'] = focusKind === 'proof'
    ? 'proof'
    : focusKind === 'spec_review'
      ? 'review'
      : startReadiness.canStart
        ? 'active_work'
        : 'owner_input'
  return {
    id: `start-focus:${startReadiness.focusTaskId}`,
    nodeId,
    label: startReadiness.focusTaskTitle,
    kind,
    href: startReadiness.actionHref ?? `/task/${encodeURIComponent(startReadiness.focusTaskId)}`,
  }
}

function startReadinessWithFocus(
  startReadiness: BuildProjectOrientationSpineInput['startReadiness'],
  scopeProjection: ProjectScopeProjection | null | undefined,
  tasks: readonly OrientationTaskInput[],
): BuildProjectOrientationSpineInput['startReadiness'] {
  if (!startReadiness) return startReadiness
  const hrefTaskId = startReadiness.actionHref
    ? /^\/task\/([^/?#]+)/.exec(startReadiness.actionHref)?.[1]
    : undefined
  const focusTaskId = startReadiness.focusTaskId ?? (hrefTaskId ? decodeURIComponent(hrefTaskId) : undefined) ?? scopeProjection?.start.focusTaskId
  if (!focusTaskId) return startReadiness
  const taskTitle = tasks.find(task => task.id === focusTaskId)?.title
  const focusTaskTitle = startReadiness.focusTaskTitle ?? taskTitle ?? (
    scopeProjection?.start.focusTaskId === focusTaskId ? scopeProjection.start.focusTaskTitle : undefined
  )
  return {
    ...startReadiness,
    focusTaskId,
    ...(focusTaskTitle ? { focusTaskTitle } : {}),
    focusKind: startReadiness.focusKind ?? (
      scopeProjection?.start.focusTaskId === focusTaskId ? scopeProjection.start.focusKind : undefined
    ),
  }
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
    ? 'Guildhall has not collected whether the current task scope should be proven headlessly, through UI review, or both.'
    : proofStyle === 'script_only'
      ? 'The current task scope should be proven with scripts or commands before it is treated as ready.'
      : proofStyle === 'manual'
        ? 'The current task scope includes UI or manual proof expectations.'
        : 'The current task scope includes more than one proof style.'
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
    .filter(node =>
      (node.kind === 'work' || node.kind === 'feature' || node.kind === 'slice') &&
      node.visibility.countInProjectTotals !== false &&
      node.maturity !== 'deferred' &&
      node.proof.state !== 'none' &&
      (node.refs.taskIds?.length ?? 0) > 0,
    )
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

function releaseReadinessProofBlockedTaskIds(
  blockers: BuildProjectOrientationSpineInput['releaseReadiness'] extends infer T
    ? T extends { blockers?: infer B } ? B : never
    : never,
): Set<string> {
  const ids = new Set<string>()
  for (const blocker of Array.isArray(blockers) ? blockers : []) {
    const label = `${blocker.label ?? ''} ${blocker.title ?? ''}`
    if (!/\bproof\b/i.test(label)) continue
    const id = blocker.id?.replace(/^work:/, '').trim()
    if (id && !id.startsWith('repository-followup:')) ids.add(id)
  }
  return ids
}

function sourceHealth(nodes: OrientationNode[], gaps: OrientationGap[]): OrientationSourceHealth {
  const allNodes: OrientationNode[] = []
  const visit = (node: OrientationNode) => {
    allNodes.push(node)
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  const sourceGaps = gaps
    .filter(gap => gap.kind === 'missing_source_provenance')
    .reduce((sum, gap) => sum + Math.max(1, gap.refs.length), 0)
  return {
    inferred: allNodes.filter(node => node.source.inferred).length,
    conflicts: gaps.filter(gap => gap.kind === 'source_conflict').length,
    gaps: sourceGaps,
  }
}

function summarizeStartReadiness(input: {
  workLabel: string | null
  explicitRelease: boolean
  progress: OrientationProgress
  outsideWork: { count: number } | null
  startReadiness: NonNullable<BuildProjectOrientationSpineInput['startReadiness']>
}): { headline: string; topBlocker: string | null; nextAction: string } | null {
  const { workLabel, startReadiness } = input
  const genericWorkLabel = workLabel ?? 'Current task scope'
  if (startReadiness.canStart && startReadiness.code === 'paused_live_work') {
    return {
      headline: `${genericWorkLabel} is paused with work in progress.`,
      topBlocker: null,
      nextAction: 'Resume the current work.',
    }
  }
  if (startReadiness.canStart) return null
  const message = typeof startReadiness.message === 'string' && startReadiness.message.trim()
    ? startReadiness.message.trim()
    : 'Project start is blocked until the current issue is resolved.'
  switch (startReadiness.code) {
    case 'all_terminal':
      if (!input.explicitRelease) {
        return {
          headline: `${genericWorkLabel} is in progress.`,
          topBlocker: null,
          nextAction: 'Current work has no runnable work remaining.',
        }
      }
      if (input.outsideWork?.count) {
        return {
          headline: `${genericWorkLabel} is complete.`,
          topBlocker: message,
          nextAction: 'Review completed scope.',
        }
      }
      if (input.progress.total > input.progress.done + input.progress.deferred) {
        return {
          headline: `${genericWorkLabel} is waiting on proof.`,
          topBlocker: 'Proof evidence has not been attached yet.',
          nextAction: 'Attach proof for the completed scoped work.',
        }
      }
      return {
        headline: `${genericWorkLabel} is complete.`,
        topBlocker: null,
        nextAction: 'Review completed scope.',
      }
    case 'proof_evidence_missing':
      return {
        headline: `${genericWorkLabel} is waiting on proof.`,
        topBlocker: message,
        nextAction: message,
      }
    case 'import_drafts_waiting':
      return {
        headline: `${genericWorkLabel} needs import review.`,
        topBlocker: message,
        nextAction: message,
      }
    case 'imported_scope_shaping':
      return {
        headline: `${genericWorkLabel} is being shaped.`,
        topBlocker: message,
        nextAction: message,
      }
    case 'workspace_import_refresh_needed':
      if (input.progress.done > 0 && input.progress.active === 0 && input.progress.ready === 0 && input.progress.blocked === 0) {
        return {
          headline: `${genericWorkLabel} is complete.`,
          topBlocker: null,
          nextAction: 'Refresh import for newly documented work.',
        }
      }
      return {
        headline: `${genericWorkLabel} needs import refresh.`,
        topBlocker: 'Workspace import is under-scoped.',
        nextAction: message,
      }
    case 'no_unattended_progress':
      return {
        headline: `${genericWorkLabel} needs a decision.`,
        topBlocker: message,
        nextAction: message,
      }
    case 'scope_source_conflict':
      return {
        headline: `${genericWorkLabel} has source conflicts to review.`,
        topBlocker: message,
        nextAction: message,
      }
    default:
      return {
        headline: `${genericWorkLabel} needs attention.`,
        topBlocker: message,
        nextAction: message,
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
  scopeProjection?: ProjectScopeProjection | null
  runStatus?: BuildProjectOrientationSpineInput['runStatus']
}): ProjectOrientationSummary {
  const purpose = input.charter.goal ?? `Project ${input.projectId} needs a confirmed purpose.`
  const releaseLabel = input.selectedRelease?.label ?? null
  const workLabel = releaseLabel ?? input.scope?.label ?? null
  const rawReadinessSummary = input.startReadiness
    ? summarizeStartReadiness({
        workLabel,
        explicitRelease: input.selectedRelease !== null || input.scope?.kind === 'release' || input.scope?.kind === 'milestone',
        progress: input.progress,
        outsideWork: input.scopeProjection
          ? summarizeProjectScopeOutsideWork(input.scopeProjection.rows, input.scopeProjection.selectedScope)
          : null,
        startReadiness: input.startReadiness,
      })
    : null
  const includedWorkCount = Math.max(0, input.progress.total - input.progress.deferred)
  const includedWorkDone = includedWorkCount > 0 && input.progress.done >= includedWorkCount
  const readinessSummary = input.startReadiness?.canStart === false &&
    input.blockers.length > 0 &&
    (
      rawReadinessSummary?.topBlocker === null ||
      (input.startReadiness.code === 'workspace_import_refresh_needed' && includedWorkDone)
    )
    ? null
    : rawReadinessSummary
  const focusedShapingBlocker = input.startReadiness?.canStart === false &&
    input.startReadiness.code === 'imported_scope_shaping' &&
    input.startReadiness.focusTaskId
    ? input.blockers.find(blocker =>
        blocker.id === input.startReadiness?.focusTaskId ||
        blocker.id === taskScopeNodeId(input.startReadiness?.focusTaskId ?? ''),
      )?.label ?? input.blockers[0]?.label ?? null
    : null
  const topBlocker = focusedShapingBlocker ?? readinessSummary?.topBlocker ?? input.blockers[0]?.label ?? null
  const hasActionableWork =
    input.progress.ready > 0 ||
    input.progress.active > 0 ||
    input.progress.blocked > 0 ||
    input.progress.sliced > 0 ||
    input.progress.total > input.progress.done + input.progress.deferred
  const hasScopedWork = includedWorkCount > 0
  const runStatus = input.runStatus ?? null
  const hasActiveWork = input.progress.active > 0
  const runIsRunning = runStatus === null || runStatus === 'running'
  const runIsStopping = runStatus === 'stopping'
  const headline = readinessSummary?.headline ?? (
    workLabel
      ? topBlocker
        ? input.progress.blocked > 0
          ? `${workLabel} is blocked on proof.`
          : `${workLabel} is waiting on proof.`
        : hasActiveWork && runIsStopping
          ? `${workLabel} is stopping with work in progress.`
          : hasActiveWork && !runIsRunning
            ? `${workLabel} is paused with work in progress.`
          : hasActiveWork
            ? `${workLabel} is in progress.`
          : input.progress.done > 0 && hasActionableWork
            ? `${workLabel} is partly complete.`
            : hasActionableWork
              ? `${workLabel} is being shaped.`
              : hasScopedWork && input.progress.done > 0
                ? `${workLabel} is complete.`
                : `${workLabel} has no actionable work.`
      : 'No current work is selected yet.'
  )
  return {
    headline,
    purpose,
    selectedReleaseLabel: releaseLabel,
    selectedScopeLabel: workLabel,
    includedCount: includedWorkCount,
    includedWorkCount,
    deferredCount: input.progress.deferred,
    deferredWorkCount: input.progress.deferred,
    pinnedNow: input.pins.map(pin => pin.label),
    topBlocker,
    nextAction: readinessSummary?.nextAction ?? (topBlocker
      ? input.progress.blocked > 0
        ? `Review blocker: ${topBlocker}`
        : `Review waiting work: ${topBlocker}`
      : hasActiveWork && runIsStopping
        ? 'Wait for Guildhall to finish stopping, then resume.'
      : hasActiveWork && !runIsRunning
        ? 'Resume the current work.'
      : hasActiveWork
        ? 'Open the running work.'
        : input.progress.done > 0 && hasActionableWork
          ? 'Continue the remaining scoped work.'
          : 'Review current work.'),
    progress: input.progress,
  }
}

function summaryWithSourceConflicts(
  summary: ProjectOrientationSummary,
  gaps: readonly OrientationGap[],
): ProjectOrientationSummary {
  if (summary.topBlocker) return summary
  const conflict = gaps.find(gap => gap.kind === 'source_conflict' && gap.severity === 'blocker')
  if (!conflict) return summary
  const label = summary.selectedScopeLabel ?? summary.selectedReleaseLabel ?? 'Current scope'
  return {
    ...summary,
    headline: `${label} has source conflicts to review.`,
    topBlocker: conflict.label,
    nextAction: 'Review source conflicts before treating the scope as settled.',
  }
}

function startReadinessReleaseBlocker(
  startReadiness: BuildProjectOrientationSpineInput['startReadiness'],
): OrientationBlocker | null {
  if (!startReadiness || startReadiness.canStart) return null
  const blockerCodes = new Set([
    'proof_evidence_missing',
    'repository_followup_required',
    'scope_source_conflict',
  ])
  if (!blockerCodes.has(startReadiness.code ?? '')) return null
  const label = typeof startReadiness.message === 'string' && startReadiness.message.trim()
    ? startReadiness.message.trim()
    : 'Current work is blocked before Guildhall can start.'
  return {
    id: `start-readiness:${startReadiness.code ?? 'blocked'}`,
    label,
  }
}

export function buildProjectOrientationSpine(input: BuildProjectOrientationSpineInput): ProjectOrientationSpine {
  const now = input.now ?? new Date().toISOString()
  const baseTasks = (input.tasks ?? []).filter(task =>
    !isProjectSetupTask(task.id) &&
    task.status !== 'archived' &&
    task.status !== 'cancelled',
  )
  const draftAugmentation = augmentTasksWithWorkspaceImportDraft({
    tasks: baseTasks,
    workspaceImportDraft: input.workspaceImportDraft,
    now,
  })
  const tasks = draftAugmentation.tasks
  const startReadiness = startReadinessWithFocus(input.startReadiness, input.scopeProjection, tasks)
  const charter = normalizeCharter(input)
  const executionBoundary = buildExecutionBoundary({
    charter,
    tasks,
    now,
    sourceRefs: input.sourceRefs ?? [],
  })
  const releases = mergeOrientationReleaseInputs(input.releases, draftAugmentation.releases) ?? []
  const selectedReleaseId = selectedReleaseIdForOrientation(input, draftAugmentation.selectedReleaseId, releases)
  const releasesForReadModel = filterDuplicateSelectedStageReleases(releases, selectedReleaseId)
  const selectedRelease = normalizeRelease({
    ...input,
    selectedReleaseId,
    releases: releasesForReadModel,
    proofStyleFallback: executionBoundary.proofStyle,
  }, tasks)
  const projectionScope = orientationScopeFromProjection(input.scopeProjection)
  const selectedReleaseScope = selectedRelease
    ? matchingReadModelScope(selectedRelease, projectionScope, draftAugmentation.scope)
    : null
  const selectedReleaseForReadModel = selectedRelease
    ? releaseWithReadModelScope(selectedRelease, selectedReleaseScope, input.scopeProjection)
    : selectedRelease
  const projectionScopeForReadModel = projectionScope && selectedReleaseForReadModel?.id === projectionScope.id
    ? {
        ...projectionScope,
        label: selectedReleaseForReadModel.label ?? projectionScope.label,
        kind: selectedReleaseForReadModel.kind === 'milestone' ? 'milestone' as const : 'release' as const,
        source: selectedReleaseForReadModel.source,
      }
    : projectionScope
  const projectionScopeRows = scopeRowsFromProjection(input.scopeProjection)
  const projectionScopeNodeIds = new Set(projectionScopeRows.map(row => row.nodeId))
  const normalizedReleases = releasesForReadModel
    .map(release => normalizeRelease({
      ...input,
      selectedReleaseId: release.id,
      releases: [release],
      ...(release.id === selectedReleaseId ? { proofStyleFallback: executionBoundary.proofStyle } : {}),
    }, tasks))
    .filter((release): release is OrientationRelease => Boolean(release))
    .map(release => releaseWithReadModelScope(
      release,
      matchingReadModelScope(release, projectionScope, draftAugmentation.scope),
      input.scopeProjection,
    ))
    .map(release => normalizeReadModelReleaseState(release, selectedReleaseForReadModel?.id ?? null))
    .filter(release => releaseVisibleInReadModel(release, selectedReleaseForReadModel?.id ?? null, tasks, projectionScopeNodeIds))
  const rawScopeBase = projectionScopeForReadModel ?? releaseToScope(selectedReleaseForReadModel) ?? draftAugmentation.scope ?? normalizeScope(input, tasks)
  const rawScope = rawScopeBase ? mergeScopeRowsIntoScope(rawScopeBase, projectionScopeRows) : null
  const scopeWithDraftDeferred = rawScope && draftAugmentation.scope && projectionScopeRows.length === 0
    ? {
        ...rawScope,
        deferredNodeIds: [...new Set([
          ...(rawScope.deferredNodeIds ?? []),
          ...draftAugmentation.scope.deferredNodeIds.filter(nodeId => !(rawScope.nodeIds ?? []).includes(nodeId)),
        ])],
      }
    : rawScope
  const scope = scopeWithDraftDeferred ? normalizeScopeTaskLists(scopeWithDraftDeferred, tasks) : null
  const finalProjectionScope = input.scopeProjection ? scope : null
  const selectedReleaseWithFinalScope = selectedReleaseForReadModel
    ? releaseWithReadModelScope(selectedReleaseForReadModel, finalProjectionScope, input.scopeProjection)
    : selectedReleaseForReadModel
  const normalizedReleasesWithFinalScope = normalizedReleases.map(release =>
    releaseWithReadModelScope(
      release,
      release.id === selectedReleaseWithFinalScope?.id ? finalProjectionScope : null,
      input.scopeProjection,
    ),
  )
  const effectiveExecutionBoundary = selectedReleaseWithFinalScope?.proofStyle && selectedReleaseWithFinalScope.proofStyle !== 'unspecified'
    ? { ...executionBoundary, proofStyle: selectedReleaseWithFinalScope.proofStyle }
    : executionBoundary
  const proofBlockedTaskIds = releaseReadinessProofBlockedTaskIds(input.releaseReadiness?.blockers ?? [])
  const built = buildNodes(tasks, scope, now, effectiveExecutionBoundary.proofStyle, proofBlockedTaskIds)
  const roots = mergeWorkspaceImportContexts({
    roots: built.roots,
    byId: built.byId,
    contexts: draftAugmentation.contexts,
    scope,
    now,
  })
  const { byId, gaps: nodeGaps } = built
  const authoritativeReleaseBlockers = input.releaseReadiness?.blockers ?? null
  const projectionBlockers = input.scopeProjection && !authoritativeReleaseBlockers
    ? input.scopeProjection.release.blockers.map(blocker => ({
        id: blocker.id,
        label: blocker.label,
      }))
    : []
  const explicitReleaseBlockers: Array<{ id?: string; label?: string; title?: string; nextAction?: string }> = [
    ...projectionBlockers,
    ...(startReadiness?.canStart !== true ? authoritativeReleaseBlockers ?? [] : []),
  ]
  const startReleaseBlocker = startReadinessReleaseBlocker(startReadiness)
  const normalizedStartReleaseBlockerLabel = normalizeText(startReleaseBlocker?.label ?? '')
  const hasStartReleaseBlocker = startReleaseBlocker
    ? explicitReleaseBlockers.some((blocker) => {
        if (blocker.id === startReleaseBlocker.id) return true
        if (blocker.id?.startsWith('task-')) return false
        const blockerLabel = normalizeText(blocker.label ?? blocker.title ?? blocker.id ?? '')
        return blockerLabel.length > 0 && normalizedStartReleaseBlockerLabel.includes(blockerLabel)
      })
    : false
  const releaseBlockerInput = [
    ...explicitReleaseBlockers,
    ...(startReleaseBlocker && !hasStartReleaseBlocker ? [startReleaseBlocker] : []),
  ]
  const { blockers, gaps: blockerGaps } = attachReleaseBlockers(releaseBlockerInput, byId)
  const proofContracts = proofContractsForNodes(roots, effectiveExecutionBoundary)
  const duplicateGaps = duplicateScopeConflictGaps(tasks, scope)
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
    ...duplicateGaps,
    ...missingSourceProvenanceGaps(projectionScopeRows),
    ...sourceConflictGaps(input.sourceConflicts),
  ]
  const pins = activePins(roots)
  const readinessFocusPin = startReadinessFocusPin(startReadiness)
  const activePinsForSummary = readinessFocusPin
    ? startReadiness?.canStart === false
      ? [readinessFocusPin]
      : [
          readinessFocusPin,
          ...pins.filter(pin => pin.nodeId !== readinessFocusPin.nodeId),
        ].slice(0, 5)
    : pins
  const fallbackProgress = progressForSelectedScope(tasks, scope, effectiveExecutionBoundary.proofStyle, proofBlockedTaskIds)
  const progress = input.scopeProjection
    ? progressFromScopeProjection(input.scopeProjection, scope?.id ?? null, fallbackProgress)
    : fallbackProgress
  const releaseState: OrientationReleaseSummary['state'] = input.scopeProjection
    ? blockers.length > 0
      ? 'blocked'
      : input.scopeProjection.release.state
    : blockers.length > 0
      ? 'blocked'
      : scope
        ? 'shaping'
        : 'unknown'
  const effectiveSelectedRelease = selectedReleaseWithFinalScope && releaseState === 'blocked'
    ? { ...selectedReleaseWithFinalScope, state: 'blocked' as const }
    : selectedReleaseWithFinalScope
  const effectiveReleases = normalizedReleasesWithFinalScope.map(release =>
    effectiveSelectedRelease && release.id === effectiveSelectedRelease.id
      ? { ...release, state: effectiveSelectedRelease.state }
      : release,
  )
  const summary = summaryWithSourceConflicts(buildSummary({
    projectId: input.projectId,
    charter,
    selectedRelease: effectiveSelectedRelease,
    scope,
    progress,
    pins: activePinsForSummary,
    blockers,
    startReadiness,
    scopeProjection: input.scopeProjection,
    runStatus: input.runStatus,
  }), gaps)
  const sourceTrail = buildSourceTrail({
    charter,
    executionBoundary: effectiveExecutionBoundary,
    scope,
    selectedRelease: selectedReleaseWithFinalScope,
    summary,
    roots,
    nodesById: byId,
    taskCount: tasks.length,
  })
  return {
    projectId: input.projectId,
    updatedAt: now,
    selectedRelease: effectiveSelectedRelease,
    releases: effectiveReleases,
    selectedTaskScope: scope,
    scope,
    charter,
    executionBoundary,
    proofContracts,
    summary,
    roots,
    nodes: Object.fromEntries(byId.entries()),
    activePins: activePinsForSummary,
    scopeRows: projectionScopeRows,
    scopeRowCounts: {
      included: projectionScopeRows.filter(row => row.scope === 'included').length,
      deferred: projectionScopeRows.filter(row => row.scope === 'deferred').length,
    },
    gaps,
    release: {
      state: releaseState,
      blockers,
    },
    sourceHealth: sourceHealth(roots, gaps),
    sourceTrail,
  }
}

function selectedReleaseIdForOrientation(
  input: BuildProjectOrientationSpineInput,
  draftSelectedReleaseId: string | null,
  releases: BuildProjectOrientationSpineInput['releases'],
): string | null {
  const explicit = input.selectedReleaseId?.trim() || null
  if (!explicit) return draftSelectedReleaseId
  if (!draftSelectedReleaseId || draftSelectedReleaseId === explicit) return explicit
  if (input.workspaceImportDraft?.source.freshness === 'stale') return explicit

  const explicitRelease = releases?.find(release => release.id === explicit)
  const draftRelease = releases?.find(release => release.id === draftSelectedReleaseId)
  if (explicitRelease?.source === 'inferred' && draftRelease && input.workspaceImportDraft?.source.freshness === 'fresh') {
    return draftSelectedReleaseId
  }
  if (explicitRelease?.source === 'inferred' && draftRelease?.source && draftRelease.source !== 'inferred') {
    return draftSelectedReleaseId
  }
  return explicit
}

function normalizeReadModelReleaseState(release: OrientationRelease, selectedReleaseId: string | null): OrientationRelease {
  if (release.id === selectedReleaseId) {
    return release.state === 'shipped' || release.state === 'ready' ? release : { ...release, state: 'active' }
  }
  if (release.state === 'active') return { ...release, state: 'planned' }
  return release
}

function releaseStateFromScopeProjection(
  release: OrientationRelease,
  projection: ProjectScopeProjection | null | undefined,
): OrientationReleaseState {
  if (!projection || projection.selectedScope?.id !== release.id) return release.state
  if (release.state === 'shipped') return 'shipped'
  if (projection.release.state === 'ready') return 'ready'
  if (release.state === 'ready') return 'active'
  return release.state
}

function matchingReadModelScope(
  release: OrientationRelease,
  projectionScope: OrientationScope | null,
  draftScope: OrientationScope | null | undefined,
): OrientationScope | null {
  if (projectionScope?.id === release.id) return projectionScope
  if (draftScope?.id === release.id) return draftScope
  return null
}

function releaseWithReadModelScope(
  release: OrientationRelease,
  scope: OrientationScope | null,
  projection: ProjectScopeProjection | null | undefined,
): OrientationRelease {
  if (!scope || scope.id !== release.id) return release
  return {
    ...release,
    state: releaseStateFromScopeProjection(release, projection),
    nodeIds: [...scope.nodeIds],
    deferredNodeIds: [...scope.deferredNodeIds],
  }
}

function releaseVisibleInReadModel(
  release: OrientationRelease,
  selectedReleaseId: string | null,
  tasks: readonly OrientationTaskInput[],
  projectionScopeNodeIds: ReadonlySet<string> = new Set(),
): boolean {
  if (release.id === selectedReleaseId) return true
  if (
    projectionScopeNodeIds.size > 0 &&
    ![...release.nodeIds, ...release.deferredNodeIds].some(nodeId => projectionScopeNodeIds.has(nodeId))
  ) return false
  if (release.deferredNodeIds.length > 0) return true
  const taskByNodeId = new Map(tasks.map(task => [taskNodeId(task.id), task]))
  if (release.nodeIds.length === 0) return false
  if (release.source !== 'inferred') return true
  return !release.nodeIds.every(nodeId => {
    const task = taskByNodeId.get(nodeId)
    return task ? taskStatusIsTerminal(task.status) : false
  })
}

function taskStatusIsTerminal(status: string | undefined): boolean {
  return status === 'done' || status === 'archived' || status === 'cancelled' || status === 'shelved'
}

function filterDuplicateSelectedStageReleases<T extends Partial<OrientationRelease>>(
  releases: readonly T[],
  selectedReleaseId: string | null,
): T[] {
  if (!selectedReleaseId) return [...releases]
  const selected = releases.find(release => release.id === selectedReleaseId)
  const selectedStage = parseReleaseStageNumber(selected?.label)
  if (selectedStage == null) return [...releases]
  const sameStage = releases.filter(release => parseReleaseStageNumber(release.label) === selectedStage)
  if (sameStage.length < 2) return [...releases]
  return releases.filter(release =>
    release.id === selectedReleaseId ||
    parseReleaseStageNumber(release.label) !== selectedStage,
  )
}

function parseReleaseStageNumber(label: string | null | undefined): number | null {
  if (!label) return null
  const match = /^stage\s+(\d+)(?:\b|\s*[:(].*)/i.exec(label.trim())
  if (!match?.[1]) return null
  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) ? value : null
}

function nodeIdIsWorkspaceImportPreview(nodeId: string): boolean {
  return nodeId.startsWith('work:workspace-import:')
}

function releaseHasMaterializedMembership(release: Partial<OrientationRelease>): boolean {
  return [...(release.nodeIds ?? []), ...(release.deferredNodeIds ?? [])]
    .some(nodeId => !nodeIdIsWorkspaceImportPreview(nodeId))
}

function releaseSourceRank(source: Partial<OrientationRelease>['source']): number {
  switch (source) {
    case 'owner_approved': return 4
    case 'spec': return 3
    case 'release_plan': return 2
    case 'inferred': return 1
    default: return 0
  }
}

function betterReleaseMetadata(
  existing: Partial<OrientationRelease>,
  incoming: Partial<OrientationRelease>,
): Partial<OrientationRelease> {
  return releaseSourceRank(incoming.source) > releaseSourceRank(existing.source) ? incoming : existing
}

function mergeOrientationReleaseInputs(
  primary: BuildProjectOrientationSpineInput['releases'],
  secondary: Array<Partial<OrientationRelease>>,
): BuildProjectOrientationSpineInput['releases'] {
  const merged: NonNullable<BuildProjectOrientationSpineInput['releases']> = []
  const byId = new Map<string, Partial<OrientationRelease>>()
  for (const release of [...(primary ?? []), ...secondary]) {
    const id = release.id?.trim()
    if (!id) continue
    const existing = byId.get(id)
    if (!existing) {
      byId.set(id, release)
      merged.push(release)
      continue
    }
    const keepExistingMembership = releaseHasMaterializedMembership(existing)
    const metadata = betterReleaseMetadata(existing, release)
    const combined: Partial<OrientationRelease> = {
      ...release,
      ...existing,
      label: metadata.label ?? existing.label ?? release.label,
      kind: metadata.kind ?? existing.kind ?? release.kind,
      source: metadata.source ?? existing.source ?? release.source,
      state: existing.state ?? release.state,
      nodeIds: keepExistingMembership
        ? [...(existing.nodeIds ?? [])]
        : [...new Set([...(existing.nodeIds ?? []), ...(release.nodeIds ?? [])])],
      deferredNodeIds: keepExistingMembership
        ? [...(existing.deferredNodeIds ?? [])]
        : [...new Set([...(existing.deferredNodeIds ?? []), ...(release.deferredNodeIds ?? [])])],
      description: metadata.description ?? existing.description ?? release.description ?? null,
      proofStyle: metadata.proofStyle ?? existing.proofStyle ?? release.proofStyle,
    }
    byId.set(id, combined)
    const index = merged.findIndex(item => item.id === id)
    if (index >= 0) merged[index] = combined
  }
  return merged
}
