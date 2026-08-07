import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import fs from 'node:fs/promises'
import path from 'node:path'
import { AcceptanceCriteria, explicitTaskStructuralIdentity, type ProjectRelease, type Task } from '@guildhall/core'
import {
  clearTaskRuntimeState,
  clearTaskWorkspaceState,
  getProjectSystemStatePathFromMemoryDir,
  inferProjectRootFromMemoryDir,
  type ProjectStateDatabaseSourceCapability,
} from '@guildhall/sessions'
import {
  planEvidenceWorkGraph,
  type EvidenceSource,
  type EvidenceTask,
} from './evidence-work-graph-intake.js'
import {
  evidenceTaskDescription,
  evidenceTaskPriority,
  evidenceTaskWhyThisMayMatter,
} from './evidence-task-import-draft.js'
import {
  buildImportedBlueprintSeed,
  type MaterializedImportTask,
} from './workspace-importer.js'
import {
  contractShapedImportHasNoConcreteContracts,
  importedContractStructuralRepairReadiness,
  importedContractWorkIsStructurallyIncomplete,
} from './imported-work-integrity.js'
import { taskDoneButProofMissingForScope } from './proof-health.js'
import { readProjectTaskQueueForMutationSync, writeProjectTaskQueueAtCurrentStateBoundary } from './project-state-boundary.js'

export type ProjectReintakeSource = EvidenceSource

export interface ProjectReintakeInput {
  now?: string
  projectPath?: string
  sources: ProjectReintakeSource[]
  /**
   * When supplied by the live product route, this catalog is the only source
   * allowed to create/reframe executable work. The prose `sources` remain
   * visible audit evidence and are never parsed into task authority.
   */
  sourceCapabilities?: readonly ProjectStateDatabaseSourceCapability[]
  tasks: Array<Record<string, unknown>>
  /** Raw authoritative task definitions used only to guard draft application. */
  taskQueueFingerprintTasks?: Array<Record<string, unknown>>
  releases?: Array<Pick<ProjectRelease, 'id' | 'label' | 'state' | 'nodeIds' | 'deferredNodeIds' | 'supersedesReleaseId'> & Pick<Partial<ProjectRelease>, 'proofStyle'>>
}

export interface ProjectReintakeDraft {
  id: string
  createdAt: string
  createdBy: 'project-reintake'
  status: 'draft' | 'applied' | 'dismissed'
  taskQueueFingerprint: string
  selectedReleaseId?: string
  intakeStatus?: 'needs_structured_capability_intake' | 'catalog_ready'
  releases?: ProjectReintakeReleaseDraft[]
  sources: Array<{ path: string; kind: string }>
  summary: {
    kept: number
    reframed: number
    merged: number
    archived: number
    created: number
    preservedDone: number
    refreshedEvidence: number
    repairedDependencies: number
  }
  groups: ReintakeChangeGroup[]
}

export interface ReintakeChangeGroup {
  id: string
  title: string
  rationale: string
  changes: ReintakeChange[]
}

export type ReintakeChange =
  | { kind: 'keep'; taskId: string; reason: string }
  | { kind: 'reframe'; taskId: string; before: TaskSummary; after: ReintakeTaskDraft; reopenForProof?: boolean; reason: string }
  | ReintakeMergeChange
  | { kind: 'archive'; taskId: string; reason: string; archiveCode?: 'unsupported_weak_preimplementation' | string }
  | { kind: 'create'; task: ReintakeTaskDraft; reason: string }
  | { kind: 'refresh_evidence'; taskId: string; before: TaskSummary; after: ReintakeTaskDraft; reopenForProof: boolean; reason: string }
  | { kind: 'repair_dependencies'; taskId: string; beforeDependsOn: string[]; afterDependsOn: string[]; reason: string }
  | { kind: 'preserve_progress'; taskId: string; reason: string }

type ReintakeMergeChange = { kind: 'merge'; survivorTaskId: string; mergedTaskIds: string[]; reason: string }
type EvidenceReconciliation = { existingTaskId: string; action: 'reframed_existing_task'; reason: string }

export interface TaskSummary {
  id: string
  title: string
  status: string
}

export interface ReintakeTaskDraft {
  id: string
  title: string
  description: string
  sourceIdentity?: string
  deliverableName?: string
  producedArtifact?: string
  workShape?: Task['workShape']
  targetArea?: string
  buildsOn?: string[]
  consumerSurfaces?: string[]
  domain: string
  projectPath?: string
  status: 'import_draft' | 'spec_review' | 'shelved'
  priority: 'critical' | 'high' | 'normal' | 'low'
  dependsOn: string[]
  acceptanceCriteria: Task['acceptanceCriteria']
  references?: string[]
  sourceClaims?: Task['sourceClaims']
  capabilityBindings?: Task['capabilityBindings']
  releaseIds?: string[]
  stageAlignment?: string
  spec?: string
  structuredSpec?: Task['structuredSpec']
  productBrief?: Task['productBrief']
  proofPaths?: Task['proofPaths']
  workUnitAnalysis?: Task['workUnitAnalysis']
  semanticKind?: Task['semanticKind']
  taskReadiness?: Task['taskReadiness']
  taskKind?: Task['taskKind']
  definitionOfDone?: Task['definitionOfDone']
  blockerPlans?: Task['blockerPlans']
  contextBudget?: Task['contextBudget']
  parentAcceptanceCriterionIds?: string[]
  contractNames?: string[]
}

export interface ProjectReintakeReleaseDraft {
  id: string
  label: string
  kind: 'release'
  state: 'active'
  source: 'release_plan' | 'inferred'
  nodeIds: string[]
  deferredNodeIds: string[]
  proofStyle?: 'script_only' | 'manual' | 'mixed' | 'unspecified'
  supersedesReleaseId?: string
}

export interface ProjectReintakeApplyResult {
  success: boolean
  appliedGroups?: number
  error?: string
}

export function planProjectReintake(input: ProjectReintakeInput): ProjectReintakeDraft {
  const now = input.now ?? new Date().toISOString()
  if (input.sourceCapabilities !== undefined) {
    return planCatalogBackedProjectReintake(input, now)
  }
  const groups: ReintakeChangeGroup[] = []
  const usedTaskIds = new Set<string>()
  const selectedRelease = selectReintakeRelease(detectSelectedRelease(input.sources), input)
  const protectedProgressTaskIds = new Set(input.tasks
    .filter(task => isStartedOrCompletedTask(task) && !importedContractWorkIsStructurallyIncomplete(task))
    // A completion claim without the selected release's current proof is a
    // repair candidate, not immutable historical progress.
    .filter(task => stringField(task, 'status') !== 'done' || !taskNeedsCurrentScopeProof(task, selectedRelease))
    .map(task => stringField(task, 'id'))
    .filter((id): id is string => Boolean(id)))

  const duplicateMerges = duplicateMergeChanges(input.tasks)
  if (duplicateMerges.length > 0) {
    groups.push({
      id: 'merge-duplicates',
      title: 'Merge duplicate old cards',
      rationale: 'These blocked tasks share an explicit source-owned identity and can be represented by one survivor.',
      changes: duplicateMerges,
    })
    for (const change of duplicateMerges) {
      usedTaskIds.add(change.survivorTaskId)
      for (const id of change.mergedTaskIds) usedTaskIds.add(id)
    }
  }

  let graphPlan = planEvidenceWorkGraph({
    sources: input.sources,
    existingTasks: input.tasks,
    refreshStructuredExisting: true,
  })
  graphPlan = dedupeTasksCoveredBySelectedReleaseScope(graphPlan, selectedRelease)
  const completedTaskIds = new Set(input.tasks
    .filter(task => stringField(task, 'status') === 'done' && !taskNeedsCurrentScopeProof(task, selectedRelease))
    .map(task => stringField(task, 'id'))
    .filter((id): id is string => Boolean(id)))
  const graphTaskIds = new Set(graphPlan.tasks.map(task => task.id))
  const nonBlockingDependencyIds = new Set(input.tasks
    .filter(task => ['archived', 'shelved'].includes(stringField(task, 'status') ?? ''))
    .map(task => stringField(task, 'id'))
    .filter((id): id is string => Boolean(id)))
  const allowedDependencyIds = new Set([...graphTaskIds, ...protectedProgressTaskIds]
    .filter(id => !nonBlockingDependencyIds.has(id)))
  const graphChanges = graphPlan.tasks
    // A historical done flag without current proof is not preserved progress.
    // Reconcile the same source-owned task so the selected release has one
    // authoritative record instead of a duplicate replacement tree.
    .filter(task => !completedTaskIds.has(task.id))
    .filter(task => !protectedProgressTaskIds.has(task.id))
    .map(task => graphTaskChange(
      {
        ...task,
        dependsOn: task.dependsOn.filter(dependency =>
          dependency !== task.id &&
          !completedTaskIds.has(dependency) &&
          allowedDependencyIds.has(dependency),
        ),
      },
      graphPlan.reconciliations,
      input.tasks,
      selectedRelease,
      input.sources,
      input.projectPath,
      now,
    ))
  if (graphChanges.length > 0) {
    groups.push({
      id: 'evidence-work-graph',
      title: 'Rebuild task graph from current evidence',
      rationale: 'Structured project evidence describes deliverables, integrations, dependencies, and proof contracts.',
      changes: graphChanges,
    })
    for (const change of graphChanges) {
      const taskId = taskIdForChange(change)
      if (taskId) usedTaskIds.add(taskId)
    }
  }

  const planningInstructionChanges = archivePlanningInstructionTasks(input.tasks, usedTaskIds)
  if (planningInstructionChanges.length > 0) {
    groups.push({
      id: 'archive-planning-instructions',
      title: 'Archive planning instructions from executable work',
      rationale: 'A coordinator instruction is retained as history, but it is not a product deliverable and cannot satisfy a release row by repeating its vocabulary.',
      changes: planningInstructionChanges,
    })
    for (const change of planningInstructionChanges) usedTaskIds.add(change.taskId)
  }

  const releaseMembershipChanges = migrateSameStageReleaseMemberships(
    input.tasks,
    usedTaskIds,
    selectedRelease,
  )
  if (releaseMembershipChanges.length > 0) {
    groups.push({
      id: 'migrate-current-release-membership',
      title: 'Move current-stage work into the selected release',
      rationale: 'Renaming or refining a release boundary must move its open work into the new boundary instead of discarding the work as stale.',
      changes: releaseMembershipChanges,
    })
    for (const change of releaseMembershipChanges) {
      const taskId = taskIdForChange(change)
      if (taskId) usedTaskIds.add(taskId)
    }
  }

  const evidenceRefreshChanges = refreshCurrentEvidenceChanges(
    graphPlan.tasks,
    input.tasks,
    selectedRelease,
    input.sources,
    input.projectPath,
    now,
  )
  if (evidenceRefreshChanges.length > 0) {
    groups.push({
      id: 'refresh-current-evidence',
      title: 'Refresh source-backed proof plans',
      rationale: 'Current source documents now name concrete proof paths. Refresh the plan without discarding recorded work, and reopen only completion claims that still lack observed proof.',
      changes: evidenceRefreshChanges,
    })
    for (const change of evidenceRefreshChanges) {
      const taskId = taskIdForChange(change)
      if (taskId) usedTaskIds.add(taskId)
    }
  }

  const structuralRepairChanges = repairStructurallyIncompleteImportedContractWork(
    input.tasks,
    usedTaskIds,
    selectedRelease,
    input.projectPath,
    now,
  )
  if (structuralRepairChanges.length > 0) {
    groups.push({
      id: 'repair-structurally-incomplete-imports',
      title: 'Repair structurally incomplete imported work',
      rationale: 'Imported contract/type work with hollow proof targets must be reshaped before Guildhall can schedule it.',
      changes: structuralRepairChanges,
    })
    for (const change of structuralRepairChanges) {
      const taskId = taskIdForChange(change)
      if (taskId) usedTaskIds.add(taskId)
    }
  }

  const conflictingReleaseMembershipChanges = repairConflictingSelectedReleaseMemberships(
    input.tasks,
    usedTaskIds,
    selectedRelease,
    now,
  )
  if (conflictingReleaseMembershipChanges.length > 0) {
    groups.push({
      id: 'repair-conflicting-release-membership',
      title: 'Repair conflicting release membership',
      rationale: 'One imported task should not silently belong to two differently named release boundaries.',
      changes: conflictingReleaseMembershipChanges,
    })
    for (const change of conflictingReleaseMembershipChanges) {
      const taskId = taskIdForChange(change)
      if (taskId) usedTaskIds.add(taskId)
    }
  }

  const restoreSelectedReleaseArchiveChanges = restoreSelectedReleaseImportsArchivedByReintake(
    input.tasks,
    usedTaskIds,
    selectedRelease,
    input.projectPath,
  )
  if (restoreSelectedReleaseArchiveChanges.length > 0) {
    groups.push({
      id: 'restore-selected-release-imports',
      title: 'Restore selected release imports',
      rationale: 'Source-backed selected-release drafts should stay in the current scope for shaping instead of being archived as stale weak specs.',
      changes: restoreSelectedReleaseArchiveChanges,
    })
    for (const change of restoreSelectedReleaseArchiveChanges) {
      const taskId = taskIdForChange(change)
      if (taskId) usedTaskIds.add(taskId)
    }
  }

  const progressChanges = preserveProgressChanges(input.tasks, usedTaskIds)
  if (progressChanges.length > 0) {
    groups.push({
      id: 'preserve-progress',
      title: 'Preserve completed work',
      rationale: 'Completed work remains evidence and should not be recreated.',
      changes: progressChanges,
    })
  }
  const dependencyRepairChanges = repairNonBlockingDependencies(input.tasks, graphPlan.tasks)
  if (dependencyRepairChanges.length > 0) {
    groups.push({
      id: 'repair-non-blocking-dependencies',
      title: 'Remove historical dependency blockers',
      rationale: 'Archived and shelved work remains visible history or deferred scope, but cannot block current work.',
      changes: dependencyRepairChanges,
    })
  }

  const archiveChanges = archiveUnsupportedBlockedTasks(input.tasks, usedTaskIds)
  if (archiveChanges.length > 0) {
    groups.push({
      id: 'archive-unsupported',
      title: 'Archive unsupported blocked cards',
      rationale: 'These blocked cards have no current source evidence and no durable proof.',
      changes: archiveChanges,
    })
  }

  const staleWeakSpecChanges = archiveUnsupportedWeakPreImplementationTasks(input.tasks, usedTaskIds, selectedRelease)
  if (staleWeakSpecChanges.length > 0) {
    groups.push({
      id: 'archive-stale-preimplementation',
      title: 'Archive stale pre-implementation tasks',
      rationale: 'Not-started tasks with weak legacy specs should not override current evidence when no current source support remains.',
      changes: staleWeakSpecChanges,
    })
  }

  const releases = selectedRelease ? releaseDraftsFor(selectedRelease, groups, input.tasks) : []
  return {
    id: `reintake-${now.replace(/[^0-9A-Za-z]/g, '').slice(0, 14)}`,
    createdAt: now,
    createdBy: 'project-reintake',
    status: 'draft',
    taskQueueFingerprint: fingerprint(input.taskQueueFingerprintTasks ?? input.tasks),
    ...(selectedRelease && releases.length > 0 ? { selectedReleaseId: selectedRelease.id, releases } : {}),
    sources: input.sources.map(source => ({ path: source.path, kind: 'source' })),
    summary: summarize(groups),
    groups,
  }
}

