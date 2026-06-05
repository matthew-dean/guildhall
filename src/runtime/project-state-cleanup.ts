import fs from 'node:fs/promises'
import path from 'node:path'
import { getProjectSharedStateDir } from '@guildhall/sessions'

export interface ProjectLocalCleanupCandidate {
  relativePath: string
  absolutePath: string
  bytes: number
  reason: string
}

export interface ProjectLocalCleanupResult {
  projectRoot: string
  sharedStateDir: string
  apply: boolean
  candidates: ProjectLocalCleanupCandidate[]
  removed: ProjectLocalCleanupCandidate[]
  bytesToRemove: number
  bytesRemoved: number
}

export async function cleanupProjectLocalState(input: {
  projectRoot: string
  apply?: boolean
}): Promise<ProjectLocalCleanupResult> {
  const projectRoot = path.resolve(input.projectRoot)
  const sharedStateDir = getProjectSharedStateDir(projectRoot)
  const candidates = await collectCleanupCandidates(projectRoot, sharedStateDir)
  const removed: ProjectLocalCleanupCandidate[] = []
  if (input.apply === true) {
    for (const candidate of candidates) {
      await fs.rm(candidate.absolutePath, { force: true })
      removed.push(candidate)
    }
  }
  return {
    projectRoot,
    sharedStateDir,
    apply: input.apply === true,
    candidates,
    removed,
    bytesToRemove: candidates.reduce((sum, candidate) => sum + candidate.bytes, 0),
    bytesRemoved: removed.reduce((sum, candidate) => sum + candidate.bytes, 0),
  }
}

async function collectCleanupCandidates(
  projectRoot: string,
  sharedStateDir: string,
): Promise<ProjectLocalCleanupCandidate[]> {
  const candidates: ProjectLocalCleanupCandidate[] = []
  const files = await walkFiles(sharedStateDir)
  for (const file of files) {
    const relativeToState = path.relative(sharedStateDir, file).replace(/\\/g, '/')
    const relativePath = `.guildhall/${relativeToState}`
    const reason = cleanupReason(relativeToState)
    if (!reason) continue
    const stat = await fs.stat(file)
    candidates.push({
      relativePath,
      absolutePath: path.resolve(projectRoot, relativePath),
      bytes: stat.size,
      reason,
    })
  }
  return candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

async function walkFiles(dir: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
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

function cleanupReason(relativeToState: string): string | null {
  const normalized = relativeToState.replace(/\\/g, '/')
  const base = path.basename(normalized)
  if (/\.migration-backup\.json$/i.test(base)) return 'migration-backup'
  if (/^TASKS\.before-[^/]+\.json$/i.test(base)) return 'pre-migration-task-backup'
  if (normalized === 'progress/heartbeats.md') return 'compacted-progress-heartbeats'
  return null
}
