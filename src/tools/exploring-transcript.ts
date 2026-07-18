import { defineTool } from '@guildhall/engine'
import {
  atomicWriteText,
  getProjectTranscriptPath,
  inferProjectRootFromMemoryDir,
  registerProjectHistoricalArtifactIfCurrent,
} from '@guildhall/sessions'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

// ---------------------------------------------------------------------------
// FR-08 / FR-12: exploring-phase essential history.
//
// During the `exploring` phase, the Spec Agent drives a conversation with the
// user to elicit outcome, acceptance criteria, scope, happy path, blast radius,
// required skills, and escalation triggers. The durable record is deliberately
// not a transcript dump: a small context model rewrites the exchange into
// essential facts, decisions, constraints, and unresolved questions after
// each append. Legacy full transcripts remain readable long enough to be
// compacted on their next write.
//
// Structure of the durable file:
//
//   # Essential exploring history: <task-id>
//   <model-written durable facts and open questions>
//   <!-- last-entry: <role>:<sha256> -->
// ---------------------------------------------------------------------------

const ESSENTIAL_HISTORY_MAX_CHARS = 6_000
const SUMMARY_INPUT_MAX_CHARS = 12_000
const TRANSCRIPT_READ_MAX_BYTES = SUMMARY_INPUT_MAX_CHARS * 2

const TranscriptRole = z.enum(['user', 'spec-agent', 'system'])
export type TranscriptRole = z.infer<typeof TranscriptRole>

export interface ExploringHistorySummaryInput {
  taskId: string
  priorHistory: string
  role: TranscriptRole
  content: string
}

export type ExploringHistorySummarizer = (
  input: ExploringHistorySummaryInput,
) => Promise<string | null>

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

export interface ReplaceExploringTranscriptInput {
  memoryDir: string
  taskId: string
  role?: TranscriptRole
  content: string
}

export interface EnsureExploringTranscriptEntryResult
  extends AppendExploringTranscriptResult {
  appended?: boolean
}

type AppendExploringTranscriptOptions = AppendExploringTranscriptInput & {
  summarizer?: ExploringHistorySummarizer
}

function transcriptPath(memoryDir: string, taskId: string): string {
  const projectRoot = inferProjectRootFromMemoryDir(memoryDir)
  return getProjectTranscriptPath(projectRoot, 'exploring', taskId)
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

function entryHash(role: TranscriptRole, content: string): string {
  return createHash('sha256').update(`${role}\n${content.trim()}`).digest('hex')
}

function boundedSource(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= SUMMARY_INPUT_MAX_CHARS) return trimmed
  const head = Math.floor(SUMMARY_INPUT_MAX_CHARS / 2)
  const tail = SUMMARY_INPUT_MAX_CHARS - head
  return `${trimmed.slice(0, head)}\n\n[older detail omitted before compaction]\n\n${trimmed.slice(-tail)}`
}

async function readBoundedTranscriptFile(filePath: string): Promise<string> {
  const stats = await fs.stat(filePath)
  if (stats.size <= TRANSCRIPT_READ_MAX_BYTES) return fs.readFile(filePath, 'utf-8')

  const headBytes = Math.floor(TRANSCRIPT_READ_MAX_BYTES / 2)
  const tailBytes = TRANSCRIPT_READ_MAX_BYTES - headBytes
  const handle = await fs.open(filePath, 'r')
  try {
    const head = Buffer.alloc(headBytes)
    const tail = Buffer.alloc(tailBytes)
    await handle.read(head, 0, headBytes, 0)
    await handle.read(tail, 0, tailBytes, Math.max(0, stats.size - tailBytes))
    return `${head.toString('utf-8')}\n\n[older raw transcript omitted before compaction]\n\n${tail.toString('utf-8')}`
  } finally {
    await handle.close()
  }
}

