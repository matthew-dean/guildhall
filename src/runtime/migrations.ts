import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  migrateProjectProvidersToGlobal,
  readProjectConfig,
  readWorkspaceConfig,
  updateProjectConfig,
} from '@guildhall/config'
import {
  getProjectLocalHistoryDir,
  getProjectStateDir,
  getProjectSystemStatePath,
  hasLegacyProjectLiveState,
  migrateLegacyProjectLiveState,
  compressProjectStateDetailStore,
  projectStateDatabaseCompressedDetailPathFromTasksPath,
  projectStateDatabaseDetailPathFromTasksPath,
  projectStateDatabasePath,
  PROJECT_STATE_DATABASE_SCHEMA_VERSION,
  markProjectStateDatabaseStale,
  readProjectStateDatabaseMetadata,
  readProjectStateDatabaseAuthority,
  readProjectStateDatabaseReadBundle,
  hasProjectStateDatabaseDecisionSnapshot,
  readProjectStateDatabaseQueueDefinitionForMigration,
  readProjectStateDatabaseQueueWithRevision,
  readProjectStateDatabaseInventory,
  readProjectStateDatabaseDiagnosticProjection,
  readProjectStateDatabaseSummary,
  migrateProjectStateDatabaseQueueDetail,
  migrateProjectStateDatabaseWorkItemDetails,
  migrateProjectStateDatabaseReleaseMembership,
  retireProjectStateDatabaseReleaseMembershipMirrors,
  migrateProjectStateDatabaseCompactReadModels,
  repairProjectStateDatabaseStoredRequestTitles,
  readProjectStateDatabaseStoredRequestTitleRepairStatus,
  readProjectStateDatabaseCompactReadModelStatus,
  readProjectStateDatabaseCurrentProofReadModelStatus,
  readProjectStateDatabaseReleaseMembershipStatus,
  readProjectStateDatabaseThreadHistoryStorePresent,
  clearProjectStateDatabaseQueueDetail,
  ensureProjectStateDatabaseCurrentThreadStore,
  ensureProjectStateDatabaseThreadHistoryStore,
  writeProjectStateDatabaseSummarySnapshot,
  updateProjectStateDatabaseSummary,
  promoteProjectStateDatabaseAuthority,
  compactProjectStateDatabaseEvidence,
  vacuumProjectStateDatabase,
  readProjectStateDatabaseTaskEvidenceAuthority,
  readProjectStateDatabaseTaskEvidenceOutbox,
  readProjectStateDatabaseTaskOverlayStores,
  readTaskRuntimeStore,
  replaceProjectStateDatabaseTaskRuntimes,
  upsertTaskRuntimeState,
  rewriteProjectStateDatabaseTaskSummaries,
  projectStateDatabaseTaskSummary,
  writeProjectStateDatabaseDiagnosticProjection,
  writeProjectStateDatabaseTaskBatchMutation,
} from '@guildhall/sessions'
import type { ProjectStateDatabaseScopeRow } from '@guildhall/sessions'
import { Task as TaskSchema, TaskQueue, TaskRuntimeState, type ProjectRelease, type TaskQueue as TaskQueueModel } from '@guildhall/core'
import { installAgentBridgeInstructions } from './agent-bridge-install.js'
import { migrateLegacyMemoryToLocalHistory } from './memory-migration.js'
import { compactProjectState } from './project-state-compaction.js'
import { migrateTaskQuestionsToBoundedChat } from './task-question-migration.js'
import { migrateTaskHierarchyState } from './task-hierarchy-migration.js'
import { migrateTaskDeliveryStepState } from './task-delivery-step-migration.js'
import { migrateTaskState } from './task-state-migration.js'
import { normalizeLegacyTaskQueueForMigration } from './task-queue-migration.js'
import {
  backfillTaskEvidenceCurrent,
  backfillTaskStateDatabaseOverlays,
  migrateDatabaseTaskEvidenceHistoryToCompressed,
  migrateLegacyTaskEvidenceHistoryToDatabase,
  appendTaskEvidence,
  flushTaskEvidenceOutboxForTasksPath,
  TASK_EVIDENCE_RETENTION,
  runtimeStatePath,
  taskWorkspaceStatePath,
} from '@guildhall/sessions'
import { repairOwnerInputState } from './owner-input-state-repair.js'
import { listOwnerInputRequestsSync, refreshOwnerInputProjection } from './owner-input-store.js'
import { recordGuildhallRuntimeWrite } from './runtime-compatibility.js'
import { readProjectRuntimeState } from './project-runtime-store.js'
import {
  hasLegacyRuntimeCommandEvidence,
  migrateLegacyRuntimeCommandEvidenceToPersistence,
} from './project-runtime-command.js'
import { finalizeThinProjectStateManifest } from './thin-project-state-manifest.js'
import { restoreEvacuatedTaskState } from './evacuated-task-state-restore.js'
import { migrateWorkDecompositionState } from './work-decomposition-migration.js'
import { validateSpecCompletionBoundary } from './spec-quality.js'
import { buildProjectScopeProjection, deriveReleaseContainersFromTaskMembership } from './project-scope-projection.js'
import { readProjectReleaseState } from './project-state-boundary.js'
import { buildEffectiveTasks } from './effective-task.js'
import {
  backfillProjectSummaryProjection,
  buildProjectSummaryProjectionFromIndexedState,
  PROJECT_SUMMARY_PROJECTION_VERSION,
  projectSummaryProjectionIsCurrent,
  projectSummaryProjectionNeedsBackfill,
  projectSummaryProjectionPath,
  materializeApprovedPlanReleaseMembership,
  prepareProjectSummaryProjectionFromUnknownQueue,
  readProjectSummaryProjection,
  readProjectSummaryProjectionForMigration,
  writeProjectSummaryProjectionFromIndexedState,
} from './project-summary-projection.js'
import { readProjectCanonicalCurrentState, writeProjectTaskQueueWithSummary, writePromotedTaskDetailMutation } from './project-state-boundary.js'
import { deliveryReadProjectionSchemaPresent, ensureDeliveryReadProjectionSchema } from './delivery-read-projection.js'
import { effectiveTaskTitle } from '@guildhall/shared'
import { ensureCommandProofPathsFromAcceptanceCriteria, isConcreteProjectProofCommand, proofIdentityMarkerForTask, replaceGenericProjectProofPathsWithSetup } from './proof-paths.js'
import type { Task } from '@guildhall/core'
import { buildProofSetupTaskContract, isProofSetupTask, materializeProofSetupTask } from '@guildhall/tools'
import { taskDoneButProofMissing, taskDoneButProofMissingForScope, taskHasScriptProofPath } from './proof-health.js'
import {
  inspectEmptyMastraDatabase,
  inspectEmptyMastraThreadShells,
  removeEmptyMastraThreadShells,
  retireEmptyMastraDatabase,
} from '@guildhall/memory-core'
import { migrateHistoricalProofPathEvidence } from './historical-proof-path-evidence-migration.js'

export type MigrationScope = 'machine' | 'project' | 'workspace' | 'database'
export type MigrationSafety = 'automatic' | 'prompt' | 'manual' | 'required'
export type MigrationRequirement = 'optional' | 'required'
export type MigrationLedgerStatus = 'applied' | 'failed' | 'skipped'

export interface MigrationLedgerRecord {
  id: string
  introducedIn: string
  scope: MigrationScope
  safety: MigrationSafety
  status: MigrationLedgerStatus
  appliedAt: string
  appliedByVersion: string
  summary: string
  error?: string
  affectedPaths?: string[]
}

export interface ProjectMigrationLedger {
  version: 1
  records: MigrationLedgerRecord[]
}

export interface ProjectMigrationStatusItem {
  id: string
  title: string
  introducedIn: string
  scope: MigrationScope
  safety: MigrationSafety
  requirement?: MigrationRequirement
  summary: string
  affectedPaths: string[]
  applied?: MigrationLedgerRecord
}

export interface ProjectMigrationStatus {
  projectRoot: string
  pending: ProjectMigrationStatusItem[]
  applied: ProjectMigrationStatusItem[]
  blocked: ProjectMigrationStatusItem[]
}

interface ProjectMigrationDefinition {
  id: string
  title: string
  introducedIn: string
  scope: 'project'
  safety: MigrationSafety
  requirement?: MigrationRequirement
  /** Reconciliation migrations may become needed again when new state arrives. */
  recheckAfterApply?: boolean
  summary: string
  detect: (projectRoot: string) => Promise<{ needed: boolean; affectedPaths?: string[] }>
  apply: (projectRoot: string) => Promise<{ summary: string; affectedPaths?: string[] }>
}

export interface ApplyProjectMigrationsResult {
  applied: ProjectMigrationStatusItem[]
  skipped: ProjectMigrationStatusItem[]
  failed: Array<ProjectMigrationStatusItem & { error: string }>
}

function ledgerPath(projectRoot: string): string {
  return path.join(getProjectLocalHistoryDir(projectRoot), 'migrations', 'migrations.json')
}

function repoStateMode(projectRoot: string): 'off' | 'thin' {
  try {
    return readWorkspaceConfig(projectRoot).storage?.repoState === 'thin' ? 'thin' : 'off'
  } catch {
    return 'off'
  }
}

function agentSettingsPath(projectRoot: string): string {
  return path.join(projectRoot, '.guildhall', 'agent-settings.yaml')
}

async function projectStateEntries(projectRoot: string): Promise<string[]> {
  try {
    return await fs.readdir(getProjectStateDir(projectRoot))
  } catch {
    return []
  }
}

const FINAL_PROJECT_STATE_MIGRATION_ID = '0.13.0/project-state-finalize'
const LEGACY_LIVE_STATE_CLEANUP_MIGRATION_ID = '0.13.0/project-state-legacy-live-file-cleanup'
const EFFECTIVE_STATE_REALIGNMENT_MIGRATION_ID = '0.13.0/project-summary-effective-state-realignment'
const CURRENT_STATUS_PROJECTION_MIGRATION_ID = '0.13.1/project-current-status-projection'
const RELEASE_MEMBERSHIP_MIGRATION_ID = '0.13.1/release-membership'
const COMPACT_READ_MODEL_MIGRATION_ID = '0.13.2/compact-task-read-models'
const CURRENT_PROOF_READ_MODEL_MIGRATION_ID = '0.13.9/current-proof-read-model'
const IMPORTED_SCRIPT_PROOF_CONTRACT_MIGRATION_ID = '0.13.10/imported-script-proof-contracts'
const CURRENT_PLAN_RECOVERY_BOUNDARY_MIGRATION_ID = '0.13.11/current-plan-recovery-boundary'
const MODEL_INDEPENDENT_MACHINE_BOUNDARY_MIGRATION_ID = '0.13.11/model-independent-machine-boundary'
const MALFORMED_TASK_RUNTIME_OVERLAY_MIGRATION_ID = '0.13.12/repair-malformed-task-runtime-overlays'
const EFFECTIVE_CURRENT_PROOF_READ_MODEL_MIGRATION_ID = '0.13.12/effective-current-proof-read-model'
const MODEL_INDEPENDENT_READINESS_BOUNDARY_MIGRATION_ID = '0.13.13/model-independent-readiness-boundary'
const PROOF_SETUP_TASK_KIND_MIGRATION_ID = '0.13.19/proof-setup-task-kind'
const PROOF_SETUP_CONTRACT_MIGRATION_ID = '0.13.20/deterministic-proof-setup-contract'
const RECURSIVE_PROOF_SETUP_MIGRATION_ID = '0.13.21/remove-recursive-proof-setup-tasks'
const PROOF_COMMAND_IDENTITY_MIGRATION_ID = '0.13.22/proof-command-identity'
const ACCEPTANCE_COMMAND_PROOF_PATH_RECONCILIATION_MIGRATION_ID = '0.13.27/acceptance-command-proof-path-reconciliation'
const PROOF_SETUP_COMPLETION_AUTHORITY_MIGRATION_ID = '0.13.30/proof-setup-completion-authority'
const PROOF_SETUP_HISTORY_FENCE_MIGRATION_ID = '0.13.31/proof-setup-history-fence'
const PROOF_SETUP_RUNTIME_RECOVERY_MIGRATION_ID = '0.13.32/proof-setup-runtime-recovery-marker'
const RELEASE_LOCAL_PROOF_SCOPE_MIGRATION_ID = '0.13.33/release-local-proof-child-scope'
const INDEXED_SEMANTIC_KIND_MIGRATION_ID = '0.13.39/indexed-semantic-kind-boundary'
const PROOF_SETUP_EXECUTION_BLUEPRINT_MIGRATION_ID = '0.13.41/proof-setup-execution-blueprint'
const PROOF_SETUP_ACCEPTANCE_CONTRACT_MIGRATION_ID = '0.13.55/proof-setup-acceptance-contract'
const PROOF_SETUP_PROJECTION_REFRESH_MIGRATION_ID = '0.13.56/proof-setup-projection-refresh'
const PROOF_SETUP_EFFECTIVE_PROJECTION_MIGRATION_ID = '0.13.57/proof-setup-effective-projection'
const DIAGNOSTIC_READINESS_TASK_IDENTITY_MIGRATION_ID = '0.13.58/diagnostic-readiness-task-identity'
const SCRIPT_ONLY_PROOF_PROJECTION_MIGRATION_ID = '0.13.59/script-only-proof-projection'
const SOURCE_CAPABILITY_SUMMARY_MIGRATION_ID = '0.13.60/source-capability-summary'
const INTERNAL_PROOF_RELEASE_CONTEXT_MIGRATION_ID = '0.13.65/internal-proof-release-context'
const RELEASE_MEMBERSHIP_SNAPSHOT_MIGRATION_ID = '0.13.66/release-membership-snapshot'
const SPEC_REVIEW_GATE_MIGRATION_ID = '0.13.67/explicit-spec-review-gates'
const DURABLE_SPEC_HANDOFF_MIGRATION_ID = '0.13.68/settle-durable-spec-handoffs'
const COMPACT_SPEC_REVIEW_AUTHORITY_MIGRATION_ID = '0.13.69/compact-spec-review-authority'
const COMPACT_SPEC_REVIEW_READINESS_MIGRATION_ID = '0.13.100/compact-spec-review-readiness'
const ATOMIC_DECISION_FOCUS_MIGRATION_ID = '0.13.70/atomic-decision-focus'
const DURABLE_DECISION_SNAPSHOT_MIGRATION_ID = '0.13.71/durable-decision-snapshot'
const INDEXED_RELEASE_SUMMARY_REPROJECTION_MIGRATION_ID = '0.13.72/indexed-release-summary-reprojection'
const NAMED_RELEASE_MEMBER_COUNT_MIGRATION_ID = '0.13.73/named-release-member-counts'
const INCLUDED_RELEASE_DISPOSITION_COUNT_MIGRATION_ID = '0.13.74/included-release-disposition-counts'
const CANONICAL_RELEASE_MEMBERSHIP_SUMMARY_MIGRATION_ID = '0.13.75/canonical-release-membership-summary'
const SELECTED_RELEASE_NODE_MEMBERSHIP_SUMMARY_MIGRATION_ID = '0.13.76/selected-release-node-membership-summary'
const PROOF_VERIFICATION_EVIDENCE_AUTHORITY_MIGRATION_ID = '0.13.77/proof-verification-evidence-authority'
const RELEASE_MEMBERSHIP_READ_BOUNDARY_MIGRATION_ID = '0.13.99/release-membership-read-boundary'
const DELIVERY_READ_PROJECTION_MIGRATION_ID = '0.13.3/delivery-read-projection'
const STORED_REQUEST_TITLE_INTEGRITY_MIGRATION_ID = '0.13.4/stored-request-title-integrity'
const OWNER_INPUT_CURRENT_AUTHORITY_MIGRATION_ID = '0.13.5/owner-input-current-authority'
const RELEASE_MEMBERSHIP_CURRENT_AUTHORITY_MIGRATION_ID = '0.13.6/release-membership-current-authority'
const THREAD_HISTORY_PROJECTION_MIGRATION_ID = '0.12.47/project-thread-history-read-model'
const COMPLETION_SUMMARY_EVIDENCE_MIGRATION_ID = '0.13.8/task-completion-summary-evidence'

interface FinalProjectStateMigrationResult {
  removedPaths: string[]
  queueTaskCount: number
  summaryFreshness: string
}

