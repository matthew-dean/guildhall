import { createHash } from 'node:crypto'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  GuildhallPersistence,
  PersistencePlacement,
  PersistedEvent,
  PersistedRecord,
} from '@guildhall/persistence'
import {
  getProjectLocalHistoryDir,
  getProjectSystemStateDir,
  registerProjectHistoricalArtifactIfCurrent,
} from '@guildhall/sessions'

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

async function registerReviewTransportArtifact(input: {
  projectRoot: string
  ref: PersistedRecord['ref'] | PersistedEvent['ref']
  retentionClass: 'essential' | 'diagnostic'
  createdAt?: string
}): Promise<ReturnType<typeof registerProjectHistoricalArtifactIfCurrent>> {
  const [stat, contents] = await Promise.all([
    fs.stat(input.ref.path),
    fs.readFile(input.ref.path),
  ])
  const sha256 = createHash('sha256').update(contents).digest('hex')
  return registerProjectHistoricalArtifactIfCurrent(input.projectRoot, {
    artifactId: `review-transport:${input.ref.scope}:${input.ref.collection}:${input.ref.id}`,
    kind: 'review_transport',
    owner: 'review-audit-store',
    logicalRef: path.relative(input.projectRoot, input.ref.path).replaceAll(path.sep, '/'),
    createdAt: input.createdAt ?? stat.birthtime.toISOString(),
    bytes: stat.size,
    sha256,
    retentionClass: input.retentionClass,
    state: 'active',
    lastVerifiedAt: new Date().toISOString(),
    sourceRevision: sha256,
  })
}

const REVIEW_TRANSPORT_COLLECTIONS = new Set([
  'review-plans',
  'review-plan-events',
  'reviewer-runs',
  'frontier-runs',
])

export interface ReviewTransportBackfillResult {
  filesSeen: number
  filesRegistered: number
  bytesRegistered: number
}

/**
 * Register review files written before the historical-artifact boundary.
 * This is an explicit maintenance pass: it reads only known review
 * collections, never creates missing directories, and never deletes a file.
 */
export async function backfillReviewTransportArtifacts(input: {
  projectRoot: string
  dryRun?: boolean
}): Promise<ReviewTransportBackfillResult> {
  const roots = [
    {
      scope: 'shared_project' as const,
      retentionClass: 'essential' as const,
      root: path.join(getProjectSystemStateDir(input.projectRoot), 'persistence'),
    },
    {
      scope: 'local_history' as const,
      retentionClass: 'diagnostic' as const,
      root: path.join(getProjectLocalHistoryDir(input.projectRoot), 'persistence'),
    },
  ]
  let filesSeen = 0
  let filesRegistered = 0
  let bytesRegistered = 0
  for (const candidateRoot of roots) {
    for (const kind of ['records', 'events'] as const) {
      const directory = path.join(candidateRoot.root, kind)
      let collections: Array<{ name: string; isDirectory(): boolean }>
      try {
        collections = await fs.readdir(directory, { withFileTypes: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      for (const collectionEntry of collections) {
        if (!collectionEntry.isDirectory() || !REVIEW_TRANSPORT_COLLECTIONS.has(collectionEntry.name)) continue
        const collection = collectionEntry.name
        const collectionDir = path.join(directory, collection)
        const files = await fs.readdir(collectionDir, { withFileTypes: true })
        for (const fileEntry of files) {
          if (!fileEntry.isFile() || !/\.(?:json|jsonl)$/i.test(fileEntry.name)) continue
          filesSeen += 1
          const filePath = path.join(collectionDir, fileEntry.name)
          const id = fileEntry.name.replace(/\.(?:json|jsonl)$/i, '')
          const stat = await fs.stat(filePath)
          if (input.dryRun === true) continue
          const artifact = await registerReviewTransportArtifact({
            projectRoot: input.projectRoot,
            ref: { scope: candidateRoot.scope, collection, id, path: filePath },
            retentionClass: candidateRoot.retentionClass,
            createdAt: stat.birthtime.toISOString(),
          })
          if (!artifact) continue
          filesRegistered += 1
          bytesRegistered += stat.size
        }
      }
    }
  }
  return { filesSeen, filesRegistered, bytesRegistered }
}

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
      const record = await input.persistence.writeRecord({
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
      await registerReviewTransportArtifact({ projectRoot: input.projectRoot, ref: record.ref, retentionClass: 'essential' })
      return record
    },

    async appendReviewPlanEvent(eventInput) {
      const event = ReviewPlanEvent.parse({
        ...eventInput,
        recordedAt: eventInput.recordedAt ?? nowIso(),
      })
      const persistedEvent = await input.persistence.appendEvent({
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
      await registerReviewTransportArtifact({ projectRoot: input.projectRoot, ref: persistedEvent.ref, retentionClass: 'essential' })
      return persistedEvent
    },

    async saveReviewerRun(runInput) {
      const run = ReviewerRunRecord.parse({
        ...runInput,
        recordedAt: runInput.recordedAt ?? nowIso(),
      })
      const event = await input.persistence.appendEvent({
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
      await registerReviewTransportArtifact({ projectRoot: input.projectRoot, ref: event.ref, retentionClass: 'diagnostic' })
      return event
    },

    async saveFrontierRun(runInput) {
      const run = FrontierRunRecord.parse({
        ...runInput,
        recordedAt: runInput.recordedAt ?? nowIso(),
      })
      const record = await input.persistence.writeRecord({
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
      await registerReviewTransportArtifact({ projectRoot: input.projectRoot, ref: record.ref, retentionClass: 'diagnostic' })
      return record
    },

    async linkEscapedMiss(missInput) {
      const miss = EscapedMissRecord.parse({
        ...missInput,
        recordedAt: missInput.recordedAt ?? nowIso(),
      })
      const event = await input.persistence.appendEvent({
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
      await registerReviewTransportArtifact({ projectRoot: input.projectRoot, ref: event.ref, retentionClass: 'diagnostic' })
      return event
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