/**
 * The live re-intake path does not derive work from Markdown/table prose.
 * Catalog capability IDs are already source-owned structured facts; this
 * produces only bounded planning cards, never an execution-ready spec.
 */
function planCatalogBackedProjectReintake(
  input: ProjectReintakeInput,
  now: string,
): ProjectReintakeDraft {
  const selectedRelease = selectReintakeRelease(null, input)
  const capabilities = input.sourceCapabilities ?? []
  const existingBindings = new Set(input.tasks.flatMap(task => (
    Array.isArray(task.capabilityBindings)
      ? task.capabilityBindings.flatMap(binding => (
        binding !== null && typeof binding === 'object' && !Array.isArray(binding) &&
        typeof (binding as { capabilityId?: unknown }).capabilityId === 'string'
          ? [(binding as { capabilityId: string }).capabilityId]
          : []
      ))
      : []
  )))
  const changes: ReintakeChange[] = capabilities
    .filter(capability => capability.state === 'planned')
    .filter(capability => !existingBindings.has(capability.id))
    .map(capability => ({
      kind: 'create' as const,
      reason: `Structured source capability ${capability.id} is not yet allocated to project work.`,
      task: {
        id: capabilityTaskId(capability.id),
        title: capability.label,
        description: `Plan the work needed to satisfy the structured capability ${capability.id}.`,
        sourceIdentity: capability.id,
        deliverableName: capability.id,
        domain: capability.adapterId,
        status: 'import_draft' as const,
        priority: 'high' as const,
        dependsOn: [],
        acceptanceCriteria: [],
        references: [...capability.evidenceRefs],
        capabilityBindings: [{ capabilityId: capability.id, relation: 'plans' }],
        ...(capability.releaseIds.length > 0 ? { releaseIds: [...capability.releaseIds] } : {}),
      },
    }))
  const groups: ReintakeChangeGroup[] = changes.length > 0 ? [{
    id: 'structured-capability-catalog',
    title: 'Allocate structured source capabilities',
    rationale: 'Each card comes from one typed source capability. It is intake work, not a generated implementation plan.',
    changes,
  }] : []
  const releases = selectedRelease ? releaseDraftsFor(selectedRelease, groups, input.tasks) : []
  return {
    id: `reintake-${now.replace(/[^0-9A-Za-z]/g, '').slice(0, 14)}`,
    createdAt: now,
    createdBy: 'project-reintake',
    status: 'draft',
    taskQueueFingerprint: fingerprint(input.taskQueueFingerprintTasks ?? input.tasks),
    ...(selectedRelease && releases.length > 0 ? { selectedReleaseId: selectedRelease.id, releases } : {}),
    intakeStatus: capabilities.length === 0 ? 'needs_structured_capability_intake' : 'catalog_ready',
    sources: input.sources.map(source => ({ path: source.path, kind: 'evidence' })),
    summary: summarize(groups),
    groups,
  }
}

function capabilityTaskId(capabilityId: string): string {
  return `task-capability-${slugify(capabilityId).slice(0, 72)}`
}

export async function writeProjectReintakeDraft(memoryDir: string, draft: ProjectReintakeDraft): Promise<string> {
  const filePath = reintakeDraftPath(memoryDir)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await writeManagedTextFile(filePath, JSON.stringify(draft, null, 2), 'utf-8')
  return filePath
}

export async function readProjectReintakeDraft(memoryDir: string): Promise<ProjectReintakeDraft | null> {
  try {
    return JSON.parse(await readManagedTextFile(reintakeDraftPath(memoryDir), 'utf-8')) as ProjectReintakeDraft
  } catch {
    return null
  }
}

export async function applyProjectReintakeDraft(input: {
  memoryDir: string
  selectedGroupIds?: string[]
  now?: string
}): Promise<ProjectReintakeApplyResult> {
  const now = input.now ?? new Date().toISOString()
  const draft = await readProjectReintakeDraft(input.memoryDir)
  if (!draft) return { success: false, error: 'No re-intake draft found.' }

  const queuePath = getProjectSystemStatePathFromMemoryDir(input.memoryDir, 'TASKS.json')
  const queueRead = readQueueFile(queuePath)
  const queue = queueRead.queue
  if (fingerprint(queue.tasks) !== draft.taskQueueFingerprint) {
    return {
      success: false,
      error: 'TASKS.json changed since the re-intake draft was created. Refresh the draft before applying.',
    }
  }

  const selected = input.selectedGroupIds
    ? new Set(input.selectedGroupIds)
    : null
  const groups = selected
    ? draft.groups.filter(group => selected.has(group.id))
    : draft.groups
  const shippedReleaseIdsByTask = shippedReleaseMembership(queue.releases)
  const refreshedTaskIds = new Set<string>()
  for (const change of groups.flatMap(group => group.changes)) {
    if (change.kind === 'create') refreshedTaskIds.add(change.task.id)
    if (change.kind === 'reframe') refreshedTaskIds.add(change.taskId)
    if (change.kind === 'refresh_evidence') refreshedTaskIds.add(change.taskId)
  }

  for (const group of groups) {
    for (const change of group.changes) {
      if (change.kind === 'archive' && refreshedTaskIds.has(change.taskId)) continue
      applyChange(queue.tasks, change, now, shippedReleaseIdsByTask)
    }
  }
  applyReleaseDrafts(queue, draft)

  queue.lastUpdated = now
  await writeProjectTaskQueueAtCurrentStateBoundary(queuePath, queue, {
    projectId: path.basename(inferProjectRootFromMemoryDir(input.memoryDir)),
    projectRoot: inferProjectRootFromMemoryDir(input.memoryDir),
    expectedQueueRevision: queueRead.expectedQueueRevision,
  })
  // A re-intake reframe changes the authoritative planning state. Runtime and
  // worktree overlays from an old execution must not re-promote a stale done
  // status over the newly reopened task.
  const projectRoot = inferProjectRootFromMemoryDir(input.memoryDir)
  await Promise.all([...refreshedTaskIds].flatMap(taskId => [
    clearTaskRuntimeState(projectRoot, taskId),
    clearTaskWorkspaceState(projectRoot, taskId),
  ]))
  await appendReintakeProgress(input.memoryDir, draft, groups.length, now)
  await writeProjectReintakeDraft(input.memoryDir, { ...draft, status: 'applied' })
  return { success: true, appliedGroups: groups.length }
}

