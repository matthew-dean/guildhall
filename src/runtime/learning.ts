import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ensureGuildhallHome, guildhallHomeDir } from '@guildhall/config'
import { z } from 'zod'
import type { WorkspaceImportReview } from './workspace-import/review.js'
import type { WorkspaceImportDraft } from './workspace-import/index.js'
import type { Task } from '@guildhall/core'
import type {
  LearningCandidate,
  PolicyConfidence,
  PreferenceItem,
  PreferencePosition,
  PreferenceSubject,
  StructuredPreference,
} from './policy.js'
import { getProjectSystemStatePathFromMemoryDir } from '@guildhall/sessions'

const TaskSelectionMode = z.enum(['all', 'tight'])

const WorkspaceImportLearningSchema = z.object({
  preferredAreaKeys: z.array(z.string()).default([]),
  preferredSourceKeys: z.array(z.string()).default([]),
  // Kept for compatibility with older learning files. Exact task-id reuse
  // turns stale quickly as living docs evolve, so defaults no longer depend
  // on this field.
  preferredTaskIds: z.array(z.string()).default([]),
  areaSelectionCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  sourceSelectionCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  approvedRuns: z.number().int().nonnegative().default(0),
  dismissedRuns: z.number().int().nonnegative().default(0),
  averageTaskAcceptanceRatio: z.number().min(0).max(1).nullable().default(null),
  lastTaskAcceptanceRatio: z.number().min(0).max(1).nullable().default(null),
  taskSelectionMode: TaskSelectionMode.default('all'),
  updatedAt: z.string().nullable().default(null),
})

const CoordinatorSuggestionSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
})

const ProductSuggestionSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  evidence: z.array(z.string()),
})

const EvidenceRefSchema = z.object({
  kind: z.enum(['task', 'verification', 'tool_error', 'review', 'checkpoint']),
  summary: z.string(),
  ref: z.string().optional(),
  links: z.array(z.object({
    kind: z.enum(['task', 'local_history']),
    label: z.string(),
    href: z.string().optional(),
    localHistoryRef: z.string().optional(),
  })).default([]),
})

const PreferenceItemSchema = z.object({
  item: z.string().min(1),
  strength: z.enum(['weak', 'medium', 'strong']).optional(),
  exceptions: z.array(z.string().min(1)).optional(),
})

const StructuredPreferenceSchema = z.object({
  kind: z.literal('preference'),
  subject: z.object({
    domain: z.string().min(1),
    area: z.string().min(1).optional(),
    item: z.string().min(1).optional(),
  }),
  position: z.object({
    prefer: z.array(PreferenceItemSchema).optional(),
    avoid: z.array(PreferenceItemSchema).optional(),
    ranking: z.enum(['ordered', 'unordered']).optional(),
  }).refine(
    position => (position.prefer?.length ?? 0) > 0 || (position.avoid?.length ?? 0) > 0,
    'Structured preferences must prefer or avoid at least one item.',
  ),
})

const SuggestedLearningSchema = z.object({
  id: z.string(),
  source: z.enum(['task', 'blocker', 'user_correction', 'review', 'gate', 'model_eval']),
  summary: z.string(),
  evidence: z.array(EvidenceRefSchema).default([]),
  scope: z.enum(['project', 'user_global', 'guildhall_product']),
  destination: z.enum([
    'project_memory',
    'project_skill',
    'project_policy',
    'user_preference',
    'product_suggestion',
    'model_lane_recommendation',
    'task_audit_only',
  ]),
  confidence: z.enum(['low', 'medium', 'high']),
  risk: z.enum(['low', 'medium', 'high']),
  requiresApproval: z.boolean(),
  status: z.enum(['suggested', 'active', 'dismissed']).default('suggested'),
  createdAt: z.string(),
  updatedAt: z.string(),
  dismissedAt: z.string().optional(),
  preference: StructuredPreferenceSchema.optional(),
})

const LearningRecordSchema = z.object({
  version: z.literal(1).default(1),
  workspaceImport: WorkspaceImportLearningSchema.default({}),
  coordinatorSuggestions: z.array(CoordinatorSuggestionSchema).default([]),
  productSuggestions: z.array(ProductSuggestionSchema).default([]),
  suggestedLearnings: z.array(SuggestedLearningSchema).default([]),
  userCorrectionCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
})

