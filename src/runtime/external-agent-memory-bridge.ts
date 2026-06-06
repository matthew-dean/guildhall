import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  Confidence,
  Freshness,
  MemoryEvidenceRef,
  MemoryScope,
  MemoryType,
  Risk,
  recordMemoryObservation,
  type MemoryStatus,
} from './memory-store.js'

export const EXTERNAL_AGENT_MEMORY_BRIDGE_FILE = 'external-agent-memory-bridge.json'

export const ExternalMemoryBridgeProvider = z.enum([
  'codex',
  'codex-subagent',
  'claude-code',
  'other-mcp-client',
])
export type ExternalMemoryBridgeProvider = z.infer<typeof ExternalMemoryBridgeProvider>

export const ExternalMemoryBridgeExchange = z.enum(['import', 'link'])
export type ExternalMemoryBridgeExchange = z.infer<typeof ExternalMemoryBridgeExchange>

export const ExternalMemoryBridgeReviewStatus = z.enum(['imported', 'reviewed', 'rejected'])
export type ExternalMemoryBridgeReviewStatus = z.infer<typeof ExternalMemoryBridgeReviewStatus>

export const ExternalMemoryBridgeRecord = z.object({
  id: z.string().min(1),
  provider: ExternalMemoryBridgeProvider,
  externalAgentId: z.string().min(1).optional(),
  externalSessionId: z.string().min(1).optional(),
  exchange: ExternalMemoryBridgeExchange,
  sourceRef: z.string().min(1).optional(),
  scope: MemoryScope,
  type: MemoryType,
  summary: z.string().min(1),
  content: z.string().min(1).optional(),
  tags: z.array(z.string()).default([]),
  domains: z.array(z.string()).default([]),
  structuralScopes: z.array(z.string()).default([]),
  taskKinds: z.array(z.string()).default([]),
  fileAreas: z.array(z.string()).default([]),
  confidence: Confidence.default('medium'),
  risk: Risk.default('low'),
  freshness: Freshness,
  evidenceRefs: z.array(MemoryEvidenceRef).min(1),
  reviewStatus: ExternalMemoryBridgeReviewStatus.default('imported'),
  reviewer: z.string().min(1).optional(),
  reviewedAt: z.string().min(1).optional(),
  rejectionReason: z.string().min(1).optional(),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString()),
}).superRefine((record, ctx) => {
  if (record.exchange === 'import' && !record.content?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['content'],
      message: 'Imported external memory requires a bounded summary body.',
    })
  }
  if (record.exchange === 'link' && !record.sourceRef?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sourceRef'],
      message: 'Linked external memory requires a sourceRef.',
    })
  }
  if (record.reviewStatus === 'reviewed' && record.freshness === 'stale') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['freshness'],
      message: 'Stale external memory must be refreshed before review.',
    })
  }
})
export type ExternalMemoryBridgeRecord = z.output<typeof ExternalMemoryBridgeRecord>
export type ExternalMemoryBridgeRecordInput = z.input<typeof ExternalMemoryBridgeRecord>

export const ExternalMemoryBridgeStore = z.object({
  version: z.literal(1).default(1),
  records: z.array(ExternalMemoryBridgeRecord).default([]),
})
export type ExternalMemoryBridgeStore = z.infer<typeof ExternalMemoryBridgeStore>

export function externalMemoryBridgePath(memoryDir: string): string {
  return path.join(memoryDir, EXTERNAL_AGENT_MEMORY_BRIDGE_FILE)
}

export async function importExternalMemoryBridgeRecord(input: {
  memoryDir: string
  record: ExternalMemoryBridgeRecordInput
}): Promise<ExternalMemoryBridgeRecord> {
  const store = await readExternalMemoryBridgeStore(input.memoryDir)
  const existing = store.records.find(record => record.id === input.record.id)
  const now = new Date().toISOString()
  const record = ExternalMemoryBridgeRecord.parse({
    ...input.record,
    reviewStatus: input.record.reviewStatus ?? existing?.reviewStatus ?? 'imported',
    createdAt: input.record.createdAt ?? existing?.createdAt ?? now,
    updatedAt: input.record.updatedAt ?? now,
  })
  await writeExternalMemoryBridgeStore(input.memoryDir, {
    version: 1,
    records: upsert(store.records, record),
  })
  return record
}

