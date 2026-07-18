import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { findWorkspaceRoot, readWorkspaceConfig } from '@guildhall/config'
import {
  getProjectLocalHistoryDir,
  getProjectProgressHeartbeatsPath,
  getProjectStateDir,
  getProjectSystemStatePath,
  getProjectSystemStateDir,
  getProjectTaskLocalHistoryDir,
  compactTaskEvidenceHistory,
  compactProjectStateDatabaseEvidence,
  vacuumProjectStateDatabase,
  compactProjectSessionSnapshots,
  compactProjectProgressHeartbeats,
  readProjectStateDatabaseCurrentAuthority,
  readProjectStateDatabaseQueueWithRevision,
  registerProjectHistoricalArtifactIfCurrent,
} from '@guildhall/sessions'
import {
  findForbiddenProjectTaskFields,
  sanitizeTaskQueueForProjectWrite,
  type ForbiddenProjectTaskFieldFinding,
} from './project-state-boundary.js'
import {
  writeProjectTaskQueueAtCurrentStateBoundary,
  writeProjectTaskQueueWithSummary,
} from './project-state-boundary.js'
import { compactExploringTranscripts } from '@guildhall/tools'
import { compactProjectContextDebug } from './context-observability.js'
import { compactProjectRecentEvents } from './serve-supervisor.js'
import {
  archiveLegacyMigrationSnapshotIfCurrent,
  compactMaterializedMigrationSnapshot,
  registerMigrationSnapshotArtifactIfCurrent,
} from './migration-snapshot.js'
import { backfillReviewTransportArtifacts } from './review-audit-store.js'
import { compactCodebaseMapHistory } from '@guildhall/corpus-map'
import { consolidateProjectMemoryEvents } from '@guildhall/memory-core'
import {
  describePath,
  readEvacuationManifest,
  writeEvacuationManifest,
  type ProjectStateEvacuationEntry,
  type ProjectStateEvacuationManifest,
} from './evacuation-manifest.js'

export interface ProjectStateCompactionOptions {
  projectRoot: string
  dryRun?: boolean
}

export interface ProjectStateCompactionResult {
  projectRoot: string
  stateDir: string
  localHistoryDir: string
  dryRun: boolean
  repoStateMode: 'off' | 'thin'
  evacuatedProjectStatePaths: string[]
  evacuationManifestPath: string | null
  activeTasksKept: number
  archivedTasks: number
  archivedTaskFilesCompacted: number
  archiveEvidenceFilesCompacted: number
  activeTasksSanitized: number
  forbiddenTaskFieldsBefore: number
  forbiddenTaskFieldsAfter: number
  forbiddenTaskFieldFindings: ForbiddenProjectTaskFieldFinding[]
  removedEvidenceBytes: number
  codebaseMapCompacted: boolean
  codebaseMapHistoryBytesBefore: number
  codebaseMapHistoryBytesAfter: number
  codebaseMapHistoryRecordsCompacted: number
  progressHeartbeatsMoved: number
  progressHeartbeatBytesBefore: number
  progressHeartbeatBytesAfter: number
  progressHeartbeatRecordsCompacted: number
  exploringHistoryFilesSeen: number
  exploringHistoryFilesCompacted: number
  exploringHistoryBytesBefore: number
  exploringHistoryBytesAfter: number
  sessionFilesSeen: number
  sessionFilesCompacted: number
  sessionPendingFilesPreserved: number
  sessionBytesBefore: number
  sessionBytesAfter: number
  contextDebugLedgerBytesBefore: number
  contextDebugLedgerBytesAfter: number
  contextDebugLedgerRecordsCompacted: number
  contextDebugSnapshotFilesCompacted: number
  contextDebugSnapshotBytesBefore: number
  contextDebugSnapshotBytesAfter: number
  contextDebugDuplicateEventFilesRemoved: number
  contextDebugDuplicateEventBytesBefore: number
  contextDebugDuplicateEventBytesAfter: number
  taskEvidenceFilesSeen: number
  taskEvidenceFilesCompacted: number
  taskEvidenceRecordsCompacted: number
  taskEvidenceBytesBefore: number
  taskEvidenceBytesAfter: number
  taskProofRowsCompacted: number
  currentEvidenceRowsCompacted: number
  databaseEvidenceBytesBefore: number
  databaseEvidenceBytesAfter: number
  databaseBytesBefore: number
  databaseBytesAfter: number
  databaseVacuumed: boolean
  recentEventBytesBefore: number
  recentEventBytesAfter: number
  recentEventRecordsCompacted: number
  memoryEventFilesSeen: number
  memoryEventFilesRemoved: number
  memoryEventRecordsSeen: number
  memoryEventRecordsRetained: number
  memoryEventBytesBefore: number
  memoryEventBytesAfter: number
  migrationSnapshotFilesSeen: number
  migrationSnapshotFilesCompacted: number
  migrationSnapshotBytesBefore: number
  migrationSnapshotBytesAfter: number
  migrationSnapshotUnknownFiles: number
  migrationSnapshotUnknownBytes: number
  migrationSnapshotArtifactsRegistered: number
  migrationSnapshotArtifactBytesRegistered: number
  migrationSnapshotLegacyFilesArchived: number
  migrationSnapshotLegacyBytesBefore: number
  migrationSnapshotLegacyBytesAfter: number
  reviewTransportFilesSeen: number
  reviewTransportArtifactsRegistered: number
  reviewTransportArtifactBytesRegistered: number
  evacuationFilesSeen: number
  evacuationArtifactsRegistered: number
  evacuationArtifactBytesRegistered: number
  bytesBefore: number
  bytesAfter: number
}

const TERMINAL_STATUSES = new Set(['done', 'shelved', 'cancelled', 'archived'])
const BULKY_TASK_FIELDS = [
  'notes',
  'reviewVerdicts',
  'adjudications',
  'gateResults',
  'escalations',
  'agentIssues',
] as const
const COMMITTED_ARCHIVE_ITEMS_PER_FIELD = 5
const CODEBASE_MAP_COMPACT_THRESHOLD_BYTES = 200_000
const CODEBASE_MAP_COMMITTED_FILE_LIMIT = 250
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function fileSize(file: string): Promise<number> {
  try {
    const stat = await fs.stat(file)
    return stat.isFile() ? stat.size : 0
  } catch {
    return 0
  }
}

