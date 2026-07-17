import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { gzipSync, gunzipSync } from 'node:zlib'
import path from 'node:path'
import { createInterface } from 'node:readline'
import {
  TaskEvidenceEvent,
  compactTaskEvidenceEvent,
  type TaskEvidenceKind,
  TaskRuntimeStateStore,
  TaskWorkspaceStateStore,
  type TaskRuntimeState,
  type TaskWorkspaceState,
} from '@guildhall/core'
import { atomicWriteBytes, atomicWriteText } from './atomic.js'
import {
  getProjectLocalHistoryDir,
  getProjectTaskLocalHistoryDir,
} from './local-history.js'
import {
  upsertProjectStateDatabaseTaskProof,
  upsertProjectStateDatabaseTaskProofs,
  replaceProjectStateDatabaseTaskRuntimes,
  replaceProjectStateDatabaseTaskWorkspaces,
  reconcileProjectStateDatabaseTaskOverlays,
  readProjectStateDatabaseTaskOverlayStores,
  appendProjectStateDatabaseTaskEvidence,
  compactProjectStateDatabaseTaskEvidenceHistory,
  importProjectStateDatabaseTaskEvidence,
  readProjectStateDatabaseCurrentAuthority,
  readProjectStateDatabaseTaskEvidenceAuthority,
  readProjectStateDatabaseTaskEvidenceHistory,
  readProjectStateDatabaseTaskEvidenceHistoryAll,
  setProjectStateDatabaseTaskEvidenceAuthority,
} from './project-state-database.js'
import { markProjectSummaryStale } from './project-summary-staleness.js'

const EVIDENCE_FILE_BY_KIND: Record<TaskEvidenceKind, string> = {
  event: 'events.jsonl',
  note: 'notes.jsonl',
  gate_result: 'gate-results.jsonl',
  review_verdict: 'review-verdicts.jsonl',
  adjudication: 'adjudications.jsonl',
  escalation: 'escalations.jsonl',
  agent_issue: 'agent-issues.jsonl',
  merge_record: 'merge-records.jsonl',
  git_story: 'git-story.jsonl',
}

const COMPRESSED_TASK_EVIDENCE_DIR = 'task-evidence-history'
const TASK_EVIDENCE_LOCK_DIR = 'locks'
const TASK_EVIDENCE_LOCK_FILE = 'task-evidence.lock'
const TASK_EVIDENCE_LOCK_MAX_AGE_MS = 2 * 60 * 1000

export const TASK_EVIDENCE_PAGE_MAX_BYTES = 256 * 1024
export const TASK_EVIDENCE_PAGE_MAX_RECORDS = 200

/**
 * Evidence history is detail, not current state. Keep a useful recent tail
 * per kind; the SQLite current-evidence projection remains the status source.
 */
export const TASK_EVIDENCE_RETENTION: Record<TaskEvidenceKind, { maxRecords: number; maxBytes: number }> = {
  event: { maxRecords: 64, maxBytes: 64 * 1024 },
  note: { maxRecords: 64, maxBytes: 64 * 1024 },
  gate_result: { maxRecords: 32, maxBytes: 64 * 1024 },
  review_verdict: { maxRecords: 32, maxBytes: 64 * 1024 },
  adjudication: { maxRecords: 32, maxBytes: 64 * 1024 },
  escalation: { maxRecords: 32, maxBytes: 64 * 1024 },
  agent_issue: { maxRecords: 32, maxBytes: 64 * 1024 },
  merge_record: { maxRecords: 16, maxBytes: 32 * 1024 },
  git_story: { maxRecords: 16, maxBytes: 32 * 1024 },
}

function nowIso(): string {
  return new Date().toISOString()
}

function boundedEvidenceLines(lines: readonly string[], kind: TaskEvidenceKind): string[] {
  const policy = TASK_EVIDENCE_RETENTION[kind]
  const ordered = [...lines].sort((left, right) => {
    try {
      const a = TaskEvidenceEvent.parse(JSON.parse(left))
      const b = TaskEvidenceEvent.parse(JSON.parse(right))
      return a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id)
    } catch {
      return 0
    }
  })
  const retained: string[] = []
  let bytes = 0
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const line = ordered[index]!
    const lineBytes = Buffer.byteLength(`${line}\n`, 'utf8')
    if (retained.length >= policy.maxRecords) break
    if (retained.length > 0 && bytes + lineBytes > policy.maxBytes) break
    retained.unshift(line)
    bytes += lineBytes
  }
  return retained
}

