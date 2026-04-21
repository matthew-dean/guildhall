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
  memoryDir: z.string().describe('Absolute path to the memory/ directory'),
  taskId: z.string().describe('The task being explored'),
  role: TranscriptRole,
  content: z.string(),
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

function transcriptPath(memoryDir: string, taskId: string): string {
  return path.join(memoryDir, 'exploring', `${taskId}.md`)
}

export async function appendExploringTranscript(
  input: AppendExploringTranscriptInput,
): Promise<AppendExploringTranscriptResult> {
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

export const appendExploringTranscriptTool = defineTool({
  name: 'append-exploring-transcript',
  description:
    "Append a message to the exploring-phase conversation transcript at memory/exploring/<task-id>.md. Call this for every user message and every spec-agent reply during intake — the transcript must be a complete record of the conversation.",
  inputSchema: appendExploringTranscriptInputSchema,
  jsonSchema: { type: 'object' },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await appendExploringTranscript(input)
    return {
      output: result.success
        ? `Appended ${input.role} message to ${result.path}${result.created ? ' (new transcript)' : ''}`
        : `Error appending transcript: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

const readExploringTranscriptInputSchema = z.object({
  memoryDir: z.string(),
  taskId: z.string(),
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
  execute: async (input) => {
    const result = await readExploringTranscript(input)
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
