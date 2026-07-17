import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import {
  getProjectContextDebugLedgerPath,
  getProjectContextDebugSnapshotDir,
  getProjectLocalHistoryDir,
  getProjectRecentEventsPath,
  getProjectStateDir,
  getProjectTaskLocalHistoryDir,
  getProjectTranscriptPath,
} from '@guildhall/sessions'
import {
  applyGuildhallGitignorePolicy,
  LOCAL_PROJECT_STATE_GITIGNORE_ENTRIES,
  readWorkspaceConfig,
  type WorkspaceYamlConfig,
} from '@guildhall/config'
import { compactProjectState, type ProjectStateCompactionResult } from './project-state-compaction.js'
import { finalizeThinProjectStateManifest } from './thin-project-state-manifest.js'
import { compactExploringTranscripts, type ExploringHistoryCompactionResult } from '../tools/exploring-transcript.js'

const execFileP = promisify(execFile)

export interface MemoryMigrationCopy {
  source: string
  destination: string
}

export interface MemoryMigrationOptions {
  projectRoot: string
  dryRun?: boolean
  deleteSource?: boolean
  updateGitignore?: boolean
}

export interface MemoryMigrationResult {
  projectRoot: string
  memoryDir: string
  localHistoryDir: string
  dryRun: boolean
  filesToCopy: MemoryMigrationCopy[]
  copied: number
  deleted: number
  gitignoreUpdated: boolean
  gitignoreRoots: string[]
  untrackedIgnoredFiles: string[]
  compaction: ProjectStateCompactionResult | null
  transcriptCompaction: ExploringHistoryCompactionResult | null
}

const LEGACY_MEMORY_GITIGNORE_PATTERNS = new Set([
  '/memory/exploring/',
  '/memory/transcripts/',
  '/memory/sessions/',
  '/memory/events.ndjson',
  '/memory/recent-events.jsonl',
  'memory/exploring/',
  'memory/transcripts/',
  'memory/sessions/',
  'memory/events.ndjson',
  'memory/recent-events.jsonl',
])

const PROJECT_STATE_FILES = new Set([
  'TASKS.json',
  'MEMORY.md',
  'DECISIONS.md',
  'PROGRESS.md',
  'agent-settings.yaml',
  'agent-overrides.yaml',
  'learning.json',
  'project-skills.json',
  'business-envelope.yaml',
  'workspace-goals.json',
  'wizards.yaml',
  'design-system.yaml',
  'codebase-map.yaml',
  'artifacts.yaml',
  'codebase-map.overrides.yaml',
  'codebase-map.stale.json',
  'project-brief.md',
  'guilds.yaml',
])

const PROJECT_STATE_DIRS = new Set([
  'skills',
  'engineering-defaults',
  'pressure-test-intake',
])

const LOCAL_HISTORY_FILES = new Set([
  'events.ndjson',
  'recent-events.jsonl',
  'context-debug.jsonl',
  'codebase-map.history.jsonl',
  'bootstrap.json',
  '.session-epoch',
  'stop-requested',
  'stop-requested.json',
  'self-critique.md',
  'verification-results.json',
  'build-proof.md',
])

const LOCAL_HISTORY_PREFIXES = [
  'verification-proof',
  'task-',
]

async function fileExists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file)
    return stat.isFile()
  } catch {
    return false
  }
}

async function dirExists(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir)
    return stat.isDirectory()
  } catch {
    return false
  }
}

async function walkFiles(dir: string): Promise<string[]> {
  if (!await dirExists(dir)) return []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walkFiles(full))
    } else if (entry.isFile()) {
      files.push(full)
    }
  }
  return files
}

