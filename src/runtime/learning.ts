import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ensureGuildhallHome, guildhallHomeDir } from '@guildhall/config'
import { z } from 'zod'
import type { WorkspaceImportReview } from './workspace-import/review.js'
import type { WorkspaceImportDraft } from './workspace-import/index.js'

const TaskSelectionMode = z.enum(['all', 'tight'])

const WorkspaceImportLearningSchema = z.object({
  preferredAreaKeys: z.array(z.string()).default([]),
  preferredSourceKeys: z.array(z.string()).default([]),
  areaSelectionCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  sourceSelectionCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  approvedRuns: z.number().int().nonnegative().default(0),
  dismissedRuns: z.number().int().nonnegative().default(0),
  averageTaskAcceptanceRatio: z.number().min(0).max(1).nullable().default(null),
  lastTaskAcceptanceRatio: z.number().min(0).max(1).nullable().default(null),
  taskSelectionMode: TaskSelectionMode.default('all'),
  updatedAt: z.string().nullable().default(null),
})

const CoordinatorSuggestionSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
})

const ProductSuggestionSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  evidence: z.array(z.string()),
})

const LearningRecordSchema = z.object({
  version: z.literal(1).default(1),
  workspaceImport: WorkspaceImportLearningSchema.default({}),
  coordinatorSuggestions: z.array(CoordinatorSuggestionSchema).default([]),
  productSuggestions: z.array(ProductSuggestionSchema).default([]),
})

export type WorkspaceImportLearning = z.infer<typeof WorkspaceImportLearningSchema>
export type CoordinatorSuggestion = z.infer<typeof CoordinatorSuggestionSchema>
export type ProductSuggestion = z.infer<typeof ProductSuggestionSchema>
export type LearningRecord = z.infer<typeof LearningRecordSchema>

export interface WorkspaceImportDefaults {
  selectedAreaKeys: string[]
  selectedSourceKeys: string[]
  selectedTaskIds: string[]
  taskSelectionMode: z.infer<typeof TaskSelectionMode>
  note: string | null
}

export interface LearningSnapshot {
  project: LearningRecord
  user: LearningRecord
  effective: {
    workspaceImport: WorkspaceImportLearning
    defaults: WorkspaceImportDefaults
    coordinatorSuggestions: CoordinatorSuggestion[]
    productSuggestions: ProductSuggestion[]
  }
}

export interface RecordWorkspaceImportApprovalInput {
  memoryDir: string
  review: WorkspaceImportReview
  draft: WorkspaceImportDraft
  selectedAreaKeys: string[]
  selectedSourceKeys: string[]
  selectedTaskIds: string[]
}

function defaultLearningRecord(): LearningRecord {
  return LearningRecordSchema.parse({})
}

export function projectLearningPath(memoryDir: string): string {
  return path.join(memoryDir, 'learning.json')
}

export function globalLearningPath(): string {
  return path.join(guildhallHomeDir(), 'learning.json')
}

function parseLearning(raw: unknown): LearningRecord {
  return LearningRecordSchema.parse(raw ?? {})
}

function readLearningFile(filePath: string): LearningRecord {
  if (!existsSync(filePath)) return defaultLearningRecord()
  try {
    return parseLearning(JSON.parse(readFileSync(filePath, 'utf8')))
  } catch {
    return defaultLearningRecord()
  }
}

async function writeLearningFile(filePath: string, record: LearningRecord): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(LearningRecordSchema.parse(record), null, 2), 'utf8')
}

export function readProjectLearning(memoryDir: string): LearningRecord {
  return readLearningFile(projectLearningPath(memoryDir))
}

export function readGlobalLearning(): LearningRecord {
  ensureGuildhallHome()
  return readLearningFile(globalLearningPath())
}

export async function resetProjectLearning(memoryDir: string): Promise<void> {
  await writeLearningFile(projectLearningPath(memoryDir), defaultLearningRecord())
}

export async function resetGlobalLearning(): Promise<void> {
  ensureGuildhallHome()
  await writeLearningFile(globalLearningPath(), defaultLearningRecord())
}

function incrementCounts(
  counts: Record<string, number>,
  selectedKeys: readonly string[],
): Record<string, number> {
  const next = { ...counts }
  for (const key of selectedKeys) next[key] = (next[key] ?? 0) + 1
  return next
}

function derivePreferredKeys(
  counts: Record<string, number>,
  approvedRuns: number,
): string[] {
  if (approvedRuns <= 0) return []
  const threshold = Math.max(1, Math.ceil(approvedRuns / 2))
  return Object.entries(counts)
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([key]) => key)
}

