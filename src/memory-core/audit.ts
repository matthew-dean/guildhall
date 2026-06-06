import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { readManagedTextFile } from '@guildhall/persistence'
import { getProjectStateDir } from '@guildhall/sessions'

import { recordMemoryEvent, resolveMemoryPaths, writeMemoryAuditReport } from './data-access.js'
import type {
  MemoryProjectFileAudit,
  ProjectMemoryAuditResult,
  RecordMemoryEventInput,
} from './types.js'

const AUDITED_FILES = [
  'TASKS.json',
  'PROGRESS.md',
  'MEMORY.md',
  'learning.json',
  'project-skills.json',
  'codebase-map.yaml',
  'codebase-map.history.jsonl',
  'codebase-map.stale.json',
  'tasks/index.json',
] as const

export async function auditProjectMemoryState(input: {
  projectRoot: string
  apply?: boolean
  now?: () => Date
}): Promise<ProjectMemoryAuditResult> {
  const projectRoot = path.resolve(input.projectRoot)
  const stateDir = getProjectStateDir(projectRoot)
  const projectId = path.basename(projectRoot) || 'project'
  const scope = { kind: 'project' as const, projectId }
  const now = input.now ?? (() => new Date())
  const generatedAt = now().toISOString()
  const paths = resolveMemoryPaths({ projectRoot, scope })
  const files = await auditFiles(stateDir)
  const bytesBefore = files.reduce((sum, file) => sum + file.bytes, 0)
  let eventsWritten = 0

  if (input.apply === true) {
    for (const file of files) {
      await recordMemoryEvent({
        projectRoot,
        event: eventForFile({ file, scope, generatedAt, projectId }),
        now,
      })
      eventsWritten += 1
    }
  }

  const reportRef = input.apply === true
    ? await writeMemoryAuditReport({
        projectRoot,
        scope,
        report: {
          generatedAt,
          storagePath: paths.dbPath,
          repoLocalWrites: [],
          warnings: [],
          files,
          bytesBefore,
          bytesAfter: bytesBefore,
          eventsWritten,
        },
      })
    : null

  return {
    projectRoot,
    stateDir,
    memoryDir: paths.memoryDir,
    dryRun: input.apply !== true,
    files,
    bytesBefore,
    bytesAfter: bytesBefore,
    eventsWritten,
    repoLocalWrites: [],
    auditReportPath: reportRef?.path ?? null,
  }
}

async function auditFiles(stateDir: string): Promise<MemoryProjectFileAudit[]> {
  const files: MemoryProjectFileAudit[] = []
  for (const relative of AUDITED_FILES) {
    const full = path.join(stateDir, relative)
    let raw: string
    try {
      raw = await readManagedTextFile(full, 'utf8')
    } catch (err) {
      if (String(err).includes('ENOENT')) continue
      throw err
    }
    files.push(auditFile(relative, raw))
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

function auditFile(relative: string, raw: string): MemoryProjectFileAudit {
  const relativePath = path.posix.join('.guildhall', relative.replace(/\\/g, '/'))
  const bytes = Buffer.byteLength(raw, 'utf8')
  const hash = createHash('sha256').update(raw).digest('hex')
  if (relative === 'TASKS.json') {
    const taskCount = countTasks(raw)
    return {
      relativePath,
      kind: 'task_queue',
      bytes,
      hash,
      taskCount,
      summary: `${relativePath}: ${taskCount} task(s), ${bytes} byte(s).`,
    }
  }
  if (relative === 'PROGRESS.md') {
    const progressBlocks = (raw.match(/^###\s+/gm) ?? []).length
    return {
      relativePath,
      kind: 'progress_log',
      bytes,
      hash,
      progressBlocks,
      summary: `${relativePath}: ${progressBlocks} progress block(s), ${bytes} byte(s).`,
    }
  }
  if (/codebase-map/.test(relative)) {
    return {
      relativePath,
      kind: 'generated_map',
      bytes,
      hash,
      summary: `${relativePath}: generated map/state file, ${bytes} byte(s).`,
    }
  }
  if (/MEMORY|learning|project-skills/.test(relative)) {
    return {
      relativePath,
      kind: 'memory_file',
      bytes,
      hash,
      summary: `${relativePath}: memory file, ${bytes} byte(s).`,
    }
  }
  return {
    relativePath,
    kind: 'other',
    bytes,
    hash,
    summary: `${relativePath}: ${bytes} byte(s).`,
  }
}

function eventForFile(input: {
  file: MemoryProjectFileAudit
  scope: RecordMemoryEventInput['scope']
  generatedAt: string
  projectId: string
}): RecordMemoryEventInput {
  return {
    scope: input.scope,
    source: {
      kind: sourceKindFor(input.file.kind),
      ref: input.file.relativePath.replace(/^\.guildhall\//, ''),
      path: input.file.relativePath,
      hash: input.file.hash,
      capturedAt: input.generatedAt,
    },
    content: {
      summary: input.file.summary,
      json: input.file,
    },
    metadata: {
      projectId: input.projectId,
      retention: 'durable_memory',
      risk: input.file.bytes > 200_000 ? 'medium' : 'low',
    },
  }
}

function sourceKindFor(kind: MemoryProjectFileAudit['kind']): RecordMemoryEventInput['source']['kind'] {
  if (kind === 'task_queue') return 'task'
  if (kind === 'progress_log') return 'progress'
  if (kind === 'generated_map') return 'generated_map'
  return 'artifact'
}

function countTasks(raw: string): number {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed.length
    if (isRecord(parsed) && Array.isArray(parsed.tasks)) return parsed.tasks.length
  } catch {
    return 0
  }
  return 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
