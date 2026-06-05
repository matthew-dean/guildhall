import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { getDataDir } from './paths.js'

export interface LocalHistoryHealth {
  projectRoot: string
  historyDir: string
  totalBytes: number
  fileCount: number
  oldestTranscriptPath: string | null
  oldestTranscriptMtimeMs: number | null
}

export interface ProjectStateMigrationResult {
  projectRoot: string
  sharedStateDir: string
  systemStateDir: string
  migrated: boolean
  movedEntries: string[]
}

const PROJECT_STATE_PLACEMENT_ENV = 'GUILDHALL_PROJECT_STATE_PLACEMENT'
const PROJECT_LOCAL_STATE_PLACEMENT = 'project'
const PROJECT_STATE_MANIFEST = 'project-state.json'
export const MIGRATED_PROJECT_STATE_ENTRIES = [
  'TASKS.json',
  'MEMORY.md',
  'DECISIONS.md',
  'PROGRESS.md',
  'GOALS.json',
  'workspace-goals.json',
  'learning.json',
  'memory-store.json',
  'project-skills.json',
  'attention.json',
  'codebase-map.yaml',
  'codebase-map.stale.json',
  'codebase-map.history.jsonl',
  'codebase-map',
  'tasks',
  'bounded-chat',
  'structural-map',
  'structural-domains.json',
  'project-graph',
  'external-agent-links.json',
  'external-agent-memory-bridge.json',
  'capability-requests.json',
  'capability-grants.json',
  'owner-input',
  'runtime',
  'events',
  'context-debug',
  'checkpoints',
] as const

function projectSlug(projectRoot: string): string {
  const resolved = resolve(projectRoot)
  const digest = createHash('sha1').update(resolved).digest('hex').slice(0, 12)
  return `${basename(resolved) || 'root'}-${digest}`
}

export function getProjectLocalHistoryDir(projectRoot: string): string {
  const dir = join(getDataDir(), 'projects', projectSlug(projectRoot))
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getProjectSharedStateDir(projectRoot: string): string {
  return join(resolve(projectRoot), '.guildhall')
}

export function getProjectSystemStateDir(projectRoot: string): string {
  const dir = join(getProjectLocalHistoryDir(projectRoot), 'state')
  mkdirSync(dir, { recursive: true })
  writeProjectStateManifestSync(dir, projectRoot)
  return dir
}

export function getProjectStateDir(projectRoot: string): string {
  if (process.env[PROJECT_STATE_PLACEMENT_ENV] === PROJECT_LOCAL_STATE_PLACEMENT) {
    return getProjectSharedStateDir(projectRoot)
  }
  return getProjectSystemStateDir(projectRoot)
}

export function inferProjectRootFromMemoryDir(memoryDir: string): string {
  const resolved = resolve(memoryDir)
  if (basename(resolved) === 'memory' || basename(resolved) === '.guildhall') return dirname(resolved)
  const manifest = readProjectStateManifestSync(resolved)
  return manifest?.projectRoot ?? resolved
}

export async function migrateProjectStateToSystem(projectRoot: string): Promise<ProjectStateMigrationResult> {
  const resolvedProjectRoot = resolve(projectRoot)
  const sharedStateDir = getProjectSharedStateDir(resolvedProjectRoot)
  const systemStateDir = getProjectSystemStateDir(resolvedProjectRoot)
  await fs.mkdir(systemStateDir, { recursive: true })
  await writeProjectStateManifest(systemStateDir, resolvedProjectRoot)

  const movedEntries: string[] = []
  for (const entry of MIGRATED_PROJECT_STATE_ENTRIES) {
    const source = join(sharedStateDir, entry)
    if (!existsSync(source)) continue
    const destination = join(systemStateDir, entry)
    await fs.mkdir(dirname(destination), { recursive: true })
    if (!existsSync(destination)) {
      await fs.cp(source, destination, { recursive: true, force: false, preserveTimestamps: true })
    } else if (await shouldReplaceExistingStateEntry(entry, source, destination)) {
      await fs.rm(destination, { recursive: true, force: true })
      await fs.cp(source, destination, { recursive: true, force: false, preserveTimestamps: true })
    } else if (!await stateEntriesEquivalent(source, destination)) {
      await preserveConflictingStateEntry(source, systemStateDir, entry)
    }
    await fs.rm(source, { recursive: true, force: true })
    movedEntries.push(entry)
  }

  return {
    projectRoot: resolvedProjectRoot,
    sharedStateDir,
    systemStateDir,
    migrated: movedEntries.length > 0,
    movedEntries,
  }
}

export function getProjectTranscriptPath(
  projectRoot: string,
  kind: 'exploring',
  taskId: string,
): string {
  return join(getProjectLocalHistoryDir(projectRoot), 'transcripts', kind, `${taskId}.md`)
}

export function getLegacyProjectTranscriptPath(
  memoryDir: string,
  kind: 'exploring',
  taskId: string,
): string {
  return join(memoryDir, kind, `${taskId}.md`)
}

export function getProjectRecentEventsPath(projectRoot: string): string {
  return join(getProjectLocalHistoryDir(projectRoot), 'events', 'recent-events.jsonl')
}

export function getProjectContextDebugLedgerPath(projectRoot: string): string {
  return join(getProjectLocalHistoryDir(projectRoot), 'context-debug', 'context-debug.jsonl')
}

export function getProjectContextDebugSnapshotDir(projectRoot: string, taskId: string): string {
  return join(getProjectLocalHistoryDir(projectRoot), 'context-debug', 'snapshots', taskId)
}

export function getProjectTaskLocalHistoryDir(projectRoot: string, taskId: string): string {
  return join(getProjectLocalHistoryDir(projectRoot), 'tasks', taskId)
}

export function getProjectProgressHeartbeatsPath(projectRoot: string): string {
  return join(getProjectLocalHistoryDir(projectRoot), 'progress', 'heartbeats.md')
}

export function getProjectRuntimeStatePath(projectRoot: string): string {
  return join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'state.json')
}

