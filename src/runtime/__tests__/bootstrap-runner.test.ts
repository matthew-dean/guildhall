import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBootstrap, readBootstrapStatus, computeLockfileHash } from '../bootstrap-runner.js'
import { getProjectLocalHistoryDir } from '@guildhall/sessions'

function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'guildhall-bootstrap-'))
  mkdirSync(join(d, 'memory'))
  process.env.GUILDHALL_DATA_DIR = join(d, 'data')
  return d
}

describe('computeLockfileHash', () => {
  let dir = ''
  beforeEach(() => {
    dir = makeTmp()
  })
  afterEach(() => {
    delete process.env.GUILDHALL_DATA_DIR
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null when no lockfile exists', () => {
    expect(computeLockfileHash(dir)).toBeNull()
  })

  it('hashes pnpm-lock.yaml deterministically', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 6.0\n')
    const a = computeLockfileHash(dir)
    const b = computeLockfileHash(dir)
    expect(a).not.toBeNull()
    expect(a).toBe(b)
  })

  it('returns different hashes for different lockfile contents', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'a')
    const a = computeLockfileHash(dir)
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'b')
    const b = computeLockfileHash(dir)
    expect(a).not.toBe(b)
  })
})

describe('runBootstrap', () => {
  let dir = ''
  let originalPath = ''
  beforeEach(() => {
    dir = makeTmp()
    originalPath = process.env.PATH ?? ''
  })
  afterEach(() => {
    process.env.PATH = originalPath
    delete process.env.GUILDHALL_DATA_DIR
    rmSync(dir, { recursive: true, force: true })
  })

  it('succeeds with empty commands (no-op)', () => {
    const res = runBootstrap({
      projectPath: dir,
      memoryDir: join(dir, 'memory'),
      commands: [],
      successGates: [],
      timeoutMs: 5_000,
    })
    expect(res.success).toBe(true)
    expect(res.steps).toEqual([])
  })

  it('runs commands sequentially and records pass results', () => {
    const res = runBootstrap({
      projectPath: dir,
      memoryDir: join(dir, 'memory'),
      commands: ['true'],
      successGates: ['true'],
      timeoutMs: 5_000,
    })
    expect(res.success).toBe(true)
    expect(res.steps).toHaveLength(2)
    expect(res.steps[0]?.command).toBe('true')
    expect(res.steps[0]?.result).toBe('pass')
    expect(res.steps[1]?.command).toBe('true')
    expect(res.steps[1]?.kind).toBe('gate')
  })

  it('stops at first failing command and reports failure', () => {
    const res = runBootstrap({
      projectPath: dir,
      memoryDir: join(dir, 'memory'),
      commands: ['false', 'true'],
      successGates: ['true'],
      timeoutMs: 5_000,
    })
    expect(res.success).toBe(false)
    expect(res.steps).toHaveLength(1)
    expect(res.steps[0]?.result).toBe('fail')
  })

  it('runs successGates after all commands pass and fails bootstrap if any gate fails', () => {
    const res = runBootstrap({
      projectPath: dir,
      memoryDir: join(dir, 'memory'),
      commands: ['true'],
      successGates: ['false'],
      timeoutMs: 5_000,
    })
    expect(res.success).toBe(false)
    expect(res.steps).toHaveLength(2)
    expect(res.steps[1]?.kind).toBe('gate')
    expect(res.steps[1]?.result).toBe('fail')
  })

  it('runs bootstrap commands with CI=true so non-tty pnpm installs can proceed', () => {
    const res = runBootstrap({
      projectPath: dir,
      memoryDir: join(dir, 'memory'),
      commands: ['test "$CI" = "true"'],
      successGates: [],
      timeoutMs: 5_000,
    })
    expect(res.success).toBe(true)
    expect(res.steps[0]?.result).toBe('pass')
  })

  it('runs bootstrap commands with pnpm dependency scripts disabled for noninteractive worktrees', () => {
    const res = runBootstrap({
      projectPath: dir,
      memoryDir: join(dir, 'memory'),
      commands: ['test "$PNPM_CONFIG_IGNORE_SCRIPTS" = "true"'],
      successGates: [],
      timeoutMs: 5_000,
    })
    expect(res.success).toBe(true)
    expect(res.steps[0]?.result).toBe('pass')
  })

  it('does not block work when pnpm install only reports ignored build scripts', () => {
    const fakePnpm = join(dir, 'pnpm')
    writeFileSync(
      fakePnpm,
      [
        '#!/bin/sh',
        'echo "Packages: +316"',
        'echo "[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.24.2" 1>&2',
        'exit 1',
      ].join('\n'),
    )
    chmodSync(fakePnpm, 0o755)
    process.env.PATH = `${dir}:${originalPath}`

    const res = runBootstrap({
      projectPath: dir,
      memoryDir: join(dir, 'memory'),
      commands: ['pnpm install'],
      successGates: [],
      timeoutMs: 5_000,
    })

    expect(res.success).toBe(true)
    expect(res.steps[0]).toMatchObject({
      command: 'pnpm install',
      result: 'pass',
      exitCode: 1,
    })
    expect(res.steps[0]?.output).toContain('ERR_PNPM_IGNORED_BUILDS')
  })

  it('repairs an outdated pnpm lockfile inside the isolated worktree', () => {
    const fakePnpm = join(dir, 'pnpm')
    writeFileSync(
      fakePnpm,
      [
        '#!/bin/sh',
        'case "$*" in',
        '  *--no-frozen-lockfile*) echo "Packages: +1"; exit 0 ;;',
        '  *) echo "ERR_PNPM_OUTDATED_LOCKFILE" 1>&2; exit 1 ;;',
        'esac',
      ].join('\n'),
    )
    chmodSync(fakePnpm, 0o755)
    process.env.PATH = `${dir}:${originalPath}`

    const res = runBootstrap({
      projectPath: dir,
      memoryDir: join(dir, 'memory'),
      commands: ['pnpm install'],
      successGates: [],
      timeoutMs: 5_000,
    })

    expect(res.success).toBe(true)
    expect(res.steps[0]).toMatchObject({
      command: 'pnpm install --no-frozen-lockfile',
      result: 'pass',
    })
    expect(res.steps[0]?.output).toContain('ERR_PNPM_OUTDATED_LOCKFILE')
    expect(res.steps[0]?.output).toContain('retried the isolated install')
  })

  it('persists status to user-local history with lockfileHash', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'x')
    runBootstrap({
      projectPath: dir,
      memoryDir: join(dir, 'memory'),
      commands: ['true'],
      successGates: [],
      timeoutMs: 5_000,
    })
    const statusPath = join(getProjectLocalHistoryDir(dir), 'bootstrap.json')
    expect(existsSync(statusPath)).toBe(true)
    const status = JSON.parse(readFileSync(statusPath, 'utf-8')) as {
      success: boolean
      lockfileHash: string | null
      lastRunAt: string
    }
    expect(status.success).toBe(true)
    expect(status.lockfileHash).not.toBeNull()
    expect(status.lastRunAt).toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it('readBootstrapStatus returns null when no status file exists', () => {
    expect(readBootstrapStatus(join(dir, 'memory'))).toBeNull()
  })

  it('readBootstrapStatus returns parsed status after a run', () => {
    runBootstrap({
      projectPath: dir,
      memoryDir: join(dir, 'memory'),
      commands: ['true'],
      successGates: [],
      timeoutMs: 5_000,
    })
    const status = readBootstrapStatus(join(dir, 'memory'))
    expect(status).not.toBeNull()
    expect(status?.success).toBe(true)
  })
})