function taskAcceptanceMode(averageRatio: number | null): z.infer<typeof TaskSelectionMode> {
  if (averageRatio !== null && averageRatio < 0.65) return 'tight'
  return 'all'
}

function mergeWorkspaceImportLearning(
  base: WorkspaceImportLearning,
  patch: Partial<WorkspaceImportLearning>,
): WorkspaceImportLearning {
  return WorkspaceImportLearningSchema.parse({ ...base, ...patch })
}

function rebuildProjectSuggestions(record: LearningRecord): LearningRecord {
  const wi = record.workspaceImport
  const coordinatorSuggestions: CoordinatorSuggestion[] = []
  const productSuggestions: ProductSuggestion[] = []

  if (wi.approvedRuns >= 2 && (wi.averageTaskAcceptanceRatio ?? 1) < 0.65) {
    coordinatorSuggestions.push({
      id: 'workspace-import-clarity-check',
      title: 'Let the coordinator tighten broad import drafts sooner',
      summary:
        'Guildhall keeps drafting a broader task list than this project wants. The local coordinator should apply a stronger clarity check before asking for approval.',
      confidence: (wi.averageTaskAcceptanceRatio ?? 1) < 0.45 ? 'high' : 'medium',
    })
  }

  if (wi.approvedRuns >= 2 && (wi.averageTaskAcceptanceRatio ?? 1) < 0.45) {
    const ratio = Math.round((wi.averageTaskAcceptanceRatio ?? 0) * 100)
    productSuggestions.push({
      id: 'workspace-import-tighten-defaults',
      title: 'Workspace import should propose fewer tasks by default',
      summary:
        'This project repeatedly trims most of the suggested task list before approval. Guildhall should lead with a tighter recommended draft.',
      evidence: [
        `Average kept task ratio: ${ratio}% across ${wi.approvedRuns} approved import run${wi.approvedRuns === 1 ? '' : 's'}.`,
      ],
    })
  }

  return LearningRecordSchema.parse({
    ...record,
    coordinatorSuggestions,
    productSuggestions,
  })
}

function updateAcceptanceStats(
  current: WorkspaceImportLearning,
  ratio: number,
  now: string,
): WorkspaceImportLearning {
  const nextRuns = current.approvedRuns + 1
  const average =
    current.averageTaskAcceptanceRatio === null
      ? ratio
      : ((current.averageTaskAcceptanceRatio * current.approvedRuns) + ratio) / nextRuns
  const merged = mergeWorkspaceImportLearning(current, {
    approvedRuns: nextRuns,
    averageTaskAcceptanceRatio: average,
    lastTaskAcceptanceRatio: ratio,
    taskSelectionMode: taskAcceptanceMode(average),
    updatedAt: now,
  })
  return WorkspaceImportLearningSchema.parse(merged)
}

export async function recordWorkspaceImportApproval(
  input: RecordWorkspaceImportApprovalInput,
): Promise<LearningSnapshot> {
  const now = new Date().toISOString()
  const selectedAreaKeys = [...new Set(input.selectedAreaKeys)]
  const selectedSourceKeys = [...new Set(input.selectedSourceKeys)]
  const selectedTaskIds = [...new Set(input.selectedTaskIds)]
  const ratio =
    input.review.totalTaskCandidates > 0
      ? selectedTaskIds.length / input.review.totalTaskCandidates
      : 1

  const projectRecord = readProjectLearning(input.memoryDir)
  const nextProjectWI = updateAcceptanceStats(
    mergeWorkspaceImportLearning(projectRecord.workspaceImport, {
      areaSelectionCounts: incrementCounts(projectRecord.workspaceImport.areaSelectionCounts, selectedAreaKeys),
      sourceSelectionCounts: incrementCounts(projectRecord.workspaceImport.sourceSelectionCounts, selectedSourceKeys),
    }),
    ratio,
    now,
  )
  nextProjectWI.preferredAreaKeys = derivePreferredKeys(
    nextProjectWI.areaSelectionCounts,
    nextProjectWI.approvedRuns,
  )
  nextProjectWI.preferredSourceKeys = derivePreferredKeys(
    nextProjectWI.sourceSelectionCounts,
    nextProjectWI.approvedRuns,
  )
  const nextProjectRecord = rebuildProjectSuggestions({
    ...projectRecord,
    workspaceImport: nextProjectWI,
  })
  await writeLearningFile(projectLearningPath(input.memoryDir), nextProjectRecord)

  const userRecord = readGlobalLearning()
  const nextUserRecord = LearningRecordSchema.parse({
    ...userRecord,
    workspaceImport: updateAcceptanceStats(userRecord.workspaceImport, ratio, now),
  })
  await writeLearningFile(globalLearningPath(), nextUserRecord)

  return buildLearningSnapshot({
    memoryDir: input.memoryDir,
    review: input.review,
    draft: input.draft,
  })
}

