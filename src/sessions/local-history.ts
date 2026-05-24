import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
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

export function getProjectStateDir(projectRoot: string): string {
  return join(resolve(projectRoot), '.guildhall')
}

export function inferProjectRootFromMemoryDir(memoryDir: string): string {
  const resolved = resolve(memoryDir)
  return basename(resolved) === 'memory' || basename(resolved) === '.guildhall' ? dirname(resolved) : resolved
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