function applyChange(
  tasks: Array<Record<string, unknown>>,
  change: ReintakeChange,
  now: string,
  shippedReleaseIdsByTask: ReadonlyMap<string, readonly string[]> = new Map(),
): void {
  if (change.kind === 'repair_dependencies') {
    const existing = tasks.find(task => task.id === change.taskId)
    if (!existing) return
    const notes = Array.isArray(existing.notes) ? existing.notes : []
    Object.assign(existing, {
      dependsOn: change.afterDependsOn,
      updatedAt: now,
      notes: [
        ...notes,
        {
          agentId: 'project-reintake',
          role: 'system',
          content: `Re-intake removed archived or shelved prerequisites: ${change.reason}`,
          timestamp: now,
        },
      ],
    })
    return
  }
  if (change.kind === 'refresh_evidence') {
    const existing = tasks.find(task => task.id === change.taskId)
    if (!existing) return
    const notes = Array.isArray(existing.notes) ? existing.notes : []
    clearStaleReintakeDerivedFields(existing)
    Object.assign(existing, {
      ...withHistoricalReleaseMembership(change.after, shippedReleaseIdsByTask.get(change.taskId)),
      id: change.taskId,
      // Keep active work active. A completed task with no current proof is
      // intentionally reopened; its historical notes/evidence
      // remain attached to the same task record.
      status: change.reopenForProof ? change.after.status : (stringField(existing, 'status') ?? change.after.status),
      updatedAt: now,
      notes: [
        ...notes,
        {
          agentId: 'project-reintake',
          role: 'system',
          content: change.reopenForProof
            ? `Re-intake refreshed the source-backed proof plan and reopened this task because ${change.reason}`
            : `Re-intake refreshed the source-backed proof plan because ${change.reason}`,
          timestamp: now,
        },
      ],
    })
    return
  }

  if (change.kind === 'reframe') {
    const existing = tasks.find(task => task.id === change.taskId)
    if (!existing) return
    const notes = Array.isArray(existing.notes) ? existing.notes : []
    clearStaleReintakeDerivedFields(existing)
    Object.assign(existing, {
      ...withHistoricalReleaseMembership(change.after, shippedReleaseIdsByTask.get(change.taskId)),
      id: change.taskId,
      // Reframe is only planned for non-running work. Its regenerated source
      // contract owns the planning status so stale `done`, `blocked`, or
      // `spec_review` labels cannot outvote the new intake boundary.
      status: change.after.status,
      updatedAt: now,
      notes: [
        ...notes,
        {
          agentId: 'project-reintake',
          role: 'system',
          content: `Re-intake reframed this task from "${change.before.title}" because ${change.reason}`,
          timestamp: now,
        },
      ],
    })
    archiveOpenPreImplementationDescendantsForParent(tasks, change.taskId, now)
    return
  }

  if (change.kind === 'create') {
    const existing = tasks.find(task => task.id === change.task.id)
    if (existing) {
      if (isStartedOrCompletedTask(existing)) return
      const notes = Array.isArray(existing.notes) ? existing.notes : []
      clearStaleReintakeDerivedFields(existing)
      Object.assign(existing, {
        ...withHistoricalReleaseMembership(change.task, shippedReleaseIdsByTask.get(change.task.id)),
        projectPath: change.task.projectPath ?? (typeof existing.projectPath === 'string' ? existing.projectPath : ''),
        outOfScope: Array.isArray(existing.outOfScope) ? existing.outOfScope : [],
        notes: [
          ...notes,
          {
            agentId: 'project-reintake',
            role: 'system',
            content: `Re-intake replaced this not-yet-started task with current source evidence: ${change.reason}`,
            timestamp: now,
          },
        ],
        gateResults: Array.isArray(existing.gateResults) ? existing.gateResults : [],
        reviewVerdicts: Array.isArray(existing.reviewVerdicts) ? existing.reviewVerdicts : [],
        adjudications: Array.isArray(existing.adjudications) ? existing.adjudications : [],
        escalations: Array.isArray(existing.escalations) ? existing.escalations : [],
        agentIssues: Array.isArray(existing.agentIssues) ? existing.agentIssues : [],
        revisionCount: typeof existing.revisionCount === 'number' ? existing.revisionCount : 0,
        remediationAttempts: typeof existing.remediationAttempts === 'number' ? existing.remediationAttempts : 0,
        origination: existing.origination ?? 'human',
        createdAt: typeof existing.createdAt === 'string' ? existing.createdAt : now,
        updatedAt: now,
      })
      archiveOpenPreImplementationDescendantsForParent(tasks, change.task.id, now)
      return
    }
    tasks.push({
      ...change.task,
      projectPath: change.task.projectPath ?? '',
      outOfScope: [],
      notes: [{
        agentId: 'project-reintake',
        role: 'system',
        content: `Created by project re-intake: ${change.reason}`,
        timestamp: now,
      }],
      gateResults: [],
      reviewVerdicts: [],
      adjudications: [],
      escalations: [],
      agentIssues: [],
      revisionCount: 0,
      remediationAttempts: 0,
      origination: 'human',
      createdAt: now,
      updatedAt: now,
    })
    return
  }

  if (change.kind === 'archive') {
    const existing = tasks.find(task => task.id === change.taskId)
    if (!existing) return
    const notes = Array.isArray(existing.notes) ? existing.notes : []
    detachTaskFromLiveGraph(tasks, change.taskId)
    Object.assign(existing, {
      status: 'archived',
      dependsOn: [],
      updatedAt: now,
      archivedEvidence: {
        retention: 'archive',
        archivedAt: now,
        reason: change.reason,
        source: 'project-reintake',
        ...(change.archiveCode ? { code: change.archiveCode } : {}),
      },
      notes: [
        ...notes,
        {
          agentId: 'project-reintake',
          role: 'system',
          content: `Re-intake archived this task without deleting it because ${change.reason}`,
          timestamp: now,
        },
      ],
    })
    return
  }

  if (change.kind === 'merge') {
    for (const mergedTaskId of change.mergedTaskIds) {
      applyChange(tasks, { kind: 'archive', taskId: mergedTaskId, reason: `Superseded by ${change.survivorTaskId}. ${change.reason}` }, now, shippedReleaseIdsByTask)
    }
  }
}

function clearStaleReintakeDerivedFields(task: Record<string, unknown>): void {
  for (const key of [
    'archivedEvidence',
    'blockerPlans',
    'contextBudget',
    'decomposition',
    'definitionOfDone',
    'deliverySteps',
    'hierarchy',
    'productBrief',
    'requestIntake',
    'sizePlan',
    'structuredSpec',
    'taskKind',
    'taskReadiness',
    'workUnitAnalysis',
    'acceptanceCriteriaProofState',
  ]) {
    delete task[key]
  }
}

function withHistoricalReleaseMembership<T extends { releaseIds?: string[] }>(
  task: T,
  shippedReleaseIds: readonly string[] | undefined,
): T {
  if (!shippedReleaseIds?.length) return task
  return {
    ...task,
    releaseIds: unique([...(task.releaseIds ?? []), ...shippedReleaseIds]),
  }
}

function shippedReleaseMembership(
  releases: Array<Record<string, unknown>> | undefined,
): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, string[]>()
  for (const release of releases ?? []) {
    if (release.state !== 'shipped') continue
    const memberIds = [
      ...arrayStringField(release.nodeIds).map(nodeId => nodeId.replace(/^work:/, '')),
      ...arrayStringField(release.deferredNodeIds).map(nodeId => nodeId.replace(/^work:/, '')),
    ]
    for (const taskId of memberIds) {
      const existing = result.get(taskId) ?? []
      if (!existing.includes(String(release.id))) existing.push(String(release.id))
      result.set(taskId, existing)
    }
  }
  return result
}

function detachTaskFromLiveGraph(tasks: Array<Record<string, unknown>>, taskId: string): void {
  for (const task of tasks) {
    const hierarchy = hierarchyRecord(task)
    if (!hierarchy) continue
    if (Array.isArray(hierarchy.childIds)) {
      hierarchy.childIds = hierarchy.childIds.filter(childId => childId !== taskId)
    }
  }
  const task = tasks.find(candidate => candidate.id === taskId)
  if (task) delete task.hierarchy
}

function archiveOpenPreImplementationDescendantsForParent(
  tasks: Array<Record<string, unknown>>,
  parentId: string,
  now: string,
): void {
  for (const task of tasks) {
    const hierarchy = hierarchyRecord(task)
    if (hierarchy?.parentId !== parentId) continue
    if (task.status === 'archived') {
      delete task.hierarchy
      continue
    }
    if (!isOpenPreImplementationTask(task)) continue
    const taskId = stringField(task, 'id')
    if (!taskId) continue
    applyChange(tasks, {
      kind: 'archive',
      taskId,
      reason: `Parent ${parentId} was refreshed from source-backed re-intake; stale generated child work should not remain as separate current-scope work.`,
    }, now)
  }
}

function hierarchyRecord(task: Record<string, unknown>): Record<string, unknown> | null {
  const hierarchy = task.hierarchy
  return hierarchy && typeof hierarchy === 'object' && !Array.isArray(hierarchy)
    ? hierarchy as Record<string, unknown>
    : null
}

function reintakeDraftPath(memoryDir: string): string {
  return getProjectSystemStatePathFromMemoryDir(memoryDir, 'reintake-drafts/current.json')
}

function readQueueFile(queuePath: string): {
  queue: {
    version: number
    lastUpdated: string
    tasks: Array<Record<string, unknown>>
    releases?: Array<Record<string, unknown>>
    selectedReleaseId?: string
  }
  expectedQueueRevision: number | null
} {
  const result = readProjectTaskQueueForMutationSync(queuePath)
  const parsed = result.queue
  if (Array.isArray(parsed)) {
    return {
      queue: { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed as Array<Record<string, unknown>> },
      expectedQueueRevision: result.expectedQueueRevision,
    }
  }
  const record = parsed as {
    version?: number
    lastUpdated?: string
    tasks?: Array<Record<string, unknown>>
    releases?: Array<Record<string, unknown>>
    selectedReleaseId?: string
  }
  return {
    queue: {
      version: record.version ?? 1,
      lastUpdated: record.lastUpdated ?? new Date().toISOString(),
      tasks: record.tasks ?? [],
      ...(record.releases ? { releases: record.releases } : {}),
      ...(record.selectedReleaseId ? { selectedReleaseId: record.selectedReleaseId } : {}),
    },
    expectedQueueRevision: result.expectedQueueRevision,
  }
}

async function appendReintakeProgress(memoryDir: string, draft: ProjectReintakeDraft, appliedGroups: number, now: string): Promise<void> {
  const summary = `\n## ${now} Project re-intake applied\n\nApplied ${appliedGroups} group(s): ${draft.summary.kept} kept, ${draft.summary.reframed} reframed, ${draft.summary.created} created, ${draft.summary.archived} archived.\n`
  await appendManagedTextFile(getProjectSystemStatePathFromMemoryDir(memoryDir, 'PROGRESS.md'), summary, 'utf-8').catch(() => undefined)
}

function graphTaskChange(
  task: EvidenceTask,
  reconciliations: EvidenceReconciliation[],
  existingTasks: Array<Record<string, unknown>>,
  selectedRelease: SelectedRelease | null,
  sources: ProjectReintakeSource[],
  projectPath: string | undefined,
  now: string,
): ReintakeChange {
  const reframe = reconciliations.find(change =>
    'existingTaskId' in change && change.existingTaskId === task.id,
  ) as { existingTaskId?: string; reason?: string } | undefined
  const existing = existingTasks.find(candidate => stringField(candidate, 'id') === task.id)
  const effectiveTask: EvidenceTask = {
    ...task,
    ...(!task.semanticKind && stringField(existing ?? {}, 'semanticKind') ? {
      semanticKind: stringField(existing ?? {}, 'semanticKind') as EvidenceTask['semanticKind'],
    } : {}),
    ...(!task.parentAcceptanceCriterionIds?.length && arrayStringField(existing?.parentAcceptanceCriterionIds).length > 0
      ? { parentAcceptanceCriterionIds: arrayStringField(existing?.parentAcceptanceCriterionIds) }
      : {}),
  }
  const draft = evidenceTaskToDraft(effectiveTask, selectedRelease, sources, projectPath, now)
  const after = importedContractWorkIsStructurallyIncomplete(draft as unknown as Record<string, unknown>)
    ? structurallyIncompleteImportRepairDraft(draft as unknown as Record<string, unknown>, selectedRelease, projectPath, now)
    : draft

  if (existing) {
    return {
      kind: 'reframe',
      taskId: task.id,
      before: {
        id: task.id,
        title: stringField(existing ?? {}, 'title') ?? task.title,
        status: stringField(existing ?? {}, 'status') ?? 'unknown',
      },
      after,
      // A historical completion without the selected release's required proof
      // cannot survive a re-intake merely because the task identity matched.
      ...(taskNeedsCurrentScopeProof(existing, selectedRelease) ? { reopenForProof: true } : {}),
      reason: `Reframe from current evidence: ${reframe?.reason ?? task.title}`,
    }
  }

  return {
    kind: 'create',
    task: after,
    reason: 'Create missing work from current source evidence.',
  }
}

function repairStructurallyIncompleteImportedContractWork(
  tasks: Array<Record<string, unknown>>,
  usedTaskIds: Set<string>,
  selectedRelease: SelectedRelease | null,
  projectPath: string | undefined,
  now: string,
): ReintakeChange[] {
  return tasks
    .filter(task => {
      const id = stringField(task, 'id')
      if (!id || usedTaskIds.has(id)) return false
      if (isTerminalTask(task)) return false
      return importedContractWorkIsStructurallyIncomplete(task)
    })
    .map(task => {
      const taskId = stringField(task, 'id') ?? ''
      const title = stringField(task, 'title') ?? 'Imported contract work'
      if (isResolvedContractRecoveryArtifact(task)) {
        return {
          kind: 'archive' as const,
          taskId,
          reason: 'This imported recovery task is already marked resolved in the source evidence, so it should remain history instead of blocking the current scope.',
        }
      }
      return {
        kind: 'reframe' as const,
        taskId,
        before: {
          id: taskId,
          title,
          status: stringField(task, 'status') ?? 'unknown',
        },
        after: structurallyIncompleteImportRepairDraft(task, selectedRelease, projectPath, now),
        reason: 'Imported contract/type work has a hollow proof target and must recover concrete source-backed contract names before execution.',
      }
    })
}