export function getProjectRuntimeCommandEvidencePath(projectRoot: string): string {
  return join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'command-evidence.jsonl')
}

export function getProjectRuntimeDevServersPath(projectRoot: string): string {
  return join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'dev-servers.json')
}

async function walkFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...await walkFiles(full))
      } else if (entry.isFile()) {
        files.push(full)
      }
    }
    return files
  } catch (err) {
    if (String(err).includes('ENOENT')) return []
    throw err
  }
}

export async function getProjectLocalHistoryHealth(
  projectRoot: string,
): Promise<LocalHistoryHealth> {
  const historyDir = getProjectLocalHistoryDir(projectRoot)
  const files = await walkFiles(historyDir)
  let totalBytes = 0
  let oldestTranscriptPath: string | null = null
  let oldestTranscriptMtimeMs: number | null = null
  const transcriptRoot = join(historyDir, 'transcripts')

  for (const file of files) {
    const stat = await fs.stat(file)
    totalBytes += stat.size
    if (file.startsWith(transcriptRoot) && (oldestTranscriptMtimeMs === null || stat.mtimeMs < oldestTranscriptMtimeMs)) {
      oldestTranscriptPath = file
      oldestTranscriptMtimeMs = stat.mtimeMs
    }
  }

  return {
    projectRoot: resolve(projectRoot),
    historyDir,
    totalBytes,
    fileCount: files.length,
    oldestTranscriptPath,
    oldestTranscriptMtimeMs,
  }
}

export function localHistoryExists(projectRoot: string): boolean {
  return existsSync(getProjectLocalHistoryDir(projectRoot))
}

async function shouldReplaceExistingStateEntry(
  entry: string,
  source: string,
  destination: string,
): Promise<boolean> {
  const [sourceStat, destinationStat] = await Promise.all([fs.stat(source), fs.stat(destination)])
  if (!sourceStat.isFile() || !destinationStat.isFile()) return false
  if (entry === 'TASKS.json') {
    return await isEmptyTaskQueue(destination)
  }
  if (['MEMORY.md', 'DECISIONS.md', 'PROGRESS.md'].includes(entry)) {
    const destinationText = await fs.readFile(destination, 'utf8').catch(() => '')
    return /_Updated by GuildHall agents\.|_Progress log maintained by GuildHall agents\.|_Architecture decisions recorded by GuildHall agents\./.test(destinationText)
      && sourceStat.size > destinationStat.size
  }
  return false
}

async function isEmptyTaskQueue(file: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown
    if (Array.isArray(parsed)) return parsed.length === 0
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { tasks?: unknown }).tasks)) {
      return ((parsed as { tasks: unknown[] }).tasks).length === 0
    }
  } catch {
    return false
  }
  return false
}

async function stateEntriesEquivalent(source: string, destination: string): Promise<boolean> {
  const [sourceStat, destinationStat] = await Promise.all([fs.stat(source), fs.stat(destination)])
  if (sourceStat.isFile() && destinationStat.isFile()) {
    if (sourceStat.size !== destinationStat.size) return false
    return await fs.readFile(source, 'utf8').catch(() => null) === await fs.readFile(destination, 'utf8').catch(() => undefined)
  }
  if (sourceStat.isDirectory() && destinationStat.isDirectory()) return false
  return false
}

async function preserveConflictingStateEntry(source: string, systemStateDir: string, entry: string): Promise<void> {
  const conflictName = `${entry.replace(/[\\/]/g, '__')}.migration-conflict-${Date.now()}`
  const conflictPath = join(systemStateDir, conflictName)
  await fs.cp(source, conflictPath, { recursive: true, force: false, preserveTimestamps: true })
}

async function writeProjectStateManifest(stateDir: string, projectRoot: string): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true })
  await fs.writeFile(
    join(stateDir, PROJECT_STATE_MANIFEST),
    `${JSON.stringify({
      version: 1,
      projectRoot: resolve(projectRoot),
      storage: 'system',
      sharedStateDir: getProjectSharedStateDir(projectRoot),
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    'utf8',
  )
}

function writeProjectStateManifestSync(stateDir: string, projectRoot: string): void {
  const file = join(stateDir, PROJECT_STATE_MANIFEST)
  if (existsSync(file)) return
  try {
    mkdirSync(stateDir, { recursive: true })
    const payload = {
      version: 1,
      projectRoot: resolve(projectRoot),
      storage: 'system',
      sharedStateDir: getProjectSharedStateDir(projectRoot),
      updatedAt: new Date().toISOString(),
    }
    // Synchronous path helpers are already eager; keep this manifest tiny.
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  } catch {
    // Path helpers should not make read-only probes fail.
  }
}

function readProjectStateManifestSync(stateDir: string): { projectRoot: string } | null {
  try {
    const raw = readFileSync(join(stateDir, PROJECT_STATE_MANIFEST), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { projectRoot?: unknown }).projectRoot === 'string') {
      return { projectRoot: (parsed as { projectRoot: string }).projectRoot }
    }
  } catch {
    return null
  }
  return null
}
