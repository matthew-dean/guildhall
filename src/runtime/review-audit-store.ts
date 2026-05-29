import { z } from 'zod'
import type {
  GuildhallPersistence,
  PersistencePlacement,
  PersistedEvent,
  PersistedRecord,
} from '@guildhall/persistence'

const sharedReviewPlacement: PersistencePlacement = {
  scope: 'shared_project',
  retention: 'active',
  visibility: 'internal_audit',
  commitPolicy: 'committed',
}

const localReviewPlacement: PersistencePlacement = {
  scope: 'local_history',
  retention: 'debug',
  visibility: 'internal_audit',
  commitPolicy: 'ignored',
}

export const ReviewRiskLane = z.enum([
  'ux_comprehension',
  'copy_clarity',
  'visual_design',
  'accessibility',
  'security',
  'privacy',
  'api_contract',
  'data_integrity',
  'migration_safety',
  'test_adequacy',
  'performance',
  'docs_truth',
  'release_risk',
  'plan_completeness',
  'evidence_privacy',
  'calibration_governance',
  'cost_control',
  'rollout_safety',
])
export type ReviewRiskLane = z.infer<typeof ReviewRiskLane>

export const ReviewEffort = z.enum(['lean', 'balanced', 'thorough', 'release_critical', 'custom'])
export type ReviewEffort = z.infer<typeof ReviewEffort>

export const ReviewBudget = z.object({
  maxReviewerAgents: z.number().int().positive().optional(),
  maxEstimatedTokens: z.number().int().positive().optional(),
  maxWallClockMinutes: z.number().positive().optional(),
  maxRevisionLoops: z.number().int().nonnegative().optional(),
})
export type ReviewBudget = z.infer<typeof ReviewBudget>

export const ReviewRecipeRef = z.object({
  recipeId: z.string().min(1),
  version: z.string().min(1),
  lanes: z.array(ReviewRiskLane).min(1),
  blocking: z.enum(['none', 'medium', 'high', 'strict']).default('high'),
  required: z.boolean().default(true),
  calibrationRecipeIds: z.array(z.string().min(1)).default([]),
})
export type ReviewRecipeRef = z.infer<typeof ReviewRecipeRef>

export const ReviewAdvisoryLens = z.object({
  lens: z.enum([
    'contrarian',
    'first_principles',
    'expansionist',
    'outsider',
    'executor',
  ]),
  reason: z.string().min(1),
  blocking: z.literal('advisory').default('advisory'),
})
export type ReviewAdvisoryLens = z.infer<typeof ReviewAdvisoryLens>

export const ReviewPlanRecord = z.object({
  taskId: z.string().min(1),
  effort: ReviewEffort,
  depth: z.enum(['minimal', 'standard', 'targeted', 'deep', 'release_critical']),
  selectedLanes: z.array(ReviewRiskLane).default([]),
  skippedLanes: z.array(z.object({
    lane: ReviewRiskLane,
    reason: z.string().min(1),
  })).default([]),
  requiredRecipes: z.array(ReviewRecipeRef).default([]),
  advisoryLenses: z.array(ReviewAdvisoryLens).default([]),
  deterministicChecks: z.array(z.string()).default([]),
  requiredArtifacts: z.array(z.string()).default([]),
  budget: ReviewBudget.default({}),
  aggregation: z.record(ReviewRiskLane, z.enum(['advisory', 'blocking_on_high', 'strict'])).default({}),
  reasons: z.array(z.string()).default([]),
  createdAt: z.string().min(1),
  createdBy: z.string().min(1),
})
export type ReviewPlanRecord = z.infer<typeof ReviewPlanRecord>

export const ReviewPlanEvent = z.object({
  taskId: z.string().min(1),
  kind: z.enum(['created', 'expanded_budget', 'downgraded', 'override', 'adjudication', 'escalation']),
  summary: z.string().min(1),
  reason: z.string().optional(),
  lanes: z.array(ReviewRiskLane).default([]),
  recordedAt: z.string().min(1),
  recordedBy: z.string().min(1),
})
export type ReviewPlanEvent = z.infer<typeof ReviewPlanEvent>