export type WorkspaceImportLearning = z.infer<typeof WorkspaceImportLearningSchema>
export type CoordinatorSuggestion = z.infer<typeof CoordinatorSuggestionSchema>
export type ProductSuggestion = z.infer<typeof ProductSuggestionSchema>
export type SuggestedLearning = z.infer<typeof SuggestedLearningSchema>
export type LearningRecord = z.infer<typeof LearningRecordSchema>
export type { PreferenceItem, PreferencePosition, PreferenceSubject, StructuredPreference }

export interface ReflectionTrigger {
  source:
    | 'done'
    | 'blocked'
    | 'playbook_success'
    | 'playbook_failure'
    | 'user_correction'
    | 'model_lane_failure'
  summary: string
  ref?: string
}

export interface WorkspaceImportDefaults {
  selectedAreaKeys: string[]
  selectedSourceKeys: string[]
  selectedTaskIds: string[]
  taskSelectionMode: z.infer<typeof TaskSelectionMode>
  note: string | null
}

export interface LearningSnapshot {
  project: LearningRecord
  user: LearningRecord
  effective: {
    workspaceImport: WorkspaceImportLearning
    defaults: WorkspaceImportDefaults
    coordinatorSuggestions: CoordinatorSuggestion[]
    productSuggestions: ProductSuggestion[]
  }
}

export interface RecordWorkspaceImportApprovalInput {
  memoryDir: string
  review: WorkspaceImportReview
  draft: WorkspaceImportDraft
  selectedAreaKeys: string[]
  selectedSourceKeys: string[]
  selectedTaskIds: string[]
}

function defaultLearningRecord(): LearningRecord {
  return LearningRecordSchema.parse({})
}

export function projectLearningPath(memoryDir: string): string {
  return getProjectSystemStatePathFromMemoryDir(memoryDir, 'learning.json')
}

export function globalLearningPath(): string {
  return path.join(guildhallHomeDir(), 'learning.json')
}

function parseLearning(raw: unknown): LearningRecord {
  return LearningRecordSchema.parse(raw ?? {})
}

function localTaskTranscriptRef(taskId: string): string {
  return path.join('transcripts', 'exploring', `${taskId}.md`)
}

function enrichEvidenceRefs(evidence: LearningCandidate['evidence']): LearningCandidate['evidence'] {
  return evidence.map((item) => {
    if (item.kind !== 'task' || !item.ref) return item
    const taskHref = `/task/${encodeURIComponent(item.ref)}`
    const localHistoryRef = localTaskTranscriptRef(item.ref)
    const existing = item.links ?? []
    const hasTaskLink = existing.some(link => link.kind === 'task' && link.href === taskHref)
    const hasLocalRef = existing.some(link => link.localHistoryRef === localHistoryRef)
    return {
      ...item,
      links: [
        ...existing,
        ...(hasTaskLink && hasLocalRef
          ? []
          : [{
              kind: 'task' as const,
              label: 'Open task evidence',
              href: taskHref,
              localHistoryRef,
            }]),
      ],
    }
  })
}

function readLearningFile(filePath: string): LearningRecord {
  if (!existsSync(filePath)) return defaultLearningRecord()
  try {
    return parseLearning(JSON.parse(readFileSync(filePath, 'utf8')))
  } catch {
    return defaultLearningRecord()
  }
}

async function writeLearningFile(filePath: string, record: LearningRecord): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(LearningRecordSchema.parse(record), null, 2), 'utf8')
}

