import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { getProjectLocalHistoryDir } from '@guildhall/sessions'

import {
  compactMaterializedMigrationSnapshot,
  readMigrationSnapshotManifest,
  writeMigrationSnapshot,
} from '../migration-snapshot.js'

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-migration-snapshot-'))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('migration snapshot provenance', () => {
  it('writes an immutable snapshot and a digest-backed manifest', async () => {
    const projectRoot = path.join(tmp, 'project')
    const sourcePath = path.join(projectRoot, '.guildhall', 'TASKS.json')
    const snapshotPath = path.join(projectRoot, '.guildhall', 'TASKS.before-test.json')
    const raw = '{"version":1,"tasks":[{"id":"task-1"}]}\n'
    await fs.mkdir(path.dirname(sourcePath), { recursive: true })
    await fs.writeFile(sourcePath, raw, 'utf8')

    const first = await writeMigrationSnapshot({
      projectRoot,
      migrationId: 'test/migration',
      sourcePath,
      snapshotPath,
      sourceBytes: raw,
      sourceRevision: 'revision-1',
      now: '2026-07-14T00:00:00.000Z',
    })
    const manifest = await readMigrationSnapshotManifest(snapshotPath)

    expect(first.created).toBe(true)
    expect(manifest).toMatchObject({
      version: 1,
      kind: 'guildhall_migration_snapshot',
      migrationId: 'test/migration',
      sourceAtCaptureVerified: true,
      snapshot: { materialized: false },
      restore: { status: 'not_verified' },
      retention: { purpose: 'rollback', reviewRequired: true },
      provenance: {
        sourceRevision: 'revision-1',
        producer: 'guildhall.migration-snapshot',
        producerVersion: '1',
      },
    })
    expect(manifest?.source.sha256).toBe(manifest?.snapshot.sha256)
    expect(manifest?.source.bytes).toBe(Buffer.byteLength(raw))
    await expect(fs.readFile(snapshotPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(manifest?.rollback.runId).toBe(first.rollbackRunId)
    expect(manifest?.rollback.manifestPath).toBe(first.rollbackManifestPath)
    await expect(fs.readFile(first.rollbackObjectPath, 'utf8')).resolves.toBe(raw)
    await expect(fs.readFile(first.rollbackManifestPath, 'utf8')).resolves.toContain('"restoreClass": "migration-snapshot"')
    await expect(fs.readFile(path.join(getProjectLocalHistoryDir(projectRoot), 'rollback', 'index.json'), 'utf8'))
      .resolves.toContain(`"runId": "${first.rollbackRunId}"`)
  })

  it('does not overwrite an existing backup and exposes source drift', async () => {
    const projectRoot = path.join(tmp, 'project')
    const sourcePath = path.join(projectRoot, '.guildhall', 'TASKS.json')
    const snapshotPath = path.join(projectRoot, '.guildhall', 'TASKS.before-test.json')
    await fs.mkdir(path.dirname(sourcePath), { recursive: true })
    await fs.writeFile(sourcePath, 'first\n', 'utf8')
    const first = await writeMigrationSnapshot({
      projectRoot,
      migrationId: 'test/migration',
      sourcePath,
      snapshotPath,
      sourceBytes: 'first\n',
    })

    await fs.writeFile(sourcePath, 'second\n', 'utf8')
    const second = await writeMigrationSnapshot({
      projectRoot,
      migrationId: 'test/migration',
      sourcePath,
      snapshotPath,
      sourceBytes: 'second\n',
    })
    const manifest = await readMigrationSnapshotManifest(snapshotPath)

    expect(second.created).toBe(false)
    expect(second.sourceAtCaptureVerified).toBe(false)
    await expect(fs.readFile(snapshotPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(second.rollbackRunId).toBe(first.rollbackRunId)
    expect(manifest?.rollback.runId).toBe(second.rollbackRunId)
    await expect(fs.readFile(first.rollbackObjectPath, 'utf8')).resolves.toBe('first\n')
    await expect(fs.readFile(second.rollbackObjectPath, 'utf8')).resolves.toBe('first\n')
  })

  it('imports an existing legacy snapshot into the rollback store without replacing it', async () => {
    const projectRoot = path.join(tmp, 'project')
    const sourcePath = path.join(projectRoot, '.guildhall', 'TASKS.json')
    const snapshotPath = path.join(projectRoot, '.guildhall', 'TASKS.before-legacy.json')
    await fs.mkdir(path.dirname(sourcePath), { recursive: true })
    await fs.writeFile(sourcePath, 'current\n', 'utf8')
    await fs.writeFile(snapshotPath, 'legacy\n', 'utf8')

    const result = await writeMigrationSnapshot({
      projectRoot,
      migrationId: 'test/legacy-import',
      sourcePath,
      snapshotPath,
      sourceBytes: 'current\n',
    })
    const manifest = await readMigrationSnapshotManifest(snapshotPath)

    expect(result.created).toBe(false)
    expect(result.sourceAtCaptureVerified).toBe(false)
    await expect(fs.readFile(snapshotPath, 'utf8')).resolves.toBe('legacy\n')
    await expect(fs.readFile(result.rollbackObjectPath, 'utf8')).resolves.toBe('legacy\n')
    expect(manifest?.snapshot.materialized).toBe(true)
    expect(manifest?.snapshot.sha256).toBe(manifest?.rollback.objectPath ? manifest.snapshot.sha256 : undefined)

    const dryRun = await compactMaterializedMigrationSnapshot(snapshotPath, { dryRun: true })
    expect(dryRun).toMatchObject({ eligible: true, reason: 'compacted', bytesAfter: 0 })
    await expect(fs.readFile(snapshotPath, 'utf8')).resolves.toBe('legacy\n')

    const applied = await compactMaterializedMigrationSnapshot(snapshotPath, { dryRun: false })
    expect(applied).toMatchObject({ eligible: true, reason: 'compacted', bytesBefore: Buffer.byteLength('legacy\n'), bytesAfter: 0 })
    await expect(fs.readFile(snapshotPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readMigrationSnapshotManifest(snapshotPath)).resolves.toMatchObject({ snapshot: { materialized: false } })
    await expect(fs.readFile(result.rollbackObjectPath, 'utf8')).resolves.toBe('legacy\n')
  })
})