function isResolvedContractRecoveryArtifact(task: Record<string, unknown>): boolean {
  // Imported prose is evidence for a repair, never a completion signal. A
  // task can leave this repair path only through the same typed completion
  // records used by the rest of the runtime.
  const doneSummary = task.doneSummaryBundle
  if (doneSummary && typeof doneSummary === 'object' && !Array.isArray(doneSummary)) {
    const record = doneSummary as Record<string, unknown>
    if (record.status === 'done' && typeof record.completedAt === 'string' && record.completedAt.trim()) return true
  }
  const mergeRecord = task.mergeRecord
  if (mergeRecord && typeof mergeRecord === 'object' && !Array.isArray(mergeRecord)) {
    return (mergeRecord as Record<string, unknown>).result === 'merged'
  }
  return false
}

function structurallyIncompleteImportRepairDraft(
  task: Record<string, unknown>,
  selectedRelease: SelectedRelease | null,
  projectPath: string | undefined,
  now: string,
): ReintakeTaskDraft {
  const originalTitle = stringField(task, 'title') ?? 'Imported contract work'
  const title = structuralRepairTitle(originalTitle)
  const taskId = stringField(task, 'id') ?? slugify(originalTitle)
  const releaseIds = arrayStringField(task.releaseIds)
  const inSelectedRelease = selectedRelease ? releaseIds.includes(selectedRelease.id) : false
  const readiness = importedContractStructuralRepairReadiness(task, now)

  return {
    id: taskId,
    title,
    description: [
      stringField(task, 'description') || 'Source-backed imported work needs structural repair.',
      `Original imported title: ${originalTitle}`,
      'Guildhall imported this as executable contract/type work, but the saved task does not name the concrete contract or type surfaces it owns.',
    ].join('\n\n'),
    ...(stringField(task, 'sourceIdentity') ? { sourceIdentity: stringField(task, 'sourceIdentity') } : {}),
    ...(stringField(task, 'deliverableName') ? { deliverableName: stringField(task, 'deliverableName') } : {}),
    ...(stringField(task, 'producedArtifact') ? { producedArtifact: stringField(task, 'producedArtifact') } : {}),
    ...(stringField(task, 'workShape') ? { workShape: stringField(task, 'workShape') as Task['workShape'] } : {}),
    ...(stringField(task, 'targetArea') ? { targetArea: stringField(task, 'targetArea') } : {}),
    ...(arrayStringField(task.buildsOn).length > 0 ? { buildsOn: arrayStringField(task.buildsOn) } : {}),
    ...(arrayStringField(task.consumerSurfaces).length > 0 ? { consumerSurfaces: arrayStringField(task.consumerSurfaces) } : {}),
    ...(stringField(task, 'semanticKind') ? { semanticKind: stringField(task, 'semanticKind') } : {}),
    ...(arrayStringField(task.contractNames).length > 0 ? { contractNames: arrayStringField(task.contractNames) } : {}),
    domain: stringField(task, 'domain') ?? 'planning',
    ...(projectPath ? { projectPath } : {}),
    status: selectedRelease && !inSelectedRelease ? 'shelved' : 'import_draft',
    priority: priorityField(task.priority),
    dependsOn: arrayStringField(task.dependsOn),
    acceptanceCriteria: [{
      id: 'contract-surface-recovered',
      description: `${originalTitle} names the concrete contract/type surfaces recovered from cited sources, or is reshaped to match the documented source structure before implementation.`,
      verifiedBy: 'review',
      source: 'inferred',
      met: false,
    }],
    references: arrayStringField(task.references),
    ...(inSelectedRelease && selectedRelease ? { releaseIds: [selectedRelease.id] } : {}),
    spec: [
      `## What this is`,
      `Repair the imported handoff for ${originalTitle}.`,
      '',
      '## Problem / context',
      'The task is currently shaped like implementation work, but its proof target is hollow: it asks for contract/type implementation without naming the concrete source-backed contract or type surfaces.',
      '',
      '## Acceptance criteria',
      `1. ${originalTitle} names the concrete contract/type surfaces recovered from cited sources, or is reshaped to match the documented source structure before implementation.`,
      '',
      '## Verification',
      '- Review the cited source trail and confirm the worker handoff no longer depends on an empty contract placeholder.',
    ].join('\n'),
    taskReadiness: readiness,
    taskKind: 'research',
    definitionOfDone: readiness.definitionOfDone,
    blockerPlans: readiness.blockerPlans,
    contextBudget: readiness.contextBudget,
  }
}

function evidenceTaskToDraft(
  task: EvidenceTask,
  selectedRelease: SelectedRelease | null,
  sources: ProjectReintakeSource[],
  projectPath: string | undefined,
  now: string,
): ReintakeTaskDraft {
  const later = selectedRelease ? taskIsAfterSelectedRelease(task, selectedRelease) : false
  const releaseIds = releaseIdsForEvidenceTask(task, selectedRelease)
  const references = evidenceReferencesForTask(task, sources)
  const normalizedReferences = projectPath
    ? references.map(reference => path.isAbsolute(reference) ? reference : path.resolve(projectPath, reference))
    : references
  const contractNames = unique([...(task.contractNames ?? [])])
  const hasConcreteSourceEvidence = (
    contractNames.length > 0 ||
    task.proofPaths.some(path => path.source === 'documented') ||
    reintakePrototypeTaskKind(task) !== null ||
    sourceEvidenceSupportsBlueprint(sources, references) ||
    task.sourceRefs.some(ref => /`[^`\n]{2,80}`/.test(ref.snippet)) ||
    task.semanticKind === 'reviewer_lane'
  )
  const contractNeedsRecovery = contractShapedImportHasNoConcreteContracts({
    semanticKind: task.semanticKind,
    contractNames,
    hasAlternativeStructuralEvidence: false,
  })
  const contractRepairReadiness = contractNeedsRecovery
    ? importedContractStructuralRepairReadiness({
      title: task.title,
      description: evidenceTaskDescription(task),
      references,
      semanticKind: task.semanticKind,
      spec: evidenceTaskSpec({ task, references, acceptanceCriteria: [], sources, contractNames }),
    }, now)
    : undefined
  const importedBlueprint = hasConcreteSourceEvidence
    ? buildImportedBlueprintSeed(
      evidenceTaskToMaterializedImportTask(task, normalizedReferences, hasConcreteSourceEvidence),
      normalizedReferences,
      projectPath ?? '',
      now,
      sourceContentsByReference(sources, projectPath ?? ''),
    )
    : null
  // A document reference or a roadmap table row grounds the task's identity,
  // but it is not a complete implementation contract. Only a blueprint with
  // documented proof or non-generic typed criteria can move work to review.
  // This keeps re-intake from laundering generic importer prose into a
  // seemingly executable spec.
  const reviewableBlueprint = Boolean(
    importedBlueprint &&
    importedBlueprint.status === 'spec_review' &&
    hasConcreteReintakeBlueprint(importedBlueprint),
  )
  const sourceShapedCriteria = reintakeAcceptanceCriteria(task, contractNames)
  const acceptanceCriteriaSource = reviewableBlueprint
    ? (reintakePrototypeTaskKind(task)
        ? sourceShapedCriteria
        : importedBlueprint?.acceptanceCriteria ?? sourceShapedCriteria)
    : []
  const acceptanceCriteria = AcceptanceCriteria.array().parse(acceptanceCriteriaSource.map(criterion => ({
    ...criterion,
    id: criterion.id,
    description: criterion.description,
    verifiedBy: criterion.verifiedBy ?? 'review',
    source: criterion.source ?? 'inferred',
    met: false,
  })))
  return {
    id: task.id,
    title: task.title,
    description: evidenceTaskDescription(task),
    ...(task.sourceIdentity ? { sourceIdentity: task.sourceIdentity } : {}),
    ...(task.deliverableName ? { deliverableName: task.deliverableName } : {}),
    ...(task.producedArtifact ? { producedArtifact: task.producedArtifact } : {}),
    ...(task.workShape ? { workShape: task.workShape } : {}),
    ...(task.targetArea ? { targetArea: task.targetArea } : {}),
    ...(task.buildsOn?.length ? { buildsOn: [...task.buildsOn] } : {}),
    ...(task.consumerSurface ? { consumerSurfaces: [task.consumerSurface] } : {}),
    domain: task.targetArea,
    ...(projectPath ? { projectPath } : {}),
    status: later ? 'shelved' : reviewableBlueprint ? 'spec_review' : 'import_draft',
    priority: evidenceTaskPriority(task),
    ...(task.semanticKind ? { semanticKind: task.semanticKind } : {}),
    ...(task.contractNames?.length ? { contractNames: [...task.contractNames] } : {}),
    ...(task.parentAcceptanceCriterionIds?.length
      ? { parentAcceptanceCriterionIds: [...task.parentAcceptanceCriterionIds] }
      : {}),
    dependsOn: task.dependsOn,
    acceptanceCriteria,
    references,
    ...(releaseIds?.length ? { releaseIds } : {}),
    ...(importedBlueprint?.sourceClaims?.length ? { sourceClaims: importedBlueprint.sourceClaims } : {}),
    ...(task.stageAlignment ? { stageAlignment: task.stageAlignment } : {}),
    spec: reviewableBlueprint
      ? importedBlueprint?.spec ?? evidenceTaskSpec({ task, references, acceptanceCriteria, sources, contractNames })
      : evidenceTaskIntakeDraftSpec(task, references),
    ...(importedBlueprint?.structuredSpec ? { structuredSpec: importedBlueprint.structuredSpec } : {}),
    ...(reviewableBlueprint ? { productBrief: reintakeOwnedProductBrief(importedBlueprint?.productBrief) ?? reintakeProductBrief(task, contractNames) } : {}),
    proofPaths: (reviewableBlueprint
      ? (importedBlueprint?.proofPaths ?? task.proofPaths)
      : []) as unknown as Task['proofPaths'],
    ...(importedBlueprint?.workUnitAnalysis ? { workUnitAnalysis: importedBlueprint.workUnitAnalysis } : {}),
    ...(importedBlueprint?.taskReadiness ? { taskReadiness: importedBlueprint.taskReadiness } : {}),
    ...(contractRepairReadiness ? {
      taskKind: contractRepairReadiness.taskKind,
      taskReadiness: contractRepairReadiness,
      definitionOfDone: contractRepairReadiness.definitionOfDone,
      blockerPlans: contractRepairReadiness.blockerPlans,
      contextBudget: contractRepairReadiness.contextBudget,
    } : {}),
    ...(importedBlueprint?.taskKind ? { taskKind: importedBlueprint.taskKind } : {}),
    ...(importedBlueprint?.definitionOfDone ? { definitionOfDone: importedBlueprint.definitionOfDone } : {}),
    ...(importedBlueprint?.blockerPlans ? { blockerPlans: importedBlueprint.blockerPlans } : {}),
    ...(importedBlueprint?.contextBudget ? { contextBudget: importedBlueprint.contextBudget } : {}),
  }
}

function sourceContentsByReference(
  sources: ProjectReintakeSource[],
  projectPath: string,
): ReadonlyMap<string, string> {
  const contents = new Map<string, string>()
  for (const source of sources) {
    contents.set(source.path, source.content)
    contents.set(source.path.replace(/\\/g, '/'), source.content)
    if (!path.isAbsolute(source.path)) {
      contents.set(path.resolve(projectPath, source.path), source.content)
    }
  }
  return contents
}

function evidenceTaskIntakeDraftSpec(task: EvidenceTask, references: string[]): string {
  return [
    '## Intake needed',
    `The cited sources establish **${task.title}** as scoped work, but they do not yet provide a task-specific proof contract.`,
    '',
    '## Source trail',
    ...(references.length > 0 ? references.map(reference => `- ${reference}`) : ['- No source reference was retained.']),
    '',
    '## Next action',
    'Shape a bounded spec with the concrete behavior, acceptance criteria, and proof path before this task can enter review.',
  ].join('\n')
}

function sourceEvidenceSupportsBlueprint(
  sources: ProjectReintakeSource[],
  references: string[],
): boolean {
  const relevantSources = sources.filter(source => references.includes(source.path))
  return relevantSources.some(source => {
    const content = source.content
    return (
      /`[^`\n]{2,80}`/.test(content) ||
      /(?:^|\n)\s*#{2,6}\s+(?:acceptance criteria|finding contract|proof|reviewer questions|success criteria|verification)\b/im.test(content) ||
      /\b(?:acceptance criteria|deterministic proof|needed contracts|proof command|verification)\s*:/i.test(content)
    )
  })
}

