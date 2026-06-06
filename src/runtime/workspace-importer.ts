import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import fs from 'node:fs/promises'
import path from 'node:path'
import { load as yamlLoad } from 'js-yaml'
import { TaskQueue, type Task, type TaskPriority } from '@guildhall/core'
import { getProjectLocalHistoryDir } from '@guildhall/sessions'
import { appendExploringTranscript } from '@guildhall/tools'
import { loadLeverSettings, defaultAgentSettingsPath } from '@guildhall/levers'
import {
  detectWorkspaceSignals,
  formWorkspaceHypothesis,
  type WorkspaceImportDraft,
  type WorkspaceInventory,
} from './workspace-import/index.js'
import { normalizeImportedDraftTask } from './import-drafts.js'
import { resolveTaskProjectPath } from './task-project-path.js'
import {
  planEvidenceWorkGraph,
  type EvidenceTask,
  type EvidenceSource,
} from './evidence-work-graph-intake.js'

// ---------------------------------------------------------------------------
// FR-34: reserved workspace-importer task.
//
// When a workspace is non-empty (existing README/roadmap/TODOs/history) but
// has no TASKS.json entries yet, the importer task gets seeded alongside
// meta-intake. The agent reads the pre-computed inventory + draft from its
// transcript, talks with the user to refine, then emits YAML fences the
// approver merges into TASKS.json + PROGRESS.md.
//
// The deterministic draft (built from `detectWorkspaceSignals` +
// `formWorkspaceHypothesis`) is the agent's *starting point* — not the
// final answer. Humans care about which of the detected TODOs are real, and
// which README bullets are active vs. aspirational; the agent's job is to
// ask about the ambiguous ones before the import lands.
// ---------------------------------------------------------------------------

export const WORKSPACE_IMPORT_TASK_ID = 'task-workspace-import'
export const WORKSPACE_IMPORT_DOMAIN = '_workspace_import'

function tasksPathFor(memoryDir: string): string {
  if (path.basename(memoryDir) === '.guildhall') {
    return path.join(getProjectLocalHistoryDir(path.dirname(memoryDir)), 'project-state', 'TASKS.json')
  }
  return path.join(memoryDir, 'TASKS.json')
}

async function readQueue(memoryDir: string): Promise<TaskQueue> {
  const tasksPath = tasksPathFor(memoryDir)
  const raw = await readManagedTextFile(tasksPath, 'utf-8').catch((err: unknown) => {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: unknown }).code === 'ENOENT'
    ) {
      return null
    }
    throw err
  })
  if (raw === null) {
    return TaskQueue.parse({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [],
    })
  }
  const parsed = JSON.parse(raw)
  const queue = Array.isArray(parsed)
    ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
    : TaskQueue.parse(parsed)
  for (const task of queue.tasks) normalizeImportedDraftTask(task)
  return queue
}

async function writeQueue(memoryDir: string, queue: TaskQueue): Promise<void> {
  await fs.mkdir(memoryDir, { recursive: true })
  await writeManagedTextFile(tasksPathFor(memoryDir), JSON.stringify(queue, null, 2), 'utf-8')
}

export const WORKSPACE_IMPORT_SEED_PREAMBLE = `You are the Workspace Importer Agent.

This workspace already has artifacts — README goals, roadmaps, TODOs,
git history, agent-conventions — but no TASKS.json entries yet. A
deterministic detector has already scanned for signals and a
hypothesis former has folded them into a DRAFT inventory of goals,
tasks, milestones, and context notes. The draft is attached below.

Your job is NOT to start from scratch. Your job is to:

1. READ the draft inventory.
2. TALK with the user about the ambiguous items. Examples of ambiguous:
   - TODO/FIXME comments that might be stale.
   - Roadmap bullets that sound aspirational rather than actionable.
   - Multiple sources disagreeing about the same goal.
3. REFINE:
   - Split compound draft tasks into smaller ones.
   - Merge near-duplicates the detector missed.
   - Correct priorities and the domain for each task.
   - Drop noise (junk TODOs, exploratory roadmap notes).
4. EMIT a set of YAML codefences (format below).

When the user approves the draft via the dashboard, the runtime merges
the fences into TASKS.json + PROGRESS.md and marks this task done.
`

export const WORKSPACE_IMPORT_SEED_FORMAT = `

Output format
=============

Emit these three YAML codefences in the task spec:

\`\`\`yaml
goals:
  - id: <slug>
    title: <short>
    rationale: <why this is a goal>
\`\`\`

\`\`\`yaml
tasks:
  - id: <slug — will be renumbered on merge>
    title: <short>
    description: <1–3 sentences>
    domain: <coordinator domain this belongs to>
    priority: critical | high | normal | low
    references:
      - <file path or commit sha backing this task>
\`\`\`

\`\`\`yaml
milestones:
  - title: <already-done work>
    evidence: <commit sha, PR, or file reference>
\`\`\`

The approver records the goals on the project brief, inserts the tasks
into TASKS.json in \`proposed\` status (or \`ready\` if the confidence
signal was high and the user pre-approved), and appends each milestone
to PROGRESS.md so the backlog starts with a true progress baseline.
`

