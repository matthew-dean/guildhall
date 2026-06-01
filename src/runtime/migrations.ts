import fs from 'node:fs/promises'
import path from 'node:path'
import {
  migrateProjectProvidersToGlobal,
  readProjectConfig,
  readWorkspaceConfig,
  updateProjectConfig,
} from '@guildhall/config'
import { getProjectStateDir } from '@guildhall/sessions'
import { installAgentBridgeInstructions } from './agent-bridge-install.js'
import { migrateLegacyMemoryToLocalHistory } from './memory-migration.js'
import { migrateTaskQuestionsToBoundedChat } from './task-question-migration.js'
import { migrateTaskHierarchyState } from './task-hierarchy-migration.js'
import { migrateTaskState } from './task-state-migration.js'
import { recordGuildhallRuntimeWrite } from './runtime-compatibility.js'
import { readProjectRuntimeState } from './project-runtime-store.js'
import {
  hasLegacyRuntimeCommandEvidence,
  migrateLegacyRuntimeCommandEvidenceToPersistence,
} from './project-runtime-command.js'

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
  return path.join(getProjectStateDir(projectRoot), 'migrations.json')
}

async function writeFileIfMissing(file: string, content: string): Promise<boolean> {
  try {
    await fs.writeFile(file, content, { flag: 'wx', encoding: 'utf8' })
    return true
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'EEXIST') return false
    throw err
  }
}

async function seedMissingProjectStateFiles(projectRoot: string): Promise<string[]> {
  const stateDir = getProjectStateDir(projectRoot)
  await fs.mkdir(stateDir, { recursive: true })
  let projectName = 'Project'
  try {
    projectName = readWorkspaceConfig(projectRoot).name || projectName
  } catch {
    // A missing or invalid config should not prevent the layout migration from
    // creating the files later runtime paths require.
  }

  const seeded: string[] = []
  const files: Record<string, string> = {
    'TASKS.json': '[]\n',
    'MEMORY.md': `# ${projectName} Memory\n\n_Updated by GuildHall agents._\n`,
    'DECISIONS.md': `# ${projectName} Decisions\n\n_Architecture decisions recorded by GuildHall agents._\n`,
    'PROGRESS.md': `# ${projectName} Progress\n\n_Progress log maintained by GuildHall agents._\n`,
  }

  for (const [filename, content] of Object.entries(files)) {
    if (await writeFileIfMissing(path.join(stateDir, filename), content)) {
      seeded.push(`.guildhall/${filename}`)
    }
  }
  return seeded
}

export async function readProjectMigrationLedger(projectRoot: string): Promise<ProjectMigrationLedger> {
  try {
    const raw = await fs.readFile(ledgerPath(projectRoot), 'utf8')
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
  await fs.writeFile(file, `${JSON.stringify({ version: 1, records: ledger.records }, null, 2)}\n`, 'utf8')
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
      const seeded = await seedMissingProjectStateFiles(projectRoot)
      return {
        summary: `Moved ${result.copied} legacy memory file${result.copied === 1 ? '' : 's'} into split project state.`,
        affectedPaths: ['memory/', '.guildhall/', ...seeded, ...result.gitignoreRoots.map(root => path.relative(projectRoot, root) || '.')],
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
    id: '0.8.0/codex-agent-bridge',
    title: 'Install Codex Guildhall MCP bridge instructions',
    introducedIn: '0.8.0',
    scope: 'project',
    safety: 'prompt',
    summary: 'Adds or refreshes the managed Guildhall MCP bridge section in AGENTS.md.',
    async detect(projectRoot) {
      try {
        const raw = await fs.readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')
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

export async function getProjectMigrationStatus(input: { projectRoot: string }): Promise<ProjectMigrationStatus> {
  const ledger = await readProjectMigrationLedger(input.projectRoot)
  const appliedById = new Map(ledger.records.filter(r => r.status === 'applied').map(r => [r.id, r]))
  const pending: ProjectMigrationStatusItem[] = []
  const applied: ProjectMigrationStatusItem[] = []
  const blocked: ProjectMigrationStatusItem[] = []

  for (const migration of BUILT_IN_PROJECT_MIGRATIONS) {
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