async function migrationSnapshotCandidates(projectRoot: string): Promise<string[]> {
  const roots = [
    getProjectStateDir(projectRoot),
    getProjectSystemStateDir(projectRoot),
    path.join(getProjectLocalHistoryDir(projectRoot), 'migration-snapshots'),
    path.join(getProjectLocalHistoryDir(projectRoot), 'migrations'),
  ]
  const candidates: string[] = []
  const visit = async (directory: string): Promise<void> => {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(target)
      else if (entry.isFile() && /^TASKS\.(?:before|backup)-.*\.json$/i.test(entry.name)) candidates.push(target)
    }
  }
  for (const root of roots) await visit(root)
  return [...new Set(candidates)]
}

async function backfillEvacuationArtifacts(input: {
  projectRoot: string
  dryRun?: boolean
}): Promise<{
  filesSeen: number
  artifactsRegistered: number
  artifactBytesRegistered: number
}> {
  const root = path.join(getProjectLocalHistoryDir(input.projectRoot), 'project-state-evacuation')
  const files: string[] = []
  const visit = async (directory: string): Promise<void> => {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(target)
      else if (entry.isFile()) files.push(target)
    }
  }
  await visit(root)
  let artifactsRegistered = 0
  let artifactBytesRegistered = 0
  for (const file of files) {
    if (input.dryRun === true) continue
    const contents = await fs.readFile(file)
    const sha256 = createHash('sha256').update(contents).digest('hex')
    const logicalRef = path.relative(getProjectLocalHistoryDir(input.projectRoot), file).replaceAll(path.sep, '/')
    const stat = await fs.stat(file)
    const artifact = registerProjectHistoricalArtifactIfCurrent(input.projectRoot, {
      artifactId: `evacuation:${logicalRef}:${sha256}`,
      kind: 'evacuation_batch',
      owner: 'project-state-evacuation',
      logicalRef,
      createdAt: stat.birthtime.toISOString(),
      lastVerifiedAt: new Date().toISOString(),
      bytes: stat.size,
      sha256,
      retentionClass: 'archive',
      state: 'active',
      sourceRevision: sha256,
    })
    if (!artifact) continue
    artifactsRegistered += 1
    artifactBytesRegistered += stat.size
  }
  return { filesSeen: files.length, artifactsRegistered, artifactBytesRegistered }
}

async function compactProjectMigrationSnapshots(
  projectRoot: string,
  options: { dryRun?: boolean } = {},
): Promise<{
  filesSeen: number
  filesCompacted: number
  bytesBefore: number
  bytesAfter: number
  unknownFiles: number
  unknownBytes: number
  artifactsRegistered: number
  artifactBytesRegistered: number
  legacyFilesArchived: number
  legacyBytesBefore: number
  legacyBytesAfter: number
}> {
  const files = await migrationSnapshotCandidates(projectRoot)
  let filesCompacted = 0
  let bytesBefore = 0
  let bytesAfter = 0
  let unknownFiles = 0
  let unknownBytes = 0
  let artifactsRegistered = 0
  let artifactBytesRegistered = 0
  let legacyFilesArchived = 0
  let legacyBytesBefore = 0
  let legacyBytesAfter = 0
  for (const file of files) {
    const result = await compactMaterializedMigrationSnapshot(file, options)
    const legacyArchive = result.reason === 'missing_manifest'
      ? await archiveLegacyMigrationSnapshotIfCurrent({ projectRoot, snapshotPath: file, dryRun: options.dryRun })
      : null
    const artifact = legacyArchive?.eligible === true
      ? null
      : options.dryRun === true
        ? null
        : await registerMigrationSnapshotArtifactIfCurrent({ projectRoot, snapshotPath: file })
    bytesBefore += result.bytesBefore
    bytesAfter += legacyArchive?.eligible === true ? legacyArchive.archiveBytes : result.bytesAfter
    if (artifact) {
      artifactsRegistered += 1
      artifactBytesRegistered += artifact.bytes
    }
    if (legacyArchive?.eligible === true) {
      legacyBytesBefore += legacyArchive.sourceBytes
      legacyBytesAfter += legacyArchive.archiveBytes
      if (legacyArchive.archived) legacyFilesArchived += 1
      filesCompacted += 1
      artifactsRegistered += legacyArchive.archived ? 1 : 0
      artifactBytesRegistered += legacyArchive.archived ? legacyArchive.archiveBytes : 0
    } else if (result.eligible) filesCompacted += 1
    else if (result.reason !== 'already_compact') {
      unknownFiles += 1
      unknownBytes += result.bytesBefore
    }
  }
  return {
    filesSeen: files.length,
    filesCompacted,
    bytesBefore,
    bytesAfter,
    unknownFiles,
    unknownBytes,
    artifactsRegistered,
    artifactBytesRegistered,
    legacyFilesArchived,
    legacyBytesBefore,
    legacyBytesAfter,
  }
}

async function readJsonIfExists(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readManagedTextFile(file, 'utf8')) as unknown
  } catch (err) {
    if (String(err).includes('ENOENT')) return null
    throw err
  }
}

function taskId(task: unknown): string | null {
  if (!isRecord(task) || typeof task.id !== 'string' || task.id.length === 0) return null
  return task.id
}

function taskStatus(task: unknown): string | null {
  if (!isRecord(task) || typeof task.status !== 'string') return null
  return task.status
}

function queueTasks(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (isRecord(parsed) && Array.isArray(parsed.tasks)) return parsed.tasks
  return []
}

function queueVersion(parsed: unknown): number {
  if (isRecord(parsed) && typeof parsed.version === 'number') return parsed.version
  return 1
}

function safeFileName(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_')
}

async function ensureDirFor(file: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
}

function resolveRepoStateMode(projectRoot: string): 'off' | 'thin' {
  const workspaceRoot = findWorkspaceRoot(projectRoot)
  if (workspaceRoot === null) return 'off'
  try {
    const config = readWorkspaceConfig(workspaceRoot)
    return config.storage?.repoState === 'thin' ? 'thin' : 'off'
  } catch {
    return 'off'
  }
}

async function copyProjectStatePathToLocalHistory(source: string, destination: string): Promise<void> {
  await ensureDirFor(destination)
  await fs.cp(source, destination, { recursive: true, force: true })
}

function evacuationBatchPath(evacuationDir: string, batchId: string, relativePath: string): string {
  return path.join(evacuationDir, 'batches', batchId, relativePath)
}

