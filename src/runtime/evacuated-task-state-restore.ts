import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { getProjectLocalHistoryDir, getProjectSystemStatePath } from '@guildhall/sessions'
import { effectiveTaskTitle } from '../shared/task-display-label.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readTasks(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (isRecord(value) && Array.isArray(value.tasks)) return value.tasks
  return []
}

function taskId(task: unknown): string | null {
  return isRecord(task) && typeof task.id === 'string' && task.id.length > 0 ? task.id : null
}

function readReleases(value: unknown): Array<Record<string, unknown>> {
  if (isRecord(value) && Array.isArray(value.releases)) {
    return value.releases.filter(isRecord)
  }
  return []
}

function releaseId(release: Record<string, unknown>): string | null {
  return typeof release.id === 'string' && release.id.length > 0 ? release.id : null
}

function selectedReleaseId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.selectedReleaseId === 'string' && value.selectedReleaseId.length > 0
    ? value.selectedReleaseId
    : undefined
}

function mergeStringArray(existing: unknown, restored: unknown): string[] | undefined {
  const values = new Set<string>()
  if (Array.isArray(existing)) {
    for (const item of existing) {
      if (typeof item === 'string') values.add(item)
    }
  }
  if (Array.isArray(restored)) {
    for (const item of restored) {
      if (typeof item === 'string') values.add(item)
    }
  }
  return values.size > 0 ? Array.from(values) : undefined
}

function mergeRelease(existing: Record<string, unknown>, restored: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...restored, ...existing }
  const nodeIds = mergeStringArray(existing.nodeIds, restored.nodeIds)
  const deferredNodeIds = mergeStringArray(existing.deferredNodeIds, restored.deferredNodeIds)
  if (nodeIds) next.nodeIds = nodeIds
  if (deferredNodeIds) next.deferredNodeIds = deferredNodeIds
  return next
}

function mergeReleases(systemQueue: unknown, evacuatedQueue: unknown): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>()
  for (const release of readReleases(evacuatedQueue)) {
    const id = releaseId(release)
    if (id) merged.set(id, release)
  }
  for (const release of readReleases(systemQueue)) {
    const id = releaseId(release)
    if (!id) continue
    const restored = merged.get(id)
    merged.set(id, restored ? mergeRelease(release, restored) : release)
  }
  return Array.from(merged.values())
}

function needsReleaseMetadataRestore(systemQueue: unknown, evacuatedQueue: unknown): boolean {
  const restoredSelectedReleaseId = selectedReleaseId(evacuatedQueue)
  if (restoredSelectedReleaseId && selectedReleaseId(systemQueue) !== restoredSelectedReleaseId) return true

  const systemReleases = new Map(readReleases(systemQueue).map((release) => [releaseId(release), release]))
  for (const restoredRelease of readReleases(evacuatedQueue)) {
    const id = releaseId(restoredRelease)
    if (!id) continue
    const systemRelease = systemReleases.get(id)
    if (!systemRelease) return true
    for (const field of ['label', 'kind', 'state', 'source'] as const) {
      if (restoredRelease[field] !== undefined && systemRelease[field] === undefined) return true
    }
    for (const field of ['nodeIds', 'deferredNodeIds'] as const) {
      const restoredValues = mergeStringArray(undefined, restoredRelease[field]) ?? []
      const systemValues = new Set(mergeStringArray(undefined, systemRelease[field]) ?? [])
      if (restoredValues.some(value => !systemValues.has(value))) return true
    }
  }
  return false
}

async function readJsonIfExists(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown
  } catch (err) {
    if (String(err).includes('ENOENT')) return null
    throw err
  }
}

function queueVersion(value: unknown): number {
  return isRecord(value) && typeof value.version === 'number' ? value.version : 1
}

function queueLastUpdated(value: unknown): string | undefined {
  return isRecord(value) && typeof value.lastUpdated === 'string' ? value.lastUpdated : undefined
}

