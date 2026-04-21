import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { runGate, runGates } from '../gate-runner.js'
import type { HardGate } from '@guildhall/core'

// ---------------------------------------------------------------------------
// Gate runner tests (FR-05 / AC-06)
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-gate-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

const mkGate = (overrides: Partial<HardGate> = {}): HardGate => ({
  id: 'test-gate',
  label: 'Test gate',
  command: 'true',
  timeoutMs: 10_000,
  ...overrides,
})

describe('runGate', () => {
  it('records passed=true when the command exits 0', async () => {
    const result = await runGate(mkGate({ command: 'true' }), { cwd: tmpDir })
    expect(result.passed).toBe(true)
    expect(result.gateId).toBe('test-gate')
    expect(result.type).toBe('hard')
  })

  it('records passed=false when the command exits non-zero', async () => {
    const result = await runGate(mkGate({ command: 'false' }), { cwd: tmpDir })
    expect(result.passed).toBe(false)
  })

  it('captures stdout in the output field', async () => {
    const result = await runGate(
      mkGate({ command: 'echo hello world' }),
      { cwd: tmpDir },
    )
    expect(result.output).toContain('hello world')
  })

  it('captures stderr in the output field', async () => {
    const result = await runGate(
      mkGate({ command: 'echo oops 1>&2; exit 3' }),
      { cwd: tmpDir },
    )
    expect(result.passed).toBe(false)
    expect(result.output).toContain('oops')
  })

  it('records the gate id exactly', async () => {
    const result = await runGate(
      mkGate({ id: 'typecheck', command: 'true' }),
      { cwd: tmpDir },
    )
    expect(result.gateId).toBe('typecheck')
  })

  it('kills the process and records timeout after timeoutMs', async () => {
    const result = await runGate(
      mkGate({ command: 'sleep 5', timeoutMs: 200 }),
      { cwd: tmpDir },
    )
    expect(result.passed).toBe(false)
    expect(result.output).toContain('TIMEOUT')
  })

  it('truncates output at maxOutputBytes', async () => {
    const result = await runGate(
      // Writes ~5000 bytes of 'x'
      mkGate({ command: 'printf "x%.0s" {1..5000}' }),
      { cwd: tmpDir, maxOutputBytes: 1000 },
    )
    const output = result.output ?? ''
    expect(output.length).toBeLessThan(1200) // 1000 + truncation marker
    expect(output).toContain('truncated')
  })

  it('respects cwd when running the command', async () => {
    const marker = 'marker-file.txt'
    await fs.writeFile(path.join(tmpDir, marker), 'x')
    const result = await runGate(
      mkGate({ command: 'ls marker-file.txt' }),
      { cwd: tmpDir },
    )
    expect(result.passed).toBe(true)
    expect(result.output).toContain(marker)
  })

  it('includes env variables passed via opts.env', async () => {
    const result = await runGate(
      mkGate({ command: 'echo $GATE_TEST_VAR' }),
      { cwd: tmpDir, env: { GATE_TEST_VAR: 'custom-value' } },
    )
    expect(result.output).toContain('custom-value')
  })

  it('uses injected now() for the checkedAt timestamp', async () => {
    const result = await runGate(
      mkGate({ command: 'true' }),
      { cwd: tmpDir, now: () => '2026-04-20T12:00:00Z' },
    )
    expect(result.checkedAt).toBe('2026-04-20T12:00:00Z')
  })

  it('records spawn errors as passed=false', async () => {
    // An impossible cwd triggers a spawn error path on some systems; when it
    // instead fails via shell with exit code we still want passed=false.
    const result = await runGate(
      mkGate({ command: 'definitely-not-a-real-command-xyz' }),
      { cwd: tmpDir },
    )
    expect(result.passed).toBe(false)
  })
})

describe('runGates', () => {
  it('runs every gate and collects results', async () => {
    const summary = await runGates({
      cwd: tmpDir,
      gates: [
        mkGate({ id: 'g1', command: 'true' }),
        mkGate({ id: 'g2', command: 'true' }),
      ],
    })
    expect(summary.results).toHaveLength(2)
    expect(summary.results.map((r) => r.gateId)).toEqual(['g1', 'g2'])
    expect(summary.allPassed).toBe(true)
  })

  it('returns allPassed=false when any gate fails', async () => {
    const summary = await runGates({
      cwd: tmpDir,
      gates: [
        mkGate({ id: 'g1', command: 'true' }),
        mkGate({ id: 'g2', command: 'false' }),
        mkGate({ id: 'g3', command: 'true' }),
      ],
    })
    expect(summary.allPassed).toBe(false)
    expect(summary.results.map((r) => r.passed)).toEqual([true, false, true])
  })

  it('stops at the first failure when failFast=true', async () => {
    const summary = await runGates({
      cwd: tmpDir,
      gates: [
        mkGate({ id: 'g1', command: 'true' }),
        mkGate({ id: 'g2', command: 'false' }),
        mkGate({ id: 'g3', command: 'true' }),
      ],
      failFast: true,
    })
    expect(summary.allPassed).toBe(false)
    expect(summary.results).toHaveLength(2)
  })

  it('returns allPassed=false when gate list is empty', async () => {
    const summary = await runGates({ cwd: tmpDir, gates: [] })
    expect(summary.allPassed).toBe(false)
    expect(summary.results).toHaveLength(0)
  })

  it('runs gates serially (order preserved)', async () => {
    const summary = await runGates({
      cwd: tmpDir,
      gates: [
        mkGate({ id: 'first', command: 'echo 1' }),
        mkGate({ id: 'second', command: 'echo 2' }),
        mkGate({ id: 'third', command: 'echo 3' }),
      ],
    })
    expect(summary.results.map((r) => r.gateId)).toEqual(['first', 'second', 'third'])
  })
})
