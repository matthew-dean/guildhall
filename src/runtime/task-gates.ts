import fs from 'node:fs'
import path from 'node:path'
import type { Task } from '@guildhall/core'
import type { ResolvedConfig } from '@guildhall/config'
import { detectGateCommands, detectPackageManager, type PackageManager } from './bootstrap.js'
import { detectBootstrapHypothesis } from './detect-bootstrap.js'

type BootstrapBlock = NonNullable<ResolvedConfig['bootstrap']>
type WorkspaceProjectBlock = NonNullable<ResolvedConfig['projects']>[number]

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

function detectProjectGateCommands(
  projectPath: string,
  fallbackPackageManager: PackageManager = 'none',
): string[] {
  const hypothesis = detectBootstrapHypothesis(projectPath)
  if (hypothesis.successGates.length > 0) return [...hypothesis.successGates]

  const detectedPackageManager = detectPackageManager(projectPath)
  const packageManager = detectedPackageManager === 'none'
    ? fallbackPackageManager
    : detectedPackageManager
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

function isWithin(parent: string, child: string): boolean {
  const normalizedParent = path.resolve(parent)
  const normalizedChild = path.resolve(child)
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${path.sep}`)
}

function rewriteWorkspaceScopedCommandForTask(
  command: string,
  workspaceProjectPath: string,
  taskProjectPath: string,
): string {
  const normalized = normalizeCommand(command)
  if (!normalized || path.resolve(taskProjectPath) === path.resolve(workspaceProjectPath)) {
    return normalized
  }

  const cdMatch = /^cd\s+(\S+)\s*&&\s*(.+)$/i.exec(normalized)
  if (cdMatch) {
    const [, rawDir, rest] = cdMatch
    const absoluteTarget = path.resolve(workspaceProjectPath, rawDir!)
    if (isWithin(taskProjectPath, absoluteTarget)) {
      const relativeFromTask = normalizeCommand(path.relative(taskProjectPath, absoluteTarget))
      return relativeFromTask === '' || relativeFromTask === '.'
        ? normalizeCommand(rest!)
        : normalizeCommand(`cd ${relativeFromTask} && ${rest}`)
    }
  }

  const dirMatch = /^pnpm\s+--dir\s+(\S+)\s+(.+)$/i.exec(normalized)
  if (dirMatch) {
    const [, rawDir, rest] = dirMatch
    const absoluteTarget = path.resolve(workspaceProjectPath, rawDir!)
    if (isWithin(taskProjectPath, absoluteTarget)) {
      const relativeFromTask = normalizeCommand(path.relative(taskProjectPath, absoluteTarget))
      return relativeFromTask === '' || relativeFromTask === '.'
        ? normalizeCommand(`pnpm ${rest}`)
        : normalizeCommand(`pnpm --dir ${relativeFromTask} ${rest}`)
    }
  }

  return normalized
}

function rewriteWorkspaceScopedBootstrapCommandForTask(
  command: string,
  workspaceProjectPath: string,
  taskProjectPath: string,
): string | null {
  const normalized = normalizeCommand(command)
  if (!normalized || path.resolve(taskProjectPath) === path.resolve(workspaceProjectPath)) {
    return normalized
  }

  const rewriteTargetedCommand = (rawDir: string, rest: string, format: (relative: string, rest: string) => string) => {
    const absoluteTarget = path.resolve(workspaceProjectPath, rawDir)
    if (isWithin(taskProjectPath, absoluteTarget)) {
      const relativeFromTask = normalizeCommand(path.relative(taskProjectPath, absoluteTarget))
      return relativeFromTask === '' || relativeFromTask === '.'
        ? normalizeCommand(rest)
        : normalizeCommand(format(relativeFromTask, rest))
    }
    if (isWithin(workspaceProjectPath, absoluteTarget)) return null
    return normalized
  }

  const cdMatch = /^cd\s+(\S+)\s*&&\s*(.+)$/i.exec(normalized)
  if (cdMatch) {
    const [, rawDir, rest] = cdMatch
    return rewriteTargetedCommand(rawDir!, rest!, (relative, rewrittenRest) => `cd ${relative} && ${rewrittenRest}`)
  }

  const dirMatch = /^pnpm\s+--dir\s+(\S+)\s+(.+)$/i.exec(normalized)
  if (dirMatch) {
    const [, rawDir, rest] = dirMatch
    return rewriteTargetedCommand(rawDir!, rest!, (relative, rewrittenRest) => `pnpm --dir ${relative} ${rewrittenRest}`)
  }

  return normalized
}

function installCommandForProject(projectPath: string, fallbackPackageManager: PackageManager): string[] {
  const detected = detectPackageManager(projectPath)
  const packageManager = detected === 'none' ? fallbackPackageManager : detected
  return packageManager === 'none' ? [] : [`${packageManager} install`]
}

function rewriteBootstrapCommandsForTask(input: {
  commands: readonly string[]
  workspaceProjectPath: string
  taskProjectPath: string
  fallbackPackageManager: PackageManager
}): string[] {
  const rewritten = input.commands
    .map((command) =>
      rewriteWorkspaceScopedBootstrapCommandForTask(
        command,
        input.workspaceProjectPath,
        input.taskProjectPath,
      ),
    )
    .filter((command): command is string => typeof command === 'string' && command.length > 0)

  if (rewritten.length > 0 || path.resolve(input.taskProjectPath) === path.resolve(input.workspaceProjectPath)) {
    return rewritten
  }

  return installCommandForProject(input.taskProjectPath, input.fallbackPackageManager)
}

function rewriteBootstrapGatesForTask(input: {
  commands: readonly string[]
  workspaceProjectPath: string
  taskProjectPath: string
  fallbackPackageManager: PackageManager
}): string[] {
  const rewritten = input.commands
    .map((command) =>
      rewriteWorkspaceScopedBootstrapCommandForTask(
        command,
        input.workspaceProjectPath,
        input.taskProjectPath,
      ),
    )
    .filter((command): command is string => typeof command === 'string' && command.length > 0)

  if (rewritten.length > 0 || path.resolve(input.taskProjectPath) === path.resolve(input.workspaceProjectPath)) {
    return rewritten
  }

  const requestedKinds = new Set(input.commands.map(classifyGateCommand))
  return detectProjectGateCommands(input.taskProjectPath, input.fallbackPackageManager)
    .filter((command) => requestedKinds.has(classifyGateCommand(command)))
}

function rewriteTaskProjectCommandForWorkspace(
  command: string,
  workspaceProjectPath: string,
  taskProjectPath: string,
): string {
  const normalized = normalizeCommand(command)
  if (!normalized || path.resolve(taskProjectPath) === path.resolve(workspaceProjectPath)) {
    return normalized
  }

  const relativeTaskDir = normalizeCommand(path.relative(workspaceProjectPath, taskProjectPath))
  if (!relativeTaskDir || relativeTaskDir === '.' || relativeTaskDir.startsWith('..')) {
    return normalized
  }

  const cdMatch = /^cd\s+(\S+)\s*&&\s*(.+)$/i.exec(normalized)
  if (cdMatch) {
    const [, rawDir, rest] = cdMatch
    const workspaceRelativeDir = normalizeCommand(path.join(relativeTaskDir, rawDir!))
    return normalizeCommand(`cd ${workspaceRelativeDir} && ${rest}`)
  }

  const dirMatch = /^pnpm\s+--dir\s+(\S+)\s+(.+)$/i.exec(normalized)
  if (dirMatch) {
    const [, rawDir, rest] = dirMatch
    const workspaceRelativeDir = normalizeCommand(path.join(relativeTaskDir, rawDir!))
    const parsed = readPackageScripts(path.resolve(taskProjectPath, rawDir!))
    const directCommand = rest!.trim().split(/\s+/)[0] ?? ''
    const restWithExec =
      directCommand &&
      directCommand !== 'exec' &&
      directCommand !== 'run' &&
      directCommand !== 'install' &&
      directCommand !== 'add' &&
      !parsed?.scripts.has(directCommand)
        ? `exec ${rest}`
        : rest
    return normalizeCommand(`pnpm --dir ${workspaceRelativeDir} ${restWithExec}`)
  }

  const rootPnpmMatch = /^pnpm\s+(.+)$/i.exec(normalized)
  if (rootPnpmMatch) {
    const rest = rootPnpmMatch[1]!
    const parsed = readPackageScripts(taskProjectPath)
    const directCommand = rest.trim().split(/\s+/)[0] ?? ''
    const restWithExec =
      directCommand &&
      directCommand !== 'exec' &&
      directCommand !== 'run' &&
      directCommand !== 'install' &&
      directCommand !== 'add' &&
      !parsed?.scripts.has(directCommand)
        ? `exec ${rest}`
        : rest
    return normalizeCommand(`pnpm --dir ${relativeTaskDir} ${restWithExec}`)
  }

  return normalized
}

function rewriteTaskProjectCommandsForWorkspace(
  commands: readonly string[] | undefined,
  workspaceProjectPath: string,
  taskProjectPath: string,
): readonly string[] | undefined {
  if (!commands) return undefined
  return commands.map((command) =>
    rewriteTaskProjectCommandForWorkspace(command, workspaceProjectPath, taskProjectPath),
  )
}

function stripWorkspaceTaskDirFromCommand(command: string, workspaceRelativeTaskDir: string): string {
  const normalized = normalizeCommand(command)
  if (!workspaceRelativeTaskDir || workspaceRelativeTaskDir === '.') return normalized

  const cdMatch = /^cd\s+(\S+)\s*&&\s*(.+)$/i.exec(normalized)
  if (cdMatch) {
    const [, rawDir, rest] = cdMatch
    const relativeFromTask = normalizeCommand(path.relative(workspaceRelativeTaskDir, rawDir!))
    if (!relativeFromTask.startsWith('..')) {
      return relativeFromTask === '' || relativeFromTask === '.'
        ? normalizeCommand(rest!)
        : normalizeCommand(`cd ${relativeFromTask} && ${rest}`)
    }
  }

  const dirMatch = /^pnpm\s+--dir\s+(\S+)\s+(.+)$/i.exec(normalized)
  if (dirMatch) {
    const [, rawDir, rest] = dirMatch
    const relativeFromTask = normalizeCommand(path.relative(workspaceRelativeTaskDir, rawDir!))
    if (!relativeFromTask.startsWith('..')) {
      return relativeFromTask === '' || relativeFromTask === '.'
        ? normalizeCommand(`pnpm ${rest}`)
        : normalizeCommand(`pnpm --dir ${relativeFromTask} ${rest}`)
    }
  }

  return normalized
}

export function rewriteWorkspaceCommandsForIsolatedTaskWorktree(input: {
  commands: readonly string[] | undefined
  workspaceProjectPath: string
  taskProjectPath: string
  activeTaskWorktreeProjectPath: string
}): readonly string[] | undefined {
  if (!input.commands) return undefined
  const workspaceProjectPath = path.resolve(input.workspaceProjectPath)
  const taskProjectPath = path.resolve(input.taskProjectPath)
  if (taskProjectPath === workspaceProjectPath) return input.commands

  const workspaceRelativeTaskDir = normalizeCommand(path.relative(workspaceProjectPath, taskProjectPath))
  if (!workspaceRelativeTaskDir || workspaceRelativeTaskDir === '.' || workspaceRelativeTaskDir.startsWith('..')) {
    return input.commands
  }

  const nestedPathStillExists = fs.existsSync(path.resolve(input.activeTaskWorktreeProjectPath, workspaceRelativeTaskDir))
  if (nestedPathStillExists) return input.commands

  return input.commands.map((command) =>
    stripWorkspaceTaskDirFromCommand(command, workspaceRelativeTaskDir),
  )
}

function rewriteTaskProjectBucketsForWorkspace(
  buckets: Map<GateCommandKind, string[]>,
  workspaceProjectPath: string,
  taskProjectPath: string,
): Map<GateCommandKind, string[]> {
  const rewritten = new Map<GateCommandKind, string[]>()
  for (const [kind, commands] of buckets) {
    rewritten.set(
      kind,
      commands.map((command) =>
        rewriteTaskProjectCommandForWorkspace(command, workspaceProjectPath, taskProjectPath),
      ),
    )
  }
  return rewritten
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

function globPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function findRelativeFiles(rootDir: string, needle: string): string[] {
  const normalizedNeedle = needle.trim()
  if (!normalizedNeedle) return []
  if (!normalizedNeedle.includes('*')) {
    const unique = findUniqueRelativeFile(rootDir, normalizedNeedle)
    return unique ? [unique] : []
  }

  const matcher = globPatternToRegExp(normalizedNeedle.replace(/\\/g, '/'))
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
      const relativePath = normalizeCommand(path.relative(rootDir, fullPath)).replace(/\\/g, '/')
      if (matcher.test(relativePath) || matcher.test(path.basename(relativePath))) {
        matches.push(relativePath)
      }
    }
  }

  return matches.sort()
}

function candidateNeedles(raw: string): string[] {
  const trimmed = raw.trim().replace(/^`|`$/g, '')
  if (!trimmed) return []
  const candidates = new Set<string>([trimmed, path.basename(trimmed)])
  const parts = trimmed.split('/').filter(Boolean)
  for (let i = 1; i < parts.length; i += 1) {
    candidates.add(parts.slice(i).join('/'))
  }
  return [...candidates]
}

function resolveRelativeFileFromDescription(rootDir: string, raw: string): string | null {
  for (const needle of candidateNeedles(raw)) {
    const resolved = findUniqueRelativeFile(rootDir, needle)
    if (resolved) return resolved
  }
  return null
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
  const passthroughTarget = /^(?:--\s+)?([^\s][^]*)$/.exec(normalizedRest)
  const target = (runWithTarget?.[1] ?? passthroughTarget?.[1] ?? '').trim()
  if (!target || target.startsWith('-')) return null
  const targetTokens = target
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !token.startsWith('-'))
  const resolvedTargets = targetTokens.flatMap((token) => findRelativeFiles(pkg.dir, token))
  if (resolvedTargets.length === 0) return null
  const targetArgs = resolvedTargets.join(' ')

  return pkg.relativeDir === '.'
    ? normalizeCommand(`pnpm vitest --run ${targetArgs}`)
    : normalizeCommand(`cd ${pkg.relativeDir} && pnpm vitest --run ${targetArgs}`)
}

function owningPackageForRelativeFile(
  packages: readonly WorkspacePackage[],
  relativeFile: string,
): WorkspacePackage | null {
  const normalized = normalizeCommand(relativeFile)
  const owners = packages
    .filter((pkg) => normalized === pkg.relativeDir || normalized.startsWith(`${pkg.relativeDir}/`))
    .sort((a, b) => b.relativeDir.length - a.relativeDir.length)
  return owners[0] ?? null
}

function inferCommandFromAutomatedAcceptanceDescription(
  description: string,
  projectPath: string,
): string | null {
  const normalizedDescription = normalizeCommand(description)
  if (!normalizedDescription) return null

  const workspacePackages = readWorkspacePackages(projectPath)
  const fileMatch = description.match(
    /`([^`]+\.(?:spec|test)\.[a-z0-9]+)`|([A-Za-z0-9_./-]+\.(?:spec|test)\.[A-Za-z0-9]+)/i,
  )
  const relativeFile = fileMatch
    ? resolveRelativeFileFromDescription(projectPath, fileMatch[1] ?? fileMatch[2] ?? '')
    : null

  if (/\b(?:playwright|e2e|e2e_base_url)\b/i.test(normalizedDescription) && relativeFile) {
    const owner = owningPackageForRelativeFile(workspacePackages, relativeFile)
    if (owner) {
      const relativeToOwner = normalizeCommand(
        path.relative(owner.dir, path.join(projectPath, relativeFile)),
      )
      return normalizeCommand(
        `pnpm --dir ${owner.relativeDir} exec playwright test ${relativeToOwner}`,
      )
    }
    return normalizeCommand(`pnpm exec playwright test ${relativeFile}`)
  }

  if (/\btypecheck\b/i.test(normalizedDescription)) {
    return validateOrNormalizePnpmCommand('pnpm typecheck', projectPath)
  }
  if (/\bbuild\b/i.test(normalizedDescription)) {
    return validateOrNormalizePnpmCommand('pnpm build', projectPath)
  }
  if (/\blint\b/i.test(normalizedDescription)) {
    return validateOrNormalizePnpmCommand('pnpm lint', projectPath)
  }
  if (/\b(?:vitest|jest|pytest|test runner|test file|tests?)\b/i.test(normalizedDescription) && relativeFile) {
    return validateOrNormalizePnpmCommand(
      `pnpm test -- --run ${path.basename(relativeFile)}`,
      projectPath,
    )
  }

  return null
}

function validateOrNormalizePnpmCommand(command: string, projectPath: string): string | null {
  const normalized = normalizeCommand(command)
  const rootPackage = readPackageScripts(projectPath)
  const rootScripts = rootPackage?.scripts ?? new Set<string>()
  const packages = readWorkspacePackages(projectPath)

  const dirCommand = /^pnpm\s+--dir\s+(\S+)\s+([a-z0-9:_-]+)(.*)$/i.exec(normalized)
  if (dirCommand) {
    const [, relDir, script, rest = ''] = dirCommand
    const targetDir = path.resolve(projectPath, relDir!)
    const parsed = readPackageScripts(targetDir)
    if (script && parsed?.scripts.has(script)) {
      const pkg: WorkspacePackage | null =
        typeof parsed.name === 'string'
          ? {
              name: parsed.name,
              dir: targetDir,
              relativeDir: relDir!,
              scripts: parsed.scripts,
              scriptBodies: parsed.scriptBodies,
            }
          : null
      const rewritten = pkg ? maybeRewritePnpmVitestCommand(pkg, script, rest) : null
      if (rewritten) return rewritten
      return normalizeCommand(`pnpm --dir ${relDir} ${script}${rest}`)
    }
    if (script && /^(?:tsc|tsgo|vitest|jest|playwright|eslint|biome)$/i.test(script)) {
      return normalizeCommand(`pnpm --dir ${relDir} exec ${script}${rest}`)
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

    const scriptOwners = script ? packages.filter((pkg) => pkg.scripts.has(script)) : []
    if (scriptOwners.length === 1) {
      const owner = scriptOwners[0]!
      const rewritten = maybeRewritePnpmVitestCommand(owner, script!, rest)
      if (rewritten) return rewritten
      const relDir = owner.relativeDir
      return normalizeCommand(`pnpm --dir ${relDir} ${script!}${rest}`)
    }
    if (script && /^(?:tsc|tsgo|vitest|jest|playwright|eslint|biome)$/i.test(script)) {
      return normalizeCommand(`pnpm exec ${script}${rest}`)
    }
    return null
  }

  const rootScriptCommand = /^pnpm\s+([a-z0-9:_-]+)(.*)$/i.exec(normalized)
  if (rootScriptCommand) {
    const [, script, rest = ''] = rootScriptCommand
    if (script && rootScripts.has(script)) {
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
    const scriptOwners = script ? packages.filter((pkg) => pkg.scripts.has(script)) : []
    if (scriptOwners.length === 1) {
      const owner = scriptOwners[0]!
      const rewritten = maybeRewritePnpmVitestCommand(owner, script!, rest)
      if (rewritten) return rewritten
      const relDir = owner.relativeDir
      return normalizeCommand(`pnpm --dir ${relDir} ${script!}${rest}`)
    }
    if (script && /^(?:tsc|tsgo|vitest|jest|playwright|eslint|biome)$/i.test(script)) {
      return normalizeCommand(`pnpm exec ${script}${rest}`)
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
    const explicitCommand = typeof criterion.command === 'string' ? criterion.command.trim() : ''
    const command = explicitCommand.length > 0
      ? validateOrNormalizePnpmCommand(explicitCommand, projectPath)
      : inferCommandFromAutomatedAcceptanceDescription(
          criterion.description ?? '',
          projectPath,
        )
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

function deriveFocusedVerificationBuckets(
  projectPath: string,
  likelyTargetFiles: readonly string[],
): Map<GateCommandKind, string[]> {
  const buckets = new Map<GateCommandKind, string[]>()
  const workspacePackages = readWorkspacePackages(projectPath)
  const push = (kind: GateCommandKind, command: string) => {
    const normalized = normalizeCommand(command)
    if (!normalized) return
    const existing = buckets.get(kind) ?? []
    if (!existing.includes(normalized)) existing.push(normalized)
    buckets.set(kind, existing)
  }

  for (const rawFile of likelyTargetFiles) {
    const relativeFile = resolveRelativeFileFromDescription(projectPath, rawFile)
    if (!relativeFile) continue
    const owner = owningPackageForRelativeFile(workspacePackages, relativeFile)
    if (!owner) continue
    if (/\.(?:spec|test)\.[a-z0-9]+$/i.test(relativeFile) && owner.scripts.has('test')) {
      const packageRelativeFile =
        owner.relativeDir === '.'
          ? relativeFile
          : normalizeCommand(path.relative(owner.dir, path.join(projectPath, relativeFile)))
      push(
        'test',
        owner.relativeDir === '.'
          ? `pnpm vitest --run ${packageRelativeFile}`
          : `cd ${owner.relativeDir} && pnpm vitest --run ${packageRelativeFile}`,
      )
    }
  }

  return buckets
}

function mergeVerificationCommands(
  acceptanceBuckets: Map<GateCommandKind, string[]>,
  focusedBuckets: Map<GateCommandKind, string[]>,
  projectCommands: readonly string[] | undefined,
  narrowTaskHint: boolean,
): readonly string[] | undefined {
  if (
    acceptanceBuckets.size === 0 &&
    focusedBuckets.size === 0 &&
    !narrowTaskHint
  ) {
    return projectCommands
  }

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
    const focused = focusedBuckets.get(kind)

    if (
      kind === 'test' &&
      narrowTaskHint &&
      focused &&
      focused.length > 0
    ) {
      pushAll(focused)
      continue
    }

    if (acceptance && acceptance.length > 0) {
      pushAll(acceptance)
      continue
    }

    if (focused && focused.length > 0) {
      pushAll(focused)
      continue
    }

    // Keep worker verification conservative for narrow tasks: only inherit the
    // broad repo-wide test command when the task itself asked for tests or we
    // derived a focused test target from likely files.
    if (kind === 'test' && narrowTaskHint) continue

    const fallback = (projectCommands ?? []).filter((command) => classifyGateCommand(command) === kind)
    pushAll(fallback)
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

export function resolveEffectiveTaskBootstrapBlock(input: {
  task: Pick<Task, 'projectPath'>
  workspaceProjectPath: string
  workspaceBootstrap?: BootstrapBlock
  workspaceProjects?: readonly WorkspaceProjectBlock[]
}): { commands: readonly string[]; successGates: readonly string[]; timeoutMs: number } | null {
  const taskProjectPath = resolveEffectiveTaskProjectPath(input.task, input.workspaceProjectPath)
  const projectBootstrap = input.workspaceProjects
    ?.find((project) => path.resolve(project.path) === path.resolve(taskProjectPath))
    ?.bootstrap
  const bootstrap = projectBootstrap ?? input.workspaceBootstrap
  if (!bootstrap) return null
  const fallbackPackageManager = detectPackageManager(input.workspaceProjectPath)
  return {
    commands: rewriteBootstrapCommandsForTask({
      commands: bootstrap.commands,
      workspaceProjectPath: input.workspaceProjectPath,
      taskProjectPath,
      fallbackPackageManager,
    }),
    successGates: rewriteBootstrapGatesForTask({
      commands: effectiveBootstrapGateCommands(bootstrap),
      workspaceProjectPath: input.workspaceProjectPath,
      taskProjectPath,
      fallbackPackageManager,
    }),
    timeoutMs: bootstrap.timeoutMs,
  }
}

export function resolveEffectiveTaskSuccessGates(input: {
  task: Pick<Task, 'projectPath' | 'acceptanceCriteria'>
  workspaceProjectPath: string
  workspaceBootstrap?: BootstrapBlock
  likelyTargetFiles?: readonly string[]
}): readonly string[] | undefined {
  const taskProjectPath = resolveEffectiveTaskProjectPath(
    input.task,
    input.workspaceProjectPath,
  )
  const workspaceProjectPath = path.resolve(input.workspaceProjectPath)
  const acceptanceBuckets = deriveAutomatedAcceptanceCommands(input.task, taskProjectPath)
  const focusedBuckets = deriveFocusedVerificationBuckets(
    taskProjectPath,
    input.likelyTargetFiles ?? [],
  )
  const narrowTaskHint = (input.likelyTargetFiles ?? []).length > 0

  if (taskProjectPath !== workspaceProjectPath) {
    const workspacePackageManager = detectPackageManager(workspaceProjectPath)
    const taskScoped = rewriteTaskProjectCommandsForWorkspace(
      detectProjectGateCommands(taskProjectPath, workspacePackageManager),
      workspaceProjectPath,
      taskProjectPath,
    )
    const taskAcceptanceBuckets = rewriteTaskProjectBucketsForWorkspace(
      acceptanceBuckets,
      workspaceProjectPath,
      taskProjectPath,
    )
    const taskFocusedBuckets = rewriteTaskProjectBucketsForWorkspace(
      focusedBuckets,
      workspaceProjectPath,
      taskProjectPath,
    )
    const merged = mergeVerificationCommands(
      taskAcceptanceBuckets,
      taskFocusedBuckets,
      taskScoped,
      narrowTaskHint,
    )
    if (merged && merged.length > 0) return merged
  }

  if (hasBootstrapSignal(input.workspaceBootstrap)) {
    return mergeVerificationCommands(
      acceptanceBuckets,
      focusedBuckets,
      effectiveBootstrapGateCommands(input.workspaceBootstrap!),
      narrowTaskHint,
    )
  }

  return mergeVerificationCommands(acceptanceBuckets, focusedBuckets, undefined, narrowTaskHint)
}

export function resolveEffectiveTaskVerificationCommands(input: {
  task: Pick<Task, 'projectPath' | 'acceptanceCriteria'>
  workspaceProjectPath: string
  workspaceBootstrap?: BootstrapBlock
  likelyTargetFiles?: readonly string[]
}): readonly string[] | undefined {
  const taskProjectPath = resolveEffectiveTaskProjectPath(
    input.task,
    input.workspaceProjectPath,
  )
  const workspaceProjectPath = path.resolve(input.workspaceProjectPath)
  const acceptanceBuckets = deriveAutomatedAcceptanceCommands(input.task, taskProjectPath)
  const focusedBuckets = deriveFocusedVerificationBuckets(
    taskProjectPath,
    input.likelyTargetFiles ?? [],
  )
  const narrowTaskHint = (input.likelyTargetFiles ?? []).length > 0

  if (taskProjectPath !== workspaceProjectPath) {
    const workspacePackageManager = detectPackageManager(workspaceProjectPath)
    const taskScoped = rewriteTaskProjectCommandsForWorkspace(
      detectProjectGateCommands(taskProjectPath, workspacePackageManager),
      workspaceProjectPath,
      taskProjectPath,
    )
    const taskAcceptanceBuckets = rewriteTaskProjectBucketsForWorkspace(
      acceptanceBuckets,
      workspaceProjectPath,
      taskProjectPath,
    )
    const taskFocusedBuckets = rewriteTaskProjectBucketsForWorkspace(
      focusedBuckets,
      workspaceProjectPath,
      taskProjectPath,
    )
    const merged = mergeVerificationCommands(
      taskAcceptanceBuckets,
      taskFocusedBuckets,
      taskScoped,
      narrowTaskHint,
    )
    if (merged && merged.length > 0) return merged
  }

  if (hasBootstrapSignal(input.workspaceBootstrap)) {
    return mergeVerificationCommands(
      acceptanceBuckets,
      focusedBuckets,
      effectiveBootstrapGateCommands(input.workspaceBootstrap!),
      narrowTaskHint,
    )
  }

  return mergeVerificationCommands(acceptanceBuckets, focusedBuckets, undefined, narrowTaskHint)
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

export function renderTaskScopedVerificationInstructions(input: {
  projectPath: string
  successGates: readonly string[] | undefined
}): string {
  const lines = [
    '## Authoritative verification commands',
    '',
    `When you verify work for this task, run commands against \`${input.projectPath}\`. This task path is authoritative even when the outer workspace root differs.`,
  ]

  if (input.successGates === undefined) {
    lines.push(
      '',
      'No task-scoped verification commands were derived for this task path. Verify conservatively against the task project path above and avoid inventing extra repo-wide gates.',
    )
    return lines.join('\n')
  }

  if (input.successGates.length === 0) {
    lines.push(
      '',
      'No verified shell commands are currently configured for this task path. Only run verification that the task itself names explicitly.',
    )
    return lines.join('\n')
  }

  lines.push(
    '',
    'Use these commands as the authoritative verification commands for this task:',
    ...input.successGates.map((gate) => `- \`${gate}\``),
    '',
    'If you call `shell` for verification and your drafted command differs, Guildhall will reconcile it back to this authoritative list.',
  )
  return lines.join('\n')
}