export const ReviewerRunRecord = z.object({
  taskId: z.string().min(1),
  recipeId: z.string().min(1),
  recipeVersion: z.string().min(1),
  lanes: z.array(ReviewRiskLane).min(1),
  model: z.string().optional(),
  provider: z.string().optional(),
  settingsHash: z.string().optional(),
  contextHash: z.string().optional(),
  artifactRefs: z.array(z.string()).default([]),
  verdict: z.enum(['approve', 'revise', 'advisory']),
  findings: z.array(z.object({
    lane: ReviewRiskLane,
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    summary: z.string().min(1),
  })).default([]),
  cost: z.object({
    estimatedTokens: z.number().int().nonnegative().optional(),
    estimatedUsd: z.number().nonnegative().optional(),
    latencyMs: z.number().int().nonnegative().optional(),
  }).default({}),
  recordedAt: z.string().min(1),
  recordedBy: z.string().min(1),
})
export type ReviewerRunRecord = z.infer<typeof ReviewerRunRecord>

export const FrontierRunRecord = z.object({
  runId: z.string().min(1),
  variantSet: z.string().min(1),
  variants: z.array(z.string()).min(1),
  metrics: z.record(z.string(), z.unknown()).default({}),
  recommendedDefault: ReviewEffort.optional(),
  summary: z.string().min(1),
  recordedAt: z.string().min(1),
  recordedBy: z.string().min(1),
})
export type FrontierRunRecord = z.infer<typeof FrontierRunRecord>

export const EscapedMissRecord = z.object({
  taskId: z.string().min(1),
  missedLane: ReviewRiskLane,
  missedByRecipe: z.string().optional(),
  humanFinding: z.string().min(1),
  nextCalibrationAction: z.enum([
    'create_case',
    'update_case',
    'run_bakeoff',
    'add_deterministic_gate',
    'adjust_planner',
  ]),
  recordedAt: z.string().min(1),
  recordedBy: z.string().min(1),
})
export type EscapedMissRecord = z.infer<typeof EscapedMissRecord>

type InputWithDefaults<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

export interface ReviewAuditStore {
  saveReviewPlan(input: InputWithDefaults<ReviewPlanRecord, 'createdAt' | 'skippedLanes' | 'requiredRecipes' | 'advisoryLenses' | 'deterministicChecks' | 'requiredArtifacts' | 'budget' | 'aggregation' | 'reasons'>): Promise<PersistedRecord<ReviewPlanRecord>>
  appendReviewPlanEvent(input: Omit<ReviewPlanEvent, 'recordedAt'> & { recordedAt?: string }): Promise<PersistedEvent<ReviewPlanEvent>>
  saveReviewerRun(input: InputWithDefaults<ReviewerRunRecord, 'recordedAt' | 'model' | 'provider' | 'settingsHash' | 'contextHash' | 'artifactRefs' | 'findings' | 'cost'>): Promise<PersistedEvent<ReviewerRunRecord>>
  saveFrontierRun(input: InputWithDefaults<FrontierRunRecord, 'recordedAt' | 'metrics' | 'recommendedDefault'>): Promise<PersistedRecord<FrontierRunRecord>>
  linkEscapedMiss(input: Omit<EscapedMissRecord, 'recordedAt'> & { recordedAt?: string }): Promise<PersistedEvent<EscapedMissRecord>>
  readTaskReviewAudit(taskId: string): Promise<{
    plan: PersistedRecord<ReviewPlanRecord> | null
    events: Array<PersistedEvent<ReviewPlanEvent>>
    reviewerRuns: Array<PersistedEvent<ReviewerRunRecord>>
    escapedMisses: Array<PersistedEvent<EscapedMissRecord>>
  }>
}

