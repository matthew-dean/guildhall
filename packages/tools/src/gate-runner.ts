/**
 * Hard gate runner (FR-05 / AC-06).
 *
 * Executes registered hard gates as shell commands, captures their exit code
 * and combined output, and records structured GateResult entries. A task may
 * transition to `done` only if every hard gate returns `passed: true`.
 *
 * Gates are executed serially. Each gate runs in its own child process with a
 * per-gate timeout. On timeout the child is killed and the gate is recorded
 * as failed with a timeout marker in the output field.
 */

import { spawn } from 'node:child_process'
import type { HardGate, GateResult } from '@guildhall/core'

export interface RunGateOptions {
  cwd: string
  env?: Record<string, string>
  /** Override the current time (testing). */
  now?: () => string
  /** Cap on bytes captured from stdout+stderr to keep GateResult.output bounded. */
  maxOutputBytes?: number
}

export interface RunGatesOptions extends RunGateOptions {
  gates: HardGate[]
  /** Short-circuit on first failure. Default: false (run all). */
  failFast?: boolean
}

export interface GateRunSummary {
  allPassed: boolean
  results: GateResult[]
}

const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 // 16 KB

/**
 * Run a single hard gate and return a structured GateResult. Never throws;
 * errors become `passed: false` with the error in `output`.
 */
export async function runGate(
  gate: HardGate,
  opts: RunGateOptions,
): Promise<GateResult> {
  const now = opts.now ?? (() => new Date().toISOString())
  const maxBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  const started = now()

  return new Promise<GateResult>((resolve) => {
    const child = spawn(gate.command, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let collected = 0
    const chunks: string[] = []
    let timedOut = false

    const append = (buf: Buffer): void => {
      if (collected >= maxBytes) return
      const remaining = maxBytes - collected
      const slice = buf.length > remaining ? buf.subarray(0, remaining) : buf
      chunks.push(slice.toString('utf-8'))
      collected += slice.length
      if (collected >= maxBytes) chunks.push('\n… output truncated …')
    }

    child.stdout.on('data', append)
    child.stderr.on('data', append)

    const timeout = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGKILL')
      } catch {
        // process may already be gone
      }
    }, gate.timeoutMs)

    child.on('error', (err) => {
      clearTimeout(timeout)
      resolve({
        gateId: gate.id,
        type: 'hard',
        passed: false,
        output: `spawn error: ${err.message}`,
        checkedAt: started,
      })
    })

    child.on('close', (code) => {
      clearTimeout(timeout)
      const output = chunks.join('').trim()
      if (timedOut) {
        resolve({
          gateId: gate.id,
          type: 'hard',
          passed: false,
          output: output
            ? `TIMEOUT after ${gate.timeoutMs}ms\n${output}`
            : `TIMEOUT after ${gate.timeoutMs}ms`,
          checkedAt: started,
        })
        return
      }
      resolve({
        gateId: gate.id,
        type: 'hard',
        passed: code === 0,
        output,
        checkedAt: started,
      })
    })
  })
}

/**
 * Run every hard gate in sequence. Returns a summary plus each GateResult.
 * Set `failFast: true` to abort as soon as one gate fails.
 */
export async function runGates(opts: RunGatesOptions): Promise<GateRunSummary> {
  const results: GateResult[] = []
  for (const gate of opts.gates) {
    const result = await runGate(gate, opts)
    results.push(result)
    if (opts.failFast && !result.passed) break
  }
  const allPassed =
    opts.gates.length > 0 && results.length === opts.gates.length && results.every((r) => r.passed)
  return { allPassed, results }
}
