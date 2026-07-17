import { z } from 'zod'

export const TaskRuntimeState = z.object({
  taskId: z.string(),
  assignedTo: z.string().nullable().optional(),
  revisionCount: z.number().int().nonnegative().optional(),
  retryWindow: z.object({
    startedAt: z.string(),
    baseRevisionCount: z.number().int().nonnegative(),
  }).optional(),
  proofRecovery: z.object({
    reopenedAt: z.string(),
    reason: z.string().optional(),
  }).optional(),
  remediationAttempts: z.number().int().nonnegative().optional(),
  // Current worker recovery state belongs in the normalized runtime overlay,
  // not in bounded note projections. These counters survive orchestrator
  // restarts without turning operational notes into an unbounded ledger.
  workerRecovery: z.object({
    noProgressAttempts: z.number().int().nonnegative().optional(),
    dirtyTimeoutRetries: z.number().int().nonnegative().optional(),
    likelyTargetTimeoutRetries: z.number().int().nonnegative().optional(),
    noVisibleProgressTimeoutRetries: z.number().int().nonnegative().optional(),
  }).optional(),
  handoffStep: z.number().int().nonnegative().optional(),
  // Shelving is a lifecycle decision, not task definition content. Keep the
  // small current decision here so promoted tasks can still be resumed or
  // policy-processed without rehydrating a legacy aggregate payload.
  shelveReason: z.object({
    code: z.string(),
    detail: z.string(),
    rejectedBy: z.string(),
    rejectedAt: z.string(),
    source: z.enum(['worker_pre_rejection', 'proposal_policy']).optional(),
    policyApplied: z.boolean().optional(),
    requeueCount: z.number().int().nonnegative().optional(),
  }).optional(),
  openEscalationIds: z.array(z.string()).optional(),
  openIssueIds: z.array(z.string()).optional(),
  updatedAt: z.string(),
})
export type TaskRuntimeState = z.infer<typeof TaskRuntimeState>

export const TaskRuntimeStateStore = z.object({
  version: z.number().int().positive().default(1),
  lastUpdated: z.string(),
  tasks: z.record(z.string(), TaskRuntimeState).default({}),
})
export type TaskRuntimeStateStore = z.infer<typeof TaskRuntimeStateStore>

export const TaskWorkspaceState = z.object({
  taskId: z.string(),
  worktreePath: z.string().optional(),
  branchName: z.string().optional(),
  baseBranch: z.string().optional(),
  mode: z.enum(['none', 'per_task', 'per_attempt']).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string(),
})
export type TaskWorkspaceState = z.infer<typeof TaskWorkspaceState>

export const TaskWorkspaceStateStore = z.object({
  version: z.number().int().positive().default(1),
  lastUpdated: z.string(),
  workspaces: z.record(z.string(), TaskWorkspaceState).default({}),
})
export type TaskWorkspaceStateStore = z.infer<typeof TaskWorkspaceStateStore>

export const TaskEvidenceKind = z.enum([
  'event',
  'note',
  'gate_result',
  'review_verdict',
  'adjudication',
  'escalation',
  'agent_issue',
  'merge_record',
  'git_story',
])
export type TaskEvidenceKind = z.infer<typeof TaskEvidenceKind>

export const TaskEvidenceEvent = z.object({
  id: z.string(),
  taskId: z.string(),
  kind: TaskEvidenceKind,
  recordedAt: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
})
export type TaskEvidenceEvent = z.infer<typeof TaskEvidenceEvent>

/**
 * Durable task evidence is an essential history, not a command transcript.
 * Keep the policy in core so JSONL, SQLite, and future adapters cannot each
 * invent a different definition of "compact".
 */
export const TASK_EVIDENCE_PAYLOAD_MAX_BYTES = 12 * 1024
export const TASK_EVIDENCE_TEXT_LIMITS = {
  output: 2_048,
  content: 1_600,
  reasoning: 2_000,
  reason: 1_024,
  llmError: 1_024,
  default: 1_024,
} as const

function evidenceTextLimit(key: string): number {
  return TASK_EVIDENCE_TEXT_LIMITS[key as keyof typeof TASK_EVIDENCE_TEXT_LIMITS]
    ?? TASK_EVIDENCE_TEXT_LIMITS.default
}

function boundedEvidenceText(value: string, limit: number): string {
  if (value.length <= limit) return value
  const marker = '\n... [durable evidence excerpt bounded; raw diagnostic text is not retained] ...\n'
  const available = Math.max(0, limit - marker.length)
  const head = Math.ceil(available * 0.72)
  const tail = Math.max(0, available - head)
  return `${value.slice(0, head)}${marker}${tail > 0 ? value.slice(-tail) : ''}`
}

function compactEvidenceValue(value: unknown, key: string, depth: number): unknown {
  if (typeof value === 'string') return boundedEvidenceText(value, evidenceTextLimit(key))
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (depth >= 4) return typeof value === 'object' ? '[nested evidence omitted]' : value
  if (Array.isArray(value)) {
    return value.slice(0, 32).map(item => compactEvidenceValue(item, key, depth + 1))
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 64)
        .map(([childKey, childValue]) => [
          childKey,
          compactEvidenceValue(childValue, childKey, depth + 1),
        ]),
    )
  }
  return undefined
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

/** Return the bounded payload that is allowed into durable project state. */
export function compactTaskEvidencePayload(
  kind: TaskEvidenceKind,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const compact = Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      compactEvidenceValue(value, key, 0),
    ]),
  )
  if (serializedBytes(compact) <= TASK_EVIDENCE_PAYLOAD_MAX_BYTES) return compact

  // A malformed or unusually nested producer must not bypass the budget.
  // Keep the fields needed to identify and interpret the result, and make the
  // loss explicit in the stored payload.
  const emergency = Object.fromEntries(
    Object.entries(compact).map(([key, value]) => [
      key,
      typeof value === 'string'
        ? boundedEvidenceText(value, 512)
        : Array.isArray(value)
          ? value.slice(0, 8)
          : value,
    ]),
  )
  if (serializedBytes(emergency) <= TASK_EVIDENCE_PAYLOAD_MAX_BYTES) return emergency
  return {
    ...Object.fromEntries(Object.entries(emergency).filter(([key]) => (
      key === 'id' || key === 'taskId' || key === 'kind' || key === 'gateId' ||
      key === 'verdict' || key === 'passed' || key === 'checkedAt' || key === 'recordedAt'
    ))),
    compacted: true,
    compactedKind: kind,
  }
}

/** Compact an event at the single durable-write boundary. */
export function compactTaskEvidenceEvent(event: TaskEvidenceEvent): TaskEvidenceEvent {
  return {
    ...event,
    payload: compactTaskEvidencePayload(event.kind, event.payload),
  }
}
