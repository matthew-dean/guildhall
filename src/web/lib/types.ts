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

export interface DrawerPayload {
  task: Task
  recentEvents?: unknown[]
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
  startedAt?: string
  stoppedAt?: string
  error?: string
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
  | 'inbox'
  | 'work'
  | 'planner'
  | 'coordinators'
  | 'timeline'
  | 'release'
  | 'settings'
  | 'workspace-import'

/**
 * Sub-path within a ProjectView. Only `settings`, `coordinators`, and
 * `release` surface a sub-nav in the left rail; everything else stays null.
 *
 *  - settings:     'ready' | 'coordinators' | 'advanced'
 *  - release:      'verdict' | 'criteria'
 *  - coordinators: 'all' | '<coordinator-id>'
 */
export type ProjectSubView = string | null