export async function listExternalMemoryBridgeRecords(input: {
  memoryDir: string
  reviewStatus?: ExternalMemoryBridgeReviewStatus
}): Promise<ExternalMemoryBridgeStore> {
  const store = await readExternalMemoryBridgeStore(input.memoryDir)
  return {
    ...store,
    records: input.reviewStatus
      ? store.records.filter(record => record.reviewStatus === input.reviewStatus)
      : store.records,
  }
}

export async function exportExternalMemoryBridgeRecords(input: {
  memoryDir: string
}): Promise<ExternalMemoryBridgeStore> {
  return readExternalMemoryBridgeStore(input.memoryDir)
}

export async function reviewExternalMemoryBridgeRecord(input: {
  memoryDir: string
  id: string
  reviewer: string
  now?: string
  memoryStatus?: Extract<MemoryStatus, 'active' | 'proposed' | 'observed'>
}): Promise<ExternalMemoryBridgeRecord> {
  const store = await readExternalMemoryBridgeStore(input.memoryDir)
  const existing = store.records.find(record => record.id === input.id)
  if (!existing) throw new Error(`External memory bridge record not found: ${input.id}`)
  const now = input.now ?? new Date().toISOString()
  const reviewed = ExternalMemoryBridgeRecord.parse({
    ...existing,
    reviewStatus: 'reviewed',
    reviewer: input.reviewer,
    reviewedAt: now,
    updatedAt: now,
  })
  await writeExternalMemoryBridgeStore(input.memoryDir, {
    version: 1,
    records: upsert(store.records, reviewed),
  })
  await recordMemoryObservation({
    memoryDir: input.memoryDir,
    record: {
      id: memoryRecordId(reviewed.id),
      scope: reviewed.scope,
      type: reviewed.type,
      status: input.memoryStatus ?? 'active',
      summary: reviewed.summary,
      content: reviewed.content ?? reviewed.summary,
      tags: reviewed.tags,
      domains: reviewed.domains,
      structuralScopes: reviewed.structuralScopes,
      taskKinds: reviewed.taskKinds,
      fileAreas: reviewed.fileAreas,
      confidence: reviewed.confidence,
      risk: reviewed.risk,
      freshness: reviewed.freshness,
      evidenceRefs: reviewed.evidenceRefs,
      createdAt: reviewed.createdAt,
      updatedAt: now,
      source: `external-memory-bridge:${reviewed.provider}`,
    },
  })
  return reviewed
}

export async function rejectExternalMemoryBridgeRecord(input: {
  memoryDir: string
  id: string
  reviewer: string
  rejectionReason: string
  now?: string
}): Promise<ExternalMemoryBridgeRecord> {
  const store = await readExternalMemoryBridgeStore(input.memoryDir)
  const existing = store.records.find(record => record.id === input.id)
  if (!existing) throw new Error(`External memory bridge record not found: ${input.id}`)
  const now = input.now ?? new Date().toISOString()
  const rejected = ExternalMemoryBridgeRecord.parse({
    ...existing,
    reviewStatus: 'rejected',
    reviewer: input.reviewer,
    rejectionReason: input.rejectionReason,
    reviewedAt: now,
    updatedAt: now,
  })
  await writeExternalMemoryBridgeStore(input.memoryDir, {
    version: 1,
    records: upsert(store.records, rejected),
  })
  return rejected
}

async function readExternalMemoryBridgeStore(memoryDir: string): Promise<ExternalMemoryBridgeStore> {
  try {
    const raw = await readManagedTextFile(externalMemoryBridgePath(memoryDir), 'utf-8')
    return ExternalMemoryBridgeStore.parse(JSON.parse(raw))
  } catch {
    return ExternalMemoryBridgeStore.parse({})
  }
}

async function writeExternalMemoryBridgeStore(
  memoryDir: string,
  store: ExternalMemoryBridgeStore,
): Promise<void> {
  await fsp.mkdir(memoryDir, { recursive: true })
  const file = externalMemoryBridgePath(memoryDir)
  const tmp = `${file}.tmp`
  await writeManagedTextFile(tmp, `${JSON.stringify(ExternalMemoryBridgeStore.parse(store), null, 2)}\n`, 'utf-8')
  await fsp.rename(tmp, file)
}

function memoryRecordId(id: string): string {
  return `external-${id}`
}

function upsert<T extends { id: string }>(items: readonly T[], item: T): T[] {
  return [...items.filter(existing => existing.id !== item.id), item]
    .sort((left, right) => left.id.localeCompare(right.id))
}
