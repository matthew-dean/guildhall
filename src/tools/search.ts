/**
 * Filesystem search tools: glob + grep.
 *
 * Ported from:
 *   openharness/src/openharness/tools/glob_tool.py
 *   openharness/src/openharness/tools/grep_tool.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Python `asyncio.subprocess` → `node:child_process.spawn`; the timeout
 *     path uses `AbortController` / `process.kill()` instead of asyncio's
 *     `wait_for` + `terminate()`.
 *   - Sandbox/Docker integration is deferred — every upstream branch that
 *     reaches into `openharness.sandbox.session.get_docker_sandbox()` is
 *     replaced with a direct spawn against the local shell. A sandbox
 *     adapter will slot in here when that ships.
 *   - The grep tool's pure-Python fallback is replaced with a Node fallback
 *     that walks the given root with a recursive `fs.readdir` and applies
 *     the regex line-by-line. Same semantics, JS-native.
 *   - The glob tool's Python `Path.glob(...)` fallback is replaced with a
 *     Node fallback that uses `node:fs.glob` when available and falls back
 *     to a recursive walk otherwise; both skip the `node_modules`, `.git`,
 *     and `dist` dirs that would otherwise dominate a non-gitignored walk.
 *   - Timeout output uses a plain english string instead of a sentinel
 *     marker — the TS callers never parse the sentinel upstream did.
 */

import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_GREP_LIMIT = 200
const DEFAULT_GREP_TIMEOUT_SECONDS = 20
const DEFAULT_GLOB_LIMIT = 200

// ---------------------------------------------------------------------------
// rg detection
// ---------------------------------------------------------------------------

let rgBinaryCache: string | null | undefined
async function findRgBinary(): Promise<string | null> {
  if (rgBinaryCache !== undefined) return rgBinaryCache
  // Shell out to `which rg` once and cache. An absent rg is a normal
  // condition — the caller falls back to the Node walker.
  const result = await new Promise<string | null>((resolve) => {
    const child = spawn('sh', ['-c', 'command -v rg'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
    })
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      if (code === 0 && stdout.trim().length > 0) resolve(stdout.trim())
      else resolve(null)
    })
  })
  rgBinaryCache = result
  return result
}

export function __resetRgCacheForTests(override?: string | null): void {
  rgBinaryCache = override === undefined ? undefined : override
}

// ---------------------------------------------------------------------------
// Glob
// ---------------------------------------------------------------------------

const globInputSchema = z.object({
  pattern: z.string().describe('Glob pattern relative to the working directory'),
  root: z.string().optional().describe('Optional search root (absolute or cwd-relative)'),
  limit: z.number().int().min(1).max(5000).optional(),
})

export type GlobInput = z.input<typeof globInputSchema>
export interface GlobResult {
  matches: string[]
  truncated: boolean
}

function resolveSearchRoot(cwd: string, candidate: string | undefined): string {
  if (!candidate || candidate === '.') return path.resolve(cwd)
  const p = candidate.startsWith('~')
    ? path.join(process.env['HOME'] ?? '', candidate.slice(1))
    : candidate
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(cwd, p)
}

