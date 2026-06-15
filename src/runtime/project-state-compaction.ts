import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
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
  getProjectTaskLocalHistoryDir,
} from '@guildhall/sessions'
import {
  findForbiddenProjectTaskFields,
  sanitizeTaskQueueForProjectWrite,
  type ForbiddenProjectTaskFieldFinding,
} from './project-state-boundary.js'

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
  activeTasksKept: number
  archivedTasks: number
  archivedTaskFilesCompacted: number
  activeTasksSanitized: number
  forbiddenTaskFieldsBefore: number
  forbiddenTaskFieldsAfter: number
  forbiddenTaskFieldFindings: ForbiddenProjectTaskFieldFinding[]
  removedEvidenceBytes: number
  codebaseMapCompacted: boolean
  progressHeartbeatsMoved: number
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
    const destination = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', relativePath)
    await copyProjectStatePathToLocalHistory(source, destination)
    await fs.rm(source, { recursive: true, force: true })
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

async function writeFullTaskEvidence(projectRoot: string, id: string, task: unknown, dryRun: boolean): Promise<void> {
  if (dryRun) return
  const evidencePath = path.join(getProjectTaskLocalHistoryDir(projectRoot, id), 'archive-evidence.json')
  await ensureDirFor(evidencePath)
  if (!existsSync(evidencePath)) {
    await writeManagedTextFile(evidencePath, `${JSON.stringify(task, null, 2)}\n`, 'utf8')
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
    await writeFullTaskEvidence(projectRoot, id, parsed, dryRun)
    const compact = compactTaskRecordForProjectArchive(parsed)
    if (JSON.stringify(compact) === JSON.stringify(parsed)) continue
    compacted += 1
    if (!dryRun) {
      await writeManagedTextFile(file, `${JSON.stringify(compact, null, 2)}\n`, 'utf8')
    }
  }
  return compacted
}

async function compactTasks(
  projectRoot: string,
  stateDir: string,
  dryRun: boolean,
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
  const tasksPath = path.join(stateDir, 'TASKS.json')
  const parsed = await readJsonIfExists(tasksPath)
  const compactedArchives = await compactArchiveFiles(projectRoot, stateDir, dryRun)
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
  const activeTasks: unknown[] = []
  const archivedTasks: Array<{ id: string; task: unknown }> = []

  for (const task of tasks) {
    const id = taskId(task)
    const status = taskStatus(task)
    if (id && status && TERMINAL_STATUSES.has(status)) {
      archivedTasks.push({ id, task })
    } else {
      activeTasks.push(task)
    }
  }

  const compactQueue = {
    version: queueVersion(parsed),
    lastUpdated: new Date().toISOString(),
    tasks: activeTasks,
  }
  const sanitized = sanitizeTaskQueueForProjectWrite(compactQueue)
  for (const item of sanitized.removedByTask) {
    await writeBoundaryEvidence(projectRoot, item.taskId, item.removedEvidence, dryRun)
  }

  if (!dryRun && (archivedTasks.length > 0 || sanitized.taskDefinitionsRewritten > 0 || forbiddenFindings.length > 0)) {
    const archiveDir = path.join(stateDir, 'tasks', 'archive')
    await fs.mkdir(archiveDir, { recursive: true })
    for (const item of archivedTasks) {
      await writeFullTaskEvidence(projectRoot, item.id, item.task, dryRun)
      await writeManagedTextFile(
        path.join(archiveDir, `${safeFileName(item.id)}.json`),
        `${JSON.stringify(compactTaskRecordForProjectArchive(item.task), null, 2)}\n`,
        'utf8',
      )
    }

    const indexPath = path.join(stateDir, 'tasks', 'index.json')
    const index = {
      version: 1,
      updatedAt: new Date().toISOString(),
      activeTaskIds: activeTasks.map(taskId).filter((id): id is string => id !== null),
      archivedTaskIds: archivedTasks.map(item => item.id),
      archivedCount: archivedTasks.length,
    }
    await ensureDirFor(indexPath)
    await writeManagedTextFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
    await writeManagedTextFile(tasksPath, `${JSON.stringify(sanitized.queue, null, 2)}\n`, 'utf8')
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
    const snapshotPath = path.join(getProjectLocalHistoryDir(projectRoot), 'progress', 'PROGRESS.before-compaction.md')
    const heartbeatPath = getProjectProgressHeartbeatsPath(projectRoot)
    await ensureDirFor(snapshotPath)
    if (!existsSync(snapshotPath)) {
      await writeManagedTextFile(snapshotPath, content, 'utf8')
    }
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
  const tasksPath = path.join(stateDir, 'TASKS.json')
  const progressPath = path.join(stateDir, 'PROGRESS.md')
  const codebaseMapPath = path.join(stateDir, 'codebase-map.yaml')
  const bytesBefore = await fileSize(tasksPath) + await fileSize(progressPath) + await fileSize(codebaseMapPath)
  if (repoStateMode === 'off') {
    const parsedTasks = await readJsonIfExists(tasksPath)
    const tasks = queueTasks(parsedTasks)
    const forbiddenFindings = findForbiddenProjectTaskFields(parsedTasks)
    await copyRepoLocalProjectStateToSystemState(projectRoot, stateDir, dryRun)
    const evacuatedProjectStatePaths = await evacuateProjectLocalState(projectRoot, stateDir, dryRun)
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
      activeTasksKept: 0,
      archivedTasks: tasks.filter(task => {
        const status = taskStatus(task)
        return status !== null && TERMINAL_STATUSES.has(status)
      }).length,
      archivedTaskFilesCompacted: 0,
      activeTasksSanitized: 0,
      forbiddenTaskFieldsBefore: forbiddenFindings.length,
      forbiddenTaskFieldsAfter: 0,
      forbiddenTaskFieldFindings: forbiddenFindings,
      removedEvidenceBytes: 0,
      codebaseMapCompacted: false,
      progressHeartbeatsMoved: 0,
      bytesBefore,
      bytesAfter,
    }
  }
  const tasks = await compactTasks(projectRoot, stateDir, dryRun)
  const progressHeartbeatsMoved = await compactProgress(projectRoot, stateDir, dryRun)
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
    activeTasksKept: tasks.active,
    archivedTasks: tasks.archived,
    archivedTaskFilesCompacted: tasks.compactedArchives,
    activeTasksSanitized: tasks.activeSanitized,
    forbiddenTaskFieldsBefore: tasks.forbiddenBefore,
    forbiddenTaskFieldsAfter: tasks.forbiddenAfter,
    forbiddenTaskFieldFindings: tasks.forbiddenFindings,
    removedEvidenceBytes: tasks.removedEvidenceBytes,
    codebaseMapCompacted,
    progressHeartbeatsMoved,
    bytesBefore,
    bytesAfter,
  }
}
