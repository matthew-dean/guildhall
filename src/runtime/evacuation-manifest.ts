import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { atomicWriteText } from '@guildhall/sessions'

export const EVACUATION_MANIFEST_VERSION = 1 as const
export type EvacuationEntryKind = 'file' | 'directory'
export type Sha256Digest = string

export interface EvacuationManifestPathDigest {
  path: string
  bytes: number
  sha256: Sha256Digest
}

export interface ProjectStateEvacuationEntry {
  kind: EvacuationEntryKind
  source: EvacuationManifestPathDigest
  snapshot: EvacuationManifestPathDigest
  restore: {
    status: 'not_verified' | 'verified' | 'failed'
    verifiedAt?: string
    target?: EvacuationManifestPathDigest
  }
}

export interface ProjectStateEvacuationBatch {
  id: string
  createdAt: string
  entries: ProjectStateEvacuationEntry[]
}

export interface ProjectStateEvacuationManifest {
  version: typeof EVACUATION_MANIFEST_VERSION
  batches: ProjectStateEvacuationBatch[]
}

interface DirectoryRecord {
  kind: EvacuationEntryKind
  path: string
  sha256?: Sha256Digest
}

export interface EvacuationPathDescription {
  kind: EvacuationEntryKind
  bytes: number
  sha256: Sha256Digest
}

function sha256(value: string | Buffer): Sha256Digest {
  return createHash('sha256').update(value).digest('hex')
}

export async function hashFile(filePath: string): Promise<Sha256Digest> {
  const info = await lstat(filePath)
  if (!info.isFile()) throw new Error(`Expected a file: ${filePath}`)
  return sha256(await readFile(filePath))
}

export async function hashDirectory(directoryPath: string): Promise<Sha256Digest> {
  const info = await lstat(directoryPath)
  if (!info.isDirectory()) throw new Error(`Expected a directory: ${directoryPath}`)

  const records: DirectoryRecord[] = []
  await collectDirectoryRecords(directoryPath, directoryPath, records)
  records.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return sha256(JSON.stringify(records))
}

export async function hashPath(targetPath: string): Promise<Sha256Digest> {
  const info = await lstat(targetPath)
  if (info.isFile()) return sha256(await readFile(targetPath))
  if (info.isDirectory()) return hashDirectory(targetPath)
  throw new Error(`Expected a file or directory: ${targetPath}`)
}

export async function describePath(targetPath: string): Promise<EvacuationPathDescription> {
  const info = await lstat(targetPath)
  if (info.isFile()) {
    const content = await readFile(targetPath)
    return { kind: 'file', bytes: content.byteLength, sha256: sha256(content) }
  }
  if (info.isDirectory()) {
    const records: DirectoryRecord[] = []
    const bytes = await collectDirectoryRecords(targetPath, targetPath, records)
    records.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    return { kind: 'directory', bytes, sha256: sha256(JSON.stringify(records)) }
  }
  throw new Error(`Expected a file or directory: ${targetPath}`)
}

async function collectDirectoryRecords(
  root: string,
  directoryPath: string,
  records: DirectoryRecord[],
): Promise<number> {
  const entries = await readdir(directoryPath, { withFileTypes: true })
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  let bytes = 0

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name)
    const relativePath = path.relative(root, absolutePath).split(path.sep).join('/')
    if (entry.isDirectory()) {
      records.push({ kind: 'directory', path: relativePath })
      bytes += await collectDirectoryRecords(root, absolutePath, records)
    } else if (entry.isFile()) {
      const content = await readFile(absolutePath)
      records.push({
        kind: 'file',
        path: relativePath,
        sha256: sha256(content),
      })
      bytes += content.byteLength
    } else {
      throw new Error(`Expected a file or directory: ${absolutePath}`)
    }
  }
  return bytes
}

export async function readEvacuationManifest(
  manifestPath: string,
): Promise<ProjectStateEvacuationManifest> {
  const value = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
  assertManifest(value)
  return value
}

export async function writeEvacuationManifest(
  manifestPath: string,
  manifest: ProjectStateEvacuationManifest,
): Promise<void> {
  assertManifest(manifest)
  atomicWriteText(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

export async function verifySnapshotEntry(entry: ProjectStateEvacuationEntry): Promise<boolean> {
  let info
  try {
    info = await lstat(entry.snapshot.path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }

  const kind: EvacuationEntryKind | null = info.isFile()
    ? 'file'
    : info.isDirectory()
      ? 'directory'
      : null
  if (kind !== entry.kind) return false
  return await hashPath(entry.snapshot.path) === entry.snapshot.sha256
}

function assertManifest(value: unknown): asserts value is ProjectStateEvacuationManifest {
  if (!isRecord(value) || value.version !== EVACUATION_MANIFEST_VERSION || !Array.isArray(value.batches)) {
    throw new Error('Invalid project-state evacuation manifest')
  }

  for (const batch of value.batches) {
    if (!isRecord(batch) || typeof batch.id !== 'string' || !Array.isArray(batch.entries)) {
      throw new Error('Invalid project-state evacuation manifest batch')
    }
    for (const entry of batch.entries) {
      if (
        !isRecord(entry) ||
        (entry.kind !== 'file' && entry.kind !== 'directory') ||
        !isPathDigest(entry.source) ||
        !isPathDigest(entry.snapshot)
      ) {
        throw new Error('Invalid project-state evacuation manifest entry')
      }
    }
  }
}

function isPathDigest(value: unknown): value is EvacuationManifestPathDigest {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
