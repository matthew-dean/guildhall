import path from 'node:path'
import { z } from 'zod'
import { buildDecompositionChildDrafts, type Task } from '@guildhall/core'
import {
  FileBackedGuildhallPersistence,
  type GuildhallPersistence,
  type PersistencePlacement,
} from '@guildhall/persistence'
import { taskShapingBlockers } from '../shared/task-shaping-blockers.js'

const DELIVERY_SPINE_COLLECTION = 'delivery-spine'
const DELIVERY_SPINE_RECORD_ID = 'project-delivery-model'
const DELIVERY_SPINE_SCHEMA_NAME = 'project-delivery-model'
const DELIVERY_SPINE_SCHEMA_VERSION = 1
const DELIVERY_SPINE_PLACEMENT: PersistencePlacement = {
  scope: 'local_history',
  retention: 'active',
  visibility: 'internal_audit',
  commitPolicy: 'ignored',
}

export const DeliveryDriverRole = z.enum(['primary', 'secondary', 'provider', 'proof', 'maintenance'])
export type DeliveryDriverRole = z.infer<typeof DeliveryDriverRole>

export const DeliveryDriver = z.object({
  id: z.string(),
  label: z.string(),
  role: DeliveryDriverRole,
  kind: z.string().optional(),
  paths: z.array(z.string()).default([]),
  domains: z.array(z.string()).default([]),
  description: z.string().optional(),
})
export type DeliveryDriver = z.infer<typeof DeliveryDriver>

export const PrimitiveStatus = z.enum(['unknown', 'proposed', 'ready', 'needs_proof', 'deprecated'])
export type PrimitiveStatus = z.infer<typeof PrimitiveStatus>

export const Primitive = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.string(),
  provider: z.string().optional(),
  paths: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
  invariants: z.array(z.string()).default([]),
  proof: z.array(z.string()).default([]),
  status: PrimitiveStatus.default('unknown'),
  source: z.enum(['user', 'import', 'agent_discovery', 'generated_from_contract']).optional(),
  evidence: z.array(z.string()).default([]),
  aliases: z.array(z.string()).default([]),
})
export type Primitive = z.infer<typeof Primitive>

export const ProjectDeliveryModel = z.object({
  version: z.literal(1).default(1),
  updatedAt: z.string(),
  drivers: z.array(DeliveryDriver).default([]),
  primitives: z.array(Primitive).default([]),
  validationEvidence: z.array(z.record(z.unknown())).default([]),
  rejectedCandidates: z.array(z.record(z.unknown())).default([]),
})
export type ProjectDeliveryModel = z.infer<typeof ProjectDeliveryModel>

export const SchemaMigrationDecision = z.object({
  persistedSchemaTouched: z.string(),
  scope: z.enum(['project', 'workspace', 'machine', 'database', 'local_history', 'system_local_project_state', 'none']),
  changeClass: z.enum([
    'no_durable_schema_change',
    'backward_compatible_reader_change',
    'automatic_migration',
    'prompt_required_migration',
    'manual_migration',
    'breaking_schema_change',
  ]),
  existingDataImpact: z.string(),
  migrationId: z.string().nullable(),
  safety: z.enum(['automatic', 'prompt', 'manual', 'required', 'none']),
  requiredBeforeRun: z.boolean(),
  compatibilityReader: z.string(),
  fixturesAdded: z.array(z.string()).default([]),
  testsAdded: z.array(z.string()).default([]),
  ownerFacingPlanText: z.string(),
  rollbackRevertBehavior: z.string(),
})
export type SchemaMigrationDecision = z.infer<typeof SchemaMigrationDecision>

export const DELIVERY_SPINE_SCHEMA_DECISIONS: SchemaMigrationDecision[] = [
  {
    persistedSchemaTouched: 'guildhall-persistence:local_history/delivery-spine/project-delivery-model',
    scope: 'local_history',
    changeClass: 'backward_compatible_reader_change',
    existingDataImpact: 'Existing projects may not have a delivery-spine file. The runtime treats the missing file as an empty version 1 delivery model.',
    migrationId: null,
    safety: 'none',
    requiredBeforeRun: false,
    compatibilityReader: 'ProjectDeliveryModel supplies defaults for drivers, primitives, validation evidence, and rejected candidates.',
    fixturesAdded: ['delivery-spine.test.ts: old 0.9 task queue fixture'],
    testsAdded: ['delivery-spine.test.ts: loads old task queues and missing delivery-spine files without requiring a registered migration'],
    ownerFacingPlanText: 'No owner action is required; primitive state appears only after Guildhall validates and applies primitive setup or finished-work intake.',
    rollbackRevertBehavior: 'Remove the local-history delivery-spine persistence record or revert the applied contract change set; old task queues remain readable.',
  },
  {
    persistedSchemaTouched: 'project-state/TASKS.json:tasks[].delivery',
    scope: 'system_local_project_state',
    changeClass: 'backward_compatible_reader_change',
    existingDataImpact: 'Existing tasks do not have delivery metadata. The optional field remains absent until a validated split, primitive setup, or intake apply path writes it.',
    migrationId: null,
    safety: 'none',
    requiredBeforeRun: false,
    compatibilityReader: 'Task.delivery is optional and TaskDelivery defaults nested arrays only when the field exists.',
    fixturesAdded: ['delivery-spine.test.ts: old 0.9 task queue fixture'],
    testsAdded: ['delivery-spine.test.ts: loads old task queues and missing delivery-spine files without requiring a registered migration'],
    ownerFacingPlanText: 'No migration prompt is needed; old tasks continue to load and new delivery links are added only by validated runtime actions.',
    rollbackRevertBehavior: 'Remove task delivery fields written by the applied change set; tasks without delivery metadata still load normally.',
  },
  {
    persistedSchemaTouched: 'guildhall-persistence:local_history/delivery-spine/project-delivery-model:validationEvidence',
    scope: 'local_history',
    changeClass: 'backward_compatible_reader_change',
    existingDataImpact: 'Existing delivery-spine files may omit validation evidence. The reader normalizes the field to an empty array.',
    migrationId: null,
    safety: 'none',
    requiredBeforeRun: false,
    compatibilityReader: 'ProjectDeliveryModel defaults validationEvidence to an empty array.',
    fixturesAdded: ['delivery-spine.test.ts: old 0.9 task queue fixture'],
    testsAdded: ['delivery-spine.test.ts: records the schema migration decision for persisted primitive and delivery state'],
    ownerFacingPlanText: 'No owner action is required; validation evidence is appended only after a validator accepts an agent contract result.',
    rollbackRevertBehavior: 'Revert the applied contract result to remove validation evidence records associated with that result.',
  },
  {
    persistedSchemaTouched: 'guildhall-persistence:local_history/delivery-spine/project-delivery-model:finished-work-intake-derived-records',
    scope: 'local_history',
    changeClass: 'backward_compatible_reader_change',
    existingDataImpact: 'Finished-work intake contributes primitives, evidence, rejected candidates, and task links to existing optional/defaulted fields.',
    migrationId: null,
    safety: 'none',
    requiredBeforeRun: false,
    compatibilityReader: 'Finished-work intake applies through ProjectDeliveryModel and optional Task.delivery fields rather than introducing a required stored shape.',
    fixturesAdded: ['delivery-spine.test.ts: old 0.9 task queue fixture'],
    testsAdded: ['delivery-spine.test.ts: records the schema migration decision for persisted primitive and delivery state'],
    ownerFacingPlanText: 'No migration is required; intake results stay suggested or owner-reviewable until validated before apply.',
    rollbackRevertBehavior: 'Use revertAppliedContractResult or remove the intake-applied records identified by the validation evidence.',
  },
]

export function validateDeliverySpineSchemaDecisions(
  decisions: SchemaMigrationDecision[],
): { valid: boolean; errors: ValidationIssue[] } {
  const errors: ValidationIssue[] = []
  const seen = new Set<string>()
  decisions.forEach((decision, index) => {
    const pathPrefix = `schemaDecisions[${index}]`
    if (seen.has(decision.persistedSchemaTouched)) {
      errors.push(issue(`${pathPrefix}.persistedSchemaTouched`, 'duplicate_schema_decision', `Duplicate schema decision for ${decision.persistedSchemaTouched}.`))
    }
    seen.add(decision.persistedSchemaTouched)
    if (decision.scope !== 'none' && !decision.persistedSchemaTouched.trim()) {
      errors.push(issue(`${pathPrefix}.persistedSchemaTouched`, 'missing_persisted_schema', 'Persisted schema decisions must name the touched schema.'))
    }
    if (decision.changeClass === 'backward_compatible_reader_change') {
      if (decision.migrationId !== null) {
        errors.push(issue(`${pathPrefix}.migrationId`, 'unexpected_migration_id', 'Backward-compatible reader changes should not name a migration id.'))
      }
      if (decision.requiredBeforeRun) {
        errors.push(issue(`${pathPrefix}.requiredBeforeRun`, 'unexpected_required_migration', 'Backward-compatible reader changes must not block project start.'))
      }
      if (decision.fixturesAdded.length === 0) {
        errors.push(issue(`${pathPrefix}.fixturesAdded`, 'missing_old_data_fixture', 'Backward-compatible reader changes need an old-data fixture.'))
      }
    }
    if (
      ['automatic_migration', 'prompt_required_migration', 'manual_migration', 'breaking_schema_change'].includes(decision.changeClass) &&
      !decision.migrationId
    ) {
      errors.push(issue(`${pathPrefix}.migrationId`, 'missing_migration_id', 'Migration schema changes must name a registered migration id.'))
    }
  })
  return { valid: errors.length === 0, errors }
}

export interface ValidationIssue {
  path: string
  code: string
  message: string
}