function hasConcreteReintakeBlueprint(blueprint: ReturnType<typeof buildImportedBlueprintSeed>): boolean {
  const documentedProof = (blueprint.proofPaths ?? []).some(path =>
    path && typeof path === 'object' && !Array.isArray(path) && path.source === 'documented',
  )
  if (documentedProof) return true

  const criteria = blueprint.acceptanceCriteria ?? []
  const genericCriteria = new Set([
    'source-implementation',
    'public-contract',
    'foundation-reuse',
    'design-system-conformance',
    'accessibility-contract',
    'automated-proof',
    'docs-diff',
    'docs-proof',
    'task-boundary',
    'runtime-slice',
    'deterministic-proof',
  ])
  const specificCriteria = criteria.some(criterion => !genericCriteria.has(criterion.id))
  if (specificCriteria) return true

  // A work-unit title is presentation prose. It may be translated, rewritten,
  // or omitted by a provider without changing whether the blueprint is
  // concrete. Concrete proof/criteria/contract metadata above is the only
  // authority for this boundary.
  return false
}

function releaseIdsForEvidenceTask(task: Pick<EvidenceTask, 'title' | 'stageAlignment'>, selectedRelease: SelectedRelease | null): string[] | undefined {
  return releaseIdsForStageAlignment(task.stageAlignment, selectedRelease)
}

function reintakeOwnedProductBrief(productBrief: Task['productBrief'] | undefined): Task['productBrief'] | undefined {
  if (!productBrief) return undefined
  return {
    ...productBrief,
    authoredBy: 'project-reintake',
  }
}

function evidenceReferencesForTask(task: EvidenceTask, sources: ProjectReintakeSource[]): string[] {
  return unique([
    ...task.sourceRefs.map(ref => ref.path),
    ...supportingEvidenceRefsForTask(task, sources),
  ])
}

function evidenceTaskToMaterializedImportTask(
  task: EvidenceTask,
  references: string[],
  hasConcreteSourceEvidence: boolean,
): MaterializedImportTask {
  const evidenceSnippets = task.sourceRefs
    .map(ref => ref.snippet)
    .filter(snippet => !/^Recommended first task title:/i.test(snippet.trim()))
  return {
    id: task.id,
    title: task.title,
    description: evidenceSnippets.length > 0
      ? evidenceTaskDescription(task)
      : evidenceTaskWhyThisMayMatter(task),
    ...(hasConcreteSourceEvidence && evidenceSnippets.length > 0
      ? { whyThisMayMatter: evidenceSnippets.join(' ') }
      : {}),
    domain: task.targetArea,
    scope: 'current',
    priority: evidenceTaskPriority(task),
    ...(task.semanticKind ? { semanticKind: task.semanticKind } : {}),
    ...(task.contractNames?.length ? { contractNames: [...task.contractNames] } : {}),
    ...(task.parentAcceptanceCriterionIds?.length
      ? { parentAcceptanceCriterionIds: [...task.parentAcceptanceCriterionIds] }
      : {}),
    references,
    acceptanceCriteria: task.acceptanceCriteria,
    dependsOn: task.dependsOn,
    proofPaths: hasConcreteSourceEvidence ? task.proofPaths : [],
    ...(hasConcreteSourceEvidence ? { evidenceGraphTask: true } : {}),
  }
}

function reintakeAcceptanceCriteria(
  task: EvidenceTask,
  contractNames: string[],
): Array<{ id: string; description: string; verifiedBy?: string; source?: 'documented' | 'inferred' }> {
  const prototypeKind = reintakePrototypeTaskKind(task)
  if (prototypeKind === 'fixture') {
    return [
      {
        id: 'fiction-fixture-source',
        description: `${task.title} adds a tiny safe fiction fixture with enough manuscript/context detail to exercise story-memory behavior without private real-manuscript data.`,
        verifiedBy: 'review',
      },
      {
        id: 'human-expected-records',
        description: 'Human-authored expected records describe the ground-truth reader knowledge, scene facts, and expected signals the first run should compare against.',
        verifiedBy: 'review',
      },
      {
        id: 'fixture-load-proof',
        description: 'The fixture and expected records can be loaded by the no-UI Stage 1 harness without needing product UI.',
        verifiedBy: 'review',
      },
    ]
  }
  if (prototypeKind === 'runner') {
    return [
      {
        id: 'fixture-packet-build',
        description: `${task.title} reads the first fixture records and builds the context packet inputs used by the prototype run.`,
        verifiedBy: 'review',
      },
      {
        id: 'no-ui-command',
        description: 'The runner is callable from a script or CLI entrypoint without requiring a completed product UI.',
        verifiedBy: 'review',
      },
      {
        id: 'deterministic-run-record',
        description: 'The run writes a deterministic prototype-run record that later evaluation/debug steps can consume.',
        verifiedBy: 'review',
      },
    ]
  }
  if (prototypeKind === 'evaluation') {
    return [
      {
        id: 'packet-quality-categories',
        description: `${task.title} reports whether context is missing, noisy, stale, or useful against the human-authored expected records.`,
        verifiedBy: 'review',
      },
      {
        id: 'repeatable-evaluation-record',
        description: 'Evaluation output is deterministic enough to compare repeated runs of the same fixture.',
        verifiedBy: 'review',
      },
      {
        id: 'reviewer-readable-failures',
        description: 'Failures identify which fixture expectation or packet signal was violated so the next prototype iteration is actionable.',
        verifiedBy: 'review',
      },
    ]
  }
  if (prototypeKind === 'debug_report') {
    return [
      {
        id: 'debug-report-inputs',
        description: `${task.title} records the fixture id, source records, packet inputs, prototype output, and evaluation result for each run.`,
        verifiedBy: 'review',
      },
      {
        id: 'debug-report-traceability',
        description: 'The report lets a developer trace why a context item was considered missing, noisy, stale, or useful.',
        verifiedBy: 'review',
      },
      {
        id: 'debug-report-local-artifact',
        description: 'The report is written as a local artifact that can be attached to Guildhall task evidence.',
        verifiedBy: 'review',
      },
    ]
  }
  if (prototypeKind === 'schema_prune') {
    return [
      {
        id: 'first-run-schema-findings',
        description: `${task.title} records what the first fixture run proved, disproved, or left ambiguous about the MVP story-memory schema.`,
        verifiedBy: 'review',
      },
      {
        id: 'schema-narrowing-decision',
        description: 'The narrowed schema keeps only fields needed by the Stage 1 fixture/evaluation loop and names any fields intentionally deferred.',
        verifiedBy: 'review',
      },
      {
        id: 'schema-proof-update',
        description: 'Fixture, runner, evaluation, and debug-report proof artifacts are updated or explicitly declared unchanged after the schema narrowing.',
        verifiedBy: 'review',
      },
    ]
  }
  if (prototypeKind === 'drafting_model') {
    return [
      {
        id: 'deepinfra-model-candidate',
        description: `${task.title} records a DeepInfra-hosted drafting model candidate with model id, context window, license, privacy/retention notes, content-policy boundary, cost, and fallback risk.`,
        verifiedBy: 'review',
      },
      {
        id: 'broad-genre-drafting-proof',
        description: 'The model is tested against chapter-drafting scenarios across the intended fiction range, including legal adult fiction inside the Narrative Harness content boundary.',
        verifiedBy: 'review',
      },
      {
        id: 'drafting-failure-telemetry',
        description: 'The proof records refusal behavior, repetition/runaway behavior, cost, latency, and whether the output preserves author voice and genre constraints.',
        verifiedBy: 'review',
      },
    ]
  }
  if (prototypeKind === 'author_intent') {
    return [
      {
        id: 'author-intent-records',
        description: `${task.title} defines records for voice, genre, audience, theme, synopsis, outline, characters, character voices, world-state facts, and review plan.`,
        verifiedBy: 'review',
      },
      {
        id: 'intent-to-packet-proof',
        description: 'The no-UI packet builder can feed those records into drafting and review without relying on a completed product UI.',
        verifiedBy: 'review',
      },
      {
        id: 'content-boundary-input',
        description: 'The author-intent input captures heat level/content boundary so adult fiction support stays inside the product policy.',
        verifiedBy: 'review',
      },
    ]
  }
  if (prototypeKind === 'chapter_draft') {
    return [
      {
        id: 'synopsis-to-outline-chain',
        description: `${task.title} can generate or load a synopsis, outline, character/voice records, and world-state facts before drafting.`,
        verifiedBy: 'review',
      },
      {
        id: 'chapter-draft-command',
        description: 'A pnpm script or CLI command drafts one chapter from the selected model using the bounded context packet and review plan.',
        verifiedBy: 'review',
      },
      {
        id: 'author-voice-preservation',
        description: 'The draft proof records whether the chapter follows the requested author voice, genre, audience, and character voices.',
        verifiedBy: 'review',
      },
    ]
  }
  if (prototypeKind === 'world_state_review') {
    return [
      {
        id: 'elapsed-time-state-transitions',
        description: `${task.title} checks object and property changes over elapsed time, such as wet hair drying by climate, food spoiling, wounds healing, fires cooling, or objects being moved/used/consumed.`,
        verifiedBy: 'review',
      },
      {
        id: 'world-state-finding-shape',
        description: 'Reviewer output names the entity, prior state, later state, elapsed time, environment, expected transition, contradiction, and source passages.',
        verifiedBy: 'review',
      },
      {
        id: 'world-rule-exceptions',
        description: 'The proof preserves explicit magic, technology, or storyworld rules as exceptions instead of treating every non-real-world transition as an error.',
        verifiedBy: 'review',
      },
    ]
  }
  if (prototypeKind === 'spatial_review') {
    return [
      {
        id: 'travel-plausibility-proof',
        description: `${task.title} checks distance, travel time, terrain, travel mode, walking speed, weather, light, and map consistency for a deliberately inconsistent fixture.`,
        verifiedBy: 'review',
      },
      {
        id: 'genre-aware-geography',
        description: 'The reviewer distinguishes ordinary walking-speed impossibilities from explicit fantasy/speculative exceptions such as magic, mounts, portals, or non-human physiology.',
        verifiedBy: 'review',
      },
      {
        id: 'spatial-finding-shape',
        description: 'Reviewer output names the passage, location, claimed movement/geography, expected plausible behavior, difference, severity, and evidence.',
        verifiedBy: 'review',
      },
    ]
  }
  if (contractNames.length > 0 && task.semanticKind === 'contract') {
    const fixtureContracts = contractNames.filter(name => /fixture|expected|signal/i.test(name))
    const runContracts = contractNames.filter(name => /prototype|run|evaluation|score|disagreement/i.test(name))
    return [
      {
        id: 'contracts-defined',
        description: `${task.title} defines the cited contracts: ${contractNames.map(name => `\`${name}\``).join(', ')}.`,
        verifiedBy: 'review',
      },
      {
        id: 'fixture-ground-truth-shape',
        description: fixtureContracts.length > 0
          ? `Fixture and expected-record data can represent human-authored ground truth using ${fixtureContracts.map(name => `\`${name}\``).join(', ')}.`
          : 'Fixture and expected-record data can represent human-authored ground truth for the first no-UI proof.',
        verifiedBy: 'review',
      },
      {
        id: 'run-evaluation-shape',
        description: runContracts.length > 0
          ? `Prototype run and evaluation records can report packet quality and reviewer outcomes using ${runContracts.map(name => `\`${name}\``).join(', ')}.`
          : 'Prototype run and evaluation records can report packet quality and reviewer outcomes.',
        verifiedBy: 'review',
      },
      {
        id: 'deterministic-proof',
        description: `${task.title} has deterministic review or command proof before Stage 1 execution continues.`,
        verifiedBy: 'review',
      },
    ]
  }
  return task.acceptanceCriteria
}

function reintakePrototypeTaskKind(
  task: Pick<EvidenceTask, 'semanticKind'>,
): 'fixture' | 'runner' | 'evaluation' | 'debug_report' | 'schema_prune' | 'drafting_model' | 'author_intent' | 'chapter_draft' | 'world_state_review' | 'spatial_review' | null {
  const kind = task.semanticKind
  if (kind === 'fixture' || kind === 'runner' || kind === 'evaluation' || kind === 'debug_report' ||
      kind === 'schema_prune' || kind === 'drafting_model' || kind === 'author_intent' ||
      kind === 'chapter_draft' || kind === 'world_state_review' || kind === 'spatial_review') return kind
  return null
}

function reintakeProductBrief(task: EvidenceTask, contractNames: string[]): NonNullable<Task['productBrief']> {
  const prototypeKind = reintakePrototypeTaskKind(task)
  let successMetric = `${task.title} is specified from current source evidence with a clear proof boundary before implementation starts.`
  if (prototypeKind === 'fixture') {
    successMetric = `${task.title} creates a safe first fiction fixture plus expected records that the no-UI Stage 1 harness can load.`
  } else if (prototypeKind === 'runner') {
    successMetric = `${task.title} creates a no-UI command path that turns fixture records into a repeatable prototype-run record.`
  } else if (prototypeKind === 'evaluation') {
    successMetric = `${task.title} produces deterministic missing/noisy/stale/useful context evaluation output from the first fixture run.`
  } else if (prototypeKind === 'debug_report') {
    successMetric = `${task.title} writes a developer-readable local artifact that explains each run's inputs, outputs, and evaluation result.`
  } else if (prototypeKind === 'schema_prune') {
    successMetric = `${task.title} uses first-run proof to narrow the MVP story-memory schema without pulling in later-release scope.`
  } else if (contractNames.length > 0) {
    successMetric = `${task.title} defines the cited Stage 1 contracts and records proof that they support the no-UI fixture/evaluation harness.`
  }
  return {
    userJob: `I want ${task.title} shaped into reviewable project work from the cited planning docs, without asking me to reconstruct the source trail manually.`,
    whyItMattersNow: task.stageAlignment
      ? `${task.stageAlignment} is the selected release scope, so this work must be reviewed before Guildhall can safely execute that release.`
      : 'This work is part of the current recovered project scope and needs a source-grounded implementation boundary before execution.',
    successMetric,
    nonGoals: [
      'Do not include unrelated roadmap contracts or later-release work in this task.',
      'Do not treat this draft as approved until the owner or delegated Codex-human explicitly approves the spec.',
    ],
    authoredBy: 'project-reintake',
    authoredAt: new Date().toISOString(),
  }
}