function relativeStatePath(stateDir: string, sourcePath: string): string {
  const relativePath = path.relative(stateDir, sourcePath)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error(`Project-state evacuation source is outside ${stateDir}: ${sourcePath}`)
  }
  return relativePath
}

function pathDescriptionMatches(
  expected: { kind?: string; bytes: number; sha256: string },
  actual: { kind: string; bytes: number; sha256: string },
): boolean {
  return (expected.kind === undefined || expected.kind === actual.kind)
    && expected.bytes === actual.bytes
    && expected.sha256 === actual.sha256
}

async function copyImmutableProjectStatePath(source: string, destination: string): Promise<void> {
  try {
    const existing = await describePath(destination)
    const sourceDescription = await describePath(source)
    if (!pathDescriptionMatches(sourceDescription, existing)) {
      throw new Error(`Project-state evacuation would overwrite immutable material at ${destination}`)
    }
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await ensureDirFor(destination)
  await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: true })
  const sourceDescription = await describePath(source)
  const destinationDescription = await describePath(destination)
  if (!pathDescriptionMatches(sourceDescription, destinationDescription)) {
    throw new Error(`Project-state evacuation snapshot did not match its source: ${destination}`)
  }
}

async function preserveImmutableEvacuationBatches(
  manifest: ProjectStateEvacuationManifest,
  stateDir: string,
  evacuationDir: string,
): Promise<void> {
  for (const batch of manifest.batches) {
    for (const entry of batch.entries) {
      const relativePath = relativeStatePath(stateDir, entry.source.path)
      const immutablePath = evacuationBatchPath(evacuationDir, batch.id, relativePath)
      if (path.resolve(entry.snapshot.path) === path.resolve(immutablePath)) continue

      const currentSnapshot = await describePath(entry.snapshot.path)
      if (!pathDescriptionMatches(entry.snapshot, currentSnapshot)) {
        throw new Error(`Project-state evacuation snapshot failed integrity verification: ${entry.snapshot.path}`)
      }
      await copyImmutableProjectStatePath(entry.snapshot.path, immutablePath)
      const immutableSnapshot = await describePath(immutablePath)
      entry.snapshot = {
        path: immutablePath,
        bytes: immutableSnapshot.bytes,
        sha256: immutableSnapshot.sha256,
      }
    }
  }
}

async function readEvacuationManifestIfPresent(manifestPath: string): Promise<ProjectStateEvacuationManifest> {
  try {
    return await readEvacuationManifest(manifestPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, batches: [] }
    throw error
  }
}

async function evacuateProjectLocalState(
  projectRoot: string,
  stateDir: string,
  dryRun: boolean,
): Promise<string[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(stateDir)
  } catch (err) {
    if (String(err).includes('ENOENT')) return []
    throw err
  }
  const removed: string[] = []
  const evacuationDir = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation')
  const manifestPath = path.join(evacuationDir, 'manifest.json')
  const manifest: ProjectStateEvacuationManifest = await readEvacuationManifestIfPresent(manifestPath)
  if (!dryRun) await preserveImmutableEvacuationBatches(manifest, stateDir, evacuationDir)
  const batchId = `evacuation-${randomUUID()}`
  const evacuatedEntries: ProjectStateEvacuationEntry[] = []
  const sourcesToRemove: string[] = []
  for (const relativePath of entries) {
    const source = path.join(stateDir, relativePath)
    try {
      await fs.stat(source)
    } catch (err) {
      if (String(err).includes('ENOENT')) continue
      throw err
    }
    removed.push(relativePath)
    if (dryRun) continue
    const immutableDestination = evacuationBatchPath(evacuationDir, batchId, relativePath)
    const destination = path.join(evacuationDir, relativePath)
    const sourceBefore = await describePath(source)
    await copyImmutableProjectStatePath(source, immutableDestination)
    await fs.rm(destination, { recursive: true, force: true })
    await copyProjectStatePathToLocalHistory(immutableDestination, destination)
    const snapshot = await describePath(destination)
    const sourceAfter = await describePath(source)
    if (
      sourceBefore.kind !== snapshot.kind ||
      sourceBefore.bytes !== snapshot.bytes ||
      sourceBefore.sha256 !== snapshot.sha256 ||
      sourceAfter.kind !== sourceBefore.kind ||
      sourceAfter.bytes !== sourceBefore.bytes ||
      sourceAfter.sha256 !== sourceBefore.sha256
    ) {
      throw new Error(`Project-state evacuation changed while copying ${source}`)
    }
    const immutableSnapshot = await describePath(immutableDestination)
    if (!pathDescriptionMatches(sourceBefore, immutableSnapshot)) {
      throw new Error(`Project-state evacuation changed while writing ${immutableDestination}`)
    }
    evacuatedEntries.push({
      kind: sourceBefore.kind,
      source: { path: source, bytes: sourceBefore.bytes, sha256: sourceBefore.sha256 },
      snapshot: { path: destination, bytes: snapshot.bytes, sha256: snapshot.sha256 },
      restore: { status: 'not_verified' },
    })
    try {
      registerProjectHistoricalArtifactIfCurrent(projectRoot, {
        artifactId: `evacuation:${path.relative(getProjectLocalHistoryDir(projectRoot), destination).replaceAll(path.sep, '/')}:${snapshot.sha256}`,
        kind: 'evacuation_batch',
        owner: 'project-state-compaction',
        logicalRef: path.relative(getProjectLocalHistoryDir(projectRoot), destination).replaceAll(path.sep, '/'),
        bytes: snapshot.bytes,
        sha256: snapshot.sha256,
        retentionClass: 'archive',
        state: 'active',
        lastVerifiedAt: new Date().toISOString(),
      })
    } catch {
      // Evacuation integrity is enforced by its manifest; registry accounting
      // must not leave a copied source half-evacuated if SQLite is busy.
    }
    sourcesToRemove.push(source)
  }
  if (!dryRun && evacuatedEntries.length > 0) {
    manifest.batches.push({
      id: batchId,
      createdAt: new Date().toISOString(),
      entries: evacuatedEntries,
    })
    await writeEvacuationManifest(manifestPath, manifest)
    for (const source of sourcesToRemove) {
      await fs.rm(source, { recursive: true, force: true })
    }
  }
  if (!dryRun) {
    try {
      await fs.rmdir(stateDir)
    } catch (err) {
      if (!String(err).includes('ENOTEMPTY') && !String(err).includes('ENOENT')) throw err
    }
  }
  return removed
}

