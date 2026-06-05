import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  appendJsonLine,
  defaultMemoryStorageRoot,
  directoryStats,
  projectMemoryIdentity,
  readJsonLines,
  scopeStorageDir,
  writeJsonLines,
} from '../index.js'

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-memory-storage-'))
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('memory-core storage helpers', () => {
  it('derives stable system-local scope directories and safe path names', () => {
    process.env.GUILDHALL_DATA_DIR = path.join(tmp, 'data')
    const projectRoot = path.join(tmp, 'project with spaces')

    expect(defaultMemoryStorageRoot()).toBe(path.join(tmp, 'data', 'memory'))
    expect(projectMemoryIdentity(projectRoot)).toMatch(/^project_with_spaces-[a-f0-9]{12}$/)
    expect(scopeStorageDir({ kind: 'project', projectRoot })).toContain(path.join('memory', 'projects', projectMemoryIdentity(projectRoot)))
    expect(scopeStorageDir({ kind: 'task_thread', projectRoot, taskId: 'task/1', threadId: 'thread:2' })).toContain(path.join('tasks', 'task_1', 'threads', 'thread_2'))
    expect(scopeStorageDir({ kind: 'user_global' })).toBe(path.join(tmp, 'data', 'memory', 'users', 'default'))
    expect(scopeStorageDir({ kind: 'user_global', userId: 'owner@example.com' })).toBe(path.join(tmp, 'data', 'memory', 'users', 'owner_example.com'))
    expect(scopeStorageDir({ kind: 'guildhall_product' })).toBe(path.join(tmp, 'data', 'memory', 'guildhall-product'))
  })

  it('reads, writes, appends, and sizes JSONL files without requiring precreated directories', async () => {
    const file = path.join(tmp, 'nested', 'events.jsonl')

    expect(await readJsonLines(file)).toEqual([])

    await appendJsonLine(file, { id: 'a', value: 1 })
    await appendJsonLine(file, { id: 'b', value: 2 })
    expect(await readJsonLines(file)).toEqual([
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
    ])

    await writeJsonLines(file, [{ id: 'c', value: 3 }])
    expect(await readJsonLines(file)).toEqual([{ id: 'c', value: 3 }])

    await writeJsonLines(path.join(tmp, 'empty.jsonl'), [])
    expect(await fs.readFile(path.join(tmp, 'empty.jsonl'), 'utf8')).toBe('')

    await fs.mkdir(path.join(tmp, 'nested', 'child'), { recursive: true })
    await fs.writeFile(path.join(tmp, 'nested', 'child', 'blob.txt'), 'hello', 'utf8')
    const stats = await directoryStats(path.join(tmp, 'nested'))
    expect(stats.fileCount).toBe(2)
    expect(stats.totalBytes).toBeGreaterThan(5)
    expect(await directoryStats(path.join(tmp, 'missing'))).toEqual({ totalBytes: 0, fileCount: 0 })
  })
})