export async function recordWorkspaceImportDismissal(memoryDir: string): Promise<void> {
  const now = new Date().toISOString()
  const projectRecord = readProjectLearning(memoryDir)
  await writeLearningFile(projectLearningPath(memoryDir), {
    ...projectRecord,
    workspaceImport: mergeWorkspaceImportLearning(projectRecord.workspaceImport, {
      dismissedRuns: projectRecord.workspaceImport.dismissedRuns + 1,
      updatedAt: now,
    }),
  })

  const userRecord = readGlobalLearning()
  await writeLearningFile(globalLearningPath(), {
    ...userRecord,
    workspaceImport: mergeWorkspaceImportLearning(userRecord.workspaceImport, {
      dismissedRuns: userRecord.workspaceImport.dismissedRuns + 1,
      updatedAt: now,
    }),
  })
}

export function buildWorkspaceImportDefaults(
  review: WorkspaceImportReview,
  draft: WorkspaceImportDraft,
  projectLearning: LearningRecord,
  userLearning: LearningRecord,
): WorkspaceImportDefaults {
  const taskBearingAreas = review.areaGroups.filter(area => area.taskCount > 0)
  const taskBearingSources = review.sourceGroups.filter(group => group.taskCount > 0)
  const projectPreferredAreas = projectLearning.workspaceImport.preferredAreaKeys.filter(key =>
    taskBearingAreas.some(area => area.key === key),
  )
  const selectedAreaKeys =
    projectPreferredAreas.length > 0
      ? projectPreferredAreas
      : taskBearingAreas.map(area => area.key)

  const projectPreferredSources = projectLearning.workspaceImport.preferredSourceKeys.filter(key =>
    taskBearingSources.some(group => group.key === key && selectedAreaKeys.includes(group.areaKey)),
  )
  const selectedSourceKeys =
    projectPreferredSources.length > 0
      ? projectPreferredSources
      : taskBearingSources
          .filter(group => selectedAreaKeys.includes(group.areaKey))
          .map(group => group.key)

  const effectiveMode =
    projectLearning.workspaceImport.taskSelectionMode !== 'all'
      ? projectLearning.workspaceImport.taskSelectionMode
      : userLearning.workspaceImport.taskSelectionMode

  const taskIdsForSelectedSources = new Set(
    review.sourceGroups
      .filter(group => selectedSourceKeys.includes(group.key))
      .flatMap(group => group.taskIds),
  )
  const candidateTasks = draft.tasks.filter(task => taskIdsForSelectedSources.has(task.suggestedId))
  const tightTasks = candidateTasks.filter(task =>
    task.confidence === 'high' || task.priority === 'critical' || task.priority === 'high',
  )
  const selectedTaskIds = (effectiveMode === 'tight' && tightTasks.length > 0 ? tightTasks : candidateTasks)
    .map(task => task.suggestedId)

  let note: string | null = null
  if (projectPreferredAreas.length > 0 || projectPreferredSources.length > 0) {
    note = 'Guildhall reused the project parts and sources you approved last time.'
  } else if (effectiveMode === 'tight') {
    note = 'Guildhall started with a tighter task list because you usually trim broad imports.'
  }

  return {
    selectedAreaKeys,
    selectedSourceKeys,
    selectedTaskIds,
    taskSelectionMode: effectiveMode,
    note,
  }
}

export function buildLearningSnapshot(input: {
  memoryDir: string
  review: WorkspaceImportReview
  draft: WorkspaceImportDraft
}): LearningSnapshot {
  const project = readProjectLearning(input.memoryDir)
  const user = readGlobalLearning()
  const defaults = buildWorkspaceImportDefaults(input.review, input.draft, project, user)

  return {
    project,
    user,
    effective: {
      workspaceImport: mergeWorkspaceImportLearning(project.workspaceImport, {
        taskSelectionMode:
          project.workspaceImport.taskSelectionMode !== 'all'
            ? project.workspaceImport.taskSelectionMode
            : user.workspaceImport.taskSelectionMode,
      }),
      defaults,
      coordinatorSuggestions: project.coordinatorSuggestions,
      productSuggestions: project.productSuggestions,
    },
  }
}
