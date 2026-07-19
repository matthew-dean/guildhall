import {
  projectAttentionRecords,
  readAttentionRecords,
  reconcileAttentionRecords,
  type AttentionRecord,
} from './attention.js'
import {
  readProjectStateDatabaseAttentionRecords,
  readProjectStateDatabaseMetadata,
  readProjectStateDatabaseProjectionWatermark,
  replaceProjectStateDatabaseAttentionRecords,
} from '@guildhall/sessions'
import { buildInboxBlockers, isAttentionOwnedInboxItem, type InboxItem } from './inbox.js'
import { recordGuildhallRuntimeWrite } from './runtime-compatibility.js'

export interface AttentionProjectionInput {
  projectRoot: string
  openItems: readonly InboxItem[]
  /** Request-local preview state; never persisted by this read path. */
  existingRecords?: readonly AttentionRecord[]
}

export interface AttentionProjectionResult {
  openItems: AttentionRecord[]
  history: AttentionRecord[]
}

export interface AttentionSurfaceReadModel {
  items: AttentionRecord[]
  history: AttentionRecord[]
  blockers: ReturnType<typeof buildInboxBlockers>
  freshness: 'current' | 'missing'
  requiresRefresh?: boolean
}

/**
 * The release facts needed to decide whether an attention item still belongs
 * to the current work envelope. This is deliberately smaller than the full
 * project summary so the attention projection cannot grow a second summary
 * model of its own.
 */
export interface AttentionReleaseTruth {
  state: 'ready' | 'blocked' | 'active' | 'shaping' | 'unknown'
  counts: {
    unfinished: number
    blocked: number
    ownerBlocked: number
    proofBlocked: number
  }
}

function currentScopeIsComplete(truth: AttentionReleaseTruth | null | undefined): boolean {
  return truth?.state === 'ready' &&
    truth.counts.unfinished === 0 &&
    truth.counts.blocked === 0 &&
    truth.counts.ownerBlocked === 0 &&
    truth.counts.proofBlocked === 0
}

/**
 * Setup, shaping, and proof-reconciliation prompts describe unfinished
 * current work. Once the selected scope is durably complete they are stale
 * for Needs you, even if an older attention record still exists. Genuine
 * machine/runtime gates remain visible because they can affect the next run.
 * History is intentionally left untouched by this filter.
 */
export function attentionItemsForReleaseTruth<T extends Pick<InboxItem, 'kind'>>(
  items: readonly T[],
  truth: AttentionReleaseTruth | null | undefined,
): T[] {
  if (!currentScopeIsComplete(truth)) return [...items]
  return items.filter(item => item.kind === 'required_migration' || item.kind === 'bootstrap_missing')
}

/**
 * Startup can use this cheap saved-state check to schedule one reconciliation
 * after a release closes. It reads only the attention table and never expands
 * tasks or scans project sources.
 */
export function attentionProjectionNeedsReleaseReconciliation(
  projectRoot: string,
  releaseTruth: AttentionReleaseTruth | null | undefined,
): boolean {
  if (!currentScopeIsComplete(releaseTruth)) return false
  const current = readCurrentAttentionProjection(projectRoot)
  if (!current) return false
  const ownedOpenItems = current.openItems.filter(isAttentionOwnedInboxItem)
  return attentionItemsForReleaseTruth(ownedOpenItems, releaseTruth).length !== ownedOpenItems.length
}

/**
 * Read the current attention projection without rediscovering Inbox items.
 * A missing or stale watermark is an honest cache miss, not permission to
 * present old attention as current.
 */
export function readCurrentAttentionProjection(projectRoot: string): AttentionProjectionResult | null {
  try {
    const metadata = readProjectStateDatabaseMetadata(projectRoot)
    const watermark = readProjectStateDatabaseProjectionWatermark(projectRoot, 'attention')
    if (!metadata || metadata.revision !== watermark?.sourceRevision) return null
    const records = readProjectStateDatabaseAttentionRecords<AttentionRecord>(projectRoot)
    if (records === null) return null
    const history = records
      .map(record => record.payload)
      .filter(record => typeof record?.id === 'string')
    return {
      openItems: history.filter(record => record.status === 'open'),
      history,
    }
  } catch {
    // A corrupt or locked project has a missing saved attention projection.
    return null
  }
}