async function copyRepoLocalProjectStateToSystemState(projectRoot: string, stateDir: string, dryRun: boolean): Promise<void> {
  if (dryRun) return
  let entries: Array<{ name: string }>
  try {
    entries = await fs.readdir(stateDir, { withFileTypes: true })
  } catch (err) {
    if (String(err).includes('ENOENT')) return
    throw err
  }
  for (const entry of entries) {
    const source = path.join(stateDir, entry.name)
    const destination = getProjectSystemStatePath(projectRoot, entry.name)
    if (existsSync(destination)) continue
    await ensureDirFor(destination)
    await fs.cp(source, destination, { recursive: true })
  }
}

/**
 * Keep one bounded archival explanation, not a second full task snapshot.
 * Older versions called this file "full evidence" and copied every bulky
 * task history field into it. The compact archived task is the project
 * record; this file exists only as a local evidence companion.
 */
async function writeArchiveEvidence(projectRoot: string, id: string, task: unknown, dryRun: boolean): Promise<void> {
  if (dryRun) return
  const evidencePath = path.join(getProjectTaskLocalHistoryDir(projectRoot, id), 'archive-evidence.json')
  await ensureDirFor(evidencePath)
  const compact = compactTaskRecordForProjectArchive(task)
  const existing = await readJsonIfExists(evidencePath)
  if (JSON.stringify(existing) !== JSON.stringify(compact)) {
    await writeManagedTextFile(evidencePath, `${JSON.stringify(compact, null, 2)}\n`, 'utf8')
  }
}

async function writeBoundaryEvidence(
  projectRoot: string,
  taskId: string,
  removedEvidence: Record<string, unknown>,
  dryRun: boolean,
): Promise<void> {
  if (dryRun || Object.keys(removedEvidence).length === 0) return
  const evidencePath = path.join(getProjectTaskLocalHistoryDir(projectRoot, taskId), 'project-state-boundary-evidence.json')
  await ensureDirFor(evidencePath)
  await writeManagedTextFile(evidencePath, `${JSON.stringify({
    version: 1,
    taskId,
    removedAt: new Date().toISOString(),
    removedEvidence,
  }, null, 2)}\n`, 'utf8')
}

function compactTaskRecordForProjectArchive(task: unknown): unknown {
  if (!isRecord(task)) return task
  const next = JSON.parse(JSON.stringify(task)) as Record<string, unknown>
  const trimmedFields: Array<{ field: string; total: number; kept: number; localHistoryRef: string }> = []
  const id = typeof next.id === 'string' ? next.id : 'unknown'

  for (const field of BULKY_TASK_FIELDS) {
    const value = next[field]
    if (!Array.isArray(value) || value.length <= COMMITTED_ARCHIVE_ITEMS_PER_FIELD) continue
    next[field] = value.slice(-COMMITTED_ARCHIVE_ITEMS_PER_FIELD)
    trimmedFields.push({
      field,
      total: value.length,
      kept: COMMITTED_ARCHIVE_ITEMS_PER_FIELD,
      localHistoryRef: path.join('tasks', safeFileName(id), 'archive-evidence.json'),
    })
  }

  if (trimmedFields.length > 0) {
    next.archivedEvidence = {
      localHistoryRef: path.join('tasks', safeFileName(id), 'archive-evidence.json'),
      trimmedFields,
    }
  }

  return next
}

async function compactArchiveFiles(projectRoot: string, stateDir: string, dryRun: boolean): Promise<number> {
  const archiveDir = path.join(stateDir, 'tasks', 'archive')
  let entries: string[]
  try {
    entries = await fs.readdir(archiveDir)
  } catch (err) {
    if (String(err).includes('ENOENT')) return 0
    throw err
  }

  let compacted = 0
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const file = path.join(archiveDir, entry)
    const parsed = await readJsonIfExists(file)
    const id = taskId(parsed) ?? entry.replace(/\.json$/i, '')
    if (isRecord(parsed) && isRecord(parsed.archivedEvidence)) continue
    await writeArchiveEvidence(projectRoot, id, parsed, dryRun)
    const compact = compactTaskRecordForProjectArchive(parsed)
    if (JSON.stringify(compact) === JSON.stringify(parsed)) continue
    compacted += 1
    if (!dryRun) {
      await writeManagedTextFile(file, `${JSON.stringify(compact, null, 2)}\n`, 'utf8')
    }
  }
  return compacted
}

/** Migrate the current local-history archive companion out of full-task shape. */
async function compactArchiveEvidenceFiles(projectRoot: string, dryRun: boolean): Promise<number> {
  const tasksDir = path.join(getProjectLocalHistoryDir(projectRoot), 'tasks')
  let entries: Array<{ name: string; isDirectory(): boolean }>
  try {
    entries = await fs.readdir(tasksDir, { withFileTypes: true })
  } catch (err) {
    if (String(err).includes('ENOENT')) return 0
    throw err
  }

  let compacted = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const evidencePath = path.join(tasksDir, entry.name, 'archive-evidence.json')
    const parsed = await readJsonIfExists(evidencePath)
    if (!isRecord(parsed)) continue
    const compact = compactTaskRecordForProjectArchive(parsed)
    if (JSON.stringify(compact) === JSON.stringify(parsed)) continue
    compacted += 1
    if (!dryRun) await writeManagedTextFile(evidencePath, `${JSON.stringify(compact, null, 2)}\n`, 'utf8')
  }
  return compacted
}

