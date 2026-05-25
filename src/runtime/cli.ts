#!/usr/bin/env node
import { dirname, resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { confirm } from '@inquirer/prompts'
import { runOrchestrator } from './orchestrator.js'
import { renderBakeoffMarkdown, runContextIndexerBakeoff, runModelBakeoff } from './model-bakeoff.js'
import { migrateLegacyMemoryToLocalHistory } from './memory-migration.js'
import { migrateTaskState } from './task-state-migration.js'
import { compactProjectState } from './project-state-compaction.js'
import { recordCalibrationCorpusValidation } from './review-calibration.js'
import { createReviewAuditStore } from './review-audit-store.js'
import { resolveWorkspace, loadWorkspace } from './workspace-loader.js'
import {
  configureClaudeProjectMcpBridge,
  configureCodexMcpBridge,
  installAgentBridgeInstructions,
  type AgentBridgeTarget,
} from './agent-bridge-install.js'
import { runInit } from './init.js'
import { runServe } from './serve.js'
import {
  listWorkspaces,
  findWorkspace,
  registerWorkspace,
  unregisterWorkspace,
  readWorkspaceConfig,
  readGlobalConfig,
  readGlobalProviders,
  resolveModelsForProvider,
  slugify,
} from '@guildhall/config'
import { exec, spawn } from 'node:child_process'
import { platform } from 'node:os'
import { buildSemanticIndexPrompt, refreshCodebaseMap, type CorpusSemanticIndexer } from '@guildhall/corpus-map'
import { OpenAICompatibleClient } from '@guildhall/providers'
import { getProjectStateDir } from '@guildhall/sessions'
import { FileBackedGuildhallPersistence } from '@guildhall/persistence'

function openBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? `open "${url}"`
    : platform() === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`
  exec(cmd, err => {
    if (err) console.log(`[guildhall] Open this URL in your browser: ${url}`)
  })
}

/** Expand leading ~ to home directory */
function expandPath(p: string): string {
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p
}

const DEFAULT_DASHBOARD_PORT = 7777
const SERVICE_STATE_FILENAME = 'service.json'
const APPROX_CHARS_PER_TOKEN = 4
const SEMANTIC_COMPLETION_MIN_TOKENS = 8_000
const SEMANTIC_COMPLETION_MAX_TOKENS = 16_000
const SEMANTIC_REPAIR_MIN_TOKENS = 10_000
const SEMANTIC_REPAIR_MAX_TOKENS = 24_000

interface ServiceRuntimeState {
  pid: number
  port: number
  url: string
  startedAt: string
}

export function serviceUrlForPort(port: number): string {
  return `http://localhost:${port}`
}

export function launchRouteForProject(pathHint: string | null): string {
  if (!pathHint) return '/projects'
  const resolved = resolve(pathHint)
  try {
    const entry = findWorkspace(resolved)
    const projectPath = entry?.path ?? resolved
    return readWorkspaceConfig(projectPath) ? '/project' : '/setup'
  } catch {
    return '/setup'
  }
}

function printExistingService(state: ServiceRuntimeState): void {
  console.log('[guildhall] Guildhall is already running.')
  console.log(`[guildhall] URL: ${state.url}`)
}

export interface ServiceLifecycleIntent {
  kind: 'serve' | 'start' | 'stop' | 'open'
  port: number
  launchProjectPath: string | null
  openBrowser: boolean
}

export function serviceStatePath(home = homedir()): string {
  return join(home, '.guildhall', SERVICE_STATE_FILENAME)
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function readServiceRuntimeState(home = homedir()): ServiceRuntimeState | null {
  const path = serviceStatePath(home)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ServiceRuntimeState>
    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.port !== 'number' ||
      typeof parsed.url !== 'string' ||
      typeof parsed.startedAt !== 'string'
    ) {
      return null
    }
    return {
      pid: parsed.pid,
      port: parsed.port,
      url: parsed.url,
      startedAt: parsed.startedAt,
    }
  } catch {
    return null
  }
}

export function clearServiceRuntimeState(home = homedir()): void {
  rmSync(serviceStatePath(home), { force: true })
}

export function clearServiceRuntimeStateIfOwnedByPid(pid: number, home = homedir()): void {
  const current = readServiceRuntimeState(home)
  if (!current || current.pid !== pid) return
  clearServiceRuntimeState(home)
}

export async function probeLiveService(port = DEFAULT_DASHBOARD_PORT): Promise<ServiceRuntimeState | null> {
  try {
    const response = await fetch(`${serviceUrlForPort(port)}/api/service`)
    if (!response.ok) return null
    const body = await response.json() as Partial<ServiceRuntimeState>
    if (typeof body.pid !== 'number') {
      return null
    }
    const state: ServiceRuntimeState = {
      pid: body.pid,
      port,
      url: serviceUrlForPort(port),
      startedAt: typeof body.startedAt === 'string' ? body.startedAt : new Date().toISOString(),
    }
    if (!isPidAlive(state.pid)) return null
    return state
  } catch {
    return null
  }
}

export function persistServiceRuntimeState(state: ServiceRuntimeState, home = homedir()): void {
  mkdirSync(join(home, '.guildhall'), { recursive: true })
  const path = serviceStatePath(home)
  try {
    writeFileSync(path, JSON.stringify(state, null, 2))
  } catch {
    // non-fatal; callers can still use the live state in-memory
  }
}

export async function discoverServiceRuntimeState(
  port = DEFAULT_DASHBOARD_PORT,
  home = homedir(),
): Promise<ServiceRuntimeState | null> {
  const recorded = readServiceRuntimeState(home)
  if (recorded && isPidAlive(recorded.pid)) return recorded
  if (recorded && !isPidAlive(recorded.pid)) clearServiceRuntimeState(home)

  const live = await probeLiveService(port)
  if (live) {
    persistServiceRuntimeState(live, home)
    return live
  }
  return null
}

