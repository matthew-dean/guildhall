import fs from 'node:fs/promises'
import path from 'node:path'
import { load as yamlLoad } from 'js-yaml'
import { TaskQueue, type Task, type TaskPriority } from '@guildhall/core'
import { appendExploringTranscript } from '@guildhall/tools'
import { loadLeverSettings, defaultAgentSettingsPath } from '@guildhall/levers'
import {
  detectWorkspaceSignals,
  formWorkspaceHypothesis,
  type WorkspaceImportDraft,
  type WorkspaceInventory,
} from './workspace-import/index.js'

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
  return path.join(memoryDir, 'TASKS.json')
}

async function readQueue(memoryDir: string): Promise<TaskQueue> {
  const raw = await fs.readFile(tasksPathFor(memoryDir), 'utf-8')
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) {
    return { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
  }
  return TaskQueue.parse(parsed)
}

async function writeQueue(memoryDir: string, queue: TaskQueue): Promise<void> {
  await fs.writeFile(tasksPathFor(memoryDir), JSON.stringify(queue, null, 2), 'utf-8')
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
    title: 'Import existing workspace artifacts into TASKS.json',
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
  domain: string
  priority: TaskPriority
  references: readonly string[]
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

function iterateYamlFences(spec: string): Generator<Record<string, unknown>> {
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
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        yield parsed as Record<string, unknown>
      }
    }
  })()
}

function normStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
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
    if (Array.isArray(obj['goals'])) {
      for (const raw of obj['goals']) {
        if (!raw || typeof raw !== 'object') continue
        const g = raw as Record<string, unknown>
        const id = typeof g['id'] === 'string' ? g['id'] : undefined
        const title = typeof g['title'] === 'string' ? g['title'] : undefined
        const rationale = typeof g['rationale'] === 'string' ? g['rationale'] : ''
        if (!id || !title) continue
        goals.push({ id, title, rationale })
      }
    }
    if (Array.isArray(obj['tasks'])) {
      for (const raw of obj['tasks']) {
        if (!raw || typeof raw !== 'object') continue
        const t = raw as Record<string, unknown>
        const id = typeof t['id'] === 'string' ? t['id'] : undefined
        const title = typeof t['title'] === 'string' ? t['title'] : undefined
        const description =
          typeof t['description'] === 'string' ? t['description'] : ''
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
          description,
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

export interface ApproveWorkspaceImportInput {
  memoryDir: string
  projectPath: string
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

/**
 * Consume the workspace-import draft: parse fences, append tasks as
 * `proposed` so FR-21 task_origination still governs promotion, record
 * milestones to PROGRESS.md, persist goals into
 * `memory/workspace-goals.json`, and mark the reserved task done.
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
  if (!task.spec || task.spec.trim().length === 0) {
    return {
      success: false,
      error:
        'Workspace-import task has no spec yet; ask the importer agent to emit the YAML fences first.',
    }
  }

  const parsed = parseWorkspaceImport(task.spec)
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

  // Merge tasks into the queue as `proposed`. Dup ids get suffixed.
  const existingIds = new Set(queue.tasks.map((t) => t.id))
  let tasksAdded = 0
  for (const t of parsed.tasks) {
    const id = uniqueTaskId(existingIds, t.id)
    existingIds.add(id)
    queue.tasks.push({
      id,
      title: t.title,
      description: t.description,
      domain: t.domain,
      projectPath: input.projectPath,
      status: 'proposed',
      priority: t.priority,
      dependsOn: [],
      outOfScope: [],
      acceptanceCriteria: [],
      notes: t.references.length > 0
        ? [
            {
              agentId: 'workspace-importer',
              role: 'importer',
              content: `Imported from: ${t.references.join(', ')}`,
              timestamp: now,
            },
          ]
        : [],
      gateResults: [],
      reviewVerdicts: [],
      escalations: [],
      agentIssues: [],
      revisionCount: 0,
      remediationAttempts: 0,
      origination: 'system',
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
    await fs.writeFile(
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
    await fs.appendFile(progressPath, blocks.join(''), 'utf-8')
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
   * `memory/agent-settings.yaml`. Defaults to 'suggest' if settings are
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
