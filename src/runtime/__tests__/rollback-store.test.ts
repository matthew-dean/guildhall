import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createHash } from 'node:crypto'

import { RollbackStore } from '../rollback-store.js'

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-rollback-store-'))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

describe('RollbackStore', () => {
  it('writes content-addressed objects, a unique manifest, and a compact index entry', async () => {
    const store = new RollbackStore({
      rootDir: tmp,
      producer: 'guildhall-test',
      producerVersion: '0.0.1',
      byteBudget: 7,
      now: () => new Date('2026-07-15T00:00:00.000Z'),
      runIdFactory: (() => {
        let count = 0
        return () => `run-${++count}`
      })(),
    })

    const result = await store.writeRun([{
      logicalPath: '.guildhall/TASKS.json',
      content: 'before\n',
      restoreClass: 'task-state',
      sourceRevision: 'revision-1',
    }, {
      logicalPath: '.guildhall/TASKS.copy.json',
      content: 'before\n',
      restoreClass: 'task-state',
      sourceRevision: 'revision-1',
    }])
    const digest = sha256('before\n')

    expect(result.newObjectBytes).toBe(7)
    expect(result.indexEntry.bytes).toBe(14)
    await expect(fs.readFile(path.join(tmp, 'objects', 'sha256', digest), 'utf8')).resolves.toBe('before\n')
    await expect(fs.readFile(result.manifestPath, 'utf8')).resolves.toContain('"logicalPath": ".guildhall/TASKS.json"')
    await expect(fs.readFile(path.join(tmp, 'index.json'), 'utf8')).resolves.toContain('"runId": "run-1"')
    expect(result.manifest.entries[0]).toMatchObject({
      logicalPath: '.guildhall/TASKS.json',
      objectPath: `objects/sha256/${digest}`,
      bytes: 7,
      sha256: digest,
      restoreClass: 'task-state',
      sourceRevision: 'revision-1',
      producer: 'guildhall-test',
      producerVersion: '0.0.1',
    })
  })

  it('deduplicates an existing object without overwriting it', async () => {
    const store = new RollbackStore({
      rootDir: tmp,
      producer: 'guildhall-test',
      producerVersion: '0.0.1',
      runIdFactory: (() => {
        let count = 0
        return () => `run-${++count}`
      })(),
    })

    const first = await store.writeRun([{
      logicalPath: 'one.txt',
      content: 'same\n',
      restoreClass: 'historical-only',
      sourceRevision: 'one',
    }])
    const objectPath = path.join(tmp, first.manifest.entries[0]!.objectPath)
    const before = await fs.stat(objectPath)
    const second = await store.writeRun([{
      logicalPath: 'two.txt',
      content: 'same\n',
      restoreClass: 'historical-only',
      sourceRevision: 'two',
    }])

    expect(second.newObjectBytes).toBe(0)
    await expect(fs.readFile(objectPath, 'utf8')).resolves.toBe('same\n')
    await expect(fs.stat(objectPath)).resolves.toMatchObject({ ino: before.ino, size: before.size })
    expect(second.runId).not.toBe(first.runId)
  })

  it('rejects a reused run path without replacing its manifest', async () => {
    const store = new RollbackStore({
      rootDir: tmp,
      producer: 'guildhall-test',
      producerVersion: '0.0.1',
      runIdFactory: () => 'fixed-run',
    })
    const entry = {
      logicalPath: 'state.json',
      content: '{}\n',
      restoreClass: 'repo-state',
      sourceRevision: 'revision-1',
    }

    await store.writeRun([entry])
    await expect(store.writeRun([{ ...entry, content: '{"changed":true}\n' }])).rejects.toThrow(/already exists/)
    await expect(fs.readFile(path.join(tmp, 'runs', 'fixed-run', 'manifest.json'), 'utf8')).resolves.toContain('revision-1')
  })

  it('checks the byte budget before creating objects or a run', async () => {
    const store = new RollbackStore({
      rootDir: tmp,
      producer: 'guildhall-test',
      producerVersion: '0.0.1',
      byteBudget: 3,
      runIdFactory: () => 'over-budget',
    })

    await expect(store.writeRun([{
      logicalPath: 'large.txt',
      content: 'four',
      restoreClass: 'historical-only',
      sourceRevision: 'revision-1',
    }])).rejects.toThrow(/byte budget exceeded/)
    await expect(fs.access(path.join(tmp, 'objects'))).rejects.toThrow()
    await expect(fs.access(path.join(tmp, 'runs'))).rejects.toThrow()
    await expect(fs.access(path.join(tmp, 'index.json'))).rejects.toThrow()
  })
})
