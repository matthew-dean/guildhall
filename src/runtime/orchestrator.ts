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
  parseAcceptanceCriteriaFromSpec,
  TaskQueue,
  TERMINAL_TASK_STATUSES,
  type ModelAssignmentConfig,
  type AdjudicationRecord,
  type AgentIssue,
  type Checkpoint,
  type ReviewVerdict,
  type Task,
  type TaskStatus,
  type TaskPermissionMode,
  type CoordinatorDomain,
  type ProgressEntry,
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
  checkpointIsFreshForTask,
  writeCheckpoint,
  ensureExploringTranscriptEntry,
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
import { recordTaskReflection } from './learning.js'
import {
  modelForAgentName,
  roleForAgentName,
  writeContextDebugRecord,
} from './context-observability.js'
import { buildHookExecutor } from './hooks-loader.js'
import { buildDefaultCompactor } from './compactor-builder.js'
import { evaluateProposal, type PromotionAction } from './proposal-promotion.js'
import { WORKSPACE_IMPORT_TASK_ID } from './workspace-importer.js'
import { taskHasUnansweredVisibleQuestion } from './question-visibility.js'
import { buildPromptCacheKey } from './prompt-cache.js'
import { resolveModelApiPolicy, type ModelApiRole } from './model-api-policy.js'
import { repairStaleBlockersInQueue } from './stale-blocker-repair.js'
import { buildEffectiveTask } from './effective-task.js'
import {
  effectiveBootstrapGateCommands,
  normalizeAutomatedAcceptanceCriterionCommands,
  reconcileAutomatedAcceptanceCommandsFromVerifiedWork,
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
import type { BackendEvent } from '@guildhall/backend-host'
import type { StreamEvent } from '@guildhall/protocol'
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
import { validateSpecCompletionBoundary } from './spec-quality.js'
import {
  NodeGitDriver,
  type GitDriver,
} from './git-driver.js'
import { buildCommitStoryMessage } from './commit-story.js'
import { effectiveGitStoryPolicy } from './git-story-policy.js'
import { upsertTaskWorkspaceState } from './task-state-store.js'
import {
  ensureWorktreeForDispatch,
  cleanupWorktreeForTerminal,
  computeBranchName,
  resolveWorktreeMode,
  type WorktreeMode,
} from './worktree-manager.js'
import {
  dispatchMerge,
  appendFixupTask,
  shelveSupersededFixupTasks,
  resolveLandingStrategy,
  type LandingStrategy,
} from './merge-dispatcher.js'
import { workSubtreeIds } from './work-hierarchy.js'
import { applyRunAutomationPolicy as applyRunAutomationLeverPolicy } from './run-automation.js'
import {
  atomicWriteText,
  getProjectStateDir,
  getProjectTranscriptPath,
  getProjectTaskLocalHistoryDir,
  inferProjectRootFromMemoryDir,
  loadSessionById,
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
import {
  createOwnerInputRequest,
  waitingOwnerInputTaskIdsSync,
} from './owner-input-store.js'
import {
  deterministicReview,
  applyDeterministicVerdict,
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
  renderAgentDecisionPacket,
  resolveRecoveryPlan,
  type FailureClassification,
} from './policy.js'
import {
  selectApplicableGuilds,
  reviewersForTask,
  loadProjectGuildRoster,
  type GuildDefinition,
} from '@guildhall/guilds'
import {
  aggregateFanout,
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
const REVIEW_UI_TASK_RE = /\b(ui|ux|frontend|front-end|web app|browser app|single-page app|page|screen|view|route|component|primitive|button|form|input|modal|drawer|toast|nav|toolbar|sidebar|layout|card|visual|design|palette|screenshot|app-store-caliber)\b/i
const VISUAL_EVIDENCE_REF_RE = /(?:\b(?:screenshot|preview|rendered proof|visual evidence)\s*[:=-]\s*)?((?:\/|\.\.?\/|[A-Za-z0-9_.-]+\/)[^\s)"']+\.(?:png|jpg|jpeg|webp)|https?:\/\/[^\s)"']+\.(?:png|jpg|jpeg|webp))/gi

type AgentGenerateResult = Awaited<ReturnType<OrchestratorAgent['generate']>>

function isFrontendUiReviewTask(task: Task): boolean {
  return REVIEW_UI_TASK_RE.test([
    task.title,
    task.description,
    task.spec ?? '',
    task.productBrief?.userJob ?? '',
    task.productBrief?.successMetric ?? '',
    ...task.acceptanceCriteria.map((criterion) => criterion.description),
  ].join('\n'))
}

function isLeanCommandBackedTask(task: Task): boolean {
  return (
    task.sizePlan?.score === 1 &&
    task.sizePlan.reviewBudgetHint === 'lean' &&
    task.acceptanceCriteria.some((criterion) => typeof criterion.command === 'string' && criterion.command.trim().length > 0)
  )
}

function shouldRunAcceptanceCommandCriterion(
  task: Task,
  criterion: Task['acceptanceCriteria'][number],
): boolean {
  const command = typeof criterion.command === 'string' ? criterion.command.trim() : ''
  if (!command) return false
  if (!criterion.met) return true

  const latestHardGate = latestHardGateResultForId(task, criterion.id)
  if (latestHardGate?.passed === true) return false
  if (latestHardGate?.passed === false) return true

  return task.notes.some((note) => {
    if (note.agentId !== 'worker-agent') return false
    if (note.role === 'self-critique') return true
    return /self-critique|review proof packet|verification commands? passed|\bmet\b/i.test(note.content)
  })
}

function normalizeAcceptanceCommandForGuildhallState(command: string): string {
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

function collectVisualEvidenceRefs(task: Task): string[] {
  const sources = [
    ...task.notes.map((note) => note.content),
    ...task.gateResults.flatMap((gate) => [
      gate.output ?? '',
      gate.gateId,
    ]),
    JSON.stringify(task.proofPaths ?? []),
    JSON.stringify(task.completionHandoff ?? {}),
  ]
  const refs: string[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    for (const match of String(source).matchAll(VISUAL_EVIDENCE_REF_RE)) {
      const ref = (match[1] ?? '').trim().replace(/[),.;:]+$/g, '')
      if (!ref || seen.has(ref)) continue
      seen.add(ref)
      refs.push(ref)
    }
  }
  return refs.slice(0, 12)
}

function hasConcreteSpecDraft(task: Task): boolean {
  return (
    task.status === 'spec_review' &&
    typeof task.spec === 'string' &&
    task.spec.trim().length > 0 &&
    Array.isArray(task.acceptanceCriteria) &&
    task.acceptanceCriteria.length > 0
  )
}

function isObsoleteStarterTaskFocusQuestion(task: Task, question: Record<string, unknown>): boolean {
  if (!hasConcreteSpecDraft(task)) return false
  const text =
    (typeof question.restatement === 'string' && question.restatement) ||
    (typeof question.prompt === 'string' && question.prompt) ||
    ''
  if (!/what should .*?(first|starter) task focus on|pick the focus for this first task/i.test(text)) {
    return false
  }
  const askedAt = typeof question.askedAt === 'string' ? Date.parse(question.askedAt) : Number.NaN
  const updatedAt = typeof task.updatedAt === 'string' ? Date.parse(task.updatedAt) : Number.NaN
  return !Number.isFinite(askedAt) || !Number.isFinite(updatedAt) || askedAt <= updatedAt
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
  return task.notes.some((note) => note.role === 'blueprint-review')
}

function hasLatestBlueprintRevisionRequest(task: Task): boolean {
  for (let index = task.notes.length - 1; index >= 0; index -= 1) {
    const note = task.notes[index]
    if (note?.role !== 'blueprint-review') continue
    return /revise_blueprint/i.test(note.content ?? '')
  }
  return false
}

function hasDeterministicSpecRepairNote(task: Task): boolean {
  return task.notes.some((note) =>
    note.agentId === 'coordinator-recovery' &&
    /repaired a malformed spec_review blueprint deterministically/i.test(note.content ?? ''),
  )
}

function hasUsableBlueprint(task: Task): boolean {
  return validateSpecCompletionBoundary(task).ok
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

function noteLooksLikeStructuredSelfCritique(task: Task): boolean {
  return (task.notes ?? []).some((note) =>
    note.agentId !== 'human' &&
    isWorkerSelfCritiqueNote(note) &&
    /\bself-critique\b/i.test(note.content) &&
    /\bmin(?:imum|imal|i)-scope check\b/i.test(note.content),
  )
}

function isRecoverableReviewHandoffToolLoop(task: Task): boolean {
  const blockReason = task.blockReason ?? ''
  const hasValidatorBugEscalation = (task.escalations ?? []).some((escalation) => {
    if (escalation.resolvedAt) return false
    const summary = escalation.summary ?? ''
    const details = escalation.details ?? ''
    return (
      (
        escalation.reason === 'gate_hard_failure' ||
        escalation.reason === 'decision_required' ||
        escalation.reason === 'human_judgment_required'
      ) &&
      (
        /transition(?:ing)? .* to review|tool validation bug prevents transitioning .* to review/i.test(
          `${summary}\n${details}`,
        ) ||
        (
          /system validator rejects passing verification/i.test(summary) &&
          /durable proof that the task passed its required verification commands/i.test(details)
        ) ||
        (
          /system validator bug persists/i.test(summary) &&
          /all verification passing|all acceptance criteria are met|validator issue to allow the review transition/i.test(details)
        ) ||
        (
          /despite passing all verification/i.test(summary) &&
          /durable proof that the task passed its required verification commands/i.test(details)
        )
      )
    )
  })
  if (
    !(
      /Blocked transitioning task to review/i.test(blockReason) ||
      /Stuck in tool loop transitioning .* to review status/i.test(blockReason) ||
      /Tool validation bug prevents transitioning .* to review status/i.test(blockReason) ||
      /Cannot transition to review .* system validator rejects passing verification/i.test(blockReason) ||
      /Blocked from transitioning to review .* system validator bug persists/i.test(blockReason) ||
      /Task blocked from transitioning to review despite passing all verification/i.test(blockReason) ||
      hasValidatorBugEscalation
    )
  ) {
    return false
  }
  return noteLooksLikeStructuredSelfCritique(task)
}

function resolveRecoverableReviewHandoffEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    const summary = escalation.summary ?? ''
    const details = escalation.details ?? ''
    if (
      (
        escalation.reason === 'human_judgment_required' ||
        escalation.reason === 'decision_required' ||
        escalation.reason === 'gate_hard_failure'
      ) &&
      (
        /Blocked transitioning task to review[^\n]*tool loop/i.test(summary) ||
        /Stuck in tool loop transitioning .* to review status/i.test(summary) ||
        /Tool validation bug prevents transitioning .* to review status/i.test(summary) ||
        /Cannot transition to review .* system validator rejects passing verification/i.test(summary) ||
        /Blocked from transitioning to review .* system validator bug persists/i.test(summary) ||
        /Task blocked from transitioning to review despite passing all verification/i.test(summary) ||
        /persist a structured self-critique note via update-task first/i.test(details) ||
        /update-task tool kept rejecting status=review/i.test(details) ||
        /durable proof that the task passed its required verification commands/i.test(details)
      )
    ) {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution = 'Superseded after the review-handoff validator fix was applied.'
    }
  }
}

function isRecoverableStaleReviewCheckpointBlocker(task: Task): boolean {
  const blockReason = task.blockReason ?? ''
  if (!/already in review|checkpoint is stale/i.test(blockReason)) return false
  return (
    noteLooksLikeStructuredSelfCritique(task) &&
    (task.escalations ?? []).some((escalation) => {
      if (escalation.resolvedAt) return false
      return (
        escalation.reason === 'decision_required' &&
        /already in review|checkpoint is stale/i.test(
          `${escalation.summary ?? ''}\n${escalation.details ?? ''}`,
        )
      )
    })
  )
}

function resolveRecoverableStaleReviewCheckpointEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    if (
      escalation.reason === 'decision_required' &&
      /already in review|checkpoint is stale/i.test(
        `${escalation.summary ?? ''}\n${escalation.details ?? ''}`,
      )
    ) {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution =
        'Superseded after Guildhall recognized the stale checkpoint as an already-complete review handoff.'
    }
  }
}

function isRecoverableTurnLimitBlocker(task: Task): boolean {
  const blockReason = task.blockReason ?? ''
  return /Worker stopped after hitting its turn limit/i.test(blockReason)
}

function isRecoverableNoProgressBlocker(task: Task): boolean {
  const blockReason = task.blockReason ?? ''
  if (/Worker made no visible progress after \d+ passes/i.test(blockReason)) return true
  return (task.escalations ?? []).some((escalation) => {
    if (escalation.resolvedAt) return false
    return (
      escalation.reason === 'human_judgment_required' &&
      /Worker made no visible progress after \d+ passes/i.test(escalation.summary ?? '')
    )
  })
}

function isRecoverableSpecNoProgressBlocker(task: Task): boolean {
  const text = [
    task.blockReason ?? '',
    ...(task.escalations ?? [])
      .filter((escalation) => !escalation.resolvedAt)
      .map((escalation) => `${escalation.agentId}\n${escalation.summary ?? ''}\n${escalation.details ?? ''}`),
  ].join('\n')
  return /spec-agent|Spec agent/i.test(text) && /made no visible progress|no saved spec|no durable draft/i.test(text)
}

function isRecoverableToolPathMismatchBlocker(task: Task): boolean {
  const text = [
    task.blockReason ?? '',
    ...(task.escalations ?? [])
      .filter((escalation) => !escalation.resolvedAt)
      .map((escalation) => `${escalation.summary ?? ''}\n${escalation.details ?? ''}`),
  ].join('\n')
  return /tool (?:read|reads|layer|runtime|file\/write|file read\/write)|cross-task tool guardrail|stale workspace path guardrail|tooling\/context routing|path mismatch|misrouted|intercepted|unrelated missing path|unrelated task file|different task worktree/i.test(text)
}

function isRecoverableBlueprintToolingBlocker(task: Task): boolean {
  const text = [
    task.blockReason ?? '',
    ...(task.escalations ?? [])
      .filter((escalation) => !escalation.resolvedAt)
      .map((escalation) => `${escalation.agentId}\n${escalation.summary ?? ''}\n${escalation.details ?? ''}`),
  ].join('\n')
  if (!/\b(?:spec-agent|coordinator|blueprint|spec|planning lane)\b/i.test(text)) return false
  if (!/\b(?:missing|likely target|target file|stale source|source reference)\b/i.test(text)) return false
  return /\b(?:create|author|mutate|write)\b/i.test(text)
}

function resolveRecoverableBlueprintToolingEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    const text = `${escalation.agentId}\n${escalation.summary ?? ''}\n${escalation.details ?? ''}`
    if (
      /\b(?:spec-agent|coordinator|blueprint|spec|planning lane)\b/i.test(text) &&
      /\b(?:missing|likely target|target file|stale source|source reference)\b/i.test(text) &&
      /\b(?:create|author|mutate|write)\b/i.test(text)
    ) {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'coordinator'
      escalation.resolution =
        'Foreman inspection resolved this as a stale blueprint/tooling blocker. Planning lanes may inspect evidence and revise the blueprint; they should not be forced to author a stale source path before coordinator review.'
    }
  }
}

function isRecoverableWorkerTimeoutBlocker(task: Task): boolean {
  const blockReason = task.blockReason ?? ''
  return /Worker timed out after failing to mutate the likely target file/i.test(blockReason)
}

function isRecoverableEnvironmentSetupBlocker(task: Task): boolean {
  const blockReason = task.blockReason ?? ''
  if (/Test environment setup failed/i.test(blockReason)) return true
  return (task.escalations ?? []).some((escalation) => {
    if (escalation.resolvedAt) return false
    const summary = escalation.summary ?? ''
    const details = escalation.details ?? ''
    return (
      escalation.reason === 'gate_hard_failure' &&
      (
        /Test environment setup failed/i.test(summary) ||
        /Test environment setup failed/i.test(details) ||
        /Cannot find module .*@nuxt\/test-utils/i.test(details)
      )
    )
  })
}

function resolveRecoverableTurnLimitEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    const summary = escalation.summary ?? ''
    const details = escalation.details ?? ''
    if (
      escalation.reason === 'human_judgment_required' &&
      (
        /Worker stopped after hitting its turn limit/i.test(summary) ||
        /Exceeded maximum turn limit/i.test(details)
      )
    ) {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution = 'Superseded after the project was explicitly resumed.'
    }
  }
}

function resolveRecoverableNoProgressEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    const summary = escalation.summary ?? ''
    const details = escalation.details ?? ''
    if (
      escalation.reason === 'human_judgment_required' &&
      (
        /Worker made no visible progress after \d+ passes/i.test(summary) ||
        /Task remained in progress with no worktree edits/i.test(details)
      )
    ) {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution = 'Superseded after the project was explicitly resumed from a recoverable no-progress stop.'
    }
  }
}

function resolveRecoverableSpecNoProgressEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    const text = `${escalation.agentId}\n${escalation.summary ?? ''}\n${escalation.details ?? ''}`
    if (/spec-agent|Spec agent/i.test(text) && /made no visible progress|no saved spec|no durable draft/i.test(text)) {
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
    const text = `${escalation.summary ?? ''}\n${escalation.details ?? ''}`
    if (/tool (?:read|reads|layer|runtime|file\/write|file read\/write)|cross-task tool guardrail|stale workspace path guardrail|tooling\/context routing|path mismatch|misrouted|intercepted|unrelated missing path|unrelated task file|different task worktree/i.test(text)) {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution =
        'Superseded after Guildhall corrected task-worktree path/context routing. Reopened for a fresh worker pass.'
    }
  }
}

function resolveRecoverableEnvironmentSetupEscalations(task: Task, resolvedAt: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    const summary = escalation.summary ?? ''
    const details = escalation.details ?? ''
    if (
      escalation.reason === 'gate_hard_failure' &&
      (
        /Test environment setup failed/i.test(summary) ||
        /Test environment setup failed/i.test(details) ||
        /Cannot find module .*@nuxt\/test-utils/i.test(details)
      )
    ) {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution = 'Superseded after the task worktree install layout was repaired and bootstrap passed.'
    }
  }
}

function basenameOfTaskPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).at(-1) ?? normalized
}