async function compactTasks(
  projectRoot: string,
  tasksPath: string,
  parsed: unknown | null,
  dryRun: boolean,
  expectedQueueRevision?: number | null,
): Promise<{
  active: number
  archived: number
  compactedArchives: number
  activeSanitized: number
  forbiddenBefore: number
  forbiddenAfter: number
  forbiddenFindings: ForbiddenProjectTaskFieldFinding[]
  removedEvidenceBytes: number
}> {
  const taskStateDir = path.dirname(tasksPath)
  const compactedArchives = await compactArchiveFiles(projectRoot, taskStateDir, dryRun)
  if (parsed === null) {
    return {
      active: 0,
      archived: 0,
      compactedArchives,
      activeSanitized: 0,
      forbiddenBefore: 0,
      forbiddenAfter: 0,
      forbiddenFindings: [],
      removedEvidenceBytes: 0,
    }
  }

  const forbiddenFindings = findForbiddenProjectTaskFields(parsed)
  const tasks = queueTasks(parsed)
  const preserveCanonicalTasks = readProjectStateDatabaseCurrentAuthority(projectRoot) === 'database'
  const activeTasks: unknown[] = []
  const archivedTasks: Array<{ id: string; task: unknown }> = []

  for (const task of tasks) {
    const id = taskId(task)
    const status = taskStatus(task)
    // A promoted database keeps completed work as current project state: it
    // supplies release progress, proof history, and orientation. Only the
    // repo-local compatibility shape may move terminal tasks to an archive.
    if (!preserveCanonicalTasks && id && status && TERMINAL_STATUSES.has(status)) {
      archivedTasks.push({ id, task })
    } else {
      activeTasks.push(task)
    }
  }

  const compactQueue = isRecord(parsed)
    ? {
        ...parsed,
        lastUpdated: new Date().toISOString(),
        tasks: activeTasks,
      }
    : {
        version: queueVersion(parsed),
        lastUpdated: new Date().toISOString(),
        tasks: activeTasks,
      }
  const sanitized = sanitizeTaskQueueForProjectWrite(compactQueue)
  for (const item of sanitized.removedByTask) {
    await writeBoundaryEvidence(projectRoot, item.taskId, item.removedEvidence, dryRun)
  }

  if (!dryRun && (archivedTasks.length > 0 || sanitized.taskDefinitionsRewritten > 0 || forbiddenFindings.length > 0)) {
    const archiveDir = path.join(taskStateDir, 'tasks', 'archive')
    await fs.mkdir(archiveDir, { recursive: true })
    for (const item of archivedTasks) {
      await writeArchiveEvidence(projectRoot, item.id, item.task, dryRun)
      await writeManagedTextFile(
        path.join(archiveDir, `${safeFileName(item.id)}.json`),
        `${JSON.stringify(compactTaskRecordForProjectArchive(item.task), null, 2)}\n`,
        'utf8',
      )
    }

    const indexPath = path.join(taskStateDir, 'tasks', 'index.json')
    const index = {
      version: 1,
      updatedAt: new Date().toISOString(),
      activeTaskIds: activeTasks.map(taskId).filter((id): id is string => id !== null),
      archivedTaskIds: archivedTasks.map(item => item.id),
      archivedCount: archivedTasks.length,
    }
    await ensureDirFor(indexPath)
    await writeManagedTextFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
    if (readProjectStateDatabaseCurrentAuthority(projectRoot) === 'database') {
      await writeProjectTaskQueueAtCurrentStateBoundary(tasksPath, compactQueue, {
        projectId: path.basename(projectRoot),
        projectRoot,
        ...(expectedQueueRevision !== undefined ? { expectedQueueRevision } : {}),
      })
    } else {
      // A project that has not yet been promoted still has one current queue
      // in its configured state directory. Keep this explicit bootstrap path
      // separate from the promoted SQLite writer; normal runtime reads never
      // use this file after promotion.
      await writeManagedTextFile(tasksPath, `${JSON.stringify(sanitized.queue, null, 2)}\n`, 'utf8')
    }
  }

  return {
    active: activeTasks.length,
    archived: archivedTasks.length,
    compactedArchives,
    activeSanitized: sanitized.taskDefinitionsRewritten,
    forbiddenBefore: forbiddenFindings.length,
    forbiddenAfter: findForbiddenProjectTaskFields(sanitized.queue).length,
    forbiddenFindings,
    removedEvidenceBytes: sanitized.removedEvidenceBytes,
  }
}

function splitProgressBlocks(content: string): { kept: string; heartbeats: string[] } {
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const blocks: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (/^###\s+/.test(line) && current.length > 0) {
      blocks.push(current.join('\n').trim())
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) blocks.push(current.join('\n').trim())

  const kept: string[] = []
  const heartbeats: string[] = []
  for (const block of blocks) {
    if (/\bHEARTBEAT\b/.test(block)) {
      heartbeats.push(block)
    } else if (block.trim().length > 0) {
      kept.push(block)
    }
  }
  return {
    kept: `${kept.join('\n\n').trimEnd()}\n`,
    heartbeats,
  }
}

async function compactProgress(projectRoot: string, stateDir: string, dryRun: boolean): Promise<number> {
  const progressPath = path.join(stateDir, 'PROGRESS.md')
  let content: string
  try {
    content = await readManagedTextFile(progressPath, 'utf8')
  } catch (err) {
    if (String(err).includes('ENOENT')) return 0
    throw err
  }
  const { kept, heartbeats } = splitProgressBlocks(content)
  if (heartbeats.length === 0) return 0

  if (!dryRun) {
    const heartbeatPath = getProjectProgressHeartbeatsPath(projectRoot)
    await ensureDirFor(heartbeatPath)
    await appendManagedTextFile(
      heartbeatPath,
      `\n# Progress heartbeats moved from committed project state\n\n${heartbeats.join('\n\n')}\n`,
      'utf8',
    )
    await writeManagedTextFile(progressPath, kept, 'utf8')
  }

  return heartbeats.length
}

async function compactCodebaseMap(projectRoot: string, stateDir: string, dryRun: boolean): Promise<boolean> {
  const file = path.join(stateDir, 'codebase-map.yaml')
  const size = await fileSize(file)
  if (size <= CODEBASE_MAP_COMPACT_THRESHOLD_BYTES) return false

  const raw = await readManagedTextFile(file, 'utf8')
  const parsed = parseYaml(raw) as unknown
  if (!isRecord(parsed) || !isRecord(parsed.files)) return false
  const entries = Object.entries(parsed.files)
  if (entries.length <= CODEBASE_MAP_COMMITTED_FILE_LIMIT) return false
  if (isRecord(parsed.compacted) && typeof parsed.compacted.fullLocalHistoryRef === 'string') return false

  const keptEntries = entries.slice(0, CODEBASE_MAP_COMMITTED_FILE_LIMIT)
  const compact = {
    ...parsed,
    files: Object.fromEntries(keptEntries),
    compacted: {
      fullLocalHistoryRef: 'codebase-map/codebase-map.full.yaml',
      originalBytes: size,
      originalFileCount: entries.length,
      committedFileCount: keptEntries.length,
      reason: 'Committed codebase map exceeded the project-state size budget.',
    },
  }

  if (!dryRun) {
    const fullPath = path.join(getProjectLocalHistoryDir(projectRoot), 'codebase-map', 'codebase-map.full.yaml')
    await ensureDirFor(fullPath)
    if (!existsSync(fullPath)) {
      await writeManagedTextFile(fullPath, raw, 'utf8')
    }
    await writeManagedTextFile(file, stringifyYaml(compact), 'utf8')
  }

  return true
}