export interface RestoreEvacuatedTaskStateResult {
  needed: boolean
  restored: number
  enriched: number
  titleRepaired: number
  restoredTaskStateFiles: number
  systemTaskCount: number
  evacuatedTaskCount: number
  affectedPaths: string[]
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch (err) {
    if (String(err).includes('ENOENT')) return false
    throw err
  }
}

async function collectMissingTaskStateFiles(projectRoot: string): Promise<Array<{ source: string; destination: string; affectedPath: string }>> {
  const evacuatedTasksDir = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'tasks')
  const candidates = [
    { relativePath: 'tasks/index.json' },
  ]

  const archiveDir = path.join(evacuatedTasksDir, 'archive')
  try {
    const archiveEntries = await fs.readdir(archiveDir)
    for (const entry of archiveEntries) {
      if (entry.endsWith('.json')) {
        candidates.push({ relativePath: path.join('tasks', 'archive', entry) })
      }
    }
  } catch (err) {
    if (!String(err).includes('ENOENT')) throw err
  }

  const missing: Array<{ source: string; destination: string; affectedPath: string }> = []
  for (const candidate of candidates) {
    const source = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', candidate.relativePath)
    const destination = getProjectSystemStatePath(projectRoot, candidate.relativePath)
    if (await fileExists(source) && !await fileExists(destination)) {
      missing.push({ source, destination, affectedPath: `project-state/${candidate.relativePath}` })
    }
  }
  return missing
}

function hasTaskShape(task: unknown): boolean {
  if (!isRecord(task)) return false
  return typeof task.spec === 'string' && task.spec.trim().length > 0
    || isRecord(task.productBrief)
    || (Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length > 0)
}

function isHollowImportedDraft(task: unknown): boolean {
  return isRecord(task)
    && task.status === 'import_draft'
    && !hasTaskShape(task)
}

function mergeTaskStringArray(existing: unknown, restored: unknown): string[] | undefined {
  return mergeStringArray(existing, restored)
}

function enrichHollowTaskFromEvacuated(systemTask: unknown, evacuatedTask: unknown): unknown {
  if (!isRecord(systemTask) || !isRecord(evacuatedTask)) return systemTask
  const next: Record<string, unknown> = { ...systemTask, ...evacuatedTask }
  const releaseIds = mergeTaskStringArray(systemTask.releaseIds, evacuatedTask.releaseIds)
  const references = mergeTaskStringArray(systemTask.references, evacuatedTask.references)
  if (releaseIds) next.releaseIds = releaseIds
  if (references) next.references = references
  repairEffectiveTaskTitle(next)
  return next
}

function repairEffectiveTaskTitle(task: Record<string, unknown>): boolean {
  const title = typeof task.title === 'string' ? task.title : undefined
  const description = typeof task.description === 'string' ? task.description : undefined
  const recoveredTitle = effectiveTaskTitle({ title, description })
  if (!recoveredTitle || recoveredTitle === title) return false
  task.title = recoveredTitle
  return true
}