async function withTaskEvidenceLock<T>(projectRoot: string, work: () => Promise<T>): Promise<T> {
  const lockPath = path.join(getProjectLocalHistoryDir(projectRoot), TASK_EVIDENCE_LOCK_DIR, TASK_EVIDENCE_LOCK_FILE)
  await fs.mkdir(path.dirname(lockPath), { recursive: true })
  const deadline = Date.now() + TASK_EVIDENCE_LOCK_MAX_AGE_MS
  let handle: import('node:fs/promises').FileHandle | null = null
  while (!handle) {
    try {
      handle = await fs.open(lockPath, 'wx')
      await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), 'utf8')
    } catch (error) {
      if (handle) await fs.rm(lockPath, { force: true }).catch(() => undefined)
      await handle?.close().catch(() => undefined)
      handle = null
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const stat = await fs.stat(lockPath)
        if (Date.now() - stat.mtimeMs > TASK_EVIDENCE_LOCK_MAX_AGE_MS) {
          await fs.rm(lockPath, { force: true })
          continue
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError
      }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for task evidence lock: ${lockPath}`)
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  try {
    return await work()
  } finally {
    await handle.close().catch(() => undefined)
    await fs.rm(lockPath, { force: true }).catch(() => undefined)
  }
}

async function appendBoundedEvidenceLine(
  file: string,
  kind: TaskEvidenceKind,
  serialized: string,
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  let raw = ''
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const lines = raw.split('\n').filter(line => line.trim().length > 0)
  const nextLines = [...lines, serialized]
  const retained = boundedEvidenceLines(nextLines, kind)
  if (retained.length === nextLines.length && retained.join('\n') === nextLines.join('\n')) {
    await fs.appendFile(file, `${serialized}\n`, 'utf8')
    return
  }
  atomicWriteText(file, `${retained.join('\n')}\n`)
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw err
  }
}

export function runtimeStatePath(projectRoot: string): string {
  return path.join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'tasks.json')
}

export function taskWorkspaceStatePath(projectRoot: string): string {
  return path.join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'task-workspaces.json')
}

export function taskEvidencePath(
  projectRoot: string,
  taskId: string,
  kind: TaskEvidenceKind,
): string {
  return path.join(
    getProjectTaskLocalHistoryDir(projectRoot, taskId),
    EVIDENCE_FILE_BY_KIND[kind],
  )
}

export function compressedTaskEvidencePath(
  projectRoot: string,
  taskId: string,
  kind: TaskEvidenceKind,
): string {
  return path.join(
    getProjectLocalHistoryDir(projectRoot),
    COMPRESSED_TASK_EVIDENCE_DIR,
    taskId,
    `${kind}.jsonl.gz`,
  )
}

async function readCompressedTaskEvidence(
  projectRoot: string,
  taskId: string,
  kinds: readonly TaskEvidenceKind[],
): Promise<TaskEvidenceEvent[]> {
  const events: TaskEvidenceEvent[] = []
  for (const kind of kinds) {
    let raw: string
    try {
      raw = gunzipSync(await fs.readFile(compressedTaskEvidencePath(projectRoot, taskId, kind))).toString('utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      events.push(TaskEvidenceEvent.parse(JSON.parse(line)))
    }
  }
  return events
}

async function appendCompressedTaskEvidence(
  projectRoot: string,
  event: TaskEvidenceEvent,
): Promise<void> {
  const file = compressedTaskEvidencePath(projectRoot, event.taskId, event.kind)
  let raw = ''
  try {
    raw = gunzipSync(await fs.readFile(file)).toString('utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const existingLines = raw.split('\n').filter(line => line.trim())
  if (existingLines.some(line => {
    try {
      return TaskEvidenceEvent.parse(JSON.parse(line)).id === event.id
    } catch {
      return false
    }
  })) return
  const lines = boundedEvidenceLines([...existingLines, JSON.stringify(event)], event.kind)
  await fs.mkdir(path.dirname(file), { recursive: true })
  atomicWriteBytes(file, gzipSync(Buffer.from(`${lines.join('\n')}\n`, 'utf8'), { level: 9 }))
}

async function readLegacyTaskRuntimeStore(projectRoot: string): Promise<TaskRuntimeStateStore> {
  const fallback = {
    version: 1,
    lastUpdated: nowIso(),
    tasks: {},
  }
  return TaskRuntimeStateStore.parse(
    await readJsonFile(runtimeStatePath(projectRoot), fallback),
  )
}

export async function readTaskRuntimeStore(projectRoot: string): Promise<TaskRuntimeStateStore> {
  const databaseStores = readProjectStateDatabaseTaskOverlayStores(projectRoot)
  if (databaseStores) {
    const tasks = Object.fromEntries(databaseStores.runtime.map(state => [state.taskId, state.payload]))
    return TaskRuntimeStateStore.parse({
      version: 1,
      lastUpdated: databaseStores.runtime.at(-1)?.updatedAt ?? nowIso(),
      tasks,
    })
  }
  if (readProjectStateDatabaseCurrentAuthority(projectRoot) === 'database') {
    throw new Error('Task runtime migration required: promoted project state has no normalized runtime overlay store')
  }
  return readLegacyTaskRuntimeStore(projectRoot)
}

export async function writeTaskRuntimeStore(
  projectRoot: string,
  store: TaskRuntimeStateStore,
): Promise<void> {
  const file = runtimeStatePath(projectRoot)
  const parsed = TaskRuntimeStateStore.parse(store)
  replaceProjectStateDatabaseTaskRuntimes(projectRoot, Object.values(parsed.tasks).map(state => ({
    taskId: state.taskId,
    updatedAt: state.updatedAt,
    payload: state,
  })))
  if (readProjectStateDatabaseCurrentAuthority(projectRoot) === 'database') {
    return
  }
  await fs.mkdir(path.dirname(file), { recursive: true })
  atomicWriteText(file, `${JSON.stringify(parsed, null, 2)}\n`)
  markProjectSummaryStale(projectRoot)
}

export async function upsertTaskRuntimeState(
  projectRoot: string,
  taskId: string,
  patch: Partial<Omit<TaskRuntimeState, 'taskId'>> & { updatedAt?: string },
): Promise<TaskRuntimeState> {
  const store = await readTaskRuntimeStore(projectRoot)
  const updatedAt = patch.updatedAt ?? nowIso()
  const next = {
    ...(store.tasks[taskId] ?? { taskId, updatedAt }),
    ...patch,
    taskId,
    updatedAt,
  }
  store.tasks[taskId] = next
  store.lastUpdated = updatedAt
  await writeTaskRuntimeStore(projectRoot, store)
  return next
}

export async function clearTaskRuntimeState(projectRoot: string, taskId: string): Promise<void> {
  const store = await readTaskRuntimeStore(projectRoot)
  if (!store.tasks[taskId]) return
  delete store.tasks[taskId]
  store.lastUpdated = nowIso()
  await writeTaskRuntimeStore(projectRoot, store)
}

async function readLegacyTaskWorkspaceStore(projectRoot: string): Promise<TaskWorkspaceStateStore> {
  const fallback = {
    version: 1,
    lastUpdated: nowIso(),
    workspaces: {},
  }
  return TaskWorkspaceStateStore.parse(
    await readJsonFile(taskWorkspaceStatePath(projectRoot), fallback),
  )
}

export async function readTaskWorkspaceStore(projectRoot: string): Promise<TaskWorkspaceStateStore> {
  const databaseStores = readProjectStateDatabaseTaskOverlayStores(projectRoot)
  if (databaseStores) {
    const workspaces = Object.fromEntries(databaseStores.workspace.map(state => [state.taskId, state.payload]))
    return TaskWorkspaceStateStore.parse({
      version: 1,
      lastUpdated: databaseStores.workspace.at(-1)?.updatedAt ?? nowIso(),
      workspaces,
    })
  }
  if (readProjectStateDatabaseCurrentAuthority(projectRoot) === 'database') {
    throw new Error('Task workspace migration required: promoted project state has no normalized workspace overlay store')
  }
  return readLegacyTaskWorkspaceStore(projectRoot)
}

export async function writeTaskWorkspaceStore(
  projectRoot: string,
  store: TaskWorkspaceStateStore,
): Promise<void> {
  const file = taskWorkspaceStatePath(projectRoot)
  const parsed = TaskWorkspaceStateStore.parse(store)
  replaceProjectStateDatabaseTaskWorkspaces(projectRoot, Object.values(parsed.workspaces).map(state => ({
    taskId: state.taskId,
    updatedAt: state.updatedAt,
    payload: state,
  })))
  if (readProjectStateDatabaseCurrentAuthority(projectRoot) === 'database') {
    return
  }
  await fs.mkdir(path.dirname(file), { recursive: true })
  atomicWriteText(file, `${JSON.stringify(parsed, null, 2)}\n`)
  markProjectSummaryStale(projectRoot)
}

export async function upsertTaskWorkspaceState(
  projectRoot: string,
  taskId: string,
  patch: Partial<Omit<TaskWorkspaceState, 'taskId'>> & { updatedAt?: string },
): Promise<TaskWorkspaceState> {
  const store = await readTaskWorkspaceStore(projectRoot)
  const updatedAt = patch.updatedAt ?? nowIso()
  const next = {
    ...(store.workspaces[taskId] ?? { taskId, updatedAt }),
    ...patch,
    taskId,
    updatedAt,
  }
  store.workspaces[taskId] = next
  store.lastUpdated = updatedAt
  await writeTaskWorkspaceStore(projectRoot, store)
  return next
}

export async function clearTaskWorkspaceState(projectRoot: string, taskId: string): Promise<void> {
  const store = await readTaskWorkspaceStore(projectRoot)
  if (!store.workspaces[taskId]) return
  delete store.workspaces[taskId]
  store.lastUpdated = nowIso()
  await writeTaskWorkspaceStore(projectRoot, store)
}

export async function appendTaskEvidence(
  projectRoot: string,
  taskId: string,
  event: Omit<TaskEvidenceEvent, 'taskId'> & { taskId?: string },
): Promise<TaskEvidenceEvent> {
  const parsed = TaskEvidenceEvent.parse({
    ...event,
    taskId,
  })
  const durable = compactTaskEvidenceEvent(parsed)
  return withTaskEvidenceLock(projectRoot, async () => {
    const evidenceAuthority = readProjectStateDatabaseTaskEvidenceAuthority(projectRoot)
    if (readProjectStateDatabaseCurrentAuthority(projectRoot) === 'database' &&
        (evidenceAuthority === 'database' || evidenceAuthority === 'legacy')) {
      appendProjectStateDatabaseTaskEvidence(projectRoot, durable, TASK_EVIDENCE_RETENTION[durable.kind])
      return parsed
    }
    if (readProjectStateDatabaseCurrentAuthority(projectRoot) === 'database' && evidenceAuthority === 'compressed') {
      // Detail history is the durable first write. If the projection update
      // fails, a later repair can derive current proof from the retained event.
      await appendCompressedTaskEvidence(projectRoot, durable)
      upsertProjectStateDatabaseTaskProof(projectRoot, {
        taskId,
        kind: durable.kind,
        recordedAt: durable.recordedAt,
        payload: durable.payload,
      })
      return parsed
    }
    const file = taskEvidencePath(projectRoot, taskId, parsed.kind)
    upsertProjectStateDatabaseTaskProof(projectRoot, {
      taskId,
      kind: durable.kind,
      recordedAt: durable.recordedAt,
      payload: durable.payload,
    })
    await appendBoundedEvidenceLine(file, parsed.kind, JSON.stringify(durable))
    markProjectSummaryStale(projectRoot)
    return parsed
  })
}

export interface TaskEvidenceCompactionResult {
  filesSeen: number
  filesCompacted: number
  recordsSeen: number
  recordsCompacted: number
  bytesBefore: number
  bytesAfter: number
}

/**
 * Migrate old evidence written before the durable-write boundary. This is a
 * content migration, not deletion: every valid record remains as an
 * essential bounded event, while raw command output and verbose reasoning are
 * removed from the project-state history that current and detail readers use.
 */
export async function compactTaskEvidenceHistory(
  projectRoot: string,
  options: { dryRun?: boolean } = {},
): Promise<TaskEvidenceCompactionResult> {
  const tasksDir = path.join(getProjectLocalHistoryDir(projectRoot), 'tasks')
  const result: TaskEvidenceCompactionResult = {
    filesSeen: 0,
    filesCompacted: 0,
    recordsSeen: 0,
    recordsCompacted: 0,
    bytesBefore: 0,
    bytesAfter: 0,
  }
  let taskEntries: Array<import('node:fs').Dirent>
  try {
    taskEntries = await fs.readdir(tasksDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result
    throw error
  }

  for (const taskEntry of taskEntries) {
    if (!taskEntry.isDirectory()) continue
    for (const kind of Object.keys(EVIDENCE_FILE_BY_KIND) as TaskEvidenceKind[]) {
      const file = path.join(tasksDir, taskEntry.name, EVIDENCE_FILE_BY_KIND[kind])
      let raw: string
      try {
        raw = await fs.readFile(file, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      result.filesSeen += 1
      result.bytesBefore += Buffer.byteLength(raw, 'utf8')
      const lines = raw.split('\n').filter(line => line.trim().length > 0)
      const compactedLines: string[] = []
      let changed = false
      for (const line of lines) {
        try {
          const parsed = TaskEvidenceEvent.parse(JSON.parse(line))
          const durable = compactTaskEvidenceEvent(parsed)
          const serialized = JSON.stringify(durable)
          compactedLines.push(serialized)
          result.recordsSeen += 1
          if (serialized !== JSON.stringify(parsed)) {
            result.recordsCompacted += 1
            changed = true
          }
        } catch {
          // Preserve malformed historical lines for explicit forensic work;
          // ordinary readers already skip them in the paged history path.
          compactedLines.push(line)
        }
      }
      const retainedLines = boundedEvidenceLines(compactedLines, kind)
      const next = retainedLines.length > 0 ? `${retainedLines.join('\n')}\n` : ''
      const retainedChanged = retainedLines.length !== compactedLines.length
      result.bytesAfter += Buffer.byteLength(changed || retainedChanged ? next : raw, 'utf8')
      if (changed || retainedChanged) {
        result.filesCompacted += 1
        if (options.dryRun !== true) atomicWriteText(file, next)
      }
    }
  }
  return result
}

export interface TaskEvidenceHistoryMigrationResult {
  filesSeen: number
  filesRemoved: number
  recordsSeen: number
  recordsImported: number
  bytesBefore: number
  bytesAfter: number
}

function retainedLegacyEvidenceIds(events: readonly TaskEvidenceEvent[]): Set<string> {
  const grouped = new Map<string, { kind: TaskEvidenceKind; lines: string[] }>()
  for (const event of events) {
    const key = `${event.taskId}\u0000${event.kind}`
    const group = grouped.get(key) ?? { kind: event.kind, lines: [] }
    group.lines.push(JSON.stringify(event))
    grouped.set(key, group)
  }

  const ids = new Set<string>()
  for (const group of grouped.values()) {
    for (const line of boundedEvidenceLines(group.lines, group.kind)) {
      ids.add(TaskEvidenceEvent.parse(JSON.parse(line)).id)
    }
  }
  return ids
}

/**
 * Move the legacy per-task evidence ledger into the existing SQLite history
 * table. The authority marker changes only after every imported identity is
 * readable from SQLite and the compatibility files have been removed.
 */
export async function migrateLegacyTaskEvidenceHistoryToDatabase(
  projectRoot: string,
): Promise<TaskEvidenceHistoryMigrationResult> {
  const result: TaskEvidenceHistoryMigrationResult = {
    filesSeen: 0,
    filesRemoved: 0,
    recordsSeen: 0,
    recordsImported: 0,
    bytesBefore: 0,
    bytesAfter: 0,
  }
  if (readProjectStateDatabaseCurrentAuthority(projectRoot) !== 'database' ||
      readProjectStateDatabaseTaskEvidenceAuthority(projectRoot) !== 'legacy') return result

  return withTaskEvidenceLock(projectRoot, async () => {
    if (readProjectStateDatabaseTaskEvidenceAuthority(projectRoot) !== 'legacy') return result

  const tasksDir = path.join(getProjectLocalHistoryDir(projectRoot), 'tasks')
  let taskEntries: Array<import('node:fs').Dirent>
  try {
    taskEntries = await fs.readdir(tasksDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      setProjectStateDatabaseTaskEvidenceAuthority(projectRoot, 'database')
      return result
    }
    throw error
  }

  const files: Array<{ path: string; bytes: number }> = []
  const events: TaskEvidenceEvent[] = []
  for (const taskEntry of taskEntries) {
    if (!taskEntry.isDirectory()) continue
    for (const kind of Object.keys(EVIDENCE_FILE_BY_KIND) as TaskEvidenceKind[]) {
      const file = path.join(tasksDir, taskEntry.name, EVIDENCE_FILE_BY_KIND[kind])
      let raw: string
      try {
        raw = await fs.readFile(file, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      const bytes = Buffer.byteLength(raw, 'utf8')
      result.filesSeen += 1
      result.bytesBefore += bytes
      files.push({ path: file, bytes })
      let lineNumber = 0
      for (const line of raw.split('\n')) {
        lineNumber += 1
        if (!line.trim()) continue
        try {
          events.push(compactTaskEvidenceEvent(TaskEvidenceEvent.parse(JSON.parse(line))))
          result.recordsSeen += 1
        } catch (error) {
          throw new Error(`Cannot migrate task evidence ${file}:${lineNumber}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }

  result.recordsImported = importProjectStateDatabaseTaskEvidence(
    projectRoot,
    events,
    TASK_EVIDENCE_RETENTION,
  )

  // SQLite applies the same per-kind retention policy as the legacy writer.
  // Verify the records that should survive that policy, rather than treating
  // intentionally evicted older history as a failed import.
  const retainedIds = retainedLegacyEvidenceIds(events)
  result.recordsImported = retainedIds.size
  const verified = new Map<string, Set<string>>()
  for (const event of events) {
    if (!retainedIds.has(event.id)) continue
    const key = `${event.taskId}\u0000${event.kind}`
    if (!verified.has(key)) {
      verified.set(key, new Set(
        (readProjectStateDatabaseTaskEvidenceHistory(projectRoot, event.taskId, event.kind) ?? [])
          .map(candidate => candidate.id),
      ))
    }
    if (!verified.get(key)!.has(event.id)) {
      throw new Error(`SQLite task evidence verification failed for ${event.taskId}/${event.kind}/${event.id}`)
    }
  }

  for (const file of files) {
    await fs.rm(file.path, { force: true })
    result.filesRemoved += 1
  }
  setProjectStateDatabaseTaskEvidenceAuthority(projectRoot, 'database')
  result.bytesAfter = 0
  return result
  })
}

