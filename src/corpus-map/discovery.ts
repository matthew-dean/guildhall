import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CorpusFileEntry, CorpusFileKind } from './types.js'

const execFileP = promisify(execFile)

const EXCLUDED_DIRS = new Set([
  '.git',
  '.guildhall',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.svelte-kit',
  '.vite',
])

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.svelte',
  '.vue',
  '.md',
  '.mdx',
  '.json',
  '.yaml',
  '.yml',
  '.css',
  '.scss',
  '.html',
])

export function normalizeRelativePath(projectRoot: string, filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const absolute = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(projectRoot, filePath)
  const relative = path.relative(path.resolve(projectRoot), absolute).replace(/\\/g, '/')
  return relative && !relative.startsWith('..') ? relative : normalized.replace(/^\.\//, '')
}

export async function discoverProjectFiles(projectRoot: string): Promise<string[]> {
  const root = path.resolve(projectRoot)
  try {
    const { stdout } = await execFileP(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: root, encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 },
    )
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter(shouldIndexPath)
      .sort()
  } catch {
    const out: string[] = []
    await walk(root, root, out)
    return out.sort()
  }
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue
    const absolute = path.join(dir, entry.name)
    const relative = path.relative(root, absolute).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      await walk(root, absolute, out)
    } else if (entry.isFile() && shouldIndexPath(relative)) {
      out.push(relative)
    }
  }
}

export function shouldIndexPath(relativePath: string): boolean {
  const segments = relativePath.split('/')
  if (segments.some((segment) => EXCLUDED_DIRS.has(segment))) return false
  if (segments.some((segment) => looksLikeShellCommandSegment(segment))) return false
  if (relativePath.includes('__snapshots__/')) return false
  if (/\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|tar|gz|map|lockb)$/i.test(relativePath)) return false
  const basename = path.basename(relativePath)
  if (basename.startsWith('.env')) return false
  if (relativePath.startsWith('.guildhall/local/') || relativePath.startsWith('.guildhall/worktrees/')) return false
  if (
    relativePath.startsWith('.guildhall/') &&
    !/^\.guildhall\/(MEMORY|DECISIONS|PROGRESS)\.md$/.test(relativePath) &&
    relativePath !== '.guildhall/design-system.yaml'
  ) return false
  const ext = path.extname(relativePath).toLowerCase()
  return TEXT_EXTENSIONS.has(ext) || isManifest(relativePath) || basename === 'AGENTS.md' || basename.startsWith('README')
}

function looksLikeShellCommandSegment(segment: string): boolean {
  return /\s(?:--|&&|\|\||\|)\s|\b(?:pnpm|npm|yarn|bun|node|npx)\s/.test(segment)
}

export async function indexFile(projectRoot: string, relativePath: string): Promise<CorpusFileEntry | null> {
  const absolute = path.join(projectRoot, relativePath)
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(absolute)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  if (!stat.isFile()) return null
  const content = await fs.readFile(absolute, 'utf-8')
  const language = languageForPath(relativePath)
  return {
    path: relativePath,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    sha256: createHash('sha256').update(content).digest('hex'),
    language,
    kind: kindForPath(relativePath),
    areaIds: areaIdsForPath(relativePath),
    symbols: extractSymbols(relativePath, content),
    imports: extractImports(content),
    summary: summarizeFile(relativePath, content),
  }
}

export function isManifest(relativePath: string): boolean {
  const basename = path.basename(relativePath)
  return (
    basename === 'package.json' ||
    basename === 'pnpm-workspace.yaml' ||
    basename === 'tsconfig.json' ||
    basename === 'vite.config.ts' ||
    basename === 'svelte.config.js' ||
    basename === 'guildhall.yaml'
  )
}

export function requiresFullRefresh(touchedFiles: readonly string[]): boolean {
  if (touchedFiles.length === 0) return true
  if (touchedFiles.length > 100) return true
  return touchedFiles.some((file) => {
    const normalized = file.replace(/\\/g, '/')
    const basename = path.basename(normalized)
    return (
      isManifest(normalized) ||
      basename === '.gitignore' ||
      basename === 'AGENTS.md' ||
      normalized === '.guildhall/design-system.yaml' ||
      /(?:^|\/)(package-lock|pnpm-lock|yarn.lock|bun.lockb)$/.test(normalized) ||
      /(?:^|\/)(vite|svelte|vue|react|tsconfig|eslint|prettier)\.config\./.test(normalized)
    )
  })
}

