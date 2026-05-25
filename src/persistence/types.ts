import { z } from 'zod'

export const PersistenceScope = z.enum([
  'shared_project',
  'local_history',
  'global_user',
  'exported_artifact',
])
export type PersistenceScope = z.infer<typeof PersistenceScope>

export const PersistenceRetention = z.enum(['active', 'archive', 'debug', 'ephemeral'])
export type PersistenceRetention = z.infer<typeof PersistenceRetention>

export const PersistenceVisibility = z.enum(['user_visible', 'internal_audit', 'private_runtime'])
export type PersistenceVisibility = z.infer<typeof PersistenceVisibility>

export const PersistenceCommitPolicy = z.enum(['committed', 'ignored', 'user_exported'])
export type PersistenceCommitPolicy = z.infer<typeof PersistenceCommitPolicy>

export const PersistencePlacement = z.object({
  scope: PersistenceScope,
  retention: PersistenceRetention,
  visibility: PersistenceVisibility,
  commitPolicy: PersistenceCommitPolicy,
})
export type PersistencePlacement = z.infer<typeof PersistencePlacement>

export const PersistenceRef = z.object({
  scope: PersistenceScope,
  collection: z.string().min(1),
  id: z.string().min(1),
  path: z.string().min(1),
})
export type PersistenceRef = z.infer<typeof PersistenceRef>

export const EvidenceRef = PersistenceRef.extend({
  hash: z.string().optional(),
  contentType: z.string().optional(),
})
export type EvidenceRef = z.infer<typeof EvidenceRef>

export const PersistedRecord = z.object({
  schema: z.object({
    name: z.string().min(1),
    version: z.number().int().positive(),
  }),
  ref: PersistenceRef,
  placement: PersistencePlacement,
  provenance: z.object({
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    createdBy: z.string().min(1),
    sourceRefs: z.array(z.string()).default([]),
  }),
  contentHash: z.string().min(1),
  payload: z.unknown(),
  compaction: z.object({
    compactedFrom: z.array(EvidenceRef).default([]),
    fullEvidenceAvailable: z.boolean().default(true),
  }).optional(),
})
export type PersistedRecord<T = unknown> = Omit<z.infer<typeof PersistedRecord>, 'payload'> & {
  payload: T
}

export const PersistedEvent = z.object({
  schema: z.object({
    name: z.string().min(1),
    version: z.number().int().positive(),
  }),
  ref: PersistenceRef,
  eventId: z.string().min(1),
  recordedAt: z.string().min(1),
  recordedBy: z.string().min(1),
  placement: PersistencePlacement,
  sourceRefs: z.array(z.string()).default([]),
  contentHash: z.string().min(1),
  payload: z.unknown(),
})
export type PersistedEvent<T = unknown> = Omit<z.infer<typeof PersistedEvent>, 'payload'> & {
  payload: T
}

export interface BasePersistenceInput {
  projectRoot?: string
  exportRoot?: string
  placement: PersistencePlacement
  collection: string
  schemaName: string
  schemaVersion: number
  createdBy: string
  sourceRefs?: string[]
  now?: () => Date
}

export interface WriteRecordInput<T> extends BasePersistenceInput {
  id?: string
  payload: T
  compactedFrom?: EvidenceRef[]
}

export interface AppendEventInput<T> extends BasePersistenceInput {
  streamId: string
  eventId?: string
  payload: T
}

export interface EventQuery {
  projectRoot?: string
  exportRoot?: string
  placement: PersistencePlacement
  collection: string
  streamId: string
}

export interface SaveArtifactInput extends Omit<BasePersistenceInput, 'schemaName' | 'schemaVersion'> {
  id?: string
  content: string | Buffer
  contentType: string
  extension?: string
}

export interface ArtifactRef extends EvidenceRef {
  bytes: number
}

export interface EvidenceResolution {
  ref: EvidenceRef
  available: boolean
  reason?: 'missing' | 'unsupported_scope'
}

export interface CompactionScope {
  projectRoot?: string
  exportRoot?: string
  placement: PersistencePlacement
  collection: string
  id: string
  evidenceRefs: EvidenceRef[]
  createdBy: string
  now?: () => Date
}

export interface CompactionSummary {
  ref: PersistenceRef
  compactedAt: string
  compactedBy: string
  evidenceRefs: EvidenceRef[]
  fullEvidenceAvailable: boolean
}

export interface GuildhallPersistence {
  writeRecord<T>(input: WriteRecordInput<T>): Promise<PersistedRecord<T>>
  appendEvent<T>(input: AppendEventInput<T>): Promise<PersistedEvent<T>>
  readRecord<T = unknown>(ref: PersistenceRef): Promise<PersistedRecord<T> | null>
  listEvents<T = unknown>(query: EventQuery): Promise<Array<PersistedEvent<T>>>
  saveArtifact(input: SaveArtifactInput): Promise<ArtifactRef>
  compact(scope: CompactionScope): Promise<CompactionSummary>
  resolveEvidence(ref: EvidenceRef): Promise<EvidenceResolution>
}