function upsertSuggestedLearning(
  record: LearningRecord,
  candidate: LearningCandidate,
  now: string,
  opts: { linkLocalEvidence?: boolean } = {},
): LearningRecord {
  if (candidate.proposedDestination === 'task_audit_only') return LearningRecordSchema.parse(record)
  const suggested: SuggestedLearning = SuggestedLearningSchema.parse({
    id: candidate.id,
    source: candidate.source,
    summary: candidate.summary,
    evidence: opts.linkLocalEvidence ? enrichEvidenceRefs(candidate.evidence) : candidate.evidence,
    scope: candidate.proposedScope,
    destination: candidate.proposedDestination,
    confidence: candidate.confidence,
    risk: candidate.risk,
    requiresApproval: candidate.requiresApproval,
    status: 'suggested',
    createdAt: now,
    updatedAt: now,
    preference: candidate.preference,
  })
  const existing = record.suggestedLearnings.find((item) => item.id === candidate.id)
  const next = existing
    ? record.suggestedLearnings.map((item) =>
        item.id === candidate.id
          ? SuggestedLearningSchema.parse({
              ...item,
              ...suggested,
              createdAt: item.createdAt,
              status: item.status === 'dismissed' ? 'dismissed' : suggested.status,
              dismissedAt: item.dismissedAt,
            })
          : item,
      )
    : [...record.suggestedLearnings, suggested]
  return LearningRecordSchema.parse({ ...record, suggestedLearnings: next })
}

function candidateBelongsInGlobal(candidate: LearningCandidate): boolean {
  return (
    candidate.proposedScope === 'user_global' ||
    candidate.proposedDestination === 'user_preference' ||
    candidate.proposedDestination === 'model_lane_recommendation'
  )
}

export async function persistLearningCandidates(input: {
  memoryDir: string
  candidates: readonly LearningCandidate[]
}): Promise<LearningSnapshot> {
  const now = new Date().toISOString()
  let projectRecord = readProjectLearning(input.memoryDir)
  let userRecord = readGlobalLearning()

  for (const candidate of input.candidates) {
    if (candidate.proposedDestination === 'task_audit_only') continue
    if (candidateBelongsInGlobal(candidate)) {
      userRecord = upsertSuggestedLearning(userRecord, candidate, now)
    } else {
      projectRecord = upsertSuggestedLearning(projectRecord, candidate, now, { linkLocalEvidence: true })
    }
  }

  await writeLearningFile(projectLearningPath(input.memoryDir), projectRecord)
  await writeLearningFile(globalLearningPath(), userRecord)

  return buildLearningSnapshot({
    memoryDir: input.memoryDir,
    review: { areaGroups: [], sourceGroups: [], totalTaskCandidates: 0, totalMilestones: 0, totalGoals: 0 },
    draft: { goals: [], milestones: [], context: [], stats: { inputSignals: 0, drafted: 0, deduped: 0 }, tasks: [] },
  })
}

export function readProjectLearning(memoryDir: string): LearningRecord {
  return readLearningFile(projectLearningPath(memoryDir))
}

export function readGlobalLearning(): LearningRecord {
  ensureGuildhallHome()
  return readLearningFile(globalLearningPath())
}

export async function resetProjectLearning(memoryDir: string): Promise<void> {
  await writeLearningFile(projectLearningPath(memoryDir), defaultLearningRecord())
}

export async function resetGlobalLearning(): Promise<void> {
  ensureGuildhallHome()
  await writeLearningFile(globalLearningPath(), defaultLearningRecord())
}

export function collectReflectionTriggers(task: Task): ReflectionTrigger[] {
  const triggers: ReflectionTrigger[] = []
  if (task.status === 'done') {
    triggers.push({
      source: 'done',
      summary: `Task ${task.id} completed.`,
      ref: task.id,
    })
  }
  if (task.status === 'blocked') {
    triggers.push({
      source: 'blocked',
      summary: task.blockReason ?? `Task ${task.id} is blocked.`,
      ref: task.id,
    })
  }
  for (const note of task.notes) {
    if (note.role === 'recovery-playbook') {
      try {
        const parsed = JSON.parse(note.content) as Record<string, unknown>
        const status = parsed['status']
        const playbook = typeof parsed['playbook'] === 'string' ? parsed['playbook'] : 'recovery'
        if (status === 'succeeded') {
          triggers.push({
            source: 'playbook_success',
            summary: `Recovery playbook succeeded: ${playbook}.`,
            ref: note.timestamp,
          })
        } else if (status === 'failed') {
          triggers.push({
            source: 'playbook_failure',
            summary: `Recovery playbook failed: ${playbook}.`,
            ref: note.timestamp,
          })
        }
      } catch {
        // Ignore malformed historical notes; reflection should never break task flow.
      }
    }
    if (note.role === 'user-correction') {
      triggers.push({
        source: 'user_correction',
        summary: note.content,
        ref: note.timestamp,
      })
    }
  }
  for (const verdict of task.reviewVerdicts) {
    if (verdict.llmError) {
      triggers.push({
        source: 'model_lane_failure',
        summary: verdict.llmError,
        ref: verdict.recordedAt,
      })
    }
  }
  return triggers
}

