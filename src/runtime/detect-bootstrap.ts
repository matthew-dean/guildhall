import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Bootstrap hypothesis — the setup/meta-intake agent's starting guess for
 * how to put a project into a testable state. Pure static detection: reads
 * package.json + lockfiles + manifests. The agent then empirically verifies
 * (and can reject) this hypothesis before writing the final `bootstrap`
 * block to guildhall.yaml.
 */
export interface BootstrapHypothesis {
  /** Detected package manager, if any (node or python). */
  packageManager?: 'pnpm' | 'yarn' | 'npm' | 'bun' | 'uv' | 'pip' | 'poetry'
  /** Ordered shell commands to reach a testable state. Install is first. */
  commands: string[]
  /** Commands that, when run after `commands`, prove the project is testable. */
  successGates: string[]
}

type NodePackageJson = {
  packageManager?: string
  scripts?: Record<string, string>
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return undefined
  }
}

function detectNodePackageManager(
  projectPath: string,
  pkg: NodePackageJson | undefined,
): 'pnpm' | 'yarn' | 'npm' | 'bun' | undefined {
  // Explicit packageManager field wins.
  const pmField = pkg?.packageManager?.split('@')[0]
  if (pmField === 'pnpm' || pmField === 'yarn' || pmField === 'npm' || pmField === 'bun') {
    return pmField
  }
  // Fall back to lockfile presence.
  if (existsSync(join(projectPath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(projectPath, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(projectPath, 'bun.lockb'))) return 'bun'
  if (existsSync(join(projectPath, 'package-lock.json'))) return 'npm'
  return undefined
}

function detectPythonPackageManager(
  projectPath: string,
): 'uv' | 'poetry' | 'pip' | undefined {
  if (existsSync(join(projectPath, 'uv.lock'))) return 'uv'
  if (existsSync(join(projectPath, 'poetry.lock'))) return 'poetry'
  if (
    existsSync(join(projectPath, 'pyproject.toml')) ||
    existsSync(join(projectPath, 'requirements.txt'))
  ) {
    return 'pip'
  }
  return undefined
}

/**
 * Inspect `projectPath` and produce a bootstrap hypothesis.
 *
 * Node projects: install via detected pm; successGates from package.json
 * scripts (typecheck, build, test, lint — in that order, only when defined).
 *
 * Python projects (uv/poetry): install via `<pm> sync` / `<pm> install`.
 * successGates left empty for now — the agent decides based on pytest/mypy
 * presence.
 */
export function detectBootstrapHypothesis(projectPath: string): BootstrapHypothesis {
  const pkg = readJson<NodePackageJson>(join(projectPath, 'package.json'))

  if (pkg) {
    const pm = detectNodePackageManager(projectPath, pkg)
    if (!pm) return { commands: [], successGates: [] }

    const scripts = pkg.scripts ?? {}
    const gateOrder = ['typecheck', 'build', 'test', 'lint'] as const
    const successGates = gateOrder
      .filter((name) => typeof scripts[name] === 'string' && scripts[name]!.length > 0)
      .map((name) => `${pm} ${name}`)

    return {
      packageManager: pm,
      commands: [`${pm} install`],
      successGates,
    }
  }

  const py = detectPythonPackageManager(projectPath)
  if (py === 'uv') return { packageManager: 'uv', commands: ['uv sync'], successGates: [] }
  if (py === 'poetry') return { packageManager: 'poetry', commands: ['poetry install'], successGates: [] }
  if (py === 'pip') return { packageManager: 'pip', commands: ['pip install -r requirements.txt'], successGates: [] }

  return { commands: [], successGates: [] }
}