export function createReviewAuditStore(input: {
  projectRoot: string
  persistence: GuildhallPersistence
  now?: () => Date
}): ReviewAuditStore {
  const nowIso = () => (input.now?.() ?? new Date()).toISOString()
  const sourceForTask = (taskId: string) => [`task:${taskId}`]

  return {
    async saveReviewPlan(planInput) {
      const plan = ReviewPlanRecord.parse({
        ...planInput,
        createdAt: planInput.createdAt ?? nowIso(),
      })
      return input.persistence.writeRecord({
        projectRoot: input.projectRoot,
        placement: sharedReviewPlacement,
        collection: 'review-plans',
        id: plan.taskId,
        schemaName: 'review-plan',
        schemaVersion: 1,
        createdBy: plan.createdBy,
        sourceRefs: sourceForTask(plan.taskId),
        payload: plan,
        now: input.now,
      })
    },

    async appendReviewPlanEvent(eventInput) {
      const event = ReviewPlanEvent.parse({
        ...eventInput,
        recordedAt: eventInput.recordedAt ?? nowIso(),
      })
      return input.persistence.appendEvent({
        projectRoot: input.projectRoot,
        placement: sharedReviewPlacement,
        collection: 'review-plan-events',
        streamId: event.taskId,
        schemaName: 'review-plan-event',
        schemaVersion: 1,
        createdBy: event.recordedBy,
        sourceRefs: sourceForTask(event.taskId),
        payload: event,
        now: input.now,
      })
    },

    async saveReviewerRun(runInput) {
      const run = ReviewerRunRecord.parse({
        ...runInput,
        recordedAt: runInput.recordedAt ?? nowIso(),
      })
      return input.persistence.appendEvent({
        projectRoot: input.projectRoot,
        placement: localReviewPlacement,
        collection: 'reviewer-runs',
        streamId: run.taskId,
        schemaName: 'reviewer-run',
        schemaVersion: 1,
        createdBy: run.recordedBy,
        sourceRefs: sourceForTask(run.taskId),
        payload: run,
        now: input.now,
      })
    },

    async saveFrontierRun(runInput) {
      const run = FrontierRunRecord.parse({
        ...runInput,
        recordedAt: runInput.recordedAt ?? nowIso(),
      })
      return input.persistence.writeRecord({
        projectRoot: input.projectRoot,
        placement: localReviewPlacement,
        collection: 'frontier-runs',
        id: run.runId,
        schemaName: 'frontier-run',
        schemaVersion: 1,
        createdBy: run.recordedBy,
        sourceRefs: [`frontier:${run.runId}`],
        payload: run,
        now: input.now,
      })
    },

    async linkEscapedMiss(missInput) {
      const miss = EscapedMissRecord.parse({
        ...missInput,
        recordedAt: missInput.recordedAt ?? nowIso(),
      })
      return input.persistence.appendEvent({
        projectRoot: input.projectRoot,
        placement: sharedReviewPlacement,
        collection: 'escaped-misses',
        streamId: miss.taskId,
        schemaName: 'escaped-miss',
        schemaVersion: 1,
        createdBy: miss.recordedBy,
        sourceRefs: sourceForTask(miss.taskId),
        payload: miss,
        now: input.now,
      })
    },

    async readTaskReviewAudit(taskId) {
      const plan = await input.persistence.readRecord<ReviewPlanRecord>(input.persistence.recordRef({
        projectRoot: input.projectRoot,
        placement: sharedReviewPlacement,
        collection: 'review-plans',
        id: taskId,
      }))
      return {
        plan,
        events: await input.persistence.listEvents<ReviewPlanEvent>({
          projectRoot: input.projectRoot,
          placement: sharedReviewPlacement,
          collection: 'review-plan-events',
          streamId: taskId,
        }),
        reviewerRuns: await input.persistence.listEvents<ReviewerRunRecord>({
          projectRoot: input.projectRoot,
          placement: localReviewPlacement,
          collection: 'reviewer-runs',
          streamId: taskId,
        }),
        escapedMisses: await input.persistence.listEvents<EscapedMissRecord>({
          projectRoot: input.projectRoot,
          placement: sharedReviewPlacement,
          collection: 'escaped-misses',
          streamId: taskId,
        }),
      }
    },
  }
}
