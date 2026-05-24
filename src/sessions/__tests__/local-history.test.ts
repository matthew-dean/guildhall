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
  getProjectStateDir,
  getProjectTranscriptPath,
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
    const transcriptPath = getProjectTranscriptPath(projectRoot, 'exploring', 'task-1')
    const eventsPath = getProjectRecentEventsPath(projectRoot)
    const debugLedgerPath = getProjectContextDebugLedgerPath(projectRoot)
    const debugSnapshotDir = getProjectContextDebugSnapshotDir(projectRoot, 'task-1')

    expect(historyDir).toMatch(path.join(tmp, 'data', 'projects'))
    expect(historyDir).toContain('repo-')
    expect(projectStateDir).toBe(path.join(projectRoot, '.guildhall'))
    expect(transcriptPath).toBe(path.join(historyDir, 'transcripts', 'exploring', 'task-1.md'))
    expect(eventsPath).toBe(path.join(historyDir, 'events', 'recent-events.jsonl'))
    expect(debugLedgerPath).toBe(path.join(historyDir, 'context-debug', 'context-debug.jsonl'))
    expect(debugSnapshotDir).toBe(path.join(historyDir, 'context-debug', 'snapshots', 'task-1'))
    expect(transcriptPath).not.toContain(`${path.sep}memory${path.sep}`)
    expect(debugLedgerPath).not.toContain(`${path.sep}memory${path.sep}`)
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
