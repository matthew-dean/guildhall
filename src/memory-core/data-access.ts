import { createHash } from 'node:crypto'
import { existsSync, rmSync, statSync } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { appendManagedTextFile, readManagedTextFile, writeManagedTextFile } from '@guildhall/persistence'
import { ensureProjectLocalHistoryDir, getProjectLocalHistoryDir } from '@guildhall/sessions'

import { projectMemoryKey, scopeKey } from './scopes.js'
import type {
  GuildhallMemoryScope,
  MemoryAuditReport,
  MemoryAuditReportRef,
  MemoryEvent,
  MemoryPaths,
  MemorySourceRef,
  MemoryWriteResult,
  RecordMemoryEventInput,
} from './types.js'

/** A memory stream is a compact retrieval index, not a transcript archive. */
export const MEMORY_EVENT_SUMMARY_MAX_CHARS = 4_000
export const MEMORY_EVENT_HISTORY_MAX_BYTES = 256 * 1024
export const MEMORY_EVENT_STREAM_FILENAME = 'events.jsonl'

export function resolveMemoryPaths(input: {
  projectRoot: string
  scope: GuildhallMemoryScope
}): MemoryPaths {
  const memoryDir = path.join(getProjectLocalHistoryDir(input.projectRoot), 'memory')
  const key = projectMemoryKey(input.projectRoot)
  return {
    projectRoot: path.resolve(input.projectRoot),
    memoryDir,
    dbPath: path.join(memoryDir, 'guildhall-memory.db'),
    // Memory is a project-level bounded retrieval index. Scope remains a field
    // on each event; it is not a reason to create an independently growing
    // file for every task/thread/agent combination.
    eventsPath: path.join(memoryDir, MEMORY_EVENT_STREAM_FILENAME),
    auditDir: path.join(memoryDir, 'audit'),
  }
}

export async function initializeMemoryStoreDirectory(paths: MemoryPaths): Promise<void> {
  if (!existsSync(paths.memoryDir)) ensureProjectLocalHistoryDir(paths.projectRoot)
  await fsp.mkdir(paths.memoryDir, { recursive: true })
}

export interface EmptyMastraThreadShellCleanupResult {
  storagePath: string
  removed: number
  bytesBefore: number
  bytesAfter: number
}

export interface EmptyMastraThreadShellInspection {
  storagePath: string
  count: number
  bytes: number
}

export interface EmptyMastraDatabaseInspection {
  storagePath: string
  bytes: number
  eligible: boolean
  tables: string[]
  nonEmptyTables: string[]
  unexpectedObjects: string[]
  reason: 'missing' | 'empty-mastra-schema' | 'data-present' | 'unexpected-objects'
}

export interface EmptyMastraDatabaseRetirementResult extends EmptyMastraDatabaseInspection {
  retired: boolean
  bytesBefore: number
  bytesAfter: number
}

function memoryDatabaseTables(database: DatabaseSync): Set<string> {
  return new Set(
    (database.prepare("select name from sqlite_master where type = 'table'").all() as Array<{ name?: unknown }>)
      .map(row => typeof row.name === 'string' ? row.name : '')
      .filter(Boolean),
  )
}

function memoryDatabaseObjects(database: DatabaseSync): Array<{ type?: unknown; name?: unknown }> {
  return database.prepare(
    "select type, name from sqlite_master where name not like 'sqlite_%' order by type, name",
  ).all() as Array<{ type?: unknown; name?: unknown }>
}

function quotedIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * Inspect the optional Mastra substrate without treating an empty schema as
 * useful memory. This is deliberately stricter than a filename-based prune:
 * only an all-empty database containing exclusively Mastra tables is eligible
 * for retirement.
 */
export function inspectEmptyMastraDatabase(input: {
  projectRoot: string
  projectId: string
}): EmptyMastraDatabaseInspection {
  const paths = resolveMemoryPaths({
    projectRoot: input.projectRoot,
    scope: { kind: 'project', projectId: input.projectId },
  })
  if (!existsSync(paths.dbPath)) {
    return {
      storagePath: paths.dbPath,
      bytes: 0,
      eligible: false,
      tables: [],
      nonEmptyTables: [],
      unexpectedObjects: [],
      reason: 'missing',
    }
  }

  const database = new DatabaseSync(paths.dbPath, { readOnly: true })
  try {
    const objects = memoryDatabaseObjects(database)
    const unexpectedObjects = objects
      .map(object => `${String(object.type ?? 'unknown')}:${String(object.name ?? '')}`)
      .filter(object => {
        if (object.startsWith('index:')) return false
        return !object.startsWith('table:mastra_')
      })
    const tables = objects
      .filter(object => object.type === 'table' && typeof object.name === 'string')
      .map(object => object.name as string)
    const nonEmptyTables = tables.filter(table => {
      const row = database.prepare(`select count(*) as count from ${quotedIdentifier(table)}`).get() as { count?: number | bigint }
      return Number(row.count ?? 0) > 0
    })
    const eligible = unexpectedObjects.length === 0 && nonEmptyTables.length === 0
    return {
      storagePath: paths.dbPath,
      bytes: statSync(paths.dbPath).size,
      eligible,
      tables,
      nonEmptyTables,
      unexpectedObjects,
      reason: unexpectedObjects.length > 0
        ? 'unexpected-objects'
        : nonEmptyTables.length > 0
          ? 'data-present'
          : 'empty-mastra-schema',
    }
  } finally {
    database.close()
  }
}