function taskIsImportedSourceWork(task: Task): boolean {
  const createdBy = task.requestIntake?.createdBy
  const importedDraft = (task as unknown as Record<string, unknown>).importedDraft === true
  return importedDraft ||
    createdBy === 'workspace-importer' ||
    createdBy === 'project-reintake' ||
    (task.sourceClaims?.length ?? 0) > 0 ||
    (task.references ?? []).some(reference => /(^|\/)docs\//i.test(reference.replaceAll('\\', '/')))
}

function taskNeedsImportedScriptProofRepair(task: Task): boolean {
  if (!taskIsImportedSourceWork(task)) return false
  const genericPath = (task.proofPaths ?? []).some(path =>
    path &&
    typeof path === 'object' &&
    !Array.isArray(path) &&
    path.kind === 'command' &&
    typeof path.command === 'string' &&
    !isConcreteProjectProofCommand(path.command),
  )
  const genericCriterion = (task.acceptanceCriteria ?? []).some(criterion =>
    typeof criterion.command === 'string' &&
    !isConcreteProjectProofCommand(criterion.command),
  )
  return genericPath || genericCriterion
}

function taskNeedsProofSetupKindMigration(task: Task): boolean {
  return task.workKind === 'verification' &&
    task.semanticKind !== 'proof_setup' &&
    task.proposalRationale === 'proof-recovery: establish a concrete project-backed proof command for the containing task'
}

function taskNeedsSpecReviewGateMigration(task: Task): boolean {
  return task.status === 'spec_review' && task.specReviewGate == null
}

function migrateLegacySpecReviewGate(task: Task, now: string): boolean {
  if (!taskNeedsSpecReviewGateMigration(task)) return false
  task.specReviewGate = {
    authority: 'owner',
    requestedAt: task.updatedAt || now,
    requestedBy: 'legacy-spec-review-gate-migration',
    reason: 'spec_handoff',
  }
  task.updatedAt = now
  return true
}

function taskNeedsDurableSpecHandoffMigration(task: Task): boolean {
  return task.status === 'exploring' &&
    task.structuredSpec != null &&
    typeof task.productBrief?.approvedAt === 'string' &&
    task.productBrief.approvedAt.trim().length > 0 &&
    !(task.openQuestions ?? []).some(question => !question.answeredAt) &&
    validateSpecCompletionBoundary(task).ok
}

function settleDurableSpecHandoff(task: Task, now: string): boolean {
  if (!taskNeedsDurableSpecHandoffMigration(task)) return false
  task.status = 'spec_review'
  task.specReviewGate = {
    authority: 'owner',
    requestedAt: now,
    requestedBy: 'durable-spec-handoff-migration',
    reason: 'spec_handoff',
  }
  task.updatedAt = now
  return true
}

function compactSpecReviewAuthorityNeedsMigration(projectRoot: string): boolean {
  if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return false
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const inventory = readProjectStateDatabaseInventory(tasksPath, {
    includeDefinitions: false,
  })
  if (!inventory) return false
  const ownerReviewTasks = inventory.tasks.filter(task => {
    if (task.status !== 'spec_review') return false
    const currentSummary = isRecord(task.currentSummary) ? task.currentSummary : null
    return currentSummary?.specReviewAuthority === 'owner' && task.scopeRow?.scope === 'included'
  })
  const missingAuthority = inventory.tasks.some(task => {
    if (task.status !== 'spec_review') return false
    const currentSummary = isRecord(task.currentSummary) ? task.currentSummary : null
    return currentSummary?.specReviewAuthority !== 'owner' && currentSummary?.specReviewAuthority !== 'coordinator'
  })
  const saved = readProjectStateDatabaseSummary<Record<string, unknown>>(tasksPath)?.payload
  const savedReview = isRecord(saved?.ownerReview) ? saved.ownerReview : null
  const savedDecision = isRecord(saved?.decision) ? saved.decision : null
  const savedCount = typeof savedReview?.openCount === 'number' ? savedReview.openCount : 0
  const savedTaskId = isRecord(savedReview?.next) && typeof savedReview.next.taskId === 'string'
    ? savedReview.next.taskId
    : null
  const decisionReview = isRecord(savedDecision?.ownerReview) ? savedDecision.ownerReview : null
  return missingAuthority ||
    savedCount !== ownerReviewTasks.length ||
    savedTaskId !== (ownerReviewTasks[0]?.id ?? null) ||
    (ownerReviewTasks.length > 0 && decisionReview?.state !== 'required')
}

function compactSpecReviewReadinessNeedsMigration(projectRoot: string): boolean {
  if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return false
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
  const inventory = readProjectStateDatabaseInventory(tasksPath, { includeDefinitions: false })
  if (!queue || !inventory) return false
  const expectedByTaskId = new Map(
    queue.tasks
      .filter(task => task.status === 'spec_review')
      .map(task => {
        const summary = projectStateDatabaseTaskSummary(task).currentSummary
        const ready = isRecord(summary) && typeof summary.specReviewReadyForOwnerApproval === 'boolean'
          ? summary.specReviewReadyForOwnerApproval
          : false
        return [String(task.id), ready] as const
      }),
  )
  return inventory.tasks.some(task => {
    const expected = expectedByTaskId.get(task.id)
    if (expected === undefined) return false
    const currentSummary = isRecord(task.currentSummary) ? task.currentSummary : null
    return currentSummary?.specReviewReadyForOwnerApproval !== expected
  })
}

function migrateProofSetupTaskKind(task: Task): boolean {
  if (!taskNeedsProofSetupKindMigration(task)) return false
  task.semanticKind = 'proof_setup'
  // This phrase was only ever an implementation marker. Once the structured
  // kind is present it must not remain a second machine-readable authority.
  delete task.proposalRationale
  task.updatedAt = new Date().toISOString()
  return true
}

function concreteProofCommandForTask(task: Task): string | undefined {
  const fromCriterion = task.acceptanceCriteria.find((criterion) =>
    typeof criterion.command === 'string' && isConcreteProjectProofCommand(criterion.command),
  )?.command
  if (fromCriterion) return fromCriterion.trim()
  const fromProofPath = task.proofPaths?.find((path) =>
    path && typeof path === 'object' && !Array.isArray(path) &&
    typeof path.command === 'string' && isConcreteProjectProofCommand(path.command),
  )
  return fromProofPath && typeof fromProofPath.command === 'string'
    ? fromProofPath.command.trim()
    : undefined
}

function taskNeedsDeterministicProofSetupContract(task: Task): boolean {
  if (!isProofSetupTask(task)) return false
  const boundary = task.structuredSpec?.completionBoundary
  return !task.structuredSpec ||
    boundary?.splitPolicy !== 'none' ||
    task.taskKind !== 'verification' ||
    task.status === 'exploring' ||
    task.status === 'spec_review' ||
    task.status === 'in_progress'
}

function taskNeedsProofSetupExecutionBlueprint(task: Task): boolean {
  if (!isProofSetupTask(task)) return false
  return !task.structuredSpec ||
    !task.structuredSpec.completionBoundary ||
    task.structuredSpec.completionBoundary.splitPolicy !== 'none' ||
    task.taskKind !== 'verification' ||
    task.acceptanceCriteria.length === 0
}

function repairProofSetupExecutionBlueprint(
  task: Task,
  parent: Task,
  now: string,
): boolean {
  if (!taskNeedsProofSetupExecutionBlueprint(task)) return false
  const command = concreteProofCommandForTask(task)
  const canonical = buildProofSetupTaskContract(parent, now, {
    id: task.id,
    ...proofSetupContractScope(task),
    ...(command ? { command } : {}),
  })
  const previousNotes = Array.isArray(task.notes) ? task.notes : []
  const previousCreatedAt = task.createdAt
  const previousProofPaths = task.proofPaths
  const previousStatus = task.status
  const previousBlockReason = task.blockReason
  Object.assign(task, canonical, {
    createdAt: previousCreatedAt,
    status: previousStatus,
    notes: [
      ...previousNotes,
      {
        agentId: 'guildhall-migration',
        role: 'system',
        structured: {
          event: 'proof_setup_execution_blueprint_restored',
          source: 'deterministic',
        },
        content: 'Guildhall restored the canonical proof-setup execution blueprint after recovery cleared the current plan. Provider prose remains display-only.',
        timestamp: now,
      },
    ],
    ...(previousBlockReason ? { blockReason: previousBlockReason } : {}),
    ...(previousProofPaths ? { proofPaths: previousProofPaths } : {}),
    updatedAt: now,
  })
  delete task.assignedTo
  return true
}

function migrateDeterministicProofSetupContract(
  task: Task,
  parent: Task,
  now: string,
): boolean {
  if (!taskNeedsDeterministicProofSetupContract(task)) return false
  const command = concreteProofCommandForTask(task)
  const canonical = buildProofSetupTaskContract(parent, now, {
    id: task.id,
    ...proofSetupContractScope(task),
    ...(command ? { command } : {}),
  })
  const previousNotes = Array.isArray(task.notes) ? task.notes : []
  const previousCreatedAt = task.createdAt
  const previousProofPaths = task.proofPaths
  const previousStatus = task.status
  Object.assign(task, canonical, {
    createdAt: previousCreatedAt,
    status: command && previousStatus === 'done' ? 'done' : 'ready',
    notes: [
      ...previousNotes,
      {
        agentId: 'guildhall-migration',
        role: 'system',
        structured: {
          event: 'proof_setup_contract_repaired',
          source: 'deterministic',
        },
        content: 'Guildhall replaced the model-shaped proof-setup draft with the canonical structured proof contract. The exact command remains data, and provider prose cannot settle proof.',
        timestamp: now,
      },
    ],
    ...(previousProofPaths ? { proofPaths: previousProofPaths } : {}),
    updatedAt: now,
  })
  delete task.assignedTo
  return true
}

function proofSetupParentId(task: Task): string | undefined {
  return task.hierarchy?.parentId ?? task.delivery?.supports?.[0]
}

function proofSetupScopedReleaseIds(task: Task): string[] {
  return [...new Set([
    ...(task.proofForReleaseId ? [task.proofForReleaseId] : []),
    ...(task.releaseIds ?? []),
  ])]
}

function proofSetupContractScope(task: Task): { proofForReleaseId?: string; releaseIds?: string[] } {
  if (task.proofForReleaseId) return { proofForReleaseId: task.proofForReleaseId }
  return task.releaseIds?.length ? { releaseIds: task.releaseIds } : {}
}

function proofSetupReleaseContextIds(
  queue: { releases?: ProjectRelease[] },
  task: Task,
): string[] {
  const nodeId = `work:${task.id}`
  return [...new Set([
    ...(task.proofForReleaseId ? [task.proofForReleaseId] : []),
    ...(task.releaseIds ?? []),
    ...(queue.releases ?? [])
      .filter(release => release.nodeIds?.includes(nodeId) || release.deferredNodeIds?.includes(nodeId))
      .map(release => release.id),
  ])]
}

function isInternalProofSetupTask(task: Task): boolean {
  return isProofSetupTask(task) && task.workVisibility?.countInProjectTotals === false
}

function internalProofReleaseContextNeedsMigration(queue: { tasks: Task[]; releases?: ProjectRelease[] }): boolean {
  return queue.tasks.some(task => {
    if (!isInternalProofSetupTask(task)) return false
    if (task.releaseIds?.length) return true
    const contextIds = proofSetupReleaseContextIds(queue, task)
    const hasActiveMembership = (queue.releases ?? []).some(release =>
      release.state !== 'shipped' &&
      (release.nodeIds?.includes(`work:${task.id}`) || release.deferredNodeIds?.includes(`work:${task.id}`)),
    )
    // A single shipped-snapshot relation can be elevated into typed proof
    // context without modifying that snapshot. Multiple snapshot relations are
    // intentionally retained as unassigned historical evidence: choosing one
    // would invent an ownership fact the old data does not contain.
    return hasActiveMembership || (!task.proofForReleaseId && contextIds.length === 1)
  })
}

function migrateInternalProofReleaseContexts(
  queue: { tasks: Task[]; releases?: ProjectRelease[] },
  now: string,
): { normalized: number; materialized: number; historical: number } {
  let normalized = 0
  let materialized = 0
  let historical = 0
  for (const task of [...queue.tasks]) {
    if (!isInternalProofSetupTask(task)) continue
    const legacyContextIds = proofSetupReleaseContextIds(queue, task)
    const hadVisibleMembership = (task.releaseIds?.length ?? 0) > 0 ||
      (queue.releases ?? []).some(release =>
        release.nodeIds?.includes(`work:${task.id}`) || release.deferredNodeIds?.includes(`work:${task.id}`),
      )
    if (!hadVisibleMembership) continue

    // A persisted typed proof scope wins over an obsolete active-membership
    // row. Internal work is hidden from active product/release scope, but a
    // shipped release is an immutable historical snapshot: its existing
    // member rows are evidence, not an obsolete projection to delete.
    task.releaseIds = []
    for (const release of queue.releases ?? []) {
      if (release.state === 'shipped') continue
      release.nodeIds = (release.nodeIds ?? []).filter(nodeId => nodeId !== `work:${task.id}`)
      release.deferredNodeIds = (release.deferredNodeIds ?? []).filter(nodeId => nodeId !== `work:${task.id}`)
    }

    if (!task.proofForReleaseId && legacyContextIds.length === 1) {
      task.proofForReleaseId = legacyContextIds[0]
    } else if (!task.proofForReleaseId && legacyContextIds.length > 1) {
      // One old child claimed multiple release memberships. It cannot be
      // truthfully assigned to one of them. Keep it as historical evidence
      // and create fresh, explicitly scoped proof work for every active
      // release instead of selecting an arbitrary winner.
      const parentId = proofSetupParentId(task)
      const parent = parentId ? queue.tasks.find(candidate => candidate.id === parentId) : undefined
      for (const releaseId of legacyContextIds) {
        const release = queue.releases?.find(candidate => candidate.id === releaseId)
        if (!parent || !release || release.state === 'shipped') continue
        const result = materializeProofSetupTask(queue as Parameters<typeof materializeProofSetupTask>[0], parent, now, {
          releaseIds: [releaseId],
          linkParent: false,
        })
        if (result.status === 'materialized') materialized += 1
      }
      historical += 1
    }
    task.updatedAt = now
    normalized += 1
  }
  return { normalized, materialized, historical }
}

function rawProofPathRecords(task: Task): Array<Record<string, unknown>> {
  return (task.proofPaths ?? [])
    .filter((proofPath): proofPath is Record<string, unknown> =>
      Boolean(proofPath) && typeof proofPath === 'object' && !Array.isArray(proofPath),
    )
}

function proofSetupNeedsCommandIdentity(task: Task): boolean {
  if (!isProofSetupTask(task)) return false
  const parentId = proofSetupParentId(task)
  if (!parentId) return false
  const marker = proofIdentityMarkerForTask(parentId)
  const criterionNeedsIdentity = (task.acceptanceCriteria ?? []).some((criterion) =>
    (criterion.id === 'ac-1' || typeof criterion.command === 'string') &&
    (!(criterion.expectedOutputIncludes ?? []).includes(marker) ||
      (typeof criterion.command === 'string' && !isConcreteProjectProofCommand(criterion.command))),
  )
  const pathNeedsIdentity = rawProofPathRecords(task).some((proofPath) => {
    if (proofPath.kind !== 'command') return false
    if (typeof proofPath.command !== 'string' || !isConcreteProjectProofCommand(proofPath.command)) return true
    const expectedEvidence = Array.isArray(proofPath.expectedEvidence)
      ? proofPath.expectedEvidence.filter((evidence): evidence is Record<string, unknown> =>
          Boolean(evidence) && typeof evidence === 'object' && !Array.isArray(evidence),
        )
      : []
    return expectedEvidence.some((evidence) =>
      !(Array.isArray(evidence.expectedOutputIncludes) ? evidence.expectedOutputIncludes : []).includes(marker),
    )
  })
  return criterionNeedsIdentity || pathNeedsIdentity
}

function taskNeedsAcceptanceCommandProofPathReconciliation(task: Task): boolean {
  const before = JSON.stringify(task.proofPaths ?? [])
  const next = ensureCommandProofPathsFromAcceptanceCriteria(task, new Date().toISOString(), 'guildhall-migration')
  return JSON.stringify(next) !== before
}

function taskNeedsProofSetupCompletionRepair(
  task: Task,
  releases: readonly ProjectRelease[],
): boolean {
  if (!isProofSetupTask(task) || task.status !== 'done') return false

  const taskReleaseIds = new Set(proofSetupScopedReleaseIds(task))
  const shippedReleaseIds = new Set(
    [...taskReleaseIds].filter(releaseId => releases.some(release => release.id === releaseId && release.state === 'shipped')),
  )
  const activeReleases = releases.filter(release =>
    release.state !== 'shipped' &&
    (taskReleaseIds.size === 0 || taskReleaseIds.has(release.id)),
  )

  // A shipped release is historical. Do not reopen its record merely because
  // a later migration discovers that an old proof child was weak. An active
  // or release-less proof boundary, however, must be executable and current.
  if (activeReleases.length === 0 && taskReleaseIds.size > 0) return false
  if (shippedReleaseIds.size > 0 && activeReleases.length > 0) return true

  const hasCurrentProofContract = (task.proofPaths?.length ?? 0) > 0 ||
    task.acceptanceCriteria.some(criterion => typeof criterion.command === 'string' && criterion.command.trim().length > 0)
  if (!hasCurrentProofContract) return true
  if (taskDoneButProofMissing(task)) return true
  return activeReleases.some(release =>
    taskDoneButProofMissingForScope(task, release.proofStyle) ||
    (release.proofStyle === 'script_only' && !taskHasScriptProofPath(task)),
  )
}

function taskNeedsProofSetupRuntimeRecovery(
  task: Task,
  runtime: Awaited<ReturnType<typeof readTaskRuntimeStore>>,
): boolean {
  // This migration repairs historical terminal state. A ready proof step may
  // be newly materialized normal work, and does not need a recovery marker to
  // be runnable. Treating every unfinished ready step as a migration defect
  // turns ordinary release progress into a false required-migration blocker.
  if (!isProofSetupTask(task) || task.status !== 'done') return false
  const recovery = runtime.tasks[task.id]?.proofRecovery
  if (recovery?.kind === 'proof' && typeof recovery.reopenedAt === 'string') return false
  return taskDoneButProofMissing(task)
}

function proofSetupRuntimeRecoveryIsActionable(
  task: Task,
  releases: readonly ProjectRelease[],
  selectedReleaseId: string | null | undefined,
): boolean {
  const taskReleaseIds = proofSetupScopedReleaseIds(task)
  // A proof repair is executable-release maintenance, never a retrospective
  // rewrite of historical release evidence. Once a project has a selected
  // release, only that release may make this migration actionable.
  if (selectedReleaseId && taskReleaseIds.length > 0 && !taskReleaseIds.includes(selectedReleaseId)) return false
  return taskReleaseIds.length === 0 || taskReleaseIds.some(releaseId =>
    releases.some(release => release.id === releaseId && release.state !== 'shipped'),
  )
}

function releaseLocalProofSetupRepair(
  queue: { tasks: Task[]; releases?: ProjectRelease[] },
  task: Task,
  releases: readonly ProjectRelease[],
  now: string,
): boolean {
  if (task.proofForReleaseId) return false
  const taskReleaseIds = new Set(proofSetupScopedReleaseIds(task))
  const shippedReleaseIds = [...taskReleaseIds].filter(releaseId =>
    releases.some(release => release.id === releaseId && release.state === 'shipped'),
  )
  const activeReleaseIds = [...taskReleaseIds].filter(releaseId =>
    releases.some(release => release.id === releaseId && release.state !== 'shipped'),
  )
  if (shippedReleaseIds.length === 0 || activeReleaseIds.length === 0) return false
  const parentId = proofSetupParentId(task)
  const parent = parentId ? queue.tasks.find(candidate => candidate.id === parentId) : undefined
  if (!parent || isProofSetupTask(parent)) return false

  // A proof child shared with a shipped release is historical. The active
  // release gets a new sibling under the containing task; proof setup never
  // becomes the parent of another proof setup task.
  materializeProofSetupTask(queue as Parameters<typeof materializeProofSetupTask>[0], parent, now, {
    releaseIds: activeReleaseIds,
    linkParent: false,
  })
  task.releaseIds = shippedReleaseIds
  return true
}

function reopenUnprovenProofSetupTask(task: Task, now: string): void {
  task.status = 'ready'
  delete task.assignedTo
  delete task.completedAt
  delete task.blockReason
  if (task.doneSummaryBundle?.status === 'done') {
    task.doneSummaryBundle = {
      ...task.doneSummaryBundle,
      status: 'reopened',
      reopenedAt: now,
      reopenReason: 'Current typed proof was missing; the prior completion is historical evidence only.',
      createdAt: now,
      createdBy: 'guildhall-migration',
    }
  }
  task.notes = [
    ...(task.notes ?? []),
    {
      agentId: 'guildhall-migration',
      role: 'system',
      structured: {
        event: 'proof_setup_reopened_before_proof',
        reason: 'done_without_current_typed_proof',
      },
      content: 'Guildhall reopened this proof boundary because its current typed proof was not verified. A worker must run the declared command and record machine evidence before the task can be done.',
      timestamp: now,
    },
  ]
  task.updatedAt = now
}

function migrateProofSetupCommandIdentity(task: Task, now: string, preserveCompletedStatus: boolean): boolean {
  if (!proofSetupNeedsCommandIdentity(task)) return false
  const parentId = proofSetupParentId(task)
  if (!parentId) return false
  const marker = proofIdentityMarkerForTask(parentId)
  const concretePathCommand = rawProofPathRecords(task).find((proofPath) =>
    proofPath.kind === 'command' &&
    typeof proofPath.command === 'string' &&
    isConcreteProjectProofCommand(proofPath.command),
  )?.command
  const concreteCommand = typeof concretePathCommand === 'string' ? concretePathCommand : undefined
  let changed = false
  for (const criterion of task.acceptanceCriteria ?? []) {
    if (criterion.id !== 'ac-1' && typeof criterion.command !== 'string') continue
    let criterionChanged = false
    if (!criterion.command && concreteCommand) {
      criterion.command = concreteCommand.trim()
      criterionChanged = true
    }
    if (criterion.command && !isConcreteProjectProofCommand(criterion.command)) {
      delete criterion.command
      delete criterion.expectedExit
      criterionChanged = true
    }
    const expectedOutputIncludes = [...new Set([...(criterion.expectedOutputIncludes ?? []), marker])]
    if (JSON.stringify(expectedOutputIncludes) !== JSON.stringify(criterion.expectedOutputIncludes ?? [])) {
      criterion.expectedOutputIncludes = expectedOutputIncludes
      criterionChanged = true
    }
    if (criterionChanged) {
      changed = true
      criterion.met = false
      delete criterion.persistedMet
      delete criterion.verificationState
      delete criterion.verificationSource
      delete criterion.staleReason
      delete criterion.staleGateId
    }
  }

  task.proofPaths = rawProofPathRecords(task).filter((proofPath) => {
    if (proofPath.kind !== 'command') return true
    if (typeof proofPath.command !== 'string' || !isConcreteProjectProofCommand(proofPath.command)) {
      changed = true
      return false
    }
    const expectedEvidence = Array.isArray(proofPath.expectedEvidence)
      ? proofPath.expectedEvidence.filter((evidence): evidence is Record<string, unknown> =>
          Boolean(evidence) && typeof evidence === 'object' && !Array.isArray(evidence),
        )
      : []
    for (const evidence of expectedEvidence) {
      const previousOutputIncludes = Array.isArray(evidence.expectedOutputIncludes)
        ? evidence.expectedOutputIncludes.filter((value): value is string => typeof value === 'string')
        : []
      const expectedOutputIncludes = [...new Set([...previousOutputIncludes, marker])]
      if (JSON.stringify(expectedOutputIncludes) !== JSON.stringify(previousOutputIncludes)) {
        evidence.expectedOutputIncludes = expectedOutputIncludes
        changed = true
      }
    }
    if (changed) {
      proofPath.status = 'planned'
      proofPath.verificationRecords = []
      proofPath.updatedAt = now
      proofPath.updatedBy = 'guildhall-migration'
    }
    return true
  })
  task.proofPaths = ensureCommandProofPathsFromAcceptanceCriteria(task, now, 'guildhall-migration')
  if (!changed) return false
  if (!preserveCompletedStatus) {
    task.status = 'ready'
    delete task.assignedTo
  }
  task.notes = [
    ...(task.notes ?? []),
    {
      agentId: 'guildhall-migration',
      role: 'system',
      structured: {
        event: 'proof_command_identity_contract_installed',
        parentTaskId: parentId,
        proofIdentityMarker: marker,
      },
      content: 'Guildhall invalidated proof that did not identify the bounded task in machine evidence. Provider prose remains audit-only.',
      timestamp: now,
    },
  ]
  task.updatedAt = now
  return true
}

function taskNeedsCanonicalProofSetupAcceptanceContract(task: Task): boolean {
  if (!isProofSetupTask(task)) return false
  // Proof setup is a Guildhall-owned executable boundary. Its canonical
  // contract has one command criterion; a generic review/scope criterion is
  // a leaked parent-task template, not additional proof work.
  return task.acceptanceCriteria.length !== 1 || task.acceptanceCriteria[0]?.id !== 'ac-1'
}

function repairCanonicalProofSetupAcceptanceContract(
  task: Task,
  parent: Task,
  now: string,
): boolean {
  if (!taskNeedsCanonicalProofSetupAcceptanceContract(task)) return false
  const command = concreteProofCommandForTask(task)
  const canonical = buildProofSetupTaskContract(parent, now, {
    id: task.id,
    ...proofSetupContractScope(task),
    ...(command ? { command } : {}),
  })
  const previousNotes = Array.isArray(task.notes) ? task.notes : []
  const previousCreatedAt = task.createdAt
  const previousStatus = task.status
  const previousCompletedAt = task.completedAt
  const previousBlockReason = task.blockReason
  const nonCommandProofPaths = rawProofPathRecords(task).filter(path => path.kind !== 'command')
  Object.assign(task, canonical, {
    createdAt: previousCreatedAt,
    status: previousStatus,
    ...(previousCompletedAt ? { completedAt: previousCompletedAt } : {}),
    ...(previousBlockReason ? { blockReason: previousBlockReason } : {}),
    proofPaths: [
      ...nonCommandProofPaths,
      ...ensureCommandProofPathsFromAcceptanceCriteria(canonical, now, 'guildhall-migration'),
    ],
    notes: [
      ...previousNotes,
      {
        agentId: 'guildhall-migration',
        role: 'system',
        structured: {
          event: 'proof_setup_acceptance_contract_canonicalized',
          source: 'deterministic',
          removedGenericCriteria: true,
        },
        content: 'Guildhall restored the proof-setup task to its single typed command contract. Generic review criteria were not proof work and were removed from the active contract; retained history remains available as evidence.',
        timestamp: now,
      },
    ],
    updatedAt: now,
  })
  return true
}

function recursiveProofSetupTaskIds(tasks: readonly Task[]): Set<string> {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const recursive = new Set<string>()
  for (const task of tasks) {
    if (!isProofSetupTask(task)) continue
    const visited = new Set<string>([task.id])
    let parentId = task.hierarchy?.parentId
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      if (isProofSetupTask(parent)) {
        recursive.add(task.id)
        break
      }
      parentId = parent.hierarchy?.parentId
    }
  }
  return recursive
}

function removeRecursiveProofSetupTasks(queue: { tasks: Task[]; releases?: ProjectRelease[] }): number {
  const recursiveIds = recursiveProofSetupTaskIds(queue.tasks)
  if (recursiveIds.size === 0) return 0
  queue.tasks = queue.tasks
    .filter(task => !recursiveIds.has(task.id))
    .map(task => ({
      ...task,
      ...(task.hierarchy
        ? { hierarchy: { ...task.hierarchy, childIds: task.hierarchy.childIds.filter(id => !recursiveIds.has(id)) } }
        : {}),
      ...(task.deliverySteps
        ? { deliverySteps: task.deliverySteps.filter(step => !step.sourceTaskId || !recursiveIds.has(step.sourceTaskId)) }
        : {}),
      ...(task.dependsOn
        ? { dependsOn: task.dependsOn.filter(id => !recursiveIds.has(id)) }
        : {}),
    }))
  for (const release of queue.releases ?? []) {
    release.nodeIds = release.nodeIds?.filter(id => !recursiveIds.has(id))
    release.deferredNodeIds = release.deferredNodeIds?.filter(id => !recursiveIds.has(id))
  }
  return recursiveIds.size
}

function malformedTaskRuntimeOverlayIds(projectRoot: string): string[] {
  if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return []
  const stores = readProjectStateDatabaseTaskOverlayStores(projectRoot)
  if (!stores) return []
  return stores.runtime
    .filter(row => !TaskRuntimeState.safeParse(row.payload).success)
    .map(row => row.taskId)
}

function repairTaskRuntimeOverlay(
  taskId: string,
  updatedAt: string | undefined,
  payload: unknown,
): { taskId: string; updatedAt: string; payload: unknown } {
  const parsed = TaskRuntimeState.safeParse(payload)
  if (parsed.success) {
    return { taskId, updatedAt: updatedAt ?? parsed.data.updatedAt, payload: parsed.data }
  }

  // An older supervisor wrote retryWindow without its required base revision.
  // That fragment is not trustworthy current state, but the rest of the runtime
  // overlay is. Remove only that fragment and keep the durable task evidence.
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload) || !('retryWindow' in payload)) {
    throw new Error(`Cannot repair task runtime overlay ${taskId}: ${parsed.error.message}`)
  }
  const candidate = { ...(payload as Record<string, unknown>) }
  delete candidate.retryWindow
  candidate.taskId = taskId
  candidate.updatedAt = candidate.updatedAt ?? updatedAt ?? new Date().toISOString()
  const repaired = TaskRuntimeState.safeParse(candidate)
  if (!repaired.success) {
    throw new Error(`Cannot repair task runtime overlay ${taskId} after removing retryWindow: ${repaired.error.message}`)
  }
  return {
    taskId,
    updatedAt: repaired.data.updatedAt,
    payload: repaired.data,
  }
}

function repairImportedScriptProofContract(task: Task): boolean {
  let changed = false
  const nextProofPaths = replaceGenericProjectProofPathsWithSetup(task)
  if (JSON.stringify(nextProofPaths) !== JSON.stringify(task.proofPaths ?? [])) {
    task.proofPaths = nextProofPaths
    changed = true
  }
  const nextCriteria = (task.acceptanceCriteria ?? []).map(criterion => {
    if (
      typeof criterion.command !== 'string' ||
      isConcreteProjectProofCommand(criterion.command)
    ) return criterion
    const { command: _command, ...withoutCommand } = criterion as Task['acceptanceCriteria'][number] & { command?: string }
    changed = true
    return {
      ...withoutCommand,
      met: false,
      verifiedBy: 'review' as const,
      source: 'inferred' as const,
      verificationState: 'stale' as const,
      staleReason: 'The imported workspace convention was not a task-specific proof command; current proof setup is required.',
    }
  })
  if (JSON.stringify(nextCriteria) !== JSON.stringify(task.acceptanceCriteria ?? [])) {
    task.acceptanceCriteria = nextCriteria
    changed = true
  }
  return changed
}

function importedScriptProofRepairTaskIds(projectRoot: string): string[] {
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
  if (!queue) return []
  const selectedRelease = queue.releases
    ?.map(release => release as unknown as ProjectRelease)
    .find(release => release.id === queue.selectedReleaseId)
  if (selectedRelease?.proofStyle !== 'script_only') return []
  const tasks = queue.tasks as unknown as Task[]
  return tasks
    .filter(task => task.releaseIds?.includes(selectedRelease.id))
    .filter(taskNeedsImportedScriptProofRepair)
    .map(task => task.id)
}

function legacyCurrentStateFiles(projectRoot: string, tasksPath: string): string[] {
  return [
    tasksPath,
    projectStateDatabaseDetailPathFromTasksPath(tasksPath),
    projectStateDatabaseCompressedDetailPathFromTasksPath(tasksPath),
    getProjectSystemStatePath(projectRoot, 'project-summary.json'),
    path.join(getProjectLocalHistoryDir(projectRoot), 'project-availability.json'),
    getProjectSystemStatePath(projectRoot, 'attention.json'),
    getProjectSystemStatePath(projectRoot, 'reconciliations.json'),
    runtimeStatePath(projectRoot),
    taskWorkspaceStatePath(projectRoot),
  ]
}

async function removeLegacyCurrentStateFiles(projectRoot: string): Promise<string[]> {
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const removedPaths: string[] = []
  for (const file of legacyCurrentStateFiles(projectRoot, tasksPath)) {
    try {
      await fs.rm(file)
      removedPaths.push(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return removedPaths
}

function scopeRowsForEffectiveTasks(
  queue: NonNullable<ReturnType<typeof readProjectStateDatabaseQueueWithRevision>>['definition'],
  tasks: readonly unknown[],
): ProjectStateDatabaseScopeRow[] {
  const projection = buildProjectScopeProjection({
    ...queue,
    tasks,
  } as unknown as Parameters<typeof buildProjectScopeProjection>[0])
  // Keep the full membership graph in the durable scope index. Execution-row
  // replacement is a read-time summary rule; it must not erase parent nodes
  // from the selected release envelope during migration realignment.
  return projection.rows.map(row => ({
    taskId: row.taskId,
    scope: row.scope,
    eligibilityReason: row.eligibilityReason,
    hierarchyRole: row.hierarchyRole,
    handoffState: row.handoffState,
    blocksStart: row.blocksStart,
    blocksRelease: row.blocksRelease,
    humanBlocking: row.humanBlocking,
    ...(row.countInProjectTotals === false ? { countInProjectTotals: false } : {}),
    proofBlocked: row.proofBlocked,
    dependencyBlocked: row.dependencyBlocked === true,
    ...(row.dependencyTaskIds?.length
      ? { dependencyTaskIds: [...row.dependencyTaskIds] }
      : {}),
    ...(row.blockerSummary ? { blockerSummary: row.blockerSummary } : {}),
    sourceRefs: [...row.sourceRefs],
  }))
}

/**
 * Repair the promoted read models from SQLite's current evidence projection.
 * This deliberately uses the normal database reader and writer boundaries:
 * compatibility files are neither a source nor a fallback for this repair.
 */
async function realignPromotedSummaryWithEffectiveState(projectRoot: string): Promise<{
  taskCount: number
  doneCount: number
  includedCount: number
  deferredCount: number
}> {
  if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') {
    throw new Error('Effective-state summary realignment requires SQLite project-state authority.')
  }
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const queueRead = readProjectStateDatabaseQueueWithRevision(tasksPath)
  if (!queueRead) {
    throw new Error('The promoted SQLite detail index is unavailable; effective-state summary realignment cannot proceed.')
  }
  const effectiveTasks = await buildEffectiveTasks(projectRoot, queueRead.definition.tasks as unknown as Task[], {
    evidence: 'current',
  })
  const inventory = readProjectStateDatabaseInventory(tasksPath, { includeDefinitions: false })
  if (!inventory || inventory.total !== effectiveTasks.length) {
    throw new Error('The promoted SQLite task index does not match its detail queue; effective-state summary realignment cannot proceed.')
  }
  const effectiveById = new Map(effectiveTasks.map(task => [task.id, task]))
  const taskSummaries = effectiveTasks.map(task => ({
    taskId: task.id,
    summary: projectStateDatabaseTaskSummary(task),
  }))
  const taskSummaryRewrite = rewriteProjectStateDatabaseTaskSummaries(projectRoot, taskSummaries)
  const taskOverrides: typeof inventory.tasks = inventory.tasks.map(task => {
    const effective = effectiveById.get(task.id)
    if (!effective) throw new Error(`The promoted SQLite task index is missing effective task ${task.id}.`)
    const currentSummary = projectStateDatabaseTaskSummary(effective).currentSummary
    return {
      ...task,
      title: typeof effective.title === 'string' ? effective.title : task.title,
      status: typeof effective.status === 'string' ? effective.status : task.status,
      ...(typeof effective.semanticKind === 'string' ? { semanticKind: effective.semanticKind } : {}),
      ...(typeof effective.proofForReleaseId === 'string'
        ? { proofForReleaseId: effective.proofForReleaseId }
        : {}),
      updatedAt: typeof effective.updatedAt === 'string' ? effective.updatedAt : task.updatedAt,
      completedAt: typeof effective.completedAt === 'string' ? effective.completedAt : task.completedAt,
      ...(currentSummary && typeof currentSummary === 'object' && !Array.isArray(currentSummary)
        ? { currentSummary: currentSummary as Record<string, unknown> }
        : {}),
    }
  })
  const scopeRows = scopeRowsForEffectiveTasks(queueRead.definition, effectiveTasks)
  const projection = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
    projectId: path.basename(projectRoot),
    generatedAt: new Date().toISOString(),
    sourceQueueLastUpdated: queueRead.definition.lastUpdated ?? null,
    taskOverrides,
    scopeRowOverrides: scopeRows,
    expectedQueueRevision: taskSummaryRewrite.revision ?? queueRead.revision,
  })
  if (!projection) throw new Error('The promoted project summary could not be realigned from effective task state.')
  return {
    taskCount: effectiveTasks.length,
    doneCount: projection.releaseSummary.counts.done,
    includedCount: projection.releaseSummary.counts.total - projection.releaseSummary.counts.deferred,
    deferredCount: projection.releaseSummary.counts.deferred,
  }
}

/**
 * Detect stale proof summaries against the same effective-task boundary used
 * by runtime reads. The older current-proof migration only compared detail
 * rows, which allowed runtime overlays and current evidence to leave the
 * indexed summary with a different answer than the task itself.
 */
async function effectiveCurrentProofReadModelStatus(projectRoot: string): Promise<{
  needed: boolean
  taskCount: number
  mismatchedCount: number
}> {
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const queueRead = readProjectStateDatabaseQueueWithRevision(tasksPath)
  const inventory = readProjectStateDatabaseInventory(tasksPath, { includeDefinitions: false })
  if (!queueRead || !inventory || inventory.total !== queueRead.definition.tasks.length) {
    return { needed: false, taskCount: inventory?.total ?? 0, mismatchedCount: 0 }
  }
  const effectiveTasks = await buildEffectiveTasks(projectRoot, queueRead.definition.tasks as unknown as Task[], {
    evidence: 'current',
  })
  if (effectiveTasks.length !== inventory.tasks.length) {
    return { needed: false, taskCount: inventory.tasks.length, mismatchedCount: 0 }
  }
  const effectiveById = new Map(effectiveTasks.map(task => [task.id, task]))
  let mismatchedCount = 0
  for (const indexedTask of inventory.tasks) {
    const effective = effectiveById.get(indexedTask.id)
    if (!effective) return { needed: false, taskCount: inventory.tasks.length, mismatchedCount: 0 }
    const expectedCurrentSummary = projectStateDatabaseTaskSummary(effective).currentSummary as Record<string, unknown> | undefined
    const expectedProof = expectedCurrentSummary?.proof
    const actualProof = indexedTask.currentSummary?.proof
    if (JSON.stringify(actualProof) !== JSON.stringify(expectedProof)) mismatchedCount += 1
  }
  return {
    needed: mismatchedCount > 0,
    taskCount: inventory.tasks.length,
    mismatchedCount,
  }
}

/**
 * Older diagnostic snapshots stored task-owned release blockers without the
 * typed task relation. Repair only IDs that the normalized task inventory can
 * prove are task IDs; unknown diagnostic observations stay unclassified.
 */
function diagnosticReadinessTaskIdentityStatus(projectRoot: string): {
  taskIds: Set<string>
  diagnostic: ReturnType<typeof readProjectStateDatabaseDiagnosticProjection>
  missingTaskIdentityCount: number
} {
  const inventory = readProjectStateDatabaseInventory(
    getProjectSystemStatePath(projectRoot, 'TASKS.json'),
    { includeDefinitions: false },
  )
  const diagnostic = readProjectStateDatabaseDiagnosticProjection(projectRoot)
  const taskIds = new Set(inventory?.tasks.map(task => task.id) ?? [])
  const missingTaskIdentityCount = diagnostic?.readiness?.blockers?.filter(blocker =>
    !blocker.taskId && taskIds.has(blocker.id),
  ).length ?? 0
  return { taskIds, diagnostic, missingTaskIdentityCount }
}

/**
 * Cross the current-state boundary once, then stop carrying old queue files in
 * the normal runtime. Deletion is allowed only after SQLite independently
 * provides every task definition and a current summary.
 */
async function finalizeProjectStateBoundary(projectRoot: string): Promise<FinalProjectStateMigrationResult> {
  const metadata = readProjectStateDatabaseMetadata(projectRoot)
  if (metadata === null) throw new Error('No project-state database exists; run the earlier project-state migrations first.')
  if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') {
    throw new Error('Project-state authority is not SQLite; run the earlier authority-promotion migrations before finalization.')
  }

  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
  if (!queue) throw new Error('SQLite cannot provide the complete current queue; no compatibility files were removed.')
  const inventory = readProjectStateDatabaseInventory(tasksPath, { includeDefinitions: true })
  if (!inventory || inventory.total !== queue.tasks.length || inventory.tasks.length !== queue.tasks.length) {
    throw new Error('SQLite task detail index is incomplete; no compatibility files were removed.')
  }
  if (inventory.tasks.some(task => Object.keys(task.definition).length === 0)) {
    throw new Error('SQLite task detail index contains an empty task definition; no compatibility files were removed.')
  }

  const currentSummary = readProjectStateDatabaseSummary(tasksPath)
  if (!currentSummary || currentSummary.freshness !== 'current') {
    backfillProjectSummaryProjection(tasksPath, {
      projectId: path.basename(projectRoot),
      projectRoot,
    })
  }
  const verifiedSummary = readProjectStateDatabaseSummary(tasksPath)
  if (!verifiedSummary || verifiedSummary.freshness !== 'current') {
    throw new Error('SQLite project summary is not current; no compatibility files were removed.')
  }

  const removedPaths: string[] = []
  if (clearProjectStateDatabaseQueueDetail(projectRoot)) {
    removedPaths.push(projectStateDatabasePath(projectRoot))
  }
  removedPaths.push(...await removeLegacyCurrentStateFiles(projectRoot))

  return {
    removedPaths: [...new Set(removedPaths)],
    queueTaskCount: queue.tasks.length,
    summaryFreshness: verifiedSummary.freshness,
  }
}