export function parseArgs(rawArgs: string[]): {
  getFlag: (flag: string) => string | undefined
  positionals: string[]
} {
  const valueFlags = new Set(['--port', '--service-state', '--domain', '--max-ticks', '--cases', '--task', '--lane', '--finding', '--action', '--missed-by'])
  function getFlag(flag: string): string | undefined {
    const idx = rawArgs.indexOf(flag)
    return idx !== -1 ? rawArgs[idx + 1] : undefined
  }

  const positionals: string[] = []
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i]
    if (a === undefined) continue
    if (a.startsWith('--')) {
      const next = rawArgs[i + 1]
      if (valueFlags.has(a) && next !== undefined && !next.startsWith('--')) i++
      continue
    }
    positionals.push(a)
  }

  return { getFlag, positionals }
}

export function resolveServiceLifecycleIntent(
  commandName: string,
  rawArgs: string[],
  opts: { cwd?: string; homeDir?: string } = {},
): ServiceLifecycleIntent | null {
  const cwd = opts.cwd ?? process.cwd()
  const home = opts.homeDir ?? homedir()
  const { positionals } = parseArgs(rawArgs)
  const port = DEFAULT_DASHBOARD_PORT
  const explicitPath = positionals[0] ? resolve(expandPath(positionals[0].replace(/^~(?=\/)/, home))) : null
  const launchProjectPath = explicitPath ?? resolve(cwd)

  switch (commandName) {
    case 'serve':
      return {
        kind: 'serve',
        port,
        launchProjectPath,
        openBrowser: !rawArgs.includes('--no-open'),
      }
    case 'start':
      return {
        kind: 'start',
        port,
        launchProjectPath: null,
        openBrowser: false,
      }
    case 'open':
      return {
        kind: 'open',
        port,
        launchProjectPath,
        openBrowser: true,
      }
    case 'stop':
      return {
        kind: 'stop',
        port,
        launchProjectPath: null,
        openBrowser: false,
      }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// GuildHall CLI
//
// Commands:
//   guildhall init [path]                — interactive wizard, creates guildhall.yaml + registers
//   guildhall register <path>           — register an existing workspace (must have guildhall.yaml)
//   guildhall unregister <id|path>  — remove a workspace from the registry
//   guildhall list                      — list all registered workspaces
//   guildhall run [id|path]             — run the coordinator for a workspace
//     --domain <id>                 — only process tasks for one coordinator domain
//     --max-ticks <n>               — stop after N ticks (useful for testing)
//     --one-task                    — stop after one task reaches a handoff point
//   guildhall serve                     — start the web dashboard (all workspaces)
//     --port <n>                    — override the dashboard port (default: 7777)
//   guildhall config [id|path]          — re-run the init wizard on an existing workspace
//   guildhall corpus-map refresh [--semantic] [path]
//                                      — rebuild memory/codebase-map.yaml for a workspace
//   guildhall memory migrate-0.8.0 [--apply] [--delete-source] [--update-gitignore] [path]
//   guildhall memory migrate-local-history [--apply] [--delete-source] [--update-gitignore] [path]
//                                      — move old transcripts/events/sessions into ~/.guildhall
//   guildhall review-calibration validate [path] [--cases <dir>]
//                                      — validate and record review calibration corpus coverage
//   guildhall review-calibration escaped-miss [path] --task <id> --lane <lane> --finding <text>
//                                      — record a missed review finding for calibration follow-up
//   guildhall model-bakeoff [--context-indexer] [output]
//                                      — write replay model bakeoff JSON + Markdown
//   guildhall mcp serve [path]          — serve Guildhall project context over MCP stdio
//   guildhall bridge install [--target codex|claude|all] [--yes|--no-configure-mcp] [id|path]
//                                      — install agent instructions for Guildhall MCP
// ---------------------------------------------------------------------------

export const SHIPPED_CLI_COMMANDS = [
  'init',
  'register',
  'unregister',
  'list',
  'run',
  'serve',
  'start',
  'stop',
  'open',
  'config',
  'corpus-map',
  'memory',
  'review-calibration',
  'model-bakeoff',
  'mcp',
  'bridge',
] as const

const [command = 'help', ...args] = process.argv.slice(2)

function getFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx !== -1 ? args[idx + 1] : undefined
}

// Positional arg extraction: returns args that are not flags or flag values.
// We skip a flag's "value" only if the next arg does not itself look like
// another flag — otherwise boolean flags like `--no-browser` would eat the
// following positional by mistake.
function positionals(): string[] {
  const valueFlags = new Set(['--port', '--domain', '--max-ticks', '--service-state', '--target', '--cases', '--task', '--lane', '--finding', '--action', '--missed-by'])
  const result: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === undefined) continue
    if (a.startsWith('--')) {
      const next = args[i + 1]
      if (valueFlags.has(a) && next !== undefined && !next.startsWith('--')) {
        i++ // consume the value
      }
      continue
    }
    result.push(a)
  }
  return result
}

