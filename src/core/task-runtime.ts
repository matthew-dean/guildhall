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
  handoffStep: z.number().int().nonnegative().optional(),
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