async function looksLikeGitRepo(root: string): Promise<boolean> {
  let current = root
  for (let i = 0; i < 6; i++) {
    try {
      const st = await fs.stat(path.join(current, '.git'))
      if (st.isDirectory() || st.isFile()) return true
    } catch {
      // Walk upward.
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return false
}

export async function runGlob(
  cwd: string,
  input: GlobInput,
): Promise<GlobResult> {
  const root = resolveSearchRoot(cwd, input.root)
  const limit = input.limit ?? DEFAULT_GLOB_LIMIT
  const rg = await findRgBinary()

  if (rg && (input.pattern.includes('**') || input.pattern.includes('/'))) {
    const includeHidden = await looksLikeGitRepo(root)
    const args = ['--files']
    if (includeHidden) args.push('--hidden')
    args.push('--glob', input.pattern, '.')
    const { lines, truncated } = await runSubprocess({
      bin: rg,
      args,
      cwd: root,
      limit,
      timeoutMs: DEFAULT_GREP_TIMEOUT_SECONDS * 1000,
    })
    lines.sort()
    return { matches: lines, truncated }
  }

  // Node fallback: recursive walk with gitignore-style skips.
  return nodeGlobFallback(root, input.pattern, limit)
}

async function nodeGlobFallback(
  root: string,
  pattern: string,
  limit: number,
): Promise<GlobResult> {
  const matcher = compileGlob(pattern)
  const matches: string[] = []
  const stack: string[] = [root]
  const skip = new Set(['node_modules', '.git', 'dist', '.venv', '__pycache__'])

  while (stack.length > 0 && matches.length < limit) {
    const dir = stack.pop()!
    let entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }>
    try {
      const raw = await fs.readdir(dir, { withFileTypes: true })
      entries = raw.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
      }))
    } catch {
      continue
    }
    for (const entry of entries) {
      if (matches.length >= limit) break
      if (entry.isDirectory) {
        if (skip.has(entry.name)) continue
        stack.push(path.join(dir, entry.name))
        continue
      }
      if (!entry.isFile) continue
      const full = path.join(dir, entry.name)
      const rel = path.relative(root, full)
      if (matcher(rel)) matches.push(rel)
    }
  }
  matches.sort()
  return { matches, truncated: matches.length >= limit }
}

/**
 * Tiny glob→regex compiler good enough for our fallback path. Supports:
 *   - `*`   any chars except `/`
 *   - `**`  any chars including `/`
 *   - `?`   single non-`/` char
 *   - `{a,b,c}` alternation
 *   - literal segments
 * This is intentionally not a full minimatch replica — real users shelling
 * out to rg get the real thing. This covers the common cases.
 */
function compileGlob(pattern: string): (rel: string) => boolean {
  let regex = ''
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]!
    if (c === '*' && pattern[i + 1] === '*') {
      regex += '.*'
      i += 2
      if (pattern[i] === '/') i += 1
      continue
    }
    if (c === '*') {
      regex += '[^/]*'
      i += 1
      continue
    }
    if (c === '?') {
      regex += '[^/]'
      i += 1
      continue
    }
    if (c === '{') {
      const close = pattern.indexOf('}', i)
      if (close !== -1) {
        const inner = pattern.slice(i + 1, close).split(',').map(escapeRegex).join('|')
        regex += `(?:${inner})`
        i = close + 1
        continue
      }
    }
    if (/[.+()|^$\\]/.test(c)) {
      regex += `\\${c}`
      i += 1
      continue
    }
    regex += c
    i += 1
  }
  const re = new RegExp(`^${regex}$`)
  return (rel: string) => re.test(rel.split(path.sep).join('/'))
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const globTool = defineTool({
  name: 'glob',
  description:
    'List files matching a glob pattern. Uses ripgrep when available (respects .gitignore); falls back to a Node walker that skips node_modules / .git / dist. Returns relative paths, sorted, capped by limit.',
  inputSchema: globInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern (e.g. "src/**/*.ts")' },
      root: {
        type: 'string',
        description: 'Optional search root (absolute or cwd-relative). Defaults to cwd.',
      },
      limit: { type: 'integer', description: 'Max matches to return (default 200).' },
    },
    required: ['pattern'],
  },
  isReadOnly: () => true,
  execute: async (input, ctx) => {
    const result = await runGlob(ctx.cwd, input)
    const output =
      result.matches.length === 0
        ? '(no matches)'
        : result.truncated
          ? `${result.matches.join('\n')}\n[truncated at ${result.matches.length} matches]`
          : result.matches.join('\n')
    return {
      output,
      is_error: false,
      metadata: { matches: result.matches, truncated: result.truncated },
    }
  },
})

// ---------------------------------------------------------------------------
// Grep
// ---------------------------------------------------------------------------

