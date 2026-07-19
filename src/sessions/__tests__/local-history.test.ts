import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  getProjectContextDebugLedgerPath,
  getProjectContextDebugSnapshotDir,
  getProjectLocalHistoryDir,
  getProjectLocalHistoryHealth,
  getProjectMigrationSnapshotDir,
  getProjectRecentEventsPath,
  getProjectStateDir,
  getProjectTranscriptPath,
  appendProjectProgressHeartbeat,
  compactProjectProgressHeartbeats,
  PROJECT_HEARTBEAT_HISTORY_MAX_BYTES,
  ensureProjectLocalHistoryDir,
  localHistoryExists,
} from '../local-history.js'
import { readProjectCacheAllocationManifest, readProjectCacheOwnership } from '../project-cache-registry.js'

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
    const transcriptPath = getProjectTranscriptPath(projectRoot, 'exploring', 'task-1')
    const eventsPath = getProjectRecentEventsPath(projectRoot)
    const debugLedgerPath = getProjectContextDebugLedgerPath(projectRoot)
    const debugSnapshotDir = getProjectContextDebugSnapshotDir(projectRoot, 'task-1')
    const migrationSnapshotDir = getProjectMigrationSnapshotDir(projectRoot)

    expect(historyDir).toMatch(path.join(tmp, 'data', 'projects'))
    expect(historyDir).toContain('repo-')
    expect(projectStateDir).toBe(path.join(projectRoot, '.guildhall'))
    expect(transcriptPath).toBe(path.join(historyDir, 'transcripts', 'exploring', 'task-1.md'))
    expect(eventsPath).toBe(path.join(historyDir, 'events', 'recent-events.jsonl'))
    expect(debugLedgerPath).toBe(path.join(historyDir, 'context-debug', 'context-debug.jsonl'))
    expect(debugSnapshotDir).toBe(path.join(historyDir, 'context-debug', 'snapshots', 'task-1'))
    expect(migrationSnapshotDir).toBe(path.join(historyDir, 'migration-snapshots'))
    expect(transcriptPath).not.toContain(`${path.sep}memory${path.sep}`)
    expect(debugLedgerPath).not.toContain(`${path.sep}memory${path.sep}`)
    expect(localHistoryExists(projectRoot)).toBe(false)
  })

  it('allocates only through the explicit write boundary without registering temporary projects', () => {
    const projectRoot = path.join(tmp, 'repo')

    getProjectLocalHistoryDir(projectRoot)
    getProjectRecentEventsPath(projectRoot)
    getProjectContextDebugSnapshotDir(projectRoot, 'task-1')
    expect(localHistoryExists(projectRoot)).toBe(false)

    const ensured = ensureProjectLocalHistoryDir(projectRoot)
    expect(ensured).toBe(getProjectLocalHistoryDir(projectRoot))
    expect(localHistoryExists(projectRoot)).toBe(true)
    expect(readProjectCacheOwnership(projectRoot).registration).toBeNull()
    expect(readProjectCacheAllocationManifest(projectRoot)).toBeNull()
  })

  it('keeps unconfigured temporary projects out of the durable user cache', () => {
    const configuredDataDir = process.env.GUILDHALL_DATA_DIR
    delete process.env.GUILDHALL_DATA_DIR
    try {
      const projectRoot = path.join(os.tmpdir(), 'guildhall-ephemeral-fixture')
      const historyDir = getProjectLocalHistoryDir(projectRoot)
      expect(historyDir).toContain(path.join(os.tmpdir(), 'guildhall-projects'))
      expect(historyDir).not.toContain(path.join(os.homedir(), '.guildhall', 'data', 'projects'))
    } finally {
      if (configuredDataDir) process.env.GUILDHALL_DATA_DIR = configuredDataDir
    }
  })

  it('keeps temporary projects out of the default durable cache when the env leaks', () => {
    const configuredDataDir = process.env.GUILDHALL_DATA_DIR
    process.env.GUILDHALL_DATA_DIR = path.join(os.homedir(), '.guildhall', 'data')
    try {
      const projectRoot = path.join(os.tmpdir(), 'guildhall-leaked-default-fixture')
      const historyDir = getProjectLocalHistoryDir(projectRoot)
      expect(historyDir).toContain(path.join(os.tmpdir(), 'guildhall-projects'))
      expect(historyDir).not.toContain(path.join(os.homedir(), '.guildhall', 'data', 'projects'))
    } finally {
      if (configuredDataDir) process.env.GUILDHALL_DATA_DIR = configuredDataDir
      else delete process.env.GUILDHALL_DATA_DIR
    }
  })

  it('does not register an unconfigured temporary write as durable project state', async () => {
    const configuredDataDir = process.env.GUILDHALL_DATA_DIR
    delete process.env.GUILDHALL_DATA_DIR
    const projectRoot = path.join(os.tmpdir(), `guildhall-ephemeral-write-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    try {
      ensureProjectLocalHistoryDir(projectRoot)
      expect(readProjectCacheAllocationManifest(projectRoot)).toBeNull()
      expect(localHistoryExists(projectRoot)).toBe(true)
    } finally {
      await fs.rm(getProjectLocalHistoryDir(projectRoot), { recursive: true, force: true })
      if (configuredDataDir) process.env.GUILDHALL_DATA_DIR = configuredDataDir
    }
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

  it('keeps heartbeat history bounded at the writer and cleanup boundaries', async () => {
    const projectRoot = path.join(tmp, 'repo')
    const heartbeatPath = path.join(getProjectLocalHistoryDir(projectRoot), 'progress', 'heartbeats.md')

    await appendProjectProgressHeartbeat(heartbeatPath, Array.from({ length: 700 }, (_, index) => [
        `### HEARTBEAT — ${index}`,
        '',
        `detail ${'x'.repeat(900)}`,
      ].join('\n')).join('\n\n'))

    const bounded = await fs.readFile(heartbeatPath, 'utf8')
    expect(Buffer.byteLength(bounded)).toBeLessThanOrEqual(PROJECT_HEARTBEAT_HISTORY_MAX_BYTES)
    expect(bounded).toContain('HEARTBEAT — 699')
    expect(bounded).not.toContain('HEARTBEAT — 0')

    await fs.appendFile(heartbeatPath, Array.from({ length: 400 }, (_, index) => [
      `### LEGACY HEARTBEAT — ${index}`,
      '',
      `detail ${'y'.repeat(900)}`,
    ].join('\n')).join('\n\n'))
    const result = await compactProjectProgressHeartbeats(heartbeatPath)
    expect(result.compacted).toBe(true)
    expect(result.bytesAfter).toBeLessThanOrEqual(PROJECT_HEARTBEAT_HISTORY_MAX_BYTES)

    await appendProjectProgressHeartbeat(heartbeatPath, `### OVERSIZED\n${'z'.repeat(PROJECT_HEARTBEAT_HISTORY_MAX_BYTES * 2)}`)
    expect(Buffer.byteLength(await fs.readFile(heartbeatPath, 'utf8')))
      .toBeLessThanOrEqual(PROJECT_HEARTBEAT_HISTORY_MAX_BYTES)
  })

})
