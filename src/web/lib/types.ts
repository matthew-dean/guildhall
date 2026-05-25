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
  resolvedAt?: string | null
}

export interface ProductBrief {
  userJob?: string
  successMetric?: string
  successCriteria?: string
  antiPatterns?: string[]
  rolloutPlan?: string
  approvedBy?: string | null
  approvedAt?: string | null
  authoredBy?: string
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
  acceptanceCriteria?: AcceptanceCriterion[]
  gateResults?: GateResult[]
  reviewVerdicts?: ReviewVerdict[]
  escalations?: Escalation[]
  notes?: TaskNote[]
  latestReviewerSummary?: string
  latestSelfCritique?: string
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
  createdAt?: string
  updatedAt?: string
  completedAt?: string
  runtime?: {
    openEscalationIds?: string[]
    openIssueIds?: string[]
    assignedTo?: string | null
    updatedAt?: string
  }
  parentGoalId?: string
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
}

export interface DrawerPayload {
  task: Task
  recentEvents?: unknown[]
  contextDebug?: ContextDebugRecord[]
  threadTurns?: TaskThreadTurn[]
  exploringTranscript?: {
    content: string | null
    path: string
    error?: string
  }
}

export type DrawerTab = 'current' | 'spec' | 'transcript' | 'experts' | 'history' | 'provenance'

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

export interface ProjectInbox {
  items?: Array<{
    kind?: string
    severity?: 'high' | 'medium' | 'low' | string
    taskId?: string
    title?: string
    detail?: string
    actionHref?: string
    defaultCount?: number
    dismissEndpoint?: string
    signals?: string[]
    missingSteps?: string[]
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
