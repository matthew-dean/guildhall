import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  stopRequestedPath,
  isStopRequested,
  writeStopRequested,
  clearStopRequested,
  ProcessRegistry,
  STOP_REQUESTED_FILENAME,
} from '../stop-requested.js'

// Unit tests for the FR-28 stop-marker and process registry primitives.

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-stop-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('stop-requested marker', () => {
  it('resolves the path under the memory directory', () => {
    expect(stopRequestedPath(tmpDir)).toBe(path.join(tmpDir, STOP_REQUESTED_FILENAME))
  })

  it('isStopRequested returns false for a clean workspace', () => {
    expect(isStopRequested(tmpDir)).toBe(false)
  })

  it('isStopRequested returns true after writeStopRequested', async () => {
    await writeStopRequested(tmpDir, { requestedAt: '2026-04-21T00:00:00Z', requestedBy: 'test' })
    expect(isStopRequested(tmpDir)).toBe(true)
  })

  it('clearStopRequested removes the marker', async () => {
    await writeStopRequested(tmpDir, { requestedAt: '2026-04-21T00:00:00Z' })
    await clearStopRequested(tmpDir)
    expect(isStopRequested(tmpDir)).toBe(false)
  })

  it('clearStopRequested is a no-op when there is no marker', async () => {
    await expect(clearStopRequested(tmpDir)).resolves.toBeUndefined()
  })

  it('writeStopRequested persists the detail as readable JSON', async () => {
    await writeStopRequested(tmpDir, {
      requestedAt: '2026-04-21T00:00:00Z',
      requestedBy: 'operator',
      reason: 'rolling restart',
    })
    const raw = await fs.readFile(stopRequestedPath(tmpDir), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.requestedBy).toBe('operator')
    expect(parsed.reason).toBe('rolling restart')
  })
})

describe('ProcessRegistry', () => {
  it('starts empty', () => {
    const reg = new ProcessRegistry()
    expect(reg.list()).toHaveLength(0)
  })

  it('registers and lists child entries', () => {
    const reg = new ProcessRegistry()
    reg.register({ pid: 1234, kind: 'dev-server', label: 'vite' })
    reg.register({ pid: 5678, kind: 'subprocess-worker', label: 'task-001', owningTaskId: 'task-001' })
    const list = reg.list()
    expect(list).toHaveLength(2)
    expect(list.find(e => e.pid === 1234)?.kind).toBe('dev-server')
  })

  it('unregister removes an entry', () => {
    const reg = new ProcessRegistry()
    reg.register({ pid: 1234, kind: 'dev-server', label: 'vite' })
    reg.unregister(1234)
    expect(reg.list()).toHaveLength(0)
  })

  it('shutdownAll calls the custom kill function once per entry', async () => {
    const reg = new ProcessRegistry()
    const calls: Array<{ pid: number; sig: NodeJS.Signals }> = []
    reg.register({
      pid: 1234,
      kind: 'dev-server',
      label: 'vite',
      kill: (sig) => { calls.push({ pid: 1234, sig }) },
    })
    reg.register({
      pid: 5678,
      kind: 'mcp',
      label: 'fs',
      kill: (sig) => { calls.push({ pid: 5678, sig }) },
    })
    await reg.shutdownAll({ graceMs: 50 })
    // Every child should receive at least SIGTERM; since the fake `kill`
    // doesn't actually exit the pid, the registry will try SIGKILL too iff
    // the pid is still alive via process.kill(pid, 0). Real pids here are
    // fake, so the liveness probe throws ESRCH → only SIGTERM is recorded.
    const terms = calls.filter(c => c.sig === 'SIGTERM')
    expect(terms).toHaveLength(2)
    expect(reg.list()).toHaveLength(0)
  })

  it('shutdownAll does not throw when a kill function throws', async () => {
    const reg = new ProcessRegistry()
    reg.register({
      pid: 1234,
      kind: 'other',
      label: 'noisy',
      kill: () => { throw new Error('boom') },
    })
    await expect(reg.shutdownAll({ graceMs: 10 })).resolves.toBeUndefined()
    expect(reg.list()).toHaveLength(0)
  })
})
