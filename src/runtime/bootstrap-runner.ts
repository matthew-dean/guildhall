import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runShell } from '@guildhall/tools'

/**
 * Bootstrap phase: runs `commands` (install, migrations, etc.) then
 * `successGates` (typecheck/build/test) sequentially inside projectPath.
 * Status (including stop-at-first-failure step log and lockfile hash) is
 * persisted to `<memoryDir>/bootstrap.json` so the orchestrator can skip
 * re-runs when the lockfile is unchanged.
 *
 * This function is the single seam between "project is bootstrapped" and
 * "orchestrator may dispatch tasks." Callers decide whether to block on
 * success or surface the failure to the UI.
 */

export type BootstrapStepKind = 'command' | 'gate'
export type BootstrapStepResult = 'pass' | 'fail'

export interface BootstrapStep {
  kind: BootstrapStepKind
  command: string
  result: BootstrapStepResult
  exitCode: number
  output: string
  durationMs: number
}

export interface BootstrapStatus {
  success: boolean
  lastRunAt: string
  durationMs: number
  commandHash: string
  lockfileHash: string | null
  steps: BootstrapStep[]
}

export interface BootstrapOptions {
  projectPath: string
  memoryDir: string
  commands: readonly string[]
  successGates: readonly string[]
  timeoutMs: number
}

export interface BootstrapResult {
  success: boolean
  steps: BootstrapStep[]
}

const LOCKFILES = [
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'bun.lockb',
  'uv.lock',
  'poetry.lock',
  'requirements.txt',
] as const

export function computeLockfileHash(projectPath: string): string | null {
  const h = createHash('sha256')
  let anyFound = false
  for (const name of LOCKFILES) {
    const p = join(projectPath, name)
    if (!existsSync(p)) continue
    anyFound = true
    h.update(name)
    h.update('\0')
    h.update(readFileSync(p))
    h.update('\0')
  }
  return anyFound ? h.digest('hex') : null
}

function commandHash(commands: readonly string[], gates: readonly string[]): string {
  const h = createHash('sha256')
  for (const c of commands) h.update('c:' + c + '\n')
  for (const g of gates) h.update('g:' + g + '\n')
  return h.digest('hex')
}

function statusPath(memoryDir: string): string {
  return join(memoryDir, 'bootstrap.json')
}

export function readBootstrapStatus(memoryDir: string): BootstrapStatus | null {
  const p = statusPath(memoryDir)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as BootstrapStatus
  } catch {
    return null
  }
}

function writeBootstrapStatus(memoryDir: string, status: BootstrapStatus): void {
  const p = statusPath(memoryDir)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(status, null, 2))
}

function runStep(
  kind: BootstrapStepKind,
  command: string,
  opts: { projectPath: string; timeoutMs: number },
): BootstrapStep {
  const start = Date.now()
  const res = runShell({ command, cwd: opts.projectPath, timeoutMs: opts.timeoutMs })
  return {
    kind,
    command,
    result: res.success ? 'pass' : 'fail',
    exitCode: res.exitCode,
    output: res.output,
    durationMs: Date.now() - start,
  }
}

export function runBootstrap(opts: BootstrapOptions): BootstrapResult {
  const start = Date.now()
  const steps: BootstrapStep[] = []
  let success = true

  for (const cmd of opts.commands) {
    const step = runStep('command', cmd, opts)
    steps.push(step)
    if (step.result === 'fail') {
      success = false
      break
    }
  }

  if (success) {
    for (const gate of opts.successGates) {
      const step = runStep('gate', gate, opts)
      steps.push(step)
      if (step.result === 'fail') {
        success = false
        break
      }
    }
  }

  const status: BootstrapStatus = {
    success,
    lastRunAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    commandHash: commandHash(opts.commands, opts.successGates),
    lockfileHash: computeLockfileHash(opts.projectPath),
    steps,
  }
  writeBootstrapStatus(opts.memoryDir, status)

  return { success, steps }
}

/**
 * Decide whether bootstrap needs to run given the current status. Returns
 * true if:
 *   - no status file exists
 *   - previous run failed
 *   - command/gate set has changed
 *   - lockfile hash has changed since the last successful run
 */
export function bootstrapNeeded(
  memoryDir: string,
  projectPath: string,
  commands: readonly string[],
  successGates: readonly string[],
): boolean {
  const status = readBootstrapStatus(memoryDir)
  if (!status) return true
  if (!status.success) return true
  if (status.commandHash !== commandHash(commands, successGates)) return true
  const currentHash = computeLockfileHash(projectPath)
  if (currentHash !== status.lockfileHash) return true
  return false
}