function writeLearningByScope(
  memoryDir: string,
  scope: 'project' | 'user_global',
  updater: (record: LearningRecord) => LearningRecord,
): Promise<void> {
  if (scope === 'project') {
    return writeLearningFile(projectLearningPath(memoryDir), updater(readProjectLearning(memoryDir)))
  }
  ensureGuildhallHome()
  return writeLearningFile(globalLearningPath(), updater(readGlobalLearning()))
}

export async function dismissSuggestedLearning(input: {
  memoryDir: string
  id: string
  scope: 'project' | 'user_global'
}): Promise<void> {
  const now = new Date().toISOString()
  await writeLearningByScope(input.memoryDir, input.scope, (record) =>
    LearningRecordSchema.parse({
      ...record,
      suggestedLearnings: record.suggestedLearnings.map((item) =>
        item.id === input.id
          ? { ...item, status: 'dismissed', updatedAt: now, dismissedAt: now }
          : item,
      ),
    }),
  )
}

export async function acceptSuggestedLearning(input: {
  memoryDir: string
  id: string
  scope: 'project' | 'user_global'
}): Promise<void> {
  const now = new Date().toISOString()
  await writeLearningByScope(input.memoryDir, input.scope, (record) =>
    LearningRecordSchema.parse({
      ...record,
      suggestedLearnings: record.suggestedLearnings.map((item) =>
        item.id === input.id
          ? { ...item, status: 'active', updatedAt: now }
          : item,
      ),
    }),
  )
}

export async function makeSuggestedLearningProjectWide(input: {
  memoryDir: string
  id: string
}): Promise<void> {
  const global = readGlobalLearning()
  const source = global.suggestedLearnings.find((item) => item.id === input.id)
  if (!source) throw new Error(`Suggested learning not found: ${input.id}`)
  const now = new Date().toISOString()
  await writeLearningByScope(input.memoryDir, 'project', (record) => {
    const projectId = `project-${source.id}`
    const next = SuggestedLearningSchema.parse({
      ...source,
      id: projectId,
      scope: 'project',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      dismissedAt: undefined,
    })
    return LearningRecordSchema.parse({
      ...record,
      suggestedLearnings: [
        ...record.suggestedLearnings.filter((item) => item.id !== projectId),
        next,
      ],
    })
  })
  await writeLearningByScope(input.memoryDir, 'user_global', (record) =>
    LearningRecordSchema.parse({
      ...record,
      suggestedLearnings: record.suggestedLearnings.map((item) =>
        item.id === input.id
          ? { ...item, status: 'dismissed', updatedAt: now, dismissedAt: now }
          : item,
      ),
    }),
  )
}

export async function resetSuggestedLearnings(input: {
  memoryDir: string
  scope: 'project' | 'user_global'
}): Promise<void> {
  await writeLearningByScope(input.memoryDir, input.scope, (record) =>
    LearningRecordSchema.parse({
      ...record,
      suggestedLearnings: [],
      userCorrectionCounts: input.scope === 'user_global' ? {} : record.userCorrectionCounts,
    }),
  )
}

export async function recordUserCorrection(input: {
  memoryDir: string
  category: string
  correction: string
}): Promise<void> {
  const now = new Date().toISOString()
  const userRecord = readGlobalLearning()
  const count = (userRecord.userCorrectionCounts[input.category] ?? 0) + 1
  let nextRecord = LearningRecordSchema.parse({
    ...userRecord,
    userCorrectionCounts: {
      ...userRecord.userCorrectionCounts,
      [input.category]: count,
    },
  })

  if (count >= 2) {
    const label = input.category.replaceAll('_', ' ')
      nextRecord = upsertSuggestedLearning(
        nextRecord,
        {
        id: `user-correction-${input.category}`,
        source: 'user_correction',
        summary: `Repeated user correction about ${label}: ${input.correction}`,
        evidence: [
          {
            kind: 'task',
            summary: input.correction,
          },
        ],
        proposedScope: 'user_global',
        proposedDestination: 'user_preference',
        confidence: count >= 3 ? 'high' : 'medium',
        risk: 'low',
        requiresApproval: true,
      },
      now,
    )
  }

  await writeLearningFile(globalLearningPath(), nextRecord)
}

