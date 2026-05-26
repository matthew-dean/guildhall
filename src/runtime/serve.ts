import { readFileSync, existsSync, mkdirSync, statSync, writeFileSync, readdirSync, type Dirent, promises as fsp } from 'node:fs'
import { dirname, join, resolve, basename, relative, isAbsolute, sep as pathSeparator, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import { atomicWriteText, getProjectStateDir, getProjectTranscriptPath } from '@guildhall/sessions'
import { readTaskWorkspaceStore } from './task-state-store.js'
import {
  readWorkspaceConfig,
  writeWorkspaceConfig,
  listWorkspaces,
  findWorkspace,
  registerWorkspace,
  updateWorkspace,
  unregisterWorkspace,
  bootstrapWorkspace,
  readProjectConfig,
  updateProjectConfig,
  readGlobalConfig,
  updateGlobalConfig,
  resolveConfig,
  FORGE_YAML_FILENAME,
  slugify,
  readGlobalProviders,
  setProvider,
  removeProvider,
  markProviderVerified,
  resolveGlobalCredentials,
  migrateProjectProvidersToGlobal,
  resolveModelsForProvider,
  mergeModels,
  type ProviderKind,
  type WorkspaceYamlConfig,
  writeModelsForProvider,
} from '@guildhall/config'
import {
  MODEL_CATALOG,
  MODEL_BEHAVIOR_PROFILES,
  type Checkpoint,
  DEFAULT_LOCAL_MODEL_ASSIGNMENT,
  DEFAULT_CLOUD_MODEL_ASSIGNMENT,
  type ModelAssignmentConfig,
  type ModelBehaviorProfile,
} from '@guildhall/core'
import {
  loadCodebaseMap,
  loadCodebaseMapStaleState,
  refreshCodebaseMap,
  type CodebaseMap,
} from '@guildhall/corpus-map'
import {
  loadLeverSettings,
  saveLeverSettings,
  defaultAgentSettingsPath,
  makeDefaultSettings,
  projectLeverInvariantError,
  PROJECT_LEVER_NAMES,
  DOMAIN_LEVER_NAMES,
  validateLeverSettings,
  type DomainLeverName,
  type ProjectLeverName,
} from '@guildhall/levers'
import {
  activeEscalations,
  latestResolvedRetryEscalationAt,
  readCheckpoint,
  readExploringTranscript,
  resolveEscalation,
  materializeRequiredSplitChildren,
  updateDesignSystem,
} from '@guildhall/tools'
import { DesignSystem, summarizeDesignSystem, TaskQueue, type DesignSystem as DesignSystemRecord, type Task } from '@guildhall/core'
import {
  loadProjectGuildRoster,
  selectApplicableGuilds,
  reviewersForTask,
  pickPrimaryEngineer,
} from '@guildhall/guilds'
import { OrchestratorSupervisor } from './serve-supervisor.js'
import { resolveFanoutCapacity } from './fanout-dispatcher.js'
import {
  normalizePreferredProvider,
  selectApiClient,
  type PreferredProviderKey,
  type ProviderName,
} from './provider-selection.js'
import {
  buildSelectApiClientOptions,
  getRuntimeProviderConfig,
  resolveLaneConcurrencyPlan,
} from './provider-runtime-config.js'
import {
  anthropicCompatiblePoolKey,
  openAiCompatiblePoolKey,
  providerClientHealth,
} from './provider-client-pool.js'
import {
  providerCapabilitiesForAnyKey,
  providerFamilyForAnyKey,
  providerLabelForAnyKey,
  providerLabelForSetupKey,
  SETUP_PROVIDER_ORDER,
} from './provider-metadata.js'
import {
  createExploringTask,
  createRoutedRequest,
  approveSpec,
  enrichTask,
  reframeTask,
  resumeExploring,
  rerunTaskStage,
  shapeImportDraft,
  createBugReportTask,
  parseStackTraceTopFile,
} from './intake.js'
import {
  answerPressureTestQuestion,
  createPressureTestIntake,
  loadPressureTestIntake,
  listPressureTestIntakes,
  summarizeProjectCheckIn,
} from './pressure-test-intake.js'
import { loadDesignSystem, saveDesignSystem } from './design-system-store.js'
import {
  approveMetaIntake,
  createMetaIntakeTask,
  META_INTAKE_TASK_ID,
  parseCoordinatorDraft,
  rerunMetaIntakeTask,
  synthesizeMetaIntakeDraft,
  workspaceNeedsMetaIntake,
} from './meta-intake.js'
import {
  readBootstrapStatus,
  bootstrapNeeded,
  runBootstrap,
} from './bootstrap-runner.js'
import {
  runBootstrap as runDetectedBootstrap,
  writeBootstrapResult,
} from './bootstrap.js'
import {
  maybeSeedWorkspaceImport,
  approveWorkspaceImport,
  createWorkspaceImportTask,
  parseWorkspaceImport,
  rerunWorkspaceImportTask,
  workspaceNeedsImport,
  WORKSPACE_IMPORT_TASK_ID,
  formatDetectedDraftAsSpec,
} from './workspace-importer.js'
import {
  detectWorkspaceSignals,
  formWorkspaceHypothesis,
} from './workspace-import/index.js'
import { buildWorkspaceImportReview, filterWorkspaceImportDraft } from './workspace-import/review.js'
import {
  acceptSuggestedLearning,
  buildLearningSnapshot,
  dismissSuggestedLearning,
  makeSuggestedLearningProjectWide,
  recordWorkspaceImportApproval,
  recordWorkspaceImportDismissal,
  resetGlobalLearning,
  resetProjectLearning,
  resetSuggestedLearnings,
} from './learning.js'
import {
  activateProjectSkillProposal,
  dismissProjectSkillProposal,
  readProjectSkillProposals,
  resetProjectSkillProposals,
} from '@guildhall/skills'
import { normalizeImportedDraftTask } from './import-drafts.js'
import { buildInbox, buildInboxBlockers, detectRepoAnchors } from './inbox.js'
import {
  buildProjectMigrationAdvisories,
  buildProjectUnderstandingAdvisories,
  markAttentionDismissed,
  reconcileAttentionRecords,
  recordReconciliationResolved,
} from './attention.js'
import { projectRuntimeCompatibilityBlocker } from './runtime-compatibility.js'
import { buildThread } from './thread.js'
import { NodeGitDriver } from './git-driver.js'
import {
  inspectGitStory,
  summarizeGitStories,
  type GitStorySummary,
} from './git-story.js'
import {
  effectiveGitStoryPolicy,
  resolveWorkspaceProjectPaths,
} from './git-story-policy.js'
import { taskHasUnansweredVisibleQuestion } from './question-visibility.js'
import { repairStaleBlockersForProject } from './stale-blocker-repair.js'
import {
  buildCoordinatorProjectPathMap,
  resolveTaskProjectPath,
} from './task-project-path.js'
import { buildEffectiveTask } from './effective-task.js'
import { buildDoneTaskSummaryBundle } from './done-task-summary.js'
import { readContextDebugForTask } from './context-observability.js'
import { createReviewAuditStore } from './review-audit-store.js'
import { userFacingText } from './user-facing-text.js'
import { FileBackedGuildhallPersistence } from '@guildhall/persistence'
import {
  buildSnapshot,
  listWizards,
  progressFor,
  readWizardsState,
  emptyWizardsState,
  buildTaskSnapshot,
  listTaskWizards,
  progressForTask,
  type WizardsState,
} from './wizards.js'
import { applyProjectMigrations, getProjectMigrationStatus } from './migrations.js'
import { stringify as stringifyYaml } from 'yaml'

// ---------------------------------------------------------------------------
// guildhall serve — local service over many projects
//
// `guildhall serve` now acts like the friendly entrypoint to a local
// user-level service. The backend knows about many registered projects; project
// APIs are scoped by explicit project id instead of mutable daemon foreground.
//
// Routes:
//   GET    /api/service               → service metadata + registered projects
//   GET    /                          → SPA (root = project detail or setup)
//   GET    /setup                     → SPA setup wizard route
//   GET    /api/project               → project detail (config + tasks + run state)
//   POST   /api/project/start         → boot the orchestrator for this project
//   POST   /api/project/stop          → graceful stop
//   POST   /api/project/intake        → create an exploring task
//   POST   /api/project/meta-intake   → create the bootstrap task
//   GET    /api/project/meta-intake/draft → current task spec + parsed coordinator draft preview
//   POST   /api/project/meta-intake/approve → merge the draft into guildhall.yaml
//   GET    /api/project/needs-meta-intake
//   GET    /api/project/bootstrap/status   → last run + whether it needs re-running
//   POST   /api/project/bootstrap/run      → run the verified bootstrap synchronously
//   GET    /api/project/task/:id      → full task + recent events for drawer
//   POST   /api/project/task/:id/hold               → human hold → blocked
//   POST   /api/project/task/:id/resume-hold        → blocked hold → previous stage
//   POST   /api/project/task/:id/pause              → deprecated alias for hold
//   POST   /api/project/task/:id/shelve             → human override → shelved
//   POST   /api/project/task/:id/unshelve           → shelved → proposed (clear shelveReason)
//   POST   /api/project/task/:id/approve-spec       → spec_review → ready
//   POST   /api/project/task/:id/approve-brief      → mark the product brief as human-approved
//   POST   /api/project/task/:id/mark-done          → human confirms task is already complete
//   POST   /api/project/task/:id/resume             → append follow-up to exploring transcript
//   POST   /api/project/task/:id/resolve-escalation → close an open escalation; unblocks when none remain
//   GET    /api/project/activity      → summary for persistent agent chip
//   GET    /api/project/progress      → tail of memory/PROGRESS.md
//   GET    /api/project/events        → SSE feed of orchestrator events
//   GET    /api/health                → running package/git/build identity
//   GET    /api/config                → project-local config (secrets redacted)
//   GET    /api/config/levers         → lever positions for Settings UI
//   GET    /api/project/design-system → current design system (or null)
//   POST   /api/project/design-system → author/revise the design system
//   POST   /api/project/design-system/approve → mark current DS as human-approved
//   GET    /api/project/release-readiness → aggregated release-readiness readout
//   GET    /api/setup/providers       → detect installed providers
//   POST   /api/setup/providers/config → save chosen provider/API key
// ---------------------------------------------------------------------------

export interface ServeOptions {
  port?: number
  /** Legacy alias; prefer preferredProjectPath for new callers. */
  projectPath?: string
  /** Optional one-shot initial project selection hint for a fresh service. */
  preferredProjectPath?: string
  /** Optional path to the service-state file written by background runs. */
  serviceStatePath?: string
  /** Optional folder picker override for tests or alternate shells. */
  pickProjectFolder?: () => Promise<string | null>
}

export interface ShutdownHttpServer {
  close(callback?: (err?: Error) => void): unknown
  closeIdleConnections?: () => void
  closeAllConnections?: () => void
}

export async function closeHttpServerForShutdown(
  server: ShutdownHttpServer,
  opts: { forceCloseAfterMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const forceCloseAfterMs = opts.forceCloseAfterMs ?? 250
  const timeoutMs = opts.timeoutMs ?? 3000

  await new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(forceTimer)
      clearTimeout(timeoutTimer)
      resolve()
    }

    const forceTimer = setTimeout(() => {
      server.closeAllConnections?.()
    }, forceCloseAfterMs)
    forceTimer.unref?.()

    const timeoutTimer = setTimeout(finish, timeoutMs)
    timeoutTimer.unref?.()

    try {
      server.close(() => finish())
      server.closeIdleConnections?.()
    } catch {
      finish()
    }
  })
}

interface ResolvedProject {
  path: string
  id: string
  /** Null if guildhall.yaml is missing — wizard handles this case. */
  config: ReturnType<typeof readWorkspaceConfig> | null
  initializationNeeded: boolean
}

interface ServiceProjectSummary {
  id: string
  path: string
  name: string
  initializationNeeded: boolean
  tags?: string[]
  summary?: string | null
  taskCounts?: {
    total: number
    active: number
    draftReview: number
    blocked: number
    done: number
    shelved: number
  }
  highlights?: {
    activeTaskTitle?: string | null
    blockedTaskTitle?: string | null
    recentCompletedTaskTitle?: string | null
  }
  taskActivity?: {
    windowLabel: string
    max: number
    bars: Array<{
      value: number
      label: string
    }>
  }
  run?: {
    status?: string
    startedAt?: string
    stoppedAt?: string
    error?: string
    stopSummary?: unknown
    providerStatus?: unknown
  }
  gitStory?: GitStorySummary
  providerStatus?: unknown
  migrationSummary?: {
    pending: number
    blocked: number
    applied: number
    error?: string
  }
  projectCheckIn?: ReturnType<typeof summarizeProjectCheckIn> | null
}

function humanizeGeneratedProjectName(name: string): string {
  const raw = name.trim()
  if (!raw) return 'Project'
  const withoutScope = raw.startsWith('@') && raw.includes('/')
    ? raw.split('/').slice(1).join('/')
    : raw
  const collapsed = withoutScope
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!collapsed) return 'Project'
  return collapsed.charAt(0).toUpperCase() + collapsed.slice(1)
}

function detectProjectPackageManagers(projectPath: string): string[] {
  const found = new Set<string>()
  const visited = new Set<string>()
  const skipDirs = new Set([
    '.git',
    'node_modules',
    '.next',
    '.nuxt',
    'dist',
    'build',
    'coverage',
    '.svelte-kit',
    '.turbo',
    '.yarn',
    'bin',
    'obj',
  ])

  const visit = (dir: string, depth: number): void => {
    if (depth > 3 || visited.has(dir)) return
    visited.add(dir)
    let entries: Array<Dirent>
    try {
      entries = readDirents(dir)
    } catch {
      return
    }

    const names = new Set(entries.map(entry => entry.name))
    if (names.has('pnpm-lock.yaml')) found.add('pnpm')
    if (names.has('yarn.lock')) found.add('yarn')
    if (names.has('package-lock.json')) found.add('npm')
    if (names.has('bun.lockb')) found.add('bun')
    if (names.has('uv.lock')) found.add('uv')
    if (names.has('poetry.lock')) found.add('poetry')
    if (names.has('requirements.txt')) found.add('pip')
    if (names.has('Directory.Packages.props') || names.has('packages.lock.json')) found.add('NuGet')
    if (entries.some(entry => entry.isFile() && (entry.name.endsWith('.csproj') || entry.name.endsWith('.sln')))) {
      found.add('NuGet')
    }

    if (names.has('package.json')) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { packageManager?: string }
        const pm = pkg.packageManager?.split('@')[0]
        if (pm === 'pnpm' || pm === 'yarn' || pm === 'npm' || pm === 'bun') found.add(pm)
      } catch {
        // ignore invalid package.json here; Facts should stay best-effort
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (skipDirs.has(entry.name)) continue
      visit(join(dir, entry.name), depth + 1)
    }
  }

  visit(projectPath, 0)
  return found.size > 0 ? [...found] : ['unknown']
}

async function resolveSourceNoteCandidate(projectRoot: string, requested: string): Promise<{ candidate: string; requestedRel: string }> {
  const candidate = requested.startsWith('/')
    ? resolve(requested)
    : resolve(projectRoot, requested)
  const requestedRel = relative(projectRoot, candidate)
  let stat = await fsp.stat(candidate).catch((err: unknown) => {
    if ((err as { code?: string })?.code === 'ENOENT') return null
    throw err
  })
  if (stat) return { candidate, requestedRel }

  // Imported source references can go stale when a project is rearranged. If a
  // path was moved by dropping a leading folder, recover the nearest existing
  // suffix inside the same project instead of dead-ending the Thread card.
  const parts = requestedRel.split(/[\\/]+/).filter(Boolean)
  for (let start = 1; start < parts.length; start += 1) {
    const suffixCandidate = resolve(projectRoot, parts.slice(start).join(pathSeparator))
    const suffixRel = relative(projectRoot, suffixCandidate)
    if (suffixRel === '..' || suffixRel.startsWith(`..${pathSeparator}`) || isAbsolute(suffixRel)) continue
    stat = await fsp.stat(suffixCandidate).catch((err: unknown) => {
      if ((err as { code?: string })?.code === 'ENOENT') return null
      throw err
    })
    if (stat) return { candidate: suffixCandidate, requestedRel }
  }

  return { candidate, requestedRel }
}

async function directorySourcePreview(dir: string, projectRoot: string, requestedRel: string): Promise<{ content: string; truncated: boolean }> {
  const maxEntries = 80
  const maxDepth = 2
  const lines: string[] = []
  let count = 0
  let truncated = false

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth || count >= maxEntries) {
      truncated = true
      return
    }
    let entries: Dirent[]
    try {
      entries = await fsp.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    entries = entries
      .filter(entry => !['.git', '.guildhall', 'node_modules'].includes(entry.name))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    for (const entry of entries) {
      if (count >= maxEntries) {
        truncated = true
        return
      }
      const next = join(current, entry.name)
      const suffix = entry.isDirectory() ? '/' : ''
      lines.push(`${'  '.repeat(depth + 1)}- ${entry.name}${suffix}`)
      count += 1
      if (entry.isDirectory()) await walk(next, depth + 1)
    }
  }

  const displayPath = relative(projectRoot, dir) || basename(dir)
  lines.push(`${displayPath}/`)
  await walk(dir, 0)
  if (truncated) lines.push(`  - ...`)
  const movedNote = requestedRel && requestedRel !== displayPath
    ? `\n\nRequested path: \`${requestedRel}\`\nResolved current path: \`${displayPath}\``
    : ''
  return {
    content: [
      `# Directory: ${displayPath}`,
      '',
      'This source reference points to a folder. Showing the folder tree so you can inspect the files Guildhall meant to cite.',
      movedNote.trim(),
      '',
      '```text',
      ...lines,
      '```',
    ].filter(Boolean).join('\n'),
    truncated,
  }
}

async function missingSourcePreview(candidate: string, projectRoot: string, requestedRel: string): Promise<{ content: string; truncated: boolean }> {
  const parent = dirname(candidate)
  const parentRel = relative(projectRoot, parent)
  const nearby: string[] = []
  if (parentRel !== '..' && !parentRel.startsWith(`..${pathSeparator}`) && !isAbsolute(parentRel)) {
    const entries = await fsp.readdir(parent, { withFileTypes: true }).catch(() => [])
    for (const entry of entries
      .filter(item => !['.git', '.guildhall', 'node_modules'].includes(item.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 20)) {
      nearby.push(`${entry.name}${entry.isDirectory() ? '/' : ''}`)
    }
  }
  const content = [
    `# Source not found: ${basename(candidate)}`,
    '',
    'Guildhall recorded this source reference, but the file or folder is not present at that path anymore.',
    '',
    `Requested path: \`${requestedRel || basename(candidate)}\``,
    nearby.length > 0 ? `\nNearby files in \`${parentRel || '.'}\`:\n${nearby.map(item => `- ${item}`).join('\n')}` : '',
    '',
    'This usually means the project moved or renamed the source after the task was imported. Add a note or update the task brief with the current source if this reference matters.',
  ].filter(Boolean).join('\n')
  return { content, truncated: false }
}

function markdownForFile(raw: string, displayPath: string): string {
  const ext = extname(displayPath).toLowerCase()
  if (['.md', '.markdown', '.mdx'].includes(ext)) return raw
  const langByExt: Record<string, string> = {
    '.cjs': 'js',
    '.css': 'css',
    '.html': 'html',
    '.js': 'js',
    '.json': 'json',
    '.jsx': 'jsx',
    '.mjs': 'js',
    '.sql': 'sql',
    '.svelte': 'svelte',
    '.ts': 'ts',
    '.tsx': 'tsx',
    '.vue': 'vue',
    '.yaml': 'yaml',
    '.yml': 'yaml',
  }
  const lang = langByExt[ext] ?? ''
  const safe = raw.replaceAll('```', '``\\`')
  return [`# File: ${displayPath}`, '', `\`\`\`${lang}`, safe, '```'].join('\n')
}

function readDirents(dir: string): Array<Dirent> {
  return readdirSync(dir, { withFileTypes: true })
}

const execFileP = promisify(execFile)

function isReviewOwnershipMismatch(task: Record<string, unknown>): boolean {
  const handoffSequence = Array.isArray(task.handoffSequence) ? task.handoffSequence : []
  const handoffStep =
    typeof task.handoffStep === 'number' && Number.isFinite(task.handoffStep)
      ? task.handoffStep
      : 0
  const hasPendingHandoffStep = handoffSequence.length > 0 && handoffStep + 1 < handoffSequence.length
  return (
    task.status === 'review' &&
    task.assignedTo !== 'reviewer-agent' &&
    !hasPendingHandoffStep
  )
}

function isWorkerOwnershipMismatch(task: Record<string, unknown>): boolean {
  return task.status === 'in_progress' && task.assignedTo !== 'worker-agent'
}

function isGateCheckOwnershipMismatch(task: Record<string, unknown>): boolean {
  return task.status === 'gate_check' && task.assignedTo !== 'gate-checker-agent'
}

function isSpecReviewOwnershipMismatch(task: Record<string, unknown>): boolean {
  return task.status === 'spec_review' && task.assignedTo != null
}

function isTerminalOwnershipMismatch(task: Record<string, unknown>): boolean {
  return (
    (task.status === 'done' || task.status === 'blocked' || task.status === 'shelved') &&
    task.assignedTo != null
  )
}

  async function readTasksFileNormalized(
  tasksPath: string,
): Promise<Array<Record<string, unknown>>> {
  if (!existsSync(tasksPath)) return []
  const rawText = await fsp.readFile(tasksPath, 'utf8')
  const parsed = JSON.parse(rawText) as
    | { tasks?: Array<Record<string, unknown>>; version?: unknown; lastUpdated?: unknown }
    | Array<Record<string, unknown>>
  const tasks = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tasks) ? parsed.tasks : []
  let changed = false
  for (const task of tasks) {
    if (normalizeImportedDraftTask(task as never)) {
      if (typeof task.updatedAt !== 'string' || task.updatedAt.trim().length === 0) {
        task.updatedAt = new Date().toISOString()
      }
      changed = true
    }
    if (isWorkerOwnershipMismatch(task)) {
      task.assignedTo = 'worker-agent'
      if (typeof task.updatedAt !== 'string' || task.updatedAt.trim().length === 0) {
        task.updatedAt = new Date().toISOString()
      }
      changed = true
    } else if (isReviewOwnershipMismatch(task)) {
      task.assignedTo = 'reviewer-agent'
      if (typeof task.updatedAt !== 'string' || task.updatedAt.trim().length === 0) {
        task.updatedAt = new Date().toISOString()
      }
      changed = true
    } else if (isGateCheckOwnershipMismatch(task)) {
      task.assignedTo = 'gate-checker-agent'
      if (typeof task.updatedAt !== 'string' || task.updatedAt.trim().length === 0) {
        task.updatedAt = new Date().toISOString()
      }
      changed = true
    } else if (isSpecReviewOwnershipMismatch(task)) {
      task.assignedTo = null
      if (typeof task.updatedAt !== 'string' || task.updatedAt.trim().length === 0) {
        task.updatedAt = new Date().toISOString()
      }
      changed = true
    } else if (isTerminalOwnershipMismatch(task)) {
      task.assignedTo = null
      if (typeof task.updatedAt !== 'string' || task.updatedAt.trim().length === 0) {
        task.updatedAt = new Date().toISOString()
      }
      changed = true
    }
  }
  if (!changed) return tasks

  const rewritten = Array.isArray(parsed)
    ? tasks
    : {
        ...parsed,
        tasks,
        lastUpdated: new Date().toISOString(),
      }
  await atomicWriteText(tasksPath, JSON.stringify(rewritten, null, 2))
  return tasks
}

async function buildProjectInboxSnapshot(input: {
  projectPath: string
  initializationNeeded: boolean
  coordinatorCount: number
}) {
  if (input.initializationNeeded) {
    return { items: [], blockers: { bootstrap: false, workspaceImport: false } }
  }
  // Self-healing scan: if the workspace has signals but nobody has run
  // the scanner yet, kick it off implicitly. The user shouldn't have to
  // press "Scan" — once a coordinator exists, the agent discovers
  // existing goals/tasks on its own and surfaces them for review.
  // No-op if already seeded, off, or not needed.
  try {
    const memoryDir = getProjectStateDir(input.projectPath)
    const goalsPath = join(memoryDir, 'workspace-goals.json')
    if (!existsSync(goalsPath) && input.coordinatorCount > 0) {
      await maybeSeedWorkspaceImport({ memoryDir, projectPath: input.projectPath })
    }
  } catch {
    /* never let self-healing break an inbox read */
  }
  try {
    repairStaleBlockersForProject(input.projectPath)
  } catch {
    /* never let stale-blocker repair break an inbox read */
  }
  const runtimeBlocker = projectRuntimeCompatibilityBlocker({ projectRoot: input.projectPath })
  if (runtimeBlocker) {
    return {
      items: [{
        id: 'runtime:too-old',
        kind: 'project_understanding' as const,
        severity: 'high' as const,
        title: 'Upgrade Guildhall before changing this project',
        detail: runtimeBlocker.message,
        signals: ['runtime_compatibility'],
        actionHref: runtimeBlocker.actionHref,
        dismissEndpoint: '',
        status: 'open' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
      history: [],
      blockers: { bootstrap: false, workspaceImport: false },
    }
  }
  const computedItems = [
    ...await buildProjectMigrationAdvisories(input.projectPath),
    ...buildProjectUnderstandingAdvisories(input.projectPath),
    ...buildInbox({ projectPath: input.projectPath }),
  ]
  const attention = reconcileAttentionRecords({
    projectPath: input.projectPath,
    openItems: computedItems,
  })
  const blockers = buildInboxBlockers(attention.openItems)
  return { items: attention.openItems, history: attention.history, blockers }
}

// ---------------------------------------------------------------------------
// Wizards helpers — small shims so serve.ts doesn't have to know about the
// on-disk layout of memory/wizards.yaml.
// ---------------------------------------------------------------------------
function writeWizardsState(projectPath: string, state: WizardsState): void {
  const memDir = getProjectStateDir(projectPath)
  if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true })
  const path = join(memDir, 'wizards.yaml')
  writeFileSync(path, stringifyYaml(state), 'utf8')
}

function mutateSkip(
  state: WizardsState,
  wizardId: string,
  stepId: string,
  mode: 'add' | 'remove',
): WizardsState {
  const prev = state.skipped[wizardId] ?? []
  const set = new Set(prev)
  if (mode === 'add') set.add(stepId)
  else set.delete(stepId)
  return {
    ...state,
    skipped: { ...state.skipped, [wizardId]: Array.from(set) },
  }
}

// Exported for tests — runtime doesn't need it directly but the test
// module benefits from sharing the same writer as the endpoint.
export { writeWizardsState as _writeWizardsState, mutateSkip as _mutateSkip }

/**
 * Map short archetype ids to coordinator config seeds. Deliberately minimal —
 * the intent is "start somewhere real" not "nail the full mandate/concerns
 * shape" (which is what meta-intake is for). The user can refine later from
 * Settings → Coordinators.
 */
function archetypesToCoordinators(archetypes: string[]): Array<{
  id: string
  domain: string
  mandate: string
  concerns: Array<{ id: string; description: string; reviewQuestions: string[] }>
}> {
  const seeds: Record<string, ReturnType<typeof archetypesToCoordinators>[number]> = {
    product: {
      id: 'product',
      domain: 'product',
      mandate:
        'Owns user-facing behavior, product brief coherence, and whether a task is doing the right thing for users before we ask whether it is done correctly.',
      concerns: [
        {
          id: 'user-value',
          description: 'Every shipped change should be traceable to a stated user need.',
          reviewQuestions: [
            'Which user need does this change serve?',
            'What does "done" look like from the user\'s perspective?',
          ],
        },
      ],
    },
    tech: {
      id: 'tech',
      domain: 'tech',
      mandate:
        'Owns implementation quality, architectural coherence, and making sure the codebase stays maintainable as tasks land.',
      concerns: [
        {
          id: 'maintainability',
          description: 'Changes should preserve or improve long-term code health.',
          reviewQuestions: [
            'Does this change introduce accidental complexity?',
            'Are there abstractions being invented where simpler code would do?',
          ],
        },
      ],
    },
    qa: {
      id: 'qa',
      domain: 'qa',
      mandate:
        'Owns verification: tests, gates, and making sure we know a change works before it merges.',
      concerns: [
        {
          id: 'test-coverage',
          description: 'Behavior changes should come with verifiable tests.',
          reviewQuestions: [
            'Is this change covered by a test that would fail if the behavior regressed?',
            'Are the gates (typecheck, build, test) still green?',
          ],
        },
      ],
    },
  }
  const result: Array<ReturnType<typeof archetypesToCoordinators>[number]> = []
  for (const a of archetypes) {
    const seed = seeds[a]
    if (seed) result.push(seed)
  }
  return result
}

function resolveProject(projectPath: string): ResolvedProject {
  const yamlPath = join(projectPath, FORGE_YAML_FILENAME)
  if (!existsSync(yamlPath)) {
    // Fall back to directory name as an id; wizard will fix up later.
    const id = slugify(projectPath.split('/').pop() ?? 'project')
    return { path: projectPath, id, config: null, initializationNeeded: true }
  }
  const config = readWorkspaceConfig(projectPath)
  const id = config.id ?? slugify(config.name)
  return { path: projectPath, id, config, initializationNeeded: false }
}

function summarizeProject(project: ResolvedProject): ServiceProjectSummary {
  return {
    id: project.id,
    path: project.path,
    name: project.config?.name ?? project.id,
    initializationNeeded: project.initializationNeeded,
    tags: project.config?.tags ?? [],
  }
}