export interface DeliveryModelValidation {
  valid: boolean
  normalized?: ProjectDeliveryModel
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

export interface PrimitiveWithRelations extends Primitive {
  consumers: Array<{ kind: 'task' | 'primitive'; id: string; title?: string }>
  provingTasks: Array<{ id: string; title: string; status: string }>
}

export interface TaskRelationshipSummary {
  task: Task
  hierarchy: {
    parent?: Pick<Task, 'id' | 'title' | 'status'>
    children: Array<Pick<Task, 'id' | 'title' | 'status'>>
    breadcrumbs: Array<Pick<Task, 'id' | 'title'>>
  }
  dependencies: {
    directBlockers: Array<Pick<Task, 'id' | 'title' | 'status'>>
    recursiveBlockers: Array<Pick<Task, 'id' | 'title' | 'status'>>
    blocks: Array<Pick<Task, 'id' | 'title' | 'status'>>
  }
  supports: string[]
  primitiveUse: {
    direct: PrimitiveWithRelations[]
    ancestors: PrimitiveWithRelations[]
    blockers: PrimitiveWithRelations[]
  }
  primitiveProof: {
    proves: PrimitiveWithRelations[]
    provingTasksByPrimitive: Record<string, Array<Pick<Task, 'id' | 'title' | 'status'>>>
  }
}

export interface TaskContextPacket {
  taskId: string
  generatedAt: string
  deliveryIntent: {
    driver?: DeliveryDriver
    provider?: DeliveryDriver
    containingPackage?: Pick<Task, 'id' | 'title' | 'status'>
    supports: string[]
  }
  executionOrder: TaskRelationshipSummary['dependencies'] & {
    runnableNow: boolean
    shapingBlockers: Array<{ code: string; summary: string }>
  }
  primitiveContext: {
    direct: PrimitiveWithRelations[]
    ancestors: PrimitiveWithRelations[]
    blockers: PrimitiveWithRelations[]
    invariants: Array<{ primitiveId: string; primitiveLabel: string; invariant: string }>
    paths: string[]
    consumers: Record<string, PrimitiveWithRelations['consumers']>
  }
  proofContext: {
    proofKind?: string
    requiredProof: Array<{ primitiveId: string; primitiveLabel: string; proof: string }>
    provesPrimitives: PrimitiveWithRelations[]
    existingEvidence: string[]
  }
  persona: {
    id: string
    label: string
    guardrails: string[]
  }
  whyThisNow: string
  correctionHooks: Array<{
    field: string
    label: string
    current?: unknown
  }>
}

export interface QueueCandidate {
  task: Task
  runnable: boolean
  executionBlockers: Array<Pick<Task, 'id' | 'title' | 'status'>>
  structuralBlockers: PrimitiveWithRelations[]
  suggestedPrimitiveProofTasks: SuggestedPrimitiveProofTask[]
  rank: number
  why: string
}

export interface QueueCandidateSummary {
  runnable: QueueCandidate[]
  blocked: QueueCandidate[]
  firstRunnable?: QueueCandidate
}

export interface SuggestedPrimitiveProofTask {
  primitiveId: string
  primitiveLabel: string
  title: string
  reason: string
  delivery: NonNullable<Task['delivery']>
}

export interface TaskSplitChildPlan {
  title: string
  reason: string
  plannedTaskId: string
  dependsOn: string[]
  delivery: NonNullable<Task['delivery']>
}

export interface TaskSplitPlan {
  parentTaskId: string
  action: 'split_recommended' | 'split_required' | 'decompose_before_execution'
  children: TaskSplitChildPlan[]
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

export const AgentContractApplyPolicy = z.enum(['auto_apply', 'owner_review', 'suggest_only'])
export type AgentContractApplyPolicy = z.infer<typeof AgentContractApplyPolicy>

export const ContractTaskPrimitiveLink = z.object({
  taskId: z.string(),
  usesPrimitives: z.array(z.string()).default([]),
  provesPrimitives: z.array(z.string()).default([]),
  proofKind: z.string().optional(),
})
export type ContractTaskPrimitiveLink = z.infer<typeof ContractTaskPrimitiveLink>

export const ProjectPrimitiveSetupResult = z.object({
  drivers: z.array(DeliveryDriver).default([]),
  primitives: z.array(Primitive).default([]),
  taskLinks: z.array(ContractTaskPrimitiveLink).default([]),
  evidenceRefs: z.array(z.string()).default([]),
  ownerQuestions: z.array(z.string()).default([]),
})
export type ProjectPrimitiveSetupResult = z.infer<typeof ProjectPrimitiveSetupResult>

export const PrimitiveEvidence = z.object({
  kind: z.string(),
  summary: z.string(),
  ref: z.string().optional(),
  path: z.string().optional(),
})
export type PrimitiveEvidence = z.infer<typeof PrimitiveEvidence>

export const FinishedWorkIntakeResult = z.object({
  shippedPackages: z.array(z.object({
    id: z.string(),
    label: z.string(),
    driver: z.string().optional(),
    provider: z.string().optional(),
    paths: z.array(z.string()).default([]),
    evidence: z.array(PrimitiveEvidence).default([]),
  })).default([]),
  primitives: z.array(Primitive).default([]),
  taskLinks: z.array(ContractTaskPrimitiveLink).default([]),
  observedProof: z.array(z.object({
    targetId: z.string(),
    targetKind: z.enum(['primitive', 'package']),
    proofKind: z.string(),
    evidence: z.array(PrimitiveEvidence).default([]),
    confidence: z.enum(['high', 'medium', 'low']),
  })).default([]),
  missingProof: z.array(z.object({
    targetId: z.string(),
    targetKind: z.enum(['primitive', 'package']),
    expectedProof: z.array(z.string()).default([]),
    reason: z.string(),
  })).default([]),
  futureTasks: z.array(z.object({
    title: z.string(),
    reason: z.string(),
    workKind: z.string(),
    usesPrimitives: z.array(z.string()).default([]),
    provesPrimitives: z.array(z.string()).default([]),
    acceptance: z.array(z.string()).default([]),
    evidence: z.array(PrimitiveEvidence).default([]),
  })).default([]),
  rejectedCandidates: z.array(z.record(z.unknown())).default([]),
  questions: z.array(z.string()).default([]),
})
export type FinishedWorkIntakeResult = z.infer<typeof FinishedWorkIntakeResult>

export type ContractChange =
  | { kind: 'create_driver'; driverId: string; after: DeliveryDriver }
  | { kind: 'update_driver'; driverId: string; before: DeliveryDriver; after: DeliveryDriver }
  | { kind: 'create_primitive'; primitiveId: string; after: Primitive }
  | { kind: 'update_primitive'; primitiveId: string; before: Primitive; after: Primitive }
  | { kind: 'merge_primitive'; primitiveId: string; mergeIntoPrimitiveId: string; after: Primitive }
  | { kind: 'link_task_primitives'; taskId: string; before?: Task['delivery']; after: NonNullable<Task['delivery']> }
  | { kind: 'owner_question'; question: string }

export interface ContractReviewBucket {
  kind: 'keep' | 'edit' | 'merge' | 'needs_proof' | 'not_a_primitive' | 'future_task' | 'owner_question'
  label: string
  changeIds: string[]
  reason: string
}

export interface ContractChangeSet {
  id: string
  contractId: string
  sourceResultId: string
  createdAt: string
  createdBy: string
  applyPolicy: AgentContractApplyPolicy
  status: 'pending_review' | 'auto_applicable' | 'suggested'
  summary: {
    drivers: number
    primitives: number
    taskLinks: number
    ownerQuestions: number
  }
  changes: ContractChange[]
  reviewBuckets: ContractReviewBucket[]
  evidenceRefs: string[]
  warnings: ValidationIssue[]
}

export interface AgentContractValidationResult<T = unknown> {
  id: string
  contractId: string
  validatorId: string
  valid: boolean
  createdAt: string
  createdBy: string
  applyPolicy: AgentContractApplyPolicy
  normalized?: T
  changeSet?: ContractChangeSet
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

interface AppliedContractEvidence {
  id: string
  resultId: string
  contractId: string
  status: 'applied' | 'reverted'
  actor: string
  appliedAt: string
  revertedAt?: string
  ownerOverrideReason?: string
  changeSet: ContractChangeSet
  previousValues: {
    drivers: Array<{ id: string; value?: DeliveryDriver }>
    primitives: Array<{ id: string; value?: Primitive }>
    taskDelivery: Array<{ taskId: string; value?: Task['delivery'] }>
  }
  afterValues: {
    drivers: Array<{ id: string; value?: DeliveryDriver }>
    primitives: Array<{ id: string; value?: Primitive }>
    taskDelivery: Array<{ taskId: string; value?: Task['delivery'] }>
  }
}

type TaskRef = Pick<Task, 'id' | 'title' | 'status'>

function defaultPersistence(): GuildhallPersistence {
  return new FileBackedGuildhallPersistence()
}

function deliverySpineRecordRef(
  projectRoot: string,
  persistence: Pick<GuildhallPersistence, 'recordRef'> = defaultPersistence(),
) {
  return persistence.recordRef({
    projectRoot,
    placement: DELIVERY_SPINE_PLACEMENT,
    collection: DELIVERY_SPINE_COLLECTION,
    id: DELIVERY_SPINE_RECORD_ID,
  })
}

export function projectDeliveryModelPath(projectRoot: string): string {
  return deliverySpineRecordRef(projectRoot).path
}

export async function readProjectDeliveryModel(
  projectRoot: string,
  persistence: Pick<GuildhallPersistence, 'recordRef' | 'readRecord'> = defaultPersistence(),
): Promise<ProjectDeliveryModel> {
  const record = await persistence.readRecord(deliverySpineRecordRef(projectRoot, persistence))
  if (!record) return emptyProjectDeliveryModel()
  return normalizeProjectDeliveryModelPaths(ProjectDeliveryModel.parse(record.payload), projectRoot).model
}

export function readProjectDeliveryModelSync(
  projectRoot: string,
  persistence: Pick<GuildhallPersistence, 'recordRef' | 'readRecordSync'> = defaultPersistence(),
): ProjectDeliveryModel {
  const record = persistence.readRecordSync(deliverySpineRecordRef(projectRoot, persistence))
  if (!record) return emptyProjectDeliveryModel()
  return normalizeProjectDeliveryModelPaths(ProjectDeliveryModel.parse(record.payload), projectRoot).model
}

export async function writeProjectDeliveryModel(
  projectRoot: string,
  model: ProjectDeliveryModel,
  persistence: Pick<GuildhallPersistence, 'writeRecord'> = defaultPersistence(),
): Promise<ProjectDeliveryModel> {
  const pathNormalized = normalizeProjectDeliveryModelPaths(ProjectDeliveryModel.parse(model), projectRoot).model
  const normalized = ProjectDeliveryModel.parse(pathNormalized)
  await persistence.writeRecord({
    projectRoot,
    placement: DELIVERY_SPINE_PLACEMENT,
    collection: DELIVERY_SPINE_COLLECTION,
    id: DELIVERY_SPINE_RECORD_ID,
    schemaName: DELIVERY_SPINE_SCHEMA_NAME,
    schemaVersion: DELIVERY_SPINE_SCHEMA_VERSION,
    createdBy: 'guildhall-runtime',
    payload: normalized,
  })
  return normalized
}

export function emptyProjectDeliveryModel(now = new Date().toISOString()): ProjectDeliveryModel {
  return {
    version: 1,
    updatedAt: now,
    drivers: [],
    primitives: [],
    validationEvidence: [],
    rejectedCandidates: [],
  }
}

export function validateProjectDeliveryModel(input: {
  model: ProjectDeliveryModel
  tasks?: Task[]
  projectRoot?: string
}): DeliveryModelValidation {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const pathNormalized = normalizeProjectDeliveryModelPaths(ProjectDeliveryModel.parse(input.model), input.projectRoot)
  const normalized = pathNormalized.model
  errors.push(...pathNormalized.errors)
  const driverIds = new Set<string>()
  const primitiveIds = new Set<string>()
  const primitiveByPath = new Map<string, string>()
  const primitiveByLabel = new Map<string, string>()

  for (const driver of normalized.drivers) {
    if (driverIds.has(driver.id)) {
      errors.push(issue(`drivers.${driver.id}`, 'duplicate_driver', `Driver ${driver.id} is duplicated.`))
    }
    driverIds.add(driver.id)
    for (const [index, driverPath] of driver.paths.entries()) {
      if (!isLocalRelativePath(driverPath)) {
        errors.push(issue(`drivers.${driver.id}.paths[${index}]`, 'invalid_path', `Driver path ${driverPath} must start with ./ and stay project-local.`))
      }
    }
  }

  for (const primitive of normalized.primitives) {
    if (primitiveIds.has(primitive.id)) {
      errors.push(issue(`primitives.${primitive.id}`, 'duplicate_primitive', `Primitive ${primitive.id} is duplicated.`))
    }
    primitiveIds.add(primitive.id)
    const labelKey = primitive.label.trim().toLowerCase()
    const existingLabel = primitiveByLabel.get(labelKey)
    if (existingLabel && existingLabel !== primitive.id) {
      warnings.push(issue(`primitives.${primitive.id}.label`, 'possible_duplicate_primitive', `Primitive label duplicates ${existingLabel}.`))
    }
    primitiveByLabel.set(labelKey, primitive.id)
    if (primitive.status === 'ready' && primitive.proof.length > 0 && primitive.evidence.length === 0) {
      errors.push(issue(`primitives.${primitive.id}.status`, 'ready_without_proof', `Primitive ${primitive.id} cannot be ready without evidence.`))
    }
    if (primitive.invariants.length === 0) {
      warnings.push(issue(`primitives.${primitive.id}.invariants`, 'missing_invariants', `Primitive ${primitive.id} has no observable invariants.`))
    }
    for (const [index, primitivePath] of primitive.paths.entries()) {
      if (!isLocalRelativePath(primitivePath)) {
        errors.push(issue(`primitives.${primitive.id}.paths[${index}]`, 'invalid_path', `Primitive path ${primitivePath} must start with ./ and stay project-local.`))
      }
      const owner = primitiveByPath.get(primitivePath)
      if (owner && owner !== primitive.id) {
        warnings.push(issue(`primitives.${primitive.id}.paths[${index}]`, 'duplicate_path_coverage', `Path ${primitivePath} is already covered by ${owner}.`))
      }
      primitiveByPath.set(primitivePath, primitive.id)
    }
    for (const [index, dependency] of primitive.dependsOn.entries()) {
      if (!primitiveIds.has(dependency) && !normalized.primitives.some(candidate => candidate.id === dependency)) {
        errors.push(issue(`primitives.${primitive.id}.dependsOn[${index}]`, 'unknown_primitive_reference', `Primitive ${primitive.id} depends on unknown primitive ${dependency}.`))
      }
    }
  }

  const cycle = detectPrimitiveCycle(normalized.primitives)
  if (cycle.length > 0) {
    errors.push(issue('primitives', 'cycle', `Primitive dependency cycle: ${cycle.join(' -> ')}.`))
  }

  for (const task of input.tasks ?? []) {
    const delivery = task.delivery
    if (!delivery) continue
    if (delivery.driver && !driverIds.has(delivery.driver)) {
      errors.push(issue(`tasks.${task.id}.delivery.driver`, 'unknown_driver_reference', `Task ${task.id} references unknown driver ${delivery.driver}.`))
    }
    if (delivery.provider && !driverIds.has(delivery.provider)) {
      errors.push(issue(`tasks.${task.id}.delivery.provider`, 'unknown_driver_reference', `Task ${task.id} references unknown provider ${delivery.provider}.`))
    }
    for (const [index, primitiveId] of (delivery.usesPrimitives ?? []).entries()) {
      if (!primitiveIds.has(primitiveId)) {
        errors.push(issue(`tasks.${task.id}.delivery.usesPrimitives[${index}]`, 'unknown_primitive_reference', `Task ${task.id} uses unknown primitive ${primitiveId}.`))
      }
    }
    for (const [index, primitiveId] of (delivery.provesPrimitives ?? []).entries()) {
      if (!primitiveIds.has(primitiveId)) {
        errors.push(issue(`tasks.${task.id}.delivery.provesPrimitives[${index}]`, 'unknown_primitive_reference', `Task ${task.id} proves unknown primitive ${primitiveId}.`))
      }
      const primitive = normalized.primitives.find(candidate => candidate.id === primitiveId)
      if (primitive && primitive.proof.length === 0 && !delivery.proofKind) {
        warnings.push(issue(`tasks.${task.id}.delivery.provesPrimitives[${index}]`, 'proof_without_expectation', `Task ${task.id} proves ${primitiveId}, but no proof expectation is named.`))
      }
    }
  }

  return {
    valid: errors.length === 0,
    ...(errors.length === 0 ? { normalized } : {}),
    errors,
    warnings,
  }
}

export function validateProjectPrimitiveSetupResult(input: {
  model: ProjectDeliveryModel
  tasks: Task[]
  result: unknown
  now?: string
  actor?: string
  contractId?: string
  applyPolicy?: AgentContractApplyPolicy
}): AgentContractValidationResult<ProjectPrimitiveSetupResult> {
  const now = input.now ?? new Date().toISOString()
  const contractId = input.contractId ?? 'project-primitive-setup'
  const actor = input.actor ?? 'agent'
  const applyPolicy = AgentContractApplyPolicy.parse(input.applyPolicy ?? 'owner_review')
  const parsed = ProjectPrimitiveSetupResult.safeParse(input.result)
  const resultId = contractResultId(contractId, now)
  if (!parsed.success) {
    return {
      id: resultId,
      contractId,
      validatorId: 'delivery-spine.project-primitive-setup.v1',
      valid: false,
      createdAt: now,
      createdBy: actor,
      applyPolicy,
      errors: parsed.error.issues.map(zodIssue => issue(
        zodIssue.path.join('.') || 'result',
        'schema_error',
        zodIssue.message,
      )),
      warnings: [],
    }
  }

  const normalized = parsed.data
  const simulatedTasks = applyTaskLinksForValidation(input.tasks, normalized.taskLinks)
  const candidateModel = ProjectDeliveryModel.parse({
    ...input.model,
    updatedAt: now,
    drivers: mergeDrivers(input.model.drivers, normalized.drivers),
    primitives: mergePrimitives(input.model.primitives, normalized.primitives),
  })
  const modelValidation = validateProjectDeliveryModel({
    model: candidateModel,
    tasks: simulatedTasks,
  })
  const taskLinkErrors = validateTaskLinks(input.tasks, normalized.taskLinks)
  const errors = [...modelValidation.errors, ...taskLinkErrors]
  const warnings = [...modelValidation.warnings]
  const changeSet = errors.length === 0
    ? buildPrimitiveSetupChangeSet({
      model: input.model,
      tasks: input.tasks,
      normalized,
      resultId,
      contractId,
      now,
      actor,
      applyPolicy,
      warnings,
    })
    : undefined

  return {
    id: resultId,
    contractId,
    validatorId: 'delivery-spine.project-primitive-setup.v1',
    valid: errors.length === 0,
    createdAt: now,
    createdBy: actor,
    applyPolicy,
    ...(errors.length === 0 ? { normalized, changeSet } : {}),
    errors,
    warnings,
  }
}

export function validateFinishedWorkIntakeResult(input: {
  model: ProjectDeliveryModel
  tasks: Task[]
  corpusRefs: string[]
  result: unknown
  now?: string
  actor?: string
  applyPolicy?: AgentContractApplyPolicy
}): AgentContractValidationResult<FinishedWorkIntakeResult> {
  const now = input.now ?? new Date().toISOString()
  const actor = input.actor ?? 'agent'
  const applyPolicy = AgentContractApplyPolicy.parse(input.applyPolicy ?? 'owner_review')
  const resultId = contractResultId('finished-work-intake', now)
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  if (input.corpusRefs.length === 0) {
    errors.push(issue('corpusRefs', 'missing_corpus_refs', 'Finished-work intake requires at least one corpus reference.'))
  }
  if (fabricatesCompletedGuildhallTasks(input.result)) {
    errors.push(issue('completedGuildhallTasks', 'fabricated_completed_task', 'Finished-work intake must not claim external work completed Guildhall tasks.'))
  }

  const parsed = FinishedWorkIntakeResult.safeParse(input.result)
  if (!parsed.success) {
    errors.push(...parsed.error.issues.map(zodIssue => issue(
      zodIssue.path.join('.') || 'result',
      'schema_error',
      zodIssue.message,
    )))
    return {
      id: resultId,
      contractId: 'finished-work-intake',
      validatorId: 'delivery-spine.finished-work-intake.v1',
      valid: false,
      createdAt: now,
      createdBy: actor,
      applyPolicy,
      errors,
      warnings,
    }
  }

  const normalized = normalizeFinishedWorkIntake(parsed.data)
  const observedProofByPrimitive = new Map<string, FinishedWorkIntakeResult['observedProof']>()
  for (const proof of normalized.observedProof.filter(proof => proof.targetKind === 'primitive')) {
    const entries = observedProofByPrimitive.get(proof.targetId) ?? []
    entries.push(proof)
    observedProofByPrimitive.set(proof.targetId, entries)
  }

  for (const primitive of normalized.primitives) {
    const observed = observedProofByPrimitive.get(primitive.id) ?? []
    const hasObservedEvidence = observed.some(proof => proof.evidence.length > 0 && proof.confidence !== 'low')
    if (primitive.status === 'ready' && primitive.evidence.length === 0 && !hasObservedEvidence) {
      errors.push(issue(`primitives.${primitive.id}.status`, 'ready_without_observed_proof', `Finished-work intake cannot mark ${primitive.id} ready without observed proof evidence.`))
    }
  }

  const simulatedTasks = applyTaskLinksForValidation(input.tasks, normalized.taskLinks)
  const candidateModel = ProjectDeliveryModel.parse({
    ...input.model,
    updatedAt: now,
    primitives: mergePrimitives(input.model.primitives, normalized.primitives),
  })
  const modelValidation = validateProjectDeliveryModel({ model: candidateModel, tasks: simulatedTasks })
  errors.push(...modelValidation.errors)
  warnings.push(...modelValidation.warnings)

  return {
    id: resultId,
    contractId: 'finished-work-intake',
    validatorId: 'delivery-spine.finished-work-intake.v1',
    valid: errors.length === 0,
    createdAt: now,
    createdBy: actor,
    applyPolicy,
    ...(errors.length === 0 ? { normalized } : {}),
    errors,
    warnings,
  }
}

export function planTaskSplit(input: {
  model: ProjectDeliveryModel
  tasks: Task[]
  taskId: string
}): TaskSplitPlan {
  const task = input.tasks.find(candidate => candidate.id === input.taskId)
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  if (!task) {
    return {
      parentTaskId: input.taskId,
      action: 'split_required',
      children: [],
      errors: [issue('taskId', 'unknown_task_reference', `Task ${input.taskId} was not found.`)],
      warnings,
    }
  }
  const sizePlan = task.sizePlan
  if (!sizePlan || !isDeliverySplitAction(sizePlan.action)) {
    return {
      parentTaskId: task.id,
      action: 'decompose_before_execution',
      children: [],
      errors: [issue(`tasks.${task.id}.sizePlan`, 'missing_split_plan', `Task ${task.id} does not have materializable decomposition work.`)],
      warnings,
    }
  }

  const primitiveIds = new Set(input.model.primitives.map(primitive => primitive.id))
  const recommendationToPlannedId = new Map<string, string>()
  const workUnitIdToPlannedId = new Map<string, string>()
  const children: TaskSplitChildPlan[] = []
  const recommendations = sizePlan.recommendedChildren.length > 0
    ? sizePlan.recommendedChildren
    : buildDecompositionChildDrafts({ task })
  if (recommendations.length === 0) {
    return {
      parentTaskId: task.id,
      action: sizePlan.action,
      children: [],
      errors: [issue(
        `tasks.${task.id}.workUnitAnalysis`,
        'missing_split_plan',
        `Task ${task.id} needs explicit work-unit analysis before Guildhall can materialize a split.`,
      )],
      warnings,
    }
  }
  const workUnits = task.workUnitAnalysis?.units ?? []
  for (const [index, recommendation] of recommendations.entries()) {
    const plannedTaskId = recommendation.createdTaskId ?? `${task.id}-split-${slugForId(recommendation.title)}`
    recommendationToPlannedId.set(normalizeKey(recommendation.title), plannedTaskId)
    const matchingUnit =
      workUnits[index]?.title === recommendation.title
        ? workUnits[index]
        : workUnits.find(unit => normalizeKey(unit.title) === normalizeKey(recommendation.title))
    if (matchingUnit?.id) workUnitIdToPlannedId.set(matchingUnit.id, plannedTaskId)
    const explicitUses = recommendation.usesPrimitives ?? []
    const inferredUses = explicitUses.length > 0
      ? explicitUses
      : inferPrimitiveRefsFromText({
        text: `${recommendation.title}\n${recommendation.reason}`,
        candidates: task.delivery?.usesPrimitives ?? [],
        model: input.model,
      })
    const provesPrimitives = recommendation.provesPrimitives ?? []
    const proofKind = recommendation.proofKind ?? inferProofKind(`${recommendation.title}\n${recommendation.reason}`)
    for (const [primitiveIndex, primitiveId] of [...inferredUses, ...provesPrimitives].entries()) {
      if (!primitiveIds.has(primitiveId)) {
        errors.push(issue(
          `tasks.${task.id}.sizePlan.recommendedChildren[${index}].primitiveRefs[${primitiveIndex}]`,
          'unknown_primitive_reference',
          `Split child "${recommendation.title}" references unknown primitive ${primitiveId}.`,
        ))
      }
    }
    const delivery: NonNullable<Task['delivery']> = {
      ...(task.delivery?.driver ? { driver: task.delivery.driver } : {}),
      ...(task.delivery?.provider ? { provider: task.delivery.provider } : {}),
      supports: unique([...(task.delivery?.supports ?? []), task.id]),
      usesPrimitives: unique(inferredUses),
      provesPrimitives: unique(provesPrimitives),
      ...(proofKind ? { proofKind } : {}),
    }
    if (delivery.provesPrimitives.length > 0 && !delivery.proofKind) {
      warnings.push(issue(
        `tasks.${task.id}.sizePlan.recommendedChildren[${index}].proofKind`,
        'proof_without_expectation',
        `Split child "${recommendation.title}" proves primitives but does not name a proof kind.`,
      ))
    }
    children.push({
      title: recommendation.title,
      reason: recommendation.reason,
      plannedTaskId,
      dependsOn: recommendation.dependsOn ?? [],
      delivery,
    })
  }
  const childProvingPrimitiveIds = new Set(children.flatMap(child => child.delivery.provesPrimitives))
  const existingProvingPrimitiveIds = new Set(input.tasks.flatMap(candidate => candidate.delivery?.provesPrimitives ?? []))
  const relationships = deriveTaskRelationships({ model: input.model, tasks: input.tasks, taskId: task.id })
  for (const primitive of relationships.primitiveUse.blockers) {
    if (childProvingPrimitiveIds.has(primitive.id) || existingProvingPrimitiveIds.has(primitive.id)) continue
    const proofKind = primitive.proof[0] ?? task.delivery?.proofKind ?? 'verification'
    const plannedTaskId = `${task.id}-split-prove-${slugForId(primitive.label)}`
    children.push({
      title: `Prove ${primitive.label} primitive`,
      reason: `${primitive.label} is required by ${task.title}, but it is not ready yet and no existing split child proves it.`,
      plannedTaskId,
      dependsOn: [],
      delivery: {
        ...(task.delivery?.driver ? { driver: task.delivery.driver } : {}),
        ...(task.delivery?.provider ? { provider: task.delivery.provider } : {}),
        supports: unique([...(task.delivery?.supports ?? []), task.id]),
        usesPrimitives: unique(primitive.dependsOn),
        provesPrimitives: [primitive.id],
        proofKind,
      },
    })
    childProvingPrimitiveIds.add(primitive.id)
  }

  return {
    parentTaskId: task.id,
    action: sizePlan.action,
    children: children.map(child => ({
      ...child,
      dependsOn: child.dependsOn.map(dependency =>
        workUnitIdToPlannedId.get(dependency) ??
        recommendationToPlannedId.get(normalizeKey(dependency)) ??
        dependency,
      ),
    })),
    errors,
    warnings,
  }
}

function isDeliverySplitAction(action: string): action is TaskSplitPlan['action'] {
  return action === 'split_recommended' ||
    action === 'split_required' ||
    action === 'decompose_before_execution'
}

export function applyFinishedWorkIntakeResult(input: {
  model: ProjectDeliveryModel
  tasks: Task[]
  corpusRefs: string[]
  result: unknown
  now?: string
  actor?: string
}): {
  model: ProjectDeliveryModel
  tasks: Task[]
  validation: AgentContractValidationResult<FinishedWorkIntakeResult>
} {
  const now = input.now ?? new Date().toISOString()
  const validation = validateFinishedWorkIntakeResult({
    model: input.model,
    tasks: input.tasks,
    corpusRefs: input.corpusRefs,
    result: input.result,
    now,
    actor: input.actor,
    applyPolicy: 'owner_review',
  })
  if (!validation.valid || !validation.normalized) {
    return { model: ProjectDeliveryModel.parse(input.model), tasks: cloneTasks(input.tasks), validation }
  }

  const model = ProjectDeliveryModel.parse(input.model)
  const normalized = validation.normalized
  for (const primitive of normalized.primitives) {
    upsertById(model.primitives, primitive)
  }
  model.updatedAt = now
  model.validationEvidence = [
    ...model.validationEvidence,
    {
      id: validation.id,
      resultId: validation.id,
      contractId: 'finished-work-intake',
      status: 'applied',
      actor: input.actor ?? 'agent',
      appliedAt: now,
      corpusRefs: input.corpusRefs,
      shippedPackages: normalized.shippedPackages,
      observedProof: normalized.observedProof,
      missingProof: normalized.missingProof,
      futureTasks: normalized.futureTasks,
      warnings: validation.warnings,
    },
  ]
  if (normalized.rejectedCandidates.length > 0) {
    model.rejectedCandidates = [
      ...model.rejectedCandidates,
      ...normalized.rejectedCandidates.map(candidate => ({
        ...candidate,
        contractId: 'finished-work-intake',
        resultId: validation.id,
        recordedAt: now,
      })),
    ]
  }
  return { model, tasks: cloneTasks(input.tasks), validation }
}

export function applyContractChangeSet(input: {
  model: ProjectDeliveryModel
  tasks: Task[]
  changeSet: ContractChangeSet
  now?: string
  actor?: string
  ownerOverrideReason?: string
}): { model: ProjectDeliveryModel; tasks: Task[]; applied: AppliedContractEvidence } {
  const now = input.now ?? new Date().toISOString()
  const actor = input.actor ?? 'owner'
  const model = ProjectDeliveryModel.parse(input.model)
  const tasks = cloneTasks(input.tasks)
  const previousValues: AppliedContractEvidence['previousValues'] = {
    drivers: [],
    primitives: [],
    taskDelivery: [],
  }

  for (const change of input.changeSet.changes) {
    if (change.kind === 'create_driver' || change.kind === 'update_driver') {
      previousValues.drivers.push({
        id: change.driverId,
        value: model.drivers.find(driver => driver.id === change.driverId),
      })
      upsertById(model.drivers, change.after)
      continue
    }
    if (change.kind === 'create_primitive' || change.kind === 'update_primitive' || change.kind === 'merge_primitive') {
      previousValues.primitives.push({
        id: change.primitiveId,
        value: model.primitives.find(primitive => primitive.id === change.primitiveId),
      })
      upsertById(model.primitives, change.after)
      continue
    }
    if (change.kind === 'link_task_primitives') {
      const task = tasks.find(candidate => candidate.id === change.taskId)
      if (!task) continue
      previousValues.taskDelivery.push({
        taskId: task.id,
        value: task.delivery,
      })
      task.delivery = change.after
      continue
    }
  }

  model.updatedAt = now
  const applied: AppliedContractEvidence = {
    id: input.changeSet.id,
    resultId: input.changeSet.sourceResultId,
    contractId: input.changeSet.contractId,
    status: 'applied',
    actor,
    appliedAt: now,
    ...(input.ownerOverrideReason ? { ownerOverrideReason: input.ownerOverrideReason } : {}),
    changeSet: input.changeSet,
    previousValues,
    afterValues: {
      drivers: previousValues.drivers.map(record => ({
        id: record.id,
        value: model.drivers.find(driver => driver.id === record.id),
      })),
      primitives: previousValues.primitives.map(record => ({
        id: record.id,
        value: model.primitives.find(primitive => primitive.id === record.id),
      })),
      taskDelivery: previousValues.taskDelivery.map(record => ({
        taskId: record.taskId,
        value: tasks.find(task => task.id === record.taskId)?.delivery,
      })),
    },
  }
  model.validationEvidence = [
    ...model.validationEvidence.filter(record => !isEvidenceForResult(record, input.changeSet.id)),
    applied as unknown as Record<string, unknown>,
  ]
  return { model, tasks, applied }
}

export function rejectContractChangeSet(input: {
  model: ProjectDeliveryModel
  changeSet: ContractChangeSet
  now?: string
  actor?: string
  reason: string
}): ProjectDeliveryModel {
  const now = input.now ?? new Date().toISOString()
  const model = ProjectDeliveryModel.parse(input.model)
  model.updatedAt = now
  model.rejectedCandidates = [
    ...model.rejectedCandidates,
    {
      resultId: input.changeSet.id,
      sourceResultId: input.changeSet.sourceResultId,
      contractId: input.changeSet.contractId,
      actor: input.actor ?? 'owner',
      rejectedAt: now,
      reason: input.reason,
      changes: input.changeSet.changes.map(change => summarizeChangeForRecord(change)),
    },
  ]
  return model
}

export function stageContractChangeSet(input: {
  model: ProjectDeliveryModel
  changeSet: ContractChangeSet
  now?: string
  actor?: string
}): ProjectDeliveryModel {
  const now = input.now ?? new Date().toISOString()
  const model = ProjectDeliveryModel.parse(input.model)
  model.updatedAt = now
  model.validationEvidence = [
    ...model.validationEvidence.filter(record => !isEvidenceForResult(record, input.changeSet.id)),
    {
      id: input.changeSet.id,
      resultId: input.changeSet.sourceResultId,
      contractId: input.changeSet.contractId,
      status: input.changeSet.status,
      actor: input.actor ?? input.changeSet.createdBy,
      createdAt: input.changeSet.createdAt,
      stagedAt: now,
      applyPolicy: input.changeSet.applyPolicy,
      summary: input.changeSet.summary,
      reviewBuckets: input.changeSet.reviewBuckets,
      warnings: input.changeSet.warnings,
      evidenceRefs: input.changeSet.evidenceRefs,
      changeSet: input.changeSet,
    },
  ]
  return model
}

export function revertAppliedContractResult(input: {
  model: ProjectDeliveryModel
  tasks: Task[]
  resultId: string
  now?: string
  actor?: string
}): { model: ProjectDeliveryModel; tasks: Task[]; warnings: ValidationIssue[] } {
  const now = input.now ?? new Date().toISOString()
  const model = ProjectDeliveryModel.parse(input.model)
  const tasks = cloneTasks(input.tasks)
  const warnings: ValidationIssue[] = []
  const evidence = model.validationEvidence
    .map(record => AppliedContractEvidenceSchema.safeParse(record))
    .find(record => record.success && record.data.id === input.resultId && record.data.status === 'applied')

  if (!evidence?.success) {
    return {
      model,
      tasks,
      warnings: [issue('validationEvidence', 'applied_result_not_found', `Applied contract result ${input.resultId} was not found.`)],
    }
  }

  const applied = evidence.data
  for (const record of applied.previousValues.drivers) {
    const current = model.drivers.find(driver => driver.id === record.id)
    const after = applied.afterValues.drivers.find(candidate => candidate.id === record.id)?.value
    if (!sameJson(current, after)) {
      warnings.push(issue(`drivers.${record.id}`, 'later_edit_preserved', `Driver ${record.id} changed after apply, so revert preserved it.`))
      continue
    }
    if (record.value) upsertById(model.drivers, record.value)
    else removeById(model.drivers, record.id)
  }

  for (const record of applied.previousValues.primitives) {
    const current = model.primitives.find(primitive => primitive.id === record.id)
    const after = applied.afterValues.primitives.find(candidate => candidate.id === record.id)?.value
    if (!sameJson(current, after)) {
      warnings.push(issue(`primitives.${record.id}`, 'later_edit_preserved', `Primitive ${record.id} changed after apply, so revert preserved it.`))
      continue
    }
    if (record.value) upsertById(model.primitives, record.value)
    else removeById(model.primitives, record.id)
  }

  for (const record of applied.previousValues.taskDelivery) {
    const task = tasks.find(candidate => candidate.id === record.taskId)
    if (!task) continue
    const after = applied.afterValues.taskDelivery.find(candidate => candidate.taskId === record.taskId)?.value
    if (!sameJson(task.delivery, after)) {
      warnings.push(issue(`tasks.${record.taskId}.delivery`, 'later_edit_preserved', `Task ${record.taskId} delivery changed after apply, so revert preserved it.`))
      continue
    }
    task.delivery = record.value
  }

  model.updatedAt = now
  model.validationEvidence = model.validationEvidence.map(record => (
    isEvidenceForResult(record, applied.id)
      ? {
        ...record,
        status: 'reverted',
        revertedAt: now,
        revertedBy: input.actor ?? 'owner',
        revertWarnings: warnings,
      }
      : record
  ))
  return { model, tasks, warnings }
}

const AppliedContractEvidenceSchema = z.object({
  id: z.string(),
  resultId: z.string(),
  contractId: z.string(),
  status: z.enum(['applied', 'reverted']),
  actor: z.string(),
  appliedAt: z.string(),
  revertedAt: z.string().optional(),
  ownerOverrideReason: z.string().optional(),
  changeSet: z.custom<ContractChangeSet>(),
  previousValues: z.object({
    drivers: z.array(z.object({ id: z.string(), value: DeliveryDriver.optional() })),
    primitives: z.array(z.object({ id: z.string(), value: Primitive.optional() })),
    taskDelivery: z.array(z.object({ taskId: z.string(), value: z.custom<Task['delivery']>().optional() })),
  }),
  afterValues: z.object({
    drivers: z.array(z.object({ id: z.string(), value: DeliveryDriver.optional() })),
    primitives: z.array(z.object({ id: z.string(), value: Primitive.optional() })),
    taskDelivery: z.array(z.object({ taskId: z.string(), value: z.custom<Task['delivery']>().optional() })),
  }),
})

function contractResultId(contractId: string, now: string): string {
  return `${contractId}-${now.replace(/[^0-9A-Za-z]/g, '').slice(0, 14)}`
}

function mergeDrivers(existing: DeliveryDriver[], proposed: DeliveryDriver[]): DeliveryDriver[] {
  const merged = [...existing]
  for (const driver of proposed) upsertById(merged, driver)
  return merged
}

function mergePrimitives(existing: Primitive[], proposed: Primitive[]): Primitive[] {
  const merged = [...existing]
  for (const primitive of proposed) upsertById(merged, primitive)
  return merged
}

function applyTaskLinksForValidation(tasks: Task[], taskLinks: ContractTaskPrimitiveLink[]): Task[] {
  const cloned = cloneTasks(tasks)
  for (const link of taskLinks) {
    const task = cloned.find(candidate => candidate.id === link.taskId)
    if (!task) continue
    task.delivery = taskDeliveryAfterLink(task.delivery, link)
  }
  return cloned
}

function validateTaskLinks(tasks: Task[], taskLinks: ContractTaskPrimitiveLink[]): ValidationIssue[] {
  const taskIds = new Set(tasks.map(task => task.id))
  return taskLinks
    .filter(link => !taskIds.has(link.taskId))
    .map(link => issue(`taskLinks.${link.taskId}`, 'unknown_task_reference', `Task link references unknown task ${link.taskId}.`))
}

function buildPrimitiveSetupChangeSet(input: {
  model: ProjectDeliveryModel
  tasks: Task[]
  normalized: ProjectPrimitiveSetupResult
  resultId: string
  contractId: string
  now: string
  actor: string
  applyPolicy: AgentContractApplyPolicy
  warnings: ValidationIssue[]
}): ContractChangeSet {
  const changes: ContractChange[] = []

  for (const driver of input.normalized.drivers) {
    const existing = input.model.drivers.find(candidate => candidate.id === driver.id)
    changes.push(existing
      ? { kind: 'update_driver', driverId: driver.id, before: existing, after: driver }
      : { kind: 'create_driver', driverId: driver.id, after: driver })
  }

  for (const primitive of input.normalized.primitives) {
    const existing = input.model.primitives.find(candidate => candidate.id === primitive.id)
    const duplicateByPath = input.model.primitives.find(candidate =>
      candidate.id !== primitive.id &&
      candidate.paths.some(existingPath => primitive.paths.includes(existingPath)))
    if (duplicateByPath && !existing) {
      changes.push({
        kind: 'merge_primitive',
        primitiveId: primitive.id,
        mergeIntoPrimitiveId: duplicateByPath.id,
        after: {
          ...duplicateByPath,
          aliases: unique([...(duplicateByPath.aliases ?? []), primitive.id, primitive.label]),
          evidence: unique([...(duplicateByPath.evidence ?? []), ...(primitive.evidence ?? [])]),
          invariants: unique([...(duplicateByPath.invariants ?? []), ...(primitive.invariants ?? [])]),
          proof: unique([...(duplicateByPath.proof ?? []), ...(primitive.proof ?? [])]),
          status: duplicateByPath.status === 'ready' ? duplicateByPath.status : primitive.status,
        },
      })
      continue
    }
    changes.push(existing
      ? { kind: 'update_primitive', primitiveId: primitive.id, before: existing, after: primitive }
      : {
          kind: 'create_primitive',
          primitiveId: primitive.id,
          after: {
            ...primitive,
            source: primitive.source ?? 'generated_from_contract',
          },
        })
  }

  for (const link of input.normalized.taskLinks) {
    const task = input.tasks.find(candidate => candidate.id === link.taskId)
    if (!task) continue
    changes.push({
      kind: 'link_task_primitives',
      taskId: task.id,
      before: task.delivery,
      after: taskDeliveryAfterLink(task.delivery, link),
    })
  }

  for (const question of input.normalized.ownerQuestions) {
    changes.push({ kind: 'owner_question', question })
  }

  const status: ContractChangeSet['status'] = input.applyPolicy === 'auto_apply'
    ? 'auto_applicable'
    : input.applyPolicy === 'suggest_only'
      ? 'suggested'
      : 'pending_review'
  return {
    id: input.resultId,
    contractId: input.contractId,
    sourceResultId: input.resultId,
    createdAt: input.now,
    createdBy: input.actor,
    applyPolicy: input.applyPolicy,
    status,
    summary: {
      drivers: input.normalized.drivers.length,
      primitives: input.normalized.primitives.length,
      taskLinks: input.normalized.taskLinks.length,
      ownerQuestions: input.normalized.ownerQuestions.length,
    },
    changes,
    reviewBuckets: buildReviewBuckets(changes),
    evidenceRefs: input.normalized.evidenceRefs,
    warnings: input.warnings,
  }
}

function taskDeliveryAfterLink(
  current: Task['delivery'],
  link: ContractTaskPrimitiveLink,
): NonNullable<Task['delivery']> {
  return {
    ...(current ?? {}),
    supports: [...(current?.supports ?? [])],
    usesPrimitives: unique([...(current?.usesPrimitives ?? []), ...link.usesPrimitives]),
    provesPrimitives: unique([...(current?.provesPrimitives ?? []), ...link.provesPrimitives]),
    ...(link.proofKind ? { proofKind: link.proofKind } : {}),
  }
}

function buildReviewBuckets(changes: ContractChange[]): ContractReviewBucket[] {
  const buckets: ContractReviewBucket[] = []
  const keepIds = changes
    .filter(change => ['create_driver', 'update_driver', 'create_primitive', 'update_primitive', 'link_task_primitives'].includes(change.kind))
    .map(changeId)
  if (keepIds.length > 0) {
    buckets.push({
      kind: 'keep',
      label: 'Keep',
      changeIds: keepIds,
      reason: 'Validated changes can be accepted into project delivery state.',
    })
  }
  const proofIds = changes
    .filter(change => (
      (change.kind === 'create_primitive' || change.kind === 'update_primitive' || change.kind === 'merge_primitive') &&
      change.after.status === 'needs_proof'
    ))
    .map(changeId)
  if (proofIds.length > 0) {
    buckets.push({
      kind: 'needs_proof',
      label: 'Needs proof',
      changeIds: proofIds,
      reason: 'These primitives can be tracked, but they stay blocked until proof or an owner waiver exists.',
    })
  }
  const mergeIds = changes
    .filter(change => change.kind === 'merge_primitive')
    .map(changeId)
  if (mergeIds.length > 0) {
    buckets.push({
      kind: 'merge',
      label: 'Merge',
      changeIds: mergeIds,
      reason: 'A proposed primitive overlaps an existing primitive and should be merged instead of duplicated.',
    })
  }
  const questionIds = changes
    .filter(change => change.kind === 'owner_question')
    .map(changeId)
  if (questionIds.length > 0) {
    buckets.push({
      kind: 'owner_question',
      label: 'Owner question',
      changeIds: questionIds,
      reason: 'The contract result needs an owner decision before it can shape work.',
    })
  }
  return buckets
}

function changeId(change: ContractChange): string {
  if (change.kind === 'create_driver' || change.kind === 'update_driver') return `driver:${change.driverId}`
  if (change.kind === 'create_primitive' || change.kind === 'update_primitive' || change.kind === 'merge_primitive') return `primitive:${change.primitiveId}`
  if (change.kind === 'link_task_primitives') return `task:${change.taskId}:delivery`
  return `owner-question:${change.question}`
}

function normalizeFinishedWorkIntake(result: FinishedWorkIntakeResult): FinishedWorkIntakeResult {
  const observedProofByPrimitive = new Map<string, FinishedWorkIntakeResult['observedProof']>()
  const missingProofIds = new Set<string>()
  for (const proof of result.observedProof.filter(proof => proof.targetKind === 'primitive')) {
    const entries = observedProofByPrimitive.get(proof.targetId) ?? []
    entries.push(proof)
    observedProofByPrimitive.set(proof.targetId, entries)
  }
  for (const missing of result.missingProof.filter(missing => missing.targetKind === 'primitive')) {
    missingProofIds.add(missing.targetId)
  }
  return {
    ...result,
    primitives: result.primitives.map(primitive => {
      const observedProof = observedProofByPrimitive.get(primitive.id) ?? []
      const evidence = unique([
        ...primitive.evidence,
        ...observedProof.flatMap(proof => proof.evidence.map(evidenceRef)),
      ])
      const proofKinds = unique([
        ...primitive.proof,
        ...observedProof.map(proof => proof.proofKind),
      ])
      return {
        ...primitive,
        source: primitive.source ?? 'import',
        evidence,
        proof: proofKinds,
        status: missingProofIds.has(primitive.id)
          ? 'needs_proof'
          : primitive.status === 'unknown' && observedProof.length > 0
            ? 'ready'
            : primitive.status,
      }
    }),
  }
}

function evidenceRef(evidence: PrimitiveEvidence): string {
  if (evidence.ref) return `${evidence.kind}:${evidence.ref}`
  if (evidence.path) return `${evidence.kind}:${evidence.path}`
  return `${evidence.kind}:${evidence.summary}`
}

function fabricatesCompletedGuildhallTasks(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const record = result as Record<string, unknown>
  if (Array.isArray(record.completedGuildhallTasks) && record.completedGuildhallTasks.length > 0) return true
  if (Array.isArray(record.completedTasks) && record.completedTasks.length > 0) return true
  if (Array.isArray(record.tasks)) {
    return record.tasks.some(task => (
      task &&
      typeof task === 'object' &&
      ((task as { status?: unknown }).status === 'done' || (task as { completed?: unknown }).completed === true)
    ))
  }
  return false
}

export function deriveTaskRelationships(input: {
  model: ProjectDeliveryModel
  tasks: Task[]
  taskId: string
}): TaskRelationshipSummary {
  const task = mustFindTask(input.tasks, input.taskId)
  const model = ProjectDeliveryModel.parse(input.model)
  const primitiveIndex = buildPrimitiveIndex(model, input.tasks)
  const directPrimitiveIds = unique(task.delivery?.usesPrimitives ?? [])
  const ancestorIds = expandPrimitiveAncestors(model, directPrimitiveIds)
  const direct = directPrimitiveIds.map(id => primitiveIndex.get(id)).filter(isPresent)
  const ancestors = ancestorIds.filter(id => !directPrimitiveIds.includes(id)).map(id => primitiveIndex.get(id)).filter(isPresent)
  const blockers = [...direct, ...ancestors].filter(primitive => primitive.status !== 'ready' && primitive.status !== 'deprecated')
  const proves = unique(task.delivery?.provesPrimitives ?? []).map(id => primitiveIndex.get(id)).filter(isPresent)
  const directBlockers = unique(task.dependsOn ?? []).map(id => findTaskRef(input.tasks, id)).filter(isPresent)
  const recursiveBlockers = expandTaskBlockers(input.tasks, task.id).map(id => findTaskRef(input.tasks, id)).filter(isPresent)
  const blocks = input.tasks
    .filter(candidate => candidate.id !== task.id && (candidate.dependsOn ?? []).includes(task.id))
    .map(toTaskRef)

  return {
    task,
    hierarchy: {
      ...(typeof task.hierarchy?.parentId === 'string'
        ? { parent: findTaskRef(input.tasks, task.hierarchy.parentId) }
        : {}),
      children: unique(task.hierarchy?.childIds ?? []).map(id => findTaskRef(input.tasks, id)).filter(isPresent),
      breadcrumbs: buildBreadcrumbs(input.tasks, task),
    },
    dependencies: {
      directBlockers,
      recursiveBlockers,
      blocks,
    },
    supports: unique(task.delivery?.supports ?? []),
    primitiveUse: {
      direct,
      ancestors,
      blockers,
    },
    primitiveProof: {
      proves,
      provingTasksByPrimitive: buildProvingTasksByPrimitive(input.tasks),
    },
  }
}

export function buildTaskContextPacket(input: {
  model: ProjectDeliveryModel
  tasks: Task[]
  taskId: string
  now?: string
}): TaskContextPacket {
  const relationships = deriveTaskRelationships(input)
  const task = relationships.task
  const driver = input.model.drivers.find(candidate => candidate.id === task.delivery?.driver)
  const provider = input.model.drivers.find(candidate => candidate.id === task.delivery?.provider)
  const primitiveSet = [...relationships.primitiveUse.direct, ...relationships.primitiveUse.ancestors]
  const invariants = primitiveSet.flatMap(primitive =>
    primitive.invariants.map(invariant => ({
      primitiveId: primitive.id,
      primitiveLabel: primitive.label,
      invariant,
    })),
  )
  const requiredProof = primitiveSet.flatMap(primitive =>
    primitive.proof.map(proof => ({
      primitiveId: primitive.id,
      primitiveLabel: primitive.label,
      proof,
    })),
  )
  const executionBlockers = relationships.dependencies.recursiveBlockers.filter(blocker => !isTerminalTaskStatus(blocker.status))
  const primitiveBlockers = relationships.primitiveUse.blockers
  const shapingBlockers = taskShapingBlockers(task)
  const persona = selectPersona(task, primitiveSet)
  const packageLabel = relationships.hierarchy.parent?.title ?? task.title
  const whyParts = [
    driver ? `${driver.label} is driving this work` : 'This task is next in the project queue',
    packageLabel ? `for ${packageLabel}` : '',
    executionBlockers.length > 0
      ? `after ${executionBlockers[0]?.title ?? executionBlockers[0]?.id} is resolved`
      : primitiveBlockers.length > 0
        ? `once ${primitiveBlockers[0]?.label ?? primitiveBlockers[0]?.id} has proof`
        : shapingBlockers.length > 0
          ? 'after Guildhall repairs the source-backed brief'
          : 'and it is runnable now',
  ].filter(Boolean)

  return {
    taskId: task.id,
    generatedAt: input.now ?? new Date().toISOString(),
    deliveryIntent: {
      ...(driver ? { driver } : {}),
      ...(provider ? { provider } : {}),
      ...(relationships.hierarchy.parent ? { containingPackage: relationships.hierarchy.parent } : {}),
      supports: relationships.supports,
    },
    executionOrder: {
      ...relationships.dependencies,
      runnableNow: executionBlockers.length === 0 && primitiveBlockers.length === 0 && shapingBlockers.length === 0,
      shapingBlockers,
    },
    primitiveContext: {
      direct: relationships.primitiveUse.direct,
      ancestors: relationships.primitiveUse.ancestors,
      blockers: primitiveBlockers,
      invariants,
      paths: unique(primitiveSet.flatMap(primitive => primitive.paths)),
      consumers: Object.fromEntries(primitiveSet.map(primitive => [primitive.id, primitive.consumers])),
    },
    proofContext: {
      ...(task.delivery?.proofKind ? { proofKind: task.delivery.proofKind } : {}),
      requiredProof,
      provesPrimitives: relationships.primitiveProof.proves,
      existingEvidence: unique(primitiveSet.flatMap(primitive => primitive.evidence)),
    },
    persona,
    whyThisNow: whyParts.join(' '),
    correctionHooks: [
      { field: 'delivery.driver', label: 'Change the driver', current: task.delivery?.driver },
      { field: 'delivery.provider', label: 'Change the provider', current: task.delivery?.provider },
      { field: 'delivery.usesPrimitives', label: 'Change used primitives', current: task.delivery?.usesPrimitives ?? [] },
      { field: 'dependsOn', label: 'Change task blockers', current: task.dependsOn ?? [] },
      { field: 'delivery.proofKind', label: 'Change proof kind', current: task.delivery?.proofKind },
    ],
  }
}

export function deriveQueueCandidates(input: {
  model: ProjectDeliveryModel
  tasks: Task[]
  activeDriverId?: string
}): QueueCandidateSummary {
  const driverPriority = buildDriverPriority(input.model)
  const candidates = input.tasks
    .filter(task => ['ready', 'in_progress', 'review', 'gate_check', 'spec_review', 'exploring', 'blocked'].includes(task.status))
    .map((task, index): QueueCandidate => {
      const relationships = deriveTaskRelationships({ ...input, taskId: task.id })
      const provingOwnBlockerIds = new Set(task.delivery?.provesPrimitives ?? [])
      const primitiveBlockers = relationships.primitiveUse.blockers
        .filter(primitive => !provingOwnBlockerIds.has(primitive.id))
      const primitiveProofTaskBlockers = primitiveBlockers
        .flatMap(primitive => relationships.primitiveProof.provingTasksByPrimitive[primitive.id] ?? [])
        .filter(provingTask =>
          provingTask.id !== task.id
          && !isTerminalTaskStatus(provingTask.status)
          && !expandTaskBlockers(input.tasks, provingTask.id).includes(task.id),
        )
      const primitiveProofTaskBlockerIds = new Set(primitiveProofTaskBlockers.map(blocker => blocker.id))
      const executionBlockers = uniqueTaskRefs([
        ...relationships.dependencies.recursiveBlockers.filter(blocker => !isTerminalTaskStatus(blocker.status)),
        ...primitiveProofTaskBlockers,
      ])
      const structuralBlockers = primitiveBlockers
        .filter(primitive => !primitive.provingTasks.some(provingTask => primitiveProofTaskBlockerIds.has(provingTask.id)))
      const suggestedPrimitiveProofTasks = structuralBlockers
        .filter(primitive => !primitive.provingTasks.some(provingTask => !isTerminalTaskStatus(provingTask.status)))
        .map(primitive => suggestedPrimitiveProofTask(task, primitive))
      const driverRank = input.activeDriverId && task.delivery?.driver === input.activeDriverId
        ? -10
        : driverPriority.get(task.delivery?.driver ?? '') ?? 50
      const proofBoost = (task.delivery?.provesPrimitives ?? []).length > 0 ? -5 : 0
      const rank = driverRank + proofBoost + executionBlockers.length * 10 + structuralBlockers.length * 20 + index
      const blockedByStatus = task.status === 'blocked'
      return {
        task,
        runnable: executionBlockers.length === 0 && structuralBlockers.length === 0 && !isTerminalTaskStatus(task.status) && !blockedByStatus,
        executionBlockers,
        structuralBlockers,
        suggestedPrimitiveProofTasks,
        rank,
        why: blockedByStatus
          ? 'Blocked by task status.'
          : executionBlockers.length > 0
          ? `Blocked by ${executionBlockers[0]?.title ?? executionBlockers[0]?.id}.`
          : structuralBlockers.length > 0
            ? `Blocked until ${structuralBlockers[0]?.label ?? structuralBlockers[0]?.id} has proof.`
            : task.delivery?.provesPrimitives?.length
              ? 'Runnable proof work for primitives.'
              : 'Runnable project work.',
      }
    })
    .sort((left, right) => left.rank - right.rank)
  const runnable = candidates.filter(candidate => candidate.runnable)
  const blocked = candidates.filter(candidate => !candidate.runnable)
  return {
    runnable,
    blocked,
    ...(runnable[0] ? { firstRunnable: runnable[0] } : {}),
  }
}

export function listPrimitivesWithRelations(model: ProjectDeliveryModel, tasks: Task[]): PrimitiveWithRelations[] {
  const index = buildPrimitiveIndex(model, tasks)
  return model.primitives.map(primitive => index.get(primitive.id)).filter(isPresent)
}

function buildPrimitiveIndex(model: ProjectDeliveryModel, tasks: Task[]): Map<string, PrimitiveWithRelations> {
  const provingTasks = buildProvingTasksByPrimitive(tasks)
  const consumers = buildPrimitiveConsumers(model, tasks)
  return new Map(model.primitives.map(primitive => [
    primitive.id,
    {
      ...primitive,
      consumers: consumers[primitive.id] ?? [],
      provingTasks: provingTasks[primitive.id] ?? [],
    },
  ]))
}

function buildPrimitiveConsumers(model: ProjectDeliveryModel, tasks: Task[]): Record<string, PrimitiveWithRelations['consumers']> {
  const consumers: Record<string, PrimitiveWithRelations['consumers']> = {}
  for (const task of tasks) {
    for (const primitiveId of task.delivery?.usesPrimitives ?? []) {
      consumers[primitiveId] ??= []
      consumers[primitiveId]!.push({ kind: 'task', id: task.id, title: task.title })
    }
  }
  for (const primitive of model.primitives) {
    for (const primitiveId of primitive.dependsOn) {
      consumers[primitiveId] ??= []
      consumers[primitiveId]!.push({ kind: 'primitive', id: primitive.id, title: primitive.label })
    }
  }
  return consumers
}

function buildProvingTasksByPrimitive(tasks: Task[]): Record<string, Array<Pick<Task, 'id' | 'title' | 'status'>>> {
  const provingTasks: Record<string, Array<Pick<Task, 'id' | 'title' | 'status'>>> = {}
  for (const task of tasks) {
    for (const primitiveId of task.delivery?.provesPrimitives ?? []) {
      provingTasks[primitiveId] ??= []
      provingTasks[primitiveId]!.push(toTaskRef(task))
    }
  }
  return provingTasks
}

function expandPrimitiveAncestors(model: ProjectDeliveryModel, primitiveIds: string[]): string[] {
  const byId = new Map(model.primitives.map(primitive => [primitive.id, primitive]))
  const result: string[] = []
  const seen = new Set<string>()
  const visit = (primitiveId: string) => {
    const primitive = byId.get(primitiveId)
    if (!primitive) return
    for (const dependency of primitive.dependsOn) {
      if (seen.has(dependency)) continue
      seen.add(dependency)
      result.push(dependency)
      visit(dependency)
    }
  }
  for (const primitiveId of primitiveIds) visit(primitiveId)
  return result
}

function expandTaskBlockers(tasks: Task[], taskId: string): string[] {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const result: string[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    const task = byId.get(id)
    if (!task) return
    for (const dependency of task.dependsOn ?? []) {
      if (seen.has(dependency)) continue
      seen.add(dependency)
      result.push(dependency)
      visit(dependency)
    }
  }
  visit(taskId)
  return result
}

function buildBreadcrumbs(tasks: Task[], task: Task): Array<Pick<Task, 'id' | 'title'>> {
  const byId = new Map(tasks.map(candidate => [candidate.id, candidate]))
  const result: Array<Pick<Task, 'id' | 'title'>> = [{ id: task.id, title: task.title }]
  let parentId = task.hierarchy?.parentId
  const seen = new Set<string>([task.id])
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    result.unshift({ id: parent.id, title: parent.title })
    parentId = parent.hierarchy?.parentId
  }
  return result
}

function detectPrimitiveCycle(primitives: Primitive[]): string[] {
  const byId = new Map(primitives.map(primitive => [primitive.id, primitive]))
  const stack: string[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): string[] => {
    if (visiting.has(id)) return [...stack.slice(stack.indexOf(id)), id]
    if (visited.has(id)) return []
    const primitive = byId.get(id)
    if (!primitive) return []
    visiting.add(id)
    stack.push(id)
    for (const dependency of primitive.dependsOn) {
      const cycle = visit(dependency)
      if (cycle.length > 0) return cycle
    }
    stack.pop()
    visiting.delete(id)
    visited.add(id)
    return []
  }
  for (const primitive of primitives) {
    const cycle = visit(primitive.id)
    if (cycle.length > 0) return cycle
  }
  return []
}

function selectPersona(task: Task, primitives: Primitive[]): TaskContextPacket['persona'] {
  if (primitives.some(primitive => primitive.kind === 'security_primitive')) {
    return {
      id: 'security-primitive',
      label: 'Security primitive',
      guardrails: ['Preserve auth and permission invariants.', 'Prove denial and escalation paths.', 'Avoid widening access while unblocking delivery.'],
    }
  }
  if (primitives.some(primitive => primitive.kind === 'data_primitive')) {
    return {
      id: 'data-primitive',
      label: 'Data primitive',
      guardrails: ['Preserve schema compatibility.', 'Prove migrations and rollback expectations.', 'Keep data ownership explicit.'],
    }
  }
  if (primitives.some(primitive => primitive.kind === 'runtime_primitive')) {
    return {
      id: 'runtime-primitive',
      label: 'Runtime primitive',
      guardrails: ['Preserve service startup and shutdown behavior.', 'Prove runtime health checks.', 'Keep recovery steps operator-readable.'],
    }
  }
  if (task.workKind === 'primitive' || (task.delivery?.provesPrimitives ?? []).length > 0) {
    return {
      id: 'primitive-hardening',
      label: 'Primitive hardening',
      guardrails: ['Preserve invariants.', 'Prove reusable behavior.', 'Check downstream consumers before changing APIs.'],
    }
  }
  if (task.workKind === 'story' || task.delivery?.proofKind === 'storybook') {
    return {
      id: 'proof',
      label: 'Proof',
      guardrails: ['Demonstrate states and interactions.', 'Verify the proof exercises the package and relevant primitives.'],
    }
  }
  if (task.workKind === 'component' || primitives.some(primitive => primitive.kind === 'ui_primitive')) {
    return {
      id: 'component-delivery',
      label: 'Component delivery',
      guardrails: ['Compose existing primitives.', 'Avoid style sprawl.', 'Add story or interaction proof when missing.'],
    }
  }
  return {
    id: 'delivery',
    label: 'Delivery',
    guardrails: ['Respect task dependencies.', 'Keep proof attached to the work.', 'Record corrections when assumptions are wrong.'],
  }
}

function suggestedPrimitiveProofTask(task: Task, primitive: PrimitiveWithRelations): SuggestedPrimitiveProofTask {
  const proofKind = primitive.proof[0] ?? task.delivery?.proofKind ?? 'verification'
  return {
    primitiveId: primitive.id,
    primitiveLabel: primitive.label,
    title: `Prove ${primitive.label} primitive`,
    reason: `${primitive.label} blocks ${task.title} until ${proofKind} proof is attached.`,
    delivery: {
      ...(task.delivery?.driver ? { driver: task.delivery.driver } : {}),
      ...(task.delivery?.provider ? { provider: task.delivery.provider } : {}),
      supports: unique([...(task.delivery?.supports ?? []), task.id]),
      usesPrimitives: unique(primitive.dependsOn),
      provesPrimitives: [primitive.id],
      proofKind,
    },
  }
}

function buildDriverPriority(model: ProjectDeliveryModel): Map<string, number> {
  const roleRank: Record<DeliveryDriverRole, number> = {
    primary: 0,
    secondary: 10,
    provider: 20,
    proof: 30,
    maintenance: 40,
  }
  return new Map(model.drivers.map((driver, index) => [driver.id, roleRank[driver.role] + index]))
}

function mustFindTask(tasks: Task[], taskId: string): Task {
  const task = tasks.find(candidate => candidate.id === taskId)
  if (!task) throw new Error(`Task ${taskId} not found.`)
  return task
}

function findTaskRef(tasks: Task[], taskId: string): TaskRef | undefined {
  const task = tasks.find(candidate => candidate.id === taskId)
  return task ? toTaskRef(task) : undefined
}

function toTaskRef(task: Task): TaskRef {
  return { id: task.id, title: task.title, status: task.status }
}

function isTerminalTaskStatus(status: string | undefined): boolean {
  return status === 'done' || status === 'shelved'
}

function normalizeProjectDeliveryModelPaths(
  model: ProjectDeliveryModel,
  projectRoot?: string,
): { model: ProjectDeliveryModel; errors: ValidationIssue[] } {
  const errors: ValidationIssue[] = []
  const normalized = ProjectDeliveryModel.parse({
    ...model,
    drivers: model.drivers.map(driver => ({
      ...driver,
      paths: driver.paths.map((driverPath, index) => {
        const normalizedPath = normalizeProjectPathHint(driverPath, projectRoot)
        if (!normalizedPath) {
          errors.push(issue(`drivers.${driver.id}.paths[${index}]`, 'invalid_path', `Driver path ${driverPath} must stay project-local.`))
          return driverPath
        }
        return normalizedPath
      }),
    })),
    primitives: model.primitives.map(primitive => ({
      ...primitive,
      paths: primitive.paths.map((primitivePath, index) => {
        const normalizedPath = normalizeProjectPathHint(primitivePath, projectRoot)
        if (!normalizedPath) {
          errors.push(issue(`primitives.${primitive.id}.paths[${index}]`, 'invalid_path', `Primitive path ${primitivePath} must stay project-local.`))
          return primitivePath
        }
        return normalizedPath
      }),
    })),
  })
  return { model: normalized, errors }
}

function normalizeProjectPathHint(value: string, projectRoot?: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (path.isAbsolute(trimmed)) {
    if (!projectRoot) return null
    const relativePath = path.relative(projectRoot, trimmed).split(path.sep).join('/')
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null
    return `./${relativePath}`
  }
  const withoutDot = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed
  const parts = withoutDot.split(/[\\/]+/).filter(Boolean)
  if (parts.length === 0 || parts.includes('..') || withoutDot.startsWith('../')) return null
  return `./${parts.join('/')}`
}

function isLocalRelativePath(value: string): boolean {
  return value.startsWith('./') && !value.includes('..') && !path.isAbsolute(value)
}

function inferPrimitiveRefsFromText(input: {
  text: string
  candidates: string[]
  model: ProjectDeliveryModel
}): string[] {
  return input.candidates.filter((primitiveId) => {
    const primitive = input.model.primitives.find(candidate => candidate.id === primitiveId)
    const needles = [
      primitiveId,
      primitive?.label,
      ...(primitive?.aliases ?? []),
    ].filter((value): value is string => Boolean(value && value.trim()))
    return needles.some(needle => textContainsNeedle(input.text, needle))
  })
}

function textContainsNeedle(text: string, needle: string): boolean {
  const normalizedNeedle = needle.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!normalizedNeedle) return false
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some(token => token === normalizedNeedle)
}

function inferProofKind(text: string): string | undefined {
  if (/\bstorybook|visual proof|screenshot\b/i.test(text)) return 'storybook'
  if (/\binteraction|keyboard|focus|hover\b/i.test(text)) return 'interaction'
  if (/\be2e|end[- ]to[- ]end|browser\b/i.test(text)) return 'e2e'
  if (/\bunit\b/i.test(text)) return 'unit'
  if (/\bbuild|typecheck|compile\b/i.test(text)) return 'build'
  return undefined
}

function slugForId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'child'
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function uniqueTaskRefs<T extends { id?: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    const id = item.id
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(item)
  }
  return result
}

