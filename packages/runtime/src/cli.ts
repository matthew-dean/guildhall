#!/usr/bin/env node
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { runOrchestrator } from './orchestrator.js'
import { resolveWorkspace, loadWorkspace } from './workspace-loader.js'
import { runInit } from './init.js'
import { runServe } from './serve.js'
import {
  createExploringTask,
  approveSpec,
  resumeExploring,
} from './intake.js'
import {
  createMetaIntakeTask,
  approveMetaIntake,
  workspaceNeedsMetaIntake,
} from './meta-intake.js'
import {
  listWorkspaces,
  findWorkspace,
  registerWorkspace,
  unregisterWorkspace,
  readWorkspaceConfig,
  slugify,
} from '@guildhall/config'
import { exec } from 'node:child_process'
import { platform } from 'node:os'

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

// ---------------------------------------------------------------------------
// Forge CLI
//
// Commands:
//   guildhall init [path]                — interactive wizard, creates guildhall.yaml + registers
//   guildhall register <path>           — register an existing workspace (must have guildhall.yaml)
//   forge unregister <id|path>      — remove a workspace from the registry
//   guildhall list                      — list all registered workspaces
//   guildhall run [id|path]             — run the orchestrator for a workspace
//     --domain <id>                 — only process tasks for one coordinator domain
//     --max-ticks <n>               — stop after N ticks (useful for testing)
//   guildhall serve                     — start the web dashboard (all workspaces)
//     --port <n>                    — override the dashboard port (default: 7842)
//   guildhall config [id|path]          — re-run the init wizard on an existing workspace
// ---------------------------------------------------------------------------

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
  const result: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === undefined) continue
    if (a.startsWith('--')) {
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        i++ // consume the value
      }
      continue
    }
    result.push(a)
  }
  return result
}

function printHelp() {
  console.log(`
Forge — multi-agent operating system for software projects

Usage:
  guildhall init [path]              Launch dashboard + browser-based setup wizard
    --port <n>                   Override dashboard port (default: 7842)
    --no-browser                 Don't open a browser window
    --no-serve                   Write guildhall.yaml only (requires --cli-wizard)
    --cli-wizard                 Legacy: run the terminal setup wizard instead
  guildhall register <path>          Register an existing workspace (must contain guildhall.yaml)
  forge unregister <id|path>     Remove a workspace from the registry
  guildhall list                     Show all registered workspaces

  guildhall run [id|path]            Run the orchestrator for a workspace
    --domain <id>                Filter to tasks in one coordinator domain
    --max-ticks <n>              Stop after N ticks (testing)

  guildhall serve                    Start the web dashboard for all workspaces
    --port <n>                   Override dashboard port (default: 7842)

  guildhall config [id|path]         Re-run the init wizard on an existing workspace

  guildhall intake <ask>             Create a new task in the exploring phase (FR-12)
    --workspace <id|path>        Target workspace (default: current directory)
    --domain <id>                Coordinator domain this task belongs to (required)
    --project <path>             Project path for the task (default: workspace path)
    --title <string>             Explicit title (default: derived from the ask)
    --task-id <id>               Override the generated task id

  guildhall approve-spec <task-id>   Approve an exploring task's spec → spec_review
    --workspace <id|path>        Target workspace
    --note <string>              Optional approval note to record

  guildhall resume <task-id>         Add a follow-up message to an exploring task
    --workspace <id|path>        Target workspace
    --message <string>           New user message to append to the transcript
    --resolve-escalation <id>    If set, resolve this escalation before resuming
    --resolution <string>        Resolution text (with --resolve-escalation)

  guildhall meta-intake              Bootstrap coordinators via meta-intake (FR-14)
    --workspace <id|path>        Target workspace (default: current directory)
    --force                      Seed the task even if coordinators already exist

  guildhall approve-meta-intake      Merge meta-intake draft into guildhall.yaml
    --workspace <id|path>        Target workspace

Options:
  --help, -h                     Show this help

Examples:
  guildhall init ~/projects/my-app
  guildhall run looma
  guildhall intake "add a ghost button variant" --workspace looma --domain looma
  guildhall approve-spec task-001 --workspace looma
  guildhall serve
`.trim())
}

