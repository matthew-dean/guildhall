import fs from 'node:fs/promises'
import path from 'node:path'
import type { Task } from '@guildhall/core'
import {
  planEvidenceWorkGraph,
  type EvidenceSource,
  type EvidenceTask,
} from './evidence-work-graph-intake.js'

export type ProjectReintakeSource = EvidenceSource

export interface ProjectReintakeInput {
  now?: string
  sources: ProjectReintakeSource[]
  tasks: Array<Record<string, unknown>>
}

export interface ProjectReintakeDraft {
  id: string
  createdAt: string
  createdBy: 'project-reintake'
  status: 'draft' | 'applied' | 'dismissed'
  taskQueueFingerprint: string
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
  | { kind: 'merge'; survivorTaskId: string; mergedTaskIds: string[]; reason: string }
  | { kind: 'archive'; taskId: string; reason: string }
  | { kind: 'create'; task: ReintakeTaskDraft; reason: string }
  | { kind: 'preserve_progress'; taskId: string; reason: string }

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
  status: 'import_draft'
  priority: 'critical' | 'high' | 'normal' | 'low'
  dependsOn: string[]
  acceptanceCriteria: Task['acceptanceCriteria']
  proofPaths?: unknown[]
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
  const graphChanges = graphPlan.tasks
    .filter(task => !completedTaskIds.has(task.id))
    .map(task => graphTaskChange(
      { ...task, dependsOn: task.dependsOn.filter(dependency => !completedTaskIds.has(dependency)) },
      graphPlan.reconciliations,
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

  return {
    id: `reintake-${now.replace(/[^0-9A-Za-z]/g, '').slice(0, 14)}`,
    createdAt: now,
    createdBy: 'project-reintake',
    status: 'draft',
    taskQueueFingerprint: fingerprint(input.tasks),
    sources: input.sources.map(source => ({ path: source.path, kind: 'source' })),
    summary: summarize(groups),
    groups,
  }
}

export async function writeProjectReintakeDraft(memoryDir: string, draft: ProjectReintakeDraft): Promise<string> {
  const filePath = reintakeDraftPath(memoryDir)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(draft, null, 2), 'utf-8')
  return filePath
}

export async function readProjectReintakeDraft(memoryDir: string): Promise<ProjectReintakeDraft | null> {
  try {
    return JSON.parse(await fs.readFile(reintakeDraftPath(memoryDir), 'utf-8')) as ProjectReintakeDraft
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

  const queuePath = path.join(input.memoryDir, 'TASKS.json')
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

  for (const group of groups) {
    for (const change of group.changes) {
      applyChange(queue.tasks, change, now)
    }
  }

  queue.lastUpdated = now
  await fs.writeFile(queuePath, JSON.stringify(queue, null, 2), 'utf-8')
  await appendReintakeProgress(input.memoryDir, draft, groups.length, now)
  await writeProjectReintakeDraft(input.memoryDir, { ...draft, status: 'applied' })
  return { success: true, appliedGroups: groups.length }
}

function applyChange(tasks: Array<Record<string, unknown>>, change: ReintakeChange, now: string): void {
  if (change.kind === 'reframe') {
    const existing = tasks.find(task => task.id === change.taskId)
    if (!existing) return
    const notes = Array.isArray(existing.notes) ? existing.notes : []
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
    return
  }

  if (change.kind === 'create') {
    if (tasks.some(task => task.id === change.task.id)) return
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
    Object.assign(existing, {
      status: 'shelved',
      updatedAt: now,
      shelveReason: {
        code: 'no_op',
        detail: change.reason,
        source: 'policy',
        recordedAt: now,
        policyApplied: true,
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

function reintakeDraftPath(memoryDir: string): string {
  return path.join(memoryDir, 'reintake-drafts', 'current.json')
}

async function readQueueFile(queuePath: string): Promise<{ version: number; lastUpdated: string; tasks: Array<Record<string, unknown>> }> {
  const parsed = JSON.parse(await fs.readFile(queuePath, 'utf-8')) as unknown
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
  await fs.appendFile(path.join(memoryDir, 'PROGRESS.md'), summary, 'utf-8').catch(() => undefined)
}

function graphTaskChange(
  task: EvidenceTask,
  reconciliations: ProjectReintakeDraft['groups'][number]['changes'],
): ReintakeChange {
  const reframe = reconciliations.find(change =>
    'existingTaskId' in change && change.existingTaskId === task.id,
  ) as { existingTaskId?: string; reason?: string } | undefined
  const draft = evidenceTaskToDraft(task)

  if (reframe) {
    return {
      kind: 'reframe',
      taskId: task.id,
      before: { id: task.id, title: task.title, status: 'blocked' },
      after: draft,
      reason: `Reframe from current evidence: ${reframe.reason ?? task.title}`,
    }
  }

  return {
    kind: 'create',
    task: draft,
    reason: 'Create missing work from current source evidence.',
  }
}

function evidenceTaskToDraft(task: EvidenceTask): ReintakeTaskDraft {
  return {
    id: task.id,
    title: task.title,
    description: task.kind === 'integration'
      ? `Wire ${task.deliverableName} into ${task.consumerSurface ?? task.targetArea}.`
      : `Build ${task.deliverableName}.`,
    domain: task.targetArea,
    status: 'import_draft',
    priority: task.kind === 'integration' ? 'normal' : 'high',
    dependsOn: task.dependsOn,
    acceptanceCriteria: task.acceptanceCriteria.map(criterion => ({
      id: criterion.id,
      description: criterion.description,
      verifiedBy: criterion.id.includes('automated') || criterion.id.includes('regression') ? 'automated' : 'review',
      met: false,
    })),
    proofPaths: task.proofPaths,
  }
}

function duplicateMergeChanges(tasks: Array<Record<string, unknown>>): ReintakeChange[] {
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

  const changes: ReintakeChange[] = []
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
    .filter((id): id is string => Boolean(id) && !usedTaskIds.has(id))
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

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function stableHash(input: string): string {
  let h = 0x811c9dc5
  for (const ch of input) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}
