import { z } from 'zod'

export type GuildhallMcpRuntime =
  | { kind: 'host' }
  | { kind: 'proxied'; proxyName: string }

export interface GuildhallMcpContext {
  projectRoot: string
  projectStateDir: string
  localHistoryDir?: string
  runtime: GuildhallMcpRuntime
}

const safeId = /^[A-Za-z0-9_.-]+$/

export const GuildhallArtifactFormat = z.enum(['markdown', 'json'])
export type GuildhallArtifactFormat = z.infer<typeof GuildhallArtifactFormat>

export type ParsedGuildhallUri =
  | { kind: 'project' }
  | { kind: 'tasks' }
  | { kind: 'task'; taskId: string }
  | { kind: 'artifacts' }
  | { kind: 'artifact'; artifactId: string }
  | { kind: 'decisions' }
  | { kind: 'feedback' }
  | { kind: 'design' }
  | { kind: 'memory' }
  | { kind: 'learning' }
  | { kind: 'context' }
  | { kind: 'localHistory' }
  | { kind: 'codebaseKnowledge' }
  | { kind: 'runtime' }
  | { kind: 'capabilityRequests' }
  | { kind: 'externalAgentMemoryBridge' }
  | { kind: 'drivers' }
  | { kind: 'primitives' }
  | { kind: 'taskContext'; taskId: string }
  | { kind: 'taskRelationships'; taskId: string }
  | { kind: 'agentContracts' }
  | { kind: 'validationEvidence' }

export function projectUri(): string {
  return 'guildhall://project'
}

export function taskUri(taskId: string): string {
  assertSafeId(taskId, 'task id')
  return `guildhall://project/tasks/${taskId}`
}

export function artifactUri(artifactId: string): string {
  assertSafeId(artifactId, 'artifact id')
  return `guildhall://project/artifacts/${artifactId}`
}

export function parseGuildhallUri(uri: string): ParsedGuildhallUri {
  if (!uri.startsWith('guildhall://project')) {
    throw new Error(`Unsupported Guildhall MCP URI: ${uri}`)
  }
  const rest = uri.slice('guildhall://project'.length)
  if (rest === '') return { kind: 'project' }
  const parts = rest.split('/').filter(Boolean)
  if (parts.length === 1 && parts[0] === 'tasks') return { kind: 'tasks' }
  if (parts.length === 2 && parts[0] === 'tasks') {
    assertSafeId(parts[1]!, 'task id')
    return { kind: 'task', taskId: parts[1]! }
  }
  if (parts.length === 1 && parts[0] === 'artifacts') return { kind: 'artifacts' }
  if (parts.length === 2 && parts[0] === 'artifacts') {
    assertSafeId(parts[1]!, 'artifact id')
    return { kind: 'artifact', artifactId: parts[1]! }
  }
  if (parts.length === 1 && parts[0] === 'decisions') return { kind: 'decisions' }
  if (parts.length === 1 && parts[0] === 'feedback') return { kind: 'feedback' }
  if (parts.length === 1 && parts[0] === 'design') return { kind: 'design' }
  if (parts.length === 1 && parts[0] === 'memory') return { kind: 'memory' }
  if (parts.length === 1 && parts[0] === 'learning') return { kind: 'learning' }
  if (parts.length === 1 && parts[0] === 'context') return { kind: 'context' }
  if (parts.length === 1 && parts[0] === 'local-history') return { kind: 'localHistory' }
  if (parts.length === 1 && parts[0] === 'codebase-knowledge') return { kind: 'codebaseKnowledge' }
  if (parts.length === 1 && parts[0] === 'runtime') return { kind: 'runtime' }
  if (parts.length === 1 && parts[0] === 'capability-requests') {
    return { kind: 'capabilityRequests' }
  }
  if (parts.length === 1 && parts[0] === 'external-agent-memory-bridge') {
    return { kind: 'externalAgentMemoryBridge' }
  }
  if (parts.length === 1 && parts[0] === 'drivers') return { kind: 'drivers' }
  if (parts.length === 1 && parts[0] === 'primitives') return { kind: 'primitives' }
  if (parts.length === 2 && parts[0] === 'task-context') {
    assertSafeId(parts[1]!, 'task id')
    return { kind: 'taskContext', taskId: parts[1]! }
  }
  if (parts.length === 2 && parts[0] === 'task-relationships') {
    assertSafeId(parts[1]!, 'task id')
    return { kind: 'taskRelationships', taskId: parts[1]! }
  }
  if (parts.length === 1 && parts[0] === 'agent-contracts') return { kind: 'agentContracts' }
  if (parts.length === 1 && parts[0] === 'validation-evidence') return { kind: 'validationEvidence' }
  throw new Error(`Invalid Guildhall MCP URI: ${uri}`)
}

function assertSafeId(value: string, label: string): void {
  if (!safeId.test(value)) throw new Error(`Invalid ${label}: ${value}`)
}
