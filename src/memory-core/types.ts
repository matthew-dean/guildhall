export type GuildhallMemoryScope =
  | {
      kind: 'task_thread'
      projectId: string
      taskId: string
      agentRole: 'spec' | 'coordinator' | 'worker' | 'reviewer' | 'gateChecker' | 'contextIndexer'
      threadId: string
      runId?: string
    }
  | {
      kind: 'project'
      projectId: string
    }
  | {
      kind: 'user_global'
      userId: string
    }

export type MemorySourceKind =
  | 'task'
  | 'progress'
  | 'review'
  | 'gate'
  | 'tool'
  | 'thread'
  | 'artifact'
  | 'external_agent'
  | 'generated_map'

export interface MemorySourceRef {
  id: string
  sourceKind: MemorySourceKind
  uri: string
  path?: string
  lineStart?: number
  lineEnd?: number
  byteStart?: number
  byteEnd?: number
  hash?: string
  capturedAt: string
}

export interface RecordMemoryEventInput {
  scope: GuildhallMemoryScope
  source: {
    kind: MemorySourceKind
    ref: string
    path?: string
    hash?: string
    capturedAt: string
  }
  content: {
    text?: string
    json?: unknown
    summary: string
  }
  metadata: {
    projectId?: string
    taskId?: string
    agentRole?: string
    status?: string
    risk?: 'low' | 'medium' | 'high'
    retention?: 'ephemeral' | 'debug' | 'task_lifecycle' | 'durable_memory'
  }
}

/**
 * Durable memory is intentionally smaller than the write-time event input.
 * Raw text/json belongs to the live operation or an explicitly retained
 * evidence artifact, not to the ordinary memory stream.
 */
export interface MemoryEvent {
  schemaVersion: 2
  scope: GuildhallMemoryScope
  source: RecordMemoryEventInput['source']
  content: {
    summary: string
  }
  metadata: RecordMemoryEventInput['metadata']
  id: string
  recordedAt: string
  sourceRefs: MemorySourceRef[]
}

export interface MemoryWriteResult {
  id: string
  storagePath: string
  repoLocalWrites: string[]
}

export interface MemoryPaths {
  projectRoot: string
  memoryDir: string
  dbPath: string
  eventsPath: string
  auditDir: string
}

export interface MemoryCandidate {
  id: string
  kind: 'event' | 'observation' | 'reflection' | 'working_memory' | 'semantic_recall' | 'deterministic_summary'
  summary: string
  relevance: 'high' | 'medium' | 'low'
  confidence: 'high' | 'medium' | 'low'
  freshness: 'current' | 'possibly_stale' | 'stale'
  sourceRefs: MemorySourceRef[]
  reasonForInclusion: string
  risks: string[]
}

export interface MemoryCandidatePacket {
  scope: GuildhallMemoryScope
  purpose: 'next_worker_context' | 'review_context' | 'gate_context' | 'owner_answer' | 'cleanup_audit' | 'handoff'
  generatedAt: string
  byteEstimate: number
  candidates: MemoryCandidate[]
  omitted: Array<{
    reason: 'too_large' | 'low_relevance' | 'stale' | 'wrong_scope' | 'unsafe' | 'duplicate'
    summary: string
    sourceRefs: MemorySourceRef[]
  }>
  health: {
    adapter: 'mastra' | 'deterministic'
    fallbackUsed: boolean
    warnings: string[]
    storagePath?: string
    repoLocalWrites?: string[]
    features?: string[]
    semanticRecallEnabled?: boolean
    observationalMemoryEnabled?: boolean
    observationalProcessorReady?: boolean
    compactionStatus?: 'active' | 'needs_attention'
    semanticValidity?: 'valid' | 'needs_attention'
  }
}

export interface MastraScopeIds {
  resourceId: string
  threadId: string
}

export interface MastraMemoryCoreHealth {
  adapter: 'mastra'
  storagePath: string
  repoLocalWrites: string[]
  features: string[]
  scope: MastraScopeIds
  packages: Record<string, string>
  warnings: string[]
  semanticRecallEnabled: boolean
  observationalMemoryEnabled: boolean
  observationalProcessorReady: boolean
}

export interface MastraMemoryCoreAdapter {
  health: MastraMemoryCoreHealth
  memory: unknown
  storage: unknown
  close: () => Promise<void>
}

export interface MemoryAuditReport {
  generatedAt: string
  storagePath: string
  repoLocalWrites: string[]
  warnings: string[]
  files?: MemoryProjectFileAudit[]
  bytesBefore?: number
  bytesAfter?: number
  eventsWritten?: number
}

export interface MemoryAuditReportRef {
  path: string
  repoLocalWrites: string[]
}

export interface MemoryProjectFileAudit {
  relativePath: string
  kind: 'task_queue' | 'progress_log' | 'memory_file' | 'generated_map' | 'other'
  bytes: number
  hash: string
  summary: string
  taskCount?: number
  progressBlocks?: number
}

export interface ProjectMemoryAuditResult {
  projectRoot: string
  stateDir: string
  memoryDir: string
  dryRun: boolean
  files: MemoryProjectFileAudit[]
  bytesBefore: number
  bytesAfter: number
  eventsWritten: number
  repoLocalWrites: string[]
  auditReportPath: string | null
}
