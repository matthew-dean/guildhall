import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText } from '@guildhall/sessions'
import { applyCapabilityRequestTransition } from './capability-request-machine.js'
import {
  CapabilityRequest,
  type CapabilityMount,
  type CapabilityRequest as CapabilityRequestRecord,
} from './capability-request-types.js'

export {
  CapabilityGrant,
  CapabilityMount,
  CapabilityRequest,
  CapabilityRequestStatus,
  CapabilityRequestTransitionEvent,
  CapabilityRequestTransitionReceipt,
} from './capability-request-types.js'
export type {
  CapabilityGrant as CapabilityGrantType,
  CapabilityMount as CapabilityMountType,
  CapabilityRequest as CapabilityRequestType,
  CapabilityRequestStatus as CapabilityRequestStatusType,
  CapabilityRequestTransitionEvent as CapabilityRequestTransitionEventType,
  CapabilityRequestTransitionReceipt as CapabilityRequestTransitionReceiptType,
} from './capability-request-types.js'

export async function createCapabilityRequest(input: {
  memoryDir: string
  taskId: string
  kind: 'mount_directory'
  requestedBy: string
  reason: string
  duration?: string
  fallback?: string
  mount: CapabilityMount
}): Promise<CapabilityRequestRecord> {
  const now = new Date().toISOString()
  const request: CapabilityRequestRecord = {
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
}): Promise<CapabilityRequestRecord> {
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

export function listCapabilityRequests(memoryDir: string): CapabilityRequestRecord[] {
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

export async function saveCapabilityRequest(memoryDir: string, request: CapabilityRequestRecord): Promise<void> {
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
