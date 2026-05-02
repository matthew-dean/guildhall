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
export type AgentQuestion =
  | { kind: 'confirm'; id: string; askedBy: string; askedAt: string; restatement: string; answeredAt?: string; answer?: string }
  | { kind: 'yesno'; id: string; askedBy: string; askedAt: string; prompt: string; answeredAt?: string; answer?: string }
  | { kind: 'choice'; id: string; askedBy: string; askedAt: string; prompt: string; choices: string[]; selectionMode?: 'single' | 'multiple' | undefined; answeredAt?: string; answer?: string }
  | { kind: 'text'; id: string; askedBy: string; askedAt: string; prompt: string; answeredAt?: string; answer?: string }

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

export interface Task {
  id: string
  title?: string
  description?: string
  status?: string
  domain?: string
  priority?: string
  assignedTo?: string
  revisionCount?: number
  remediationAttempts?: number
  blockReason?: string
  shelveReason?: ShelveReason
  productBrief?: ProductBrief
  openQuestions?: AgentQuestion[]
  spec?: string
  acceptanceCriteria?: AcceptanceCriterion[]
  gateResults?: GateResult[]
  reviewVerdicts?: ReviewVerdict[]
  escalations?: Escalation[]
  notes?: TaskNote[]
  origination?: string
  proposedBy?: string
  proposalRationale?: string
  createdAt?: string
  updatedAt?: string
  completedAt?: string
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
}

export type DrawerTab = 'spec' | 'transcript' | 'experts' | 'history' | 'provenance'

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
}

export interface CoordinatorConfig {
  id?: string
  name?: string
  domain?: string
  mandate?: string
}

export interface ProjectRun {
  status?: string
  mode?: 'continuous' | 'one_task' | string
  startedAt?: string
  stoppedAt?: string
  error?: string
  providerStatus?: ProviderStatus
}

export interface ProviderStatus {
  preferredProvider?: string | null
  activeProvider?: string | null
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
  } | null
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
  run?: ProjectRun | null
  providerStatus?: ProviderStatus | null
  bootstrapStatus?: BootstrapStatus
  recentEvents?: EventEnvelope[]
  error?: string
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
  | 'thread'
  | 'inbox'
  | 'work'
  | 'planner'
  | 'coordinators'
  | 'timeline'
  | 'release'
  | 'settings'
  | 'workspace-import'
  | 'facts'

/**
 * Sub-path within a ProjectView. Only `settings`, `coordinators`, and
 * `release` surface a sub-nav in the left rail; everything else stays null.
 *
 *  - settings:     'ready' | 'coordinators' | 'advanced'
 *  - release:      'verdict' | 'criteria'
 *  - coordinators: 'all' | '<coordinator-id>'
 */
export type ProjectSubView = string | null
