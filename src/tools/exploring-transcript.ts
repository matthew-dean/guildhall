import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'

// ---------------------------------------------------------------------------
// FR-08 / FR-12: exploring-phase conversation transcripts.
//
// During the `exploring` phase, the Spec Agent drives a conversation with the
// user to elicit outcome, acceptance criteria, scope, happy path, blast radius,
// required skills, and escalation triggers. That back-and-forth is persisted
// at `memory/exploring/<task-id>.md` so the conversation survives restarts
// and can be audited after the fact.
//
// Structure of the transcript file:
//
//   # Exploring transcript: <task-id>
//
//   ## [<timestamp>] <role>
//   <content>
//
//   ---
//
// One entry per message, oldest at the top, newest appended to the bottom.
// ---------------------------------------------------------------------------

const TranscriptRole = z.enum(['user', 'spec-agent', 'system'])
export type TranscriptRole = z.infer<typeof TranscriptRole>

const appendExploringTranscriptInputSchema = z.object({
  memoryDir: z.string().optional().describe('Absolute path to the memory/ directory'),
  taskId: z.string().optional().describe('The task being explored'),
  role: TranscriptRole.optional(),
  content: z.string().optional(),
  message: z.string().optional().describe('Alias for content used by some near-miss model calls.'),
  item: z
    .union([
      z.string(),
      z.object({
        content: z.string().optional(),
        message: z.string().optional(),
        role: z.string().optional(),
      }).passthrough(),
    ])
    .optional()
    .describe('Optional nested or stringified transcript payload recovered from near-miss model calls.'),
})

export type AppendExploringTranscriptInput = z.input<
  typeof appendExploringTranscriptInputSchema
>
export interface AppendExploringTranscriptResult {
  success: boolean
  path?: string
  created?: boolean
  error?: string
}

export interface EnsureExploringTranscriptEntryResult
  extends AppendExploringTranscriptResult {
  appended?: boolean
}

function transcriptPath(memoryDir: string, taskId: string): string {
  return path.join(memoryDir, 'exploring', `${taskId}.md`)
}

function resolveTranscriptTarget(
  input: { memoryDir?: string; taskId?: string },
  metadata: Record<string, unknown>,
): { memoryDir: string; taskId: string } | { error: string } {
  const memoryDir = String(input.memoryDir ?? metadata['memory_dir'] ?? '').trim()
  const taskId = String(input.taskId ?? metadata['current_task_id'] ?? '').trim()
  if (!memoryDir) return { error: 'Missing memoryDir (or metadata.memory_dir)' }
  if (!taskId) return { error: 'Missing taskId (or metadata.current_task_id)' }
  return { memoryDir, taskId }
}

function resolveTranscriptEntryDefaults(
  input: Pick<AppendExploringTranscriptInput, 'role' | 'content' | 'message' | 'item'>,
  metadata: Record<string, unknown>,
): { role: TranscriptRole; content: string } | { error: string } {
  const agentId = String(metadata['current_agent_id'] ?? '').trim()
  const recovered = recoverTranscriptAliases(input.item)
  const rawRole = input.role ?? recovered?.role
  const role = rawRole === 'user' || rawRole === 'spec-agent' || rawRole === 'system'
    ? rawRole
    : (agentId === 'spec-agent' ? 'spec-agent' : 'system')
  const content = String(
    input.content ??
    input.message ??
    recovered?.content ??
    metadata['last_assistant_text'] ??
    '',
  ).trim()
  if (!content) return { error: 'Missing content (and no metadata.last_assistant_text)' }
  return { role, content }
}

function recoverTranscriptAliases(
  raw: AppendExploringTranscriptInput['item'],
): { role?: string; content?: string } | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return null
    try {
      return recoverTranscriptAliases(JSON.parse(trimmed) as AppendExploringTranscriptInput['item'])
    } catch {
      return { content: trimmed }
    }
  }
  if (typeof raw !== 'object') return null
  const role = typeof raw.role === 'string' ? raw.role.trim() : undefined
  const content = typeof raw.content === 'string'
    ? raw.content.trim()
    : (typeof raw.message === 'string' ? raw.message.trim() : undefined)
  if (!role && !content) return null
  return { ...(role ? { role } : {}), ...(content ? { content } : {}) }
}