async function summarizeProjectMigrations(projectPath: string): Promise<NonNullable<ServiceProjectSummary['migrationSummary']>> {
  try {
    const status = await getProjectMigrationStatus({ projectRoot: projectPath })
    return {
      pending: status.pending.length,
      blocked: status.blocked.length,
      applied: status.applied.length,
    }
  } catch (err) {
    return {
      pending: 0,
      blocked: 0,
      applied: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function startBlockerForRequiredMigrations(projectPath: string): Promise<{
  canStart: false
  code: 'required_migration_pending'
  message: string
  actionHref: string
} | null> {
  const status = await getProjectMigrationStatus({ projectRoot: projectPath })
  if (status.blocked.length === 0) return null
  const first = status.blocked[0]
  return {
    canStart: false,
    code: 'required_migration_pending',
    message: first
      ? `Run required Guildhall migration ${first.id} before starting this project.`
      : 'Run required Guildhall migrations before starting this project.',
    actionHref: '/migrations',
  }
}

type ReleaseDesignSystemSource = 'guildhall' | 'repo' | 'none'

interface ReleaseDesignSystemStatus {
  drafted: boolean
  approved: boolean
  revision: number
  source: ReleaseDesignSystemSource
  label: string
  reason?: string
}

function hasRepoDesignSystemSignals(config: WorkspaceYamlConfig | null, map: CodebaseMap | null | undefined): boolean {
  const componentFiles = map?.designSystem?.componentFiles?.length ?? 0
  const primitives = map?.designSystem?.primitives?.length ?? 0
  const tokenCounts = map?.designSystem?.tokenCounts
    ? Object.values(map.designSystem.tokenCounts).reduce((sum, count) => sum + count, 0)
    : 0
  if (componentFiles >= 3 || primitives > 0 || tokenCounts > 0) return true

  if (!config) return false
  const text = [
    config.name,
    config.kind,
    ...(config.tags ?? []),
    config.council?.mandate ?? '',
    ...(config.projects ?? []).flatMap(project => [
      project.id,
      project.label ?? '',
      project.type ?? '',
      project.path,
      project.coordinator ?? '',
    ]),
    ...(config.coordinators ?? []).flatMap(coordinator => [
      coordinator.id,
      coordinator.name ?? '',
      coordinator.domain,
      coordinator.path ?? '',
      coordinator.mandate,
    ]),
  ].join('\n').toLowerCase()

  return [
    'design system',
    'design-system',
    'component library',
    'component-library',
    'ui library',
    'ui-library',
  ].some(signal => text.includes(signal))
}

function releaseDesignSystemStatus(
  ds: DesignSystemRecord | undefined,
  config: WorkspaceYamlConfig | null,
  map: CodebaseMap | null | undefined,
): ReleaseDesignSystemStatus {
  if (ds) {
    const approved = Boolean(ds.approvedAt)
    return {
      drafted: true,
      approved,
      revision: ds.revision ?? 0,
      source: 'guildhall',
      label: approved ? `approved · rev ${ds.revision ?? 0}` : `draft · rev ${ds.revision ?? 0}`,
      reason: approved
        ? 'Guildhall has an approved design guardrail for this project.'
        : 'A design guardrail is drafted but still needs approval.',
    }
  }

  if (hasRepoDesignSystemSignals(config, map)) {
    return {
      drafted: true,
      approved: true,
      revision: 0,
      source: 'repo',
      label: 'detected in repo',
      reason: 'This project already contains its design system or component library.',
    }
  }

  return {
    drafted: false,
    approved: false,
    revision: 0,
    source: 'none',
    label: 'not captured',
    reason: 'No design-system guardrail is captured yet.',
  }
}

async function chooseProjectFolderMacOS(): Promise<string | null> {
  try {
    const { stdout } = await execFileP('osascript', [
      '-e',
      'POSIX path of (choose folder with prompt "Choose a project folder to attach to Guildhall")',
    ])
    const picked = stdout.trim()
    return picked.length > 0 ? picked : null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/User canceled|cancelled|canceled/i.test(message)) return null
    throw err
  }
}

function registrySummaryForProject(project: ResolvedProject): {
  id: string
  path: string
  name: string
  tags: string[]
} {
  if (project.initializationNeeded) {
    const folderName = basename(project.path) || project.id || 'Project'
    return {
      id: project.id,
      path: project.path,
      name: humanizeGeneratedProjectName(folderName),
      tags: ['uninitialized'],
    }
  }
  return {
    id: project.id,
    path: project.path,
    name: project.config?.name ?? project.id,
    tags: project.config?.tags ?? [],
  }
}

function syncRegistryEntryForProject(project: ResolvedProject) {
  const summary = registrySummaryForProject(project)
  const existing = findWorkspace(project.path)
  if (!existing) {
    registerWorkspace(summary)
    return { attached: true, entryId: summary.id }
  }
  if (existing.id !== summary.id) {
    unregisterWorkspace(existing.id)
    registerWorkspace(summary)
    return { attached: false, entryId: summary.id }
  }
  updateWorkspace(existing.id, {
    path: summary.path,
    name: summary.name,
    tags: summary.tags,
  })
  return { attached: false, entryId: existing.id }
}

function summarizeTaskCounts(tasks: Array<Record<string, unknown>>): ServiceProjectSummary['taskCounts'] {
  let active = 0
  let draftReview = 0
  let blocked = 0
  let done = 0
  let shelved = 0
  for (const task of tasks) {
    const status = typeof task.status === 'string' ? task.status : ''
    if (status === 'done') done++
    else if (status === 'blocked') blocked++
    else if (status === 'shelved') shelved++
    else if (status === 'import_draft') draftReview++
    else if (status) active++
  }
  return {
    total: tasks.length,
    active,
    draftReview,
    blocked,
    done,
    shelved,
  }
}

function hasApprovedProductBriefRecord(task: Record<string, unknown>): boolean {
  const brief = task.productBrief
  return Boolean(
    brief &&
    typeof brief === 'object' &&
    !Array.isArray(brief) &&
    typeof (brief as { approvedAt?: unknown }).approvedAt === 'string' &&
    (brief as { approvedAt: string }).approvedAt.trim().length > 0,
  )
}

function hasSpecDraftRecord(task: Record<string, unknown>): boolean {
  return (
    typeof task.spec === 'string' &&
    task.spec.trim().length > 0 &&
    Array.isArray(task.acceptanceCriteria) &&
    task.acceptanceCriteria.length > 0
  )
}

function isReadyForWorkerHandoffRecord(task: Record<string, unknown>): boolean {
  return hasApprovedProductBriefRecord(task) && hasSpecDraftRecord(task)
}

function summarizeTaskActivity(
  tasks: Array<Record<string, unknown>>,
  now = new Date(),
): NonNullable<ServiceProjectSummary['taskActivity']> {
  const days = 30
  const barCount = 18
  const windowMs = days * 24 * 60 * 60 * 1000
  const binMs = windowMs / barCount
  const startMs = now.getTime() - windowMs
  const values = Array.from({ length: barCount }, () => 0)

  for (const task of tasks) {
    const candidate =
      typeof task.completedAt === 'string'
        ? task.completedAt
        : typeof task.updatedAt === 'string'
          ? task.updatedAt
          : typeof task.createdAt === 'string'
            ? task.createdAt
            : null
    if (!candidate) continue
    const ts = Date.parse(candidate)
    if (!Number.isFinite(ts) || ts < startMs || ts > now.getTime()) continue
    const index = Math.min(barCount - 1, Math.max(0, Math.floor((ts - startMs) / binMs)))
    values[index] = (values[index] ?? 0) + 1
  }

  const max = Math.max(0, ...values)
  return {
    windowLabel: 'Last 30 days',
    max,
    bars: values.map((value, index) => {
      const binStart = new Date(startMs + index * binMs)
      const binEnd = new Date(Math.min(now.getTime(), startMs + (index + 1) * binMs))
      const startLabel = binStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      const endLabel = binEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      return {
        value,
        label: value === 1
          ? `1 task update, ${startLabel}-${endLabel}`
          : `${value} task updates, ${startLabel}-${endLabel}`,
      }
    }),
  }
}

function summarizeProjectText(project: ResolvedProject): string | null {
  if (project.initializationNeeded) {
    return 'Attached to this folder. Initialize Guildhall here to inspect the repo, configure providers, and start task flow.'
  }
  const briefPath = join(getProjectStateDir(project.path), 'project-brief.md')
  if (existsSync(briefPath)) {
    const brief = readFileSync(briefPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.replace(/^#+\s*/, '').trim())
      .filter((line) => line.length > 0)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (brief.length > 0) {
      return brief.length > 1200 ? `${brief.slice(0, 1197).trimEnd()}...` : brief
    }
  }
  const mandates = (project.config?.coordinators ?? [])
    .map((coordinator) => coordinator.mandate?.replace(/\s+/g, ' ').trim())
    .filter((mandate): mandate is string => Boolean(mandate))
  if (mandates.length > 0) {
    const combined = mandates.join(' ')
    return combined.length > 1200 ? `${combined.slice(0, 1197).trimEnd()}...` : combined
  }
  if ((project.config?.tags ?? []).length > 0) {
    return `Tagged ${project.config?.tags?.join(', ')}.`
  }
  return null
}

function latestTaskTitleByStatus(
  tasks: Array<Record<string, unknown>>,
  statuses: string[],
): string | null {
  const allowed = new Set(statuses)
  const picked = [...tasks]
    .filter((task) => typeof task.status === 'string' && allowed.has(task.status))
    .sort((left, right) => (String(right.updatedAt ?? '')).localeCompare(String(left.updatedAt ?? '')))[0]
  const title = typeof picked?.title === 'string' ? picked.title.trim() : ''
  return title || null
}

function resolveTaskPathForDomain(
  project: ResolvedProject,
  domain: string,
): string {
  return resolveTaskProjectPath({
    workspaceProjectPath: project.path,
    domain,
    coordinators: project.config?.coordinators ?? [],
    projects: project.config?.projects ?? [],
  })
}

/**
 * Filter a supervisor event buffer down to events for a specific task id.
 *
 * Accepts both the canonical wire-protocol field (`task_id`, snake_case — see
 * src/protocol/wire.ts) and the camelCase `taskId` that older internal
 * supervisor-emitted shapes use. Exported for regression testing because the
 * two field styles previously drifted and left the drawer's recent-events
 * feed silently empty.
 */
export function filterEventsForTask<T extends { event?: unknown }>(
  events: T[],
  taskId: string,
): T[] {
  return events.filter(ev => {
    const inner = ev.event as { task_id?: string; taskId?: string } | undefined
    const t = inner?.task_id ?? inner?.taskId
    return t === taskId
  })
}

function friendlyProjectEventToolName(tool: string): string {
  switch (tool) {
    case 'read-file': return 'file read'
    case 'edit-file': return 'file edit'
    case 'run-command': return 'command'
    case 'search-files': return 'file search'
    case 'list-files': return 'file list'
    default: return tool.replace(/[-_]/g, ' ')
  }
}

function summarizeProjectEvent(ev: Record<string, unknown> | undefined): string {
  const type = String(ev?.type ?? '')
  const message = typeof ev?.message === 'string' ? ev.message.trim() : ''
  if ((type === 'line_complete' || type === 'error') && isProviderCapacityEventMessage(message)) {
    return providerCapacityEventLabel(message)
  }
  const tool = friendlyProjectEventToolName(typeof ev?.tool_name === 'string' ? ev.tool_name : '')
  if ((type === 'tool_started' || type === 'tool_execution_started') && tool) return `Started ${tool}`
  if ((type === 'tool_completed' || type === 'tool_execution_completed') && ev?.is_error && tool) return `Failed ${tool}`
  if ((type === 'tool_completed' || type === 'tool_execution_completed') && tool) return `Finished ${tool}`
  if (type === 'error') return userFacingText(message, 'Agent error')
  if (type === 'line_complete') return userFacingText(message, 'Agent update')
  return type.replace(/_/g, ' ') || 'Agent activity'
}

function isProviderCapacityEventMessage(value: string): boolean {
  return /HTTP 429|Too Many Requests|rate limit|engine_overloaded|Model busy, retry later|retryable provider throttle/i.test(value)
}

function providerCapacityEventLabel(value: string): string {
  const retry = value.match(/retrying in ([\d.]+)s \(attempt (\d+) of (\d+)\)/i)
  if (retry) return `Provider busy; retrying in ${retry[1]}s (attempt ${retry[2]} of ${retry[3]}).`
  if (/retryable provider throttle/i.test(value)) return 'Provider busy; Guildhall will resume this task later.'
  if (/Agent .* failed on .*API error/i.test(value)) return 'Provider busy; this agent turn stopped.'
  if (/API error/i.test(value)) return 'Provider busy; request failed after retries.'
  return 'Provider busy; retry later.'
}

function toneForProjectEvent(
  ev: Record<string, unknown> | undefined,
): 'neutral' | 'running' | 'ok' | 'warn' | 'danger' {
  const type = String(ev?.type ?? '')
  if (type === 'error') {
    if (isProviderCapacityEventMessage(String(ev?.message ?? ''))) return 'warn'
    return /empty assistant/i.test(String(ev?.message ?? '')) ? 'warn' : 'danger'
  }
  if (type === 'line_complete' && isProviderCapacityEventMessage(String(ev?.message ?? ''))) return 'warn'
  if (type === 'tool_completed' || type === 'tool_execution_completed') return ev?.is_error ? 'danger' : 'ok'
  if (type === 'tool_started' || type === 'tool_execution_started') return 'running'
  if (type === 'line_complete') return 'running'
  return 'neutral'
}

function noteMatchesCanonicalAcceptance(
  note: Record<string, unknown>,
  canonicalDescriptions: ReadonlySet<string>,
): boolean {
  const role = typeof note.role === 'string' ? note.role : ''
  const content = typeof note.content === 'string' ? note.content.trim() : ''
  if (role !== 'specifier') return true
  const prefix = 'Added acceptance criterion: '
  if (!content.startsWith(prefix)) return true
  const description = content.slice(prefix.length).trim()
  if (!description) return true
  return canonicalDescriptions.has(description)
}

function normalizeTaskForDrawer(task: Record<string, unknown>): Record<string, unknown> {
  const canonicalDescriptions = new Set(
    Array.isArray(task.acceptanceCriteria)
      ? task.acceptanceCriteria
          .map((criterion) =>
            typeof (criterion as { description?: unknown }).description === 'string'
              ? (criterion as { description: string }).description.trim()
              : '',
          )
          .filter(Boolean)
      : [],
  )
  if (canonicalDescriptions.size === 0 || !Array.isArray(task.notes)) return task
  const notes = (task.notes as Array<Record<string, unknown>>)
    .filter((note) => noteMatchesCanonicalAcceptance(note, canonicalDescriptions))
  return notes.length === task.notes.length ? task : { ...task, notes }
}

function latestTaskNoteContent(
  task: Record<string, unknown>,
  predicate: (note: Record<string, unknown>) => boolean,
): string | null {
  const notes = Array.isArray(task.notes) ? task.notes as Array<Record<string, unknown>> : []
  const match = [...notes]
    .reverse()
    .find((note) => {
      const content = typeof note.content === 'string' ? note.content.trim() : ''
      return content.length > 0 && predicate(note)
    })
  const content = typeof match?.content === 'string' ? match.content.trim() : ''
  return content || null
}

function isWorkerSelfCritiqueNote(note: Record<string, unknown>): boolean {
  const role = typeof note.role === 'string' ? note.role.trim().toLowerCase() : ''
  const agentId = typeof note.agentId === 'string' ? note.agentId.trim().toLowerCase() : ''
  const content = typeof note.content === 'string' ? note.content : ''
  if (content.trim().length === 0 || !/self-critique/i.test(content)) return false
  if (role === 'self-critique') return true
  if (agentId === 'worker-agent') return true
  return role === 'implementation' || role === 'implementer' || role === 'worker'
}

function taskHasWorkerSelfCritique(task: Record<string, unknown>): boolean {
  const notes = Array.isArray(task.notes) ? (task.notes as Array<Record<string, unknown>>) : []
  return [...notes].reverse().some((note) => isWorkerSelfCritiqueNote(note))
}

function normalizedCheckpointNextPlannedAction(
  task: Record<string, unknown>,
  checkpoint: Checkpoint | null,
): string | null {
  const nextAction = checkpoint?.nextPlannedAction?.trim() ?? ''
  if (!nextAction) return null
  if (/^(?:none|null|n\/a|na|nothing)$/i.test(nextAction)) return null
  const hasSelfCritique = taskHasWorkerSelfCritique(task)
  if (
    hasSelfCritique &&
    /write or refresh self-critique note|write or refresh the self-critique note/i.test(nextAction)
  ) {
    return "Resume from the latest self-critique and recorded verification evidence, then hand off to review."
  }
  if (
    !hasSelfCritique &&
    /write or refresh self-critique note|write or refresh the self-critique note/i.test(nextAction) &&
    /hand off to review|handoff to review|transition to review/i.test(nextAction)
  ) {
    return 'Resume from the active worktree diff, rerun the focused verification commands, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.'
  }
  return nextAction
}

function buildTerminalSummary(
  task: Record<string, unknown>,
): { headline: string; detail?: string } | undefined {
  const status = typeof task.status === 'string' ? task.status : ''
  const mergeRecord =
    task.mergeRecord && typeof task.mergeRecord === 'object'
      ? (task.mergeRecord as Record<string, unknown>)
      : null

  if (mergeRecord) {
    const result = typeof mergeRecord.result === 'string' ? mergeRecord.result : ''
    const toBranch =
      typeof mergeRecord.toBranch === 'string' && mergeRecord.toBranch.trim().length > 0
        ? mergeRecord.toBranch.trim()
        : 'the base branch'
    const detail =
      typeof mergeRecord.detail === 'string' && mergeRecord.detail.trim().length > 0
        ? mergeRecord.detail.trim()
        : undefined
    const prUrl =
      typeof mergeRecord.prUrl === 'string' && mergeRecord.prUrl.trim().length > 0
        ? mergeRecord.prUrl.trim()
        : ''

    switch (result) {
      case 'merged':
        return { headline: `Merged locally into ${toBranch}.` }
      case 'pushed':
        return { headline: `Merged and pushed to ${toBranch}.` }
      case 'push_failed_degraded':
        return {
          headline: `Merged locally into ${toBranch}; push did not complete.`,
          ...(detail ? { detail } : {}),
        }
      case 'pending_pr':
        return {
          headline: prUrl ? 'PR opened and awaiting human merge.' : 'Awaiting human PR merge.',
          ...(prUrl ? { detail: prUrl } : detail ? { detail } : {}),
        }
      case 'skipped':
        return {
          headline: 'Task completed without an automatic merge.',
          ...(detail ? { detail } : {}),
        }
      case 'conflict':
        return {
          headline: `Merge into ${toBranch} hit a conflict.`,
          ...(detail ? { detail } : {}),
        }
      default:
        break
    }
  }

  if (status === 'done') return { headline: 'Task completed.' }
  if (status === 'pending_pr') return { headline: 'Awaiting human PR merge.' }
  return undefined
}

function taskGitStoryOverride(task: Record<string, unknown>): {
  override?: 'local_only' | 'deferred'
  reason?: string
} | undefined {
  const raw = task.gitStory
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const override = record.override
  if (override !== 'local_only' && override !== 'deferred') return undefined
  return {
    override,
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
  }
}

function taskForGitStory(
  task: Record<string, unknown>,
  workspace?: { worktreePath?: string },
): Parameters<typeof inspectGitStory>[1]['task'] {
  const mergeRecord =
    task.mergeRecord && typeof task.mergeRecord === 'object' && !Array.isArray(task.mergeRecord)
      ? task.mergeRecord as { result?: string }
      : undefined
  return {
    ...(typeof task.id === 'string' ? { id: task.id } : {}),
    ...(typeof task.title === 'string' ? { title: task.title } : {}),
    ...(typeof workspace?.worktreePath === 'string'
      ? { worktreePath: workspace.worktreePath }
      : typeof task.worktreePath === 'string'
        ? { worktreePath: task.worktreePath }
        : {}),
    ...(mergeRecord ? { mergeRecord } : {}),
    ...(taskGitStoryOverride(task) ? { gitStory: taskGitStoryOverride(task) } : {}),
  }
}

function taskGitStoryRepoPath(
  projectPath: string,
  task: Record<string, unknown>,
  workspace?: { worktreePath?: string },
): string {
  const worktreePath = typeof workspace?.worktreePath === 'string' && workspace.worktreePath.trim()
    ? workspace.worktreePath.trim()
    : typeof task.worktreePath === 'string' && task.worktreePath.trim()
      ? task.worktreePath.trim()
    : ''
  if (worktreePath) return worktreePath
  const taskProjectPath = typeof task.projectPath === 'string' && task.projectPath.trim()
    ? task.projectPath.trim()
    : ''
  return taskProjectPath || projectPath
}

const TASK_FILE_PREVIEW_LIMIT_BYTES = 256 * 1024

function isWithinPath(candidate: string, root: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function languageForPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase().replace(/^\./, '')
  if (ext === 'ts' || ext === 'tsx') return 'typescript'
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'javascript'
  if (ext === 'vue') return 'vue'
  if (ext === 'svelte') return 'svelte'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'yaml' || ext === 'yml') return 'yaml'
  if (ext === 'json') return 'json'
  if (ext === 'css') return 'css'
  if (ext === 'html') return 'html'
  if (ext === 'sql') return 'sql'
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return 'shell'
  return ext || 'text'
}

async function resolveTaskInspectableFile(
  projectPath: string,
  task: Record<string, unknown>,
  requestedPath: string,
  workspace?: { worktreePath?: string },
): Promise<{ absolutePath: string; displayPath: string }> {
  const requested = requestedPath.trim()
  if (!requested) throw new Error('path is required')
  const basePath = resolve(taskGitStoryRepoPath(projectPath, task, workspace))
  const rootCandidates = [
    projectPath,
    typeof task.projectPath === 'string' ? task.projectPath : '',
    typeof task.worktreePath === 'string' ? task.worktreePath : '',
    typeof workspace?.worktreePath === 'string' ? workspace.worktreePath : '',
    basePath,
  ]
  const roots = [...new Set(rootCandidates.map(item => item.trim()).filter(Boolean).map(item => resolve(item)))]
  const candidate = isAbsolute(requested)
    ? resolve(requested)
    : resolve(basePath, requested)
  const realCandidate = await fsp.realpath(candidate).catch(() => candidate)
  const realRoots = await Promise.all(roots.map(async root => fsp.realpath(root).catch(() => root)))
  const allowedRoot = realRoots.find(root => isWithinPath(realCandidate, root))
  if (!allowedRoot) throw new Error('path is outside the task workspace')
  const displayPath = isAbsolute(requested)
    ? requested
    : requested.split(pathSeparator).join('/')
  return { absolutePath: realCandidate, displayPath }
}

async function gitStoryForTask(
  projectPath: string,
  task: Record<string, unknown>,
  workspace?: { worktreePath?: string },
) {
  const driver = new NodeGitDriver()
  const inspectedPath = taskGitStoryRepoPath(projectPath, task, workspace)
  return inspectGitStory(driver, {
    repoRoot: typeof task.projectPath === 'string' && task.projectPath.trim() ? task.projectPath.trim() : projectPath,
    inspectedPath,
    task: taskForGitStory(task, workspace),
    inspectPr: false,
  })
}

async function buildProjectGitStorySummary(projectPath: string, tasks?: Array<Record<string, unknown>>): Promise<GitStorySummary> {
  const driver = new NodeGitDriver()
  const workspaceConfig = readWorkspaceConfig(projectPath)
  const workspaceProjects = workspaceConfig.kind === 'workspace'
    ? resolveWorkspaceProjectPaths(projectPath, workspaceConfig)
    : []
  const rootSnapshots = workspaceProjects.length > 0
    ? await Promise.all(workspaceProjects.map(child =>
        inspectGitStory(driver, {
          repoRoot: child.path,
          inspectedPath: child.path,
          inspectPr: false,
        }),
      ))
    : [
        await inspectGitStory(driver, {
          repoRoot: projectPath,
          inspectedPath: projectPath,
          inspectPr: false,
        }),
      ]
  const snapshots = [...rootSnapshots]
  const taskRecords = tasks ?? await readTasksFileNormalized(join(getProjectStateDir(projectPath), 'TASKS.json')).catch(() => [])
  const workspaceStore = await readTaskWorkspaceStore(projectPath).catch(() => undefined)
  for (const task of taskRecords) {
    const taskId = typeof task.id === 'string' ? task.id : ''
    const workspace = taskId ? workspaceStore?.workspaces[taskId] : undefined
    const taskStatus = typeof task.status === 'string' ? task.status : ''
    const mergeRecord =
      task.mergeRecord && typeof task.mergeRecord === 'object' && !Array.isArray(task.mergeRecord)
        ? task.mergeRecord as { result?: string }
        : undefined
    const hasUnresolvedTaskGit =
      typeof workspace?.worktreePath === 'string' ||
      typeof task.worktreePath === 'string' ||
      Boolean(taskGitStoryOverride(task)) ||
      mergeRecord?.result === 'skipped' ||
      mergeRecord?.result === 'conflict' ||
      taskStatus === 'pending_pr'
    if (!hasUnresolvedTaskGit) continue
    snapshots.push(await gitStoryForTask(projectPath, task, workspace))
  }
  return summarizeGitStories(snapshots)
}

function gitStoryAutomationFor(
  projectPath: string,
  workspaceConfig: ReturnType<typeof readWorkspaceConfig> | null,
  task: Record<string, unknown>,
  action: 'commit' | 'push' | 'pullRequest',
): 'ask' | 'auto' | 'never' {
  const policy = effectiveGitStoryPolicy({
    workspacePath: projectPath,
    workspaceProjectPath: projectPath,
    ...(workspaceConfig?.gitStory ? { workspaceGitStory: workspaceConfig.gitStory } : {}),
    workspaceProjects: workspaceConfig ? resolveWorkspaceProjectPaths(projectPath, workspaceConfig) : [],
    task,
  })
  const value = policy[action]
  return value === 'auto' || value === 'never' ? value : 'ask'
}

function isSafeRelativeGitPath(file: string): boolean {
  const trimmed = file.trim()
  return Boolean(trimmed) && !isAbsolute(trimmed) && !trimmed.split(/[\\/]+/).includes('..')
}

function policyAllowsGitWrite(
  projectPath: string,
  workspaceConfig: ReturnType<typeof readWorkspaceConfig> | null,
  task: Record<string, unknown>,
  action: 'commit' | 'push' | 'pullRequest',
  body: { confirmed?: boolean; automationSource?: string },
): { ok: true } | { ok: false; error: string; status: number } {
  const mode = gitStoryAutomationFor(projectPath, workspaceConfig, task, action)
  if (mode === 'never') return { ok: false, error: `Project policy disables ${action}.`, status: 403 }
  if (mode === 'auto' && body.automationSource === 'project_policy') return { ok: true }
  if (body.confirmed === true) return { ok: true }
  return { ok: false, error: `${action} requires confirmation for this project policy.`, status: 409 }
}

async function commitGitStoryFiles(input: {
  cwd: string
  files: string[]
  message: string
}): Promise<{ ok: boolean; commitSha?: string; detail?: string }> {
  try {
    await execFileP('git', ['add', '--', ...input.files], { cwd: input.cwd })
    await execFileP('git', ['commit', '--no-verify', '-m', input.message], { cwd: input.cwd })
    const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], { cwd: input.cwd })
    return { ok: true, commitSha: stdout.trim() }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

async function enrichTaskForServe(
  projectPath: string,
  task: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const effective = await buildEffectiveTask(projectPath, task as Task)
  const normalized = normalizeTaskForDrawer(effective)
  const taskId = typeof normalized.id === 'string' ? normalized.id : ''
  const memoryDir = getProjectStateDir(projectPath)
  const checkpoint = taskId ? await readCheckpoint(memoryDir, taskId) : null
  const reviewerFeedbackCutoffMs = (() => {
    const cutoff = latestResolvedRetryEscalationAt(normalized as import('@guildhall/core').Task)
    const parsed = cutoff ? Date.parse(cutoff) : Number.NaN
    return Number.isFinite(parsed) ? parsed : null
  })()
  const latestReviewerSummary = latestTaskNoteContent(
    normalized,
    (note) => {
      const agentId = typeof note.agentId === 'string' ? note.agentId : ''
      const role = typeof note.role === 'string' ? note.role : ''
      if (!(agentId === 'reviewer-fanout' || agentId === 'reviewer-agent' || role === 'reviewer')) {
        return false
      }
      if (reviewerFeedbackCutoffMs === null) return true
      const timestamp = typeof note.timestamp === 'string' ? Date.parse(note.timestamp) : Number.NaN
      return Number.isFinite(timestamp) && timestamp > reviewerFeedbackCutoffMs
    },
  )
  const latestSelfCritique = latestTaskNoteContent(
    normalized,
    (note) => isWorkerSelfCritiqueNote(note),
  )
  const terminalSummary = buildTerminalSummary(normalized)
  const workspaceStore = await readTaskWorkspaceStore(projectPath).catch(() => undefined)
  const workspace = taskId ? workspaceStore?.workspaces[taskId] : undefined
  const gitStory = await gitStoryForTask(projectPath, normalized, workspace).catch(() => undefined)
  const reviewAudit = taskId
    ? await createReviewAuditStore({
        projectRoot: projectPath,
        persistence: new FileBackedGuildhallPersistence(),
      }).readTaskReviewAudit(taskId).catch(() => null)
    : null

  return {
    ...normalized,
    ...(reviewAudit?.plan ? { reviewPlan: reviewAudit.plan.payload } : {}),
    ...(reviewAudit ? { reviewAuditSummary: buildReviewAuditSummary(reviewAudit) } : {}),
    ...(latestReviewerSummary ? { latestReviewerSummary } : {}),
    ...(latestSelfCritique ? { latestSelfCritique } : {}),
    ...(terminalSummary ? { terminalSummary } : {}),
    ...(gitStory ? { gitStory } : {}),
    ...(checkpoint
      ? {
          latestCheckpoint: {
            step: checkpoint.step,
            agentId: checkpoint.agentId,
            intent: checkpoint.intent,
            nextPlannedAction: normalizedCheckpointNextPlannedAction(normalized, checkpoint),
            filesTouched: checkpoint.filesTouched,
            writtenAt: checkpoint.writtenAt,
          },
        }
      : {}),
  }
}

function buildReviewAuditSummary(reviewAudit: {
  reviewerRuns: Array<{
    recordedAt?: string
    payload?: {
      verdict?: string
      recordedAt?: string
    }
  }>
  escapedMisses: readonly unknown[]
}): {
  reviewerRunCount: number
  reviseCount: number
  escapedMissCount: number
  latestReviewerRunAt?: string
} {
  const runTimes = reviewAudit.reviewerRuns
    .map((run) => run.payload?.recordedAt ?? run.recordedAt)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort()
  return {
    reviewerRunCount: reviewAudit.reviewerRuns.length,
    reviseCount: reviewAudit.reviewerRuns.filter((run) => run.payload?.verdict === 'revise').length,
    escapedMissCount: reviewAudit.escapedMisses.length,
    ...(runTimes.length > 0 ? { latestReviewerRunAt: runTimes[runTimes.length - 1] } : {}),
  }
}

/**
 * Build the Hono app for a project without binding to a port. Exposed for
 * integration tests that want to call `app.fetch(new Request(...))` directly;
 * `runServe` wraps this with @hono/node-server.
 */
export function buildServeApp(opts: ServeOptions = {}): {
  app: Hono
  supervisor: OrchestratorSupervisor
  projectPath: string
} {
  const preferredProjectPath = opts.preferredProjectPath ?? opts.projectPath ?? null
  const getRegisteredProjects = () => listWorkspaces()
  const pickProjectFolder = opts.pickProjectFolder ?? chooseProjectFolderMacOS
  const explicitProjectPath = preferredProjectPath ? resolve(preferredProjectPath) : null
  const fallbackProjectPath = explicitProjectPath
    ?? getRegisteredProjects()[0]?.path
    ?? process.cwd()
  const projectPath = resolve(fallbackProjectPath)
  let defaultProjectPath = resolve(projectPath)
  const requestProjectPathStore = new AsyncLocalStorage<string>()
  const currentProject = (): ResolvedProject => resolveProject(requestProjectPathStore.getStore() ?? defaultProjectPath)
  const refreshProject = (path = currentProject().path): ResolvedProject => {
    const refreshed = resolveProject(path)
    if (resolve(defaultProjectPath) === resolve(path)) defaultProjectPath = refreshed.path
    return refreshed
  }
  const resolveProjectPathForRequest = (c: Context, { allowDefaultProject = false }: { allowDefaultProject?: boolean } = {}): string | null => {
    const requestedId = c.req.query('projectId')?.trim()
    if (!requestedId) return allowDefaultProject ? defaultProjectPath : null
    const entry = getRegisteredProjects().find(item => item.id === requestedId)
    if (!entry) {
      const defaultProject = resolveProject(defaultProjectPath)
      if (defaultProject.id === requestedId) return defaultProject.path
      return null
    }
    return resolve(entry.path)
  }
  const project = new Proxy({} as ResolvedProject, {
    get(_target, prop) {
      return currentProject()[prop as keyof ResolvedProject]
    },
    has(_target, prop) {
      return prop in currentProject()
    },
    ownKeys() {
      return Reflect.ownKeys(currentProject())
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Object.getOwnPropertyDescriptor(currentProject(), prop)
    },
  })

  const supervisor = new OrchestratorSupervisor()
  const app = new Hono()
  const currentProjectPath = () => currentProject().path

  const bindProjectScope = async (
    c: Context,
    next: () => Promise<void>,
    {
      allowDefaultProject = false,
      requireExplicitForMutation = false,
    }: { allowDefaultProject?: boolean; requireExplicitForMutation?: boolean } = {},
  ) => {
    if (!allowDefaultProject && !c.req.query('projectId')?.trim()) {
      return c.json({ error: 'projectId is required for project-scoped requests.' }, 400)
    }
    if (
      requireExplicitForMutation &&
      c.req.method !== 'GET' &&
      c.req.method !== 'HEAD' &&
      !c.req.query('projectId')?.trim()
    ) {
      return c.json({ error: 'projectId is required for project-mutating requests.' }, 400)
    }
    const resolvedPath = resolveProjectPathForRequest(c, { allowDefaultProject })
    if (!resolvedPath) {
      return c.json({ error: 'Unknown project id for this local Guildhall service.' }, 404)
    }
    if (
      c.req.path.startsWith('/api/project') &&
      c.req.method !== 'GET' &&
      c.req.method !== 'HEAD'
    ) {
      const runtimeBlocker = projectRuntimeCompatibilityBlocker({ projectRoot: resolvedPath })
      if (runtimeBlocker) {
        return c.json(
          {
            error: runtimeBlocker.message,
            code: runtimeBlocker.code,
            actionHref: runtimeBlocker.actionHref,
          },
          409,
        )
      }
    }
    if (
      c.req.path.startsWith('/api/project') &&
      !c.req.path.startsWith('/api/project/migrations') &&
      c.req.method !== 'GET' &&
      c.req.method !== 'HEAD'
    ) {
      const requiredMigrationBlocker = await startBlockerForRequiredMigrations(resolvedPath)
      if (requiredMigrationBlocker) {
        return c.json(
          {
            error: requiredMigrationBlocker.message,
            code: requiredMigrationBlocker.code,
            actionHref: requiredMigrationBlocker.actionHref,
          },
          409,
        )
      }
    }
    return requestProjectPathStore.run(resolvedPath, next)
  }

  app.use('/api/project', (c, next) => bindProjectScope(c, next, { requireExplicitForMutation: true }))
  app.use('/api/project/*', (c, next) => bindProjectScope(c, next, { requireExplicitForMutation: true }))
  app.use('/api/config', (c, next) => bindProjectScope(c, next, { allowDefaultProject: true }))
  app.use('/api/config/*', (c, next) => bindProjectScope(c, next, { allowDefaultProject: true }))
  app.use('/api/setup', (c, next) => bindProjectScope(c, next, { allowDefaultProject: true }))
  app.use('/api/setup/*', (c, next) => bindProjectScope(c, next, { allowDefaultProject: true }))

  // Dynamic API surfaces should never be cached. The dashboard depends on
  // `/api/project`, inbox state, and SSE-adjacent status reads reflecting the
  // latest orchestrator tick immediately after a stop/start transition.
  app.use('/api/*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate')
    c.header('Pragma', 'no-cache')
    c.header('Expires', '0')
  })

  // -------------------------------------------------------------------------
  // API: runtime version (shown next to the "Guildhall" wordmark)
  // -------------------------------------------------------------------------
  let _cachedVersion: string | null = null
  let _cachedPackageRoot: string | null | undefined = undefined
  type RuntimeBuildIdentity = {
    version?: string
    builtAt: string
    source: string
    git: {
      commit: string
      shortCommit: string
      branch: string
      dirty: boolean
    }
  }

  function runtimePackageRoot(): string | null {
    if (_cachedPackageRoot !== undefined) return _cachedPackageRoot
    try {
      const here = dirname(fileURLToPath(import.meta.url))
      for (const start of [here, process.cwd()]) {
        let dir = start
        for (let i = 0; i < 8; i++) {
          const candidate = join(dir, 'package.json')
          if (existsSync(candidate)) {
            const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as {
              name?: string
            }
            if (pkg?.name === 'guildhall' || pkg?.name === '@guildhall/cli') {
              _cachedPackageRoot = dir
              return _cachedPackageRoot
            }
          }
          const next = dirname(dir)
          if (next === dir) break
          dir = next
        }
      }
    } catch {
      /* fall through */
    }
    _cachedPackageRoot = null
    return _cachedPackageRoot
  }

  function readRuntimeVersion(): string {
    if (_cachedVersion !== null) return _cachedVersion
    try {
      const root = runtimePackageRoot()
      if (root) {
        const candidate = join(root, 'package.json')
        if (existsSync(candidate)) {
          const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as {
            version?: string
          }
          _cachedVersion = pkg.version ?? 'unknown'
          return _cachedVersion
        }
      }
    } catch {
      /* fall through */
    }
    _cachedVersion = 'unknown'
    return _cachedVersion
  }

  app.get('/api/version', c => {
    return c.json({ version: readRuntimeVersion() })
  })

  app.get('/api/service', async c => {
    const runsById = new Map(supervisor.list().map(run => [run.workspaceId, run]))
    const registeredProjects = getRegisteredProjects()
    const projects = await Promise.all(
      registeredProjects.map(async (entry) => {
        const resolved = resolveProject(entry.path)
        const run = runsById.get(resolved.id)
        const providerStatus = resolved.initializationNeeded
          ? null
          : await buildProjectProviderStatusForPath(entry.path, run?.providerStatus)
        const migrationSummary = resolved.initializationNeeded
          ? null
          : await summarizeProjectMigrations(entry.path)
        const projectCheckIn = resolved.initializationNeeded
          ? null
          : summarizeProjectCheckIn(getProjectStateDir(entry.path))
        let taskCounts: ServiceProjectSummary['taskCounts'] = {
          total: 0,
          active: 0,
          draftReview: 0,
          blocked: 0,
          done: 0,
          shelved: 0,
        }
        let highlights: ServiceProjectSummary['highlights'] = undefined
        let taskActivity: ServiceProjectSummary['taskActivity'] = undefined
        try {
          const tasks = await readTasksFileNormalized(join(getProjectStateDir(entry.path), 'TASKS.json'))
          taskCounts = summarizeTaskCounts(tasks)
          taskActivity = summarizeTaskActivity(tasks)
          const gitStory = await buildProjectGitStorySummary(entry.path, tasks as Array<Record<string, unknown>>).catch(() => undefined)
          highlights = {
            activeTaskTitle: latestTaskTitleByStatus(tasks, ['in_progress', 'review', 'gate_check', 'exploring']),
            blockedTaskTitle: latestTaskTitleByStatus(tasks, ['blocked']),
            recentCompletedTaskTitle: latestTaskTitleByStatus(tasks, ['done']),
          }
          return {
            ...summarizeProject(resolved),
            summary: summarizeProjectText(resolved),
            taskCounts,
            ...(taskActivity ? { taskActivity } : {}),
            ...(highlights ? { highlights } : {}),
            ...(gitStory ? { gitStory } : {}),
            ...(providerStatus ? { providerStatus } : {}),
            ...(migrationSummary ? { migrationSummary } : {}),
            projectCheckIn,
            ...(run
              ? {
                  run: {
                    status: run.status,
                    startedAt: run.startedAt,
                    stoppedAt: run.stoppedAt,
                    error: run.error,
                    stopSummary: run.stopSummary,
                    providerStatus: run.providerStatus,
                  },
                }
              : {}),
          } satisfies ServiceProjectSummary
        } catch {
          // leave zeroed summary for missing/unreadable task files
        }
        return {
          ...summarizeProject(resolved),
          summary: summarizeProjectText(resolved),
          taskCounts,
          ...(taskActivity ? { taskActivity } : {}),
          ...(highlights ? { highlights } : {}),
          ...(providerStatus ? { providerStatus } : {}),
          ...(migrationSummary ? { migrationSummary } : {}),
          projectCheckIn,
          ...(run
            ? {
                run: {
                  status: run.status,
                  startedAt: run.startedAt,
                  stoppedAt: run.stoppedAt,
                  error: run.error,
                  stopSummary: run.stopSummary,
                  providerStatus: run.providerStatus,
                },
              }
            : {}),
        } satisfies ServiceProjectSummary
      }),
    )
    return c.json({
      pid: process.pid,
      defaultProviderStatus: buildGlobalDefaultProviderStatus(),
      projects,
    })
  })

  app.post('/api/service/select-project', async c => {
    return c.json({
      error: 'Guildhall no longer has a service-wide selected project. Open /projects/:projectId or pass projectId to project APIs.',
    }, 410)
  })

  app.post('/api/service/attach-project', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as { path?: string }
      const providedPath = body.path?.trim()
      const pickedPath = providedPath && providedPath.length > 0 ? providedPath : await pickProjectFolder()
      if (!pickedPath) return c.json({ ok: false, cancelled: true })
      const resolvedPath = resolve(pickedPath)
      if (!existsSync(resolvedPath) || !statSync(resolvedPath).isDirectory()) {
        return c.json({ error: 'Choose an existing project folder.' }, 400)
      }
      const next = resolveProject(resolvedPath)
      const sync = syncRegistryEntryForProject(next)
      return c.json({
        ok: true,
        attached: sync.attached,
        project: summarizeProject(next),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // API: build-info — staleness check.
  //
  // Node loads dist/cli.js once at process start; later rebuilds don't take
  // effect until restart. To stop the silent "I rebuilt but the running
  // server is yesterday's binary" failure mode, we capture the dist mtime
  // at startup and re-stat on every request. If they differ, the running
  // server is stale and the web app shows a "restart needed" banner.
  // -------------------------------------------------------------------------
  const distEntryPath = (() => {
    try {
      const here = dirname(fileURLToPath(import.meta.url))
      const candidates = [
        join(here, 'cli.js'),       // dist/cli.js when serve.js sits in dist/
        join(here, '..', 'cli.js'), // dist/cli.js when serve.js is dist/runtime/serve.js
        fileURLToPath(import.meta.url),
      ]
      for (const c of candidates) {
        if (existsSync(c)) return c
      }
    } catch {
      /* fallthrough */
    }
    return null
  })()
  let bootBuildMtimeMs = 0
  try {
    if (distEntryPath) {
      bootBuildMtimeMs = Math.floor(statSync(distEntryPath).mtimeMs)
    }
  } catch {
    bootBuildMtimeMs = 0
  }
  const processStartedAt = new Date().toISOString()

  function servedBundleFreshnessPayload(): {
    pid: number
    processStartedAt: string
    bootBuildMtimeMs: number
    currentBuildMtimeMs: number
    stale: boolean
    distPath: string | null
  } {
    let currentBuildMtimeMs = bootBuildMtimeMs
    try {
      if (distEntryPath) {
        currentBuildMtimeMs = Math.floor(statSync(distEntryPath).mtimeMs)
      }
    } catch {
      /* keep boot value */
    }
    return {
      pid: process.pid,
      processStartedAt,
      bootBuildMtimeMs,
      currentBuildMtimeMs,
      stale: currentBuildMtimeMs > bootBuildMtimeMs,
      distPath: distEntryPath,
    }
  }

  function readBakedBuildIdentity(): RuntimeBuildIdentity | null {
    try {
      const here = dirname(fileURLToPath(import.meta.url))
      const candidates = [
        join(here, 'build-info.json'),
        join(here, 'dist', 'build-info.json'),
        join(here, '..', 'build-info.json'),
      ]
      for (const candidate of candidates) {
        if (!existsSync(candidate)) continue
        const parsed = JSON.parse(readFileSync(candidate, 'utf-8')) as Partial<RuntimeBuildIdentity>
        const git = (parsed.git ?? {}) as Record<string, unknown>
        if (
          typeof parsed.builtAt === 'string' &&
          typeof parsed.source === 'string' &&
          typeof git.commit === 'string' &&
          typeof git.shortCommit === 'string' &&
          typeof git.branch === 'string' &&
          typeof git.dirty === 'boolean'
        ) {
          return {
            version: typeof parsed.version === 'string' ? parsed.version : undefined,
            builtAt: parsed.builtAt,
            source: parsed.source,
            git: {
              commit: git.commit,
              shortCommit: git.shortCommit,
              branch: git.branch,
              dirty: git.dirty,
            },
          }
        }
      }
    } catch {
      /* fall through to live git */
    }
    return null
  }

  async function gitOutput(args: string[], fallback = 'unknown'): Promise<string> {
    try {
      const cwd = runtimePackageRoot() ?? process.cwd()
      const { stdout } = await execFileP('git', args, { cwd })
      const value = stdout.trim()
      return value.length > 0 ? value : fallback
    } catch {
      return fallback
    }
  }

  async function liveBuildIdentity(): Promise<RuntimeBuildIdentity> {
    const status = await gitOutput(['status', '--porcelain=v1', '--untracked-files=all'], '')
    const commit = await gitOutput(['rev-parse', 'HEAD'])
    const shortCommit = commit === 'unknown'
      ? 'unknown'
      : await gitOutput(['rev-parse', '--short=12', 'HEAD'], commit.slice(0, 12))
    return {
      version: readRuntimeVersion(),
      builtAt: processStartedAt,
      source: 'live-git',
      git: {
        commit,
        shortCommit,
        branch: await gitOutput(['branch', '--show-current']),
        dirty: status.length > 0,
      },
    }
  }

  async function runningHealthPayload() {
    const served = servedBundleFreshnessPayload()
    const identity = readBakedBuildIdentity() ?? await liveBuildIdentity()
    const migrations = await summarizeProjectMigrations(defaultProjectPath)
    return {
      version: identity.version ?? readRuntimeVersion(),
      git: identity.git,
      build: {
        builtAt: identity.builtAt,
        source: identity.source,
        distPath: served.distPath,
      },
      served,
      migrations,
    }
  }

  app.get('/api/build-info', c => {
    return c.json(servedBundleFreshnessPayload())
  })

  app.get('/api/stale-server', c => {
    return c.json(servedBundleFreshnessPayload())
  })

  app.get('/api/health', async c => {
    return c.json(await runningHealthPayload())
  })

  // -------------------------------------------------------------------------
  // API: project
  // -------------------------------------------------------------------------
  app.get('/api/project', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({
          initializationNeeded: true,
          path: project.path,
          setupUrl: '/setup',
        })
      }
      const tasksPath = join(getProjectStateDir(project.path), 'TASKS.json')
      const rawTasks = await readTasksFileNormalized(tasksPath)
      const tasks = await Promise.all(rawTasks.map((task) => enrichTaskForServe(project.path, task)))
      const gitStory = await buildProjectGitStorySummary(project.path, rawTasks as Array<Record<string, unknown>>)
      const run = supervisor.get(project.id)
      const resolvedConfig = resolveConfig({ workspacePath: project.path })
      const runtimeProvider = getRuntimeProviderConfig({
        projectPath: project.path,
        models: resolvedConfig.models,
      })
      const preferredProvider = runtimeProvider.preferredProvider
      const preferredActiveProvider = preferredProvider
        ? normalizePreferredProvider(preferredProvider)
        : undefined
      const recent = supervisor.recent(project.id, undefined, project.path)
      const bootstrapStatus = readBootstrapStatus(getProjectStateDir(project.path))
      const preferredHealth = providerHealthForRun({
        credentials: runtimeProvider.credentials,
        activeProvider: preferredActiveProvider ?? null,
      })
      const providerStatus = run?.providerStatus ?? (
        preferredActiveProvider
          ? buildProviderStatusSnapshot({
              preferredProvider,
              activeProvider: null,
              fallback: false,
              health: preferredHealth,
              allowPaidProviderFallback: runtimeProvider.allowPaidProviderFallback,
              activeModel: resolvedConfig.models.worker,
              models: resolvedConfig.models,
              laneConcurrency: await providerLaneConcurrencyForRun({
                projectPath: project.path,
                activeProvider: preferredActiveProvider ?? null,
              }),
              warnings: await providerWarningsForRun({
                projectPath: project.path,
                preferredProvider,
                activeProvider: preferredActiveProvider ?? null,
                health: preferredHealth,
              }),
            })
          : null
      )
      const startReadiness = await projectStartReadiness({
        projectPath: project.path,
        resolvedConfig,
        runtimeProvider,
        allowPaidProviderFallback: runtimeProvider.allowPaidProviderFallback,
      })
      const inbox = await buildProjectInboxSnapshot({
        projectPath: project.path,
        initializationNeeded: project.initializationNeeded,
        coordinatorCount: project.config?.coordinators?.length ?? 0,
      })
      return c.json({
        initializationNeeded: false,
        id: project.id,
        path: project.path,
        name: project.config?.name ?? project.id,
        tags: project.config?.tags ?? [],
        config: project.config,
        tasks,
        inbox,
        run: run
          ? {
              status: run.status,
              mode: run.mode,
              startedAt: run.startedAt,
              stoppedAt: run.stoppedAt,
              error: run.error,
              ...(run.stopSummary ? { stopSummary: run.stopSummary } : {}),
              ...(run.providerStatus ? { providerStatus: run.providerStatus } : {}),
            }
          : null,
        providerStatus,
        gitStory,
        startReadiness,
        recentEvents: recent,
        ...(bootstrapStatus ? { bootstrapStatus } : {}),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/migrations', async c => {
    try {
      return c.json(await getProjectMigrationStatus({ projectRoot: project.path }))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/migrations/apply', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as {
        includePrompt?: boolean
        migrationId?: string
      }
      const result = await applyProjectMigrations({
        projectRoot: project.path,
        includePrompt: body.includePrompt === true,
        ...(body.migrationId ? { only: [body.migrationId] } : {}),
      })
      return c.json({
        ok: result.failed.length === 0,
        result,
        status: await getProjectMigrationStatus({ projectRoot: project.path }),
      }, result.failed.length === 0 ? 200 : 500)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  async function loadedLlamaModelIds(url: string, timeoutMs = 1500): Promise<string[]> {
    const trimmed = url.trim().replace(/\/$/, '')
    if (!trimmed) return []
    const res = await fetch(`${trimmed}/models`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return []
    const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: unknown }> }
    return [
      ...new Set(
        (body.data ?? [])
          .map(model => model.id)
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map(id => id.trim()),
      ),
    ]
  }

  function modelAssignmentForSingleModel(modelId: string): ModelAssignmentConfig {
    return {
      spec: modelId,
      coordinator: modelId,
      worker: modelId,
      reviewer: modelId,
      gateChecker: modelId,
      contextIndexer: modelId,
    }
  }

  const DEFAULT_OPENAI_MODEL_ASSIGNMENT: ModelAssignmentConfig = {
    spec: 'gpt-4o',
    coordinator: 'gpt-4o',
    worker: 'gpt-4o',
    reviewer: 'gpt-4o-mini',
    gateChecker: 'gpt-4o-mini',
    contextIndexer: 'gpt-4o-mini',
  }

  const DEFAULT_CODEX_MODEL_ASSIGNMENT: ModelAssignmentConfig = {
    spec: 'gpt-5.3-codex',
    coordinator: 'gpt-5.3-codex',
    worker: 'gpt-5.3-codex',
    reviewer: 'gpt-5.3-codex',
    gateChecker: 'gpt-5.3-codex',
    contextIndexer: 'gpt-5.3-codex',
  }

  function modelLooksCompatibleWithProvider(provider: ProviderName, modelId: string): boolean {
    const lower = modelId.trim().toLowerCase()
    if (!lower) return false
    switch (provider) {
      case 'claude-oauth':
      case 'anthropic-api':
        return lower.startsWith('claude-')
      case 'codex-oauth':
        return lower === 'gpt-5-codex' || lower === 'gpt-5.3-codex'
      case 'openai-api':
        return lower.length > 0
      case 'llama-cpp':
        return true
      default:
        return false
    }
  }

  function assignmentMatchesProvider(
    provider: ProviderName,
    assignment: ModelAssignmentConfig,
  ): boolean {
    return [
      assignment.spec,
      assignment.coordinator,
      assignment.worker,
      assignment.reviewer,
      assignment.gateChecker,
      assignment.contextIndexer,
    ].every(modelId => modelLooksCompatibleWithProvider(provider, modelId))
  }

  function defaultAssignmentForProvider(provider: ProviderName): ModelAssignmentConfig | null {
    switch (provider) {
      case 'claude-oauth':
      case 'anthropic-api':
        return DEFAULT_CLOUD_MODEL_ASSIGNMENT
      case 'codex-oauth':
        return DEFAULT_CODEX_MODEL_ASSIGNMENT
      case 'openai-api':
        return DEFAULT_OPENAI_MODEL_ASSIGNMENT
      case 'llama-cpp':
        return DEFAULT_LOCAL_MODEL_ASSIGNMENT
      default:
        return null
    }
  }

  function buildProviderStatusSnapshot(input: {
    preferredProvider?: PreferredProviderKey | ProviderName | null
    activeProvider?: ProviderName | null
    health?: {
      pooled: boolean
      state: 'idle' | 'healthy' | 'degraded'
      lastUsedAt?: string
      lastSuccessAt?: string
      lastFailureAt?: string
      consecutiveFailures: number
      retryableFailures: number
      fatalFailures: number
      lastError?: string
    } | null
    allowPaidProviderFallback?: boolean
    selectedAt?: string
    reason?: string
    activeModel?: string | null
    models?: ModelAssignmentConfig | null
    fallback?: boolean
    decisions?: Array<{
      code: string
      severity: 'info' | 'warn' | 'error'
      basis: 'availability' | 'capability' | 'compatibility'
      message: string
    }>
    laneConcurrency?: {
      spec: {
        requested: number
        effective: number
        recommended: number | null
        clamped: boolean
      }
      worker: {
        requested: number
        effective: number
        recommended: number | null
        clamped: boolean
      }
      review: {
        requested: number
        effective: number
        recommended: number | null
        clamped: boolean
      }
      coordinator: {
        requested: number
        effective: number
        recommended: number | null
        clamped: boolean
      }
      reviewerFanout: {
        requested: number
        effective: number
        recommended: number | null
        clamped: boolean
      }
    }
    warnings?: Array<{
      code: string
      severity: 'info' | 'warn' | 'error'
      message: string
    }>
  }) {
    const preferredProvider = input.preferredProvider ?? null
    const activeProvider = input.activeProvider ?? 'none'
    const selectedAt =
      input.selectedAt ??
      input.health?.lastUsedAt ??
      input.health?.lastSuccessAt ??
      input.health?.lastFailureAt ??
      'unknown'
    return {
      activeProvider,
      ...(preferredProvider ? {
        preferredCapabilities: providerCapabilitiesForAnyKey(preferredProvider),
        preferredProvider,
        preferredProviderFamily: providerFamilyForAnyKey(preferredProvider),
        preferredProviderLabel: providerLabelForAnyKey(preferredProvider),
      } : {}),
      ...(activeProvider !== 'none' ? {
        activeCapabilities: providerCapabilitiesForAnyKey(activeProvider),
        activeProviderFamily: providerFamilyForAnyKey(activeProvider),
        activeProviderLabel: providerLabelForAnyKey(activeProvider),
      } : {}),
      ...(input.health !== undefined ? { health: input.health } : {}),
      fallback: Boolean(input.fallback),
      ...(input.allowPaidProviderFallback !== undefined
        ? { allowPaidProviderFallback: input.allowPaidProviderFallback }
        : {}),
      selectedAt,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.activeModel ? { activeModel: input.activeModel } : {}),
      ...(input.models ? { models: input.models } : {}),
      ...(input.decisions && input.decisions.length > 0 ? { decisions: input.decisions } : {}),
      ...(input.laneConcurrency ? { laneConcurrency: input.laneConcurrency } : {}),
      ...(input.warnings && input.warnings.length > 0 ? { warnings: input.warnings } : {}),
    }
  }

  async function dispatchCapacityForProject(projectPath: string): Promise<number> {
    try {
      const settings = await loadLeverSettings({
        path: defaultAgentSettingsPath(projectPath),
      })
      return resolveFanoutCapacity(settings.project)
    } catch {
      return readProjectConfig(projectPath).workerLaneConcurrency ?? 1
    }
  }

  async function providerWarningsForRun(input: {
    projectPath: string
    preferredProvider?: PreferredProviderKey | ProviderName | null
    activeProvider: ProviderName | null | undefined
    health?: ReturnType<typeof providerHealthForRun>
  }) {
    const warnings: Array<{
      code: string
      severity: 'info' | 'warn' | 'error'
      message: string
    }> = []
    const preferredProvider = input.preferredProvider
      ? normalizePreferredProvider(input.preferredProvider as PreferredProviderKey)
      : null
    if (preferredProvider) {
      const global = readGlobalConfig()
      const workspace = readWorkspaceConfig(input.projectPath)
      const mismatches = [
        providerScopedModelMismatchWarning({
          scope: 'Global',
          models: global.models,
          preferredProvider,
        }),
        providerScopedModelMismatchWarning({
          scope: 'Project',
          models: workspace.models,
          preferredProvider,
        }),
      ].filter((warning): warning is {
        code: string
        severity: 'warn'
        message: string
      } => Boolean(warning))
      warnings.push(...mismatches)
    }
    if (input.health?.state === 'degraded') {
      warnings.push({
        code: 'provider_pool_health_degraded',
        severity: 'warn',
        message:
          `${providerLabelForAnyKey(input.activeProvider)} has seen ${input.health.consecutiveFailures} consecutive pooled failures` +
          `${input.health.lastError ? ` (${input.health.lastError})` : ''}.`,
      })
    }
    return warnings
  }

  const providerModelKeys = ['claude-oauth', 'anthropic-api', 'codex', 'codex-oauth', 'openai-api', 'llama-cpp'] as const

  function configuredProviderModelKeys(models: unknown): Array<(typeof providerModelKeys)[number]> {
    if (!models || typeof models !== 'object' || Array.isArray(models)) return []
    return Object.keys(models).filter((key): key is (typeof providerModelKeys)[number] =>
      (providerModelKeys as readonly string[]).includes(key),
    )
  }

  function modelProviderKeyMatchesPreferred(
    modelProvider: (typeof providerModelKeys)[number],
    preferredProvider: ProviderName,
  ): boolean {
    const normalizedModelProvider = modelProvider === 'codex' ? 'codex-oauth' : modelProvider
    return normalizedModelProvider === preferredProvider
  }

  function providerScopedModelMismatchWarning(input: {
    scope: 'Global' | 'Project'
    models: unknown
    preferredProvider: ProviderName
  }): {
    code: string
    severity: 'warn'
    message: string
  } | null {
    const keys = configuredProviderModelKeys(input.models)
    if (keys.length === 0) return null
    if (keys.some(key => modelProviderKeyMatchesPreferred(key, input.preferredProvider))) return null
    const configuredLabels = [...new Set(keys.map(key => providerLabelForAnyKey(key)))].join(', ')
    const preferredLabel = providerLabelForAnyKey(input.preferredProvider)
    return {
      code: 'provider_model_scope_mismatch',
      severity: 'warn',
      message:
        `${input.scope} model overrides are configured for ${configuredLabels}, but this project is set to use ${preferredLabel}. ` +
        `Guildhall will use ${preferredLabel} defaults unless you switch providers or configure models for ${preferredLabel}.`,
    }
  }

  function buildGlobalDefaultProviderStatus() {
    const global = readGlobalConfig()
    const preferredProvider = global.preferredProvider ?? null
    if (!preferredProvider) return null
    const activeProvider = normalizePreferredProvider(preferredProvider)
    const models = mergeModels(
      resolveModelsForProvider(global.models, preferredProvider),
      undefined,
      defaultAssignmentForProvider(activeProvider) ?? DEFAULT_LOCAL_MODEL_ASSIGNMENT,
    )
    const warning = providerScopedModelMismatchWarning({
      scope: 'Global',
      models: global.models,
      preferredProvider: activeProvider,
    })
    return buildProviderStatusSnapshot({
      preferredProvider,
      activeProvider,
      fallback: false,
      allowPaidProviderFallback: global.allowPaidProviderFallback,
      activeModel: models.worker,
      models,
      ...(warning ? { warnings: [warning] } : {}),
    })
  }

  async function buildProjectProviderStatusForPath(projectPath: string, liveProviderStatus?: unknown) {
    if (liveProviderStatus) return liveProviderStatus
    const resolvedConfig = resolveConfig({ workspacePath: projectPath })
    const runtimeProvider = getRuntimeProviderConfig({
      projectPath,
      models: resolvedConfig.models,
    })
    const preferredProvider = runtimeProvider.preferredProvider
    const preferredActiveProvider = preferredProvider
      ? normalizePreferredProvider(preferredProvider)
      : undefined
    if (!preferredActiveProvider) return null
    const preferredHealth = providerHealthForRun({
      credentials: runtimeProvider.credentials,
      activeProvider: preferredActiveProvider,
    })
    return buildProviderStatusSnapshot({
      preferredProvider,
      activeProvider: null,
      fallback: false,
      health: preferredHealth,
      allowPaidProviderFallback: runtimeProvider.allowPaidProviderFallback,
      activeModel: resolvedConfig.models.worker,
      models: resolvedConfig.models,
      laneConcurrency: await providerLaneConcurrencyForRun({
        projectPath,
        activeProvider: preferredActiveProvider,
      }),
      warnings: await providerWarningsForRun({
        projectPath,
        preferredProvider,
        activeProvider: preferredActiveProvider,
        health: preferredHealth,
      }),
    })
  }

  function providerHealthForRun(input: {
    credentials: {
      anthropicApiKey?: string
      openaiApiKey?: string
      openaiBaseUrl?: string
      llamaCppUrl?: string
    }
    activeProvider: ProviderName | null | undefined
  }) {
    const key = providerHealthKeyForRun(input)
    if (!key) return null
    return providerClientHealth(key)
  }

  function providerHealthKeyForRun(input: {
    credentials: {
      anthropicApiKey?: string
      openaiApiKey?: string
      openaiBaseUrl?: string
      llamaCppUrl?: string
    }
    activeProvider: ProviderName | null | undefined
  }) {
    switch (input.activeProvider) {
      case 'llama-cpp': {
        const url = input.credentials.llamaCppUrl?.trim()
        if (!url) return null
        return openAiCompatiblePoolKey({
          provider: 'llama-cpp',
          baseUrl: url,
        })
      }
      case 'openai-api': {
        const key = input.credentials.openaiApiKey?.trim()
        if (!key) return null
        return openAiCompatiblePoolKey({
          provider: 'openai-api',
          baseUrl: input.credentials.openaiBaseUrl?.trim() || 'https://api.openai.com/v1',
          apiKey: key,
        })
      }
      case 'anthropic-api': {
        const key = input.credentials.anthropicApiKey?.trim()
        if (!key) return null
        return anthropicCompatiblePoolKey(key)
      }
      default:
        return null
    }
  }

  async function providerLaneConcurrencyForRun(input: {
    projectPath: string
    activeProvider: ProviderName | null | undefined
    dispatchCapacity?: number
  }) {
    const dispatchCapacity =
      input.dispatchCapacity ?? await dispatchCapacityForProject(input.projectPath)
    const lanePlan = resolveLaneConcurrencyPlan({
      projectPath: input.projectPath,
      provider: input.activeProvider,
      dispatchCapacity,
    })
    return {
      spec: {
        requested: lanePlan.spec.requestedConcurrency,
        effective: lanePlan.spec.effectiveConcurrency,
        recommended: lanePlan.spec.recommendedConcurrency,
        clamped: lanePlan.spec.clamped,
      },
      worker: {
        requested: lanePlan.worker.requestedConcurrency,
        effective: lanePlan.worker.effectiveConcurrency,
        recommended: lanePlan.worker.recommendedConcurrency,
        clamped: lanePlan.worker.clamped,
      },
      review: {
        requested: lanePlan.review.requestedConcurrency,
        effective: lanePlan.review.effectiveConcurrency,
        recommended: lanePlan.review.recommendedConcurrency,
        clamped: lanePlan.review.clamped,
      },
      coordinator: {
        requested: lanePlan.coordinator.requestedConcurrency,
        effective: lanePlan.coordinator.effectiveConcurrency,
        recommended: lanePlan.coordinator.recommendedConcurrency,
        clamped: lanePlan.coordinator.clamped,
      },
      reviewerFanout: {
        requested: lanePlan.reviewerFanout.requestedConcurrency,
        effective: lanePlan.reviewerFanout.effectiveConcurrency,
        recommended: lanePlan.reviewerFanout.recommendedConcurrency,
        clamped: lanePlan.reviewerFanout.clamped,
      },
    }
  }

  async function selectPaidFallbackProvider(opts: {
    anthropicApiKey?: string
    openaiApiKey?: string
    openaiBaseUrl?: string
    llamaCppUrl?: string
  }) {
    const fallbackOrder: ProviderName[] = [
      'codex-oauth',
      'claude-oauth',
      'anthropic-api',
      'openai-api',
    ]
    for (const provider of fallbackOrder) {
      const result = await selectApiClient(buildSelectApiClientOptions({
        providerOverride: provider,
        credentials: opts,
      }))
      if (result.providerName !== 'none') return result
    }
    return null
  }

  function missingAssignedModels(
    assignment: ModelAssignmentConfig,
    loadedModels: string[],
  ): string[] {
    const loaded = new Set(loadedModels)
    return [
      ...new Set([
        assignment.spec,
        assignment.coordinator,
        assignment.worker,
        assignment.reviewer,
        assignment.gateChecker,
        assignment.contextIndexer,
      ].filter(model => !loaded.has(model))),
    ]
  }

  async function projectStartReadiness(input: {
    projectPath: string
    resolvedConfig: ReturnType<typeof resolveConfig>
    runtimeProvider: ReturnType<typeof getRuntimeProviderConfig>
    allowPaidProviderFallback: boolean
  }): Promise<{
    canStart: boolean
    code?: string
    message?: string
    actionHref?: string
  }> {
    const runtimeBlocker = projectRuntimeCompatibilityBlocker({ projectRoot: input.projectPath })
    if (runtimeBlocker) return runtimeBlocker

    const requiredMigrationBlocker = await startBlockerForRequiredMigrations(input.projectPath)
    if (requiredMigrationBlocker) return requiredMigrationBlocker

    const ownerInputBlocker = startBlockerForOwnerInput(input.projectPath)
    if (ownerInputBlocker) return ownerInputBlocker

    const importDraftBlocker = await startBlockerForImportDrafts(input.projectPath)
    if (importDraftBlocker) return importDraftBlocker

    const taskReadinessBlocker = await startBlockerForTaskReadiness(input.projectPath)
    if (taskReadinessBlocker) return taskReadinessBlocker

    const terminal = terminalStartState(input.projectPath)
    if (terminal) {
      return {
        canStart: false,
        code: terminal.code,
        message: terminal.message,
      }
    }

    try {
      const settings = await loadLeverSettings({
        path: defaultAgentSettingsPath(input.projectPath),
      })
      const invariant = projectLeverInvariantError(settings.project)
      if (invariant) {
        return {
          canStart: false,
          code: 'invalid_lever_combo',
          message: invariant,
          actionHref: '/settings/advanced',
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/concurrent_task_dispatch.*worktree_isolation/i.test(message)) {
        return {
          canStart: false,
          code: 'invalid_lever_combo',
          message,
          actionHref: '/settings/advanced',
        }
      }
    }

    const preflight = await selectApiClient(input.runtimeProvider.selectOptions)
    if (preflight.providerName === 'none') {
      return {
        canStart: false,
        code: 'no_provider',
        message:
          preflight.reason ??
          'No provider configured. Open Providers to choose one before starting Guildhall.',
        actionHref: '/providers',
      }
    }

    if (preflight.providerName !== 'llama-cpp') {
      return { canStart: true }
    }

    const creds = input.runtimeProvider.credentials
    if (!creds.llamaCppUrl) return { canStart: true }

    const loadedModels = await loadedLlamaModelIds(creds.llamaCppUrl).catch(() => [])
    if (loadedModels.length === 0) {
      const paidFallback = input.allowPaidProviderFallback
        ? await selectPaidFallbackProvider(creds)
        : null
      if (!paidFallback || paidFallback.providerName === 'none') {
        return {
          canStart: false,
          code: 'no_loaded_model',
          message:
            'The configured local server is reachable, but Guildhall could not see a loaded model. Load the model you want on that server, then start again.',
          actionHref: '/providers',
        }
      }
      return { canStart: true }
    }

    const missingModels = missingAssignedModels(input.resolvedConfig.models, loadedModels)
    if (missingModels.length === 0) return { canStart: true }

    const paidFallback = input.allowPaidProviderFallback
      ? await selectPaidFallbackProvider(creds)
      : null
    if (paidFallback && paidFallback.providerName !== 'none') {
      return { canStart: true }
    }
    return {
      canStart: false,
      code: 'model_unavailable',
      message:
        `The configured local server currently has ${loadedModels.join(', ')} loaded, but this project is configured for ${missingModels.join(', ')}. ` +
        'Load one of the configured models on that server, or choose a loaded model in Providers.',
      actionHref: '/providers',
    }
  }

  function terminalStartState(projectPath: string): {
    canStart: false
    code: 'all_terminal'
    message: string
    stopSummary: {
      reason: 'all_terminal'
      message: string
      counts: {
        total: number
        done: number
        blocked: number
        shelved: number
        actionable: number
        terminal: number
      }
    }
  } | null {
    const tasksPath = join(getProjectStateDir(projectPath), 'TASKS.json')
    if (!existsSync(tasksPath)) return null
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(tasksPath, 'utf-8'))
    } catch {
      return null
    }
    const tasks = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks)
        ? (raw as { tasks: unknown[] }).tasks
        : []
    if (tasks.length === 0) return null

    let done = 0
    let blocked = 0
    let shelved = 0
    let terminal = 0
    for (const task of tasks) {
      if (!task || typeof task !== 'object') return null
      const status = String((task as { status?: unknown }).status ?? '')
      if (status === 'done') {
        done += 1
        terminal += 1
      } else if (status === 'blocked') {
        blocked += 1
        terminal += 1
      } else if (status === 'shelved') {
        shelved += 1
        terminal += 1
      }
    }
    const actionable = tasks.length - terminal
    if (actionable > 0) return null

    const detailMessage = `No actionable tasks remain: ${done} done, ${blocked} blocked, ${shelved} shelved.`
    const message = done === tasks.length
      ? 'All tasks are already finished.'
      : detailMessage

    return {
      canStart: false,
      code: 'all_terminal',
      message,
      stopSummary: {
        reason: 'all_terminal',
        message: detailMessage,
        counts: {
          total: tasks.length,
          done,
          blocked,
          shelved,
          actionable,
          terminal,
        },
      },
    }
  }

  async function startBlockerForImportDrafts(projectPath: string): Promise<{
    canStart: false
    code: 'import_drafts_waiting'
    message: string
    actionHref: string
  } | null> {
    const tasksPath = join(getProjectStateDir(projectPath), 'TASKS.json')
    if (!existsSync(tasksPath)) return null
    const raw = JSON.parse(await fsp.readFile(tasksPath, 'utf-8')) as
      | { tasks?: Array<Record<string, unknown>> }
      | Array<Record<string, unknown>>
    const tasks = Array.isArray(raw) ? raw : raw.tasks ?? []
    const importDrafts = tasks.filter(t => t && typeof t === 'object' && (t as { status?: unknown }).status === 'import_draft')
    if (importDrafts.length === 0) return null
    const runnable = tasks.some(t => {
      if (!t || typeof t !== 'object') return false
      const status = String((t as { status?: unknown }).status ?? '')
      return ['proposed', 'ready', 'exploring', 'in_progress', 'review', 'gate_check', 'spec_review'].includes(status)
    })
    if (runnable) return null
    const first = importDrafts[0] as { id?: unknown; title?: unknown }
    const title = typeof first.title === 'string' && first.title.trim() ? first.title.trim() : 'the first imported draft'
    const id = typeof first.id === 'string' ? first.id : ''
    return {
      canStart: false,
      code: 'import_drafts_waiting',
      message:
        importDrafts.length === 1
          ? `Review the imported draft "${title}" and turn it into a task brief before starting Guildhall.`
          : `Review ${importDrafts.length} imported drafts before starting Guildhall. Start with "${title}".`,
      actionHref: id ? `/task/${encodeURIComponent(id)}` : '/notifications',
    }
  }

  async function startBlockerForTaskReadiness(projectPath: string): Promise<{
    canStart: false
    code: 'no_unattended_progress'
    message: string
    actionHref: string
  } | null> {
    const tasksPath = join(getProjectStateDir(projectPath), 'TASKS.json')
    if (!existsSync(tasksPath)) return null
    const raw = JSON.parse(await fsp.readFile(tasksPath, 'utf-8')) as
      | { tasks?: Array<Record<string, unknown>> }
      | Array<Record<string, unknown>>
    const tasks = Array.isArray(raw) ? raw : raw.tasks ?? []
    if (tasks.length === 0) return null

    let runnable = 0
    let needsBriefCleanup = 0
    let waitingForApproval = 0
    let terminal = 0
    for (const task of tasks) {
      if (!task || typeof task !== 'object') continue
      const status = String((task as { status?: unknown }).status ?? '')
      if (['done', 'blocked', 'shelved', 'pending_pr'].includes(status)) {
        terminal += 1
        continue
      }
      if (status === 'spec_review') {
        waitingForApproval += 1
        continue
      }
      if (status === 'ready' && !isReadyForWorkerHandoffRecord(task)) {
        needsBriefCleanup += 1
        continue
      }
      if (['proposed', 'exploring', 'ready', 'in_progress', 'review', 'gate_check'].includes(status)) {
        runnable += 1
      }
    }

    if (runnable > 0 || terminal === tasks.length) return null
    if (needsBriefCleanup > 0) {
      return {
        canStart: false,
        code: 'no_unattended_progress',
        message:
          needsBriefCleanup === 1
            ? 'One task needs a clearer brief and acceptance criteria before Guildhall can build unattended.'
            : `${needsBriefCleanup} tasks need clearer briefs and acceptance criteria before Guildhall can build unattended.`,
        actionHref: '/work',
      }
    }
    if (waitingForApproval > 0) {
      return {
        canStart: false,
        code: 'no_unattended_progress',
        message:
          waitingForApproval === 1
            ? 'Review the waiting spec before starting Guildhall.'
            : `Review ${waitingForApproval} waiting specs before starting Guildhall.`,
        actionHref: '/thread',
      }
    }
    return null
  }

  function startBlockerForOwnerInput(projectPath: string): {
    canStart: false
    code: 'owner_input_required'
    message: string
    actionHref: string
  } | null {
    const ownerItems = buildInbox({ projectPath }).filter(item =>
      item.severity !== 'low' &&
      [
        'project_check_in',
        'pressure_test_pending',
        'agent_question_pending',
        'brief_approval',
        'spec_approval',
        'open_escalation',
      ].includes(item.kind),
    )
    const first = ownerItems[0]
    if (!first) return null
    const questionCount = ownerItems.filter(item =>
      item.kind === 'pressure_test_pending' || item.kind === 'agent_question_pending',
    ).length
    const action =
      questionCount > 0
        ? `${questionCount} ${questionCount === 1 ? 'question needs' : 'questions need'} your answer before Guildhall can continue`
        : first.kind === 'brief_approval'
          ? 'Review the waiting task brief before Guildhall can continue'
          : first.kind === 'spec_approval'
            ? 'Review the waiting spec before Guildhall can continue'
            : 'Choose a recovery path for the blocked task'
    return {
      canStart: false,
      code: 'owner_input_required',
      message: action,
      actionHref: first.actionHref ?? '/thread',
    }
  }

  app.post('/api/project/start', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as {
        mode?: string
        stopAfterOneTask?: boolean
        taskId?: string
      }
      const existingRun = supervisor.get(project.id)
      if (body.taskId && existingRun && (existingRun.status === 'running' || existingRun.status === 'stopping')) {
        return c.json(
          {
            error: existingRun.status === 'running'
              ? 'Guildhall is already running for this project. This task remains queued; stop the current run first if you need Guildhall to restart on this exact task.'
              : 'Guildhall is stopping. Wait for it to stop before starting this specific task.',
            code: 'run_already_active',
            status: existingRun.status,
          },
          409,
        )
      }
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const requiredMigrationBlocker = await startBlockerForRequiredMigrations(project.path)
      if (requiredMigrationBlocker) {
        return c.json(
          {
            error: requiredMigrationBlocker.message,
            code: requiredMigrationBlocker.code,
            actionHref: requiredMigrationBlocker.actionHref,
          },
          409,
        )
      }
      const importDraftBlocker = await startBlockerForImportDrafts(project.path)
      if (importDraftBlocker) {
        return c.json(
          {
            error: importDraftBlocker.message,
            code: importDraftBlocker.code,
            actionHref: importDraftBlocker.actionHref,
          },
          400,
        )
      }
      const terminal = terminalStartState(project.path)
      if (terminal) {
        return c.json({
          status: 'stopped',
          mode: 'continuous',
          code: terminal.code,
          stopSummary: terminal.stopSummary,
        })
      }
      try {
        const settings = await loadLeverSettings({
          path: defaultAgentSettingsPath(project.path),
        })
        const invariant = projectLeverInvariantError(settings.project)
        if (invariant) {
          return c.json(
            { error: invariant, code: 'invalid_lever_combo', actionHref: '/settings/advanced' },
            400,
          )
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (/concurrent_task_dispatch.*worktree_isolation/i.test(message)) {
          return c.json(
            { error: message, code: 'invalid_lever_combo', actionHref: '/settings/advanced' },
            400,
          )
        }
        throw err
      }
      // Preflight: a run with no provider is worse than no run — the
      // orchestrator boots, every tick fails, and the UI shows "Running"
      // while nothing actually moves. Catch the missing-provider case here
      // and return an actionable 400 so the Start button surfaces a clear
      // "configure a provider first" message instead of a silent spin.
      const projectCfg = readProjectConfig(project.path)
      try {
        migrateProjectProvidersToGlobal(project.path, {
          readProject: (p) => readProjectConfig(p),
          writeProject: (p, patch) => updateProjectConfig(p, patch),
        })
      } catch {
        /* best-effort */
      }
      const resolvedConfig = resolveConfig({ workspacePath: project.path })
      const runtimeProvider = getRuntimeProviderConfig({
        projectPath: project.path,
        models: resolvedConfig.models,
      })
      const creds = runtimeProvider.credentials
      const preferred = runtimeProvider.preferredProvider
      const allowPaidProviderFallback = runtimeProvider.allowPaidProviderFallback
      let preflight = await selectApiClient(runtimeProvider.selectOptions)
      if (preflight.providerName === 'none') {
        return c.json(
          {
            error:
              preflight.reason ??
              'No provider configured. Open Providers (/providers) to set one up.',
            code: 'no_provider',
          },
          400,
        )
      }
      let effectiveProvider = preflight.providerName
      let effectiveModels = resolvedConfig.models
      let fallbackReason = preflight.reason
      const routingDecisions: Array<{
        code: string
        severity: 'info' | 'warn' | 'error'
        basis: 'availability' | 'capability' | 'compatibility'
        message: string
      }> = []
      if (preflight.providerName === 'llama-cpp' && creds.llamaCppUrl && project.config) {
        const assignedModels = resolvedConfig.models
        const loadedModels = await loadedLlamaModelIds(creds.llamaCppUrl).catch(() => [])
        if (loadedModels.length === 0) {
          const paidFallback = allowPaidProviderFallback
            ? await selectPaidFallbackProvider(creds)
            : null
          if (!paidFallback) {
            return c.json(
              {
                error:
                  'The configured local server is reachable, but Guildhall could not see a loaded model. To avoid surprise memory pressure from JIT loading, load the model you want on that server, then start again.',
                code: 'no_loaded_model',
                provider: 'llama-cpp',
              },
              400,
            )
          }
          preflight = paidFallback
          if (paidFallback.providerName === 'none') {
            return c.json(
              { error: paidFallback.reason ?? 'No fallback provider available.', code: 'fallback_unavailable' },
              400,
            )
          }
          effectiveProvider = paidFallback.providerName
          effectiveModels = defaultAssignmentForProvider(paidFallback.providerName) ?? resolvedConfig.models
          fallbackReason =
            'Preferred local server had no loaded model available, so Guildhall switched to a paid fallback provider.'
          routingDecisions.push({
            code: 'preferred_provider_missing_loaded_model',
            severity: 'info',
            basis: 'availability',
            message:
              'The preferred local server had no loaded model available, so Guildhall selected a fallback provider for this run.',
          })
        }
        if (effectiveProvider === 'llama-cpp') {
          const missingModels = missingAssignedModels(assignedModels, loadedModels)
          if (missingModels.length > 0) {
            const paidFallback = allowPaidProviderFallback
              ? await selectPaidFallbackProvider(creds)
              : null
            if (!paidFallback) {
              return c.json(
                {
                  error:
                    `The configured local server currently has ${loadedModels.join(', ')} loaded, but this project is configured for ${missingModels.join(', ')}. ` +
                    'Guildhall will not JIT-load missing models automatically; load the configured model on that server or choose a loaded model in Providers.',
                  code: 'model_unavailable',
                  provider: 'llama-cpp',
                  loadedModels,
                  missingModels,
                },
                400,
              )
            }
            preflight = paidFallback
            if (paidFallback.providerName === 'none') {
              return c.json(
                { error: paidFallback.reason ?? 'No fallback provider available.', code: 'fallback_unavailable' },
                400,
              )
            }
            effectiveProvider = paidFallback.providerName
            effectiveModels = defaultAssignmentForProvider(paidFallback.providerName) ?? resolvedConfig.models
            fallbackReason =
              'Preferred local server did not have the configured models loaded, so Guildhall switched to a paid fallback provider.'
            routingDecisions.push({
              code: 'preferred_provider_missing_assigned_models',
              severity: 'info',
              basis: 'compatibility',
              message:
                'The preferred local server did not have this project’s assigned models loaded, so Guildhall selected a fallback provider for this run.',
            })
          }
        }
      }
      if (!assignmentMatchesProvider(effectiveProvider, effectiveModels)) {
        effectiveModels = defaultAssignmentForProvider(effectiveProvider) ?? effectiveModels
        if (effectiveProvider !== 'llama-cpp') {
          fallbackReason ??=
            `Guildhall swapped to models that ${effectiveProvider} can actually serve for this run.`
          routingDecisions.push({
            code: 'model_assignment_swapped_for_provider_compatibility',
            severity: 'info',
            basis: 'compatibility',
            message:
              `Guildhall swapped to models that ${providerLabelForAnyKey(effectiveProvider)} can actually serve for this run.`,
          })
        }
      }
      const stopAfterOneTask =
        body.stopAfterOneTask === true || body.mode === 'one_task'
      const normalizedPreferred = preferred
        ? normalizePreferredProvider(preferred)
        : undefined
      const activeHealth = providerHealthForRun({
        credentials: creds,
        activeProvider: effectiveProvider,
      })
      const activeHealthKey = providerHealthKeyForRun({
        credentials: creds,
        activeProvider: effectiveProvider,
      })
      const providerStatus = buildProviderStatusSnapshot({
        preferredProvider: preferred ?? null,
        activeProvider: effectiveProvider,
        health: activeHealth,
        fallback: Boolean(normalizedPreferred && normalizedPreferred !== effectiveProvider),
        allowPaidProviderFallback,
        selectedAt: new Date().toISOString(),
        activeModel: effectiveModels.worker,
        models: effectiveModels,
        decisions: routingDecisions,
        laneConcurrency: await providerLaneConcurrencyForRun({
          projectPath: project.path,
          activeProvider: effectiveProvider,
        }),
        warnings: await providerWarningsForRun({
          projectPath: project.path,
          preferredProvider: preferred ?? null,
          activeProvider: effectiveProvider,
          health: activeHealth,
        }),
        ...(fallbackReason ? { reason: fallbackReason } : {}),
      })
      const run = supervisor.start({
        workspaceId: project.id,
        workspacePath: project.path,
        ...(stopAfterOneTask ? { stopAfterOneTask: true } : {}),
        ...(body.taskId ? { preferredTaskId: body.taskId } : {}),
        providerStatus,
        ...(activeHealthKey ? { providerHealthKey: activeHealthKey } : {}),
        providerOverride: effectiveProvider,
        modelAssignmentOverride: effectiveModels,
      })
      return c.json({
        status: run.status,
        mode: run.mode,
        startedAt: run.startedAt,
        ...(run.stopSummary ? { stopSummary: run.stopSummary } : {}),
        provider: effectiveProvider,
        providerStatus: run.providerStatus,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/stop', async c => {
    try {
      const stopped = await supervisor.stop(project.id, { waitMs: 1_000 })
      return c.json({ ok: true, status: stopped ? 'stopped' : 'stopping' })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/intake', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const body = await c.req.json().catch(() => ({})) as {
        ask?: string
        domain?: string
        title?: string
      }
      if (!body.ask || body.ask.trim().length === 0) {
        return c.json({ error: 'Missing "ask" in request body' }, 400)
      }
      const coordinators = project.config?.coordinators ?? []
      const defaultDomain = coordinators[0]?.domain
      const domain = body.domain ?? defaultDomain
      if (!domain) {
        return c.json({ error: 'Guildhall has not inferred repo structure here yet — run repo inspection first' }, 400)
      }
      const result = await createExploringTask({
        memoryDir: getProjectStateDir(project.path),
        ask: body.ask,
        domain,
        projectPath: resolveTaskPathForDomain(project, domain),
        ...(body.title ? { title: body.title } : {}),
      })
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/request', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const body = await c.req.json().catch(() => ({})) as {
        ask?: string
        domain?: string
        title?: string
      }
      if (!body.ask || body.ask.trim().length === 0) {
        return c.json({ error: 'Missing "ask" in request body' }, 400)
      }
      const coordinators = project.config?.coordinators ?? []
      const defaultDomain = coordinators[0]?.domain
      const domain = body.domain ?? defaultDomain
      if (!domain) {
        return c.json({ error: 'Guildhall has not inferred repo structure here yet — run repo inspection first' }, 400)
      }
      const result = await createRoutedRequest({
        memoryDir: getProjectStateDir(project.path),
        ask: body.ask,
        domain,
        projectPath: resolveTaskPathForDomain(project, domain),
        ...(body.title ? { title: body.title } : {}),
      })
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/project-check-in', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const memoryDir = getProjectStateDir(project.path)
      const existing = listPressureTestIntakes(memoryDir)
      const active = existing.find(intake => intake.status === 'active')
      if (active) return c.json({ intake: active, existing: true })
      if (existing.length > 0) {
        return c.json({
          skipped: true,
          projectCheckIn: summarizeProjectCheckIn(memoryDir),
        })
      }
      const title = `${project.config?.name ?? project.id} project check-in`
      const intake = await createPressureTestIntake({
        memoryDir,
        target: {
          type: 'project',
          id: `${project.id}-project-check-in`,
          title,
        },
        rawRequest: `Start a project check-in for ${project.config?.name ?? project.id}.`,
      })
      return c.json({ intake, projectCheckIn: summarizeProjectCheckIn(memoryDir) })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/pressure-test/:id', async c => {
    try {
      const intake = await loadPressureTestIntake({
        memoryDir: getProjectStateDir(project.path),
        intakeId: c.req.param('id'),
      })
      return c.json({ intake })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/pressure-test/:id/answer', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as {
        questionId?: string
        answer?: string
      }
      const questionId = body.questionId?.trim()
      const answer = body.answer?.trim()
      if (!questionId || !answer) {
        return c.json({ error: 'Question and answer are required.' }, 400)
      }
      const intake = await answerPressureTestQuestion({
        memoryDir: getProjectStateDir(project.path),
        intakeId: c.req.param('id'),
        questionId,
        answer,
      })
      return c.json({ intake })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/bug-report', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const body = await c.req.json().catch(() => ({})) as {
        title?: string
        body?: string
        stackTrace?: string
        env?: Record<string, string>
        domain?: string
        priority?: 'low' | 'normal' | 'high' | 'critical'
      }
      if (!body.title || body.title.trim().length === 0) {
        return c.json({ error: 'Missing "title" in request body' }, 400)
      }
      if (!body.body || body.body.trim().length === 0) {
        return c.json({ error: 'Missing "body" in request body' }, 400)
      }
      const coordinators = project.config?.coordinators ?? []
      if (coordinators.length === 0) {
        return c.json({ error: 'Guildhall has not inferred repo structure here yet — run repo inspection first' }, 400)
      }
      // Route by stack-trace top file when the reporter didn't pick a domain:
      // match the first frame's file path against each coordinator's `path`,
      // falling through to the first coordinator if nothing hits.
      let domain = body.domain
      if (!domain && body.stackTrace) {
        const topFile = parseStackTraceTopFile(body.stackTrace)
        if (topFile) {
          const match = coordinators.find(c => c.path && topFile.includes(c.path))
          if (match) domain = match.domain
        }
      }
      domain = domain ?? coordinators[0]!.domain
      const result = await createBugReportTask({
        memoryDir: getProjectStateDir(project.path),
        projectPath: resolveTaskPathForDomain(project, domain),
        title: body.title,
        body: body.body,
        ...(body.stackTrace ? { stackTrace: body.stackTrace } : {}),
        ...(body.env ? { env: body.env } : {}),
        domain,
        ...(body.priority ? { priority: body.priority } : {}),
      })
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/meta-intake', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const result = await createMetaIntakeTask({
        memoryDir: getProjectStateDir(project.path),
        projectPath: project.path,
      })
      return c.json(result)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/meta-intake/rerun', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const result = await rerunMetaIntakeTask({
        memoryDir: getProjectStateDir(project.path),
        projectPath: project.path,
      })
      return c.json({ ok: true, ...result })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/needs-meta-intake', c => {
    try {
      if (project.initializationNeeded) return c.json({ needsMetaIntake: true })
      return c.json({ needsMetaIntake: workspaceNeedsMetaIntake(project.path) })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // Bootstrap status + manual re-run. Read-only GET is cheap; POST runs the
  // verified commands synchronously and returns the fresh status. Both gate
  // on `project.config.bootstrap` being present — absent means meta-intake
  // hasn't established a bootstrap yet.
  // -------------------------------------------------------------------------
  app.get('/api/project/bootstrap/status', c => {
    try {
      const workspaceProjects = (project.config?.projects ?? []).map((child) => ({
        id: child.id,
        label: child.label ?? child.id,
        path: child.path,
        bootstrap: child.bootstrap
          ? {
              commands: child.bootstrap.commands ?? [],
              successGates: child.bootstrap.successGates ?? [],
              timeoutMs: child.bootstrap.timeoutMs,
            }
          : null,
      }))
      if (project.initializationNeeded) {
        return c.json({ configured: false, needed: false, status: null, workspaceProjects })
      }
      const bootstrap = project.config?.bootstrap
      if (!bootstrap || bootstrap.commands.length === 0) {
        return c.json({ configured: false, needed: false, status: null, workspaceProjects })
      }
      const memoryDir = getProjectStateDir(project.path)
      const status = readBootstrapStatus(memoryDir)
      const needed = bootstrapNeeded(
        memoryDir,
        project.path,
        bootstrap.commands,
        bootstrap.successGates,
      )
      return c.json({
        configured: true,
        needed,
        status,
        bootstrap: {
          commands: bootstrap.commands,
          successGates: bootstrap.successGates,
          timeoutMs: bootstrap.timeoutMs,
          provenance: bootstrap.provenance ?? null,
        },
        workspaceProjects,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/bootstrap/run', c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const bootstrap = project.config?.bootstrap
      const memoryDir = getProjectStateDir(project.path)

      // Legacy path: run the array-based commands from guildhall.yaml when
      // present. Fall through to detection-based bootstrap otherwise so
      // workspaces without a pre-authored bootstrap block still get the
      // environment verified (detect package manager, install, probe gates).
      if (bootstrap && bootstrap.commands.length > 0) {
        const result = runBootstrap({
          projectPath: project.path,
          memoryDir,
          commands: bootstrap.commands,
          successGates: bootstrap.successGates,
          timeoutMs: bootstrap.timeoutMs,
        })
        const status = readBootstrapStatus(memoryDir)
        return c.json({ success: result.success, status })
      }

      const detected = runDetectedBootstrap(project.path)
      writeBootstrapResult(project.path, detected)
      return c.json({
        success: detected.ok,
        detected: detected.bootstrap,
        logs: detected.logs,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  async function renderCodebaseMapStatus(projectPath: string) {
    const memoryDir = getProjectStateDir(projectPath)
    const [map, stale] = await Promise.all([
      loadCodebaseMap(memoryDir),
      loadCodebaseMapStaleState(memoryDir),
    ])
    return {
      configured: Boolean(map),
      generatedAt: map?.generatedAt ?? null,
      stale,
      counts: {
        files: map ? Object.keys(map.files).length : 0,
        areas: map?.areas.length ?? 0,
        abstractions: map?.abstractions.length ?? 0,
      },
      project: map
        ? {
            summary: map.project.summary,
            languages: map.project.languages,
            packageManagers: map.project.packageManagers,
            primaryFrameworks: map.project.primaryFrameworks,
          }
        : null,
      entrypoints: map?.entrypoints.slice(0, 8) ?? [],
      areas: map?.areas.slice(0, 6).map(area => ({
        id: area.id,
        title: area.title,
        summary: area.summary,
        owns: area.owns.slice(0, 4),
        canonicalFiles: area.canonicalFiles.slice(0, 5),
        conventions: area.conventions.slice(0, 4),
        tests: area.tests.slice(0, 4),
      })) ?? [],
      abstractions: map?.abstractions.slice(0, 8).map(abstraction => ({
        id: abstraction.id,
        title: abstraction.title,
        kind: abstraction.kind,
        canonicalPath: abstraction.canonicalPath,
        useWhen: abstraction.useWhen.slice(0, 3),
        avoid: abstraction.avoid.slice(0, 3),
        related: abstraction.related.slice(0, 5),
      })) ?? [],
      designSystem: map?.designSystem
        ? {
            maturity: map.designSystem.maturity,
            approved: map.designSystem.approved,
            tokenCounts: map.designSystem.tokenCounts,
            primitives: map.designSystem.primitives.length,
            tokenSamples: map.designSystem.tokenSamples.slice(0, 8),
            componentFiles: map.designSystem.componentFiles.slice(0, 8),
            recommendations: map.designSystem.recommendations,
          }
        : null,
      semantic: map?.semantic
        ? {
            modelId: map.semantic.modelId,
            corpusKind: map.semantic.corpusKind,
            confidence: map.semantic.confidence,
            projectPurpose: map.semantic.projectPurpose,
            currentTruth: map.semantic.currentTruth.slice(0, 6),
            architectureAreas: map.semantic.architectureAreas.slice(0, 6),
            canonicalAbstractions: map.semantic.canonicalAbstractions.slice(0, 6),
            gapsOrRisks: map.semantic.gapsOrRisks.slice(0, 6),
            readNext: map.semantic.readNext.slice(0, 4),
            workerGuidance: map.semantic.workerGuidance.slice(0, 4),
            needsBroaderRead: map.semantic.needsBroaderRead,
          }
        : null,
      frameworks: map?.project.primaryFrameworks ?? [],
      packageManagers: map?.project.packageManagers ?? [],
    }
  }

  app.get('/api/project/codebase-map/status', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ configured: false, generatedAt: null, stale: null })
      }
      return c.json(await renderCodebaseMapStatus(project.path))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/codebase-map/refresh', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const result = await refreshCodebaseMap({
        projectRoot: project.path,
        memoryDir: getProjectStateDir(project.path),
        reason: 'manual',
      })
      return c.json({
        ok: true,
        mode: result.mode,
        changedFiles: result.changedFiles.length,
        removedFiles: result.removedFiles.length,
        affectedAreas: result.affectedAreas,
        affectedAbstractions: result.affectedAbstractions,
        status: await renderCodebaseMapStatus(project.path),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/meta-intake/draft', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ status: 'uninitialized', taskExists: false, specReady: false, drafts: [] })
      }
      const tasksPath = join(getProjectStateDir(project.path), 'TASKS.json')
      if (!existsSync(tasksPath)) {
        return c.json({ status: 'no-task', taskExists: false, specReady: false, drafts: [] })
      }
      const raw = await fsp.readFile(tasksPath, 'utf-8')
      const parsed = JSON.parse(raw) as { tasks?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
      const tasks = Array.isArray(parsed) ? parsed : parsed.tasks ?? []
      const task = tasks.find(t => (t as { id?: string }).id === META_INTAKE_TASK_ID) as
        | { spec?: string; status?: string }
        | undefined
      if (!task) {
        return c.json({ status: 'no-task', taskExists: false, specReady: false, drafts: [] })
      }
      const spec = typeof task.spec === 'string' ? task.spec : ''
      if (spec.trim().length === 0) {
        return c.json({
          status: task.status === 'done' ? 'approved' : 'in-progress',
          taskExists: true,
          specReady: false,
          taskStatus: task.status ?? null,
          drafts: [],
        })
      }
      const drafts = parseCoordinatorDraft(spec) ?? []
      return c.json({
        status: task.status === 'done' ? 'approved' : drafts.length > 0 ? 'draft-ready' : 'spec-but-no-fence',
        taskExists: true,
        specReady: drafts.length > 0,
        taskStatus: task.status ?? null,
        drafts,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/meta-intake/approve', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const memoryDir = getProjectStateDir(project.path)
      const result = await approveMetaIntake({
        workspacePath: project.path,
        memoryDir,
      })
      if (!result.success) {
        return c.json({ error: result.error ?? 'Approval failed' }, 400)
      }
      // Re-resolve so subsequent GETs reflect the newly-added coordinators.
      refreshProject(project.path)

      // Bootstrap the environment eagerly so the user doesn't have to hunt
      // for a separate "Configure" action. Skip install (slow, needs real
      // network) — that still runs on the first explicit Configure press or
      // on first dispatch. Gate-resolution + structural detection here is
      // cheap and lets the orchestrator unblock on its own.
      let autoBootstrap: { success: boolean; packageManager?: string } | null = null
      try {
        const detected = runDetectedBootstrap(project.path, { skipInstall: true })
        writeBootstrapResult(project.path, detected)
        autoBootstrap = { success: detected.ok, packageManager: detected.bootstrap.packageManager }
      } catch {
        autoBootstrap = { success: false }
      }

      // FR-34: now that coordinators exist, check whether the workspace has
      // existing artifacts worth importing into TASKS.json. The lever
      // (`workspace_import_autonomy`) gates this — default 'suggest' seeds
      // the reserved task but waits for human approval.
      const importOutcome = await maybeSeedWorkspaceImport({
        memoryDir,
        projectPath: project.path,
      })

      return c.json({
        ok: true,
        coordinatorsAdded: result.coordinatorsAdded ?? 0,
        autoBootstrap,
        workspaceImport: {
          outcome: importOutcome.outcome,
          seeded: importOutcome.seeded,
          leverPosition: importOutcome.leverPosition,
          draftPreview: {
            goals: importOutcome.draft.goals.length,
            tasks: importOutcome.draft.tasks.length,
            milestones: importOutcome.draft.milestones.length,
          },
        },
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/meta-intake/synthesize', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const result = await synthesizeMetaIntakeDraft({
        workspacePath: project.path,
        memoryDir: getProjectStateDir(project.path),
      })
      if (!result.success) {
        return c.json({ error: result.error ?? 'Could not synthesize meta-intake draft' }, 400)
      }
      return c.json({ ok: true, drafts: result.drafts ?? [] })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // FR-34 workspace import — status / draft preview / approval.
  // -------------------------------------------------------------------------
  app.get('/api/project/workspace-import/status', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({
          needed: false,
          seeded: false,
          taskStatus: null,
          draft: { goals: 0, tasks: 0, milestones: 0 },
        })
      }
      const memoryDir = getProjectStateDir(project.path)
      const need = await workspaceNeedsImport({
        memoryDir,
        projectPath: project.path,
      })

      // Lever read — mirror the defaulting rule in maybeSeedWorkspaceImport.
      let leverPosition: 'off' | 'suggest' | 'apply' = 'suggest'
      try {
        const settings = await loadLeverSettings({
          path: defaultAgentSettingsPath(project.path),
        })
        const pos = settings.project['workspace_import_autonomy']?.position
        if (pos === 'off' || pos === 'suggest' || pos === 'apply') {
          leverPosition = pos
        }
      } catch {}

      // Is there a reserved task?
      const tasksPath = join(memoryDir, 'TASKS.json')
      let taskStatus: string | null = null
      let specPresent = false
      let parsedSpecDraft: ReturnType<typeof parseWorkspaceImport> | null = null
      if (existsSync(tasksPath)) {
        const raw = JSON.parse(await fsp.readFile(tasksPath, 'utf-8')) as
          | { tasks?: Array<Record<string, unknown>> }
          | Array<Record<string, unknown>>
        const list = Array.isArray(raw) ? raw : raw.tasks ?? []
        const task = list.find(
          t => (t as { id?: string }).id === WORKSPACE_IMPORT_TASK_ID,
        ) as { status?: string; spec?: string } | undefined
        if (task) {
          taskStatus = task.status ?? null
          specPresent =
            typeof task.spec === 'string' && task.spec.trim().length > 0
          if (specPresent && typeof task.spec === 'string') {
            parsedSpecDraft = parseWorkspaceImport(task.spec)
          }
        }
      }

      return c.json({
        needed: need.needed,
        seeded: taskStatus !== null,
        taskStatus,
        specPresent,
        leverPosition,
        draft: {
          goals: parsedSpecDraft?.goals.length ?? need.draft.goals.length,
          tasks: parsedSpecDraft?.tasks.length ?? need.draft.tasks.length,
          milestones: parsedSpecDraft?.milestones.length ?? need.draft.milestones.length,
        },
        inventory: {
          ran: need.inventory.ran,
          signals: need.inventory.signals.length,
          failed: need.inventory.failed,
        },
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/workspace-import', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const memoryDir = getProjectStateDir(project.path)
      const res = await maybeSeedWorkspaceImport({
        memoryDir,
        projectPath: project.path,
      })
      return c.json({
        seeded: res.seeded,
        outcome: res.outcome,
        leverPosition: res.leverPosition,
        draft: {
          goals: res.draft.goals.length,
          tasks: res.draft.tasks.length,
          milestones: res.draft.milestones.length,
        },
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/workspace-import/rerun', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const memoryDir = getProjectStateDir(project.path)
      const result = await rerunWorkspaceImportTask({
        memoryDir,
        projectPath: project.path,
      })
      return c.json({
        ok: true,
        seeded: true,
        outcome: result.alreadyExists ? 'reseeded' : 'seeded',
        draft: {
          goals: result.draft.goals.length,
          tasks: result.draft.tasks.length,
          milestones: result.draft.milestones.length,
          context: result.draft.context.length,
          stats: result.draft.stats,
        },
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/workspace-import/draft', async c => {
    try {
      // The same cheap anchor check the inbox chip uses, echoed back so the
      // Workspace Import tab can say "anchors present but nothing extracted"
      // when the semantic detector returns empty — which otherwise produces
      // the contradictory "Found 5 signals ... click Review ... No signals
      // detected" UX.
      const anchors = detectRepoAnchors(project.path)
      if (project.initializationNeeded) {
        return c.json({
          taskExists: false,
          specReady: false,
          parsed: null,
          detected: null,
          dismissed: false,
          anchors,
        })
      }
      const memoryDir = getProjectStateDir(project.path)
      // Dismissed state — surface it so the UI can show an "undo" affordance
      // instead of re-running the scan silently.
      let dismissed = false
      try {
        const goalsPath = join(memoryDir, 'workspace-goals.json')
        if (existsSync(goalsPath)) {
          const g = JSON.parse(await fsp.readFile(goalsPath, 'utf-8')) as {
            dismissed?: boolean
          }
          dismissed = Boolean(g.dismissed)
        }
      } catch {
        /* treat as not-dismissed */
      }

      let existingTasks: Array<{ title: string; status: string }> = []
      const tasksPath = join(memoryDir, 'TASKS.json')
      if (existsSync(tasksPath)) {
        try {
          const raw = JSON.parse(await fsp.readFile(tasksPath, 'utf-8')) as
            | { tasks?: Array<Record<string, unknown>> }
            | Array<Record<string, unknown>>
          const list = Array.isArray(raw) ? raw : raw.tasks ?? []
          existingTasks = list
            .filter(t => (t as { id?: string }).id !== WORKSPACE_IMPORT_TASK_ID)
            .map(t => ({
              title: typeof (t as { title?: unknown }).title === 'string' ? (t as { title: string }).title : '',
              status: typeof (t as { status?: unknown }).status === 'string' ? (t as { status: string }).status : 'unknown',
            }))
            .filter(t => t.title.trim().length > 0)
        } catch {
          existingTasks = []
        }
      }

      // Deterministic detector preview — runs regardless of whether the
      // agent has populated the task spec yet. This is what the UI shows
      // first: real findings the user can Approve or Dismiss *now*.
      let detected: {
        goals: unknown[]
        tasks: unknown[]
        milestones: unknown[]
        context: unknown[]
        stats: { inputSignals: number; drafted: number; deduped: number }
        review?: unknown
        learning?: unknown
      } | null = null
      try {
        const inventory = await detectWorkspaceSignals({ projectPath: project.path })
        const draft = formWorkspaceHypothesis(inventory)
        const review = buildWorkspaceImportReview(draft, existingTasks, projectPath)
        detected = {
          goals: [...draft.goals],
          tasks: [...draft.tasks],
          milestones: [...draft.milestones],
          context: [...draft.context],
          stats: draft.stats,
          review,
          learning: buildLearningSnapshot({
            memoryDir,
            review,
            draft,
          }).effective,
        }
      } catch {
        /* detector best-effort */
      }
      if (!existsSync(tasksPath)) {
        return c.json({
          taskExists: false,
          specReady: false,
          parsed: null,
          detected,
          dismissed,
          anchors,
        })
      }
      const raw = JSON.parse(await fsp.readFile(tasksPath, 'utf-8')) as
        | { tasks?: Array<Record<string, unknown>> }
        | Array<Record<string, unknown>>
      const list = Array.isArray(raw) ? raw : raw.tasks ?? []
      const task = list.find(
        t => (t as { id?: string }).id === WORKSPACE_IMPORT_TASK_ID,
      ) as { spec?: string; status?: string } | undefined
      if (!task) {
        return c.json({
          taskExists: false,
          specReady: false,
          parsed: null,
          detected,
          dismissed,
          anchors,
        })
      }
      const spec = typeof task.spec === 'string' ? task.spec : ''
      if (spec.trim().length === 0) {
        return c.json({
          taskExists: true,
          specReady: false,
          taskStatus: task.status ?? null,
          parsed: null,
          detected,
          dismissed,
          anchors,
        })
      }
      const parsed = parseWorkspaceImport(spec)
      const specReady =
        parsed.goals.length + parsed.tasks.length + parsed.milestones.length > 0
      return c.json({
        taskExists: true,
        specReady,
        taskStatus: task.status ?? null,
        parsed,
        detected,
        dismissed,
        anchors,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/workspace-import/approve', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const memoryDir = getProjectStateDir(project.path)
      const body = await c.req.json().catch(() => ({})) as {
        areaKeys?: string[]
        sourceKeys?: string[]
        taskIds?: string[]
      }
      let importerTaskHasSpec = false

      // Fallback: if the reserved task is missing or has no agent-authored
      // spec yet, create the task (idempotent) and seed the spec from the
      // deterministic detector output. This lets the user Approve immediately
      // without waiting on the workspace-importer agent, and is safe because
      // the detector draft uses the same YAML fence format the agent would
      // have produced.
      try {
        const tasksPath = join(memoryDir, 'TASKS.json')
        const raw = existsSync(tasksPath)
          ? (JSON.parse(await fsp.readFile(tasksPath, 'utf-8')) as
              | Array<Record<string, unknown>>
              | { tasks?: Array<Record<string, unknown>> })
          : { tasks: [] as Array<Record<string, unknown>> }
        const list = Array.isArray(raw) ? raw : raw.tasks ?? []
        let idx = list.findIndex(
          (t) => (t as { id?: string }).id === WORKSPACE_IMPORT_TASK_ID,
        )
        // Ensure the reserved task exists. createWorkspaceImportTask is
        // idempotent and seeds the exploring transcript.
        if (idx < 0) {
          await createWorkspaceImportTask({
            memoryDir,
            projectPath: project.path,
          })
          // Re-read after creation.
          const raw2 = JSON.parse(await fsp.readFile(tasksPath, 'utf-8')) as
            | Array<Record<string, unknown>>
            | { tasks?: Array<Record<string, unknown>> }
          const list2 = Array.isArray(raw2) ? raw2 : raw2.tasks ?? []
          idx = list2.findIndex(
            (t) => (t as { id?: string }).id === WORKSPACE_IMPORT_TASK_ID,
          )
          if (idx >= 0) {
            const task = list2[idx] as { spec?: string }
            const inventory = await detectWorkspaceSignals({ projectPath: project.path })
            const draft = formWorkspaceHypothesis(inventory)
            const spec = formatDetectedDraftAsSpec(draft)
            if (spec) {
              task.spec = spec
              const next = Array.isArray(raw2) ? list2 : { ...raw2, tasks: list2 }
              await fsp.writeFile(tasksPath, JSON.stringify(next, null, 2), 'utf-8')
            }
          }
        } else {
          const task = list[idx] as { spec?: string }
          const specEmpty = !task.spec || task.spec.trim().length === 0
          importerTaskHasSpec = !specEmpty
          if (specEmpty) {
            const inventory = await detectWorkspaceSignals({ projectPath: project.path })
            const draft = formWorkspaceHypothesis(inventory)
            const spec = formatDetectedDraftAsSpec(draft)
            if (spec) {
              task.spec = spec
              const next = Array.isArray(raw) ? list : { ...raw, tasks: list }
              await fsp.writeFile(tasksPath, JSON.stringify(next, null, 2), 'utf-8')
              importerTaskHasSpec = true
            }
          }
        }
      } catch (e) {
        // Surface the underlying problem instead of swallowing it — the user
        // would otherwise see only the generic "No workspace-import task" from
        // approveWorkspaceImport, which hides the real failure.
        return c.json(
          { error: `Could not prepare workspace-import task: ${e instanceof Error ? e.message : String(e)}` },
          500,
        )
      }

      const inventory = await detectWorkspaceSignals({ projectPath: project.path })
      const fullDraft = formWorkspaceHypothesis(inventory)
      const review = buildWorkspaceImportReview(fullDraft, [], project.path)
      const hasExplicitNarrowing =
        Array.isArray(body.areaKeys) ||
        Array.isArray(body.sourceKeys) ||
        Array.isArray(body.taskIds)
      const selectedSourceKeys = Array.isArray(body.sourceKeys)
        ? body.sourceKeys
        : review.sourceGroups.filter(group => group.taskCount > 0).map(group => group.key)
      const selectedAreaKeys = Array.isArray(body.areaKeys)
        ? body.areaKeys
        : review.areaGroups
            .filter(area =>
              review.sourceGroups.some(
                group => selectedSourceKeys.includes(group.key) && group.areaKey === area.key,
              ),
            )
            .map(area => area.key)
      const selectedTaskIds = Array.isArray(body.taskIds)
        ? body.taskIds
        : fullDraft.tasks.map(task => task.suggestedId)
      const filteredDraft = filterWorkspaceImportDraft(fullDraft, {
        sourceKeys: selectedSourceKeys,
        taskIds: selectedTaskIds,
      })

      const result = await approveWorkspaceImport({
        memoryDir,
        projectPath: project.path,
        coordinatorProjectPaths: buildCoordinatorProjectPathMap(
          project.path,
          project.config?.coordinators ?? [],
          project.config?.projects ?? [],
        ),
        ...(!hasExplicitNarrowing && importerTaskHasSpec
          ? {}
          : { draftOverride: filteredDraft }),
      })
      if (!result.success) {
        return c.json({ error: result.error ?? 'Approval failed' }, 400)
      }
      await recordWorkspaceImportApproval({
        memoryDir,
        review,
        draft: fullDraft,
        selectedAreaKeys,
        selectedSourceKeys,
        selectedTaskIds,
      })
      recordReconciliationResolved(project.path)
      return c.json({
        ok: true,
        tasksAdded: result.tasksAdded ?? 0,
        goalsRecorded: result.goalsRecorded ?? 0,
        milestonesLogged: result.milestonesLogged ?? 0,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // Coordinator inbox — prioritized list of things the human must resolve
  // for the coordinator to make progress. Source of truth is on-disk state
  // (guildhall.yaml, TASKS.json, agent-settings.yaml, workspace-goals.json).
  // -------------------------------------------------------------------------
  // Aggregated "project facts" view — everything the agent knows about the
  // workspace, collected from on-disk state. Read-only; each section has an
  // `editHref` pointing at the canonical place to change it.
  app.get('/api/project/facts', async c => {
    try {
      if (project.initializationNeeded) return c.json({ initializationNeeded: true })
      const memoryDir = getProjectStateDir(project.path)
      const cfg = project.config

      // Bootstrap block from guildhall.yaml (structural form).
      const b = (cfg?.bootstrap ?? null) as
        | {
            verifiedAt?: string
            packageManager?: string
            install?: { command?: string; status?: string; lastRunAt?: string } | string[]
            gates?: Record<string, { command?: string; available?: boolean; unavailableReason?: string }>
          }
        | null

      // Design system summary.
      let designSummary: string | null = null
      try {
        const ds = await loadDesignSystem(memoryDir)
        if (ds) designSummary = summarizeDesignSystem(ds)
      } catch {
        /* leave null */
      }

      // Workspace goals file (imported or dismissed state).
      const goalsPath = join(memoryDir, 'workspace-goals.json')
      let workspaceGoals:
        | { imported: boolean; dismissed: boolean; goalCount: number; taskCount: number; milestoneCount: number }
        | null = null
      if (existsSync(goalsPath)) {
        try {
          const raw = JSON.parse(readFileSync(goalsPath, 'utf8')) as Record<string, unknown>
          if ((raw as { dismissed?: boolean }).dismissed) {
            workspaceGoals = { imported: false, dismissed: true, goalCount: 0, taskCount: 0, milestoneCount: 0 }
          } else {
            const goals = Array.isArray(raw.goals) ? (raw.goals as unknown[]).length : 0
            const tasks = Array.isArray(raw.tasks) ? (raw.tasks as unknown[]).length : 0
            const milestones = Array.isArray(raw.milestones) ? (raw.milestones as unknown[]).length : 0
            workspaceGoals = {
              imported: true,
              dismissed: false,
              goalCount: goals,
              taskCount: tasks,
              milestoneCount: milestones,
            }
          }
        } catch {
          /* leave null */
        }
      }
      const tasksPath = join(memoryDir, 'TASKS.json')
      if (existsSync(tasksPath)) {
        try {
          const raw = JSON.parse(readFileSync(tasksPath, 'utf8')) as
            | { tasks?: Array<Record<string, unknown>> }
            | Array<Record<string, unknown>>
          const list = Array.isArray(raw) ? raw : raw.tasks ?? []
          const importTask = list.find(t => (t as { id?: string }).id === WORKSPACE_IMPORT_TASK_ID) as
            | { status?: string; spec?: string }
            | undefined
          const spec = typeof importTask?.spec === 'string' ? importTask.spec : ''
          if (importTask && spec.trim().length > 0 && importTask.status !== 'shelved') {
            const parsed = parseWorkspaceImport(spec)
            const parsedCounts = {
              goalCount: parsed.goals.length,
              taskCount: parsed.tasks.length,
              milestoneCount: parsed.milestones.length,
            }
            workspaceGoals = {
              imported: true,
              dismissed: false,
              goalCount: Math.max(workspaceGoals?.goalCount ?? 0, parsedCounts.goalCount),
              taskCount: Math.max(workspaceGoals?.taskCount ?? 0, parsedCounts.taskCount),
              milestoneCount: Math.max(workspaceGoals?.milestoneCount ?? 0, parsedCounts.milestoneCount),
            }
          }
        } catch {
          /* leave workspaceGoals as-is */
        }
      }

      return c.json({
        identity: {
          name: cfg?.name ?? project.id,
          id: project.id,
          path: project.path,
          editHref: '/settings/advanced',
        },
        environment: {
          packageManagers: detectProjectPackageManagers(project.path),
          verifiedAt: typeof b?.verifiedAt === 'string' ? b.verifiedAt : null,
          install: b?.install ?? null,
          gates: b?.gates ?? null,
          editHref: '/settings',
        },
        workspace: {
          goals: workspaceGoals,
          reviewHref: `/projects/${encodeURIComponent(project.id)}/workspace-import`,
        },
        coordinators: {
          count: cfg?.coordinators?.length ?? 0,
          list: (cfg?.coordinators ?? []).map(c => ({ id: c.id, ...(c.domain ? { domain: c.domain } : {}) })),
          editHref: '/settings/routing',
        },
        designSystem: {
          summary: designSummary,
          editHref: '/settings',
        },
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // Dismiss the workspace-import review. Writes a `dismissed: true` marker
  // into memory/workspace-goals.json so the Inbox item stops appearing;
  // findings stay reachable via /workspace-import for later review.
  app.post('/api/project/workspace-import/dismiss', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const memoryDir = getProjectStateDir(project.path)
      await fsp.mkdir(memoryDir, { recursive: true })
      const goalsPath = join(memoryDir, 'workspace-goals.json')
      await fsp.writeFile(
        goalsPath,
        JSON.stringify({ dismissed: true, dismissedAt: new Date().toISOString() }, null, 2),
        'utf-8',
      )
      await recordWorkspaceImportDismissal(memoryDir)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/attention/dismiss', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const id = c.req.query('id')?.trim()
      if (!id) return c.json({ error: 'id is required' }, 400)
      const record = markAttentionDismissed(project.path, id)
      if (!record) return c.json({ error: 'attention item not found' }, 404)
      return c.json({ ok: true, record })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  async function fileSummary(filePath: string): Promise<{ present: boolean; nonEmptyLines: number }> {
    if (!existsSync(filePath)) return { present: false, nonEmptyLines: 0 }
    try {
      const raw = await fsp.readFile(filePath, 'utf-8')
      const nonEmptyLines = raw
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !/^#\s/.test(line) && !/^_Updated by GuildHall agents\._$/i.test(line))
        .length
      return { present: true, nonEmptyLines }
    } catch {
      return { present: true, nonEmptyLines: 0 }
    }
  }

  async function buildProjectContextSummary(memoryDir: string): Promise<{
    projectBrief: { present: boolean; nonEmptyLines: number }
    projectNotes: { present: boolean; nonEmptyLines: number }
    decisions: { present: boolean; nonEmptyLines: number }
    workspaceGoals: { present: boolean; goalCount: number }
  }> {
    const [projectBrief, projectNotes, decisions] = await Promise.all([
      fileSummary(join(memoryDir, 'project-brief.md')),
      fileSummary(join(memoryDir, 'MEMORY.md')),
      fileSummary(join(memoryDir, 'DECISIONS.md')),
    ])
    let workspaceGoals = { present: false, goalCount: 0 }
    const goalsPath = join(memoryDir, 'workspace-goals.json')
    if (existsSync(goalsPath)) {
      try {
        const raw = JSON.parse(await fsp.readFile(goalsPath, 'utf-8')) as { goals?: unknown[] }
        workspaceGoals = { present: true, goalCount: Array.isArray(raw.goals) ? raw.goals.length : 0 }
      } catch {
        workspaceGoals = { present: true, goalCount: 0 }
      }
    }
    return { projectBrief, projectNotes, decisions, workspaceGoals }
  }

  app.get('/api/project/learning', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({
          project: null,
          user: null,
          effective: null,
          projectContext: null,
        })
      }
      const memoryDir = getProjectStateDir(project.path)
      const inventory = await detectWorkspaceSignals({ projectPath: project.path })
      const draft = formWorkspaceHypothesis(inventory)
      const tasksPath = join(memoryDir, 'TASKS.json')
      let existingTasks: Array<{ title: string; status: string }> = []
      if (existsSync(tasksPath)) {
        try {
          const raw = JSON.parse(await fsp.readFile(tasksPath, 'utf-8')) as
            | { tasks?: Array<Record<string, unknown>> }
            | Array<Record<string, unknown>>
          const list = Array.isArray(raw) ? raw : raw.tasks ?? []
          existingTasks = list
            .filter(t => (t as { id?: string }).id !== WORKSPACE_IMPORT_TASK_ID)
            .map(t => ({
              title: typeof (t as { title?: unknown }).title === 'string' ? (t as { title: string }).title : '',
              status: typeof (t as { status?: unknown }).status === 'string' ? (t as { status: string }).status : 'unknown',
            }))
            .filter(t => t.title.trim().length > 0)
        } catch {
          existingTasks = []
        }
      }
      const review = buildWorkspaceImportReview(draft, existingTasks, project.path)
      return c.json({
        ...buildLearningSnapshot({ memoryDir, review, draft }),
        projectSkillProposals: readProjectSkillProposals(memoryDir),
        projectContext: await buildProjectContextSummary(memoryDir),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/learning/action', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const body = await c.req.json().catch(() => ({})) as {
        kind?: 'accept' | 'dismiss' | 'reset' | 'make-project-wide'
        scope?: 'project' | 'user_global'
        id?: string
      }
      const memoryDir = getProjectStateDir(project.path)
      const scope = body.scope === 'user_global' ? 'user_global' : 'project'
      if (body.kind === 'accept') {
        if (!body.id) return c.json({ error: 'id is required' }, 400)
        await acceptSuggestedLearning({ memoryDir, id: body.id, scope })
        return c.json({ ok: true, kind: body.kind, scope, id: body.id })
      }
      if (body.kind === 'dismiss') {
        if (!body.id) return c.json({ error: 'id is required' }, 400)
        await dismissSuggestedLearning({ memoryDir, id: body.id, scope })
        return c.json({ ok: true, kind: body.kind, scope, id: body.id })
      }
      if (body.kind === 'make-project-wide') {
        if (!body.id) return c.json({ error: 'id is required' }, 400)
        await makeSuggestedLearningProjectWide({ memoryDir, id: body.id })
        return c.json({ ok: true, kind: body.kind, scope: 'project', id: body.id })
      }
      if (body.kind === 'reset') {
        await resetSuggestedLearnings({ memoryDir, scope })
        return c.json({ ok: true, kind: body.kind, scope })
      }
      return c.json({ error: 'unknown learning action' }, 400)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/skill-proposals/action', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const body = await c.req.json().catch(() => ({})) as {
        kind?: 'activate' | 'dismiss' | 'reset'
        id?: string
        approved?: boolean
      }
      const memoryDir = getProjectStateDir(project.path)
      if (body.kind === 'activate') {
        if (!body.id) return c.json({ error: 'id is required' }, 400)
        await activateProjectSkillProposal({
          memoryDir,
          id: body.id,
          approved: body.approved === true,
        })
        return c.json({ ok: true, kind: body.kind, id: body.id })
      }
      if (body.kind === 'dismiss') {
        if (!body.id) return c.json({ error: 'id is required' }, 400)
        await dismissProjectSkillProposal({ memoryDir, id: body.id })
        return c.json({ ok: true, kind: body.kind, id: body.id })
      }
      if (body.kind === 'reset') {
        await resetProjectSkillProposals(memoryDir)
        return c.json({ ok: true, kind: body.kind })
      }
      return c.json({ error: 'unknown skill proposal action' }, 400)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/learning/reset', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const body = await c.req.json().catch(() => ({})) as {
        scope?: 'project' | 'all'
      }
      const scope = body.scope === 'all' ? 'all' : 'project'
      const memoryDir = getProjectStateDir(project.path)
      await resetProjectLearning(memoryDir)
      if (scope === 'all') {
        await resetGlobalLearning()
      }
      return c.json({ ok: true, scope })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/inbox', async c => {
    try {
      const inbox = await buildProjectInboxSnapshot({
        projectPath: project.path,
        initializationNeeded: project.initializationNeeded,
        coordinatorCount: project.config?.coordinators?.length ?? 0,
      })
      return c.json(inbox)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/thread', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ turns: [], activeTurnId: null, caughtUp: false })
      }
      try {
        repairStaleBlockersForProject(project.path)
      } catch {
        /* never let stale-blocker repair break a thread read */
      }
      const thread = buildThread({
        projectPath: project.path,
        runStatus: supervisor.get(project.id)?.status ?? 'stopped',
        recentEvents: supervisor.recent(project.id, undefined, project.path),
      })
      const taskIds = new Set(
        thread.turns
          .map(turn => ('taskId' in turn ? turn.taskId : null))
          .filter((id): id is string => Boolean(id)),
      )
      if (taskIds.size > 0) {
        const tasks = await readTasksFileNormalized(join(getProjectStateDir(project.path), 'TASKS.json')).catch(() => [])
        const workspaceStore = await readTaskWorkspaceStore(project.path).catch(() => undefined)
        const gitStories = new Map<string, Awaited<ReturnType<typeof gitStoryForTask>>>()
        for (const task of tasks) {
          const id = typeof task.id === 'string' ? task.id : ''
          if (!id || !taskIds.has(id)) continue
          const gitStory = await gitStoryForTask(project.path, task, workspaceStore?.workspaces[id]).catch(() => undefined)
          if (gitStory) gitStories.set(id, gitStory)
        }
        if (gitStories.size > 0) {
          thread.turns = thread.turns.map(turn => {
            if (!('taskId' in turn)) return turn
            const gitStory = gitStories.get(turn.taskId)
            return gitStory ? { ...turn, gitStory } : turn
          })
        }
      }
      return c.json(thread)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/source-note', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const requested = c.req.query('path')?.trim()
      if (!requested) return c.json({ error: 'path is required' }, 400)

      const projectRoot = resolve(project.path)
      const initialCandidate = requested.startsWith('/')
        ? resolve(requested)
        : resolve(projectRoot, requested)
      const initialRel = relative(projectRoot, initialCandidate)
      if (initialRel === '..' || initialRel.startsWith(`..${pathSeparator}`) || isAbsolute(initialRel)) {
        return c.json({ error: 'Source note path must stay inside the project.' }, 403)
      }

      const { candidate, requestedRel } = await resolveSourceNoteCandidate(projectRoot, requested)
      const rel = relative(projectRoot, candidate)
      if (rel === '..' || rel.startsWith(`..${pathSeparator}`) || isAbsolute(rel)) {
        return c.json({ error: 'Source note path must stay inside the project.' }, 403)
      }

      const stat = await fsp.stat(candidate).catch((err: unknown) => {
        if ((err as { code?: string })?.code === 'ENOENT') return null
        throw err
      })
      if (!stat) {
        const preview = await missingSourcePreview(candidate, projectRoot, requestedRel)
        return c.json({
          path: candidate,
          displayPath: requestedRel || basename(candidate),
          content: preview.content,
          truncated: preview.truncated,
          missing: true,
        })
      }
      const [realProjectRoot, realCandidate] = await Promise.all([
        fsp.realpath(projectRoot),
        fsp.realpath(candidate),
      ])
      const realRel = relative(realProjectRoot, realCandidate)
      if (realRel === '..' || realRel.startsWith(`..${pathSeparator}`) || isAbsolute(realRel)) {
        return c.json({ error: 'Source note path must stay inside the project.' }, 403)
      }
      if (stat.isDirectory()) {
        const preview = await directorySourcePreview(candidate, projectRoot, requestedRel)
        return c.json({
          path: candidate,
          displayPath: realRel || rel || basename(candidate),
          content: preview.content,
          truncated: preview.truncated,
          kind: 'directory',
        })
      }
      if (!stat.isFile()) return c.json({ error: 'Source note not found.' }, 404)

      const maxChars = 96_000
      const raw = await fsp.readFile(candidate, 'utf8')
      const truncated = raw.length > maxChars
      return c.json({
        path: candidate,
        displayPath: realRel || rel || basename(candidate),
        content: markdownForFile(truncated ? raw.slice(0, maxChars) : raw, realRel || rel || basename(candidate)),
        truncated,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // Wizards — resumable guided checklists (onboard, spec-fill, release, ...).
  // Progress is derived from on-disk facts; wizards.yaml persists only skip
  // markers + completedAt stamps. See src/runtime/wizards.ts.
  //
  // GET  /api/project/wizards                     → all applicable wizards
  // POST /api/project/wizards/:id/skip            → { stepId }
  // POST /api/project/wizards/:id/unskip          → { stepId }
  // -------------------------------------------------------------------------
  app.get('/api/project/wizards', c => {
    try {
      if (project.initializationNeeded) return c.json({ wizards: [] })
      const snap = buildSnapshot({ projectPath: project.path })
      const wizards = listWizards()
        .filter(w => w.applicable(snap))
        .map(w => progressFor(w, snap))
      return c.json({ wizards })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/wizards/:id/skip', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const wizardId = c.req.param('id')
      const body = (await c.req.json().catch(() => ({}))) as { stepId?: string }
      const stepId = typeof body?.stepId === 'string' ? body.stepId : ''
      if (!wizardId || !stepId) return c.json({ error: 'wizardId and stepId required' }, 400)
      const wizard = listWizards().find(w => w.id === wizardId)
      if (!wizard) return c.json({ error: `unknown wizard: ${wizardId}` }, 404)
      const step = wizard.steps.find(s => s.id === stepId)
      if (!step) return c.json({ error: `unknown step: ${stepId}` }, 404)
      if (!step.skippable) return c.json({ error: `step is not skippable: ${stepId}` }, 400)
      const state = readWizardsState(project.path)
      const next = mutateSkip(state, wizardId, stepId, 'add')
      writeWizardsState(project.path, next)
      return c.json({ ok: true, state: next })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/wizards/:id/unskip', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const wizardId = c.req.param('id')
      const body = (await c.req.json().catch(() => ({}))) as { stepId?: string }
      const stepId = typeof body?.stepId === 'string' ? body.stepId : ''
      if (!wizardId || !stepId) return c.json({ error: 'wizardId and stepId required' }, 400)
      const state = readWizardsState(project.path)
      const next = mutateSkip(state, wizardId, stepId, 'remove')
      writeWizardsState(project.path, next)
      return c.json({ ok: true, state: next })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // Task-scoped wizards. Progress derives from the live task record, so any
  // edit (spec agent updates the brief, human approves, reviewer appends an
  // acceptance criterion) auto-flips the corresponding step to done.
  // -------------------------------------------------------------------------
  app.get('/api/project/task/:id/wizards', c => {
    try {
      if (project.initializationNeeded) return c.json({ wizards: [] })
      const tasksPath = join(getProjectStateDir(project.path), 'TASKS.json')
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const raw = JSON.parse(readFileSync(tasksPath, 'utf8')) as
        | { tasks?: Array<Record<string, unknown>> }
        | Array<Record<string, unknown>>
      const tasks = Array.isArray(raw) ? raw : raw.tasks ?? []
      const id = c.req.param('id')
      const task = tasks.find(t => (t as { id?: string }).id === id)
      if (!task) return c.json({ error: 'task not found' }, 404)
      const snap = buildTaskSnapshot({
        projectPath: project.path,
        task: task as Parameters<typeof buildTaskSnapshot>[0]['task'],
      })
      const wizards = listTaskWizards()
        .filter(w => w.applicable(snap))
        .map(w => progressForTask(w, snap))
      return c.json({ wizards })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/task/:id/wizards/:wizardId/skip', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const taskId = c.req.param('id')
      const wizardId = c.req.param('wizardId')
      const body = (await c.req.json().catch(() => ({}))) as { stepId?: string }
      const stepId = typeof body?.stepId === 'string' ? body.stepId : ''
      if (!taskId || !wizardId || !stepId) {
        return c.json({ error: 'taskId, wizardId and stepId required' }, 400)
      }
      const wizard = listTaskWizards().find(w => w.id === wizardId)
      if (!wizard) return c.json({ error: `unknown task wizard: ${wizardId}` }, 404)
      const step = wizard.steps.find(s => s.id === stepId)
      if (!step) return c.json({ error: `unknown step: ${stepId}` }, 404)
      if (!step.skippable) return c.json({ error: `step is not skippable: ${stepId}` }, 400)
      const state = readWizardsState(project.path)
      const next = mutateSkip(state, `${wizardId}:${taskId}`, stepId, 'add')
      writeWizardsState(project.path, next)
      return c.json({ ok: true, state: next })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/task/:id/wizards/:wizardId/unskip', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const taskId = c.req.param('id')
      const wizardId = c.req.param('wizardId')
      const body = (await c.req.json().catch(() => ({}))) as { stepId?: string }
      const stepId = typeof body?.stepId === 'string' ? body.stepId : ''
      if (!taskId || !wizardId || !stepId) {
        return c.json({ error: 'taskId, wizardId and stepId required' }, 400)
      }
      const state = readWizardsState(project.path)
      const next = mutateSkip(state, `${wizardId}:${taskId}`, stepId, 'remove')
      writeWizardsState(project.path, next)
      return c.json({ ok: true, state: next })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // Onboard step backers: coordinators seed + project brief.
  //
  // These endpoints exist specifically so onboard step bodies have something
  // concrete to POST to without needing a full coordinator-editor UI today.
  // The meta-intake agent remains the "agent-drafted" path; these are the
  // "I'll just pick one" path.
  // -------------------------------------------------------------------------
  app.post('/api/project/coordinators/seed', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const body = (await c.req.json().catch(() => ({}))) as {
        archetypes?: string[]
      }
      const archetypes = Array.isArray(body.archetypes) ? body.archetypes : []
      if (archetypes.length === 0) return c.json({ error: 'no archetypes selected' }, 400)

      const existing = readWorkspaceConfig(project.path)
      const existingIds = new Set((existing.coordinators ?? []).map(c => c.id))
      const seeds = archetypesToCoordinators(archetypes).filter(s => !existingIds.has(s.id))
      if (seeds.length === 0) {
        return c.json({ ok: true, added: 0, coordinators: existing.coordinators ?? [] })
      }
      const nextConfig = {
        ...existing,
        coordinators: [...(existing.coordinators ?? []), ...seeds],
      }
      writeWorkspaceConfig(project.path, nextConfig as Parameters<typeof writeWorkspaceConfig>[1])
      refreshProject(project.path)
      return c.json({ ok: true, added: seeds.length, coordinators: nextConfig.coordinators })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/brief', c => {
    try {
      if (project.initializationNeeded) return c.json({ current: '', seed: { readme: '', roadmap: [] } })
      const briefPath = join(getProjectStateDir(project.path), 'project-brief.md')
      const current = existsSync(briefPath) ? readFileSync(briefPath, 'utf8') : ''
      const readmePath = join(project.path, 'README.md')
      const roadmapPath = join(project.path, 'ROADMAP.md')
      const readmeFirstPara = existsSync(readmePath)
        ? (readFileSync(readmePath, 'utf8').split(/\n{2,}/).find(p => p.trim() && !p.trim().startsWith('#')) ?? '').trim().slice(0, 800)
        : ''
      const roadmapHeadings = existsSync(roadmapPath)
        ? readFileSync(roadmapPath, 'utf8')
            .split(/\r?\n/)
            .filter(l => /^#{1,3}\s+/.test(l))
            .map(l => l.replace(/^#{1,3}\s+/, '').trim())
            .slice(0, 12)
        : []
      return c.json({ current, seed: { readme: readmeFirstPara, roadmap: roadmapHeadings } })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/brief', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const body = (await c.req.json().catch(() => ({}))) as { content?: string }
      const content = typeof body.content === 'string' ? body.content.trim() : ''
      if (content.length < 40) return c.json({ error: 'brief must be at least 40 characters' }, 400)
      const memDir = getProjectStateDir(project.path)
      if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true })
      writeFileSync(join(memDir, 'project-brief.md'), content + '\n', 'utf8')
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/git-story', async c => {
    try {
      if (project.initializationNeeded) return c.json({ initializationNeeded: true })
      const tasks = await readTasksFileNormalized(join(getProjectStateDir(project.path), 'TASKS.json')).catch(() => [])
      return c.json(await buildProjectGitStorySummary(project.path, tasks as Array<Record<string, unknown>>))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // Per-task detail — powers the drawer. Returns the full Task plus a tiny
  // slice of related context (recent events touching this task) so the UI
  // can show "what's happening right now" without a second round-trip.
  // -------------------------------------------------------------------------
  app.get('/api/project/task/:id', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const tasksPath = join(getProjectStateDir(project.path), 'TASKS.json')
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const tasks = await readTasksFileNormalized(tasksPath)
      const id = c.req.param('id')
      const task = tasks.find(t => (t as { id?: string }).id === id)
      if (!task) return c.json({ error: 'task not found' }, 404)
      const recent = filterEventsForTask(supervisor.recent(project.id, undefined, project.path), id)
      const memoryDir = getProjectStateDir(project.path)
      const contextDebug = await readContextDebugForTask(memoryDir, id)
      const exploringTranscript = await readExploringTranscript({ memoryDir, taskId: id })
      const snapshot = buildSnapshot({ projectPath: project.path })
      const thread = buildThread({
        projectPath: project.path,
        snapshot,
        runStatus: supervisor.get(project.id)?.status ?? 'stopped',
        recentEvents: supervisor.recent(project.id, undefined, project.path),
      })
      const threadTurns = thread.turns.filter(turn => {
        if (!('taskId' in turn)) return false
        return turn.taskId === id
      })
      return c.json({
        task: await enrichTaskForServe(project.path, task as Record<string, unknown>),
        recentEvents: recent,
        contextDebug,
        exploringTranscript,
        threadTurns,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/task/:id/evidence', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const tasksPath = join(getProjectStateDir(project.path), 'TASKS.json')
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const tasks = await readTasksFileNormalized(tasksPath)
      const id = c.req.param('id')
      const task = tasks.find(t => (t as { id?: string }).id === id) as Task | undefined
      if (!task) return c.json({ error: 'task not found' }, 404)
      const effective = await buildEffectiveTask(project.path, task)
      return c.json({ taskId: id, evidence: effective.evidence })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/task/:id/file', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const tasksPath = join(getProjectStateDir(project.path), 'TASKS.json')
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const tasks = await readTasksFileNormalized(tasksPath)
      const id = c.req.param('id')
      const task = tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
      if (!task) return c.json({ error: 'task not found' }, 404)
      const requestedPath = c.req.query('path')?.trim() ?? ''
      if (!requestedPath) return c.json({ error: 'path is required' }, 400)
      const workspaceStore = await readTaskWorkspaceStore(project.path).catch(() => undefined)
      const workspace = workspaceStore?.workspaces[id]
      const resolved = await resolveTaskInspectableFile(project.path, task, requestedPath, workspace)
      const stat = await fsp.stat(resolved.absolutePath)
      if (!stat.isFile()) return c.json({ error: 'path is not a file' }, 400)
      const handle = await fsp.open(resolved.absolutePath, 'r')
      try {
        const bytesToRead = Math.min(stat.size, TASK_FILE_PREVIEW_LIMIT_BYTES)
        const buffer = Buffer.alloc(bytesToRead)
        const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0)
        return c.json({
          taskId: id,
          path: resolved.displayPath,
          absolutePath: resolved.absolutePath,
          content: buffer.subarray(0, bytesRead).toString('utf8'),
          language: languageForPath(resolved.displayPath),
          truncated: stat.size > TASK_FILE_PREVIEW_LIMIT_BYTES,
        })
      } finally {
        await handle.close()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (
        message === 'path is required' ||
        message === 'path is outside the task workspace' ||
        /ENOENT|not found/i.test(message)
      ) {
        return c.json({ error: message === 'path is outside the task workspace' ? message : 'file not found' }, 400)
      }
      return c.json({ error: message }, 500)
    }
  })

  app.get('/api/project/task/:id/history', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const tasksPath = join(getProjectStateDir(project.path), 'TASKS.json')
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const tasks = await readTasksFileNormalized(tasksPath)
      const id = c.req.param('id')
      const task = tasks.find(t => (t as { id?: string }).id === id) as Task | undefined
      if (!task) return c.json({ error: 'task not found' }, 404)
      const effective = await buildEffectiveTask(project.path, task)
      return c.json({
        taskId: id,
        events: effective.evidence.filter(event =>
          event.kind === 'note' ||
          event.kind === 'escalation' ||
          event.kind === 'agent_issue' ||
          event.kind === 'gate_result' ||
          event.kind === 'merge_record'
        ),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/task/:id/review', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const tasksPath = join(getProjectStateDir(project.path), 'TASKS.json')
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const tasks = await readTasksFileNormalized(tasksPath)
      const id = c.req.param('id')
      const task = tasks.find(t => (t as { id?: string }).id === id) as Task | undefined
      if (!task) return c.json({ error: 'task not found' }, 404)
      const effective = await buildEffectiveTask(project.path, task)
      return c.json({
        taskId: id,
        verdicts: effective.evidence.filter(event => event.kind === 'review_verdict'),
        adjudications: effective.evidence.filter(event => event.kind === 'adjudication'),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/task/:id/git-story', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const tasksPath = join(getProjectStateDir(project.path), 'TASKS.json')
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const tasks = await readTasksFileNormalized(tasksPath)
      const id = c.req.param('id')
      const task = tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
      if (!task) return c.json({ error: 'task not found' }, 404)
      const workspaceStore = await readTaskWorkspaceStore(project.path).catch(() => undefined)
      const snapshot = await gitStoryForTask(project.path, task, workspaceStore?.workspaces[id])
      return c.json({ taskId: id, gitStory: snapshot })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/task/:id/git-story/:closureAction', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const id = c.req.param('id')
      const closureAction = c.req.param('closureAction')
      const known = ['local-only', 'defer', 'commit', 'push', 'open-pr']
      if (!known.includes(closureAction)) {
        return c.json({ error: 'unknown git story action' }, 400)
      }
      const body = await c.req.json().catch(() => ({})) as {
        reason?: string
        message?: string
        files?: string[]
        title?: string
        prBody?: string
        body?: string
        confirmed?: boolean
        automationSource?: string
      }
      const memoryDir = getProjectStateDir(project.path)
      const tasksPath = join(memoryDir, 'TASKS.json')
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const parsed = JSON.parse(readFileSync(tasksPath, 'utf8')) as
        | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
        | Array<Record<string, unknown>>
      const queue = Array.isArray(parsed)
        ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
        : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
      const task = queue.tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
      if (!task) return c.json({ error: 'task not found' }, 404)
      const now = new Date().toISOString()
      if (closureAction === 'commit') {
        const allowed = policyAllowsGitWrite(project.path, project.config, task, 'commit', body)
        if (!allowed.ok) return c.json({ error: allowed.error }, allowed.status as 403 | 409)
        const message = typeof body.message === 'string' ? body.message.trim() : ''
        const files = Array.isArray(body.files) ? body.files.filter((file): file is string => typeof file === 'string' && isSafeRelativeGitPath(file)) : []
        if (!message) return c.json({ error: 'message is required' }, 400)
        if (files.length === 0) return c.json({ error: 'files are required' }, 400)
        const cwd = taskGitStoryRepoPath(project.path, task)
        const result = await commitGitStoryFiles({ cwd, files, message })
        if (!result.ok) return c.json({ error: result.detail ?? 'commit failed' }, 500)
        const notes = Array.isArray(task.notes) ? [...(task.notes as unknown[])] : []
        notes.push({ agentId: 'system:git-story', role: 'system', content: `Committed git story changes: ${result.commitSha ?? 'unknown commit'}.`, timestamp: now })
        task.notes = notes
        task.updatedAt = now
        queue.lastUpdated = now
        atomicWriteText(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        return c.json({ ok: true, commitSha: result.commitSha, task: await enrichTaskForServe(project.path, task) })
      }
      if (closureAction === 'push') {
        const allowed = policyAllowsGitWrite(project.path, project.config, task, 'push', body)
        if (!allowed.ok) return c.json({ error: allowed.error }, allowed.status as 403 | 409)
        const cwd = taskGitStoryRepoPath(project.path, task)
        const branch = typeof task.branchName === 'string' && task.branchName.trim()
          ? task.branchName.trim()
          : await new NodeGitDriver().currentBranch(cwd)
        const result = await new NodeGitDriver().push(cwd, branch)
        if (!result.ok) {
          const fetchFirst = /fetch first|non-fast-forward|rejected/i.test(result.detail ?? '')
          return c.json({
            error: result.detail ?? 'push failed',
            ...(fetchFirst ? { nextAction: 'Fetch and merge the remote branch, rerun verification, then push again.' } : {}),
          }, fetchFirst ? 409 : 500)
        }
        return c.json({ ok: true, branch, task: await enrichTaskForServe(project.path, task) })
      }
      if (closureAction === 'open-pr') {
        const allowed = policyAllowsGitWrite(project.path, project.config, task, 'pullRequest', body)
        if (!allowed.ok) return c.json({ error: allowed.error }, allowed.status as 403 | 409)
        const cwd = taskGitStoryRepoPath(project.path, task)
        const branch = typeof task.branchName === 'string' && task.branchName.trim()
          ? task.branchName.trim()
          : await new NodeGitDriver().currentBranch(cwd)
        const baseBranch = typeof task.baseBranch === 'string' && task.baseBranch.trim() ? task.baseBranch.trim() : 'main'
        const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : String(task.title ?? id)
        const result = await new NodeGitDriver().openPullRequest(cwd, {
          branch,
          baseBranch,
          title,
          body: typeof body.prBody === 'string' ? body.prBody : typeof body.body === 'string' ? body.body : undefined,
        })
        if (!result.ok) return c.json({ error: result.detail ?? 'open PR failed' }, 500)
        return c.json({ ok: true, url: result.url, task: await enrichTaskForServe(project.path, task) })
      }

      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      if (!reason) return c.json({ error: 'reason is required' }, 400)
      const override = closureAction === 'local-only' ? 'local_only' : 'deferred'
      task.gitStory = {
        override,
        reason,
        recordedAt: now,
        recordedBy: 'user',
      }
      task.updatedAt = now
      queue.lastUpdated = now
      atomicWriteText(tasksPath, JSON.stringify(queue, null, 2) + '\n')
      return c.json({
        ok: true,
        task: await enrichTaskForServe(project.path, task),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // GET /api/project/task/:id/experts — which personas are applicable for
  // this task, and how their verdicts / gate results map onto them.
  //
  // Response shape:
  //   {
  //     primaryEngineer: slug | null,
  //     applicable: [{ slug, name, role, blurb }],
  //     reviewers:  [{ slug, name, role }],
  //     verdictsBySlug: {
  //       [slug]: [{ verdict, reason, reasoning, reviewerPath, recordedAt, ... }]
  //     },
  //     gateResultsBySlug: {
  //       [slug]: [{ gateId, passed, output, checkedAt }]
  //     },
  //     warnings: string[]   // composition load warnings, if any
  //   }
  //
  // Gate-result-to-slug mapping uses the gate id namespace: guild checks use
  // dotted prefixes (`a11y.contrast-matrix`, `color.near-duplicate-roles`,
  // `sec.no-hardcoded-secrets`, etc.). Anything that doesn't namespace-match
  // a known guild falls under "unattributed" so the hard-gate results
  // (typecheck / build / test / lint) still surface somewhere in the UI.
  // -------------------------------------------------------------------------
  app.get('/api/project/task/:id/experts', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const tasksPath = join(getProjectStateDir(project.path), 'TASKS.json')
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const raw = JSON.parse(readFileSync(tasksPath, 'utf8')) as
        | { tasks?: Array<Record<string, unknown>> }
        | Array<Record<string, unknown>>
      const tasks = Array.isArray(raw) ? raw : raw.tasks ?? []
      const id = c.req.param('id')
      const task = tasks.find(t => (t as { id?: string }).id === id) as
        | Record<string, unknown>
        | undefined
      if (!task) return c.json({ error: 'task not found' }, 404)

      const memDir = getProjectStateDir(project.path)
      const designSystem = await loadDesignSystem(memDir).catch(() => undefined)
      const { guilds: roster, warnings } = loadProjectGuildRoster(memDir)

      // `selectApplicableGuilds` expects a Task type; we pass through a
      // structurally-compatible subset without forcing a full schema parse
      // at this endpoint (tasks on disk may predate recent zod additions).
      const signals = {
        task: task as unknown as Parameters<typeof selectApplicableGuilds>[0]['task'],
        ...(designSystem ? { designSystem } : {}),
        memoryDir: memDir,
        projectPath: project.path,
      }
      const applicable = selectApplicableGuilds(signals, roster)
      const reviewers = reviewersForTask(applicable)
      const primaryEngineer = pickPrimaryEngineer(applicable)

      const applicableSlugs = new Set(applicable.map(g => g.slug))

      // Group review verdicts by guild slug. Each PersonaVerdict is persisted
      // with `failingSignals: [guildSlug]` on revise; on approve we
      // attribute by matching `reason` prefix ("The Accessibility Specialist
      // approved"). Keep the mapping robust — unknown attribution falls into
      // a generic bucket.
      const verdicts = Array.isArray(task.reviewVerdicts)
        ? (task.reviewVerdicts as Array<Record<string, unknown>>)
        : []
      const verdictsBySlug: Record<string, Array<Record<string, unknown>>> = {}
      const nameToSlug = new Map<string, string>()
      for (const g of roster) nameToSlug.set(g.name, g.slug)
      for (const v of verdicts) {
        let slug: string | null = null
        const failingSignals = v.failingSignals
        if (Array.isArray(failingSignals) && failingSignals.length > 0) {
          const candidate = failingSignals[0]
          if (typeof candidate === 'string' && applicableSlugs.has(candidate)) {
            slug = candidate
          }
        }
        if (!slug && typeof v.reason === 'string') {
          for (const [name, s] of nameToSlug) {
            if (v.reason.includes(name)) {
              slug = s
              break
            }
          }
        }
        const bucket = slug ?? 'unattributed'
        ;(verdictsBySlug[bucket] ??= []).push(v)
      }

      // Group gate results by guild via the gate-id prefix namespace.
      const prefixToSlug: Record<string, string> = {
        'a11y.': 'accessibility-specialist',
        'color.': 'color-theorist',
        'sec.': 'security-engineer',
        'test.': 'test-engineer',
        'component-designer.': 'component-designer',
        'copy.': 'copywriter',
      }
      const gateResults = Array.isArray(task.gateResults)
        ? (task.gateResults as Array<Record<string, unknown>>)
        : []
      const gateResultsBySlug: Record<string, Array<Record<string, unknown>>> = {}
      for (const g of gateResults) {
        const gateId = typeof g.gateId === 'string' ? g.gateId : ''
        let slug = 'unattributed'
        for (const [prefix, s] of Object.entries(prefixToSlug)) {
          if (gateId.startsWith(prefix)) {
            slug = s
            break
          }
        }
        ;(gateResultsBySlug[slug] ??= []).push(g)
      }

      return c.json({
        primaryEngineer: primaryEngineer?.slug ?? null,
        applicable: applicable.map(g => ({
          slug: g.slug,
          name: g.name,
          role: g.role,
          blurb: g.blurb,
        })),
        reviewers: reviewers.map(g => ({
          slug: g.slug,
          name: g.name,
          role: g.role,
        })),
        verdictsBySlug,
        gateResultsBySlug,
        warnings,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // POST /api/project/task/:id/:action — human overrides on a task.
  //   hold               → blocked      (any non-terminal task; reversible)
  //   resume-hold        → previous status from hold record
  //   pause              → deprecated alias for hold
  //   shelve             → shelved      (any non-done task)
  //   unshelve           → proposed     (shelved task only; clears shelveReason)
  //   approve-spec       → ready  (human approves a spec_review task; body: {approvalNote?})
  //   approve-brief      → mark productBrief.approvedBy/approvedAt = human
  //   mark-done          → done   (human confirms the task is already complete; body: {evidence?})
  //   update-brief       → fill missing task-brief fields from human input
  //   add-acceptance     → append a human-written acceptance criterion
  //   resume             → append a follow-up message to an exploring transcript
  //                        (body: {message?, resolveEscalationId?, resolution?})
  //   enrich-task        → add missing checklist/split structure while preserving useful context
  //   reframe-task       → reopen a stale/inscrutable task for fresh shaping
  //   create-split-children → materialize stored split-required child recommendations
  //   resolve-escalation → close a named escalation; unblocks when none remain
  //                        (body: {escalationId, resolution, nextStatus?})
  app.post('/api/project/task/:id/:action', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const id = c.req.param('id')
      const action = c.req.param('action')
      const KNOWN_ACTIONS = [
        'pause',
        'hold',
        'resume-hold',
        'shelve',
        'approve-spec',
        'approve-brief',
        'mark-done',
        'update-brief',
        'add-acceptance',
        'resume',
        'reframe-task',
        'enrich-task',
        'unshelve',
        'resolve-escalation',
        'stage-answer',
        'answer-question',
        'answer-questions',
        'rerun-stage',
        'shape-draft',
        'create-split-children',
      ] as const
      if (!(KNOWN_ACTIONS as readonly string[]).includes(action)) {
        return c.json({ error: 'unknown action' }, 400)
      }

      const memoryDir = getProjectStateDir(project.path)

      // approve-spec and resume have their own persistence (intake.ts owns the
      // write). Delegate to them so the exploring-transcript stays in sync.
      if (action === 'approve-spec') {
        if (id === WORKSPACE_IMPORT_TASK_ID) {
          return c.json(
            {
              error:
                'Workspace import uses a dedicated approval flow. Use /api/project/workspace-import/approve instead.',
            },
            400,
          )
        }
        const body = await c.req.json().catch(() => ({})) as { approvalNote?: string }
        const result = await approveSpec({
          memoryDir,
          taskId: id,
          ...(body.approvalNote ? { approvalNote: body.approvalNote } : {}),
        })
        if (!result.success) return c.json({ error: result.error ?? 'approve failed' }, 400)
        return c.json({ ok: true, status: result.newStatus })
      }

      if (action === 'resume') {
        const body = await c.req.json().catch(() => ({})) as {
          message?: string
          resolveEscalationId?: string
          resolution?: string
          preserveStatus?: boolean
        }
        if (!body.message && !body.resolveEscalationId) {
          return c.json({ error: 'Provide a message or an escalation to resolve' }, 400)
        }
        const result = await resumeExploring({
          memoryDir,
          taskId: id,
          ...(body.message ? { message: body.message } : {}),
          ...(body.resolveEscalationId ? { resolveEscalationId: body.resolveEscalationId } : {}),
          ...(body.resolution ? { resolution: body.resolution } : {}),
          ...(body.preserveStatus ? { preserveStatus: true } : {}),
        })
        if (!result.success) return c.json({ error: result.error ?? 'resume failed' }, 400)
        return c.json({ ok: true })
      }

      if (action === 'reframe-task') {
        const body = await c.req.json().catch(() => ({})) as {
          reason?: string
        }
        const result = await reframeTask({
          memoryDir,
          taskId: id,
          ...(body.reason ? { reason: body.reason } : {}),
        })
        if (!result.success) return c.json({ error: result.error ?? 'reframe failed' }, 400)
        return c.json({ ok: true, status: result.newStatus })
      }

      if (action === 'enrich-task') {
        const body = await c.req.json().catch(() => ({})) as {
          instruction?: string
          mode?: 'split' | 'checklist' | 'general'
        }
        const result = await enrichTask({
          memoryDir,
          taskId: id,
          mode: body.mode,
          instruction: body.instruction,
        })
        if (!result.success) return c.json({ error: result.error ?? 'enrich failed' }, 400)
        return c.json({ ok: true, status: result.newStatus })
      }

      if (action === 'rerun-stage') {
        const body = await c.req.json().catch(() => ({})) as {
          stage?: 'spec' | 'review' | 'gate'
        }
        if (body.stage !== 'spec' && body.stage !== 'review' && body.stage !== 'gate') {
          return c.json({ error: 'Missing or invalid stage' }, 400)
        }
        const result = await rerunTaskStage({
          memoryDir,
          taskId: id,
          stage: body.stage,
        })
        if (!result.success) return c.json({ error: result.error ?? 'rerun failed' }, 400)
        return c.json({ ok: true, status: result.newStatus })
      }

      if (action === 'shape-draft') {
        const result = await shapeImportDraft({
          memoryDir,
          taskId: id,
        })
        if (!result.success) return c.json({ error: result.error ?? 'shape failed' }, 400)
        return c.json({ ok: true, status: result.newStatus })
      }

      if (action === 'create-split-children') {
        const tasksPath = join(memoryDir, 'TASKS.json')
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const queue = TaskQueue.parse(JSON.parse(readFileSync(tasksPath, 'utf8')))
        const task = queue.tasks.find(t => t.id === id)
        if (!task) return c.json({ error: 'task not found' }, 404)
        if (task.sizePlan?.action !== 'split_required') {
          return c.json({ error: 'task does not require a split' }, 400)
        }
        const now = new Date().toISOString()
        materializeRequiredSplitChildren(queue, task, now)
        task.updatedAt = now
        queue.lastUpdated = now
        atomicWriteText(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        return c.json({
          ok: true,
          parentTaskId: task.id,
          createdTaskIds: task.sizePlan.recommendedChildren
            .map(child => child.createdTaskId)
            .filter((createdTaskId): createdTaskId is string => Boolean(createdTaskId)),
        })
      }

      if (action === 'approve-brief') {
        const tasksPath = join(memoryDir, 'TASKS.json')
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readFileSync(tasksPath, 'utf8')) as
          | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        const queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
          : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
        const task = queue.tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
        if (!task) return c.json({ error: 'task not found' }, 404)
        const brief = task.productBrief as Record<string, unknown> | undefined
        if (!brief || typeof brief !== 'object') {
          return c.json({ error: 'no product brief drafted yet' }, 400)
        }
        if (!brief.userJob || !brief.successMetric) {
          return c.json({ error: 'brief is incomplete — needs userJob and successMetric' }, 400)
        }
        const now = new Date().toISOString()
        brief.approvedBy = 'human'
        brief.approvedAt = now
        task.productBrief = brief
        const hasUnansweredQuestions = taskHasUnansweredVisibleQuestion(task as unknown as Task)
        const hasConcreteSpecDraft =
          typeof task.spec === 'string' &&
          task.spec.trim().length > 0 &&
          Array.isArray(task.acceptanceCriteria) &&
          task.acceptanceCriteria.length > 0
        if (
          task.status === 'exploring' &&
          hasConcreteSpecDraft &&
          !hasUnansweredQuestions
        ) {
          task.status = 'spec_review'
        }
        task.updatedAt = now
        queue.lastUpdated = now
        atomicWriteText(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        return c.json({ ok: true, status: task.status })
      }

      if (action === 'mark-done') {
        const body = await c.req.json().catch(() => ({})) as { evidence?: string }
        const evidence = (body.evidence ?? '').trim()
        const tasksPath = join(memoryDir, 'TASKS.json')
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readFileSync(tasksPath, 'utf8')) as
          | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        const queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
          : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
        const task = queue.tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
        if (!task) return c.json({ error: 'task not found' }, 404)
        if (task.status === 'done') return c.json({ ok: true, status: 'done' })
        if (task.status === 'in_progress' || task.status === 'review' || task.status === 'gate_check') {
          return c.json({ error: `task is ${task.status}; stop or finish the active run before marking it done` }, 400)
        }

        const now = new Date().toISOString()
        const criteria = Array.isArray(task.acceptanceCriteria)
          ? [...task.acceptanceCriteria as Array<Record<string, unknown>>]
          : []
        task.acceptanceCriteria = criteria.map(criterion => ({
          ...criterion,
          met: true,
        }))
        if (Array.isArray(task.escalations)) {
          task.escalations = (task.escalations as Array<Record<string, unknown>>).map(escalation => (
            escalation.resolvedAt
              ? escalation
              : {
                  ...escalation,
                  resolvedAt: now,
                  resolvedBy: 'human',
                  resolution: evidence || 'Human confirmed this task is complete.',
                }
          ))
        }
        delete task.blockReason
        task.status = 'done'
        task.assignedTo = null
        task.updatedAt = now
        const notes = Array.isArray(task.notes)
          ? [...task.notes as Array<Record<string, unknown>>]
          : []
        notes.push({
          agentId: 'system:human',
          role: 'human',
          content: evidence
            ? `Marked done from Thread. Evidence: ${evidence}`
            : 'Marked done from Thread after human confirmation.',
          timestamp: now,
        })
        task.notes = notes
        task.doneSummaryBundle = buildDoneTaskSummaryBundle({
          task: task as Task,
          transcriptRef: {
            scope: 'local_history',
            collection: 'transcripts',
            id,
            path: getProjectTranscriptPath(project.path, 'exploring', id),
            contentType: 'text/markdown',
          },
          createdAt: now,
          createdBy: 'system:mark-done',
        })
        queue.lastUpdated = now
        atomicWriteText(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        return c.json({ ok: true, status: 'done' })
      }

      if (action === 'add-acceptance') {
        const body = await c.req.json().catch(() => ({})) as { description?: string }
        const description = (body.description ?? '').trim()
        if (!description) return c.json({ error: 'description required' }, 400)
        const tasksPath = join(memoryDir, 'TASKS.json')
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readFileSync(tasksPath, 'utf8')) as
          | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        const queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
          : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
        const task = queue.tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
        if (!task) return c.json({ error: 'task not found' }, 404)
        const now = new Date().toISOString()
        const criteria = Array.isArray(task.acceptanceCriteria)
          ? [...task.acceptanceCriteria as Array<Record<string, unknown>>]
          : []
        criteria.push({
          id: `ac-${criteria.length + 1}`,
          description,
          verifiedBy: 'review',
          met: false,
        })
        task.acceptanceCriteria = criteria
        const notes = Array.isArray(task.notes)
          ? [...task.notes as Array<Record<string, unknown>>]
          : []
        notes.push({
          agentId: 'human',
          role: 'specifier',
          content: `Added acceptance criterion: ${description}`,
          timestamp: now,
        })
        task.notes = notes
        task.updatedAt = now
        queue.lastUpdated = now
        atomicWriteText(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        return c.json({ ok: true, count: criteria.length })
      }

      if (action === 'update-brief') {
        const body = await c.req.json().catch(() => ({})) as {
          successTarget?: string
          acceptanceCriterion?: string
          userJob?: string
        }
        const successTarget = (body.successTarget ?? '').trim()
        const acceptanceCriterion = (body.acceptanceCriterion ?? '').trim()
        const userJob = (body.userJob ?? '').trim()
        if (!successTarget && !acceptanceCriterion && !userJob) {
          return c.json({ error: 'Add a success target or an acceptance criterion.' }, 400)
        }
        const tasksPath = join(memoryDir, 'TASKS.json')
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readFileSync(tasksPath, 'utf8')) as
          | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        const queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
          : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
        const task = queue.tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
        if (!task) return c.json({ error: 'task not found' }, 404)
        const now = new Date().toISOString()
        const currentBrief = task.productBrief && typeof task.productBrief === 'object' && !Array.isArray(task.productBrief)
          ? task.productBrief as Record<string, unknown>
          : {}
        const fallbackUserJob =
          typeof currentBrief.userJob === 'string' && currentBrief.userJob.trim()
            ? currentBrief.userJob.trim()
            : userJob ||
              (typeof task.description === 'string' && task.description.trim()
                ? task.description.trim()
                : String(task.title ?? id).trim())
        task.productBrief = {
          ...currentBrief,
          userJob: fallbackUserJob,
          ...(successTarget ? { successMetric: successTarget, successCriteria: successTarget } : {}),
          authoredBy: currentBrief.authoredBy ?? 'human',
        }

        if (acceptanceCriterion) {
          const criteria = Array.isArray(task.acceptanceCriteria)
            ? [...task.acceptanceCriteria as Array<Record<string, unknown>>]
            : []
          criteria.push({
            id: `ac-${criteria.length + 1}`,
            description: acceptanceCriterion,
            verifiedBy: 'review',
            met: false,
          })
          task.acceptanceCriteria = criteria
        }

        const notes = Array.isArray(task.notes)
          ? [...task.notes as Array<Record<string, unknown>>]
          : []
        const noteParts = [
          successTarget ? `Success target: ${successTarget}` : '',
          acceptanceCriterion ? `Acceptance criterion: ${acceptanceCriterion}` : '',
        ].filter(Boolean)
        notes.push({
          agentId: 'human',
          role: 'specifier',
          content: `Updated task brief. ${noteParts.join(' ')}`.trim(),
          timestamp: now,
        })
        task.notes = notes
        task.updatedAt = now
        queue.lastUpdated = now
        atomicWriteText(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        return c.json({ ok: true })
      }

      if (action === 'answer-question') {
        // Mark an open AgentQuestion as answered. Body: {questionId, answer}.
        // The answer is also appended to the exploring transcript so the
        // asking agent picks it up on the next tick (same path as `resume`).
        const body = (await c.req.json().catch(() => ({}))) as {
          questionId?: string
          answer?: string
        }
        if (!body.questionId) return c.json({ error: 'Missing questionId' }, 400)
        if (!body.answer || !body.answer.trim()) {
          return c.json({ error: 'Missing answer' }, 400)
        }
        const tasksPath = join(memoryDir, 'TASKS.json')
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readFileSync(tasksPath, 'utf8')) as
          | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        const queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
          : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
        const task = queue.tasks.find(t => (t as { id?: string }).id === id) as
          | Record<string, unknown>
          | undefined
        if (!task) return c.json({ error: 'task not found' }, 404)
        const questions = (task.openQuestions as Array<Record<string, unknown>> | undefined) ?? []
        const q = questions.find(x => (x as { id?: string }).id === body.questionId)
        if (!q) return c.json({ error: 'question not found' }, 404)
        const now = new Date().toISOString()
        delete q.draftAnswer
        q.answeredAt = now
        q.answer = body.answer.trim()
        task.openQuestions = questions
        task.updatedAt = now
        queue.lastUpdated = now
        atomicWriteText(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        // Also append to the exploring transcript so the asking agent reads it.
        await resumeExploring({
          memoryDir,
          taskId: id,
          message: `Answer to "${(q as { id?: string }).id}": ${body.answer.trim()}`,
        })
        return c.json({ ok: true })
      }

      if (action === 'stage-answer') {
        const body = (await c.req.json().catch(() => ({}))) as {
          questionId?: string
          answer?: string
        }
        if (!body.questionId) return c.json({ error: 'Missing questionId' }, 400)
        const tasksPath = join(memoryDir, 'TASKS.json')
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readFileSync(tasksPath, 'utf8')) as
          | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        const queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
          : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
        const task = queue.tasks.find(t => (t as { id?: string }).id === id) as
          | Record<string, unknown>
          | undefined
        if (!task) return c.json({ error: 'task not found' }, 404)
        const questions = (task.openQuestions as Array<Record<string, unknown>> | undefined) ?? []
        const q = questions.find(x => (x as { id?: string }).id === body.questionId)
        if (!q) return c.json({ error: 'question not found' }, 404)
        const nextDraft = (body.answer ?? '').trim()
        if (nextDraft) q.draftAnswer = nextDraft
        else delete q.draftAnswer
        task.openQuestions = questions
        task.updatedAt = new Date().toISOString()
        queue.lastUpdated = task.updatedAt as string
        atomicWriteText(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        return c.json({ ok: true, staged: Boolean(nextDraft) })
      }

      if (action === 'answer-questions') {
        // Batch-answer multiple open AgentQuestions atomically. Body:
        //   { answers: [{questionId, answer}, ...] }
        // Used by the Thread surface when the user fills in a section of
        // co-active questions and submits them together. The orchestrator
        // gets ONE resume with all answers stitched into the transcript,
        // so the asking agent can write a complete brief in one shot
        // instead of partial-then-partial across N resumes.
        const body = (await c.req.json().catch(() => ({}))) as {
          answers?: Array<{ questionId?: string; answer?: string }>
        }
        const list = Array.isArray(body.answers) ? body.answers : []
        if (list.length === 0) return c.json({ error: 'Missing answers' }, 400)
        for (const a of list) {
          if (!a.questionId) return c.json({ error: 'Missing questionId in answers[]' }, 400)
          if (!a.answer || !a.answer.trim()) {
            return c.json({ error: 'Missing answer in answers[]' }, 400)
          }
        }
        const tasksPath = join(memoryDir, 'TASKS.json')
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readFileSync(tasksPath, 'utf8')) as
          | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        const queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
          : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
        const task = queue.tasks.find(t => (t as { id?: string }).id === id) as
          | Record<string, unknown>
          | undefined
        if (!task) return c.json({ error: 'task not found' }, 404)
        const questions = (task.openQuestions as Array<Record<string, unknown>> | undefined) ?? []
        const now = new Date().toISOString()
        const transcriptLines: string[] = []
        const missing: string[] = []
        for (const a of list) {
          const q = questions.find(x => (x as { id?: string }).id === a.questionId)
          if (!q) { missing.push(a.questionId!); continue }
          delete q.draftAnswer
          q.answeredAt = now
          q.answer = a.answer!.trim()
          transcriptLines.push(`Answer to "${a.questionId}": ${a.answer!.trim()}`)
        }
        if (missing.length > 0) {
          return c.json({ error: `question(s) not found: ${missing.join(', ')}` }, 404)
        }
        task.openQuestions = questions
        task.updatedAt = now
        queue.lastUpdated = now
        atomicWriteText(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        // Single resume with all answers — agent gets the full batch in one
        // context restart instead of N separate ones.
        await resumeExploring({
          memoryDir,
          taskId: id,
          message: transcriptLines.join('\n'),
        })
        return c.json({ ok: true, count: list.length })
      }

      if (action === 'resolve-escalation') {
        const body = await c.req.json().catch(() => ({})) as {
          escalationId?: string
          resolution?: string
          nextStatus?: 'exploring' | 'spec_review' | 'ready' | 'in_progress' | 'review' | 'gate_check'
        }
        if (!body.escalationId) return c.json({ error: 'Missing escalationId' }, 400)
        if (!body.resolution || !body.resolution.trim()) {
          return c.json({ error: 'Missing resolution' }, 400)
        }
        const result = await resolveEscalation({
          tasksPath: join(memoryDir, 'TASKS.json'),
          progressPath: join(memoryDir, 'PROGRESS.md'),
          taskId: id,
          escalationId: body.escalationId,
          resolution: body.resolution.trim(),
          resolvedBy: 'human',
          nextStatus: body.nextStatus ?? 'ready',
        })
        if (!result.success) return c.json({ error: result.error ?? 'resolve failed' }, 400)
        return c.json({ ok: true })
      }

      // hold / resume-hold / shelve / unshelve: in-place mutation of TASKS.json.
      const tasksPath = join(memoryDir, 'TASKS.json')
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const parsed = JSON.parse(readFileSync(tasksPath, 'utf8')) as
        | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
        | Array<Record<string, unknown>>
      const queue = Array.isArray(parsed)
        ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
        : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
      const task = queue.tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
      if (!task) return c.json({ error: 'task not found' }, 404)
      const now = new Date().toISOString()
      const notes = Array.isArray(task.notes) ? [...(task.notes as unknown[])] : []
      if (action === 'hold' || action === 'pause') {
        const run = supervisor.get(project.id)
        if (run && (run.status === 'running' || run.status === 'stopping')) {
          return c.json({ error: 'Stop Guildhall before putting a task on hold.' }, 409)
        }
        if (task.status === 'done' || task.status === 'shelved' || task.status === 'pending_pr') {
          return c.json({ error: `task is ${task.status}` }, 400)
        }
        if (task.status === 'blocked' && task.hold) {
          return c.json({ ok: true, status: 'blocked' })
        }
        const body = await c.req.json().catch(() => ({})) as { reason?: string }
        const reason = (body.reason ?? '').trim()
        task.hold = {
          previousStatus: task.status,
          ...(reason ? { reason } : {}),
          heldAt: now,
          heldBy: 'human',
        }
        task.status = 'blocked'
        task.blockReason = reason ? `On hold: ${reason}` : 'On hold by human.'
        notes.push({
          agentId: 'system:human',
          role: 'human',
          content: reason ? `Task put on hold: ${reason}` : 'Task put on hold.',
          timestamp: now,
        })
      } else if (action === 'resume-hold') {
        const hold = task.hold as { previousStatus?: string } | undefined
        if (task.status !== 'blocked' || !hold) {
          return c.json({ error: 'task is not on hold' }, 400)
        }
        task.status = hold.previousStatus ?? 'ready'
        delete task.hold
        delete task.blockReason
        notes.push({ agentId: 'system:human', role: 'human', content: 'Task returned from hold.', timestamp: now })
      } else if (action === 'unshelve') {
        if (task.status !== 'shelved') {
          return c.json({ error: `task is ${task.status}, not shelved` }, 400)
        }
        task.status = 'proposed'
        delete (task as Record<string, unknown>).shelveReason
        notes.push({ agentId: 'system:human', role: 'human', content: 'Task unshelved via dashboard', timestamp: now })
      } else {
        if (task.status === 'done') return c.json({ error: 'task is done' }, 400)
        task.status = 'shelved'
        task.shelveReason = {
          code: 'not_viable',
          detail: 'Shelved by human from dashboard',
          rejectedBy: 'system:human',
          rejectedAt: now,
          source: 'proposal_policy',
          policyApplied: true,
          requeueCount: 0,
        }
        notes.push({ agentId: 'system:human', role: 'human', content: 'Task shelved via dashboard', timestamp: now })
      }
      task.notes = notes
      task.updatedAt = now
      queue.lastUpdated = now
      atomicWriteText(tasksPath, JSON.stringify(queue, null, 2) + '\n')
      return c.json({ ok: true, status: task.status })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // GET /api/project/activity — counts + in-flight tasks for the always-on
  // agent-activity chip. Cheap enough to poll every few seconds from any
  // view (not just the project page).
  app.get('/api/project/activity', c => {
    try {
      if (project.initializationNeeded) return c.json({ running: false, counts: {}, inFlight: [] })
      const run = supervisor.get(project.id)
      const tasksPath = join(getProjectStateDir(project.path), 'TASKS.json')
      const empty = { running: run?.status === 'running', counts: {}, inFlight: [] as unknown[] }
      if (!existsSync(tasksPath)) return c.json(empty)
      const raw = JSON.parse(readFileSync(tasksPath, 'utf8')) as
        | { tasks?: Array<Record<string, unknown>> }
        | Array<Record<string, unknown>>
      const tasks = Array.isArray(raw) ? raw : raw.tasks ?? []
      const counts: Record<string, number> = {}
      const recentByTask = new Map<string, { at?: string; label?: string; tone?: 'neutral' | 'running' | 'ok' | 'warn' | 'danger' }>()
      for (const envelope of supervisor.recent(project.id, undefined, project.path)) {
        const event = envelope.event as Record<string, unknown> | undefined
        const taskId = typeof event?.task_id === 'string'
          ? event.task_id
          : typeof event?.taskId === 'string'
            ? event.taskId
            : null
        if (!taskId) continue
        const label = summarizeProjectEvent(event)
        recentByTask.set(taskId, {
          ...(envelope.at ? { at: envelope.at } : {}),
          ...(label ? { label } : {}),
          tone: toneForProjectEvent(event),
        })
      }
      const inFlight: Array<{
        id: string
        title: string
        status: string
        domain: string
        lastActivityAt?: string
        lastActivityLabel?: string
        lastActivityTone?: 'neutral' | 'running' | 'ok' | 'warn' | 'danger'
      }> = []
      for (const t of tasks) {
        const st = String((t as { status?: string }).status ?? 'unknown')
        counts[st] = (counts[st] ?? 0) + 1
        if (['in_progress', 'review', 'gate_check', 'spec_review', 'exploring'].includes(st)) {
          const id = String((t as { id?: string }).id ?? '')
          const recent = recentByTask.get(id)
          inFlight.push({
            id,
            title: String((t as { title?: string }).title ?? ''),
            status: st,
            domain: String((t as { domain?: string }).domain ?? ''),
            ...(recent?.at ? { lastActivityAt: recent.at } : {}),
            ...(recent?.label ? { lastActivityLabel: recent.label } : {}),
            ...(recent?.tone ? { lastActivityTone: recent.tone } : {}),
          })
        }
      }
      return c.json({
        running: run?.status === 'running',
        runStatus: run?.status ?? 'stopped',
        counts,
        inFlight: inFlight.slice(0, 5),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/progress', c => {
    try {
      if (project.initializationNeeded) return c.json({ progress: '' })
      const progressPath = join(getProjectStateDir(project.path), 'PROGRESS.md')
      if (!existsSync(progressPath)) return c.json({ progress: '' })
      const raw = readFileSync(progressPath, 'utf8')
      // Heartbeat blocks are routine forward transitions — they duplicate
      // the Live Activity feed and clutter the Recent PROGRESS.md panel.
      // Keep only milestones, blocks, escalations, and free-form agent
      // notes (the signal).
      // Split by H3 headings (each PROGRESS.md entry starts with `### `).
      // Drop heartbeat blocks (routine forward transitions — redundant with
      // Live Activity) and drop max-turns-masquerading-as-escalation blocks
      // (self-healing events, not real failures).
      const parts = raw.split(/\n(?=### )/)
      const kept = parts.filter((p, i) => {
        // Keep the leading preamble (title + date headers) as part[0]
        // regardless of heading shape.
        if (i === 0 && !p.startsWith('### ')) return true
        if (/^###\s+💓\s+HEARTBEAT/.test(p)) return false
        if (/error:\s*Exceeded maximum turn limit/.test(p)) return false
        // Strip trailing `---` rule line that delimited the now-removed
        // neighbor, so we don't leave stray separators.
        return true
      })
      const rejoined = kept.join('\n').replace(/(\n---\n)+/g, '\n---\n')
      const tail = rejoined.split('\n').slice(-120).join('\n')
      return c.json({ progress: tail })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.get('/api/config', c => {
    try {
      const cfg = readProjectConfig(currentProjectPath())
      const redacted: Record<string, unknown> = { ...cfg }
      if (redacted.anthropicApiKey) redacted.anthropicApiKey = '•••'
      if (redacted.openaiApiKey) redacted.openaiApiKey = '•••'
      return c.json(redacted)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  const renderLeverPosition = (pos: unknown): string => {
    if (typeof pos === 'string' || typeof pos === 'number') return String(pos)
    if (pos && typeof pos === 'object' && 'kind' in pos) {
      const record = pos as Record<string, unknown>
      const k = String(record.kind)
      if (k === 'fanout' && typeof record.n === 'number') {
        return `fanout_${String(record.n)}`
      }
      if (k === 'soft_penalty' && typeof record.after === 'number') {
        return `soft_penalty_after_${String(record.after)}`
      }
      if (k === 'hard_suppress' && typeof record.after === 'number') {
        return `hard_suppress_after_${String(record.after)}`
      }
      const parts: string[] = [k]
      for (const [key, val] of Object.entries(record)) {
        if (key === 'kind') continue
        parts.push(`${key}=${String(val)}`)
      }
      return parts.join(' ')
    }
    return JSON.stringify(pos)
  }

  const parseLeverPosition = (name: string, raw: unknown): unknown => {
    if (raw === null || raw === undefined) return null
    const value = String(raw)
    switch (name) {
      case 'concurrent_task_dispatch':
        if (value === 'serial') return { kind: 'serial' }
        if (value.startsWith('fanout_')) return { kind: 'fanout', n: Number(value.slice('fanout_'.length)) }
        break
      case 'rejection_dampening':
        if (value === 'off') return { kind: 'off' }
        if (value.startsWith('soft_penalty_after_')) {
          return { kind: 'soft_penalty', after: Number(value.slice('soft_penalty_after_'.length)) }
        }
        if (value.startsWith('hard_suppress_after_')) {
          return { kind: 'hard_suppress', after: Number(value.slice('hard_suppress_after_'.length)) }
        }
        break
      case 'max_revisions':
        return Number(value)
    }
    return value
  }

  const renderLeversForSettings = async (projectPath: string) => {
    const settings = await loadLeverSettings({
      path: defaultAgentSettingsPath(projectPath),
    })
    const defaults = makeDefaultSettings()
    const project = Object.entries(settings.project)
      .filter(([name]) => name !== 'merge_policy')
      .map(([name, entry]) => ({
        scope: 'project' as const,
        name,
        position: renderLeverPosition(entry.position),
        defaultPosition: renderLeverPosition(defaults.project[name as keyof typeof defaults.project]?.position),
        rationale: entry.rationale,
        setBy: entry.setBy,
      }))
    const domain = Object.entries(settings.domains.default).map(([name, entry]) => ({
      scope: 'domain:default' as const,
      name,
      position: renderLeverPosition(entry.position),
      defaultPosition: renderLeverPosition(defaults.domains.default[name as keyof typeof defaults.domains.default]?.position),
      rationale: entry.rationale,
      setBy: entry.setBy,
    }))
    return { levers: [...project, ...domain] }
  }

  // GET /api/config/levers — flatten project + default-domain lever positions
  // into a shape the settings UI can render without knowing the schema details.
  app.get('/api/config/levers', async c => {
    try {
      return c.json(await renderLeversForSettings(currentProjectPath()))
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.get('/api/config/git-story', c => {
    try {
      const system = readGlobalConfig().gitStory
      const projectConfig = readProjectConfig(currentProjectPath())
      const projectPolicy = projectConfig.gitStory ?? {
        ...system,
        copiedFromSystemAt: null,
      }
      return c.json({
        system,
        project: projectPolicy,
        copiedFromSystem: !projectConfig.gitStory,
      })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.post('/api/config/levers', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as {
        scope?: string
        name?: string
        position?: unknown
      }
      const scope = String(body.scope ?? '')
      const name = String(body.name ?? '')
      if (scope !== 'project' && scope !== 'domain:default') {
        return c.json({ error: 'Unsupported lever scope.' }, 400)
      }
      const projectName = PROJECT_LEVER_NAMES.includes(name as ProjectLeverName)
      const domainName = DOMAIN_LEVER_NAMES.includes(name as DomainLeverName)
      if ((scope === 'project' && !projectName) || (scope === 'domain:default' && !domainName)) {
        return c.json({ error: 'Unknown lever.' }, 400)
      }

      const projectPath = currentProjectPath()
      const settingsPath = defaultAgentSettingsPath(projectPath)
      const settings = await loadLeverSettings({ path: settingsPath })
      const defaults = makeDefaultSettings()
      const now = new Date().toISOString()
      const position = parseLeverPosition(name, body.position)
      const target =
        scope === 'project'
          ? settings.project[name as ProjectLeverName]
          : settings.domains.default[name as DomainLeverName]
      const defaultEntry =
        scope === 'project'
          ? defaults.project[name as ProjectLeverName]
          : defaults.domains.default[name as DomainLeverName]

      if (position === null) {
        Object.assign(target, defaultEntry)
      } else {
        Object.assign(target, {
          position,
          rationale: 'Set from project settings.',
          setAt: now,
          setBy: 'user-direct',
        })
      }

      await saveLeverSettings({ path: settingsPath, settings: validateLeverSettings(settings) })
      return c.json(await renderLeversForSettings(projectPath))
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // POST /api/config/levers/reset — wipe the on-disk lever file and re-seed
  // from defaults. Used to recover from LeverSettingsCorruptError (schema
  // grew, stale on-disk file is missing a newly-required lever).
  app.post('/api/config/levers/reset', async c => {
    try {
      const path = defaultAgentSettingsPath(currentProjectPath())
      await saveLeverSettings({ path, settings: makeDefaultSettings() })
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // API: design system
  //
  // Project-scoped; lives at .guildhall/design-system.yaml. The spec agent
  // drafts it; a human approves. Agents consume the approved revision via
  // context-builder's summary block — read the full file for richer surface.
  // -------------------------------------------------------------------------
  app.get('/api/project/design-system', async c => {
    try {
      if (project.initializationNeeded) return c.json({ initializationNeeded: true })
      const memoryDir = getProjectStateDir(project.path)
      const ds = await loadDesignSystem(memoryDir)
      if (!ds) return c.json({ designSystem: null })
      return c.json({ designSystem: ds, summary: summarizeDesignSystem(ds) })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.post('/api/project/design-system', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const memoryDir = getProjectStateDir(project.path)
      const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
      const authoredBy = typeof body.authoredBy === 'string' ? body.authoredBy : 'human'
      const result = await updateDesignSystem({
        memoryDir,
        tokens: (body.tokens as never) ?? undefined,
        primitives: (body.primitives as never) ?? undefined,
        interactions: (body.interactions as never) ?? undefined,
        a11y: (body.a11y as never) ?? undefined,
        copyVoice: (body.copyVoice as never) ?? undefined,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
        authoredBy,
      })
      if (!result.success) return c.json({ error: result.error ?? 'update failed' }, 400)
      return c.json({ ok: true, revision: result.revision })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.post('/api/project/design-system/approve', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const memoryDir = getProjectStateDir(project.path)
      const ds = await loadDesignSystem(memoryDir)
      if (!ds) return c.json({ error: 'no design system drafted yet' }, 400)
      const now = new Date().toISOString()
      const approved: DesignSystem = DesignSystem.parse({
        ...ds,
        approvedBy: 'human',
        approvedAt: now,
      })
      await saveDesignSystem(memoryDir, approved)
      return c.json({ ok: true, approvedAt: now })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // API: current work closure
  //
  // Aggregates the signals that decide "is the work Guildhall is tracking
  // currently closed enough to hand off, ship, or intentionally defer?" into a
  // single readout. Intentionally shallow — it summarizes, it doesn't gate.
  // The Closure view renders the sections
  // and links back into drawers / Settings for fix-its.
  // -------------------------------------------------------------------------
  app.get('/api/project/release-readiness', async c => {
    try {
      const closureScope = {
        kind: 'current_work',
        label: 'Current Guildhall work',
        description:
          'Guildhall is checking the work it is tracking now. This is not a named version or milestone selector yet.',
      }
      if (project.initializationNeeded) return c.json({ initializationNeeded: true, scope: closureScope })
      const memoryDir = getProjectStateDir(project.path)
      const tasksPath = join(memoryDir, 'TASKS.json')
      const rawTasks: Array<Record<string, unknown>> = (() => {
        if (!existsSync(tasksPath)) return []
        const raw = JSON.parse(readFileSync(tasksPath, 'utf8')) as
          | { tasks?: Array<Record<string, unknown>> }
          | Array<Record<string, unknown>>
        return Array.isArray(raw) ? raw : raw.tasks ?? []
      })()
      const tasks = await Promise.all(rawTasks.map((task) => buildEffectiveTask(project.path, task as Task)))
      const activePressureTest = listPressureTestIntakes(memoryDir)
        .find(intake => intake.status === 'active' && intake.pendingQuestion)
      if (activePressureTest?.pendingQuestion) {
        return c.json({
          scope: closureScope,
          ready: false,
          notReadyReason: `Guildhall has one more question for ${activePressureTest.target.title}. Answer it before judging whether the current work can close.`,
          statusCounts: {},
          openEscalations: [],
          unapprovedBriefs: [],
          unapprovedSpecs: [],
          shelvedUnclaimed: [],
          blockedByAgent: [],
          designSystem: {
            drafted: false,
            approved: false,
            revision: 0,
            source: 'none',
            label: 'not captured',
            reason: 'No design-system guardrail is captured yet.',
          },
          dirtyCheckout: {
            ownedCount: 0,
            samplePaths: [],
          },
          gitStory: {
            ready: true,
            blockers: [],
            snapshots: [],
          },
          totals: {
            tasks: rawTasks.length,
            blockingCount: 0,
            humanBlockingCount: 0,
            unfinishedCount: 0,
            designSystemBlockingCount: 0,
            dirtyCheckoutBlockingCount: 0,
            gitStoryBlockingCount: 0,
            done: rawTasks.filter(task => task.status === 'done').length,
          },
        })
      }
      const [ds, codebaseMap] = await Promise.all([
        loadDesignSystem(memoryDir).catch(() => undefined),
        loadCodebaseMap(memoryDir).catch(() => null),
      ])
      const designSystem = releaseDesignSystemStatus(ds, project.config, codebaseMap)
      const dirtyCheckout = await guildhallOwnedDirtyCheckout(project.path)
      const gitStory = await buildProjectGitStorySummary(project.path, tasks)

      const statusCounts: Record<string, number> = {}
      const openEscalations: Array<{ taskId: string; taskTitle: string; escalationId: string; reason: string; summary: string }> = []
      const unapprovedBriefs: Array<{ id: string; title: string }> = []
      const unapprovedSpecs: Array<{ id: string; title: string }> = []
      const shelvedUnclaimed: Array<{ id: string; title: string; detail?: string }> = []
      const blockedByAgent: Array<{ id: string; title: string; reason?: string }> = []
      const terminalStatuses = new Set(['done', 'shelved', 'cancelled', 'archived', 'pending_pr'])
      let unfinishedCount = 0

      for (const t of tasks) {
        const status = String((t as { status?: string }).status ?? 'unknown')
        statusCounts[status] = (statusCounts[status] ?? 0) + 1
        if (!terminalStatuses.has(status)) unfinishedCount += 1
        const id = String((t as { id?: string }).id ?? '')
        const title = String((t as { title?: string }).title ?? id)
        const brief = (t as { productBrief?: { approvedAt?: string } }).productBrief
        const terminal = terminalStatuses.has(status)
        const reservedImportTask = id === WORKSPACE_IMPORT_TASK_ID
        const approvalPendingStatus = status === 'proposed'
        if (brief && !brief.approvedAt && approvalPendingStatus && !terminal && !reservedImportTask) {
          unapprovedBriefs.push({ id, title })
        }
        if (status === 'spec_review') unapprovedSpecs.push({ id, title })
        if (status === 'shelved') {
          const reason = (t as { shelveReason?: { detail?: string } }).shelveReason
          shelvedUnclaimed.push({ id, title, ...(reason?.detail ? { detail: reason.detail } : {}) })
        }
        if (status === 'blocked') {
          const br = (t as { blockReason?: string }).blockReason
          blockedByAgent.push({ id, title, ...(br ? { reason: br } : {}) })
        }
        for (const e of activeEscalations(t as unknown as import('@guildhall/core').Task)) {
          openEscalations.push({
            taskId: id,
            taskTitle: title,
            escalationId: e.id,
            reason: e.reason,
            summary: e.summary,
          })
        }
      }

      const humanBlockingCount =
        openEscalations.length
        + unapprovedBriefs.length
        + unapprovedSpecs.length
        + blockedByAgent.length
      const designSystemBlockingCount = tasks.length > 0 && !designSystem.approved ? 1 : 0
      const dirtyCheckoutBlockingCount = dirtyCheckout.ownedCount > 0 || dirtyCheckout.error ? 1 : 0
      const gitStoryBlockingCount = gitStory.blockers.length
      const blockingCount =
        humanBlockingCount
        + unfinishedCount
        + designSystemBlockingCount
        + dirtyCheckoutBlockingCount
        + gitStoryBlockingCount

      return c.json({
        scope: closureScope,
        ready: tasks.length > 0 && blockingCount === 0,
        ...(tasks.length === 0 ? { notReadyReason: 'No tasks in this project yet.' } : {}),
        statusCounts,
        openEscalations,
        unapprovedBriefs,
        unapprovedSpecs,
        shelvedUnclaimed,
        blockedByAgent,
        designSystem,
        dirtyCheckout,
        gitStory,
        totals: {
          tasks: tasks.length,
          blockingCount,
          humanBlockingCount,
          unfinishedCount,
          designSystemBlockingCount,
          dirtyCheckoutBlockingCount,
          gitStoryBlockingCount,
          done: statusCounts['done'] ?? 0,
        },
      })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  async function guildhallOwnedDirtyCheckout(projectPath: string): Promise<{
    ownedCount: number
    files: string[]
    error?: string
  }> {
    const workspaceConfig = readWorkspaceConfig(projectPath)
    const childProjects = workspaceConfig.kind === 'workspace'
      ? resolveWorkspaceProjectPaths(projectPath, workspaceConfig)
      : []
    if (childProjects.length > 0) {
      const results = await Promise.all(childProjects.map(async (child) => {
        const result = await guildhallOwnedDirtyCheckoutInRepo(child.path)
        return {
          ...result,
          files: result.files.map(file => `${child.id}/${file}`),
        }
      }))
      const ownedFiles = results.flatMap(result => result.files)
      const errors = results.filter(result => result.error).map(result => result.error).filter(Boolean)
      return {
        ownedCount: ownedFiles.length,
        files: ownedFiles.slice(0, 12),
        ...(ownedFiles.length === 0 && errors.length === results.length && errors[0] ? { error: errors[0] } : {}),
      }
    }
    return guildhallOwnedDirtyCheckoutInRepo(projectPath)
  }

  async function guildhallOwnedDirtyCheckoutInRepo(projectPath: string): Promise<{
    ownedCount: number
    files: string[]
    error?: string
  }> {
    try {
      const { stdout } = await execFileP('git', ['status', '--short', '--untracked-files=all', '--', 'guildhall.yaml', '.guildhall', 'memory', '.gitignore'], {
        cwd: projectPath,
        timeout: 2000,
      })
      const files = stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.replace(/^[ MADRCU?!]{1,2}\s+/, '').trim())
        .filter(Boolean)
      return { ownedCount: files.length, files: files.slice(0, 12) }
    } catch (err) {
      return {
        ownedCount: 0,
        files: [],
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // -------------------------------------------------------------------------
  // API: setup wizard
  // -------------------------------------------------------------------------
  app.get('/api/setup/status', c => {
    const stored = readProjectConfig(currentProjectPath())
    const global = readGlobalConfig()
    return c.json({
      path: project.path,
      initialized: !project.initializationNeeded,
      providerConfigured: Boolean(stored.preferredProvider ?? global.preferredProvider),
      name: project.config?.name ?? null,
      id: project.config?.id ?? null,
      coordinatorCount: project.config?.coordinators?.length ?? 0,
    })
  })

  app.get('/api/setup/defaults', c => {
    const basename = project.path.split('/').pop() ?? 'project'
    const suggestedName = project.config?.name ?? humanizeGeneratedProjectName(basename)
    const suggestedId = project.config?.id ?? slugify(suggestedName)
    const localModels = MODEL_CATALOG
      .filter(m => m.provider === 'lm-studio')
      .map(m => ({ id: m.id, notes: m.notes ?? '' }))
    const cloudModels = MODEL_CATALOG
      .filter(m => m.provider !== 'lm-studio')
      .map(m => ({ id: m.id, provider: m.provider, notes: m.notes ?? '' }))
    return c.json({
      suggestedName,
      suggestedId,
      defaultLocalAssignment: DEFAULT_LOCAL_MODEL_ASSIGNMENT,
      localModels,
      cloudModels,
    })
  })

  app.post('/api/setup/identity', async c => {
    try {
      refreshProject(project.path)
      const body = await c.req.json().catch(() => ({})) as {
        name?: string
        id?: string
        projectPath?: string
        tags?: string[]
      }
      const name = body.name?.trim()
      if (!name) return c.json({ error: 'Missing "name"' }, 400)
      const id = (body.id?.trim() || slugify(name))
      if (!/^[a-z0-9-]+$/.test(id)) {
        return c.json({ error: 'ID must be lowercase letters, numbers, dashes only' }, 400)
      }
      const subProjectPath = body.projectPath?.trim() || undefined

      const existing = project.initializationNeeded ? null : readWorkspaceConfig(project.path)
      const nextConfig = {
        name,
        id,
        ...(subProjectPath ? { projectPath: subProjectPath } : existing?.projectPath ? { projectPath: existing.projectPath } : {}),
        ...(existing?.models ? { models: existing.models } : {}),
        coordinators: existing?.coordinators ?? [],
        maxRevisions: existing?.maxRevisions ?? 3,
        heartbeatInterval: existing?.heartbeatInterval ?? 5,
        ignore: existing?.ignore ?? ['node_modules', 'dist', '.git', 'coverage'],
        tags: body.tags ?? existing?.tags ?? [],
      }

      if (project.initializationNeeded) {
        bootstrapWorkspace(project.path, { name, ...(subProjectPath ? { projectPath: subProjectPath } : {}) })
      }
      writeWorkspaceConfig(project.path, nextConfig as Parameters<typeof writeWorkspaceConfig>[1])

      refreshProject(project.path)
      syncRegistryEntryForProject(project)
      return c.json({ ok: true, id: project.id, name, path: project.path })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // Providers: global (machine-scoped) credential store.
  //
  // Credentials live in ~/.guildhall/providers.yaml and are shared across
  // all projects on this machine. Project configs carry only a
  // `preferredProvider` selection — no secrets.
  //
  // Endpoints:
  //   GET  /api/setup/providers       detection + stored credentials
  //   POST /api/setup/providers/config set/update one provider's credential
  //                                    or the machine-default preferredProvider
  //   POST /api/providers/test        send-test-message roundtrip, marks verified
  //   POST /api/providers/disconnect  revoke a stored credential
  // -------------------------------------------------------------------------

  function describeProviders() {
    // Run the legacy-config migration on every request. It is idempotent
    // and cheap (a single YAML read + Zod parse) and means users who
    // upgrade in-place never see stale credentials in their project file.
    try {
      migrateProjectProvidersToGlobal(currentProjectPath(), {
        readProject: (p) => readProjectConfig(p),
        writeProject: (p, patch) => updateProjectConfig(p, patch),
      })
    } catch {
      /* best-effort — never let migration break the endpoint */
    }

    const global = readGlobalProviders()
    const creds = resolveGlobalCredentials(global, process.env)
    const claudeCredPath = join(homedir(), '.claude', '.credentials.json')
    const codexCredPath = join(homedir(), '.codex', 'auth.json')
    const claudeInstalled = existsSync(claudeCredPath)
    const codexInstalled = existsSync(codexCredPath)

    return {
      global,
      creds,
      claudeCredPath,
      codexCredPath,
      claudeInstalled,
      codexInstalled,
    }
  }

  async function probeLlamaCpp(url: string): Promise<boolean> {
    try {
      const res = await fetch(url + '/models', { signal: AbortSignal.timeout(800) })
      return res.ok
    } catch {
      return false
    }
  }

  app.get('/api/setup/providers', async c => {
    try {
      const { global, creds, claudeCredPath, codexCredPath, claudeInstalled, codexInstalled } =
        describeProviders()
      const stored = readProjectConfig(currentProjectPath())

      const defaultLlamaUrl = 'http://localhost:1234/v1'
      const configuredLlamaUrl = creds.llamaCppUrl ?? ''
      const llamaUrl = configuredLlamaUrl || defaultLlamaUrl
      const llamaReachable = llamaUrl.length > 0 ? await probeLlamaCpp(llamaUrl) : false
      const configuredOpenAiBaseUrl = creds.openaiBaseUrl ?? ''

      const v = (kind: ProviderKind) => global.providers[kind]?.verifiedAt ?? null
      const maxConcurrency = (kind: ProviderKind) => global.providers[kind]?.maxConcurrency ?? null

      return c.json({
        preferredProvider: stored.preferredProvider ?? readGlobalConfig().preferredProvider ?? null,
        providers: {
          'claude-oauth': {
            label: providerLabelForSetupKey('claude-oauth'),
            detected: claudeInstalled,
            verifiedAt: v('claude-oauth'),
            maxConcurrency: maxConcurrency('claude-oauth'),
            detail: claudeInstalled
              ? `Credentials detected at ${claudeCredPath}`
              : 'Install Claude Code and run `claude auth login`.',
          },
          'codex': {
            label: providerLabelForSetupKey('codex'),
            detected: codexInstalled,
            verifiedAt: v('codex-oauth'),
            maxConcurrency: maxConcurrency('codex-oauth'),
            detail: codexInstalled
              ? `Credentials detected at ${codexCredPath}`
              : 'Install the Codex CLI and run `codex auth login`.',
          },
          'llama-cpp': {
            label: providerLabelForSetupKey('llama-cpp'),
            detected: llamaReachable,
            verifiedAt: v('llama-cpp'),
            maxConcurrency: maxConcurrency('llama-cpp'),
            url: llamaReachable ? llamaUrl : configuredLlamaUrl || null,
            detail:
              configuredLlamaUrl.length === 0 && !llamaReachable
                ? `Not reachable at ${defaultLlamaUrl}. Start an OpenAI-compatible local server such as LM Studio or llama.cpp, or paste a server URL.`
                : llamaReachable
                  ? `Reachable at ${llamaUrl}`
                  : `Not reachable at ${llamaUrl}. Start an OpenAI-compatible local server such as LM Studio or llama.cpp and click refresh.`,
          },
          'anthropic-api': {
            label: providerLabelForSetupKey('anthropic-api'),
            detected: Boolean(creds.anthropicApiKey),
            verifiedAt: v('anthropic-api'),
            maxConcurrency: maxConcurrency('anthropic-api'),
            detail: global.providers['anthropic-api']?.apiKey
              ? 'Stored in ~/.guildhall/providers.yaml'
              : process.env.ANTHROPIC_API_KEY
                ? 'Picked up from $ANTHROPIC_API_KEY'
                : 'Paste an API key to enable.',
          },
          'openai-api': {
            label: providerLabelForSetupKey('openai-api'),
            detected: Boolean(creds.openaiApiKey),
            verifiedAt: v('openai-api'),
            maxConcurrency: maxConcurrency('openai-api'),
            baseUrl: configuredOpenAiBaseUrl || null,
            detail: global.providers['openai-api']?.apiKey
              ? configuredOpenAiBaseUrl
                ? `Stored in ~/.guildhall/providers.yaml · ${configuredOpenAiBaseUrl}`
                : 'Stored in ~/.guildhall/providers.yaml · defaults to https://api.openai.com/v1'
              : process.env.OPENAI_API_KEY
                ? configuredOpenAiBaseUrl
                  ? `Picked up from $OPENAI_API_KEY · ${configuredOpenAiBaseUrl}`
                  : 'Picked up from $OPENAI_API_KEY · defaults to https://api.openai.com/v1'
                : 'Paste an API key to enable. Leave base URL blank to use https://api.openai.com/v1.',
          },
        },
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/setup/providers/config', async c => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        provider?: string
        preferredProvider?: string
        anthropicApiKey?: string
        openaiApiKey?: string
        openaiBaseUrl?: string
        lmStudioUrl?: string
        maxConcurrency?: number
      }
      const allowed = SETUP_PROVIDER_ORDER
      const requestedMaxConcurrency = body.maxConcurrency == null
        ? undefined
        : Math.floor(Number(body.maxConcurrency))
      if (body.maxConcurrency != null) {
        const ceiling = readGlobalConfig().maxProviderConcurrency
        if (
          requestedMaxConcurrency == null ||
          !Number.isFinite(requestedMaxConcurrency) ||
          requestedMaxConcurrency < 1 ||
          requestedMaxConcurrency > ceiling
        ) {
          return c.json({ error: `maxConcurrency must be between 1 and ${ceiling}` }, 400)
        }
      }
      const maxConcurrency = requestedMaxConcurrency
      const providerForConcurrency = body.provider === 'codex'
        ? 'codex-oauth'
        : body.provider
      if (providerForConcurrency && !((
        [...allowed, 'codex-oauth'] as readonly string[]
      ).includes(providerForConcurrency))) {
        return c.json({ error: `Unknown provider "${body.provider}"` }, 400)
      }
      // preferredProvider is machine-level by default. Projects may still
      // override it locally when needed, but the setup flow writes the shared
      // default rather than stamping every project.
      if (body.preferredProvider) {
        if (!(allowed as readonly string[]).includes(body.preferredProvider)) {
          return c.json({ error: `Unknown provider "${body.preferredProvider}"` }, 400)
        }
        updateGlobalConfig({
          ...readGlobalConfig(),
          preferredProvider: body.preferredProvider as (typeof allowed)[number],
        })
      }
      if (
        maxConcurrency != null &&
        (providerForConcurrency === 'claude-oauth' || providerForConcurrency === 'codex-oauth')
      ) {
        const existing = readGlobalProviders().providers[providerForConcurrency]
        setProvider(providerForConcurrency, {
          ...(existing ?? {}),
          maxConcurrency,
        })
      }
      // Credentials go to the global store.
      if (typeof body.anthropicApiKey === 'string' && body.anthropicApiKey.trim().length > 0) {
        const existing = readGlobalProviders().providers['anthropic-api']
        setProvider('anthropic-api', {
          apiKey: body.anthropicApiKey.trim(),
          ...(existing?.verifiedAt ? { verifiedAt: existing.verifiedAt } : {}),
          ...(maxConcurrency != null && providerForConcurrency === 'anthropic-api'
            ? { maxConcurrency }
            : existing?.maxConcurrency
              ? { maxConcurrency: existing.maxConcurrency }
              : {}),
        })
      } else if (maxConcurrency != null && providerForConcurrency === 'anthropic-api') {
        const existing = readGlobalProviders().providers['anthropic-api']
        if (existing?.apiKey) setProvider('anthropic-api', { ...existing, maxConcurrency })
      }
      if (typeof body.openaiApiKey === 'string' && body.openaiApiKey.trim().length > 0) {
        const existing = readGlobalProviders().providers['openai-api']
        const baseUrl = (body.openaiBaseUrl ?? '').trim()
        setProvider('openai-api', {
          apiKey: body.openaiApiKey.trim(),
          ...(baseUrl ? { baseUrl } : {}),
          ...(existing?.verifiedAt ? { verifiedAt: existing.verifiedAt } : {}),
          ...(maxConcurrency != null && providerForConcurrency === 'openai-api'
            ? { maxConcurrency }
            : existing?.maxConcurrency
              ? { maxConcurrency: existing.maxConcurrency }
              : {}),
        })
      } else if (typeof body.openaiBaseUrl === 'string') {
        const existing = readGlobalProviders().providers['openai-api']
        if (existing?.apiKey) {
          const baseUrl = body.openaiBaseUrl.trim()
          setProvider('openai-api', {
            apiKey: existing.apiKey,
            ...(baseUrl ? { baseUrl } : {}),
            ...(existing.verifiedAt ? { verifiedAt: existing.verifiedAt } : {}),
            ...(maxConcurrency != null && providerForConcurrency === 'openai-api'
              ? { maxConcurrency }
              : existing.maxConcurrency
                ? { maxConcurrency: existing.maxConcurrency }
                : {}),
          })
        }
      } else if (maxConcurrency != null && providerForConcurrency === 'openai-api') {
        const existing = readGlobalProviders().providers['openai-api']
        if (existing?.apiKey) setProvider('openai-api', { ...existing, maxConcurrency })
      }
      if (typeof body.lmStudioUrl === 'string' && body.lmStudioUrl.trim().length > 0) {
        const url = body.lmStudioUrl.trim()
        const existing = readGlobalProviders().providers['llama-cpp']
        setProvider('llama-cpp', {
          url,
          ...(existing?.verifiedAt ? { verifiedAt: existing.verifiedAt } : {}),
          ...(maxConcurrency != null && providerForConcurrency === 'llama-cpp'
            ? { maxConcurrency }
            : existing?.maxConcurrency
              ? { maxConcurrency: existing.maxConcurrency }
              : {}),
        })
      } else if (maxConcurrency != null && providerForConcurrency === 'llama-cpp') {
        const existing = readGlobalProviders().providers['llama-cpp']
        if (existing?.url) setProvider('llama-cpp', { ...existing, maxConcurrency })
      }
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  function normalizeWorktreeIncludeLines(lines: unknown[]): string[] {
    const out: string[] = []
    for (const line of lines) {
      if (typeof line !== 'string') continue
      const withoutComment = line.replace(/\s+#.*$/, '').trim().replace(/^\/+/, '')
      if (!withoutComment) continue
      const normalized = withoutComment.replace(/\\/g, '/').replace(/\/+/g, '/')
      const parts = normalized.split('/')
      if (
        normalized.startsWith('../') ||
        normalized === '..' ||
        normalized.includes('/../') ||
        parts.some(part => part === '..') ||
        isAbsolute(normalized)
      ) {
        throw new Error('Worktree include paths must be project-relative and stay inside the project root.')
      }
      if (!out.includes(normalized)) out.push(normalized)
    }
    return out
  }

  async function discoverWorktreeIncludeCandidates(
    workspacePath: string,
    selected: string[],
  ): Promise<Array<{ path: string; reason: string; selected: boolean }>> {
    const projectRoot = resolve(workspacePath)
    const candidates = new Map<string, string>()
    const skipDirs = new Set(['.git', '.guildhall', 'node_modules', 'dist', 'build', 'coverage', 'memory'])
    const queue: Array<{ dir: string; depth: number }> = [{ dir: projectRoot, depth: 0 }]
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) break
      let entries: Dirent[]
      try {
        entries = readdirSync(current.dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        const absolute = join(current.dir, entry.name)
        const rel = relative(projectRoot, absolute).split(pathSeparator).join('/')
        if (!rel || rel.startsWith('..')) continue
        if (entry.isDirectory()) {
          if (skipDirs.has(entry.name)) continue
          if (current.depth < 3) queue.push({ dir: absolute, depth: current.depth + 1 })
          continue
        }
        if (!entry.isFile()) continue
        const reason = worktreeIncludeCandidateReason(entry.name, rel)
        if (!reason) continue
        if (await isTrackedProjectFile(projectRoot, absolute)) continue
        if (reason) candidates.set(rel, reason)
      }
    }
    for (const include of selected) {
      if (!candidates.has(include)) candidates.set(include, 'Already allowed for task worktrees.')
    }
    return [...candidates.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([candidatePath, reason]) => ({
        path: candidatePath,
        reason,
        selected: selected.includes(candidatePath),
      }))
  }

  async function isTrackedProjectFile(projectRoot: string, absolutePath: string): Promise<boolean> {
    const rootRelativePath = relative(projectRoot, absolutePath).split(pathSeparator).join('/')
    try {
      await execFileP('git', ['ls-files', '--error-unmatch', '--', rootRelativePath], {
        cwd: projectRoot,
      })
      return true
    } catch {
      const nestedGitRoot = findContainingGitRoot(projectRoot, absolutePath)
      if (!nestedGitRoot || nestedGitRoot === projectRoot) return false
      try {
        await execFileP('git', ['ls-files', '--error-unmatch', '--', relative(nestedGitRoot, absolutePath)], {
          cwd: nestedGitRoot,
        })
        return true
      } catch {
        return false
      }
    }
  }

  function findContainingGitRoot(projectRoot: string, absolutePath: string): string | null {
    const root = resolve(projectRoot)
    let current = dirname(resolve(absolutePath))
    while (current === root || current.startsWith(`${root}${pathSeparator}`)) {
      if (existsSync(join(current, '.git'))) return current
      const next = dirname(current)
      if (next === current) break
      current = next
    }
    return null
  }

  function workspaceBaseProjectPath(workspacePath: string, workspace: ReturnType<typeof readWorkspaceConfig>): string {
    return workspace.projectPath
      ? resolve(workspace.projectPath.replace(/^~/, homedir()))
      : resolve(workspacePath)
  }

  function resolveWorkspaceProjectEntryPath(
    workspacePath: string,
    workspace: ReturnType<typeof readWorkspaceConfig>,
    entry: { path: string },
  ): string {
    return isAbsolute(entry.path)
      ? resolve(entry.path)
      : resolve(workspaceBaseProjectPath(workspacePath, workspace), entry.path)
  }

  async function renderWorktreeIncludeScope(
    rootPath: string,
    include: string[],
    meta: { projectId?: string; label?: string; type?: string } = {},
  ): Promise<{
    projectId?: string
    label?: string
    type?: string
    rootPath: string
    include: string[]
    candidates: Array<{ path: string; reason: string; selected: boolean }>
  }> {
    return {
      ...meta,
      rootPath,
      include,
      candidates: await discoverWorktreeIncludeCandidates(rootPath, include),
    }
  }

  async function renderWorktreeIncludeResponse(
    workspacePath: string,
    selectedProjectId?: string,
  ): Promise<{
    include: string[]
    candidates: Array<{ path: string; reason: string; selected: boolean }>
    scopes: Array<{
      projectId?: string
      label?: string
      type?: string
      rootPath: string
      include: string[]
      candidates: Array<{ path: string; reason: string; selected: boolean }>
    }>
  }> {
    const workspace = readWorkspaceConfig(workspacePath)
    const workspaceScope = await renderWorktreeIncludeScope(
      workspaceBaseProjectPath(workspacePath, workspace),
      workspace.worktree?.include ?? [],
      { label: workspace.name },
    )
    const childScopes = await Promise.all(
      workspace.projects.map(projectEntry =>
        renderWorktreeIncludeScope(
          resolveWorkspaceProjectEntryPath(workspacePath, workspace, projectEntry),
          projectEntry.worktree?.include ?? [],
          {
            projectId: projectEntry.id,
            label: projectEntry.label ?? projectEntry.id,
            type: projectEntry.type,
          },
        ),
      ),
    )
    const scopes = childScopes.length > 0 ? childScopes : [workspaceScope]
    const activeScope = selectedProjectId
      ? scopes.find(scope => scope.projectId === selectedProjectId) ?? scopes[0]
      : scopes[0]
    return {
      include: activeScope?.include ?? [],
      candidates: activeScope?.candidates ?? [],
      scopes,
    }
  }

  function worktreeIncludeCandidateReason(fileName: string, relPath: string): string | null {
    const lowerName = fileName.toLowerCase()
    const lowerPath = relPath.toLowerCase()
    if (lowerName === '.env' || lowerName.startsWith('.env.')) {
      return 'Looks like a local environment file workers may need for bootstrap or tests.'
    }
    if (/^appsettings\.(local|development|dev)\.(json|ya?ml)$/.test(lowerName)) {
      return 'Looks like a local appsettings file workers may need for bootstrap or tests.'
    }
    if (/(^|\/)(local|dev|development)[^/]*\.(env|json|ya?ml|toml)$/.test(lowerPath)) {
      return 'Looks like local runtime configuration for this project.'
    }
    if (/(^|\/)(config|configs|settings)\/.*(local|dev|development).*\.(json|ya?ml|toml|env)$/.test(lowerPath)) {
      return 'Looks like project-local configuration under a config directory.'
    }
    return null
  }

  app.get('/api/project/local-config', async c => {
    try {
      const workspacePath = currentProjectPath()
      const projectCfg = readProjectConfig(workspacePath)
      const settings = await loadLeverSettings({
        path: defaultAgentSettingsPath(workspacePath),
      })
      let effectiveLandingBranch = projectCfg.landingBranch ?? null
      if (!effectiveLandingBranch) {
        try {
          const { stdout } = await execFileP('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd: workspacePath,
          })
          effectiveLandingBranch = stdout.trim() || null
        } catch {
          effectiveLandingBranch = null
        }
      }
      return c.json({
        landingBranch: projectCfg.landingBranch ?? null,
        effectiveLandingBranch,
        landingStrategy: settings.project.landing_strategy.position,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/local-config', async c => {
    try {
      const workspacePath = currentProjectPath()
      const body = (await c.req.json().catch(() => ({}))) as {
        landingBranch?: string | null
        landingStrategy?: 'cherry_pick_local' | 'cherry_pick_with_push' | 'manual_pr'
      }
      const nextPatch: Record<string, unknown> = {}
      if ('landingBranch' in body) {
        const raw = typeof body.landingBranch === 'string' ? body.landingBranch.trim() : ''
        nextPatch.landingBranch = raw.length > 0 ? raw : undefined
      }
      if (Object.keys(nextPatch).length > 0) {
        updateProjectConfig(workspacePath, nextPatch)
      }
      if (body.landingStrategy) {
        const allowed = ['cherry_pick_local', 'cherry_pick_with_push', 'manual_pr'] as const
        if (!allowed.includes(body.landingStrategy)) {
          return c.json({ error: `Unknown landing strategy "${body.landingStrategy}"` }, 400)
        }
        const path = defaultAgentSettingsPath(workspacePath)
        const settings = await loadLeverSettings({ path })
        settings.project.landing_strategy = {
          position: body.landingStrategy,
          rationale: 'Updated from Advanced settings.',
          setAt: new Date().toISOString(),
          setBy: 'user-direct',
        }
        await saveLeverSettings({ path, settings })
      }
      const projectCfg = readProjectConfig(workspacePath)
      const settings = await loadLeverSettings({
        path: defaultAgentSettingsPath(workspacePath),
      })
      return c.json({
        ok: true,
        landingBranch: projectCfg.landingBranch ?? null,
        landingStrategy: settings.project.landing_strategy.position,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/worktree-includes', async c => {
    try {
      const workspacePath = currentProjectPath()
      const workspaceProjectId = c.req.query('workspaceProjectId')?.trim() || undefined
      return c.json(await renderWorktreeIncludeResponse(workspacePath, workspaceProjectId))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/worktree-includes', async c => {
    try {
      const workspacePath = currentProjectPath()
      const body = (await c.req.json().catch(() => ({}))) as {
        include?: unknown
        includeText?: unknown
        workspaceProjectId?: unknown
      }
      const requested = Array.isArray(body.include)
        ? body.include
        : typeof body.includeText === 'string'
          ? body.includeText.split(/\r?\n/)
          : []
      const include = normalizeWorktreeIncludeLines(requested)
      const workspace = readWorkspaceConfig(workspacePath)
      const nextConfig = { ...workspace }
      const workspaceProjectId = typeof body.workspaceProjectId === 'string' && body.workspaceProjectId.trim().length > 0
        ? body.workspaceProjectId.trim()
        : undefined
      if (workspaceProjectId) {
        const projectIndex = nextConfig.projects.findIndex(projectEntry => projectEntry.id === workspaceProjectId)
        if (projectIndex < 0) return c.json({ error: `Unknown workspace project: ${workspaceProjectId}` }, 400)
        const projectEntry = nextConfig.projects[projectIndex]!
        nextConfig.projects[projectIndex] = include.length > 0
          ? { ...projectEntry, worktree: { ...(projectEntry.worktree ?? {}), include } }
          : { ...projectEntry, worktree: undefined }
      } else {
        if (nextConfig.kind === 'workspace' && nextConfig.projects.length > 0) {
          return c.json({ error: 'workspaceProjectId is required when saving worktree files for a multi-project workspace.' }, 400)
        }
        if (include.length > 0) {
          nextConfig.worktree = { ...(workspace.worktree ?? {}), include }
        } else {
          delete nextConfig.worktree
        }
      }
      writeWorkspaceConfig(workspacePath, nextConfig)
      refreshProject(project.path)
      return c.json({ ok: true, ...await renderWorktreeIncludeResponse(workspacePath, workspaceProjectId) })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  app.get('/api/config/models', async c => {
    try {
      const global = readGlobalConfig()
      const workspacePath = currentProjectPath()
      const workspace = readWorkspaceConfig(workspacePath)
      const projectCfg = readProjectConfig(workspacePath)
      const preferredProvider = projectCfg.preferredProvider ?? global.preferredProvider
      const resolved = resolveConfig({ workspacePath })
      const creds = resolveGlobalCredentials()
      const loadedModels = creds.llamaCppUrl
        ? await loadedLlamaModelIds(creds.llamaCppUrl).catch(() => [])
        : []
      const missingModels = loadedModels.length > 0
        ? missingAssignedModels(resolved.models, loadedModels)
        : []
      return c.json({
        globalModels: resolveModelsForProvider(global.models, preferredProvider),
        projectModels: resolveModelsForProvider(workspace.models, preferredProvider),
        effectiveModels: resolved.models,
        globalBehavior: global.modelBehavior ?? {},
        projectBehavior: workspace.modelBehavior ?? {},
        effectiveBehavior: resolved.modelBehavior,
        behaviorProfiles: MODEL_BEHAVIOR_PROFILES,
        loadedModels,
        missingModels,
        catalog: [
          ...new Map(
            [
              ...loadedModels.map(id => ({
                id,
                provider: 'openai-compatible',
                notes: 'Loaded on the configured local server',
              })),
              ...MODEL_CATALOG.map(m => ({
                id: m.id,
                provider: m.provider,
                notes: m.notes ?? '',
              })),
              ...Object.values(resolveModelsForProvider(global.models, preferredProvider)).map(id => ({
                id,
                provider: 'openai-compatible',
                notes: 'Global default',
              })),
              ...Object.values(resolveModelsForProvider(workspace.models, preferredProvider)).map(id => ({
                id,
                provider: 'openai-compatible',
                notes: 'Project override',
              })),
            ].map(item => [item.id, item]),
          ).values(),
        ],
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/config/models', async c => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        scope?: 'global' | 'project' | 'global-default'
        role?: keyof ModelAssignmentConfig
        model?: string
        models?: Partial<ModelAssignmentConfig>
        behaviorProfile?: ModelBehaviorProfile
      }
      const roles: Array<keyof ModelAssignmentConfig> = ['spec', 'coordinator', 'worker', 'reviewer', 'gateChecker', 'contextIndexer']
      const behaviorIds = new Set(MODEL_BEHAVIOR_PROFILES.map(profile => profile.id))
      if (!body.scope) return c.json({ error: 'Missing "scope"' }, 400)
      if (body.scope !== 'global' && !c.req.query('projectId')?.trim()) {
        return c.json({ error: 'Choose a project before saving project model overrides.' }, 400)
      }
      const workspacePath = currentProjectPath()
      const projectCfg = readProjectConfig(workspacePath)
      const preferredProvider = projectCfg.preferredProvider ?? readGlobalConfig().preferredProvider

      const requestedModels = body.models && typeof body.models === 'object'
        ? Object.entries(body.models).filter((entry): entry is [keyof ModelAssignmentConfig, string] => {
            const [role, model] = entry
            return roles.includes(role as keyof ModelAssignmentConfig) && typeof model === 'string'
          })
        : null
      if (body.models && requestedModels?.length !== Object.keys(body.models).length) {
        return c.json({ error: 'Unknown model role' }, 400)
      }
      if (!requestedModels && (!body.role || !roles.includes(body.role))) {
        return c.json({ error: 'Unknown model role' }, 400)
      }
      if (body.role && !roles.includes(body.role)) {
        return c.json({ error: 'Unknown model role' }, 400)
      }
      const requestedBehavior = typeof body.behaviorProfile === 'string'
        ? body.behaviorProfile.trim()
        : undefined
      if (requestedBehavior && !behaviorIds.has(requestedBehavior as ModelBehaviorProfile)) {
        return c.json({ error: 'Unknown behavior profile' }, 400)
      }
      const hasSingleModel = typeof body.model === 'string'
      const hasBehavior = requestedBehavior !== undefined
      if (!requestedModels && !hasSingleModel && !hasBehavior && body.scope !== 'global-default') {
        return c.json({ error: 'Missing "model" or behaviorProfile' }, 400)
      }

      if (body.scope === 'global') {
        const global = readGlobalConfig()
        const nextModels = { ...resolveModelsForProvider(global.models, preferredProvider) }
        if (requestedModels) {
          for (const [role, model] of requestedModels) {
            const trimmed = model.trim()
            if (!trimmed) return c.json({ error: 'Missing "model"' }, 400)
            nextModels[role] = trimmed
          }
        } else if (hasSingleModel) {
          const model = body.model?.trim()
          if (!model || !body.role) return c.json({ error: 'Missing "model"' }, 400)
          nextModels[body.role] = model
        }
        updateGlobalConfig({
          ...global,
          ...(requestedModels || hasSingleModel
            ? { models: writeModelsForProvider(global.models, preferredProvider, nextModels) }
            : {}),
          ...(requestedBehavior && body.role
            ? { modelBehavior: { ...(global.modelBehavior ?? {}), [body.role]: requestedBehavior as ModelBehaviorProfile } }
            : {}),
        })
        return c.json({ ok: true })
      }

      const workspace = readWorkspaceConfig(workspacePath)
      const nextModels = { ...resolveModelsForProvider(workspace.models, preferredProvider) }
      const nextBehavior = { ...(workspace.modelBehavior ?? {}) }
      if (body.scope === 'global-default') {
        if (requestedModels) {
          for (const [role] of requestedModels) delete nextModels[role]
        } else if (body.role) {
          delete nextModels[body.role]
          delete nextBehavior[body.role]
        }
      } else if (body.scope === 'project') {
        if (requestedModels) {
          for (const [role, model] of requestedModels) {
            const trimmed = model.trim()
            if (!trimmed) return c.json({ error: 'Missing "model"' }, 400)
            nextModels[role] = trimmed
          }
        } else if (hasSingleModel && body.role) {
          const model = body.model?.trim()
          if (!model) return c.json({ error: 'Missing "model"' }, 400)
          nextModels[body.role] = model
        }
        if (requestedBehavior && body.role) {
          nextBehavior[body.role] = requestedBehavior as ModelBehaviorProfile
        }
      } else {
        return c.json({ error: 'Unknown model scope' }, 400)
      }

      const nextConfig = { ...workspace }
      if (Object.keys(nextModels).length > 0) {
        nextConfig.models = writeModelsForProvider(workspace.models, preferredProvider, nextModels)
      } else {
        delete nextConfig.models
      }
      if (Object.keys(nextBehavior).length > 0) {
        nextConfig.modelBehavior = nextBehavior
      } else {
        delete nextConfig.modelBehavior
      }
      writeWorkspaceConfig(workspacePath, nextConfig)
      refreshProject(project.path)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  function providerRoundtripSampleFromMessage(message: {
    content?: Array<
      | { type: 'text'; text: string }
      | { type: 'reasoning'; text: string }
      | { type: 'tool_use'; name: string }
      | Record<string, unknown>
    >
  }): string {
    const blocks = Array.isArray(message.content) ? message.content : []
    const text = blocks
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim()
    if (text.length > 0) return text
    const reasoning = blocks
      .filter((block): block is { type: 'reasoning'; text: string } => block.type === 'reasoning')
      .map(block => block.text)
      .join('')
      .trim()
    if (reasoning.length > 0) return '[reasoning response]'
    const toolUse = blocks.find((block): block is { type: 'tool_use'; name: string } => block.type === 'tool_use')
    if (toolUse) return `[tool call: ${toolUse.name}]`
    return ''
  }

  // Pick a cheap, widely-available model id for a verification round-trip
  // against each provider. For llama.cpp we ask the server which model is
  // currently loaded (it owns that choice; we can't know locally).
  async function modelForRoundtrip(
    name: PreferredProviderKey,
    llamaUrl: string,
  ): Promise<string | undefined> {
    const configured = resolveModelsForProvider(readGlobalConfig().models, name)
    switch (name) {
      case 'claude-oauth':
      case 'anthropic-api':
        return configured.worker ?? configured.spec ?? 'claude-haiku-4-5-20251001'
      case 'openai-api':
        return configured.worker ?? configured.spec ?? 'gpt-4o-mini'
      case 'codex':
      case 'codex-oauth':
        return configured.worker ?? configured.spec ?? 'gpt-5.3-codex'
      case 'llama-cpp': {
        if (!llamaUrl) return undefined
        try {
          const res = await fetch(llamaUrl.replace(/\/$/, '') + '/models', {
            signal: AbortSignal.timeout(1500),
          })
          if (!res.ok) return undefined
          const body = (await res.json()) as { data?: Array<{ id?: string }> }
          const first = body.data?.[0]?.id
          return typeof first === 'string' && first.length > 0 ? first : undefined
        } catch {
          return undefined
        }
      }
    }
  }

  /**
   * Send a trivial prompt through the provider's real client and return a
   * success marker + first-chars sample (or a human-readable error). The
   * caller records a verifiedAt timestamp on success. No fallback magic:
   * if the forced provider isn't reachable with the configured creds we
   * surface exactly that failure so the user can fix it.
   */
  async function testProviderRoundtrip(
    name: PreferredProviderKey,
  ): Promise<{ ok: boolean; error?: string; sample?: string }> {
    const global = readGlobalProviders()
    const creds = resolveGlobalCredentials(global, process.env)
    const forced: PreferredProviderKey = name
    const forcedInternal = forced === 'codex' ? 'codex-oauth' : forced
    const model = await modelForRoundtrip(forced, creds.llamaCppUrl ?? '')
    if (!model) {
      return {
        ok: false,
        error:
          forced === 'llama-cpp'
            ? 'No model loaded on the configured OpenAI-compatible local server. Load a model and try again.'
            : `No default model known for ${forced}.`,
      }
    }
    let selected
    try {
      selected = await selectApiClient(buildSelectApiClientOptions({
        providerOverride: forcedInternal,
        credentials: creds,
      }))
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    if (selected.providerName === 'none') {
      return { ok: false, error: selected.reason ?? `${forced} not available.` }
    }
    try {
      let sample = ''
      const iterable = selected.apiClient.streamMessage({
        model,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Reply with a single word: OK' }],
          },
        ],
        max_tokens: 32,
        tools: [],
      })
      for await (const ev of iterable) {
        if (ev.type === 'text_delta') {
          sample += ev.text
          if (sample.length > 80) break
        } else if (ev.type === 'message_complete') {
          if (sample.trim().length === 0) sample = providerRoundtripSampleFromMessage(ev.message)
          break
        }
      }
      const trimmed = sample.trim()
      if (trimmed.length === 0) {
        return { ok: false, error: 'Provider returned an empty response.' }
      }
      return { ok: true, sample: trimmed.slice(0, 80) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // Send a trivial prompt through the provider's real client and mark
  // verified on success. This is the "did my paste actually work?" button
  // — the alpha-critical piece that was missing before.
  app.post('/api/providers/test', async c => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { provider?: string }
      const allowed = SETUP_PROVIDER_ORDER
      const name = body.provider
      if (!name || !(allowed as readonly string[]).includes(name)) {
        return c.json({ ok: false, error: `Unknown provider "${name ?? ''}"` }, 400)
      }
      const result = await testProviderRoundtrip(name as (typeof allowed)[number])
      if (result.ok) {
        const storeKind: ProviderKind =
          name === 'codex' ? 'codex-oauth' : (name as ProviderKind)
        try {
          markProviderVerified(storeKind)
        } catch {
          /* verification timestamp is a convenience, not required */
        }
      }
      return c.json(result)
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // Revoke a stored credential. For OAuth providers we just clear the
  // "verified" marker; the actual credential lives in a CLI directory
  // that we do not touch.
  app.post('/api/providers/disconnect', async c => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { provider?: string }
      const allowed = SETUP_PROVIDER_ORDER
      const name = body.provider
      if (!name || !(allowed as readonly string[]).includes(name)) {
        return c.json({ ok: false, error: `Unknown provider "${name ?? ''}"` }, 400)
      }
      const storeKind: ProviderKind =
        name === 'codex' ? 'codex-oauth' : (name as ProviderKind)
      if (storeKind === 'claude-oauth' || storeKind === 'codex-oauth') {
        // Clear the verified marker; CLI-managed credential is left alone.
        removeProvider(storeKind)
        return c.json({
          ok: true,
          note: 'Cleared the verified marker. The underlying OAuth credential is managed by the CLI — run its logout command to revoke it fully.',
        })
      }
      removeProvider(storeKind)
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // SSE stream
  // -------------------------------------------------------------------------
  app.get('/api/project/events', c => {
    return streamSSE(c, async stream => {
      await stream.writeSSE({ data: JSON.stringify({ type: 'connected', projectId: project.id }) })
      for (const ev of supervisor.recent(project.id, undefined, project.path)) {
        await stream.writeSSE({ data: JSON.stringify(ev) })
      }
      const unsubscribe = supervisor.subscribe(ev => {
        if (ev.workspaceId !== project.id) return
        void stream.writeSSE({ data: JSON.stringify(ev) })
      })
      let running = true
      stream.onAbort(() => { running = false; unsubscribe() })
      while (running) {
        await stream.sleep(15_000)
        if (!running) break
        await stream.writeSSE({
          data: JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() }),
        })
      }
    })
  })

  // -------------------------------------------------------------------------
  // Static web bundle (Svelte 5 dashboard). dist/web/ is emitted by build.mjs.
  // The bundle mounts into the #svelte-root element in dashboardHtml().
  // -------------------------------------------------------------------------
  app.get('/web/app.js', c => serveWebAsset(c, 'app.js', 'text/javascript; charset=utf-8'))
  app.get('/web/app.css', c => serveWebAsset(c, 'app.css', 'text/css; charset=utf-8'))
  app.get('/web/app.js.map', c => serveWebAsset(c, 'app.js.map', 'application/json'))
  app.get('/web/app.css.map', c => serveWebAsset(c, 'app.css.map', 'application/json'))
  app.get('/icons/:filename', c => serveWebIcon(c, c.req.param('filename')))
  app.get('/favicon.ico', c => serveWebIcon(c, 'favicon.ico'))
  app.get('/apple-touch-icon.png', c => serveWebIcon(c, 'apple-touch-icon.png'))
  app.get('/site.webmanifest', c => serveWebIcon(c, 'site.webmanifest'))

  // -------------------------------------------------------------------------
  // SPA (catch-all)
  // -------------------------------------------------------------------------
  app.get('*', c => {
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate')
    c.header('Pragma', 'no-cache')
    return c.html(dashboardHtml())
  })

  return { app, supervisor, projectPath }
}

export async function runServe(opts: ServeOptions = {}): Promise<void> {
  const { app, supervisor, projectPath } = buildServeApp(opts)
  const project = resolveProject(projectPath)
  const cfg = readProjectConfig(projectPath)
  const port = opts.port ?? cfg.servePort

  console.log('[guildhall serve] Guildhall local service')
  if (opts.preferredProjectPath ?? opts.projectPath) {
    console.log(`[guildhall serve] Initial project: ${resolve(opts.preferredProjectPath ?? opts.projectPath ?? project.path)}`)
  } else {
    console.log('[guildhall serve] Initial project: Projects home')
  }
  console.log(`[guildhall serve] Selected project: ${project.path}`)
  console.log(`[guildhall serve] ${project.initializationNeeded ? '⚠ Foreground project not initialized — wizard at /setup' : `✓ ${project.config?.name ?? project.id}`}`)
  console.log(`[guildhall serve] URL: http://localhost:${port}`)
  console.log(`[guildhall serve] PID: ${process.pid}`)
  // Heads-up to any humans: Node loaded the dist into memory at startup.
  // Subsequent rebuilds need a kill+restart to take effect. The web app
  // surfaces this as a banner via /api/build-info — this line just makes
  // the same fact visible from the terminal.
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const distEntry = [join(here, 'cli.js'), join(here, '..', 'cli.js')].find(p => existsSync(p))
    if (distEntry) {
      const mtime = statSync(distEntry).mtimeMs
      console.log(`[guildhall serve] Loaded build: ${new Date(mtime).toISOString()}  (${distEntry})`)
      console.log(`[guildhall serve] Rebuild → restart required (kill ${process.pid} + re-run).`)
    }
  } catch {
    /* non-fatal */
  }
  console.log(`[guildhall serve] Press Ctrl+C to stop.`)
  console.log()

  const server = serve({ fetch: app.fetch, port }, info => {
    console.log(`[guildhall serve] ✓ Running at http://localhost:${info.port}`)
    if (opts.serviceStatePath) {
      try {
        mkdirSync(dirname(opts.serviceStatePath), { recursive: true })
        writeFileSync(opts.serviceStatePath, JSON.stringify({
          pid: process.pid,
          port: info.port,
          url: `http://localhost:${info.port}`,
          startedAt: new Date().toISOString(),
        }, null, 2))
      } catch {
        /* non-fatal */
      }
    }
  })

  // FR-28 / AC-19: cooperative shutdown. SIGINT (Ctrl+C) and SIGTERM both
  // drive the same path: stop every running supervisor (which writes the
  // stop marker, flips stopSignal, waits for in-flight ticks to drain,
  // and cleans up registered children), then close the HTTP server, then
  // exit 0. Handlers are idempotent — the shuttingDown flag avoids the
  // "Ctrl+C twice" hard-exit being interpreted as a regression.
  let shuttingDown = false
  const removeServiceStateIfOwned = async (): Promise<void> => {
    if (!opts.serviceStatePath) return
    try {
      const raw = await fsp.readFile(opts.serviceStatePath, 'utf8').catch(() => null)
      if (!raw) return
      const parsed = JSON.parse(raw) as { pid?: unknown }
      if (parsed.pid !== process.pid) return
      await fsp.rm(opts.serviceStatePath, { force: true })
    } catch {
      /* non-fatal */
    }
  }
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`\n[guildhall serve] Guildhall is shutting down... (${signal})`)
    try {
      await supervisor.stopAll({ reason: `signal:${signal}` })
    } catch (err) {
      console.warn(`[guildhall serve] stopAll error: ${err instanceof Error ? err.message : String(err)}`)
    }
    await removeServiceStateIfOwned()
    await closeHttpServerForShutdown(server)
    console.log('[guildhall serve] Shutdown complete.')
    process.exit(0)
  }
  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
}

// ---------------------------------------------------------------------------
// Web bundle (dist/web/) lives alongside the built cli.js. At runtime we
// resolve it relative to this module's URL so it works both in the esbuild
// bundle (dist/cli.js) and when running the TS sources via vitest (where
// dist/web/ is still the build output we expect to exist).
// ---------------------------------------------------------------------------

const WEB_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  // In the bundled build, cli.js sits at dist/cli.js and web assets at dist/web/.
  // In dev (running from src/runtime), we walk up to the repo root and find dist/web.
  const bundled = join(here, 'web')
  if (existsSync(bundled)) return bundled
  return resolve(here, '..', '..', 'dist', 'web')
})()

const WEB_ASSET_VERSION = (() => {
  try {
    return String(Math.floor(statSync(join(WEB_DIR, 'app.js')).mtimeMs))
  } catch {
    return 'dev'
  }
})()

async function serveWebAsset(
  c: Context,
  filename: string,
  contentType: string,
): Promise<Response> {
  const path = join(WEB_DIR, filename)
  if (!existsSync(path)) {
    return c.text(`web asset not built: ${filename} (run pnpm build)`, 404)
  }
  const body = await fsp.readFile(path)
  return new Response(body, {
    headers: {
      'content-type': contentType,
      'cache-control': 'no-store, no-cache, must-revalidate',
      pragma: 'no-cache',
    },
  })
}

function iconContentType(filename: string): string {
  const extension = extname(filename).toLowerCase()
  if (extension === '.ico') return 'image/x-icon'
  if (extension === '.png') return 'image/png'
  if (extension === '.webmanifest') return 'application/manifest+json; charset=utf-8'
  return 'application/octet-stream'
}

async function serveWebIcon(c: Context, filename: string): Promise<Response> {
  const safeName = basename(filename)
  if (safeName !== filename) return c.text('invalid icon path', 400)
  return serveWebAsset(c, join('icons', safeName), iconContentType(safeName))
}

// ---------------------------------------------------------------------------
// Inline dashboard SPA
// ---------------------------------------------------------------------------

export function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#0f0d16" />
  <title>Guildhall</title>
  <link rel="icon" href="/favicon.ico" sizes="any" />
  <link rel="icon" type="image/png" sizes="32x32" href="/icons/genfavicon-32.png" />
  <link rel="icon" type="image/png" sizes="16x16" href="/icons/genfavicon-16.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/site.webmanifest" />
  <link rel="stylesheet" href="/web/app.css?v=${WEB_ASSET_VERSION}" />
</head>
<body>
  <div id="svelte-root"></div>
  <noscript>
    <p style="color:#e8e8f0;background:#0f0f11;padding:24px;font-family:system-ui,sans-serif">
      Guildhall requires JavaScript. Enable it and reload.
    </p>
  </noscript>
  <script type="module" src="/web/app.js?v=${WEB_ASSET_VERSION}"></script>
</body>
</html>`
}