export interface TaskEvidenceHistoryCompressionResult {
  recordsSeen: number
  recordsRetained: number
  filesWritten: number
  bytesBefore: number
  bytesAfter: number
}

/**
 * Replace the high-overhead SQLite history copy with a bounded gzip ledger.
 * Current proof remains in SQLite; this file is detail-only and is never read
 * by compact project summaries.
 */
export async function migrateDatabaseTaskEvidenceHistoryToCompressed(
  projectRoot: string,
): Promise<TaskEvidenceHistoryCompressionResult> {
  const result: TaskEvidenceHistoryCompressionResult = {
    recordsSeen: 0,
    recordsRetained: 0,
    filesWritten: 0,
    bytesBefore: 0,
    bytesAfter: 0,
  }
  if (readProjectStateDatabaseCurrentAuthority(projectRoot) !== 'database' ||
      readProjectStateDatabaseTaskEvidenceAuthority(projectRoot) !== 'database') {
    return result
  }

  return withTaskEvidenceLock(projectRoot, async () => {
    if (readProjectStateDatabaseTaskEvidenceAuthority(projectRoot) !== 'database') return result

  const events = readProjectStateDatabaseTaskEvidenceHistoryAll(projectRoot)
  if (events === null) throw new Error('Cannot compress task evidence: SQLite history table is missing')
  result.recordsSeen = events.length
  const grouped = new Map<string, { taskId: string; kind: TaskEvidenceKind; lines: string[] }>()
  for (const event of events) {
    const key = `${event.taskId}\u0000${event.kind}`
    const group = grouped.get(key) ?? { taskId: event.taskId, kind: event.kind, lines: [] }
    const serialized = JSON.stringify(compactTaskEvidenceEvent(event))
    group.lines.push(serialized)
    result.bytesBefore += Buffer.byteLength(serialized, 'utf8') + 1
    grouped.set(key, group)
  }

  const expectedIds = new Map<string, Set<string>>()
  const localHistoryDir = getProjectLocalHistoryDir(projectRoot)
  const compressedDir = path.join(localHistoryDir, COMPRESSED_TASK_EVIDENCE_DIR)
  const temporaryDir = await fs.mkdtemp(path.join(localHistoryDir, `${COMPRESSED_TASK_EVIDENCE_DIR}.tmp-`))
  let published = false
  try {
  for (const [key, group] of grouped) {
    const retainedLines = boundedEvidenceLines(group.lines, group.kind)
    expectedIds.set(key, new Set(retainedLines.map(line => TaskEvidenceEvent.parse(JSON.parse(line)).id)))
    result.recordsRetained += retainedLines.length
    const file = path.join(temporaryDir, group.taskId, `${group.kind}.jsonl.gz`)
    await fs.mkdir(path.dirname(file), { recursive: true })
    const compressed = gzipSync(Buffer.from(`${retainedLines.join('\n')}\n`, 'utf8'), { level: 9 })
    atomicWriteBytes(file, compressed)
    result.filesWritten += 1
    result.bytesAfter += compressed.byteLength
  }

  for (const [key, ids] of expectedIds) {
    const separator = key.indexOf('\u0000')
    const taskId = key.slice(0, separator)
    const kind = key.slice(separator + 1) as TaskEvidenceKind
    const file = path.join(temporaryDir, taskId, `${kind}.jsonl.gz`)
    const actual = new Set<string>()
    try {
      const raw = gunzipSync(await fs.readFile(file)).toString('utf8')
      for (const line of raw.split('\n')) {
        if (line.trim()) actual.add(TaskEvidenceEvent.parse(JSON.parse(line)).id)
      }
    } catch (error) {
      throw new Error(`Compressed task evidence verification failed for ${taskId}/${kind}: ${error instanceof Error ? error.message : String(error)}`)
    }
    for (const id of ids) {
      if (!actual.has(id)) throw new Error(`Compressed task evidence verification failed for ${taskId}/${kind}/${id}`)
    }
    if (actual.size !== ids.size) throw new Error(`Compressed task evidence contained unexpected records for ${taskId}/${kind}`)
  }

  await fs.rm(compressedDir, { recursive: true, force: true })
  await fs.rename(temporaryDir, compressedDir)
  published = true
  compactProjectStateDatabaseTaskEvidenceHistory(projectRoot)
  return result
  } finally {
    if (!published) await fs.rm(temporaryDir, { recursive: true, force: true }).catch(() => undefined)
  }
  })
}

