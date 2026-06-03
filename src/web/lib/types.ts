/**
 * Shared types for the Svelte dashboard surfaces. These mirror the shape of
 * the JSON payloads served by Hono (src/runtime/serve.ts) — we deliberately
 * keep them permissive (`unknown`/optional) because the server contract is
 * gradual and the UI must not crash on missing fields.
 */

export interface Escalation {
  id?: string
  reason?: string
  summary?: string
  details?: string
  agentId?: string
  externalChecklist?: ExternalBlockerStep[]
  resolvedAt?: string | null
}

export interface ExternalBlockerStep {
  id?: string
  title?: string
  detail?: string
  owner?: 'user' | 'guildhall' | 'external' | string
  status?: 'todo' | 'done' | 'blocked' | string
}

export interface ProductBrief {
  userJob?: string
  whyItMattersNow?: string
  successMetric?: string
  successCriteria?: string
  nonGoals?: string[]
  audience?: string
  usageContext?: string
  antiPatterns?: string[]
  rolloutPlan?: string
  brandInteractionNotes?: string
  approvedBy?: string | null
  approvedAt?: string | null
  authoredBy?: string
}

export interface StructuredSpecCompletionBoundary {
  productOutcome?: string
  whatGuildhallCanCompleteInCode?: string
  externalDependencies?: string
  ownerOnlySetup?: string
  verificationEnvironment?: string
  whatCountsAsDone?: string
  whatMustBeSplitOrBlocked?: string
}

export interface StructuredSpec {
  whatThisIs?: string
  problemContext?: string
  goals?: string[]
  nonGoals?: string[]
  proposedDesign?: string
  keyDecisions?: string[]
  acceptanceCriteria?: string[]
  verification?: string[]
  completionBoundary?: StructuredSpecCompletionBoundary
  userFacingBehavior?: string
  visualInteractionNotes?: string
  componentApiShape?: string
  dataModelSchemaChanges?: string
  migrationRollout?: string
  performanceReliabilitySecurity?: string
  risksOpenQuestions?: string[]
  handoffSequence?: string[]
}

/**
 * Agent → user question. Mirrors `AgentQuestion` in src/core/task.ts.
 * Producers MUST classify any prompt to the user into one of these kinds —
 * no free-prose questions. The UI renders each kind with a fixed deterministic
 * affordance (see web/lib/AgentQuestion.svelte).
 */
type AgentQuestionBase = {
  id: string
  askedBy: string
  askedAt: string
  subject?: string
  description?: string
  draftAnswer?: string
  answeredAt?: string
  answer?: string
}

export type AgentQuestion =
  | (AgentQuestionBase & { kind: 'confirm'; restatement: string })
  | (AgentQuestionBase & { kind: 'yesno'; prompt: string })
  | (AgentQuestionBase & { kind: 'choice'; prompt: string; choices: string[]; selectionMode?: 'single' | 'multiple' | undefined })
  | (AgentQuestionBase & { kind: 'text'; prompt: string })

export interface AcceptanceCriterion {
  description?: string
  text?: string
  [key: string]: unknown
}

export interface GateResult {
  gateId?: string
  type?: string
  passed?: boolean
  checkedAt?: string
  output?: string
}

export interface ReviewVerdict {
  verdict?: 'approve' | 'revise'
  reviewerPath?: 'llm' | 'deterministic' | string
  reason?: string
  reasoning?: string
  failingSignals?: string[]
  recordedAt?: string
  policyVersion?: string
  llmError?: string
}

export interface ReviewRecipeRef {
  recipeId?: string
  version?: string
  lanes?: string[]
  blocking?: 'none' | 'medium' | 'high' | 'strict' | string
  required?: boolean
  calibrationRecipeIds?: string[]
}

