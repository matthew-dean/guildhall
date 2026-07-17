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
  readProjectStateDatabaseMetadata,
  readProjectStateDatabaseAuthority,
  readProjectStateDatabaseQueueDefinitionForMigration,
  readProjectStateDatabaseQueueWithRevision,
  readProjectStateDatabaseInventory,
  readProjectStateDatabaseSummary,
  migrateProjectStateDatabaseQueueDetail,
  migrateProjectStateDatabaseWorkItemDetails,
  migrateProjectStateDatabaseReleaseMembership,
  migrateProjectStateDatabaseCompactReadModels,
  clearProjectStateDatabaseQueueDetail,
  ensureProjectStateDatabaseCurrentThreadStore,
  ensureProjectStateDatabaseThreadHistoryStore,
  writeProjectStateDatabaseSummarySnapshot,
  updateProjectStateDatabaseSummary,
  promoteProjectStateDatabaseAuthority,
  compactProjectStateDatabaseEvidence,
  vacuumProjectStateDatabase,
  readProjectStateDatabaseTaskEvidenceAuthority,
} from '@guildhall/sessions'
import type { ProjectStateDatabaseScopeRow } from '@guildhall/sessions'
import { installAgentBridgeInstructions } from './agent-bridge-install.js'
import { migrateLegacyMemoryToLocalHistory } from './memory-migration.js'
import { compactProjectState } from './project-state-compaction.js'
import { migrateTaskQuestionsToBoundedChat } from './task-question-migration.js'
import { migrateTaskHierarchyState } from './task-hierarchy-migration.js'
import { migrateTaskDeliveryStepState } from './task-delivery-step-migration.js'
import { migrateTaskState } from './task-state-migration.js'
import {
  backfillTaskEvidenceCurrent,
  backfillTaskStateDatabaseOverlays,
  migrateDatabaseTaskEvidenceHistoryToCompressed,
  migrateLegacyTaskEvidenceHistoryToDatabase,
  runtimeStatePath,
  taskWorkspaceStatePath,
} from '../sessions/task-state-store.js'
import { repairOwnerInputState } from './owner-input-state-repair.js'
import { recordGuildhallRuntimeWrite } from './runtime-compatibility.js'
import { readProjectRuntimeState } from './project-runtime-store.js'
import {
  hasLegacyRuntimeCommandEvidence,
  migrateLegacyRuntimeCommandEvidenceToPersistence,
} from './project-runtime-command.js'
import { finalizeThinProjectStateManifest } from './thin-project-state-manifest.js'
import { restoreEvacuatedTaskState } from './evacuated-task-state-restore.js'
import { migrateWorkDecompositionState } from './work-decomposition-migration.js'
import { buildProjectScopeProjection, deriveReleaseContainersFromTaskMembership } from './project-scope-projection.js'
import { buildEffectiveTasks } from './effective-task.js'
import {
  backfillProjectSummaryProjection,
  buildProjectSummaryProjectionFromIndexedState,
  PROJECT_SUMMARY_PROJECTION_VERSION,
  projectSummaryProjectionNeedsBackfill,
  projectSummaryProjectionPath,
  readProjectSummaryProjectionForMigration,
  writeProjectSummaryProjectionFromIndexedState,
} from './project-summary-projection.js'
import { writeProjectTaskQueueWithSummary } from './project-state-boundary.js'
import { deliveryReadProjectionSchemaPresent, ensureDeliveryReadProjectionSchema } from './delivery-read-projection.js'
import { effectiveTaskTitle } from '../shared/task-display-label.js'
import type { Task } from '@guildhall/core'
import {
  inspectEmptyMastraDatabase,
  inspectEmptyMastraThreadShells,
  removeEmptyMastraThreadShells,
  retireEmptyMastraDatabase,
} from '@guildhall/memory-core'

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
const DELIVERY_READ_PROJECTION_MIGRATION_ID = '0.13.3/delivery-read-projection'
const THREAD_HISTORY_PROJECTION_MIGRATION_ID = '0.12.47/project-thread-history-read-model'

