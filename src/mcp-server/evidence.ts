import { readManagedTextFile, writeManagedTextFileSync } from '@guildhall/persistence'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  appendTaskEvidence as appendStoredTaskEvidence,
  getProjectSystemStatePathFromMemoryDir,
  readProjectStateDatabaseCurrentAuthority,
} from '@guildhall/sessions'
import {
  createCapabilityRequest,
  listCapabilityRequests,
  type CapabilityRequest,
} from '@guildhall/runtime'

import type { GuildhallMcpContext } from './types.js'

export interface AppendTaskEvidenceInput {
  taskId: string
  summary: string
  source: string
}

export async function appendTaskEvidence(
  ctx: GuildhallMcpContext,
  input: AppendTaskEvidenceInput,
): Promise<string> {
  const now = new Date().toISOString()
  if (readProjectStateDatabaseCurrentAuthority(ctx.projectRoot) !== 'database') {
    const progressPath = getProjectSystemStatePathFromMemoryDir(ctx.projectStateDir, 'PROGRESS.md')
    const existing = await readOptional(progressPath, '# Progress\n')
    const entry = [
      '',
      `## ${now} MCP evidence for ${input.taskId}`,
      '',
      input.summary.trim(),
      '',
      `source: ${input.source.trim()}`,
      '',
    ].join('\n')
    await fsp.mkdir(path.dirname(progressPath), { recursive: true })
    writeManagedTextFileSync(progressPath, existing.trimEnd() + entry)
  }
  await appendStoredTaskEvidence(ctx.projectRoot, input.taskId, {
    id: `${input.taskId}-mcp-evidence-${now.replace(/[^0-9A-Za-z]/g, '')}`,
    kind: 'note',
    recordedAt: now,
    payload: {
      agentId: 'mcp',
      role: 'evidence',
      content: input.summary.trim(),
      source: input.source.trim(),
      timestamp: now,
    },
  })
  return `Recorded MCP evidence for ${input.taskId}`
}

export async function createMcpCapabilityRequest(
  ctx: GuildhallMcpContext,
  input: {
    taskId: string
    requestedBy: string
    reason: string
    hostPath: string
    access: 'read-only' | 'read-write'
  },
): Promise<CapabilityRequest> {
  return createCapabilityRequest({
    memoryDir: ctx.projectStateDir,
    taskId: input.taskId,
    kind: 'mount_directory',
    requestedBy: input.requestedBy,
    reason: input.reason,
    mount: {
      hostPath: input.hostPath,
      containerPath: `/mnt/guildhall-grants/${sanitizeMountName(input.hostPath)}`,
      access: input.access,
    },
  })
}

export async function listMcpCapabilityRequests(ctx: GuildhallMcpContext): Promise<string> {
  const requests = listCapabilityRequests(ctx.projectStateDir)
  if (requests.length === 0) return '# Capability Requests\n\nNo capability requests.\n'
  return [
    '# Capability Requests',
    '',
    ...requests.map((request) => {
      const grant = request.grant
        ? ` Grant: ${request.grant.status} ${request.grant.access} ${request.grant.hostPath} -> ${request.grant.containerPath}.`
        : ''
      const fallback = request.fallback ? ` Fallback: ${request.fallback}` : ''
      return `- ${request.id}: ${request.status} ${request.mount.access} ${request.mount.hostPath} for ${request.taskId}. ${request.reason}${fallback}${grant}`
    }),
    '',
  ].join('\n')
}

async function readOptional(filePath: string, fallback: string): Promise<string> {
  try {
    return await readManagedTextFile(filePath, 'utf8')
  } catch {
    return fallback
  }
}

function sanitizeMountName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mount'
}
