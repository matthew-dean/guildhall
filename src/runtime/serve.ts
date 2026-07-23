import { writeManagedTextFileSync } from '@guildhall/persistence'
import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import { readFileSync, existsSync, mkdirSync, statSync, writeFileSync, readdirSync, openSync, readSync, closeSync, type Dirent, promises as fsp } from 'node:fs'
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
import {
  atomicWriteText,
  appendTaskEvidence,
  clearTaskRuntimeState,
  clearTaskWorkspaceState,
  getProjectStateDir,
  getProjectRuntimeStatePath,
  getProjectSystemStatePath,
  getProjectTranscriptPath,
  claimProjectStateDatabaseProjectionJobs,
  failProjectStateDatabaseProjectionJob,
  writeProjectStateDatabaseDiagnosticProjection,
  PROJECT_STATE_DATABASE_DIAGNOSTIC_PROJECTION_DOMAIN,
  writeProjectStateDatabaseMemoryHealth,
  writeProjectStateDatabaseReleaseSelectionMutation,
  replaceProjectStateDatabaseRepositories,
  registerProjectCacheWorkspace,
  emitProjectSummaryInvalidation,
  subscribeProjectSummaryInvalidations,
  upsertTaskRuntimeState,
  type ProjectStateDatabaseScopeRow,
  type ProjectStateDatabaseDiagnosticProjectionSnapshot,
  type ProjectStateDatabaseTask,
  type ProjectStateDatabaseRepository,
} from '@guildhall/sessions'
import { readTaskRuntimeStore, readTaskWorkspaceStore, writeTaskRuntimeStore } from './task-state-store.js'
import { classifyCompletionProof, latestRecordedCompletionProofAt, recordedCompletionProofForTask, taskHasRecordedCompletionProof } from './task-completion-proof.js'
import { normalizeAcceptanceCriteriaForCurrentProof, taskDoneButProofMissing, taskDoneButProofMissingForScope, taskDoneButReviewConflict, taskHasNonReviewCommandBackedProof, taskHasScriptProofPath, taskProofIsStale } from './proof-health.js'
import { closeReleaseIfReady } from './release-lifecycle.js'
import { comparableCommand, ensureCommandProofPathsFromAcceptanceCriteria, isConcreteProjectProofCommand } from './proof-paths.js'
import { normalizeReviewPlanForTask } from './review-planner.js'
import { taskBlockerSummary } from './task-blocker-summary.js'
import { readPersistedStructuredSelfCritique, reviewVerdictHasStructuredApproval } from './review-contract.js'
import { applyOwnerInputToStartReadiness, buildProjectSummaryProjection, prepareProjectSummaryProjectionFromUnknownQueue, queueForProjectSummaryScope, readApprovedPlan, updateProjectSummaryProjection, writeProjectSummaryProjectionFromIndexedState, writeProjectSummaryProjectionFromUnknownQueue, type ProjectSummaryProjection } from './project-summary-projection.js'
import { inferProjectOrientationSnapshot } from './project-orientation-snapshot.js'
import { refreshCurrentThreadProjection } from './current-thread-refresh.js'
import { readCurrentThreadTaskIdsAtBoundary, readThreadHistoryReadProjection, readThreadReadProjection, threadReadProjectionFromBoundary } from './thread-read-projection.js'
import {
  bootstrapFleetSummaryProjection,
  fleetSummaryDependsOnDomains,
  markAllFleetSummariesStaleAtBoundary,
  markFleetSummaryErrorAtBoundary,
  markFleetSummaryStaleAtBoundary,
  publishFleetSummaryProjection,
  pruneFleetSummaryProjectionAtBoundary,
  readFleetSummaryProjectionPageAtBoundary,
} from './fleet-summary-projection.js'
import { ProjectStateRevisionMismatchError, projectTaskRecordFromDatabasePoint, projectTaskStateExistsSync, readProjectCanonicalCurrentState, readProjectCompactStateModel, readProjectCurrentStateModel, readProjectGraphStateModel, readProjectMemoryHealthSourceAtBoundary, readProjectOverviewStateAtBoundary, readProjectProgressStateAtBoundary, readProjectProjectionMetadataAtBoundary, readProjectReleaseState, readProjectRepositoryProjectionAtBoundary, readProjectStateAuthorityAtBoundary, readProjectSummaryForProjectAtBoundary, readProjectSummaryShellAtBoundary, readProjectSurfaceStateAtBoundary, readProjectTaskCurrentRecordsAtBoundary, readProjectTaskCurrentStateAtBoundary, readProjectTaskDetailStateAtBoundary, readProjectTaskEvidencePageAtBoundary, readProjectTaskQueue, readProjectTaskQueueAtBoundaryWithRevision, readProjectTaskQueueForRichMutation, readProjectTaskQueueForMutationSync, readProjectTaskQueueSync, readProjectTaskRecordAtBoundary, readProjectTaskRecordsAtBoundary, readProjectTaskRecordsAtBoundaryWithRevision, writePromotedTaskDetailMutation, writeProjectTaskQueueAtCurrentStateBoundary, writeProjectTaskQueueWithSummary, type ProjectCanonicalCurrentState, type ProjectCompactStateReadModel, type ProjectReleaseReadModel, type ProjectSavedReleaseReadModel } from './project-state-boundary.js'
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
  isProofSetupTask,
  materializeProofSetupTask,
  updateDesignSystem,
} from '@guildhall/tools'
import { acceptanceCriteriaFromStructuredSpec, DesignSystem, explicitTaskStructuralIdentity, renderStructuredSpecMarkdown, StructuredSpec, summarizeDesignSystem, Task as TaskSchema, TaskQueue, type DesignSystem as DesignSystemRecord, type ProjectRelease, type Task } from '@guildhall/core'
import {
  loadProjectGuildRoster,
  selectApplicableGuilds,
  reviewersForTask,
  pickPrimaryEngineer,
} from '@guildhall/guilds'
import { OrchestratorSupervisor, readPersistedEventPage, recoverOrphanedExecutionProjection } from './serve-supervisor.js'
import { repairWeakRecoverySpecReviewSeedInQueue } from './orchestrator.js'
import { resolveFanoutCapacity } from './fanout-dispatcher.js'
import { applySourceConflictReconciliation } from './source-conflict-reconciliation.js'
import {
  normalizePreferredProvider,
  selectApiClient,
  type PreferredProviderKey,
  type ProviderName,
} from './provider-selection.js'
import {
  appendFailureClassificationNote,
  appendRecoveryPlaybookNote,
  resolveRecoveryPlan,
  type FailureClassification,
} from './policy.js'
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
  reconcileOrientationSpineWithReleaseTruth,
  taskEligibleForSelectedScope,
  type BuildProjectOrientationSpineInput,
  type OrientationRelease,
  type OrientationReleaseState,
  type OrientationScope,
  type ProjectOrientationCharter,
  type ProjectOrientationSpine,
} from './project-orientation-spine.js'
import { buildProjectScopeProjection, executionScopeRows, normalizeProjectScopeRowReadModel, projectScopeRowNeedsOwnerInput, releaseLabelFromId, selectedProjectScopeForQueue, summarizeProjectScopeOutsideWork, taskCompletionProofSatisfiedByLinkedChildren, taskScopeNodeId, type ProjectScope, type ProjectScopeProjection, type ProjectScopeRow } from './project-scope-projection.js'
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
  emptyProjectDeliveryModel,
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
  contextPacketFromDeliveryReadProjection,
  readProjectDeliveryLegacyTasks,
  readProjectDeliveryReadProjectionWithAuthority,
  refreshProjectDeliveryReadProjection,
} from './delivery-read-projection.js'
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
  canonicalApprovedWorkspaceImport,
  createWorkspaceImportTask,
  dismissWorkspaceImportState,
  dismissWorkspaceImportTask,
  materializeParsedWorkspaceImport,
  materializeWorkspaceImportDraft,
  mergeWorkspaceImportDraft,
  parseWorkspaceImport,
  readWorkspaceGoalsState,
  rerunWorkspaceImportTask,
  summarizeWorkspaceImportSpec,
  workspaceGoalsNeedStructuralRefresh,
  workspaceImportYamlErrors,
  WORKSPACE_IMPORT_TASK_ID,
  workspaceImportTasksPath,
} from './workspace-importer.js'
import {
  detectWorkspaceSignals,
  formWorkspaceHypothesis,
  type WorkspaceImportDraft,
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
import { importedTaskNeedsBriefShaping, importedTaskNeedsSourceRecovery, normalizeImportedDraftTask } from './import-drafts.js'
import { taskShapingBlockers, buildReleaseCompletionSummary, buildReleaseVerdictSummary, ownerInputObjectiveLabel } from '@guildhall/shared'
import { selectedReleaseScopeForQueue, selectedTaskScopeForQueue } from './orchestrator-picker.js'
import { specReviewRequiresOwnerApproval } from './spec-review-ownership.js'
import {
  buildInbox,
  buildInboxBlockers,
  isAttentionOwnedInboxItem,
} from './inbox.js'
import {
  findOwnerInputRequestBySource,
  listOwnerInputRequests,
  listOwnerInputRequestsSync,
  markOwnerInputRequestForBoundedChatReview,
} from './owner-input-store.js'
import {
  buildProjectMigrationAdvisories,
  buildProjectUnderstandingAdvisories,
  markAttentionDismissed,
  recordReconciliationResolved,
  type AttentionRecord,
} from './attention.js'
import { attentionItemsForReleaseTruth, attentionProjectionNeedsReleaseReconciliation, materializeAttentionProjection, previewAttentionProjection, readSavedAttentionSurface, readSavedAttentionSurfaceFromBoundary, type AttentionReleaseTruth } from './attention-projection.js'
import { createProjectProjectionRefreshScheduler, shouldRefreshProjectAtStartup, type ProjectProjectionInvalidation, type ProjectProjectionRefreshScheduler } from './project-projection-refresh.js'
import { createProjectProjectionFreshnessWatcher } from './project-projection-freshness-watcher.js'
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
import { readProjectRuntimeState } from './project-runtime-store.js'
import {
  defaultProjectAvailabilityState,
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
import { applyRunStatusToStartReadiness, buildProjectActionModel, type ProjectActionModel } from './project-action-model.js'
import { NodeGitDriver } from './git-driver.js'
import {
  GitStoryClosureState,
  GitStorySnapshot,
  gitStoryFollowupIsActive,
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
import { hasUsableBlueprint } from './task-plan-recovery.js'
import { repairCompletionProofCriteriaForProjectWithEvidence } from './stale-blocker-repair.js'
import {
  buildCoordinatorProjectPathMap,
  resolveTaskProjectPath,
} from './task-project-path.js'
import { buildEffectiveTask, buildEffectiveTasks, effectiveTaskStatus } from './effective-task.js'
import { buildDoneTaskSummaryBundle } from './done-task-summary.js'
import { readContextDebugForTasks } from './context-observability.js'
import { buildProjectMemoryHealthProjection } from './project-memory-health.js'
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
import { deriveWorkExecutionState } from './work-execution-state.js'
import {
  importedContractStructuralRepairReadiness,
  importedContractWorkIsStructurallyIncomplete,
} from './imported-work-integrity.js'

// ---------------------------------------------------------------------------
// guildhall serve — local service over many projects
//
// `guildhall serve` now acts like the friendly entrypoint to a local
// user-level service. The backend knows about many registered projects; project
// APIs are scoped by explicit project id instead of mutable daemon foreground.
//
// Routes:
//   GET    /api/service               → projection-backed fleet summary
//   GET    /api/service?detail=true   → bounded project summaries + freshness
//   GET    /                          → SPA (root = project detail or setup)
//   GET    /setup                     → SPA setup wizard route
//   GET    /api/project               → bounded project projection
//   GET    /api/project?detail=true   → explicit bounded project-detail payload
//   GET    /api/project?diagnostic=true → legacy full diagnostic payload
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
  projectStatusError?: string
  summaryFreshness?: 'current' | 'stale' | 'error' | 'missing'
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
  releaseSummary?: ProjectSummaryProjection['releaseSummary']
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
    mode?: string
    startedAt?: string
    stoppedAt?: string
    error?: string
    stopSummary?: unknown
    providerStatus?: unknown
  }
  execution?: {
    status: string
    mode?: string
    startedAt?: string | null
    stoppedAt?: string | null
    stopRequestedAt?: string | null
    error?: string | null
    updatedAt: string
  }
  runtime?: {
    status: string
    health?: string | null
    lastActivityAt?: string | null
    updatedAt: string
  }
  ownerInput?: {
    openCount: number
    next?: { id: string; prompt: string; taskId?: string; href?: string } | null
    updatedAt: string
  }
  fleetAttention?: {
    items: AttentionRecord[]
    total: number
    freshness: 'current' | 'missing'
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
    proofTaskIds?: string[]
    count?: number
    executionScope?: StartExecutionScopeSummary
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

const FLEET_ATTENTION_ITEM_LIMIT = 32
const FLEET_SUMMARY_TEXT_LIMIT = 512

function fleetText(value: string | undefined | null, fallback: string): string | undefined {
  if (value === undefined || value === null) return value ?? undefined
  return value.length <= FLEET_SUMMARY_TEXT_LIMIT ? value : fallback
}

function compactFleetAction(action: ProjectActionModel['primaryAction']): ProjectActionModel['primaryAction'] {
  if (!action) return null
  return {
    ...action,
    label: fleetText(action.label, 'Review selected work') ?? 'Review selected work',
    ...(action.detail ? { detail: fleetText(action.detail, 'Open the project to review the current work.') } : {}),
    ...(action.content ? { content: fleetText(action.content, 'Open the project to inspect the full work item.') } : {}),
    buttonLabel: fleetText(action.buttonLabel, 'Open') ?? 'Open',
  }
}

function compactFleetSummaryPayload(summary: ServiceProjectSummary): ServiceProjectSummary {
  const releaseSummary = summary.releaseSummary
    ? {
        ...summary.releaseSummary,
        release: summary.releaseSummary.release
          ? {
              ...summary.releaseSummary.release,
              label: fleetText(
                summary.releaseSummary.release.label,
                `Release ${summary.releaseSummary.release.id}`,
              ) ?? `Release ${summary.releaseSummary.release.id}`,
            }
          : null,
        blockers: summary.releaseSummary.blockers.map(blocker => ({
          ...blocker,
          label: fleetText(
            blocker.label,
            blocker.owningTaskId ? `Work item ${blocker.owningTaskId} needs attention.` : 'Release needs attention.',
          ) ?? 'Release needs attention.',
        })),
      }
    : undefined
  const startReadiness = summary.startReadiness
    ? (() => {
        const { focusTaskTitle: _focusTaskTitle, ...readinessWithoutTitle } = summary.startReadiness
        return {
          ...readinessWithoutTitle,
          ...(readinessWithoutTitle.message
            ? {
                message: fleetText(
                  readinessWithoutTitle.message,
                  readinessWithoutTitle.focusTaskId
                    ? `Work item ${readinessWithoutTitle.focusTaskId} needs attention before it can start.`
                    : 'Selected work needs attention before it can start.',
                ),
              }
            : {}),
        }
      })()
    : null
  const ownerInput = summary.ownerInput
    ? {
        ...summary.ownerInput,
        ...(summary.ownerInput.next
          ? {
              next: {
                ...summary.ownerInput.next,
                prompt: fleetText(summary.ownerInput.next.prompt, 'Open Thread to inspect the current question.')
                  ?? 'Open Thread to inspect the current question.',
              },
            }
          : {}),
      }
    : undefined
  const run = summary.run
    ? {
        status: summary.run.status,
        ...(summary.run.mode ? { mode: summary.run.mode } : {}),
        ...(summary.run.startedAt ? { startedAt: summary.run.startedAt } : {}),
        ...(summary.run.stoppedAt ? { stoppedAt: summary.run.stoppedAt } : {}),
        ...(summary.run.error ? { error: fleetText(summary.run.error, 'The last run reported an error. Open the project for details.') } : {}),
      }
    : undefined
  const fleetAttention = summary.fleetAttention
    ? {
        total: summary.fleetAttention.total,
        freshness: summary.fleetAttention.freshness,
        items: summary.fleetAttention.items.slice(0, FLEET_ATTENTION_ITEM_LIMIT).map(record => ({
          id: record.id,
          status: record.status,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          kind: record.kind,
          severity: record.severity,
          title: fleetText(record.title, 'Project attention needed.') ?? 'Project attention needed.',
          detail: fleetText(record.detail, 'Open the project to inspect this item.') ?? 'Open the project to inspect this item.',
          ...(record.actionHref ? { actionHref: record.actionHref } : {}),
          ...('taskId' in record && record.taskId ? { taskId: record.taskId } : {}),
          ...(record.blocking !== undefined ? { blocking: record.blocking } : {}),
          ...(record.dismissible !== undefined ? { dismissible: record.dismissible } : {}),
        } as AttentionRecord)),
      }
    : undefined

  // Fleet is a saved card projection, not a second task-detail store. Select
  // only bounded identity, counts, release truth, and next-action fields so a
  // giant task prompt cannot make every project disappear from the fleet.
  return {
    id: summary.id,
    path: summary.path,
    name: summary.name,
    initializationNeeded: summary.initializationNeeded,
    ...(summary.projectStatusLoading !== undefined ? { projectStatusLoading: summary.projectStatusLoading } : {}),
    ...(summary.projectStatusError ? { projectStatusError: fleetText(summary.projectStatusError, 'Open the project to inspect the current status.') } : {}),
    ...(summary.summaryFreshness ? { summaryFreshness: summary.summaryFreshness } : {}),
    ...(summary.tags ? { tags: summary.tags } : {}),
    ...(summary.summary ? { summary: fleetText(summary.summary, 'Open the project to read its full summary.') } : {}),
    ...(summary.taskCounts ? { taskCounts: summary.taskCounts } : {}),
    ...(summary.workProgress ? { workProgress: summary.workProgress } : {}),
    ...(releaseSummary ? { releaseSummary } : {}),
    ...(summary.highlights
      ? {
          highlights: {
            activeTaskTitle: fleetText(summary.highlights.activeTaskTitle, 'Active work is in progress.') ?? null,
            blockedTaskTitle: fleetText(summary.highlights.blockedTaskTitle, 'Work needs attention.') ?? null,
            recentCompletedTaskTitle: fleetText(summary.highlights.recentCompletedTaskTitle, 'Recent work completed.') ?? null,
          },
        }
      : {}),
    ...(run ? { run } : {}),
    ...(summary.execution ? { execution: summary.execution } : {}),
    ...(summary.runtime ? { runtime: summary.runtime } : {}),
    ...(ownerInput ? { ownerInput } : {}),
    ...(fleetAttention ? { fleetAttention } : {}),
    ...(startReadiness ? { startReadiness } : {}),
    ...(summary.actionModel
      ? {
          actionModel: {
            ...summary.actionModel,
            primaryAction: compactFleetAction(summary.actionModel.primaryAction),
            secondaryActions: summary.actionModel.secondaryActions.map(action => compactFleetAction(action)!).filter(Boolean),
            runControl: {
              ...summary.actionModel.runControl,
              ...(summary.actionModel.runControl.disabledReason
                ? { disabledReason: fleetText(summary.actionModel.runControl.disabledReason, 'Open the project to inspect why work is paused.') }
                : {}),
            },
            ownerInput: {
              ...summary.actionModel.ownerInput,
              ...(summary.actionModel.ownerInput.label
                ? { label: fleetText(summary.actionModel.ownerInput.label, 'Answer in Thread') }
                : {}),
              ...(summary.actionModel.ownerInput.detail
                ? { detail: fleetText(summary.actionModel.ownerInput.detail, 'Open Thread to inspect the current question.') }
                : {}),
            },
            setup: {
              ...summary.actionModel.setup,
              ...(summary.actionModel.setup.detail
                ? { detail: fleetText(summary.actionModel.setup.detail, 'Open the project to finish setup.') }
                : {}),
            },
          },
        }
      : {}),
  }
}

function fleetAttentionProjection(records: readonly AttentionRecord[]): NonNullable<ServiceProjectSummary['fleetAttention']> {
  const items = records
    .filter(record => record.status === 'open')
    .filter(isAttentionOwnedInboxItem)
    .filter(record => record.severity !== 'low')
  return {
    items: items.slice(0, FLEET_ATTENTION_ITEM_LIMIT),
    total: items.length,
    freshness: 'current',
  }
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
      if (!/Deliverable|Foundation|Consumer|should say|missing|Needed contracts|Recommended first task title|Stage alignment|Current Next Milestone|\bRelease Plan\b|^##\s+Stage\s+\d+/im.test(content)) continue
      sources.push({ path: relative(projectPath, absolute) || entry.name, content })
    }
  }

  await walk(projectPath)
  return sources
}

const execFileP = promisify(execFile)

function inferProjectCharterFromExistingSources(
  projectPath: string,
  config?: WorkspaceYamlConfig | null,
): Partial<ProjectOrientationCharter> | null {
  return inferProjectOrientationSnapshot(projectPath, config).charter
}

function projectOrientationSourceRefs(projectPath: string): string[] {
  return inferProjectOrientationSnapshot(projectPath).sourceRefs
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
const attentionPreviewHistory = new Map<string, AttentionRecord[]>()
type NormalizedTaskQueue = {
  tasks: Array<Record<string, unknown>>
  releases: ProjectRelease[]
  selectedReleaseId?: string
  lastUpdated?: string
}

type StartStateSnapshot = {
  queue?: NormalizedTaskQueue
  effectiveTasks?: Task[]
  /** `null` is meaningful: it says this revision has no selected scope. */
  scope?: ProjectScope | null
  /** Owner-input state captured in the same current-state summary snapshot. */
  ownerInput?: ProjectSummaryProjection['ownerInput'] | null
  /** The same bounded summary shown by Overview and Release. */
  summary?: ProjectSummaryProjection | null
}

function savedProofEvidenceStartBlocker(
  summary: ProjectSummaryProjection | null | undefined,
  requestedTaskId?: string,
): {
  canStart: false
  code: 'proof_evidence_missing'
  message: string
  actionHref: string
  focusTaskId?: string
  focusTaskTitle?: string
  focusKind: 'proof'
  proofTaskIds: string[]
  count: number
} | null {
  if (!summary) return null
  const count = summary.releaseSummary.counts.proofBlocked
  if (count <= 0) return null

  const proofTaskIds = summary.releaseSummary.blockers
    .filter(blocker => blocker.code === 'proof_evidence_missing')
    .map(blocker => blocker.owningTaskId ?? blocker.id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
  const focusTaskId = summary.nextAction.focusTaskId ?? proofTaskIds[0]
  if (requestedTaskId && proofTaskIds.length > 0 && !proofTaskIds.includes(requestedTaskId)) return null
  if (requestedTaskId && proofTaskIds.length === 0 && focusTaskId !== requestedTaskId) return null
  const focusTaskTitle = summary.nextAction.focusTaskTitle
  const message = summary.nextAction.code === 'proof_evidence_missing'
    ? summary.nextAction.message
    : `${count} completed work item${count === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} missing current completion proof.${focusTaskTitle ? ` Start with "${focusTaskTitle}".` : ''}`

  return {
    canStart: false,
    code: 'proof_evidence_missing',
    message,
    actionHref: focusTaskId ? `/work?task=${encodeURIComponent(focusTaskId)}` : '/work',
    ...(focusTaskId ? { focusTaskId } : {}),
    ...(focusTaskTitle ? { focusTaskTitle } : {}),
    focusKind: 'proof',
    proofTaskIds,
    count,
  }
}

type StartExecutionScopeSummary = {
  id: string
  label: string
  kind: string
  source?: string
  taskCount?: number
  deferredTaskCount?: number
}

/**
 * The one current-state read boundary for release/detail work. `rawQueue` is
 * the canonical saved definition envelope; `tasks` is its current effective
 * overlay (runtime, workspace, and bounded evidence). Callers must pass this
 * pair together so a rich read cannot accidentally combine one queue with a
 * task list from another source or invent intake-only task identities.
 */
function invalidateTaskQueueReadCaches(tasksPath: string): void {
  normalizedTasksCache.delete(tasksPath)
  invalidateCachedFile(tasksPath)
}

function sameSerializedTasks(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function readTasksFileNormalized(
  tasksPath: string,
  options: { repair?: boolean } = {},
): Promise<Array<Record<string, unknown>>> {
  const currentState = readProjectCurrentStateModel(tasksPath)
  if (currentState.authority !== 'database') return []
  const mutationRead = options.repair === true ? readProjectTaskQueueForMutationSync(tasksPath) : null
  const parsed = (mutationRead?.queue ?? currentState.queue) as {
    tasks?: Array<Record<string, unknown>>
    version?: unknown
    lastUpdated?: unknown
    releases?: ProjectRelease[]
    selectedReleaseId?: string
  }
  const cached = normalizedTasksCache.get(tasksPath)
  if (cached && sameSerializedTasks(cached.raw, parsed)) {
    return cached.tasks.map(task => ({ ...task }))
  }
  const tasks = (Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tasks) ? parsed.tasks : [])
    .map(task => ({ ...task }))
  let changed = false
  if (options.repair === true) {
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
  }
  // Reads are intentionally non-mutating. Repair is an explicit maintenance
  // operation so a GET cannot silently rewrite task ownership or status.
  if (!changed || options.repair !== true) {
    normalizedTasksCache.set(tasksPath, { raw: parsed, tasks: tasks.map(task => ({ ...task })) })
    return tasks
  }

  const rewritten = Array.isArray(parsed)
    ? { version: 1, tasks, lastUpdated: new Date().toISOString() }
    : {
        ...parsed,
        tasks,
        lastUpdated: new Date().toISOString(),
      }
  writeProjectTaskQueueWithSummary(tasksPath, rewritten, {
    ...(mutationRead ? { expectedQueueRevision: mutationRead.expectedQueueRevision } : {}),
  })
  normalizedTasksCache.set(tasksPath, { raw: rewritten, tasks: tasks.map(task => ({ ...task })) })
  return tasks
}

async function readTaskQueueFileNormalized(
  tasksPath: string,
  options: { repair?: boolean } = {},
): Promise<NormalizedTaskQueue> {
  const currentState = readProjectCurrentStateModel(tasksPath)
  if (currentState.authority !== 'database') return { tasks: [], releases: [] }
  const parsed = currentState.queue as {
    tasks?: Array<Record<string, unknown>>
    releases?: ProjectRelease[]
    selectedReleaseId?: string
    lastUpdated?: string
  }
  const tasks = options.repair === true
    ? await readTasksFileNormalized(tasksPath, options)
    : (Array.isArray(parsed.tasks) ? parsed.tasks.map(task => ({ ...task })) : [])
  const parsedReleases = (parsed.releases ?? []).map(release => persistableProjectRelease(release as unknown as ProjectRelease))
  const parsedSelectedReleaseId = typeof parsed.selectedReleaseId === 'string' ? parsed.selectedReleaseId : undefined
  const releases = parsedReleases
  const selectedReleaseId =
    parsedSelectedReleaseId && releases.some(release => release.id === parsedSelectedReleaseId)
      ? parsedSelectedReleaseId
      : undefined
  const lastUpdated = typeof parsed.lastUpdated === 'string' ? parsed.lastUpdated : undefined
  const queue: NormalizedTaskQueue = {
    tasks,
    releases,
    ...(selectedReleaseId ? { selectedReleaseId } : {}),
    ...(lastUpdated ? { lastUpdated } : {}),
  }
  return queue
}

/**
 * Read-only task routes must use the same authority boundary as the drawer.
 * Promoted projects intentionally have no TASKS.json, so a route that checks
 * that file before consulting the database is a broken compatibility path.
 */
async function readProjectTasksForServe(tasksPath: string): Promise<Array<Record<string, unknown>>> {
  return readTasksFileNormalized(tasksPath)
}

/**
 * Delivery reads need task identity, dependency, and compact delivery links,
 * not full task definitions. Promoted projects get those rows from the same
 * indexed project snapshot used by other compact surfaces; only legacy
 * projects use the explicit compatibility reader.
 */
async function readProjectDeliveryTasks(projectRoot: string): Promise<Array<Record<string, unknown>>> {
  const tasksPath = projectTasksPath(projectRoot)
  if (readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database') {
    const snapshot = readProjectCompactStateModel(tasksPath, { includeDefinitions: false })
    if (!snapshot) throw new Error(`Authoritative delivery projection is unavailable for ${tasksPath}; refresh the project state first.`)
    return snapshot.inventory.tasks.map(projectTaskRecordFromDatabasePoint)
  }
  return readProjectDeliveryLegacyTasks(projectRoot)
}

/**
 * Explicit task tabs are point reads. Only an unpromoted compatibility
 * project may fall back to the aggregate helper; promoted state returns a
 * miss without reopening the full queue.
 */
async function readProjectTaskForServe(tasksPath: string, taskId: string): Promise<Record<string, unknown> | null> {
  const point = readProjectTaskRecordAtBoundary(tasksPath, taskId)
  if (point) return point
  if (readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database') return null
  const tasks = await readProjectTasksForServe(tasksPath)
  return tasks.find(task => task.id === taskId) ?? null
}

interface ProjectTaskEndpointRead {
  task: Record<string, unknown>
  authority: 'database' | 'legacy'
  queueRevision: number | null
  projectRevision: number | null
}

/** One task point for bounded task tabs, carrying the source revision. */
async function readProjectTaskEndpointPoint(
  projectRoot: string,
  taskId: string,
): Promise<ProjectTaskEndpointRead | null> {
  const tasksPath = projectTasksPath(projectRoot)
  const detail = readProjectTaskDetailStateAtBoundary(tasksPath, taskId)
  if (detail?.authority === 'database') {
    if (!detail.state) return null
    return {
      task: projectTaskRecordFromDatabasePoint(detail.state.task),
      authority: 'database',
      queueRevision: detail.state.queueRevision,
      projectRevision: detail.state.projectRevision,
    }
  }
  const task = await readProjectTaskForServe(tasksPath, taskId)
  return task
    ? { task, authority: 'legacy', queueRevision: null, projectRevision: null }
    : null
}

async function writeTasksFilePreservingQueue(
  tasksPath: string,
  tasks: Array<Record<string, unknown>>,
  projectRoot: string,
): Promise<void> {
  let parsed:
    | { tasks?: Array<Record<string, unknown>>; version?: unknown; lastUpdated?: unknown }
    | Array<Record<string, unknown>>
    | null = null
  let expectedQueueRevision: number | null = null
  try {
    const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
    parsed = queueRead.queue as typeof parsed
    expectedQueueRevision = queueRead.expectedQueueRevision
  } catch (error) {
    if (readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database') throw error
    parsed = null
  }
  const rewritten = {
    ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { version: 1 }),
    tasks,
    lastUpdated: new Date().toISOString(),
  }
  await writeProjectTaskQueueAtCurrentStateBoundary(tasksPath, rewritten, {
    projectRoot,
    expectedQueueRevision,
  })
  normalizedTasksCache.set(tasksPath, { raw: rewritten, tasks: tasks.map(task => ({ ...task })) })
}

async function writeTaskQueueFilePreservingQueue(
  tasksPath: string,
  queue: {
    tasks: Array<Record<string, unknown>>
    releases?: ProjectRelease[]
    selectedReleaseId?: string
  },
  projectRoot: string,
): Promise<void> {
  let parsed:
    | { tasks?: Array<Record<string, unknown>>; releases?: ProjectRelease[]; selectedReleaseId?: string; version?: unknown; lastUpdated?: unknown }
    | Array<Record<string, unknown>>
    | null = null
  let expectedQueueRevision: number | null = null
  try {
    const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
    parsed = queueRead.queue as typeof parsed
    expectedQueueRevision = queueRead.expectedQueueRevision
  } catch (error) {
    if (readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database') throw error
    parsed = null
  }
  const rewritten = Array.isArray(parsed)
    ? {
        version: 1,
        tasks: queue.tasks,
        releases: queue.releases ?? [],
        ...(queue.selectedReleaseId ? { selectedReleaseId: queue.selectedReleaseId } : {}),
        lastUpdated: new Date().toISOString(),
      }
    : {
        ...(parsed && typeof parsed === 'object' ? parsed : { version: 1 }),
        tasks: queue.tasks,
        releases: queue.releases ?? [],
        ...(queue.selectedReleaseId ? { selectedReleaseId: queue.selectedReleaseId } : {}),
        lastUpdated: new Date().toISOString(),
      }
  await writeProjectTaskQueueAtCurrentStateBoundary(tasksPath, rewritten, {
    projectRoot,
    expectedQueueRevision,
  })
  invalidateTaskQueueReadCaches(tasksPath)
}

async function writeProjectReleaseEnvelope(
  tasksPath: string,
  releaseId: string,
  candidateReleases: readonly ProjectRelease[] = [],
  options: { preserveExistingLifecycleState?: boolean } = {},
): Promise<{ release: ProjectRelease; selectedReleaseId: string }> {
  if (!projectTaskStateExistsSync(tasksPath)) throw new Error('No task queue exists for this project.')
  const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
  const raw = queueRead.queue as
    | {
        tasks?: Array<Record<string, unknown>>
        releases?: ProjectRelease[]
        selectedReleaseId?: string
        executionPlanActions?: Array<Record<string, unknown>>
        scopeAuthorityRequests?: Array<Record<string, unknown>>
        version?: unknown
        lastUpdated?: unknown
      }
    | Array<Record<string, unknown>>
  if (Array.isArray(raw)) throw new Error('This project has no release containers yet.')
  const releasesById = new Map<string, ProjectRelease>()
  for (const release of Array.isArray(raw.releases) ? raw.releases : []) releasesById.set(release.id, persistableProjectRelease(release))
  for (const release of candidateReleases) {
    const persisted = persistableProjectRelease(release)
    const existing = releasesById.get(release.id)
    // The selectable spine is a read model and may contain computed readiness
    // for a shipped release. Existing lifecycle state belongs to the durable
    // release envelope, so never let a selection read turn that projection
    // back into authoritative state.
    const candidateState = options.preserveExistingLifecycleState && existing?.state
      ? existing.state
      : (
      ['planned', 'active', 'ready', 'shipped', 'deferred'].includes(persisted.state)
        ? persisted.state
        : 'active'
      )
    // Selecting a later release is its activation boundary. Keep the
    // selection and persisted lifecycle state in one write so a cold restart
    // cannot show the selected scope as active while the durable release still
    // says planned. A shipped release is historical and must remain closed.
    const state = release.id === releaseId && (candidateState === 'planned' || candidateState === 'deferred')
      ? 'active'
      : candidateState
    const immutableShippedMembership = options.preserveExistingLifecycleState && existing?.state === 'shipped'
      ? {
          nodeIds: [...existing.nodeIds],
          deferredNodeIds: [...existing.deferredNodeIds],
        }
      : {}
    releasesById.set(release.id, { ...persisted, ...immutableShippedMembership, state })
  }
  const releases = [...releasesById.values()]
  const release = releases.find(candidate => candidate.id === releaseId)
  if (!release) throw new Error('Release not found in this project.')
  const rewritten = {
    ...raw,
    releases,
    selectedReleaseId: releaseId,
    executionPlanActions: Array.isArray(raw.executionPlanActions) ? raw.executionPlanActions : [],
    scopeAuthorityRequests: Array.isArray(raw.scopeAuthorityRequests) ? raw.scopeAuthorityRequests : [],
    lastUpdated: new Date().toISOString(),
  }
  if (readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database') {
    if (!Number.isInteger(queueRead.expectedQueueRevision) || queueRead.expectedQueueRevision! < 0 ||
      !Number.isInteger(queueRead.expectedProjectRevision) || queueRead.expectedProjectRevision! < 0) {
      throw new Error('Cannot select a release without a current project-state revision.')
    }
    const queueUpdatedAt = typeof rewritten.lastUpdated === 'string'
      ? rewritten.lastUpdated
      : '1970-01-01T00:00:00.000Z'
    const projectionQueue = {
      ...rewritten,
      tasks: (rewritten.tasks ?? []).map(task => {
        const createdAt = typeof task.createdAt === 'string' ? task.createdAt : queueUpdatedAt
        return {
          ...task,
          createdAt,
          updatedAt: typeof task.updatedAt === 'string' ? task.updatedAt : createdAt,
        }
      }),
    }
    const prepared = prepareProjectSummaryProjectionFromUnknownQueue(tasksPath, {
      queue: projectionQueue,
      taskDefinitionsAlreadySanitized: true,
    })
    if (!prepared.parsedQueue || !prepared.scopeRows) {
      throw new Error('Cannot select a release without a current project summary projection.')
    }
    writeProjectStateDatabaseReleaseSelectionMutation(tasksPath, {
      releases: releases as unknown as Array<Record<string, unknown>>,
      selectedReleaseId: releaseId,
      summary: prepared.projection as unknown as Record<string, unknown>,
      scopeRows: prepared.scopeRows,
      expectedQueueRevision: queueRead.expectedQueueRevision!,
      expectedProjectRevision: queueRead.expectedProjectRevision!,
      lastUpdated: rewritten.lastUpdated,
    })
  } else {
    writeProjectTaskQueueWithSummary(tasksPath, rewritten, { expectedQueueRevision: queueRead.expectedQueueRevision })
  }
  invalidateTaskQueueReadCaches(tasksPath)
  return { release, selectedReleaseId: releaseId }
}

function persistableProjectRelease(release: ProjectRelease): ProjectRelease {
  const description = (release as ProjectRelease & { description?: string | null }).description
  return {
    ...release,
    nodeIds: [...(release.nodeIds ?? [])],
    deferredNodeIds: [...(release.deferredNodeIds ?? [])],
    ...(typeof description === 'string' ? { description } : { description: undefined }),
  }
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

  const structuredSpec = StructuredSpec.parse({
    whatThisIs: `Complete ${title} from the approved product brief and current task evidence.`,
    problemContext: [
      `Approved user job: ${userJob}`,
      `Why it matters now: ${whyItMattersNow}`,
      `Success metric: ${successMetric}`,
      `Existing task description: ${description}`,
    ].join(' '),
    goals: [
      'Satisfy the approved user job without asking the owner to repeat answered intake.',
      'Record which existing artifacts, docs, tasks, or implementation changes satisfy the remaining delta.',
    ],
    nonGoals: uniqueNonGoals.length > 0
      ? uniqueNonGoals
      : ['Work not implied by the approved brief or current task evidence.'],
    proposedDesign: 'Use the project surfaces named by the approved brief and current task evidence, recording implementation and proof in their existing durable contracts.',
    keyDecisions: ['The owner-approved brief is the current scope boundary; newly discovered product decisions remain separate work.'],
    acceptanceCriteria: [
      `Given the approved brief, when ${title} is completed, then the delivered work satisfies the approved user job without asking the owner to repeat answered intake.`,
      `Given the current task evidence, when the task is reviewed, then Guildhall records which existing artifacts, docs, tasks, or implementation changes satisfy the remaining delta.`,
      'Given the work is complete, when verification runs, then Guildhall records review or command proof sufficient to explain why the task can move to done.',
    ],
    verification: [
      'Review the changed project surfaces against the approved brief and current task evidence.',
      'Record the observed implementation or proof result against this task.',
    ],
    completionBoundary: {
      productOutcome: successMetric,
      whatGuildhallCanCompleteInCode: 'The repo-local docs, artifacts, task records, implementation, tests, or proof needed by this approved brief.',
      externalDependencies: 'None known from the approved brief.',
      ownerOnlySetup: 'None known after approval.',
      verificationEnvironment: 'The current registered project and its existing proof surfaces.',
      whatCountsAsDone: 'The remaining delta is implemented or proven already satisfied, reviewed, and backed by recorded verification.',
      whatMustBeSplitOrBlocked: 'Only newly discovered work that cannot be resolved from the approved brief and current task evidence.',
      splitPolicy: 'conditional',
    },
  })

  task.structuredSpec = structuredSpec
  task.spec = renderStructuredSpecMarkdown(structuredSpec)
  task.acceptanceCriteria = acceptanceCriteriaFromStructuredSpec(structuredSpec)
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

const PHANTOM_WORKER_CLAIM_MIN_AGE_MS = 5 * 60 * 1000

function noteTimestampMs(note: Record<string, unknown> | undefined): number | null {
  const timestamp = typeof note?.timestamp === 'string' ? Date.parse(note.timestamp) : NaN
  return Number.isFinite(timestamp) ? timestamp : null
}

function isPhantomWorkerClaimAfterStoppedRun(task: Record<string, unknown>, nowMs = Date.now()): boolean {
  if (task.status !== 'in_progress') return false
  if (!taskHasRunnableSpec(task)) return false
  const last = lastTaskNote(task)
  const claimTimestampMs = noteTimestampMs(last)
  if (claimTimestampMs == null || nowMs - claimTimestampMs < PHANTOM_WORKER_CLAIM_MIN_AGE_MS) return false
  const structured = last?.structured
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) return false
  const claim = structured as Record<string, unknown>
  return (
    last?.agentId === 'task-claimer' &&
    claim.event === 'task_claim' &&
    claim.source === 'deterministic' &&
    claim.taskId === task.id &&
    claim.assignedTo === 'worker-agent'
  )
}

async function repairSpecTimeoutBlockedTask(projectPath: string, requestedTaskId: string): Promise<boolean> {
  const tasksPath = projectTasksPath(projectPath)
  if (!projectTaskStateExistsSync(tasksPath)) return false
  const databaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
  const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
  const parsed = queueRead.queue as
    | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
    | Array<Record<string, unknown>>
  const queue = Array.isArray(parsed)
    ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
    : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
  const task = queue.tasks.find(candidate => String(candidate.id ?? '') === requestedTaskId)
  if (!task || task.status !== 'blocked') return false
  const taskForRecovery = databaseAuthority
    ? await buildEffectiveTask(projectPath, task as Task) as unknown as Record<string, unknown>
    : task
  if (taskForRecovery.recoveryCode !== 'spec_no_progress') return false
  const now = new Date().toISOString()
  if (databaseAuthority) {
    const resolvedEscalations = (Array.isArray(taskForRecovery.escalations) ? taskForRecovery.escalations : [])
      .filter(escalation => (
        escalation && typeof escalation === 'object' &&
        !('resolvedAt' in escalation) &&
        (escalation as Record<string, unknown>).recoveryCode === 'spec_no_progress'
      )) as Array<Record<string, unknown>>
    const promoted = writePromotedTaskDetailMutation(tasksPath, requestedTaskId, {
      projectId: basename(projectPath),
      projectRoot: projectPath,
      mutate: current => {
        if (current.status !== 'blocked' || current.recoveryCode !== 'spec_no_progress') {
          return null
        }
        current.status = 'exploring'
        delete current.blockReason
        delete current.recoveryCode
        current.updatedAt = now
        return current
      },
    })
    if (!promoted) return false
    await upsertTaskRuntimeState(projectPath, requestedTaskId, {
      assignedTo: null,
      openEscalationIds: [],
      updatedAt: now,
    })
    for (const escalation of resolvedEscalations) {
      await appendTaskEvidence(projectPath, requestedTaskId, {
        id: `${String(escalation.id ?? requestedTaskId)}-${now.replace(/[^0-9A-Za-z]/g, '')}`,
        kind: 'escalation',
        recordedAt: now,
        payload: {
          ...escalation,
          resolvedAt: escalation.resolvedAt ?? now,
          resolvedBy: escalation.resolvedBy ?? 'system',
          resolution: escalation.resolution ?? 'Reopened as Guildhall-owned spec timeout recovery before a focused task start.',
        },
      })
    }
    await appendTaskEvidence(projectPath, requestedTaskId, {
      id: `note-${requestedTaskId}-${now.replace(/[^0-9A-Za-z]/g, '')}-spec-timeout-repair`,
      kind: 'note',
      recordedAt: now,
      payload: {
        agentId: 'system',
        role: 'state-repair',
        content: 'Reopened a stale spec-timeout blocker as Guildhall-owned runtime recovery before the focused task start.',
        timestamp: now,
      },
    })
    return true
  }
  task.status = 'exploring'
  task.assignedTo = null
  delete task.blockReason
  delete task.recoveryCode
  task.updatedAt = now
  if (Array.isArray(task.escalations)) {
    task.escalations = task.escalations.map((escalation) => {
      if (!escalation || typeof escalation !== 'object') return escalation
      if ((escalation as { recoveryCode?: unknown }).recoveryCode !== 'spec_no_progress') return escalation
      return {
        ...escalation,
        resolvedAt: (escalation as { resolvedAt?: unknown }).resolvedAt ?? now,
        resolvedBy: (escalation as { resolvedBy?: unknown }).resolvedBy ?? 'system',
        resolution:
          (escalation as { resolution?: unknown }).resolution ??
          'Reopened as Guildhall-owned spec timeout recovery before a focused task start.',
      }
    })
  }
  const notes = Array.isArray(task.notes) ? [...task.notes as Array<Record<string, unknown>>] : []
  notes.push({
    agentId: 'system',
    role: 'state-repair',
    content:
      'Reopened a stale spec-timeout blocker as Guildhall-owned runtime recovery before the focused task start.',
    timestamp: now,
  })
  task.notes = notes
  queue.lastUpdated = now
  writeProjectTaskQueueWithSummary(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
  invalidateTaskQueueReadCaches(tasksPath)
  await upsertTaskRuntimeState(projectPath, requestedTaskId, {
    assignedTo: null,
    openEscalationIds: [],
    updatedAt: now,
  })
  return true
}

async function repairWeakRecoverySpecReviewTask(projectPath: string, requestedTaskId: string): Promise<boolean> {
  const tasksPath = projectTasksPath(projectPath)
  if (!projectTaskStateExistsSync(tasksPath)) return false
  const now = new Date().toISOString()
  if (readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database') {
    const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
    const queue = TaskQueue.parse(queueRead.queue)
    const taskIndex = queue.tasks.findIndex(candidate => candidate.id === requestedTaskId)
    if (taskIndex < 0) return false
    const task = queue.tasks[taskIndex]
    if (!task) return false
    queue.tasks[taskIndex] = TaskSchema.parse(await buildEffectiveTask(projectPath, task, { evidence: 'full' }))
    const repaired = repairWeakRecoverySpecReviewSeedInQueue(queue, {
      taskId: requestedTaskId,
      now,
    })
    if (!repaired) return false
    const repairedTask = queue.tasks.find(candidate => candidate.id === repaired.taskId)
    if (!repairedTask) return false
    const promoted = writePromotedTaskDetailMutation(tasksPath, requestedTaskId, {
      projectId: basename(projectPath),
      projectRoot: projectPath,
      mutate: current => {
        for (const key of ['spec', 'acceptanceCriteria', 'productBrief', 'workUnitAnalysis', 'references', 'releaseIds']) {
          if (key in repairedTask) current[key] = (repairedTask as unknown as Record<string, unknown>)[key]
          else delete current[key]
        }
        current.status = repairedTask.status
        current.updatedAt = now
        return current
      },
    })
    if (!promoted) return false
    const note = Array.isArray(repairedTask.notes) ? repairedTask.notes.at(-1) : undefined
    await appendTaskEvidence(projectPath, requestedTaskId, {
      id: `note-${requestedTaskId}-${now.replace(/[^0-9A-Za-z]/g, '')}-recovery-spec-repair`,
      kind: 'note',
      recordedAt: now,
      payload: note && typeof note === 'object'
        ? note as Record<string, unknown>
        : {
            agentId: 'coordinator-recovery',
            role: 'system',
            content: 'Guildhall repaired the recovery spec from task graph evidence before review continued.',
            timestamp: now,
          },
    })
    return true
  }
  const normalized = await readTaskQueueFileNormalized(tasksPath, { repair: true })
  const queue = {
    version: 1,
    lastUpdated: now,
    tasks: normalized.tasks as Task[],
    releases: normalized.releases,
    ...(normalized.selectedReleaseId ? { selectedReleaseId: normalized.selectedReleaseId } : {}),
  } as TaskQueue
  const taskIndex = queue.tasks.findIndex(candidate => candidate.id === requestedTaskId)
  if (taskIndex < 0) return false
  const task = queue.tasks[taskIndex]
  if (!task) return false
  queue.tasks[taskIndex] = TaskSchema.parse(await buildEffectiveTask(projectPath, task, { evidence: 'full' }))
  const repaired = repairWeakRecoverySpecReviewSeedInQueue(queue, {
    taskId: requestedTaskId,
    now,
  })
  if (!repaired) return false
  const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
  writeProjectTaskQueueWithSummary(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
  invalidateTaskQueueReadCaches(tasksPath)
  return true
}

function projectBriefPath(projectPath: string): string {
  return getProjectSystemStatePath(projectPath, 'project-brief.md')
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
  materializeAttention?: boolean
  taskStateOverride?: TaskQueue
  releaseTruth?: AttentionReleaseTruth | null
  }) {
    if (input.initializationNeeded) {
      return { items: [], blockers: { bootstrap: false, workspaceImport: false } }
    }
    let inboxTaskStateOverride: TaskQueue | null = input.taskStateOverride ?? null
    const tasksPath = projectTasksPath(input.projectPath)
    const databaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
    try {
      if (!inboxTaskStateOverride && readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database') {
        const currentQueue = await readProjectTaskQueue(tasksPath) as {
          tasks?: unknown[]
          releases?: unknown[]
          selectedReleaseId?: string
        } | null
        if (currentQueue) {
          const currentTasks = input.materializeAttention
            ? await buildEffectiveTasks(input.projectPath, currentQueue.tasks as Task[], { evidence: 'current' })
            : currentQueue.tasks as Task[]
          inboxTaskStateOverride = {
            version: 1,
            lastUpdated: new Date().toISOString(),
            tasks: currentTasks as Task[],
            releases: currentQueue.releases as TaskQueue['releases'],
            ...(currentQueue.selectedReleaseId ? { selectedReleaseId: currentQueue.selectedReleaseId } : {}),
          }
        }
      }
      if (!inboxTaskStateOverride) {
        const rawQueue = await readTaskQueueFileNormalized(tasksPath)
        const effectiveTasks = await buildEffectiveTasks(input.projectPath, rawQueue.tasks as Task[])
        inboxTaskStateOverride = {
          ...rawQueue,
          tasks: effectiveTasks as unknown as Task[],
        } as TaskQueue
      }
    } catch {
      /* fall back to raw inbox state rather than breaking the endpoint */
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
  const releaseTruth = input.releaseTruth ?? readProjectSummaryForProjectAtBoundary(input.projectPath)?.releaseSummary ?? null
  const computedItems = attentionItemsForReleaseTruth([
    ...await buildProjectMigrationAdvisories(input.projectPath),
    ...buildProjectUnderstandingAdvisories(input.projectPath),
      ...buildInbox({
      projectPath: input.projectPath,
      ...(inboxTaskStateOverride ? { taskStateOverride: inboxTaskStateOverride } : {}),
      allowMembershipScopeFallback: !databaseAuthority,
      }),
  ].filter(isAttentionOwnedInboxItem), releaseTruth)
  // Ordinary project reads compute their response without creating a new
  // database as a side effect. The service-start projector opts into the
  // durable attention write only for projects that already crossed the
  // database authority boundary.
  const attention = input.materializeAttention &&
    readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
    ? await materializeAttentionProjection({
        projectRoot: input.projectPath,
        openItems: computedItems,
        existingRecords: attentionPreviewHistory.get(input.projectPath),
      })
    : previewAttentionProjection({
        projectRoot: input.projectPath,
        openItems: computedItems,
        existingRecords: attentionPreviewHistory.get(input.projectPath),
      })
  // Keep the request-local history until the project crosses the database
  // authority boundary. Migration application can materialize the same
  // computed Inbox twice: the pre-migration preview must survive so the
  // durable history can preserve its resolved migration record.
  if (input.materializeAttention && readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database') {
    attentionPreviewHistory.delete(input.projectPath)
  } else {
    attentionPreviewHistory.set(input.projectPath, attention.history)
  }
  const history = await activeAttentionHistory(input.projectPath, attention.history)
  const blockers = buildInboxBlockers(attention.openItems)
  return {
    items: attention.openItems.filter(isAttentionOwnedInboxItem),
    history: history.filter(isAttentionOwnedInboxItem),
    blockers,
  }
  }

/**
 * Persist root/child repository observations before any derived diagnostic is
 * published. Git is an external observation, not current project state; the
 * sessions writer is the only place where it becomes a bounded, revisioned
 * project projection.
 */
async function refreshProjectRepositoryObservation(projectRoot: string): Promise<void> {
  const workspaceConfig = readWorkspaceConfig(projectRoot)
  const childProjects = workspaceConfig.kind === 'workspace'
    ? resolveWorkspaceProjectPathsOrDiscover(projectRoot, workspaceConfig)
    : discoverChildGitProjects(projectRoot)
  const roots = childProjects.length > 0
    ? childProjects.map(child => ({ id: child.id, label: child.label ?? child.id, path: child.path }))
    : [{ id: 'workspace', label: basename(projectRoot), path: projectRoot }]
  const driver = new NodeGitDriver()
  const snapshots = await Promise.all(roots.map(root => inspectGitStory(driver, {
    repoRoot: root.path,
    repoId: root.id,
    repoLabel: root.label,
    inspectedPath: root.path,
    inspectPr: false,
  })))
  const repositories: ProjectStateDatabaseRepository[] = await Promise.all(snapshots.map(async snapshot => {
    const head = await execFileP('git', ['rev-parse', 'HEAD'], {
      cwd: snapshot.repoRoot,
      timeout: 750,
      maxBuffer: 4 * 1024,
    }).then(result => result.stdout.trim() || null).catch(() => null)
    return {
      id: `repo:${snapshot.repoId ?? snapshot.repoRoot}`,
      root: snapshot.repoRoot,
      ...(snapshot.branch ? { branch: snapshot.branch } : {}),
      ...(head ? { head } : {}),
      status: snapshot.state,
      freshness: 'current',
      inspectedAt: snapshot.inspectedAt,
      payload: {
        state: snapshot.state,
        ...(snapshot.upstream ? { upstream: snapshot.upstream } : {}),
        ahead: snapshot.ahead,
        behind: snapshot.behind,
        changedCount: snapshot.changedCount,
        untrackedCount: snapshot.untrackedCount,
        samplePaths: snapshot.samplePaths.slice(0, 12),
        reason: snapshot.reason,
        nextAction: snapshot.nextAction,
      },
    }
  }))
  replaceProjectStateDatabaseRepositories(projectRoot, repositories)
}

async function refreshProjectProjections(
  projectRoot: string,
  _event: ProjectProjectionInvalidation | undefined,
  options: {
    supervisor: OrchestratorSupervisor
    refreshDiagnostic?: (projectRoot: string) => Promise<void>
  },
): Promise<void> {
    const resolved = resolveProject(projectRoot)
    if (resolved.initializationNeeded) return
    const tasksPath = projectTasksPath(resolved.path)
    const databaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
    const claimedJobs = databaseAuthority
      ? claimProjectStateDatabaseProjectionJobs(resolved.path, { limit: 16 })
      : []
    const eventDomains = new Set(_event?.domains ?? [])
    const domains = new Set([
      ...(_event?.domains ?? []),
      ...claimedJobs.map(job => job.domain === 'summary' ? 'queue' : job.domain),
    ])
    const threadOnly = domains.size > 0 && [...domains].every(domain => domain === 'thread')
    const attentionOnly = eventDomains.size > 0 && [...eventDomains].every(domain => domain === 'reconciliation')
    const attentionAlreadyProjected = eventDomains.size > 0 && [...eventDomains].every(domain => domain === 'attention')
    const shouldRefreshRepositories = databaseAuthority && !threadOnly && !attentionOnly && (
      domains.has('repository') ||
      domains.has('diagnostics')
    )
    const failClaimedJobs = (error: unknown): void => {
      const message = error instanceof Error ? error.message : String(error)
      for (const job of claimedJobs) failProjectStateDatabaseProjectionJob(resolved.path, job.id, message)
    }
    try {
      if (threadOnly) {
        const projection = await refreshCurrentThreadProjection(resolved.path, {
          runStatus: options.supervisor.get(resolved.id)?.status ?? 'stopped',
          recentEvents: options.supervisor.recent(resolved.id, undefined, resolved.path),
        })
        if (!projection) throw new Error('Current Thread projection source changed during refresh')
        return
      }
      let taskStateOverride: TaskQueue | undefined
      let fleetAttentionItems: readonly AttentionRecord[] | null = null
      if (shouldRefreshRepositories) {
        await refreshProjectRepositoryObservation(resolved.path)
      }
      if (!attentionOnly) {
      const compactRefreshDomains = new Set([
        // Current evidence is already reduced into work_items.summary_json by
        // the authoritative evidence transaction. Re-projecting from those
        // points keeps proof/readiness cheap without reopening task detail or
        // treating evidence prose as a second source of truth.
        'queue', 'scope', 'release', 'delivery', 'evidence', 'attention', 'reconciliation', 'thread', 'diagnostics', 'memory',
      ])
      // A stale or newly-versioned summary is still a compact projection
      // concern. Rebuild it from indexed rows first; summary freshness must
      // not promote an ordinary card refresh into a full task/evidence read.
      const needsDetailProjection = !databaseAuthority ||
        domains.has('legacy') ||
        [...domains].some(domain => !compactRefreshDomains.has(domain))
      if (databaseAuthority && !needsDetailProjection) {
        // Promoted projects already have the facts needed for Summary/Action/
        // Release in indexed rows. Do not reopen rich task detail or expand
        // every task's runtime/evidence overlay just to refresh a card.
        const queueRead = readProjectTaskQueueAtBoundaryWithRevision(tasksPath)
        const queue = queueRead.definition as { tasks?: unknown[]; lastUpdated?: string; releases?: unknown[]; selectedReleaseId?: string } | null
        const queueRevision = queueRead.revision
        const indexedProjection = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
          projectId: resolved.id,
          sourceQueueLastUpdated: queue?.lastUpdated ?? null,
          ...(queueRevision !== null ? { expectedQueueRevision: queueRevision } : {}),
        })
        if (!indexedProjection && queue) {
          // A missing compact summary is a projection bootstrap, not a reason
          // to reconstruct detail. The compact queue is enough to seed it.
          writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
            projectId: resolved.id,
            projectRoot: resolved.path,
            queue,
            projectionTasks: queue.tasks as Task[],
            ...(queueRevision !== null ? { expectedQueueRevision: queueRevision } : {}),
            queueCommit: false,
          })
        }
      } else {
        // Runtime/legacy invalidations can change scoped readiness and proof
        // blockers. Rebuild those facts in the asynchronous write projector,
        // never in the request that is serving a card. Evidence stays on the
        // compact path above because its current proof point is materialized
        // in the same authoritative transaction that records the event.
        const queueRead = databaseAuthority ? readProjectTaskQueueAtBoundaryWithRevision(tasksPath) : null
        const queue = queueRead?.definition ?? await readProjectTaskQueue(tasksPath)
        if (queue !== null && queue !== undefined) {
          const parsedQueue = TaskQueue.safeParse(queue)
          const projectionTasks = databaseAuthority && parsedQueue.success
            ? await buildEffectiveTasks(resolved.path, parsedQueue.data.tasks, { evidence: 'current' })
            : undefined
          if (projectionTasks && parsedQueue.success) {
            taskStateOverride = {
              ...parsedQueue.data,
              tasks: projectionTasks as unknown as Task[],
            }
          }
          writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
            projectId: resolved.id,
            projectRoot: resolved.path,
            queue,
            projectionTasks: projectionTasks as unknown as Task[] | undefined,
            ...(queueRead ? { expectedQueueRevision: queueRead.revision } : {}),
            ...(databaseAuthority ? { queueCommit: false } : {}),
          })
        }
      }
      }
      const shouldRefreshMemoryHealth = databaseAuthority && (
        domains.size === 0 ||
        domains.has('memory') ||
        domains.has('queue') ||
        domains.has('scope') ||
        domains.has('release')
      )
      if (shouldRefreshMemoryHealth) {
        // Capture the task ids and revision from the same bounded sessions
        // snapshot. The projector may inspect raw memory sources, but it may
        // never pair those results with a queue read from another revision.
        const memoryRead = readProjectMemoryHealthSourceAtBoundary(tasksPath)
        const projectRevision = memoryRead?.projectRevision ?? null
        if (memoryRead?.authority === 'database' && projectRevision !== null) {
          const health = await buildProjectMemoryHealthProjection(
            resolved.path,
            memoryRead.taskIds.map(id => ({ id })),
          )
          writeProjectStateDatabaseMemoryHealth(resolved.path, {
            sourceRevision: projectRevision,
            freshness: 'current',
            generatedAt: new Date().toISOString(),
            payload: health,
          })
        }
      }
      if (databaseAuthority) {
        const deliveryProjectionDomains = new Set([
          'queue', 'scope', 'release', 'delivery', 'evidence', 'task-runtime',
          'workspace', 'reconciliation', 'legacy', 'diagnostics',
        ])
        const needsDeliveryProjection = domains.size === 0 ||
          [...domains].some(domain => deliveryProjectionDomains.has(domain))
        if (needsDeliveryProjection) {
          const deliveryProjection = await refreshProjectDeliveryReadProjection(resolved.path)
          if (deliveryProjection.status !== 'current') {
            throw new Error(`Delivery projection refresh did not produce current state: ${deliveryProjection.reason ?? 'unknown error'}`)
          }
        }
      }
      const diagnosticDomains = new Set([
        PROJECT_STATE_DATABASE_DIAGNOSTIC_PROJECTION_DOMAIN, 'queue', 'scope', 'release', 'task-runtime',
        'workspace', 'evidence', 'repository', 'config', 'legacy',
      ])
      // Diagnostics are an optional, Git-backed detail projection. A default
      // startup refresh already builds the compact summary; running the
      // diagnostic pass here would expand effective tasks and inspect every
      // repository a second time before the fleet is usable.
      const shouldRefreshDiagnostics = databaseAuthority && (
        [...domains].some(domain => diagnosticDomains.has(domain))
      )
      // Keep the current Thread projection independent from the attention
      // projection. A repair or stale-input failure in one read model must not
      // leave the other model missing and make the UI look empty.
      const threadProjection = await refreshCurrentThreadProjection(resolved.path, {
        runStatus: options.supervisor.get(resolved.id)?.status ?? 'stopped',
        recentEvents: options.supervisor.recent(resolved.id, undefined, resolved.path),
      })
      if (!threadProjection) throw new Error('Current Thread projection source changed during refresh')
      if (!attentionAlreadyProjected) {
        const attentionSnapshot = await buildProjectInboxSnapshot({
          projectPath: resolved.path,
          initializationNeeded: resolved.initializationNeeded,
          coordinatorCount: resolved.config?.coordinators?.length ?? 0,
          materializeAttention: true,
          ...(taskStateOverride ? { taskStateOverride } : {}),
        })
        fleetAttentionItems = attentionSnapshot.items
      }
      if (shouldRefreshDiagnostics && options.refreshDiagnostic) {
        await options.refreshDiagnostic(resolved.path)
      }
      // The machine fleet is a consumer of the same saved project summary,
      // never a second summarizer. Publish only after the project projections
      // above have committed so fleet cards point at the completed revision.
      const fleetAuthority = readProjectStateAuthorityAtBoundary(tasksPath)
      const fleetSummary = summarizeProjectFromProjection(
        { id: resolved.id, path: resolved.path },
        resolved,
        options.supervisor.get(resolved.id),
      )
      const savedAttention = fleetAttentionItems
        ? fleetAttentionProjection(fleetAttentionItems)
        : (() => {
            const attention = readSavedAttentionSurface(
              resolved.path,
              resolved.initializationNeeded,
              readProjectSummaryForProjectAtBoundary(resolved.path)?.releaseSummary ?? null,
            )
            return attention.freshness === 'current'
              ? fleetAttentionProjection(attention.items)
              : { items: [], total: 0, freshness: 'missing' as const }
          })()
      const compactFleetSummary = compactFleetSummaryPayload({
        ...fleetSummary,
        fleetAttention: savedAttention,
      })
      publishFleetSummaryProjection({
        projectId: resolved.id,
        projectPath: resolved.path,
        sourceProjectRevision: fleetAuthority.projectRevision,
        sourceQueueRevision: fleetAuthority.queueRevision,
        state: 'current',
        payload: compactFleetSummary,
      })
    } catch (error) {
      try {
        markFleetSummaryErrorAtBoundary({
          projectId: resolved.id,
          projectPath: resolved.path,
          ...(typeof _event?.revision === 'number' ? { sourceProjectRevision: _event.revision } : {}),
          error: error instanceof Error ? error.message : String(error),
        })
      } catch {
        // A fleet-index failure must not hide the original project refresh
        // failure or turn a background repair into a request-time problem.
      }
      failClaimedJobs(error)
      throw error
    }
  }

async function activeAttentionHistory(projectPath: string, history: readonly AttentionRecord[]): Promise<AttentionRecord[]> {
  const tasksPath = projectTasksPath(projectPath)
  const authority = readProjectStateAuthorityAtBoundary(tasksPath).authority
  const taskQueue = await readProjectTaskQueue(tasksPath).catch(() => null) as { tasks?: Array<Record<string, unknown>> } | null
  const tasks = authority === 'database'
    ? taskQueue?.tasks ?? []
    : taskQueue?.tasks ?? await readTasksFileNormalized(tasksPath).catch(() => [])
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
  emitProjectSummaryInvalidation(projectPath, 'wizard-state-write', { domains: ['thread'] })
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

function summarizeProjectFromProjection(
  entry: { id: string; path: string },
  project: ResolvedProject,
  run?: ReturnType<OrchestratorSupervisor['list']>[number],
  projectionOverride?: ProjectSummaryProjection | null,
): ServiceProjectSummary {
  const shell = summarizeProjectShell(project, run)
  const projection = projectionOverride === undefined
    ? readProjectSummaryShellAtBoundary(entry.path).summary
    : projectionOverride
  const summaryFreshness = projection?.freshness ?? 'missing'
  if (!projection || projection.freshness !== 'current') {
    return {
      ...shell,
      projectStatusLoading: false,
      summaryFreshness,
      projectStatusError: projection?.freshness === 'stale'
        ? 'The saved project summary is stale. Run the project-summary migration before relying on fleet status.'
        : 'The saved project summary is not available yet. Run the project-summary migration before relying on fleet status.',
      ...(projection ? {
        taskCounts: {
          total: projection.counts.total,
          active: projection.counts.active,
          draftReview: projection.counts.draftReview,
          blocked: projection.counts.blocked,
          done: projection.counts.done,
          shelved: projection.counts.shelved,
        },
        workProgress: workProgressFromProjectSummaryProjection(projection),
        releaseSummary: projection.releaseSummary,
        ...(projection.execution ? { execution: projection.execution } : {}),
        ...(projection.runtime ? { runtime: projection.runtime } : {}),
        ...(projection.ownerInput ? { ownerInput: projection.ownerInput } : {}),
      } : {}),
    }
  }

  const savedStartReadiness = applyOwnerInputToStartReadiness({
    canStart: projection.nextAction.code === 'ready_work' || projection.nextAction.code === 'paused_live_work',
    label: projection.nextAction.label as ProjectScopeProjection['start']['label'],
    ...(projection.nextAction.code ? { code: projection.nextAction.code } : {}),
    message: projection.nextAction.message,
    ...(typeof projection.nextAction.count === 'number' ? { count: projection.nextAction.count } : {}),
    actionHref: projection.scope ? `/projects/${encodeURIComponent(project.id)}/work${projection.nextAction.focusTaskId ? `?task=${encodeURIComponent(projection.nextAction.focusTaskId)}` : ''}` : '/work',
    ...(projection.nextAction.focusTaskId ? { focusTaskId: projection.nextAction.focusTaskId } : {}),
    ...(projection.nextAction.focusTaskTitle ? { focusTaskTitle: projection.nextAction.focusTaskTitle } : {}),
    ...(projection.nextAction.focusKind ? { focusKind: projection.nextAction.focusKind as ProjectScopeProjection['start']['focusKind'] } : {}),
    executionScope: projection.scope
      ? {
          id: projection.scope.id,
          label: projection.scope.label,
          kind: projection.scope.kind as ProjectScope['kind'],
          source: projection.scope.source as ProjectScope['source'],
          taskCount: projection.scope.included,
          deferredTaskCount: projection.scope.deferred,
        }
      : undefined,
  }, projection.ownerInput)
  const startReadiness = applyRunStatusToStartReadiness(
    savedStartReadiness,
    run?.status ?? projection.execution?.status,
  )
  const actionModel = run
    ? buildProjectActionModel({
      startReadiness,
      ownerInput: projection.ownerInput && projection.ownerInput.openCount > 0
        ? {
            active: true,
            label: 'Answer in Thread',
            detail: projection.ownerInput.next?.prompt ?? 'Open the thread to answer the current question.',
            href: projection.ownerInput.next?.href ?? '/thread',
          }
        : null,
      // A live supervisor is the freshest operational observation. After a
      // restart, the compact execution row is the only durable status; falling
      // back to "stopped" would make the action model disagree with the saved
      // project state until another run event arrived.
      runStatus: run.status,
      runMode: run.mode,
      tasks: [
        ...(projection.nextAction.focusTaskId
          ? [{
              taskId: projection.nextAction.focusTaskId,
              title: projection.nextAction.focusTaskTitle ?? projection.nextAction.focusTaskId,
              status: projection.nextAction.code === 'ready_work' ? 'ready' : 'blocked',
            }]
          : []),
        ...projection.recentWork,
      ].filter((task, index, all) => all.findIndex(candidate => candidate.taskId === task.taskId) === index).map(task => ({
        id: task.taskId,
        title: task.title,
        status: task.status,
      })),
    })
    : projection.actionModel ?? buildProjectActionModel({
    startReadiness,
    ownerInput: projection.ownerInput && projection.ownerInput.openCount > 0
      ? {
          active: true,
          label: 'Answer in Thread',
          detail: projection.ownerInput.next?.prompt ?? 'Open the thread to answer the current question.',
          href: projection.ownerInput.next?.href ?? '/thread',
        }
      : null,
    // A live supervisor is the freshest operational observation. After a
    // restart, the compact execution row is the only durable status; falling
    // back to "stopped" would make the action model disagree with the saved
    // project state until another run event arrived.
    runStatus: projection.execution?.status ?? 'stopped',
    runMode: projection.execution?.mode,
    tasks: [
      ...(projection.nextAction.focusTaskId
        ? [{
            taskId: projection.nextAction.focusTaskId,
            title: projection.nextAction.focusTaskTitle ?? projection.nextAction.focusTaskId,
            status: projection.nextAction.code === 'ready_work' ? 'ready' : 'blocked',
          }]
        : []),
      ...projection.recentWork,
    ].filter((task, index, all) => all.findIndex(candidate => candidate.taskId === task.taskId) === index).map(task => ({
      id: task.taskId,
      title: task.title,
      status: task.status,
    })),
  })
  return {
    ...shell,
    projectStatusLoading: false,
    summaryFreshness,
    taskCounts: {
      total: projection.counts.total,
      active: projection.counts.active,
      draftReview: projection.counts.draftReview,
      blocked: projection.counts.blocked,
      done: projection.counts.done,
      shelved: projection.counts.shelved,
    },
    workProgress: workProgressFromProjectSummaryProjection(projection),
    ...(projection.releaseSummary ? { releaseSummary: projection.releaseSummary } : {}),
    ...(projection.execution ? { execution: projection.execution } : {}),
    ...(projection.runtime ? { runtime: projection.runtime } : {}),
    ...(projection.ownerInput ? { ownerInput: projection.ownerInput } : {}),
    highlights: {
      activeTaskTitle: projection.recentWork.find(task => ['in_progress', 'review', 'gate_check', 'exploring'].includes(task.status))?.title ?? null,
      blockedTaskTitle: projection.recentWork.find(task => task.status === 'blocked')?.title ?? null,
      recentCompletedTaskTitle: projection.recentWork.find(task => task.status === 'done')?.title ?? null,
    },
    startReadiness,
    actionModel,
  }
}

function unavailableFleetProjectSummary(
  entry: { id: string; path: string; name?: string; tags?: string[]; initializationNeeded?: boolean },
  run?: ReturnType<OrchestratorSupervisor['list']>[number],
  error?: unknown,
): ServiceProjectSummary {
  return {
    id: entry.id,
    path: entry.path,
    name: entry.name ?? entry.id,
    initializationNeeded: entry.initializationNeeded ?? false,
    ...(entry.tags ? { tags: entry.tags } : {}),
    projectStatusLoading: false,
    summaryFreshness: 'error',
    projectStatusError: error instanceof Error && error.message.trim()
      ? `Could not load this project summary: ${error.message.trim()}`
      : 'Could not load this project summary. Open the project to inspect it.',
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

function readFleetProjectSummaries(
  entries: Array<{ id: string; path: string; name?: string; tags?: string[]; initializationNeeded?: boolean }>,
  runsById: Map<string, ReturnType<OrchestratorSupervisor['list']>[number]>,
): ServiceProjectSummary[] {
  const page = readFleetSummaryProjectionPageAtBoundary({
    projectIds: entries.map(entry => entry.id),
    limit: entries.length,
  })
  const rows = new Map(page.rows.map(row => [row.projectId, row]))
  const freshnessByState: Record<string, NonNullable<ServiceProjectSummary['summaryFreshness']>> = {
    current: 'current',
    stale: 'stale',
    error: 'error',
    unavailable: 'missing',
  }

  return entries.map(entry => {
    try {
      const run = runsById.get(entry.id)
      const row = rows.get(entry.id)
      if (!row) {
        if (entry.initializationNeeded) {
          return {
            id: entry.id,
            path: entry.path,
            name: entry.name ?? entry.id,
            initializationNeeded: true,
            projectStatusLoading: false,
            summaryFreshness: 'missing',
            projectStatusError: 'Project setup is not complete.',
            ...(entry.tags ? { tags: entry.tags } : {}),
          }
        }
        const missing = unavailableFleetProjectSummary(
          entry,
          run,
          page.databaseError
            ? new Error(`Fleet summary store unavailable: ${page.databaseError}`)
            : new Error('Saved fleet summary is not available yet.'),
        )
        if (page.databaseError) return missing
        return {
          ...missing,
          summaryFreshness: 'missing',
          projectStatusError: 'Saved fleet summary is not available yet. Background refresh will populate it.',
        }
      }

      const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? row.payload as ServiceProjectSummary
        : null
      if (!payload) {
        return unavailableFleetProjectSummary(
          entry,
          run,
          new Error(row.error ?? 'Saved fleet summary payload is invalid.'),
        )
      }

      const summary: ServiceProjectSummary = {
        ...payload,
        projectStatusLoading: false,
        summaryFreshness: freshnessByState[row.state] ?? 'error',
        ...(row.state === 'current'
          ? {}
          : {
              projectStatusError: row.error
                ?? payload.projectStatusError
                ?? 'The saved fleet summary needs a background refresh.',
            }),
      }
      if (run) {
        summary.run = {
          status: run.status,
          startedAt: run.startedAt,
          stoppedAt: run.stoppedAt,
          error: run.error,
          stopSummary: run.stopSummary,
          providerStatus: run.providerStatus,
        }
        if (summary.startReadiness && summary.actionModel) {
          const liveReadiness = applyRunStatusToStartReadiness(summary.startReadiness, run.status)
          const liveAction = buildProjectActionModel({
            startReadiness: liveReadiness,
            runStatus: run.status,
            runMode: (run as { mode?: string }).mode,
            tasks: summary.startReadiness.focusTaskId
              ? [{
                  id: summary.startReadiness.focusTaskId,
                  title: summary.startReadiness.focusTaskTitle,
                  status: run.status === 'running' ? 'in_progress' : 'ready',
                }]
              : [],
          })
          summary.startReadiness = liveReadiness
          summary.actionModel = {
            ...summary.actionModel,
            runControl: liveAction.runControl,
          }
        }
      }

      // Registration owns identity and presentation metadata. The saved fleet
      // row owns project state; no request-time project database read is allowed
      // on this fleet route.
      return {
        ...summary,
        id: entry.id,
        path: entry.path,
        ...(entry.name ? { name: entry.name } : {}),
        ...(entry.tags ? { tags: entry.tags } : {}),
        ...(entry.initializationNeeded !== undefined
          ? { initializationNeeded: entry.initializationNeeded }
          : {}),
      }
    } catch (error) {
      return unavailableFleetProjectSummary(entry, runsById.get(entry.id), error)
    }
  })
}

function publishFleetSummaryFromSavedState(
  entry: { id: string; path: string; name?: string; tags?: string[] },
  run?: ReturnType<OrchestratorSupervisor['list']>[number],
): void {
  const resolved = resolveProject(entry.path)
  if (resolved.initializationNeeded) {
    publishFleetSummaryProjection({
      projectId: entry.id,
      projectPath: entry.path,
      sourceProjectRevision: null,
      sourceQueueRevision: null,
      state: 'unavailable',
      payload: {
        id: entry.id,
        path: entry.path,
        name: entry.name ?? entry.id,
        tags: entry.tags ?? [],
        initializationNeeded: true,
        projectStatusLoading: false,
        summaryFreshness: 'missing',
      },
      error: 'Project setup is not complete.',
    })
    return
  }
  const tasksPath = projectTasksPath(entry.path)
  const authority = readProjectStateAuthorityAtBoundary(tasksPath)
  const shell = readProjectSummaryShellAtBoundary(entry.path).summary
  const basePayload = summarizeProjectFromProjection(entry, resolved, run, shell)
  const attention = readSavedAttentionSurface(
    entry.path,
    resolved.initializationNeeded,
    shell?.releaseSummary ?? null,
  )
  const payload = compactFleetSummaryPayload({
    ...basePayload,
    fleetAttention: attention.freshness === 'current'
      ? fleetAttentionProjection(attention.items)
      : { items: [], total: 0, freshness: 'missing' as const },
  })
  publishFleetSummaryProjection({
    projectId: entry.id,
    projectPath: entry.path,
    sourceProjectRevision: authority.projectRevision,
    sourceQueueRevision: authority.queueRevision,
    state: shell?.freshness === 'current' ? 'current' : shell ? 'stale' : 'unavailable',
    payload: {
      ...payload,
    },
    ...(shell ? {} : { error: 'The saved project summary is not available yet.' }),
  })
}

function workProgressFromProjectSummaryProjection(
  projection: ProjectSummaryProjection,
): ServiceProjectSummary['workProgress'] {
  const counts = {
    visibleTotal: projection.counts.total,
    visibleActive: projection.counts.active,
    visibleBlocked: projection.counts.blocked,
    visibleDone: projection.counts.done,
    visibleShelved: projection.counts.shelved,
    deliveryTotal: 0,
    deliveryRequired: 0,
    deliveryDone: 0,
    deliveryBlocked: 0,
  }
  const selected = projection.releaseSummary.counts
  return {
    counts,
    ...(projection.releaseSummary.scopeMode !== 'unavailable' ? {
      selectedCounts: {
        visibleTotal: selected.total,
        visibleActive: selected.active,
        visibleBlocked: selected.blocked,
        visibleDone: selected.done,
        visibleShelved: 0,
        deliveryTotal: 0,
        deliveryRequired: 0,
        deliveryDone: 0,
        deliveryBlocked: 0,
      },
    } : {}),
    byTaskId: {},
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
  // Design-system gating belongs to the structured work contract. Task
  // titles, descriptions, specs, and briefs are model-authored display prose;
  // changing their vocabulary must not change whether a release is blocked.
  return tasks.some(task => task.workShape === 'ui-component' || task.workShape === 'frontend-integration')
}

type ReleaseBlockerSummary = {
  id: string
  title: string
  label: string
  code?: string
  reason?: string
  nextAction?: string
  state?: string
  repoId?: string
  repoLabel?: string
  taskId?: string
}

function summarizeScopedReleaseWork(
  tasks: Task[],
  scope: OrientationScope | null | undefined,
  options: {
    proofStyle?: 'script_only' | 'manual' | 'mixed' | 'unspecified'
    commandProofRequired?: boolean
    scopeRows?: readonly ProjectStateDatabaseScopeRow[]
  } = {},
): {
  statusCounts: Record<string, number>
  openEscalations: Array<{ taskId: string; taskTitle: string; escalationId: string; reason: string; summary: string }>
  incompleteBriefs: Array<{ id: string; title: string; reason: string }>
  unapprovedBriefs: Array<{ id: string; title: string }>
  unapprovedSpecs: Array<{ id: string; title: string }>
  shelvedUnclaimed: Array<{ id: string; title: string; detail?: string }>
  blockedByAgent: Array<{ id: string; title: string; reason?: string }>
  proofMissingDoneTasks: Array<{ id: string; title: string }>
  releaseBlockers: ReleaseBlockerSummary[]
  humanBlockingCount: number
  unfinishedCount: number
  scopedTasks: Task[]
  gitStoryTasks: Task[]
} {
  const effectiveReleaseStatus = (task: Task): string =>
    effectiveTaskStatus(task) ?? String((task as { status?: string }).status ?? 'unknown')
  const taskMissingModeledProofExpectation = (task: Task): boolean =>
    options.commandProofRequired === true &&
    String((task as { status?: string }).status ?? '') === 'done' &&
    !taskHasScriptProofPath(task)
  const scopeProofStyle = options.proofStyle ?? (options.commandProofRequired === true ? 'script_only' : undefined)
  const proofSatisfiedByLinkedChildren = (task: Task): boolean =>
    taskCompletionProofSatisfiedByLinkedChildren(task, tasks, scopeProofStyle, scope)
  const completionProofSupersedesEscalation = (
    task: Task,
    escalation: { raisedAt?: string },
  ): boolean => {
    const proofAt = latestRecordedCompletionProofAt(task)
    if (!proofAt || !escalation.raisedAt) return false
    return Date.parse(proofAt) > Date.parse(escalation.raisedAt)
  }
  const proofRecoverySupersedesEscalation = (
    task: Task,
    escalation: { reason?: string },
  ): boolean => {
    if (escalation.reason !== 'max_revisions_exceeded') return false
    const proofRecovery = (task as Task & { proofRecovery?: { kind?: unknown } }).proofRecovery
    return proofRecovery?.kind === 'proof' && task.recoveryCode !== 'max_revisions_actionable'
  }
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const scopeProjection = options.scopeRows
    ? null
    : buildProjectScopeProjection(
        { tasks, releases: [] },
        { selectedScope: scope as ProjectScope | null | undefined },
      )
  const persistedScopeRows: ProjectScopeRow[] | null = options.scopeRows
    ? options.scopeRows.map(row => {
        const task = tasksById.get(row.taskId)
        return normalizeProjectScopeRowReadModel({
          taskId: row.taskId,
          title: task?.title ?? row.taskId,
          ...(task?.hierarchy?.parentId ? { parentTaskId: task.hierarchy.parentId } : {}),
          scope: row.scope,
          countInProjectTotals: row.countInProjectTotals !== false,
          eligibilityReason: row.eligibilityReason as ProjectScopeRow['eligibilityReason'],
          hierarchyRole: row.hierarchyRole as ProjectScopeRow['hierarchyRole'],
          status: (effectiveTaskStatus(task) ?? task?.status ?? 'unknown') as ProjectScopeRow['status'],
          handoffState: row.handoffState as ProjectScopeRow['handoffState'],
          blocksStart: row.blocksStart,
          blocksRelease: row.blocksRelease,
          humanBlocking: row.humanBlocking,
          proofBlocked: row.proofBlocked ?? false,
          ...(row.blockerSummary ? { blockerSummary: row.blockerSummary } : {}),
          sourceRefs: [...row.sourceRefs],
        })
      })
    : null
  const currentScopeRows = persistedScopeRows ?? scopeProjection!.rows
  // The shared scope projection is the only authority for current-scope
  // membership and hierarchy suppression. Do not re-derive a second scoped
  // task list here; that was how rich release detail drifted from the saved
  // release rows in the first place.
  const tasksByScopeRowId = new Map(currentScopeRows.map(row => [row.taskId, row] as const))
  const executionScopedTasks = executionScopeRows(currentScopeRows)
    .filter(row => row.scope === 'included')
    .map(row => tasksById.get(row.taskId))
    .filter((task): task is Task => Boolean(task))
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
      .filter(child => tasksByScopeRowId.get(child.id)?.scope === 'included')
      .filter(child => !['archived', 'cancelled', 'shelved'].includes(String(child.status ?? '')))
      .filter(child => deriveTaskWorkVisibility(child, task).countInProjectTotals)
  }
  // executionScopeRows is the shared execution boundary. It suppresses
  // completed internal steps while retaining an active planning child as the
  // representative unit of work, so Release detail and compact summaries use
  // the same rows without a second visibility filter here.
  const scopedTasks = executionScopedTasks
  const statusCounts: Record<string, number> = {}
  const openEscalations: Array<{ taskId: string; taskTitle: string; escalationId: string; reason: string; summary: string }> = []
  const incompleteBriefs: Array<{ id: string; title: string; reason: string }> = []
  const unapprovedBriefs: Array<{ id: string; title: string }> = []
  const unapprovedSpecs: Array<{ id: string; title: string }> = []
  const shelvedUnclaimed: Array<{ id: string; title: string; detail?: string }> = []
  const blockedByAgent: Array<{ id: string; title: string; reason?: string }> = []
  const proofMissingDoneTasks: Array<{ id: string; title: string }> = []
  const releaseBlockersById = new Map<string, ReleaseBlockerSummary>()
  const escalationKeys = new Set<string>()
  const terminalStatuses = new Set(['done', 'shelved', 'cancelled', 'archived', 'pending_pr'])
  let unfinishedCount = 0

  const addReleaseBlocker = (blocker: ReleaseBlockerSummary) => {
    if (!releaseBlockersById.has(blocker.id)) releaseBlockersById.set(blocker.id, blocker)
  }
  const blockerSubject = (title: string) => title.trim().replace(/[.?!:;,\s]+$/g, '')
  const escalationKey = (taskId: string, reason: string, summary: string) => [
    taskId.trim(),
    (reason ?? '').trim().toLowerCase(),
    (summary ?? '').trim().replace(/\s+/g, ' ').toLowerCase(),
  ].join('\0')
  const blockedScopedTasks = executionScopedTasks.filter(task =>
    String(task.status ?? '') === 'blocked' || activeEscalations(task).length > 0,
  )
  const proofMissingTaskIsDuplicateOfBlockedWork = (task: Task): boolean => blockedScopedTasks.some(blocked => {
    if (blocked.id === task.id) return false
    const blockedIdentity = explicitTaskStructuralIdentity(blocked)
    const taskIdentity = explicitTaskStructuralIdentity(task)
    // Proof suppression is a state decision. A rewritten title must not make
    // two work records look like duplicates; only an explicit source-owned
    // identity can establish that relationship.
    return Boolean(blockedIdentity && taskIdentity && blockedIdentity === taskIdentity)
  })
  for (const t of scopedTasks) {
    const status = effectiveReleaseStatus(t)
    statusCounts[status] = (statusCounts[status] ?? 0) + 1
    if (!terminalStatuses.has(status)) unfinishedCount += 1
  }

  for (const t of executionScopedTasks) {
    const status = effectiveReleaseStatus(t)
    const id = String((t as { id?: string }).id ?? '')
    const title = String((t as { title?: string }).title ?? id)
    const planningOnly = tasksByScopeRowId.get(id)?.countInProjectTotals === false
    // Hidden decomposition children can still require a human spec review,
    // but completed internal steps must not create duplicate proof blockers.
    if (planningOnly && status !== 'spec_review') continue
    const brief = (t as { productBrief?: { approvedAt?: string } }).productBrief
    const terminal = terminalStatuses.has(status)
    const reservedImportTask = id === WORKSPACE_IMPORT_TASK_ID
    const approvalPendingStatus = status === 'proposed' || status === 'ready'
    const hasMaterializedChildWork = inScopeMaterializedChildren(t).length > 0
    const hasWorkerReadySpec = status === 'ready' && hasSpecDraftRecord(t)
    const shapingBlockers = taskShapingBlockers(t)
    if (
      shapingBlockers.length > 0 &&
      !terminal &&
      !reservedImportTask &&
      !hasMaterializedChildWork
    ) {
      const reason = shapingBlockers[0]?.summary ?? 'Current work needs shaping before Guildhall can build unattended.'
      incompleteBriefs.push({ id, title, reason })
      addReleaseBlocker({ id, title, code: 'imported_scope_shaping', label: `${blockerSubject(title)} needs shaping before unattended work can start.` })
      continue
    }
    if (
      status === 'done' &&
      (taskDoneButProofMissing(t) || taskMissingModeledProofExpectation(t)) &&
      !proofSatisfiedByLinkedChildren(t)
    ) {
      if (!proofMissingTaskIsDuplicateOfBlockedWork(t)) {
        proofMissingDoneTasks.push({ id, title })
        addReleaseBlocker({ id, title, code: 'proof_evidence_missing', label: `${blockerSubject(title)} needs proof evidence before the release is complete.` })
      }
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
        addReleaseBlocker({ id, title, code: 'brief_approval_required', label: `${blockerSubject(title)} is waiting for brief approval.` })
      } else {
        const reason = 'Task brief needs user job, why it matters now, success metric, and at least one non-goal before approval.'
        incompleteBriefs.push({ id, title, reason })
        addReleaseBlocker({ id, title, code: 'brief_cleanup', label: `${blockerSubject(title)} needs brief cleanup before approval.` })
      }
    }
    if (status === 'spec_review') {
      unapprovedSpecs.push({ id, title })
      addReleaseBlocker({ id, title, code: 'spec_review_required', label: `${blockerSubject(title)} is waiting for spec review.` })
    }
    if (status === 'shelved') {
      const reason = (t as { shelveReason?: { detail?: string } }).shelveReason
      shelvedUnclaimed.push({ id, title, ...(reason?.detail ? { detail: reason.detail } : {}) })
    }
    if (status === 'blocked') {
      const reason = taskBlockerSummary(t)
      blockedByAgent.push({ id, title, ...(reason ? { reason } : {}) })
      addReleaseBlocker({ id, title, code: 'blocked', label: reason?.trim() || `${blockerSubject(title)} is blocked.` })
    }
    for (const e of activeEscalations(t).filter(e =>
      !completionProofSupersedesEscalation(t, e) &&
      !proofRecoverySupersedesEscalation(t, e)
    )) {
      const key = escalationKey(id, e.reason, e.summary)
      if (escalationKeys.has(key)) continue
      escalationKeys.add(key)
      openEscalations.push({
        taskId: id,
        taskTitle: title,
        escalationId: e.id,
        reason: e.reason ?? '',
        summary: e.summary ?? '',
      })
      addReleaseBlocker({ id, title, code: 'escalation', label: e.summary?.trim() || `${blockerSubject(title)} has an open escalation.` })
    }
  }

  const humanBlockingKeys = new Set<string>()
  for (const escalation of openEscalations) humanBlockingKeys.add(`task:${escalation.taskId}`)
  for (const brief of incompleteBriefs) {
    if (tasksByScopeRowId.get(brief.id)?.humanBlocking === true) humanBlockingKeys.add(`task:${brief.id}`)
  }
  for (const brief of unapprovedBriefs) humanBlockingKeys.add(`task:${brief.id}`)
  for (const spec of unapprovedSpecs) humanBlockingKeys.add(`task:${spec.id}`)
  for (const blocked of blockedByAgent) humanBlockingKeys.add(`task:${blocked.id}`)

  const projectionReleaseBlockers = persistedScopeRows
    ? executionScopeRows(currentScopeRows)
      .filter(row => row.scope === 'included' && row.blocksRelease && row.countInProjectTotals !== false)
      .filter(row => !terminalStatuses.has(effectiveReleaseStatus(tasksById.get(row.taskId)!)))
      .map(row => {
        const task = tasksById.get(row.taskId)
        return {
          id: row.taskId,
          title: task?.title ?? row.taskId,
          code: row.proofBlocked
            ? 'proof_evidence_missing'
            : row.handoffState === 'brief_cleanup' || row.handoffState === 'not_shaped'
              ? 'imported_scope_shaping'
              : row.handoffState === 'spec_review'
                ? 'spec_review_required'
                : row.handoffState === 'blocked'
                  ? 'blocked'
                  : 'attention',
          label: row.blockerSummary?.trim() || taskBlockerSummary(task!) || `${task?.title ?? row.taskId} blocks release readiness.`,
        }
      })
    : scopeProjection!.release.blockers
      .filter((blocker) => {
        const task = blocker.owningTaskId ? tasksById.get(blocker.owningTaskId) : null
        return !task || !terminalStatuses.has(effectiveReleaseStatus(task))
      })
      .map(blocker => {
        const task = blocker.owningTaskId ? tasksById.get(blocker.owningTaskId) : null
        return {
          id: blocker.id,
          title: task?.title ?? blocker.id,
          label: blocker.label,
          ...(blocker.code ? { code: blocker.code } : {}),
        }
      })
  const projectionOwnerBlockingCount = executionScopeRows(currentScopeRows)
    .filter(row => row.scope === 'included' && row.countInProjectTotals !== false)
    .filter(projectScopeRowNeedsOwnerInput)
    .length

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
    humanBlockingCount: Math.max(projectionOwnerBlockingCount, humanBlockingKeys.size),
    unfinishedCount,
    scopedTasks,
    gitStoryTasks: scopedTasks,
  }
}

function proofStyleForScope(
  releases: readonly { id?: string; proofStyle?: 'script_only' | 'manual' | 'mixed' | 'unspecified' | string | null }[],
  scope: { id?: string | null } | null | undefined,
): 'script_only' | 'manual' | 'mixed' | 'unspecified' | undefined {
  const proofStyle = releases.find(release => release.id === scope?.id)?.proofStyle
  return proofStyle === 'script_only' || proofStyle === 'manual' || proofStyle === 'mixed' || proofStyle === 'unspecified'
    ? proofStyle
    : undefined
}

function gitStoryBlocksUnattendedStart(blocker: { state?: unknown; reason?: unknown }): boolean {
  // Git Story owns the machine state. Its explanation is audit/display text;
  // a wording change must not alter release readiness.
  return blocker.state !== 'no_upstream'
}

function buildOrientationSpineWithScopedReleaseTruth(
  input: Omit<BuildProjectOrientationSpineInput, 'workspaceImportDraft'>,
): {
  orientationSpine: ReturnType<typeof buildProjectOrientationSpine>
  releaseTruth: ReturnType<typeof summarizeScopedReleaseWork>
} {
  const now = input.now ?? new Date().toISOString()
  // A project surface reads the materialized queue/database. An approved
  // workspace-import snapshot is intake evidence until its tasks have been
  // written to that authority; synthesizing rows here made the overview,
  // release detail, and durable summary disagree on every count.
  const canonicalTasks = (input.tasks ?? []) as unknown as Task[]
  const selectedReleaseId = input.selectedReleaseId
  // The canonical boundary already returns the persisted release envelope.
  // Do not normalize, union, or otherwise manufacture release identities in
  // a route-level read helper.
  const releaseProjectionInputs = (input.releases ?? []) as ProjectRelease[]
  const selectedScope = input.scope !== undefined
    ? input.scope as ProjectScope | null
    : input.scopeProjection?.selectedScope ?? selectedProjectScopeForQueue({
        tasks: canonicalTasks,
        releases: releaseProjectionInputs,
        ...(selectedReleaseId ? { selectedReleaseId } : {}),
      })
  const scopeProjection = input.scopeProjection ?? buildProjectScopeProjection(
    {
      tasks: canonicalTasks,
      releases: releaseProjectionInputs,
      ...(selectedReleaseId ? { selectedReleaseId } : {}),
    },
    { selectedScope },
  )
  const releaseTruth = summarizeScopedReleaseWork(canonicalTasks, scopeProjection.selectedScope, {
    proofStyle: proofStyleForScope(releaseProjectionInputs, scopeProjection.selectedScope),
    commandProofRequired: proofStyleForScope(releaseProjectionInputs, scopeProjection.selectedScope) === 'script_only',
  })
  const suppliedReleaseBlockers = input.releaseReadiness?.blockers
  const releaseBlockers = suppliedReleaseBlockers ?? releaseTruth.releaseBlockers
  const orientationSpine = buildProjectOrientationSpine({
    ...input,
    now,
    selectedReleaseId,
    releases: releaseProjectionInputs,
    scopeProjection,
    workspaceImportDraft: null,
    releaseReadiness: {
      verdict: input.releaseReadiness?.verdict ?? (releaseBlockers.length > 0 ? 'blocked' : 'clear'),
      blockers: releaseBlockers,
    },
  })
  return { orientationSpine, releaseTruth }
}

function orientationReleaseTruthFromSummary(
  summary: ProjectSummaryProjection['releaseSummary'] | null | undefined,
  queue?: {
    releases?: readonly unknown[]
    selectedReleaseId?: string | null
  },
) {
  const selectedReleaseId = queue?.selectedReleaseId ?? null
  const selectedRelease = selectedReleaseId
    ? queue?.releases?.find(release => isRecord(release) && release.id === selectedReleaseId)
    : undefined
  const lifecycleState: OrientationReleaseState | undefined = selectedRelease && isRecord(selectedRelease) &&
      ['active', 'deferred', 'planned', 'ready', 'shipped'].includes(String(selectedRelease.state))
    ? selectedRelease.state as OrientationReleaseState
    : undefined
  return {
    ...(lifecycleState ? { lifecycleState } : {}),
    state: summary?.state === 'ready'
      ? 'ready' as const
      : summary?.state === 'blocked'
        ? 'blocked' as const
        : summary?.state === 'active'
          ? 'active' as const
          : summary?.state === 'shaping'
            ? 'shaping' as const
            : 'unknown' as const,
    counts: {
      total: summary?.counts.total ?? 0,
      done: summary?.counts.done ?? 0,
      unfinished: summary?.counts.unfinished ?? 0,
      deferred: summary?.counts.deferred ?? 0,
      proofBlocked: summary?.counts.proofBlocked ?? 0,
    },
    blockers: summary?.blockers ?? [],
  }
}

function orientationReleaseTruthFromReadinessPayload(
  payload: Record<string, unknown>,
  summary: ProjectSummaryProjection['releaseSummary'] | null | undefined,
  queue?: {
    releases?: readonly unknown[]
    selectedReleaseId?: string | null
  },
) {
  const saved = orientationReleaseTruthFromSummary(summary, queue)
  const totals = isRecord(payload.totals) ? payload.totals : {}
  const blockers = Array.isArray(payload.releaseBlockers)
    ? payload.releaseBlockers
      .filter(isRecord)
      .map(blocker => ({
        id: typeof blocker.id === 'string' ? blocker.id : undefined,
        label: typeof blocker.label === 'string'
          ? blocker.label
          : typeof blocker.title === 'string' ? blocker.title : undefined,
        code: typeof blocker.code === 'string' ? blocker.code : undefined,
      }))
    : saved.blockers
  const total = typeof totals.tasks === 'number' ? totals.tasks : saved.counts.total
  const done = typeof totals.done === 'number' ? totals.done : saved.counts.done
  const unfinished = typeof totals.unfinishedCount === 'number' ? totals.unfinishedCount : saved.counts.unfinished
  const proofBlocked = typeof totals.proofEvidenceBlockingCount === 'number'
    ? totals.proofEvidenceBlockingCount
    : saved.counts.proofBlocked
  return {
    ...saved,
    state: payload.ready === true
      ? 'ready' as const
      : blockers.length > 0
        ? 'blocked' as const
        : saved.state,
    counts: {
      ...saved.counts,
      total,
      done,
      unfinished,
      proofBlocked,
    },
    blockers,
  }
}

/**
 * Lift a normalized task row into the orientation builder's input shape.
 * Identity, hierarchy, status, scope membership, and release membership come
 * from indexed columns; only the already-persisted task definition supplies
 * optional node detail. This is a projection adapter, never a second task
 * authority and never an effective-task reconstruction.
 */
function orientationTaskFromMapRow(row: {
  id: string
  title: string
  description: string | null
  status: string | null
  domain: string | null
  priority: string | null
  workKind: string | null
  parentId: string | null
  hierarchy: Record<string, unknown> | null
  dependsOn: string[]
  releaseIds: string[]
  sourceRefs: string[]
  updatedAt: string | null
  contractSurfaceReviewPackets?: Array<Record<string, unknown>>
  definition: Record<string, unknown>
}): Task {
  const definition = row.definition ?? {}
  return {
    ...definition,
    id: row.id,
    title: row.title,
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.status !== null ? { status: row.status } : {}),
    ...(row.domain !== null ? { domain: row.domain } : {}),
    ...(row.priority !== null ? { priority: row.priority } : {}),
    ...(row.workKind !== null ? { workKind: row.workKind } : {}),
    ...(row.parentId || row.hierarchy ? {
      hierarchy: {
        ...(isRecord(definition.hierarchy) ? definition.hierarchy : {}),
        ...(row.hierarchy ?? {}),
        ...(row.parentId ? { parentId: row.parentId } : {}),
      },
    } : {}),
    dependsOn: row.dependsOn,
    releaseIds: row.releaseIds,
    sourceRefs: row.sourceRefs,
    ...(row.contractSurfaceReviewPackets ? { contractSurfaceReviewPackets: row.contractSurfaceReviewPackets } : {}),
    ...(row.updatedAt !== null ? { updatedAt: row.updatedAt } : {}),
  } as unknown as Task
}

function orientationReleaseReadinessFromPayload(
  payload: Record<string, unknown> | null,
): BuildProjectOrientationSpineInput['releaseReadiness'] | null {
  if (!payload) return null
  const releaseBlockers = Array.isArray(payload.releaseBlockers) ? payload.releaseBlockers : []
  return {
    verdict: payload.ready === true ? 'clear' : 'blocked',
    blockers: releaseBlockers
      .filter((blocker): blocker is { id?: string; label?: string; title?: string; nextAction?: string; code?: string } => Boolean(blocker && typeof blocker === 'object'))
      .map(blocker => ({
        id: typeof blocker.id === 'string' ? blocker.id : undefined,
        label: typeof blocker.label === 'string' ? blocker.label : undefined,
        title: typeof blocker.title === 'string' ? blocker.title : undefined,
        nextAction: typeof blocker.nextAction === 'string' ? blocker.nextAction : undefined,
        code: typeof blocker.code === 'string' ? blocker.code : undefined,
      })),
  }
}

function selectedReleaseScopeFromQueueLike(input: {
  tasks: Task[]
  releases?: TaskQueue['releases']
  selectedReleaseId?: string
}): OrientationScope | null {
  return Array.isArray(input.releases)
    ? selectedReleaseScopeForQueue({
      tasks: input.tasks,
      releases: input.releases,
      ...(input.selectedReleaseId ? { selectedReleaseId: input.selectedReleaseId } : {}),
    })
    : null
}

function tasksEligibleForScopeExecution(tasks: Task[], scope: OrientationScope | null | undefined): Task[] {
  if (!scope) return tasks.filter(task => task.status !== 'shelved')
  const tasksById = new Map(tasks.map(task => [task.id, task] as const))
  return tasks.filter(task => taskEligibleForSelectedScope(task, scope, { tasksById }).eligible)
}

function sourceConflictCompetesWithSelectedScope(
  gap: { kind: string; severity: string; refs?: string[] },
  tasks: Task[],
  scope: OrientationScope | null | undefined,
): boolean {
  if (gap.kind !== 'source_conflict') return false
  if (!scope) return gap.severity === 'blocker'
  const tasksById = new Map(tasks.map(task => [task.id, task] as const))
  const refTasks = (gap.refs ?? [])
    .map(ref => ref.startsWith('task:') ? ref.slice('task:'.length) : '')
    .map(taskId => tasksById.get(taskId))
    .filter((task): task is Task => Boolean(task))
  const hasIncludedTask = refTasks.some(task =>
    taskEligibleForSelectedScope(task, scope, { tasksById }).eligible,
  )
  const hasCompetingScopedTask = refTasks.some((task) => {
    if (taskEligibleForSelectedScope(task, scope, { tasksById }).eligible) return false
    const releaseIds = (task as { releaseIds?: unknown }).releaseIds
    if (Array.isArray(releaseIds) && releaseIds.length > 0) return true
    const taskScope = String((task as { scope?: unknown }).scope ?? '').trim()
    return taskScope.length > 0 && taskScope !== 'current'
  })
  return hasIncludedTask && hasCompetingScopedTask
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
  if (importedContractWorkIsStructurallyIncomplete(task)) return false
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
  const visibleBlockReason = taskBlockerSummary(task as Task).trim()
  const persistedBlockReason = typeof task.blockReason === 'string' ? task.blockReason.trim() : ''
  let normalized = visibleBlockReason && visibleBlockReason !== persistedBlockReason
    ? {
        ...task,
        blockReason: visibleBlockReason,
        ...(persistedBlockReason ? { persistedBlockReason } : {}),
      }
    : task
  normalized = normalizeAcceptanceCriteriaForCurrentProof(normalized)
  const canonicalDescriptions = new Set(
    Array.isArray(normalized.acceptanceCriteria)
      ? normalized.acceptanceCriteria
          .map((criterion) =>
            typeof (criterion as { description?: unknown }).description === 'string'
              ? (criterion as { description: string }).description.trim()
              : '',
          )
          .filter(Boolean)
      : [],
  )
  if (canonicalDescriptions.size === 0 || !Array.isArray(normalized.notes)) return normalized
  const notes = (normalized.notes as Array<Record<string, unknown>>)
    .filter((note) => noteMatchesCanonicalAcceptance(note, canonicalDescriptions))
  return notes.length === normalized.notes.length ? normalized : { ...normalized, notes }
}

/**
 * The drawer's first response is a current-task read, not a history export.
 * Evidence and review records have dedicated on-demand endpoints; carrying
 * them here makes a single old task as expensive as a project shell.
 */
function compactTaskForInitialDrawer(task: Record<string, unknown>): Record<string, unknown> {
  const compact = { ...task }
  for (const key of ['notes', 'evidence', 'reviewVerdicts', 'adjudications']) delete compact[key]
  return compact
}

function latestTaskNoteContent(
  task: Record<string, unknown>,
  predicate: (note: Record<string, unknown>) => boolean,
): string | null {
  const match = latestTaskNote(task, predicate)
  const content = typeof match?.content === 'string' ? match.content.trim() : ''
  return content || null
}

function latestTaskNote(
  task: Record<string, unknown>,
  predicate: (note: Record<string, unknown>) => boolean,
): Record<string, unknown> | null {
  const notes = Array.isArray(task.notes) ? task.notes as Array<Record<string, unknown>> : []
  return [...notes]
    .reverse()
    .find((note) => {
      const content = typeof note.content === 'string' ? note.content.trim() : ''
      return content.length > 0 && predicate(note)
    }) ?? null
}

function isWorkerSelfCritiqueNote(note: Record<string, unknown>): boolean {
  const agentId = typeof note.agentId === 'string' ? note.agentId.trim().toLowerCase() : ''
  const content = typeof note.content === 'string' ? note.content : ''
  if (agentId !== 'worker-agent' || content.trim().length === 0) return false
  return readPersistedStructuredSelfCritique(note.structured) !== null
}

function normalizedCheckpointNextPlannedAction(
  _task: Record<string, unknown>,
  checkpoint: Checkpoint | null,
): string | null {
  const nextAction = checkpoint?.nextPlannedAction?.trim() ?? ''
  if (!nextAction) return null
  if (/^(?:none|null|n\/a|na|nothing)$/i.test(nextAction)) return null
  // `nextPlannedAction` is display text. State/routing decisions use the
  // structured Checkpoint.nextActionKind field.
  return nextAction
}

function buildTerminalSummary(
  task: Record<string, unknown>,
): { headline: string; detail?: string } | undefined {
  const status = typeof task.status === 'string' ? task.status : ''
  if (status !== 'done' && status !== 'pending_pr') return undefined
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

function taskHasExplicitGitStoryFollowup(task: Record<string, unknown>): boolean {
  const mergeRecord =
    task.mergeRecord && typeof task.mergeRecord === 'object' && !Array.isArray(task.mergeRecord)
      ? task.mergeRecord as { result?: string }
      : undefined
  const hasTaskWorktree = typeof task.worktreePath === 'string' && task.worktreePath.trim().length > 0
  return gitStoryFollowupIsActive({
    status: typeof task.status === 'string' ? task.status : undefined,
    mergeRecordResult: mergeRecord?.result,
    hasCompletionProof: taskHasRecordedCompletionProof(task as Task),
    hasTaskWorktree,
    hasOverride: Boolean(taskGitStoryOverride(task)),
  })
}

function taskNeedsTaskGitStory(
  task: Record<string, unknown>,
  workspace?: { worktreePath?: string },
  childProject?: unknown,
): boolean {
  const hasExplicitFollowup = taskHasExplicitGitStoryFollowup(task)
  const runtime = task.runtime && typeof task.runtime === 'object' && !Array.isArray(task.runtime)
    ? task.runtime as Record<string, unknown>
    : null
  const hasActiveProofRecovery = Boolean(
    (task.proofRecovery && typeof task.proofRecovery === 'object' && !Array.isArray(task.proofRecovery)) ||
    (runtime?.proofRecovery && typeof runtime.proofRecovery === 'object' && !Array.isArray(runtime.proofRecovery)),
  )
  const hasTaskWorktree = typeof workspace?.worktreePath === 'string' ||
    typeof task.worktreePath === 'string'
  if (taskHasRecordedCompletionProof(task as Task) && !hasExplicitFollowup && !hasActiveProofRecovery) return false
  return Boolean(childProject) ||
    hasTaskWorktree ||
    hasExplicitFollowup
}

function taskGitStoryProjectionId(taskId: string): string {
  return `task:${taskId}`
}

function parseGitStorySnapshot(value: unknown): Record<string, unknown> | undefined {
  const parsed = GitStorySnapshot.safeParse(value)
  return parsed.success ? parsed.data as unknown as Record<string, unknown> : undefined
}

/**
 * Read repository state from the current projection only. A missing or stale
 * projection is intentionally not refreshed here; callers that need live Git
 * state use the explicit Git Story endpoint.
 */
function readTaskGitStoryProjection(
  projectPath: string,
  taskId: string,
  fallback: unknown,
): Record<string, unknown> | undefined {
  const cached = readProjectRepositoryProjectionAtBoundary(projectPath, taskGitStoryProjectionId(taskId))
  if (cached?.freshness === 'current') {
    const snapshot = parseGitStorySnapshot(cached.payload)
    if (snapshot) return snapshot
  }
  return parseGitStorySnapshot(fallback)
}

function taskForGitStory(
  task: Record<string, unknown>,
  workspace?: { worktreePath?: string },
  mergeRecordResultOverride?: string,
): Parameters<typeof inspectGitStory>[1]['task'] {
  const mergeRecord =
    task.mergeRecord && typeof task.mergeRecord === 'object' && !Array.isArray(task.mergeRecord)
      ? task.mergeRecord as { result?: string }
      : undefined
  const effectiveMergeRecord = mergeRecordResultOverride
    ? { ...(mergeRecord ?? {}), result: mergeRecordResultOverride }
    : mergeRecord
  return {
    ...(typeof task.id === 'string' ? { id: task.id } : {}),
    ...(typeof task.title === 'string' ? { title: task.title } : {}),
    ...(typeof workspace?.worktreePath === 'string'
      ? { worktreePath: workspace.worktreePath }
      : typeof task.worktreePath === 'string'
        ? { worktreePath: task.worktreePath }
        : {}),
    ...(effectiveMergeRecord ? { mergeRecord: effectiveMergeRecord } : {}),
    ...(taskGitStoryOverride(task) ? { gitStory: taskGitStoryOverride(task) } : {}),
  }
}

async function reconciledTaskHeadMergeResult(
  driver: NodeGitDriver,
  input: {
    task: Record<string, unknown>
    worktreePath: string | null
    targetRepoRoot: string
  },
): Promise<string | undefined> {
  if (!input.worktreePath) return undefined
  try {
    const status = await driver.statusSummary(input.worktreePath)
    if (!hasOnlyReconciledTaskWorktreeResidue(status)) return undefined
    const recordedMergeResult = isRecord(input.task.mergeRecord) && typeof input.task.mergeRecord.result === 'string'
      ? input.task.mergeRecord.result
      : undefined
    if (
      status.untrackedCount > 0 &&
      (recordedMergeResult === 'merged' || recordedMergeResult === 'reconciled')
    ) return 'reconciled'
    const taskHead = await driver.headSha(input.worktreePath)
    if (await driver.isAncestor(input.targetRepoRoot, taskHead, 'HEAD')) return 'reconciled'
    const targetStatus = await driver.statusSummary(input.targetRepoRoot)
    if (targetStatus.upstream && await driver.isAncestor(input.targetRepoRoot, taskHead, targetStatus.upstream)) {
      return 'reconciled'
    }
  } catch {
    return undefined
  }
  return undefined
}

function hasOnlyReconciledTaskWorktreeResidue(status: {
  changedCount: number
  untrackedCount: number
  samplePaths: readonly string[]
}): boolean {
  if (status.changedCount > 0) return false
  if (status.untrackedCount === 0) return true
  if (status.untrackedCount !== status.samplePaths.length) return false
  return status.samplePaths.every((samplePath) =>
    samplePath === 'pnpm-lock.yaml' || samplePath === 'pnpm-workspace.yaml',
  )
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
  return resolveEffectiveTaskProjectPath(task as unknown as Pick<Task, 'domain' | 'projectPath'>, projectPath)
}

function taskExistingWorktreePath(
  task: Record<string, unknown>,
  workspace?: { worktreePath?: string },
): string | null {
  const worktreePath = typeof workspace?.worktreePath === 'string' && workspace.worktreePath.trim()
    ? workspace.worktreePath.trim()
    : typeof task.worktreePath === 'string' && task.worktreePath.trim()
      ? task.worktreePath.trim()
      : ''
  return worktreePath && existsSync(worktreePath) ? worktreePath : null
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
  const existingWorktreePath = taskExistingWorktreePath(task, workspace)
  const repoRoot = existingWorktreePath ?? childProject?.path ?? resolveEffectiveTaskProjectPath(task as unknown as Pick<Task, 'domain' | 'projectPath'>, projectPath)
  const effectiveInspectedPath = existingWorktreePath ?? childProject?.path ?? inspectedPath
  const targetRepoRoot = childProject?.path ?? resolveEffectiveTaskProjectPath(task as unknown as Pick<Task, 'domain' | 'projectPath'>, projectPath)
  const mergeRecordResultOverride = await reconciledTaskHeadMergeResult(driver, {
    task,
    worktreePath: existingWorktreePath,
    targetRepoRoot,
  })
  return inspectGitStory(driver, {
    repoRoot,
    ...(childProject?.id ? { repoId: childProject.id } : {}),
    ...(childProject?.label ?? childProject?.id ? { repoLabel: childProject.label ?? childProject.id } : {}),
    inspectedPath: effectiveInspectedPath,
    task: taskForGitStory(task, workspace, mergeRecordResultOverride),
    inspectPr: false,
  })
}

async function gitStoryForTaskIfUseful(
  projectPath: string,
  task: Record<string, unknown>,
  workspace?: { worktreePath?: string },
) {
  const workspaceConfig = readWorkspaceConfig(projectPath)
  const workspaceProjects = workspaceConfig.kind === 'workspace'
    ? resolveWorkspaceProjectPathsOrDiscover(projectPath, workspaceConfig)
    : discoverChildGitProjects(projectPath)
  const childProject = resolveGitStoryWorkspaceProject({
    workspacePath: projectPath,
    workspaceProjectPath: projectPath,
    workspaceProjects,
    task,
  })
  const hasTaskSpecificGitStory = taskNeedsTaskGitStory(task, workspace, childProject)
  if (!hasTaskSpecificGitStory && workspaceProjects.length > 0) return undefined
  return gitStoryForTask(projectPath, task, workspace, workspaceProjects)
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
    const hasUnresolvedTaskGit = taskNeedsTaskGitStory(task, workspace)
    if (!hasUnresolvedTaskGit) continue
    snapshots.push(await gitStoryForTask(projectPath, task, workspace, workspaceProjects))
  }
  return summarizeGitStories(snapshots)
}

function savedProjectGitStorySummary(state: ProjectReleaseReadModel): GitStorySummary & {
  source: 'project-state'
  diagnostic: false
  freshness: 'current' | 'stale' | 'missing'
  requiresRefresh: boolean
  sourceRevision: number | null
  projectRevision: number | null
  generatedAt: string | null
} {
  const diagnostic = state.diagnostics
  const git = diagnostic?.git
  const parsedState = GitStoryClosureState.safeParse(git?.state)
  const storyState = parsedState.success ? parsedState.data : 'unknown'
  const freshness = diagnostic?.freshness ?? 'missing'
  const aligned = freshness === 'current'
    && diagnostic?.sourceRevision !== undefined
    && diagnostic.sourceRevision === state.projectRevision
    && state.projectRevision !== null
  const blockers = (git?.blockers ?? []).map(blocker => {
    const blockerState = GitStoryClosureState.safeParse(blocker.state)
    return {
      id: blocker.id,
      label: blocker.label,
      state: blockerState.success ? blockerState.data : 'unknown',
      reason: blocker.reason ?? blocker.label,
      nextAction: blocker.nextAction ?? 'Inspect repository diagnostics.',
      ...(blocker.repoId ? { repoId: blocker.repoId } : {}),
      ...(blocker.taskId ? { taskId: blocker.taskId } : {}),
    }
  })
  return {
    ready: git?.ready ?? false,
    state: storyState,
    blockers,
    // The saved diagnostic projection is deliberately summary-only. Exact
    // repository snapshots belong behind the explicit live diagnostic path.
    snapshots: [],
    source: 'project-state',
    diagnostic: false,
    freshness,
    requiresRefresh: !aligned,
    sourceRevision: diagnostic?.sourceRevision ?? null,
    projectRevision: state.projectRevision,
    generatedAt: diagnostic?.generatedAt ?? null,
  }
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

function invalidateGitStoryObservation(projectRoot: string, action: 'commit' | 'push' | 'pullRequest'): void {
  // Git changed outside the project-state transaction. Notify the shared
  // projection scheduler so readiness never keeps serving an old repository
  // observation after a successful Git Story action.
  emitProjectSummaryInvalidation(projectRoot, `git-story-${action}`, {
    domains: ['repository'],
  })
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
  effectiveOverride?: Record<string, unknown>,
  options: { includeLiveGitStory?: boolean } = {},
): Promise<Record<string, unknown>> {
  const effective = effectiveOverride ?? await buildEffectiveTask(projectPath, task as Task)
  const normalized = normalizeTaskForDrawer(effective)
  if (importedContractWorkIsStructurallyIncomplete(normalized)) {
    normalized.taskReadiness = importedContractStructuralRepairReadiness(normalized)
    normalized.structuralIntegrity = {
      status: 'needs_repair',
      reason: 'Imported contract/type work is missing concrete contract names.',
      source: 'imported-work-integrity',
    }
  }
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
  const latestReviewerNote = latestTaskNote(
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
  const latestSelfCritiqueNote = latestTaskNote(
    normalized,
    (note) => isWorkerSelfCritiqueNote(note),
  )
  const reviewerAt = typeof latestReviewerNote?.timestamp === 'string'
    ? Date.parse(latestReviewerNote.timestamp)
    : Number.NaN
  const selfCritiqueAt = typeof latestSelfCritiqueNote?.timestamp === 'string'
    ? Date.parse(latestSelfCritiqueNote.timestamp)
    : Number.NaN
  const latestSelfCritique = Number.isFinite(reviewerAt) && Number.isFinite(selfCritiqueAt) && reviewerAt > selfCritiqueAt
    ? null
    : typeof latestSelfCritiqueNote?.content === 'string'
      ? latestSelfCritiqueNote.content.trim() || null
      : null
  const terminalSummary = buildTerminalSummary(normalized)
  // The ordinary task detail read already came from the authoritative current
  // task projection. Reopening the workspace store here would let decoration
  // observe a different revision than the task itself. Workspace inspection
  // stays behind explicit file/diagnostic routes.
  const workspace = isRecord(normalized.workspace) ? normalized.workspace : undefined
  const gitStory = taskId && shouldAttachTaskGitStory(taskId)
    ? options.includeLiveGitStory === true
      ? await gitStoryForTaskIfUseful(projectPath, normalized, workspace).catch(() => undefined)
      : readTaskGitStoryProjection(projectPath, taskId, normalized.gitStory)
    : undefined
  const reviewAudit = taskId
    ? await createReviewAuditStore({
        projectRoot: projectPath,
        persistence: new FileBackedGuildhallPersistence(),
      }).readTaskReviewAudit(taskId).catch(() => null)
    : null
  const normalizedReviewPlan = reviewAudit?.plan
    ? normalizeReviewPlanForTask({ task: normalized as unknown as Pick<Task, 'id' | 'title' | 'description' | 'priority' | 'status' | 'spec' | 'acceptanceCriteria' | 'notes' | 'outOfScope'> }, reviewAudit.plan.payload).plan
    : null
  const normalizedReviewAudit = reviewAudit && normalizedReviewPlan
    ? {
        ...reviewAudit,
        plan: {
          ...reviewAudit.plan!,
          payload: normalizedReviewPlan,
        },
      }
    : reviewAudit

  const enriched = {
    ...normalized,
    ...buildTaskEvidenceSummary(normalized),
    ...(normalizedReviewPlan ? { reviewPlan: normalizedReviewPlan } : {}),
    ...(normalizedReviewAudit ? { reviewAuditSummary: buildReviewAuditSummary(normalizedReviewAudit) } : {}),
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
            ...(checkpoint.nextActionKind ? { nextActionKind: checkpoint.nextActionKind } : {}),
            filesTouched: checkpoint.filesTouched,
            writtenAt: checkpoint.writtenAt,
          },
        }
      : {}),
  }
  const completionProof = compactTaskCompletionProof(enriched)
  const proofPaths = compactProofPathsForServe((enriched as Record<string, unknown>).proofPaths)
  return {
    ...enriched,
    ...(Array.isArray(proofPaths) ? { proofPaths } : {}),
    ...(completionProof ? { completionProof } : {}),
  }
}

async function enrichTaskForWorkSurface(
  projectPath: string,
  task: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const effective = await buildEffectiveTask(projectPath, task as Task)
  const normalized = normalizeTaskForDrawer(effective)
  if (importedContractWorkIsStructurallyIncomplete(normalized)) {
    normalized.taskReadiness = importedContractStructuralRepairReadiness(normalized)
    normalized.structuralIntegrity = {
      status: 'needs_repair',
      reason: 'Imported contract/type work is missing concrete contract names.',
      source: 'imported-work-integrity',
    }
  }
  const taskId = typeof normalized.id === 'string' ? normalized.id : ''
  const memoryDir = getProjectStateDir(projectPath)
  const checkpoint = taskId ? await readCheckpoint(memoryDir, taskId).catch(() => null) : null
  const nextPlannedAction = normalizedCheckpointNextPlannedAction(normalized, checkpoint)
  if (checkpoint && nextPlannedAction) {
    return {
      ...normalized,
      ...buildTaskEvidenceSummary(normalized),
      latestCheckpoint: {
        nextPlannedAction,
        ...(checkpoint?.nextActionKind ? { nextActionKind: checkpoint.nextActionKind } : {}),
      },
    }
  }
  return {
    ...normalized,
    ...buildTaskEvidenceSummary(normalized),
  }
}

function buildTaskEvidenceSummary(task: Record<string, unknown>): { evidenceSummary?: Record<string, unknown> } {
  const allNotes = Array.isArray(task.notes) ? task.notes.filter(isRecord) : []
  const latestReviewerAt = allNotes
    .filter((note) => {
      const agentId = typeof note.agentId === 'string' ? note.agentId.trim().toLowerCase() : ''
      const role = typeof note.role === 'string' ? note.role.trim().toLowerCase() : ''
      return agentId === 'reviewer-fanout' || agentId === 'reviewer-agent' || role === 'reviewer'
    })
    .map((note) => Date.parse(firstString(note.timestamp, note.recordedAt) ?? ''))
    .filter(Number.isFinite)
    .reduce((latest, at) => Math.max(latest, at), Number.NEGATIVE_INFINITY)
  const notes = allNotes.filter((note) => {
    if (!isWorkerSelfCritiqueNote(note) || !Number.isFinite(latestReviewerAt)) return true
    const selfCritiqueAt = Date.parse(firstString(note.timestamp, note.recordedAt) ?? '')
    return !Number.isFinite(selfCritiqueAt) || selfCritiqueAt >= latestReviewerAt
  })
  const reviewVerdicts = Array.isArray(task.reviewVerdicts) ? task.reviewVerdicts.filter(isRecord) : []
  const adjudications = Array.isArray(task.adjudications) ? task.adjudications.filter(isRecord) : []
  const gateResults = Array.isArray(task.gateResults) ? task.gateResults.filter(isRecord) : []
  const latest = [...notes, ...reviewVerdicts, ...adjudications, ...gateResults]
    .map((entry) => {
      const at = firstString(entry.timestamp, entry.recordedAt, entry.decidedAt, entry.checkedAt)
      const summary = firstString(entry.content, entry.reason, entry.summary, entry.message)
      return at && summary ? { at, summary, kind: evidenceKindForSummary(entry, notes, reviewVerdicts, adjudications, gateResults) } : null
    })
    .filter((entry): entry is { at: string; summary: string; kind: string } => entry !== null)
    .sort((left, right) => right.at.localeCompare(left.at))[0]
  const total = notes.length + reviewVerdicts.length + adjudications.length + gateResults.length
  if (total === 0) return {}
  return {
    evidenceSummary: {
      counts: {
        notes: notes.length,
        reviewVerdicts: reviewVerdicts.length,
        adjudications: adjudications.length,
        gateResults: gateResults.length,
      },
      ...(latest ? { latest } : {}),
    },
  }
}

function evidenceKindForSummary(
  entry: Record<string, unknown>,
  notes: Record<string, unknown>[],
  reviewVerdicts: Record<string, unknown>[],
  adjudications: Record<string, unknown>[],
  gateResults: Record<string, unknown>[],
): string {
  if (reviewVerdicts.includes(entry)) return 'review'
  if (adjudications.includes(entry)) return 'adjudication'
  if (gateResults.includes(entry)) return 'gate'
  if (notes.includes(entry)) return 'note'
  return 'evidence'
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function compactTaskRuntimeForProjectSummary(runtime: unknown): Record<string, unknown> | undefined {
  if (!runtime || typeof runtime !== 'object') return undefined
  const source = runtime as Record<string, unknown>
  const openEscalationIds = Array.isArray(source.openEscalationIds)
    ? source.openEscalationIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
  const hasOpenEscalationIds = Array.isArray(source.openEscalationIds)
  const proofRecovery = source.proofRecovery && typeof source.proofRecovery === 'object' && !Array.isArray(source.proofRecovery)
    ? source.proofRecovery as Record<string, unknown>
    : null
  const summary: Record<string, unknown> = {}
  if (hasOpenEscalationIds) summary.openEscalationIds = openEscalationIds
  if (proofRecovery) {
    summary.proofRecovery = {
      ...(typeof proofRecovery.reopenedAt === 'string' ? { reopenedAt: proofRecovery.reopenedAt } : {}),
      ...(typeof proofRecovery.reason === 'string' ? { reason: proofRecovery.reason } : {}),
    }
  }
  return Object.keys(summary).length ? summary : undefined
}

function compactTaskEscalationsForProjectSummary(escalations: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(escalations)) return undefined
  const compact = escalations
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map(entry => {
      const summary: Record<string, unknown> = {}
      for (const key of ['id', 'taskId', 'reason', 'summary', 'agentId', 'raisedAt', 'resolvedAt']) {
        if (key in entry) summary[key] = entry[key]
      }
      return summary
    })
  return compact.length ? compact : undefined
}

function compactTaskCompletionProof(task: Record<string, unknown>): Record<string, unknown> | undefined {
  const recorded = recordedCompletionProofForTask(task)
  const proofPaths = Array.isArray(task.proofPaths) ? task.proofPaths : []
  const status = String(task.status ?? '')
  const runtime = task.runtime && typeof task.runtime === 'object' && !Array.isArray(task.runtime)
    ? task.runtime as Record<string, unknown>
    : null
  const activeProofRecovery =
    status !== 'done' &&
    Boolean(
      (task.proofRecovery && typeof task.proofRecovery === 'object' && !Array.isArray(task.proofRecovery)) ||
      (runtime?.proofRecovery && typeof runtime.proofRecovery === 'object' && !Array.isArray(runtime.proofRecovery)),
    )
  const proofMissing = status === 'done' && taskDoneButProofMissing(task)
  if (status !== 'done' && !activeProofRecovery) {
    if (proofPaths.length === 0) return undefined
    return {
      state: 'planned',
      expectedCount: proofPaths.length,
      verifiedCount: 0,
    }
  }
  if (recorded.verified.length === 0 && proofPaths.length === 0 && !proofMissing && !activeProofRecovery) return undefined
  const proofIsStale = taskProofIsStale(task)
  const classified = classifyCompletionProof(recorded, proofIsStale)
  const current = classified.current
  const historical = classified.historical
  return {
    state: proofIsStale ? 'missing' : current.length > 0 ? 'verified' : 'planned',
    expectedCount: proofPaths.length,
    verifiedCount: current.length,
    verified: current.slice(0, 4),
    ...(historical.length > 0
      ? {
          historicalCount: historical.length,
          historical: historical.slice(0, 4),
        }
      : {}),
    ...(recorded.latestAt ? { latestAt: recorded.latestAt } : {}),
    ...(proofIsStale ? { missing: ['Required proof evidence has not been attached yet.'] } : {}),
  }
}

function compactProofPathId(value: string, fallback: string): string {
  const id = slugify(value).slice(0, 48)
  return id || fallback
}

function compactExpectedEvidenceForServe(item: unknown, index: number, proofPathId: string): Record<string, unknown> | null {
  if (typeof item === 'string') {
    const description = item.trim()
    if (!description) return null
    return {
      id: `${proofPathId}-evidence-${index}`,
      kind: 'artifact',
      description,
      required: true,
    }
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const record = item as Record<string, unknown>
  const description =
    typeof record.description === 'string' && record.description.trim()
      ? record.description.trim()
      : typeof record.summary === 'string' && record.summary.trim()
        ? record.summary.trim()
        : typeof record.title === 'string' && record.title.trim()
          ? record.title.trim()
          : ''
  return {
    ...record,
    id:
      typeof record.id === 'string' && record.id.trim()
        ? record.id.trim()
        : `${proofPathId}-evidence-${index}`,
    kind:
      typeof record.kind === 'string' && record.kind.trim()
        ? record.kind.trim()
        : 'artifact',
    ...(description ? { description } : {}),
    required: record.required === false ? false : true,
  }
}

function compactProofPathsForServe(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.flatMap((proofPath, index) => {
    if (typeof proofPath === 'string') {
      const title = proofPath.trim()
      if (!title) return []
      const id = compactProofPathId(title, `proof-path-${index}`)
      return [{
        id,
        scope: { type: 'task', id },
        title,
        summary: `Legacy proof path: ${title}`,
        source: 'documented',
        status: 'planned',
        expectedEvidence: [],
      }]
    }
    if (!proofPath || typeof proofPath !== 'object' || Array.isArray(proofPath)) return []
    const record = proofPath as Record<string, unknown>
    const title = typeof record.title === 'string' && record.title.trim()
      ? record.title.trim()
      : typeof record.kind === 'string' && record.kind.trim()
        ? `${record.kind.trim().replace(/[_-]/g, ' ')} proof path`
        : `Proof path ${index + 1}`
    const id = typeof record.id === 'string' && record.id.trim()
      ? record.id.trim()
      : compactProofPathId(title, `proof-path-${index}`)
    return [{
      ...record,
      id,
      title,
      expectedEvidence: Array.isArray(record.expectedEvidence)
        ? record.expectedEvidence
          .map((evidence, evidenceIndex) => compactExpectedEvidenceForServe(evidence, evidenceIndex, id))
          .filter((evidence): evidence is Record<string, unknown> => Boolean(evidence))
        : [],
    }]
  })
}

function compactTaskSourceRefsForServe(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .map(ref => typeof ref === 'string' ? ref.trim() : '')
    .filter(Boolean)
    .map(ref => ref.startsWith('import:') ? ref.slice('import:'.length) : ref))]
}

function firstCompactTaskRefList(...values: unknown[]): string[] {
  for (const value of values) {
    const refs = compactTaskSourceRefsForServe(value)
    if (refs.length > 0) return refs
  }
  return []
}

function orientationNodeSourceRefsForServe(node: unknown): string[] {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return []
  const source = (node as Record<string, unknown>).source
  if (!source || typeof source !== 'object' || Array.isArray(source)) return []
  return compactTaskSourceRefsForServe((source as Record<string, unknown>).refs)
}

function orientationNodeSummaryForServe(node: unknown): string | undefined {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined
  const summary = (node as Record<string, unknown>).summary
  return typeof summary === 'string' && summary.trim() ? summary.trim() : undefined
}

function backfillCompactTaskOrientationForServe(
  tasks: Array<Record<string, unknown>>,
  orientationSpine: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const rowsByTaskId = new Map<string, Record<string, unknown>>()
  if (Array.isArray(orientationSpine.scopeRows)) {
    for (const row of orientationSpine.scopeRows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue
      const record = row as Record<string, unknown>
      const taskId = typeof record.taskId === 'string' && record.taskId.trim() ? record.taskId.trim() : ''
      if (taskId) rowsByTaskId.set(taskId, record)
    }
  }
  const nodes = orientationSpine.nodes && typeof orientationSpine.nodes === 'object' && !Array.isArray(orientationSpine.nodes)
    ? orientationSpine.nodes as Record<string, unknown>
    : {}
  return tasks.map(task => {
    const taskId = typeof task.id === 'string' && task.id.trim() ? task.id.trim() : ''
    if (!taskId) return task
    const scopeRow = rowsByTaskId.get(taskId)
    const node = nodes[`work:${taskId}`]
    const sourceRefs = firstCompactTaskRefList(task.sourceRefs, task.references, scopeRow?.sourceRefs, orientationNodeSourceRefsForServe(node))
    const orientationSummary = orientationNodeSummaryForServe(node) ?? (
      typeof task.description === 'string' && task.description.trim()
        ? task.description.trim()
        : undefined
    )
    return {
      ...task,
      ...((!task.title || typeof task.title !== 'string' || !task.title.trim()) && typeof scopeRow?.title === 'string' && scopeRow.title.trim()
        ? { title: scopeRow.title.trim() }
        : {}),
      ...((!task.sourceRefs || !Array.isArray(task.sourceRefs) || task.sourceRefs.length === 0) && sourceRefs.length > 0
        ? { sourceRefs }
        : {}),
      ...((!task.references || !Array.isArray(task.references) || task.references.length === 0) && sourceRefs.length > 0
        ? { references: sourceRefs }
        : {}),
      ...(orientationSummary ? { orientationSummary } : {}),
    }
  })
}

function compactTaskForProjectSummary(task: Record<string, unknown>): Record<string, unknown> {
  const summaryKeys = [
    'id',
    'title',
    'description',
    'orientationSummary',
    'domain',
    'projectPath',
    'status',
    'priority',
    'revisionCount',
    'remediationAttempts',
    'origination',
    'createdAt',
    'updatedAt',
    'completedAt',
    'assignedTo',
    'liveAgent',
    'activity',
    'importedDraft',
    'requestKind',
    'requestStage',
    'workKind',
    'workVisibility',
    'workUnitAnalysis',
    'dependsOn',
    'hierarchy',
    'releaseIds',
    'sourceRefs',
    'references',
    'semanticKind',
    'contractNames',
    'parentAcceptanceCriterionIds',
    'acceptanceCriteria',
    'acceptanceCriteriaProofState',
    'definitionOfDone',
    'proofPaths',
    'openQuestions',
    'blockReason',
    'persistedBlockReason',
    'shelveReason',
    'taskReadiness',
    'structuralIntegrity',
    'latestReviewerSummary',
    'latestSelfCritique',
    'latestCheckpoint',
    'terminalSummary',
    'sizePlan',
    'checklist',
    'workerHandoff',
    'evidenceSummary',
  ]
  const summary: Record<string, unknown> = {}
  for (const key of summaryKeys) {
    if (key in task) summary[key] = task[key]
  }
  const gitStory = parseGitStorySnapshot(task.gitStory)
  if (gitStory && gitStory.state !== 'unknown') summary.gitStory = gitStory
  const runtime = compactTaskRuntimeForProjectSummary(task.runtime)
  if (runtime) summary.runtime = runtime
  const escalations = compactTaskEscalationsForProjectSummary(task.escalations)
  if (escalations) summary.escalations = escalations
  if (Array.isArray(summary.proofPaths)) summary.proofPaths = compactProofPathsForServe(summary.proofPaths)
  const completionProof = task.completionProof && typeof task.completionProof === 'object' && !Array.isArray(task.completionProof)
    ? task.completionProof as Record<string, unknown>
    : compactTaskCompletionProof(task)
  if (completionProof) summary.completionProof = completionProof
  return summary
}

function compactTaskForWorkSurface(
  task: Record<string, unknown>,
  options: { includeDefinitions?: boolean } = {},
): Record<string, unknown> {
  const summaryKeys = [
    'id',
    'title',
    'description',
    'orientationSummary',
    'domain',
    'status',
    'priority',
    'revisionCount',
    'updatedAt',
    'completedAt',
    'assignedTo',
    'liveAgent',
    'activity',
    'importedDraft',
    'requestKind',
    'requestStage',
    'workKind',
    'workVisibility',
    'dependsOn',
    'hierarchy',
    'releaseIds',
    'sourceRefs',
    'acceptanceCriteriaProofState',
    'openQuestions',
    'blockReason',
    'persistedBlockReason',
    'shelveReason',
    'latestReviewerSummary',
    'terminalSummary',
    'checklist',
    'workerHandoff',
    'acceptanceCriteriaCount',
    'acceptanceCriteriaFirstDescription',
    'workUnitCount',
    'spec',
  ]
  const summary: Record<string, unknown> = {}
  for (const key of summaryKeys) {
    if (key in task) summary[key] = task[key]
  }
  const currentSummary = task.currentSummary && typeof task.currentSummary === 'object' && !Array.isArray(task.currentSummary)
    ? task.currentSummary as Record<string, unknown>
    : null
  if (currentSummary) {
    for (const key of ['acceptanceCriteriaCount', 'acceptanceCriteriaFirstDescription', 'workUnitCount']) {
      if (!(key in summary) && key in currentSummary) summary[key] = currentSummary[key]
    }
    if (!('spec' in summary) && currentSummary.spec === 'present') summary.spec = 'present'
  }
  if (Array.isArray(task.sourceRefs)) summary.sourceRefs = compactTaskSourceRefsForServe(task.sourceRefs)
  if (Array.isArray(task.references)) summary.references = compactTaskSourceRefsForServe(task.references)
  if (Array.isArray(task.acceptanceCriteria)) {
    summary.acceptanceCriteriaCount = task.acceptanceCriteria.length
    const firstDescription = task.acceptanceCriteria.find((criterion) =>
      criterion && typeof criterion === 'object' && typeof (criterion as Record<string, unknown>).description === 'string',
    ) as Record<string, unknown> | undefined
    if (typeof firstDescription?.description === 'string' && firstDescription.description.trim()) {
      summary.acceptanceCriteriaFirstDescription = firstDescription.description.trim()
    }
    if (options.includeDefinitions) summary.acceptanceCriteria = task.acceptanceCriteria
  }
  if (task.workUnitAnalysis && typeof task.workUnitAnalysis === 'object' && !Array.isArray(task.workUnitAnalysis)) {
    const units = (task.workUnitAnalysis as Record<string, unknown>).units
    summary.workUnitCount = Array.isArray(units) ? units.length : 0
  }
  const productBrief = compactTaskProductBriefForWorkSurface(task.productBrief)
  if (productBrief) summary.productBrief = productBrief
  if (typeof task.spec === 'string' && task.spec.trim().length > 0) summary.spec = 'present'
  const taskReadiness = compactTaskReadinessForWorkSurface(task.taskReadiness)
  if (taskReadiness) summary.taskReadiness = taskReadiness
  const latestCheckpoint = compactLatestCheckpointForWorkSurface(task.latestCheckpoint)
  if (latestCheckpoint) summary.latestCheckpoint = latestCheckpoint
  const definitionOfDone = compactDefinitionOfDoneForWorkSurface(task.definitionOfDone)
  if (definitionOfDone) summary.definitionOfDone = definitionOfDone
  const runtime = compactTaskRuntimeForProjectSummary(task.runtime)
  if (runtime) summary.runtime = runtime
  const completionProof = task.completionProof && typeof task.completionProof === 'object' && !Array.isArray(task.completionProof)
    ? task.completionProof as Record<string, unknown>
    : compactTaskCompletionProof(task)
  if (completionProof) summary.completionProof = completionProof
  return summary
}

function releaseProofMissingTaskIds(releaseReadiness: Record<string, unknown> | null | undefined): Set<string> {
  const proofMissing = Array.isArray(releaseReadiness?.proofMissingDoneTasks)
    ? releaseReadiness.proofMissingDoneTasks
    : []
  return new Set(
    proofMissing
      .map(item => item && typeof item === 'object' && !Array.isArray(item)
        ? (item as { id?: unknown }).id
        : null)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
  )
}

function releaseProofMissingCompletionProof(task: Record<string, unknown>): Record<string, unknown> {
  const base = compactTaskCompletionProof(task) ?? {}
  const missing = Array.isArray(base.missing) ? base.missing.filter((item): item is string => typeof item === 'string') : []
  const proofPaths = Array.isArray(task.proofPaths) ? task.proofPaths : []
  return {
    ...base,
    state: 'missing',
    expectedCount: typeof base.expectedCount === 'number' ? base.expectedCount : proofPaths.length,
    verifiedCount: typeof base.verifiedCount === 'number' ? base.verifiedCount : 0,
    missing: missing.length > 0
      ? missing
      : ['Selected release requires command/script proof evidence for this completed task.'],
  }
}

function applyReleaseProofMissingCompletionOverrides(
  tasks: Record<string, unknown>[],
  releaseReadiness: Record<string, unknown> | null | undefined,
): Record<string, unknown>[] {
  const proofMissingIds = releaseProofMissingTaskIds(releaseReadiness)
  if (proofMissingIds.size === 0) return tasks
  return tasks.map(task => {
    const id = typeof task.id === 'string' ? task.id : ''
    if (!proofMissingIds.has(id) || String(task.status ?? '') !== 'done') return task
    return {
      ...task,
      completionProof: releaseProofMissingCompletionProof(task),
    }
  })
}

function compactTaskProductBriefForWorkSurface(brief: unknown): Record<string, unknown> | undefined {
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return undefined
  const raw = brief as Record<string, unknown>
  const summary: Record<string, unknown> = {}
  for (const key of ['userJob', 'whyItMattersNow', 'successMetric', 'nonGoals', 'antiPatterns', 'approvedAt']) {
    if (key in raw) summary[key] = raw[key]
  }
  return Object.keys(summary).length > 0 ? summary : undefined
}

function compactTaskReadinessForWorkSurface(readiness: unknown): Record<string, unknown> | undefined {
  if (!readiness || typeof readiness !== 'object' || Array.isArray(readiness)) return undefined
  const raw = readiness as Record<string, unknown>
  const summary: Record<string, unknown> = {}
  for (const key of ['recommendation', 'summary']) {
    if (key in raw) summary[key] = raw[key]
  }
  return Object.keys(summary).length > 0 ? summary : undefined
}

function compactLatestCheckpointForWorkSurface(checkpoint: unknown): Record<string, unknown> | undefined {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) return undefined
  const raw = checkpoint as Record<string, unknown>
  const nextPlannedAction = raw.nextPlannedAction
  const nextActionKind = raw.nextActionKind
  return typeof nextPlannedAction === 'string' && nextPlannedAction.trim().length > 0
    ? {
        nextPlannedAction,
        ...(typeof nextActionKind === 'string' ? { nextActionKind } : {}),
      }
    : undefined
}

function compactDefinitionOfDoneForWorkSurface(definition: unknown): Record<string, unknown> | undefined {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return undefined
  const raw = definition as Record<string, unknown>
  const evidenceRequired = Array.isArray(raw.evidenceRequired)
    ? raw.evidenceRequired.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 1)
    : []
  return evidenceRequired.length ? { evidenceRequired } : undefined
}

function compactDeliveryQueueForWorkSurface(queue: Record<string, unknown>): Record<string, unknown> {
  const compactCandidate = (candidate: unknown): unknown => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate
    const raw = candidate as Record<string, unknown>
    return {
      ...raw,
      task: compactTaskIdentity(raw.task),
      executionBlockers: compactTaskRefList(raw.executionBlockers),
      structuralBlockers: compactPrimitiveRefList(raw.structuralBlockers),
    }
  }
  return {
    runnable: Array.isArray(queue.runnable) ? queue.runnable.map(compactCandidate) : [],
    blocked: Array.isArray(queue.blocked) ? queue.blocked.map(compactCandidate) : [],
    ...(queue.firstRunnable ? { firstRunnable: compactCandidate(queue.firstRunnable) } : {}),
  }
}

function sourceHealthForCompactOrientationSpine(spine: Record<string, unknown>): Record<string, unknown> {
  const roots = Array.isArray(spine.roots) ? spine.roots : []
  const documented = roots.reduce((sum, root) => {
    if (!root || typeof root !== 'object' || Array.isArray(root)) return sum
    const children = Array.isArray((root as Record<string, unknown>).children)
      ? (root as Record<string, unknown>).children as unknown[]
      : []
    return sum + children.filter(child => {
      if (!child || typeof child !== 'object' || Array.isArray(child)) return false
      return ((child as Record<string, unknown>).visibility as { kind?: unknown } | undefined)?.kind === 'supporting'
    }).length
  }, 0)
  const deferred = roots.reduce((sum, root) => {
    if (!root || typeof root !== 'object' || Array.isArray(root)) return sum
    const children = Array.isArray((root as Record<string, unknown>).children)
      ? (root as Record<string, unknown>).children as unknown[]
      : []
    return sum + children.filter(child => {
      if (!child || typeof child !== 'object' || Array.isArray(child)) return false
      const record = child as Record<string, unknown>
      return (record.visibility as { kind?: unknown } | undefined)?.kind === 'supporting' && record.maturity === 'deferred'
    }).length
  }, 0)
  return spine.sourceHealth && typeof spine.sourceHealth === 'object' && !Array.isArray(spine.sourceHealth)
    ? { ...spine.sourceHealth as Record<string, unknown>, documented, deferred }
    : { documented, deferred }
}

function compactOrientationSpineForWorkSurface(spine: Record<string, unknown>): Record<string, unknown> {
  const sourceHealth = sourceHealthForCompactOrientationSpine(spine)
  const nodes = compactOrientationNodes(spine.nodes)
  if (Object.keys(nodes).length === 0 && Array.isArray(spine.scopeRows)) {
    for (const row of spine.scopeRows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue
      const record = row as Record<string, unknown>
      const taskId = typeof record.taskId === 'string' ? record.taskId.trim() : ''
      if (!taskId) continue
      nodes[`work:${taskId}`] = {
        id: `work:${taskId}`,
        title: typeof record.title === 'string' ? record.title : taskId,
      }
    }
  }
  return {
    projectId: spine.projectId,
    updatedAt: spine.updatedAt,
    charter: spine.charter,
    selectedRelease: compactOrientationScope(spine.selectedRelease),
    selectedTaskScope: compactOrientationScope(spine.selectedTaskScope),
    scope: compactOrientationScope(spine.scope),
    summary: spine.summary,
    scopeRows: compactOrientationScopeRows(spine.scopeRows),
    scopeRowCounts: spine.scopeRowCounts,
    proofContracts: compactOrientationProofContracts(spine.proofContracts),
    executionBoundary: spine.executionBoundary,
    sourceHealth,
    sourceTrail: Array.isArray(spine.sourceTrail) ? spine.sourceTrail.slice(0, 5) : [],
    release: spine.release,
    roots: [],
    nodes,
  }
}

/** Overview is a status shell, not a second rendering of the Map navigator. */
function compactOrientationSpineForOverviewSurface(spine: Record<string, unknown>): Record<string, unknown> {
  return {
    projectId: spine.projectId,
    updatedAt: spine.updatedAt,
    charter: spine.charter,
    selectedRelease: compactOrientationScope(spine.selectedRelease),
    selectedTaskScope: compactOrientationScope(spine.selectedTaskScope),
    scope: compactOrientationScope(spine.scope),
    releases: Array.isArray(spine.releases) ? spine.releases.map(compactOrientationScope) : [],
    summary: spine.summary,
    activePins: Array.isArray(spine.activePins) ? spine.activePins.slice(0, 3) : [],
    scopeRows: compactOrientationScopeRows(spine.scopeRows),
    proofContracts: compactOrientationProofContracts(spine.proofContracts),
    executionBoundary: spine.executionBoundary,
    sourceHealth: sourceHealthForCompactOrientationSpine(spine),
    sourceTrail: Array.isArray(spine.sourceTrail) ? spine.sourceTrail.slice(0, 5) : [],
    gaps: Array.isArray(spine.gaps) ? spine.gaps.slice(0, 5) : [],
    // The overview does not need the full release graph, but it does need the
    // bounded blockers that explain why the current scope cannot advance.
    // Dropping them made Overview disagree with Work and Thread about the same
    // release state.
    release: compactOrientationRelease(spine.release),
    roots: [],
    nodes: {},
  }
}

function compactOrientationRelease(release: unknown): unknown {
  if (!release || typeof release !== 'object' || Array.isArray(release)) return release
  const raw = release as Record<string, unknown>
  const compact: Record<string, unknown> = {}
  for (const key of ['id', 'label', 'kind', 'state', 'lifecycleState', 'source', 'proofStyle']) {
    if (key in raw) compact[key] = raw[key]
  }
  if (Array.isArray(raw.blockers)) {
    compact.blockers = raw.blockers
      .filter((blocker): blocker is Record<string, unknown> => Boolean(blocker) && typeof blocker === 'object' && !Array.isArray(blocker))
      .slice(0, 8)
      .map(blocker => {
        const summary: Record<string, unknown> = {}
        for (const key of ['id', 'title', 'label', 'nextAction', 'owningNodeId']) {
          if (key in blocker) summary[key] = blocker[key]
        }
        return summary
      })
  }
  return compact
}

function compactOrientationSpineForMapSurface(spine: Record<string, unknown>): Record<string, unknown> {
  return {
    ...spine,
    roots: Array.isArray(spine.roots) ? spine.roots.map(compactOrientationMapNode) : [],
    nodes: {},
  }
}

/**
 * The persisted map spine stores one tree, not a second duplicate node index.
 * Expand that tree only as a response-shape adapter for older map consumers;
 * this must never calculate scope, release, or readiness.
 */
function expandStoredOrientationSpineForMap(
  spine: Record<string, unknown>,
  projectId?: string,
): Record<string, unknown> {
  const nodes: Record<string, unknown> = {}
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const node = value as Record<string, unknown>
    if (typeof node.id === 'string') nodes[node.id] = node
    if (Array.isArray(node.children)) node.children.forEach(visit)
  }
  if (Array.isArray(spine.roots)) spine.roots.forEach(visit)
  const storedNodes = spine.nodes && typeof spine.nodes === 'object' && !Array.isArray(spine.nodes)
    ? spine.nodes as Record<string, unknown>
    : {}
  return {
    ...spine,
    ...(projectId ? { projectId } : {}),
    // `scope` is a legacy response alias. Its value is already present in the
    // saved selected-task-scope projection; do not select or rebuild anything.
    scope: spine.scope ?? spine.selectedTaskScope ?? null,
    nodes: Object.keys(storedNodes).length > 0 ? storedNodes : nodes,
  }
}

function compactOrientationMapNode(node: unknown): unknown {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node
  const raw = node as Record<string, unknown>
  const compact: Record<string, unknown> = {}
  for (const key of ['id', 'kind', 'title', 'maturity']) {
    if (key in raw) compact[key] = raw[key]
  }
  const progress = compactOrientationMapProgress(raw.progress)
  if (progress) compact.progress = progress
  const taskIds = (raw.refs && typeof raw.refs === 'object' && !Array.isArray(raw.refs) && Array.isArray((raw.refs as Record<string, unknown>).taskIds))
    ? (raw.refs as Record<string, unknown>).taskIds as unknown[]
    : []
  const taskId = taskIds.find((value: unknown): value is string => typeof value === 'string')
  if (taskId) compact.refs = { taskIds: [taskId] }
  const visibilityKind = (raw.visibility as Record<string, unknown> | undefined)?.kind
  if (typeof visibilityKind === 'string') compact.visibility = { kind: visibilityKind }
  const children = Array.isArray(raw.children)
    ? raw.children.map(compactOrientationMapNode).filter(Boolean)
    : []
  compact.children = children
  return compact
}

function compactOrientationMapProgress(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const compact: Record<string, number> = {}
  for (const key of ['total', 'specced', 'active', 'proven', 'done', 'blocked', 'deferred']) {
    const count = raw[key]
    if (typeof count === 'number' && count > 0) compact[key] = count
  }
  return Object.keys(compact).length > 0 ? compact : null
}

function buildOverviewOrientationPreviewSpine(input: {
  projectId: string
  rawQueue: { tasks: Array<Record<string, unknown>>; releases: ProjectRelease[]; selectedReleaseId?: string }
  charter: Partial<ProjectOrientationCharter> | null
  startReadiness?: {
    canStart: boolean
    code?: string
    message?: string
    actionHref?: string
    focusTaskId?: string
    focusTaskTitle?: string
    focusKind?: string
  } | null
  sourceSpine?: Pick<ProjectOrientationSpine, 'selectedRelease' | 'selectedTaskScope' | 'scope' | 'summary' | 'release' | 'sourceHealth' | 'sourceTrail' | 'executionBoundary'> | null
  now?: string
}): Record<string, unknown> {
  const now = input.now ?? new Date().toISOString()
  const sourceSpine = input.sourceSpine ?? null
  const queue = {
    version: 1,
    lastUpdated: now,
    tasks: input.rawQueue.tasks as unknown as Task[],
    releases: sourceSpine?.selectedRelease
      ? [
          sourceSpine.selectedRelease as ProjectRelease,
          ...input.rawQueue.releases.filter(release => release.id !== sourceSpine.selectedRelease?.id),
        ]
      : input.rawQueue.releases,
    ...(sourceSpine?.scope?.id
      ? { selectedReleaseId: sourceSpine.scope.id }
      : input.rawQueue.selectedReleaseId ? { selectedReleaseId: input.rawQueue.selectedReleaseId } : {}),
  }
  const sourceSelectedScope = sourceSpine?.selectedTaskScope ?? sourceSpine?.scope ?? null
  const sourceSelectedRelease = sourceSpine?.selectedRelease ?? input.rawQueue.releases.find(release =>
    release.id === (sourceSelectedScope?.id ?? input.rawQueue.selectedReleaseId),
  ) ?? null
  const sourceScopeProofStyle = (sourceSelectedScope as ProjectScope | null)?.proofStyle
  const selectedScopeForProjection = sourceSelectedScope && !sourceScopeProofStyle && sourceSelectedRelease?.proofStyle
    ? { ...sourceSelectedScope, proofStyle: sourceSelectedRelease.proofStyle }
    : sourceSelectedScope
  const projection = buildProjectScopeProjection(
    queue,
    selectedScopeForProjection ? { selectedScope: selectedScopeForProjection as ProjectScope } : {},
  )
  const scope = projection.selectedScope
  const scopeRows = executionScopeRows(projection.rows)
  const selectedRelease = scope
    ? sourceSpine?.selectedRelease?.id === scope.id
      ? sourceSpine.selectedRelease
      : input.rawQueue.releases.find(release => release.id === scope.id) ?? null
    : null
  const persistedSelectedRelease = scope
    ? input.rawQueue.releases.find(release => release.id === scope.id) ?? null
    : null
  const sourceScope = scope && sourceSpine?.scope?.id === scope.id
    ? sourceSpine?.scope ?? null
    : scope && sourceSpine?.selectedTaskScope?.id === scope.id
      ? sourceSpine?.selectedTaskScope ?? null
      : null
  const sourceReleaseState = sourceSpine !== null && sourceSpine.selectedRelease?.id === scope?.id
    ? sourceSpine.release?.state
    : undefined
  const persistedReleaseIsShipped = persistedSelectedRelease?.state === 'shipped'
  const sourceReleaseIsShipped = sourceSpine?.selectedRelease?.state === 'shipped'
  const releaseLifecycleState = persistedSelectedRelease?.state ?? (
    sourceSpine?.selectedRelease?.state === 'shipped' ? 'shipped' : undefined
  )
  const release = selectedRelease
    ? {
        id: selectedRelease.id,
        label: selectedRelease.label,
        kind: selectedRelease.kind === 'milestone' ? 'milestone' : selectedRelease.kind === 'marker' ? 'marker' : 'release',
        // Readiness is derived from bounded work, but lifecycle is durable.
        // A completed shipped release must remain shipped in Overview even
        // though its readiness projection is still complete/ready.
        state: persistedReleaseIsShipped || sourceReleaseIsShipped
          ? 'shipped'
          : sourceReleaseState ?? (projection.release.state === 'ready' ? 'ready' : projection.release.state === 'blocked' ? 'blocked' : selectedRelease.state ?? 'active'),
        source: selectedRelease.source ?? 'inferred',
        description: selectedRelease.description ?? null,
        nodeIds: scope?.nodeIds ?? selectedRelease.nodeIds ?? [],
        deferredNodeIds: scope?.deferredNodeIds ?? selectedRelease.deferredNodeIds ?? [],
        proofStyle: selectedRelease.proofStyle ?? 'unspecified',
      }
    : null
  const scopeReadModel = scope
    ? {
        id: sourceScope?.id ?? scope.id,
        label: sourceScope?.label ?? scope.label,
        kind: sourceScope?.kind ?? scope.kind,
        source: sourceScope?.source ?? scope.source,
        nodeIds: scope.nodeIds,
      deferredNodeIds: scope.deferredNodeIds,
      }
    : null
  const sourceProgress = sourceSpine?.summary.progress
  const progress = {
    scopeId: scope?.id ?? null,
    // Overview completion is bounded to the selected scope. Later work is a
    // separate count and must not make a current release look less complete.
    total: projection.counts.included,
    // Maturity counts describe the assembled plan, not the bounded task page
    // used by this preview. Preserve the saved plan counts while refreshing
    // execution/proof counts from the current compact release projection.
    briefed: sourceProgress?.briefed ?? 0,
    specced: sourceProgress?.specced ?? scopeRows.filter(row => row.scope === 'included' && (row.status === 'spec_review' || row.status === 'ready')).length,
    sliced: sourceProgress?.sliced ?? 0,
    ready: projection.counts.ready,
    active: projection.counts.active,
    proven: Math.max(0, projection.counts.done - projection.counts.proofBlocked),
    done: projection.counts.done,
    blocked: projection.counts.ownerBlocked,
    deferred: projection.counts.deferred,
  }
  const hasExplicitRelease = selectedRelease !== null
  const start = input.startReadiness ?? null
  const noReleaseTerminal = !hasExplicitRelease && start?.code === 'all_terminal'
  const savedScopeLabel = scopeReadModel?.label?.trim()
  const genericScopeLabel = savedScopeLabel === 'Current task scope' || savedScopeLabel === 'Current work'
  const displayScopeLabel = genericScopeLabel && noReleaseTerminal
    ? 'Current scope'
    : savedScopeLabel ?? release?.label ?? 'Current scope'
  const startMessage = typeof start?.message === 'string' && start.message.trim()
    ? start.message.trim()
    : null
  const startHrefTaskId = start?.canStart === false && start.actionHref
    ? /^\/task\/([^/?#]+)/.exec(start.actionHref)?.[1]
    : undefined
  const startFocusTaskId = start?.focusTaskId ?? (startHrefTaskId ? decodeURIComponent(startHrefTaskId) : undefined)
  const startFocusTask = startFocusTaskId
    ? input.rawQueue.tasks.find(task => task.id === startFocusTaskId)
    : undefined
  const startFocusTaskTitle = start?.focusTaskTitle ?? (typeof startFocusTask?.title === 'string' ? startFocusTask.title : undefined)
  const focusTaskId = start?.canStart === false && startFocusTaskId
    ? startFocusTaskId
    : projection.start.focusTaskId
  const focusTaskTitle = start?.canStart === false && startFocusTaskTitle
    ? startFocusTaskTitle
    : projection.start.focusTaskTitle
  const focusKind = start?.canStart === false && start.focusKind
    ? start.focusKind
    : projection.start.focusKind
  const focusHref = start?.canStart === false && start.actionHref
    ? start.actionHref
    : projection.start.actionHref
  const terminalCompleteMessage = hasExplicitRelease && start?.code === 'all_terminal'
  const firstBlocker = projection.release.blockers[0]
  const proofMissing = projection.counts.proofBlocked > 0 || start?.code === 'proof_evidence_missing'
  const topBlocker = start?.canStart === true
    ? null
    : firstBlocker?.label ?? (
      start?.canStart === false && startMessage && !noReleaseTerminal && !terminalCompleteMessage
        ? startMessage
        : (
        projection.start.canStart || projection.start.code === 'all_terminal'
          ? null
          : projection.start.message
        )
      )
  const headline = noReleaseTerminal
    ? `${displayScopeLabel} is in progress.`
    : proofMissing
      ? `${displayScopeLabel} is waiting on proof.`
    : start?.code === 'imported_scope_shaping'
      ? `${displayScopeLabel} needs attention.`
      : projection.release.state === 'ready'
    ? `${displayScopeLabel} is complete.`
    : projection.release.state === 'blocked'
      ? `${displayScopeLabel} needs attention.`
      : projection.release.state === 'shaping'
        ? `${displayScopeLabel} is being shaped.`
        : projection.start.canStart
          ? `${displayScopeLabel} is ready to continue.`
          : `${displayScopeLabel} is being mapped.`
  const sourceHealth = input.sourceSpine
    ? sourceHealthForCompactOrientationSpine(input.sourceSpine as unknown as Record<string, unknown>)
    : {
        inferred: projection.rows.length,
        documented: [...new Set(scopeRows.flatMap(row => row.sourceRefs ?? []))]
          .filter(ref => !ref.startsWith('task:')).length,
        deferred: projection.counts.deferred,
        conflicts: 0,
        gaps: scope ? 0 : 1,
      }
  const computedSummary = {
    headline,
    purpose: input.charter?.goal ?? 'Project shape is being inferred.',
    selectedReleaseLabel: release?.label ?? null,
    selectedScopeLabel: displayScopeLabel,
    includedCount: projection.counts.included,
    includedWorkCount: projection.counts.included,
    deferredCount: projection.counts.deferred,
    deferredWorkCount: projection.counts.deferred,
    pinnedNow: focusTaskTitle ? [focusTaskTitle] : [],
    topBlocker,
    nextAction: noReleaseTerminal
      ? 'Current work has no runnable work remaining.'
      : proofMissing
        ? firstBlocker?.label ?? startMessage ?? 'Completion proof is missing or stale.'
      : projection.release.state === 'ready'
      ? 'Review completed scope.'
      : start?.canStart === false
        ? startMessage ?? 'Resolve the current start blocker.'
        : projection.start.message,
    progress,
  }
  const summary = input.sourceSpine?.summary
    ? {
        ...input.sourceSpine.summary,
        // Source context is durable, but these fields are live projection
        // state. Never let an older compact summary win over current rows.
        headline: computedSummary.headline,
        selectedReleaseLabel: computedSummary.selectedReleaseLabel,
        selectedScopeLabel: computedSummary.selectedScopeLabel,
        includedCount: computedSummary.includedCount,
        includedWorkCount: computedSummary.includedWorkCount,
        deferredCount: computedSummary.deferredCount,
        deferredWorkCount: computedSummary.deferredWorkCount,
        pinnedNow: computedSummary.pinnedNow,
        topBlocker: computedSummary.topBlocker,
        nextAction: computedSummary.nextAction,
        progress: computedSummary.progress,
      }
    : input.sourceSpine?.summary ?? computedSummary
  const releaseSummary = {
    ...(input.sourceSpine?.release ?? {
      state: projection.release.state,
      blockers: projection.release.blockers.map(blocker => ({
        id: blocker.id,
        label: blocker.label,
        ...(blocker.code ? { code: blocker.code } : {}),
        ...(blocker.owningTaskId ? { owningNodeId: taskScopeNodeId(blocker.owningTaskId) } : {}),
      })),
    }),
    ...(releaseLifecycleState ? { lifecycleState: releaseLifecycleState } : {}),
  }

  return {
    projectId: input.projectId,
    updatedAt: now,
    selectedRelease: release,
    releases: release ? [release] : [],
    selectedTaskScope: scopeReadModel,
    scope: scopeReadModel,
    charter: {
      goal: input.charter?.goal ?? null,
      targetAudience: input.charter?.targetAudience ?? null,
      currentReleaseTarget: input.charter?.currentReleaseTarget ?? null,
      successDefinition: input.charter?.successDefinition ?? null,
      nonGoals: input.charter?.nonGoals ?? [],
      source: input.charter?.source ?? 'inferred',
    },
    executionBoundary: input.sourceSpine?.executionBoundary ?? {
      label: 'Current scope',
      mode: 'unspecified',
      proofStyle: release?.proofStyle ?? 'unspecified',
      detail: 'Open the map for full execution-boundary detail.',
      source: {
        kind: 'inferred',
        refs: [],
        confidence: 'medium',
        freshness: 'fresh',
        inferred: true,
        refreshedAt: now,
      },
    },
    proofContracts: [],
    summary,
    roots: [],
    nodes: {},
    activePins: focusTaskId
      ? [{
          id: `scope-preview:${focusTaskId}`,
          nodeId: taskScopeNodeId(focusTaskId),
          label: focusTaskTitle ?? focusTaskId,
          kind: focusKind === 'spec_review' ? 'review' : start?.canStart === false ? 'owner_input' : projection.start.canStart ? 'active_work' : 'owner_input',
          href: focusHref,
        }]
      : [],
    scopeRows: scopeRows.map(row => ({
      taskId: row.taskId,
      nodeId: taskScopeNodeId(row.taskId),
      title: row.title,
      scope: row.scope,
      eligibilityReason: row.eligibilityReason,
      hierarchyRole: row.hierarchyRole,
      status: row.status,
      handoffState: row.handoffState,
      blocksStart: row.blocksStart,
      blocksRelease: row.blocksRelease,
      humanBlocking: row.humanBlocking,
      sourceRefs: row.sourceRefs,
    })),
    gaps: scope ? [] : [{
      kind: 'unplaced_task',
      label: 'No current scope has been selected yet.',
      refs: [`project:${input.projectId}`],
      severity: 'warn',
    }],
    release: releaseSummary,
    sourceHealth,
    sourceTrail: input.sourceSpine?.sourceTrail ?? [],
  }
}

function releaseReadinessReleaseFromScope(input: {
  rawQueue: { releases: ProjectRelease[]; selectedReleaseId?: string }
  scope: ProjectScope | null
  selectedReleaseId?: string
}): OrientationRelease | null {
  const scope = input.scope
  const releaseId = scope?.id ?? input.selectedReleaseId
  if (!releaseId) return null
  const existing = input.rawQueue.releases.find(release => release.id === releaseId) ?? null
  // A selected scope is not permission to invent a release definition. A
  // release is a persisted queue record; a proposed/current scope remains a
  // scope and must be rendered as one.
  if (!existing) return null
  return {
    id: existing.id,
    label: existing.label,
    kind: existing.kind === 'milestone' ? 'milestone' : existing.kind === 'marker' ? 'marker' : 'release',
    state: existing.state ?? 'active',
    source: existing.source ?? scope?.source ?? 'inferred',
    description: existing.description ?? null,
    nodeIds: scope?.nodeIds ?? existing.nodeIds ?? [],
    deferredNodeIds: scope?.deferredNodeIds ?? existing.deferredNodeIds ?? [],
    proofStyle: existing.proofStyle ?? 'unspecified',
  }
}

function releaseReadinessScopeFromProjection(
  projection: ProjectScopeProjection | null,
  fallbackScope: ProjectScope | null,
): ProjectScope | null {
  const baseScope = projection?.selectedScope ?? fallbackScope
  if (!baseScope) return null
  const rows = executionScopeRows(projection?.rows ?? [])
    .filter(row => row.countInProjectTotals !== false)
  const includedNodeIds = rows
    .filter(row => row.scope === 'included')
    .map(row => taskScopeNodeId(row.taskId))
  const deferredNodeIds = rows
    .filter(row => row.scope === 'deferred')
    .map(row => taskScopeNodeId(row.taskId))
  return {
    ...baseScope,
    nodeIds: includedNodeIds.length > 0 ? includedNodeIds : baseScope.nodeIds,
    deferredNodeIds: deferredNodeIds.length > 0 ? deferredNodeIds : baseScope.deferredNodeIds,
  }
}

function fallbackCurrentWorkScope(tasks: readonly Task[]): ProjectScope | null {
  const visibleTasks = tasks.filter(task =>
    task.id !== META_INTAKE_TASK_ID &&
    task.id !== WORKSPACE_IMPORT_TASK_ID &&
    !['archived', 'cancelled'].includes(String(task.status ?? '')),
  )
  if (visibleTasks.length === 0) return null
  return {
    id: 'current-work',
    label: 'Current task scope',
    kind: 'proposed_feature_set',
    source: 'inferred',
    nodeIds: visibleTasks
      .filter(task => task.status !== 'shelved')
      .map(task => taskScopeNodeId(task.id)),
    deferredNodeIds: visibleTasks
      .filter(task => task.status === 'shelved')
      .map(task => taskScopeNodeId(task.id)),
  }
}

function taskIdFromOrientationNodeId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.startsWith('work:') ? value.slice('work:'.length) : value
}

function overviewTaskIdsForSurface(input: {
  orientationSpine: Record<string, unknown>
  releaseReadiness: Record<string, unknown> | null
  actionModel?: ProjectActionModel | null
  selectedTaskId: string | null
}): Set<string> {
  const ids = new Set<string>()
  const addTaskId = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) ids.add(value.trim())
  }
  const addScope = (scope: unknown, limit = 4) => {
    if (!scope || typeof scope !== 'object') return
    const nodeIds = (scope as { nodeIds?: unknown }).nodeIds
    if (!Array.isArray(nodeIds)) return
    for (const nodeId of nodeIds.slice(0, limit)) addTaskId(taskIdFromOrientationNodeId(nodeId))
  }
  addScope(input.orientationSpine.selectedTaskScope)
  addScope(input.orientationSpine.selectedRelease)
  addScope(input.orientationSpine.scope)
  const releaseBlockers = input.releaseReadiness?.releaseBlockers
  if (Array.isArray(releaseBlockers)) {
    for (const blocker of releaseBlockers) {
      if (blocker && typeof blocker === 'object') addTaskId((blocker as { id?: unknown }).id)
    }
  }
  const gitBlockers = (input.releaseReadiness?.gitStory as { blockers?: unknown } | undefined)?.blockers
  if (Array.isArray(gitBlockers)) {
    for (const blocker of gitBlockers) {
      if (blocker && typeof blocker === 'object') addTaskId((blocker as { taskId?: unknown }).taskId)
    }
  }
  addTaskId(input.actionModel?.primaryAction?.taskId)
  for (const action of input.actionModel?.secondaryActions ?? []) addTaskId(action.taskId)
  addTaskId(input.selectedTaskId)
  return ids
}

function compactReleaseReadinessFromProjection(input: {
  projection: ProjectSummaryProjection
  rawQueue?: { releases: ProjectRelease[]; selectedReleaseId?: string }
  scope?: ProjectScope | null
}): Record<string, unknown> {
  const summary = input.projection.releaseSummary
  const counts = summary?.counts ?? {
    total: 0,
    done: 0,
    unfinished: 0,
    ready: 0,
    active: 0,
    blocked: 0,
    deferred: 0,
    ownerBlocked: 0,
    proofBlocked: 0,
  }
  const release = input.rawQueue
    ? releaseReadinessReleaseFromScope({
        rawQueue: input.rawQueue,
        scope: input.scope ?? null,
        selectedReleaseId: input.rawQueue.selectedReleaseId,
      })
    : summary?.release
      ? { ...summary.release, state: summary.state }
      : null
  const blockers = summary?.blockers ?? []
  const ready = summary?.state === 'ready' && counts.total > 0
  return {
    completeness: 'scope',
    checksLoaded: false,
    release,
    scope: input.scope ?? input.projection.scope,
    ready,
    // Release metrics are an explicit envelope. They are not task statuses:
    // active, blocked, ownerBlocked, proofBlocked, and deferred may overlap
    // the partitioned task-state map below.
    releaseCounts: { ...counts },
    ...(counts.total === 0 ? { notReadyReason: 'No work in the current scope yet.' } : {}),
    completion: buildReleaseCompletionSummary({
      ready,
      totals: {
        tasks: counts.total,
        done: counts.done,
        unfinishedCount: counts.unfinished,
        humanBlockingCount: counts.ownerBlocked,
      },
      releaseBlockers: blockers,
    }),
    statusCounts: summary?.taskStatusCounts ?? {},
    releaseBlockers: blockers,
    totals: {
      tasks: counts.total,
      // `blocked` already means "blocks this release" in the durable
      // projection. Owner/proof counts are dimensions of that same set, not
      // additional blockers to add again.
      blockingCount: counts.blocked,
      humanBlockingCount: counts.ownerBlocked,
      proofEvidenceBlockingCount: counts.proofBlocked,
      unfinishedCount: counts.unfinished,
      done: counts.done,
    },
  }
}

function compactOrientationScopeRows(rows: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(rows)) return []
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    .map(row => {
      const summary: Record<string, unknown> = {}
      for (const key of [
        'taskId',
        'nodeId',
        'title',
        'scope',
        'eligibilityReason',
        'hierarchyRole',
        'status',
        'handoffState',
        'blocksStart',
        'blocksRelease',
        'humanBlocking',
        'sourceRefs',
      ]) {
        if (key in row) summary[key] = row[key]
      }
      return summary
    })
}

function compactOrientationProofContracts(contracts: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(contracts)) return []
  return contracts
    .filter((contract): contract is Record<string, unknown> => Boolean(contract) && typeof contract === 'object' && !Array.isArray(contract))
    .map(contract => {
      const summary: Record<string, unknown> = {}
      for (const key of ['nodeId', 'title', 'state', 'missing', 'refs']) {
        if (key in contract) summary[key] = contract[key]
      }
      if (Array.isArray(contract.required)) summary.required = contract.required.slice(0, 2)
      if (Array.isArray(contract.verified)) summary.verified = contract.verified.slice(0, 3)
      return summary
    })
}

function taskIdsFromScopeNodeIds(scope: unknown): string[] {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return []
  const nodeIds = (scope as { nodeIds?: unknown }).nodeIds
  return Array.isArray(nodeIds)
    ? nodeIds
      .map(value => typeof value === 'string' ? value.replace(/^work:/, '') : '')
      .filter(Boolean)
    : []
}

function selectedTaskIdsForProgress(spine: Record<string, unknown>): string[] {
  return taskIdsFromScopeNodeIds(
    spine.selectedTaskScope && typeof spine.selectedTaskScope === 'object' && !Array.isArray(spine.selectedTaskScope)
      ? spine.selectedTaskScope
      : spine.scope && typeof spine.scope === 'object' && !Array.isArray(spine.scope)
        ? spine.scope
        : spine.selectedRelease && typeof spine.selectedRelease === 'object' && !Array.isArray(spine.selectedRelease)
          ? spine.selectedRelease
          : null,
  )
}

function selectedScopeForServiceProgress(
  queue: Pick<TaskQueue, 'tasks' | 'releases' | 'selectedReleaseId'>,
): ProjectScope | null {
  const scope = selectedProjectScopeForQueue(queue)
  if (taskIdsFromScopeNodeIds(scope).length > 0) return scope
  const releases = queue.releases ?? []
  const release =
    releases.find(candidate => candidate.id === queue.selectedReleaseId) ??
    releases.find(candidate => candidate.state === 'active') ??
    releases.find(candidate => candidate.state === 'planned') ??
    releases[0]
  if (!release) return fallbackCurrentWorkScope(queue.tasks)
  const releaseScope: ProjectScope = {
    id: release.id,
    label: release.label,
    kind: release.kind === 'milestone' ? 'milestone' : release.kind === 'release' ? 'release' : 'proposed_feature_set',
    source: release.source,
    nodeIds: release.nodeIds ?? [],
    deferredNodeIds: release.deferredNodeIds ?? [],
  }
  return taskIdsFromScopeNodeIds(releaseScope).length > 0
    ? releaseScope
    : fallbackCurrentWorkScope(queue.tasks)
}

function releaseBlockerTaskIdsForProgress(
  releaseReadiness: Record<string, unknown> | null,
  taskIds: ReadonlySet<string>,
): string[] {
  const releaseBlockers = releaseReadiness?.releaseBlockers
  if (!Array.isArray(releaseBlockers)) return []
  return releaseBlockers
    .map(blocker => blocker && typeof blocker === 'object'
      ? String((blocker as { id?: unknown }).id ?? '').trim()
      : '')
    .filter(id => id && taskIds.has(id))
}

function compactOrientationScope(scope: unknown): unknown {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return scope
  const raw = scope as Record<string, unknown>
  const summary: Record<string, unknown> = {}
  for (const key of ['id', 'label', 'kind', 'state', 'source', 'nodeIds', 'deferredNodeIds', 'proofStyle']) {
    if (key in raw) summary[key] = raw[key]
  }
  return summary
}

function compactOrientationNodes(nodes: unknown): Record<string, Record<string, unknown>> {
  if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) return {}
  const result: Record<string, Record<string, unknown>> = {}
  for (const [nodeId, node] of Object.entries(nodes as Record<string, unknown>)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const raw = node as Record<string, unknown>
    const summary: Record<string, unknown> = {}
    for (const key of ['id', 'parentId', 'title']) {
      if (key in raw) summary[key] = raw[key]
    }
    if (!('id' in summary)) summary.id = nodeId
    result[nodeId] = summary
  }
  return result
}

function compactTaskRoutingContextsForWorkSurface(contexts: Record<string, unknown>): Record<string, unknown> {
  const compact: Record<string, unknown> = {}
  for (const [taskId, context] of Object.entries(contexts)) {
    if (!context || typeof context !== 'object' || Array.isArray(context)) continue
    const raw = context as Record<string, unknown>
    compact[taskId] = {
      taskId: raw.taskId,
      status: raw.status,
      likelyArea: compactStructuralContextRef(raw.likelyArea),
      primaryDomain: compactStructuralContextRef(raw.primaryDomain),
    }
  }
  return compact
}

function compactStructuralContextRef(ref: unknown): unknown {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return undefined
  const raw = ref as Record<string, unknown>
  const summary: Record<string, unknown> = {}
  for (const key of ['id', 'label', 'path']) {
    if (key in raw) summary[key] = raw[key]
  }
  return Object.keys(summary).length > 0 ? summary : undefined
}

function compactTaskIdentity(task: unknown): Record<string, unknown> | undefined {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return undefined
  const raw = task as Record<string, unknown>
  const summary: Record<string, unknown> = {}
  for (const key of ['id', 'title', 'description', 'orientationSummary', 'status', 'domain', 'priority', 'workKind', 'releaseIds', 'sourceRefs', 'references']) {
    if (raw[key] !== null && raw[key] !== undefined) summary[key] = raw[key]
  }
  return summary
}

function compactTaskMapIdentity(task: unknown): Record<string, unknown> | undefined {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return undefined
  const raw = task as Record<string, unknown>
  const summary: Record<string, unknown> = {}
  for (const key of ['id', 'title', 'status', 'workKind', 'releaseIds']) {
    if (raw[key] !== null && raw[key] !== undefined) summary[key] = raw[key]
  }
  for (const key of ['sourceRefs', 'references']) {
    if (Array.isArray(raw[key]) && raw[key].length > 0) summary[key] = compactTaskSourceRefsForServe(raw[key])
  }
  return summary
}

function compactTaskForTaskDetailRelated(task: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {}
  for (const key of [
    'id',
    'title',
    'status',
    'domain',
    'priority',
    'workKind',
    'releaseIds',
    'dependsOn',
    'hierarchy',
    'taskReadiness',
  ]) {
    if (key in task) summary[key] = task[key]
  }
  return summary
}

function compactTaskRefList(items: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(items)) return []
  return items
    .map(compactTaskIdentity)
    .filter((item): item is Record<string, unknown> => Boolean(item))
}

function compactPrimitiveRefList(items: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(items)) return []
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const summary: Record<string, unknown> = {}
      for (const key of ['id', 'label', 'kind', 'status']) {
        if (key in item) summary[key] = item[key]
      }
      return summary
    })
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

function renderCurrentProjectProgress(
  taskIds: readonly string[],
  currentEvidence: ReadonlyMap<string, {
    byKind: Record<string, Array<{
      id: string
      recordedAt: string
      payload: Record<string, unknown>
    }>>
  }> | null,
): string {
  const entries = taskIds.flatMap(taskId => (currentEvidence?.get(taskId)?.byKind.note ?? [])
    .map(record => ({ taskId, record })))
    .sort((left, right) => left.record.recordedAt.localeCompare(right.record.recordedAt) || left.record.id.localeCompare(right.record.id))

  const blocks = entries.flatMap(({ taskId, record }) => {
    const payload = record.payload
    if (payload.type === 'heartbeat') return []
    const summary = [payload.content, payload.summary, payload.reason, payload.details]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      ?? JSON.stringify(payload)
    if (/error:\s*Exceeded maximum turn limit/i.test(summary)) return []
    const agentId = typeof payload.agentId === 'string' && payload.agentId.trim() ? payload.agentId : 'evidence'
    const domain = typeof payload.domain === 'string' && payload.domain.trim() ? payload.domain : 'evidence'
    const source = typeof payload.source === 'string' && payload.source.trim() ? `Source: ${payload.source.trim()}` : null
    return [
      `### 📝 NOTE — ${record.recordedAt}`,
      `**Agent:** ${agentId} | **Domain:** ${domain}`,
      `**Task:** ${taskId}`,
      '',
      summary,
      ...(source ? ['', `**${source}**`] : []),
      '',
      '---',
    ]
  })

  return ['# Progress', '', ...blocks].slice(-120).join('\n')
}

type SavedWorkspaceGoalsState = NonNullable<Awaited<ReturnType<typeof readWorkspaceGoalsState>>>
type ProjectionFreshness = 'current' | 'stale' | 'missing'

function savedWorkspaceImportFreshness(state: SavedWorkspaceGoalsState | null): ProjectionFreshness {
  if (!state) return 'missing'
  return workspaceGoalsNeedStructuralRefresh(state) ? 'stale' : 'current'
}

function savedWorkspaceImportDraft(state: SavedWorkspaceGoalsState | null): WorkspaceImportDraft | null {
  if (!state) return null
  const source = 'workspace-goals.json'
  const referencesFor = (references: readonly string[] | undefined): readonly string[] | undefined =>
    references && references.length > 0 ? [...references] : undefined
  const draft: WorkspaceImportDraft = {
    goals: state.goals.map(goal => ({
      id: goal.id,
      title: goal.title,
      rationale: goal.rationale,
      source,
      confidence: 'high' as const,
    })),
    ...(state.releases?.length
      ? {
          releases: state.releases.map(release => ({
            id: release.id,
            label: release.label,
            source: release.source ?? source,
            ...(release.state === 'active' || release.state === 'planned' || release.state === 'shipped'
              ? { scope: release.state === 'shipped' ? 'later' as const : 'current' as const }
              : {}),
            confidence: 'high' as const,
          })),
        }
      : {}),
    tasks: state.tasks.map(task => ({
      suggestedId: task.id,
      title: task.title,
      description: task.description,
      ...(task.whyThisMayMatter ? { whyThisMayMatter: task.whyThisMayMatter } : {}),
      ...(task.assumptions?.length ? { assumptions: [...task.assumptions] } : {}),
      ...(task.missingInformation?.length ? { missingInformation: [...task.missingInformation] } : {}),
      domain: task.domain,
      scope: task.scope ?? 'current',
      priority: task.priority,
      ...(task.acceptanceCriteria?.length ? { acceptanceCriteria: [...task.acceptanceCriteria] } : {}),
      ...(task.dependsOn?.length ? { dependsOn: [...task.dependsOn] } : {}),
      ...(task.proofPaths?.length ? { proofPaths: [...task.proofPaths] as unknown as Array<Record<string, unknown>> } : {}),
      ...(task.releaseIds?.length ? { releaseIds: [...task.releaseIds] } : {}),
      source: task.references?.[0] ?? source,
      ...(referencesFor(task.references) ? { references: referencesFor(task.references) } : {}),
      confidence: 'high' as const,
    })),
    milestones: state.milestones.map(milestone => ({
      title: milestone.title,
      evidence: milestone.evidence,
      source,
    })),
    context: state.context.map(context => ({ ...context })),
    stats: {
      inputSignals: state.goals.length + state.tasks.length + state.milestones.length + state.context.length,
      drafted: state.goals.length + state.tasks.length + state.milestones.length + state.context.length,
      deduped: 0,
    },
  }
  return draft
}

function savedWorkspaceImportTaskStatus(projectPath: string): string | null {
  const tasksPath = projectTasksPath(projectPath)
  const databaseTask = readProjectTaskRecordAtBoundary(tasksPath, WORKSPACE_IMPORT_TASK_ID)
  if (typeof databaseTask?.status === 'string') return databaseTask.status
  const projection = readProjectSummaryShellAtBoundary(projectPath).summary
  return projection?.recentWork.find(task => task.taskId === WORKSPACE_IMPORT_TASK_ID)?.status ?? null
}

function readBoundedManagedTextTail(filePath: string, maxBytes = 128 * 1024): string | null {
  let size: number
  try {
    size = statSync(filePath).size
  } catch {
    return null
  }
  if (size <= maxBytes) return readManagedTextFileSync(filePath, 'utf8')
  const fd = openSync(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(maxBytes)
    const bytesRead = readSync(fd, buffer, 0, maxBytes, size - maxBytes)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

function renderLegacyProjectProgress(raw: string): string {
  // Heartbeat blocks are routine forward transitions — they duplicate the
  // Live Activity feed and clutter the Recent PROGRESS.md panel.
  const parts = raw.split(/\n(?=### )/)
  const kept = parts.filter((p, i) => {
    if (i === 0 && !p.startsWith('### ')) return true
    if (/^###\s+💓\s+HEARTBEAT/.test(p)) return false
    if (/error:\s*Exceeded maximum turn limit/.test(p)) return false
    return true
  })
  const rejoined = kept.join('\n').replace(/(\n---\n)+/g, '\n---\n')
  return rejoined.split('\n').slice(-120).join('\n')
}

function readSavedRuntimeState(projectRoot: string, kind: 'runtime' | 'health') {
  const saved = existsSync(getProjectRuntimeStatePath(projectRoot))
  return readProjectRuntimeState(projectRoot).then(state => {
    const shell = readProjectSummaryShellAtBoundary(projectRoot)
    const projectedRuntime = shell.authority === 'database' ? shell.summary?.runtime ?? null : null
    const databaseAuthoritative = shell.authority === 'database'
    const effectiveState = projectedRuntime
      ? {
          ...state,
          status: projectedRuntime.status as typeof state.status,
          lastActivityAt: projectedRuntime.lastActivityAt ?? state.lastActivityAt,
          health: projectedRuntime.health
            ? { ...state.health, status: projectedRuntime.health as typeof state.health.status }
            : state.health,
        }
      : state
    const healthMissing = effectiveState.health.checkedAt === null && !projectedRuntime?.health
    const startedAt = effectiveState.lastStartedAt ? Date.parse(effectiveState.lastStartedAt) : Number.NaN
    const checkedAt = effectiveState.health.checkedAt ? Date.parse(effectiveState.health.checkedAt) : Number.NaN
    const healthBehindRuntime = Number.isFinite(startedAt)
      && Number.isFinite(checkedAt)
      && checkedAt < startedAt
    const stale = (saved || databaseAuthoritative) && effectiveState.status === 'running'
      && (healthMissing || healthBehindRuntime || (databaseAuthoritative && !projectedRuntime))
    const freshness = !saved
      ? projectedRuntime
        ? 'current'
        : 'missing'
      : kind === 'health' && healthMissing
        ? 'missing'
        : stale
          ? 'stale'
          : 'current'
    return {
      state: effectiveState,
      read: {
        source: projectedRuntime ? 'database' : saved ? 'saved' : 'missing',
        freshness,
        reason: !saved && !projectedRuntime
          ? 'runtime_state_missing'
          : databaseAuthoritative && !projectedRuntime
            ? 'runtime_projection_missing'
          : kind === 'health' && healthMissing
            ? 'runtime_health_missing'
            : stale
              ? 'runtime_health_stale'
              : null,
      },
    }
  })
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
  refreshProjectProjections: (projectRoot: string, event?: ProjectProjectionInvalidation) => Promise<void>
  startup: {
    listenerReadyAt: string | null
    refreshStartedAt: string | null
    refreshCompletedAt: string | null
    projectCount: number
    refreshedProjectCount: number
    errorCount: number
  }
} {
  const preferredProjectPath = opts.preferredProjectPath ?? opts.projectPath ?? null
  const getRegisteredProjects = () => listWorkspaces().map(entry => ({
    ...entry,
    // Registration can outlive project setup. This is cheap filesystem
    // metadata, not a project-state read, and keeps the fleet shell honest
    // for rows that have no Guildhall config yet.
    initializationNeeded: !existsSync(join(entry.path, FORGE_YAML_FILENAME)),
  }))
  const pickProjectFolder = opts.pickProjectFolder ?? chooseProjectFolderMacOS
  const explicitProjectPath = preferredProjectPath ? resolve(preferredProjectPath) : null
  const fallbackProjectPath = explicitProjectPath
    ?? getRegisteredProjects()[0]?.path
    ?? process.cwd()
  const projectPath = resolve(fallbackProjectPath)
  const startup = {
    listenerReadyAt: null as string | null,
    refreshStartedAt: null as string | null,
    refreshCompletedAt: null as string | null,
    projectCount: 0,
    refreshedProjectCount: 0,
    errorCount: 0,
  }
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
      c.req.path !== '/api/project/stop' &&
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

  app.get('/api/service/projects', async c => {
    const runsById = new Map(supervisor.list().map(run => [run.workspaceId, run]))
    const projects = readFleetProjectSummaries(getRegisteredProjects(), runsById)
    return c.json({
      pid: process.pid,
      defaultProviderStatus: buildGlobalDefaultProviderStatus(),
      projects,
    })
  })

  app.get('/api/service', async c => {
    const runsById = new Map(supervisor.list().map(run => [run.workspaceId, run]))
    const requestedProjectId = c.req.query('projectId')?.trim() || null
    const detailRequested = c.req.query('detail') === 'true'
    const registeredProjects = getRegisteredProjects().filter(entry => !requestedProjectId || entry.id === requestedProjectId)
    if (requestedProjectId) {
      const projects = readFleetProjectSummaries(registeredProjects, runsById)
      return c.json({
        pid: process.pid,
        partial: true,
        defaultProviderStatus: buildGlobalDefaultProviderStatus(),
        projects,
      })
    }
    if (!detailRequested) {
      const projects = readFleetProjectSummaries(registeredProjects, runsById)
      return c.json({
        pid: process.pid,
        partial: true,
        defaultProviderStatus: buildGlobalDefaultProviderStatus(),
        projects,
      })
    }

    // Fleet detail remains the same bounded machine projection. Deep task,
    // Thread, Git Story, and release data belong to selected project routes;
    // they must never be rebuilt for every registered project here.
    const detailedProjects = await Promise.all(readFleetProjectSummaries(registeredProjects, runsById).map(async summary => {
      if (summary.initializationNeeded) return summary
      const entry = registeredProjects.find(candidate => candidate.id === summary.id)
      if (!entry) return summary
      const [providerStatus] = await Promise.all([
        buildProjectProviderStatusForPath(entry.path, runsById.get(entry.id)?.providerStatus),
      ])
      return {
        ...summary,
        ...(providerStatus ? { providerStatus } : {}),
        projectCheckIn: summarizeProjectCheckIn(getProjectStateDir(entry.path)),
      }
    }))
    return c.json({
      pid: process.pid,
      partial: true,
      detail: 'bounded_project_summaries',
      omitted: ['task inventory', 'Thread', 'Git Story', 'repository diagnostics'],
      defaultProviderStatus: buildGlobalDefaultProviderStatus(),
      projects: detailedProjects,
    })

  })

  app.get('/api/fleet/attention', async c => {
    const registeredProjects = getRegisteredProjects()
    const runsById = new Map(supervisor.list().map(run => [run.workspaceId, run]))
    const projectSummaries = readFleetProjectSummaries(registeredProjects, runsById)
    const projectById = new Map(projectSummaries.map(project => [project.id, project]))
    const groups = registeredProjects.map(entry => {
      const project = projectById.get(entry.id) ?? unavailableFleetProjectSummary(entry)
      const attention = project.fleetAttention
      if (project.initializationNeeded) {
        return { project, items: [], error: null, topWaitingThread: null }
      }
      if (project.summaryFreshness !== 'current' || attention?.freshness !== 'current') {
        return {
          project,
          items: [],
          error: project.projectStatusError ?? 'Saved fleet attention is not available yet. Background refresh will populate it.',
          topWaitingThread: null,
        }
      }
      return {
        project,
        items: attention.items
          .filter(record => record.status === 'open')
          .filter(isAttentionOwnedInboxItem)
          .filter(item => item.severity !== 'low'),
        error: null,
        // The fleet surface only renders the bounded attention projection.
        // Thread and project inbox remain explicit project routes.
        topWaitingThread: null,
      }
    })
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
    startup: typeof startup
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
      startup: { ...startup },
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
  async function buildProjectionSurfaceDetail(input: {
    surface: 'overview' | 'work' | 'map'
    requestedTaskId: string | null
    inventoryOffset?: number
    inventoryLimit?: number
    includeConfig?: boolean
    includeDetailSections?: boolean
    surfaceState?: NonNullable<ReturnType<typeof readProjectSurfaceStateAtBoundary>>
  }): Promise<Record<string, unknown>> {
    const tasksPath = projectTasksPath(project.path)
    const inventoryOffset = Math.max(0, input.inventoryOffset ?? 0)
    const inventoryLimit = input.inventoryLimit && input.inventoryLimit > 0
      ? Math.min(100, input.inventoryLimit)
      : 100
    // Overview has its own lean saved-summary transaction. Work and Map use
    // the richer surface projection; neither path reconstructs TASKS.json.
    const overviewState = input.surface === 'overview'
      ? readProjectOverviewStateAtBoundary(project.path)
      : null
    const surfaceState = input.surface === 'overview' ? null : (input.surfaceState ?? readProjectSurfaceStateAtBoundary(project.path, {
      offset: inventoryOffset,
      limit: inventoryLimit,
      ...(input.includeDetailSections ? { includeDefinitions: true } : {}),
      ...(input.requestedTaskId ? { selectedTaskId: input.requestedTaskId } : {}),
      // Overview and Map are orientation views. The sessions boundary keeps
      // that projection opt-in so fleet shells stay small; ask for it here
      // rather than rebuilding orientation from queue rows in the route.
      ...(input.surface !== 'work' ? { includeOrientation: true } : {}),
      includeAvailability: true,
      ...(input.includeDetailSections ? { includeAttention: true } : {}),
      ...(input.includeDetailSections ? { includeMemoryHealth: true } : {}),
    }))
    const promotedState = (overviewState?.authority ?? surfaceState?.authority) === 'database'
    const compactState: ProjectCompactStateReadModel | null = surfaceState?.compact ?? null
    const savedProjection = overviewState?.summary ?? compactState?.summary ?? (promotedState ? null : readProjectSummaryForProjectAtBoundary(project.path))
    const stateQueueRevision = overviewState?.queueRevision ?? compactState?.queueRevision ?? null
    const stateProjectRevision = overviewState?.projectRevision ?? compactState?.projectRevision ?? null
    const compactProjection = savedProjection
    const storedSpine = savedProjection?.orientationSpine ?? null
    const indexedInventory = compactState?.inventory ?? null
    const promotedOrientationMissing = promotedState && !storedSpine
    // Every project surface consumes the same saved orientation snapshot. A
    // promoted project with no spine is a projection-integrity miss, not an
    // invitation to rebuild a competing spine from a paged inventory. Keep
    // the route honest and let the asynchronous projector repair it.
    const orientationRequired = true
    const projectionAvailable = compactProjection && compactProjection.freshness !== 'error' &&
      (!orientationRequired || !promotedOrientationMissing)
    const inventoryRequired = input.surface !== 'overview' || (!promotedState && !storedSpine)
    const inventoryAvailable = !inventoryRequired || indexedInventory !== null
    if (!projectionAvailable || !inventoryAvailable) {
      const run = supervisor.get(project.id)
      const summary = summarizeProjectFromProjection(
        { id: project.id, path: project.path },
        project,
        run,
        compactProjection,
      )
      const freshness = compactProjection?.freshness ?? 'missing'
      const total = indexedInventory?.total ?? summary.taskCounts?.total
      return {
        ...summary,
        initializationNeeded: false,
        id: project.id,
        path: project.path,
        name: project.config?.name ?? project.id,
        ...(input.includeConfig ? { config: project.config } : {}),
        coordinatorCount: project.config?.coordinators?.length ?? 0,
        queueRevision: compactState?.queueRevision ?? null,
        projectRevision: compactState?.projectRevision ?? null,
        selectedTaskId: null,
        tasks: [],
        orientationSpine: null,
        taskPayload: {
          surface: input.surface,
          kind: input.surface === 'overview'
            ? 'selected_scope_cards'
            : input.surface === 'map'
              ? 'project_inventory_identities'
              : 'project_work_inventory',
          offset: inventoryOffset,
          limit: inventoryLimit,
          count: 0,
          ...(typeof total === 'number' ? { totalEffectiveCount: total } : {}),
          hasMore: typeof total === 'number' ? inventoryOffset < total : false,
          ...(typeof total === 'number' && inventoryOffset < total ? { nextOffset: inventoryOffset + inventoryLimit } : {}),
        },
        detailPayload: {
          kind: 'project-summary-projection',
          freshness,
          unavailable: true,
          requiresRefresh: true,
          message: orientationRequired && promotedOrientationMissing
            ? 'The saved project orientation is unavailable. Refresh the project summary before loading work.'
            : freshness === 'stale'
            ? 'The saved project summary is stale. Refresh the project summary before loading work.'
            : 'The project summary is unavailable. Refresh the project summary before loading work.',
          omitted: ['task inventory', 'inbox', 'Thread', 'Git Story', 'repository inspection', 'request-time repair', 'task evidence and history'],
          endpoints: {
            activity: '/api/project/activity',
            activityHistory: '/api/project/activity/history',
            inbox: '/api/project/inbox',
            thread: '/api/project/thread',
            releaseReadiness: '/api/project/release-readiness',
            gitStory: '/api/project/git-story',
            taskDetail: '/api/project/task/:id',
          },
        },
      }
    }
    const databaseQueue = compactState?.queue ?? null
    const projectedReleases = databaseQueue?.releases ?? (Array.isArray(storedSpine?.releases) ? storedSpine.releases : [])
    const projectedSelectedReleaseId = databaseQueue?.selectedReleaseId ?? storedSpine?.selectedRelease?.id
    const projectedLastUpdated = databaseQueue?.lastUpdated ?? savedProjection?.source.taskQueueLastUpdated ?? undefined
    const overviewProjectionQueue = storedSpine && input.surface === 'overview' && compactProjection?.freshness === 'current'
      ? {
          version: 1,
          lastUpdated: projectedLastUpdated,
          tasks: [],
          releases: projectedReleases,
          selectedReleaseId: projectedSelectedReleaseId,
        } as unknown as TaskQueue
      : null
    // Once the current-state database exists, compact surfaces read indexed
    // rows. Legacy queue normalization remains an import/detail compatibility
    // path for missing or stale databases only.
    const rawQueue = overviewProjectionQueue ?? (indexedInventory
      ? {
          version: 1,
          lastUpdated: projectedLastUpdated,
          tasks: indexedInventory.tasks,
          releases: projectedReleases,
          selectedReleaseId: projectedSelectedReleaseId,
        } as unknown as TaskQueue
      : {
          version: 1,
          lastUpdated: projectedLastUpdated,
          tasks: [],
          releases: projectedReleases,
        } as unknown as TaskQueue)
    const projection: ProjectSummaryProjection = compactProjection
    const run = supervisor.get(project.id)
    const providerStatus = await buildProjectProviderStatusForPath(project.path, run?.providerStatus)
    const summary = summarizeProjectFromProjection(
      { id: project.id, path: project.path },
      project,
      run,
      projection,
    )
    const tasks = rawQueue.tasks as Task[]
    const scopeQueue = rawQueue
    // The boundary already selected this scope from the same SQLite snapshot.
    // A surface may format it, but it must not reconstruct a competing scope
    // from the bounded inventory page.
    const selectedScope = overviewState?.scope ?? compactState?.scope ?? storedSpine?.selectedTaskScope ?? null
    const readinessScope = selectedScope
    // Compact surfaces consume the durable projection. Full readiness, Git,
    // and repository checks remain explicit detail work on the Release view.
    const compactReleaseReadiness = compactReleaseReadinessFromProjection({
      projection,
      rawQueue: scopeQueue as never,
        scope: readinessScope as unknown as ProjectScope | null,
    })
    // Pre-promotion projects retain a narrow compatibility path until their
    // first background refresh. Promoted projects must already have the
    // durable spine; the missing-spine branch above prevents a request-time
    // rebuild from a paged inventory.
    const legacyScopeProjection = !promotedState
      ? buildProjectScopeProjection({
          version: 1,
          tasks,
          releases: scopeQueue.releases,
          ...(scopeQueue.selectedReleaseId ? { selectedReleaseId: scopeQueue.selectedReleaseId } : {}),
        } as TaskQueue)
      : undefined
    const builtOrientationSpine = storedSpine ?? (!promotedState
      ? buildOrientationSpineWithScopedReleaseTruth({
          projectId: project.id,
          charter: projection.orientation?.charter ?? null,
          selectedReleaseId: scopeQueue.selectedReleaseId,
          releases: scopeQueue.releases,
          tasks,
          runStatus: run?.status ?? 'stopped',
          startReadiness: summary.startReadiness,
          releaseReadiness: orientationReleaseReadinessFromPayload(compactReleaseReadiness),
          scopeProjection: legacyScopeProjection,
          sourceRefs: projection.orientation?.sourceRefs ?? [],
        }).orientationSpine
      : null)
    const surfaceOrientationSource = builtOrientationSpine
    if (!surfaceOrientationSource) {
      return {
        ...summary,
        id: project.id,
        path: project.path,
        name: project.config?.name ?? project.id,
        orientationSpine: null,
        detailPayload: {
          kind: 'project-summary-projection',
          freshness: compactProjection.freshness,
          unavailable: true,
          requiresRefresh: true,
          message: 'The saved project orientation is unavailable. Refresh the project summary before loading work.',
        },
      }
    }
    // The saved spine is the Overview authority. Its selected-scope summary
    // is already materialized with the full task set; rebuilding it from the
    // deliberately absent inventory would turn real membership into zero.
    const liveOrientationPreview = input.surface === 'overview'
      ? { summary: surfaceOrientationSource.summary }
      : buildOverviewOrientationPreviewSpine({
          projectId: project.id,
          rawQueue: {
            tasks: (indexedInventory?.tasks ?? tasks) as unknown as Array<Record<string, unknown>>,
            releases: scopeQueue.releases as unknown as ProjectRelease[],
            ...(scopeQueue.selectedReleaseId ? { selectedReleaseId: scopeQueue.selectedReleaseId } : {}),
          },
          charter: projection.orientation?.charter ?? null,
          startReadiness: summary.startReadiness,
          sourceSpine: surfaceOrientationSource,
        })
    const reconciledLiveSummarySpine = reconcileOrientationSpineWithReleaseTruth(
      {
        ...surfaceOrientationSource,
        summary: liveOrientationPreview.summary as ProjectOrientationSpine['summary'],
      },
      {
        ...orientationReleaseTruthFromSummary(projection.releaseSummary, scopeQueue),
      },
    )
    // Reconciliation is the shared authority for release membership and
    // progress. Do not overwrite its summary with a route-local preview: that
    // would make Overview report zero work whenever it intentionally omitted
    // the full inventory.
    const liveSummarySpine = reconciledLiveSummarySpine as unknown as Record<string, unknown>
    const initialOrientationSpine = input.surface === 'overview'
      ? compactOrientationSpineForOverviewSurface(liveSummarySpine)
      : input.surface === 'map'
        ? compactOrientationSpineForMapSurface(liveSummarySpine)
        : compactOrientationSpineForWorkSurface(liveSummarySpine)
    // A stored orientation snapshot can lag after task decomposition or
    // release selection changes. Its charter and narrative are still useful,
    // but the selected scope is owned by the same compact database snapshot
    // consumed by Release detail. Overlay only that canonical scope here so
    // every ordinary surface answers membership from one relation.
    const compactScope = overviewState?.scope ?? compactState?.scope ?? null
    const baseOrientationSpine = compactScope
      ? {
          ...initialOrientationSpine,
          selectedRelease: initialOrientationSpine.selectedRelease
            ? {
                ...initialOrientationSpine.selectedRelease,
                nodeIds: [...compactScope.nodeIds],
                deferredNodeIds: [...compactScope.deferredNodeIds],
              }
            : initialOrientationSpine.selectedRelease,
          releases: (Array.isArray(initialOrientationSpine.releases) ? initialOrientationSpine.releases : []).map(release => release.id === compactScope.id
            ? {
                ...release,
                nodeIds: [...compactScope.nodeIds],
                deferredNodeIds: [...compactScope.deferredNodeIds],
              }
            : release),
          selectedTaskScope: compactScope as unknown as OrientationScope,
          scope: compactScope as unknown as OrientationScope,
        }
      : initialOrientationSpine
    const overviewTaskIds = input.surface === 'overview'
      ? overviewTaskIdsForSurface({
          orientationSpine: baseOrientationSpine as Record<string, unknown>,
          releaseReadiness: compactReleaseReadiness,
          actionModel: summary.actionModel,
          selectedTaskId: input.requestedTaskId,
        })
      : null
    const indexedOverviewTaskRead = storedSpine && overviewTaskIds
      ? readProjectTaskRecordsAtBoundaryWithRevision(tasksPath, [...overviewTaskIds], {
          ...(input.includeDetailSections ? { includeDefinitions: true } : {}),
        })
      : null
    if (
      indexedOverviewTaskRead &&
      stateQueueRevision !== null &&
      stateProjectRevision !== null &&
      (indexedOverviewTaskRead.queueRevision !== stateQueueRevision ||
        indexedOverviewTaskRead.projectRevision !== stateProjectRevision)
    ) {
      throw new ProjectStateRevisionMismatchError(
        { queue: stateQueueRevision, project: stateProjectRevision },
        { queue: indexedOverviewTaskRead.queueRevision, project: indexedOverviewTaskRead.projectRevision },
      )
    }
    const indexedOverviewTasks = indexedOverviewTaskRead?.taskPoints ?? null
    const scopedResponseTasks = indexedOverviewTasks ?? (overviewTaskIds && overviewTaskIds.size > 0
      ? tasks.filter(task => overviewTaskIds.has(task.id))
      : tasks)
    // Overview's selected cards are bounded by the saved orientation spine.
    // Its lean boundary deliberately has no inventory; these point reads are
    // revision-checked against the saved summary snapshot above.
    const responseInventory = storedSpine && input.surface === 'overview' && compactProjection?.freshness === 'current'
      ? null
      : indexedInventory
    const responseInventoryLimit = responseInventory ? inventoryLimit : input.inventoryLimit && input.inventoryLimit > 0
      ? Math.min(100, input.inventoryLimit)
      : null
    const inventoryStart = responseInventory
      ? inventoryOffset
      : responseInventoryLimit === null
      ? 0
      : Math.min(inventoryOffset, scopedResponseTasks.length)
    const inventoryEnd = responseInventory
      ? inventoryOffset + scopedResponseTasks.length
      : responseInventoryLimit === null
      ? scopedResponseTasks.length
      : Math.min(scopedResponseTasks.length, inventoryStart + inventoryLimit)
    const pagedResponseTasks = responseInventory
      ? scopedResponseTasks
      : scopedResponseTasks.slice(inventoryStart, inventoryEnd)
    const selectedTask = input.requestedTaskId
      ? scopedResponseTasks.find(task => task.id === input.requestedTaskId)
      : undefined
    const responseTasks = selectedTask && !pagedResponseTasks.some(task => task.id === selectedTask.id)
      ? [...pagedResponseTasks, selectedTask]
      : pagedResponseTasks
    const detailTaskRead = input.includeDetailSections
      ? await readProjectTaskCurrentRecordsAtBoundary(
          project.path,
          responseTasks.map(task => task.id),
          { includeDefinitions: true },
        )
      : null
    if (
      detailTaskRead &&
      stateQueueRevision !== null &&
      stateProjectRevision !== null &&
      (detailTaskRead.queueRevision !== stateQueueRevision ||
        detailTaskRead.projectRevision !== stateProjectRevision)
    ) {
      throw new ProjectStateRevisionMismatchError(
        { queue: stateQueueRevision, project: stateProjectRevision },
        { queue: detailTaskRead.queueRevision, project: detailTaskRead.projectRevision },
      )
    }
    const detailResponseTasks = detailTaskRead
      ? await Promise.all(detailTaskRead.effectiveRecords.map((effective, index) => {
          const record = detailTaskRead.records[index] ?? effective
          return enrichTaskForServe(project.path, record, effective)
        }))
      : responseTasks as Array<Record<string, unknown>>
    const scopeRows = responseTasks.flatMap(task => {
      const scopeRow = (task as { scopeRow?: unknown }).scopeRow
      if (!scopeRow || typeof scopeRow !== 'object' || Array.isArray(scopeRow)) return []
      const row = scopeRow as Record<string, unknown>
      const scope = row.scope === 'included' || row.scope === 'deferred' ? row.scope : null
      if (!scope) return []
      return [{
        taskId: task.id,
        nodeId: taskScopeNodeId(task.id),
        title: task.title ?? task.id,
        scope,
        eligibilityReason: row.eligibilityReason ?? '',
        hierarchyRole: row.hierarchyRole ?? '',
        status: task.status ?? '',
        handoffState: row.handoffState ?? '',
        blocksStart: row.blocksStart === true,
        blocksRelease: row.blocksRelease === true,
        humanBlocking: row.humanBlocking === true,
        sourceRefs: Array.isArray(row.sourceRefs) ? row.sourceRefs : [],
      }]
    })
    const surfaceOrientationSpine = input.surface === 'overview'
      ? compactOrientationSpineForOverviewSurface(baseOrientationSpine as Record<string, unknown>)
      : input.surface === 'work'
        ? compactOrientationSpineForWorkSurface(baseOrientationSpine as Record<string, unknown>)
        : compactOrientationSpineForMapSurface(baseOrientationSpine as Record<string, unknown>)
    const orientationSpine = storedSpine && input.surface !== 'map'
      ? {
          ...surfaceOrientationSpine,
          scope: surfaceOrientationSpine.selectedTaskScope,
          scopeRows,
        }
      : surfaceOrientationSpine
      const detailSurfaceTasks = input.includeDetailSections
        ? backfillCompactTaskOrientationForServe(
            detailResponseTasks,
            orientationSpine as Record<string, unknown>,
          )
      : detailResponseTasks
    const taskPayload = detailSurfaceTasks
      .map(input.surface === 'map'
        ? compactTaskMapIdentity
        : input.surface === 'work'
          ? task => compactTaskForWorkSurface(task, { includeDefinitions: input.includeDetailSections })
          : compactTaskForProjectSummary)
      .filter((task): task is Record<string, unknown> => Boolean(task))
      const detailInbox = input.includeDetailSections
      ? readSavedAttentionSurfaceFromBoundary({
          initializationNeeded: project.initializationNeeded,
          records: surfaceState?.attentionRecords ?? null,
          watermarkSourceRevision: surfaceState?.attentionWatermark?.sourceRevision ?? null,
          projectRevision: surfaceState?.projectRevision ?? null,
          releaseTruth: projection.releaseSummary,
        })
      : null
    const detailMemoryHealth = input.includeDetailSections
      ? surfaceState?.memoryHealth?.payload ?? null
      : null
    const detailRecentEvents = input.includeDetailSections
      ? supervisor.recent(project.id, undefined, project.path)
      : null
    const totalEffectiveCount = responseInventory?.total ?? scopedResponseTasks.length
    const hasMore = responseInventory?.hasMore ?? (responseInventoryLimit !== null && inventoryEnd < totalEffectiveCount)
    return {
      ...summary,
      initializationNeeded: false,
      id: project.id,
      path: project.path,
      name: project.config?.name ?? project.id,
      tags: project.config?.tags ?? [],
      ...(input.includeConfig ? { config: project.config } : {}),
      ...(detailInbox ? { inbox: detailInbox } : {}),
      ...(detailMemoryHealth ? { memoryHealth: detailMemoryHealth } : {}),
      ...(detailRecentEvents ? { recentEvents: detailRecentEvents } : {}),
      ...(providerStatus ? { providerStatus } : {}),
      coordinatorCount: project.config?.coordinators?.length ?? 0,
      queueRevision: stateQueueRevision,
      projectRevision: stateProjectRevision,
      selectedTaskId: input.requestedTaskId && responseTasks.some(task => task.id === input.requestedTaskId)
        ? input.requestedTaskId
        : null,
      tasks: taskPayload,
      taskPayload: {
        surface: input.surface,
        kind: input.surface === 'overview'
          ? 'selected_scope_cards'
          : input.surface === 'map'
            ? 'project_inventory_identities'
            : 'project_work_inventory',
        offset: responseInventoryLimit === null ? 0 : inventoryStart,
        limit: responseInventoryLimit,
        count: taskPayload.length,
        totalEffectiveCount,
        hasMore,
        ...(hasMore ? { nextOffset: inventoryEnd } : {}),
        selectedScopeCount: (orientationSpine as { summary?: { includedWorkCount?: number } }).summary?.includedWorkCount ?? null,
        selectedScopeAndDeferredCount: (orientationSpine as { summary?: { progress?: { total?: number } } }).summary?.progress?.total ?? null,
      },
      workProgress: workProgressFromProjectSummaryProjection(projection),
      releaseReadiness: compactReleaseReadiness,
      startReadiness: summary.startReadiness,
      actionModel: summary.actionModel,
      orientationSpine,
      ...(!input.includeDetailSections ? {
        detailPayload: {
          kind: 'project-summary-projection',
          freshness: projection.freshness,
          omitted: ['inbox', 'Thread', 'Git Story', 'repository inspection', 'request-time repair', 'task evidence and history'],
          endpoints: {
            activity: '/api/project/activity',
            activityHistory: '/api/project/activity/history',
            inbox: '/api/project/inbox',
            thread: '/api/project/thread',
            releaseReadiness: '/api/project/release-readiness',
            gitStory: '/api/project/git-story',
            taskDetail: '/api/project/task/:id',
          },
        },
      } : {}),
    }
  }

  app.get('/api/project', async c => {
    const timing: Array<{ name: string; startedAt: number; endedAt?: number }> = []
    const startTiming = (name: string) => {
      const metric: { name: string; startedAt: number; endedAt?: number } = { name, startedAt: Date.now() }
      timing.push(metric)
      return () => { metric.endedAt = Date.now() }
    }
    const endTotal = startTiming('total')
    try {
      const endSetup = startTiming('setup')
      const requestedSurface = c.req.query('surface')
      const detailRequested = c.req.query('detail') === 'true'
      const diagnosticRequested = c.req.query('diagnostic') === 'true'
      const surface = requestedSurface === 'overview' || requestedSurface === 'work' || requestedSurface === 'map'
        ? requestedSurface
        : diagnosticRequested ? 'full' : 'overview'
      const fullSurface = diagnosticRequested
      const overviewSurface = surface === 'overview'
      const workSurface = surface === 'work'
      const mapSurface = surface === 'map'
      const requestedTaskId = (c.req.query('task') ?? c.req.query('work') ?? '').trim()
      if (project.initializationNeeded) {
        endSetup()
        endTotal()
        c.header('server-timing', formatServerTiming(timing))
        return c.json({
          initializationNeeded: true,
          path: project.path,
          setupUrl: `/projects/${encodeURIComponent(project.id)}/setup`,
        })
      }
      // The bounded projection is the default contract. Rich reconstruction is
      // opt-in so a forgotten query parameter cannot turn a dashboard read
      // into a multi-megabyte, repository-scanning request.
      if (!diagnosticRequested || c.req.query('compact') === 'true') {
        const requestedInventoryLimit = Number.parseInt(c.req.query('inventoryLimit') ?? '', 10)
        const requestedInventoryOffset = Number.parseInt(c.req.query('inventoryOffset') ?? '', 10)
        const payload = await buildProjectionSurfaceDetail({
          surface: surface === 'overview' || surface === 'work' || surface === 'map' ? surface : 'overview',
          requestedTaskId: requestedTaskId || null,
          ...(Number.isFinite(requestedInventoryLimit) && requestedInventoryLimit > 0
            ? { inventoryLimit: requestedInventoryLimit }
            : {}),
          ...(Number.isFinite(requestedInventoryOffset) && requestedInventoryOffset >= 0
            ? { inventoryOffset: requestedInventoryOffset }
            : {}),
          ...(detailRequested ? { includeConfig: true } : {}),
          ...(detailRequested ? { includeDetailSections: true } : {}),
        })
        endSetup()
        endTotal()
        c.header('server-timing', formatServerTiming(timing))
        return c.json(payload)
      }
      const run = supervisor.get(project.id)
      endSetup()
      const endQueue = startTiming('queue')
      const currentState = await readProjectCanonicalCurrentState(project.path)
      const rawQueue = currentState.rawQueue
      const rawTasks = rawQueue.tasks
      const compactSurfaceEffectiveTasksPromise = overviewSurface || workSurface || mapSurface
        ? Promise.resolve(currentState.tasks)
        : null
      const resolvedConfig = resolveConfig({ workspacePath: project.path })
      const runtimeProvider = getRuntimeProviderConfig({
        projectPath: project.path,
        models: resolvedConfig.models,
      })
      endQueue()
      const projectedSummary = !diagnosticRequested && currentState.summary?.freshness === 'current'
        ? summarizeProjectFromProjection(
            { id: project.id, path: project.path },
            project,
            run,
            currentState.summary,
          )
        : null
      if (!diagnosticRequested && !projectedSummary?.startReadiness) {
        endTotal()
        c.header('server-timing', formatServerTiming(timing))
        return c.json({
          error: 'The saved project summary is not available yet.',
          summaryFreshness: currentState.summary?.freshness ?? 'missing',
          projectRevision: currentState.projectRevision,
          queueRevision: currentState.queueRevision,
          requiresRefresh: true,
          detailPayload: {
            kind: 'project-summary-projection',
            freshness: currentState.summary?.freshness ?? 'missing',
            unavailable: true,
            omitted: ['request-time readiness', 'live Git inspection', 'task evidence and history'],
            requiresRefresh: true,
          },
        }, 503)
      }
      const endReadiness = diagnosticRequested ? startTiming('readiness') : null
      const startReadiness = diagnosticRequested
        ? await projectStartReadiness({
            projectPath: project.path,
            resolvedConfig,
            runtimeProvider,
            allowPaidProviderFallback: runtimeProvider.allowPaidProviderFallback,
            queue: rawQueue,
            effectiveTasks: currentState.tasks as Task[],
            scope: currentState.scope ?? null,
            summary: currentState.summary,
            startTiming: name => startTiming(`readiness_${name}`),
          })
        : projectedSummary?.startReadiness ?? null
      const releaseReadiness = fullSurface || overviewSurface || workSurface || mapSurface
        ? await buildProjectReleaseReadinessPayload({
            state: currentState,
            startReadiness: startReadiness as Awaited<ReturnType<typeof projectStartReadinessForProject>>,
            liveDiagnostics: diagnosticRequested,
          })
        : null
      endReadiness?.()
      const endTasks = startTiming('tasks')
      const tasks = overviewSurface
        ? await compactSurfaceEffectiveTasksPromise as Task[]
        : mapSurface
          ? await compactSurfaceEffectiveTasksPromise as Task[]
        : await Promise.all(rawTasks.map((task) => fullSurface
          ? enrichTaskForServe(project.path, task, undefined, { includeLiveGitStory: diagnosticRequested })
          : enrichTaskForWorkSurface(project.path, task)))
      const orientationTasks = fullSurface
        ? currentState.tasks
        : overviewSurface
          ? await compactSurfaceEffectiveTasksPromise as Task[]
          : workSurface
            ? await compactSurfaceEffectiveTasksPromise as Task[]
          : mapSurface
            ? await compactSurfaceEffectiveTasksPromise as Task[]
            : tasks as unknown as Task[]
      endTasks()
      const endAncillary = startTiming('ancillary')
      const selectedTaskId = requestedTaskId && tasks.some(task => task.id === requestedTaskId)
        ? requestedTaskId
        : null
      const deliveryModel = mapSurface ? null : await readProjectDeliveryModel(project.path)
      const deliveryQueue = deliveryModel
        ? deriveQueueCandidates({
            model: deliveryModel,
            tasks: rawTasks as Task[],
          })
        : []
      const deliveryValidation = fullSurface && deliveryModel
        ? validateProjectDeliveryModel({
            model: deliveryModel,
            tasks: rawTasks as Task[],
            projectRoot: project.path,
          })
        : null
      const deliveryPrimitives = fullSurface && deliveryModel
        ? listPrimitivesWithRelations(deliveryModel, rawTasks as Task[])
        : null
      // Rich detail may include the saved diagnostic projection, but it must
      // not turn into a repository scan unless the caller explicitly asks for
      // live diagnostics. This keeps the read boundary authoritative and
      // prevents `detail=true` from quietly becoming a second data pipeline.
      const gitStory = diagnosticRequested
        ? await buildProjectGitStorySummary(project.path, rawTasks as Array<Record<string, unknown>>)
        : null
      const preferredProvider = runtimeProvider.preferredProvider
      const preferredActiveProvider = preferredProvider
        ? normalizePreferredProvider(preferredProvider)
        : undefined
      const recent = mapSurface ? [] : supervisor.recent(project.id, undefined, project.path)
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
      const [runtime, availability] = await Promise.all([
        mapSurface ? Promise.resolve(null) : readProjectRuntimeState(project.path),
        readProjectAvailability(project.path),
      ])
      const memoryHealth = fullSurface ? currentState.memoryHealth?.payload ?? null : null
      const acceptedStructuralMap = mapSurface ? null : readAcceptedStructuralMap(project.path)
      const structuralMapReview = acceptedStructuralMap ? summarizeStructuralMapForReview(acceptedStructuralMap) : null
      const taskRoutingContexts = mapSurface
        ? {}
        : summarizeStructuralTaskContexts({
            map: acceptedStructuralMap,
            tasks: tasks
              .filter((task): task is typeof task & { id: string } => typeof task.id === 'string')
              .map(task => ({
                id: task.id,
                title: typeof task.title === 'string' ? task.title : task.id,
                description: typeof task.description === 'string' ? task.description : undefined,
                spec: typeof task.spec === 'string' ? task.spec : undefined,
                domain: typeof task.domain === 'string' ? task.domain : undefined,
              })) as never,
      })
      endAncillary()
      const endThreadInbox = startTiming('thread_inbox')
      const inbox = mapSurface
        ? null
        : readSavedAttentionSurface(
            project.path,
            project.initializationNeeded,
            currentState.summary?.releaseSummary ?? null,
          )
      const thread = mapSurface
        ? null
        : readThreadReadProjection(project.path).payload
      endThreadInbox()
      const endSpine = startTiming('spine')
      const storedOrientationSpine = currentState.summary?.orientationSpine
      if (!storedOrientationSpine || typeof storedOrientationSpine !== 'object' || Array.isArray(storedOrientationSpine)) {
        endSpine()
        endTotal()
        c.header('server-timing', formatServerTiming(timing))
        return c.json({
          error: 'The saved project orientation is not available yet.',
          detailPayload: {
            kind: 'project-summary-projection',
            freshness: currentState.summary?.freshness ?? 'missing',
            unavailable: true,
            requiresRefresh: true,
          },
        }, 503)
      }
      // Rich project detail consumes the same saved orientation projection as
      // Map, Overview, Work, and Release. Detail diagnostics are allowed to
      // inspect live proof/Git state, but they do not rebuild the project map.
      const fullOrientationSpine = expandStoredOrientationSpineForMap(
        storedOrientationSpine as unknown as Record<string, unknown>,
        project.id,
      ) as unknown as ReturnType<typeof buildOrientationSpineWithScopedReleaseTruth>['orientationSpine']
      const savedReleaseSummary = currentState.summary?.releaseSummary
      const orientationReleaseTruth = diagnosticRequested && releaseReadiness && isRecord(releaseReadiness)
        ? orientationReleaseTruthFromReadinessPayload(releaseReadiness, savedReleaseSummary, rawQueue)
        : orientationReleaseTruthFromSummary(savedReleaseSummary, rawQueue)
      const reconciledOrientationSpine = reconcileOrientationSpineWithReleaseTruth(
        fullOrientationSpine,
        orientationReleaseTruth,
      )
      const currentOrientationPreview = buildOverviewOrientationPreviewSpine({
        projectId: project.id,
        rawQueue: {
          tasks: orientationTasks as unknown as Array<Record<string, unknown>>,
          releases: rawQueue.releases as unknown as ProjectRelease[],
          ...(rawQueue.selectedReleaseId ? { selectedReleaseId: rawQueue.selectedReleaseId } : {}),
        },
        charter: reconciledOrientationSpine.charter,
        startReadiness,
        sourceSpine: reconciledOrientationSpine,
      })
      const orientationSpine = overviewSurface
        ? compactOrientationSpineForOverviewSurface(reconciledOrientationSpine as unknown as Record<string, unknown>)
        : {
            ...reconciledOrientationSpine,
            summary: currentOrientationPreview.summary,
          }
      const selectedProgressTaskIds = selectedTaskIdsForProgress(orientationSpine as Record<string, unknown>)
      const progressTaskIds = new Set(
        (orientationTasks as unknown as Task[])
          .map(task => task.id)
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
      )
      const blockerTaskIds = releaseBlockerTaskIdsForProgress(releaseReadiness, progressTaskIds)
      const workProgress = !diagnosticRequested && currentState.summary
        ? workProgressFromProjectSummaryProjection(currentState.summary)
        : deriveProjectWorkProgress(
            orientationTasks as unknown as Array<Record<string, unknown>>,
            {
              ...(selectedProgressTaskIds.length > 0 ? { selectedTaskIds: selectedProgressTaskIds } : {}),
              ...(blockerTaskIds.length > 0 ? { blockerTaskIds } : {}),
            },
          )
      endSpine()
      const actionModel = !diagnosticRequested
          ? run
            ? buildProjectActionModel({
                startReadiness,
                tasks: tasks as never,
                runStatus: run.status,
                runMode: run.mode,
                availability,
              })
            : projectedSummary?.actionModel ?? currentState.summary?.actionModel ?? null
        : (() => {
            const actionScope = orientationSpine.selectedTaskScope ?? orientationSpine.scope ?? null
            const actionTasksById = new Map((orientationTasks as unknown as Task[]).map(candidate => [candidate.id, candidate]))
            const scopedActionTaskIds = actionScope
              ? new Set(
                  (orientationTasks as unknown as Task[])
                    .filter(task => taskEligibleForSelectedScope(task, actionScope as unknown as ProjectScope, {
                      tasksById: actionTasksById,
                    }).eligible)
                    .map(task => task.id),
                )
              : null
            const actionTasks = scopedActionTaskIds
              ? tasks.filter(task => typeof task.id === 'string' && scopedActionTaskIds.has(task.id))
              : tasks
            return buildProjectActionModel({
              startReadiness,
              inbox,
              tasks: actionTasks as never,
              thread: thread as never,
              runStatus: run?.status ?? 'stopped',
              runMode: run?.mode,
              availability,
            })
          })()
      const endResponse = startTiming('response')
      const overviewTaskIds = overviewSurface
        ? overviewTaskIdsForSurface({
            orientationSpine: orientationSpine as unknown as Record<string, unknown>,
            releaseReadiness,
            actionModel,
            selectedTaskId,
          })
        : null
      const proofAdjustedTasks = applyReleaseProofMissingCompletionOverrides(tasks as Array<Record<string, unknown>>, releaseReadiness)
      const responseTasks = overviewTaskIds && overviewTaskIds.size > 0
        ? proofAdjustedTasks.filter(task => typeof task.id === 'string' && overviewTaskIds.has(task.id))
        : proofAdjustedTasks
      const surfaceTasks = backfillCompactTaskOrientationForServe(
        responseTasks,
        fullOrientationSpine as unknown as Record<string, unknown>,
      )
      const taskPayload = {
        surface,
        kind: overviewSurface
          ? 'selected_scope_cards'
          : mapSurface
            ? 'project_inventory_identities'
            : workSurface
              ? 'project_work_inventory'
              : 'project_full_inventory',
        count: responseTasks.length,
        totalEffectiveCount: orientationTasks.length,
        selectedScopeCount: (orientationSpine.summary as { includedWorkCount?: number } | undefined)?.includedWorkCount ?? null,
        selectedScopeAndDeferredCount: (orientationSpine.summary as { progress?: { total?: number } } | undefined)?.progress?.total ?? null,
      }
      const payload = {
        initializationNeeded: false,
        id: project.id,
        path: project.path,
        name: project.config?.name ?? project.id,
        summaryFreshness: currentState.summary?.freshness ?? 'missing',
        projectRevision: currentState.projectRevision,
        queueRevision: currentState.queueRevision,
        ...(currentState.summary?.freshness !== 'current' ? { requiresRefresh: true } : {}),
        tags: project.config?.tags ?? [],
        config: project.config,
        selectedTaskId,
        tasks: (surfaceTasks as Record<string, unknown>[]).map(task =>
          mapSurface ? compactTaskIdentity(task) : fullSurface ? compactTaskForProjectSummary(task) : compactTaskForWorkSurface(task),
        ),
        taskPayload,
        workProgress,
        ...(inbox ? { inbox } : {}),
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
        ...(!mapSurface && runtime ? { runtime } : {}),
        ...(memoryHealth ? { memoryHealth } : {}),
        ...(structuralMapReview ? { structuralMapReview } : {}),
        ...(!mapSurface
          ? {
              taskRoutingContexts: fullSurface
                ? taskRoutingContexts
                : compactTaskRoutingContextsForWorkSurface(taskRoutingContexts as Record<string, unknown>),
            }
          : {}),
        ...(gitStory ? { gitStory } : {}),
        ...(releaseReadiness ? { releaseReadiness } : {}),
        startReadiness,
        actionModel,
        orientationSpine: mapSurface
          ? compactOrientationSpineForMapSurface(orientationSpine as unknown as Record<string, unknown>)
          : fullSurface || overviewSurface
            ? orientationSpine
            : compactOrientationSpineForWorkSurface(orientationSpine as unknown as Record<string, unknown>),
        deliverySpine: fullSurface
          ? {
              model: deliveryModel,
              validation: deliveryValidation,
              primitives: deliveryPrimitives,
              queue: deliveryQueue,
            }
          : {
              queue: compactDeliveryQueueForWorkSurface(deliveryQueue as unknown as Record<string, unknown>),
            },
        ...(!mapSurface ? { recentEvents: recent } : {}),
        ...(bootstrapStatus ? { bootstrapStatus } : {}),
      }
      endResponse()
      endTotal()
      c.header('server-timing', formatServerTiming(timing))
      return c.json(payload)
    } catch (err) {
      if (err instanceof ProjectStateRevisionMismatchError) {
        return c.json({
          error: err.message,
          code: err.code,
          requiresRefresh: true,
          expectedRevision: err.expected,
          actualRevision: err.actual,
        }, 503)
      }
      endTotal()
      c.header('server-timing', formatServerTiming(timing))
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/spine', async c => {
    try {
      const surface = c.req.query('surface')
      const overviewSurface = surface === 'overview'
      const compactSurface = c.req.query('compact') === 'true'
      if (project.initializationNeeded) {
        const spine = buildOrientationSpineWithScopedReleaseTruth({
          projectId: project.id,
          charter: null,
          tasks: [],
        }).orientationSpine
        return c.json({
          spine: overviewSurface ? compactOrientationSpineForWorkSurface(spine as unknown as Record<string, unknown>) : spine,
          initializationNeeded: true,
        })
      }
      if (compactSurface) {
        const tasksPath = projectTasksPath(project.path)
        const surfaceState = readProjectSurfaceStateAtBoundary(project.path, { limit: 1 })
        const promotedState = surfaceState?.authority === 'database'
        const compactState = surfaceState?.compact ?? null
        const savedProjection = compactState?.summary ?? (promotedState ? null : readProjectSummaryForProjectAtBoundary(project.path))
        const run = supervisor.get(project.id)
        const summary = summarizeProjectFromProjection(
          { id: project.id, path: project.path },
          project,
          run,
          savedProjection,
        )
        const storedSpine = savedProjection?.orientationSpine
        if (!storedSpine) {
          return c.json({
            spine: null,
            summary,
            completeness: 'unavailable',
            checksLoaded: false,
          })
        }
        // This route is consumed by Structure and Releases. A compact read
        // must use the same release truth as Overview, Work, and Map. The
        // stored spine is the durable source context, but its node maturity
        // and proof details are a projection that must be reconciled before
        // any surface-specific compaction.
        const reconciledSpine = reconcileOrientationSpineWithReleaseTruth(
          expandStoredOrientationSpineForMap(
            storedSpine as unknown as Record<string, unknown>,
            project.id,
          ) as unknown as ProjectOrientationSpine,
          orientationReleaseTruthFromSummary(savedProjection?.releaseSummary, compactState?.queue),
        )
        const compactSpine = overviewSurface
          ? compactOrientationSpineForOverviewSurface(reconciledSpine as unknown as Record<string, unknown>)
          : surface === 'map'
            ? compactOrientationSpineForMapSurface(reconciledSpine as unknown as Record<string, unknown>)
            : compactOrientationSpineForWorkSurface(reconciledSpine as unknown as Record<string, unknown>)
        return c.json({
          spine: { ...compactSpine, nodes: {} },
          summary,
          completeness: 'scope',
          checksLoaded: false,
        })
      }

      const compactState = readProjectCompactStateModel(projectTasksPath(project.path), { limit: 1 })
      const savedProjection = compactState?.summary
      if (!savedProjection) {
        return c.json({
          error: 'The saved project summary is not available yet.',
          checksLoaded: false,
        }, 503)
      }
      const projection: ProjectSummaryProjection = savedProjection
      const projectedSummary = summarizeProjectFromProjection(
        { id: project.id, path: project.path },
        project,
        supervisor.get(project.id),
        projection,
      )
      const storedSpine = projection.orientationSpine
      if (!storedSpine || typeof storedSpine !== 'object' || Array.isArray(storedSpine)) {
        return c.json({
          error: 'The saved project orientation is not available yet.',
          summaryFreshness: projection.freshness,
          checksLoaded: false,
          requiresRefresh: true,
        }, 503)
      }
      const spine = reconcileOrientationSpineWithReleaseTruth(
        expandStoredOrientationSpineForMap(
          storedSpine as unknown as Record<string, unknown>,
          project.id,
        ) as unknown as ProjectOrientationSpine,
        orientationReleaseTruthFromSummary(projection.releaseSummary, compactState?.queue),
      )
      return c.json({
        spine: overviewSurface
          ? compactOrientationSpineForOverviewSurface(spine as unknown as Record<string, unknown>)
          : spine,
        summaryFreshness: projection.freshness,
        queueRevision: compactState?.queueRevision ?? null,
        projectRevision: compactState?.projectRevision ?? null,
        checksLoaded: false,
        ...(projection.freshness !== 'current' ? { requiresRefresh: true } : {}),
      })
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
      const startReadiness = await projectStartReadinessForProject(project.path)
      const queueBeforeSelection = await readTaskQueueFileNormalized(projectTasksPath(project.path))
      const tasksBeforeSelection = await buildEffectiveTasks(project.path, queueBeforeSelection.tasks as Task[])
      const { orientationSpine: selectableSpine } = buildOrientationSpineWithScopedReleaseTruth({
        projectId: project.id,
        charter: inferProjectCharterFromExistingSources(project.path, project.config),
        selectedReleaseId: queueBeforeSelection.selectedReleaseId,
        releases: queueBeforeSelection.releases,
        tasks: tasksBeforeSelection as unknown as Task[],
        runStatus: supervisor.get(project.id)?.status ?? 'stopped',
        startReadiness,
        sourceRefs: projectOrientationSourceRefs(project.path),
      })
      const result = await writeProjectReleaseEnvelope(
        projectTasksPath(project.path),
        releaseId,
        selectableSpine.releases as ProjectRelease[],
        { preserveExistingLifecycleState: true },
      )
      const rawQueue = await readTaskQueueFileNormalized(projectTasksPath(project.path))
      const tasks = await buildEffectiveTasks(project.path, rawQueue.tasks as Task[])
      const { orientationSpine: spine } = buildOrientationSpineWithScopedReleaseTruth({
        projectId: project.id,
        charter: inferProjectCharterFromExistingSources(project.path, project.config),
        selectedReleaseId: result.selectedReleaseId,
        releases: rawQueue.releases,
        tasks: tasks as unknown as Task[],
        runStatus: supervisor.get(project.id)?.status ?? 'stopped',
        startReadiness,
        sourceRefs: projectOrientationSourceRefs(project.path),
      })
      return c.json({ ...result, spine })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, /not found|no release|no task queue/i.test(message) ? 404 : 500)
    }
  })

  // POST /api/project/release/close — explicitly ship the selected release
  // after the saved summary proves its bounded work is complete.
  app.post('/api/project/release/close', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const body = await c.req.json().catch(() => ({})) as { releaseId?: unknown }
      // Shipping is a mutating boundary, so it must inspect the same current
      // readiness truth that an explicit live release read exposes. A saved
      // projection is intentionally sufficient for ordinary reads, but it is
      // not sufficient to authorize an irreversible lifecycle transition.
      const state = await readProjectReleaseState(project.path, { liveDiagnostics: true })
      const releaseId = typeof body.releaseId === 'string' && body.releaseId.trim()
        ? body.releaseId.trim()
        : state.rawQueue.selectedReleaseId
      if (!releaseId) return c.json({ error: 'releaseId is required.' }, 400)
      if (state.rawQueue.selectedReleaseId !== releaseId) {
        return c.json({ error: 'Only the selected release can be shipped. Select it first.' }, 409)
      }
      const release = state.rawQueue.releases.find(candidate => candidate.id === releaseId)
      if (!release) return c.json({ error: 'Release not found in this project.' }, 404)
      const liveReadiness = await buildProjectReleaseReadinessPayload({
        state,
        liveDiagnostics: true,
      })
      const liveVerdict = isRecord(liveReadiness.verdict) ? liveReadiness.verdict : null
      const liveTotals = isRecord(liveReadiness.totals) ? liveReadiness.totals : null
      const result = closeReleaseIfReady(
        release,
        {
          state: typeof liveVerdict?.state === 'string' ? liveVerdict.state : null,
          counts: {
            total: typeof liveTotals?.tasks === 'number' ? liveTotals.tasks : 0,
            done: typeof liveTotals?.done === 'number' ? liveTotals.done : 0,
            unfinished: typeof liveTotals?.unfinishedCount === 'number' ? liveTotals.unfinishedCount : 0,
            blocked: typeof liveTotals?.blockingCount === 'number' ? liveTotals.blockingCount : 0,
            proofBlocked: typeof liveTotals?.proofEvidenceBlockingCount === 'number'
              ? liveTotals.proofEvidenceBlockingCount
              : 0,
          },
        },
        new Date().toISOString(),
      )
      if (!result.ok) {
        return c.json({
          error: result.message ?? 'Release is not ready to ship.',
          code: result.code,
          release: result.release,
        }, 409)
      }
      if (result.code === 'already_shipped') {
        return c.json({ ok: true, alreadyShipped: true, release: result.release, selectedReleaseId: releaseId })
      }
      const nextReleases = state.rawQueue.releases.map(candidate =>
        candidate.id === releaseId ? result.release : candidate,
      )
      const written = await writeProjectReleaseEnvelope(projectTasksPath(project.path), releaseId, nextReleases)
      return c.json({ ok: true, release: written.release, selectedReleaseId: written.selectedReleaseId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, /not found|no release|not initialized/i.test(message) ? 404 : 500)
    }
  })

  app.post('/api/project/source-conflicts/reconcile', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const body = await c.req.json().catch(() => ({})) as {
        keepTaskId?: unknown
        archiveTaskId?: unknown
        selectedReleaseId?: unknown
      }
      const keepTaskId = typeof body.keepTaskId === 'string' ? body.keepTaskId.trim() : ''
      const archiveTaskId = typeof body.archiveTaskId === 'string' ? body.archiveTaskId.trim() : ''
      const selectedReleaseId = typeof body.selectedReleaseId === 'string' ? body.selectedReleaseId.trim() : undefined
      if (!keepTaskId) return c.json({ error: 'keepTaskId is required.' }, 400)
      if (!archiveTaskId) return c.json({ error: 'archiveTaskId is required.' }, 400)
      const tasksPath = projectTasksPath(project.path)
      const queue = await readTaskQueueFileNormalized(tasksPath)
      const tasks = await buildEffectiveTasks(project.path, queue.tasks as Task[])
      const startReadinessBefore = await projectStartReadinessForProject(project.path)
      const { orientationSpine } = buildOrientationSpineWithScopedReleaseTruth({
        projectId: project.id,
        charter: inferProjectCharterFromExistingSources(project.path, project.config),
        selectedReleaseId: selectedReleaseId ?? queue.selectedReleaseId,
        releases: queue.releases,
        tasks: tasks as unknown as Task[],
        runStatus: supervisor.get(project.id)?.status ?? 'stopped',
        startReadiness: startReadinessBefore,
        sourceRefs: projectOrientationSourceRefs(project.path),
      })
      const sourceConflictMatches = orientationSpine.gaps.some(gap => {
        if (gap.kind !== 'source_conflict') return false
        const refs = new Set(gap.refs ?? [])
        return refs.has(`task:${keepTaskId}`) && refs.has(`task:${archiveTaskId}`)
      })
      if (!sourceConflictMatches) {
        return c.json({ error: 'Choose tasks from the current source conflict before reconciling.' }, 400)
      }
      const now = new Date().toISOString()
      const reconciled = applySourceConflictReconciliation({
        queue: {
          tasks: queue.tasks as Task[],
          releases: queue.releases,
          selectedReleaseId: queue.selectedReleaseId,
        },
        selectedReleaseId,
        keepTaskId,
        archiveTaskId,
        now,
        actor: 'human',
      })
      await writeTaskQueueFilePreservingQueue(tasksPath, {
        tasks: reconciled.tasks as unknown as Array<Record<string, unknown>>,
        releases: reconciled.releases,
        selectedReleaseId: reconciled.selectedReleaseId,
      }, project.path)
      const nextQueue = await readTaskQueueFileNormalized(tasksPath)
      const startReadiness = await projectStartReadinessForProject(project.path)
      return c.json({
        ok: true,
        selectedReleaseId: nextQueue.selectedReleaseId,
        keepTask: {
          id: reconciled.keepTask.id,
          title: reconciled.keepTask.title,
          releaseIds: reconciled.keepTask.releaseIds ?? [],
        },
        archivedTask: {
          id: reconciled.archivedTask.id,
          title: reconciled.archivedTask.title,
          status: reconciled.archivedTask.status,
        },
        startReadiness,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: message }, /not found|required|different tasks/i.test(message) ? 400 : 500)
    }
  })

  app.get('/api/project/project-graph', async c => {
    try {
      const graphState = readProjectGraphStateModel(projectTasksPath(project.path))
      const tasks = graphState?.inventory.tasks.map(orientationTaskFromMapRow) ?? []
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
      const runtime = await readSavedRuntimeState(project.path, 'runtime')
      return c.json({ ...runtime.state, read: runtime.read })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/runtime/health', async c => {
    try {
      const runtime = await readSavedRuntimeState(project.path, 'health')
      return c.json({ ...runtime.state.health, read: runtime.read })
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
      // Capture the currently open migration records before applying them so
      // the explicit write boundary can preserve their resolved history.
      await buildProjectInboxSnapshot({
        projectPath: project.path,
        initializationNeeded: project.initializationNeeded,
        coordinatorCount: project.config?.coordinators?.length ?? 0,
        materializeAttention: true,
      })
      const result = await applyProjectMigrations({
        projectRoot: project.path,
        includePrompt: body.includePrompt === true,
        ...(body.migrationId ? { only: [body.migrationId] } : {}),
      })
      if (result.applied.length > 0) {
        const refreshed = resolveProject(project.path)
        await buildProjectInboxSnapshot({
          projectPath: project.path,
          initializationNeeded: refreshed.initializationNeeded,
          coordinatorCount: refreshed.config?.coordinators?.length ?? 0,
          materializeAttention: true,
        })
      }
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
    startTiming?: (name: string) => () => void
  } & StartStateSnapshot): Promise<{
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
    executionScope?: StartExecutionScopeSummary
  }> {
    const time = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      const end = input.startTiming?.(name)
      try {
        return await fn()
      } finally {
        end?.()
      }
    }
    const executionScope = await time('scope', () => startExecutionScopeSummary(input.projectPath, input.requestedTaskId, {
      queue: input.queue,
      effectiveTasks: input.effectiveTasks,
      scope: input.scope,
    }))
    const attachExecutionScope = <T extends { canStart: boolean }>(status: T): T & { executionScope?: StartExecutionScopeSummary } =>
      executionScope ? { ...status, executionScope } : status
    const startStateOptions = {
      queue: input.queue,
      effectiveTasks: input.effectiveTasks,
      scope: input.scope,
    }

    const runtimeBlocker = projectRuntimeCompatibilityBlocker({ projectRoot: input.projectPath })
    if (runtimeBlocker) return attachExecutionScope(runtimeBlocker)

    const requiredMigrationBlocker = await time('migrations', () => startBlockerForRequiredMigrations(input.projectPath))
    if (requiredMigrationBlocker) return attachExecutionScope(requiredMigrationBlocker)

    const ownerInputBlocker = startBlockerForOwnerInput(input.projectPath, input.ownerInput)
    if (ownerInputBlocker) return attachExecutionScope(ownerInputBlocker)

    const terminal = await time('terminal', () => terminalStartState(input.projectPath, input.requestedTaskId, {
      queue: input.queue,
      effectiveTasks: input.effectiveTasks,
      scope: input.scope,
    }))
    const hasMaterializedStartWork = await time('materialized', () => hasMaterializedScopedStartWork(
      input.projectPath,
      input.requestedTaskId,
      startStateOptions,
    ))
    // A promoted project already has the queue, effective tasks, and selected
    // scope from one canonical read bundle. The old coverage routine is a
    // legacy compatibility checker: it rereads workspace-goals, scans docs,
    // and can materialize an import draft. It is not allowed to participate in
    // a promoted read or Start decision. Its durable replacement belongs in
    // the projection refresh that produced this snapshot.
    const hasCapturedCurrentState = input.queue !== undefined &&
      input.effectiveTasks !== undefined &&
      input.scope !== undefined
    const workspaceImportCoverageBlocker = hasMaterializedStartWork || hasCapturedCurrentState
      ? null
      : await time('workspace_coverage', () => startBlockerForWorkspaceImportCoverage(input.projectPath, startStateOptions))
    if (workspaceImportCoverageBlocker) return attachExecutionScope(workspaceImportCoverageBlocker)

    const orientationShapingBlocker = await time('shape', () => startBlockerForOrientationScopeShaping(
      input.projectPath,
      input.requestedTaskId,
      startStateOptions,
    ))
    if (input.allowTaskReadinessBlocker !== false) {
      const selectedReleaseReviewBlocker = await time('release_review', () => startBlockerForSelectedReleaseReview(
        input.projectPath,
        input.resolvedConfig,
        startStateOptions,
      ))
      if (selectedReleaseReviewBlocker) return attachExecutionScope(selectedReleaseReviewBlocker)
    }

    if (orientationShapingBlocker) return attachExecutionScope(orientationShapingBlocker)

    const importDraftBlocker = await time('drafts', () => startBlockerForImportDrafts(
      input.projectPath,
      input.requestedTaskId,
      startStateOptions,
    ))
    if (importDraftBlocker) return attachExecutionScope(importDraftBlocker)

    // A canonical read bundle contains the current task/evidence state, so
    // its terminal calculation is authoritative whenever it is available.
    // The saved compact summary is the fallback for intentionally compact
    // reads that omit enough detail to calculate terminal proof directly.
    if (terminal && terminal.code !== 'proof_evidence_missing') {
      return attachExecutionScope(startReadinessForTerminalState(terminal))
    }
    if (terminal?.code === 'proof_evidence_missing') {
      return attachExecutionScope(startReadinessForTerminalState(terminal))
    }
    const savedProofBlocker = savedProofEvidenceStartBlocker(input.summary, input.requestedTaskId)
    if (savedProofBlocker) return attachExecutionScope(savedProofBlocker)

    if (input.allowTaskReadinessBlocker !== false) {
      const taskReadinessBlocker = await time('task_readiness', () => startBlockerForTaskReadiness(input.projectPath, {
        queue: input.queue,
        effectiveTasks: input.effectiveTasks,
        scope: input.scope,
      }))
      if (taskReadinessBlocker) return attachExecutionScope(taskReadinessBlocker)
    }

    if (terminal) {
      return attachExecutionScope(startReadinessForTerminalState(terminal))
    }

    try {
      const settings = await time('levers', () => loadLeverSettings({
        path: defaultAgentSettingsPath(input.projectPath),
      }))
      const invariant = projectLeverInvariantError(settings.project)
      if (invariant) {
        return attachExecutionScope({
          canStart: false,
          code: 'invalid_lever_combo',
          message: invariant,
          actionHref: '/settings/advanced',
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/concurrent_task_dispatch.*worktree_isolation/i.test(message)) {
        return attachExecutionScope({
          canStart: false,
          code: 'invalid_lever_combo',
          message,
          actionHref: '/settings/advanced',
        })
      }
    }

    const preflight = await time('provider_preflight', () => selectApiClient(input.runtimeProvider.selectOptions))
    if (preflight.providerName === 'none') {
      return attachExecutionScope({
        canStart: false,
        code: 'no_provider',
        message:
          preflight.reason ??
          'No provider configured. Open Providers to choose one before starting.',
        actionHref: '/providers',
      })
    }

    if (preflight.providerName !== 'llama-cpp') {
      return attachExecutionScope(await time('ready_status', () => readyStartStatus(
        input.projectPath,
        input.requestedTaskId,
        basename(input.projectPath),
        startStateOptions,
      )))
    }

    const creds = input.runtimeProvider.credentials
    if (!creds.llamaCppUrl) {
      return attachExecutionScope(await time('ready_status', () => readyStartStatus(
        input.projectPath,
        input.requestedTaskId,
        basename(input.projectPath),
        startStateOptions,
      )))
    }

    const llamaCppUrl = creds.llamaCppUrl
    const loadedModels = await time('llama_models', () => loadedLlamaModelIds(llamaCppUrl).catch(() => []))
    if (loadedModels.length === 0) {
      const paidFallback = input.allowPaidProviderFallback
        ? await time('paid_fallback', () => selectPaidFallbackProvider(creds))
        : null
      if (!paidFallback || paidFallback.providerName === 'none') {
        return attachExecutionScope({
          canStart: false,
          code: 'no_loaded_model',
          message:
            'The configured local server is reachable, but no loaded model was visible. To avoid surprise memory pressure from JIT loading, load the model you want on that server, then start again.',
          actionHref: '/providers',
          loadedModels,
        })
      }
      return attachExecutionScope(await time('ready_status', () => readyStartStatus(
        input.projectPath,
        input.requestedTaskId,
        basename(input.projectPath),
        startStateOptions,
      )))
    }

    const missingModels = missingAssignedModels(input.resolvedConfig.models, loadedModels)
    if (missingModels.length === 0) {
      return attachExecutionScope(await time('ready_status', () => readyStartStatus(
        input.projectPath,
        input.requestedTaskId,
        basename(input.projectPath),
        startStateOptions,
      )))
    }

    const paidFallback = input.allowPaidProviderFallback
      ? await time('paid_fallback', () => selectPaidFallbackProvider(creds))
      : null
    if (paidFallback && paidFallback.providerName !== 'none') {
      return attachExecutionScope(await time('ready_status', () => readyStartStatus(
        input.projectPath,
        input.requestedTaskId,
        basename(input.projectPath),
        startStateOptions,
      )))
    }
    return attachExecutionScope({
      canStart: false,
      code: 'model_unavailable',
      message:
        `The configured local server currently has ${loadedModels.join(', ')} loaded, but this project is configured for ${missingModels.join(', ')}. ` +
        'Missing models are not JIT-loaded automatically; load the configured model on that server or choose a loaded model in Providers.',
      actionHref: '/providers',
      loadedModels,
      missingModels,
    })
  }

  async function readyStartStatus(
    projectPath: string,
    requestedTaskId: string | undefined,
    projectId: string,
    options: StartStateSnapshot = {},
  ): Promise<{
    canStart: true
    code?: string
    message?: string
    actionHref?: string
    focusTaskId?: string
    focusTaskTitle?: string
    focusKind?: string
    proofTaskIds?: string[]
    count?: number
  }> {
    const activeRun = supervisor.get(projectId)
    if (activeRun?.status === 'running' || activeRun?.status === 'stopping') return { canStart: true }
    return await startStatusForPausedLiveWork(projectPath, requestedTaskId, options) ?? { canStart: true }
  }

  function startReadinessForTerminalState(terminal: Awaited<ReturnType<typeof terminalStartState>> & {}): {
    canStart: false
    code?: string
    message?: string
    actionHref?: string
    focusTaskId?: string
    focusTaskTitle?: string
    focusKind?: string
    proofTaskIds?: string[]
    count?: number
  } {
    return {
      canStart: false,
      code: terminal.code,
      message: terminal.message,
      ...(terminal.actionHref ? { actionHref: terminal.actionHref } : {}),
      ...(terminal.focusTaskId ? { focusTaskId: terminal.focusTaskId } : {}),
      ...(terminal.focusTaskTitle ? { focusTaskTitle: terminal.focusTaskTitle } : {}),
      ...(terminal.focusKind ? { focusKind: terminal.focusKind } : {}),
      ...(terminal.proofTaskIds?.length ? { proofTaskIds: terminal.proofTaskIds } : {}),
      ...(terminal.count ? { count: terminal.count } : {}),
    }
  }

  async function hasMaterializedScopedStartWork(
    projectPath: string,
    requestedTaskId?: string,
    options: StartStateSnapshot = {},
  ): Promise<boolean> {
    const tasksPath = projectTasksPath(projectPath)
    const hasSharedState = options.queue !== undefined && options.effectiveTasks !== undefined && options.scope !== undefined
    const canonicalState = !hasSharedState && readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
      ? await readProjectCanonicalCurrentState(projectPath)
      : null
    if (!canonicalState && !projectTaskStateExistsSync(tasksPath)) return false
    const queue = options.queue ?? canonicalState?.rawQueue ?? await readTaskQueueFileNormalized(tasksPath)
    const typedTasks = options.effectiveTasks ?? canonicalState?.tasks ?? queue.tasks as Task[]
    const typedQueue = {
      tasks: typedTasks,
      releases: queue.releases,
      ...(queue.selectedReleaseId ? { selectedReleaseId: queue.selectedReleaseId } : {}),
    }
    const authoritativeScope = options.scope !== undefined ? options.scope : canonicalState?.scope
    const selectedReleaseScope = authoritativeScope !== undefined
      ? authoritativeScope
      : (() => {
          const { orientationSpine } = buildOrientationSpineWithScopedReleaseTruth({
            projectId: basename(projectPath),
            charter: inferProjectCharterFromExistingSources(projectPath),
            selectedReleaseId: queue.selectedReleaseId,
            releases: queue.releases,
            tasks: typedQueue.tasks,
            runStatus: 'stopped',
            sourceRefs: projectOrientationSourceRefs(projectPath),
          })
          return (
            (orientationSpine.selectedTaskScope as OrientationScope | null | undefined) ??
            (orientationSpine.scope as OrientationScope | null | undefined) ??
            selectedReleaseScopeFromQueueLike(typedQueue)
          )
        })()
    const scopedTasks = tasksEligibleForScopeExecution(typedQueue.tasks, selectedReleaseScope)
    if (selectedReleaseScope) {
      return scopedTasks.some(task => {
        if (!task || typeof task !== 'object') return false
        if (requestedTaskId && task.id !== requestedTaskId) return false
        const status = String(task.status ?? '')
        if (['archived', 'cancelled', 'done', 'shelved'].includes(status)) return false
        if (taskShapingBlockers(task).length > 0) return Boolean(queue.selectedReleaseId)
        if (status === 'ready' && !isReadyForWorkerHandoffRecord(task)) return false
        if (!['ready', 'in_progress', 'review', 'gate_check'].includes(status)) return false
        return deriveWorkExecutionState(typedQueue.tasks, task.id).summaryState !== 'blocked'
      })
    }
    return scopedTasks.some(task => {
      if (!task || typeof task !== 'object') return false
      if (requestedTaskId && task.id !== requestedTaskId) return false
      const status = String(task.status ?? '')
      if (status === 'ready' && !isReadyForWorkerHandoffRecord(task)) return false
      if (!['ready', 'in_progress', 'review', 'gate_check'].includes(status)) return false
      return deriveWorkExecutionState(typedQueue.tasks, task.id).summaryState !== 'blocked'
    })
  }

  async function startStatusForPausedLiveWork(
    projectPath: string,
    requestedTaskId?: string,
    options: StartStateSnapshot = {},
  ): Promise<{
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
    const hasSharedState = options.queue !== undefined && options.effectiveTasks !== undefined && options.scope !== undefined
    const canonicalState = !hasSharedState && readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
      ? await readProjectCanonicalCurrentState(projectPath)
      : null
    if (!canonicalState && !projectTaskStateExistsSync(tasksPath)) return null
    const queue = options.queue ?? canonicalState?.rawQueue ?? await readTaskQueueFileNormalized(tasksPath)
    const typedTasks = options.effectiveTasks ?? canonicalState?.tasks ?? queue.tasks as Task[]
    const typedQueue = {
      tasks: typedTasks,
      releases: queue.releases,
      ...(queue.selectedReleaseId ? { selectedReleaseId: queue.selectedReleaseId } : {}),
    }
    const authoritativeScope = options.scope !== undefined ? options.scope : canonicalState?.scope
    const selectedReleaseScope = authoritativeScope !== undefined
      ? authoritativeScope
      : (() => {
          const { orientationSpine } = buildOrientationSpineWithScopedReleaseTruth({
            projectId: basename(projectPath),
            charter: inferProjectCharterFromExistingSources(projectPath),
            selectedReleaseId: queue.selectedReleaseId,
            releases: queue.releases,
            tasks: typedQueue.tasks,
            runStatus: 'stopped',
            sourceRefs: projectOrientationSourceRefs(projectPath),
          })
          return (
            (orientationSpine.selectedTaskScope as OrientationScope | null | undefined) ??
            (orientationSpine.scope as OrientationScope | null | undefined) ??
            selectedReleaseScopeFromQueueLike(typedQueue)
          )
        })()
    const scopedTasks = tasksEligibleForScopeExecution(typedQueue.tasks, selectedReleaseScope)
    const pausedTasks = scopedTasks.filter(task => {
      if (!task || typeof task !== 'object') return false
      if (requestedTaskId && task.id !== requestedTaskId) return false
      if (!['in_progress', 'review', 'gate_check'].includes(String(task.status ?? ''))) return false
      return deriveWorkExecutionState(typedQueue.tasks, task.id).summaryState !== 'blocked'
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
    const tasksPath = projectTasksPath(projectPath)
    const canonicalState = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
      ? await readProjectCanonicalCurrentState(projectPath)
      : null
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
      ...(canonicalState ? { queue: canonicalState.rawQueue as Awaited<ReturnType<typeof readTaskQueueFileNormalized>> } : {}),
    ...(canonicalState ? { effectiveTasks: canonicalState.tasks } : {}),
    ...(canonicalState ? { scope: canonicalState.scope } : {}),
    ...(canonicalState ? { ownerInput: canonicalState.summary?.ownerInput ?? null } : {}),
    ...(canonicalState ? { summary: canonicalState.summary ?? null } : {}),
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

  async function startExecutionScopeSummary(
    projectPath: string,
    requestedTaskId?: string,
    options: StartStateSnapshot = {},
  ): Promise<StartExecutionScopeSummary | undefined> {
    const tasksPath = projectTasksPath(projectPath)
    const hasSharedState = options.queue !== undefined && options.effectiveTasks !== undefined && options.scope !== undefined
    const canonicalState = !hasSharedState && readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
      ? await readProjectCanonicalCurrentState(projectPath)
      : null
    const queue = options.queue ?? canonicalState?.rawQueue ?? await readTaskQueueFileNormalized(tasksPath).catch(() => null)
    if (requestedTaskId) {
      const task = options.effectiveTasks?.find(candidate => candidate.id === requestedTaskId) ??
        canonicalState?.tasks.find(candidate => candidate.id === requestedTaskId) ??
        queue?.tasks.find(candidate => candidate.id === requestedTaskId)
      return {
        id: requestedTaskId,
        label: typeof task?.title === 'string' && task.title.trim() ? task.title.trim() : requestedTaskId,
        kind: 'work_item',
        source: 'owner_selected',
        taskCount: task ? 1 : undefined,
      }
    }
    if (!queue) return undefined
    const typedTasks = options.effectiveTasks ?? canonicalState?.tasks ?? queue.tasks as Task[]
    const workspaceGoalsState = canonicalState
      ? null
      : await readWorkspaceGoalsState(getProjectStateDir(projectPath)).catch(() => null)
    const selectedReleaseScope = options.scope !== undefined
      ? options.scope
      : canonicalState?.scope ?? selectedReleaseScopeFromQueueLike({
        tasks: typedTasks,
        releases: queue.releases,
        ...(queue.selectedReleaseId ? { selectedReleaseId: queue.selectedReleaseId } : {}),
      })
    const selectedScope = selectedReleaseScope ?? selectedTaskScopeForQueue(
      { tasks: typedTasks },
      workspaceGoalsState?.approved ?? null,
    )
    if (selectedScope) {
      const releaseMetadata = queue.releases.find(release => release.id === selectedScope.id) ??
        workspaceGoalsState?.releases?.find(release => release.id === selectedScope.id)
      return {
        id: selectedScope.id,
        label: releaseMetadata?.label ?? selectedScope.label,
        kind: selectedScope.kind,
        source: releaseMetadata?.source ?? selectedScope.source,
        taskCount: selectedScope.nodeIds.length,
        deferredTaskCount: selectedScope.deferredNodeIds.length,
      }
    }
    const currentTasks = typedTasks.filter(task => !['archived', 'cancelled', 'shelved'].includes(String(task.status ?? '')))
    const deferredTasks = typedTasks.filter(task => ['archived', 'cancelled', 'shelved'].includes(String(task.status ?? '')))
    return {
      id: 'current-work',
      label: 'Current task scope',
      kind: 'proposed_feature_set',
      source: 'inferred',
      taskCount: currentTasks.length,
      deferredTaskCount: deferredTasks.length,
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

  async function terminalStartState(projectPath: string, requestedTaskId?: string, opts: StartStateSnapshot = {}): Promise<{
	    canStart: false
	    code: 'all_terminal' | 'proof_evidence_missing' | 'repository_followup_required' | 'scope_source_conflict'
	    message: string
      actionHref?: string
      focusTaskId?: string
      focusTaskTitle?: string
      focusKind?: string
      proofTaskIds?: string[]
      count?: number
      selectedReleaseTerminal?: boolean
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
    const hasSharedState = opts.queue !== undefined && opts.effectiveTasks !== undefined && opts.scope !== undefined
    const canonicalState = !hasSharedState && readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
      ? await readProjectCanonicalCurrentState(projectPath)
      : null
    if (!canonicalState && !projectTaskStateExistsSync(tasksPath)) return null
    let raw: unknown = opts.queue
    raw ??= canonicalState?.rawQueue
    if (!raw) {
      try {
        raw = readProjectTaskQueueSync(tasksPath)
      } catch {
        return null
      }
    }
    const tasks = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks)
        ? (raw as { tasks: unknown[] }).tasks
        : []
    if (tasks.length === 0) return null
	    if (
	      requestedTaskId &&
      await hasRecoverableBlockedStartTask(projectPath, tasks, requestedTaskId, opts.effectiveTasks)
	    ) {
	      return null
    }

    const typedTasks = tasks.filter((task): task is Task => Boolean(task && typeof task === 'object'))
    const effectiveTasks = (opts.effectiveTasks ?? await Promise.all(typedTasks.map(task => buildEffectiveTask(projectPath, task)))) as unknown as Task[]
    const normalizedQueue = opts.queue ?? canonicalState?.rawQueue ?? (!requestedTaskId
      ? await readTaskQueueFileNormalized(tasksPath).catch(() => null)
      : null)
    const rawReleases = normalizedQueue?.releases ?? (
      !Array.isArray(raw) && raw && typeof raw === 'object' && Array.isArray((raw as { releases?: unknown }).releases)
        ? (raw as { releases: TaskQueue['releases'] }).releases
        : undefined
    )
    const rawSelectedReleaseId = normalizedQueue?.selectedReleaseId ?? (
      !Array.isArray(raw) && raw && typeof raw === 'object' && typeof (raw as { selectedReleaseId?: unknown }).selectedReleaseId === 'string'
        ? (raw as { selectedReleaseId: string }).selectedReleaseId
        : undefined
    )
    const scopedOrientation = !requestedTaskId
      ? buildOrientationSpineWithScopedReleaseTruth({
        projectId: basename(projectPath),
        charter: inferProjectCharterFromExistingSources(projectPath),
        selectedReleaseId: rawSelectedReleaseId,
        releases: rawReleases,
        tasks: effectiveTasks,
        runStatus: 'stopped',
        sourceRefs: projectOrientationSourceRefs(projectPath),
      })
      : null
    const orientationScope = scopedOrientation?.orientationSpine.scope as ProjectScope | null | undefined
    const queueSelectedReleaseScope = !requestedTaskId
      ? selectedReleaseScopeFromQueueLike({
        tasks: effectiveTasks,
        releases: rawReleases,
        selectedReleaseId: rawSelectedReleaseId,
      })
      : null
    const materializedTaskNodeIds = new Set(
      effectiveTasks
        .filter(task => task.id !== META_INTAKE_TASK_ID && task.id !== WORKSPACE_IMPORT_TASK_ID)
        .map(task => taskScopeNodeId(task.id)),
    )
    const orientationScopeMatchesMaterializedWork = Boolean(
      orientationScope &&
      orientationScope.id !== 'current-work' &&
      orientationScope.nodeIds.some(nodeId => materializedTaskNodeIds.has(nodeId)),
    )
    const authoritativeScope = opts.scope !== undefined ? opts.scope : canonicalState?.scope
    const selectedReleaseScope = !requestedTaskId
      ? authoritativeScope !== undefined
        ? authoritativeScope
        : (orientationScopeMatchesMaterializedWork ? orientationScope : queueSelectedReleaseScope)
      : null
	    const tasksById = new Map(effectiveTasks.map(task => [task.id, task] as const))
	    const scopedTasks = selectedReleaseScope
      ? tasksEligibleForScopeExecution(effectiveTasks, selectedReleaseScope)
	        .filter(task => task.id !== META_INTAKE_TASK_ID && task.id !== WORKSPACE_IMPORT_TASK_ID)
	      : effectiveTasks.filter(task => task.id !== META_INTAKE_TASK_ID && task.id !== WORKSPACE_IMPORT_TASK_ID)
	    if (selectedReleaseScope && scopedTasks.length === 0) return null
	    const selectedScopeProofStyle = selectedReleaseScope
	      ? proofStyleForScope(rawReleases ?? [], selectedReleaseScope)
	      : undefined
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
	        if (
          taskDoneButProofMissingForScope(task, selectedScopeProofStyle) &&
          !taskCompletionProofSatisfiedByLinkedChildren(task, effectiveTasks, selectedScopeProofStyle, selectedReleaseScope)
        ) {
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
    if (selectedReleaseScope && blocked > 0) return null
    const proofSummaryScope = authoritativeScope !== undefined
      ? authoritativeScope
      : selectedReleaseScope ?? queueSelectedReleaseScope
    const scopedReleaseSummary = proofSummaryScope
      ? summarizeScopedReleaseWork(effectiveTasks, proofSummaryScope, {
        proofStyle: selectedScopeProofStyle,
        commandProofRequired: selectedScopeProofStyle === 'script_only',
      })
      : null
    const terminalProofMissingDoneTasks = (scopedReleaseSummary
      ? scopedReleaseSummary.proofMissingDoneTasks
      : proofMissingDoneTasks)
      .filter(task => {
        const taskRecord = tasksById.get(task.id)
        const parentId = taskRecord?.hierarchy?.parentId?.trim()
        const parent = parentId ? tasksById.get(parentId) ?? null : null
        return !taskRecord || deriveTaskWorkVisibility(taskRecord, parent).countInProjectTotals
      })
    if (terminalProofMissingDoneTasks.length > 0) {
      const first = terminalProofMissingDoneTasks[0]!
      const scopeLabel = selectedReleaseScope?.label ?? 'Current task scope'
      const message = terminalProofMissingDoneTasks.length === 1
        ? `${scopeLabel} is waiting on proof evidence for "${first.title}".`
        : `${scopeLabel} is waiting on proof evidence for ${terminalProofMissingDoneTasks.length} completed tasks, starting with "${first.title}".`
      return {
        canStart: false,
        code: 'proof_evidence_missing',
        message,
        actionHref: `/work?task=${encodeURIComponent(first.id)}`,
        focusTaskId: first.id,
        focusTaskTitle: first.title,
        focusKind: 'proof',
        proofTaskIds: terminalProofMissingDoneTasks.map(task => task.id),
        count: terminalProofMissingDoneTasks.length,
        ...(selectedReleaseScope ? { selectedReleaseTerminal: true } : {}),
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
    const sourceConflict = scopedOrientation?.orientationSpine.gaps.find(gap =>
      sourceConflictCompetesWithSelectedScope(gap, effectiveTasks, selectedReleaseScope),
    )
    if (sourceConflict) {
      const scopeLabel = selectedReleaseScope?.label ?? 'Current task scope'
      return {
        canStart: false,
        code: 'scope_source_conflict',
        message: `${scopeLabel} has source conflicts to review before it can be treated as complete: ${sourceConflict.label}`,
        actionHref: '/map',
        focusKind: 'source_conflict',
        ...(selectedReleaseScope ? { selectedReleaseTerminal: true } : {}),
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
    const gitStory = await buildProjectGitStorySummary(
      projectPath,
      (scopedReleaseSummary?.gitStoryTasks ?? scopedTasks) as Array<Record<string, unknown>>,
    )
    const startBlockingGitStoryBlockers = queueSelectedReleaseScope && (selectedReleaseScope?.kind === 'release' || selectedReleaseScope?.kind === 'milestone')
      ? gitStory.blockers.filter(gitStoryBlocksUnattendedStart)
      : []
    if (startBlockingGitStoryBlockers.length > 0) {
      const scopeLabel = selectedReleaseScope?.label ?? 'Current task scope'
      const first = startBlockingGitStoryBlockers[0]!
      const next = first.nextAction ? ` Next: ${first.nextAction}` : ''
      const message = startBlockingGitStoryBlockers.length === 1
        ? `${scopeLabel} has no runnable task work left, but repository follow-up is still needed: ${first.reason}${next}`
        : `${scopeLabel} has no runnable task work left, but ${startBlockingGitStoryBlockers.length} repository follow-ups are still needed, starting with: ${first.reason}${next}`
      return {
        canStart: false,
        code: 'repository_followup_required',
        message,
        actionHref: '/release',
        focusKind: 'repository_followup',
        count: startBlockingGitStoryBlockers.length,
        ...(selectedReleaseScope ? { selectedReleaseTerminal: true } : {}),
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
	    if (selectedReleaseScope && selectedReleaseScope.id !== 'current-work') {
	      const outsideActionableByStatus = new Map<string, number>()
	      for (const task of effectiveTasks) {
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
      ...(selectedReleaseScope ? { selectedReleaseTerminal: true } : {}),
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
    effectiveTasks?: Task[],
  ): Promise<boolean> {
	    const rawTask = tasks.find(task =>
	      Boolean(task && typeof task === 'object' && (task as { id?: unknown }).id === requestedTaskId),
	    )
	    if (!rawTask) return false
	    if (isRecoverableBlockedStartTask(rawTask, requestedTaskId)) return true
	    try {
      const effectiveTask = effectiveTasks?.find(task => task.id === requestedTaskId)
        ?? await buildEffectiveTask(projectPath, rawTask as Task)
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
	      recoveryCode?: unknown
	      worktreePath?: unknown
	      branchName?: unknown
	      reviewVerdicts?: unknown
	    }
	    if (candidate.id !== requestedTaskId) return false
	    if (candidate.status !== 'blocked') return false
	    const activeRecoveryCode = candidate.recoveryCode
	    const hasTypedMaxRevisionRecovery = activeRecoveryCode === 'max_revisions_actionable' ||
	      (Array.isArray((candidate as { escalations?: unknown }).escalations) &&
        (candidate as { escalations: unknown[] }).escalations.some((entry) =>
          entry && typeof entry === 'object' &&
          !(entry as { resolvedAt?: unknown }).resolvedAt &&
          (entry as { recoveryCode?: unknown }).recoveryCode === 'max_revisions_actionable'))
	    if (hasTypedMaxRevisionRecovery && hasPriorAllClearLlmStartReview(candidate.reviewVerdicts)) {
	      return true
	    }
	    return activeRecoveryCode === 'task_worktree_exists'
	  }

	  function hasPriorAllClearLlmStartReview(reviewVerdicts: unknown): boolean {
	    if (!Array.isArray(reviewVerdicts)) return false
	    return reviewVerdicts.some((raw) => {
	      if (!raw || typeof raw !== 'object') return false
	      const verdict = raw as {
	        reviewerPath?: unknown
	        acceptedCriteriaIds?: unknown
	        verdict?: unknown
	      }
	      return reviewVerdictHasStructuredApproval(verdict, [])
	    })
	  }

  async function startBlockerForImportDrafts(
    projectPath: string,
    requestedTaskId?: string,
    options: StartStateSnapshot = {},
  ): Promise<{
    canStart: false
    code: 'import_drafts_waiting' | 'imported_scope_shaping'
    message: string
    actionHref: string
  } | null> {
    const tasksPath = projectTasksPath(projectPath)
    const hasSharedState = options.queue !== undefined && options.effectiveTasks !== undefined && options.scope !== undefined
    const currentState = !hasSharedState && readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
      ? await readProjectCanonicalCurrentState(projectPath)
      : null
    if (!currentState && !projectTaskStateExistsSync(tasksPath)) return null
    if (!currentState && !hasSharedState) return null
    const queue = options.queue ?? currentState?.rawQueue
    const effectiveTasks = options.effectiveTasks ?? currentState?.tasks
    if (!queue || !effectiveTasks) return null
    const authoritativeScope = options.scope !== undefined ? options.scope : currentState?.scope
    const orientationSpine = authoritativeScope === undefined
      ? buildOrientationSpineWithScopedReleaseTruth({
          projectId: basename(projectPath),
          charter: inferProjectCharterFromExistingSources(projectPath),
          selectedReleaseId: queue.selectedReleaseId,
          releases: queue.releases,
          tasks: effectiveTasks,
          runStatus: 'stopped',
          sourceRefs: projectOrientationSourceRefs(projectPath),
        }).orientationSpine
      : null
    const selectedReleaseScope = authoritativeScope !== undefined
      ? authoritativeScope
      : (
        (orientationSpine?.selectedTaskScope as OrientationScope | null | undefined) ??
        (orientationSpine?.scope as OrientationScope | null | undefined) ??
        selectedReleaseScopeFromQueueLike({
          tasks: effectiveTasks,
          releases: queue.releases,
          ...(queue.selectedReleaseId ? { selectedReleaseId: queue.selectedReleaseId } : {}),
        })
      )
    const tasksById = new Map(effectiveTasks.map(task => [task.id, task] as const))
    const tasks = tasksEligibleForScopeExecution(effectiveTasks, selectedReleaseScope)
      .filter(task => {
        const parentId = task.hierarchy?.parentId?.trim()
        const parent = parentId ? tasksById.get(parentId) ?? null : null
        return deriveTaskWorkVisibility(task, parent).countInProjectTotals
      })
    const importedShapingTasks = tasks
      .filter(task => taskShapingBlockers(task).length > 0)
      .sort((left, right) => {
        const leftImportDraft = left.status === 'import_draft' ? 0 : 1
        const rightImportDraft = right.status === 'import_draft' ? 0 : 1
        return leftImportDraft - rightImportDraft
      })
    if (importedShapingTasks.length === 0) return null
    if (requestedTaskId && effectiveTasks.some(task => task.id === requestedTaskId)) return null
    // An exploring task is already assigned to the source/spec lane. Let the
    // normal provider preflight and orchestrator picker run it; raw
    // import_draft records still require an explicit shaping start.
    if (importedShapingTasks.some(task => task.status === 'exploring')) return null
    const importerTask = effectiveTasks.find(task =>
      task &&
      typeof task === 'object' &&
      (task as { id?: unknown }).id === WORKSPACE_IMPORT_TASK_ID,
    ) as { status?: unknown } | undefined
    const first = importedShapingTasks[0] as { id?: unknown; title?: unknown; status?: unknown }
    const title = typeof first.title === 'string' && first.title.trim() ? first.title.trim() : 'the first imported draft'
    const id = typeof first.id === 'string' ? first.id : ''
    const importerDone =
      typeof importerTask?.status === 'string' && ['done', 'spec_review'].includes(importerTask.status)
    const shapingCount = importedShapingTasks.length
    const rawImportDraftCount = importedShapingTasks.filter(task => task.status === 'import_draft').length
    const shapingStarted = first.status === 'exploring' || rawImportDraftCount < shapingCount
    const visibleShapingCount = first.status === 'import_draft' ? rawImportDraftCount : shapingCount
    const shapingMessage =
      visibleShapingCount === 1
        ? `Current scoped work still needs source-backed shaping before Guildhall can build unattended. Start with "${title}".`
        : `${shapingCount} current-scope tasks still need source-backed shaping before Guildhall can build unattended. Start with "${title}".`
    return {
      canStart: false,
      code: importerDone || shapingStarted ? 'imported_scope_shaping' : 'import_drafts_waiting',
      message:
        importerDone || shapingStarted
          ? shapingMessage
          : shapingCount === 1
            ? `Review the imported draft "${title}" and turn it into a task brief before starting.`
            : `Review ${shapingCount} imported drafts before starting. Start with "${title}".`,
      actionHref: id ? `/task/${encodeURIComponent(id)}` : '/notifications',
    }
  }

  async function startBlockerForWorkspaceImportCoverage(
    projectPath: string,
    options: StartStateSnapshot = {},
  ): Promise<{
    canStart: false
    code: 'workspace_import_refresh_needed'
    message: string
    actionHref: string
  } | null> {
    const workspaceGoalsState = await readWorkspaceGoalsState(getProjectStateDir(projectPath))
    const normalizeImportRef = (value: string): string =>
      value.replaceAll('\\', '/').trim()
    const importIdentityKeys = (value: unknown): string[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const record = value as Record<string, unknown>
      const keys: string[] = []
      const id = ['id', 'suggestedId']
        .map(field => record[field])
        .find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)
      if (id) keys.push(`id:${id.trim()}`)
      const structuralIdentity = explicitTaskStructuralIdentity({
        sourceIdentity: typeof record.sourceIdentity === 'string' ? record.sourceIdentity : undefined,
        deliverableName: typeof record.deliverableName === 'string' ? record.deliverableName : undefined,
        producedArtifact: typeof record.producedArtifact === 'string' ? record.producedArtifact : undefined,
      })
      if (structuralIdentity) keys.push(structuralIdentity)
      return keys
    }
    const addImportIdentityKeys = (target: Set<string>, value: unknown): void => {
      for (const key of importIdentityKeys(value)) target.add(key)
    }
    const importIdentitiesIntersect = (value: unknown, target: ReadonlySet<string>): boolean =>
      importIdentityKeys(value).some(key => target.has(key))
    const refsFromRecord = (value: unknown): string[] => {
      if (!value || typeof value !== 'object') return []
      const refs = (value as { references?: unknown }).references
      return Array.isArray(refs)
        ? refs.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map(normalizeImportRef)
        : []
    }

    const tasksPath = projectTasksPath(projectPath)
    const hasSharedState = options.queue !== undefined && options.effectiveTasks !== undefined && options.scope !== undefined
    const currentState = !hasSharedState && readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
      ? await readProjectCanonicalCurrentState(projectPath)
      : null
    if (!currentState && !projectTaskStateExistsSync(tasksPath)) return null
    if (!currentState && !hasSharedState) return null
    const tasks = (options.effectiveTasks ?? currentState?.tasks ?? []) as unknown as Array<Record<string, unknown>>
    const importTask = tasks.find(task =>
      task &&
      typeof task === 'object' &&
      (task as { id?: unknown }).id === WORKSPACE_IMPORT_TASK_ID,
    ) as { status?: unknown; spec?: unknown } | undefined
    if (!importTask) return null
    const status = typeof importTask.status === 'string' ? importTask.status : ''
    const spec = taskSpecText(importTask.spec)
    if (!['done', 'spec_review'].includes(status) || !spec.trim()) return null

    const parsed = canonicalApprovedWorkspaceImport(workspaceGoalsState, spec)
    if (!parsed) return null
    const inventory = await detectWorkspaceSignals({ projectPath })
    const detected = await materializeWorkspaceImportDraft({
      memoryDir: getProjectStateDir(projectPath),
      projectPath,
      draft: formWorkspaceHypothesis(inventory),
    })
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
    const approvedCurrentLabels = parsed.tasks
      .filter(task => task.scope !== 'later')
      .map(task => task.title.trim())
      .filter(title => title.length > 0)
    const detectedCurrentLabels = detected.tasks
      .filter(task => task.scope !== 'later')
      .map(task => task.title.trim())
      .filter(title => title.length > 0)
    const currentApprovedOrDetectedLabels = [
      ...approvedCurrentLabels,
      ...detectedCurrentLabels,
    ]
    if (detected.tasks.length === 0) {
      if (currentApprovedOrDetectedLabels.length > 0 && liveNonImporterTasks.length === 0) {
        const first = currentApprovedOrDetectedLabels[0] || 'the first approved current-scope task'
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

    const coveredIdentities = new Set<string>()
    const currentScopeCoveredIdentities = new Set<string>()
    const coveredRefs = new Set<string>()
    const activeTaskHints = new Set<string>()
    for (const task of parsed.tasks) {
      addImportIdentityKeys(coveredIdentities, task)
      if (task.scope !== 'later') addImportIdentityKeys(currentScopeCoveredIdentities, task)
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
      if (id.trim()) activeTaskHints.add(`id:${id.trim()}`)
      for (const field of ['sourceIdentity', 'deliverableName', 'producedArtifact'] as const) {
        const value = (task as Record<string, unknown>)[field]
        if (typeof value === 'string' && value.trim()) activeTaskHints.add(`${field}:${value.trim()}`)
      }
      addImportIdentityKeys(coveredIdentities, task)
      if (status !== 'shelved') addImportIdentityKeys(currentScopeCoveredIdentities, task)
      for (const ref of refsFromRecord(task)) coveredRefs.add(ref)
    }
    for (const context of detected.context) {
      if (context.role !== 'reference') continue
      const linkedTaskHints = Array.isArray(context.linkedTaskHints)
        ? context.linkedTaskHints
            .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
            .flatMap(hint => [`id:${hint}`, `sourceIdentity:${hint}`])
        : []
      if (linkedTaskHints.length === 0) continue
      if (!linkedTaskHints.some(hint => activeTaskHints.has(hint))) continue
      for (const ref of refsFromRecord(context)) coveredRefs.add(ref)
    }

    const missing = detected.tasks.filter(task => {
      return importIdentityKeys(task).length === 0 || !importIdentitiesIntersect(task, coveredIdentities)
    })
    const currentScopeMissing = detected.tasks.filter(task => {
      if (task.scope === 'later') return false
      return importIdentityKeys(task).length === 0 || !importIdentitiesIntersect(task, currentScopeCoveredIdentities)
    })
    const detectedCurrentIdentities = new Set<string>()
    for (const task of detected.tasks) {
      if (task.scope !== 'later') addImportIdentityKeys(detectedCurrentIdentities, task)
    }
    const staleApprovedCurrent = parsed.tasks.filter(task => {
      if (task.scope === 'later') return false
      return importIdentityKeys(task).length === 0 || !importIdentitiesIntersect(task, detectedCurrentIdentities)
    })
    const detectedTaskIdentities = new Set<string>()
    for (const task of detected.tasks) addImportIdentityKeys(detectedTaskIdentities, task)
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
      if (importIdentitiesIntersect(task, detectedTaskIdentities)) return false
      return detected.context.some(context => {
        if (context.role !== 'capability' && context.role !== 'brief_input') return false
        return (context.linkedTaskHints ?? []).some(hint =>
          activeTaskHints.has(`id:${hint}`) || activeTaskHints.has(`sourceIdentity:${hint}`),
        )
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
      currentApprovedOrDetectedLabels.length > 0 &&
      liveNonImporterTasks.length === 0
    ) {
      const first = currentApprovedOrDetectedLabels[0] || 'the first approved current-scope task'
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

  async function startBlockerForOrientationScopeShaping(
    projectPath: string,
    requestedTaskId?: string,
    options: StartStateSnapshot = {},
  ): Promise<{
    canStart: false
    code: 'no_unattended_progress' | 'scope_source_conflict'
    message: string
    actionHref: string
    focusTaskId?: string
    focusTaskTitle?: string
    focusKind: 'brief_cleanup' | 'source_conflict'
    count?: number
  } | null> {
    if (requestedTaskId) return null
    const tasksPath = projectTasksPath(projectPath)
    const hasSharedState = options.queue !== undefined && options.effectiveTasks !== undefined && options.scope !== undefined
    const currentState = !hasSharedState && readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
      ? await readProjectCanonicalCurrentState(projectPath)
      : null
    if (!currentState && !projectTaskStateExistsSync(tasksPath)) return null
    const queue = options.queue ?? currentState?.rawQueue ?? await readTaskQueueFileNormalized(tasksPath)
    const effectiveTasks = (options.effectiveTasks ?? currentState?.tasks ?? await Promise.all((queue.tasks as Task[]).map(task => buildEffectiveTask(projectPath, task)))) as unknown as Task[]
    const authoritativeScope = options.scope !== undefined ? options.scope : currentState?.scope
    const orientationSpine = buildOrientationSpineWithScopedReleaseTruth({
      projectId: basename(projectPath),
      charter: inferProjectCharterFromExistingSources(projectPath),
      selectedReleaseId: queue.selectedReleaseId,
      releases: queue.releases,
      tasks: effectiveTasks,
      runStatus: 'stopped',
      sourceRefs: projectOrientationSourceRefs(projectPath),
    }).orientationSpine
    const selectedReleaseScope = authoritativeScope !== undefined
      ? authoritativeScope
      : (
        (orientationSpine.selectedTaskScope as OrientationScope | null | undefined) ??
        (orientationSpine.scope as OrientationScope | null | undefined) ??
        selectedReleaseScopeFromQueueLike({
          tasks: effectiveTasks,
          releases: queue.releases,
          ...(queue.selectedReleaseId ? { selectedReleaseId: queue.selectedReleaseId } : {}),
        })
      )
    if (
      selectedReleaseScope &&
      tasksEligibleForScopeExecution(effectiveTasks, selectedReleaseScope)
        .some(task => taskShapingBlockers(task).length > 0)
    ) {
      return null
    }
    const sourceConflict = orientationSpine.gaps.find(gap =>
      sourceConflictCompetesWithSelectedScope(gap, effectiveTasks, selectedReleaseScope),
    )
    if (sourceConflict) {
      const scopeLabel = orientationSpine.scope?.label ?? selectedReleaseScope?.label ?? 'Current task scope'
      return {
        canStart: false,
        code: 'scope_source_conflict',
        message: `${scopeLabel} has source conflicts to review before work can start: ${sourceConflict.label}`,
        actionHref: '/map',
        focusKind: 'source_conflict',
      }
    }
    const rows = orientationSpine.scopeRows.filter(row =>
      row.scope === 'included' &&
      row.taskId.startsWith('workspace-import:') &&
      (row.status === 'import_draft' || row.handoffState === 'not_shaped' || row.handoffState === 'brief_cleanup'),
    )
    if (rows.length === 0) return null
    const first = rows[0]!
    const title = first.title.trim() || 'the first current-scope draft'
    return {
      canStart: false,
      code: 'no_unattended_progress',
      message: rows.length === 1
        ? `"${title}" needs a clearer brief before unattended work can run.`
        : `${rows.length} current-scope items need clearer briefs before unattended work can run. Start with "${title}".`,
      actionHref: '/workspace-import',
      focusTaskId: first.taskId,
      focusTaskTitle: title,
      focusKind: 'brief_cleanup',
      count: rows.length,
    }
  }

  async function startBlockerForTaskReadiness(projectPath: string, options: {
    queue?: Awaited<ReturnType<typeof readTaskQueueFileNormalized>>
    effectiveTasks?: Task[]
    scope?: ProjectScope | null
  } = {}): Promise<{
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
    const hasSharedState = options.queue !== undefined && options.effectiveTasks !== undefined && options.scope !== undefined
    const canonicalState = !hasSharedState && readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
      ? await readProjectCanonicalCurrentState(projectPath)
      : null
    if (!canonicalState && !projectTaskStateExistsSync(tasksPath)) return null
    const queue = options.queue ?? canonicalState?.rawQueue ?? await readTaskQueueFileNormalized(tasksPath)
    const typedQueue = {
      tasks: options.effectiveTasks ?? canonicalState?.tasks ?? queue.tasks as Task[],
      releases: queue.releases,
      ...(queue.selectedReleaseId ? { selectedReleaseId: queue.selectedReleaseId } : {}),
    }
    const selectedReleaseScope = options.scope !== undefined
      ? options.scope
      : canonicalState
        ? canonicalState.scope
        : selectedReleaseScopeFromQueueLike(typedQueue)
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

    const activeBlocked = tasks
      .filter(task => ['in_progress', 'review', 'gate_check'].includes(String(task.status ?? '')))
      .find(task => deriveWorkExecutionState(typedQueue.tasks, task.id).summaryState === 'blocked')
    if (activeBlocked) {
      const focusTitle = typeof activeBlocked.title === 'string' && activeBlocked.title.trim()
        ? activeBlocked.title.trim()
        : activeBlocked.id
      const blockReason = taskBlockerSummary(activeBlocked)
      return {
        canStart: false,
        code: 'no_unattended_progress',
        message: `"${focusTitle}" is blocked before unattended work can run${blockReason ? `: ${blockReason}` : '.'}`,
        actionHref: `/work?task=${encodeURIComponent(activeBlocked.id)}`,
        focusTaskId: activeBlocked.id,
        focusTaskTitle: focusTitle,
        focusKind: 'blocked_work',
        count: 1,
      }
    }

    let runnable = 0
    let needsBriefCleanup = 0
    let firstBriefCleanupTaskId: string | null = null
    let firstBriefCleanupTaskTitle: string | null = null
    let structurallyIncomplete = 0
    let firstStructurallyIncompleteTaskId: string | null = null
    let firstStructurallyIncompleteTaskTitle: string | null = null
    let waitingForApproval = 0
    let firstWaitingSpecTaskId: string | null = null
    let firstWaitingSpecTaskTitle: string | null = null
    let blockedExecution = 0
    let firstBlockedExecutionTaskId: string | null = null
    let firstBlockedExecutionTaskTitle: string | null = null
    let firstBlockedExecutionReason: string | null = null
    let terminal = 0
    for (const task of tasks) {
      if (!task || typeof task !== 'object') continue
      const status = String((task as { status?: unknown }).status ?? '')
      if (status === 'blocked') {
        terminal += 1
        blockedExecution += 1
        if (!firstBlockedExecutionTaskId) {
          firstBlockedExecutionTaskId = task.id
          firstBlockedExecutionTaskTitle = typeof task.title === 'string' && task.title.trim()
            ? task.title.trim()
            : task.id
          const blockReason = taskBlockerSummary(task)
          firstBlockedExecutionReason = blockReason.length > 0 ? blockReason : null
        }
        continue
      }
      if (['done', 'shelved', 'pending_pr', 'archived', 'cancelled'].includes(status)) {
        terminal += 1
        continue
      }
      if (importedContractWorkIsStructurallyIncomplete(task as Record<string, unknown>)) {
        structurallyIncomplete += 1
        if (!firstStructurallyIncompleteTaskId) {
          const id = (task as { id?: unknown }).id
          firstStructurallyIncompleteTaskId = typeof id === 'string' && id.trim() ? id.trim() : null
          firstStructurallyIncompleteTaskTitle =
            typeof (task as { title?: unknown }).title === 'string' && (task as { title: string }).title.trim()
              ? (task as { title: string }).title.trim()
              : null
        }
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
      const executionState = deriveWorkExecutionState(typedQueue.tasks, task.id)
      if (!executionState.isRunnable && executionState.summaryState === 'blocked') {
        blockedExecution += 1
        if (!firstBlockedExecutionTaskId) {
          firstBlockedExecutionTaskId = task.id
          firstBlockedExecutionTaskTitle = typeof task.title === 'string' && task.title.trim()
            ? task.title.trim()
            : task.id
          const blockReason = taskBlockerSummary(task)
          firstBlockedExecutionReason = blockReason.length > 0 ? blockReason : null
        }
        continue
      }
      if (['proposed', 'exploring', 'ready', 'in_progress', 'review', 'gate_check'].includes(status)) {
        runnable += 1
      }
    }

    if (runnable > 0 || (terminal === tasks.length && blockedExecution === 0)) return null
    if (blockedExecution > 0) {
      const focusTitle = firstBlockedExecutionTaskTitle ?? 'the first blocked task'
      return {
        canStart: false,
        code: 'no_unattended_progress',
        message: blockedExecution === 1
          ? `"${focusTitle}" is blocked before unattended work can run${firstBlockedExecutionReason ? `: ${firstBlockedExecutionReason}` : '.'}`
          : `${blockedExecution} work items are blocked before unattended work can run. Start with "${focusTitle}".`,
        actionHref: firstBlockedExecutionTaskId ? `/work?task=${encodeURIComponent(firstBlockedExecutionTaskId)}` : '/work',
        focusTaskId: firstBlockedExecutionTaskId ?? undefined,
        focusTaskTitle: firstBlockedExecutionTaskTitle ?? undefined,
        focusKind: 'blocked_work',
        count: blockedExecution,
      }
    }
    if (structurallyIncomplete > 0) {
      const focusTitle = firstStructurallyIncompleteTaskTitle ?? 'the first imported contract task'
      return {
        canStart: false,
        code: 'no_unattended_progress',
        message:
          structurallyIncomplete === 1
            ? `"${focusTitle}" needs concrete contract names before unattended work can run. Refresh or reshape the imported work so Guildhall can prove the actual contract surface.`
            : `${structurallyIncomplete} imported contract tasks need concrete contract names before unattended work can run. Start with "${focusTitle}".`,
        actionHref: firstStructurallyIncompleteTaskId ? `/work?task=${encodeURIComponent(firstStructurallyIncompleteTaskId)}` : '/work',
        focusTaskId: firstStructurallyIncompleteTaskId ?? undefined,
        focusTaskTitle: firstStructurallyIncompleteTaskTitle ?? undefined,
        focusKind: 'brief_cleanup',
        count: structurallyIncomplete,
      }
    }
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
    return null
  }

  async function startBlockerForSelectedReleaseReview(
    projectPath: string,
    resolvedConfig: ReturnType<typeof resolveConfig>,
    options: StartStateSnapshot = {},
  ): Promise<{
    canStart: false
    code: 'no_unattended_progress' | 'repository_followup_required'
    message: string
    actionHref: string
    focusTaskId?: string
    focusTaskTitle?: string
    focusKind?: string
    count?: number
  } | null> {
    const tasksPath = projectTasksPath(projectPath)
    const hasSharedState = options.queue !== undefined && options.effectiveTasks !== undefined && options.scope !== undefined
    const canonicalState = !hasSharedState && readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
      ? await readProjectCanonicalCurrentState(projectPath)
      : null
    if (!canonicalState && !projectTaskStateExistsSync(tasksPath)) return null
    const rawQueue = options.queue ?? canonicalState?.rawQueue ?? await readTaskQueueFileNormalized(tasksPath)
    if (rawQueue.tasks.length === 0) return null
    const hasReleaseBoundary =
      Boolean(rawQueue.selectedReleaseId) ||
      (rawQueue.releases?.length ?? 0) > 0 ||
      rawQueue.tasks.some(task => ((task as Task).releaseIds?.length ?? 0) > 0)
    if (!hasReleaseBoundary) return null
    const tasks = (options.effectiveTasks ?? canonicalState?.tasks ?? await Promise.all(rawQueue.tasks.map(task => buildEffectiveTask(projectPath, task as Task)))) as unknown as Task[]
    const { orientationSpine, releaseTruth } = buildOrientationSpineWithScopedReleaseTruth({
      projectId: basename(projectPath),
      charter: inferProjectCharterFromExistingSources(projectPath, null),
      selectedReleaseId: rawQueue.selectedReleaseId,
      releases: rawQueue.releases,
      tasks,
      sourceRefs: projectOrientationSourceRefs(projectPath),
    })
    const selectedReleaseScope = options.scope !== undefined
      ? options.scope
      : canonicalState
        ? canonicalState.scope
        : (
          (orientationSpine.selectedTaskScope as OrientationScope | null | undefined) ??
          (orientationSpine.scope as OrientationScope | null | undefined) ??
          selectedReleaseScopeFromQueueLike({
            tasks,
            releases: rawQueue.releases,
            ...(rawQueue.selectedReleaseId ? { selectedReleaseId: rawQueue.selectedReleaseId } : {}),
          })
        )
    const scopedTasks = tasksEligibleForScopeExecution(tasks, selectedReleaseScope)
    const gitStory = await buildProjectGitStorySummary(projectPath, releaseTruth.gitStoryTasks)
    const firstBlocked = scopedTasks.find(task => {
      const status = String(task.status ?? '')
      return status === 'blocked' || deriveWorkExecutionState(tasks, task.id).summaryState === 'blocked'
    })
    if (firstBlocked) {
      const focusTitle = typeof firstBlocked.title === 'string' && firstBlocked.title.trim()
        ? firstBlocked.title.trim()
        : firstBlocked.id
      const matchingRepositoryBlocker = gitStory.blockers.find(blocker =>
        blocker.taskId === firstBlocked.id && gitStoryBlocksUnattendedStart(blocker),
      )
      if (matchingRepositoryBlocker) {
        return {
          canStart: false,
          code: 'repository_followup_required',
          message: `"${focusTitle}" cannot resume until repository follow-up is finished: ${matchingRepositoryBlocker.reason}`,
          actionHref: '/release',
          focusTaskId: firstBlocked.id,
          focusTaskTitle: focusTitle,
          focusKind: 'repository_followup',
          count: 1,
        }
      }
      const blockReason = taskBlockerSummary(firstBlocked)
      const blockedCount = scopedTasks.filter(task =>
        String(task.status ?? '') === 'blocked' ||
        deriveWorkExecutionState(tasks, task.id).summaryState === 'blocked'
      ).length
      return {
        canStart: false,
        code: 'no_unattended_progress',
        message: blockedCount === 1
          ? `"${focusTitle}" is blocked before unattended work can run${blockReason ? `: ${blockReason}` : '.'}`
          : `${blockedCount} work items are blocked before unattended work can run. Start with "${focusTitle}".`,
        actionHref: `/work?task=${encodeURIComponent(firstBlocked.id)}`,
        focusTaskId: firstBlocked.id,
        focusTaskTitle: focusTitle,
        focusKind: 'blocked_work',
        count: blockedCount,
      }
    }
    const specsWaiting = scopedTasks.filter(task => {
      const status = String(task.status ?? '')
      const hasSpecDraft = typeof task.spec === 'string' && task.spec.trim().length > 0
      return status === 'spec_review' && (selectedReleaseScope || hasSpecDraft || specReviewRequiresOwnerApproval({ id: task.id }))
    })
    if (specsWaiting.length > 0) {
      const first = specsWaiting[0]!
      const focusTitle = typeof first.title === 'string' && first.title.trim() ? first.title.trim() : first.id
      return {
        canStart: false,
        code: 'no_unattended_progress',
        message: specsWaiting.length === 1
          ? `"${focusTitle}" is waiting for review before work can start.`
          : `${specsWaiting.length} specs are waiting for review before work can start. Start with "${focusTitle}".`,
        actionHref: `/thread?thread=${encodeURIComponent(`task:${first.id}`)}`,
        focusTaskId: first.id,
        focusTaskTitle: focusTitle,
        focusKind: 'spec_review',
        count: specsWaiting.length,
      }
    }
    const startBlockingReleaseBlockers = releaseTruth.releaseBlockers.filter(blocker =>
      !['proof_evidence_missing', 'imported_scope_shaping', 'brief_cleanup', 'brief_approval_required', 'spec_review_required'].includes(blocker.code ?? ''),
    )
    if (releaseTruth.unapprovedSpecs.length === 0 && startBlockingReleaseBlockers.length === 0) return null

    const blocker = startBlockingReleaseBlockers[0]
    if (!blocker) {
      const first = releaseTruth.unapprovedSpecs[0]
      if (!first) return null
      const focusTitle = first.title ?? 'the first spec'
      return {
        canStart: false,
        code: 'no_unattended_progress',
        message:
          releaseTruth.unapprovedSpecs.length === 1
            ? `"${focusTitle}" is waiting for review before work can start.`
            : `${releaseTruth.unapprovedSpecs.length} specs are waiting for review before work can start. Start with "${focusTitle}".`,
        actionHref: first.id
          ? `/thread?thread=${encodeURIComponent(`task:${first.id}`)}`
          : '/thread',
        focusTaskId: first.id,
        focusTaskTitle: first.title,
        focusKind: 'spec_review',
        count: releaseTruth.unapprovedSpecs.length,
      }
    }
    const focusTitle = blocker.title?.trim() || 'the first blocker'
    const focusKind = blocker.code === 'spec_review_required'
      ? 'spec_review'
      : blocker.code === 'imported_scope_shaping' || blocker.code === 'brief_cleanup'
        ? 'brief_cleanup'
        : 'blocked_work'
    const specReviewMessage = focusKind === 'spec_review'
      ? releaseTruth.unapprovedSpecs.length === 1
        ? `"${focusTitle}" is waiting for review before work can start.`
        : `${releaseTruth.unapprovedSpecs.length} specs are waiting for review before work can start. Start with "${focusTitle}".`
      : null
    const blockerMessage = blocker.nextAction
      ? `${blocker.label} Next: ${blocker.nextAction}`
      : blocker.label
    return {
      canStart: false,
      code: 'no_unattended_progress',
      message: specReviewMessage ?? (
        startBlockingReleaseBlockers.length === 1
          ? blockerMessage
          : `${startBlockingReleaseBlockers.length} release blockers remain. Start with "${focusTitle}".`
      ),
      actionHref: blocker.id
        ? (focusKind === 'spec_review'
            ? `/thread?thread=${encodeURIComponent(`task:${blocker.id}`)}`
            : `/work?task=${encodeURIComponent(blocker.id)}`)
        : '/work',
      focusTaskId: blocker.id,
      focusTaskTitle: blocker.title,
      focusKind,
      count: startBlockingReleaseBlockers.length,
    }
  }

  function startBlockerForOwnerInput(
    projectPath: string,
    ownerInput?: ProjectSummaryProjection['ownerInput'] | null,
  ): {
    canStart: false
    code: 'owner_input_required'
    message: string
    actionHref: string
  } | null {
    if (ownerInput !== undefined) {
      const openCount = ownerInput?.openCount ?? 0
      if (openCount === 0) return null
      return {
        canStart: false,
        code: 'owner_input_required',
        message: openCount === 1
          ? 'An owner decision needs your answer before work can continue'
          : `${openCount} owner decisions need your answer before work can continue`,
        actionHref: ownerInput?.next?.href ?? '/thread',
      }
    }
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

  /**
   * Compatibility bridge for pre-0.10 task-local questions. New owner-input
   * requests are answered in bounded chat and transition their own request
   * record; only legacy records need this queue mutation while migration data
   * is still present.
   */
  async function recordBoundedChatTaskResponse(input: {
    taskId: string
    questionId: string
    answer: string
  }): Promise<boolean> {
    const tasksPath = projectTasksPath(project.path)
    if (!projectTaskStateExistsSync(tasksPath)) return false
    const now = new Date().toISOString()
    let questionFound = false
    const promoted = writePromotedTaskDetailMutation(tasksPath, input.taskId, {
      projectId: project.id,
      projectRoot: project.path,
      mutate: task => {
        const questions = Array.isArray(task.openQuestions)
          ? [...task.openQuestions as Array<Record<string, unknown>>]
          : []
        const question = questions.find(candidate => candidate.id === input.questionId)
        if (!question) return null
        questionFound = true
        delete question.draftAnswer
        question.answeredAt = now
        question.answer = input.answer
        task.openQuestions = questions
        task.updatedAt = now
        return task
      },
    })
    if (promoted) {
      if (questionFound) {
        await resumeExploring({
          memoryDir: getProjectStateDir(project.path),
          taskId: input.taskId,
          message: `Answer to "${input.questionId}": ${input.answer}`,
        })
      }
      return questionFound
    }
    if (readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database') return false

    const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
    const parsed = queueRead.queue as
      | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
      | Array<Record<string, unknown>>
    const queue = Array.isArray(parsed)
      ? { version: 1, lastUpdated: now, tasks: parsed }
      : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? now, tasks: parsed.tasks ?? [] }
    const task = queue.tasks.find(candidate => candidate.id === input.taskId)
    if (!task) return false
    const questions = Array.isArray(task.openQuestions)
      ? [...task.openQuestions as Array<Record<string, unknown>>]
      : []
    const question = questions.find(candidate => candidate.id === input.questionId)
    if (!question) return false
    delete question.draftAnswer
    question.answeredAt = now
    question.answer = input.answer
    task.openQuestions = questions
    task.updatedAt = now
    queue.lastUpdated = now
    writeProjectTaskQueueWithSummary(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
    await resumeExploring({
      memoryDir: getProjectStateDir(project.path),
      taskId: input.taskId,
      message: `Answer to "${input.questionId}": ${input.answer}`,
    })
    return true
  }

  async function appendPromotedHumanTaskNote(input: {
    taskId: string
    action: string
    now: string
    note: Record<string, unknown>
  }): Promise<void> {
    await appendTaskEvidence(project.path, input.taskId, {
      id: `note-${input.taskId}-${input.now.replace(/[^0-9A-Za-z]/g, '')}-${input.action}`,
      kind: 'note',
      recordedAt: input.now,
      payload: input.note,
    })
  }

  async function clearPromotedTaskShelveReason(taskId: string, updatedAt: string): Promise<void> {
    const store = await readTaskRuntimeStore(project.path)
    const current = store.tasks[taskId]
    if (!current || !('shelveReason' in current)) return
    delete current.shelveReason
    current.updatedAt = updatedAt
    store.lastUpdated = updatedAt
    await writeTaskRuntimeStore(project.path, store)
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
        await repairSpecTimeoutBlockedTask(project.path, body.taskId)
        await repairWeakRecoverySpecReviewTask(project.path, body.taskId)
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
      const tasksPath = projectTasksPath(project.path)
      const canonicalState = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
        ? await readProjectCanonicalCurrentState(project.path)
        : null
      const startReadiness = await projectStartReadiness({
        projectPath: project.path,
        resolvedConfig,
        runtimeProvider,
        allowPaidProviderFallback: runtimeProvider.allowPaidProviderFallback,
        allowTaskReadinessBlocker: !body.taskId,
        ...(body.taskId ? { requestedTaskId: body.taskId } : {}),
        ...(canonicalState
          ? {
              queue: canonicalState.rawQueue as Awaited<ReturnType<typeof readTaskQueueFileNormalized>>,
              effectiveTasks: canonicalState.tasks,
              scope: canonicalState.scope,
              ownerInput: canonicalState.summary?.ownerInput ?? null,
              summary: canonicalState.summary ?? null,
            }
          : {}),
      })
      if (!startReadiness.canStart) {
        if (
          startReadiness.code === 'proof_evidence_missing' &&
          startReadiness.focusTaskId &&
          !body.taskId
        ) {
          const retryUrl = new URL(c.req.url)
          retryUrl.pathname = `/api/project/task/${encodeURIComponent(startReadiness.focusTaskId)}/retry-work`
          const retryRes = await app.fetch(
            new Request(retryUrl, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                instruction:
                  'Recover the missing release proof for this completed work item. Do not treat the task as complete again until the expected proof evidence is recorded.',
              }),
            }),
            c.env,
          )
          if (!retryRes.ok) return retryRes
          const restartUrl = new URL(c.req.url)
          restartUrl.pathname = '/api/project/start'
          return app.fetch(
            new Request(restartUrl, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                ...body,
                taskId: startReadiness.focusTaskId,
                mode: body.mode ?? 'continuous',
              }),
            }),
            c.env,
          )
        }
        if (startReadiness.code === 'all_terminal') {
          const terminal = await terminalStartState(project.path, body.taskId, canonicalState
            ? {
                queue: canonicalState.rawQueue as Awaited<ReturnType<typeof readTaskQueueFileNormalized>>,
                effectiveTasks: canonicalState.tasks,
                scope: canonicalState.scope,
              }
            : undefined)
          if (terminal) {
            return c.json({
              status: 'stopped',
              mode: 'continuous',
              code: terminal.code,
              ...(startReadiness.executionScope ? { executionScope: startReadiness.executionScope } : {}),
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
              ...(startReadiness.executionScope ? { executionScope: startReadiness.executionScope } : {}),
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
        ...(startReadiness.executionScope ? { executionScope: startReadiness.executionScope } : {}),
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
      const linkedRequest = (await listOwnerInputRequests(project.path))
        .find(request => request.boundedChatSessionId === session.id)
      const boundedChat = await submitBoundedChatUserResponse({
        memoryDir: getProjectStateDir(project.path),
        sessionId: session.id,
        subObjectiveId,
        response,
      })
      if (
        linkedRequest?.source.kind === 'task' &&
        linkedRequest.source.questionId === subObjectiveId
      ) {
        await recordBoundedChatTaskResponse({
          taskId: linkedRequest.source.taskId,
          questionId: subObjectiveId,
          answer: response,
        })
      }
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
      // Status is a saved projection read. Repository discovery belongs to
      // the explicit refresh action below, never to a polling GET.
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
      const tasksPath = projectTasksPath(project.path)
      if (!projectTaskStateExistsSync(tasksPath)) {
        return c.json({ status: 'no-task', taskExists: false, specReady: false, drafts: [] })
      }
      const parsed = await readTaskQueueFileNormalized(tasksPath)
      const tasks = parsed.tasks
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
      const savedWorkspaceGoals = await readWorkspaceGoalsState(memoryDir)
      const freshness = savedWorkspaceImportFreshness(savedWorkspaceGoals)
      const savedTaskStatus = savedWorkspaceImportTaskStatus(project.path)
      const approved = savedWorkspaceGoals?.approved ?? null
      const detected = savedWorkspaceGoals?.detected ?? null

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
        needed: freshness === 'current' ? approved === null : false,
        seeded: savedTaskStatus !== null || savedWorkspaceGoals !== null,
        taskStatus: savedTaskStatus ?? (savedWorkspaceGoals ? 'done' : null),
        specPresent: savedWorkspaceGoals !== null,
        leverPosition,
        draft: {
          goals: approved?.goalCount ?? detected?.goalCount ?? 0,
          tasks: approved?.taskCount ?? detected?.taskCount ?? 0,
          milestones: approved?.milestoneCount ?? detected?.milestoneCount ?? 0,
        },
        approved,
        detected,
        inventory: {
          ran: savedWorkspaceGoals ? ['workspace-goals.json'] : [],
          signals: detected?.taskCount ?? 0,
          failed: [],
        },
        projection: {
          freshness,
          requiresRefresh: freshness !== 'current',
          source: 'workspace-goals.json',
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
      const queue = await readTaskQueueFileNormalized(projectTasksPath(project.path))
      const sources = await collectProjectReintakeSources(project.path)
      const draft = planProjectReintake({
        projectPath: project.path,
        sources,
        tasks: queue.tasks,
        releases: queue.releases,
      })
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
      if (project.initializationNeeded) {
        return c.json({
          taskExists: false,
          specReady: false,
          parsed: null,
          detected: null,
          dismissed: false,
          projection: { freshness: 'missing', requiresRefresh: true },
        })
      }
      const memoryDir = getProjectStateDir(project.path)
      const savedWorkspaceGoals = await readWorkspaceGoalsState(memoryDir)
      const freshness = savedWorkspaceImportFreshness(savedWorkspaceGoals)
      const savedDraft = savedWorkspaceImportDraft(savedWorkspaceGoals)
      const savedReview = savedDraft ? buildWorkspaceImportReview(savedDraft, [], project.path) : null
      const detected = savedDraft
        ? {
            ...savedDraft,
            ...(savedReview ? { review: savedReview } : {}),
            ...(savedReview
              ? { learning: buildLearningSnapshot({ memoryDir, review: savedReview, draft: savedDraft }).effective }
              : {}),
          }
        : null
      const taskStatus = savedWorkspaceImportTaskStatus(project.path) ?? (savedWorkspaceGoals ? 'done' : null)
      const parsed = savedWorkspaceGoals
        ? {
            goals: [...savedWorkspaceGoals.goals],
            tasks: [...savedWorkspaceGoals.tasks],
            milestones: [...savedWorkspaceGoals.milestones],
            context: [...savedWorkspaceGoals.context],
          }
        : null
      const specReady = parsed
        ? parsed.goals.length + parsed.tasks.length + parsed.milestones.length > 0
        : false
      return c.json({
        taskExists: taskStatus !== null || savedWorkspaceGoals !== null,
        specReady,
        taskStatus,
        parsed,
        effective: savedDraft,
        detected,
        dismissed: Boolean(savedWorkspaceGoals?.dismissed),
        anchors: [],
        projection: {
          freshness,
          requiresRefresh: freshness !== 'current',
          source: 'workspace-goals.json',
        },
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
        let raw = (readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database' || projectTaskStateExistsSync(tasksPath))
          ? await readProjectTaskQueueForRichMutation(project.path) as
              | Array<Record<string, unknown>>
              | { tasks?: Array<Record<string, unknown>> }
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
          raw = await readProjectTaskQueueForRichMutation(project.path) as
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
      if (Array.isArray(body.taskIds)) {
        filteredDraft.tasks = filteredDraft.tasks.map(task => ({ ...task, scope: 'current' }))
      }
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

      // Workspace import facts come from the saved review projection. A live
      // detector run belongs to the explicit import refresh actions.
      const workspaceGoalsState = await readWorkspaceGoalsState(memoryDir)
      const freshness = savedWorkspaceImportFreshness(workspaceGoalsState)
      const approved = workspaceGoalsState?.approved ?? null
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
        workspaceGoals = {
          imported: true,
          dismissed: false,
          goalCount: approved?.goalCount ?? 0,
          taskCount: approved?.taskCount ?? 0,
          milestoneCount: approved?.milestoneCount ?? 0,
          approved: approved
            ? {
                goalCount: approved.goalCount,
                taskCount: approved.taskCount,
                milestoneCount: approved.milestoneCount,
                currentTaskCount: approved.currentTaskCount,
                laterTaskCount: approved.laterTaskCount,
              }
            : null,
          detected: workspaceGoalsState.detected
            ? {
                goalCount: workspaceGoalsState.detected.goalCount,
                taskCount: workspaceGoalsState.detected.taskCount,
                milestoneCount: workspaceGoalsState.detected.milestoneCount,
                currentTaskCount: workspaceGoalsState.detected.currentTaskCount,
                laterTaskCount: workspaceGoalsState.detected.laterTaskCount,
              }
            : null,
        }
      }
      if (!workspaceGoals && workspaceGoalsState?.approved) {
        workspaceGoals = {
          imported: true,
          dismissed: false,
          goalCount: workspaceGoalsState.approved.goalCount,
          taskCount: workspaceGoalsState.approved.taskCount,
          milestoneCount: workspaceGoalsState.approved.milestoneCount,
          approved: workspaceGoalsState.approved
            ? {
                goalCount: workspaceGoalsState.approved.goalCount,
                taskCount: workspaceGoalsState.approved.taskCount,
                milestoneCount: workspaceGoalsState.approved.milestoneCount,
                currentTaskCount: workspaceGoalsState.approved.currentTaskCount,
                laterTaskCount: workspaceGoalsState.approved.laterTaskCount,
              }
            : null,
          detected: workspaceGoalsState.detected
            ? {
                goalCount: workspaceGoalsState.detected.goalCount,
                taskCount: workspaceGoalsState.detected.taskCount,
                milestoneCount: workspaceGoalsState.detected.milestoneCount,
                currentTaskCount: workspaceGoalsState.detected.currentTaskCount,
                laterTaskCount: workspaceGoalsState.detected.laterTaskCount,
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
          packageManagers: typeof b?.packageManager === 'string' && b.packageManager.trim().length > 0
            ? [b.packageManager]
            : ['unknown'],
          verifiedAt: typeof b?.verifiedAt === 'string' ? b.verifiedAt : null,
          install: b?.install ?? null,
          gates: b?.gates ?? null,
          editHref: '/settings',
          freshness: typeof b?.packageManager === 'string' && b.packageManager.trim().length > 0
            ? 'current'
            : 'missing',
        },
        workspace: {
          goals: workspaceGoals,
          reviewHref: `/projects/${encodeURIComponent(project.id)}/workspace-import`,
          freshness,
          requiresRefresh: freshness !== 'current',
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
        projection: {
          freshness,
          requiresRefresh: freshness !== 'current',
          source: 'workspace-goals.json',
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
      await dismissWorkspaceImportState({ memoryDir })
      await dismissWorkspaceImportTask({ memoryDir, projectPath: project.path })
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
      const savedWorkspaceGoals = await readWorkspaceGoalsState(memoryDir)
      const freshness = savedWorkspaceImportFreshness(savedWorkspaceGoals)
      const draft = savedWorkspaceImportDraft(savedWorkspaceGoals) ?? {
        goals: [],
        tasks: [],
        milestones: [],
        context: [],
        stats: { inputSignals: 0, drafted: 0, deduped: 0 },
      } satisfies WorkspaceImportDraft
      const review = buildWorkspaceImportReview(draft, [], project.path)
      return c.json({
        ...buildLearningSnapshot({ memoryDir, review, draft }),
        projectSkillProposals: readProjectSkillProposals(memoryDir),
        projectContext: await buildProjectContextSummary(project.path, memoryDir),
        projection: {
          freshness,
          requiresRefresh: freshness !== 'current',
          source: 'learning.json + workspace-goals.json',
        },
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
      // A missing or stale attention projection is an honest cache miss. Do
      // not rebuild Inbox, expand tasks, scan sources, or repair state from a
      // GET. The projector will populate this read model asynchronously.
      const surfaceState = readProjectSurfaceStateAtBoundary(project.path, {
        includeProjection: false,
        includeAttention: true,
      })
      return c.json(readSavedAttentionSurfaceFromBoundary({
        initializationNeeded: project.initializationNeeded,
        records: surfaceState?.attentionRecords ?? null,
        watermarkSourceRevision: surfaceState?.attentionWatermark?.sourceRevision ?? null,
        projectRevision: surfaceState?.projectRevision ?? null,
        releaseTruth: surfaceState?.summary?.releaseSummary ?? null,
      }))
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
      const surfaceState = readProjectSurfaceStateAtBoundary(project.path, {
        includeThread: true,
      })
      const threadRead = threadReadProjectionFromBoundary(surfaceState?.thread as never)
      // Thread needs navigation context, not the full release gate. The
      // compact project projection owns the same scope and next-action facts
      // used by Overview, Work, and Map; repository, design-system, and Git
      // checks stay on the explicit release-readiness route.
      const compactProject = await buildProjectionSurfaceDetail({
        surface: 'work',
        requestedTaskId: null,
        ...(surfaceState ? { surfaceState } : {}),
      })
      timing[0]!.endedAt = Date.now()
      c.header('server-timing', formatServerTiming(timing))
      return c.json({
        ...threadRead.payload,
        currentThreadFreshness: threadRead.currentThreadFreshness,
        historyPayload: {
          kind: 'thread-history',
          href: '/api/project/thread/history',
          omitted: 'Older completed turns remain available through the explicit history route.',
        },
        orientationSpine: compactProject.orientationSpine,
        releaseReadiness: compactProject.releaseReadiness,
        startReadiness: compactProject.startReadiness,
        actionModel: compactProject.actionModel,
        detailPayload: compactProject.detailPayload,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/thread/history', async c => {
    try {
      if (project.initializationNeeded) return c.json({ turns: [], offset: 0, limit: 0, total: 0, hasMore: false })
      const offset = Math.max(0, Number.parseInt(c.req.query('offset') ?? '0', 10) || 0)
      const limit = Math.min(100, Math.max(1, Number.parseInt(c.req.query('limit') ?? '50', 10) || 50))
      return c.json(readThreadHistoryReadProjection(project.path, { offset, limit }).body)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/thread/extras', async c => {
    try {
      if (project.initializationNeeded) {
        return c.json({ taskGitStories: {} })
      }
      const diagnostic = c.req.query('diagnostic') === 'true' || c.req.query('live') === 'true'
      if (!diagnostic) {
        return c.json({
          taskGitStories: {},
          freshness: 'saved',
          diagnostic: false,
          requiresRefresh: true,
          diagnosticHref: '/api/project/thread/extras?diagnostic=true',
          detailPayload: {
            kind: 'thread-task-git-story',
            omitted: 'Task Git Story is live checkout inspection and is available only from the explicit diagnostic route.',
          },
        })
      }
      const timing: Array<{ name: string; startedAt: number; endedAt?: number }> = [{ name: 'thread-extras', startedAt: Date.now() }]
      const requestedTaskIds = new Set(
        (c.req.query('taskIds') ?? '')
          .split(',')
          .map(id => id.trim())
          .filter(Boolean),
      )
      const taskIds = requestedTaskIds.size > 0
        ? requestedTaskIds
        : new Set(
            readCurrentThreadTaskIdsAtBoundary(project.path),
          )
      const tasks = taskIds.size > 0
        ? readProjectTaskRecordsAtBoundary(projectTasksPath(project.path), [...taskIds])
        : []
      const taskGitStories: Record<string, unknown> = {}
      if (taskIds.size > 0) {
        const workspaceStore = await readTaskWorkspaceStore(project.path).catch(() => undefined)
        for (const task of tasks) {
          const id = typeof task.id === 'string' ? task.id : ''
          if (!id || !taskIds.has(id) || !shouldAttachTaskGitStory(id)) continue
          const gitStory = await gitStoryForTaskIfUseful(project.path, task, workspaceStore?.workspaces[id]).catch(() => undefined)
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
      const savedSummary = readProjectSummaryForProjectAtBoundary(project.path)
      const snap = buildSnapshot({
        projectPath: project.path,
        ...(savedSummary ? { taskCount: savedSummary.counts.total } : {}),
      })
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
      const id = c.req.param('id')
      const task = readProjectTaskRecordAtBoundary(tasksPath, id)
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
      updateProjectSummaryProjection(projectTasksPath(project.path), {
        orientation: inferProjectOrientationSnapshot(project.path, project.config),
      })
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/git-story', async c => {
    try {
      if (project.initializationNeeded) return c.json({ initializationNeeded: true })
      const liveDiagnostics = c.req.query('live') === 'true' || c.req.query('diagnostic') === 'true'
      if (!liveDiagnostics) {
        const state = await readProjectReleaseState(project.path)
        return c.json(savedProjectGitStorySummary(state))
      }

      // Even an explicit live diagnostic starts from the same current-state
      // boundary as Release, Overview, Work, and Map. Git inspection is the
      // diagnostic overlay; it must not choose a second task authority.
      const state = await readProjectCanonicalCurrentState(project.path)
      const tasks = state.tasks
      return c.json({
        ...(await buildProjectGitStorySummary(project.path, tasks as Array<Record<string, unknown>>)),
        source: 'live-git-inspection',
        diagnostic: true,
        freshness: 'live',
        requiresRefresh: false,
        sourceRevision: state.projectRevision,
        projectRevision: state.projectRevision,
        generatedAt: new Date().toISOString(),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // -------------------------------------------------------------------------
  // Per-task detail — powers the drawer. The initial payload is task-shaped;
  // Thread, event history, and diagnostics stay behind explicit tab requests.
  // -------------------------------------------------------------------------
  app.get('/api/project/task/:id', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const tasksPath = projectTasksPath(project.path)
      const run = supervisor.get(project.id)
      const id = c.req.param('id')
      const taskCurrentBoundary = await readProjectTaskCurrentStateAtBoundary(project.path, id, {
        includeRelatedTasks: true,
      })
      const databaseAuthority = taskCurrentBoundary.authority === 'database'
      const taskDetailState = taskCurrentBoundary.state
      const currentTask = taskCurrentBoundary.task
      const savedProjection = taskDetailState?.summary ?? (databaseAuthority ? null : readProjectSummaryForProjectAtBoundary(project.path))
      const pointTask = taskDetailState?.task ?? null
      const indexedRelations = taskDetailState?.relationships ?? null
      const indexedQueue = taskDetailState?.queue ?? null
      if (databaseAuthority && !taskDetailState) {
        return c.json({ error: 'task not found' }, 404)
      }
      const pointDefinition = pointTask && Object.keys(pointTask.definition).length > 0
        ? {
            ...projectTaskRecordFromDatabasePoint(pointTask),
            ...(indexedRelations?.parentId && (!pointTask.hierarchy || typeof pointTask.hierarchy.parentId !== 'string')
              ? { hierarchy: { ...(pointTask.hierarchy ?? {}), parentId: indexedRelations.parentId } }
              : {}),
            ...(indexedRelations && Array.isArray(pointTask.hierarchy?.childIds) === false
              ? { hierarchy: { ...(pointTask.hierarchy ?? {}), childIds: indexedRelations.childIds } }
              : {}),
          } as Record<string, unknown>
        : null
      const candidateQueue = databaseAuthority && indexedQueue && pointDefinition
        ? {
            version: 1,
            ...(savedProjection?.source.taskQueueLastUpdated ? { lastUpdated: savedProjection.source.taskQueueLastUpdated } : {}),
            ...(indexedQueue.selectedReleaseId ? { selectedReleaseId: indexedQueue.selectedReleaseId } : {}),
            // Promoted task detail starts with the selected point only.
            // Related points are hydrated after the same snapshot names them.
            tasks: [pointDefinition],
            releases: indexedQueue.releases,
          } as TaskQueue
        : databaseAuthority && indexedQueue && !pointTask
          ? null
        : !databaseAuthority && projectTaskStateExistsSync(tasksPath)
            ? await readTaskQueueFileNormalized(tasksPath, { repair: false })
            : null
      if (databaseAuthority && indexedQueue && !pointTask) {
        return c.json({ error: 'task not found' }, 404)
      }
      const effectiveQueue = candidateQueue
      if (!effectiveQueue) return c.json({ error: databaseAuthority ? 'authoritative task state unavailable' : 'no tasks file' }, databaseAuthority ? 503 : 404)
      const tasks = effectiveQueue.tasks
      const rawQueue = effectiveQueue
      const task = tasks.find(t => (t as { id?: string }).id === id)
      if (!task) return c.json({ error: 'task not found' }, 404)
      const projection = savedProjection ?? (databaseAuthority
        ? null
        : buildProjectSummaryProjection({
            projectId: project.id,
            queue: rawQueue as never,
            approvedPlan: readApprovedPlan(tasksPath),
            currentStateAuthority: 'legacy',
          }))
      if (!projection) {
        return c.json({
          error: 'The saved project summary is unavailable. Refresh the project summary before loading task detail.',
          requiresRefresh: true,
        }, 503)
      }
      const scopeQueue = rawQueue
      // Task detail consumes the selected scope captured by the same
      // database snapshot. It may not rebuild scope membership from the
      // queue after the boundary has returned.
      const readinessScope = databaseAuthority
        ? (taskDetailState?.scope ?? null)
        : releaseReadinessScopeFromProjection(buildProjectScopeProjection({
          tasks: scopeQueue.tasks as unknown as Task[],
          releases: (scopeQueue.releases ?? []) as unknown as ProjectRelease[],
          ...(scopeQueue.selectedReleaseId ? { selectedReleaseId: scopeQueue.selectedReleaseId } : {}),
        }), null)
      const scopedTaskIds = new Set(
        (readinessScope?.nodeIds ?? []).map(nodeId => nodeId.replace(/^work:/, '')),
      )
      const runStatus = run?.status ?? 'stopped'
      const availability = databaseAuthority
        ? taskDetailState?.availability ?? defaultProjectAvailabilityState()
        : await readProjectAvailability(project.path)
      const rawTask = task as Record<string, unknown>
      const relatedTaskIds = new Set<string>()
      if (!databaseAuthority) {
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
        for (const candidate of tasks as Array<Record<string, unknown>>) {
          if (typeof candidate.id !== 'string' || candidate.id === id) continue
          const candidateDependsOn = Array.isArray(candidate.dependsOn) ? candidate.dependsOn : []
          if (candidateDependsOn.includes(id)) relatedTaskIds.add(candidate.id)
        }
      }
      const relatedTaskRecords = databaseAuthority
        ? (taskDetailState?.relatedTasks ?? []).map(projectTaskRecordFromDatabasePoint)
        : [...relatedTaskIds]
            .map(relatedId => tasks.find(candidate => (candidate as { id?: string }).id === relatedId))
            .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate))
      const detailTasks = databaseAuthority
        ? [rawTask, ...relatedTaskRecords]
        : tasks as Array<Record<string, unknown>>
      const deliveryRead = await readProjectDeliveryReadProjectionWithAuthority(project.path, {
        queue: false,
        taskId: id,
      })
      if (databaseAuthority && deliveryRead.authority !== 'database') {
        return c.json({
          error: 'The delivery read boundary lost the promoted project authority.',
          requiresRefresh: true,
        }, 503)
      }
      const savedDeliveryProjection = deliveryRead.projection
      const savedDeliveryModel = deliveryRead.model ?? emptyProjectDeliveryModel()
      if (databaseAuthority && taskDetailState && savedDeliveryProjection?.status === 'current' &&
        savedDeliveryProjection.source.projectRevision !== taskDetailState.projectRevision) {
        return c.json({
          error: 'Task and delivery projections were read from different project revisions.',
          requiresRefresh: true,
          taskProjectRevision: taskDetailState.projectRevision,
          deliveryProjectRevision: savedDeliveryProjection.source.projectRevision,
        }, 409)
      }
      const hasDeliveryModel = savedDeliveryModel.primitives.length > 0 ||
        savedDeliveryModel.validationEvidence.length > 0 ||
        savedDeliveryModel.rejectedCandidates.length > 0
      const promotedDeliveryProjection = savedDeliveryProjection?.status === 'current'
        ? savedDeliveryProjection
        : null
      if (databaseAuthority && hasDeliveryModel && !promotedDeliveryProjection) {
        return c.json({
          error: 'The saved delivery projection is unavailable or stale.',
          deliveryProjection: savedDeliveryProjection,
          requiresRefresh: true,
        }, 503)
      }
      const deliveryModel = savedDeliveryModel
      const legacyDeliveryRelationships = promotedDeliveryProjection
        ? null
        : deriveTaskRelationships({
            model: deliveryModel,
            tasks: detailTasks as unknown as Task[],
            taskId: id,
          })
      const deliveryRelationships = promotedDeliveryProjection
        ? promotedDeliveryProjection.relationships
        : legacyDeliveryRelationships
      const deliveryRelationshipsForResponse = promotedDeliveryProjection && deliveryRelationships
        ? {
            ...deliveryRelationships,
            primitiveUse: {
              ...deliveryRelationships.primitiveUse,
              blockers: promotedDeliveryProjection.primitives.primitives
                .filter(primitive => (
                  promotedDeliveryProjection.relationships?.primitiveUse.direct.includes(primitive.id) ||
                  promotedDeliveryProjection.relationships?.primitiveUse.ancestors.includes(primitive.id)
                ))
                .filter(primitive => primitive.status !== 'ready' && primitive.status !== 'deprecated'),
            },
          }
        : deliveryRelationships
      const deliveryContextPacket = promotedDeliveryProjection
        ? contextPacketFromDeliveryReadProjection(promotedDeliveryProjection, project.path)
        : buildTaskContextPacket({
            model: deliveryModel,
            tasks: detailTasks as unknown as Task[],
            taskId: id,
            relationships: legacyDeliveryRelationships!,
          })
      // The drawer is an ordinary current-state read. Historical evidence is
      // behind the explicit history/review/evidence links below.
      // Promoted task state is assembled by the named current-task boundary.
      // The legacy branch is the only compatibility path that may still
      // assemble an effective task in the route.
      const effectiveTask = databaseAuthority && currentTask
        ? currentTask as Task
        : await buildEffectiveTask(project.path, rawTask as Task)
      const enrichedTask = await enrichTaskForServe(project.path, rawTask, effectiveTask)
      const proofMissingForSelectedScope = scopedTaskIds.has(String(enrichedTask.id ?? '')) &&
        String(enrichedTask.status ?? '') === 'done' &&
        taskDoneButProofMissing(enrichedTask)
      const selectedTask = proofMissingForSelectedScope
        ? { ...enrichedTask, completionProof: releaseProofMissingCompletionProof(enrichedTask) }
        : enrichedTask
      // Selected-scope counts belong to the durable project summary. Reusing
      // the queue here made task detail recompute scope membership and disagree
      // with Overview/Map/Work/Release for the same project revision.
      const projectedWorkProgress = workProgressFromProjectSummaryProjection(projection)
      const selectedWorkProgress = deriveProjectWorkProgress([effectiveTask as unknown as Record<string, unknown>])
      const workProgress = {
        ...projectedWorkProgress,
        byTaskId: selectedWorkProgress.byTaskId,
      }
      const relatedTasks = relatedTaskRecords.map(compactTaskForTaskDetailRelated)
      return c.json({
        task: compactTaskForInitialDrawer(selectedTask),
        relatedTasks,
        workProgress,
        runStatus,
        availability,
        deliverySpine: {
          model: deliveryModel,
          validation: promotedDeliveryProjection
            ? promotedDeliveryProjection.validation
            : validateProjectDeliveryModel({ model: deliveryModel, tasks: detailTasks as Task[], projectRoot: project.path }),
          relationships: deliveryRelationshipsForResponse,
          contextPacket: deliveryContextPacket,
        },
        detailPayload: {
          omitted: [
            'task notes',
            'task evidence ledger',
            'review verdict history',
            'review adjudications',
            'task thread turns',
            'recent task events',
            'context debug',
            'exploring transcript',
          ],
          extrasHref: `/api/project/task/${encodeURIComponent(id)}/extras`,
          historyHref: `/api/project/task/${encodeURIComponent(id)}/history`,
          reviewHref: `/api/project/task/${encodeURIComponent(id)}/review`,
          evidenceHref: `/api/project/task/${encodeURIComponent(id)}/evidence`,
          gitStoryHref: `/api/project/task/${encodeURIComponent(id)}/git-story`,
        },
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/task/:id/extras', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const taskId = c.req.param('id')
      const include = new Set((c.req.query('include') ?? '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean))
      if (include.size === 0) return c.json({ error: 'include is required' }, 400)
      const supportedIncludes = new Set(['context', 'transcript', 'events', 'thread'])
      const unsupportedIncludes = [...include].filter(value => !supportedIncludes.has(value))
      if (unsupportedIncludes.length > 0) return c.json({ error: `unsupported include: ${unsupportedIncludes.join(', ')}` }, 400)
      const memoryDir = getProjectStateDir(project.path)
      const payload: Record<string, unknown> = { taskId }
      if (include.has('context')) {
        payload.contextDebug = (await readContextDebugForTasks(memoryDir, [taskId])).get(taskId) ?? []
      }
      if (include.has('transcript')) payload.exploringTranscript = await readExploringTranscript({ memoryDir, taskId })
      if (include.has('events')) {
        payload.recentEvents = filterEventsForTask(supervisor.recent(project.id, undefined, project.path), taskId)
      }
      if (include.has('thread')) {
        payload.threadTurns = readThreadReadProjection(project.path).payload.turns
          .filter(turn => typeof turn === 'object' && turn !== null && !Array.isArray(turn))
          .filter(turn => (turn as { taskId?: unknown }).taskId === taskId)
      }
      return c.json(payload)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/delivery-spine', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const deliveryRead = await readProjectDeliveryReadProjectionWithAuthority(project.path, { queue: { limit: 100 } })
      if (deliveryRead.authority === 'database') {
        const projection = deliveryRead.projection
        if (!projection) return c.json({ error: 'The saved delivery projection is unavailable or stale.', requiresRefresh: true }, 503)
        if (projection.status !== 'current') {
          const model = deliveryRead.model
          const noDeliveryState = !model || (
            model.primitives.length === 0 &&
            model.validationEvidence.length === 0 &&
            model.rejectedCandidates.length === 0
          )
          if (noDeliveryState && projection.status === 'missing' && projection.reason === 'projection_missing') {
            const emptyModel = emptyProjectDeliveryModel()
            return c.json({
              model: emptyModel,
              validation: validateProjectDeliveryModel({ model: emptyModel, tasks: [], projectRoot: project.path }),
              primitives: [],
              queue: { runnable: [], blocked: [], hasMore: false },
              deliveryProjection: {
                status: 'empty',
                freshness: 'missing',
              },
            })
          }
          return c.json({
            error: 'The saved delivery projection is unavailable or stale.',
            deliveryProjection: projection,
            requiresRefresh: true,
          }, 503)
        }
        return c.json({
          model: projection.model,
          validation: projection.validation,
          primitives: projection.primitives.primitives,
          queue: projection.queue,
          deliveryProjection: {
            status: projection.status,
            freshness: projection.freshness,
            source: projection.source,
          },
        })
      }
      const tasks = await readProjectDeliveryTasks(project.path)
      const model = deliveryRead.model ?? emptyProjectDeliveryModel()
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
      const deliveryRead = await readProjectDeliveryReadProjectionWithAuthority(project.path, { queue: { limit: 100 } })
      if (deliveryRead.authority === 'database') {
        const projection = deliveryRead.projection
        if (!projection) return c.json({ error: 'The saved delivery queue projection is unavailable or stale.', requiresRefresh: true }, 503)
        if (projection.status !== 'current') {
          return c.json({
            error: 'The saved delivery queue projection is unavailable or stale.',
            deliveryProjection: projection,
            requiresRefresh: true,
          }, 503)
        }
        return c.json(projection.queue ?? { runnable: [], blocked: [], hasMore: false })
      }
      const tasks = await readProjectDeliveryTasks(project.path)
      const model = deliveryRead.model ?? emptyProjectDeliveryModel()
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
      await writeTasksFilePreservingQueue(tasksPath, applied.tasks as unknown as Array<Record<string, unknown>>, project.path)
      await refreshProjectDeliveryReadProjection(project.path)
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
      await refreshProjectDeliveryReadProjection(project.path)
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
      await writeTasksFilePreservingQueue(tasksPath, reverted.tasks as unknown as Array<Record<string, unknown>>, project.path)
      await refreshProjectDeliveryReadProjection(project.path)
      return c.json({ ok: true, warnings: reverted.warnings })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/task/:id/relationships', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const deliveryRead = await readProjectDeliveryReadProjectionWithAuthority(project.path, {
        queue: false,
        taskId: c.req.param('id'),
      })
      if (deliveryRead.authority === 'database') {
        const projection = deliveryRead.projection
        if (!projection) return c.json({ error: 'The saved task relationships projection is unavailable or stale.', requiresRefresh: true }, 503)
        if (projection.status !== 'current') {
          return c.json({
            error: 'The saved task relationships projection is unavailable or stale.',
            deliveryProjection: projection,
            requiresRefresh: true,
          }, projection.status === 'missing' && projection.reason === 'projection_missing' ? 503 : 409)
        }
        if (projection.taskState === 'missing' || !projection.relationships) return c.json({ error: 'task not found' }, 404)
        return c.json(projection.relationships)
      }
      const tasks = await readProjectDeliveryTasks(project.path)
      const model = deliveryRead.model ?? emptyProjectDeliveryModel()
      return c.json(deriveTaskRelationships({ model, tasks: tasks as Task[], taskId: c.req.param('id') }))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/task/:id/context-packet', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const deliveryRead = await readProjectDeliveryReadProjectionWithAuthority(project.path, {
        queue: false,
        taskId: c.req.param('id'),
      })
      if (deliveryRead.authority === 'database') {
        const projection = deliveryRead.projection
        if (!projection) return c.json({ error: 'The saved task context projection is unavailable or stale.', requiresRefresh: true }, 503)
        if (projection.status !== 'current') {
          return c.json({
            error: 'The saved task context projection is unavailable or stale.',
            deliveryProjection: projection,
            requiresRefresh: true,
          }, projection.status === 'missing' && projection.reason === 'projection_missing' ? 503 : 409)
        }
        if (projection.taskState === 'missing') return c.json({ error: 'task not found' }, 404)
        const packet = contextPacketFromDeliveryReadProjection(projection, project.path)
        if (!packet) return c.json({ error: 'task context projection is incomplete', requiresRefresh: true }, 503)
        return c.json(packet)
      }
      const tasks = await readProjectDeliveryTasks(project.path)
      const model = deliveryRead.model ?? emptyProjectDeliveryModel()
      const taskId = c.req.param('id')
      const relationships = deriveTaskRelationships({ model, tasks: tasks as Task[], taskId })
      return c.json(buildTaskContextPacket({
        model,
        tasks: tasks as Task[],
        taskId,
        relationships,
      }))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/task/:id/evidence', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const id = c.req.param('id')
      const taskRead = await readProjectTaskEndpointPoint(project.path, id)
      if (!taskRead) return c.json({ error: 'task not found' }, 404)
      const requestedLimit = Number.parseInt(c.req.query('limit') ?? '', 10)
      const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(200, requestedLimit)
        : 100
      const requestedCursor = Number.parseInt(c.req.query('cursor') ?? '0', 10)
      const cursor = Number.isFinite(requestedCursor) && requestedCursor >= 0 ? requestedCursor : 0
      const page = await readProjectTaskEvidencePageAtBoundary(project.path, id, {
        cursor,
        limit,
        order: 'oldest',
      })
      if (
        taskRead.projectRevision !== null &&
        page.revision !== undefined &&
        taskRead.projectRevision !== page.revision
      ) {
        return c.json({
          error: 'Task evidence changed while loading this page.',
          code: 'project_state_revision_mismatch',
          requiresRefresh: true,
          taskProjectRevision: taskRead.projectRevision,
          evidenceProjectRevision: page.revision,
        }, 409)
      }
      return c.json({
        taskId: id,
        evidence: page.events,
        pagination: {
          cursor: page.cursor,
          limit: page.limit,
          total: page.total,
          hasMore: page.hasMore,
          bytes: page.bytes,
          maxBytes: page.maxBytes,
          ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
        },
        ...(page.authority ? { authority: page.authority } : {}),
        ...(page.projectAuthority ? { projectAuthority: page.projectAuthority } : {}),
        ...(page.revision !== undefined ? { projectRevision: page.revision } : {}),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/task/:id/file', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const tasksPath = projectTasksPath(project.path)
      const id = c.req.param('id')
      const task = await readProjectTaskForServe(tasksPath, id)
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
      const id = c.req.param('id')
      const taskRead = await readProjectTaskEndpointPoint(project.path, id)
      if (!taskRead) return c.json({ error: 'task not found' }, 404)
      const task = taskRead.task as Task
      const canonicalDescriptions = new Set(
        Array.isArray(task.acceptanceCriteria)
          ? task.acceptanceCriteria
              .map(criterion => typeof criterion?.description === 'string' ? criterion.description.trim() : '')
              .filter(Boolean)
          : [],
      )
      const requestedLimit = Number.parseInt(c.req.query('limit') ?? '', 10)
      const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(200, requestedLimit)
        : 100
      const requestedCursor = Number.parseInt(c.req.query('cursor') ?? '0', 10)
      const cursor = Number.isFinite(requestedCursor) && requestedCursor >= 0 ? requestedCursor : 0
      const page = await readProjectTaskEvidencePageAtBoundary(project.path, id, {
        cursor,
        limit,
        order: 'oldest',
        filter: event => (
          event.kind === 'note' ||
          event.kind === 'escalation' ||
          event.kind === 'agent_issue' ||
          event.kind === 'gate_result' ||
          event.kind === 'merge_record'
        ) && (event.kind !== 'note' || noteMatchesCanonicalAcceptance(event.payload, canonicalDescriptions)),
      })
      if (
        taskRead.projectRevision !== null &&
        page.revision !== undefined &&
        taskRead.projectRevision !== page.revision
      ) {
        return c.json({
          error: 'Task history changed while loading this page.',
          code: 'project_state_revision_mismatch',
          requiresRefresh: true,
          taskProjectRevision: taskRead.projectRevision,
          historyProjectRevision: page.revision,
        }, 409)
      }
      return c.json({
        taskId: id,
        events: page.events,
        pagination: {
          cursor: page.cursor,
          limit: page.limit,
          total: page.total,
          hasMore: page.hasMore,
          bytes: page.bytes,
          maxBytes: page.maxBytes,
          ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
        },
        ...(page.authority ? { authority: page.authority } : {}),
        ...(page.projectAuthority ? { projectAuthority: page.projectAuthority } : {}),
        ...(page.revision !== undefined ? { projectRevision: page.revision } : {}),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/task/:id/review', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const id = c.req.param('id')
      const taskRead = await readProjectTaskEndpointPoint(project.path, id)
      if (!taskRead) return c.json({ error: 'task not found' }, 404)
      const requestedLimit = Number.parseInt(c.req.query('limit') ?? '', 10)
      const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(100, requestedLimit)
        : 50
      const requestedCursor = Number.parseInt(c.req.query('cursor') ?? '0', 10)
      const cursor = Number.isFinite(requestedCursor) && requestedCursor >= 0 ? requestedCursor : 0
      const page = await readProjectTaskEvidencePageAtBoundary(project.path, id, {
        cursor,
        limit,
        order: 'oldest',
        filter: event => event.kind === 'review_verdict' || event.kind === 'adjudication',
      })
      if (
        taskRead.projectRevision !== null &&
        page.revision !== undefined &&
        taskRead.projectRevision !== page.revision
      ) {
        return c.json({
          error: 'Task review history changed while loading this page.',
          code: 'project_state_revision_mismatch',
          requiresRefresh: true,
          taskProjectRevision: taskRead.projectRevision,
          reviewProjectRevision: page.revision,
        }, 409)
      }
      return c.json({
        taskId: id,
        verdicts: page.events.filter(event => event.kind === 'review_verdict'),
        adjudications: page.events.filter(event => event.kind === 'adjudication'),
        pagination: {
          cursor: page.cursor,
          limit: page.limit,
          total: page.total,
          hasMore: page.hasMore,
          bytes: page.bytes,
          maxBytes: page.maxBytes,
          ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
        },
        ...(page.authority ? { authority: page.authority } : {}),
        ...(page.projectAuthority ? { projectAuthority: page.projectAuthority } : {}),
        ...(page.revision !== undefined ? { projectRevision: page.revision } : {}),
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.get('/api/project/task/:id/git-story', async c => {
    try {
      if (project.initializationNeeded) return c.json({ error: 'not initialized' }, 400)
      const id = c.req.param('id')
      const taskRead = await readProjectTaskEndpointPoint(project.path, id)
      if (!taskRead) return c.json({ error: 'task not found' }, 404)
      const workspaceStore = await readTaskWorkspaceStore(project.path).catch(() => undefined)
      const snapshot = await gitStoryForTaskIfUseful(project.path, taskRead.task, workspaceStore?.workspaces[id])
      return c.json({
        taskId: id,
        gitStory: snapshot,
        source: 'live-git-inspection',
        diagnostic: true,
        freshness: 'live',
        requiresRefresh: false,
        sourceRevision: taskRead.projectRevision,
        projectRevision: taskRead.projectRevision,
      })
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
      const workspaceStore = await readTaskWorkspaceStore(project.path).catch(() => undefined)
      if (!projectTaskStateExistsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const databaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
      const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
      const parsed = queueRead.queue as
        | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
        | Array<Record<string, unknown>>
      const queue = Array.isArray(parsed)
        ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
        : {
            ...parsed,
            version: parsed.version ?? 1,
            lastUpdated: parsed.lastUpdated ?? new Date().toISOString(),
            tasks: parsed.tasks ?? [],
          }
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
        const cwd = taskGitStoryRepoPath(project.path, task, workspaceStore?.workspaces[id])
        const result = await commitGitStoryFiles({ cwd, files, message })
        if (!result.ok) return c.json({ error: result.detail ?? 'commit failed' }, 500)
        if (databaseAuthority) {
          const promoted = writePromotedTaskDetailMutation(tasksPath, id, {
            projectId: project.id,
            projectRoot: project.path,
            mutate: current => {
              current.updatedAt = now
              return current
            },
          })
          if (!promoted) return c.json({ error: 'task not found' }, 404)
          await appendTaskEvidence(project.path, id, {
            id: `git-story-${id}-${now.replace(/[^0-9A-Za-z]/g, '')}`,
            kind: 'git_story',
            recordedAt: now,
            payload: {
              action: 'commit',
              commitSha: result.commitSha ?? 'unknown commit',
              message,
              files,
            },
          })
          invalidateGitStoryObservation(project.path, 'commit')
          return c.json({ ok: true, commitSha: result.commitSha, task: await enrichTaskForServe(project.path, promoted.task) })
        }
        const notes = Array.isArray(task.notes) ? [...(task.notes as unknown[])] : []
        notes.push({ agentId: 'system:git-story', role: 'system', content: `Committed git story changes: ${result.commitSha ?? 'unknown commit'}.`, timestamp: now })
        task.notes = notes
        task.updatedAt = now
        queue.lastUpdated = now
        writeProjectTaskQueueWithSummary(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
        invalidateGitStoryObservation(project.path, 'commit')
        return c.json({ ok: true, commitSha: result.commitSha, task: await enrichTaskForServe(project.path, task) })
      }
      if (closureAction === 'push') {
        const allowed = policyAllowsGitWrite(project.path, project.config, task, 'push', body)
        if (!allowed.ok) return c.json({ error: allowed.error }, allowed.status as 403 | 409)
        const cwd = taskGitStoryRepoPath(project.path, task, workspaceStore?.workspaces[id])
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
        invalidateGitStoryObservation(project.path, 'push')
        return c.json({ ok: true, branch, task: await enrichTaskForServe(project.path, task) })
      }
      if (closureAction === 'open-pr') {
        const allowed = policyAllowsGitWrite(project.path, project.config, task, 'pullRequest', body)
        if (!allowed.ok) return c.json({ error: allowed.error }, allowed.status as 403 | 409)
        const cwd = taskGitStoryRepoPath(project.path, task, workspaceStore?.workspaces[id])
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
        invalidateGitStoryObservation(project.path, 'pullRequest')
        return c.json({ ok: true, url: result.url, task: await enrichTaskForServe(project.path, task) })
      }

      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      if (!reason) return c.json({ error: 'reason is required' }, 400)
      const override = closureAction === 'local-only' ? 'local_only' : 'deferred'
      if (databaseAuthority) {
        const promoted = writePromotedTaskDetailMutation(tasksPath, id, {
          projectId: project.id,
          projectRoot: project.path,
          mutate: current => {
            current.gitStory = {
              override,
              reason,
              recordedAt: now,
              recordedBy: 'user',
            }
            current.updatedAt = now
            return current
          },
        })
        if (!promoted) return c.json({ error: 'task not found' }, 404)
        await appendTaskEvidence(project.path, id, {
          id: `git-story-${id}-${now.replace(/[^0-9A-Za-z]/g, '')}`,
          kind: 'git_story',
          recordedAt: now,
          payload: { action: override, reason, recordedBy: 'user' },
        })
        return c.json({
          ok: true,
          task: await enrichTaskForServe(project.path, promoted.task),
        })
      }
      task.gitStory = {
        override,
        reason,
        recordedAt: now,
        recordedBy: 'user',
      }
      task.updatedAt = now
      queue.lastUpdated = now
      writeProjectTaskQueueWithSummary(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
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
      if (!projectTaskStateExistsSync(tasksPath)) {
        return c.json({ error: 'no tasks file' }, 404)
      }
      const id = c.req.param('id')
      const currentTaskRead = await readProjectTaskCurrentStateAtBoundary(project.path, id)
      const pointTask = currentTaskRead.task ?? readProjectTaskRecordAtBoundary(tasksPath, id)
      if (!pointTask) return c.json({ error: 'task not found' }, 404)
      const task = currentTaskRead.task ?? await buildEffectiveTask(project.path, pointTask as Task, {
        evidence: 'current',
      }) as unknown as Record<string, unknown>

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

      // Group review verdicts by guild slug. Persona fan-out persists the
      // stable reviewer id, and older revision records may carry the
      // structured guild slug in `failingSignals`. Human-readable `reason`
      // text is deliberately never used for attribution: changing a model's
      // wording must not move a verdict between reviewer lanes.
      const verdicts = Array.isArray(task.reviewVerdicts)
        ? task.reviewVerdicts.filter(isRecord)
        : []
      const verdictsBySlug: Record<string, Array<Record<string, unknown>>> = {}
      for (const v of verdicts) {
        let slug: string | null = null
        const reviewerId = v.reviewerId
        if (typeof reviewerId === 'string' && applicableSlugs.has(reviewerId)) {
          slug = reviewerId
        }
        const failingSignals = v.failingSignals
        if (!slug && Array.isArray(failingSignals) && failingSignals.length > 0) {
          const candidate = failingSignals[0]
          if (typeof candidate === 'string' && applicableSlugs.has(candidate)) {
            slug = candidate
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
        ? task.gateResults.filter(isRecord)
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
  //   approve-spec       → ready  (owner approval; body: {approvalNote?, approvalActor?})
  //   approve-brief      → mark productBrief.approvedBy/approvedAt. The normal
  //                        UI path is human; an explicitly delegated Codex
  //                        owner action is recorded distinctly for audit.
  //   mark-done          → done   (human confirms the task is already complete; body: {evidence?})
  //   update-brief       → fill missing task-brief fields from human input
  //   add-acceptance     → append a human-written acceptance criterion
  //   set-acceptance-command → bind one exact executable proof command to a criterion
  //   set-acceptance-proof-expectation → record expected command exit/output for a criterion
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
        'set-acceptance-command',
        'set-acceptance-proof-expectation',
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
        const body = await c.req.json().catch(() => ({})) as {
          approvalNote?: string
          approvalActor?: unknown
        }
        const approvalActor = body.approvalActor === 'codex_delegated_owner'
          ? 'codex_delegated_owner'
          : 'human'
        const result = await approveSpec({
          memoryDir,
          taskId: id,
          ...(body.approvalNote ? { approvalNote: body.approvalNote } : {}),
          approvalActor,
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
          recoveryKind?: 'proof'
        }
        const result = await reframeTask({
          memoryDir,
          taskId: id,
          ...(body.reason ? { reason: body.reason } : {}),
          ...(body.recoveryKind === 'proof' ? { recoveryKind: 'proof' } : {}),
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
          recoveryReason?: string
          recoveryKind?: 'proof' | 'blueprint'
        }
        if (body.stage !== 'spec' && body.stage !== 'review' && body.stage !== 'gate') {
          return c.json({ error: 'Missing or invalid stage' }, 400)
        }
        const result = await rerunTaskStage({
          memoryDir,
          taskId: id,
          stage: body.stage,
          ...(body.recoveryReason?.trim() ? { recoveryReason: body.recoveryReason.trim() } : {}),
          ...(body.recoveryKind ? { recoveryKind: body.recoveryKind } : {}),
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
      if (!projectTaskStateExistsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
        const parsed = queueRead.queue as
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
        if (readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database') {
          const promoted = writePromotedTaskDetailMutation(tasksPath, id, {
            projectId: project.id,
            projectRoot: project.path,
            mutate: current => {
              current.dependsOn = dependsOn
              current.updatedAt = now
              return current
            },
          })
          if (!promoted) return c.json({ error: 'task not found' }, 404)
          await appendPromotedHumanTaskNote({
            taskId: id,
            action: 'update-dependencies',
            now,
            note: notes.at(-1) as Record<string, unknown>,
          })
          return c.json({ ok: true, taskId: id, dependsOn })
        }
        writeProjectTaskQueueWithSummary(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
        return c.json({ ok: true, taskId: id, dependsOn })
      }

      if (action === 'retry-work') {
        const body = await c.req.json().catch(() => ({})) as {
          instruction?: string
        }
        const tasksPath = projectTasksPath(project.path)
      if (!projectTaskStateExistsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        let queueRead = readProjectTaskQueueForMutationSync(tasksPath)
        let expectedQueueRevision = queueRead.expectedQueueRevision
        let parsed = queueRead.queue as
          | { tasks?: Array<Record<string, unknown>>; releases?: ProjectRelease[]; selectedReleaseId?: string; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        let queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed, releases: [] as ProjectRelease[] }
          : {
              version: parsed.version ?? 1,
              lastUpdated: parsed.lastUpdated ?? new Date().toISOString(),
              tasks: parsed.tasks ?? [],
              releases: parsed.releases ?? [],
              ...(parsed.selectedReleaseId ? { selectedReleaseId: parsed.selectedReleaseId } : {}),
            }
        let task = queue.tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
        if (!task) return c.json({ error: 'task not found' }, 404)
        // Recovery consumes the same saved release boundary as readiness and
        // closure. The mutation queue remains the write/CAS source, but it
        // must not be the place where a release proof contract is inferred.
        const releaseState = await readProjectReleaseState(project.path)
        const selectedRelease = releaseState.scope
          ? releaseState.rawQueue.releases.find(release => release.id === releaseState.scope?.id)
          : undefined
        const selectedScope = releaseState.scope
        // Scope rows are the shared release-membership authority. A task can
        // be included through an ancestor or other normalized scope rule, so
        // checking raw release nodeIds here would disagree with Overview,
        // Release, and Start readiness.
        const selectedTaskIsEligible = selectedScope
          ? releaseState.scopeRows.some(row => row.taskId === String(task?.id ?? '') && row.scope === 'included')
          : false
        const selectedProofStyle = selectedTaskIsEligible ? selectedRelease?.proofStyle : undefined
        const currentTaskRead = await readProjectTaskCurrentStateAtBoundary(project.path, id)
        const effectiveTask = (currentTaskRead.task ?? await buildEffectiveTask(project.path, task as Task, {
          evidence: 'current',
        })) as unknown as Task & {
          runtime?: { openEscalationIds?: string[] }
        }
        // Canonical task definitions intentionally omit bulky evidence. Use
        // the effective task for recovery decisions so a settled proof path
        // from SQLite cannot be mistaken for a missing proof on the compact
        // queue row.
        // A proof-setup task is itself the executable proof boundary. Its
        // recovery resumes that task; it must never materialize another proof
        // child beneath itself.
        const isProofSetupRecovery = isProofSetupTask(effectiveTask)
        const isProofRecovery = taskDoneButProofMissingForScope(effectiveTask, selectedProofStyle)
        const isReviewRecovery = taskDoneButReviewConflict(effectiveTask)
        const effectiveStatus = typeof effectiveTask.status === 'string' ? effectiveTask.status : String(task.status ?? '')
        if ((effectiveStatus === 'done' && !isProofRecovery && !isReviewRecovery) || effectiveStatus === 'shelved' || effectiveStatus === 'pending_pr') {
          return c.json({ error: `task is ${effectiveStatus}` }, 400)
        }
        const now = new Date().toISOString()
        const taskReleaseIds = Array.isArray(effectiveTask.releaseIds)
          ? effectiveTask.releaseIds.filter((releaseId): releaseId is string => typeof releaseId === 'string')
          : []
        const hasShippedReleaseMembership = taskReleaseIds.some(releaseId =>
          releaseState.rawQueue.releases.some(release => release.id === releaseId && release.state === 'shipped'),
        )
        // A proof-setup task is already the release-local proof boundary. It
        // must be reopened as work, never treated as a parent that needs a
        // second proof child.
        const canMaterializeReleaseLocalProof = !isProofSetupRecovery &&
          isProofRecovery &&
          selectedProofStyle === 'script_only' &&
          Boolean(selectedRelease?.id) &&
          selectedRelease?.state !== 'shipped'
        if (canMaterializeReleaseLocalProof) {
          const proofQueue = TaskQueue.parse(queue)
          const proofParent = proofQueue.tasks.find(candidate => candidate.id === id)
          if (!proofParent || !selectedRelease?.id) {
            return c.json({ error: 'Could not materialize release-local proof work from the current task boundary.' }, 409)
          }
          const proofSetup = materializeProofSetupTask(proofQueue, proofParent, now, {
            releaseIds: [selectedRelease.id],
            // Active-release proof is part of the parent task's current
            // completion boundary. A later release proving a shipped parent
            // stays detached so reopening follow-up work cannot mutate the
            // historical release.
            linkParent: !hasShippedReleaseMembership,
          })
          if (proofSetup.status === 'materialized') {
            await writeTaskQueueFilePreservingQueue(tasksPath, {
              tasks: proofQueue.tasks as unknown as Array<Record<string, unknown>>,
              releases: proofQueue.releases,
              ...(proofQueue.selectedReleaseId ? { selectedReleaseId: proofQueue.selectedReleaseId } : {}),
            }, project.path)
          }
          return c.json({
            ok: true,
            status: 'exploring',
            nextAction: 'source_backed_spec',
            proofSetupTaskId: proofSetup.childTaskId,
            reason: proofSetup.status === 'materialized'
              ? 'The shipped implementation stays closed; Guildhall created release-local proof work in the selected follow-up release.'
              : 'Release-local proof work already exists in the selected follow-up release.',
          })
        }
        const recoveredProofPaths = isProofRecovery && selectedProofStyle === 'script_only'
          ? ensureCommandProofPathsFromAcceptanceCriteria(effectiveTask, now)
          : undefined
        const hasExecutableRecoveredProof = recoveredProofPaths?.some(path => (
          path &&
          typeof path === 'object' &&
          !Array.isArray(path) &&
          typeof (path as { command?: unknown }).command === 'string' &&
          isConcreteProjectProofCommand(String((path as { command: string }).command))
        )) ?? false
        const proofPathsForRecovery = hasExecutableRecoveredProof ? recoveredProofPaths : undefined
        const instruction = body.instruction?.trim()
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
          queueRead = readProjectTaskQueueForMutationSync(tasksPath)
          expectedQueueRevision = queueRead.expectedQueueRevision
          parsed = queueRead.queue as
            | { tasks?: Array<Record<string, unknown>>; releases?: ProjectRelease[]; selectedReleaseId?: string; version?: number; lastUpdated?: string }
            | Array<Record<string, unknown>>
          queue = Array.isArray(parsed)
            ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed, releases: [] as ProjectRelease[] }
            : {
                version: parsed.version ?? 1,
                lastUpdated: parsed.lastUpdated ?? new Date().toISOString(),
                tasks: parsed.tasks ?? [],
                releases: parsed.releases ?? [],
                ...(parsed.selectedReleaseId ? { selectedReleaseId: parsed.selectedReleaseId } : {}),
              }
          task = queue.tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
          if (!task) return c.json({ error: 'task not found after escalation resolution' }, 404)
        }
        if (effectiveStatus === 'in_progress' && openEscalations.length === 0 && !hasUsableBlueprint(effectiveTask)) {
          const result = await rerunTaskStage({
            memoryDir,
            taskId: id,
            stage: 'spec',
            recoveryReason:
              instruction ||
              'The task was marked executable without a current implementation blueprint. Guildhall cleared the stale plan before any worker could run.',
            recoveryKind: 'blueprint',
          })
          if (!result.success) return c.json({ error: result.error ?? 'blueprint re-intake failed' }, 400)
          return c.json({
            ok: true,
            status: result.newStatus,
            nextAction: 'source_backed_spec',
            reason: 'Guildhall refused to resume work without a current implementation blueprint and reopened source-backed shaping.',
          })
        }
        // A historical review path is audit history, not executable proof for
        // the selected script-only release. It must never suppress recovery
        // merely because its prose says the task was approved.
        if (isProofRecovery && selectedProofStyle === 'script_only' && !hasExecutableRecoveredProof && !isProofSetupRecovery) {
          const result = await rerunTaskStage({
            memoryDir,
            taskId: id,
            stage: 'spec',
            recoveryReason: instruction || 'No current project-backed executable proof path is recorded for this release task.',
            recoveryKind: 'proof',
          })
          if (!result.success) return c.json({ error: result.error ?? 'proof re-intake failed' }, 400)
          return c.json({
            ok: true,
            status: result.newStatus,
            nextAction: 'source_backed_spec',
            reason: 'Guildhall could not recover a concrete project proof command from the saved task. The stale plan was cleared for source-backed shaping.',
          })
        }
        const notes = Array.isArray(task.notes) ? [...task.notes as Array<Record<string, unknown>>] : []
        notes.push({
          agentId: 'system:human',
          role: 'human',
          content: isProofRecovery
            ? instruction
              ? `Reopen completed task for missing release proof: ${instruction}`
              : 'Reopen completed task for missing release proof.'
            : isReviewRecovery
              ? instruction
                ? `Reopen completed task after reviewer feedback was lost to a provider fallback: ${instruction}`
                : 'Reopen completed task after reviewer feedback was lost to a provider fallback.'
            : instruction
              ? `Retry partial worker pass: ${instruction}`
              : 'Retry partial worker pass from the current saved worktree state.',
          timestamp: now,
        })
        task.notes = notes
        task.status = 'in_progress'
        // Proof-setup recovery already has a Guildhall-owned blueprint. Keep
        // it on the worker lane instead of clearing assignment and letting
        // the coordinator route it back through generic spec intake.
        task.assignedTo = isProofSetupRecovery ? 'worker-agent' : null
        if (proofPathsForRecovery) task.proofPaths = proofPathsForRecovery
        delete task.blockReason
        delete task.openEscalations
        task.updatedAt = now
        queue.lastUpdated = now
        if (shouldClearRuntimeEscalations || isProofRecovery || isReviewRecovery) {
          await upsertTaskRuntimeState(project.path, id, {
            assignedTo: isProofSetupRecovery ? 'worker-agent' : null,
            ...(shouldClearRuntimeEscalations ? { openEscalationIds: [] } : {}),
            ...(isProofRecovery
              ? {
                  proofRecovery: {
                    reopenedAt: now,
                    kind: 'proof',
                    reason: instruction || 'Missing release proof evidence.',
                  },
                }
              : {}),
            updatedAt: now,
          })
        }
        if (readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database') {
          const promoted = writePromotedTaskDetailMutation(tasksPath, id, {
            projectId: project.id,
            projectRoot: project.path,
            mutate: current => {
              current.status = task.status
              // Assignment is runtime-owned for promoted projects. The
              // recovery overlay above records the worker lane; copying it
              // into the task definition would make the point mutation fail
              // its evidence/runtime ownership guard.
              if (!isProofSetupRecovery) {
                if (typeof task.assignedTo === 'string' && task.assignedTo.trim().length > 0) {
                  current.assignedTo = task.assignedTo
                } else {
                  delete current.assignedTo
                }
              }
              if (proofPathsForRecovery) current.proofPaths = proofPathsForRecovery
              delete current.blockReason
              current.updatedAt = now
              return current
            },
          })
          if (!promoted) return c.json({ error: 'task not found' }, 404)
          await appendPromotedHumanTaskNote({
            taskId: id,
            action: 'retry-work',
            now,
            note: notes.at(-1) as Record<string, unknown>,
          })
        } else {
          writeProjectTaskQueueWithSummary(tasksPath, queue, { expectedQueueRevision })
        }
        if (instruction && !isProofRecovery) {
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
        const tasksPath = projectTasksPath(project.path)
        const result = await shapeImportDraft({
          memoryDir,
          taskId: id,
        })
        if (!result.success) return c.json({ error: result.error ?? 'shape failed' }, 400)
        invalidateTaskQueueReadCaches(tasksPath)
        return c.json({ ok: true, status: result.newStatus })
      }

      if (action === 'create-split-children') {
        const tasksPath = projectTasksPath(project.path)
      if (!projectTaskStateExistsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
        const queue = TaskQueue.parse(queueRead.queue)
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
        await writeProjectTaskQueueAtCurrentStateBoundary(tasksPath, queue, {
          projectRoot: project.path,
          expectedQueueRevision: queueRead.expectedQueueRevision,
        })
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
        const body = await c.req.json().catch(() => ({})) as {
          approvalActor?: unknown
        }
        const approvalActor = body.approvalActor === 'codex_delegated_owner'
          ? 'codex_delegated_owner'
          : 'human'
        const tasksPath = projectTasksPath(project.path)
      if (!projectTaskStateExistsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const databaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
        const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
        const parsed = queueRead.queue as
          | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        const queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
          : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
        // A promoted project owns task identity in SQLite point records. The
        // aggregate mutation snapshot is still needed for legacy writes, but
        // it must not make an existing canonical task look absent.
        const pointTask = databaseAuthority ? readProjectTaskRecordAtBoundary(tasksPath, id) : null
        const task = pointTask ?? queue.tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
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
        brief.approvedBy = approvalActor
        brief.approvedAt = now
        task.productBrief = brief
        const delegatedApprovalNote = approvalActor === 'codex_delegated_owner'
          ? {
              agentId: 'codex:delegated-owner',
              role: 'approver',
              content: 'Approved by Codex under the owner delegation recorded for this run. Guildhall did not approve this brief autonomously.',
              timestamp: now,
            }
          : null
        if (delegatedApprovalNote && !databaseAuthority) {
          task.notes = [...(Array.isArray(task.notes) ? task.notes : []), delegatedApprovalNote]
        }
        const effectiveTask = await buildEffectiveTask(project.path, task as Task)
        if (Array.isArray(effectiveTask.escalations)) {
          task.escalations = [...effectiveTask.escalations] as typeof task.escalations
        }
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
        if (databaseAuthority) {
          const promoted = writePromotedTaskDetailMutation(tasksPath, id, {
            projectId: project.id,
            projectRoot: project.path,
            mutate: current => {
              current.productBrief = task.productBrief
              if (typeof task.spec === 'string') current.spec = task.spec
              else delete current.spec
              if (Array.isArray(task.acceptanceCriteria)) current.acceptanceCriteria = task.acceptanceCriteria
              if (typeof task.status === 'string') current.status = task.status
              current.updatedAt = now
              return current
            },
          })
          if (!promoted) {
            return c.json({
              error: 'Guildhall could not persist the approved brief through the canonical task-state boundary.',
              code: 'task_state_mutation_rejected',
            }, 409)
          }
          if (resolvedEscalationIds.length > 0 || hadRuntimeOpenEscalationIds) {
            await upsertTaskRuntimeState(project.path, id, {
              assignedTo: null,
              openEscalationIds: [],
              updatedAt: now,
            })
          }
          if (delegatedApprovalNote) {
            await appendPromotedHumanTaskNote({
              taskId: id,
              action: 'approve-brief',
              now,
              note: delegatedApprovalNote,
            })
          }
          for (const escalation of Array.isArray(task.escalations) ? task.escalations : []) {
            if (!escalation || typeof escalation !== 'object') continue
            const record = escalation as Record<string, unknown>
            if (!resolvedEscalationIds.includes(String(record.id ?? ''))) continue
            await appendTaskEvidence(project.path, id, {
              id: `${String(record.id)}-${now.replace(/[^0-9A-Za-z]/g, '')}`,
              kind: 'escalation',
              recordedAt: typeof record.raisedAt === 'string' ? record.raisedAt : now,
              payload: record,
            })
          }
          return c.json({ ok: true, status: task.status })
        }
        writeProjectTaskQueueWithSummary(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
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
      if (!projectTaskStateExistsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const databaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
        const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
        const parsed = queueRead.queue as
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
        const newlyResolvedEscalations: Array<Record<string, unknown>> = []
        if (Array.isArray(task.escalations)) {
          task.escalations = (task.escalations as Array<Record<string, unknown>>).map(escalation => (
            escalation.resolvedAt
              ? escalation
              : (() => {
                  const resolved = {
                    ...escalation,
                    resolvedAt: now,
                    resolvedBy: 'human',
                    resolution: evidence || 'Human confirmed this task is complete.',
                  }
                  newlyResolvedEscalations.push(resolved)
                  return resolved
                })()
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
        if (databaseAuthority) {
          const promoted = writePromotedTaskDetailMutation(tasksPath, id, {
            projectId: project.id,
            projectRoot: project.path,
            mutate: current => {
              current.acceptanceCriteria = task.acceptanceCriteria
              current.status = 'done'
              delete current.blockReason
              current.updatedAt = now
              return current
            },
          })
          if (!promoted) return c.json({ error: 'task not found' }, 404)
          await appendPromotedHumanTaskNote({
            taskId: id,
            action: 'mark-done',
            now,
            note: notes.at(-1) as Record<string, unknown>,
          })
          await appendTaskEvidence(project.path, id, {
            id: `${id}-completion-summary-${now.replace(/[^0-9A-Za-z]/g, '')}`,
            kind: 'completion_summary',
            recordedAt: now,
            payload: task.doneSummaryBundle as Record<string, unknown>,
          })
          for (const escalation of newlyResolvedEscalations) {
            const escalationId = typeof escalation.id === 'string' ? escalation.id : `resolved-${id}`
            await appendTaskEvidence(project.path, id, {
              id: `${escalationId}-${now.replace(/[^0-9A-Za-z]/g, '')}`,
              kind: 'escalation',
              recordedAt: now,
              payload: escalation,
            })
          }
          return c.json({ ok: true, status: 'done' })
        }
        writeProjectTaskQueueWithSummary(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
        return c.json({ ok: true, status: 'done' })
      }

      if (action === 'add-acceptance') {
        const body = await c.req.json().catch(() => ({})) as { description?: string }
        const description = (body.description ?? '').trim()
        if (!description) return c.json({ error: 'description required' }, 400)
        const tasksPath = projectTasksPath(project.path)
      if (!projectTaskStateExistsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const databaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
        const now = new Date().toISOString()
        const promoted = writePromotedTaskDetailMutation(tasksPath, id, {
          projectId: project.id,
          projectRoot: project.path,
          mutate: task => {
            const criteria = Array.isArray(task.acceptanceCriteria)
              ? [...task.acceptanceCriteria as Array<Record<string, unknown>>]
              : []
            criteria.push({
              id: `ac-${criteria.length + 1}`,
              description,
              verifiedBy: 'review',
              source: 'documented',
              met: false,
            })
            task.acceptanceCriteria = criteria
            task.updatedAt = now
            return task
          },
        })
        if (promoted) {
          const criteria = Array.isArray(promoted.task.acceptanceCriteria) ? promoted.task.acceptanceCriteria : []
          return c.json({ ok: true, count: criteria.length })
        }
        if (databaseAuthority) return c.json({ error: 'task not found' }, 404)
        const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
        const parsed = queueRead.queue as
          | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        const queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
          : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
        const task = queue.tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
        if (!task) return c.json({ error: 'task not found' }, 404)
        const criteria = Array.isArray(task.acceptanceCriteria)
          ? [...task.acceptanceCriteria as Array<Record<string, unknown>>]
          : []
        criteria.push({
          id: `ac-${criteria.length + 1}`,
          description,
          verifiedBy: 'review',
          source: 'documented',
          met: false,
        })
        task.acceptanceCriteria = criteria
        task.updatedAt = now
        queue.lastUpdated = now
        writeProjectTaskQueueWithSummary(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
        return c.json({ ok: true, count: criteria.length })
      }

      if (action === 'set-acceptance-command') {
        const body = await c.req.json().catch(() => ({})) as {
          criterionId?: string
          command?: string
        }
        const criterionId = typeof body.criterionId === 'string' ? body.criterionId.trim() : ''
        const command = typeof body.command === 'string' ? body.command.trim() : ''
        if (!criterionId) return c.json({ error: 'criterionId required' }, 400)
        if (!command) return c.json({ error: 'command required' }, 400)
        if (/\r|\n/.test(command)) return c.json({ error: 'command must be a single line' }, 400)

        const tasksPath = projectTasksPath(project.path)
        if (!projectTaskStateExistsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const databaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
        const releaseState = await readProjectReleaseState(project.path)
        const selectedRelease = releaseState.scope
          ? releaseState.rawQueue.releases.find(release => release.id === releaseState.scope?.id)
          : undefined
        const materializesSelectedScriptProof =
          selectedRelease?.proofStyle === 'script_only' &&
          releaseState.scope?.nodeIds.includes(taskScopeNodeId(id)) === true
        const now = new Date().toISOString()
        let criterionFound = false
        let changed = false
        let previousCommand: string | undefined
        const promoted = writePromotedTaskDetailMutation(tasksPath, id, {
          projectId: project.id,
          projectRoot: project.path,
          mutate: task => {
            const criteria = Array.isArray(task.acceptanceCriteria)
              ? [...task.acceptanceCriteria as Array<Record<string, unknown>>]
              : []
            const criterion = criteria.find(item => item.id === criterionId)
            if (!criterion) return task
            criterionFound = true
            previousCommand = typeof criterion.command === 'string' ? criterion.command : undefined
            const alreadyBound = previousCommand === command && criterion.verifiedBy === 'automated'
            if (!alreadyBound) {
              criterion.command = command
              criterion.verifiedBy = 'automated'
              criterion.source = 'documented'
              criterion.met = false
              delete criterion.persistedMet
              delete criterion.verificationState
              delete criterion.verificationSource
              delete criterion.staleReason
              delete criterion.staleGateId
              task.acceptanceCriteria = criteria
              task.updatedAt = now
              changed = true
              const commandProofPathId = `${id}-${criterionId}-command-proof`
              if (Array.isArray(task.proofPaths)) {
                task.proofPaths = task.proofPaths.filter(path =>
                  !path || typeof path !== 'object' || (path as Record<string, unknown>).id !== commandProofPathId,
                )
              }
            }
            if (materializesSelectedScriptProof) {
              const proofPaths = ensureCommandProofPathsFromAcceptanceCriteria(task as unknown as Task, now)
              if (proofPaths.length !== (Array.isArray(task.proofPaths) ? task.proofPaths.length : 0)) {
                task.proofPaths = proofPaths
                changed = true
              }
            }
            return task
          },
        })
        if (promoted) {
          if (!criterionFound) return c.json({ error: `acceptance criterion not found: ${criterionId}` }, 404)
          if (changed) {
            await appendPromotedHumanTaskNote({
              taskId: id,
              action: 'set-acceptance-command',
              now,
              note: {
                agentId: 'system:human',
                role: 'human',
                content: `Bound executable proof command to acceptance criterion ${criterionId}. Existing completion evidence must be re-run.`,
                timestamp: now,
                criterionId,
                command,
                ...(previousCommand ? { previousCommand } : {}),
              },
            })
          }
          return c.json({ ok: true, changed, criterionId, command })
        }
        if (databaseAuthority) return c.json({ error: 'task not found' }, 404)

        const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
        const parsed = queueRead.queue as
          | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        const queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
          : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? new Date().toISOString(), tasks: parsed.tasks ?? [] }
        const task = queue.tasks.find(t => (t as { id?: string }).id === id) as Record<string, unknown> | undefined
        if (!task) return c.json({ error: 'task not found' }, 404)
        const criteria = Array.isArray(task.acceptanceCriteria)
          ? [...task.acceptanceCriteria as Array<Record<string, unknown>>]
          : []
        const criterion = criteria.find(item => item.id === criterionId)
        if (!criterion) return c.json({ error: `acceptance criterion not found: ${criterionId}` }, 404)
        previousCommand = typeof criterion.command === 'string' ? criterion.command : undefined
        changed = previousCommand !== command || criterion.verifiedBy !== 'automated'
        if (changed) {
          criterion.command = command
          criterion.verifiedBy = 'automated'
          criterion.source = 'documented'
          criterion.met = false
          delete criterion.persistedMet
          delete criterion.verificationState
          delete criterion.verificationSource
          delete criterion.staleReason
          delete criterion.staleGateId
          task.acceptanceCriteria = criteria
          if (materializesSelectedScriptProof) {
            const commandProofPathId = `${id}-${criterionId}-command-proof`
            if (Array.isArray(task.proofPaths)) {
              task.proofPaths = task.proofPaths.filter(path =>
                !path || typeof path !== 'object' || (path as Record<string, unknown>).id !== commandProofPathId,
              )
            }
            task.proofPaths = ensureCommandProofPathsFromAcceptanceCriteria(task as unknown as Task, now)
          }
          task.updatedAt = now
          queue.lastUpdated = now
          const notes = Array.isArray(task.notes) ? [...task.notes as Array<Record<string, unknown>>] : []
          notes.push({
            agentId: 'system:human',
            role: 'human',
            content: `Bound executable proof command to acceptance criterion ${criterionId}. Existing completion evidence must be re-run.`,
            timestamp: now,
            criterionId,
            command,
            ...(previousCommand ? { previousCommand } : {}),
          })
          task.notes = notes
          writeProjectTaskQueueWithSummary(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
        }
        return c.json({ ok: true, changed, criterionId, command })
      }

      if (action === 'set-acceptance-proof-expectation') {
        const body = await c.req.json().catch(() => ({})) as {
          criterionId?: string
          expectedExit?: string
          expectedOutputIncludes?: unknown
        }
        const criterionId = typeof body.criterionId === 'string' ? body.criterionId.trim() : ''
        const expectedExit = body.expectedExit === 'zero' || body.expectedExit === 'non_zero'
          ? body.expectedExit
          : ''
        const expectedOutputIncludes = Array.isArray(body.expectedOutputIncludes)
          ? body.expectedOutputIncludes
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .map(value => value.trim())
          : undefined
        if (!criterionId) return c.json({ error: 'criterionId required' }, 400)
        if (!expectedExit) return c.json({ error: 'expectedExit must be zero or non_zero' }, 400)

        const tasksPath = projectTasksPath(project.path)
        if (!projectTaskStateExistsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const databaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
        const now = new Date().toISOString()
        let criterionFound = false
        let changed = false
        let command = ''
        const applyExpectation = (task: Record<string, unknown>): Record<string, unknown> => {
          const criteria = Array.isArray(task.acceptanceCriteria)
            ? [...task.acceptanceCriteria as Array<Record<string, unknown>>]
            : []
          const criterion = criteria.find(item => item.id === criterionId)
          if (!criterion) return task
          criterionFound = true
          command = typeof criterion.command === 'string' ? criterion.command.trim() : ''
          if (!command) return task
          const previousOutput = Array.isArray(criterion.expectedOutputIncludes)
            ? criterion.expectedOutputIncludes
            : undefined
          changed = criterion.expectedExit !== expectedExit ||
            JSON.stringify(previousOutput) !== JSON.stringify(expectedOutputIncludes)
          if (changed) {
            criterion.expectedExit = expectedExit
            if (expectedOutputIncludes && expectedOutputIncludes.length > 0) {
              criterion.expectedOutputIncludes = expectedOutputIncludes
            } else {
              delete criterion.expectedOutputIncludes
            }
            criterion.met = false
            delete criterion.persistedMet
            delete criterion.verificationState
            delete criterion.verificationSource
            delete criterion.staleReason
            delete criterion.staleGateId
          }
          task.acceptanceCriteria = criteria
          const proofPaths = ensureCommandProofPathsFromAcceptanceCriteria(task as unknown as Task, now)
          const matchingProofPath = proofPaths.find((path) =>
            comparableCommand(path.command) === comparableCommand(command),
          )
          if (matchingProofPath && matchingProofPath.status !== 'verified') {
            matchingProofPath.status = 'planned'
            matchingProofPath.verificationRecords = []
            matchingProofPath.updatedAt = now
            matchingProofPath.updatedBy = 'acceptance-contract-reset'
            changed = true
          }
          task.proofPaths = proofPaths
          if (changed) delete task.acceptanceCriteriaProofState
          if (changed) task.updatedAt = now
          return task
        }

        const promoted = writePromotedTaskDetailMutation(tasksPath, id, {
          projectId: project.id,
          projectRoot: project.path,
          mutate: applyExpectation,
        })
        if (promoted) {
          if (!criterionFound) return c.json({ error: `acceptance criterion not found: ${criterionId}` }, 404)
          if (!command) return c.json({ error: `acceptance criterion ${criterionId} has no executable command` }, 400)
          if (changed) {
            await appendPromotedHumanTaskNote({
              taskId: id,
              action: 'set-acceptance-proof-expectation',
              now,
              note: {
                agentId: 'system:human',
                role: 'human',
                content: `Recorded expected ${expectedExit} exit for acceptance criterion ${criterionId}. Existing proof must be re-run against the updated contract.`,
                timestamp: now,
                criterionId,
                command,
                expectedExit,
                ...(expectedOutputIncludes?.length ? { expectedOutputIncludes } : {}),
              },
            })
          }
          return c.json({ ok: true, changed, criterionId, command, expectedExit, ...(expectedOutputIncludes?.length ? { expectedOutputIncludes } : {}) })
        }
        if (databaseAuthority) return c.json({ error: 'task not found' }, 404)

        const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
        const parsed = queueRead.queue as
          | { tasks?: Array<Record<string, unknown>>; version?: number; lastUpdated?: string }
          | Array<Record<string, unknown>>
        const queue = Array.isArray(parsed)
          ? { version: 1, lastUpdated: now, tasks: parsed }
          : { version: parsed.version ?? 1, lastUpdated: parsed.lastUpdated ?? now, tasks: parsed.tasks ?? [] }
        const task = queue.tasks.find(candidate => candidate.id === id)
        if (!task) return c.json({ error: 'task not found' }, 404)
        applyExpectation(task)
        if (!criterionFound) return c.json({ error: `acceptance criterion not found: ${criterionId}` }, 404)
        if (!command) return c.json({ error: `acceptance criterion ${criterionId} has no executable command` }, 400)
        if (changed) {
          task.notes = [
            ...(Array.isArray(task.notes) ? task.notes : []),
            {
              agentId: 'system:human',
              role: 'human',
              content: `Recorded expected ${expectedExit} exit for acceptance criterion ${criterionId}. Existing proof must be re-run against the updated contract.`,
              timestamp: now,
              criterionId,
              command,
              expectedExit,
              ...(expectedOutputIncludes?.length ? { expectedOutputIncludes } : {}),
            },
          ]
          queue.lastUpdated = now
          writeProjectTaskQueueWithSummary(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
        }
        return c.json({ ok: true, changed, criterionId, command, expectedExit, ...(expectedOutputIncludes?.length ? { expectedOutputIncludes } : {}) })
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
      if (!projectTaskStateExistsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const databaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
        {
          const now = new Date().toISOString()
          const noteParts = [
            successTarget ? `Success target: ${successTarget}` : '',
            acceptanceCriterion ? `Acceptance criterion: ${acceptanceCriterion}` : '',
          ].filter(Boolean)
          const promoted = writePromotedTaskDetailMutation(tasksPath, id, {
            projectId: project.id,
            projectRoot: project.path,
            mutate: task => {
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
              task.updatedAt = now
              return task
            },
          })
          if (promoted) {
            await appendPromotedHumanTaskNote({
              taskId: id,
              action: 'update-brief',
              now,
              note: {
                agentId: 'human',
                role: 'specifier',
                content: `Updated task brief. ${noteParts.join(' ')}`.trim(),
                timestamp: now,
              },
            })
            return c.json({ ok: true })
          }
        }
        if (databaseAuthority) return c.json({ error: 'task not found' }, 404)
        const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
        const parsed = queueRead.queue as
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
        writeProjectTaskQueueWithSummary(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
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
      if (!projectTaskStateExistsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const databaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
        let promotedQuestionMissing = false
        {
          const now = new Date().toISOString()
          const answer = body.answer.trim()
          let answeredQuestionId: string | undefined
          const promoted = writePromotedTaskDetailMutation(tasksPath, id, {
            projectId: project.id,
            projectRoot: project.path,
            mutate: task => {
              const questions = (task.openQuestions as Array<Record<string, unknown>> | undefined) ?? []
              const q = questions.find(x => (x as { id?: string }).id === body.questionId)
              if (!q) {
                promotedQuestionMissing = true
                return null
              }
              delete q.draftAnswer
              q.answeredAt = now
              q.answer = answer
              task.openQuestions = questions
              task.updatedAt = now
              answeredQuestionId = body.questionId
              return task
            },
          })
          if (promoted && answeredQuestionId) {
            await resumeExploring({
              memoryDir,
              taskId: id,
              message: `Answer to "${answeredQuestionId}": ${answer}`,
            })
            await submitLinkedTaskOwnerInput({
              taskId: id,
              questionId: answeredQuestionId,
              answer,
            })
            return c.json({ ok: true })
          }
        }
        if (databaseAuthority) {
          return c.json({ error: promotedQuestionMissing ? 'question not found' : 'task not found' }, 404)
        }
        const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
        const parsed = queueRead.queue as
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
        writeProjectTaskQueueWithSummary(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
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
      if (!projectTaskStateExistsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const databaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
        let promotedQuestionMissing = false
        {
          const now = new Date().toISOString()
          const nextDraft = (body.answer ?? '').trim()
          const promoted = writePromotedTaskDetailMutation(tasksPath, id, {
            projectId: project.id,
            projectRoot: project.path,
            mutate: task => {
              const questions = (task.openQuestions as Array<Record<string, unknown>> | undefined) ?? []
              const q = questions.find(x => (x as { id?: string }).id === body.questionId)
              if (!q) {
                promotedQuestionMissing = true
                return null
              }
              if (nextDraft) q.draftAnswer = nextDraft
              else delete q.draftAnswer
              task.openQuestions = questions
              task.updatedAt = now
              return task
            },
          })
          if (promoted) return c.json({ ok: true, staged: Boolean(nextDraft) })
        }
        if (databaseAuthority) {
          return c.json({ error: promotedQuestionMissing ? 'question not found' : 'task not found' }, 404)
        }
        const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
        const parsed = queueRead.queue as
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
        writeProjectTaskQueueWithSummary(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
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
      if (!projectTaskStateExistsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
        const databaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
        const promotedState: { missing?: string[] } = {}
        {
          const now = new Date().toISOString()
          const answerByQuestionId = new Map(
            list.map(answer => [answer.questionId!, answer.answer!.trim()]),
          )
          const transcriptLines: string[] = []
          const ownerInputResponses: Array<{ questionId: string; answer: string }> = []
          const promoted = writePromotedTaskDetailMutation(tasksPath, id, {
            projectId: project.id,
            projectRoot: project.path,
            mutate: task => {
              const questions = (task.openQuestions as Array<Record<string, unknown>> | undefined) ?? []
              const matched = list.map(answer => ({
                questionId: answer.questionId!,
                answer: answerByQuestionId.get(answer.questionId!)!,
                question: questions.find(question => (question as { id?: string }).id === answer.questionId),
              }))
              const missing = matched.filter(answer => !answer.question).map(answer => answer.questionId)
              if (missing.length > 0) {
                promotedState.missing = missing
                return null
              }
              for (const response of matched) {
                const question = response.question!
                delete question.draftAnswer
                question.answeredAt = now
                question.answer = response.answer
                transcriptLines.push(`Answer to "${response.questionId}": ${response.answer}`)
                ownerInputResponses.push({ questionId: response.questionId, answer: response.answer })
              }
              task.openQuestions = questions
              task.updatedAt = now
              return task
            },
          })
          if (promoted) {
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
        }
        if (databaseAuthority) {
          return promotedState.missing
            ? c.json({ error: `question(s) not found: ${promotedState.missing.join(', ')}` }, 404)
            : c.json({ error: 'task not found' }, 404)
        }
        const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
        const parsed = queueRead.queue as
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
        writeProjectTaskQueueWithSummary(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
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
      if (!projectTaskStateExistsSync(tasksPath)) return c.json({ error: 'no tasks file' }, 404)
      const databaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
      const holdBody = action === 'hold' || action === 'pause'
        ? await c.req.json().catch(() => ({})) as { reason?: string }
        : null
      const holdReason = (holdBody?.reason ?? '').trim()
      const promotedState: { error?: { message: string; status: 400 | 409 }; noop?: boolean } = {}
      {
        const now = new Date().toISOString()
        let promotedNote: Record<string, unknown> | undefined
        const promoted = writePromotedTaskDetailMutation(tasksPath, id, {
          projectId: project.id,
          projectRoot: project.path,
          mutate: task => {
            if (action === 'hold' || action === 'pause') {
              const run = supervisor.get(project.id)
              if (run && (run.status === 'running' || run.status === 'stopping')) {
                promotedState.error = { message: 'Stop Guildhall before putting a task on hold.', status: 409 }
                return null
              }
              if (task.status === 'done' || task.status === 'shelved' || task.status === 'pending_pr') {
                promotedState.error = { message: `task is ${task.status}`, status: 400 }
                return null
              }
              if (task.status === 'blocked' && task.hold) {
                promotedState.noop = true
                return null
              }
              task.hold = {
                previousStatus: task.status,
                ...(holdReason ? { reason: holdReason } : {}),
                heldAt: now,
                heldBy: 'human',
              }
              task.status = 'blocked'
              task.blockReason = holdReason ? `On hold: ${holdReason}` : 'On hold by human.'
              promotedNote = {
                agentId: 'system:human',
                role: 'human',
                content: holdReason ? `Task put on hold: ${holdReason}` : 'Task put on hold.',
                timestamp: now,
              }
            } else if (action === 'resume-hold') {
              const hold = task.hold as { previousStatus?: string } | undefined
              if (task.status !== 'blocked' || !hold) {
                promotedState.error = { message: 'task is not on hold', status: 400 }
                return null
              }
              task.status = hold.previousStatus ?? 'ready'
              delete task.hold
              delete task.blockReason
              promotedNote = {
                agentId: 'system:human',
                role: 'human',
                content: 'Task returned from hold.',
                timestamp: now,
              }
            } else if (action === 'unshelve') {
              if (task.status !== 'shelved') {
                promotedState.error = { message: `task is ${task.status}, not shelved`, status: 400 }
                return null
              }
              task.status = 'proposed'
              promotedNote = {
                agentId: 'system:human',
                role: 'human',
                content: 'Task unshelved via dashboard',
                timestamp: now,
              }
            } else {
              if (task.status === 'done') {
                promotedState.error = { message: 'task is done', status: 400 }
                return null
              }
              task.status = 'shelved'
              promotedNote = {
                agentId: 'system:human',
                role: 'human',
                content: 'Task shelved via dashboard',
                timestamp: now,
              }
            }
            task.updatedAt = now
            return task
          },
        })
        if (promotedState.noop) return c.json({ ok: true, status: 'blocked' })
        if (promotedState.error) return c.json({ error: promotedState.error.message }, promotedState.error.status)
        if (promoted && promotedNote) {
          if (action === 'shelve') {
            await upsertTaskRuntimeState(project.path, id, {
              shelveReason: {
                code: 'not_viable',
                detail: 'Shelved by human from dashboard',
                rejectedBy: 'system:human',
                rejectedAt: now,
                source: 'proposal_policy',
                policyApplied: true,
                requeueCount: 0,
              },
              updatedAt: now,
            })
          } else if (action === 'unshelve') {
            await clearPromotedTaskShelveReason(id, now)
          }
          await appendPromotedHumanTaskNote({
            taskId: id,
            action,
            now,
            note: promotedNote,
          })
          return c.json({ ok: true, status: promoted.task.status })
        }
      }
      if (databaseAuthority) return c.json({ error: 'task not found' }, 404)
      const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
      const parsed = queueRead.queue as
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
        const reason = holdReason
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
      writeProjectTaskQueueWithSummary(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
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
      const empty = {
        running: run?.status === 'running',
        runStatus: run?.status ?? 'stopped',
        counts: {},
        inFlight: [] as unknown[],
      }
      // Activity is polled from every project surface. Read only the shell
      // summary here: the full orientation tree belongs to Map/Structure,
      // never to a status chip.
      const shell = readProjectSummaryShellAtBoundary(project.path)
      if (shell.queueRevision === null) return c.json(empty)
      const projection = shell.summary
      // This route is polled from every project surface. It must stay a read:
      // stopped-run repair belongs to an explicit write/maintenance boundary,
      // never to a status chip request.
      const projectionIsCurrent = projection?.freshness === 'current'
      const counts: Record<string, number> = projection
        ? { ...(projection?.counts.byStatus ?? {}) }
        : {}
      const inFlight: Array<{
        id: string
        title: string
        status: string
        domain: string
        lastActivityAt?: string
      }> = []
      for (const task of projection?.inFlight ?? []) {
        const lastActivityAt = task.updatedAt
        inFlight.push({
          id: task.taskId,
          title: task.title,
          status: task.status,
          domain: task.domain,
          ...(lastActivityAt ? { lastActivityAt } : {}),
        })
      }
      const compactSummary = projectionIsCurrent
        ? summarizeProjectFromProjection({ id: project.id, path: project.path }, project, run, projection)
        : null
      const projectedInFlight = inFlight
      const actionModel = compactSummary?.actionModel ?? null
      const topAction = actionModel?.primaryAction ?? null
      return c.json({
        running: run?.status === 'running',
        runStatus: run?.status ?? 'stopped',
        summaryFreshness: projection?.freshness ?? 'missing',
        releaseSummary: projection?.releaseSummary ?? null,
        counts,
        inFlight: projectedInFlight.slice(0, 5),
        actionModel,
        topAction,
        current: topAction,
        summary: topAction
          ? {
              label: topAction.label,
              message: topAction.detail ?? topAction.label,
              actionHref: topAction.href,
              actionLabel: topAction.buttonLabel,
              tone: topAction.tone,
              source: topAction.source,
              ...(topAction.taskId ? { taskId: topAction.taskId } : {}),
            }
          : null,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  // Durable activity is an explicit bounded read. The project projection and
  // live SSE stream stay small; Timeline asks for retained history only when
  // the user opens it.
  app.get('/api/project/activity/history', c => {
    const requestedLimit = Number.parseInt(c.req.query('limit') ?? '', 10)
    const requestedCursor = Number.parseInt(c.req.query('cursor') ?? '', 10)
    const page = readPersistedEventPage(project.path, project.id, {
      ...(Number.isFinite(requestedLimit) ? { limit: requestedLimit } : {}),
      ...(Number.isFinite(requestedCursor) ? { cursor: requestedCursor } : {}),
    })
    return c.json({
      ...page,
      retention: {
        maxBytes: 512 * 1024,
        maxRecords: 1000,
      },
    })
  })

  app.get('/api/project/progress', async c => {
    try {
      if (project.initializationNeeded) return c.json({ progress: '' })
      const progressState = readProjectProgressStateAtBoundary(project.path)
      const authority = progressState?.authority ?? readProjectStateAuthorityAtBoundary(
        getProjectSystemStatePath(project.path, 'TASKS.json'),
      ).authority
      if (authority === 'database') {
        const projection = progressState?.summary
        if (!projection || projection.freshness !== 'current') {
          return c.json({
            progress: '',
            freshness: projection?.freshness ?? 'missing',
            requiresRefresh: true,
          })
        }
        if (!progressState || progressState.queueRevision === null) {
          return c.json({ progress: '', freshness: 'missing', requiresRefresh: true })
        }
        const taskIds = [...new Set([
          ...projection.recentWork.map(task => task.taskId),
          ...projection.inFlight.map(task => task.taskId),
        ])].slice(0, 32)
        return c.json({
          progress: renderCurrentProjectProgress(taskIds, progressState.currentEvidence),
          freshness: 'current',
          requiresRefresh: false,
          queueRevision: progressState.queueRevision,
          projectRevision: progressState.projectRevision,
        })
      }
      const progressPath = getProjectSystemStatePath(project.path, 'PROGRESS.md')
      const raw = readBoundedManagedTextTail(progressPath)
      if (raw === null) return c.json({ progress: '', freshness: 'missing', requiresRefresh: true })
      return c.json({ progress: renderLegacyProjectProgress(raw), freshness: 'current', requiresRefresh: false })
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

  function releaseReadinessSavedScope(state: ProjectReleaseReadModel): ProjectScope | null {
    // The boundary owns release membership. Keeping this accessor deliberately
    // boring prevents the route from becoming a second scope authority.
    return state.scope
  }

  function releaseReadinessDiagnosticScope(state: ProjectCanonicalCurrentState): ProjectScope | null {
    if (state.scopeRows.length === 0) return null
    const savedScope = state.summary?.scope
    const executionRows = executionScopeRows(state.scopeRows)
    return {
      id: savedScope?.id ?? 'current-work',
      label: savedScope?.label ?? 'Current task scope',
      kind: (savedScope?.kind ?? 'proposed_feature_set') as ProjectScope['kind'],
      source: (savedScope?.source ?? 'inferred') as ProjectScope['source'],
      nodeIds: executionRows
        .filter(row => row.scope === 'included' && row.countInProjectTotals !== false)
        .map(row => taskScopeNodeId(row.taskId)),
      deferredNodeIds: executionRows
        .filter(row => row.scope === 'deferred' && row.countInProjectTotals !== false)
        .map(row => taskScopeNodeId(row.taskId)),
    }
  }

  function releaseReadinessSavedRelease(
    state: ProjectReleaseReadModel,
    scope: ProjectScope | null,
  ): OrientationRelease | null {
    // Release identity is a queue fact. The summary may project derived state,
    // but it must not select or rename a release during a read.
    const selectedReleaseId = state.rawQueue.selectedReleaseId
    if (!selectedReleaseId) return null
    const definition = state.rawQueue.releases.find(release => release.id === selectedReleaseId)
    if (!definition) return null
    // The queue definition owns release lifecycle state. Readiness is a
    // separate projection (`releaseReadiness.ready` / `verdict`) and must not
    // rewrite the release record during a request-time diagnostic read.
    return {
      ...definition,
      ...(scope ? {
        nodeIds: [...scope.nodeIds],
        deferredNodeIds: [...scope.deferredNodeIds],
      } : {}),
    } as OrientationRelease
  }

  async function buildProjectReleaseReadinessPayload(input: {
    state: ProjectReleaseReadModel
    startReadiness?: Awaited<ReturnType<typeof projectStartReadinessForProject>>
    liveDiagnostics?: boolean
    projectRoot?: string
  }): Promise<Record<string, unknown>> {
    const projectPath = input.projectRoot ?? project.path
    if (!input.projectRoot && project.initializationNeeded) return { initializationNeeded: true, release: null, scope: null }
    const memoryDir = getProjectStateDir(projectPath)
    const state = input.state
    const savedReleaseSummary = state.summary?.releaseSummary ?? null
    const summaryFreshness = state.summary?.freshness ?? 'missing'
    const savedScope = releaseReadinessSavedScope(state)
    const savedRelease = releaseReadinessSavedRelease(state, savedScope)
    const savedCounts = savedReleaseSummary?.counts ?? {
      total: 0,
      done: 0,
      unfinished: 0,
      ready: 0,
      active: 0,
      blocked: 0,
      deferred: 0,
      ownerBlocked: 0,
      proofBlocked: 0,
    }
    const savedBlockers = savedReleaseSummary?.blockers ?? []
    const savedDiagnosticBlockers = state.diagnostics?.readiness?.blockers ?? (
      state.diagnostics?.git?.blockers.map(blocker => ({
        id: `repository-followup:${blocker.id}`,
        title: `Repository follow-up: ${blocker.label}`,
        label: blocker.reason ?? blocker.label,
        ...(blocker.state ? { state: blocker.state } : {}),
        ...(blocker.nextAction ? { nextAction: blocker.nextAction } : {}),
        ...(blocker.repoId ? { repoId: blocker.repoId } : {}),
        ...(blocker.taskId ? { taskId: blocker.taskId } : {}),
      })) ?? []
    )
    const savedDiagnosticReleaseBlockers = [...savedBlockers, ...savedDiagnosticBlockers]
      .filter((blocker, index, all) => {
        const id = typeof blocker.id === 'string' ? blocker.id : `${blocker.label}:${index}`
        return all.findIndex(candidate => (typeof candidate.id === 'string' ? candidate.id : candidate.label) === id) === index
      })
    // The saved release summary is the authoritative current-state answer.
    // Diagnostic observations can explain more, but cannot change release
    // membership or make repository follow-up look like task work.
    const savedBlockingCount = savedCounts.blocked
    const savedReady = savedReleaseSummary?.state === 'ready' &&
      savedCounts.total > 0 &&
      savedBlockingCount === 0 &&
      savedCounts.unfinished === 0
    const savedStatusCounts = savedReleaseSummary && savedCounts.total > 0
      ? savedReleaseSummary.taskStatusCounts ?? {}
      : {}
    const savedTotals = {
      tasks: savedCounts.total,
      blockingCount: savedBlockingCount,
      humanBlockingCount: savedCounts.ownerBlocked,
      proofEvidenceBlockingCount: savedCounts.proofBlocked,
      unfinishedCount: savedCounts.unfinished,
      done: savedCounts.done,
    }
    const savedCompletion = buildReleaseCompletionSummary({
      ready: savedReady,
      totals: {
        tasks: savedCounts.total,
        done: savedCounts.done,
        unfinishedCount: savedCounts.unfinished,
        humanBlockingCount: savedCounts.ownerBlocked,
      },
      releaseBlockers: savedBlockers,
    })
    const savedVerdict = buildReleaseVerdictSummary({
      hasNamedRelease: Boolean(savedRelease?.label),
      ready: savedReady,
      ...(savedCounts.total === 0 ? { notReadyReason: 'No tasks in this scope yet.' } : {}),
      totals: {
        tasks: savedCounts.total,
        done: savedCounts.done,
        blockingCount: savedBlockingCount,
        humanBlockingCount: savedCounts.ownerBlocked,
        proofEvidenceBlockingCount: savedCounts.proofBlocked,
        unfinishedCount: savedCounts.unfinished,
        designSystemBlockingCount: 0,
        dirtyCheckoutBlockingCount: 0,
      },
      designSystem: {},
      dirtyCheckout: { ownedCount: 0 },
    })

    // Ordinary detail reads consume the saved diagnostic projection. A live
    // inspection is an explicit action (or an asynchronous projector job),
    // never an implicit second current-state authority inside a GET.
    if (input.liveDiagnostics !== true) {
      const diagnostic = state.diagnostics
      const git = diagnostic?.git
      const diagnosticBlockers = git?.blockers ?? []
      // An optional release is not the same thing as an empty project. When
      // no named release is selected, current-work still has a saved status
      // partition and Release detail must expose it instead of returning
      // totals alongside an empty bucket map.
      const statusCounts = savedReleaseSummary ? savedStatusCounts : {}
      const diagnosticTotals = {
        tasks: savedCounts.total,
        // `blockingCount` is the current release-work count, so it must
        // agree with the saved summary and the compact readiness endpoint.
        // Repository observations remain visible beside it in their own
        // `gitStoryBlockingCount`; they are not silently added to the work
        // count and turned into a second release scope.
        blockingCount: savedBlockingCount,
        humanBlockingCount: savedCounts.ownerBlocked,
        proofEvidenceBlockingCount: savedCounts.proofBlocked,
        unfinishedCount: savedCounts.unfinished,
        gitStoryBlockingCount: git?.blockerCount ?? 0,
        done: savedCounts.done,
      }
      const stateConsistency = diagnostic && diagnostic.sourceRevision === state.projectRevision ? 'aligned' : 'stale'
      return {
        checksLoaded: Boolean(diagnostic),
        release: savedRelease,
        scope: savedScope,
        ready: savedReady,
        summaryFreshness,
        diagnosticFreshness: diagnostic?.freshness ?? 'missing',
        diagnosticSourceRevision: diagnostic?.sourceRevision ?? null,
        diagnosticGeneratedAt: diagnostic?.generatedAt ?? null,
        currentStateAuthority: state.authority,
        queueRevision: state.queueRevision,
        projectRevision: state.projectRevision,
        stateConsistency,
        ...(summaryFreshness !== 'current' && savedReleaseSummary
          ? { notReadyReason: 'The saved project summary is refreshing.' }
          : savedCounts.total === 0 ? { notReadyReason: 'No tasks in this scope yet.' } : {}),
        completion: savedCompletion,
        verdict: savedVerdict,
        nextAction: state.summary?.nextAction ?? {
          label: 'Review project state',
          message: 'Review the saved project summary.',
        },
        statusCounts,
        releaseBlockers: savedBlockers,
        totals: savedTotals,
        diagnostics: {
          freshness: diagnostic?.freshness ?? 'missing',
          generatedAt: diagnostic?.generatedAt ?? null,
          sourceRevision: diagnostic?.sourceRevision ?? null,
          currentStateAuthority: state.authority,
          stateConsistency,
          ready: diagnostic?.readiness?.ready ?? savedReady,
          statusCounts,
          proofStyle: savedRelease?.proofStyle ?? 'unspecified',
          gitStory: git
            ? { ready: git.ready, state: git.state, blockers: diagnosticBlockers, snapshots: [] }
            : null,
          dirtyCheckout: { ownedCount: 0, files: [], freshness: 'not_projected' },
          totals: diagnosticTotals,
          releaseBlockers: savedDiagnosticReleaseBlockers,
          message: diagnostic
            ? 'Showing the latest saved repository and readiness observation.'
            : 'Repository and readiness observation is not available yet; refresh is queued.',
        },
      }
    }

    // An explicit live query is an inspection of the same current state, not
    // a second diagnostic universe. Keep release identity and membership on
    // the saved boundary, but return the live readiness answer consistently
    // at the top level and under `diagnostics`. Otherwise one response can
    // claim both "ready" and "proof is missing", depending on which field a
    // consumer happens to read.
    const diagnosticCurrentState = input.liveDiagnostics ? await readProjectCanonicalCurrentState(projectPath) : null
    const tasks = diagnosticCurrentState?.tasks ?? []
    const diagnosticScope = savedScope ?? (diagnosticCurrentState ? releaseReadinessDiagnosticScope(diagnosticCurrentState) : null)
    const releaseTruth = diagnosticScope
      ? summarizeScopedReleaseWork(tasks, diagnosticScope, {
          proofStyle: savedRelease?.proofStyle,
          commandProofRequired: savedRelease?.proofStyle === 'script_only',
          scopeRows: diagnosticCurrentState?.scopeRows ?? [],
        })
      : {
          statusCounts: {},
          openEscalations: [],
          incompleteBriefs: [],
          unapprovedBriefs: [],
          unapprovedSpecs: [],
          shelvedUnclaimed: [],
          blockedByAgent: [],
          proofMissingDoneTasks: [],
          releaseBlockers: [],
          humanBlockingCount: 0,
          unfinishedCount: 0,
          scopedTasks: [],
          gitStoryTasks: [],
        }
    const activePressureTest = listPressureTestIntakes(memoryDir)
      .find(intake => intake.status === 'active' && intake.pendingQuestion)
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
      releaseBlockers,
      humanBlockingCount,
      unfinishedCount,
      gitStoryTasks,
    } = releaseTruth
    const dynamicTaskBlockerIds = new Set(releaseBlockers.map(blocker => blocker.id))
    const savedTaskBlockerIds = new Set(savedReleaseSummary?.blockers.map(blocker => blocker.id) ?? [])
    const savedCoreMatchesDynamic = !savedReleaseSummary || summaryFreshness !== 'current' || (
      savedCounts.total === scopedTasks.length &&
      savedCounts.done === (statusCounts['done'] ?? 0) &&
      savedCounts.unfinished === unfinishedCount &&
      Object.keys(savedStatusCounts).length === Object.keys(statusCounts).length &&
      Object.entries(savedStatusCounts).every(([status, count]) => count === (statusCounts[status] ?? 0)) &&
      savedCounts.blocked === releaseBlockers.length &&
      savedTaskBlockerIds.size === dynamicTaskBlockerIds.size &&
      [...savedTaskBlockerIds].every(id => dynamicTaskBlockerIds.has(id))
    )
    const stateConsistency = !savedReleaseSummary ? 'missing' : savedCoreMatchesDynamic ? 'aligned' : 'mismatch'
    const repositoryFollowup = await buildReleaseRepositoryFollowup(projectPath, gitStoryTasks)
    const { dirtyCheckout, gitStory } = repositoryFollowup
    const readinessProofStyle = savedRelease?.proofStyle && savedRelease.proofStyle !== 'unspecified'
      ? savedRelease.proofStyle
      : scopedWorkNeedsDesignSystem(scopedTasks, savedRelease)
        ? 'manual'
        : 'script_only'
    // An unspecified release may be described as headless by a source
    // boundary, but it is not a persisted script-only contract until intake
    // records that contract. Keep the inferred diagnostic label while making
    // the blocking rule depend on the durable release field.
    const commandProofRequired = savedRelease?.proofStyle === 'script_only'
    const routeProofMissingDoneTasks = commandProofRequired
      ? scopedTasks
        .filter(task => String(task.status ?? '') === 'done')
        .filter(task => !taskHasScriptProofPath(task))
        .filter(task => !taskCompletionProofSatisfiedByLinkedChildren(task, tasks, savedRelease?.proofStyle, diagnosticScope))
        .map(task => ({ id: task.id, title: task.title }))
      : []
    const scopedTaskIds = new Set(scopedTasks.map(task => task.id))
    const effectiveProofMissingDoneTasks = [
      ...proofMissingDoneTasks,
      ...routeProofMissingDoneTasks.filter(task => !proofMissingDoneTasks.some(existing => existing.id === task.id)),
    ].filter(task => scopedTaskIds.has(task.id))
    const effectiveReleaseBlockers = [
      ...releaseBlockers,
      ...routeProofMissingDoneTasks
        .filter(task => !releaseBlockers.some(existing => existing.id === task.id))
        .map(task => ({
          id: task.id,
          title: task.title,
          label: `${task.title.trim().replace(/[.?!:;,\s]+$/g, '')} needs proof evidence before the release is complete.`,
        })),
    ].filter(blocker => scopedTaskIds.has(blocker.id))
    const designSystemBlockingCount =
      scopedTasks.length > 0 &&
      scopedWorkNeedsDesignSystem(scopedTasks, { proofStyle: readinessProofStyle }) &&
      !designSystem.approved
        ? 1
        : 0
    const dirtyCheckoutBlockingCount = dirtyCheckout.ownedCount > 0 || dirtyCheckout.error ? 1 : 0
    const repositoryFollowupCount = gitStory.blockers.length
    const repositoryFollowupBlockers = gitStory.blockers.map(blocker => ({
      id: `repository-followup:${blocker.id}`,
      title: `Repository follow-up: ${blocker.label}`,
      label: blocker.reason,
      reason: blocker.reason,
      ...(blocker.nextAction ? { nextAction: blocker.nextAction } : {}),
      ...(blocker.state ? { state: blocker.state } : {}),
      ...(blocker.repoId ? { repoId: blocker.repoId } : {}),
      ...(blocker.repoLabel ? { repoLabel: blocker.repoLabel } : {}),
      ...(blocker.taskId ? { taskId: blocker.taskId } : {}),
    }))
    const designSystemBlockers = designSystemBlockingCount > 0
      ? [{
          id: 'design-system',
          title: 'Design system',
          label: designSystem.reason ?? 'Design-system guardrail is not approved.',
        }]
      : []
    const dirtyCheckoutBlockers = dirtyCheckoutBlockingCount > 0
      ? [{
          id: 'dirty-checkout',
          title: 'Project checkout',
          label: dirtyCheckout.error
            ? `Could not inspect project checkout: ${dirtyCheckout.error}`
            : `${dirtyCheckout.ownedCount} Guildhall-managed checkout ${dirtyCheckout.ownedCount === 1 ? 'file needs' : 'files need'} cleanup or landing.`,
        }]
      : []
    const blockingKeys = new Set<string>()
    for (const blocker of effectiveReleaseBlockers) blockingKeys.add(`task:${blocker.id}`)
    for (const task of effectiveProofMissingDoneTasks) blockingKeys.add(`task:${task.id}`)
    for (const blocker of gitStory.blockers) {
      blockingKeys.add(blocker.taskId ? `task:${blocker.taskId}` : `repo:${blocker.id}`)
    }
    if (designSystemBlockingCount > 0) blockingKeys.add('design-system')
    if (dirtyCheckoutBlockingCount > 0) blockingKeys.add('dirty-checkout')
    const blockingCount = blockingKeys.size
    const diagnosticReady = scopedTasks.length > 0 && blockingCount === 0 && unfinishedCount === 0
    const diagnosticCompletion = buildReleaseCompletionSummary({
      ready: diagnosticReady,
      totals: {
        tasks: scopedTasks.length,
        done: statusCounts['done'] ?? 0,
        unfinishedCount: unfinishedCount,
        humanBlockingCount: humanBlockingCount,
      },
      releaseBlockers: effectiveReleaseBlockers,
    })
    const diagnosticVerdict = buildReleaseVerdictSummary({
      hasNamedRelease: Boolean(savedRelease?.label),
      ready: diagnosticReady,
      ...(scopedTasks.length === 0 ? { notReadyReason: 'No tasks in this scope yet.' } : {}),
      totals: {
        tasks: scopedTasks.length,
        done: statusCounts['done'] ?? 0,
        blockingCount,
        humanBlockingCount: humanBlockingCount,
        proofEvidenceBlockingCount: effectiveProofMissingDoneTasks.length,
        unfinishedCount: unfinishedCount,
        designSystemBlockingCount,
        dirtyCheckoutBlockingCount,
      },
      designSystem,
      dirtyCheckout,
    })
    const diagnostics = {
      freshness: 'request_time',
      currentStateAuthority: state.authority,
      stateConsistency,
      proofStyle: readinessProofStyle,
      ...(activePressureTest?.pendingQuestion
        ? {
            pressureTest: {
              targetTitle: activePressureTest.target.title,
              pendingQuestion: activePressureTest.pendingQuestion,
            },
          }
        : {}),
      ready: diagnosticReady,
      completion: diagnosticCompletion,
      verdict: diagnosticVerdict,
      statusCounts,
      openEscalations,
      incompleteBriefs,
      unapprovedBriefs,
      unapprovedSpecs,
      shelvedUnclaimed,
      blockedByAgent,
      proofMissingDoneTasks: effectiveProofMissingDoneTasks,
      releaseBlockers: [
        ...effectiveReleaseBlockers,
        ...repositoryFollowupBlockers,
        ...designSystemBlockers,
        ...dirtyCheckoutBlockers,
      ],
      designSystem,
      dirtyCheckout,
      gitStory,
      totals: {
        tasks: scopedTasks.length,
        blockingCount,
        humanBlockingCount,
        incompleteBriefBlockingCount: incompleteBriefs.length,
        proofEvidenceBlockingCount: effectiveProofMissingDoneTasks.length,
        unfinishedCount,
        designSystemBlockingCount,
        dirtyCheckoutBlockingCount,
        gitStoryBlockingCount: repositoryFollowupCount,
        done: statusCounts['done'] ?? 0,
      },
    }

    const dynamicReleaseBlockers = diagnostics.releaseBlockers
    const dynamicNextAction = diagnosticReady
      ? {
          code: 'all_terminal',
          label: 'Review',
          message: 'The selected release has completed work and current proof. Review it before shipping.',
        }
      : effectiveProofMissingDoneTasks[0]
        ? {
            code: 'proof_evidence_missing',
            label: 'Complete proof',
            message: `${effectiveProofMissingDoneTasks.length} completed work item${effectiveProofMissingDoneTasks.length === 1 ? '' : 's'} still need current proof evidence.`,
            focusTaskId: effectiveProofMissingDoneTasks[0].id,
            focusTaskTitle: effectiveProofMissingDoneTasks[0].title,
            focusKind: 'proof',
          }
        : scopedTasks.find(task => String(task.status ?? '') !== 'done')
          ? {
              code: 'continue_work',
              label: 'Continue work',
              message: 'Continue the first unfinished work item in the selected release.',
              focusTaskId: scopedTasks.find(task => String(task.status ?? '') !== 'done')?.id,
              focusTaskTitle: scopedTasks.find(task => String(task.status ?? '') !== 'done')?.title,
              focusKind: 'work',
            }
          : {
              code: 'review_release',
              label: 'Review release',
              message: dynamicReleaseBlockers[0]?.label ?? 'Review the selected release blockers.',
            }

    return {
      checksLoaded: true,
      release: savedRelease,
      scope: savedScope,
      ready: diagnosticReady,
      summaryFreshness,
      currentStateAuthority: state.authority,
      queueRevision: state.queueRevision,
      projectRevision: state.projectRevision,
      stateConsistency,
      ...(summaryFreshness !== 'current' && savedReleaseSummary
        ? { notReadyReason: 'The saved project summary is refreshing.' }
        : savedCounts.total === 0 ? { notReadyReason: 'No tasks in this scope yet.' } : {}),
      completion: diagnosticCompletion,
      verdict: diagnosticVerdict,
      nextAction: dynamicNextAction,
      statusCounts,
      releaseBlockers: dynamicReleaseBlockers,
      gitStory,
      totals: diagnostics.totals,
      diagnostics,
    }
  }

  async function refreshProjectDiagnosticProjection(projectRoot: string): Promise<void> {
    const state = await readProjectCanonicalCurrentState(projectRoot)
    if (state.authority !== 'database' || state.projectRevision === null) return
    const payload = await buildProjectReleaseReadinessPayload({
      state,
      projectRoot,
      liveDiagnostics: true,
    })
    const diagnostics = isRecord(payload.diagnostics) ? payload.diagnostics : null
    const gitStory = diagnostics && isRecord(diagnostics.gitStory) ? diagnostics.gitStory : null
    const readiness = diagnostics && isRecord(diagnostics.verdict) ? diagnostics.verdict : null
    const gitBlockers = gitStory && Array.isArray(gitStory.blockers)
      ? gitStory.blockers.filter(isRecord).map(blocker => ({
          id: typeof blocker.id === 'string' ? blocker.id : 'repository',
          label: typeof blocker.reason === 'string'
            ? blocker.reason
            : typeof blocker.label === 'string' ? blocker.label : 'Repository follow-up required',
          ...(typeof blocker.state === 'string' ? { state: blocker.state } : {}),
          ...(typeof blocker.nextAction === 'string' ? { nextAction: blocker.nextAction } : {}),
          ...(typeof blocker.repoId === 'string' ? { repoId: blocker.repoId } : {}),
          ...(typeof blocker.taskId === 'string' ? { taskId: blocker.taskId } : {}),
        }))
      : []
    const readinessBlockers = diagnostics && Array.isArray(diagnostics.releaseBlockers)
      ? diagnostics.releaseBlockers.filter(isRecord).map(blocker => ({
          id: typeof blocker.id === 'string' ? blocker.id : 'release-blocker',
          label: typeof blocker.label === 'string'
            ? blocker.label
            : typeof blocker.title === 'string' ? blocker.title : 'Release blocker',
          ...(typeof blocker.code === 'string' ? { code: blocker.code } : {}),
          ...(typeof blocker.state === 'string' ? { state: blocker.state } : {}),
          ...(typeof blocker.reason === 'string' ? { reason: blocker.reason } : {}),
          ...(typeof blocker.nextAction === 'string' ? { nextAction: blocker.nextAction } : {}),
          ...(typeof blocker.repoId === 'string' ? { repoId: blocker.repoId } : {}),
          ...(typeof blocker.taskId === 'string' ? { taskId: blocker.taskId } : {}),
        }))
      : []
    const projection: ProjectStateDatabaseDiagnosticProjectionSnapshot = {
      sourceRevision: state.projectRevision,
      freshness: 'current',
      generatedAt: new Date().toISOString(),
      git: gitStory
        ? {
            ready: gitStory.ready === true,
            state: typeof gitStory.state === 'string' ? gitStory.state : 'unknown',
            blockerCount: gitBlockers.length,
            blockers: gitBlockers,
          }
        : null,
      readiness: readiness
        ? {
            ready: readiness.state === 'ready',
            code: typeof readiness.state === 'string' ? readiness.state : null,
            message: typeof readiness.detail === 'string' ? readiness.detail : null,
            blockerCount: isRecord(diagnostics?.totals) && typeof diagnostics.totals.blockingCount === 'number'
              ? diagnostics.totals.blockingCount
              : 0,
            unfinishedCount: isRecord(diagnostics?.totals) && typeof diagnostics.totals.unfinishedCount === 'number'
              ? diagnostics.totals.unfinishedCount
              : 0,
            blockers: readinessBlockers,
          }
        : null,
    }
    writeProjectStateDatabaseDiagnosticProjection(projectRoot, projection)
  }

  // -------------------------------------------------------------------------
  // API: release readiness
  //
  // Aggregates the signals that decide whether the selected release, milestone,
  // or owner-named marker is ready enough to hand off, ship, or intentionally
  // defer. Intentionally shallow: it summarizes, it doesn't gate.
  // -------------------------------------------------------------------------
  app.get('/api/project/release-readiness/summary', async c => {
    try {
      if (project.initializationNeeded) return c.json({ initializationNeeded: true })
      const state = await readProjectReleaseState(project.path)
      const projection = state.summary
      if (!projection) {
        return c.json({
          error: 'The saved release summary is not available yet.',
          checksLoaded: false,
        }, 503)
      }
      return c.json({
        // Release identity and selected-scope membership come from the same
        // saved boundary snapshot as the projection. The summary remains the
        // source of counts/readiness; the queue envelope supplies the durable
        // release definition when an older projection omitted that field.
        ...compactReleaseReadinessFromProjection({
          projection,
          rawQueue: state.rawQueue,
          scope: state.scope,
        }),
        summaryFreshness: projection.freshness,
        generatedAt: projection.generatedAt,
        currentStateAuthority: state.authority,
        queueRevision: state.queueRevision,
        projectRevision: state.projectRevision,
        detailEndpoint: '/api/project/release-readiness?detail=true',
      })
    } catch (err) {
      return c.json({
        error: 'Could not load the saved release summary.',
        detail: err instanceof Error ? err.message : String(err),
      }, 500)
    }
  })

  app.get('/api/project/release-readiness', async c => {
    try {
      // Ordinary Release detail is a saved projection read. Only an explicit
      // live/diagnostic query enters the rich canonical reader.
      const liveDiagnostics = c.req.query('live') === 'true' || c.req.query('diagnostic') === 'true'
      const state = await readProjectReleaseState(project.path, { liveDiagnostics })
      return c.json(await buildProjectReleaseReadinessPayload({
        state,
        liveDiagnostics,
      }))
    } catch (err) {
      return c.json({
        error: 'Could not load release readiness for this project.',
        detail: err instanceof Error ? err.message : String(err),
      }, 500)
    }
  })

  async function buildReleaseRepositoryFollowup(
    projectPath: string,
    tasks: Array<Record<string, unknown>>,
  ): Promise<{
    dirtyCheckout: Awaited<ReturnType<typeof guildhallOwnedDirtyCheckout>>
    gitStory: GitStorySummary
  }> {
    const [dirtyCheckout, gitStory] = await Promise.all([
      guildhallOwnedDirtyCheckout(projectPath),
      buildProjectGitStorySummary(projectPath, tasks),
    ])
    const activeTaskIds = new Set(
      tasks
        .filter(taskGitStoryIsAgentWorkInProgress)
        .map(task => typeof task.id === 'string' ? task.id : '')
        .filter(Boolean),
    )
    const releaseGitStory = summarizeGitStories(
      gitStory.snapshots.filter(snapshot => !snapshot.taskId || !activeTaskIds.has(snapshot.taskId)),
    )
    return {
      dirtyCheckout,
      gitStory: {
        ...releaseGitStory,
        snapshots: gitStory.snapshots,
      },
    }
  }

  function taskGitStoryIsAgentWorkInProgress(task: Record<string, unknown>): boolean {
    return ['in_progress', 'review', 'gate_check'].includes(String(task.status ?? ''))
  }

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

  function describeProviders() {
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

  const refreshProjectProjectionsForApp = (
    root: string,
    event?: ProjectProjectionInvalidation,
  ): Promise<void> => refreshProjectProjections(root, event, {
    supervisor,
    refreshDiagnostic: refreshProjectDiagnosticProjection,
  })

  return {
    app,
    supervisor,
    runtimeSupervisor,
    projectPath,
    refreshProjectProjections: refreshProjectProjectionsForApp,
    startup,
  }
}

export async function runServe(opts: ServeOptions = {}): Promise<void> {
  const { app, supervisor, projectPath, refreshProjectProjections, startup } = buildServeApp(opts)
  const project = resolveProject(projectPath)
  const cfg = readProjectConfig(projectPath)
  const port = opts.port ?? cfg.servePort
  const startupFleetProjects = listWorkspaces()
  try {
    bootstrapFleetSummaryProjection()
    pruneFleetSummaryProjectionAtBoundary(startupFleetProjects.map(entry => entry.id))
  } catch (error) {
    // A fleet index failure must leave project routes usable. Fleet cards will
    // report the bounded read error until the next service restart/refresh.
    console.warn(`[guildhall serve] Fleet summary index unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  let projectionRefreshScheduler: ProjectProjectionRefreshScheduler
  projectionRefreshScheduler = createProjectProjectionRefreshScheduler(async (root, event) => {
    const before = readProjectProjectionMetadataAtBoundary(root)
    const startingRevision = before?.revision ?? event.revision ?? null
    await refreshProjectProjections(root, event)
    // A second process can commit while this refresh is reading its queue.
    // Re-read the shared watermark and schedule one bounded retry; do not let
    // a stale projection be reported as current after a newer commit.
    const metadata = readProjectProjectionMetadataAtBoundary(root)
    if (metadata && startingRevision !== null && metadata.revision > startingRevision) {
      projectionRefreshScheduler.schedule({
        projectRoot: root,
        revision: metadata.revision,
        domains: ['legacy'],
      })
    }
  })
  const unsubscribeProjectSummaryInvalidations = subscribeProjectSummaryInvalidations(event => {
    const projectRoot = resolve(event.projectRoot)
    const entry = listWorkspaces().find(candidate => resolve(candidate.path) === projectRoot)
    if (entry && fleetSummaryDependsOnDomains(event.domains)) {
      try {
        markFleetSummaryStaleAtBoundary({
          projectId: entry.id,
          projectPath: projectRoot,
          ...(event.revision !== undefined ? { sourceProjectRevision: event.revision } : {}),
        })
      } catch {
        // The scheduler still refreshes the project-local projections; a
        // transient fleet-index lock must not make a project write fail.
      }
    }
    projectionRefreshScheduler.schedule({
      projectRoot,
      revision: event.revision,
      domains: event.domains,
    })
  })
  const projectionFreshnessWatcher = createProjectProjectionFreshnessWatcher({
    projectRoots: () => listWorkspaces().map(entry => entry.path),
    readMetadata: projectRoot => readProjectProjectionMetadataAtBoundary(projectRoot),
    schedule: event => projectionRefreshScheduler.schedule(event),
  }, 5000)

  // Registration is an explicit lifecycle boundary. Keep it out of list/read
  // paths so opening the Projects page never mutates the cache registry.
  for (const entry of listWorkspaces()) {
    try {
      registerProjectCacheWorkspace(entry.path)
    } catch {
      // Cache ownership must not prevent the dashboard from starting.
    }
  }

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
    startup.listenerReadyAt = new Date().toISOString()
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
    // Only the process that successfully owns the listener may invalidate the
    // fleet read model. A competing launch attempt can reach this function
    // before failing with EADDRINUSE; letting that loser mark every row stale
    // makes a healthy service report a false fleet-wide outage.
    try {
      markAllFleetSummariesStaleAtBoundary()
    } catch (error) {
      console.warn(`[guildhall serve] Could not mark fleet summaries stale at service start: ${error instanceof Error ? error.message : String(error)}`)
    }
    // Materialize durable attention after the listener is available. This is
    // deliberately outside the request path: fleet reads stay bounded even
    // when several registered projects need their first attention snapshot.
    setTimeout(() => {
      void (async () => {
        const entries = listWorkspaces()
        startup.projectCount = entries.length
        startup.refreshStartedAt = new Date().toISOString()
        // A previous serve process may have died with a durable run marked
        // running. Recover it before publishing fleet shells so no surface
        // presents an orphaned run as live.
        for (const entry of entries) {
          if (supervisor.get(entry.id)) continue
          try {
            recoverOrphanedExecutionProjection(entry.path)
          } catch (error) {
            console.warn(`[guildhall serve] Could not recover execution state for ${entry.id}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        // Publish every saved shell before doing any rich refresh. A single
        // slow project must not leave the rest of the fleet in "loading".
        for (const entry of entries) {
          try {
            publishFleetSummaryFromSavedState(entry, supervisor.get(entry.id))
          } catch (error) {
            console.warn(`[guildhall serve] Could not hydrate fleet summary for ${entry.id}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }

        // Refresh in a small number of workers. Full Promise.all made startup
        // compete with itself for SQLite locks, filesystem reads, Git, and
        // memory even though no project depended on another project's refresh.
        const pending = entries.filter(entry => {
          try {
            const resolved = resolveProject(entry.path)
            if (resolved.initializationNeeded) return false
            const authority = readProjectStateAuthorityAtBoundary(projectTasksPath(entry.path))
            const summary = readProjectSummaryShellAtBoundary(entry.path).summary
            return shouldRefreshProjectAtStartup({
              authority: authority.authority,
              summaryFreshness: summary?.freshness,
              attentionNeedsRefresh: attentionProjectionNeedsReleaseReconciliation(
                entry.path,
                summary?.releaseSummary ?? null,
              ),
            })
          } catch {
            // An unreadable boundary is itself a repair candidate. Keep the
            // existing refresh path responsible for surfacing the error.
            return true
          }
        })
        const workerCount = Math.min(2, pending.length)
        await Promise.all(Array.from({ length: workerCount }, async () => {
          while (pending.length > 0) {
            const entry = pending.shift()
            if (!entry) return
            try {
              await refreshProjectProjections(entry.path)
              startup.refreshedProjectCount += 1
            } catch (error) {
              startup.errorCount += 1
              // The fleet row records the bounded error state; keep the
              // service alive and make the background failure visible in logs.
              console.warn(`[guildhall serve] Could not refresh project projection for ${entry.id}: ${error instanceof Error ? error.message : String(error)}`)
            }
          }
        }))
        startup.refreshCompletedAt = new Date().toISOString()

        // The watcher is for writes made by another process. Establish its
        // baseline only after this process finishes its own startup refresh,
        // or it will mistake those writes for external changes on its first
        // interval and mark every fleet row stale again.
        projectionFreshnessWatcher.start()
      })()
    }, 0)
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
    unsubscribeProjectSummaryInvalidations()
    projectionRefreshScheduler.dispose()
    projectionFreshnessWatcher.dispose()
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
