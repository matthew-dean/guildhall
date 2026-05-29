import { resolve } from 'node:path'
import { homedir } from 'node:os'

import type {
  ProjectRuntimeHealth,
  ProjectRuntimeMountState,
  ProjectRuntimeState,
} from './project-runtime-store.js'

export interface RuntimeHealthCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export type RuntimeHealthCommandRunner = (
  command: string,
  args: string[],
) => Promise<RuntimeHealthCommandResult>

export interface RuntimeHealthCheck {
  name: string
  ok: boolean
  message: string
}

export interface RuntimeHealthReport extends ProjectRuntimeHealth {
  status: 'healthy' | 'unhealthy'
  checkedAt: string
  checks: RuntimeHealthCheck[]
  mountLayout: ProjectRuntimeMountState
}

export interface RuntimeHealthOptions {
  projectId?: string
  guildhallHome?: string
  state?: ProjectRuntimeState
  commandRunner: RuntimeHealthCommandRunner
  now?: () => string
}

export function runtimeProjectSlug(projectRoot: string, projectId?: string): string {
  const source = (projectId?.trim() || projectRoot.split(/[\\/]/).filter(Boolean).at(-1) || 'project')
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'project'
}

export function buildRuntimeMountLayout(
  projectRoot: string,
  options: { projectId?: string; guildhallHome?: string } = {},
): ProjectRuntimeMountState {
  const slug = runtimeProjectSlug(projectRoot, options.projectId)
  return {
    projectRoot: resolve(projectRoot),
    projectPath: `/workspace/${slug}`,
    guildhallHome: resolve(options.guildhallHome ?? homedir(), options.guildhallHome ? '' : '.guildhall'),
    guildhallHomePath: '/home/guildhall/.guildhall',
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function fileOpsScript(path: string): string {
  const root = shellQuote(path)
  return [
    `root=${root}`,
    'tmp="$root/.guildhall-runtime-health"',
    'rm -rf "$tmp"',
    'mkdir -p "$tmp"',
    'printf ok > "$tmp/read-write.txt"',
    'test "$(cat "$tmp/read-write.txt")" = ok',
    'chmod 600 "$tmp/read-write.txt"',
    'ln -s read-write.txt "$tmp/link.txt"',
    'mv "$tmp/read-write.txt" "$tmp/renamed.txt"',
    'test -L "$tmp/link.txt"',
    'rm "$tmp/link.txt" "$tmp/renamed.txt"',
    'rmdir "$tmp"',
  ].join(' && ')
}

function readWriteScript(path: string): string {
  const root = shellQuote(path)
  return `test -r ${root} && test -w ${root}`
}

function ownerScript(path: string): string {
  const root = shellQuote(path)
  return `test "$(stat -c %u ${root})" = "$(id -u)"`
}

function pollingScript(path: string): string {
  const root = shellQuote(path)
  return [
    `root=${root}`,
    'tmp="$root/.guildhall-runtime-polling-check"',
    'printf before > "$tmp"',
    'sleep 0.05',
    'printf after > "$tmp"',
    'test "$(cat "$tmp")" = after',
    'rm "$tmp"',
  ].join(' && ')
}

function commandLogScript(path: string): string {
  const file = shellQuote(`${path}/runtime/health/command-log.jsonl`)
  return `mkdir -p "$(dirname ${file})" && printf '{"event":"health"}\\n' >> ${file} && tail -n 1 ${file} | grep health >/dev/null`
}

async function runCheck(
  name: string,
  script: string,
  runner: RuntimeHealthCommandRunner,
): Promise<RuntimeHealthCheck> {
  try {
    const result = await runner('sh', ['-lc', script])
    const message = (result.stderr || result.stdout).trim()
    return {
      name,
      ok: result.exitCode === 0,
      message: message || (result.exitCode === 0 ? 'ok' : `exit ${result.exitCode}`),
    }
  } catch (error) {
    return {
      name,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function runRuntimeHealthChecks(
  projectRoot: string,
  options: RuntimeHealthOptions,
): Promise<RuntimeHealthReport> {
  const mountLayout = options.state?.mounts ?? buildRuntimeMountLayout(projectRoot, {
    projectId: options.projectId,
    guildhallHome: options.guildhallHome,
  })
  const runner = options.commandRunner
  const checks: RuntimeHealthCheck[] = []

  checks.push(await runCheck('mount:project:read-write', readWriteScript(mountLayout.projectPath), runner))
  checks.push(await runCheck('mount:guildhall-home:read-write', readWriteScript(mountLayout.guildhallHomePath), runner))
  checks.push(await runCheck('mount:project:owner', ownerScript(mountLayout.projectPath), runner))
  checks.push(await runCheck('mount:guildhall-home:owner', ownerScript(mountLayout.guildhallHomePath), runner))
  checks.push(await runCheck('mount:project:file-ops', fileOpsScript(mountLayout.projectPath), runner))
  checks.push(await runCheck('mount:guildhall-home:file-ops', fileOpsScript(mountLayout.guildhallHomePath), runner))
  checks.push(await runCheck('mount:polling-fallback', pollingScript(mountLayout.projectPath), runner))

  for (const tool of ['sh', 'git', 'rg', 'jq', 'node', 'npm', 'corepack', 'python3', 'pipx']) {
    checks.push(await runCheck(`tool:${tool}`, `command -v ${tool}`, runner))
  }

  checks.push(await runCheck(
    'network:dns',
    `node -e "require('node:dns').lookup('registry.npmjs.org', err => process.exit(err ? 1 : 0))"`,
    runner,
  ))
  checks.push(await runCheck('persistence:command-log', commandLogScript(mountLayout.guildhallHomePath), runner))

  const status = checks.every(check => check.ok) ? 'healthy' : 'unhealthy'
  return {
    status,
    checkedAt: (options.now ?? (() => new Date().toISOString()))(),
    checks,
    mountLayout,
  }
}