/**
 * Retire an unused memory engine database after rechecking under a write
 * transaction. This is a one-time substrate migration, not general history
 * pruning: any data, unknown object, or active lock leaves the file intact.
 */
export function retireEmptyMastraDatabase(input: {
  projectRoot: string
  projectId: string
}): EmptyMastraDatabaseRetirementResult {
  const inspection = inspectEmptyMastraDatabase(input)
  if (!inspection.eligible) {
    return { ...inspection, retired: false, bytesBefore: inspection.bytes, bytesAfter: inspection.bytes }
  }

  const database = new DatabaseSync(inspection.storagePath)
  try {
    database.exec('begin immediate')
    const confirmed = inspectEmptyMastraDatabase(input)
    if (!confirmed.eligible) {
      database.exec('rollback')
      return { ...confirmed, retired: false, bytesBefore: inspection.bytes, bytesAfter: confirmed.bytes }
    }
    database.exec('commit')
  } catch (error) {
    try { database.exec('rollback') } catch { /* preserve the original lock/error */ }
    throw error
  } finally {
    database.close()
  }

  const sidecars = [`${inspection.storagePath}-wal`, `${inspection.storagePath}-shm`, `${inspection.storagePath}-journal`]
  rmSync(inspection.storagePath, { force: true })
  for (const sidecar of sidecars) rmSync(sidecar, { force: true })
  return {
    ...inspection,
    retired: true,
    bytesBefore: inspection.bytes,
    bytesAfter: 0,
  }
}

function tableHasColumn(database: DatabaseSync, table: string, column: string): boolean {
  return (database.prepare(`pragma table_info(${table})`).all() as Array<{ name?: unknown }>)
    .some(row => row.name === column)
}

function emptyMastraThreadShellPredicate(database: DatabaseSync, tables: Set<string>): string | null {
  if (!tables.has('mastra_threads') || !tables.has('mastra_messages')) return null
  const stateGuard = tables.has('mastra_thread_state') && tableHasColumn(database, 'mastra_thread_state', 'thread_id')
    ? "and not exists (select 1 from mastra_thread_state s where s.thread_id = t.id)"
    : ''
  const workflowGuard = tables.has('mastra_workflow_snapshot') && tableHasColumn(database, 'mastra_workflow_snapshot', 'resourceId')
    ? "and not exists (select 1 from mastra_workflow_snapshot w where w.resourceId = t.resourceId)"
    : ''
  return `
    title = 'Guildhall memory-core thread'
    and metadata is null
    and not exists (select 1 from mastra_messages m where m.thread_id = t.id)
    ${stateGuard}
    ${workflowGuard}
  `
}

export function inspectEmptyMastraThreadShells(input: {
  projectRoot: string
  projectId: string
}): EmptyMastraThreadShellInspection {
  const paths = resolveMemoryPaths({
    projectRoot: input.projectRoot,
    scope: { kind: 'project', projectId: input.projectId },
  })
  if (!existsSync(paths.dbPath)) return { storagePath: paths.dbPath, count: 0, bytes: 0 }
  const bytes = statSync(paths.dbPath).size
  const database = new DatabaseSync(paths.dbPath, { readOnly: true })
  try {
    const predicate = emptyMastraThreadShellPredicate(database, memoryDatabaseTables(database))
    if (!predicate) return { storagePath: paths.dbPath, count: 0, bytes }
    const row = database.prepare(`select count(*) as count from mastra_threads t where ${predicate}`).get() as { count?: number | bigint }
    return { storagePath: paths.dbPath, count: Number(row.count ?? 0), bytes }
  } finally {
    database.close()
  }
}

/**
 * Remove only Guildhall-created Mastra thread shells that never acquired
 * memory. Read paths used to create these rows, so this is a one-time repair
 * for the old write bug, not a general history-retention policy.
 */
