import { describe, it, expect } from 'vitest'
import { runShell, shellTool } from '../shell.js'

// ---------------------------------------------------------------------------
// Shell tool tests (AC-06 — gate runner pass/fail logic)
// These are safety-critical: hard gates depend entirely on correct
// success/failure detection from shell command execution.
// ---------------------------------------------------------------------------

const ctx = { cwd: '/tmp', metadata: {} }

describe('runShell — success cases', () => {
  it('returns success=true for a command that exits 0', () => {
    const result = runShell({ command: 'echo hello', cwd: '/tmp', timeoutMs: 5000 })
    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('hello')
  })

  it('captures stdout in output', () => {
    const result = runShell({ command: 'echo "forge test output"', cwd: '/tmp', timeoutMs: 5000 })
    expect(result.output).toContain('forge test output')
  })

  it('runs commands in the specified working directory', () => {
    const result = runShell({ command: 'pwd', cwd: '/tmp', timeoutMs: 5000 })
    expect(result.success).toBe(true)
    expect(result.output).toContain('/tmp')
  })
})

describe('runShell — failure cases', () => {
  it('returns success=false for a command that exits non-zero', () => {
    const result = runShell({ command: 'exit 1', cwd: '/tmp', timeoutMs: 5000 })
    expect(result.success).toBe(false)
    expect(result.exitCode).not.toBe(0)
  })

  it('returns success=false for a command that does not exist', () => {
    const result = runShell({
      command: 'nonexistent-command-xyz-abc',
      cwd: '/tmp',
      timeoutMs: 5000,
    })
    expect(result.success).toBe(false)
  })

  it('captures stderr output on failure', () => {
    const result = runShell({
      command: 'ls /nonexistent-path-xyz',
      cwd: '/tmp',
      timeoutMs: 5000,
    })
    expect(result.success).toBe(false)
    expect(result.output.length).toBeGreaterThan(0)
  })

  it('returns success=false when working directory does not exist', () => {
    const result = runShell({
      command: 'echo hello',
      cwd: '/nonexistent-dir-xyz',
      timeoutMs: 5000,
    })
    expect(result.success).toBe(false)
  })

  it('returns success=false on timeout', () => {
    const result = runShell({ command: 'sleep 10', cwd: '/tmp', timeoutMs: 100 })
    expect(result.success).toBe(false)
  })
})

describe('runShell — gate-specific scenarios', () => {
  it('correctly detects a passing typecheck-like command', () => {
    const result = runShell({ command: 'node --version', cwd: '/tmp', timeoutMs: 10_000 })
    expect(result.success).toBe(true)
    expect(result.output).toMatch(/^v\d+/)
  })

  it('correctly detects a failing gate — non-zero exit is always a hard failure', () => {
    const result = runShell({
      command: 'node -e "process.exit(2)"',
      cwd: '/tmp',
      timeoutMs: 5000,
    })
    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(2)
  })

  it('captures multi-line output for gate failure diagnosis', () => {
    const result = runShell({
      command: 'node -e "console.error(\'line1\\nline2\\nline3\'); process.exit(1)"',
      cwd: '/tmp',
      timeoutMs: 5000,
    })
    expect(result.success).toBe(false)
    expect(result.output).toContain('line1')
    expect(result.output).toContain('line3')
  })
})

describe('shellTool — engine-tool interface', () => {
  it('wraps runShell and surfaces structured metadata', async () => {
    const result = await shellTool.execute(
      { command: 'echo engine', cwd: '/tmp', timeoutMs: 5000 },
      ctx,
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('engine')
    expect(result.metadata).toMatchObject({ success: true, exitCode: 0 })
  })

  it('sets is_error=true on command failure', async () => {
    const result = await shellTool.execute(
      { command: 'exit 3', cwd: '/tmp', timeoutMs: 5000 },
      ctx,
    )
    expect(result.is_error).toBe(true)
    expect(result.metadata).toMatchObject({ success: false, exitCode: 3 })
  })

  it('is not declared read-only (shell can mutate state)', () => {
    expect(shellTool.isReadOnly({ command: 'echo', cwd: '/tmp', timeoutMs: 1000 })).toBe(false)
  })
})

describe('runShell — interactive-scaffold preflight', () => {
  it('blocks `npm create vite` without a non-interactive flag', () => {
    const result = runShell({
      command: 'npm create vite my-app',
      cwd: '/tmp',
      timeoutMs: 5000,
    })
    expect(result.success).toBe(false)
    expect(result.interactiveRequired).toBe(true)
    expect(result.exitCode).toBe(-1)
    expect(result.output).toContain('non-interactive')
  })

  it('passes `npm create vite --yes` through to the shell', () => {
    const result = runShell({
      command: 'npm create vite --yes --help',
      cwd: '/tmp',
      timeoutMs: 5000,
    })
    // We don't care whether the fake command succeeds; we only care that
    // preflight didn't short-circuit it.
    expect(result.interactiveRequired).toBeUndefined()
  })

  it('does not flag unrelated commands', () => {
    const result = runShell({ command: 'echo hello', cwd: '/tmp', timeoutMs: 5000 })
    expect(result.interactiveRequired).toBeUndefined()
  })
})

describe('runShell — output formatting', () => {
  it('normalizes CRLF to LF', () => {
    const result = runShell({
      command: "node -e \"process.stdout.write('a\\r\\nb\\r\\nc')\"",
      cwd: '/tmp',
      timeoutMs: 5000,
    })
    expect(result.success).toBe(true)
    expect(result.output).toBe('a\nb\nc')
  })

  it('truncates output over 12000 chars with a marker', () => {
    // Print 15000 x'es — well over the 12000-char cap.
    const result = runShell({
      command: "node -e \"process.stdout.write('x'.repeat(15000))\"",
      cwd: '/tmp',
      timeoutMs: 5000,
    })
    expect(result.success).toBe(true)
    expect(result.output.endsWith('...[truncated]...')).toBe(true)
    expect(result.output.length).toBeLessThan(15000)
    expect(result.output.length).toBeGreaterThan(12000)
  })

  it('returns the "(no output)" sentinel for successful silent commands', () => {
    const result = runShell({ command: 'true', cwd: '/tmp', timeoutMs: 5000 })
    expect(result.success).toBe(true)
    expect(result.output).toBe('(no output)')
  })
})

describe('runShell — timeout with partial output', () => {
  it('marks timedOut and includes a timeout banner', () => {
    const result = runShell({
      command: "node -e \"console.log('before'); setTimeout(() => {}, 5000)\"",
      cwd: '/tmp',
      timeoutMs: 500,
    })
    expect(result.success).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.output).toContain('timed out')
  })
})