export async function recordStructuredUserPreference(input: {
  memoryDir: string
  id: string
  summary: string
  evidenceSummary: string
  subject: PreferenceSubject
  prefer?: PreferenceItem[]
  avoid?: PreferenceItem[]
  ranking?: PreferencePosition['ranking']
  confidence?: PolicyConfidence
}): Promise<LearningSnapshot> {
  const preference = StructuredPreferenceSchema.parse({
    kind: 'preference',
    subject: input.subject,
    position: {
      prefer: input.prefer,
      avoid: input.avoid,
      ranking: input.ranking,
    },
  }) satisfies StructuredPreference

  return persistLearningCandidates({
    memoryDir: input.memoryDir,
    candidates: [
      {
        id: input.id,
        source: 'user_correction',
        summary: input.summary,
        evidence: [
          {
            kind: 'task',
            summary: input.evidenceSummary,
          },
        ],
        proposedScope: 'user_global',
        proposedDestination: 'user_preference',
        confidence: input.confidence ?? 'medium',
        risk: 'low',
        requiresApproval: true,
        preference,
      },
    ],
  })
}

function parseRecoveryPlaybookNote(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function taskReflectionCandidates(task: Task): LearningCandidate[] {
  const candidates: LearningCandidate[] = []
  const doneSummaryLearning = task.doneSummaryBundle?.summary.learningCandidates ?? []
  for (const [index, summary] of doneSummaryLearning.entries()) {
    candidates.push({
      id: `task-${task.id}-done-learning-${index + 1}`,
      source: 'task',
      summary,
      evidence: [
        {
          kind: 'task',
          summary: `Completion summary for task ${task.id}.`,
          ref: task.id,
        },
      ],
      proposedScope: 'project',
      proposedDestination: 'project_memory',
      confidence: 'medium',
      risk: 'low',
      requiresApproval: true,
    })
  }
  const proofPaths = Array.isArray((task as Task & { proofPaths?: unknown }).proofPaths)
    ? (task as Task & { proofPaths?: Array<Record<string, unknown>> }).proofPaths ?? []
    : []
  for (const proofPath of proofPaths) {
    const status = typeof proofPath.status === 'string' ? proofPath.status : ''
    const title = typeof proofPath.title === 'string' ? proofPath.title : ''
    if (status !== 'verified' || !title) continue
    candidates.push({
      id: `task-${task.id}-proof-path-${String(proofPath.id ?? title).replace(/[^a-z0-9_-]+/gi, '-')}`,
      source: 'task',
      summary: `Verified proof path for future similar work: ${title}.`,
      evidence: [
        {
          kind: 'verification',
          summary: `Proof path ${title} was verified during task ${task.id}.`,
          ref: typeof proofPath.id === 'string' ? proofPath.id : task.id,
        },
      ],
      proposedScope: 'project',
      proposedDestination: 'project_memory',
      confidence: 'medium',
      risk: 'low',
      requiresApproval: true,
    })
  }
  for (const note of task.notes) {
    if (note.role !== 'recovery-playbook') continue
    const parsed = parseRecoveryPlaybookNote(note.content)
    if (!parsed) continue
    const playbook = typeof parsed['playbook'] === 'string' ? parsed['playbook'] : 'recovery'
    const summary = typeof parsed['summary'] === 'string' ? parsed['summary'] : ''
    const allowedPaths = Array.isArray(parsed['allowedPaths'])
      ? parsed['allowedPaths'].filter((value): value is string => typeof value === 'string')
      : []
    if (parsed['status'] === 'succeeded' && allowedPaths.length > 0) {
      candidates.push({
        id: `task-${task.id}-${playbook}-paths`,
        source: 'task',
        summary:
          summary ||
          `Recovery playbook ${playbook} succeeded for project paths: ${allowedPaths.join(', ')}.`,
        evidence: [
          {
            kind: 'checkpoint',
            summary: `Successful playbook ${playbook} used ${allowedPaths.join(', ')}.`,
            ref: note.timestamp,
          },
        ],
        proposedScope: 'project',
        proposedDestination: 'project_memory',
        confidence: 'medium',
        risk: 'low',
        requiresApproval: true,
      })
    }
    if (parsed['status'] === 'failed') {
      candidates.push({
        id: `task-${task.id}-${playbook}-failure-product`,
        source: 'blocker',
        summary:
          summary ||
          `Recovery playbook ${playbook} failed and may need a product-level improvement.`,
        evidence: [
          {
            kind: 'task',
            summary: `Failed playbook ${playbook} on task ${task.id}.`,
            ref: note.timestamp,
          },
        ],
        proposedScope: 'guildhall_product',
        proposedDestination: 'product_suggestion',
        confidence: 'medium',
        risk: 'low',
        requiresApproval: true,
      })
    }
  }
  for (const verdict of task.reviewVerdicts) {
    if (verdict.verdict === 'revise') {
      candidates.push({
        id: `task-${task.id}-review-miss-${verdict.recordedAt.replace(/[^0-9A-Za-z_-]+/g, '-')}`,
        source: 'review',
        summary: `Reviewer found a gap worth checking next time: ${verdict.reason}`,
        evidence: [
          {
            kind: 'review',
            summary: verdict.reason,
            ref: verdict.recordedAt,
          },
        ],
        proposedScope: 'project',
        proposedDestination: 'project_memory',
        confidence: 'medium',
        risk: 'low',
        requiresApproval: true,
      })
    }
    if (!verdict.llmError) continue
    candidates.push({
      id: `task-${task.id}-model-lane-${verdict.recordedAt}`,
      source: 'model_eval',
      summary: `Model lane failure during ${verdict.reviewerPath} review: ${verdict.llmError}`,
      evidence: [
        {
          kind: 'review',
          summary: verdict.reason,
          ref: verdict.recordedAt,
        },
      ],
      proposedScope: 'user_global',
      proposedDestination: 'model_lane_recommendation',
      confidence: 'low',
      risk: 'low',
      requiresApproval: true,
    })
  }
  return candidates
}

export async function recordTaskReflection(input: {
  memoryDir: string
  task: Task
}): Promise<LearningSnapshot> {
  for (const trigger of collectReflectionTriggers(input.task)) {
    if (trigger.source !== 'user_correction') continue
    await recordUserCorrection({
      memoryDir: input.memoryDir,
      category: 'general_user_expectations',
      correction: trigger.summary,
    })
  }
  return persistLearningCandidates({
    memoryDir: input.memoryDir,
    candidates: taskReflectionCandidates(input.task),
  })
}

function incrementCounts(
  counts: Record<string, number>,
  selectedKeys: readonly string[],
): Record<string, number> {
  const next = { ...counts }
  for (const key of selectedKeys) next[key] = (next[key] ?? 0) + 1
  return next
}

function derivePreferredKeys(
  counts: Record<string, number>,
  approvedRuns: number,
): string[] {
  if (approvedRuns <= 0) return []
  const threshold = Math.max(1, Math.ceil(approvedRuns / 2))
  return Object.entries(counts)
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([key]) => key)
}