export function removeEmptyMastraThreadShells(input: {
  projectRoot: string
  projectId: string
}): EmptyMastraThreadShellCleanupResult {
  const paths = resolveMemoryPaths({
    projectRoot: input.projectRoot,
    scope: { kind: 'project', projectId: input.projectId },
  })
  if (!existsSync(paths.dbPath)) {
    return { storagePath: paths.dbPath, removed: 0, bytesBefore: 0, bytesAfter: 0 }
  }

  const inspection = inspectEmptyMastraThreadShells(input)
  const bytesBefore = inspection.bytes
  if (inspection.count === 0) {
    return { storagePath: paths.dbPath, removed: 0, bytesBefore, bytesAfter: bytesBefore }
  }
  const database = new DatabaseSync(paths.dbPath)
  let removed = 0
  try {
    const predicate = emptyMastraThreadShellPredicate(database, memoryDatabaseTables(database))
    if (predicate) {
      database.exec('begin immediate')
      try {
        database.prepare(`delete from mastra_threads where id in (select t.id from mastra_threads t where ${predicate})`).run()
        database.exec('commit')
      } catch (error) {
        database.exec('rollback')
        throw error
      }
      removed = inspection.count
      // Deleting rows does not return SQLite pages to the file. This migration
      // runs once per project, so reclaim the space after the guarded delete.
      database.exec('vacuum')
    }
  } finally {
    database.close()
  }
  return {
    storagePath: paths.dbPath,
    removed,
    bytesBefore,
    bytesAfter: removed > 0 ? statSync(paths.dbPath).size : bytesBefore,
  }
}

export async function recordMemoryEvent(input: {
  projectRoot: string
  event: RecordMemoryEventInput
  now?: () => Date
}): Promise<MemoryWriteResult> {
  const paths = resolveMemoryPaths({ projectRoot: input.projectRoot, scope: input.event.scope })
  await initializeMemoryStoreDirectory(paths)
  const recordedAt = (input.now ?? (() => new Date()))().toISOString()
  const id = eventId(input.event, recordedAt)
  const event: MemoryEvent = {
    schemaVersion: 2,
    scope: input.event.scope,
    source: input.event.source,
    content: {
      summary: boundedMemorySummary(input.event.content.summary),
    },
    metadata: input.event.metadata,
    id,
    recordedAt,
    sourceRefs: [sourceRefForEvent(id, input.event)],
  }
  await appendBoundedMemoryEvent(paths.eventsPath, event)
  return {
    id,
    storagePath: paths.eventsPath,
    repoLocalWrites: [],
  }
}

export interface MemoryEventConsolidationResult {
  dryRun: boolean
  filesSeen: number
  filesRemoved: number
  eventsSeen: number
  eventsRetained: number
  bytesBefore: number
  bytesAfter: number
}

/**
 * One-time migration for the old per-scope event directory. The current
 * writer already enforces the project-wide bound; this function only moves
 * legacy records into that same bounded stream and removes the old files when
 * an explicit cleanup/migration asks it to.
 */
export async function consolidateProjectMemoryEvents(
  projectRoot: string,
  options: { dryRun?: boolean } = {},
): Promise<MemoryEventConsolidationResult> {
  const dryRun = options.dryRun ?? true
  const memoryDir = path.join(getProjectLocalHistoryDir(projectRoot), 'memory')
  const currentPath = path.join(memoryDir, MEMORY_EVENT_STREAM_FILENAME)
  const legacyDir = path.join(memoryDir, 'events')
  const files: string[] = []
  for (const candidate of [currentPath]) {
    try {
      if ((await fsp.stat(candidate)).isFile()) files.push(candidate)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
  try {
    for (const entry of await fsp.readdir(legacyDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path.join(legacyDir, entry.name))
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  const byId = new Map<string, MemoryEvent>()
  let bytesBefore = 0
  for (const file of files) {
    bytesBefore += (await fsp.stat(file)).size
    for (const event of await readMemoryEventFile(file)) byId.set(event.id, event)
  }
  const ordered = [...byId.values()].sort((left, right) =>
    left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id))
  const retained: MemoryEvent[] = []
  let bytesAfter = 0
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const event = ordered[index]
    if (!event) continue
    const lineBytes = Buffer.byteLength(`${JSON.stringify(event)}\n`, 'utf8')
    if (lineBytes > MEMORY_EVENT_HISTORY_MAX_BYTES || bytesAfter + lineBytes > MEMORY_EVENT_HISTORY_MAX_BYTES) break
    retained.unshift(event)
    bytesAfter += lineBytes
  }
  if (!dryRun && files.length > 0) {
    await fsp.mkdir(memoryDir, { recursive: true })
    await writeManagedTextFile(currentPath, retained.length > 0
      ? `${retained.map(event => JSON.stringify(event)).join('\n')}\n`
      : '', 'utf8')
    for (const file of files) {
      if (file !== currentPath) await fsp.rm(file, { force: true })
    }
    try {
      if ((await fsp.readdir(legacyDir)).length === 0) await fsp.rmdir(legacyDir)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && (err as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw err
    }
  }
  return {
    dryRun,
    filesSeen: files.length,
    filesRemoved: dryRun ? 0 : files.filter(file => file !== currentPath).length,
    eventsSeen: byId.size,
    eventsRetained: retained.length,
    bytesBefore,
    bytesAfter,
  }
}

export async function readMemoryEvents(input: {
  projectRoot: string
  scope: GuildhallMemoryScope
}): Promise<MemoryEvent[]> {
  const paths = resolveMemoryPaths(input)
  const current = await readMemoryEventFile(paths.eventsPath)
  // Historical per-scope files are migration inputs only. Normal reads must
  // never reopen them after the project crosses the bounded-stream boundary.
  return current
    .filter(event => scopeKey(event.scope) === scopeKey(input.scope))
    .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id))
}

async function readMemoryEventFile(filePath: string): Promise<MemoryEvent[]> {
  let raw = ''
  try {
    raw = await readManagedTextFile(filePath, 'utf8')
  } catch (err) {
    if (String(err).includes('ENOENT')) return []
    throw err
  }
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => normalizeStoredMemoryEvent(JSON.parse(line)))
}