function formatDraftForTranscript(
  inventory: WorkspaceInventory,
  draft: WorkspaceImportDraft,
): string {
  const lines: string[] = []
  lines.push('Detected inventory summary')
  lines.push('==========================')
  lines.push(
    `Sources run: ${inventory.ran.join(', ') || '(none)'}   signals: ${inventory.signals.length}   deduped to: ${draft.stats.drafted}`,
  )
  if (inventory.failed.length > 0) {
    lines.push(
      `Failed sources: ${inventory.failed.map((f) => `${f.id} (${f.error})`).join('; ')}`,
    )
  }
  lines.push('')

  if (draft.goals.length > 0) {
    lines.push('Draft goals')
    lines.push('-----------')
    for (const g of draft.goals) {
      lines.push(`- [${g.confidence}] ${g.title}`)
      lines.push(`    rationale: ${g.rationale}`)
      lines.push(`    source: ${g.source}${g.references ? ` (${g.references.join(', ')})` : ''}`)
    }
    lines.push('')
  }

  if (draft.tasks.length > 0) {
    lines.push('Draft tasks')
    lines.push('-----------')
    for (const t of draft.tasks) {
      lines.push(`- [${t.confidence}/${t.priority}] ${t.title}  (suggestedId: ${t.suggestedId})`)
      lines.push(`    ${t.description}`)
      lines.push(`    source: ${t.source}${t.references ? ` (${t.references.join(', ')})` : ''}`)
    }
    lines.push('')
  }

  if (draft.milestones.length > 0) {
    lines.push('Draft milestones (already-done work)')
    lines.push('------------------------------------')
    for (const m of draft.milestones) {
      lines.push(`- ${m.title}`)
      lines.push(`    evidence: ${m.evidence}`)
      lines.push(`    source: ${m.source}${m.references ? ` (${m.references.join(', ')})` : ''}`)
    }
    lines.push('')
  }

  if (draft.context.length > 0) {
    lines.push('Project context notes')
    lines.push('---------------------')
    for (const c of draft.context) {
      lines.push(`- ${c.label}`)
      lines.push(`    source: ${c.source}${c.references ? ` (${c.references.join(', ')})` : ''}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export interface CreateWorkspaceImportInput {
  memoryDir: string
  projectPath: string
  /** Injected for tests; falls back to real detector when omitted. */
  inventory?: WorkspaceInventory
  /**
   * Optional pre-computed draft. When omitted, derived from `inventory` (or
   * the default detector output) via `formWorkspaceHypothesis`.
   */
  draft?: WorkspaceImportDraft
  /** Optional override for the seed message (tests). */
  seedMessage?: string
}

export interface CreateWorkspaceImportResult {
  taskId: string
  transcriptPath: string
  alreadyExists: boolean
  inventory: WorkspaceInventory
  draft: WorkspaceImportDraft
}

async function writeWorkspaceImportTranscript(
  memoryDir: string,
  inventory: WorkspaceInventory,
  draft: WorkspaceImportDraft,
  seedMessage?: string,
): Promise<string> {
  const transcriptPath = path.join(
    memoryDir,
    'exploring',
    `${WORKSPACE_IMPORT_TASK_ID}.md`,
  )
  await fs.mkdir(path.dirname(transcriptPath), { recursive: true })
  const seed =
    seedMessage ??
    [
      WORKSPACE_IMPORT_SEED_PREAMBLE,
      formatDraftForTranscript(inventory, draft),
      WORKSPACE_IMPORT_SEED_FORMAT,
    ].join('\n')
  await writeManagedTextFile(transcriptPath, `${seed}\n`, 'utf-8')
  return transcriptPath
}

/**
 * Seed the workspace with the reserved importer task. Idempotent — if the
 * task already exists, returns `alreadyExists: true` without re-running
 * detection.
 */
export async function createWorkspaceImportTask(
  input: CreateWorkspaceImportInput,
): Promise<CreateWorkspaceImportResult> {
  const queue = await readQueue(input.memoryDir)
  const existing = queue.tasks.find((t) => t.id === WORKSPACE_IMPORT_TASK_ID)

  const transcriptPath = path.join(
    input.memoryDir,
    'exploring',
    `${WORKSPACE_IMPORT_TASK_ID}.md`,
  )

  // Compute (or reuse) inventory + draft even when the task exists, so
  // callers can preview without creating a new task.
  const inventory =
    input.inventory ??
    (await detectWorkspaceSignals({ projectPath: input.projectPath }))
  const draft = input.draft ?? formWorkspaceHypothesis(inventory)

  if (existing) {
    return {
      taskId: WORKSPACE_IMPORT_TASK_ID,
      transcriptPath,
      alreadyExists: true,
      inventory,
      draft,
    }
  }

  const now = new Date().toISOString()
  const task: Task = {
    id: WORKSPACE_IMPORT_TASK_ID,
    title: 'Review existing project work',
    description:
      'Refine the detector-produced draft of goals, tasks, and milestones with the user, then emit YAML fences for the merge step.',
    domain: WORKSPACE_IMPORT_DOMAIN,
    projectPath: input.projectPath,
    status: 'exploring',
    priority: 'high',
    dependsOn: [],
    outOfScope: [],
    acceptanceCriteria: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'system',
    createdAt: now,
    updatedAt: now,
  }

  queue.tasks.unshift(task)
  queue.lastUpdated = now
  await writeQueue(input.memoryDir, queue)

  const seed =
    input.seedMessage ??
    [
      WORKSPACE_IMPORT_SEED_PREAMBLE,
      formatDraftForTranscript(inventory, draft),
      WORKSPACE_IMPORT_SEED_FORMAT,
    ].join('\n')

  const appendResult = await appendExploringTranscript({
    memoryDir: input.memoryDir,
    taskId: WORKSPACE_IMPORT_TASK_ID,
    role: 'system',
    content: seed,
  })
  if (!appendResult.success || !appendResult.path) {
    throw new Error(
      `Failed to seed workspace-import transcript: ${appendResult.error ?? 'unknown'}`,
    )
  }

  return {
    taskId: WORKSPACE_IMPORT_TASK_ID,
    transcriptPath: appendResult.path,
    alreadyExists: false,
    inventory,
    draft,
  }
}

export async function rerunWorkspaceImportTask(
  input: CreateWorkspaceImportInput,
): Promise<CreateWorkspaceImportResult> {
  const queue = await readQueue(input.memoryDir)
  const inventory =
    input.inventory ??
    (await detectWorkspaceSignals({ projectPath: input.projectPath }))
  const draft = input.draft ?? formWorkspaceHypothesis(inventory)
  const now = new Date().toISOString()
  const existingIndex = queue.tasks.findIndex((t) => t.id === WORKSPACE_IMPORT_TASK_ID)
  const transcriptPath = await writeWorkspaceImportTranscript(
    input.memoryDir,
    inventory,
    draft,
    input.seedMessage,
  )

  const task: Task = {
    id: WORKSPACE_IMPORT_TASK_ID,
    title: 'Import project notes and plans',
    description:
      'Refine the detector-produced draft of goals, tasks, and milestones with the user, then emit YAML fences for the merge step.',
    domain: WORKSPACE_IMPORT_DOMAIN,
    projectPath: input.projectPath,
    status: 'exploring',
    priority: 'high',
    dependsOn: [],
    outOfScope: [],
    acceptanceCriteria: [],
    notes: [
      {
        role: 'system',
        agentId: 'workspace-importer-agent',
        timestamp: now,
        content: 'Workspace import was explicitly re-run from the UI.',
      },
    ],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'system',
    createdAt: existingIndex >= 0 ? (queue.tasks[existingIndex]?.createdAt ?? now) : now,
    updatedAt: now,
  }

  if (existingIndex >= 0) {
    queue.tasks[existingIndex] = task
  } else {
    queue.tasks.unshift(task)
  }
  queue.lastUpdated = now
  await writeQueue(input.memoryDir, queue)

  const goalsPath = path.join(input.memoryDir, WORKSPACE_GOALS_FILE)
  if (await fs.stat(goalsPath).then(() => true).catch(() => false)) {
    try {
      const raw = JSON.parse(await readManagedTextFile(goalsPath, 'utf-8')) as Record<string, unknown>
      if (raw.dismissed) {
        delete raw.dismissed
        delete raw.dismissedAt
        raw.recordedAt = now
        await writeManagedTextFile(goalsPath, JSON.stringify(raw, null, 2), 'utf-8')
      }
    } catch {
      // Ignore malformed dismissed-state files; the rerun task/transcript are the source of truth.
    }
  }

  return {
    taskId: WORKSPACE_IMPORT_TASK_ID,
    transcriptPath,
    alreadyExists: existingIndex >= 0,
    inventory,
    draft,
  }
}

/**
 * Non-empty workspace + no user tasks yet + meta-intake already satisfied
 * (or deferred) = a candidate for import. The init wiring (step 6) also
 * consults the `workspace_import_autonomy` lever before acting on this.
 */
export async function workspaceNeedsImport(opts: {
  memoryDir: string
  projectPath: string
  inventory?: WorkspaceInventory
}): Promise<{ needed: boolean; inventory: WorkspaceInventory; draft: WorkspaceImportDraft }> {
  const queue = await readQueue(opts.memoryDir)
  const userTasks = queue.tasks.filter(
    (t) => t.domain !== '_meta' && t.domain !== WORKSPACE_IMPORT_DOMAIN,
  )
  const inventory =
    opts.inventory ??
    (await detectWorkspaceSignals({ projectPath: opts.projectPath }))
  const draft = formWorkspaceHypothesis(inventory)

  // Need an import when we found real signals AND the user hasn't already
  // started building out tasks manually.
  const needed = userTasks.length === 0 && inventory.signals.length > 0
  return { needed, inventory, draft }
}

// ---------------------------------------------------------------------------
// Approval — parse the three YAML fences the agent emitted and merge them
// into TASKS.json, PROGRESS.md, and memory/workspace-goals.json.
// ---------------------------------------------------------------------------

export interface ParsedImport {
  goals: readonly ParsedGoal[]
  tasks: readonly ParsedTask[]
  milestones: readonly ParsedMilestone[]
}

export interface ParsedGoal {
  id: string
  title: string
  rationale: string
}

export interface ParsedTask {
  id: string
  title: string
  description: string
  whyThisMayMatter?: string
  assumptions?: readonly string[]
  missingInformation?: readonly string[]
  domain: string
  priority: TaskPriority
  references: readonly string[]
}

interface MaterializedImportTask extends ParsedTask {
  acceptanceCriteria?: Array<{ id: string; description: string; verifiedBy?: string }>
  dependsOn?: readonly string[]
  proofPaths?: Task['proofPaths']
  evidenceGraphTask?: boolean
}

export interface ParsedMilestone {
  title: string
  evidence: string
}

const PRIORITIES: ReadonlySet<TaskPriority> = new Set([
  'critical',
  'high',
  'normal',
  'low',
])

function iterateYamlFences(spec: string): Generator<Record<string, unknown> | unknown[]> {
  return (function* () {
    const fence = /```ya?ml\s*\n([\s\S]*?)```/gi
    let match: RegExpExecArray | null
    while ((match = fence.exec(spec)) !== null) {
      const body = match[1] ?? ''
      let parsed: unknown
      try {
        parsed = yamlLoad(body)
      } catch {
        continue
      }
      if (parsed && typeof parsed === 'object') {
        yield parsed as Record<string, unknown> | unknown[]
      }
    }
  })()
}

function workspaceImportYamlErrors(spec: string): string[] {
  const errors: string[] = []
  const fence = /```ya?ml\s*\n([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  let index = 0
  while ((match = fence.exec(spec)) !== null) {
    index++
    try {
      yamlLoad(match[1] ?? '')
    } catch (err) {
      const message = err instanceof Error ? err.message.split('\n')[0] : String(err)
      errors.push(`fence ${index}: ${message}`)
    }
  }
  return errors
}

function normStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function normalizeImportText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function supportingText(title: string, value: string): string {
  return normalizeImportText(title) === normalizeImportText(value) ? '' : value
}

function normalizeImportedReferenceForTask(
  ref: string,
  workspaceProjectPath: string,
  taskProjectPath: string,
): string {
  const trimmed = ref.trim()
  if (!trimmed) return trimmed
  const absolute = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(workspaceProjectPath, trimmed)
  const relativeToTask = path.relative(path.resolve(taskProjectPath), absolute)
  if (
    relativeToTask &&
    relativeToTask !== '..' &&
    !relativeToTask.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativeToTask)
  ) {
    return relativeToTask || path.basename(absolute)
  }
  return path.isAbsolute(trimmed) ? absolute : trimmed
}

function absoluteImportedReference(
  ref: string,
  workspaceProjectPath: string,
): string {
  const trimmed = ref.trim()
  if (!trimmed) return trimmed
  return path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(workspaceProjectPath, trimmed)
}

function normalizeImportedDescriptionForTask(
  description: string,
  references: readonly string[],
  workspaceProjectPath: string,
  taskProjectPath: string,
): string {
  let out = description
  for (const ref of references) {
    const trimmed = ref.trim()
    if (!trimmed) continue
    const taskRelative = normalizeImportedReferenceForTask(trimmed, workspaceProjectPath, taskProjectPath)
    if (!taskRelative || taskRelative === trimmed) continue
    for (const prefix of [trimmed, path.resolve(workspaceProjectPath, trimmed)]) {
      if (out.startsWith(`${prefix}:`)) {
        out = `${taskRelative}:${out.slice(prefix.length + 1)}`
      }
    }
  }
  return out
}

/**
 * Pulls the `goals:` / `tasks:` / `milestones:` fences out of the importer
 * task's spec. Each section is independent: the agent can emit just one if
 * that's all the workspace justified.
 */
export function parseWorkspaceImport(spec: string): ParsedImport {
  const goals: ParsedGoal[] = []
  const tasks: ParsedTask[] = []
  const milestones: ParsedMilestone[] = []

  for (const obj of iterateYamlFences(spec)) {
    if (Array.isArray(obj)) {
      for (const raw of obj) {
        if (!raw || typeof raw !== 'object') continue
        const t = raw as Record<string, unknown>
        const id = typeof t['id'] === 'string' ? t['id'] : undefined
        const title = typeof t['title'] === 'string' ? t['title'] : undefined
        const rawDescription =
          typeof t['description'] === 'string' ? t['description'] : ''
        const whyThisMayMatter =
          typeof t['whyThisMayMatter'] === 'string' && t['whyThisMayMatter'].trim()
            ? t['whyThisMayMatter']
            : undefined
        const domain = typeof t['domain'] === 'string' ? t['domain'] : 'core'
        const rawPriority = t['priority']
        const priority =
          typeof rawPriority === 'string' && PRIORITIES.has(rawPriority as TaskPriority)
            ? (rawPriority as TaskPriority)
            : 'normal'
        if (!id || !title) continue
        tasks.push({
          id,
          title,
          description: supportingText(title, rawDescription),
          ...(whyThisMayMatter ? { whyThisMayMatter } : {}),
          ...(normStringList(t['assumptions']).length > 0 ? { assumptions: normStringList(t['assumptions']) } : {}),
          ...(normStringList(t['missingInformation']).length > 0 ? { missingInformation: normStringList(t['missingInformation']) } : {}),
          domain,
          priority,
          references: normStringList(t['references']),
        })
      }
      continue
    }
    if (Array.isArray(obj['goals'])) {
      for (const raw of obj['goals']) {
        if (!raw || typeof raw !== 'object') continue
        const g = raw as Record<string, unknown>
        const id = typeof g['id'] === 'string' ? g['id'] : undefined
        const title = typeof g['title'] === 'string' ? g['title'] : undefined
        const rawRationale = typeof g['rationale'] === 'string' ? g['rationale'] : ''
        if (!id || !title) continue
        const rationale = supportingText(title, rawRationale)
        goals.push({ id, title, rationale })
      }
    }
    if (Array.isArray(obj['tasks'])) {
      for (const raw of obj['tasks']) {
        if (!raw || typeof raw !== 'object') continue
        const t = raw as Record<string, unknown>
        const id = typeof t['id'] === 'string' ? t['id'] : undefined
        const title = typeof t['title'] === 'string' ? t['title'] : undefined
        const rawDescription =
          typeof t['description'] === 'string' ? t['description'] : ''
        const whyThisMayMatter =
          typeof t['whyThisMayMatter'] === 'string' && t['whyThisMayMatter'].trim()
            ? t['whyThisMayMatter']
            : undefined
        const domain = typeof t['domain'] === 'string' ? t['domain'] : 'core'
        const rawPriority = t['priority']
        const priority =
          typeof rawPriority === 'string' && PRIORITIES.has(rawPriority as TaskPriority)
            ? (rawPriority as TaskPriority)
            : 'normal'
        if (!id || !title) continue
        tasks.push({
          id,
          title,
          description: supportingText(title, rawDescription),
          ...(whyThisMayMatter ? { whyThisMayMatter } : {}),
          ...(normStringList(t['assumptions']).length > 0 ? { assumptions: normStringList(t['assumptions']) } : {}),
          ...(normStringList(t['missingInformation']).length > 0 ? { missingInformation: normStringList(t['missingInformation']) } : {}),
          domain,
          priority,
          references: normStringList(t['references']),
        })
      }
    }
    if (Array.isArray(obj['milestones'])) {
      for (const raw of obj['milestones']) {
        if (!raw || typeof raw !== 'object') continue
        const m = raw as Record<string, unknown>
        const title = typeof m['title'] === 'string' ? m['title'] : undefined
        const evidence =
          typeof m['evidence'] === 'string' ? m['evidence'] : ''
        if (!title) continue
        milestones.push({ title, evidence })
      }
    }
  }

  return { goals, tasks, milestones }
}

/**
 * Serialize a deterministic `WorkspaceImportDraft` (detector output) into
 * the YAML-fence format the importer-agent would have emitted, so
 * `approveWorkspaceImport` / `parseWorkspaceImport` can consume it without
 * an agent round-trip. This is what lets the user Approve the detector
 * findings directly when they don't need or want agent refinement.
 */
export function formatDetectedDraftAsSpec(draft: WorkspaceImportDraft): string {
  const escape = (s: string): string =>
    '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
  const lines: string[] = []

  if (draft.goals.length > 0) {
    lines.push('```yaml')
    lines.push('goals:')
    for (const g of draft.goals) {
      lines.push(`  - id: ${escape(g.id)}`)
      lines.push(`    title: ${escape(g.title)}`)
      if (g.rationale) lines.push(`    rationale: ${escape(g.rationale)}`)
    }
    lines.push('```')
    lines.push('')
  }
  if (draft.tasks.length > 0) {
    lines.push('```yaml')
    lines.push('tasks:')
    for (const t of draft.tasks) {
      lines.push(`  - id: ${escape(t.suggestedId)}`)
      lines.push(`    title: ${escape(t.title)}`)
      lines.push(`    description: ${escape(t.description || '')}`)
      if (t.whyThisMayMatter) lines.push(`    whyThisMayMatter: ${escape(t.whyThisMayMatter)}`)
      lines.push(`    domain: ${escape(t.domain || 'core')}`)
      lines.push(`    priority: ${t.priority}`)
      if (t.assumptions && t.assumptions.length > 0) {
        lines.push('    assumptions:')
        for (const assumption of t.assumptions) lines.push(`      - ${escape(assumption)}`)
      }
      if (t.missingInformation && t.missingInformation.length > 0) {
        lines.push('    missingInformation:')
        for (const missing of t.missingInformation) lines.push(`      - ${escape(missing)}`)
      }
      if (t.references && t.references.length > 0) {
        lines.push('    references:')
        for (const r of t.references) lines.push(`      - ${escape(r)}`)
      }
    }
    lines.push('```')
    lines.push('')
  }
  if (draft.milestones.length > 0) {
    lines.push('```yaml')
    lines.push('milestones:')
    for (const m of draft.milestones) {
      lines.push(`  - title: ${escape(m.title)}`)
      lines.push(`    evidence: ${escape(m.evidence || '')}`)
    }
    lines.push('```')
    lines.push('')
  }

  return lines.join('\n')
}

export interface ApproveWorkspaceImportInput {
  memoryDir: string
  projectPath: string
  coordinatorProjectPaths?: Record<string, string>
  draftOverride?: WorkspaceImportDraft
}

export interface ApproveWorkspaceImportResult {
  success: boolean
  tasksAdded?: number
  goalsRecorded?: number
  milestonesLogged?: number
  error?: string
}

const WORKSPACE_GOALS_FILE = 'workspace-goals.json'

function uniqueTaskId(existingIds: Set<string>, suggested: string): string {
  if (!existingIds.has(suggested)) return suggested
  for (let n = 2; n < 1000; n++) {
    const candidate = `${suggested}-${n}`
    if (!existingIds.has(candidate)) return candidate
  }
  throw new Error(`Cannot allocate unique id for ${suggested}`)
}

function normalizeImportedTaskDomain(
  domain: string,
  coordinatorProjectPaths?: Record<string, string>,
): string {
  const trimmed = domain.trim()
  if (!trimmed || !coordinatorProjectPaths) return domain
  if (Object.hasOwn(coordinatorProjectPaths, trimmed)) return trimmed

  const normalizedDomain = normalizeDomainRouteKey(trimmed)
  const matchedKey = Object.keys(coordinatorProjectPaths)
    .sort((left, right) => right.length - left.length)
    .find((key) => {
      const normalizedKey = normalizeDomainRouteKey(key)
      return normalizedDomain === normalizedKey || normalizedDomain.startsWith(`${normalizedKey} `)
    })
  return matchedKey ?? domain
}

function normalizeDomainRouteKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function evidenceSourcesForParsedTasks(
  projectPath: string,
  tasks: readonly ParsedTask[],
): Promise<EvidenceSource[]> {
  const seen = new Set<string>()
  const sources: EvidenceSource[] = []

  for (const task of tasks) {
    for (const reference of task.references) {
      const trimmed = reference.trim()
      if (!trimmed || /^[a-z]+:\/\//i.test(trimmed)) {
        continue
      }
      const absolute = path.isAbsolute(trimmed)
        ? path.resolve(trimmed)
        : path.resolve(projectPath, trimmed)
      if (seen.has(absolute)) {
        continue
      }
      seen.add(absolute)

      let stat: Awaited<ReturnType<typeof fs.stat>>
      try {
        stat = await fs.stat(absolute)
      } catch {
        continue
      }
      if (!stat.isFile()) {
        continue
      }

      const ext = path.extname(absolute).toLowerCase()
      if (!['.md', '.markdown', '.txt'].includes(ext)) {
        continue
      }

      const content = await readManagedTextFile(absolute, 'utf-8')
      sources.push({
        path: path.relative(projectPath, absolute) || path.basename(absolute),
        content,
      })
    }
  }

  return sources
}

async function materializeEvidenceWorkGraphTasks(
  input: {
    projectPath: string
    queue: TaskQueue
    parsedTasks: readonly ParsedTask[]
  },
): Promise<MaterializedImportTask[]> {
  const sources = await evidenceSourcesForParsedTasks(input.projectPath, input.parsedTasks)
  if (sources.length === 0) {
    return [...input.parsedTasks]
  }

  const plan = planEvidenceWorkGraph({
    sources,
    existingTasks: [
      ...input.queue.tasks,
      ...input.parsedTasks.map(task => ({
        id: task.id,
        title: task.title,
        description: task.description,
        status: 'import_draft',
        acceptanceCriteria: [],
        dependsOn: [],
      })),
    ],
  })
  if (plan.tasks.length === 0) {
    return [...input.parsedTasks]
  }

  const graphTaskIds = new Set(plan.tasks.map(task => task.id))
  const reconciledIds = new Set(plan.reconciliations.map(reconciliation => reconciliation.existingTaskId))
  const graphTasks = plan.tasks.map(task => graphTaskToParsedTask(task, sources))
  const untouchedParsedTasks = input.parsedTasks.filter(task =>
    !graphTaskIds.has(task.id) &&
    !reconciledIds.has(task.id),
  )

  return [...graphTasks, ...untouchedParsedTasks]
}

function graphTaskToParsedTask(task: EvidenceTask, sources: readonly EvidenceSource[]): MaterializedImportTask {
  const references = sources.map(source => source.path)
  return {
    id: task.id,
    title: task.title,
    description: [
      task.kind === 'integration'
        ? `Wire ${task.deliverableName} into ${task.consumerSurface ?? task.targetArea}.`
        : `Build ${task.deliverableName} as ${task.producedArtifact ?? 'a deliverable'}.`,
      task.buildsOn.length > 0 ? `Builds on: ${task.buildsOn.join(', ')}.` : '',
      references.length > 0 ? `Evidence: ${references.join(', ')}.` : '',
    ].filter(Boolean).join(' '),
    whyThisMayMatter: task.kind === 'integration'
      ? `${task.consumerSurface ?? task.targetArea} depends on ${task.deliverableName} before the user-facing flow can be completed.`
      : `${task.deliverableName} appears to be a missing prerequisite the project documentation already expects.`,
    assumptions: [
      'The referenced documentation still represents intended project direction.',
    ],
    missingInformation: [
      'Guildhall still needs to confirm the final success criteria and implementation boundary during shaping.',
    ],
    domain: task.targetArea,
    priority: task.kind === 'integration' ? 'normal' : 'high',
    references,
    acceptanceCriteria: task.acceptanceCriteria,
    dependsOn: task.dependsOn,
    proofPaths: task.proofPaths,
    evidenceGraphTask: true,
  }
}

function materializedAcceptanceCriteria(task: MaterializedImportTask): Task['acceptanceCriteria'] {
  return (task.acceptanceCriteria ?? []).map(criterion => ({
    id: criterion.id,
    description: criterion.description,
    scenario: criterion.description,
    expectation: criterion.description,
    verifiedBy: criterion.verifiedBy === 'automated' || criterion.verifiedBy === 'review'
      ? criterion.verifiedBy
      : criterion.id.includes('automated') || criterion.id.includes('regression')
        ? 'automated'
        : 'review',
    met: false,
  }))
}

/**
 * Consume the workspace-import draft: parse fences, append tasks as
 * `import_draft` + `origination='human'`, record milestones to PROGRESS.md,
 * persist goals into `memory/workspace-goals.json`, and mark the reserved
 * task done.
 *
 * Safe to call multiple times: tasks with ids already present are
 * skipped (the reserved task's spec is the source of truth).
 */
export async function approveWorkspaceImport(
  input: ApproveWorkspaceImportInput,
): Promise<ApproveWorkspaceImportResult> {
  const queue = await readQueue(input.memoryDir)
  const task = queue.tasks.find((t) => t.id === WORKSPACE_IMPORT_TASK_ID)
  if (!task) {
    return {
      success: false,
      error: `No workspace-import task found (id: ${WORKSPACE_IMPORT_TASK_ID})`,
    }
  }
  const parsed = input.draftOverride
    ? parseWorkspaceImport(formatDetectedDraftAsSpec(input.draftOverride))
    : (!task.spec || task.spec.trim().length === 0)
        ? null
        : parseWorkspaceImport(task.spec)
  if (!input.draftOverride && task.spec && task.spec.trim().length > 0) {
    const yamlErrors = workspaceImportYamlErrors(task.spec)
    if (yamlErrors.length > 0) {
      return {
        success: false,
        error: `Invalid workspace-import YAML: ${yamlErrors.join('; ')}`,
      }
    }
  }
  if (!parsed) {
    return {
      success: false,
      error:
        'Workspace-import task has no spec yet; ask the importer agent to emit the YAML fences first.',
    }
  }
  if (
    parsed.goals.length === 0 &&
    parsed.tasks.length === 0 &&
    parsed.milestones.length === 0
  ) {
    return {
      success: false,
      error:
        'Could not find goals/tasks/milestones fences in the workspace-import spec.',
    }
  }

  const now = new Date().toISOString()
  const materializedTasks = await materializeEvidenceWorkGraphTasks({
    projectPath: input.projectPath,
    queue,
    parsedTasks: parsed.tasks,
  })

  // Merge tasks into the queue as intake candidates. Dup ids get suffixed.
  const existingIds = new Set(queue.tasks.map((t) => t.id))
  const allocatedTaskIds: string[] = []
  const dependencyIdMap = new Map<string, string>()
  for (const t of materializedTasks) {
    const id = uniqueTaskId(existingIds, t.id)
    existingIds.add(id)
    allocatedTaskIds.push(id)
    if (!dependencyIdMap.has(t.id)) {
      dependencyIdMap.set(t.id, id)
    }
  }

  let tasksAdded = 0
  for (const [index, t] of materializedTasks.entries()) {
    const id = allocatedTaskIds[index] ?? t.id
    const domain = normalizeImportedTaskDomain(t.domain, input.coordinatorProjectPaths)
    const taskProjectPath =
      input.coordinatorProjectPaths?.[domain] ??
      resolveTaskProjectPath({
        workspaceProjectPath: input.projectPath,
        domain,
      })
    const normalizedDescription = normalizeImportedDescriptionForTask(
      t.description,
      t.references,
      input.projectPath,
      taskProjectPath,
    )
    const normalizedReferences = t.references.map((ref) =>
      absoluteImportedReference(ref, input.projectPath),
    )
    queue.tasks.push({
      id,
      title: t.title,
      description: normalizedDescription,
      domain,
      projectPath: taskProjectPath,
      // Import approval means "yes, keep this as a candidate draft", not
      // "this already has a complete task brief/spec." Imported notes become
      // shaping drafts first; only after shaping do they enter normal intake.
      status: 'import_draft',
      priority: t.priority,
      dependsOn: [...(t.dependsOn ?? [])].map(dependency => dependencyIdMap.get(dependency) ?? dependency),
      outOfScope: [],
      acceptanceCriteria: materializedAcceptanceCriteria(t),
      requestIntake: {
        intent: 'spec_only',
        recommendedNextAction: 'draft_spec',
        assumptions: [...(t.assumptions ?? [])],
        missingInformation: [...(t.missingInformation ?? [])],
        ...(t.missingInformation && t.missingInformation.length > 0
          ? {
              ownerDecisionNeeded: 'Confirm the intended scope and success boundary if this imported draft no longer matches current project needs.',
              whyOwnerDecisionMatters: 'Imported notes are evidence-backed candidates, but Guildhall should not treat them as current truth without reshaping.',
            }
          : {}),
        evidenceRefs: normalizedReferences.map(ref => `import:${ref}`),
        componentStack: [],
        pressureTestSummary: {
          systemOwned: true,
          degree: 'guided',
          qualityBar: 'Treat imported drafts as candidate work that must be reshaped against current evidence before implementation starts.',
          ownerQuestionPolicy: 'Only ask when the imported evidence is no longer enough to choose a trustworthy task boundary or success condition.',
          checks: [
            {
              id: 'source-relevance',
              title: 'Source relevance',
              status: 'system-check',
              reason: 'Guildhall should verify that the imported note still matches current repo reality and project direction.',
            },
            {
              id: 'scope-boundary',
              title: 'Scope boundary',
              status: 'needs-owner-judgment',
              reason: 'Imported notes often name a direction but not yet the right implementation boundary.',
            },
            {
              id: 'acceptance-criteria',
              title: 'Acceptance criteria',
              status: 'system-check',
              reason: 'Guildhall must reshape the imported draft into concrete acceptance criteria before implementation starts.',
            },
          ],
        },
        clarifyingQuestions: [],
        createdAt: now,
        createdBy: 'workspace-importer',
      },
      notes: t.references.length > 0
        ? [
            {
              agentId: 'workspace-importer',
              role: 'importer',
              content: [
                `Imported from: ${normalizedReferences.join(', ')}`,
                t.whyThisMayMatter ? `Why this may matter: ${t.whyThisMayMatter}` : '',
                t.assumptions && t.assumptions.length > 0 ? `Assumptions: ${t.assumptions.join(' | ')}` : '',
                t.missingInformation && t.missingInformation.length > 0 ? `Missing information: ${t.missingInformation.join(' | ')}` : '',
              ].filter(Boolean).join('\n'),
              timestamp: now,
            },
          ]
        : [],
      gateResults: [],
      reviewVerdicts: [],
      adjudications: [],
      escalations: [],
      agentIssues: [],
      ...(t.proofPaths ? { proofPaths: [...t.proofPaths] } : {}),
      revisionCount: 0,
      remediationAttempts: 0,
      origination: 'human',
      createdAt: now,
      updatedAt: now,
    })
    tasksAdded++
  }

  // Mark the importer task done.
  task.status = 'done'
  task.updatedAt = now
  task.completedAt = now
  queue.lastUpdated = now
  await writeQueue(input.memoryDir, queue)

  // Persist goals (overwrites prior import — the agent is authoritative).
  if (parsed.goals.length > 0) {
    const goalsPath = path.join(input.memoryDir, WORKSPACE_GOALS_FILE)
    await writeManagedTextFile(
      goalsPath,
      JSON.stringify(
        { version: 1, recordedAt: now, goals: parsed.goals },
        null,
        2,
      ),
      'utf-8',
    )
  }

  // Append milestones to PROGRESS.md.
  let milestonesLogged = 0
  if (parsed.milestones.length > 0) {
    const progressPath = path.join(input.memoryDir, 'PROGRESS.md')
    const blocks: string[] = []
    for (const m of parsed.milestones) {
      blocks.push(
        [
          `\n### 🏁 MILESTONE — ${now}`,
          `**Agent:** workspace-importer | **Domain:** ${WORKSPACE_IMPORT_DOMAIN}`,
          '',
          m.title,
          m.evidence ? `\nEvidence: ${m.evidence}` : '',
          '',
          '---',
        ]
          .filter((line) => line !== '')
          .join('\n'),
      )
      milestonesLogged++
    }
    await appendManagedTextFile(progressPath, blocks.join(''), 'utf-8')
  }

  const summary = [
    `Workspace import approved.`,
    `Tasks proposed: ${tasksAdded}.`,
    parsed.goals.length > 0 ? `Goals recorded: ${parsed.goals.length}.` : '',
    milestonesLogged > 0 ? `Milestones logged: ${milestonesLogged}.` : '',
  ]
    .filter(Boolean)
    .join(' ')

  await appendExploringTranscript({
    memoryDir: input.memoryDir,
    taskId: WORKSPACE_IMPORT_TASK_ID,
    role: 'system',
    content: summary,
  })

  return {
    success: true,
    tasksAdded,
    goalsRecorded: parsed.goals.length,
    milestonesLogged,
  }
}

// ---------------------------------------------------------------------------
// Lever-driven seed decision — used by init.ts and the meta-intake approval
// flow to decide whether to automatically create the reserved importer task.
// ---------------------------------------------------------------------------

export type ImportAutonomyPosition = 'off' | 'suggest' | 'apply'

export interface MaybeSeedWorkspaceImportInput {
  memoryDir: string
  projectPath: string
  /**
   * Optional injected lever position (tests). When omitted, loaded from
   * `.guildhall/agent-settings.yaml`. Defaults to 'suggest' if settings are
   * missing or the lever has not been written yet.
   */
  leverPosition?: ImportAutonomyPosition
  /** Optional injected inventory (tests). Normally detected fresh. */
  inventory?: WorkspaceInventory
}

export interface MaybeSeedWorkspaceImportResult {
  /** Whether the reserved task exists (either newly created or already present). */
  seeded: boolean
  /**
   * Why seeding was/was not performed. 'off' = lever disabled; 'not-needed'
   * = workspace already has user tasks or no signals; 'already-seeded' =
   * reserved task existed before this call; 'seeded' = we created it.
   */
  outcome: 'off' | 'not-needed' | 'already-seeded' | 'seeded'
  inventory: WorkspaceInventory
  draft: WorkspaceImportDraft
  leverPosition: ImportAutonomyPosition
}

async function resolveImportAutonomy(
  memoryDir: string,
): Promise<ImportAutonomyPosition> {
  const workspacePath = path.dirname(memoryDir)
  const settingsPath = defaultAgentSettingsPath(workspacePath)
  try {
    const settings = await loadLeverSettings({ path: settingsPath })
    const entry = settings.project['workspace_import_autonomy']
    const pos = entry?.position
    if (pos === 'off' || pos === 'suggest' || pos === 'apply') return pos
  } catch {
    // missing or unreadable settings file — fall back to the default.
  }
  return 'suggest'
}

/**
 * Detect-and-optionally-seed helper, consulted by init and the meta-intake
 * approval flow. Reads the `workspace_import_autonomy` lever:
 *
 *   - 'off'     → never seed; return `outcome: 'off'`.
 *   - 'suggest' → seed the reserved task but do NOT auto-approve. The
 *                 dashboard UI surfaces the draft for the user. (Default.)
 *   - 'apply'   → same as 'suggest' at this phase; auto-approval after the
 *                 agent emits fences is gated on an additional user nod in
 *                 the dashboard. A fully-autonomous path can be layered on
 *                 later without changing the data model here.
 */
export async function maybeSeedWorkspaceImport(
  input: MaybeSeedWorkspaceImportInput,
): Promise<MaybeSeedWorkspaceImportResult> {
  const leverPosition =
    input.leverPosition ?? (await resolveImportAutonomy(input.memoryDir))
  const needCheck = await workspaceNeedsImport({
    memoryDir: input.memoryDir,
    projectPath: input.projectPath,
    ...(input.inventory ? { inventory: input.inventory } : {}),
  })

  if (leverPosition === 'off') {
    return {
      seeded: false,
      outcome: 'off',
      inventory: needCheck.inventory,
      draft: needCheck.draft,
      leverPosition,
    }
  }

  if (!needCheck.needed) {
    return {
      seeded: false,
      outcome: 'not-needed',
      inventory: needCheck.inventory,
      draft: needCheck.draft,
      leverPosition,
    }
  }

  const res = await createWorkspaceImportTask({
    memoryDir: input.memoryDir,
    projectPath: input.projectPath,
    inventory: needCheck.inventory,
    draft: needCheck.draft,
  })

  return {
    seeded: true,
    outcome: res.alreadyExists ? 'already-seeded' : 'seeded',
    inventory: res.inventory,
    draft: res.draft,
    leverPosition,
  }
}
