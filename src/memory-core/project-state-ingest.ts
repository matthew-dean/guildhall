import fs from 'node:fs/promises'
import path from 'node:path'

import type { GuildhallMemory, MemoryEventInput } from './types.js'

export interface ProjectStatePrototypeFileReport {
  relativePath: string
  bytes: number
  eventType: string
  action: 'summarize' | 'do_not_ingest_full_file'
  summary: string
}

export interface ProjectStateMemoryPrototypeReport {
  projectRoot: string
  projectLocalBytes: number
  files: ProjectStatePrototypeFileReport[]
  eventsRecorded: number
}

export async function ingestProjectStateForMemoryPrototype(input: {
  projectRoot: string
  memory: GuildhallMemory
}): Promise<ProjectStateMemoryPrototypeReport> {
  const stateDir = path.join(input.projectRoot, '.guildhall')
  const files = await collectProjectStateFiles(stateDir)
  const reports: ProjectStatePrototypeFileReport[] = []
  let eventsRecorded = 0

  for (const file of files) {
    const relativePath = path.relative(input.projectRoot, file)
    const bytes = (await fs.stat(file)).size
    const report = await summarizeProjectStateFile(file, relativePath, bytes)
    reports.push(report)
    await input.memory.recordEvent({
      scope: { kind: 'project', projectRoot: input.projectRoot },
      type: report.eventType,
      summary: report.summary,
      body: `${report.summary} Action: ${report.action}. Source bytes: ${bytes}.`,
      sourceRefs: [{ kind: 'project_file', path: relativePath, summary: report.summary }],
      relevanceHints: relevanceHintsForReport(report),
    } satisfies MemoryEventInput)
    eventsRecorded += 1
  }

  return {
    projectRoot: input.projectRoot,
    projectLocalBytes: reports.reduce((sum, file) => sum + file.bytes, 0),
    files: reports.sort((a, b) => b.bytes - a.bytes),
    eventsRecorded,
  }
}

function relevanceHintsForReport(report: ProjectStatePrototypeFileReport): string[] {
  const hints = ['project-state', 'memory', ...report.eventType.split(/[^a-z0-9]+/i).filter(Boolean)]
  if (report.action === 'do_not_ingest_full_file') hints.push('bloat', 'oversize')
  if (/backup/i.test(report.relativePath)) hints.push('backup', 'migration')
  if (report.bytes > 50_000) hints.push('bloat')
  return [...new Set(hints.map((hint) => hint.toLowerCase()))]
}

async function collectProjectStateFiles(stateDir: string): Promise<string[]> {
  const files: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile() && isRelevantProjectStateFile(full)) {
        files.push(full)
      }
    }
  }
  await walk(stateDir)
  return files
}

async function summarizeProjectStateFile(
  file: string,
  relativePath: string,
  bytes: number,
): Promise<ProjectStatePrototypeFileReport> {
  if (relativePath.endsWith('.migration-backup.json') || /backup/i.test(relativePath) || /TASKS\.before-/i.test(relativePath)) {
    return {
      relativePath,
      bytes,
      eventType: 'migration_backup_detected',
      action: 'do_not_ingest_full_file',
      summary: `Project state contains ${formatBytes(bytes)} migration backup at ${relativePath}.`,
    }
  }
  if (relativePath.endsWith('TASKS.json')) {
    return summarizeTasksJson(file, relativePath, bytes)
  }
  if (relativePath.endsWith('PROGRESS.md')) {
    const raw = await fs.readFile(file, 'utf8')
    const heartbeats = (raw.match(/\bHEARTBEAT\b/g) ?? []).length
    const decisions = (raw.match(/\bDECISION\b/g) ?? []).length
    return {
      relativePath,
      bytes,
      eventType: 'progress_summary',
      action: 'summarize',
      summary: `Progress log is ${formatBytes(bytes)} with heartbeats=${heartbeats}, decisions=${decisions}.`,
    }
  }
  if (/codebase-map/i.test(relativePath)) {
    return {
      relativePath,
      bytes,
      eventType: 'structural_map_summary',
      action: bytes > 200_000 ? 'do_not_ingest_full_file' : 'summarize',
      summary: `Structural map is ${formatBytes(bytes)} at ${relativePath}; use as indexed source, not prompt memory.`,
    }
  }
  if (/\.guildhall\/tasks\/archive\/.+\.json$/.test(relativePath)) {
    return {
      relativePath,
      bytes,
      eventType: 'archived_task_summary',
      action: 'summarize',
      summary: `Archived task shard is ${formatBytes(bytes)} at ${relativePath}; include only task id and terminal summary.`,
    }
  }
  return {
    relativePath,
    bytes,
    eventType: 'project_state_summary',
    action: bytes > 50_000 ? 'do_not_ingest_full_file' : 'summarize',
    summary: `Project state file is ${formatBytes(bytes)} at ${relativePath}.`,
  }
}

async function summarizeTasksJson(
  file: string,
  relativePath: string,
  bytes: number,
): Promise<ProjectStatePrototypeFileReport> {
  let active = 0
  let terminal = 0
  let blocked = 0
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown
    const tasks = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.tasks) ? parsed.tasks : []
    for (const task of tasks) {
      const status = isRecord(task) && typeof task.status === 'string' ? task.status : 'unknown'
      if (TERMINAL_STATUSES.has(status)) terminal += 1
      else active += 1
      if (status === 'blocked') blocked += 1
    }
  } catch {
    return {
      relativePath,
      bytes,
      eventType: 'task_queue_summary',
      action: 'summarize',
      summary: `Task queue is ${formatBytes(bytes)} but could not be parsed.`,
    }
  }
  return {
    relativePath,
    bytes,
    eventType: 'task_queue_summary',
    action: 'summarize',
    summary: `Task queue is ${formatBytes(bytes)} with active=${active}, blocked=${blocked}, terminal=${terminal}.`,
  }
}

function isRelevantProjectStateFile(file: string): boolean {
  return /\.(json|jsonl|md|ya?ml)$/i.test(file)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)}MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)}KB`
  return `${bytes}B`
}

const TERMINAL_STATUSES = new Set(['done', 'shelved', 'cancelled', 'archived'])
