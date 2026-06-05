import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  getProjectContextDebugLedgerPath,
  getProjectContextDebugSnapshotDir,
  getProjectLocalHistoryDir,
  getProjectLocalHistoryHealth,
  getProjectRecentEventsPath,
  getProjectSharedStateDir,
  getProjectStateDir,
  getProjectSystemStateDir,
  getProjectTranscriptPath,
  inferProjectRootFromMemoryDir,
  migrateProjectStateToSystem,
} from '../local-history.js'

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-local-history-'))
  process.env.GUILDHALL_DATA_DIR = path.join(tmp, 'data')
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('local history layout', () => {
  it('stores project local history under the user data dir, not the repo memory dir', () => {
    const projectRoot = path.join(tmp, 'repo')

    const historyDir = getProjectLocalHistoryDir(projectRoot)
    const projectStateDir = getProjectStateDir(projectRoot)
    const sharedStateDir = getProjectSharedStateDir(projectRoot)
    const systemStateDir = getProjectSystemStateDir(projectRoot)
    const transcriptPath = getProjectTranscriptPath(projectRoot, 'exploring', 'task-1')
    const eventsPath = getProjectRecentEventsPath(projectRoot)
    const debugLedgerPath = getProjectContextDebugLedgerPath(projectRoot)
    const debugSnapshotDir = getProjectContextDebugSnapshotDir(projectRoot, 'task-1')

    expect(historyDir).toMatch(path.join(tmp, 'data', 'projects'))
    expect(historyDir).toContain('repo-')
    expect(projectStateDir).toBe(systemStateDir)
    expect(sharedStateDir).toBe(path.join(projectRoot, '.guildhall'))
    expect(systemStateDir).toBe(path.join(historyDir, 'state'))
    expect(transcriptPath).toBe(path.join(historyDir, 'transcripts', 'exploring', 'task-1.md'))
    expect(eventsPath).toBe(path.join(historyDir, 'events', 'recent-events.jsonl'))
    expect(debugLedgerPath).toBe(path.join(historyDir, 'context-debug', 'context-debug.jsonl'))
    expect(debugSnapshotDir).toBe(path.join(historyDir, 'context-debug', 'snapshots', 'task-1'))
    expect(transcriptPath).not.toContain(`${path.sep}memory${path.sep}`)
    expect(debugLedgerPath).not.toContain(`${path.sep}memory${path.sep}`)
  })

  it('can opt in to project-local state explicitly', () => {
    const projectRoot = path.join(tmp, 'repo')
    process.env.GUILDHALL_PROJECT_STATE_PLACEMENT = 'project'

    expect(getProjectStateDir(projectRoot)).toBe(path.join(projectRoot, '.guildhall'))

    delete process.env.GUILDHALL_PROJECT_STATE_PLACEMENT
  })

  it('migrates legacy project-local task and memory state into system storage', async () => {
    const projectRoot = path.join(tmp, 'repo')
    const legacyDir = getProjectSharedStateDir(projectRoot)
    await fs.mkdir(path.join(legacyDir, 'tasks', 'archive'), { recursive: true })
    await fs.mkdir(path.join(legacyDir, 'structural-map'), { recursive: true })
    await fs.writeFile(path.join(legacyDir, 'TASKS.json'), '{"version":1,"tasks":[]}\n', 'utf8')
    await fs.writeFile(path.join(legacyDir, 'MEMORY.md'), '# Memory\n', 'utf8')
    await fs.writeFile(path.join(legacyDir, 'PROGRESS.md'), '# Progress\n', 'utf8')
    await fs.writeFile(path.join(legacyDir, 'DECISIONS.md'), '# Decisions\n', 'utf8')
    await fs.writeFile(path.join(legacyDir, 'tasks', 'archive', 'done.json'), '{"id":"done"}\n', 'utf8')
    await fs.writeFile(path.join(legacyDir, 'structural-map', 'accepted.json'), '{"version":1}\n', 'utf8')
    await fs.writeFile(path.join(legacyDir, 'artifacts.yaml'), 'artifacts: []\n', 'utf8')

    const result = await migrateProjectStateToSystem(projectRoot)
    const systemStateDir = getProjectSystemStateDir(projectRoot)

    expect(result.migrated).toBe(true)
    expect(result.movedEntries).toEqual(expect.arrayContaining([
      'TASKS.json',
      'MEMORY.md',
      'PROGRESS.md',
      'DECISIONS.md',
      'tasks',
      'structural-map',
    ]))
    await expect(fs.readFile(path.join(systemStateDir, 'TASKS.json'), 'utf8')).resolves.toContain('"tasks"')
    await expect(fs.readFile(path.join(systemStateDir, 'tasks', 'archive', 'done.json'), 'utf8')).resolves.toContain('done')
    await expect(fs.stat(path.join(legacyDir, 'TASKS.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(path.join(legacyDir, 'tasks'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(path.join(legacyDir, 'artifacts.yaml'), 'utf8')).resolves.toContain('artifacts')
    expect(inferProjectRootFromMemoryDir(systemStateDir)).toBe(path.resolve(projectRoot))
  })

  it('preserves conflicting legacy state in system storage instead of overwriting or dropping it', async () => {
    const projectRoot = path.join(tmp, 'repo')
    const legacyDir = getProjectSharedStateDir(projectRoot)
    const systemStateDir = getProjectSystemStateDir(projectRoot)
    await fs.mkdir(legacyDir, { recursive: true })
    await fs.writeFile(path.join(systemStateDir, 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [{ id: 'system-task', status: 'ready' }],
    }), 'utf8')
    await fs.writeFile(path.join(legacyDir, 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [{ id: 'legacy-task', status: 'blocked' }],
    }), 'utf8')

    const result = await migrateProjectStateToSystem(projectRoot)
    const systemEntries = await fs.readdir(systemStateDir)
    const conflictEntry = systemEntries.find(entry => entry.startsWith('TASKS.json.migration-conflict-'))

    expect(result.migrated).toBe(true)
    await expect(fs.readFile(path.join(systemStateDir, 'TASKS.json'), 'utf8')).resolves.toContain('system-task')
    expect(conflictEntry).toBeTruthy()
    await expect(fs.readFile(path.join(systemStateDir, conflictEntry!), 'utf8')).resolves.toContain('legacy-task')
    await expect(fs.stat(path.join(legacyDir, 'TASKS.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports size and oldest transcript for local history health', async () => {
    const projectRoot = path.join(tmp, 'repo')
    const transcriptPath = getProjectTranscriptPath(projectRoot, 'exploring', 'task-1')
    await fs.mkdir(path.dirname(transcriptPath), { recursive: true })
    await fs.writeFile(transcriptPath, 'hello local transcript\n', 'utf8')

    const health = await getProjectLocalHistoryHealth(projectRoot)

    expect(health.projectRoot).toBe(path.resolve(projectRoot))
    expect(health.totalBytes).toBeGreaterThan(0)
    expect(health.fileCount).toBe(1)
    expect(health.oldestTranscriptPath).toBe(transcriptPath)
  })
})