function supportingEvidenceRefsForTask(task: EvidenceTask, sources: ProjectReintakeSource[]): string[] {
  if (task.semanticKind !== 'contract' && task.semanticKind !== 'fixture' && task.semanticKind !== 'evaluation') return []
  return sources
    .filter(source => /\bneeded contracts\s*:/i.test(source.content))
    .map(source => source.path)
}

function evidenceTaskSpec(input: {
  task: EvidenceTask
  references: string[]
  acceptanceCriteria: Task['acceptanceCriteria']
  sources: ProjectReintakeSource[]
  contractNames: string[]
}): string {
  const contractNames = shouldNameContractsInReintakeSpec(input.task)
    ? input.contractNames
    : []
  return [
    '## What this is',
    input.task.title,
    '',
    '## Problem / context',
    evidenceTaskDescription(input.task),
    '',
    '## Goals',
    `- Deliver ${input.task.title} from the cited project evidence.`,
    ...(contractNames.length > 0
      ? [`- Define and use the concrete contracts named in the cited docs: ${contractNames.map(name => `\`${name}\``).join(', ')}.`]
      : []),
    '',
    '## Imported evidence',
    ...input.references.map(reference => `- ${reference}`),
    '',
    '## Acceptance criteria',
    ...input.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion.description}`),
    '',
    '## Completion Boundary',
    `- Product outcome: ${input.task.title} is reviewable and executable from the cited source evidence without importing unrelated roadmap work.`,
    '- What Guildhall can complete in code: repo-local implementation, fixtures, schema records, tests, docs, and proof artifacts named by the approved spec.',
    '- External dependencies: none expected beyond the local project checkout and documented proof commands.',
    '- Owner-only setup: explicit approval of this reviewable blueprint before worker execution.',
    '- Verification environment: local project checkout with documented pnpm/script proof commands available in the execution environment.',
    '- What counts as done: the accepted proof demonstrates the scoped Stage work and records evidence against the acceptance criteria.',
    '- What must be split or blocked: nothing else should be split before this task runs; block only if the approved proof commands require missing local setup, credentials, or unrelated later-release work.',
  ].join('\n')
}

function shouldNameContractsInReintakeSpec(task: EvidenceTask): boolean {
  return task.semanticKind === 'contract'
}

type SelectedRelease = {
  id: string
  label: string
  stageNumber: number
  source: ProjectReintakeReleaseDraft['source']
  scopeDeliverables: string[]
  scopeSourcePath?: string
  proofStyle?: 'script_only' | 'manual' | 'mixed' | 'unspecified'
  supersedesReleaseId?: string
}

function taskNeedsCurrentScopeProof(task: unknown, selectedRelease: SelectedRelease | null): boolean {
  return taskDoneButProofMissingForScope(task, selectedRelease?.proofStyle)
}

function releaseProofStyleFromSource(content: string): SelectedRelease['proofStyle'] {
  const explicit = /\bproof\s*style\s*[:=-]\s*(script[_ -]?only|manual|mixed|unspecified)\b/i.exec(content)?.[1]?.toLowerCase()
  if (explicit) {
    if (/script/.test(explicit)) return 'script_only'
    if (explicit === 'manual') return 'manual'
    if (explicit === 'mixed') return 'mixed'
    return 'unspecified'
  }
  return undefined
}

function detectSelectedRelease(sources: ProjectReintakeSource[]): SelectedRelease | null {
  const candidates: SelectedRelease[] = []
  for (const source of sources) {
    const current = source.content.match(/##\s+Current Next Milestone[\s\S]{0,500}?The next milestone is\s+(Stage\s+(\d+)(?::\s*([^.\n]+))?)/i)
    if (!current?.[1] || !current[2]) continue
    const currentStageNumber = Number(current[2])
    const stagePrefix = `Stage ${currentStageNumber}`
    const labelFromCurrent = current[3]?.trim() ? `${stagePrefix}: ${current[3].trim()}` : null
    const label = labelFromCurrent ?? matchingStageHeading(source.content, currentStageNumber) ?? stagePrefix
    const proofStyle = releaseProofStyleFromSource(source.content)
    candidates.push({
      id: slugify(label),
      label,
      stageNumber: currentStageNumber,
      source: 'release_plan',
      scopeDeliverables: releaseScopeDeliverables(source.content),
      ...(releaseScopeDeliverables(source.content).length > 0 ? { scopeSourcePath: source.path } : {}),
      ...(proofStyle ? { proofStyle } : {}),
    })
  }
  const scopedCandidate = candidates.find(candidate => candidate.scopeDeliverables.length > 0)
  if (scopedCandidate) return scopedCandidate
  if (candidates[0]) return candidates[0]
  for (const source of sources) {
    const firstStage = firstReleasePlanStage(source)
    if (firstStage) return firstStage
  }
  return null
}

function firstReleasePlanStage(source: ProjectReintakeSource): SelectedRelease | null {
  if (!/(^|\/)release-plan\.md$/i.test(source.path.replaceAll('\\', '/'))) return null
  const match = /^##\s+(Stage\s+(\d+)\s*:\s*.+?)\s*$/im.exec(source.content)
  if (!match?.[1] || !match[2]) return null
  const label = match[1].trim()
  const proofStyle = releaseProofStyleFromSource(source.content)
  return {
    id: slugify(label),
    label,
    stageNumber: Number(match[2]),
    source: 'release_plan',
    scopeDeliverables: releaseScopeDeliverables(source.content),
    ...(releaseScopeDeliverables(source.content).length > 0 ? { scopeSourcePath: source.path } : {}),
    ...(proofStyle ? { proofStyle } : {}),
  }
}

function dedupeTasksCoveredBySelectedReleaseScope(
  graphPlan: ReturnType<typeof planEvidenceWorkGraph>,
  selectedRelease: SelectedRelease | null,
): ReturnType<typeof planEvidenceWorkGraph> {
  if (!selectedRelease?.scopeSourcePath || selectedRelease.scopeDeliverables.length === 0) return graphPlan
  const canonicalDeliverables = new Set(graphPlan.tasks
    .filter(task => task.sourceRefs.some(ref => ref.path === selectedRelease.scopeSourcePath))
    .map(task => normalizeDeliverableIdentity(task.deliverableName)))
  if (canonicalDeliverables.size === 0) return graphPlan

  const suppressedIds = new Set(graphPlan.tasks
    .filter(task => !task.sourceRefs.some(ref => ref.path === selectedRelease.scopeSourcePath))
    .filter(task => canonicalDeliverables.has(normalizeDeliverableIdentity(task.deliverableName)))
    .map(task => task.id))
  if (suppressedIds.size === 0) return graphPlan
  return {
    ...graphPlan,
    tasks: graphPlan.tasks.filter(task => !suppressedIds.has(task.id)),
    reconciliations: graphPlan.reconciliations.filter(reconciliation => !suppressedIds.has(reconciliation.existingTaskId)),
  }
}

function releaseScopeDeliverables(content: string): string[] {
  const lines = content.split(/\r?\n/)
  const deliverables: string[] = []
  let inDeliverables = false

  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) {
      inDeliverables = /^deliverables$/i.test(heading[1]!.trim())
      continue
    }
    if (!inDeliverables) continue
    if (!line.trim().startsWith('|')) {
      if (line.trim()) break
      continue
    }

    const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
    const deliverable = cells[0]
    if (!deliverable || /^deliverable$/i.test(deliverable) || /^-+$/.test(deliverable)) continue
    if (cells.length >= 4) deliverables.push(stripMarkdownPunctuation(stripInlineCode(deliverable)))
  }

  return unique(deliverables)
}

function stripMarkdownPunctuation(value: string): string {
  return value.replace(/[.!?]+$/, '').trim()
}

function matchingStageHeading(content: string, selectedStageNumber: number): string | null {
  const re = /^##\s+(Stage\s+(\d+)\s*:\s*.+?)\s*$/gim
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    if (match[2] && Number(match[2]) === selectedStageNumber) {
      return match[1]?.trim() ?? null
    }
  }
  return null
}

function taskIsAfterSelectedRelease(task: EvidenceTask, selectedRelease: SelectedRelease): boolean {
  const alignedStage = stageNumber(task.stageAlignment)
  return alignedStage !== null && alignedStage > selectedRelease.stageNumber
}

function stageNumber(value: string | undefined): number | null {
  if (!value) return null
  const match = /\bstage\s+(\d+)\b/i.exec(value)
  return match?.[1] ? Number(match[1]) : null
}

