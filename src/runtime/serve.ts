import { writeManagedTextFileSync } from '@guildhall/persistence'
import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
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
import { atomicWriteText, getProjectStateDir, getProjectSystemStatePath, getProjectTranscriptPath, upsertTaskRuntimeState } from '@guildhall/sessions'
import { readTaskWorkspaceStore } from './task-state-store.js'
import { taskHasRecordedCompletionProof } from './task-completion-proof.js'
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
  resolveSupersededEscalations,
  isMaterializableSplitAction,
  materializeSplitChildren,
  settleAlreadyRepresentedSplitRecommendations,
  settleMaterializedSplitReadiness,
  updateDesignSystem,
} from '@guildhall/tools'
import { DesignSystem, parseAcceptanceCriteriaFromSpec, summarizeDesignSystem, TaskQueue, type DesignSystem as DesignSystemRecord, type ProjectRelease, type Task } from '@guildhall/core'
import {
  loadProjectGuildRoster,
  selectApplicableGuilds,
  reviewersForTask,
  pickPrimaryEngineer,
} from '@guildhall/guilds'
import { OrchestratorSupervisor } from './serve-supervisor.js'
import { resolveFanoutCapacity } from './fanout-dispatcher.js'
import { detectShadowedCurrentMilestoneDeliverableImports as detectShadowedCurrentMilestoneDeliverables } from './current-milestone-shadowing.js'
import {
  normalizePreferredProvider,
  selectApiClient,
  type PreferredProviderKey,
  type ProviderName,
} from './provider-selection.js'
import { normalizeLegacyTaskQueueShape } from './task-queue-compat.js'
import { resolveEffectiveTaskProjectPath } from './task-gates.js'
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
  listPressureTestIntakesAsync,
  summarizeProjectCheckIn,
} from './pressure-test-intake.js'
import { routeRequest } from './request-routing.js'
import {
  answerProjectCheckInBoundedChat,
  createProjectCheckInBoundedChat,
  resumeProjectCheckInBoundedChat,
} from './bounded-chat-project-check-in.js'
import {
  answerNewRequestBoundedChat,
  createNewRequestBoundedChat,
} from './bounded-chat-new-request.js'
import {
  listBoundedChatSessions,
  listBoundedChatSessionsAsync,
  loadBoundedChatSession,
  submitBoundedChatUserResponse,
} from './bounded-chat.js'
import { loadDesignSystem, saveDesignSystem } from './design-system-store.js'
import { discoverDesignPreviewAdapter } from './design-preview.js'
import { buildDesignSystemProfile } from './design-system-discovery.js'
import {
  buildDesignDecisionPacket,
  captureOwnerDesignFeedback,
  readDesignFeedbackStore,
  recordDesignFinding,
  routeDesignFinding,
} from './design-feedback.js'
import { buildDesignSystemCatalog } from './design-system-catalog.js'
import { buildDesignIntentSurrogate } from './design-intent-surrogate.js'
import {
  listExternalAgentLinks,
  recordExternalAgentLink,
} from './external-agent-links.js'
import { deriveProjectWorkProgress, type ProjectWorkProgress } from './work-progress.js'
import { deriveTaskWorkVisibility } from './work-visibility.js'
import {
  buildProjectOrientationSpine,
  taskNodeId,
  taskEligibleForSelectedScope,
  type BuildProjectOrientationSpineInput,
  type OrientationScope,
  type ProjectOrientationCharter,
} from './project-orientation-spine.js'
import { buildProjectScopeProjection, type ProjectScope } from './project-scope-projection.js'
import type { SurfaceReviewPacket } from './contract-surfaces.js'
import {
  acceptProjectDependencyDelivery,
  assignProjectDomainAuthority,
  assignProjectDomainResponsibility,
  beginProjectDependencyConsumerReview,
  commitProjectDependencyDeliveryPlan,
  deliverProjectDependency,
  importProjectDependencyRequestForProvider,
  queryProjectGraphView,
  requestProjectDependencyRevision,
  reviseProjectDependencyPlan,
  type ConsumerReturnPacket,
  type DeliveryReceipt,
  type ProjectDependencyEdge,
  type ProjectDomainResponsibilityFacet,
  type ProjectGraphNodeRef,
} from './project-graph.js'
import {
  applyContractChangeSet,
  buildTaskContextPacket,
  deriveQueueCandidates,
  deriveTaskRelationships,
  listPrimitivesWithRelations,
  planTaskSplit,
  readProjectDeliveryModel,
  rejectContractChangeSet,
  revertAppliedContractResult,
  validateProjectDeliveryModel,
  writeProjectDeliveryModel,
  type ContractChangeSet,
} from './delivery-spine.js'
import {
  applyStructuralMapReviewAction,
  readAcceptedStructuralMap,
  summarizeStructuralMapForReview,
  type StructuralMapReviewAction,
} from './structural-map.js'
import { summarizeStructuralTaskContexts } from './structural-task-context.js'
import { loadEffectiveDesignTaste } from './design-taste.js'
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
  materializeParsedWorkspaceImport,
  materializeWorkspaceImportDraft,
  mergeWorkspaceImportDraft,
  parseWorkspaceImport,
  readWorkspaceImportSummary,
  readWorkspaceGoalsState,
  rerunWorkspaceImportTask,
  summarizeWorkspaceImportSpec,
  workspaceGoalsNeedStructuralRefresh,
  workspaceNeedsImport,
  workspaceImportYamlErrors,
  WORKSPACE_IMPORT_TASK_ID,
  workspaceImportTasksPath,
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
import { importedTaskNeedsBriefShaping, normalizeImportedDraftTask } from './import-drafts.js'
import { selectedReleaseScopeForQueue } from './orchestrator-picker.js'
import { specReviewRequiresOwnerApproval } from './spec-review-ownership.js'
import {
  buildInbox,
  buildInboxBlockers,
  detectRepoAnchors,
  isAttentionOwnedInboxItem,
} from './inbox.js'
import {
  findOwnerInputRequestBySource,
  listOwnerInputRequestsSync,
  markOwnerInputRequestForBoundedChatReview,
} from './owner-input-store.js'
import {
  buildProjectMigrationAdvisories,
  buildProjectUnderstandingAdvisories,
  markAttentionDismissed,
  reconcileAttentionRecords,
  recordReconciliationResolved,
  type AttentionRecord,
} from './attention.js'
import { projectRuntimeCompatibilityBlocker } from './runtime-compatibility.js'
import { ProjectRuntimeSupervisor } from './project-runtime-supervisor.js'
import {
  findStaleGuildhallProcesses,
  listGuildhallProcesses,
  stopStaleGuildhallProcesses,
  type GuildhallProcessInfo,
} from './stale-guildhall-processes.js'
import { createCapabilityRequest, listCapabilityRequests } from './capability-requests.js'
import {
  approveMountDirectoryRequest,
  denyCapabilityRequest,
  listActiveCapabilityGrants,
  markCapabilityRequestBlocked,
  revokeCapabilityGrant,
} from './capability-grants.js'
import {
  parseDeniedHostAccess,
  ProjectRuntimeCommandRequest,
  suggestedCapabilityMountForHostPath,
} from './project-runtime-command.js'
import { listMemoryRecords } from './memory-store.js'
import { buildMemoryCoreCandidatePacket, resolveMemoryPaths } from '@guildhall/memory-core'
import { readProjectRuntimeState } from './project-runtime-store.js'
import {
  pauseProjectAvailability,
  readProjectAvailability,
  resumeProjectAvailability,
} from './project-availability.js'
import {
  DevServerManager,
  type StartDevServerRequest,
} from './dev-server-manager.js'
import {
  detectRuntimeBackendSetup,
  runRuntimeBackendSetupAction,
  type RuntimeBackendSetupDetector,
} from './runtime-backend-setup.js'
import { buildThread } from './thread.js'
import { buildProjectActionModel, type ProjectActionModel } from './project-action-model.js'
import { NodeGitDriver } from './git-driver.js'
import {
  inspectGitStory,
  summarizeGitStories,
  type GitStorySummary,
} from './git-story.js'
import {
  discoverChildGitProjects,
  effectiveGitStoryPolicy,
  resolveGitStoryWorkspaceProject,
  resolveWorkspaceProjectPaths,
  resolveWorkspaceProjectPathsOrDiscover,
} from './git-story-policy.js'
import { taskHasUnansweredVisibleQuestion } from './question-visibility.js'
import { validateSpecCompletionBoundary } from './spec-quality.js'
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
  buildSnapshotAsync,
  listWizards,
  progressFor,
  readWizardsState,
  emptyWizardsState,
  buildTaskSnapshot,
  listTaskWizards,
  progressForTask,
  type WizardsState,
} from './wizards.js'
import { invalidateCachedFile, readCachedJson } from './file-read-cache.js'
import { applyProjectMigrations, getProjectMigrationStatus } from './migrations.js'
import { stringify as stringifyYaml } from 'yaml'
import {
  applyProjectReintakeDraft,
  planProjectReintake,
  readProjectReintakeDraft,
  writeProjectReintakeDraft,
} from './project-reintake.js'

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
  /** Optional project-runtime supervisor override for tests. */
  runtimeSupervisor?: ProjectRuntimeSupervisor
  /** Optional orchestrator supervisor override for tests. */
  supervisor?: OrchestratorSupervisor
  /** Optional runtime backend setup detector override for tests. */
  runtimeBackendSetup?: RuntimeBackendSetupDetector
  /** Optional runtime dev-server manager override for tests. */
  devServerManager?: Pick<DevServerManager, 'list' | 'start' | 'stop' | 'restart'>
  /** Optional stale Guildhall process guard overrides for tests. */
  staleProcessGuard?: {
    listProcesses?: () => Promise<GuildhallProcessInfo[]>
    killProcess?: (pid: number, signal?: NodeJS.Signals) => void
  }
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
  projectStatusLoading?: boolean
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
  workProgress?: ProjectWorkProgress
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
  startReadiness?: {
    canStart: boolean
    code?: string
    message?: string
    actionHref?: string
    focusTaskId?: string
    focusTaskTitle?: string
    focusKind?: string
    count?: number
  } | null
  migrationSummary?: {
    pending: number
    blocked: number
    applied: number
    error?: string
  }
  projectCheckIn?: ReturnType<typeof summarizeProjectCheckIn> | null
  actionModel?: ProjectActionModel | null
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
        const pkg = JSON.parse(readManagedTextFileSync(join(dir, 'package.json'), 'utf8')) as { packageManager?: string }
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

async function collectProjectReintakeSources(projectPath: string): Promise<Array<{ path: string; content: string }>> {
  const sources: Array<{ path: string; content: string }> = []
  const skip = new Set(['.git', '.guildhall', 'node_modules', 'dist', 'build'])
  const maxSources = 80

  async function walk(dir: string): Promise<void> {
    if (sources.length >= maxSources) return
    let entries: Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (sources.length >= maxSources) return
      if (skip.has(entry.name)) continue
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      const ext = extname(entry.name).toLowerCase()
      if (!['.md', '.markdown', '.txt'].includes(ext)) continue
      let content = ''
      try {
        content = await readManagedTextFile(absolute, 'utf-8')
      } catch {
        continue
      }
      if (!/Deliverable|Foundation|Consumer|should say|missing|Needed contracts|Recommended first task title|Stage alignment|Current Next Milestone/i.test(content)) continue
      sources.push({ path: relative(projectPath, absolute) || entry.name, content })
    }
  }

  await walk(projectPath)
  return sources
}

const execFileP = promisify(execFile)

function stripMarkdownFrontMatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
}

