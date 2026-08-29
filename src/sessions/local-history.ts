import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'

import { getDataDir } from './paths.js'
import { atomicWriteText } from './atomic.js'
import {
  getProjectCacheManifestPath,
  registerProjectCacheWorkspace,
} from './project-cache-registry.js'

/** Heartbeats are operational liveness, not durable project memory. */
export const PROJECT_HEARTBEAT_HISTORY_MAX_BYTES = 256 * 1024
export const PROJECT_HEARTBEAT_HISTORY_MAX_RECORDS = 512

export interface ProjectHeartbeatCompactionResult {
  bytesBefore: number
  bytesAfter: number
  recordsBefore: number
  recordsAfter: number
  compacted: boolean
}

function heartbeatBlocks(content: string): string[] {
  return content
    .replace(/\r\n/g, '\n')
    .split(/\n(?=###\s+)/)
    .map(block => block.trim())
    .filter(Boolean)
}

function boundedHeartbeatContent(content: string): string {
  const kept = heartbeatBlocks(content).slice(-PROJECT_HEARTBEAT_HISTORY_MAX_RECORDS)
  while (
    kept.length > 1 &&
    Buffer.byteLength(`${kept.join('\n\n')}\n`, 'utf8') > PROJECT_HEARTBEAT_HISTORY_MAX_BYTES
  ) {
    kept.shift()
  }
  if (
    kept.length === 1 &&
    Buffer.byteLength(kept[0]!, 'utf8') + 1 > PROJECT_HEARTBEAT_HISTORY_MAX_BYTES
  ) {
    kept[0] = Buffer.from(kept[0]!, 'utf8')
      .subarray(0, PROJECT_HEARTBEAT_HISTORY_MAX_BYTES - 1)
      .toString('utf8')
  }
  return kept.length > 0 ? `${kept.join('\n\n')}\n` : ''
}

/** Append one heartbeat without allowing the operational stream to grow forever. */
export async function appendProjectProgressHeartbeat(filePath: string, block: string): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true })
  let existing = ''
  try {
    existing = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  atomicWriteText(filePath, boundedHeartbeatContent(`${existing}\n${block}`))
}

/** Apply the same ring policy to history written by older Guildhall versions. */
export async function compactProjectProgressHeartbeats(
  filePath: string,
  options: { dryRun?: boolean } = {},
): Promise<ProjectHeartbeatCompactionResult> {
  let existing = ''
  try {
    existing = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { bytesBefore: 0, bytesAfter: 0, recordsBefore: 0, recordsAfter: 0, compacted: false }
    }
    throw error
  }
  const next = boundedHeartbeatContent(existing)
  const recordsBefore = heartbeatBlocks(existing).length
  const recordsAfter = heartbeatBlocks(next).length
  const result = {
    bytesBefore: Buffer.byteLength(existing, 'utf8'),
    bytesAfter: Buffer.byteLength(next, 'utf8'),
    recordsBefore,
    recordsAfter,
    compacted: next !== existing,
  }
  if (result.compacted && options.dryRun !== true) atomicWriteText(filePath, next)
  return result
}

export interface LocalHistoryHealth {
  projectRoot: string
  historyDir: string
  totalBytes: number
  fileCount: number
  oldestTranscriptPath: string | null
  oldestTranscriptMtimeMs: number | null
}

function projectSlug(projectRoot: string): string {
  const resolved = resolve(projectRoot)
  const digest = createHash('sha1').update(resolved).digest('hex').slice(0, 12)
  return `${basename(resolved) || 'root'}-${digest}`
}

export function isEphemeralProjectRoot(projectRoot: string): boolean {
  const root = resolve(projectRoot)
  const temporaryRoot = resolve(tmpdir())
  if (!isAbsolute(root) || !isAbsolute(temporaryRoot)) return false
  const distance = relative(temporaryRoot, root)
  return distance === '' || (!distance.startsWith(`..${pathSeparator}`) && distance !== '..')
}

const pathSeparator = process.platform === 'win32' ? '\\' : '/'