async function readLegacyTaskEvidence(
  projectRoot: string,
  taskId: string,
  kinds: readonly TaskEvidenceKind[],
): Promise<TaskEvidenceEvent[]> {
  const events: TaskEvidenceEvent[] = []
  for (const kind of kinds) {
    const file = taskEvidencePath(projectRoot, taskId, kind)
    let raw = ''
    try {
      raw = await fs.readFile(file, 'utf-8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw err
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      events.push(TaskEvidenceEvent.parse(JSON.parse(line)))
    }
  }
  return events
}

function mergeTaskEvidence(
  databaseEvents: readonly TaskEvidenceEvent[],
  legacyEvents: readonly TaskEvidenceEvent[],
): TaskEvidenceEvent[] {
  const byId = new Map<string, TaskEvidenceEvent>()
  for (const event of legacyEvents) byId.set(event.id, event)
  for (const event of databaseEvents) byId.set(event.id, event)
  return [...byId.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id))
}

export async function readTaskEvidence(
  projectRoot: string,
  taskId: string,
  opts: { kind?: TaskEvidenceKind; allowLegacy?: boolean } = {},
): Promise<TaskEvidenceEvent[]> {
  const kinds = opts.kind ? [opts.kind] : Object.keys(EVIDENCE_FILE_BY_KIND) as TaskEvidenceKind[]
  const evidenceAuthority = readProjectStateDatabaseTaskEvidenceAuthority(projectRoot)
  if (readProjectStateDatabaseCurrentAuthority(projectRoot) === 'database' && evidenceAuthority === 'database') {
    const history = readProjectStateDatabaseTaskEvidenceHistory(projectRoot, taskId, opts.kind)
    if (history === null) throw new Error(`Normalized task evidence history is unavailable for promoted project ${taskId}`)
    return history
  }
  if (readProjectStateDatabaseCurrentAuthority(projectRoot) === 'database' && evidenceAuthority === 'compressed') {
    return (await readCompressedTaskEvidence(projectRoot, taskId, kinds))
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id))
  }
  if (readProjectStateDatabaseCurrentAuthority(projectRoot) === 'database' && opts.allowLegacy !== true) {
    const legacyFiles: string[] = []
    for (const kind of kinds) {
      const file = taskEvidencePath(projectRoot, taskId, kind)
      try {
        await fs.access(file)
        legacyFiles.push(file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    if (legacyFiles.length > 0) {
      throw new Error(
        `Task evidence migration required before ordinary reads for ${taskId}; legacy history remains at ${legacyFiles[0]}`,
      )
    }
    const history = readProjectStateDatabaseTaskEvidenceHistory(projectRoot, taskId, opts.kind)
    if (history === null) throw new Error(`Normalized task evidence history is unavailable for promoted project ${taskId}`)
    return history
  }
  const legacyEvents = await readLegacyTaskEvidence(projectRoot, taskId, kinds)
  const databaseEvents = readProjectStateDatabaseTaskEvidenceHistory(projectRoot, taskId, opts.kind)
  return mergeTaskEvidence(databaseEvents ?? [], legacyEvents)
}

export interface TaskEvidencePage {
  events: TaskEvidenceEvent[]
  cursor: number
  limit: number
  total: number
  hasMore: boolean
  bytes: number
  maxBytes: number
  nextCursor?: number
}

/**
 * Read a bounded task-history page without materializing every JSONL record.
 * The caller chooses the order explicitly. The reader retains at most one
 * page window per evidence kind and never returns more than the byte budget.
 */
export async function readTaskEvidencePage(
  projectRoot: string,
  taskId: string,
  opts: {
    kind?: TaskEvidenceKind
    cursor?: number
    limit?: number
    order?: 'newest' | 'oldest'
    maxBytes?: number
    filter?: (event: TaskEvidenceEvent) => boolean
  } = {},
): Promise<TaskEvidencePage> {
  const kinds = opts.kind ? [opts.kind] : Object.keys(EVIDENCE_FILE_BY_KIND) as TaskEvidenceKind[]
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 100), 1), TASK_EVIDENCE_PAGE_MAX_RECORDS)
  const cursor = Math.min(Math.max(Math.trunc(opts.cursor ?? 0), 0), 1_000)
  const order = opts.order ?? 'newest'
  const maxBytes = Math.min(Math.max(Math.trunc(opts.maxBytes ?? TASK_EVIDENCE_PAGE_MAX_BYTES), 1), TASK_EVIDENCE_PAGE_MAX_BYTES)
  if (readProjectStateDatabaseCurrentAuthority(projectRoot) === 'database') {
    const all = await readTaskEvidence(projectRoot, taskId, opts)
    const filtered = opts.filter ? all.filter(opts.filter) : all
    const ordered = opts.order === 'oldest'
      ? filtered
      : [...filtered].reverse()
    const page: TaskEvidenceEvent[] = []
    let bytes = 0
    for (const event of ordered.slice(cursor)) {
      if (page.length >= limit) break
      const eventBytes = Buffer.byteLength(JSON.stringify(event), 'utf8')
      if (page.length > 0 && bytes + eventBytes > maxBytes) break
      page.push(event)
      bytes += eventBytes
    }
    const hasMore = cursor + page.length < ordered.length
    return {
      events: page,
      cursor,
      limit,
      total: filtered.length,
      hasMore,
      bytes,
      maxBytes,
      ...(hasMore ? { nextCursor: cursor + page.length } : {}),
    }
  }
  const windowSize = cursor + limit
  let total = 0
  const candidates: TaskEvidenceEvent[] = []
  const kindBudget = Math.max(1, Math.floor(maxBytes / kinds.length))

  for (const kind of kinds) {
    const file = taskEvidencePath(projectRoot, taskId, kind)
    try {
      await fs.access(file)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw err
    }

    const retained: TaskEvidenceEvent[] = []
    let retainedBytes = 0
    const lines = createInterface({
      input: createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    })
    try {
      for await (const line of lines) {
        if (!line.trim()) continue
        let event: TaskEvidenceEvent
        try {
          event = TaskEvidenceEvent.parse(JSON.parse(line))
        } catch {
          continue
        }
        if (opts.filter && !opts.filter(event)) continue
        total += 1
        const eventBytes = Buffer.byteLength(line, 'utf8')
        retained.push(event)
        if (order === 'oldest') {
          if (retained.length > windowSize || retainedBytes + eventBytes > kindBudget) {
            retained.pop()
          } else {
            retainedBytes += eventBytes
          }
        } else {
          retainedBytes += eventBytes
          while (retained.length > windowSize || retainedBytes > kindBudget) {
            const removed = retained.shift()
            if (!removed) break
            retainedBytes -= Buffer.byteLength(JSON.stringify(removed), 'utf8')
          }
        }
      }
    } finally {
      lines.close()
    }
    candidates.push(...retained)
  }

  candidates.sort((left, right) => {
    const byTime = order === 'oldest'
      ? left.recordedAt.localeCompare(right.recordedAt)
      : right.recordedAt.localeCompare(left.recordedAt)
    return byTime || right.id.localeCompare(left.id)
  })
  const events = candidates.slice(cursor, cursor + limit)
  const bytes = events.reduce((sum, event) => sum + Buffer.byteLength(JSON.stringify(event), 'utf8'), 0)
  const hasMore = cursor + events.length < total
  return {
    events,
    cursor,
    limit,
    total,
    hasMore,
    bytes,
    maxBytes,
    ...(hasMore ? { nextCursor: cursor + events.length } : {}),
  }
}