const grepInputSchema = z.object({
  pattern: z.string().describe('Regular expression to search for'),
  root: z.string().optional().describe('Search root directory (file or dir).'),
  fileGlob: z.string().optional().describe('Restrict to files matching this glob (e.g. "*.ts").'),
  caseSensitive: z.boolean().optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  timeoutSeconds: z.number().int().min(1).max(120).optional(),
})

export type GrepInput = z.input<typeof grepInputSchema>
export interface GrepResult {
  matches: string[]
  timedOut: boolean
  truncated: boolean
}

export async function runGrep(cwd: string, input: GrepInput): Promise<GrepResult> {
  const root = resolveSearchRoot(cwd, input.root)
  const caseSensitive = input.caseSensitive ?? true
  const limit = input.limit ?? DEFAULT_GREP_LIMIT
  const timeoutMs = (input.timeoutSeconds ?? DEFAULT_GREP_TIMEOUT_SECONDS) * 1000
  const rootStat = await fs.stat(root).catch(() => null)
  if (!rootStat) return { matches: [], timedOut: false, truncated: false }

  const rg = await findRgBinary()
  if (rg) {
    return rgGrep({
      rg,
      pattern: input.pattern,
      root,
      rootIsFile: rootStat.isFile(),
      fileGlob: input.fileGlob,
      caseSensitive,
      limit,
      timeoutMs,
    })
  }
  return nodeGrepFallback({
    pattern: input.pattern,
    root,
    rootIsFile: rootStat.isFile(),
    fileGlob: input.fileGlob,
    caseSensitive,
    limit,
  })
}

async function rgGrep(args: {
  rg: string
  pattern: string
  root: string
  rootIsFile: boolean
  fileGlob: string | undefined
  caseSensitive: boolean
  limit: number
  timeoutMs: number
}): Promise<GrepResult> {
  const { rg, pattern, root, rootIsFile, fileGlob, caseSensitive, limit, timeoutMs } = args
  const cmd: string[] = ['--no-heading', '--line-number', '--color', 'never']

  if (!rootIsFile) {
    const includeHidden =
      (await fs
        .stat(path.join(root, '.git'))
        .then(() => true)
        .catch(() => false)) ||
      (await fs
        .stat(path.join(root, '.gitignore'))
        .then(() => true)
        .catch(() => false))
    if (includeHidden) cmd.push('--hidden')
  }
  if (!caseSensitive) cmd.push('-i')
  if (fileGlob) cmd.push('--glob', fileGlob)
  cmd.push('--', pattern, rootIsFile ? path.basename(root) : '.')

  const spawnCwd = rootIsFile ? path.dirname(root) : root
  const { lines, timedOut, truncated } = await runSubprocess({
    bin: rg,
    args: cmd,
    cwd: spawnCwd,
    limit,
    timeoutMs,
  })

  if (rootIsFile) {
    const rel = path.relative(process.cwd(), root)
    const display = rel.length < root.length ? rel : root
    return {
      matches: lines.map((line) => `${display}:${line}`),
      timedOut,
      truncated,
    }
  }
  return { matches: lines, timedOut, truncated }
}

async function nodeGrepFallback(args: {
  pattern: string
  root: string
  rootIsFile: boolean
  fileGlob: string | undefined
  caseSensitive: boolean
  limit: number
}): Promise<GrepResult> {
  const { pattern, root, rootIsFile, fileGlob, caseSensitive, limit } = args
  const flags = caseSensitive ? 'g' : 'gi'
  let re: RegExp
  try {
    re = new RegExp(pattern, flags)
  } catch {
    return { matches: [], timedOut: false, truncated: false }
  }
  const globMatcher = fileGlob ? compileGlob(fileGlob) : null
  const matches: string[] = []

  const files: string[] = []
  if (rootIsFile) files.push(root)
  else {
    const stack: string[] = [root]
    const skip = new Set(['node_modules', '.git', 'dist', '.venv', '__pycache__'])
    while (stack.length > 0 && files.length < 10_000) {
      const dir = stack.pop()!
      let entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }>
      try {
        const raw = await fs.readdir(dir, { withFileTypes: true })
        entries = raw.map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
          isFile: e.isFile(),
        }))
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.isDirectory) {
          if (skip.has(entry.name)) continue
          stack.push(path.join(dir, entry.name))
        } else if (entry.isFile) {
          const full = path.join(dir, entry.name)
          const rel = path.relative(root, full)
          if (globMatcher && !globMatcher(rel)) continue
          files.push(full)
        }
      }
    }
  }

  for (const file of files) {
    if (matches.length >= limit) break
    let buf: Buffer
    try {
      buf = await fs.readFile(file)
    } catch {
      continue
    }
    if (buf.includes(0)) continue // skip binaries
    const text = buf.toString('utf-8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0
      if (re.test(lines[i]!)) {
        const display = rootIsFile ? path.relative(process.cwd(), file) : path.relative(root, file)
        matches.push(`${display}:${i + 1}:${lines[i]}`)
        if (matches.length >= limit) break
      }
    }
  }
  return { matches, timedOut: false, truncated: matches.length >= limit }
}