function taskAcceptanceMode(averageRatio: number | null): z.infer<typeof TaskSelectionMode> {
  if (averageRatio !== null && averageRatio < 0.65) return 'tight'
  return 'all'
}

function mergeWorkspaceImportLearning(
  base: WorkspaceImportLearning,
  patch: Partial<WorkspaceImportLearning>,
): WorkspaceImportLearning {
  return WorkspaceImportLearningSchema.parse({ ...base, ...patch })
}

function rebuildProjectSuggestions(record: LearningRecord): LearningRecord {
  const wi = record.workspaceImport
  const coordinatorSuggestions: CoordinatorSuggestion[] = []
  const productSuggestions: ProductSuggestion[] = []

  if (wi.approvedRuns >= 2 && (wi.averageTaskAcceptanceRatio ?? 1) < 0.65) {
    coordinatorSuggestions.push({
      id: 'workspace-import-clarity-check',
      title: 'Let the coordinator tighten broad import drafts sooner',
      summary:
        'Guildhall keeps drafting a broader task list than this project wants. The local coordinator should apply a stronger clarity check before asking for approval.',
      confidence: (wi.averageTaskAcceptanceRatio ?? 1) < 0.45 ? 'high' : 'medium',
    })
  }

  if (wi.approvedRuns >= 2 && (wi.averageTaskAcceptanceRatio ?? 1) < 0.45) {
    const ratio = Math.round((wi.averageTaskAcceptanceRatio ?? 0) * 100)
    productSuggestions.push({
      id: 'workspace-import-tighten-defaults',
      title: 'Workspace import should propose fewer tasks by default',
      summary:
        'This project repeatedly trims most of the suggested task list before approval. Guildhall should lead with a tighter recommended draft.',
      evidence: [
        `Average kept task ratio: ${ratio}% across ${wi.approvedRuns} approved import run${wi.approvedRuns === 1 ? '' : 's'}.`,
      ],
    })
  }

  return LearningRecordSchema.parse({
    ...record,
    coordinatorSuggestions,
    productSuggestions,
  })
}

