import {
  hasProjectWorkspaceGoals,
  readProjectStateDatabaseAttentionRecords,
  readProjectStateDatabaseReconciliations,
  replaceProjectStateDatabaseAttentionRecords,
  upsertProjectStateDatabaseReconciliations,
} from '@guildhall/sessions'
import { compareInboxItems, type InboxItem } from './inbox.js'
import { getProjectMigrationStatus } from './migrations.js'
import { recordGuildhallRuntimeWrite } from './runtime-compatibility.js'

export type AttentionStatus = 'open' | 'resolved' | 'dismissed' | 'superseded'
export type AttentionResolution =
  | 'answered'
  | 'dismissed'
  | 'migrated'
  | 'reconciled'
  | 'replaced'
  | 'reviewed'
  | 'verified'

export type AttentionRecord = InboxItem & {
  id: string
  status: AttentionStatus
  createdAt: string
  updatedAt: string
  resolvedAt?: string
  dismissedAt?: string
  resolution?: AttentionResolution
  resolutionDetail?: string
  blocking?: boolean
  dismissible?: boolean
  source?: {
    system: string
    id: string
  }
}

interface AttentionStore {
  version: 1
  records: AttentionRecord[]
}

const PROJECT_UNDERSTANDING_CAPABILITIES = [
  'intake.text-corpus-map.v1',
  'intake.schema-surface.v1',
] as const

function readStore(projectPath: string): AttentionStore {
  const records = readProjectStateDatabaseAttentionRecords<AttentionRecord>(projectPath)
  return { version: 1, records: records?.map(record => record.payload).filter(record => typeof record.id === 'string') ?? [] }
}

export function readAttentionRecords(projectPath: string): AttentionRecord[] {
  return [...readStore(projectPath).records]
}

function writeStore(projectPath: string, store: AttentionStore): void {
  replaceProjectStateDatabaseAttentionRecords(projectPath, store.records)
  recordGuildhallRuntimeWrite(projectPath, ['attention-records.v1'])
}

function stableSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item'
}

export function attentionIdForInboxItem(item: InboxItem): string {
  if (item.kind === 'required_migration') return `migration:${item.migrationId}`
  if (item.kind === 'project_understanding') return 'project-understanding:intake-reconcile'
  if (item.kind === 'workspace_import_pending') return 'workspace-import:review'
  if (item.kind === 'proof_reconciliation') return 'proof-reconciliation:done-with-unmet-proof'
  if (item.kind === 'bootstrap_missing') return 'bootstrap:readiness'
  const taskId = 'taskId' in item ? item.taskId : undefined
  if (taskId) return `${item.kind}:${taskId}`
  return `${item.kind}:${stableSlug(`${item.actionHref ?? ''}:${item.title}`)}`
}

function sameRecordShape(a: AttentionRecord, b: InboxItem): boolean {
  const aDismissEndpoint = 'dismissEndpoint' in a ? a.dismissEndpoint : undefined
  const bDismissEndpoint = 'dismissEndpoint' in b ? b.dismissEndpoint : undefined
  const aSignals = 'signals' in a ? a.signals : undefined
  const bSignals = 'signals' in b ? b.signals : undefined
  const aMissingSteps = 'missingSteps' in a ? a.missingSteps : undefined
  const bMissingSteps = 'missingSteps' in b ? b.missingSteps : undefined
  const aBlocking = 'blocking' in a ? a.blocking : undefined
  const bBlocking = 'blocking' in b ? b.blocking : undefined
  const aDismissible = 'dismissible' in a ? a.dismissible : undefined
  const bDismissible = 'dismissible' in b ? b.dismissible : undefined
  return (
    a.kind === b.kind &&
    a.severity === b.severity &&
    a.title === b.title &&
    a.detail === b.detail &&
    a.actionHref === b.actionHref &&
    aDismissEndpoint === bDismissEndpoint &&
    JSON.stringify(aSignals ?? []) === JSON.stringify(bSignals ?? []) &&
    JSON.stringify(aMissingSteps ?? []) === JSON.stringify(bMissingSteps ?? []) &&
    aBlocking === bBlocking &&
    aDismissible === bDismissible
  )
}

function toOpenRecord(item: InboxItem, existing: AttentionRecord | undefined, now: string): AttentionRecord {
  if (existing && existing.status !== 'dismissed' && existing.status !== 'superseded') {
    const unchanged = sameRecordShape(existing, item) && existing.status === 'open'
    return {
      ...existing,
      ...item,
      id: existing.id,
      status: 'open',
      createdAt: existing.createdAt,
      updatedAt: unchanged ? existing.updatedAt : now,
      resolvedAt: undefined,
      resolution: undefined,
      resolutionDetail: undefined,
    }
  }
  return {
    ...item,
    id: attentionIdForInboxItem(item),
    status: 'open',
    createdAt: now,
    updatedAt: now,
  }
}