export function renderHelpText(): string {
  return `
GuildHall — multi-agent operating system for software projects

Usage:
  guildhall init [path]              Launch dashboard + browser-based setup wizard
    --port <n>                   Override dashboard port (default: 7777)
    --no-browser                 Don't open a browser window
    --no-serve                   Write guildhall.yaml only (requires --cli-wizard)
    --cli-wizard                 Legacy: run the terminal setup wizard instead
  guildhall register <path>          Register an existing workspace (must contain guildhall.yaml)
  guildhall unregister <id|path> Remove a workspace from the registry
  guildhall list                     Show all registered workspaces

  guildhall run [id|path]            Run the coordinator for a workspace
    --domain <id>                Filter to tasks in one coordinator domain
    --max-ticks <n>              Stop after N ticks (testing)
    --one-task                   Stop after one task reaches terminal/PR/block

  guildhall serve [path]             Start Guildhall in this terminal and open the browser
    --no-open                    Start without opening a browser
  guildhall start                    Start Guildhall in the background
  guildhall stop                     Stop the local service
  guildhall open [path]              Open the running service (starts it if needed)

  guildhall config [id|path]         Re-run the init wizard on an existing workspace
  guildhall corpus-map refresh [--semantic] [path]
                                  Rebuild compact codebase map context
  guildhall memory migrate-0.8.0 [path]
                                  Bring a project onto the 0.8.0 storage layout
  guildhall memory migrate-local-history [path]
                                  Compatibility alias for the 0.8.0 storage migration
  guildhall memory compact-project-state [path]
                                  Archive terminal tasks and move heartbeat progress local
    --apply                      Write files. Without this, prints a dry run
    --delete-source              Remove migrated old memory/ files after copying
    --update-gitignore           Write/refresh Guildhall's managed .gitignore block
  guildhall migrate task-state [id|path]
                                  Move task runtime/evidence out of project-local TASKS.json
    --apply                      Write files. Without this, prints a dry run
  guildhall review-calibration validate [id|path]
                                  Validate and record calibration corpus coverage
    --cases <dir>                Corpus directory (default: internal/calibration/cases/ux)
  guildhall review-calibration escaped-miss [id|path]
                                  Record a missed review finding for calibration follow-up
    --task <id>                  Task where the miss escaped review
    --lane <lane>                Review lane that missed the issue
    --finding <text>             Human finding that reviewers missed
    --action <action>            create_case, update_case, run_bakeoff, add_deterministic_gate, or adjust_planner
    --missed-by <recipe>         Optional reviewer recipe that missed it
  guildhall model-bakeoff [--context-indexer] [output]
                                  Write replay model bakeoff JSON + Markdown
  guildhall mcp serve [project-path]
                                  Serve Guildhall project context over MCP stdio
  guildhall bridge install [--target codex|claude|all] [--yes|--no-configure-mcp] [id|path]
                                  Install agent instructions that point to Guildhall MCP

Options:
  --help, -h                     Show this help

Examples:
  guildhall init ~/projects/my-app
  guildhall run looma
  guildhall serve
  guildhall corpus-map refresh --semantic .
  guildhall memory migrate-0.8.0 --apply --delete-source --update-gitignore .
  guildhall memory compact-project-state --apply .
  guildhall migrate task-state --apply .
  guildhall review-calibration validate . --cases internal/calibration/cases/ux
  guildhall review-calibration escaped-miss . --task task-1 --lane ux_comprehension --finding "Primary action was ambiguous"
  guildhall model-bakeoff artifacts/model-bakeoff/report.json
  guildhall model-bakeoff --context-indexer
  guildhall mcp serve .
  guildhall bridge install --target all --yes .
`.trim()
}

function printHelp() {
  console.log(renderHelpText())
}

async function cmdInit() {
  const pos = positionals()
  const targetDir = pos[0] ?? process.cwd()
  const absPath = resolve(expandPath(targetDir))
  const portArg = getFlag('--port')
  const port = portArg ? Number(portArg) : 7777
  const useCliWizard = process.argv.includes('--cli-wizard')
  const noOpen = process.argv.includes('--no-open') || process.argv.includes('--no-browser')
  const noServe = process.argv.includes('--no-serve')

  if (useCliWizard) {
    await runInit({ targetDir })
    if (noServe) return
  }

  // Default path: open the browser and let the web wizard do the rest.
  console.log(`[guildhall] Project directory: ${absPath}`)
  console.log(`[guildhall] Launching dashboard...`)
  console.log(`[guildhall] The setup wizard will open at http://localhost:${port}/setup`)
  console.log()
  const opts: Parameters<typeof runServe>[0] = { projectPath: absPath, port }
  await runServe(opts)
  if (!noOpen) setTimeout(() => openBrowser(`http://localhost:${port}/setup`), 400)
}