/**
 * One-time compatibility import. Normal reads never call this: current task
 * rows are maintained by the write boundaries above, while JSONL stays detail
 * history after this migration has completed.
 */
export async function backfillTaskStateDatabaseOverlays(
  projectRoot: string,
  taskIds: readonly string[],
): Promise<{ runtime: number; workspace: number; latestProof: number }> {
  const [runtimeStore, workspaceStore] = await Promise.all([
    readLegacyTaskRuntimeStore(projectRoot),
    readLegacyTaskWorkspaceStore(projectRoot),
  ])
  const currentTaskIds = [...new Set(taskIds)]
  const currentTaskIdSet = new Set(currentTaskIds)
  const runtimes = Object.values(runtimeStore.tasks).filter(state => currentTaskIdSet.has(state.taskId))
  const workspaces = Object.values(workspaceStore.workspaces).filter(state => currentTaskIdSet.has(state.taskId))
  replaceProjectStateDatabaseTaskRuntimes(projectRoot, runtimes.map(state => ({
    taskId: state.taskId,
    updatedAt: state.updatedAt,
    payload: state,
  })))
  replaceProjectStateDatabaseTaskWorkspaces(projectRoot, workspaces.map(state => ({
    taskId: state.taskId,
    updatedAt: state.updatedAt,
    payload: state,
  })))

  const latestProofs = (await Promise.all(currentTaskIds.map(async taskId => {
    const latest = (await readTaskEvidence(projectRoot, taskId)).at(-1)
    return latest ? {
      taskId,
      kind: latest.kind,
      recordedAt: latest.recordedAt,
      payload: latest.payload,
    } : null
  }))).filter((proof): proof is NonNullable<typeof proof> => proof !== null)
  upsertProjectStateDatabaseTaskProofs(projectRoot, latestProofs)
  reconcileProjectStateDatabaseTaskOverlays(projectRoot, currentTaskIds)
  return { runtime: runtimes.length, workspace: workspaces.length, latestProof: latestProofs.length }
}

/**
 * Build the bounded current evidence projection once from legacy history.
 * This is an explicit migration boundary; ordinary reads never call it.
 */
export async function backfillTaskEvidenceCurrent(
  projectRoot: string,
  taskIds: readonly string[],
): Promise<{ tasks: number; events: number }> {
  let tasks = 0
  let events = 0
  for (const taskId of [...new Set(taskIds)]) {
    const history = await readTaskEvidence(projectRoot, taskId, { allowLegacy: true })
    if (history.length === 0) continue
    upsertProjectStateDatabaseTaskProofs(projectRoot, history.map(event => ({
      taskId,
      kind: event.kind,
      recordedAt: event.recordedAt,
      payload: event.payload,
    })))
    tasks += 1
    events += history.length
  }
  return { tasks, events }
}