// ---------------------------------------------------------------------------
// Subprocess helper (shared by glob + grep)
// ---------------------------------------------------------------------------

async function runSubprocess(args: {
  bin: string
  args: string[]
  cwd: string
  limit: number
  timeoutMs: number
}): Promise<{ lines: string[]; timedOut: boolean; truncated: boolean }> {
  return new Promise((resolve) => {
    const lines: string[] = []
    let buf = ''
    let timedOut = false
    let truncated = false
    const child = spawn(args.bin, args.args, {
      cwd: args.cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, 500)
    }, args.timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      if (lines.length >= args.limit) {
        truncated = true
        child.kill('SIGTERM')
        return
      }
      buf += chunk.toString('utf-8')
      let newlineIdx = buf.indexOf('\n')
      while (newlineIdx !== -1) {
        const line = buf.slice(0, newlineIdx).trimEnd()
        buf = buf.slice(newlineIdx + 1)
        if (line.length > 0) {
          lines.push(line)
          if (lines.length >= args.limit) {
            truncated = true
            child.kill('SIGTERM')
            break
          }
        }
        newlineIdx = buf.indexOf('\n')
      }
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ lines, timedOut, truncated })
    })
    child.on('close', () => {
      clearTimeout(timer)
      if (buf.length > 0 && lines.length < args.limit) {
        const tail = buf.trimEnd()
        if (tail.length > 0) lines.push(tail)
      }
      resolve({ lines, timedOut, truncated })
    })
  })
}

export const grepTool = defineTool({
  name: 'grep',
  description:
    'Search text files for a regex pattern. Uses ripgrep when available; falls back to a Node walker. Returns `file:line:match` rows, capped by limit.',
  inputSchema: grepInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression.' },
      root: {
        type: 'string',
        description: 'Search root (file or directory, absolute or cwd-relative). Defaults to cwd.',
      },
      fileGlob: { type: 'string', description: 'Restrict to files matching this glob.' },
      caseSensitive: { type: 'boolean', description: 'Default true.' },
      limit: { type: 'integer', description: 'Max matches (default 200).' },
      timeoutSeconds: { type: 'integer', description: 'Subprocess timeout (default 20).' },
    },
    required: ['pattern'],
  },
  isReadOnly: () => true,
  execute: async (input, ctx) => {
    const result = await runGrep(ctx.cwd, input)
    const parts: string[] = []
    if (result.matches.length === 0 && !result.timedOut) {
      parts.push('(no matches)')
    } else {
      parts.push(result.matches.join('\n'))
    }
    if (result.truncated) {
      parts.push(`[truncated at ${result.matches.length} matches]`)
    }
    if (result.timedOut) {
      parts.push(`[grep timed out after ${input.timeoutSeconds ?? DEFAULT_GREP_TIMEOUT_SECONDS} seconds]`)
    }
    return {
      output: parts.join('\n'),
      is_error: result.timedOut,
      metadata: {
        matches: result.matches,
        truncated: result.truncated,
        timedOut: result.timedOut,
      },
    }
  },
})