function projectHistoryRoot(projectRoot: string): string {
  // Explicit data dirs are used by tests, containers, and callers that want
  // deterministic placement. Never promote a temporary fixture or benchmark
  // project into the user's durable default cache, even if a parent process
  // leaked GUILDHALL_DATA_DIR into the child environment.
  const configuredDataDir = process.env.GUILDHALL_DATA_DIR
  const defaultDataDir = join(homedir(), '.guildhall', 'data')
  if (
    isEphemeralProjectRoot(projectRoot) &&
    (!configuredDataDir || resolve(configuredDataDir) === resolve(defaultDataDir))
  ) {
    return join(tmpdir(), 'guildhall-projects')
  }
  if (configuredDataDir && configuredDataDir.length > 0) return join(configuredDataDir, 'projects')
  if (isEphemeralProjectRoot(projectRoot)) return join(tmpdir(), 'guildhall-projects')
  return join(getDataDir(), 'projects')
}

export function getProjectLocalHistoryDir(projectRoot: string): string {
  return join(projectHistoryRoot(projectRoot), projectSlug(projectRoot))
}

/** Allocate a project history root at an explicit write boundary. */
export function ensureProjectLocalHistoryDir(projectRoot: string): string {
  const dir = getProjectLocalHistoryDir(projectRoot)
  // Allocate provenance before the first durable directory write. Temporary
  // projects use an intentionally separate, non-durable root and must not
  // enter the user's project-cache registry.
  const durableCache = !isEphemeralProjectRoot(projectRoot)
  if (durableCache && (!existsSync(dir) || !existsSync(getProjectCacheManifestPath(projectRoot)))) {
    registerProjectCacheWorkspace(projectRoot)
  }
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getProjectStateDir(projectRoot: string): string {
  return join(resolve(projectRoot), '.guildhall')
}

export function getLegacyProjectStatePath(projectRoot: string, relativePath: string): string {
  return join(getProjectStateDir(projectRoot), relativePath)
}

export function getProjectSystemStateDir(projectRoot: string): string {
  return join(getProjectLocalHistoryDir(projectRoot), 'project-state')
}

export function getProjectSystemStatePath(projectRoot: string, relativePath: string): string {
  return join(getProjectSystemStateDir(projectRoot), relativePath)
}

/**
 * Resolve the workspace that owns a system-state handle. A task may execute
 * inside a nested repository, but its TASKS handle belongs to the registered
 * workspace and all task evidence must stay with that workspace.
 */
export function inferProjectRootFromSystemStatePath(
  systemStatePath: string,
  fallbackProjectRoot?: string,
): string {
  const stateDir = dirname(resolve(systemStatePath))
  if (basename(stateDir) === 'project-state') {
    try {
      const manifest = JSON.parse(readFileSync(join(dirname(stateDir), 'allocation-manifest.json'), 'utf8')) as {
        workspaceRoot?: unknown
      }
      if (typeof manifest.workspaceRoot === 'string' && isAbsolute(manifest.workspaceRoot)) {
        return resolve(manifest.workspaceRoot)
      }
    } catch {
      // Older state handles predate allocation manifests; use their supplied
      // compatibility root below rather than guessing from the cache path.
    }
  }
  if (fallbackProjectRoot && isAbsolute(fallbackProjectRoot)) return resolve(fallbackProjectRoot)
  return inferProjectRootFromMemoryDir(stateDir)
}

export function inferProjectRootFromMemoryDir(memoryDir: string): string {
  const resolved = resolve(memoryDir)
  return basename(resolved) === 'memory' || basename(resolved) === '.guildhall' ? dirname(resolved) : resolved
}

export function getProjectSystemStatePathFromMemoryDir(memoryDir: string, relativePath: string): string {
  const resolved = resolve(memoryDir)
  if (basename(resolved) === 'project-state') return join(resolved, relativePath)
  return getProjectSystemStatePath(inferProjectRootFromMemoryDir(resolved), relativePath)
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

/** Migration snapshots are rollback evidence, never current project state. */
export function getProjectMigrationSnapshotDir(projectRoot: string): string {
  return join(getProjectLocalHistoryDir(projectRoot), 'migration-snapshots')
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

export function getProjectTaskReviewPacketPath(projectRoot: string, taskId: string): string {
  return join(getProjectTaskLocalHistoryDir(projectRoot, taskId), 'review-packet.md')
}

export function getProjectProgressHeartbeatsPath(projectRoot: string): string {
  return join(getProjectLocalHistoryDir(projectRoot), 'progress', 'heartbeats.md')
}

export function getProjectRuntimeStatePath(projectRoot: string): string {
  return join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'state.json')
}

export function getProjectRuntimeContainerHomeDir(projectRoot: string): string {
  return join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'container-home')
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