function releaseDraftsFor(
  selectedRelease: SelectedRelease,
  groups: ReintakeChangeGroup[],
  existingTasks: Array<Record<string, unknown>>,
): ProjectReintakeReleaseDraft[] {
  const nodeIds: string[] = []
  const deferredNodeIds: string[] = []
  const sourceReleaseIds = new Set([selectedRelease.id, selectedRelease.supersedesReleaseId].filter((id): id is string => Boolean(id)))
  for (const task of existingTasks) {
    const id = stringField(task, 'id')
    if (!id || stringField(task, 'status') === 'archived') continue
    if (isPlanningInstructionTask(task)) continue
    const releaseIds = Array.isArray(task.releaseIds) ? task.releaseIds : []
    if (!releaseIds.some(releaseId => sourceReleaseIds.has(releaseId))) continue
    const nodeId = `work:${id}`
    if (stringField(task, 'status') === 'shelved') {
      deferredNodeIds.push(nodeId)
    } else {
      nodeIds.push(nodeId)
    }
  }
  for (const change of groups.flatMap(group => group.changes)) {
    const task = change.kind === 'create' ? change.task : change.kind === 'reframe' ? change.after : null
    if (!task) continue
    if (!task.releaseIds?.includes(selectedRelease.id)) continue
    const nodeId = `work:${task.id}`
    if (task.status === 'shelved') {
      deferredNodeIds.push(nodeId)
    } else {
      nodeIds.push(nodeId)
    }
  }
  return [{
    id: selectedRelease.id,
    label: selectedRelease.label,
    kind: 'release',
    state: 'active',
    source: selectedRelease.source,
    nodeIds: unique(nodeIds),
    deferredNodeIds: unique(deferredNodeIds),
    ...(selectedRelease.proofStyle ? { proofStyle: selectedRelease.proofStyle } : {}),
    ...(selectedRelease.supersedesReleaseId ? { supersedesReleaseId: selectedRelease.supersedesReleaseId } : {}),
  }]
}

