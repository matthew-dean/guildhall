import { appendTaskEvidence } from '@guildhall/sessions'
import { FileBackedGuildhallPersistence } from '@guildhall/persistence'

import {
  type CapabilityGrant,
  type CapabilityMount,
  type CapabilityRequest,
  listCapabilityRequests,
  saveCapabilityRequest,
} from './capability-requests.js'

export interface CapabilityDecisionInput {
  memoryDir: string
  projectRoot?: string
  requestId: string
}

export async function approveMountDirectoryRequest(input: CapabilityDecisionInput & {
  approvedBy: string
  hostPath?: string
  access?: CapabilityMount['access']
  duration?: string
}): Promise<CapabilityRequest> {
  const request = findRequest(input.memoryDir, input.requestId)
  const now = new Date().toISOString()
  const grantId = `grant-${request.id.replace(/^cap-/, '')}`
  const hostPath = input.hostPath ?? request.mount.hostPath
  const access = input.access ?? request.mount.access
  const duration = input.duration ?? request.duration
  const containerPath = `/mnt/guildhall-grants/${grantId}`
  request.status = 'approved'
  request.decidedAt = now
  request.decidedBy = input.approvedBy
  request.duration = duration
  request.grant = {
    id: grantId,
    kind: 'mount_directory',
    hostPath,
    containerPath,
    access,
    duration,
    status: 'active',
    evidence: `Granted ${access} mount from ${hostPath} to ${containerPath}.`,
    grantedAt: now,
    grantedBy: input.approvedBy,
  }
  await saveCapabilityRequest(input.memoryDir, request)
  await recordCapabilityEvidence(input.projectRoot, request, request.grant.evidence)
  return request
}

export async function denyCapabilityRequest(input: CapabilityDecisionInput & {
  deniedBy: string
  fallback?: string
}): Promise<CapabilityRequest> {
  const request = findRequest(input.memoryDir, input.requestId)
  const now = new Date().toISOString()
  request.status = 'denied'
  request.decidedAt = now
  request.decidedBy = input.deniedBy
  request.fallback = input.fallback ?? request.fallback
  await saveCapabilityRequest(input.memoryDir, request)
  await recordCapabilityEvidence(
    input.projectRoot,
    request,
    `Denied ${request.mount.access} mount for ${request.mount.hostPath}.${request.fallback ? ` Fallback: ${request.fallback}` : ''}`,
  )
  return request
}

export async function markCapabilityRequestBlocked(input: CapabilityDecisionInput & {
  blockedBy: string
  reason: string
}): Promise<CapabilityRequest> {
  const request = findRequest(input.memoryDir, input.requestId)
  const now = new Date().toISOString()
  request.status = 'blocked'
  request.decidedAt = now
  request.decidedBy = input.blockedBy
  request.blockedReason = input.reason
  await saveCapabilityRequest(input.memoryDir, request)
  await recordCapabilityEvidence(
    input.projectRoot,
    request,
    `Marked capability request blocked for ${request.mount.hostPath}. ${input.reason}`,
  )
  return request
}

export async function revokeCapabilityGrant(input: CapabilityDecisionInput & {
  revokedBy: string
  reason?: string
}): Promise<CapabilityRequest> {
  const request = findRequest(input.memoryDir, input.requestId)
  if (!request.grant) throw new Error(`Capability request ${input.requestId} has no grant to revoke`)
  const now = new Date().toISOString()
  request.status = 'revoked'
  request.grant.status = 'revoked'
  request.grant.revokedAt = now
  request.grant.revokedBy = input.revokedBy
  request.grant.revokeReason = input.reason
  await saveCapabilityRequest(input.memoryDir, request)
  await recordCapabilityEvidence(
    input.projectRoot,
    request,
    `Revoked ${request.grant.access} mount ${request.grant.containerPath}.${input.reason ? ` ${input.reason}` : ''}`,
  )
  return request
}

export function listActiveCapabilityGrants(memoryDir: string): CapabilityGrant[] {
  return listCapabilityRequests(memoryDir)
    .map(request => request.grant)
    .filter((grant): grant is CapabilityGrant => Boolean(grant && grant.status === 'active'))
}

export function capabilityGrantMounts(memoryDir: string): CapabilityMount[] {
  return listActiveCapabilityGrants(memoryDir).map(grant => ({
    hostPath: grant.hostPath,
    containerPath: grant.containerPath,
    access: grant.access,
  }))
}

function findRequest(memoryDir: string, requestId: string): CapabilityRequest {
  const request = listCapabilityRequests(memoryDir).find(candidate => candidate.id === requestId)
  if (!request) throw new Error(`Capability request ${requestId} not found`)
  return request
}

async function recordCapabilityEvidence(
  projectRoot: string | undefined,
  request: CapabilityRequest,
  content: string,
): Promise<void> {
  if (!projectRoot) return
  const now = new Date().toISOString()
  const persistence = new FileBackedGuildhallPersistence()
  await persistence.appendEvent({
    projectRoot,
    placement: {
      scope: 'local_history',
      retention: 'active',
      visibility: 'internal_audit',
      commitPolicy: 'ignored',
    },
    collection: 'capability-grant-evidence',
    streamId: request.taskId,
    eventId: `${request.id}-${request.status}`,
    schemaName: 'capability-grant-evidence',
    schemaVersion: 1,
    createdBy: 'capability-broker',
    sourceRefs: [`task:${request.taskId}`, `capability-request:${request.id}`],
    payload: {
      capabilityRequestId: request.id,
      taskId: request.taskId,
      status: request.status,
      content,
      grant: request.grant ?? null,
      recordedAt: now,
    },
    now: () => new Date(now),
  })
  await appendTaskEvidence(projectRoot, request.taskId, {
    id: `${request.taskId}-capability-${request.id}-${now.replace(/[^0-9A-Za-z]/g, '')}`,
    kind: 'note',
    recordedAt: now,
    payload: {
      agentId: 'capability-broker',
      role: 'capability',
      content,
      capabilityRequestId: request.id,
      timestamp: now,
    },
  })
}