function updateAcceptanceStats(
  current: WorkspaceImportLearning,
  ratio: number,
  now: string,
): WorkspaceImportLearning {
  const nextRuns = current.approvedRuns + 1
  const average =
    current.averageTaskAcceptanceRatio === null
      ? ratio
      : ((current.averageTaskAcceptanceRatio * current.approvedRuns) + ratio) / nextRuns
  const merged = mergeWorkspaceImportLearning(current, {
    approvedRuns: nextRuns,
    averageTaskAcceptanceRatio: average,
    lastTaskAcceptanceRatio: ratio,
    taskSelectionMode: taskAcceptanceMode(average),
    updatedAt: now,
  })
  return WorkspaceImportLearningSchema.parse(merged)
}

export async function recordWorkspaceImportApproval(
  input: RecordWorkspaceImportApprovalInput,
): Promise<LearningSnapshot> {
  const now = new Date().toISOString()
  const selectedAreaKeys = [...new Set(input.selectedAreaKeys)]
  const selectedSourceKeys = [...new Set(input.selectedSourceKeys)]
  const selectedTaskIds = [...new Set(input.selectedTaskIds)]
  const ratio =
    input.review.totalTaskCandidates > 0
      ? selectedTaskIds.length / input.review.totalTaskCandidates
      : 1

  const projectRecord = readProjectLearning(input.memoryDir)
  const nextProjectWI = updateAcceptanceStats(
    mergeWorkspaceImportLearning(projectRecord.workspaceImport, {
      areaSelectionCounts: incrementCounts(projectRecord.workspaceImport.areaSelectionCounts, selectedAreaKeys),
      sourceSelectionCounts: incrementCounts(projectRecord.workspaceImport.sourceSelectionCounts, selectedSourceKeys),
    }),
    ratio,
    now,
  )
  nextProjectWI.preferredAreaKeys = derivePreferredKeys(
    nextProjectWI.areaSelectionCounts,
    nextProjectWI.approvedRuns,
  )
  nextProjectWI.preferredSourceKeys = derivePreferredKeys(
    nextProjectWI.sourceSelectionCounts,
    nextProjectWI.approvedRuns,
  )
  nextProjectWI.preferredTaskIds = []
  const nextProjectRecord = rebuildProjectSuggestions({
    ...projectRecord,
    workspaceImport: nextProjectWI,
  })
  await writeLearningFile(projectLearningPath(input.memoryDir), nextProjectRecord)

  const userRecord = readGlobalLearning()
  const nextUserRecord = LearningRecordSchema.parse({
    ...userRecord,
    workspaceImport: updateAcceptanceStats(userRecord.workspaceImport, ratio, now),
  })
  await writeLearningFile(globalLearningPath(), nextUserRecord)

  return buildLearningSnapshot({
    memoryDir: input.memoryDir,
    review: input.review,
    draft: input.draft,
  })
}

