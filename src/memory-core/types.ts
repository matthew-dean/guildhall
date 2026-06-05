export type MemoryScope =
  | { kind: 'task_thread', projectRoot: string, taskId: string, threadId: string }
  | { kind: 'project', projectRoot: string }
  | { kind: 'user_global', userId?: string }
  | { kind: 'guildhall_product' }

export type MemoryConfidence = 'low' | 'medium' | 'high'
export type MemoryRisk = 'low' | 'medium' | 'high'
export type MemoryFreshness = 'fresh' | 'recent' | 'stale'

export interface MemorySourceRef {
  kind: 'project_file' | 'task' | 'external_doc' | 'runtime_event' | 'user_message' | string
  summary: string
  path?: string
  ref?: string
}

export interface MemoryEventInput {
  scope: MemoryScope
  type: 'task_evidence' | 'decision' | 'progress' | 'user_correction' | 'runtime_event' | string
  summary: string
  body: string
  sourceRefs?: readonly MemorySourceRef[]
  relevanceHints?: readonly string[]
  recordedAt?: string
}

export interface MemoryObservationInput {
  scope: MemoryScope
  summary: string
  body: string
  confidence?: MemoryConfidence
  risk?: MemoryRisk
  freshness?: MemoryFreshness
  sourceRefs?: readonly MemorySourceRef[]
  tags?: readonly string[]
  recordedAt?: string
}

export interface StoredMemoryEvent extends Required<Omit<MemoryEventInput, 'sourceRefs' | 'relevanceHints' | 'recordedAt'>> {
  id: string
  sourceRefs: MemorySourceRef[]
  relevanceHints: string[]
  recordedAt: string
}

export interface StoredMemoryObservation extends Required<Omit<MemoryObservationInput, 'sourceRefs' | 'tags' | 'confidence' | 'risk' | 'freshness' | 'recordedAt'>> {
  id: string
  confidence: MemoryConfidence
  risk: MemoryRisk
  freshness: MemoryFreshness
  sourceRefs: MemorySourceRef[]
  tags: string[]
  recordedAt: string
  compactedFromEventIds: string[]
}

export interface MemoryCompactionInput {
  scope: MemoryScope
  reason: 'background' | 'startup' | 'manual' | string
  maxObservationBytes?: number
}

export interface MemoryCompactionResult {
  scope: MemoryScope
  reason: string
  rawEventsConsidered: number
  observationsCreated: number
  bytesBefore: number
  bytesAfter: number
}

export interface MemoryCandidate {
  id: string
  kind: 'event' | 'observation'
  summary: string
  body: string
  relevance: number
  confidence: MemoryConfidence
  risk: MemoryRisk
  freshness: MemoryFreshness
  sourceRefs: MemorySourceRef[]
  reasonForInclusion: string
}

export interface OmittedMemoryCandidate {
  id: string
  summary: string
  reason: string
}

export interface MemoryCandidatePacketInput {
  scope: MemoryScope
  intent: string
  maxBytes?: number
}

export interface MemoryCandidatePacket {
  scope: MemoryScope
  intent: string
  byteEstimate: number
  included: MemoryCandidate[]
  omitted: OmittedMemoryCandidate[]
  generatedAt: string
}

export interface MemoryAuditInput {
  scope: MemoryScope
}

export interface MemoryAuditResult {
  scope: MemoryScope
  storageDir: string
  totalBytes: number
  fileCount: number
  writesProjectLocalState: boolean
}

export interface GuildhallMemory {
  recordEvent(input: MemoryEventInput): Promise<StoredMemoryEvent>
  recordObservation(input: MemoryObservationInput): Promise<StoredMemoryObservation>
  compact(input: MemoryCompactionInput): Promise<MemoryCompactionResult>
  buildCandidatePacket(input: MemoryCandidatePacketInput): Promise<MemoryCandidatePacket>
  audit(input: MemoryAuditInput): Promise<MemoryAuditResult>
}
