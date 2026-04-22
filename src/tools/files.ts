import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Dirent } from 'node:fs'

const readFileInputSchema = z.object({
  filePath: z.string().describe('Absolute path to the file'),
})

export type ReadFileInput = z.input<typeof readFileInputSchema>
export interface ReadFileResult {
  content: string
  exists: boolean
}

export async function readFile(input: ReadFileInput): Promise<ReadFileResult> {
  try {
    const content = await fs.readFile(input.filePath, 'utf-8')
    return { content, exists: true }
  } catch {
    return { content: '', exists: false }
  }
}

export const readFileTool = defineTool({
  name: 'read-file',
  description:
    'Read a file from the filesystem. Use this to read source files, docs, config files, or memory files.',
  inputSchema: readFileInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Absolute path to the file' },
    },
    required: ['filePath'],
  },
  isReadOnly: () => true,
  execute: async (input) => {
    const result = await readFile(input)
    return {
      output: result.exists ? result.content : `(file not found: ${input.filePath})`,
      is_error: !result.exists,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

const writeFileInputSchema = z.object({
  filePath: z.string().describe('Absolute path to the file'),
  content: z.string().describe('Full content to write'),
})

export type WriteFileInput = z.input<typeof writeFileInputSchema>
export interface WriteFileResult {
  success: boolean
  error?: string
}

export async function writeFile(input: WriteFileInput): Promise<WriteFileResult> {
  try {
    await fs.mkdir(path.dirname(input.filePath), { recursive: true })
    await fs.writeFile(input.filePath, input.content, 'utf-8')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const writeFileTool = defineTool({
  name: 'write-file',
  description:
    'Write content to a file. Creates parent directories if needed. Use for creating or updating source files, docs, or memory files.',
  inputSchema: writeFileInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Absolute path to the file' },
      content: { type: 'string', description: 'Full content to write' },
    },
    required: ['filePath', 'content'],
  },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await writeFile(input)
    return {
      output: result.success ? `Wrote ${input.filePath}` : `Error writing ${input.filePath}: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

const listFilesInputSchema = z.object({
  dirPath: z.string().describe('Absolute path to the directory'),
})

export type ListFilesInput = z.input<typeof listFilesInputSchema>
export interface ListFilesEntry {
  name: string
  isDirectory: boolean
}
export interface ListFilesResult {
  entries: ListFilesEntry[]
  exists: boolean
}

export async function listFiles(input: ListFilesInput): Promise<ListFilesResult> {
  try {
    const entries = await fs.readdir(input.dirPath, { withFileTypes: true })
    return {
      exists: true,
      entries: entries.map((e: Dirent) => ({ name: e.name, isDirectory: e.isDirectory() })),
    }
  } catch {
    return { exists: false, entries: [] }
  }
}

export const listFilesTool = defineTool({
  name: 'list-files',
  description: 'List files and directories at a given path. Non-recursive.',
  inputSchema: listFilesInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      dirPath: { type: 'string', description: 'Absolute path to the directory' },
    },
    required: ['dirPath'],
  },
  isReadOnly: () => true,
  execute: async (input) => {
    const result = await listFiles(input)
    if (!result.exists) {
      return {
        output: `(directory not found: ${input.dirPath})`,
        is_error: true,
        metadata: result as unknown as Record<string, unknown>,
      }
    }
    const lines = result.entries.map((e) => (e.isDirectory ? `${e.name}/` : e.name))
    return {
      output: lines.join('\n'),
      is_error: false,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})
