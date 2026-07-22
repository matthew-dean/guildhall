import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  getProjectLocalHistoryDir,
  getProjectSystemStatePath,
  readProjectStateDatabaseQueueDefinitionForMigration,
} from '@guildhall/sessions'
import { effectiveTaskTitle } from '@guildhall/shared'
import { writeProjectTaskQueueWithSummary } from './project-state-boundary.js'
import {
  describePath,
  readEvacuationManifest,
  verifySnapshotEntry,
  writeEvacuationManifest,
  type ProjectStateEvacuationEntry,
  type ProjectStateEvacuationManifest,
} from './evacuation-manifest.js'

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
  unverifiedEvacuationPaths: string[]
  affectedPaths: string[]
}

interface EvacuationIntegrity {
  manifestPath: string
  manifest: ProjectStateEvacuationManifest | null
  invalidEntries: ProjectStateEvacuationEntry[]
}

async function readEvacuationIntegrity(projectRoot: string): Promise<EvacuationIntegrity> {
  const manifestPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'manifest.json')
  let manifest: ProjectStateEvacuationManifest | null = null
  try {
    manifest = await readEvacuationManifest(manifestPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (!manifest) return { manifestPath, manifest: null, invalidEntries: [] }
  const entries = manifest.batches.flatMap(batch => batch.entries)
  const checks = await Promise.all(entries.map(async entry => ({
    entry,
    valid: await verifySnapshotEntry(entry),
  })))
  return {
    manifestPath,
    manifest,
    invalidEntries: checks.filter(check => !check.valid).map(check => check.entry),
  }
}

function evacuationPathIsTrusted(
  integrity: EvacuationIntegrity,
  snapshotPath: string,
): boolean {
  if (!integrity.manifest) return true
  const entry = integrity.manifest.batches
    .flatMap(batch => batch.entries)
    .find(candidate => candidate.snapshot.path === snapshotPath)
  // A manifest can coexist with older unmanifested evacuation material. Keep
  // that compatibility path readable, but never trust a manifest entry whose
  // digest failed verification.
  return !entry || !integrity.invalidEntries.includes(entry)
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

async function collectMissingTaskStateFiles(
  projectRoot: string,
  isTrustedPath: (snapshotPath: string) => boolean = () => true,
  usedSnapshotPaths?: Set<string>,
): Promise<Array<{ source: string; destination: string; affectedPath: string }>> {
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
    if (!isTrustedPath(source)) continue
    if (await fileExists(source) && !await fileExists(destination)) {
      usedSnapshotPaths?.add(source)
      missing.push({ source, destination, affectedPath: `project-state/${candidate.relativePath}` })
    }
  }
  return missing
}

async function readEvacuatedArchiveTasks(
  projectRoot: string,
  isTrustedPath: (snapshotPath: string) => boolean = () => true,
  usedSnapshotPaths?: Set<string>,
): Promise<unknown[]> {
  const archiveDir = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'tasks', 'archive')
  let entries: string[]
  try {
    entries = await fs.readdir(archiveDir)
  } catch (err) {
    if (String(err).includes('ENOENT')) return []
    throw err
  }
  const tasks: unknown[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const source = path.join(archiveDir, entry)
    if (!isTrustedPath(source)) continue
    const task = await readJsonIfExists(source)
    if (task !== null) usedSnapshotPaths?.add(source)
    if (taskId(task)) tasks.push(task)
  }
  return tasks
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

async function markRestoredEvacuationEntries(input: {
  integrity: EvacuationIntegrity
  usedSnapshotPaths: Set<string>
  projectRoot: string
  systemTasksPath: string
  missingTaskStateFiles: Array<{ source: string; destination: string }>
}): Promise<void> {
  if (!input.integrity.manifest || input.usedSnapshotPaths.size === 0) return
  const targetBySnapshotPath = new Map<string, string>([
    [path.join(getProjectLocalHistoryDir(input.projectRoot), 'project-state-evacuation', 'TASKS.json'), input.systemTasksPath],
    ...input.missingTaskStateFiles.map(file => [file.source, file.destination] as const),
  ])
  const verifiedAt = new Date().toISOString()
  for (const batch of input.integrity.manifest.batches) {
    for (const entry of batch.entries) {
      if (!input.usedSnapshotPaths.has(entry.snapshot.path)) continue
      const targetPath = targetBySnapshotPath.get(entry.snapshot.path) ?? input.systemTasksPath
      try {
        const target = await describePath(targetPath)
        entry.restore = {
          status: 'verified',
          verifiedAt,
          target: { path: targetPath, bytes: target.bytes, sha256: target.sha256 },
        }
      } catch {
        entry.restore = { status: 'failed' }
      }
    }
  }
  await writeEvacuationManifest(input.integrity.manifestPath, input.integrity.manifest)
}

function mergeTaskStringArray(existing: unknown, restored: unknown): string[] | undefined {
  return mergeStringArray(existing, restored)
}

function enrichHollowTaskFromEvacuated(systemTask: unknown, evacuatedTask: unknown): unknown {
  if (!isRecord(systemTask) || !isRecord(evacuatedTask)) return systemTask
  const next: Record<string, unknown> = { ...systemTask, ...evacuatedTask }
  if (next.status === 'done' && !archivedTaskHasPositiveDoneEvidence(next)) {
    next.status = 'ready'
  }
  const releaseIds = mergeTaskStringArray(systemTask.releaseIds, evacuatedTask.releaseIds)
  const references = mergeTaskStringArray(systemTask.references, evacuatedTask.references)
  if (releaseIds) next.releaseIds = releaseIds
  if (references) next.references = references
  repairEffectiveTaskTitle(next)
  return next
}

function archivedTaskHasPositiveDoneEvidence(task: Record<string, unknown>): boolean {
  if (Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.some(item => isRecord(item) && item.met === true)) {
    return true
  }
  const doneSummary = isRecord(task.doneSummaryBundle) ? task.doneSummaryBundle : null
  if (doneSummary?.status === 'done') return true
  if (Array.isArray(task.gateResults) && task.gateResults.some(item =>
    isRecord(item) && (item.passed === true || item.status === 'pass' || item.status === 'passed')
  )) {
    return true
  }
  const handoff = isRecord(task.completionHandoff) ? task.completionHandoff : null
  if (handoff && (
    (Array.isArray(handoff.automatedProof) && handoff.automatedProof.some(item =>
      isRecord(item) && (item.status === 'passed' || item.status === 'pass')
    )) ||
    (Array.isArray(handoff.manualProof) && handoff.manualProof.some(item =>
      isRecord(item) && (item.status === 'passed' || item.status === 'pass')
    )) ||
    (Array.isArray(handoff.providerProof) && handoff.providerProof.some(item =>
      isRecord(item) && (item.status === 'passed' || item.status === 'pass')
    ))
  )) {
    return true
  }
  return false
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
  const integrity = await readEvacuationIntegrity(projectRoot)
  if (apply && integrity.invalidEntries.length > 0) {
    throw new Error(
      `Evacuated project state failed integrity verification: ${integrity.invalidEntries.map(entry => entry.snapshot.path).join(', ')}`,
    )
  }
  const usedSnapshotPaths = new Set<string>()
  const taskQueueTrusted = evacuationPathIsTrusted(integrity, evacuatedTasksPath)
  const evacuatedQueue = taskQueueTrusted ? await readJsonIfExists(evacuatedTasksPath) : null
  if (evacuatedQueue !== null) usedSnapshotPaths.add(evacuatedTasksPath)
  // Once the database authority migration has removed TASKS.json, the
  // database queue is the system state that evacuation must compare against.
  // Reading the absent compatibility file here made every historical
  // evacuation look like a fresh restore on every migration run.
  const systemQueue = readProjectStateDatabaseQueueDefinitionForMigration(systemTasksPath)
    ?? await readJsonIfExists(systemTasksPath)
  const evacuatedTasks = readTasks(evacuatedQueue)
  const evacuatedArchiveTasks = await readEvacuatedArchiveTasks(
    projectRoot,
    snapshotPath => evacuationPathIsTrusted(integrity, snapshotPath),
    usedSnapshotPaths,
  )
  const systemTasks = readTasks(systemQueue)
  const systemIds = new Set(systemTasks.map(taskId).filter((id): id is string => id !== null))
  const evacuatedById = new Map([...evacuatedArchiveTasks, ...evacuatedTasks].map(task => [taskId(task), task]).filter((entry): entry is [string, unknown] => entry[0] !== null))
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
  const missingTaskStateFiles = await collectMissingTaskStateFiles(
    projectRoot,
    snapshotPath => evacuationPathIsTrusted(integrity, snapshotPath),
    usedSnapshotPaths,
  )
  const releaseMetadataNeeded = needsReleaseMetadataRestore(systemQueue, evacuatedQueue)
  const needed = integrity.invalidEntries.length > 0 || missing.length > 0 || enrichmentIds.length > 0 || titleRepairIds.length > 0 || missingTaskStateFiles.length > 0 || releaseMetadataNeeded
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
      writeProjectTaskQueueWithSummary(systemTasksPath, next, {
        projectId: path.basename(projectRoot),
        fullCompatibility: true,
      })
    }
    for (const file of missingTaskStateFiles) {
      await fs.mkdir(path.dirname(file.destination), { recursive: true })
      await fs.copyFile(file.source, file.destination)
    }
    await markRestoredEvacuationEntries({
      integrity,
      usedSnapshotPaths,
      projectRoot,
      systemTasksPath,
      missingTaskStateFiles,
    })
  }
  const affectedPaths = new Set<string>()
  if (existsSync(evacuatedTasksPath)) {
    affectedPaths.add('project-state/TASKS.json')
    affectedPaths.add('project-state-evacuation/TASKS.json')
  }
  if (integrity.manifest && existsSync(integrity.manifestPath)) {
    affectedPaths.add('project-state-evacuation/manifest.json')
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
    unverifiedEvacuationPaths: integrity.invalidEntries.map(entry => entry.snapshot.path),
    affectedPaths: Array.from(affectedPaths),
  }
}