function selectReintakeRelease(
  selectedRelease: SelectedRelease | null,
  input: ProjectReintakeInput,
): SelectedRelease | null {
  if (!selectedRelease || !input.releases?.length) return selectedRelease
  const existing = input.releases.find(release => release.id === selectedRelease.id)
  const reconciled = input.releases.find(release =>
    release.supersedesReleaseId === selectedRelease.id &&
    release.state !== 'shipped' &&
    release.state !== 'deferred',
  )
  if (reconciled) {
    return {
      ...selectedRelease,
      id: reconciled.id,
      label: reconciled.label,
      supersedesReleaseId: reconciled.supersedesReleaseId,
      ...(selectedRelease.proofStyle ? {} : reconciled.proofStyle ? { proofStyle: reconciled.proofStyle } : {}),
    }
  }

  const staleShippedRelease = existing?.state === 'shipped' && input.tasks.some(task =>
    arrayStringField(task.releaseIds).includes(selectedRelease.id) && !isTerminalTask(task),
  )
  if (!staleShippedRelease) return selectedRelease

  const revisionPattern = new RegExp(`^${escapeRegExp(selectedRelease.id)}-r(\\d+)$`)
  const nextRevision = input.releases
    .map(release => revisionPattern.exec(release.id)?.[1])
    .map(value => value ? Number(value) : 0)
    .reduce((max, value) => Math.max(max, value), 0) + 1
  const id = `${selectedRelease.id}-r${nextRevision}`
  return {
    ...selectedRelease,
    id,
    label: `${selectedRelease.label} (reconciled plan)`,
    supersedesReleaseId: selectedRelease.id,
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function archivePlanningInstructionTasks(
  tasks: Array<Record<string, unknown>>,
  usedTaskIds: Set<string>,
): Array<Extract<ReintakeChange, { kind: 'archive' }>> {
  return tasks
    .filter(task => {
      const id = stringField(task, 'id')
      return Boolean(id) && !usedTaskIds.has(id!) && isPlanningInstructionTask(task) && !isTerminalTask(task)
    })
    .map(task => ({
      kind: 'archive' as const,
      taskId: stringField(task, 'id')!,
      reason: 'This is a coordinator instruction for repairing or re-intaking the plan, not executable product work. Retain it as history without allowing its prose to claim release scope.',
    }))
}

/**
 * Planning prompts are data about how Guildhall should shape work. They are
 * not work themselves. Use several structural signals so a long instruction
 * cannot become a deliverable just because it repeats deliverable names.
 */
function isPlanningInstructionTask(task: Record<string, unknown>): boolean {
  // A long instruction can look exactly like executable work when a model
  // rewrites it. Only the source adapter's explicit semantic kind may keep it
  // out of the queue; title length and instruction vocabulary are display
  // prose, not a durable classification contract.
  return stringField(task, 'semanticKind') === 'planning_instruction'
}

function applyReleaseDrafts(
  queue: { selectedReleaseId?: string; releases?: Array<Record<string, unknown>>; tasks: Array<Record<string, unknown>> },
  draft: ProjectReintakeDraft,
): void {
  if (!draft.selectedReleaseId || !draft.releases?.length) return
  const releaseDrafts = draft.releases
  queue.selectedReleaseId = draft.selectedReleaseId
  const existing = new Map((queue.releases ?? []).map(release => [release.id, release]))
  for (const release of releaseDrafts) {
    const memberIds = new Set([
      ...release.nodeIds.map(nodeId => nodeId.replace(/^work:/, '')),
      ...release.deferredNodeIds.map(nodeId => nodeId.replace(/^work:/, '')),
    ])
    for (const task of queue.tasks) {
      const taskId = stringField(task, 'id')
      if (!taskId) continue
      const releaseIds = arrayStringField(task.releaseIds)
      if (memberIds.has(taskId)) {
        task.releaseIds = [
          ...releaseIds,
          ...(releaseIds.includes(release.id) ? [] : [release.id]),
        ]
      } else if (releaseIds.includes(release.id)) {
        task.releaseIds = releaseIds.filter(releaseId => releaseId !== release.id)
      }
    }
    existing.set(release.id, {
      ...release,
      nodeIds: unique(release.nodeIds),
      deferredNodeIds: unique(release.deferredNodeIds),
    })
  }
  queue.releases = Array.from(existing.values())
}

function duplicateMergeChanges(tasks: Array<Record<string, unknown>>): ReintakeMergeChange[] {
  const byIdentity = new Map<string, Array<Record<string, unknown>>>()
  for (const task of tasks) {
    const id = stringField(task, 'id')
    const status = stringField(task, 'status')
    if (!id || status !== 'blocked') continue
    const identity = explicitTaskStructuralIdentity(task)
    if (!identity) continue
    const bucket = byIdentity.get(identity) ?? []
    bucket.push(task)
    byIdentity.set(identity, bucket)
  }

  const changes: ReintakeMergeChange[] = []
  for (const tasksWithIdentity of byIdentity.values()) {
    if (tasksWithIdentity.length < 2) continue
    const survivor = stringField(tasksWithIdentity[0] ?? {}, 'id')
    if (!survivor) continue
    const merged = tasksWithIdentity.slice(1).map(task => stringField(task, 'id')).filter((id): id is string => Boolean(id))
    if (merged.length > 0) {
      changes.push({
        kind: 'merge',
        survivorTaskId: survivor,
        mergedTaskIds: merged,
        reason: 'Duplicate blocked recovery cards should be represented by one survivor.',
      })
    }
  }
  return changes
}

function preserveProgressChanges(tasks: Array<Record<string, unknown>>, usedTaskIds: Set<string>): ReintakeChange[] {
  return tasks
    .filter(task => stringField(task, 'status') === 'done')
    .map(task => stringField(task, 'id'))
    .filter((id): id is string => Boolean(id))
    .filter(id => !usedTaskIds.has(id))
    .map(taskId => ({
      kind: 'preserve_progress' as const,
      taskId,
      reason: 'This task is completed and remains progress evidence.',
    }))
}

function refreshCurrentEvidenceChanges(
  graphTasks: EvidenceTask[],
  existingTasks: Array<Record<string, unknown>>,
  selectedRelease: SelectedRelease | null,
  sources: ProjectReintakeSource[],
  projectPath: string | undefined,
  now: string,
): ReintakeChange[] {
  const changes: ReintakeChange[] = []
  for (const graphTask of graphTasks) {
    const existing = existingTasks.find(candidate => stringField(candidate, 'id') === graphTask.id)
    if (!existing) continue
    const after = evidenceTaskToDraft(graphTask, selectedRelease, sources, projectPath, now)
    if (!documentedProofPlanImproves(existing, after)) continue
    const existingStatus = stringField(existing, 'status') ?? 'unknown'
    changes.push({
      kind: 'refresh_evidence',
      taskId: graphTask.id,
      before: {
        id: graphTask.id,
        title: stringField(existing, 'title') ?? graphTask.title,
        status: existingStatus,
      },
      after,
      reopenForProof: existingStatus === 'done' && taskNeedsCurrentScopeProof(existing, selectedRelease),
      reason: 'The current source trail names a more concrete proof path than the saved task plan.',
    })
  }
  return changes
}

function repairNonBlockingDependencies(
  existingTasks: Array<Record<string, unknown>>,
  graphTasks: EvidenceTask[],
): ReintakeChange[] {
  const graphTaskIds = new Set(graphTasks.map(task => task.id))
  const nonBlockingIds = new Set(existingTasks
    .filter(task => ['archived', 'shelved'].includes(stringField(task, 'status') ?? ''))
    .map(task => stringField(task, 'id'))
    .filter((id): id is string => Boolean(id)))
  return existingTasks
    .filter(task => {
      const id = stringField(task, 'id')
      return Boolean(id && graphTaskIds.has(id))
    })
    .map(task => {
      const taskId = stringField(task, 'id')!
      const beforeDependsOn = arrayStringField(task.dependsOn)
      const afterDependsOn = beforeDependsOn.filter(dependency => !nonBlockingIds.has(dependency))
      return { taskId, beforeDependsOn, afterDependsOn }
    })
    .filter(change => change.afterDependsOn.length !== change.beforeDependsOn.length)
    .map(change => ({
      kind: 'repair_dependencies' as const,
      ...change,
      reason: 'Historical archived or shelved work is not a live prerequisite.',
    }))
}

function migrateSameStageReleaseMemberships(
  tasks: Array<Record<string, unknown>>,
  usedTaskIds: Set<string>,
  selectedRelease: SelectedRelease | null,
): ReintakeChange[] {
  if (!selectedRelease) return []
  return tasks
    .filter(task => {
      const id = stringField(task, 'id')
      if (!id || usedTaskIds.has(id) || !isOpenPreImplementationTask(task)) return false
      const releaseIds = arrayStringField(task.releaseIds)
      return releaseIds.length > 0 &&
        !releaseIds.includes(selectedRelease.id) &&
        releaseIds.some(releaseId => stageNumberFromReleaseId(releaseId) === selectedRelease.stageNumber)
    })
    .map(task => {
      const id = stringField(task, 'id') ?? ''
      const title = stringField(task, 'title') ?? id
      const after = reintakeDraftFromExistingTask(task, {
        releaseIds: [selectedRelease.id],
        status: reintakeDraftStatus(stringField(task, 'status')),
      })
      return {
        kind: 'reframe' as const,
        taskId: id,
        before: {
          id,
          title,
          status: stringField(task, 'status') ?? 'unknown',
        },
        after: {
          ...after,
          stageAlignment: selectedRelease.label,
        },
        reason: `The task belonged to an older Stage ${selectedRelease.stageNumber} boundary; move its existing work into ${selectedRelease.label} instead of archiving it.`,
      }
    })
}

function stageNumberFromReleaseId(value: string): number | null {
  const match = /^stage-(\d+)-/i.exec(value)
  return match?.[1] ? Number(match[1]) : null
}

function documentedProofCommands(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .filter((proof): proof is Record<string, unknown> => Boolean(proof) && typeof proof === 'object' && !Array.isArray(proof))
      .filter(proof => proof.kind === 'command' && proof.source === 'documented')
      .map(proof => typeof proof.command === 'string' ? proof.command.trim() : '')
      .filter(Boolean)
    : []
}

function documentedProofPlanImproves(existing: Record<string, unknown>, after: ReintakeTaskDraft): boolean {
  const refreshedCommands = documentedProofCommands(after.proofPaths)
  if (refreshedCommands.length === 0) return false
  const existingCommands = new Set(documentedProofCommands(existing.proofPaths))
  return refreshedCommands.some(command => !existingCommands.has(command))
}

function releaseIdsForStageAlignment(
  stageAlignment: string | undefined,
  selectedRelease: SelectedRelease | null,
): string[] | undefined {
  if (!selectedRelease) return undefined
  if (!stageAlignment?.trim()) return [selectedRelease.id]
  const alignedReleaseId = slugify(stageAlignment)
  if (alignedReleaseId === selectedRelease.id || normalize(stageAlignment) === normalize(selectedRelease.label)) {
    return [selectedRelease.id]
  }
  // Do not manufacture a release record from a later-stage label. The selected
  // release owns current work; later alignment is enough to defer the task
  // until that release is explicitly defined or selected.
  return undefined
}

function normalizeDeliverableIdentity(value: string | undefined): string {
  return normalize(value ?? '').replace(/\s+/g, ' ').trim()
}

function repairConflictingSelectedReleaseMemberships(
  tasks: Array<Record<string, unknown>>,
  usedTaskIds: Set<string>,
  selectedRelease: SelectedRelease | null,
  now: string,
): ReintakeChange[] {
  if (!selectedRelease) return []
  return tasks
    .filter(task => {
      const id = stringField(task, 'id')
      if (!id || usedTaskIds.has(id)) return false
      if (!isOpenPreImplementationTask(task)) return false
      const releaseIds = arrayStringField(task.releaseIds)
      return releaseIds.includes(selectedRelease.id) && releaseIds.some(releaseId => releaseId !== selectedRelease.id)
    })
    .map(task => {
      const id = stringField(task, 'id') ?? ''
      const title = stringField(task, 'title') ?? id
      const releaseIds = arrayStringField(task.releaseIds).filter(releaseId => releaseId !== selectedRelease.id)
      return {
        kind: 'reframe' as const,
        taskId: id,
        before: {
          id,
          title,
          status: stringField(task, 'status') ?? 'unknown',
        },
        after: reintakeDraftFromExistingTask(task, {
          projectPath: stringField(task, 'projectPath'),
          releaseIds,
          status: reintakeDraftStatus(stringField(task, 'status')),
        }),
        reason: `Task was assigned to both ${selectedRelease.label} and ${releaseIds.join(', ')}; keep it out of the selected release until an explicit dependency or release boundary says otherwise.`,
      }
    })
}

function restoreSelectedReleaseImportsArchivedByReintake(
  tasks: Array<Record<string, unknown>>,
  usedTaskIds: Set<string>,
  selectedRelease: SelectedRelease | null,
  projectPath: string | undefined,
): ReintakeChange[] {
  if (!selectedRelease) return []
  return tasks
    .filter(task => {
      const id = stringField(task, 'id')
      if (!id || usedTaskIds.has(id)) return false
      if (stringField(task, 'status') !== 'archived') return false
      const releaseIds = arrayStringField(task.releaseIds)
      if (releaseIds.length !== 1 || releaseIds[0] !== selectedRelease.id) return false
      const archivedEvidence = task.archivedEvidence && typeof task.archivedEvidence === 'object' && !Array.isArray(task.archivedEvidence)
        ? task.archivedEvidence as Record<string, unknown>
        : null
      return archivedEvidence?.source === 'project-reintake' &&
        archivedEvidence?.code === 'unsupported_weak_preimplementation'
    })
    .map(task => {
      const id = stringField(task, 'id') ?? ''
      const title = stringField(task, 'title') ?? id
      return {
        kind: 'reframe' as const,
        taskId: id,
        before: {
          id,
          title,
          status: 'archived',
        },
        after: reintakeDraftFromExistingTask(task, {
          projectPath,
          releaseIds: [selectedRelease.id],
          status: 'import_draft',
        }),
        reason: `Restore source-backed selected-release work that was archived by stale-spec cleanup; ${selectedRelease.label} still owns the shaping decision.`,
      }
    })
}

function reintakeDraftStatus(value: string | undefined): ReintakeTaskDraft['status'] | undefined {
  return value === 'import_draft' || value === 'spec_review' || value === 'shelved'
    ? value
    : undefined
}

function reintakeDraftFromExistingTask(
  task: Record<string, unknown>,
  overrides: {
    projectPath?: string
    releaseIds?: string[]
    status?: ReintakeTaskDraft['status']
  } = {},
): ReintakeTaskDraft {
  const title = stringField(task, 'title') ?? stringField(task, 'id') ?? 'Imported work'
  return {
    id: stringField(task, 'id') ?? slugify(title),
    title,
    description: stringField(task, 'description') ?? title,
    ...(stringField(task, 'sourceIdentity') ? { sourceIdentity: stringField(task, 'sourceIdentity') } : {}),
    ...(stringField(task, 'deliverableName') ? { deliverableName: stringField(task, 'deliverableName') } : {}),
    ...(stringField(task, 'producedArtifact') ? { producedArtifact: stringField(task, 'producedArtifact') } : {}),
    ...(stringField(task, 'workShape') ? { workShape: stringField(task, 'workShape') as Task['workShape'] } : {}),
    ...(stringField(task, 'targetArea') ? { targetArea: stringField(task, 'targetArea') } : {}),
    ...(arrayStringField(task.buildsOn).length > 0 ? { buildsOn: arrayStringField(task.buildsOn) } : {}),
    ...(arrayStringField(task.consumerSurfaces).length > 0 ? { consumerSurfaces: arrayStringField(task.consumerSurfaces) } : {}),
    domain: stringField(task, 'domain') ?? 'planning',
    ...(overrides.projectPath ?? stringField(task, 'projectPath') ? { projectPath: overrides.projectPath ?? stringField(task, 'projectPath') } : {}),
    status: overrides.status ?? reintakeDraftStatus(stringField(task, 'status')) ?? 'import_draft',
    priority: priorityField(task.priority),
    dependsOn: arrayStringField(task.dependsOn),
    acceptanceCriteria: Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria as Task['acceptanceCriteria'] : [],
    references: arrayStringField(task.references),
    ...(Array.isArray(task.sourceClaims) ? { sourceClaims: task.sourceClaims as Task['sourceClaims'] } : {}),
    ...(stringField(task, 'semanticKind') ? { semanticKind: stringField(task, 'semanticKind') } : {}),
    ...(arrayStringField(task.contractNames).length > 0 ? { contractNames: arrayStringField(task.contractNames) } : {}),
    ...(overrides.releaseIds?.length ? { releaseIds: overrides.releaseIds } : {}),
    ...(stringField(task, 'stageAlignment') ? { stageAlignment: stringField(task, 'stageAlignment') } : {}),
    ...(stringField(task, 'spec') ? { spec: stringField(task, 'spec') } : {}),
    ...(task.productBrief ? { productBrief: task.productBrief as Task['productBrief'] } : {}),
    ...(task.proofPaths ? { proofPaths: task.proofPaths as Task['proofPaths'] } : {}),
  }
}

function taskPriorityFromString(value: string | undefined): ReintakeTaskDraft['priority'] {
  if (value === 'critical' || value === 'high' || value === 'normal' || value === 'low') return value
  return 'normal'
}

function archiveUnsupportedBlockedTasks(tasks: Array<Record<string, unknown>>, usedTaskIds: Set<string>): ReintakeChange[] {
  return tasks
    .filter(task => stringField(task, 'status') === 'blocked')
    .filter(task => {
      const id = stringField(task, 'id')
      if (!id || usedTaskIds.has(id)) return false
      const notes = Array.isArray(task.notes) ? task.notes : []
      return notes.length === 0
    })
    .map(task => ({
      kind: 'archive' as const,
      taskId: stringField(task, 'id') ?? '',
      reason: 'Blocked task has no current source evidence and no durable proof.',
    }))
}

function archiveUnsupportedWeakPreImplementationTasks(
  tasks: Array<Record<string, unknown>>,
  usedTaskIds: Set<string>,
  selectedRelease: SelectedRelease | null,
): ReintakeChange[] {
  return tasks
    .filter(task => {
      const id = stringField(task, 'id')
      if (!id || usedTaskIds.has(id)) return false
      if (!isOpenPreImplementationTask(task)) return false
      if (selectedRelease && arrayStringField(task.releaseIds).includes(selectedRelease.id)) return false
      return hasWeakLegacySpecShape(task)
    })
    .map(task => ({
      kind: 'archive' as const,
      taskId: stringField(task, 'id') ?? '',
      archiveCode: 'unsupported_weak_preimplementation',
      reason: 'Pre-implementation task is unsupported by current evidence and still uses a weak legacy spec shape.',
    }))
}

function summarize(groups: ReintakeChangeGroup[]): ProjectReintakeDraft['summary'] {
  const summary = { kept: 0, reframed: 0, merged: 0, archived: 0, created: 0, preservedDone: 0, refreshedEvidence: 0, repairedDependencies: 0 }
  for (const change of groups.flatMap(group => group.changes)) {
    if (change.kind === 'keep') summary.kept++
    if (change.kind === 'reframe') summary.reframed++
    if (change.kind === 'merge') summary.merged++
    if (change.kind === 'archive') summary.archived++
    if (change.kind === 'create') summary.created++
    if (change.kind === 'preserve_progress') summary.preservedDone++
    if (change.kind === 'refresh_evidence') summary.refreshedEvidence++
    if (change.kind === 'repair_dependencies') summary.repairedDependencies++
  }
  return summary
}

export function fingerprint(tasks: Array<Record<string, unknown>>): string {
  return stableHash(JSON.stringify(tasks.map(task => ({
    id: task.id,
    title: task.title,
    status: task.status,
    updatedAt: task.updatedAt,
  }))))
}

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' ? value : undefined
}

function taskIdForChange(change: ReintakeChange): string | undefined {
  if ('taskId' in change && typeof change.taskId === 'string') return change.taskId
  return change.kind === 'create' && typeof change.task.id === 'string' ? change.task.id : undefined
}

function arrayStringField(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function priorityField(value: unknown): ReintakeTaskDraft['priority'] {
  return value === 'critical' || value === 'high' || value === 'normal' || value === 'low'
    ? value
    : 'normal'
}

function structuralRepairTitle(originalTitle: string): string {
  if (/^recover\b/i.test(originalTitle)) return originalTitle
  return `Recover source-backed contract surface for ${originalTitle.replace(/^implement\s+/i, '')}`
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function slugify(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function stripInlineCode(value: string): string {
  return value.replace(/`([^`]+)`/g, '$1')
}

function isStartedOrCompletedTask(task: Record<string, unknown>): boolean {
  const status = stringField(task, 'status') ?? ''
  return ['done', 'in_progress', 'review', 'gate_check', 'pending_pr'].includes(status)
}

function isTerminalTask(task: Record<string, unknown>): boolean {
  const status = stringField(task, 'status') ?? ''
  return ['done', 'archived', 'cancelled'].includes(status)
}

function isOpenPreImplementationTask(task: Record<string, unknown>): boolean {
  const status = stringField(task, 'status') ?? ''
  return ['import_draft', 'exploring', 'spec_review', 'ready'].includes(status)
}

function hasWeakLegacySpecShape(task: Record<string, unknown>): boolean {
  if (hasStructuredSpecRecord(task)) return false

  const spec = stringField(task, 'spec')
  const acceptanceCriteria = Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : []
  const brief = task.productBrief && typeof task.productBrief === 'object' && !Array.isArray(task.productBrief)
    ? task.productBrief as Record<string, unknown>
    : null
  const hasBriefShape = typeof brief?.userJob === 'string' && brief.userJob.trim().length > 0
    && typeof brief?.whyItMattersNow === 'string' && brief.whyItMattersNow.trim().length > 0
    && typeof brief?.successMetric === 'string' && brief.successMetric.trim().length > 0

  if (!spec?.trim()) {
    return true
  }

  if (!markdownLooksLikeModernSpec(spec)) {
    return true
  }

  if (!hasBriefShape || acceptanceCriteria.length === 0) {
    return true
  }

  return false
}

function hasStructuredSpecRecord(task: Record<string, unknown>): boolean {
  const value = task.structuredSpec
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function markdownLooksLikeModernSpec(spec: string): boolean {
  const headings = [
    /^## What this is$/im,
    /^## Problem \/ context$/im,
    /^## Goals$/im,
    /^## Non-goals$/im,
    /^## Proposed design$/im,
    /^## Key decisions$/im,
    /^## Acceptance criteria$/im,
    /^## Verification$/im,
    /^## Completion boundary$/im,
  ]
  const matchCount = headings.filter(pattern => pattern.test(spec)).length
  return matchCount >= 6
}

function stableHash(input: string): string {
  let h = 0x811c9dc5
  for (const ch of input) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}