interface FinalProjectStateMigrationResult {
  removedPaths: string[]
  queueTaskCount: number
  summaryFreshness: string
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
  tasks: Task[],
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
  const taskOverrides = inventory.tasks.map(task => {
    const effective = effectiveById.get(task.id)
    if (!effective) throw new Error(`The promoted SQLite task index is missing effective task ${task.id}.`)
    return {
      ...task,
      title: effective.title,
      status: typeof effective.status === 'string' ? effective.status : task.status,
      updatedAt: typeof effective.updatedAt === 'string' ? effective.updatedAt : task.updatedAt,
      completedAt: typeof effective.completedAt === 'string' ? effective.completedAt : task.completedAt,
    }
  })
  const scopeRows = scopeRowsForEffectiveTasks(queueRead.definition, effectiveTasks)
  const projection = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
    projectId: path.basename(projectRoot),
    generatedAt: new Date().toISOString(),
    sourceQueueLastUpdated: queueRead.definition.lastUpdated ?? null,
    taskOverrides,
    scopeRowOverrides: scopeRows,
    expectedQueueRevision: queueRead.revision,
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
      return {
        summary: projection.freshness === 'error'
          ? 'Created an explicit error summary and state database because the existing task queue could not be parsed; task history was not rewritten.'
          : `Built the normalized project-state database for ${projection.counts.total} task${projection.counts.total === 1 ? '' : 's'}.`,
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
        needed: projection?.version !== PROJECT_SUMMARY_PROJECTION_VERSION || !projection?.actionModel,
        affectedPaths: projection?.version !== PROJECT_SUMMARY_PROJECTION_VERSION || !projection?.actionModel
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
    summary: 'Creates the bounded historical Thread projection tables; the next asynchronous refresh populates them without rebuilding history in a GET.',
    async detect(projectRoot) {
      const metadata = readProjectStateDatabaseMetadata(projectRoot)
      if (metadata === null) return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === THREAD_HISTORY_PROJECTION_MIGRATION_ID && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied ? [projectStateDatabasePath(projectRoot)] : [],
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
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === RELEASE_MEMBERSHIP_MIGRATION_ID && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied ? [projectStateDatabasePath(projectRoot), 'normalized release membership relation'] : [],
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
    id: COMPACT_READ_MODEL_MIGRATION_ID,
    title: 'Materialize compact task read models',
    introducedIn: '0.13.2',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Backfills graph and list-facing task summaries from the authoritative per-task detail index so ordinary reads never open rich task definitions to discover compact facts.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === COMPACT_READ_MODEL_MIGRATION_ID && record.status === 'applied')
      return {
        needed: !applied,
        affectedPaths: !applied ? [projectStateDatabasePath(projectRoot), 'indexed task read models'] : [],
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
    id: DELIVERY_READ_PROJECTION_MIGRATION_ID,
    title: 'Create the delivery read projection',
    introducedIn: '0.13.3',
    scope: 'project',
    safety: 'automatic',
    requirement: 'required',
    summary: 'Creates the revisioned delivery read-model tables so ordinary queue and relationship reads have one saved authority instead of rebuilding delivery state in a GET.',
    async detect(projectRoot) {
      if (readProjectStateDatabaseAuthority(projectRoot) !== 'database') return { needed: false, affectedPaths: [] }
      const ledger = await readProjectMigrationLedger(projectRoot)
      const applied = ledger.records.some(record => record.id === DELIVERY_READ_PROJECTION_MIGRATION_ID && record.status === 'applied')
      const present = deliveryReadProjectionSchemaPresent(projectRoot)
      return {
        // The projector may have created the tables before the migration
        // runner observed them. The ledger still needs to record the schema
        // transition; apply is intentionally idempotent in that case.
        needed: !applied,
        affectedPaths: !applied
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
  [LEGACY_LIVE_STATE_CLEANUP_MIGRATION_ID]: 'migrations.test.ts: removes legacy live-state files even when the SQLite cutover was already recorded',
  [EFFECTIVE_STATE_REALIGNMENT_MIGRATION_ID]: 'migrations.test.ts: realigns promoted summary and scope from current evidence without reading compatibility files',
  [CURRENT_STATUS_PROJECTION_MIGRATION_ID]: 'migrations.test.ts: materializes the shared current task status rule into indexed rows',
  [RELEASE_MEMBERSHIP_MIGRATION_ID]: 'migrations.test.ts: normalizes release membership into one relation',
  [COMPACT_READ_MODEL_MIGRATION_ID]: 'migrations.test.ts: backfills compact graph read models from per-task detail without making ordinary reads hydrate definitions',
  [DELIVERY_READ_PROJECTION_MIGRATION_ID]: 'migrations.test.ts: creates the revisioned delivery read projection schema before the async projector populates it',
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
  input: { includePrompt?: boolean; only?: string[] },
): boolean {
  if (migration.safety === 'manual') return false
  if (input.only?.includes(migration.id)) return true
  if (input.only && input.only.length > 0) return false
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
    if (appliedRecord && !migration.recheckAfterApply) continue
    const detected = await migration.detect(input.projectRoot)
    if (!detected.needed) continue
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
