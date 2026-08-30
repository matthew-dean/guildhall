import { writeManagedTextFileSync } from '@guildhall/persistence'
import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import {
  createCoordinatorAgent,
  createSpecAgent,
  createWorkerAgent,
  createReviewerAgent,
  createGateCheckerAgent,
  createPersonaReviewerAgent,
  personaReviewerSystemPrompt,
  buildModelSet,
  temperatureForRole,
  type GuildhallAgent,
  type AgentLLM,
} from '@guildhall/agents'
import { selectApiClient, type ProviderName, type SelectApiClientOptions } from './provider-selection.js'
import {
  getRuntimeProviderConfig,
  resolveLaneConcurrencyPlan,
  resolveReviewerFanoutPolicy,
} from './provider-runtime-config.js'
import {
  acceptanceCriteriaFromStructuredSpec,
  StructuredSpec,
  renderStructuredSpecMarkdown,
  AgentIssue,
  TaskQueue,
  TERMINAL_TASK_STATUSES,
  type ModelAssignmentConfig,
  type AdjudicationRecord,
  type Checkpoint,
  type ReviewVerdict,
  Task,
  type TaskEvidenceEvent,
  type TaskStatus,
  type TaskPermissionMode,
  type CoordinatorDomain,
  type ProgressEntry,
  TaskRuntimeState,
  type TaskWorkspaceState,
  parseTaskRuntimeField,
} from '@guildhall/core'
import {
  readProjectConfig,
  readGlobalConfig,
  updateProjectConfig,
  migrateProjectProvidersToGlobal,
  type ResolvedConfig,
} from '@guildhall/config'
import {
  PermissionMode,
  HookEvent,
  type AnyTool,
  type ApiMessageRequest,
  type HookExecutor,
} from '@guildhall/engine'
import { McpClientManager, createMcpTools } from '@guildhall/mcp'
import { loadSkillRegistry } from '@guildhall/skills'
import {
  logProgress,
  raiseEscalation,
  findReclaimTasks,
  loadReclaimCandidates,
  readCheckpoint,
  clearCheckpoint,
  checkpointIsFreshForTask,
  writeCheckpoint,
  ensureExploringTranscriptEntry,
  isProofSetupTask,
  activeEscalations,
  hasOpenEscalation,
  resolveSupersededEscalations,
  ensureRetryWindow,
  currentRevisionCycleCount,
  type ReclaimCandidate,
} from '@guildhall/tools'
import {
  pickNextTask,
  needsPreRejectionPolicy,
  dependenciesSatisfied,
  taskHasUnansweredOpenQuestion,
  selectedReleaseScopeForQueue,
  selectedTaskScopeForQueue,
} from './orchestrator-picker.js'
import {
  AGENT_SETTINGS_FILENAME,
  loadLeverSettings,
  resolveDomainLevers,
  type DomainLevers,
  type ProjectLevers,
} from '@guildhall/levers'
import { buildContext, resolveLikelyTaskFiles } from './context-builder.js'
import { applyTaskTransition, transitionTaskStatus, type TaskTransitionEvent } from './task-transition.js'
import { reopenLegacyWorktreeSyncRecovery } from './worktree-sync-recovery.js'
import { recordTaskReflection } from './learning.js'
import {
  modelForAgentName,
  roleForAgentName,
  writeContextDebugRecord,
} from './context-observability.js'
import { buildHookExecutor } from './hooks-loader.js'
import { buildDefaultCompactor } from './compactor-builder.js'
import { buildEssentialHistorySummarizer } from './essential-history.js'
import { evaluateProposal, type PromotionAction } from './proposal-promotion.js'
import { WORKSPACE_IMPORT_TASK_ID, readWorkspaceGoalsState } from './workspace-importer.js'
import { taskHasUnansweredVisibleQuestion } from './question-visibility.js'
import { buildPromptCacheKey } from './prompt-cache.js'
import { resolveModelApiPolicy, type ModelApiRole } from './model-api-policy.js'
import { repairStaleBlockersInQueue } from './stale-blocker-repair.js'
import { buildEffectiveTask } from './effective-task.js'
import { currentLifecycleForTask } from './current-lifecycle.js'
import { taskCompletionProofSatisfiedByLinkedChildren } from './project-scope-projection.js'
import {
  hasActiveProofRecovery,
  latestFallbackApprovalHasUnresolvedSubstantiveRevision,
  reconcileAcceptanceCriteriaFromApprovedReview,
  reviewAcceptanceCriteriaMissingApprovalIds,
  reviewProofMissingApprovalIds,
  reviewVerdictLooksNonSubstantive,
  taskDoneButProofMissing,
  taskDoneButProofMissingForScope,
} from './proof-health.js'
import { comparableCommand, ensureCommandProofPathsFromAcceptanceCriteria, isConcreteProjectProofCommand, proofSetupHasTaskIdentity } from './proof-paths.js'
import {
  readPersistedStructuredSelfCritique,
  reviewVerdictHasStructuredApproval,
  reviewVerdictIsNonSubstantiveFailure,
  type StructuredSelfCritique,
} from './review-contract.js'
import { hasUsableBlueprint, resetCurrentPlanForProofRecovery } from './task-plan-recovery.js'
import { requiresRealProviderProof, simulatedProviderProofArtifact } from './provider-proof-contract.js'
import {
  FORBIDDEN_PROJECT_TASK_FIELDS,
  readProjectStateAuthorityAtBoundary,
  readProjectTaskCurrentStateAtBoundary,
  readProjectTaskQueueForMutationSync,
  readProjectTaskQueueSync,
  sanitizeTaskQueueForProjectWrite,
  writePromotedTaskDetailMutation,
  writeProjectTaskQueue,
  writeProjectTaskQueueWithSummary,
} from './project-state-boundary.js'
import { projectStateWriteLockHeld, withProjectStateWriteLock } from '@guildhall/sessions'
import {
  effectiveBootstrapGateCommands,
  findAutomatedAcceptanceCriteriaMissingCommands,
  findInvalidAutomatedAcceptanceCommands,
  normalizeAutomatedAcceptanceCriterionCommands,
  normalizeRunRecordJsonSelectionCommand,
  reconcileAutomatedAcceptanceCommandsFromVerificationResults,
  type RecentVerificationResult,
  renderTaskScopedGateInstructions,
  renderTaskScopedVerificationInstructions,
  resolveEffectiveTaskBootstrapBlock,
  resolveEffectiveTaskProjectPath,
  resolveEffectiveTaskSuccessGates,
  resolveEffectiveTaskVerificationCommands,
  rewriteWorkspaceCommandsForIsolatedTaskWorktree,
} from './task-gates.js'
import { runGates, summarizeScopedHardGateDisposition } from '@guildhall/tools'
import {
  evaluatePreRejection,
  type PreRejectionAction,
} from './pre-rejection-policy.js'
import { recordMemoryEvent, type GuildhallMemoryScope } from '@guildhall/memory-core'
import { LivenessTracker, type StallFlag } from './liveness.js'
import {
  tickOutcomeToBackendEvent,
  agentIssueToBackendEvent,
} from './wire-events.js'
import { assessTaskReadiness, hasSettledFixedSpecBoundary } from './task-readiness.js'
import type { BackendEvent } from '@guildhall/backend-host'
import { userMessageFromContent, type ImageBlock, type StreamEvent } from '@guildhall/protocol'
import {
  authorizeAction,
  buildRemediationContext,
  recordRemediationDecision,
  type AuthorizationDecision,
  type RemediationAction,
  type RemediationContext,
  type RemediationTrigger,
} from './remediation.js'
import {
  SlotAllocator,
  buildSlotEnv,
  slotSystemPromptRule,
  resolveSlotShape,
  type Slot,
  type RuntimeIsolationConfig,
} from './slot-allocator.js'
import { refreshCodebaseMap } from '@guildhall/corpus-map'
import { validateProductBriefGrounding, validateSpecCompletionBoundary } from './spec-quality.js'
import {
  NodeGitDriver,
  type GitDriver,
} from './git-driver.js'
import { buildCommitStoryMessage } from './commit-story.js'
import { discoverChildGitProjects, effectiveGitStoryPolicy } from './git-story-policy.js'
import {
  clearTaskWorkspaceState,
  readTaskWorkspaceStore,
  upsertTaskWorkspaceState,
} from './task-state-store.js'
import {
  cleanupWorktreeForTerminal,
  discardTaskWorktreeForRecovery,
  computeBranchName,
  computeWorktreePath,
  resolveWorktreeMode,
  WorktreeSyncError,
  type WorktreeMode,
} from './worktree-manager.js'
import { ensureAndRegisterTaskWorkspace } from './task-workspace-registration.js'
import {
  dispatchMerge,
  appendFixupTask,
  shelveSupersededFixupTasks,
  resolveLandingStrategy,
  type LandingStrategy,
} from './merge-dispatcher.js'
import { workSubtreeIds } from './work-hierarchy.js'
import { requestSpecReview, specReviewIsReadyForOwnerApproval } from './spec-review-ownership.js'
import { applyRunAutomationPolicy as applyRunAutomationLeverPolicy } from './run-automation.js'
import {
  atomicWriteText,
  getProjectStateDir,
  getProjectSystemStatePath,
  getProjectSystemStatePathFromMemoryDir,
  getProjectTranscriptPath,
  getProjectTaskReviewPacketPath,
  inferProjectRootFromMemoryDir,
  loadSessionById,
  appendTaskEvidence,
  readTaskEvidence,
  readTaskRuntimeStore,
  upsertTaskRuntimeState,
  flushTaskEvidenceOutboxForTasksPath,
  readProjectStateDatabaseTaskEvidenceAuthorityFromTasksPath,
  readProjectStateDatabaseTaskPointWithRevision,
  TASK_EVIDENCE_RETENTION,
  readProjectStateDatabaseCurrentAuthorityFromTasksPath,
  readProjectStateDatabaseQueueRevision,
  type SessionSnapshot,
} from '@guildhall/sessions'
import {
  pickNextTasks,
  resolveFanoutCapacity,
  type FanoutCapacity,
} from './fanout-dispatcher.js'
import { isStopRequested } from './stop-requested.js'
import { runBootstrap, bootstrapNeeded } from './bootstrap-runner.js'
import {
  META_INTAKE_TASK_ID,
  parseCoordinatorDraft,
} from './meta-intake.js'
import { taskEligibleForSelectedScope, taskNodeId } from './project-orientation-spine.js'
import { isCurrentProofPathProven, recoverClippedTitle } from '@guildhall/shared'
import {
  createOwnerInputRequest,
  waitingOwnerInputTaskIdsSync,
} from './owner-input-store.js'
import { hasWorkspaceImportProvenance } from './import-drafts.js'
import {
  deterministicReview,
  applyDeterministicVerdict,
  recordApprovedReviewProof,
  recordLlmVerdict,
  DETERMINISTIC_PASS_THRESHOLD,
  shouldAdvanceToGateCheckPendingAutomatedVerification,
  shouldAdvanceToGateCheckPendingHardGates,
  type DeterministicVerdict,
  type ReviewerMode,
} from './reviewer-dispatch.js'
import { ensureTaskReviewPlanRecorded } from './review-planner.js'
import { buildDoneTaskSummaryBundle } from './done-task-summary.js'
import type { ReviewAuditStore, ReviewEffort, ReviewPlanRecord, ReviewRiskLane } from './review-audit-store.js'
import { createReviewAuditStore } from './review-audit-store.js'
import { FileBackedGuildhallPersistence } from '@guildhall/persistence'
import { runGuildGates } from './guild-gate-runner.js'
import { loadDesignSystem } from './design-system-store.js'
import {
  appendFailureClassificationNote,
  appendRecoveryPlaybookNote,
  buildAgentDecisionPacket,
  classifyAgentFailure,
  RECOVERY_PLAYBOOK_IDS,
  renderAgentDecisionPacket,
  recoveryAllowedToolsForPlaybook,
  resolveRecoveryPlan,
  type FailureClassification,
  type RecoveryPlaybookId,
} from './policy.js'
import {
  selectApplicableGuilds,
  reviewersForTask,
  loadProjectGuildRoster,
  hasStructuredSurface,
  type GuildDefinition,
} from '@guildhall/guilds'
import {
  aggregateFanout,
  buildPersonaOutputHints,
  boundedConcurrency,
  personaVerdictToReviewRecord,
  selectReviewersForPlan,
  type PersonaVerdict,
  type ReviewerFanoutPolicy,
} from './reviewer-fanout.js'
import fs from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveRuntimePath } from './path-utils.js'

const execFileP = promisify(execFile)

interface ScopedTaskFileSnapshot {
  relativePath: string
  contents: Buffer | null
}

function worktreeIncludeForTaskProject(
  config: ResolvedConfig,
  taskProjectPath: string,
): string[] {
  const normalizedTaskPath = path.resolve(taskProjectPath)
  const childProject = config.projects?.find((project) => path.resolve(project.path) === normalizedTaskPath)
  if (childProject) return childProject.worktree?.include ?? []
  return config.worktree?.include ?? []
}

/**
 * Agent id recorded against promotion decisions written by the orchestrator
 * itself — distinguishes them from LLM-driven agent tool calls in progress
 * entries and audit scans.
 */
const PROPOSAL_PROMOTER_AGENT_ID = 'proposal-promoter'
const PRE_REJECTION_POLICY_AGENT_ID = 'pre-rejection-policy'

type AgentGenerateResult = Awaited<ReturnType<OrchestratorAgent['generate']>>
type WorktreeSyncRecovery = NonNullable<TaskWorkspaceState['syncRecovery']>

function isFrontendUiReviewTask(task: Task): boolean {
  return hasStructuredSurface(task, 'component')
}

function isLeanCommandBackedTask(task: Task): boolean {
  const isDeterministicProofSetup = isProofSetupTask(task) &&
    task.acceptanceCriteria.length > 0 &&
    task.acceptanceCriteria.every((criterion) =>
      typeof criterion.command === 'string' && criterion.command.trim().length > 0,
    )
  return (
    isDeterministicProofSetup || (
      task.sizePlan?.score === 1 &&
      task.sizePlan.reviewBudgetHint === 'lean' &&
      task.acceptanceCriteria.some((criterion) => typeof criterion.command === 'string' && criterion.command.trim().length > 0)
    )
  )
}

function taskHasConcreteProjectProofCommand(task: Task): boolean {
  const criterionCommand = task.acceptanceCriteria.some((criterion) =>
    typeof criterion.command === 'string' &&
    isConcreteProjectProofCommand(criterion.command),
  )
  if (criterionCommand) return true
  return (task.proofPaths ?? []).some((path) =>
    Boolean(
      path &&
      typeof path === 'object' &&
      !Array.isArray(path) &&
      typeof path.command === 'string' &&
      isConcreteProjectProofCommand(path.command),
    ),
  )
}

function landedTaskWorkRequiresProjectCheckoutProof(task: Task): boolean {
  if (!isProofSetupTask(task)) return false
  if (!['merged', 'pushed', 'push_failed_degraded'].includes(task.mergeRecord?.result ?? '')) return false
  const commands = task.acceptanceCriteria
    .map((criterion) => typeof criterion.command === 'string' ? comparableCommand(criterion.command) : null)
    .filter((command): command is string => Boolean(command))
  if (commands.length === 0 || !taskHasConcreteProjectProofCommand(task)) return false
  const projectCheckoutCommands = new Set(task.gateResults.flatMap(gate =>
    gate.executionRoot === 'project_checkout' && gate.passed && typeof gate.command === 'string'
      ? [comparableCommand(gate.command)]
      : [],
  ))
  return commands.some((command) => !projectCheckoutCommands.has(command))
}

function proofRecoveryNeedsFreshWorktree(task: Task): boolean {
  const recovery = (task as Task & {
    proofRecovery?: { freshWorktree?: unknown }
    runtime?: { proofRecovery?: { freshWorktree?: unknown } }
  }).proofRecovery ?? (task as Task & {
    runtime?: { proofRecovery?: { freshWorktree?: unknown } }
  }).runtime?.proofRecovery
  if (recovery?.freshWorktree === true) return true
  if (!['merged', 'pushed', 'push_failed_degraded'].includes(task.mergeRecord?.result ?? '')) return false
  return task.gateResults.some(gate => gate.executionRoot === 'project_checkout' && gate.passed === false)
}

function currentVerificationLifecycleReopenedAt(task: Task): number {
  const state = task as Task & {
    proofRecovery?: { reopenedAt?: unknown }
    currentLifecycle?: { reopenedAt?: unknown }
    runtime?: {
      proofRecovery?: { reopenedAt?: unknown }
      currentLifecycle?: { reopenedAt?: unknown }
    }
  }
  const boundaries = [
    state.proofRecovery?.reopenedAt,
    state.runtime?.proofRecovery?.reopenedAt,
    state.currentLifecycle?.reopenedAt,
    state.runtime?.currentLifecycle?.reopenedAt,
  ]
    .filter((value): value is string => typeof value === 'string')
    .map(value => Date.parse(value))
    .filter(Number.isFinite)
  return boundaries.length > 0 ? Math.max(...boundaries) : Number.NaN
}

function shouldRunAcceptanceCommandCriterion(
  task: Task,
  criterion: Task['acceptanceCriteria'][number],
): boolean {
  const command = typeof criterion.command === 'string' ? criterion.command.trim() : ''
  if (!command) return false
  const latestHardGate = latestHardGateResultForId(task, criterion.id) ??
    latestHardGateResultForCommand(task, command)
  const reopenedAt = currentVerificationLifecycleReopenedAt(task)
  const gateCheckedAt = latestHardGate
    ? Date.parse(latestHardGate.checkedAt)
    : Number.NaN
  // A passing gate from before a typed proof recovery belongs to the old
  // lifecycle. It must not suppress the command that can settle the current
  // recovery, even when the saved acceptance checkbox still says met.
  const recoveryNeedsFreshGate = Number.isFinite(reopenedAt) &&
    (!Number.isFinite(gateCheckedAt) || gateCheckedAt <= reopenedAt)
  if (recoveryNeedsFreshGate) return true
  if (!criterion.met) return latestHardGate?.passed !== true

  if (latestHardGate?.passed === true) return false
  if (latestHardGate?.passed === false) return true

  // A saved checkbox is not executable proof. If no current hard-gate record
  // exists, run the command regardless of whether a worker handoff note is
  // present. Requiring prose or a typed self-critique here would make stale
  // acceptance state authoritative again and would let an old `met: true`
  // suppress the only evidence check that can settle the criterion.
  return true
}

function hardGateIsCurrentForTask(
  task: Task,
  gate: NonNullable<Task['gateResults']>[number],
): boolean {
  const reopenedAt = currentVerificationLifecycleReopenedAt(task)
  if (!Number.isFinite(reopenedAt)) return true
  const checkedAt = Date.parse(gate.checkedAt)
  // A retry creates a new proof lifecycle. Old gates are historical evidence,
  // not current completion evidence, even when their IDs still match.
  return Number.isFinite(checkedAt) && checkedAt > reopenedAt
}

function taskDoneButMissingSelectedScopeProof(
  task: Task,
  queue: Pick<TaskQueue, 'tasks' | 'releases' | 'selectedReleaseId'>,
): boolean {
  const selectedScope = selectedReleaseScopeForQueue(queue)
  if (!selectedScope) return taskDoneButProofMissing(task)
  const tasksById = new Map(queue.tasks.map(candidate => [candidate.id, candidate] as const))
  const eligible = taskEligibleForSelectedScope(task, selectedScope, { tasksById }).eligible
  const proofStyle = eligible ? selectedScope.proofStyle : undefined
  return taskDoneButProofMissingForScope(task, proofStyle) &&
    !taskCompletionProofSatisfiedByLinkedChildren(task, queue.tasks, proofStyle, selectedScope)
}

function normalizeAcceptanceCommandForGuildhallState(command: string): string {
  const jsonArtifactCommand = normalizeRunRecordJsonSelectionCommand(command)
  if (jsonArtifactCommand !== command) return jsonArtifactCommand
  if (!/^git\s+diff\b/.test(command)) return command
  const operatorMatch = command.match(/\s(?:\||&&|\|\||;)\s/)
  const gitDiffSegment = operatorMatch ? command.slice(0, operatorMatch.index) : command
  const remainder = operatorMatch ? command.slice(operatorMatch.index) : ''
  if (/(?:^|\s)['"]?:!\.guildhall(?:\/\*\*)?['"]?(?:\s|$)/.test(gitDiffSegment)) return command
  if (/\s--(?:\s|$)/.test(gitDiffSegment)) {
    return `${gitDiffSegment} ':!.guildhall' ':!.guildhall/**'${remainder}`
  }
  return `${gitDiffSegment} -- ':!.guildhall' ':!.guildhall/**'${remainder}`
}

function expectedAcceptanceExit(criterion: Task['acceptanceCriteria'][number]): 'zero' | 'non_zero' {
  return criterion.expectedExit === 'non_zero' ? 'non_zero' : 'zero'
}

function acceptanceOutputMatches(
  criterion: Task['acceptanceCriteria'][number],
  output: string,
): boolean {
  return (criterion.expectedOutputIncludes ?? []).every((expected) => output.includes(expected))
}

function collectVisualEvidenceRefs(task: Task, discoveredRefs: readonly string[] = []): string[] {
  const sources: unknown[] = [
    ...discoveredRefs,
    ...(task.notes ?? []).flatMap((note) => {
      const refs = note.structured?.visualEvidenceRefs
      return Array.isArray(refs) ? refs : []
    }),
    ...((task as Task & { evidence?: TaskEvidenceEvent[] }).evidence ?? []).flatMap((event) => {
      const payload = event.payload
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
      const evidenceRefs = 'evidenceRefs' in payload && Array.isArray(payload.evidenceRefs)
        ? payload.evidenceRefs
        : []
      return (evidenceRefs as unknown[]).flatMap((evidenceRef: unknown) => {
          if (!evidenceRef || typeof evidenceRef !== 'object' || Array.isArray(evidenceRef)) return []
          const path = 'path' in evidenceRef && typeof evidenceRef.path === 'string'
            ? evidenceRef.path
            : 'id' in evidenceRef && typeof evidenceRef.id === 'string'
              ? evidenceRef.id
              : null
          return path ? [path] : []
      })
    }),
    ...(task.completionHandoff && typeof task.completionHandoff === 'object'
      ? 'evidenceRefs' in task.completionHandoff && Array.isArray(task.completionHandoff.evidenceRefs)
        ? task.completionHandoff.evidenceRefs.flatMap((evidenceRef) => {
            if (!evidenceRef || typeof evidenceRef !== 'object' || Array.isArray(evidenceRef)) return []
            const path = 'path' in evidenceRef && typeof evidenceRef.path === 'string'
              ? evidenceRef.path
              : 'id' in evidenceRef && typeof evidenceRef.id === 'string'
                ? evidenceRef.id
                : null
            return path ? [path] : []
          })
        : []
      : []),
  ]
  const refs: string[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    if (typeof source !== 'string') continue
    const ref = source.trim()
    if (!ref || !/(?:\.png|\.jpe?g|\.webp)$/i.test(ref) && !ref.startsWith('screenshot://')) continue
    if (seen.has(ref)) continue
    seen.add(ref)
    refs.push(ref)
  }
  return refs.slice(0, 12)
}

function friendlyRuntimeAgentName(agentName: string): string {
  if (agentName.startsWith('coordinator-')) return 'Coordinator'
  switch (agentName) {
    case 'spec-agent': return 'Spec author'
    case 'worker-agent': return 'Worker'
    case 'reviewer-agent': return 'Reviewer'
    case 'gate-checker-agent': return 'Gate checker'
    default: return agentName
  }
}

function hasBlueprintSanityReview(task: Task): boolean {
  return task.notes.some((note) =>
    note.role === 'blueprint-review' &&
    note.structured?.event === 'blueprint_review',
  )
}

function hasLatestBlueprintRevisionRequest(task: Task): boolean {
  for (let index = task.notes.length - 1; index >= 0; index -= 1) {
    const note = task.notes[index]
    if (note?.role !== 'blueprint-review') continue
    return note.structured?.event === 'blueprint_review' &&
      note.structured.decision === 'revise'
  }
  return false
}

function hasDeterministicSpecRepairNote(task: Task): boolean {
  return task.notes.some((note) =>
    note.agentId === 'coordinator-recovery' &&
    note.structured?.event === 'recovery_spec_repaired',
  )
}

function hasCurrentStructuredReviewContract(task: Task): boolean {
  return StructuredSpec.safeParse(task.structuredSpec).success && task.acceptanceCriteria.length > 0
}

function shouldRepairWeakRecoverySpecReviewSeed(task: Task, queue: TaskQueue): boolean {
  if (task.status !== 'spec_review') return false
  if (task.id === META_INTAKE_TASK_ID) return false
  // A structured review contract is current planning state even when a
  // separate brief-save failure still prevents approval. Recovery provenance
  // and inherited-reference gaps may warrant enrichment, never replacing the
  // owner's reviewable scope with a synthetic recovery seed.
  if (hasCurrentStructuredReviewContract(task)) return false
  const taskWithRuntime = task as Task & {
    proofRecovery?: { kind?: unknown }
    runtime?: { proofRecovery?: { kind?: unknown } }
  }
  const proofRecoveryKind = taskWithRuntime.proofRecovery?.kind ?? taskWithRuntime.runtime?.proofRecovery?.kind
  if (proofRecoveryKind === 'proof') return false
  const brief = task.productBrief
  const notes = Array.isArray(task.notes) ? task.notes : []
  const fromRecovery = brief?.authoredBy === 'coordinator-recovery' || notes.some((note) =>
    note.agentId === 'coordinator-recovery' &&
    (note.structured?.event === 'recovery_spec_seed' ||
      note.structured?.event === 'recovery_spec_repaired'),
  )
  if (!fromRecovery) return false
  const parentId = task.hierarchy?.parentId ?? task.delivery?.supports?.[0]
  const parentTask = parentId ? queue.tasks.find((candidate) => candidate.id === parentId) : undefined
  const parentHasRefs = Array.isArray(parentTask?.references) && parentTask.references.length > 0
  const taskMissingRefs = !Array.isArray(task.references) || task.references.length === 0
  // A readiness verdict that says "requires child work" is a reason to route
  // the task through coordinator reasoning, not enough information to invent
  // child units. Only an explicit structured parent-reference repair belongs
  // in this deterministic recovery lane.
  return parentHasRefs && taskMissingRefs
}

function isExplicitProofRecovery(task: Task): boolean {
  const proofRecovery = (task as Task & { proofRecovery?: { kind?: unknown } }).proofRecovery
  return proofRecovery?.kind === 'proof'
}

function hasConcreteProofCommand(task: Task): boolean {
  return task.acceptanceCriteria.some((criterion) =>
    typeof criterion !== 'string' &&
    typeof criterion.command === 'string' &&
    isConcreteProjectProofCommand(criterion.command),
  )
}

function needsSourceShapingForScriptProofRecovery(task: Task): boolean {
  if (task.status !== 'spec_review' || !hasActiveProofRecovery(task) || !isExplicitProofRecovery(task)) return false
  return !hasConcreteProofCommand(task) && !hasUsableBlueprint(task)
}

export function repairWeakRecoverySpecReviewSeedInQueue(
  queue: TaskQueue,
  input: { taskId?: string; now: string },
): { taskId: string } | null {
  const liveTask = input.taskId
    ? queue.tasks.find((candidate) => candidate.id === input.taskId)
    : queue.tasks.find((candidate) => shouldRepairWeakRecoverySpecReviewSeed(candidate, queue))
  if (!liveTask || !shouldRepairWeakRecoverySpecReviewSeed(liveTask, queue)) return null
  const seed = buildRecoverySpecSeedForTask(liveTask, queue, input.now)
  if (!seed.references?.length) return null
  if (!seed.productBrief || !validateProductBriefGrounding(liveTask, seed.productBrief).ok) return null

  liveTask.structuredSpec = seed.structuredSpec
  liveTask.spec = seed.spec
  liveTask.acceptanceCriteria = seed.acceptanceCriteria
  liveTask.productBrief = seed.productBrief
  if (seed.workUnitAnalysis) liveTask.workUnitAnalysis = seed.workUnitAnalysis
  if (seed.references) liveTask.references = seed.references
  attachSelectedReleaseToCurrentRecoveryTask(liveTask, queue)
  requestSpecReview(liveTask, {
    authority: 'coordinator',
    requestedAt: input.now,
    requestedBy: 'coordinator-recovery',
    reason: 'recovery',
  })
  liveTask.assignedTo = null
  liveTask.updatedAt = input.now
  if (!Array.isArray(liveTask.notes)) liveTask.notes = []
  liveTask.notes.push({
    agentId: 'coordinator-recovery',
    role: 'system',
    content:
      'Guildhall repaired an under-shaped recovery spec from the current task graph before approval, inheriting source refs and scoped parent acceptance instead of preserving generic recovery text.',
    timestamp: input.now,
  })
  queue.lastUpdated = input.now
  return { taskId: liveTask.id }
}

function attachSelectedReleaseToCurrentRecoveryTask(task: Task, queue: TaskQueue): void {
  if ((task.releaseIds?.length ?? 0) > 0) return
  if (task.status === 'shelved' || task.status === 'archived' || task.status === 'cancelled') return
  const selectedScope = selectedReleaseScopeForQueue(queue)
  if (!selectedScope || selectedScope.kind !== 'release') return
  task.releaseIds = [selectedScope.id]
}

function shouldSeedSourceBackedExploringSplit(task: Task, queue: TaskQueue): boolean {
  if (task.status !== 'exploring') return false
  if (typeof task.spec === 'string' && task.spec.trim().length > 0) return false
  if (task.acceptanceCriteria.length > 0) return false
  if (Array.isArray(task.references) && task.references.length > 0) return false
  const parentId = task.hierarchy?.parentId ?? task.delivery?.supports?.[0]
  if (!parentId) return false
  const parentTask = queue.tasks.find((candidate) => candidate.id === parentId)
  if (!parentTask) return false
  return (
    parentTask.acceptanceCriteria.length > 0 ||
    Boolean(parentTask.spec?.trim()) ||
    (Array.isArray(parentTask.references) && parentTask.references.length > 0)
  )
}

function sourceRecoverySurfaceTerms(task: Task): string[] {
  // Recovery can only use semantic fields written by intake. A model's task
  // title, description, or stale spec is display evidence, never a source of
  // contract identity.
  return uniqueStrings(task.contractNames ?? [])
}

function shouldSeedSourceRecoveryResearchTask(task: Task): boolean {
  if (task.id === META_INTAKE_TASK_ID) return false
  if (task.status !== 'import_draft' && task.status !== 'exploring' && task.status !== 'blocked') return false
  if (task.taskReadiness?.recommendation !== 'needs_research_spike') return false
  if (taskHasUnansweredVisibleQuestion(task)) return false
  if (!['contract', 'fixture', 'evaluation'].includes(task.semanticKind ?? '')) return false
  return sourceRecoverySurfaceTerms(task).length > 0 && (task.references?.length ?? 0) > 0
}

function shouldRepairStaleSourceRecoveryReadiness(task: Task): boolean {
  if (task.id === META_INTAKE_TASK_ID) return false
  if (task.taskReadiness?.recommendation !== 'needs_research_spike') return false
  if (task.status === 'blocked' || task.status === 'exploring') return false
  const surfaces = sourceRecoverySurfaceTerms(task)
  if (surfaces.length === 0) return false
  return ['contract', 'fixture', 'evaluation'].includes(task.semanticKind ?? '')
}

function buildSourceRecoveryResearchSpecSeed(task: Task, now: string): RecoverySpecSeed {
  const taskTitle = semanticTaskTitle(task)
  const surfaces = sourceRecoverySurfaceTerms(task)
  const sourceRefs = Array.isArray(task.references) ? task.references.filter(Boolean) : []
  const sourceTrail = sourceRefs.length > 0
    ? sourceRefs.join(', ')
    : 'the current task import evidence'
  const namedSurfaces = surfaces.length > 0 ? surfaces.join(', ') : 'the named source-backed surface'
  const structuredSpec = StructuredSpec.parse({
    whatThisIs: `Recover the source-backed contract/type surface for ${taskTitle}.`,
    problemContext: `The cited source trail (${sourceTrail}) names ${namedSurfaces}; recovery must preserve those explicit names instead of restarting open-ended research.`,
    goals: [
      'Account for each named source-backed surface as implemented, explicitly created, or explicitly deferred with evidence.',
      'Give implementation a concrete proof target instead of an unnamed contract/type/workflow placeholder.',
    ],
    nonGoals: [
      'Do not expand into unrelated reviewer lanes or later Narrative Harness intelligence work.',
      'Do not ask the owner to re-answer source facts already present in the cited docs or task evidence.',
    ],
    proposedDesign: `Use the cited source trail and existing project surfaces to account for ${namedSurfaces}.`,
    keyDecisions: ['Source recovery is Guildhall-owned shaping from cited evidence; it is not owner approval of stale placeholder text.'],
    acceptanceCriteria: [
      `Given the cited source trail, when this recovery is complete, then Guildhall accounts for ${namedSurfaces} as implemented, explicitly created, or explicitly deferred with source evidence.`,
      `Given the worker handoff, when implementation starts, then proof targets ${namedSurfaces} instead of an unnamed contract/type/workflow placeholder.`,
      'Given the cited docs are insufficient, when the worker cannot prove the surface from source, then Guildhall records the exact missing source fact and reshapes the task without asking the owner to approve stale placeholder text.',
    ],
    verification: [
      'Review the cited source trail and named contract/type/workflow surfaces.',
      'Record implementation, deferral, or missing-source evidence against this task.',
    ],
    completionBoundary: {
      productOutcome: `${taskTitle} has concrete source-backed contract/type/workflow targets and proof evidence.`,
      whatGuildhallCanCompleteInCode: 'Inspect cited docs, update or create repo-local contract/type/workflow records, update proof fixtures/tests, and record evidence.',
      externalDependencies: 'None known from the current task record.',
      ownerOnlySetup: 'None known from the current task record.',
      verificationEnvironment: 'The local project checkout and repo-local package scripts.',
      whatCountsAsDone: 'Each named surface is implemented/proven or explicitly deferred with source evidence, and the proof result is recorded.',
      whatMustBeSplitOrBlocked: 'A newly discovered product decision that changes which surfaces belong in the current scope.',
      splitPolicy: 'conditional',
    },
  })

  return {
    structuredSpec,
    spec: renderStructuredSpecMarkdown(structuredSpec),
    acceptanceCriteria: acceptanceCriteriaFromStructuredSpec(structuredSpec),
    productBrief: {
      userJob: `I want ${taskTitle} to name and prove its source-backed contract/type/workflow targets from the cited docs.`,
      whyItMattersNow: 'This is blocking the current scope because Guildhall must not run implementation from an unnamed contract/type/workflow placeholder.',
      successMetric: `${surfaces.join(' and ')} are accounted for with source evidence and worker-proof targets.`,
      nonGoals: [
        'Do not expand into unrelated reviewer lanes or later Narrative Harness intelligence work.',
        'Do not ask the owner to approve stale placeholder text.',
      ],
      antiPatterns: [
        'Do not preserve hollow contract/type/workflow wording as an approvable spec.',
        'Do not turn source recovery into owner approval when cited docs or task evidence can be inspected.',
      ],
      authoredBy: 'coordinator-recovery',
      authoredAt: now,
    },
    ...(sourceRefs.length > 0 ? { references: sourceRefs } : {}),
  }
}

function readyReadinessForSourceRecoveryTask(task: Task, seed: RecoverySpecSeed, now: string): Task['taskReadiness'] {
  const evidence = sourceRecoverySurfaceTerms(task).map(surface => `Recovered surface: ${surface}`)
  return {
    taskKind: task.taskReadiness?.taskKind ?? task.taskKind ?? 'research',
    recommendation: 'ready',
    summary: 'Source-recovery work has named contract/type/workflow targets and can run without owner approval.',
    dimensions: [
      {
        id: 'outcome_clarity',
        status: 'ok',
        summary: 'The contract/type/workflow targets are named.',
        evidence,
      },
      {
        id: 'proofability',
        status: 'ok',
        summary: 'Acceptance criteria and cited source trail define the proof target.',
        evidence: seed.acceptanceCriteria.map(criterion => criterion.description).slice(0, 2),
      },
      {
        id: 'user_judgment_exposure',
        status: 'ok',
        summary: 'No owner-only judgment is hidden; the task asks Guildhall to inspect source evidence.',
        evidence: [],
      },
    ],
    definitionOfDone: {
      items: [
        ...seed.acceptanceCriteria.map(criterion => criterion.description),
        'The proof result is recorded on the task.',
      ],
      evidenceRequired: [
        'Source-backed contract/type/workflow targets are present.',
        'Proof result references the named surfaces.',
      ],
      updatedAt: now,
      createdBy: 'coordinator-recovery',
    },
    blockerPlans: [
      {
        if: 'The cited docs do not actually prove one of the named surfaces',
        then: 'Record the exact missing source fact and reshape or defer that surface explicitly.',
        owner: 'guildhall',
        reason: 'Source recovery is Guildhall-owned unless a product decision is missing.',
      },
    ],
    contextBudget: {
      estimatedTokens: 2000,
      risk: 'low',
      fitsInOneWorkerBrief: true,
      reasons: ['The task has named surfaces and a short cited source trail.'],
    },
    assessedAt: now,
    assessedBy: 'coordinator-recovery',
  }
}

function isIgnorableCheckpointPath(file: string): boolean {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '')
  return (
    normalized === 'guildhall.yaml' ||
    normalized === 'memory' ||
    normalized.startsWith('memory/') ||
    normalized === '.guildhall' ||
    normalized.startsWith('.guildhall/') ||
    normalized === 'node_modules' ||
    normalized.startsWith('node_modules/') ||
    normalized.includes('/node_modules/') ||
    normalized === '.git' ||
    normalized.startsWith('.git/') ||
    normalized.includes('/.git/')
  )
}

function isTaskStateCheckpointPath(file: string): boolean {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '')
  return (
    normalized === 'TASKS.json' ||
    normalized.endsWith('/TASKS.json') ||
    normalized === 'PROGRESS.md' ||
    normalized.endsWith('/PROGRESS.md') ||
    normalized.includes('/project-state/') ||
    normalized.includes('/project-state-evacuation/')
  )
}

function isLowSignalCheckpointMutationPath(file: string): boolean {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '')
  return (
    isTaskStateCheckpointPath(normalized) ||
    normalized === 'package-lock.json' ||
    normalized.endsWith('/package-lock.json') ||
    normalized === 'npm-shrinkwrap.json' ||
    normalized.endsWith('/npm-shrinkwrap.json') ||
    normalized === 'pnpm-lock.yaml' ||
    normalized.endsWith('/pnpm-lock.yaml') ||
    normalized === 'yarn.lock' ||
    normalized.endsWith('/yarn.lock')
  )
}

function noteLooksLikeStructuredSelfCritique(task: Task): boolean {
  return (task.notes ?? []).some((note) => {
    const structured = readPersistedStructuredSelfCritique(note.structured)
    return (
      note.agentId !== 'human' &&
      isWorkerSelfCritiqueNote(note) &&
      structured !== null &&
      structuredSelfCritiqueMatchesTask(task, structured)
    )
  })
}

function noteLooksLikeReviewProofPacket(task: Task): boolean {
  return (task.notes ?? []).some((note) => {
    if (note.agentId === 'human' || !isWorkerSelfCritiqueNote(note)) return false
    const selfCritique = readPersistedStructuredSelfCritique(note.structured)
    return (
      selfCritique !== null &&
      structuredSelfCritiqueMatchesTask(task, selfCritique) &&
      selfCritique.changedFiles.length > 0 &&
      selfCritique.verificationCommands.some(command => command.status === 'passed')
    )
  })
}

function structuredSelfCritiqueMatchesTask(
  task: Task,
  selfCritique: StructuredSelfCritique,
): boolean {
  const expectedIds = task.acceptanceCriteria.map((criterion) => criterion.id)
  const actualIds = selfCritique.acceptanceCriteria.map((criterion) => criterion.id)
  if (expectedIds.length !== actualIds.length) return false
  const actualSet = new Set(actualIds)
  if (actualSet.size !== actualIds.length) return false
  if (!expectedIds.every((id) => actualSet.has(id))) return false
  if (isProofSetupTask(task)) {
    return proofSetupHasTaskIdentity(task)
  }
  return true
}

function hasActiveEscalationRecoveryCode(task: Task, recoveryCode: string): boolean {
  return (task.escalations ?? []).some((escalation) =>
    !escalation.resolvedAt && escalation.recoveryCode === recoveryCode,
  )
}

function isRecoverableReviewHandoffToolLoop(task: Task): boolean {
  return hasActiveEscalationRecoveryCode(task, 'review_handoff_validator') &&
    noteLooksLikeStructuredSelfCritique(task)
}

function resolveRecoverableReviewHandoffEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    if (escalation.recoveryCode === 'review_handoff_validator') {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution = 'Superseded after the review-handoff validator fix was applied.'
    }
  }
}

function isRecoverableStaleReviewCheckpointBlocker(task: Task): boolean {
  return hasActiveEscalationRecoveryCode(task, 'stale_review_checkpoint') &&
    noteLooksLikeStructuredSelfCritique(task)
}

function resolveRecoverableStaleReviewCheckpointEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    if (escalation.recoveryCode === 'stale_review_checkpoint') {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution =
        'Superseded after Guildhall recognized the stale checkpoint as an already-complete review handoff.'
    }
  }
}

function isRecoverableTurnLimitBlocker(task: Task): boolean {
  return hasActiveEscalationRecoveryCode(task, 'worker_turn_limit')
}

function isRecoverableApprovedSpecTurnLimitBlocker(task: Task): boolean {
  if (!task.productBrief?.approvedAt?.trim()) return false
  return (task.escalations ?? []).some((escalation) =>
    !escalation.resolvedAt &&
    escalation.recoveryCode === 'worker_turn_limit' &&
    escalation.agentId === 'spec-agent',
  )
}

function summarizeImportedDraftSource(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const importedFrom = lines.find((line) => /^Imported from:/i.test(line))
  const whyItMatters = lines.find((line) => /^Why this may matter:/i.test(line))
  return [importedFrom, whyItMatters]
    .filter((line): line is string => Boolean(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 500)
}

function isRecoverableNoProgressBlocker(task: Task): boolean {
  return hasActiveEscalationRecoveryCode(task, 'worker_no_progress')
}

function isRecoverableSpecNoProgressBlocker(task: Task): boolean {
  return hasActiveEscalationRecoveryCode(task, 'spec_no_progress')
}

function isRecoverableToolPathMismatchBlocker(task: Task): boolean {
  return hasActiveEscalationRecoveryCode(task, 'tool_path_mismatch')
}

function isRecoverableTargetShapeMismatchBlocker(task: Task): boolean {
  return hasActiveEscalationRecoveryCode(task, 'target_shape_mismatch')
}

function isRecoverableBlueprintToolingBlocker(task: Task): boolean {
  return hasActiveEscalationRecoveryCode(task, 'blueprint_tooling')
}

function resolveRecoverableBlueprintToolingEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    if (escalation.recoveryCode === 'blueprint_tooling') {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'coordinator'
      escalation.resolution =
        'Foreman inspection resolved this as a stale blueprint/tooling blocker. Planning lanes may inspect evidence and revise the blueprint; they should not be forced to author a stale source path before coordinator review.'
    }
  }
}

function isRecoverableWorkerTimeoutBlocker(task: Task): boolean {
  return hasActiveEscalationRecoveryCode(task, 'worker_timeout_likely_target')
}

function isRecoverableProviderNoProgressTimeoutBlocker(task: Task): boolean {
  return hasActiveEscalationRecoveryCode(task, 'worker_timeout_no_progress')
}

function isRecoverableEnvironmentSetupBlocker(task: Task): boolean {
  return hasActiveEscalationRecoveryCode(task, 'environment_setup')
}

function isRecoverableStaleGateFailureBlocker(task: Task): boolean {
  if (task.status !== 'gate_check') return false
  return hasActiveEscalationRecoveryCode(task, 'stale_gate_failure')
}

function resolveRecoverableStaleGateFailureEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt || escalation.recoveryCode !== 'stale_gate_failure') continue
    escalation.resolvedAt = resolvedAt
    escalation.resolvedBy = 'system'
    escalation.resolution = 'Superseded after Guildhall recognized the stale gate failure as a retryable runtime/provider state.'
  }
}

function resolveRecoverableTurnLimitEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    if (escalation.recoveryCode === 'worker_turn_limit') {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution = 'Superseded after the project was explicitly resumed.'
    }
  }
}

function resolveRecoverableApprovedSpecTurnLimitEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    if (escalation.recoveryCode !== 'worker_turn_limit' || escalation.agentId !== 'spec-agent') continue
    escalation.resolvedAt = resolvedAt
    escalation.resolvedBy = 'system'
    escalation.resolution =
      'Recovered as approved-spec runtime work after Guildhall corrected the earlier worker-lane misclassification.'
  }
}

function resolveRecoverableNoProgressEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    if (escalation.recoveryCode === 'worker_no_progress') {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution = 'Superseded after the project was explicitly resumed from a recoverable no-progress stop.'
    }
  }
}

function resolveRecoverableSpecNoProgressEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    if (escalation.recoveryCode === 'spec_no_progress') {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution =
        'Superseded after Guildhall learned to preserve useful transcript context and retry spec drafting from the last durable notes.'
    }
  }
}

function resolveRecoverableToolPathMismatchEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    if (escalation.recoveryCode === 'tool_path_mismatch') {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution =
        'Superseded after Guildhall corrected task-worktree path/context routing. Reopened for a fresh worker pass.'
    }
  }
}

function resolveRecoverableTargetShapeMismatchEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    if (escalation.recoveryCode === 'target_shape_mismatch') {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution =
        'Superseded after Guildhall routed the target-shape mismatch through source-backed spec shaping.'
    }
  }
}

function resolveRecoverableEnvironmentSetupEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    if (escalation.recoveryCode === 'environment_setup') {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution = 'Superseded after the task worktree install layout was repaired and bootstrap passed.'
    }
  }
}

function isRecoverableSelfAuthoredVerificationEscalation(input: {
  agentName: string
  beforeStatus: TaskStatus
  task: Task
  checkpoint: Checkpoint | null
  touchedFiles?: readonly string[]
  escalation: NonNullable<Task['escalations']>[number]
}): boolean {
  // The worker tool records its escalation as `worker`, while the runtime
  // agent is named `worker-agent`. Both identify the delegated worker lane.
  if (input.agentName !== 'worker-agent' && input.agentName !== 'worker') return false
  if (input.beforeStatus !== 'in_progress') return false
  const proofCommandFailureRepair =
    isProofSetupTask(input.task) &&
    input.task.acceptanceCriteria.some((criterion) => {
      const command = typeof criterion.command === 'string' ? criterion.command.trim() : ''
      if (!command) return false
      const latestGate = latestHardGateResultForId(input.task, criterion.id) ??
        latestHardGateResultForCommand(input.task, command)
      const statefulCriterion = criterion as Task['acceptanceCriteria'][number] & {
        verificationState?: unknown
        persistedMet?: unknown
      }
      return latestGate?.passed === false ||
        statefulCriterion.verificationState === 'stale' ||
        (criterion.met === false && statefulCriterion.persistedMet === true)
    }) &&
    (input.escalation.recoveryCode === undefined ||
      input.escalation.recoveryCode === 'self_authored_verification' ||
      input.escalation.reason === 'spec_ambiguous' ||
      input.escalation.reason === 'gate_hard_failure')
  if (input.escalation.recoveryCode !== 'self_authored_verification' && !proofCommandFailureRepair) return false
  const touchedFiles = input.checkpoint?.filesTouched?.length
    ? input.checkpoint.filesTouched
    : input.touchedFiles ?? []
  const hasRecordedVerificationFailure = checkpointHasRecordedVerificationFailure(
    input.checkpoint?.resumeContext?.verification,
  )
  const proofSetupVerificationRepair =
    isProofSetupTask(input.task) &&
    Boolean(input.checkpoint) &&
    touchedFiles.length > 0
  const typedTargetVerificationRepair =
    input.task.acceptanceCriteria.some((criterion) => typeof criterion.command === 'string' && criterion.command.trim().length > 0) &&
    resolveLikelyTaskFiles(input.task).length > 0
  if (!hasRecordedVerificationFailure && !proofSetupVerificationRepair && !typedTargetVerificationRepair) {
    return proofCommandFailureRepair
  }

  if (touchedFiles.length === 0) return proofCommandFailureRepair
  if (proofSetupVerificationRepair) return true
  return true
}

function isRecoverableSelfAuthoredVerificationBlocker(
  task: Task,
  checkpoint: Checkpoint | null,
  touchedFiles: readonly string[] = [],
): boolean {
  const result = (task.escalations ?? []).some((escalation) => {
    if (escalation.resolvedAt) return false
    return isRecoverableSelfAuthoredVerificationEscalation({
      agentName: escalation.agentId,
      beforeStatus: 'in_progress',
      task,
      checkpoint,
      touchedFiles,
      escalation,
    })
  })
  return result
}

function resolveRecoverableSelfAuthoredVerificationEscalations(
  task: Task,
  checkpoint: Checkpoint | null,
  resolvedAt: string,
  touchedFiles: readonly string[] = [],
): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    if (
      isRecoverableSelfAuthoredVerificationEscalation({
        agentName: escalation.agentId,
        beforeStatus: 'in_progress',
        task,
        checkpoint,
        touchedFiles,
        escalation,
      })
    ) {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution =
        'Superseded because the blocker describes worker-owned verification confusion in files the worker already touched. Guildhall kept the task in automation instead of asking for human guidance.'
    }
  }
}

function resolveRecoverableWorkerTimeoutEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    if (escalation.recoveryCode === 'worker_timeout_likely_target') {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution = 'Superseded after the project was explicitly resumed from the latest recovery checkpoint.'
    }
  }
}

function resolveRecoverableProviderNoProgressTimeoutEscalations(
  task: Task,
  resolvedAt: string,
  resolution =
    'Superseded after Guildhall classified no-output worker timeouts as provider/runtime recovery instead of owner judgment.',
): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    if (escalation.recoveryCode === 'worker_timeout_no_progress') {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution = resolution
    }
  }
}

function activeRecoveryPlaybookMetadata(task: Task): { playbook: string; allowedTools: string[] } {
  for (const note of [...(task.notes ?? [])].reverse()) {
    if (note.role !== 'recovery-playbook') continue
    try {
      const parsed = JSON.parse(note.content) as Record<string, unknown>
      if (parsed['status'] !== 'started') continue
      const playbook = typeof parsed['playbook'] === 'string' &&
        (RECOVERY_PLAYBOOK_IDS as readonly string[]).includes(parsed['playbook'])
        ? parsed['playbook'] as RecoveryPlaybookId
        : null
      if (!playbook) continue
      return {
        playbook,
        allowedTools: recoveryAllowedToolsForPlaybook(playbook),
      }
    } catch {
      continue
    }
  }
  return { playbook: '', allowedTools: [] }
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const normalizedLeft = [...left].map(value => value.trim()).sort()
  const normalizedRight = [...right].map(value => value.trim()).sort()
  return normalizedLeft.every((value, index) => value === normalizedRight[index])
}

function hasPriorAllClearLlmReview(task: Task): boolean {
  const requiredCriteriaIds = task.acceptanceCriteria.map(criterion => criterion.id)
  const result = (task.reviewVerdicts ?? []).some((verdict) =>
    reviewVerdictHasStructuredApproval(verdict, requiredCriteriaIds),
  )
  return result
}

function latestReviewVerdictRound(task: Task): ReviewVerdict[] {
  const verdicts = task.reviewVerdicts ?? []
  if (verdicts.length === 0) return []
  const latestRecordedAt = verdicts.reduce<string>(
    (latest, verdict) => (verdict.recordedAt > latest ? verdict.recordedAt : latest),
    verdicts[0]!.recordedAt,
  )
  return verdicts.filter((verdict) => verdict.recordedAt === latestRecordedAt)
}

function isRecoverableInfraOnlyMaxRevisionBlocker(task: Task): boolean {
  if (
    task.recoveryCode !== 'max_revisions_infrastructure' &&
    task.recoveryCode !== 'max_revisions_actionable' &&
    task.recoveryCode !== 'reviewer_fanout_max_revisions' &&
    !hasActiveEscalationRecoveryCode(task, 'max_revisions_infrastructure') &&
    !hasActiveEscalationRecoveryCode(task, 'max_revisions_actionable') &&
    !hasActiveEscalationRecoveryCode(task, 'reviewer_fanout_max_revisions')
  ) return false
  const revises = latestReviewVerdictRound(task).filter((verdict) => verdict.verdict === 'revise')
  return revises.length > 0 && revises.every((verdict) => reviewVerdictLooksNonSubstantive(verdict))
}

function isRecoverableActionableMaxRevisionBlocker(task: Task): boolean {
  if (
    task.recoveryCode !== 'max_revisions_actionable' &&
    !hasActiveEscalationRecoveryCode(task, 'max_revisions_actionable')
  ) return false
  const revises = latestReviewVerdictRound(task).filter((verdict) => verdict.verdict === 'revise')
  if (revises.length === 0) return false
  return revises.some((verdict) => !reviewVerdictLooksNonSubstantive(verdict))
}

function resolveRecoverableMaxRevisionEscalations(task: Task, resolvedAt: string, resolution: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    if (![
      'max_revisions_infrastructure',
      'max_revisions_actionable',
      'reviewer_fanout_max_revisions',
    ].includes(escalation.recoveryCode ?? '')) continue
    escalation.resolvedAt = resolvedAt
    escalation.resolvedBy = 'system'
    escalation.resolution = resolution
  }
}

function streamEventToBackendEvent(
  event: StreamEvent,
  context: { taskId: string; agentName: string },
): BackendEvent | null {
  switch (event.type) {
    case 'assistant_text_delta':
      return {
        type: 'assistant_delta',
        task_id: context.taskId,
        agent_name: context.agentName,
        message: event.text,
      }
    case 'assistant_turn_complete': {
      const text = streamMessageText(event.message).trim()
      return {
        type: 'assistant_complete',
        task_id: context.taskId,
        agent_name: context.agentName,
        message: text,
        item: { role: 'assistant', text },
      }
    }
    case 'tool_execution_started':
      return {
        type: 'tool_started',
        task_id: context.taskId,
        agent_name: context.agentName,
        tool_name: event.tool_name,
        tool_input: event.tool_input,
        item: {
          role: 'tool',
          text: `${event.tool_name} ${JSON.stringify(event.tool_input ?? {})}`,
          tool_name: event.tool_name,
          tool_input: event.tool_input,
        },
      }
    case 'tool_execution_completed':
      return {
        type: 'tool_completed',
        task_id: context.taskId,
        agent_name: context.agentName,
        tool_name: event.tool_name,
        output: event.output,
        is_error: event.is_error,
        item: {
          role: 'tool_result',
          text: event.output,
          tool_name: event.tool_name,
          is_error: event.is_error,
        },
      }
    case 'status':
      return {
        type: 'line_complete',
        task_id: context.taskId,
        agent_name: context.agentName,
        message: event.message,
        ...(event.statusCode ? { code: event.statusCode } : {}),
      }
    case 'error':
      return {
        type: 'error',
        task_id: context.taskId,
        agent_name: context.agentName,
        message: event.message,
      }
    case 'compact_progress':
      return {
        type: 'compact_progress',
        task_id: context.taskId,
        agent_name: context.agentName,
        message: event.message,
        compact_phase: event.phase,
        compact_trigger: event.trigger,
        attempt: event.attempt,
        compact_checkpoint: event.checkpoint,
        compact_metadata: event.metadata,
      }
  }
}

function streamMessageText(message: { content?: unknown }): string {
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  const parts: string[] = []
  for (const block of message.content) {
    if (block && typeof block === 'object' && 'type' in block && block.type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('')
}

function shouldSkipGitIsolation(
  task: Pick<Task, 'id' | 'status'>,
  agentName?: string,
): boolean {
  return (
    task.id === META_INTAKE_TASK_ID ||
    task.id === WORKSPACE_IMPORT_TASK_ID ||
    (agentName === 'spec-agent' && task.status === 'exploring')
  )
}

function findMetaIntakeDraftText(result: AgentGenerateResult): string | null {
  const candidates = [
    result.text,
    ...(result.messages ?? [])
      .slice()
      .reverse()
      .filter((message) => message.role === 'assistant')
      .map((message) => messageContentText(message.content)),
  ]

  for (const candidate of candidates) {
    const text = candidate.trim()
    if (!text) continue
    if (parseCoordinatorDraft(text)) return text
  }
  return null
}

function messageContentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const entry = block as { type?: unknown; text?: unknown }
      return entry.type === 'text' && typeof entry.text === 'string' ? entry.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function bestExploringAssistantFallbackText(
  messages: ReadonlyArray<{ role?: string; content?: unknown }>,
): string {
  const preferred: string[] = []
  const fallback: string[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const text = messageContentText(message.content).trim()
    if (!text) continue
    fallback.push(text)
    preferred.push(text)
  }
  return preferred.at(-1) ?? fallback.at(-1) ?? ''
}

function bestExploringAssistantFallbackTextForTurn(
  messages: ReadonlyArray<{ role?: string; content?: unknown }>,
  priorMessageCount: number,
): string {
  const turnMessages =
    priorMessageCount > 0 ? messages.slice(priorMessageCount) : messages
  const turnText = bestExploringAssistantFallbackText(turnMessages)
  if (turnText.trim().length > 0) return turnText
  return bestExploringAssistantFallbackText(messages)
}

function combinedExploringAssistantFallbackTextForTurn(
  messages: ReadonlyArray<{ role?: string; content?: unknown }>,
  priorMessageCount: number,
): string {
  const turnMessages = priorMessageCount > 0 ? messages.slice(priorMessageCount) : messages
  const texts: string[] = []
  for (const message of turnMessages) {
    if (message.role !== 'assistant') continue
    const text = messageContentText(message.content).trim()
    if (!text) continue
    texts.push(text)
  }
  return texts.join('\n\n---\n\n')
}

function chooseExploringFallbackTextForTurn(
  messages: ReadonlyArray<{ role?: string; content?: unknown }>,
  priorMessageCount: number,
): string {
  const best = bestExploringAssistantFallbackTextForTurn(messages, priorMessageCount)
  // Assistant prose is audit context only. It cannot be promoted into a
  // brief, question, or other durable planning state because a model's
  // rhetorical style is not a Guildhall contract.
  return best || combinedExploringAssistantFallbackTextForTurn(messages, priorMessageCount)
}

// ---------------------------------------------------------------------------
// Forge Orchestrator
//
// On each tick:
//   1. Read the task queue from disk
//   2. Pick the highest-priority actionable task
//   3. Build JIT context (memory excerpts, recent progress, decisions)
//   4. Route to the appropriate agent based on status
//   5. Re-read the queue to detect what the agent changed
//   6. Update revision counters / detect max-revision blocks
//   7. Append a structured entry to PROGRESS.md
//
// All orchestrator state is derived from disk — each tick is a pure function
// of (queue-on-disk, config). This means the loop can be stopped and restarted
// at any point without losing state.
// ---------------------------------------------------------------------------

/**
 * The subset of GuildhallAgent the orchestrator needs. Having our own interface
 * lets tests inject fakes without spinning up a QueryEngine.
 */
export interface OrchestratorAgent {
  readonly name: string
  readonly messages?: Array<{ role?: string; content?: unknown }>
  readonly calls?: unknown[]
  readonly totalUsage?: {
    input_tokens: number
    output_tokens: number
    cached_input_tokens?: number
  }
  generate(prompt: string): Promise<{
    text: string
    messages?: Array<{ role?: string; content?: unknown }>
  }>
  generateWithEvents?(
    prompt: string,
    onEvent: (event: StreamEvent) => void | Promise<void>,
    opts?: { signal?: AbortSignal | undefined },
  ): Promise<{
    text: string
    messages?: Array<{ role?: string; content?: unknown }>
  }>
  /**
   * FR-15: optional hook called by the orchestrator before `generate()` when
   * the task carries a `permissionMode` override. Agents that ignore this
   * (simple test fakes, etc.) stay at their baseline mode.
   */
  setPermissionMode?(mode: PermissionMode): PermissionMode
  /** Optional recovery hook for clearing a poisoned conversation/session. */
  resetConversation?(): void
  /** Optional observability hook for runtime carryover state. */
  getToolMetadata?(): Record<string, unknown>
  /** Optional preload hook for task-scoped tool metadata. */
  loadToolMetadata?(metadata: Record<string, unknown>): void
  /** Optional provider hint for reusing hosted prompt/KV cache across turns. */
  setPromptCacheKey?(key: string | undefined): void
  /** Optional provider API policy hook for role/model-specific hosted options. */
  setApiRequestOptions?(options: Pick<
    ApiMessageRequest,
    'response_format' | 'reasoning_effort' | 'reasoning' | 'tool_choice'
  > | undefined): void
}

export interface OrchestratorAgentSet {
  spec: OrchestratorAgent
  worker: OrchestratorAgent
  reviewer: OrchestratorAgent
  gateChecker: OrchestratorAgent
  /** Keyed by domain id */
  coordinators: Record<string, OrchestratorAgent>
}

/**
 * Reviewer fan-out runner. Given a task and the applicable reviewer
 * personas, returns one `PersonaVerdict` per persona. The orchestrator
 * aggregates and transitions the task. Production wires a default runner
 * that constructs a `createPersonaReviewerAgent` per persona; tests inject
 * a stub that returns canned verdicts without touching an LLM.
 */
export type ReviewerFanoutRunner = (input: {
  task: Task
  personas: GuildDefinition[]
  reviewPlan?: ReviewPlanRecord
  builtContext: Awaited<ReturnType<typeof buildContext>>
  context: string
  memoryDir: string
  projectPath: string
  visualEvidencePaths?: string[]
}) => Promise<PersonaVerdict[]>

export type { TickOutcome } from './tick-outcome.js'
import type { TickOutcome } from './tick-outcome.js'

export interface OrchestratorRunOptions {
  maxTicks?: number
  tickDelayMs?: number
  stopAfterOneTask?: boolean
  modelAssignmentOverride?: ModelAssignmentConfig
  preferredTaskId?: string
}

export interface OrchestratorRunResult {
  ticks: number
  usage?: {
    input_tokens: number
    output_tokens: number
    cached_input_tokens?: number
  }
  automationResolutionCount?: number
  automationResolutionKinds?: Record<string, number>
  stopReason:
    | 'all_terminal'
    | 'awaiting_human'
    | 'blocked_only'
    | 'dependency_blocked'
    | 'idle_limit'
    | 'stop_requested'
    | 'stop_marker'
    | 'max_ticks'
    | 'one_task'
  stopMessage: string
  idleSummary?: NonNullable<Extract<TickOutcome, { kind: 'idle' }>['summary']>
}

interface OrchestratorTickOptions {
  dispatchLimit?: FanoutCapacity
  preferredTaskId?: string
}

const ONE_TASK_STOP_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  ...(TERMINAL_TASK_STATUSES as readonly TaskStatus[]),
  'pending_pr',
  'spec_review',
])
const EXPLORING_NO_PROGRESS_ESCALATION_AFTER = 3
const WORKER_NO_PROGRESS_ESCALATION_AFTER = 5

function recoveryEventForStatus(status: TaskStatus, currentStatus?: TaskStatus): TaskTransitionEvent {
  if (currentStatus === 'review' && status === 'in_progress') return 'revise'
  switch (status) {
    case 'exploring':
      return 'recover_to_exploring'
    case 'spec_review':
      return 'recover_to_spec_review'
    case 'ready':
      return 'recover_to_ready'
    case 'in_progress':
      return 'recover_to_in_progress'
    case 'review':
      return 'recover_to_review'
    default:
      throw new Error(`No task recovery transition exists for status ${status}`)
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function normalizeFallbackWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function scopedRecoveryContractAcceptance(task: Task): string[] {
  if (task.semanticKind === 'fixture') {
    return [
      '1. Given the Stage 1 fixture harness boundary, when this task is implemented, then the fixture manifest, synthetic author profile, and permission setup can express the tiny fiction fixture without introducing a parallel fixture format.',
      '2. Given human-authored ground truth for the first proof loop, when expected records are reviewed, then they can encode the source facts, expected signals, and evidence references needed to judge generated output.',
      '3. Given the existing Narrative Harness schema files and fixture artifacts, when this work is complete, then fixture and expected-record data are represented in the repo-local TypeScript/JSON surfaces named by the parent evidence.',
      '4. Given the implementation is complete, when the local proof command runs, then Guildhall records the exact command and result against this task before the parent work is treated as satisfied.',
    ]
  }
  if (task.semanticKind === 'evaluation') {
    return [
      '1. Given the Stage 1 prototype-run boundary, when this task is implemented, then the prototype run record captures generated output, packet/context evidence, and trace references without introducing a parallel run format.',
      '2. Given expected signals from the fixture ground truth, when evaluation records are reviewed, then they can report signal matches, misses, stale/noisy findings, and supporting evidence.',
      '3. Given the existing Narrative Harness schema files and run artifacts, when this work is complete, then prototype-run and evaluation data are represented in the repo-local TypeScript/JSON surfaces named by the parent evidence.',
      '4. Given the implementation is complete, when the local proof command runs, then Guildhall records the exact command and result against this task before the parent work is treated as satisfied.',
    ]
  }
  return [
    '1. Given the current schema files and imported parent spec, when this task is implemented, then the repo defines or verifies each relevant contract term listed above without introducing a second parallel contract surface.',
    '2. Given the Stage 1 fixture harness boundary, when fixture and expected-record contracts are reviewed, then they can express a tiny fiction fixture, author/profile permissions, expected records, and expected signals.',
    '3. Given the prototype run and evaluation boundary, when run/evaluation contracts are reviewed, then they capture run output, signal evaluation, packet quality or field usage, and trace evidence needed for the first proof loop.',
    '4. Given the implementation is complete, when the local proof command runs, then Guildhall records the exact command and result against this task before the parent work is treated as satisfied.',
  ]
}

function scopedRecoveryParentAcceptance(task: Task, parentAcceptance: Task['acceptanceCriteria']): string[] {
  const linkedIds = new Set(task.parentAcceptanceCriterionIds ?? [])
  const selected = linkedIds.size > 0
    ? parentAcceptance.filter((criterion) => linkedIds.has(criterion.id))
    : parentAcceptance
  // Unknown or generic imported work must not be classified from its title or
  // criterion prose. With no explicit links, preserve the complete parent
  // boundary instead of silently dropping criteria because a model used
  // different wording.
  return selected.map((criterion) => cleanRecoveryAcceptanceText(criterion.description))
}

function cleanRecoveryAcceptanceText(value: string): string {
  return normalizeFallbackWhitespace(value)
    .replace(/\s*,\s*including privacy manifest says what was included\b/gi, '')
    .replace(/\s*,\s*including affected records become stale\b/gi, '')
    .replace(/\s*,\s*including ([^,.]+)([,.])\s*\1\b/gi, '$2')
    .replace(/\s+/g, ' ')
    .trim()
}

function recoveryProductBriefForChildScope(input: {
  taskTitle: string
  sourceIntent: string
  parentTask?: Task
  inheritedAcceptance: string[]
  outOfScope: string[]
  now: string
}): Task['productBrief'] {
  const source = (input.sourceIntent === input.taskTitle
    ? 'the cited project evidence'
    : input.sourceIntent
  ).replace(/[.。]+$/, '')
  const scopeLine = input.inheritedAcceptance[0] ?? `${input.taskTitle} has a concrete completion boundary.`
  return {
    userJob: `I want ${input.taskTitle} implemented or proven from ${source}.`,
    whyItMattersNow: input.parentTask
      ? `This is one child of "${semanticTaskTitle(input.parentTask)}"; it must prove its own Stage 1 slice without absorbing sibling work.`
      : `This task is inside the current scope and needs a source-backed spec before Guildhall can implement it.`,
    successMetric: scopeLine,
    nonGoals: input.outOfScope.length > 0
      ? input.outOfScope.map((item) => item.replace(/^-\s*/, '').trim()).filter(Boolean)
      : ['Do not ask the owner to re-answer decisions already recorded on the task.'],
    antiPatterns: [
      'Do not preserve stale recovery-loop wording as the task brief.',
      'Do not ask the owner to re-answer decisions already recorded on the task.',
    ],
    authoredBy: 'coordinator-recovery',
    authoredAt: input.now,
  }
}

type RecoverySpecSeed = {
  spec: string
  structuredSpec: NonNullable<Task['structuredSpec']>
  acceptanceCriteria: Task['acceptanceCriteria']
  productBrief: Task['productBrief']
  workUnitAnalysis?: Task['workUnitAnalysis']
  references?: string[]
}

function buildRecoverySpecSeedForTask(liveTask: Task, queue: TaskQueue, now: string): RecoverySpecSeed {
  const answeredDecisions = recoverySpecSeedDecisionTexts(liveTask)
  const taskTitle = semanticTaskTitle(liveTask)
  const sourceIntent = formatRecoverySpecSourceIntent(liveTask.proposalRationale || liveTask.description || taskTitle)
  const parentId = liveTask.hierarchy?.parentId ?? liveTask.delivery?.supports?.[0]
  const parentTask = parentId ? queue.tasks.find((candidate) => candidate.id === parentId) : undefined
  // Recovery may use contract names supplied by the intake adapter, but it
  // must not rediscover them from Markdown or task prose. The adapter owns
  // semantic extraction; this path only consumes its explicit fields.
  const contractTerms = uniqueStrings(
    liveTask.contractNames?.length
      ? liveTask.contractNames
      : parentTask?.contractNames ?? [],
  )
  const parentAcceptance = parentTask?.acceptanceCriteria ?? []
  const contractFocusedSeed =
    contractTerms.length > 0 &&
    (liveTask.semanticKind === 'contract' ||
      liveTask.semanticKind === 'fixture' ||
      liveTask.semanticKind === 'evaluation')
  const scopedContractTerms = contractTerms
  const scopedContractAcceptance = scopedRecoveryContractAcceptance(liveTask)
  const scopedParentAcceptance = scopedRecoveryParentAcceptance(liveTask, parentAcceptance)
  const decisionLines = answeredDecisions.length > 0
    ? answeredDecisions.map((decision) => `- ${decision}`).join('\n')
    : '- No unresolved owner decisions are recorded on the task.'
  const outOfScope = typedScopeNonGoals(liveTask)
  const inheritedAcceptance = scopedParentAcceptance.length > 0
    ? scopedParentAcceptance.slice(0, 5)
    : []
  const inheritedAcceptanceLines = inheritedAcceptance.map((item, index) => `${index + 1}. ${item.replace(/^\d+[.)]\s*/, '')}`)
  const genericAcceptanceLines = inheritedAcceptanceLines.length > 0
    ? inheritedAcceptanceLines
    : [
        `1. Given the current project evidence, when ${taskTitle} is implemented, then the repo-local proof demonstrates that exact child outcome without adding unrelated later-stage work.`,
        '2. Given the parent task boundary, when this task is reviewed, then it satisfies the relevant parent acceptance criteria and leaves sibling child work to its own task.',
        '3. Given the implementation is complete, when the local proof command runs, then Guildhall records the command and result against this task.',
      ]
  const structuredSpec = StructuredSpec.parse({
    whatThisIs: contractFocusedSeed
      ? `Define the concrete ${taskTitle} surface for this Stage 1 harness work.`
      : `${taskTitle} from the current project evidence, preserving the source intent.`,
    problemContext: [
      sourceIntent,
      parentTask?.title ? `Containing work: ${semanticTaskTitle(parentTask)}.` : '',
      inheritedAcceptance.length > 0
        ? `This child satisfies: ${inheritedAcceptance.join(' ')}`
        : '',
      scopedContractTerms.length > 0
        ? `Contract terms to account for: ${scopedContractTerms.join(', ')}.`
        : '',
    ].filter(Boolean).join(' '),
    goals: contractFocusedSeed
      ? [
          `Define or verify the concrete ${taskTitle} surface without restarting open-ended research.`,
          'Preserve the imported parent boundary and record proof for the named contract surface.',
        ]
      : [
          `Implement or verify the bounded outcome represented by ${taskTitle}.`,
          'Preserve the visible source boundary and record evidence for the result.',
        ],
    nonGoals: contractFocusedSeed
      ? [
          'Do not introduce Rust contracts for this TypeScript project.',
          'Do not add UI copy or API endpoints for this contract-only child task.',
          'Do not expand into later-stage story intelligence beyond the contracts named by the parent evidence.',
        ]
      : outOfScope.length > 0
        ? outOfScope.map((item) => item.replace(/^[-*]\s+/, '').trim()).filter(Boolean)
        : ['Work not implied by the source evidence or resolved owner decisions.'],
    proposedDesign: contractFocusedSeed
      ? `Use the existing Narrative Harness TypeScript/JSON surfaces for ${scopedContractTerms.join(', ') || 'the named contract terms'}; preserve one authoritative contract surface and add only the proof fixtures or scripts required by this child.`
      : 'Use the project surfaces named by the source evidence and keep any newly discovered decision or dependency as explicit follow-up work.',
    keyDecisions: answeredDecisions.length > 0
      ? answeredDecisions
      : ['No unresolved owner decisions are recorded on the current task.'],
    acceptanceCriteria: contractFocusedSeed ? scopedContractAcceptance : genericAcceptanceLines,
    verification: contractFocusedSeed
      ? [
          'Review the named TypeScript/JSON contract surfaces and their proof fixtures.',
          'Run the repo-local proof command and record its result against this task.',
        ]
      : [
          'Review the changed project surface against the visible source evidence.',
          'Record the observed result in the task proof or review evidence.',
        ],
    completionBoundary: {
      productOutcome: contractFocusedSeed
        ? `${taskTitle} is represented by concrete TypeScript schema/record contracts and proof evidence in the Narrative Harness project.`
        : `The bounded outcome for ${taskTitle} is implemented or verified in the intended project surface.`,
      whatGuildhallCanCompleteInCode: contractFocusedSeed
        ? 'Schema/type updates, fixture or evaluation record updates, exports, and local proof scripts/tests needed for this child work.'
        : 'Repo-local implementation, tests, documentation, and evidence needed by the bounded work.',
      externalDependencies: 'None known from the current task record.',
      ownerOnlySetup: 'None known from the current task record.',
      verificationEnvironment: 'The local project checkout and repo-local package scripts.',
      whatCountsAsDone: contractFocusedSeed
        ? 'The named contract terms are defined or verified, acceptance criteria are checked, and the proof result is recorded.'
        : 'The scoped acceptance criteria are satisfied and the observed result is recorded.',
      whatMustBeSplitOrBlocked: contractFocusedSeed
        ? 'A newly discovered product decision that changes which contracts belong in Stage 1 versus a later stage.'
        : 'Sibling parent criteria, external setup, or a newly discovered product decision that cannot be resolved from current evidence.',
      splitPolicy: 'conditional',
    },
  })
  const inheritedParentReferences =
    parentTask &&
    (!Array.isArray(liveTask.references) || liveTask.references.length === 0) &&
    Array.isArray(parentTask.references) &&
    parentTask.references.length > 0
      ? parentTask.references
      : undefined

  return {
    structuredSpec,
    spec: renderStructuredSpecMarkdown(structuredSpec),
    acceptanceCriteria: acceptanceCriteriaFromStructuredSpec(structuredSpec),
    productBrief: recoveryProductBriefForChildScope({
      taskTitle,
      sourceIntent,
      parentTask,
      inheritedAcceptance: inheritedAcceptance.length > 0
        ? inheritedAcceptance
        : genericAcceptanceLines.map((line) => line.replace(/^\d+[.)]\s*/, '')),
      outOfScope,
      now,
    }),
    ...(inheritedParentReferences ? { references: inheritedParentReferences } : {}),
  }
}

function shouldStopOneTaskRun(outcome: TickOutcome): boolean {
  switch (outcome.kind) {
    case 'processed':
      return Boolean(outcome.waitingOnUser) || ONE_TASK_STOP_STATUSES.has(outcome.afterStatus)
    case 'proposal-decided':
    case 'pre-rejection-applied':
      return ONE_TASK_STOP_STATUSES.has(outcome.newStatus)
    case 'blocked-max-revisions':
    case 'no-coordinator':
    case 'agent-error':
    case 'provider-backoff':
    case 'escalated':
    case 'bootstrap-required':
      return true
    case 'idle':
    case 'batch':
      return false
  }
}

function describeOneTaskStop(outcome: TickOutcome): string {
  if (outcome.kind === 'provider-backoff') {
    return `task ${outcome.taskId} (provider_backoff)`
  }
  if ('taskId' in outcome) return `task ${outcome.taskId} (${outcome.kind})`
  return outcome.kind
}

function shouldContinueSelectedTaskClosure(
  outcome: TickOutcome,
  preferredTaskId: string | undefined,
  tasks: Task[],
): boolean {
  if (!preferredTaskId || !('taskId' in outcome) || outcome.taskId === preferredTaskId) return false
  if (outcome.kind !== 'processed') return false
  if (outcome.waitingOnUser) return false
  if (
    outcome.afterStatus !== 'spec_review' &&
    outcome.afterStatus !== 'done' &&
    outcome.afterStatus !== 'pending_pr'
  ) return false
  if (
    outcome.afterStatus === 'spec_review' &&
    specReviewIsReadyForOwnerApproval(tasks.find(task => task.id === outcome.taskId) ?? { id: outcome.taskId })
  ) {
    return false
  }
  return workSubtreeIds(tasks, preferredTaskId).includes(outcome.taskId)
}

function isSelectedTaskClosureDone(task: Task): boolean {
  return task.status === 'done' || task.status === 'pending_pr' || task.status === 'shelved'
}

function stopResultFromIdle(
  outcome: Extract<TickOutcome, { kind: 'idle' }>,
  idleLimit: number,
): OrchestratorRunResult {
  if (outcome.allDone) {
    return {
      ticks: 0,
      stopReason: outcome.summary?.reason === 'all_terminal' ? 'all_terminal' : 'blocked_only',
      stopMessage: outcome.summary?.message ?? 'No actionable tasks remain.',
      ...(outcome.summary ? { idleSummary: outcome.summary } : {}),
    }
  }
  if (outcome.consecutiveIdleTicks > idleLimit) {
    return {
      ticks: 0,
      stopReason:
        outcome.summary?.reason === 'awaiting_human'
          ? 'awaiting_human'
          : outcome.summary?.reason === 'dependency_blocked'
            ? 'dependency_blocked'
            : outcome.summary?.reason === 'blocked_only'
              ? 'blocked_only'
              : 'idle_limit',
      stopMessage:
        outcome.summary?.message ??
        `No actionable tasks for ${idleLimit} ticks. Shutting down.`,
      ...(outcome.summary ? { idleSummary: outcome.summary } : {}),
    }
  }
  return {
    ticks: 0,
    stopReason: 'idle_limit',
    stopMessage: `No actionable tasks for ${idleLimit} ticks. Shutting down.`,
    ...(outcome.summary ? { idleSummary: outcome.summary } : {}),
  }
}

function taskHasDraftEvidence(task: Task): boolean {
  return (
    task.acceptanceCriteria.length > 0 ||
    Boolean(task.productBrief) ||
    task.notes.some(note => note.role === 'spec' || note.agentId === 'spec-agent')
  )
}

function taskHasUnansweredUserQuestion(task: Task): boolean {
  return taskHasUnansweredVisibleQuestion(task)
}

function resumableTaskIdsForLabel(label: string, queue: TaskQueue): string[] {
  if (label === 'spec') {
    return queue.tasks
      .filter((task) =>
        task.status === 'exploring' ||
        (task.status === 'spec_review' && !task.spec?.trim() && taskHasDraftEvidence(task)) ||
        ((task.status === 'ready' || task.status === 'in_progress') &&
          taskHasDraftEvidence(task) &&
          !task.spec?.trim()),
      )
      .map((task) => task.id)
  }

  if (label === 'worker') {
    return queue.tasks
      .filter((task) => task.status === 'in_progress' && task.assignedTo === 'worker-agent')
      .map((task) => task.id)
  }

  if (label === 'reviewer') {
    return queue.tasks
      .filter((task) => task.status === 'review' && task.assignedTo === 'reviewer-agent')
      .map((task) => task.id)
  }

  if (label === 'gate-checker') {
    return queue.tasks
      .filter((task) => task.status === 'gate_check' && task.assignedTo === 'gate-checker-agent')
      .map((task) => task.id)
  }

  if (label.startsWith('coordinator-')) {
    const domain = label.slice('coordinator-'.length)
    return queue.tasks
      .filter((task) =>
        task.domain === domain &&
        (task.status === 'spec_review' || task.status === 'ready'),
      )
      .map((task) => task.id)
  }

  return []
}

export function shouldResumeAgentSession(
  label: string,
  queue: TaskQueue,
): boolean {
  return resumableTaskIdsForLabel(label, queue).length > 0
}

export function isSessionSnapshotFreshForTask(
  snapshot: SessionSnapshot | null | undefined,
  task: Task | null | undefined,
  opts: {
    expectedTaskProjectPath?: string
    expectedSuccessGates?: readonly string[]
  } = {},
): boolean {
  if (!snapshot || !task) return false
  const snapshotTaskId = String(snapshot.tool_metadata?.['current_task_id'] ?? '').trim()
  if (!snapshotTaskId || snapshotTaskId !== task.id) return false

  const taskUpdatedMs = Date.parse(task.updatedAt)
  const snapshotCreatedMs = snapshot.created_at * 1000
  if (Number.isFinite(taskUpdatedMs) && Number.isFinite(snapshotCreatedMs) && snapshotCreatedMs < taskUpdatedMs) {
    return false
  }

  if (opts.expectedTaskProjectPath) {
    const snapshotTaskProjectPath = String(
      snapshot.tool_metadata?.['current_task_project_path'] ?? '',
    ).trim()
    if (snapshotTaskProjectPath !== opts.expectedTaskProjectPath) return false
  }

  if (opts.expectedSuccessGates !== undefined) {
    const snapshotSuccessGates = Array.isArray(snapshot.tool_metadata?.['current_task_success_gates'])
      ? (snapshot.tool_metadata?.['current_task_success_gates'] as unknown[])
          .filter((value): value is string => typeof value === 'string')
      : []
    if (JSON.stringify(snapshotSuccessGates) !== JSON.stringify([...opts.expectedSuccessGates])) {
      return false
    }
  }

  return true
}

export interface OrchestratorOptions {
  config: ResolvedConfig
  agents: OrchestratorAgentSet
  providerName?: ProviderName
  domainFilter?: string
  /** Injectable clock for deterministic tests */
  now?: () => string
  /** After this many consecutive idle ticks, run() shuts down */
  idleShutdownAfterTicks?: number
  /**
   * FR-18: optional hook executor. When present, the orchestrator fires
   * SESSION_START at the top of `run()` and SESSION_END before it returns.
   * Per-agent hook firing (PRE_TOOL_USE, etc.) happens inside each agent's
   * QueryEngine, which receives the same executor via the agent factory.
   */
  hookExecutor?: HookExecutor
  /**
   * FR-30: optional liveness tracker. When supplied, the orchestrator
   * registers/unregisters the agent around each `generate()` call so the
   * FR-32 remediation loop and any observability consumer can ask whether
   * the agent is silent past the `agent_health_strictness` threshold.
   *
   * For in-process agents, registration alone is sufficient: `generate()`
   * is a single blocking call, so silence is detected by a watchdog running
   * off the tick loop (e.g. the serve layer). Out-of-process workers
   * (FR-24) will touch the tracker per stdout event.
   *
   * When omitted, the orchestrator constructs an internal tracker keyed on
   * the current lever position so `scanStalls()` / `liveness` still work.
   */
  liveness?: LivenessTracker
  /**
   * Optional subscriber called once per emitted backend event (tick outcomes
   * translated via `tickOutcomeToBackendEvent`, agent-issues translated via
   * `agentIssueToBackendEvent`). The serve layer wires this into a per-
   * workspace SSE stream so the dashboard can watch ticks in real time.
   *
   * Exceptions from the subscriber are caught and logged — they must not
   * break the run loop.
   */
  onBackendEvent?: (event: BackendEvent) => void | Promise<void>
  /**
   * Optional flag the serve layer flips to request a graceful stop between
   * ticks. The orchestrator polls it after each tick's event drain and
   * exits before the next `sleep(tickDelayMs)`. Useful because the
   * supervisor doesn't want to cancel an in-flight `generate()` call.
   */
  stopSignal?: { stopRequested: boolean }
  /**
   * Abort signal used for in-flight model/tool turns. Unlike stopSignal,
   * this can interrupt a provider fetch while a tick is still active.
   */
  abortSignal?: AbortSignal | undefined
  /**
   * FR-24 / FR-25: git driver used for worktree + merge operations. Defaults
   * to `NodeGitDriver` (shells out to `git` + `gh`). Tests inject
   * `InMemoryGitDriver` so the tick loop can be exercised without touching a
   * real repo.
   */
  gitDriver?: GitDriver
  /**
   * Optional reviewer fan-out runner. When supplied, at `review` the
   * orchestrator runs one LLM call per applicable reviewer persona (each
   * through its own lens) instead of dispatching a single generic reviewer.
   * Verdicts aggregate under a strict-all policy: any revise bounces the
   * task to `in_progress` with combined feedback.
   *
   * When absent, the legacy single-reviewer dispatch runs unchanged.
  */
  reviewerFanout?: ReviewerFanoutRunner
  /** Optional review audit store used to persist review plans before work review runs. */
  reviewAuditStore?: ReviewAuditStore
  /** Optional inactivity timeout for a single agent turn. */
  agentGenerateTimeoutMs?: number
  /** Optional total wall-clock timeout for a single agent turn, even if it streams events. */
  agentGenerateWallClockTimeoutMs?: number | Partial<Record<
    'spec' | 'coordinator' | 'worker' | 'reviewer' | 'gateChecker' | 'contextIndexer',
    number
  >>
}

const DEFAULT_IDLE_SHUTDOWN = 10
const DEFAULT_AGENT_GENERATE_TIMEOUT_MS = 60_000
const DEFAULT_LONGFORM_AGENT_GENERATE_TIMEOUT_MS = 120_000
const STALE_EXPLORING_SPEC_CLAIM_MS = 10 * 60_000

function resolveAgentGenerateTimeoutMs(
  agentName: string,
  configuredMs: number | undefined,
): number {
  if (configuredMs != null) return Math.max(100, Math.floor(configuredMs))
  if (agentName === 'reviewer-agent' || agentName.startsWith('reviewer-persona-')) {
    return DEFAULT_AGENT_GENERATE_TIMEOUT_MS
  }
  return DEFAULT_LONGFORM_AGENT_GENERATE_TIMEOUT_MS
}

function hasStaleExploringSpecClaim(
  task: Pick<Task, 'id' | 'status' | 'assignedTo' | 'updatedAt'>,
  nowMs: number,
  liveSpecTaskIds: ReadonlySet<string>,
): boolean {
  if (task.status !== 'exploring' || task.assignedTo !== 'spec-agent') return false
  if (liveSpecTaskIds.has(task.id)) return false
  const updatedAtMs = typeof task.updatedAt === 'string' ? Date.parse(task.updatedAt) : Number.NaN
  return Number.isFinite(updatedAtMs) && nowMs - updatedAtMs >= STALE_EXPLORING_SPEC_CLAIM_MS
}

function resolveAgentGenerateWallClockTimeoutMs(
  agentName: string,
  configured: OrchestratorOptions['agentGenerateWallClockTimeoutMs'],
  defaultMs?: number,
): number | undefined {
  if (configured == null) {
    return agentName === 'worker-agent' && defaultMs != null
      ? Math.max(100, Math.floor(defaultMs))
      : undefined
  }
  if (typeof configured === 'number') return Math.max(100, Math.floor(configured))
  const role = roleForAgentName(agentName)
  const value = configured[role as keyof typeof configured]
  return value == null ? undefined : Math.max(100, Math.floor(value))
}

function agentInactivityTimeoutMessage(agentName: string, timeoutMs: number): string {
  return `${agentName} timed out after ${timeoutMs}ms of inactivity`
}

function agentWallClockTimeoutMessage(agentName: string, timeoutMs: number): string {
  return `${agentName} exceeded ${timeoutMs}ms total turn budget`
}

type CheckpointResumeContext = NonNullable<Checkpoint['resumeContext']>

export function taskExplicitlyOwnsBootstrapRepair(task: Task): boolean {
  // Proof setup is Guildhall-owned execution work. Its first useful action
  // may be repairing the project bootstrap itself, so a failed setup gate
  // must reach the worker instead of becoming a human environment blocker.
  return task.bootstrapRepairOwnership === 'task' ||
    isProofSetupTask(task) ||
    isExplicitProofRecovery(task)
}

function uniqueNonEmptyStrings(values: Iterable<string>): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    ordered.push(trimmed)
  }
  return ordered
}

function checkpointVerificationHistoryFromMetadata(
  metadata: Record<string, unknown> | undefined,
): CheckpointResumeContext['verification'] {
  const raw = metadata?.['current_task_verification_history']
  if (!Array.isArray(raw)) return []
  return raw
    .filter((entry): entry is CheckpointResumeContext['verification'][number] => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
      const rec = entry as Record<string, unknown>
      return (
        typeof rec['command'] === 'string' &&
        typeof rec['passed'] === 'boolean' &&
        typeof rec['observedAt'] === 'string'
      )
    })
    .map((entry) => ({
      command: entry.command.trim(),
      passed: entry.passed,
      observedAt: entry.observedAt,
      ...(typeof entry.summary === 'string' && entry.summary.trim()
        ? { summary: entry.summary.trim() }
        : {}),
    }))
    .filter((entry) => entry.command.length > 0)
    .slice(-6)
}

function checkpointCompanionFilesFromMetadata(
  metadata: Record<string, unknown> | undefined,
  projectRoot: string,
  filesTouched: readonly string[],
): string[] {
  const touched = new Set(
    filesTouched.map((file) =>
      path.resolve(path.isAbsolute(file) ? file : path.join(projectRoot, file)),
    ),
  )
  const likelyTargets = Array.isArray(metadata?.['current_task_likely_target_files'])
    ? (metadata?.['current_task_likely_target_files'] as unknown[])
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  const readFilePaths = Array.isArray(metadata?.['read_file_state'])
    ? (metadata?.['read_file_state'] as unknown[])
        .map((entry) => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ''
          return typeof (entry as Record<string, unknown>)['path'] === 'string'
            ? String((entry as Record<string, unknown>)['path']).trim()
            : ''
        })
        .filter(Boolean)
    : []

  return uniqueNonEmptyStrings([...readFilePaths, ...likelyTargets])
    .filter((candidate) => {
      const resolved = path.resolve(candidate)
      return !touched.has(resolved) && !isTaskStateCheckpointPath(candidate)
    })
    .slice(0, 8)
}

function checkpointSafeNextMutationSurface(
  filesTouched: readonly string[],
  companionFiles: readonly string[],
  verification: CheckpointResumeContext['verification'] = [],
): string[] {
  const preferredTouched = filesTouched.filter((file) => !isLowSignalCheckpointMutationPath(file))
  const preferredCompanions = companionFiles.filter((file) => !isTaskStateCheckpointPath(file))
  const fallbackTouched = filesTouched.filter((file) => !isTaskStateCheckpointPath(file))
  const primary = uniqueNonEmptyStrings(
    preferredTouched.length > 0
      ? preferredTouched
      : preferredCompanions.length > 0
        ? preferredCompanions
        : fallbackTouched.length > 0
          ? fallbackTouched
          : companionFiles,
  )
  const hasFailedVerification = checkpointHasRecordedVerificationFailure(verification)
  const rank = (candidate: string): number => {
    const normalized = candidate.replace(/\\/g, '/')
    if (hasFailedVerification && /\.(?:ts|tsx|js|jsx|vue)$/i.test(normalized) && !/\.(?:test|spec)\.[^.]+$/i.test(normalized)) return 0
    if (hasFailedVerification && /\.(?:test|spec)\.[^.]+$/i.test(normalized)) return 1
    if (/\.(?:test|spec)\.[^.]+$/i.test(normalized)) return 0
    if (/\.(?:ts|tsx|js|jsx|vue)$/i.test(normalized)) return 1
    if (/\/src\/|\/test\/|\/tests\//i.test(normalized)) return 2
    if (/package\.json$/i.test(normalized)) return 4
    if (/\.gitignore$/i.test(normalized)) return 5
    return 3
  }

  return [...primary]
    .sort((left, right) => {
      const delta = rank(left) - rank(right)
      return delta !== 0 ? delta : left.localeCompare(right)
    })
    .slice(0, 6)
}

function checkpointWorkingHypothesis(input: {
  existing: string
  verification: CheckpointResumeContext['verification']
  companionFiles: readonly string[]
  safeNextMutationSurface: readonly string[]
}): string | undefined {
  const existing = input.existing.trim()
  const focusSurface = input.safeNextMutationSurface.slice(0, 3)
  const companions = input.companionFiles.slice(0, 2)
  const latestVerification = input.verification[input.verification.length - 1]
  if (existing) {
    const mentionsCurrentFocus =
      focusSurface.length === 0 ||
      focusSurface.some((file) => existing.includes(file) || existing.includes(path.basename(file)))
    if (mentionsCurrentFocus) {
      return existing
    }
  }
  if (latestVerification) {
    const focusText =
      focusSurface.length > 0
        ? `Focus the next change on ${focusSurface.join(', ')}`
        : 'Keep the next change tightly scoped to the files already under active work'
    const companionText =
      companions.length > 0
        ? ` while using ${companions.join(', ')} as the supporting context`
        : ''
    return latestVerification.passed
      ? `${focusText}${companionText}. The last authoritative verification passed (${latestVerification.command}); move directly toward a durable handoff unless a new blocker appears.`
      : `${focusText}${companionText}. The last authoritative verification failed (${latestVerification.command}); repair the remaining failure before broadening scope.`
  }
  if (focusSurface.length > 0) {
    return `The safest next mutation surface is ${focusSurface.join(', ')}. Stay inside that surface until focused verification says the task is genuinely clear again.`
  }
  return undefined
}

function taskRelativeCheckpointPath(candidate: string, repoRoot: string): string {
  const trimmed = candidate.trim()
  if (!trimmed) return ''
  if (!path.isAbsolute(trimmed)) return trimmed
  const relative = path.relative(path.resolve(repoRoot), path.resolve(trimmed))
  if (
    relative &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  ) {
    return relative
  }
  return trimmed
}

function renderImmediateResumeInstructions(
  task: Task,
  agentName: string,
  checkpoint: Checkpoint | null,
  checkpointNextAction = '',
  taskProjectPath = '',
  activeWorktreePath = '',
): string {
  if (agentName !== 'worker-agent' || task.status !== 'in_progress') return ''
  const normalizedCheckpoint = checkpointNextAction.trim()
  const latestAcceptanceGateFailure = latestAcceptanceCommandGateFailure(task)
  if (
    !latestAcceptanceGateFailure &&
    noteLooksLikeStructuredSelfCritique(task) &&
    noteLooksLikeReviewProofPacket(task)
  ) {
    return [
      '### Immediate Resume Instructions',
      'You are resuming an in-progress task that already has durable verification proof and a structured self-critique.',
      normalizedCheckpoint ? `The latest checkpoint says: ${normalizedCheckpoint}` : '',
      'Do not reopen files first. Your first action should be the exact handoff: transition the task to review with update-task, or raise-escalation if that handoff is no longer valid.',
      'Only return to file reads or broader verification if the handoff truly cannot be completed and you have explained why.',
    ].filter(Boolean).join('\n')
  }
  if (checkpoint?.nextActionKind === 'review_handoff') {
    const hasSelfCritique = noteLooksLikeStructuredSelfCritique(task)
    return [
      '### Immediate Resume Instructions',
      'You are resuming an in-progress task that is already at the review handoff stage.',
      `The latest checkpoint says: ${normalizedCheckpoint}`,
      hasSelfCritique
        ? 'Do not reopen files first. Your first action should be the exact handoff: transition the task to review, or raise-escalation if that handoff is no longer valid.'
        : 'Do not reopen files first. Your first action should be to persist the structured self-critique note with update-task, then hand off to review, or raise-escalation if the checkpoint is no longer valid.',
      'Only return to file reads or broader verification if the handoff truly cannot be completed and you have explained why.',
    ].join('\n')
  }
  const resumeSurface = checkpoint?.resumeContext?.safeNextMutationSurface?.slice(0, 4) ?? []
  const likelyFiles = resolveLikelyTaskFiles(task).slice(0, 4)
  const targetFiles = (resumeSurface.length > 0 ? resumeSurface : likelyFiles)
    .map((file) => mapResumeTargetFileToWorktree(file, taskProjectPath, activeWorktreePath))
  if (targetFiles.length === 0) return ''
  const latestVerification = checkpoint?.resumeContext?.verification?.[checkpoint.resumeContext.verification.length - 1]
  const latestRejectionIndex = findLatestWorkerSelfCritiqueRejectionIndex(task)
  const latestSelfCritiqueIndex = findLatestWorkerSelfCritiqueIndex(task)
  const previousProofWasRejected =
    latestRejectionIndex >= 0 && latestRejectionIndex > latestSelfCritiqueIndex
  return [
    '### Immediate Resume Instructions',
    'You are resuming an in-progress coding task.',
    ...(previousProofWasRejected || latestAcceptanceGateFailure
      ? [
          latestAcceptanceGateFailure
            ? `Acceptance command gates failed on the last gate-check pass: ${latestAcceptanceGateFailure.content.split('\n').slice(0, 3).join(' ')}`
            : 'Previous worker proof was rejected because it claimed completion without project-file changes.',
          'Your next action must be a concrete file mutation in the likely target file or a focused verification command that proves the target file already satisfies the spec.',
          'Do not write another self-critique, mark acceptance criteria as met, or attempt a review handoff until after that mutation or authoritative verification.',
        ]
      : []),
    ...(checkpoint?.resumeContext?.workingHypothesis
      ? [`Working hypothesis: ${checkpoint.resumeContext.workingHypothesis}`]
      : []),
    ...(latestVerification
      ? [
          `Latest authoritative verification: ${latestVerification.command} (${latestVerification.passed ? 'passed' : 'failed'})${latestVerification.summary ? ` — ${latestVerification.summary}` : ''}.`,
        ]
      : []),
    'Open or edit these files before any directory listing or broad globbing:',
    ...targetFiles.map((file) => `- ${file}`),
    'If one of these likely target files does not exist yet, first verify that its parent directory matches the existing project structure. Create it only when the parent path is real and convention-compatible; otherwise inspect the nearest existing companion file or raise-escalation with the path mismatch.',
    'After you have the needed file contents, your next step should be a concrete mutation or a focused verification command tied to those files.',
    'Do not use list-files, glob, or generic repo-root shell inspection until you have attempted that mutation or focused verification.',
  ].join('\n')
}

function latestAcceptanceCommandGateFailure(task: Task): Task['notes'][number] | undefined {
  return [...task.notes]
    .reverse()
    .find((note) =>
      note.agentId === 'acceptance-command-gates' &&
      note.role === 'gate-checker' &&
      note.structured?.event === 'acceptance_command_gates_failed',
    )
}

function acceptanceCommandGateFailureIsNewerThanSelfCritique(task: Task): boolean {
  const failure = latestAcceptanceCommandGateFailure(task)
  const selfCritique = [...task.notes]
    .reverse()
    .find((note) => note.agentId === 'worker-agent' && note.role === 'self-critique')
  return Boolean(
    failure &&
    selfCritique &&
    Date.parse(failure.timestamp) > Date.parse(selfCritique.timestamp),
  )
}

function mapResumeTargetFileToWorktree(file: string, taskProjectPath: string, activeWorktreePath: string): string {
  const trimmed = file.trim()
  if (!trimmed || !path.isAbsolute(trimmed)) return file
  const projectRoot = taskProjectPath.trim()
  const worktreeRoot = activeWorktreePath.trim()
  if (!projectRoot || !worktreeRoot) return file
  const resolvedProjectRoot = path.resolve(projectRoot)
  const resolvedWorktreeRoot = path.resolve(worktreeRoot)
  if (resolvedProjectRoot === resolvedWorktreeRoot) return file
  const relative = path.relative(resolvedProjectRoot, path.resolve(trimmed))
  if (
    relative &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  ) {
    return path.join(resolvedWorktreeRoot, relative)
  }
  return file
}

function shouldUseCheckpointForTask(task: Task, checkpoint: Checkpoint | null): checkpoint is Checkpoint {
  if (!checkpoint) return false
  if (checkpointIsFreshForTask(task, checkpoint)) return true
  return task.notes.some((note) => {
    if (note.role !== 'recovery') return false
    const noteAt = Date.parse(note.timestamp)
    const checkpointAt = Date.parse(checkpoint.writtenAt)
    return (
      Number.isFinite(noteAt) &&
      Number.isFinite(checkpointAt) &&
      noteAt >= checkpointAt &&
      note.structured?.event === 'recovery_checkpoint_direction'
    )
  })
}

function cloneTaskQueue(queue: TaskQueue): TaskQueue {
  return JSON.parse(JSON.stringify(queue)) as TaskQueue
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function singleTaskQueueDelta(
  baseline: TaskQueue | null,
  queue: TaskQueue,
): { baselineTask: Task; nextTask: Task } | null {
  if (!baseline || baseline.version !== queue.version) return null
  if (!sameJson(baseline.executionPlanActions ?? [], queue.executionPlanActions ?? [])) return null
  if (!sameJson(baseline.scopeAuthorityRequests ?? [], queue.scopeAuthorityRequests ?? [])) return null
  if (!sameJson(baseline.releases ?? [], queue.releases ?? [])) return null
  if (baseline.selectedReleaseId !== queue.selectedReleaseId) return null
  if (baseline.tasks.length !== queue.tasks.length) return null

  const baselineTasks = new Map(baseline.tasks.map(task => [task.id, task]))
  const nextTasks = new Map(queue.tasks.map(task => [task.id, task]))
  if (baselineTasks.size !== baseline.tasks.length || nextTasks.size !== queue.tasks.length) return null
  if ([...baselineTasks.keys()].some(taskId => !nextTasks.has(taskId))) return null

  const changedTaskIds = [...baselineTasks.keys()].filter(taskId =>
    !sameJson(baselineTasks.get(taskId), nextTasks.get(taskId)),
  )
  if (changedTaskIds.length !== 1) return null
  const changedTaskId = changedTaskIds[0]
  const baselineTask = baselineTasks.get(changedTaskId!)
  const nextTask = nextTasks.get(changedTaskId!)
  if (!baselineTask || !nextTask) return null

  return { baselineTask, nextTask }
}

function applyDefinitionDelta(
  currentTask: Record<string, unknown>,
  definitionBaselineTask: Record<string, unknown>,
  nextTask: Record<string, unknown>,
  mutationBaselineTask: Record<string, unknown> = definitionBaselineTask,
): Record<string, unknown> | null {
  const parsedCurrent = Task.safeParse(currentTask)
  const comparableCurrent = parsedCurrent.success
    ? parsedCurrent.data as unknown as Record<string, unknown>
    : currentTask
  const changedKeys = new Set([
    ...Object.keys(mutationBaselineTask),
    ...Object.keys(nextTask),
  ].filter(key => !FORBIDDEN_PROJECT_TASK_FIELDS.includes(key as typeof FORBIDDEN_PROJECT_TASK_FIELDS[number])))

  // Effective reads include derived proof/runtime fields that are absent from
  // the definition row. Only compare and apply fields that this write cycle
  // actually changed; otherwise a harmless projection difference would turn
  // a safe point mutation into an aggregate-write failure.
  const next = { ...currentTask }
  for (const key of changedKeys) {
    const mutationBaselineValue = mutationBaselineTask[key]
    const nextValue = nextTask[key]
    if (sameJson(mutationBaselineValue, nextValue)) continue
    if (!sameJson(comparableCurrent[key], definitionBaselineTask[key])) return null
    if (nextValue === undefined) delete next[key]
    else next[key] = nextValue
  }
  next.id = String(nextTask.id ?? currentTask.id)
  return next
}

type SanitizedRemovedTaskState = {
  taskId: string
  removedFields: string[]
  removedEvidence: Record<string, unknown>
}

function stableEvidencePayloadKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableEvidencePayloadKey).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableEvidencePayloadKey(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function removedTaskEvidenceEvents(
  removed: SanitizedRemovedTaskState,
  fallbackRecordedAt: string,
): TaskEvidenceEvent[] {
  const events: TaskEvidenceEvent[] = []
  const appendMany = (
    field: string,
    kind: TaskEvidenceEvent['kind'],
    values: unknown[],
    timestampField: string,
  ) => {
    for (const [index, value] of values.entries()) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const payload = value as Record<string, unknown>
      const recordedAt = typeof payload[timestampField] === 'string'
        ? payload[timestampField] as string
        : fallbackRecordedAt
      const identity = typeof payload.id === 'string' && payload.id.trim()
        ? payload.id.trim()
        : `${index + 1}-${stableEvidencePayloadKey(payload).length}`
      events.push({
        id: `${field}-${removed.taskId}-${identity}-${recordedAt.replace(/[^0-9A-Za-z]/g, '')}`,
        taskId: removed.taskId,
        kind,
        recordedAt,
        payload,
      })
    }
  }
  const evidence = removed.removedEvidence
  if (Array.isArray(evidence.notes)) appendMany('note', 'note', evidence.notes, 'timestamp')
  if (Array.isArray(evidence.gateResults)) appendMany('gate', 'gate_result', evidence.gateResults, 'checkedAt')
  if (Array.isArray(evidence.reviewVerdicts)) appendMany('review', 'review_verdict', evidence.reviewVerdicts, 'recordedAt')
  if (Array.isArray(evidence.adjudications)) appendMany('adjudication', 'adjudication', evidence.adjudications, 'decidedAt')
  if (Array.isArray(evidence.escalations)) appendMany('escalation', 'escalation', evidence.escalations, 'raisedAt')
  if (Array.isArray(evidence.agentIssues)) appendMany('issue', 'agent_issue', evidence.agentIssues, 'raisedAt')
  if (evidence.mergeRecord && typeof evidence.mergeRecord === 'object' && !Array.isArray(evidence.mergeRecord)) {
    appendMany('merge', 'merge_record', [evidence.mergeRecord], 'mergedAt')
  }
  if (evidence.doneSummaryBundle && typeof evidence.doneSummaryBundle === 'object' && !Array.isArray(evidence.doneSummaryBundle)) {
    appendMany('completion', 'completion_summary', [evidence.doneSummaryBundle], 'createdAt')
  }
  return events
}

function mergeRemovedRuntimeState(
  removed: SanitizedRemovedTaskState,
  current: Record<string, unknown> | null,
  updatedAt: string,
): Record<string, unknown> | null {
  const evidence = removed.removedEvidence
  const parsedCurrent = TaskRuntimeState.safeParse(current)
  const currentRuntime = parsedCurrent.success ? parsedCurrent.data : undefined
  const patch: Partial<import('@guildhall/core').TaskRuntimeState> = { updatedAt }
  let changed = false
  const assign = <K extends keyof import('@guildhall/core').TaskRuntimeState>(field: K, value: unknown) => {
    const parsed = parseTaskRuntimeField(removed.taskId, currentRuntime, patch, field, value)
    if (parsed.accepted) {
      patch[field] = parsed.value
      changed = true
    }
  }
  if ('assignedTo' in evidence) assign('assignedTo', typeof evidence.assignedTo === 'string' ? evidence.assignedTo : null)
  for (const field of ['revisionCount', 'remediationAttempts', 'handoffStep'] as const) {
    if (typeof evidence[field] === 'number') assign(field, evidence[field])
  }
  for (const field of ['retryWindow', 'proofRecovery', 'currentLifecycle', 'workerRecovery', 'shelveReason'] as const) {
    if (evidence[field] && typeof evidence[field] === 'object' && !Array.isArray(evidence[field])) assign(field, evidence[field])
  }
  if (Array.isArray(evidence.escalations)) {
    assign('openEscalationIds', evidence.escalations
      .filter((item): item is { id: string; resolvedAt?: string } => Boolean(item) && typeof item === 'object' && 'id' in item && typeof item.id === 'string')
      .filter(item => !item.resolvedAt)
      .map(item => item.id))
  }
  if (Array.isArray(evidence.agentIssues)) {
    assign('openIssueIds', evidence.agentIssues
      .filter((item): item is { id: string; resolvedAt?: string } => Boolean(item) && typeof item === 'object' && 'id' in item && typeof item.id === 'string')
      .filter(item => !item.resolvedAt)
      .map(item => item.id))
  }
  if (!changed) return current
  return TaskRuntimeState.parse({ ...(currentRuntime ?? {}), ...patch, taskId: removed.taskId, updatedAt })
}

function mergeRemovedWorkspaceState(
  removed: SanitizedRemovedTaskState,
  current: Record<string, unknown> | null,
  updatedAt: string,
): Record<string, unknown> | null {
  const evidence = removed.removedEvidence
  const changed = ['worktreePath', 'branchName', 'baseBranch'].some(field => typeof evidence[field] === 'string')
  if (!changed) return current
  const patch: Record<string, unknown> = { ...(current ?? {}), taskId: removed.taskId, updatedAt }
  for (const field of ['worktreePath', 'branchName', 'baseBranch'] as const) {
    if (typeof evidence[field] === 'string') patch[field] = evidence[field]
  }
  return patch
}

function removedStateDelta(
  removed: SanitizedRemovedTaskState,
  baselineTask: Task | undefined,
  nextTask: Task | undefined,
): SanitizedRemovedTaskState {
  if (!baselineTask || !nextTask) return removed
  const removedEvidence = Object.fromEntries(
    Object.entries(removed.removedEvidence)
      .flatMap(([field, value]) => {
        const baselineValue = (baselineTask as unknown as Record<string, unknown>)[field]
        const nextValue = (nextTask as unknown as Record<string, unknown>)[field]
        if (sameJson(baselineValue, nextValue)) return []
        if (!Array.isArray(value) || !Array.isArray(baselineValue)) return [[field, value]]

        const changedRecords = value.filter(candidate => {
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false
          const candidateRecord = candidate as Record<string, unknown>
          const explicitId = typeof candidateRecord.id === 'string' && candidateRecord.id.trim()
            ? candidateRecord.id.trim()
            : null
          if (explicitId) {
            const baselineRecord = baselineValue.find(item =>
              item && typeof item === 'object' && !Array.isArray(item) &&
              (item as Record<string, unknown>).id === explicitId,
            )
            return !baselineRecord || !sameJson(baselineRecord, candidate)
          }
          return !baselineValue.some(item => sameJson(item, candidate))
        })
        return changedRecords.length > 0 ? [[field, changedRecords]] : []
      }),
  )
  return {
    taskId: removed.taskId,
    removedFields: removed.removedFields.filter(field => field in removedEvidence),
    removedEvidence,
  }
}

function hasFreshReframeBoundary(task: Task): boolean {
  const notes = Array.isArray(task.notes) ? task.notes : []
  const reframeTimes = notes
    .filter((note) => note.structured?.event === 'reframe_requested')
    .map((note) => Date.parse(note.timestamp))
    .filter(Number.isFinite)
  const latestReframeAt = Math.max(...reframeTimes)
  if (!Number.isFinite(latestReframeAt)) return false

  return !notes.some((note) => {
    const recordedAt = Date.parse(note.timestamp)
    return recordedAt > latestReframeAt &&
      ['current_plan_reset', 'recovery_spec_seed', 'recovery_spec_repaired'].includes(
        typeof note.structured?.event === 'string' ? note.structured.event : '',
      )
  })
}

export class Orchestrator {
  private consecutiveIdleTicks = 0
  private readonly opts: OrchestratorOptions
  /**
   * FR-30: lazily-initialized tracker. `opts.liveness` wins when provided;
   * otherwise we build a default with `standard` strictness (can be
   * reconfigured at runtime via `updateLivenessStrictness` once the lever
   * file is read).
   */
  private readonly livenessTracker: LivenessTracker
  /**
   * FR-24: lazily-initialized on first dispatch. `null` means we have already
   * consulted the levers and runtime_isolation is `none`; a live
   * `SlotAllocator` means we're allocating slots for each dispatched task.
   * Initialized to `undefined` so the first dispatch knows to read the
   * levers and pick a mode.
   */
  private slotAllocator: SlotAllocator | null | undefined = undefined
  /**
   * FR-24/25: injected git driver. Default `NodeGitDriver` for real runs;
   * tests pass `InMemoryGitDriver` through options.
   */
  private readonly gitDriver: GitDriver
  /**
   * FR-24/25: serialize the read-modify-write cycle for TASKS.json when
   * multiple fanout dispatches finish in the same tick. Kept as a single
   * tail promise so writes are FIFO and no dispatchOne clobbers another's
   * edits.
   */
  private queueWriteChain: Promise<void> = Promise.resolve()
  private readonly emptyAssistantRetries = new Map<string, number>()
  private readonly emptyAssistantResets = new Map<string, number>()
  private readonly specTimeoutRetries = new Map<string, number>()
  /** Queue compare-and-swap token for the current read-modify-write cycle. */
  private queueRevision: number | null | undefined = undefined
  /** Project CAS token paired with queueRevision for the current snapshot. */
  private projectRevision: number | null | undefined = undefined
  /** Sanitized queue state used to identify one-task writes without rereading the aggregate. */
  private queueWriteBaseline: TaskQueue | null = null
  /** Effective queue snapshot used to distinguish authored overlay changes from hydration. */
  private effectiveQueueWriteBaseline: TaskQueue | null = null
  private readonly exploringNoProgressCounts = new Map<string, number>()
  /** A reframe starts a new intake conversation while keeping the task id stable. */
  private readonly freshReframeResets = new Map<string, string>()
  private runAutomationResolutionCount = 0
  private readonly runAutomationResolutionKinds = new Map<string, number>()

  constructor(opts: OrchestratorOptions) {
    this.opts = opts
    this.livenessTracker =
      opts.liveness ?? new LivenessTracker({ strictness: 'standard' })
    this.gitDriver = opts.gitDriver ?? new NodeGitDriver()
  }

  get config(): ResolvedConfig {
    return this.opts.config
  }

  /** FR-30: expose the liveness tracker so serve / tests can feed events. */
  get liveness(): LivenessTracker {
    return this.livenessTracker
  }

  private resolveEffectiveTaskProjectPath(task: Pick<Task, 'projectPath' | 'domain'>): string {
    return resolveEffectiveTaskProjectPath(task, this.opts.config.projectPath, {
      workspaceProjects: this.workspaceProjectsForTaskResolution(),
    })
  }

  private workspaceProjectsForTaskResolution(): NonNullable<ResolvedConfig['projects']> {
    return this.opts.config.projects?.length
      ? this.opts.config.projects
      : discoverChildGitProjects(this.opts.config.projectPath)
  }

  /** FR-30: convenience — same as `this.liveness.scanStalls()`. */
  scanStalls(nowOverride?: number): StallFlag[] {
    return this.livenessTracker.scanStalls(nowOverride)
  }

  private clearExploringNoProgress(taskId: string): void {
    this.exploringNoProgressCounts.delete(taskId)
  }

  private bumpExploringNoProgress(taskId: string): number {
    const next = (this.exploringNoProgressCounts.get(taskId) ?? 0) + 1
    this.exploringNoProgressCounts.set(taskId, next)
    return next
  }

  private async readWorkerRecovery(taskId: string): Promise<NonNullable<TaskRuntimeState['workerRecovery']>> {
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    return (await readTaskRuntimeStore(projectRoot)).tasks[taskId]?.workerRecovery ?? {}
  }

  private async patchWorkerRecovery(
    taskId: string,
    patch: Partial<NonNullable<TaskRuntimeState['workerRecovery']>>,
  ): Promise<void> {
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    const current = (await readTaskRuntimeStore(projectRoot)).tasks[taskId]?.workerRecovery ?? {}
    await upsertTaskRuntimeState(projectRoot, taskId, {
      workerRecovery: { ...current, ...patch },
      updatedAt: this.now(),
    })
  }

  /**
   * Keep a bounded, typed account of worktree churn inside the current worker
   * pass. A clean result after the worker previously made this worktree dirty
   * is a recovery fact, not a line of model prose or an activity transcript.
   */
  private async observeWorkerWorktreeAtToolBoundary(task: Task): Promise<void> {
    if (task.status !== 'in_progress') return
    const worktreePath = task.worktreePath?.trim()
    if (!worktreePath) return
    const status = await this.gitDriver.statusSummary(resolveRuntimePath(worktreePath))
    if (status.repository === false) return

    const current = await this.readWorkerRecovery(task.id)
    const observation = current.worktreeObservation
    if (!status.clean) {
      const files = status.samplePaths
        .filter(file => !isIgnorableCheckpointPath(file))
        .slice(0, 12)
      if (
        observation?.state !== 'dirty' ||
        !sameStringSet(observation.files, files)
      ) {
        await this.patchWorkerRecovery(task.id, {
          worktreeObservation: { state: 'dirty', observedAt: this.now(), files },
        })
      }
      return
    }

    if (observation?.state === 'dirty') {
      await this.patchWorkerRecovery(task.id, {
        worktreeObservation: {
          state: 'lost',
          observedAt: this.now(),
          files: observation.files,
        },
      })
    }
  }

  private async resetWorkerRecoveryCounters(
    taskId: string,
    fields: readonly ('noProgressAttempts' | 'dirtyTimeoutRetries' | 'likelyTargetTimeoutRetries' | 'noVisibleProgressTimeoutRetries')[],
  ): Promise<void> {
    const current = await this.readWorkerRecovery(taskId)
    const patch: Partial<NonNullable<TaskRuntimeState['workerRecovery']>> = {}
    for (const field of fields) {
      if (typeof current[field] === 'number' && current[field] !== 0) patch[field] = 0
    }
    if (Object.keys(patch).length > 0) {
      await this.patchWorkerRecovery(taskId, patch)
    }
  }

  private async annotateWorkerBlockedClassification(input: {
    taskId: string
    agentId: string
    classification: FailureClassification
  }): Promise<void> {
    const queue = await this.readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === input.taskId)
    if (!task) return
    appendFailureClassificationNote(task, input.classification, {
      agentId: input.agentId,
      timestamp: this.now(),
    })
    task.updatedAt = this.now()
    queue.lastUpdated = this.now()
    await this.writeQueue(queue)
  }

  /**
   * FR-30: read the current `agent_health_strictness` lever and sync the
   * tracker. Callers (serve layer, tests) invoke this when the lever may
   * have changed. Silently falls back to `standard` if the lever file
   * cannot be read — stall detection should not be gated on perfect
   * settings state.
   */
  async refreshLivenessStrictness(): Promise<void> {
    try {
      const settingsPath = getProjectSystemStatePath(
        inferProjectRootFromMemoryDir(this.opts.config.memoryDir),
        AGENT_SETTINGS_FILENAME,
      )
      const settings = await loadLeverSettings({ path: settingsPath })
      this.livenessTracker.setStrictness(
        settings.project.agent_health_strictness.position,
      )
    } catch {
      this.livenessTracker.setStrictness('standard')
    }
  }

  private summarizeIdleQueue(
    queue: TaskQueue,
    scopeTaskId?: string,
    broaderDocumentedScope?: {
      laterTaskCount: number
      laterContextCount: number
      detectedAdditionalTaskCount: number
    } | null,
    selectedScope?: Parameters<typeof taskEligibleForSelectedScope>[1] | null,
  ): NonNullable<Extract<TickOutcome, { kind: 'idle' }>['summary']> {
    const scopedIds = scopeTaskId ? new Set(workSubtreeIds(queue.tasks, scopeTaskId)) : null
    const tasks = scopedIds
      ? queue.tasks.filter(task => scopedIds.has(task.id))
      : selectedScope
        ? queue.tasks.filter(task => taskEligibleForSelectedScope(task, selectedScope, {
            tasksById: new Map(queue.tasks.map(candidate => [candidate.id, candidate] as const)),
          }).eligible)
        : queue.tasks
    const waitingOwnerInputTaskIds = this.waitingOwnerInputTaskIds(queue)
    const counts = {
      total: tasks.length,
      actionable: 0,
      terminal: 0,
      done: 0,
      blocked: 0,
      shelved: 0,
      waitingOnUser: 0,
      draftReview: 0,
      awaitingApproval: 0,
      dependencyBlocked: 0,
      escalated: 0,
      active: 0,
      fresh: 0,
    }
    for (const task of tasks) {
      if ((TERMINAL_TASK_STATUSES as readonly TaskStatus[]).includes(task.status)) {
        counts.terminal += 1
        if (task.status === 'done') counts.done += 1
        if (task.status === 'blocked') counts.blocked += 1
        if (task.status === 'shelved') counts.shelved += 1
        continue
      }
      if (hasOpenEscalation(task)) {
        counts.escalated += 1
        continue
      }
      if (!dependenciesSatisfied(queue, task)) {
        counts.dependencyBlocked += 1
        continue
      }
      if (
        waitingOwnerInputTaskIds.has(task.id) ||
        (task.status === 'exploring' && taskHasUnansweredOpenQuestion(task))
      ) {
        counts.waitingOnUser += 1
        continue
      }
      if (task.status === 'import_draft') {
        counts.draftReview += 1
        continue
      }
      if (task.status === 'spec_review' && Boolean(task.spec?.trim())) {
        counts.awaitingApproval += 1
        continue
      }
      if (task.status === 'in_progress' || task.status === 'review' || task.status === 'gate_check') {
        counts.active += 1
      } else if (
        task.status === 'proposed' ||
        task.status === 'exploring' ||
        task.status === 'spec_review' ||
        task.status === 'ready'
      ) {
        counts.fresh += 1
      }
      counts.actionable += 1
    }

    if (counts.terminal === counts.total) {
      const broaderScopeFragments: string[] = []
      if ((broaderDocumentedScope?.laterTaskCount ?? 0) > 0) {
        broaderScopeFragments.push(
          `${broaderDocumentedScope!.laterTaskCount} later documented task${broaderDocumentedScope!.laterTaskCount === 1 ? '' : 's'}`,
        )
      }
      if ((broaderDocumentedScope?.laterContextCount ?? 0) > 0) {
        broaderScopeFragments.push(
          `${broaderDocumentedScope!.laterContextCount} later documented capabilit${broaderDocumentedScope!.laterContextCount === 1 ? 'y' : 'ies'}`,
        )
      }
      if ((broaderDocumentedScope?.detectedAdditionalTaskCount ?? 0) > 0) {
        broaderScopeFragments.push(
          `${broaderDocumentedScope!.detectedAdditionalTaskCount} additional detected task${broaderDocumentedScope!.detectedAdditionalTaskCount === 1 ? '' : 's'} not yet in the approved scope`,
        )
      }
      return {
        reason: 'all_terminal',
        message:
          `No actionable tasks remain: ${counts.done} done, ${counts.blocked} blocked, ${counts.shelved} shelved.` +
          (broaderScopeFragments.length > 0
            ? ` Current task scope is exhausted, but ${broaderScopeFragments.join(', ')} remain outside this scope.`
            : ''),
        counts,
      }
    }
    if (counts.waitingOnUser > 0 || counts.draftReview > 0 || counts.awaitingApproval > 0) {
      const fragments: string[] = []
      if (counts.waitingOnUser > 0) {
        fragments.push(`${counts.waitingOnUser} waiting on user answers`)
      }
      if (counts.draftReview > 0) {
        fragments.push(`${counts.draftReview} draft task(s) waiting for review`)
      }
      if (counts.awaitingApproval > 0) {
        fragments.push(`${counts.awaitingApproval} awaiting approval`)
      }
      return {
        reason: 'awaiting_human',
        message: `No runnable tasks remain right now: ${fragments.join(', ')}.`,
        counts,
      }
    }
    if (counts.escalated > 0 && counts.actionable === 0) {
      return {
        reason: 'blocked_only',
        message:
          `No actionable tasks remain right now: ${counts.escalated} task(s) are halted on open escalations.`,
        counts,
      }
    }
    if (counts.dependencyBlocked > 0 && counts.actionable === 0) {
      return {
        reason: 'dependency_blocked',
        message:
          `No actionable tasks remain right now: ${counts.dependencyBlocked} task(s) are waiting on dependencies.`,
        counts,
      }
    }
    return {
      reason: 'no_eligible_tasks',
      message:
        `No actionable tasks remain right now: ${counts.active} active, ${counts.fresh} fresh, ` +
        `${counts.escalated} escalated, ${counts.dependencyBlocked} dependency-blocked.`,
      counts,
    }
  }

  private waitingOwnerInputTaskIds(queue: TaskQueue): Set<string> {
    const taskIds = new Set(queue.tasks.map(task => task.id))
    return new Set(
      [...waitingOwnerInputTaskIdsSync(this.opts.config.projectPath)]
        .filter(taskId => taskIds.has(taskId)),
    )
  }

  private repairSyntheticBootstrapOutputTruncationInQueue(queue: TaskQueue): { changed: boolean } {
    let changed = false
    const now = this.now()
    for (const task of queue.tasks) {
      for (const note of task.notes ?? []) {
        if (note.agentId !== 'coordinator') continue
        if (note.role !== 'bootstrap-verification') continue
        if (!note.content.includes('Verification output:')) continue
        if (!note.content.trimEnd().endsWith('...')) continue
        note.content = note.content.replace(
          /\n\.\.\.\s*$/,
          '\n[older Guildhall build truncated this bootstrap verification output before storing it; full output is unavailable]',
        )
        task.updatedAt = now
        changed = true
      }
    }
    return { changed }
  }

  /**
   * Single orchestrator step. Reads the queue, picks 1..N actionable tasks
   * per the `concurrent_task_dispatch` lever, and dispatches each through
   * `dispatchOne`. Returns one `TickOutcome` for the serial path, or a
   * `batch` outcome wrapping the N sub-outcomes for fanout.
   *
   * Agents run concurrently in fanout; queue writes are serialized via
   * `withQueueWriteLock` so concurrent dispatches never clobber one another.
   */
  async tick(opts: OrchestratorTickOptions = {}): Promise<TickOutcome> {
    let queueBefore = await this.readQueue()
    const resolvedCapacity = await this.resolveCapacity()
    queueBefore = await this.normalizeQueuedReviewOwnership(queueBefore, resolvedCapacity)
    queueBefore = await this.reopenRecoverableDirtyRepoTasks(queueBefore)
    const staleGateRecovery = this.repairRecoverableStaleGateCheckTasks(queueBefore)
    if (staleGateRecovery.changed) await this.writeQueue(queueBefore)
    const syntheticBootstrapTruncationRepair = this.repairSyntheticBootstrapOutputTruncationInQueue(queueBefore)
    if (syntheticBootstrapTruncationRepair.changed) await this.writeQueue(queueBefore)
    const completedEvidenceRepair = this.reconcileCompletedTaskEvidence(queueBefore)
    if (completedEvidenceRepair.changed) await this.writeQueue(queueBefore)
    const staleRepair = repairStaleBlockersInQueue(queueBefore, this.now(), {
      // Specialized recovery handlers below need to see the typed recovery
      // code. A generic repair must never turn that machine state into prose.
      preserveTypedRecoveries: true,
    })
    if (staleRepair.changed) await this.writeQueue(queueBefore)
    const sourceRecoveryRepair = await this.repairSourceRecoveryResearchTasksInQueue(queueBefore)
    if (sourceRecoveryRepair) return sourceRecoveryRepair
    const staleSourceRecoveryReadinessRepair = await this.repairStaleSourceRecoveryReadinessInQueue(queueBefore)
    if (staleSourceRecoveryReadinessRepair) return staleSourceRecoveryReadinessRepair
    const fixedSpecReadinessRepair = await this.repairStaleFixedSpecReadinessInQueue(queueBefore)
    if (fixedSpecReadinessRepair) return fixedSpecReadinessRepair
    const weakRecoverySpecRepair = await this.repairWeakRecoverySpecReviewSeedsInQueue(queueBefore)
    if (weakRecoverySpecRepair) return weakRecoverySpecRepair
    const landingRepair = await this.reconcileCompletedTaskLanding(queueBefore)
    if (landingRepair.changed) await this.writeQueue(queueBefore)
    const pendingPrRepair = await this.reconcilePendingPrLanding(queueBefore)
    if (pendingPrRepair.changed) await this.writeQueue(queueBefore)
    const completedWorktreeCleanup = await this.reconcileCompletedWorktreeCleanup(queueBefore)
    if (completedWorktreeCleanup.changed) await this.writeQueue(queueBefore)
    const runAutomation = await this.applyRunAutomationPolicy(queueBefore, opts.preferredTaskId)
    if (runAutomation.changed) queueBefore = await this.readQueue()
    const satisfiedClosures = await this.completeSatisfiedTaskClosures(queueBefore)
    if (satisfiedClosures.changed) queueBefore = await this.readQueue()
    const capacity =
      opts.dispatchLimit === undefined
        ? resolvedCapacity
        : Math.max(1, Math.min(resolvedCapacity, opts.dispatchLimit))
    const lanePlan = resolveLaneConcurrencyPlan({
      projectPath: this.opts.config.projectPath,
      provider: this.opts.providerName ?? 'none',
      dispatchCapacity: capacity,
    })
    const ownerInputBlockedTaskIds = this.waitingOwnerInputTaskIds(queueBefore)
    const currentStateAuthority = readProjectStateAuthorityAtBoundary(
      getProjectSystemStatePath(this.opts.config.projectPath, 'TASKS.json'),
    )
    const workspaceGoalsState = opts.preferredTaskId || currentStateAuthority.authority === 'database'
      ? null
      : await readWorkspaceGoalsState(getProjectStateDir(this.opts.config.projectPath)).catch(() => null)
    const explicitReleaseScope = opts.preferredTaskId ? null : selectedReleaseScopeForQueue(queueBefore)
    const selectedReleaseScope = opts.preferredTaskId
      ? null
      : (
          explicitReleaseScope ??
          (currentStateAuthority.authority === 'database'
            ? null
            : selectedTaskScopeForQueue(queueBefore, workspaceGoalsState?.approved ?? null))
        )
    const picks = pickNextTasks({
      queue: queueBefore,
      capacity,
      laneCapacities: {
        spec: lanePlan.spec.effectiveConcurrency,
        worker: lanePlan.worker.effectiveConcurrency,
        review: lanePlan.review.effectiveConcurrency,
        coordinator: lanePlan.coordinator.effectiveConcurrency,
      },
      ...(this.opts.domainFilter ? { domainFilter: this.opts.domainFilter } : {}),
      ...(opts.preferredTaskId ? { preferredTaskId: opts.preferredTaskId } : {}),
      ...(selectedReleaseScope ? { pickerOptions: { scope: selectedReleaseScope } } : {}),
      excludeIds: ownerInputBlockedTaskIds,
    })

    // Structural-reliability hard precondition: refuse to dispatch if the
    // project's bootstrap block is unverified or its last install failed.
    // Running a worker against an environment that can't even resolve
    // `pnpm` / `oxlint` / tsconfig guarantees gate failures on infrastructure
    // rather than on actual work — the Ready page surfaces the same state and
    // offers a "Run bootstrap" button. Skipped in idle ticks so a bootstrap-less
    // workspace with no pending work doesn't emit noise.
    if (picks.length > 0) {
      const halt = this.bootstrapHalt(picks.length)
      if (halt) return halt
    }

    if (picks.length === 0) {
      this.consecutiveIdleTicks++
      const scopedIds = opts.preferredTaskId
        ? new Set(workSubtreeIds(queueBefore.tasks, opts.preferredTaskId))
        : null
      const scopedTasks = scopedIds
        ? queueBefore.tasks.filter((task) => scopedIds.has(task.id))
        : selectedReleaseScope
          ? queueBefore.tasks.filter((task) => taskEligibleForSelectedScope(task, selectedReleaseScope, {
            tasksById: new Map(queueBefore.tasks.map(task => [task.id, task] as const)),
          }).eligible)
        : queueBefore.tasks
      const allDone = scopedTasks.length > 0 && scopedTasks.every((t) =>
        (TERMINAL_TASK_STATUSES as readonly TaskStatus[]).includes(t.status),
      )
      const broaderDocumentedScope = !opts.preferredTaskId && explicitReleaseScope
        ? {
            laterTaskCount: queueBefore.tasks.filter(task =>
              explicitReleaseScope.deferredNodeIds.includes(taskNodeId(task.id)),
            ).length,
            laterContextCount: 0,
            detectedAdditionalTaskCount: 0,
          }
        : !opts.preferredTaskId && workspaceGoalsState
          ? {
              laterTaskCount: workspaceGoalsState.approved.laterTaskIds.length,
              laterContextCount: workspaceGoalsState.context.filter(context =>
                (context.role === 'capability' || context.role === 'brief_input') &&
                context.scopeHint === 'later',
              ).length,
              detectedAdditionalTaskCount: Math.max(
                0,
                (workspaceGoalsState.detected?.taskCount ?? workspaceGoalsState.approved.taskCount) -
                  workspaceGoalsState.approved.taskCount,
              ),
            }
          : null
      const summary = this.summarizeIdleQueue(
        queueBefore,
        opts.preferredTaskId,
        broaderDocumentedScope,
        selectedReleaseScope,
      )
      return {
        kind: 'idle',
        consecutiveIdleTicks: this.consecutiveIdleTicks,
        allDone,
        summary,
      }
    }
    this.consecutiveIdleTicks = 0

    if (picks.length === 1) {
      return await this.dispatchOne(picks[0]!, queueBefore)
    }

    // Fanout path: reserve runtime slots for the selected batch before any
    // individual dispatch can race ahead and release/reuse slot 0. The
    // per-dispatch allocation call is idempotent, so dispatchOne still sees
    // the same task-owned slot when composing the worker prompt.
    for (const task of picks) {
      await this.allocateSlotForTask(task)
    }

    try {
      // `dispatchOne` catches its own agent errors, so Promise.all is
      // sufficient — any rejection here is a true bug and should surface as a
      // throw on the tick caller.
      const outcomes = await Promise.all(
        picks.map((t) => this.dispatchOne(t, queueBefore)),
      )
      return { kind: 'batch', outcomes }
    } finally {
      for (const task of picks) {
        this.slotAllocator?.release(task.id)
      }
    }
  }

  private async completeSelectedTaskClosureIfSatisfied(
    preferredTaskId: string,
  ): Promise<{ completed: boolean; childIds: string[] }> {
    const queue = await this.readQueue()
    const root = queue.tasks.find(task => task.id === preferredTaskId)
    if (!root) return { completed: false, childIds: [] }
    const subtreeIds = workSubtreeIds(queue.tasks, preferredTaskId)
    const childIds = subtreeIds.filter(id => id !== preferredTaskId)
    if (childIds.length === 0) return { completed: false, childIds: [] }
    const tasksById = new Map(queue.tasks.map(task => [task.id, task]))
    const childrenComplete = childIds.every(id => {
      const child = tasksById.get(id)
      return child ? isSelectedTaskClosureDone(child) : false
    })
    if (!childrenComplete) return { completed: false, childIds }
    if (isSelectedTaskClosureDone(root)) return { completed: true, childIds }

    const now = this.now()
    root.status = 'done'
    delete root.assignedTo
    root.updatedAt = now
    root.notes.push({
      agentId: 'coordinator',
      role: 'system',
      content:
        `Closed containing work after linked child tasks completed: ${childIds.join(', ')}.`,
      timestamp: now,
    })
    queue.lastUpdated = now
    await this.writeQueue(queue)
    await this.logTickProgress({
      task: root,
      agent: 'coordinator',
      beforeStatus: 'ready',
      afterStatus: 'done',
      transitioned: true,
    })
    await recordTaskReflection({
      memoryDir: this.opts.config.memoryDir,
      task: root,
    })
    return { completed: true, childIds }
  }

  private async completeSatisfiedTaskClosures(
    queue: TaskQueue,
  ): Promise<{ changed: boolean; closedIds: string[] }> {
    const tasksById = new Map(queue.tasks.map(task => [task.id, task]))
    const now = this.now()
    const closed: Array<{ root: Task; childIds: string[]; beforeStatus: TaskStatus }> = []

    for (const root of queue.tasks) {
      if (isSelectedTaskClosureDone(root)) continue
      // A parent deliberately reopened for a fresh lifecycle needs a new
      // shaping/worker result. Historical descendants are evidence of the old
      // lifecycle, not completion of the current one.
      if (currentLifecycleForTask(root) != null) continue
      const childIds = workSubtreeIds(queue.tasks, root.id).filter(id => id !== root.id)
      if (childIds.length === 0) continue
      const childrenComplete = childIds.every(id => {
        const child = tasksById.get(id)
        return child ? isSelectedTaskClosureDone(child) : false
      })
      if (!childrenComplete) continue

      const beforeStatus = root.status
      root.status = 'done'
      delete root.assignedTo
      root.updatedAt = now
      root.notes.push({
        agentId: 'coordinator',
        role: 'system',
        content:
          `Closed containing work after linked child tasks completed: ${childIds.join(', ')}.`,
        timestamp: now,
      })
      closed.push({ root, childIds, beforeStatus })
    }

    if (closed.length === 0) return { changed: false, closedIds: [] }
    queue.lastUpdated = now
    await this.writeQueue(queue)
    for (const { root, beforeStatus } of closed) {
      await this.logTickProgress({
        task: root,
        agent: 'coordinator',
        beforeStatus,
        afterStatus: 'done',
        transitioned: true,
      })
      await recordTaskReflection({
        memoryDir: this.opts.config.memoryDir,
        task: root,
      })
    }
    return { changed: true, closedIds: closed.map(({ root }) => root.id) }
  }

  private async selectedTaskClosureBlockers(preferredTaskId: string): Promise<string[]> {
    const queue = await this.readQueue()
    const root = queue.tasks.find(task => task.id === preferredTaskId)
    if (!root || isSelectedTaskClosureDone(root)) return []
    const childIds = workSubtreeIds(queue.tasks, preferredTaskId).filter(id => id !== preferredTaskId)
    if (childIds.length === 0) return []
    const tasksById = new Map(queue.tasks.map(task => [task.id, task]))
    const blockers: string[] = []
    for (const childId of childIds) {
      const child = tasksById.get(childId)
      if (!child) continue
      if (child.status === 'blocked') blockers.push(`${child.id} is blocked`)
    }
    return blockers
  }

  private async applyRunAutomationPolicy(
    queue: TaskQueue,
    preferredTaskId?: string,
  ): Promise<{ changed: boolean }> {
    let settings
    try {
      settings = await this.readLeverSettings()
    } catch {
      return { changed: false }
    }
    const policy = settings.project.run_automation.position
    if (policy !== 'fully_automated') return { changed: false }
    // Project-level runs are scoped by the selected release later in this
    // tick. Automation only has a subtree boundary when an explicit task was
    // requested, so it must not mutate the whole queue before selection.
    if (!preferredTaskId) return { changed: false }
    const rootTask = preferredTaskId ? queue.tasks.find(task => task.id === preferredTaskId) : undefined
    const ownerIntent = rootTask
      ? [rootTask.title, rootTask.description, rootTask.request?.raw].filter(Boolean).join('\n')
      : undefined
    const result = await applyRunAutomationLeverPolicy({
      memoryDir: this.opts.config.memoryDir,
      policy,
      ...(preferredTaskId ? { rootTaskId: preferredTaskId } : {}),
      ...(ownerIntent ? { ownerIntent } : {}),
      actor: 'run-automation',
    })
    if (result.resolutions.length > 0) {
      this.runAutomationResolutionCount += result.resolutions.length
      for (const resolution of result.resolutions) {
        this.runAutomationResolutionKinds.set(
          resolution.kind,
          (this.runAutomationResolutionKinds.get(resolution.kind) ?? 0) + 1,
        )
      }
      console.log(`[guildhall] fully automated run resolved ${result.resolutions.length} owner checkpoint(s).`)
    }
    return { changed: result.changed }
  }

  /**
   * Dispatch a single task. Handles pre-policy (proposed, shelved) paths,
   * agent dispatch (with worktree setup + slot allocation), reviewer-mode
   * routing, merge dispatch on `done` transitions, worktree cleanup on
   * terminal transitions, revision counting, and progress logging.
   *
   * Queue mutations after `agent.generate()` go through `withQueueWriteLock`
   * so concurrent fanout dispatches serialize on the final write step.
   */
  async dispatchOne(task: Task, queueBefore: TaskQueue): Promise<TickOutcome> {
    if (task.status === 'exploring' || task.status === 'spec_review' || task.status === 'in_progress' || task.status === 'review' || task.status === 'gate_check') {
      task = await this.hydrateEffectiveTaskForDispatch(task)
    }
    let activeWorktreeSyncRecovery = await this.refreshWorktreeSyncRecovery(task)
    if (activeWorktreeSyncRecovery && task.status !== 'in_progress') {
      return await this.returnTaskToWorktreeSyncRecovery(task, activeWorktreeSyncRecovery)
    }
    // Execution is never valid without the current implementation contract.
    // This guard covers tasks that arrived through an older retry path or a
    // stale projection without the narrower proof-recovery marker.
    const missingExecutionBlueprint = await this.repairMissingExecutionBlueprintInline(task)
    if (missingExecutionBlueprint) return missingExecutionBlueprint

    // A proof-recovered legacy task may need a fresh blueprint before it can
    // return to implementation. Remember that pre-dispatch state so a spec
    // agent that saves its draft but times out still lands in spec_review.
    const proofRecoveryNeedsBlueprint = hasActiveProofRecovery(task) && !hasUsableBlueprint(task)

    // FR-21: proposals are decided by policy (the `task_origination` lever),
    // not by an LLM agent. Handle the transition inline.
    if (task.status === 'proposed') {
      return await this.decideProposal(task, queueBefore)
    }

    // FR-22: worker-shelved tasks pending pre_rejection_policy get resolved
    // via the same pure-policy path.
    if (needsPreRejectionPolicy(task)) {
      return await this.applyPreRejectionPolicy(task, queueBefore)
    }

    // One-task finisher pivot: a `ready` task has already passed approval.
    // Claiming it for the worker is a deterministic state transition, not
    // something worth spending a coordinator model call on.
    if (task.status === 'ready') {
      const invalidAcceptanceProof = await this.repairInvalidAcceptanceProofCommandInline(task)
      if (invalidAcceptanceProof) return invalidAcceptanceProof
      return await this.claimReadyTaskInline(task)
    }

    const invalidAcceptanceProof = await this.repairInvalidAcceptanceProofCommandInline(task)
    if (invalidAcceptanceProof) return invalidAcceptanceProof

    // Proof-setup tasks with a complete command contract are already their
    // own review boundary. Run this before stale self-critique recovery or
    // provider remediation so an old checkpoint cannot steal the task from
    // its authoritative command proof.
    if (task.status === 'review' && isLeanCommandBackedTask(task)) {
      return await this.advanceLeanCommandBackedReviewInline(task)
    }

    const proofRecoveryGateCheck = await this.advanceProofRecoveryToGateCheckInline(task)
    if (proofRecoveryGateCheck) return proofRecoveryGateCheck

    const staleWorkerSelfCritiqueRecovery =
      await this.rejectStaleWorkerSelfCritiqueWithoutProjectChanges(task, task.status)
    if (staleWorkerSelfCritiqueRecovery) return staleWorkerSelfCritiqueRecovery

    // Provider proof is a durable local artifact. Consume it before trying to
    // execute the documented command: the command may be a provider-backed
    // script that cannot run in the current process, while the artifact is
    // the proof Guildhall was explicitly asked to verify.
    if (task.status === 'gate_check') {
      const proofIntegrityOutcome = await this.runProviderProofIntegrityGateInline(task)
      if (proofIntegrityOutcome) return proofIntegrityOutcome
    }

    // Acceptance-command pre-pass at `gate_check`: command-backed acceptance
    // criteria are decided by observed process exits before any model can
    // narrate gate results.
    if (task.status === 'gate_check') {
      const acceptanceGateOutcome = await this.runAcceptanceCommandGatesInline(task)
      if (acceptanceGateOutcome) return acceptanceGateOutcome
    }

    // Guild deterministic-check pre-pass at `gate_check`: each applicable
    // guild's pure-function checks (WCAG contrast, OKLab near-duplicates, ...)
    // run *before* the LLM gate-checker. Failures short-circuit straight to
    // `in_progress` — there's no point running build/test if a token pair
    // fails WCAG. All-pass (or no applicable checks) falls through to the
    // normal shell-gate pass.
    if (task.status === 'gate_check') {
      const guildGateOutcome = await this.runGuildGatesInline(task, queueBefore)
      if (guildGateOutcome) return guildGateOutcome
    }

    if (task.status === 'gate_check') {
      const recordedHardGateOutcome = await this.completeGateCheckWithRecordedPassingHardGatesInline(task)
      if (recordedHardGateOutcome) return recordedHardGateOutcome
    }

    if (task.status === 'gate_check') {
      const approvedReviewOutcome = await this.completeGateCheckWithApprovedReviewOnlyInline(task)
      if (approvedReviewOutcome) return approvedReviewOutcome
    }

    if (task.status === 'gate_check') {
      const missingReviewApproval = await this.restartGateCheckForMissingReviewApprovalInline(task)
      if (missingReviewApproval) return missingReviewApproval
    }

    // Handoff sequence pre-pass at `review`: when the task is running a
    // multi-step handoff and the current step is NOT the last, we capture
    // the step's handoff note, advance `handoffStep`, and revert status to
    // `in_progress`. The reviewer fan-out only fires on the final step's
    // completion. See docs/disagreement-and-handoff.md §2.
    if (task.status === 'review' && hasPendingHandoffStep(task)) {
      const handoffOutcome = await this.advanceHandoffStepInline(task)
      if (handoffOutcome) return handoffOutcome
    }

    let reviewPlan: ReviewPlanRecord | null = null
    if (task.status === 'review' && !hasPendingHandoffStep(task)) {
      await this.normalizeReviewOwnership(task)
      reviewPlan = await this.ensureReviewPlanRecorded(task)
    }

    if (task.status === 'gate_check') {
      await this.normalizeGateCheckOwnership(task)
    }

    if (task.status === 'spec_review') {
      await this.normalizeSpecReviewOwnership(task)
    }

    const unprovenScriptRecovery = await this.reopenUnprovenScriptProofRecovery(task)
    if (unprovenScriptRecovery) return unprovenScriptRecovery

    const malformedSpecReviewRepair = await this.maybeRepairMalformedSpecReviewBlueprint(task)
    if (malformedSpecReviewRepair) return malformedSpecReviewRepair

    const repairedSpecReviewApproval = await this.maybeApproveDeterministicallyRepairedSpec(task)
    if (repairedSpecReviewApproval) return repairedSpecReviewApproval

    const recoverySpecSeed = await this.maybeWriteExploringRecoverySpecSeed(task)
    if (recoverySpecSeed) return recoverySpecSeed

    // Reviewer fan-out at `review`: each applicable persona (Component
    // Designer, Accessibility Specialist, Color Theorist, ...) reviews
    // independently through its own lens. Aggregation is strict — any revise
    // bounces the task to `in_progress` with combined feedback. Falls
    // through to the legacy single-reviewer dispatch when no fan-out runner
    // is configured or no reviewer personas apply.
    if (task.status === 'review' && this.opts.reviewerFanout) {
      await this.maybeWriteReviewPacket(task)
      const fanoutOutcome = await this.runReviewerFanoutInline(task, queueBefore, reviewPlan)
      if (fanoutOutcome) return fanoutOutcome
    }

    if (task.id === META_INTAKE_TASK_ID && !task.spec) {
      const recovered = await this.recoverMetaIntakeDraftFromSpecSession(task)
      if (recovered) return recovered
    }

    const beforeStatus = task.status
    const selection = this.selectAgent(task)

    if (selection.kind === 'no-coordinator') {
      return { kind: 'no-coordinator', taskId: task.id, domain: task.domain }
    }

    const { agent, promptSuffix } = selection

    // A reframe is a new planning attempt, not another turn in the failed
    // spec conversation. Task ids stay stable for evidence and links, so
    // task-id changes alone cannot provide this session boundary.
    this.resetSpecAgentForFreshReframe(task, agent)

    // FR-27 / AC-18: resolve reviewer mode once per dispatch so failures to
    // load levers fall back to `llm_only` (safest default).
    const reviewerMode: ReviewerMode =
      beforeStatus === 'review' ? await this.resolveReviewerMode(task.domain) : 'llm_only'

    if (beforeStatus === 'review') {
      await this.reconcileReviewTaskFromWorkerProof(task)
    }

    if (beforeStatus === 'review' && reviewerMode === 'deterministic_only') {
      return await this.applyReviewVerdictInline({
        task,
        queue: queueBefore,
        llmError: undefined,
      })
    }

    // If review's only remaining uncertainty is automated hard verification,
    // deterministic review can hand straight to gate_check so the hard runner
    // decides the remaining truth. LLM-backed modes still get their configured
    // reviewer attempt so fallback audit paths stay deterministic.
    if (
      beforeStatus === 'review' &&
      reviewerMode === 'llm_only' &&
      shouldAdvanceToGateCheckPendingAutomatedVerification(task)
    ) {
      return await this.applyReviewVerdictInline({
        task,
        queue: queueBefore,
        llmError: undefined,
      })
    }

    // FR-24: if worktree_isolation is active, ensure a worktree exists before
    // the agent runs. On first creation, persist the path/branch/base on the
    // task so subsequent ticks reuse them. Skipped when mode is `none`.
    const effectiveTaskProjectPath = this.resolveEffectiveTaskProjectPath(task)
    const configuredWorktreeMode = await this.resolveWorktreeModeSafe()
    const repositoryStatus = configuredWorktreeMode !== 'none'
      ? await this.gitDriver.statusSummary(effectiveTaskProjectPath)
      : null
    // A task can target documentation inside a workspace envelope that has no
    // Git authority of its own. That is a valid execution scope, not a dirty
    // checkout. Use the shared checkout until workspace/project resolution
    // identifies an actual repository.
    let worktreeMode = repositoryStatus?.repository === false
      ? 'none'
      : proofRecoveryNeedsFreshWorktree(task)
        ? 'per_attempt'
      : configuredWorktreeMode
    let activeWorktreePath = activeWorktreeSyncRecovery
      ? task.worktreePath ?? effectiveTaskProjectPath
      : effectiveTaskProjectPath
    const baseBranch = task.baseBranch?.trim() || await this.resolveBaseBranch(effectiveTaskProjectPath)
    let scopedWorkspaceSnapshot: ScopedTaskFileSnapshot[] = []
    if (!activeWorktreeSyncRecovery && agent.name === 'worker-agent') {
      const repairedWorkspace = await this.discardOutOfScopeTaskWorktreeBeforeDispatch(task)
      if (repairedWorkspace) {
        scopedWorkspaceSnapshot = repairedWorkspace
        worktreeMode = 'per_task'
        const now = this.now()
        const queuedTask = queueBefore.tasks.find((candidate) => candidate.id === task.id)
        if (queuedTask) {
          delete queuedTask.worktreePath
          delete queuedTask.branchName
          delete queuedTask.baseBranch
          delete (queuedTask as Task & { workspace?: TaskWorkspaceState }).workspace
          queuedTask.notes.push({
            agentId: 'coordinator',
            role: 'workspace-recovery',
            content:
              'Guildhall repaired a stale task workspace before dispatch. The next worker starts from the approved task scope rather than unrelated retained work.',
            timestamp: now,
          })
          queuedTask.updatedAt = now
          queueBefore.lastUpdated = now
          await this.writeQueue(queueBefore)
          task.notes = queuedTask.notes
          task.updatedAt = now
        }
      }
    }
    if (!activeWorktreeSyncRecovery && worktreeMode !== 'none' && !shouldSkipGitIsolation(task, agent.name)) {
      if (!task.worktreePath) {
        const repoClean = await this.gitDriver.isClean(effectiveTaskProjectPath)
        if (!repoClean) {
          const recovered = await this.recoverDirtyRepoIntoTaskBranch({
            task,
            worktreeMode,
            repoRoot: effectiveTaskProjectPath,
            baseBranch,
          })
          if (recovered.recovered) {
            const queue = await this.readQueue()
            const queuedTask = queue.tasks.find((candidate) => candidate.id === task.id)
            const now = this.now()
            if (queuedTask) {
              queuedTask.branchName = recovered.branchName
              queuedTask.baseBranch = baseBranch
              queuedTask.blockReason = undefined
              queuedTask.notes.push({
                agentId: 'coordinator',
                role: 'checkpoint',
                content:
                  `Recovered shared-checkout edits into ${recovered.branchName} ` +
                  `at ${recovered.commitSha ?? '<unknown commit>'}. Guildhall will continue from an isolated task branch.`,
                timestamp: now,
              })
              appendRecoveryPlaybookNote(
                queuedTask,
                resolveRecoveryPlan({
                  taskId: queuedTask.id,
                  classification: {
                    class: 'dirty_checkout_owned',
                    confidence: 'high',
                    evidence: [{
                      kind: 'task',
                      summary: `Shared checkout edits were packaged into ${recovered.branchName}.`,
                      ref: recovered.commitSha,
                    }],
                    scope: 'task',
                    safePlaybooks: ['package_owned_dirty_work'],
                    needsHuman: false,
                  },
                  notes: queuedTask.notes,
                }),
                {
                  agentId: 'coordinator',
                  timestamp: now,
                  status: 'succeeded',
                  summary:
                    `Packaged Guildhall-owned dirty checkout work into ${recovered.branchName}.`,
                },
              )
              queuedTask.updatedAt = now
              queue.lastUpdated = now
              await this.writeQueue(queue)
            }
            task.branchName = recovered.branchName
            task.baseBranch = baseBranch
          } else {
            const message = `base repo has uncommitted changes at ${effectiveTaskProjectPath}`
            const queue = await this.readQueue()
            const queuedTask = queue.tasks.find((candidate) => candidate.id === task.id)
            const now = this.now()
            if (queuedTask) {
              transitionTaskStatus({
                task: queuedTask,
                event: 'block',
                actor: 'orchestrator-worktree-setup',
                evidenceRefs: ['task:worktree-setup:dirty-checkout'],
                now,
              })
              queuedTask.assignedTo = null
              queuedTask.recoveryCode = 'dirty_checkout'
              queuedTask.blockReason =
                `Guildhall could not start work because the target repo is dirty: ${message}. ` +
                'Commit or stash those changes, then resume the task.'
              queuedTask.notes.push({
                agentId: 'coordinator',
                role: 'bootstrap-failure',
                content:
                  `Blocked before worktree creation. ${message}. ` +
                  'Guildhall stopped retrying until the repo is clean and the task is resumed.',
                timestamp: now,
              })
              appendRecoveryPlaybookNote(
                queuedTask,
                resolveRecoveryPlan({
                  taskId: queuedTask.id,
                  classification: {
                    class: 'dirty_checkout_external',
                    confidence: 'high',
                    evidence: [{
                      kind: 'task',
                      summary: message,
                      ref: effectiveTaskProjectPath,
                    }],
                    scope: 'task',
                    safePlaybooks: ['stop_with_external_setup_action'],
                    needsHuman: true,
                    humanQuestion:
                      'Commit or stash the target repo changes, then resume this task.',
                  },
                  notes: queuedTask.notes,
                }),
                {
                  agentId: 'coordinator',
                  timestamp: now,
                  status: 'succeeded',
                  summary:
                    'Stopped with a concrete external setup action for dirty checkout state.',
                },
              )
              queuedTask.updatedAt = now
              queue.lastUpdated = now
              await this.writeQueue(queue)
            }
            await this.logTickProgress({
              task,
              agent: agent.name,
              beforeStatus,
              afterStatus: 'blocked',
              transitioned: true,
              note: `error: worktree setup blocked — ${message}`,
            })
            return {
              kind: 'processed',
              taskId: task.id,
              agent: agent.name,
              beforeStatus,
              afterStatus: 'blocked',
              transitioned: true,
              revisionCount: task.revisionCount,
            }
          }
        }
      }
      try {
        const ensured = await ensureAndRegisterTaskWorkspace({
          task,
          mode: worktreeMode,
          projectId: this.opts.config.workspaceId,
          projectPath: effectiveTaskProjectPath,
          workspacePath: this.opts.config.projectPath,
          worktreeInclude: worktreeIncludeForTaskProject(this.opts.config, effectiveTaskProjectPath),
          baseBranch,
          gitDriver: this.gitDriver,
          tasksPath: this.tasksPath(),
          stateProjectRoot: inferProjectRootFromMemoryDir(this.opts.config.memoryDir),
          now: () => this.now(),
        })
        activeWorktreePath = ensured.worktreePath
        const syncRecovery = ensured.workspace.syncRecovery
        if (syncRecovery) activeWorktreeSyncRecovery = syncRecovery
        task.worktreePath = ensured.workspace.worktreePath
        task.branchName = ensured.workspace.branchName
        task.baseBranch = ensured.workspace.baseBranch
        ;(task as Task & { workspace?: TaskWorkspaceState }).workspace = ensured.workspace
        await this.restoreScopedTaskFiles(activeWorktreePath, scopedWorkspaceSnapshot)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const queue = await this.readQueue()
        const queuedTask = queue.tasks.find((candidate) => candidate.id === task.id)
        const now = this.now()
        if (queuedTask) {
          transitionTaskStatus({
            task: queuedTask,
            event: 'block',
            actor: 'orchestrator-worktree-setup',
            evidenceRefs: [
              err instanceof WorktreeSyncError
                ? `task:worktree-setup:${err.code}`
                : 'task:worktree-setup:create-failed',
            ],
            now,
          })
          queuedTask.assignedTo = null
          queuedTask.recoveryCode = err instanceof WorktreeSyncError
            ? err.code
            : message.toLowerCase().includes('already exists')
              ? 'task_worktree_exists'
              : 'task_worktree_setup'
          queuedTask.blockReason =
            `${err instanceof WorktreeSyncError
              ? 'Guildhall could not synchronize the task worktree with its current base'
              : 'Guildhall could not create a task worktree'}: ${message}. ` +
            'Fix the worktree setup issue, then resume the task.'
          queuedTask.notes.push({
            agentId: 'coordinator',
            role: err instanceof WorktreeSyncError ? 'worktree-sync' : 'bootstrap-failure',
            content:
              `Blocked during worktree setup. ${message}. ` +
              'Guildhall stopped retrying until a human fixes the worktree issue and resumes the task.',
            timestamp: now,
          })
          queuedTask.updatedAt = now
          queue.lastUpdated = now
          await this.writeQueue(queue)
        }
        await this.logTickProgress({
          task,
          agent: agent.name,
          beforeStatus,
          afterStatus: 'blocked',
          transitioned: true,
          note: `error: worktree setup failed — ${message}`,
        })
        return {
          kind: 'processed',
          taskId: task.id,
          agent: agent.name,
          beforeStatus,
          afterStatus: 'blocked',
          transitioned: true,
          revisionCount: task.revisionCount,
        }
      }
    }

    const reviewProofPromotion = await this.maybePromoteExistingWorkerReviewProof({
      task,
      beforeStatus,
      activeWorktreePath,
    })
    if (reviewProofPromotion) return reviewProofPromotion

    // When a worktree is freshly minted (or its lockfile has changed), re-run
    // the project's bootstrap inside the worktree so the worker lands in a
    // testable state. Status is stored per-worktree under `<wt>/.guildhall/`
    // so the project's shared memory isn't trampled and the cache disappears
    // naturally when the worktree is cleaned up. Environment failures block,
    // but task-owned repair failures are handed to the worker with evidence.
    const wtBootstrap = resolveEffectiveTaskBootstrapBlock({
      task,
      workspaceProjectPath: this.opts.config.projectPath,
      workspaceBootstrap: this.opts.config.bootstrap ?? undefined,
      workspaceProjects: this.workspaceProjectsForTaskResolution(),
    })
    let handedOffBootstrapVerificationThisDispatch = false
    if (
      !activeWorktreeSyncRecovery &&
      wtBootstrap &&
      wtBootstrap.commands.length > 0 &&
      activeWorktreePath !== effectiveTaskProjectPath
    ) {
      const wtMemoryDir = path.join(activeWorktreePath, '.guildhall')
      const needed = bootstrapNeeded(
        wtMemoryDir,
        activeWorktreePath,
        wtBootstrap.commands,
        wtBootstrap.successGates,
      )
      if (needed) {
        console.log(`[guildhall] bootstrapping worktree ${activeWorktreePath}...`)
        const res = runBootstrap({
          projectPath: activeWorktreePath,
          memoryDir: wtMemoryDir,
          commands: wtBootstrap.commands,
          successGates: wtBootstrap.successGates,
          timeoutMs: wtBootstrap.timeoutMs,
        })
        if (!res.success) {
          const failed = res.steps.find((s) => s.result === 'fail')
          const msg = `worktree bootstrap failed on ${failed?.kind ?? 'step'} \`${failed?.command ?? ''}\` (exit ${failed?.exitCode ?? '?'})`
          const queue = await this.readQueue()
          const queuedTask = queue.tasks.find((candidate) => candidate.id === task.id)
          const taskOwnsBootstrapRepair = taskExplicitlyOwnsBootstrapRepair(queuedTask ?? task)
          if (taskOwnsBootstrapRepair) {
            const now = this.now()
            const output = String(failed?.output ?? '').trim()
            const handoffReason =
              'The task explicitly asks Guildhall to repair this bootstrap failure, so Guildhall is handing the failing setup proof to the worker instead of blocking before dispatch.'
            const content = [
              `${msg}. ${handoffReason}`,
              output ? `\nVerification output:\n${output}` : '',
            ].filter(Boolean).join('\n')
            if (queuedTask) {
              const alreadyLogged = queuedTask.notes.slice(-3).some((note) =>
                note.role === 'bootstrap-verification' &&
                note.content.includes(msg),
              )
              if (!alreadyLogged) {
                queuedTask.notes.push({
                  agentId: 'coordinator',
                  role: 'bootstrap-verification',
                  content,
                  timestamp: now,
                })
                queuedTask.updatedAt = now
                queue.lastUpdated = now
                await this.writeQueue(queue)
              }
            }
            if (!task.notes.slice(-3).some((note) =>
              note.role === 'bootstrap-verification' &&
              note.content.includes(msg),
            )) {
              task.notes.push({
                agentId: 'coordinator',
                role: 'bootstrap-verification',
                content,
                timestamp: now,
              })
              task.updatedAt = now
            }
            await this.writeBootstrapVerificationCheckpoint({
              task,
              agentName: agent.name,
              activeWorktreePath,
              command: failed?.command ?? '',
              output,
              observedAt: now,
            })
            handedOffBootstrapVerificationThisDispatch = true
          } else {
            const now = this.now()
            if (queuedTask) {
              transitionTaskStatus({
                task: queuedTask,
                event: 'block',
                actor: 'orchestrator-worktree-bootstrap',
                evidenceRefs: ['task:worktree-bootstrap:failed'],
                now,
              })
              queuedTask.assignedTo = null
              queuedTask.recoveryCode = 'environment_setup'
              queuedTask.blockReason =
                `Guildhall could not start work because task setup failed: ${msg}. ` +
                'Fix the task bootstrap command or project install state, then resume the task.'
              queuedTask.notes.push({
                agentId: 'coordinator',
                role: 'bootstrap-failure',
                content:
                  `Blocked after repeated task setup failure. ${msg}. ` +
                  'Guildhall stopped retrying until a human fixes the environment and resumes the task.',
                timestamp: now,
              })
              queuedTask.updatedAt = now
              queue.lastUpdated = now
              await this.writeQueue(queue)
            }
            await this.logTickProgress({
              task,
              agent: agent.name,
              beforeStatus,
              afterStatus: 'blocked',
              transitioned: true,
              note: `error: ${msg}`,
            })
            return {
              kind: 'processed',
              taskId: task.id,
              agent: agent.name,
              beforeStatus,
              afterStatus: 'blocked',
              transitioned: true,
              revisionCount: task.revisionCount,
            }
          }
        }
      }
    }

    const relativeTaskProjectPath = path.relative(
      path.resolve(this.opts.config.projectPath),
      path.resolve(effectiveTaskProjectPath),
    )
    const nestedWorktreeProjectPath =
      relativeTaskProjectPath &&
      relativeTaskProjectPath !== '.' &&
      !relativeTaskProjectPath.startsWith(`..${path.sep}`) &&
      relativeTaskProjectPath !== '..' &&
      !path.isAbsolute(relativeTaskProjectPath)
        ? path.resolve(activeWorktreePath, relativeTaskProjectPath)
        : null
    const activeTaskWorktreeProjectPath =
      nestedWorktreeProjectPath && existsSync(nestedWorktreeProjectPath)
        ? nestedWorktreeProjectPath
        : activeWorktreePath

    const ctx = await buildContext(task, this.opts.config.memoryDir, {
      projectSkillsEnabled: this.opts.config.skills?.projectLocal?.enabled === true,
    })
    const tasksPath = this.tasksPath()
    const likelyTargetFiles = resolveLikelyTaskFiles(task)
    normalizeAutomatedAcceptanceCriterionCommands({
      task,
      workspaceProjectPath: this.opts.config.projectPath,
      workspaceProjects: this.workspaceProjectsForTaskResolution(),
    })
    const effectiveTaskSuccessGatesRaw =
      beforeStatus === 'gate_check' || beforeStatus === 'in_progress'
        ? resolveEffectiveTaskSuccessGates({
            task,
            workspaceProjectPath: this.opts.config.projectPath,
            ...(this.opts.config.bootstrap
              ? { workspaceBootstrap: this.opts.config.bootstrap }
              : {}),
            workspaceProjects: this.workspaceProjectsForTaskResolution(),
            likelyTargetFiles,
          })
        : undefined
    const effectiveTaskVerificationCommandsRaw =
      beforeStatus === 'in_progress'
        ? resolveEffectiveTaskVerificationCommands({
            task,
            workspaceProjectPath: this.opts.config.projectPath,
            ...(this.opts.config.bootstrap
              ? { workspaceBootstrap: this.opts.config.bootstrap }
              : {}),
            workspaceProjects: this.workspaceProjectsForTaskResolution(),
            likelyTargetFiles,
          })
        : undefined
    const effectiveTaskSuccessGates = rewriteWorkspaceCommandsForIsolatedTaskWorktree({
      commands: effectiveTaskSuccessGatesRaw,
      workspaceProjectPath: this.opts.config.projectPath,
      taskProjectPath: effectiveTaskProjectPath,
      activeTaskWorktreeProjectPath,
    })
    const effectiveTaskVerificationCommands = rewriteWorkspaceCommandsForIsolatedTaskWorktree({
      commands: effectiveTaskVerificationCommandsRaw,
      workspaceProjectPath: this.opts.config.projectPath,
      taskProjectPath: effectiveTaskProjectPath,
      activeTaskWorktreeProjectPath,
    })

    // FR-24: slot allocation shapes the prompt + env for the worker. Slot is
    // released after the agent returns (or throws).
    const slot = await this.allocateSlotForTask(task)
    const slotPromptRule = slot ? slotSystemPromptRule(slot) : null
    const rawCheckpoint =
      typeof agent.loadToolMetadata === 'function'
        ? await readCheckpoint(this.opts.config.memoryDir, task.id).catch(() => null)
        : null
    const checkpoint = shouldUseCheckpointForTask(task, rawCheckpoint) ? rawCheckpoint : null
    const checkpointNextAction = normalizedWorkerCheckpointNextAction(task, checkpoint)
    const checkpointSafeSurface = checkpoint
      ? checkpointSafeNextMutationSurface(
          checkpoint.filesTouched,
          checkpoint.resumeContext?.companionFiles ?? [],
          checkpoint.resumeContext?.verification ?? [],
        )
      : []
    const immediateResumeInstructions = renderImmediateResumeInstructions(
      task,
      agent.name,
      checkpoint,
      checkpointNextAction,
      effectiveTaskProjectPath,
      activeWorktreePath,
    )
    const worktreeSyncRecoveryInstructions = activeWorktreeSyncRecovery
      ? [
          '**Worktree merge recovery:** Git has an unfinished merge from the current base branch.',
          `Resolve only the reported conflict paths (${activeWorktreeSyncRecovery.conflictPaths.join(', ')}) in ${activeWorktreePath}, stage the resolution, and finish the merge commit before continuing ordinary task work.`,
          `The base branch is ${activeWorktreeSyncRecovery.baseBranch}. Do not declare this resolved, move to review, or ask the owner to choose a side until \`git status\` shows the merge is complete.`,
        ].join('\n')
      : null

    const prompt = [
      ctx.formatted,
      '',
      `**Task-state handle (for task tools):** ${tasksPath}`,
      '**Task-state authority:** The injected current-task packet and task tools are authoritative. Do not inspect or edit this path with filesystem tools; its compatibility projection may omit database-authoritative tasks.',
      `**Memory dir (for tool calls):** ${this.opts.config.memoryDir}`,
      `**Current task ID (for task tools):** ${task.id}`,
      'When a tool requires taskId, use the current task ID exactly. Never use placeholders such as [TASK_ID], <task-id>, or TODO.',
      `**Task project path:** ${effectiveTaskProjectPath}`,
      ...(activeWorktreePath !== effectiveTaskProjectPath
        ? [`**Worktree (for code edits):** ${activeWorktreePath}`]
        : []),
      ...(activeTaskWorktreeProjectPath !== activeWorktreePath
        ? [`**Worktree task project path (for shell/gates):** ${activeTaskWorktreeProjectPath}`]
        : []),
      ...(beforeStatus === 'gate_check'
        ? ['', renderTaskScopedGateInstructions({
            projectPath: activeWorktreePath,
            successGates: effectiveTaskSuccessGates,
          })]
        : []),
      ...(beforeStatus === 'in_progress'
        ? ['', renderTaskScopedVerificationInstructions({
            projectPath: activeTaskWorktreeProjectPath,
            verificationCwd: activeWorktreePath,
            successGates: effectiveTaskVerificationCommands,
          })]
        : []),
      ...(immediateResumeInstructions ? ['', immediateResumeInstructions] : []),
      ...(worktreeSyncRecoveryInstructions ? ['', worktreeSyncRecoveryInstructions] : []),
      ...(slotPromptRule ? ['', slotPromptRule] : []),
      '',
      promptSuffix,
    ].join('\n')
    try {
      await writeContextDebugRecord({
        memoryDir: this.opts.config.memoryDir,
        workspacePath: this.opts.config.projectPath,
        ...(activeWorktreePath ? { activeWorktreePath } : {}),
        task,
        ctx,
        agentName: agent.name,
        modelId: modelForAgentName(agent.name, this.opts.config.models),
        temperature: temperatureForRole(roleForAgentName(agent.name) as Parameters<typeof temperatureForRole>[0]),
        prompt,
      })
    } catch (err) {
      console.warn('[guildhall] failed to record context debug snapshot:', err)
    }

    // FR-15: per-task permission mode override; re-applied every dispatch so
    // narrowed modes don't stick on long-lived agents.
    if (typeof agent.setPermissionMode === 'function') {
      const requested = task.permissionMode
        ? taskModeToPermissionMode(task.permissionMode)
        : PermissionMode.FULL_AUTO
      agent.setPermissionMode(requested)
    }
    if (typeof agent.setPromptCacheKey === 'function') {
      const role = roleForAgentName(agent.name)
      agent.setPromptCacheKey(buildPromptCacheKey({
        provider: this.opts.providerName ?? 'none',
        projectId: this.opts.config.workspaceId,
        taskId: task.id,
        agentRole: role,
        sessionId: `${this.opts.config.workspaceId}-${role}`,
      }))
    }
    if (typeof agent.setApiRequestOptions === 'function') {
      const role = roleForAgentName(agent.name)
      agent.setApiRequestOptions(resolveModelApiPolicy({
        role: role as ModelApiRole,
        modelId: modelForAgentName(agent.name, this.opts.config.models),
      }))
    }
    const priorAgentTaskId = typeof agent.getToolMetadata === 'function'
      ? String(agent.getToolMetadata()['current_task_id'] ?? '').trim()
      : ''
    if (
      priorAgentTaskId &&
      priorAgentTaskId !== task.id &&
      typeof agent.resetConversation === 'function'
    ) {
      agent.resetConversation()
    }
    if (typeof agent.loadToolMetadata === 'function') {
      const likelyTargetFiles = resolveLikelyTaskFiles(task)
      const scopeDecisionTexts = resolvedScopeDecisionTexts(task)
      const gateScopeExceptions = task.gateScopeExceptions ?? []
      const activeRecoveryPlan = activeRecoveryPlaybookMetadata(task)
      agent.loadToolMetadata({
        current_task_id: task.id,
        current_task_title: task.title,
        current_task_spec_excerpt: task.spec?.slice(0, 4000) ?? '',
        current_agent_id: agent.name,
        memory_dir: this.opts.config.memoryDir,
        tasks_path: tasksPath,
        current_task_project_path: effectiveTaskProjectPath,
        current_task_workspace_project_path: this.opts.config.projectPath,
        ...(activeWorktreePath ? { current_task_worktree_path: activeWorktreePath } : {}),
        ...(activeTaskWorktreeProjectPath !== activeWorktreePath
          ? { current_task_worktree_project_path: activeTaskWorktreeProjectPath }
          : {}),
        ...(activeWorktreeSyncRecovery
          ? { current_task_worktree_sync_recovery: activeWorktreeSyncRecovery }
          : {}),
        ...(likelyTargetFiles.length > 0
          ? { current_task_likely_target_files: likelyTargetFiles }
          : {}),
        ...(effectiveTaskSuccessGates !== undefined
          ? { current_task_success_gates: effectiveTaskSuccessGates }
          : {}),
        ...(effectiveTaskVerificationCommands !== undefined
          ? { current_task_verification_commands: effectiveTaskVerificationCommands }
          : {}),
        ...(effectiveTaskVerificationCommands !== undefined
          ? { current_task_verification_cwd: activeWorktreePath }
          : {}),
        ...(scopeDecisionTexts.length > 0
          ? { current_task_resolved_scope_decisions: scopeDecisionTexts }
          : {}),
        ...(gateScopeExceptions.length > 0
          ? { current_task_gate_scope_exceptions: gateScopeExceptions }
          : {}),
        ...(activeRecoveryPlan.allowedTools.length > 0
          ? {
              current_task_recovery_playbook: activeRecoveryPlan.playbook,
              current_task_recovery_allowed_tools: activeRecoveryPlan.allowedTools,
            }
          : {}),
        ...(checkpointNextAction
          ? { current_task_checkpoint_next_action: checkpointNextAction }
          : {}),
        ...(checkpoint?.nextActionKind
          ? { current_task_checkpoint_next_action_kind: checkpoint.nextActionKind }
          : {}),
        ...(checkpoint?.filesTouched.length
          ? { current_task_checkpoint_files_touched: checkpoint.filesTouched }
          : {}),
        ...(checkpoint?.resumeContext?.verification?.length
          ? {
              current_task_checkpoint_verification: checkpoint.resumeContext.verification,
              current_task_verification_history: checkpoint.resumeContext.verification,
            }
          : {}),
        ...(checkpoint?.resumeContext?.companionFiles?.length
          ? { current_task_checkpoint_companion_files: checkpoint.resumeContext.companionFiles }
          : {}),
        ...(checkpoint?.resumeContext?.workingHypothesis
          ? { current_task_checkpoint_working_hypothesis: checkpoint.resumeContext.workingHypothesis }
          : {}),
        ...(checkpointSafeSurface.length
          ? { current_task_checkpoint_safe_mutation_surface: checkpointSafeSurface }
          : {}),
        ...(this.hasStructuredSelfCritique(task)
          ? { current_task_has_structured_self_critique: true }
          : {}),
        ...(this.hasReviewProofPacket(task)
          ? { current_task_has_review_proof_packet: true }
          : {}),
      })
    }

    // FR-30: register the agent with the liveness tracker for the duration
    // of this generate() call.
    this.livenessTracker.register(agent.name, task.id)
    await this.emitBackendEvent({
      type: 'agent_started',
      task_id: task.id,
      task_title: task.title,
      agent_name: agent.name,
      from_status: beforeStatus,
      message: `${agent.name} is working on ${task.title}`,
    })
    this.livenessTracker.touch(agent.name)
    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: task.id,
      agent_name: agent.name,
      message: 'Waiting for the model to respond.',
    })

    let generatedText = ''
    let generatedMetaIntakeDraft: string | null = null
    let successfulAgentMetadata: Record<string, unknown> | undefined
    let checkpointNoProgressStatusSeen = false
    const retryKey = `${agent.name}:${task.id}`
    const priorMessageCount = Array.isArray(agent.messages) ? agent.messages.length : 0
    const agentGenerateTimeoutMs = resolveAgentGenerateTimeoutMs(
      agent.name,
      this.opts.agentGenerateTimeoutMs,
    )
    const agentGenerateWallClockTimeoutMs = resolveAgentGenerateWallClockTimeoutMs(
      agent.name,
      this.opts.agentGenerateWallClockTimeoutMs,
      agentGenerateTimeoutMs,
    )
    const controller = new AbortController()
    const externalAbort = this.opts.abortSignal
    const abortListener = () => controller.abort()
    let inactivityTimeoutHandle: ReturnType<typeof setTimeout> | undefined
    let wallClockTimeoutHandle: ReturnType<typeof setTimeout> | undefined
    try {
      if (agent.name === 'worker-agent') {
        // A new worker pass owns the next pause snapshot. Do not carry an
        // earlier owner-pause marker into a later clean pass.
        const recovery = await this.readWorkerRecovery(task.id)
        await this.patchWorkerRecovery(task.id, {
          ownerPauseWithSavedWorkAt: undefined,
          ...(recovery.worktreeObservation?.state === 'dirty'
            ? { worktreeObservation: undefined }
            : {}),
        })
      }
      externalAbort?.addEventListener('abort', abortListener)
      const result = typeof agent.generateWithEvents === 'function'
        ? await new Promise<Awaited<ReturnType<typeof agent.generateWithEvents>>>((resolve, reject) => {
            const resetInactivityTimeout = () => {
              if (inactivityTimeoutHandle) clearTimeout(inactivityTimeoutHandle)
              inactivityTimeoutHandle = setTimeout(() => {
                controller.abort()
                reject(new Error(agentInactivityTimeoutMessage(agent.name, agentGenerateTimeoutMs)))
              }, agentGenerateTimeoutMs)
            }
            if (agentGenerateWallClockTimeoutMs != null) {
              wallClockTimeoutHandle = setTimeout(() => {
                controller.abort()
                reject(new Error(agentWallClockTimeoutMessage(agent.name, agentGenerateWallClockTimeoutMs)))
              }, agentGenerateWallClockTimeoutMs)
            }

            resetInactivityTimeout()
            agent.generateWithEvents!(
              prompt,
              async (event) => {
                this.livenessTracker.touch(agent.name)
                resetInactivityTimeout()
                if (
                  agent.name === 'worker-agent' &&
                  (event.type === 'tool_execution_started' || event.type === 'tool_execution_completed')
                ) {
                  await this.observeWorkerWorktreeAtToolBoundary(task)
                }
                const backendEvent = streamEventToBackendEvent(event, {
                  taskId: task.id,
                  agentName: agent.name,
                })
                if (event.type === 'status' && event.statusCode === 'no_progress') {
                  checkpointNoProgressStatusSeen = true
                }
                if (backendEvent) await this.emitBackendEvent(backendEvent)
              },
              { signal: controller.signal },
            ).then(resolve, reject)
          })
        : await Promise.race([
            agent.generate(prompt),
            new Promise<never>((_, reject) => {
              inactivityTimeoutHandle = setTimeout(() => {
                reject(new Error(agentInactivityTimeoutMessage(agent.name, agentGenerateTimeoutMs)))
              }, agentGenerateTimeoutMs)
            }),
            ...(agentGenerateWallClockTimeoutMs != null
              ? [
                  new Promise<never>((_, reject) => {
                    wallClockTimeoutHandle = setTimeout(() => {
                      reject(new Error(agentWallClockTimeoutMessage(agent.name, agentGenerateWallClockTimeoutMs)))
                    }, agentGenerateWallClockTimeoutMs)
                  }),
                ]
              : []),
          ])
      generatedText = result.text
      if (agent.name === 'spec-agent' && beforeStatus === 'exploring') {
        const fallbackText = Array.isArray(result.messages)
          ? chooseExploringFallbackTextForTurn(
              result.messages,
              priorMessageCount,
            )
          : ''
        if (fallbackText.trim().length > 0) generatedText = fallbackText
      }
      if (task.id === META_INTAKE_TASK_ID) {
        generatedMetaIntakeDraft = findMetaIntakeDraftText(result)
      }
      successfulAgentMetadata =
        typeof agent.getToolMetadata === 'function'
          ? agent.getToolMetadata()
          : undefined
      this.emptyAssistantRetries.delete(retryKey)
      this.emptyAssistantResets.delete(retryKey)
      this.specTimeoutRetries.delete(retryKey)
      if (agent.name === 'worker-agent') {
        await this.resetWorkerRecoveryCounters(task.id, [
          'dirtyTimeoutRetries',
          'likelyTargetTimeoutRetries',
          'noVisibleProgressTimeoutRetries',
        ])
      }
    } catch (err) {
      this.livenessTracker.unregister(agent.name)
      await this.emitBackendEvent({
        type: 'agent_finished',
        task_id: task.id,
        agent_name: agent.name,
        from_status: beforeStatus,
        is_error: true,
        message: `${agent.name} stopped on ${task.title}`,
      })
      if (slot) this.slotAllocator?.release(task.id)
      const message = err instanceof Error ? err.message : String(err)

      if (
        beforeStatus === 'review' &&
        /Model returned an empty assistant message/.test(message)
      ) {
        const preservedReview = await this.preserveReviewStateAfterEmptyAssistant({
          taskId: task.id,
          agentName: agent.name,
          beforeStatus,
        })
        if (preservedReview) {
          return preservedReview
        }
      }

      if (
        beforeStatus === 'review' &&
        reviewerMode === 'llm_with_deterministic_fallback'
      ) {
        return await this.applyReviewVerdictInline({
          task,
          queue: queueBefore,
          llmError: message,
          llmFailureCode: reviewerFailureCodeFromError(err),
        })
      }

      await this.logTickProgress({
        task,
        agent: agent.name,
        beforeStatus,
        afterStatus: beforeStatus,
        transitioned: false,
        note: `error: ${message}`,
      })
      if (
        agent.name === 'spec-agent' &&
        beforeStatus === 'exploring' &&
        /Product brief must describe the user\/product outcome|Product brief (?:whyItMattersNow|successMetric)/i.test(message)
      ) {
        // A malformed LLM brief is a recoverable intake failure. The task
        // already has source-backed state, so derive the product outcome and
        // completion boundary from the task graph instead of turning a
        // validator rejection into owner input or another research loop.
        const seededSpec = await this.maybeWriteExploringRecoverySpecSeed(task, { force: true })
        if (seededSpec) return seededSpec
      }
      if (beforeStatus !== 'review' && isRetryableProviderCapacityError(message)) {
        return await this.preserveTaskStateOnRetryableProviderError({
          taskId: task.id,
          agentName: agent.name,
          beforeStatus,
          error: message,
        })
      }
      if (/Model returned an empty assistant message/.test(message)) {
        const retries = (this.emptyAssistantRetries.get(retryKey) ?? 0) + 1
        this.emptyAssistantRetries.set(retryKey, retries)
        const resets = this.emptyAssistantResets.get(retryKey) ?? 0
        if (resets >= 1) {
          const preserved = await this.preserveDurableProgressAfterEmptyAssistant({
            taskId: task.id,
            agentName: agent.name,
            beforeStatus,
            agentMetadata: typeof agent.getToolMetadata === 'function'
              ? agent.getToolMetadata()
              : undefined,
          })
          if (preserved) {
            this.emptyAssistantRetries.delete(retryKey)
            this.emptyAssistantResets.delete(retryKey)
            return preserved
          }
        }
        if (retries <= 2) {
          await this.emitBackendEvent({
            type: 'line_complete',
            task_id: task.id,
            agent_name: agent.name,
            message: `Model returned an empty reply; Guildhall will retry once (attempt ${retries}/2) without changing task state.`,
          })
          return {
            kind: 'processed',
            taskId: task.id,
            agent: agent.name,
            beforeStatus,
            afterStatus: beforeStatus,
            transitioned: false,
            note: `Model returned an empty reply; Guildhall will retry once (attempt ${retries}/2) without changing task state.`,
            revisionCount: task.revisionCount,
          }
        }
        if (resets < 1 && typeof agent.resetConversation === 'function') {
          agent.resetConversation()
          this.emptyAssistantResets.set(retryKey, resets + 1)
          this.emptyAssistantRetries.set(retryKey, 0)
          await this.emitBackendEvent({
            type: 'line_complete',
            task_id: task.id,
            agent_name: agent.name,
            message:
              'Model kept returning empty replies. Resetting the agent conversation once and retrying cleanly.',
          })
          return {
            kind: 'processed',
            taskId: task.id,
            agent: agent.name,
            beforeStatus,
            afterStatus: beforeStatus,
            transitioned: false,
            revisionCount: task.revisionCount,
          }
        }
        const preserved = await this.preserveDurableProgressAfterEmptyAssistant({
          taskId: task.id,
          agentName: agent.name,
          beforeStatus,
          agentMetadata: typeof agent.getToolMetadata === 'function'
            ? agent.getToolMetadata()
            : undefined,
        })
        if (preserved) {
          this.emptyAssistantRetries.delete(retryKey)
          this.emptyAssistantResets.delete(retryKey)
          return preserved
        }
        const preservedReview = await this.preserveReviewStateAfterEmptyAssistant({
          taskId: task.id,
          agentName: agent.name,
          beforeStatus,
        })
        if (preservedReview) {
          this.emptyAssistantRetries.delete(retryKey)
          this.emptyAssistantResets.delete(retryKey)
          return preservedReview
        }
        this.emptyAssistantRetries.delete(retryKey)
        this.emptyAssistantResets.delete(retryKey)
      } else {
        this.emptyAssistantRetries.delete(retryKey)
        this.emptyAssistantResets.delete(retryKey)
      }
      if (/Exceeded maximum turn limit/.test(message)) {
        if (agent.name === 'spec-agent' && beforeStatus === 'exploring') {
          const fallbackText = Array.isArray(agent.messages)
            ? chooseExploringFallbackTextForTurn(
                agent.messages,
                priorMessageCount,
              )
            : ''
          if (fallbackText.trim().length > 0) {
            await this.withQueueWriteLock(async () => {
              await this.persistExploringTranscript({
                taskId: task.id,
                generatedText: fallbackText,
              })
            })
          }
        }
        const preserved = await this.preserveDurableProgressAfterTurnLimit({
          taskId: task.id,
          agentName: agent.name,
          beforeStatus,
          beforeSpec: task.spec,
          beforeProductBriefJson: JSON.stringify(task.productBrief ?? null),
          interruption: 'turn_limit',
        })
        if (preserved) {
          return preserved
        }
        const importedDraftQuestion = hasFreshReframeBoundary(task)
          ? null
          : await this.preserveImportedDraftTurnLimitAsOwnerQuestion({
              taskId: task.id,
              agentName: agent.name,
              beforeStatus,
              message,
            })
        if (importedDraftQuestion) {
          return importedDraftQuestion
        }
        const approvedSpecRecovery = agent.name === 'spec-agent' &&
          beforeStatus === 'exploring' &&
          Boolean(task.productBrief?.approvedAt?.trim())
        if (approvedSpecRecovery) {
          const now = this.now()
          const queue = await this.readQueue()
          const liveTask = queue.tasks.find((candidate) => candidate.id === task.id)
          if (liveTask && liveTask.status === 'exploring') {
            // An approved brief answers the only owner question in this lane:
            // what outcome is authorized. A model exhausting one conversation
            // is operational recovery, not a new approval checkpoint.
            liveTask.assignedTo = null
            liveTask.updatedAt = now
            liveTask.notes = Array.isArray(liveTask.notes) ? liveTask.notes : []
            liveTask.notes.push({
              agentId: 'coordinator',
              role: 'runtime',
              content:
                'The spec lane exhausted its conversation before saving a draft. Guildhall kept the approved task in shaping, reset the exhausted conversation, and will retry from the saved brief and source evidence.',
              timestamp: now,
            })
            queue.lastUpdated = now
            await this.writeQueue(queue)
            if (typeof agent.resetConversation === 'function') {
              agent.resetConversation()
            }
            await this.emitBackendEvent({
              type: 'line_complete',
              task_id: task.id,
              agent_name: agent.name,
              message:
                'The spec lane exhausted its conversation. Guildhall reset that conversation and will retry from the approved brief instead of creating an owner blocker.',
            })
            return {
              kind: 'processed',
              taskId: task.id,
              agent: 'coordinator-spec-recovery',
              beforeStatus,
              afterStatus: liveTask.status,
              transitioned: false,
              note: 'approved spec conversation reset for retry',
              revisionCount: liveTask.revisionCount,
            }
          }
        }
        const escalation = await raiseEscalation({
          tasksPath,
          progressPath: this.progressPath(),
          taskId: task.id,
          agentId: agent.name,
          reason: 'human_judgment_required',
          recoveryCode: 'worker_turn_limit',
          summary: `${friendlyRuntimeAgentName(agent.name)} stopped after hitting its turn limit.`,
          details: message,
        })
        if (escalation.success && escalation.escalationId) {
          await this.annotateWorkerBlockedClassification({
            taskId: task.id,
            agentId: 'coordinator',
            classification: {
              class: 'model_tool_use_failure',
              confidence: 'medium',
              evidence: [{
                kind: 'task',
                summary: `${friendlyRuntimeAgentName(agent.name)} stopped after hitting its turn limit.`,
                ref: message,
              }],
              scope: 'task',
              safePlaybooks: ['ask_concrete_human_question'],
              needsHuman: true,
              humanQuestion:
                'The worker exhausted its turn budget without a safe next autonomous move. Should Guildhall retry from the checkpoint, narrow the task, or stop?',
            },
          })
          return {
            kind: 'escalated',
            taskId: task.id,
            agent: agent.name,
            reason: message,
            escalationId: escalation.escalationId,
          }
        }
      }
      if (
        agent.name === 'spec-agent' &&
        beforeStatus === 'exploring' &&
        /timed out after \d+ms|exceeded \d+ms total turn budget/i.test(message)
      ) {
        const preserved = await this.preserveDurableProgressAfterTurnLimit({
          taskId: task.id,
          agentName: agent.name,
          beforeStatus,
          beforeSpec: task.spec,
          beforeProductBriefJson: JSON.stringify(task.productBrief ?? null),
          interruption: 'timeout',
        })
        if (preserved) {
          this.specTimeoutRetries.delete(retryKey)
          return preserved
        }
        if (checkpointNoProgressStatusSeen) {
          const seededSpec = await this.maybeWriteExploringRecoverySpecSeed(task, { force: true })
          if (seededSpec) {
            this.specTimeoutRetries.delete(retryKey)
            return seededSpec
          }
          const now = this.now()
          const queue = await this.readQueue()
          const liveTask = queue.tasks.find((candidate) => candidate.id === task.id)
          if (liveTask && liveTask.status === 'exploring') {
            liveTask.assignedTo = null
            liveTask.updatedAt = now
            liveTask.notes.push({
              agentId: 'coordinator',
              role: 'runtime',
              content:
                'The spec lane timed out after continuing read-only exploration despite a durable-progress nudge. Guildhall preserved the task for runtime recovery instead of asking the owner to decide whether to retry.',
              timestamp: now,
            })
            queue.lastUpdated = now
            await this.writeQueue(queue)
            await this.emitBackendEvent({
              type: 'line_complete',
              task_id: task.id,
              agent_name: agent.name,
              message:
                'Spec shaping timed out after the durable-progress nudge. Guildhall preserved this as runtime recovery instead of owner input.',
            })
            this.specTimeoutRetries.delete(retryKey)
            return {
              kind: 'processed',
              taskId: task.id,
              agent: agent.name,
              beforeStatus,
              afterStatus: liveTask.status,
              transitioned: false,
              revisionCount: liveTask.revisionCount,
            }
          }
        }
        const specTimeoutRetries = (this.specTimeoutRetries.get(retryKey) ?? 0) + 1
        this.specTimeoutRetries.set(retryKey, specTimeoutRetries)
        if (specTimeoutRetries <= 1) {
          await this.emitBackendEvent({
            type: 'line_complete',
            task_id: task.id,
            agent_name: agent.name,
            message:
              'Spec shaping timed out before saving durable progress. Guildhall will retry this shaping lane once before preserving it as runtime recovery.',
          })
          return {
            kind: 'processed',
            taskId: task.id,
            agent: agent.name,
            beforeStatus,
            afterStatus: beforeStatus,
            transitioned: false,
            revisionCount: task.revisionCount,
          }
        }
        const summary = 'Spec shaping timed out before saving durable progress.'
        const now = this.now()
        const queue = await this.readQueue()
        const liveTask = queue.tasks.find((candidate) => candidate.id === task.id)
        if (liveTask) {
          liveTask.assignedTo = null
          liveTask.updatedAt = now
          if (!Array.isArray(liveTask.notes)) liveTask.notes = []
          liveTask.notes.push({
            agentId: 'coordinator',
            role: 'runtime',
            content:
              'The spec lane timed out twice before saving durable progress. Guildhall preserved the task for runtime recovery instead of asking the owner to decide whether to retry.',
            timestamp: now,
          })
          queue.lastUpdated = now
          await this.writeQueue(queue)
        }
        this.specTimeoutRetries.delete(retryKey)
        await this.emitBackendEvent({
          type: 'line_complete',
          task_id: task.id,
          agent_name: agent.name,
          message:
            `${summary} Guildhall preserved this as runtime recovery instead of owner input.`,
        })
        return {
          kind: 'processed',
          taskId: task.id,
          agent: agent.name,
          beforeStatus,
          afterStatus: liveTask?.status ?? task.status,
          transitioned: false,
          note: `${summary} Runtime recovery recorded.`,
          revisionCount: liveTask?.revisionCount ?? task.revisionCount,
        }
      }
      if (
        agent.name === 'worker-agent' &&
        beforeStatus === 'in_progress' &&
        /timed out after \d+ms|exceeded \d+ms total turn budget/.test(message)
      ) {
        const likelyWorkerTargets = resolveLikelyTaskFiles(task)
        const worktreeDirty =
          typeof task.worktreePath === 'string' &&
          task.worktreePath.trim().length > 0 &&
          !(await this.gitDriver.isClean(resolveRuntimePath(task.worktreePath)))
        if (worktreeDirty) {
          const dirtyTimeoutRetries = ((await this.readWorkerRecovery(task.id)).dirtyTimeoutRetries ?? 0) + 1
          await this.patchWorkerRecovery(task.id, { dirtyTimeoutRetries })
          if (dirtyTimeoutRetries > 2) {
            const summary = 'Worker repeatedly hit its turn budget after saving partial work.'
            const classification: FailureClassification = {
              class: 'model_tool_use_failure',
              confidence: 'medium',
              evidence: [{
                kind: 'task',
                summary,
                ref: message,
              }],
              scope: 'task',
              safePlaybooks: ['review_partial_diff'],
              needsHuman: false,
            }
            const now = this.now()
            const queue = await this.readQueue()
            const liveTask = queue.tasks.find((candidate) => candidate.id === task.id)
            if (liveTask && liveTask.status === 'in_progress') {
              await this.resetWorkerRecoveryCounters(task.id, ['dirtyTimeoutRetries'])
              liveTask.status = 'review'
              liveTask.assignedTo = 'reviewer-agent'
              liveTask.updatedAt = now
              appendFailureClassificationNote(liveTask, classification, {
                agentId: 'coordinator',
                timestamp: now,
              })
              liveTask.notes = Array.isArray(liveTask.notes) ? liveTask.notes : []
              liveTask.notes.push({
                agentId: 'coordinator',
                role: 'runtime',
                content:
                  `${summary} Guildhall is handing the saved partial diff to review instead of asking the owner to choose retry, narrowing, or provider switch.`,
                timestamp: now,
              })
              queue.lastUpdated = now
              await this.writeQueue(queue)
              await this.emitBackendEvent({
                type: 'task_transition',
                task_id: task.id,
                from_status: beforeStatus,
                to_status: 'review',
                agent_name: agent.name,
                message:
                  `${summary} Guildhall handed the partial diff to review instead of owner input.`,
              })
              return {
                kind: 'processed',
                taskId: task.id,
                agent: agent.name,
                beforeStatus,
                afterStatus: 'review',
                transitioned: true,
                revisionCount: liveTask.revisionCount,
              }
            }
          }
          const runtimeNote =
            dirtyTimeoutRetries === 1
              ? 'The worker hit its turn budget after making worktree edits, so Guildhall is preserving that partial implementation for the next pass.'
              : 'The worker hit its turn budget again with dirty work preserved. Guildhall will retry once more before handing the saved partial diff to review.'
          await this.appendRuntimeTaskNote({
            taskId: task.id,
            agentId: agent.name,
            content: runtimeNote,
          })
          await this.emitBackendEvent({
            type: 'line_complete',
            task_id: task.id,
            agent_name: agent.name,
            message: runtimeNote,
          })
          return {
            kind: 'processed',
            taskId: task.id,
            agent: agent.name,
            beforeStatus,
            afterStatus: beforeStatus,
            transitioned: false,
            note: runtimeNote,
            revisionCount: task.revisionCount,
          }
        }
        if (!worktreeDirty) {
          const hasLikelyTargets = likelyWorkerTargets.length > 0
          const workerRecovery = await this.readWorkerRecovery(task.id)
          const timeoutField = hasLikelyTargets
            ? 'likelyTargetTimeoutRetries'
            : 'noVisibleProgressTimeoutRetries'
          const likelyTargetTimeoutRetries = (workerRecovery[timeoutField] ?? 0) + 1
          await this.patchWorkerRecovery(task.id, { [timeoutField]: likelyTargetTimeoutRetries })
          if (likelyTargetTimeoutRetries <= 1) {
            const runtimeNote = hasLikelyTargets
              ? 'The worker timed out before mutating a likely target file. Guildhall will retry once with the same task context and require a concrete file-tool mutation or focused verification before routing runtime recovery.'
              : 'The worker timed out before producing visible progress. Guildhall will retry once with the same task context and require a concrete file-tool mutation, focused verification, checkpoint, or explicit escalation before routing runtime recovery.'
            await this.appendRuntimeTaskNote({
              taskId: task.id,
              agentId: agent.name,
              content: runtimeNote,
            })
            await this.emitBackendEvent({
              type: 'line_complete',
              task_id: task.id,
              agent_name: agent.name,
              message: runtimeNote,
            })
            return {
              kind: 'processed',
              taskId: task.id,
              agent: agent.name,
              beforeStatus,
              afterStatus: beforeStatus,
              transitioned: false,
              note: runtimeNote,
              revisionCount: task.revisionCount,
            }
          }
          const summary = hasLikelyTargets
            ? 'Worker timed out after failing to mutate the likely target file.'
            : 'Worker timed out after producing no visible progress.'
          const classification: FailureClassification = {
            class: hasLikelyTargets ? 'model_tool_use_failure' : 'provider_unavailable',
            confidence: 'medium',
            evidence: [{
              kind: 'task',
              summary: hasLikelyTargets
                ? 'Worker timed out before mutating the likely target file.'
                : 'Worker timed out before producing visible progress.',
              ref: message,
            }],
            scope: 'task',
            safePlaybooks: ['retry_current_task_context'],
            needsHuman: false,
          }
          const recoveryPlan = resolveRecoveryPlan({
            taskId: task.id,
            classification,
            notes: task.notes,
          })
          const now = this.now()
          const queue = await this.readQueue()
          const liveTask = queue.tasks.find((candidate) => candidate.id === task.id)
          if (liveTask && liveTask.status === 'in_progress') {
            appendFailureClassificationNote(liveTask, classification, {
              agentId: 'coordinator',
              timestamp: now,
            })
            appendRecoveryPlaybookNote(liveTask, recoveryPlan, {
              agentId: 'coordinator',
              timestamp: now,
              status: 'started',
              summary: hasLikelyTargets
                ? 'Worker timed out before mutating the likely target file after a retry. Guildhall kept this as model/tool-use recovery instead of asking the owner to choose retry, provider switch, or task narrowing.'
                : 'Worker timed out without visible progress after a retry. Guildhall kept this in provider recovery instead of asking the owner to choose retry or provider switch.',
            })
            liveTask.assignedTo = 'worker-agent'
            liveTask.updatedAt = now
            queue.lastUpdated = now
            await this.writeQueue(queue)
            await this.resetWorkerRecoveryCounters(task.id, [timeoutField])
            if (typeof agent.resetConversation === 'function') {
              agent.resetConversation()
            }
            await this.emitBackendEvent({
              type: 'line_complete',
              task_id: task.id,
              agent_name: agent.name,
              message: hasLikelyTargets
                ? 'Worker timed out before mutating the likely target file after a retry. Guildhall kept the task in model/tool-use recovery instead of surfacing a human blocker.'
                : 'Worker timed out without visible progress after a retry. Guildhall kept the task in provider recovery instead of surfacing a human blocker.',
            })
            return {
              kind: 'processed',
              taskId: task.id,
              agent: hasLikelyTargets ? 'coordinator-worker-recovery' : 'coordinator-provider-recovery',
              beforeStatus,
              afterStatus: 'in_progress',
              transitioned: false,
              note: hasLikelyTargets
                ? 'model/tool-use recovery recorded'
                : 'provider recovery recorded',
              revisionCount: liveTask.revisionCount,
            }
          }
          const escalation = await raiseEscalation({
            tasksPath,
            progressPath: this.progressPath(),
            taskId: task.id,
            agentId: agent.name,
            reason: 'human_judgment_required',
            recoveryCode: hasLikelyTargets ? 'worker_timeout_likely_target' : 'worker_timeout_no_progress',
            summary,
            details:
              `${message}\n\n` +
              (
                hasLikelyTargets
                  ? `Task stayed in progress without visible worktree edits after Guildhall ` +
                    `demanded concrete progress on the authoritative likely target files.`
                  : `Task stayed in progress without visible worktree edits, a checkpoint, focused verification, or an explicit escalation after Guildhall retried the worker lane.`
              ),
          })
          if (escalation.success && escalation.escalationId) {
            await this.resetWorkerRecoveryCounters(task.id, [timeoutField])
            await this.annotateWorkerBlockedClassification({
              taskId: task.id,
              agentId: 'coordinator',
              classification: {
                class: 'provider_unavailable',
                confidence: 'medium',
                evidence: [{
                  kind: 'task',
                  summary: hasLikelyTargets
                    ? 'Worker timed out before mutating the likely target file.'
                    : 'Worker timed out before producing visible progress.',
                  ref: message,
                }],
                scope: 'task',
                safePlaybooks: ['ask_concrete_human_question'],
                needsHuman: true,
                humanQuestion:
                  hasLikelyTargets
                    ? 'The worker timed out without touching the likely target file. Should Guildhall retry this lane, switch provider, or narrow the task?'
                    : 'The worker timed out without producing visible progress. Should Guildhall retry this lane, switch provider, or narrow the task?',
              },
            })
            return {
              kind: 'escalated',
              taskId: task.id,
              agent: agent.name,
              reason: message,
              escalationId: escalation.escalationId,
            }
          }
        }
      }
      if (
        agent.name === 'gate-checker-agent' &&
        beforeStatus === 'gate_check' &&
        /timed out after \d+ms|exceeded \d+ms total turn budget/i.test(message)
      ) {
        const preservedGateCheck = await this.preserveGateCheckAfterRecordedHardGateProof({
          taskId: task.id,
          agentName: agent.name,
          beforeStatus,
          message,
        })
        if (preservedGateCheck) return preservedGateCheck
      }
      return {
        kind: 'agent-error',
        taskId: task.id,
        agent: agent.name,
        error: message,
      }
    } finally {
      if (inactivityTimeoutHandle) clearTimeout(inactivityTimeoutHandle)
      if (wallClockTimeoutHandle) clearTimeout(wallClockTimeoutHandle)
      externalAbort?.removeEventListener('abort', abortListener)
    }

    this.livenessTracker.unregister(agent.name)
    await this.emitBackendEvent({
      type: 'agent_finished',
      task_id: task.id,
      agent_name: agent.name,
      from_status: beforeStatus,
      message: `${agent.name} finished its current step on ${task.title}`,
    })

    // Post-generate queue work is serialized across concurrent dispatches so
    // no two fanout workers clobber each other's writes.
    try {
      return await this.withQueueWriteLock(async () => {
        const queueAfter = await this.readQueue()
        const taskAfter = queueAfter.tasks.find((t) => t.id === task.id) ?? task
        let afterStatus = taskAfter.status
        let transitioned = beforeStatus !== afterStatus
        let processedOutcomeNote: string | undefined
        const taskNoteCountBefore = task.notes?.length ?? 0
        const reviewerNoteCountBefore = countReviewerNotes(task)
        const reviewVerdictCountBefore = task.reviewVerdicts.length
        const recentVerificationResults = readRecentVerificationResults(successfulAgentMetadata)
        const learnedVerificationCommands =
          beforeStatus === 'in_progress' &&
          reconcileAutomatedAcceptanceCommandsFromVerificationResults({
            task: taskAfter,
            workspaceProjectPath: this.opts.config.projectPath,
            workspaceProjects: this.workspaceProjectsForTaskResolution(),
            recentVerificationResults,
          })
        if (learnedVerificationCommands) {
          taskAfter.updatedAt = this.now()
          queueAfter.lastUpdated = this.now()
          await this.writeQueue(queueAfter)
        }

        if (
          task.id === META_INTAKE_TASK_ID &&
          !taskAfter.spec &&
          generatedMetaIntakeDraft
        ) {
          taskAfter.spec = generatedMetaIntakeDraft
          if (taskAfter.status === 'exploring') {
            requestSpecReview(taskAfter, {
              authority: 'owner',
              requestedAt: this.now(),
              requestedBy: 'meta-intake',
            })
          }
          taskAfter.updatedAt = this.now()
          queueAfter.lastUpdated = this.now()
          await this.writeQueue(queueAfter)
          afterStatus = taskAfter.status
          transitioned = true
        }

        if (
          task.id === WORKSPACE_IMPORT_TASK_ID &&
          taskAfter.status === 'exploring' &&
          typeof taskAfter.spec === 'string' &&
          taskAfter.spec.trim().length > 0
        ) {
          requestSpecReview(taskAfter, {
            authority: 'owner',
            requestedAt: this.now(),
            requestedBy: 'workspace-import',
          })
          taskAfter.updatedAt = this.now()
          queueAfter.lastUpdated = this.now()
          await this.writeQueue(queueAfter)
          afterStatus = taskAfter.status
          transitioned = true
        }

        if (
          agent.name === 'spec-agent' &&
          (beforeStatus === 'exploring' || (beforeStatus === 'in_progress' && proofRecoveryNeedsBlueprint)) &&
          (taskAfter.status === 'exploring' || (proofRecoveryNeedsBlueprint && taskAfter.status === 'in_progress')) &&
          typeof taskAfter.spec === 'string' &&
          taskAfter.spec.trim().length > 0 &&
          taskAfter.spec.trim() !== (task.spec ?? '').trim() &&
          !taskHasUnansweredVisibleQuestion(taskAfter) &&
          !this.waitingOwnerInputTaskIds(queueAfter).has(taskAfter.id)
        ) {
          requestSpecReview(taskAfter, {
            authority: 'owner',
            requestedAt: this.now(),
            requestedBy: 'spec-agent',
          })
          taskAfter.assignedTo = null
          taskAfter.updatedAt = this.now()
          taskAfter.notes.push({
            agentId: 'coordinator-recovery',
            role: 'system',
            content:
              'Guildhall promoted a saved spec draft to spec_review after the spec lane wrote durable task state without a status transition.',
            timestamp: taskAfter.updatedAt,
          })
          queueAfter.lastUpdated = taskAfter.updatedAt
          await this.writeQueue(queueAfter)
          afterStatus = taskAfter.status
          transitioned = true
        }

        if (
          agent.name === 'spec-agent' &&
          beforeStatus === 'exploring' &&
          taskAfter.status === 'spec_review' &&
          (task as Task & { proofRecovery?: unknown }).proofRecovery
        ) {
          const proofRecoveryTask = {
            ...taskAfter,
            proofRecovery: (task as Task & { proofRecovery?: unknown }).proofRecovery,
          } as Task
          if (needsSourceShapingForScriptProofRecovery(proofRecoveryTask)) {
            resetCurrentPlanForProofRecovery(taskAfter, {
              reason: 'The selected script-only release still lacks a concrete project-backed proof command. Re-intake the visible project evidence and create bounded proof-setup work if the command is not yet documented.',
              now: this.now(),
              agentId: 'proof-recovery',
              role: 'source-shaping',
            })
            taskAfter.status = 'exploring'
            taskAfter.assignedTo = null
            taskAfter.updatedAt = this.now()
            queueAfter.lastUpdated = taskAfter.updatedAt
            await this.writeQueue(queueAfter)
            afterStatus = taskAfter.status
            transitioned = true
            processedOutcomeNote =
              'The spec lane still lacked a concrete project proof command, so Guildhall cleared the current recovery plan and returned the task to source-backed shaping.'
          }
        }

        let transcriptAppended = false
        if (
          agent.name === 'spec-agent' &&
          beforeStatus === 'exploring' &&
          generatedText.trim().length > 0
        ) {
          const transcript = await this.persistExploringTranscript({
            taskId: task.id,
            generatedText,
          })
          transcriptAppended = transcript.transcriptAppended
        }

        const madeExploringProgress =
          transitioned ||
          taskAfter.updatedAt !== task.updatedAt

        if (
          beforeStatus === 'review' &&
          afterStatus === 'review' &&
          generatedText.trim().length === 0 &&
          countReviewerNotes(taskAfter) === reviewerNoteCountBefore &&
          taskAfter.reviewVerdicts.length === reviewVerdictCountBefore
        ) {
          const fallbackVerdict = deterministicReview(taskAfter, {
            projectPath: taskAfter.projectPath,
            likelyTargetFiles: resolveLikelyTaskFiles(taskAfter),
            gateScopeExceptions: taskAfter.gateScopeExceptions ?? [],
          })
          // Provider prose may be retained as an audit note, but its presence
          // or absence must not decide whether the durable fallback verdict is
          // recorded. Apply the same typed deterministic contract in both
          // cases so an empty/non-empty explanation cannot change the audit
          // trail or later lifecycle recovery.
          const deterministicResult = applyDeterministicVerdict({
            queue: queueAfter,
            taskId: task.id,
            verdict: fallbackVerdict,
            now: this.now(),
            llmError: 'Reviewer returned no valid durable machine verdict.',
            llmFailureCode: 'invalid_review_contract',
          })
          if (generatedText.trim().length > 0) {
            taskAfter.notes.push({
              agentId: 'reviewer-agent',
              role: 'reviewer',
              content: generatedText.trim(),
              timestamp: this.now(),
            })
          }
          afterStatus = deterministicResult.newStatus
          if (afterStatus === 'in_progress') {
            ensureWorkerOwnership(taskAfter)
          } else if (afterStatus === 'gate_check') {
            taskAfter.assignedTo = 'gate-checker-agent'
          }
          taskAfter.updatedAt = this.now()
          queueAfter.lastUpdated = this.now()
          await this.writeQueue(queueAfter)
          transitioned = true
        }

        if (
          beforeStatus === 'gate_check' &&
          (afterStatus === 'gate_check' || afterStatus === 'in_progress')
        ) {
          const latestHardGates = latestHardGateResults(taskAfter)
          const hardGateDisposition = summarizeScopedHardGateDisposition(
            {
              projectPath: taskAfter.projectPath,
              likelyTargetFiles: resolveLikelyTaskFiles(taskAfter),
              gateScopeExceptions: taskAfter.gateScopeExceptions ?? [],
            },
            latestHardGates,
          )
          if (hardGateDisposition) {
            if (hardGateDisposition.shouldPass) {
              settleAcceptanceCriteriaAfterScopedGateException(
                taskAfter,
                new Set(latestHardGates.filter((gate) => gate.passed).map((gate) => gate.gateId)),
              )
              if (hardGateDisposition.exemptedFailures.length > 0) {
                const exemptedSummary = hardGateDisposition.exemptedFailures
                  .map((gate) => `${gate.gateId}: scoped unrelated repo-red excluded per resolved human decision`)
                  .join('; ')
                taskAfter.notes.push({
                  agentId: 'gate-checker-agent',
                  role: 'reviewer',
                  content: `Gate-check scope exception applied: ${exemptedSummary}`,
                  timestamp: this.now(),
                })
              }
              taskAfter.status = 'done'
              taskAfter.updatedAt = this.now()
              queueAfter.lastUpdated = this.now()
              await this.writeQueue(queueAfter)
              afterStatus = 'done'
              transitioned = true
            } else if (afterStatus === 'gate_check') {
              taskAfter.status = 'in_progress'
              ensureWorkerOwnership(taskAfter)
              taskAfter.updatedAt = this.now()
              queueAfter.lastUpdated = this.now()
              await this.writeQueue(queueAfter)
              afterStatus = 'in_progress'
              transitioned = true
            }
          } else if (latestHardGates.length > 0 && latestHardGates.every((gate) => gate.passed)) {
            taskAfter.status = 'done'
            taskAfter.updatedAt = this.now()
            queueAfter.lastUpdated = this.now()
            await this.writeQueue(queueAfter)
            afterStatus = 'done'
            transitioned = true
          }
        }

        if (afterStatus === 'done' && taskDoneButMissingSelectedScopeProof({ ...taskAfter, status: 'done' }, queueAfter)) {
          taskAfter.status = 'in_progress'
          ensureWorkerOwnership(taskAfter)
          taskAfter.completedAt = undefined
          taskAfter.revisionCount += 1
          taskAfter.notes.push({
            agentId: 'proof-health-gates',
            role: 'gate-checker',
            content:
              'Guildhall reopened this task because it was marked done while its proof path still lacks required evidence. Attach the missing proof before marking it done.',
            timestamp: this.now(),
          })
          taskAfter.updatedAt = this.now()
          queueAfter.lastUpdated = taskAfter.updatedAt
          await this.writeQueue(queueAfter)
          afterStatus = 'in_progress'
          transitioned = true
        }

        if (
          afterStatus === 'review' &&
          !hasPendingHandoffStep(taskAfter) &&
          taskAfter.assignedTo !== 'reviewer-agent'
        ) {
          ensureReviewerOwnership(taskAfter)
          taskAfter.updatedAt = this.now()
          queueAfter.lastUpdated = this.now()
          await this.writeQueue(queueAfter)
        }

        const repeatedExploringNoProgress =
          agent.name === 'spec-agent' &&
          beforeStatus === 'exploring' &&
          afterStatus === 'exploring' &&
          !madeExploringProgress
        if (repeatedExploringNoProgress) {
          const attempts = this.bumpExploringNoProgress(task.id)
          const shouldEscalateNow = checkpointNoProgressStatusSeen ||
            attempts >= EXPLORING_NO_PROGRESS_ESCALATION_AFTER
          if (shouldEscalateNow) {
            if (checkpointNoProgressStatusSeen) {
              const seededSpec = await this.maybeWriteExploringRecoverySpecSeed(taskAfter, { force: true })
              if (seededSpec) {
                this.clearExploringNoProgress(task.id)
                return seededSpec
              }
              taskAfter.assignedTo = null
              taskAfter.updatedAt = this.now()
              taskAfter.notes.push({
                agentId: 'coordinator',
                role: 'runtime',
                content:
                  'The spec lane kept using read-only exploration after Guildhall asked for durable progress. Guildhall preserved the task for runtime recovery instead of asking the owner to decide whether to retry.',
                timestamp: taskAfter.updatedAt,
              })
              queueAfter.lastUpdated = taskAfter.updatedAt
              await this.writeQueue(queueAfter)
              await this.emitBackendEvent({
                type: 'line_complete',
                task_id: task.id,
                agent_name: agent.name,
                message:
                  'Spec shaping kept researching after the durable-progress nudge. Guildhall preserved this as runtime recovery instead of owner input.',
              })
              this.clearExploringNoProgress(task.id)
              await this.maybeCleanupWorktree(taskAfter, worktreeMode)
              return {
                kind: 'processed',
                taskId: task.id,
                agent: agent.name,
                beforeStatus,
                afterStatus: taskAfter.status,
                transitioned: false,
                revisionCount: taskAfter.revisionCount,
              }
            }
            const summary = checkpointNoProgressStatusSeen
              ? 'Spec agent kept researching after Guildhall asked for durable progress.'
              : `Spec agent made no visible progress after ${attempts} passes.`
            const escalation = await raiseEscalation({
              tasksPath: this.tasksPath(),
              progressPath: this.progressPath(),
              taskId: task.id,
              agentId: agent.name,
              reason: 'human_judgment_required',
              recoveryCode: 'spec_no_progress',
              summary,
              details:
                checkpointNoProgressStatusSeen
                  ? `Task remained in exploring after the agent ignored the durable-progress nudge and kept using read-only exploration. Review the task transcript or provider behavior before retrying.`
                  : `Task remained in exploring with no saved spec, note, or status transition. ` +
                    `Review the task ask/transcript or provider behavior before retrying.`,
            })
            this.clearExploringNoProgress(task.id)
            await this.maybeCleanupWorktree(taskAfter, worktreeMode)
            return {
              kind: 'escalated',
              taskId: task.id,
              agent: agent.name,
              reason: summary,
              escalationId:
                escalation.escalationId ?? `auto-exploring-stall-${task.id}`,
            }
          }
        } else {
          this.clearExploringNoProgress(task.id)
        }

        const taskRepoRootAfter = this.resolveEffectiveTaskProjectPath(taskAfter)
        const likelyWorkerTargets =
          beforeStatus === 'in_progress' ? resolveLikelyTaskFiles(taskAfter) : []
        const hasDirtyWorktreeAfter =
          beforeStatus === 'in_progress' &&
          typeof taskAfter.worktreePath === 'string' &&
          taskAfter.worktreePath.trim().length > 0 &&
          !(await this.gitDriver.isClean(resolveRuntimePath(taskAfter.worktreePath)))
        const dirtyTaskFilesAfter =
          beforeStatus === 'in_progress' ? await this.changedFilesForTask(taskAfter) : []
        const hasDirtyLikelyTargetProgress =
          beforeStatus === 'in_progress' &&
          dirtyTaskFilesAfter.some((file) =>
            this.fileMatchesLikelyTarget(file, likelyWorkerTargets, taskRepoRootAfter),
          )
        const checkpointTouchedFiles = this.checkpointTouchedFilesFromMetadata(
          successfulAgentMetadata,
          taskRepoRootAfter,
        )
        // Re-read after the agent turn. A worker may have written a newer
        // checkpoint through the tool during this turn; using the pre-turn
        // snapshot here would make routing depend on stale state.
        const durableCheckpointForProgress =
          await readCheckpoint(this.opts.config.memoryDir, task.id).catch(() => null) ?? checkpoint
        const dirtyFilesMatchExistingCheckpoint =
          beforeStatus === 'in_progress' &&
          dirtyTaskFilesAfter.length > 0 &&
          sameStringSet(dirtyTaskFilesAfter, durableCheckpointForProgress?.filesTouched ?? [])
        const corpusRefreshTouchedFiles = uniqueStrings([
          ...dirtyTaskFilesAfter,
          ...checkpointTouchedFiles,
        ])
        const explicitCheckpointVerification = readCheckpointVerification(
          successfulAgentMetadata?.['current_task_checkpoint_verification'],
        )
        const recentCheckpointVerification = readRecentVerificationResults(successfulAgentMetadata)
          .map(result => ({
            command: result.command,
            passed: result.passed,
            observedAt: result.observedAt ?? this.now(),
          }))
        const checkpointVerification =
          durableCheckpointForProgress?.resumeContext?.verification ??
          (explicitCheckpointVerification.length > 0
            ? explicitCheckpointVerification
            : recentCheckpointVerification)
        const hasCheckpointScopedVerifiedProgress =
          beforeStatus === 'in_progress' &&
          this.hasDurableWorkerHandoffEvidence(successfulAgentMetadata, task.id) &&
          checkpointTouchedFiles.length > 0 &&
          checkpointHasRecordedPassingVerification(checkpointVerification)
        const hasCommittedTaskWorkAfter =
          beforeStatus === 'in_progress' &&
          await this.taskWorktreeHasCommittedProgress(taskAfter)
        const hasDurableImplementationSurface =
          beforeStatus === 'in_progress' &&
          (hasDirtyLikelyTargetProgress || hasDirtyWorktreeAfter || hasCommittedTaskWorkAfter)
        // A checkpoint can describe implementation progress, but it cannot
        // replace it. Reviewer recovery needs a current diff or task-branch
        // commit to inspect, otherwise it creates a retry loop over a claim.
        const hasRecoverableCheckpointProgress =
          hasCheckpointScopedVerifiedProgress && hasDurableImplementationSurface
        const checkpointNextAction =
          beforeStatus === 'in_progress'
            ? normalizedWorkerCheckpointNextAction(
                taskAfter,
                durableCheckpointForProgress ??
                  (typeof successfulAgentMetadata?.['current_task_checkpoint_next_action'] === 'string'
                    ? successfulAgentMetadata['current_task_checkpoint_next_action']
                    : null),
              )
            : ''
        const checkpointNextActionKind =
          beforeStatus === 'in_progress'
            ? durableCheckpointForProgress?.nextActionKind ??
              readCheckpointActionKind(successfulAgentMetadata?.['current_task_checkpoint_next_action_kind'])
            : undefined
        const hasFailedCheckpointVerification =
          beforeStatus === 'in_progress' &&
          checkpointHasRecordedVerificationFailure(checkpointVerification)
        const hasWorkerTurnEvidence =
          beforeStatus === 'in_progress' &&
          this.hasDurableWorkerHandoffEvidence(successfulAgentMetadata, task.id)
        const workerFalseCompletionNarration =
          agent.name === 'worker-agent' &&
          beforeStatus === 'in_progress' &&
          afterStatus === 'in_progress' &&
          !transitioned &&
          dirtyTaskFilesAfter.length === 0 &&
          !hasDirtyWorktreeAfter &&
          !hasDirtyLikelyTargetProgress &&
          !hasRecoverableCheckpointProgress &&
          workerAddedSelfCritiqueSince(task, taskAfter, agent.name)
        const canAutoPromoteReviewFromCheckpointHandoff =
          agent.name === 'worker-agent' &&
          beforeStatus === 'in_progress' &&
          afterStatus === 'in_progress' &&
          !transitioned &&
          hasRecoverableCheckpointProgress &&
          checkpointNextActionKind === 'review_handoff'
        if (
          canAutoPromoteReviewFromCheckpointHandoff &&
          !this.hasReviewProofPacket(taskAfter) &&
          checkpointHasRecordedPassingVerification(checkpointVerification)
        ) {
          const structuredSelfCritique = this.syntheticCheckpointSelfCritiqueStructured({
            task: taskAfter,
            checkpointTouchedFiles,
            metadata: successfulAgentMetadata,
          })
          taskAfter.notes.push({
            agentId: 'worker-agent',
            role: 'self-critique',
            content: this.syntheticCheckpointSelfCritique({
              task: taskAfter,
              checkpointTouchedFiles,
              metadata: successfulAgentMetadata,
              structured: structuredSelfCritique,
            }),
            structured: structuredSelfCritique,
            timestamp: this.now(),
          })
        }
        const canAutoPromoteReviewFromFreshHandoff =
          agent.name === 'worker-agent' &&
          beforeStatus === 'in_progress' &&
          afterStatus === 'in_progress' &&
          !transitioned &&
          workerAddedSelfCritiqueSince(task, taskAfter, agent.name) &&
          hasWorkerTurnEvidence &&
          this.hasReviewProofPacket(taskAfter) &&
          hasDurableImplementationSurface
        if (
          (canAutoPromoteReviewFromCheckpointHandoff && this.hasReviewProofPacket(taskAfter)) ||
          canAutoPromoteReviewFromFreshHandoff
        ) {
          ensureReviewerOwnership(taskAfter)
          transitionTaskStatus({
            task: taskAfter,
            event: 'request_review',
            actor: 'worker-handoff-recovery',
            evidenceRefs: ['task:review-proof-packet'],
            now: this.now(),
          })
          taskAfter.updatedAt = this.now()
          queueAfter.lastUpdated = taskAfter.updatedAt
          await this.writeQueue(queueAfter)
          await this.emitBackendEvent({
            type: 'line_complete',
            task_id: task.id,
            agent_name: agent.name,
            message:
              'The worker had already produced durable verification evidence and review handoff proof. Guildhall promoted the task to review instead of leaving it stuck in a handoff loop.',
          })
          return {
            kind: 'processed',
            taskId: task.id,
            agent: agent.name,
            beforeStatus,
            afterStatus: 'review',
            transitioned: true,
            revisionCount: taskAfter.revisionCount,
          }
        }
        if (workerFalseCompletionNarration) {
          const alreadyRejected = taskAfter.notes.slice(-3).some((note) =>
            note.agentId === 'coordinator' &&
            note.role === 'worker-progress-review' &&
            note.structured?.event === 'worker_self_critique_rejected',
          )
          if (!alreadyRejected) {
            processedOutcomeNote =
              'Worker wrote a self-critique without project-file changes; implementation retry required.'
            taskAfter.notes.push({
              agentId: 'coordinator',
              role: 'worker-progress-review',
              structured: {
                event: 'worker_self_critique_rejected',
                reason: 'no_project_file_changes',
              },
              content:
                'Guildhall rejected the last worker self-critique without project-file changes outside `.guildhall`. Resume implementation by creating or editing the likely target files, then run focused verification before writing another self-critique.',
              timestamp: this.now(),
            })
            taskAfter.updatedAt = this.now()
            queueAfter.lastUpdated = taskAfter.updatedAt
            await this.writeQueue(queueAfter)
          }
          if (typeof agent.resetConversation === 'function') {
            agent.resetConversation()
          }
          await this.emitBackendEvent({
            type: 'line_complete',
            task_id: task.id,
            agent_name: agent.name,
            is_error: true,
            message:
              'Worker wrote a self-critique without any project-file changes. Guildhall is treating that as no progress and forcing a fresh implementation pass.',
          })
        }
        if (
          agent.name === 'worker-agent' &&
          beforeStatus === 'in_progress' &&
          afterStatus === 'in_progress' &&
          !transitioned &&
          !dirtyFilesMatchExistingCheckpoint &&
          (
            (hasDirtyWorktreeAfter && (!hasFailedCheckpointVerification || hasWorkerTurnEvidence)) ||
            hasDirtyLikelyTargetProgress ||
            hasRecoverableCheckpointProgress
          )
        ) {
          const recoveryReason = hasDirtyWorktreeAfter
            ? 'worker pass ended with dirty worktree progress but no status transition'
            : hasDirtyLikelyTargetProgress
              ? 'worker pass ended with dirty likely-target files in the main project checkout but no status transition'
            : 'worker pass ended with clean verified progress but no status transition'
          const checkpointWritten = await this.writeWorkerRecoveryCheckpoint({
            task: taskAfter,
            agentName: agent.name,
            metadata: successfulAgentMetadata,
            reason: recoveryReason,
          })
          if (checkpointWritten) {
            taskAfter.updatedAt = this.now()
            queueAfter.lastUpdated = this.now()
            await this.writeQueue(queueAfter)
          }
        }
        const noDurableWorkerProgressSignal =
          !learnedVerificationCommands &&
          taskAfter.notes.length === taskNoteCountBefore &&
          taskAfter.reviewVerdicts.length === reviewVerdictCountBefore
        const repeatedWorkerNoProgress =
          agent.name === 'worker-agent' &&
          beforeStatus === 'in_progress' &&
          afterStatus === 'in_progress' &&
          !transitioned &&
          !handedOffBootstrapVerificationThisDispatch &&
          (workerFalseCompletionNarration || noDurableWorkerProgressSignal) &&
          (!hasDirtyWorktreeAfter || dirtyFilesMatchExistingCheckpoint || (hasFailedCheckpointVerification && !hasWorkerTurnEvidence)) &&
          (!hasDirtyLikelyTargetProgress || dirtyFilesMatchExistingCheckpoint) &&
          !hasRecoverableCheckpointProgress
        if (repeatedWorkerNoProgress) {
          const attempts = ((await this.readWorkerRecovery(task.id)).noProgressAttempts ?? 0) + 1
          if (attempts >= WORKER_NO_PROGRESS_ESCALATION_AFTER) {
            // A proof task with a current typed verification failure is still
            // executable repair work. The worker's prose cannot settle it,
            // but neither can a generic no-progress branch turn the missing
            // typed handoff into an owner decision. Keep this narrow boundary
            // in the delegated lane; ordinary implementation stalls retain
            // the normal escalation policy below.
            const proofSetupNeedsWorkerRepair =
              isProofSetupTask(taskAfter) &&
              hasFailedCheckpointVerification &&
              !this.hasReviewProofPacket(taskAfter)
            if (
              proofSetupNeedsWorkerRepair ||
              ((checkpointNoProgressStatusSeen || hasFailedCheckpointVerification) &&
                (taskAfter.remediationAttempts ?? 0) < 1)
            ) {
              const remediated = await this.recordAutonomousCheckpointNoProgressRemediation({
                task: taskAfter,
                queue: queueAfter,
                agentName: agent.name,
                checkpoint,
                resetAgent: () => {
                  if (typeof agent.resetConversation === 'function') agent.resetConversation()
                },
              })
              if (remediated) {
                // The remediation helper writes the task queue as part of
                // recording its restart. Restore the dedicated counter after
                // that write so the stale task snapshot cannot resurrect the
                // pre-remediation retry count.
                await this.patchWorkerRecovery(task.id, { noProgressAttempts: 0 })
                await this.maybeCleanupWorktree(taskAfter, worktreeMode)
                return {
                  kind: 'processed',
                  taskId: task.id,
                  agent: 'coordinator-remediation',
                  beforeStatus,
                  afterStatus: 'in_progress',
                  transitioned: false,
                  revisionCount: taskAfter.revisionCount,
                }
              }
            }
            const escalation = await raiseEscalation({
              tasksPath: this.tasksPath(),
              progressPath: this.progressPath(),
              taskId: task.id,
              agentId: agent.name,
              reason: 'human_judgment_required',
              recoveryCode: 'worker_no_progress',
              summary: `Worker made no visible progress after ${attempts} passes.`,
              details:
                `Task remained in progress with no worktree edits, note, or status transition ` +
                `after reopening likely target files. The worker must either mutate one of those ` +
                `files, run focused verification tied to a file it just changed, or explicitly ` +
                `escalate instead of ending another no-op step.`,
            })
            await this.resetWorkerRecoveryCounters(task.id, ['noProgressAttempts'])
            await this.annotateWorkerBlockedClassification({
              taskId: task.id,
              agentId: 'coordinator',
              classification: {
                class: 'model_tool_use_failure',
                confidence: 'medium',
                evidence: [{
                  kind: 'task',
                  summary: `Worker made no visible progress after ${attempts} passes.`,
                  ref:
                    'Task remained in progress with no worktree edits, note, or status transition after likely-target nudges.',
                }],
                scope: 'task',
                safePlaybooks: ['ask_concrete_human_question'],
                needsHuman: true,
                humanQuestion:
                  'The worker made no visible progress after focused nudges. Should Guildhall retry from checkpoint, narrow the task, or stop?',
              },
            })
            await this.maybeCleanupWorktree(taskAfter, worktreeMode)
            return {
              kind: 'escalated',
              taskId: task.id,
              agent: agent.name,
              reason: `Worker made no visible progress after ${attempts} passes.`,
              escalationId:
                escalation.escalationId ?? `auto-worker-stall-${task.id}`,
            }
          }
          processedOutcomeNote ??=
            `Worker made no visible progress pass ${attempts}; retrying until recoverable model-tool-use failure.`
          const recoveryDirection = taskAfter.notes
            .slice()
            .reverse()
            .find((note) => note.role === 'recovery' && note.structured?.event === 'recovery_checkpoint_direction')
          const noProgressNote = workerFalseCompletionNarration
            ? `Worker wrote a self-critique without project-file changes on no-progress pass ${attempts}. Guildhall will retry the implementation lane until the no-progress threshold instead of accepting the narration as proof.`
            : recoveryDirection
              ? `${recoveryDirection.content} Worker made no visible progress pass ${attempts}; Guildhall will retry the instructed recovery lane before escalating.`
              : `Worker made no visible progress pass ${attempts}. Guildhall will retry until the no-progress threshold, then stop this task with a recoverable model-tool-use failure instead of silently looping.`
          taskAfter.notes.push({
            agentId: 'coordinator',
            role: 'worker-progress-review',
            structured: {
              event: 'worker_progress_review',
              reason: workerFalseCompletionNarration ? 'no_project_file_changes' : 'no_progress',
            },
            content: noProgressNote,
            timestamp: this.now(),
          })
          taskAfter.updatedAt = this.now()
          queueAfter.lastUpdated = taskAfter.updatedAt
          await this.writeQueue(queueAfter)
          // Queue writes sanitize runtime-only fields out of the task
          // definition. Patch the dedicated runtime overlay after that write
          // so a stale embedded snapshot cannot clobber the new counter.
          await this.patchWorkerRecovery(task.id, { noProgressAttempts: attempts })
        } else {
          await this.resetWorkerRecoveryCounters(task.id, ['noProgressAttempts'])
        }

      // FR-27 / AC-18: record LLM verdict when a review actually ran.
        if (beforeStatus === 'review') {
          // Preserve the provider response as audit material even when the
          // reviewer did not use the update-task tool. This note is never
          // treated as structured review state; recordLlmVerdict below reads
          // the typed contract from the response itself.
          if (
            generatedText.trim().length > 0 &&
            countReviewerNotes(taskAfter) === reviewerNoteCountBefore
          ) {
            taskAfter.notes.push({
              agentId: 'reviewer-agent',
              role: 'reviewer',
              content: generatedText.trim(),
              timestamp: this.now(),
            })
          }
          const llmVerdict = recordLlmVerdict({
            queue: queueAfter,
            taskId: task.id,
            beforeStatus,
            afterStatus,
            now: this.now(),
            // The generated response is the authoritative machine contract
            // for this pass. Do not make verdict parsing depend on whether a
            // provider happened to persist a reviewer note first.
            reasoning: generatedText,
          })
          if (llmVerdict) {
            if (llmVerdict.normalizedStatus !== afterStatus) {
              afterStatus = llmVerdict.normalizedStatus
              taskAfter.status = afterStatus
            }
          if (afterStatus === 'in_progress') {
            ensureWorkerOwnership(taskAfter)
          } else if (afterStatus === 'gate_check') {
            taskAfter.assignedTo = 'gate-checker-agent'
          }
          taskAfter.updatedAt = this.now()
          queueAfter.lastUpdated = this.now()
          await this.writeQueue(queueAfter)
        }
      }

      // FR-10: new escalation → halt.
      if (taskAfter.escalations.length > task.escalations.length) {
        const newest = taskAfter.escalations[taskAfter.escalations.length - 1]!
        const staleReviewCheckpointEscalation =
          agent.name === 'worker-agent' &&
          beforeStatus === 'in_progress' &&
          newest.reason === 'decision_required' &&
          newest.recoveryCode === 'stale_review_checkpoint' &&
          this.hasReviewProofPacket(taskAfter)
        if (staleReviewCheckpointEscalation) {
          const now = this.now()
          newest.resolvedAt = now
          newest.resolution =
            'Superseded because the worker correctly identified a stale review checkpoint after a durable review handoff. Guildhall preserved the review lane instead of blocking the task.'
          newest.resolvedBy = 'orchestrator'
          transitionTaskStatus({
            task: taskAfter,
            event: 'request_review',
            actor: 'stale-review-checkpoint-recovery',
            evidenceRefs: ['task:review-proof-packet'],
            now,
          })
          ensureReviewerOwnership(taskAfter)
          taskAfter.blockReason = undefined
          taskAfter.updatedAt = now
          queueAfter.lastUpdated = now
          await this.writeQueue(queueAfter)
          await this.emitBackendEvent({
            type: 'line_complete',
            task_id: task.id,
            agent_name: agent.name,
            message:
              'Worker hit a stale review checkpoint after the task had already handed off. Guildhall kept the task in review instead of surfacing a fake human blocker.',
          })
          return {
            kind: 'processed',
            taskId: task.id,
            agent: agent.name,
            beforeStatus,
            afterStatus: 'review',
            transitioned: true,
            revisionCount: taskAfter.revisionCount,
          }
        }
        if (
          isRecoverableSelfAuthoredVerificationEscalation({
            agentName: agent.name,
            beforeStatus,
            task: taskAfter,
            checkpoint,
            touchedFiles: dirtyTaskFilesAfter,
            escalation: newest,
          })
        ) {
          const now = this.now()
          newest.resolvedAt = now
          newest.resolution =
            'Superseded because the blocker describes a self-authored verification failure in files the worker already touched. Guildhall kept the task in the worker repair lane.'
          newest.resolvedBy = 'orchestrator'
          if (taskAfter.status === 'blocked') {
            transitionTaskStatus({
              task: taskAfter,
              event: 'recover_to_in_progress',
              actor: 'self-authored-verification-recovery',
              evidenceRefs: ['task:worker-owned-verification'],
              now,
            })
          } else if (taskAfter.status !== 'in_progress') {
            transitionTaskStatus({
              task: taskAfter,
              event: 'revise',
              actor: 'self-authored-verification-recovery',
              evidenceRefs: ['task:worker-owned-verification'],
              now,
            })
          }
          ensureWorkerOwnership(taskAfter)
          taskAfter.blockReason = undefined
          const classification = classifyAgentFailure({
            taskId: taskAfter.id,
            blockReason: [
              newest.summary,
              newest.details,
            ].filter(Boolean).join('\n'),
            touchedFiles: checkpoint?.filesTouched?.length ? checkpoint.filesTouched : dirtyTaskFilesAfter,
            verification: checkpoint?.resumeContext?.verification ?? [],
          })
          appendFailureClassificationNote(
            taskAfter,
            classification,
            {
              agentId: 'coordinator',
              timestamp: now,
            },
          )
          const recoveryPlan = resolveRecoveryPlan({
            taskId: taskAfter.id,
            classification,
            touchedFiles: checkpoint?.filesTouched?.length ? checkpoint.filesTouched : dirtyTaskFilesAfter,
            verification: checkpoint?.resumeContext?.verification ?? [],
            notes: taskAfter.notes,
          })
          appendRecoveryPlaybookNote(taskAfter, recoveryPlan, {
            agentId: 'coordinator',
            timestamp: now,
            status: 'started',
          })
          taskAfter.notes.push({
            agentId: 'coordinator',
            role: 'checkpoint',
            content:
              'Recovered a worker-raised blocker as repairable implementation work: rerun the focused verification command and repair the failed verification in the checkpoint-touched files before escalating.',
            timestamp: now,
          })
          taskAfter.updatedAt = now
          queueAfter.lastUpdated = now
          await this.writeQueue(queueAfter)
          await this.emitBackendEvent({
            type: 'line_complete',
            task_id: task.id,
            agent_name: agent.name,
            message:
              'Worker raised a blocker for its own failed verification. Guildhall kept the task assigned to the worker for source repair instead of asking for human guidance.',
          })
          return {
            kind: 'processed',
            taskId: task.id,
            agent: agent.name,
            beforeStatus,
            afterStatus: 'in_progress',
            transitioned: false,
            revisionCount: taskAfter.revisionCount,
          }
        }
        return {
          kind: 'escalated',
          taskId: task.id,
          agent: agent.name,
          reason: newest.reason,
          escalationId: newest.id,
        }
      }

      // FR-25: on `done` transition, run the merge dispatcher. Merge result
      // may move the task to `pending_pr` (manual_pr path) or `blocked` (with
      // a fixup task queued) — `afterStatus` is updated so the post-merge
      // cleanup / progress logging see the final state.
      if (afterStatus === 'done' && beforeStatus !== 'done') {
        const autoCommit = await this.maybeAutoCommitCompletedTaskWork(taskAfter)
        if (!autoCommit.ok) {
          transitionTaskStatus({
            task: taskAfter,
            event: 'landing_failed',
            actor: 'orchestrator-landing',
            evidenceRefs: ['task:landing:auto-commit-failed'],
            now: this.now(),
          })
          taskAfter.assignedTo = null
          taskAfter.recoveryCode = 'auto_commit_landing'
          taskAfter.blockReason =
            `Guildhall could not auto-commit completed work: ${autoCommit.detail ?? 'unknown git error'}.`
          taskAfter.notes.push({
            agentId: 'coordinator',
            role: 'git-story',
            content:
              `Auto-commit was required by project Git Story policy, but it failed: ${autoCommit.detail ?? 'unknown git error'}.`,
            timestamp: this.now(),
          })
          afterStatus = 'blocked'
        }
        const landingStrategy = await this.resolveLandingStrategySafe()
        const completionWorktreeMode = taskAfter.worktreePath?.trim() ? 'per_task' : worktreeMode
        if (afterStatus === 'blocked') {
          if (!taskAfter.mergeRecord) {
            taskAfter.mergeRecord = {
              fromBranch: taskAfter.branchName ?? '<unknown>',
              toBranch: taskAfter.baseBranch ?? '<unknown>',
              strategy: landingStrategy,
              result: 'skipped',
              mergedAt: this.now(),
              detail: 'auto-commit failed before landing',
            }
          }
        } else if (completionWorktreeMode === 'none') {
          const repoClean = await this.gitDriver.isClean(effectiveTaskProjectPath)
          if (!repoClean) {
            const recovered = await this.recoverDirtyRepoIntoTaskBranch({
              task: taskAfter,
              worktreeMode: completionWorktreeMode,
              repoRoot: effectiveTaskProjectPath,
              baseBranch: taskAfter.baseBranch ?? baseBranch,
            })
            if (recovered.recovered) {
              taskAfter.branchName = recovered.branchName
              taskAfter.baseBranch = taskAfter.baseBranch ?? baseBranch
              taskAfter.notes.push({
                agentId: 'coordinator',
                role: 'checkpoint',
                content:
                  `Checkpointed shared-checkout work into ${recovered.branchName} ` +
                  `before marking the task complete${recovered.commitSha ? ` (${recovered.commitSha})` : ''}.`,
                timestamp: this.now(),
              })
              appendRecoveryPlaybookNote(
                taskAfter,
                resolveRecoveryPlan({
                  taskId: taskAfter.id,
                  classification: {
                    class: 'dirty_checkout_owned',
                    confidence: 'high',
                    evidence: [{
                      kind: 'task',
                      summary: `Shared checkout edits were checkpointed into ${recovered.branchName}.`,
                      ref: recovered.commitSha,
                    }],
                    scope: 'task',
                    safePlaybooks: ['package_owned_dirty_work'],
                    needsHuman: false,
                  },
                  notes: taskAfter.notes,
                }),
                {
                  agentId: 'coordinator',
                  timestamp: this.now(),
                  status: 'succeeded',
                  summary:
                    `Packaged Guildhall-owned dirty checkout work into ${recovered.branchName}.`,
                },
              )
              taskAfter.mergeRecord = {
                fromBranch: recovered.branchName,
                toBranch: taskAfter.baseBranch,
                strategy: landingStrategy,
                result: 'skipped',
                ...(recovered.commitSha ? { commitSha: recovered.commitSha } : {}),
                mergedAt: this.now(),
                detail: 'worktree isolation disabled — shared-checkout work checkpointed to task branch',
              }
            } else {
              transitionTaskStatus({
                task: taskAfter,
                event: 'landing_failed',
                actor: 'orchestrator-landing',
                evidenceRefs: ['task:landing:checkpoint-failed'],
                now: this.now(),
              })
              taskAfter.assignedTo = null
              taskAfter.recoveryCode = 'shared_checkout_checkpoint'
              taskAfter.blockReason =
                'Guildhall completed the task work but could not checkpoint shared-checkout edits into a task branch. Resolve the repo state and resume the task before treating it as done.'
              taskAfter.notes.push({
                agentId: 'coordinator',
                role: 'checkpoint',
                content:
                  'Guildhall finished the task but failed to package shared-checkout edits into an isolated task branch, so it blocked the task instead of silently leaving dirty work behind.',
                timestamp: this.now(),
              })
              appendRecoveryPlaybookNote(
                taskAfter,
                resolveRecoveryPlan({
                  taskId: taskAfter.id,
                  classification: {
                    class: 'dirty_checkout_owned',
                    confidence: 'medium',
                    evidence: [{
                      kind: 'task',
                      summary:
                        'Shared checkout edits could not be packaged into an isolated task branch.',
                    }],
                    scope: 'task',
                    safePlaybooks: ['package_owned_dirty_work'],
                    needsHuman: true,
                    humanQuestion:
                      'Resolve the dirty shared checkout state, then resume this task.',
                  },
                  notes: taskAfter.notes,
                }),
                {
                  agentId: 'coordinator',
                  timestamp: this.now(),
                  status: 'failed',
                  summary:
                    'Failed to package Guildhall-owned dirty checkout work into a task branch.',
                },
              )
              taskAfter.mergeRecord = {
                fromBranch: taskAfter.branchName ?? '<unknown>',
                toBranch: taskAfter.baseBranch ?? '<unknown>',
                strategy: landingStrategy,
                result: 'skipped',
                mergedAt: this.now(),
                detail: 'worktree isolation disabled — attempted to checkpoint shared-checkout work but packaging failed',
              }
              afterStatus = 'blocked'
            }
          } else if (!taskAfter.mergeRecord) {
            taskAfter.mergeRecord = {
              fromBranch: taskAfter.branchName ?? '<unknown>',
              toBranch: taskAfter.baseBranch ?? '<unknown>',
              strategy: landingStrategy,
              result: 'skipped',
              mergedAt: this.now(),
              detail: 'worktree isolation disabled — merge skipped',
            }
          }
        } else if (!taskAfter.branchName || !taskAfter.baseBranch) {
          if (!taskAfter.mergeRecord) {
            taskAfter.mergeRecord = {
              fromBranch: taskAfter.branchName ?? '<unknown>',
              toBranch: taskAfter.baseBranch ?? '<unknown>',
              strategy: landingStrategy,
              result: 'skipped',
              mergedAt: this.now(),
              detail: 'branch metadata missing — merge skipped',
            }
          }
        } else {
          const mergeOutcome = await dispatchMerge({
            task: taskAfter,
            policy: landingStrategy,
            projectPath: effectiveTaskProjectPath,
            memoryDir: this.opts.config.memoryDir,
            gitDriver: this.gitDriver,
            now: this.now(),
          })
          taskAfter.mergeRecord = mergeOutcome.record
          if (mergeOutcome.transitionReceipt) {
            taskAfter.status = mergeOutcome.transitionReceipt.to
          }
          if (mergeOutcome.fixupTask) {
            appendFixupTask(queueAfter, mergeOutcome.fixupTask, this.now())
          }
          if (mergeOutcome.newStatus === 'done') {
            shelveSupersededFixupTasks(queueAfter, taskAfter.id, this.now())
          }
          afterStatus = mergeOutcome.newStatus
        }
        taskAfter.updatedAt = this.now()
        queueAfter.lastUpdated = this.now()
        await this.writeQueue(queueAfter)
        transitioned = beforeStatus !== afterStatus
      }

      // Revision counting: review/gate_check → in_progress is a revise cycle.
      const revisionTrigger =
        (beforeStatus === 'review' || beforeStatus === 'gate_check') &&
        afterStatus === 'in_progress'

      let revisionCount = taskAfter.revisionCount
      if (revisionTrigger) {
        ensureWorkerOwnership(taskAfter)
        revisionCount = taskAfter.revisionCount + 1
        taskAfter.revisionCount = revisionCount
        ensureRetryWindow(taskAfter)
        taskAfter.updatedAt = this.now()
        queueAfter.lastUpdated = this.now()

        const currentCycleRevisionCount = currentRevisionCycleCount(taskAfter)
        if (currentCycleRevisionCount > this.opts.config.maxRevisions) {
          if (hasPriorAllClearLlmReview(taskAfter)) {
            transitionTaskStatus({
              task: taskAfter,
              event: 'request_review',
              actor: 'reviewer-llm-max-revision-recovery',
              evidenceRefs: ['review:prior-all-clear'],
              now: this.now(),
            })
            transitionTaskStatus({
              task: taskAfter,
              event: 'start_gate_check',
              actor: 'reviewer-llm-max-revision-recovery',
              evidenceRefs: ['review:prior-all-clear'],
              now: this.now(),
            })
            taskAfter.assignedTo = 'gate-checker-agent'
            taskAfter.updatedAt = this.now()
            queueAfter.lastUpdated = taskAfter.updatedAt
            taskAfter.notes.push({
              agentId: 'reviewer-llm-max-revision-recovery',
              role: 'reviewer',
              content:
                'Skipped max-revision block because an earlier LLM review for this revision cycle recorded all rubric checks as yes with no failing signals. Advancing to gate check so hard verification decides.',
              timestamp: taskAfter.updatedAt,
            })
            await this.writeQueue(queueAfter)
            await this.logTickProgress({
              task: taskAfter,
              agent: 'reviewer-llm-max-revision-recovery',
              beforeStatus,
              afterStatus: 'gate_check',
              transitioned: true,
              note: 'prior all-clear review recovered max-revision loop',
            })
            return {
              kind: 'processed',
              taskId: task.id,
              agent: 'reviewer-llm-max-revision-recovery',
              beforeStatus,
              afterStatus: 'gate_check',
              transitioned: true,
              revisionCount: currentCycleRevisionCount,
            } as TickOutcome
          }
          await this.writeQueue(queueAfter)

          await raiseEscalation({
            tasksPath: this.tasksPath(),
            progressPath: this.progressPath(),
            taskId: task.id,
            agentId: agent.name,
            reason: 'max_revisions_exceeded',
            recoveryCode: 'max_revisions_actionable',
            summary:
              `Exceeded maxRevisions (${this.opts.config.maxRevisions}). ` +
              `Requires human judgment.`,
            details:
              `Task bounced between ${beforeStatus} and in_progress ${revisionCount} times. ` +
              `Last agent: ${agent.name}.`,
          })

          await this.maybeCleanupWorktree(taskAfter, worktreeMode)

          return {
            kind: 'blocked-max-revisions',
            taskId: task.id,
            revisionCount: currentCycleRevisionCount,
          }
        }

        await this.writeQueue(queueAfter)
      }

      await this.logTickProgress({
        task: taskAfter,
        agent: agent.name,
        beforeStatus,
        afterStatus,
        transitioned,
        ...(transitioned ? {} : { note: 'no transition' }),
      })
      if (transitioned && (afterStatus === 'done' || afterStatus === 'blocked')) {
        await recordTaskReflection({
          memoryDir: this.opts.config.memoryDir,
          task: taskAfter,
        })
      }
      await this.maybeWriteReviewPacket(taskAfter)
      if (
        agent.name === 'worker-agent' &&
        beforeStatus === 'in_progress' &&
        corpusRefreshTouchedFiles.length > 0
      ) {
        await this.refreshCorpusMapForTask({
          task: taskAfter,
          projectRoot: activeTaskWorktreeProjectPath,
          touchedFiles: corpusRefreshTouchedFiles,
          reason: 'worker-completion',
        })
      }

      // FR-24: teardown on terminal transitions. `pending_pr` is preserved —
      // the human still needs the branch alive to merge the PR externally.
      await this.maybeCleanupWorktree(taskAfter, worktreeMode)
      if (taskAfter.status === 'done' || taskAfter.status === 'blocked' || taskAfter.status === 'shelved') {
        await this.normalizeTerminalOwnership(taskAfter)
      }

      return {
        kind: 'processed',
        taskId: task.id,
        agent: agent.name,
        beforeStatus,
        afterStatus,
        transitioned,
        ...(processedOutcomeNote ? { note: processedOutcomeNote } : {}),
        revisionCount,
        ...(taskHasUnansweredUserQuestion(taskAfter) ? { waitingOnUser: true } : {}),
      }
      })
    } finally {
      if (slot) this.slotAllocator?.release(task.id)
    }
  }

  /**
   * Loop `tick()` until max ticks or idle shutdown. Logs a heartbeat banner
   * at start; each tick self-reports to PROGRESS.md.
   */
  async run(opts: OrchestratorRunOptions = {}): Promise<OrchestratorRunResult> {
    const {
      maxTicks = Infinity,
      tickDelayMs = 2000,
      stopAfterOneTask = false,
      preferredTaskId,
    } = opts
    const idleLimit = this.opts.idleShutdownAfterTicks ?? DEFAULT_IDLE_SHUTDOWN
    let finalResult: OrchestratorRunResult | null = null

    this.banner()
    this.runAutomationResolutionCount = 0
    this.runAutomationResolutionKinds.clear()

    // FR-18: SESSION_START is the "orchestrator woke up" event. Hooks may use
    // it to prime a log, bump a health counter, or gate startup with a
    // blocking result. A blocking hook aborts run() before any tick fires.
    if (this.opts.hookExecutor != null) {
      const pre = await this.opts.hookExecutor.execute(HookEvent.SESSION_START, {
        event: HookEvent.SESSION_START,
        workspaceId: this.opts.config.workspaceId,
      })
      if (pre.blocked) {
        console.warn(
          `[guildhall] SESSION_START hook blocked startup: ${pre.reason ?? '(no reason)'}`,
        )
        return {
          ticks: 0,
          stopReason: 'blocked_only',
          stopMessage: `SESSION_START blocked startup: ${pre.reason ?? '(no reason)'}`,
        }
      }
    }

    // Project bootstrap: run install/build/migrate commands and verify via
    // successGates before any task is dispatched. When task worktrees are
    // enabled, bootstrap belongs to the task worktree, not the shared
    // checkout. Installers are allowed to create lockfiles and generated
    // files; running them here would dirty the base branch before Guildhall
    // has isolated the task and would make its own worktree guard fail.
    // Skipped when the lockfile hash + command set haven't changed since the
    // last successful run. A failed bootstrap aborts startup only for the
    // shared-checkout mode; isolated tasks receive the same gate in their
    // worktree during dispatch.
    const bootstrap = this.opts.config.bootstrap
    const configuredWorktreeMode = await this.resolveWorktreeModeSafe()
    if (
      bootstrap &&
      bootstrap.commands.length > 0 &&
      configuredWorktreeMode === 'none'
    ) {
      const needed = bootstrapNeeded(
        this.opts.config.memoryDir,
        this.opts.config.projectPath,
        bootstrap.commands,
        bootstrap.successGates,
      )
      if (needed) {
        console.log('[guildhall] running bootstrap...')
        const res = runBootstrap({
          projectPath: this.opts.config.projectPath,
          memoryDir: this.opts.config.memoryDir,
          commands: bootstrap.commands,
          successGates: bootstrap.successGates,
          timeoutMs: bootstrap.timeoutMs,
        })
        if (!res.success) {
          const failed = res.steps.find((s) => s.result === 'fail')
          console.error(
            `[guildhall] bootstrap failed on ${failed?.kind ?? 'step'} \`${failed?.command ?? ''}\` (exit ${failed?.exitCode ?? '?'}). See memory/bootstrap.json.`,
          )
          return {
            ticks: 0,
            stopReason: 'blocked_only',
            stopMessage:
              `Bootstrap failed on ${failed?.kind ?? 'step'} \`${failed?.command ?? ''}\` ` +
              `(exit ${failed?.exitCode ?? '?'}).`,
          }
        }
        console.log(`[guildhall] bootstrap passed (${res.steps.length} steps).`)
      }
    } else if (bootstrap && bootstrap.commands.length > 0) {
      console.log(
        `[guildhall] deferring project bootstrap to isolated task worktrees ` +
        `(worktree isolation: ${configuredWorktreeMode}).`,
      )
    }

    // FR-33: on startup, any task sitting in `in_progress`/`review`/`gate_check`
    // without a live agent is a crash-survivor. Log it — FR-32 will consume
    // these candidates; until then, this surfaces the state a human operator
    // needs to see. Failures are non-fatal (missing memory dir on a fresh
    // workspace is expected).
    try {
      const reclaim = await this.scanReclaimCandidates()
      for (const cand of reclaim) {
        const cpDesc = cand.checkpoint
          ? `checkpoint step ${cand.checkpoint.step} (${Math.round((cand.ageMs ?? 0) / 1000)}s old)`
          : 'no checkpoint'
        const flag = cand.autoEscalate ? ' [AUTO-ESCALATE: >24h]' : ''
        console.warn(
          `[guildhall] reclaim candidate: ${cand.task.id} [${cand.task.status}] ${cpDesc}${flag}`,
        )
      }
    } catch (err) {
      console.warn(
        `[guildhall] reclaim scan failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    let tick = 0
    let staleTargetedBatchRetries = 0
    while (tick < maxTicks) {
      tick++
      let raw: TickOutcome
      try {
        raw = await this.tick({
          ...(stopAfterOneTask ? { dispatchLimit: 1 } : {}),
          ...(preferredTaskId ? { preferredTaskId } : {}),
        })
        staleTargetedBatchRetries = 0
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (/^Stale targeted task batch:/.test(message) && staleTargetedBatchRetries < 3) {
          staleTargetedBatchRetries += 1
          tick -= 1
          console.warn(
            `[guildhall] project state changed during targeted dispatch; refreshing and retrying (${staleTargetedBatchRetries}/3).`,
          )
          await new Promise(resolve => setTimeout(resolve, Math.min(250 * staleTargetedBatchRetries, 750)))
          continue
        }
        throw err
      }

      // FR-24: flatten batch outcomes from fanout dispatch so the logging /
      // backend-event paths keep their one-entry-per-task shape.
      const allOutcomes: TickOutcome[] =
        raw.kind === 'batch' ? raw.outcomes : [raw]

      let shouldStop = false
      for (const outcome of allOutcomes) {
        if (outcome.kind === 'idle') {
          if (stopAfterOneTask && preferredTaskId) {
            const completed = await this.completeSelectedTaskClosureIfSatisfied(preferredTaskId)
            if (completed.completed) {
              finalResult = {
                ticks: 0,
                stopReason: 'one_task',
                stopMessage:
                  `Selected task ${preferredTaskId} completed after linked child work: ` +
                  `${completed.childIds.join(', ')}.`,
              }
              console.log(`[guildhall] ${finalResult.stopMessage} Shutting down.`)
              shouldStop = true
              break
            }
            const blockers = await this.selectedTaskClosureBlockers(preferredTaskId)
            if (blockers.length > 0) {
              finalResult = {
                ticks: 0,
                stopReason: 'dependency_blocked',
                stopMessage:
                  `Selected task ${preferredTaskId} is blocked by linked child work: ` +
                  `${blockers.join(', ')}.`,
              }
              console.log(`[guildhall] ${finalResult.stopMessage} Shutting down.`)
              shouldStop = true
              break
            }
          }
          if (outcome.allDone) {
            finalResult = stopResultFromIdle(outcome, idleLimit)
            console.log(`[guildhall] ${finalResult.stopMessage} Shutting down.`)
            shouldStop = true
            break
          }
          if (outcome.consecutiveIdleTicks > idleLimit) {
            finalResult = stopResultFromIdle(outcome, idleLimit)
            console.log(`[guildhall] ${finalResult.stopMessage} Shutting down.`)
            shouldStop = true
            break
          }
        } else if (outcome.kind === 'processed') {
          const suffix = outcome.transitioned
            ? ''
            : ` (${outcome.note ?? 'no change'})`
          console.log(
            `[guildhall] tick ${tick}: ${outcome.taskId} ${outcome.beforeStatus} → ${outcome.afterStatus} via ${outcome.agent}${suffix}`,
          )
        } else if (outcome.kind === 'blocked-max-revisions') {
          console.log(
            `[guildhall] tick ${tick}: ${outcome.taskId} blocked after ${outcome.revisionCount} revisions.`,
          )
        } else if (outcome.kind === 'no-coordinator') {
          console.warn(
            `[guildhall] tick ${tick}: ${outcome.taskId} skipped — no coordinator for domain "${outcome.domain}".`,
          )
        } else if (outcome.kind === 'agent-error') {
          console.error(
            `[guildhall] tick ${tick}: ${outcome.agent} failed on ${outcome.taskId}: ${outcome.error}`,
          )
        } else if (outcome.kind === 'provider-backoff') {
          console.warn(
            `[guildhall] tick ${tick}: ${outcome.agent} hit retryable provider backoff on ${outcome.taskId}; preserving ${outcome.status}.`,
          )
        } else if (outcome.kind === 'escalated') {
          console.warn(
            `[guildhall] tick ${tick}: ${outcome.taskId} escalated by ${outcome.agent} — ${outcome.reason} (${outcome.escalationId}).`,
          )
        } else if (outcome.kind === 'proposal-decided') {
          console.log(
            `[guildhall] tick ${tick}: proposal ${outcome.taskId} → ${outcome.newStatus} (${outcome.actionKind}, lever=${String(outcome.leverPosition)}).`,
          )
        } else if (outcome.kind === 'pre-rejection-applied') {
          console.log(
            `[guildhall] tick ${tick}: ${outcome.taskId} pre-rejection ${outcome.actionKind} → ${outcome.newStatus} (policy=${String(outcome.domainLeverPosition)}, count=${outcome.requeueCount}).`,
          )
        } else if (outcome.kind === 'bootstrap-required') {
          console.warn(
            `[guildhall] tick ${tick}: bootstrap ${outcome.reason} — ${outcome.pendingTaskCount} task(s) held; run bootstrap from /settings/ready.`,
          )
        }

        if (this.opts.onBackendEvent) {
          const tickEvent = tickOutcomeToBackendEvent(outcome)
          if (tickEvent) {
            try {
              await this.opts.onBackendEvent(tickEvent)
            } catch (err) {
              console.warn(
                `[guildhall] onBackendEvent threw (tick): ${err instanceof Error ? err.message : String(err)}`,
              )
            }
          }
        }

        if (stopAfterOneTask && shouldStopOneTaskRun(outcome)) {
          const queueAfterOutcome = preferredTaskId ? await this.readQueue() : null
          if (
            queueAfterOutcome &&
            shouldContinueSelectedTaskClosure(outcome, preferredTaskId, queueAfterOutcome.tasks)
          ) {
            continue
          }
          finalResult = {
            ticks: 0,
            stopReason: 'one_task',
            stopMessage: `stopAfterOneTask reached ${describeOneTaskStop(outcome)}.`,
          }
          console.log(
            `[guildhall] ${finalResult.stopMessage} Shutting down.`,
          )
          shouldStop = true
          break
        }
      }

      if (shouldStop) break

      // FR-31: drain agent issues once per tick (shared across fanout outcomes
      // since the drain walks the whole queue). Issues do not alter task
      // status, so surfacing them outside the per-outcome loop keeps the wire
      // events deduplicated.
      const issues = await this.drainPendingIssues()
      for (const issue of issues) {
        console.log(
          `[guildhall] tick ${tick}: agent-issue ${issue.id} on ${issue.taskId} ` +
            `[${issue.severity}/${issue.code}] — ${issue.detail}`,
        )
        if (this.opts.onBackendEvent) {
          try {
            await this.opts.onBackendEvent(agentIssueToBackendEvent(issue))
          } catch (err) {
            console.warn(
              `[guildhall] onBackendEvent threw (issue): ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
      }

      if (this.opts.stopSignal?.stopRequested) {
        finalResult = {
          ticks: 0,
          stopReason: 'stop_requested',
          stopMessage: `Stop requested after tick ${tick}.`,
        }
        console.log(`[guildhall] ${finalResult.stopMessage} Shutting down.`)
        break
      }

      // FR-28: an external tool (systemd, remote operator, another guildhall
      // process) may write the marker file directly. Treat it the same as an
      // in-memory stopSignal flip so operators don't need signal delivery.
      if (isStopRequested(getProjectStateDir(this.opts.config.projectPath))) {
        finalResult = {
          ticks: 0,
          stopReason: 'stop_marker',
          stopMessage: `Stop marker detected after tick ${tick}.`,
        }
        console.log(`[guildhall] ${finalResult.stopMessage} Shutting down.`)
        if (this.opts.stopSignal) this.opts.stopSignal.stopRequested = true
        break
      }

      await sleep(tickDelayMs)
    }

    if (!finalResult) {
      finalResult = {
        ticks: 0,
        stopReason: 'max_ticks',
        stopMessage: `Reached maxTicks (${maxTicks}).`,
      }
    }
    finalResult.ticks = tick
    finalResult.usage = this.aggregateAgentUsage()
    finalResult.automationResolutionCount = this.runAutomationResolutionCount
    finalResult.automationResolutionKinds = Object.fromEntries(this.runAutomationResolutionKinds)

    console.log(
      `[guildhall] Coordinator stopped after ${tick} ticks (${finalResult.stopReason}).`,
    )

    // FR-18: SESSION_END fires after the loop exits for any reason (idle
    // shutdown, all-done, max-ticks). We do not honor a `blocked` result here
    // because the session is already ending — hooks are advisory at this point.
    if (this.opts.hookExecutor != null) {
      await this.opts.hookExecutor.execute(HookEvent.SESSION_END, {
        event: HookEvent.SESSION_END,
        workspaceId: this.opts.config.workspaceId,
        ticks: tick,
      })
    }

    return finalResult
  }

  private aggregateAgentUsage(): NonNullable<OrchestratorRunResult['usage']> {
    const agents = new Set<OrchestratorAgent>([
      this.opts.agents.spec,
      this.opts.agents.worker,
      this.opts.agents.reviewer,
      this.opts.agents.gateChecker,
      ...Object.values(this.opts.agents.coordinators),
    ])
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cached_input_tokens: 0,
    }
    for (const agent of agents) {
      if (!agent.totalUsage) continue
      usage.input_tokens += agent.totalUsage.input_tokens
      usage.output_tokens += agent.totalUsage.output_tokens
      usage.cached_input_tokens += agent.totalUsage.cached_input_tokens ?? 0
    }
    return usage
  }

  /**
   * FR-31: scan the queue for agent-issue entries that have not yet been
   * broadcast, flip them to `broadcast=true`, and return them. Callers
   * (the run loop, serve layer, test harness) convert each one into an
   * `agent_issue` backend event via `agentIssueToBackendEvent`.
   *
   * Deliberately a separate channel from `tick()` outcomes: an issue does
   * NOT alter the task's status, so there is no lifecycle transition to
   * piggyback on, and multiple issues may surface across multiple tasks in
   * a single tick cycle.
   */
  /**
   * FR-32: collect every pending remediation trigger across the three
   * signal sources: FR-30 stall flags, FR-31 unresolved agent issues, and
   * FR-33 reclaim candidates. Deduplicated by (kind, taskId, agentId) so a
   * task that is simultaneously stalled AND has an open issue surfaces both
   * as distinct triggers (the coordinator may want to treat them
   * differently).
   *
   * Pure w.r.t. task state — does not mutate the queue or the tracker.
   */
  async collectRemediationTriggers(
    nowMs: number = Date.now(),
  ): Promise<RemediationTrigger[]> {
    const queue = await this.readQueue()
    const triggers: RemediationTrigger[] = []

    // FR-30 stalls
    for (const flag of this.livenessTracker.scanStalls(nowMs)) {
      triggers.push({
        kind: 'stall',
        taskId: flag.taskId,
        agentId: flag.agentId,
        flag,
      })
    }

    // FR-31 unresolved agent issues. Every open issue is a trigger — the
    // coordinator decides whether to act on each. The `broadcast` flag is
    // separate (it governs FR-16 wire-event emission, not remediation).
    for (const task of queue.tasks) {
      for (const issue of await this.readEffectiveAgentIssues(task)) {
        if (issue.resolvedAt) continue
        triggers.push({
          kind: 'issue',
          taskId: task.id,
          agentId: issue.agentId,
          issue,
        })
      }
    }

    // FR-33 reclaim candidates
    const liveIds = this.livenessTracker.snapshot().map((e) => e.agentId)
    const stranded = findReclaimTasks(queue, liveIds)
    const candidates = await loadReclaimCandidates(
      this.opts.config.memoryDir,
      stranded,
      nowMs,
    )
    for (const cand of candidates) {
      triggers.push({
        kind: 'crash',
        taskId: cand.task.id,
        // A crashed task's best-effort agent id is its assignee; may be ''
        // if the task was picked up but the orchestrator never stamped an
        // assignee (edge case — coordinator can still decide).
        agentId: cand.task.assignedTo ?? '',
        candidate: cand,
      })
    }

    return triggers
  }

  /**
   * FR-32: build a remediation context for a single trigger. Pulls the
   * lever positions, the last durable checkpoint, and the prior-attempt
   * count off the task. The coordinator agent is invoked with this as its
   * input prompt in a subsequent step (that wiring lives in the serve
   * layer where the full coordinator-agent loop runs).
   */
  async buildRemediationContextFor(
    trigger: RemediationTrigger,
  ): Promise<RemediationContext> {
    const queue = await this.readQueue()
    const task = queue.tasks.find((t) => t.id === trigger.taskId)
    if (!task) {
      throw new Error(
        `buildRemediationContextFor: task ${trigger.taskId} not on queue`,
      )
    }
    const checkpoint =
      trigger.kind === 'crash'
        ? trigger.candidate.checkpoint
        : await readCheckpoint(this.opts.config.memoryDir, task.id)

    const settings = await this.readLeverSettings()
    const domainLevers = resolveDomainLevers(settings, task.domain)
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    const effectiveTask = await buildEffectiveTask(projectRoot, task)

    return buildRemediationContext({
      trigger,
      task,
      levers: {
        remediationAutonomy: settings.project.remediation_autonomy.position,
        crashRecoveryDefault: domainLevers.crash_recovery_default.position,
        agentHealthStrictness: settings.project.agent_health_strictness.position,
      },
      checkpoint,
      priorAttempts: typeof effectiveTask.remediationAttempts === 'number'
        ? effectiveTask.remediationAttempts
        : task.remediationAttempts,
      now: this.now(),
    })
  }

  /**
   * FR-32: authorize a coordinator-chosen action against the
   * `remediation_autonomy` lever + FR-33 24h auto-escalation. Pure — does
   * not execute or record.
   */
  authorizeRemediation(
    action: RemediationAction,
    context: RemediationContext,
  ): AuthorizationDecision {
    return authorizeAction(
      action,
      context.leverState.remediationAutonomy,
      context.trigger,
    )
  }

  /**
   * FR-32: persist a remediation decision to DECISIONS.md (per AC-24) and
   * bump the task's `remediationAttempts` counter. Called whether the
   * action was executed autonomously OR is pending human confirmation —
   * the decision itself is always recorded.
   *
   * This is deliberately orthogonal to action execution. Callers that do
   * execute (e.g. flipping the task to blocked for `escalate_to_human`)
   * invoke those side effects separately.
   */
  async recordRemediation(input: {
    context: RemediationContext
    action: RemediationAction
    authorization: AuthorizationDecision
    decidedBy: string
  }): Promise<void> {
    const queue = await this.readQueue()
    const task = queue.tasks.find((t) => t.id === input.context.taskId)
    if (!task) {
      throw new Error(
        `recordRemediation: task ${input.context.taskId} not on queue`,
      )
    }
    await recordRemediationDecision({
      decisionsPath: this.decisionsPath(),
      context: input.context,
      action: input.action,
      authorization: input.authorization,
      decidedBy: input.decidedBy,
      domain: task.domain,
    })
    task.updatedAt = this.now()
    queue.lastUpdated = this.now()
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    const effectiveTask = await buildEffectiveTask(projectRoot, task)
    await upsertTaskRuntimeState(projectRoot, task.id, {
      remediationAttempts: (typeof effectiveTask.remediationAttempts === 'number' ? effectiveTask.remediationAttempts : 0) + 1,
      updatedAt: task.updatedAt,
    })
    await this.writeQueue(queue)
  }

  private async recordTaskNoteEvidence(task: Task, note: NonNullable<Task['notes']>[number]): Promise<void> {
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    await appendTaskEvidence(projectRoot, task.id, {
      id: `note-${task.id}-${note.timestamp.replace(/[^0-9A-Za-z]/g, '')}-${note.role}`,
      kind: 'note',
      recordedAt: note.timestamp,
      payload: note,
    })
  }

  private async appendRuntimeTaskNote(input: {
    taskId: string
    agentId: string
    content: string
    timestamp?: string
  }): Promise<void> {
    const timestamp = input.timestamp ?? this.now()
    await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const task = queue.tasks.find((candidate) => candidate.id === input.taskId)
      if (!task) return
      const note: NonNullable<Task['notes']>[number] = {
        agentId: input.agentId,
        role: 'runtime',
        content: input.content,
        timestamp,
      }
      task.notes.push(note)
      task.updatedAt = timestamp
      queue.lastUpdated = timestamp
      await this.recordTaskNoteEvidence(task, note)
      await this.writeQueue(queue)
    })
  }

  private async readEffectiveAgentIssues(task: Task): Promise<AgentIssue[]> {
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    const evidence = await readTaskEvidence(projectRoot, task.id, { kind: 'agent_issue' })
    const issues = new Map<string, AgentIssue>()
    for (const issue of task.agentIssues) issues.set(issue.id, issue)
    for (const event of evidence) {
      const parsed = AgentIssue.safeParse(event.payload)
      if (parsed.success) issues.set(parsed.data.id, parsed.data)
    }
    return [...issues.values()].sort((a, b) => a.raisedAt.localeCompare(b.raisedAt))
  }

  private async recordAgentIssueEvidence(task: Task, issue: AgentIssue, recordedAt: string): Promise<void> {
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    await appendTaskEvidence(projectRoot, task.id, {
      id: `${issue.id}-${recordedAt.replace(/[^0-9A-Za-z]/g, '')}`,
      kind: 'agent_issue',
      recordedAt,
      payload: issue,
    })
    const issues = await this.readEffectiveAgentIssues(task)
    await upsertTaskRuntimeState(projectRoot, task.id, {
      openIssueIds: issues.filter((candidate) => !candidate.resolvedAt).map((candidate) => candidate.id),
      updatedAt: recordedAt,
    })
  }

  private async recordAutonomousCheckpointNoProgressRemediation(input: {
    task: Task
    queue: TaskQueue
    agentName: string
    checkpoint: Checkpoint | null
    resetAgent: () => void
  }): Promise<boolean> {
    if (input.task.status !== 'in_progress') return false
    const now = this.now()
    const issue: AgentIssue = {
      id: `iss-${input.task.id}-${input.task.agentIssues.length + 1}`,
      taskId: input.task.id,
      agentId: input.agentName,
      code: 'stuck',
      severity: 'warn',
      detail:
        'Worker repeatedly hit checkpoint-directed no-progress stops without a mutation, verification handoff, or explicit escalation.',
      suggestedAction:
        'Restart from the latest checkpoint with a fresh worker conversation before escalating to human judgment.',
      raisedAt: now,
      broadcast: true,
      resolvedAt: now,
      resolution:
        'Coordinator autonomously reset the worker conversation and restarted from the latest checkpoint.',
      resolvedBy: 'coordinator-remediation',
    }
    const settings = await this.readLeverSettings()
    const domainLevers = resolveDomainLevers(settings, input.task.domain)
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    const effectiveTask = await buildEffectiveTask(projectRoot, input.task)
    const trigger: RemediationTrigger = {
      kind: 'issue',
      taskId: input.task.id,
      agentId: input.agentName,
      issue,
    }
    const context = buildRemediationContext({
      trigger,
      task: input.task,
      levers: {
        remediationAutonomy: settings.project.remediation_autonomy.position,
        crashRecoveryDefault: domainLevers.crash_recovery_default.position,
        agentHealthStrictness: settings.project.agent_health_strictness.position,
      },
      checkpoint: input.checkpoint,
      priorAttempts: typeof effectiveTask.remediationAttempts === 'number'
        ? effectiveTask.remediationAttempts
        : input.task.remediationAttempts ?? 0,
      now,
    })
    const action: RemediationAction = {
      kind: 'restart_from_checkpoint',
      rationale:
        'The worker did not mutate or escalate after checkpoint-directed no-progress stops. Restarting from the durable checkpoint is non-destructive and gives the worker one clean recovery attempt before human escalation.',
    }
    const authorization = this.authorizeRemediation(action, context)
    if (authorization.kind !== 'autonomous') return false

    await recordRemediationDecision({
      decisionsPath: this.decisionsPath(),
      context,
      action,
      authorization,
      decidedBy: 'coordinator-remediation',
      domain: input.task.domain,
    })

    input.resetAgent()
    await this.recordAgentIssueEvidence(input.task, issue, now)
    await upsertTaskRuntimeState(projectRoot, input.task.id, {
      remediationAttempts: (typeof effectiveTask.remediationAttempts === 'number' ? effectiveTask.remediationAttempts : 0) + 1,
      updatedAt: now,
    })
    await this.resetWorkerRecoveryCounters(input.task.id, ['noProgressAttempts'])
    input.task.status = 'in_progress'
    ensureWorkerOwnership(input.task)
    input.task.blockReason = undefined
    const note = {
      agentId: 'coordinator-remediation',
      role: 'checkpoint',
      content:
        'Autonomous remediation: reset the worker conversation and restarted from the latest checkpoint after repeated checkpoint no-progress stops.',
      timestamp: now,
    }
    input.task.notes.push(note)
    await this.recordTaskNoteEvidence(input.task, note)
    input.task.updatedAt = now
    input.queue.lastUpdated = now
    await this.writeQueue(input.queue)
    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: input.task.id,
      agent_name: 'coordinator-remediation',
      message:
        'Coordinator reset the worker conversation and restarted from the latest checkpoint after repeated checkpoint no-progress stops.',
    })
    return true
  }

  /**
   * FR-33: scan the queue for reclaim candidates — tasks in
   * `in_progress`/`review`/`gate_check` whose assigned agent is not in the
   * liveness tracker's live set. Returns each with its last durable
   * checkpoint (or null) and an `autoEscalate` flag for checkpoints older
   * than 24h.
   *
   * Pure w.r.t. task state: does not mutate the queue. The caller (FR-32
   * remediation loop) decides what to do with each candidate.
   */
  async scanReclaimCandidates(nowMs: number = Date.now()): Promise<ReclaimCandidate[]> {
    const queue = await this.readQueue()
    const liveIds = this.livenessTracker.snapshot().map((e) => e.agentId)
    const stranded = findReclaimTasks(queue, liveIds)
    return loadReclaimCandidates(this.opts.config.memoryDir, stranded, nowMs)
  }

  async drainPendingIssues(): Promise<AgentIssue[]> {
    const queue = await this.readQueue()
    const drained: AgentIssue[] = []

    for (const task of queue.tasks) {
      for (const issue of await this.readEffectiveAgentIssues(task)) {
        if (!issue.broadcast && !issue.resolvedAt) {
          const now = this.now()
          const broadcastIssue = { ...issue, broadcast: true }
          await this.recordAgentIssueEvidence(task, broadcastIssue, now)
          drained.push(broadcastIssue)
        }
      }
    }

    return drained
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private resetSpecAgentForFreshReframe(task: Task, agent: OrchestratorAgent): void {
    if (agent !== this.opts.agents.spec || typeof agent.resetConversation !== 'function') return

    const reframeNote = [...task.notes].reverse().find((note) =>
      note.structured?.event === 'reframe_requested'
    )
    if (!reframeNote) return

    const marker = `${reframeNote.timestamp}:${reframeNote.content}`
    if (this.freshReframeResets.get(task.id) === marker) return

    agent.resetConversation()
    this.freshReframeResets.set(task.id, marker)
  }

  private selectAgent(task: Task):
    | { kind: 'agent'; agent: OrchestratorAgent; promptSuffix: string }
    | { kind: 'no-coordinator' } {
    const hasDraftEvidence = taskHasDraftEvidence(task)
    const proofRecoveryNeedsShaping = hasActiveProofRecovery(task) && !hasUsableBlueprint(task)
    if (
      task.id !== META_INTAKE_TASK_ID &&
      (task.status === 'ready' || task.status === 'in_progress') &&
      (hasDraftEvidence || proofRecoveryNeedsShaping) &&
      !task.spec?.trim()
    ) {
      return {
        kind: 'agent',
        agent: this.opts.agents.spec,
        promptSuffix:
          (proofRecoveryNeedsShaping
            ? "Proof recovery reopened this task, but the current task has no durable implementation blueprint. Do not implement it yet or treat an old completion packet as a spec. "
            : "This task advanced without a saved spec. Do not implement it yet. ") +
          "Shape the work before implementation: " +
          "write the implementation spec into the task spec via update-task, preserve the actual bounded outcome, add concrete acceptance criteria and exact proof commands, then set status to 'spec_review' so the coordinator can review it.",
      }
    }

    switch (task.status) {
      case 'exploring':
        const proofRecoveryPrompt = hasActiveProofRecovery(task)
          ? ' This task is in proof recovery: do not save bare workspace commands such as `pnpm test` or `pnpm build` as proof. Every automated acceptance criterion must carry its exact executable command in the criterion command field (and the spec must show it on an explicit `Command:` line). If the visible project evidence does not name a concrete command, create one bounded proof-setup child with `add-task` under this task and keep its release membership and parent relationship explicit; do not invent a script name, ask the owner to name an internal command, or claim the capability is proven.'
          : ''
        return {
          kind: 'agent',
          agent: this.opts.agents.spec,
          promptSuffix:
            "Drive the conversational intake (FR-12): elicit outcome, numbered acceptance criteria, " +
            "out-of-scope list, happy path + edge cases, domain routing, blast radius, required skills, " +
            "and escalation triggers. When the spec is complete and the user approves, use the " +
            "update-task tool to set status to 'spec_review'. " +
            "If the task already contains a fresh user reframe or a bounded user answer and no unanswered " +
            "question, treat that supplied scope as sufficient: write the task title, then save the product brief " +
            "with update-product-brief and the concrete spec, acceptance criteria, source references, and proof " +
            "commands with update-task before changing status to spec_review. " +
            "Do not browse for more context, invent a recovery task, or turn narration into an owner question. " +
            "The current task spec and product brief are the product boundary only: never copy revision history, recovery attempts, internal agent process, max-revision diagnostics, or worktree/path failures into them. Keep that operational evidence in task notes or history." +
            proofRecoveryPrompt,
        }
      case 'spec_review': {
        if (!task.spec?.trim() && (task.id === META_INTAKE_TASK_ID || hasDraftEvidence)) {
          return {
            kind: 'agent',
            agent: this.opts.agents.spec,
            promptSuffix:
              task.id === META_INTAKE_TASK_ID
                ? "The meta-intake task reached spec_review, but its spec field is empty. " +
                  "Write the full coordinator, lever, and bootstrap YAML draft into the task spec via update-task. " +
                  "If you emit the draft in your final text, include all YAML fences so the orchestrator can recover it."
                : "This task reached spec_review, but its spec field is empty. " +
                  "Write the implementation spec into the task spec via update-task before any coordinator or worker proceeds. " +
                  "Do not transition out of spec_review until the spec field is populated.",
          }
        }
        if (task.id !== META_INTAKE_TASK_ID) {
          const blueprintQuality = validateSpecCompletionBoundary(task)
          if (!blueprintQuality.ok) {
            return {
              kind: 'agent',
              agent: this.opts.agents.spec,
              promptSuffix:
                "This task reached spec_review, but deterministic blueprint validation says it is not ready for coordinator approval. " +
                `Repair the saved spec before implementation. Missing/invalid items: ${blueprintQuality.errors.join(' ')} ` +
                "Write a full implementation spec with a complete '## Completion Boundary' section via update-task, keep or improve acceptance criteria, and leave status as 'spec_review' for coordinator review.",
            }
          }
        }
        const coord = this.opts.agents.coordinators[task.domain]
        if (!coord) return { kind: 'no-coordinator' }
        return {
          kind: 'agent',
          agent: coord,
          promptSuffix:
            "Review this spec against your domain concerns. If approved, transition to 'ready'. " +
            "Otherwise, add a note explaining the required revision and set status back to 'exploring'.",
        }
      }
      case 'ready': {
        const coord = this.opts.agents.coordinators[task.domain]
        if (!coord) return { kind: 'no-coordinator' }
        return {
          kind: 'agent',
          agent: coord,
          promptSuffix:
            "Assign this task to the worker agent, set assignedTo='worker-agent', and transition status to 'in_progress'.",
        }
      }
      case 'in_progress':
        const proofSetupPrompt = isProofSetupTask(task)
          ? ' This is a proof-setup child with a deterministic Guildhall-owned blueprint. Its only deliverable is one exact, task-specific project command: inspect the registered project checkout, reuse an existing focused package/CLI/test command when one exists, or add the smallest focused proof entry when none exists. Record the exact command in the `ac-1` acceptance criterion using update-task, require the exact machine marker already declared in that criterion’s expectedOutputIncludes contract to be printed by the command, ensure the matching command proof path exists, run that exact command, and attach its passing evidence before review. The marker must appear in the captured stdout that Guildhall records; a test runner’s internal pass summary or a self-critique saying the command passed is insufficient. If the runner hides test logs, make the package script emit the marker after the focused command succeeds (for example, a bounded `&& printf` wrapper) or use a small project-owned proof entry that prints it. Do not use a broad workspace convention such as pnpm build or pnpm test as proof, do not rewrite this task into a generic implementation task, and do not let provider narration substitute for the command, its task identity, or its result.'
          : ''
        return {
          kind: 'agent',
          agent: this.opts.agents.worker,
          promptSuffix:
            proofSetupPrompt +
            " Implement this task per the spec. Internal toolchain, module-resolution, package-script, build, test, or proof-command failures are implementation work: fix them in the project and keep going. Do not raise a decision_required escalation or ask the owner to choose between a compile step and a TypeScript runtime for a proof script. Only escalate when a genuine external access requirement or an actual product decision outside the task contract is required. Before any review handoff, persist a self-critique note that includes: acceptance-criterion status, a minimum-scope check, a Review proof packet with changed files/diff scope, exact verification commands and pass/fail results, proof path updates for actual commands/routes/manual workflows/provider dashboards/blocking setup, the current working hypothesis, and known gaps. Only after that proof packet is durable should you transition status to 'review'.",
        }
      case 'review':
        return {
          kind: 'agent',
          agent: this.opts.agents.reviewer,
          promptSuffix:
            "Review the completed work against the acceptance criteria. " +
            "Transition to 'gate_check' if approved, else 'in_progress' with a note listing required revisions.",
        }
      case 'gate_check':
        return {
          kind: 'agent',
          agent: this.opts.agents.gateChecker,
          promptSuffix:
            "Run all hard gates for this task and record their results. " +
            "If all pass, transition to 'done'; else 'in_progress' with the failing gate output.",
        }
      default:
        // done / blocked are terminal; pickNextTask should never return them
        return {
          kind: 'agent',
          agent: this.opts.agents.worker,
          promptSuffix: 'No action required.',
        }
    }
  }

  /**
   * Deterministic claim for approved ready work. This replaces the old
   * coordinator "assign this to worker-agent" prompt with a pure queue
   * mutation so a task spends one tick moving from ready to active and the
   * next tick goes straight to the worker.
   */
  private async claimReadyTaskInline(task: Task): Promise<TickOutcome> {
    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const target = queue.tasks.find((t) => t.id === task.id)
      if (!target) {
        return {
          kind: 'agent-error',
          taskId: task.id,
          agent: 'task-claimer',
          error: `Task ${task.id} not found during ready claim`,
        }
      }

      const beforeStatus = target.status
      if (beforeStatus !== 'ready') {
        return {
          kind: 'processed',
          taskId: target.id,
          agent: 'task-claimer',
          beforeStatus,
          afterStatus: target.status,
          transitioned: false,
          revisionCount: target.revisionCount,
        }
      }

      const blueprintQuality = validateSpecCompletionBoundary(target)
      if (!blueprintQuality.ok) {
        target.status = 'exploring'
        target.assignedTo = null
        target.notes.push({
          agentId: 'blueprint-sanity-review',
          role: 'blueprint-review',
          structured: {
            event: 'blueprint_review',
            decision: 'revise',
            source: 'deterministic',
          },
          content:
            'revise_blueprint: Task was ready but its spec is not buildable yet. ' +
            `${blueprintQuality.errors.join(' ')} Routing back to blueprint drafting before worker assignment.`,
          timestamp: this.now(),
        })
        target.updatedAt = this.now()
        queue.lastUpdated = this.now()
        await this.writeQueue(queue)

        await this.logTickProgress({
          task: target,
          agent: 'blueprint-sanity-review',
          beforeStatus,
          afterStatus: target.status,
          transitioned: true,
        })

        return {
          kind: 'processed',
          taskId: target.id,
          agent: 'blueprint-sanity-review',
          beforeStatus,
          afterStatus: target.status,
          transitioned: true,
          revisionCount: target.revisionCount,
        }
      }

      if (!hasBlueprintSanityReview(target)) {
        target.notes.push({
          agentId: 'blueprint-sanity-review',
          role: 'blueprint-review',
          structured: {
            event: 'blueprint_review',
            decision: 'approve',
            source: 'deterministic',
          },
          content: 'approve_blueprint: Task has a usable blueprint/spec. Worker may build against it.',
          timestamp: this.now(),
        })
      }

      const transitionResult = applyTaskTransition({
        task: target,
        event: 'start_worker',
        actor: 'task-claimer',
        evidenceRefs: ['task:ready-claim'],
        now: this.now(),
      })
      if (transitionResult.kind === 'rejected') {
        target.notes.push({
          agentId: 'task-claimer',
          role: 'orchestrator',
          content:
            `Ready claim rejected by task lifecycle boundary: ${transitionResult.reason}. ` +
            'Leave the task out of worker execution until its hierarchy/readiness state is corrected.',
          timestamp: this.now(),
        })
        target.updatedAt = this.now()
        queue.lastUpdated = this.now()
        await this.writeQueue(queue)

        await this.logTickProgress({
          task: target,
          agent: 'task-claimer',
          beforeStatus,
          afterStatus: target.status,
          transitioned: false,
          note: `task transition rejected: ${transitionResult.reason}`,
        })

        return {
          kind: 'processed',
          taskId: target.id,
          agent: 'task-claimer',
          beforeStatus,
          afterStatus: target.status,
          transitioned: false,
          revisionCount: target.revisionCount,
        }
      }

      target.status = transitionResult.nextState
      target.assignedTo = 'worker-agent'
      target.notes.push({
        agentId: 'task-claimer',
        role: 'orchestrator',
        structured: {
          event: 'task_claim',
          source: 'deterministic',
          taskId: target.id,
          assignedTo: 'worker-agent',
        },
        content: 'Claimed ready task for worker-agent.',
        timestamp: this.now(),
      })
      target.updatedAt = this.now()
      queue.lastUpdated = this.now()
      await this.writeQueue(queue)

      await this.logTickProgress({
        task: target,
        agent: 'task-claimer',
        beforeStatus,
        afterStatus: target.status,
        transitioned: true,
      })

      return {
        kind: 'processed',
        taskId: target.id,
        agent: 'task-claimer',
        beforeStatus,
        afterStatus: target.status,
        transitioned: true,
        revisionCount: target.revisionCount,
      }
    })
  }

  /**
   * FR-21: apply the `task_origination` lever to an agent-proposed task and
   * write the resulting transition to TASKS.json + PROGRESS.md. No LLM call.
   *
   * - `human_only`                         → shelve (not_viable)
   * - `agent_proposed_human_approved`      → spec_review (human approves)
   * - `agent_proposed_coordinator_approved`→ spec_review (coordinator approves)
   * - `agent_autonomous`                   → ready
   *
   * Malformed lever settings surface as an `agent-error` outcome — the caller
   * treats them like any other run-blocking problem and the task stays in
   * `proposed` until the file is fixed.
   */
  private async decideProposal(task: Task, queue: TaskQueue): Promise<TickOutcome> {
    let levers: DomainLevers
    try {
      const settingsPath = getProjectSystemStatePath(
        inferProjectRootFromMemoryDir(this.opts.config.memoryDir),
        AGENT_SETTINGS_FILENAME,
      )
      const settings = await loadLeverSettings({ path: settingsPath })
      levers = resolveDomainLevers(settings, task.domain)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        kind: 'agent-error',
        taskId: task.id,
        agent: PROPOSAL_PROMOTER_AGENT_ID,
        error: `failed to load lever settings: ${message}`,
      }
    }

    const decision = evaluateProposal({
      task,
      levers: { task_origination: levers.task_origination },
    })

    const now = this.now()
    const idx = queue.tasks.findIndex((t) => t.id === task.id)
    const target = queue.tasks[idx]!
    let newStatus: TaskStatus

    switch (decision.action.kind) {
      case 'reject':
        target.status = 'shelved'
        target.shelveReason = {
          code: 'not_viable',
          detail: decision.action.reason,
          rejectedBy: `system:${PROPOSAL_PROMOTER_AGENT_ID}`,
          rejectedAt: now,
          // Policy rejections are truly terminal — tag the source so the
          // pre_rejection_policy loop doesn't try to resurrect them, and
          // pre-mark the decision as applied.
          source: 'proposal_policy',
          policyApplied: true,
          requeueCount: 0,
        }
        target.completedAt = now
        newStatus = 'shelved'
        break
      case 'route_to_human':
      case 'route_to_coordinator':
        requestSpecReview(target, {
          authority: decision.action.kind === 'route_to_human' ? 'owner' : 'coordinator',
          requestedAt: now,
          requestedBy: PROPOSAL_PROMOTER_AGENT_ID,
          reason: 'proposal_promotion',
        })
        newStatus = 'spec_review'
        break
      case 'auto_promote':
        target.status = 'ready'
        newStatus = 'ready'
        break
    }
    target.updatedAt = now
    queue.lastUpdated = now
    await this.writeQueue(queue)

    const progressEntry: ProgressEntry = {
      timestamp: now,
      agentId: PROPOSAL_PROMOTER_AGENT_ID,
      domain: task.domain,
      taskId: task.id,
      summary:
        `Proposal ${task.id}: proposed → ${newStatus} ` +
        `(${decision.action.kind}, lever=${String(decision.leverPosition)}). ` +
        decision.rationale,
      type: 'heartbeat',
    }
    try {
      await logProgress({ progressPath: this.progressPath(), entry: progressEntry })
    } catch {
      // PROGRESS.md unwriteable — non-fatal
    }

    return {
      kind: 'proposal-decided',
      taskId: task.id,
      actionKind: decision.action.kind,
      leverPosition: decision.leverPosition,
      newStatus,
    }
  }

  private async recoverMetaIntakeDraftFromSpecSession(task: Task): Promise<TickOutcome | null> {
    const snapshot = loadSessionById(
      this.opts.config.projectPath,
      `${this.opts.config.workspaceId}-spec`,
    )
    if (!snapshot) return null
    const taskCreatedMs = Date.parse(task.createdAt)
    const snapshotCreatedMs = snapshot.created_at * 1000
    if (
      Number.isFinite(taskCreatedMs) &&
      Number.isFinite(snapshotCreatedMs) &&
      snapshotCreatedMs < taskCreatedMs
    ) {
      return null
    }
    const draft = findMetaIntakeDraftText({
      text: '',
      messages: snapshot.messages,
    })
    if (!draft) return null

    const queue = await this.readQueue()
    const target = queue.tasks.find((t) => t.id === task.id)
    if (!target || target.spec) return null

    const beforeStatus = target.status
    target.spec = draft
    if (target.status === 'exploring') {
      requestSpecReview(target, {
        authority: 'owner',
        requestedAt: this.now(),
        requestedBy: 'spec-agent',
      })
    }
    target.updatedAt = this.now()
    queue.lastUpdated = this.now()
    await this.writeQueue(queue)

    await this.logTickProgress({
      task: target,
      agent: 'spec-agent',
      beforeStatus,
      afterStatus: target.status,
      transitioned: beforeStatus !== target.status,
      note: 'recovered meta-intake draft from saved spec-agent session',
    })

    return {
      kind: 'processed',
      taskId: task.id,
      agent: 'spec-agent',
      beforeStatus,
      afterStatus: target.status,
      transitioned: beforeStatus !== target.status,
      revisionCount: target.revisionCount,
    }
  }

  /**
   * FR-22: apply `pre_rejection_policy` (domain) + `rejection_dampening`
   * (project) to a worker-shelved task. Either keeps the task shelved (mark
   * `policyApplied`) or resurrects it to `ready` at a possibly-lowered
   * priority. Always increments `requeueCount` so dampening thresholds fire
   * on repeat rejections.
   */
  private async applyPreRejectionPolicy(
    task: Task,
    queue: TaskQueue,
  ): Promise<TickOutcome> {
    let domainLevers: DomainLevers
    let projectLevers: ProjectLevers
    try {
      const settingsPath = getProjectSystemStatePath(
        inferProjectRootFromMemoryDir(this.opts.config.memoryDir),
        AGENT_SETTINGS_FILENAME,
      )
      const settings = await loadLeverSettings({ path: settingsPath })
      domainLevers = resolveDomainLevers(settings, task.domain)
      projectLevers = settings.project
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        kind: 'agent-error',
        taskId: task.id,
        agent: PRE_REJECTION_POLICY_AGENT_ID,
        error: `failed to load lever settings: ${message}`,
      }
    }

    const decision = evaluatePreRejection({
      currentRequeueCount: task.shelveReason?.requeueCount ?? 0,
      currentPriority: task.priority,
      domain: { pre_rejection_policy: domainLevers.pre_rejection_policy },
      project: { rejection_dampening: projectLevers.rejection_dampening },
    })

    const now = this.now()
    const idx = queue.tasks.findIndex((t) => t.id === task.id)
    const target = queue.tasks[idx]!
    const prevReason = target.shelveReason!
    let newStatus: TaskStatus

    switch (decision.action.kind) {
      case 'keep_shelved':
        target.shelveReason = {
          ...prevReason,
          policyApplied: true,
          requeueCount: decision.requeueCount,
        }
        if (!target.completedAt) target.completedAt = now
        newStatus = 'shelved'
        break
      case 'requeue':
        target.status = 'ready'
        target.priority = decision.action.newPriority
        // Preserve the shelve history on the task — mark it applied and
        // bump the requeue count so subsequent dampening reads are correct,
        // but leave the record in place for audit. completedAt is cleared
        // since the task is no longer terminal.
        target.shelveReason = {
          ...prevReason,
          policyApplied: true,
          requeueCount: decision.requeueCount,
        }
        target.completedAt = undefined
        newStatus = 'ready'
        break
    }
    target.updatedAt = now
    queue.lastUpdated = now
    await this.writeQueue(queue)

    const domainPos = String(decision.domainLeverPosition)
    const projectPos =
      typeof decision.projectLeverPosition === 'string'
        ? decision.projectLeverPosition
        : `${decision.projectLeverPosition.kind}${
            'after' in decision.projectLeverPosition
              ? `(after=${decision.projectLeverPosition.after})`
              : ''
          }`

    const progressEntry: ProgressEntry = {
      timestamp: now,
      agentId: PRE_REJECTION_POLICY_AGENT_ID,
      domain: task.domain,
      taskId: task.id,
      summary:
        `Pre-rejection policy: shelved → ${newStatus} ` +
        `(${decision.action.kind}, pre_rejection_policy=${domainPos}, ` +
        `rejection_dampening=${projectPos}, requeueCount=${decision.requeueCount}). ` +
        decision.action.reason,
      type: 'heartbeat',
    }
    try {
      await logProgress({ progressPath: this.progressPath(), entry: progressEntry })
    } catch {
      // PROGRESS.md unwriteable — non-fatal
    }

    return {
      kind: 'pre-rejection-applied',
      taskId: task.id,
      actionKind: decision.action.kind,
      domainLeverPosition: decision.domainLeverPosition,
      projectLeverPosition: decision.projectLeverPosition,
      newStatus,
      requeueCount: decision.requeueCount,
    }
  }

  private tasksPath(): string {
    return getProjectSystemStatePath(
      inferProjectRootFromMemoryDir(this.opts.config.memoryDir),
      'TASKS.json',
    )
  }

  private progressPath(): string {
    return getProjectSystemStatePath(
      inferProjectRootFromMemoryDir(this.opts.config.memoryDir),
      'PROGRESS.md',
    )
  }

  private decisionsPath(): string {
    return getProjectSystemStatePath(
      inferProjectRootFromMemoryDir(this.opts.config.memoryDir),
      'DECISIONS.md',
    )
  }

  /**
   * FR-32 helper: read agent-settings.yaml. Throws if missing — the
   * remediation loop requires real lever state to route authorization
   * decisions correctly (unlike stall scanning which can fall back to
   * 'standard' strictness).
   */
  private async readLeverSettings() {
    const settingsPath = getProjectSystemStatePath(
      inferProjectRootFromMemoryDir(this.opts.config.memoryDir),
      AGENT_SETTINGS_FILENAME,
    )
    return await loadLeverSettings({ path: settingsPath })
  }

  private async ensureReviewPlanRecorded(task: Task): Promise<ReviewPlanRecord | null> {
    const store = this.opts.reviewAuditStore
    if (!store) return null

    try {
      const likelyTargetFiles = resolveLikelyTaskFiles(task)
      const verificationCommands = resolveEffectiveTaskVerificationCommands({
        task,
        workspaceProjectPath: this.opts.config.projectPath,
        ...(this.opts.config.bootstrap
          ? { workspaceBootstrap: this.opts.config.bootstrap }
          : {}),
        workspaceProjects: this.workspaceProjectsForTaskResolution(),
        likelyTargetFiles,
      })
      const settings = await this.readLeverSettings()
      const domainLevers = resolveDomainLevers(settings, task.domain)
      const result = await ensureTaskReviewPlanRecorded({
        store,
        task,
        changedFiles: likelyTargetFiles,
        requestedEffort: domainLevers.review_effort.position as ReviewEffort,
        deterministicChecks: verificationCommands,
        createdBy: 'coordinator-review-planner',
        now: () => new Date(this.now()),
      })
      if (result.recorded) {
        await this.logTickProgress({
          task,
          agent: 'coordinator-review-planner',
          beforeStatus: 'review',
          afterStatus: 'review',
          transitioned: false,
          note:
            `planned ${result.plan.effort} review across ` +
            `${result.plan.selectedLanes.length} risk lane(s) ` +
            `with up to ${result.plan.budget.maxReviewerAgents ?? 'unbounded'} grouped reviewer agent(s)`,
        })
      }
      return result.plan
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await this.logTickProgress({
        task,
        agent: 'coordinator-review-planner',
        beforeStatus: 'review',
        afterStatus: 'review',
        transitioned: false,
        note: `review planning audit write failed: ${message}`,
      })
      return null
    }
  }

  /**
   * FR-27 / AC-18: resolve the `reviewer_mode` for a domain. Any read error
   * (missing file, malformed YAML, unknown domain) falls back to `llm_only`
   * — the conservative default: a silent switch to `deterministic_only`
   * would skip real LLM review, which is strictly worse than falling back
   * to the existing LLM path.
   */
  private async resolveReviewerMode(domain: string): Promise<ReviewerMode> {
    try {
      const settings = await this.readLeverSettings()
      const domainLevers = resolveDomainLevers(settings, domain)
      return domainLevers.reviewer_mode.position as ReviewerMode
    } catch {
      return 'llm_only'
    }
  }

  /**
   * Resolve the `reviewer_fanout_policy` for a domain. Fan-out aggregation
   * uses this to decide how dissents roll up into the task-level verdict
   * (strict, advisory, majority) and whether to flag conflicts for
   * coordinator adjudication. Falls back to `strict` on any read error —
   * the conservative default, matching today's behavior before the lever
   * landed.
   */
  private async resolveReviewerFanoutPolicy(
    domain: string,
  ): Promise<ReviewerFanoutPolicy> {
    try {
      const settings = await this.readLeverSettings()
      const domainLevers = resolveDomainLevers(settings, domain)
      return domainLevers.reviewer_fanout_policy
        .position as ReviewerFanoutPolicy
    } catch {
      return 'strict'
    }
  }

  /**
   * FR-27 / AC-18: apply a deterministic reviewer verdict directly to the
   * queue. Used by the `deterministic_only` mode and by the
   * `llm_with_deterministic_fallback` mode after an LLM outage. Writes the
   * queue, logs a PROGRESS entry, and returns a `processed` TickOutcome.
   *
   * Revision-count bookkeeping is preserved: a `revise` verdict that bounces
   * the task back to `in_progress` bumps `revisionCount` just like the LLM
   * path does, and we enforce `maxRevisions` the same way.
   */
  /**
   * Lean command-backed tasks do not need a qualitative reviewer pass once the
   * worker hands off. The command gates are the reviewer for this class.
   */
  private async advanceLeanCommandBackedReviewInline(task: Task): Promise<TickOutcome> {
    const beforeStatus = task.status
    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const current = queue.tasks.find((candidate) => candidate.id === task.id)
      if (!current || current.status !== 'review') {
        return {
          kind: 'processed',
          taskId: task.id,
          agent: 'lean-command-review',
          beforeStatus,
          afterStatus: task.status,
          transitioned: false,
          revisionCount: task.revisionCount,
        } as TickOutcome
      }
      transitionTaskStatus({
        task: current,
        event: 'start_gate_check',
        actor: 'lean-command-review',
        evidenceRefs: ['task:lean-command-review'],
        now: this.now(),
      })
      current.assignedTo = 'gate-checker-agent'
      current.updatedAt = this.now()
      queue.lastUpdated = current.updatedAt
      current.notes.push({
        agentId: 'lean-command-review',
        role: 'reviewer',
        content:
          'Lean command-backed task skipped qualitative review. Command-backed acceptance criteria will be verified by acceptance-command-gates.',
        timestamp: current.updatedAt,
      })
      await this.writeQueue(queue)
      await this.logTickProgress({
        task: current,
        agent: 'lean-command-review',
        beforeStatus,
        afterStatus: 'gate_check',
        transitioned: true,
        note: 'lean command-backed task handed directly to command gates',
      })
      return {
        kind: 'processed',
        taskId: current.id,
        agent: 'lean-command-review',
        beforeStatus,
        afterStatus: 'gate_check',
        transitioned: true,
        revisionCount: current.revisionCount,
      } as TickOutcome
    })
  }

  /**
   * Command-backed acceptance criteria are hard gates. They must be verified
   * by observed command exits, not by a worker or gate-checker saying they ran.
   */
  private async advanceProofRecoveryToGateCheckInline(
    task: Task,
  ): Promise<TickOutcome | null> {
    const proofRecovery = (task as Task & { proofRecovery?: unknown }).proofRecovery
    const needsLandedCheckoutProof = landedTaskWorkRequiresProjectCheckoutProof(task)
    // A landed task gets one authoritative project-checkout proof attempt.
    // If it fails, the failure requires a fresh worker worktree; repeatedly
    // routing it back to the landed checkout can never change the result.
    const needsInitialLandedCheckoutProof = needsLandedCheckoutProof && !proofRecoveryNeedsFreshWorktree(task)
    if (
      task.status !== 'in_progress' ||
      ((!proofRecovery || typeof proofRecovery !== 'object') && !needsLandedCheckoutProof)
    ) return null
    const commandCriterionIds = new Set(
      task.acceptanceCriteria
        .filter((criterion) => typeof criterion.command === 'string' && criterion.command.trim())
        .map((criterion) => criterion.id),
    )
    if (commandCriterionIds.size === 0) {
      return null
    }
    // A failed authoritative command gate is now a worker-repair handoff. Do
    // not route the same unchanged checkout back through the proof gate on
    // every tick; the worker must get a chance to address the recorded output.
    const reopenedAt = typeof (proofRecovery as { reopenedAt?: unknown } | undefined)?.reopenedAt === 'string'
      ? Date.parse((proofRecovery as { reopenedAt: string }).reopenedAt)
      : NaN
    const hasFailedCommandSinceRecovery = Number.isFinite(reopenedAt) && task.gateResults.some((gate) =>
      gate.type === 'hard' &&
      !gate.passed &&
      commandCriterionIds.has(gate.gateId) &&
      Number.isFinite(Date.parse(gate.checkedAt)) &&
      Date.parse(gate.checkedAt) > reopenedAt,
    )
    if (!needsInitialLandedCheckoutProof && hasFailedCommandSinceRecovery) return null

    const beforeStatus = task.status
    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const current = queue.tasks.find((candidate) => candidate.id === task.id)
      if (!current || current.status !== 'in_progress') return null
      const now = this.now()
      current.proofPaths = ensureCommandProofPathsFromAcceptanceCriteria(current, now)
      transitionTaskStatus({
        task: current,
        event: 'request_review',
        actor: 'proof-recovery-gates',
        evidenceRefs: ['task:proof-recovery'],
        now,
      })
      transitionTaskStatus({
        task: current,
        event: 'start_gate_check',
        actor: 'proof-recovery-gates',
        evidenceRefs: ['task:proof-recovery'],
        now,
      })
      current.assignedTo = 'gate-checker-agent'
      current.updatedAt = now
      queue.lastUpdated = now
      current.notes.push({
        agentId: 'proof-recovery-gates',
        role: 'gate-checker',
        content:
          'Guildhall routed proof recovery directly to its documented acceptance command gates. Implementation work was already complete; no worker rewrite was required.',
        timestamp: now,
      })
      await this.writeQueue(queue)
      await this.logTickProgress({
        task: current,
        agent: 'proof-recovery-gates',
        beforeStatus,
        afterStatus: 'gate_check',
        transitioned: true,
        note: 'proof recovery routed directly to documented command gates',
      })
      return {
        kind: 'processed',
        taskId: current.id,
        agent: 'proof-recovery-gates',
        beforeStatus,
        afterStatus: 'gate_check',
        transitioned: true,
        revisionCount: current.revisionCount,
      } as TickOutcome
    })
  }

  private async runAcceptanceCommandGatesInline(task: Task): Promise<TickOutcome | null> {
    if (task.status !== 'gate_check') return null
    normalizeAutomatedAcceptanceCriterionCommands({
      task,
      workspaceProjectPath: this.opts.config.projectPath,
      workspaceProjects: this.workspaceProjectsForTaskResolution(),
    })
    const commandCriteria = task.acceptanceCriteria
      .map((criterion, index) => ({ criterion, index }))
      .filter(({ criterion }) => shouldRunAcceptanceCommandCriterion(task, criterion))
    if (commandCriteria.length === 0) return null

    // A task reopened solely to refresh stale proof may still retain the
    // checkout from its original implementation attempt. Once that attempt
    // has landed, the project checkout is the authoritative code state. A
    // gate must never rerun against the old branch and report a missing
    // command that is present in the landed project.
    const taskWorkIsLanded = !proofRecoveryNeedsFreshWorktree(task) &&
      ['merged', 'pushed', 'push_failed_degraded'].includes(task.mergeRecord?.result ?? '')
    const recoveredWorktreePath = await this.recoverTaskWorktreePath(task)
    const taskProjectPath =
      !taskWorkIsLanded && recoveredWorktreePath
        ? recoveredWorktreePath
        : this.resolveEffectiveTaskProjectPath(task)
    const gates = commandCriteria.map(({ criterion }) => ({
      id: criterion.id,
      label: criterion.description || criterion.id,
      command: normalizeAcceptanceCommandForGuildhallState(criterion.command!.trim()),
      timeoutMs: 120_000,
    }))
    const summary = await runGates({
      cwd: resolveRuntimePath(taskProjectPath),
      gates,
      failFast: false,
      now: () => this.now(),
    })
    const commandByGateId = new Map(gates.map((gate) => [gate.id, gate.command]))
    const criterionByGateId = new Map(commandCriteria.map(({ criterion }) => [criterion.id, criterion]))
    const results = summary.results.map((result) => {
      const command = commandByGateId.get(result.gateId) ?? result.gateId
      const criterion = criterionByGateId.get(result.gateId)
      const expectedExit = criterion ? expectedAcceptanceExit(criterion) : 'zero'
      const observedExit = result.passed ? 'zero' : 'non_zero'
      const exitMatches = expectedExit === observedExit
      const outputMatches = criterion ? acceptanceOutputMatches(criterion, result.output ?? '') : true
      const passed = exitMatches && outputMatches
      const outputExpectation = criterion?.expectedOutputIncludes?.length
        ? `; expected output includes: ${criterion.expectedOutputIncludes.join(' | ')}`
        : ''
      const outcome = `${command} — observed exit ${observedExit}; expected exit ${expectedExit}${outputExpectation} — ${passed ? 'proof passed' : 'proof failed'}`
      return {
        ...result,
        // Preserve the process result separately. `passed` below means the
        // acceptance contract passed, which may intentionally include a
        // non-zero process exit.
        observedPassed: result.passed,
        passed,
        executionRoot: taskWorkIsLanded ? 'project_checkout' as const : 'task_worktree' as const,
        output: result.output ? `${outcome}\n${result.output}` : outcome,
      }
    })
    const allPassed = results.every((result) => result.passed)

    const beforeStatus = task.status
    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const current = queue.tasks.find((candidate) => candidate.id === task.id)
      if (!current || current.status !== 'gate_check') return null
      normalizeAutomatedAcceptanceCriterionCommands({
        task: current,
        workspaceProjectPath: this.opts.config.projectPath,
        workspaceProjects: this.workspaceProjectsForTaskResolution(),
      })

      const resultByGateId = new Map(results.map((result) => [result.gateId, result]))
      const resultIds = new Set(resultByGateId.keys())
      current.gateResults = [
        ...current.gateResults.filter((result) => !(result.type === 'hard' && resultIds.has(result.gateId))),
        ...results,
      ]
      for (const criterion of current.acceptanceCriteria) {
        const result = resultByGateId.get(criterion.id)
        if (result) {
          criterion.met = result.passed
          const command = commandByGateId.get(criterion.id)
          if (command) criterion.command = command
        }
      }

      const now = this.now()
      current.updatedAt = now
      queue.lastUpdated = now
      const proofContractAt = results
        .map(result => result.checkedAt)
        .filter(Boolean)
        .sort()[0] ?? now
      current.proofPaths = ensureCommandProofPathsFromAcceptanceCriteria(current, proofContractAt)

      const scopedHardGateDisposition = !allPassed
        ? summarizeScopedHardGateDisposition(
            {
              projectPath: current.projectPath,
              likelyTargetFiles: resolveLikelyTaskFiles(current),
              gateScopeExceptions: current.gateScopeExceptions ?? [],
            },
            latestHardGateResults(current),
          )
        : null
      const scopedFailuresExempted = scopedHardGateDisposition?.shouldPass === true
      if (scopedFailuresExempted) {
        if (scopedHardGateDisposition.exemptedFailures.length > 0) {
          const exemptedSummary = scopedHardGateDisposition.exemptedFailures
            .map((gate) => `${gate.gateId}: scoped unrelated repo-red excluded per resolved human decision`)
            .join('; ')
          current.notes.push({
            agentId: 'acceptance-command-gates',
            role: 'gate-checker',
            content: `Gate-check scope exception applied: ${exemptedSummary}`,
            timestamp: now,
          })
        }
      }

      if (allPassed) {
        settleAcceptanceCriteriaAfterScopedGateException(
          current,
          new Set(results.filter((result) => result.passed).map((result) => result.gateId)),
        )
      }

      // Completion evaluates the same typed observations that writeQueue will
      // append to durable evidence. The top-level gateResults mirror remains
      // a compatibility transport and cannot be the current proof authority.
      const observedGateResults = current.gateResults.filter((gate) =>
        gate.checkedAt === now || results.some((result) => result.gateId === gate.gateId && result.checkedAt === gate.checkedAt),
      )
      const currentWithEvidence = current as Task & { evidence?: Array<Record<string, unknown>> }
      currentWithEvidence.evidence = [
        ...(currentWithEvidence.evidence ?? []),
        ...observedGateResults.map((gate) => ({
          id: `gate-${current.id}-${gate.gateId}-${gate.checkedAt.replace(/[^0-9A-Za-z]/g, '')}`,
          taskId: current.id,
          kind: 'gate_result',
          recordedAt: gate.checkedAt,
          payload: gate,
        })),
      ]

      if (!allPassed && !scopedFailuresExempted) {
        const failed = results.filter((result) => !result.passed)
        transitionTaskStatus({
          task: current,
          event: 'revise',
          actor: 'acceptance-command-gates',
          evidenceRefs: failed.map((result) => `gate:${result.gateId}`),
          now,
        })
        ensureWorkerOwnership(current)
        current.completedAt = undefined
        current.revisionCount += 1
        const needsFreshWorktree = taskWorkIsLanded
        current.notes.push({
          agentId: 'acceptance-command-gates',
          role: 'gate-checker',
          structured: {
            event: 'acceptance_command_gates_failed',
            failedGateIds: failed.map((result) => result.gateId),
          },
          content: [
            `Acceptance command gates failed (${failed.length}).`,
            ...failed.map((result) => `- ${result.gateId}: ${(result.output ?? '').split('\n')[0] ?? 'failed'}`),
            'Repair the implementation in the likely target files, then rerun the focused command gates before writing new proof.',
          ].join('\n'),
          timestamp: now,
        })
        await this.writeQueue(queue)
        if (needsFreshWorktree) {
          await upsertTaskRuntimeState(inferProjectRootFromMemoryDir(this.opts.config.memoryDir), current.id, {
            proofRecovery: {
              reopenedAt: now,
              kind: 'proof',
              reason: 'Current project proof failed after prior landing.',
              freshWorktree: true,
            },
            updatedAt: now,
          })
        }
        await this.logTickProgress({
          task: current,
          agent: 'acceptance-command-gates',
          beforeStatus,
          afterStatus: 'in_progress',
          transitioned: true,
          note: `acceptance command gates failed (${failed.length}) → in_progress`,
        })
        return {
          kind: 'processed',
          taskId: current.id,
          agent: 'acceptance-command-gates',
          beforeStatus,
          afterStatus: 'in_progress',
          transitioned: true,
          revisionCount: current.revisionCount,
        } as TickOutcome
      }

      if (current.acceptanceCriteria.length > 0 && current.acceptanceCriteria.every((criterion) => criterion.met)) {
        if (taskDoneButMissingSelectedScopeProof({ ...current, status: 'done' }, queue)) {
          transitionTaskStatus({
            task: current,
            event: 'revise',
            actor: 'acceptance-command-gates',
            evidenceRefs: ['task:proof:missing'],
            now,
          })
          ensureWorkerOwnership(current)
          current.completedAt = undefined
          current.revisionCount += 1
          current.notes.push({
            agentId: 'acceptance-command-gates',
            role: 'gate-checker',
            content:
              'Acceptance command gates passed, but the task still lacks the proof evidence required by its proof path. Keep the task open and attach the missing proof before marking it done.',
            timestamp: now,
          })
          await this.writeQueue(queue)
          await this.logTickProgress({
            task: current,
            agent: 'acceptance-command-gates',
            beforeStatus,
            afterStatus: 'in_progress',
            transitioned: true,
            note: 'acceptance command gates passed but proof path remains unmet → in_progress',
          })
          return {
            kind: 'processed',
            taskId: current.id,
            agent: 'acceptance-command-gates',
            beforeStatus,
            afterStatus: 'in_progress',
            transitioned: true,
            revisionCount: current.revisionCount,
          } as TickOutcome
        }
        transitionTaskStatus({
          task: current,
          event: 'complete',
          actor: 'acceptance-command-gates',
          evidenceRefs: results.map((result) => `gate:${result.gateId}`),
          now,
          requiredEvidencePresent: results.length > 0,
        })
        current.assignedTo = undefined
        current.completedAt = now
        const autoCommit = await this.maybeAutoCommitCompletedTaskWork(current)
        if (!autoCommit.ok) {
          transitionTaskStatus({
            task: current,
            event: 'landing_failed',
            actor: 'acceptance-command-gates',
            evidenceRefs: ['task:landing:auto-commit-failed'],
            now,
          })
          current.assignedTo = null
          current.blockReason =
            `Guildhall could not auto-commit completed work: ${autoCommit.detail ?? 'unknown git error'}.`
          current.notes.push({
            agentId: 'coordinator',
            role: 'git-story',
            content:
              `Auto-commit was required by project Git Story policy, but it failed: ${autoCommit.detail ?? 'unknown git error'}.`,
            timestamp: now,
          })
          current.mergeRecord = {
            fromBranch: current.branchName ?? '<unknown>',
            toBranch: current.baseBranch ?? '<unknown>',
            strategy: await this.resolveLandingStrategySafe(),
            result: 'skipped',
            mergedAt: now,
            detail: 'auto-commit failed before landing',
          }
        } else {
          const landingStrategy = await this.resolveLandingStrategySafe()
          const worktreeMode = await this.resolveWorktreeModeSafe()
          const completionWorktreeMode = current.worktreePath?.trim() ? 'per_task' : worktreeMode
          if (completionWorktreeMode !== 'none' && current.branchName && current.baseBranch) {
            const effectiveTaskProjectPath = this.resolveEffectiveTaskProjectPath(current)
            const mergeOutcome = await dispatchMerge({
              task: current,
              policy: landingStrategy,
              projectPath: effectiveTaskProjectPath,
              memoryDir: this.opts.config.memoryDir,
              gitDriver: this.gitDriver,
              now: this.now(),
            })
            current.mergeRecord = mergeOutcome.record
            if (mergeOutcome.transitionReceipt) {
              current.status = mergeOutcome.transitionReceipt.to
            }
            if (mergeOutcome.fixupTask) appendFixupTask(queue, mergeOutcome.fixupTask, this.now())
            if (mergeOutcome.newStatus === 'done') shelveSupersededFixupTasks(queue, current.id, this.now())
          } else if (!current.mergeRecord) {
            current.mergeRecord = {
              fromBranch: current.branchName ?? '<unknown>',
              toBranch: current.baseBranch ?? '<unknown>',
              strategy: landingStrategy,
              result: 'skipped',
              mergedAt: now,
              detail:
                completionWorktreeMode === 'none'
                  ? 'worktree isolation disabled — merge skipped'
                  : 'branch metadata missing — merge skipped',
            }
          }
        }
        if (current.status === 'done') {
          await upsertTaskRuntimeState(inferProjectRootFromMemoryDir(this.opts.config.memoryDir), current.id, {
            assignedTo: null,
            proofRecovery: undefined,
            currentLifecycle: undefined,
            updatedAt: now,
          })
        }
        await this.writeQueue(queue)
        await this.maybeWriteReviewPacket(current)
        await this.maybeCleanupWorktree(current, await this.resolveWorktreeModeSafe())
        const afterStatus = current.status
        await this.logTickProgress({
          task: current,
          agent: 'acceptance-command-gates',
          beforeStatus,
          afterStatus,
          transitioned: true,
          note: `acceptance command gates passed (${results.length}) → ${afterStatus}`,
        })
        return {
          kind: 'processed',
          taskId: current.id,
          agent: 'acceptance-command-gates',
          beforeStatus,
          afterStatus,
          transitioned: true,
          revisionCount: current.revisionCount,
        } as TickOutcome
      }

      await this.writeQueue(queue)
      await this.logTickProgress({
        task: current,
        agent: 'acceptance-command-gates',
        beforeStatus,
        afterStatus: current.status,
        transitioned: false,
        note: `acceptance command gates passed (${results.length}); remaining non-command criteria still need gate review`,
      })
      return null
    })
  }

  private async repairMissingExecutionBlueprintInline(task: Task): Promise<TickOutcome | null> {
    if (
      task.id === META_INTAKE_TASK_ID ||
      task.status !== 'in_progress' ||
      hasActiveProofRecovery(task) ||
      hasUsableBlueprint(task)
    ) {
      return null
    }

    const beforeStatus = task.status
    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const current = queue.tasks.find((candidate) => candidate.id === task.id)
      if (
        !current ||
        current.status !== 'in_progress' ||
        hasActiveProofRecovery(current) ||
        hasUsableBlueprint(current)
      ) return null

      const now = this.now()
      const recoveryReason =
        'The task entered the worker lane without a current implementation blueprint. This is a Guildhall plan-state defect; re-intake the visible project sources before execution.'
      resetCurrentPlanForProofRecovery(current, {
        reason: recoveryReason,
        now,
        agentId: 'blueprint-recovery',
        role: 'execution-boundary',
      })
      transitionTaskStatus({
        task: current,
        event: 'recover_to_exploring',
        actor: 'blueprint-recovery',
        evidenceRefs: ['task:missing-blueprint'],
        now,
      })
      current.assignedTo = 'spec-agent'
      current.blockReason = undefined
      current.completedAt = undefined
      current.updatedAt = now
      queue.lastUpdated = now
      await this.writeQueue(queue)
      // A recovery that clears the current plan is a new lifecycle. Persist
      // the marker after the definition write so old merge evidence cannot
      // settle the just-reopened task on the next scheduler tick.
      await upsertTaskRuntimeState(inferProjectRootFromMemoryDir(this.opts.config.memoryDir), current.id, {
        assignedTo: 'spec-agent',
        currentLifecycle: {
          reopenedAt: now,
          status: 'exploring',
          source: 'rerun_spec',
        },
        updatedAt: now,
      })
      await this.logTickProgress({
        task: current,
        agent: 'blueprint-recovery',
        beforeStatus,
        afterStatus: 'exploring',
        transitioned: true,
        note: 'refused worker dispatch without a current implementation blueprint',
      })
      return {
        kind: 'processed',
        taskId: current.id,
        agent: 'blueprint-recovery',
        beforeStatus,
        afterStatus: 'exploring',
        transitioned: true,
        revisionCount: current.revisionCount,
      } as TickOutcome
    })
  }

  private async repairInvalidAcceptanceProofCommandInline(task: Task): Promise<TickOutcome | null> {
    if (!['ready', 'in_progress', 'review', 'gate_check'].includes(task.status)) return null
    const recoveredWorktreePath = await this.recoverTaskWorktreePath(task)
    const projectPath = recoveredWorktreePath || this.resolveEffectiveTaskProjectPath(task)
    const invalid = findInvalidAutomatedAcceptanceCommands({
      task,
      projectPath,
      allowMissingPackageScripts: task.status === 'ready' || task.status === 'in_progress',
    })
    const missing = findAutomatedAcceptanceCriteriaMissingCommands(task)
    if (invalid.length === 0 && missing.length === 0) return null

    const beforeStatus = task.status
    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const current = queue.tasks.find((candidate) => candidate.id === task.id)
      if (!current || !['ready', 'in_progress', 'review', 'gate_check'].includes(current.status)) return null

      // Workspace ownership is stored outside the compact task row after
      // promotion. Re-reading the queue under the write lock must preserve
      // the recovered execution checkout or new task-authored scripts will be
      // incorrectly validated against the unchanged registered checkout.
      const currentWorktreePath = await this.recoverTaskWorktreePath(current)
      const currentProjectPath = currentWorktreePath || this.resolveEffectiveTaskProjectPath(current)
      const currentInvalid = findInvalidAutomatedAcceptanceCommands({
        task: current,
        projectPath: currentProjectPath,
        allowMissingPackageScripts: current.status === 'ready' || current.status === 'in_progress',
      })
      const currentMissing = findAutomatedAcceptanceCriteriaMissingCommands(current)
      if (currentInvalid.length === 0 && currentMissing.length === 0) return null

      const now = this.now()
      const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
      const recoveryReason = [
        'Guildhall rejected the saved acceptance proof contract before implementation could be retried.',
        ...currentInvalid.map((issue) => `- ${issue.criterionId}: ${issue.command} — ${issue.reason}`),
        ...currentMissing.map((issue) => `- ${issue.criterionId}: no executable command is attached to its automated criterion (${issue.description}).`),
        're-intake the visible project scripts before another spec can become executable; this is an internal plan defect, not owner input.',
      ].join('\n')
      for (const issue of currentInvalid) {
        const criterion = current.acceptanceCriteria.find((candidate) => candidate.id === issue.criterionId)
        const gateResult = {
          gateId: issue.criterionId,
          command: issue.command,
          type: 'hard' as const,
          passed: false,
          checkedAt: now,
          output: `Rejected before execution: ${issue.reason}`,
        }
        if (criterion) criterion.met = false
        await appendTaskEvidence(projectRoot, current.id, {
          id: `gate-${current.id}-${issue.criterionId}-${now.replace(/[^0-9A-Za-z]/g, '')}`,
          kind: 'gate_result',
          recordedAt: now,
          payload: gateResult,
        })
      }
      resetCurrentPlanForProofRecovery(current, {
        reason: recoveryReason,
        now,
        agentId: 'coordinator',
        role: 'acceptance-command-recovery',
      })
      transitionTaskStatus({
        task: current,
        event: 'recover_to_exploring',
        actor: 'acceptance-command-recovery',
        evidenceRefs: [
          ...currentInvalid.map((issue) => `criterion:${issue.criterionId}`),
          ...currentMissing.map((issue) => `criterion:${issue.criterionId}`),
        ],
        now,
      })
      current.assignedTo = 'spec-agent'
      current.blockReason = undefined
      current.completedAt = undefined
      current.updatedAt = now
      queue.lastUpdated = now
      await this.writeQueue(queue)
      await upsertTaskRuntimeState(projectRoot, current.id, {
        assignedTo: 'spec-agent',
        proofRecovery: {
          reopenedAt: now,
          kind: 'proof',
          reason: recoveryReason,
        },
        updatedAt: now,
      })
      await this.logTickProgress({
        task: current,
        agent: 'acceptance-command-recovery',
        beforeStatus,
        afterStatus: 'exploring',
        transitioned: true,
        note: currentInvalid.length > 0
          ? 'reopened shaping after rejecting a non-project acceptance command'
          : 'reopened shaping because automated acceptance criteria lack commands',
      })
      return {
        kind: 'processed',
        taskId: current.id,
        agent: 'acceptance-command-recovery',
        beforeStatus,
        afterStatus: 'exploring',
        transitioned: true,
        revisionCount: current.revisionCount,
      } as TickOutcome
    })
  }

  private async completeGateCheckWithRecordedPassingHardGatesInline(task: Task): Promise<TickOutcome | null> {
    if (task.status !== 'gate_check') return null
    const effectiveTask = await this.hydrateEffectiveTaskForDispatch(task)
    const latestHardGates = latestHardGateResults(effectiveTask)
      .filter((gate) => hardGateIsCurrentForTask(effectiveTask, gate))
    if (latestHardGates.length === 0 || !latestHardGates.every((gate) => gate.passed)) return null

    return await this.completeGateCheckFromRecordedEvidence(task, {
      actor: 'recorded-hard-gates',
      evidenceRefs: latestHardGates.map((result) => `gate:${result.gateId}`),
      noteContent:
        `Guildhall completed this gate check from recorded passing hard gates: ${latestHardGates.map((gate) => gate.gateId).join(', ')}.`,
      logNote: `recorded hard gates passed (${latestHardGates.length})`,
      applyCriteria: (current, currentEffectiveTask) => {
        const currentHardGates = latestHardGateResults(currentEffectiveTask)
          .filter((gate) => hardGateIsCurrentForTask(currentEffectiveTask, gate))
        if (currentHardGates.length === 0 || !currentHardGates.every((gate) => gate.passed)) return false
        for (const criterion of current.acceptanceCriteria) {
          if (currentHardGates.some((gate) =>
            gate.gateId === criterion.id ||
            (typeof criterion.command === 'string' && comparableCommand(gate.command) === comparableCommand(criterion.command)),
          )) {
            criterion.met = true
          }
        }
        return true
      },
    })
  }

  private async restartGateCheckForMissingReviewApprovalInline(task: Task): Promise<TickOutcome | null> {
    if (task.status !== 'gate_check') return null
    const effectiveTask = await this.hydrateEffectiveTaskForDispatch(task)
    const missingCriterionIds = reviewAcceptanceCriteriaMissingApprovalIds(effectiveTask)
    if (missingCriterionIds.length === 0) return null
    const beforeStatus = task.status
    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const current = queue.tasks.find((candidate) => candidate.id === task.id)
      if (!current || current.status !== 'gate_check') return null
      const currentEffectiveTask = await this.hydrateEffectiveTaskForDispatch(current)
      const currentMissingCriterionIds = reviewAcceptanceCriteriaMissingApprovalIds(currentEffectiveTask)
      if (currentMissingCriterionIds.length === 0) return null
      const now = this.now()
      transitionTaskStatus({
        task: current,
        event: 'restart_review',
        actor: 'review-criteria-authority',
        evidenceRefs: currentMissingCriterionIds.map((criterionId) => `criterion:${criterionId}`),
        now,
      })
      ensureReviewerOwnership(current)
      current.completedAt = undefined
      current.notes.push({
        agentId: 'review-criteria-authority',
        role: 'gate-checker',
        content: `Review still needs to approve ${currentMissingCriterionIds.join(', ')} before this task can complete.`,
        timestamp: now,
      })
      current.updatedAt = now
      queue.lastUpdated = now
      await this.writeQueue(queue)
      await upsertTaskRuntimeState(inferProjectRootFromMemoryDir(this.opts.config.memoryDir), current.id, {
        assignedTo: 'reviewer-agent',
        updatedAt: now,
      })
      await this.logTickProgress({
        task: current,
        agent: 'review-criteria-authority',
        beforeStatus,
        afterStatus: 'review',
        transitioned: true,
        note: `review approval required for ${currentMissingCriterionIds.join(', ')}`,
      })
      return {
        kind: 'processed',
        taskId: current.id,
        agent: 'review-criteria-authority',
        beforeStatus,
        afterStatus: 'review',
        transitioned: true,
        revisionCount: current.revisionCount,
      } as TickOutcome
    })
  }

  private async runProviderProofIntegrityGateInline(task: Task): Promise<TickOutcome | null> {
    if (task.status !== 'gate_check') return null
    const root = this.resolveEffectiveTaskProjectPath(task)
    const passingArtifact = await passingProviderProofArtifact(task, root)
    const issue = passingArtifact ? null : await simulatedProviderProofIssue(task, root)
    if (passingArtifact && !issue) {
      const proofPaths = runtimeProofPaths(task)
      const command = proofPaths
        ?.find((proofPath) => proofPath.kind === 'command' && proofPath.command?.trim())
        ?.command?.trim()
      const latestHardGates = latestHardGateResults(task)
      const hasFailedProviderGate = latestHardGates.some((gate) =>
        gate.type === 'hard' && gate.passed === false && /provider|live-provider/i.test(gate.gateId),
      )
      const hasCompleteCommandProof = proofPaths.some((proofPath) => {
        return proofPath.kind === 'command' &&
          proofPath.command?.trim() === command &&
          isCurrentProofPathProven(
            proofPath as unknown as Record<string, unknown>,
            task as unknown as Record<string, unknown>,
          )
      }) ?? false
      if (command && task.gateResults.some((gate) =>
        gate.type === 'hard' && gate.passed === true && gate.command === command,
      ) && !hasFailedProviderGate && hasCompleteCommandProof) return null
      const beforeStatus = task.status
      return await this.withQueueWriteLock(async () => {
        const queue = await this.readQueue()
        const current = queue.tasks.find((candidate) => candidate.id === task.id)
        if (!current || current.status !== 'gate_check') return null
        const now = this.now()
        const currentProofPaths = runtimeProofPaths(current)
        const command = currentProofPaths
          ?.find((proofPath) => proofPath.kind === 'command' && proofPath.command?.trim())
          ?.command?.trim()
        if (!command) return null

        const evidenceSummary = passingArtifact.summary
        const recordedAt = passingArtifact.checkedAt ?? now
        current.proofPaths = ensureCommandProofPathsFromAcceptanceCriteria(current, recordedAt)
        const hasPassingGate = current.gateResults.some((gate) =>
          gate.type === 'hard' && gate.passed === true && gate.command === command,
        )
        if (!hasPassingGate) {
          current.gateResults.push({
            gateId: command,
            type: 'hard',
            passed: true,
            command,
            checkedAt: now,
            output: evidenceSummary,
          })
        }
        const commandPath = currentProofPaths.find((proofPath) =>
          proofPath.kind === 'command' && comparableCommand(proofPath.command) === comparableCommand(command),
        )
        const linkedCriterionIds = new Set(
          (commandPath?.expectedEvidence ?? [])
            .map((evidence) => evidence.id)
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
        )
        current.acceptanceCriteria = current.acceptanceCriteria.map((criterion) => {
          const criterionCommand = typeof criterion.command === 'string' ? criterion.command.trim() : ''
          if (
            !linkedCriterionIds.has(criterion.id) &&
            (!criterionCommand || comparableCommand(criterionCommand) !== comparableCommand(command))
          ) return criterion
          return {
            ...criterion,
            met: true,
            verificationState: 'verified',
          }
        })
        const latestProviderGateIds = latestHardGateResults(current)
          .filter((gate) => gate.type === 'hard' && gate.passed === false && /provider|live-provider/i.test(gate.gateId))
          .map((gate) => gate.gateId)
        for (const gateId of latestProviderGateIds) {
          current.gateResults.push({
            gateId,
            type: 'hard',
            passed: true,
            command,
            checkedAt: now,
            output: evidenceSummary,
          })
        }
        current.updatedAt = now
        queue.lastUpdated = now
        current.notes.push({
          agentId: 'proof-integrity-gates',
          role: 'gate-checker',
          content: `Recorded passing provider proof from ${path.relative(root, passingArtifact.file)} for ${command}.`,
          timestamp: now,
        })
        await this.writeQueue(queue)
        await upsertTaskRuntimeState(inferProjectRootFromMemoryDir(this.opts.config.memoryDir), current.id, {
          proofRecovery: undefined,
          updatedAt: now,
        })
        await this.logTickProgress({
          task: current,
          agent: 'proof-integrity-gates',
          beforeStatus,
          afterStatus: current.status,
          transitioned: false,
          note: 'passing provider proof recorded',
        })
        return {
          kind: 'processed',
          taskId: current.id,
          agent: 'proof-integrity-gates',
          beforeStatus,
          afterStatus: current.status,
          transitioned: false,
          revisionCount: current.revisionCount,
        } as TickOutcome
      })
    }
    if (!issue) return null
    const beforeStatus = task.status
    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const current = queue.tasks.find((candidate) => candidate.id === task.id)
      if (!current || current.status !== 'gate_check') return null
      const now = this.now()
      current.gateResults.push({
        gateId: 'proof.real-provider-evidence',
        type: 'soft',
        passed: false,
        checkedAt: now,
        output: issue.summary,
      })
      transitionTaskStatus({
        task: current,
        event: 'revise',
        actor: 'proof-integrity-gates',
        evidenceRefs: ['gate:proof.real-provider-evidence'],
        now,
      })
      ensureWorkerOwnership(current)
      current.revisionCount += 1
      current.notes.push({
        agentId: 'proof-integrity-gates',
        role: 'gate-checker',
        content: `${issue.summary}\nReplace simulated proof with real provider evidence, or explicitly change the task boundary so it no longer claims provider testing is complete.`,
        timestamp: now,
      })
      queue.lastUpdated = now
      await this.writeQueue(queue)
      await this.logTickProgress({
        task: current,
        agent: 'proof-integrity-gates',
        beforeStatus,
        afterStatus: 'in_progress',
        transitioned: true,
        note: 'simulated provider proof rejected',
      })
      return {
        kind: 'processed',
        taskId: current.id,
        agent: 'proof-integrity-gates',
        beforeStatus,
        afterStatus: 'in_progress',
        transitioned: true,
        revisionCount: current.revisionCount,
      } as TickOutcome
    })
  }

  private async completeGateCheckWithApprovedReviewOnlyInline(task: Task): Promise<TickOutcome | null> {
    if (task.status !== 'gate_check') return null
    const effectiveTask = await this.hydrateEffectiveTaskForDispatch(task)
    if (!canCompleteGateCheckFromApprovedReviewOnly(effectiveTask)) return null
    const checkpoint = await readCheckpoint(this.opts.config.memoryDir, task.id).catch(() => null)
    if (checkpointHasRecordedVerificationFailure(checkpoint?.resumeContext?.verification ?? [])) return null

    return await this.completeGateCheckFromRecordedEvidence(task, {
      actor: 'approved-review-gates',
      evidenceRefs: latestApprovingReviewEvidenceRefs(effectiveTask),
      noteContent:
        'Guildhall completed this gate check from the recorded approving review; no command-backed hard gate was required for this review-verified task.',
      logNote: 'approved review completed review-verified gate check',
      applyCriteria: (current, currentEffectiveTask) => {
        if (!canCompleteGateCheckFromApprovedReviewOnly(currentEffectiveTask)) return false
        return true
      },
    })
  }

  private async completeGateCheckFromRecordedEvidence(
    task: Task,
    input: {
      actor: string
      evidenceRefs: string[]
      noteContent: string
      logNote: string
      applyCriteria: (current: Task, currentEffectiveTask: Task) => boolean
    },
  ): Promise<TickOutcome | null> {
    if (task.status !== 'gate_check') return null
    const beforeStatus = task.status
    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const current = queue.tasks.find((candidate) => candidate.id === task.id)
      if (!current || current.status !== 'gate_check') return null
      const currentEffectiveTask = await this.hydrateEffectiveTaskForDispatch(current)
      if (!input.applyCriteria(current, currentEffectiveTask)) return null

      const now = this.now()
      reconcileAcceptanceCriteriaFromApprovedReview(current, currentEffectiveTask)
      const completionAuthorityTask = {
        ...currentEffectiveTask,
        acceptanceCriteria: current.acceptanceCriteria,
      }
      const reviewCriteriaMissingApproval = reviewAcceptanceCriteriaMissingApprovalIds(completionAuthorityTask)
      if (reviewCriteriaMissingApproval.length > 0) {
        transitionTaskStatus({
          task: current,
          event: 'restart_review',
          actor: input.actor,
          evidenceRefs: reviewCriteriaMissingApproval.map((criterionId) => `criterion:${criterionId}`),
          now,
        })
        ensureReviewerOwnership(current)
        current.completedAt = undefined
        current.notes.push({
          agentId: input.actor,
          role: 'gate-checker',
          content:
            `The recorded hard gates passed. Review still needs to approve ${reviewCriteriaMissingApproval.join(', ')} before this task can complete.`,
          timestamp: now,
        })
        current.updatedAt = now
        queue.lastUpdated = now
        await this.writeQueue(queue)
        await upsertTaskRuntimeState(inferProjectRootFromMemoryDir(this.opts.config.memoryDir), current.id, {
          assignedTo: 'reviewer-agent',
          updatedAt: now,
        })
        await this.logTickProgress({
          task: current,
          agent: input.actor,
          beforeStatus,
          afterStatus: 'review',
          transitioned: true,
          note: `${input.logNote} awaits review approval`,
        })
        return {
          kind: 'processed',
          taskId: current.id,
          agent: input.actor,
          beforeStatus,
          afterStatus: 'review',
          transitioned: true,
          revisionCount: current.revisionCount,
        } as TickOutcome
      }
      // Review-only proof paths are part of the same completion contract as
      // command paths. Materialize the approved review against each expected
      // evidence item before asking proof-health whether the task may close.
      recordApprovedReviewProof(current, now, input.actor)
      if (taskDoneButMissingSelectedScopeProof({ ...current, status: 'done' }, queue)) {
        transitionTaskStatus({
          task: current,
          event: 'revise',
          actor: input.actor,
          evidenceRefs: ['task:proof:missing'],
          now,
        })
        ensureWorkerOwnership(current)
        current.completedAt = undefined
        current.revisionCount += 1
        current.notes.push({
          agentId: input.actor,
          role: 'gate-checker',
          content:
            'Gate check could not complete from recorded evidence because the task still lacks the proof evidence required by its proof path. Keep the task open and attach the missing proof before marking it done.',
          timestamp: now,
        })
        current.updatedAt = now
        queue.lastUpdated = now
        await this.writeQueue(queue)
        await upsertTaskRuntimeState(inferProjectRootFromMemoryDir(this.opts.config.memoryDir), current.id, {
          assignedTo: 'worker-agent',
          updatedAt: now,
        })
        await this.logTickProgress({
          task: current,
          agent: input.actor,
          beforeStatus,
          afterStatus: 'in_progress',
          transitioned: true,
          note: `${input.logNote} lacked required proof evidence → in_progress`,
        })
        return {
          kind: 'processed',
          taskId: current.id,
          agent: input.actor,
          beforeStatus,
          afterStatus: 'in_progress',
          transitioned: true,
          revisionCount: current.revisionCount,
        } as TickOutcome
      }
      transitionTaskStatus({
        task: current,
        event: 'complete',
        actor: input.actor,
        evidenceRefs: input.evidenceRefs,
        now,
        requiredEvidencePresent: true,
      })
      current.assignedTo = undefined
      current.completedAt = now
      current.notes.push({
        agentId: input.actor,
        role: 'gate-checker',
        content: input.noteContent,
        timestamp: now,
      })

      const autoCommit = await this.maybeAutoCommitCompletedTaskWork(current)
      if (!autoCommit.ok) {
        transitionTaskStatus({
          task: current,
          event: 'landing_failed',
          actor: 'recorded-hard-gates',
          evidenceRefs: ['task:landing:auto-commit-failed'],
          now,
        })
        current.assignedTo = null
        current.blockReason =
          `Guildhall could not auto-commit completed work: ${autoCommit.detail ?? 'unknown git error'}.`
        current.notes.push({
          agentId: 'coordinator',
          role: 'git-story',
          content:
            `Auto-commit was required by project Git Story policy, but it failed: ${autoCommit.detail ?? 'unknown git error'}.`,
          timestamp: now,
        })
        current.mergeRecord = {
          fromBranch: current.branchName ?? '<unknown>',
          toBranch: current.baseBranch ?? '<unknown>',
          strategy: await this.resolveLandingStrategySafe(),
          result: 'skipped',
          mergedAt: now,
          detail: 'auto-commit failed before landing',
        }
      } else {
        const landingStrategy = await this.resolveLandingStrategySafe()
        const worktreeMode = await this.resolveWorktreeModeSafe()
        const completionWorktreeMode = current.worktreePath?.trim() ? 'per_task' : worktreeMode
        if (completionWorktreeMode !== 'none' && current.branchName && current.baseBranch) {
          const effectiveTaskProjectPath = this.resolveEffectiveTaskProjectPath(current)
          const mergeOutcome = await dispatchMerge({
            task: current,
            policy: landingStrategy,
            projectPath: effectiveTaskProjectPath,
            memoryDir: this.opts.config.memoryDir,
            gitDriver: this.gitDriver,
            now: this.now(),
          })
          current.mergeRecord = mergeOutcome.record
          if (mergeOutcome.transitionReceipt) {
            current.status = mergeOutcome.transitionReceipt.to
          }
          if (mergeOutcome.fixupTask) appendFixupTask(queue, mergeOutcome.fixupTask, this.now())
          if (mergeOutcome.newStatus === 'done') shelveSupersededFixupTasks(queue, current.id, this.now())
        } else if (!current.mergeRecord) {
          current.mergeRecord = {
            fromBranch: current.branchName ?? '<unknown>',
            toBranch: current.baseBranch ?? '<unknown>',
            strategy: landingStrategy,
            result: 'skipped',
            mergedAt: now,
            detail:
              completionWorktreeMode === 'none'
                ? 'worktree isolation disabled — merge skipped'
                : 'branch metadata missing — merge skipped',
          }
        }
      }

      current.updatedAt = this.now()
      queue.lastUpdated = current.updatedAt
      await this.writeQueue(queue)
      await upsertTaskRuntimeState(inferProjectRootFromMemoryDir(this.opts.config.memoryDir), current.id, {
        assignedTo: null,
        ...(current.status === 'done'
          ? { proofRecovery: undefined, currentLifecycle: undefined }
          : {}),
        updatedAt: current.updatedAt,
      })
      // Inline gate completion bypasses the normal post-agent dispatch path,
      // so refresh the durable review packet here as part of the same visible
      // state transition. Otherwise the task can be done while its packet
      // still claims gate_check.
      await this.maybeWriteReviewPacket(current)
      await this.maybeCleanupWorktree(current, await this.resolveWorktreeModeSafe())
      const afterStatus = current.status
      await this.logTickProgress({
        task: current,
        agent: input.actor,
        beforeStatus,
        afterStatus,
        transitioned: true,
        note: `${input.logNote} → ${afterStatus}`,
      })
      return {
        kind: 'processed',
        taskId: current.id,
        agent: input.actor,
        beforeStatus,
        afterStatus,
        transitioned: true,
        revisionCount: current.revisionCount,
      } as TickOutcome
    })
  }

  /**
   * Guild deterministic-check pre-pass at `gate_check`. Runs the applicable
   * guilds' pure-function checks (e.g. WCAG contrast matrix, OKLab near-
   * duplicate scan), appends each result to `task.gateResults` as a `soft`
   * gate, and — if any failed — short-circuits to `in_progress` with
   * aggregated feedback. Returns `null` when no action was taken (all
   * passed, or no applicable guild checks), letting the caller fall
   * through to the normal shell-gate LLM dispatch.
   */
  private async runGuildGatesInline(
    task: Task,
    _queueBefore: TaskQueue,
  ): Promise<TickOutcome | null> {
    const designSystem = await loadDesignSystem(this.opts.config.memoryDir).catch(
      () => undefined,
    )
    const { guilds: roster } = loadProjectGuildRoster(this.opts.config.memoryDir)
    const gateOutcome = await runGuildGates({
      task,
      signals: {
        task,
        designSystem,
        memoryDir: this.opts.config.memoryDir,
        projectPath: task.projectPath,
      },
      now: this.now(),
      roster,
    })

    // No applicable checks ran → nothing to decide; let the shell-gate pass proceed.
    if (gateOutcome.gateResults.length === 0) return null

    // Persist the guild gate results regardless of pass/fail. This happens
    // under the queue write lock so concurrent fanout dispatches serialize.
    const beforeStatus = task.status
    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const t = queue.tasks.find((x) => x.id === task.id)
      if (!t) return null
      t.gateResults.push(...gateOutcome.gateResults)
      t.updatedAt = this.now()
      queue.lastUpdated = this.now()

      if (gateOutcome.allPassed) {
        await this.writeQueue(queue)
        await this.logTickProgress({
          task: t,
          agent: 'guild-gate-runner',
          beforeStatus,
          afterStatus: t.status,
          transitioned: false,
          note: `guild gates passed (${gateOutcome.gateResults.length} check${gateOutcome.gateResults.length === 1 ? '' : 's'})`,
        })
        // Passed → fall through to the shell-gate agent.
        return null
      }

      // Any guild gate failed → bounce to in_progress with aggregated feedback.
      const failed = gateOutcome.gateResults.filter((g) => !g.passed)
      const feedback = [
        `**Guild gates failed (${failed.length}):**`,
        ...failed.map((g) => `- \`${g.gateId}\`: ${(g.output ?? '').split('\n')[0] ?? 'failed'}`),
      ].join('\n')
      t.notes.push({
        agentId: 'guild-gate-runner',
        role: 'gate-checker',
        content: feedback,
        timestamp: this.now(),
      })
      transitionTaskStatus({
        task: t,
        event: 'revise',
        actor: 'guild-gate-runner',
        evidenceRefs: failed.map((result) => `gate:${result.gateId}`),
        now: this.now(),
      })
      ensureWorkerOwnership(t)
      t.revisionCount += 1
      t.updatedAt = this.now()
      queue.lastUpdated = this.now()

      // Enforce maxRevisions the same way the reviewer path does.
      if (t.revisionCount > this.opts.config.maxRevisions) {
        await this.writeQueue(queue)
        await raiseEscalation({
          tasksPath: this.tasksPath(),
          progressPath: this.progressPath(),
          taskId: task.id,
          agentId: 'guild-gate-runner',
          reason: 'max_revisions_exceeded',
          recoveryCode: 'gate_max_revisions',
          summary:
            `Exceeded maxRevisions (${this.opts.config.maxRevisions}). ` +
            `Guild gates keep failing.`,
          details: feedback,
        })
        return {
          kind: 'blocked-max-revisions',
          taskId: task.id,
          revisionCount: t.revisionCount,
        } as TickOutcome
      }

      await this.writeQueue(queue)
      await this.logTickProgress({
        task: t,
        agent: 'guild-gate-runner',
        beforeStatus,
        afterStatus: 'in_progress',
        transitioned: true,
        note: `guild gates failed (${failed.length}) → in_progress`,
      })
      return {
        kind: 'processed',
        taskId: task.id,
        agent: 'guild-gate-runner',
        beforeStatus,
        afterStatus: 'in_progress',
      } as TickOutcome
    })
  }

  /**
   * Capture the current handoff step's worker note, record its completion
   * timestamp, advance `handoffStep`, and revert status to `in_progress`
   * so the next specialist picks up on the next tick. Only called when
   * `hasPendingHandoffStep(task)` is true; the final step falls through
   * to the normal reviewer fan-out.
   */
  private async advanceHandoffStepInline(
    task: Task,
  ): Promise<TickOutcome | null> {
    const beforeStatus = task.status
    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const t = queue.tasks.find((x) => x.id === task.id)
      if (!t || !t.handoffSequence) return null
      const idx = t.handoffStep ?? 0
      const currentStep = t.handoffSequence[idx]
      if (!currentStep) return null
      const nextStep = t.handoffSequence[idx + 1]
      if (!nextStep) return null // guarded by hasPendingHandoffStep but safe

      const now = this.now()
      const handoff = extractStructuredHandoff(t)
      // Clone the step shape — zod `.default([])` nested shapes can't be
      // partially mutated without TypeScript's exactOptionalPropertyTypes
      // complaining, so we rebuild the step.
      t.handoffSequence = t.handoffSequence.map((s, i) =>
        i === idx
          ? {
              ...s,
              completedAt: now,
              ...(handoff ? { handoff } : {}),
            }
          : s,
      )
      t.handoffStep = idx + 1
      transitionTaskStatus({
        task: t,
        event: 'revise',
        actor: 'handoff-orchestrator',
        evidenceRefs: ['task:handoff-step'],
        now,
      })
      ensureWorkerOwnership(t)
      t.updatedAt = now
      queue.lastUpdated = now
      await this.writeQueue(queue)
      await this.logTickProgress({
        task: t,
        agent: 'handoff-orchestrator',
        beforeStatus,
        afterStatus: 'in_progress',
        transitioned: true,
        note: `handoff step ${idx + 1}/${t.handoffSequence.length} (${currentStep.agent}) → step ${idx + 2} (${nextStep.agent})`,
      })
      return {
        kind: 'processed',
        taskId: task.id,
        agent: 'handoff-orchestrator',
        beforeStatus,
        afterStatus: 'in_progress',
      } as TickOutcome
    })
  }

  /**
   * Reviewer fan-out pre-pass at `review`. Runs each applicable reviewer
   * persona through `opts.reviewerFanout` and aggregates their verdicts
   * strict-all: any `revise` bounces the task back to `in_progress` with
   * combined feedback. All approvals advance the task to `gate_check`.
   *
   * Returns `null` when no reviewer personas apply OR no runner is
   * configured — the caller falls through to the legacy single-reviewer
   * dispatch.
   */
  private async runReviewerFanoutInline(
    task: Task,
    _queueBefore: TaskQueue,
    reviewPlan: ReviewPlanRecord | null = null,
  ): Promise<TickOutcome | null> {
    const runner = this.opts.reviewerFanout
    if (!runner) return null

    // Fan-out is an LLM reviewer path. Deterministic-only mode must bypass it
    // entirely; otherwise a provider's prose/JSON behavior can affect a task
    // that was explicitly configured to use only typed local checks.
    const reviewerMode = await this.resolveReviewerMode(task.domain)
    if (reviewerMode === 'deterministic_only') return null

    const staleHandoffRecovery = await this.recoverStaleReviewHandoff(task)
    if (staleHandoffRecovery) return staleHandoffRecovery

    const designSystem = await loadDesignSystem(this.opts.config.memoryDir).catch(
      () => undefined,
    )
    const { guilds: roster } = loadProjectGuildRoster(this.opts.config.memoryDir)
    const applicable = selectApplicableGuilds(
      {
        task,
        designSystem,
        memoryDir: this.opts.config.memoryDir,
        projectPath: task.projectPath,
      },
      roster,
    )
    const personas = selectReviewersForPlan(reviewersForTask(applicable), reviewPlan)
    if (personas.length === 0) return null

    // Build the JIT context once; every persona sees the same facts.
    const ctx = await buildContext(task, this.opts.config.memoryDir, {
      projectSkillsEnabled: this.opts.config.skills?.projectLocal?.enabled === true,
    })

    const reviewProjectPath = task.worktreePath?.trim() || task.projectPath || this.opts.config.projectPath
    const changedFiles = await this.renderChangedFiles(task)
    const runFanout = async (): Promise<PersonaVerdict[]> => runner({
      task,
      builtContext: ctx,
      personas,
      ...(reviewPlan ? { reviewPlan } : {}),
      context: ctx.formatted,
      memoryDir: this.opts.config.memoryDir,
      projectPath: reviewProjectPath,
      visualEvidencePaths: collectVisualEvidenceRefs(task, changedFiles.files),
    })

    let verdicts: PersonaVerdict[]
    try {
      verdicts = await runFanout()
    } catch (err) {
      const failureVerdicts = personas.map((persona): PersonaVerdict => ({
        guildSlug: persona.slug,
        guildName: persona.name,
        verdict: 'revise',
        reasoning: '',
        revisionItems: [],
        rawOutput: '',
        failureCode: 'provider_unavailable',
      }))
      return await this.handleReviewerFanoutFailureInline(
        task,
        failureVerdicts,
        reviewerMode,
        'reviewer fan-out failed before producing typed results (provider_unavailable)',
      )
    }
    // A malformed reviewer response is a Guildhall integration fault, not
    // owner work and not worker feedback. Give a fresh reviewer invocation one
    // bounded chance to produce its typed contract before surfacing a retry.
    if (verdicts.length > 0 && verdicts.every((verdict) => verdict.failureCode === 'invalid_review_contract')) {
      await this.emitBackendEvent({
        type: 'line_complete',
        task_id: task.id,
        agent_name: 'reviewer-fanout',
        message: 'Reviewer output was incomplete. Guildhall is retrying the automated review once.',
      })
      try {
        verdicts = await runFanout()
      } catch (err) {
        const failureVerdicts = personas.map((persona): PersonaVerdict => ({
          guildSlug: persona.slug,
          guildName: persona.name,
          verdict: 'revise',
          reasoning: '',
          revisionItems: [],
          rawOutput: '',
          failureCode: 'provider_unavailable',
        }))
        return await this.handleReviewerFanoutFailureInline(
          task,
          failureVerdicts,
          reviewerMode,
          'reviewer retry failed before producing typed results (provider_unavailable)',
        )
      }
    }
    if (verdicts.length === 0) {
      const failureVerdicts = personas.map((persona): PersonaVerdict => ({
        guildSlug: persona.slug,
        guildName: persona.name,
        verdict: 'revise',
        reasoning: '',
        revisionItems: [],
        rawOutput: '',
        failureCode: 'provider_unavailable',
      }))
      return await this.handleReviewerFanoutFailureInline(
        task,
        failureVerdicts,
        reviewerMode,
        'reviewer fan-out returned no typed results (provider_unavailable)',
      )
    }

    const substantiveVerdicts = verdicts.filter(
      (verdict) => !isNonSubstantiveFanoutFailure(verdict),
    )
    if (substantiveVerdicts.length === 0) {
      return await this.handleReviewerFanoutFailureInline(
        task,
        verdicts,
        reviewerMode,
        `reviewer fan-out returned no usable structured verdict (${[...new Set(verdicts.map((verdict) => verdict.failureCode ?? 'invalid_review_contract'))].join(', ')})`,
      )
    }

    // Policy selection plus prior-round extraction for audit and bounded retry
    // accounting. `aggregate.needsAdjudication` can only come from opposite
    // typed findings on one target, never from persona recurrence.
    const policy = await this.resolveReviewerFanoutPolicy(task.domain)
    const priorRounds = extractPriorVerdictRounds(task.reviewVerdicts)
    const aggregate = aggregateFanout(verdicts, { policy, priorRounds })
    const beforeStatus = task.status

    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const current = queue.tasks.find((x) => x.id === task.id)
      if (!current) return null
      const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
      const t = await buildEffectiveTask(projectRoot, current, { evidence: 'full' }) as unknown as Task
      queue.tasks[queue.tasks.findIndex((candidate) => candidate.id === task.id)] = t

      // Persist one ReviewVerdict per persona — the audit trail shows which
      // expert agreed and which objected.
      const now = this.now()
      for (const v of verdicts) {
        t.reviewVerdicts.push(personaVerdictToReviewRecord(v, { now, taskId: t.id }))
      }
      const aggregateSources = aggregate.verdict === 'approve'
        ? aggregate.approving
        : aggregate.dissenting
      const aggregateReview: ReviewVerdict = {
        id: `review:${t.id}:reviewer-fanout:${now}`,
        verdict: aggregate.verdict,
        reviewerPath: 'llm',
        reviewerId: 'reviewer-fanout',
        reviewerName: 'Reviewer fan-out',
        reason: aggregate.verdict === 'approve'
          ? 'Reviewer fan-out approved the task.'
          : 'Reviewer fan-out requested revision.',
        reasoning: aggregate.verdict === 'approve'
          ? 'All substantive reviewer results approved the task-level review authority.'
          : aggregate.combinedFeedback,
        acceptedCriteriaIds: [...new Set(
          aggregate.approving.flatMap(verdict => verdict.acceptedCriteriaIds ?? []),
        )],
        proofEvidenceIds: [...new Set(
          aggregate.approving.flatMap(verdict => verdict.proofEvidenceIds ?? []),
        )],
        findings: aggregateSources.flatMap(verdict => verdict.findings ?? []),
        failingSignals: aggregate.dissenting.map(verdict => verdict.guildSlug),
        recordedAt: now,
        policyVersion: policy,
      }
      let aggregateMissingCriteriaIds: string[] = []
      let aggregateMissingProofIds: string[] = []
      if (aggregate.verdict === 'approve') {
        const aggregateAuthority = { reviewVerdicts: [aggregateReview] }
        aggregateMissingCriteriaIds = reviewAcceptanceCriteriaMissingApprovalIds(t, aggregateAuthority)
        aggregateMissingProofIds = reviewProofMissingApprovalIds(t, aggregateAuthority)
        if (aggregateMissingCriteriaIds.length > 0 || aggregateMissingProofIds.length > 0) {
          aggregateReview.verdict = 'revise'
          aggregateReview.failureCode = 'invalid_review_contract'
          aggregateReview.reason = 'Reviewer fan-out approval omitted required review target IDs.'
          aggregateReview.reasoning = [
            'The aggregate approval did not name every stable review target required by the task contract.',
            aggregateMissingCriteriaIds.length > 0
              ? `Missing acceptance criterion IDs: ${aggregateMissingCriteriaIds.join(', ')}`
              : '',
            aggregateMissingProofIds.length > 0
              ? `Missing proof evidence IDs: ${aggregateMissingProofIds.join(', ')}`
              : '',
          ].filter(Boolean).join('\n')
        }
      }
      t.reviewVerdicts.push(aggregateReview)
      await this.persistReviewerRuns({
        task: t,
        verdicts,
        reviewPlan,
        recordedAt: now,
      })

      const repeatedAfterCoordinatorAdjudication =
        aggregate.verdict === 'revise' &&
        hasPriorAdjudicationForConflict(t, aggregate.conflicts)
      if (repeatedAfterCoordinatorAdjudication) {
        await this.writeQueue(queue)
        const dissenterSlugs = aggregate.dissenting.map((d) => d.guildSlug)
        const details = [
          'Reviewer fan-out returned the task to the same handoff lane after a coordinator adjudication.',
          '',
          `Dissenters: ${dissenterSlugs.join(', ') || 'unknown'}`,
          '',
          'Latest reviewer feedback:',
          aggregate.combinedFeedback || '- No combined feedback recorded.',
          '',
          'Guildhall stopped this loop because another reviewer -> worker bounce would repeat a previously adjudicated handoff without a new plan.',
        ].join('\n')
        const escalation = await raiseEscalation({
          tasksPath: this.tasksPath(),
          progressPath: this.progressPath(),
          taskId: task.id,
          agentId: 'coordinator-foreman',
          reason: 'human_judgment_required',
          recoveryCode: 'review_worker_handoff_loop',
          summary:
            'Reviewer/worker handoff loop detected after coordinator adjudication.',
          details,
        })
        return {
          kind: 'escalated',
          taskId: task.id,
          agent: 'coordinator-foreman',
          reason: 'review_worker_handoff_loop',
          escalationId: escalation.escalationId ?? `esc-${task.id}`,
        } as TickOutcome
      }

      // A typed target conflict routes through the coordinator recovery
      // boundary. Persona recurrence alone remains an audit signal, not a
      // conflict or an automatic authority decision.
      const shouldInspectRepeatedHandoff =
        aggregate.verdict === 'revise' &&
        aggregate.needsAdjudication
      if (shouldInspectRepeatedHandoff) {
        const adjudicationOutcome = await this.routeToCoordinatorAdjudication({
          queue,
          task: t,
          aggregate,
          verdicts,
          round: priorRounds.length + 1,
          now,
          beforeStatus,
        })
        if (adjudicationOutcome) return adjudicationOutcome
        // If routing failed (no coordinator, etc.), fall through to the
        // default revise path so the system stays conservative.
      }

      if (aggregate.verdict === 'approve') {
        if (aggregateReview.verdict !== 'approve') {
          t.notes.push({
            agentId: 'reviewer-fanout',
            role: 'reviewer',
            content:
              'Reviewer fan-out returned approve without the exact review target IDs required by the task. ' +
              'Guildhall kept the task in review and recorded an invalid review contract instead of inventing product work.',
            structured: {
              kind: 'reviewer_contract_failure',
              failureCodes: ['invalid_review_contract'],
              missingAcceptanceCriteriaIds: aggregateMissingCriteriaIds,
              missingProofEvidenceIds: aggregateMissingProofIds,
            },
            timestamp: now,
          })
          t.updatedAt = now
          queue.lastUpdated = now
          await this.writeQueue(queue)
          const failureSummary = aggregateReview.reasoning ?? aggregateReview.reason
          await this.logTickProgress({
            task: t,
            agent: 'reviewer-fanout',
            beforeStatus,
            afterStatus: 'review',
            transitioned: false,
            note: failureSummary,
          })
          return {
            kind: 'agent-error',
            taskId: t.id,
            agent: 'reviewer-fanout',
            error: failureSummary,
          } as TickOutcome
        }
        recordApprovedReviewProof(
          t,
          now,
          'reviewer-fanout',
          aggregateReview.proofEvidenceIds,
        )
        transitionTaskStatus({
          task: t,
          event: 'start_gate_check',
          actor: 'reviewer-fanout',
          evidenceRefs: verdicts.map((verdict) => `reviewer-fanout:${verdict.guildSlug}`),
          now,
        })
        t.assignedTo = 'gate-checker-agent'
        t.updatedAt = now
        queue.lastUpdated = now
        await this.writeQueue(queue)
        await this.logTickProgress({
          task: t,
          agent: 'reviewer-fanout',
          beforeStatus,
          afterStatus: 'gate_check',
          transitioned: true,
          note: `fan-out approve (${verdicts.length} persona${verdicts.length === 1 ? '' : 's'})`,
        })
        return {
          kind: 'processed',
          taskId: task.id,
          agent: 'reviewer-fanout',
          beforeStatus,
          afterStatus: 'gate_check',
          transitioned: true,
          note: `fan-out approve (${verdicts.length} persona${verdicts.length === 1 ? '' : 's'})`,
          revisionCount: t.revisionCount,
        } as TickOutcome
      }

      // Aggregate says revise — append combined feedback, bump revisionCount,
      // enforce maxRevisions.
      const structuredFeedback = {
        verdict: aggregate.verdict,
        acceptedCriteriaIds: [...new Set(
          aggregate.dissenting.flatMap(verdict => verdict.acceptedCriteriaIds ?? []),
        )],
        proofEvidenceIds: [...new Set(
          aggregate.dissenting.flatMap(verdict => verdict.proofEvidenceIds ?? []),
        )],
        findings: aggregate.dissenting.flatMap(verdict => verdict.findings ?? []),
        // Kept in the audit record for historical inspection. Worker context
        // renders typed findings only; model-authored revision strings cannot
        // create executable work by themselves.
        revisionItems: aggregate.dissenting.flatMap(verdict => verdict.revisionItems ?? []),
        riskItems: aggregate.dissenting.flatMap(verdict => verdict.riskItems ?? []),
        followUpItems: aggregate.dissenting.flatMap(verdict => verdict.followUpItems ?? []),
        advisoryScores: {},
      }
      t.notes.push({
        agentId: 'reviewer-fanout',
        role: 'reviewer',
        content: aggregate.combinedFeedback,
        structured: structuredFeedback,
        timestamp: now,
      })
      transitionTaskStatus({
        task: t,
        event: 'revise',
        actor: 'reviewer-fanout',
        evidenceRefs: aggregate.dissenting.map((verdict) => `reviewer-fanout:${verdict.guildSlug}`),
        now,
      })
      ensureWorkerOwnership(t)
      t.revisionCount += 1
      ensureRetryWindow(t)
      t.updatedAt = now
      queue.lastUpdated = now

      const currentCycleRevisionCount = currentRevisionCycleCount(t)
      if (currentCycleRevisionCount > this.opts.config.maxRevisions) {
        await this.writeQueue(queue)
        await raiseEscalation({
          tasksPath: this.tasksPath(),
          progressPath: this.progressPath(),
          taskId: task.id,
          agentId: 'reviewer-fanout',
          reason: 'max_revisions_exceeded',
          recoveryCode: 'reviewer_fanout_max_revisions',
          summary:
            `Exceeded maxRevisions (${this.opts.config.maxRevisions}). ` +
            `Reviewer fan-out keeps rejecting.`,
          details: aggregate.combinedFeedback,
        })
        return {
          kind: 'blocked-max-revisions',
          taskId: task.id,
          revisionCount: currentCycleRevisionCount,
        } as TickOutcome
      }

      await this.writeQueue(queue)
      await this.logTickProgress({
        task: t,
        agent: 'reviewer-fanout',
        beforeStatus,
        afterStatus: 'in_progress',
        transitioned: true,
        note: `fan-out revise (dissenters: ${aggregate.dissenting.map((d) => d.guildSlug).join(', ')})`,
      })
      return {
        kind: 'processed',
        taskId: task.id,
        agent: 'reviewer-fanout',
        beforeStatus,
        afterStatus: 'in_progress',
        transitioned: true,
        note: `fan-out revise (dissenters: ${aggregate.dissenting.map((d) => d.guildSlug).join(', ')})`,
        revisionCount: t.revisionCount,
      } as TickOutcome
    })
  }

  /**
   * Recover review packets that describe a diff which no longer exists. A
   * checkpoint is useful recovery evidence, but cannot make absent work
   * reviewable or turn reviewer retry into an owner action.
   */
  private async recoverStaleReviewHandoff(task: Task): Promise<TickOutcome | null> {
    if (task.status !== 'review' || !this.hasReviewProofPacket(task)) return null

    const hasCommittedTaskWork = await this.taskWorktreeHasCommittedProgress(task)
    const worktreePath = task.worktreePath?.trim()
    const hasTaskWorktreeChanges =
      Boolean(worktreePath) &&
      !(await this.gitDriver.isClean(resolveRuntimePath(worktreePath!)))
    if (hasTaskWorktreeChanges || hasCommittedTaskWork) return null

    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const current = queue.tasks.find((candidate) => candidate.id === task.id)
      if (!current || current.status !== 'review' || !this.hasReviewProofPacket(current)) return null

      const currentHasCommittedWork = await this.taskWorktreeHasCommittedProgress(current)
      const currentWorktreePath = current.worktreePath?.trim()
      const currentHasWorktreeChanges =
        Boolean(currentWorktreePath) &&
        !(await this.gitDriver.isClean(resolveRuntimePath(currentWorktreePath!)))
      if (currentHasWorktreeChanges || currentHasCommittedWork) return null

      const now = this.now()
      transitionTaskStatus({
        task: current,
        event: 'revise',
        actor: 'stale-review-handoff-recovery',
        evidenceRefs: ['task:review-handoff:implementation-surface-missing'],
        now,
      })
      ensureWorkerOwnership(current)
      current.notes.push({
        agentId: 'coordinator',
        role: 'worker-progress-review',
        structured: {
          event: 'worker_self_critique_rejected',
          reason: 'review_implementation_surface_missing',
        },
        content:
          'Guildhall reopened this review handoff because its checkpoint named changed files, but the managed task worktree and task branch no longer contain reviewable implementation work. The worker must restore or recreate the scoped change before another review is requested.',
        timestamp: now,
      })
      current.updatedAt = now
      queue.lastUpdated = now
      await this.writeQueue(queue)
      await upsertTaskRuntimeState(inferProjectRootFromMemoryDir(this.opts.config.memoryDir), current.id, {
        assignedTo: 'worker-agent',
        updatedAt: now,
      })
      await this.logTickProgress({
        task: current,
        agent: 'coordinator-remediation',
        beforeStatus: 'review',
        afterStatus: 'in_progress',
        transitioned: true,
        note: 'review handoff claimed files that are absent from the task worktree and branch',
      })
      return {
        kind: 'processed',
        taskId: current.id,
        agent: 'coordinator-remediation',
        beforeStatus: 'review',
        afterStatus: 'in_progress',
        transitioned: true,
        revisionCount: current.revisionCount,
      } as TickOutcome
    })
  }

  /**
   * Record a fan-out contract/provider failure without re-running a second
   * generic reviewer. A malformed model response is not a product defect and
   * must never become worker feedback. Fallback mode may still hand the task
   * to deterministic review and hard gates; llm_only remains an honest
   * provider error so the run can retry without changing product state.
   */
  private async handleReviewerFanoutFailureInline(
    task: Task,
    verdicts: readonly PersonaVerdict[],
    reviewerMode: ReviewerMode,
    failureSummary: string,
  ): Promise<TickOutcome> {
    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const index = queue.tasks.findIndex((candidate) => candidate.id === task.id)
      const current = index >= 0 ? queue.tasks[index] : undefined
      if (!current || current.status !== 'review') {
        return {
          kind: 'processed',
          taskId: task.id,
          agent: 'reviewer-fanout',
          beforeStatus: 'review',
          afterStatus: current?.status ?? task.status,
          transitioned: false,
          revisionCount: current?.revisionCount ?? task.revisionCount,
        } as TickOutcome
      }

      const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
      const effective = await buildEffectiveTask(projectRoot, current, { evidence: 'full' }) as unknown as Task
      const now = this.now()
      effective.reviewVerdicts.push(
        ...verdicts.map((verdict) => personaVerdictToReviewRecord(verdict, { now, taskId: effective.id })),
      )
      const failureCodes = [...new Set(verdicts.map((verdict) => verdict.failureCode ?? 'invalid_review_contract'))]
      effective.notes.push({
        agentId: 'reviewer-fanout',
        role: 'reviewer',
        content:
          'Reviewer fan-out did not produce a usable structured result. ' +
          'Guildhall recorded a contract/provider failure; no product finding was inferred from reviewer prose.',
        structured: {
          kind: 'reviewer_contract_failure',
          failureCodes,
          personaIds: verdicts.map((verdict) => verdict.guildSlug),
        },
        timestamp: now,
      })
      effective.updatedAt = now
      queue.tasks[index] = effective
      queue.lastUpdated = now
      await this.writeQueue(queue)

      if (reviewerMode === 'llm_with_deterministic_fallback') {
        const emptyReviewAuthority = { reviewVerdicts: [] }
        const reviewCriteriaIds = reviewAcceptanceCriteriaMissingApprovalIds(effective, emptyReviewAuthority)
        const reviewProofIds = reviewProofMissingApprovalIds(effective, emptyReviewAuthority)
        if (reviewCriteriaIds.length > 0 || reviewProofIds.length > 0) {
          const summary = [
            'Reviewer fan-out was unavailable and deterministic fallback cannot settle review-owned targets.',
            reviewCriteriaIds.length > 0
              ? `Review criteria still requiring reviewer authority: ${reviewCriteriaIds.join(', ')}`
              : '',
            reviewProofIds.length > 0
              ? `Review evidence still requiring reviewer authority: ${reviewProofIds.join(', ')}`
              : '',
          ].filter(Boolean).join(' ')
          await this.logTickProgress({
            task: effective,
            agent: 'reviewer-fanout',
            beforeStatus: 'review',
            afterStatus: 'review',
            transitioned: false,
            note: summary,
          })
          return {
            kind: 'agent-error',
            taskId: effective.id,
            agent: 'reviewer-fanout',
            error: summary,
          } as TickOutcome
        }
        const llmFailureCode = failureCodes.includes('provider_timeout')
          ? 'provider_timeout'
          : failureCodes.includes('provider_unavailable')
            ? 'provider_unavailable'
            : 'invalid_review_contract'
        return await this.applyReviewVerdictInline({
          task: effective,
          queue,
          llmError: failureSummary,
          llmFailureCode,
        })
      }

      await this.logTickProgress({
        task: effective,
        agent: 'reviewer-fanout',
        beforeStatus: 'review',
        afterStatus: 'review',
        transitioned: false,
        note: failureSummary,
      })
      return {
        kind: 'agent-error',
        taskId: effective.id,
        agent: 'reviewer-fanout',
        error: failureSummary,
      } as TickOutcome
    })
  }

  private async persistReviewerRuns(input: {
    task: Task
    verdicts: readonly PersonaVerdict[]
    reviewPlan: ReviewPlanRecord | null
    recordedAt: string
  }): Promise<void> {
    const store = this.opts.reviewAuditStore
    if (!store) return
    for (const verdict of input.verdicts) {
      const recipe = selectReviewerRunRecipe(input.reviewPlan)
      try {
        await store.saveReviewerRun({
          taskId: input.task.id,
          recipeId: recipe.recipeId,
          recipeVersion: recipe.version,
          lanes: recipe.lanes,
          verdict: verdict.verdict,
          findings: (verdict.findings ?? []).map((finding) => ({
            lane: recipe.lanes[0] ?? 'test_adequacy',
            severity: finding.disposition === 'unsatisfied' ? 'high' : 'low',
            summary: finding.workerInstruction ?? `${finding.targetKind}:${finding.targetId} is ${finding.disposition}`,
          })),
          recordedAt: input.recordedAt,
          recordedBy: `reviewer-fanout:${verdict.guildSlug}`,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await this.logTickProgress({
          task: input.task,
          agent: 'reviewer-fanout',
          beforeStatus: input.task.status,
          afterStatus: input.task.status,
          transitioned: false,
          note: `reviewer-run audit write failed for ${verdict.guildSlug}: ${message}`,
        })
      }
    }
  }

  /**
   * Route a typed review-target conflict to its deterministic recovery action.
   * Persona identity, response order, and reviewer prose cannot select a
   * winner. The record names the exact findings in disagreement and either
   * re-runs proof verification or returns a canonical target for inspection.
   */
  private async routeToCoordinatorAdjudication(input: {
    queue: TaskQueue
    task: Task
    aggregate: ReturnType<typeof aggregateFanout>
    verdicts: readonly PersonaVerdict[]
    round: number
    now: string
    beforeStatus: TaskStatus
  }): Promise<TickOutcome | null> {
    const coord = this.opts.agents.coordinators[input.task.domain]
    const coordinatorId = coord?.name ?? 'coordinator-default'

    const dissenterSlugs = input.aggregate.dissenting.map(d => d.guildSlug)
    const conflictKeys = new Set(input.aggregate.conflicts
      .map(conflict => `${conflict.targetKind}:${conflict.targetId}`))
    const conflictFindingRefs = input.task.reviewVerdicts
      .filter(verdict => verdict.recordedAt === input.now)
      .flatMap(verdict => (verdict.findings ?? [])
        .filter(finding => conflictKeys.has(`${finding.targetKind}:${finding.targetId}`))
        .map(finding => `${verdict.id ?? `review:${input.task.id}:${verdict.reviewerId ?? 'unknown'}:${input.now}`}:${finding.targetKind}:${finding.targetId}`))
      .sort()
    const resolution: AdjudicationRecord['resolution'] = input.aggregate.conflicts.length > 0 &&
      input.aggregate.conflicts.every(conflict => conflict.targetKind === 'proof_evidence')
      ? 'rerun_verification'
      : 'inspect_canonical_task'
    const scopeInstructions = [...new Set(
      input.aggregate.dissenting
        .flatMap(d => d.findings ?? [])
        .filter(finding => finding.disposition === 'unsatisfied' && conflictKeys.has(`${finding.targetKind}:${finding.targetId}`))
        .map(finding => finding.workerInstruction?.trim() || `Inspect ${finding.targetKind.replace(/_/g, ' ')} ${finding.targetId}.`),
    )]

    const rationale = [
      `Reviewer fan-out round ${input.round} produced incompatible typed`,
      `findings for ${input.aggregate.conflicts.map(conflict => `${conflict.targetKind}:${conflict.targetId}`).join(', ')}.`,
      `Guildhall routed the conflict to the domain coordinator (${input.task.domain}).`,
      '',
      `Recovery action: ${resolution}. No reviewer or persona is recorded as`,
      'a winner. The next transition is selected only from the contested target type.',
    ].join('\n')

    const adjudication: AdjudicationRecord = {
      round: input.round,
      trigger: input.aggregate.adjudicationTrigger ?? 'policy_conflict',
      dissenters: dissenterSlugs,
      winningConcerns: [],
      supersededConcerns: [],
      findingRefs: conflictFindingRefs,
      contestedTargets: input.aggregate.conflicts.map(conflict => ({
        targetKind: conflict.targetKind,
        targetId: conflict.targetId,
      })),
      resolution,
      summary: resolution === 'rerun_verification'
        ? `Coordinator requested verification rerun for ${conflictFindingRefs.length} conflicting review finding${conflictFindingRefs.length === 1 ? '' : 's'}.`
        : `Coordinator requested canonical task inspection for ${conflictFindingRefs.length} conflicting review finding${conflictFindingRefs.length === 1 ? '' : 's'}.`,
      rationale,
      scopeInstructions,
      decidedBy: 'coordinator',
      decidedAt: input.now,
    }
    input.task.adjudications.push(adjudication)

    // Write a DECISIONS.md entry capturing the adjudication so the audit
    // trail lives outside TASKS.json too.
    const decisionsPath = getProjectSystemStatePathFromMemoryDir(this.opts.config.memoryDir, 'DECISIONS.md')
    const decisionEntry = [
      `### ${input.now} — Reviewer fan-out adjudication`,
      '',
      `**Task:** ${input.task.id}`,
      `**Domain:** ${input.task.domain}`,
      `**Coordinator:** ${coordinatorId}`,
      `**Trigger:** ${adjudication.trigger} (round ${adjudication.round})`,
      `**Dissenters:** ${dissenterSlugs.join(', ') || 'none'}`,
      `**Finding references:** ${conflictFindingRefs.join(', ') || 'none'}`,
      `**Recovery action:** ${resolution}`,
      '',
      '**Rationale:**',
      rationale,
      '',
      '**Target-anchored instructions:**',
      ...scopeInstructions.map(i => `- ${i}`),
      '',
      '---',
      '',
    ].join('\n')
    try {
      await appendManagedTextFile(decisionsPath, decisionEntry, 'utf8')
    } catch {
      // Appending to DECISIONS.md is best-effort; the task-level record is
      // the load-bearing trail.
    }

    if (resolution === 'rerun_verification') {
      input.task.notes.push({
        agentId: coordinatorId,
        role: 'coordinator',
        content: `${adjudication.summary}\n\n${rationale}`,
        timestamp: input.now,
      })
      transitionTaskStatus({
        task: input.task,
        event: 'start_gate_check',
        actor: coordinatorId,
        evidenceRefs: conflictFindingRefs,
        now: input.now,
      })
      input.task.updatedAt = input.now
      input.queue.lastUpdated = input.now
      await this.writeQueue(input.queue)
      await this.logTickProgress({
        task: input.task,
        agent: coordinatorId,
        beforeStatus: input.beforeStatus,
        afterStatus: 'gate_check',
        transitioned: true,
        note: 'coordinator requested verification rerun for typed reviewer conflict',
      })
      return {
        kind: 'processed',
        taskId: input.task.id,
        agent: coordinatorId,
        beforeStatus: input.beforeStatus,
        afterStatus: 'gate_check',
        transitioned: true,
        note: 'coordinator requested verification rerun for typed reviewer conflict',
        revisionCount: input.task.revisionCount,
      } as TickOutcome
    }

    // Build the worker's next prompt from target-anchored instructions only.
    const scopedFeedback = [
      `**Coordinator adjudication (round ${adjudication.round}):**`,
      '',
      adjudication.summary,
      '',
      '**Target-anchored instructions (inspect exactly these items):**',
      ...scopeInstructions.map(i => `- ${i}`),
    ].join('\n')

    input.task.notes.push({
      agentId: coordinatorId,
      role: 'coordinator',
      content: scopedFeedback,
      timestamp: input.now,
    })
    transitionTaskStatus({
      task: input.task,
      event: 'revise',
      actor: coordinatorId,
      evidenceRefs: conflictFindingRefs,
      now: input.now,
    })
    ensureWorkerOwnership(input.task)
    input.task.revisionCount += 1
    input.task.updatedAt = input.now
    input.queue.lastUpdated = input.now

    // maxRevisions still caps: if the coordinator keeps having to adjudicate,
    // escalate to human.
    if (input.task.revisionCount > this.opts.config.maxRevisions) {
      await this.writeQueue(input.queue)
      await raiseEscalation({
        tasksPath: this.tasksPath(),
        progressPath: this.progressPath(),
        taskId: input.task.id,
        agentId: coordinatorId,
        reason: 'max_revisions_exceeded',
        recoveryCode: 'max_revisions_actionable',
        summary:
          `Adjudicated ${input.task.revisionCount} times (maxRevisions=${this.opts.config.maxRevisions}). ` +
          `Coordinator cannot resolve; escalating.`,
        details: rationale,
      })
      return {
        kind: 'blocked-max-revisions',
        taskId: input.task.id,
        revisionCount: input.task.revisionCount,
      } as TickOutcome
    }

    await this.writeQueue(input.queue)
    await this.logTickProgress({
      task: input.task,
      agent: coordinatorId,
      beforeStatus: input.beforeStatus,
      afterStatus: 'in_progress',
      transitioned: true,
      note: 'coordinator requested canonical task inspection for typed reviewer conflict',
    })
    return {
      kind: 'processed',
      taskId: input.task.id,
      agent: coordinatorId,
      beforeStatus: input.beforeStatus,
      afterStatus: 'in_progress',
      transitioned: true,
      note: 'coordinator requested canonical task inspection for typed reviewer conflict',
      revisionCount: input.task.revisionCount,
    } as TickOutcome
  }

  private async applyReviewVerdictInline(opts: {
    task: Task
    queue: TaskQueue
    llmError: string | undefined
    llmFailureCode?: NonNullable<ReviewVerdict['failureCode']>
  }): Promise<TickOutcome> {
    const { task, queue, llmError, llmFailureCode } = opts
    const beforeStatus = task.status
    const taskForVerdict = queue.tasks.find((t) => t.id === task.id) ?? task
    reconcileAcceptanceCriteriaFromLatestWorkerSelfCritique(taskForVerdict)
    let verdict = deterministicReview(taskForVerdict, {
      projectPath: taskForVerdict.projectPath,
      likelyTargetFiles: resolveLikelyTaskFiles(taskForVerdict),
      gateScopeExceptions: taskForVerdict.gateScopeExceptions ?? [],
    })
    const preservedSubstantiveRevision = latestReviewRoundHasSubstantiveRevision(taskForVerdict)
    if (preservedSubstantiveRevision) {
      verdict = {
        ...verdict,
        verdict: 'revise',
        reason: 'Deterministic review preserved the latest substantive reviewer revision; a fresh approval is required.',
        reasoning: [
          verdict.reasoning,
          'A substantive reviewer revision is the latest review round. Deterministic review cannot supersede that finding without a fresh reviewer approval.',
        ].join('\n'),
        failingSignals: [...new Set([...verdict.failingSignals, 'unresolved-review-feedback'])],
      }
    }
    if (shouldAdvanceInfraFallbackToGateCheck(taskForVerdict, verdict, llmFailureCode)) {
      verdict = {
        verdict: 'approve',
        reason:
          'Deterministic fallback: reviewer was unavailable, acceptance criteria are already met, and hard gates have not run yet; advance to gate_check.',
        reasoning: [
          'Reviewer fallback override:',
          `  - LLM reviewer failed with infrastructure error: ${llmError}`,
          '  - Acceptance criteria were reconciled as met from the latest worker self-critique.',
          '  - No hard gates have run yet, so review should hand off to gate_check instead of bouncing back to the worker.',
        ].join('\n'),
        score: DETERMINISTIC_PASS_THRESHOLD,
        failingSignals: [],
      }
    }
    const { newStatus } = applyDeterministicVerdict({
      queue,
      taskId: task.id,
      verdict,
      now: this.now(),
      ...(llmError !== undefined ? { llmError } : {}),
      ...(llmFailureCode !== undefined ? { llmFailureCode } : {}),
      ...(preservedSubstantiveRevision
        ? { reviewerId: 'deterministic-review-preservation' }
        : {}),
    })

    const taskAfter = queue.tasks.find((t) => t.id === task.id)!
    const transitioned = beforeStatus !== newStatus
    const agentId = llmError
      ? 'reviewer-deterministic-fallback'
      : 'reviewer-deterministic'

    // Revision counting mirrors the LLM path: review → in_progress is a revise.
    let revisionCount = taskAfter.revisionCount
    if (newStatus === 'in_progress') {
      ensureWorkerOwnership(taskAfter)
      revisionCount = taskAfter.revisionCount + 1
      taskAfter.revisionCount = revisionCount
      taskAfter.updatedAt = this.now()
      queue.lastUpdated = this.now()

      if (revisionCount > this.opts.config.maxRevisions) {
        await this.writeQueue(queue)
        await raiseEscalation({
          tasksPath: this.tasksPath(),
          progressPath: this.progressPath(),
          taskId: task.id,
          agentId,
          reason: 'max_revisions_exceeded',
          recoveryCode: 'max_revisions_actionable',
          summary:
            `Exceeded maxRevisions (${this.opts.config.maxRevisions}). ` +
            `Requires human judgment.`,
          details:
            `Deterministic reviewer bounced the task to in_progress ` +
            `${revisionCount} times. Last reason: ${verdict.reason}.`,
        })
        return {
          kind: 'blocked-max-revisions',
          taskId: task.id,
          revisionCount,
        }
      }
    }

    await this.writeQueue(queue)
    await this.logTickProgress({
      task: taskAfter,
      agent: agentId,
      beforeStatus,
      afterStatus: newStatus,
      transitioned,
      note: llmError
        ? `deterministic fallback (LLM error: ${llmError}) → ${verdict.verdict}`
        : `deterministic review → ${verdict.verdict}`,
    })

    return {
      kind: 'processed',
      taskId: task.id,
      agent: agentId,
      beforeStatus,
      afterStatus: newStatus,
      transitioned,
      revisionCount,
    }
  }

  /**
   * FR-24: resolve the workspace-level runtime-isolation config from
   * `guildhall.yaml`. Returns an empty config when the user hasn't supplied
   * one; the slot-allocator fills in built-in defaults.
   */
  private runtimeConfig(): RuntimeIsolationConfig {
    const raw = this.opts.config.runtime
    if (!raw) return {}
    const out: RuntimeIsolationConfig = {}
    if (raw.portBase !== undefined) out.portBase = raw.portBase
    if (raw.portStride !== undefined) out.portStride = raw.portStride
    if (raw.envVarPrefixTemplate !== undefined) {
      out.envVarPrefixTemplate = raw.envVarPrefixTemplate
    }
    if (raw.sharedEnv !== undefined) out.sharedEnv = raw.sharedEnv
    return out
  }

  /**
   * FR-24: returns the current slot allocator, instantiating it on demand
   * after reading the levers. The first call decides whether isolation is
   * enabled; subsequent calls reuse the same allocator (so slots persist
   * across ticks within one orchestrator lifetime).
   *
   * Exposed as `public` for tests and for the serve-layer supervisor that
   * needs to inspect / reset allocation state during crash recovery.
   */
  async ensureSlotAllocator(): Promise<SlotAllocator | null> {
    if (this.slotAllocator !== undefined) return this.slotAllocator
    try {
      const settings = await this.readLeverSettings()
      const shape = resolveSlotShape(settings.project)
      if (!shape.enabled) {
        this.slotAllocator = null
        return null
      }
      this.slotAllocator = new SlotAllocator(shape.capacity, this.runtimeConfig())
      return this.slotAllocator
    } catch {
      // Missing / unreadable settings — fall back to "no isolation". Surface
      // nothing here: the first tick that actually needs slots will read
      // levers again once they exist, and stall/remediation paths are
      // independent of this decision.
      this.slotAllocator = null
      return null
    }
  }

  /** FR-24: claim a slot for a task if isolation is enabled. */
  private async allocateSlotForTask(task: Task): Promise<Slot | null> {
    const allocator = await this.ensureSlotAllocator()
    if (!allocator) return null
    return allocator.allocate(task.id)
  }

  /**
   * FR-24: read the `concurrent_task_dispatch` lever. Falls back to serial
   * (capacity 1) on any read error — starting a fanout dispatch with stale
   * lever state would be strictly worse than running one task.
   */
  /**
   * Structural-reliability precondition check. Returns a halt outcome when
   * the bootstrap block is either absent/unverified (`bootstrap_required`) or
   * present with a failed install (`bootstrap_failed`). Returns null when the
   * project is either fully verified or has no bootstrap block configured at
   * all (legacy projects and fresh workspaces keep their pre-existing
   * behaviour — the inbox already surfaces "bootstrap_missing" for them).
   */
  private bootstrapHalt(pendingTaskCount: number): TickOutcome | null {
    const b = this.opts.config.bootstrap
    if (!b) return null
    const hasStructural =
      b.verifiedAt != null || b.install != null || b.gates != null ||
      b.commands.length > 0 || b.successGates.length > 0
    if (!hasStructural) return null
    if (b.install?.status === 'failed') {
      return { kind: 'bootstrap-required', reason: 'bootstrap_failed', pendingTaskCount }
    }
    if (b.verifiedAt == null) {
      return { kind: 'bootstrap-required', reason: 'bootstrap_required', pendingTaskCount }
    }
    return null
  }

  private async resolveCapacity(): Promise<FanoutCapacity> {
    try {
      const settings = await this.readLeverSettings()
      return resolveFanoutCapacity(settings.project)
    } catch {
      return readProjectConfig(this.opts.config.projectPath).workerLaneConcurrency ?? 1
    }
  }

  private async hydrateEffectiveTaskForDispatch(task: Task): Promise<Task> {
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    // Promoted projects have one current-task assembly point. Do not catch a
    // database read failure and hand dispatch the raw queue row: that would
    // silently drop runtime state and let a second recovery policy run.
    if (readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database') {
      const current = await readProjectTaskCurrentStateAtBoundary(projectRoot, task.id)
      if (current.authority !== 'database' || !current.task) {
        throw new Error(`authoritative task state unavailable for ${task.id}`)
      }
      return current.task as Task
    }

    try {
      return await buildEffectiveTask(
        projectRoot,
        task,
        task.status === 'review' ? { evidence: 'full' } : {},
      ) as unknown as Task
    } catch {
      return task
    }
  }

  /**
   * Git owns merge completion. A worker may report that it resolved a conflict,
   * but the normalized workspace fact clears only after a fresh Git read.
   */
  private async refreshWorktreeSyncRecovery(task: Task): Promise<WorktreeSyncRecovery | null> {
    const workspace = (task as Task & { workspace?: TaskWorkspaceState }).workspace
    const recovery = workspace?.syncRecovery
    if (!recovery) return null
    const worktreePath = task.worktreePath ?? workspace?.worktreePath
    if (!worktreePath) return recovery
    const observed = await this.gitDriver.worktreeMergeState(
      resolveRuntimePath(worktreePath),
      recovery.baseBranch,
    )
    if (observed.mergeInProgress || observed.conflictPaths.length > 0) {
      const next: WorktreeSyncRecovery = {
        ...recovery,
        ...(observed.conflictPaths.length > 0
          ? { conflictPaths: [...observed.conflictPaths].sort() }
          : {}),
        baseSha: observed.baseSha,
        headSha: observed.headSha,
      }
      if (JSON.stringify(next) !== JSON.stringify(recovery)) {
        await upsertTaskWorkspaceState(
          inferProjectRootFromMemoryDir(this.opts.config.memoryDir),
          task.id,
          { syncRecovery: next, updatedAt: this.now() },
        )
        ;(task as Task & { workspace?: TaskWorkspaceState }).workspace = { ...workspace!, syncRecovery: next }
      }
      return next
    }
    await upsertTaskWorkspaceState(
      inferProjectRootFromMemoryDir(this.opts.config.memoryDir),
      task.id,
      { syncRecovery: undefined, updatedAt: this.now() },
    )
    if (workspace) {
      const { syncRecovery: _syncRecovery, ...clearedWorkspace } = workspace
      ;(task as Task & { workspace?: TaskWorkspaceState }).workspace = clearedWorkspace
    }
    return null
  }

  private async returnTaskToWorktreeSyncRecovery(
    task: Task,
    recovery: WorktreeSyncRecovery,
  ): Promise<TickOutcome> {
    const queue = await this.readQueue()
    const current = queue.tasks.find(candidate => candidate.id === task.id)
    if (!current) {
      return {
        kind: 'agent-error',
        taskId: task.id,
        agent: 'worktree-sync-recovery',
        error: `Task ${task.id} disappeared before worktree recovery could resume.`,
      }
    }
    const beforeStatus = current.status
    if (current.status === 'review' || current.status === 'gate_check') {
      transitionTaskStatus({
        task: current,
        event: 'revise',
        actor: 'worktree-sync-recovery',
        evidenceRefs: ['task:worktree-sync:git-merge-still-active'],
        now: this.now(),
      })
    } else if (current.status === 'blocked') {
      transitionTaskStatus({
        task: current,
        event: 'recover_to_in_progress',
        actor: 'worktree-sync-recovery',
        evidenceRefs: ['task:worktree-sync:git-merge-still-active'],
        now: this.now(),
      })
    }
    current.assignedTo = 'worker-agent'
    current.blockReason = undefined
    current.recoveryCode = undefined
    current.updatedAt = this.now()
    queue.lastUpdated = current.updatedAt
    await this.writeQueue(queue)
    await this.logTickProgress({
      task: current,
      agent: 'worktree-sync-recovery',
      beforeStatus,
      afterStatus: current.status,
      transitioned: beforeStatus !== current.status,
      note: `Git merge remains active for ${recovery.conflictPaths.join(', ')}; returning work to the worker recovery lane.`,
    })
    return {
      kind: 'processed',
      taskId: current.id,
      agent: 'worktree-sync-recovery',
      beforeStatus,
      afterStatus: current.status,
      transitioned: beforeStatus !== current.status,
      revisionCount: current.revisionCount,
    }
  }

  /**
   * FR-24: read the `worktree_isolation` lever. Falls back to `'none'` on
   * error so a malformed lever file doesn't block progress.
   */
  private async resolveWorktreeModeSafe(): Promise<WorktreeMode> {
    try {
      const settings = await this.readLeverSettings()
      return resolveWorktreeMode(settings.project)
    } catch {
      return 'none'
    }
  }

  /**
   * FR-25: read the accepted-work landing strategy. Falls back to
   * `cherry_pick_local` so a lever outage never pushes or opens a PR
   * unexpectedly.
   */
  private async resolveLandingStrategySafe(): Promise<LandingStrategy> {
    try {
      const settings = await this.readLeverSettings()
      return resolveLandingStrategy(settings.project)
    } catch {
      return 'cherry_pick_local'
    }
  }

  /**
   * FR-24: the landing branch used when minting fresh per-task worktrees.
   * Cached after the first lookup — the default branch of a repo does not
   * change during an orchestrator run.
   */
  private readonly cachedLandingBranches = new Map<string, string>()
  private async resolveBaseBranch(projectPath: string): Promise<string> {
    const explicit = this.opts.config.landingBranch?.trim()
    if (explicit) return explicit
    const cached = this.cachedLandingBranches.get(projectPath)
    if (cached) return cached
    try {
      const branch = await this.gitDriver.currentBranch(projectPath)
      this.cachedLandingBranches.set(projectPath, branch)
      return branch
    } catch {
      // Best-effort default — InMemoryGitDriver in tests defaults to 'main'.
      this.cachedLandingBranches.set(projectPath, 'main')
      return 'main'
    }
  }

  private hasGuildhallOwnershipTrail(task: Task): boolean {
    // Proof setup is Guildhall-created executable work. Its source changes
    // and generated proof artifacts belong to the proof lane even when the
    // compact task row no longer carries the older note/progress trail.
    // Treating this as external checkout state turns a Guildhall-owned proof
    // contract into an unnecessary human commit/stash checkpoint.
    if (task.semanticKind === 'proof_setup') return true
    if (task.origination === 'system' || task.proposedBy === 'task-sizing') return true
    if ((task.notes ?? []).some((note) => note.agentId !== 'human')) return true
    const progress = (task as Task & { progress?: Array<{ agentId?: string }> }).progress
    if ((progress ?? []).some((entry) => entry.agentId !== 'human')) return true
    if ((task.reviewVerdicts ?? []).length > 0) return true
    if ((task.gateResults ?? []).length > 0) return true
    if ((task.escalations ?? []).length > 0) return true
    return false
  }

  private async reopenRecoverableDirtyRepoTasks(queue: TaskQueue): Promise<TaskQueue> {
    let changed = false
    let expensiveRecoveryChecks = 0
    const maxExpensiveRecoveryChecks = 1
    const now = this.now()
    const recordFailedBootstrapRecovery = (task: Task, res: ReturnType<typeof runBootstrap>): void => {
      const failed = res.steps.find((step) => step.result === 'fail')
      const msg = `worktree bootstrap failed on ${failed?.kind ?? 'step'} \`${failed?.command ?? ''}\` (exit ${failed?.exitCode ?? '?'})`
      const nextReason =
        `Guildhall retried this task after the project setup contract changed, but task setup still fails: ${msg}. ` +
        'Fix the task-local bootstrap/gate failure, then resume the task.'
      if (task.blockReason === nextReason) return
      task.blockReason = nextReason
      task.notes.push({
        agentId: 'coordinator',
        role: 'bootstrap-failure',
        content:
          `Recovery retry did not reopen the task. ${msg}. ` +
          'Guildhall updated this blocker with the current task-local setup failure instead of keeping the stale setup message.',
        timestamp: now,
      })
      task.updatedAt = now
      changed = true
    }
    for (const [taskIndex, queuedTask] of queue.tasks.entries()) {
      const reviewVerificationRecovery =
        queuedTask.status === 'review' &&
        await this.isRecoverableSelfAuthoredVerificationBlockedTask(queuedTask)
      if (queuedTask.status !== 'blocked' && !reviewVerificationRecovery) continue
      if (reopenLegacyWorktreeSyncRecovery(queuedTask, now)) {
        queue.lastUpdated = now
        changed = true
        continue
      }
      if (!this.hasGuildhallOwnershipTrail(queuedTask)) continue
      // Recovery classification is one of the few execution paths that may
      // need historical evidence. Keep the project queue compact, but reopen
      // the bounded review history for this one blocked task before deciding
      // whether a max-revisions stop is substantive or infrastructure-only.
      let task = queuedTask
      if (
        queuedTask.recoveryCode === 'max_revisions_actionable' ||
        queuedTask.recoveryCode === 'reviewer_fanout_max_revisions' ||
        hasActiveEscalationRecoveryCode(queuedTask, 'max_revisions_actionable') ||
        hasActiveEscalationRecoveryCode(queuedTask, 'reviewer_fanout_max_revisions') ||
        hasActiveEscalationRecoveryCode(queuedTask, 'worker_turn_limit')
      ) {
        const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
        task = await buildEffectiveTask(projectRoot, queuedTask, { evidence: 'full' }) as unknown as Task
        queue.tasks[taskIndex] = task
      }
      let recoveryNote: string | null = null
      let recoveryRole = 'recovery'
      let recoveryStatus: Task['status'] = 'in_progress'
      let recoveryAssignee: string | null = 'worker-agent'
      if (task.recoveryCode === 'dirty_checkout') {
        const repoRoot = this.resolveEffectiveTaskProjectPath(task)
        const repoClean = await this.gitDriver.isClean(repoRoot)
        if (repoClean) {
          transitionTaskStatus({
            task,
            event: 'recover_to_ready',
            actor: 'orchestrator-recovery',
            evidenceRefs: ['task:recovery:dirty-checkout-cleared'],
            now,
          })
          task.assignedTo = null
          task.blockReason = undefined
          task.recoveryCode = undefined
          task.notes.push({
            agentId: 'coordinator',
            role: 'recovery',
            content:
              'Guildhall rechecked the target repository through the shared Git authority and found it clean. ' +
              'Cleared the stale dirty-checkout blocker and returned the task to the runnable queue.',
            timestamp: now,
          })
          task.updatedAt = now
          queue.lastUpdated = now
          changed = true
          continue
        }
        recoveryNote =
          'User restarted the project while Guildhall-owned shared-checkout edits were still present. Reopened the task so Guildhall can checkpoint those edits into an isolated task branch.'
      } else if (task.recoveryCode === 'environment_setup') {
        const effectiveTaskProjectPath = this.resolveEffectiveTaskProjectPath(task)
        const activeWorktreePath = task.worktreePath?.trim() ?? ''
        const wtBootstrap = resolveEffectiveTaskBootstrapBlock({
          task,
          workspaceProjectPath: this.opts.config.projectPath,
          workspaceBootstrap: this.opts.config.bootstrap ?? undefined,
          workspaceProjects: this.workspaceProjectsForTaskResolution(),
        })
        if (
          !activeWorktreePath ||
          !existsSync(activeWorktreePath) ||
          !wtBootstrap ||
          wtBootstrap.commands.length === 0 ||
          path.resolve(activeWorktreePath) === path.resolve(effectiveTaskProjectPath)
        ) {
          continue
        }
        if (expensiveRecoveryChecks >= maxExpensiveRecoveryChecks) continue
        expensiveRecoveryChecks += 1
        const wtMemoryDir = path.join(activeWorktreePath, '.guildhall')
        const res = runBootstrap({
          projectPath: activeWorktreePath,
          memoryDir: wtMemoryDir,
          commands: wtBootstrap.commands,
          successGates: wtBootstrap.successGates,
          timeoutMs: wtBootstrap.timeoutMs,
        })
        if (!res.success) {
          recordFailedBootstrapRecovery(task, res)
          continue
        }
        recoveryStatus = 'ready'
        recoveryAssignee = null
        recoveryNote =
          'User restarted the project after an earlier task bootstrap failure. The task worktree bootstrap now passes, so Guildhall reopened the task into the runnable queue.'
      } else if (isRecoverableStaleGateFailureBlocker(task)) {
        resolveRecoverableStaleGateFailureEscalations(task, now)
        if (activeEscalations(task).length > 0) continue
        recoveryStatus = 'gate_check'
        recoveryAssignee = 'gate-checker-agent'
        recoveryNote =
          'Guildhall recognized a stale gate failure rather than an owner decision. Reopened gate check so the provider/gate lane can retry without surfacing an internal blocker.'
      } else if (isRecoverableEnvironmentSetupBlocker(task)) {
        const effectiveTaskProjectPath = this.resolveEffectiveTaskProjectPath(task)
        const activeWorktreePath = task.worktreePath?.trim() ?? ''
        const wtBootstrap = resolveEffectiveTaskBootstrapBlock({
          task,
          workspaceProjectPath: this.opts.config.projectPath,
          workspaceBootstrap: this.opts.config.bootstrap ?? undefined,
          workspaceProjects: this.workspaceProjectsForTaskResolution(),
        })
        if (
          !activeWorktreePath ||
          !existsSync(activeWorktreePath) ||
          !wtBootstrap ||
          wtBootstrap.commands.length === 0 ||
          path.resolve(activeWorktreePath) === path.resolve(effectiveTaskProjectPath)
        ) {
          continue
        }
        if (expensiveRecoveryChecks >= maxExpensiveRecoveryChecks) continue
        expensiveRecoveryChecks += 1
        const wtMemoryDir = path.join(activeWorktreePath, '.guildhall')
        const res = runBootstrap({
          projectPath: activeWorktreePath,
          memoryDir: wtMemoryDir,
          commands: wtBootstrap.commands,
          successGates: wtBootstrap.successGates,
          timeoutMs: wtBootstrap.timeoutMs,
        })
        if (!res.success) {
          recordFailedBootstrapRecovery(task, res)
          continue
        }
        resolveRecoverableEnvironmentSetupEscalations(task, now)
        if (activeEscalations(task).length > 0) continue
        recoveryStatus = 'ready'
        recoveryAssignee = null
        recoveryNote =
          'User restarted the project after a task-local test environment failure. The repaired worktree install now passes, so Guildhall reopened the task into the runnable queue.'
      } else if (isRecoverableReviewHandoffToolLoop(task)) {
        resolveRecoverableReviewHandoffEscalations(task, now)
        if (activeEscalations(task).length > 0) continue
        recoveryNote =
          'User restarted the project after Guildhall hit the now-fixed review handoff validator bug. Reopened the task so the worker can retry the handoff without a manual JSON edit.'
      } else if (isRecoverableStaleReviewCheckpointBlocker(task)) {
        resolveRecoverableStaleReviewCheckpointEscalations(task, now)
        if (activeEscalations(task).length > 0) continue
        transitionTaskStatus({
          task,
          event: 'recover_to_review',
          actor: 'orchestrator-recovery',
          evidenceRefs: ['task:recovery:stale-review-checkpoint'],
          now,
        })
        task.assignedTo = 'reviewer-agent'
        task.blockReason = undefined
        task.recoveryCode = undefined
        task.notes.push({
          agentId: 'coordinator',
          role: 'recovery',
          content:
            'User restarted the project after a stale worker checkpoint blocked an already review-ready task. Reopened the task at review so reviewers can continue instead of sending it back to the worker.',
          timestamp: now,
        })
        task.updatedAt = now
        queue.lastUpdated = now
        changed = true
        continue
      } else if (isRecoverableNoProgressBlocker(task)) {
        resolveRecoverableNoProgressEscalations(task, now)
        if (activeEscalations(task).length > 0) continue
        recoveryNote =
          'User restarted the project after the worker made no visible progress. Reopened the task so Guildhall can resume from the latest durable checkpoint instead of treating a recoverable no-progress stop as terminal.'
      } else if (isRecoverableSpecNoProgressBlocker(task)) {
        resolveRecoverableSpecNoProgressEscalations(task, now)
        if (activeEscalations(task).length > 0) continue
        recoveryStatus = 'exploring'
        recoveryAssignee = 'spec-agent'
        recoveryNote =
          'Guildhall reopened the project after the spec agent failed to save a durable draft. Reopened intake so Guildhall can retry from the preserved transcript notes.'
      } else if (isRecoverableBlueprintToolingBlocker(task)) {
        resolveRecoverableBlueprintToolingEscalations(task, now)
        if (activeEscalations(task).length > 0) continue
        recoveryRole = 'foreman-inspection'
        recoveryStatus = hasUsableBlueprint(task) ? 'spec_review' : 'exploring'
        recoveryAssignee = recoveryStatus === 'exploring' ? 'spec-agent' : null
        recoveryNote =
          'Foreman inspection found a stale blueprint/tooling blocker rather than a real owner decision. Cleared the blocker so Guildhall can continue from the current plan and inspect nearby evidence instead of asking the user to repair an internal path guardrail.'
      } else if (isRecoverableTargetShapeMismatchBlocker(task)) {
        resolveRecoverableTargetShapeMismatchEscalations(task, now)
        if (activeEscalations(task).length > 0) continue
        recoveryRole = 'spec-recovery'
        recoveryStatus = 'exploring'
        recoveryAssignee = 'spec-agent'
        recoveryNote =
          'Guildhall found that the saved implementation target does not match the visible project tree. Reopened spec shaping so the planning lane can re-intake the real source structure and update the bounded work plan instead of asking the owner to resolve an internal path mismatch.'
      } else if (isRecoverableToolPathMismatchBlocker(task)) {
        resolveRecoverableToolPathMismatchEscalations(task, now)
        if (activeEscalations(task).length > 0) continue
        recoveryStatus = 'ready'
        recoveryAssignee = null
        recoveryNote =
          'User restarted the project after an old tool/path routing bug blocked this task. Reopened the worker lane so Guildhall can retry with the corrected task-worktree context.'
      } else if (isRecoverableApprovedSpecTurnLimitBlocker(task)) {
        resolveRecoverableApprovedSpecTurnLimitEscalations(task, now)
        if (activeEscalations(task).length > 0) continue
        recoveryStatus = 'exploring'
        recoveryAssignee = 'spec-agent'
        recoveryNote =
          'Guildhall corrected an older spec-agent turn-limit record that had been routed as worker recovery. The approved brief still defines the authorized outcome, so shaping resumes from source evidence without an owner decision.'
      } else if (isRecoverableTurnLimitBlocker(task)) {
        resolveRecoverableTurnLimitEscalations(task, now)
        if (activeEscalations(task).length > 0) continue
        recoveryStatus = 'ready'
        recoveryAssignee = null
        recoveryNote =
          'User restarted the project after the worker exhausted its turn budget. Reopened the task so Guildhall can continue from the current task state instead of treating the turn limit as terminal.'
      } else if (isRecoverableWorkerTimeoutBlocker(task)) {
        resolveRecoverableWorkerTimeoutEscalations(task, now)
        if (activeEscalations(task).length > 0) continue
        const checkpoint = await readCheckpoint(this.opts.config.memoryDir, task.id).catch(() => null)
        recoveryNote = checkpoint
          ? 'User restarted the project after the worker timed out before mutating the likely target file. Reopened the task from the latest recovery checkpoint so Guildhall can retry the worker lane from durable context instead of treating an internal execution miss as owner judgment.'
          : 'User restarted the project after the worker timed out before mutating the likely target file. Reopened the task so Guildhall can retry the worker lane from the current task plan instead of treating an internal execution miss as owner judgment.'
      } else if (isRecoverableProviderNoProgressTimeoutBlocker(task)) {
        const taskWorktreePath = task.worktreePath?.trim() ?? ''
        const dirtyTaskWorktree =
          taskWorktreePath.length > 0 &&
          !(await this.gitDriver.isClean(resolveRuntimePath(taskWorktreePath)))
        const dirtyTaskFiles = dirtyTaskWorktree ? await this.changedFilesForTask(task) : []
        const likelyTaskFiles = resolveLikelyTaskFiles(task)
        const hasInScopeDirtyProgress = dirtyTaskFiles.some((file) =>
          this.fileMatchesLikelyTarget(file, likelyTaskFiles, taskWorktreePath),
        )
        if (dirtyTaskFiles.length > 0 && !hasInScopeDirtyProgress) {
          const discarded = await this.discardOutOfScopeTaskWorktree(task)
          if (!discarded) continue
          const classification: FailureClassification = {
            class: 'provider_unavailable',
            confidence: 'high',
            evidence: [{
              kind: 'task',
              summary: 'Guildhall discarded an out-of-scope disposable task sandbox before retrying.',
              ref: task.blockReason ?? 'worker timeout',
            }],
            scope: 'task',
            safePlaybooks: ['retry_current_task_context'],
            needsHuman: false,
          }
          const recoveryPlan = resolveRecoveryPlan({
            taskId: task.id,
            classification,
            notes: task.notes,
          })
          resolveRecoverableProviderNoProgressTimeoutEscalations(
            task,
            now,
            'Superseded after Guildhall discarded a stale out-of-scope task sandbox before retrying.',
          )
          if (activeEscalations(task).length > 0) continue
          appendFailureClassificationNote(task, classification, {
            agentId: 'coordinator',
            timestamp: now,
          })
          appendRecoveryPlaybookNote(task, recoveryPlan, {
            agentId: 'coordinator',
            timestamp: now,
            status: 'started',
            summary:
              'Guildhall discarded a stale task sandbox and will retry this task from its approved scope instead of resuming unrelated retained work.',
          })
          recoveryRole = 'workspace-recovery'
          recoveryNote =
            'Guildhall repaired a stale task workspace before retrying this work. The task stays in automation and will restart from its approved scope.'
        } else if (hasInScopeDirtyProgress) {
          const classification: FailureClassification = {
            class: 'model_tool_use_failure',
            confidence: 'medium',
            evidence: [{
              kind: 'task',
              summary: 'Worker timeout was stale; the task worktree now contains partial output.',
              ref: task.blockReason ?? 'worker timeout',
            }],
            scope: 'task',
            safePlaybooks: ['retry_current_task_context'],
            needsHuman: false,
          }
          const recoveryPlan = resolveRecoveryPlan({
            taskId: task.id,
            classification,
            notes: task.notes,
          })
          resolveRecoverableProviderNoProgressTimeoutEscalations(
            task,
            now,
            'Superseded after Guildhall found dirty task-worktree progress, so the old no-output timeout is no longer the current state.',
          )
          if (activeEscalations(task).length > 0) continue
          appendFailureClassificationNote(task, classification, {
            agentId: 'coordinator',
            timestamp: now,
          })
          appendRecoveryPlaybookNote(task, recoveryPlan, {
            agentId: 'coordinator',
            timestamp: now,
            status: 'started',
            summary:
              'Guildhall reopened a stale no-output worker timeout after finding dirty task-worktree progress. The task stays in automation so Guildhall can continue from the saved partial output instead of claiming there was no visible work.',
          })
          recoveryRole = 'recovery'
          recoveryNote =
            'Guildhall found current task-worktree changes after a stale no-output timeout. It is preserving that partial worker output and keeping the task in automation instead of asking the owner to debug an internal execution miss.'
        } else {
          const classification: FailureClassification = {
            class: 'provider_unavailable',
            confidence: 'medium',
            evidence: [{
              kind: 'task',
              summary: 'Worker timed out before producing visible progress.',
              ref: task.blockReason ?? 'worker timeout',
            }],
            scope: 'task',
            safePlaybooks: ['retry_current_task_context'],
            needsHuman: false,
          }
          const recoveryPlan = resolveRecoveryPlan({
            taskId: task.id,
            classification,
            notes: task.notes,
          })
          resolveRecoverableProviderNoProgressTimeoutEscalations(task, now)
          if (activeEscalations(task).length > 0) continue
          appendFailureClassificationNote(task, classification, {
            agentId: 'coordinator',
            timestamp: now,
          })
          appendRecoveryPlaybookNote(task, recoveryPlan, {
            agentId: 'coordinator',
            timestamp: now,
            status: 'started',
            summary:
              'Guildhall reopened a stale no-output worker timeout as provider/runtime recovery instead of asking the owner to choose a retry or provider switch.',
          })
          recoveryRole = 'provider-recovery'
          recoveryNote =
            'Guildhall reopened a stale no-output worker timeout as provider/runtime recovery. The task stays in automation so Guildhall can retry from the current task context or route to another provider lane without asking the owner to debug internal execution.'
        }
      } else if (
        reviewVerificationRecovery ||
        await this.isRecoverableSelfAuthoredVerificationBlockedTask(task)
      ) {
        const checkpoint = await readCheckpoint(this.opts.config.memoryDir, task.id).catch(() => null)
        const touchedFiles = checkpoint?.filesTouched?.length
          ? checkpoint.filesTouched
          : await this.changedFilesForTask(task)
        resolveRecoverableSelfAuthoredVerificationEscalations(task, checkpoint, now, touchedFiles)
        if (activeEscalations(task).length > 0) continue
        recoveryNote =
          'User restarted the project after the worker raised a blocker for its own verification confusion. Reopened the task so Guildhall can rerun the focused verification and keep the decision in automation instead of treating it as a human ambiguity.'
      } else if (isRecoverableInfraOnlyMaxRevisionBlocker(task)) {
        resolveRecoverableMaxRevisionEscalations(
          task,
          now,
          'Superseded after non-actionable reviewer failures stopped counting as substantive rejection.',
        )
        if (activeEscalations(task).length > 0) continue
        transitionTaskStatus({
          task,
          event: 'recover_to_review',
          actor: 'orchestrator-recovery',
          evidenceRefs: ['task:recovery:infra-only-max-revisions'],
          now,
        })
        task.assignedTo = 'reviewer-agent'
        task.blockReason = undefined
        task.recoveryCode = undefined
        task.notes.push({
          agentId: 'coordinator',
          role: 'recovery',
          content:
            'User restarted the project after non-actionable reviewer failures incorrectly counted as hard rejection. Reopened the task at review so Guildhall can re-run fan-out with the corrected aggregation rules.',
          timestamp: now,
        })
        task.updatedAt = now
        queue.lastUpdated = now
        changed = true
        continue
      } else if (
        (task.recoveryCode === 'max_revisions_actionable' ||
          hasActiveEscalationRecoveryCode(task, 'max_revisions_actionable')) &&
        hasPriorAllClearLlmReview(task)
      ) {
        resolveRecoverableMaxRevisionEscalations(
          task,
          now,
          'Superseded after an earlier LLM review recorded all rubric checks as yes with no failing signals.',
        )
        if (activeEscalations(task).length > 0) continue
        transitionTaskStatus({
          task,
          event: 'recover_to_review',
          actor: 'orchestrator-recovery',
          evidenceRefs: ['task:recovery:prior-all-clear-max-revisions'],
          now,
        })
        task.assignedTo = 'reviewer-agent'
        task.blockReason = undefined
        task.recoveryCode = undefined
        task.notes.push({
          agentId: 'coordinator',
          role: 'recovery',
          content:
            'User restarted the project after Guildhall hit the review revision cap despite an earlier all-clear LLM review. A newer revision still supersedes that approval, so Guildhall reopened review for a fresh typed verdict before gate check.',
          timestamp: now,
        })
        task.updatedAt = now
        queue.lastUpdated = now
        changed = true
        continue
      } else if (isRecoverableActionableMaxRevisionBlocker(task)) {
        resolveRecoverableMaxRevisionEscalations(
          task,
          now,
          'Superseded after the project was explicitly resumed for another revision cycle.',
        )
        if (activeEscalations(task).length > 0) continue
        recoveryNote =
          'User restarted the project after Guildhall hit the review revision cap. Reopened the task so the worker can address the latest substantive review feedback instead of treating that cap as terminal.'
      } else if (task.recoveryCode === 'task_worktree_exists') {
        recoveryNote =
          'User restarted the project after Guildhall had already created the task branch. Reopened the task so Guildhall can attach that existing branch to a task worktree and continue.'
      } else {
        continue
      }
      transitionTaskStatus({
        task,
        event: recoveryEventForStatus(recoveryStatus, task.status),
        actor: 'orchestrator-recovery',
        evidenceRefs: [`task:recovery:${recoveryStatus}`],
        now,
      })
      task.assignedTo = recoveryAssignee
      const recoveryCode = task.recoveryCode
      task.blockReason = undefined
      task.recoveryCode = undefined
      task.notes.push({
        agentId: 'coordinator',
        role: recoveryRole,
        structured: {
          event: recoveryCode === 'spec_no_progress'
            ? 'spec_draft_recovery'
            : 'recovery_checkpoint_direction',
          ...(recoveryCode ? { recoveryCode } : {}),
        },
        content: recoveryNote,
        timestamp: now,
      })
      task.updatedAt = now
      changed = true
    }
    if (!changed) return queue
    queue.lastUpdated = now
    await this.writeQueue(queue)
    return queue
  }

  private repairRecoverableStaleGateCheckTasks(queue: TaskQueue): { changed: boolean } {
    let changed = false
    const now = this.now()
    for (const task of queue.tasks) {
      if (!isRecoverableStaleGateFailureBlocker(task)) continue
      resolveRecoverableStaleGateFailureEscalations(task, now)
      if (activeEscalations(task).length > 0) continue
      task.blockReason = undefined
      task.assignedTo = 'gate-checker-agent'
      task.notes.push({
        agentId: 'coordinator',
        role: 'recovery',
        content:
          'Guildhall recognized a stale gate failure rather than an owner decision. Reopened gate check so the provider/gate lane can retry without surfacing an internal blocker.',
        timestamp: now,
      })
      task.updatedAt = now
      changed = true
    }
    if (changed) queue.lastUpdated = now
    return { changed }
  }

  private reconcileCompletedTaskEvidence(queue: TaskQueue): { changed: boolean } {
    let changed = false
    const now = this.now()
    for (const task of queue.tasks) {
      if (task.status !== 'done') continue
      let taskChanged = false
      for (const criterion of task.acceptanceCriteria) {
        const normalizedCommand = normalizeRunRecordJsonSelectionCommand(criterion.command ?? '')
        if (normalizedCommand && normalizedCommand !== criterion.command) {
          criterion.command = normalizedCommand
          taskChanged = true
        }
      }
      const latestHardGates = latestHardGateResults(task)
      if (latestHardGates.length > 0 && latestHardGates.every((gate) => gate.passed)) {
        const passedHardGateIds = new Set(latestHardGates.map((gate) => gate.gateId))
        for (const criterion of task.acceptanceCriteria) {
          if (
            passedHardGateIds.has(criterion.id) ||
            criterion.verifiedBy !== 'automated' ||
            !criterion.command?.trim()
          ) {
            if (!criterion.met) {
              criterion.met = true
              taskChanged = true
            }
          }
        }
      }
      if (!taskChanged) continue
      const alreadyRecorded = task.notes.some((note) =>
        note.agentId === 'coordinator' &&
        note.role === 'evidence-repair' &&
        note.structured?.event === 'completed_task_proof_normalized',
      )
      if (!alreadyRecorded) {
        task.notes.push({
          agentId: 'coordinator',
          role: 'evidence-repair',
          structured: {
            event: 'completed_task_proof_normalized',
          },
          content:
            'Guildhall normalized completed task proof evidence so displayed acceptance commands and met flags match the recorded passing gates.',
          timestamp: now,
        })
      }
      task.updatedAt = now
      changed = true
    }
    if (changed) queue.lastUpdated = now
    return { changed }
  }

  private async isRecoverableSelfAuthoredVerificationBlockedTask(task: Task): Promise<boolean> {
    const checkpoint = await readCheckpoint(this.opts.config.memoryDir, task.id).catch(() => null)
    const touchedFiles = checkpoint?.filesTouched?.length
      ? checkpoint.filesTouched
      : await this.changedFilesForTask(task)
    return isRecoverableSelfAuthoredVerificationBlocker(task, checkpoint, touchedFiles)
  }

  private async recoverDirtyRepoIntoTaskBranch(input: {
    task: Task
    worktreeMode: WorktreeMode
    repoRoot: string
    baseBranch: string
  }): Promise<{ recovered: false } | { recovered: true; branchName: string; commitSha?: string }> {
    const { task, worktreeMode, repoRoot, baseBranch } = input
    if (!this.hasGuildhallOwnershipTrail(task)) return { recovered: false }
    const branchName = task.branchName ?? computeBranchName(task, worktreeMode)
    const checkpoint = await this.gitDriver.checkpointDirtyWork(repoRoot, {
      branch: branchName,
      baseBranch,
      commitMessage: `chore(guildhall): checkpoint shared-checkout work for ${task.id}`,
    })
    if (!checkpoint.ok) return { recovered: false }
    return {
      recovered: true,
      branchName,
      ...(checkpoint.commitSha ? { commitSha: checkpoint.commitSha } : {}),
    }
  }

  private async maybeAutoCommitCompletedTaskWork(task: Task): Promise<{
    ok: boolean
    detail?: string
  }> {
    const hasIsolatedLandingBranch =
      typeof task.worktreePath === 'string' && task.worktreePath.trim().length > 0 &&
      typeof task.branchName === 'string' && task.branchName.trim().length > 0 &&
      typeof task.baseBranch === 'string' && task.baseBranch.trim().length > 0
    const policy = effectiveGitStoryPolicy({
      workspacePath: this.opts.config.workspacePath,
      workspaceProjectPath: this.opts.config.projectPath,
      ...(this.opts.config.gitStory ? { workspaceGitStory: this.opts.config.gitStory } : {}),
      workspaceProjects: this.workspaceProjectsForTaskResolution(),
      task,
    })
    if (policy.commit !== 'auto' && !hasIsolatedLandingBranch) return { ok: true }
    const repoRoot =
      typeof task.worktreePath === 'string' && task.worktreePath.trim().length > 0
        ? task.worktreePath.trim()
        : this.resolveEffectiveTaskProjectPath(task)
    const status = await this.gitDriver.statusSummary(repoRoot)
    if (status.clean) return { ok: true }
    const result = await this.gitDriver.commitAll(
      repoRoot,
      buildCommitStoryMessage({ task, status }),
    )
    if (!result.ok) return { ok: false, detail: result.detail }
    task.notes.push({
      agentId: 'coordinator',
      role: 'git-story',
      content:
        `Auto-committed completed task work${result.commitSha ? ` at ${result.commitSha}` : ''} ` +
        (policy.commit === 'auto'
          ? 'because project Git Story policy sets commit=auto.'
          : 'because isolated task work must be committed before Guildhall can land and remove the worktree.'),
      timestamp: this.now(),
    })
    task.updatedAt = this.now()
    return { ok: true }
  }

  /**
   * Repair older/external task transitions that wrote `status=done` before
   * the accepted work was landed. A done task with an isolated worktree but no
   * merge record is not actually done yet: commit any dirty snapshot, land the
   * branch, then clean up the disposable worktree.
   */
  private async reconcileCompletedTaskLanding(queue: TaskQueue): Promise<{ changed: boolean }> {
    let changed = false
    const worktreeMode = await this.resolveWorktreeModeSafe()
    const landingStrategy = await this.resolveLandingStrategySafe()
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    const runtimeStore = await readTaskRuntimeStore(projectRoot).catch(() => null)
    for (const [taskIndex, queuedTask] of queue.tasks.entries()) {
      // The queue is a compact dispatch projection. Completion summaries and
      // merge evidence live in the authoritative task state, so landing must
      // hydrate the candidate before deciding whether to dispatch anything.
      let task = queuedTask
      if (queuedTask.status !== 'done') {
        task = await this.hydrateEffectiveTaskForDispatch(queuedTask)
        queue.tasks[taskIndex] = task
      }
      const completedButActive =
        task.status === 'in_progress' &&
        task.doneSummaryBundle?.status === 'done'
      const proofRecovery = runtimeStore?.tasks[task.id]?.proofRecovery
      const reopenedAt = proofRecovery?.reopenedAt ? Date.parse(proofRecovery.reopenedAt) : NaN
      const doneSummaryCompletedAt = task.doneSummaryBundle?.completedAt
        ? Date.parse(task.doneSummaryBundle.completedAt)
        : NaN
      const activeProofRecovery =
        completedButActive &&
        Number.isFinite(reopenedAt) &&
        (!Number.isFinite(doneSummaryCompletedAt) || doneSummaryCompletedAt <= reopenedAt)
      if (activeProofRecovery) continue
      const completionNoLongerProven =
        completedButActive &&
        taskDoneButProofMissing({ ...task, status: 'done' })
      if (completionNoLongerProven && task.doneSummaryBundle) {
        const now = this.now()
        task.doneSummaryBundle = {
          ...task.doneSummaryBundle,
          status: 'reopened',
          reopenedAt: now,
          reopenReason: 'Current typed proof no longer satisfies the task contract; the prior completion is historical evidence only.',
          createdAt: now,
          createdBy: 'completion-authority-repair',
        }
        task.completedAt = undefined
        task.notes.push({
          agentId: 'completion-authority-repair',
          role: 'evidence-repair',
          content: 'Kept the task open because its current typed proof does not satisfy every acceptance criterion.',
          timestamp: now,
        })
        task.updatedAt = now
        queue.lastUpdated = now
        changed = true
        continue
      }
      if (completedButActive) {
        const now = this.now()
        task.status = 'done'
        task.assignedTo = null
        task.completedAt = task.completedAt ?? task.doneSummaryBundle?.completedAt ?? now
        if (
          task.mergeRecord?.result === 'skipped' &&
          task.worktreePath?.trim() &&
          task.branchName?.trim() &&
          task.baseBranch?.trim()
        ) {
          task.mergeRecord = undefined
        }
        delete task.blockReason
        delete task.recoveryCode
        task.notes.push({
          agentId: 'landing-reconciliation',
          role: 'git-story',
          content: 'Moved completed work back into landing from durable done-summary evidence instead of dispatching another worker pass.',
          timestamp: now,
        })
        task.updatedAt = now
        queue.lastUpdated = now
        changed = true
      }

      const alreadyLanded =
        task.status === 'in_progress' &&
        task.mergeRecord?.result === 'merged' &&
        !taskDoneButProofMissing({ ...task, status: 'done' }) &&
        currentLifecycleForTask(task) === null &&
        !(
          task.doneSummaryBundle?.status === 'reopened' &&
          typeof task.doneSummaryBundle.reopenedAt === 'string' &&
          typeof task.mergeRecord.mergedAt === 'string' &&
          Date.parse(task.doneSummaryBundle.reopenedAt) >= Date.parse(task.mergeRecord.mergedAt)
        )
      if (alreadyLanded) {
        const now = this.now()
        task.status = 'done'
        task.assignedTo = null
        task.completedAt = task.completedAt ?? task.mergeRecord?.mergedAt ?? now
        if (Array.isArray(task.escalations)) {
          task.escalations = task.escalations.map(escalation => escalation.resolvedAt
            ? escalation
            : {
                ...escalation,
                resolvedAt: now,
                resolvedBy: 'landing-reconciliation',
                resolution: 'Resolved because durable merge evidence shows the task already landed.',
              })
        }
        delete task.blockReason
        task.notes.push({
          agentId: 'landing-reconciliation',
          role: 'git-story',
          content: 'Marked task done from durable merge evidence after canonical status drifted back to active work.',
          timestamp: now,
        })
        task.updatedAt = now
        queue.lastUpdated = now
        changed = true
        await this.maybeCleanupWorktree(task, worktreeMode)
        continue
      }

      const hasAutoCommitLandingFailure =
        task.status === 'blocked' &&
        task.recoveryCode === 'auto_commit_landing'
      if (task.status !== 'done' && !hasAutoCommitLandingFailure) continue
      if (task.mergeRecord && !hasAutoCommitLandingFailure) continue
      if (!task.worktreePath?.trim()) continue
      if (!task.branchName?.trim() || !task.baseBranch?.trim()) {
        transitionTaskStatus({
          task,
          event: 'landing_failed',
          actor: 'landing-reconciliation',
          evidenceRefs: ['task:landing:missing-branch-metadata'],
          now: this.now(),
        })
        task.assignedTo = null
        task.blockReason =
          'Guildhall found completed work in a task worktree, but branch metadata is missing, so it cannot safely land the work.'
        task.recoveryCode = 'missing_branch_metadata'
        task.updatedAt = this.now()
        queue.lastUpdated = this.now()
        changed = true
        continue
      }

      if (hasAutoCommitLandingFailure) {
        task.status = 'done'
        task.assignedTo = null
        delete task.blockReason
        delete task.recoveryCode
        task.mergeRecord = undefined
        task.notes.push({
          agentId: 'coordinator',
          role: 'git-story',
          content: 'Retrying landing for completed work after a previous auto-commit failure.',
          timestamp: this.now(),
        })
      }

      const autoCommit = await this.maybeAutoCommitCompletedTaskWork(task)
      if (!autoCommit.ok) {
        transitionTaskStatus({
          task,
          event: 'landing_failed',
          actor: 'landing-reconciliation',
          evidenceRefs: ['task:landing:auto-commit-failed'],
          now: this.now(),
        })
        task.assignedTo = null
        task.recoveryCode = 'auto_commit_landing'
        task.blockReason =
          `Guildhall found completed work in a task worktree, but could not commit it before landing: ${autoCommit.detail ?? 'unknown git error'}.`
        task.mergeRecord = {
          fromBranch: task.branchName,
          toBranch: task.baseBranch,
          strategy: landingStrategy,
          result: 'skipped',
          mergedAt: this.now(),
          detail: 'auto-commit failed while reconciling completed task landing',
        }
        task.updatedAt = this.now()
        queue.lastUpdated = this.now()
        changed = true
        continue
      }

      const effectiveTaskProjectPath = this.resolveEffectiveTaskProjectPath(task)
      const mergeOutcome = await dispatchMerge({
        task,
        policy: landingStrategy,
        projectPath: effectiveTaskProjectPath,
        memoryDir: this.opts.config.memoryDir,
        gitDriver: this.gitDriver,
        now: this.now(),
      })
      task.mergeRecord = mergeOutcome.record
      if (mergeOutcome.transitionReceipt) {
        task.status = mergeOutcome.transitionReceipt.to
      }
      if (mergeOutcome.fixupTask) appendFixupTask(queue, mergeOutcome.fixupTask, this.now())
      if (mergeOutcome.newStatus === 'done') shelveSupersededFixupTasks(queue, task.id, this.now())
      task.updatedAt = this.now()
      queue.lastUpdated = this.now()
      await upsertTaskRuntimeState(inferProjectRootFromMemoryDir(this.opts.config.memoryDir), task.id, {
        assignedTo: null,
        ...(task.status === 'done'
          ? { proofRecovery: undefined, currentLifecycle: undefined }
          : {}),
        updatedAt: task.updatedAt,
      })
      changed = true
      await this.maybeCleanupWorktree(task, worktreeMode)
    }
    return { changed }
  }

  /**
   * Manual-PR tasks intentionally keep their branch/worktree while a human
   * reviews the PR. Once the hosting provider reports that PR as merged, the
   * task can become truly done and the disposable worktree should be removed.
   */
  private async reconcilePendingPrLanding(queue: TaskQueue): Promise<{ changed: boolean }> {
    let changed = false
    const worktreeMode = await this.resolveWorktreeModeSafe()
    for (const task of queue.tasks) {
      if (task.status !== 'pending_pr') continue
      const branch = task.branchName?.trim()
      if (!branch) continue
      const effectiveTaskProjectPath = this.resolveEffectiveTaskProjectPath(task)
      const pr = await this.gitDriver
        .pullRequestForBranch(effectiveTaskProjectPath, branch)
        .catch(() => ({ ok: false as const }))
      if (!pr.ok || pr.state?.toUpperCase() !== 'MERGED') continue

      const previous = task.mergeRecord
      transitionTaskStatus({
        task,
        event: 'complete',
        actor: 'pending-pr-reconciliation',
        evidenceRefs: ['task:pr-merged'],
        now: this.now(),
        requiredEvidencePresent: true,
      })
      task.assignedTo = null
      task.mergeRecord = {
        fromBranch: previous?.fromBranch ?? branch,
        toBranch: previous?.toBranch ?? task.baseBranch ?? '<unknown>',
        strategy: previous?.strategy ?? 'manual_pr',
        result: 'merged',
        ...(previous?.commitSha ? { commitSha: previous.commitSha } : {}),
        ...(pr.url ?? previous?.prUrl ? { prUrl: pr.url ?? previous?.prUrl } : {}),
        mergedAt: this.now(),
        detail: 'PR was merged externally; Guildhall reconciled the task and cleaned up its worktree.',
      }
      task.updatedAt = this.now()
      queue.lastUpdated = this.now()
      await upsertTaskRuntimeState(inferProjectRootFromMemoryDir(this.opts.config.memoryDir), task.id, {
        assignedTo: null,
        proofRecovery: undefined,
        currentLifecycle: undefined,
        updatedAt: task.updatedAt,
      })
      changed = true
      await this.maybeCleanupWorktree(task, worktreeMode)
    }
    return { changed }
  }

  /**
   * Reconcile worktrees left behind after a successful landing. The workspace
   * overlay is also the retry marker: a failed removal leaves it intact for
   * the next tick, while successful removal clears it.
   */
  private async reconcileCompletedWorktreeCleanup(queue: TaskQueue): Promise<{ changed: boolean }> {
    let changed = false
    const worktreeMode = await this.resolveWorktreeModeSafe()
    for (const task of queue.tasks) {
      if (task.status !== 'done' || task.mergeRecord?.result !== 'merged' || !task.worktreePath?.trim()) {
        continue
      }
      if (!await this.maybeCleanupWorktree(task, worktreeMode)) continue
      task.updatedAt = this.now()
      queue.lastUpdated = task.updatedAt
      changed = true
    }
    return { changed }
  }

  /**
   * Remove only a Guildhall-owned worktree whose work has durably landed.
   * Pending PRs and recovery-bearing terminal states deliberately retain their
   * checkout; cleanup is never allowed to erase unlanded investigation work.
   */
  private async maybeCleanupWorktree(
    task: Task,
    mode: WorktreeMode,
  ): Promise<boolean> {
    if (task.status !== 'done' || task.mergeRecord?.result !== 'merged' || !task.worktreePath?.trim()) {
      return false
    }
    const effectiveTaskProjectPath = this.resolveEffectiveTaskProjectPath(task)
    try {
      await cleanupWorktreeForTerminal({
        task,
        mode: task.worktreePath?.trim() ? 'per_task' : mode,
        projectId: this.opts.config.workspaceId,
        projectPath: effectiveTaskProjectPath,
        gitDriver: this.gitDriver,
      })
      await clearTaskWorkspaceState(
        inferProjectRootFromMemoryDir(this.opts.config.memoryDir),
        task.id,
      )
      delete task.worktreePath
      delete task.branchName
      delete task.baseBranch
      return true
    } catch (err) {
      // The workspace overlay remains intact, making this a durable retry on
      // the next tick instead of a warning that vanishes into process output.
      console.warn(
        `[guildhall] worktree cleanup failed for ${task.id}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return false
    }
  }

  private async discardOutOfScopeTaskWorktree(task: Task): Promise<boolean> {
    try {
      const worktreeMode = await this.resolveWorktreeModeSafe()
      const effectiveTaskProjectPath = this.resolveEffectiveTaskProjectPath(task)
      const discarded = await discardTaskWorktreeForRecovery({
        task,
        mode: task.worktreePath?.trim() ? 'per_task' : worktreeMode,
        projectId: this.opts.config.workspaceId,
        projectPath: effectiveTaskProjectPath,
        gitDriver: this.gitDriver,
      })
      if (!discarded) return false
      await Promise.all([
        clearCheckpoint(this.opts.config.memoryDir, task.id),
        clearTaskWorkspaceState(inferProjectRootFromMemoryDir(this.opts.config.memoryDir), task.id),
      ])
      delete task.worktreePath
      delete task.branchName
      delete task.baseBranch
      delete (task as Task & { workspace?: TaskWorkspaceState }).workspace
      return true
    } catch (err) {
      console.warn(
        `[guildhall] could not discard out-of-scope worktree for ${task.id}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return false
    }
  }

  private async discardOutOfScopeTaskWorktreeBeforeDispatch(
    task: Task,
  ): Promise<ScopedTaskFileSnapshot[] | null> {
    const taskWorktreePath = task.worktreePath?.trim() ?? ''
    if (!taskWorktreePath) return null
    const changedFiles = await this.changedFilesAcrossTaskWorkspace(task)
    if (changedFiles.length === 0) return null
    const likelyTaskFiles = resolveLikelyTaskFiles(task)
    const scopedFiles = changedFiles.filter((file) =>
      this.fileMatchesLikelyTarget(file, likelyTaskFiles, taskWorktreePath),
    )
    if (scopedFiles.length === changedFiles.length) return null
    const snapshots = await this.captureScopedTaskFiles(taskWorktreePath, scopedFiles)
    const discarded = await this.discardOutOfScopeTaskWorktree(task)
    if (!discarded) {
      throw new Error(`Guildhall could not repair the stale task workspace for ${task.id}`)
    }
    return snapshots
  }

  private async changedFilesAcrossTaskWorkspace(task: Task): Promise<string[]> {
    const workingFiles = await this.changedFilesForTask(task)
    const worktreePath = task.worktreePath?.trim()
    if (!worktreePath) return workingFiles
    const baseBranch = task.baseBranch?.trim() || await this.resolveBaseBranch(
      this.resolveEffectiveTaskProjectPath(task),
    )
    try {
      const { stdout } = await execFileP('git', ['diff', '--name-only', `${baseBranch}...HEAD`], {
        cwd: resolveRuntimePath(worktreePath),
        maxBuffer: 1024 * 1024,
      })
      return uniqueStrings([
        ...workingFiles,
        ...stdout.split('\n').map(file => file.trim()).filter(file =>
          file.length > 0 && !isIgnorableCheckpointPath(file),
        ),
      ])
    } catch {
      return workingFiles
    }
  }

  private async captureScopedTaskFiles(
    worktreePath: string,
    files: readonly string[],
  ): Promise<ScopedTaskFileSnapshot[]> {
    const root = path.resolve(worktreePath)
    return await Promise.all(files.map(async file => {
      const relativePath = path.relative(root, path.resolve(root, file))
      if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        throw new Error(`Refusing to preserve a task file outside its worktree: ${file}`)
      }
      try {
        return { relativePath, contents: await fs.readFile(path.join(root, relativePath)) }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { relativePath, contents: null }
        throw err
      }
    }))
  }

  private async restoreScopedTaskFiles(
    worktreePath: string,
    snapshots: readonly ScopedTaskFileSnapshot[],
  ): Promise<void> {
    const root = path.resolve(worktreePath)
    for (const snapshot of snapshots) {
      const target = path.resolve(root, snapshot.relativePath)
      if (!target.startsWith(`${root}${path.sep}`)) {
        throw new Error(`Refusing to restore a task file outside its worktree: ${snapshot.relativePath}`)
      }
      if (snapshot.contents === null) {
        await fs.rm(target, { force: true })
      } else {
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, snapshot.contents)
      }
    }
  }

  /**
   * FR-24: serialize queue-write critical sections across concurrent fanout
   * dispatches. Each call appends `fn` to a tail promise so writes happen
   * strictly in FIFO order. Errors from `fn` propagate to the caller but do
   * not break the chain for subsequent callers.
   */
  private withQueueWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    // The queue lock is layered on top of the project-state lock. A nested
    // queue mutation must run inline; appending it to `queueWriteChain` here
    // would make it await the queue operation that is currently awaiting it.
    if (projectStateWriteLockHeld(this.tasksPath())) return fn()
    return withProjectStateWriteLock(this.tasksPath(), () => {
      const prev = this.queueWriteChain
      const current = prev.then(fn, fn)
      this.queueWriteChain = current.then(
        () => undefined,
        () => undefined,
      )
      return current
    })
  }

  /**
   * FR-24: merge orchestrator env with the slot env. Pure; used by the
   * serve layer when spawning out-of-process workers. The in-process
   * dispatch path relies on system-prompt injection instead.
   */
  slotEnvFor(task: Task, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const slot = this.slotAllocator?.getByTask(task.id)
    if (!slot) return base
    return { ...base, ...buildSlotEnv(slot, this.runtimeConfig()) }
  }

  /**
   * FR-24: read-modify-write helper that serializes against concurrent fanout
   * dispatches. The mutator receives the parsed queue, mutates it (in place
   * or by returning a replacement), and the helper persists it atomically.
   * Used by tests and by out-of-process worker shims that need to update
   * TASKS.json without racing the orchestrator's own post-dispatch writes.
   */
  updateQueueAtomically(
    mutator: (queue: TaskQueue) => Promise<TaskQueue | void> | TaskQueue | void,
  ): Promise<void> {
    return this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const next = await mutator(queue)
      await this.writeQueue(next ?? queue)
    })
  }

  private async readQueue(): Promise<TaskQueue> {
    const tasksPath = this.tasksPath()
    const snapshot = readProjectTaskQueueForMutationSync(tasksPath)
    const queue = TaskQueue.parse(snapshot.queue)
    const definitionBaseline = cloneTaskQueue(
      sanitizeTaskQueueForProjectWrite(queue).queue as TaskQueue,
    )
    this.queueRevision = snapshot.expectedQueueRevision
    this.projectRevision = snapshot.expectedProjectRevision
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    const databaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
    const tasks = await Promise.all(
      queue.tasks.map(async task => {
        // Execution decisions use the same bounded current projection as the
        // product read model. Historical evidence is for explicit detail
        // reads; asking for it here made promoted review verdicts disappear
        // after compaction and sent already-approved tasks back to workers.
        const evidenceOptions = task.status === 'review'
          ? { evidence: 'full' as const }
          : databaseAuthority
            ? { evidence: 'current' as const }
            : {}
        // EffectiveTask includes the current runtime/workspace overlays. Do
        // not pass it through the definition-only Task schema: that would
        // silently strip markers such as proofRecovery before dispatch.
        return await buildEffectiveTask(projectRoot, task, evidenceOptions) as unknown as Task
      }),
    )
    const effectiveQueue = { ...queue, tasks }
    this.effectiveQueueWriteBaseline = cloneTaskQueue(effectiveQueue as TaskQueue)
    this.queueWriteBaseline = definitionBaseline
    return effectiveQueue
  }

  private async writeQueue(queue: TaskQueue): Promise<void> {
    this.attachMissingDoneSummaries(queue)
    const tasksPath = this.tasksPath()
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    const projectId = path.basename(projectRoot)
    const expectedQueueRevision = this.queueRevision === undefined
      ? readProjectStateDatabaseQueueRevision(tasksPath)
      : this.queueRevision
    const expectedProjectRevision = this.projectRevision === undefined
      ? readProjectStateAuthorityAtBoundary(tasksPath).projectRevision
      : this.projectRevision

    const sanitized = sanitizeTaskQueueForProjectWrite(queue)
    const sanitizedQueue = sanitized.queue as TaskQueue
    const effectiveSanitizedBaseline = this.effectiveQueueWriteBaseline
      ? sanitizeTaskQueueForProjectWrite(this.effectiveQueueWriteBaseline).queue as TaskQueue
      : this.queueWriteBaseline
    const delta = singleTaskQueueDelta(effectiveSanitizedBaseline, sanitizedQueue)
    const definitionBaselineTask = delta
      ? this.queueWriteBaseline?.tasks.find(task => task.id === delta.nextTask.id)
      : undefined
    const databaseAuthority = readProjectStateDatabaseCurrentAuthorityFromTasksPath(tasksPath) === 'database'
    const updatedTaskIds = queue.tasks
      .filter(task => task.updatedAt === queue.lastUpdated)
      .map(task => task.id)
    const pointTaskId = delta?.nextTask.id ?? (updatedTaskIds.length === 1 ? updatedTaskIds[0] : undefined)
    const removed = pointTaskId
      ? sanitized.removedByTask.find(candidate => candidate.taskId === pointTaskId)
      : undefined
    const removedDelta = removed
      ? removedStateDelta(
          removed,
          this.effectiveQueueWriteBaseline?.tasks.find(candidate => candidate.id === removed.taskId),
          queue.tasks.find(candidate => candidate.id === removed.taskId),
        )
      : undefined
    if (databaseAuthority && pointTaskId && (delta || removedDelta)) {
      const evidenceAuthority = readProjectStateDatabaseTaskEvidenceAuthorityFromTasksPath(tasksPath)
      const events = removedDelta ? removedTaskEvidenceEvents(removedDelta, queue.lastUpdated) : []
      const pointResult = writePromotedTaskDetailMutation(tasksPath, pointTaskId, {
        projectId,
        projectRoot,
        lastUpdated: queue.lastUpdated,
        mutate: currentTask => {
          return delta
            ? applyDefinitionDelta(
                currentTask,
                (definitionBaselineTask ?? delta.baselineTask) as unknown as Record<string, unknown>,
                delta.nextTask as unknown as Record<string, unknown>,
                delta.baselineTask as unknown as Record<string, unknown>,
              )
            : currentTask
        },
        ...(removedDelta ? {
          mutateRuntime: (current: Record<string, unknown> | null) =>
            mergeRemovedRuntimeState(removedDelta, current, queue.lastUpdated),
          mutateWorkspace: (current: Record<string, unknown> | null) =>
            mergeRemovedWorkspaceState(removedDelta, current, queue.lastUpdated),
        } : {}),
        evidence: events.map(event => ({
          event,
          retention: TASK_EVIDENCE_RETENTION[event.kind],
          ...(evidenceAuthority === 'compressed' ? { history: 'outbox' as const } : {}),
        })),
      })
      if (pointResult) {
        if (evidenceAuthority === 'compressed') {
          await flushTaskEvidenceOutboxForTasksPath(tasksPath, pointTaskId)
        }
        this.queueRevision = pointResult.committedRevision
        this.projectRevision = pointResult.committedRevision
        this.queueWriteBaseline = cloneTaskQueue(sanitizedQueue)
        this.effectiveQueueWriteBaseline = cloneTaskQueue(queue)
        return
      }
    }

    // A runtime/evidence-only transition has no definition delta to commit.
    // Persist its dedicated overlay/evidence state without attempting an
    // aggregate definition write that the promoted boundary correctly rejects.
    if (databaseAuthority) {
      const currentSanitizedQueue = sanitizeTaskQueueForProjectWrite(
        readProjectTaskQueueSync(tasksPath),
      ).queue
      if (sameJson(currentSanitizedQueue, sanitizedQueue)) {
        throw new Error('Promoted runtime/evidence mutation could not identify one updated task; refusing a split current-state write')
      }
      // The dispatched agent may commit its transition through the shared
      // task boundary. When this snapshot contains no orchestrator-authored
      // definition or overlay delta, the newer authoritative row wins; do not
      // replay the pre-dispatch aggregate over it.
      const removedDeltas = sanitized.removedByTask.map(removed => removedStateDelta(
        removed,
        this.effectiveQueueWriteBaseline?.tasks.find(candidate => candidate.id === removed.taskId),
        queue.tasks.find(candidate => candidate.id === removed.taskId),
      ))
      const hasOverlayDelta = removedDeltas.some(removed => Object.keys(removed.removedEvidence).length > 0)
      const currentAuthority = readProjectStateAuthorityAtBoundary(tasksPath)
      const authoritativeDefinitionChangedSinceRead =
        (expectedQueueRevision !== null && currentAuthority.queueRevision !== expectedQueueRevision) ||
        (expectedProjectRevision !== null && currentAuthority.projectRevision !== expectedProjectRevision)
      if (!delta && !hasOverlayDelta && authoritativeDefinitionChangedSinceRead) {
        await this.readQueue()
        return
      }
    }

    if (databaseAuthority) {
      const evidenceAuthority = readProjectStateDatabaseTaskEvidenceAuthorityFromTasksPath(tasksPath)
      const removedDeltas = sanitized.removedByTask.map(removed => removedStateDelta(
        removed,
        this.effectiveQueueWriteBaseline?.tasks.find(candidate => candidate.id === removed.taskId),
        queue.tasks.find(candidate => candidate.id === removed.taskId),
      ))
      const taskEvidence = removedDeltas.flatMap(removed =>
        removedTaskEvidenceEvents(removed, queue.lastUpdated).map(event => ({
          event,
          retention: TASK_EVIDENCE_RETENTION[event.kind],
          ...(evidenceAuthority === 'compressed' ? { history: 'outbox' as const } : {}),
        })),
      )
      const taskRuntimes = removedDeltas.flatMap(removed => {
        const state = mergeRemovedRuntimeState(removed, null, queue.lastUpdated)
        return state ? [{
          taskId: removed.taskId,
          updatedAt: queue.lastUpdated,
          payload: state,
        }] : []
      })
      const taskWorkspaces = removedDeltas.flatMap(removed => {
        const state = mergeRemovedWorkspaceState(removed, null, queue.lastUpdated)
        return state
          ? [{ taskId: removed.taskId, updatedAt: queue.lastUpdated, payload: state }]
          : []
      })
      writeProjectTaskQueueWithSummary(tasksPath, sanitizedQueue, {
        projectId,
        projectRoot,
        taskDefinitionsAlreadySanitized: true,
        ...(expectedQueueRevision !== null ? { expectedQueueRevision } : {}),
        ...(expectedProjectRevision !== null ? { expectedProjectRevision } : {}),
        taskEvidence,
        taskRuntimes,
        taskWorkspaces,
        projectionTasks: queue.tasks,
      })
      if (evidenceAuthority === 'compressed') await flushTaskEvidenceOutboxForTasksPath(tasksPath)
      const authority = readProjectStateAuthorityAtBoundary(tasksPath)
      this.queueRevision = authority.queueRevision
      this.projectRevision = authority.projectRevision
      this.queueWriteBaseline = cloneTaskQueue(sanitizedQueue)
      this.effectiveQueueWriteBaseline = cloneTaskQueue(queue)
      return
    }

    const result = writeProjectTaskQueue(tasksPath, queue, {
      projectId,
      ...(expectedQueueRevision !== null ? { expectedQueueRevision } : {}),
    })
    this.queueRevision = readProjectStateDatabaseQueueRevision(tasksPath)
    this.projectRevision = readProjectStateAuthorityAtBoundary(tasksPath).projectRevision
    this.queueWriteBaseline = cloneTaskQueue(result.queue as TaskQueue)
    this.effectiveQueueWriteBaseline = cloneTaskQueue(queue)
    await this.persistSanitizedTaskState(result.removedByTask)
  }

  private async persistSanitizedTaskState(
    removedByTask: Array<{ taskId: string; removedFields: string[]; removedEvidence: Record<string, unknown> }>,
  ): Promise<void> {
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    for (const removed of removedByTask) {
      const updatedAt = this.now()
      const currentRuntime = (await readTaskRuntimeStore(projectRoot)).tasks[removed.taskId]
      const runtimePatch: Parameters<typeof upsertTaskRuntimeState>[2] = { updatedAt }
      const workspacePatch: Parameters<typeof upsertTaskWorkspaceState>[2] = { updatedAt }
      const evidence = removed.removedEvidence
      if ('assignedTo' in evidence) {
        runtimePatch.assignedTo = typeof evidence.assignedTo === 'string' ? evidence.assignedTo : null
      }
      if (typeof evidence.revisionCount === 'number') {
        runtimePatch.revisionCount = Math.max(currentRuntime?.revisionCount ?? 0, evidence.revisionCount)
      }
      if (typeof evidence.remediationAttempts === 'number') {
        runtimePatch.remediationAttempts = Math.max(currentRuntime?.remediationAttempts ?? 0, evidence.remediationAttempts)
      }
      const rejectedRuntimeFields: string[] = []
      const runtimeField = <K extends keyof TaskRuntimeState>(field: K, value: unknown): TaskRuntimeState[K] | undefined => {
        const parsed = parseTaskRuntimeField(removed.taskId, currentRuntime, runtimePatch, field, value)
        if (!parsed.accepted) {
          rejectedRuntimeFields.push(String(field))
          return undefined
        }
        return parsed.value
      }
      if ('retryWindow' in evidence) {
        const retryWindow = runtimeField('retryWindow', evidence.retryWindow)
        if (retryWindow !== undefined) runtimePatch.retryWindow = retryWindow
      }
      if (typeof evidence.handoffStep === 'number') {
        runtimePatch.handoffStep = evidence.handoffStep
      }
      if (evidence.proofRecovery && typeof evidence.proofRecovery === 'object' && !Array.isArray(evidence.proofRecovery)) {
        const proofRecovery = runtimeField('proofRecovery', evidence.proofRecovery)
        if (proofRecovery !== undefined) runtimePatch.proofRecovery = proofRecovery
      }
      if (evidence.workerRecovery && typeof evidence.workerRecovery === 'object' && !Array.isArray(evidence.workerRecovery)) {
        const workerRecovery = runtimeField('workerRecovery', evidence.workerRecovery)
        if (workerRecovery !== undefined) runtimePatch.workerRecovery = workerRecovery
      }
      if (Array.isArray(evidence.escalations)) {
        runtimePatch.openEscalationIds = evidence.escalations
          .filter((item): item is { id: string; resolvedAt?: string } =>
            typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string',
          )
          .filter(item => !item.resolvedAt)
          .map(item => item.id)
      }
      if (Array.isArray(evidence.agentIssues)) {
        runtimePatch.openIssueIds = evidence.agentIssues
          .filter((item): item is { id: string; resolvedAt?: string } =>
            typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string',
          )
          .filter(item => !item.resolvedAt)
          .map(item => item.id)
      }
      if (evidence.shelveReason && typeof evidence.shelveReason === 'object' && !Array.isArray(evidence.shelveReason)) {
        const shelveReason = runtimeField('shelveReason', evidence.shelveReason)
        if (shelveReason !== undefined) runtimePatch.shelveReason = shelveReason
      }
      if (typeof evidence.worktreePath === 'string') workspacePatch.worktreePath = evidence.worktreePath
      if (typeof evidence.branchName === 'string') workspacePatch.branchName = evidence.branchName
      if (typeof evidence.baseBranch === 'string') workspacePatch.baseBranch = evidence.baseBranch

      if (rejectedRuntimeFields.length > 0) {
        console.warn(
          `[guildhall] rejected malformed transient runtime fields for ${removed.taskId}: ${[...new Set(rejectedRuntimeFields)].join(', ')}`,
        )
      }

      if (Object.keys(runtimePatch).length > 1) {
        await upsertTaskRuntimeState(projectRoot, removed.taskId, runtimePatch)
      }
      if (Object.keys(workspacePatch).length > 1) {
        await upsertTaskWorkspaceState(projectRoot, removed.taskId, workspacePatch)
      }

      await this.appendRemovedEvidence(projectRoot, removed.taskId, evidence)
    }
  }

  private async appendRemovedEvidence(
    projectRoot: string,
    taskId: string,
    evidence: Record<string, unknown>,
  ): Promise<void> {
    const stablePayloadKey = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(stablePayloadKey).join(',')}]`
      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>
        return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stablePayloadKey(record[key])}`).join(',')}}`
      }
      return JSON.stringify(value)
    }
    const appendMany = async (field: string, kind: Parameters<typeof appendTaskEvidence>[2]['kind'], items: unknown[], timestampField: string): Promise<void> => {
      const existing = await readTaskEvidence(projectRoot, taskId, { kind })
      const existingIds = new Set(existing.map(event => event.id))
      const existingPayloads = new Set(existing.map(event => stablePayloadKey(event.payload)))
      for (const [index, item] of items.entries()) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
        const payload = item as Record<string, unknown>
        const payloadKey = stablePayloadKey(payload)
        if (existingPayloads.has(payloadKey)) continue
        const recordedAt = typeof payload[timestampField] === 'string' ? payload[timestampField] : this.now()
        const baseId = typeof payload.id === 'string'
          ? `${field}-${taskId}-${payload.id}-${recordedAt.replace(/[^0-9A-Za-z]/g, '')}`
          : `${field}-${taskId}-${recordedAt.replace(/[^0-9A-Za-z]/g, '')}-${index + 1}`
        let id = baseId
        let suffix = 2
        while (existingIds.has(id)) {
          id = `${baseId}-${suffix}`
          suffix += 1
        }
        await appendTaskEvidence(projectRoot, taskId, { id, kind, recordedAt, payload })
        existingIds.add(id)
        existingPayloads.add(payloadKey)
      }
    }
    if (Array.isArray(evidence.notes)) await appendMany('note', 'note', evidence.notes, 'timestamp')
    if (Array.isArray(evidence.gateResults)) await appendMany('gate', 'gate_result', evidence.gateResults, 'checkedAt')
    if (Array.isArray(evidence.reviewVerdicts)) await appendMany('review', 'review_verdict', evidence.reviewVerdicts, 'recordedAt')
    if (Array.isArray(evidence.adjudications)) await appendMany('adjudication', 'adjudication', evidence.adjudications, 'decidedAt')
    if (Array.isArray(evidence.escalations)) await appendMany('escalation', 'escalation', evidence.escalations, 'raisedAt')
    if (Array.isArray(evidence.agentIssues)) await appendMany('issue', 'agent_issue', evidence.agentIssues, 'raisedAt')
    if (evidence.mergeRecord && typeof evidence.mergeRecord === 'object' && !Array.isArray(evidence.mergeRecord)) {
      const payload = evidence.mergeRecord as Record<string, unknown>
      const recordedAt = typeof payload.mergedAt === 'string' ? payload.mergedAt : this.now()
      const id = `merge-${taskId}-${recordedAt.replace(/[^0-9A-Za-z]/g, '')}`
      const existingIds = new Set((await readTaskEvidence(projectRoot, taskId, { kind: 'merge_record' })).map(event => event.id))
      if (existingIds.has(id)) return
      await appendTaskEvidence(projectRoot, taskId, {
        id,
        kind: 'merge_record',
        recordedAt,
        payload,
      })
    }
    if (evidence.doneSummaryBundle && typeof evidence.doneSummaryBundle === 'object' && !Array.isArray(evidence.doneSummaryBundle)) {
      await appendMany('completion', 'completion_summary', [evidence.doneSummaryBundle], 'createdAt')
    }
  }

  private attachMissingDoneSummaries(queue: TaskQueue): void {
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    for (const task of queue.tasks) {
      if (task.status !== 'done' || task.doneSummaryBundle) continue
      const gitStory = (task as unknown as { gitStory?: { samplePaths?: string[] } }).gitStory
      task.doneSummaryBundle = buildDoneTaskSummaryBundle({
        task,
        changedFiles: gitStory?.samplePaths,
        transcriptRef: {
          scope: 'local_history',
          collection: 'transcripts',
          id: task.id,
          path: getProjectTranscriptPath(projectRoot, 'exploring', task.id),
          contentType: 'text/markdown',
        },
        createdAt: task.completedAt ?? task.updatedAt ?? this.now(),
        createdBy: 'orchestrator',
      })
    }
  }

  private async maybeWriteReviewPacket(task: Task): Promise<void> {
    if (!new Set<TaskStatus>(['review', 'gate_check', ...ONE_TASK_STOP_STATUSES]).has(task.status)) return

    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    const packetTask = await buildEffectiveTask(projectRoot, task, { evidence: 'full' }) as unknown as Task
    const packetPath = getProjectTaskReviewPacketPath(projectRoot, task.id)
    const taskDir = path.dirname(packetPath)
    await fs.mkdir(taskDir, { recursive: true })
    writeManagedTextFileSync(
      packetPath,
      await this.renderReviewPacket(packetTask),
    )
  }

  private async reconcileReviewTaskFromWorkerProof(task: Task): Promise<void> {
    const before = JSON.stringify(task.acceptanceCriteria ?? [])
    reconcileAcceptanceCriteriaFromLatestWorkerSelfCritique(task)
    if (JSON.stringify(task.acceptanceCriteria ?? []) === before) return

    await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const liveTask = queue.tasks.find((candidate) => candidate.id === task.id)
      if (!liveTask || liveTask.status !== 'review') return
      const liveBefore = JSON.stringify(liveTask.acceptanceCriteria ?? [])
      reconcileAcceptanceCriteriaFromLatestWorkerSelfCritique(liveTask)
      if (JSON.stringify(liveTask.acceptanceCriteria ?? []) === liveBefore) return
      liveTask.notes.push({
        agentId: 'coordinator',
        role: 'review-reconciliation',
        content:
          'Guildhall reconciled acceptance criteria from the latest worker self-critique before review so reviewer state matches the durable proof packet.',
        timestamp: this.now(),
      })
      liveTask.updatedAt = this.now()
      queue.lastUpdated = liveTask.updatedAt
      await this.writeQueue(queue)
      task.acceptanceCriteria = liveTask.acceptanceCriteria
      task.updatedAt = liveTask.updatedAt
    })
  }

  private async renderReviewPacket(task: Task): Promise<string> {
    const changedFiles = await this.renderChangedFiles(task)
    const checkpoint = await readCheckpoint(this.opts.config.memoryDir, task.id)
    const selfCritique = this.latestSelfCritique(task)
    const lines = [
      `# Review packet: ${task.title}`,
      '',
      `- Task: ${task.id}`,
      `- Domain: ${task.domain}`,
      `- Status: ${task.status}`,
      `- Updated: ${task.updatedAt}`,
      '',
      '## Acceptance Criteria',
      ...this.renderAcceptanceCriteria(task),
      '',
      '## Commands And Gates',
      ...this.renderGateResults(task),
      '',
      '## Visual Evidence',
      ...this.renderVisualEvidence(task, changedFiles.files),
      '',
      '## Latest Self-Critique',
      ...selfCritique,
      '',
      '## Changed Files',
      ...changedFiles.summary,
      '',
      '## Changed File Excerpts',
      ...changedFiles.excerpts,
      '',
      '## Latest Checkpoint',
      ...this.renderCheckpoint(checkpoint),
      '',
      '## Policy Decision Packet',
      ...this.renderPolicyDecisionPacket(task, checkpoint),
      '',
      '## Reviewer Verdicts',
      ...this.renderReviewVerdicts(task),
      '',
      '## Merge',
      ...this.renderMergeRecord(task),
      '',
      '## Unresolved Items',
      ...this.renderUnresolvedItems(task),
      '',
      '## Safe Next Action',
      this.safeNextAction(task),
      '',
    ]

    return lines.join('\n')
  }

  private renderVisualEvidence(task: Task, changedFiles: readonly string[] = []): string[] {
    const evidenceRefs = collectVisualEvidenceRefs(task, changedFiles)
    if (evidenceRefs.length > 0) {
      return [
        '- Recorded visual evidence:',
        ...evidenceRefs.map((ref) => `  - ${ref}`),
      ]
    }

    if (!isFrontendUiReviewTask(task)) {
      return ['- No visual evidence recorded for this non-UI task.']
    }

    return [
      '- Missing desktop/mobile screenshot evidence for this frontend/UI task.',
      '- Because visual presentation changed, visual reviewers must not approve until rendered proof exists or the task explicitly records why screenshots are impossible.',
    ]
  }

  private renderPolicyDecisionPacket(task: Task, checkpoint: Checkpoint | null): string[] {
    const packet = buildAgentDecisionPacket({
      taskId: task.id,
      role: task.status === 'review' ? 'reviewer' : 'coordinator',
      notes: task.notes,
      touchedFiles: checkpoint?.filesTouched ?? [],
      lastCommand: checkpoint?.resumeContext?.verification.at(-1),
    })
    return renderAgentDecisionPacket(packet)
  }

  private async renderChangedFiles(task: Task): Promise<{ summary: string[]; excerpts: string[]; files: string[] }> {
    const rawRepoRoot = task.worktreePath?.trim() || task.projectPath?.trim()
    const repoRoot = rawRepoRoot ? resolveRuntimePath(rawRepoRoot) : ''
    if (!repoRoot) {
      return {
        summary: ['- No task worktree or project path recorded.'],
        excerpts: ['- No file excerpts available.'],
        files: [],
      }
    }

    try {
      const { stdout } = await execFileP('git', ['status', '--short', '--untracked-files=all'], {
        cwd: repoRoot,
        maxBuffer: 1024 * 1024,
      })
      const workingEntries = stdout
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => {
          const status = line.slice(0, 2).trim() || '??'
          const file = line.slice(3).trim()
          return { status, file }
        })
        .filter(
          (entry) =>
            entry.file.length > 0 &&
            !entry.file.includes('/.guildhall/') &&
            !isCommandShapedArtifactPath(entry.file),
        )

      const committedEntries: Array<{ status: string; file: string }> = []
      const baseBranch = task.baseBranch?.trim()
      if (baseBranch) {
        try {
          const { stdout: committed } = await execFileP(
            'git',
            ['diff', '--name-status', '--find-renames', `${baseBranch}...HEAD`],
            { cwd: repoRoot, maxBuffer: 1024 * 1024 },
          )
          for (const line of committed.split('\n').map(value => value.trim()).filter(Boolean)) {
            const fields = line.split('\t')
            const status = fields[0]?.trim() || 'M'
            const file = (status.startsWith('R') || status.startsWith('C')
              ? fields.at(-1)
              : fields[1])?.trim() ?? ''
            if (!file || file.includes('/.guildhall/') || isCommandShapedArtifactPath(file)) continue
            committedEntries.push({ status, file })
          }
        } catch {
          // A missing/legacy base branch leaves the working-tree evidence
          // usable. Review must not fabricate a diff against an arbitrary ref.
        }
      }

      const entriesByFile = new Map<string, { status: string; file: string }>()
      for (const entry of committedEntries) entriesByFile.set(entry.file, entry)
      for (const entry of workingEntries) entriesByFile.set(entry.file, entry)
      const entries = [...entriesByFile.values()]

      if (entries.length === 0) {
        return {
          summary: ['- No changed files recorded.'],
          excerpts: ['- No file excerpts available.'],
          files: [],
        }
      }

      const summary = entries.map((entry) => `- ${entry.status}: ${entry.file}`)
      const excerpts: string[] = []
      const excerptRank = (entry: { file: string }): number => {
        if (/(?:^|\/)internal\/evidence\//.test(entry.file) && /README\.md$/i.test(entry.file)) return 0
        if (!/(?:^|\/)(?:__tests__|test|tests|fixtures)(?:\/|$)/i.test(entry.file) &&
          /\.(?:[cm]?[jt]sx?|svelte|vue|css|scss|rs|go|py)$/i.test(entry.file)) return 1
        if (/(?:^|\/)(?:__tests__|test|tests)(?:\/|$)/i.test(entry.file)) return 2
        return 3
      }
      const excerptEntries = entries
        .filter(entry => !/\.(?:png|jpe?g|webp)$/i.test(entry.file))
        .sort((left, right) => excerptRank(left) - excerptRank(right) || left.file.localeCompare(right.file))
      const selectedExcerptEntries = excerptEntries.slice(0, 6)
      for (const entry of selectedExcerptEntries) {
        const absPath = path.join(repoRoot, entry.file)
        try {
          const raw = await readManagedTextFile(absPath, 'utf-8')
          const numbered = raw
            .split('\n')
            .slice(0, 160)
            .map((line, index) => `${String(index + 1).padStart(4, ' ')} | ${line}`)
            .join('\n')
          excerpts.push(`### ${entry.file}\n\n\`\`\`text\n${numbered}\n\`\`\``)
        } catch {
          excerpts.push(`### ${entry.file}\n\n- Could not read file contents.`)
        }
      }
      if (excerptEntries.length > selectedExcerptEntries.length) {
        excerpts.push(`- ...and ${excerptEntries.length - selectedExcerptEntries.length} more text file(s).`)
      }
      return { summary, excerpts, files: entries.map(entry => entry.file) }
    } catch {
      return {
        summary: ['- Could not inspect git status for the task worktree.'],
        excerpts: ['- No file excerpts available.'],
        files: [],
      }
    }
  }

  private latestSelfCritique(task: Task): string[] {
    const note = this.latestWorkerSelfCritiqueNote(task)
    if (!note?.content?.trim()) return ['- None recorded.']
    return [note.content.trim()]
  }

  private latestWorkerSelfCritiqueNote(task: Task): Task['notes'][number] | undefined {
    return [...task.notes]
      .reverse()
      .find((candidate) => isWorkerSelfCritiqueNote(candidate))
  }

  private hasStructuredSelfCritique(task: Task): boolean {
    const note = this.latestWorkerSelfCritiqueNote(task)
    const content = note?.content?.trim() ?? ''
    const structured = readPersistedStructuredSelfCritique(note?.structured)
    return content.length > 0 && structured !== null && structuredSelfCritiqueMatchesTask(task, structured)
  }

  private hasReviewProofPacket(task: Task): boolean {
    const note = this.latestWorkerSelfCritiqueNote(task)
    const content = note?.content?.trim() ?? ''
    const structured = content ? readPersistedStructuredSelfCritique(note?.structured) : null
    return Boolean(
      structured &&
      structuredSelfCritiqueMatchesTask(task, structured) &&
      structured.changedFiles.length > 0 &&
      structured.verificationCommands.some(command => command.status === 'passed'),
    )
  }

  private proofRecoveryIsNewerThanLatestSelfCritique(task: Task): boolean {
    const proofRecovery = (task as Task & { proofRecovery?: TaskRuntimeState['proofRecovery'] }).proofRecovery
    const reopenedAt = proofRecovery?.reopenedAt ? Date.parse(proofRecovery.reopenedAt) : NaN
    if (!Number.isFinite(reopenedAt)) return false
    const selfCritique = this.latestWorkerSelfCritiqueNote(task)
    const selfCritiqueAt = selfCritique?.timestamp ? Date.parse(selfCritique.timestamp) : NaN
    return !Number.isFinite(selfCritiqueAt) || reopenedAt > selfCritiqueAt
  }

  private hasNewerSubstantiveReviewFeedback(task: Task): boolean {
    const selfCritique = this.latestWorkerSelfCritiqueNote(task)
    if (!selfCritique?.timestamp) return false
    const selfCritiqueTime = Date.parse(selfCritique.timestamp)
    if (!Number.isFinite(selfCritiqueTime)) return false
    return (task.reviewVerdicts ?? []).some((verdict) => {
      const recordedAt = Date.parse(verdict.recordedAt)
      return Number.isFinite(recordedAt) &&
        recordedAt > selfCritiqueTime &&
        verdict.verdict === 'revise' &&
        !reviewVerdictLooksNonSubstantive(verdict)
    })
  }

  private async maybePromoteExistingWorkerReviewProof(input: {
    task: Task
    beforeStatus: TaskStatus
    activeWorktreePath: string
  }): Promise<TickOutcome | null> {
    if (input.beforeStatus !== 'in_progress') return null
    if (input.task.assignedTo && input.task.assignedTo !== 'worker-agent') return null
    const checkpoint = await readCheckpoint(this.opts.config.memoryDir, input.task.id).catch(() => null)
    const checkpointVerification = checkpoint?.resumeContext?.verification
    const checkpointWrittenAt = checkpoint ? Date.parse(checkpoint.writtenAt) : Number.NaN
    const hasCheckpointReviewHandoff =
      checkpoint?.nextActionKind === 'review_handoff' &&
      checkpoint.filesTouched.length > 0 &&
      checkpointHasRecordedPassingVerification(checkpointVerification)
    const hasExistingReviewPacket = this.hasReviewProofPacket(input.task)
    if (!hasExistingReviewPacket && !hasCheckpointReviewHandoff) return null
    if (hasExistingReviewPacket && this.proofRecoveryIsNewerThanLatestSelfCritique(input.task)) return null
    if (hasExistingReviewPacket && this.hasNewerSubstantiveReviewFeedback(input.task)) return null
    if (hasExistingReviewPacket && acceptanceCommandGateFailureIsNewerThanSelfCritique(input.task)) return null
    if (!hasExistingReviewPacket && Number.isFinite(checkpointWrittenAt)) {
      const newerSubstantiveRevision = input.task.reviewVerdicts.some((verdict) => {
        const recordedAt = Date.parse(verdict.recordedAt)
        return verdict.verdict === 'revise' &&
          !reviewVerdictLooksNonSubstantive(verdict) &&
          Number.isFinite(recordedAt) &&
          recordedAt > checkpointWrittenAt
      })
      const newerFailedGate = input.task.gateResults.some((gate) => {
        const checkedAt = Date.parse(gate.checkedAt)
        return gate.type === 'hard' &&
          gate.passed === false &&
          Number.isFinite(checkedAt) &&
          checkedAt > checkpointWrittenAt
      })
      if (newerSubstantiveRevision || newerFailedGate) return null
    }

    let hasTaskWorktreeChanges = false
    const proofWorktreePath = input.task.worktreePath?.trim()
      ? resolveRuntimePath(input.task.worktreePath)
      : resolveRuntimePath(input.activeWorktreePath)
    if (proofWorktreePath) {
      hasTaskWorktreeChanges = !(await this.gitDriver.isClean(proofWorktreePath))
    }
    const hasCommittedTaskWork = await this.taskWorktreeHasCommittedProgress(input.task)
    const checkpointTouchedFiles = uniqueStrings([
      ...this.checkpointTouchedFilesFromTaskNotes(input.task),
      ...(checkpoint?.filesTouched ?? []),
    ])
    if (!hasTaskWorktreeChanges && !hasCommittedTaskWork) return null

    const now = this.now()
    const queue = await this.readQueue()
    const queuedTask = queue.tasks.find((candidate) => candidate.id === input.task.id)
    if (!queuedTask) return null
    if (queuedTask.status !== 'in_progress') return null
    if (hasExistingReviewPacket) {
      if (this.proofRecoveryIsNewerThanLatestSelfCritique(queuedTask)) return null
      if (!this.hasReviewProofPacket(queuedTask)) return null
      if (this.hasNewerSubstantiveReviewFeedback(queuedTask)) return null
      if (acceptanceCommandGateFailureIsNewerThanSelfCritique(queuedTask)) return null
    } else {
      const metadata = {
        recent_verification_results: (checkpointVerification ?? []).map((entry) => ({
          kind: 'command',
          command: entry.command,
          passed: entry.passed,
          observedAt: entry.observedAt,
        })),
      }
      const structured = this.syntheticCheckpointSelfCritiqueStructured({
        task: input.task,
        checkpointTouchedFiles,
        metadata,
      })
      const selfCritique = {
        agentId: 'worker-agent',
        role: 'self-critique' as const,
        content: this.syntheticCheckpointSelfCritique({
          task: input.task,
          checkpointTouchedFiles,
          metadata,
          structured,
        }),
        structured,
        timestamp: now,
      }
      queuedTask.notes.push(selfCritique)
      await this.recordTaskNoteEvidence(queuedTask, selfCritique)
    }

    ensureReviewerOwnership(queuedTask)
    transitionTaskStatus({
      task: queuedTask,
      event: 'request_review',
      actor: 'worker-proof-packet-recovery',
      evidenceRefs: ['task:review-proof-packet'],
      now,
    })
    queuedTask.blockReason = undefined
    queuedTask.notes.push({
      agentId: 'coordinator',
      role: 'recovery',
      content:
        hasExistingReviewPacket
          ? 'Guildhall found an existing worker self-critique with a review proof packet and task-scoped worktree changes, so it moved the task to review instead of dispatching another worker turn.'
          : 'Guildhall rebuilt the missing review packet from a passing review-handoff checkpoint and committed task work, then moved the task to review without another worker-model pass.',
      timestamp: now,
    })
    queuedTask.updatedAt = now
    queue.lastUpdated = now
    await this.writeQueue(queue)
    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: input.task.id,
      agent_name: 'coordinator',
      message:
        hasExistingReviewPacket
          ? 'Existing worker review proof packet found. Guildhall moved the task to review instead of asking the worker to rediscover the handoff state.'
          : 'Passing review-handoff checkpoint found. Guildhall rebuilt the review packet and moved the task to review without another worker-model pass.',
    })
    return {
      kind: 'processed',
      taskId: input.task.id,
      agent: 'coordinator-recovery',
      beforeStatus: input.beforeStatus,
      afterStatus: 'review',
      transitioned: true,
      revisionCount: queuedTask.revisionCount,
    }
  }

  private checkpointTouchedFilesFromTaskNotes(task: Task): string[] {
    return task.notes
      .filter((note) => note.role === 'checkpoint')
      .flatMap((note) => {
        const files = note.structured?.filesTouched
        return Array.isArray(files)
          ? files.filter((file): file is string => typeof file === 'string')
          : []
      })
      .map(file => file.trim())
      .filter(Boolean)
  }

  private syntheticCheckpointSelfCritique(input: {
    task: Task
    checkpointTouchedFiles: readonly string[]
    metadata: Record<string, unknown> | undefined
    structured?: StructuredSelfCritique
  }): string {
    const criteria = input.task.acceptanceCriteria.length > 0
      ? input.task.acceptanceCriteria
      : [{ id: 'AC-1', description: 'Checkpoint-scoped verification passed.' }]
    const files = input.checkpointTouchedFiles.length > 0
      ? input.checkpointTouchedFiles
      : ['checkpoint-scoped files']
    const structured = input.structured ?? this.syntheticCheckpointSelfCritiqueStructured(input)
    const verification = structured.verificationCommands
      .filter((entry) => entry.status === 'passed')
      .map((entry) => `${entry.command} [passed]`)
    const verificationLine = verification.length > 0
      ? verification.join('; ')
      : 'All authoritative verification commands recorded in the latest checkpoint passed.'
    return [
      '**Self-critique:**',
      '',
      'For each acceptance criterion:',
      ...criteria.map((criterion, index) => {
        const id = typeof criterion.id === 'string' && criterion.id.trim()
          ? criterion.id.trim()
          : `AC-${index + 1}`
        return `- ${id}: Met — latest checkpoint says the authoritative verification passed for ${criterion.description ?? 'this criterion'}.`
      }),
      '',
      'Minimum-scope check:',
      `- Files changed: ${files.join(', ')}.`,
      '- Smallest useful change?: yes — Guildhall is preserving the checkpoint-scoped implementation work already verified by the worker.',
      '- Anything to revert before review?: none recorded in the checkpoint.',
      '',
      'Review proof packet:',
      `- Changed files / diff scope: ${files.join(', ')}.`,
      `- Verification commands passed: ${verificationLine}`,
      '- Proof path updates: latest worker checkpoint and recorded command output.',
      '- Working hypothesis at handoff: implementation is ready for reviewer evaluation because the worker recorded passing verification and the checkpoint named review handoff as the next step.',
      '- Known gaps / follow-up: none recorded in the checkpoint.',
      '',
      'Out-of-scope changes introduced: None recorded.',
      'Uncertainties: This self-critique was synthesized by Guildhall from durable checkpoint evidence because the worker repeatedly failed the update-task handoff ceremony after recording passing proof.',
      '',
      '**Machine self-critique:**',
      '```json',
      JSON.stringify(structured),
      '```',
    ].join('\n')
  }

  private syntheticCheckpointSelfCritiqueStructured(input: {
    task: Task
    checkpointTouchedFiles: readonly string[]
    metadata: Record<string, unknown> | undefined
  }): StructuredSelfCritique {
    const criteria = input.task.acceptanceCriteria.length > 0
      ? input.task.acceptanceCriteria
      : [{ id: 'AC-1', description: 'Checkpoint-scoped verification passed.' }]
    const files = input.checkpointTouchedFiles.length > 0
      ? input.checkpointTouchedFiles
      : ['checkpoint-scoped files']
    return {
      acceptanceCriteria: criteria.map((criterion, index) => ({
        id: typeof criterion.id === 'string' && criterion.id.trim() ? criterion.id.trim() : `AC-${index + 1}`,
        status: 'met',
      })),
      changedFiles: [...files],
      verificationCommands: readRecentVerificationResults(input.metadata)
        .filter((entry) => entry.passed)
        .map((entry) => ({ command: entry.command, status: 'passed' as const })),
      proofEvidenceIds: [],
    }
  }

  private renderCheckpoint(
    checkpoint: Awaited<ReturnType<typeof readCheckpoint>>,
  ): string[] {
    if (!checkpoint) return ['- None recorded.']
    return [
      `- Step ${checkpoint.step} by ${checkpoint.agentId} at ${checkpoint.writtenAt}`,
      `- Intent: ${checkpoint.intent}`,
      `- Next planned action: ${checkpoint.nextPlannedAction}`,
      checkpoint.filesTouched.length > 0
        ? `- Files touched: ${checkpoint.filesTouched.join(', ')}`
        : '- Files touched: none recorded',
    ]
  }

  private renderAcceptanceCriteria(task: Task): string[] {
    if (task.acceptanceCriteria.length === 0) return ['- None recorded.']
    return task.acceptanceCriteria.map((criterion) => {
      const mark = criterion.met ? 'x' : ' '
      const command = criterion.command ? `; command: \`${criterion.command}\`` : ''
      return `- [${mark}] ${criterion.id}: ${criterion.description} (${criterion.verifiedBy}${command})`
    })
  }

  private renderGateResults(task: Task): string[] {
    if (task.gateResults.length === 0) return ['- None recorded.']
    return task.gateResults.map((gate) => {
      const mark = gate.passed ? 'pass' : 'fail'
      const output = gate.output ? ` — ${gate.output.trim()}` : ''
      return `- ${mark}: ${gate.gateId} (${gate.type}, ${gate.checkedAt})${output}`
    })
  }

  private renderReviewVerdicts(task: Task): string[] {
    if (task.reviewVerdicts.length === 0) return ['- None recorded.']
    return task.reviewVerdicts.map((verdict) =>
      `- ${verdict.verdict}: ${verdict.reason} (${verdict.reviewerPath}, ${verdict.recordedAt})`,
    )
  }

  private renderMergeRecord(task: Task): string[] {
    const record = task.mergeRecord
    if (!record) return ['- None recorded.']
    const detail = record.detail ? ` — ${record.detail}` : ''
    const sha = record.commitSha ? ` (${record.commitSha})` : ''
    const pr = record.prUrl ? `; PR: ${record.prUrl}` : ''
    return [
      `- ${record.result}: ${record.fromBranch} -> ${record.toBranch} via ${record.strategy}${sha}; ${record.mergedAt}${pr}${detail}`,
    ]
  }

  private renderUnresolvedItems(task: Task): string[] {
    const items: string[] = []
    if (task.blockReason) items.push(`- Block reason: ${task.blockReason}`)
    for (const escalation of activeEscalations(task)) {
      items.push(`- Open escalation ${escalation.id}: ${escalation.summary}`)
    }
    for (const issue of task.agentIssues.filter((i) => !i.resolvedAt)) {
      items.push(`- Open issue ${issue.id}: ${issue.detail}`)
    }
    return items.length > 0 ? items : ['- None recorded.']
  }

  private safeNextAction(task: Task): string {
    switch (task.status) {
      case 'done':
        if (task.mergeRecord?.result === 'merged' || task.mergeRecord?.result === 'pushed') {
          return `Task is complete and ${task.mergeRecord.result}.`
        }
        return 'Task is complete. Review the diff and commit or ship if policy allows.'
      case 'pending_pr':
        return task.mergeRecord?.prUrl
          ? `Review and merge the pending PR: ${task.mergeRecord.prUrl}`
          : 'Review and merge the pending PR.'
      case 'blocked':
        return 'Resolve the block or escalation, then resume the task.'
      case 'shelved':
        return 'Leave shelved unless a human explicitly unshelves or rewrites the task.'
      default:
        return 'Continue the task from its current status.'
    }
  }

  private async preserveDurableProgressAfterTurnLimit(input: {
    taskId: string
    agentName: string
    beforeStatus: TaskStatus
    beforeSpec?: string
    beforeProductBriefJson?: string
    interruption?: 'turn_limit' | 'timeout'
  }): Promise<TickOutcome | null> {
    const queue = await this.readQueue()
    const taskIndex = queue.tasks.findIndex((candidate) => candidate.id === input.taskId)
    if (taskIndex < 0) return null
    // Queue reads deliberately carry the compact projection. Recovery needs
    // to compare durable task state, though: otherwise an existing brief or
    // spec that is omitted from the list row looks like fresh agent progress.
    // Hydrate only this task through the shared current-state boundary.
    const task = await this.hydrateEffectiveTaskForDispatch(queue.tasks[taskIndex]!)
    queue.tasks[taskIndex] = task

    const hasSpec = typeof task.spec === 'string' && task.spec.trim().length > 0
    const specChanged = (task.spec ?? '').trim() !== (input.beforeSpec ?? '').trim()
    const hasBrief =
      !!task.productBrief &&
      typeof task.productBrief.userJob === 'string' &&
      task.productBrief.userJob.trim().length > 0
    const briefChanged =
      JSON.stringify(task.productBrief ?? null) !== (input.beforeProductBriefJson ?? JSON.stringify(null))
    const hasOpenQuestion = taskHasUnansweredVisibleQuestion(task)
    const hasWaitingOwnerInput = this.waitingOwnerInputTaskIds(queue).has(task.id)
    const activeWorktreePath = input.beforeStatus === 'in_progress'
      ? await this.recoverTaskWorktreePath(task)
      : null
    const hasDirtyWorktree =
      activeWorktreePath !== null &&
      !(await this.gitDriver.isClean(resolveRuntimePath(activeWorktreePath)))
    if (
      input.beforeStatus === 'exploring' &&
      task.status === 'exploring' &&
      hasSpec &&
      specChanged &&
      !hasOpenQuestion &&
      !hasWaitingOwnerInput
    ) {
      requestSpecReview(task, {
        authority: 'owner',
        requestedAt: this.now(),
        requestedBy: 'spec-agent',
      })
      task.updatedAt = this.now()
      queue.lastUpdated = task.updatedAt
      await this.writeQueue(queue)
    }

    const transitioned = task.status !== input.beforeStatus
    const durableExploringProgress =
      input.beforeStatus === 'exploring' && (
        (hasSpec && specChanged) ||
        (hasBrief && briefChanged) ||
        hasOpenQuestion ||
        hasWaitingOwnerInput
      )
    const durableWorkerProgress =
      input.beforeStatus === 'in_progress' &&
      task.status === 'in_progress' &&
      hasDirtyWorktree

    if (!transitioned && !durableExploringProgress && !durableWorkerProgress) return null
    if (durableWorkerProgress && activeWorktreePath && task.worktreePath !== activeWorktreePath) {
      task.worktreePath = activeWorktreePath
      task.updatedAt = this.now()
      queue.lastUpdated = task.updatedAt
      await this.writeQueue(queue)
    }

    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: task.id,
      agent_name: input.agentName,
      message:
        durableWorkerProgress
          ? 'The model hit its turn limit after making real worktree edits, so Guildhall is preserving that code progress instead of escalating over it.'
          : input.interruption === 'timeout'
            ? 'The model timed out after writing durable task state, so Guildhall is preserving that progress instead of escalating over it.'
            : 'The model hit its turn limit after writing durable task state, so Guildhall is preserving that progress instead of escalating over it.',
    })

    return {
      kind: 'processed',
      taskId: task.id,
      agent: input.agentName,
      beforeStatus: input.beforeStatus,
      afterStatus: task.status,
      transitioned,
      revisionCount: task.revisionCount,
      ...(hasOpenQuestion || hasWaitingOwnerInput ? { waitingOnUser: true } : {}),
    }
  }

  private async preserveGateCheckAfterRecordedHardGateProof(input: {
    taskId: string
    agentName: string
    beforeStatus: TaskStatus
    message: string
  }): Promise<TickOutcome | null> {
    const queue = await this.readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === input.taskId)
    if (!task || task.status !== 'gate_check') return null
    const effectiveTask = await this.hydrateEffectiveTaskForDispatch(task)
    const latestHardGates = latestHardGateResults(effectiveTask)
    if (latestHardGates.length === 0 || !latestHardGates.every((gate) => gate.passed)) return null

    const now = this.now()
    task.notes.push({
      agentId: 'coordinator',
      role: 'gate-checker',
      content:
        'The gate checker timed out after recording passing hard gates. Guildhall preserved that proof and will complete the gate check from recorded task state on the next tick.',
      timestamp: now,
    })
    task.updatedAt = now
    queue.lastUpdated = now
    await this.writeQueue(queue)
    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: task.id,
      agent_name: input.agentName,
      message:
        'The gate checker timed out after recording passing hard gates. Guildhall preserved the proof instead of surfacing an agent error.',
    })
    await this.logTickProgress({
      task,
      agent: input.agentName,
      beforeStatus: input.beforeStatus,
      afterStatus: task.status,
      transitioned: false,
      note: `gate checker timed out after recorded passing hard gates: ${input.message}`,
    })
    return {
      kind: 'processed',
      taskId: task.id,
      agent: input.agentName,
      beforeStatus: input.beforeStatus,
      afterStatus: task.status,
      transitioned: false,
      revisionCount: task.revisionCount,
    }
  }

  private async preserveImportedDraftTurnLimitAsOwnerQuestion(input: {
    taskId: string
    agentName: string
    beforeStatus: TaskStatus
    message: string
  }): Promise<TickOutcome | null> {
    if (input.agentName !== 'spec-agent' || input.beforeStatus !== 'exploring') return null

    const queue = await this.readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === input.taskId)
    if (!task || task.status !== 'exploring') return null
    if (!hasWorkspaceImportProvenance(task)) return null
    if (!task.notes?.some((note) => note.role === 'shaping-request')) return null
    if (typeof task.spec === 'string' && task.spec.trim()) return null
    if (task.productBrief?.userJob?.trim()) return null
    if (taskHasUnansweredVisibleQuestion(task)) return null
    if (this.waitingOwnerInputTaskIds(queue).has(task.id)) return null

    const now = this.now()
    const sourceNote = (task.notes ?? []).find((note) =>
      note.role === 'importer' ||
      note.agentId === 'workspace-importer' ||
      note.agentId === 'workspace-importer-agent'
    )
    const source = summarizeImportedDraftSource(sourceNote?.content ?? task.description ?? task.title)
    const prompt =
      `Should "${task.title}" stay in scope for this project, and what concrete success boundary should Guildhall use if it continues?`
    const description = source
      ? `Imported source: ${source}`
      : 'Guildhall could not infer a safe brief from the imported note before the spec-agent turn budget ended.'
    const questionId = `q-import-draft-scope-${task.id}-${Date.now().toString(36)}`
    const question = {
      kind: 'text' as const,
      id: questionId,
      askedBy: 'spec-agent',
      askedAt: now,
      prompt,
      subject: task.title,
      description,
    }

    await createOwnerInputRequest({
      projectRoot: this.opts.config.projectPath,
      projectId: this.opts.config.workspaceId,
      commandId: `orchestrator:import-draft-scope:${task.id}:${question.id}`,
      now,
      actor: 'spec-agent',
      source: { kind: 'task', taskId: task.id, questionId: question.id },
      target: { kind: 'thread' },
      question: {
        kind: 'text',
        prompt,
        description,
      },
      objective: {
        kind: 'task_shaping',
        label: `Clarify ${task.title}`,
        successCriteria: ['Owner defines whether the imported draft is in scope and what success means.'],
      },
      sessionSource: `orchestrator:import-draft-scope:${task.id}:${question.id}`,
    })

    task.blockReason = undefined
    task.assignedTo = null
    task.updatedAt = now
    queue.lastUpdated = now
    await this.writeQueue(queue)

    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: task.id,
      agent_name: input.agentName,
      message:
        'The imported draft still needs scope before Guildhall can shape it, so Guildhall asked a concrete owner question instead of blocking on a generic turn-limit error.',
    })

    await this.logTickProgress({
      task,
      agent: input.agentName,
      beforeStatus: input.beforeStatus,
      afterStatus: task.status,
      transitioned: false,
      note: `owner input requested after imported draft shaping hit a turn limit: ${input.message}`,
    })

    return {
      kind: 'processed',
      taskId: task.id,
      agent: input.agentName,
      beforeStatus: input.beforeStatus,
      afterStatus: task.status,
      transitioned: false,
      revisionCount: task.revisionCount,
      waitingOnUser: true,
    }
  }

  private async recoverTaskWorktreePath(task: Task): Promise<string | null> {
    const recorded = task.worktreePath?.trim()
    if (recorded) return recorded
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    const workspace = await readTaskWorkspaceStore(projectRoot)
      .then((store) => store.workspaces[task.id]?.worktreePath?.trim() || null)
      .catch(() => null)
    if (workspace) return workspace
    const mode = await this.resolveWorktreeModeSafe()
    if (mode === 'none') return null
    return computeWorktreePath(this.opts.config.workspaceId, task, mode)
  }

  private async reopenUnprovenScriptProofRecovery(task: Task): Promise<TickOutcome | null> {
    if (!needsSourceShapingForScriptProofRecovery(task)) return null

    const queue = await this.readQueue()
    const currentTask = queue.tasks.find((candidate) => candidate.id === task.id)
    if (!currentTask || currentTask.status !== 'spec_review') return null
    const effectiveTask = await this.hydrateEffectiveTaskForDispatch(currentTask)
    if (!needsSourceShapingForScriptProofRecovery(effectiveTask)) return null
    const now = this.now()
    resetCurrentPlanForProofRecovery(currentTask, {
      reason: 'The selected script-only release still lacks a concrete project-backed proof command. Re-intake the visible project evidence and create bounded proof-setup work if the command is not yet documented.',
      now,
      agentId: 'proof-recovery',
      role: 'source-shaping',
    })
    currentTask.status = 'exploring'
    currentTask.assignedTo = null
    currentTask.updatedAt = now
    queue.lastUpdated = now
    await this.writeQueue(queue)
    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: currentTask.id,
      agent_name: 'proof-recovery',
      message:
        'The recovered spec still lacks a concrete project proof command. Guildhall cleared that current plan and returned the task to source-backed shaping instead of approving a generic recovery blueprint.',
    })
    return {
      kind: 'processed',
      taskId: currentTask.id,
      agent: 'proof-recovery',
      beforeStatus: 'spec_review',
      afterStatus: 'exploring',
      transitioned: true,
      revisionCount: currentTask.revisionCount,
    }
  }

  private async maybeRepairMalformedSpecReviewBlueprint(task: Task): Promise<TickOutcome | null> {
    const canRepair =
      task.status === 'spec_review' ||
      (task.status === 'exploring' && hasLatestBlueprintRevisionRequest(task))
    if (!canRepair) return null
    if (task.id === META_INTAKE_TASK_ID) return null
    if (!task.spec?.trim() && !task.structuredSpec) return null
    const blueprintQuality = validateSpecCompletionBoundary(task)
    if (blueprintQuality.ok) return null

    const now = this.now()
    const queue = await this.readQueue()
    const currentTask = queue.tasks.find((candidate) => candidate.id === task.id)
    if (!currentTask) return null
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    const liveTask = await buildEffectiveTask(projectRoot, currentTask, { evidence: 'full' }) as unknown as Task
    queue.tasks[queue.tasks.findIndex((candidate) => candidate.id === liveTask.id)] = liveTask
    const liveCanRepair =
      liveTask.status === 'spec_review' ||
      (liveTask.status === 'exploring' && hasLatestBlueprintRevisionRequest(liveTask))
    if (!liveCanRepair) return null
    if (!liveTask.spec?.trim() && !liveTask.structuredSpec) return null
    const liveQuality = validateSpecCompletionBoundary(liveTask)
    if (liveQuality.ok) return null
    const beforeStatus = liveTask.status

    const answeredDecisions = recoverySpecSeedDecisionTexts(liveTask)
    const taskTitle = semanticTaskTitle(liveTask)
    const sourceIntent = formatRecoverySpecSourceIntent(liveTask.proposalRationale || liveTask.description || taskTitle)
    const outOfScope = typedScopeNonGoals(liveTask)
    const structuredSpec = StructuredSpec.parse({
      whatThisIs: `A bounded implementation contract for ${taskTitle}.`,
      problemContext: sourceIntent,
      goals: [
        `Implement or verify the bounded outcome represented by ${taskTitle}.`,
        'Preserve the visible source boundary and record evidence for the result.',
      ],
      nonGoals: outOfScope.length > 0
        ? outOfScope
        : ['Work not implied by the current project evidence or resolved owner decisions.'],
      proposedDesign: 'Use the project surfaces named by the source evidence and keep any newly discovered decision or dependency as explicit follow-up work.',
      keyDecisions: answeredDecisions.length > 0
        ? answeredDecisions
        : ['No unresolved owner decisions are recorded on the current task.'],
      acceptanceCriteria: [
        {
          scenario: `Given the visible project evidence for ${taskTitle}, when the bounded work is implemented or verified`,
          expectation: 'The intended project behavior is present and its result is recorded as evidence.',
          verificationMode: 'review',
          evidenceHint: 'Review the changed project surface and task evidence against the visible source boundary.',
        },
        {
          scenario: 'Given a newly discovered product decision, dependency, or broader scope',
          expectation: 'That work remains separate instead of being silently included in this task.',
          verificationMode: 'review',
          evidenceHint: 'Check the task boundary, dependencies, and linked follow-up work.',
        },
      ],
      verification: [
        'Review the changed project surface against the visible source evidence.',
        'Record the observed result in the task proof or review evidence.',
      ],
      completionBoundary: {
        productOutcome: `The bounded outcome for ${taskTitle} is implemented or verified in the intended project surface.`,
        whatGuildhallCanCompleteInCode: 'Repo-local implementation, tests, documentation, and evidence needed by the bounded work.',
        externalDependencies: 'None known from the current task record.',
        ownerOnlySetup: 'None known from the current task record.',
        verificationEnvironment: 'The local project checkout and its visible project evidence.',
        whatCountsAsDone: 'The acceptance criteria are satisfied and the observed result is recorded.',
        whatMustBeSplitOrBlocked: 'A new product decision, external dependency, or broader scope that cannot be resolved from current evidence.',
        splitPolicy: 'conditional',
      },
    })
    liveTask.structuredSpec = structuredSpec
    liveTask.spec = renderStructuredSpecMarkdown(structuredSpec)
    liveTask.acceptanceCriteria = acceptanceCriteriaFromStructuredSpec(structuredSpec)
    liveTask.productBrief ??= {
      userJob: `I want ${taskTitle} turned into concrete project work using the evidence and owner decisions already recorded.`,
      successMetric: `${taskTitle} has a reviewable spec, acceptance criteria, and a clear completion boundary before implementation starts.`,
      antiPatterns: [
        'Do not preserve stale recovery-loop wording as the task brief.',
        'Do not ask the owner to re-answer decisions already recorded on the task.',
      ],
      authoredBy: 'coordinator-recovery',
      authoredAt: now,
    }
    requestSpecReview(liveTask, {
      authority: 'coordinator',
      requestedAt: now,
      requestedBy: 'coordinator-recovery',
      reason: 'recovery',
    })
    liveTask.assignedTo = null
    liveTask.updatedAt = now
    liveTask.notes.push({
      agentId: 'coordinator-recovery',
      role: 'system',
      structured: {
        event: 'recovery_spec_repaired',
        source: 'deterministic',
      },
      content:
        `Guildhall repaired a malformed spec_review blueprint deterministically before dispatch. ${liveQuality.errors.join(' ')}`,
      timestamp: now,
    })
    queue.lastUpdated = now
    await this.writeQueue(queue)
    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: liveTask.id,
      agent_name: 'coordinator-recovery',
      message:
        'Guildhall repaired the malformed spec draft so coordinator review can continue without another stalled spec-agent pass.',
    })
    return {
      kind: 'processed',
      taskId: liveTask.id,
      agent: 'coordinator-recovery',
      beforeStatus,
      afterStatus: 'spec_review',
      transitioned: beforeStatus !== 'spec_review',
      revisionCount: liveTask.revisionCount,
    }
  }

  private async repairWeakRecoverySpecReviewSeedsInQueue(queue: TaskQueue): Promise<TickOutcome | null> {
    // The queue projection intentionally omits runtime overlays. Hydrate only
    // recovery-shaped spec-review candidates so proof recovery cannot be
    // mistaken for an ordinary malformed draft during the pre-dispatch pass.
    for (const candidate of queue.tasks) {
      if (candidate.status !== 'spec_review') continue
      if (candidate.productBrief?.authoredBy !== 'coordinator-recovery' &&
        !candidate.notes.some((note) => note.agentId === 'coordinator-recovery')) continue
      const effective = await this.hydrateEffectiveTaskForDispatch(candidate)
      const index = queue.tasks.findIndex((task) => task.id === candidate.id)
      if (index >= 0) queue.tasks[index] = effective
    }
    const now = this.now()
    const repaired = repairWeakRecoverySpecReviewSeedInQueue(queue, { now })
    if (!repaired) return null
    await this.writeQueue(queue)
    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: repaired.taskId,
      agent_name: 'coordinator-recovery',
      message:
        'Guildhall repaired the recovery spec from task graph evidence before review continued.',
    })
    return {
      kind: 'processed',
      taskId: repaired.taskId,
      agent: 'coordinator-recovery',
      beforeStatus: 'spec_review',
      afterStatus: 'spec_review',
      transitioned: false,
      revisionCount: queue.tasks.find((candidate) => candidate.id === repaired.taskId)?.revisionCount ?? 0,
    }
  }

  private async repairSourceRecoveryResearchTasksInQueue(queue: TaskQueue): Promise<TickOutcome | null> {
    const liveTask = queue.tasks.find(shouldSeedSourceRecoveryResearchTask)
    if (!liveTask) return null
    const now = this.now()
    const beforeStatus = liveTask.status
    const seed = buildSourceRecoveryResearchSpecSeed(liveTask, now)
    if (!seed.productBrief || !validateProductBriefGrounding(liveTask, seed.productBrief).ok) return null
    liveTask.structuredSpec = seed.structuredSpec
    liveTask.spec = seed.spec
    liveTask.acceptanceCriteria = seed.acceptanceCriteria
    liveTask.productBrief = seed.productBrief
    liveTask.taskReadiness = readyReadinessForSourceRecoveryTask(liveTask, seed, now)
    liveTask.status = 'ready'
    liveTask.assignedTo = null
    liveTask.blockReason = undefined
    liveTask.updatedAt = now
    if (seed.references) liveTask.references = seed.references
    for (const escalation of liveTask.escalations ?? []) {
      if (escalation.resolvedAt) continue
      escalation.resolvedAt = now
      escalation.resolvedBy = 'system'
      escalation.resolution =
        'Auto-repaired as source-backed contract/type recovery. Guildhall seeded named surfaces from task/import evidence instead of asking the owner whether to retry a failed model loop.'
    }
    liveTask.notes.push({
      agentId: 'coordinator-recovery',
      role: 'system',
      structured: {
        event: 'recovery_spec_seed',
        source: 'deterministic',
      },
      content:
        'Guildhall converted the source-recovery research spike into ready source-backed contract/type work from explicit contract fields and cited refs; this is Guildhall-owned shaping, not owner approval.',
      timestamp: now,
    })
    queue.lastUpdated = now
    await this.writeQueue(queue)
    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: liveTask.id,
      agent_name: 'coordinator-recovery',
      message:
        'Guildhall recovered named contract/type targets from the task evidence and made the source-recovery work ready.',
    })
    return {
      kind: 'processed',
      taskId: liveTask.id,
      agent: 'coordinator-recovery',
      beforeStatus,
      afterStatus: 'ready',
      transitioned: beforeStatus !== 'ready',
      revisionCount: liveTask.revisionCount,
    }
  }

  private async repairStaleSourceRecoveryReadinessInQueue(queue: TaskQueue): Promise<TickOutcome | null> {
    const liveTask = queue.tasks.find(shouldRepairStaleSourceRecoveryReadiness)
    if (!liveTask) return null
    const now = this.now()
    const seed = buildSourceRecoveryResearchSpecSeed(liveTask, now)
    liveTask.taskReadiness = readyReadinessForSourceRecoveryTask(liveTask, seed, now)
    liveTask.updatedAt = now
    liveTask.notes.push({
      agentId: 'coordinator-recovery',
      role: 'system',
      content:
        'Guildhall repaired stale source-recovery readiness after the task already named its contract/type surfaces; status was preserved.',
      timestamp: now,
    })
    queue.lastUpdated = now
    await this.writeQueue(queue)
    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: liveTask.id,
      agent_name: 'coordinator-recovery',
      message:
        'Guildhall repaired stale source-recovery readiness now that the named contract/type surfaces are present.',
    })
    return {
      kind: 'processed',
      taskId: liveTask.id,
      agent: 'coordinator-recovery',
      beforeStatus: liveTask.status,
      afterStatus: liveTask.status,
      transitioned: false,
      revisionCount: liveTask.revisionCount,
    }
  }

  private async repairStaleFixedSpecReadinessInQueue(queue: TaskQueue): Promise<TickOutcome | null> {
    const liveTask = queue.tasks.find((task) =>
      (task.status === 'ready' || task.status === 'in_progress' || task.status === 'done') &&
      task.taskReadiness?.recommendation !== 'ready' &&
      hasSettledFixedSpecBoundary(task),
    )
    if (!liveTask) return null
    const now = this.now()
    const readiness = assessTaskReadiness(liveTask, { now })
    if (readiness.recommendation !== 'ready') return null
    liveTask.taskReadiness = readiness
    liveTask.updatedAt = now
    liveTask.notes.push({
      agentId: 'coordinator-recovery',
      role: 'system',
      content:
        'Guildhall repaired stale readiness for settled fixed-spec work; the accepted completion boundary already says no child split or research precursor is required.',
      timestamp: now,
    })
    queue.lastUpdated = now
    await this.writeQueue(queue)
    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: liveTask.id,
      agent_name: 'coordinator-recovery',
      message:
        'Guildhall repaired stale readiness for settled fixed-spec work.',
    })
    return {
      kind: 'processed',
      taskId: liveTask.id,
      agent: 'coordinator-recovery',
      beforeStatus: liveTask.status,
      afterStatus: liveTask.status,
      transitioned: false,
      revisionCount: liveTask.revisionCount,
    }
  }

  private async maybeApproveDeterministicallyRepairedSpec(task: Task): Promise<TickOutcome | null> {
    if (task.status !== 'spec_review') return null
    if (task.id === META_INTAKE_TASK_ID) return null
    if (!hasDeterministicSpecRepairNote(task)) return null
    const blueprintQuality = validateSpecCompletionBoundary(task)
    if (!blueprintQuality.ok) return null

    const now = this.now()
    const queue = await this.readQueue()
    const liveTask = queue.tasks.find((candidate) => candidate.id === task.id)
    if (!liveTask || liveTask.status !== 'spec_review') return null
    if (!hasDeterministicSpecRepairNote(liveTask)) return null
    const liveQuality = validateSpecCompletionBoundary(liveTask)
    if (!liveQuality.ok) return null

    if (!hasBlueprintSanityReview(liveTask)) {
      liveTask.notes.push({
        agentId: 'blueprint-sanity-review',
        role: 'blueprint-review',
        structured: {
          event: 'blueprint_review',
          decision: 'approve',
          source: 'deterministic',
        },
        content: 'approve_blueprint: Deterministically repaired spec has a usable completion boundary. Worker may build against it.',
        timestamp: now,
      })
    } else {
      liveTask.notes.push({
        agentId: 'blueprint-sanity-review',
        role: 'blueprint-review',
        structured: {
          event: 'blueprint_review',
          decision: 'approve',
          source: 'deterministic',
        },
        content: 'approve_blueprint: Deterministically repaired spec revalidated with a usable completion boundary. Worker may build against it.',
        timestamp: now,
      })
    }
    const transitionResult = applyTaskTransition({
      task: liveTask,
      event: 'mark_ready',
      actor: 'blueprint-sanity-review',
      evidenceRefs: ['task:deterministic-spec-repair'],
      now,
    })
    if (transitionResult.kind === 'rejected') {
      liveTask.notes.push({
        agentId: 'blueprint-sanity-review',
        role: 'blueprint-review',
        content: `deterministic spec repair could not be approved: ${transitionResult.reason}`,
        timestamp: now,
      })
      liveTask.updatedAt = now
      queue.lastUpdated = now
      await this.writeQueue(queue)
      return {
        kind: 'agent-error',
        taskId: liveTask.id,
        agent: 'blueprint-sanity-review',
        error: transitionResult.reason,
      }
    }

    liveTask.status = transitionResult.nextState
    liveTask.assignedTo = null
    liveTask.updatedAt = now
    queue.lastUpdated = now
    await this.writeQueue(queue)
    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: liveTask.id,
      agent_name: 'blueprint-sanity-review',
      message:
        'Guildhall approved the deterministically repaired spec so worker implementation can start.',
    })
    return {
      kind: 'processed',
      taskId: liveTask.id,
      agent: 'blueprint-sanity-review',
      beforeStatus: 'spec_review',
      afterStatus: liveTask.status,
      transitioned: true,
      revisionCount: liveTask.revisionCount,
    }
  }

  private async maybeWriteExploringRecoverySpecSeed(
    task: Task,
    opts: { force?: boolean } = {},
  ): Promise<TickOutcome | null> {
    if (task.status !== 'exploring') return null
    if (typeof task.spec === 'string' && task.spec.trim().length > 0) return null
    if (taskHasUnansweredVisibleQuestion(task)) return null
    // A fresh reframe must reach the real spec lane. Older recovery notes are
    // evidence, not permission to manufacture a new placeholder spec. A
    // persisted clipped title is different: it is a data-integrity defect,
    // and the coordinator must repair it from the full request before the
    // task can re-enter the normal spec lane.
    const persistedTitle = task.request?.title ?? task.title
    const titleRepairCandidate = recoverClippedTitle(persistedTitle, task.description ?? task.request?.raw)
    if (hasFreshReframeBoundary(task) && !titleRepairCandidate) return null
    const notes = Array.isArray(task.notes) ? task.notes : []
    // A reframe is a deliberate fresh planning pass, not evidence that the
    // spec agent already failed. Only a recorded no-progress recovery may
    // use the deterministic seed; otherwise the real spec lane must inspect
    // the current source-backed task and produce the new brief/spec.
    const isDurableDraftRecoveryRetry = notes.some((note) =>
      note.structured?.event === 'spec_draft_recovery',
    )

    const now = this.now()
    const queue = await this.readQueue()
    const currentTask = queue.tasks.find((candidate) => candidate.id === task.id)
    if (!currentTask || currentTask.status !== 'exploring') return null
    // The normal queue projection is intentionally current-state only. A
    // recovery spec must also preserve answered decisions that may have aged
    // out of that projection, so reopen this one task's bounded essential
    // history instead of making the whole queue historical.
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    const liveTask = await buildEffectiveTask(projectRoot, currentTask, { evidence: 'full' }) as unknown as Task
    queue.tasks[queue.tasks.findIndex((candidate) => candidate.id === liveTask.id)] = liveTask
    if (typeof liveTask.spec === 'string' && liveTask.spec.trim().length > 0) return null
    if (taskHasUnansweredVisibleQuestion(liveTask)) return null
    const livePersistedTitle = liveTask.request?.title ?? liveTask.title
    const repairedTitle = recoverClippedTitle(livePersistedTitle, liveTask.description ?? liveTask.request?.raw)
    const titleWasRepaired = Boolean(repairedTitle && repairedTitle !== livePersistedTitle)
    if (repairedTitle) {
      liveTask.title = repairedTitle
      if (liveTask.request && typeof liveTask.request === 'object') {
        liveTask.request = { ...liveTask.request, title: repairedTitle }
      }
    }
    if (hasFreshReframeBoundary(liveTask) && !titleWasRepaired) return null
    if (hasActiveProofRecovery(liveTask) && isExplicitProofRecovery(liveTask)) {
      // A generic recovery seed is valid for a malformed draft, but it cannot
      // solve an explicitly marked proof contract. Send this task to the real
      // source-backed spec lane so it can name a command or create explicit
      // proof-setup work instead of cycling through a synthetic blueprint.
      return null
    }
    const shouldSeedFromParent = shouldSeedSourceBackedExploringSplit(liveTask, queue)
    if (!isDurableDraftRecoveryRetry && !shouldSeedFromParent && !titleWasRepaired && opts.force !== true) return null

    const seed = buildRecoverySpecSeedForTask(liveTask, queue, now)
    if (!seed.references?.length) return null
    const parentId = liveTask.hierarchy?.parentId ?? liveTask.delivery?.supports?.[0]
    const parentTask = parentId ? queue.tasks.find((candidate) => candidate.id === parentId) : undefined
    if (!seed.productBrief || !validateProductBriefGrounding(liveTask, seed.productBrief).ok) return null
    liveTask.structuredSpec = seed.structuredSpec
    liveTask.spec = seed.spec
    liveTask.acceptanceCriteria = seed.acceptanceCriteria
    liveTask.productBrief = seed.productBrief
    if (seed.references) liveTask.references = seed.references
    if ((!liveTask.domain || liveTask.domain === 'core') && parentTask?.domain) liveTask.domain = parentTask.domain
    if ((liveTask.releaseIds?.length ?? 0) === 0 && parentTask?.releaseIds?.length) liveTask.releaseIds = [...parentTask.releaseIds]
    attachSelectedReleaseToCurrentRecoveryTask(liveTask, queue)
    requestSpecReview(liveTask, {
      authority: 'coordinator',
      requestedAt: now,
      requestedBy: 'coordinator-recovery',
      reason: 'recovery',
    })
    liveTask.assignedTo = null
    liveTask.updatedAt = now
    liveTask.notes.push({
      agentId: 'coordinator-recovery',
      role: 'system',
      structured: {
        event: 'recovery_spec_seed',
        source: 'deterministic',
      },
      content:
        'Guildhall wrote a deterministic recovery spec seed from the current task evidence before redispatching the spec lane, so the task has durable progress instead of returning to a read-only shaping loop.',
      timestamp: now,
    })
    queue.lastUpdated = now
    await this.writeQueue(queue)
    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: liveTask.id,
      agent_name: 'coordinator-recovery',
      message:
        'Guildhall saved a recovery spec seed from the task evidence so this work can move to review instead of looping in intake.',
    })
    return {
      kind: 'processed',
      taskId: liveTask.id,
      agent: 'coordinator-recovery',
      beforeStatus: 'exploring',
      afterStatus: 'spec_review',
      transitioned: true,
      revisionCount: liveTask.revisionCount,
    }
  }

  private async rejectStaleWorkerSelfCritiqueWithoutProjectChanges(
    task: Task,
    beforeStatus: TaskStatus,
  ): Promise<TickOutcome | null> {
    if (beforeStatus !== 'in_progress' && beforeStatus !== 'review' && beforeStatus !== 'gate_check') return null
    // A complete command-backed proof task is already at its authoritative
    // review/gate boundary. Old worker narration must not steal it before the
    // command gets a chance to replace stale gate evidence.
    if (isLeanCommandBackedTask(task) && (beforeStatus === 'review' || beforeStatus === 'gate_check')) return null
    const latestSelfCritiqueIndex = findLatestWorkerSelfCritiqueIndex(task)
    if (latestSelfCritiqueIndex < 0) return null
    const latestRejectionIndex = findLatestWorkerSelfCritiqueRejectionIndex(task)
    if (latestRejectionIndex > latestSelfCritiqueIndex) return null
    if (acceptanceCommandGateFailureIsNewerThanSelfCritique(task)) return null
    const likelyTargets = resolveLikelyTaskFiles(task)
    const likelyLocalWebStarter =
      likelyTargets.some((file) => /(?:^|\/)package\.json$/.test(file)) &&
      likelyTargets.some((file) => /(?:^|\/)index\.html$/.test(file))
    const hasCommandBackedAcceptance = task.acceptanceCriteria.some((criterion) =>
      typeof criterion.command === 'string' && criterion.command.trim().length > 0,
    )
    const proofSetupNeedsCommand = isProofSetupTask(task) && (
      !taskHasConcreteProjectProofCommand(task) || !proofSetupHasTaskIdentity(task)
    )
    if (!proofSetupNeedsCommand && !likelyLocalWebStarter && !hasCommandBackedAcceptance) return null
    if (
      beforeStatus === 'review' &&
      hasMixedReviewAndAutomatedAcceptanceCriteria(task) &&
      (
        shouldAdvanceToGateCheckPendingAutomatedVerification(task) ||
        workerSelfCritiqueMarksAcceptanceCriteriaMetBeforeHardGates(task)
      )
    ) {
      return null
    }
    const dirtyTaskFiles = await this.changedFilesForTask(task)
    const hasCommittedTaskWork = await this.taskWorktreeHasCommittedProgress(task)
    if (!proofSetupNeedsCommand && (dirtyTaskFiles.length > 0 || hasCommittedTaskWork)) return null

    const now = this.now()
    await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const queuedTask = queue.tasks.find((candidate) => candidate.id === task.id)
      if (!queuedTask) return
      if (findLatestWorkerSelfCritiqueRejectionIndex(queuedTask) > findLatestWorkerSelfCritiqueIndex(queuedTask)) {
        return
      }
      queuedTask.status = 'in_progress'
      queuedTask.assignedTo = 'worker-agent'
      queuedTask.notes.push({
        agentId: 'coordinator',
        role: 'worker-progress-review',
        structured: {
          event: 'worker_self_critique_rejected',
          reason: proofSetupNeedsCommand ? 'proof_command_missing' : 'no_project_file_changes',
        },
        content:
          proofSetupNeedsCommand
            ? 'Guildhall rejected the proof-setup handoff because its typed contract is missing an exact task-specific project command or stable task-identity marker. Do not use a broad workspace build or test as proof; record the concrete command, required marker, and matching proof path before writing another self-critique.'
            : 'Guildhall rejected the stale worker self-critique without project-file changes outside `.guildhall`. Resume implementation by creating or editing the likely target files, then run focused verification before writing another self-critique.',
        timestamp: now,
      })
      queuedTask.updatedAt = now
      queue.lastUpdated = now
      await this.writeQueue(queue)
    })

    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: task.id,
      agent_name: 'coordinator-remediation',
      is_error: true,
      message:
        proofSetupNeedsCommand
          ? 'Rejected a proof-setup handoff because its exact command or stable task-identity marker is missing.'
          : 'Rejected a stale worker self-critique because the project has no implementation-file changes.',
    })

    return {
      kind: 'processed',
      taskId: task.id,
      agent: 'coordinator-remediation',
      beforeStatus,
      afterStatus: 'in_progress',
      transitioned: beforeStatus !== 'in_progress',
      revisionCount: task.revisionCount,
    }
  }

  private hasDurableWorkerHandoffEvidence(metadata: Record<string, unknown> | undefined, taskId: string): boolean {
    if (!metadata || !taskId) return false
    const rawEvidence = metadata['review_handoff_evidence']
    const evidence =
      rawEvidence && typeof rawEvidence === 'object' && !Array.isArray(rawEvidence)
        ? (rawEvidence as Record<string, unknown>)
        : null
    const evidenceMatchesTask =
      evidence !== null &&
      String(evidence['taskId'] ?? '').trim() === taskId &&
      evidence['changedOrVerified'] === true

    const hasMeaningfulVerifiedWork = readRecentVerificationResults(metadata)
      .some((entry) => entry.passed)

    return evidenceMatchesTask || hasMeaningfulVerifiedWork
  }

  private async taskWorktreeHasCommittedProgress(task: Task): Promise<boolean> {
    const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
    const workspace = await readTaskWorkspaceStore(projectRoot)
      .then((store) => store.workspaces[task.id] ?? null)
      .catch(() => null)
    const worktreePath = task.worktreePath?.trim() || workspace?.worktreePath?.trim()
    const baseBranch = task.baseBranch?.trim() || workspace?.baseBranch?.trim()
    if (!worktreePath || !baseBranch) return false
    const resolvedWorktreePath = resolveRuntimePath(worktreePath)
    if (!existsSync(resolvedWorktreePath)) return false
    try {
      const commits = await this.gitDriver.localCommits(resolvedWorktreePath, baseBranch)
      return commits.length > 0
    } catch {
      return false
    }
  }

  private checkpointTouchedFilesFromMetadata(
    metadata: Record<string, unknown> | undefined,
    repoRoot?: string,
  ): string[] {
    if (!metadata) return []
    const raw = metadata['current_task_checkpoint_files_touched']
    const explicitFiles = Array.isArray(raw)
      ? raw
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : []
    if (explicitFiles.length > 0) return [...new Set(explicitFiles)]

    const recentVerifiedWork = Array.isArray(metadata['recent_verified_work'])
      ? (metadata['recent_verified_work'] as unknown[])
          .filter((value): value is string => typeof value === 'string')
      : []
    const normalizedRepoRoot = repoRoot?.trim() ? path.resolve(repoRoot) : null
    const inferredFiles = recentVerifiedWork
      .map((entry) => {
        const match = entry.trim().match(/^(Edited file|Wrote file)\s+(.+)$/)
        if (!match) return null
        const rawPath = match[2]?.trim() ?? ''
        if (!rawPath) return null
        if (normalizedRepoRoot && path.isAbsolute(rawPath)) {
          const relative = path.relative(normalizedRepoRoot, rawPath)
          if (
            relative.length > 0 &&
            !relative.startsWith('..') &&
            !path.isAbsolute(relative)
          ) {
            return relative
          }
        }
        return rawPath
      })
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    return [...new Set(inferredFiles)]
  }

  private async preserveDurableProgressAfterEmptyAssistant(input: {
    taskId: string
    agentName: string
    beforeStatus: TaskStatus
    agentMetadata?: Record<string, unknown>
  }): Promise<TickOutcome | null> {
    if (input.beforeStatus !== 'in_progress') return null
    const queue = await this.readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === input.taskId)
    if (!task || (task.status !== 'in_progress' && task.status !== 'blocked')) return null
    const hasDirtyWorktree =
      typeof task.worktreePath === 'string' &&
      task.worktreePath.trim().length > 0 &&
      !(await this.gitDriver.isClean(resolveRuntimePath(task.worktreePath)))
    if (!this.hasDurableWorkerHandoffEvidence(input.agentMetadata, task.id)) return null
    const checkpointTouchedFiles = this.checkpointTouchedFilesFromMetadata(
      input.agentMetadata,
      this.resolveEffectiveTaskProjectPath(task),
    )
    if (!hasDirtyWorktree && checkpointTouchedFiles.length === 0) return null

    const checkpointWritten = await this.writeWorkerRecoveryCheckpoint({
      task,
      agentName: input.agentName,
      metadata: input.agentMetadata,
      reason: 'empty assistant reply after verified progress',
    })
    const blockReason =
      'empty assistant reply after verified progress: The model stopped returning usable assistant text after tool progress. Guildhall saved a recovery checkpoint so the task can resume cleanly.'
    const now = this.now()
    let afterStatus: TaskStatus = task.status
    if (task.status !== 'blocked') {
      await this.withQueueWriteLock(async () => {
        const queue = await this.readQueue()
        const queuedTask = queue.tasks.find((candidate) => candidate.id === input.taskId)
        if (!queuedTask || queuedTask.status === 'blocked') {
          afterStatus = queuedTask?.status ?? task.status
          return
        }
        transitionTaskStatus({
          task: queuedTask,
          event: 'block',
          actor: 'empty-assistant-recovery',
          evidenceRefs: ['task:worker-recovery-checkpoint'],
          now,
        })
        queuedTask.assignedTo = null
        queuedTask.blockReason = blockReason
        queuedTask.updatedAt = now
        queuedTask.notes.push({
          agentId: 'coordinator',
          role: 'checkpoint',
          content:
            'Guildhall saved a recovery checkpoint after the model stopped responding clearly following verified worker progress. Resume the task to continue from that checkpoint.',
          timestamp: now,
        })
        queue.lastUpdated = now
        await this.writeQueue(queue)
        afterStatus = 'blocked'
      })
    }

    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: task.id,
      agent_name: input.agentName,
      message:
        task.status === 'blocked'
          ? checkpointWritten
            ? 'Saved a recovery checkpoint after the model stopped responding clearly. The existing blocker is still the task state to resolve.'
            : 'The model stopped responding clearly after verified progress. The existing blocker is still the task state to resolve.'
          : checkpointWritten
            ? 'Saved a recovery checkpoint after the model stopped responding clearly.'
            : 'The model stopped responding clearly after verified progress; Guildhall kept the task resumable.',
    })

    const transitioned = afterStatus !== input.beforeStatus
    return {
      kind: 'processed',
      taskId: task.id,
      agent: input.agentName,
      beforeStatus: input.beforeStatus,
      afterStatus,
      transitioned,
      revisionCount: task.revisionCount,
    }
  }

  private async preserveReviewStateAfterEmptyAssistant(input: {
    taskId: string
    agentName: string
    beforeStatus: TaskStatus
  }): Promise<TickOutcome | null> {
    if (input.beforeStatus !== 'review') return null
    const queue = await this.readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === input.taskId)
    if (!task || task.status !== 'review' || task.blockReason) return null

    const ownershipChanged = task.assignedTo !== 'reviewer-agent'
    if (ownershipChanged) {
      ensureReviewerOwnership(task)
      task.updatedAt = this.now()
      queue.lastUpdated = this.now()
      await this.writeQueue(queue)
    }

    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: task.id,
      agent_name: input.agentName,
      message:
        ownershipChanged
          ? 'The model ghosted after a durable review handoff, but the task was already in review. Guildhall kept it there and normalized ownership back to the reviewer lane.'
          : 'The model ghosted after a durable review handoff, but the task was already in review. Guildhall kept the review state intact instead of surfacing a fake run failure.',
    })

    return {
      kind: 'processed',
      taskId: task.id,
      agent: input.agentName,
      beforeStatus: input.beforeStatus,
      afterStatus: task.status,
      transitioned: false,
      revisionCount: task.revisionCount,
    }
  }

  private async normalizeReviewOwnership(task: Task): Promise<void> {
    if (task.status !== 'review' || hasPendingHandoffStep(task) || task.assignedTo === 'reviewer-agent') {
      return
    }
    await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const liveTask = queue.tasks.find((candidate) => candidate.id === task.id)
      if (!liveTask || liveTask.status !== 'review' || hasPendingHandoffStep(liveTask)) return
      if (liveTask.assignedTo === 'reviewer-agent') {
        task.assignedTo = 'reviewer-agent'
        return
      }
      ensureReviewerOwnership(liveTask)
      liveTask.updatedAt = this.now()
      queue.lastUpdated = this.now()
      await this.writeQueue(queue)
      task.assignedTo = 'reviewer-agent'
      task.updatedAt = liveTask.updatedAt
    })
  }

  private async normalizeGateCheckOwnership(task: Task): Promise<void> {
    if (task.status !== 'gate_check' || task.assignedTo === 'gate-checker-agent') {
      return
    }
    await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const liveTask = queue.tasks.find((candidate) => candidate.id === task.id)
      if (!liveTask || liveTask.status !== 'gate_check') return
      if (liveTask.assignedTo === 'gate-checker-agent') {
        task.assignedTo = 'gate-checker-agent'
        return
      }
      liveTask.assignedTo = 'gate-checker-agent'
      liveTask.updatedAt = this.now()
      queue.lastUpdated = this.now()
      await this.writeQueue(queue)
      await upsertTaskRuntimeState(inferProjectRootFromMemoryDir(this.opts.config.memoryDir), liveTask.id, {
        assignedTo: 'gate-checker-agent',
        updatedAt: liveTask.updatedAt,
      })
      task.assignedTo = 'gate-checker-agent'
      task.updatedAt = liveTask.updatedAt
    })
  }

  private async normalizeSpecReviewOwnership(task: Task): Promise<void> {
    if (task.status !== 'spec_review' || task.assignedTo == null) {
      return
    }
    await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const liveTask = queue.tasks.find((candidate) => candidate.id === task.id)
      if (!liveTask || liveTask.status !== 'spec_review') return
      if (liveTask.assignedTo == null) {
        task.assignedTo = null
        return
      }
      liveTask.assignedTo = null
      liveTask.updatedAt = this.now()
      queue.lastUpdated = this.now()
      await this.writeQueue(queue)
      task.assignedTo = null
      task.updatedAt = liveTask.updatedAt
    })
  }

  private async normalizeTerminalOwnership(task: Task): Promise<void> {
    if (
      task.status !== 'done' && task.status !== 'blocked' && task.status !== 'shelved'
    ) {
      return
    }
    await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const liveTask = queue.tasks.find((candidate) => candidate.id === task.id)
      if (
        !liveTask ||
        (liveTask.status !== 'done' && liveTask.status !== 'blocked' && liveTask.status !== 'shelved')
      ) return
      const now = this.now()
      if (liveTask.assignedTo != null) {
        liveTask.assignedTo = null
        liveTask.updatedAt = now
        queue.lastUpdated = now
        await this.writeQueue(queue)
      }
      await upsertTaskRuntimeState(inferProjectRootFromMemoryDir(this.opts.config.memoryDir), liveTask.id, {
        assignedTo: null,
        updatedAt: liveTask.updatedAt,
      })
      task.assignedTo = null
      task.updatedAt = liveTask.updatedAt
    })
  }

  private async normalizeQueuedReviewOwnership(queue: TaskQueue, dispatchCapacity = 1): Promise<TaskQueue> {
    const activeWorkerTasks = queue.tasks
      .filter((task) =>
        task.status === 'in_progress' &&
        task.assignedTo === 'worker-agent',
      )
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    const excessActiveWorkerIds = dispatchCapacity <= 1
      ? activeWorkerTasks.slice(1).map((task) => task.id)
      : []
    const nowMs = Date.now()
    const liveSpecTaskIds = new Set(
      this.livenessTracker.snapshot()
        .filter(entry => entry.agentId === 'spec-agent')
        .map(entry => entry.taskId),
    )
    const staleExploringSpecIds = dispatchCapacity <= 1
      ? queue.tasks
          .filter(task => hasStaleExploringSpecClaim(task, nowMs, liveSpecTaskIds))
          .map((task) => task.id)
      : []
    const staleRetryWindowIds = queue.tasks
      .filter((task) => ensureRetryWindow({ ...task }))
      .map((task) => task.id)
    const staleWorkerIds = queue.tasks
      .filter((task) =>
        task.status === 'in_progress' &&
        task.assignedTo !== 'worker-agent',
      )
      .map((task) => task.id)
    const staleReviewIds = queue.tasks
      .filter((task) =>
        task.status === 'review' &&
        !hasPendingHandoffStep(task) &&
        task.assignedTo !== 'reviewer-agent',
      )
      .map((task) => task.id)
    const staleGateCheckIds = queue.tasks
      .filter((task) =>
        task.status === 'gate_check' &&
        task.assignedTo !== 'gate-checker-agent',
      )
      .map((task) => task.id)
    const staleSpecReviewIds = queue.tasks
      .filter((task) =>
        task.status === 'spec_review' &&
        task.assignedTo != null,
      )
      .map((task) => task.id)
    const staleTerminalIds = queue.tasks
      .filter((task) =>
        (task.status === 'done' || task.status === 'blocked' || task.status === 'shelved') &&
        task.assignedTo != null,
      )
      .map((task) => task.id)

    if (
      staleRetryWindowIds.length === 0 &&
      staleWorkerIds.length === 0 &&
      staleReviewIds.length === 0 &&
      staleGateCheckIds.length === 0 &&
      staleSpecReviewIds.length === 0 &&
      staleTerminalIds.length === 0 &&
      staleExploringSpecIds.length === 0 &&
      excessActiveWorkerIds.length === 0
    ) return queue

    let normalizedQueue = queue
    await this.withQueueWriteLock(async () => {
      const liveQueue = await this.readQueue()
      let changed = false
      for (const task of liveQueue.tasks) {
        if (ensureRetryWindow(task)) {
          task.updatedAt = this.now()
          changed = true
        }
        if (
          task.status === 'in_progress' &&
          task.assignedTo !== 'worker-agent'
        ) {
          ensureWorkerOwnership(task)
          task.updatedAt = this.now()
          changed = true
        } else if (excessActiveWorkerIds.includes(task.id)) {
          task.status = 'ready'
          task.assignedTo = null
          task.updatedAt = this.now()
          task.notes ??= []
          task.notes.push({
            agentId: 'coordinator',
            role: 'recovery',
            content:
              'Runtime normalized this task back to the runnable queue because the project is in serial dispatch and had multiple worker tasks marked active.',
            timestamp: this.now(),
          })
          changed = true
        } else if (staleExploringSpecIds.includes(task.id)) {
          task.assignedTo = null
          task.updatedAt = this.now()
          task.notes ??= []
          task.notes.push({
            agentId: 'coordinator',
            role: 'recovery',
            structured: {
              event: 'stale_spec_claim_cleared',
              source: 'runtime',
            },
            content:
              'Runtime cleared a stale spec-agent claim so this draft waits in the shaping queue instead of pretending an agent is actively working on it.',
            timestamp: this.now(),
          })
          changed = true
        } else if (
          task.status === 'review' &&
          !hasPendingHandoffStep(task) &&
          task.assignedTo !== 'reviewer-agent'
        ) {
          ensureReviewerOwnership(task)
          task.updatedAt = this.now()
          changed = true
        } else if (
          task.status === 'gate_check' &&
          task.assignedTo !== 'gate-checker-agent'
        ) {
          task.assignedTo = 'gate-checker-agent'
          task.updatedAt = this.now()
          changed = true
        } else if (
          task.status === 'spec_review' &&
          task.assignedTo != null
        ) {
          task.assignedTo = null
          task.updatedAt = this.now()
          changed = true
        } else if (
          (task.status === 'done' || task.status === 'blocked' || task.status === 'shelved') &&
          task.assignedTo != null
        ) {
          task.assignedTo = null
          task.updatedAt = this.now()
          changed = true
        }
      }
      if (!changed) {
        normalizedQueue = liveQueue
        return
      }
      liveQueue.lastUpdated = this.now()
      await this.writeQueue(liveQueue)
      normalizedQueue = liveQueue
    })
    return normalizedQueue
  }

  private async writeBootstrapVerificationCheckpoint(input: {
    task: Task
    agentName: string
    activeWorktreePath: string
    command: string
    output: string
    observedAt: string
  }): Promise<boolean> {
    if (input.task.status !== 'in_progress') return false
    const command = input.command.trim()
    if (!command) return false

    const worktreeRoot = path.resolve(input.activeWorktreePath)
    let filesTouched = await this.changedFilesForTask(input.task)
    if (filesTouched.length === 0) {
      filesTouched = resolveLikelyTaskFiles(input.task)
        .map((file) => taskRelativeCheckpointPath(file, worktreeRoot))
        .filter((file) => file.length > 0 && !isIgnorableCheckpointPath(file))
        .slice(0, 12)
    }
    filesTouched = uniqueNonEmptyStrings(filesTouched)

    const likelyFiles = resolveLikelyTaskFiles(input.task, filesTouched)
    const companionFiles = uniqueNonEmptyStrings(
      likelyFiles
        .map((file) => taskRelativeCheckpointPath(file, worktreeRoot))
        .filter((file) => file.length > 0 && !filesTouched.includes(file)),
    ).slice(0, 8)
    const verification: CheckpointResumeContext['verification'] = [{
      command,
      passed: false,
      observedAt: input.observedAt,
      ...(input.output.trim() ? { summary: input.output.trim() } : {}),
    }]
    const safeNextMutationSurface = checkpointSafeNextMutationSurface(
      filesTouched,
      companionFiles,
      verification,
    )
    const workingHypothesis = checkpointWorkingHypothesis({
      existing: '',
      verification,
      companionFiles,
      safeNextMutationSurface,
    })

    const result = await writeCheckpoint({
      tasksPath: this.tasksPath(),
      memoryDir: this.opts.config.memoryDir,
      taskId: input.task.id,
      agentId: input.agentName,
      intent:
        'Worker recovery checkpoint after dirty task worktree bootstrap verification failed. ' +
        `Failed command: ${command}`,
      nextPlannedAction:
        'Resume from the recorded bootstrap verification failure, rerun the focused verification command, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.',
      nextActionKind: 'rerun_verification',
      filesTouched,
      resumeContext: {
        verification,
        companionFiles,
        ...(workingHypothesis ? { workingHypothesis } : {}),
        safeNextMutationSurface,
      },
    })
    return result.success
  }

  private async writeWorkerRecoveryCheckpoint(input: {
    task: Task
    agentName: string
    metadata?: Record<string, unknown>
    reason: string
  }): Promise<boolean> {
    if (input.task.status !== 'in_progress' && input.task.status !== 'blocked') return false

    const effectiveProjectPath = this.resolveEffectiveTaskProjectPath(input.task)
    const existingCheckpoint = await readCheckpoint(this.opts.config.memoryDir, input.task.id).catch(() => null)
    let filesTouched = await this.changedFilesForTask(input.task)
    if (filesTouched.length === 0) {
      filesTouched = this.checkpointTouchedFilesFromMetadata(
        input.metadata,
        effectiveProjectPath,
      )
    }
    if (filesTouched.length === 0) {
      filesTouched = existingCheckpoint?.filesTouched ?? []
    }
    const recentVerificationResults = readRecentVerificationResults(input.metadata)
    if (recentVerificationResults.length > 0) {
      reconcileAutomatedAcceptanceCommandsFromVerificationResults({
        task: input.task,
        workspaceProjectPath: this.opts.config.projectPath,
        workspaceProjects: this.workspaceProjectsForTaskResolution(),
        recentVerificationResults,
      })
    }
    const recentVerifiedWork = Array.isArray(input.metadata?.['recent_verified_work'])
      ? (input.metadata?.['recent_verified_work'] as unknown[])
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : []
    const latestSelfCritique = [...input.task.notes]
      .reverse()
      .find((note) => isWorkerSelfCritiqueNote(note, input.agentName))?.content
      .trim()
    let verification = checkpointVerificationHistoryFromMetadata(input.metadata)
    if (verification.length === 0 && recentVerificationResults.length > 0) {
      verification = recentVerificationResults.map(result => ({
        command: result.command,
        passed: result.passed,
        observedAt: result.observedAt ?? this.now(),
      }))
    }
    if (verification.length === 0) {
      verification = existingCheckpoint?.resumeContext?.verification ?? []
    }
    const companionFiles = checkpointCompanionFilesFromMetadata(
      input.metadata,
      effectiveProjectPath,
      filesTouched,
    )
    const safeNextMutationSurface = checkpointSafeNextMutationSurface(
      filesTouched,
      companionFiles,
      verification,
    )
    const workingHypothesis = checkpointWorkingHypothesis({
      existing: String(input.metadata?.['current_task_checkpoint_working_hypothesis'] ?? ''),
      verification,
      companionFiles,
      safeNextMutationSurface,
    })

    const verificationSummary = recentVerifiedWork
      .filter((entry) => /^(Ran bash command|Edited file|Wrote file)\b/.test(entry.trim()))
      .slice(-3)
    const hasRecordedVerificationFailure = checkpointHasRecordedVerificationFailure(verification)
    const intentParts = [
      `Worker recovery checkpoint after ${input.reason}.`,
      verificationSummary.length > 0
        ? `Recent verified work: ${verificationSummary.join(' ; ')}`
        : 'Recent verified work existed in runtime metadata.',
    ]
    const nextAction =
      latestSelfCritique && (verificationSummary.length > 0 || hasRecordedVerificationFailure)
        ? 'Resume from the latest self-critique and verification evidence, then hand off to review if no new blocker appears.'
        : latestSelfCritique
          ? 'Resume from the latest self-critique, rerun any missing focused verification, then hand off to review.'
          : (verificationSummary.length > 0 || hasRecordedVerificationFailure)
            ? 'Resume from the recorded verification evidence, rerun the focused verification commands, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.'
            : 'Resume from the active worktree diff, refresh focused verification, and keep the task in implementation until the focused checks are green.'
    const nextActionKind: Checkpoint['nextActionKind'] =
      latestSelfCritique && (verificationSummary.length > 0 || hasRecordedVerificationFailure)
        ? 'review_handoff'
        : latestSelfCritique
          ? 'continue_work'
          : (verificationSummary.length > 0 || hasRecordedVerificationFailure)
            ? 'rerun_verification'
            : 'continue_work'

    const result = await writeCheckpoint({
      tasksPath: this.tasksPath(),
      memoryDir: this.opts.config.memoryDir,
      taskId: input.task.id,
      agentId: input.agentName,
      intent: intentParts.join(' '),
      nextPlannedAction: nextAction,
      nextActionKind,
      filesTouched,
      resumeContext: {
        verification,
        companionFiles,
        ...(workingHypothesis ? { workingHypothesis } : {}),
        safeNextMutationSurface,
      },
    })
    return result.success
  }

  private async changedFilesForTask(task: Task): Promise<string[]> {
    const repoRoot =
      typeof task.worktreePath === 'string' && task.worktreePath.trim().length > 0
        ? resolveRuntimePath(task.worktreePath)
        : this.resolveEffectiveTaskProjectPath(task)
    try {
      const { stdout } = await execFileP('git', ['status', '--short', '--untracked-files=all'], {
        cwd: repoRoot,
        maxBuffer: 1024 * 1024,
      })
      return stdout
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => line.slice(3).trim())
        .filter((file) => file.length > 0 && !isIgnorableCheckpointPath(file))
        .slice(0, 12)
    } catch {
      return []
    }
  }

  private async refreshCorpusMapForTask(input: {
    task: Task
    projectRoot: string
    touchedFiles: readonly string[]
    reason: 'worker-completion'
  }): Promise<void> {
    const touchedFiles = uniqueStrings(
      input.touchedFiles
        .map((file) => file.trim())
        .filter((file) => file.length > 0 && !isIgnorableCheckpointPath(file)),
    )
    if (touchedFiles.length === 0) return
    try {
      await refreshCodebaseMap({
        projectRoot: input.projectRoot,
        memoryDir: this.opts.config.memoryDir,
        reason: input.reason,
        touchedFiles,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await this.emitBackendEvent({
        type: 'line_complete',
        task_id: input.task.id,
        agent_name: 'corpus-map',
        is_error: true,
        message: `Corpus Map refresh failed after worker completion: ${message}`,
      })
    }
  }

  private fileMatchesLikelyTarget(
    candidate: string,
    likelyTargets: readonly string[],
    repoRoot?: string,
  ): boolean {
    const trimmed = candidate.trim()
    if (!trimmed) return false
    const resolvedCandidate =
      repoRoot && !path.isAbsolute(trimmed)
        ? path.resolve(repoRoot, trimmed)
        : path.resolve(trimmed)
    return likelyTargets.some((target) => path.resolve(target) === resolvedCandidate)
  }

  private async persistExploringTranscript(input: {
    taskId: string
    generatedText: string
  }): Promise<{
    transcriptAppended: boolean
  }> {
    const queue = await this.readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === input.taskId)
    if (!task || task.status !== 'exploring') {
      return {
        transcriptAppended: false,
      }
    }
    if (hasFreshReframeBoundary(task)) {
      return {
        transcriptAppended: false,
      }
    }

    const text = input.generatedText.trim()
    if (!text) {
      return {
        transcriptAppended: false,
      }
    }

    const transcriptResult = await ensureExploringTranscriptEntry({
      memoryDir: this.opts.config.memoryDir,
      taskId: task.id,
      role: 'spec-agent',
      content: text,
    })
    const transcriptAppended = transcriptResult.appended === true

    // Do not parse assistant prose into product state. A spec-agent must use
    // the structured task/question tools; otherwise the turn remains bounded
    // audit context and the task stays where the durable state left it.
    return {
      transcriptAppended,
    }

  }

  private async preserveTaskStateOnRetryableProviderError(input: {
    taskId: string
    agentName: string
    beforeStatus: TaskStatus
    error: string
  }): Promise<TickOutcome> {
    const queue = await this.readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === input.taskId)
    if (!task) {
      return {
        kind: 'agent-error',
        taskId: input.taskId,
        agent: input.agentName,
        error: input.error,
      }
    }

    task.status = input.beforeStatus
    task.updatedAt = this.now()
    queue.lastUpdated = this.now()
    resolveSupersededEscalations(task, {
      now: task.updatedAt,
      resolvedBy: 'system',
      resolution:
        `Superseded after Guildhall preserved ${input.beforeStatus} during a retryable provider throttle.`,
    })
    await this.writeQueue(queue)

    const note =
      `provider backoff: ${input.error}. Preserving ${input.beforeStatus} so the task can resume without rework.`

    await this.logTickProgress({
      task,
      agent: input.agentName,
      beforeStatus: input.beforeStatus,
      afterStatus: input.beforeStatus,
      transitioned: false,
      note,
    })
    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: task.id,
      agent_name: input.agentName,
      message:
        `Provider capacity interrupted ${input.beforeStatus}. Guildhall preserved the task state so the run can resume once the provider is available again.`,
    })

    return {
      kind: 'provider-backoff',
      taskId: task.id,
      agent: input.agentName,
      status: input.beforeStatus,
      error: input.error,
    }
  }

  /**
   * Append a FR-09 typed progress entry. Classification:
   *   - milestone : task reached `done` (all gates passed)
   *   - blocked   : task reached `blocked` (max revisions or hard block)
   *   - escalation: agent error requiring human attention
   *   - heartbeat : a real transition that isn't one of the above
   *
   * No-op ticks (agent ran, chose not to transition, no error) are NOT
   * written here — that kind of liveness signal belongs in the ephemeral
   * SSE stream, not the on-disk progress history.
   */
  private async logTickProgress(entry: {
    task: Task
    agent: string
    beforeStatus: TaskStatus
    afterStatus: TaskStatus
    transitioned: boolean
    note?: string
  }): Promise<void> {
    const isError = entry.note?.startsWith('error:') ?? false
    const hasMeaningfulNote =
      entry.note !== undefined && entry.note !== 'no transition'
    if (!entry.transitioned && !isError && !hasMeaningfulNote) return

    const type = this.classifyEntry(entry.afterStatus, entry.note)
    const arrow = entry.transitioned
      ? `${entry.beforeStatus} → ${entry.afterStatus}`
      : `${entry.beforeStatus} (unchanged)`
    const summary = entry.note
      ? `${entry.task.title} — ${arrow}. ${entry.note}`
      : `${entry.task.title} — ${arrow}`

    const progressEntry: ProgressEntry = {
      timestamp: this.now(),
      agentId: entry.agent,
      domain: entry.task.domain,
      taskId: entry.task.id,
      summary,
      type,
    }

    try {
      await logProgress({ progressPath: this.progressPath(), entry: progressEntry })
    } catch {
      // PROGRESS.md unwriteable — non-fatal for the feedback loop itself
    }
    try {
      await recordMemoryEvent({
        projectRoot: this.config.projectPath,
        event: {
          scope: this.memoryScopeForProgress(entry),
          source: {
            kind: 'progress',
            ref: `PROGRESS.md#${entry.task.id}`,
            path: 'project-state/PROGRESS.md',
            capturedAt: progressEntry.timestamp,
          },
          content: {
            summary,
            json: progressEntry,
          },
          metadata: {
            projectId: this.projectMemoryId(),
            taskId: entry.task.id,
            agentRole: roleForAgentName(entry.agent),
            status: entry.afterStatus,
            retention: 'task_lifecycle',
            risk: type === 'escalation' || type === 'blocked' ? 'medium' : 'low',
          },
        },
        now: () => new Date(progressEntry.timestamp),
      })
    } catch {
      // Memory-core ingestion is useful context, not a reason to stall the task loop.
    }
  }

  private memoryScopeForProgress(entry: {
    task: Task
    agent: string
  }): GuildhallMemoryScope {
    return {
      kind: 'task_thread',
      projectId: this.projectMemoryId(),
      taskId: entry.task.id,
      agentRole: memoryAgentRole(entry.agent),
      threadId: entry.task.id,
    }
  }

  private projectMemoryId(): string {
    return path.basename(this.config.projectPath) || this.config.workspaceId || 'project'
  }

  private classifyEntry(
    afterStatus: TaskStatus,
    note: string | undefined,
  ): ProgressEntry['type'] {
    // Max-turns is self-healing (the next tick resumes), not a real failure —
    // don't inflate it to an escalation.
    if (note?.startsWith('error:') && !/Exceeded maximum turn limit/.test(note)) {
      return 'escalation'
    }
    if (afterStatus === 'done') return 'milestone'
    if (afterStatus === 'blocked') return 'blocked'
    return 'heartbeat'
  }

  private now(): string {
    return this.opts.now?.() ?? new Date().toISOString()
  }

  private async emitBackendEvent(event: BackendEvent): Promise<void> {
    if (!this.opts.onBackendEvent) return
    try {
      await this.opts.onBackendEvent(event)
    } catch (err) {
      console.warn(
        `[guildhall] onBackendEvent threw (${event.type}): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private banner(): void {
    const c = this.opts.config
    console.log(`[guildhall] Workspace: ${c.workspaceName} (${c.workspaceId})`)
    console.log(`[guildhall] Project:   ${c.projectPath}`)
    console.log(`[guildhall] Memory:    ${c.memoryDir}`)
    console.log('[guildhall] Model assignment:')
    console.log(`  spec:        ${c.models.spec}`)
    console.log(`  coordinator: ${c.models.coordinator}`)
    console.log(`  worker:      ${c.models.worker}`)
    console.log(`  reviewer:    ${c.models.reviewer}`)
    console.log(`  gateChecker: ${c.models.gateChecker}`)
    console.log(`  contextIndexer: ${c.models.contextIndexer}`)
    console.log('[guildhall] Coordinator started.')
  }
}

function ensureWorkerOwnership(task: Task): void {
  task.assignedTo = 'worker-agent'
}

function ensureReviewerOwnership(task: Task): void {
  task.assignedTo = 'reviewer-agent'
}

// `pickNextTask` / `needsPreRejectionPolicy` live in `./orchestrator-picker.ts`
// so the fanout dispatcher (FR-24) can share the same priority/status order.
export { pickNextTask, needsPreRejectionPolicy } from './orchestrator-picker.js'

/**
 * Map a ResolvedConfig coordinator entry to the full CoordinatorDomain
 * type expected by createCoordinatorAgent.
 */
function toCoordinatorDomain(
  entry: ResolvedConfig['coordinators'][number],
): CoordinatorDomain {
  return {
    id: entry.id,
    name: entry.name,
    mandate: entry.mandate || `Coordinate work for the "${entry.domain}" domain.`,
    projectPaths: entry.path ? [entry.path] : [],
    concerns: entry.concerns.map((c) => ({
      id: c.id,
      description: c.description,
      reviewQuestions: c.reviewQuestions,
    })),
    autonomousDecisions: entry.autonomousDecisions,
    escalationTriggers: entry.escalationTriggers,
  }
}

async function sessionNamespaceForProject(config: ResolvedConfig): Promise<string> {
  const epochPath = getProjectSystemStatePath(
    inferProjectRootFromMemoryDir(config.memoryDir),
    '.session-epoch',
  )
  try {
    const existing = (await readManagedTextFile(epochPath, 'utf8')).trim()
    if (existing) return existing
  } catch {
    /* create below */
  }
  const epoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  await fs.mkdir(path.dirname(epochPath), { recursive: true })
  await writeManagedTextFile(epochPath, `${epoch}\n`, 'utf8')
  return epoch
}

/**
 * Back-compat entry point for the CLI. Builds the real agent set using the
 * not-yet-wired LLM provider stub and runs the orchestrator loop.
 */
export async function runOrchestrator(
  config: ResolvedConfig,
  opts: {
    maxTicks?: number
    tickDelayMs?: number
    stopAfterOneTask?: boolean
    domainFilter?: string
    onBackendEvent?: (event: BackendEvent) => void | Promise<void>
    stopSignal?: { stopRequested: boolean }
    abortSignal?: AbortSignal | undefined
    providerOverride?: string
    modelAssignmentOverride?: ModelAssignmentConfig
    agentGenerateTimeoutMs?: number
    agentGenerateWallClockTimeoutMs?: OrchestratorOptions['agentGenerateWallClockTimeoutMs']
    preferredTaskId?: string
  } = {},
): Promise<OrchestratorRunResult> {
  // Provider selection reads project-local config (`.guildhall/config.yaml`)
  // so the setup wizard's choices (preferredProvider, pasted API keys, LM
  // Studio URL) actually take effect at orchestrator boot. Keys in env vars
  // still win as ambient defaults; values from disk override them when set.
  const projectCfg = readProjectConfig(config.projectPath)
  // Credentials live in the global store (~/.guildhall/providers.yaml) —
  // env vars still win during normalized runtime resolution.
  // Any legacy project-local keys are opportunistically migrated before we
  // read them, so pre-0.3 projects get cleaned up on first boot.
  try {
    migrateProjectProvidersToGlobal(config.projectPath, {
      readProject: (p) => readProjectConfig(p),
      writeProject: (p, patch) => updateProjectConfig(p, patch),
    })
  } catch {
    /* best-effort — never block orchestrator boot on migration */
  }
  const runtimeProvider = getRuntimeProviderConfig({
    projectPath: config.projectPath,
    models: config.models,
    ...(opts.providerOverride
      ? { providerOverride: opts.providerOverride as SelectApiClientOptions['provider'] }
      : {}),
  })
  const selection = await selectApiClient(runtimeProvider.selectOptions)
  if (selection.providerName === 'none') {
    console.warn(`[guildhall] ${selection.reason}`)
  } else {
    const detail = selection.reason ? ` (${selection.reason})` : ''
    console.log(`[guildhall] Provider: ${selection.providerName}${detail}`)
  }
  const apiClient = selection.apiClient
  const effectiveModels = opts.modelAssignmentOverride ?? config.models
  const effectiveConfig: ResolvedConfig = { ...config, models: effectiveModels }
  const models = buildModelSet(effectiveModels, apiClient, effectiveConfig.modelBehavior ?? {})

  // FR-17: load bundled + user + workspace skills once per run. Each agent
  // factory receives the same frozen skill list so the composed system prompt
  // is deterministic across the orchestrator loop.
  const workspaceSkillDir = path.join(config.memoryDir, '..', 'skills')
  const workspaceSkillDirs = config.skills?.projectLocal?.enabled === true ? [workspaceSkillDir] : []
  const skills = loadSkillRegistry({ extraSkillDirs: workspaceSkillDirs }).listSkills()

  // FR-18: build a single HookExecutor from the workspace config's `hooks`
  // passthrough. Every agent shares the same executor so hook state (e.g. a
  // counter in an HTTP hook's receiver) is consistent across roles, and the
  // orchestrator uses it for SESSION_START / SESSION_END.
  const hookExecutor = buildHookExecutor({
    config: effectiveConfig,
    apiClient,
    defaultModel: effectiveModels.worker,
  })

  // FR-19: shared reactive compactor. The engine only invokes this when a
  // turn fails with a prompt-too-long error, so it stays dormant on healthy
  // runs. Same api client is reused — compaction is a Claude summary call,
  // not a separate provider concept.
  const compactor = buildDefaultCompactor({
    apiClient,
    model: effectiveModels.worker,
  })

  // Intake conversation is rewritten into essential history after every
  // transcript append by the cheap context-indexer lane. Raw conversation is
  // not a durable project-state format.
  const transcriptSummarizer = buildEssentialHistorySummarizer({
    apiClient,
    model: effectiveModels.contextIndexer,
  })

  // FR-20: each agent gets auto-persisted snapshots under the project cwd so
  // a halted orchestrator can be resumed without losing per-role history. We
  // key sessions by agent role so the five roles don't stomp each other; the
  // workspace id is folded in to keep multi-project setups isolated.
  const sessionNamespace = await sessionNamespaceForProject(config)
  const sessionIdFor = (role: string) => `${config.workspaceId}-${sessionNamespace}-${role}`
  const persistFor = (role: string) => ({
    cwd: config.projectPath,
    sessionId: sessionIdFor(role),
  })

  // FR-21 parity: connect to configured MCP servers and inject their tools
  // into every agent's registry. A failed server surfaces via McpConnectionStatus
  // but the workspace still boots — upstream treats MCP as best-effort.
  const mcpServers = config.mcp?.servers ?? {}
  const mcpManager = new McpClientManager(mcpServers)
  if (Object.keys(mcpServers).length > 0) {
    try {
      await mcpManager.connectAll()
      const connected = mcpManager.listStatuses().filter((s) => s.state === 'connected').length
      const total = mcpManager.listStatuses().length
      console.log(`[guildhall] MCP: ${connected}/${total} server(s) connected`)
    } catch (err) {
      console.warn(
        `[guildhall] MCP connectAll failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  const mcpTools = createMcpTools(mcpManager)

  const baseAgentOpts = {
    skills,
    compactor,
    transcriptSummarizer,
    cwd: config.projectPath,
    extraTools: mcpTools,
    ...(hookExecutor ? { hookExecutor } : {}),
  }

  const specAgentInst = createSpecAgent(models.spec, {
    ...baseAgentOpts,
    sessionPersistence: persistFor('spec'),
  })
  const workerAgentInst = createWorkerAgent(models.worker, {
    ...baseAgentOpts,
    sessionPersistence: persistFor('worker'),
  })
  const reviewerAgentInst = createReviewerAgent(models.reviewer, {
    ...baseAgentOpts,
    sessionPersistence: persistFor('reviewer'),
  })
  const gateCheckerAgentInst = createGateCheckerAgent(models.gateChecker, {
    ...baseAgentOpts,
    sessionPersistence: persistFor('gate-checker'),
    ...(config.bootstrap
      ? { successGates: effectiveBootstrapGateCommands(config.bootstrap) }
      : {}),
  })
  const coordinators: Record<string, GuildhallAgent> = Object.fromEntries(
    config.coordinators.map((entry) => [
      entry.domain,
      createCoordinatorAgent(toCoordinatorDomain(entry), models.coordinator, {
        ...baseAgentOpts,
        sessionPersistence: persistFor(`coordinator-${entry.domain}`),
      }),
    ]),
  )

  let resumeQueue: TaskQueue | null = null
  try {
    resumeQueue = TaskQueue.parse(readProjectTaskQueueSync(
      getProjectSystemStatePath(inferProjectRootFromMemoryDir(config.memoryDir), 'TASKS.json'),
    ))
  } catch {
    resumeQueue = null
  }

  // FR-20: on startup, opportunistically rehydrate each agent's history from
  // its last snapshot. Agents with no snapshot stay cold — loadSession returns
  // false and we move on. This is a no-op for fresh projects.
  for (const [label, agent] of [
    ['spec', specAgentInst],
    ['worker', workerAgentInst],
    ['reviewer', reviewerAgentInst],
    ['gate-checker', gateCheckerAgentInst],
    ...Object.entries(coordinators).map(([d, c]) => [`coordinator-${d}`, c] as const),
  ] as const) {
    const resumableTaskIds = resumeQueue ? resumableTaskIdsForLabel(label, resumeQueue) : []
    if (resumeQueue && resumableTaskIds.length === 0) continue
    const sessionId = sessionIdFor(label)
    if (resumeQueue) {
      const snapshot = loadSessionById(config.projectPath, sessionId)
      const resumableTask = snapshot
        ? resumeQueue.tasks.find((task) => task.id === String(snapshot.tool_metadata?.['current_task_id'] ?? '').trim())
        : undefined
      if (!resumableTask || !resumableTaskIds.includes(resumableTask.id)) continue
      const expectedTaskProjectPath = resolveEffectiveTaskProjectPath(
        resumableTask,
        config.projectPath,
        {
          workspaceProjects: config.projects?.length
            ? config.projects
            : discoverChildGitProjects(config.projectPath),
        },
      )
      const expectedSuccessGates =
        resumableTask.status === 'gate_check'
          ? resolveEffectiveTaskSuccessGates({
              task: resumableTask,
              workspaceProjectPath: config.projectPath,
              ...(config.bootstrap ? { workspaceBootstrap: config.bootstrap } : {}),
              workspaceProjects: config.projects?.length
                ? config.projects
                : discoverChildGitProjects(config.projectPath),
              likelyTargetFiles: resolveLikelyTaskFiles(resumableTask),
            })
          : undefined
      if (
        !isSessionSnapshotFreshForTask(snapshot, resumableTask, {
          expectedTaskProjectPath,
          expectedSuccessGates,
        })
      ) continue
    }
    const rehydrated = agent.loadSession({
      cwd: config.projectPath,
      sessionId,
      onlyPending: true,
    })
    if (rehydrated) {
      console.log(`[guildhall] Resumed ${label} agent from prior snapshot.`)
    }
  }

  const agents: OrchestratorAgentSet = {
    spec: specAgentInst,
    worker: workerAgentInst,
    reviewer: reviewerAgentInst,
    gateChecker: gateCheckerAgentInst,
    coordinators,
  }

  const reviewerFanout = buildDefaultReviewerFanout(models.reviewer, {
    ...(hookExecutor ? { hookExecutor } : {}),
    concurrency: resolveReviewerFanoutPolicy({
      provider: selection.providerName,
      requestedConcurrency:
        projectCfg.reviewerFanoutConcurrency ?? readGlobalConfig().reviewerFanoutConcurrency,
    }).effectiveConcurrency,
    contextDebug: {
      memoryDir: effectiveConfig.memoryDir,
      workspacePath: effectiveConfig.projectPath,
    },
  })

  const orchestrator = new Orchestrator({
    config: effectiveConfig,
    agents,
    reviewerFanout,
    reviewAuditStore: createReviewAuditStore({
      projectRoot: effectiveConfig.projectPath,
      persistence: new FileBackedGuildhallPersistence(),
    }),
    providerName: selection.providerName,
    ...(opts.domainFilter ? { domainFilter: opts.domainFilter } : {}),
    ...(hookExecutor ? { hookExecutor } : {}),
    ...(opts.onBackendEvent ? { onBackendEvent: opts.onBackendEvent } : {}),
    ...(opts.stopSignal ? { stopSignal: opts.stopSignal } : {}),
    ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}),
    ...(opts.agentGenerateTimeoutMs !== undefined ? { agentGenerateTimeoutMs: opts.agentGenerateTimeoutMs } : {}),
    ...(opts.agentGenerateWallClockTimeoutMs !== undefined
      ? { agentGenerateWallClockTimeoutMs: opts.agentGenerateWallClockTimeoutMs }
      : {}),
  })

  try {
    return await orchestrator.run({
      ...(opts.maxTicks !== undefined ? { maxTicks: opts.maxTicks } : {}),
      ...(opts.tickDelayMs !== undefined ? { tickDelayMs: opts.tickDelayMs } : {}),
      ...(opts.stopAfterOneTask !== undefined ? { stopAfterOneTask: opts.stopAfterOneTask } : {}),
      ...(opts.preferredTaskId !== undefined ? { preferredTaskId: opts.preferredTaskId } : {}),
    })
  } finally {
    await mcpManager.close()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * True iff the task is running a handoff sequence and has at least one
 * more step after the current one. Used by the `review` pre-pass to
 * distinguish "step complete, advance" from "final step complete, run
 * normal fan-out review."
 */
function hasPendingHandoffStep(task: Task): boolean {
  const seq = task.handoffSequence
  if (!seq || seq.length === 0) return false
  const idx = task.handoffStep ?? 0
  return idx + 1 < seq.length
}

function readRecentVerificationResults(
  metadata: Record<string, unknown> | undefined,
): RecentVerificationResult[] {
  const raw = metadata?.['recent_verification_results']
  if (!Array.isArray(raw)) return []
  return raw.flatMap((value): RecentVerificationResult[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const record = value as Record<string, unknown>
    if (record.kind !== undefined && record.kind !== 'command') return []
    if (typeof record.command !== 'string' || record.command.trim().length === 0) return []
    if (typeof record.passed !== 'boolean') return []
    return [{
      ...(record.kind === 'command' ? { kind: 'command' as const } : {}),
      command: record.command.trim(),
      passed: record.passed,
      ...(typeof record.observedAt === 'string' ? { observedAt: record.observedAt } : {}),
    }]
  })
}

/**
 * Read the latest worker handoff from the typed self-critique packet. A
 * heading or freeform note is intentionally not a compatibility path here:
 * worker prose is audit context, never execution input.
 */
function extractStructuredHandoff(task: Task): NonNullable<StructuredSelfCritique['handoff']> | undefined {
  // Walk backwards to find the latest worker note.
  for (let i = task.notes.length - 1; i >= 0; i--) {
    const n = task.notes[i]
    if (!n) continue
    if (
      n.role === 'worker' ||
      n.role === 'implementer' ||
      n.role === 'implementation' ||
      n.agentId === 'worker-agent' ||
      n.agentId?.endsWith('-engineer')
    ) {
      return readPersistedStructuredSelfCritique(n.structured)?.handoff
    }
  }
  return undefined
}

/**
 * Rebuild prior fan-out rounds from the flat `task.reviewVerdicts` trail.
 * Verdicts recorded within the same ISO second are treated as one round
 * (the fan-out persists every persona's verdict with the same `recordedAt`).
 * The most-recent round is placed last for audit and bounded retry accounting;
 * prior persona identity is never used to infer a substantive conflict.
 *
 * Each element is a PersonaVerdict-shaped slice derived from the stored
 * ReviewVerdict — `guildSlug` comes from `failingSignals[0]` (fan-out
 * writes the persona slug there on revise) or is inferred from the
 * `reason` text on approve.
 */
function extractPriorVerdictRounds(
  verdicts: readonly ReviewVerdict[],
): PersonaVerdict[][] {
  if (verdicts.length === 0) return []
  const rounds: PersonaVerdict[][] = []
  let currentKey: string | null = null
  let current: PersonaVerdict[] = []
  for (const v of verdicts) {
    const key = v.recordedAt
    if (key !== currentKey) {
      if (current.length > 0) rounds.push(current)
      current = []
      currentKey = key
    }
    // Fan-out persists the persona identity explicitly. Do not parse it out
    // of reviewer prose: a wording change must not change conflict routing.
    const slug = v.reviewerId ?? v.failingSignals[0] ?? 'unknown'
    current.push({
      guildSlug: slug,
      guildName: slug,
      verdict: v.verdict,
      reasoning: v.reasoning ?? v.reason,
      revisionItems: [],
      rawOutput: v.reasoning ?? v.reason,
    })
  }
  if (current.length > 0) rounds.push(current)
  return rounds
}

function countReviewerNotes(task: Task): number {
  return task.notes.filter(
    (note) => note.agentId === 'reviewer-agent' || note.role === 'reviewer',
  ).length
}

function isWorkerSelfCritiqueNote(
  note: Pick<Task['notes'][number], 'agentId' | 'role' | 'structured'>,
  expectedAgentId = 'worker-agent',
): boolean {
  const agentId = typeof note.agentId === 'string' ? note.agentId.trim().toLowerCase() : ''
  if (agentId !== expectedAgentId.toLowerCase()) return false
  return readPersistedStructuredSelfCritique(note.structured) !== null
}

function workerAddedSelfCritiqueSince(
  before: Task,
  after: Task,
  expectedAgentId = 'worker-agent',
): boolean {
  const previousCount = before.notes.length
  return after.notes.slice(previousCount).some((note) =>
    isWorkerSelfCritiqueNote(note, expectedAgentId),
  )
}

function findLatestWorkerSelfCritiqueIndex(task: Task): number {
  for (let i = task.notes.length - 1; i >= 0; i -= 1) {
    const note = task.notes[i]
    if (note && isWorkerSelfCritiqueNote(note)) return i
  }
  return -1
}

function findLatestWorkerSelfCritiqueRejectionIndex(task: Task): number {
  for (let i = task.notes.length - 1; i >= 0; i -= 1) {
    const note = task.notes[i]
    if (
      note?.agentId === 'coordinator' &&
      note.role === 'worker-progress-review' &&
      note.structured?.event === 'worker_self_critique_rejected'
    ) {
      return i
    }
  }
  return -1
}

function normalizedWorkerCheckpointNextAction(
  task: Task,
  checkpoint: Checkpoint | string | null,
): string {
  const trimmed =
    typeof checkpoint === 'string'
      ? checkpoint.trim()
      : checkpoint?.nextPlannedAction?.trim() ?? ''
  if (!trimmed) return ''
  if (/^(?:none|null|n\/a|na|nothing)$/i.test(trimmed)) return ''
  const checkpointWrittenAt =
    typeof checkpoint === 'string' ? NaN : Date.parse(checkpoint?.writtenAt ?? '')
  const hasNewerReviewerFeedback = Number.isFinite(checkpointWrittenAt) && task.notes.some((note) => {
    const role = typeof note.role === 'string' ? note.role.trim().toLowerCase() : ''
    const agentId = typeof note.agentId === 'string' ? note.agentId.trim().toLowerCase() : ''
    if (role !== 'reviewer' && agentId !== 'reviewer-fanout' && agentId !== 'reviewer-agent') return false
    const noteAt = Date.parse(note.timestamp)
    return Number.isFinite(noteAt) && noteAt > checkpointWrittenAt
  })
  if (hasNewerReviewerFeedback) return ''
  // This text is display/context only. Routing decisions use the structured
  // `nextActionKind` field and structured verification records below.
  return trimmed
}

type CheckpointVerification = NonNullable<Checkpoint['resumeContext']>['verification']

function readCheckpointActionKind(value: unknown): Checkpoint['nextActionKind'] | undefined {
  return value === 'continue_work' || value === 'review_handoff' ||
    value === 'rerun_verification' || value === 'escalate' ||
    value === 'inspect' || value === 'mutate'
    ? value
    : undefined
}

function readCheckpointVerification(value: unknown): CheckpointVerification {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    if (typeof record.command !== 'string' || typeof record.passed !== 'boolean' ||
      typeof record.observedAt !== 'string') return []
    return [{
      command: record.command,
      passed: record.passed,
      observedAt: record.observedAt,
      ...(typeof record.summary === 'string' ? { summary: record.summary } : {}),
    }]
  })
}

function checkpointHasRecordedVerificationFailure(
  verification: Array<{ passed: boolean }> | undefined,
): boolean {
  return Array.isArray(verification) && verification.some((entry) => entry?.passed === false)
}

function checkpointHasRecordedPassingVerification(
  verification: CheckpointVerification | undefined,
): boolean {
  return Array.isArray(verification) && verification.some((entry) => entry?.passed === true)
}

function latestHardGateResults(task: Task): Array<NonNullable<Task['gateResults']>[number]> {
  const latestById = new Map<string, NonNullable<Task['gateResults']>[number]>()
  for (const gate of task.gateResults) {
    if (gate.type !== 'hard') continue
    latestById.set(gate.gateId, gate)
  }
  return [...latestById.values()]
}

function settleAcceptanceCriteriaAfterScopedGateException(
  task: Task,
  exemptedGateIds: ReadonlySet<string>,
): void {
  for (const criterion of task.acceptanceCriteria) {
    if (
      criterion.met === true ||
      (criterion as Task['acceptanceCriteria'][number] & { persistedMet?: boolean }).persistedMet === true ||
      exemptedGateIds.has(criterion.id)
    ) {
      criterion.met = true
      const statefulCriterion = criterion as Task['acceptanceCriteria'][number] & {
        persistedMet?: boolean
        verificationState?: string
        staleReason?: string
        staleGateId?: string
      }
      delete statefulCriterion.persistedMet
      delete statefulCriterion.staleReason
      delete statefulCriterion.staleGateId
      statefulCriterion.verificationState = 'verified'
    }
  }
  const proofState = task.acceptanceCriteriaProofState as (typeof task.acceptanceCriteriaProofState & {
    state?: string
    reason?: string
    gateId?: string
    checkedAt?: string
    staleMetCount?: number
  }) | undefined
  if (proofState && task.acceptanceCriteria.every((criterion) => criterion.met === true)) {
    proofState.state = 'verified'
    delete proofState.reason
    delete proofState.gateId
    delete proofState.checkedAt
    proofState.staleMetCount = 0
  }
}

async function simulatedProviderProofIssue(
  task: Task,
  fallbackProjectPath: string,
): Promise<{ summary: string } | null> {
  if (!requiresRealProviderProof(task)) return null
  const root = typeof task.worktreePath === 'string' && task.worktreePath.trim().length > 0
    ? task.worktreePath.trim()
    : fallbackProjectPath
  if (!root || !existsSync(root)) return null
  const files = await listProviderProofScanFiles(root)
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8').catch(() => '')
    const artifactIssue = blockedProviderProofArtifact(content, file)
    if (artifactIssue) {
      return {
        summary: `Provider proof integrity failed: ${path.relative(root, file)} reports blocked or failed live evidence (${artifactIssue}).`,
      }
    }
    const match = simulatedProviderProofArtifact(content, file)
    if (!match) continue
    return {
      summary: `Provider proof integrity failed: ${path.relative(root, file)} contains simulated provider evidence (${match}).`,
    }
  }
  return null
}

interface PassingProviderProofArtifact {
  file: string
  summary: string
  checkedAt?: string
}

interface RuntimeProofExpectedEvidence {
  id: string
  required: boolean
  kind?: string
}

interface RuntimeProofVerificationRecord {
  evidenceId?: string
  status?: string
}

interface RuntimeProofPath {
  id?: string
  kind?: string
  command?: string
  status?: string
  expectedEvidence?: RuntimeProofExpectedEvidence[]
  verificationRecords?: RuntimeProofVerificationRecord[]
}

function runtimeProofPaths(task: Task): RuntimeProofPath[] {
  return (Array.isArray(task.proofPaths) ? task.proofPaths : [])
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value))
    .map(value => ({
      id: typeof value.id === 'string' ? value.id : undefined,
      kind: typeof value.kind === 'string' ? value.kind : undefined,
      command: typeof value.command === 'string' ? value.command : undefined,
      status: typeof value.status === 'string' ? value.status : undefined,
      expectedEvidence: Array.isArray(value.expectedEvidence)
        ? value.expectedEvidence.filter((item): item is string | Record<string, unknown> =>
            typeof item === 'string' || (Boolean(item) && typeof item === 'object' && !Array.isArray(item)),
          ).map((item, index) => typeof item === 'string'
            ? { id: item, required: true }
            : {
              id: typeof item.id === 'string' && item.id.trim()
                ? item.id
                : `${typeof value.id === 'string' && value.id.trim() ? value.id : 'proof-path'}-evidence-${index}`,
              required: typeof item.required === 'boolean' ? item.required : true,
              kind: typeof item.kind === 'string' ? item.kind : undefined,
            })
        : undefined,
      verificationRecords: Array.isArray(value.verificationRecords)
        ? value.verificationRecords.filter((item): item is RuntimeProofVerificationRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
            .map(item => ({
              evidenceId: typeof item.evidenceId === 'string' ? item.evidenceId : undefined,
              status: typeof item.status === 'string' ? item.status : undefined,
            }))
        : undefined,
    }))
}

async function passingProviderProofArtifact(
  task: Task,
  root: string,
): Promise<PassingProviderProofArtifact | null> {
  if (!requiresRealProviderProof(task) || !root || !existsSync(root)) return null
  const commandProof = runtimeProofPaths(task).find((proofPath) =>
    proofPath.kind === 'command' && Boolean(proofPath.command?.trim()),
  )
  if (!commandProof) return null
  const files = await listProviderProofScanFiles(root)
  for (const file of files) {
    if (!/(?:^|[\\/])proof-results[\\/]/i.test(file) || !/\.json$/i.test(file)) continue
    const content = await fs.readFile(file, 'utf8').catch(() => '')
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const record = parsed as Record<string, unknown>
    const summary = record.summary && typeof record.summary === 'object' && !Array.isArray(record.summary)
      ? record.summary as Record<string, unknown>
      : record
    const results = Array.isArray(record.results) ? record.results : []
    const passed = summary.passed === true &&
      (results.length === 0 || results.every((result) =>
        result && typeof result === 'object' && !Array.isArray(result) && (result as { passed?: unknown }).passed === true,
      ))
    if (!passed) continue
    const model = typeof summary.model === 'string' && summary.model.trim() ? ` (${summary.model.trim()})` : ''
    const scenarioCount = typeof summary.scenarioCount === 'number' ? ` across ${summary.scenarioCount} scenarios` : ''
    const checkedAt = typeof summary.checkedAt === 'string' && summary.checkedAt.trim() ? summary.checkedAt : undefined
    return {
      file,
      ...(checkedAt ? { checkedAt } : {}),
      summary: `Live provider proof passed${model}${scenarioCount}: ${path.relative(root, file)}.`,
    }
  }
  return null
}


async function listProviderProofScanFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const queue = ['docs', 'fixtures', 'proof-results', 'scripts', 'src', 'test', 'tests'].map((entry) => path.join(root, entry))
  while (queue.length > 0 && out.length < 80) {
    const current = queue.shift()!
    const stat = await fs.stat(current).catch(() => null)
    if (!stat) continue
    if (stat.isDirectory()) {
      const entries = await fs.readdir(current).catch(() => [])
      for (const entry of entries) {
        if (entry === 'node_modules' || entry === '.git') continue
        queue.push(path.join(current, entry))
      }
      continue
    }
    if (!stat.isFile() || stat.size > 256_000) continue
    if (/\.(?:mjs|js|ts|json|md|txt|yaml|yml)$/i.test(current)) out.push(current)
  }
  return out
}

function blockedProviderProofArtifact(content: string, file: string): string | null {
  if (!/(?:^|[\\/])proof-results[\\/]/i.test(file) || !/\.json$/i.test(file)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const summary = record.summary && typeof record.summary === 'object' && !Array.isArray(record.summary)
    ? record.summary as Record<string, unknown>
    : record
  const passed = summary.passed
  const status = typeof summary.status === 'string' ? summary.status.trim().toLowerCase() : ''
  if (passed !== false && status !== 'blocked' && status !== 'failed' && status !== 'error') return null
  const reason = typeof summary.reason === 'string' && summary.reason.trim()
    ? summary.reason.trim()
    : status || 'the live provider proof did not pass'
  return reason
}

function latestHardGateResultForId(
  task: Task,
  gateId: string,
): NonNullable<Task['gateResults']>[number] | undefined {
  for (let i = task.gateResults.length - 1; i >= 0; i -= 1) {
    const gate = task.gateResults[i]
    if (gate?.type === 'hard' && gate.gateId === gateId) return gate
  }
  return undefined
}

function latestHardGateResultForCommand(
  task: Task,
  command: string,
): NonNullable<Task['gateResults']>[number] | undefined {
  const expected = comparableCommand(command)
  if (!expected) return undefined
  for (let i = task.gateResults.length - 1; i >= 0; i -= 1) {
    const gate = task.gateResults[i]
    if (gate?.type === 'hard' && comparableCommand(gate.command) === expected) return gate
  }
  return undefined
}

function canCompleteGateCheckFromApprovedReviewOnly(task: Task): boolean {
  if (task.status !== 'gate_check') return false
  if (!latestApprovingReviewVerdict(task)) return false
  if (latestFallbackApprovalHasUnresolvedSubstantiveRevision(task)) return false
  if (task.gateResults.some((gate) => gate.passed === false)) return false
  if (reviewAcceptanceCriteriaMissingApprovalIds(task).length > 0) return false
  return !task.acceptanceCriteria.some((criterion) =>
    criterion.verifiedBy === 'automated' &&
    Boolean(criterion.command?.trim()) &&
    criterion.met !== true
  )
}

function latestApprovingReviewVerdict(task: Task): ReviewVerdict | null {
  for (let index = task.reviewVerdicts.length - 1; index >= 0; index -= 1) {
    const verdict = task.reviewVerdicts[index]
    if (verdict?.verdict === 'approve') return verdict
    if (verdict?.verdict === 'revise') return null
  }
  return null
}

function latestApprovingReviewEvidenceRefs(task: Task): string[] {
  const verdict = latestApprovingReviewVerdict(task)
  return verdict ? [`review:${verdict.recordedAt}`] : ['review:approved']
}

function hasPriorAdjudicationForConflict(
  task: Task,
  conflicts: ReadonlyArray<{ targetKind: string; targetId: string }>,
): boolean {
  if (conflicts.length === 0) return false
  const current = new Set(conflicts.map(conflict => `${conflict.targetKind}:${conflict.targetId}`))
  return (task.adjudications ?? []).some((record) =>
    record.decidedBy === 'coordinator' &&
    (record.contestedTargets ?? []).some(target => current.has(`${target.targetKind}:${target.targetId}`)),
  )
}

function resolvedScopeDecisionTexts(task: Task): string[] {
  return (task.escalations ?? [])
    .filter((escalation) => escalation.resolvedAt && escalation.resolution?.trim())
    .map((escalation) => [escalation.summary, escalation.details ?? '', escalation.resolution ?? ''].join('\n'))
}

function answeredQuestionDecisionTexts(task: Task): string[] {
  const questionDecisions = (Array.isArray(task.openQuestions) ? task.openQuestions : [])
    .filter((question) => question.answeredAt && typeof question.answer === 'string' && question.answer.trim())
    .map((question) => {
      const answer = normalizeFallbackWhitespace(String(question.answer).trim())
      if (answer.length >= 24 || /[.!?]$/.test(answer)) return answer
      const prompt = 'prompt' in question && typeof question.prompt === 'string' && question.prompt.trim()
        ? normalizeFallbackWhitespace(question.prompt.trim()).replace(/\?$/, '')
        : 'Owner decision'
      return `${prompt}: ${answer}`
    })
  return [
    ...questionDecisions,
    ...preservedAnsweredQuestionDecisionTexts(task),
  ]
}

function preservedAnsweredQuestionDecisionTexts(task: Task): string[] {
  const out: string[] = []
  for (const note of task.notes ?? []) {
    if (note.agentId !== 'migration:0.10.0/task-open-questions-to-bounded-chat') continue
    const match = (note.content ?? '').match(/Question:\s*([\s\S]*?)\nAnswer:\s*([\s\S]*)$/)
    const prompt = normalizeFallbackWhitespace(match?.[1] ?? '')
    const answer = normalizeFallbackWhitespace(match?.[2] ?? '')
    if (!answer) continue
    if (answer.length >= 24 || /[.!?]$/.test(answer)) out.push(answer)
    else out.push(prompt ? `${prompt.replace(/\?$/, '')}: ${answer}` : answer)
  }
  return out
}

function formatRecoverySpecSourceIntent(source: string | undefined): string {
  const raw = normalizeFallbackWhitespace(source ?? '')
    .replace(/\s*Split from containing work\b.*$/i, '')
    .trim()
  if (!raw) return 'the task title'

  const markdownSource = raw.match(/^([^:\n]+):\s*(?:[-*]\s*)?(?:\*\*)?(.+?)(?:\*\*)?$/)
  if (markdownSource) {
    const sourcePath = markdownSource[1]?.trim()
    const label = markdownSource[2]
      ?.replace(/\*\*/g, '')
      .replace(/`/g, '')
      .trim()
    if (sourcePath && label) return cleanRecoverySourceIntent(`${label} from ${sourcePath}`)
  }

  return cleanRecoverySourceIntent(raw
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/:\s*[-*]\s*/g, ': ')
    .trim())
}

function cleanRecoverySourceIntent(value: string): string {
  return normalizeFallbackWhitespace(value)
    .replace(/\s+These should become source-backed MVP scope\/tasks or explicit deferred work[\s\S]*$/i, '')
    .replace(/\s+from\s+For\s+the\s+.+$/i, '')
    .replace(/[.;。；]+$/, '')
    .trim()
}

function semanticTaskTitle(task: Task): string {
  const title = normalizeFallbackWhitespace(task.title)
  const description = normalizeFallbackWhitespace(task.description)
  const requestRaw = typeof task.request?.raw === 'string'
    ? normalizeFallbackWhitespace(task.request.raw)
    : ''
  if (title && !title.endsWith('...')) return title
  const compactTitle = title.replace(/\.\.\.$/, '').trim().toLowerCase()
  for (const candidate of [requestRaw, description]) {
    if (!candidate) continue
    if (!compactTitle || candidate.toLowerCase().startsWith(compactTitle)) return candidate
  }
  return title || requestRaw || description || task.id
}

function recoverySpecSeedDecisionTexts(task: Task): string[] {
  return uniqueNonEmptyStrings([
    ...(answeredQuestionDecisionTexts(task) ?? []),
    // Resolved escalation text is context for the next spec, never a
    // classifier. Keep every decision as audit context instead of teaching
    // recovery to recognize particular provider wording.
    ...resolvedScopeDecisionTexts(task),
  ])
}

function typedScopeNonGoals(task: Task): string[] {
  return (task.gateScopeExceptions ?? []).map((exception) =>
    `Gate ${exception.gateId} excludes unrelated failures from this task's completion boundary.`,
  )
}

function reconcileAcceptanceCriteriaFromLatestWorkerSelfCritique(task: Task): void {
  // A rendered spec is not a recovery source. If the durable structured
  // contract is missing, the task is malformed and must be repaired through
  // the spec lane instead of letting worker prose recreate acceptance state.
  if (!Array.isArray(task.acceptanceCriteria) || task.acceptanceCriteria.length === 0) {
    if (task.structuredSpec) {
      task.acceptanceCriteria = acceptanceCriteriaFromStructuredSpec(task.structuredSpec)
    }
    return
  }
  const latestWorkerNote = [...task.notes]
    .reverse()
    .find((note) => isWorkerSelfCritiqueNote(note))
  if (!latestWorkerNote) return
  const structured = readPersistedStructuredSelfCritique(latestWorkerNote.structured)
  if (!structured) return
  if (!structuredSelfCritiqueMatchesTask(task, structured)) return
  const criteriaById = new Map(task.acceptanceCriteria.map(criterion => [criterion.id, criterion]))
  for (const result of structured.acceptanceCriteria) {
    const criterion = criteriaById.get(result.id)
    if (criterion) criterion.met = result.status === 'met'
  }
}

type ReviewerFailureCode = NonNullable<ReviewVerdict['failureCode']>

const REVIEWER_FAILURE_CODES = new Set<ReviewerFailureCode>([
  'provider_unavailable',
  'provider_timeout',
  'invalid_review_contract',
])

function reviewerFailureCodeFromError(error: unknown): ReviewerFailureCode {
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const record = error as Record<string, unknown>
    const explicit = typeof record.failureCode === 'string' ? record.failureCode : record.code
    if (typeof explicit === 'string' && REVIEWER_FAILURE_CODES.has(explicit as ReviewerFailureCode)) {
      return explicit as ReviewerFailureCode
    }
    if (record.name === 'AbortError') return 'provider_timeout'
  }
  // An exception crossing the reviewer provider boundary is infrastructure
  // failure regardless of its human-readable message.
  return 'provider_unavailable'
}

function isRetryableProviderCapacityError(text: string | undefined): boolean {
  if (!text) return false
  return /HTTP 429|Too Many Requests|rate limit|engine_overloaded|Model busy, retry later/i.test(text)
}

function shouldAdvanceInfraFallbackToGateCheck(
  task: Task,
  verdict: DeterministicVerdict,
  failureCode: ReviewerFailureCode | undefined,
): boolean {
  if (!failureCode) return false
  if (verdict.verdict !== 'revise') return false
  if (latestReviewRoundHasSubstantiveRevision(task)) return false
  return (
    shouldAdvanceToGateCheckPendingAutomatedVerification(task) ||
    shouldAdvanceToGateCheckPendingHardGates(task, verdict.failingSignals) ||
    workerSelfCritiqueMarksAcceptanceCriteriaMetBeforeHardGates(task)
  )
}

function latestReviewRoundHasSubstantiveRevision(task: Task): boolean {
  return latestReviewVerdictRound(task).some(
    (verdict) =>
      verdict.verdict === 'revise' &&
      !isDeterministicPreservationRevision(verdict) &&
      !reviewVerdictLooksNonSubstantive(verdict),
  )
}

function isDeterministicPreservationRevision(verdict: ReviewVerdict): boolean {
  return verdict.reviewerId === 'deterministic-review-preservation'
}

function workerSelfCritiqueMarksAcceptanceCriteriaMetBeforeHardGates(task: Task): boolean {
  if (task.gateResults.some((gate) => gate.type === 'hard')) return false
  if (task.acceptanceCriteria.length === 0) return false
  const latestWorkerNote = [...task.notes]
    .reverse()
    .find((note) => isWorkerSelfCritiqueNote(note))
  if (!latestWorkerNote) return false
  const structured = readPersistedStructuredSelfCritique(latestWorkerNote.structured)
  if (!structured) return false
  if (!structuredSelfCritiqueMatchesTask(task, structured)) return false
  const statusById = new Map(structured.acceptanceCriteria.map(result => [result.id, result.status]))
  return task.acceptanceCriteria.every(criterion => statusById.get(criterion.id) === 'met')
}

function hasMixedReviewAndAutomatedAcceptanceCriteria(task: Task): boolean {
  let hasAutomated = false
  let hasReviewBacked = false
  for (const criterion of task.acceptanceCriteria) {
    if (criterion.verifiedBy === 'automated') {
      hasAutomated = true
    } else {
      hasReviewBacked = true
    }
  }
  return hasAutomated && hasReviewBacked
}

function isNonSubstantiveFanoutFailure(verdict: PersonaVerdict): boolean {
  return reviewVerdictIsNonSubstantiveFailure(verdict)
}

function isCommandShapedArtifactPath(file: string): boolean {
  const normalized = file.trim().replace(/^"+|"+$/g, '').toLowerCase()
  if (!normalized) return false
  return (
    /^(pnpm|npm|yarn|bun|npx)\s/.test(normalized) ||
    /^cd\s/.test(normalized) ||
    normalized.includes(' && ') ||
    normalized.includes(' || ') ||
    normalized.includes(' > ') ||
    normalized.includes(' | ')
  )
}

/** FR-15: map the zod-enum task field onto the engine's PermissionMode enum. */
function taskModeToPermissionMode(mode: TaskPermissionMode): PermissionMode {
  switch (mode) {
    case 'plan':      return PermissionMode.PLAN
    case 'full_auto': return PermissionMode.FULL_AUTO
    case 'default':   return PermissionMode.DEFAULT
  }
}

function memoryAgentRole(agentName: string): Extract<GuildhallMemoryScope, { kind: 'task_thread' }>['agentRole'] {
  const role = roleForAgentName(agentName)
  if (
    role === 'spec' ||
    role === 'coordinator' ||
    role === 'worker' ||
    role === 'reviewer' ||
    role === 'gateChecker' ||
    role === 'contextIndexer'
  ) {
    return role
  }
  return 'coordinator'
}

/**
 * Build a ReviewerFanoutRunner that creates one fresh persona reviewer
 * agent per applicable persona and parses the structured verdict from
 * each response. The orchestrator aggregates across personas.
 *
 * ## Concurrency
 *
 * `opts.concurrency` controls how many persona calls run at once:
 * - `1` (default) — strictly sequential. Safe for LM Studio and any
 *   single-session local model; wall-clock cost is `N * per-persona`.
 * - `n > 1` — up to `n` personas in flight simultaneously. Appropriate
 *   for cloud providers (Anthropic, OpenAI, ...) whose rate limits
 *   comfortably exceed `n`. Wall-clock cost collapses to roughly
 *   `ceil(N / n) * per-persona`.
 *
 * An LLM failure for one persona doesn't abort the whole review — we
 * record a parseable "revise" verdict so the strict-all aggregator
 * surfaces the failing persona with a readable reason.
 */
export function buildDefaultReviewerFanout(
  reviewerLlm: AgentLLM,
  opts: {
    hookExecutor?: HookExecutor
    concurrency?: number
    personaTimeoutMs?: number
    extraTools?: readonly AnyTool[]
    contextDebug?: {
      memoryDir: string
      workspacePath: string
    }
  } = {},
): ReviewerFanoutRunner {
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 1))
  const personaTimeoutMs = Math.max(100, Math.floor(opts.personaTimeoutMs ?? 60_000))
  return async ({ task, personas, reviewPlan, builtContext, context, projectPath, visualEvidencePaths = [] }) => {
    const { parsePersonaOutput, buildPersonaOutputHints } = await import('./reviewer-fanout.js')
    const personaOutputHints = buildPersonaOutputHints(task)
    const visualEvidence = await loadReviewerVisualEvidence(projectPath, visualEvidencePaths)

    const runPersona = async (persona: GuildDefinition): Promise<PersonaVerdict> => {
      const agent = createPersonaReviewerAgent(persona, reviewerLlm, {
        cwd: projectPath,
        ...(opts.hookExecutor ? { hookExecutor: opts.hookExecutor } : {}),
        ...(opts.extraTools ? { extraTools: opts.extraTools } : {}),
      })
      const prompt = [
        context,
        ...(reviewPlan ? ['', renderReviewPlanForReviewerPrompt(reviewPlan)] : []),
        '',
        `Task id: ${task.id}. Review this task through your lens alone and emit the required verdict format.`,
        'Use the Review Packet evidence directly: inspect the changed-file excerpts, latest self-critique, checkpoint, and recorded commands before asking for more narration.',
      ].join('\n')
      if (opts.contextDebug) {
        try {
          const personaPrompt = personaReviewerSystemPrompt(persona)
          const debugContext = {
            ...builtContext,
            personaPrompt,
            formatted: [
              builtContext.formatted,
              '',
              '## Reviewer Persona',
              personaPrompt,
            ].join('\n'),
          }
          await writeContextDebugRecord({
            memoryDir: opts.contextDebug.memoryDir,
            workspacePath: opts.contextDebug.workspacePath,
            task,
            ctx: debugContext,
            agentName: `reviewer-persona-${persona.slug}`,
            modelId: reviewerLlm.modelId,
            ...(reviewerLlm.temperature !== undefined ? { temperature: reviewerLlm.temperature } : {}),
            prompt,
          })
        } catch (err) {
          console.warn('[guildhall] failed to record reviewer context debug snapshot:', err)
        }
      }
      let timeoutCleanup = () => {}
      try {
        const controller = new AbortController()
        const timeout = new Promise<never>((_, reject) => {
          const timer = setTimeout(() => {
            controller.abort()
            reject(
              new Error(
                `persona review timed out after ${personaTimeoutMs}ms`,
              ),
            )
          }, personaTimeoutMs)
          timeoutCleanup = () => clearTimeout(timer)
        })
        const reviewerInput = persona.slug === 'visual-designer' && visualEvidence.length > 0
          ? userMessageFromContent([
              {
                type: 'text',
                text: [
                  prompt,
                  '',
                  'The following image blocks are the committed visual evidence listed in the Review Packet, in this order:',
                  ...visualEvidence.map(image => `- ${image.source_path}`),
                ].join('\n'),
              },
              ...visualEvidence,
            ])
          : prompt
        const result = await Promise.race([
          agent.generateWithEvents(reviewerInput, undefined, { signal: controller.signal }),
          timeout,
        ])
        return parsePersonaOutput(persona, result.text, personaOutputHints)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return parsePersonaOutput(
          persona,
          `**Reasoning:** ${persona.name} failed to produce a verdict (${message}). Treating as revise per strict-all policy.\n\n**Machine result:**\n\`\`\`json\n{"verdict":"revise","acceptedCriteriaIds":[],"proofEvidenceIds":[]}\n\`\`\``,
          personaOutputHints,
          { failureCode: /timed out/i.test(message) ? 'provider_timeout' : 'provider_unavailable' },
        )
      } finally {
        timeoutCleanup()
      }
    }

    return boundedConcurrency(personas, concurrency, (persona) =>
      runPersona(persona),
    )
  }
}

async function loadReviewerVisualEvidence(
  projectPath: string,
  refs: readonly string[],
): Promise<ImageBlock[]> {
  const mediaTypes: Record<string, string> = {
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  }
  const images: ImageBlock[] = []
  let totalBytes = 0
  let root: string
  try {
    root = await fs.realpath(projectPath)
  } catch {
    return []
  }
  for (const ref of refs) {
    if (images.length >= 8) break
    const mediaType = mediaTypes[path.extname(ref).toLowerCase()]
    if (!mediaType) continue
    try {
      const candidate = path.isAbsolute(ref) ? ref : path.resolve(root, ref)
      const real = await fs.realpath(candidate)
      if (real !== root && !real.startsWith(`${root}${path.sep}`)) continue
      const stat = await fs.stat(real)
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024 || totalBytes + stat.size > 4 * 1024 * 1024) continue
      const data = await fs.readFile(real)
      totalBytes += data.byteLength
      images.push({
        type: 'image',
        media_type: mediaType,
        data: data.toString('base64'),
        source_path: path.relative(root, real),
      })
    } catch {
      // Missing or escaped visual evidence remains visible as a packet path,
      // but it is never attached as trusted image input.
    }
  }
  return images
}

function renderReviewPlanForReviewerPrompt(reviewPlan: ReviewPlanRecord): string {
  const recipes = reviewPlan.requiredRecipes
    .map((recipe) => {
      const calibration = recipe.calibrationRecipeIds.length > 0
        ? `; calibration: ${recipe.calibrationRecipeIds.join(', ')}`
        : ''
      return `- ${recipe.recipeId}@${recipe.version}: ${recipe.lanes.join(', ')} (${recipe.blocking}${calibration})`
    })
    .join('\n')
  return [
    '## Planned review scope',
    '',
    `Planned review lanes: ${reviewPlan.selectedLanes.join(', ') || 'none'}`,
    `Effort/depth: ${reviewPlan.effort} / ${reviewPlan.depth}`,
    `Reviewer budget: up to ${reviewPlan.budget.maxReviewerAgents ?? 'unbounded'} grouped reviewer agent(s)`,
    '',
    'Planned reviewer recipes:',
    recipes || '- (none)',
    '',
    `Required checks: ${reviewPlan.deterministicChecks.join(', ') || 'none'}`,
    `Evidence expected: ${reviewPlan.requiredArtifacts.join(', ') || 'none'}`,
    '',
    'Completeness pass: before deciding, state whether this plan appears to have any missing risk lane, required evidence, deterministic check, or reviewer recipe that matters for this task.',
    'If you see a task-local pitfall, footgun, rollout risk, docs/audit/storage concern, or follow-up that another reviewer might miss, include it as a blocking finding when it affects acceptance or as a non-blocking follow-up idea when it should not block.',
  ].join('\n')
}

function selectReviewerRunRecipe(
  reviewPlan: ReviewPlanRecord | null,
): {
  recipeId: string
  version: string
  lanes: ReviewRiskLane[]
} {
  const firstRecipe = reviewPlan?.requiredRecipes[0]
  if (firstRecipe) {
    return {
      recipeId: firstRecipe.recipeId,
      version: firstRecipe.version,
      lanes: firstRecipe.lanes.length > 0 ? [...firstRecipe.lanes] : ['test_adequacy'],
    }
  }
  return {
    recipeId: 'reviewer-fanout-persona',
    version: 'v1',
    lanes: reviewPlan?.selectedLanes.length ? [...reviewPlan.selectedLanes] : ['test_adequacy'],
  }
}
