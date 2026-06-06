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
import { getProjectLocalHistoryDir, getProjectStateDir } from '@guildhall/sessions'
import { installAgentBridgeInstructions } from './agent-bridge-install.js'
import { migrateLegacyMemoryToLocalHistory } from './memory-migration.js'
import { compactProjectState } from './project-state-compaction.js'
import { migrateTaskQuestionsToBoundedChat } from './task-question-migration.js'
import { migrateTaskHierarchyState } from './task-hierarchy-migration.js'
import { migrateTaskState } from './task-state-migration.js'
import { repairOwnerInputState } from './owner-input-state-repair.js'
import { recordGuildhallRuntimeWrite } from './runtime-compatibility.js'
import { readProjectRuntimeState } from './project-runtime-store.js'
import {
  hasLegacyRuntimeCommandEvidence,
  migrateLegacyRuntimeCommandEvidenceToPersistence,
} from './project-runtime-command.js'
import { finalizeThinProjectStateManifest } from './thin-project-state-manifest.js'

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
        affectedPaths: ['.guildhall/TASKS.json', ...(result.backupPath ? [result.backupPath] : [])],
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
        affectedPaths: compaction.evacuatedProjectStatePaths.map(entry => `.guildhall/${entry}`),
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
]

const BUILT_IN_PROJECT_MIGRATION_IDEMPOTENCE_TESTS: Record<string, string> = {
  '0.8.0/provider-config-globalization': 'migrations.test.ts: applies automatic migrations but leaves prompt migrations pending by default',
  '0.8.0/project-state-layout': 'migrations.test.ts: project-state layout migration can be applied repeatedly without rewriting completed work',
  '0.8.0/task-state-split': 'migrations.test.ts: task-state split migration is idempotent',
  '0.8.0/codex-agent-bridge': 'migrations.test.ts: prompt migrations stay pending unless explicitly included',
  '0.9.0/runtime-backed-project': 'manual migration; status/plan only',
  '0.9.0/runtime-command-evidence-persistence': 'migrations.test.ts: runtime command evidence migration is idempotent',
  '0.10.0/task-open-questions-to-bounded-chat': 'migrations.test.ts: task-question migration is idempotent',
  '0.10.0/task-hierarchy-links': 'migrations.test.ts: task-hierarchy migration is idempotent',
  '0.10.0/merge-policy-to-landing-strategy': 'migrations.test.ts: landing-strategy migration is idempotent',
  '0.10.0/owner-input-state-repair': 'migrations.test.ts: owner-input state repair is idempotent',
  '0.10.0/project-state-storage-boundary': 'migrations.test.ts: storage-boundary migration is idempotent',
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
    if (appliedRecord) {
      applied.push(toStatusItem(migration, appliedRecord.affectedPaths ?? [], appliedRecord))
      continue
    }
    const detected = await migration.detect(input.projectRoot)
    if (!detected.needed) continue
    const item = toStatusItem(migration, detected.affectedPaths ?? [])
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
  const appliedById = new Set(ledger.records.filter(r => r.status === 'applied').map(r => r.id))
  const applied: ProjectMigrationStatusItem[] = []
  const skipped: ProjectMigrationStatusItem[] = []
  const failed: Array<ProjectMigrationStatusItem & { error: string }> = []
  const now = input.now ?? (() => new Date())

  for (const migration of BUILT_IN_PROJECT_MIGRATIONS) {
    if (input.only && input.only.length > 0 && !input.only.includes(migration.id)) continue
    if (appliedById.has(migration.id)) continue
    const detected = await migration.detect(input.projectRoot)
    if (!detected.needed) continue
    const item = toStatusItem(migration, detected.affectedPaths ?? [])
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