async function planCopies(projectRoot: string): Promise<MemoryMigrationCopy[]> {
  const memoryDir = path.join(projectRoot, 'memory')
  const localHistoryDir = getProjectLocalHistoryDir(projectRoot)
  const projectStateDir = getProjectStateDir(projectRoot)
  const copies: MemoryMigrationCopy[] = []
  const planned = new Set<string>()

  function add(source: string, destination: string): void {
    if (planned.has(source)) return
    planned.add(source)
    copies.push({ source, destination })
  }

  for (const source of await walkFiles(path.join(memoryDir, 'exploring'))) {
    const taskId = path.basename(source).replace(/\.md$/i, '')
    add(source, getProjectTranscriptPath(projectRoot, 'exploring', taskId))
  }

  const legacyTaskTranscriptRoot = path.join(memoryDir, 'transcripts')
  for (const source of await walkFiles(legacyTaskTranscriptRoot)) {
    add(
      source,
      path.join(
        localHistoryDir,
        'transcripts',
        'tasks',
        path.relative(legacyTaskTranscriptRoot, source),
      ),
    )
  }

  const legacySessionsRoot = path.join(memoryDir, 'sessions')
  for (const source of await walkFiles(legacySessionsRoot)) {
    add(
      source,
      path.join(
        localHistoryDir,
        'legacy-sessions',
        path.relative(legacySessionsRoot, source),
      ),
    )
  }

  const legacyEvents = path.join(memoryDir, 'events.ndjson')
  if (await fileExists(legacyEvents)) {
    add(legacyEvents, path.join(localHistoryDir, 'events', 'events.ndjson'))
  }

  const legacyRecentEvents = path.join(memoryDir, 'recent-events.jsonl')
  if (await fileExists(legacyRecentEvents)) {
    add(legacyRecentEvents, getProjectRecentEventsPath(projectRoot))
  }

  const allFiles = await walkFiles(memoryDir)
  for (const source of allFiles) {
    const rel = path.relative(memoryDir, source)
    const parts = rel.split(path.sep)
    const top = parts[0] ?? rel

    if (planned.has(source)) continue

    if (rel === 'context-debug.jsonl') {
      add(source, getProjectContextDebugLedgerPath(projectRoot))
      continue
    }
    if (top === 'context-debug') {
      add(source, path.join(getProjectContextDebugSnapshotDir(projectRoot, parts[1] ?? 'unknown'), ...parts.slice(2)))
      continue
    }
    if (top === 'tasks') {
      const taskId = parts[1] ?? 'unknown'
      add(source, path.join(getProjectTaskLocalHistoryDir(projectRoot, taskId), ...parts.slice(2)))
      continue
    }
    if (PROJECT_STATE_FILES.has(rel) || PROJECT_STATE_DIRS.has(top)) {
      add(source, path.join(projectStateDir, rel))
      continue
    }
    if (
      LOCAL_HISTORY_FILES.has(rel) ||
      LOCAL_HISTORY_PREFIXES.some(prefix => path.basename(rel).startsWith(prefix))
    ) {
      add(source, path.join(localHistoryDir, rel))
      continue
    }
    if (rel.endsWith('.jsonl') || rel.endsWith('.log')) {
      add(source, path.join(localHistoryDir, rel))
      continue
    }
    add(source, path.join(localHistoryDir, 'legacy-memory', rel))
  }

  return copies
}

async function copyFilePlanned(item: MemoryMigrationCopy): Promise<void> {
  await fs.mkdir(path.dirname(item.destination), { recursive: true })
  if (existsSync(item.destination)) return
  await fs.copyFile(item.source, item.destination)
}

async function removeEmptyDirUpTo(dir: string, stopAt: string): Promise<void> {
  let current = dir
  const stop = path.resolve(stopAt)
  while (path.resolve(current).startsWith(stop) && path.resolve(current) !== stop) {
    try {
      await fs.rmdir(current)
    } catch {
      return
    }
    current = path.dirname(current)
  }
}

async function updateGitignore(projectRoot: string): Promise<boolean> {
  const file = path.join(projectRoot, '.gitignore')
  let existing = ''
  try {
    existing = await fs.readFile(file, 'utf8')
  } catch (err) {
    if (!String(err).includes('ENOENT')) throw err
  }
  const lines = existing
    .split(/\r?\n/)
    .filter(line => !LEGACY_MEMORY_GITIGNORE_PATTERNS.has(line.trim()))
  const removedLegacy = lines.length !== existing.split(/\r?\n/).length
  const withoutLegacy = lines.join('\n')
  const next = applyGuildhallGitignorePolicy(withoutLegacy)
  if (next === existing && !removedLegacy) return false
  await fs.writeFile(file, next, 'utf8')
  return true
}

function expandHome(input: string): string {
  if (input === '~') return process.env.HOME ?? input
  if (input.startsWith('~/')) return path.join(process.env.HOME ?? '~', input.slice(2))
  return input
}

function workspaceBaseProjectPath(workspaceRoot: string, config: WorkspaceYamlConfig): string {
  const raw = config.projectPath?.trim()
  if (!raw) return workspaceRoot
  const expanded = expandHome(raw)
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(workspaceRoot, expanded)
}

function repoStateMode(projectRoot: string): 'off' | 'thin' {
  try {
    return readWorkspaceConfig(projectRoot).storage?.repoState === 'thin' ? 'thin' : 'off'
  } catch {
    return 'off'
  }
}

