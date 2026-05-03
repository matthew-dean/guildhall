import fs from 'node:fs'
import path from 'node:path'
import type { Task } from '@guildhall/core'
import type { ResolvedConfig } from '@guildhall/config'
import { detectGateCommands, detectPackageManager } from './bootstrap.js'
import { detectBootstrapHypothesis } from './detect-bootstrap.js'

type BootstrapBlock = NonNullable<ResolvedConfig['bootstrap']>

function hasBootstrapSignal(bootstrap: BootstrapBlock | undefined): boolean {
  if (!bootstrap) return false
  return (
    bootstrap.successGates.length > 0 ||
    bootstrap.gates != null ||
    bootstrap.verifiedAt != null ||
    bootstrap.install != null
  )
}

export function effectiveBootstrapGateCommands(bootstrap: BootstrapBlock): string[] {
  if (bootstrap.successGates.length > 0) return [...bootstrap.successGates]
  const ordered = [
    bootstrap.gates?.typecheck,
    bootstrap.gates?.build,
    bootstrap.gates?.test,
    bootstrap.gates?.lint,
  ]
  return ordered
    .filter((gate): gate is NonNullable<typeof gate> => Boolean(gate?.available && gate.command.trim()))
    .map((gate) => gate.command)
}

function detectProjectGateCommands(projectPath: string): string[] {
  const hypothesis = detectBootstrapHypothesis(projectPath)
  if (hypothesis.successGates.length > 0) return [...hypothesis.successGates]

  const packageManager = detectPackageManager(projectPath)
  const detected = detectGateCommands(projectPath, packageManager)
  const ordered = [detected.typecheck, detected.build, detected.test, detected.lint]
  return ordered
    .filter((gate) => gate.available && gate.command.trim().length > 0)
    .map((gate) => gate.command)
}

type GateCommandKind = 'typecheck' | 'build' | 'test' | 'lint' | 'other'

function classifyGateCommand(command: string): GateCommandKind {
  const normalized = command.trim().toLowerCase()
  if (/\b(typecheck|tsc(?:\s|$)|tsgo\b)/.test(normalized)) return 'typecheck'
  if (/\bbuild\b/.test(normalized)) return 'build'
  if (/\b(test|vitest|jest|playwright|pytest)\b/.test(normalized)) return 'test'
  if (/\blint\b/.test(normalized)) return 'lint'
  return 'other'
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

type WorkspacePackage = {
  name: string
  dir: string
  relativeDir: string
  scripts: Set<string>
  scriptBodies: Record<string, string>
}

function readPackageScripts(
  dir: string,
): { name?: string; scripts: Set<string>; scriptBodies: Record<string, string> } | null {
  const packageJsonPath = path.join(dir, 'package.json')
  if (!fs.existsSync(packageJsonPath)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      name?: string
      scripts?: Record<string, string>
    }
    return {
      ...(typeof parsed.name === 'string' ? { name: parsed.name.trim() } : {}),
      scripts: new Set(Object.keys(parsed.scripts ?? {})),
      scriptBodies: Object.fromEntries(
        Object.entries(parsed.scripts ?? {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
    }
  } catch {
    return null
  }
}

function readWorkspacePackages(projectPath: string): WorkspacePackage[] {
  const packages: WorkspacePackage[] = []
  const root = path.resolve(projectPath)
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  const seen = new Set<string>()

  while (queue.length > 0) {
    const current = queue.shift()!
    if (seen.has(current.dir)) continue
    seen.add(current.dir)
    if (current.depth > 2) continue

    const parsed = readPackageScripts(current.dir)
    if (parsed && current.dir !== root && typeof parsed.name === 'string' && parsed.name.trim().length > 0) {
      packages.push({
        name: parsed.name.trim(),
        dir: current.dir,
        relativeDir: path.relative(root, current.dir) || '.',
        scripts: parsed.scripts,
        scriptBodies: parsed.scriptBodies,
      })
    }

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue
      queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 })
    }
  }

  return packages
}

function findUniqueRelativeFile(rootDir: string, needle: string): string | null {
  const normalizedNeedle = needle.trim()
  if (!normalizedNeedle) return null
  const directPath = path.resolve(rootDir, normalizedNeedle)
  if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
    return normalizeCommand(path.relative(rootDir, directPath))
  }

  const matches: string[] = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.depth > 6) continue
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const fullPath = path.join(current.dir, entry.name)
      if (entry.isDirectory()) {
        queue.push({ dir: fullPath, depth: current.depth + 1 })
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name !== normalizedNeedle) continue
      matches.push(path.relative(rootDir, fullPath))
      if (matches.length > 1) return null
    }
  }

  return matches.length === 1 ? normalizeCommand(matches[0]!) : null
}