const RECOVERED_CURRENT_SCOPE_PARENT_TITLE = 'Define Narrative Harness MVP drafting model and physical-world review lanes'
const RECOVERED_CURRENT_SCOPE_CHILD_TITLES = new Set([
  'Select and prove DeepInfra drafting model',
  'Define world-state continuity review lane',
  'Define spatial/geographic continuity review lane',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function taskTitle(task: Record<string, unknown>): string {
  return typeof task.title === 'string' ? task.title.trim() : ''
}

function taskStatus(task: Record<string, unknown>): string {
  return typeof task.status === 'string' ? task.status : ''
}

function taskParentId(task: Record<string, unknown>): string | undefined {
  const hierarchy = task.hierarchy
  return isRecord(hierarchy) && typeof hierarchy.parentId === 'string' ? hierarchy.parentId : undefined
}

function recoveredCurrentScopeTaskIds(tasks: Array<Record<string, unknown>>): Set<string> {
  const parentIds = new Set(
    tasks
      .filter(task => taskTitle(task) === RECOVERED_CURRENT_SCOPE_PARENT_TITLE)
      .map(task => typeof task.id === 'string' ? task.id : undefined)
      .filter((id): id is string => Boolean(id)),
  )
  const ids = new Set<string>()
  for (const task of tasks) {
    const id = typeof task.id === 'string' ? task.id : undefined
    if (!id) continue
    const status = taskStatus(task)
    if (status === 'shelved' || status === 'archived' || status === 'cancelled') continue
    const title = taskTitle(task)
    const isParent = parentIds.has(id)
    const isChild = RECOVERED_CURRENT_SCOPE_CHILD_TITLES.has(title) && parentIds.has(taskParentId(task) ?? '')
    if (isParent || isChild) ids.add(id)
  }
  return ids
}

async function repairClippedTaskTitles(
  projectRoot: string,
  apply: boolean,
): Promise<{ needed: boolean; affectedPaths: string[]; changed: number }> {
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  let raw: string
  try {
    raw = await readManagedTextFile(tasksPath, 'utf8')
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return { needed: false, affectedPaths: [], changed: 0 }
    throw err
  }
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed) || !Array.isArray(parsed.tasks)) {
    return { needed: false, affectedPaths: [], changed: 0 }
  }
  const tasks = parsed.tasks.filter(isRecord)
  const repairs = tasks
    .map(task => {
      const title = typeof task.title === 'string' ? task.title : undefined
      const description = typeof task.description === 'string' ? task.description : undefined
      const recovered = effectiveTaskTitle({ title, description })
      return recovered && recovered !== title ? { task, recovered } : null
    })
    .filter((repair): repair is { task: Record<string, unknown>; recovered: string } => repair !== null)
  if (repairs.length === 0) return { needed: false, affectedPaths: [], changed: 0 }
  if (apply) {
    for (const repair of repairs) repairClippedTaskTitleStrings(repair.task, repair.recovered)
    parsed.lastUpdated = new Date().toISOString()
    writeProjectTaskQueueWithSummary(tasksPath, parsed, {
      projectId: path.basename(projectRoot),
      fullCompatibility: true,
    })
  }
  return { needed: true, affectedPaths: ['system-local project-state/TASKS.json'], changed: repairs.length }
}

function repairClippedTaskTitleStrings(task: Record<string, unknown>, recoveredTitle: string): void {
  const clippedTitle = typeof task.title === 'string' ? task.title : ''
  if (!clippedTitle || clippedTitle === recoveredTitle) return
  replaceClippedTaskTitleStrings(task, clippedTitle, recoveredTitle)
}

function replaceClippedTaskTitleStrings(value: unknown, clippedTitle: string, recoveredTitle: string): unknown {
  if (typeof value === 'string') return value.split(clippedTitle).join(recoveredTitle)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = replaceClippedTaskTitleStrings(value[i], clippedTitle, recoveredTitle)
    return value
  }
  if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) value[key] = replaceClippedTaskTitleStrings(nested, clippedTitle, recoveredTitle)
  }
  return value
}

async function attachRecoveredCurrentScopeTasksToSelectedRelease(
  projectRoot: string,
  apply: boolean,
): Promise<{ needed: boolean; affectedPaths: string[]; changed: number }> {
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  let raw: string
  try {
    raw = await readManagedTextFile(tasksPath, 'utf8')
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return { needed: false, affectedPaths: [], changed: 0 }
    throw err
  }
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed) || !Array.isArray(parsed.tasks)) {
    return { needed: false, affectedPaths: [], changed: 0 }
  }
  const tasks = parsed.tasks.filter(isRecord)
  const derived = deriveReleaseContainersFromTaskMembership(tasks as unknown as Task[])
  const selectedReleaseId = typeof parsed.selectedReleaseId === 'string'
    ? parsed.selectedReleaseId.trim()
    : derived.selectedReleaseId?.trim() ?? ''
  if (!selectedReleaseId) return { needed: false, affectedPaths: [], changed: 0 }
  const recoveredIds = recoveredCurrentScopeTaskIds(tasks)
  if (recoveredIds.size === 0) return { needed: false, affectedPaths: [], changed: 0 }
  const targets = tasks.filter(task =>
    typeof task.id === 'string' &&
    recoveredIds.has(task.id) &&
    !stringArray(task.releaseIds).includes(selectedReleaseId),
  )
  if (targets.length === 0) return { needed: false, affectedPaths: [], changed: 0 }
  if (apply) {
    for (const task of targets) {
      task.releaseIds = [...new Set([...stringArray(task.releaseIds), selectedReleaseId])]
    }
    parsed.selectedReleaseId = selectedReleaseId
    const releases = Array.isArray(parsed.releases) ? parsed.releases.filter(isRecord) : derived.releases as unknown as Array<Record<string, unknown>>
    parsed.releases = releases
    const selectedRelease = releases.find(release => release.id === selectedReleaseId)
    if (selectedRelease) {
      selectedRelease.nodeIds = [...new Set([
        ...stringArray(selectedRelease.nodeIds),
        ...targets.map(task => `work:${String(task.id)}`),
      ])]
    }
    parsed.lastUpdated = new Date().toISOString()
    writeProjectTaskQueueWithSummary(tasksPath, parsed, {
      projectId: path.basename(projectRoot),
      fullCompatibility: true,
    })
  }
  return { needed: true, affectedPaths: ['system-local project-state/TASKS.json'], changed: targets.length }
}

async function detectProjectStateBoundaryCleanup(projectRoot: string): Promise<{
  needed: boolean
  affectedPaths: string[]
}> {
  const entries = await projectStateEntries(projectRoot)
  if (entries.length === 0) return { needed: false, affectedPaths: [] }
  const mode = repoStateMode(projectRoot)
  if (mode === 'off') {
    return {
      needed: true,
      affectedPaths: entries.map(entry => `.guildhall/${entry}`),
    }
  }
  const needsThinManifest = !entries.includes('project-state-manifest.json')
  const legacyEntries = entries.filter(entry => entry !== 'artifacts.yaml' && entry !== 'project-state-manifest.json')
  return {
    needed: needsThinManifest || legacyEntries.length > 0,
    affectedPaths: [
      ...(needsThinManifest ? ['.guildhall/project-state-manifest.json'] : []),
      ...legacyEntries.map(entry => `.guildhall/${entry}`),
    ],
  }
}

function mapLegacyMergePolicyPosition(value: unknown): string | null {
  switch (value) {
    case 'ff_only_local':
      return 'cherry_pick_local'
    case 'ff_only_with_push':
      return 'cherry_pick_with_push'
    case 'manual_pr':
      return 'manual_pr'
    default:
      return null
  }
}