function isRecoverableSelfAuthoredVerificationEscalation(input: {
  agentName: string
  beforeStatus: TaskStatus
  task: Task
  checkpoint: Checkpoint | null
  touchedFiles?: readonly string[]
  escalation: NonNullable<Task['escalations']>[number]
}): boolean {
  if (input.agentName !== 'worker-agent') return false
  if (input.beforeStatus !== 'in_progress') return false
  if (
    ![
      'spec_ambiguous',
      'decision_required',
      'human_judgment_required',
      'gate_hard_failure',
    ].includes(input.escalation.reason)
  ) {
    return false
  }

  const text = [
    input.task.blockReason ?? '',
    input.escalation.summary ?? '',
    input.escalation.details ?? '',
  ].join('\n')
  const touchedFiles = input.checkpoint?.filesTouched?.length
    ? input.checkpoint.filesTouched
    : input.touchedFiles ?? []
  const hasRecordedVerificationFailure = checkpointHasRecordedVerificationFailure(
    input.checkpoint?.resumeContext?.verification,
  )
  const blockerMentionsVerificationFailure =
    /(type errors?|cannot find name|cannot be found|cannot be resolved|missing imports?|missing names?|missing utilities|undefined|TS\d{4})/i.test(
      text,
    )
  const workerClaimsVerificationEnvironmentMismatch =
    /implementation is complete|code follows|completed implementation/i.test(text) &&
    /verification commands?.*(?:do not|don't|cannot|can't|won't|not work|failed|unavailable|environment)/i.test(text)
  if (
    (!hasRecordedVerificationFailure || !blockerMentionsVerificationFailure) &&
    !workerClaimsVerificationEnvironmentMismatch
  ) {
    return false
  }

  if (touchedFiles.length === 0) return false
  if (workerClaimsVerificationEnvironmentMismatch) return true

  return touchedFiles.some((filePath) => {
    const normalized = filePath.replace(/\\/g, '/')
    const basename = basenameOfTaskPath(normalized)
    return text.includes(normalized) || (basename.length > 0 && text.includes(basename))
  })
}

function isRecoverableSelfAuthoredVerificationBlocker(
  task: Task,
  checkpoint: Checkpoint | null,
  touchedFiles: readonly string[] = [],
): boolean {
  return (task.escalations ?? []).some((escalation) => {
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
    const summary = escalation.summary ?? ''
    const details = escalation.details ?? ''
    if (
      escalation.reason === 'human_judgment_required' &&
      (
        /Worker timed out after failing to mutate the likely target file/i.test(summary) ||
        /timed out after \d+ms of inactivity/i.test(details)
      )
    ) {
      escalation.resolvedAt = resolvedAt
      escalation.resolvedBy = 'system'
      escalation.resolution = 'Superseded after the project was explicitly resumed from the latest recovery checkpoint.'
    }
  }
}

function reviewVerdictLooksInfrastructureOnly(verdict: Pick<ReviewVerdict, 'verdict' | 'reasoning'>): boolean {
  if (verdict.verdict !== 'revise') return false
  const text = verdict.reasoning ?? ''
  if (!/failed to produce a verdict|no \*\*Reasoning:\*\* block found/i.test(text)) return false
  return /HTTP 429|Too Many Requests|rate limit|provider timeout|connection refused|Exceeded maximum turn limit \(\d+\)|temporarily unavailable|service unavailable|timed out after \d+ms|raw output retained/i.test(text)
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
  const blockReason = task.blockReason ?? ''
  if (!/max_revisions_exceeded:/i.test(blockReason)) return false
  const revises = latestReviewVerdictRound(task).filter((verdict) => verdict.verdict === 'revise')
  return revises.length > 0 && revises.every((verdict) => reviewVerdictLooksInfrastructureOnly(verdict))
}

function isRecoverableActionableMaxRevisionBlocker(task: Task): boolean {
  const blockReason = task.blockReason ?? ''
  if (!/max_revisions_exceeded:/i.test(blockReason)) return false
  const revises = latestReviewVerdictRound(task).filter((verdict) => verdict.verdict === 'revise')
  if (revises.length === 0) return false
  return revises.some((verdict) => !reviewVerdictLooksInfrastructureOnly(verdict))
}

function resolveRecoverableMaxRevisionEscalations(task: Task, resolvedAt: string, resolution: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    if (escalation.reason !== 'max_revisions_exceeded') continue
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

function isSyntheticRecoveryUserMessage(message: { role?: string; content?: unknown }): boolean {
  if (message.role !== 'user') return false
  const text = messageContentText(message.content)
  if (!text) return false
  return (
    text.includes('Your last response did not use a tool, so Guildhall could not turn it into') ||
    text.includes('Do not repeat that exact tool call again.')
  )
}

function bestExploringAssistantFallbackText(
  messages: ReadonlyArray<{ role?: string; content?: unknown }>,
): string {
  const preferred: string[] = []
  const fallback: string[] = []
  let sawSyntheticRecovery = false
  for (const message of messages) {
    if (isSyntheticRecoveryUserMessage(message)) {
      sawSyntheticRecovery = true
      continue
    }
    if (message.role !== 'assistant') continue
    const text = messageContentText(message.content).trim()
    if (!text) continue
    fallback.push(text)
    if (!sawSyntheticRecovery) preferred.push(text)
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
}) => Promise<PersonaVerdict[]>

export type { TickOutcome } from './tick-outcome.js'
import type { TickOutcome } from './tick-outcome.js'

export interface OrchestratorRunOptions {
  maxTicks?: number
  tickDelayMs?: number
  stopAfterOneTask?: boolean
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

function recoveryEventForStatus(status: TaskStatus): TaskTransitionEvent {
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

function looksLikePlaintextUserQuestion(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.includes('?')) return true
  return /(^|\n)\s*(pick one|pick all|please answer|reply with|choose|which|what|should|do you want)\b/i.test(trimmed)
}

type FallbackQuestionDraft =
  | { kind: 'text'; prompt: string; subject?: string; description?: string }
  | { kind: 'choice'; prompt: string; subject?: string; description?: string; choices: string[]; selectionMode?: 'single' | 'multiple' }

interface FallbackBriefDraft {
  userJob: string
  successMetric: string
  antiPatterns: string[]
}

const MAX_FALLBACK_QUESTIONS = 3

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function cleanFallbackOptionLabel(raw: string): string {
  const trimmed = raw.trim()
  const boldHeading = trimmed.match(/^\*\*(.+?)\*\*(?:\s*[—-]\s*.*)?$/)
  if (boldHeading) return boldHeading[1]!.trim()
  return trimmed
}

function normalizeFallbackQuestionPrompt(prompt: string): string {
  return prompt
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeFallbackWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function sentenceCaseFallbackQuestion(value: string): string {
  const trimmed = normalizeFallbackWhitespace(value).replace(/\s+\?/g, '?')
  if (!trimmed) return trimmed
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

function inferFallbackSubjectFromContext(context: string, question: string): string | undefined {
  const ignored = new Set(['The', 'This', 'That', 'I'])
  const component = [...context.matchAll(/\b([A-Z][A-Za-z0-9]+)\b/g)]
    .map((match) => match[1])
    .find((value): value is string => Boolean(value && !ignored.has(value)))
  if (!component || ignored.has(component)) return undefined
  if (/\bvariants?\b/i.test(question)) return `${component} variants`
  return component
}

function rewriteFallbackQuestionWithSubject(question: string, subject: string | undefined): string {
  const normalized = sentenceCaseFallbackQuestion(question)
  if (!subject) return normalized
  const component = subject.replace(/\s+variants?$/i, '').trim()
  if (!component) return normalized
  return normalized
    .replace(/\bthe user\b/i, component)
    .replace(/\buser\b/i, component)
}

function extractEmbeddedFallbackQuestion(text: string): FallbackQuestionDraft | null {
  const trimmed = text.trim()
  const match = trimmed.match(
    /\b(?:the\s+)?(?:key|main|top|only|focused)?\s*question(?:\s+i\s+need\s+to\s+ask|\s+we\s+need\s+to\s+answer|\s+to\s+answer)?(?:\s+before\s+[^:\n]+)?\s*(?:is|:)\s*([\s\S]*?\?)/i,
  )
  if (!match || match.index === undefined) return null
  const rawQuestion = match[1]?.trim() ?? ''
  if (!rawQuestion) return null
  const context = normalizeFallbackWhitespace(trimmed.slice(0, match.index))
    .replace(/^i have enough context\.?\s*/i, '')
  const subject = inferFallbackSubjectFromContext(context, rawQuestion)
  return {
    kind: 'text',
    prompt: rewriteFallbackQuestionWithSubject(rawQuestion, subject),
    ...(subject ? { subject } : {}),
    ...(context ? { description: context } : {}),
  }
}

function parseFallbackOptionLine(line: string): string | null {
  const trimmed = line.trim()
  if (/^-\s+/.test(trimmed)) {
    return trimmed.replace(/^-\s+/, '').replace(/^[A-Z][.)]\s*/, '').trim()
  }
  if (/^[A-Z][.)]\s+/.test(trimmed)) {
    return trimmed.replace(/^[A-Z][.)]\s+/, '').trim()
  }
  return null
}

function isQuestionListPrompt(promptBody: string): boolean {
  const normalized = promptBody
    .replace(/^#{1,6}\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  return (
    /\b(?:two|three|four|five|\d+)\s+questions?\s+remain\b/.test(normalized) ||
    /\bquestions?\s+remain\b/.test(normalized) ||
    /\bposted\s+(?:two|three|four|five|\d+)\s+questions?\b/.test(normalized) ||
    /\bposted\s+(?:a\s+|one\s+)?(?:focused\s+|scope\s+|structured\s+)*questions?\b/.test(normalized) ||
    /\bposted\s+(?:two|three|four|five|\d+)\s+focused\s+questions?\b/.test(normalized) ||
    /\bquestions?\s+to\s+help\b/.test(normalized)
  )
}

function isEvidenceSummaryPrompt(promptBody: string): boolean {
  const normalized = promptBody
    .replace(/^#{1,6}\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  return (
    /^research budget (?:hit|exhausted)\b/.test(normalized) ||
    /^i have enough\b/.test(normalized) ||
    /^ok,\s*i['’]ve hit the research budget\b/.test(normalized) ||
    /^i['’]ve hit the research budget\b/.test(normalized) ||
    /^let me (?:piece|synthesize|summarize|recap)\b/.test(normalized) ||
    /^let me check what (?:i|we) know\b/.test(normalized) ||
    /^here'?s what i (?:found|know|learned|asked)\b/.test(normalized) ||
    /^from (?:the )?transcript (?:notes?|history|context)\b/.test(normalized) ||
    /^what (?:guildhall|i|we) (?:found|know|learned)\b/.test(normalized) ||
    /^what i (?:found|know|learned)\b/.test(normalized)
  )
}

function isOperationalFallbackPrompt(promptBody: string): boolean {
  const normalized = promptBody
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  return (
    /^(?:i(?:'|’)ll|i will|i(?:'|’)m going to|i am going to)(?: now)?(?: finalize|finish|complete|proceed) by:?$/.test(normalized) ||
    /^(?:done|complete|completed|finished)(?:\s*[—-]\s*|\s*:|\s*$)/.test(normalized) ||
    /^the user answered:?$/.test(normalized) ||
    /^(?:required\s+)?yaml fences? for:?$/.test(normalized) ||
    /^required sections:?$/.test(normalized)
  )
}

function inferFallbackQuestionsFromPlaintext(text: string): FallbackQuestionDraft[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (isEvidenceSummaryPrompt(trimmed)) return []

  const embeddedQuestion = extractEmbeddedFallbackQuestion(trimmed)
  if (embeddedQuestion) return [embeddedQuestion]

  const simplePickOne = trimmed.match(/^pick one:\s*(.+)$/im)
  if (simplePickOne) {
    const body = simplePickOne[1]?.trim() ?? ''
    const split = body.match(/^(.+?),\s*or\s+(.+?)\??$/i)
    if (split) {
      return [{
        kind: 'choice',
        prompt: 'Pick one',
        choices: [split[1]!.trim(), split[2]!.trim()],
        selectionMode: 'single',
      }]
    }
  }

  const lines = trimmed.split('\n')
  const inlinePromptQuestions: FallbackQuestionDraft[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const promptLine = lines[i]?.trim() ?? ''
    if (!promptLine) continue
    const normalizedPromptLine = promptLine.replace(/^#{1,6}\s*/, '').trim()
    const headingPrompt = normalizedPromptLine.match(/^\d+[.)]\s+(?:\*\*(.+?)\*\*|(.+))$/)
    const promptBody = (headingPrompt?.[1] ?? headingPrompt?.[2] ?? normalizedPromptLine).trim()
    const promptLike = /pick one\b|choose one\b|select one\b|\?$|:\s*$|success look like/i.test(promptBody)
    if (!promptLike) continue
    if (isQuestionListPrompt(promptBody)) continue
    if (isEvidenceSummaryPrompt(promptBody)) continue
    if (isOperationalFallbackPrompt(promptBody)) continue
    const summaryLike =
      /i['’]ll draft the full spec with\b|i will draft the full spec with\b|once you (?:pick|answer).+i['’]ll draft\b/i
        .test(promptBody)
    if (summaryLike) continue

    const choices: string[] = []
    let mode: 'numbered' | 'bullets' | null = null
    let invalidInlineGroup = false
    for (let j = i + 1; j < lines.length; j += 1) {
      const optionLine = lines[j]?.trim() ?? ''
      if (!optionLine) {
        if (choices.length > 0) break
        continue
      }
      const numberedOption = optionLine.match(/^\d+[.)]\s+(?:\*\*(.+?)\*\*|(.+))$/)
      if (numberedOption) {
        if (mode === 'bullets') break
        mode = 'numbered'
        choices.push(cleanFallbackOptionLabel((numberedOption[1] ?? numberedOption[2] ?? '').trim()))
        continue
      }
      const structuredOption = parseFallbackOptionLine(optionLine)
      if (structuredOption) {
        if (mode === 'numbered') {
          invalidInlineGroup = true
          break
        }
        mode = 'bullets'
        choices.push(structuredOption)
        continue
      }
      if (choices.length > 0) break
    }

    if (!invalidInlineGroup && choices.length >= 2 && choices.length <= 6) {
      inlinePromptQuestions.push({
        kind: 'choice',
        prompt: promptBody.replace(/\s+/g, ' ').trim(),
        choices,
        selectionMode: /pick all|all that apply|select all|choose all/i.test(promptBody)
          ? 'multiple'
          : 'single',
      })
    }
  }
  if (inlinePromptQuestions.length > 0) return inlinePromptQuestions.slice(0, MAX_FALLBACK_QUESTIONS)

  const sections: Array<{ heading: string; lines: string[] }> = []
  let current: { heading: string; lines: string[] } | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    const normalizedLine = line.replace(/^#{1,6}\s*/, '')
    const headingMatch = normalizedLine.match(/^\d+[.)]\s+(?:\*\*(.+?)\*\*|(.+))$/)
    if (headingMatch) {
      if (current) sections.push(current)
      current = { heading: (headingMatch[1] ?? headingMatch[2] ?? '').trim(), lines: [] }
      continue
    }
    if (current) current.lines.push(rawLine)
  }
  if (current) sections.push(current)

  const inferred = sections
    .map<FallbackQuestionDraft | null>((section) => {
      const choices = section.lines
        .map((line) => parseFallbackOptionLine(line))
        .filter(Boolean)
        .map((line) => line as string)
      if (choices.length >= 2 && choices.length <= 6) {
        if (isQuestionListPrompt(section.heading)) return null
        if (isEvidenceSummaryPrompt(section.heading)) return null
        if (isOperationalFallbackPrompt(section.heading)) return null
        const combined = [section.heading, ...section.lines.map((line) => line.trim()).filter((line) => line && !/^-/.test(line))]
          .join('\n')
          .trim()
        const selectionMode = /pick all|all that apply|select all|choose all/i.test(combined)
          ? 'multiple'
          : 'single'
        return {
          kind: 'choice',
          prompt: section.heading,
          choices,
          selectionMode,
        }
      }
      return null
    })
    .filter((question): question is FallbackQuestionDraft => question !== null)

  if (inferred.length > 0) return inferred.slice(0, MAX_FALLBACK_QUESTIONS)
  if (!looksLikePlaintextUserQuestion(trimmed)) return []
  return [{ kind: 'text', prompt: trimmed }]
}

function inferFallbackBriefFromPlaintext(text: string, taskTitle: string): FallbackBriefDraft | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const guessMatch = trimmed.match(/my (?:best )?(?:guess|read)(?: of [^:\n]+| for [^:\n]+)?[:\s]*\n+([\s\S]+)/i)
  const hadGuessPreamble = Boolean(guessMatch)
  const afterGuess = (guessMatch?.[1] ?? trimmed).trim()
  const lines = afterGuess
    .split('\n')
    .map((line) => line.trim().replace(/^[*-]\s+/, ''))
    .filter(Boolean)
    .filter((line) => !/^\d+[.)]\s/.test(line))

  const isAgentResearchNarration = (line: string): boolean =>
    /^(?:let me|i(?:'ll| will)|first[, ]+i(?:'ll| will)|before that[, ]+i(?:'ll| will))\s+(?:check|inspect|verify|look|review|audit|confirm|read)\b/i
      .test(line)

  const userJobLine = lines.find((line) =>
    /^you want to\b/i.test(line) ||
    /^this task is about\b/i.test(line) ||
    /^the goal is to\b/i.test(line) ||
    /^we want to\b/i.test(line) ||
    /^my read of this task title\b/i.test(line) ||
    /^from the title, my best read is:/i.test(line),
  )
  if (!userJobLine) {
    if (hadGuessPreamble && lines.length > 0) {
      const firstMeaningfulLine = lines.find((line) => !isAgentResearchNarration(line))
      if (!firstMeaningfulLine) return null
      return {
        userJob: firstMeaningfulLine,
        successMetric: `Thread shows a drafted brief and actionable next step for "${taskTitle}".`,
        antiPatterns: lines
          .filter((line) => /^(?:don['’]t|do not)\b/i.test(line))
          .map((line) => line.replace(/^[*-]\s*/, '').trim()),
      }
    }
    return null
  }

  const userJobIndex = lines.indexOf(userJobLine)
  const userJob =
    (/^my read of this task title\b/i.test(userJobLine) ||
      /^from the title, my best read is:/i.test(userJobLine)) &&
    userJobIndex >= 0 &&
    userJobIndex + 1 < lines.length &&
    !/^(?:don['’]t|do not)\b/i.test(lines[userJobIndex + 1] ?? '') &&
    !isAgentResearchNarration(lines[userJobIndex + 1] ?? '')
      ? (lines[userJobIndex + 1] ?? userJobLine)
      : userJobLine

  if (isAgentResearchNarration(userJob)) return null

  const antiPatterns = lines
    .filter((line) => /^don't\b/i.test(line) || /^do not\b/i.test(line))
    .map((line) => line.replace(/^[*-]\s*/, '').trim())

  return {
    userJob,
    successMetric: `Thread shows a drafted brief and actionable next step for "${taskTitle}".`,
    antiPatterns,
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

function resolveAgentGenerateWallClockTimeoutMs(
  agentName: string,
  configured: OrchestratorOptions['agentGenerateWallClockTimeoutMs'],
): number | undefined {
  if (configured == null) return undefined
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

function taskExplicitlyOwnsBootstrapRepair(task: Task): boolean {
  const recentNotes = (task.notes ?? []).slice(-8).map((note) => note.content)
  const haystack = [
    task.title,
    task.description ?? '',
    task.spec ?? '',
    task.blockReason ?? '',
    ...recentNotes,
  ].join('\n').toLowerCase()
  const mentionsBootstrapFailure =
    haystack.includes('bootstrap') ||
    haystack.includes('setup failure') ||
    haystack.includes('setup/implementation') ||
    haystack.includes('success gate') ||
    haystack.includes('pnpm lint')
  if (!mentionsBootstrapFailure) return false
  return (
    haystack.includes('task-local bootstrap') ||
    haystack.includes('task-local setup') ||
    haystack.includes('inside this task') ||
    haystack.includes('inside this task branch') ||
    haystack.includes('not as an owner decision') ||
    haystack.includes('not an owner decision') ||
    haystack.includes('setup/implementation work')
  )
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
      return !touched.has(resolved)
    })
    .slice(0, 8)
}

function checkpointSafeNextMutationSurface(
  filesTouched: readonly string[],
  companionFiles: readonly string[],
  verification: CheckpointResumeContext['verification'] = [],
): string[] {
  const primary = uniqueNonEmptyStrings(filesTouched.length > 0 ? filesTouched : companionFiles)
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
  if (looksLikeReviewHandoffNextAction(normalizedCheckpoint)) {
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
  const latestAcceptanceGateFailure = [...task.notes]
    .reverse()
    .find((note) =>
      note.agentId === 'acceptance-command-gates' &&
      note.role === 'gate-checker' &&
      /Acceptance command gates failed/i.test(note.content),
    )
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
      /latest recovery checkpoint|latest durable checkpoint/i.test(note.content)
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
  private readonly dirtyWorkerTimeoutRetries = new Map<string, number>()
  private readonly exploringNoProgressCounts = new Map<string, number>()
  private readonly workerNoProgressCounts = new Map<string, number>()
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

  private clearWorkerNoProgress(taskId: string): void {
    this.workerNoProgressCounts.delete(taskId)
  }

  private bumpWorkerNoProgress(taskId: string): number {
    const next = (this.workerNoProgressCounts.get(taskId) ?? 0) + 1
    this.workerNoProgressCounts.set(taskId, next)
    return next
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
      const settingsPath = path.join(
        this.opts.config.memoryDir,
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
  ): NonNullable<Extract<TickOutcome, { kind: 'idle' }>['summary']> {
    const scopedIds = scopeTaskId ? new Set(workSubtreeIds(queue.tasks, scopeTaskId)) : null
    const tasks = scopedIds ? queue.tasks.filter(task => scopedIds.has(task.id)) : queue.tasks
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
      return {
        reason: 'all_terminal',
        message:
          `No actionable tasks remain: ${counts.done} done, ${counts.blocked} blocked, ${counts.shelved} shelved.`,
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
    const staleRepair = repairStaleBlockersInQueue(queueBefore, this.now())
    if (staleRepair.changed) await this.writeQueue(queueBefore)
    const landingRepair = await this.reconcileCompletedTaskLanding(queueBefore)
    if (landingRepair.changed) await this.writeQueue(queueBefore)
    const pendingPrRepair = await this.reconcilePendingPrLanding(queueBefore)
    if (pendingPrRepair.changed) await this.writeQueue(queueBefore)
    const runAutomation = await this.applyRunAutomationPolicy(queueBefore, opts.preferredTaskId)
    if (runAutomation.changed) queueBefore = await this.readQueue()
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
        : queueBefore.tasks
      const allDone = scopedTasks.length > 0 && scopedTasks.every((t) =>
        (TERMINAL_TASK_STATUSES as readonly TaskStatus[]).includes(t.status),
      )
      const summary = this.summarizeIdleQueue(queueBefore, opts.preferredTaskId)
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
    if (!root || isSelectedTaskClosureDone(root)) return { completed: false, childIds: [] }
    const subtreeIds = workSubtreeIds(queue.tasks, preferredTaskId)
    const childIds = subtreeIds.filter(id => id !== preferredTaskId)
    if (childIds.length === 0) return { completed: false, childIds: [] }
    const tasksById = new Map(queue.tasks.map(task => [task.id, task]))
    const childrenComplete = childIds.every(id => {
      const child = tasksById.get(id)
      return child ? isSelectedTaskClosureDone(child) : false
    })
    if (!childrenComplete) return { completed: false, childIds }

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
    if (task.status === 'in_progress' || task.status === 'review' || task.status === 'gate_check') {
      task = await this.hydrateEffectiveTaskForDispatch(task)
    }

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
      return await this.claimReadyTaskInline(task)
    }

    const staleWorkerSelfCritiqueRecovery =
      await this.rejectStaleWorkerSelfCritiqueWithoutProjectChanges(task, task.status)
    if (staleWorkerSelfCritiqueRecovery) return staleWorkerSelfCritiqueRecovery

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

    // Handoff sequence pre-pass at `review`: when the task is running a
    // multi-step handoff and the current step is NOT the last, we capture
    // the step's handoff note, advance `handoffStep`, and revert status to
    // `in_progress`. The reviewer fan-out only fires on the final step's
    // completion. See docs/disagreement-and-handoff.md §2.
    if (task.status === 'review' && hasPendingHandoffStep(task)) {
      const handoffOutcome = await this.advanceHandoffStepInline(task)
      if (handoffOutcome) return handoffOutcome
    }

    if (task.status === 'review' && isLeanCommandBackedTask(task)) {
      return await this.advanceLeanCommandBackedReviewInline(task)
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

    // FR-27 / AC-18: resolve reviewer mode once per dispatch so failures to
    // load levers fall back to `llm_only` (safest default).
    const reviewerMode: ReviewerMode =
      beforeStatus === 'review' ? await this.resolveReviewerMode(task.domain) : 'llm_only'

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
    const worktreeMode = await this.resolveWorktreeModeSafe()
    const effectiveTaskProjectPath = resolveEffectiveTaskProjectPath(
      task,
      this.opts.config.projectPath,
    )
    let activeWorktreePath = effectiveTaskProjectPath
    const baseBranch = await this.resolveBaseBranch(effectiveTaskProjectPath)
    if (worktreeMode !== 'none' && !shouldSkipGitIsolation(task, agent.name)) {
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
        const ensured = await ensureWorktreeForDispatch({
          task,
          mode: worktreeMode,
          projectId: this.opts.config.workspaceId,
          projectPath: effectiveTaskProjectPath,
          workspacePath: this.opts.config.projectPath,
          worktreeInclude: worktreeIncludeForTaskProject(this.opts.config, effectiveTaskProjectPath),
          baseBranch,
          gitDriver: this.gitDriver,
        })
        activeWorktreePath = ensured.worktreePath
        await upsertTaskWorkspaceState(
          inferProjectRootFromMemoryDir(this.opts.config.memoryDir),
          task.id,
          {
            worktreePath: ensured.worktreePath,
            branchName: ensured.branchName,
            baseBranch: ensured.baseBranch,
            mode: worktreeMode,
            updatedAt: this.now(),
          },
        )
        // Persist metadata if we just minted a new worktree (or if the task
        // is missing any of the fields, e.g. legacy rows pre-FR-24).
        if (
          ensured.created ||
          task.worktreePath !== ensured.worktreePath ||
          task.branchName !== ensured.branchName ||
          task.baseBranch !== ensured.baseBranch
        ) {
          await this.withQueueWriteLock(async () => {
            const queue = await this.readQueue()
            const t = queue.tasks.find((x) => x.id === task.id)
            if (!t) return
            t.worktreePath = ensured.worktreePath
            t.branchName = ensured.branchName
            t.baseBranch = ensured.baseBranch
            t.updatedAt = this.now()
            queue.lastUpdated = this.now()
            await this.writeQueue(queue)
          })
          task.worktreePath = ensured.worktreePath
          task.branchName = ensured.branchName
          task.baseBranch = ensured.baseBranch
        }
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
            evidenceRefs: ['task:worktree-setup:create-failed'],
            now,
          })
          queuedTask.assignedTo = null
          queuedTask.blockReason =
            `Guildhall could not create a task worktree: ${message}. ` +
            'Fix the worktree setup issue, then resume the task.'
          queuedTask.notes.push({
            agentId: 'coordinator',
            role: 'bootstrap-failure',
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
      workspaceProjects: this.opts.config.projects ?? [],
    })
    if (
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
          const dirtyTaskWorktree = !(await this.gitDriver.isClean(activeWorktreePath))
          const queue = await this.readQueue()
          const queuedTask = queue.tasks.find((candidate) => candidate.id === task.id)
          const taskOwnsBootstrapRepair = taskExplicitlyOwnsBootstrapRepair(queuedTask ?? task)
          if (dirtyTaskWorktree || taskOwnsBootstrapRepair) {
            const now = this.now()
            const output = String(failed?.output ?? '').trim()
            const clippedOutput = output.length > 1800 ? `${output.slice(0, 1800)}\n...` : output
            const handoffReason = dirtyTaskWorktree
              ? 'The task worktree already has edits, so Guildhall is handing the failing verification back to the worker instead of blocking setup.'
              : 'The task explicitly asks Guildhall to repair this bootstrap failure, so Guildhall is handing the failing setup proof to the worker instead of blocking before dispatch.'
            const content = [
              `${msg}. ${handoffReason}`,
              clippedOutput ? `\nVerification output:\n${clippedOutput}` : '',
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
              output: clippedOutput,
              observedAt: now,
            })
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
    })
    const effectiveTaskSuccessGatesRaw =
      beforeStatus === 'gate_check' || beforeStatus === 'in_progress'
        ? resolveEffectiveTaskSuccessGates({
            task,
            workspaceProjectPath: this.opts.config.projectPath,
            ...(this.opts.config.bootstrap
              ? { workspaceBootstrap: this.opts.config.bootstrap }
              : {}),
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

    const prompt = [
      ctx.formatted,
      '',
      `**Tasks file (for tool calls):** ${tasksPath}`,
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
    if (typeof agent.loadToolMetadata === 'function') {
      const likelyTargetFiles = resolveLikelyTaskFiles(task)
      const scopeDecisionTexts = resolvedScopeDecisionTexts(task)
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
        ...(checkpointNextAction
          ? { current_task_checkpoint_next_action: checkpointNextAction }
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
      agent_name: agent.name,
      from_status: beforeStatus,
      message: `${agent.name} is working on ${task.title}`,
    })
    this.livenessTracker.touch(agent.name)
    await this.emitBackendEvent({
      type: 'line_complete',
      task_id: task.id,
      agent_name: agent.name,
      message: 'Waiting for the local model to respond.',
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
    )
    const controller = new AbortController()
    const externalAbort = this.opts.abortSignal
    const abortListener = () => controller.abort()
    let inactivityTimeoutHandle: ReturnType<typeof setTimeout> | undefined
    let wallClockTimeoutHandle: ReturnType<typeof setTimeout> | undefined
    try {
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
                const backendEvent = streamEventToBackendEvent(event, {
                  taskId: task.id,
                  agentName: agent.name,
                })
                if (
                  backendEvent?.type === 'line_complete' &&
                  (
                    /kept returning no tool call after checkpoint-directed nudges/i.test(
                      backendEvent.message ?? '',
                    ) ||
                    /ending the turn so the orchestrator can treat this as no progress/i.test(
                      backendEvent.message ?? '',
                    ) ||
                    /kept researching after an explicit durable-progress nudge/i.test(
                      backendEvent.message ?? '',
                    ) ||
                    /kept researching without recording durable progress/i.test(
                      backendEvent.message ?? '',
                    )
                  )
                ) {
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
          ? bestExploringAssistantFallbackTextForTurn(
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
      this.dirtyWorkerTimeoutRetries.delete(retryKey)
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
            message: `Model returned an empty reply. Retrying (${retries}/2) without changing task state.`,
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
            ? bestExploringAssistantFallbackTextForTurn(
                agent.messages,
                priorMessageCount,
              )
            : ''
          if (fallbackText.trim().length > 0) {
            await this.withQueueWriteLock(async () => {
              await this.persistExploringFallbackProgress({
                taskId: task.id,
                generatedText: fallbackText,
                openQuestionCountBefore: task.openQuestions?.length ?? 0,
              })
            })
          }
        }
        const preserved = await this.preserveDurableProgressAfterTurnLimit({
          taskId: task.id,
          agentName: agent.name,
          beforeStatus,
          interruption: 'turn_limit',
        })
        if (preserved) {
          return preserved
        }
        const escalation = await raiseEscalation({
          tasksPath,
          progressPath: this.progressPath(),
          taskId: task.id,
          agentId: agent.name,
          reason: 'human_judgment_required',
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
          interruption: 'timeout',
        })
        if (preserved) {
          this.specTimeoutRetries.delete(retryKey)
          return preserved
        }
        const specTimeoutRetries = (this.specTimeoutRetries.get(retryKey) ?? 0) + 1
        this.specTimeoutRetries.set(retryKey, specTimeoutRetries)
        if (specTimeoutRetries <= 1) {
          await this.emitBackendEvent({
            type: 'line_complete',
            task_id: task.id,
            agent_name: agent.name,
            message:
              'Spec shaping timed out before saving durable progress. Guildhall will retry this shaping lane once before asking for owner intervention.',
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
        const escalation = await raiseEscalation({
          tasksPath,
          progressPath: this.progressPath(),
          taskId: task.id,
          agentId: agent.name,
          reason: 'human_judgment_required',
          summary,
          details:
            `${message}\n\n` +
            'Guildhall did not get a saved brief, question, spec, or task transition before the spec lane timed out. Retry the shaping lane, switch provider, or reframe the task before attempting autonomous work again.',
        })
        if (escalation.success && escalation.escalationId) {
          this.specTimeoutRetries.delete(retryKey)
          await this.annotateWorkerBlockedClassification({
            taskId: task.id,
            agentId: 'coordinator',
            classification: {
              class: 'provider_unavailable',
              confidence: 'medium',
              evidence: [{
                kind: 'task',
                summary,
                ref: message,
              }],
              scope: 'task',
              safePlaybooks: ['ask_concrete_human_question'],
              needsHuman: true,
              humanQuestion:
                'The spec lane timed out before saving a brief, question, or spec. Should Guildhall retry this lane, switch provider, or reframe the task?',
            },
          })
          return {
            kind: 'escalated',
            taskId: task.id,
            agent: agent.name,
            reason: summary,
            escalationId: escalation.escalationId,
          }
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
          const dirtyTimeoutRetries = (this.dirtyWorkerTimeoutRetries.get(retryKey) ?? 0) + 1
          this.dirtyWorkerTimeoutRetries.set(retryKey, dirtyTimeoutRetries)
          if (dirtyTimeoutRetries > 2) {
            const summary = 'Worker repeatedly hit its turn budget after saving partial work.'
            const escalation = await raiseEscalation({
              tasksPath,
              progressPath: this.progressPath(),
              taskId: task.id,
              agentId: agent.name,
              reason: 'human_judgment_required',
              summary,
              details:
                `${message}\n\n` +
                'Guildhall preserved dirty worktree edits across multiple worker retries, but the worker kept exhausting its turn budget without handing off, blocking, or completing the task. Review the partial diff/checkpoint, then retry, narrow the task, or switch provider.',
            })
            if (escalation.success && escalation.escalationId) {
              this.dirtyWorkerTimeoutRetries.delete(retryKey)
              await this.annotateWorkerBlockedClassification({
                taskId: task.id,
                agentId: 'coordinator',
                classification: {
                  class: 'model_tool_use_failure',
                  confidence: 'medium',
                  evidence: [{
                    kind: 'task',
                    summary,
                    ref: message,
                  }],
                  scope: 'task',
                  safePlaybooks: ['ask_concrete_human_question'],
                  needsHuman: true,
                  humanQuestion:
                    'The worker saved partial edits but repeatedly exhausted its turn budget before handoff. Should Guildhall retry from the partial diff, narrow the task, or switch provider?',
                },
              })
              return {
                kind: 'escalated',
                taskId: task.id,
                agent: agent.name,
                reason: summary,
                escalationId: escalation.escalationId,
              }
            }
          }
          await this.emitBackendEvent({
            type: 'line_complete',
            task_id: task.id,
            agent_name: agent.name,
            message:
              dirtyTimeoutRetries === 1
                ? 'The worker hit its turn budget after making worktree edits, so Guildhall is preserving that partial implementation for the next pass.'
                : 'The worker hit its turn budget again with dirty work preserved. Guildhall will retry once more before asking for owner intervention.',
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
        if (likelyWorkerTargets.length > 0 && !worktreeDirty) {
          const escalation = await raiseEscalation({
            tasksPath,
            progressPath: this.progressPath(),
            taskId: task.id,
            agentId: agent.name,
            reason: 'human_judgment_required',
            summary: 'Worker timed out after failing to mutate the likely target file.',
            details:
              `${message}\n\n` +
              `Task stayed in progress without visible worktree edits after Guildhall ` +
              `demanded concrete progress on the authoritative likely target files.`,
          })
          if (escalation.success && escalation.escalationId) {
            await this.annotateWorkerBlockedClassification({
              taskId: task.id,
              agentId: 'coordinator',
              classification: {
                class: 'provider_unavailable',
                confidence: 'medium',
                evidence: [{
                  kind: 'task',
                  summary: 'Worker timed out before mutating the likely target file.',
                  ref: message,
                }],
                scope: 'task',
                safePlaybooks: ['ask_concrete_human_question'],
                needsHuman: true,
                humanQuestion:
                  'The worker timed out without touching the likely target file. Should Guildhall retry this lane, switch provider, or narrow the task?',
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
        const openQuestionCountBefore = task.openQuestions?.length ?? 0
        const reviewerNoteCountBefore = countReviewerNotes(task)
        const reviewVerdictCountBefore = task.reviewVerdicts.length
        const metadataVerifiedWork = Array.isArray(successfulAgentMetadata?.['recent_verified_work'])
          ? (successfulAgentMetadata['recent_verified_work'] as unknown[])
              .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          : []
        const generatedVerifiedWork = generatedText
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => /^Ran bash command\b/i.test(line))
        const recentVerifiedWork = uniqueNonEmptyStrings([
          ...metadataVerifiedWork,
          ...generatedVerifiedWork,
        ])
        const learnedVerificationCommands =
          beforeStatus === 'in_progress' &&
          reconcileAutomatedAcceptanceCommandsFromVerifiedWork({
            task: taskAfter,
            workspaceProjectPath: this.opts.config.projectPath,
            recentVerifiedWork,
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
          if (taskAfter.status === 'exploring') taskAfter.status = 'spec_review'
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
          taskAfter.status = 'spec_review'
          taskAfter.updatedAt = this.now()
          queueAfter.lastUpdated = this.now()
          await this.writeQueue(queueAfter)
          afterStatus = taskAfter.status
          transitioned = true
        }

        if (taskAfter.status === 'spec_review' && typeof taskAfter.spec === 'string' && taskAfter.spec.trim().length > 0) {
          const existingQuestions = Array.isArray(taskAfter.openQuestions) ? taskAfter.openQuestions : []
          const retainedQuestions = existingQuestions.filter((question) =>
            Boolean(question.answeredAt) || !isObsoleteStarterTaskFocusQuestion(taskAfter, question as Record<string, unknown>),
          )
          if (retainedQuestions.length !== existingQuestions.length) {
            taskAfter.openQuestions = retainedQuestions
            taskAfter.updatedAt = this.now()
            queueAfter.lastUpdated = this.now()
            await this.writeQueue(queueAfter)
          }
        }

        let transcriptAppended = false
        let fallbackBriefAuthored = false
        let fallbackQuestionPosted = false
        if (
          agent.name === 'spec-agent' &&
          beforeStatus === 'exploring' &&
          generatedText.trim().length > 0
        ) {
          const fallback = await this.persistExploringFallbackProgress({
            taskId: task.id,
            generatedText,
            openQuestionCountBefore,
          })
          transcriptAppended = fallback.transcriptAppended
          fallbackBriefAuthored = fallback.fallbackBriefAuthored
          fallbackQuestionPosted = fallback.fallbackQuestionPosted
        }

        const madeExploringProgress =
          transitioned ||
          taskAfter.updatedAt !== task.updatedAt ||
          fallbackBriefAuthored ||
          fallbackQuestionPosted

        if (
          beforeStatus === 'review' &&
          afterStatus === 'review' &&
          countReviewerNotes(taskAfter) === reviewerNoteCountBefore &&
          taskAfter.reviewVerdicts.length === reviewVerdictCountBefore
        ) {
          const fallbackVerdict = deterministicReview(taskAfter, {
            projectPath: taskAfter.projectPath,
            likelyTargetFiles: resolveLikelyTaskFiles(taskAfter),
            resolvedDecisionTexts: resolvedScopeDecisionTexts(taskAfter),
          })
          if (generatedText.trim().length > 0) {
            taskAfter.notes.push({
              agentId: 'reviewer-agent',
              role: 'reviewer',
              content: generatedText.trim(),
              timestamp: this.now(),
            })
            afterStatus =
              fallbackVerdict.verdict === 'approve' ? 'gate_check' : 'in_progress'
            taskAfter.status = afterStatus
          } else {
            const deterministicResult = applyDeterministicVerdict({
              queue: queueAfter,
              taskId: task.id,
              verdict: fallbackVerdict,
              now: this.now(),
              llmError: 'Reviewer returned no durable verdict.',
            })
            afterStatus = deterministicResult.newStatus
          }
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
              resolvedDecisionTexts: resolvedScopeDecisionTexts(taskAfter),
            },
            latestHardGates,
          )
          if (hardGateDisposition) {
            if (hardGateDisposition.shouldPass) {
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
            const summary = checkpointNoProgressStatusSeen
              ? 'Spec agent kept researching after Guildhall asked for durable progress.'
              : `Spec agent made no visible progress after ${attempts} passes.`
            const escalation = await raiseEscalation({
              tasksPath: this.tasksPath(),
              progressPath: this.progressPath(),
              taskId: task.id,
              agentId: agent.name,
              reason: 'human_judgment_required',
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

        const taskRepoRootAfter = resolveEffectiveTaskProjectPath(taskAfter, this.opts.config.projectPath)
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
        const corpusRefreshTouchedFiles = uniqueStrings([
          ...dirtyTaskFilesAfter,
          ...checkpointTouchedFiles,
        ])
        const hasCheckpointScopedVerifiedProgress =
          beforeStatus === 'in_progress' &&
          this.hasDurableWorkerHandoffEvidence(successfulAgentMetadata, task.id) &&
          checkpointTouchedFiles.length > 0
        const checkpointNextAction =
          beforeStatus === 'in_progress'
            ? normalizedWorkerCheckpointNextAction(
                taskAfter,
                typeof successfulAgentMetadata?.['current_task_checkpoint_next_action'] === 'string'
                  ? successfulAgentMetadata['current_task_checkpoint_next_action']
                  : null,
              )
            : ''
        const hasFailedCheckpointVerification =
          beforeStatus === 'in_progress' &&
          checkpointHasRecordedVerificationFailure(checkpoint?.resumeContext?.verification ?? [])
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
          !hasCheckpointScopedVerifiedProgress &&
          workerAddedSelfCritiqueSince(task, taskAfter, agent.name)
        const canAutoPromoteReviewFromCheckpointHandoff =
          agent.name === 'worker-agent' &&
          beforeStatus === 'in_progress' &&
          afterStatus === 'in_progress' &&
          !transitioned &&
          hasCheckpointScopedVerifiedProgress &&
          this.hasReviewProofPacket(taskAfter) &&
          looksLikeReviewHandoffNextAction(checkpointNextAction)
        const canAutoPromoteReviewFromFreshHandoff =
          agent.name === 'worker-agent' &&
          beforeStatus === 'in_progress' &&
          afterStatus === 'in_progress' &&
          !transitioned &&
          workerAddedSelfCritiqueSince(task, taskAfter, agent.name) &&
          hasWorkerTurnEvidence &&
          this.hasReviewProofPacket(taskAfter) &&
          (hasDirtyLikelyTargetProgress || hasDirtyWorktreeAfter || hasCheckpointScopedVerifiedProgress)
        if (canAutoPromoteReviewFromCheckpointHandoff || canAutoPromoteReviewFromFreshHandoff) {
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
              'The worker had already produced durable verification evidence and a structured self-critique. Guildhall promoted the task to review instead of leaving it stuck in a handoff loop.',
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
            /self-critique without project-file changes/i.test(note.content),
          )
          if (!alreadyRejected) {
            taskAfter.notes.push({
              agentId: 'coordinator',
              role: 'worker-progress-review',
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
          taskAfter.updatedAt === task.updatedAt &&
          (
            (hasDirtyWorktreeAfter && (!hasFailedCheckpointVerification || hasWorkerTurnEvidence)) ||
            hasDirtyLikelyTargetProgress ||
            hasCheckpointScopedVerifiedProgress
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
        const repeatedWorkerNoProgress =
          agent.name === 'worker-agent' &&
          beforeStatus === 'in_progress' &&
          afterStatus === 'in_progress' &&
          !transitioned &&
          (taskAfter.updatedAt === task.updatedAt || workerFalseCompletionNarration) &&
          (!hasDirtyWorktreeAfter || (hasFailedCheckpointVerification && !hasWorkerTurnEvidence)) &&
          !hasDirtyLikelyTargetProgress &&
          !hasCheckpointScopedVerifiedProgress &&
          (likelyWorkerTargets.length > 0 || workerFalseCompletionNarration)
        if (repeatedWorkerNoProgress) {
          const attempts = this.bumpWorkerNoProgress(task.id)
          if (attempts >= WORKER_NO_PROGRESS_ESCALATION_AFTER) {
            if (
              (checkpointNoProgressStatusSeen || hasFailedCheckpointVerification) &&
              (taskAfter.remediationAttempts ?? 0) < 1
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
                this.clearWorkerNoProgress(task.id)
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
              summary: `Worker made no visible progress after ${attempts} passes.`,
              details:
                `Task remained in progress with no worktree edits, note, or status transition ` +
                `after reopening likely target files. The worker must either mutate one of those ` +
                `files, run focused verification tied to a file it just changed, or explicitly ` +
                `escalate instead of ending another no-op step.`,
            })
            this.clearWorkerNoProgress(task.id)
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
        } else {
          this.clearWorkerNoProgress(task.id)
        }

      // FR-27 / AC-18: record LLM verdict when a review actually ran.
      if (beforeStatus === 'review') {
        const llmVerdict = recordLlmVerdict({
          queue: queueAfter,
          taskId: task.id,
          beforeStatus,
          afterStatus,
          now: this.now(),
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
          /already in review|stale checkpoint/i.test(`${newest.summary}\n${newest.details ?? ''}`) &&
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
          await this.writeQueue(queueAfter)

          await raiseEscalation({
            tasksPath: this.tasksPath(),
            progressPath: this.progressPath(),
            taskId: task.id,
            agentId: agent.name,
            reason: 'max_revisions_exceeded',
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

      return {
        kind: 'processed',
        taskId: task.id,
        agent: agent.name,
        beforeStatus,
        afterStatus,
        transitioned,
        revisionCount,
        ...(taskHasUnansweredUserQuestion(taskAfter) || fallbackQuestionPosted ? { waitingOnUser: true } : {}),
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
    // successGates before any task is dispatched. Skipped when the lockfile
    // hash + command set haven't changed since the last successful run.
    // A failed bootstrap aborts startup — dispatching workers into a project
    // that can't typecheck is worse than doing nothing.
    const bootstrap = this.opts.config.bootstrap
    if (bootstrap && bootstrap.commands.length > 0) {
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
    while (tick < maxTicks) {
      tick++
      const raw = await this.tick({
        ...(stopAfterOneTask ? { dispatchLimit: 1 } : {}),
        ...(preferredTaskId ? { preferredTaskId } : {}),
      })

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
          console.log(
            `[guildhall] tick ${tick}: ${outcome.taskId} ${outcome.beforeStatus} → ${outcome.afterStatus} via ${outcome.agent}${outcome.transitioned ? '' : ' (no change)'}`,
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
      for (const issue of task.agentIssues) {
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

    return buildRemediationContext({
      trigger,
      task,
      levers: {
        remediationAutonomy: settings.project.remediation_autonomy.position,
        crashRecoveryDefault: domainLevers.crash_recovery_default.position,
        agentHealthStrictness: settings.project.agent_health_strictness.position,
      },
      checkpoint,
      priorAttempts: task.remediationAttempts,
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
    task.remediationAttempts = (task.remediationAttempts ?? 0) + 1
    task.updatedAt = this.now()
    queue.lastUpdated = this.now()
    await this.writeQueue(queue)
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
      priorAttempts: input.task.remediationAttempts ?? 0,
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
    input.task.agentIssues.push(issue)
    input.task.remediationAttempts = (input.task.remediationAttempts ?? 0) + 1
    input.task.status = 'in_progress'
    ensureWorkerOwnership(input.task)
    input.task.blockReason = undefined
    input.task.notes.push({
      agentId: 'coordinator-remediation',
      role: 'checkpoint',
      content:
        'Autonomous remediation: reset the worker conversation and restarted from the latest checkpoint after repeated checkpoint no-progress stops.',
      timestamp: now,
    })
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
    let mutated = false

    for (const task of queue.tasks) {
      for (const issue of task.agentIssues) {
        if (!issue.broadcast && !issue.resolvedAt) {
          issue.broadcast = true
          drained.push(issue)
          mutated = true
        }
      }
    }

    if (mutated) {
      queue.lastUpdated = this.now()
      await this.writeQueue(queue)
    }

    return drained
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private selectAgent(task: Task):
    | { kind: 'agent'; agent: OrchestratorAgent; promptSuffix: string }
    | { kind: 'no-coordinator' } {
    const hasDraftEvidence = taskHasDraftEvidence(task)
    if (
      task.id !== META_INTAKE_TASK_ID &&
      (task.status === 'ready' || task.status === 'in_progress') &&
      hasDraftEvidence &&
      !task.spec?.trim()
    ) {
      return {
        kind: 'agent',
        agent: this.opts.agents.spec,
        promptSuffix:
          "This task advanced without a saved spec. Do not implement it yet. " +
          "Write the implementation spec into the task spec via update-task, then set status to 'spec_review' so the coordinator can review it.",
      }
    }

    switch (task.status) {
      case 'exploring':
        return {
          kind: 'agent',
          agent: this.opts.agents.spec,
          promptSuffix:
            "Drive the conversational intake (FR-12): elicit outcome, numbered acceptance criteria, " +
            "out-of-scope list, happy path + edge cases, domain routing, blast radius, required skills, " +
            "and escalation triggers. When the spec is complete and the user approves, use the " +
            "update-task tool to set status to 'spec_review'.",
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
        return {
          kind: 'agent',
          agent: this.opts.agents.worker,
          promptSuffix:
            "Implement this task per the spec. Before any review handoff, persist a self-critique note that includes: acceptance-criterion status, a minimum-scope check, a Review proof packet with changed files/diff scope, exact verification commands and pass/fail results, proof path updates for actual commands/routes/manual workflows/provider dashboards/blocking setup, the current working hypothesis, and known gaps. Only after that proof packet is durable should you transition status to 'review'.",
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
      const settingsPath = path.join(this.opts.config.memoryDir, AGENT_SETTINGS_FILENAME)
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
        target.status = 'spec_review'
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
    if (target.status === 'exploring') target.status = 'spec_review'
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
      const settingsPath = path.join(this.opts.config.memoryDir, AGENT_SETTINGS_FILENAME)
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
    return path.join(this.opts.config.memoryDir, 'TASKS.json')
  }

  private progressPath(): string {
    return path.join(this.opts.config.memoryDir, 'PROGRESS.md')
  }

  private decisionsPath(): string {
    return path.join(this.opts.config.memoryDir, 'DECISIONS.md')
  }

  /**
   * FR-32 helper: read agent-settings.yaml. Throws if missing — the
   * remediation loop requires real lever state to route authorization
   * decisions correctly (unlike stall scanning which can fall back to
   * 'standard' strictness).
   */
  private async readLeverSettings() {
    const settingsPath = path.join(
      this.opts.config.memoryDir,
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
  private async runAcceptanceCommandGatesInline(task: Task): Promise<TickOutcome | null> {
    if (task.status !== 'gate_check') return null
    const commandCriteria = task.acceptanceCriteria
      .map((criterion, index) => ({ criterion, index }))
      .filter(({ criterion }) => shouldRunAcceptanceCommandCriterion(task, criterion))
    if (commandCriteria.length === 0) return null

    const taskProjectPath =
      typeof task.worktreePath === 'string' && task.worktreePath.trim().length > 0
        ? task.worktreePath.trim()
        : resolveEffectiveTaskProjectPath(task, this.opts.config.projectPath)
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
    const results = summary.results.map((result) => {
      const command = commandByGateId.get(result.gateId) ?? result.gateId
      const outcome = `${command} — ${result.passed ? 'exit 0' : 'non-zero exit'}`
      return {
        ...result,
        output: result.output ? `${outcome}\n${result.output}` : outcome,
      }
    })

    const beforeStatus = task.status
    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const current = queue.tasks.find((candidate) => candidate.id === task.id)
      if (!current || current.status !== 'gate_check') return null

      const resultByGateId = new Map(results.map((result) => [result.gateId, result]))
      const resultIds = new Set(resultByGateId.keys())
      current.gateResults = [
        ...current.gateResults.filter((result) => !(result.type === 'hard' && resultIds.has(result.gateId))),
        ...results,
      ]
      for (const criterion of current.acceptanceCriteria) {
        const result = resultByGateId.get(criterion.id)
        if (result) criterion.met = result.passed
      }

      const now = this.now()
      current.updatedAt = now
      queue.lastUpdated = now

      const scopedHardGateDisposition = !summary.allPassed
        ? summarizeScopedHardGateDisposition(
            {
              projectPath: current.projectPath,
              likelyTargetFiles: resolveLikelyTaskFiles(current),
              resolvedDecisionTexts: resolvedScopeDecisionTexts(current),
            },
            latestHardGateResults(current),
          )
        : null
      const scopedFailuresExempted = scopedHardGateDisposition?.shouldPass === true
      if (scopedFailuresExempted) {
        const exemptedIds = new Set(scopedHardGateDisposition.exemptedFailures.map((gate) => gate.gateId))
        for (const criterion of current.acceptanceCriteria) {
          if (exemptedIds.has(criterion.id)) criterion.met = true
        }
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

      if (!summary.allPassed && !scopedFailuresExempted) {
        const failed = results.filter((result) => !result.passed)
        transitionTaskStatus({
          task: current,
          event: 'revise',
          actor: 'acceptance-command-gates',
          evidenceRefs: failed.map((result) => `gate:${result.gateId}`),
          now,
        })
        ensureWorkerOwnership(current)
        current.revisionCount += 1
        current.notes.push({
          agentId: 'acceptance-command-gates',
          role: 'gate-checker',
          content: [
            `Acceptance command gates failed (${failed.length}).`,
            ...failed.map((result) => `- ${result.gateId}: ${(result.output ?? '').split('\n')[0] ?? 'failed'}`),
            'Repair the implementation in the likely target files, then rerun the focused command gates before writing new proof.',
          ].join('\n'),
          timestamp: now,
        })
        await this.writeQueue(queue)
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
            const effectiveTaskProjectPath = resolveEffectiveTaskProjectPath(
              current,
              this.opts.config.projectPath,
            )
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
        await this.writeQueue(queue)
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
      const handoffNote = extractHandoffNote(t)
      // Clone the step shape — zod `.default([])` nested shapes can't be
      // partially mutated without TypeScript's exactOptionalPropertyTypes
      // complaining, so we rebuild the step.
      t.handoffSequence = t.handoffSequence.map((s, i) =>
        i === idx
          ? {
              ...s,
              completedAt: now,
              ...(handoffNote ? { handoffNote } : {}),
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

    let verdicts: PersonaVerdict[]
    try {
      verdicts = await runner({
        task,
        builtContext: ctx,
        personas,
        ...(reviewPlan ? { reviewPlan } : {}),
        context: ctx.formatted,
        memoryDir: this.opts.config.memoryDir,
        projectPath: task.projectPath || this.opts.config.projectPath,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await this.logTickProgress({
        task,
        agent: 'reviewer-fanout',
        beforeStatus: 'review',
        afterStatus: 'review',
        transitioned: false,
        note: `reviewer fan-out failed: ${message} — falling through to single reviewer`,
      })
      return null
    }
    if (verdicts.length === 0) return null

    const substantiveVerdicts = verdicts.filter(
      (verdict) => !isInfrastructureOnlyFanoutFailure(verdict),
    )
    const hasSubstantiveRevise = substantiveVerdicts.some(
      (verdict) => verdict.verdict === 'revise',
    )
    if (
      substantiveVerdicts.length === 0 ||
      (!hasSubstantiveRevise && substantiveVerdicts.length < verdicts.length)
    ) {
      await this.logTickProgress({
        task,
        agent: 'reviewer-fanout',
        beforeStatus: 'review',
        afterStatus: 'review',
        transitioned: false,
        note:
          'reviewer fan-out inconclusive: provider/turn failures dominated persona review — falling through to single reviewer',
      })
      return null
    }

    // Policy selection + prior-rounds extraction for same-persona-repeat
    // dissent detection. When the lever is
    // `coordinator_adjudicates_on_conflict`, `aggregate.needsAdjudication`
    // may flip true — we branch on it below.
    const policy = await this.resolveReviewerFanoutPolicy(task.domain)
    const priorRounds = extractPriorVerdictRounds(task.reviewVerdicts)
    const aggregate = aggregateFanout(verdicts, { policy, priorRounds })
    const proceduralOnlyDissent =
      aggregate.verdict === 'revise' &&
      isProceduralOnlyFanoutDissent(aggregate.dissenting)
    const beforeStatus = task.status

    return await this.withQueueWriteLock(async () => {
      const queue = await this.readQueue()
      const t = queue.tasks.find((x) => x.id === task.id)
      if (!t) return null

      // Persist one ReviewVerdict per persona — the audit trail shows which
      // expert agreed and which objected.
      const now = this.now()
      for (const v of verdicts) {
        t.reviewVerdicts.push(personaVerdictToReviewRecord(v, { now }))
      }
      await this.persistReviewerRuns({
        task: t,
        verdicts,
        reviewPlan,
        recordedAt: now,
      })

      const repeatedAfterCoordinatorAdjudication =
        aggregate.verdict === 'revise' &&
        !proceduralOnlyDissent &&
        hasPriorAdjudicationForDissent(t, aggregate.dissenting)
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

      // Under `coordinator_adjudicates_on_conflict`, recurrent same-persona
      // dissent short-circuits to the domain coordinator instead of looping
      // the worker. The worker will re-enter in_progress only after the
      // coordinator lands a binding AdjudicationRecord with scoped
      // instructions.
      const shouldInspectRepeatedHandoff =
        aggregate.verdict === 'revise' &&
        !proceduralOnlyDissent &&
        (aggregate.needsAdjudication ||
          hasOverlappingPriorDissent(aggregate.dissenting, priorRounds))
      if (shouldInspectRepeatedHandoff) {
        if (!aggregate.needsAdjudication) {
          aggregate.needsAdjudication = true
          aggregate.adjudicationTrigger = 'policy_conflict'
        }
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

      if (aggregate.verdict === 'approve' || proceduralOnlyDissent) {
        if (proceduralOnlyDissent) {
          t.notes.push({
            agentId: 'reviewer-fanout',
            role: 'reviewer',
            content:
              'Reviewer fan-out advisory note: remaining dissent was procedural-only after reviewers stated the task met acceptance criteria. Preserving the advice without blocking gate_check.\n\n' +
              aggregate.combinedFeedback,
            timestamp: now,
          })
          const adjudicatedVerdict: ReviewVerdict = {
            verdict: 'approve',
            reviewerPath: 'deterministic',
            reason:
              'Reviewer fan-out advanced after procedural-only dissent was preserved as advisory.',
            reasoning:
              'Guildhall kept the persona dissent in the task notes, but the dissent stated the acceptance criteria were met and asked only for process or audit follow-up. The task can proceed to gate_check.',
            failingSignals: [],
            recordedAt: now,
          }
          t.reviewVerdicts.push(adjudicatedVerdict)
        }
        transitionTaskStatus({
          task: t,
          event: 'start_gate_check',
          actor: 'reviewer-fanout',
          evidenceRefs: verdicts.map((verdict) => `reviewer-fanout:${verdict.guildSlug}`),
          now,
        })
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
        } as TickOutcome
      }

      // Aggregate says revise — append combined feedback, bump revisionCount,
      // enforce maxRevisions.
      t.notes.push({
        agentId: 'reviewer-fanout',
        role: 'reviewer',
        content: aggregate.combinedFeedback,
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
          findings: verdict.revisionItems.map((item) => ({
            lane: recipe.lanes[0] ?? 'test_adequacy',
            severity: 'high',
            summary: item,
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
   * Route a fan-out aggregate with `needsAdjudication: true` to the domain
   * coordinator. The coordinator receives the verdict set + dissent
   * transcript, produces a binding AdjudicationRecord (appended to
   * `task.adjudications`), and either:
   *   - Advances the task to `gate_check` with superseded dissenters
   *     recorded (coordinator resolved the conflict in favor of approving
   *     the work).
   *   - Bounces to `in_progress` with the coordinator's `scopeInstructions`
   *     as the worker prompt, rather than the raw dissent (worker cannot
   *     relitigate; it executes within the adjudicated scope).
   *   - Raises an escalation if the coordinator cannot decide
   *     autonomously under the current `remediation_autonomy` posture.
   *
   * This method builds the record deterministically from the aggregate; the
   * live coordinator LLM pass will be layered on later (FR-32 remediation
   * loop extension). For now we record a deterministic "keep the dissent's
   * scoped instructions, mark recurrent-dissent as the trigger" decision
   * and bounce to the worker with those instructions — which is still a
   * meaningful improvement: the worker's prompt is the specific list of
   * changes, not the full conflict transcript.
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

    // For v1: the deterministic adjudication record. Every dissenter is
    // recorded as a "winning concern" (we treat all dissents as load-
    // bearing until an LLM coordinator pass overrides). The worker gets
    // scoped instructions = the union of dissent revision items, framed as
    // the coordinator's decision.
    const dissenterSlugs = input.aggregate.dissenting.map(d => d.guildSlug)
    const scopeInstructions: string[] = []
    for (const d of input.aggregate.dissenting) {
      for (const item of d.revisionItems) {
        if (!scopeInstructions.includes(item)) scopeInstructions.push(item)
      }
      if (d.revisionItems.length === 0) {
        const fallback = d.reasoning
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 420)
        if (fallback && !scopeInstructions.includes(fallback)) {
          scopeInstructions.push(`${d.guildName}: ${fallback}`)
        }
      }
    }

    const rationale = [
      `Reviewer fan-out round ${input.round} produced recurring dissent from`,
      `${dissenterSlugs.join(', ')}. Guildhall routed this repeated handoff`,
      `to the domain coordinator (${input.task.domain}) before bouncing the`,
      'task back to the worker again.',
      '',
      'Decision (deterministic v1): keep each dissenting persona\'s scoped',
      'instructions. Worker executes the scoped list; the dissent transcript',
      'is NOT in the worker prompt so the worker cannot relitigate.',
    ].join('\n')

    const adjudication: AdjudicationRecord = {
      round: input.round,
      trigger: input.aggregate.adjudicationTrigger ?? 'same_persona_repeat_dissent',
      dissenters: dissenterSlugs,
      winningConcerns: dissenterSlugs,
      supersededConcerns: [],
      summary: `Coordinator adjudicated: worker to address ${scopeInstructions.length} scoped item${scopeInstructions.length === 1 ? '' : 's'} from ${dissenterSlugs.join(', ')}`,
      rationale,
      scopeInstructions,
      decidedBy: 'coordinator',
      decidedAt: input.now,
    }
    input.task.adjudications.push(adjudication)

    // Write a DECISIONS.md entry capturing the adjudication so the audit
    // trail lives outside TASKS.json too.
    const decisionsPath = path.join(this.opts.config.memoryDir, 'DECISIONS.md')
    const decisionEntry = [
      `### ${input.now} — Reviewer fan-out adjudication`,
      '',
      `**Task:** ${input.task.id}`,
      `**Domain:** ${input.task.domain}`,
      `**Coordinator:** ${coordinatorId}`,
      `**Trigger:** ${adjudication.trigger} (round ${adjudication.round})`,
      `**Dissenters:** ${dissenterSlugs.join(', ') || 'none'}`,
      '',
      '**Rationale:**',
      rationale,
      '',
      '**Scoped instructions to worker:**',
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

    // Build the worker's next prompt from scope instructions only.
    const scopedFeedback = [
      `**Coordinator adjudication (round ${adjudication.round}):**`,
      '',
      adjudication.summary,
      '',
      '**Scoped instructions (address exactly these items):**',
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
      evidenceRefs: dissenterSlugs.map((slug) => `reviewer-fanout:${slug}`),
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
      note: `coordinator adjudicated (dissenters: ${dissenterSlugs.join(', ')}) → scoped rework`,
    })
    return {
      kind: 'processed',
      taskId: input.task.id,
      agent: coordinatorId,
      beforeStatus: input.beforeStatus,
      afterStatus: 'in_progress',
    } as TickOutcome
  }

  private async applyReviewVerdictInline(opts: {
    task: Task
    queue: TaskQueue
    llmError: string | undefined
  }): Promise<TickOutcome> {
    const { task, queue, llmError } = opts
    const beforeStatus = task.status
    const taskForVerdict = queue.tasks.find((t) => t.id === task.id) ?? task
    reconcileAcceptanceCriteriaFromLatestWorkerSelfCritique(taskForVerdict)
    let verdict = deterministicReview(taskForVerdict, {
      projectPath: taskForVerdict.projectPath,
      likelyTargetFiles: resolveLikelyTaskFiles(taskForVerdict),
      resolvedDecisionTexts: resolvedScopeDecisionTexts(taskForVerdict),
    })
    if (shouldAdvanceInfraFallbackToGateCheck(taskForVerdict, verdict, llmError)) {
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
    try {
      const projectRoot = inferProjectRootFromMemoryDir(this.opts.config.memoryDir)
      return await buildEffectiveTask(projectRoot, task) as unknown as Task
    } catch {
      return task
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
    for (const task of queue.tasks) {
      if (task.status !== 'blocked') continue
      if (!this.hasGuildhallOwnershipTrail(task)) continue
      const blockReason = task.blockReason ?? ''
      let recoveryNote: string | null = null
      let recoveryRole = 'recovery'
      let recoveryStatus: Task['status'] = 'in_progress'
      let recoveryAssignee: string | null = 'worker-agent'
      if (blockReason.includes('Guildhall could not start work because the target repo is dirty:')) {
        const repoRoot = resolveEffectiveTaskProjectPath(task, this.opts.config.projectPath)
        const repoClean = await this.gitDriver.isClean(repoRoot)
        if (repoClean) continue
        recoveryNote =
          'User restarted the project while Guildhall-owned shared-checkout edits were still present. Reopened the task so Guildhall can checkpoint those edits into an isolated task branch.'
      } else if (
        blockReason.includes('Guildhall could not start work because task setup failed:') ||
        blockReason.includes('project setup contract changed, but task setup still fails:')
      ) {
        const effectiveTaskProjectPath = resolveEffectiveTaskProjectPath(task, this.opts.config.projectPath)
        const activeWorktreePath = task.worktreePath?.trim() ?? ''
        const wtBootstrap = resolveEffectiveTaskBootstrapBlock({
          task,
          workspaceProjectPath: this.opts.config.projectPath,
          workspaceBootstrap: this.opts.config.bootstrap ?? undefined,
          workspaceProjects: this.opts.config.projects ?? [],
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
      } else if (isRecoverableEnvironmentSetupBlocker(task)) {
        const effectiveTaskProjectPath = resolveEffectiveTaskProjectPath(task, this.opts.config.projectPath)
        const activeWorktreePath = task.worktreePath?.trim() ?? ''
        const wtBootstrap = resolveEffectiveTaskBootstrapBlock({
          task,
          workspaceProjectPath: this.opts.config.projectPath,
          workspaceBootstrap: this.opts.config.bootstrap ?? undefined,
          workspaceProjects: this.opts.config.projects ?? [],
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
          'User restarted the project after the spec agent failed to save a durable draft. Reopened intake so Guildhall can retry from the preserved transcript notes.'
      } else if (isRecoverableBlueprintToolingBlocker(task)) {
        resolveRecoverableBlueprintToolingEscalations(task, now)
        if (activeEscalations(task).length > 0) continue
        recoveryRole = 'foreman-inspection'
        recoveryStatus = hasUsableBlueprint(task) ? 'spec_review' : 'exploring'
        recoveryAssignee = recoveryStatus === 'exploring' ? 'spec-agent' : null
        recoveryNote =
          'Foreman inspection found a stale blueprint/tooling blocker rather than a real owner decision. Cleared the blocker so Guildhall can continue from the current plan and inspect nearby evidence instead of asking the user to repair an internal path guardrail.'
      } else if (isRecoverableToolPathMismatchBlocker(task)) {
        resolveRecoverableToolPathMismatchEscalations(task, now)
        if (activeEscalations(task).length > 0) continue
        recoveryStatus = 'ready'
        recoveryAssignee = null
        recoveryNote =
          'User restarted the project after an old tool/path routing bug blocked this task. Reopened the worker lane so Guildhall can retry with the corrected task-worktree context.'
      } else if (isRecoverableTurnLimitBlocker(task)) {
        resolveRecoverableTurnLimitEscalations(task, now)
        if (activeEscalations(task).length > 0) continue
        recoveryStatus = 'ready'
        recoveryAssignee = null
        recoveryNote =
          'User restarted the project after the worker exhausted its turn budget. Reopened the task so Guildhall can continue from the current task state instead of treating the turn limit as terminal.'
      } else if (isRecoverableWorkerTimeoutBlocker(task)) {
        const checkpoint = await readCheckpoint(this.opts.config.memoryDir, task.id).catch(() => null)
        if (!checkpoint?.nextPlannedAction) continue
        resolveRecoverableWorkerTimeoutEscalations(task, now)
        if (activeEscalations(task).length > 0) continue
        recoveryNote =
          'User restarted the project after the worker timed out mid-task. Reopened the task so Guildhall can continue from the latest recovery checkpoint instead of treating the timeout as terminal.'
      } else if (
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
          'Superseded after reviewer availability failures stopped counting as substantive rejection.',
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
        task.notes.push({
          agentId: 'coordinator',
          role: 'recovery',
          content:
            'User restarted the project after reviewer availability failures incorrectly counted as hard rejection. Reopened the task at review so Guildhall can re-run fan-out with the corrected aggregation rules.',
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
      } else if (
        blockReason.includes('Guildhall could not create a task worktree:') &&
        /already exists/i.test(blockReason)
      ) {
        recoveryNote =
          'User restarted the project after Guildhall had already created the task branch. Reopened the task so Guildhall can attach that existing branch to a task worktree and continue.'
      } else {
        continue
      }
      transitionTaskStatus({
        task,
        event: recoveryEventForStatus(recoveryStatus),
        actor: 'orchestrator-recovery',
        evidenceRefs: [`task:recovery:${recoveryStatus}`],
        now,
      })
      task.assignedTo = recoveryAssignee
      task.blockReason = undefined
      task.notes.push({
        agentId: 'coordinator',
        role: recoveryRole,
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
      workspaceProjects: this.opts.config.projects ?? [],
      task,
    })
    if (policy.commit !== 'auto' && !hasIsolatedLandingBranch) return { ok: true }
    const repoRoot =
      typeof task.worktreePath === 'string' && task.worktreePath.trim().length > 0
        ? task.worktreePath.trim()
        : resolveEffectiveTaskProjectPath(task, this.opts.config.projectPath)
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
    for (const task of queue.tasks) {
      if (task.status !== 'done') continue
      if (task.mergeRecord) continue
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
        task.updatedAt = this.now()
        queue.lastUpdated = this.now()
        changed = true
        continue
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

      const effectiveTaskProjectPath = resolveEffectiveTaskProjectPath(
        task,
        this.opts.config.projectPath,
      )
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
      const effectiveTaskProjectPath = resolveEffectiveTaskProjectPath(
        task,
        this.opts.config.projectPath,
      )
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
      changed = true
      await this.maybeCleanupWorktree(task, worktreeMode)
    }
    return { changed }
  }

  /**
   * FR-24: teardown helper. Called on terminal transitions (incl. merge
   * conflict → blocked, max-revisions block). Preserves the worktree for
   * `pending_pr` tasks until the human merges the PR.
   */
  private async maybeCleanupWorktree(
    task: Task,
    mode: WorktreeMode,
  ): Promise<void> {
    const isTerminal =
      task.status === 'done' ||
      task.status === 'shelved'
    const preservingForPr = task.status === 'pending_pr'
    if (!isTerminal && !preservingForPr) return
    const effectiveTaskProjectPath = resolveEffectiveTaskProjectPath(
      task,
      this.opts.config.projectPath,
    )
    try {
      await cleanupWorktreeForTerminal({
        task,
        mode: task.worktreePath?.trim() ? 'per_task' : mode,
        projectPath: effectiveTaskProjectPath,
        gitDriver: this.gitDriver,
        preserveForPendingPr: preservingForPr,
      })
    } catch (err) {
      // Cleanup failures are non-fatal — the tick already succeeded and a
      // stale worktree directory is an annoyance, not a correctness problem.
      console.warn(
        `[guildhall] worktree cleanup failed for ${task.id}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * FR-24: serialize queue-write critical sections across concurrent fanout
   * dispatches. Each call appends `fn` to a tail promise so writes happen
   * strictly in FIFO order. Errors from `fn` propagate to the caller but do
   * not break the chain for subsequent callers.
   */
  private withQueueWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.queueWriteChain
    const current = prev.then(fn, fn)
    this.queueWriteChain = current.then(
      () => undefined,
      () => undefined,
    )
    return current
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
    const raw = await readManagedTextFile(this.tasksPath(), 'utf-8')
    return TaskQueue.parse(JSON.parse(raw))
  }

  private async writeQueue(queue: TaskQueue): Promise<void> {
    this.attachMissingDoneSummaries(queue)
    writeManagedTextFileSync(this.tasksPath(), JSON.stringify(queue, null, 2) + '\n')
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

    const taskDir = getProjectTaskLocalHistoryDir(
      inferProjectRootFromMemoryDir(this.opts.config.memoryDir),
      task.id,
    )
    await fs.mkdir(taskDir, { recursive: true })
    writeManagedTextFileSync(
      path.join(taskDir, 'review-packet.md'),
      await this.renderReviewPacket(task),
    )
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
      '## Changed Files',
      ...changedFiles.summary,
      '',
      '## Changed File Excerpts',
      ...changedFiles.excerpts,
      '',
      '## Visual Evidence',
      ...this.renderVisualEvidence(task),
      '',
      '## Latest Self-Critique',
      ...selfCritique,
      '',
      '## Latest Checkpoint',
      ...this.renderCheckpoint(checkpoint),
      '',
      '## Policy Decision Packet',
      ...this.renderPolicyDecisionPacket(task, checkpoint),
      '',
      '## Commands And Gates',
      ...this.renderGateResults(task),
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

  private renderVisualEvidence(task: Task): string[] {
    const evidenceRefs = collectVisualEvidenceRefs(task)
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

  private async renderChangedFiles(task: Task): Promise<{ summary: string[]; excerpts: string[] }> {
    const rawRepoRoot = task.worktreePath?.trim() || task.projectPath?.trim()
    const repoRoot = rawRepoRoot ? resolveRuntimePath(rawRepoRoot) : ''
    if (!repoRoot) {
      return {
        summary: ['- No task worktree or project path recorded.'],
        excerpts: ['- No file excerpts available.'],
      }
    }

    try {
      const { stdout } = await execFileP('git', ['status', '--short', '--untracked-files=all'], {
        cwd: repoRoot,
        maxBuffer: 1024 * 1024,
      })
      const entries = stdout
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

      if (entries.length === 0) {
        return {
          summary: ['- No changed files recorded.'],
          excerpts: ['- No file excerpts available.'],
        }
      }

      const summary = entries.map((entry) => `- ${entry.status}: ${entry.file}`)
      const excerpts: string[] = []
      for (const entry of entries.slice(0, 3)) {
        const absPath = path.join(repoRoot, entry.file)
        try {
          const raw = await readManagedTextFile(absPath, 'utf-8')
          const numbered = raw
            .split('\n')
            .slice(0, 220)
            .map((line, index) => `${String(index + 1).padStart(4, ' ')} | ${line}`)
            .join('\n')
          excerpts.push(`### ${entry.file}\n\n\`\`\`text\n${numbered}\n\`\`\``)
        } catch {
          excerpts.push(`### ${entry.file}\n\n- Could not read file contents.`)
        }
      }
      if (entries.length > 3) excerpts.push(`- ...and ${entries.length - 3} more changed file(s).`)
      return { summary, excerpts }
    } catch {
      return {
        summary: ['- Could not inspect git status for the task worktree.'],
        excerpts: ['- No file excerpts available.'],
      }
    }
  }

  private latestSelfCritique(task: Task): string[] {
    const note = [...task.notes]
      .reverse()
      .find((candidate) => isWorkerSelfCritiqueNote(candidate))
    if (!note?.content?.trim()) return ['- None recorded.']
    return [note.content.trim()]
  }

  private hasStructuredSelfCritique(task: Task): boolean {
    const note = [...task.notes]
      .reverse()
      .find((candidate) => isWorkerSelfCritiqueNote(candidate))
    const content = note?.content?.trim() ?? ''
    if (!content) return false
    const hasAcceptanceCoverage =
      /for each acceptance criterion:/i.test(content) ||
      /(?:^|\n)\s*-?\s*(?:\[[^\]]+\]|ac-\d+(?:\s*\([^)]+\))?)\s*:\s*(met|not met)\b/i.test(content)
    const hasMinimumScope =
      /(?:^|\n)\s*(?:\*\*)?-?\s*(?:minimum|minimal|mini)-scope check:\s*(?:\*\*)?/i.test(content)
    return hasAcceptanceCoverage && hasMinimumScope
  }

  private hasReviewProofPacket(task: Task): boolean {
    const note = [...task.notes]
      .reverse()
      .find((candidate) => isWorkerSelfCritiqueNote(candidate))
    const content = note?.content?.trim() ?? ''
    if (!content || !this.hasStructuredSelfCritique(task)) return false
    const hasProofPacket =
      /(?:^|\n)\s*(?:#{2,3}\s*)?(?:\*\*)?\s*review proof packet\s*:?\s*(?:\*\*)?/i.test(content)
    const hasVerificationProof =
      /\bverification(?: command| commands| result| results)?\b/i.test(content) &&
      /\b(pass|passed|green|succeed|succeeded)\b/i.test(content)
    const hasDiffScope =
      /\b(?:changed files|files changed|diff scope|scope of changes)\b/i.test(content)
    return hasProofPacket && hasVerificationProof && hasDiffScope
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
    interruption?: 'turn_limit' | 'timeout'
  }): Promise<TickOutcome | null> {
    const queue = await this.readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === input.taskId)
    if (!task) return null

    const hasSpec = typeof task.spec === 'string' && task.spec.trim().length > 0
    const hasBrief =
      !!task.productBrief &&
      typeof task.productBrief.userJob === 'string' &&
      task.productBrief.userJob.trim().length > 0
    const hasOpenQuestion = taskHasUnansweredVisibleQuestion(task)
    const hasWaitingOwnerInput = this.waitingOwnerInputTaskIds(queue).has(task.id)
    const hasDirtyWorktree =
      input.beforeStatus === 'in_progress' &&
      typeof task.worktreePath === 'string' &&
      task.worktreePath.trim().length > 0 &&
      !(await this.gitDriver.isClean(resolveRuntimePath(task.worktreePath)))
    if (
      input.beforeStatus === 'exploring' &&
      task.status === 'exploring' &&
      hasSpec &&
      !hasOpenQuestion &&
      !hasWaitingOwnerInput
    ) {
      task.status = 'spec_review'
      task.updatedAt = this.now()
      queue.lastUpdated = task.updatedAt
      await this.writeQueue(queue)
    }

    const transitioned = task.status !== input.beforeStatus
    const durableExploringProgress =
      input.beforeStatus === 'exploring' && (hasSpec || hasBrief || hasOpenQuestion || hasWaitingOwnerInput)
    const durableWorkerProgress =
      input.beforeStatus === 'in_progress' &&
      task.status === 'in_progress' &&
      hasDirtyWorktree

    if (!transitioned && !durableExploringProgress && !durableWorkerProgress) return null

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

  private async maybeRepairMalformedSpecReviewBlueprint(task: Task): Promise<TickOutcome | null> {
    const canRepair =
      task.status === 'spec_review' ||
      (task.status === 'exploring' && hasLatestBlueprintRevisionRequest(task))
    if (!canRepair) return null
    if (task.id === META_INTAKE_TASK_ID) return null
    if (typeof task.spec !== 'string' || task.spec.trim().length === 0) return null
    const blueprintQuality = validateSpecCompletionBoundary(task)
    if (blueprintQuality.ok) return null

    const now = this.now()
    const queue = await this.readQueue()
    const liveTask = queue.tasks.find((candidate) => candidate.id === task.id)
    if (!liveTask) return null
    const liveCanRepair =
      liveTask.status === 'spec_review' ||
      (liveTask.status === 'exploring' && hasLatestBlueprintRevisionRequest(liveTask))
    if (!liveCanRepair) return null
    if (typeof liveTask.spec !== 'string' || liveTask.spec.trim().length === 0) return null
    const liveQuality = validateSpecCompletionBoundary(liveTask)
    if (liveQuality.ok) return null
    const beforeStatus = liveTask.status

    const answeredDecisions = recoverySpecSeedDecisionTexts(liveTask)
    const sourceIntent = formatRecoverySpecSourceIntent(liveTask.description || liveTask.title)
    const decisionLines = answeredDecisions.length > 0
      ? answeredDecisions.map((decision) => `- ${decision}`).join('\n')
      : '- No unresolved owner decisions are recorded on the task.'
    const outOfScope = answeredDecisions
      .filter((decision) => /\bout of scope|separate|not in scope|do not|don't/i.test(decision))
      .map((decision) => `- ${decision}`)
    const priorSpecSummary = liveTask.spec
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6)
      .join(' ')
    const spec = [
      '## Summary',
      `Build ${liveTask.title} from the current project evidence, preserving the source intent: ${sourceIntent}`,
      '',
      'Prior draft notes:',
      priorSpecSummary ? `- ${priorSpecSummary}` : '- No usable prior draft details were available.',
      '',
      'Resolved owner decisions:',
      decisionLines,
      '',
      '## Acceptance Criteria',
      `1. Given the existing project conventions and source evidence, when ${liveTask.title} is implemented, then the feature appears in the appropriate repo surface without introducing a one-off parallel pattern.`,
      `2. Given the resolved owner decisions above, when the task is reviewed, then the implementation honors each recorded scope choice and leaves explicitly separate work out of this task.`,
      '3. Given the implementation is complete, when the relevant project checks or review proof run, then the commands, screenshots, or manual verification prove the behavior.',
      '',
      '## Out of Scope',
      ...(outOfScope.length > 0 ? outOfScope : ['- Work not implied by the source evidence, prior draft, or resolved owner decisions.']),
      '',
      '## Open Questions',
      '- None known from the current task record. If the coordinator finds a product decision still missing, send this task back to exploring with one focused question.',
      '',
      '## Completion Boundary',
      `- Product outcome: A user can use ${liveTask.title} in the intended project surface.`,
      '- What Guildhall can complete in code: the repo-local component, integration, tests, docs/story evidence, and proof artifacts required by the implementation.',
      '- External dependencies: None known from the current task record.',
      '- Owner-only setup: None known.',
      '- Verification environment: The local project checkout and any existing app/demo/story surface named by the repo.',
      '- What counts as done: The behavior is implemented, reviewed against the resolved scope decisions, and backed by recorded verification.',
      '- What must be split or blocked: Any external setup, missing dependency, or newly discovered product decision that cannot be resolved from current evidence.',
    ].join('\n')

    liveTask.spec = spec
    liveTask.acceptanceCriteria = parseAcceptanceCriteriaFromSpec(spec)
    liveTask.productBrief ??= {
      userJob: `I want ${liveTask.title} turned into concrete project work using the evidence and owner decisions already recorded.`,
      successMetric: `${liveTask.title} has a reviewable spec, acceptance criteria, and a clear completion boundary before implementation starts.`,
      antiPatterns: [
        'Do not preserve stale recovery-loop wording as the task brief.',
        'Do not ask the owner to re-answer decisions already recorded on the task.',
      ],
      authoredBy: 'coordinator-recovery',
      authoredAt: now,
    }
    liveTask.status = 'spec_review'
    liveTask.assignedTo = null
    liveTask.updatedAt = now
    liveTask.notes.push({
      agentId: 'coordinator-recovery',
      role: 'system',
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
        content: 'approve_blueprint: Deterministically repaired spec has a usable completion boundary. Worker may build against it.',
        timestamp: now,
      })
    } else {
      liveTask.notes.push({
        agentId: 'blueprint-sanity-review',
        role: 'blueprint-review',
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

  private async maybeWriteExploringRecoverySpecSeed(task: Task): Promise<TickOutcome | null> {
    if (task.status !== 'exploring') return null
    if (typeof task.spec === 'string' && task.spec.trim().length > 0) return null
    if (taskHasUnansweredVisibleQuestion(task)) return null
    const notes = Array.isArray(task.notes) ? task.notes : []
    const isRecoveryRetry = notes.some((note) =>
      /reframe requested|fresh spec pass|retry.*spec|rebuild the task/i.test(note.content ?? ''),
    )
    if (!isRecoveryRetry) return null

    const now = this.now()
    const queue = await this.readQueue()
    const liveTask = queue.tasks.find((candidate) => candidate.id === task.id)
    if (!liveTask || liveTask.status !== 'exploring') return null
    if (typeof liveTask.spec === 'string' && liveTask.spec.trim().length > 0) return null
    if (taskHasUnansweredVisibleQuestion(liveTask)) return null

    const answeredDecisions = recoverySpecSeedDecisionTexts(liveTask)
    const sourceIntent = formatRecoverySpecSourceIntent(liveTask.description || liveTask.title)
    const decisionLines = answeredDecisions.length > 0
      ? answeredDecisions.map((decision) => `- ${decision}`).join('\n')
      : '- No unresolved owner decisions are recorded on the task.'
    const outOfScope = answeredDecisions
      .filter((decision) => /\bout of scope|separate|not in scope|do not|don't/i.test(decision))
      .map((decision) => `- ${decision}`)
    const spec = [
      '## Summary',
      `Build ${liveTask.title} from the current project evidence, preserving the source intent: ${sourceIntent}`,
      '',
      'Resolved owner decisions:',
      decisionLines,
      '',
      '## Acceptance Criteria',
      `1. Given the existing project conventions and source evidence, when ${liveTask.title} is implemented, then the feature appears in the appropriate repo surface without introducing a one-off parallel pattern.`,
      `2. Given the resolved owner decisions above, when the task is reviewed, then the implementation honors each recorded scope choice and leaves explicitly separate work out of this task.`,
      '3. Given the implementation is complete, when the relevant project checks or review proof run, then Guildhall records the commands, screenshots, or manual verification needed to prove the behavior.',
      '',
      '## Out of Scope',
      ...(outOfScope.length > 0 ? outOfScope : ['- Work not implied by the source evidence or resolved owner decisions.']),
      '',
      '## Open Questions',
      '- None known from the current task record. If the coordinator finds a product decision still missing, send this task back to exploring with one focused question.',
      '',
      '## Completion Boundary',
      `- Product outcome: A user can use ${liveTask.title} in the intended project surface.`,
      '- What Guildhall can complete in code: the repo-local component, integration, tests, docs/story evidence, and proof artifacts required by the implementation.',
      '- External dependencies: None known from the current task record.',
      '- Owner-only setup: None known.',
      '- Verification environment: The local project checkout and any existing app/demo/story surface named by the repo.',
      '- What counts as done: The behavior is implemented, reviewed against the resolved scope decisions, and backed by recorded verification.',
      '- What must be split or blocked: Any external setup, missing dependency, or newly discovered product decision that cannot be resolved from current evidence.',
    ].join('\n')

    liveTask.spec = spec
    liveTask.acceptanceCriteria = parseAcceptanceCriteriaFromSpec(spec)
    liveTask.productBrief = {
      userJob: `I want ${liveTask.title} turned into concrete project work using the evidence and owner decisions already recorded.`,
      successMetric: `${liveTask.title} has a reviewable spec, acceptance criteria, and a clear completion boundary before implementation starts.`,
      antiPatterns: [
        'Do not preserve stale recovery-loop wording as the task brief.',
        'Do not ask the owner to re-answer decisions already recorded on the task.',
      ],
      authoredBy: 'coordinator-recovery',
      authoredAt: now,
    }
    liveTask.status = 'spec_review'
    liveTask.assignedTo = null
    liveTask.updatedAt = now
    liveTask.notes.push({
      agentId: 'coordinator-recovery',
      role: 'system',
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
    const latestSelfCritiqueIndex = findLatestWorkerSelfCritiqueIndex(task)
    if (latestSelfCritiqueIndex < 0) return null
    const latestRejectionIndex = findLatestWorkerSelfCritiqueRejectionIndex(task)
    if (latestRejectionIndex > latestSelfCritiqueIndex) return null
    const likelyTargets = resolveLikelyTaskFiles(task)
    const likelyLocalWebStarter =
      likelyTargets.some((file) => /(?:^|\/)package\.json$/.test(file)) &&
      likelyTargets.some((file) => /(?:^|\/)index\.html$/.test(file))
    const hasCommandBackedAcceptance = task.acceptanceCriteria.some((criterion) =>
      typeof criterion.command === 'string' && criterion.command.trim().length > 0,
    )
    if (!likelyLocalWebStarter && !hasCommandBackedAcceptance) return null
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
    if (dirtyTaskFiles.length > 0) return null

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
        content:
          'Guildhall rejected the stale worker self-critique without project-file changes outside `.guildhall`. Resume implementation by creating or editing the likely target files, then run focused verification before writing another self-critique.',
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
        'Rejected a stale worker self-critique because the project has no implementation-file changes.',
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

    const recentVerifiedWork = Array.isArray(metadata['recent_verified_work'])
      ? (metadata['recent_verified_work'] as unknown[])
          .filter((value): value is string => typeof value === 'string')
      : []
    const hasMeaningfulVerifiedWork = recentVerifiedWork.some((entry) =>
      /^(Ran bash command|Edited file|Wrote file)\b/.test(entry.trim()),
    )

    return evidenceMatchesTask || hasMeaningfulVerifiedWork
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
      resolveEffectiveTaskProjectPath(task, this.opts.config.projectPath),
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
      (task.status !== 'done' && task.status !== 'blocked' && task.status !== 'shelved') ||
      task.assignedTo == null
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
    const staleExploringSpecIds = dispatchCapacity <= 1
      ? queue.tasks
          .filter((task) =>
            task.status === 'exploring' &&
            task.assignedTo === 'spec-agent',
          )
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
      ...(input.output.trim() ? { summary: input.output.trim().slice(0, 1200) } : {}),
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

    const effectiveProjectPath = resolveEffectiveTaskProjectPath(
      input.task,
      this.opts.config.projectPath,
    )
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
    const recentVerifiedWork = Array.isArray(input.metadata?.['recent_verified_work'])
      ? (input.metadata?.['recent_verified_work'] as unknown[])
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : []
    if (recentVerifiedWork.length > 0) {
      reconcileAutomatedAcceptanceCommandsFromVerifiedWork({
        task: input.task,
        workspaceProjectPath: this.opts.config.projectPath,
        recentVerifiedWork,
      })
    }
    const latestSelfCritique = [...input.task.notes]
      .reverse()
      .find((note) => {
        if (!isWorkerSelfCritiqueNote(note, input.agentName)) return false
        const role = typeof note.role === 'string' ? note.role.trim().toLowerCase() : ''
        return note.agentId === input.agentName || role === 'self-critique'
      })?.content
      .trim()
    let verification = checkpointVerificationHistoryFromMetadata(input.metadata)
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

    const result = await writeCheckpoint({
      tasksPath: this.tasksPath(),
      memoryDir: this.opts.config.memoryDir,
      taskId: input.task.id,
      agentId: input.agentName,
      intent: intentParts.join(' '),
      nextPlannedAction: nextAction,
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
        : resolveEffectiveTaskProjectPath(task, this.opts.config.projectPath)
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

  private async persistExploringFallbackProgress(input: {
    taskId: string
    generatedText: string
    openQuestionCountBefore: number
  }): Promise<{
    transcriptAppended: boolean
    fallbackBriefAuthored: boolean
    fallbackQuestionPosted: boolean
  }> {
    const queue = await this.readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === input.taskId)
    if (!task || task.status !== 'exploring') {
      return {
        transcriptAppended: false,
        fallbackBriefAuthored: false,
        fallbackQuestionPosted: false,
      }
    }

    const text = input.generatedText.trim()
    if (!text) {
      return {
        transcriptAppended: false,
        fallbackBriefAuthored: false,
        fallbackQuestionPosted: false,
      }
    }

    const transcriptResult = await ensureExploringTranscriptEntry({
      memoryDir: this.opts.config.memoryDir,
      taskId: task.id,
      role: 'spec-agent',
      content: text,
    })
    const transcriptAppended = transcriptResult.appended === true
    let fallbackBriefAuthored = false
    let fallbackQuestionPosted = false

    if (!task.productBrief) {
      const inferredBrief = inferFallbackBriefFromPlaintext(text, task.title)
      if (inferredBrief) {
        const now = this.now()
        task.productBrief = {
          userJob: inferredBrief.userJob,
          successMetric: inferredBrief.successMetric,
          antiPatterns: inferredBrief.antiPatterns,
          authoredBy: 'spec-agent',
          authoredAt: now,
        }
        task.updatedAt = now
        queue.lastUpdated = now
        fallbackBriefAuthored = true
      }
    }

    if (task.id === WORKSPACE_IMPORT_TASK_ID) {
      if (fallbackBriefAuthored) {
        await this.writeQueue(queue)
      }
      return {
        transcriptAppended,
        fallbackBriefAuthored,
        fallbackQuestionPosted: false,
      }
    }

    const openQuestionCountAfter = task.openQuestions?.length ?? 0
    const drafts = inferFallbackQuestionsFromPlaintext(text)
    const existingQuestionPrompts = new Set(
      ((task.openQuestions ?? []) as Array<Record<string, unknown>>)
        .map((question) => {
          const prompt = question['prompt']
          if (typeof prompt === 'string' && prompt.trim()) {
            return normalizeFallbackQuestionPrompt(prompt)
          }
          const restatement = question['restatement']
          return typeof restatement === 'string' && restatement.trim()
            ? normalizeFallbackQuestionPrompt(restatement)
            : ''
        })
        .filter(Boolean),
    )
    const missingDrafts = drafts.filter(
      (draft) => !existingQuestionPrompts.has(normalizeFallbackQuestionPrompt(draft.prompt)),
    )
    if (
      task.status === 'exploring' &&
      (
        (openQuestionCountAfter === input.openQuestionCountBefore && drafts.length > 0) ||
        missingDrafts.length > 0 ||
        (openQuestionCountAfter === input.openQuestionCountBefore && looksLikePlaintextUserQuestion(text))
      )
    ) {
      const now = this.now()
      const questionDrafts = missingDrafts.length > 0 ? missingDrafts : drafts
      const questionStamp = Date.now().toString(36)
      const questionRecords = questionDrafts.map((draft, index) => {
        const questionId = `q-fallback-${task.id}-${questionStamp}-${index}`
        return draft.kind === 'choice'
          ? {
              kind: 'choice' as const,
              id: questionId,
              askedBy: 'spec-agent',
              askedAt: now,
              prompt: draft.prompt,
              ...(draft.subject ? { subject: draft.subject } : {}),
              ...(draft.description ? { description: draft.description } : {}),
              choices: draft.choices,
              ...(draft.selectionMode ? { selectionMode: draft.selectionMode } : {}),
            }
          : {
              kind: 'text' as const,
              id: questionId,
              askedBy: 'spec-agent',
              askedAt: now,
              prompt: draft.prompt,
              ...(draft.subject ? { subject: draft.subject } : {}),
              ...(draft.description ? { description: draft.description } : {}),
            }
      })
      for (const question of questionRecords) {
        await createOwnerInputRequest({
          projectRoot: this.opts.config.projectPath,
          projectId: this.opts.config.workspaceId,
          commandId: `orchestrator:fallback-question:${task.id}:${question.id}`,
          now,
          actor: 'spec-agent',
          source: { kind: 'task', taskId: task.id, questionId: question.id },
          target: { kind: 'thread' },
          question: {
            kind: question.kind,
            prompt: question.prompt,
            ...(question.kind === 'choice' ? { choices: question.choices } : {}),
            ...(question.description ? { description: question.description } : {}),
          },
          objective: {
            kind: 'task_shaping',
            label: `Clarify ${task.title}`,
            successCriteria: ['Owner answers the linked bounded-chat session.'],
          },
          sessionSource: `orchestrator:fallback-question:${task.id}:${question.id}`,
        })
      }
      task.openQuestions = [
        ...(task.openQuestions ?? []),
        ...questionRecords,
      ]
      task.updatedAt = now
      queue.lastUpdated = now
      fallbackQuestionPosted = true
    }

    if (fallbackBriefAuthored || fallbackQuestionPosted) {
      await this.writeQueue(queue)
    }

    return {
      transcriptAppended,
      fallbackBriefAuthored,
      fallbackQuestionPosted,
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
            path: '.guildhall/PROGRESS.md',
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
  const epochPath = path.join(config.memoryDir, '.session-epoch')
  try {
    const existing = (await readManagedTextFile(epochPath, 'utf8')).trim()
    if (existing) return existing
  } catch {
    /* create below */
  }
  const epoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  await fs.mkdir(config.memoryDir, { recursive: true })
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
    const raw = readManagedTextFileSync(path.join(config.memoryDir, 'TASKS.json'), 'utf8')
    resumeQueue = TaskQueue.parse(JSON.parse(raw))
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
      )
      const expectedSuccessGates =
        resumableTask.status === 'gate_check'
          ? resolveEffectiveTaskSuccessGates({
              task: resumableTask,
              workspaceProjectPath: config.projectPath,
              ...(config.bootstrap ? { workspaceBootstrap: config.bootstrap } : {}),
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

/**
 * Parse the worker's latest note for a structured `## Handoff note` section
 * (case-insensitive header). Falls back to the entire note text when no
 * explicit section is present — always better to preserve the worker's
 * intent than to silently drop it.
 */
function extractHandoffNote(task: Task): string {
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
      const content = n.content ?? ''
      const match = content.match(
        /^\s*##\s+Handoff note\s*\n([\s\S]*?)(?:\n##\s|\n?$)/im,
      )
      if (match) return match[1]!.trim()
      return content.trim()
    }
  }
  return ''
}

/**
 * Rebuild prior fan-out rounds from the flat `task.reviewVerdicts` trail.
 * Verdicts recorded within the same ISO second are treated as one round
 * (the fan-out persists every persona's verdict with the same `recordedAt`).
 * The most-recent round is placed last in the returned list so
 * `findRecurrentDissent` can compare against `priorRounds.at(-1)`.
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
    // Fan-out tags failingSignals[0] with the persona slug on revise;
    // approves leave failingSignals empty. Fall back to parsing the slug
    // out of the reason prefix ("<guildName> approved/requested revision").
    const slug =
      v.failingSignals[0] ?? guessSlugFromReason(v.reason) ?? 'unknown'
    current.push({
      guildSlug: slug,
      guildName: slug,
      verdict: v.verdict,
      reasoning: v.reasoning ?? v.reason,
      // `revisionItems` aren't persisted verbatim on ReviewVerdict — the
      // dissent text lives in `reasoning`. The detector does token-set
      // overlap on the whole string, so passing `[reasoning]` is equivalent
      // to the empty-items case for this purpose.
      revisionItems: v.verdict === 'revise' ? [v.reasoning ?? v.reason] : [],
      rawOutput: v.reasoning ?? v.reason,
    })
  }
  if (current.length > 0) rounds.push(current)
  return rounds
}

function guessSlugFromReason(reason: string): string | null {
  // Fan-out writes "The <Persona Name> approved/requested revision" into
  // reason. Slugify the persona name section. This is advisory — callers
  // that need strict attribution should use failingSignals[0].
  const m = /^The\s+([A-Z][A-Za-z ]+?)\s+(approved|requested revision)/.exec(
    reason,
  )
  if (!m) return null
  return m[1]!.toLowerCase().replace(/\s+/g, '-')
}

function countReviewerNotes(task: Task): number {
  return task.notes.filter(
    (note) => note.agentId === 'reviewer-agent' || note.role === 'reviewer',
  ).length
}

function isWorkerSelfCritiqueNote(
  note: Pick<Task['notes'][number], 'agentId' | 'role' | 'content'>,
  expectedAgentId = 'worker-agent',
): boolean {
  const role = typeof note.role === 'string' ? note.role.trim().toLowerCase() : ''
  const agentId = typeof note.agentId === 'string' ? note.agentId.trim().toLowerCase() : ''
  const content = typeof note.content === 'string' ? note.content : ''
  if (content.trim().length === 0 || !/self-critique/i.test(content)) return false
  if (role === 'self-critique') return true
  if (agentId === expectedAgentId.toLowerCase()) return true
  return role === 'implementation' || role === 'implementer' || role === 'worker'
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
      /self-critique without project-file changes/i.test(note.content)
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
  const hasSelfCritique = [...task.notes].reverse().some((note) =>
    isWorkerSelfCritiqueNote(note),
  )
  const hasRecordedVerificationFailure = checkpointHasRecordedVerificationFailure(
    typeof checkpoint === 'string' ? undefined : checkpoint?.resumeContext?.verification,
  )
  if (
    hasSelfCritique &&
    /write or refresh self-critique note|write or refresh the self-critique note/i.test(trimmed)
  ) {
    return 'Resume from the latest self-critique and recorded verification evidence, then hand off to review.'
  }
  if (
    !hasSelfCritique &&
    /write or refresh self-critique note|write or refresh the self-critique note/i.test(trimmed) &&
    /hand off to review|handoff to review|transition to review/i.test(trimmed)
  ) {
    return 'Resume from the active worktree diff, rerun the focused verification commands, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.'
  }
  if (
    hasRecordedVerificationFailure &&
    /resume from the active worktree diff/i.test(trimmed) &&
    /refresh focused verification/i.test(trimmed)
  ) {
    return 'Resume from the recorded verification evidence, rerun the focused verification commands, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.'
  }
  return trimmed
}

function checkpointHasRecordedVerificationFailure(
  verification: Array<{ passed: boolean }> | undefined,
): boolean {
  return Array.isArray(verification) && verification.some((entry) => entry?.passed === false)
}

function looksLikeReviewHandoffNextAction(nextAction: string): boolean {
  const normalized = nextAction.trim().toLowerCase()
  if (!normalized) return false
  return (
    normalized.includes('hand off to review') ||
    normalized.includes('hand off for review') ||
    normalized.includes('handoff to review') ||
    normalized.includes('handoff for review') ||
    normalized.includes('transition to review') ||
    normalized.includes('move to review') ||
    normalized.includes('reviewers evaluate')
  )
}

function latestHardGateResults(task: Task): Array<NonNullable<Task['gateResults']>[number]> {
  const latestById = new Map<string, NonNullable<Task['gateResults']>[number]>()
  for (const gate of task.gateResults) {
    if (gate.type !== 'hard') continue
    latestById.set(gate.gateId, gate)
  }
  return [...latestById.values()]
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

function isProceduralOnlyFanoutDissent(dissenting: readonly PersonaVerdict[]): boolean {
  if (dissenting.length === 0) return false
  return dissenting.every((verdict) => {
    const text = [
      verdict.reasoning,
      verdict.rawOutput,
      ...verdict.revisionItems,
      ...(verdict.riskItems ?? []),
    ].join('\n')
    const saysAccepted =
      /\bmeets all acceptance criteria\b/i.test(text) ||
      /\bsatisfies all functional ACs\b/i.test(text) ||
      /\bmeets all functional ACs\b/i.test(text) ||
      /\bmeets functional ACs\b/i.test(text) ||
      /\bimplementation meets functional ACs\b/i.test(text) ||
      /\bmeets all acceptance criteria and scope\b/i.test(text) ||
      /risk if accepted as-is:\s*-\s*\(none\)/i.test(text)
    const asksOnlyForProcess =
      /\bcheckpoint\b/i.test(text) ||
      /\baudit trail\b/i.test(text) ||
      /\bmeasurement plan\b/i.test(text) ||
      /\bCore Web Vitals\b/i.test(text) ||
      /\bLCP\b/i.test(text) ||
      /\bINP\b/i.test(text) ||
      /\bLighthouse\b/i.test(text) ||
      /\bcrash[- ]recovery\b/i.test(text)
    return saysAccepted && asksOnlyForProcess
  })
}

function sortedDissenterSlugs(dissenting: readonly PersonaVerdict[]): string[] {
  return [...new Set(dissenting.map((verdict) => verdict.guildSlug).filter(Boolean))].sort()
}

function sameDissenterSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((slug, index) => slug === right[index])
}

function hasOverlappingPriorDissent(
  dissenting: readonly PersonaVerdict[],
  priorRounds: readonly (readonly PersonaVerdict[])[],
): boolean {
  const current = new Set(sortedDissenterSlugs(dissenting))
  if (current.size === 0) return false
  return priorRounds.some((round) =>
    round.some((verdict) =>
      verdict.verdict === 'revise' && current.has(verdict.guildSlug),
    ),
  )
}

function hasPriorAdjudicationForDissent(
  task: Task,
  dissenting: readonly PersonaVerdict[],
): boolean {
  const current = sortedDissenterSlugs(dissenting)
  if (current.length === 0) return false
  return (task.adjudications ?? []).some((record) =>
    record.decidedBy === 'coordinator' &&
    sameDissenterSet(sortedDissenterSlugsFromRecord(record.dissenters), current),
  )
}

function sortedDissenterSlugsFromRecord(dissenters: readonly string[]): string[] {
  return [...new Set(dissenters.filter(Boolean))].sort()
}

function resolvedScopeDecisionTexts(task: Task): string[] {
  return task.escalations
    .filter((escalation) => escalation.resolvedAt && escalation.resolution?.trim())
    .map((escalation) => [escalation.summary, escalation.details ?? '', escalation.resolution ?? ''].join('\n'))
}

function answeredQuestionDecisionTexts(task: Task): string[] {
  const questionDecisions = (task.openQuestions ?? [])
    .filter((question) => question.answeredAt && typeof question.answer === 'string' && question.answer.trim())
    .filter((question) => {
      const prompt = 'prompt' in question && typeof question.prompt === 'string' ? question.prompt.trim() : ''
      return !isQuestionListPrompt(prompt) && !isOperationalFallbackPrompt(prompt)
    })
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
    if (isQuestionListPrompt(prompt) || isOperationalFallbackPrompt(prompt)) continue
    if (answer.length >= 24 || /[.!?]$/.test(answer)) out.push(answer)
    else out.push(prompt ? `${prompt.replace(/\?$/, '')}: ${answer}` : answer)
  }
  return out
}

function formatRecoverySpecSourceIntent(source: string | undefined): string {
  const raw = normalizeFallbackWhitespace(source ?? '')
  if (!raw) return 'the task title'

  const markdownSource = raw.match(/^([^:\n]+):\s*(?:[-*]\s*)?(?:\*\*)?(.+?)(?:\*\*)?$/)
  if (markdownSource) {
    const sourcePath = markdownSource[1]?.trim()
    const label = markdownSource[2]
      ?.replace(/\*\*/g, '')
      .replace(/`/g, '')
      .trim()
    if (sourcePath && label) return `${label} from ${sourcePath}`
  }

  return raw
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/:\s*[-*]\s*/g, ': ')
    .trim()
}

function recoverySpecSeedDecisionTexts(task: Task): string[] {
  const durableEscalationDecisions = resolvedScopeDecisionTexts(task)
    .filter((decision) => !/superseded by a task (?:reframe|enrichment) request/i.test(decision))
    .filter((decision) => !/build failing due to unresolved import|required source directories not found/i.test(decision))
  return uniqueNonEmptyStrings([
    ...answeredQuestionDecisionTexts(task),
    ...durableEscalationDecisions,
  ])
}

function reconcileAcceptanceCriteriaFromLatestWorkerSelfCritique(task: Task): void {
  if (task.acceptanceCriteria.length === 0) {
    const derivedCriteria = parseAcceptanceCriteriaFromSpec(task.spec)
    if (derivedCriteria.length > 0) task.acceptanceCriteria = derivedCriteria
  }
  if (!Array.isArray(task.acceptanceCriteria) || task.acceptanceCriteria.length === 0) return
  const latestWorkerNote = [...task.notes]
    .reverse()
    .find((note) => isWorkerSelfCritiqueNote(note))
  if (!latestWorkerNote) return

  const criteriaById = new Map<string, Task['acceptanceCriteria'][number]>()
  for (const criterion of task.acceptanceCriteria) {
    criteriaById.set(criterion.id.toLowerCase(), criterion)
    criteriaById.set(normalizeAcceptanceCriterionId(criterion.id), criterion)
  }
  let positionalIndex = 0
  for (const rawLine of latestWorkerNote.content.split('\n')) {
    const line = rawLine.trim()
    if (!/^(?:[-*]|\d+[.)])\s+/.test(line)) continue

    const explicitIdMatch = /\b(ac[-_][a-z0-9_-]+|AC\d+)\b/i.exec(line)
    const stateMatch = /\b(Not met|Met)\b/i.exec(line)
    if (!stateMatch) continue
    const met = !/^not met$/i.test(stateMatch[1]!)

    if (explicitIdMatch) {
      const criterion =
        criteriaById.get(explicitIdMatch[1]!.toLowerCase()) ??
        criteriaById.get(normalizeAcceptanceCriterionId(explicitIdMatch[1]!))
      if (criterion) criterion.met = met
      continue
    }

    const criterion = task.acceptanceCriteria[positionalIndex]
    positionalIndex += 1
    if (criterion) criterion.met = met
  }
}

function normalizeAcceptanceCriterionId(value: string): string {
  const match = /^ac[-_ ]*0*([0-9]+)$/i.exec(value.trim())
  if (match) return `ac${match[1]}`
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isInfrastructureLikeReviewerError(text: string | undefined): boolean {
  if (!text) return false
  return /HTTP 429|Too Many Requests|rate limit|engine_overloaded|Model busy, retry later|provider timeout|connection refused|Exceeded maximum turn limit \(\d+\)|temporarily unavailable|service unavailable|timed out after \d+ms|exceeded \d+ms total turn budget/i.test(text)
}

function isRetryableProviderCapacityError(text: string | undefined): boolean {
  if (!text) return false
  return /HTTP 429|Too Many Requests|rate limit|engine_overloaded|Model busy, retry later/i.test(text)
}

function shouldAdvanceInfraFallbackToGateCheck(
  task: Task,
  verdict: DeterministicVerdict,
  llmError: string | undefined,
): boolean {
  if (!isInfrastructureLikeReviewerError(llmError)) return false
  if (verdict.verdict !== 'revise') return false
  return (
    shouldAdvanceToGateCheckPendingAutomatedVerification(task) ||
    shouldAdvanceToGateCheckPendingHardGates(task, verdict.failingSignals) ||
    workerSelfCritiqueMarksAcceptanceCriteriaMetBeforeHardGates(task)
  )
}

function workerSelfCritiqueMarksAcceptanceCriteriaMetBeforeHardGates(task: Task): boolean {
  if (task.gateResults.some((gate) => gate.type === 'hard')) return false
  if (task.acceptanceCriteria.length === 0) return false
  const latestWorkerNote = [...task.notes]
    .reverse()
    .find((note) => isWorkerSelfCritiqueNote(note))
  if (!latestWorkerNote) return false

  const statedCriterionResults = latestWorkerNote.content
    .split('\n')
    .map((rawLine) => rawLine.trim())
    .filter((line) => /^(?:[-*]|\d+[.)])\s+/.test(line))
    .map((line) => /\b(Not met|Met)\b/i.exec(line)?.[1]?.toLowerCase())
    .filter((state): state is string => Boolean(state))

  return (
    statedCriterionResults.length >= task.acceptanceCriteria.length &&
    statedCriterionResults.every((state) => state === 'met')
  )
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

function isInfrastructureOnlyFanoutFailure(verdict: PersonaVerdict): boolean {
  if (verdict.verdict !== 'revise') return false
  const text = `${verdict.reasoning}\n${verdict.rawOutput}`
  if (/no \*\*Reasoning:\*\* block found/i.test(text)) return true
  if (!/failed to produce a verdict|no \*\*Reasoning:\*\* block found/i.test(text)) return false
  return isInfrastructureLikeReviewerError(text)
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
  return async ({ task, personas, reviewPlan, builtContext, context, projectPath }) => {
    const { parsePersonaOutput, buildPersonaOutputHints } = await import('./reviewer-fanout.js')
    const personaOutputHints = buildPersonaOutputHints(task)

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
        const result = await Promise.race([
          agent.generateWithEvents(prompt, undefined, { signal: controller.signal }),
          timeout,
        ])
        return parsePersonaOutput(persona, result.text, personaOutputHints)
      } catch (err) {
        return parsePersonaOutput(
          persona,
          `**Verdict:** revise\n**Reasoning:** ${persona.name} failed to produce a verdict (${err instanceof Error ? err.message : String(err)}). Treating as revise per strict-all policy.`,
          personaOutputHints,
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