function languageForPath(relativePath: string): string {
  const ext = path.extname(relativePath).toLowerCase()
  if (relativePath.endsWith('package.json')) return 'json'
  if (ext === '.ts' || ext === '.tsx') return 'typescript'
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript'
  if (ext === '.svelte') return 'svelte'
  if (ext === '.vue') return 'vue'
  if (ext === '.md' || ext === '.mdx') return 'markdown'
  if (ext === '.yaml' || ext === '.yml') return 'yaml'
  if (ext === '.css' || ext === '.scss') return 'css'
  if (ext === '.json') return 'json'
  return 'text'
}

function kindForPath(relativePath: string): CorpusFileKind {
  if (isManifest(relativePath)) return 'manifest'
  if (/(^|\/)(__tests__|tests?)\//.test(relativePath) || /\.(test|spec)\.[tj]sx?$/.test(relativePath)) return 'test'
  if (/\.(md|mdx)$/i.test(relativePath) || path.basename(relativePath) === 'AGENTS.md') return 'doc'
  if (/\.(css|scss)$/i.test(relativePath)) return 'style'
  if (/\.(json|ya?ml)$/i.test(relativePath)) return 'config'
  if (/\.(ts|tsx|js|jsx|mjs|cjs|svelte|vue)$/i.test(relativePath)) return 'source'
  return 'unknown'
}

function areaIdsForPath(relativePath: string): string[] {
  const normalized = relativePath.replace(/\\/g, '/')
  if (normalized.startsWith('src/web/') || normalized.startsWith('packages/ui/')) return ['web-ui']
  if (normalized.startsWith('src/runtime/')) return ['runtime']
  if (normalized.startsWith('src/agents/')) return ['agents']
  if (normalized.startsWith('src/core/')) return ['core']
  if (normalized.startsWith('src/config/')) return ['config']
  if (normalized.startsWith('src/tools/')) return ['tools']
  if (normalized.startsWith('src/corpus-map/')) return ['corpus-map']
  if (normalized.startsWith('docs/')) return ['docs']
  if (normalized.includes('/__tests__/') || /\.(test|spec)\.[tj]sx?$/.test(normalized)) return ['tests']
  return ['project']
}

function extractSymbols(relativePath: string, content: string): string[] {
  const symbols = new Set<string>()
  for (const match of content.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z0-9_]+)/g)) {
    if (match[1]) symbols.add(match[1])
  }
  for (const match of content.matchAll(/\bexport\s*\{\s*([^}]+)\s*\}/g)) {
    for (const part of (match[1] ?? '').split(',')) {
      const symbol = part.trim().split(/\s+as\s+/i).at(-1)?.trim()
      if (symbol && /^[A-Za-z0-9_]+$/.test(symbol)) symbols.add(symbol)
    }
  }
  if (relativePath.endsWith('.svelte') || relativePath.endsWith('.vue')) {
    symbols.add(path.basename(relativePath).replace(/\.(svelte|vue)$/i, ''))
  }
  return [...symbols].sort()
}

function extractImports(content: string): string[] {
  const imports = new Set<string>()
  for (const match of content.matchAll(/\bimport\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g)) {
    if (match[1]) imports.add(match[1])
  }
  for (const match of content.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    if (match[1]) imports.add(match[1])
  }
  return [...imports].sort().slice(0, 30)
}

function summarizeFile(relativePath: string, content: string): string {
  const basename = path.basename(relativePath)
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (heading) return `${basename}: ${heading}`
  if (basename === 'package.json') return 'Package manifest, scripts, dependencies, and package metadata.'
  if (basename === 'AGENTS.md') return 'Agent-facing repository instructions and local workflow guardrails.'
  const symbols = extractSymbols(relativePath, content)
  if (symbols.length > 0) return `${basename}: exports ${symbols.slice(0, 5).join(', ')}.`
  return `${basename}: ${kindForPath(relativePath)} file in ${areaIdsForPath(relativePath).join(', ')}.`
}
