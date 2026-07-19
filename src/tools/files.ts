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
 *   - writeFileTool and readFileTool accept absolute paths, ~-prefixed
 *     paths, and cwd-relative paths (upstream resolves via pathlib +
 *     ctx.cwd). The programmatic helpers take an optional `{cwd}` option so
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
  filePath: z.string().describe('Path to the file (absolute, ~-prefixed, or cwd-relative)'),
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

export async function readFile(
  input: ReadFileInput,
  opts: { cwd?: string } = {},
): Promise<ReadFileResult> {
  const absPath = resolveFilePath(opts.cwd, input.filePath)
  try {
    const stat = await fs.stat(absPath)
    if (stat.isDirectory()) return { content: '', exists: true, isDirectory: true }
    const raw = await fs.readFile(absPath)
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
    'Read a UTF-8 file from the filesystem. Accepts absolute paths, ~-prefixed paths, or paths relative to the working directory. Returns line-numbered content (cat -n style) so edit tools can target specific lines. Supports offset/limit for partial reads on large files.',
  inputSchema: readFileInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Path to the file (absolute, ~-prefixed, or cwd-relative)',
      },
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
  execute: async (input, ctx) => {
    const reconciledPath = reconcileLikelyTargetFilePath(input.filePath, ctx.metadata, ctx.cwd)
    const resolvedPath = resolveFilePath(ctx.cwd, reconciledPath)
    const result = await readFile({ ...input, filePath: reconciledPath }, { cwd: ctx.cwd })
    if (!result.exists) {
      return {
        output: `(file not found: ${resolvedPath})`,
        is_error: true,
        metadata: result as unknown as Record<string, unknown>,
      }
    }
    if (result.isDirectory) {
      return {
        output: `(cannot read directory: ${resolvedPath})`,
        is_error: true,
        metadata: result as unknown as Record<string, unknown>,
      }
    }
    if (result.isBinary) {
      return {
        output: `(binary file, not read as text: ${resolvedPath})`,
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
          : `(no content in selected range for ${resolveFilePath(ctx.cwd, reconciledPath)})`,
      is_error: false,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

const writeFileInputSchema = z.object({
  filePath: z.string().optional().describe('Path to the file (absolute, ~-prefixed, or cwd-relative)'),
  content: z.string().optional().describe('Full content to write'),
  createDirectories: z
    .boolean()
    .optional()
    .describe('Create missing parent directories (default true).'),
  path: z.string().optional().describe('Alias for filePath used by near-miss model calls.'),
  text: z.string().optional().describe('Alias for content used by near-miss model calls.'),
  body: z.string().optional().describe('Alias for content used by near-miss model calls.'),
  message: z.string().optional().describe('Alias for content used by near-miss model calls.'),
  item: z
    .union([
      z.string(),
      z.object({
        filePath: z.string().optional(),
        path: z.string().optional(),
        content: z.string().optional(),
        text: z.string().optional(),
        body: z.string().optional(),
        message: z.string().optional(),
      }).passthrough(),
    ])
    .optional()
    .describe('Optional nested or stringified payload recovered from near-miss model calls.'),
})

export type WriteFileInput = z.input<typeof writeFileInputSchema>
export interface WriteFileResult {
  success: boolean
  path: string
  error?: string
}

interface ReadFileStateEntry {
  path?: unknown
}

function metadataStringArray(
  metadata: Record<string, unknown>,
  key: string,
): string[] {
  const raw = metadata[key]
  if (!Array.isArray(raw)) return []
  return raw
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
}

function resolveFilePath(cwd: string | undefined, candidate: string): string {
  const expanded = candidate.startsWith('~')
    ? path.join(process.env['HOME'] ?? '', candidate.slice(1))
    : candidate
  if (path.isAbsolute(expanded)) return path.resolve(expanded)
  return path.resolve(cwd ?? process.cwd(), expanded)
}

function taskPathBase(
  metadata: Record<string, unknown>,
  cwd?: string,
): string {
  const worktree = String(metadata['current_task_worktree_path'] ?? '').trim()
  if (worktree) return worktree
  const projectPath = String(metadata['current_task_project_path'] ?? '').trim()
  if (projectPath) return projectPath
  return cwd ?? process.cwd()
}

function leakedModelControlMarkupReason(content: string): string | null {
  const patterns: Array<[RegExp, string]> = [
    [/^\s*<\s*(?:[｜|]\s*)?DSML(?:\s*[｜|]|\b)/im, 'DSML tool protocol tag'],
    [/<\s*\/\s*think\s*>/i, 'model thinking close tag'],
    [/^\s*<\s*\/?\s*think\s*>\s*$/im, 'model thinking tag'],
  ]
  for (const [pattern, label] of patterns) {
    if (pattern.test(content)) return label
  }
  return null
}

function rejectLeakedModelControlMarkup(content: string): string | null {
  const reason = leakedModelControlMarkupReason(content)
  if (!reason) return null
  return `Refusing to write leaked model/tool-control markup (${reason}). Re-run the edit with only the intended file content, without tool protocol or hidden reasoning tags.`
}

export async function writeFile(
  input: WriteFileInput,
  opts: { cwd?: string } = {},
): Promise<WriteFileResult> {
  if (!input.filePath?.trim()) return { success: false, path: '', error: 'Missing filePath' }
  if (typeof input.content !== 'string') return { success: false, path: '', error: 'Missing content' }
  const absPath = resolveFilePath(opts.cwd, input.filePath)
  const leakedMarkupError = rejectLeakedModelControlMarkup(input.content)
  if (leakedMarkupError) return { success: false, path: absPath, error: leakedMarkupError }
  const shouldMkdir = input.createDirectories !== false
  try {
    if (shouldMkdir) await fs.mkdir(path.dirname(absPath), { recursive: true })
    await fs.writeFile(absPath, input.content, 'utf-8')
    return { success: true, path: absPath }
  } catch (err) {
    return { success: false, path: absPath, error: String(err) }
  }
}

function recoverWriteFileAliases(
  raw: WriteFileInput['item'],
): { filePath?: string; content?: string } | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return null
    try {
      return recoverWriteFileAliases(JSON.parse(trimmed) as WriteFileInput['item'])
    } catch {
      return { content: trimmed }
    }
  }
  if (typeof raw !== 'object') return null
  const filePath = typeof raw.filePath === 'string'
    ? raw.filePath.trim()
    : (typeof raw.path === 'string' ? raw.path.trim() : '')
  const content = typeof raw.content === 'string'
    ? raw.content
    : typeof raw.text === 'string'
      ? raw.text
      : typeof raw.body === 'string'
        ? raw.body
        : typeof raw.message === 'string'
          ? raw.message
          : ''
  if (!filePath && !content) return null
  return {
    ...(filePath ? { filePath } : {}),
    ...(content ? { content } : {}),
  }
}

function inferLikelyWriteFilePath(
  metadata: Record<string, unknown>,
): string | null {
  const explicitMissingTarget = String(metadata['current_missing_likely_target_file'] ?? '').trim()
  if (explicitMissingTarget) return explicitMissingTarget

  const likelyTargets = metadataStringArray(metadata, 'current_task_likely_target_files')
  const testLikeTarget = likelyTargets.find((candidate) => /\.test\.[jt]sx?$/.test(candidate))
  if (testLikeTarget) return testLikeTarget
  if (likelyTargets.length > 0) return likelyTargets[0] ?? null

  const readState = Array.isArray(metadata['read_file_state'])
    ? metadata['read_file_state'] as ReadFileStateEntry[]
    : []
  for (let i = readState.length - 1; i >= 0; i -= 1) {
    const rawPath = typeof readState[i]?.path === 'string' ? String(readState[i]!.path) : ''
    if (!rawPath) continue
    const normalized = rawPath.replace(/\\/g, '/')
    const directTestPath = normalized.match(/^(.*\/tests\/unit\/(?:composables|shared)\/[^/]+\.test\.ts)$/)
    if (directTestPath) return directTestPath[1] ?? null
    const composableMatch = normalized.match(/^(.*\/)app\/composables\/([^/]+)\.ts$/)
    if (composableMatch) {
      return `${composableMatch[1]}tests/unit/composables/${composableMatch[2]}.test.ts`
    }
    const sharedMatch = normalized.match(/^(.*\/)shared\/utils\/([^/]+)\.ts$/)
    if (sharedMatch) {
      return `${sharedMatch[1]}tests/unit/shared/${sharedMatch[2]}.test.ts`
    }
  }

  const taskTitle = String(metadata['current_task_title'] ?? '').trim()
  const taskSpec = String(metadata['current_task_spec_excerpt'] ?? '').trim()
  const taskHint = `${taskTitle}\n${taskSpec}`
  const composableNameMatch = taskHint.match(/\buse-([a-z0-9-]+)\b/i)
  if (composableNameMatch) {
    const stem = `use-${composableNameMatch[1]!.toLowerCase()}`
    const taskProjectPath = String(metadata['current_task_project_path'] ?? '').trim()
    if (taskProjectPath) {
      return path.join(taskProjectPath, 'web', 'tests', 'unit', 'composables', `${stem}.test.ts`)
    }
  }
  return null
}

function likelyTargetCandidates(metadata: Record<string, unknown>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const base = taskPathBase(metadata)
  const push = (candidate: string) => {
    const trimmed = candidate.trim()
    if (!trimmed) return
    const normalized = resolveFilePath(base, trimmed)
    if (seen.has(normalized)) return
    seen.add(normalized)
    out.push(normalized)
  }
  const explicitMissingTarget = String(metadata['current_missing_likely_target_file'] ?? '').trim()
  if (explicitMissingTarget) push(explicitMissingTarget)
  for (const target of metadataStringArray(metadata, 'current_task_likely_target_files')) push(target)
  return out
}

function anchoredSuffix(candidate: string): string {
  const normalized = candidate.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  const anchorIndex = parts.findIndex((part) => ['web', 'app', 'src', 'tests', 'server'].includes(part))
  return anchorIndex >= 0 ? parts.slice(anchorIndex).join('/') : parts.join('/')
}

function reconcileLikelyTargetFilePath(
  filePath: string,
  metadata: Record<string, unknown>,
  cwd?: string,
): string {
  const normalizedInput = resolveFilePath(taskPathBase(metadata, cwd), filePath)
  const taskWorktreePath = String(metadata['current_task_worktree_path'] ?? '').trim()
  if (taskWorktreePath) {
    const normalizedWorktreePath = path.resolve(taskWorktreePath)
    const relativeToWorktree = path.relative(normalizedWorktreePath, normalizedInput)
    if (
      relativeToWorktree === '' ||
      (!relativeToWorktree.startsWith(`..${path.sep}`) &&
        relativeToWorktree !== '..' &&
        !path.isAbsolute(relativeToWorktree))
    ) {
      return normalizedInput
    }
  }

  const targets = likelyTargetCandidates(metadata)
  if (targets.length > 0) {
    if (targets.includes(normalizedInput)) return normalizedInput

    const preferredTarget = targets[0]!
    if (path.basename(preferredTarget) === path.basename(normalizedInput)) {
      return preferredTarget
    }

    const inputSuffix = anchoredSuffix(normalizedInput)
    const suffixMatch = targets.find((target) => anchoredSuffix(target) === inputSuffix)
    if (suffixMatch) return suffixMatch
  }

  const taskProjectPath = String(metadata['current_task_project_path'] ?? '').trim()
  if (taskProjectPath && taskWorktreePath) {
    const normalizedProjectPath = path.resolve(taskProjectPath)
    const normalizedWorktreePath = path.resolve(taskWorktreePath)
    const relativeToProject = path.relative(normalizedProjectPath, normalizedInput)
    if (
      relativeToProject &&
      relativeToProject !== '..' &&
      !relativeToProject.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeToProject)
    ) {
      return path.resolve(normalizedWorktreePath, relativeToProject)
    }
  }

  return normalizedInput
}

function resolveWriteFileInput(
  input: WriteFileInput,
  metadata: Record<string, unknown>,
  cwd?: string,
): { filePath: string; content: string; createDirectories?: boolean } | { error: string } {
  const recovered = recoverWriteFileAliases(input.item)
  const filePath = String(input.filePath ?? input.path ?? recovered?.filePath ?? '').trim()
  const content = String(
    input.content ??
    input.text ??
    input.body ??
    input.message ??
    recovered?.content ??
    '',
  )
  if (!filePath) {
    const suggestion = inferLikelyWriteFilePath(metadata)
    return {
      error: suggestion
        ? `Missing filePath. If you are creating the new test file, call write-file with { filePath: "${suggestion}", content: "..." }.`
        : 'Missing filePath. Call write-file with { filePath: "/absolute/or/cwd-relative/path", content: "full file contents" }.',
    }
  }
  if (!content.trim()) {
    return {
      error: `Missing content for ${filePath}. Call write-file with the full file text as { filePath: "${filePath}", content: "..." }.`,
    }
  }
  const reconciledPath = reconcileLikelyTargetFilePath(filePath, metadata, cwd)
  return {
    filePath: reconciledPath,
    content,
    ...(input.createDirectories !== undefined ? { createDirectories: input.createDirectories } : {}),
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
      path: { type: 'string', description: 'Alias for filePath used by near-miss model calls.' },
      text: { type: 'string', description: 'Alias for content used by near-miss model calls.' },
      body: { type: 'string', description: 'Alias for content used by near-miss model calls.' },
      message: { type: 'string', description: 'Alias for content used by near-miss model calls.' },
      item: { type: ['object', 'string'], description: 'Optional nested or stringified payload.' },
    },
    required: ['filePath', 'content'],
  },
  isReadOnly: () => false,
  execute: async (input, ctx) => {
    const resolved = resolveWriteFileInput(input, ctx.metadata, ctx.cwd)
    if ('error' in resolved) {
      return {
        output: `Error writing file: ${resolved.error}`,
        is_error: true,
        metadata: { success: false, path: '', error: resolved.error },
      }
    }
    const result = await writeFile(resolved, { cwd: ctx.cwd })
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
    return {
      success: false,
      replacements: 0,
      error: 'oldString must not be empty. Read the file, copy the exact existing text you want to replace, and pass it as oldString. If you intend to replace the entire file, use write-file instead.',
    }
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
      error: 'oldString was not found in the file. Re-read the file and use an exact substring from the current contents.',
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

  const leakedMarkupError = rejectLeakedModelControlMarkup(updated)
  if (leakedMarkupError) {
    return { success: false, replacements: 0, error: leakedMarkupError }
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
  execute: async (input, ctx) => {
    const reconciledInput: EditFileInput = {
      ...input,
      filePath: reconcileLikelyTargetFilePath(input.filePath, ctx.metadata, ctx.cwd),
    }
    const result = await editFile(reconciledInput)
    const output = result.success
      ? `Edited ${reconciledInput.filePath} (${result.replacements} replacement${result.replacements === 1 ? '' : 's'})`
      : `Error editing ${reconciledInput.filePath}: ${result.error ?? 'unknown'}`
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
