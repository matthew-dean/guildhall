import fsp from 'node:fs/promises'
import path from 'node:path'
import { load as yamlLoad } from 'js-yaml'

import {
  artifactUri,
  parseGuildhallUri,
  projectUri,
  taskUri,
  type GuildhallMcpContext,
} from './types.js'

export interface GuildhallMcpResource {
  uri: string
  name: string
  description: string
  mimeType: 'text/markdown'
}

export async function buildGuildhallResourceIndex(
  ctx: GuildhallMcpContext,
): Promise<GuildhallMcpResource[]> {
  const tasks = await readTasks(ctx.projectStateDir)
  const artifacts = await readArtifactRegistry(ctx.projectRoot, ctx.projectStateDir)
  return [
    {
      uri: projectUri(),
      name: 'Guildhall project',
      description: 'Compact project context.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'guildhall://project/tasks',
      name: 'Guildhall tasks',
      description: 'Active task queue summary.',
      mimeType: 'text/markdown',
    },
    ...tasks.map((task) => ({
      uri: taskUri(task.id),
      name: task.title || task.id,
      description: `Task ${task.id} (${task.status || 'unknown'})`,
      mimeType: 'text/markdown' as const,
    })),
    {
      uri: 'guildhall://project/artifacts',
      name: 'Guildhall artifacts',
      description: 'Registered artifact IDs.',
      mimeType: 'text/markdown',
    },
    ...artifacts.map((artifact) => ({
      uri: artifactUri(artifact.id),
      name: artifact.id,
      description: artifact.description || artifact.path,
      mimeType: 'text/markdown' as const,
    })),
    {
      uri: 'guildhall://project/decisions',
      name: 'Guildhall decisions',
      description: 'Committed decision log.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'guildhall://project/memory',
      name: 'Guildhall memory',
      description: 'Committed compact project memory.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'guildhall://project/capability-requests',
      name: 'Capability requests',
      description: 'Current capability request state.',
      mimeType: 'text/markdown',
    },
  ]
}

export async function readGuildhallResource(
  ctx: GuildhallMcpContext,
  uri: string,
): Promise<string> {
  const parsed = parseGuildhallUri(uri)
  if (parsed.kind === 'project') return renderProject(ctx)
  if (parsed.kind === 'tasks') return renderTasks(ctx)
  if (parsed.kind === 'task') return renderTask(ctx, parsed.taskId)
  if (parsed.kind === 'artifacts') return renderArtifacts(ctx)
  if (parsed.kind === 'artifact') return renderArtifact(ctx, parsed.artifactId)
  if (parsed.kind === 'decisions') {
    return readOptional(
      path.join(ctx.projectStateDir, 'DECISIONS.md'),
      '# Decisions\n\nNo decisions recorded.\n',
    )
  }
  if (parsed.kind === 'memory') {
    return readOptional(
      path.join(ctx.projectStateDir, 'MEMORY.md'),
      '# Memory\n\nNo compact memory recorded.\n',
    )
  }
  if (parsed.kind === 'capabilityRequests') {
    return '# Capability Requests\n\nNo capability requests recorded in this first slice.\n'
  }
  return '# Unknown\n'
}

async function renderProject(ctx: GuildhallMcpContext): Promise<string> {
  const config = await readOptional(path.join(ctx.projectRoot, 'guildhall.yaml'), '')
  return [
    '# Guildhall Project',
    '',
    `Runtime: ${ctx.runtime.kind}`,
    '',
    '## Config',
    '',
    '```yaml',
    trimForMcp(config),
    '```',
    '',
  ].join('\n')
}

async function renderTasks(ctx: GuildhallMcpContext): Promise<string> {
  const tasks = await readTasks(ctx.projectStateDir)
  if (tasks.length === 0) return '# Tasks\n\nNo active tasks.\n'
  return [
    '# Tasks',
    '',
    ...tasks.map((task) => `- ${task.id}: ${task.title || '(untitled)'} (${task.status || 'unknown'})`),
    '',
  ].join('\n')
}

async function renderTask(ctx: GuildhallMcpContext, taskId: string): Promise<string> {
  const task = (await readTasks(ctx.projectStateDir)).find((candidate) => candidate.id === taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)
  return [
    `# ${task.title || task.id}`,
    '',
    '```json',
    JSON.stringify(task, null, 2),
    '```',
    '',
  ].join('\n')
}

async function renderArtifacts(ctx: GuildhallMcpContext): Promise<string> {
  const artifacts = await readArtifactRegistry(ctx.projectRoot, ctx.projectStateDir)
  if (artifacts.length === 0) return '# Artifacts\n\nNo registered artifacts.\n'
  return [
    '# Artifacts',
    '',
    ...artifacts.map((artifact) => `- ${artifact.id}: ${artifact.description || artifact.path}`),
    '',
  ].join('\n')
}

async function renderArtifact(ctx: GuildhallMcpContext, artifactId: string): Promise<string> {
  const artifact = (await readArtifactRegistry(ctx.projectRoot, ctx.projectStateDir))
    .find((candidate) => candidate.id === artifactId)
  if (!artifact) throw new Error(`Artifact not found: ${artifactId}`)
  const resolved = safeProjectPath(ctx.projectRoot, artifact.path)
  return readOptional(
    resolved,
    `# ${artifact.id}\n\nRegistered artifact file is missing: ${artifact.path}\n`,
  )
}

async function readTasks(
  projectStateDir: string,
): Promise<Array<Record<string, unknown> & { id: string; title?: string; status?: string }>> {
  const raw = await readOptional(path.join(projectStateDir, 'TASKS.json'), '{"tasks":[]}')
  const parsed = JSON.parse(raw) as unknown
  const tasks = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { tasks?: unknown }).tasks)
      ? (parsed as { tasks: unknown[] }).tasks
      : []
  return tasks.filter((task): task is Record<string, unknown> & {
    id: string
    title?: string
    status?: string
  } =>
    Boolean(
      task &&
      typeof task === 'object' &&
      typeof (task as { id?: unknown }).id === 'string',
    ),
  )
}

async function readArtifactRegistry(
  projectRoot: string,
  projectStateDir: string,
): Promise<Array<{ id: string; path: string; description?: string }>> {
  const raw = await readOptional(path.join(projectStateDir, 'artifacts.yaml'), 'artifacts: []\n')
  const parsed = yamlLoad(raw) as {
    artifacts?: Array<{ id?: unknown; path?: unknown; description?: unknown }>
  } | null
  return (parsed?.artifacts ?? [])
    .filter((artifact): artifact is { id: string; path: string; description?: string } => {
      if (typeof artifact.id !== 'string' || typeof artifact.path !== 'string') return false
      safeProjectPath(projectRoot, artifact.path)
      return true
    })
}

async function readOptional(filePath: string, fallback: string): Promise<string> {
  try {
    return await fsp.readFile(filePath, 'utf8')
  } catch {
    return fallback
  }
}

function safeProjectPath(projectRoot: string, relativePath: string): string {
  const resolved = path.resolve(projectRoot, relativePath)
  const root = path.resolve(projectRoot)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path escapes project root: ${relativePath}`)
  }
  return resolved
}

function trimForMcp(text: string): string {
  return text.length > 12000 ? text.slice(0, 12000) + '\n\n[truncated]\n' : text
}
