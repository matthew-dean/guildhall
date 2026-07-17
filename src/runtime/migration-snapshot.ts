import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { getProjectLocalHistoryDir, atomicWriteText } from '@guildhall/sessions'
import { RollbackStore } from './rollback-store.js'

const ROLLBACK_PRODUCER = 'guildhall.migration-snapshot'
const ROLLBACK_PRODUCER_VERSION = '1'

export interface MigrationSnapshotManifest {
  version: 1
  kind: 'guildhall_migration_snapshot'
  migrationId: string
  createdAt: string
  source: {
    path: string
    bytes: number
    sha256: string
  }
  snapshot: {
    path: string
    bytes: number
    sha256: string
    materialized: boolean
  }
  sourceAtCaptureVerified: boolean
  restore: {
    status: 'not_verified' | 'verified' | 'failed'
    verifiedAt?: string
    target?: {
      path: string
      bytes: number
      sha256: string
    }
  }
  retention: {
    purpose: 'rollback'
    reviewRequired: true
  }
  provenance: {
    sourceRevision: string
    producer: string
    producerVersion: string
  }
  rollback: {
    runId: string
    manifestPath: string
    objectPath: string
  }
}

export interface MigrationSnapshotResult {
  snapshotPath: string
  manifestPath: string
  created: boolean
  sourceAtCaptureVerified: boolean
  snapshotSha256: string
  rollbackRunId: string
  rollbackManifestPath: string
  rollbackObjectPath: string
}

