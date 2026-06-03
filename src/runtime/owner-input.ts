import { z } from 'zod'

export const OwnerInputRequestStatus = z.enum([
  'waiting_for_owner',
  'coordinator_review',
  'fulfilled',
  'blocked',
  'cancelled',
])
export type OwnerInputRequestStatus = z.infer<typeof OwnerInputRequestStatus>

export const OwnerInputSource = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('task'),
    taskId: z.string(),
    questionId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('structural_map'),
    mapId: z.string(),
    questionId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('project_graph'),
    edgeId: z.string().optional(),
    nodeId: z.string().optional(),
    questionId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('capability_request'),
    requestId: z.string(),
    questionId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('request_intake'),
    intakeId: z.string(),
    questionId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('project_check_in'),
    checkInId: z.string().optional(),
    questionId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('recovery_decision'),
    taskId: z.string().optional(),
    escalationId: z.string().optional(),
    questionId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('settings'),
    settingId: z.string().optional(),
    questionId: z.string().optional(),
  }),
])
export type OwnerInputSource = z.infer<typeof OwnerInputSource>

export const OwnerInputTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('thread') }),
  z.object({ kind: z.literal('project_structure'), href: z.string() }),
  z.object({ kind: z.literal('work_item'), taskId: z.string() }),
  z.object({ kind: z.literal('task'), taskId: z.string() }),
  z.object({ kind: z.literal('structure'), href: z.string().optional() }),
  z.object({ kind: z.literal('settings'), href: z.string().optional() }),
])
export type OwnerInputTarget = z.infer<typeof OwnerInputTarget>

export const OwnerInputObjective = z.object({
  kind: z.enum([
    'project_intake',
    'project_check_in',
    'new_request',
    'task_shaping',
    'structural_review',
    'setting_update',
    'recovery_decision',
    'capability_decision',
  ]),
  label: z.string(),
  successCriteria: z.array(z.string()).default([]),
})
export type OwnerInputObjective = z.infer<typeof OwnerInputObjective>

const OwnerInputReceipt = z.object({
  machineId: z.string(),
  machineVersion: z.number().int().positive(),
  commandId: z.string().optional(),
  entityId: z.string(),
  from: OwnerInputRequestStatus,
  event: z.string(),
  to: OwnerInputRequestStatus,
  actor: z.string(),
  evidenceRefs: z.array(z.string()).default([]),
  createdAt: z.string(),
})

export const OwnerInputRequest = z.object({
  id: z.string(),
  projectId: z.string(),
  source: OwnerInputSource,
  sourceKey: z.string(),
  target: OwnerInputTarget,
  prompt: z.string(),
  choices: z.array(z.string()).optional(),
  objective: OwnerInputObjective,
  status: OwnerInputRequestStatus,
  boundedChatSessionId: z.string(),
  commandIds: z.array(z.string()).default([]),
  receipts: z.array(OwnerInputReceipt).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
})
export type OwnerInputRequest = z.infer<typeof OwnerInputRequest>

export function ownerInputSourceKey(source: OwnerInputSource): string {
  switch (source.kind) {
    case 'task':
      return joinKey(source.kind, source.taskId, source.questionId)
    case 'structural_map':
      return joinKey(source.kind, source.mapId, source.questionId)
    case 'project_graph':
      return joinKey(source.kind, source.edgeId ?? source.nodeId ?? 'project', source.questionId)
    case 'capability_request':
      return joinKey(source.kind, source.requestId, source.questionId)
    case 'request_intake':
      return joinKey(source.kind, source.intakeId, source.questionId)
    case 'project_check_in':
      return joinKey(source.kind, source.checkInId ?? 'project', source.questionId)
    case 'recovery_decision':
      return joinKey(source.kind, source.taskId ?? source.escalationId ?? 'recovery', source.questionId)
    case 'settings':
      return joinKey(source.kind, source.settingId ?? 'settings', source.questionId)
  }
}

function joinKey(...parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .map(part => part.trim().replace(/\s+/g, '-').toLowerCase())
    .join(':')
}
