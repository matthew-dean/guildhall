import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { atomicWriteText } from '@guildhall/sessions'
import { applyCapabilityRequestTransition } from './capability-request-machine.js'

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

export async function createCapabilityRequest(input: {
  memoryDir: string
  taskId: string
  kind: 'mount_directory'
  requestedBy: string
  reason: string
  duration?: string
  fallback?: string
  mount: CapabilityMount
}): Promise<CapabilityRequest> {
  const now = new Date().toISOString()
  const request: CapabilityRequest = {
    id: `cap-${slugify(input.taskId)}-${Date.now().toString(36)}`,
    taskId: input.taskId,
    kind: input.kind,
    requestedBy: input.requestedBy,
    reason: input.reason,
    duration: input.duration ?? 'this task',
    fallback: input.fallback,
    mount: input.mount,
    status: 'pending',
    requestedAt: now,
    transitionReceipts: [],
  }
  await saveCapabilityRequest(input.memoryDir, request)
  return request
}

export async function approveCapabilityRequest(input: {
  memoryDir: string
  requestId: string
  approvedBy: string
}): Promise<CapabilityRequest> {
  const request = listCapabilityRequests(input.memoryDir).find(candidate => candidate.id === input.requestId)
  if (!request) throw new Error(`Capability request ${input.requestId} not found`)
  const now = new Date().toISOString()
  const receipt = applyCapabilityRequestTransition({
    request,
    event: 'approve',
    actor: input.approvedBy,
    evidenceRefs: [`capability-request:${request.id}`],
    now,
  })
  request.status = receipt.to
  request.transitionReceipts.push(receipt)
  request.decidedBy = input.approvedBy
  request.decidedAt = now
  const grantId = `grant-${request.id.replace(/^cap-/, '')}`
  request.grant = {
    id: grantId,
    kind: 'mount_directory',
    hostPath: request.mount.hostPath,
    containerPath: `/mnt/guildhall-grants/${grantId}`,
    access: request.mount.access,
    duration: request.duration,
    status: 'active',
    evidence: `Granted ${request.mount.access} mount from ${request.mount.hostPath} to /mnt/guildhall-grants/${grantId}.`,
    grantedAt: now,
    grantedBy: input.approvedBy,
  }
  await saveCapabilityRequest(input.memoryDir, request)
  return request
}

export function listCapabilityRequests(memoryDir: string): CapabilityRequest[] {
  const dir = capabilityDir(memoryDir)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .flatMap((file) => {
      try {
        return [CapabilityRequest.parse(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')))]
      } catch {
        return []
      }
    })
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
}

export async function saveCapabilityRequest(memoryDir: string, request: CapabilityRequest): Promise<void> {
  const filePath = path.join(capabilityDir(memoryDir), `${request.id}.json`)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  atomicWriteText(filePath, JSON.stringify(request, null, 2) + '\n')
}

function capabilityDir(memoryDir: string): string {
  return path.join(memoryDir, 'capability-requests')
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'request'
}
