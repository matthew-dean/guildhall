import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

import { getProjectLocalHistoryDir, getProjectRuntimeCommandEvidencePath } from '@guildhall/sessions'
import { FileBackedGuildhallPersistence } from '@guildhall/persistence'
import type { PersistencePlacement } from '@guildhall/persistence'

export const RuntimeExpectedPort = z.object({
  container: z.number().int().positive(),
  purpose: z.enum(['dashboard', 'dev-server', 'browser-proof', 'custom']),
})
export type RuntimeExpectedPort = z.infer<typeof RuntimeExpectedPort>

const RuntimeStartedEvent = z.object({
  type: z.literal('started'),
  at: z.string(),
  cwd: z.string(),
  argv: z.array(z.string()),
})
const RuntimeStdoutEvent = z.object({
  type: z.literal('stdout'),
  at: z.string(),
  data: z.string(),
})
const RuntimeStderrEvent = z.object({
  type: z.literal('stderr'),
  at: z.string(),
  data: z.string(),
})
const RuntimeExitEvent = z.object({
  type: z.literal('exit'),
  at: z.string(),
  exitCode: z.number().int(),
})
const RuntimeFailedEvent = z.object({
  type: z.literal('failed'),
  at: z.string(),
  reason: z.enum(['timeout', 'cancelled', 'error']),
  message: z.string(),
})
const RuntimePortEvent = z.object({
  type: z.literal('port'),
  at: z.string(),
  port: z.number().int().positive(),
  hostPort: z.number().int().positive(),
})
const RuntimeHealthWarningEvent = z.object({
  type: z.literal('health_warning'),
  at: z.string(),
  message: z.string(),
})

export const RuntimeCommandEventSchema = z.discriminatedUnion('type', [
  RuntimeStartedEvent,
  RuntimeStdoutEvent,
  RuntimeStderrEvent,
  RuntimeExitEvent,
  RuntimeFailedEvent,
  RuntimePortEvent,
  RuntimeHealthWarningEvent,
])
export type RuntimeCommandEvent = z.infer<typeof RuntimeCommandEventSchema>

export const ProjectRuntimeCommandRequest = z.object({
  projectId: z.string().min(1),
  cwd: z.string().min(1),
  argv: z.array(z.string().min(1)).min(1),
  env: z.record(z.string()).default({}),
  timeoutMs: z.number().int().positive().default(120_000),
  expectedPorts: z.array(RuntimeExpectedPort).default([]),
  taskId: z.string().optional(),
})
export type ProjectRuntimeCommandRequest = z.infer<typeof ProjectRuntimeCommandRequest>

export interface RuntimeCommandEvidenceRecord {
  id: string
  projectId: string
  taskId?: string
  request: ProjectRuntimeCommandRequest
  runtime: {
    id: string | null
    containerId: string | null
  }
  status: 'exited' | 'failed' | 'timed_out' | 'cancelled'
  exitCode: number | null
  startedAt: string
  completedAt: string
  events: RuntimeCommandEvent[]
  error: string | null
}

export interface RuntimeCommandResult extends RuntimeCommandEvidenceRecord {
  commandId: string
}

const runtimeCommandEvidencePlacement: PersistencePlacement = {
  scope: 'local_history',
  retention: 'active',
  visibility: 'internal_audit',
  commitPolicy: 'ignored',
}

export function createRuntimeCommandId(): string {
  return `cmd-${randomUUID()}`
}

export async function appendRuntimeCommandEvidence(
  projectRoot: string,
  record: RuntimeCommandEvidenceRecord,
): Promise<RuntimeCommandEvidenceRecord> {
  await appendRuntimeCommandEvidenceEvent(projectRoot, record)
  return record
}