async function readAgentSettingsWithMergePolicy(projectRoot: string): Promise<{
  settings: Record<string, unknown>
  project: Record<string, unknown>
  file: string
} | null> {
  const file = agentSettingsPath(projectRoot)
  let raw: string
  try {
    raw = await readManagedTextFile(file, 'utf8')
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return null
    throw err
  }
  const parsed = parseYaml(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const settings = parsed as Record<string, unknown>
  const project = settings.project
  if (project === null || typeof project !== 'object' || Array.isArray(project)) return null
  if (!Object.prototype.hasOwnProperty.call(project, 'merge_policy')) return null
  return { settings, project: project as Record<string, unknown>, file }
}

async function migrateMergePolicyToLandingStrategy(projectRoot: string): Promise<string[]> {
  const legacySettings = await readAgentSettingsWithMergePolicy(projectRoot)
  if (!legacySettings) return []

  const { settings, project, file } = legacySettings
  const legacy = project.merge_policy
  if (
    project.landing_strategy === undefined &&
    legacy !== null &&
    typeof legacy === 'object' &&
    !Array.isArray(legacy)
  ) {
    const legacyRecord = legacy as Record<string, unknown>
    const position = mapLegacyMergePolicyPosition(legacyRecord.position)
    if (!position) {
      throw new Error('Cannot convert project.merge_policy: unsupported position.')
    }
    project.landing_strategy = {
      ...legacyRecord,
      position,
    }
  } else if (project.landing_strategy === undefined) {
    throw new Error('Cannot convert project.merge_policy: missing legacy entry details.')
  }
  delete project.merge_policy
  await writeManagedTextFile(file, stringifyYaml(settings, { lineWidth: 100 }), 'utf8')
  return ['.guildhall/agent-settings.yaml']
}

export async function readProjectMigrationLedger(projectRoot: string): Promise<ProjectMigrationLedger> {
  try {
    const raw = await readManagedTextFile(ledgerPath(projectRoot), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ProjectMigrationLedger>
    return {
      version: 1,
      records: Array.isArray(parsed.records) ? parsed.records as MigrationLedgerRecord[] : [],
    }
  } catch {
    return { version: 1, records: [] }
  }
}

export async function writeProjectMigrationLedger(
  projectRoot: string,
  ledger: ProjectMigrationLedger,
): Promise<void> {
  const file = ledgerPath(projectRoot)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await writeManagedTextFile(file, `${JSON.stringify({ version: 1, records: ledger.records }, null, 2)}\n`, 'utf8')
  recordGuildhallRuntimeWrite(projectRoot, ['project-migrations.v1'])
}

type ApprovedPlanReleaseMembershipRepair =
  | { state: 'not_applicable' | 'current' }
  | {
      state: 'materialize' | 'conflict'
      current: Awaited<ReturnType<typeof readProjectCanonicalCurrentState>>
      queue: TaskQueueModel
      conflicts: ReturnType<typeof materializeApprovedPlanReleaseMembership>['conflicts']
    }

/**
 * An approved plan is allowed to seed membership exactly once through this
 * explicit repair boundary. Ordinary reads never consult it as a competing
 * scope source. An opposite normalized disposition is an ambiguous history,
 * so the repair reports it instead of choosing based on timing or prose.
 */
async function inspectApprovedPlanReleaseMembershipRepair(
  projectRoot: string,
): Promise<ApprovedPlanReleaseMembershipRepair> {
  const current = await readProjectCanonicalCurrentState(projectRoot)
  if (current.authority !== 'database' || !current.summary?.approvedPlan) {
    return { state: 'not_applicable' }
  }
  const parsedQueue = TaskQueue.safeParse(normalizeLegacyTaskQueueForMigration({ version: 1, ...current.rawQueue }))
  if (!parsedQueue.success) return { state: 'not_applicable' }
  const queue = parsedQueue.data as TaskQueueModel
  const materialized = materializeApprovedPlanReleaseMembership(queue, current.summary.approvedPlan)
  if (materialized.conflicts.length > 0) {
    return { state: 'conflict', current, queue: materialized.queue, conflicts: materialized.conflicts }
  }
  // This repair is deliberately one-way: it only catches an accepted plan
  // whose real tasks were never materialized into the normalized relation.
  // A plan that merely adds a release shell or changes non-membership fields
  // belongs to normal planning, not a historical-state repair.
  const currentReleasesById = new Map((queue.releases ?? []).map(release => [release.id, release]))
  const materializedReleases = materialized.queue.releases ?? []
  const missingMembership = materializedReleases.some(release => {
    const existing = currentReleasesById.get(release.id)
    const existingNodeIds = new Set([...(existing?.nodeIds ?? []), ...(existing?.deferredNodeIds ?? [])])
    return [...release.nodeIds, ...release.deferredNodeIds].some(nodeId => !existingNodeIds.has(nodeId))
  })
  return materialized.changed && missingMembership
    ? { state: 'materialize', current, queue: materialized.queue, conflicts: [] }
    : { state: 'current' }
}

async function materializeApprovedPlanReleaseMembershipAtBoundary(
  projectRoot: string,
): Promise<{ state: 'not_applicable' | 'current' | 'materialized'; membershipCount: number }> {
  const repair = await inspectApprovedPlanReleaseMembershipRepair(projectRoot)
  if (repair.state === 'not_applicable' || repair.state === 'current') {
    return { state: repair.state, membershipCount: 0 }
  }
  if (repair.state === 'conflict') {
    const details = repair.conflicts
      .map(conflict => `${conflict.releaseId}/${conflict.taskId}: ${conflict.existing} vs ${conflict.proposed}`)
      .join(', ')
    throw new Error(`Approved plan release membership conflicts with canonical state (${details}). Reconcile the registered release.membershipTaskIds claim before retrying.`)
  }
  if (repair.state !== 'materialize') {
    throw new Error('Approved plan release membership repair reached an unsupported state.')
  }
  if (repair.current.queueRevision === null || repair.current.projectRevision === null) {
    throw new Error('Approved plan release membership requires a revisioned canonical queue.')
  }
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const prepared = prepareProjectSummaryProjectionFromUnknownQueue(tasksPath, {
    projectId: path.basename(projectRoot),
    projectRoot,
    queue: repair.queue,
    projectionTasks: repair.queue.tasks,
    existingSummary: repair.current.summary,
  })
  if (!prepared.parsedQueue || !prepared.scopeRows) {
    throw new Error('Approved plan release membership could not produce a complete shared projection.')
  }
  writeProjectStateDatabaseTaskBatchMutation(tasksPath, {
    tasks: [],
    releases: (repair.queue.releases ?? []) as unknown as Record<string, unknown>[],
    selectedReleaseId: repair.queue.selectedReleaseId ?? null,
    scopeRows: prepared.scopeRows,
    summary: prepared.projection as unknown as Record<string, unknown>,
    expectedQueueRevision: repair.current.queueRevision,
    expectedProjectRevision: repair.current.projectRevision,
    lastUpdated: repair.queue.lastUpdated ?? null,
  })
  const membershipCount = (repair.queue.releases ?? []).reduce(
    (count, release) => count + release.nodeIds.length + release.deferredNodeIds.length,
    0,
  )
  return { state: 'materialized', membershipCount }
}

function compactReleaseProjectionForComparison(summary: unknown): unknown {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null
  const record = summary as Record<string, unknown>
  const releaseSummary = record.releaseSummary
  const scope = record.scope
  const nextAction = record.nextAction
  return {
    releaseSummary,
    scope,
    nextAction,
  }
}

function inspectIndexedReleaseSummaryReprojection(projectRoot: string): {
  needed: boolean
  before: unknown
  after: unknown
} {
  if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') {
    return { needed: false, before: null, after: null }
  }
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const stored = readProjectStateDatabaseSummary<Record<string, unknown>>(tasksPath)?.payload ?? null
  const projected = buildProjectSummaryProjectionFromIndexedState(tasksPath, {
    projectId: path.basename(projectRoot),
  })
  const before = compactReleaseProjectionForComparison(stored)
  const after = compactReleaseProjectionForComparison(projected)
  return {
    needed: before !== null && after !== null && JSON.stringify(before) !== JSON.stringify(after),
    before,
    after,
  }
}

const BUILT_IN_PROJECT_MIGRATIONS: ProjectMigrationDefinition[] = [
  {
    id: '0.8.0/provider-config-globalization',
    title: 'Move project-local provider credentials into machine provider storage',
    introducedIn: '0.8.0',
    scope: 'project',
    safety: 'automatic',
    summary: 'Moves legacy API keys out of project-local config and into the machine-scoped provider store.',
    async detect(projectRoot) {
      const config = readProjectConfig(projectRoot)
      const affectedPaths: string[] = []
      if ((config.anthropicApiKey ?? '').trim()) affectedPaths.push('.guildhall/config.yaml')
      if ((config.openaiApiKey ?? '').trim()) affectedPaths.push('.guildhall/config.yaml')
      const lmStudioUrl = (config.lmStudioUrl ?? '').trim()
      if (lmStudioUrl && lmStudioUrl !== 'http://localhost:1234/v1') affectedPaths.push('.guildhall/config.yaml')
      return { needed: affectedPaths.length > 0, affectedPaths: [...new Set(affectedPaths)] }
    },
    async apply(projectRoot) {
      const report = migrateProjectProvidersToGlobal(projectRoot, {
        readProject: (p) => readProjectConfig(p),
        writeProject: (p, patch) => updateProjectConfig(p, patch),
      })
      const moved = [
        report.movedAnthropic ? 'Anthropic API key' : null,
        report.movedOpenAi ? 'OpenAI-compatible API key' : null,
        report.movedLlamaUrl ? 'local model URL' : null,
      ].filter((item): item is string => item !== null)
      return {
        summary: moved.length > 0
          ? `Moved ${moved.join(', ')} into machine provider storage.`
          : 'Provider credentials were already in machine provider storage.',
        affectedPaths: ['.guildhall/config.yaml'],
      }
    },
  },
  {
    id: '0.8.0/project-state-layout',
    title: 'Move legacy project memory into split project state',
    introducedIn: '0.8.0',
    scope: 'project',
    safety: 'prompt',
    requirement: 'required',
    summary: 'Moves old ./memory project notes into .guildhall and local Guildhall history.',
    async detect(projectRoot) {
      const memoryDir = path.join(projectRoot, 'memory')
      try {
        const entries = await fs.readdir(memoryDir)
        return { needed: entries.length > 0, affectedPaths: entries.length > 0 ? ['memory/'] : [] }
      } catch {
        return { needed: false, affectedPaths: [] }
      }
    },
    async apply(projectRoot) {
      const result = await migrateLegacyMemoryToLocalHistory({
        projectRoot,
        dryRun: false,
        deleteSource: true,
        updateGitignore: true,
      })
      return {
        summary: repoStateMode(projectRoot) === 'thin'
          ? `Moved ${result.copied} legacy memory file${result.copied === 1 ? '' : 's'} into system-local project history and wrote the thin repo manifest.`
          : `Moved ${result.copied} legacy memory file${result.copied === 1 ? '' : 's'} into system-local project history and cleared repo-local Guildhall state.`,
        affectedPaths: [
          'memory/',
          ...(result.compaction?.repoStateMode === 'thin' ? ['.guildhall/project-state-manifest.json'] : []),
          ...(result.compaction?.evacuatedProjectStatePaths ?? []).map(item => `.guildhall/${item}`),
          ...(result.compaction?.evacuationManifestPath ? [result.compaction.evacuationManifestPath] : []),
          ...result.gitignoreRoots.map(root => path.relative(projectRoot, root) || '.'),
        ],
      }
    },
  },
  {
    id: '0.8.0/task-state-split',
    title: 'Move bulky task runtime state out of task definitions',
    introducedIn: '0.8.0',
    scope: 'project',
    safety: 'prompt',
    summary: 'Keeps compact task definitions in .guildhall/TASKS.json and moves runtime/evidence details to local history.',
    async detect(projectRoot) {
      try {
        const result = await migrateTaskState({ projectRoot, apply: false })
        return {
          needed: result.taskDefinitionsRewritten > 0 || result.evidenceRecords > 0,
          affectedPaths: result.taskDefinitionsRewritten > 0 ? ['.guildhall/TASKS.json'] : [],
        }
      } catch {
        return { needed: false, affectedPaths: [] }
      }
    },
    async apply(projectRoot) {
      const result = await migrateTaskState({ projectRoot, apply: true })
      return {
        summary: `Rewrote ${result.taskDefinitionsRewritten} task definition${result.taskDefinitionsRewritten === 1 ? '' : 's'} and moved ${result.evidenceRecords} evidence record${result.evidenceRecords === 1 ? '' : 's'}.`,
        affectedPaths: [
          '.guildhall/TASKS.json',
          ...(result.backupPath ? [result.backupPath] : []),
          ...(result.manifestPath ? [result.manifestPath] : []),
        ],
      }
    },
  },
  {
    id: '0.10.0/task-hierarchy-links',
    title: 'Convert parent task status into explicit work hierarchy links',
    introducedIn: '0.10.0',
    scope: 'project',
    safety: 'prompt',
    requirement: 'required',
    summary: 'Rewrites status: parent and hierarchy-shaped parentGoalId fields into task.hierarchy links.',
    async detect(projectRoot) {
      const result = await migrateTaskHierarchyState({ projectRoot, apply: false })
      return {
        needed: result.changedTasks.length > 0,
        affectedPaths: result.affectedPaths,
      }
    },
    async apply(projectRoot) {
      const result = await migrateTaskHierarchyState({ projectRoot, apply: true })
      return {
        summary: `Converted ${result.changedTasks.length} task hierarchy record${result.changedTasks.length === 1 ? '' : 's'} into explicit links.`,
        affectedPaths: result.affectedPaths,
      }
    },
  },
  {
    id: '0.10.0/task-open-questions-to-bounded-chat',
    title: 'Move task questions into owner-input bounded chat',
    introducedIn: '0.10.0',
    scope: 'project',
    safety: 'prompt',
    requirement: 'required',
    summary: 'Converts task-local openQuestions into linked owner-input requests and bounded-chat sessions.',
    async detect(projectRoot) {
      const result = await migrateTaskQuestionsToBoundedChat({
        projectRoot,
        projectId: path.basename(projectRoot),
        apply: false,
      })
      return {
        needed: result.changedTasks.length > 0,
        affectedPaths: result.affectedPaths,
      }
    },
    async apply(projectRoot) {
      const result = await migrateTaskQuestionsToBoundedChat({
        projectRoot,
        projectId: path.basename(projectRoot),
        apply: true,
      })
      return {
        summary: `Moved ${result.changedTasks.length} task question record${result.changedTasks.length === 1 ? '' : 's'} into owner-input bounded chat.`,
        affectedPaths: result.affectedPaths,
      }
    },
  },
  {
    id: '0.10.0/task-delivery-steps',
    title: 'Mark verification child tasks as delivery steps',
    introducedIn: '0.10.0',
    scope: 'project',
    safety: 'automatic',
    summary: 'Adds explicit workVisibility and deliverySteps metadata so verification child tasks stay attached to their logical work item.',
    async detect(projectRoot) {
      const result = await migrateTaskDeliveryStepState({ projectRoot, apply: false })
      return {
        needed: result.changedTasks.length > 0,
        affectedPaths: result.affectedPaths,
      }
    },
    async apply(projectRoot) {
      const result = await migrateTaskDeliveryStepState({ projectRoot, apply: true })
      return {
        summary: `Marked ${result.changedTasks.length} task record${result.changedTasks.length === 1 ? '' : 's'} with explicit delivery-step metadata.`,
        affectedPaths: result.affectedPaths,
      }
    },
  },
  {
    id: '0.11.0/execution-planning-decomposition',
    title: 'Convert legacy split recommendations into execution-planning records',
    introducedIn: '0.11.0',
    scope: 'project',
    safety: 'prompt',
    requirement: 'required',
    summary: 'Migrates represented legacy split recommendations into execution action audit records and routes unmaterialized recommendations to coordinator recovery.',
    async detect(projectRoot) {
      const result = await migrateWorkDecompositionState({ projectRoot, apply: false })
      return {
        needed: result.changedTasks.length > 0 || result.createdActions.length > 0,
        affectedPaths: result.affectedPaths,
      }
    },
    async apply(projectRoot) {
      const result = await migrateWorkDecompositionState({ projectRoot, apply: true })
      return {
        summary: `Recorded ${result.createdActions.length} execution-planning decomposition action${result.createdActions.length === 1 ? '' : 's'} for ${result.changedTasks.length} task record${result.changedTasks.length === 1 ? '' : 's'}.`,
        affectedPaths: result.affectedPaths,
      }
    },
  },
  {
    id: '0.10.0/owner-input-state-repair',
    title: 'Repair stale owner-input bounded-chat state',
    introducedIn: '0.10.0',
    scope: 'project',
    safety: 'prompt',
    requirement: 'required',
    summary: 'Cancels malformed or containable owner-input questions created by older task-question migrations.',
    async detect(projectRoot) {
      const result = await repairOwnerInputState({ projectRoot, apply: false })
      return {
        needed: result.cancelledInvalid.length > 0 ||
          result.resolvedByAssumption.length > 0 ||
          result.cancelledDuplicates.length > 0,
        affectedPaths: result.affectedPaths,
      }
    },
    async apply(projectRoot) {
      const result = await repairOwnerInputState({ projectRoot, apply: true })
      const repaired = result.cancelledInvalid.length +
        result.resolvedByAssumption.length +
        result.cancelledDuplicates.length
      return {
        summary: `Repaired ${repaired} owner-input record${repaired === 1 ? '' : 's'} that should not block unattended work.`,
        affectedPaths: result.affectedPaths,
      }
    },
  },
  {
    id: '0.10.1/owner-input-source-trail-leadin-repair',
    title: 'Repair source-trail owner-input lead-ins',
    introducedIn: '0.10.1',
    scope: 'project',
    safety: 'prompt',
    requirement: 'required',
    summary: 'Repairs persisted owner-input records whose prompt is only a source-trail lead-in instead of an answerable owner question.',
    async detect(projectRoot) {
      const result = await repairOwnerInputState({
        projectRoot,
        apply: false,
        repairId: '0.10.1/owner-input-source-trail-leadin-repair',
      })
      return {
        needed: result.cancelledInvalid.length > 0,
        affectedPaths: result.affectedPaths,
      }
    },
    async apply(projectRoot) {
      const result = await repairOwnerInputState({
        projectRoot,
        apply: true,
        repairId: '0.10.1/owner-input-source-trail-leadin-repair',
      })
      return {
        summary: `Repaired ${result.cancelledInvalid.length} source-trail owner-input lead-in${result.cancelledInvalid.length === 1 ? '' : 's'} that could not be answered by the owner.`,
        affectedPaths: result.affectedPaths,
      }
    },
  },
  {
    id: '0.10.0/merge-policy-to-landing-strategy',
    title: 'Convert merge policy to landing strategy',
    introducedIn: '0.10.0',
    scope: 'project',
    safety: 'prompt',
    requirement: 'required',
    summary: 'Rewrites deprecated project.merge_policy lever settings into landing_strategy and removes the old key.',
    async detect(projectRoot) {
      const legacySettings = await readAgentSettingsWithMergePolicy(projectRoot)
      return {
        needed: legacySettings !== null,
        affectedPaths: legacySettings ? ['.guildhall/agent-settings.yaml'] : [],
      }
    },
    async apply(projectRoot) {
      const affectedPaths = await migrateMergePolicyToLandingStrategy(projectRoot)
      return {
        summary: affectedPaths.length > 0
          ? 'Converted merge_policy to landing_strategy.'
          : 'No deprecated merge_policy setting was present.',
        affectedPaths,
      }
    },
  },
  {
    id: '0.10.0/project-state-storage-boundary',
    title: 'Clear repo-local Guildhall state unless thin state is opted in',
    introducedIn: '0.10.0',
    scope: 'project',
    safety: 'prompt',
    requirement: 'required',
    summary: 'Evacuates repo-local Guildhall state into system-local storage, or writes only the opted-in thin current-shape manifest.',
    async detect(projectRoot) {
      return detectProjectStateBoundaryCleanup(projectRoot)
    },
    async apply(projectRoot) {
      const mode = repoStateMode(projectRoot)
      const compaction = await compactProjectState({ projectRoot, dryRun: false })
      if (mode === 'thin') {
        const affectedPaths = await finalizeThinProjectStateManifest(projectRoot)
        return {
          summary: 'Wrote thin repo state with only the current active shape; historical Guildhall state remains system-local.',
          affectedPaths,
        }
      }
      return {
        summary: `Evacuated ${compaction.evacuatedProjectStatePaths.length} repo-local Guildhall state entr${compaction.evacuatedProjectStatePaths.length === 1 ? 'y' : 'ies'} into system-local storage.`,
        affectedPaths: [
          ...compaction.evacuatedProjectStatePaths.map(entry => `.guildhall/${entry}`),
          ...(compaction.evacuationManifestPath ? [compaction.evacuationManifestPath] : []),
        ],
      }
    },
  },
  {
    id: '0.10.0/restore-evacuated-task-state',
    title: 'Restore active tasks stranded by project-state evacuation',
    introducedIn: '0.10.0',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    recheckAfterApply: true,
    summary: 'Copies missing tasks and readable task index/archive files from evacuated project-state back into system-local storage.',
    async detect(projectRoot) {
      const result = await restoreEvacuatedTaskState(projectRoot, false)
      return {
        needed: result.needed,
        affectedPaths: result.affectedPaths,
      }
    },
    async apply(projectRoot) {
      const result = await restoreEvacuatedTaskState(projectRoot, true)
      return {
        summary: result.restored > 0
          ? `Restored ${result.restored} evacuated task${result.restored === 1 ? '' : 's'} and ${result.restoredTaskStateFiles} readable task state file${result.restoredTaskStateFiles === 1 ? '' : 's'} into system-local storage.`
          : result.restoredTaskStateFiles > 0
            ? `Restored ${result.restoredTaskStateFiles} readable task state file${result.restoredTaskStateFiles === 1 ? '' : 's'} into system-local storage.`
            : 'No evacuated task state needed restoration.',
        affectedPaths: result.affectedPaths,
      }
    },
  },
  {
    id: '0.10.1/restore-evacuated-shaped-task-state',
    title: 'Restore shaped task details masked by imported drafts',
    introducedIn: '0.10.1',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    recheckAfterApply: true,
    summary: 'Repairs spec, brief, and acceptance criteria from evacuated task records when a same-id system-local task is still a hollow imported draft.',
    async detect(projectRoot) {
      const result = await restoreEvacuatedTaskState(projectRoot, false)
      return {
        needed: result.needed,
        affectedPaths: result.affectedPaths,
      }
    },
    async apply(projectRoot) {
      const result = await restoreEvacuatedTaskState(projectRoot, true)
      const repaired = result.enriched + result.titleRepaired
      return {
        summary: repaired > 0
          ? `Restored shaped details for ${result.enriched} imported draft task${result.enriched === 1 ? '' : 's'} and repaired ${result.titleRepaired} clipped task title${result.titleRepaired === 1 ? '' : 's'}.`
          : 'No shaped imported draft details needed restoration.',
        affectedPaths: result.affectedPaths,
      }
    },
  },
  {
    id: '0.10.1/restore-evacuated-archive-shaped-task-state',
    title: 'Restore shaped archived task details masked by imported drafts',
    introducedIn: '0.10.1',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    recheckAfterApply: true,
    summary: 'Repairs spec, brief, acceptance criteria, and done evidence from evacuated task archive records when a same-id system-local task is still a hollow imported draft.',
    async detect(projectRoot) {
      const result = await restoreEvacuatedTaskState(projectRoot, false)
      return {
        needed: result.needed,
        affectedPaths: result.affectedPaths,
      }
    },
    async apply(projectRoot) {
      const result = await restoreEvacuatedTaskState(projectRoot, true)
      const repaired = result.enriched + result.titleRepaired
      return {
        summary: repaired > 0
          ? `Restored archived shaped details for ${result.enriched} imported draft task${result.enriched === 1 ? '' : 's'} and repaired ${result.titleRepaired} clipped task title${result.titleRepaired === 1 ? '' : 's'}.`
          : 'No archived shaped imported draft details needed restoration.',
        affectedPaths: result.affectedPaths,
      }
    },
  },
  {
    id: '0.10.1/repair-clipped-task-titles',
    title: 'Repair clipped task titles',
    introducedIn: '0.10.1',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Repairs task titles that were accidentally saved as cropped display text when the source-backed description contains the full title.',
    async detect(projectRoot) {
      const result = await repairClippedTaskTitles(projectRoot, false)
      return {
        needed: result.needed,
        affectedPaths: result.affectedPaths,
      }
    },
    async apply(projectRoot) {
      const result = await repairClippedTaskTitles(projectRoot, true)
      return {
        summary: result.changed > 0
          ? `Repaired ${result.changed} clipped task title${result.changed === 1 ? '' : 's'}.`
          : 'No clipped task titles needed repair.',
        affectedPaths: result.affectedPaths,
      }
    },
  },
  {
    id: '0.10.1/attach-recovered-current-scope-work-to-selected-release',
    title: 'Attach recovered current-scope work to the selected release',
    introducedIn: '0.10.1',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Repairs recovered owner-requirement task records that were materialized as current MVP work but saved without selected-release membership.',
    async detect(projectRoot) {
      const result = await attachRecoveredCurrentScopeTasksToSelectedRelease(projectRoot, false)
      return {
        needed: result.needed,
        affectedPaths: result.affectedPaths,
      }
    },
    async apply(projectRoot) {
      const result = await attachRecoveredCurrentScopeTasksToSelectedRelease(projectRoot, true)
      return {
        summary: result.changed > 0
          ? `Attached ${result.changed} recovered current-scope task${result.changed === 1 ? '' : 's'} to the selected release.`
          : 'No recovered current-scope tasks needed release repair.',
        affectedPaths: result.affectedPaths,
      }
    },
  },
  {
    id: '0.11.0/project-summary-projection',
    title: 'Backfill the project summary read model',
    introducedIn: '0.11.0',
    scope: 'project',
    safety: 'automatic',
    summary: 'Builds a compact, system-local project summary from the existing task queue so fleet reads do not reconstruct project state on demand.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      const needed = projectSummaryProjectionNeedsBackfill(tasksPath)
      return {
        needed,
        affectedPaths: needed ? ['system-local project-state/project-summary.json'] : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      // This is the pre-SQLite backfill. Its explicit job is to materialize a
      // compact summary from the historical task queue before database
      // authority exists; the indexed writer is only valid after that cutover.
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: projection.freshness === 'error'
          ? 'Created an explicit error summary because the existing task queue could not be parsed; task history was not rewritten.'
          : `Backfilled the project summary for ${projection.counts.total} task${projection.counts.total === 1 ? '' : 's'}.`,
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
  },
  {
    id: '0.11.1/project-summary-projection-v2',
    title: 'Refresh the project summary read model shape',
    introducedIn: '0.11.1',
    scope: 'project',
    safety: 'automatic',
    summary: 'Refreshes the compact project summary after its release, proof, status-count, and in-flight fields were added; canonical task and release records are unchanged.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      return {
        needed: projectSummaryProjectionNeedsBackfill(tasksPath),
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: projection.freshness === 'error'
          ? 'Created an explicit error summary because the existing task queue could not be parsed; task history was not rewritten.'
          : `Refreshed the project summary for ${projection.counts.total} task${projection.counts.total === 1 ? '' : 's'} without changing task or release records.`,
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
  },
  {
    id: '0.11.2/project-summary-projection-setup-state',
    title: 'Refresh project summaries with pending setup state',
    introducedIn: '0.11.2',
    scope: 'project',
    safety: 'automatic',
    summary: 'Refreshes the compact project summary so setup work is distinct from an empty terminal execution scope; canonical task and release records are unchanged.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      return {
        needed: true,
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
      })
      return {
        summary: projection.freshness === 'error'
          ? 'Created an explicit error summary because the existing task queue could not be parsed; task history was not rewritten.'
          : `Refreshed the project summary for ${projection.counts.total} task${projection.counts.total === 1 ? '' : 's'} with setup-state next actions.`,
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
  },
  {
    id: '0.11.3/project-summary-approved-plan',
    title: 'Refresh project summaries with approved planning state',
    introducedIn: '0.11.3',
    scope: 'project',
    safety: 'automatic',
    summary: 'Adds the compact approved-plan projection beside executable task state so fast reads can show what was accepted for the project without loading the full import documents.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      return {
        needed: projectSummaryProjectionNeedsBackfill(tasksPath),
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
      })
      return {
        summary: projection.freshness === 'error'
          ? 'Created an explicit error summary because the existing task queue could not be parsed; task history was not rewritten.'
          : `Refreshed the project summary for ${projection.counts.total} task${projection.counts.total === 1 ? '' : 's'} with approved planning state.`,
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
  },
  {
    id: '0.11.4/project-summary-approved-scope-selection',
    title: 'Refresh project summaries with approved scope selection',
    introducedIn: '0.11.4',
    scope: 'project',
    safety: 'automatic',
    summary: 'Rebuilds the compact summary so approved release membership can select the read-model scope without mutating the authoritative task queue.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      return {
        needed: true,
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
      })
      return {
        summary: projection.freshness === 'error'
          ? 'Created an explicit error summary because the existing task queue could not be parsed; task history was not rewritten.'
          : `Refreshed the project summary scope for ${projection.counts.total} task${projection.counts.total === 1 ? '' : 's'} without changing authoritative records.`,
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
  },
  {
    id: '0.11.5/project-summary-release-membership-authority',
    title: 'Refresh project summaries with queue-owned release membership',
    introducedIn: '0.11.5',
    scope: 'project',
    safety: 'automatic',
    summary: 'Rebuilds compact summaries after release scope precedence was corrected so approved planning cannot widen an explicitly assigned queue release.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      return {
        needed: true,
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
      })
      return {
        summary: projection.freshness === 'error'
          ? 'Created an explicit error summary because the existing task queue could not be parsed; task history was not rewritten.'
          : `Refreshed queue-owned release membership for ${projection.counts.total} task${projection.counts.total === 1 ? '' : 's'} without changing authoritative records.`,
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
  },
  {
    id: '0.12.0/project-state-database',
    title: 'Build the canonical project-state database',
    introducedIn: '0.12.0',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Materializes normalized current project state in a local SQLite store so fleet and project summaries do not parse and rehydrate the full task queue on every read.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      // A legacy-only project can continue to use its compatibility reader;
      // the first managed queue write seeds the database. Do not turn the
      // storage migration into an unrelated start blocker for such projects.
      try {
        await fs.access(getProjectSystemStatePath(projectRoot, 'project-summary.json'))
      } catch {
        try {
          await fs.access(projectStateDatabasePath(projectRoot))
        } catch {
          return { needed: false, affectedPaths: [] }
        }
      }
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      const schemaOutdated = (metadata?.schemaVersion ?? 0) < PROJECT_STATE_DATABASE_SCHEMA_VERSION
      const queueEnvelopeMissing = metadata !== null && readProjectStateDatabaseQueueWithRevision(tasksPath, { migration: true }) === null
      const summaryMissing = metadata !== null && readProjectStateDatabaseSummary(tasksPath) === null
      return {
        needed: metadata === null || schemaOutdated || queueEnvelopeMissing || summaryMissing,
        affectedPaths: metadata !== null && !schemaOutdated && !queueEnvelopeMissing && !summaryMissing
          ? []
          : [projectStateDatabasePath(projectRoot)],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
      })
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const taskIds = queue?.tasks
        .map(task => task.id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0) ?? []
      const overlays = await backfillTaskStateDatabaseOverlays(projectRoot, taskIds)
      return {
        summary: projection.freshness === 'error'
          ? 'Created an explicit error summary and state database because the existing task queue could not be parsed; task history was not rewritten.'
          : `Built the normalized project-state database for ${projection.counts.total} task${projection.counts.total === 1 ? '' : 's'} and imported ${overlays.runtime + overlays.workspace} current runtime/workspace overlay row${overlays.runtime + overlays.workspace === 1 ? '' : 's'}.`,
        affectedPaths: [projectStateDatabasePath(projectRoot), getProjectSystemStatePath(projectRoot, 'project-summary.json')],
      }
    },
  },
  {
    id: '0.12.1/project-state-database-rollback-journal',
    title: 'Move project-state databases to the read-safe journal mode',
    introducedIn: '0.12.1',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Converts version 2 project-state databases from WAL to a rollback journal so read-only routes do not create durable sidecar files.',
    async detect(projectRoot) {
      try {
        await fs.access(projectStateDatabasePath(projectRoot))
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      const needed = (metadata?.schemaVersion ?? 0) < PROJECT_STATE_DATABASE_SCHEMA_VERSION || hasLegacyProjectLiveState(projectRoot)
      return {
        needed,
        affectedPaths: needed ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
      })
      return {
        summary: projection.freshness === 'error'
          ? 'Rebuilt the project-state database in rollback-journal mode with an explicit error summary; task history was not rewritten.'
          : `Converted the project-state database for ${projection.counts.total} task${projection.counts.total === 1 ? '' : 's'} to rollback-journal mode without changing task history.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: '0.12.2/project-summary-orientation-snapshot',
    title: 'Materialize project orientation from approved sources',
    introducedIn: '0.12.2',
    scope: 'project',
    safety: 'automatic',
    summary: 'Captures the project charter and source trail during an explicit refresh so compact Overview and Map reads never rescan repository documents.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      const projection = readProjectSummaryProjectionForMigration(tasksPath)
      return {
        needed: !projection?.orientation,
        affectedPaths: !projection?.orientation
          ? ['system-local project-state/project-summary.json']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: projection.orientation
          ? 'Captured the durable project orientation snapshot without changing task or release records.'
          : 'Recorded that this project has no charter source yet; task and release records were unchanged.',
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
  },
  {
    id: '0.12.4/project-summary-orientation-source-dedupe',
    title: 'Deduplicate orientation source aliases',
    introducedIn: '0.12.4',
    scope: 'project',
    safety: 'automatic',
    summary: 'Refreshes orientation snapshots so one physical source document cannot be counted twice through case-only path aliases.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      const refs = readProjectSummaryProjectionForMigration(tasksPath)?.orientation?.sourceRefs ?? []
      return {
        needed: new Set(refs.map(ref => ref.toLowerCase())).size !== refs.length,
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
    async apply(projectRoot) {
      const projection = backfillProjectSummaryProjection(getProjectSystemStatePath(projectRoot, 'TASKS.json'), {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: projection.orientation
          ? 'Refreshed the orientation snapshot with canonical source references.'
          : 'Confirmed that no orientation source snapshot is available yet.',
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
  },
  {
    id: '0.12.5/project-summary-map-read-model',
    title: 'Materialize the compact project map',
    introducedIn: '0.12.5',
    scope: 'project',
    safety: 'automatic',
    summary: 'Builds the compact Map tree with the project summary so opening Map does not rebuild orientation from every task row.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      const projection = readProjectSummaryProjectionForMigration(tasksPath)
      return {
        needed: !projection?.orientationSpine,
        affectedPaths: !projection?.orientationSpine
          ? ['system-local project-state/project-summary.json']
          : [],
      }
    },
    async apply(projectRoot) {
      const projection = backfillProjectSummaryProjection(getProjectSystemStatePath(projectRoot, 'TASKS.json'), {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: projection.orientationSpine
          ? 'Materialized the compact Map read model without changing task, release, or evidence records.'
          : 'Recorded an unavailable Map read model because the project summary could not be built.',
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
  },
  {
    id: '0.12.6/project-summary-map-source-budget',
    title: 'Bound repeated map provenance',
    introducedIn: '0.12.6',
    scope: 'project',
    safety: 'automatic',
    summary: 'Rebuilds the compact Map tree with bounded per-node provenance so repeated source lists cannot dominate the initial response.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      const projection = readProjectSummaryProjectionForMigration(tasksPath)
      const projectionVersion = (projection as { version?: number } | null)?.version
      return {
        needed: projectionVersion !== 6,
        affectedPaths: projectionVersion !== 6
          ? ['system-local project-state/project-summary.json']
          : [],
      }
    },
    async apply(projectRoot) {
      const projection = backfillProjectSummaryProjection(getProjectSystemStatePath(projectRoot, 'TASKS.json'), {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: projection.orientationSpine
          ? 'Rebuilt the compact Map with bounded repeated provenance; task, release, proof, and history records were unchanged.'
          : 'Recorded an unavailable Map read model because the project summary could not be built.',
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
  },
  {
    id: '0.12.7/project-summary-map-scope-budget',
    title: 'Keep the project map at project scale',
    introducedIn: '0.12.7',
    scope: 'project',
    safety: 'automatic',
    summary: 'Rebuilds Map summaries with a bounded scope ledger; the complete ledger remains available in Work.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      const projection = readProjectSummaryProjectionForMigration(tasksPath)
      const projectionVersion = (projection as { version?: number } | null)?.version
      return {
        needed: projectionVersion !== 7,
        affectedPaths: projectionVersion !== 7
          ? ['system-local project-state/project-summary.json']
          : [],
      }
    },
    async apply(projectRoot) {
      const projection = backfillProjectSummaryProjection(getProjectSystemStatePath(projectRoot, 'TASKS.json'), {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: projection.orientationSpine
          ? 'Rebuilt the project-scale Map ledger without changing task, release, proof, or history records.'
          : 'Recorded an unavailable Map read model because the project summary could not be built.',
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
  },
  {
    id: '0.12.8/project-work-scope-read-model',
    title: 'Materialize selected work scope rows',
    introducedIn: '0.12.8',
    scope: 'project',
    safety: 'automatic',
    summary: 'Stores selected-scope membership beside normalized work rows so Work and Overview do not rebuild scope from the full task queue during a read.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      const projection = readProjectSummaryProjectionForMigration(tasksPath)
      const projectionVersion = (projection as { version?: number } | null)?.version
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      const needed = projectionVersion !== 8 || (metadata?.schemaVersion ?? 0) < PROJECT_STATE_DATABASE_SCHEMA_VERSION
      return {
        needed,
        affectedPaths: needed
          ? [projectStateDatabasePath(projectRoot), 'system-local project-state/project-summary.json']
          : [],
      }
    },
    async apply(projectRoot) {
      const projection = backfillProjectSummaryProjection(getProjectSystemStatePath(projectRoot, 'TASKS.json'), {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: projection.freshness === 'error'
          ? 'Recorded an unavailable work-scope read model because the project summary could not be built.'
          : 'Materialized selected work scope rows without changing task, release, proof, or history records.',
        affectedPaths: [projectStateDatabasePath(projectRoot), 'system-local project-state/project-summary.json'],
      }
    },
  },
  {
    id: '0.12.9/project-map-payload-budget',
    title: 'Remove repeated project-map detail',
    introducedIn: '0.12.9',
    scope: 'project',
    safety: 'automatic',
    summary: 'Rebuilds the project map with title, state, and bounded provenance only; full task detail stays behind explicit task reads.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      const projection = readProjectSummaryProjectionForMigration(tasksPath)
      const projectionVersion = (projection as { version?: number } | null)?.version
      return {
        needed: projectionVersion !== 9,
        affectedPaths: projectionVersion !== 9
          ? ['system-local project-state/project-summary.json']
          : [],
      }
    },
    async apply(projectRoot) {
      const projection = backfillProjectSummaryProjection(getProjectSystemStatePath(projectRoot, 'TASKS.json'), {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: projection.freshness === 'error'
          ? 'Recorded an unavailable compact Map because the project summary could not be built.'
          : 'Removed repeated Map-only detail without changing task, release, proof, or history records.',
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
  },
  {
    id: '0.12.10/project-map-navigator-node-budget',
    title: 'Remove empty and duplicate Map node fields',
    introducedIn: '0.12.10',
    scope: 'project',
    safety: 'automatic',
    summary: 'Rebuilds the Map navigator with only its visible hierarchy, state, and task link; task prose and source detail stay in their owning projections.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      const projection = readProjectSummaryProjectionForMigration(tasksPath)
      const projectionVersion = (projection as { version?: number } | null)?.version
      return {
        needed: projectionVersion !== 10,
        affectedPaths: projectionVersion !== 10
          ? ['system-local project-state/project-summary.json']
          : [],
      }
    },
    async apply(projectRoot) {
      const projection = backfillProjectSummaryProjection(getProjectSystemStatePath(projectRoot, 'TASKS.json'), {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: projection.freshness === 'error'
          ? 'Recorded an unavailable compact Map because the project summary could not be built.'
          : 'Removed unused and empty Map node fields without changing task, release, proof, source, or history records.',
        affectedPaths: ['system-local project-state/project-summary.json'],
      }
    },
  },
  {
    id: '0.12.11/project-live-state-consolidation',
    title: 'Consolidate live project controls',
    introducedIn: '0.12.11',
    scope: 'project',
    safety: 'automatic',
    summary: 'Moves project availability, attention history, and reconciliation acknowledgements into the current-state database without deleting legacy files.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      const needed = (metadata?.schemaVersion ?? 0) < PROJECT_STATE_DATABASE_SCHEMA_VERSION
      return {
        needed,
        affectedPaths: needed
          ? [projectStateDatabasePath(projectRoot), 'system-local legacy live-state compatibility files']
          : [],
      }
    },
    async apply(projectRoot) {
      const migrated = migrateLegacyProjectLiveState(projectRoot)
      return {
        summary: migrated.length > 0
          ? `Consolidated ${migrated.join(', ')} into the current-state database; legacy files remain as compatibility input.`
          : 'Initialized the live-state database schema; no legacy live-state records needed importing.',
        affectedPaths: [projectStateDatabasePath(projectRoot), ...migrated.map(path => `system-local ${path}`)],
      }
    },
  },
  {
    id: '0.12.12/work-item-list-projection',
    title: 'Materialize bounded work-list rows',
    introducedIn: '0.12.12',
    scope: 'project',
    safety: 'automatic',
    summary: 'Builds the small task-card projection used by Work and Overview so list reads never open full task definitions or reconstruct a queue.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      const needed = (metadata?.schemaVersion ?? 0) < PROJECT_STATE_DATABASE_SCHEMA_VERSION
      return {
        needed,
        affectedPaths: needed ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
    async apply(projectRoot) {
      const projection = backfillProjectSummaryProjection(getProjectSystemStatePath(projectRoot, 'TASKS.json'), {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: projection.freshness === 'error'
          ? 'Initialized the bounded work-list schema, but the existing task queue could not produce a current projection.'
          : `Materialized bounded Work rows for ${projection.counts.total} task${projection.counts.total === 1 ? '' : 's'} without changing task definitions.`,
        affectedPaths: [projectStateDatabasePath(projectRoot), getProjectSystemStatePath(projectRoot, 'project-summary.json')],
      }
    },
  },
  {
    id: '0.12.13/database-queue-envelope',
    title: 'Materialize the database queue envelope',
    introducedIn: '0.12.13',
    scope: 'project',
    safety: 'automatic',
    summary: 'Stores queue version, last update, and selected release beside normalized task and release definitions so detail reads can use one database aggregate.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      const needed = (metadata?.schemaVersion ?? 0) < PROJECT_STATE_DATABASE_SCHEMA_VERSION
      return {
        needed,
        affectedPaths: needed ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
    async apply(projectRoot) {
      const projection = backfillProjectSummaryProjection(getProjectSystemStatePath(projectRoot, 'TASKS.json'), {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: projection.freshness === 'error'
          ? 'Initialized the database queue envelope, but the legacy queue could not produce a current projection.'
          : `Materialized the database queue envelope for ${projection.counts.total} task${projection.counts.total === 1 ? '' : 's'} without changing compatibility records.`,
        affectedPaths: [projectStateDatabasePath(projectRoot), getProjectSystemStatePath(projectRoot, 'project-summary.json')],
      }
    },
  },
  {
    id: '0.12.14/task-current-overlay',
    title: 'Import current task overlays into the project database',
    introducedIn: '0.12.14',
    scope: 'project',
    safety: 'automatic',
    summary: 'Imports current runtime, workspace, and latest-proof facts into the project database without rewriting task definitions or evidence history.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      // Initial database creation imports these overlays atomically. Once a
      // database exists, this compatibility migration is retired and must not
      // reopen sidecars as a second current-state source.
      if (readProjectStateDatabaseMetadata(projectRoot) !== null) {
        return { needed: false, affectedPaths: [] }
      }
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      return {
        needed: true,
        affectedPaths: [projectStateDatabasePath(projectRoot), 'system-local task runtime/workspace/evidence history'],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      if (!readProjectStateDatabaseMetadata(projectRoot)) {
        backfillProjectSummaryProjection(tasksPath, { projectId: path.basename(projectRoot), projectRoot })
      }
      const raw = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as { tasks?: Array<{ id?: unknown }> } | Array<{ id?: unknown }>
      const taskIds = (Array.isArray(raw) ? raw : raw.tasks ?? [])
        .flatMap(task => typeof task?.id === 'string' ? [task.id] : [])
      const result = await backfillTaskStateDatabaseOverlays(projectRoot, taskIds)
      return {
        summary: `Imported ${result.runtime} runtime, ${result.workspace} workspace, and ${result.latestProof} latest-proof current task row${result.latestProof === 1 ? '' : 's'} into the database; task history remains unchanged.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: '0.12.15/task-current-overlay-reconcile',
    title: 'Reconcile current task overlays with the task queue',
    introducedIn: '0.12.15',
    scope: 'project',
    safety: 'automatic',
    summary: 'Keeps only current task runtime, workspace, and latest-proof rows in the database; historical evidence remains unchanged.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      if (readProjectStateDatabaseMetadata(projectRoot) !== null) {
        return { needed: false, affectedPaths: [] }
      }
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      return { needed: true, affectedPaths: [projectStateDatabasePath(projectRoot)] }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const raw = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as { tasks?: Array<{ id?: unknown }> } | Array<{ id?: unknown }>
      const taskIds = (Array.isArray(raw) ? raw : raw.tasks ?? [])
        .flatMap(task => typeof task?.id === 'string' ? [task.id] : [])
      const result = await backfillTaskStateDatabaseOverlays(projectRoot, taskIds)
      return {
        summary: `Reconciled current overlays for ${taskIds.length} task${taskIds.length === 1 ? '' : 's'}; ${result.runtime} runtime, ${result.workspace} workspace, and ${result.latestProof} latest-proof rows remain current.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: '0.12.16/project-state-detail-store',
    title: 'Move full task detail out of current-state rows',
    introducedIn: '0.12.16',
    scope: 'project',
    safety: 'automatic',
    summary: 'Removes duplicated full task definitions from SQLite current-state rows and stores per-task detail outside the compact read model.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      const detailsPath = getProjectSystemStatePath(projectRoot, 'queue-details.json')
      const compressedDetailsPath = projectStateDatabaseCompressedDetailPathFromTasksPath(tasksPath)
      let hasDetails = false
      for (const candidate of [detailsPath, compressedDetailsPath]) {
        try {
          await fs.access(candidate)
          hasDetails = true
          break
        } catch {
          // Try the other detail-store format.
        }
      }
      const needed = metadata !== null && (metadata.schemaVersion < PROJECT_STATE_DATABASE_SCHEMA_VERSION || !hasDetails)
      return {
        needed,
        affectedPaths: needed ? [projectStateDatabasePath(projectRoot), compressedDetailsPath] : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: projection.freshness === 'error'
          ? 'Created an explicit error summary while moving task detail out of current-state rows; compatibility task records were not deleted.'
          : `Moved full definitions for ${projection.counts.total} task${projection.counts.total === 1 ? '' : 's'} into the per-task detail store; compact SQLite rows remain authoritative for current state.`,
        affectedPaths: [projectStateDatabasePath(projectRoot), projectStateDatabaseCompressedDetailPathFromTasksPath(tasksPath)],
      }
    },
  },
  {
    id: '0.12.17/project-state-queue-revision',
    title: 'Separate queue revisions from mutable execution state',
    introducedIn: '0.12.17',
    scope: 'project',
    safety: 'automatic',
    summary: 'Keys full task detail to individual task payload revisions so runtime, proof, and scope updates do not rewrite unchanged planning detail.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      const needed = metadata !== null && metadata.schemaVersion < PROJECT_STATE_DATABASE_SCHEMA_VERSION
      return {
        needed,
        affectedPaths: needed ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      const details = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (details) {
        writeProjectTaskQueueWithSummary(tasksPath, details, {
          projectId: path.basename(projectRoot),
          projectRoot,
          compactCompatibility: true,
        })
      }
      return {
        summary: projection.freshness === 'error'
          ? 'Recorded an explicit error summary while separating queue and execution revisions.'
          : `Recorded queue revision ${projection.counts.total === 0 ? 'for an empty' : 'for the current'} task snapshot; runtime and proof updates can now advance independently.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: '0.12.18/project-state-compact-compatibility-export',
    title: 'Compact the compatibility task export',
    introducedIn: '0.12.18',
    scope: 'project',
    safety: 'automatic',
    summary: 'Replaces the duplicate full TASKS export with a small task index after the detail store is ready.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        const raw = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as unknown
        const compact = isRecord(raw) && raw.detailStoreVersion === 1
        const details = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
        return {
          needed: details !== null && !compact,
          affectedPaths: details !== null && !compact ? [tasksPath] : [],
        }
      } catch {
        return { needed: false, affectedPaths: [] }
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const details = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!details) {
        return {
          summary: 'Skipped compact export because the revision-matched task detail store is not available.',
          affectedPaths: [],
        }
      }
      writeProjectTaskQueueWithSummary(tasksPath, details, {
        projectId: path.basename(projectRoot),
        projectRoot,
        compactCompatibility: true,
      })
      return {
        summary: `Compacted the compatibility task export for ${details.tasks.length} task${details.tasks.length === 1 ? '' : 's'}; full definitions remain in the detail store.`,
        affectedPaths: [tasksPath],
      }
    },
  },
  {
    id: '0.12.19/memory-empty-thread-shells',
    title: 'Remove empty memory thread shells',
    introducedIn: '0.12.19',
    scope: 'project',
    safety: 'automatic',
    summary: 'Removes only old Guildhall memory thread rows with no messages, state, or workflow snapshot; useful memory records are retained.',
    async detect(projectRoot) {
      const projectId = path.basename(projectRoot)
      const result = inspectEmptyMastraThreadShells({ projectRoot, projectId })
      return {
        needed: result.count > 0,
        affectedPaths: result.count > 0 ? [result.storagePath] : [],
      }
    },
    async apply(projectRoot) {
      const result = removeEmptyMastraThreadShells({
        projectRoot,
        projectId: path.basename(projectRoot),
      })
      return {
        summary: result.removed === 0
          ? 'No empty Guildhall memory thread shells remained; message-bearing memory was untouched.'
          : `Removed ${result.removed} empty Guildhall memory thread shell${result.removed === 1 ? '' : 's'} and reclaimed ${result.bytesBefore - result.bytesAfter} byte${result.bytesBefore - result.bytesAfter === 1 ? '' : 's'}.`,
        affectedPaths: result.removed > 0 ? [result.storagePath] : [],
      }
    },
  },
  {
    id: '0.12.50/memory-empty-mastra-substrate',
    title: 'Retire unused Mastra memory substrates',
    introducedIn: '0.12.50',
    scope: 'project',
    safety: 'automatic',
    summary: 'Removes only a system-local Mastra memory database whose tables are all empty and exclusively Mastra-owned; deterministic memory remains authoritative.',
    async detect(projectRoot) {
      const result = inspectEmptyMastraDatabase({
        projectRoot,
        projectId: path.basename(projectRoot),
      })
      return {
        needed: result.eligible,
        affectedPaths: result.eligible ? [result.storagePath] : [],
      }
    },
    async apply(projectRoot) {
      const result = retireEmptyMastraDatabase({
        projectRoot,
        projectId: path.basename(projectRoot),
      })
      return {
        summary: result.retired
          ? `Retired the empty Mastra substrate and reclaimed ${result.bytesBefore} byte${result.bytesBefore === 1 ? '' : 's'}; no memory rows were present.`
          : 'Kept the Mastra substrate because it contains data or an object outside the known empty schema.',
        affectedPaths: result.retired ? [result.storagePath] : [],
      }
    },
  },
  {
    id: '0.12.20/project-state-detail-compression',
    title: 'Compress the full task detail store',
    introducedIn: '0.12.20',
    scope: 'project',
    safety: 'automatic',
    summary: 'Stores the full task detail sidecar as compressed JSON so rich task reads retain fidelity without carrying repetitive text on disk.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const sourcePath = getProjectSystemStatePath(projectRoot, 'queue-details.json')
      try {
        await fs.access(sourcePath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      return {
        needed: true,
        affectedPaths: [sourcePath, projectStateDatabaseCompressedDetailPathFromTasksPath(tasksPath)],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const result = compressProjectStateDetailStore(tasksPath)
      if (!result) {
        return {
          summary: 'The full task detail store was already compressed or was not present.',
          affectedPaths: [],
        }
      }
      return {
        summary: `Compressed the full task detail store from ${result.bytesBefore} to ${result.bytesAfter} bytes without changing task content.`,
        affectedPaths: [result.sourcePath, result.compressedPath],
      }
    },
  },
  {
    id: '0.12.21/task-overlay-authority',
    title: 'Promote imported task overlays to the database read model',
    introducedIn: '0.12.21',
    scope: 'project',
    safety: 'automatic',
    summary: 'Makes the database the current-state authority only after runtime and workspace overlays have been explicitly imported; compatibility JSON remains a write-through export.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      try {
        await fs.access(tasksPath)
      } catch {
        return { needed: false, affectedPaths: [] }
      }
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      const authority = readProjectStateDatabaseAuthority(projectRoot)
      return {
        needed: metadata !== null && authority !== 'database',
        affectedPaths: metadata !== null
          ? [projectStateDatabasePath(projectRoot), 'system-local task runtime/workspace state']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const raw = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as { tasks?: Array<{ id?: unknown }> } | Array<{ id?: unknown }>
      const taskIds = (Array.isArray(raw) ? raw : raw.tasks ?? [])
        .flatMap(task => typeof task?.id === 'string' ? [task.id] : [])
      const result = await backfillTaskStateDatabaseOverlays(projectRoot, taskIds)
      promoteProjectStateDatabaseAuthority(projectRoot)
      return {
        summary: `Promoted ${result.runtime} runtime, ${result.workspace} workspace, and ${result.latestProof} latest-proof rows to the database current-state authority; legacy JSON remains compatibility output and evidence history remains detail history.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: '0.12.22/current-summary-rebuild-after-authority',
    title: 'Rebuild the compact summary after current-state promotion',
    introducedIn: '0.12.22',
    scope: 'project',
    safety: 'automatic',
    summary: 'Rebuilds a stale or failed compact project summary after current-state authority has moved to the database.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null || readProjectStateDatabaseAuthority(projectRoot) !== 'database') {
        return { needed: false, affectedPaths: [] }
      }
      const projection = readProjectSummaryProjectionForMigration(tasksPath)
      return {
        needed: projection?.freshness !== 'current',
        affectedPaths: projection?.freshness === 'current' ? [] : [projectStateDatabasePath(projectRoot), 'project summary read model'],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: projection.freshness === 'current'
          ? `Rebuilt the compact project summary for ${projection.counts.total} current task${projection.counts.total === 1 ? '' : 's'} after database authority promotion.`
          : 'Attempted to rebuild the compact project summary, but the source queue still needs repair.',
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: '0.12.23/project-state-single-authority',
    title: 'Remove duplicate current-state compatibility files',
    introducedIn: '0.12.23',
    scope: 'project',
    safety: 'automatic',
    summary: 'After the database has become authoritative, removes the duplicate TASKS and project-summary writers while retaining legacy readers for older projects.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') {
        return { needed: false, affectedPaths: [] }
      }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const candidatePaths = [tasksPath, projectSummaryProjectionPath(tasksPath)]
      const present: string[] = []
      for (const file of candidatePaths) {
        try {
          await fs.access(file)
          present.push(file)
        } catch {
          // Already removed.
        }
      }
      return { needed: present.length > 0, affectedPaths: present }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const detail = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!detail) {
        throw new Error('Cannot remove compatibility queue before the database queue can be read.')
      }
      const removed: string[] = []
      for (const file of [tasksPath, projectSummaryProjectionPath(tasksPath)]) {
        await fs.rm(file, { force: true })
        removed.push(file)
      }
      return {
        summary: `Removed ${removed.length} duplicate current-state compatibility file${removed.length === 1 ? '' : 's'}; the database and its detail boundary remain intact for ${detail.tasks.length} task${detail.tasks.length === 1 ? '' : 's'}.`,
        affectedPaths: removed,
      }
    },
  },
  {
    id: '0.12.24/project-summary-action-model',
    title: 'Persist the canonical project action model',
    introducedIn: '0.12.24',
    scope: 'project',
    safety: 'automatic',
    summary: 'Stores the project primary action beside counts and readiness so fleet, project, and task surfaces do not independently re-rank paged work.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') {
        return { needed: false, affectedPaths: [] }
      }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = readProjectSummaryProjectionForMigration(tasksPath)
      return {
        needed: !projection?.actionModel,
        affectedPaths: !projection?.actionModel
          ? [projectStateDatabasePath(projectRoot)]
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const indexedProjection = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
        projectId: path.basename(projectRoot),
      })
      if (!indexedProjection || !indexedProjection.actionModel) {
        throw new Error('The canonical project action model could not be persisted.')
      }
      if (indexedProjection.version !== PROJECT_SUMMARY_PROJECTION_VERSION) {
        updateProjectStateDatabaseSummary(tasksPath, summary => ({
          ...summary,
          version: PROJECT_SUMMARY_PROJECTION_VERSION,
        }))
      }
      const projection = readProjectSummaryProjectionForMigration(tasksPath)
      if (!projection || projection.version !== PROJECT_SUMMARY_PROJECTION_VERSION || !projection.actionModel) {
        throw new Error('The canonical project action model could not be persisted.')
      }
      return {
        summary: `Persisted the canonical action model beside the ${projection.counts.total}-task project summary.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: '0.12.25/project-summary-task-status-counts',
    title: 'Persist partitioned task status counts for release detail',
    introducedIn: '0.12.25',
    scope: 'project',
    safety: 'automatic',
    summary: 'Adds the mutually partitioned task-status distribution to the compact release summary so detail reads do not mistake overlapping blocker dimensions for task states.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') {
        return { needed: false, affectedPaths: [] }
      }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = readProjectSummaryProjectionForMigration(tasksPath)
      const taskStatusCounts = projection?.releaseSummary?.taskStatusCounts
      const present = Boolean(taskStatusCounts && typeof taskStatusCounts === 'object' && !Array.isArray(taskStatusCounts))
      const needed = projection?.version !== PROJECT_SUMMARY_PROJECTION_VERSION || !present
      return {
        needed,
        affectedPaths: needed ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
        projectId: path.basename(projectRoot),
      })
      if (!projection?.releaseSummary?.taskStatusCounts || projection.version !== PROJECT_SUMMARY_PROJECTION_VERSION) {
        throw new Error('The partitioned task-status release summary could not be persisted.')
      }
      return {
        summary: `Persisted task-status counts for the ${projection.counts.total}-task project summary without changing task or release records.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: '0.13.0/project-decision-projection',
    title: 'Materialize the shared project decision',
    introducedIn: '0.13.0',
    scope: 'project',
    safety: 'automatic',
    summary: 'Builds one revisioned execution and release decision from current project facts so every surface starts from the same answer.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') {
        return { needed: false, affectedPaths: [] }
      }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = readProjectSummaryProjectionForMigration(tasksPath)
      const needed = !projection || !projectSummaryProjectionIsCurrent(projection)
      return {
        needed,
        affectedPaths: needed ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      await realignPromotedSummaryWithEffectiveState(projectRoot)
      const projection = readProjectSummaryProjection(tasksPath)
      if (!projection || !projectSummaryProjectionIsCurrent(projection)) {
        throw new Error('The shared project decision could not be persisted.')
      }
      return {
        summary: `Materialized the shared execution and release decision for the ${projection.counts.total}-task project summary.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: '0.12.31/task-evidence-current-projection',
    title: 'Materialize bounded current task evidence',
    introducedIn: '0.12.31',
    scope: 'project',
    safety: 'automatic',
    summary: 'Builds a small per-task evidence projection from existing JSONL so current status reads can stop replaying historical evidence.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null) return { needed: false, affectedPaths: [] }

      // The database opener may advance its physical schema while an earlier
      // migration in the same apply pass is running. This migration owns a
      // data backfill, so its ledger record, not the physical schema number,
      // is the proof that the backfill happened.
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === '0.12.31/task-evidence-current-projection' && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const detail = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const taskIds = detail?.tasks
        .flatMap(task => typeof task.id === 'string' ? [task.id] : [])
        ?? []
      const result = await backfillTaskEvidenceCurrent(projectRoot, taskIds)
      return {
        summary: `Materialized bounded current evidence for ${result.tasks} task${result.tasks === 1 ? '' : 's'} from ${result.events} historical event${result.events === 1 ? '' : 's'}; raw history remains unchanged.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: '0.12.34/task-current-inbox-summary',
    title: 'Materialize current task intake state for inbox reads',
    introducedIn: '0.12.34',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Stores the small task-shaping state facts the inbox needs so opening a project does not replay every task history ledger.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null) return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === '0.12.34/task-current-inbox-summary' && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: projection.freshness === 'error'
          ? 'Recorded an unavailable summary; the inbox will use the legacy compatibility path until task state is readable.'
          : `Materialized current inbox shaping facts for ${projection.counts.total} task${projection.counts.total === 1 ? '' : 's'} without retaining task history in the read model.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: '0.12.35/task-essential-current-evidence',
    title: 'Reduce current task evidence to essential facts',
    introducedIn: '0.12.35',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Collapses the current evidence projection to latest proofs and bounded open-state facts while preserving the historical evidence ledger unchanged.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null) return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === '0.12.35/task-essential-current-evidence' && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
    async apply(projectRoot) {
      const result = compactProjectStateDatabaseEvidence(projectRoot)
      const vacuum = vacuumProjectStateDatabase(projectRoot)
      return {
        summary: `Reduced ${result.currentRowsSeen} current evidence row${result.currentRowsSeen === 1 ? '' : 's'} from ${result.bytesBefore} to ${result.bytesAfter} bytes; historical evidence remains unchanged.`,
        affectedPaths: [projectStateDatabasePath(projectRoot), vacuum.databasePath],
      }
    },
  },
  {
    id: '0.12.36/project-summary-current-scope-authority',
    title: 'Reconcile current scope against live work identities',
    introducedIn: '0.12.36',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Reconciles current release and scope state so stale workspace-import task IDs cannot defer or complete replacement work; task history and task prose remain unchanged.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null) return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === '0.12.36/project-summary-current-scope-authority' && record.status === 'applied')
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const summary = readProjectSummaryProjectionForMigration(tasksPath)
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const taskIds = new Set(queue?.tasks.map(task => typeof task.id === 'string' ? task.id : '').filter(Boolean))
      // Release envelopes can also carry capability/feature nodes. Those are
      // valid structural members, not task identities to reconcile here.
      // Only the `work:` namespace is owned by the current task index.
      const hasStaleMembership = queue?.releases.some(release => [
        ...(Array.isArray(release.nodeIds) ? release.nodeIds : []),
        ...(Array.isArray(release.deferredNodeIds) ? release.deferredNodeIds : []),
      ].some(nodeId => typeof nodeId === 'string' && nodeId.startsWith('work:') && !taskIds.has(nodeId.slice('work:'.length)))) ?? false
      return {
        needed: !applied || summary?.freshness !== 'current' || hasStaleMembership,
        affectedPaths: !applied || summary?.freshness !== 'current' || hasStaleMembership
          ? [projectStateDatabasePath(projectRoot), 'system-local project-state/project-summary.json']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: projection.freshness === 'error'
          ? 'Recorded an unavailable summary; current scope remains explicitly unreadable until the queue can be parsed.'
          : `Reconciled current scope for ${projection.counts.total} task${projection.counts.total === 1 ? '' : 's'} using live task identities without rewriting task or history records.`,
        affectedPaths: [projectStateDatabasePath(projectRoot), 'system-local project-state/project-summary.json'],
      }
    },
  },
  {
    id: '0.12.37/project-summary-orientation-store',
    title: 'Move map orientation out of the compact project summary',
    introducedIn: '0.12.37',
    scope: 'project',
    safety: 'automatic',
    summary: 'Stores the orientation/map projection separately so fleet and project shells do not load map detail just to show current counts and actions.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null) return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === '0.12.37/project-summary-orientation-store' && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      // The summary writer owns the split. Reusing it keeps the migration from
      // inventing a second serialization or orientation authority.
      updateProjectStateDatabaseSummary(tasksPath, summary => summary)
      const vacuum = vacuumProjectStateDatabase(projectRoot)
      return {
        summary: 'Moved orientation/map detail into its dedicated current projection; compact summary reads now exclude the map tree.',
        affectedPaths: [projectStateDatabasePath(projectRoot), vacuum.databasePath],
      }
    },
  },
  {
    id: '0.12.38/project-state-queue-detail-database',
    title: 'Keep full queue detail in the project database',
    introducedIn: '0.12.38',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Moves per-task full queue detail into the same SQLite authority as compact projections so promoted reads do not depend on a second mutable sidecar.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null) return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === '0.12.38/project-state-queue-detail-database' && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied ? [projectStateDatabasePath(projectRoot), 'system-local queue detail'] : [],
      }
    },
    async apply(projectRoot) {
      const result = migrateProjectStateDatabaseQueueDetail(projectRoot)
      return {
        summary: result.migrated
          ? `Moved the revision-${result.revision} full queue detail into SQLite (${result.bytes} compressed bytes); task history and compatibility records were unchanged.`
          : result.revision === null
            ? 'No readable current queue detail was available to migrate; the project remains explicitly unavailable rather than reconstructing an empty queue.'
            : `The revision-${result.revision} queue detail was already stored in SQLite; no task or history records were rewritten.`,
        affectedPaths: result.migrated ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: '0.12.39/project-plan-source-store',
    title: 'Separate imported planning from the current summary',
    introducedIn: '0.12.39',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Moves the accepted workspace-import snapshot out of the compact project summary; current release and task membership remains owned by the live scope tables.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null) return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === '0.12.39/project-plan-source-store' && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      // The existing summary reader hydrates the legacy field, and the shared
      // writer now stores it in project_plan while stripping it from the
      // compact summary. No task, release, or history record is rewritten.
      updateProjectStateDatabaseSummary(tasksPath, summary => summary)
      const vacuum = vacuumProjectStateDatabase(projectRoot)
      return {
        summary: 'Separated the accepted planning snapshot from current summary state; live scope remains authoritative for execution membership.',
        affectedPaths: [projectStateDatabasePath(projectRoot), vacuum.databasePath],
      }
    },
  },
  {
    id: '0.12.43/project-state-per-task-detail-index',
    title: 'Index task detail for point reads',
    introducedIn: '0.12.43',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Migrates per-task compressed detail rows so task reads do not decompress the whole queue detail blob.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null) return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === '0.12.43/project-state-per-task-detail-index' && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
    async apply(projectRoot) {
      const result = migrateProjectStateDatabaseWorkItemDetails(projectRoot)
      return {
        summary: result.migrated
          ? `Indexed ${result.taskCount} current task detail record${result.taskCount === 1 ? '' : 's'} from queue revision ${result.revision ?? 'unknown'}; task history was unchanged.`
          : result.revision === null
            ? 'No project database was available to index; no task or history records were rewritten.'
            : result.taskCount > 0
              ? `The per-task detail index already contains ${result.taskCount} record${result.taskCount === 1 ? '' : 's'}; no task or history records were rewritten.`
              : 'The authoritative aggregate detail was unavailable; no empty per-task index was created.',
        affectedPaths: result.migrated ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: '0.12.44/project-state-remove-aggregate-detail',
    title: 'Remove the duplicate aggregate task-detail payload',
    introducedIn: '0.12.44',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Removes the retired full-queue SQLite blob after the per-task detail index is verified; rich reads reconstruct explicitly from normalized rows.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null) return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === '0.12.44/project-state-remove-aggregate-detail' && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
    async apply(projectRoot) {
      const cleared = clearProjectStateDatabaseQueueDetail(projectRoot)
      return {
        summary: cleared
          ? 'Removed the duplicate aggregate queue-detail blob after the per-task detail index was verified; task and history records were unchanged.'
          : 'The aggregate queue-detail blob was already absent; normalized task detail remains the rich-read authority.',
        affectedPaths: cleared ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: '0.12.45/project-current-thread-projection-store',
    title: 'Create the bounded current Thread store',
    introducedIn: '0.12.45',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Creates the durable bounded current Thread state table; historical turns remain available only through the explicit history reader.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null) return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === '0.12.45/project-current-thread-projection-store' && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
    async apply(projectRoot) {
      ensureProjectStateDatabaseCurrentThreadStore(projectRoot)
      return {
        summary: 'Created the current Thread projection store; the next projection refresh will populate its bounded active context without rewriting history.',
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: THREAD_HISTORY_PROJECTION_MIGRATION_ID,
    title: 'Create the paged Thread history projection store',
    introducedIn: '0.12.47',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Creates bounded historical Thread state projection tables so the owner can page saved history while the next asynchronous refresh populates them without rebuilding history in a GET.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null) return { needed: false, affectedPaths: [] }
      const present = readProjectStateDatabaseThreadHistoryStorePresent(projectRoot)
      return {
        needed: !present,
        affectedPaths: !present ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
    async apply(projectRoot) {
      ensureProjectStateDatabaseThreadHistoryStore(projectRoot)
      return {
        summary: 'Created the paged Thread history projection store; historical reads now report a cache miss until the projector publishes the first bounded page set.',
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: '0.12.41/task-evidence-history-authority',
    title: 'Move promoted task evidence history into the project database',
    introducedIn: '0.12.41',
    scope: 'project',
    safety: 'automatic',
    summary: 'Moves bounded legacy task evidence into the existing SQLite history ledger so promoted reads have one durable evidence authority instead of reopening JSONL files.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') {
        return { needed: false, affectedPaths: [] }
      }
      const authority = readProjectStateDatabaseTaskEvidenceAuthority(projectRoot)
      return {
        needed: authority === 'legacy',
        affectedPaths: authority === 'legacy' ? [projectStateDatabasePath(projectRoot), 'legacy task evidence JSONL'] : [],
      }
    },
    async apply(projectRoot) {
      const result = await migrateLegacyTaskEvidenceHistoryToDatabase(projectRoot)
      return {
        summary: result.filesSeen === 0
          ? 'Marked SQLite as the task evidence authority; no legacy evidence files were present.'
          : `Moved ${result.recordsImported} bounded task evidence record${result.recordsImported === 1 ? '' : 's'} from ${result.filesRemoved} legacy file${result.filesRemoved === 1 ? '' : 's'} into SQLite; legacy files were removed only after identity verification.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: '0.12.42/task-evidence-history-compression',
    title: 'Keep historical task evidence in a compact ledger',
    introducedIn: '0.12.42',
    scope: 'project',
    safety: 'automatic',
    summary: 'Moves detail-only task history out of the aggregate SQLite database into bounded gzip ledgers while current proof remains queryable in SQLite.',
    async detect(projectRoot) {
      const authority = readProjectStateDatabaseTaskEvidenceAuthority(projectRoot)
      const needed = readProjectStateDatabaseAuthority(projectRoot) === 'database' && authority === 'database'
      return {
        needed,
        affectedPaths: needed ? [projectStateDatabasePath(projectRoot), 'compact task evidence ledgers'] : [],
      }
    },
    async apply(projectRoot) {
      const result = await migrateDatabaseTaskEvidenceHistoryToCompressed(projectRoot)
      return {
        summary: result.recordsSeen === 0
          ? 'Removed the empty transitional SQLite history ledger; current evidence remains in SQLite.'
          : `Moved ${result.recordsRetained} bounded task evidence record${result.recordsRetained === 1 ? '' : 's'} into ${result.filesWritten} compressed detail file${result.filesWritten === 1 ? '' : 's'} (${result.bytesBefore} to ${result.bytesAfter} bytes); SQLite retains current proof only.`,
        affectedPaths: [projectStateDatabasePath(projectRoot), 'compact task evidence ledgers'],
      }
    },
  },
  {
    id: '0.8.0/codex-agent-bridge',
    title: 'Install Codex Guildhall MCP bridge instructions',
    introducedIn: '0.8.0',
    scope: 'project',
    safety: 'prompt',
    summary: 'Adds or refreshes the managed Guildhall MCP bridge section in AGENTS.md.',
    async detect(projectRoot) {
      try {
        const raw = await readManagedTextFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')
        return { needed: !raw.includes('<!-- BEGIN Guildhall MCP bridge -->'), affectedPaths: ['AGENTS.md'] }
      } catch {
        return { needed: true, affectedPaths: ['AGENTS.md'] }
      }
    },
    async apply(projectRoot) {
      const result = installAgentBridgeInstructions({ projectPath: projectRoot, target: 'codex' })
      return {
        summary: `Codex bridge instructions ${result.action}.`,
        affectedPaths: ['AGENTS.md'],
      }
    },
  },
  {
    id: '0.9.0/runtime-command-evidence-persistence',
    title: 'Move runtime command evidence into persistence',
    introducedIn: '0.9.0',
    scope: 'project',
    safety: 'automatic',
    summary: 'Moves legacy runtime command evidence JSONL into GuildhallPersistence events.',
    async detect(projectRoot) {
      const needed = await hasLegacyRuntimeCommandEvidence(projectRoot)
      return {
        needed,
        affectedPaths: needed ? ['host-owned runtime command evidence JSONL'] : [],
      }
    },
    async apply(projectRoot) {
      const result = await migrateLegacyRuntimeCommandEvidenceToPersistence(projectRoot)
      return {
        summary: `Moved ${result.migrated} runtime command evidence record${result.migrated === 1 ? '' : 's'} into persistence${result.skipped > 0 ? `; skipped ${result.skipped} already-present record${result.skipped === 1 ? '' : 's'}` : ''}.`,
        affectedPaths: result.affectedPaths,
      }
    },
  },
  {
    id: '0.9.0/runtime-backed-project',
    title: 'Move project commands into the local runtime',
    introducedIn: '0.9.0',
    scope: 'project',
    safety: 'manual',
    summary: 'Guides this project from host-run compatibility into runtime-backed execution after health checks pass.',
    async detect(projectRoot) {
      const state = await readProjectRuntimeState(projectRoot)
      return {
        needed: state.migration.mode !== 'runtime-backed',
        affectedPaths: ['host-owned runtime state'],
      }
    },
    async apply() {
      return {
        summary: 'Open Settings to run runtime health checks and accept runtime-backed mode.',
        affectedPaths: ['host-owned runtime state'],
      }
    },
  },
  {
    id: COMPLETION_SUMMARY_EVIDENCE_MIGRATION_ID,
    title: 'Move durable completion summaries into current evidence',
    introducedIn: '0.13.8',
    scope: 'project',
    safety: 'automatic',
    summary: 'Preserves bounded completion summaries through the evidence owner so promoted current-state reads do not lose completion proof when task definitions are compacted.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null || readProjectStateDatabaseAuthority(projectRoot) !== 'database') {
        return { needed: false, affectedPaths: [] }
      }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === COMPLETION_SUMMARY_EVIDENCE_MIGRATION_ID && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied
          ? [projectStateDatabasePath(projectRoot), getProjectSystemStatePath(projectRoot, 'TASKS.json')]
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      let raw: unknown
      try {
        raw = JSON.parse(readManagedTextFileSync(tasksPath, 'utf8'))
      } catch {
        return {
          summary: 'No compatibility queue was available; no completion summaries needed migration.',
          affectedPaths: [projectStateDatabasePath(projectRoot)],
        }
      }
      const tasks = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks)
          ? (raw as { tasks: unknown[] }).tasks
          : []
      let migrated = 0
      for (const candidate of tasks) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
        const task = candidate as Record<string, unknown>
        if (typeof task.id !== 'string') continue
        const parsed = TaskSchema.shape.doneSummaryBundle.safeParse(task.doneSummaryBundle)
        if (!parsed.success || !parsed.data) continue
        const completion = parsed.data
        await appendTaskEvidence(projectRoot, task.id, {
          id: `${task.id}-completion-summary-${completion.createdAt.replace(/[^0-9A-Za-z]/g, '')}`,
          kind: 'completion_summary',
          recordedAt: completion.createdAt,
          payload: completion,
        })
        migrated += 1
      }
      return {
        summary: migrated > 0
          ? `Moved ${migrated} bounded completion summar${migrated === 1 ? 'y' : 'ies'} into current task evidence.`
          : 'No compatibility task carried a bounded completion summary that needed migration.',
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: FINAL_PROJECT_STATE_MIGRATION_ID,
    title: 'Finalize the SQLite current-state boundary',
    introducedIn: '0.13.0',
    scope: 'project',
    safety: 'required',
    requirement: 'required',
    summary: 'Finalizes the current project state in SQLite, verifies the indexed task definitions and summary, and removes historical current-state files that would create a second mutable truth.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null) return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === FINAL_PROJECT_STATE_MIGRATION_ID && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied
          ? [
              projectStateDatabasePath(projectRoot),
              getProjectSystemStatePath(projectRoot, 'TASKS.json'),
              'historical current-state sidecars',
            ]
          : [],
      }
    },
    async apply(projectRoot) {
      const result = await finalizeProjectStateBoundary(projectRoot)
      return {
        summary: `Finalized SQLite current state for ${result.queueTaskCount} task${result.queueTaskCount === 1 ? '' : 's'}; removed ${result.removedPaths.length} historical current-state path${result.removedPaths.length === 1 ? '' : 's'}.`,
        affectedPaths: [projectStateDatabasePath(projectRoot), ...result.removedPaths],
      }
    },
  },
  {
    id: LEGACY_LIVE_STATE_CLEANUP_MIGRATION_ID,
    title: 'Remove legacy current-state live files after SQLite cutover',
    introducedIn: '0.13.0',
    scope: 'project',
    safety: 'required',
    requirement: 'required',
    summary: 'Removes old availability, attention, reconciliation, task-runtime, and compatibility summary files left behind when the SQLite cutover was already recorded by an earlier build.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const affectedPaths = legacyCurrentStateFiles(projectRoot, tasksPath)
      const existing = []
      for (const file of affectedPaths) {
        try {
          await fs.access(file)
          existing.push(file)
        } catch {
          // Missing compatibility files are already clean.
        }
      }
      return { needed: existing.length > 0, affectedPaths: existing }
    },
    async apply(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') {
        throw new Error('Project-state authority is not SQLite; run the current-state cutover before cleaning legacy files.')
      }
      const removedPaths = await removeLegacyCurrentStateFiles(projectRoot)
      return {
        summary: `Removed ${removedPaths.length} legacy current-state file${removedPaths.length === 1 ? '' : 's'} after the SQLite cutover.`,
        affectedPaths: removedPaths,
      }
    },
  },
  {
    id: EFFECTIVE_STATE_REALIGNMENT_MIGRATION_ID,
    title: 'Realign promoted summary and scope from current evidence',
    introducedIn: '0.13.0',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Repairs promoted project summary and scope state from SQLite current evidence-derived task state without reopening compatibility files or historical evidence.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === EFFECTIVE_STATE_REALIGNMENT_MIGRATION_ID && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied
          ? [projectStateDatabasePath(projectRoot), 'promoted project summary and work-scope read models']
          : [],
      }
    },
    async apply(projectRoot) {
      const result = await realignPromotedSummaryWithEffectiveState(projectRoot)
      return {
        summary: `Realigned summary and scope for ${result.taskCount} promoted task${result.taskCount === 1 ? '' : 's'}; ${result.doneCount} effective task${result.doneCount === 1 ? '' : 's'} are done across ${result.includedCount} included and ${result.deferredCount} deferred work item${result.includedCount + result.deferredCount === 1 ? '' : 's'}.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: CURRENT_STATUS_PROJECTION_MIGRATION_ID,
    title: 'Materialize the shared current task status rule',
    introducedIn: '0.13.1',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Rebuilds the promoted project state, task, scope, and summary rows from the shared current-status rule so rich and compact reads cannot disagree.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === CURRENT_STATUS_PROJECTION_MIGRATION_ID && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied
          ? [projectStateDatabasePath(projectRoot), 'promoted task, scope, and summary read models']
          : [],
      }
    },
    async apply(projectRoot) {
      const result = await realignPromotedSummaryWithEffectiveState(projectRoot)
      return {
        summary: `Materialized the shared current status for ${result.taskCount} task${result.taskCount === 1 ? '' : 's'}; ${result.doneCount} are done across ${result.includedCount} included and ${result.deferredCount} deferred work item${result.includedCount + result.deferredCount === 1 ? '' : 's'}.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: RELEASE_MEMBERSHIP_MIGRATION_ID,
    title: 'Normalize release work membership',
    introducedIn: '0.13.1',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Moves release-to-task membership into one normalized relation so release, task, scope, and summary reads cannot disagree about which work belongs to a release.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const status = readProjectStateDatabaseReleaseMembershipStatus(projectRoot)
      return {
        needed: !status.complete,
        affectedPaths: !status.complete ? [projectStateDatabasePath(projectRoot), 'normalized release membership relation'] : [],
      }
    },
    async apply(projectRoot) {
      const result = migrateProjectStateDatabaseReleaseMembership(projectRoot)
      return {
        summary: `Normalized ${result.membershipCount} release membership row${result.membershipCount === 1 ? '' : 's'} into SQLite${result.migrated ? ` at project revision ${result.revision ?? 'current'}` : ''}.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: RELEASE_MEMBERSHIP_SNAPSHOT_MIGRATION_ID,
    title: 'Materialize accepted release membership',
    introducedIn: '0.13.66',
    scope: 'project',
    safety: 'required',
    requirement: 'required',
    summary: 'Promotes accepted release-plan membership into the normalized relation in one revisioned write, so scope, Start, and release totals do not rely on a read-time plan overlay.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const repair = await inspectApprovedPlanReleaseMembershipRepair(projectRoot)
      const needed = repair.state === 'materialize' || repair.state === 'conflict'
      return {
        needed,
        affectedPaths: needed
          ? [projectStateDatabasePath(projectRoot), 'approved plan and normalized release membership relation']
          : [],
      }
    },
    async apply(projectRoot) {
      const result = await materializeApprovedPlanReleaseMembershipAtBoundary(projectRoot)
      return {
        summary: result.state === 'materialized'
          ? `Materialized ${result.membershipCount} accepted release membership row${result.membershipCount === 1 ? '' : 's'} into the canonical relation and refreshed the shared scope projection.`
          : 'No accepted release-plan membership repair was needed.',
        affectedPaths: result.state === 'materialized'
          ? [projectStateDatabasePath(projectRoot)]
          : [],
      }
    },
  },
  {
    id: COMPACT_READ_MODEL_MIGRATION_ID,
    title: 'Materialize compact task read models',
    introducedIn: '0.13.2',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Backfills graph and list-facing task state summaries from the authoritative per-task detail index so the owner sees compact facts without ordinary reads opening rich task definitions.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const status = readProjectStateDatabaseCompactReadModelStatus(projectRoot)
      return {
        needed: !status.complete,
        affectedPaths: !status.complete ? [projectStateDatabasePath(projectRoot), 'indexed task read models'] : [],
      }
    },
    async apply(projectRoot) {
      const result = migrateProjectStateDatabaseCompactReadModels(projectRoot)
      return {
        summary: `Materialized compact summaries for ${result.taskCount} task${result.taskCount === 1 ? '' : 's'}${result.packetTaskCount > 0 ? `, including ${result.packetTaskCount} task${result.packetTaskCount === 1 ? '' : 's'} with contract-review packets` : ''}.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: CURRENT_PROOF_READ_MODEL_MIGRATION_ID,
    title: 'Refresh the indexed current-proof summary',
    introducedIn: '0.13.9',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    recheckAfterApply: true,
    summary: 'Repairs the owner-facing current-proof state in existing task read models so reopened work cannot inherit historical proof as if it were current evidence.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const effectiveStateRepairApplied = ledger.records.some(record =>
        record.id === EFFECTIVE_CURRENT_PROOF_READ_MODEL_MIGRATION_ID && record.status === 'applied',
      )
      // The effective-state migration supersedes this older detail-only probe.
      // Once it has run, reopening the old interpretation would recreate two
      // competing definitions of current proof.
      if (effectiveStateRepairApplied) return { needed: false, affectedPaths: [] }
      const status = readProjectStateDatabaseCurrentProofReadModelStatus(projectRoot)
      return {
        needed: status.schemaPresent && !status.complete,
        affectedPaths: status.schemaPresent && !status.complete
          ? [projectStateDatabasePath(projectRoot), 'indexed current-proof summaries']
          : [],
      }
    },
    async apply(projectRoot) {
      const result = migrateProjectStateDatabaseCompactReadModels(projectRoot)
      return {
        summary: result.migrated
          ? `Refreshed bounded current-proof summaries for ${result.taskCount} task${result.taskCount === 1 ? '' : 's'}.`
          : 'Indexed current-proof summaries were already current.',
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: IMPORTED_SCRIPT_PROOF_CONTRACT_MIGRATION_ID,
    title: 'Normalize imported script-proof contracts',
    introducedIn: '0.13.10',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    recheckAfterApply: true,
    summary: 'Converts bare workspace test conventions on imported tasks in a selected script-only release into explicit owner-facing proof state and proof-setup work so generic commands cannot masquerade as task proof.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const taskIds = importedScriptProofRepairTaskIds(projectRoot)
      return {
        needed: taskIds.length > 0,
        affectedPaths: taskIds.length > 0
          ? [projectStateDatabasePath(projectRoot), `imported task proof contracts (${taskIds.length})`]
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) {
        return {
          summary: 'Skipped imported proof-contract normalization because the authoritative task detail store is unavailable.',
          affectedPaths: [],
        }
      }
      const selectedRelease = queue.releases
        ?.map(release => release as unknown as ProjectRelease)
        .find(release => release.id === queue.selectedReleaseId)
      if (selectedRelease?.proofStyle !== 'script_only') {
        return {
          summary: 'Skipped imported proof-contract normalization because the selected scope is not script-only.',
          affectedPaths: [],
        }
      }
      let changed = 0
      for (const task of queue.tasks as unknown as Task[]) {
        if (!task.releaseIds?.includes(selectedRelease.id) || !taskNeedsImportedScriptProofRepair(task)) continue
        if (repairImportedScriptProofContract(task)) changed += 1
      }
      if (changed > 0) {
        queue.lastUpdated = new Date().toISOString()
        writeProjectTaskQueueWithSummary(tasksPath, queue, {
          projectId: path.basename(projectRoot),
          projectRoot,
          compactCompatibility: true,
        })
      }
      return {
        summary: changed > 0
          ? `Normalized generic proof contracts for ${changed} imported task${changed === 1 ? '' : 's'}; each now exposes bounded proof setup instead of a bare workspace test command.`
          : 'Imported script-proof contracts were already normalized.',
        affectedPaths: changed > 0 ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: CURRENT_PLAN_RECOVERY_BOUNDARY_MIGRATION_ID,
    title: 'Retire prose-based current-plan cleanup',
    introducedIn: '0.13.11',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Retires the old phrase matcher. Current plans and historical evidence are no longer classified or rewritten from provider-authored wording; typed task state owns recovery and execution.',
    async detect() {
      return { needed: false, affectedPaths: [] }
    },
    async apply() {
      return {
        summary: 'Prose-based current-plan cleanup is retired; no task text was inspected or rewritten.',
        affectedPaths: [],
      }
    },
  },
  {
    id: MALFORMED_TASK_RUNTIME_OVERLAY_MIGRATION_ID,
    title: 'Repair malformed task runtime overlays',
    introducedIn: '0.13.12',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Repairs invalid persisted retry-window fragments at the runtime-state boundary so coordinators can read one canonical task state without dropping task evidence or masking unrelated corruption.',
    async detect(projectRoot) {
      const taskIds = malformedTaskRuntimeOverlayIds(projectRoot)
      return {
        needed: taskIds.length > 0,
        affectedPaths: taskIds.length > 0
          ? [projectStateDatabasePath(projectRoot), `malformed task runtime overlays (${taskIds.length})`]
          : [],
      }
    },
    async apply(projectRoot) {
      const stores = readProjectStateDatabaseTaskOverlayStores(projectRoot)
      if (!stores) {
        return {
          summary: 'Skipped runtime-overlay repair because the authoritative task overlay store is unavailable.',
          affectedPaths: [],
        }
      }
      const repaired = stores.runtime.map(row => repairTaskRuntimeOverlay(row.taskId, row.updatedAt, row.payload))
      const changed = repaired.filter((row, index) => JSON.stringify(row.payload) !== JSON.stringify(stores.runtime[index]?.payload)).length
      replaceProjectStateDatabaseTaskRuntimes(projectRoot, repaired)
      return {
        summary: changed > 0
          ? `Repaired ${changed} malformed task runtime overlay${changed === 1 ? '' : 's'}; invalid retry-window fragments were removed while task evidence was preserved.`
          : 'Task runtime overlays already match the canonical runtime-state schema.',
        affectedPaths: changed > 0 ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: EFFECTIVE_CURRENT_PROOF_READ_MODEL_MIGRATION_ID,
    title: 'Realign indexed proof summaries from effective task state',
    introducedIn: '0.13.12',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    // One-time legacy representation repair. New writes can make the compact
    // proof row temporarily stale while the projection job catches up; that
    // is a projection obligation, not a new migration and must not block run.
    summary: 'Rebuilds persisted proof summaries from the effective current task state so runtime overlays, current evidence, and indexed reads cannot report different proof answers.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const status = await effectiveCurrentProofReadModelStatus(projectRoot)
      return {
        needed: status.needed,
        affectedPaths: status.needed
          ? [projectStateDatabasePath(projectRoot), `indexed proof summaries (${status.mismatchedCount} stale of ${status.taskCount})`]
          : [],
      }
    },
    async apply(projectRoot) {
      const result = await realignPromotedSummaryWithEffectiveState(projectRoot)
      return {
        summary: `Realigned effective proof summaries for ${result.taskCount} task${result.taskCount === 1 ? '' : 's'} from the shared current-state boundary.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: MODEL_INDEPENDENT_READINESS_BOUNDARY_MIGRATION_ID,
    title: 'Retire prose-only readiness authority',
    introducedIn: '0.13.13',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Marks the structured readiness, split-boundary, and checkpoint fields as the only machine authority without rewriting or promoting historical model prose.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null) return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === MODEL_INDEPENDENT_READINESS_BOUNDARY_MIGRATION_ID && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied
          ? [projectStateDatabasePath(projectRoot), 'structured readiness and checkpoint authority boundary']
          : [],
      }
    },
    async apply(projectRoot) {
      return {
        summary: 'Published the structured readiness and checkpoint authority boundary; historical prose remains readable audit context and was not promoted into state.',
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: PROOF_SETUP_TASK_KIND_MIGRATION_ID,
    title: 'Replace proof-setup rationale markers with task semantics',
    introducedIn: '0.13.19',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Converts generated proof-setup children from a free-text proposal marker to an explicit semantic task kind so execution never depends on wording.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const taskIds = (queue?.tasks as unknown as Task[] | undefined)
        ?.filter(taskNeedsProofSetupKindMigration)
        .map(task => task.id) ?? []
      return {
        needed: taskIds.length > 0,
        affectedPaths: taskIds.length > 0
          ? [projectStateDatabasePath(projectRoot), `proof-setup tasks using rationale markers (${taskIds.length})`]
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) {
        return {
          summary: 'Skipped proof-setup semantic migration because the authoritative task detail store is unavailable.',
          affectedPaths: [],
        }
      }
      let changed = 0
      for (const task of queue.tasks as unknown as Task[]) {
        if (migrateProofSetupTaskKind(task)) changed += 1
      }
      if (changed > 0) {
        queue.lastUpdated = new Date().toISOString()
        writeProjectTaskQueueWithSummary(tasksPath, queue, {
          projectId: path.basename(projectRoot),
          projectRoot,
          compactCompatibility: true,
        })
      }
      return {
        summary: changed > 0
          ? `Converted ${changed} proof-setup task${changed === 1 ? '' : 's'} to the explicit proof_setup semantic kind; rationale text is no longer machine authority.`
          : 'Proof-setup tasks already use the explicit semantic kind.',
        affectedPaths: changed > 0 ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: PROOF_SETUP_CONTRACT_MIGRATION_ID,
    title: 'Install deterministic proof-setup contracts',
    introducedIn: '0.13.20',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Replaces model-shaped proof-setup drafts with one canonical structured contract so proof discovery is executable work and cannot oscillate on provider wording.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const taskIds = (queue?.tasks as unknown as Task[] | undefined)
        ?.filter(taskNeedsDeterministicProofSetupContract)
        .map(task => task.id) ?? []
      return {
        needed: taskIds.length > 0,
        affectedPaths: taskIds.length > 0
          ? [projectStateDatabasePath(projectRoot), `proof-setup contracts requiring repair (${taskIds.length})`]
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) {
        return {
          summary: 'Skipped proof-setup contract repair because the authoritative task detail store is unavailable.',
          affectedPaths: [],
        }
      }
      const now = new Date().toISOString()
      let changed = 0
      for (const task of queue.tasks as unknown as Task[]) {
        if (!taskNeedsDeterministicProofSetupContract(task)) continue
        const parentId = task.hierarchy?.parentId ?? task.delivery?.supports?.[0]
        const parent = parentId
          ? (queue.tasks as unknown as Task[]).find(candidate => candidate.id === parentId)
          : undefined
        if (!parent) continue
        if (migrateDeterministicProofSetupContract(task, parent, now)) changed += 1
      }
      if (changed > 0) {
        queue.lastUpdated = now
        writeProjectTaskQueueWithSummary(tasksPath, queue, {
          projectId: path.basename(projectRoot),
          projectRoot,
          compactCompatibility: true,
        })
      }
      return {
        summary: changed > 0
          ? `Repaired ${changed} model-shaped proof-setup task${changed === 1 ? '' : 's'} with the canonical structured contract.`
          : 'Proof-setup tasks already use the canonical structured contract.',
        affectedPaths: changed > 0 ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: RECURSIVE_PROOF_SETUP_MIGRATION_ID,
    title: 'Remove recursive proof-setup tasks',
    introducedIn: '0.13.21',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Removes accidental proof-setup descendants and their stale parent links so one proof task remains the executable boundary for each work item.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const taskIds = recursiveProofSetupTaskIds((queue?.tasks ?? []) as unknown as Task[])
      return {
        needed: taskIds.size > 0,
        affectedPaths: taskIds.size > 0
          ? [projectStateDatabasePath(projectRoot), `recursive proof-setup tasks (${taskIds.size})`]
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) {
        return {
          summary: 'Skipped recursive proof-setup cleanup because the authoritative task detail store is unavailable.',
          affectedPaths: [],
        }
      }
      const typedQueue = queue as unknown as { tasks: Task[]; releases?: ProjectRelease[]; lastUpdated?: string }
      const removed = removeRecursiveProofSetupTasks(typedQueue)
      if (removed > 0) {
        const now = new Date().toISOString()
        typedQueue.lastUpdated = now
        writeProjectTaskQueueWithSummary(tasksPath, typedQueue, {
          projectId: path.basename(projectRoot),
          projectRoot,
          compactCompatibility: true,
        })
      }
      return {
        summary: removed > 0
          ? `Removed ${removed} recursive proof-setup task${removed === 1 ? '' : 's'} and detached their stale hierarchy and release links.`
          : 'No recursive proof-setup tasks remained.',
        affectedPaths: removed > 0 ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: PROOF_COMMAND_IDENTITY_MIGRATION_ID,
    title: 'Require task identity in proof commands',
    introducedIn: '0.13.22',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Invalidates proof setup evidence that does not identify the bounded task in structured command output, removes generic proof commands, and requires a fresh task-specific run.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const taskIds = (queue?.tasks as unknown as Task[] | undefined)
        ?.filter(proofSetupNeedsCommandIdentity)
        .map(task => task.id) ?? []
      return {
        needed: taskIds.length > 0,
        affectedPaths: taskIds.length > 0
          ? [projectStateDatabasePath(projectRoot), `proof setup evidence without task identity (${taskIds.length})`]
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) {
        return {
          summary: 'Skipped proof command identity migration because the authoritative task detail store is unavailable.',
          affectedPaths: [],
        }
      }
      const now = new Date().toISOString()
      const shippedReleaseIds = new Set(
        (queue.releases ?? [])
          .filter(release => release.state === 'shipped')
          .map(release => release.id),
      )
      let changed = 0
      for (const task of queue.tasks as unknown as Task[]) {
        const preserveCompletedStatus = proofSetupScopedReleaseIds(task).some(releaseId => shippedReleaseIds.has(releaseId))
        if (migrateProofSetupCommandIdentity(task, now, preserveCompletedStatus)) changed += 1
      }
      if (changed > 0) {
        queue.lastUpdated = now
        writeProjectTaskQueueWithSummary(tasksPath, queue, {
          projectId: path.basename(projectRoot),
          projectRoot,
          compactCompatibility: true,
        })
      }
      return {
        summary: changed > 0
          ? `Invalidated and re-shaped ${changed} proof setup task${changed === 1 ? '' : 's'} so command output must identify the bounded task.`
          : 'Proof setup commands already carry task identity evidence.',
        affectedPaths: changed > 0 ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: ACCEPTANCE_COMMAND_PROOF_PATH_RECONCILIATION_MIGRATION_ID,
    title: 'Reconcile generated proof paths with acceptance criteria',
    introducedIn: '0.13.27',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    recheckAfterApply: true,
    summary: 'Removes stale generated proof obligations and refreshes their labels and evidence from the current typed acceptance-command contract without mutating authored proof paths.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const taskIds = (queue?.tasks as unknown as Task[] | undefined)
        ?.filter(taskNeedsAcceptanceCommandProofPathReconciliation)
        .map(task => task.id) ?? []
      return {
        needed: taskIds.length > 0,
        affectedPaths: taskIds.length > 0
          ? [projectStateDatabasePath(projectRoot), `generated proof paths (${taskIds.length} task${taskIds.length === 1 ? '' : 's'})`]
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) {
        return {
          summary: 'Skipped proof-path reconciliation because the authoritative task detail store is unavailable.',
          affectedPaths: [],
        }
      }
      const now = new Date().toISOString()
      let changed = 0
      for (const task of queue.tasks as unknown as Task[]) {
        const before = JSON.stringify(task.proofPaths ?? [])
        const next = ensureCommandProofPathsFromAcceptanceCriteria(task, now, 'guildhall-migration')
        if (JSON.stringify(next) === before) continue
        task.proofPaths = next
        task.updatedAt = now
        changed += 1
      }
      if (changed > 0) {
        queue.lastUpdated = now
        writeProjectTaskQueueWithSummary(tasksPath, queue, {
          projectId: path.basename(projectRoot),
          projectRoot,
          compactCompatibility: true,
        })
      }
      return {
        summary: changed > 0
          ? `Reconciled generated proof paths for ${changed} task${changed === 1 ? '' : 's'} from the current typed acceptance criteria.`
          : 'Generated proof paths already match the current typed acceptance criteria.',
        affectedPaths: changed > 0 ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: PROOF_SETUP_COMPLETION_AUTHORITY_MIGRATION_ID,
    title: 'Reopen proof setup that was marked done without current proof',
    introducedIn: '0.13.30',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    // This migration repairs the historical completion transition once. Later
    // proof-history and projection migrations own newly discovered proof drift;
    // rechecking this legacy repair would otherwise reopen shipped releases on
    // every ordinary project action.
    summary: 'Restores the executable proof boundary when a proof-setup task was marked done before its current typed command evidence was verified. Historical shipped release records stay closed.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const tasks = (queue?.tasks ?? []) as unknown as Task[]
      const releases = (queue?.releases ?? []) as unknown as ProjectRelease[]
      const releaseState = await readProjectReleaseState(projectRoot)
      const selectedReleaseId = releaseState.scope?.kind === 'release'
        ? releaseState.scope.id
        : releaseState.rawQueue.selectedReleaseId ?? queue?.selectedReleaseId
      const runtime = await readTaskRuntimeStore(projectRoot)
      const taskIds = tasks
        .filter(task =>
          taskNeedsProofSetupRuntimeRecovery(task, runtime) &&
          proofSetupRuntimeRecoveryIsActionable(task, releases, selectedReleaseId),
        )
        .map(task => task.id)
      return {
        needed: taskIds.length > 0,
        affectedPaths: taskIds.length > 0
          ? [projectStateDatabasePath(projectRoot), `unproven proof-setup tasks (${taskIds.length})`]
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) {
        return {
          summary: 'Skipped proof-setup completion repair because the authoritative task detail store is unavailable.',
          affectedPaths: [],
        }
      }
      const now = new Date().toISOString()
      const tasks = queue.tasks as unknown as Task[]
      const releases = (queue.releases ?? []) as unknown as ProjectRelease[]
      const runtime = await readTaskRuntimeStore(projectRoot)
      let changed = 0
      for (const task of tasks) {
        if (!taskNeedsProofSetupRuntimeRecovery(task, runtime)) continue
        if (releaseLocalProofSetupRepair({ tasks, releases }, task, releases, now)) {
          changed += 1
          continue
        }
        reopenUnprovenProofSetupTask(task, now)
        await upsertTaskRuntimeState(projectRoot, task.id, {
          assignedTo: null,
          proofRecovery: {
            reopenedAt: now,
            kind: 'proof',
            reason: 'Current typed proof was missing; historical completion evidence cannot settle the active lifecycle.',
          },
          updatedAt: now,
        })
        changed += 1
      }
      if (changed > 0) {
        queue.lastUpdated = now
        writeProjectTaskQueueWithSummary(tasksPath, queue, {
          projectId: path.basename(projectRoot),
          projectRoot,
          compactCompatibility: true,
        })
      }
      return {
        summary: changed > 0
          ? `Reopened ${changed} proof-setup task${changed === 1 ? '' : 's'} until current typed command evidence is verified.`
          : 'All active proof-setup tasks already have current completion proof.',
        affectedPaths: changed > 0 ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: PROOF_SETUP_HISTORY_FENCE_MIGRATION_ID,
    title: 'Fence historical proof setup completion from the active lifecycle',
    introducedIn: '0.13.31',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Prevents stale done summaries and merge records from re-closing proof setup after Guildhall reopens it for current verification.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const tasks = (queue?.tasks ?? []) as unknown as Task[]
      const releases = (queue?.releases ?? []) as unknown as ProjectRelease[]
      const taskIds = tasks
        .filter(task => taskNeedsProofSetupCompletionRepair(task, releases))
        .map(task => task.id)
      return {
        needed: taskIds.length > 0,
        affectedPaths: taskIds.length > 0
          ? [projectStateDatabasePath(projectRoot), 'proof-setup history fences (' + taskIds.length + ')']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) {
        return {
          summary: 'Skipped proof-setup history fencing because the authoritative task detail store is unavailable.',
          affectedPaths: [],
        }
      }
      const now = new Date().toISOString()
      const tasks = queue.tasks as unknown as Task[]
      const releases = (queue.releases ?? []) as unknown as ProjectRelease[]
      let changed = 0
      for (const task of tasks) {
        if (!taskNeedsProofSetupCompletionRepair(task, releases)) continue
        if (releaseLocalProofSetupRepair({ tasks, releases }, task, releases, now)) {
          changed += 1
          continue
        }
        reopenUnprovenProofSetupTask(task, now)
        await upsertTaskRuntimeState(projectRoot, task.id, {
          assignedTo: null,
          proofRecovery: {
            reopenedAt: now,
            kind: 'proof',
            reason: 'Current typed proof was missing; historical completion evidence cannot settle the active lifecycle.',
          },
          updatedAt: now,
        })
        changed += 1
      }
      if (changed > 0) {
        queue.lastUpdated = now
        writeProjectTaskQueueWithSummary(tasksPath, queue, {
          projectId: path.basename(projectRoot),
          projectRoot,
          compactCompatibility: true,
        })
      }
      return {
        summary: changed > 0
          ? 'Fenced historical completion for ' + changed + ' proof-setup task' + (changed === 1 ? '' : 's') + ' before current verification.'
          : 'All active proof-setup histories are already fenced from current lifecycle state.',
        affectedPaths: changed > 0 ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: PROOF_SETUP_RUNTIME_RECOVERY_MIGRATION_ID,
    title: 'Record the proof recovery marker in the runtime authority',
    introducedIn: '0.13.32',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Makes reopened proof setup survive landing reconciliation even when historical completion detail is retained outside the compact task definition.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const tasks = (queue?.tasks ?? []) as unknown as Task[]
      const runtime = await readTaskRuntimeStore(projectRoot)
      const taskIds = tasks
        .filter(task => taskNeedsProofSetupRuntimeRecovery(task, runtime))
        .map(task => task.id)
      return {
        needed: taskIds.length > 0,
        affectedPaths: taskIds.length > 0
          ? [projectStateDatabasePath(projectRoot), 'proof-setup runtime recovery markers (' + taskIds.length + ')']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) {
        return {
          summary: 'Skipped proof-setup runtime recovery markers because the authoritative task detail store is unavailable.',
          affectedPaths: [],
        }
      }
      const now = new Date().toISOString()
      const tasks = queue.tasks as unknown as Task[]
      const releases = (queue.releases ?? []) as unknown as ProjectRelease[]
      const runtime = await readTaskRuntimeStore(projectRoot)
      let changed = 0
      for (const task of tasks) {
        if (!taskNeedsProofSetupRuntimeRecovery(task, runtime)) continue
        if (releaseLocalProofSetupRepair({ tasks, releases }, task, releases, now)) {
          changed += 1
          continue
        }
        reopenUnprovenProofSetupTask(task, now)
        await upsertTaskRuntimeState(projectRoot, task.id, {
          assignedTo: null,
          proofRecovery: {
            reopenedAt: now,
            kind: 'proof',
            reason: 'Current typed proof was missing; historical completion evidence cannot settle the active lifecycle.',
          },
          updatedAt: now,
        })
        changed += 1
      }
      if (changed > 0) {
        queue.lastUpdated = now
        writeProjectTaskQueueWithSummary(tasksPath, queue, {
          projectId: path.basename(projectRoot),
          projectRoot,
          compactCompatibility: true,
        })
      }
      return {
        summary: changed > 0
          ? 'Recorded runtime recovery markers for ' + changed + ' proof-setup task' + (changed === 1 ? '' : 's') + ' before current verification.'
          : 'All active proof-setup tasks already have current runtime recovery authority.',
        affectedPaths: changed > 0 ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: DELIVERY_READ_PROJECTION_MIGRATION_ID,
    title: 'Create the delivery read projection',
    introducedIn: '0.13.3',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Creates the revisioned delivery read-model tables so ordinary queue and relationship reads have one saved authority instead of rebuilding delivery state in a GET.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const present = deliveryReadProjectionSchemaPresent(projectRoot)
      return {
        // The projector may create the tables before the migration runner
        // observes them. Physical schema is the authority for this shape
        // migration; a missing ledger row is reconciled, not blocking.
        needed: !present,
        affectedPaths: !present
          ? [projectStateDatabasePath(projectRoot), present ? 'delivery read projection migration ledger' : 'delivery read projection tables']
          : [],
      }
    },
    async apply(projectRoot) {
      const created = ensureDeliveryReadProjectionSchema(projectRoot)
      if (!created) throw new Error('The current project-state database is unavailable for delivery projection migration.')
      return {
        summary: 'Created the delivery read projection schema; the asynchronous projector will populate its revisioned rows.',
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: STORED_REQUEST_TITLE_INTEGRITY_MIGRATION_ID,
    title: 'Repair provably cropped stored request titles',
    introducedIn: '0.13.4',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Repairs persisted request titles that end in an ellipsis only when their complete first line is still present in the raw request; ambiguous records remain visible for review.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const status = readProjectStateDatabaseStoredRequestTitleRepairStatus(projectRoot)
      return {
        needed: status.needed,
        affectedPaths: status.needed
          ? [projectStateDatabasePath(projectRoot), 'task request titles']
          : [],
      }
    },
    async apply(projectRoot) {
      const result = repairProjectStateDatabaseStoredRequestTitles(projectRoot)
      return {
        summary: result.repairedCount > 0
          ? `Repaired ${result.repairedCount} stored request title${result.repairedCount === 1 ? '' : 's'} without changing task titles or raw request text${result.ambiguousCount > 0 ? `; ${result.ambiguousCount} ambiguous record${result.ambiguousCount === 1 ? '' : 's'} remain` : ''}.`
          : `No provably cropped request titles were repaired${result.ambiguousCount > 0 ? `; ${result.ambiguousCount} ambiguous record${result.ambiguousCount === 1 ? '' : 's'} remain` : ''}.`,
        affectedPaths: result.repairedCount > 0 ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: OWNER_INPUT_CURRENT_AUTHORITY_MIGRATION_ID,
    title: 'Promote the normalized owner-input queue to current authority',
    introducedIn: '0.13.5',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Materializes open owner-input request files into the normalized current queue and removes their duplicate summary copy after the queue publishes its authority watermark.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === OWNER_INPUT_CURRENT_AUTHORITY_MIGRATION_ID && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied
          ? [projectStateDatabasePath(projectRoot), 'owner-input request files']
          : [],
      }
    },
    async apply(projectRoot) {
      const requests = listOwnerInputRequestsSync(projectRoot)
        .filter(request => request.status === 'waiting_for_owner' || request.status === 'coordinator_review')
      const updatedAt = requests.reduce(
        (latest, request) => request.updatedAt > latest ? request.updatedAt : latest,
        new Date().toISOString(),
      )
      refreshOwnerInputProjection(projectRoot, updatedAt)
      return {
        summary: `Published ${requests.length} open owner-input request${requests.length === 1 ? '' : 's'} as the normalized current queue; the summary duplicate was removed without deleting request history.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: RELEASE_MEMBERSHIP_CURRENT_AUTHORITY_MIGRATION_ID,
    title: 'Retire release membership mirrors',
    introducedIn: '0.13.6',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Removes old task and scope membership arrays after the normalized release relation has published its authority watermark.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === RELEASE_MEMBERSHIP_CURRENT_AUTHORITY_MIGRATION_ID && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied
          ? [projectStateDatabasePath(projectRoot), 'normalized release membership relation']
          : [],
      }
    },
    async apply(projectRoot) {
      const result = retireProjectStateDatabaseReleaseMembershipMirrors(projectRoot)
      const mirrorCount = result.taskMirrorCount + result.scopeMirrorCount
      return {
        summary: mirrorCount > 0
          ? `Retired ${mirrorCount} duplicate release membership mirror${mirrorCount === 1 ? '' : 's'}; the normalized relation is now the only current authority.`
          : 'Published the normalized release membership relation as the only current authority; no duplicate mirrors remained.',
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: MODEL_INDEPENDENT_MACHINE_BOUNDARY_MIGRATION_ID,
    title: 'Reproject model-independent machine evidence',
    introducedIn: '0.13.11',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Rebuilds bounded current evidence from retained task history so structured review and self-critique contracts survive the prose compaction boundary without treating model wording as state.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null) return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === MODEL_INDEPENDENT_MACHINE_BOUNDARY_MIGRATION_ID && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied
          ? [projectStateDatabasePath(projectRoot), 'retained task evidence history']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const detail = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const taskIds = detail?.tasks
        .flatMap(task => typeof task.id === 'string' ? [task.id] : [])
        ?? []
      const result = await backfillTaskEvidenceCurrent(projectRoot, taskIds)
      return {
        summary: `Reprojected bounded current evidence for ${result.tasks} task${result.tasks === 1 ? '' : 's'} from ${result.events} retained historical event${result.events === 1 ? '' : 's'}; prose remains display-only and historical records were not rewritten.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: RELEASE_LOCAL_PROOF_SCOPE_MIGRATION_ID,
    title: 'Reproject release-local proof children',
    introducedIn: '0.13.33',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Rebuilds release readiness so a proof child shipped with an older release cannot block or satisfy a later release through ancestor membership alone.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null) return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === RELEASE_LOCAL_PROOF_SCOPE_MIGRATION_ID && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied
          ? [projectStateDatabasePath(projectRoot), 'saved release readiness projection']
          : [],
      }
    },
    async apply(projectRoot) {
      const projection = await realignPromotedSummaryWithEffectiveState(projectRoot)
      return {
        summary: `Reprojected release readiness for ${projection.taskCount} task${projection.taskCount === 1 ? '' : 's'} from current typed evidence and the selected release's proof children.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: INTERNAL_PROOF_RELEASE_CONTEXT_MIGRATION_ID,
    title: 'Separate internal proof context from release membership',
    introducedIn: '0.13.65',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Moves hidden proof work out of visible release membership and records one typed proof scope per child so release progress never replaces a feature with its internal verification step.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const typedQueue = queue as unknown as { tasks: Task[]; releases?: ProjectRelease[] } | null
      const needed = typedQueue ? internalProofReleaseContextNeedsMigration(typedQueue) : false
      return {
        needed,
        affectedPaths: needed
          ? [projectStateDatabasePath(projectRoot), 'internal proof release membership']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) {
        return {
          summary: 'Skipped internal proof scope normalization because the authoritative task detail store is unavailable.',
          affectedPaths: [],
        }
      }
      const typedQueue = queue as unknown as { tasks: Task[]; releases?: ProjectRelease[]; lastUpdated?: string }
      const result = migrateInternalProofReleaseContexts(typedQueue, new Date().toISOString())
      if (result.normalized > 0) {
        typedQueue.lastUpdated = new Date().toISOString()
        writeProjectTaskQueueWithSummary(tasksPath, typedQueue, {
          projectId: path.basename(projectRoot),
          projectRoot,
          compactCompatibility: true,
        })
      }
      return {
        summary: result.normalized > 0
          ? `Normalized ${result.normalized} internal proof scope${result.normalized === 1 ? '' : 's'}; ${result.materialized} fresh active-release proof task${result.materialized === 1 ? '' : 's'} replaced ambiguous historical membership${result.historical > 0 ? ` across ${result.historical} historical record${result.historical === 1 ? '' : 's'}` : ''}.`
          : 'Internal proof work already uses typed release context and no visible release membership.',
        affectedPaths: result.normalized > 0 ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: INDEXED_SEMANTIC_KIND_MIGRATION_ID,
    title: 'Persist semantic task kinds in compact read models',
    introducedIn: '0.13.39',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Adds typed semantic task kinds to bounded task points so compact projections can make release-local decisions without opening task prose or detail blobs.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null) return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === INDEXED_SEMANTIC_KIND_MIGRATION_ID && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied
          ? [projectStateDatabasePath(projectRoot), 'compact semantic task-kind points']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) {
        return {
          summary: 'Skipped semantic task-kind backfill because the authoritative task detail store is unavailable.',
          affectedPaths: [],
        }
      }
      const summaries = queue.tasks.map(task => ({
        taskId: String(task.id),
        summary: projectStateDatabaseTaskSummary(task),
      }))
      const rewritten = rewriteProjectStateDatabaseTaskSummaries(projectRoot, summaries)
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: `Persisted typed semantic kinds for ${rewritten.updatedCount} compact task point${rewritten.updatedCount === 1 ? '' : 's'} and refreshed the shared release projection (${projection.releaseSummary.state}).`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: SPEC_REVIEW_GATE_MIGRATION_ID,
    title: 'Record explicit spec review gates',
    introducedIn: '0.13.67',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Records whether each existing spec review is waiting for an owner or coordinator, so runs and project views use one typed approval fact instead of inferring it from a lifecycle label.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const taskIds = (queue?.tasks as unknown as Task[] | undefined)
        ?.filter(taskNeedsSpecReviewGateMigration)
        .map(task => task.id) ?? []
      return {
        needed: taskIds.length > 0,
        affectedPaths: taskIds.length > 0
          ? [projectStateDatabasePath(projectRoot), `spec review gates requiring authority (${taskIds.length})`]
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) {
        return {
          summary: 'Skipped explicit spec review gates because the authoritative task detail store is unavailable.',
          affectedPaths: [],
        }
      }
      const now = new Date().toISOString()
      const tasks = queue.tasks as unknown as Task[]
      const migrated = tasks.filter(task => migrateLegacySpecReviewGate(task, now))
      if (migrated.length > 0) {
        queue.lastUpdated = now
        writeProjectTaskQueueWithSummary(tasksPath, queue, {
          projectId: path.basename(projectRoot),
          projectRoot,
          compactCompatibility: true,
        })
      }
      return {
        summary: migrated.length > 0
          ? `Recorded explicit owner review gates for ${migrated.length} legacy spec${migrated.length === 1 ? '' : 's'}; future coordinator-owned review must be recorded as such when it is created.`
          : 'Every current spec review already records its review authority.',
        affectedPaths: migrated.length > 0 ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: DURABLE_SPEC_HANDOFF_MIGRATION_ID,
    title: 'Settle durable spec handoffs',
    introducedIn: '0.13.68',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Moves an already approved, structurally valid spec out of stale shaping and into its explicit owner review gate, so the coordinator and project summary do not disagree about whether it is runnable.',
    async detect(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const taskIds = (queue?.tasks as unknown as Task[] | undefined)
        ?.filter(taskNeedsDurableSpecHandoffMigration)
        .map(task => task.id) ?? []
      return {
        needed: taskIds.length > 0,
        affectedPaths: taskIds.length > 0
          ? [projectStateDatabasePath(projectRoot), `durable spec handoffs awaiting typed review (${taskIds.length})`]
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) {
        return {
          summary: 'Skipped durable spec handoff repair because the authoritative task detail store is unavailable.',
          affectedPaths: [],
        }
      }
      const now = new Date().toISOString()
      const tasks = queue.tasks as unknown as Task[]
      const settled = tasks.filter(task => settleDurableSpecHandoff(task, now))
      if (settled.length > 0) {
        queue.lastUpdated = now
        writeProjectTaskQueueWithSummary(tasksPath, queue, {
          projectId: path.basename(projectRoot),
          projectRoot,
          compactCompatibility: true,
        })
      }
      return {
        summary: settled.length > 0
          ? `Moved ${settled.length} durable spec handoff${settled.length === 1 ? '' : 's'} into explicit owner review; no task was approved or made runnable by this repair.`
          : 'No durable specs were left in stale shaping state.',
        affectedPaths: settled.length > 0 ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: COMPACT_SPEC_REVIEW_AUTHORITY_MIGRATION_ID,
    title: 'Materialize compact spec review authority',
    introducedIn: '0.13.69',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Backfills the bounded owner-or-coordinator review authority for existing spec-review task points, so the fast project projection cannot disagree with task detail about whether work needs owner review.',
    async detect(projectRoot) {
      const needed = compactSpecReviewAuthorityNeedsMigration(projectRoot)
      return {
        needed,
        affectedPaths: needed
          ? [projectStateDatabasePath(projectRoot), 'compact spec-review authority points and shared summary']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) {
        return {
          summary: 'Skipped compact spec-review authority backfill because the authoritative task detail store is unavailable.',
          affectedPaths: [],
        }
      }
      const summaries = queue.tasks.map(task => ({
        taskId: String(task.id),
        summary: projectStateDatabaseTaskSummary(task),
      }))
      const rewritten = rewriteProjectStateDatabaseTaskSummaries(projectRoot, summaries)
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: `Materialized compact review authority for ${rewritten.updatedCount} task point${rewritten.updatedCount === 1 ? '' : 's'} and refreshed the shared project decision (${projection.decision.primaryAction.kind}).`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: COMPACT_SPEC_REVIEW_READINESS_MIGRATION_ID,
    title: 'Materialize compact spec review readiness',
    introducedIn: '0.13.100',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Backfills the typed ready-for-owner-approval fact for spec reviews, so compact project views cannot ask for approval before the durable spec contract is complete.',
    async detect(projectRoot) {
      const needed = compactSpecReviewReadinessNeedsMigration(projectRoot)
      return {
        needed,
        affectedPaths: needed
          ? [projectStateDatabasePath(projectRoot), 'compact spec-review readiness points and shared summary']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) {
        return {
          summary: 'Skipped compact spec-review readiness backfill because the authoritative task detail store is unavailable.',
          affectedPaths: [],
        }
      }
      const summaries = queue.tasks.map(task => ({
        taskId: String(task.id),
        summary: projectStateDatabaseTaskSummary(task),
      }))
      const rewritten = rewriteProjectStateDatabaseTaskSummaries(projectRoot, summaries)
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: `Materialized compact review readiness for ${rewritten.updatedCount} task point${rewritten.updatedCount === 1 ? '' : 's'} and refreshed the shared project decision (${projection.decision.primaryAction.kind}).`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: ATOMIC_DECISION_FOCUS_MIGRATION_ID,
    title: 'Rebuild project decisions with atomic focus references',
    introducedIn: '0.13.70',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Rebuilds the shared project decision from normalized task points so an advanced focus task cannot retain an earlier task title in Overview, Work, Map, or Start.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = readProjectSummaryProjectionForMigration(tasksPath)
      return {
        needed: !projection || !projectSummaryProjectionIsCurrent(projection),
        affectedPaths: !projection || !projectSummaryProjectionIsCurrent(projection)
          ? [projectStateDatabasePath(projectRoot), 'shared decision focus reference']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
        projectId: path.basename(projectRoot),
      })
      if (!projection || !projectSummaryProjectionIsCurrent(projection)) {
        throw new Error('The shared project decision could not be rebuilt with an atomic focus reference.')
      }
      return {
        summary: 'Rebuilt the shared decision from one normalized task snapshot; focused work now carries its own canonical display identity.',
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: DURABLE_DECISION_SNAPSHOT_MIGRATION_ID,
    title: 'Materialize the durable project decision snapshot',
    introducedIn: '0.13.71',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Records the typed canonical claims and one revision-bound decision packet that Overview, Work, Map, Thread, Release, Activity, and Start share.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      // This migration creates the durable decision capability. A later
      // runtime/evidence revision can naturally make its packet stale while a
      // projection job catches up; that is not a schema migration and must not
      // turn every ordinary action into "migrate again".
      const needed = !hasProjectStateDatabaseDecisionSnapshot(projectRoot)
      return {
        needed,
        affectedPaths: needed
          ? [projectStateDatabasePath(projectRoot), 'shared project decision snapshot']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
        projectId: path.basename(projectRoot),
      })
      const bundle = readProjectStateDatabaseReadBundle(tasksPath)
      if (!projection || !bundle?.stateResolution || bundle.stateResolution.projectRevision !== bundle.projectRevision) {
        throw new Error('The durable project decision snapshot could not be rebuilt from the current normalized state.')
      }
      return {
        summary: 'Recorded the current normalized release, execution focus, and eligibility as one shared decision snapshot.',
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: INDEXED_RELEASE_SUMMARY_REPROJECTION_MIGRATION_ID,
    title: 'Reproject release summary from indexed membership',
    introducedIn: '0.13.72',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Rebuilds the compact release summary and decision packet from normalized release membership and scope rows when a previously current summary was stamped with stale selected-release counts.',
    async detect(projectRoot) {
      const inspection = inspectIndexedReleaseSummaryReprojection(projectRoot)
      return {
        needed: inspection.needed,
        affectedPaths: inspection.needed
          ? [projectStateDatabasePath(projectRoot), 'compact release summary and shared decision packet']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const before = inspectIndexedReleaseSummaryReprojection(projectRoot)
      if (before.needed) markProjectStateDatabaseStale(projectRoot)
      const projection = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
        projectId: path.basename(projectRoot),
      })
      if (!projection) {
        throw new Error('The release summary could not be rebuilt from normalized indexed state.')
      }
      return {
        summary: before.needed
          ? 'Rebuilt the release summary and shared decision from normalized release membership and scope rows.'
          : 'Release summary already matched normalized release membership and scope rows.',
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: NAMED_RELEASE_MEMBER_COUNT_MIGRATION_ID,
    title: 'Align named release counts with membership',
    introducedIn: '0.13.73',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Rebuilds the compact release summary so a named release counts its selected membership instead of executable child rows while preserving later-work deferred counts.',
    async detect(projectRoot) {
      const inspection = inspectIndexedReleaseSummaryReprojection(projectRoot)
      return {
        needed: inspection.needed,
        affectedPaths: inspection.needed
          ? [projectStateDatabasePath(projectRoot), 'named release summary counts and shared decision packet']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const before = inspectIndexedReleaseSummaryReprojection(projectRoot)
      if (before.needed) markProjectStateDatabaseStale(projectRoot)
      const projection = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
        projectId: path.basename(projectRoot),
      })
      if (!projection) {
        throw new Error('The named release counts could not be rebuilt from normalized indexed state.')
      }
      return {
        summary: before.needed
          ? 'Rebuilt named release counts from selected membership and refreshed the shared decision packet.'
          : 'Named release counts already matched normalized indexed membership.',
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: INCLUDED_RELEASE_DISPOSITION_COUNT_MIGRATION_ID,
    title: 'Count only included release membership',
    introducedIn: '0.13.74',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Rebuilds named-release counts from included normalized membership so deferred release rows cannot inflate the selected release total.',
    async detect(projectRoot) {
      const inspection = inspectIndexedReleaseSummaryReprojection(projectRoot)
      return {
        needed: inspection.needed,
        affectedPaths: inspection.needed
          ? [projectStateDatabasePath(projectRoot), 'included release membership counts and shared decision packet']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const before = inspectIndexedReleaseSummaryReprojection(projectRoot)
      if (before.needed) markProjectStateDatabaseStale(projectRoot)
      const projection = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
        projectId: path.basename(projectRoot),
      })
      if (!projection) {
        throw new Error('The included release membership counts could not be rebuilt from normalized indexed state.')
      }
      return {
        summary: before.needed
          ? 'Rebuilt selected release counts from included normalized membership and refreshed the shared decision packet.'
          : 'Selected release counts already matched included normalized membership.',
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: CANONICAL_RELEASE_MEMBERSHIP_SUMMARY_MIGRATION_ID,
    title: 'Read release counts from canonical membership',
    introducedIn: '0.13.75',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Rebuilds the compact release summary from the normalized release_membership relation so selected release totals cannot be inflated by execution-scope container rewrites.',
    async detect(projectRoot) {
      const inspection = inspectIndexedReleaseSummaryReprojection(projectRoot)
      return {
        needed: inspection.needed,
        affectedPaths: inspection.needed
          ? [projectStateDatabasePath(projectRoot), 'canonical release membership summary and shared decision packet']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const before = inspectIndexedReleaseSummaryReprojection(projectRoot)
      if (before.needed) markProjectStateDatabaseStale(projectRoot)
      const projection = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
        projectId: path.basename(projectRoot),
      })
      if (!projection) {
        throw new Error('The canonical release membership summary could not be rebuilt from normalized indexed state.')
      }
      return {
        summary: before.needed
          ? 'Rebuilt the release summary from canonical normalized membership and refreshed the shared decision packet.'
          : 'Release summary already matched canonical normalized membership.',
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: SELECTED_RELEASE_NODE_MEMBERSHIP_SUMMARY_MIGRATION_ID,
    title: 'Fallback to selected release membership nodes',
    introducedIn: '0.13.76',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Rebuilds the compact release summary so selected release node IDs remain the membership fallback when execution rows include release-local proof children.',
    async detect(projectRoot) {
      const inspection = inspectIndexedReleaseSummaryReprojection(projectRoot)
      return {
        needed: inspection.needed,
        affectedPaths: inspection.needed
          ? [projectStateDatabasePath(projectRoot), 'selected release membership fallback summary and shared decision packet']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const before = inspectIndexedReleaseSummaryReprojection(projectRoot)
      if (before.needed) markProjectStateDatabaseStale(projectRoot)
      const projection = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
        projectId: path.basename(projectRoot),
      })
      if (!projection) {
        throw new Error('The selected release membership summary could not be rebuilt from normalized indexed state.')
      }
      return {
        summary: before.needed
          ? 'Rebuilt the release summary from selected release membership nodes and refreshed the shared decision packet.'
          : 'Release summary already matched selected release membership nodes.',
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: RELEASE_MEMBERSHIP_READ_BOUNDARY_MIGRATION_ID,
    title: 'Rebuild release membership read boundary',
    introducedIn: '0.13.99',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Rebuilds compact release scope and readiness after the selected release read boundary stopped treating execution/proof rows as release membership.',
    async detect(projectRoot) {
      const inspection = inspectIndexedReleaseSummaryReprojection(projectRoot)
      return {
        needed: inspection.needed,
        affectedPaths: inspection.needed
          ? [projectStateDatabasePath(projectRoot), 'selected release membership read model and shared decision packet']
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const before = inspectIndexedReleaseSummaryReprojection(projectRoot)
      if (before.needed) markProjectStateDatabaseStale(projectRoot)
      const projection = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
        projectId: path.basename(projectRoot),
      })
      if (!projection) {
        throw new Error('The release membership read boundary could not be rebuilt from normalized indexed state.')
      }
      return {
        summary: before.needed
          ? 'Rebuilt selected release membership and readiness from canonical membership instead of execution rows.'
          : 'Selected release membership read boundary already matched canonical membership.',
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: PROOF_SETUP_EXECUTION_BLUEPRINT_MIGRATION_ID,
    title: 'Restore proof-setup execution blueprints',
    introducedIn: '0.13.41',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Restores the canonical Guildhall-owned proof-setup contract when recovery history cleared the current plan, so proof work returns directly to the worker lane instead of generic spec intake.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const taskIds = (queue?.tasks as unknown as Task[] | undefined)
        ?.filter(taskNeedsProofSetupExecutionBlueprint)
        .map(task => task.id) ?? []
      return {
        needed: taskIds.length > 0,
        affectedPaths: taskIds.length > 0
          ? [projectStateDatabasePath(projectRoot), `proof-setup execution blueprints requiring repair (${taskIds.length})`]
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) {
        return {
          summary: 'Skipped proof-setup execution blueprint repair because the authoritative task detail store is unavailable.',
          affectedPaths: [],
        }
      }
      const now = new Date().toISOString()
      let changed = 0
      for (const task of queue.tasks as unknown as Task[]) {
        if (!taskNeedsProofSetupExecutionBlueprint(task)) continue
        const parentId = task.hierarchy?.parentId ?? task.delivery?.supports?.[0]
        const parent = parentId
          ? (queue.tasks as unknown as Task[]).find(candidate => candidate.id === parentId)
          : undefined
        if (!parent) continue
        if (repairProofSetupExecutionBlueprint(task, parent, now)) changed += 1
      }
      if (changed > 0) {
        queue.lastUpdated = now
        writeProjectTaskQueueWithSummary(tasksPath, queue, {
          projectId: path.basename(projectRoot),
          projectRoot,
          compactCompatibility: true,
        })
      }
      return {
        summary: changed > 0
          ? `Restored ${changed} proof-setup execution blueprint${changed === 1 ? '' : 's'} without changing release scope or provider history.`
          : 'Proof-setup tasks already have their canonical execution blueprints.',
        affectedPaths: changed > 0 ? [projectStateDatabasePath(projectRoot)] : [],
      }
    },
  },
  {
    id: PROOF_SETUP_ACCEPTANCE_CONTRACT_MIGRATION_ID,
    title: 'Canonicalize proof-setup acceptance contracts',
    introducedIn: '0.13.55',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Removes leaked generic review criteria from Guildhall-owned proof-setup tasks so one typed command, one proof path, and one stable evidence contract determine proof completion.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const taskIds = (queue?.tasks as unknown as Task[] | undefined)
        ?.filter(taskNeedsCanonicalProofSetupAcceptanceContract)
        .map(task => task.id) ?? []
      return {
        needed: taskIds.length > 0,
        affectedPaths: taskIds.length > 0
          ? [projectStateDatabasePath(projectRoot), `proof-setup acceptance contracts requiring repair (${taskIds.length})`]
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) {
        return {
          summary: 'Skipped proof-setup acceptance-contract repair because the authoritative task detail store is unavailable.',
          affectedPaths: [],
        }
      }
      const now = new Date().toISOString()
      const tasks = queue.tasks as unknown as Task[]
      let changed = 0
      for (const task of tasks) {
        if (!taskNeedsCanonicalProofSetupAcceptanceContract(task)) continue
        const parentId = proofSetupParentId(task)
        const parent = parentId ? tasks.find(candidate => candidate.id === parentId) : undefined
        if (!parent) continue
        if (repairCanonicalProofSetupAcceptanceContract(task, parent, now)) changed += 1
      }
      if (changed > 0) {
        queue.lastUpdated = now
        writeProjectTaskQueueWithSummary(tasksPath, queue, {
          projectId: path.basename(projectRoot),
          projectRoot,
          compactCompatibility: true,
        })
      }
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: changed > 0
          ? `Canonicalized ${changed} proof-setup acceptance contract${changed === 1 ? '' : 's'} to one typed command boundary and refreshed the shared release projection (${projection.releaseSummary.state}) without changing release membership.`
          : `Proof-setup acceptance contracts already use the canonical single-command shape; refreshed the shared release projection (${projection.releaseSummary.state}).`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: PROOF_SETUP_PROJECTION_REFRESH_MIGRATION_ID,
    title: 'Refresh proof-setup release projections',
    introducedIn: '0.13.56',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Rebuilds the saved proof and release projection after proof-setup contract normalization so task detail, release readiness, and compact project views share the same current answer.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      // The immediately following effective-projection migration subsumes
      // this raw-queue refresh. Running both can publish two different
      // canonical decisions for one project revision, which the append-only
      // claim ledger correctly rejects.
      return { needed: false, affectedPaths: [] }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = backfillProjectSummaryProjection(tasksPath, {
        projectId: path.basename(projectRoot),
        projectRoot,
      })
      return {
        summary: `Refreshed the shared proof and release projection (${projection.releaseSummary.state}) from the canonical task graph.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: PROOF_SETUP_EFFECTIVE_PROJECTION_MIGRATION_ID,
    title: 'Project proof from effective current evidence',
    introducedIn: '0.13.57',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Reprojects proof and release readiness from the canonical task snapshot with current typed evidence instead of definition-only rows, keeping compact and rich views on one answer.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === PROOF_SETUP_EFFECTIVE_PROJECTION_MIGRATION_ID && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied
          ? [projectStateDatabasePath(projectRoot), 'effective current proof projection']
          : [],
      }
    },
    async apply(projectRoot) {
      const projection = await realignPromotedSummaryWithEffectiveState(projectRoot)
      return {
        summary: `Reprojected proof and release readiness from current typed evidence for ${projection.taskCount} task${projection.taskCount === 1 ? '' : 's'} (${projection.doneCount} done).`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: DIAGNOSTIC_READINESS_TASK_IDENTITY_MIGRATION_ID,
    title: 'Type task-owned diagnostic blockers',
    introducedIn: '0.13.58',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Adds the normalized task relation to older diagnostic readiness blockers only when the current task inventory proves the blocker ID belongs to a task, so observations can be compared deterministically with the project decision.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const status = diagnosticReadinessTaskIdentityStatus(projectRoot)
      return {
        needed: status.missingTaskIdentityCount > 0,
        affectedPaths: status.missingTaskIdentityCount > 0
          ? [projectStateDatabasePath(projectRoot), `diagnostic readiness (${status.missingTaskIdentityCount} task blocker${status.missingTaskIdentityCount === 1 ? '' : 's'} missing typed ownership)`]
          : [],
      }
    },
    async apply(projectRoot) {
      const status = diagnosticReadinessTaskIdentityStatus(projectRoot)
      const diagnostic = status.diagnostic
      if (!diagnostic?.readiness) {
        return { summary: 'No saved readiness diagnostic needed task-ownership repair.', affectedPaths: [] }
      }
      const blockers = diagnostic.readiness.blockers?.map(blocker =>
        !blocker.taskId && status.taskIds.has(blocker.id)
          ? { ...blocker, taskId: blocker.id }
          : blocker,
      )
      writeProjectStateDatabaseDiagnosticProjection(projectRoot, {
        sourceRevision: diagnostic.sourceRevision,
        freshness: diagnostic.freshness,
        generatedAt: diagnostic.generatedAt,
        git: diagnostic.git,
        readiness: { ...diagnostic.readiness, ...(blockers ? { blockers } : {}) },
      })
      return {
        summary: `Attached typed task ownership to ${status.missingTaskIdentityCount} saved diagnostic readiness blocker${status.missingTaskIdentityCount === 1 ? '' : 's'} without changing task, proof, release, or runtime state.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: SCRIPT_ONLY_PROOF_PROJECTION_MIGRATION_ID,
    title: 'Apply script-only proof requirements to compact release state',
    introducedIn: '0.13.59',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Rebuilds compact task proof summaries and the selected-release projection so completed work without current proof remains a blocker when the release requires script proof.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === SCRIPT_ONLY_PROOF_PROJECTION_MIGRATION_ID && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied
          ? [projectStateDatabasePath(projectRoot), 'compact script-only proof projection']
          : [],
      }
    },
    async apply(projectRoot) {
      const result = await realignPromotedSummaryWithEffectiveState(projectRoot)
      return {
        summary: `Rebuilt compact proof and release state for ${result.taskCount} task${result.taskCount === 1 ? '' : 's'} from current typed evidence.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: SOURCE_CAPABILITY_SUMMARY_MIGRATION_ID,
    title: 'Add structured source authority to the shared project summary',
    introducedIn: '0.13.60',
    scope: 'project',
    safety: 'automatic',
    summary: 'Rebuilds the compact project summary with the structured source-catalog status so project surfaces do not independently interpret source documents.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = readProjectSummaryProjectionForMigration(tasksPath)
      const catalog = projection?.sourceCapabilityCatalog
      const present = Boolean(
        catalog &&
        typeof catalog === 'object' &&
        !Array.isArray(catalog) &&
        ['unavailable', 'empty', 'ready'].includes((catalog as { availability?: unknown }).availability as string),
      )
      return {
        needed: !present || projection?.version !== PROJECT_SUMMARY_PROJECTION_VERSION,
        affectedPaths: !present || projection?.version !== PROJECT_SUMMARY_PROJECTION_VERSION
          ? [projectStateDatabasePath(projectRoot)]
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const projection = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
        projectId: path.basename(projectRoot),
      })
      if (!projection?.sourceCapabilityCatalog || !projectSummaryProjectionIsCurrent(projection)) {
        throw new Error('The shared source-catalog summary could not be persisted.')
      }
      return {
        summary: 'Added structured source-catalog status to the shared project summary without changing source capabilities or work.',
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
  {
    id: PROOF_VERIFICATION_EVIDENCE_AUTHORITY_MIGRATION_ID,
    title: 'Move historical proof-path results into typed task evidence',
    introducedIn: '0.13.77',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Moves observed command and review results into typed task evidence, then returns proof paths to expectation-only state.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      const taskCount = (queue?.tasks ?? []).filter(task => {
        const parsed = TaskSchema.safeParse(task)
        return parsed.success && migrateHistoricalProofPathEvidence(parsed.data).changed
      }).length
      const pendingOutbox = readProjectStateDatabaseTaskEvidenceAuthority(projectRoot) === 'compressed'
        ? readProjectStateDatabaseTaskEvidenceOutbox(tasksPath)
            .filter(event => event.id.startsWith('proof-verification-migration:')).length
        : 0
      const needed = taskCount > 0 || pendingOutbox > 0
      return {
        needed,
        affectedPaths: needed
          ? [
              projectStateDatabasePath(projectRoot),
              `${taskCount} task${taskCount === 1 ? '' : 's'} with proof-path result state`,
              ...(pendingOutbox > 0 ? [`${pendingOutbox} pending compressed-history event${pendingOutbox === 1 ? '' : 's'}`] : []),
            ]
          : [],
      }
    },
    async apply(projectRoot) {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      const evidenceAuthority = readProjectStateDatabaseTaskEvidenceAuthority(projectRoot)
      if (evidenceAuthority === 'compressed') await flushTaskEvidenceOutboxForTasksPath(tasksPath)

      const queue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
      if (!queue) throw new Error('Historical proof evidence migration requires a readable promoted task queue')
      let taskCount = 0
      let evidenceCount = 0

      for (const queuedTask of queue.tasks) {
        const parsed = TaskSchema.safeParse(queuedTask)
        if (!parsed.success) continue
        const prepared = migrateHistoricalProofPathEvidence(parsed.data)
        if (!prepared.changed) continue
        const preparedEvidenceSignature = JSON.stringify(prepared.evidence)
        const committed = writePromotedTaskDetailMutation(tasksPath, parsed.data.id, {
          projectId: path.basename(projectRoot),
          projectRoot,
          mutate(current) {
            const currentTask = current as unknown as Pick<Task, 'id' | 'updatedAt' | 'proofPaths'>
            const currentMigration = migrateHistoricalProofPathEvidence(currentTask)
            if (!currentMigration.changed || JSON.stringify(currentMigration.evidence) !== preparedEvidenceSignature) {
              throw new Error(`Historical proof state changed while migrating ${currentTask.id}; retry the migration`)
            }
            return { ...currentTask, proofPaths: currentMigration.proofPaths }
          },
          evidence: prepared.evidence.map(event => ({
            event,
            retention: TASK_EVIDENCE_RETENTION[event.kind],
            history: evidenceAuthority === 'compressed' ? 'outbox' : 'database',
          })),
        })
        if (!committed) throw new Error(`Promoted task ${parsed.data.id} could not be committed through the atomic task boundary`)
        if (evidenceAuthority === 'compressed') await flushTaskEvidenceOutboxForTasksPath(tasksPath, parsed.data.id)
        taskCount += 1
        evidenceCount += prepared.evidence.length
      }

      return {
        summary: `Moved ${evidenceCount} historical proof result${evidenceCount === 1 ? '' : 's'} into typed evidence for ${taskCount} task${taskCount === 1 ? '' : 's'} and reset proof paths to expectations.`,
        affectedPaths: [projectStateDatabasePath(projectRoot)],
      }
    },
  },
]

const BUILT_IN_PROJECT_MIGRATION_IDEMPOTENCE_TESTS: Record<string, string> = {
  '0.11.0/execution-planning-decomposition': 'work-decomposition-migration.test.ts: migrates materialized legacy split recommendations into an execution action audit',
  '0.8.0/provider-config-globalization': 'migrations.test.ts: applies automatic migrations but leaves prompt migrations pending by default',
  '0.8.0/project-state-layout': 'migrations.test.ts: project-state layout migration can be applied repeatedly without rewriting completed work',
  '0.8.0/task-state-split': 'migrations.test.ts: task-state split migration is idempotent',
  '0.8.0/codex-agent-bridge': 'migrations.test.ts: prompt migrations stay pending unless explicitly included',
  '0.9.0/runtime-backed-project': 'manual migration; status/plan only',
  '0.9.0/runtime-command-evidence-persistence': 'migrations.test.ts: runtime command evidence migration is idempotent',
  '0.10.0/task-open-questions-to-bounded-chat': 'migrations.test.ts: task-question migration is idempotent',
  '0.10.0/task-delivery-steps': 'migrations.test.ts: normalizes verification child tasks into explicit delivery-step metadata',
  '0.10.0/task-hierarchy-links': 'migrations.test.ts: task-hierarchy migration is idempotent',
  '0.10.0/merge-policy-to-landing-strategy': 'migrations.test.ts: landing-strategy migration is idempotent',
  '0.10.0/owner-input-state-repair': 'migrations.test.ts: owner-input state repair is idempotent',
  '0.10.1/owner-input-source-trail-leadin-repair': 'migrations.test.ts: source-trail owner-input lead-in repair is idempotent',
  '0.10.0/project-state-storage-boundary': 'migrations.test.ts: storage-boundary migration is idempotent',
  '0.10.0/restore-evacuated-task-state': 'migrations.test.ts: restores stranded evacuated task state into the system-local queue and readable task files',
  '0.10.1/restore-evacuated-shaped-task-state': 'migrations.test.ts: restores richer evacuated task shape over hollow same-id imported drafts',
  '0.10.1/restore-evacuated-archive-shaped-task-state': 'migrations.test.ts: restores shaped done evidence from evacuated task archive over hollow same-id imported drafts',
  '0.12.0/project-state-database': 'migrations.test.ts: backfills the revisioned current-state database from a legacy summary',
  '0.12.1/project-state-database-rollback-journal': 'migrations.test.ts: upgrades an already-created project-state database to the read-safe journal mode',
  '0.12.2/project-summary-orientation-snapshot': 'project-summary-projection.test.ts: captures each physical orientation source once during an explicit refresh',
  '0.12.4/project-summary-orientation-source-dedupe': 'project-summary-projection.test.ts: captures each physical orientation source once during an explicit refresh',
  '0.12.5/project-summary-map-read-model': 'project-summary-projection.test.ts: keeps task prose out of the stored map projection',
  '0.12.6/project-summary-map-source-budget': 'project-summary-projection.test.ts: keeps task prose out of the stored map projection',
  '0.12.7/project-summary-map-scope-budget': 'project-summary-projection.test.ts: keeps replaced queue work current when the approved plan only names stale task ids',
  '0.12.8/project-work-scope-read-model': 'project-state-database.test.ts: pages inventory rows without loading task definitions into the summary',
  '0.12.9/project-map-payload-budget': 'project-summary-projection.test.ts: keeps task prose out of the stored map projection',
  '0.12.10/project-map-navigator-node-budget': 'project-summary-projection.test.ts: keeps task prose out of the stored map projection',
  '0.12.11/project-live-state-consolidation': 'project-state-database.test.ts: imports legacy records only through an explicit migration',
  '0.12.12/work-item-list-projection': 'project-state-database.test.ts: materializes only the Work-card facts needed by a compact list read',
  '0.12.13/database-queue-envelope': 'project-state-database.test.ts: stores normalized work rows and one compact summary atomically',
  '0.12.31/task-evidence-current-projection': 'migrations.test.ts: runs the current-evidence backfill after an earlier migration has already advanced the database schema',
  '0.10.1/repair-clipped-task-titles': 'migrations.test.ts: repairs clipped task titles even when evacuation repair already ran',
  '0.10.1/attach-recovered-current-scope-work-to-selected-release': 'migrations.test.ts: attaches recovered current-scope owner requirement work to the selected release',
  '0.12.14/task-current-overlay': 'migrations.test.ts: imports legacy current task overlays without rewriting evidence history',
  '0.12.15/task-current-overlay-reconcile': 'migrations.test.ts: imports legacy current task overlays without rewriting evidence history',
  '0.12.16/project-state-detail-store': 'migrations.test.ts: moves full task detail to a revision-matched sidecar without deleting compatibility records',
  '0.12.17/project-state-queue-revision': 'migrations.test.ts: separates queue detail freshness from mutable runtime revisions',
  '0.12.18/project-state-compact-compatibility-export': 'migrations.test.ts: compacts TASKS after the detail store is available',
  '0.12.19/memory-empty-thread-shells': 'memory-core.test.ts: removes only empty Guildhall Mastra thread shells',
  '0.12.50/memory-empty-mastra-substrate': 'memory-core.test.ts: retires only an empty Mastra database and preserves databases with data or unknown objects',
  '0.12.20/project-state-detail-compression': 'project-state-database.test.ts: compresses the full detail store without changing its parsed content',
  '0.12.21/task-overlay-authority': 'migrations.test.ts: promotes imported task overlays only after reading legacy compatibility state',
  '0.12.22/current-summary-rebuild-after-authority': 'migrations.test.ts: rebuilds a stale summary after current-state authority promotion',
  '0.12.23/project-state-single-authority': 'migrations.test.ts: removes duplicate current-state files only after the database queue is readable',
  '0.12.24/project-summary-action-model': 'migrations.test.ts: persists one canonical action model after the database becomes authoritative',
  '0.12.25/project-summary-task-status-counts': 'migrations.test.ts: persists partitioned task-status counts without changing task or release records',
  '0.13.0/project-decision-projection': 'migrations.test.ts: rebuilds an otherwise version-current summary when the shared decision projection is missing',
  '0.12.34/task-current-inbox-summary': 'migrations.test.ts: materializes current inbox facts without replaying task history',
  '0.12.35/task-essential-current-evidence': 'project-state-database.test.ts: collapses current evidence without deleting historical records',
  '0.12.36/project-summary-current-scope-authority': 'project-summary-projection.test.ts: ignores stale approved-plan identities and keeps replacement work current',
  '0.12.37/project-summary-orientation-store': 'project-state-database.test.ts: stores orientation separately from the compact summary payload',
  '0.12.38/project-state-queue-detail-database': 'project-state-database.test.ts: keeps full queue detail in SQLite when the sidecar is absent',
  '0.12.39/project-plan-source-store': 'project-state-database.test.ts: keeps accepted planning separate from the compact summary payload',
  '0.12.43/project-state-per-task-detail-index': 'project-state-database.test.ts: reads one task detail without the aggregate queue detail blob',
  '0.12.44/project-state-remove-aggregate-detail': 'migrations.test.ts: removes the duplicate aggregate detail only after the per-task index is complete',
  '0.12.45/project-current-thread-projection-store': 'migrations.test.ts: creates the bounded current Thread store without reconstructing history',
  [THREAD_HISTORY_PROJECTION_MIGRATION_ID]: 'migrations.test.ts: creates the paged Thread history store without reconstructing history',
  '0.12.41/task-evidence-history-authority': 'migrations.test.ts: imports bounded legacy task evidence into SQLite and removes files only after retention-aware verification',
  '0.12.42/task-evidence-history-compression': 'migrations.test.ts: moves SQLite history into compressed ledgers before emptying the aggregate database',
  [COMPLETION_SUMMARY_EVIDENCE_MIGRATION_ID]: 'workspace-importer.test.ts: preserves a durable completion timestamp after promoted task-definition compaction',
  [LEGACY_LIVE_STATE_CLEANUP_MIGRATION_ID]: 'migrations.test.ts: removes legacy live-state files even when the SQLite cutover was already recorded',
  [EFFECTIVE_STATE_REALIGNMENT_MIGRATION_ID]: 'migrations.test.ts: realigns promoted summary and scope from current evidence without reading compatibility files',
  [CURRENT_STATUS_PROJECTION_MIGRATION_ID]: 'migrations.test.ts: materializes the shared current task status rule into indexed rows',
  [RELEASE_MEMBERSHIP_MIGRATION_ID]: 'migrations.test.ts: normalizes release membership into one relation',
  [RELEASE_MEMBERSHIP_SNAPSHOT_MIGRATION_ID]: 'migrations.test.ts: materializes accepted plan membership once through the normalized relation',
  [COMPACT_READ_MODEL_MIGRATION_ID]: 'migrations.test.ts: backfills compact graph read models from per-task detail without making ordinary reads hydrate definitions',
  [CURRENT_PROOF_READ_MODEL_MIGRATION_ID]: 'migrations.test.ts: refreshes the bounded current-proof summary after an older compact row was already marked migrated',
  [IMPORTED_SCRIPT_PROOF_CONTRACT_MIGRATION_ID]: 'migrations.test.ts: converts imported bare test conventions into explicit proof setup in a script-only release',
  [CURRENT_PLAN_RECOVERY_BOUNDARY_MIGRATION_ID]: 'migrations.test.ts: separates recovery/process history from current task plans and reopens polluted active plans for clean shaping',
  [MALFORMED_TASK_RUNTIME_OVERLAY_MIGRATION_ID]: 'migrations.test.ts: repairs an invalid retry-window fragment and leaves a second application unchanged',
  [EFFECTIVE_CURRENT_PROOF_READ_MODEL_MIGRATION_ID]: 'migrations.test.ts: realigns indexed proof summaries from effective task state and leaves a second application unchanged',
  [MODEL_INDEPENDENT_READINESS_BOUNDARY_MIGRATION_ID]: 'migrations.test.ts: records the structured readiness authority boundary without rewriting historical prose',
  [PROOF_SETUP_TASK_KIND_MIGRATION_ID]: 'migrations.test.ts: converts legacy proof-setup rationale markers to an explicit semantic task kind',
  [PROOF_SETUP_CONTRACT_MIGRATION_ID]: 'migrations.test.ts: replaces model-shaped proof setup with one deterministic structured contract',
  [RECURSIVE_PROOF_SETUP_MIGRATION_ID]: 'migrations.test.ts: removes recursive proof-setup descendants and leaves the canonical proof boundary unchanged',
  [PROOF_COMMAND_IDENTITY_MIGRATION_ID]: 'migrations.test.ts: invalidates proof setup without task identity and leaves the second application unchanged',
  [ACCEPTANCE_COMMAND_PROOF_PATH_RECONCILIATION_MIGRATION_ID]: 'migrations.test.ts: removes stale generated proof evidence and leaves the second application unchanged',
  [PROOF_SETUP_COMPLETION_AUTHORITY_MIGRATION_ID]: 'migrations.test.ts: reopens an unproven proof setup task and leaves the second application unchanged',
  [PROOF_SETUP_HISTORY_FENCE_MIGRATION_ID]: 'migrations.test.ts: fences stale proof setup completion history before the coordinator can re-close it',
  [PROOF_SETUP_RUNTIME_RECOVERY_MIGRATION_ID]: 'migrations.test.ts: records proof recovery in the runtime authority instead of relying on compact task detail',
  [DELIVERY_READ_PROJECTION_MIGRATION_ID]: 'migrations.test.ts: creates the revisioned delivery read projection schema before the async projector populates it',
  [STORED_REQUEST_TITLE_INTEGRITY_MIGRATION_ID]: 'migrations.test.ts: repairs only provably cropped request titles and leaves ambiguous records unchanged',
  [OWNER_INPUT_CURRENT_AUTHORITY_MIGRATION_ID]: 'migrations.test.ts: promotes the normalized owner-input queue and removes its duplicate summary copy',
  [RELEASE_MEMBERSHIP_CURRENT_AUTHORITY_MIGRATION_ID]: 'migrations.test.ts: retires release membership JSON mirrors after the normalized relation cutover',
  [MODEL_INDEPENDENT_MACHINE_BOUNDARY_MIGRATION_ID]: 'migrations.test.ts: reprojects retained task evidence into structured current records without changing historical prose',
  [RELEASE_LOCAL_PROOF_SCOPE_MIGRATION_ID]: 'migrations.test.ts: reprojects release readiness without letting a shipped proof child block a later release',
  [INDEXED_SEMANTIC_KIND_MIGRATION_ID]: 'migrations.test.ts: backfills typed semantic task kinds into compact points before release-local proof projection',
  [PROOF_SETUP_EXECUTION_BLUEPRINT_MIGRATION_ID]: 'migrations.test.ts: restores cleared proof-setup execution blueprints without returning them to generic spec intake',
  [PROOF_SETUP_ACCEPTANCE_CONTRACT_MIGRATION_ID]: 'migrations.test.ts: canonicalizes proof-setup acceptance criteria without changing release membership',
  [PROOF_SETUP_PROJECTION_REFRESH_MIGRATION_ID]: 'migrations.test.ts: refreshes release readiness after proof-setup contract normalization',
  [PROOF_SETUP_EFFECTIVE_PROJECTION_MIGRATION_ID]: 'migrations.test.ts: projects proof from the canonical task snapshot and current typed evidence',
  [DIAGNOSTIC_READINESS_TASK_IDENTITY_MIGRATION_ID]: 'migrations.test.ts: attaches task identity to legacy diagnostic blockers only when the task inventory proves it',
  [SCRIPT_ONLY_PROOF_PROJECTION_MIGRATION_ID]: 'migrations.test.ts: reprojects a completed script-only task without proof as a release blocker',
  [SOURCE_CAPABILITY_SUMMARY_MIGRATION_ID]: 'project-summary-projection.test.ts: publishes source-catalog status from the canonical SQLite catalog',
  [PROOF_VERIFICATION_EVIDENCE_AUTHORITY_MIGRATION_ID]: 'migrations.test.ts: moves historical proof-path verification records into typed evidence and leaves a second application unchanged',
  [SPEC_REVIEW_GATE_MIGRATION_ID]: 'migrations.test.ts: backfills only legacy spec-review gates and remains idempotent after canonical task writes',
  [DURABLE_SPEC_HANDOFF_MIGRATION_ID]: 'migrations.test.ts: settles only an approved, structurally valid spec handoff and never auto-approves it',
  [COMPACT_SPEC_REVIEW_READINESS_MIGRATION_ID]: 'migrations.test.ts: backfills compact owner-review readiness from structured task contracts and leaves task detail unchanged',
  [DURABLE_DECISION_SNAPSHOT_MIGRATION_ID]: 'migrations.test.ts: rebuilds a missing revision-bound decision packet from normalized state',
  [INDEXED_RELEASE_SUMMARY_REPROJECTION_MIGRATION_ID]: 'migrations.test.ts: reprojects stale current release counts from normalized indexed membership',
  [NAMED_RELEASE_MEMBER_COUNT_MIGRATION_ID]: 'migrations.test.ts: aligns named release counts to selected membership when child execution rows are present',
  [INCLUDED_RELEASE_DISPOSITION_COUNT_MIGRATION_ID]: 'migrations.test.ts: reprojects stale current release counts from normalized indexed membership without counting deferred release rows',
  [CANONICAL_RELEASE_MEMBERSHIP_SUMMARY_MIGRATION_ID]: 'migrations.test.ts: reprojects stale current release counts from normalized indexed membership through the canonical membership reader',
  [SELECTED_RELEASE_NODE_MEMBERSHIP_SUMMARY_MIGRATION_ID]: 'migrations.test.ts: reprojects stale current release counts from normalized indexed membership through the selected release membership fallback',
  '0.11.0/project-summary-projection': 'migrations.test.ts: project summary backfill is idempotent and preserves task history',
  '0.11.1/project-summary-projection-v2': 'migrations.test.ts: project summary shape refresh is idempotent and preserves task history',
  '0.11.2/project-summary-projection-setup-state': 'migrations.test.ts: project summary setup-state refresh is idempotent and preserves task history',
  '0.11.3/project-summary-approved-plan': 'migrations.test.ts: approved planning and selected scope refresh is idempotent and preserves task history',
  '0.11.4/project-summary-approved-scope-selection': 'migrations.test.ts: approved planning and selected scope refresh is idempotent and preserves task history',
  '0.11.5/project-summary-release-membership-authority': 'migrations.test.ts: queue-owned release membership refresh is idempotent and preserves task history',
}

const REPO_LOCAL_STATE_MIGRATIONS = new Set([
  '0.8.0/project-state-layout',
  '0.8.0/task-state-split',
  '0.10.0/task-hierarchy-links',
  '0.10.0/task-open-questions-to-bounded-chat',
  '0.10.0/owner-input-state-repair',
  '0.10.0/merge-policy-to-landing-strategy',
  '0.8.0/codex-agent-bridge',
])

export function validateBuiltInProjectMigrationDefinitions(): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const ids = new Set<string>()
  for (const migration of BUILT_IN_PROJECT_MIGRATIONS) {
    if (ids.has(migration.id)) errors.push(`Duplicate migration id: ${migration.id}`)
    ids.add(migration.id)
    if (!/^\d+\.\d+\.\d+\/[a-z0-9-]+$/.test(migration.id)) {
      errors.push(`Migration id must be version-prefixed and stable: ${migration.id}`)
    }
    if (!migration.title.trim()) errors.push(`Migration ${migration.id} is missing a title.`)
    if (!migration.summary.trim()) errors.push(`Migration ${migration.id} is missing owner-facing summary text.`)
    if (migration.requirement === 'required' && !migration.summary.match(/move|migrat|convert|repair|require|runtime|state|link/i)) {
      errors.push(`Required migration ${migration.id} summary does not explain the owner-facing state change.`)
    }
    if ((migration.safety === 'automatic' || migration.safety === 'prompt') && !BUILT_IN_PROJECT_MIGRATION_IDEMPOTENCE_TESTS[migration.id]) {
      errors.push(`Migration ${migration.id} is missing registered idempotence-test evidence.`)
    }
    if (migration.safety === 'manual' && !migration.summary.match(/guide|manual|health|settings|owner|runtime/i)) {
      errors.push(`Manual migration ${migration.id} summary must route the owner to manual steps.`)
    }
  }
  return { valid: errors.length === 0, errors }
}

function toStatusItem(
  migration: ProjectMigrationDefinition,
  affectedPaths: string[],
  applied?: MigrationLedgerRecord,
): ProjectMigrationStatusItem {
  return {
    id: migration.id,
    title: migration.title,
    introducedIn: migration.introducedIn,
    scope: migration.scope,
    safety: migration.safety,
    ...(migration.requirement ? { requirement: migration.requirement } : {}),
    summary: migration.summary,
    affectedPaths,
    ...(applied ? { applied } : {}),
  }
}

export async function getProjectMigrationStatus(input: { projectRoot: string; only?: string[] }): Promise<ProjectMigrationStatus> {
  const ledger = await readProjectMigrationLedger(input.projectRoot)
  const appliedById = new Map(ledger.records.filter(r => r.status === 'applied').map(r => [r.id, r]))
  const repoLocalStateBoundaryApplied = repoStateMode(input.projectRoot) === 'off' &&
    appliedById.has('0.10.0/project-state-storage-boundary')
  const pending: ProjectMigrationStatusItem[] = []
  const applied: ProjectMigrationStatusItem[] = []
  const blocked: ProjectMigrationStatusItem[] = []

  for (const migration of BUILT_IN_PROJECT_MIGRATIONS) {
    if (input.only && input.only.length > 0 && !input.only.includes(migration.id)) continue
    if (repoLocalStateBoundaryApplied && REPO_LOCAL_STATE_MIGRATIONS.has(migration.id)) continue
    const appliedRecord = appliedById.get(migration.id)
    if (appliedRecord && !migration.recheckAfterApply) {
      applied.push(toStatusItem(migration, appliedRecord.affectedPaths ?? [], appliedRecord))
      continue
    }
    const detected = await migration.detect(input.projectRoot)
    if (!detected.needed) {
      if (appliedRecord) {
        applied.push(toStatusItem(migration, detected.affectedPaths ?? appliedRecord.affectedPaths ?? [], appliedRecord))
      }
      continue
    }
    const item = toStatusItem(migration, detected.affectedPaths ?? [], appliedRecord)
    if (migration.requirement === 'required' || migration.safety === 'required') blocked.push(item)
    else pending.push(item)
  }

  return { projectRoot: input.projectRoot, pending, applied, blocked }
}

function shouldApplyMigration(
  migration: ProjectMigrationDefinition,
  input: { includePrompt?: boolean; includeRequired?: boolean; only?: string[] },
): boolean {
  if (migration.safety === 'manual') return false
  if (input.only?.includes(migration.id)) return true
  if (input.only && input.only.length > 0) return false
  if (migration.requirement === 'required' || migration.safety === 'required') return input.includeRequired === true
  if (migration.safety === 'automatic') return true
  return input.includePrompt === true && migration.safety === 'prompt'
}

async function appendLedgerRecord(projectRoot: string, record: MigrationLedgerRecord): Promise<void> {
  const ledger = await readProjectMigrationLedger(projectRoot)
  const records = ledger.records.filter(existing => existing.id !== record.id || existing.status !== record.status)
  records.push(record)
  await writeProjectMigrationLedger(projectRoot, { version: 1, records })
}

export async function applyProjectMigrations(input: {
  projectRoot: string
  includePrompt?: boolean
  includeRequired?: boolean
  only?: string[]
  appVersion?: string
  now?: () => Date
}): Promise<ApplyProjectMigrationsResult> {
  const ledger = await readProjectMigrationLedger(input.projectRoot)
  const applied: ProjectMigrationStatusItem[] = []
  const skipped: ProjectMigrationStatusItem[] = []
  const failed: Array<ProjectMigrationStatusItem & { error: string }> = []
  const now = input.now ?? (() => new Date())

  for (const migration of BUILT_IN_PROJECT_MIGRATIONS) {
    if (input.only && input.only.length > 0 && !input.only.includes(migration.id)) continue
    const appliedRecord = ledger.records.find(record => record.id === migration.id && record.status === 'applied')
    const failedRecord = ledger.records.find(record => record.id === migration.id && record.status === 'failed')
    if (appliedRecord && !migration.recheckAfterApply) continue
    const detected = await migration.detect(input.projectRoot)
    if (!detected.needed) {
      // A failed migration may have completed its durable writes before a
      // later invariant check rejected the aggregate write. If detection now
      // proves that no work remains, close that historical attempt as applied
      // while retaining the failed record for auditability.
      if (failedRecord) {
        const resolvedItem = toStatusItem(migration, detected.affectedPaths ?? failedRecord.affectedPaths ?? [], failedRecord)
        const resolvedSummary = `Previously failed migration verified complete; no remaining work for ${migration.title.toLowerCase()} was detected.`
        applied.push(resolvedItem)
        await appendLedgerRecord(input.projectRoot, {
          id: migration.id,
          introducedIn: migration.introducedIn,
          scope: migration.scope,
          safety: migration.safety,
          status: 'applied',
          appliedAt: now().toISOString(),
          appliedByVersion: input.appVersion ?? migration.introducedIn,
          summary: resolvedSummary,
          affectedPaths: detected.affectedPaths ?? failedRecord.affectedPaths ?? [],
        })
      }
      continue
    }
    const item = toStatusItem(migration, detected.affectedPaths ?? [], appliedRecord)
    if (!shouldApplyMigration(migration, input)) {
      skipped.push(item)
      continue
    }
    try {
      const result = await migration.apply(input.projectRoot)
      const appliedItem = toStatusItem(migration, result.affectedPaths ?? item.affectedPaths)
      applied.push(appliedItem)
      await appendLedgerRecord(input.projectRoot, {
        id: migration.id,
        introducedIn: migration.introducedIn,
        scope: migration.scope,
        safety: migration.safety,
        status: 'applied',
        appliedAt: now().toISOString(),
        appliedByVersion: input.appVersion ?? migration.introducedIn,
        summary: result.summary,
        affectedPaths: result.affectedPaths ?? item.affectedPaths,
      })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      failed.push({ ...item, error })
      await appendLedgerRecord(input.projectRoot, {
        id: migration.id,
        introducedIn: migration.introducedIn,
        scope: migration.scope,
        safety: migration.safety,
        status: 'failed',
        appliedAt: now().toISOString(),
        appliedByVersion: input.appVersion ?? migration.introducedIn,
        summary: migration.summary,
        error,
        affectedPaths: item.affectedPaths,
      })
    }
  }

  return { applied, skipped, failed }
}