export async function recordWorkspaceImportDismissal(memoryDir: string): Promise<void> {
  const now = new Date().toISOString()
  const projectRecord = readProjectLearning(memoryDir)
  await writeLearningFile(projectLearningPath(memoryDir), {
    ...projectRecord,
    workspaceImport: mergeWorkspaceImportLearning(projectRecord.workspaceImport, {
      dismissedRuns: projectRecord.workspaceImport.dismissedRuns + 1,
      updatedAt: now,
    }),
  })

  const userRecord = readGlobalLearning()
  await writeLearningFile(globalLearningPath(), {
    ...userRecord,
    workspaceImport: mergeWorkspaceImportLearning(userRecord.workspaceImport, {
      dismissedRuns: userRecord.workspaceImport.dismissedRuns + 1,
      updatedAt: now,
    }),
  })
}

export function buildWorkspaceImportDefaults(
  review: WorkspaceImportReview,
  draft: WorkspaceImportDraft,
  projectLearning: LearningRecord,
  userLearning: LearningRecord,
): WorkspaceImportDefaults {
  const taskBearingAreas = review.areaGroups.filter(area => area.taskCount > 0)
  const taskBearingSources = review.sourceGroups.filter(group => group.taskCount > 0)
  const projectPreferredAreas = projectLearning.workspaceImport.preferredAreaKeys.filter(key =>
    taskBearingAreas.some(area => area.key === key),
  )
  const selectedAreaKeys =
    projectPreferredAreas.length > 0
      ? projectPreferredAreas
      : taskBearingAreas.map(area => area.key)

  const projectPreferredSources = projectLearning.workspaceImport.preferredSourceKeys.filter(key =>
    taskBearingSources.some(group => group.key === key && selectedAreaKeys.includes(group.areaKey)),
  )
  const selectedSourceKeys =
    projectPreferredSources.length > 0
      ? projectPreferredSources
      : taskBearingSources
          .filter(group => selectedAreaKeys.includes(group.areaKey))
          .map(group => group.key)

  const taskIdsForSelectedSources = new Set(
    review.sourceGroups
      .filter(group => selectedSourceKeys.includes(group.key))
      .flatMap(group => group.taskIds),
  )
  const candidateTasks = draft.tasks.filter(task => taskIdsForSelectedSources.has(task.suggestedId))
  const currentCandidateTasks = candidateTasks.filter(task => task.scope !== 'later')
  const selectedTaskIds = (
    currentCandidateTasks.length > 0 ? currentCandidateTasks : candidateTasks
  ).map(task => task.suggestedId)

  const effectiveMode =
    projectLearning.workspaceImport.taskSelectionMode !== 'all'
      ? projectLearning.workspaceImport.taskSelectionMode
      : userLearning.workspaceImport.taskSelectionMode

  let note: string | null = null
  if (projectPreferredAreas.length > 0 || projectPreferredSources.length > 0) {
    note = 'Guildhall reused the project parts and sources you approved last time.'
  } else if (effectiveMode === 'tight') {
    note = 'Guildhall kept the last import focus, but it still starts from the full current task set for that scope.'
  }

  return {
    selectedAreaKeys,
    selectedSourceKeys,
    selectedTaskIds,
    taskSelectionMode: effectiveMode,
    note,
  }
}

export function buildLearningSnapshot(input: {
  memoryDir: string
  review: WorkspaceImportReview
  draft: WorkspaceImportDraft
}): LearningSnapshot {
  const project = readProjectLearning(input.memoryDir)
  const user = readGlobalLearning()
  const defaults = buildWorkspaceImportDefaults(input.review, input.draft, project, user)
  const suggestedProductSuggestions = project.suggestedLearnings
    .filter((item) => item.destination === 'product_suggestion')
    .map((item) => ({
      id: item.id,
      title: item.summary,
      summary: item.summary,
      evidence: item.evidence.map((evidence) => evidence.summary),
    }))

  return {
    project,
    user,
    effective: {
      workspaceImport: mergeWorkspaceImportLearning(project.workspaceImport, {
        taskSelectionMode:
          project.workspaceImport.taskSelectionMode !== 'all'
            ? project.workspaceImport.taskSelectionMode
            : user.workspaceImport.taskSelectionMode,
      }),
      defaults,
      coordinatorSuggestions: project.coordinatorSuggestions,
      productSuggestions: [
        ...project.productSuggestions,
        ...suggestedProductSuggestions,
      ],
    },
  }
}
