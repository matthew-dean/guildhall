/**
 * Structural bootstrap verification.
 *
 * Produces the `bootstrap` block that lives in `guildhall.yaml`:
 *   - detects the package manager from lockfiles
 *   - derives gate commands from `package.json` scripts (with a tsconfig-based
 *     typecheck fallback)
 *   - runs the install command and dry-runs each gate command so we know the
 *     tooling actually resolves before any agent is dispatched
 *
 * The orchestrator uses `bootstrap.verifiedAt` + `bootstrap.install.status`
 * as a hard precondition before dispatching work. If a gate command can't
 * be resolved, its entry is marked `available: false` with a human-readable
 * `unavailableReason` — gate-checker skips those instead of failing the task
 * on an infrastructure problem.
 *
 * Kept deliberately synchronous over the child process primitives so tests
 * can mock a single seam (`spawnSync`) rather than chasing async plumbing.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun' | 'none'
export type GateName = 'lint' | 'typecheck' | 'build' | 'test'
export type InstallStatus = 'ok' | 'failed'

export interface GateCommand {
  command: string
  available: boolean
  unavailableReason?: string
}

export type GateCommandMap = Record<GateName, GateCommand>

export interface BootstrapInstallBlock {
  command: string
  lastRunAt?: string
  status?: InstallStatus
}

export interface BootstrapBlock {
  verifiedAt: string
  packageManager: PackageManager
  install: BootstrapInstallBlock
  gates: GateCommandMap
}

export interface BootstrapResult {
  ok: boolean
  bootstrap: BootstrapBlock
  logs: string[]
}

export interface BootstrapOptions {
  /** Skip the install step — only verify gate resolution. Tests use this. */
  skipInstall?: boolean
  /** Called once per log line so callers can stream output. */
  onLog?: (line: string) => void
  /** Timeout for the install step in ms (default 10 minutes). */
  installTimeoutMs?: number
  /**
   * Injection point for tests — defaults to node:child_process `spawnSync`.
   * Keeping this explicit means real `pnpm install` never fires from tests.
   */
  spawner?: Spawner
  /**
   * Injection point for the `guildhall.yaml` write. Defaults to a plain
   * fs.writeFileSync; tests can capture the payload without touching disk.
   */
  nowIso?: () => string
}

export interface SpawnerInvocation {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
}

export type Spawner = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions,
) => SpawnerInvocation

const defaultSpawner: Spawner = (command, args, options) => {
  const res = spawnSync(command, args as string[], options)
  const stdout = String(res.stdout ?? '')
  const stderr = String(res.stderr ?? '')
  const exitCode = res.status ?? (res.error ? -1 : 0)
  return { ok: exitCode === 0 && !res.error, exitCode, stdout, stderr }
}

// ---------------------------------------------------------------------------
// Package-manager detection
// ---------------------------------------------------------------------------

const LOCKFILE_PRIORITY: Array<{ file: string; pm: Exclude<PackageManager, 'none'> }> = [
  { file: 'pnpm-lock.yaml', pm: 'pnpm' },
  { file: 'package-lock.json', pm: 'npm' },
  { file: 'yarn.lock', pm: 'yarn' },
  { file: 'bun.lockb', pm: 'bun' },
]

export function detectPackageManager(projectPath: string): PackageManager {
  for (const { file, pm } of LOCKFILE_PRIORITY) {
    if (existsSync(join(projectPath, file))) return pm
  }
  return 'none'
}

// ---------------------------------------------------------------------------
// Gate-command detection
// ---------------------------------------------------------------------------

interface PackageJson {
  scripts?: Record<string, string>
}

function readPackageJson(projectPath: string): PackageJson | null {
  const p = join(projectPath, 'package.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as PackageJson
  } catch {
    return null
  }
}

/**
 * Matches a gate to a script name in `package.json`. Each gate has a
 * primary name plus optional aliases; the first match wins.
 */
const GATE_SCRIPT_NAMES: Record<GateName, readonly string[]> = {
  lint: ['lint'],
  typecheck: ['typecheck', 'type-check', 'tsc', 'types'],
  build: ['build'],
  test: ['test'],
}

function unavailable(reason: string, command: string = ''): GateCommand {
  return { command, available: false, unavailableReason: reason }
}