function maybeRewritePnpmVitestCommand(
  pkg: WorkspacePackage,
  script: string,
  rest: string,
): string | null {
  if (script !== 'test') return null
  const scriptBody = pkg.scriptBodies[script]?.trim() ?? ''
  if (!/^vitest(?:\s|$)/i.test(scriptBody)) return null

  const normalizedRest = normalizeCommand(rest)
  const runWithTarget = /(?:^| )--run\s+([^\s][^]*)$/.exec(normalizedRest)
  if (!runWithTarget) return null

  const target = runWithTarget[1]!.trim()
  if (!target || target.startsWith('-')) return null
  const resolvedTarget = findUniqueRelativeFile(pkg.dir, target)
  if (!resolvedTarget) return null

  return pkg.relativeDir === '.'
    ? normalizeCommand(`pnpm vitest --run ${resolvedTarget}`)
    : normalizeCommand(`cd ${pkg.relativeDir} && pnpm vitest --run ${resolvedTarget}`)
}

function validateOrNormalizePnpmCommand(command: string, projectPath: string): string | null {
  const normalized = normalizeCommand(command)
  const rootPackage = readPackageScripts(projectPath)
  const rootScripts = rootPackage?.scripts ?? new Set<string>()
  const packages = readWorkspacePackages(projectPath)

  const dirCommand = /^pnpm\s+--dir\s+(\S+)\s+([a-z0-9:_-]+)(.*)$/i.exec(normalized)
  if (dirCommand) {
    const [, relDir, script, rest = ''] = dirCommand
    const targetDir = path.resolve(projectPath, relDir)
    const parsed = readPackageScripts(targetDir)
    if (parsed?.scripts.has(script)) {
      const pkg: WorkspacePackage | null =
        typeof parsed.name === 'string'
          ? {
              name: parsed.name,
              dir: targetDir,
              relativeDir: relDir,
              scripts: parsed.scripts,
              scriptBodies: parsed.scriptBodies,
            }
          : null
      const rewritten = pkg ? maybeRewritePnpmVitestCommand(pkg, script, rest) : null
      if (rewritten) return rewritten
      return normalizeCommand(`pnpm --dir ${relDir} ${script}${rest}`)
    }
    return null
  }

  const filterAfterScript = /^pnpm\s+([a-z0-9:_-]+)\s+--filter\s+(\S+)(.*)$/i.exec(normalized)
  const filterBeforeScript = /^pnpm\s+--filter\s+(\S+)\s+([a-z0-9:_-]+)(.*)$/i.exec(normalized)
  if (filterAfterScript || filterBeforeScript) {
    const selector = (filterAfterScript?.[2] ?? filterBeforeScript?.[1])!
    const script = (filterAfterScript?.[1] ?? filterBeforeScript?.[2])!
    const rest = (filterAfterScript?.[3] ?? filterBeforeScript?.[3] ?? '')!
    const reordered = normalizeCommand(`pnpm --filter ${selector} ${script}${rest}`)
    const selectorMatches = packages.find(
      (pkg) => pkg.name === selector || path.basename(pkg.relativeDir) === selector,
    )
    if (selectorMatches?.scripts.has(script)) {
      const rewritten = maybeRewritePnpmVitestCommand(selectorMatches, script, rest)
      if (rewritten) return rewritten
      return reordered
    }

    const scriptOwners = packages.filter((pkg) => pkg.scripts.has(script))
    if (scriptOwners.length === 1) {
      const owner = scriptOwners[0]!
      const rewritten = maybeRewritePnpmVitestCommand(owner, script, rest)
      if (rewritten) return rewritten
      const relDir = owner.relativeDir
      return normalizeCommand(`pnpm --dir ${relDir} ${script}${rest}`)
    }
    return null
  }

  const rootScriptCommand = /^pnpm\s+([a-z0-9:_-]+)(.*)$/i.exec(normalized)
  if (rootScriptCommand) {
    const [, script, rest = ''] = rootScriptCommand
    if (rootScripts.has(script)) {
      const pkg: WorkspacePackage | null =
        typeof rootPackage?.name === 'string'
          ? {
              name: rootPackage.name,
              dir: projectPath,
              relativeDir: '.',
              scripts: rootScripts,
              scriptBodies: rootPackage.scriptBodies,
            }
          : null
      const rewritten = pkg ? maybeRewritePnpmVitestCommand(pkg, script, rest) : null
      if (rewritten) return rewritten
      return normalizeCommand(`pnpm ${script}${rest}`)
    }
    const scriptOwners = packages.filter((pkg) => pkg.scripts.has(script))
    if (scriptOwners.length === 1) {
      const owner = scriptOwners[0]!
      const rewritten = maybeRewritePnpmVitestCommand(owner, script, rest)
      if (rewritten) return rewritten
      const relDir = owner.relativeDir
      return normalizeCommand(`pnpm --dir ${relDir} ${script}${rest}`)
    }
    return null
  }

  return normalized
}

function preferSpecificCommands(commands: readonly string[]): string[] {
  const normalized = commands
    .map(normalizeCommand)
    .filter((command, index, all) => command.length > 0 && all.indexOf(command) === index)
  const specificRunTargets = normalized.filter((command) =>
    /\b(?:vitest|jest|playwright|pytest)\b.*(?:^| )--run\s+\S+/i.test(command),
  )
  return normalized.filter(
    (candidate) =>
      !(
        specificRunTargets.length > 0 &&
        /\b(?:test|vitest|jest|playwright|pytest)\b.*(?:^| )--run$/i.test(candidate)
      ) &&
      !normalized.some(
        (other) => other !== candidate && other.startsWith(`${candidate} `),
      ),
  )
}