export async function appendExploringTranscript(
  input: AppendExploringTranscriptInput,
): Promise<AppendExploringTranscriptResult> {
  if (!input.memoryDir?.trim()) return { success: false, error: 'Missing memoryDir' }
  if (!input.taskId?.trim()) return { success: false, error: 'Missing taskId' }
  try {
    const filePath = transcriptPath(input.memoryDir, input.taskId)
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    // If this is the first write, seed the file with a header.
    let created = false
    try {
      await fs.access(filePath)
    } catch {
      created = true
      await fs.writeFile(
        filePath,
        `# Exploring transcript: ${input.taskId}\n\n`,
        'utf-8',
      )
    }

    const block = [
      `## [${new Date().toISOString()}] ${input.role}`,
      '',
      input.content,
      '',
      '---',
      '',
    ].join('\n')

    await fs.appendFile(filePath, block, 'utf-8')
    return { success: true, path: filePath, created }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

function lastTranscriptEntry(
  content: string,
): { role: TranscriptRole; body: string } | null {
  const matches = [...content.matchAll(/^## \[[^\]]+\] (user|spec-agent|system)\n\n([\s\S]*?)\n\n---$/gm)]
  const last = matches.at(-1)
  if (!last) return null
  const role = last[1] as TranscriptRole
  const body = (last[2] ?? '').trim()
  return { role, body }
}

export async function ensureExploringTranscriptEntry(
  input: AppendExploringTranscriptInput,
): Promise<EnsureExploringTranscriptEntryResult> {
  if (!input.memoryDir?.trim()) return { success: false, error: 'Missing memoryDir', appended: false }
  if (!input.taskId?.trim()) return { success: false, error: 'Missing taskId', appended: false }
  const filePath = transcriptPath(input.memoryDir, input.taskId)
  try {
    const existing = await fs.readFile(filePath, 'utf-8')
    const last = lastTranscriptEntry(existing)
    if (last && last.role === input.role && last.body === input.content.trim()) {
      return { success: true, path: filePath, created: false, appended: false }
    }
  } catch (err) {
    const msg = String(err)
    if (!msg.includes('ENOENT')) {
      return { success: false, path: filePath, error: msg, appended: false }
    }
  }
  const appended = await appendExploringTranscript(input)
  return { ...appended, appended: appended.success }
}

export const appendExploringTranscriptTool = defineTool({
  name: 'append-exploring-transcript',
  description:
    "Append a message to the exploring-phase conversation transcript at memory/exploring/<task-id>.md. Call this for every user message and every spec-agent reply during intake — the transcript must be a complete record of the conversation.",
  inputSchema: appendExploringTranscriptInputSchema,
  jsonSchema: { type: 'object' },
  isReadOnly: () => false,
  execute: async (input, ctx) => {
    const resolved = resolveTranscriptTarget(input, ctx.metadata)
    const entry = resolveTranscriptEntryDefaults(input, ctx.metadata)
    if ('error' in resolved || 'error' in entry) {
      const error = 'error' in resolved ? resolved.error : entry.error
      return {
        output: `Error appending transcript: ${error}`,
        is_error: true,
        metadata: { success: false, error },
      }
    }
    const result = await appendExploringTranscript({
      ...input,
      memoryDir: resolved.memoryDir,
      taskId: resolved.taskId,
      role: entry.role,
      content: entry.content,
    })
    return {
      output: result.success
        ? `Appended ${entry.role} message to ${result.path}${result.created ? ' (new transcript)' : ''}`
        : `Error appending transcript: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

const readExploringTranscriptInputSchema = z.object({
  memoryDir: z.string().optional(),
  taskId: z.string().optional(),
})

export type ReadExploringTranscriptInput = z.input<
  typeof readExploringTranscriptInputSchema
>
export interface ReadExploringTranscriptResult {
  content: string | null
  path: string
  error?: string
}

export async function readExploringTranscript(
  input: ReadExploringTranscriptInput,
): Promise<ReadExploringTranscriptResult> {
  if (!input.memoryDir?.trim() || !input.taskId?.trim()) {
    return {
      content: null,
      path: transcriptPath(input.memoryDir ?? '', input.taskId ?? ''),
      error: 'Missing memoryDir or taskId',
    }
  }
  const filePath = transcriptPath(input.memoryDir, input.taskId)
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    return { content, path: filePath }
  } catch (err) {
    const msg = String(err)
    if (msg.includes('ENOENT')) {
      return { content: null, path: filePath }
    }
    return { content: null, path: filePath, error: msg }
  }
}

export const readExploringTranscriptTool = defineTool({
  name: 'read-exploring-transcript',
  description:
    'Read the full conversation transcript for a task in the exploring phase. Returns null content if no transcript exists yet.',
  inputSchema: readExploringTranscriptInputSchema,
  jsonSchema: { type: 'object' },
  isReadOnly: () => true,
  execute: async (input, ctx) => {
    const resolved = resolveTranscriptTarget(input, ctx.metadata)
    if ('error' in resolved) {
      return {
        output: `Error: ${resolved.error}`,
        is_error: true,
        metadata: { content: null, error: resolved.error },
      }
    }
    const result = await readExploringTranscript({
      memoryDir: resolved.memoryDir,
      taskId: resolved.taskId,
    })
    if (result.error) {
      return {
        output: `Error: ${result.error}`,
        is_error: true,
        metadata: result as unknown as Record<string, unknown>,
      }
    }
    return {
      output: result.content ?? `(no transcript yet at ${result.path})`,
      is_error: false,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

export { transcriptPath as exploringTranscriptPath }