async function cmdInit() {
  const pos = positionals()
  const targetDir = pos[0] ?? process.cwd()
  const absPath = resolve(expandPath(targetDir))
  const portArg = getFlag('--port')
  const port = portArg ? Number(portArg) : 7842
  const useCliWizard = process.argv.includes('--cli-wizard')
  const noOpen = process.argv.includes('--no-open') || process.argv.includes('--no-browser')
  const noServe = process.argv.includes('--no-serve')

  if (useCliWizard) {
    await runInit({ targetDir })
    if (noServe) return
  }

  // Default path: open the browser and let the web wizard do the rest.
  console.log(`[guildhall] Project directory: ${absPath}`)
  console.log(`[guildhall] Launching dashboard…`)
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
    console.error('[guildhall] Usage: forge unregister <id|path>')
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
  })
}

async function cmdServe() {
  const pos = positionals()
  const pathArg = pos[0]
  const portArg = getFlag('--port')
  const noOpen = process.argv.includes('--no-open')
  const projectPath = pathArg ? resolve(expandPath(pathArg)) : process.cwd()
  const opts: Parameters<typeof runServe>[0] = { projectPath }
  if (portArg) opts.port = Number(portArg)
  const port = opts.port ?? 7842
  await runServe(opts)
  if (!noOpen) setTimeout(() => openBrowser(`http://localhost:${port}`), 400)
}

function loadWorkspaceByFlagOrCwd(flag?: string) {
  const raw = flag ?? process.cwd()
  const entry = findWorkspace(raw)
  if (entry) return loadWorkspace(entry.path)
  return loadWorkspace(raw)
}

