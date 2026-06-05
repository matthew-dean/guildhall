import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getProjectSharedStateDir } from '@guildhall/sessions'
import { cleanupProjectLocalState } from '../project-state-cleanup.js'

let tmp: string
let projectRoot: string
let sharedStateDir: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-cleanup-'))
  projectRoot = path.join(tmp, 'project')
  sharedStateDir = getProjectSharedStateDir(projectRoot)
  await fs.mkdir(path.join(sharedStateDir, 'progress'), { recursive: true })
  await fs.writeFile(path.join(sharedStateDir, 'TASKS.json'), '{"version":1,"tasks":[]}\n', 'utf8')
  await fs.writeFile(path.join(sharedStateDir, 'TASKS.before-0.10.0-task-hierarchy-links.json'), `${'x'.repeat(10_000)}\n`, 'utf8')
  await fs.writeFile(path.join(sharedStateDir, 'TASKS.migration-backup.json'), `${'y'.repeat(8_000)}\n`, 'utf8')
  await fs.writeFile(path.join(sharedStateDir, 'progress', 'heartbeats.md'), 'heartbeat\n', 'utf8')
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('cleanupProjectLocalState', () => {
  it('reports generated project-local backups and logs without deleting on dry run', async () => {
    const result = await cleanupProjectLocalState({ projectRoot, apply: false })

    expect(result.apply).toBe(false)
    expect(result.candidates.map(candidate => candidate.relativePath).sort()).toEqual([
      '.guildhall/TASKS.before-0.10.0-task-hierarchy-links.json',
      '.guildhall/TASKS.migration-backup.json',
      '.guildhall/progress/heartbeats.md',
    ])
    expect(result.bytesToRemove).toBeGreaterThan(18_000)
    expect(result.removed).toHaveLength(0)
    await expect(fs.stat(path.join(sharedStateDir, 'TASKS.migration-backup.json'))).resolves.toBeTruthy()
    await expect(fs.stat(path.join(sharedStateDir, 'TASKS.json'))).resolves.toBeTruthy()
  })

  it('deletes only cleanup candidates when apply is true', async () => {
    const result = await cleanupProjectLocalState({ projectRoot, apply: true })

    expect(result.removed.map(candidate => candidate.relativePath).sort()).toEqual([
      '.guildhall/TASKS.before-0.10.0-task-hierarchy-links.json',
      '.guildhall/TASKS.migration-backup.json',
      '.guildhall/progress/heartbeats.md',
    ])
    await expect(fs.stat(path.join(sharedStateDir, 'TASKS.migration-backup.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(path.join(sharedStateDir, 'TASKS.json'))).resolves.toBeTruthy()
  })
})