function hasWorkspaceImportOutcome(projectPath: string): boolean {
  return hasProjectWorkspaceGoals(projectPath)
}

function readResolvedReconciliationCapabilities(projectPath: string): Set<string> {
  return new Set(
    (readProjectStateDatabaseReconciliations(projectPath) ?? [])
      .filter(record => record.status === 'resolved')
      .map(record => record.capabilityId),
  )
}

export function buildProjectUnderstandingAdvisories(projectPath: string): InboxItem[] {
  if (!hasWorkspaceImportOutcome(projectPath)) return []
  const resolved = readResolvedReconciliationCapabilities(projectPath)
  const missing = PROJECT_UNDERSTANDING_CAPABILITIES.filter(id => !resolved.has(id))
  if (missing.length === 0) return []
  return [{
    kind: 'project_understanding',
    severity: 'medium',
    title: 'Review project discovery update',
    detail: 'More planning docs and migrations can now be scanned. Review the reconciliation to update or dismiss stale imported work.',
    signals: [...missing],
    actionHref: '/workspace-import?mode=reconcile',
    dismissEndpoint: '/api/project/attention/dismiss?id=project-understanding%3Aintake-reconcile',
  }]
}

export function projectAttentionRecords(input: {
  existingRecords: readonly AttentionRecord[]
  openItems: readonly InboxItem[]
  now?: string
}): { openItems: AttentionRecord[]; history: AttentionRecord[] } {
  const now = input.now ?? new Date().toISOString()
  const byId = new Map(input.existingRecords.map(record => [record.id, record]))
  const openIds = new Set<string>()
  const nextRecords = [...input.existingRecords]

  for (const item of input.openItems) {
    const id = attentionIdForInboxItem(item)
    openIds.add(id)
    const existing = byId.get(id)
    if (existing?.status === 'dismissed') continue
    const next = toOpenRecord(item, existing, now)
    const index = nextRecords.findIndex(record => record.id === id)
    if (index >= 0) nextRecords[index] = next
    else nextRecords.push(next)
    byId.set(id, next)
  }

  for (const record of [...nextRecords]) {
    if (record.status !== 'open' || openIds.has(record.id)) continue
    const index = nextRecords.findIndex(candidate => candidate.id === record.id)
    nextRecords[index] = {
      ...record,
      status: 'resolved',
      resolution: record.kind === 'workspace_import_pending'
        ? 'reviewed'
        : record.kind === 'required_migration'
          ? 'migrated'
          : 'verified',
      resolvedAt: now,
      updatedAt: now,
    }
  }

  const normalized = nextRecords
    .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))
    .slice(0, 250)
  const history = normalized
  return {
    openItems: history
      .filter(record => record.status === 'open')
      .sort((a, b) => compareInboxItems(a, b) || (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)),
    history,
  }
}

export function reconcileAttentionRecords(input: {
  projectPath: string
  openItems: readonly InboxItem[]
}): { openItems: AttentionRecord[]; history: AttentionRecord[] } {
  const result = projectAttentionRecords({
    existingRecords: readStore(input.projectPath).records,
    openItems: input.openItems,
  })
  writeStore(input.projectPath, { version: 1, records: result.history })
  return result
}

export async function buildProjectMigrationAdvisories(projectPath: string): Promise<InboxItem[]> {
  const status = await getProjectMigrationStatus({ projectRoot: projectPath })
  return status.blocked.map(item => ({
    kind: 'required_migration' as const,
    severity: 'high' as const,
    migrationId: item.id,
    title: `Required migration: ${item.title}`,
    detail: `${item.summary} Run this migration before the project can update.`,
    actionHref: '/migrations',
    blocking: true,
    dismissible: false,
    source: {
      system: 'migrations',
      id: item.id,
    },
  }))
}

export function markAttentionDismissed(projectPath: string, id: string, detail = 'Dismissed by user.'): AttentionRecord | null {
  const store = readStore(projectPath)
  const index = store.records.findIndex(record => record.id === id)
  if (index < 0) return null
  const now = new Date().toISOString()
  const next = {
    ...store.records[index]!,
    status: 'dismissed' as const,
    resolution: 'dismissed' as const,
    resolutionDetail: detail,
    dismissedAt: now,
    updatedAt: now,
  }
  store.records[index] = next
  writeStore(projectPath, store)
  return next
}

export function recordReconciliationResolved(projectPath: string, capabilityIds = PROJECT_UNDERSTANDING_CAPABILITIES): void {
  const now = new Date().toISOString()
  upsertProjectStateDatabaseReconciliations(projectPath, capabilityIds.map(capabilityId => (
    {
      capabilityId,
      status: 'resolved',
      resolvedAt: now,
      resolution: 'reconciled',
    }
  )))
}