export function detectGateCommands(
  projectPath: string,
  packageManager: PackageManager,
): GateCommandMap {
  const pkg = readPackageJson(projectPath)
  const runnerPrefix = packageManager === 'none' ? '' : `${packageManager} `

  if (!pkg) {
    const reason = 'no package.json'
    return {
      lint: unavailable(reason),
      typecheck: unavailable(reason),
      build: unavailable(reason),
      test: unavailable(reason),
    }
  }

  const scripts = pkg.scripts ?? {}

  const findScript = (names: readonly string[]): string | undefined => {
    for (const n of names) {
      if (typeof scripts[n] === 'string' && scripts[n]!.length > 0) return n
    }
    return undefined
  }

  const resolveGate = (gate: GateName): GateCommand => {
    const matchedScript = findScript(GATE_SCRIPT_NAMES[gate])
    if (matchedScript) {
      return {
        command: `${runnerPrefix}${matchedScript}`.trim(),
        available: true,
      }
    }
    // Typecheck fallback: tsconfig-present projects can run `tsc --noEmit`
    // directly even without an explicit script.
    if (gate === 'typecheck' && existsSync(join(projectPath, 'tsconfig.json'))) {
      return {
        command: `${runnerPrefix}tsc --noEmit`.trim(),
        available: true,
      }
    }
    if (gate === 'typecheck') {
      return unavailable('no typecheck script and no tsconfig.json')
    }
    return unavailable(`no \`${gate}\` script in package.json`)
  }

  return {
    lint: resolveGate('lint'),
    typecheck: resolveGate('typecheck'),
    build: resolveGate('build'),
    test: resolveGate('test'),
  }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function splitCommand(command: string): { cmd: string; args: string[] } {
  const parts = command.trim().split(/\s+/)
  const cmd = parts[0] ?? ''
  return { cmd, args: parts.slice(1) }
}

function verifyGateResolves(
  gate: GateCommand,
  projectPath: string,
  spawner: Spawner,
  log: (s: string) => void,
): GateCommand {
  if (!gate.available) return gate
  // `--help` is the least-destructive way to check the runner resolves.
  // For pnpm/npm/yarn/bun running a script, `<pm> <script> --help` prints
  // the runner's help. A non-zero exit (e.g. runner missing) marks the gate
  // unavailable so the checker skips it instead of failing the task.
  const { cmd, args } = splitCommand(gate.command)
  if (!cmd) return gate
  const res = spawner(cmd, [...args, '--help'], {
    cwd: projectPath,
    timeout: 30_000,
    encoding: 'utf-8',
  })
  log(`[verify] ${gate.command} --help → exit ${res.exitCode}`)
  if (!res.ok) {
    return {
      command: gate.command,
      available: false,
      unavailableReason: `runner exited ${res.exitCode} on --help`,
    }
  }
  return gate
}

export function runBootstrap(
  projectPath: string,
  options: BootstrapOptions = {},
): BootstrapResult {
  const spawner = options.spawner ?? defaultSpawner
  const now = options.nowIso ?? (() => new Date().toISOString())
  const logs: string[] = []
  const log = (line: string): void => {
    logs.push(line)
    options.onLog?.(line)
  }

  const packageManager = detectPackageManager(projectPath)
  log(`[detect] package manager: ${packageManager}`)

  const installCommand =
    packageManager === 'none' ? '' : `${packageManager} install`
  let installStatus: InstallStatus = 'ok'
  let installLastRunAt: string | undefined

  if (!options.skipInstall && installCommand) {
    const { cmd, args } = splitCommand(installCommand)
    log(`[install] ${installCommand}`)
    const res = spawner(cmd, args, {
      cwd: projectPath,
      timeout: options.installTimeoutMs ?? 10 * 60_000,
      encoding: 'utf-8',
    })
    installLastRunAt = now()
    installStatus = res.ok ? 'ok' : 'failed'
    if (res.stdout) log(res.stdout.trimEnd())
    if (res.stderr) log(res.stderr.trimEnd())
    log(`[install] exit ${res.exitCode} (${installStatus})`)
  } else {
    log(`[install] skipped`)
  }

  const rawGates = detectGateCommands(projectPath, packageManager)
  const gates: GateCommandMap = {
    lint: verifyGateResolves(rawGates.lint, projectPath, spawner, log),
    typecheck: verifyGateResolves(rawGates.typecheck, projectPath, spawner, log),
    build: verifyGateResolves(rawGates.build, projectPath, spawner, log),
    test: verifyGateResolves(rawGates.test, projectPath, spawner, log),
  }

  const bootstrap: BootstrapBlock = {
    verifiedAt: now(),
    packageManager,
    install: {
      command: installCommand || '(none)',
      ...(installLastRunAt ? { lastRunAt: installLastRunAt } : {}),
      status: installStatus,
    },
    gates,
  }

  return {
    ok: installStatus === 'ok',
    bootstrap,
    logs,
  }
}

// ---------------------------------------------------------------------------
// guildhall.yaml merge + write
// ---------------------------------------------------------------------------

/**
 * Merges the new bootstrap block into the existing `guildhall.yaml` without
 * clobbering unrelated fields (coordinators, models, levers, etc.) or the
 * legacy `commands` / `successGates` arrays the runtime still reads.
 */
export function writeBootstrapResult(
  projectPath: string,
  result: BootstrapResult,
): void {
  const yamlPath = join(projectPath, 'guildhall.yaml')
  const raw = existsSync(yamlPath) ? readFileSync(yamlPath, 'utf8') : ''
  const parsed = raw.length > 0 ? (parseYaml(raw) as Record<string, unknown> | null) : null
  const current = parsed && typeof parsed === 'object' ? parsed : {}

  const existingBootstrap =
    typeof current['bootstrap'] === 'object' && current['bootstrap'] !== null
      ? (current['bootstrap'] as Record<string, unknown>)
      : {}

  const nextBootstrap: Record<string, unknown> = {
    ...existingBootstrap,
    verifiedAt: result.bootstrap.verifiedAt,
    packageManager: result.bootstrap.packageManager,
    install: result.bootstrap.install,
    gates: result.bootstrap.gates,
  }

  const merged = { ...current, bootstrap: nextBootstrap }
  writeFileSync(yamlPath, stringifyYaml(merged), 'utf8')
}