export interface ReviewPlan {
  taskId?: string
  effort?: 'lean' | 'balanced' | 'thorough' | 'release_critical' | 'custom' | string
  depth?: 'minimal' | 'standard' | 'targeted' | 'deep' | 'release_critical' | string
  selectedLanes?: string[]
  skippedLanes?: Array<{ lane?: string; reason?: string }>
  requiredRecipes?: ReviewRecipeRef[]
  deterministicChecks?: string[]
  requiredArtifacts?: string[]
  budget?: {
    maxReviewerAgents?: number
    maxEstimatedTokens?: number
    maxWallClockMinutes?: number
    maxRevisionLoops?: number
  }
  aggregation?: Record<string, 'advisory' | 'blocking_on_high' | 'strict' | string>
  reasons?: string[]
  createdAt?: string
  createdBy?: string
}

export interface ReviewAuditSummary {
  reviewerRunCount?: number
  reviseCount?: number
  escapedMissCount?: number
  latestReviewerRunAt?: string
}

export interface TaskSizePlan {
  taskId?: string
  score?: 1 | 2 | 3 | 5 | 8 | number
  band?: 'tiny' | 'small' | 'medium' | 'large' | 'epic' | string
  action?: 'proceed' | 'proceed_with_warning' | 'split_recommended' | 'split_required' | 'ask_clarifying_question' | string
  factors?: Array<{ id?: string; label?: string; weight?: number; reason?: string }>
  recommendedChildren?: Array<{
    title?: string
    reason?: string
    dependsOn?: string[]
    suggestedDomain?: string
    createdTaskId?: string
  }>
  reviewBudgetHint?: string
  reasons?: string[]
  createdAt?: string
  createdBy?: string
}

export interface RequestIntake {
  intent?: 'spec_only' | 'implementation' | 'ambiguous_spec_or_implementation' | 'question_or_research' | string
  recommendedNextAction?: 'ask_clarifying_question' | 'draft_spec' | 'create_linked_feature_plan' | 'proceed_to_implementation_spec' | string
  ambiguity?: string
  componentStack?: Array<{ kind?: string; title?: string; role?: string }>
  pressureTestSummary?: {
    systemOwned?: boolean
    degree?: 'automatic' | 'guided' | 'deep' | string
    qualityBar?: string
    ownerQuestionPolicy?: string
    checks?: Array<{ id?: string; title?: string; status?: string; reason?: string }>
  }
  clarifyingQuestions?: string[]
  createdAt?: string
  createdBy?: string
}

export interface DoneTaskSummaryBundle {
  taskId?: string
  status?: string
  completedAt?: string
  summary?: {
    journey?: string
    decision?: string
    evidence?: string
    learningCandidates?: string[]
    openResidue?: string
  }
  retention?: {
    transcriptPrimaryArtifact?: boolean
    compactedFullTranscript?: boolean
    fullEvidenceAvailable?: boolean
  }
  evidenceRefs?: Array<{ scope?: string; collection?: string; id?: string; path?: string; hash?: string; contentType?: string }>
  createdAt?: string
  createdBy?: string
}

export type LaunchStep =
  | {
      id?: string
      kind?: 'copy_command' | string
      title?: string
      command?: string
      cwd?: string
      expectedOutcome?: string
    }
  | {
      id?: string
      kind?: 'open_url' | string
      title?: string
      url?: string
      expectedOutcome?: string
    }
  | {
      id?: string
      kind?: 'manual_step' | string
      title?: string
      instructions?: string
      expectedOutcome?: string
    }
  | {
      id?: string
      kind?: 'external_dashboard' | string
      title?: string
      service?: string
      url?: string
      instructions?: string
      expectedOutcome?: string
    }
  | {
      id?: string
      kind?: 'blocked_until_setup' | string
      title?: string
      setupRequirement?: string
      ownerAction?: string
      expectedOutcome?: string
    }

export interface ExpectedEvidence {
  id?: string
  kind?: 'automated' | 'manual' | 'browser' | 'provider' | 'artifact' | 'external' | string
  description?: string
  required?: boolean
  sourceRef?: string
}

export interface VerificationRecord {
  id?: string
  evidenceId?: string
  kind?: 'automated' | 'manual' | 'browser' | 'provider' | 'artifact' | 'external' | string
  status?: 'passed' | 'failed' | 'blocked' | 'not_run' | string
  summary?: string
  command?: string
  url?: string
  recordedAt?: string
  recordedBy?: string
}

