/**
 * File read / write / edit / list tools.
 *
 * editFileTool is ported from
 *   openharness/src/openharness/tools/file_edit_tool.py
 * readFileTool is ported from
 *   openharness/src/openharness/tools/file_read_tool.py
 * writeFileTool is ported from
 *   openharness/src/openharness/tools/file_write_tool.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Sandbox path-validation branch is deferred — Guildhall does not yet
 *     ship a Docker sandbox adapter. When that lands, a context-threaded
 *     validator plugs in here.
 *   - String.replace with a plain string only replaces the first occurrence
 *     in JS, so the single-replacement path uses a manual slice + concat
 *     to avoid regex-escape pitfalls with `replaceAll`-style behavior.
 *   - Parameter casing follows the rest of the Guildhall tool set
 *     (`filePath` / `oldString` / `newString`), not Python snake_case.
 *   - readFileTool keeps the existing `readFile()` helper returning raw
 *     content for in-process callers; the line-numbered render is applied
 *     only at the LLM-facing `execute()` boundary.
 *   - Default limit is 2000 lines (upstream 200) — Guildhall agents read
 *     whole files far more often than not, and the harness caps wide reads
 *     via compaction rather than truncating at the tool.
 *   - writeFileTool accepts absolute paths, ~-prefixed paths, and
 *     cwd-relative paths (upstream resolves via pathlib + ctx.cwd). The
 *     programmatic `writeFile()` helper takes an optional `{cwd}` option so
 *     non-tool callers can opt in; callers that have always passed absolute
 *     paths keep working unchanged.
 */

import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Dirent } from 'node:fs'

const READ_FILE_DEFAULT_LIMIT = 2000