function markdownParagraphs(content: string): string[] {
  return stripMarkdownFrontMatter(content)
    .split(/\r?\n\s*\r?\n/)
    .map(paragraph =>
      paragraph
        .split(/\r?\n/)
        .map(line => line.trim().replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, ''))
        .filter(line =>
          line.length > 0 &&
          !line.startsWith('#') &&
          !line.startsWith('```'),
        )
        .join(' ')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[`*_]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
}

function inferProjectCharterFromExistingSources(
  projectPath: string,
  config?: WorkspaceYamlConfig | null,
): Partial<ProjectOrientationCharter> | null {
  const councilGoal = config?.council?.mandate?.trim() || null
  const coordinatorGoal = config?.coordinators?.map(coordinator => coordinator.mandate?.trim()).find(Boolean) || null
  const configAudience = config?.projects?.length
    ? config.projects
        .map(project => [project.label, project.type].filter(Boolean).join(' '))
        .filter(Boolean)
        .join('; ')
    : null
  const candidates = [
    projectBriefPath(projectPath),
    join(projectPath, 'README.md'),
    join(projectPath, 'readme.md'),
    join(projectPath, 'docs', 'index.md'),
  ]
  const paragraphs = candidates.flatMap(candidate => {
    if (!existsSync(candidate)) return []
    try {
      return markdownParagraphs(readFileSync(candidate, 'utf8')).map(text => ({ path: candidate, text }))
    } catch {
      return []
    }
  })
  const goal = paragraphs.find(paragraph =>
    /is a |is an |gathers|build|building|workspace|software|system|platform/i.test(paragraph.text),
  )?.text
  const weakContainerDescription = Boolean(goal && /^this is (a )?(mono)?repo containing:?$/i.test(goal))
  const isMetadataParagraph = (text: string) => /^\s*(status|target domain|license version)\s*:/i.test(text)
  const isNavigationParagraph = (text: string) => /^(quick links|documentation|reference documentation|essential|technical):/i.test(text)
  const targetAudience =
    paragraphs.find(paragraph =>
      paragraph.text !== goal && !isMetadataParagraph(paragraph.text) && !isNavigationParagraph(paragraph.text) && /\btarget\b|\baudience\b/i.test(paragraph.text),
    )?.text ??
    paragraphs.find(paragraph =>
      paragraph.text !== goal && !isMetadataParagraph(paragraph.text) && !isNavigationParagraph(paragraph.text) && /\bauthors?\b|\busers?\b|\bwriters?\b|\bdevelopers?\b|\bmaintainers?\b/i.test(paragraph.text),
    )?.text
  const successDefinition = paragraphs.find(paragraph =>
    /\bshould\b|\boptimize\b|\bmake\b|\bgoal\b|\bsuccess\b/i.test(paragraph.text) &&
    paragraph.text !== goal &&
    paragraph.text !== targetAudience,
  )?.text
  const currentReleaseTarget = paragraphs.find(paragraph =>
    /\b(mvp|release|current scope|bounded scope|first milestone|first version|headless|script[- ]only)\b/i.test(paragraph.text),
  )?.text
  const selectedGoal = councilGoal ?? (goal && !weakContainerDescription ? goal : coordinatorGoal ?? goal)
  if (!selectedGoal && !configAudience && !targetAudience && !successDefinition) return null
  return {
    goal: selectedGoal ?? null,
    targetAudience: configAudience ?? targetAudience ?? null,
    currentReleaseTarget: currentReleaseTarget ?? null,
    successDefinition: successDefinition ?? null,
    nonGoals: [],
    source: existsSync(projectBriefPath(projectPath)) ? 'owner_approved' : 'inferred',
  }
}

function projectOrientationSourceRefs(projectPath: string): string[] {
  const refs: string[] = []
  if (existsSync(projectBriefPath(projectPath))) refs.push('project-brief.md')
  for (const candidate of ['README.md', 'readme.md', 'docs/index.md']) {
    if (existsSync(join(projectPath, candidate))) refs.push(candidate)
  }
  return refs
}

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

function isCompletedBlockedContradiction(task: Record<string, unknown>): boolean {
  return (
    task.status === 'blocked' &&
    typeof task.completedAt === 'string' &&
    task.completedAt.trim().length > 0 &&
    (typeof task.blockReason !== 'string' || task.blockReason.trim().length === 0)
  )
}

const normalizedTasksCache = new Map<string, { raw: unknown; tasks: Array<Record<string, unknown>> }>()
const normalizedTaskQueueCache = new Map<string, { raw: unknown; queue: { tasks: Array<Record<string, unknown>>; releases: ProjectRelease[]; selectedReleaseId?: string } }>()

function invalidateTaskQueueReadCaches(tasksPath: string): void {
  normalizedTasksCache.delete(tasksPath)
  normalizedTaskQueueCache.delete(tasksPath)
  invalidateCachedFile(tasksPath)
}

function sameSerializedTasks(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function readTasksFileNormalized(
  tasksPath: string,
): Promise<Array<Record<string, unknown>>> {
  if (!existsSync(tasksPath)) return []
  const rawParsed = await readCachedJson<
    | { tasks?: Array<Record<string, unknown>>; version?: unknown; lastUpdated?: unknown }
    | Array<Record<string, unknown>>
  >(tasksPath)
  if (rawParsed == null) return []
  const parsed = normalizeLegacyTaskQueueShape(rawParsed)
  const cached = normalizedTasksCache.get(tasksPath)
  if (cached && sameSerializedTasks(cached.raw, parsed)) {
    return cached.tasks.map(task => ({ ...task }))
  }
  const tasks = (Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tasks) ? parsed.tasks : [])
    .map(task => ({ ...task }))
  let changed = false
  for (const task of tasks) {
    if (normalizeImportedDraftTask(task as never)) {
      if (typeof task.updatedAt !== 'string' || task.updatedAt.trim().length === 0) {
        task.updatedAt = new Date().toISOString()
      }
      changed = true
    }
    if (isCompletedBlockedContradiction(task)) {
      const now = new Date().toISOString()
      task.status = 'done'
      task.assignedTo = null
      delete task.blockReason
      task.updatedAt = now
      task.notes = [
        ...(Array.isArray(task.notes) ? task.notes as Array<Record<string, unknown>> : []),
        {
          agentId: 'coordinator-recovery',
          role: 'system',
          content: 'Recovered completed task from stale blocked status because completedAt was set and no block reason remained.',
          timestamp: now,
        },
      ]
      changed = true
    } else if (isWorkerOwnershipMismatch(task)) {
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
  if (!changed) {
    normalizedTasksCache.set(tasksPath, { raw: parsed, tasks: tasks.map(task => ({ ...task })) })
    return tasks
  }

  const rewritten = Array.isArray(parsed)
    ? tasks
    : {
        ...parsed,
        tasks,
        lastUpdated: new Date().toISOString(),
      }
  await writeManagedTextFileSync(tasksPath, JSON.stringify(rewritten, null, 2))
  normalizedTasksCache.set(tasksPath, { raw: rewritten, tasks: tasks.map(task => ({ ...task })) })
  return tasks
}

async function readTaskQueueFileNormalized(
  tasksPath: string,
): Promise<{ tasks: Array<Record<string, unknown>>; releases: ProjectRelease[]; selectedReleaseId?: string }> {
  if (!existsSync(tasksPath)) return { tasks: [], releases: [] }
  const rawParsed = await readCachedJson<
    | { tasks?: Array<Record<string, unknown>>; releases?: ProjectRelease[]; selectedReleaseId?: string; version?: unknown; lastUpdated?: unknown }
    | Array<Record<string, unknown>>
  >(tasksPath)
  if (rawParsed == null) return { tasks: [], releases: [] }
  const parsed = normalizeLegacyTaskQueueShape(rawParsed)
  const tasks = await readTasksFileNormalized(tasksPath)
  const releases = Array.isArray(parsed) ? [] : Array.isArray(parsed.releases) ? parsed.releases.map(release => ({ ...release })) : []
  const selectedReleaseId = Array.isArray(parsed) ? undefined : typeof parsed.selectedReleaseId === 'string' ? parsed.selectedReleaseId : undefined
  const queue = { tasks, releases, ...(selectedReleaseId ? { selectedReleaseId } : {}) }
  normalizedTaskQueueCache.set(tasksPath, {
    raw: parsed,
    queue: {
      tasks: tasks.map(task => ({ ...task })),
      releases: releases.map(release => ({ ...release, nodeIds: [...(release.nodeIds ?? [])], deferredNodeIds: [...(release.deferredNodeIds ?? [])] })),
      ...(selectedReleaseId ? { selectedReleaseId } : {}),
    },
  })
  return queue
}

async function writeTasksFilePreservingQueue(
  tasksPath: string,
  tasks: Array<Record<string, unknown>>,
): Promise<void> {
  let parsed:
    | { tasks?: Array<Record<string, unknown>>; version?: unknown; lastUpdated?: unknown }
    | Array<Record<string, unknown>>
    | null = null
  if (existsSync(tasksPath)) {
    try {
      parsed = JSON.parse(await readManagedTextFile(tasksPath, 'utf8')) as typeof parsed
    } catch {
      parsed = null
    }
  }
  const rewritten = Array.isArray(parsed)
    ? tasks
    : {
        ...(parsed && typeof parsed === 'object' ? parsed : { version: 1 }),
        tasks,
        lastUpdated: new Date().toISOString(),
      }
  await writeManagedTextFileSync(tasksPath, JSON.stringify(rewritten, null, 2) + '\n')
  normalizedTasksCache.set(tasksPath, { raw: rewritten, tasks: tasks.map(task => ({ ...task })) })
}

async function writeSelectedReleaseId(
  tasksPath: string,
  releaseId: string,
): Promise<{ release: ProjectRelease; selectedReleaseId: string }> {
  if (!existsSync(tasksPath)) throw new Error('No task queue exists for this project.')
  const raw = JSON.parse(await readManagedTextFile(tasksPath, 'utf8')) as
    | { tasks?: Array<Record<string, unknown>>; releases?: ProjectRelease[]; selectedReleaseId?: string; version?: unknown; lastUpdated?: unknown }
    | Array<Record<string, unknown>>
  if (Array.isArray(raw)) throw new Error('This project has no release containers yet.')
  const releases = Array.isArray(raw.releases) ? raw.releases : []
  const release = releases.find(candidate => candidate.id === releaseId)
  if (!release) throw new Error('Release not found in this project.')
  const rewritten = {
    ...raw,
    selectedReleaseId: releaseId,
    lastUpdated: new Date().toISOString(),
  }
  await writeManagedTextFileSync(tasksPath, JSON.stringify(rewritten, null, 2) + '\n')
  invalidateTaskQueueReadCaches(tasksPath)
  return { release, selectedReleaseId: releaseId }
}

function stagedContractChangeSet(model: { validationEvidence?: Array<Record<string, unknown>> }, resultId: string): ContractChangeSet | null {
  const record = (model.validationEvidence ?? []).find(candidate => (
    typeof candidate.id === 'string' &&
    candidate.id === resultId &&
    (candidate.status === 'pending_review' || candidate.status === 'auto_applicable')
  ))
  const changeSet = record?.changeSet
  return changeSet && typeof changeSet === 'object' ? changeSet as ContractChangeSet : null
}

function surfaceReviewPacketsFromTask(task: Record<string, unknown>): SurfaceReviewPacket[] {
  const packets = task.contractSurfaceReviewPackets
  if (!Array.isArray(packets)) return []
  return packets.filter(isSurfaceReviewPacket)
}

function isSurfaceReviewPacket(value: unknown): value is SurfaceReviewPacket {
  if (!value || typeof value !== 'object') return false
  const packet = value as Record<string, unknown>
  const surface = packet.surface
  const currentDelta = packet.currentDelta
  return typeof packet.id === 'string' &&
    typeof packet.currentSpecRef === 'string' &&
    !!surface &&
    typeof surface === 'object' &&
    typeof (surface as Record<string, unknown>).id === 'string' &&
    !!currentDelta &&
    typeof currentDelta === 'object' &&
    typeof (currentDelta as Record<string, unknown>).summary === 'string' &&
    Array.isArray(packet.knownConsumers) &&
    Array.isArray(packet.existingInvariants) &&
    Array.isArray(packet.existingDecisions) &&
    Array.isArray(packet.siblingSpecRefs) &&
    Array.isArray(packet.driftFindings) &&
    Array.isArray(packet.proofObligations) &&
    Array.isArray(packet.reviewFocus)
}

function projectCheckInSummaryFromState(
  intakes: Array<{ status: string }>,
  chats: Array<{ status: string; objective: { kind: string } }>,
) {
  const projectChats = chats.filter(session => session.objective.kind === 'project_check_in' || session.objective.kind === 'project_intake')
  const activeCount =
    intakes.filter(intake => intake.status === 'active').length +
    projectChats.filter(chat => chat.status === 'waiting_for_owner' || chat.status === 'coordinator_review').length
  const completedCount =
    intakes.filter(intake => intake.status === 'complete').length +
    projectChats.filter(chat => chat.status === 'fulfilled').length
  const needed = intakes.length === 0 && projectChats.length === 0
  return {
    needed,
    label: 'Project questions',
    title: needed
      ? 'Run project check-in'
      : activeCount > 0
        ? 'Project questions in progress'
        : 'Project questions answered',
    detail: needed
      ? 'The first project questions have not been generated yet. Start the check-in pass so it can ask one clear question at a time.'
      : activeCount > 0
        ? 'Keep answering the current project questions in Thread.'
        : 'Project-level answers are already recorded for this workspace.',
    actionHref: '/thread',
    totalCount: intakes.length,
    activeCount,
    completedCount,
  }
}

function newRequestRoutingSummary(kind: string): string {
  switch (kind) {
    case 'project_question':
      return 'Saved as a project question.'
    case 'settings_proposal':
      return 'This settings change is being shaped before project state changes.'
    case 'persona_practice_proposal':
      return 'This practice proposal is being shaped before reviewer behavior changes.'
    case 'repair_triage':
      return 'This repair request is being triaged before it becomes runnable work.'
    case 'clarification':
      return 'One clearer outcome is needed before this becomes work.'
    default:
      return 'This request is being shaped into a task brief.'
  }
}

function projectTasksPath(projectPath: string): string {
  return getProjectSystemStatePath(projectPath, 'TASKS.json')
}

function displayTaskTitleForRecoverySpec(task: Record<string, unknown>): string {
  const title = typeof task.title === 'string' ? task.title.trim() : ''
  if (title) return title
  const id = typeof task.id === 'string' ? task.id.trim() : ''
  return id || 'this task'
}

function briefList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function canPromoteApprovedBriefToSpecReview(task: Record<string, unknown> | undefined): boolean {
  if (!task) return false
  if (task.status === 'exploring') return true
  return task.status === 'in_progress' && task.assignedTo == null
}

function seedSpecFromApprovedBrief(task: Record<string, unknown>, now: string): boolean {
  const brief = task.productBrief as Record<string, unknown> | undefined
  if (!brief || typeof brief !== 'object') return false
  if (typeof brief.approvedAt !== 'string' || brief.approvedAt.trim().length === 0) return false
  if (typeof task.spec === 'string' && task.spec.trim().length > 0) return false

  const title = displayTaskTitleForRecoverySpec(task)
  const description = typeof task.description === 'string' && task.description.trim().length > 0
    ? task.description.trim()
    : title
  const userJob = typeof brief.userJob === 'string' && brief.userJob.trim().length > 0
    ? brief.userJob.trim()
    : `Complete ${title}.`
  const whyItMattersNow = typeof brief.whyItMattersNow === 'string' && brief.whyItMattersNow.trim().length > 0
    ? brief.whyItMattersNow.trim()
    : 'The owner approved this brief, so Guildhall should make durable progress without asking the same intake question again.'
  const successMetric = typeof brief.successMetric === 'string' && brief.successMetric.trim().length > 0
    ? brief.successMetric.trim()
    : `${title} has a reviewable spec, acceptance criteria, and proof boundary.`
  const nonGoals = [...briefList(brief.nonGoals), ...briefList(brief.antiPatterns)]
  const uniqueNonGoals = [...new Set(nonGoals)]

  const spec = [
    '## Summary',
    `Complete ${title} from the approved product brief and current task evidence.`,
    '',
    '## Source Evidence',
    `- Approved user job: ${userJob}`,
    `- Why it matters now: ${whyItMattersNow}`,
    `- Success metric: ${successMetric}`,
    `- Existing task description: ${description}`,
    '',
    '## Acceptance Criteria',
    `1. Given the approved brief, when ${title} is completed, then the delivered work satisfies the approved user job without asking the owner to repeat answered intake.`,
    `2. Given the current task evidence, when the task is reviewed, then Guildhall records which existing artifacts, docs, tasks, or implementation changes satisfy the remaining delta.`,
    '3. Given the work is complete, when verification runs, then Guildhall records review or command proof sufficient to explain why the task can move to done.',
    '',
    '## Out of Scope',
    ...(uniqueNonGoals.length > 0
      ? uniqueNonGoals.map((item) => `- ${item}`)
      : ['- Work not implied by the approved brief or current task evidence.']),
    '',
    '## Open Questions',
    '- None. The owner-approved brief is enough to continue; only newly discovered product decisions should return this task to exploring.',
    '',
    '## Completion Boundary',
    `- Product outcome: ${successMetric}`,
    '- What Guildhall can complete in code: the repo-local docs, artifacts, task records, implementation, tests, or proof needed by this approved brief.',
    '- External dependencies: None known from the approved brief.',
    '- Owner-only setup: None known after approval.',
    '- Verification environment: the current registered project and its existing proof surfaces.',
    '- What counts as done: the remaining delta is implemented or proven already satisfied, reviewed, and backed by recorded verification.',
    '- What must be split or blocked: only newly discovered work that cannot be resolved from the approved brief and current task evidence.',
  ].join('\n')

  task.spec = spec
  task.acceptanceCriteria = parseAcceptanceCriteriaFromSpec(spec)
  const quality = validateSpecCompletionBoundary(task as unknown as Task)
  if (!quality.ok) {
    delete task.spec
    task.acceptanceCriteria = []
    return false
  }
  const notes = Array.isArray(task.notes) ? [...task.notes as Array<Record<string, unknown>>] : []
  notes.push({
    agentId: 'coordinator-recovery',
    role: 'system',
    content:
      'Guildhall wrote a deterministic spec seed from the approved brief so owner-approved intake becomes reviewable work instead of another blocker.',
    timestamp: now,
  })
  task.notes = notes
  return true
}

function resolveApprovalSupersededEscalations(
  task: Record<string, unknown>,
  now: string,
  resolution: string,
): string[] {
  return resolveSupersededEscalations(task as unknown as Task, {
    now,
    resolvedBy: 'system',
    resolution,
  })
}

function taskHasRunnableSpec(task: Record<string, unknown>): boolean {
  return (
    typeof task.spec === 'string' &&
    task.spec.trim().length > 0 &&
    Array.isArray(task.acceptanceCriteria) &&
    task.acceptanceCriteria.length > 0
  )
}

function shouldAttachTaskGitStory(taskId: string): boolean {
  return taskId !== 'task-meta-intake' && taskId !== WORKSPACE_IMPORT_TASK_ID
}

function lastTaskNote(task: Record<string, unknown>): Record<string, unknown> | undefined {
  const notes = Array.isArray(task.notes) ? task.notes as Array<Record<string, unknown>> : []
  return notes.at(-1)
}

function isPhantomWorkerClaimAfterStoppedRun(task: Record<string, unknown>): boolean {
  if (task.status !== 'in_progress') return false
  if (!taskHasRunnableSpec(task)) return false
  const last = lastTaskNote(task)
  return (
    last?.agentId === 'task-claimer' &&
    /Claimed ready task for worker-agent/i.test(String(last.content ?? ''))
  )
}

async function repairStoppedRunPhantomActiveTasks(projectPath: string): Promise<number> {
  const tasksPath = projectTasksPath(projectPath)
  if (!existsSync(tasksPath)) return 0
  const parsed = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as
    | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
    | Array<Record<string, unknown>>
  const queue = Array.isArray(parsed)
    ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
    : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
  const now = new Date().toISOString()
  let repaired = 0
  for (const task of queue.tasks) {
    const effectiveTask = await buildEffectiveTask(projectPath, task as Task) as unknown as Record<string, unknown>
    if (!isPhantomWorkerClaimAfterStoppedRun(effectiveTask)) continue
    if (!taskHasRunnableSpec(task) && taskHasRunnableSpec(effectiveTask)) {
      task.spec = effectiveTask.spec
      task.acceptanceCriteria = effectiveTask.acceptanceCriteria
    }
    task.status = 'ready'
    task.assignedTo = null
    task.updatedAt = now
    resolveApprovalSupersededEscalations(
      task,
      now,
      'Superseded by stopped-run phantom active repair; no worker evidence followed the claim, so Guildhall will retry from the runnable spec.',
    )
    const notes = Array.isArray(task.notes) ? [...task.notes as Array<Record<string, unknown>>] : []
    notes.push({
      agentId: 'system',
      role: 'state-repair',
      content:
        'Cleared a phantom worker claim after the coordinator stopped without new worker evidence. Guildhall will retry from the approved runnable spec.',
      timestamp: now,
    })
    task.notes = notes
    await upsertTaskRuntimeState(projectPath, String(task.id), {
      assignedTo: null,
      openEscalationIds: [],
      updatedAt: now,
    })
    repaired += 1
  }
  if (repaired > 0) {
    queue.lastUpdated = now
    writeManagedTextFileSync(tasksPath, JSON.stringify(queue, null, 2) + '\n')
  }
  return repaired
}

function projectBriefPath(projectPath: string): string {
  return getProjectSystemStatePath(projectPath, 'project-brief.md')
}

async function loadThreadProjectionState(projectPath: string) {
  const memoryDir = getProjectStateDir(projectPath)
  const [snapshot, tasks, boundedChatSessions, pressureTestIntakes] = await Promise.all([
    buildSnapshotAsync({ projectPath }),
    readTasksFileNormalized(projectTasksPath(projectPath)).catch(() => []),
    listBoundedChatSessionsAsync(memoryDir).catch(() => []),
    listPressureTestIntakesAsync(memoryDir).catch(() => []),
  ])
  return {
    snapshot,
    tasks,
    boundedChatSessions,
    pressureTestIntakes,
    projectCheckInSummary: projectCheckInSummaryFromState(pressureTestIntakes, boundedChatSessions),
  }
}

function formatServerTiming(metrics: Array<{ name: string; startedAt: number; endedAt?: number }>): string {
  return metrics
    .map(metric => `${metric.name};dur=${Math.max(0, (metric.endedAt ?? Date.now()) - metric.startedAt)}`)
    .join(', ')
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
    const goalsPath = getProjectSystemStatePath(input.projectPath, 'workspace-goals.json')
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
  ].filter(isAttentionOwnedInboxItem)
  const attention = reconcileAttentionRecords({
    projectPath: input.projectPath,
    openItems: computedItems,
  })
  const history = await activeAttentionHistory(input.projectPath, attention.history)
  const blockers = buildInboxBlockers(attention.openItems)
  return {
    items: attention.openItems.filter(isAttentionOwnedInboxItem),
    history: history.filter(isAttentionOwnedInboxItem),
    blockers,
  }
}

async function activeAttentionHistory(projectPath: string, history: readonly AttentionRecord[]): Promise<AttentionRecord[]> {
  const tasks = await readTasksFileNormalized(projectTasksPath(projectPath)).catch(() => [])
  const hiddenTaskIds = new Set(
    tasks
      .filter(task => task.status === 'archived' || task.status === 'cancelled')
      .map(task => typeof task.id === 'string' ? task.id : '')
      .filter(Boolean),
  )
  if (hiddenTaskIds.size === 0) return [...history]
  return history.filter(record => {
    const taskId = 'taskId' in record && typeof record.taskId === 'string' ? record.taskId : ''
    return !taskId || !hiddenTaskIds.has(taskId)
  })
}

// ---------------------------------------------------------------------------
// Wizards helpers — small shims so serve.ts doesn't have to know about the
// on-disk layout of project-state/wizards.yaml.
// ---------------------------------------------------------------------------
function writeWizardsState(projectPath: string, state: WizardsState): void {
  const path = getProjectSystemStatePath(projectPath, 'wizards.yaml')
  mkdirSync(dirname(path), { recursive: true })
  writeManagedTextFileSync(path, stringifyYaml(state))
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

function summarizeProjectShell(
  project: ResolvedProject,
  run?: ReturnType<OrchestratorSupervisor['list']>[number],
): ServiceProjectSummary {
  return {
    ...summarizeProject(project),
    summary: summarizeProjectText(project),
    projectStatusLoading: true,
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
        ? 'This project has an approved design guardrail.'
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

function scopedWorkNeedsDesignSystem(
  tasks: Array<Record<string, unknown>>,
  release: { proofStyle?: string | null } | null | undefined,
): boolean {
  if (release?.proofStyle === 'script_only') return false
  return tasks.some((task) => {
    const text = [
      task.title,
      task.description,
      task.spec,
      typeof task.productBrief === 'object' && task.productBrief
        ? Object.values(task.productBrief as Record<string, unknown>).join(' ')
        : '',
    ].join(' ').toLowerCase()
    if (/\b(no-ui|no ui|headless|script-only|script only|cli|command-line|without a frontend)\b|do not add ui\b|do not add .*?\bui\b|without ui\b/.test(text)) {
      return false
    }
    return /\b(ui|frontend|front-end|screen|view|layout|component|design system|design-system|visual|palette|responsive|mobile|browser)\b/.test(text)
  })
}

function taskDoneButProofMissing(task: unknown): boolean {
  if (!task || typeof task !== 'object') return false
  const proofPaths = Array.isArray((task as { proofPaths?: unknown }).proofPaths)
    ? (task as { proofPaths: unknown[] }).proofPaths
    : []
  const handoff = (task as { completionHandoff?: unknown }).completionHandoff
  const handoffObject = handoff && typeof handoff === 'object' && !Array.isArray(handoff)
    ? handoff as Record<string, unknown>
    : null

  const handoffVerified = nonEmptyStringArray(handoffObject?.verified).length > 0 ||
    passedVerificationRecords(handoffObject?.automatedProof).length > 0 ||
    passedVerificationRecords(handoffObject?.manualProof).length > 0 ||
    passedVerificationRecords(handoffObject?.providerProof).length > 0 ||
    nonEmptyArray(handoffObject?.evidenceRefs).length > 0
  const handoffMissing = nonEmptyStringArray(handoffObject?.notVerified).length > 0 ||
    nonEmptyStringArray(handoffObject?.remainingRisks).length > 0

  if (taskHasRecordedCompletionProof(task)) return false
  if (proofPaths.length === 0) return handoffMissing && !handoffVerified
  return proofPaths.some(proofPathMissingEvidence)
}

function proofPathMissingEvidence(proofPath: unknown): boolean {
  if (!proofPath || typeof proofPath !== 'object') return true
  const record = proofPath as Record<string, unknown>
  const expectedEvidence = Array.isArray(record.expectedEvidence) ? record.expectedEvidence : []
  const verificationRecords = Array.isArray(record.verificationRecords) ? record.verificationRecords : []
  const passedEvidence = new Set(
    verificationRecords
      .filter(item => Boolean(item && typeof item === 'object' && (item as { status?: unknown }).status === 'passed'))
      .map(item => (item as { evidenceId?: unknown }).evidenceId)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
  )
  const requiredEvidenceIds = expectedEvidence
    .filter(item => Boolean(item && typeof item === 'object' && (item as { required?: unknown }).required !== false))
    .map(item => (item as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
  if (requiredEvidenceIds.length > 0) {
    return requiredEvidenceIds.some(id => !passedEvidence.has(id))
  }
  if (record.status === 'verified') return false
  return verificationRecords.every(item => !Boolean(item && typeof item === 'object' && (item as { status?: unknown }).status === 'passed'))
}

function nonEmptyStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
}

function nonEmptyArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function passedVerificationRecords(value: unknown): unknown[] {
  return Array.isArray(value)
    ? value.filter(item => Boolean(item && typeof item === 'object' && (item as { status?: unknown }).status === 'passed'))
    : []
}

function summarizeScopedReleaseWork(
  tasks: Task[],
  scope: OrientationScope | null | undefined,
): {
  statusCounts: Record<string, number>
  openEscalations: Array<{ taskId: string; taskTitle: string; escalationId: string; reason: string; summary: string }>
  incompleteBriefs: Array<{ id: string; title: string; reason: string }>
  unapprovedBriefs: Array<{ id: string; title: string }>
  unapprovedSpecs: Array<{ id: string; title: string }>
  shelvedUnclaimed: Array<{ id: string; title: string; detail?: string }>
  blockedByAgent: Array<{ id: string; title: string; reason?: string }>
  proofMissingDoneTasks: Array<{ id: string; title: string }>
  releaseBlockers: Array<{ id: string; title: string; label: string }>
  humanBlockingCount: number
  unfinishedCount: number
  scopedTasks: Task[]
  gitStoryTasks: Task[]
} {
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const scopeProjection = buildProjectScopeProjection(
    { version: 1, lastUpdated: new Date(0).toISOString(), tasks, releases: [] },
    { selectedScope: scope as ProjectScope | null | undefined },
  )
  const executionScopedTasks = tasksEligibleForScopeExecution(tasks, scope)
    .filter(task => task.id !== META_INTAKE_TASK_ID && task.id !== WORKSPACE_IMPORT_TASK_ID)
    .filter(task => !['archived', 'cancelled'].includes(String(task.status ?? '')))
  const scopedTasks = executionScopedTasks.filter((task) => {
    const parentId = task.hierarchy?.parentId?.trim()
    const parent = parentId ? tasksById.get(parentId) ?? null : null
    return deriveTaskWorkVisibility(task, parent).countInProjectTotals
  })
  const statusCounts: Record<string, number> = {}
  const openEscalations: Array<{ taskId: string; taskTitle: string; escalationId: string; reason: string; summary: string }> = []
  const incompleteBriefs: Array<{ id: string; title: string; reason: string }> = []
  const unapprovedBriefs: Array<{ id: string; title: string }> = []
  const unapprovedSpecs: Array<{ id: string; title: string }> = []
  const shelvedUnclaimed: Array<{ id: string; title: string; detail?: string }> = []
  const blockedByAgent: Array<{ id: string; title: string; reason?: string }> = []
  const proofMissingDoneTasks: Array<{ id: string; title: string }> = []
  const releaseBlockersById = new Map<string, { id: string; title: string; label: string }>()
  const terminalStatuses = new Set(['done', 'shelved', 'cancelled', 'archived', 'pending_pr'])
  let unfinishedCount = 0

  const addReleaseBlocker = (blocker: { id: string; title: string; label: string }) => {
    if (!releaseBlockersById.has(blocker.id)) releaseBlockersById.set(blocker.id, blocker)
  }
  const blockerSubject = (title: string) => title.trim().replace(/[.?!:;,\s]+$/g, '')
  const inScopeMaterializedChildren = (task: Task): Task[] => {
    const childIds = new Set<string>([
      ...((task.hierarchy?.childIds ?? []).filter((id): id is string => typeof id === 'string' && id.trim().length > 0)),
      ...tasks
        .filter(candidate => candidate.hierarchy?.parentId === task.id)
        .map(candidate => candidate.id),
    ])
    return [...childIds]
      .map(childId => tasksById.get(childId))
      .filter((child): child is Task => Boolean(child))
      .filter(child => taskEligibleForSelectedScope(child, scope, { tasksById }).eligible)
      .filter(child => !['archived', 'cancelled', 'shelved'].includes(String(child.status ?? '')))
  }

  for (const t of scopedTasks) {
    const status = String((t as { status?: string }).status ?? 'unknown')
    statusCounts[status] = (statusCounts[status] ?? 0) + 1
    if (!terminalStatuses.has(status)) unfinishedCount += 1
  }

  for (const t of executionScopedTasks) {
    const status = String((t as { status?: string }).status ?? 'unknown')
    const id = String((t as { id?: string }).id ?? '')
    const title = String((t as { title?: string }).title ?? id)
    const brief = (t as { productBrief?: { approvedAt?: string } }).productBrief
    const terminal = terminalStatuses.has(status)
    const reservedImportTask = id === WORKSPACE_IMPORT_TASK_ID
    const approvalPendingStatus = status === 'proposed' || status === 'ready'
    const hasMaterializedChildWork = inScopeMaterializedChildren(t).length > 0
    const hasWorkerReadySpec = status === 'ready' && hasSpecDraftRecord(t)
    if (status === 'done' && taskDoneButProofMissing(t)) {
      proofMissingDoneTasks.push({ id, title })
      addReleaseBlocker({ id, title, label: `${blockerSubject(title)} needs proof evidence before the release is complete.` })
    }
    if (
      brief &&
      !brief.approvedAt &&
      approvalPendingStatus &&
      !terminal &&
      !reservedImportTask &&
      !hasMaterializedChildWork &&
      !hasWorkerReadySpec
    ) {
      if (hasCompleteProductBriefRecord(t)) {
        unapprovedBriefs.push({ id, title })
        addReleaseBlocker({ id, title, label: `${blockerSubject(title)} is waiting for brief approval.` })
      } else {
        const reason = 'Task brief needs user job, why it matters now, success metric, and at least one non-goal before approval.'
        incompleteBriefs.push({ id, title, reason })
        addReleaseBlocker({ id, title, label: `${blockerSubject(title)} needs brief cleanup before approval.` })
      }
    }
    if (status === 'spec_review') {
      unapprovedSpecs.push({ id, title })
      addReleaseBlocker({ id, title, label: `${blockerSubject(title)} is waiting for spec review.` })
    }
    if (status === 'shelved') {
      const reason = (t as { shelveReason?: { detail?: string } }).shelveReason
      shelvedUnclaimed.push({ id, title, ...(reason?.detail ? { detail: reason.detail } : {}) })
    }
    if (status === 'blocked') {
      const reason = (t as { blockReason?: string }).blockReason
      blockedByAgent.push({ id, title, ...(reason ? { reason } : {}) })
      addReleaseBlocker({ id, title, label: reason?.trim() || `${blockerSubject(title)} is blocked.` })
    }
    for (const e of activeEscalations(t)) {
      openEscalations.push({
        taskId: id,
        taskTitle: title,
        escalationId: e.id,
        reason: e.reason,
        summary: e.summary,
      })
      addReleaseBlocker({ id, title, label: e.summary?.trim() || `${blockerSubject(title)} has an open escalation.` })
    }
  }

  const humanBlockingKeys = new Set<string>()
  for (const escalation of openEscalations) humanBlockingKeys.add(`task:${escalation.taskId}`)
  for (const brief of incompleteBriefs) humanBlockingKeys.add(`task:${brief.id}`)
  for (const brief of unapprovedBriefs) humanBlockingKeys.add(`task:${brief.id}`)
  for (const spec of unapprovedSpecs) humanBlockingKeys.add(`task:${spec.id}`)
  for (const blocked of blockedByAgent) humanBlockingKeys.add(`task:${blocked.id}`)

  const projectionReleaseBlockers = scopeProjection.release.blockers.map(blocker => {
    const task = blocker.owningTaskId ? tasksById.get(blocker.owningTaskId) : null
    return {
      id: blocker.id,
      title: task?.title ?? blocker.id,
      label: blocker.label,
    }
  })

  return {
    statusCounts,
    openEscalations,
    incompleteBriefs,
    unapprovedBriefs,
    unapprovedSpecs,
    shelvedUnclaimed,
    blockedByAgent,
    proofMissingDoneTasks,
    releaseBlockers: projectionReleaseBlockers.length > 0 ? projectionReleaseBlockers : [...releaseBlockersById.values()],
    humanBlockingCount: Math.max(scopeProjection.counts.humanBlocking, humanBlockingKeys.size),
    unfinishedCount,
    scopedTasks,
    gitStoryTasks: executionScopedTasks,
  }
}

function buildOrientationSpineWithScopedReleaseTruth(
  input: BuildProjectOrientationSpineInput,
): {
  orientationSpine: ReturnType<typeof buildProjectOrientationSpine>
  releaseTruth: ReturnType<typeof summarizeScopedReleaseWork>
} {
  const provisionalSpine = buildProjectOrientationSpine(input)
  const scopeProjection = buildProjectScopeProjection(
    {
      version: 1,
      lastUpdated: new Date(0).toISOString(),
      tasks: (input.tasks ?? []) as Task[],
      releases: [],
    },
    { selectedScope: provisionalSpine.scope as ProjectScope | null | undefined },
  )
  const releaseTruth = summarizeScopedReleaseWork(input.tasks ?? [], provisionalSpine.scope)
  const orientationSpine = buildProjectOrientationSpine({
    ...input,
    scopeProjection,
    releaseReadiness: {
      verdict: releaseTruth.releaseBlockers.length > 0 ? 'blocked' : 'clear',
      blockers: releaseTruth.releaseBlockers,
    },
  })
  return { orientationSpine, releaseTruth }
}

function selectedReleaseScopeFromTaskMembership(tasks: Task[]): OrientationScope | null {
  const selectedReleaseId = tasks
    .flatMap(task => Array.isArray(task.releaseIds) ? task.releaseIds : [])
    .map(releaseId => releaseId.trim())
    .find(Boolean)
  if (!selectedReleaseId) return null
  return {
    id: selectedReleaseId,
    label: selectedReleaseId,
    kind: 'release',
    source: 'inferred',
    nodeIds: tasks
      .filter(task => task.releaseIds?.includes(selectedReleaseId))
      .map(task => taskNodeId(task.id)),
    deferredNodeIds: [],
  }
}

function selectedReleaseScopeFromQueueLike(input: {
  tasks: Task[]
  releases?: TaskQueue['releases']
  selectedReleaseId?: string
}): OrientationScope | null {
  const queueScope = Array.isArray(input.releases)
    ? selectedReleaseScopeForQueue({
      version: 1,
      lastUpdated: new Date(0).toISOString(),
      tasks: input.tasks,
      releases: input.releases,
      ...(input.selectedReleaseId ? { selectedReleaseId: input.selectedReleaseId } : {}),
    })
    : null
  return queueScope ?? selectedReleaseScopeFromTaskMembership(input.tasks)
}

function tasksEligibleForScopeExecution(tasks: Task[], scope: OrientationScope | null | undefined): Task[] {
  if (!scope) return tasks
  const tasksById = new Map(tasks.map(task => [task.id, task] as const))
  return tasks.filter(task => taskEligibleForSelectedScope(task, scope, { tasksById }).eligible)
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

function hasCompleteProductBriefRecord(task: Record<string, unknown>): boolean {
  const brief = task.productBrief
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return false
  const record = brief as {
    userJob?: unknown
    whyItMattersNow?: unknown
    successMetric?: unknown
    nonGoals?: unknown
    antiPatterns?: unknown
  }
  const nonGoals = Array.isArray(record.nonGoals)
    ? record.nonGoals.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const antiPatterns = Array.isArray(record.antiPatterns)
    ? record.antiPatterns.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  return Boolean(
    typeof record.userJob === 'string' &&
    record.userJob.trim().length > 0 &&
    typeof record.whyItMattersNow === 'string' &&
    record.whyItMattersNow.trim().length > 0 &&
    typeof record.successMetric === 'string' &&
    record.successMetric.trim().length > 0 &&
    (nonGoals.length > 0 || antiPatterns.length > 0),
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
  return hasSpecDraftRecord(task) || (hasApprovedProductBriefRecord(task) && hasCompleteProductBriefRecord(task))
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
  const briefPath = projectBriefPath(project.path)
  if (existsSync(briefPath)) {
    const brief = readManagedTextFileSync(briefPath, 'utf8')
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
  if (/retryable provider throttle/i.test(value)) return 'Provider busy; this task can resume later.'
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
  if (worktreePath && existsSync(worktreePath)) return worktreePath
  return resolveEffectiveTaskProjectPath(task as Pick<Task, 'projectPath'>, projectPath)
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
  workspaceProjects?: ReturnType<typeof resolveWorkspaceProjectPaths>,
) {
  const driver = new NodeGitDriver()
  const inspectedPath = taskGitStoryRepoPath(projectPath, task, workspace)
  const resolvedWorkspaceProjects = workspaceProjects ?? (() => {
    const workspaceConfig = readWorkspaceConfig(projectPath)
    return workspaceConfig.kind === 'workspace'
      ? resolveWorkspaceProjectPathsOrDiscover(projectPath, workspaceConfig)
      : discoverChildGitProjects(projectPath)
  })()
  const childProject = resolveGitStoryWorkspaceProject({
    workspacePath: projectPath,
    workspaceProjectPath: projectPath,
    workspaceProjects: resolvedWorkspaceProjects,
    task,
  })
  const repoRoot = childProject?.path ?? resolveEffectiveTaskProjectPath(task as Pick<Task, 'projectPath'>, projectPath)
  return inspectGitStory(driver, {
    repoRoot,
    ...(childProject?.id ? { repoId: childProject.id } : {}),
    ...(childProject?.label ?? childProject?.id ? { repoLabel: childProject.label ?? childProject.id } : {}),
    inspectedPath,
    task: taskForGitStory(task, workspace),
    inspectPr: false,
  })
}

async function buildProjectGitStorySummary(projectPath: string, tasks?: Array<Record<string, unknown>>): Promise<GitStorySummary> {
  const driver = new NodeGitDriver()
  const workspaceConfig = readWorkspaceConfig(projectPath)
  const workspaceProjects = workspaceConfig.kind === 'workspace'
    ? resolveWorkspaceProjectPathsOrDiscover(projectPath, workspaceConfig)
    : discoverChildGitProjects(projectPath)
  const rootSnapshots = workspaceProjects.length > 0
    ? await Promise.all(workspaceProjects.map(child =>
        inspectGitStory(driver, {
          repoRoot: child.path,
          repoId: child.id,
          repoLabel: child.label ?? child.id,
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
  const taskRecords = tasks ?? await readTasksFileNormalized(projectTasksPath(projectPath)).catch(() => [])
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
    snapshots.push(await gitStoryForTask(projectPath, task, workspace, workspaceProjects))
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
    workspaceProjects: workspaceConfig
      ? resolveWorkspaceProjectPathsOrDiscover(projectPath, workspaceConfig)
      : discoverChildGitProjects(projectPath),
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
  const gitStory = taskId && shouldAttachTaskGitStory(taskId)
    ? await gitStoryForTask(projectPath, normalized, workspace).catch(() => undefined)
    : undefined
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

function parseStartDevServerRequest(body: Partial<StartDevServerRequest>): {
  ok: true
  value: StartDevServerRequest
} | {
  ok: false
  error: string
} {
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : ''
  const taskId = typeof body.taskId === 'string' && body.taskId.trim() ? body.taskId.trim() : undefined
  const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : ''
  const argv = Array.isArray(body.argv)
    ? body.argv.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const containerPort = typeof body.containerPort === 'number' ? body.containerPort : Number.NaN
  const preferredHostPort = typeof body.preferredHostPort === 'number' ? body.preferredHostPort : undefined
  const readinessPath = typeof body.readinessPath === 'string' ? body.readinessPath : undefined
  if (!id) return { ok: false, error: 'Missing dev server id.' }
  if (!projectId) return { ok: false, error: 'Missing projectId.' }
  if (!cwd) return { ok: false, error: 'Missing cwd.' }
  if (argv.length === 0) return { ok: false, error: 'Missing argv.' }
  if (!Number.isInteger(containerPort) || containerPort <= 0) {
    return { ok: false, error: 'containerPort must be a positive integer.' }
  }
  return {
    ok: true,
    value: {
      id,
      projectId,
      ...(taskId ? { taskId } : {}),
      cwd,
      argv,
      containerPort,
      ...(preferredHostPort ? { preferredHostPort } : {}),
      ...(readinessPath ? { readinessPath } : {}),
    },
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
  runtimeSupervisor: ProjectRuntimeSupervisor
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
  let configuredProjectPath = resolve(projectPath)
  const requestProjectPathStore = new AsyncLocalStorage<string>()
  const currentProject = (): ResolvedProject => resolveProject(requestProjectPathStore.getStore() ?? configuredProjectPath)
  const refreshProject = (path = currentProject().path): ResolvedProject => {
    const refreshed = resolveProject(path)
    if (resolve(configuredProjectPath) === resolve(path)) configuredProjectPath = refreshed.path
    return refreshed
  }
  const resolveProjectPathForRequest = (c: Context): string | null => {
    const requestedId = c.req.query('projectId')?.trim()
    if (!requestedId) return null
    const entry = getRegisteredProjects().find(item => item.id === requestedId)
    if (!entry) {
      const configuredProject = resolveProject(configuredProjectPath)
      if (configuredProject.id === requestedId) return configuredProject.path
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

  const supervisor = opts.supervisor ?? new OrchestratorSupervisor()
  const runtimeSupervisor = opts.runtimeSupervisor ?? new ProjectRuntimeSupervisor()
  const runtimeBackendSetup = opts.runtimeBackendSetup ?? detectRuntimeBackendSetup
  const devServerManager = opts.devServerManager ?? new DevServerManager({ runtimeSupervisor })
  const app = new Hono()
  const currentProjectPath = () => currentProject().path
  const runtimeAgentProjectId = (c: Context): string | null => {
    const projectId = c.req.header('x-guildhall-runtime-project-id')?.trim()
    return projectId || null
  }
  const recordRuntimeAgentScopeViolation = async (
    runtimeProjectId: string,
    input: {
      requestedProjectId?: string | undefined
      path: string
      method: string
      reason: string
    },
  ) => {
    const runtimeProject = getRegisteredProjects().find(item => item.id === runtimeProjectId)
    if (!runtimeProject) return
    const file = getProjectSystemStatePath(runtimeProject.path, 'security/runtime-agent-scope-violations.jsonl')
    await fsp.mkdir(dirname(file), { recursive: true })
    await appendManagedTextFile(file, `${JSON.stringify({
      runtimeProjectId,
      ...input,
      recordedAt: new Date().toISOString(),
    })}\n`)
  }
  const blockRuntimeAgentGlobalAccess = async (c: Context, next: () => Promise<void>) => {
    const runtimeProjectId = runtimeAgentProjectId(c)
    if (runtimeProjectId) {
      await recordRuntimeAgentScopeViolation(runtimeProjectId, {
        path: c.req.path,
        method: c.req.method,
        reason: 'global_api_access',
      })
      return c.json({
        error: 'Runtime-agent requests cannot access service-wide or global Guildhall APIs.',
        code: 'runtime_agent_scope_violation',
      }, 403)
    }
    return next()
  }

  const bindProjectScope = async (
    c: Context,
    next: () => Promise<void>,
    {
      requireExplicitForMutation = false,
    }: { requireExplicitForMutation?: boolean } = {},
  ) => {
    if (!c.req.query('projectId')?.trim()) {
      return c.json({ error: 'projectId is required for project-scoped requests.' }, 400)
    }
    const runtimeProjectId = runtimeAgentProjectId(c)
    if (runtimeProjectId && c.req.query('projectId')?.trim() !== runtimeProjectId) {
      await recordRuntimeAgentScopeViolation(runtimeProjectId, {
        requestedProjectId: c.req.query('projectId')?.trim(),
        path: c.req.path,
        method: c.req.method,
        reason: 'cross_project_access',
      })
      return c.json({
        error: 'Runtime-agent requests cannot access another project.',
        code: 'runtime_agent_scope_violation',
      }, 403)
    }
    if (
      requireExplicitForMutation &&
      c.req.method !== 'GET' &&
      c.req.method !== 'HEAD' &&
      !c.req.query('projectId')?.trim()
    ) {
      return c.json({ error: 'projectId is required for project-mutating requests.' }, 400)
    }
    const resolvedPath = resolveProjectPathForRequest(c)
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
    const isSplitRepairAction =
      c.req.path.startsWith('/api/project/task/') &&
      c.req.path.endsWith('/create-split-children')
    if (
      c.req.path.startsWith('/api/project') &&
      !c.req.path.startsWith('/api/project/migrations') &&
      c.req.path !== '/api/project/meta-intake/synthesize' &&
      !isSplitRepairAction &&
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
  app.use('/api/service', blockRuntimeAgentGlobalAccess)
  app.use('/api/service/*', blockRuntimeAgentGlobalAccess)
  app.use('/api/providers', blockRuntimeAgentGlobalAccess)
  app.use('/api/providers/*', blockRuntimeAgentGlobalAccess)
  app.use('/api/models', blockRuntimeAgentGlobalAccess)
  app.use('/api/models/*', blockRuntimeAgentGlobalAccess)
  app.use('/api/config', bindProjectScope)
  app.use('/api/config/*', bindProjectScope)
  app.use('/api/setup', bindProjectScope)
  app.use('/api/setup/*', bindProjectScope)

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
            const pkg = JSON.parse(readManagedTextFileSync(candidate, 'utf-8')) as {
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
          const pkg = JSON.parse(readManagedTextFileSync(candidate, 'utf-8')) as {
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

  app.get('/api/service/projects', c => {
    const runsById = new Map(supervisor.list().map(run => [run.workspaceId, run]))
    const projects = getRegisteredProjects().map((entry) => {
      const resolved = resolveProject(entry.path)
      return summarizeProjectShell(resolved, runsById.get(resolved.id))
    })
    return c.json({
      pid: process.pid,
      defaultProviderStatus: buildGlobalDefaultProviderStatus(),
      projects,
    })
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
        const startReadiness = resolved.initializationNeeded
          ? null
          : await (async () => {
              const entryConfig = readProjectConfig(entry.path)
              const entryResolvedConfig = resolveConfig({ workspacePath: entry.path })
              return projectStartReadiness({
                projectPath: entry.path,
                resolvedConfig: entryResolvedConfig,
                runtimeProvider: getRuntimeProviderConfig({
                  projectPath: entry.path,
                  models: entryResolvedConfig.models,
                }),
                allowPaidProviderFallback: Boolean(entryConfig.allowPaidProviderFallback),
              })
            })().catch(() => null)
        let taskCounts: ServiceProjectSummary['taskCounts'] = {
          total: 0,
          active: 0,
          draftReview: 0,
          blocked: 0,
          done: 0,
          shelved: 0,
        }
        let workProgress: ServiceProjectSummary['workProgress'] = undefined
        let highlights: ServiceProjectSummary['highlights'] = undefined
        let taskActivity: ServiceProjectSummary['taskActivity'] = undefined
        const availability = resolved.initializationNeeded
          ? null
          : await readProjectAvailability(entry.path).catch(() => null)
        try {
          const tasks = await readTasksFileNormalized(projectTasksPath(entry.path))
          taskCounts = summarizeTaskCounts(tasks)
          workProgress = deriveProjectWorkProgress(tasks as Array<Record<string, unknown>>)
          taskActivity = summarizeTaskActivity(tasks)
          const gitStory = await buildProjectGitStorySummary(entry.path, tasks as Array<Record<string, unknown>>).catch(() => undefined)
          const inbox = await buildProjectInboxSnapshot({
            projectPath: entry.path,
            initializationNeeded: resolved.initializationNeeded,
            coordinatorCount: resolved.config?.coordinators?.length ?? 0,
          }).catch(() => null)
          const thread = await (async () => {
            const state = await loadThreadProjectionState(entry.path)
            return buildThread({
              projectPath: entry.path,
              snapshot: state.snapshot,
              tasks: state.tasks as never,
              boundedChatSessions: state.boundedChatSessions,
              pressureTestIntakes: state.pressureTestIntakes,
              projectCheckInSummary: state.projectCheckInSummary,
              runStatus: run?.status ?? 'stopped',
              recentEvents: supervisor.recent(resolved.id, undefined, entry.path),
            })
          })().catch(() => null)
          const actionModel = buildProjectActionModel({
            startReadiness,
            inbox,
            tasks: tasks as never,
            thread,
            runStatus: run?.status ?? 'stopped',
            availability,
          })
          highlights = {
            activeTaskTitle: latestTaskTitleByStatus(tasks, ['in_progress', 'review', 'gate_check', 'exploring']),
            blockedTaskTitle: latestTaskTitleByStatus(tasks, ['blocked']),
            recentCompletedTaskTitle: latestTaskTitleByStatus(tasks, ['done']),
          }
          return {
            ...summarizeProject(resolved),
            summary: summarizeProjectText(resolved),
            taskCounts,
            ...(workProgress ? { workProgress } : {}),
            ...(taskActivity ? { taskActivity } : {}),
            ...(highlights ? { highlights } : {}),
            ...(gitStory ? { gitStory } : {}),
            ...(providerStatus ? { providerStatus } : {}),
            ...(startReadiness ? { startReadiness } : {}),
            ...(availability ? { availability } : {}),
            actionModel,
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
          ...(workProgress ? { workProgress } : {}),
          ...(taskActivity ? { taskActivity } : {}),
          ...(highlights ? { highlights } : {}),
          ...(providerStatus ? { providerStatus } : {}),
          ...(startReadiness ? { startReadiness } : {}),
          ...(availability ? { availability } : {}),
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

  app.get('/api/fleet/attention', async c => {
    const registeredProjects = getRegisteredProjects()
    const groups = await Promise.all(registeredProjects.map(async (entry) => {
      const resolved = resolveProject(entry.path)
      const projectSummary = summarizeProject(resolved)
      if (resolved.initializationNeeded) {
        return { project: projectSummary, items: [], error: null, topWaitingThread: null }
      }
      try {
        const inbox = await buildProjectInboxSnapshot({
          projectPath: entry.path,
          initializationNeeded: resolved.initializationNeeded,
          coordinatorCount: resolved.config?.coordinators?.length ?? 0,
        })
        const state = await loadThreadProjectionState(entry.path)
        const thread = buildThread({
          projectPath: entry.path,
          snapshot: state.snapshot,
          tasks: state.tasks as never,
          boundedChatSessions: state.boundedChatSessions,
          pressureTestIntakes: state.pressureTestIntakes,
          projectCheckInSummary: state.projectCheckInSummary,
          runStatus: supervisor.get(resolved.id)?.status ?? 'stopped',
          recentEvents: supervisor.recent(resolved.id, undefined, entry.path),
        })
        const topWaitingThread = thread.turns.find(turn => turn.id === thread.activeTurnId && turn.status === 'active') ?? null
        return {
          project: projectSummary,
          items: inbox.items.filter(item => item.severity !== 'low'),
          error: null,
          topWaitingThread,
        }
      } catch (err) {
        return {
          project: projectSummary,
          items: [],
          error: err instanceof Error ? err.message : String(err),
          topWaitingThread: null,
        }
      }
    }))
    const visibleGroups = groups.filter(group => group.items.length > 0 || group.error || group.topWaitingThread)
    const topWaitingThread = visibleGroups
      .map(group => group.topWaitingThread ? { project: group.project, turn: group.topWaitingThread } : null)
      .find((entry): entry is NonNullable<typeof entry> => entry !== null) ?? null
    return c.json({
      groups: visibleGroups,
      totalItems: visibleGroups.reduce((sum, group) => sum + group.items.length, 0),
      projectCount: visibleGroups.filter(group => group.items.length > 0 || group.topWaitingThread).length,
      topWaitingThread,
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
    staleProcesses?: GuildhallProcessInfo[]
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

  async function servedBundleFreshnessPayloadWithProcesses(): Promise<ReturnType<typeof servedBundleFreshnessPayload>> {
    const payload = servedBundleFreshnessPayload()
    const staleOptions = {
      currentPid: process.pid,
      currentBuildMtimeMs: payload.currentBuildMtimeMs,
      ...(opts.staleProcessGuard?.listProcesses ? { listProcesses: opts.staleProcessGuard.listProcesses } : {}),
      ...(opts.staleProcessGuard?.killProcess ? { killProcess: opts.staleProcessGuard.killProcess } : {}),
    }
    await stopStaleGuildhallProcesses(staleOptions)
    const processes = opts.staleProcessGuard?.listProcesses
      ? await opts.staleProcessGuard.listProcesses()
      : await listGuildhallProcesses()
    const staleProcesses = findStaleGuildhallProcesses(processes, staleOptions)
    return {
      ...payload,
      ...(staleProcesses.length > 0 ? { staleProcesses } : {}),
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
        const parsed = JSON.parse(readManagedTextFileSync(candidate, 'utf-8')) as Partial<RuntimeBuildIdentity>
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
    const migrations = await summarizeProjectMigrations(configuredProjectPath)
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

  app.get('/api/stale-server', async c => {
    return c.json(await servedBundleFreshnessPayloadWithProcesses())
  })

  app.get('/api/health', async c => {
    return c.json(await runningHealthPayload())
  })

  // -------------------------------------------------------------------------
  // API: project
  // -------------------------------------------------------------------------
  async function projectMemoryHealth(projectPath: string, tasks: Array<{ id: string }>): Promise<{
    total: number
    active: number
    proposed: number
    used: number
    retired: number
    project: number
    userGlobal: number
    guildhallProduct: number
    memoryCore: {
      adapter: 'mastra' | 'deterministic'
      fallbackUsed: boolean
      storagePath?: string
      repoLocalWrites: string[]
      semanticRecallEnabled: boolean
      observationalMemoryEnabled: boolean
      observationalProcessorReady: boolean
      compactionStatus: 'active' | 'needs_attention'
      semanticValidity: 'valid' | 'needs_attention'
      warnings: string[]
      features: string[]
    }
    recentUse: Array<{ taskId: string; included: number; withheld: number; at: string }>
  }> {
    const memoryDir = getProjectStateDir(projectPath)
    const records = await listMemoryRecords({ memoryDir })
    const count = (predicate: (record: typeof records[number]) => boolean) =>
      records.filter(predicate).length
    const recentUse: Array<{ taskId: string; included: number; withheld: number; at: string }> = []
    for (const task of tasks.slice(0, 12)) {
      const debug = await readContextDebugForTask(memoryDir, task.id, 1)
      const latest = debug[0]
      if (!latest?.memoryPacket || !latest.at) continue
      recentUse.push({
        taskId: task.id,
        included: latest.memoryPacket.included.length,
        withheld: latest.memoryPacket.withheld.length,
        at: latest.at,
      })
    }
    const projectId = basename(projectPath) || 'project'
    const memoryCoreScope = { kind: 'project' as const, projectId }
    const memoryConfig = readProjectConfig(projectPath).memory
    const memorySubstrate = process.env.GUILDHALL_MEMORY_SUBSTRATE === 'deterministic'
      ? 'deterministic'
      : process.env.GUILDHALL_MEMORY_SUBSTRATE === 'mastra'
        ? 'mastra'
        : memoryConfig?.substrate ?? 'mastra'
    const semanticRecall = process.env.GUILDHALL_MEMORY_SEMANTIC_RECALL === '1'
      ? true
      : process.env.GUILDHALL_MEMORY_SEMANTIC_RECALL === '0'
        ? false
        : memoryConfig?.semanticRecall ?? false
    const observationalMemory = process.env.GUILDHALL_MEMORY_OBSERVATIONAL === '1'
      ? true
      : process.env.GUILDHALL_MEMORY_OBSERVATIONAL === '0'
        ? false
        : memoryConfig?.observationalMemory ?? false
    const memoryCorePacket = await buildMemoryCoreCandidatePacket({
      projectRoot: projectPath,
      scope: memoryCoreScope,
      purpose: 'handoff',
      maxBytes: 4096,
      substrate: memorySubstrate,
      semanticRecall,
      observationalMemory,
    })
    const memoryCore = {
      adapter: memoryCorePacket.health.adapter,
      fallbackUsed: memorySubstrate === 'deterministic' ? false : memoryCorePacket.health.fallbackUsed,
      storagePath: memoryCorePacket.health.storagePath ?? resolveMemoryPaths({ projectRoot: projectPath, scope: memoryCoreScope }).dbPath,
      repoLocalWrites: memoryCorePacket.health.repoLocalWrites ?? [],
      semanticRecallEnabled: memoryCorePacket.health.semanticRecallEnabled ?? false,
      observationalMemoryEnabled: memoryCorePacket.health.observationalMemoryEnabled ?? false,
      observationalProcessorReady: memoryCorePacket.health.observationalProcessorReady ?? false,
      compactionStatus: memoryCorePacket.health.compactionStatus ?? 'needs_attention',
      semanticValidity: memoryCorePacket.health.semanticValidity ?? 'needs_attention',
      warnings: memoryCorePacket.health.warnings,
      features: memoryCorePacket.health.features ?? ['deterministic-events'],
    }
    return {
      total: records.length,
      active: count(record => record.status === 'active'),
      proposed: count(record => record.status === 'observed' || record.status === 'proposed'),
      used: count(record => record.status === 'used'),
      retired: count(record => record.status === 'retired'),
      project: count(record => record.scope === 'project'),
      userGlobal: count(record => record.scope === 'user_global'),
      guildhallProduct: count(record => record.scope === 'guildhall_product'),
      memoryCore,
      recentUse: recentUse
        .sort((left, right) => right.at.localeCompare(left.at))
        .slice(0, 5),
    }
  }

  app.get('/api/project', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({
          initializationNeeded: true,
          path: project.path,
          setupUrl: `/projects/${encodeURIComponent(project.id)}/setup`,
        })
      }
      const tasksPath = projectTasksPath(project.path)
      const rawQueue = await readTaskQueueFileNormalized(tasksPath)
      const rawTasks = rawQueue.tasks
      const releaseReadiness = await buildProjectReleaseReadinessPayload()
      const workProgress = deriveProjectWorkProgress(rawTasks as Array<Record<string, unknown>>)
      const tasks = await Promise.all(rawTasks.map((task) => enrichTaskForServe(project.path, task)))
      const deliveryModel = await readProjectDeliveryModel(project.path)
      const deliveryValidation = validateProjectDeliveryModel({
        model: deliveryModel,
        tasks: rawTasks as Task[],
        projectRoot: project.path,
      })
      const deliveryQueue = deriveQueueCandidates({
        model: deliveryModel,
        tasks: rawTasks as Task[],
      })
      const deliveryPrimitives = listPrimitivesWithRelations(deliveryModel, rawTasks as Task[])
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
      const [runtime, memoryHealth, availability] = await Promise.all([
        readProjectRuntimeState(project.path),
        projectMemoryHealth(
          project.path,
          tasks
            .filter((task): task is { id: string } => typeof task.id === 'string'),
        ),
        readProjectAvailability(project.path),
      ])
      const acceptedStructuralMap = readAcceptedStructuralMap(project.path)
      const structuralMapReview = acceptedStructuralMap ? summarizeStructuralMapForReview(acceptedStructuralMap) : null
      const taskRoutingContexts = summarizeStructuralTaskContexts({
        map: acceptedStructuralMap,
        tasks: tasks
          .filter((task): task is typeof task & { id: string } => typeof task.id === 'string')
          .map(task => ({
            id: task.id,
            title: typeof task.title === 'string' ? task.title : task.id,
            description: typeof task.description === 'string' ? task.description : undefined,
            spec: typeof task.spec === 'string' ? task.spec : undefined,
          })),
      })
      const inbox = await buildProjectInboxSnapshot({
        projectPath: project.path,
        initializationNeeded: project.initializationNeeded,
        coordinatorCount: project.config?.coordinators?.length ?? 0,
      })
      const threadState = await loadThreadProjectionState(project.path)
      const thread = buildThread({
        projectPath: project.path,
        snapshot: threadState.snapshot,
        tasks: threadState.tasks as never,
        boundedChatSessions: threadState.boundedChatSessions,
        pressureTestIntakes: threadState.pressureTestIntakes,
        projectCheckInSummary: threadState.projectCheckInSummary,
        runStatus: run?.status ?? 'stopped',
        recentEvents: recent,
      })
      const orientationWorkspaceImportDraft = await workspaceImportDraftForOrientation(project.path, startReadiness)
      const { orientationSpine } = buildOrientationSpineWithScopedReleaseTruth({
        projectId: project.id,
        charter: inferProjectCharterFromExistingSources(project.path, project.config),
        selectedReleaseId: rawQueue.selectedReleaseId,
        releases: rawQueue.releases,
        tasks: tasks as unknown as Task[],
        runStatus: run?.status ?? 'stopped',
        startReadiness,
        workspaceImportDraft: orientationWorkspaceImportDraft,
        sourceRefs: projectOrientationSourceRefs(project.path),
      })
      const actionScope = orientationSpine.selectedTaskScope ?? orientationSpine.scope ?? null
      const actionTasksById = new Map((tasks as unknown as Task[]).map(candidate => [candidate.id, candidate]))
      const scopedActionTaskIds = actionScope
        ? new Set(
            (tasks as unknown as Task[])
              .filter(task => taskEligibleForSelectedScope(task, actionScope, {
                tasksById: actionTasksById,
              }).eligible)
              .map(task => task.id),
          )
        : null
      const actionTasks = scopedActionTaskIds
        ? tasks.filter(task => typeof task.id === 'string' && scopedActionTaskIds.has(task.id))
        : tasks
      const actionModel = buildProjectActionModel({
        startReadiness,
        inbox,
        tasks: actionTasks as never,
        thread,
        runStatus: run?.status ?? 'stopped',
        availability,
      })
      return c.json({
        initializationNeeded: false,
        id: project.id,
        path: project.path,
        name: project.config?.name ?? project.id,
        tags: project.config?.tags ?? [],
        config: project.config,
        tasks,
        workProgress,
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
        availability,
        providerStatus,
        runtime,
        memoryHealth,
        ...(structuralMapReview ? { structuralMapReview } : {}),
        taskRoutingContexts,
        gitStory,
        releaseReadiness,
        startReadiness,
        actionModel,
        orientationSpine,
        deliverySpine: {
          model: deliveryModel,
          validation: deliveryValidation,
          primitives: deliveryPrimitives,
          queue: deliveryQueue,
        },
        recentEvents: recent,
        ...(bootstrapStatus ? { bootstrapStatus } : {}),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/spine', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({
          spine: buildOrientationSpineWithScopedReleaseTruth({
            projectId: project.id,
            charter: null,
            tasks: [],
          }).orientationSpine,
          initializationNeeded: true,
        })
      }
      const rawQueue = await readTaskQueueFileNormalized(projectTasksPath(project.path))
      const startReadiness = await projectStartReadinessForProject(project.path)
      const { orientationSpine: spine } = buildOrientationSpineWithScopedReleaseTruth({
        projectId: project.id,
        charter: inferProjectCharterFromExistingSources(project.path, project.config),
        selectedReleaseId: rawQueue.selectedReleaseId,
        releases: rawQueue.releases,
        tasks: rawQueue.tasks as Task[],
        runStatus: supervisor.get(project.id)?.status ?? 'stopped',
        startReadiness,
        workspaceImportDraft: await workspaceImportDraftForOrientation(project.path, startReadiness),
        sourceRefs: projectOrientationSourceRefs(project.path),
      })
      return c.json({ spine })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/structural-map/action', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as {
        mapId?: unknown
        action?: unknown
      }
      if (typeof body.mapId !== 'string' || body.mapId.trim() === '') {
        return c.json({ error: 'mapId is required.' }, 400)
      }
      const action = parseStructuralMapReviewAction(body.action)
      if (!action) return c.json({ error: 'Valid structural map action is required.' }, 400)
      const map = await applyStructuralMapReviewAction({
        projectRoot: project.path,
        mapId: body.mapId,
        actor: 'owner',
        action,
      })
      return c.json({ structuralMapReview: summarizeStructuralMapForReview(map) })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/release/select', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as {
        releaseId?: unknown
      }
      const releaseId = typeof body.releaseId === 'string' ? body.releaseId.trim() : ''
      if (!releaseId) return c.json({ error: 'releaseId is required.' }, 400)
      const result = await writeSelectedReleaseId(projectTasksPath(project.path), releaseId)
      const rawQueue = await readTaskQueueFileNormalized(projectTasksPath(project.path))
      const startReadiness = await projectStartReadinessForProject(project.path)
      const { orientationSpine: spine } = buildOrientationSpineWithScopedReleaseTruth({
        projectId: project.id,
        charter: inferProjectCharterFromExistingSources(project.path, project.config),
        selectedReleaseId: rawQueue.selectedReleaseId,
        releases: rawQueue.releases,
        tasks: rawQueue.tasks as Task[],
        runStatus: supervisor.get(project.id)?.status ?? 'stopped',
        startReadiness,
        workspaceImportDraft: await workspaceImportDraftForOrientation(project.path, startReadiness),
        sourceRefs: projectOrientationSourceRefs(project.path),
      })
      return c.json({ ...result, spine })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, /not found|no release|no task queue/i.test(message) ? 404 : 500)
    }
  })

  app.get('/api/project/project-graph', async c => {
    try {
      const tasks = await readTasksFileNormalized(projectTasksPath(project.path)).catch(() => [])
      return c.json({
        projectGraph: queryProjectGraphView({
          projectId: project.id,
          projectPath: project.path,
          structuralDomains: structuralDomainsForProjectGraph(project.path),
          coordinators: project.config?.coordinators ?? [],
          surfaceReviewPackets: tasks.flatMap(surfaceReviewPacketsFromTask),
        }),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/project-graph/domain-authority', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as {
        domainId?: unknown
        domainLabel?: unknown
        providerProjectId?: unknown
      }
      const domainId = typeof body.domainId === 'string' ? body.domainId.trim() : ''
      const domainLabel = typeof body.domainLabel === 'string' && body.domainLabel.trim()
        ? body.domainLabel.trim()
        : domainId.replace(/^domain:/, '')
      const providerProjectId = typeof body.providerProjectId === 'string' ? body.providerProjectId.trim() : ''
      if (!domainId) return c.json({ error: 'domainId is required.' }, 400)
      if (!providerProjectId) return c.json({ error: 'providerProjectId is required.' }, 400)

      const providerProject = resolveLocalProjectRefForGraph(providerProjectId, project)
      if (!providerProject) return c.json({ error: `Local project not found: ${providerProjectId}` }, 404)
      const domainAuthority = await assignProjectDomainAuthority({
        domain: { id: domainId, label: domainLabel },
        providerProject,
        assignedBy: 'owner',
        evidenceRefs: [`project:${project.id}`, domainId],
      })
      return c.json({
        domainAuthority,
        projectGraph: queryProjectGraphView({
          projectId: project.id,
          projectPath: project.path,
          structuralDomains: structuralDomainsForProjectGraph(project.path),
          coordinators: project.config?.coordinators ?? [],
        }),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/project-graph/domain-responsibility', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as {
        domainId?: unknown
        domainLabel?: unknown
        facet?: unknown
        responsibleProjectId?: unknown
      }
      const domainId = typeof body.domainId === 'string' ? body.domainId.trim() : ''
      const domainLabel = typeof body.domainLabel === 'string' && body.domainLabel.trim()
        ? body.domainLabel.trim()
        : domainId.replace(/^domain:/, '')
      const facet = parseProjectDomainResponsibilityFacet(body.facet)
      const responsibleProjectId = typeof body.responsibleProjectId === 'string' ? body.responsibleProjectId.trim() : ''
      if (!domainId) return c.json({ error: 'domainId is required.' }, 400)
      if (!facet) return c.json({ error: 'facet is required.' }, 400)
      if (!responsibleProjectId) return c.json({ error: 'responsibleProjectId is required.' }, 400)

      const responsibleProject = resolveLocalProjectRefForGraph(responsibleProjectId, project)
      if (!responsibleProject) return c.json({ error: `Local project not found: ${responsibleProjectId}` }, 404)
      const domainResponsibility = await assignProjectDomainResponsibility({
        domain: { id: domainId, label: domainLabel },
        facet,
        responsibleProject,
        assignedBy: 'owner',
        evidenceRefs: [`project:${project.id}`, domainId, `facet:${facet}`],
      })
      return c.json({
        domainResponsibility,
        projectGraph: queryProjectGraphView({
          projectId: project.id,
          projectPath: project.path,
          structuralDomains: structuralDomainsForProjectGraph(project.path),
          coordinators: project.config?.coordinators ?? [],
        }),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/project-graph/requests/:edgeId/:action', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
      const edgeId = c.req.param('edgeId')
      const action = c.req.param('action')
      let edge: ProjectDependencyEdge
      switch (action) {
        case 'provider-accept':
          edge = await importProjectDependencyRequestForProvider({
            edgeId,
            providerProjectPath: project.path,
            importedBy: 'owner',
            providerTaskRef: stringField(body.providerTaskRef),
            providerCoordinatorContext: {
              projectId: project.id,
              coordinatorId: stringField(body.coordinatorId) ?? 'owner',
              summary: stringField(body.summary) ?? 'Provider accepted the incoming project request.',
              evidenceRefs: [`project:${project.id}`, `edge:${edgeId}`],
            },
          })
          break
        case 'provider-plan': {
          const deliveryExpectation = parseProjectDependencyDeliveryExpectation(body)
          edge = await reviseProjectDependencyPlan({
            edgeId,
            providerProjectPath: project.path,
            revisedBy: 'owner',
            deliveryExpectation,
          }).catch(async (err) => {
            if (err instanceof Error && /cannot revise_plan from provider_shaping/.test(err.message)) {
              return commitProjectDependencyDeliveryPlan({
                edgeId,
                providerProjectPath: project.path,
                plannedBy: 'owner',
                deliveryExpectation,
              })
            }
            throw err
          })
          break
        }
        case 'provider-deliver':
          edge = await deliverProjectDependency({
            edgeId,
            providerProjectPath: project.path,
            deliveredBy: 'owner',
            deliveryReceipt: parseProjectDependencyDeliveryReceipt(body),
          })
          break
        case 'consumer-review':
          edge = await beginProjectDependencyConsumerReview({
            edgeId,
            consumerProjectPath: project.path,
            reviewedBy: 'owner',
            verificationContext: stringField(body.verificationContext) ?? 'Consumer started verification against the requested delivery format.',
          })
          break
        case 'consumer-return':
          edge = await requestProjectDependencyRevision({
            edgeId,
            consumerProjectPath: project.path,
            returnedBy: 'owner',
            returnPacket: parseConsumerReturnPacket(body),
          })
          break
        case 'consumer-accept':
          edge = await acceptProjectDependencyDelivery({
            edgeId,
            consumerProjectPath: project.path,
            acceptedBy: 'owner',
            consumerProof: stringArrayField(body.consumerProof) ?? [stringField(body.proof) ?? 'Consumer verified the delivery.'],
          })
          break
        default:
          return c.json({ error: `Unknown project graph action: ${action}` }, 400)
      }
      return c.json({
        edge,
        projectGraph: queryProjectGraphView({
          projectId: project.id,
          projectPath: project.path,
          structuralDomains: structuralDomainsForProjectGraph(project.path),
          coordinators: project.config?.coordinators ?? [],
        }),
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

  app.get('/api/project/runtime', async c => {
    try {
      return c.json(await runtimeSupervisor.inspect(project.path))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/runtime/health', async c => {
    try {
      return c.json(await runtimeSupervisor.health(project.path))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/runtime/command', async c => {
    try {
      const rawBody = await c.req.json().catch(() => ({}))
      const parsed = ProjectRuntimeCommandRequest.safeParse(rawBody)
      if (!parsed.success) {
        return c.json({ error: 'Invalid runtime command request.', issues: parsed.error.issues }, 400)
      }
      if (parsed.data.projectId !== project.id) {
        return c.json({ error: `Runtime command projectId must match ${project.id}.` }, 400)
      }

      const result = await runtimeSupervisor.runCommand(project.path, parsed.data)
      const deniedHostPath = parseDeniedHostAccess(result.error)
      const capabilityRequest = deniedHostPath && result.taskId
        ? await createCapabilityRequest({
            memoryDir: getProjectStateDir(project.path),
            taskId: result.taskId,
            kind: 'mount_directory',
            requestedBy: 'runtime-command',
            reason: `Runtime command ${result.commandId} needs access to ${deniedHostPath}.`,
            mount: suggestedCapabilityMountForHostPath(deniedHostPath),
          })
        : null

      return c.json({
        ...result,
        ...(capabilityRequest ? { capabilityRequest } : {}),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/capability-requests', async c => {
    try {
      const memoryDir = getProjectStateDir(project.path)
      return c.json({
        requests: listCapabilityRequests(memoryDir),
        activeGrants: listActiveCapabilityGrants(memoryDir),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/capability-requests/:requestId/approve', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as {
        access?: 'read-only' | 'read-write'
        hostPath?: string
        duration?: string
      }
      return c.json(await approveMountDirectoryRequest({
        memoryDir: getProjectStateDir(project.path),
        projectRoot: project.path,
        requestId: c.req.param('requestId'),
        approvedBy: 'owner',
        ...(body.access ? { access: body.access } : {}),
        ...(body.hostPath ? { hostPath: body.hostPath } : {}),
        ...(body.duration ? { duration: body.duration } : {}),
      }))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/capability-requests/:requestId/deny', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as { fallback?: string }
      return c.json(await denyCapabilityRequest({
        memoryDir: getProjectStateDir(project.path),
        projectRoot: project.path,
        requestId: c.req.param('requestId'),
        deniedBy: 'owner',
        ...(body.fallback ? { fallback: body.fallback } : {}),
      }))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/capability-requests/:requestId/block', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as { reason?: string }
      return c.json(await markCapabilityRequestBlocked({
        memoryDir: getProjectStateDir(project.path),
        projectRoot: project.path,
        requestId: c.req.param('requestId'),
        blockedBy: 'owner',
        reason: body.reason?.trim() || 'Owner marked the capability request blocked.',
      }))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/capability-requests/:requestId/revoke', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as { reason?: string }
      return c.json(await revokeCapabilityGrant({
        memoryDir: getProjectStateDir(project.path),
        projectRoot: project.path,
        requestId: c.req.param('requestId'),
        revokedBy: 'owner',
        ...(body.reason ? { reason: body.reason } : {}),
      }))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/runtime/dev-servers', async c => {
    try {
      return c.json({ devServers: await devServerManager.list(project.path) })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/runtime/dev-servers', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as Partial<StartDevServerRequest>
      const request = parseStartDevServerRequest(body)
      if (!request.ok) return c.json({ error: request.error }, 400)
      if (request.value.projectId !== project.id) {
        return c.json({ error: `Dev server projectId must match ${project.id}.` }, 400)
      }
      return c.json(await devServerManager.start(project.path, request.value))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/runtime/dev-servers/:id/stop', async c => {
    try {
      return c.json(await devServerManager.stop(project.path, c.req.param('id')))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/runtime/dev-servers/:id/restart', async c => {
    try {
      return c.json(await devServerManager.restart(project.path, c.req.param('id')))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/runtime/setup', async c => {
    try {
      return c.json(await runtimeBackendSetup({ projectRoot: project.path }))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/runtime/setup/action', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as {
        action?: unknown
        approved?: unknown
      }
      const action = typeof body.action === 'string' ? body.action : ''
      if (![
        'install-instructions',
        'initialize-machine',
        'start-machine',
        'retry-detection',
        'use-host-run-compatibility',
      ].includes(action)) {
        return c.json({ error: 'Unknown runtime setup action.' }, 400)
      }
      if (
        (action === 'initialize-machine' || action === 'start-machine')
        && body.approved !== true
      ) {
        const result = await runRuntimeBackendSetupAction(project.path, {
          action: action as never,
          approved: false,
        })
        return c.json(result, 403)
      }

      const result = await runRuntimeBackendSetupAction(project.path, {
        action: action as never,
        approved: body.approved === true,
      })
      return c.json(result, result.ok ? 200 : 500)
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
        `${preferredLabel} defaults will be used unless you switch providers or configure models for ${preferredLabel}.`,
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

  function isCompleteModelAssignment(assignment: Partial<ModelAssignmentConfig>): assignment is ModelAssignmentConfig {
    return (
      typeof assignment.spec === 'string' &&
      typeof assignment.coordinator === 'string' &&
      typeof assignment.worker === 'string' &&
      typeof assignment.reviewer === 'string' &&
      typeof assignment.gateChecker === 'string' &&
      typeof assignment.contextIndexer === 'string'
    )
  }

  async function projectStartReadiness(input: {
    projectPath: string
    resolvedConfig: ReturnType<typeof resolveConfig>
    runtimeProvider: ReturnType<typeof getRuntimeProviderConfig>
    allowPaidProviderFallback: boolean
    allowTaskReadinessBlocker?: boolean
    requestedTaskId?: string
  }): Promise<{
    canStart: boolean
    code?: string
    message?: string
    actionHref?: string
    focusTaskId?: string
    focusTaskTitle?: string
    focusKind?: string
    count?: number
    loadedModels?: string[]
    missingModels?: string[]
  }> {
    const runtimeBlocker = projectRuntimeCompatibilityBlocker({ projectRoot: input.projectPath })
    if (runtimeBlocker) return runtimeBlocker

    const requiredMigrationBlocker = await startBlockerForRequiredMigrations(input.projectPath)
    if (requiredMigrationBlocker) return requiredMigrationBlocker

    const ownerInputBlocker = startBlockerForOwnerInput(input.projectPath)
    if (ownerInputBlocker) return ownerInputBlocker

    const workspaceImportCoverageBlocker = await startBlockerForWorkspaceImportCoverage(input.projectPath)
    if (workspaceImportCoverageBlocker) return workspaceImportCoverageBlocker

	    const importDraftBlocker = await startBlockerForImportDrafts(input.projectPath)
	    if (importDraftBlocker) return importDraftBlocker

	    if (input.allowTaskReadinessBlocker !== false) {
	      const selectedReleaseReviewBlocker = await startBlockerForSelectedReleaseReview(input.projectPath, input.resolvedConfig)
	      if (selectedReleaseReviewBlocker) return selectedReleaseReviewBlocker

	      const taskReadinessBlocker = await startBlockerForTaskReadiness(input.projectPath)
	      if (taskReadinessBlocker) return taskReadinessBlocker
	    }

	    const terminal = await terminalStartState(input.projectPath, input.requestedTaskId)
    if (terminal) {
      return {
        canStart: false,
        code: terminal.code,
        message: terminal.message,
        ...(terminal.actionHref ? { actionHref: terminal.actionHref } : {}),
        ...(terminal.focusTaskId ? { focusTaskId: terminal.focusTaskId } : {}),
        ...(terminal.focusTaskTitle ? { focusTaskTitle: terminal.focusTaskTitle } : {}),
        ...(terminal.focusKind ? { focusKind: terminal.focusKind } : {}),
        ...(terminal.count ? { count: terminal.count } : {}),
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
          'No provider configured. Open Providers to choose one before starting.',
        actionHref: '/providers',
      }
    }

    if (preflight.providerName !== 'llama-cpp') {
      return await readyStartStatus(
        input.projectPath,
        input.requestedTaskId,
        input.resolvedConfig.id ?? basename(input.projectPath),
      )
    }

    const creds = input.runtimeProvider.credentials
    if (!creds.llamaCppUrl) {
      return await readyStartStatus(
        input.projectPath,
        input.requestedTaskId,
        input.resolvedConfig.id ?? basename(input.projectPath),
      )
    }

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
            'The configured local server is reachable, but no loaded model was visible. To avoid surprise memory pressure from JIT loading, load the model you want on that server, then start again.',
          actionHref: '/providers',
          loadedModels,
        }
      }
      return await readyStartStatus(
        input.projectPath,
        input.requestedTaskId,
        input.resolvedConfig.id ?? basename(input.projectPath),
      )
    }

    const missingModels = missingAssignedModels(input.resolvedConfig.models, loadedModels)
    if (missingModels.length === 0) {
      return await readyStartStatus(
        input.projectPath,
        input.requestedTaskId,
        input.resolvedConfig.id ?? basename(input.projectPath),
      )
    }

    const paidFallback = input.allowPaidProviderFallback
      ? await selectPaidFallbackProvider(creds)
      : null
    if (paidFallback && paidFallback.providerName !== 'none') {
      return await readyStartStatus(
        input.projectPath,
        input.requestedTaskId,
        input.resolvedConfig.id ?? basename(input.projectPath),
      )
    }
    return {
      canStart: false,
      code: 'model_unavailable',
      message:
        `The configured local server currently has ${loadedModels.join(', ')} loaded, but this project is configured for ${missingModels.join(', ')}. ` +
        'Missing models are not JIT-loaded automatically; load the configured model on that server or choose a loaded model in Providers.',
      actionHref: '/providers',
      loadedModels,
      missingModels,
    }
  }

  async function readyStartStatus(projectPath: string, requestedTaskId: string | undefined, projectId: string): Promise<{
    canStart: true
    code?: string
    message?: string
    actionHref?: string
    focusTaskId?: string
    focusTaskTitle?: string
    focusKind?: string
    count?: number
  }> {
    const activeRun = supervisor.get(projectId)
    if (activeRun?.status === 'running' || activeRun?.status === 'stopping') return { canStart: true }
    return await startStatusForPausedLiveWork(projectPath, requestedTaskId) ?? { canStart: true }
  }

  async function startStatusForPausedLiveWork(projectPath: string, requestedTaskId?: string): Promise<{
    canStart: true
    code: 'paused_live_work'
    message: string
    actionHref: string
    focusTaskId: string
    focusTaskTitle: string
    focusKind: 'paused_work'
    count: number
  } | null> {
    const tasksPath = projectTasksPath(projectPath)
    if (!existsSync(tasksPath)) return null
    const queue = await readTaskQueueFileNormalized(tasksPath)
    const typedQueue = {
      tasks: queue.tasks as Task[],
      releases: queue.releases,
      ...(queue.selectedReleaseId ? { selectedReleaseId: queue.selectedReleaseId } : {}),
    }
    const selectedReleaseScope = selectedReleaseScopeFromQueueLike(typedQueue)
    const scopedTasks = tasksEligibleForScopeExecution(typedQueue.tasks, selectedReleaseScope)
    const pausedTasks = scopedTasks.filter(task => {
      if (!task || typeof task !== 'object') return false
      if (requestedTaskId && task.id !== requestedTaskId) return false
      return ['in_progress', 'review', 'gate_check'].includes(String(task.status ?? ''))
    })
    if (pausedTasks.length === 0) return null
    const first = pausedTasks
      .slice()
      .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))[0]!
    const focusTitle = typeof first.title === 'string' && first.title.trim().length > 0
      ? first.title.trim()
      : first.id
    return {
      canStart: true,
      code: 'paused_live_work',
      message: pausedTasks.length === 1
        ? `"${focusTitle}" is paused in live work. Resume continues from that pinned task.`
        : `${pausedTasks.length} live work items are paused. Resume continues from "${focusTitle}".`,
      actionHref: `/work?task=${encodeURIComponent(first.id)}`,
      focusTaskId: first.id,
      focusTaskTitle: focusTitle,
      focusKind: 'paused_work',
      count: pausedTasks.length,
    }
  }

  async function projectStartReadinessForProject(
    projectPath: string,
    opts: {
      allowTaskReadinessBlocker?: boolean
      requestedTaskId?: string
    } = {},
  ) {
    const resolvedConfig = resolveConfig({ workspacePath: projectPath })
    const runtimeProvider = getRuntimeProviderConfig({
      projectPath,
      models: resolvedConfig.models,
    })
    return projectStartReadiness({
      projectPath,
      resolvedConfig,
      runtimeProvider,
      allowPaidProviderFallback: runtimeProvider.allowPaidProviderFallback,
      ...(opts.allowTaskReadinessBlocker !== undefined
        ? { allowTaskReadinessBlocker: opts.allowTaskReadinessBlocker }
        : {}),
      ...(opts.requestedTaskId ? { requestedTaskId: opts.requestedTaskId } : {}),
    })
  }

  function blockedStartStatus(code: string | undefined): 400 | 409 {
    switch (code) {
      case 'required_migration_pending':
      case 'runtime_too_old':
      case 'owner_input_required':
        return 409
      default:
        return 400
    }
  }

  function taskSpecText(spec: unknown): string {
    if (typeof spec === 'string') return spec
    if (Array.isArray(spec)) {
      const lines = spec
        .filter((entry): entry is string => typeof entry === 'string')
        .map(entry => entry.trimEnd())
      return lines.join('\n')
    }
    return ''
  }

	  async function terminalStartState(projectPath: string, requestedTaskId?: string): Promise<{
	    canStart: false
	    code: 'all_terminal' | 'proof_evidence_missing'
	    message: string
      actionHref?: string
      focusTaskId?: string
      focusTaskTitle?: string
      focusKind?: string
      count?: number
    stopSummary: {
      reason: 'all_terminal'
      message: string
      counts: {
        total: number
        done: number
        blocked: number
        shelved: number
        pendingPr: number
        archived: number
        cancelled: number
        actionable: number
        terminal: number
      }
    }
	  } | null> {
    const tasksPath = projectTasksPath(projectPath)
    if (!existsSync(tasksPath)) return null
    let raw: unknown
    try {
      raw = JSON.parse(readManagedTextFileSync(tasksPath, 'utf-8'))
    } catch {
      return null
    }
    const tasks = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks)
        ? (raw as { tasks: unknown[] }).tasks
        : []
    if (tasks.length === 0) return null
	    if (
	      requestedTaskId &&
	      await hasRecoverableBlockedStartTask(projectPath, tasks, requestedTaskId)
	    ) {
	      return null
	    }

    const typedTasks = tasks.filter((task): task is Task => Boolean(task && typeof task === 'object'))
    const selectedReleaseScope = !requestedTaskId
      ? selectedReleaseScopeFromQueueLike({
        tasks: typedTasks,
        releases: !Array.isArray(raw) && raw && typeof raw === 'object' && Array.isArray((raw as { releases?: unknown }).releases)
          ? (raw as { releases: TaskQueue['releases'] }).releases
          : undefined,
        selectedReleaseId: !Array.isArray(raw) && raw && typeof raw === 'object' && typeof (raw as { selectedReleaseId?: unknown }).selectedReleaseId === 'string'
          ? (raw as { selectedReleaseId: string }).selectedReleaseId
          : undefined,
      })
      : null
	    const tasksById = new Map(typedTasks.map(task => [task.id, task] as const))
	    const scopedTasks = selectedReleaseScope
	      ? tasksEligibleForScopeExecution(typedTasks, selectedReleaseScope)
	        .filter(task => task.id !== META_INTAKE_TASK_ID && task.id !== WORKSPACE_IMPORT_TASK_ID)
	        .filter(task => {
	          const parentId = task.hierarchy?.parentId?.trim()
	          const parent = parentId ? tasksById.get(parentId) ?? null : null
	          return deriveTaskWorkVisibility(task, parent).countInProjectTotals
	        })
	      : typedTasks.filter(task => task.id !== META_INTAKE_TASK_ID && task.id !== WORKSPACE_IMPORT_TASK_ID)
	    if (selectedReleaseScope && scopedTasks.length === 0) return null

    let done = 0
    let blocked = 0
    let shelved = 0
    let pendingPr = 0
    let archived = 0
    let cancelled = 0
    let terminal = 0
    const proofMissingDoneTasks: Array<{ id: string; title: string }> = []
    for (const task of scopedTasks) {
      if (!task || typeof task !== 'object') return null
      const status = String((task as { status?: unknown }).status ?? '')
      if (status === 'done') {
        done += 1
        terminal += 1
        if (taskDoneButProofMissing(task)) {
          const id = typeof (task as { id?: unknown }).id === 'string' && (task as { id: string }).id.trim()
            ? (task as { id: string }).id.trim()
            : ''
          const title = typeof (task as { title?: unknown }).title === 'string' && (task as { title: string }).title.trim()
            ? (task as { title: string }).title.trim()
            : id || 'completed task'
          if (id) proofMissingDoneTasks.push({ id, title })
        }
      } else if (status === 'blocked') {
        blocked += 1
        terminal += 1
      } else if (status === 'shelved') {
        shelved += 1
        terminal += 1
      } else if (status === 'pending_pr') {
        pendingPr += 1
        terminal += 1
      } else if (status === 'archived') {
        archived += 1
        terminal += 1
      } else if (status === 'cancelled') {
        cancelled += 1
        terminal += 1
      }
    }
    const actionable = scopedTasks.length - terminal
    if (actionable > 0) return null

    const detailMessage = `No actionable tasks remain: ${done} done, ${blocked} blocked, ${shelved} shelved, ${pendingPr} pending PR, ${archived} archived, ${cancelled} cancelled.`
    if (proofMissingDoneTasks.length > 0) {
      const first = proofMissingDoneTasks[0]!
      const scopeLabel = selectedReleaseScope?.label ?? 'Current task scope'
      const message = proofMissingDoneTasks.length === 1
        ? `${scopeLabel} is waiting on proof evidence for "${first.title}".`
        : `${scopeLabel} is waiting on proof evidence for ${proofMissingDoneTasks.length} completed tasks, starting with "${first.title}".`
      return {
        canStart: false,
        code: 'proof_evidence_missing',
        message,
        actionHref: `/work?task=${encodeURIComponent(first.id)}`,
        focusTaskId: first.id,
        focusTaskTitle: first.title,
        focusKind: 'proof',
        count: proofMissingDoneTasks.length,
        stopSummary: {
          reason: 'all_terminal',
          message: detailMessage,
          counts: {
            total: scopedTasks.length,
            done,
            blocked,
            shelved,
            pendingPr,
            archived,
            cancelled,
            actionable,
            terminal,
          },
        },
      }
    }
    let message = done === scopedTasks.length
      ? 'All tasks are already finished.'
      : detailMessage
	    if (selectedReleaseScope) {
	      const outsideActionableByStatus = new Map<string, number>()
	      for (const task of typedTasks) {
	        if (taskEligibleForSelectedScope(task, selectedReleaseScope, { tasksById }).eligible) continue
        const status = String(task.status ?? '')
        if (['done', 'blocked', 'shelved', 'pending_pr', 'archived', 'cancelled'].includes(status)) continue
        outsideActionableByStatus.set(status, (outsideActionableByStatus.get(status) ?? 0) + 1)
      }
      const outsideFragments = [...outsideActionableByStatus.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([status, count]) => `${count} ${status.replaceAll('_', ' ')}`)
      message = `${selectedReleaseScope.label} is complete.${
        outsideFragments.length > 0
          ? ` ${outsideFragments.join(', ')} ${outsideFragments.length === 1 && outsideFragments[0]?.startsWith('1 ') ? 'task remains' : 'tasks remain'} outside this release.`
          : ''
      }`
    }

	    return {
	      canStart: false,
	      code: 'all_terminal',
      message,
      stopSummary: {
        reason: 'all_terminal',
        message: detailMessage,
        counts: {
          total: scopedTasks.length,
          done,
          blocked,
          shelved,
          pendingPr,
          archived,
          cancelled,
          actionable,
          terminal,
        },
      },
	    }
	  }

		  async function hasRecoverableBlockedStartTask(
	    projectPath: string,
	    tasks: unknown[],
	    requestedTaskId: string,
	  ): Promise<boolean> {
	    const rawTask = tasks.find(task =>
	      Boolean(task && typeof task === 'object' && (task as { id?: unknown }).id === requestedTaskId),
	    )
	    if (!rawTask) return false
	    if (isRecoverableBlockedStartTask(rawTask, requestedTaskId)) return true
	    try {
	      const effectiveTask = await buildEffectiveTask(projectPath, rawTask as Task)
	      return isRecoverableBlockedStartTask(effectiveTask, requestedTaskId)
	    } catch {
	      return false
	    }
	  }

	  function isRecoverableBlockedStartTask(task: unknown, requestedTaskId: string): boolean {
	    if (!task || typeof task !== 'object') return false
	    const candidate = task as {
	      id?: unknown
	      status?: unknown
	      blockReason?: unknown
	      worktreePath?: unknown
	      branchName?: unknown
	      reviewVerdicts?: unknown
	    }
	    if (candidate.id !== requestedTaskId) return false
	    if (candidate.status !== 'blocked') return false
	    const blockReason = typeof candidate.blockReason === 'string' ? candidate.blockReason : ''
	    if (/max_revisions_exceeded:/i.test(blockReason) && hasPriorAllClearLlmStartReview(candidate.reviewVerdicts)) {
	      return true
	    }
	    if (
	      !blockReason.includes('Guildhall could not create a task worktree:') ||
	      !/already exists/i.test(blockReason)
	    ) {
	      return false
	    }
	    return true
	  }

	  function hasPriorAllClearLlmStartReview(reviewVerdicts: unknown): boolean {
	    if (!Array.isArray(reviewVerdicts)) return false
	    return reviewVerdicts.some((raw) => {
	      if (!raw || typeof raw !== 'object') return false
	      const verdict = raw as {
	        reviewerPath?: unknown
	        failingSignals?: unknown
	        reasoning?: unknown
	      }
	      if (verdict.reviewerPath !== 'llm') return false
	      if (Array.isArray(verdict.failingSignals) && verdict.failingSignals.length > 0) return false
	      const reasoning = typeof verdict.reasoning === 'string' ? verdict.reasoning : ''
	      return [
	        'acceptance-criteria-met',
	        'no-scope-creep',
	        'conventions-followed',
	        'no-regressions',
	      ].every((key) => new RegExp(`${key}\\s*:\\s*yes\\b`, 'i').test(reasoning))
	    })
	  }

  async function startBlockerForImportDrafts(projectPath: string): Promise<{
    canStart: false
    code: 'import_drafts_waiting' | 'imported_scope_shaping'
    message: string
    actionHref: string
  } | null> {
    const tasksPath = projectTasksPath(projectPath)
    if (!existsSync(tasksPath)) return null
    const queue = await readTaskQueueFileNormalized(tasksPath)
    const typedQueue = {
      tasks: queue.tasks as Task[],
      releases: queue.releases,
      ...(queue.selectedReleaseId ? { selectedReleaseId: queue.selectedReleaseId } : {}),
    }
    const selectedReleaseScope = selectedReleaseScopeFromQueueLike(typedQueue)
    const tasks = tasksEligibleForScopeExecution(typedQueue.tasks, selectedReleaseScope)
    const importedShapingTasks = tasks.filter(importedTaskNeedsBriefShaping)
    if (importedShapingTasks.length === 0) return null
    const importerTask = typedQueue.tasks.find(task =>
      task &&
      typeof task === 'object' &&
      (task as { id?: unknown }).id === WORKSPACE_IMPORT_TASK_ID,
    ) as { status?: unknown } | undefined
    const runnable = tasks.some(t => {
      if (!t || typeof t !== 'object') return false
      if (importedTaskNeedsBriefShaping(t)) return false
      const status = String((t as { status?: unknown }).status ?? '')
      return ['proposed', 'ready', 'exploring', 'in_progress', 'review', 'gate_check', 'spec_review'].includes(status)
    })
    if (runnable) return null
    const first = importedShapingTasks[0] as { id?: unknown; title?: unknown; status?: unknown }
    const title = typeof first.title === 'string' && first.title.trim() ? first.title.trim() : 'the first imported draft'
    const id = typeof first.id === 'string' ? first.id : ''
    const importerDone =
      typeof importerTask?.status === 'string' && ['done', 'spec_review'].includes(importerTask.status)
    const shapingCount = importedShapingTasks.length
    const rawImportDraftCount = importedShapingTasks.filter(task => task.status === 'import_draft').length
    const shapingStarted = first.status === 'exploring' || rawImportDraftCount < shapingCount
    return {
      canStart: false,
      code: importerDone || shapingStarted ? 'imported_scope_shaping' : 'import_drafts_waiting',
      message:
        importerDone || shapingStarted
          ? shapingCount === 1
            ? `Imported current work still needs a real brief before Guildhall can build unattended. Start with "${title}".`
            : `${shapingCount} imported current-scope tasks still need real briefs before Guildhall can build unattended. Start with "${title}".`
          : shapingCount === 1
            ? `Review the imported draft "${title}" and turn it into a task brief before starting.`
            : `Review ${shapingCount} imported drafts before starting. Start with "${title}".`,
      actionHref: id ? `/task/${encodeURIComponent(id)}` : '/notifications',
    }
  }

  async function startBlockerForWorkspaceImportCoverage(projectPath: string): Promise<{
    canStart: false
    code: 'workspace_import_refresh_needed'
    message: string
    actionHref: string
  } | null> {
    const workspaceGoalsState = await readWorkspaceGoalsState(getProjectStateDir(projectPath))
    const normalizeImportTitle = (value: string): string =>
      value
        .trim()
        .toLowerCase()
        .replace(/[`*_~]/g, '')
        .replace(/[^a-z0-9\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    const normalizeImportRef = (value: string): string =>
      value.replaceAll('\\', '/').trim()
    const refsFromRecord = (value: unknown): string[] => {
      if (!value || typeof value !== 'object') return []
      const refs = (value as { references?: unknown }).references
      return Array.isArray(refs)
        ? refs.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map(normalizeImportRef)
        : []
    }

    const tasksPath = projectTasksPath(projectPath)
    if (!existsSync(tasksPath)) return null
    const raw = JSON.parse(await readManagedTextFile(tasksPath, 'utf-8')) as
      | { tasks?: Array<Record<string, unknown>> }
      | Array<Record<string, unknown>>
    const tasks = Array.isArray(raw) ? raw : raw.tasks ?? []
    const importTask = tasks.find(task =>
      task &&
      typeof task === 'object' &&
      (task as { id?: unknown }).id === WORKSPACE_IMPORT_TASK_ID,
    ) as { status?: unknown; spec?: unknown } | undefined
    if (!importTask) return null
    const status = typeof importTask.status === 'string' ? importTask.status : ''
    const spec = taskSpecText(importTask.spec)
    if (!['done', 'spec_review'].includes(status) || !spec.trim()) return null

    const parsed = parseWorkspaceImport(spec)
    const inventory = await detectWorkspaceSignals({ projectPath })
    const detected = await materializeWorkspaceImportDraft({
      memoryDir: getProjectStateDir(projectPath),
      projectPath,
      draft: formWorkspaceHypothesis(inventory),
    })
    const shadowedCurrentDeliverables = (() => {
      const seen = new Set<string>()
      const sources: Array<{ path: string; content: string }> = []
      for (const signal of inventory.signals) {
        if (signal.source !== 'planning-docs') continue
        for (const reference of signal.references ?? []) {
          if (!reference || /^[a-z]+:\/\//i.test(reference)) continue
          const absolute = isAbsolute(reference) ? reference : resolve(projectPath, reference)
          if (seen.has(absolute) || !existsSync(absolute) || extname(absolute).toLowerCase() !== '.md') continue
          seen.add(absolute)
          try {
            sources.push({
              path: absolute,
              content: readFileSync(absolute, 'utf-8'),
            })
          } catch {
            // Ignore unreadable files; readiness should keep going with what it can verify.
          }
        }
      }
      return detectShadowedCurrentMilestoneDeliverables(sources)
    })()
    const isShadowedCurrentDeliverable = (title: string, reference: string | null | undefined): boolean => {
      const normalizedTitle = normalizeImportTitle(title)
      if (!normalizedTitle) return false
      const normalizedReference = reference
        ? (isAbsolute(reference) ? reference : resolve(projectPath, reference)).replaceAll('\\', '/')
        : null
      const matchingCandidates = shadowedCurrentDeliverables.filter(
        candidate => normalizeImportTitle(candidate.title) === normalizedTitle,
      )
      if (matchingCandidates.length === 0) return false
      if (!normalizedReference || matchingCandidates.length === 1) return true
      return matchingCandidates.some(candidate => {
        const candidatePath = candidate.sourcePath.replaceAll('\\', '/')
        return normalizedReference === candidatePath
      })
    }
    if (workspaceGoalsNeedStructuralRefresh(workspaceGoalsState)) {
      const firstStructuralLabel = (
        detected.context.find(context =>
          (context.role === 'brief_input' || context.role === 'capability') &&
          context.structure === 'record',
        ) ??
        detected.context.find(context =>
          context.role === 'brief_input' || context.role === 'capability',
        )
      )?.label?.trim() || 'the first structural record'
      return {
        canStart: false,
        code: 'workspace_import_refresh_needed',
        message:
          `Guildhall's saved workspace import was approved before structural project records were captured durably. ` +
          `The live docs still define structural context starting with "${firstStructuralLabel}". Refresh the import before treating this project as complete.`,
        actionHref: '/workspace-import',
      }
    }
    const liveNonImporterTasks = tasks.filter(task => {
      if (!task || typeof task !== 'object') return false
      if ((task as { id?: unknown }).id === WORKSPACE_IMPORT_TASK_ID) return false
      const status = typeof (task as { status?: unknown }).status === 'string'
        ? (task as { status: string }).status
        : ''
      return status !== 'archived' && status !== 'cancelled'
    })
    const approvedCurrentTitles = parsed.tasks
      .filter(task => task.scope !== 'later')
      .map(task => task.title.trim())
      .filter(title => title.length > 0)
    const fallbackApprovedTitles = approvedCurrentTitles.length > 0
      ? []
      : Array.from(spec.matchAll(/^\s*title:\s*(.+?)\s*$/gm))
        .map(match => match[1]?.trim() ?? '')
        .filter(title => title.length > 0)
    const detectedCurrentTitlesList = detected.tasks
      .filter(task => task.scope !== 'later')
      .map(task => task.title.trim())
      .filter(title => title.length > 0)
    const currentApprovedOrDetectedTitles = [
      ...approvedCurrentTitles,
      ...fallbackApprovedTitles,
      ...detectedCurrentTitlesList,
    ]
    if (detected.tasks.length === 0) {
      if (currentApprovedOrDetectedTitles.length > 0 && liveNonImporterTasks.length === 0) {
        const first = currentApprovedOrDetectedTitles[0] || 'the first approved current-scope task'
        return {
          canStart: false,
          code: 'workspace_import_refresh_needed',
          message:
            `Guildhall has an approved workspace-import slice, but none of that current work is materialized in the live queue. ` +
            `Refresh the import before treating this project as complete. Start with "${first}".`,
          actionHref: '/workspace-import',
        }
      }
      return null
    }

    const coveredTitles = new Set<string>()
    const currentScopeCoveredTitles = new Set<string>()
    const currentScopeContextCoveredTitles = new Set(
      (workspaceGoalsNeedStructuralRefresh(workspaceGoalsState) ? [] : (workspaceGoalsState?.context ?? []))
        .map(context => normalizeImportTitle(context.label))
        .filter(Boolean),
    )
    const coveredRefs = new Set<string>()
    const activeTaskHints = new Set<string>()
    for (const task of parsed.tasks) {
      if (typeof task.title === 'string' && task.title.trim().length > 0) {
        const normalized = normalizeImportTitle(task.title)
        coveredTitles.add(normalized)
        if (task.scope !== 'later') currentScopeCoveredTitles.add(normalized)
      }
      for (const ref of refsFromRecord(task)) coveredRefs.add(ref)
    }
    for (const milestone of parsed.milestones) {
      for (const ref of refsFromRecord(milestone)) coveredRefs.add(ref)
    }
    for (const task of tasks) {
      if (!task || typeof task !== 'object') continue
      if ((task as { id?: unknown }).id === WORKSPACE_IMPORT_TASK_ID) continue
      const status = typeof (task as { status?: unknown }).status === 'string'
        ? (task as { status: string }).status
        : ''
      if (status === 'archived' || status === 'cancelled') continue
      const id = typeof (task as { id?: unknown }).id === 'string'
        ? (task as { id: string }).id
        : ''
      if (id.trim()) activeTaskHints.add(normalizeImportTitle(id))
      const title = typeof (task as { title?: unknown }).title === 'string'
        ? (task as { title: string }).title
        : ''
      if (!title.trim()) continue
      const normalized = normalizeImportTitle(title)
      activeTaskHints.add(normalized)
      coveredTitles.add(normalized)
      if (status !== 'shelved') currentScopeCoveredTitles.add(normalized)
      for (const ref of refsFromRecord(task)) coveredRefs.add(ref)
    }
    for (const context of detected.context) {
      if (context.role !== 'reference') continue
      const linkedTaskHints = Array.isArray(context.linkedTaskHints)
        ? context.linkedTaskHints
            .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
            .map(normalizeImportTitle)
        : []
      if (linkedTaskHints.length === 0) continue
      if (!linkedTaskHints.some(hint => activeTaskHints.has(hint))) continue
      for (const ref of refsFromRecord(context)) coveredRefs.add(ref)
    }

    const missing = detected.tasks.filter(task => {
      const title = typeof task.title === 'string' ? task.title : ''
      return title.trim().length > 0 && !coveredTitles.has(normalizeImportTitle(title))
    })
    const currentScopeMissing = detected.tasks.filter(task => {
      if (task.scope === 'later') return false
      const title = typeof task.title === 'string' ? task.title : ''
      return title.trim().length > 0 && !currentScopeCoveredTitles.has(normalizeImportTitle(title))
    })
    const rawCurrentDeliverableMissing = (() => {
      const seen = new Set<string>()
      const missing: Array<{ title: string }> = []
      for (const signal of inventory.signals) {
        if (signal.kind !== 'open_work' && signal.kind !== 'context') continue
        if (signal.scopeHint !== 'current') continue
        if (signal.source !== 'planning-docs') continue
        if (signal.role !== 'capability') continue
        const title = typeof signal.title === 'string' ? signal.title.trim() : ''
        if (!title) continue
        const primaryRef = typeof signal.references?.[0] === 'string' ? signal.references[0] : null
        if (isShadowedCurrentDeliverable(title, primaryRef)) continue
        const evidence = typeof signal.evidence === 'string' ? signal.evidence.trim() : ''
        if (!evidence.includes(': - ')) continue
        const normalized = normalizeImportTitle(title)
        if (
          !normalized ||
          seen.has(normalized) ||
          currentScopeCoveredTitles.has(normalized) ||
          currentScopeContextCoveredTitles.has(normalized)
        ) continue
        seen.add(normalized)
        missing.push({ title })
      }
      return missing
    })()
    const detectedCurrentTitles = new Set(
      detected.tasks
        .filter(task => task.scope !== 'later')
        .map(task => normalizeImportTitle(typeof task.title === 'string' ? task.title : ''))
        .filter(Boolean),
    )
    const staleApprovedCurrent = parsed.tasks.filter(task => {
      if (task.scope === 'later') return false
      const normalized = normalizeImportTitle(task.title)
      return normalized.length > 0 && !detectedCurrentTitles.has(normalized)
    })
    const detectedTaskTitles = new Set(
      detected.tasks
        .map(task => normalizeImportTitle(typeof task.title === 'string' ? task.title : ''))
        .filter(Boolean),
    )
    const contextOnlyImportedGhosts = tasks.filter(task => {
      if (!task || typeof task !== 'object') return false
      if ((task as { id?: unknown }).id === WORKSPACE_IMPORT_TASK_ID) return false
      const status = typeof (task as { status?: unknown }).status === 'string'
        ? (task as { status: string }).status
        : ''
      if (status === 'archived' || status === 'cancelled') return false
      const origination = typeof (task as { origination?: unknown }).origination === 'string'
        ? (task as { origination: string }).origination
        : ''
      if (origination !== 'human') return false
      const createdBy = typeof (task as { requestIntake?: { createdBy?: unknown } }).requestIntake?.createdBy === 'string'
        ? (task as { requestIntake: { createdBy: string } }).requestIntake.createdBy
        : ''
      if (createdBy !== 'workspace-importer') return false
      const title = typeof (task as { title?: unknown }).title === 'string'
        ? (task as { title: string }).title
        : ''
      const normalizedTitle = normalizeImportTitle(title)
      if (!normalizedTitle || detectedTaskTitles.has(normalizedTitle)) return false
      return detected.context.some(context => {
        if (context.role !== 'capability' && context.role !== 'brief_input') return false
        const contextTitle = normalizeImportTitle(context.label)
        return contextTitle === normalizedTitle
      })
    })
    const hasExplicitDeferredScope =
      detected.tasks.some(task => task.scope === 'later') ||
      parsed.tasks.some(task => task.scope === 'later') ||
      detected.context.some(context => context.scopeHint === 'later') ||
      (workspaceGoalsState?.context ?? []).some(context => context.scopeHint === 'later')
    const uncoveredCapabilitySpecs = hasExplicitDeferredScope
      ? []
      : detected.context.filter(context => {
          if (context.scopeHint === 'later') return false
          if (context.role !== 'capability') return false
          const refs = refsFromRecord(context)
          const specRefs = refs.filter(ref => /(^|\/)docs\/specs\//.test(ref))
          if (specRefs.length === 0) return false
          return specRefs.every(ref => !coveredRefs.has(ref))
        })
    if (
      missing.length === 0 &&
      currentScopeMissing.length === 0 &&
      rawCurrentDeliverableMissing.length === 0 &&
      staleApprovedCurrent.length === 0 &&
      contextOnlyImportedGhosts.length === 0 &&
      uncoveredCapabilitySpecs.length === 0
    ) return null

    if (currentScopeMissing.length > 0) {
      const first = currentScopeMissing[0]?.title?.trim() || 'the first current-scope task'
      return {
        canStart: false,
        code: 'workspace_import_refresh_needed',
        message:
          `Guildhall's saved import is under-scoped for the current project docs. ` +
          `The live detector still treats ${currentScopeMissing.length} current task${currentScopeMissing.length === 1 ? '' : 's'} as active work outside the approved current scope, starting with "${first}". Refresh the import before treating this project as complete.`,
        actionHref: '/workspace-import',
      }
    }

    if (rawCurrentDeliverableMissing.length > 0) {
      const first = rawCurrentDeliverableMissing[0]?.title?.trim() || 'the first current-scope deliverable'
      return {
        canStart: false,
        code: 'workspace_import_refresh_needed',
        message:
          `Guildhall's saved import is under-scoped for the current project docs. ` +
          `The live detector still treats ${rawCurrentDeliverableMissing.length} current deliverable${rawCurrentDeliverableMissing.length === 1 ? '' : 's'} as active work outside the approved current scope, starting with "${first}". Refresh the import before treating this project as complete.`,
        actionHref: '/workspace-import',
      }
    }

    if (staleApprovedCurrent.length > 0) {
      const first = staleApprovedCurrent[0]?.title?.trim() || 'the first stale current-scope task'
      return {
        canStart: false,
        code: 'workspace_import_refresh_needed',
        message:
          `Guildhall's saved import still treats ${staleApprovedCurrent.length} current task${staleApprovedCurrent.length === 1 ? '' : 's'} as part of the active slice even though the live docs no longer do, starting with "${first}". Refresh the import before treating this project as complete.`,
        actionHref: '/workspace-import',
      }
    }

    if (contextOnlyImportedGhosts.length > 0) {
      const firstTitle = typeof contextOnlyImportedGhosts[0]?.title === 'string'
        ? contextOnlyImportedGhosts[0].title.trim()
        : ''
      const first = firstTitle || 'the first stale structural task'
      return {
        canStart: false,
        code: 'workspace_import_refresh_needed',
        message:
          `Guildhall's saved import still contains ${contextOnlyImportedGhosts.length} importer-created task${contextOnlyImportedGhosts.length === 1 ? '' : 's'} that the live docs now support only as structural context or brief input, starting with "${first}". Refresh the import before treating this project as complete.`,
        actionHref: '/workspace-import',
      }
    }

    if (uncoveredCapabilitySpecs.length > 0) {
      const first = uncoveredCapabilitySpecs[0]?.label?.trim() || 'the first uncovered spec'
      return {
        canStart: false,
        code: 'workspace_import_refresh_needed',
        message:
          `Guildhall's saved import is structurally incomplete for the current docs. ` +
          `The live detector still sees ${uncoveredCapabilitySpecs.length} spec-backed capability ${uncoveredCapabilitySpecs.length === 1 ? 'lane' : 'lanes'} with no linked work item, starting with "${first}". Refresh the import before treating this project as complete.`,
        actionHref: '/workspace-import',
      }
    }

    if (
      currentApprovedOrDetectedTitles.length > 0 &&
      liveNonImporterTasks.length === 0
    ) {
      const first = currentApprovedOrDetectedTitles[0] || 'the first approved current-scope task'
      return {
        canStart: false,
        code: 'workspace_import_refresh_needed',
        message:
          `Guildhall has an approved workspace-import slice, but none of that current work is materialized in the live queue. ` +
          `Refresh the import before treating this project as complete. Start with "${first}".`,
        actionHref: '/workspace-import',
      }
    }

    const currentMissing = missing.filter(task => task.scope !== 'later').length
    const laterMissing = missing.length - currentMissing
    const first = missing[0]?.title?.trim() || 'the first current-scope task'
    const missingSummary = laterMissing > 0
      ? `${missing.length} task${missing.length === 1 ? '' : 's'} (${currentMissing} now, ${laterMissing} later)`
      : `${missing.length} current task${missing.length === 1 ? '' : 's'}`
    return {
      canStart: false,
      code: 'workspace_import_refresh_needed',
      message:
        `Guildhall's saved import is under-scoped for the current project docs. ` +
        `The live detector found ${missingSummary} missing from the saved import/queue, starting with "${first}". Refresh the import before treating this project as complete.`,
      actionHref: '/workspace-import',
    }
  }

  async function workspaceImportDraftForOrientation(projectPath: string, _startReadiness: { code?: string } | null | undefined) {
    try {
      const draftTaskId = (task: {
        id?: string
        suggestedId?: string
        title: string
      }, index: number): string => {
        const explicit = task.id?.trim() || task.suggestedId?.trim()
        if (explicit) return explicit
        const slug = task.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
        return `draft-${slug || 'task'}-${index + 1}`
      }
      const draftTaskRefs = (task: {
        refs?: string[]
        references?: string[]
        source?: string
      }): string[] => {
        if (task.refs?.length) return [...task.refs]
        if (task.references?.length) return task.references.map(ref => `import:${ref}`)
        return task.source ? [`import:${task.source}`] : ['workspace-import:detected']
      }
      const savedWorkspaceGoals = await readWorkspaceGoalsState(getProjectStateDir(projectPath))
      if (savedWorkspaceGoals && !workspaceGoalsNeedStructuralRefresh(savedWorkspaceGoals) && (
        savedWorkspaceGoals.tasks.length > 0 ||
        savedWorkspaceGoals.context.length > 0
      )) {
        let detectedReleaseDraft: Awaited<ReturnType<typeof materializeWorkspaceImportDraft>> | null = null
        try {
          const inventory = await detectWorkspaceSignals({ projectPath })
          detectedReleaseDraft = formWorkspaceHypothesis(inventory)
        } catch {
          detectedReleaseDraft = null
        }
        const releaseIdsByTitle = new Map(
          (detectedReleaseDraft?.tasks ?? []).map(task => [
            task.title.trim().toLowerCase(),
            task.releaseIds ? [...task.releaseIds] : [],
          ]),
        )
        const savedTaskTitles = new Set(savedWorkspaceGoals.tasks.map(task => task.title.trim().toLowerCase()))
        const detectedOnlyTasks = (detectedReleaseDraft?.tasks ?? [])
          .filter(task => !savedTaskTitles.has(task.title.trim().toLowerCase()))
        const savedOrientationTasks = savedWorkspaceGoals.tasks.map(task => ({
          id: task.id,
          title: task.title,
          description: task.whyThisMayMatter ?? task.description,
          domain: task.domain,
          scope: task.scope === 'later' ? 'later' as const : 'current' as const,
          releaseIds: task.releaseIds?.length
            ? [...task.releaseIds]
            : releaseIdsByTitle.get(task.title.trim().toLowerCase()),
          refs: task.references?.map(ref => `import:${ref}`) ?? ['workspace-import:approved'],
        }))
        const detectedOrientationTasks = detectedOnlyTasks.map((task, index) => ({
          id: `detected-${draftTaskId(task, index)}`,
          title: task.title,
          description: task.description,
          domain: task.domain,
          scope: task.scope === 'later' ? 'later' as const : 'current' as const,
          releaseIds: task.releaseIds ? [...task.releaseIds] : undefined,
          refs: draftTaskRefs(task),
        }))
        return {
          releases: (detectedReleaseDraft?.releases ?? []).map(release => ({
            id: release.id,
            label: release.label,
            source: release.source === 'release_plan' || release.source === 'spec' || release.source === 'owner_approved'
              ? release.source
              : 'release_plan' as const,
            state: 'active' as const,
          })),
          tasks: [...savedOrientationTasks, ...detectedOrientationTasks],
          contexts: savedWorkspaceGoals.context
            .filter(context => context.role === 'capability' || context.role === 'brief_input')
            .map((context, index) => ({
              id: `approved-context-${index + 1}`,
              title: context.label,
              description: context.excerpt,
              domain: context.domain,
              refs: context.references?.map(ref => `import:${ref}`) ?? [`import:${context.source}`],
              role: context.role,
              scopeHint: context.scopeHint,
              releaseIds: context.releaseIds ? [...context.releaseIds] : undefined,
              linkedTaskHints: context.linkedTaskHints ? [...context.linkedTaskHints] : undefined,
            })),
          source: {
            kind: 'inferred' as const,
            refs: ['workspace-import:approved'],
            confidence: 'high' as const,
            freshness: 'fresh' as const,
            inferred: false,
            refreshedAt: savedWorkspaceGoals.recordedAt,
          },
        }
      }

      const inventory = await detectWorkspaceSignals({ projectPath })
      const draft = formWorkspaceHypothesis(inventory)
      const structuralContexts = draft.context.filter(context => context.role === 'capability' || context.role === 'brief_input')
      if (draft.tasks.length === 0 && structuralContexts.length === 0) return null
      const inferredContextDomain = (context: typeof structuralContexts[number]): string | undefined => {
        if (context.domain?.trim()) return context.domain.trim()
        const refs = new Set((context.references ?? []).map(ref => ref.replaceAll('\\', '/')))
        const domainCounts = new Map<string, number>()
        for (const task of draft.tasks) {
          if (!task.domain?.trim()) continue
          const taskRefs = (task.references ?? []).map(ref => ref.replaceAll('\\', '/'))
          if (!taskRefs.some(ref => refs.has(ref))) continue
          domainCounts.set(task.domain, (domainCounts.get(task.domain) ?? 0) + 1)
        }
        const winner = [...domainCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0]
        if (winner) return winner
        const firstRef = context.references?.[0]?.replaceAll('\\', '/')
        const docsGroup = firstRef?.match(/(?:^|\/)docs\/([^/]+)\//)?.[1]
        if (docsGroup && docsGroup !== 'specs') return docsGroup
        return undefined
      }
      return {
        releases: (draft.releases ?? []).map(release => ({
          id: release.id,
          label: release.label,
          source: release.source === 'release_plan' || release.source === 'spec' || release.source === 'owner_approved'
            ? release.source
            : 'release_plan' as const,
          state: 'active' as const,
        })),
        tasks: draft.tasks.map((task, index) => ({
          id: draftTaskId(task, index),
          title: task.title,
          description: task.whyThisMayMatter ?? task.description,
          domain: task.domain,
          scope: task.scope,
          releaseIds: task.releaseIds ? [...task.releaseIds] : undefined,
          refs: draftTaskRefs(task),
        })),
        contexts: structuralContexts.map((context, index) => ({
          id: `capability-${index + 1}`,
          title: context.label,
          description: context.excerpt,
          domain: inferredContextDomain(context),
          refs: context.references?.map(ref => `import:${ref}`) ?? [`import:${context.source}`],
          role: context.role,
          scopeHint: context.scopeHint,
          releaseIds: context.releaseIds ? [...context.releaseIds] : undefined,
          linkedTaskHints: context.linkedTaskHints ? [...context.linkedTaskHints] : undefined,
        })),
        source: {
          kind: 'inferred' as const,
          refs: ['workspace-import:draft'],
          confidence: 'medium' as const,
          freshness: 'fresh' as const,
          inferred: true,
          refreshedAt: new Date().toISOString(),
        },
      }
    } catch {
      return null
    }
  }

  async function startBlockerForTaskReadiness(projectPath: string): Promise<{
    canStart: false
    code: 'no_unattended_progress'
    message: string
    actionHref: string
    focusTaskId?: string
    focusTaskTitle?: string
    focusKind?: string
    count?: number
  } | null> {
    const tasksPath = projectTasksPath(projectPath)
    if (!existsSync(tasksPath)) return null
    const queue = await readTaskQueueFileNormalized(tasksPath)
    const typedQueue = {
      tasks: queue.tasks as Task[],
      releases: queue.releases,
      ...(queue.selectedReleaseId ? { selectedReleaseId: queue.selectedReleaseId } : {}),
    }
    const selectedReleaseScope = selectedReleaseScopeFromQueueLike(typedQueue)
    const tasksById = new Map(typedQueue.tasks.map(task => [task.id, task]))
    if (selectedReleaseScope) {
      const projection = buildProjectScopeProjection(typedQueue, {
        selectedScope: selectedReleaseScope as ProjectScope,
      })
      if (projection.rows.some(row => row.scope === 'included' && row.status === 'import_draft')) return null
      if (projection.start.code === 'no_unattended_progress') {
        return {
          canStart: false,
          code: 'no_unattended_progress',
          message: projection.start.message,
          actionHref: projection.start.actionHref,
          ...(projection.start.focusTaskId ? { focusTaskId: projection.start.focusTaskId } : {}),
          ...(projection.start.focusTaskTitle ? { focusTaskTitle: projection.start.focusTaskTitle } : {}),
          ...(projection.start.focusKind ? { focusKind: projection.start.focusKind } : {}),
          ...(typeof projection.start.count === 'number' ? { count: projection.start.count } : {}),
        }
      }
    }
    const tasks = tasksEligibleForScopeExecution(typedQueue.tasks, selectedReleaseScope)
    if (tasks.length === 0) return null

    let runnable = 0
    let needsBriefCleanup = 0
    let firstBriefCleanupTaskId: string | null = null
    let firstBriefCleanupTaskTitle: string | null = null
    let waitingForApproval = 0
    let firstWaitingSpecTaskId: string | null = null
    let firstWaitingSpecTaskTitle: string | null = null
    let terminal = 0
    for (const task of tasks) {
      if (!task || typeof task !== 'object') continue
      const status = String((task as { status?: unknown }).status ?? '')
      if (['done', 'blocked', 'shelved', 'pending_pr', 'archived', 'cancelled'].includes(status)) {
        terminal += 1
        continue
      }
      if (status === 'spec_review') {
        const id = (task as { id?: unknown }).id
        const taskId = typeof id === 'string' && id.trim() ? id.trim() : null
        const title = typeof (task as { title?: unknown }).title === 'string' && (task as { title: string }).title.trim()
          ? (task as { title: string }).title.trim()
          : null
        const hasSpecDraft = typeof (task as { spec?: unknown }).spec === 'string' && (task as { spec: string }).spec.trim().length > 0
        if (taskId && (selectedReleaseScope || hasSpecDraft || specReviewRequiresOwnerApproval({ id: taskId }))) {
          waitingForApproval += 1
          if (!firstWaitingSpecTaskId) {
            firstWaitingSpecTaskId = taskId
            firstWaitingSpecTaskTitle = title
          }
          continue
        }
        runnable += 1
        continue
      }
      if (status === 'ready' && !isReadyForWorkerHandoffRecord(task)) {
        needsBriefCleanup += 1
        if (!firstBriefCleanupTaskId) {
          const id = (task as { id?: unknown }).id
          firstBriefCleanupTaskId = typeof id === 'string' && id.trim() ? id.trim() : null
          firstBriefCleanupTaskTitle =
            typeof (task as { title?: unknown }).title === 'string' && (task as { title: string }).title.trim()
              ? (task as { title: string }).title.trim()
              : null
        }
        continue
      }
      if (['proposed', 'exploring', 'ready', 'in_progress', 'review', 'gate_check'].includes(status)) {
        runnable += 1
      }
    }

    if (selectedReleaseScope && waitingForApproval > 0) {
      const focusTitle = firstWaitingSpecTaskTitle ?? 'the first spec'
      return {
        canStart: false,
        code: 'no_unattended_progress',
        message:
          waitingForApproval === 1
            ? `"${focusTitle}" is waiting for review before work can start.`
            : `${waitingForApproval} specs are waiting for review before work can start. Start with "${focusTitle}".`,
        actionHref: firstWaitingSpecTaskId
          ? `/thread?thread=${encodeURIComponent(`task:${firstWaitingSpecTaskId}`)}`
          : '/thread',
        focusTaskId: firstWaitingSpecTaskId ?? undefined,
        focusTaskTitle: firstWaitingSpecTaskTitle ?? undefined,
        focusKind: 'spec_review',
        count: waitingForApproval,
      }
    }
    if (runnable > 0 || terminal === tasks.length) return null
    if (needsBriefCleanup > 0) {
      const focusTitle = firstBriefCleanupTaskTitle ?? 'the first task'
      return {
        canStart: false,
        code: 'no_unattended_progress',
        message:
          needsBriefCleanup === 1
            ? `"${focusTitle}" needs a clearer brief before unattended work can run.`
            : `${needsBriefCleanup} tasks still need fuller briefs before unattended work can run. Start with "${focusTitle}".`,
        actionHref: firstBriefCleanupTaskId ? `/work?task=${encodeURIComponent(firstBriefCleanupTaskId)}` : '/work',
        focusTaskId: firstBriefCleanupTaskId ?? undefined,
        focusTaskTitle: firstBriefCleanupTaskTitle ?? undefined,
        focusKind: 'brief_cleanup',
        count: needsBriefCleanup,
      }
    }
    if (waitingForApproval > 0) {
      const focusTitle = firstWaitingSpecTaskTitle ?? 'the first spec'
      return {
        canStart: false,
        code: 'no_unattended_progress',
        message:
          waitingForApproval === 1
            ? `"${focusTitle}" is waiting for review before work can start.`
            : `${waitingForApproval} specs are waiting for review before work can start. Start with "${focusTitle}".`,
        actionHref: firstWaitingSpecTaskId
          ? `/thread?thread=${encodeURIComponent(`task:${firstWaitingSpecTaskId}`)}`
          : '/thread',
        focusTaskId: firstWaitingSpecTaskId ?? undefined,
        focusTaskTitle: firstWaitingSpecTaskTitle ?? undefined,
        focusKind: 'spec_review',
        count: waitingForApproval,
      }
    }
    return null
  }

  async function startBlockerForSelectedReleaseReview(
    projectPath: string,
    resolvedConfig: ReturnType<typeof resolveConfig>,
  ): Promise<{
    canStart: false
    code: 'no_unattended_progress'
    message: string
    actionHref: string
    focusTaskId?: string
    focusTaskTitle?: string
    focusKind?: string
    count?: number
  } | null> {
    const tasksPath = projectTasksPath(projectPath)
    if (!existsSync(tasksPath)) return null
    const rawQueue = await readTaskQueueFileNormalized(tasksPath)
    if (rawQueue.tasks.length === 0) return null
    const tasks = await Promise.all(rawQueue.tasks.map(task => buildEffectiveTask(projectPath, task as Task)))
    const { releaseTruth } = buildOrientationSpineWithScopedReleaseTruth({
      projectId: resolvedConfig.id ?? basename(projectPath),
      charter: inferProjectCharterFromExistingSources(projectPath, resolvedConfig),
      selectedReleaseId: rawQueue.selectedReleaseId,
      releases: rawQueue.releases,
      tasks: tasks as Task[],
      workspaceImportDraft: await workspaceImportDraftForOrientation(projectPath, null),
      sourceRefs: projectOrientationSourceRefs(projectPath),
    })
    if (releaseTruth.unapprovedSpecs.length === 0) return null

    const first = releaseTruth.unapprovedSpecs[0]
    const focusTitle = first?.title ?? 'the first spec'
    return {
      canStart: false,
      code: 'no_unattended_progress',
      message:
        releaseTruth.unapprovedSpecs.length === 1
          ? `"${focusTitle}" is waiting for review before work can start.`
          : `${releaseTruth.unapprovedSpecs.length} specs are waiting for review before work can start. Start with "${focusTitle}".`,
      actionHref: first?.id
        ? `/thread?thread=${encodeURIComponent(`task:${first.id}`)}`
        : '/thread',
      focusTaskId: first?.id,
      focusTaskTitle: first?.title,
      focusKind: 'spec_review',
      count: releaseTruth.unapprovedSpecs.length,
    }
  }

  function startBlockerForOwnerInput(projectPath: string): {
    canStart: false
    code: 'owner_input_required'
    message: string
    actionHref: string
  } | null {
    const waiting = listOwnerInputRequestsSync(projectPath)
      .filter(request => request.status === 'waiting_for_owner')
    if (waiting.length === 0) return null
    const first = waiting[0]!
    return {
      canStart: false,
      code: 'owner_input_required',
      message:
        waiting.length === 1
          ? `${ownerInputObjectiveLabel(first.objective.label)} needs your answer before work can continue`
          : `${waiting.length} owner decisions need your answer before work can continue`,
      actionHref: ownerInputActionHref(first),
    }
  }

  function ownerInputObjectiveLabel(label: string): string {
    const trimmed = label.trim()
    if (/^review structural map\b/i.test(trimmed)) return 'Review the project map'
    return trimmed || 'This decision'
  }

  function ownerInputActionHref(request: ReturnType<typeof listOwnerInputRequestsSync>[number]): string {
    return `/thread?thread=${encodeURIComponent(request.boundedChatSessionId)}`
  }

  async function submitLinkedTaskOwnerInput(input: {
    taskId: string
    questionId: string
    answer: string
  }): Promise<void> {
    const request = await findOwnerInputRequestBySource(project.path, {
      kind: 'task',
      taskId: input.taskId,
      questionId: input.questionId,
    })
    if (request?.status !== 'waiting_for_owner') return
    const stateDir = getProjectStateDir(project.path)
    await submitBoundedChatUserResponse({
      memoryDir: stateDir,
      sessionId: request.boundedChatSessionId,
      subObjectiveId: input.questionId,
      response: input.answer,
    })
    await markOwnerInputRequestForBoundedChatReview({
      projectRoot: project.path,
      boundedChatSessionId: request.boundedChatSessionId,
    })
  }

  app.post('/api/project/task/:id/start', async c => {
    try {
      const taskId = c.req.param('id')
      const tasksPath = projectTasksPath(project.path)
      const tasks = await readTasksFileNormalized(tasksPath).catch(() => [])
      if (!tasks.some(task => task.id === taskId)) {
        return c.json({ error: 'task not found' }, 404)
      }
      const url = new URL(c.req.url)
      url.pathname = '/api/project/start'
      const res = await app.fetch(
        new Request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'one_task', taskId, scope: 'work_item' }),
        }),
        c.env,
      )
      if (!res.ok) return res
      const body = await res.json().catch(() => ({})) as Record<string, unknown>
      return c.json({
        ...body,
        scope: { type: 'work_item', taskId },
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/start', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as {
        mode?: string
        stopAfterOneTask?: boolean
        taskId?: string
      }
      const existingRun = supervisor.get(project.id)
      if (body.taskId && existingRun?.status === 'stopping') {
        await supervisor.forceStopStaleStoppingRun(project.id, 3_000)
      }
      const activeRun = supervisor.get(project.id)
      if (body.taskId && activeRun && (activeRun.status === 'running' || activeRun.status === 'stopping')) {
        return c.json(
          {
            error: activeRun.status === 'running'
              ? 'A run is already active for this project. This task remains queued; stop the current run first if you need to restart on this exact task.'
              : 'The run is stopping. Wait for it to stop before starting this specific task.',
            code: 'run_already_active',
            status: activeRun.status,
          },
          409,
        )
      }
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      if (body.taskId) {
        const queueTasks = await readTasksFileNormalized(projectTasksPath(project.path)).catch(() => [])
        const scopedTask = queueTasks.find(task => task.id === body.taskId)
        if (scopedTask?.status === 'spec_review' && typeof scopedTask.spec === 'string' && scopedTask.spec.trim().length > 0) {
          return c.json(
            {
              error: 'This spec is waiting for review before work can start.',
              code: 'no_unattended_progress',
              actionHref: `/thread?thread=${encodeURIComponent(`task:${body.taskId}`)}`,
            },
            400,
          )
        }
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
      const startReadiness = await projectStartReadiness({
        projectPath: project.path,
        resolvedConfig,
        runtimeProvider,
        allowPaidProviderFallback: runtimeProvider.allowPaidProviderFallback,
        allowTaskReadinessBlocker: !body.taskId,
        ...(body.taskId ? { requestedTaskId: body.taskId } : {}),
      })
      if (!startReadiness.canStart) {
        if (startReadiness.code === 'all_terminal') {
	          const terminal = await terminalStartState(project.path, body.taskId)
          if (terminal) {
            return c.json({
              status: 'stopped',
              mode: 'continuous',
              code: terminal.code,
              stopSummary: terminal.stopSummary,
            })
          }
        } else {
          return c.json(
            {
              error: startReadiness.message ?? 'One thing needs to be resolved before work can start.',
              code: startReadiness.code,
              actionHref: startReadiness.actionHref,
              loadedModels: startReadiness.loadedModels,
              missingModels: startReadiness.missingModels,
            },
            blockedStartStatus(startReadiness.code),
          )
        }
      }
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
                  'The configured local server is reachable, but no loaded model was visible. To avoid surprise memory pressure from JIT loading, load the model you want on that server, then start again.',
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
            'Preferred local server had no loaded model available, so the run switched to a paid fallback provider.'
          routingDecisions.push({
            code: 'preferred_provider_missing_loaded_model',
            severity: 'info',
            basis: 'availability',
            message:
              'The preferred local server had no loaded model available, so this run selected a fallback provider.',
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
                    'Missing models are not JIT-loaded automatically; load the configured model on that server or choose a loaded model in Providers.',
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
              'Preferred local server did not have the configured models loaded, so the run switched to a paid fallback provider.'
            routingDecisions.push({
              code: 'preferred_provider_missing_assigned_models',
              severity: 'info',
              basis: 'compatibility',
              message:
                'The preferred local server did not have this project’s assigned models loaded, so this run selected a fallback provider.',
            })
          }
        }
      }
      if (!assignmentMatchesProvider(effectiveProvider, effectiveModels)) {
        effectiveModels = defaultAssignmentForProvider(effectiveProvider) ?? effectiveModels
        if (effectiveProvider !== 'llama-cpp') {
          fallbackReason ??=
            `This run swapped to models that ${effectiveProvider} can actually serve.`
          routingDecisions.push({
            code: 'model_assignment_swapped_for_provider_compatibility',
            severity: 'info',
            basis: 'compatibility',
            message:
              `This run swapped to models that ${providerLabelForAnyKey(effectiveProvider)} can actually serve.`,
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
      await resumeProjectAvailability(project.path)
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
      await pauseProjectAvailability(project.path, { reason: 'user_paused_project' })
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
        return c.json({ error: 'Repo structure has not been inferred here yet - run repo inspection first' }, 400)
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
        return c.json({ error: 'Repo structure has not been inferred here yet - run repo inspection first' }, 400)
      }
      const routed = routeRequest({
        raw: body.ask,
        source: 'api',
        routeContext: { route: '/api/project/request' },
      })
      const firstAction = routed.actions[0]
      if (firstAction?.kind === 'pressure_test_intake') {
        const result = await createRoutedRequest({
          memoryDir: getProjectStateDir(project.path),
          ask: body.ask,
          domain,
          projectPath: resolveTaskPathForDomain(project, domain),
          workspacePath: project.path,
          ...(body.title ? { title: body.title } : {}),
        })
        return c.json(result)
      }
      if (firstAction) {
        const boundedChat = await createNewRequestBoundedChat({
          memoryDir: getProjectStateDir(project.path),
          projectId: project.id,
          ask: body.ask,
          domain,
          projectPath: resolveTaskPathForDomain(project, domain),
          workspacePath: project.path,
          ...(body.title ? { title: body.title } : {}),
          routedRequestKind: firstAction.kind,
          routingSummary: newRequestRoutingSummary(firstAction.kind),
        })
        return c.json({ boundedChat })
      }
      const result = await createRoutedRequest({
        memoryDir: getProjectStateDir(project.path),
        ask: body.ask,
        domain,
        projectPath: resolveTaskPathForDomain(project, domain),
        workspacePath: project.path,
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
      const existingChats = listBoundedChatSessions(memoryDir)
        .filter(session => session.objective.kind === 'project_check_in' || session.objective.kind === 'project_intake')
      const activeChat = existingChats.find(session => session.status === 'waiting_for_owner' || session.status === 'coordinator_review')
      if (activeChat) {
        const boundedChat = await resumeProjectCheckInBoundedChat({
          memoryDir,
          projectId: project.id,
          projectName: project.config?.name ?? project.id,
        })
        return c.json({ boundedChat, existing: true })
      }
      const existing = listPressureTestIntakes(memoryDir)
      const active = existing.find(intake => intake.status === 'active')
      if (active) return c.json({ intake: active, existing: true })
      if (existingChats.length > 0 || existing.length > 0) {
        return c.json({
          skipped: true,
          projectCheckIn: summarizeProjectCheckIn(memoryDir),
        })
      }
      const boundedChat = await createProjectCheckInBoundedChat({
        memoryDir,
        projectId: project.id,
        projectName: project.config?.name ?? project.id,
      })
      return c.json({ boundedChat, projectCheckIn: summarizeProjectCheckIn(memoryDir) })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/bounded-chat/:id', async c => {
    try {
      const boundedChat = await loadBoundedChatSession({
        memoryDir: getProjectStateDir(project.path),
        sessionId: c.req.param('id'),
      })
      return c.json({ boundedChat })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/bounded-chat/:id/answer', async c => {
    try {
      const body = await c.req.json().catch(() => ({})) as {
        questionId?: string
        subObjectiveId?: string
        answer?: string
        response?: string
      }
      const subObjectiveId = body.subObjectiveId?.trim() || body.questionId?.trim()
      const response = body.response?.trim() || body.answer?.trim()
      if (!subObjectiveId || !response) {
        return c.json({ error: 'Sub-objective and response are required.' }, 400)
      }
      const session = await loadBoundedChatSession({
        memoryDir: getProjectStateDir(project.path),
        sessionId: c.req.param('id'),
      })
      if (session.objective.kind === 'project_check_in') {
        const boundedChat = await answerProjectCheckInBoundedChat({
          memoryDir: getProjectStateDir(project.path),
          sessionId: session.id,
          subObjectiveId,
          response,
        })
        return c.json({ boundedChat })
      }
      if (session.objective.kind === 'new_request') {
        const boundedChat = await answerNewRequestBoundedChat({
          memoryDir: getProjectStateDir(project.path),
          sessionId: session.id,
          subObjectiveId,
          response,
        })
        return c.json({ boundedChat })
      }
      const boundedChat = await submitBoundedChatUserResponse({
        memoryDir: getProjectStateDir(project.path),
        sessionId: session.id,
        subObjectiveId,
        response,
      })
      await markOwnerInputRequestForBoundedChatReview({
        projectRoot: project.path,
        boundedChatSessionId: session.id,
      })
      return c.json({ boundedChat })
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
        return c.json({ error: 'Repo structure has not been inferred here yet - run repo inspection first' }, 400)
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
  function quoteShellPath(pathname: string): string {
    return `'${pathname.replace(/'/g, `'\\''`)}'`
  }

  function workspaceChildBootstrap(projectPath: string): {
    commands: string[]
    successGates: string[]
    timeoutMs: number
    provenance: null
  } | null {
    const workspaceConfig = readWorkspaceConfig(projectPath)
    if (workspaceConfig.kind !== 'workspace') return null
    const children = resolveWorkspaceProjectPathsOrDiscover(projectPath, workspaceConfig)
      .filter(child => child.bootstrap && (
        child.bootstrap.commands.length > 0 ||
        child.bootstrap.successGates.length > 0
      ))
    if (children.length === 0) return null

    const prefix = (childPath: string, command: string) => {
      const childRelativePath = relative(projectPath, childPath) || '.'
      return childRelativePath === '.'
        ? command
        : `cd ${quoteShellPath(childRelativePath)} && ${command}`
    }

    return {
      commands: children.flatMap(child => child.bootstrap!.commands.map(command => prefix(child.path, command))),
      successGates: children.flatMap(child => child.bootstrap!.successGates.map(command => prefix(child.path, command))),
      timeoutMs: Math.max(...children.map(child => child.bootstrap!.timeoutMs)),
      provenance: null,
    }
  }

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
      const bootstrap = project.config?.bootstrap?.commands.length
        ? project.config.bootstrap
        : workspaceChildBootstrap(project.path)
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
      const childBootstrap = bootstrap?.commands.length
        ? null
        : workspaceChildBootstrap(project.path)

      // Legacy path: run the array-based commands from guildhall.yaml when
      // present. Fall through to detection-based bootstrap otherwise so
      // workspaces without a pre-authored bootstrap block still get the
      // environment verified (detect package manager, install, probe gates).
      if ((bootstrap && bootstrap.commands.length > 0) || childBootstrap) {
        const effectiveBootstrap = childBootstrap ?? bootstrap!
        const result = runBootstrap({
          projectPath: project.path,
          memoryDir,
          commands: effectiveBootstrap.commands,
          successGates: effectiveBootstrap.successGates,
          timeoutMs: effectiveBootstrap.timeoutMs,
        })
        const status = readBootstrapStatus(memoryDir)
        return c.json({
          success: result.success,
          status,
          ...(childBootstrap ? { workspaceBootstrap: childBootstrap } : {}),
        })
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

  async function renderCodebaseMapStatus(projectPath: string, opts: { createIfMissing?: boolean } = {}) {
    const memoryDir = getProjectStateDir(projectPath)
    let [map, stale] = await Promise.all([
      loadCodebaseMap(memoryDir),
      loadCodebaseMapStaleState(memoryDir),
    ])
    if (!map && opts.createIfMissing) {
      const result = await refreshCodebaseMap({
        projectRoot: projectPath,
        memoryDir,
        reason: 'setup',
      })
      map = result.map
      stale = await loadCodebaseMapStaleState(memoryDir)
    }
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
      return c.json(await renderCodebaseMapStatus(project.path, { createIfMissing: true }))
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
      const tasksPath = projectTasksPath(project.path)
      if (!existsSync(tasksPath)) {
        return c.json({ status: 'no-task', taskExists: false, specReady: false, drafts: [] })
      }
      const raw = await readManagedTextFile(tasksPath, 'utf-8')
      const parsed = JSON.parse(raw) as { tasks?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
      const tasks = Array.isArray(parsed) ? parsed : parsed.tasks ?? []
      const task = tasks.find(t => (t as { id?: string }).id === META_INTAKE_TASK_ID) as
        | { spec?: string; status?: string; blockReason?: string | null }
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
          blockReason: task.blockReason ?? null,
          drafts: [],
        })
      }
      const drafts = parseCoordinatorDraft(spec) ?? []
      return c.json({
        status: task.status === 'done' ? 'approved' : drafts.length > 0 ? 'draft-ready' : 'spec-but-no-fence',
        taskExists: true,
        specReady: drafts.length > 0,
        taskStatus: task.status ?? null,
        blockReason: task.blockReason ?? null,
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
      const importSummary = await readWorkspaceImportSummary({
        memoryDir,
        projectPath: project.path,
        detectedDraft: need.draft,
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

      return c.json({
        needed: need.needed,
        seeded: importSummary.taskStatus !== null,
        taskStatus: importSummary.taskStatus,
        specPresent: importSummary.specPresent,
        leverPosition,
        draft: {
          goals: importSummary.approved?.goalCount ?? need.draft.goals.length,
          tasks: importSummary.approved?.taskCount ?? need.draft.tasks.length,
          milestones: importSummary.approved?.milestoneCount ?? need.draft.milestones.length,
        },
        approved: importSummary.approved,
        detected: importSummary.detected,
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

  app.get('/api/project/reintake/status', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ draftExists: false, status: null, summary: null })
      }
      const draft = await readProjectReintakeDraft(getProjectStateDir(project.path))
      return c.json({
        draftExists: Boolean(draft),
        status: draft?.status ?? null,
        createdAt: draft?.createdAt ?? null,
        summary: draft?.summary ?? null,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/reintake/rerun', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const memoryDir = getProjectStateDir(project.path)
      const tasks = await readTasksFileNormalized(projectTasksPath(project.path)).catch(() => [])
      const sources = await collectProjectReintakeSources(project.path)
      const draft = planProjectReintake({ sources, tasks })
      await writeProjectReintakeDraft(memoryDir, draft)
      return c.json({ ok: true, draft })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/reintake/draft', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const draft = await readProjectReintakeDraft(getProjectStateDir(project.path))
      if (!draft) return c.json({ error: 'No re-intake draft found.' }, 404)
      return c.json(draft)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/reintake/apply', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const body = await c.req.json().catch(() => ({})) as { groupIds?: string[] }
      const tasksPath = projectTasksPath(project.path)
      const result = await applyProjectReintakeDraft({
        memoryDir: getProjectStateDir(project.path),
        selectedGroupIds: Array.isArray(body.groupIds) ? body.groupIds : undefined,
      })
      if (result.success) invalidateTaskQueueReadCaches(tasksPath)
      return c.json(result, result.success ? 200 : 400)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/reintake/dismiss', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ error: 'Project not initialized. Complete /setup first.' }, 400)
      }
      const memoryDir = getProjectStateDir(project.path)
      const draft = await readProjectReintakeDraft(memoryDir)
      if (!draft) return c.json({ ok: true, dismissed: false })
      await writeProjectReintakeDraft(memoryDir, { ...draft, status: 'dismissed' })
      return c.json({ ok: true, dismissed: true })
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
      const savedWorkspaceGoals = await readWorkspaceGoalsState(memoryDir)
      // Dismissed state — surface it so the UI can show an "undo" affordance
      // instead of re-running the scan silently.
      let dismissed = false
      try {
        const goalsPath = getProjectSystemStatePath(project.path, 'workspace-goals.json')
        if (existsSync(goalsPath)) {
          const g = JSON.parse(await readManagedTextFile(goalsPath, 'utf-8')) as {
            dismissed?: boolean
          }
          dismissed = Boolean(g.dismissed)
        }
      } catch {
        /* treat as not-dismissed */
      }

      let existingTasks: Array<{ title: string; status: string }> = []
      const tasksPath = projectTasksPath(project.path)
      let liveDetectedWorkspaceScope:
        | {
            goalCount: number
            taskCount: number
            milestoneCount: number
            currentTaskCount: number
            laterTaskCount: number
          }
        | null = null
      if (existsSync(tasksPath)) {
        try {
          const raw = JSON.parse(await readManagedTextFile(tasksPath, 'utf-8')) as
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
        releases?: unknown[]
        tasks: unknown[]
        milestones: unknown[]
        context: unknown[]
        stats: { inputSignals: number; drafted: number; deduped: number }
        review?: unknown
        learning?: unknown
      } | null = null
      try {
        const inventory = await detectWorkspaceSignals({ projectPath: project.path })
        const draft = await materializeWorkspaceImportDraft({
          memoryDir,
          projectPath: project.path,
          draft: formWorkspaceHypothesis(inventory),
        })
        const review = buildWorkspaceImportReview(draft, existingTasks, projectPath)
        detected = {
          goals: [...draft.goals],
          ...(draft.releases?.length ? { releases: [...draft.releases] } : {}),
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
      const detectedDraft = detected
        ? {
            goals: detected.goals,
            ...(detected.releases?.length ? { releases: detected.releases } : {}),
            tasks: detected.tasks,
            milestones: detected.milestones,
            context: detected.context,
            stats: detected.stats,
          }
        : null
      if (!existsSync(tasksPath)) {
        return c.json({
          taskExists: false,
          specReady: false,
          parsed: null,
          effective: detectedDraft,
          detected,
          dismissed,
          anchors,
        })
      }
      const raw = JSON.parse(await readManagedTextFile(tasksPath, 'utf-8')) as
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
          effective: detectedDraft,
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
          effective: detectedDraft,
          detected,
          dismissed,
          anchors,
        })
      }
      const trustSavedWorkspaceGoals = savedWorkspaceGoals &&
        !workspaceGoalsNeedStructuralRefresh(savedWorkspaceGoals) &&
        (
          savedWorkspaceGoals.goals.length > 0 ||
          savedWorkspaceGoals.tasks.length > 0 ||
          savedWorkspaceGoals.milestones.length > 0 ||
          savedWorkspaceGoals.context.length > 0
        )
      const parsed = trustSavedWorkspaceGoals
        ? {
            goals: [...savedWorkspaceGoals.goals],
            tasks: [...savedWorkspaceGoals.tasks],
            milestones: [...savedWorkspaceGoals.milestones],
            context: [...savedWorkspaceGoals.context],
          }
        : await materializeParsedWorkspaceImport({
            memoryDir,
            projectPath: project.path,
            parsed: parseWorkspaceImport(spec),
          })
      const specReady =
        parsed.goals.length + parsed.tasks.length + parsed.milestones.length > 0
      const effective = detectedDraft ? mergeWorkspaceImportDraft(detectedDraft, parsed, {
        preserveDetectedScope: true,
      }) : null
      return c.json({
        taskExists: true,
        specReady,
        taskStatus: task.status ?? null,
        parsed,
        effective,
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
      let importerTaskSpec: string | null = null

      // Approval always needs the reserved task so the merge can mark the
      // import complete in one place, but the detector draft itself is a
      // first-class input. We never synthesize a fake importer spec here.
      try {
        const tasksPath = workspaceImportTasksPath(memoryDir)
        let raw = existsSync(tasksPath)
          ? (JSON.parse(await readManagedTextFile(tasksPath, 'utf-8')) as
              | Array<Record<string, unknown>>
              | { tasks?: Array<Record<string, unknown>> })
          : { tasks: [] as Array<Record<string, unknown>> }
        let list = Array.isArray(raw) ? raw : raw.tasks ?? []
        let idx = list.findIndex(
          (t) => (t as { id?: string }).id === WORKSPACE_IMPORT_TASK_ID,
        )
        if (idx < 0) {
          await createWorkspaceImportTask({
            memoryDir,
            projectPath: project.path,
          })
          raw = JSON.parse(await readManagedTextFile(tasksPath, 'utf-8')) as
            | Array<Record<string, unknown>>
            | { tasks?: Array<Record<string, unknown>> }
          list = Array.isArray(raw) ? raw : raw.tasks ?? []
          idx = list.findIndex(
            (t) => (t as { id?: string }).id === WORKSPACE_IMPORT_TASK_ID,
          )
        }
        if (idx >= 0) {
          const task = list[idx] as { spec?: string }
          if (typeof task?.spec === 'string' && task.spec.trim().length > 0) {
            importerTaskSpec = task.spec
          }
        }
      } catch (e) {
        return c.json(
          { error: `Could not prepare workspace-import task: ${e instanceof Error ? e.message : String(e)}` },
          500,
        )
      }

      const inventory = await detectWorkspaceSignals({ projectPath: project.path })
      const fullDraft = await materializeWorkspaceImportDraft({
        memoryDir,
        projectPath: project.path,
        draft: formWorkspaceHypothesis(inventory),
      })
      const review = buildWorkspaceImportReview(fullDraft, [], project.path)
      const defaultSourceKeys = review.sourceGroups.map(group => group.key)
      const defaultAreaKeys = review.areaGroups.map(area => area.key)
      const defaultTaskIds = fullDraft.tasks.map(task => task.suggestedId)
      const selectedSourceKeys = Array.isArray(body.sourceKeys)
        ? body.sourceKeys
        : defaultSourceKeys
      const selectedAreaKeys = Array.isArray(body.areaKeys)
        ? body.areaKeys
        : defaultAreaKeys
      const selectedTaskIds = Array.isArray(body.taskIds)
        ? body.taskIds
        : defaultTaskIds
      const hasExplicitSelectionEnvelope =
        Array.isArray(body.taskIds) ||
        Array.isArray(body.sourceKeys) ||
        Array.isArray(body.areaKeys)
      const hasExplicitNarrowing =
        selectedTaskIds.length !== defaultTaskIds.length ||
        selectedSourceKeys.length !== defaultSourceKeys.length ||
        selectedAreaKeys.length !== defaultAreaKeys.length ||
        selectedTaskIds.some(taskId => !defaultTaskIds.includes(taskId)) ||
        selectedSourceKeys.some(sourceKey => !defaultSourceKeys.includes(sourceKey)) ||
        selectedAreaKeys.some(areaKey => !defaultAreaKeys.includes(areaKey))
      const filteredDraft = filterWorkspaceImportDraft(fullDraft, {
        sourceKeys: selectedSourceKeys,
        taskIds: selectedTaskIds,
      })
      let parsedSavedImporterSpec: ReturnType<typeof parseWorkspaceImport> | null = null
      if (!hasExplicitNarrowing && !hasExplicitSelectionEnvelope && importerTaskSpec) {
        try {
          const yamlErrors = workspaceImportYamlErrors(importerTaskSpec)
          if (yamlErrors.length > 0) {
            return c.json({ error: `Invalid workspace-import YAML: ${yamlErrors.join('; ')}` }, 400)
          }
          parsedSavedImporterSpec = parseWorkspaceImport(importerTaskSpec)
        } catch {
          parsedSavedImporterSpec = null
        }
      }
      const effectiveDraft =
        !hasExplicitNarrowing && !hasExplicitSelectionEnvelope && parsedSavedImporterSpec
          ? mergeWorkspaceImportDraft(filteredDraft, parsedSavedImporterSpec, {
              retainParsedOnlyTasks: false,
              preserveDetectedScope: true,
            })
          : filteredDraft

      const result = await approveWorkspaceImport({
        memoryDir,
        projectPath: project.path,
        coordinatorProjectPaths: buildCoordinatorProjectPathMap(
          project.path,
          project.config?.coordinators ?? [],
          project.config?.projects ?? [],
        ),
        draftOverride: effectiveDraft,
        detectedDraftSnapshot: fullDraft,
        replacePreviouslyImportedTasks: !hasExplicitNarrowing,
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

      // Workspace import summary: approved reviewed slice plus broader detected scope.
      const detectedNeed = await workspaceNeedsImport({
        memoryDir,
        projectPath: project.path,
      }).catch(() => null)
      const workspaceGoalsState = await readWorkspaceGoalsState(memoryDir)
      const importSummary = await readWorkspaceImportSummary({
        memoryDir,
        projectPath: project.path,
        ...(detectedNeed ? { detectedDraft: detectedNeed.draft } : {}),
      })
      let workspaceGoals:
        | {
            imported: boolean
            dismissed: boolean
            goalCount: number
            taskCount: number
            milestoneCount: number
            approved: {
              goalCount: number
              taskCount: number
              milestoneCount: number
              currentTaskCount: number
              laterTaskCount: number
            } | null
            detected: {
              goalCount: number
              taskCount: number
              milestoneCount: number
              currentTaskCount: number
              laterTaskCount: number
            } | null
          }
        | null = null
      if (workspaceGoalsState?.dismissed) {
        workspaceGoals = {
          imported: false,
          dismissed: true,
          goalCount: 0,
          taskCount: 0,
          milestoneCount: 0,
          approved: null,
          detected: null,
        }
      } else if (workspaceGoalsState) {
        const approvedGoalsForFacts =
          importSummary.approved && (
            importSummary.approved.taskCount > 0 ||
            workspaceGoalsState.approved.taskCount === 0
          )
            ? importSummary.approved
            : workspaceGoalsState.approved
        workspaceGoals = {
          imported: true,
          dismissed: false,
          goalCount: approvedGoalsForFacts.goalCount,
          taskCount: approvedGoalsForFacts.taskCount,
          milestoneCount: approvedGoalsForFacts.milestoneCount,
          approved: approvedGoalsForFacts
            ? {
                goalCount: approvedGoalsForFacts.goalCount,
                taskCount: approvedGoalsForFacts.taskCount,
                milestoneCount: approvedGoalsForFacts.milestoneCount,
                currentTaskCount: approvedGoalsForFacts.currentTaskCount,
                laterTaskCount: approvedGoalsForFacts.laterTaskCount,
              }
            : null,
          detected: importSummary.detected
            ? {
                goalCount: importSummary.detected.goalCount,
                taskCount: importSummary.detected.taskCount,
                milestoneCount: importSummary.detected.milestoneCount,
                currentTaskCount: importSummary.detected.currentTaskCount,
                laterTaskCount: importSummary.detected.laterTaskCount,
              }
            : null,
        }
      } else if (importSummary.approved || importSummary.detected || importSummary.taskStatus !== null) {
        workspaceGoals = {
          imported: true,
          dismissed: false,
          goalCount: importSummary.approved?.goalCount ?? 0,
          taskCount: importSummary.approved?.taskCount ?? 0,
          milestoneCount: importSummary.approved?.milestoneCount ?? 0,
          approved: importSummary.approved
            ? {
                goalCount: importSummary.approved.goalCount,
                taskCount: importSummary.approved.taskCount,
                milestoneCount: importSummary.approved.milestoneCount,
                currentTaskCount: importSummary.approved.currentTaskCount,
                laterTaskCount: importSummary.approved.laterTaskCount,
              }
            : null,
          detected: importSummary.detected
            ? {
                goalCount: importSummary.detected.goalCount,
                taskCount: importSummary.detected.taskCount,
                milestoneCount: importSummary.detected.milestoneCount,
                currentTaskCount: importSummary.detected.currentTaskCount,
                laterTaskCount: importSummary.detected.laterTaskCount,
              }
            : null,
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
      const goalsPath = getProjectSystemStatePath(project.path, 'workspace-goals.json')
      await fsp.mkdir(dirname(goalsPath), { recursive: true })
      await writeManagedTextFile(
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
      const raw = await readManagedTextFile(filePath, 'utf-8')
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

  async function buildProjectContextSummary(projectPath: string, memoryDir: string): Promise<{
    projectBrief: { present: boolean; nonEmptyLines: number }
    projectNotes: { present: boolean; nonEmptyLines: number }
    decisions: { present: boolean; nonEmptyLines: number }
    workspaceGoals: { present: boolean; goalCount: number }
  }> {
    const [projectBrief, projectNotes, decisions] = await Promise.all([
      fileSummary(projectBriefPath(projectPath)),
      fileSummary(join(memoryDir, 'MEMORY.md')),
      fileSummary(join(memoryDir, 'DECISIONS.md')),
    ])
    let workspaceGoals = { present: false, goalCount: 0 }
    const goalsPath = getProjectSystemStatePath(projectPath, 'workspace-goals.json')
    if (existsSync(goalsPath)) {
      try {
        const raw = JSON.parse(await readManagedTextFile(goalsPath, 'utf-8')) as { goals?: unknown[] }
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
      const draft = await materializeWorkspaceImportDraft({
        memoryDir,
        projectPath: project.path,
        draft: formWorkspaceHypothesis(inventory),
      })
      const tasksPath = projectTasksPath(project.path)
      let existingTasks: Array<{ title: string; status: string }> = []
      if (existsSync(tasksPath)) {
        try {
          const raw = JSON.parse(await readManagedTextFile(tasksPath, 'utf-8')) as
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
        projectContext: await buildProjectContextSummary(project.path, memoryDir),
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
      const timing: Array<{ name: string; startedAt: number; endedAt?: number }> = [{ name: 'thread-core', startedAt: Date.now() }]
      try {
        repairStaleBlockersForProject(project.path)
      } catch {
        /* never let stale-blocker repair break a thread read */
      }
      const state = await loadThreadProjectionState(project.path)
      const releaseQueue = await readTaskQueueFileNormalized(projectTasksPath(project.path)).catch(
        (): { tasks: Array<Record<string, unknown>>; releases: ProjectRelease[]; selectedReleaseId?: string } => ({ tasks: [], releases: [] }),
      )
      const thread = buildThread({
        projectPath: project.path,
        snapshot: state.snapshot,
        tasks: state.tasks as never,
        boundedChatSessions: state.boundedChatSessions,
        pressureTestIntakes: state.pressureTestIntakes,
        projectCheckInSummary: state.projectCheckInSummary,
        runStatus: supervisor.get(project.id)?.status ?? 'stopped',
        recentEvents: supervisor.recent(project.id, undefined, project.path),
      })
      const threadStartReadiness = await projectStartReadinessForProject(project.path)
      const { orientationSpine } = buildOrientationSpineWithScopedReleaseTruth({
        projectId: project.id,
        charter: inferProjectCharterFromExistingSources(project.path, project.config),
        selectedReleaseId: releaseQueue.selectedReleaseId,
        releases: releaseQueue.releases,
        tasks: state.tasks as Task[],
        runStatus: supervisor.get(project.id)?.status ?? 'stopped',
        startReadiness: threadStartReadiness,
        workspaceImportDraft: await workspaceImportDraftForOrientation(project.path, threadStartReadiness),
        sourceRefs: projectOrientationSourceRefs(project.path),
      })
      timing[0]!.endedAt = Date.now()
      c.header('server-timing', formatServerTiming(timing))
      return c.json({ ...thread, orientationSpine })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/thread/extras', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ taskGitStories: {} })
      }
      const timing: Array<{ name: string; startedAt: number; endedAt?: number }> = [{ name: 'thread-extras', startedAt: Date.now() }]
      const state = await loadThreadProjectionState(project.path)
      const thread = buildThread({
        projectPath: project.path,
        snapshot: state.snapshot,
        tasks: state.tasks as never,
        boundedChatSessions: state.boundedChatSessions,
        pressureTestIntakes: state.pressureTestIntakes,
        projectCheckInSummary: state.projectCheckInSummary,
        runStatus: supervisor.get(project.id)?.status ?? 'stopped',
        recentEvents: supervisor.recent(project.id, undefined, project.path),
      })
      const taskIds = new Set(
        thread.turns
          .map(turn => ('taskId' in turn ? turn.taskId : null))
          .filter((id): id is string => Boolean(id)),
      )
      const taskGitStories: Record<string, unknown> = {}
      if (taskIds.size > 0) {
        const workspaceStore = await readTaskWorkspaceStore(project.path).catch(() => undefined)
        for (const task of state.tasks) {
          const id = typeof task.id === 'string' ? task.id : ''
          if (!id || !taskIds.has(id) || !shouldAttachTaskGitStory(id)) continue
          const gitStory = await gitStoryForTask(project.path, task, workspaceStore?.workspaces[id]).catch(() => undefined)
          if (gitStory) taskGitStories[id] = gitStory
        }
      }
      timing[0]!.endedAt = Date.now()
      c.header('server-timing', formatServerTiming(timing))
      return c.json({ taskGitStories })
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
      const raw = await readManagedTextFile(candidate, 'utf8')
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
      const tasksPath = projectTasksPath(project.path)
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const raw = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as
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
      const briefPath = projectBriefPath(project.path)
      const current = existsSync(briefPath) ? readManagedTextFileSync(briefPath, 'utf8') : ''
      const readmePath = join(project.path, 'README.md')
      const roadmapPath = join(project.path, 'ROADMAP.md')
      const readmeFirstPara = existsSync(readmePath)
        ? (readManagedTextFileSync(readmePath, 'utf8').split(/\n{2,}/).find(p => p.trim() && !p.trim().startsWith('#')) ?? '').trim().slice(0, 800)
        : ''
      const roadmapHeadings = existsSync(roadmapPath)
        ? readManagedTextFileSync(roadmapPath, 'utf8')
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
      const briefPath = projectBriefPath(project.path)
      mkdirSync(dirname(briefPath), { recursive: true })
      writeManagedTextFileSync(briefPath, content + '\n')
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/git-story', async c => {
    try {
      if (project.initializationNeeded) return c.json({ initializationNeeded: true })
      const tasks = await readTasksFileNormalized(projectTasksPath(project.path)).catch(() => [])
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
      const tasksPath = projectTasksPath(project.path)
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const tasks = await readTasksFileNormalized(tasksPath)
      const workProgress = deriveProjectWorkProgress(tasks as Array<Record<string, unknown>>)
      const id = c.req.param('id')
      const task = tasks.find(t => (t as { id?: string }).id === id)
      if (!task) return c.json({ error: 'task not found' }, 404)
      const deliveryModel = await readProjectDeliveryModel(project.path)
      const deliveryRelationships = deriveTaskRelationships({
        model: deliveryModel,
        tasks: tasks as unknown as Task[],
        taskId: id,
      })
      const deliveryContextPacket = buildTaskContextPacket({
        model: deliveryModel,
        tasks: tasks as unknown as Task[],
        taskId: id,
      })
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
      const runStatus = supervisor.get(project.id)?.status ?? 'stopped'
      const availability = await readProjectAvailability(project.path)
      const relatedTaskIds = new Set<string>()
      const rawTask = task as Record<string, unknown>
      for (const primitive of [
        ...deliveryRelationships.primitiveUse.direct,
        ...deliveryRelationships.primitiveUse.ancestors,
      ]) {
        for (const provingTask of primitive.provingTasks) {
          if (typeof provingTask.id === 'string') relatedTaskIds.add(provingTask.id)
        }
      }
      const hierarchy = rawTask.hierarchy as { parentId?: unknown; childIds?: unknown } | undefined
      if (typeof hierarchy?.parentId === 'string') relatedTaskIds.add(hierarchy.parentId)
      if (Array.isArray(hierarchy?.childIds)) {
        for (const childId of hierarchy.childIds) {
          if (typeof childId === 'string') relatedTaskIds.add(childId)
        }
      }
      const dependsOn = Array.isArray(rawTask.dependsOn) ? rawTask.dependsOn : []
      for (const dependency of dependsOn) {
        if (typeof dependency === 'string') relatedTaskIds.add(dependency)
      }
      const sizePlan = rawTask.sizePlan as { recommendedChildren?: Array<{ createdTaskId?: unknown }> } | undefined
      for (const child of sizePlan?.recommendedChildren ?? []) {
        if (typeof child.createdTaskId === 'string') relatedTaskIds.add(child.createdTaskId)
      }
      for (const candidate of tasks as Array<Record<string, unknown>>) {
        if (typeof candidate.id !== 'string' || candidate.id === id) continue
        const candidateDependsOn = Array.isArray(candidate.dependsOn) ? candidate.dependsOn : []
        if (candidateDependsOn.includes(id)) relatedTaskIds.add(candidate.id)
      }
      relatedTaskIds.delete(id)
      const relatedTasks = await Promise.all(
        [...relatedTaskIds]
          .map(relatedId => tasks.find(candidate => (candidate as { id?: string }).id === relatedId))
          .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate))
          .map(candidate => enrichTaskForServe(project.path, candidate)),
      )
      return c.json({
        task: await enrichTaskForServe(project.path, rawTask),
        relatedTasks,
        workProgress,
        runStatus,
        availability,
        recentEvents: recent,
        contextDebug,
        exploringTranscript,
        threadTurns,
        deliverySpine: {
          model: deliveryModel,
          validation: validateProjectDeliveryModel({ model: deliveryModel, tasks: tasks as Task[], projectRoot: project.path }),
          relationships: deliveryRelationships,
          contextPacket: deliveryContextPacket,
        },
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/delivery-spine', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const tasks = await readTasksFileNormalized(projectTasksPath(project.path))
      const model = await readProjectDeliveryModel(project.path)
      return c.json({
        model,
        validation: validateProjectDeliveryModel({ model, tasks: tasks as Task[], projectRoot: project.path }),
        primitives: listPrimitivesWithRelations(model, tasks as Task[]),
        queue: deriveQueueCandidates({ model, tasks: tasks as Task[] }),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/delivery-spine/queue', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const tasks = await readTasksFileNormalized(projectTasksPath(project.path))
      const model = await readProjectDeliveryModel(project.path)
      return c.json(deriveQueueCandidates({ model, tasks: tasks as Task[] }))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/delivery-spine/contract-results/:resultId/apply', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const resultId = c.req.param('resultId')
      const body = await c.req.json().catch(() => ({})) as { ownerOverrideReason?: string }
      const tasksPath = projectTasksPath(project.path)
      const tasks = await readTasksFileNormalized(tasksPath)
      const model = await readProjectDeliveryModel(project.path)
      const changeSet = stagedContractChangeSet(model, resultId)
      if (!changeSet) return c.json({ error: 'staged contract result not found' }, 404)
      const applied = applyContractChangeSet({
        model,
        tasks: tasks as Task[],
        changeSet,
        actor: 'human',
        ownerOverrideReason: body.ownerOverrideReason,
      })
      await writeProjectDeliveryModel(project.path, applied.model)
      await writeTasksFilePreservingQueue(tasksPath, applied.tasks as unknown as Array<Record<string, unknown>>)
      return c.json({ ok: true, applied: applied.applied })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/delivery-spine/contract-results/:resultId/reject', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const resultId = c.req.param('resultId')
      const body = await c.req.json().catch(() => ({})) as { reason?: string }
      const model = await readProjectDeliveryModel(project.path)
      const changeSet = stagedContractChangeSet(model, resultId)
      if (!changeSet) return c.json({ error: 'staged contract result not found' }, 404)
      const rejected = rejectContractChangeSet({
        model,
        changeSet,
        actor: 'human',
        reason: body.reason?.trim() || 'Rejected from Needs you.',
      })
      await writeProjectDeliveryModel(project.path, rejected)
      return c.json({ ok: true, rejected: rejected.rejectedCandidates.at(-1) })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/project/delivery-spine/contract-results/:resultId/revert', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const resultId = c.req.param('resultId')
      const tasksPath = projectTasksPath(project.path)
      const tasks = await readTasksFileNormalized(tasksPath)
      const model = await readProjectDeliveryModel(project.path)
      const reverted = revertAppliedContractResult({
        model,
        tasks: tasks as Task[],
        resultId,
        actor: 'human',
      })
      await writeProjectDeliveryModel(project.path, reverted.model)
      await writeTasksFilePreservingQueue(tasksPath, reverted.tasks as unknown as Array<Record<string, unknown>>)
      return c.json({ ok: true, warnings: reverted.warnings })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/task/:id/relationships', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const tasks = await readTasksFileNormalized(projectTasksPath(project.path))
      const model = await readProjectDeliveryModel(project.path)
      return c.json(deriveTaskRelationships({ model, tasks: tasks as Task[], taskId: c.req.param('id') }))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/task/:id/context-packet', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const tasks = await readTasksFileNormalized(projectTasksPath(project.path))
      const model = await readProjectDeliveryModel(project.path)
      return c.json(buildTaskContextPacket({ model, tasks: tasks as Task[], taskId: c.req.param('id') }))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/task/:id/evidence', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const tasksPath = projectTasksPath(project.path)
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
      const tasksPath = projectTasksPath(project.path)
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
      const tasksPath = projectTasksPath(project.path)
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
      const tasksPath = projectTasksPath(project.path)
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
      const tasksPath = projectTasksPath(project.path)
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
      const tasksPath = projectTasksPath(project.path)
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const parsed = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as
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
        writeManagedTextFileSync(tasksPath, JSON.stringify(queue, null, 2) + '\n')
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
      writeManagedTextFileSync(tasksPath, JSON.stringify(queue, null, 2) + '\n')
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
      const tasksPath = projectTasksPath(project.path)
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const raw = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as
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

  app.post('/api/project/task/:id/continue', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const id = c.req.param('id')
      const body = await c.req.json().catch(() => ({})) as {
        action?: 'brief_cleanup'
        instruction?: string
        mode?: 'split' | 'checklist' | 'general'
      }
      const action = body.action ?? 'brief_cleanup'
      if (action !== 'brief_cleanup') {
        return c.json({ error: 'unknown continuation action' }, 400)
      }

      const memoryDir = getProjectStateDir(project.path)
      const tasksPath = projectTasksPath(project.path)
      const tasks = await readTasksFileNormalized(tasksPath).catch(() => [])
      if (!tasks.some(task => task.id === id)) {
        return c.json({ error: 'task not found' }, 404)
      }

      const result = await enrichTask({
        memoryDir,
        taskId: id,
        mode: body.mode ?? 'checklist',
        instruction:
          body.instruction ??
          'Complete this task for worker handoff: preserve the useful starting point, write a full product brief and spec handoff, and add concrete acceptance criteria before implementation.',
      })
      if (!result.success) return c.json({ error: result.error ?? 'continuation failed' }, 400)

      const existingRun = supervisor.get(project.id)
      if (existingRun && (existingRun.status === 'running' || existingRun.status === 'stopping')) {
        return c.json({
          ok: true,
          taskId: id,
          action,
          status: result.newStatus,
          continuation: {
            status: 'queued',
            runStatus: existingRun.status,
            mode: existingRun.mode,
          },
        })
      }

      const url = new URL(c.req.url)
      url.pathname = '/api/project/start'
      const startRes = await app.fetch(
        new Request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'continuous', taskId: id }),
        }),
        c.env,
      )
      const startBody = await startRes.json().catch(() => ({})) as Record<string, unknown>
      if (!startRes.ok || startBody.error) {
        if (startBody.code === 'run_already_active') {
          const run = supervisor.get(project.id)
          return c.json({
            ok: true,
            taskId: id,
            action,
            status: result.newStatus,
            continuation: {
              status: 'queued',
              runStatus: run?.status ?? startBody.status ?? 'running',
              ...(run?.mode ? { mode: run.mode } : {}),
            },
          })
        }
        return c.json(
          {
            error: typeof startBody.error === 'string' ? startBody.error : `Continuation failed (HTTP ${startRes.status})`,
            ...(typeof startBody.code === 'string' ? { code: startBody.code } : {}),
            ...(typeof startBody.actionHref === 'string' ? { actionHref: startBody.actionHref } : {}),
            taskId: id,
            action,
            status: result.newStatus,
            continuation: {
              status: 'blocked',
              runStatus: supervisor.get(project.id)?.status ?? 'stopped',
            },
          },
          startRes.status === 409 ? 409 : startRes.status === 400 ? 400 : 500,
        )
      }

      return c.json({
        ok: true,
        taskId: id,
        action,
        status: result.newStatus,
        continuation: {
          status: 'started',
          runStatus: typeof startBody.status === 'string' ? startBody.status : supervisor.get(project.id)?.status ?? 'running',
          mode: typeof startBody.mode === 'string' ? startBody.mode : 'continuous',
          ...(typeof startBody.startedAt === 'string' ? { startedAt: startBody.startedAt } : {}),
          ...(typeof startBody.provider === 'string' ? { provider: startBody.provider } : {}),
          ...(startBody.providerStatus ? { providerStatus: startBody.providerStatus } : {}),
        },
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
  //   update-dependencies → replace task blockers from an explicit user/delegate correction
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
        'update-dependencies',
        'retry-work',
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

      if (action === 'update-dependencies') {
        const body = await c.req.json().catch(() => ({})) as {
          dependsOn?: unknown
          reason?: unknown
        }
        if (!Array.isArray(body.dependsOn)) {
          return c.json({ error: 'dependsOn must be an array of task ids' }, 400)
        }
        const requestedDependencies = body.dependsOn
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map(item => item.trim())
        const tasksPath = projectTasksPath(project.path)
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as
          | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        const queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
          : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
        const task = queue.tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
        if (!task) return c.json({ error: 'task not found' }, 404)
        const knownIds = new Set(queue.tasks.map(t => typeof t.id === 'string' ? t.id : '').filter(Boolean))
        const unknownDependencies = requestedDependencies.filter(dependencyId => !knownIds.has(dependencyId))
        if (unknownDependencies.length > 0) {
          return c.json({ error: `unknown dependency task id(s): ${unknownDependencies.join(', ')}` }, 400)
        }
        const dependsOn = requestedDependencies.filter((dependencyId, index, all) =>
          dependencyId !== id && all.indexOf(dependencyId) === index,
        )
        const now = new Date().toISOString()
        const previous = Array.isArray(task.dependsOn)
          ? task.dependsOn.filter((item): item is string => typeof item === 'string')
          : []
        task.dependsOn = dependsOn
        task.updatedAt = now
        const notes = Array.isArray(task.notes) ? [...task.notes as Array<Record<string, unknown>>] : []
        const reason = typeof body.reason === 'string' && body.reason.trim()
          ? body.reason.trim()
          : 'User/delegate corrected this task dependency boundary.'
        notes.push({
          agentId: 'system:human',
          role: 'human',
          content: [
            `Updated task blockers: ${dependsOn.length > 0 ? dependsOn.join(', ') : 'none'}.`,
            `Previous blockers: ${previous.length > 0 ? previous.join(', ') : 'none'}.`,
            `Reason: ${reason}`,
          ].join('\n'),
          timestamp: now,
        })
        task.notes = notes
        queue.lastUpdated = now
        writeManagedTextFileSync(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        return c.json({ ok: true, taskId: id, dependsOn })
      }

      if (action === 'retry-work') {
        const body = await c.req.json().catch(() => ({})) as {
          instruction?: string
        }
        const tasksPath = projectTasksPath(project.path)
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        let parsed = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as
          | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        let queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
          : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
        let task = queue.tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
        if (!task) return c.json({ error: 'task not found' }, 404)
        if (task.status === 'done' || task.status === 'shelved' || task.status === 'pending_pr') {
          return c.json({ error: `task is ${task.status}` }, 400)
        }
        const now = new Date().toISOString()
        const instruction = body.instruction?.trim()
        const effectiveTask = await buildEffectiveTask(project.path, task as Task) as unknown as Task & {
          runtime?: { openEscalationIds?: string[] }
        }
        const openEscalations = activeEscalations(effectiveTask)
        const hasRuntimeEscalationIds =
          Array.isArray(effectiveTask.runtime?.openEscalationIds) &&
          effectiveTask.runtime.openEscalationIds.length > 0
        let shouldClearRuntimeEscalations = hasRuntimeEscalationIds
        for (const escalation of openEscalations) {
          const resolved = await resolveEscalation({
            tasksPath,
            progressPath: getProjectSystemStatePath(project.path, 'PROGRESS.md'),
            taskId: id,
            escalationId: escalation.id,
            resolution: instruction
              ? `Retrying worker pass with owner steering: ${instruction}`
              : 'Retrying worker pass from the current saved worktree state.',
            resolvedBy: 'human',
            nextStatus: 'ready',
          })
          if (!resolved.success) {
            if (resolved.error === `Escalation ${escalation.id} not found on ${id}`) {
              shouldClearRuntimeEscalations = true
              continue
            }
            return c.json({ error: resolved.error ?? `Could not resolve escalation ${escalation.id}` }, 400)
          }
        }
        if (openEscalations.length > 0) {
          parsed = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as
            | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
            | Array<Record<string, unknown>>
          queue = Array.isArray(parsed)
            ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
            : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
          task = queue.tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
          if (!task) return c.json({ error: 'task not found after escalation resolution' }, 404)
        }
        const notes = Array.isArray(task.notes) ? [...task.notes as Array<Record<string, unknown>>] : []
        notes.push({
          agentId: 'system:human',
          role: 'human',
          content: instruction
            ? `Retry partial worker pass: ${instruction}`
            : 'Retry partial worker pass from the current saved worktree state.',
          timestamp: now,
        })
        task.notes = notes
        task.status = 'in_progress'
        task.assignedTo = null
        delete task.blockReason
        delete task.openEscalations
        task.updatedAt = now
        queue.lastUpdated = now
        if (shouldClearRuntimeEscalations) {
          await upsertTaskRuntimeState(project.path, id, {
            assignedTo: null,
            openEscalationIds: [],
            updatedAt: now,
          })
        }
        writeManagedTextFileSync(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        if (instruction) {
          await resumeExploring({
            memoryDir,
            taskId: id,
            message: instruction,
            preserveStatus: true,
          })
        }
        return c.json({ ok: true, status: task.status })
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
        const tasksPath = projectTasksPath(project.path)
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const queue = TaskQueue.parse(JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')))
        const task = queue.tasks.find(t => t.id === id)
        if (!task) return c.json({ error: 'task not found' }, 404)
        const sizePlan = task.sizePlan
        const hasSettledRepresentedSplit =
          sizePlan?.action === 'proceed_with_warning' &&
          task.taskReadiness?.recommendation === 'requires_child_work' &&
          (sizePlan.recommendedChildren?.length ?? 0) > 0
        if (!sizePlan || (!isMaterializableSplitAction(sizePlan.action) && !hasSettledRepresentedSplit)) {
          return c.json({ error: 'task does not have planned child work' }, 400)
        }
        const now = new Date().toISOString()
        const deliveryModel = await readProjectDeliveryModel(project.path)
        const preflightPlan = isMaterializableSplitAction(sizePlan.action)
          ? planTaskSplit({
              model: deliveryModel,
              tasks: queue.tasks as Task[],
              taskId: task.id,
            })
          : {
              parentTaskId: task.id,
              action: sizePlan.action,
              children: [],
              errors: [],
              warnings: [],
            }
        if (preflightPlan.errors.length > 0) {
          return c.json({
            error: 'split plan failed validation',
            plan: preflightPlan,
          }, 400)
        }
        const repairedSettledSplit = hasSettledRepresentedSplit
          ? settleMaterializedSplitReadiness(queue, task, now) ?? settleAlreadyRepresentedSplitRecommendations(queue, task, now)
          : null
        const materialized = repairedSettledSplit
          ? { status: 'already_represented' as const, childTaskIds: repairedSettledSplit.childTaskIds }
          : materializeSplitChildren(queue, task, now)
        const appliedPlan = materialized.status === 'already_represented'
          ? {
              ...preflightPlan,
              warnings: [
                ...preflightPlan.warnings,
                {
                  path: `tasks.${task.id}.sizePlan`,
                  code: 'split_already_represented',
                  message: 'Planned child work already matches existing sibling tasks; no new child tasks were created.',
                },
              ],
            }
          : preflightPlan
        if (materialized.status === 'materialized') {
          for (const childPlan of appliedPlan.children) {
            const child = queue.tasks.find(candidate => candidate.id === childPlan.plannedTaskId)
            if (!child) continue
            child.delivery = childPlan.delivery
            child.dependsOn = childPlan.dependsOn
            child.updatedAt = now
          }
        }
        task.updatedAt = now
        queue.lastUpdated = now
        writeManagedTextFileSync(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        return c.json({
          ok: true,
          parentTaskId: task.id,
          splitPlan: appliedPlan,
          createdTaskIds: materialized.childTaskIds.length > 0
            ? materialized.childTaskIds
            : sizePlan.recommendedChildren
            .map(child => child.createdTaskId)
            .filter((createdTaskId): createdTaskId is string => Boolean(createdTaskId)),
        })
      }

      if (action === 'approve-brief') {
        const tasksPath = projectTasksPath(project.path)
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as
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
        if (
          (typeof brief.whyItMattersNow !== 'string' || !brief.whyItMattersNow.trim()) &&
          typeof brief.userJob === 'string' &&
          brief.userJob.trim() &&
          typeof brief.successMetric === 'string' &&
          brief.successMetric.trim()
        ) {
          brief.whyItMattersNow = `This matters now because Guildhall needs "${String(task.title ?? 'this task')}" framed tightly enough to reach this outcome: ${brief.successMetric.trim()}`
        }
        if (
          (!Array.isArray(brief.nonGoals) || brief.nonGoals.length === 0) &&
          Array.isArray(brief.antiPatterns)
        ) {
          brief.nonGoals = brief.antiPatterns
        }
        if (
          (!Array.isArray(brief.nonGoals) || brief.nonGoals.length === 0) &&
          (!Array.isArray(brief.antiPatterns) || brief.antiPatterns.length === 0)
        ) {
          brief.nonGoals = [`Do not let "${String(task.title ?? 'this task')}" quietly expand beyond the approved task boundary.`]
          brief.antiPatterns = brief.nonGoals
        }
        const nonGoals = Array.isArray(brief.nonGoals)
          ? brief.nonGoals.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
        const antiPatterns = Array.isArray(brief.antiPatterns)
          ? brief.antiPatterns.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
        if (
          typeof brief.userJob !== 'string' ||
          !brief.userJob.trim() ||
          typeof brief.whyItMattersNow !== 'string' ||
          !brief.whyItMattersNow.trim() ||
          typeof brief.successMetric !== 'string' ||
          !brief.successMetric.trim() ||
          (nonGoals.length === 0 && antiPatterns.length === 0)
        ) {
          return c.json({ error: 'brief is incomplete — needs userJob, whyItMattersNow, successMetric, and at least one non-goal' }, 400)
        }
        const now = new Date().toISOString()
        brief.approvedBy = 'human'
        brief.approvedAt = now
        task.productBrief = brief
        const effectiveTask = await buildEffectiveTask(project.path, task as Task)
        const hadRuntimeOpenEscalationIds =
          Array.isArray(effectiveTask.runtime?.openEscalationIds) &&
          effectiveTask.runtime.openEscalationIds.length > 0
        const hasUnansweredQuestions = taskHasUnansweredVisibleQuestion(effectiveTask as unknown as Task)
        const hasConcreteSpecDraft =
          typeof task.spec === 'string' &&
          task.spec.trim().length > 0 &&
          Array.isArray(task.acceptanceCriteria) &&
          task.acceptanceCriteria.length > 0
        const canPromoteBrief =
          canPromoteApprovedBriefToSpecReview(task) ||
          canPromoteApprovedBriefToSpecReview(effectiveTask as unknown as Record<string, unknown>)
        if (
          canPromoteBrief &&
          hasConcreteSpecDraft &&
          !hasUnansweredQuestions
        ) {
          task.status = 'spec_review'
        } else if (
          canPromoteBrief &&
          !hasConcreteSpecDraft &&
          !hasUnansweredQuestions &&
          seedSpecFromApprovedBrief(task, now)
        ) {
          task.status = 'spec_review'
        }
        task.updatedAt = now
        const resolvedEscalationIds = resolveApprovalSupersededEscalations(
          task,
          now,
          'Superseded by approved task intake; the approved brief/spec is enough for Guildhall to continue without owner re-intake.',
        )
        queue.lastUpdated = now
        writeManagedTextFileSync(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        if (resolvedEscalationIds.length > 0 || hadRuntimeOpenEscalationIds) {
          await upsertTaskRuntimeState(project.path, id, {
            assignedTo: null,
            openEscalationIds: [],
            updatedAt: now,
          })
        }
        return c.json({ ok: true, status: task.status })
      }

      if (action === 'mark-done') {
        const body = await c.req.json().catch(() => ({})) as { evidence?: string }
        const evidence = (body.evidence ?? '').trim()
        const tasksPath = projectTasksPath(project.path)
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as
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
        writeManagedTextFileSync(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        return c.json({ ok: true, status: 'done' })
      }

      if (action === 'add-acceptance') {
        const body = await c.req.json().catch(() => ({})) as { description?: string }
        const description = (body.description ?? '').trim()
        if (!description) return c.json({ error: 'description required' }, 400)
        const tasksPath = projectTasksPath(project.path)
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as
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
        writeManagedTextFileSync(tasksPath, JSON.stringify(queue, null, 2) + '\n')
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
        const tasksPath = projectTasksPath(project.path)
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as
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
        writeManagedTextFileSync(tasksPath, JSON.stringify(queue, null, 2) + '\n')
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
        const tasksPath = projectTasksPath(project.path)
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as
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
        writeManagedTextFileSync(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        // Also append to the exploring transcript so the asking agent reads it.
        await resumeExploring({
          memoryDir,
          taskId: id,
          message: `Answer to "${(q as { id?: string }).id}": ${body.answer.trim()}`,
        })
        await submitLinkedTaskOwnerInput({
          taskId: id,
          questionId: body.questionId,
          answer: body.answer.trim(),
        })
        return c.json({ ok: true })
      }

      if (action === 'stage-answer') {
        const body = (await c.req.json().catch(() => ({}))) as {
          questionId?: string
          answer?: string
        }
        if (!body.questionId) return c.json({ error: 'Missing questionId' }, 400)
        const tasksPath = projectTasksPath(project.path)
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as
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
        writeManagedTextFileSync(tasksPath, JSON.stringify(queue, null, 2) + '\n')
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
        const tasksPath = projectTasksPath(project.path)
        if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const parsed = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as
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
        const ownerInputResponses: Array<{ questionId: string; answer: string }> = []
        for (const a of list) {
          const q = questions.find(x => (x as { id?: string }).id === a.questionId)
          if (!q) { missing.push(a.questionId!); continue }
          delete q.draftAnswer
          q.answeredAt = now
          q.answer = a.answer!.trim()
          transcriptLines.push(`Answer to "${a.questionId}": ${a.answer!.trim()}`)
          ownerInputResponses.push({ questionId: a.questionId!, answer: a.answer!.trim() })
        }
        if (missing.length > 0) {
          return c.json({ error: `question(s) not found: ${missing.join(', ')}` }, 404)
        }
        task.openQuestions = questions
        task.updatedAt = now
        queue.lastUpdated = now
        writeManagedTextFileSync(tasksPath, JSON.stringify(queue, null, 2) + '\n')
        // Single resume with all answers — agent gets the full batch in one
        // context restart instead of N separate ones.
        await resumeExploring({
          memoryDir,
          taskId: id,
          message: transcriptLines.join('\n'),
        })
        for (const response of ownerInputResponses) {
          await submitLinkedTaskOwnerInput({
            taskId: id,
            questionId: response.questionId,
            answer: response.answer,
          })
        }
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
          tasksPath: projectTasksPath(project.path),
          progressPath: getProjectSystemStatePath(project.path, 'PROGRESS.md'),
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
      const tasksPath = projectTasksPath(project.path)
      if (!existsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const parsed = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as
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
      writeManagedTextFileSync(tasksPath, JSON.stringify(queue, null, 2) + '\n')
      return c.json({ ok: true, status: task.status })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // GET /api/project/activity — counts + in-flight tasks for the always-on
  // agent-activity chip. Cheap enough to poll every few seconds from any
  // view (not just the project page).
  app.get('/api/project/activity', async c => {
    try {
      if (project.initializationNeeded) return c.json({ running: false, counts: {}, inFlight: [] })
      const run = supervisor.get(project.id)
      const tasksPath = projectTasksPath(project.path)
      const empty = { running: run?.status === 'running', counts: {}, inFlight: [] as unknown[] }
      if (!existsSync(tasksPath)) return c.json(empty)
      if (run?.status !== 'running' && run?.status !== 'stopping') {
        await repairStoppedRunPhantomActiveTasks(project.path)
      }
      const raw = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as
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
      const progressPath = getProjectSystemStatePath(project.path, 'PROGRESS.md')
      if (!existsSync(progressPath)) return c.json({ progress: '' })
      const raw = readManagedTextFileSync(progressPath, 'utf8')
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
  // Project-scoped; lives in system-local project-state. The spec agent
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

  app.get('/api/project/design-system/discovery', async c => {
    try {
      if (project.initializationNeeded) return c.json({ initializationNeeded: true })
      const memoryDir = getProjectStateDir(project.path)
      const profile = await buildDesignSystemProfile({
        projectPath: project.path,
        memoryDir,
      })
      return c.json(profile)
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

  app.get('/api/project/design-preview', async c => {
    try {
      if (project.initializationNeeded) return c.json({ initializationNeeded: true })
      const memoryDir = getProjectStateDir(project.path)
      const adapter = await discoverDesignPreviewAdapter({
        projectPath: project.path,
        memoryDir,
      })
      return c.json(adapter)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.get('/api/project/design-feedback', async c => {
    try {
      if (project.initializationNeeded) return c.json({ initializationNeeded: true })
      const memoryDir = getProjectStateDir(project.path)
      const feedback = await readDesignFeedbackStore(memoryDir)
      return c.json({ feedback })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.post('/api/project/design-feedback/findings', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const memoryDir = getProjectStateDir(project.path)
      const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
      const finding = await recordDesignFinding({
        memoryDir,
        finding: body as never,
      })
      const routed = await routeDesignFinding({ memoryDir, findingId: finding.id })
      const feedback = await readDesignFeedbackStore(memoryDir)
      return c.json({ ok: true, routed, feedback })
    } catch (err) {
      return c.json({ error: String(err) }, 400)
    }
  })

  app.post('/api/project/design-feedback/owner-feedback', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const memoryDir = getProjectStateDir(project.path)
      const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
      const ownerFeedback = await captureOwnerDesignFeedback({
        memoryDir,
        feedback: body as never,
      })
      const feedback = await readDesignFeedbackStore(memoryDir)
      return c.json({ ok: true, ownerFeedback, feedback })
    } catch (err) {
      return c.json({ error: String(err) }, 400)
    }
  })

  app.post('/api/project/design-feedback/decision-packet', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const memoryDir = getProjectStateDir(project.path)
      const body = await c.req.json().catch(() => ({})) as { feedbackIds?: unknown }
      const feedbackIds = Array.isArray(body.feedbackIds)
        ? body.feedbackIds.filter((id): id is string => typeof id === 'string')
        : undefined
      const packet = await buildDesignDecisionPacket({
        memoryDir,
        ...(feedbackIds ? { feedbackIds } : {}),
      })
      const feedback = await readDesignFeedbackStore(memoryDir)
      return c.json({ ok: true, packet, feedback })
    } catch (err) {
      return c.json({ error: String(err) }, 400)
    }
  })

  app.get('/api/project/external-agent-links', async c => {
    try {
      if (project.initializationNeeded) return c.json({ initializationNeeded: true })
      const memoryDir = getProjectStateDir(project.path)
      const taskId = c.req.query('taskId')
      return c.json(await listExternalAgentLinks({ memoryDir, ...(taskId ? { taskId } : {}) }))
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.post('/api/project/external-agent-links', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const memoryDir = getProjectStateDir(project.path)
      const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
      const link = await recordExternalAgentLink({
        memoryDir,
        link: body as never,
      })
      return c.json({ ok: true, link })
    } catch (err) {
      return c.json({ error: String(err) }, 400)
    }
  })

  app.get('/api/project/design-taste', async c => {
    try {
      if (project.initializationNeeded) return c.json({ initializationNeeded: true })
      const memoryDir = getProjectStateDir(project.path)
      return c.json(await loadEffectiveDesignTaste({ memoryDir }))
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.get('/api/project/design-system/catalog', async c => {
    try {
      if (project.initializationNeeded) return c.json({ initializationNeeded: true })
      const memoryDir = getProjectStateDir(project.path)
      return c.json(await buildDesignSystemCatalog({ projectPath: project.path, memoryDir }))
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  app.get('/api/project/design-intent-surrogate', async c => {
    try {
      if (project.initializationNeeded) return c.json({ initializationNeeded: true })
      const memoryDir = getProjectStateDir(project.path)
      return c.json(await buildDesignIntentSurrogate({ projectPath: project.path, memoryDir }))
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  async function buildProjectReleaseReadinessPayload(): Promise<Record<string, unknown>> {
    const fallbackRelease = {
      id: 'current-work',
      kind: 'current_work',
      label: 'Current task scope',
      state: 'active',
      source: 'inferred',
      description: 'Guildhall is checking the currently selected task scope. No named release is defined for this project yet.',
    }
    if (project.initializationNeeded) return { initializationNeeded: true, release: null, scope: fallbackRelease }
    const memoryDir = getProjectStateDir(project.path)
    const tasksPath = projectTasksPath(project.path)
    const rawQueue: { tasks: Array<Record<string, unknown>>; releases: ProjectRelease[]; selectedReleaseId?: string } = (() => {
      if (!existsSync(tasksPath)) return { tasks: [], releases: [] }
      let raw: { tasks?: Array<Record<string, unknown>>; releases?: ProjectRelease[]; selectedReleaseId?: string } | Array<Record<string, unknown>>
      try {
        raw = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as
          | { tasks?: Array<Record<string, unknown>>; releases?: ProjectRelease[]; selectedReleaseId?: string }
          | Array<Record<string, unknown>>
      } catch {
        throw new Error('Could not read the saved task state file. Fix project-state/TASKS.json, then reload release checks.')
      }
      if (Array.isArray(raw)) return { tasks: raw, releases: [] }
      return {
        tasks: raw.tasks ?? [],
        releases: Array.isArray(raw.releases) ? raw.releases : [],
        ...(typeof raw.selectedReleaseId === 'string' ? { selectedReleaseId: raw.selectedReleaseId } : {}),
      }
    })()
    const rawTasks = rawQueue.tasks
    const tasks = await Promise.all(rawTasks.map((task) => buildEffectiveTask(project.path, task as Task)))
    const releaseStartReadiness = await projectStartReadinessForProject(project.path)
    const { orientationSpine: readinessSpine, releaseTruth } = buildOrientationSpineWithScopedReleaseTruth({
      projectId: project.id,
      charter: inferProjectCharterFromExistingSources(project.path, project.config),
      selectedReleaseId: rawQueue.selectedReleaseId,
      releases: rawQueue.releases,
      tasks: tasks as unknown as Task[],
      runStatus: supervisor.get(project.id)?.status ?? 'stopped',
      startReadiness: releaseStartReadiness,
      workspaceImportDraft: await workspaceImportDraftForOrientation(project.path, releaseStartReadiness),
      sourceRefs: projectOrientationSourceRefs(project.path),
    })
    const release = readinessSpine.selectedRelease
    const readinessScope = release ?? readinessSpine.scope ?? fallbackRelease
    const activePressureTest = listPressureTestIntakes(memoryDir)
      .find(intake => intake.status === 'active' && intake.pendingQuestion)
    if (activePressureTest?.pendingQuestion) {
      return {
        release,
        scope: readinessScope,
        ready: false,
        notReadyReason: `Guildhall has one more question for ${activePressureTest.target.title}. Answer it before judging whether current work is ready.`,
        statusCounts: {},
        openEscalations: [],
        incompleteBriefs: [],
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
      }
    }
    const [ds, codebaseMap] = await Promise.all([
      loadDesignSystem(memoryDir).catch(() => undefined),
      loadCodebaseMap(memoryDir).catch(() => null),
    ])
    const designSystem = releaseDesignSystemStatus(ds, project.config, codebaseMap)
    const {
      scopedTasks,
      statusCounts,
      openEscalations,
      incompleteBriefs,
      unapprovedBriefs,
      unapprovedSpecs,
      shelvedUnclaimed,
      blockedByAgent,
      proofMissingDoneTasks,
      humanBlockingCount,
      unfinishedCount,
      gitStoryTasks,
    } = releaseTruth
    const dirtyCheckout = await guildhallOwnedDirtyCheckout(project.path)
    const gitStory = await buildProjectGitStorySummary(project.path, gitStoryTasks)
    const designSystemBlockingCount =
      scopedTasks.length > 0 &&
      scopedWorkNeedsDesignSystem(scopedTasks, release) &&
      !designSystem.approved
        ? 1
        : 0
    const dirtyCheckoutBlockingCount = dirtyCheckout.ownedCount > 0 || dirtyCheckout.error ? 1 : 0
    const gitStoryBlockingCount = gitStory.blockers.length
    const blockingCount =
      humanBlockingCount
      + unfinishedCount
      + proofMissingDoneTasks.length
      + designSystemBlockingCount
      + dirtyCheckoutBlockingCount
      + gitStoryBlockingCount

    return {
      release,
      scope: readinessScope,
      ready: scopedTasks.length > 0 && blockingCount === 0,
      ...(scopedTasks.length === 0 ? { notReadyReason: 'No tasks in this scope yet.' } : {}),
      statusCounts,
      openEscalations,
      incompleteBriefs,
      unapprovedBriefs,
      unapprovedSpecs,
      shelvedUnclaimed,
      blockedByAgent,
      proofMissingDoneTasks,
      designSystem,
      dirtyCheckout,
      gitStory,
      totals: {
        tasks: scopedTasks.length,
        blockingCount,
        humanBlockingCount,
        incompleteBriefBlockingCount: incompleteBriefs.length,
        proofEvidenceBlockingCount: proofMissingDoneTasks.length,
        unfinishedCount,
        designSystemBlockingCount,
        dirtyCheckoutBlockingCount,
        gitStoryBlockingCount,
        done: statusCounts['done'] ?? 0,
      },
    }
  }

  // -------------------------------------------------------------------------
  // API: release readiness
  //
  // Aggregates the signals that decide whether the selected release, milestone,
  // or owner-named marker is ready enough to hand off, ship, or intentionally
  // defer. Intentionally shallow: it summarizes, it doesn't gate.
  // -------------------------------------------------------------------------
  app.get('/api/project/release-readiness', async c => {
    try {
      return c.json(await buildProjectReleaseReadinessPayload())
    } catch (err) {
      return c.json({
        error: 'Could not load release readiness for this project.',
        detail: err instanceof Error ? err.message : String(err),
      }, 500)
    }
  })

  async function guildhallOwnedDirtyCheckout(projectPath: string): Promise<{
    ownedCount: number
    files: string[]
    error?: string
  }> {
    const workspaceConfig = readWorkspaceConfig(projectPath)
    const childProjects = workspaceConfig.kind === 'workspace'
      ? resolveWorkspaceProjectPathsOrDiscover(projectPath, workspaceConfig)
      : discoverChildGitProjects(projectPath)
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
        .filter(file => !file.replace(/\\/g, '/').startsWith('.guildhall/exploring/'))
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
      path: project.path,
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

  function describeProviders(projectPath?: string) {
    // Run the legacy-config migration on every request. It is idempotent
    // and cheap (a single YAML read + Zod parse) and means users who
    // upgrade in-place never see stale credentials in their project file.
    if (projectPath) {
      try {
        migrateProjectProvidersToGlobal(projectPath, {
          readProject: (p) => readProjectConfig(p),
          writeProject: (p, patch) => updateProjectConfig(p, patch),
        })
      } catch {
        /* best-effort — never let migration break the endpoint */
      }
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

  async function providersPayload(preferredProvider: string | null) {
    const { global, creds, claudeCredPath, codexCredPath, claudeInstalled, codexInstalled } =
      describeProviders()

    const defaultLlamaUrl = 'http://localhost:1234/v1'
    const configuredLlamaUrl = creds.llamaCppUrl ?? ''
    const llamaUrl = configuredLlamaUrl || defaultLlamaUrl
    const llamaReachable = llamaUrl.length > 0 ? await probeLlamaCpp(llamaUrl) : false
    const configuredOpenAiBaseUrl = creds.openaiBaseUrl ?? ''

    const v = (kind: ProviderKind) => global.providers[kind]?.verifiedAt ?? null
    const maxConcurrency = (kind: ProviderKind) => global.providers[kind]?.maxConcurrency ?? null

    return {
      preferredProvider,
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
      describeProviders(currentProjectPath())
      const stored = readProjectConfig(currentProjectPath())
      return c.json(await providersPayload(stored.preferredProvider ?? readGlobalConfig().preferredProvider ?? null))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/providers', async c => {
    try {
      return c.json(await providersPayload(readGlobalConfig().preferredProvider ?? null))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  async function handleProviderConfig(c: Context) {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        scope?: 'global' | 'project'
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
        if (body.scope === 'project') {
          updateProjectConfig(currentProjectPath(), {
            preferredProvider: body.preferredProvider as (typeof allowed)[number],
          })
          refreshProject()
        } else {
          updateGlobalConfig({
            ...readGlobalConfig(),
            preferredProvider: body.preferredProvider as (typeof allowed)[number],
          })
        }
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
  }

  app.post('/api/setup/providers/config', handleProviderConfig)
  app.post('/api/providers/config', handleProviderConfig)

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

  async function modelsPayload(options: { workspacePath?: string } = {}) {
    const global = readGlobalConfig()
    const workspacePath = options.workspacePath
    const workspace = workspacePath ? readWorkspaceConfig(workspacePath) : null
    const projectCfg = workspacePath ? readProjectConfig(workspacePath) : null
    const preferredProvider = projectCfg?.preferredProvider ?? global.preferredProvider
    const resolved = workspacePath ? resolveConfig({ workspacePath }) : null
    const globalModels = resolveModelsForProvider(global.models, preferredProvider)
    const projectModels = resolveModelsForProvider(workspace?.models, preferredProvider)
    const effectiveModels = resolved?.models ?? globalModels
    const globalBehavior = global.modelBehavior ?? {}
    const projectBehavior = workspace?.modelBehavior ?? {}
    const effectiveBehavior = resolved?.modelBehavior ?? globalBehavior
    const creds = resolveGlobalCredentials()
    const loadedModels = creds.llamaCppUrl
      ? await loadedLlamaModelIds(creds.llamaCppUrl).catch(() => [])
      : []
    const missingModels = loadedModels.length > 0 && isCompleteModelAssignment(effectiveModels)
      ? missingAssignedModels(effectiveModels, loadedModels)
      : []
    return {
      globalModels,
      ...(workspace ? { projectModels } : {}),
      effectiveModels,
      globalBehavior,
      ...(workspace ? { projectBehavior } : {}),
      effectiveBehavior,
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
            ...Object.values(globalModels).map(id => ({
              id,
              provider: 'openai-compatible',
              notes: 'Global default',
            })),
            ...Object.values(projectModels).map(id => ({
              id,
              provider: 'openai-compatible',
              notes: 'Project override',
            })),
          ].map(item => [item.id, item]),
        ).values(),
      ],
    }
  }

  app.get('/api/config/models', async c => {
    try {
      return c.json(await modelsPayload({ workspacePath: currentProjectPath() }))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/models', async c => {
    try {
      return c.json(await modelsPayload())
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  async function handleGlobalModelsConfig(c: Context) {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        scope?: 'global' | 'project' | 'global-default'
        role?: keyof ModelAssignmentConfig
        model?: string
        models?: Partial<ModelAssignmentConfig>
        behaviorProfile?: ModelBehaviorProfile
      }
      if (body.scope !== 'global') return c.json({ error: 'Only global model defaults can be saved here.' }, 400)
      const roles: Array<keyof ModelAssignmentConfig> = ['spec', 'coordinator', 'worker', 'reviewer', 'gateChecker', 'contextIndexer']
      const behaviorIds = new Set(MODEL_BEHAVIOR_PROFILES.map(profile => profile.id))
      const preferredProvider = readGlobalConfig().preferredProvider
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
      const requestedBehavior = typeof body.behaviorProfile === 'string'
        ? body.behaviorProfile.trim()
        : undefined
      if (requestedBehavior && !behaviorIds.has(requestedBehavior as ModelBehaviorProfile)) {
        return c.json({ error: 'Unknown behavior profile' }, 400)
      }
      const hasSingleModel = typeof body.model === 'string'
      const hasBehavior = requestedBehavior !== undefined
      if (!requestedModels && !hasSingleModel && !hasBehavior) {
        return c.json({ error: 'Missing "model" or behaviorProfile' }, 400)
      }
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
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  }

  app.post('/api/models', handleGlobalModelsConfig)

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
  // Static web bundle (SvelteKit dashboard). dist/web/ is emitted by build.mjs
  // through Vite/SvelteKit, then served by this Hono host.
  // -------------------------------------------------------------------------
  app.get('/_app/*', c => serveWebAssetPath(c, new URL(c.req.url).pathname.slice(1)))
  app.get('/icons/:filename', c => serveWebIcon(c, c.req.param('filename')))
  app.get('/favicon.ico', c => serveWebIcon(c, 'favicon.ico'))
  app.get('/apple-touch-icon.png', c => serveWebIcon(c, 'apple-touch-icon.png'))
  app.get('/site.webmanifest', c => serveWebIcon(c, 'site.webmanifest'))

  app.all('/api/*', c => c.json({
    error: 'API route not found',
    path: new URL(c.req.url).pathname,
  }, 404))

  // -------------------------------------------------------------------------
  // SPA (catch-all)
  // -------------------------------------------------------------------------
  app.get('*', c => {
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate')
    c.header('Pragma', 'no-cache')
    return c.html(dashboardHtml())
  })

  return { app, supervisor, runtimeSupervisor, projectPath }
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
      void stopStaleGuildhallProcesses({
        currentPid: process.pid,
        currentBuildMtimeMs: Math.floor(mtime),
        ...(opts.staleProcessGuard?.listProcesses ? { listProcesses: opts.staleProcessGuard.listProcesses } : {}),
        ...(opts.staleProcessGuard?.killProcess ? { killProcess: opts.staleProcessGuard.killProcess } : {}),
      }).then(result => {
        if (result.stopped.length > 0) {
          console.log(`[guildhall serve] Stopped ${result.stopped.length} stale Guildhall process${result.stopped.length === 1 ? '' : 'es'}.`)
        }
      }).catch(() => {
        /* non-fatal */
      })
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
        writeManagedTextFileSync(opts.serviceStatePath, JSON.stringify({
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
  server.on('error', err => {
    const code = typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : ''
    if (code === 'EADDRINUSE') {
      console.error(`[guildhall serve] Port ${port} is already in use; another Guildhall service is already running.`)
      process.exit(0)
    }
    console.error(`[guildhall serve] Server error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
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
      const raw = await readManagedTextFile(opts.serviceStatePath, 'utf8').catch(() => null)
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

function parseStructuralMapReviewAction(value: unknown): StructuralMapReviewAction | null {
  if (!value || typeof value !== 'object') return null
  const action = value as Record<string, unknown>
  const kind = typeof action.kind === 'string' ? action.kind : ''
  const str = (key: string) => typeof action[key] === 'string' ? String(action[key]) : ''
  switch (kind) {
    case 'accept':
      return { kind }
    case 'rename_node':
      return str('nodeId') && str('label') ? { kind, nodeId: str('nodeId'), label: str('label') } : null
    case 'merge_nodes':
      return str('sourceNodeId') && str('targetNodeId')
        ? { kind, sourceNodeId: str('sourceNodeId'), targetNodeId: str('targetNodeId'), ...(str('label') ? { label: str('label') } : {}) }
        : null
    case 'split_node':
      return str('nodeId') && str('newNodeId') && str('label') ? { kind, nodeId: str('nodeId'), newNodeId: str('newNodeId'), label: str('label') } : null
    case 'mark_cross_cutting':
      return str('nodeId') ? { kind, nodeId: str('nodeId') } : null
    case 'mark_package_only':
      return str('nodeId') ? { kind, nodeId: str('nodeId') } : null
    case 'ignore_node':
      return str('nodeId') && str('reason') ? { kind, nodeId: str('nodeId'), reason: str('reason') } : null
    case 'defer_decision':
      return str('questionId') ? { kind, questionId: str('questionId'), ...(str('reason') ? { reason: str('reason') } : {}) } : null
    default:
      return null
  }
}

function resolveLocalProjectRefForGraph(
  projectId: string,
  currentProject: { id: string; path: string; config?: { name?: string } | null },
): (ProjectGraphNodeRef & { path: string }) | null {
  if (projectId === currentProject.id) {
    return {
      id: currentProject.id,
      label: currentProject.config?.name ?? currentProject.id,
      path: currentProject.path,
    }
  }
  for (const workspace of listWorkspaces().filter(candidate => candidate.path)) {
    if (workspace.id === projectId) {
      return {
        id: workspace.id,
        label: workspace.name,
        path: workspace.path,
      }
    }
    try {
      const config = readWorkspaceConfig(workspace.path)
      if (config.kind !== 'workspace') continue
      const child = resolveWorkspaceProjectPaths(workspace.path, config).find(candidate => candidate.id === projectId)
      if (child) {
        return {
          id: child.id,
          label: child.label ?? titleCaseGraphLabel(child.id),
          path: child.path,
        }
      }
    } catch {
      // Ignore partially initialized registry entries while resolving local graph targets.
    }
  }
  return null
}

function parseProjectDomainResponsibilityFacet(value: unknown): ProjectDomainResponsibilityFacet | null {
  if (
    value === 'provider_capability' ||
    value === 'shared_contract' ||
    value === 'consumer_configuration' ||
    value === 'consumer_verification'
  ) return value
  return null
}

function titleCaseGraphLabel(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ') || value
}

function structuralDomainsForProjectGraph(projectRoot: string): Array<{
  id: string
  label: string
  path?: string
  kind: 'domain_group' | 'cross_cutting_domain'
}> {
  const map = readAcceptedStructuralMap(projectRoot)
  if (!map) return []
  return map.nodes
    .filter((node): node is typeof node & { kind: 'domain_group' | 'cross_cutting_domain' } =>
      node.kind === 'domain_group' || node.kind === 'cross_cutting_domain',
    )
    .map(node => ({
      id: node.id,
      label: node.label,
      ...(node.relativePath ? { path: node.relativePath } : {}),
      kind: node.kind,
    }))
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringArrayField(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return items.length > 0 ? items.map(item => item.trim()) : undefined
}

function parseProjectDependencyDeliveryExpectation(value: Record<string, unknown>): NonNullable<ProjectDependencyEdge['expectedDelivery']> {
  const nested = value.deliveryExpectation && typeof value.deliveryExpectation === 'object'
    ? value.deliveryExpectation as Record<string, unknown>
    : value
  const format = stringField(nested.format) ?? 'Project dependency delivery'
  const channel = stringField(nested.channel) ?? 'local project graph'
  return {
    format,
    channel,
    consumerVerificationPlan: stringArrayField(nested.consumerVerificationPlan) ?? [
      stringField(nested.consumerVerification) ?? `Verify ${format} from ${channel}.`,
    ],
    ...(stringArrayField(nested.providerProofPlan) ? { providerProofPlan: stringArrayField(nested.providerProofPlan) } : {}),
  }
}

function parseProjectDependencyDeliveryReceipt(value: Record<string, unknown>): DeliveryReceipt {
  const nested = value.deliveryReceipt && typeof value.deliveryReceipt === 'object'
    ? value.deliveryReceipt as Record<string, unknown>
    : value
  const format = stringField(nested.format) ?? 'Project dependency delivery'
  const channel = stringField(nested.channel) ?? 'local project graph'
  const id = stringField(nested.id) ?? `delivery-${Date.now().toString(36)}`
  return {
    id,
    format,
    channel,
    coordinates: stringField(nested.coordinates) ?? channel,
    providerProof: stringArrayField(nested.providerProof) ?? [
      stringField(nested.proof) ?? `Provider delivered ${format}.`,
    ],
  }
}

function parseConsumerReturnPacket(value: Record<string, unknown>): ConsumerReturnPacket {
  const nested = value.returnPacket && typeof value.returnPacket === 'object'
    ? value.returnPacket as Record<string, unknown>
    : value
  return {
    deliveryReceiptId: stringField(nested.deliveryReceiptId) ?? stringField(nested.receiptId) ?? 'latest',
    mismatchKind: consumerReturnMismatchKind(stringField(nested.mismatchKind)),
    expected: stringField(nested.expected) ?? 'The delivery should match the negotiated format and channel.',
    received: stringField(nested.received) ?? 'The delivery could not be consumed as provided.',
    failedVerification: stringArrayField(nested.failedVerification) ?? [
      stringField(nested.failedCheck) ?? 'Consumer verification failed.',
    ],
    evidenceRefs: stringArrayField(nested.evidenceRefs) ?? [],
    requestedCorrection: stringField(nested.requestedCorrection) ?? 'Please redeliver in the negotiated format.',
  }
}

function consumerReturnMismatchKind(value: string | undefined): ConsumerReturnPacket['mismatchKind'] {
  switch (value) {
    case 'format':
    case 'channel':
    case 'scope':
    case 'behavior':
    case 'compatibility':
    case 'docs':
    case 'proof':
      return value
    default:
      return 'format'
  }
}

const WEB_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  // In the bundled build, cli.js sits at dist/cli.js and web assets at dist/web/.
  // In dev (running from src/runtime), we walk up to the repo root and find dist/web.
  const bundled = join(here, 'web')
  if (existsSync(bundled)) return bundled
  return resolve(here, '..', '..', 'dist', 'web')
})()

function webContentType(filename: string): string {
  const extension = extname(filename).toLowerCase()
  if (extension === '.js') return 'text/javascript; charset=utf-8'
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.json' || extension === '.map') return 'application/json'
  if (extension === '.svg') return 'image/svg+xml'
  return iconContentType(filename)
}

function resolveWebAssetPath(filename: string): string | null {
  const normalized = filename.replace(/^\/+/, '')
  const resolved = resolve(WEB_DIR, normalized)
  const root = `${resolve(WEB_DIR)}${pathSeparator}`
  if (resolved !== resolve(WEB_DIR) && !resolved.startsWith(root)) return null
  return resolved
}

async function serveWebAssetPath(c: Context, filename: string): Promise<Response> {
  const path = resolveWebAssetPath(filename)
  if (!path || !existsSync(path)) {
    return c.text(`web asset not built: ${filename} (run pnpm build)`, 404)
  }
  const body = await fsp.readFile(path)
  return new Response(body, {
    headers: {
      'content-type': webContentType(filename),
      'cache-control': filename.startsWith('_app/immutable/')
        ? 'public, max-age=31536000, immutable'
        : 'no-store, no-cache, must-revalidate',
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
  return serveWebAssetPath(c, join('icons', safeName))
}

// ---------------------------------------------------------------------------
// SvelteKit dashboard SPA
// ---------------------------------------------------------------------------

export function dashboardHtml(): string {
  const indexPath = join(WEB_DIR, 'index.html')
  if (!existsSync(indexPath)) {
    return `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Guildhall</title></head><body><p>web app not built: index.html (run pnpm build)</p></body></html>`
  }
  return readFileSync(indexPath, 'utf8')
}