export interface ProofPath {
  id?: string
  scope?: { type?: 'task' | 'project' | string; id?: string }
  title?: string
  summary?: string
  status?: 'planned' | 'in_progress' | 'verified' | 'blocked' | 'stale' | string
  launchSteps?: LaunchStep[]
  expectedEvidence?: ExpectedEvidence[]
  verificationRecords?: VerificationRecord[]
  notes?: string
  relatedTaskIds?: string[]
  createdAt?: string
  updatedAt?: string
  createdBy?: string
  updatedBy?: string
}

export interface CompletionHandoff {
  id?: string
  taskId?: string
  completedAt?: string
  completedBy?: string
  summary?: string
  proofPathIds?: string[]
  verificationSummary?: string
  automatedProof?: VerificationRecord[]
  manualProof?: VerificationRecord[]
  providerProof?: VerificationRecord[]
  residualRisk?: string
  followUpTaskIds?: string[]
}

export interface TaskNote {
  role?: string
  agentId?: string
  timestamp?: string
  content?: string
}

export interface ShelveReason {
  code?: string
  rejectedBy?: string
  rejectedAt?: string
  detail?: string
}

export type GitStoryClosureState =
  | 'clean'
  | 'dirty_uncommitted'
  | 'committed_local'
  | 'no_upstream'
  | 'pushed'
  | 'pr_open'
  | 'merged'
  | 'local_only'
  | 'deferred'
  | 'conflict'
  | 'unknown'

export interface GitStorySnapshot {
  state?: GitStoryClosureState
  repoRoot?: string
  inspectedPath?: string
  branch?: string
  upstream?: string
  ahead?: number
  behind?: number
  changedCount?: number
  untrackedCount?: number
  samplePaths?: string[]
  localCommits?: Array<{ sha?: string; subject?: string }>
  pr?: { url?: string; state?: string; mergeStateStatus?: string }
  taskId?: string
  taskTitle?: string
  worktreePath?: string
  mergeRecordResult?: string
  overrideReason?: string
  reason?: string
  nextAction?: string
  inspectedAt?: string
}

export interface GitStoryBlocker {
  id?: string
  label?: string
  state?: GitStoryClosureState
  reason?: string
  nextAction?: string
  taskId?: string
}

export interface GitStorySummary {
  ready?: boolean
  state?: GitStoryClosureState
  blockers?: GitStoryBlocker[]
  snapshots?: GitStorySnapshot[]
}

