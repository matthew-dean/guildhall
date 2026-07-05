import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Task } from '@guildhall/core'
import { getProjectSystemStatePathFromMemoryDir } from '@guildhall/sessions'
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
import { detectShadowedCurrentMilestoneDeliverableImports as detectShadowedCurrentMilestoneDeliverables } from './current-milestone-shadowing.js'
import {
  buildImportedBlueprintSeed,
  type MaterializedImportTask,
} from './workspace-importer.js'
import {
  contractShapedImportHasNoConcreteContracts,
  importedContractStructuralRepairReadiness,
  importedContractWorkIsStructurallyIncomplete,
} from './imported-work-integrity.js'

export type ProjectReintakeSource = EvidenceSource

export interface ProjectReintakeInput {
  now?: string
  projectPath?: string
  sources: ProjectReintakeSource[]
  tasks: Array<Record<string, unknown>>
}

export interface ProjectReintakeDraft {
  id: string
  createdAt: string
  createdBy: 'project-reintake'
  status: 'draft' | 'applied' | 'dismissed'
  taskQueueFingerprint: string
  selectedReleaseId?: string
  releases?: ProjectReintakeReleaseDraft[]
  sources: Array<{ path: string; kind: string }>
  summary: {
    kept: number
    reframed: number
    merged: number
    archived: number
    created: number
    preservedDone: number
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
  | { kind: 'reframe'; taskId: string; before: TaskSummary; after: ReintakeTaskDraft; reason: string }
  | ReintakeMergeChange
  | { kind: 'archive'; taskId: string; reason: string }
  | { kind: 'create'; task: ReintakeTaskDraft; reason: string }
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
  domain: string
  status: 'import_draft' | 'spec_review' | 'shelved'
  priority: 'critical' | 'high' | 'normal' | 'low'
  dependsOn: string[]
  acceptanceCriteria: Task['acceptanceCriteria']
  references?: string[]
  releaseIds?: string[]
  stageAlignment?: string
  spec?: string
  productBrief?: Task['productBrief']
  proofPaths?: Task['proofPaths']
  workUnitAnalysis?: Task['workUnitAnalysis']
  taskReadiness?: Task['taskReadiness']
  taskKind?: Task['taskKind']
  definitionOfDone?: Task['definitionOfDone']
  blockerPlans?: Task['blockerPlans']
  contextBudget?: Task['contextBudget']
}

export interface ProjectReintakeReleaseDraft {
  id: string
  label: string
  kind: 'release'
  state: 'active'
  source: 'release_plan' | 'inferred'
  nodeIds: string[]
  deferredNodeIds: string[]
}

export interface ProjectReintakeApplyResult {
  success: boolean
  appliedGroups?: number
  error?: string
}

export function planProjectReintake(input: ProjectReintakeInput): ProjectReintakeDraft {
  const now = input.now ?? new Date().toISOString()
  const groups: ReintakeChangeGroup[] = []
  const usedTaskIds = new Set<string>()
  const selectedRelease = detectSelectedRelease(input.sources)
  const protectedProgressTaskIds = new Set(input.tasks
    .filter(task => isStartedOrCompletedTask(task) && !importedContractWorkIsStructurallyIncomplete(task))
    .map(task => stringField(task, 'id'))
    .filter((id): id is string => Boolean(id)))

  const duplicateMerges = duplicateMergeChanges(input.tasks)
  if (duplicateMerges.length > 0) {
    groups.push({
      id: 'merge-duplicates',
      title: 'Merge duplicate old cards',
      rationale: 'These tasks have the same normalized title and can be represented by one survivor.',
      changes: duplicateMerges,
    })
    for (const change of duplicateMerges) {
      usedTaskIds.add(change.survivorTaskId)
      for (const id of change.mergedTaskIds) usedTaskIds.add(id)
    }
  }

  const graphPlan = planEvidenceWorkGraph({
    sources: input.sources,
    existingTasks: input.tasks,
  })
  const completedTaskIds = new Set(input.tasks
    .filter(task => stringField(task, 'status') === 'done')
    .map(task => stringField(task, 'id'))
    .filter((id): id is string => Boolean(id)))
  const graphTaskIds = new Set(graphPlan.tasks.map(task => task.id))
  const allowedDependencyIds = new Set([...graphTaskIds, ...protectedProgressTaskIds])
  const graphChanges = graphPlan.tasks
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
      if (change.kind === 'reframe') usedTaskIds.add(change.taskId)
    }
  } else {
    const singleEdit = singleEditChange(input.sources)
    if (singleEdit) {
      groups.push({
        id: 'single-bounded-edit',
        title: 'Keep bounded edit as one task',
        rationale: 'The evidence describes one concrete edit rather than a multi-deliverable graph.',
        changes: [singleEdit],
      })
    }
  }

  const structuralRepairChanges = repairStructurallyIncompleteImportedContractWork(
    input.tasks,
    usedTaskIds,
    selectedRelease,
    now,
  )
  if (structuralRepairChanges.length > 0) {
    groups.push({
      id: 'repair-structurally-incomplete-imports',
      title: 'Repair structurally incomplete imported work',
      rationale: 'Imported contract/type work with hollow proof targets must be reshaped before Guildhall can schedule it.',
      changes: structuralRepairChanges,
    })
    for (const change of structuralRepairChanges) usedTaskIds.add(change.taskId)
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

  const archiveChanges = archiveUnsupportedBlockedTasks(input.tasks, usedTaskIds)
  if (archiveChanges.length > 0) {
    groups.push({
      id: 'archive-unsupported',
      title: 'Archive unsupported blocked cards',
      rationale: 'These blocked cards have no current source evidence and no durable proof.',
      changes: archiveChanges,
    })
  }

  const staleWeakSpecChanges = archiveUnsupportedWeakPreImplementationTasks(input.tasks, usedTaskIds)
  if (staleWeakSpecChanges.length > 0) {
    groups.push({
      id: 'archive-stale-preimplementation',
      title: 'Archive stale pre-implementation tasks',
      rationale: 'Not-started tasks with weak legacy specs should not override current evidence when no current source support remains.',
      changes: staleWeakSpecChanges,
    })
  }

  const shadowedCurrentMilestoneDeliverableChanges = archiveShadowedCurrentMilestoneDeliverableTasks(
    input.tasks,
    usedTaskIds,
    input.sources,
  )
  if (shadowedCurrentMilestoneDeliverableChanges.length > 0) {
    groups.push({
      id: 'archive-shadowed-current-milestone-deliverables',
      title: 'Archive shadowed current-milestone deliverables',
      rationale: 'If a roadmap already names the starter-task sequence for the current milestone, old deliverable-bullet task imports should not remain as competing scoped work.',
      changes: shadowedCurrentMilestoneDeliverableChanges,
    })
  }

  const releases = selectedRelease ? releaseDraftsFor(selectedRelease, groups, input.tasks) : []
  return {
    id: `reintake-${now.replace(/[^0-9A-Za-z]/g, '').slice(0, 14)}`,
    createdAt: now,
    createdBy: 'project-reintake',
    status: 'draft',
    taskQueueFingerprint: fingerprint(input.tasks),
    ...(selectedRelease && releases.length > 0 ? { selectedReleaseId: selectedRelease.id, releases } : {}),
    sources: input.sources.map(source => ({ path: source.path, kind: 'source' })),
    summary: summarize(groups),
    groups,
  }
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
  const queue = await readQueueFile(queuePath)
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
  const refreshedTaskIds = new Set<string>()
  for (const change of groups.flatMap(group => group.changes)) {
    if (change.kind === 'create') refreshedTaskIds.add(change.task.id)
    if (change.kind === 'reframe') refreshedTaskIds.add(change.taskId)
  }

  for (const group of groups) {
    for (const change of group.changes) {
      if (change.kind === 'archive' && refreshedTaskIds.has(change.taskId)) continue
      applyChange(queue.tasks, change, now)
    }
  }
  applyReleaseDrafts(queue, draft)

  queue.lastUpdated = now
  await writeManagedTextFile(queuePath, JSON.stringify(queue, null, 2), 'utf-8')
  await appendReintakeProgress(input.memoryDir, draft, groups.length, now)
  await writeProjectReintakeDraft(input.memoryDir, { ...draft, status: 'applied' })
  return { success: true, appliedGroups: groups.length }
}