export async function restoreEvacuatedTaskState(projectRoot: string, apply: boolean): Promise<RestoreEvacuatedTaskStateResult> {
  const systemTasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const evacuatedTasksPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'TASKS.json')
  const evacuatedQueue = await readJsonIfExists(evacuatedTasksPath)
  const systemQueue = await readJsonIfExists(systemTasksPath)
  const evacuatedTasks = readTasks(evacuatedQueue)
  const systemTasks = readTasks(systemQueue)
  const systemIds = new Set(systemTasks.map(taskId).filter((id): id is string => id !== null))
  const evacuatedById = new Map(evacuatedTasks.map(task => [taskId(task), task]).filter((entry): entry is [string, unknown] => entry[0] !== null))
  const missing = evacuatedTasks.filter((task) => {
    const id = taskId(task)
    return id !== null && !systemIds.has(id)
  })
  const enrichmentIds = systemTasks
    .filter(task => {
      const id = taskId(task)
      const evacuatedTask = id ? evacuatedById.get(id) : undefined
      return id !== null && isHollowImportedDraft(task) && hasTaskShape(evacuatedTask)
    })
    .map(task => taskId(task))
    .filter((id): id is string => id !== null)
  const titleRepairIds = systemTasks
    .filter(task => {
      if (!isRecord(task)) return false
      const id = taskId(task)
      if (id !== null && enrichmentIds.includes(id)) return false
      const title = typeof task.title === 'string' ? task.title : undefined
      const description = typeof task.description === 'string' ? task.description : undefined
      const recoveredTitle = effectiveTaskTitle({ title, description })
      return !!recoveredTitle && recoveredTitle !== title
    })
    .map(task => taskId(task))
    .filter((id): id is string => id !== null)
  const missingTaskStateFiles = await collectMissingTaskStateFiles(projectRoot)
  const releaseMetadataNeeded = needsReleaseMetadataRestore(systemQueue, evacuatedQueue)
  const needed = missing.length > 0 || enrichmentIds.length > 0 || titleRepairIds.length > 0 || missingTaskStateFiles.length > 0 || releaseMetadataNeeded
  if (apply && needed) {
    if (missing.length > 0 || enrichmentIds.length > 0 || titleRepairIds.length > 0 || releaseMetadataNeeded) {
      await fs.mkdir(path.dirname(systemTasksPath), { recursive: true })
      const restoredAt = new Date().toISOString()
      const mergedReleases = mergeReleases(systemQueue, evacuatedQueue)
      const enrichmentIdSet = new Set(enrichmentIds)
      const titleRepairIdSet = new Set(titleRepairIds)
      const mergedSystemTasks = systemTasks.map(task => {
        const id = taskId(task)
        if (!id) return task
        if (enrichmentIdSet.has(id)) return enrichHollowTaskFromEvacuated(task, evacuatedById.get(id))
        if (titleRepairIdSet.has(id) && isRecord(task)) {
          const next = { ...task }
          repairEffectiveTaskTitle(next)
          return next
        }
        return task
      })
      const next: Record<string, unknown> = isRecord(systemQueue) ? { ...systemQueue } : {}
      next.version = Math.max(queueVersion(evacuatedQueue), queueVersion(systemQueue))
      next.lastUpdated = restoredAt
      next.tasks = [...missing, ...mergedSystemTasks]
      const restoredSelectedReleaseId = selectedReleaseId(evacuatedQueue)
      if (!selectedReleaseId(next) && restoredSelectedReleaseId) {
        next.selectedReleaseId = restoredSelectedReleaseId
      }
      if (mergedReleases.length > 0) {
        next.releases = mergedReleases
      }
      next.restoredFromEvacuation = {
        ...(isRecord(next.restoredFromEvacuation) ? next.restoredFromEvacuation : {}),
        restoredAt,
        source: evacuatedTasksPath,
        restoredTaskCount: missing.length,
        enrichedTaskCount: enrichmentIds.length,
        titleRepairedTaskCount: titleRepairIds.length,
        restoredReleaseCount: mergedReleases.length,
        restoredReleaseMetadata: releaseMetadataNeeded,
        priorSystemTaskCount: systemTasks.length,
        evacuatedLastUpdated: queueLastUpdated(evacuatedQueue),
      }
      await fs.writeFile(systemTasksPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    }
    for (const file of missingTaskStateFiles) {
      await fs.mkdir(path.dirname(file.destination), { recursive: true })
      await fs.copyFile(file.source, file.destination)
    }
  }
  const affectedPaths = new Set<string>()
  if (existsSync(evacuatedTasksPath)) {
    affectedPaths.add('project-state/TASKS.json')
    affectedPaths.add('project-state-evacuation/TASKS.json')
  }
  for (const file of missingTaskStateFiles) {
    affectedPaths.add(file.affectedPath)
  }
  return {
    needed,
    restored: apply && needed ? missing.length : 0,
    enriched: apply && needed ? enrichmentIds.length : 0,
    titleRepaired: apply && needed ? titleRepairIds.length : 0,
    restoredTaskStateFiles: apply && needed ? missingTaskStateFiles.length : 0,
    systemTaskCount: systemTasks.length,
    evacuatedTaskCount: evacuatedTasks.length,
    affectedPaths: Array.from(affectedPaths),
  }
}