function cloneTasks(tasks: Task[]): Task[] {
  return tasks.map(task => ({
    ...task,
    delivery: task.delivery ? { ...task.delivery } : task.delivery,
    dependsOn: [...(task.dependsOn ?? [])],
    acceptanceCriteria: [...(task.acceptanceCriteria ?? [])],
    outOfScope: [...(task.outOfScope ?? [])],
    notes: [...(task.notes ?? [])],
    gateResults: [...(task.gateResults ?? [])],
    reviewVerdicts: [...(task.reviewVerdicts ?? [])],
    adjudications: [...(task.adjudications ?? [])],
    escalations: [...(task.escalations ?? [])],
    agentIssues: [...(task.agentIssues ?? [])],
  }))
}

function upsertById<T extends { id: string }>(records: T[], next: T): void {
  const index = records.findIndex(record => record.id === next.id)
  if (index >= 0) records[index] = next
  else records.push(next)
}

function removeById<T extends { id: string }>(records: T[], id: string): void {
  const index = records.findIndex(record => record.id === id)
  if (index >= 0) records.splice(index, 1)
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function isEvidenceForResult(record: Record<string, unknown>, resultId: string): boolean {
  return typeof record.id === 'string' && record.id === resultId
}

function summarizeChangeForRecord(change: ContractChange): Record<string, unknown> {
  if (change.kind === 'create_driver' || change.kind === 'update_driver') {
    return { kind: change.kind, driverId: change.driverId }
  }
  if (change.kind === 'create_primitive' || change.kind === 'update_primitive') {
    return { kind: change.kind, primitiveId: change.primitiveId }
  }
  if (change.kind === 'merge_primitive') {
    return { kind: change.kind, primitiveId: change.primitiveId, mergeIntoPrimitiveId: change.mergeIntoPrimitiveId }
  }
  if (change.kind === 'link_task_primitives') {
    return { kind: change.kind, taskId: change.taskId }
  }
  return { kind: change.kind, question: change.question }
}

function isPresent<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message }
}