export interface MigrationSnapshotCompactionResult {
  eligible: boolean
  reason: 'compacted' | 'already_compact' | 'missing_manifest' | 'missing_snapshot' | 'missing_rollback' | 'digest_mismatch'
  bytesBefore: number
  bytesAfter: number
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function relativeOrAbsolute(projectRoot: string, filePath: string): string {
  const relative = path.relative(projectRoot, filePath)
  return relative && !relative.startsWith('..') ? relative : filePath
}

async function readIfExists(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Write an immutable migration snapshot and its provenance sidecar. Existing
 * snapshots are never overwritten; a mismatched manifest is a migration error
 * rather than an invitation to silently create another backup.
 */
export async function writeMigrationSnapshot(input: {
  projectRoot: string
  migrationId: string
  sourcePath: string
  snapshotPath: string
  sourceBytes: Buffer | string
  sourceRevision?: string
  now?: string
}): Promise<MigrationSnapshotResult> {
  const source = Buffer.isBuffer(input.sourceBytes)
    ? input.sourceBytes
    : Buffer.from(input.sourceBytes, 'utf8')
  const sourceDigest = sha256(source)
  const manifestPath = `${input.snapshotPath}.manifest.json`
  const existingSnapshot = await readIfExists(input.snapshotPath)
  const existingManifestBytes = await readIfExists(manifestPath)
  let existingManifest: MigrationSnapshotManifest | null = null
  if (existingManifestBytes) {
    try {
      existingManifest = JSON.parse(existingManifestBytes.toString('utf8')) as MigrationSnapshotManifest
    } catch {
      throw new Error(`Invalid migration snapshot manifest: ${manifestPath}`)
    }
  }

  let snapshotBytes = existingSnapshot ?? source
  if (!existingSnapshot && existingManifest?.rollback.objectPath) {
    const rollbackBytes = await readIfExists(existingManifest.rollback.objectPath)
    if (!rollbackBytes) {
      throw new Error(`Migration rollback object is missing: ${existingManifest.rollback.objectPath}`)
    }
    snapshotBytes = rollbackBytes
  }
  const snapshotDigest = sha256(snapshotBytes)
  if (existingSnapshot) {
    if (
      existingManifest &&
      (existingManifest.migrationId !== input.migrationId || existingManifest.snapshot.sha256 !== snapshotDigest)
    ) {
      throw new Error(`Migration snapshot manifest mismatch: ${input.snapshotPath}`)
    }
  }

  const now = input.now ?? new Date().toISOString()
  const sourceAtCaptureVerified = existingManifest
    ? existingManifest.sourceAtCaptureVerified === true && existingManifest.source.sha256 === sourceDigest
    : sourceDigest === snapshotDigest
  const sourceRevision = input.sourceRevision
    ?? existingManifest?.provenance?.sourceRevision
    ?? snapshotDigest
  const rollbackRoot = path.join(getProjectLocalHistoryDir(input.projectRoot), 'rollback')
  const existingRollback = existingManifest?.rollback
  let rollbackRunId = existingRollback?.runId ?? ''
  let rollbackManifestPath = existingRollback?.manifestPath ?? ''
  let rollbackObjectPath = existingRollback?.objectPath ?? ''
  let rollbackProducer = existingManifest?.provenance?.producer ?? ROLLBACK_PRODUCER
  let rollbackProducerVersion = existingManifest?.provenance?.producerVersion ?? ROLLBACK_PRODUCER_VERSION
  if (!rollbackRunId || !rollbackManifestPath || !rollbackObjectPath) {
    const rollback = await new RollbackStore({
      rootDir: rollbackRoot,
      producer: ROLLBACK_PRODUCER,
      producerVersion: ROLLBACK_PRODUCER_VERSION,
      now: () => new Date(now),
    }).writeRun([{
      logicalPath: relativeOrAbsolute(input.projectRoot, input.sourcePath),
      content: snapshotBytes,
      restoreClass: 'migration-snapshot',
      sourceRevision,
    }])
    const rollbackEntry = rollback.manifest.entries[0]
    if (!rollbackEntry) throw new Error(`Rollback snapshot run contained no entry: ${rollback.runId}`)
    rollbackRunId = rollback.runId
    rollbackManifestPath = rollback.manifestPath
    rollbackObjectPath = path.join(rollbackRoot, rollbackEntry.objectPath)
    rollbackProducer = rollbackEntry.producer
    rollbackProducerVersion = rollbackEntry.producerVersion
  }

  const manifest: MigrationSnapshotManifest = {
    version: 1,
    kind: 'guildhall_migration_snapshot',
    migrationId: input.migrationId,
    createdAt: existingManifest?.createdAt ?? now,
    source: existingManifest?.source ?? {
      path: relativeOrAbsolute(input.projectRoot, input.sourcePath),
      bytes: source.byteLength,
      sha256: sourceDigest,
    },
    snapshot: {
      path: relativeOrAbsolute(input.projectRoot, input.snapshotPath),
      bytes: snapshotBytes.byteLength,
      sha256: snapshotDigest,
      materialized: existingSnapshot !== null,
    },
    sourceAtCaptureVerified,
    restore: existingManifest?.restore ?? { status: 'not_verified' },
    retention: { purpose: 'rollback', reviewRequired: true },
    provenance: {
      sourceRevision,
      producer: rollbackProducer,
      producerVersion: rollbackProducerVersion,
    },
    rollback: {
      runId: rollbackRunId,
      manifestPath: rollbackManifestPath,
      objectPath: rollbackObjectPath,
    },
  }
  atomicWriteText(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return {
    snapshotPath: input.snapshotPath,
    manifestPath,
    created: !existingSnapshot && !existingManifest,
    sourceAtCaptureVerified,
    snapshotSha256: snapshotDigest,
    rollbackRunId,
    rollbackManifestPath,
    rollbackObjectPath,
  }
}

export async function readMigrationSnapshotManifest(
  snapshotPath: string,
): Promise<MigrationSnapshotManifest | null> {
  const raw = await readIfExists(`${snapshotPath}.manifest.json`)
  if (!raw) return null
  try {
    return JSON.parse(raw.toString('utf8')) as MigrationSnapshotManifest
  } catch {
    throw new Error(`Invalid migration snapshot manifest: ${snapshotPath}.manifest.json`)
  }
}

/** Remove only a redundant raw copy whose manifest and rollback object agree. */
export async function compactMaterializedMigrationSnapshot(
  snapshotPath: string,
  options: { dryRun?: boolean } = {},
): Promise<MigrationSnapshotCompactionResult> {
  const manifestPath = `${snapshotPath}.manifest.json`
  const manifest = await readMigrationSnapshotManifest(snapshotPath)
  if (!manifest) {
    const legacy = await readIfExists(snapshotPath)
    const bytes = legacy?.byteLength ?? 0
    return { eligible: false, reason: 'missing_manifest', bytesBefore: bytes, bytesAfter: bytes }
  }

  const snapshot = await readIfExists(snapshotPath)
  if (!snapshot) {
    return {
      eligible: false,
      reason: manifest.snapshot.materialized === false ? 'already_compact' : 'missing_snapshot',
      bytesBefore: 0,
      bytesAfter: 0,
    }
  }
  const rollback = await readIfExists(manifest.rollback.objectPath)
  if (!rollback) return { eligible: false, reason: 'missing_rollback', bytesBefore: snapshot.byteLength, bytesAfter: snapshot.byteLength }
  if (
    manifest.snapshot.materialized === false ||
    sha256(snapshot) !== manifest.snapshot.sha256 ||
    sha256(rollback) !== manifest.snapshot.sha256
  ) {
    return { eligible: false, reason: 'digest_mismatch', bytesBefore: snapshot.byteLength, bytesAfter: snapshot.byteLength }
  }

  if (options.dryRun !== true) {
    atomicWriteText(manifestPath, `${JSON.stringify({
      ...manifest,
      snapshot: { ...manifest.snapshot, materialized: false },
    }, null, 2)}\n`)
    await fs.rm(snapshotPath)
  }
  return { eligible: true, reason: 'compacted', bytesBefore: snapshot.byteLength, bytesAfter: 0 }
}
