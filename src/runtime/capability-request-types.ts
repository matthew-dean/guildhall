import { z } from 'zod'

export const CapabilityMount = z.object({
  hostPath: z.string(),
  containerPath: z.string(),
  access: z.enum(['read-only', 'read-write']),
})
export type CapabilityMount = z.infer<typeof CapabilityMount>

export const CapabilityGrant = z.object({
  id: z.string(),
  kind: z.literal('mount_directory'),
  hostPath: z.string(),
  containerPath: z.string(),
  access: z.enum(['read-only', 'read-write']),
  duration: z.string(),
  status: z.enum(['active', 'revoked']),
  evidence: z.string(),
  grantedAt: z.string(),
  grantedBy: z.string(),
  revokedAt: z.string().optional(),
  revokedBy: z.string().optional(),
  revokeReason: z.string().optional(),
})
export type CapabilityGrant = z.infer<typeof CapabilityGrant>

export const CapabilityRequestStatus = z.enum(['pending', 'approved', 'denied', 'blocked', 'revoked'])
export type CapabilityRequestStatus = z.infer<typeof CapabilityRequestStatus>

export const CapabilityRequestTransitionEvent = z.enum(['approve', 'deny', 'block', 'revoke'])
export type CapabilityRequestTransitionEvent = z.infer<typeof CapabilityRequestTransitionEvent>

export const CapabilityRequestTransitionReceipt = z.object({
  machineId: z.literal('capability-request'),
  machineVersion: z.number(),
  commandId: z.string().optional(),
  entityId: z.string(),
  from: CapabilityRequestStatus,
  event: CapabilityRequestTransitionEvent,
  to: CapabilityRequestStatus,
  actor: z.string(),
  evidenceRefs: z.array(z.string()),
  createdAt: z.string(),
})
export type CapabilityRequestTransitionReceipt = z.infer<typeof CapabilityRequestTransitionReceipt>

export const CapabilityRequest = z.object({
  id: z.string(),
  taskId: z.string(),
  kind: z.literal('mount_directory'),
  requestedBy: z.string(),
  reason: z.string(),
  duration: z.string().default('this task'),
  fallback: z.string().optional(),
  mount: CapabilityMount,
  status: CapabilityRequestStatus,
  requestedAt: z.string(),
  decidedAt: z.string().optional(),
  decidedBy: z.string().optional(),
  blockedReason: z.string().optional(),
  grant: CapabilityGrant.optional(),
  transitionReceipts: z.array(CapabilityRequestTransitionReceipt).default([]),
})
export type CapabilityRequest = z.infer<typeof CapabilityRequest>