export interface Task {
  id: string
  title?: string
  description?: string
  status?: string
  domain?: string
  priority?: string
  assignedTo?: string | null
  revisionCount?: number
  remediationAttempts?: number
  blockReason?: string
  hold?: {
    previousStatus?: string
    reason?: string
    heldAt?: string
    heldBy?: string
  }
  shelveReason?: ShelveReason
  productBrief?: ProductBrief
  openQuestions?: AgentQuestion[]
  spec?: string
  structuredSpec?: StructuredSpec
  acceptanceCriteria?: AcceptanceCriterion[]
  gateResults?: GateResult[]
  reviewVerdicts?: ReviewVerdict[]
  reviewPlan?: ReviewPlan
  reviewAuditSummary?: ReviewAuditSummary
  escalations?: Escalation[]
  notes?: TaskNote[]
  latestReviewerSummary?: string
  latestSelfCritique?: string
  sizePlan?: TaskSizePlan
  requestIntake?: RequestIntake
  doneSummaryBundle?: DoneTaskSummaryBundle
  proofPaths?: ProofPath[]
  completionHandoff?: CompletionHandoff
  latestCheckpoint?: {
    step?: number
    agentId?: string
    intent?: string
    nextPlannedAction?: string
    filesTouched?: string[]
    writtenAt?: string
  }
  worktreePath?: string
  branchName?: string
  baseBranch?: string
  mergeRecord?: {
    fromBranch?: string
    toBranch?: string
    strategy?:
      | 'cherry_pick_local'
      | 'cherry_pick_with_push'
      | 'manual_pr'
      | 'ff_only_local'
      | 'ff_only_with_push'
      | string
    result?:
      | 'merged'
      | 'pushed'
      | 'push_failed_degraded'
      | 'pending_pr'
      | 'conflict'
      | 'skipped'
      | string
    commitSha?: string
    prUrl?: string
    mergedAt?: string
    detail?: string
  }
  terminalSummary?: {
    headline?: string
    detail?: string
  }
  gitStory?: GitStorySnapshot
  origination?: string
  proposedBy?: string
  proposalRationale?: string
  workKind?:
    | 'app_spec'
    | 'feature_spec'
    | 'implementation'
    | 'setup'
    | 'verification'
    | 'release'
    | 'research'
    | 'decision'
    | 'cleanup'
    | 'learning'
    | string
  hierarchy?: {
    parentId?: string
    childIds?: string[]
    order?: number
    depth?: number
    path?: string[]
  }
  businessEnvelope?: {
    goalId?: string
  }
  completionBoundary?: {
    summary?: string
    requiredChildPolicy?: 'all_required_done' | 'selected_children_done' | 'manual_handoff' | string
    requiredChildIds?: string[]
    proofPathRequired?: boolean
    handoffRequired?: boolean
    deferAllowed?: boolean
  }
  taskKind?: 'implementation' | 'research' | 'decision' | 'spike' | 'cleanup' | 'verification' | 'release' | 'learning' | string
  taskReadiness?: Record<string, unknown>
  definitionOfDone?: { items?: string[]; evidenceRequired?: string[]; updatedAt?: string; createdBy?: string }
  blockerPlans?: Array<{ if?: string; then?: string; owner?: string; reason?: string }>
  contextBudget?: { estimatedTokens?: number; risk?: string; fitsInOneWorkerBrief?: boolean; reasons?: string[] }
  decomposition?: Record<string, unknown>
  coordinatorReflections?: Array<Record<string, unknown>>
  createdAt?: string
  updatedAt?: string
  completedAt?: string
  runtime?: {
    openEscalationIds?: string[]
    openIssueIds?: string[]
    assignedTo?: string | null
    updatedAt?: string
  }
  permissionMode?: string
  dependsOn?: string[]
}

export interface ContextSectionStat {
  key?: string
  label?: string
  chars?: number
  included?: boolean
}

export interface ContextHealthWarning {
  code?: string
  severity?: 'info' | 'warn' | 'error' | string
  message?: string
}

export interface ContextDebugRecord {
  id?: string
  at?: string
  taskId?: string
  taskTitle?: string
  taskStatus?: string
  domain?: string
  agentName?: string
  agentRole?: string
  modelId?: string
  workspacePath?: string
  taskProjectPath?: string
  activeWorktreePath?: string
  promptChars?: number
  contextChars?: number
  promptPreview?: string
  snapshotPath?: string
  sections?: ContextSectionStat[]
  health?: ContextHealthWarning[]
  reasons?: string[]
  applicableGuildSlugs?: string[]
  reviewerSlugs?: string[]
  primaryEngineerSlug?: string | null
  openQuestionCount?: number
  acceptanceCriteriaCount?: number
  memoryPacket?: {
    included?: Array<{ id?: string; type?: string; scope?: string }>
    withheld?: Array<{ id?: string; reason?: string }>
    evidenceRefs?: number
  }
}

export interface DrawerPayload {
  task: Task
  runStatus?: string
  recentEvents?: unknown[]
  contextDebug?: ContextDebugRecord[]
  threadTurns?: TaskThreadTurn[]
  exploringTranscript?: {
    content: string | null
    path: string
    error?: string
  }
}

export type DrawerTab = 'overview' | 'current' | 'spec' | 'journey' | 'transcript' | 'experts' | 'history' | 'provenance'

export interface TaskTurnLiveAgent {
  name: string
  startedAt?: string
  lastEventAt?: string
  lastEventLabel?: string
  silentMs?: number
  stalled?: boolean
}