async function appendRuntimeCommandEvidenceEvent(
  projectRoot: string,
  record: RuntimeCommandEvidenceRecord,
): Promise<void> {
  const persistence = new FileBackedGuildhallPersistence()
  await persistence.appendEvent({
    projectRoot,
    placement: runtimeCommandEvidencePlacement,
    collection: 'runtime-command-evidence',
    streamId: record.taskId ?? record.projectId,
    eventId: record.id,
    schemaName: 'runtime-command-evidence',
    schemaVersion: 1,
    createdBy: 'runtime-command',
    sourceRefs: [
      `project:${record.projectId}`,
      ...(record.taskId ? [`task:${record.taskId}`] : []),
    ],
    payload: record,
  })
}

export async function readRuntimeCommandEvidence(projectRoot: string): Promise<RuntimeCommandEvidenceRecord[]> {
  const persisted = await readPersistedRuntimeCommandEvidence(projectRoot)
  if (persisted.length > 0) return persisted
  return readLegacyRuntimeCommandEvidence(projectRoot)
}

export async function hasLegacyRuntimeCommandEvidence(projectRoot: string): Promise<boolean> {
  const records = await readLegacyRuntimeCommandEvidence(projectRoot)
  return records.length > 0
}

export async function migrateLegacyRuntimeCommandEvidenceToPersistence(projectRoot: string): Promise<{
  migrated: number
  skipped: number
  deletedLegacyFile: boolean
  affectedPaths: string[]
}> {
  const legacyFile = getProjectRuntimeCommandEvidencePath(projectRoot)
  const legacyRecords = await readLegacyRuntimeCommandEvidence(projectRoot)
  if (legacyRecords.length === 0) {
    return { migrated: 0, skipped: 0, deletedLegacyFile: false, affectedPaths: [] }
  }
  const existingIds = new Set((await readPersistedRuntimeCommandEvidence(projectRoot)).map((record) => record.id))
  let migrated = 0
  let skipped = 0
  for (const record of legacyRecords) {
    if (existingIds.has(record.id)) {
      skipped++
      continue
    }
    await appendRuntimeCommandEvidenceEvent(projectRoot, record)
    existingIds.add(record.id)
    migrated++
  }
  await fs.rm(legacyFile, { force: true })
  return {
    migrated,
    skipped,
    deletedLegacyFile: true,
    affectedPaths: [legacyFile],
  }
}

async function readLegacyRuntimeCommandEvidence(projectRoot: string): Promise<RuntimeCommandEvidenceRecord[]> {
  const file = getProjectRuntimeCommandEvidencePath(projectRoot)
  let raw = ''
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  return raw
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as RuntimeCommandEvidenceRecord)
}

async function readPersistedRuntimeCommandEvidence(projectRoot: string): Promise<RuntimeCommandEvidenceRecord[]> {
  const dir = path.join(getProjectLocalHistoryDir(projectRoot), 'persistence', 'events', 'runtime-command-evidence')
  let entries: string[] = []
  try {
    entries = await fs.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const records: RuntimeCommandEvidenceRecord[] = []
  for (const entry of entries.filter((name) => name.endsWith('.jsonl')).sort()) {
    const raw = await fs.readFile(path.join(dir, entry), 'utf8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      const event = JSON.parse(line) as { payload?: unknown }
      records.push(event.payload as RuntimeCommandEvidenceRecord)
    }
  }
  return records.sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt) ||
    a.completedAt.localeCompare(b.completedAt) ||
    a.id.localeCompare(b.id)
  )
}

export function parseDeniedHostAccess(message: string | null | undefined): string | null {
  if (!message) return null
  const match = message.match(/(?:host access denied|denied host access)\s*:\s*([^\n]+)/i)
  return match?.[1]?.trim() ?? null
}

export function suggestedCapabilityMountForHostPath(hostPath: string): {
  hostPath: string
  containerPath: string
  access: 'read-only'
} {
  const leaf = path.basename(hostPath.replace(/\/+$/, '')) || 'host-path'
  const slug = leaf.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'host-path'
  return {
    hostPath,
    containerPath: `/mnt/guildhall-grants/${slug}`,
    access: 'read-only',
  }
}