function extractHistoryBody(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('# Essential exploring history:')) {
    return trimmed
      .replace(/^# Essential exploring history:[^\n]*\n*/i, '')
      .replace(/\n?<!-- last-entry: [^>]+ -->\s*$/i, '')
      .trim()
  }
  const entries = [...trimmed.matchAll(/^## \[[^\]]+\] (user|spec-agent|system)\n\n([\s\S]*?)\n\n---$/gm)]
  if (entries.length === 0) return trimmed.replace(/^# Exploring transcript:[^\n]*\n*/i, '').trim()
  return entries
    .map((match) => `[${match[1]}] ${(match[2] ?? '').trim()}`)
    .join('\n\n')
}

function compactWithoutModel(
  priorHistory: string,
  role: TranscriptRole,
  content: string,
): string {
  const next = `[${role}] ${content.trim()}`
  const combined = [extractHistoryBody(priorHistory), next].filter(Boolean).join('\n\n')
  if (combined.length <= ESSENTIAL_HISTORY_MAX_CHARS) return combined
  const head = Math.floor(ESSENTIAL_HISTORY_MAX_CHARS * 0.42)
  const tail = ESSENTIAL_HISTORY_MAX_CHARS - head
  return `${combined.slice(0, head)}\n\n[older detail compacted]\n\n${combined.slice(-tail)}`
}

function renderEssentialHistory(
  taskId: string,
  summary: string,
  role: TranscriptRole,
  content: string,
): string {
  return [
    `# Essential exploring history: ${taskId}`,
    '',
    summary.trim().slice(0, ESSENTIAL_HISTORY_MAX_CHARS),
    '',
    `<!-- last-entry: ${role}:${entryHash(role, content)} -->`,
    '',
  ].join('\n')
}

function registerEssentialHistoryArtifact(
  projectRoot: string,
  filePath: string,
  taskId: string,
  rendered: string,
): void {
  // Legacy projects keep their existing history path until promotion. Do not
  // allocate a SQLite authority merely because a transcript was written.
  registerProjectHistoricalArtifactIfCurrent(projectRoot, {
    artifactId: `essential-history:${taskId}`,
    kind: 'essential_history',
    owner: 'exploring-transcript',
    logicalRef: path.relative(projectRoot, filePath).replaceAll(path.sep, '/'),
    bytes: Buffer.byteLength(rendered, 'utf8'),
    sha256: createHash('sha256').update(rendered, 'utf8').digest('hex'),
    retentionClass: 'essential',
    state: 'active',
    lastVerifiedAt: new Date().toISOString(),
  })
}

export async function appendExploringTranscript(
  input: AppendExploringTranscriptOptions,
): Promise<AppendExploringTranscriptResult> {
  if (!input.memoryDir?.trim()) return { success: false, error: 'Missing memoryDir' }
  if (!input.taskId?.trim()) return { success: false, error: 'Missing taskId' }
  try {
    const filePath = transcriptPath(input.memoryDir, input.taskId)
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    let existing = ''
    try {
      existing = await readBoundedTranscriptFile(filePath)
    } catch (err) {
      if (!String(err).includes('ENOENT')) throw err
    }

    const role = input.role ?? 'system'
    const content = input.content?.trim() ?? ''
    if (!content) return { success: false, path: filePath, error: 'Missing content' }

    // The model receives only the previous compact record plus this entry.
    // If the file is legacy raw transcript, boundedSource prevents migration
    // from turning one historical write into an unbounded prompt.
    const priorHistory = boundedSource(extractHistoryBody(existing))
    let summary: string | null = null
    if (input.summarizer) {
      try {
        summary = await input.summarizer({
          taskId: input.taskId,
          priorHistory,
          role,
          content,
        })
      } catch {
        summary = null
      }
    }
    const compacted = summary?.trim() || compactWithoutModel(priorHistory, role, content)
    const created = !existing
    const rendered = renderEssentialHistory(input.taskId, compacted, role, content)
    atomicWriteText(filePath, rendered)
    registerEssentialHistoryArtifact(inferProjectRootFromMemoryDir(input.memoryDir), filePath, input.taskId, rendered)
    return { success: true, path: filePath, created }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

/** Replace a seed/reset entry while preserving the same essential-history format. */
export async function replaceExploringTranscript(
  input: ReplaceExploringTranscriptInput,
): Promise<AppendExploringTranscriptResult> {
  if (!input.memoryDir?.trim()) return { success: false, error: 'Missing memoryDir' }
  if (!input.taskId?.trim()) return { success: false, error: 'Missing taskId' }
  const content = input.content?.trim() ?? ''
  if (!content) return { success: false, error: 'Missing content' }
  try {
    const filePath = transcriptPath(input.memoryDir, input.taskId)
    const role = input.role ?? 'system'
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const summary = compactWithoutModel('', role, content)
    const rendered = renderEssentialHistory(input.taskId, summary, role, content)
    atomicWriteText(filePath, rendered)
    registerEssentialHistoryArtifact(inferProjectRootFromMemoryDir(input.memoryDir), filePath, input.taskId, rendered)
    return { success: true, path: filePath, created: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

function lastTranscriptEntry(
  content: string,
): { role: TranscriptRole; hash: string } | null {
  const marker = content.match(/<!-- last-entry: (user|spec-agent|system):([a-f0-9]+) -->\s*$/im)
  if (marker) return { role: marker[1] as TranscriptRole, hash: marker[2] ?? '' }
  const matches = [...content.matchAll(/^## \[[^\]]+\] (user|spec-agent|system)\n\n([\s\S]*?)\n\n---$/gm)]
  const last = matches.at(-1)
  if (!last) return null
  const role = last[1] as TranscriptRole
  const body = (last[2] ?? '').trim()
  return { role, hash: entryHash(role, body) }
}

export async function ensureExploringTranscriptEntry(
  input: AppendExploringTranscriptInput,
): Promise<EnsureExploringTranscriptEntryResult> {
  if (!input.memoryDir?.trim()) return { success: false, error: 'Missing memoryDir', appended: false }
  if (!input.taskId?.trim()) return { success: false, error: 'Missing taskId', appended: false }
  const filePath = transcriptPath(input.memoryDir, input.taskId)
  try {
    const existing = await readBoundedTranscriptFile(filePath)
    const last = lastTranscriptEntry(existing)
    if (
      last &&
      input.role &&
      last.role === input.role &&
      last.hash === entryHash(input.role, input.content ?? '')
    ) {
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

export interface ExploringHistoryCompactionResult {
  filesSeen: number
  filesCompacted: number
  bytesBefore: number
  bytesAfter: number
}

/** Compact legacy full transcript files without exposing them to normal reads. */
export async function compactExploringTranscripts(input: {
  projectRoot: string
  summarizer?: ExploringHistorySummarizer
  dryRun?: boolean
}): Promise<ExploringHistoryCompactionResult> {
  const root = path.join(
    path.dirname(transcriptPath(path.join(input.projectRoot, '.guildhall'), '__probe__')),
  )
  let names: string[]
  try {
    names = (await fs.readdir(root)).filter((name) => name.endsWith('.md'))
  } catch (err) {
    if (String(err).includes('ENOENT')) {
      return { filesSeen: 0, filesCompacted: 0, bytesBefore: 0, bytesAfter: 0 }
    }
    throw err
  }

  let filesCompacted = 0
  let bytesBefore = 0
  let bytesAfter = 0
  for (const name of names) {
    const filePath = path.join(root, name)
    const taskId = name.slice(0, -'.md'.length)
    const existing = await fs.readFile(filePath, 'utf-8')
    bytesBefore += Buffer.byteLength(existing, 'utf8')
    const body = extractHistoryBody(existing)
    const isEssential = existing.trimStart().startsWith('# Essential exploring history:')
    if (isEssential && existing.length <= ESSENTIAL_HISTORY_MAX_CHARS + 256) {
      bytesAfter += Buffer.byteLength(existing, 'utf8')
      if (!input.dryRun) registerEssentialHistoryArtifact(input.projectRoot, filePath, taskId, existing)
      continue
    }
    const source = boundedSource(body)
    const summary = input.summarizer
      ? await input.summarizer({ taskId, priorHistory: '', role: 'system', content: source })
      : null
    const compacted = renderEssentialHistory(
      taskId,
      summary?.trim() || compactWithoutModel('', 'system', source),
      'system',
      source,
    )
    if (!input.dryRun) await fs.writeFile(filePath, compacted, 'utf-8')
    if (!input.dryRun) registerEssentialHistoryArtifact(input.projectRoot, filePath, taskId, compacted)
    bytesAfter += Buffer.byteLength(compacted, 'utf8')
    filesCompacted += 1
  }
  return { filesSeen: names.length, filesCompacted, bytesBefore, bytesAfter }
}

export const appendExploringTranscriptTool = defineTool({
  name: 'append-exploring-transcript',
  description:
    'Record an exploring-phase message in the compact essential history in user-local Guildhall history. Call this for every user message and spec-agent reply; Guildhall keeps durable facts and open questions, not raw conversation scrollback.',
  inputSchema: appendExploringTranscriptInputSchema,
  jsonSchema: { type: 'object' },
  isReadOnly: () => false,
  execute: async (input, ctx) => {
    const resolved = resolveTranscriptTarget(input, ctx.metadata)
    const entry = resolveTranscriptEntryDefaults(input, ctx.metadata)
    if ('error' in resolved || 'error' in entry) {
      const error = 'error' in resolved ? resolved.error : ('error' in entry ? entry.error : 'Unknown transcript error')
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
      ...(typeof ctx.metadata['summarize_exploring_history'] === 'function'
        ? { summarizer: ctx.metadata['summarize_exploring_history'] as ExploringHistorySummarizer }
        : {}),
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
    const content = await readBoundedTranscriptFile(filePath)
    return { content: boundedSource(extractHistoryBody(content)), path: filePath }
  } catch (err) {
    const msg = String(err)
    if (!msg.includes('ENOENT')) {
      return { content: null, path: filePath, error: msg }
    }
  }
  return { content: null, path: filePath }
}

export const readExploringTranscriptTool = defineTool({
  name: 'read-exploring-transcript',
  description:
    'Read the compact essential history for a task in the exploring phase. Returns null content if no history exists yet.',
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