export interface TaskTurnLiveActivity {
  at?: string
  label: string
  tone: 'neutral' | 'running' | 'ok' | 'warn' | 'danger'
  detail?: string
}

export interface TaskTurnChecklistStep {
  id: string
  title: string
  why: string
  status: 'done' | 'active' | 'pending' | 'skipped'
}

export interface TaskTurnChecklist {
  title: string
  doneCount: number
  totalSteps: number
  activeStepId: string | null
  steps: TaskTurnChecklistStep[]
}

export interface TaskTurnWorkerHandoff {
  ready: boolean
  cleanupNeeded: boolean
}

export interface TaskThreadTurnBase {
  id: string
  at: string
  persona: 'intake' | 'spec' | 'worker' | 'reviewer' | 'coord' | 'system'
  status: 'done' | 'active' | 'pending'
  phase: 'setup' | 'intake' | 'spec' | 'ready' | 'inflight' | 'blocked' | 'done'
  taskId: string
  taskTitle: string
  constructionMode?: 'survey' | 'blueprint' | 'frame' | 'build' | 'inspect' | 'change_order' | 'punch_list'
  taskDescription?: string
  sourceNote?: {
    description?: string
    references: string[]
  }
}

export interface TaskThreadBriefTurn extends TaskThreadTurnBase {
  kind: 'brief_approval'
  brief: {
    userJob?: string
    successMetric?: string
    successCriteria?: string
    antiPatterns?: string[]
    rolloutPlan?: string
    authoredBy?: string
  }
  liveAgent?: TaskTurnLiveAgent
  approvedAt?: string | null
}

export interface TaskThreadQuestionTurn extends TaskThreadTurnBase {
  kind: 'agent_question'
  liveAgent?: TaskTurnLiveAgent
  activity?: TaskTurnLiveActivity[]
  question: AgentQuestion
  questions?: AgentQuestion[]
}

export interface TaskThreadSpecReviewTurn extends TaskThreadTurnBase {
  kind: 'spec_review'
  spec: string
}

export interface TaskThreadReviewFeedbackTurn extends TaskThreadTurnBase {
  kind: 'review_feedback'
  summary: string
  feedback: string
  revisionCount?: number
}

export interface TaskThreadEscalationTurn extends TaskThreadTurnBase {
  kind: 'escalation'
  escalationId: string
  escalationReason?: string
  escalationAgentId?: string
  summary: string
  details?: string
  externalChecklist?: ExternalBlockerStep[]
  activity?: TaskTurnLiveActivity[]
}

export interface TaskThreadInFlightTurn extends TaskThreadTurnBase {
  kind: 'inflight'
  taskStatus?: string
  summary: string
  importedDraft?: boolean
  liveAgent?: TaskTurnLiveAgent
  activity?: TaskTurnLiveActivity[]
  checklist?: TaskTurnChecklist
  workerHandoff?: TaskTurnWorkerHandoff
}

export type TaskThreadTurn =
  | TaskThreadBriefTurn
  | TaskThreadQuestionTurn
  | TaskThreadSpecReviewTurn
  | TaskThreadReviewFeedbackTurn
  | TaskThreadEscalationTurn
  | TaskThreadInFlightTurn

/**
 * Task card view — a trimmed Task with just the fields the mini-card renders.
 * The /api/project response delivers full Task objects; TaskCard derives its
 * own "isActive" signal from the run status kept in ProjectDetail.
 */
export interface TaskLite {
  id: string
  title?: string
  status?: string
  domain?: string
  priority?: string
  revisionCount?: number
  escalations?: Escalation[]
  latestReviewerSummary?: string
  latestSelfCritique?: string
  latestCheckpoint?: Task['latestCheckpoint']
  terminalSummary?: Task['terminalSummary']
}

export interface CoordinatorConfig {
  id?: string
  name?: string
  domain?: string
  path?: string
  mandate?: string
  concerns?: Array<{
    id?: string
    description?: string
    reviewQuestions?: string[]
  }>
  autonomousDecisions?: string[]
  escalationTriggers?: string[]
}

