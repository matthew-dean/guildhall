import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { atomicWriteText } from '@guildhall/sessions'

const Mount = z.object({
  hostPath: z.string(),
  containerPath: z.string(),
  access: z.enum(['read-only', 'read-write']),
})

export const CapabilityRequest = z.object({
  id: z.string(),
  taskId: z.string(),
  kind: z.literal('mount_directory'),
  requestedBy: z.string(),
  reason: z.string(),
  mount: Mount,
  status: z.enum(['pending', 'approved', 'denied']),
  requestedAt: z.string(),
  decidedAt: z.string().optional(),
  decidedBy: z.string().optional(),
  grant: z.object({
    kind: z.literal('mount_directory'),
    hostPath: z.string(),
    containerPath: z.string(),
    access: z.enum(['read-only', 'read-write']),
    evidence: z.string(),
  }).optional(),
})
export type CapabilityRequest = z.infer<typeof CapabilityRequest>

export async function createCapabilityRequest(input: {
  memoryDir: string
  taskId: string
  kind: 'mount_directory'
  requestedBy: string
  reason: string
  mount: z.infer<typeof Mount>
}): Promise<CapabilityRequest> {
  const now = new Date().toISOString()
  const request: CapabilityRequest = {
    id: `cap-${slugify(input.taskId)}-${Date.now().toString(36)}`,
    taskId: input.taskId,
    kind: input.kind,
    requestedBy: input.requestedBy,
    reason: input.reason,
    mount: input.mount,
    status: 'pending',
    requestedAt: now,
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
  request.status = 'approved'
  request.decidedBy = input.approvedBy
  request.decidedAt = new Date().toISOString()
  request.grant = {
    kind: 'mount_directory',
    hostPath: request.mount.hostPath,
    containerPath: request.mount.containerPath,
    access: request.mount.access,
    evidence: `Granted ${request.mount.access} mount from ${request.mount.hostPath} to ${request.mount.containerPath}.`,
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

async function saveCapabilityRequest(memoryDir: string, request: CapabilityRequest): Promise<void> {
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