const readFileInputSchema = z.object({
  filePath: z.string().describe('Absolute path to the file'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Zero-based starting line for partial reads'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(2000)
    .optional()
    .describe(`Max lines to return (default ${READ_FILE_DEFAULT_LIMIT})`),
})

export type ReadFileInput = z.input<typeof readFileInputSchema>
export interface ReadFileResult {
  content: string
  exists: boolean
  /** True when the path exists but is a directory. */
  isDirectory?: boolean
  /** True when the file contains a NUL byte (binary). */
  isBinary?: boolean
}

export async function readFile(input: ReadFileInput): Promise<ReadFileResult> {
  try {
    const stat = await fs.stat(input.filePath)
    if (stat.isDirectory()) return { content: '', exists: true, isDirectory: true }
    const raw = await fs.readFile(input.filePath)
    if (raw.includes(0)) return { content: '', exists: true, isBinary: true }
    return { content: raw.toString('utf-8'), exists: true }
  } catch {
    return { content: '', exists: false }
  }
}

/**
 * Render a file slice in `cat -n`-style: 6-char right-aligned line number,
 * a tab, the line text. Matches upstream's output so ported edit/grep tools
 * can key off the same format.
 */
function renderLineNumbered(content: string, offset: number, limit: number): string {
  const lines = content.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const selected = lines.slice(offset, offset + limit)
  if (selected.length === 0) return ''
  return selected
    .map((line, i) => `${String(offset + i + 1).padStart(6, ' ')}\t${line}`)
    .join('\n')
}

export const readFileTool = defineTool({
  name: 'read-file',
  description:
    'Read a UTF-8 file from the filesystem. Returns line-numbered content (cat -n style) so edit tools can target specific lines. Supports offset/limit for partial reads on large files.',
  inputSchema: readFileInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Absolute path to the file' },
      offset: {
        type: 'integer',
        minimum: 0,
        description: 'Zero-based starting line for partial reads',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 2000,
        description: `Max lines to return (default ${READ_FILE_DEFAULT_LIMIT})`,
      },
    },
    required: ['filePath'],
  },
  isReadOnly: () => true,
  execute: async (input) => {
    const result = await readFile(input)
    if (!result.exists) {
      return {
        output: `(file not found: ${input.filePath})`,
        is_error: true,
        metadata: result as unknown as Record<string, unknown>,
      }
    }
    if (result.isDirectory) {
      return {
        output: `(cannot read directory: ${input.filePath})`,
        is_error: true,
        metadata: result as unknown as Record<string, unknown>,
      }
    }
    if (result.isBinary) {
      return {
        output: `(binary file, not read as text: ${input.filePath})`,
        is_error: true,
        metadata: result as unknown as Record<string, unknown>,
      }
    }
    const offset = input.offset ?? 0
    const limit = input.limit ?? READ_FILE_DEFAULT_LIMIT
    const body = renderLineNumbered(result.content, offset, limit)
    return {
      output:
        body.length > 0
          ? body
          : `(no content in selected range for ${input.filePath})`,
      is_error: false,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

const writeFileInputSchema = z.object({
  filePath: z.string().describe('Path to the file (absolute, ~-prefixed, or cwd-relative)'),
  content: z.string().describe('Full content to write'),
  createDirectories: z
    .boolean()
    .optional()
    .describe('Create missing parent directories (default true).'),
})

export type WriteFileInput = z.input<typeof writeFileInputSchema>
export interface WriteFileResult {
  success: boolean
  path: string
  error?: string
}

function resolveFilePath(cwd: string | undefined, candidate: string): string {
  const expanded = candidate.startsWith('~')
    ? path.join(process.env['HOME'] ?? '', candidate.slice(1))
    : candidate
  if (path.isAbsolute(expanded)) return path.resolve(expanded)
  return path.resolve(cwd ?? process.cwd(), expanded)
}

export async function writeFile(
  input: WriteFileInput,
  opts: { cwd?: string } = {},
): Promise<WriteFileResult> {
  const absPath = resolveFilePath(opts.cwd, input.filePath)
  const shouldMkdir = input.createDirectories !== false
  try {
    if (shouldMkdir) await fs.mkdir(path.dirname(absPath), { recursive: true })
    await fs.writeFile(absPath, input.content, 'utf-8')
    return { success: true, path: absPath }
  } catch (err) {
    return { success: false, path: absPath, error: String(err) }
  }
}

export const writeFileTool = defineTool({
  name: 'write-file',
  description:
    'Write content to a file. Accepts absolute paths, ~-prefixed paths, or paths relative to the working directory. Creates parent directories unless createDirectories is false. Use for creating or updating source files, docs, or memory files.',
  inputSchema: writeFileInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Path to the file (absolute, ~-prefixed, or cwd-relative)',
      },
      content: { type: 'string', description: 'Full content to write' },
      createDirectories: {
        type: 'boolean',
        description: 'Create missing parent directories (default true).',
      },
    },
    required: ['filePath', 'content'],
  },
  isReadOnly: () => false,
  execute: async (input, ctx) => {
    const result = await writeFile(input, { cwd: ctx.cwd })
    return {
      output: result.success
        ? `Wrote ${result.path}`
        : `Error writing ${result.path}: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

const editFileInputSchema = z.object({
  filePath: z.string().describe('Absolute path to the file'),
  oldString: z
    .string()
    .describe(
      'Existing text to replace. Must appear exactly once in the file unless replaceAll is true.',
    ),
  newString: z.string().describe('Replacement text.'),
  replaceAll: z
    .boolean()
    .optional()
    .describe(
      'If true, replace every occurrence; otherwise require a unique match and replace once.',
    ),
})

export type EditFileInput = z.input<typeof editFileInputSchema>
export interface EditFileResult {
  success: boolean
  replacements: number
  error?: string
}

/**
 * Replace text inside an existing file.
 *
 * Defaults to single-replacement, and errors out if `oldString` matches more
 * than once (which would make the edit ambiguous). Callers that genuinely
 * want to rewrite every occurrence can opt in with `replaceAll: true`.
 */
export async function editFile(input: EditFileInput): Promise<EditFileResult> {
  let original: string
  try {
    original = await fs.readFile(input.filePath, 'utf-8')
  } catch {
    return { success: false, replacements: 0, error: `File not found: ${input.filePath}` }
  }

  if (input.oldString.length === 0) {
    return { success: false, replacements: 0, error: 'oldString must not be empty' }
  }

  // Count occurrences up front so we can reject ambiguous single-edit calls
  // and report exactly how many replacements happened for structured callers.
  let count = 0
  let idx = original.indexOf(input.oldString)
  while (idx !== -1) {
    count += 1
    idx = original.indexOf(input.oldString, idx + input.oldString.length)
  }
  if (count === 0) {
    return {
      success: false,
      replacements: 0,
      error: 'oldString was not found in the file',
    }
  }
  if (!input.replaceAll && count > 1) {
    return {
      success: false,
      replacements: 0,
      error: `oldString matches ${count} times; make it unique or set replaceAll: true`,
    }
  }

  let updated: string
  let replacements: number
  if (input.replaceAll) {
    updated = original.split(input.oldString).join(input.newString)
    replacements = count
  } else {
    const hit = original.indexOf(input.oldString)
    updated =
      original.slice(0, hit) +
      input.newString +
      original.slice(hit + input.oldString.length)
    replacements = 1
  }

  try {
    await fs.writeFile(input.filePath, updated, 'utf-8')
  } catch (err) {
    return { success: false, replacements: 0, error: String(err) }
  }
  return { success: true, replacements }
}

export const editFileTool = defineTool({
  name: 'edit-file',
  description:
    'Replace text inside an existing file. By default the match must be unique; pass replaceAll to rewrite every occurrence. Prefer this over write-file for targeted edits so unrelated content stays byte-identical.',
  inputSchema: editFileInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Absolute path to the file' },
      oldString: {
        type: 'string',
        description:
          'Existing text to replace. Must appear exactly once in the file unless replaceAll is true.',
      },
      newString: { type: 'string', description: 'Replacement text.' },
      replaceAll: {
        type: 'boolean',
        description:
          'If true, replace every occurrence; otherwise require a unique match and replace once.',
      },
    },
    required: ['filePath', 'oldString', 'newString'],
  },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await editFile(input)
    const output = result.success
      ? `Edited ${input.filePath} (${result.replacements} replacement${result.replacements === 1 ? '' : 's'})`
      : `Error editing ${input.filePath}: ${result.error ?? 'unknown'}`
    return {
      output,
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