export interface ProjectRun {
  status?: string
  mode?: 'continuous' | 'one_task' | string
  startedAt?: string
  stoppedAt?: string
  error?: string
  stopSummary?: {
    ticks?: number
    stopReason?: string
    stopMessage?: string
    idleSummary?: {
      reason?: string
      message?: string
      counts?: Record<string, number>
    }
  }
  providerStatus?: ProviderStatus
}

export interface ProjectRuntimeSummary {
  backend?: string
  status?: 'stopped' | 'creating' | 'running' | 'failed' | string
  health?: {
    status?: 'unknown' | 'healthy' | 'degraded' | 'unhealthy' | string
    checkedAt?: string | null
    checks?: Array<{ name?: string; ok?: boolean; message?: string }>
  }
  migration?: {
    mode?: 'host-run' | 'runtime-backed' | string
    lastResult?: string | null
    acceptedAt?: string | null
  }
  backendSetup?: {
    status?: string
    selectedMode?: 'podman' | 'host-run' | string | null
    message?: string
  }
  image?: {
    repository?: string
    tag?: string
    digest?: string | null
  }
  mounts?: {
    projectRoot?: string
    projectPath?: string
    guildhallHome?: string
    guildhallHomePath?: string
  }
  lastActivityAt?: string | null
  lastError?: string | null
}

export interface ProjectMemoryHealth {
  total?: number
  active?: number
  proposed?: number
  used?: number
  retired?: number
  project?: number
  userGlobal?: number
  guildhallProduct?: number
  recentUse?: Array<{ taskId?: string; included?: number; withheld?: number; at?: string }>
}

export interface ProviderStatus {
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
  preferredCapabilities?: {
    streaming: boolean
    toolCalls: boolean
    resumableSessions: boolean
    reasoningSideChannel: 'none' | 'compatible'
    browserAppControl: boolean
    recommendedConcurrency: number
    localServer: boolean
  } | null
  preferredProvider?: string | null
  preferredProviderFamily?: string | null
  preferredProviderLabel?: string | null
  activeProvider?: string | null
  activeCapabilities?: {
    streaming: boolean
    toolCalls: boolean
    resumableSessions: boolean
    reasoningSideChannel: 'none' | 'compatible'
    browserAppControl: boolean
    recommendedConcurrency: number
    localServer: boolean
  } | null
  activeProviderFamily?: string | null
  activeProviderLabel?: string | null
  warnings?: Array<{
    code: string
    severity: 'info' | 'warn' | 'error'
    message: string
  }>
  fallback?: boolean
  allowPaidProviderFallback?: boolean
  selectedAt?: string
  reason?: string
  activeModel?: string | null
  models?: {
    spec?: string
    coordinator?: string
    worker?: string
    reviewer?: string
    gateChecker?: string
    contextIndexer?: string
  } | null
}

export interface StartReadiness {
  canStart: boolean
  code?: string
  message?: string
  actionHref?: string
}

export interface ProjectMigrationStatusItem {
  id: string
  title: string
  introducedIn?: string
  scope?: string
  safety?: string
  requirement?: string
  summary?: string
  affectedPaths?: string[]
}

export interface ProjectMigrationStatus {
  projectRoot?: string
  pending: ProjectMigrationStatusItem[]
  blocked: ProjectMigrationStatusItem[]
  applied: ProjectMigrationStatusItem[]
}

export interface BootstrapStep {
  kind?: 'command' | 'gate' | string
  command?: string
  result?: 'pass' | 'fail' | string
  exitCode?: number
  output?: string
  durationMs?: number
}

export interface BootstrapStatus {
  success?: boolean
  lastRunAt?: string
  durationMs?: number
  commandHash?: string
  lockfileHash?: string | null
  steps?: BootstrapStep[]
}

export interface StructuralMapReviewSummaryNode {
  id: string
  label: string
  path?: string
  command?: string
  confidence?: 'low' | 'medium' | 'high' | 'conflict' | string
  evidenceScore?: number
  freshness?: 'fresh' | 'recent' | 'stale' | 'unknown' | string
}