export async function compactProjectState(
  opts: ProjectStateCompactionOptions,
): Promise<ProjectStateCompactionResult> {
  const projectRoot = path.resolve(opts.projectRoot)
  const stateDir = getProjectStateDir(projectRoot)
  const localHistoryDir = getProjectLocalHistoryDir(projectRoot)
  const dryRun = opts.dryRun ?? true
  const repoStateMode = resolveRepoStateMode(projectRoot)
  const databaseAuthority = readProjectStateDatabaseCurrentAuthority(projectRoot) === 'database'
  // Promoted projects own queue/detail state in system-local storage. The
  // repository .guildhall directory remains a source/evacuation boundary and
  // must not be mistaken for the current queue.
  const tasksPath = databaseAuthority
    ? getProjectSystemStatePath(projectRoot, 'TASKS.json')
    : path.join(stateDir, 'TASKS.json')
  const progressPath = path.join(stateDir, 'PROGRESS.md')
  const codebaseMapPath = path.join(stateDir, 'codebase-map.yaml')
  const databaseQueueRead = databaseAuthority
    ? readProjectStateDatabaseQueueWithRevision(tasksPath)
    : null
  const parsedTasks = databaseQueueRead?.definition ?? await readJsonIfExists(tasksPath)
  if (databaseAuthority && parsedTasks === null) {
    throw new Error(`Cannot compact project state: authoritative detail store is unavailable for ${projectRoot}`)
  }
  const activeTaskIds = new Set(
    queueTasks(parsedTasks)
      .filter(task => {
        const status = taskStatus(task)
        return status !== null && !TERMINAL_STATUSES.has(status)
      })
      .map(taskId)
      .filter((id): id is string => id !== null),
  )
  const exploringHistory = await compactExploringTranscripts({
    projectRoot,
    dryRun,
  })
  const sessionCompaction = compactProjectSessionSnapshots(projectRoot, {
    dryRun,
    activeTaskIds,
  })
  const contextDebugCompaction = await compactProjectContextDebug(projectRoot, { dryRun, activeTaskIds })
  const taskEvidenceCompaction = await compactTaskEvidenceHistory(projectRoot, { dryRun })
  const databaseEvidenceCompaction = compactProjectStateDatabaseEvidence(projectRoot, { dryRun })
  const databaseVacuum = vacuumProjectStateDatabase(projectRoot, { dryRun })
  const recentEventsCompaction = compactProjectRecentEvents(projectRoot, { dryRun })
  const memoryEventsCompaction = await consolidateProjectMemoryEvents(projectRoot, { dryRun })
  const migrationSnapshotCompaction = await compactProjectMigrationSnapshots(projectRoot, { dryRun })
  const reviewTransportBackfill = await backfillReviewTransportArtifacts({ projectRoot, dryRun })
  const evacuationBackfill = await backfillEvacuationArtifacts({ projectRoot, dryRun })
  const archiveEvidenceFilesCompacted = await compactArchiveEvidenceFiles(projectRoot, dryRun)
  const codebaseMapHistoryCompaction = await compactCodebaseMapHistory(projectRoot, { dryRun })
  const heartbeatPath = getProjectProgressHeartbeatsPath(projectRoot)
  let progressHeartbeatCompaction = await compactProjectProgressHeartbeats(heartbeatPath, { dryRun })
  const bytesBefore = await fileSize(tasksPath) + await fileSize(progressPath) + await fileSize(codebaseMapPath)
  const taskCompaction = databaseAuthority || repoStateMode === 'thin'
    ? await compactTasks(projectRoot, tasksPath, parsedTasks, dryRun, databaseQueueRead?.revision)
    : null
  if (repoStateMode === 'off') {
    const tasks = queueTasks(parsedTasks)
    const forbiddenFindings = findForbiddenProjectTaskFields(parsedTasks)
    await copyRepoLocalProjectStateToSystemState(projectRoot, stateDir, dryRun)
    const evacuatedProjectStatePaths = await evacuateProjectLocalState(projectRoot, stateDir, dryRun)
    const evacuationManifestPath = !dryRun && evacuatedProjectStatePaths.length > 0
      ? path.join(localHistoryDir, 'project-state-evacuation', 'manifest.json')
      : null
    const bytesAfter = dryRun
      ? bytesBefore
      : await fileSize(tasksPath) + await fileSize(progressPath) + await fileSize(codebaseMapPath)
    return {
      projectRoot,
      stateDir,
      localHistoryDir,
      dryRun,
      repoStateMode,
      evacuatedProjectStatePaths,
      evacuationManifestPath,
      activeTasksKept: taskCompaction?.active ?? 0,
      archivedTasks: taskCompaction?.archived ?? tasks.filter(task => {
        const status = taskStatus(task)
        return status !== null && TERMINAL_STATUSES.has(status)
      }).length,
      archivedTaskFilesCompacted: taskCompaction?.compactedArchives ?? 0,
      archiveEvidenceFilesCompacted,
      activeTasksSanitized: taskCompaction?.activeSanitized ?? 0,
      forbiddenTaskFieldsBefore: taskCompaction?.forbiddenBefore ?? forbiddenFindings.length,
      forbiddenTaskFieldsAfter: taskCompaction?.forbiddenAfter ?? 0,
      forbiddenTaskFieldFindings: taskCompaction?.forbiddenFindings ?? forbiddenFindings,
      removedEvidenceBytes: taskCompaction?.removedEvidenceBytes ?? 0,
      codebaseMapCompacted: false,
      codebaseMapHistoryBytesBefore: codebaseMapHistoryCompaction.bytesBefore,
      codebaseMapHistoryBytesAfter: codebaseMapHistoryCompaction.bytesAfter,
      codebaseMapHistoryRecordsCompacted: Math.max(0, codebaseMapHistoryCompaction.recordsBefore - codebaseMapHistoryCompaction.recordsAfter),
      progressHeartbeatsMoved: 0,
      progressHeartbeatBytesBefore: progressHeartbeatCompaction.bytesBefore,
      progressHeartbeatBytesAfter: progressHeartbeatCompaction.bytesAfter,
      progressHeartbeatRecordsCompacted: Math.max(0, progressHeartbeatCompaction.recordsBefore - progressHeartbeatCompaction.recordsAfter),
      exploringHistoryFilesSeen: exploringHistory.filesSeen,
      exploringHistoryFilesCompacted: exploringHistory.filesCompacted,
      exploringHistoryBytesBefore: exploringHistory.bytesBefore,
      exploringHistoryBytesAfter: exploringHistory.bytesAfter,
      sessionFilesSeen: sessionCompaction.filesSeen,
      sessionFilesCompacted: sessionCompaction.filesCompacted,
      sessionPendingFilesPreserved: sessionCompaction.pendingFilesPreserved,
      sessionBytesBefore: sessionCompaction.bytesBefore,
      sessionBytesAfter: sessionCompaction.bytesAfter,
      contextDebugLedgerBytesBefore: contextDebugCompaction.ledgerBytesBefore,
      contextDebugLedgerBytesAfter: contextDebugCompaction.ledgerBytesAfter,
      contextDebugLedgerRecordsCompacted: contextDebugCompaction.ledgerRecordsCompacted,
      contextDebugSnapshotFilesCompacted: contextDebugCompaction.snapshotFilesCompacted,
      contextDebugSnapshotBytesBefore: contextDebugCompaction.snapshotBytesBefore,
      contextDebugSnapshotBytesAfter: contextDebugCompaction.snapshotBytesAfter,
      contextDebugDuplicateEventFilesRemoved: contextDebugCompaction.duplicateEventFilesRemoved,
      contextDebugDuplicateEventBytesBefore: contextDebugCompaction.duplicateEventBytesBefore,
      contextDebugDuplicateEventBytesAfter: contextDebugCompaction.duplicateEventBytesAfter,
      taskEvidenceFilesSeen: taskEvidenceCompaction.filesSeen,
      taskEvidenceFilesCompacted: taskEvidenceCompaction.filesCompacted,
      taskEvidenceRecordsCompacted: taskEvidenceCompaction.recordsCompacted,
      taskEvidenceBytesBefore: taskEvidenceCompaction.bytesBefore,
      taskEvidenceBytesAfter: taskEvidenceCompaction.bytesAfter,
      taskProofRowsCompacted: databaseEvidenceCompaction.taskProofRowsCompacted,
      currentEvidenceRowsCompacted: databaseEvidenceCompaction.currentRowsCompacted,
      databaseEvidenceBytesBefore: databaseEvidenceCompaction.bytesBefore,
      databaseEvidenceBytesAfter: databaseEvidenceCompaction.bytesAfter,
      databaseBytesBefore: databaseVacuum.bytesBefore,
      databaseBytesAfter: databaseVacuum.bytesAfter,
      databaseVacuumed: databaseVacuum.vacuumed,
      recentEventBytesBefore: recentEventsCompaction.bytesBefore,
      recentEventBytesAfter: recentEventsCompaction.bytesAfter,
      recentEventRecordsCompacted: recentEventsCompaction.recordsCompacted,
      memoryEventFilesSeen: memoryEventsCompaction.filesSeen,
      memoryEventFilesRemoved: memoryEventsCompaction.filesRemoved,
      memoryEventRecordsSeen: memoryEventsCompaction.eventsSeen,
      memoryEventRecordsRetained: memoryEventsCompaction.eventsRetained,
      memoryEventBytesBefore: memoryEventsCompaction.bytesBefore,
      memoryEventBytesAfter: memoryEventsCompaction.bytesAfter,
      migrationSnapshotFilesSeen: migrationSnapshotCompaction.filesSeen,
      migrationSnapshotFilesCompacted: migrationSnapshotCompaction.filesCompacted,
      migrationSnapshotBytesBefore: migrationSnapshotCompaction.bytesBefore,
      migrationSnapshotBytesAfter: migrationSnapshotCompaction.bytesAfter,
      migrationSnapshotUnknownFiles: migrationSnapshotCompaction.unknownFiles,
      migrationSnapshotUnknownBytes: migrationSnapshotCompaction.unknownBytes,
      migrationSnapshotArtifactsRegistered: migrationSnapshotCompaction.artifactsRegistered,
      migrationSnapshotArtifactBytesRegistered: migrationSnapshotCompaction.artifactBytesRegistered,
      migrationSnapshotLegacyFilesArchived: migrationSnapshotCompaction.legacyFilesArchived,
      migrationSnapshotLegacyBytesBefore: migrationSnapshotCompaction.legacyBytesBefore,
      migrationSnapshotLegacyBytesAfter: migrationSnapshotCompaction.legacyBytesAfter,
      reviewTransportFilesSeen: reviewTransportBackfill.filesSeen,
      reviewTransportArtifactsRegistered: reviewTransportBackfill.filesRegistered,
      reviewTransportArtifactBytesRegistered: reviewTransportBackfill.bytesRegistered,
      evacuationFilesSeen: evacuationBackfill.filesSeen,
      evacuationArtifactsRegistered: evacuationBackfill.artifactsRegistered,
      evacuationArtifactBytesRegistered: evacuationBackfill.artifactBytesRegistered,
      bytesBefore,
      bytesAfter,
    }
  }
  const tasks = taskCompaction ?? await compactTasks(projectRoot, tasksPath, parsedTasks, dryRun)
  const progressHeartbeatsMoved = await compactProgress(projectRoot, stateDir, dryRun)
  progressHeartbeatCompaction = await compactProjectProgressHeartbeats(heartbeatPath, { dryRun })
  const codebaseMapCompacted = await compactCodebaseMap(projectRoot, stateDir, dryRun)
  const bytesAfter = dryRun
    ? bytesBefore
    : await fileSize(tasksPath) + await fileSize(progressPath) + await fileSize(codebaseMapPath)

  return {
    projectRoot,
    stateDir,
    localHistoryDir,
    dryRun,
    repoStateMode,
    evacuatedProjectStatePaths: [],
    evacuationManifestPath: null,
    activeTasksKept: tasks.active,
    archivedTasks: tasks.archived,
    archivedTaskFilesCompacted: tasks.compactedArchives,
    archiveEvidenceFilesCompacted,
    activeTasksSanitized: tasks.activeSanitized,
    forbiddenTaskFieldsBefore: tasks.forbiddenBefore,
    forbiddenTaskFieldsAfter: tasks.forbiddenAfter,
    forbiddenTaskFieldFindings: tasks.forbiddenFindings,
    removedEvidenceBytes: tasks.removedEvidenceBytes,
    codebaseMapCompacted,
    codebaseMapHistoryBytesBefore: codebaseMapHistoryCompaction.bytesBefore,
    codebaseMapHistoryBytesAfter: codebaseMapHistoryCompaction.bytesAfter,
    codebaseMapHistoryRecordsCompacted: Math.max(0, codebaseMapHistoryCompaction.recordsBefore - codebaseMapHistoryCompaction.recordsAfter),
    progressHeartbeatsMoved,
    progressHeartbeatBytesBefore: progressHeartbeatCompaction.bytesBefore,
    progressHeartbeatBytesAfter: progressHeartbeatCompaction.bytesAfter,
    progressHeartbeatRecordsCompacted: Math.max(0, progressHeartbeatCompaction.recordsBefore - progressHeartbeatCompaction.recordsAfter),
    exploringHistoryFilesSeen: exploringHistory.filesSeen,
    exploringHistoryFilesCompacted: exploringHistory.filesCompacted,
    exploringHistoryBytesBefore: exploringHistory.bytesBefore,
    exploringHistoryBytesAfter: exploringHistory.bytesAfter,
    sessionFilesSeen: sessionCompaction.filesSeen,
    sessionFilesCompacted: sessionCompaction.filesCompacted,
    sessionPendingFilesPreserved: sessionCompaction.pendingFilesPreserved,
    sessionBytesBefore: sessionCompaction.bytesBefore,
    sessionBytesAfter: sessionCompaction.bytesAfter,
    contextDebugLedgerBytesBefore: contextDebugCompaction.ledgerBytesBefore,
    contextDebugLedgerBytesAfter: contextDebugCompaction.ledgerBytesAfter,
    contextDebugLedgerRecordsCompacted: contextDebugCompaction.ledgerRecordsCompacted,
    contextDebugSnapshotFilesCompacted: contextDebugCompaction.snapshotFilesCompacted,
    contextDebugSnapshotBytesBefore: contextDebugCompaction.snapshotBytesBefore,
    contextDebugSnapshotBytesAfter: contextDebugCompaction.snapshotBytesAfter,
    contextDebugDuplicateEventFilesRemoved: contextDebugCompaction.duplicateEventFilesRemoved,
    contextDebugDuplicateEventBytesBefore: contextDebugCompaction.duplicateEventBytesBefore,
    contextDebugDuplicateEventBytesAfter: contextDebugCompaction.duplicateEventBytesAfter,
    taskEvidenceFilesSeen: taskEvidenceCompaction.filesSeen,
    taskEvidenceFilesCompacted: taskEvidenceCompaction.filesCompacted,
    taskEvidenceRecordsCompacted: taskEvidenceCompaction.recordsCompacted,
    taskEvidenceBytesBefore: taskEvidenceCompaction.bytesBefore,
    taskEvidenceBytesAfter: taskEvidenceCompaction.bytesAfter,
    taskProofRowsCompacted: databaseEvidenceCompaction.taskProofRowsCompacted,
    currentEvidenceRowsCompacted: databaseEvidenceCompaction.currentRowsCompacted,
    databaseEvidenceBytesBefore: databaseEvidenceCompaction.bytesBefore,
    databaseEvidenceBytesAfter: databaseEvidenceCompaction.bytesAfter,
    databaseBytesBefore: databaseVacuum.bytesBefore,
    databaseBytesAfter: databaseVacuum.bytesAfter,
    databaseVacuumed: databaseVacuum.vacuumed,
    recentEventBytesBefore: recentEventsCompaction.bytesBefore,
    recentEventBytesAfter: recentEventsCompaction.bytesAfter,
    recentEventRecordsCompacted: recentEventsCompaction.recordsCompacted,
    memoryEventFilesSeen: memoryEventsCompaction.filesSeen,
    memoryEventFilesRemoved: memoryEventsCompaction.filesRemoved,
    memoryEventRecordsSeen: memoryEventsCompaction.eventsSeen,
    memoryEventRecordsRetained: memoryEventsCompaction.eventsRetained,
    memoryEventBytesBefore: memoryEventsCompaction.bytesBefore,
    memoryEventBytesAfter: memoryEventsCompaction.bytesAfter,
    migrationSnapshotFilesSeen: migrationSnapshotCompaction.filesSeen,
    migrationSnapshotFilesCompacted: migrationSnapshotCompaction.filesCompacted,
    migrationSnapshotBytesBefore: migrationSnapshotCompaction.bytesBefore,
    migrationSnapshotBytesAfter: migrationSnapshotCompaction.bytesAfter,
    migrationSnapshotUnknownFiles: migrationSnapshotCompaction.unknownFiles,
    migrationSnapshotUnknownBytes: migrationSnapshotCompaction.unknownBytes,
    migrationSnapshotArtifactsRegistered: migrationSnapshotCompaction.artifactsRegistered,
    migrationSnapshotArtifactBytesRegistered: migrationSnapshotCompaction.artifactBytesRegistered,
    migrationSnapshotLegacyFilesArchived: migrationSnapshotCompaction.legacyFilesArchived,
    migrationSnapshotLegacyBytesBefore: migrationSnapshotCompaction.legacyBytesBefore,
    migrationSnapshotLegacyBytesAfter: migrationSnapshotCompaction.legacyBytesAfter,
    reviewTransportFilesSeen: reviewTransportBackfill.filesSeen,
    reviewTransportArtifactsRegistered: reviewTransportBackfill.filesRegistered,
    reviewTransportArtifactBytesRegistered: reviewTransportBackfill.bytesRegistered,
    evacuationFilesSeen: evacuationBackfill.filesSeen,
    evacuationArtifactsRegistered: evacuationBackfill.artifactsRegistered,
    evacuationArtifactBytesRegistered: evacuationBackfill.artifactBytesRegistered,
    bytesBefore,
    bytesAfter,
  }
}