function boundedMemorySummary(summary: string): string {
  const compact = summary.trim().replace(/\s+/g, ' ')
  if (compact.length <= MEMORY_EVENT_SUMMARY_MAX_CHARS) return compact
  return `${compact.slice(0, MEMORY_EVENT_SUMMARY_MAX_CHARS - 28).trimEnd()}... [bounded memory summary]`
}

function normalizeStoredMemoryEvent(value: unknown): MemoryEvent {
  const event = value as Partial<MemoryEvent> & {
    content?: { summary?: unknown }
  }
  if (!event || typeof event !== 'object' || typeof event.id !== 'string') {
    throw new Error('Invalid persisted memory event')
  }
  return {
    schemaVersion: 2,
    scope: event.scope as GuildhallMemoryScope,
    source: event.source as MemoryEvent['source'],
    content: {
      summary: boundedMemorySummary(typeof event.content?.summary === 'string' ? event.content.summary : ''),
    },
    metadata: event.metadata as MemoryEvent['metadata'],
    id: event.id,
    recordedAt: event.recordedAt ?? '',
    sourceRefs: Array.isArray(event.sourceRefs) ? event.sourceRefs as MemorySourceRef[] : [],
  }
}

async function appendBoundedMemoryEvent(filePath: string, event: MemoryEvent): Promise<void> {
  await appendManagedTextFile(filePath, `${JSON.stringify(event)}\n`, 'utf8')
  let bytes: number
  try {
    bytes = statSync(filePath).size
  } catch {
    return
  }
  if (bytes <= MEMORY_EVENT_HISTORY_MAX_BYTES) return

  const raw = await readManagedTextFile(filePath, 'utf8')
  const lines = raw.split('\n').filter(line => line.trim().length > 0)
  const kept: string[] = []
  let keptBytes = 0
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (!line) continue
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1
    if (lineBytes > MEMORY_EVENT_HISTORY_MAX_BYTES || keptBytes + lineBytes > MEMORY_EVENT_HISTORY_MAX_BYTES) break
    kept.unshift(line)
    keptBytes += lineBytes
  }
  await writeManagedTextFile(filePath, kept.length > 0 ? `${kept.join('\n')}\n` : '', 'utf8')
}

export async function writeMemoryAuditReport(input: {
  projectRoot: string
  scope: GuildhallMemoryScope
  report: MemoryAuditReport
}): Promise<MemoryAuditReportRef> {
  const paths = resolveMemoryPaths(input)
  const name = `memory-audit-${safeTimestamp(input.report.generatedAt)}.json`
  const reportPath = path.join(paths.auditDir, name)
  await writeManagedTextFile(reportPath, `${JSON.stringify(input.report, null, 2)}\n`, 'utf8')
  return {
    path: reportPath,
    repoLocalWrites: [],
  }
}

function sourceRefForEvent(id: string, event: RecordMemoryEventInput): MemorySourceRef {
  return {
    id: `${id}:source`,
    sourceKind: event.source.kind,
    uri: event.source.ref,
    ...(event.source.path ? { path: event.source.path } : {}),
    ...(event.source.hash ? { hash: event.source.hash } : {}),
    capturedAt: event.source.capturedAt,
  }
}

function eventId(event: RecordMemoryEventInput, recordedAt: string): string {
  return createHash('sha1')
    .update(JSON.stringify({
      scope: event.scope,
      source: event.source,
      summary: event.content.summary,
      recordedAt,
    }))
    .digest('hex')
    .slice(0, 16)
}

function safeTimestamp(value: string): string {
  return value.replace(/[^0-9A-Za-z._-]+/g, '-')
}