async function cmdRegister() {
  const pos = positionals()
  const targetDir = pos[0]
  if (!targetDir) {
    console.error('[guildhall] Usage: guildhall register <path>')
    process.exit(1)
  }

  const absPath = resolve(expandPath(targetDir))

  // Read the guildhall.yaml to get name and id
  let config
  try {
    config = readWorkspaceConfig(absPath)
  } catch (err) {
    console.error(`[guildhall] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  const id = config.id ?? slugify(config.name)

  try {
    const entry = registerWorkspace({
      id,
      path: absPath,
      name: config.name,
      tags: config.tags ?? [],
    })
    console.log(`[guildhall] ✓ Registered workspace "${entry.name}" (${entry.id}) at ${entry.path}`)
  } catch (err) {
    console.error(`[guildhall] Registration failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

async function cmdUnregister() {
  const pos = positionals()
  const idOrPath = pos[0]
  if (!idOrPath) {
    console.error('[guildhall] Usage: guildhall unregister <id|path>')
    process.exit(1)
  }

  const removed = unregisterWorkspace(idOrPath)
  if (removed) {
    console.log(`[guildhall] ✓ Unregistered workspace: ${idOrPath}`)
  } else {
    console.error(`[guildhall] Workspace not found in registry: ${idOrPath}`)
    process.exit(1)
  }
}

function cmdList() {
  const workspaces = listWorkspaces()

  if (workspaces.length === 0) {
    console.log('[guildhall] No workspaces registered. Run "guildhall init" to create one.')
    return
  }

  console.log(`\n${'ID'.padEnd(20)} ${'NAME'.padEnd(30)} PATH`)
  console.log('-'.repeat(80))
  for (const ws of workspaces) {
    const lastSeen = ws.lastSeenAt
      ? `  (last seen: ${new Date(ws.lastSeenAt).toLocaleDateString()})`
      : ''
    console.log(`${ws.id.padEnd(20)} ${ws.name.padEnd(30)} ${ws.path}${lastSeen}`)
  }
  console.log()
}

async function cmdRun() {
  const pos = positionals()
  const idOrPath = pos[0]
  const domain = getFlag('--domain')
  const maxTicks = Number(getFlag('--max-ticks') ?? Infinity)
  const oneTask = args.includes('--one-task')

  let workspace
  try {
    if (idOrPath) {
      // Try registry lookup by id first, then treat as path
      const entry = findWorkspace(idOrPath)
      if (entry) {
        workspace = loadWorkspace(entry.path)
      } else {
        workspace = loadWorkspace(idOrPath)
      }
    } else {
      workspace = resolveWorkspace()
    }
  } catch (err) {
    console.error(`[guildhall] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  await runOrchestrator(workspace.config, {
    ...(domain ? { domainFilter: domain } : {}),
    maxTicks,
    ...(oneTask ? { stopAfterOneTask: true } : {}),
  })
}

async function waitForServiceReady(home = homedir(), attempts = 40): Promise<ServiceRuntimeState> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const state = readServiceRuntimeState(home)
    if (state && isPidAlive(state.pid)) return state
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error('Guildhall service did not become ready in time.')
}

function cliEntryPath(): string {
  return fileURLToPath(import.meta.url)
}

async function ensureServiceRunning(intent: ServiceLifecycleIntent): Promise<ServiceRuntimeState> {
  const existing = await discoverServiceRuntimeState(intent.port)
  if (existing) return existing

  mkdirSync(join(homedir(), '.guildhall'), { recursive: true })

  const childArgs = [
    cliEntryPath(),
    'serve-internal',
    '--port',
    String(intent.port),
    ...(intent.launchProjectPath ? [intent.launchProjectPath] : []),
    '--service-state',
    serviceStatePath(),
  ]
  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  return waitForServiceReady()
}

async function cmdServe() {
  const intent = resolveServiceLifecycleIntent('serve', args)
  if (!intent) return
  const existing = await discoverServiceRuntimeState(intent.port)
  if (existing) {
    printExistingService(existing)
    return
  }

  if (intent.openBrowser) {
    const targetUrl = `${serviceUrlForPort(intent.port)}${launchRouteForProject(intent.launchProjectPath)}`
    setTimeout(() => openBrowser(targetUrl), 400)
  }

  await runServe({
    port: intent.port,
    ...(intent.launchProjectPath ? { preferredProjectPath: intent.launchProjectPath } : {}),
    serviceStatePath: serviceStatePath(),
  })
}

async function cmdStart() {
  const intent = resolveServiceLifecycleIntent('start', args)
  if (!intent) return
  const existing = await discoverServiceRuntimeState(intent.port)
  if (existing) {
    printExistingService(existing)
    return
  }

  const state = await ensureServiceRunning(intent)
  console.log('[guildhall] Guildhall started in the background.')
  console.log(`[guildhall] URL: ${state.url}`)
}

async function cmdOpen() {
  const intent = resolveServiceLifecycleIntent('open', args)
  if (!intent) return
  const existing = await discoverServiceRuntimeState(intent.port)
  const hasLiveExisting = !!existing
  const state = await ensureServiceRunning(intent)
  if (intent.openBrowser) {
    const targetUrl = hasLiveExisting
      ? state.url
      : `${state.url}${launchRouteForProject(intent.launchProjectPath)}`
    openBrowser(targetUrl)
  }
}

async function cmdStop() {
  const state = await discoverServiceRuntimeState()
  if (!state) {
    console.log('[guildhall] No running service found.')
    return
  }
  process.kill(state.pid, 'SIGTERM')
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!isPidAlive(state.pid)) break
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  clearServiceRuntimeStateIfOwnedByPid(state.pid)
  console.log('[guildhall] Service stopped.')
}

async function cmdServeInternal() {
  const { getFlag, positionals } = parseArgs(args)
  const portArg = getFlag('--port')
  const serviceState = getFlag('--service-state')
  void positionals

  await runServe({
    ...(portArg ? { port: Number(portArg) } : {}),
    ...(serviceState ? { serviceStatePath: serviceState } : {}),
  })
}

async function cmdConfig() {
  const pos = positionals()
  const idOrPath = pos[0]

  let targetDir: string | undefined
  if (idOrPath) {
    const entry = findWorkspace(idOrPath)
    targetDir = entry?.path ?? idOrPath
  }

  await runInit({ targetDir: targetDir ?? process.cwd(), reconfigure: true })
}

async function cmdCorpusMap() {
  const pos = positionals()
  const subcommand = pos[0] ?? 'refresh'
  if (subcommand !== 'refresh') {
    console.error('[guildhall] Usage: guildhall corpus-map refresh [--semantic] [id|path]')
    process.exit(1)
  }
  const idOrPath = pos[1]
  let projectPath: string
  if (idOrPath) {
    const entry = findWorkspace(idOrPath)
    projectPath = resolve(expandPath(entry?.path ?? idOrPath))
  } else {
    projectPath = process.cwd()
  }
  const semantic = args.includes('--semantic')
  const semanticIndexer = semantic ? createSemanticIndexer(projectPath) : undefined
  const result = await refreshCodebaseMap({
    projectRoot: projectPath,
    memoryDir: getProjectStateDir(projectPath),
    reason: 'manual',
    ...(semanticIndexer ? { semanticIndexer } : {}),
  })
  console.log(`[guildhall] Codebase map refreshed (${result.mode}).`)
  console.log(`[guildhall] Files: ${Object.keys(result.map.files).length}`)
  console.log(`[guildhall] Areas: ${result.map.areas.length}`)
  console.log(`[guildhall] Abstractions: ${result.map.abstractions.length}`)
  if (result.map.semantic) {
    console.log(`[guildhall] Semantic: ${result.map.semantic.corpusKind} via ${result.map.semantic.modelId}`)
  }
  console.log(`[guildhall] Written: ${join(getProjectStateDir(projectPath), 'codebase-map.yaml')}`)
}

async function cmdMemory() {
  const pos = positionals()
  const subcommand = pos[0] ?? 'migrate-0.8.0'
  if (!['migrate-0.8.0', 'migrate-local-history', 'compact-project-state'].includes(subcommand)) {
    console.error('[guildhall] Usage: guildhall memory <migrate-0.8.0|migrate-local-history|compact-project-state> [--apply] [id|path]')
    process.exit(1)
  }
  const idOrPath = pos[1]
  let projectPath: string
  if (idOrPath) {
    const entry = findWorkspace(idOrPath)
    projectPath = resolve(expandPath(entry?.path ?? idOrPath))
  } else {
    projectPath = process.cwd()
  }
  const dryRun = !args.includes('--apply')
  if (subcommand === 'migrate-0.8.0') {
    const migration = await migrateLegacyMemoryToLocalHistory({
      projectRoot: projectPath,
      dryRun,
      deleteSource: args.includes('--delete-source'),
      updateGitignore: args.includes('--update-gitignore'),
    })
    const compaction = dryRun
      ? await compactProjectState({ projectRoot: projectPath, dryRun: true })
      : migration.compaction ?? await compactProjectState({ projectRoot: projectPath, dryRun: false })

    console.log(`[guildhall] 0.8.0 project storage migration ${dryRun ? 'dry run' : 'complete'}.`)
    console.log(`[guildhall] Project: ${migration.projectRoot}`)
    console.log(`[guildhall] Local history: ${migration.localHistoryDir}`)
    console.log(`[guildhall] Legacy memory files found: ${migration.filesToCopy.length}`)
    console.log(`[guildhall] Active tasks kept: ${compaction.activeTasksKept}`)
    console.log(`[guildhall] Terminal tasks archived: ${compaction.archivedTasks}`)
    console.log(`[guildhall] Archived task files compacted: ${compaction.archivedTaskFilesCompacted}`)
    console.log(`[guildhall] Codebase map compacted: ${compaction.codebaseMapCompacted ? 'yes' : 'no'}`)
    console.log(`[guildhall] Heartbeat blocks moved: ${compaction.progressHeartbeatsMoved}`)
    console.log(`[guildhall] Shared state bytes: ${compaction.bytesBefore} -> ${compaction.bytesAfter}`)
    if (!dryRun) {
      console.log(`[guildhall] Legacy files copied: ${migration.copied}`)
      console.log(`[guildhall] Legacy source files deleted: ${migration.deleted}`)
      console.log(`[guildhall] .gitignore updated: ${migration.gitignoreUpdated ? 'yes' : 'no'}`)
      if (migration.gitignoreRoots.length > 0) {
        console.log(`[guildhall] .gitignore roots: ${migration.gitignoreRoots.join(', ')}`)
      }
      if (migration.untrackedIgnoredFiles.length > 0) {
        console.log(`[guildhall] Tracked ignored files removed from Git index: ${migration.untrackedIgnoredFiles.length}`)
      }
    } else {
      console.log('[guildhall] Re-run with --apply to perform this migration.')
    }
    return
  }
  if (subcommand === 'compact-project-state') {
    const result = await compactProjectState({ projectRoot: projectPath, dryRun })
    console.log(`[guildhall] Project state compaction ${dryRun ? 'dry run' : 'complete'}.`)
    console.log(`[guildhall] Project: ${result.projectRoot}`)
    console.log(`[guildhall] State dir: ${result.stateDir}`)
    console.log(`[guildhall] Local history: ${result.localHistoryDir}`)
    console.log(`[guildhall] Active tasks kept: ${result.activeTasksKept}`)
    console.log(`[guildhall] Terminal tasks archived: ${result.archivedTasks}`)
    console.log(`[guildhall] Archived task files compacted: ${result.archivedTaskFilesCompacted}`)
    console.log(`[guildhall] Codebase map compacted: ${result.codebaseMapCompacted ? 'yes' : 'no'}`)
    console.log(`[guildhall] Heartbeat blocks moved: ${result.progressHeartbeatsMoved}`)
    console.log(`[guildhall] Shared TASKS/PROGRESS bytes: ${result.bytesBefore} -> ${result.bytesAfter}`)
    if (dryRun) {
      console.log('[guildhall] Re-run with --apply to compact these files.')
    }
    return
  }
  const result = await migrateLegacyMemoryToLocalHistory({
    projectRoot: projectPath,
    dryRun,
    deleteSource: args.includes('--delete-source'),
    updateGitignore: args.includes('--update-gitignore'),
  })

  console.log(`[guildhall] Legacy memory migration ${dryRun ? 'dry run' : 'complete'}.`)
  console.log(`[guildhall] Project: ${result.projectRoot}`)
  console.log(`[guildhall] Local history: ${result.localHistoryDir}`)
  console.log(`[guildhall] Files found: ${result.filesToCopy.length}`)
  if (!dryRun) {
    console.log(`[guildhall] Files copied: ${result.copied}`)
    console.log(`[guildhall] Source files deleted: ${result.deleted}`)
    console.log(`[guildhall] .gitignore updated: ${result.gitignoreUpdated ? 'yes' : 'no'}`)
    if (result.gitignoreRoots.length > 0) {
      console.log(`[guildhall] .gitignore roots: ${result.gitignoreRoots.join(', ')}`)
    }
    if (result.untrackedIgnoredFiles.length > 0) {
      console.log(`[guildhall] Tracked ignored files removed from Git index: ${result.untrackedIgnoredFiles.length}`)
    }
    if (result.compaction) {
      console.log(`[guildhall] Terminal tasks archived: ${result.compaction.archivedTasks}`)
      console.log(`[guildhall] Archived task files compacted: ${result.compaction.archivedTaskFilesCompacted}`)
      console.log(`[guildhall] Codebase map compacted: ${result.compaction.codebaseMapCompacted ? 'yes' : 'no'}`)
      console.log(`[guildhall] Heartbeat blocks moved: ${result.compaction.progressHeartbeatsMoved}`)
    }
  } else if (result.filesToCopy.length > 0) {
    console.log('[guildhall] Re-run with --apply to copy these files.')
  }
}

async function cmdMigrate() {
  const pos = positionals()
  const subcommand = pos[0]
  if (subcommand !== 'task-state') {
    console.error('[guildhall] Usage: guildhall migrate task-state [--dry-run|--apply] [id|path]')
    process.exit(1)
  }
  const idOrPath = pos[1]
  const entry = idOrPath ? findWorkspace(idOrPath) : null
  const projectPath = entry?.path ?? (idOrPath ? resolve(expandPath(idOrPath)) : process.cwd())
  const apply = args.includes('--apply') && !args.includes('--dry-run')
  const result = await migrateTaskState({ projectRoot: projectPath, apply })
  console.log(`[guildhall] Task state migration ${apply ? 'complete' : 'dry run'}.`)
  console.log(`[guildhall] Project: ${projectPath}`)
  console.log(`[guildhall] Tasks inspected: ${result.tasksInspected}`)
  console.log(`[guildhall] Runtime records: ${result.runtimeRecords}`)
  console.log(`[guildhall] Workspace records: ${result.workspaceRecords}`)
  console.log(`[guildhall] Evidence records: ${result.evidenceRecords}`)
  console.log(`[guildhall] Task definitions to rewrite: ${result.taskDefinitionsRewritten}`)
  if (result.backupPath) console.log(`[guildhall] Backup: ${result.backupPath}`)
  if (!apply) console.log('[guildhall] Re-run with --apply to perform this migration.')
}

export async function validateReviewCalibrationCorpus(input: {
  projectPath: string
  casesDir?: string
  recordedBy?: string
  now?: () => Date
}) {
  const projectPath = resolve(expandPath(input.projectPath))
  const casesDir = resolve(projectPath, input.casesDir ?? 'internal/calibration/cases/ux')
  const store = createReviewAuditStore({
    projectRoot: projectPath,
    persistence: new FileBackedGuildhallPersistence(),
    ...(input.now ? { now: input.now } : {}),
  })
  return recordCalibrationCorpusValidation({
    casesDir,
    store,
    recordedBy: input.recordedBy ?? 'guildhall-cli',
    ...(input.now ? { now: input.now } : {}),
  })
}

export async function recordEscapedReviewMiss(input: {
  projectPath: string
  taskId: string
  missedLane: string
  humanFinding: string
  nextCalibrationAction?: string
  missedByRecipe?: string
  recordedBy?: string
  recordedAt?: string
}) {
  const projectPath = resolve(expandPath(input.projectPath))
  const store = createReviewAuditStore({
    projectRoot: projectPath,
    persistence: new FileBackedGuildhallPersistence(),
  })
  return store.linkEscapedMiss({
    taskId: input.taskId,
    missedLane: input.missedLane as never,
    humanFinding: input.humanFinding,
    nextCalibrationAction: (input.nextCalibrationAction ?? 'create_case') as never,
    ...(input.missedByRecipe ? { missedByRecipe: input.missedByRecipe } : {}),
    recordedBy: input.recordedBy ?? 'guildhall-cli',
    ...(input.recordedAt ? { recordedAt: input.recordedAt } : {}),
  })
}

async function cmdReviewCalibration() {
  const pos = positionals()
  const subcommand = pos[0] ?? 'validate'
  if (!['validate', 'escaped-miss'].includes(subcommand)) {
    console.error('[guildhall] Usage: guildhall review-calibration <validate|escaped-miss> [id|path]')
    process.exit(1)
  }
  const idOrPath = pos[1]
  const entry = idOrPath ? findWorkspace(idOrPath) : null
  const projectPath = entry?.path ?? (idOrPath ? resolve(expandPath(idOrPath)) : process.cwd())
  if (subcommand === 'escaped-miss') {
    const taskId = getFlag('--task')
    const missedLane = getFlag('--lane')
    const humanFinding = getFlag('--finding')
    if (!taskId || !missedLane || !humanFinding) {
      console.error('[guildhall] Usage: guildhall review-calibration escaped-miss [id|path] --task <id> --lane <lane> --finding <text> [--action <action>] [--missed-by <recipe>]')
      process.exit(1)
    }
    const result = await recordEscapedReviewMiss({
      projectPath,
      taskId,
      missedLane,
      humanFinding,
      ...(getFlag('--action') ? { nextCalibrationAction: getFlag('--action') } : {}),
      ...(getFlag('--missed-by') ? { missedByRecipe: getFlag('--missed-by') } : {}),
      recordedBy: 'guildhall-cli',
    })
    console.log('[guildhall] Escaped review miss recorded.')
    console.log(`[guildhall] Task: ${result.payload.taskId}`)
    console.log(`[guildhall] Lane: ${result.payload.missedLane}`)
    console.log(`[guildhall] Next calibration action: ${result.payload.nextCalibrationAction}`)
    console.log(`[guildhall] Audit stream: ${result.ref.path}`)
    return
  }
  const casesDir = getFlag('--cases')
  const result = await validateReviewCalibrationCorpus({
    projectPath,
    ...(casesDir ? { casesDir } : {}),
    recordedBy: 'guildhall-cli',
  })

  console.log('[guildhall] Review calibration corpus validated.')
  console.log(`[guildhall] Cases: ${result.summary.caseCount}`)
  console.log(`[guildhall] Known findings: ${result.summary.knownFindingCount}`)
  console.log(`[guildhall] Negative controls: ${result.summary.negativeControlCount}`)
  console.log(`[guildhall] Recipes: ${result.summary.recipeIds.join(', ')}`)
  console.log(`[guildhall] Audit record: ${result.record.ref.path}`)
  if (result.summary.missingCaseIds.length > 0) {
    console.error(`[guildhall] Missing calibration cases: ${result.summary.missingCaseIds.join(', ')}`)
    process.exitCode = 1
  }
}

function createSemanticIndexer(projectPath: string): CorpusSemanticIndexer {
  const providers = readGlobalProviders().providers
  const openai = providers['openai-api']
  if (!openai?.apiKey) {
    throw new Error('Semantic Corpus Map refresh requires an OpenAI-compatible provider key in ~/.guildhall/providers.yaml.')
  }
  const global = readGlobalConfig()
  const openAiModels = resolveModelsForProvider(global.models, 'openai-api')
  const modelId =
    openAiModels.contextIndexer ??
    'zai-org/GLM-4.6'
  const repairModelId = 'deepseek-ai/DeepSeek-V4-Flash'
  const client = new OpenAICompatibleClient({
    baseUrl: openai.baseUrl || 'https://api.openai.com/v1',
    apiKey: openai.apiKey,
    requestTimeoutMs: 180_000,
  })
  return {
    modelId,
    async completeJson({ prompt }) {
      const maxTokens = semanticCompletionBudget(prompt)
      console.log(`[guildhall] Semantic Corpus Map: ${modelId} with up to ${maxTokens} completion tokens.`)
      const text = await completeOpenAiCompatibleJson(client, {
        modelId,
        systemPrompt: 'You produce compact, valid JSON for codebase/documentation orientation. Do not include markdown.',
        prompt,
        maxTokens,
      })
      if (text.trim().length === 0) {
        throw new Error(`Context indexer model ${modelId} returned no text for ${projectPath}.`)
      }
      return text
    },
    async repairJson({ raw, error, schemaHint, map }) {
      const mapPrompt = buildSemanticIndexPrompt(map)
      const maxTokens = semanticRepairCompletionBudget(mapPrompt, raw)
      console.log(`[guildhall] Semantic Corpus Map repair: ${repairModelId} with up to ${maxTokens} completion tokens.`)
      return completeOpenAiCompatibleJson(client, {
        modelId: repairModelId,
        systemPrompt: 'You repair malformed or schema-invalid JSON. Return only valid JSON. Preserve substance; fix syntax and schema shape.',
        prompt: [
          'Repair this context-indexer response.',
          '',
          'Error:',
          error,
          '',
          schemaHint,
          '',
          'Raw response:',
          raw,
          '',
          'Corpus Map context:',
          mapPrompt,
        ].join('\n'),
        maxTokens,
      })
    },
  }
}

export function semanticCompletionBudget(prompt: string): number {
  const promptTokens = estimateTokenCount(prompt)
  return clampTokenBudget(
    SEMANTIC_COMPLETION_MIN_TOKENS + Math.ceil(promptTokens * 0.5),
    SEMANTIC_COMPLETION_MIN_TOKENS,
    SEMANTIC_COMPLETION_MAX_TOKENS,
  )
}

export function semanticRepairCompletionBudget(prompt: string, rawOutput: string): number {
  const promptTokens = estimateTokenCount(prompt)
  const rawTokens = estimateTokenCount(rawOutput)
  return clampTokenBudget(
    SEMANTIC_REPAIR_MIN_TOKENS + Math.ceil((promptTokens + rawTokens) * 0.5),
    SEMANTIC_REPAIR_MIN_TOKENS,
    SEMANTIC_REPAIR_MAX_TOKENS,
  )
}

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN)
}

function clampTokenBudget(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

async function completeOpenAiCompatibleJson(
  client: OpenAICompatibleClient,
  input: {
    modelId: string
    systemPrompt: string
    prompt: string
    maxTokens: number
  },
): Promise<string> {
  let text = ''
  for await (const event of client.streamMessage({
    model: input.modelId,
    system_prompt: input.systemPrompt,
    messages: [{ role: 'user', content: [{ type: 'text', text: input.prompt }] }],
    max_tokens: input.maxTokens,
    temperature: 0,
    tools: [],
  })) {
    if (event.type === 'text_delta') text += event.text
  }
  return text
}

export function writeModelBakeoffReport(outputPath: string, opts: {
  contextIndexer?: boolean
} = {}): {
  jsonPath: string
  markdownPath: string
} {
  const jsonPath = resolve(expandPath(outputPath))
  const markdownPath = /\.json$/i.test(jsonPath)
    ? jsonPath.replace(/\.json$/i, '.md')
    : `${jsonPath}.md`
  const report = opts.contextIndexer ? runContextIndexerBakeoff() : runModelBakeoff()

  mkdirSync(dirname(jsonPath), { recursive: true })
  mkdirSync(dirname(markdownPath), { recursive: true })
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  writeFileSync(markdownPath, renderBakeoffMarkdown(report), 'utf8')

  return { jsonPath, markdownPath }
}

function cmdModelBakeoff() {
  const pos = positionals()
  const contextIndexer = args.includes('--context-indexer')
  const { jsonPath, markdownPath } = writeModelBakeoffReport(
    pos[0] ?? (
      contextIndexer
        ? 'artifacts/model-bakeoff/context-indexer-report.json'
        : 'artifacts/model-bakeoff/model-bakeoff-report.json'
    ),
    { contextIndexer },
  )
  console.log(`[guildhall] Model bakeoff report: ${jsonPath}`)
  console.log(`[guildhall] Model bakeoff summary: ${markdownPath}`)
}

async function cmdMcp() {
  const pos = positionals()
  const subcommand = pos[0] ?? 'serve'
  if (subcommand !== 'serve') {
    console.error('[guildhall] Usage: guildhall mcp serve [project-path]')
    process.exit(1)
  }
  const projectPath = pos[1] ? resolve(expandPath(pos[1])) : process.cwd()
  const { serveGuildhallMcpStdio } = await import('@guildhall/mcp-server')
  await serveGuildhallMcpStdio(projectPath)
}

async function cmdBridge() {
  const pos = positionals()
  const subcommand = pos[0] ?? 'install'
  if (subcommand !== 'install') {
    console.error('[guildhall] Usage: guildhall bridge install [--target codex|claude|all] [--yes|--no-configure-mcp] [id|path]')
    process.exit(1)
  }

  const projectArg = pos[1]
  const entry = projectArg ? findWorkspace(projectArg) : null
  const projectPath = entry?.path ?? (projectArg ? resolve(expandPath(projectArg)) : process.cwd())
  const targets = resolveBridgeTargets(getFlag('--target') ?? 'codex')
  for (const target of targets) {
    const result = installAgentBridgeInstructions({ projectPath, target })
    console.log(`[guildhall] ${target} agent bridge ${result.action}: ${result.filePath}`)
  }
  if (targets.includes('codex')) {
    await maybeConfigureCodexMcp()
  }
  if (targets.includes('claude')) {
    await maybeConfigureClaudeMcp(projectPath)
  }
}

function resolveBridgeTargets(target: string): AgentBridgeTarget[] {
  if (target === 'all') return ['codex', 'claude']
  if (target === 'codex' || target === 'claude') return [target]
  throw new Error(`Unsupported agent bridge target "${target}". Supported targets: codex, claude, all`)
}

async function maybeConfigureCodexMcp() {
  if (args.includes('--no-configure-mcp')) {
    console.log('[guildhall] Codex MCP configuration skipped.')
    return
  }

  let shouldConfigure = args.includes('--yes')
  if (!shouldConfigure) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.log('[guildhall] Codex MCP configuration not changed because this is not an interactive terminal.')
      console.log('[guildhall] Re-run with `--yes` to configure: codex mcp add guildhall -- guildhall mcp serve .')
      return
    }
    shouldConfigure = await confirm({
      message: 'Configure Codex MCP globally as `guildhall mcp serve .`?',
      default: true,
    })
  }

  if (!shouldConfigure) {
    console.log('[guildhall] Codex MCP configuration skipped.')
    return
  }

  const codex = configureCodexMcpBridge()
  console.log(`[guildhall] ${codex.message}`)
}

async function maybeConfigureClaudeMcp(projectPath: string) {
  if (args.includes('--no-configure-mcp')) {
    console.log('[guildhall] Claude MCP configuration skipped.')
    return
  }

  let shouldConfigure = args.includes('--yes')
  if (!shouldConfigure) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.log('[guildhall] Claude MCP configuration not changed because this is not an interactive terminal.')
      console.log('[guildhall] Re-run with `--yes` to configure project .mcp.json.')
      return
    }
    shouldConfigure = await confirm({
      message: 'Configure Claude project MCP in `.mcp.json`?',
      default: true,
    })
  }

  if (!shouldConfigure) {
    console.log('[guildhall] Claude MCP configuration skipped.')
    return
  }

  const claude = configureClaudeProjectMcpBridge({ projectPath })
  console.log(`[guildhall] ${claude.message}`)
}

async function main() {
  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp()
    return
  }

  switch (command) {
    case 'init':    return cmdInit()
    case 'register': return cmdRegister()
    case 'unregister': return cmdUnregister()
    case 'list':    return cmdList()
    case 'run':     return cmdRun()
    case 'serve':   return cmdServe()
    case 'start':   return cmdStart()
    case 'stop':    return cmdStop()
    case 'open':    return cmdOpen()
    case 'serve-internal': return cmdServeInternal()
    case 'config':  return cmdConfig()
    case 'corpus-map': return cmdCorpusMap()
    case 'memory': return cmdMemory()
    case 'migrate': return cmdMigrate()
    case 'review-calibration': return cmdReviewCalibration()
    case 'model-bakeoff': return cmdModelBakeoff()
    case 'mcp': return cmdMcp()
    case 'bridge': return cmdBridge()
    default:
      console.error(`[guildhall] Unknown command: ${command}`)
      console.error(`[guildhall] Run "guildhall help" for usage.`)
      process.exit(1)
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
const modulePath = fileURLToPath(import.meta.url)

if (invokedPath === modulePath) {
  main().catch(err => {
    console.error('[guildhall] Fatal error:', err)
    process.exit(1)
  })
}
