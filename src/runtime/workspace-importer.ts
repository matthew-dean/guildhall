import fs from 'node:fs/promises'
import path from 'node:path'
import { TaskQueue, type Task } from '@guildhall/core'
import { appendExploringTranscript } from '@guildhall/tools'
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