function findContainingGitRoot(startDir: string, stopAt: string): string | null {
  let current = path.resolve(startDir)
  const stop = path.resolve(stopAt)
  while (current.startsWith(stop)) {
    if (existsSync(path.join(current, '.git'))) return current
    if (current === stop) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

function gitignoreRootsForProjectOrWorkspace(projectRoot: string): string[] {
  const root = path.resolve(projectRoot)
  let config: WorkspaceYamlConfig | null = null
  try {
    config = readWorkspaceConfig(root)
  } catch {
    config = null
  }

  if (config?.kind !== 'workspace' || config.projects.length === 0) {
    return [root]
  }

  const base = workspaceBaseProjectPath(root, config)
  const roots = new Set<string>()
  const workspaceGitRoot = findContainingGitRoot(root, root)
  if (workspaceGitRoot) roots.add(workspaceGitRoot)

  for (const project of config.projects) {
    const projectPath = path.isAbsolute(project.path)
      ? path.resolve(project.path)
      : path.resolve(base, project.path)
    const gitRoot = findContainingGitRoot(projectPath, root) ?? projectPath
    roots.add(gitRoot)
  }

  return [...roots]
}

async function updateGitignores(projectRoot: string): Promise<string[]> {
  const updated: string[] = []
  for (const root of gitignoreRootsForProjectOrWorkspace(projectRoot)) {
    if (await updateGitignore(root)) updated.push(root)
  }
  return updated
}

async function listTrackedIgnoredFiles(gitRoot: string): Promise<string[]> {
  if (!existsSync(path.join(gitRoot, '.git'))) return []
  try {
    const { stdout } = await execFileP(
      'git',
      ['ls-files', '-ci', '--exclude-standard', '-z'],
      { cwd: gitRoot, maxBuffer: 1024 * 1024 * 10 },
    )
    return stdout
      .split('\0')
      .map(file => file.trim())
      .filter(Boolean)
      .filter(isGuildhallLocalIgnoredFile)
  } catch {
    return []
  }
}

function isGuildhallLocalIgnoredFile(file: string): boolean {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '')
  return LOCAL_PROJECT_STATE_GITIGNORE_ENTRIES
    .filter(entry => !entry.startsWith('#'))
    .some((entry) => {
      const pattern = entry.replace(/\\/g, '/').replace(/^\.\//, '')
      return pattern.endsWith('/')
        ? normalized.startsWith(pattern)
        : normalized === pattern
    })
}

async function stopTrackingIgnoredFiles(gitRoots: string[]): Promise<string[]> {
  const untracked: string[] = []
  for (const gitRoot of gitRoots) {
    const files = await listTrackedIgnoredFiles(gitRoot)
    if (files.length === 0) continue
    await execFileP(
      'git',
      ['rm', '--cached', '--ignore-unmatch', '--', ...files],
      { cwd: gitRoot, maxBuffer: 1024 * 1024 * 10 },
    )
    untracked.push(...files)
  }
  return untracked
}

export async function migrateLegacyMemoryToLocalHistory(
  opts: MemoryMigrationOptions,
): Promise<MemoryMigrationResult> {
  const projectRoot = path.resolve(opts.projectRoot)
  const memoryDir = path.join(projectRoot, 'memory')
  const localHistoryDir = getProjectLocalHistoryDir(projectRoot)
  const dryRun = opts.dryRun ?? true
  const filesToCopy = await planCopies(projectRoot)

  let copied = 0
  let deleted = 0
  let gitignoreRoots: string[] = []
  let untrackedIgnoredFiles: string[] = []
  let compaction: ProjectStateCompactionResult | null = null
  let transcriptCompaction: ExploringHistoryCompactionResult | null = null

  if (!dryRun) {
    for (const item of filesToCopy) {
      await copyFilePlanned(item)
      copied += 1
    }
    if (opts.deleteSource) {
      for (const item of filesToCopy) {
        await fs.rm(item.source, { force: true })
        deleted += 1
        await removeEmptyDirUpTo(path.dirname(item.source), memoryDir)
      }
      await fs.rm(memoryDir, { recursive: true, force: true })
    }
    if (opts.updateGitignore) {
      gitignoreRoots = await updateGitignores(projectRoot)
      untrackedIgnoredFiles = await stopTrackingIgnoredFiles(gitignoreRoots)
    }
    transcriptCompaction = await compactExploringTranscripts({ projectRoot, dryRun: false })
    compaction = await compactProjectState({ projectRoot, dryRun: false })
    if (repoStateMode(projectRoot) === 'thin') {
      await finalizeThinProjectStateManifest(projectRoot)
    }
  }

  return {
    projectRoot,
    memoryDir,
    localHistoryDir,
    dryRun,
    filesToCopy,
    copied,
    deleted,
    gitignoreUpdated: gitignoreRoots.length > 0,
    gitignoreRoots,
    untrackedIgnoredFiles,
    compaction,
    transcriptCompaction,
  }
}