/** The one saved Inbox surface used by both project detail and /inbox. */
export function readSavedAttentionSurface(
  projectRoot: string,
  initializationNeeded: boolean,
  releaseTruth?: AttentionReleaseTruth | null,
): AttentionSurfaceReadModel {
  if (initializationNeeded) {
    return {
      items: [],
      history: [],
      blockers: { bootstrap: false, workspaceImport: false },
      freshness: 'current',
    }
  }
  const current = readCurrentAttentionProjection(projectRoot)
  if (!current) {
    return {
      items: [],
      history: [],
      blockers: { bootstrap: false, workspaceImport: false },
      freshness: 'missing',
      requiresRefresh: true,
    }
  }
  const items = attentionItemsForReleaseTruth(
    current.openItems.filter(isAttentionOwnedInboxItem),
    releaseTruth,
  )
  return {
    items,
    history: current.history.filter(isAttentionOwnedInboxItem),
    blockers: buildInboxBlockers(items),
    freshness: 'current',
  }
}

/**
 * Format attention already captured by the shared project surface boundary.
 * Callers that already have a revision-joined snapshot must not reopen SQLite
 * just to format the Inbox cards.
 */
export function readSavedAttentionSurfaceFromBoundary(input: {
  initializationNeeded: boolean
  records: readonly { payload: unknown }[] | null
  watermarkSourceRevision: number | null
  projectRevision: number | null
  releaseTruth?: AttentionReleaseTruth | null
}): AttentionSurfaceReadModel {
  if (input.initializationNeeded) {
    return {
      items: [],
      history: [],
      blockers: { bootstrap: false, workspaceImport: false },
      freshness: 'current',
    }
  }
  if (
    input.records === null ||
    input.watermarkSourceRevision === null ||
    input.projectRevision === null ||
    input.watermarkSourceRevision !== input.projectRevision
  ) {
    return {
      items: [],
      history: [],
      blockers: { bootstrap: false, workspaceImport: false },
      freshness: 'missing',
      requiresRefresh: true,
    }
  }
  const history = input.records
    .map(record => record.payload)
    .filter((record): record is AttentionRecord => Boolean(record && typeof record === 'object' && !Array.isArray(record) && typeof (record as { id?: unknown }).id === 'string'))
  const items = history
    .filter(record => record.status === 'open')
    .filter(isAttentionOwnedInboxItem)
  const currentItems = attentionItemsForReleaseTruth(items, input.releaseTruth)
  return {
    items: currentItems,
    history: history.filter(isAttentionOwnedInboxItem),
    blockers: buildInboxBlockers(currentItems),
    freshness: 'current',
  }
}

/**
 * Projects already-computed Inbox items without changing project state.
 *
 * This deliberately reads only the durable attention table. Inbox discovery,
 * history reconstruction, Git inspection, and model work belong to the caller.
 */
export function previewAttentionProjection(input: AttentionProjectionInput): AttentionProjectionResult {
  return projectAttentionRecords({
    existingRecords: input.existingRecords ?? readAttentionRecords(input.projectRoot),
    openItems: input.openItems,
  })
}

/**
 * Explicitly materializes the attention projection at a write boundary.
 *
 * The async contract lets callers await a projection write without giving this
 * helper permission to discover Inbox items or perform other project work.
 */
export async function materializeAttentionProjection(
  input: AttentionProjectionInput,
): Promise<AttentionProjectionResult> {
  if (input.existingRecords && input.existingRecords.length > 0) {
    const persisted = readAttentionRecords(input.projectRoot)
    const existingById = new Map(persisted.map(record => [record.id, record]))
    for (const record of input.existingRecords) {
      if (!existingById.has(record.id)) existingById.set(record.id, record)
    }
    const result = projectAttentionRecords({
      existingRecords: [...existingById.values()],
      openItems: input.openItems,
    })
    replaceProjectStateDatabaseAttentionRecords(input.projectRoot, result.history)
    recordGuildhallRuntimeWrite(input.projectRoot, ['attention-records.v1'])
    return result
  }
  return reconcileAttentionRecords({
    projectPath: input.projectRoot,
    openItems: input.openItems,
  })
}
