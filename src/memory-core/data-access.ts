import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { appendManagedTextFile, readManagedTextFile, writeManagedTextFile } from '@guildhall/persistence'
import { getProjectLocalHistoryDir } from '@guildhall/sessions'

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
    eventsPath: path.join(memoryDir, 'events', `${scopeKey(input.scope)}.jsonl`),
    auditDir: path.join(memoryDir, 'audit'),
  }
}

export async function initializeMemoryStoreDirectory(paths: MemoryPaths): Promise<void> {
  await fsp.mkdir(paths.memoryDir, { recursive: true })
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
    ...input.event,
    id,
    recordedAt,
    sourceRefs: [sourceRefForEvent(id, input.event)],
  }
  await appendManagedTextFile(paths.eventsPath, `${JSON.stringify(event)}\n`, 'utf8')
  return {
    id,
    storagePath: paths.eventsPath,
    repoLocalWrites: [],
  }
}

export async function readMemoryEvents(input: {
  projectRoot: string
  scope: GuildhallMemoryScope
}): Promise<MemoryEvent[]> {
  const paths = resolveMemoryPaths(input)
  let raw = ''
  try {
    raw = await readManagedTextFile(paths.eventsPath, 'utf8')
  } catch (err) {
    if (String(err).includes('ENOENT')) return []
    throw err
  }
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MemoryEvent)
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
