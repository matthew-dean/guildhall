import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  attemptRemoteSync,
  enterLocalOnlyMode,
  exitLocalOnlyMode,
  isLocalOnly,
  readLocalOnlyState,
  localOnlyPath,
} from '../local-only-mode.js'

// FR-29 / AC-20 verification — simulated push failure transitions the
// project to local_only mode with a PROGRESS.md entry; a subsequent
// successful push auto-restores normal mode.

let tmpDir: string
let memoryDir: string
let progressPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-localonly-'))
  memoryDir = path.join(tmpDir, 'memory')
  await fs.mkdir(memoryDir, { recursive: true })
  progressPath = path.join(memoryDir, 'PROGRESS.md')
  await fs.writeFile(progressPath, '# Progress\n', 'utf-8')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('local-only mode primitives', () => {
  it('starts disengaged', () => {
    expect(isLocalOnly(memoryDir)).toBe(false)
  })

  it('enterLocalOnlyMode writes state and a PROGRESS entry', async () => {
    const result = await enterLocalOnlyMode(memoryDir, {
      reason: 'git push rejected (non-fast-forward)',
      agentId: 'worker-agent',
      domain: 'looma',
    })
    expect(result.alreadyLocal).toBe(false)
    expect(isLocalOnly(memoryDir)).toBe(true)

    const state = await readLocalOnlyState(memoryDir)
    expect(state?.lastError).toContain('non-fast-forward')
    expect(state?.enteredAt).toBeDefined()

    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toMatch(/BLOCKED/)
    expect(progress).toContain('local-only')
  })

  it('re-entering does not duplicate the PROGRESS entry and preserves enteredAt', async () => {
    await enterLocalOnlyMode(memoryDir, { reason: 'first failure' })
    const firstState = await readLocalOnlyState(memoryDir)
    const firstEnteredAt = firstState!.enteredAt

    await new Promise(r => setTimeout(r, 5))
    const second = await enterLocalOnlyMode(memoryDir, { reason: 'second failure' })
    expect(second.alreadyLocal).toBe(true)

    const secondState = await readLocalOnlyState(memoryDir)
    expect(secondState?.enteredAt).toBe(firstEnteredAt)
    expect(secondState?.lastError).toContain('second failure')

    const progress = await fs.readFile(progressPath, 'utf-8')
    const blockedCount = (progress.match(/Entered local-only mode/g) ?? []).length
    expect(blockedCount).toBe(1)
  })

  it('exitLocalOnlyMode clears state and logs a milestone entry', async () => {
    await enterLocalOnlyMode(memoryDir, { reason: 'push failure' })
    const result = await exitLocalOnlyMode(memoryDir)
    expect(result.wasLocal).toBe(true)
    expect(isLocalOnly(memoryDir)).toBe(false)

    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toMatch(/MILESTONE/)
    expect(progress).toMatch(/remote reachable again|Exited local-only mode/)
  })

  it('exitLocalOnlyMode is a no-op when not in local-only', async () => {
    const result = await exitLocalOnlyMode(memoryDir)
    expect(result.wasLocal).toBe(false)
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).not.toMatch(/MILESTONE/)
  })
})

describe('attemptRemoteSync — the AC-20 gate', () => {
  it('returns ok and stays out of local-only when the action succeeds', async () => {
    const result = await attemptRemoteSync(memoryDir, async () => {}, {
      label: 'git push',
    })
    expect(result).toEqual({ ok: true, wasLocal: false })
    expect(isLocalOnly(memoryDir)).toBe(false)
  })

  it('enters local-only when the action fails and logs a blocked PROGRESS entry', async () => {
    const result = await attemptRemoteSync(
      memoryDir,
      async () => { throw new Error('connection refused') },
      { label: 'git push', agentId: 'worker', domain: 'looma' },
    )
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.entered).toBe(true)
      expect(result.error).toContain('connection refused')
    }
    expect(isLocalOnly(memoryDir)).toBe(true)
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toMatch(/BLOCKED/)
    expect(progress).toContain('git push failed: connection refused')
  })

  it('auto-restores from local-only when the next action succeeds', async () => {
    // First: push fails → enter local-only
    await attemptRemoteSync(
      memoryDir,
      async () => { throw new Error('unreachable host') },
      { label: 'git push' },
    )
    expect(isLocalOnly(memoryDir)).toBe(true)

    // Second: push succeeds → exit local-only, log milestone
    const recovery = await attemptRemoteSync(memoryDir, async () => {}, {
      label: 'git push',
    })
    expect(recovery).toEqual({ ok: true, wasLocal: true })
    expect(isLocalOnly(memoryDir)).toBe(false)

    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toMatch(/BLOCKED[\s\S]+MILESTONE/) // blocked came first, milestone after
  })

  it('a second failure while already local-only does not duplicate PROGRESS entries', async () => {
    await attemptRemoteSync(
      memoryDir,
      async () => { throw new Error('first') },
      { label: 'push' },
    )
    await attemptRemoteSync(
      memoryDir,
      async () => { throw new Error('second') },
      { label: 'push' },
    )
    const progress = await fs.readFile(progressPath, 'utf-8')
    const blockedCount = (progress.match(/Entered local-only mode/g) ?? []).length
    expect(blockedCount).toBe(1)
    const state = await readLocalOnlyState(memoryDir)
    expect(state?.lastError).toContain('second')
  })
})

describe('localOnlyPath', () => {
  it('resolves under memory dir', () => {
    expect(localOnlyPath(memoryDir)).toBe(path.join(memoryDir, 'local-only.json'))
  })
})
