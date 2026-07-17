import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  hashPath,
  describePath,
  readEvacuationManifest,
  verifySnapshotEntry,
  writeEvacuationManifest,
  type ProjectStateEvacuationManifest,
} from '../evacuation-manifest.js'

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-evacuation-manifest-'))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('project-state evacuation manifest', () => {
  it('hashes the same directory deterministically regardless of creation order', async () => {
    const first = path.join(tmp, 'first')
    await fs.mkdir(path.join(first, 'nested'), { recursive: true })
    await fs.writeFile(path.join(first, 'zeta.txt'), 'zeta\n')
    await fs.writeFile(path.join(first, 'nested', 'alpha.txt'), 'alpha\n')
    const firstHash = await hashPath(first)

    const second = path.join(tmp, 'second')
    await fs.mkdir(path.join(second, 'nested'), { recursive: true })
    await fs.writeFile(path.join(second, 'nested', 'alpha.txt'), 'alpha\n')
    await fs.writeFile(path.join(second, 'zeta.txt'), 'zeta\n')

    await expect(hashPath(second)).resolves.toBe(firstHash)
  })

  it('round-trips a versioned manifest and leaves no atomic temp file', async () => {
    const sourcePath = path.join(tmp, 'source.json')
    const snapshotPath = path.join(tmp, 'snapshot.json')
    const manifestPath = path.join(tmp, 'manifest.json')
    await fs.writeFile(sourcePath, '{"state":"before"}\n')
    await fs.copyFile(sourcePath, snapshotPath)
    const digest = await hashPath(sourcePath)
    const manifest: ProjectStateEvacuationManifest = {
      version: 1,
      batches: [{
        id: 'batch-1',
        createdAt: '2026-07-14T00:00:00.000Z',
        entries: [{
          kind: 'file',
          source: { path: sourcePath, bytes: 19, sha256: digest },
          snapshot: { path: snapshotPath, bytes: 19, sha256: digest },
          restore: { status: 'not_verified' },
        }],
      }],
    }

    await writeEvacuationManifest(manifestPath, manifest)

    await expect(readEvacuationManifest(manifestPath)).resolves.toEqual(manifest)
    await expect(fs.readdir(tmp)).resolves.toEqual(['manifest.json', 'snapshot.json', 'source.json'])
  })

  it('detects a tampered snapshot entry', async () => {
    const snapshotPath = path.join(tmp, 'snapshot.json')
    await fs.writeFile(snapshotPath, 'original\n')
    const entry = {
      kind: 'file' as const,
      source: { path: path.join(tmp, 'source.json'), bytes: 0, sha256: '0'.repeat(64) },
      snapshot: { path: snapshotPath, bytes: 9, sha256: await hashPath(snapshotPath) },
      restore: { status: 'not_verified' as const },
    }

    await expect(verifySnapshotEntry(entry)).resolves.toBe(true)
    await fs.writeFile(snapshotPath, 'tampered\n')
    await expect(verifySnapshotEntry(entry)).resolves.toBe(false)
  })

  it('records directory byte size alongside its digest', async () => {
    const directory = path.join(tmp, 'state')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'one.txt'), 'one')
    await fs.writeFile(path.join(directory, 'two.txt'), 'two-two')

    await expect(describePath(directory)).resolves.toMatchObject({
      kind: 'directory',
      bytes: 10,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })
})