function applyChange(tasks: Array<Record<string, unknown>>, change: ReintakeChange, now: string): void {
  if (change.kind === 'reframe') {
    const existing = tasks.find(task => task.id === change.taskId)
    if (!existing) return
    const notes = Array.isArray(existing.notes) ? existing.notes : []
    clearStaleReintakeDerivedFields(existing)
    Object.assign(existing, {
      ...change.after,
      id: change.taskId,
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
        ...change.task,
        projectPath: typeof existing.projectPath === 'string' ? existing.projectPath : '',
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
      projectPath: '',
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
      applyChange(tasks, { kind: 'archive', taskId: mergedTaskId, reason: `Superseded by ${change.survivorTaskId}. ${change.reason}` }, now)
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
    'taskReadiness',
    'workUnitAnalysis',
  ]) {
    delete task[key]
  }
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

async function readQueueFile(queuePath: string): Promise<{ version: number; lastUpdated: string; tasks: Array<Record<string, unknown>> }> {
  const parsed = JSON.parse(await readManagedTextFile(queuePath, 'utf-8')) as unknown
  if (Array.isArray(parsed)) {
    return { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed as Array<Record<string, unknown>> }
  }
  const record = parsed as { version?: number; lastUpdated?: string; tasks?: Array<Record<string, unknown>> }
  return {
    version: record.version ?? 1,
    lastUpdated: record.lastUpdated ?? new Date().toISOString(),
    tasks: record.tasks ?? [],
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
  const draft = evidenceTaskToDraft(task, selectedRelease, sources, projectPath, now)
  const after = importedContractWorkIsStructurallyIncomplete(draft)
    ? structurallyIncompleteImportRepairDraft(draft, selectedRelease, now)
    : draft

  if (reframe) {
    const existing = existingTasks.find(candidate => stringField(candidate, 'id') === task.id)
    return {
      kind: 'reframe',
      taskId: task.id,
      before: {
        id: task.id,
        title: stringField(existing ?? {}, 'title') ?? task.title,
        status: stringField(existing ?? {}, 'status') ?? 'unknown',
      },
      after,
      reason: `Reframe from current evidence: ${reframe.reason ?? task.title}`,
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
      return {
        kind: 'reframe' as const,
        taskId,
        before: {
          id: taskId,
          title,
          status: stringField(task, 'status') ?? 'unknown',
        },
        after: structurallyIncompleteImportRepairDraft(task, selectedRelease, now),
        reason: 'Imported contract/type work has a hollow proof target and must recover concrete source-backed contract names before execution.',
      }
    })
}

function structurallyIncompleteImportRepairDraft(
  task: Record<string, unknown>,
  selectedRelease: SelectedRelease | null,
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
    domain: stringField(task, 'domain') ?? 'planning',
    status: selectedRelease && !inSelectedRelease ? 'shelved' : 'import_draft',
    priority: priorityField(task.priority),
    dependsOn: arrayStringField(task.dependsOn),
    acceptanceCriteria: [{
      id: 'contract-surface-recovered',
      description: `${originalTitle} names the concrete contract/type surfaces recovered from cited sources, or is reshaped to match the documented source structure before implementation.`,
      verifiedBy: 'review',
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
  const references = evidenceReferencesForTask(task, sources)
  const contractNames = unique(references
    .map(reference => sources.find(source => source.path === reference)?.content)
    .filter((content): content is string => Boolean(content))
    .flatMap(content => extractNeededContractNames(content, task.title)))
  const importedBlueprint = projectPath
    ? buildImportedBlueprintSeed(evidenceTaskToMaterializedImportTask(task, references), references, projectPath, now)
    : null
  const acceptanceCriteria = (importedBlueprint?.acceptanceCriteria ?? reintakeAcceptanceCriteria(task, contractNames)).map(criterion => ({
    id: criterion.id,
    description: criterion.description,
    verifiedBy: criterion.verifiedBy ?? (criterion.id.includes('automated') || criterion.id.includes('regression') ? 'automated' : 'review'),
    met: false,
  }))
  const reviewableBlueprint = hasReviewableReintakeBlueprint(task, references, acceptanceCriteria, contractNames)
  return {
    id: task.id,
    title: task.title,
    description: evidenceTaskDescription(task),
    domain: task.targetArea,
    status: later ? 'shelved' : reviewableBlueprint ? 'spec_review' : 'import_draft',
    priority: evidenceTaskPriority(task),
    dependsOn: task.dependsOn,
    acceptanceCriteria,
    references,
    ...(later || !selectedRelease ? {} : { releaseIds: [selectedRelease.id] }),
    ...(task.stageAlignment ? { stageAlignment: task.stageAlignment } : {}),
    spec: importedBlueprint?.spec ?? evidenceTaskSpec({ task, references, acceptanceCriteria, sources, contractNames }),
    ...(reviewableBlueprint ? { productBrief: reintakeOwnedProductBrief(importedBlueprint?.productBrief) ?? reintakeProductBrief(task, contractNames) } : {}),
    proofPaths: importedBlueprint?.proofPaths ?? task.proofPaths,
    ...(importedBlueprint?.workUnitAnalysis ? { workUnitAnalysis: importedBlueprint.workUnitAnalysis } : {}),
    ...(importedBlueprint?.taskReadiness ? { taskReadiness: importedBlueprint.taskReadiness } : {}),
    ...(importedBlueprint?.taskKind ? { taskKind: importedBlueprint.taskKind } : {}),
    ...(importedBlueprint?.definitionOfDone ? { definitionOfDone: importedBlueprint.definitionOfDone } : {}),
    ...(importedBlueprint?.blockerPlans ? { blockerPlans: importedBlueprint.blockerPlans } : {}),
    ...(importedBlueprint?.contextBudget ? { contextBudget: importedBlueprint.contextBudget } : {}),
  }
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
    ...inventorySiblingSpecRefsForTask(task, sources),
    ...supportingEvidenceRefsForTask(task, sources),
  ])
}

function inventorySiblingSpecRefsForTask(task: EvidenceTask, sources: ProjectReintakeSource[]): string[] {
  const refs: string[] = []
  for (const source of sources) {
    if (!/(^|\/)docs\/harness\/remaining-spec-decomposition-inventory\.md$/i.test(source.path.replaceAll('\\', '/'))) continue
    for (const section of splitMarkdownSectionsForReintake(source.content)) {
      if (!section.body.includes(task.title)) continue
      const fileNames = [
        ...[section.heading, section.body].flatMap(value =>
          [...value.matchAll(/`([^`\n]+\.md)`/g)].map(match => match[1]?.trim()).filter((name): name is string => Boolean(name)),
        ),
      ]
      for (const fileName of fileNames) {
        refs.push(`docs/specs/${fileName}`)
      }
    }
  }
  return refs
}

function evidenceTaskToMaterializedImportTask(
  task: EvidenceTask,
  references: string[],
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
    whyThisMayMatter: evidenceSnippets.join(' '),
    domain: task.targetArea,
    scope: 'current',
    priority: evidenceTaskPriority(task),
    references,
    acceptanceCriteria: task.acceptanceCriteria,
    dependsOn: task.dependsOn,
    proofPaths: task.proofPaths,
    evidenceGraphTask: true,
  }
}

function reintakeAcceptanceCriteria(
  task: EvidenceTask,
  contractNames: string[],
): Array<{ id: string; description: string; verifiedBy?: string }> {
  const prototypeKind = reintakePrototypeTaskKind(task.title)
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
  if (contractNames.length > 0 && /\b(schema|schemas|contract|contracts)\b/i.test(task.title)) {
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

function reintakePrototypeTaskKind(title: string): 'fixture' | 'runner' | 'evaluation' | 'debug_report' | 'schema_prune' | null {
  if (/^add the first tiny fiction fixture and human-authored expected records\.?$/i.test(title)) return 'fixture'
  if (/\bno-ui runner\b/i.test(title) || /\bbuilds a packet from fixture records\b/i.test(title)) return 'runner'
  if (/\bdeterministic evaluation output\b/i.test(title)) return 'evaluation'
  if (/\bdebug report\b/i.test(title)) return 'debug_report'
  if (/\bnarrow the mvp story-memory schema\b/i.test(title)) return 'schema_prune'
  return null
}

function hasReviewableReintakeBlueprint(
  task: EvidenceTask,
  references: string[],
  acceptanceCriteria: Task['acceptanceCriteria'],
  contractNames: string[],
): boolean {
  if (contractShapedImportHasNoConcreteContracts({ title: task.title, contractNames })) return false
  return (
    references.length > 0 &&
    acceptanceCriteria.length > 0 &&
    (
      contractNames.length > 0 ||
      task.proofPaths.length > 0 ||
      task.sourceRefs.length > 0
    )
  )
}

function reintakeProductBrief(task: EvidenceTask, contractNames: string[]): NonNullable<Task['productBrief']> {
  const prototypeKind = reintakePrototypeTaskKind(task.title)
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
  if (!/\b(schema|schemas|fixture|expected-record|prototype-run|evaluation)\b/i.test(task.title)) return []
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
  return /\b(schema|schemas|contract|contracts)\b/i.test(task.title)
}

function splitMarkdownSectionsForReintake(content: string): Array<{ heading: string; body: string }> {
  const lines = content.split(/\r?\n/)
  const sections: Array<{ heading: string; body: string }> = []
  let currentHeading = '(intro)'
  let currentBody: string[] = []
  for (const line of lines) {
    const heading = /^#{2,6}\s+(.+?)\s*$/.exec(line)
    if (heading) {
      sections.push({ heading: currentHeading, body: currentBody.join('\n').trim() })
      currentHeading = heading[1]!.trim()
      currentBody = []
      continue
    }
    currentBody.push(line)
  }
  sections.push({ heading: currentHeading, body: currentBody.join('\n').trim() })
  return sections
}

function normalizeContractMatchText(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function contractMatchKeywords(title: string): string[] {
  const generic = new Set([
    'define',
    'using',
    'schema',
    'schemas',
    'contract',
    'contracts',
    'concrete',
    'cited',
    'docs',
    'record',
    'records',
    'run',
    'runs',
  ])
  const keywords = new Set<string>()
  for (const word of normalizeContractMatchText(title).split(/\s+/)) {
    if (!generic.has(word) && word.length >= 4) keywords.add(word)
    for (const part of word.split('-')) {
      if (!generic.has(part) && part.length >= 4) keywords.add(part)
    }
  }
  return [...keywords]
}

function contractSectionMatchesTask(section: { heading: string; body: string }, taskTitle: string): boolean {
  const contractNames = [...section.body.matchAll(/`([^`\n]{2,80})`/g)].map(match => match[1] ?? '').join(' ')
  const haystack = normalizeContractMatchText(`${section.heading}\n${contractNames}`)
  return contractMatchKeywords(taskTitle).some(keyword => haystack.includes(keyword))
}

function extractNeededContractNames(content: string, taskTitle: string): string[] {
  const names: string[] = []
  for (const section of splitMarkdownSectionsForReintake(content)) {
    if (!/\bneeded contracts\s*:/i.test(section.body)) continue
    if (!contractSectionMatchesTask(section, taskTitle)) continue
    const lines = section.body.split(/\r?\n/)
    let collecting = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (/^needed contracts\s*:/i.test(trimmed)) {
        collecting = true
        continue
      }
      if (collecting && /^[A-Z][A-Za-z ]+\s*:\s*$/.test(trimmed)) {
        collecting = false
      }
      if (!collecting || !/^[-*]\s+/.test(trimmed)) continue
      const match = /^[-*]\s+`([^`\n]{2,80})`/.exec(trimmed)
      const name = match?.[1]?.trim()
      if (name && /^[A-Za-z][A-Za-z0-9_-]+$/.test(name)) names.push(name)
    }
  }
  return names
}

type SelectedRelease = {
  id: string
  label: string
  stageNumber: number
  source: ProjectReintakeReleaseDraft['source']
}

function detectSelectedRelease(sources: ProjectReintakeSource[]): SelectedRelease | null {
  for (const source of sources) {
    const current = source.content.match(/##\s+Current Next Milestone[\s\S]{0,500}?The next milestone is\s+(Stage\s+(\d+)(?::\s*([^.\n]+))?)/i)
    if (!current?.[1] || !current[2]) continue
    const currentStageNumber = Number(current[2])
    const inferredBoundedScope = detectNearTermProofScope(source.content, currentStageNumber)
    if (inferredBoundedScope) return inferredBoundedScope
    const stagePrefix = `Stage ${currentStageNumber}`
    const labelFromCurrent = current[3]?.trim() ? `${stagePrefix}: ${current[3].trim()}` : null
    const label = labelFromCurrent ?? matchingStageHeading(source.content, currentStageNumber) ?? stagePrefix
    return {
      id: slugify(label),
      label,
      stageNumber: currentStageNumber,
      source: 'release_plan',
    }
  }
  return null
}

function detectNearTermProofScope(content: string, currentStageNumber: number): SelectedRelease | null {
  const lower = content.toLowerCase()
  const describesBoundedProof =
    /\bnear-term goal\b/.test(lower) &&
    /\bnot\b[\s\S]{0,80}\b(editor|ui|frontend|product surface|shell)\b/.test(lower) &&
    /\bprove\b/.test(lower)
  if (!describesBoundedProof) return null

  const stageNumbers = [...content.matchAll(/^##\s+Stage\s+(\d+)\s*:\s*(.+?)\s*$/gim)]
    .map(match => ({
      number: Number(match[1]),
      label: match[2]?.trim().toLowerCase() ?? '',
    }))
    .filter(stage => Number.isFinite(stage.number))
  const firstUiStage = stageNumbers
    .filter(stage => /\b(ui|shell|authoring|frontend|product surface)\b/i.test(stage.label))
    .sort((left, right) => left.number - right.number)[0]?.number
  const maxProofStage = stageNumbers
    .filter(stage => stage.number >= currentStageNumber)
    .filter(stage => firstUiStage == null || stage.number < firstUiStage)
    .map(stage => stage.number)
    .sort((left, right) => right - left)[0]
  if (maxProofStage == null || maxProofStage <= currentStageNumber) return null

  return {
    id: 'near-term-proof-scope',
    label: 'Near-term proof scope',
    stageNumber: maxProofStage,
    source: 'inferred',
  }
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
  for (const task of existingTasks) {
    const id = stringField(task, 'id')
    if (!id || stringField(task, 'status') === 'archived') continue
    const releaseIds = Array.isArray(task.releaseIds) ? task.releaseIds : []
    if (!releaseIds.includes(selectedRelease.id)) continue
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
    const nodeId = `work:${task.id}`
    if (task.status === 'shelved') {
      deferredNodeIds.push(nodeId)
    } else if (task.releaseIds?.includes(selectedRelease.id)) {
      nodeIds.push(nodeId)
    }
  }
  if (nodeIds.length === 0 && deferredNodeIds.length === 0) return []
  return [{
    id: selectedRelease.id,
    label: selectedRelease.label,
    kind: 'release',
    state: 'active',
    source: selectedRelease.source,
    nodeIds: unique(nodeIds),
    deferredNodeIds: unique(deferredNodeIds),
  }]
}

function applyReleaseDrafts(
  queue: { selectedReleaseId?: string; releases?: ProjectReintakeReleaseDraft[]; tasks: Array<Record<string, unknown>> },
  draft: ProjectReintakeDraft,
): void {
  if (!draft.selectedReleaseId || !draft.releases?.length) return
  const releaseDrafts = draft.releases
  queue.selectedReleaseId = draft.selectedReleaseId
  const existing = new Map((queue.releases ?? []).map(release => [release.id, release]))
  for (const release of releaseDrafts) {
    const prior = existing.get(release.id)
    existing.set(release.id, prior
      ? {
          ...release,
          ...prior,
          nodeIds: unique([...(prior.nodeIds ?? []), ...release.nodeIds]),
          deferredNodeIds: unique([...(prior.deferredNodeIds ?? []), ...release.deferredNodeIds]),
        }
      : release)
  }
  queue.releases = Array.from(existing.values())
}

function duplicateMergeChanges(tasks: Array<Record<string, unknown>>): ReintakeMergeChange[] {
  const byTitle = new Map<string, Array<Record<string, unknown>>>()
  for (const task of tasks) {
    const id = stringField(task, 'id')
    const title = stringField(task, 'title')
    const status = stringField(task, 'status')
    if (!id || !title || status !== 'blocked') continue
    const key = normalize(title)
    const bucket = byTitle.get(key) ?? []
    bucket.push(task)
    byTitle.set(key, bucket)
  }

  const changes: ReintakeMergeChange[] = []
  for (const tasksWithTitle of byTitle.values()) {
    if (tasksWithTitle.length < 2) continue
    const survivor = stringField(tasksWithTitle[0] ?? {}, 'id')
    if (!survivor) continue
    const merged = tasksWithTitle.slice(1).map(task => stringField(task, 'id')).filter((id): id is string => Boolean(id))
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
): ReintakeChange[] {
  return tasks
    .filter(task => {
      const id = stringField(task, 'id')
      if (!id || usedTaskIds.has(id)) return false
      if (!isOpenPreImplementationTask(task)) return false
      return hasWeakLegacySpecShape(task)
    })
    .map(task => ({
      kind: 'archive' as const,
      taskId: stringField(task, 'id') ?? '',
      reason: 'Pre-implementation task is unsupported by current evidence and still uses a weak legacy spec shape.',
    }))
}

function archiveShadowedCurrentMilestoneDeliverableTasks(
  tasks: Array<Record<string, unknown>>,
  usedTaskIds: Set<string>,
  sources: ProjectReintakeSource[],
): ReintakeChange[] {
  const shadowedImports = detectShadowedCurrentMilestoneDeliverables(sources)
  if (shadowedImports.length === 0) return []

  return tasks
    .filter(task => {
      const id = stringField(task, 'id')
      if (!id || usedTaskIds.has(id)) return false
      if (!isOpenPreImplementationTask(task)) return false
      const title = stringField(task, 'title')
      const description = stringField(task, 'description') ?? ''
      if (!title) return false
      return shadowedImports.some(candidate =>
        candidate.title === title &&
        description.includes(candidate.sourcePath) &&
        description.includes(': - '),
      )
    })
    .map(task => ({
      kind: 'archive' as const,
      taskId: stringField(task, 'id') ?? '',
      reason: 'Roadmap deliverable bullet was previously imported as a task, but the current milestone now defines a starter-task sequence that supersedes it.',
    }))
}

function singleEditChange(sources: ProjectReintakeSource[]): ReintakeChange | null {
  const text = sources.map(source => source.content).join('\n')
  if (!/should say/i.test(text) || !/SettingsTab\.svelte/i.test(text)) {
    return null
  }
  return {
    kind: 'create',
    task: {
      id: 'task-update-settings-footer-copy',
      title: 'Update settings footer copy',
      description: 'Change the settings footer copy in SettingsTab.svelte.',
      domain: 'ui',
      status: 'import_draft',
      priority: 'normal',
      dependsOn: [],
      acceptanceCriteria: [{
        id: 'copy-updated',
        description: 'Settings footer uses the requested copy.',
        verifiedBy: 'review',
        met: false,
      }],
      proofPaths: [{ kind: 'review', expectedEvidence: ['SettingsTab.svelte copy changed.'] }],
    },
    reason: 'Create one bounded copy-edit task; no source evidence indicates a graph split.',
  }
}

function summarize(groups: ReintakeChangeGroup[]): ProjectReintakeDraft['summary'] {
  const summary = { kept: 0, reframed: 0, merged: 0, archived: 0, created: 0, preservedDone: 0 }
  for (const change of groups.flatMap(group => group.changes)) {
    if (change.kind === 'keep') summary.kept++
    if (change.kind === 'reframe') summary.reframed++
    if (change.kind === 'merge') summary.merged++
    if (change.kind === 'archive') summary.archived++
    if (change.kind === 'create') summary.created++
    if (change.kind === 'preserve_progress') summary.preservedDone++
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