export interface StructuralMapReviewSummary {
  id?: string
  state?: 'draft' | 'owner_review' | 'correction_requested' | 'accepted' | 'superseded' | string
  generatedAt?: string
  counts?: {
    gitRoots?: number
    ignoredGitRoots?: number
    packages?: number
    domains?: number
    crossCuttingDomains?: number
    executableUnits?: number
    conflicts?: number
    questions?: number
  }
  gitRoots?: StructuralMapReviewSummaryNode[]
  ignoredGitRoots?: StructuralMapReviewSummaryNode[]
  packages?: StructuralMapReviewSummaryNode[]
  domains?: StructuralMapReviewSummaryNode[]
  crossCuttingDomains?: StructuralMapReviewSummaryNode[]
  executableUnits?: StructuralMapReviewSummaryNode[]
  conflicts?: Array<{
    id?: string
    message?: string
    severity?: 'low' | 'medium' | 'high' | string
    targetId?: string
  }>
  questions?: Array<{
    id?: string
    prompt?: string
    reason?: string
    targetIds?: string[]
  }>
}

export interface ProjectInbox {
  items?: Array<{
    kind?: string
    severity?: 'high' | 'medium' | 'low' | string
    taskId?: string
    migrationId?: string
    title?: string
    detail?: string
    actionHref?: string
    defaultCount?: number
    dismissEndpoint?: string
    signals?: string[]
    missingSteps?: string[]
    blocking?: boolean
    dismissible?: boolean
  }>
  blockers?: {
    bootstrap?: boolean
    workspaceImport?: boolean
  }
}

export interface ProjectDetail {
  initializationNeeded?: boolean
  id?: string
  path?: string
  name?: string
  tags?: string[]
  config?: {
    coordinators?: CoordinatorConfig[]
    [k: string]: unknown
  }
  tasks?: Task[]
  inbox?: ProjectInbox
  run?: ProjectRun | null
  providerStatus?: ProviderStatus | null
  runtime?: ProjectRuntimeSummary | null
  memoryHealth?: ProjectMemoryHealth | null
  structuralMapReview?: StructuralMapReviewSummary | null
  gitStory?: GitStorySummary | null
  startReadiness?: StartReadiness | null
  bootstrapStatus?: BootstrapStatus
  recentEvents?: EventEnvelope[]
  error?: string
}

export interface ServiceProjectSummary {
  id: string
  path: string
  name: string
  initializationNeeded?: boolean
  tags?: string[]
  summary?: string | null
  taskCounts?: {
    total: number
    active: number
    draftReview?: number
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
  run?: ProjectRun | null
  providerStatus?: ProviderStatus | null
  gitStory?: GitStorySummary | null
  startReadiness?: StartReadiness | null
  projectCheckIn?: {
    needed?: boolean
    label?: string
    title?: string
    detail?: string
    actionHref?: string
    totalCount?: number
    activeCount?: number
    completedCount?: number
  } | null
}

export interface ServiceDetail {
  pid?: number
  defaultProviderStatus?: ProviderStatus | null
  projects?: ServiceProjectSummary[]
}

export interface EventInner {
  type?: string
  task_id?: string
  taskId?: string
  from_status?: string
  to_status?: string
  agent_name?: string
  reason?: string
  severity?: string
  code?: string
  message?: string
  [k: string]: unknown
}

export interface EventEnvelope {
  at?: string
  event?: EventInner
  type?: string
  [k: string]: unknown
}

export type ProjectView =
  | 'overview'
  | 'thread'
  | 'inbox'
  | 'work'
  | 'planner'
  | 'structure'
  | 'timeline'
  | 'release'
  | 'settings'
  | 'workspace-import'
  | 'facts'

/**
 * Sub-path within a ProjectView. Only `settings` and `release` surface a
 * sub-nav in the left rail; everything else stays null.
 *
 *  - settings:     'ready' | 'routing' | 'advanced'
 *  - release:      'verdict' | 'criteria'
 */
export type ProjectSubView = string | null
