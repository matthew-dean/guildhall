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
 * Read the current attention projection without rediscovering Inbox items.
 * A missing or stale watermark is an honest cache miss, not permission to
 * present old attention as current.
 */
export function readCurrentAttentionProjection(projectRoot: string): AttentionProjectionResult | null {
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
}

/** The one saved Inbox surface used by both project detail and /inbox. */
export function readSavedAttentionSurface(
  projectRoot: string,
  initializationNeeded: boolean,
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
  const items = current.openItems.filter(isAttentionOwnedInboxItem)
  return {
    items,
    history: current.history.filter(isAttentionOwnedInboxItem),
    blockers: buildInboxBlockers(items),
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