async function cmdIntake() {
  const pos = positionals()
  const ask = pos[0]
  const wsFlag = getFlag('--workspace')
  const domain = getFlag('--domain')
  const projectFlag = getFlag('--project')
  const title = getFlag('--title')
  const taskIdOverride = getFlag('--task-id')

  if (!ask) {
    console.error('[guildhall] Usage: guildhall intake "<fuzzy ask>" --domain <id>')
    process.exit(1)
  }
  if (!domain) {
    console.error('[guildhall] Missing --domain flag (the coordinator that owns this task)')
    process.exit(1)
  }

  let workspace
  try {
    workspace = loadWorkspaceByFlagOrCwd(wsFlag)
  } catch (err) {
    console.error(`[guildhall] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  try {
    const result = await createExploringTask({
      memoryDir: workspace.config.memoryDir,
      ask,
      domain,
      projectPath: projectFlag ? expandPath(projectFlag) : workspace.config.projectPath,
      ...(title ? { title } : {}),
      ...(taskIdOverride ? { taskId: taskIdOverride } : {}),
    })
    console.log(`[guildhall] ✓ Created task ${result.taskId} in exploring`)
    console.log(`[guildhall]   Transcript: ${result.transcriptPath}`)
    console.log(`[guildhall]   Run "guildhall run ${workspace.config.workspaceId}" to start the intake conversation.`)
  } catch (err) {
    console.error(`[guildhall] Intake failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

async function cmdApproveSpec() {
  const pos = positionals()
  const taskId = pos[0]
  const wsFlag = getFlag('--workspace')
  const note = getFlag('--note')

  if (!taskId) {
    console.error('[guildhall] Usage: guildhall approve-spec <task-id>')
    process.exit(1)
  }

  let workspace
  try {
    workspace = loadWorkspaceByFlagOrCwd(wsFlag)
  } catch (err) {
    console.error(`[guildhall] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  const result = await approveSpec({
    memoryDir: workspace.config.memoryDir,
    taskId,
    ...(note ? { approvalNote: note } : {}),
  })
  if (!result.success) {
    console.error(`[guildhall] Approval failed: ${result.error}`)
    process.exit(1)
  }
  console.log(`[guildhall] ✓ ${taskId} advanced to ${result.newStatus}`)
}

async function cmdResumeExploring() {
  const pos = positionals()
  const taskId = pos[0]
  const wsFlag = getFlag('--workspace')
  const message = getFlag('--message')
  const escalationId = getFlag('--resolve-escalation')
  const resolution = getFlag('--resolution')

  if (!taskId) {
    console.error('[guildhall] Usage: guildhall resume <task-id>')
    process.exit(1)
  }

  let workspace
  try {
    workspace = loadWorkspaceByFlagOrCwd(wsFlag)
  } catch (err) {
    console.error(`[guildhall] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  const result = await resumeExploring({
    memoryDir: workspace.config.memoryDir,
    taskId,
    ...(message ? { message } : {}),
    ...(escalationId ? { resolveEscalationId: escalationId } : {}),
    ...(resolution ? { resolution } : {}),
  })
  if (!result.success) {
    console.error(`[guildhall] Resume failed: ${result.error}`)
    process.exit(1)
  }
  console.log(`[guildhall] ✓ Task ${taskId} resumed. Run "guildhall run" to continue the intake.`)
}

async function cmdMetaIntake() {
  const wsFlag = getFlag('--workspace')
  const force = args.includes('--force')

  let workspace
  try {
    workspace = loadWorkspaceByFlagOrCwd(wsFlag)
  } catch (err) {
    console.error(`[guildhall] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  if (!force && !workspaceNeedsMetaIntake(workspace.config.workspacePath)) {
    console.log('[guildhall] Workspace already has coordinators. Re-run with --force to seed anyway.')
    return
  }

  try {
    const result = await createMetaIntakeTask({
      memoryDir: workspace.config.memoryDir,
      projectPath: workspace.config.projectPath,
    })
    if (result.alreadyExists) {
      console.log(`[guildhall] Meta-intake task already exists: ${result.taskId}`)
    } else {
      console.log(`[guildhall] ✓ Seeded meta-intake task: ${result.taskId}`)
    }
    console.log(`[guildhall]   Transcript: ${result.transcriptPath}`)
    console.log(`[guildhall]   Run "guildhall run ${workspace.config.workspaceId}" to start the interview.`)
    console.log(`[guildhall]   After approval, run "guildhall approve-meta-intake" to write guildhall.yaml.`)
  } catch (err) {
    console.error(`[guildhall] Meta-intake failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}

async function cmdApproveMetaIntake() {
  const wsFlag = getFlag('--workspace')

  let workspace
  try {
    workspace = loadWorkspaceByFlagOrCwd(wsFlag)
  } catch (err) {
    console.error(`[guildhall] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  const result = await approveMetaIntake({
    workspacePath: workspace.config.workspacePath,
    memoryDir: workspace.config.memoryDir,
  })
  if (!result.success) {
    console.error(`[guildhall] Meta-intake approval failed: ${result.error}`)
    process.exit(1)
  }
  console.log(`[guildhall] ✓ Meta-intake approved. Added ${result.coordinatorsAdded ?? 0} coordinator(s) to guildhall.yaml.`)
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
    case 'config':  return cmdConfig()
    case 'intake':  return cmdIntake()
    case 'approve-spec': return cmdApproveSpec()
    case 'resume':  return cmdResumeExploring()
    case 'meta-intake': return cmdMetaIntake()
    case 'approve-meta-intake': return cmdApproveMetaIntake()
    default:
      console.error(`[guildhall] Unknown command: ${command}`)
      console.error(`[guildhall] Run "forge help" for usage.`)
      process.exit(1)
  }
}

main().catch(err => {
  console.error('[guildhall] Fatal error:', err)
  process.exit(1)
})
