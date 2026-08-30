import fs from 'node:fs'
import path from 'node:path'
import type { Task } from '@guildhall/core'
import { resolveRuntimePath } from './path-utils.js'
import type { ResolvedConfig } from '@guildhall/config'
import { detectGateCommands, detectPackageManager, type PackageManager } from './bootstrap.js'
import { detectBootstrapHypothesis } from './detect-bootstrap.js'

type BootstrapBlock = NonNullable<ResolvedConfig['bootstrap']>
type WorkspaceProjectBlock = NonNullable<ResolvedConfig['projects']>[number]
type TaskProjectPathInput = Partial<Pick<Task, 'projectPath' | 'domain' | 'title' | 'description'>>

export interface RecentVerificationResult {
  kind?: 'command'
  command: string
  passed: boolean
  observedAt?: string
}

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
  if (hypothesis.successGates.length > 0) {
    return applyWorkspaceNodePackageManagerFallback(
      projectPath,
      hypothesis.successGates,
      fallbackPackageManager,
    )
  }

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

function applyWorkspaceNodePackageManagerFallback(
  projectPath: string,
  commands: readonly string[],
  fallbackPackageManager: PackageManager,
): string[] {
  if (fallbackPackageManager === 'none') return [...commands]
  if (!fs.existsSync(path.join(projectPath, 'package.json'))) return [...commands]
  if (detectPackageManager(projectPath) !== 'none') return [...commands]
  return commands.map((command) =>
    normalizeCommand(command).replace(/^(?:npm|yarn|bun|pnpm)(?=\s)/, fallbackPackageManager),
  )
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

export function normalizeRunRecordJsonSelectionCommand(command: string): string {
  const normalized = normalizeCommand(command)
  if (
    !/require\(['"]\.\/runs\/['"]\s*\+/.test(normalized) ||
    !/readdirSync\(['"]runs['"]\)/.test(normalized) ||
    !/\.find\(\s*(\w+)\s*=>/.test(normalized)
  ) {
    return normalized
  }
  return normalized.replace(
    /\.find\(\s*(\w+)\s*=>\s*\1\.startsWith\(([^)]*)\)\s*\)/g,
    (match, name: string, prefix: string) =>
      match.includes('.endsWith(')
        ? match
        : `.find(${name}=>${name}.startsWith(${prefix})&&${name}.endsWith('.json'))`,
  )
}

function isSelfReferentialGuildhallTaskCommand(command: string): boolean {
  const normalized = normalizeCommand(command)
  return /\b(?:npx\s+)?guildhall\s+run\b/i.test(normalized) && /\s--task(?:=|\s)/i.test(normalized)
}

function packageScriptBodyForCommand(command: string, projectPath: string): string | null {
  const reference = packageScriptReferenceForCommand(command, projectPath)
  return reference?.parsed.scriptBodies[reference.script]?.trim() ?? null
}

function packageScriptReferenceForCommand(
  command: string,
  projectPath: string,
): { script: string; parsed: NonNullable<ReturnType<typeof readPackageScripts>> } | null {
  const normalized = normalizeCommand(command)
  if (!/^pnpm\s+/i.test(normalized)) return null
  const dirMatch = /^pnpm\s+--dir\s+(\S+)\s+(.+)$/i.exec(normalized)
  const targetPath = dirMatch ? path.resolve(projectPath, dirMatch[1]!) : projectPath
  const scriptCommand = dirMatch?.[2] ?? normalized.replace(/^pnpm\s+/i, '')
  const scriptMatch = /^(?:run\s+)?([a-z0-9:_-]+)(?:\s|$)/i.exec(scriptCommand)
  if (!scriptMatch) return null
  const script = scriptMatch[1]!
  if (['exec', 'install', 'add', 'remove', 'update', 'dlx'].includes(script.toLowerCase())) return null
  const parsed = readPackageScripts(targetPath)
  return parsed ? { script, parsed } : null
}

export type InvalidAutomatedAcceptanceCommand = {
  criterionId: string
  command: string
  reason: string
}

export type MissingAutomatedAcceptanceCommand = {
  criterionId: string
  description: string
}

/**
 * `automated` is a typed shell-command verifier. Do not let a task enter an
 * execution lane when it has promised automated proof but omitted the command
 * that could produce it.
 */
export function findAutomatedAcceptanceCriteriaMissingCommands(
  task: Pick<Task, 'acceptanceCriteria'>,
): readonly MissingAutomatedAcceptanceCommand[] {
  return (task.acceptanceCriteria ?? []).flatMap((criterion) => {
    if (criterion.verifiedBy !== 'automated') return []
    if (typeof criterion.command === 'string' && criterion.command.trim().length > 0) return []
    return [{ criterionId: criterion.id, description: criterion.description }]
  })
}

/** Keep acceptance gates on the project side of the Guildhall boundary. */
export function findInvalidAutomatedAcceptanceCommands(input: {
  task: Pick<Task, 'acceptanceCriteria'>
  projectPath: string
  allowMissingPackageScripts?: boolean
}): readonly InvalidAutomatedAcceptanceCommand[] {
  const invalid: InvalidAutomatedAcceptanceCommand[] = []
  for (const criterion of input.task.acceptanceCriteria ?? []) {
    if (criterion.verifiedBy !== 'automated') continue
    const command = typeof criterion.command === 'string' ? normalizeCommand(criterion.command) : ''
    if (!command) continue
    if (isSelfReferentialGuildhallTaskCommand(command)) {
      invalid.push({
        criterionId: criterion.id,
        command,
        reason: 'The command invokes Guildhall task orchestration instead of proving the project locally.',
      })
      continue
    }
    const scriptReference = packageScriptReferenceForCommand(command, input.projectPath)
    if (
      scriptReference &&
      !scriptReference.parsed.scripts.has(scriptReference.script) &&
      input.allowMissingPackageScripts !== true
    ) {
      invalid.push({
        criterionId: criterion.id,
        command,
        reason: `The PNPM script \`${scriptReference.script}\` is not present in the registered project package contract.`,
      })
      continue
    }
    const scriptBody = packageScriptBodyForCommand(command, input.projectPath)
    if (scriptBody && isSelfReferentialGuildhallTaskCommand(scriptBody)) {
      invalid.push({
        criterionId: criterion.id,
        command,
        reason: 'The command resolves to a package script that invokes Guildhall task orchestration instead of proving the project locally.',
      })
    }
  }
  return invalid
}

function isValidPackageScriptProofCommand(
  parsed: { scriptBodies: Record<string, string> } | null | undefined,
  script: string,
): boolean {
  const body = parsed?.scriptBodies[script]?.trim() ?? ''
  return body.length === 0 || !isSelfReferentialGuildhallTaskCommand(body)
}

function isWithin(parent: string, child: string): boolean {
  const normalizedParent = path.resolve(parent)
  const normalizedChild = path.resolve(child)
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${path.sep}`)
}

function hasExecutionProjectMarker(projectPath: string): boolean {
  return [
    '.git',
    'guildhall.yaml',
    'package.json',
    'pnpm-workspace.yaml',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod',
    'deno.json',
    'deno.jsonc',
  ].some(file => fs.existsSync(path.join(projectPath, file)))
}

function isDocumentationSourcePath(taskProjectPath: string, workspaceProjectPath: string): boolean {
  if (!isWithin(workspaceProjectPath, taskProjectPath)) return false
  const relativePath = path.relative(workspaceProjectPath, taskProjectPath)
  if (!relativePath || relativePath.startsWith('..')) return false
  return relativePath.split(path.sep).some(segment => ['doc', 'docs', 'documentation'].includes(segment.toLowerCase()))
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
  const hypothesis = detectBootstrapHypothesis(projectPath)
  if (hypothesis.commands.length > 0) {
    return applyWorkspaceNodePackageManagerFallback(
      projectPath,
      hypothesis.commands,
      fallbackPackageManager,
    )
  }

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

function validateOrNormalizePnpmCommand(command: string, projectPath: string): string | null {
  const normalized = normalizeCommand(command)
  const rootPackage = readPackageScripts(projectPath)
  const rootScripts = rootPackage?.scripts ?? new Set<string>()
  const packages = readWorkspacePackages(projectPath)

  // A project proof may use Node directly, but the project package manager is
  // still the execution boundary. Keep the command reproducible through the
  // workspace's PNPM environment instead of persisting a bare `node` call.
  if (/^node(?:\s|$)/i.test(normalized)) {
    return normalizeCommand(`pnpm exec ${normalized}`)
  }

  const cdCommand = /^cd\s+(\S+)\s*&&\s*(.+)$/i.exec(normalized)
  if (cdCommand) {
    const [, relDir, rest] = cdCommand
    const targetDir = path.resolve(projectPath, relDir!)
    const rewritten = validateOrNormalizePnpmCommand(rest!, targetDir)
    return rewritten ? normalizeCommand(`cd ${relDir} && ${rewritten}`) : null
  }

  const dirCommand = /^pnpm\s+--dir\s+(\S+)\s+([a-z0-9:_-]+)(.*)$/i.exec(normalized)
  if (dirCommand) {
    const [, relDir, script, rest = ''] = dirCommand
    const targetDir = path.resolve(projectPath, relDir!)
    const parsed = readPackageScripts(targetDir)
    if (script && parsed?.scripts.has(script) && isValidPackageScriptProofCommand(parsed, script)) {
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
    if (selectorMatches?.scripts.has(script) && isValidPackageScriptProofCommand(selectorMatches, script)) {
      const rewritten = maybeRewritePnpmVitestCommand(selectorMatches, script, rest)
      if (rewritten) return rewritten
      return reordered
    }

    const scriptOwners = script
      ? packages.filter((pkg) => pkg.scripts.has(script) && isValidPackageScriptProofCommand(pkg, script))
      : []
    if (scriptOwners.length === 1) {
      const owner = scriptOwners[0]!
      const rewritten = maybeRewritePnpmVitestCommand(owner, script!, rest)
      if (rewritten) return rewritten
      const relDir = owner.relativeDir
      return normalizeCommand(`pnpm --dir ${relDir} ${script!}${rest}`)
    }
    if (script && /^(?:tsc|tsgo|vitest|jest|playwright|eslint|biome)$/i.test(script)) {
      if (
        /^(?:tsc|tsgo)$/i.test(script) &&
        !fs.existsSync(path.join(projectPath, 'tsconfig.json'))
      ) {
        const tsconfigOwners = packages.filter((pkg) =>
          fs.existsSync(path.join(pkg.dir, 'tsconfig.json')),
        )
        if (tsconfigOwners.length === 1) {
          return normalizeCommand(`pnpm --dir ${tsconfigOwners[0]!.relativeDir} exec ${script}${rest}`)
        }
      }
      return normalizeCommand(`pnpm exec ${script}${rest}`)
    }
    return null
  }

  const rootScriptCommand = /^pnpm\s+([a-z0-9:_-]+)(.*)$/i.exec(normalized)
  if (rootScriptCommand) {
    const [, script, rest = ''] = rootScriptCommand
    if (script && rootScripts.has(script) && isValidPackageScriptProofCommand(rootPackage, script)) {
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
    const scriptOwners = script
      ? packages.filter((pkg) => pkg.scripts.has(script) && isValidPackageScriptProofCommand(pkg, script))
      : []
    if (scriptOwners.length === 1) {
      const owner = scriptOwners[0]!
      const rewritten = maybeRewritePnpmVitestCommand(owner, script!, rest)
      if (rewritten) return rewritten
      const relDir = owner.relativeDir
      return normalizeCommand(`pnpm --dir ${relDir} ${script!}${rest}`)
    }
    if (script && /^(?:tsc|tsgo|vitest|jest|playwright|eslint|biome)$/i.test(script)) {
      if (
        /^(?:tsc|tsgo)$/i.test(script) &&
        !fs.existsSync(path.join(projectPath, 'tsconfig.json'))
      ) {
        const tsconfigOwners = packages.filter((pkg) =>
          fs.existsSync(path.join(pkg.dir, 'tsconfig.json')),
        )
        if (tsconfigOwners.length === 1) {
          return normalizeCommand(`pnpm --dir ${tsconfigOwners[0]!.relativeDir} exec ${script}${rest}`)
        }
      }
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
    // Natural-language acceptance criteria can describe a proof target, but
    // they cannot manufacture an executable contract. Commands must arrive as
    // structured data or through an explicit source-backed proof repair.
    const command = explicitCommand.length > 0
      ? validateOrNormalizePnpmCommand(explicitCommand, projectPath)
      : null
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

function normalizeCriterionCommand(
  command: string | undefined,
  projectPath: string,
): string | null {
  if (typeof command !== 'string' || command.trim().length === 0) return null
  return validateOrNormalizePnpmCommand(normalizeRunRecordJsonSelectionCommand(command), projectPath)
}

export function normalizeAutomatedAcceptanceCriterionCommands(input: {
  task: Pick<Task, 'projectPath' | 'domain' | 'acceptanceCriteria'>
  workspaceProjectPath: string
  workspaceProjects?: readonly WorkspaceProjectBlock[]
}): boolean {
  const taskProjectPath = resolveEffectiveTaskProjectPath(
    input.task,
    input.workspaceProjectPath,
    { workspaceProjects: input.workspaceProjects },
  )
  let changed = false
  for (const criterion of input.task.acceptanceCriteria ?? []) {
    if (criterion.verifiedBy !== 'automated') continue
    const normalized = normalizeCriterionCommand(criterion.command, taskProjectPath)
    if (!normalized || normalized === criterion.command) continue
    criterion.command = normalized
    changed = true
  }
  return changed
}

export function reconcileAutomatedAcceptanceCommandsFromVerificationResults(input: {
  task: Pick<Task, 'projectPath' | 'domain' | 'acceptanceCriteria'>
  workspaceProjectPath: string
  workspaceProjects?: readonly WorkspaceProjectBlock[]
  recentVerificationResults: readonly RecentVerificationResult[] | undefined
}): boolean {
  const taskProjectPath = resolveEffectiveTaskProjectPath(
    input.task,
    input.workspaceProjectPath,
    { workspaceProjects: input.workspaceProjects },
  )
  const passedCommands = (input.recentVerificationResults ?? [])
    .filter((entry) => entry?.kind === undefined || entry.kind === 'command')
    .filter((entry): entry is RecentVerificationResult => Boolean(entry?.command?.trim()))
    .filter((entry) => entry.passed)
    .map((entry) => normalizeCriterionCommand(entry.command, taskProjectPath))
    .filter((command): command is string => Boolean(command))

  if (passedCommands.length === 0) return false

  let changed = normalizeAutomatedAcceptanceCriterionCommands(input)
  const criteriaByKind = new Map<GateCommandKind, typeof input.task.acceptanceCriteria>()
  for (const criterion of input.task.acceptanceCriteria ?? []) {
    if (criterion.verifiedBy !== 'automated') continue
    const normalized = normalizeCriterionCommand(criterion.command, taskProjectPath)
    if (!normalized) continue
    const kind = classifyGateCommand(normalized)
    criteriaByKind.set(kind, [...(criteriaByKind.get(kind) ?? []), criterion])
  }

  const passedByKind = new Map<GateCommandKind, string[]>()
  for (const command of passedCommands) {
    const kind = classifyGateCommand(command)
    const existing = passedByKind.get(kind) ?? []
    if (!existing.includes(command)) existing.push(command)
    passedByKind.set(kind, existing)
  }

  for (const [kind, criteria] of criteriaByKind) {
    const candidates = passedByKind.get(kind) ?? []
    if (criteria.length !== 1 || candidates.length !== 1) continue
    const criterion = criteria[0]!
    const learned = candidates[0]!
    if (criterion.command === learned) continue
    criterion.command = learned
    changed = true
  }

  return changed
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

  // Explicit automated acceptance commands are the task's proof contract.
  // They already express the scope the planner approved, so adding missing
  // categories from workspace bootstrap would turn an intentionally narrow
  // task into an unrelated project-wide gate (for example, adding `pnpm
  // build` to a script-only proof). When a task has a broad test command but
  // Guildhall can derive a focused target from its changed files, the focused
  // command is the more concrete form of that same proof. Bootstrap commands
  // remain the inference path only when the task has no concrete automated
  // proof of its own.
  if (acceptanceBuckets.size > 0) {
    for (const kind of ['typecheck', 'build', 'test', 'lint'] as const) {
      const focused = focusedBuckets.get(kind)
      if (kind === 'test' && focused && focused.length > 0) {
        pushAll(focused)
        continue
      }
      pushAll(acceptanceBuckets.get(kind) ?? [])
    }
    for (const [kind, commands] of acceptanceBuckets) {
      if (kind === 'typecheck' || kind === 'build' || kind === 'test' || kind === 'lint') continue
      pushAll(commands)
    }
    return merged.length > 0 ? merged : undefined
  }

  if (focusedBuckets.size === 0 && !narrowTaskHint) return projectCommands

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

function workspaceProjectForTask(
  task: TaskProjectPathInput,
  workspaceProjects: readonly WorkspaceProjectBlock[] | undefined,
): WorkspaceProjectBlock | undefined {
  if (!workspaceProjects || workspaceProjects.length === 0) return undefined
  const taskDomain = typeof task.domain === 'string' ? task.domain.trim() : ''
  if (taskDomain) {
    const domainMatch = workspaceProjects.find(project =>
      project.id === taskDomain || project.coordinator === taskDomain,
    )
    if (domainMatch) return domainMatch
  }
  const taskProjectPath = typeof task.projectPath === 'string' ? task.projectPath.trim() : ''
  if (!taskProjectPath) return undefined
  const resolvedTaskProjectPath = resolveRuntimePath(taskProjectPath)
  return workspaceProjects.find(project => path.resolve(project.path) === resolvedTaskProjectPath)
}

export function resolveEffectiveTaskProjectPath(
  task: TaskProjectPathInput,
  workspaceProjectPath: string,
  options: { workspaceProjects?: readonly WorkspaceProjectBlock[] } = {},
): string {
  const workspaceProject = workspaceProjectForTask(task, options.workspaceProjects)
  if (typeof task.projectPath === 'string' && task.projectPath.trim().length > 0) {
    const taskProjectPath = task.projectPath.trim()
    const resolvedTaskProjectPath = path.isAbsolute(taskProjectPath)
      ? resolveRuntimePath(taskProjectPath)
      : resolveRuntimePath(path.join(workspaceProjectPath, taskProjectPath))
    const resolvedWorkspaceProjectPath = resolveRuntimePath(workspaceProjectPath)
    if (
      workspaceProject &&
      path.resolve(resolvedTaskProjectPath) === path.resolve(resolvedWorkspaceProjectPath)
    ) {
      return resolveRuntimePath(workspaceProject.path)
    }
    if (
      isDocumentationSourcePath(resolvedTaskProjectPath, resolvedWorkspaceProjectPath) &&
      !hasExecutionProjectMarker(resolvedTaskProjectPath)
    ) {
      if (workspaceProject) return resolveRuntimePath(workspaceProject.path)
      return resolvedWorkspaceProjectPath
    }
    return resolvedTaskProjectPath
  }
  if (workspaceProject) return resolveRuntimePath(workspaceProject.path)
  return resolveRuntimePath(workspaceProjectPath)
}

export function resolveEffectiveTaskBootstrapBlock(input: {
  task: Pick<Task, 'projectPath' | 'domain'>
  workspaceProjectPath: string
  workspaceBootstrap?: BootstrapBlock
  workspaceProjects?: readonly WorkspaceProjectBlock[]
}): { commands: readonly string[]; successGates: readonly string[]; timeoutMs: number } | null {
  const taskProjectPath = resolveEffectiveTaskProjectPath(input.task, input.workspaceProjectPath, {
    workspaceProjects: input.workspaceProjects,
  })
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
  task: Pick<Task, 'projectPath' | 'domain' | 'acceptanceCriteria'>
  workspaceProjectPath: string
  workspaceBootstrap?: BootstrapBlock
  likelyTargetFiles?: readonly string[]
  workspaceProjects?: readonly WorkspaceProjectBlock[]
}): readonly string[] | undefined {
  const taskProjectPath = resolveEffectiveTaskProjectPath(
    input.task,
    input.workspaceProjectPath,
    { workspaceProjects: input.workspaceProjects },
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
  task: Pick<Task, 'projectPath' | 'domain' | 'acceptanceCriteria'>
  workspaceProjectPath: string
  workspaceBootstrap?: BootstrapBlock
  likelyTargetFiles?: readonly string[]
  workspaceProjects?: readonly WorkspaceProjectBlock[]
}): readonly string[] | undefined {
  const taskProjectPath = resolveEffectiveTaskProjectPath(
    input.task,
    input.workspaceProjectPath,
    { workspaceProjects: input.workspaceProjects },
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
  verificationCwd?: string
  successGates: readonly string[] | undefined
}): string {
  const verificationCwd = input.verificationCwd ?? input.projectPath
  const lines = [
    '## Authoritative verification commands',
    '',
    `When you verify work for this task, use the command list below from the working directory Guildhall names here. The task project path is \`${input.projectPath}\`, but package-scoped commands may need to run from a parent workspace/worktree root.`,
    '',
    `Working directory: \`${verificationCwd}\``,
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
    'If you call `shell` for verification and your drafted command differs, Guildhall will reconcile it back to this authoritative list and working directory.',
  )
  return lines.join('\n')
}