function deriveAutomatedAcceptanceCommands(
  task: Pick<Task, 'acceptanceCriteria'>,
  projectPath: string,
): Map<GateCommandKind, string[]> {
  const buckets = new Map<GateCommandKind, string[]>()
  for (const criterion of task.acceptanceCriteria ?? []) {
    if (criterion.verifiedBy !== 'automated') continue
    if (typeof criterion.command !== 'string' || criterion.command.trim().length === 0) continue
    const command = validateOrNormalizePnpmCommand(criterion.command, projectPath)
    if (!command) continue
    const kind = classifyGateCommand(command)
    const existing = buckets.get(kind) ?? []
    existing.push(command)
    buckets.set(kind, existing)
  }
  for (const [kind, commands] of buckets) {
    buckets.set(kind, preferSpecificCommands(commands))
  }
  return buckets
}

function mergeAcceptanceAndProjectGates(
  acceptanceBuckets: Map<GateCommandKind, string[]>,
  projectCommands: readonly string[] | undefined,
): readonly string[] | undefined {
  if (acceptanceBuckets.size === 0) return projectCommands

  const merged: string[] = []
  const seen = new Set<string>()
  const pushAll = (commands: readonly string[]) => {
    for (const command of commands) {
      const normalized = normalizeCommand(command)
      if (normalized.length === 0 || seen.has(normalized)) continue
      seen.add(normalized)
      merged.push(command.trim())
    }
  }

  for (const kind of ['typecheck', 'build', 'test', 'lint'] as const) {
    const acceptance = acceptanceBuckets.get(kind)
    if (acceptance && acceptance.length > 0) {
      pushAll(acceptance)
      continue
    }
    const fallback = (projectCommands ?? []).filter((command) => classifyGateCommand(command) === kind)
    pushAll(fallback)
  }

  for (const [kind, commands] of acceptanceBuckets) {
    if (kind === 'typecheck' || kind === 'build' || kind === 'test' || kind === 'lint') continue
    pushAll(commands)
  }

  if (projectCommands) {
    const remaining = projectCommands.filter((command) => classifyGateCommand(command) === 'other')
    pushAll(remaining)
  }

  return merged
}

export function resolveEffectiveTaskProjectPath(
  task: Pick<Task, 'projectPath'>,
  workspaceProjectPath: string,
): string {
  if (typeof task.projectPath === 'string' && task.projectPath.trim().length > 0) {
    return path.resolve(task.projectPath)
  }
  return path.resolve(workspaceProjectPath)
}

export function resolveEffectiveTaskSuccessGates(input: {
  task: Pick<Task, 'projectPath' | 'acceptanceCriteria'>
  workspaceProjectPath: string
  workspaceBootstrap?: BootstrapBlock
}): readonly string[] | undefined {
  const taskProjectPath = resolveEffectiveTaskProjectPath(
    input.task,
    input.workspaceProjectPath,
  )
  const workspaceProjectPath = path.resolve(input.workspaceProjectPath)
  const acceptanceBuckets = deriveAutomatedAcceptanceCommands(input.task, taskProjectPath)

  if (taskProjectPath !== workspaceProjectPath) {
    const taskScoped = detectProjectGateCommands(taskProjectPath)
    const merged = mergeAcceptanceAndProjectGates(acceptanceBuckets, taskScoped)
    if (merged && merged.length > 0) return merged
  }

  if (hasBootstrapSignal(input.workspaceBootstrap)) {
    return mergeAcceptanceAndProjectGates(
      acceptanceBuckets,
      effectiveBootstrapGateCommands(input.workspaceBootstrap!),
    )
  }

  return mergeAcceptanceAndProjectGates(acceptanceBuckets, undefined)
}

export function renderTaskScopedGateInstructions(input: {
  projectPath: string
  successGates: readonly string[] | undefined
}): string {
  const lines = [
    '## Task-scoped hard gates',
    '',
    `Run hard gates against \`${input.projectPath}\`. This task path is authoritative for gate_check, even when the outer workspace root differs.`,
  ]

  if (input.successGates === undefined) {
    lines.push(
      '',
      'No task-scoped verified shell gates were derived for this task path. Fall back to your normal default gate behavior, but still run against the task project path above.',
    )
    return lines.join('\n')
  }

  if (input.successGates.length === 0) {
    lines.push(
      '',
      'No verified shell gates are currently configured for this task path. Do not invent extra project-specific gates unless the task itself names them explicitly.',
    )
    return lines.join('\n')
  }

  lines.push(
    '',
    'Use these commands as the authoritative hard gates for this task:',
    ...input.successGates.map((gate) => `- \`${gate}\``),
    '',
    'When you call `run-gates`, set `cwd` to the task project path above and use these commands exactly.',
  )
  return lines.join('\n')
}
