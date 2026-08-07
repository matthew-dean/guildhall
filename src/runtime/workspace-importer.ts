import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import fs from 'node:fs/promises'
import path from 'node:path'
import { load as yamlLoad } from 'js-yaml'
import { AcceptanceCriteria, explicitTaskStructuralIdentity, ProjectReleaseState, renderStructuredSpecMarkdown, splitChildSourceIdentity, StructuredSpec, TaskQueue, TERMINAL_TASK_STATUSES, buildDecompositionChildDrafts, type ProjectRelease, type Task, type TaskPriority } from '@guildhall/core'
import { getProjectLocalHistoryDir, getProjectSystemStatePathFromMemoryDir, inferProjectRootFromMemoryDir, readProjectStateDatabaseQueueRevision } from '@guildhall/sessions'
import { appendExploringTranscript, replaceExploringTranscript } from '@guildhall/tools'
import { loadLeverSettings, defaultAgentSettingsPath } from '@guildhall/levers'
import {
  detectWorkspaceSignals,
  formWorkspaceHypothesis,
  type DraftContext,
  type DraftGoal,
  type DraftMilestone,
  type DraftTask,
  type WorkspaceImportDraft,
  type WorkspaceInventory,
} from './workspace-import/index.js'
import { normalizeImportedDraftTask } from './import-drafts.js'
import { resolveTaskProjectPath } from './task-project-path.js'
import {
  planEvidenceWorkGraph,
  type EvidenceTask,
  type EvidenceSource,
  type EvidenceStatusHint,
  type EvidenceWorkShape,
} from './evidence-work-graph-intake.js'
import type { ImportSemanticKind } from './import-semantic-kind.js'
import {
  evidenceTaskDescription,
  evidenceTaskPriority,
  evidenceTaskReferences,
  evidenceTaskWhyThisMayMatter,
} from './evidence-task-import-draft.js'
import { deriveReleaseContainersFromTaskMembership, releaseLabelFromId, taskScopeNodeId } from './project-scope-projection.js'
import { applyTaskShaping } from './task-decomposition.js'
import { isMaterializableSplitAction, materializeSplitChildren } from '@guildhall/tools'
import { effectiveTaskTitle } from '@guildhall/shared'
import { isConcreteProjectProofCommand, replaceGenericProjectProofPathsWithSetup } from './proof-paths.js'
import {
  contractShapedImportHasNoConcreteContracts,
} from './imported-work-integrity.js'
import { preserveRuntimeOverlayOnTaskQueueParse, readProjectTaskQueueForRichMutation, writeProjectTaskQueueAtCurrentStateBoundary } from './project-state-boundary.js'
import { WORKSPACE_IMPORT_TASK_ID } from './project-reserved-task-ids.js'
import { writeProjectSummaryProjectionFromUnknownQueue } from './project-summary-projection.js'
import type { OrientationWorkspaceImportDraftContext } from './project-orientation-spine.js'

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

export { WORKSPACE_IMPORT_TASK_ID } from './project-reserved-task-ids.js'
export const WORKSPACE_IMPORT_DOMAIN = '_workspace_import'

export function workspaceImportTasksPath(memoryDir: string): string {
  return getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json')
}

function workspaceImportStatePath(memoryDir: string, relativePath: string): string {
  return getProjectSystemStatePathFromMemoryDir(memoryDir, relativePath)
}

async function readQueue(memoryDir: string): Promise<TaskQueue> {
  const raw = await readProjectTaskQueueForRichMutation(inferProjectRootFromMemoryDir(memoryDir)).catch((err: unknown) => {
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
  const parsed = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw
  const queue = TaskQueue.parse(Array.isArray(parsed)
    ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
    : parsed)
  const queueWithRuntime = preserveRuntimeOverlayOnTaskQueueParse(parsed, queue)
  for (const task of queueWithRuntime.tasks) normalizeImportedDraftTask(task)
  return queueWithRuntime
}

async function writeQueue(memoryDir: string, queue: TaskQueue): Promise<void> {
  const tasksPath = workspaceImportTasksPath(memoryDir)
  await fs.mkdir(path.dirname(tasksPath), { recursive: true })
  const expectedQueueRevision = readProjectStateDatabaseQueueRevision(tasksPath)
  await writeProjectTaskQueueAtCurrentStateBoundary(tasksPath, queue, {
    projectId: path.basename(inferProjectRootFromMemoryDir(memoryDir)),
    projectRoot: inferProjectRootFromMemoryDir(memoryDir),
    ...(expectedQueueRevision !== null ? { expectedQueueRevision } : {}),
  })
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
  const isBriefRecord = (context: typeof draft.context[number]): boolean =>
    context.role === 'brief_input' && context.structure === 'record'
  const isBriefNote = (context: typeof draft.context[number]): boolean =>
    context.role === 'brief_input' && context.structure !== 'record'
  const isCapabilityRecord = (context: typeof draft.context[number]): boolean =>
    context.role === 'capability' && context.structure === 'record'
  const isCapabilityNote = (context: typeof draft.context[number]): boolean =>
    context.role === 'capability' && context.structure !== 'record'
  const pushTaskSection = (title: string, tasks: typeof draft.tasks): void => {
    if (tasks.length === 0) return
    lines.push(title)
    lines.push('-'.repeat(title.length))
    for (const t of tasks) {
      lines.push(`- [${t.confidence}/${t.priority}] ${t.title}  (suggestedId: ${t.suggestedId})`)
      lines.push(`    ${t.description}`)
      lines.push(`    domain: ${t.domain}`)
      lines.push(`    scope: ${t.scope === 'later' ? 'later / deferred' : 'current / now'}`)
      lines.push(`    source: ${t.source}${t.references ? ` (${t.references.join(', ')})` : ''}`)
    }
    lines.push('')
  }
  const pushContextSection = (title: string, contexts: typeof draft.context): void => {
    if (contexts.length === 0) return
    lines.push(title)
    lines.push('-'.repeat(title.length))
    for (const c of contexts) {
      lines.push(`- ${c.label}`)
      lines.push(`    ${c.excerpt}`)
      lines.push(`    source: ${c.source}${c.references ? ` (${c.references.join(', ')})` : ''}`)
    }
    lines.push('')
  }
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
    pushTaskSection('Current draft tasks', draft.tasks.filter(task => task.scope !== 'later'))
    pushTaskSection('Later / deferred draft tasks', draft.tasks.filter(task => task.scope === 'later'))
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
    lines.push('')
    pushContextSection('Brief records', draft.context.filter(isBriefRecord))
    pushContextSection('Brief notes', draft.context.filter(isBriefNote))
    pushContextSection('Capability records', draft.context.filter(isCapabilityRecord))
    pushContextSection('Capability context', draft.context.filter(isCapabilityNote))
    pushContextSection('Reference context', draft.context.filter(context => context.role === 'reference'))
    pushContextSection('General context', draft.context.filter(context => !context.role))
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
  const seed =
    seedMessage ??
    [
      WORKSPACE_IMPORT_SEED_PREAMBLE,
      formatDraftForTranscript(inventory, draft),
      WORKSPACE_IMPORT_SEED_FORMAT,
    ].join('\n')
  const result = await replaceExploringTranscript({
    memoryDir,
    taskId: WORKSPACE_IMPORT_TASK_ID,
    role: 'system',
    content: seed,
  })
  if (!result.success || !result.path) throw new Error(`Failed to write workspace-import history: ${result.error ?? 'unknown'}`)
  return result.path
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
  const draft = input.draft ?? await materializeWorkspaceImportDraft({
    memoryDir: input.memoryDir,
    projectPath: input.projectPath,
    draft: formWorkspaceHypothesis(inventory),
  })

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
    references: [],
    sourceClaims: [],
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
  const draft = input.draft ?? await materializeWorkspaceImportDraft({
    memoryDir: input.memoryDir,
    projectPath: input.projectPath,
    draft: formWorkspaceHypothesis(inventory),
  })
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
    references: [],
    sourceClaims: [],
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

  const documentedStructure = documentedStructuralContextsForProjection(draft.context)
  await recordWorkspaceStructuralSnapshot({
    memoryDir: input.memoryDir,
    documentedStructure,
    recordedAt: now,
    dismissed: false,
  })
  const currentTasksPath = workspaceImportTasksPath(input.memoryDir)
  const expectedQueueRevision = readProjectStateDatabaseQueueRevision(currentTasksPath)
  writeProjectSummaryProjectionFromUnknownQueue(currentTasksPath, {
    queue,
    documentedStructure,
    queueCommit: false,
    ...(expectedQueueRevision !== null ? { expectedQueueRevision } : {}),
  })

  const goalsPath = getProjectSystemStatePathFromMemoryDir(input.memoryDir, WORKSPACE_GOALS_FILE)
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
 * Close a deliberately dismissed import at the same queue authority that
 * created it. A dismissed draft is not runnable work and must not leave the
 * reserved setup task in `exploring` to block an otherwise valid release.
 */
export async function dismissWorkspaceImportTask(input: {
  memoryDir: string
  projectPath: string
}): Promise<{ dismissed: boolean }> {
  const queue = await readQueue(input.memoryDir)
  const task = queue.tasks.find(candidate => candidate.id === WORKSPACE_IMPORT_TASK_ID)
  const now = new Date().toISOString()
  if (task && task.status !== 'done') {
    task.status = 'done'
    task.updatedAt = now
    task.notes = [
      ...(task.notes ?? []),
      {
        role: 'system',
        agentId: 'workspace-importer-agent',
        timestamp: now,
        content: 'Workspace import dismissed; no imported work was accepted into the current run boundary.',
      },
    ]
    queue.lastUpdated = now
    await writeQueue(input.memoryDir, queue)
  }
  const transcript = await replaceExploringTranscript({
    memoryDir: input.memoryDir,
    taskId: WORKSPACE_IMPORT_TASK_ID,
    role: 'system',
    content: 'Workspace import dismissed. The temporary source scan was not accepted as executable project work.',
  })
  if (!transcript.success) {
    throw new Error(`Could not compact dismissed workspace-import history: ${transcript.error ?? 'unknown error'}`)
  }
  return { dismissed: Boolean(task) }
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
  const draft = await materializeWorkspaceImportDraft({
    memoryDir: opts.memoryDir,
    projectPath: opts.projectPath,
    draft: formWorkspaceHypothesis(inventory),
  })

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
  releases?: readonly ParsedRelease[]
  tasks: readonly ParsedTask[]
  milestones: readonly ParsedMilestone[]
}

export interface ParsedRelease {
  id: string
  label: string
  source?: ProjectRelease['source']
  state?: ProjectRelease['state']
}

export interface ParsedGoal {
  id: string
  title: string
  rationale: string
}

export interface ParsedAcceptanceCriterion {
  id: string
  description: string
  scenario?: string
  expectation?: string
  verifiedBy?: string
  source?: 'documented' | 'inferred'
  command?: string
  expectedExit?: 'zero' | 'non_zero'
  expectedOutputIncludes?: string[]
  evidenceHint?: string
  negativeCase?: string
}

export interface ParsedTask {
  id: string
  title: string
  sourceIdentity?: string
  deliverableName?: string
  producedArtifact?: string
  /** Explicit graph metadata; never inferred from title or description. */
  workShape?: EvidenceWorkShape
  statusHint?: EvidenceStatusHint
  targetArea?: string
  buildsOn?: readonly string[]
  consumerSurfaces?: readonly string[]
  description: string
  whyThisMayMatter?: string
  assumptions?: readonly string[]
  missingInformation?: readonly string[]
  domain: string
  scope?: 'current' | 'later'
  priority: TaskPriority
  references: readonly string[]
  acceptanceCriteria?: ParsedAcceptanceCriterion[]
  dependsOn?: readonly string[]
  proofPaths?: readonly Record<string, unknown>[]
  releaseIds?: readonly string[]
  sourceClaims?: Task['sourceClaims']
  /** Explicit intake metadata; never inferred from title or description. */
  semanticKind?: ImportSemanticKind
  /** Explicit contract names owned by this task; never inferred from title prose. */
  contractNames?: readonly string[]
  /** Explicit parent acceptance links; never inferred from criterion prose. */
  parentAcceptanceCriterionIds?: readonly string[]
}

export interface MaterializedImportTask extends ParsedTask {
  acceptanceCriteria?: ParsedAcceptanceCriterion[]
  dependsOn?: readonly string[]
  proofPaths?: readonly Record<string, unknown>[]
  evidenceGraphTask?: boolean
}

type SimpleImportedProofPath = {
  kind: 'command' | 'review' | 'browser'
  command?: string
  expectedEvidence?: string[]
  source?: 'documented' | 'inferred'
}

function simpleImportedProofPaths(paths: readonly unknown[] | undefined): SimpleImportedProofPath[] {
  return (paths ?? []).filter((path): path is SimpleImportedProofPath => {
    if (!path || typeof path !== 'object' || Array.isArray(path)) return false
    const kind = (path as { kind?: unknown }).kind
    return kind === 'command' || kind === 'review' || kind === 'browser'
  })
}

function importedSourceClaimsForTask(
  task: Pick<MaterializedImportTask, 'id' | 'sourceIdentity' | 'deliverableName' | 'title' | 'description' | 'whyThisMayMatter' | 'references' | 'scope' | 'releaseIds'>,
  normalizedReferences: readonly string[],
): Task['sourceClaims'] {
  const evidence = [
    task.whyThisMayMatter,
    task.description,
  ].find(value => typeof value === 'string' && value.trim().length > 0)?.trim() ?? task.title
  const releaseId = task.releaseIds?.[0]
  return [{
    source: 'workspace-importer',
    title: task.title,
    evidence,
    references: [...normalizedReferences],
    ...(task.scope ? { scopeHint: task.scope } : {}),
    ...(releaseId ? { releaseId } : {}),
    confidence: normalizedReferences.length > 0 ? 'high' : 'medium',
    // A source claim may point back to work only through an explicit id or
    // source-owned identity. The title is audit text, not a join key.
    linkedTaskHints: [task.id, task.sourceIdentity, task.deliverableName].filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    ),
  }]
}

function dedupeImportSourceClaims(claims: readonly NonNullable<MaterializedImportTask['sourceClaims']>[number][]): Task['sourceClaims'] {
  const byKey = new Map<string, NonNullable<Task['sourceClaims']>[number]>()
  for (const [index, claim] of claims.entries()) {
    const normalized: NonNullable<Task['sourceClaims']>[number] = {
      ...(claim.signalId ? { signalId: claim.signalId } : {}),
      source: claim.source,
      title: claim.title,
      evidence: claim.evidence,
      references: [...(claim.references ?? [])],
      ...(claim.role ? { role: claim.role } : {}),
      ...(claim.structure ? { structure: claim.structure } : {}),
      ...(claim.scopeHint ? { scopeHint: claim.scopeHint } : {}),
      ...(claim.releaseId ? { releaseId: claim.releaseId } : {}),
      ...(claim.releaseLabel ? { releaseLabel: claim.releaseLabel } : {}),
      confidence: claim.confidence,
      linkedTaskHints: [...(claim.linkedTaskHints ?? [])],
    }
    const key = normalized.signalId
      ? `${normalized.source}\0signal:${normalized.signalId}`
      : `${normalized.source}\0ordinal:${index}`
    if (!byKey.has(key)) byKey.set(key, normalized)
  }
  return [...byKey.values()]
}

type ImportedEvidenceDetail = {
  contractNames: string[]
  implementationBullets: string[]
  verificationBullets: string[]
  goalStatements: string[]
  reviewQuestions: string[]
  decisionSteps: string[]
  rules: string[]
  examples: string[]
  weightDimensions: string[]
  severityLevels: string[]
  coreLoopSteps: string[]
  systemRecords: string[]
  packetFields: string[]
  privacyRules: string[]
  invalidationRules: string[]
}

type ImportedBlueprintSeed = {
  status: Task['status']
  requestIntake: Task['requestIntake']
  sourceClaims: Task['sourceClaims']
  acceptanceCriteria?: Task['acceptanceCriteria']
  proofPaths?: readonly Record<string, unknown>[]
  productBrief?: Task['productBrief']
  spec?: Task['spec']
  structuredSpec?: Task['structuredSpec']
  outOfScope: Task['outOfScope']
  notes: Task['notes']
  workUnitAnalysis?: Task['workUnitAnalysis']
  taskReadiness?: Task['taskReadiness']
  taskKind?: Task['taskKind']
  definitionOfDone?: Task['definitionOfDone']
  blockerPlans?: Task['blockerPlans']
  contextBudget?: Task['contextBudget']
  decomposition?: Task['decomposition']
  sizePlan?: Task['sizePlan']
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

export function workspaceImportYamlErrors(spec: string): string[] {
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

const EVIDENCE_WORK_SHAPES: ReadonlySet<EvidenceWorkShape> = new Set([
  'ui-component',
  'frontend-integration',
  'backend-api',
  'cli-tool',
  'docs',
  'migration',
  'bugfix',
  'single-edit',
  'generic',
])

function parseEvidenceWorkShape(value: unknown): EvidenceWorkShape | undefined {
  return typeof value === 'string' && EVIDENCE_WORK_SHAPES.has(value as EvidenceWorkShape)
    ? value as EvidenceWorkShape
    : undefined
}

function parseEvidenceStatusHint(value: unknown): EvidenceStatusHint | undefined {
  return value === 'missing' || value === 'shipped' || value === 'unknown' ? value : undefined
}

function parseProjectReleaseState(value: unknown): ProjectRelease['state'] | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = ProjectReleaseState.safeParse(value.trim())
  return parsed.success ? parsed.data : undefined
}

function parseImportedAcceptanceCriteria(
  value: unknown,
): ParsedAcceptanceCriterion[] | null {
  if (!Array.isArray(value)) return null
  const parsed = value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => {
      const id = typeof entry.id === 'string' ? entry.id.trim() : ''
      const description = typeof entry.description === 'string' ? entry.description.trim() : ''
      const scenario = typeof entry.scenario === 'string' ? entry.scenario.trim() : ''
      const expectation = typeof entry.expectation === 'string' ? entry.expectation.trim() : ''
      const verifiedBy = typeof entry.verifiedBy === 'string' ? entry.verifiedBy.trim() : ''
      const source = entry.source === 'inferred' ? 'inferred' : entry.source === 'documented' ? 'documented' : ''
      const command = typeof entry.command === 'string' ? entry.command.trim() : ''
      const expectedExit = entry.expectedExit === 'zero' || entry.expectedExit === 'non_zero'
        ? entry.expectedExit
        : undefined
      const expectedOutputIncludes = Array.isArray(entry.expectedOutputIncludes)
        ? entry.expectedOutputIncludes
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map(item => item.trim())
        : typeof entry.expectedOutputIncludes === 'string' && entry.expectedOutputIncludes.trim()
          ? [entry.expectedOutputIncludes.trim()]
          : undefined
      const evidenceHint = typeof entry.evidenceHint === 'string' ? entry.evidenceHint.trim() : ''
      const negativeCase = typeof entry.negativeCase === 'string' ? entry.negativeCase.trim() : ''
      if (!id || !description) return null
      return {
        id,
        description,
        ...(scenario ? { scenario } : {}),
        ...(expectation ? { expectation } : {}),
        ...(verifiedBy ? { verifiedBy } : {}),
        ...(source ? { source } : {}),
        ...(command ? { command } : {}),
        ...(expectedExit ? { expectedExit } : {}),
        ...(expectedOutputIncludes ? { expectedOutputIncludes } : {}),
        ...(evidenceHint ? { evidenceHint } : {}),
        ...(negativeCase ? { negativeCase } : {}),
      }
    })
    .filter((entry): entry is ParsedAcceptanceCriterion => Boolean(entry))
  return parsed.length > 0 ? parsed : null
}

function parseImportedDependsOn(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim())
}

function parseImportedProofPaths(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    .map(normalizeImportedProofPath)
}

function normalizeImportedProofPath(path: Record<string, unknown>): Record<string, unknown> {
  const command = typeof path.command === 'string' ? path.command.trim() : ''
  if (path.kind !== 'command' || !command || Array.isArray(path.launchSteps)) return path
  return {
    ...path,
    launchSteps: [{
      id: importedCommandId(command),
      title: command,
      kind: 'copy_command',
      command,
    }],
  }
}

function importedCommandId(command: string): string {
  return command
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'imported-command-proof'
}

function finalizeDraftTaskProofPaths(task: {
  suggestedId: string
  title: string
  proofPaths?: readonly Record<string, unknown>[]
}): Task['proofPaths'] | undefined {
  const proofPaths = task.proofPaths?.map(path =>
    path && typeof path === 'object' && !Array.isArray(path)
      ? normalizeImportedProofPath(path as Record<string, unknown>)
      : path,
  )
  if (!importedPrototypeTaskKind({
    id: task.suggestedId,
    title: task.title,
    description: '',
    domain: '',
    priority: 'normal',
    references: [],
  })) return proofPaths as unknown as Task['proofPaths']
  const withoutGenericCommand = (proofPaths ?? []).filter(path => {
    if (!path || typeof path !== 'object' || Array.isArray(path)) return true
    const record = path as Record<string, unknown>
    return !(
      record.kind === 'command' &&
      typeof record.command === 'string' &&
      !isConcreteProjectProofCommand(record.command)
    )
  })
  const hasModeledCommandNeed = withoutGenericCommand.some(path => {
    if (!path || typeof path !== 'object' || Array.isArray(path)) return false
    const record = path as Record<string, unknown>
    if (record.kind !== 'command') return false
    if (record.source !== 'inferred' && typeof record.command === 'string' && record.command.trim()) return true
    const launchSteps = Array.isArray(record.launchSteps) ? record.launchSteps : []
    return launchSteps.some(step =>
      step && typeof step === 'object' && !Array.isArray(step) &&
      (step as Record<string, unknown>).kind === 'blocked_until_setup',
    )
  })
  return hasModeledCommandNeed
    ? withoutGenericCommand as unknown as Task['proofPaths']
    : [importedMissingCommandProofPath({ id: task.suggestedId, title: task.title }, [
        `Add a repo-local pnpm script or CLI proof command for ${task.title}.`,
      ]), ...withoutGenericCommand] as unknown as Task['proofPaths']
}

function normalizeImportText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sourceTitleFromImportedDescription(description: string): string | null {
  const sourcePath = importTaskSourcePath(description)
  if (!sourcePath) return null
  const body = description
    .replace(/^(.+?\.md):\s+/, '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/^\s*\[[ xX]\]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return body.length > 0 ? body : null
}

function repairImportedTaskTitleFromSourceDescription(task: Task): boolean {
  if (!isWorkspaceImportManagedTask(task)) return false
  const sourceTitle = sourceTitleFromImportedDescription(task.description ?? '')
  if (!sourceTitle || sourceTitle.length <= task.title.length) return false
  const normalizedTitle = normalizeImportText(task.title)
  const normalizedSourceTitle = normalizeImportText(sourceTitle)
  if (!normalizedTitle || !normalizedSourceTitle.startsWith(normalizedTitle)) return false
  task.title = sourceTitle
  return true
}

function existingImportedTaskMatchesIncoming(
  existing: Task,
  imported: MaterializedImportTask,
): boolean {
  // Imported task identity is a durable id, never a title. A different model
  // may rewrite the title without changing which work record it represents.
  return existing.id === imported.id
}

async function readRecoverableArchivedImportTasks(memoryDir: string): Promise<Task[]> {
  const archivePaths = new Set<string>()
  const archiveDir = workspaceImportStatePath(memoryDir, path.join('tasks', 'archive'))
  try {
    const entries = await fs.readdir(archiveDir)
    for (const entry of entries) {
      if (entry.endsWith('.json')) archivePaths.add(path.join(archiveDir, entry))
    }
  } catch (err) {
    if (!String(err).includes('ENOENT')) throw err
  }

  const taskHistoryDir = path.join(
    getProjectLocalHistoryDir(inferProjectRootFromMemoryDir(memoryDir)),
    'tasks',
  )
  try {
    const entries = await fs.readdir(taskHistoryDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      archivePaths.add(path.join(taskHistoryDir, entry.name, 'archive-evidence.json'))
    }
  } catch (err) {
    if (!String(err).includes('ENOENT')) throw err
  }

  const tasks: Task[] = []
  for (const file of archivePaths) {
    const raw = await readManagedTextFile(file, 'utf-8').catch((err: unknown) => {
      if (String(err).includes('ENOENT')) return null
      throw err
    })
    if (!raw) continue
    const parsed = JSON.parse(raw) as Task
    if (!parsed || typeof parsed !== 'object') continue
    repairImportedTaskTitleFromSourceDescription(parsed)
    if (!archivedTaskCanRecoverImportedWork(parsed)) continue
    tasks.push(parsed)
  }
  return tasks
}

function archivedTaskCanRecoverImportedWork(task: Task): boolean {
  return task.status === 'done' || taskHasDurableCompletionEvidence(task)
}

function archivedImportTaskMatchesIncoming(
  archived: Task,
  imported: MaterializedImportTask,
  input: Pick<ApproveWorkspaceImportInput, 'coordinatorProjectPaths' | 'projectPath'>,
): boolean {
  if (!archivedTaskCanRecoverImportedWork(archived)) return false
  const domain = normalizeImportedTaskDomain(
    imported.domain,
    input.coordinatorProjectPaths,
    imported.references,
    input.projectPath,
  )
  if (archived.domain && domain && archived.domain !== domain) return false
  const projectPath = input.coordinatorProjectPaths?.[domain]
    ?? resolveTaskProjectPath({
      workspaceProjectPath: input.projectPath,
      domain,
    })
  if (archived.projectPath && projectPath && archived.projectPath !== projectPath) return false
  // Archived completion recovery must follow the explicit durable task id.
  // Title similarity would let a model's wording decide which work is alive.
  return archived.id === imported.id
}

function activeImportedTaskShouldYieldToArchivedCompletion(existing: Task, archived: Task): boolean {
  if (!isWorkspaceImportManagedTask(existing)) return false
  if (taskHasDurableCompletionEvidence(existing)) return false
  if (existing.status === 'done' || existing.status === 'pending_pr') return false
  return archivedTaskCanRecoverImportedWork(archived)
}

function ensureArchivedTaskRecoveredForImport(input: {
  queue: TaskQueue
  archived: Task
  existingImportedTasks: Task[]
}): Task {
  const existing = input.queue.tasks.find(task => task.id === input.archived.id)
  if (existing) return existing
  const restored = JSON.parse(JSON.stringify(input.archived)) as Task
  restored.notes = [
    ...(restored.notes ?? []),
    {
      agentId: 'workspace-importer',
      role: 'system',
      content: 'Recovered archived completion evidence because current imported scope still points at this work.',
      timestamp: new Date().toISOString(),
    },
  ]
  input.queue.tasks.push(restored)
  input.existingImportedTasks.push(restored)
  return restored
}

function importTaskSourcePath(description: string): string | null {
  const match = /^(.+?\.md):\s+/.exec(description.trim())
  return match?.[1]?.trim() ?? null
}

function supportingText(title: string, value: string): string {
  return normalizeImportText(title) === normalizeImportText(value) ? '' : value
}

function mergeImportReferences(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): string[] | undefined {
  const refs = new Set<string>()
  for (const ref of left ?? []) {
    const trimmed = ref.trim()
    if (trimmed) refs.add(trimmed)
  }
  for (const ref of right ?? []) {
    const trimmed = ref.trim()
    if (trimmed) refs.add(trimmed)
  }
  return refs.size > 0 ? [...refs] : undefined
}

export function mergeWorkspaceImportDraft(
  detected: WorkspaceImportDraft,
  parsed: ParsedImport | null,
  options: {
    retainParsedOnlyTasks?: boolean
    retainDetectedOnlyTasks?: boolean
    preserveDetectedScope?: boolean
  } = {},
): WorkspaceImportDraft {
  if (!parsed) return detected
  const retainParsedOnlyTasks = options.retainParsedOnlyTasks ?? true
  const retainDetectedOnlyTasks = options.retainDetectedOnlyTasks ?? true
  const preserveDetectedScope = options.preserveDetectedScope ?? false
  const parsedTasks = parsed.tasks

  const mergedGoals: DraftGoal[] = []
  const parsedGoalsById = new Map(parsed.goals.map(goal => [goal.id, goal] as const))
  const usedGoalIds = new Set<string>()
  for (const goal of detected.goals) {
    const parsedGoal = parsedGoalsById.get(goal.id)
    if (parsedGoal) {
      usedGoalIds.add(parsedGoal.id)
      mergedGoals.push({
        ...goal,
        id: parsedGoal.id,
        title: parsedGoal.title,
        rationale: parsedGoal.rationale || goal.rationale,
      })
      continue
    }
    mergedGoals.push(goal)
  }
  for (const goal of parsed.goals) {
    if (usedGoalIds.has(goal.id)) continue
    mergedGoals.push({
      id: goal.id,
      title: goal.title,
      rationale: goal.rationale,
      source: 'workspace-importer',
      confidence: 'medium',
    })
  }

  const mergedReleasesById = new Map<string, NonNullable<WorkspaceImportDraft['releases']>[number]>()
  for (const release of detected.releases ?? []) {
    mergedReleasesById.set(release.id, release)
  }
  for (const release of parsed.releases ?? []) {
    const existing = mergedReleasesById.get(release.id)
    mergedReleasesById.set(release.id, {
      id: release.id,
      label: release.label || existing?.label || releaseLabelFromId(release.id),
      source: existing?.source ?? 'workspace-importer',
      ...(existing?.references ? { references: [...existing.references] } : {}),
      confidence: existing?.confidence ?? 'medium',
    })
  }
  const mergedReleases = [...mergedReleasesById.values()]

  const mergedTasks: DraftTask[] = []
  const usedParsedTaskIds = new Set<string>()
  for (const task of detected.tasks) {
    // Task prose is presentation, not identity. A parsed task may refine a
    // detector task only when it preserves the detector's durable id. A
    // wording change without that link is a new candidate and must remain
    // visible instead of silently mutating an existing record.
    const parsedTask = parsedTasks.find(candidate =>
      candidate.id === task.suggestedId && !usedParsedTaskIds.has(candidate.id),
    )
    if (parsedTask) {
      usedParsedTaskIds.add(parsedTask.id)
      const resolvedDescription = preserveDetectedScope
        ? task.description || parsedTask.description
        : parsedTask.description || task.description
      const resolvedWhyThisMayMatter = preserveDetectedScope
        ? task.whyThisMayMatter || parsedTask.whyThisMayMatter
        : parsedTask.whyThisMayMatter || task.whyThisMayMatter
      const resolvedAssumptions = preserveDetectedScope
        ? task.assumptions?.length ? task.assumptions : parsedTask.assumptions
        : parsedTask.assumptions?.length ? parsedTask.assumptions : task.assumptions
      const resolvedMissingInformation = preserveDetectedScope
        ? task.missingInformation?.length ? task.missingInformation : parsedTask.missingInformation
        : parsedTask.missingInformation?.length ? parsedTask.missingInformation : task.missingInformation
      const resolvedAcceptanceCriteria = preserveDetectedScope
        ? task.acceptanceCriteria ?? parsedTask.acceptanceCriteria
        : parsedTask.acceptanceCriteria ?? task.acceptanceCriteria
      const resolvedDependsOn = preserveDetectedScope
        ? task.dependsOn ?? []
        : parsedTask.dependsOn ?? task.dependsOn
      const resolvedProofPaths = preserveDetectedScope
        ? task.proofPaths ?? parsedTask.proofPaths
        : parsedTask.proofPaths ?? task.proofPaths
      const resolvedContractNames = preserveDetectedScope
        ? task.contractNames ?? parsedTask.contractNames
        : parsedTask.contractNames ?? task.contractNames
      const resolvedParentAcceptanceCriterionIds = preserveDetectedScope
        ? task.parentAcceptanceCriterionIds ?? parsedTask.parentAcceptanceCriterionIds
        : parsedTask.parentAcceptanceCriterionIds ?? task.parentAcceptanceCriterionIds
      const mergedProofPaths = finalizeDraftTaskProofPaths({
        suggestedId: task.suggestedId,
        title: parsedTask.title,
        proofPaths: resolvedProofPaths,
      })
      const resolvedReleaseIds = preserveDetectedScope
        ? task.releaseIds ?? parsedTask.releaseIds
        : parsedTask.releaseIds ?? task.releaseIds
      const resolvedSourceClaims = [
        ...(task.sourceClaims ?? []),
        ...(parsedTask.sourceClaims ?? []),
      ]
      mergedTasks.push({
        ...task,
        suggestedId: task.suggestedId,
        title: parsedTask.title,
        ...(parsedTask.sourceIdentity || task.sourceIdentity
          ? { sourceIdentity: parsedTask.sourceIdentity ?? task.sourceIdentity }
          : {}),
        ...(parsedTask.deliverableName || task.deliverableName
          ? { deliverableName: parsedTask.deliverableName ?? task.deliverableName }
          : {}),
        ...(parsedTask.producedArtifact || task.producedArtifact
          ? { producedArtifact: parsedTask.producedArtifact ?? task.producedArtifact }
          : {}),
        ...(parsedTask.workShape || task.workShape
          ? { workShape: parsedTask.workShape ?? task.workShape }
          : {}),
        ...(parsedTask.statusHint || task.statusHint
          ? { statusHint: parsedTask.statusHint ?? task.statusHint }
          : {}),
        ...(parsedTask.targetArea || task.targetArea
          ? { targetArea: parsedTask.targetArea ?? task.targetArea }
          : {}),
        ...(parsedTask.buildsOn?.length || task.buildsOn?.length
          ? { buildsOn: [...(parsedTask.buildsOn ?? task.buildsOn ?? [])] }
          : {}),
        ...(parsedTask.consumerSurfaces?.length || task.consumerSurfaces?.length
          ? { consumerSurfaces: [...(parsedTask.consumerSurfaces ?? task.consumerSurfaces ?? [])] }
          : {}),
        ...(task.semanticKind || parsedTask.semanticKind
          ? { semanticKind: task.semanticKind ?? parsedTask.semanticKind }
          : {}),
        ...(resolvedContractNames?.length ? { contractNames: [...resolvedContractNames] } : {}),
        ...(resolvedParentAcceptanceCriterionIds?.length
          ? { parentAcceptanceCriterionIds: [...resolvedParentAcceptanceCriterionIds] }
          : {}),
        description: resolvedDescription,
        ...(resolvedWhyThisMayMatter ? { whyThisMayMatter: resolvedWhyThisMayMatter } : {}),
        ...(resolvedAssumptions && resolvedAssumptions.length > 0 ? { assumptions: [...resolvedAssumptions] } : {}),
        ...(resolvedMissingInformation && resolvedMissingInformation.length > 0 ? { missingInformation: [...resolvedMissingInformation] } : {}),
        domain: preserveDetectedScope ? task.domain || parsedTask.domain : parsedTask.domain || task.domain,
        scope: preserveDetectedScope
          ? task.scope
          : parsedTask.scope === 'later' ? 'later' : task.scope,
        priority: preserveDetectedScope ? task.priority || parsedTask.priority : parsedTask.priority || task.priority,
        references: mergeImportReferences(task.references, parsedTask.references),
        ...(resolvedReleaseIds ? { releaseIds: [...resolvedReleaseIds] } : {}),
        ...(resolvedAcceptanceCriteria ? { acceptanceCriteria: resolvedAcceptanceCriteria } : {}),
        ...(resolvedDependsOn ? { dependsOn: [...resolvedDependsOn] } : {}),
        ...(mergedProofPaths ? { proofPaths: mergedProofPaths } : {}),
        ...(resolvedSourceClaims.length > 0 ? { sourceClaims: dedupeImportSourceClaims(resolvedSourceClaims as unknown as NonNullable<Task['sourceClaims']>) } : {}),
      })
      continue
    }
    if (!retainDetectedOnlyTasks) {
      continue
    }
    mergedTasks.push(task)
  }
  for (const task of parsedTasks) {
    if (usedParsedTaskIds.has(task.id)) continue
    if (!retainParsedOnlyTasks) continue
    const proofPaths = finalizeDraftTaskProofPaths({
      suggestedId: task.id,
      title: task.title,
      proofPaths: task.proofPaths,
    })
    mergedTasks.push({
      suggestedId: task.id,
      title: task.title,
      ...(task.sourceIdentity ? { sourceIdentity: task.sourceIdentity } : {}),
      ...(task.deliverableName ? { deliverableName: task.deliverableName } : {}),
      ...(task.producedArtifact ? { producedArtifact: task.producedArtifact } : {}),
      ...(task.workShape ? { workShape: task.workShape } : {}),
      ...(task.statusHint ? { statusHint: task.statusHint } : {}),
      ...(task.targetArea ? { targetArea: task.targetArea } : {}),
      ...(task.buildsOn?.length ? { buildsOn: [...task.buildsOn] } : {}),
      ...(task.consumerSurfaces?.length ? { consumerSurfaces: [...task.consumerSurfaces] } : {}),
      ...(task.semanticKind ? { semanticKind: task.semanticKind } : {}),
      ...(task.contractNames?.length ? { contractNames: [...task.contractNames] } : {}),
      ...(task.parentAcceptanceCriterionIds?.length
        ? { parentAcceptanceCriterionIds: [...task.parentAcceptanceCriterionIds] }
        : {}),
      description: task.description,
      ...(task.whyThisMayMatter ? { whyThisMayMatter: task.whyThisMayMatter } : {}),
      ...(task.assumptions && task.assumptions.length > 0
        ? { assumptions: [...task.assumptions] }
        : {}),
      ...(task.missingInformation && task.missingInformation.length > 0
        ? { missingInformation: [...task.missingInformation] }
        : {}),
      domain: task.domain,
      scope: task.scope === 'later' ? 'later' : 'current',
      priority: task.priority,
      source: 'workspace-importer',
      ...(task.acceptanceCriteria ? { acceptanceCriteria: task.acceptanceCriteria } : {}),
      ...(task.dependsOn ? { dependsOn: [...task.dependsOn] } : {}),
      ...(proofPaths ? { proofPaths } : {}),
      ...(task.references.length > 0 ? { references: [...task.references] } : {}),
      ...(task.releaseIds && task.releaseIds.length > 0 ? { releaseIds: [...task.releaseIds] } : {}),
      ...(task.sourceClaims && task.sourceClaims.length > 0 ? { sourceClaims: [...task.sourceClaims] as Task['sourceClaims'] } : {}),
      confidence: 'medium',
    })
  }

  // Milestones have no source-owned identity in the legacy parser. Preserve
  // both records until an adapter supplies one; prose similarity must never
  // decide which history entry survives.
  const mergedMilestones: DraftMilestone[] = [
    ...detected.milestones,
    ...parsed.milestones.map(milestone => ({
      title: milestone.title,
      evidence: milestone.evidence,
      source: 'workspace-importer' as const,
    })),
  ]

  return {
    goals: mergedGoals,
    ...(mergedReleases.length > 0 ? { releases: mergedReleases } : {}),
    tasks: mergedTasks,
    milestones: mergedMilestones,
    context: [...detected.context],
    stats: detected.stats,
  }
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

function absoluteImportedReferences(
  refs: readonly string[],
  workspaceProjectPath: string,
): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const ref of refs) {
    const absolute = absoluteImportedReference(ref, workspaceProjectPath)
    if (!absolute || seen.has(absolute)) continue
    seen.add(absolute)
    normalized.push(absolute)
  }
  return normalized
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
  const releases: ParsedRelease[] = []
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
        const scope = t['scope'] === 'later' ? 'later' : 'current'
        const rawPriority = t['priority']
        const priority =
          typeof rawPriority === 'string' && PRIORITIES.has(rawPriority as TaskPriority)
            ? (rawPriority as TaskPriority)
            : 'normal'
        if (!id || !title) continue
        tasks.push({
          id,
          title,
          ...(typeof t['sourceIdentity'] === 'string' && t['sourceIdentity'].trim() ? { sourceIdentity: t['sourceIdentity'].trim() } : {}),
          ...(typeof t['deliverableName'] === 'string' && t['deliverableName'].trim() ? { deliverableName: t['deliverableName'].trim() } : {}),
          ...(typeof t['producedArtifact'] === 'string' && t['producedArtifact'].trim() ? { producedArtifact: t['producedArtifact'].trim() } : {}),
          ...(parseEvidenceWorkShape(t['workShape']) ? { workShape: parseEvidenceWorkShape(t['workShape']) } : {}),
          ...(parseEvidenceStatusHint(t['statusHint']) ? { statusHint: parseEvidenceStatusHint(t['statusHint']) } : {}),
          ...(typeof t['targetArea'] === 'string' && t['targetArea'].trim() ? { targetArea: t['targetArea'].trim() } : {}),
          ...(normStringList(t['buildsOn']).length > 0 ? { buildsOn: normStringList(t['buildsOn']) } : {}),
          ...(normStringList(t['consumerSurfaces']).length > 0 ? { consumerSurfaces: normStringList(t['consumerSurfaces']) } : {}),
          ...(typeof t['semanticKind'] === 'string' && t['semanticKind'].trim() ? { semanticKind: t['semanticKind'].trim() } : {}),
          ...(normStringList(t['contractNames']).length > 0 ? { contractNames: normStringList(t['contractNames']) } : {}),
          ...(normStringList(t['parentAcceptanceCriterionIds']).length > 0
            ? { parentAcceptanceCriterionIds: normStringList(t['parentAcceptanceCriterionIds']) }
            : {}),
          description: supportingText(title, rawDescription),
          ...(whyThisMayMatter ? { whyThisMayMatter } : {}),
          ...(normStringList(t['assumptions']).length > 0 ? { assumptions: normStringList(t['assumptions']) } : {}),
          ...(normStringList(t['missingInformation']).length > 0 ? { missingInformation: normStringList(t['missingInformation']) } : {}),
          domain,
          scope,
          priority,
          references: normStringList(t['references']),
          ...(normStringList(t['releaseIds']).length > 0
            ? { releaseIds: normStringList(t['releaseIds']) }
            : {}),
          ...(parseImportedAcceptanceCriteria(t['acceptanceCriteria'])
            ? { acceptanceCriteria: parseImportedAcceptanceCriteria(t['acceptanceCriteria']) }
            : {}),
          ...(parseImportedDependsOn(t['dependsOn']).length > 0
            ? { dependsOn: parseImportedDependsOn(t['dependsOn']) }
            : {}),
          ...(parseImportedProofPaths(t['proofPaths']).length > 0
            ? { proofPaths: parseImportedProofPaths(t['proofPaths']) }
            : {}),
        } as unknown as ParsedTask)
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
    if (Array.isArray(obj['releases'])) {
      for (const raw of obj['releases']) {
        if (!raw || typeof raw !== 'object') continue
        const release = raw as Record<string, unknown>
        const id = typeof release['id'] === 'string' ? release['id'].trim() : ''
        const label = typeof release['label'] === 'string' ? release['label'].trim() : ''
        if (!id || !label) continue
        const source = typeof release['source'] === 'string'
          ? release['source'].trim()
          : undefined
        const state = parseProjectReleaseState(release['state'])
        releases.push({
          id,
          label,
          ...(source ? { source: source as ProjectRelease['source'] } : {}),
          ...(state ? { state } : {}),
        })
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
        const scope = t['scope'] === 'later' ? 'later' : 'current'
        const rawPriority = t['priority']
        const priority =
          typeof rawPriority === 'string' && PRIORITIES.has(rawPriority as TaskPriority)
            ? (rawPriority as TaskPriority)
            : 'normal'
        if (!id || !title) continue
        tasks.push({
          id,
          title,
          ...(typeof t['sourceIdentity'] === 'string' && t['sourceIdentity'].trim() ? { sourceIdentity: t['sourceIdentity'].trim() } : {}),
          ...(typeof t['deliverableName'] === 'string' && t['deliverableName'].trim() ? { deliverableName: t['deliverableName'].trim() } : {}),
          ...(typeof t['producedArtifact'] === 'string' && t['producedArtifact'].trim() ? { producedArtifact: t['producedArtifact'].trim() } : {}),
          ...(parseEvidenceWorkShape(t['workShape']) ? { workShape: parseEvidenceWorkShape(t['workShape']) } : {}),
          ...(parseEvidenceStatusHint(t['statusHint']) ? { statusHint: parseEvidenceStatusHint(t['statusHint']) } : {}),
          ...(typeof t['targetArea'] === 'string' && t['targetArea'].trim() ? { targetArea: t['targetArea'].trim() } : {}),
          ...(normStringList(t['buildsOn']).length > 0 ? { buildsOn: normStringList(t['buildsOn']) } : {}),
          ...(normStringList(t['consumerSurfaces']).length > 0 ? { consumerSurfaces: normStringList(t['consumerSurfaces']) } : {}),
          ...(typeof t['semanticKind'] === 'string' && t['semanticKind'].trim() ? { semanticKind: t['semanticKind'].trim() } : {}),
          ...(normStringList(t['contractNames']).length > 0 ? { contractNames: normStringList(t['contractNames']) } : {}),
          ...(normStringList(t['parentAcceptanceCriterionIds']).length > 0
            ? { parentAcceptanceCriterionIds: normStringList(t['parentAcceptanceCriterionIds']) }
            : {}),
          description: supportingText(title, rawDescription),
          ...(whyThisMayMatter ? { whyThisMayMatter } : {}),
          ...(normStringList(t['assumptions']).length > 0 ? { assumptions: normStringList(t['assumptions']) } : {}),
          ...(normStringList(t['missingInformation']).length > 0 ? { missingInformation: normStringList(t['missingInformation']) } : {}),
          domain,
          scope,
          priority,
          references: normStringList(t['references']),
          ...(normStringList(t['releaseIds']).length > 0
            ? { releaseIds: normStringList(t['releaseIds']) }
            : {}),
          ...(parseImportedAcceptanceCriteria(t['acceptanceCriteria'])
            ? { acceptanceCriteria: parseImportedAcceptanceCriteria(t['acceptanceCriteria']) }
            : {}),
          ...(parseImportedDependsOn(t['dependsOn']).length > 0
            ? { dependsOn: parseImportedDependsOn(t['dependsOn']) }
            : {}),
          ...(parseImportedProofPaths(t['proofPaths']).length > 0
            ? { proofPaths: parseImportedProofPaths(t['proofPaths']) }
            : {}),
        } as unknown as ParsedTask)
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

  return { goals, ...(releases.length > 0 ? { releases } : {}), tasks, milestones }
}

export function summarizeWorkspaceImportSpec(spec: string): WorkspaceImportScopeSnapshot {
  let goalCount = 0
  let taskCount = 0
  let milestoneCount = 0
  let currentTaskCount = 0
  let laterTaskCount = 0
  const taskIds: string[] = []
  const currentTaskIds: string[] = []
  const laterTaskIds: string[] = []

  for (const obj of iterateYamlFences(spec)) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue
    const record = obj as Record<string, unknown>
    if (Array.isArray(record.goals)) {
      goalCount += record.goals.filter(Boolean).length
    }
    if (Array.isArray(record.tasks)) {
      const tasks = record.tasks.filter((task): task is Record<string, unknown> => Boolean(task) && typeof task === 'object')
      taskCount += tasks.length
      for (const task of tasks) {
        const id = typeof task.id === 'string' ? task.id.trim() : ''
        if (id) taskIds.push(id)
        if (task.scope === 'later') {
          laterTaskCount++
          if (id) laterTaskIds.push(id)
        } else {
          currentTaskCount++
          if (id) currentTaskIds.push(id)
        }
      }
    }
    if (Array.isArray(record.milestones)) {
      milestoneCount += record.milestones.filter(Boolean).length
    }
  }

  return {
    goalCount,
    taskCount,
    milestoneCount,
    currentTaskCount,
    laterTaskCount,
    taskIds,
    currentTaskIds,
    laterTaskIds,
  }
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
  if (draft.releases && draft.releases.length > 0) {
    lines.push('```yaml')
    lines.push('releases:')
    for (const release of draft.releases) {
      lines.push(`  - id: ${escape(release.id)}`)
      lines.push(`    label: ${escape(release.label)}`)
      lines.push('    source: release_plan')
      lines.push(`    state: ${release.scope === 'later' ? 'planned' : 'active'}`)
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
      if (t.sourceIdentity) lines.push(`    sourceIdentity: ${escape(t.sourceIdentity)}`)
      if (t.deliverableName) lines.push(`    deliverableName: ${escape(t.deliverableName)}`)
      if (t.producedArtifact) lines.push(`    producedArtifact: ${escape(t.producedArtifact)}`)
      if (t.workShape) lines.push(`    workShape: ${t.workShape}`)
      if (t.statusHint) lines.push(`    statusHint: ${t.statusHint}`)
      if (t.targetArea) lines.push(`    targetArea: ${escape(t.targetArea)}`)
      if (t.buildsOn?.length) lines.push(`    buildsOn: ${JSON.stringify([...t.buildsOn])}`)
      if (t.consumerSurfaces?.length) lines.push(`    consumerSurfaces: ${JSON.stringify([...t.consumerSurfaces])}`)
      if (t.semanticKind) lines.push(`    semanticKind: ${escape(t.semanticKind)}`)
      if (t.contractNames?.length) lines.push(`    contractNames: ${JSON.stringify([...t.contractNames])}`)
      if (t.parentAcceptanceCriterionIds?.length) {
        lines.push(`    parentAcceptanceCriterionIds: ${JSON.stringify([...t.parentAcceptanceCriterionIds])}`)
      }
      lines.push(`    description: ${escape(t.description || '')}`)
      if (t.whyThisMayMatter) lines.push(`    whyThisMayMatter: ${escape(t.whyThisMayMatter)}`)
      lines.push(`    domain: ${escape(t.domain || 'core')}`)
      if (t.scope === 'later') lines.push('    scope: later')
      lines.push(`    priority: ${t.priority}`)
      if (t.assumptions && t.assumptions.length > 0) {
        lines.push('    assumptions:')
        for (const assumption of t.assumptions) lines.push(`      - ${escape(assumption)}`)
      }
      if (t.missingInformation && t.missingInformation.length > 0) {
        lines.push('    missingInformation:')
        for (const missing of t.missingInformation) lines.push(`      - ${escape(missing)}`)
      }
      if (t.acceptanceCriteria && t.acceptanceCriteria.length > 0) {
        lines.push('    acceptanceCriteria:')
        for (const criterion of t.acceptanceCriteria) {
          lines.push(`      - id: ${escape(criterion.id)}`)
          lines.push(`        description: ${escape(criterion.description)}`)
          if (criterion.scenario) lines.push(`        scenario: ${escape(criterion.scenario)}`)
          if (criterion.expectation) lines.push(`        expectation: ${escape(criterion.expectation)}`)
          if (criterion.verifiedBy) lines.push(`        verifiedBy: ${escape(criterion.verifiedBy)}`)
          if (criterion.command) lines.push(`        command: ${escape(criterion.command)}`)
          if (criterion.expectedExit) lines.push(`        expectedExit: ${criterion.expectedExit}`)
          if (criterion.expectedOutputIncludes?.length) {
            lines.push(`        expectedOutputIncludes: ${escape(JSON.stringify(criterion.expectedOutputIncludes))}`)
          }
          if (criterion.evidenceHint) lines.push(`        evidenceHint: ${escape(criterion.evidenceHint)}`)
          if (criterion.negativeCase) lines.push(`        negativeCase: ${escape(criterion.negativeCase)}`)
        }
      }
      if (t.dependsOn && t.dependsOn.length > 0) {
        lines.push('    dependsOn:')
        for (const dependency of t.dependsOn) lines.push(`      - ${escape(dependency)}`)
      }
      if (t.releaseIds && t.releaseIds.length > 0) {
        lines.push('    releaseIds:')
        for (const releaseId of t.releaseIds) lines.push(`      - ${escape(releaseId)}`)
      }
      if (t.proofPaths && t.proofPaths.length > 0) {
        lines.push('    proofPaths:')
        for (const proofPath of t.proofPaths) {
          const yaml = serializeInlineYamlValue(proofPath, 6)
          if (yaml.length === 0) continue
          lines.push(`      - ${yaml[0]}`)
          for (const extra of yaml.slice(1)) lines.push(extra)
        }
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

function parsedImportFromDraft(draft: WorkspaceImportDraft): ParsedImport {
  return {
    goals: draft.goals.map(goal => ({
      id: goal.id,
      title: goal.title,
      rationale: goal.rationale,
    })),
    ...(draft.releases?.length
      ? {
          releases: draft.releases.map(release => ({
            id: release.id,
            label: release.label,
            source: 'release_plan' as const,
            state: release.scope === 'later' ? 'planned' as const : 'active' as const,
          })),
        }
      : {}),
    tasks: draft.tasks.map(task => ({
      id: task.suggestedId,
      title: task.title,
      ...(task.sourceIdentity ? { sourceIdentity: task.sourceIdentity } : {}),
      ...(task.deliverableName ? { deliverableName: task.deliverableName } : {}),
      ...(task.producedArtifact ? { producedArtifact: task.producedArtifact } : {}),
      ...(task.workShape ? { workShape: task.workShape } : {}),
      ...(task.statusHint ? { statusHint: task.statusHint } : {}),
      ...(task.targetArea ? { targetArea: task.targetArea } : {}),
      ...(task.buildsOn?.length ? { buildsOn: [...task.buildsOn] } : {}),
      ...(task.consumerSurfaces?.length ? { consumerSurfaces: [...task.consumerSurfaces] } : {}),
      ...(task.semanticKind ? { semanticKind: task.semanticKind } : {}),
      ...(task.contractNames?.length ? { contractNames: [...task.contractNames] } : {}),
      ...(task.parentAcceptanceCriterionIds?.length
        ? { parentAcceptanceCriterionIds: [...task.parentAcceptanceCriterionIds] }
        : {}),
      description: task.description,
      ...(task.whyThisMayMatter ? { whyThisMayMatter: task.whyThisMayMatter } : {}),
      ...(task.assumptions?.length ? { assumptions: [...task.assumptions] } : {}),
      ...(task.missingInformation?.length ? { missingInformation: [...task.missingInformation] } : {}),
      domain: task.domain,
      ...(task.scope === 'later' ? { scope: 'later' as const } : {}),
      priority: task.priority,
      references: [...(task.references ?? [])],
      ...(task.releaseIds?.length ? { releaseIds: [...task.releaseIds] } : {}),
      ...(task.sourceClaims?.length ? { sourceClaims: [...task.sourceClaims] as Task['sourceClaims'] } : {}),
      ...(task.acceptanceCriteria ? { acceptanceCriteria: [...task.acceptanceCriteria] } : {}),
      ...(task.dependsOn ? { dependsOn: [...task.dependsOn] } : {}),
      ...(task.proofPaths ? { proofPaths: [...task.proofPaths] } : {}),
    })),
    milestones: draft.milestones.map(milestone => ({
      title: milestone.title,
      evidence: milestone.evidence,
    })),
  }
}

function formatParsedImportAsSpec(parsed: ParsedImport): string {
  return formatDetectedDraftAsSpec(mergeWorkspaceImportDraft({
    goals: [],
    tasks: [],
    milestones: [],
    context: [],
    stats: {
      inputSignals: 0,
      drafted: parsed.goals.length + parsed.tasks.length + parsed.milestones.length,
      deduped: 0,
    },
  }, parsed))
}

function normalizeParsedImportForSpec(
  parsed: ParsedImport,
  workspaceProjectPath: string,
): ParsedImport {
  return {
    goals: parsed.goals.map(goal => ({ ...goal })),
    ...(parsed.releases?.length
      ? { releases: parsed.releases.map(release => ({ ...release })) }
      : {}),
    tasks: parsed.tasks.map(task => ({
      ...task,
      ...(task.missingInformation?.length
        ? { missingInformation: cleanImportedMissingInformation(task.missingInformation) }
        : {}),
      references: task.references.map(reference =>
        normalizeImportedReferenceForTask(reference, workspaceProjectPath, workspaceProjectPath),
      ),
    })),
    milestones: parsed.milestones.map(milestone => ({ ...milestone })),
  }
}

function serializeInlineYamlValue(value: unknown, _indent: number): string[] {
  if (typeof value === 'string') return [JSON.stringify(value)]
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value) || (value && typeof value === 'object')) return [JSON.stringify(value)]
  return ['null']
}

export interface ApproveWorkspaceImportInput {
  memoryDir: string
  projectPath: string
  coordinatorProjectPaths?: Record<string, string>
  draftOverride?: WorkspaceImportDraft
  detectedDraftSnapshot?: WorkspaceImportDraft
  replacePreviouslyImportedTasks?: boolean
}

export interface ApproveWorkspaceImportResult {
  success: boolean
  tasksAdded?: number
  goalsRecorded?: number
  milestonesLogged?: number
  error?: string
}

const WORKSPACE_GOALS_FILE = 'workspace-goals.json'
export const WORKSPACE_GOALS_STRUCTURAL_VERSION = 4

export interface WorkspaceImportScopeSnapshot {
  goalCount: number
  taskCount: number
  milestoneCount: number
  currentTaskCount: number
  laterTaskCount: number
  taskIds: string[]
  currentTaskIds: string[]
  laterTaskIds: string[]
}

export interface WorkspaceGoalsState {
  version: number
  recordedAt: string
  goals: ParsedGoal[]
  releases?: ParsedRelease[]
  tasks: ParsedTask[]
  milestones: ParsedMilestone[]
  /** Small source-backed records retained after transient import review ends. */
  documentedStructure: OrientationWorkspaceImportDraftContext[]
  /** @deprecated Temporary scan material. New writes always leave this empty. */
  context: DraftContext[]
  approved: WorkspaceImportScopeSnapshot
  detected: WorkspaceImportScopeSnapshot | null
  scopeMembershipHydrated?: boolean
  dismissed?: boolean
  dismissedAt?: string
}

export interface WorkspaceImportSummary {
  taskStatus: string | null
  specPresent: boolean
  approved: WorkspaceImportScopeSnapshot | null
  detected: WorkspaceImportScopeSnapshot | null
}

export function workspaceGoalsNeedStructuralRefresh(state: WorkspaceGoalsState | null | undefined): boolean {
  if (!state) return false
  const hasStructuralContext = state.documentedStructure.length > 0 || state.context.some(context =>
    context.role === 'brief_input' || context.role === 'capability',
  )
  if (!hasStructuralContext) return false
  if (state.scopeMembershipHydrated) return true
  if (state.version < WORKSPACE_GOALS_STRUCTURAL_VERSION) return true
  return false
}

/**
 * Return the one approved import record used by scope/readiness consumers.
 * The durable workspace snapshot is newer than the reserved task spec after
 * an approved refresh; the spec remains a compatibility fallback for older
 * projects that have no usable snapshot yet.
 */
export function canonicalApprovedWorkspaceImport(
  state: WorkspaceGoalsState | null | undefined,
  spec: string,
): ParsedImport | null {
  if (
    state &&
    state.version >= WORKSPACE_GOALS_STRUCTURAL_VERSION &&
    !workspaceGoalsNeedStructuralRefresh(state) &&
    (state.goals.length > 0 || state.tasks.length > 0 || state.milestones.length > 0)
  ) {
    return {
      goals: [...state.goals],
      ...(state.releases ? { releases: [...state.releases] } : {}),
      tasks: [...state.tasks],
      milestones: [...state.milestones],
    }
  }
  return spec.trim() ? parseWorkspaceImport(spec) : null
}

export async function materializeParsedWorkspaceImport(input: {
  memoryDir: string
  projectPath: string
  parsed: ParsedImport
}): Promise<ParsedImport> {
  const queue = await readQueue(input.memoryDir).catch((err: unknown) => {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: unknown }).code === 'ENOENT'
    ) {
      return {
        version: 1,
        lastUpdated: new Date(0).toISOString(),
        tasks: [],
      } satisfies TaskQueue
    }
    throw err
  })
  const tasks = await materializeEvidenceWorkGraphTasks({
    projectPath: input.projectPath,
    queue,
    parsedTasks: input.parsed.tasks,
  })
  const enrichedTasks = tasks.map((task) => {
    // Evidence readers accept relative references, while proof-command
    // discovery also needs to walk up to the project's package.json. Keep the
    // persisted references unchanged, but give the materializer an absolute
    // view for this source-backed derivation.
    const proofTask: MaterializedImportTask = {
      ...task,
      references: absoluteImportedReferences(task.references, input.projectPath),
    }
    const evidenceDetail = extractReferenceEvidenceDetail(proofTask, input.projectPath)
    return {
      ...task,
      acceptanceCriteria: materializedAcceptanceCriteria(proofTask, evidenceDetail).map((criterion) => ({
        id: criterion.id,
        description: criterion.description,
        ...(criterion.scenario ? { scenario: criterion.scenario } : {}),
        ...(criterion.expectation ? { expectation: criterion.expectation } : {}),
        verifiedBy: criterion.verifiedBy,
        source: criterion.source,
        ...(criterion.command ? { command: criterion.command } : {}),
        ...(criterion.expectedExit ? { expectedExit: criterion.expectedExit } : {}),
        ...(criterion.expectedOutputIncludes?.length ? { expectedOutputIncludes: criterion.expectedOutputIncludes } : {}),
        ...(criterion.evidenceHint ? { evidenceHint: criterion.evidenceHint } : {}),
        ...(criterion.negativeCase ? { negativeCase: criterion.negativeCase } : {}),
      })),
      proofPaths: materializedProofPaths(proofTask, evidenceDetail),
    }
  })
  return {
    goals: [...input.parsed.goals],
    ...(input.parsed.releases?.length ? { releases: [...input.parsed.releases] } : {}),
    tasks: enrichedTasks,
    milestones: [...input.parsed.milestones],
  }
}

export async function materializeWorkspaceImportDraft(input: {
  memoryDir: string
  projectPath: string
  draft: WorkspaceImportDraft
}): Promise<WorkspaceImportDraft> {
  const parsed = parsedImportFromDraft(input.draft)
  const materialized = await materializeParsedWorkspaceImport({
    memoryDir: input.memoryDir,
    projectPath: input.projectPath,
    parsed,
  })
  return mergeWorkspaceImportDraft(input.draft, materialized, {
    preserveDetectedScope: false,
    retainDetectedOnlyTasks: false,
  })
}

function workspaceScopeSnapshotFromParsed(parsed: ParsedImport): WorkspaceImportScopeSnapshot {
  const taskIds = parsed.tasks
    .map(task => task.id.trim())
    .filter(Boolean)
  const currentTaskIds = parsed.tasks
    .filter(task => task.scope !== 'later')
    .map(task => task.id.trim())
    .filter(Boolean)
  const laterTaskIds = parsed.tasks
    .filter(task => task.scope === 'later')
    .map(task => task.id.trim())
    .filter(Boolean)
  return {
    goalCount: parsed.goals.length,
    taskCount: parsed.tasks.length,
    milestoneCount: parsed.milestones.length,
    currentTaskCount: currentTaskIds.length,
    laterTaskCount: laterTaskIds.length,
    taskIds,
    currentTaskIds,
    laterTaskIds,
  }
}

function workspaceScopeSnapshotFromDraft(draft: WorkspaceImportDraft): WorkspaceImportScopeSnapshot {
  const taskIds = draft.tasks
    .map(task => task.suggestedId.trim())
    .filter(Boolean)
  const currentTaskIds = draft.tasks
    .filter(task => task.scope !== 'later')
    .map(task => task.suggestedId.trim())
    .filter(Boolean)
  const laterTaskIds = draft.tasks
    .filter(task => task.scope === 'later')
    .map(task => task.suggestedId.trim())
    .filter(Boolean)
  return {
    goalCount: draft.goals.length,
    taskCount: draft.tasks.length,
    milestoneCount: draft.milestones.length,
    currentTaskCount: currentTaskIds.length,
    laterTaskCount: laterTaskIds.length,
    taskIds,
    currentTaskIds,
    laterTaskIds,
  }
}

function isDraftContext(raw: unknown): raw is DraftContext {
  return Boolean(raw) &&
    typeof raw === 'object' &&
    typeof (raw as DraftContext).label === 'string' &&
    typeof (raw as DraftContext).excerpt === 'string' &&
    typeof (raw as DraftContext).source === 'string'
}

export function parseWorkspaceGoalsState(raw: unknown): WorkspaceGoalsState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const dismissed = record.dismissed === true
  const recordedAt = typeof record.recordedAt === 'string' ? record.recordedAt : new Date(0).toISOString()
  const goals = Array.isArray(record.goals) ? record.goals.filter((goal): goal is ParsedGoal => {
    return Boolean(goal) && typeof goal === 'object'
      && typeof (goal as ParsedGoal).id === 'string'
      && typeof (goal as ParsedGoal).title === 'string'
      && typeof (goal as ParsedGoal).rationale === 'string'
  }) : []
  const tasks = Array.isArray(record.tasks) ? record.tasks.filter((task): task is ParsedTask => {
    return Boolean(task) && typeof task === 'object'
      && typeof (task as ParsedTask).id === 'string'
      && typeof (task as ParsedTask).title === 'string'
      && typeof (task as ParsedTask).description === 'string'
      && typeof (task as ParsedTask).domain === 'string'
      && typeof (task as ParsedTask).priority === 'string'
      && Array.isArray((task as ParsedTask).references)
  }) : []
  const releases = Array.isArray(record.releases) ? record.releases.filter((release): release is ParsedRelease => {
    return Boolean(release) && typeof release === 'object'
      && typeof (release as ParsedRelease).id === 'string'
      && typeof (release as ParsedRelease).label === 'string'
  }) : []
  const milestones = Array.isArray(record.milestones) ? record.milestones.filter((milestone): milestone is ParsedMilestone => {
    return Boolean(milestone) && typeof milestone === 'object'
      && typeof (milestone as ParsedMilestone).title === 'string'
      && typeof (milestone as ParsedMilestone).evidence === 'string'
  }) : []
  const context = Array.isArray(record.context)
    ? record.context.filter(isDraftContext).map((entry) => ({
        label: entry.label,
        excerpt: entry.excerpt,
        source: entry.source,
        ...(entry.references ? { references: [...entry.references] } : {}),
        ...(entry.domain ? { domain: entry.domain } : {}),
        ...(entry.role ? { role: entry.role } : {}),
        ...(entry.structure ? { structure: entry.structure } : {}),
        ...(entry.scopeHint ? { scopeHint: entry.scopeHint } : {}),
        ...(Array.isArray(entry.releaseIds) ? { releaseIds: [...entry.releaseIds] } : {}),
        ...(entry.linkedTaskHints ? { linkedTaskHints: [...entry.linkedTaskHints] } : {}),
      }))
    : []
  const documentedStructure = Array.isArray(record.documentedStructure)
    ? record.documentedStructure.filter(isOrientationStructuralContext).map(copyOrientationStructuralContext)
    : documentedStructuralContextsForProjection(context)
  const parsedSnapshot = workspaceScopeSnapshotFromParsed({ goals, tasks, milestones })
  const approvedSnapshot = parseWorkspaceScopeSnapshot(record.approved)
  const detectedSnapshot = parseWorkspaceScopeSnapshot(record.detected)
  const scopeMembershipHydrated = scopeSnapshotNeedsMembershipHydration(approvedSnapshot) ||
    scopeSnapshotNeedsMembershipHydration(detectedSnapshot)
  const approved = hydrateWorkspaceScopeSnapshot(
    approvedSnapshot ?? parsedSnapshot,
    parsedSnapshot,
  )
  const detected = hydrateWorkspaceScopeSnapshot(
    detectedSnapshot,
    parsedSnapshot,
  )
  return {
    version: typeof record.version === 'number' ? record.version : 1,
    recordedAt,
    goals,
    ...(releases.length > 0 ? { releases } : {}),
    tasks,
    milestones,
    documentedStructure,
    context,
    approved: approved ?? parsedSnapshot,
    detected,
    ...(scopeMembershipHydrated ? { scopeMembershipHydrated: true } : {}),
    ...(dismissed ? { dismissed: true } : {}),
    ...(typeof record.dismissedAt === 'string' ? { dismissedAt: record.dismissedAt } : {}),
  }
}

function isOrientationStructuralContext(raw: unknown): raw is OrientationWorkspaceImportDraftContext {
  return Boolean(raw) && typeof raw === 'object' &&
    typeof (raw as OrientationWorkspaceImportDraftContext).id === 'string' &&
    typeof (raw as OrientationWorkspaceImportDraftContext).title === 'string' &&
    typeof (raw as OrientationWorkspaceImportDraftContext).description === 'string' &&
    (raw as OrientationWorkspaceImportDraftContext).role === 'capability' &&
    (raw as OrientationWorkspaceImportDraftContext).structure === 'record'
}

function copyOrientationStructuralContext(context: OrientationWorkspaceImportDraftContext): OrientationWorkspaceImportDraftContext {
  return {
    ...context,
    ...(context.refs ? { refs: [...context.refs] } : {}),
    ...(context.releaseIds ? { releaseIds: [...context.releaseIds] } : {}),
    ...(context.linkedTaskHints ? { linkedTaskHints: [...context.linkedTaskHints] } : {}),
  }
}

function stableStructuralContextId(context: Pick<DraftContext, 'label' | 'source' | 'references'>): string {
  const key = [context.source, context.label, ...(context.references ?? []).slice().sort()].join('\n')
  let hash = 2166136261
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `import-structure-${(hash >>> 0).toString(36)}`
}

/**
 * Intake scans can be large, but the project skeleton is not. Retain only
 * explicit durable capability records, never the detector's prose fragments.
 */
export function documentedStructuralContextsForProjection(
  contexts: readonly DraftContext[],
): OrientationWorkspaceImportDraftContext[] {
  return contexts
    .filter(context => context.role === 'capability' && context.structure === 'record')
    .map(context => ({
      id: stableStructuralContextId(context),
      title: context.label,
      description: context.excerpt,
      ...(context.domain ? { domain: context.domain } : {}),
      ...(context.references?.length ? { refs: [...context.references] } : {}),
      role: 'capability' as const,
      structure: 'record' as const,
      ...(context.scopeHint ? { scopeHint: context.scopeHint } : {}),
      ...(context.releaseIds?.length ? { releaseIds: [...context.releaseIds] } : {}),
      ...(context.linkedTaskHints?.length ? { linkedTaskHints: [...context.linkedTaskHints] } : {}),
    }))
}

async function recordWorkspaceStructuralSnapshot(input: {
  memoryDir: string
  documentedStructure: readonly OrientationWorkspaceImportDraftContext[]
  recordedAt: string
  dismissed: boolean
}): Promise<void> {
  const current = await readWorkspaceGoalsState(input.memoryDir)
  const emptySnapshot: WorkspaceImportScopeSnapshot = {
    goalCount: 0,
    taskCount: 0,
    milestoneCount: 0,
    currentTaskCount: 0,
    laterTaskCount: 0,
    taskIds: [],
    currentTaskIds: [],
    laterTaskIds: [],
  }
  const next: WorkspaceGoalsState = {
    version: WORKSPACE_GOALS_STRUCTURAL_VERSION,
    recordedAt: input.recordedAt,
    goals: current?.goals ?? [],
    ...(current?.releases?.length ? { releases: current.releases } : {}),
    tasks: current?.tasks ?? [],
    milestones: current?.milestones ?? [],
    documentedStructure: input.documentedStructure.map(copyOrientationStructuralContext),
    context: [],
    approved: current?.approved ?? emptySnapshot,
    detected: current?.detected ?? null,
    ...(input.dismissed ? { dismissed: true, dismissedAt: input.recordedAt } : {}),
  }
  await writeManagedTextFile(
    workspaceImportStatePath(input.memoryDir, WORKSPACE_GOALS_FILE),
    JSON.stringify(next, null, 2),
    'utf-8',
  )
}

export async function dismissWorkspaceImportState(input: {
  memoryDir: string
}): Promise<void> {
  const current = await readWorkspaceGoalsState(input.memoryDir)
  await recordWorkspaceStructuralSnapshot({
    memoryDir: input.memoryDir,
    documentedStructure: current?.documentedStructure ?? [],
    recordedAt: new Date().toISOString(),
    dismissed: true,
  })
}

function scopeSnapshotNeedsMembershipHydration(
  snapshot: WorkspaceImportScopeSnapshot | null,
): boolean {
  if (!snapshot || snapshot.taskCount === 0) return false
  return snapshot.currentTaskIds.length === 0 &&
    snapshot.laterTaskIds.length === 0 &&
    (snapshot.currentTaskCount > 0 || snapshot.laterTaskCount > 0 || snapshot.taskIds.length > 0)
}

function hydrateWorkspaceScopeSnapshot(
  snapshot: WorkspaceImportScopeSnapshot | null,
  fallback: WorkspaceImportScopeSnapshot,
): WorkspaceImportScopeSnapshot | null {
  if (!snapshot) return null
  const currentTaskIds = snapshot.currentTaskIds.length > 0
    ? snapshot.currentTaskIds
    : fallback.currentTaskIds
  const laterTaskIds = snapshot.laterTaskIds.length > 0
    ? snapshot.laterTaskIds
    : fallback.laterTaskIds
  return {
    ...snapshot,
    taskIds: snapshot.taskIds.length > 0 ? snapshot.taskIds : fallback.taskIds,
    currentTaskIds,
    laterTaskIds,
    currentTaskCount: currentTaskIds.length,
    laterTaskCount: laterTaskIds.length,
  }
}

function parseWorkspaceScopeSnapshot(raw: unknown): WorkspaceImportScopeSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const snapshot = raw as Record<string, unknown>
  const taskIds = Array.isArray(snapshot.taskIds)
    ? snapshot.taskIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  const currentTaskIds = Array.isArray(snapshot.currentTaskIds)
    ? snapshot.currentTaskIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  const laterTaskIds = Array.isArray(snapshot.laterTaskIds)
    ? snapshot.laterTaskIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  const goalCount = typeof snapshot.goalCount === 'number' ? snapshot.goalCount : null
  const taskCount = typeof snapshot.taskCount === 'number' ? snapshot.taskCount : null
  const milestoneCount = typeof snapshot.milestoneCount === 'number' ? snapshot.milestoneCount : null
  const currentTaskCount = typeof snapshot.currentTaskCount === 'number' ? snapshot.currentTaskCount : null
  const laterTaskCount = typeof snapshot.laterTaskCount === 'number' ? snapshot.laterTaskCount : null
  if (
    goalCount === null ||
    taskCount === null ||
    milestoneCount === null ||
    currentTaskCount === null ||
    laterTaskCount === null
  ) {
    return null
  }
  return {
    goalCount,
    taskCount,
    milestoneCount,
    currentTaskCount,
    laterTaskCount,
    taskIds,
    currentTaskIds,
    laterTaskIds,
  }
}

export async function readWorkspaceGoalsState(memoryDir: string): Promise<WorkspaceGoalsState | null> {
  const goalsPath = workspaceImportStatePath(memoryDir, WORKSPACE_GOALS_FILE)
  try {
    const raw = JSON.parse(await readManagedTextFile(goalsPath, 'utf-8')) as unknown
    return parseWorkspaceGoalsState(raw)
  } catch {
    return null
  }
}

export function readWorkspaceGoalsStateSync(memoryDir: string): WorkspaceGoalsState | null {
  const goalsPath = workspaceImportStatePath(memoryDir, WORKSPACE_GOALS_FILE)
  try {
    const raw = JSON.parse(readManagedTextFileSync(goalsPath, 'utf-8')) as unknown
    return parseWorkspaceGoalsState(raw)
  } catch {
    return null
  }
}

export async function readWorkspaceImportSummary(input: {
  memoryDir: string
  projectPath: string
  detectedDraft?: WorkspaceImportDraft
}): Promise<WorkspaceImportSummary> {
  const workspaceGoalsState = await readWorkspaceGoalsState(input.memoryDir)
  const tasksPath = workspaceImportTasksPath(input.memoryDir)
  let taskStatus: string | null = null
  let importerTaskSpec = ''

  try {
    const raw = await readProjectTaskQueueForRichMutation(inferProjectRootFromMemoryDir(input.memoryDir)) as
      | { tasks?: Array<Record<string, unknown>> }
      | Array<Record<string, unknown>>
    const list = Array.isArray(raw) ? raw : raw.tasks ?? []
    const task = list.find(
      entry => (entry as { id?: string }).id === WORKSPACE_IMPORT_TASK_ID,
    ) as { status?: string; spec?: string } | undefined
    if (task) {
      taskStatus = task.status ?? null
      if (typeof task.spec === 'string' && task.spec.trim().length > 0) {
        importerTaskSpec = task.spec
      }
    }
  } catch {
    taskStatus = taskStatus ?? null
  }

  const approvedImport = canonicalApprovedWorkspaceImport(workspaceGoalsState, importerTaskSpec)
  const approved = approvedImport
    ? workspaceScopeSnapshotFromParsed(approvedImport)
    : workspaceGoalsState?.approved ?? null

  const detected = input.detectedDraft
    ? workspaceScopeSnapshotFromDraft(input.detectedDraft)
    : workspaceGoalsState?.detected ?? null

  return {
    taskStatus,
    specPresent: importerTaskSpec.trim().length > 0,
    approved,
    detected,
  }
}

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
  references: readonly string[] = [],
  workspaceProjectPath = '',
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
  if (matchedKey) return matchedKey

  const referenceMatchedKey = Object.entries(coordinatorProjectPaths)
    .sort((left, right) => right[1].length - left[1].length)
    .find(([, coordinatorPath]) =>
      references.some(reference => importReferenceBelongsToCoordinatorPath(reference, coordinatorPath, workspaceProjectPath)),
    )?.[0]
  return referenceMatchedKey ?? domain
}

function normalizeDomainRouteKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function importReferenceBelongsToCoordinatorPath(
  reference: string,
  coordinatorPath: string,
  workspaceProjectPath: string,
): boolean {
  const normalizedCoordinatorPath = path.resolve(coordinatorPath).replaceAll('\\', '/')
  const normalizedReference = (path.isAbsolute(reference)
    ? path.resolve(reference)
    : path.resolve(workspaceProjectPath || process.cwd(), reference)
  ).replaceAll('\\', '/')
  return normalizedReference === normalizedCoordinatorPath ||
    normalizedReference.startsWith(`${normalizedCoordinatorPath}/`)
}

function importedTaskCanBeArchivedDuringScopeRefresh(status: Task['status']): boolean {
  return [
    'archived',
    'exploring',
    'proposed',
    'import_draft',
    'spec_review',
    'ready',
    'done',
    'shelved',
  ].includes(status)
}

function isWorkspaceImportManagedTask(task: Task): boolean {
  if (task.requestIntake?.createdBy === 'workspace-importer') return true
  if (!task.id.startsWith('task-import-')) return false
  if (task.origination !== 'human') return false
  if ((task.references ?? []).some(ref => {
    const normalized = ref.replaceAll('\\', '/')
    return normalized.includes('/docs/') || normalized.includes('docs/')
  })) return true
  const sourcePath = importTaskSourcePath(task.description ?? '')?.replaceAll('\\', '/') ?? ''
  return sourcePath.includes('/docs/') || sourcePath.includes('docs/')
}

async function evidenceSourcesForParsedTasks(
  projectPath: string,
  tasks: readonly ParsedTask[],
  extraReferences: readonly string[] = [],
): Promise<EvidenceSource[]> {
  const seen = new Set<string>()
  const sources: EvidenceSource[] = []
  const references = [
    ...tasks.flatMap(task => task.references),
    ...extraReferences,
  ]

  for (const reference of references) {
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
    const sourceTasks = tasks.filter(task => task.references.some(reference =>
      absoluteImportedReference(reference, projectPath) === absolute,
    ))
    const metadataByDeliverable = <T>(select: (task: ParsedTask) => T | undefined): Record<string, T> => Object.fromEntries(sourceTasks.flatMap(task => {
        const deliverable = task.deliverableName?.trim()
        const value = select(task)
        return deliverable && value !== undefined ? [[deliverable, value]] : []
      })) as Record<string, T>
    const unitIdentities = metadataByDeliverable(task => task.sourceIdentity)
    const semanticKinds = metadataByDeliverable(task => task.semanticKind)
    const contractNames = metadataByDeliverable(task => task.contractNames)
    const workShapes = metadataByDeliverable(task => task.workShape)
    const statusHints = metadataByDeliverable(task => task.statusHint)
    const targetAreas = metadataByDeliverable(task => task.targetArea)
    const producedArtifacts = metadataByDeliverable(task => task.producedArtifact)
    const buildsOn = metadataByDeliverable(task => task.buildsOn)
    const consumerSurfaces = metadataByDeliverable(task => task.consumerSurfaces)
    sources.push({
      path: path.relative(projectPath, absolute) || path.basename(absolute),
      content,
      ...(Object.keys(unitIdentities).length > 0 ? { unitIdentities } : {}),
      ...(Object.keys(semanticKinds).length > 0 ? { semanticKinds } : {}),
      ...(Object.keys(contractNames).length > 0 ? { contractNames } : {}),
      ...(Object.keys(workShapes).length > 0 ? { workShapes } : {}),
      ...(Object.keys(statusHints).length > 0 ? { statusHints } : {}),
      ...(Object.keys(targetAreas).length > 0 ? { targetAreas } : {}),
      ...(Object.keys(producedArtifacts).length > 0 ? { producedArtifacts } : {}),
      ...(Object.keys(buildsOn).length > 0 ? { buildsOn } : {}),
      ...(Object.keys(consumerSurfaces).length > 0 ? { consumerSurfaces } : {}),
    })
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
  const inventory = await detectWorkspaceSignals({ projectPath: input.projectPath }).catch(() => null)
  const inventoryReferences = inventory
    ? inventory.signals.flatMap(signal => signal.references ?? [])
    : []
  const sources = await evidenceSourcesForParsedTasks(input.projectPath, input.parsedTasks, inventoryReferences)
  if (sources.length === 0) {
    return [...input.parsedTasks]
  }
  // Evidence graph expansion is an explicit intake operation. A document
  // reference or detector signal identity alone does not authorize Guildhall
  // to promote prose bullets into executable work. The importer/spec must
  // name the deliverable that owns each graph unit. Source identity can then
  // stabilize that unit, but it cannot substitute for the unit declaration.
  if (!input.parsedTasks.some(task => task.deliverableName)) {
    return [...input.parsedTasks]
  }

  const plan = planEvidenceWorkGraph({
    sources,
    existingTasks: [
      ...input.queue.tasks,
      ...input.parsedTasks.map(task => ({
        id: task.id,
        title: task.title,
        ...(task.sourceIdentity ? { sourceIdentity: task.sourceIdentity } : {}),
        ...(task.deliverableName ? { deliverableName: task.deliverableName } : {}),
        ...(task.producedArtifact ? { producedArtifact: task.producedArtifact } : {}),
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
  const suppressedTaskTitles = new Set(plan.suppressedTaskTitles.map(title => normalizeImportText(title)).filter(Boolean))
  const reconciledIds = new Set(plan.reconciliations.map(reconciliation => reconciliation.existingTaskId))
  const parsedTasksById = new Map(input.parsedTasks.map(task => [task.id, task] as const))
  const graphMatchedParsedIds = new Set<string>()
  const graphTasks = plan.tasks.map(task => {
    const matchedById = parsedTasksById.get(task.id)
    const explicitSourceOwner = !matchedById
      ? input.parsedTasks.find(candidate => Boolean(
        (candidate.semanticKind || candidate.contractNames?.length) &&
        typeof candidate.deliverableName === 'string' &&
        normalizeImportText(candidate.deliverableName) === normalizeImportText(task.deliverableName),
      ))
      : undefined
    // Scope is carried by the parsed structural record. A source path or a
    // task title cannot assign a graph node to current or later work.
    const detectedScope = matchedById?.scope ?? explicitSourceOwner?.scope ?? 'current'
    // A source path is evidence membership, not work identity: one document
    // can own many tasks. Only an exact durable graph id may reconcile a
    // parsed task, while an explicit deliverable identity can suppress the
    // duplicate graph candidate. Similar titles and shared references remain
    // visible until a source adapter supplies a real identity.
    const matchedParsedTask = matchedById
    const hasExplicitSourceOwner = Boolean(explicitSourceOwner)
    if (matchedParsedTask) {
      graphMatchedParsedIds.add(matchedParsedTask.id)
    }
    if (hasExplicitSourceOwner) {
      // The graph candidate was deliberately suppressed because the parsed
      // task is the explicit owner. Do not let its planned id make the real
      // parsed task disappear from the untouched set.
      graphTaskIds.delete(task.id)
      return null
    }
    if (!matchedParsedTask && detectedScope === 'later') {
      return null
    }
    return graphTaskToParsedTask(
      task,
      matchedParsedTask,
      undefined,
      detectedScope,
      Boolean(matchedById),
    )
  }).filter((task): task is MaterializedImportTask => task !== null)
  const untouchedParsedTasks = input.parsedTasks.filter(task =>
    !graphTaskIds.has(task.id) &&
    !graphMatchedParsedIds.has(task.id) &&
    !reconciledIds.has(task.id) &&
    !suppressedParsedImportedTask(task, suppressedTaskTitles),
  )

  return [...graphTasks, ...untouchedParsedTasks]
}

function suppressedParsedImportedTask(
  task: ParsedTask,
  suppressedTaskTitles: ReadonlySet<string>,
): boolean {
  const structuralIdentity = task.deliverableName?.trim()
  // A source-backed suppression is valid only when the parsed record names
  // the same structural deliverable explicitly. Title wording is evidence,
  // not permission to drop an approved current or deferred task.
  return Boolean(
    structuralIdentity &&
    suppressedTaskTitles.has(normalizeImportText(structuralIdentity)),
  )
}

function graphTaskToParsedTask(
  task: EvidenceTask,
  parsedTask?: ParsedTask,
  inventoryReferences?: readonly string[],
  detectedScope?: 'current' | 'later',
  preferParsedIdentity = false,
): MaterializedImportTask {
  const references = mergeImportReferences(
    evidenceTaskReferences(task),
    mergeImportReferences(parsedTask?.references, inventoryReferences),
  )
  return {
    id: preferParsedIdentity && parsedTask ? parsedTask.id : task.id,
    sourceIdentity: task.sourceIdentity,
    // The graph/source adapter owns the display label for a graph node. A
    // parsed model title may be useful audit context, but it cannot replace
    // the source-backed node or influence identity by wording.
    title: task.title,
    deliverableName: task.deliverableName,
    ...(task.producedArtifact ? { producedArtifact: task.producedArtifact } : {}),
    ...(task.targetArea ? { targetArea: task.targetArea } : {}),
    workShape: task.workShape,
    statusHint: task.statusHint,
    ...(task.buildsOn.length > 0 ? { buildsOn: [...task.buildsOn] } : {}),
    ...(task.consumerSurface ? { consumerSurfaces: [task.consumerSurface] } : {}),
    // An exact durable id permits the parsed task to keep its authored
    // description while the evidence graph still owns the node identity and
    // structural dependencies. Wording is never used to create that join.
    description: parsedDescriptionWithoutExactSourcePrefix(
      parsedTask?.description,
      task.sourceRefs[0]?.path,
    ) || evidenceTaskDescription(task),
    whyThisMayMatter: evidenceTaskWhyThisMayMatter(task),
    assumptions: [
      'The referenced documentation still represents intended project direction.',
    ],
    missingInformation: cleanImportedMissingInformation(parsedTask?.missingInformation ?? []),
    ...(task.semanticKind ?? parsedTask?.semanticKind
      ? { semanticKind: task.semanticKind ?? parsedTask?.semanticKind }
      : {}),
    ...(parsedTask?.contractNames?.length ? { contractNames: [...parsedTask.contractNames] } : {}),
    ...(parsedTask?.parentAcceptanceCriterionIds?.length
      ? { parentAcceptanceCriterionIds: [...parsedTask.parentAcceptanceCriterionIds] }
      : {}),
    domain: graphTaskDomain(task, parsedTask),
    scope: detectedScope ?? (parsedTask?.scope === 'later' ? 'later' : 'current'),
    priority: evidenceTaskPriority(task),
    references: references ?? [],
    acceptanceCriteria: task.acceptanceCriteria,
    dependsOn: task.dependsOn,
    proofPaths: parsedTask?.proofPaths?.length ? parsedTask.proofPaths : task.proofPaths,
    ...(parsedTask?.releaseIds?.length ? { releaseIds: [...parsedTask.releaseIds] } : {}),
    evidenceGraphTask: true,
  }
}

function parsedDescriptionWithoutExactSourcePrefix(
  description: string | undefined,
  sourcePath: string | undefined,
): string {
  const value = description?.trim() ?? ''
  const prefix = sourcePath?.trim() ?? ''
  if (!value || !prefix) return value
  const exactPrefix = `${prefix}:`
  return value.startsWith(exactPrefix) ? value.slice(exactPrefix.length).trim() : value
}

function graphTaskDomain(task: EvidenceTask, parsedTask?: ParsedTask): string {
  if (task.targetArea !== 'project' && task.targetArea !== 'unsorted') {
    return task.targetArea
  }
  const parsedDomain = parsedTask?.domain?.trim()
  if (parsedDomain) {
    return parsedDomain
  }
  return task.targetArea
}

function ensureImportedReleaseContainers(
  queue: TaskQueue,
  now: string,
  importedReleases: readonly ParsedRelease[] = [],
  preferredSelectedReleaseId?: string,
): void {
  const importedReleaseLabels = new Map(
    importedReleases
      .map(release => [release.id.trim(), release.label.trim()] as const)
      .filter(([id, label]) => id.length > 0 && label.length > 0),
  )
  const importedReleaseStates = new Map(
    importedReleases
      .map(release => [release.id.trim(), release.state] as const)
      .filter((entry): entry is readonly [string, ProjectRelease['state']] => entry[0].length > 0 && Boolean(entry[1])),
  )
  const releaseIds = [...new Set([
    ...importedReleases.map(release => release.id.trim()).filter(Boolean),
    ...queue.tasks
      .filter(task => task.status !== 'archived' && task.status !== 'cancelled')
      .flatMap(task => task.releaseIds ?? [])
      .map(id => id.trim())
      .filter(Boolean),
  ])]
  if (releaseIds.length === 0) return

  const releaseSources = new Map(
    importedReleases
      .map(release => [release.id.trim(), release.source ?? 'release_plan'] as const)
      .filter(([id]) => id.length > 0),
  )
  const derived = deriveReleaseContainersFromTaskMembership(queue.tasks, {
    existingReleases: queue.releases,
    releaseIds,
    releaseLabels: importedReleaseLabels,
    releaseStates: importedReleaseStates,
    releaseSources,
    now,
  })
  queue.releases = derived.releases
  if (
    preferredSelectedReleaseId &&
    derived.releases.some(release => release.id === preferredSelectedReleaseId)
  ) {
    queue.selectedReleaseId = preferredSelectedReleaseId
    return
  }
  const selectedRelease = queue.selectedReleaseId
    ? derived.releases.find(release => release.id === queue.selectedReleaseId)
    : undefined
  const selectedHasCurrentWork = selectedRelease
    ? releaseHasOpenCurrentWork(selectedRelease, queue.tasks)
    : false
  if (!queue.selectedReleaseId || (!selectedHasCurrentWork && derived.selectedReleaseId)) {
    queue.selectedReleaseId = derived.selectedReleaseId ?? releaseIds[0]
  }
}

function selectedReleaseIdFromCurrentImport(tasks: readonly MaterializedImportTask[]): string | undefined {
  for (const task of tasks) {
    if (task.scope === 'later') continue
    const releaseId = task.releaseIds?.find(id => id.trim().length > 0)?.trim()
    if (releaseId) return releaseId
  }
  return undefined
}

function releaseHasOpenCurrentWork(release: ProjectRelease, tasks: readonly Task[]): boolean {
  const nodeIds = new Set(release.nodeIds ?? [])
  return tasks.some(task => {
    if (task.status === 'archived' || task.status === 'cancelled' || task.status === 'shelved') return false
    if ((TERMINAL_TASK_STATUSES as readonly Task['status'][]).includes(task.status)) return false
    return nodeIds.has(taskScopeNodeId(task.id)) || (task.releaseIds ?? []).includes(release.id)
  })
}

function importedCurrentCompletionNeedsFreshProof(input: {
  existing: Task
  refreshedAcceptanceCriteria: Task['acceptanceCriteria']
  refreshedProofPaths: Task['proofPaths']
}): boolean {
  if (taskHasDurableCompletionEvidence(input.existing)) return false
  const hasUnmetRefreshedCriteria = (input.refreshedAcceptanceCriteria ?? [])
    .some(criterion => criterion.met !== true)
  const hasUnverifiedRefreshedProof = (input.refreshedProofPaths ?? [])
    .some(proofPathMissingPassedEvidence)
  if (!hasUnmetRefreshedCriteria && !hasUnverifiedRefreshedProof) return false
  return !taskHasVerifiedCompletionEvidence(input.existing)
}

function taskHasVerifiedCompletionEvidence(task: Task): boolean {
  return (
    taskHasDurableCompletionEvidence(task) ||
    completionHandoffHasVerifiedEvidence(task.completionHandoff) ||
    (task.proofPaths ?? []).some(proofPathHasPassedEvidence) ||
    (task.gateResults ?? []).some(result => result.passed === true) ||
    (task.reviewVerdicts ?? []).some(verdict => verdict.verdict === 'approve')
  )
}

function taskHasDurableCompletionEvidence(task: Task): boolean {
  return task.doneSummaryBundle?.status === 'done' || task.mergeRecord?.result === 'merged'
}

function durableCompletedAt(task: Task): string | undefined {
  return task.completedAt ?? task.doneSummaryBundle?.completedAt ?? task.mergeRecord?.mergedAt
}

function mergeImportedRefreshNotes(existing: Task['notes'], seeded: Task['notes']): Task['notes'] {
  const merged = [...(existing ?? [])]
  const seen = new Set(merged.map(note => [
    note.agentId,
    note.role,
    note.timestamp,
    note.content,
  ].join('\u0000')))
  for (const note of seeded ?? []) {
    const key = [
      note.agentId,
      note.role,
      note.timestamp,
      note.content,
    ].join('\u0000')
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(note)
  }
  return merged
}

function completionHandoffHasVerifiedEvidence(handoff: unknown): boolean {
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) return false
  const record = handoff as Record<string, unknown>
  // `verified` and `evidenceRefs` are human/audit fields. They must not keep a
  // stale imported task looking complete without a structured result.
  return passedVerificationRecords(record.automatedProof).length > 0 ||
    passedVerificationRecords(record.manualProof).length > 0 ||
    passedVerificationRecords(record.providerProof).length > 0
}

function proofPathHasPassedEvidence(proofPath: unknown): boolean {
  if (!proofPath || typeof proofPath !== 'object' || Array.isArray(proofPath)) return false
  const record = proofPath as Record<string, unknown>
  // An inferred imported plan can carry a stale `verified` label from an old
  // intake pass. Only an observed/unsourced status is allowed to preserve a
  // completion claim; source-backed plans still need actual verification
  // records before they settle work.
  if (record.status === 'verified' && record.source !== 'inferred') return true
  return passedVerificationRecords(record.verificationRecords).length > 0
}

function proofPathMissingPassedEvidence(proofPath: unknown): boolean {
  if (!proofPath || typeof proofPath !== 'object' || Array.isArray(proofPath)) return true
  return !proofPathHasPassedEvidence(proofPath)
}

function nonEmptyStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
}

function nonEmptyArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function passedVerificationRecords(value: unknown): unknown[] {
  return Array.isArray(value)
    ? value.filter(item => Boolean(item && typeof item === 'object' && (item as { status?: unknown }).status === 'passed'))
    : []
}

function materializedAcceptanceCriteria(
  task: MaterializedImportTask,
  evidenceDetail?: ImportedEvidenceDetail,
): Task['acceptanceCriteria'] {
  const normalized = AcceptanceCriteria.array().parse((task.acceptanceCriteria ?? []).map(criterion => ({
    id: criterion.id,
    description: criterion.description,
    scenario: criterion.scenario ?? criterion.description,
    expectation: criterion.expectation ?? criterion.description,
    verifiedBy: criterion.verifiedBy === 'automated' || criterion.verifiedBy === 'review' || criterion.verifiedBy === 'human'
      ? criterion.verifiedBy
      : 'review',
    source: criterion.source === 'inferred' ? 'inferred' : 'documented',
    ...(criterion.command ? { command: criterion.command } : {}),
    ...(criterion.expectedExit ? { expectedExit: criterion.expectedExit } : {}),
    ...(criterion.expectedOutputIncludes?.length ? { expectedOutputIncludes: criterion.expectedOutputIncludes } : {}),
    ...(criterion.evidenceHint ? { evidenceHint: criterion.evidenceHint } : {}),
    ...(criterion.negativeCase ? { negativeCase: criterion.negativeCase } : {}),
    met: false,
  })))
  if (shouldDeriveImportedAcceptanceCriteria(task, normalized, evidenceDetail)) {
    return deriveImportedAcceptanceCriteria(task, evidenceDetail!)
  }
  return normalized
}

function importedTaskHasBlueprintSeed(task: MaterializedImportTask, evidenceDetail?: ImportedEvidenceDetail): boolean {
  if (contractShapedImportHasNoConcreteContracts({
    semanticKind: task.semanticKind,
    contractNames: evidenceDetail?.contractNames,
    hasAlternativeStructuralEvidence: evidenceDetail ? importedTaskHasAlternativeStructuralEvidence(evidenceDetail) : false,
  })) {
    return false
  }
  const hasTypedTaskContract = (
    (task.contractNames?.length ?? 0) > 0 ||
    task.proofPaths?.some(path => path.source === 'documented') === true ||
    importedPrototypeTaskKind(task) !== null ||
    task.semanticKind === 'contract' ||
    task.semanticKind === 'reviewer_lane' ||
    task.semanticKind === 'workflow'
  )
  return (
    (task.references?.length ?? 0) > 0 &&
    (task.acceptanceCriteria?.length ?? 0) > 0 &&
    hasTypedTaskContract
  )
}

function importedTaskHasAlternativeStructuralEvidence(evidenceDetail: ImportedEvidenceDetail): boolean {
  return (
    evidenceDetail.weightDimensions.length > 0 ||
    evidenceDetail.severityLevels.length > 0 ||
    evidenceDetail.decisionSteps.length > 0 ||
    evidenceDetail.coreLoopSteps.length > 0 ||
    evidenceDetail.systemRecords.length > 0 ||
    evidenceDetail.packetFields.length > 0
  )
}

function summarizeImportedSuccessMetric(task: MaterializedImportTask, evidenceDetail?: ImportedEvidenceDetail): string {
  const acceptance = (task.acceptanceCriteria ?? [])
    .map(criterion => criterion.description.trim())
    .filter(Boolean)
  if (task.semanticKind === 'contract') {
    return `${task.title} defines and proves the cited local contracts.`
  }
  if (task.semanticKind === 'reviewer_lane') {
    return `${task.title} records the documented fiction-specific findings for a bounded proof fixture.`
  }
  if (task.semanticKind === 'workflow') {
    return `${task.title} preserves the documented workflow, weighting, and fiction-first decision boundary.`
  }
  if (acceptance.length > 0) {
    const first = acceptance[0]!
    const second = acceptance[1]
    return second ? `${first} Also: ${second}` : first
  }
  if (evidenceDetail?.goalStatements[0]) {
    return evidenceDetail.goalStatements[0]
  }
  if (evidenceDetail?.implementationBullets[0]) {
    return `${task.title} implements the documented boundary: ${evidenceDetail.implementationBullets[0].replace(/\.$/, '')}.`
  }
  if (acceptance.length === 0) {
    return `${task.title} is delivered according to the cited project evidence and recorded proof.`
  }
  const first = acceptance[0] ?? `${task.title} is delivered according to the cited project evidence and recorded proof.`
  const second = acceptance[1]
  if (second) return `${first} Also: ${second}`
  return first
}

function summarizeImportedVerification(task: MaterializedImportTask): string {
  const steps = simpleImportedProofPaths(task.proofPaths).map((path) => {
    if (path.kind === 'command' && typeof path.command === 'string' && path.command.trim()) {
      return `Run \`${path.command.trim()}\``
    }
    if (path.kind === 'browser') return 'Capture browser proof for the documented flow'
    if (path.kind === 'review') {
      const expected = Array.isArray(path.expectedEvidence) ? path.expectedEvidence.filter(Boolean).join(', ') : ''
      return expected ? `Review recorded evidence (${expected})` : 'Review the documented proof output'
    }
    return null
  }).filter((value): value is string => Boolean(value))
  if (steps.length === 0) {
    return `Add bounded local workspace proof for ${task.title} and record the result.`
  }
  return steps.join('; ')
}

function cleanImportedMissingInformation(items: readonly string[]): string[] {
  return items
    .filter(Boolean)
    .map(item => item.trim())
    .filter(item => item.length > 0)
    .filter(item => !/guildhall still needs to confirm/i.test(item))
    .filter(item => !/final implementation boundary during shaping/i.test(item))
}

function importedTaskLooksContractDriven(task: MaterializedImportTask): boolean {
  return task.semanticKind === 'contract'
}

function importedPrototypeTaskKind(
  task: MaterializedImportTask,
): 'fixture' | 'runner' | 'evaluation' | 'debug_report' | 'schema_prune' | 'drafting_model' | 'author_intent' | 'chapter_draft' | 'world_state_review' | 'spatial_review' | null {
  const kind = task.semanticKind
  if (kind === 'fixture' || kind === 'runner' || kind === 'evaluation' || kind === 'debug_report' ||
      kind === 'schema_prune' || kind === 'drafting_model' || kind === 'author_intent' ||
      kind === 'chapter_draft' || kind === 'world_state_review' || kind === 'spatial_review') return kind
  return null
}

function importedTaskLooksReviewerLane(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
): boolean {
  // Review-lane shaping is an intake decision, not a keyword detector over
  // source prose. Keep source detail available to the explicit adapter, but
  // do not promote a task merely because a document contains review questions.
  void evidenceDetail
  return task.semanticKind === 'reviewer_lane'
}

function importedTaskLooksWorkflowDriven(
  task: MaterializedImportTask,
  _evidenceDetail: ImportedEvidenceDetail,
): boolean {
  // Weight tables and severity headings are source evidence, not an
  // authoritative task kind. A model can describe the same work in many
  // ways; only the explicit intake metadata may select workflow shaping.
  return task.semanticKind === 'workflow'
}

type ImportedGeneralShapeKind =
  | 'retrieval'
  | 'agent_call'
  | 'invalidation'
  | 'telemetry'
  | 'general'

function importedGeneralShapeKind(task: MaterializedImportTask): ImportedGeneralShapeKind {
  if (task.semanticKind === 'retrieval') return 'retrieval'
  if (task.semanticKind === 'agent_call') return 'agent_call'
  if (task.semanticKind === 'invalidation') return 'invalidation'
  if (task.semanticKind === 'telemetry') return 'telemetry'
  return 'general'
}

function shouldDeriveImportedAcceptanceCriteria(
  task: MaterializedImportTask,
  current: Task['acceptanceCriteria'],
  evidenceDetail?: ImportedEvidenceDetail,
): boolean {
  if (!evidenceDetail) return false
  // Explicit intake semantics are sufficient to select the shaping adapter.
  // The adapter must not depend on a particular source document containing a
  // magic starter criterion such as `source-implementation`.
  if (
    importedPrototypeTaskKind(task) ||
    task.semanticKind === 'contract' ||
    task.semanticKind === 'reviewer_lane' ||
    task.semanticKind === 'workflow'
  ) return true
  const ids = new Set(current.map(criterion => criterion.id))
  if (!ids.has('source-implementation')) return false
  if (importedTaskLooksWorkflowDriven(task, evidenceDetail)) return true
  if (importedTaskLooksContractDriven(task) && evidenceDetail.contractNames.length > 0) return true
  if (importedTaskLooksReviewerLane(task, evidenceDetail)) return true
  return true
}

function deriveImportedAcceptanceCriteria(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
): Task['acceptanceCriteria'] {
  const prototypeTaskKind = importedPrototypeTaskKind(task)
  if (prototypeTaskKind) {
    return derivePrototypeTaskAcceptanceCriteria(task, evidenceDetail, prototypeTaskKind)
  }
  if (importedTaskLooksWorkflowDriven(task, evidenceDetail)) {
    return deriveWorkflowAcceptanceCriteria(task, evidenceDetail)
  }
  if (importedTaskLooksContractDriven(task)) {
    return deriveContractDrivenAcceptanceCriteria(task, evidenceDetail)
  }
  if (importedTaskLooksReviewerLane(task, evidenceDetail)) {
    return deriveReviewerLaneAcceptanceCriteria(task, evidenceDetail)
  }
  return deriveGeneralImportedAcceptanceCriteria(task)
}

function derivePrototypeTaskAcceptanceCriteria(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
  kind: NonNullable<ReturnType<typeof importedPrototypeTaskKind>>,
): Task['acceptanceCriteria'] {
  const proofCommand = firstImportedProofCommand(task)
  switch (kind) {
    case 'fixture':
      return [
        {
          id: 'fixture-shape',
          description: 'The fixture can represent manuscript text, book brief, author profile, project notes, expected records, and author decisions.',
          scenario: 'Load the first bounded story fixture.',
          expectation: 'The fixture shape is rich enough to drive repeated no-UI packet tests without ad hoc side inputs.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'ground-truth-records',
          description: 'Expected records are human-authored, stable, and reusable across repeated fixture runs.',
          scenario: 'Compare one run against the fixture ground truth.',
          expectation: 'Ground truth records express the intended story facts, constraints, and expected findings for the run.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        deterministicImportedCriterion(task, proofCommand, 'The fixture and expected records have deterministic proof in the no-UI harness.'),
      ]
    case 'runner':
      return [
        {
          id: 'runner-flow',
          description: 'The runner ingests a fixture, builds records, runs a packet, and saves the run output.',
          scenario: 'Execute one bounded fixture round through the harness.',
          expectation: 'The run leaves a reproducible output bundle instead of manual one-off inspection.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'headless-boundary',
          description: 'The harness run works without a frontend and stays inside the no-UI prototype boundary.',
          scenario: 'Run the harness from local commands only.',
          expectation: 'The task proves packet execution without depending on UI/editor work.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        ...(evidenceDetail.packetFields.length > 0 ? [{
          id: 'packet-boundary',
          description: `The runner builds a bounded writer packet from the documented fields: ${evidenceDetail.packetFields.join('; ')}, including writer packet names what the character believes and writer packet names what the reader knows.`,
          scenario: 'Build one writer packet for a bounded fixture task.',
          expectation: 'The packet uses the cited record surfaces instead of rereading the whole manuscript or pulling unrelated context.',
          verifiedBy: 'review' as const,
          source: 'inferred' as const,
          met: false,
        }] : []),
        ...(evidenceDetail.privacyRules.length > 0 ? [{
          id: 'privacy-manifest',
          description: `The runner records provenance/privacy scope in packet output: ${evidenceDetail.privacyRules.join('; ')}, including privacy manifest says what was included.`,
          scenario: 'Run one fixture that includes allowed and blocked provenance material.',
          expectation: 'The output makes it clear which provenance entered the packet and which material stayed blocked.',
          verifiedBy: 'review' as const,
          source: 'inferred' as const,
          met: false,
        }] : []),
        ...(evidenceDetail.invalidationRules.length > 0 ? [{
          id: 'invalidation-boundary',
          description: `The runner marks stale packet context after source edits: ${evidenceDetail.invalidationRules.join('; ')}, including affected records become stale.`,
          scenario: 'Change one source input after an initial run.',
          expectation: 'The next run flags or excludes stale derived context instead of silently reusing it.',
          verifiedBy: 'review' as const,
          source: 'inferred' as const,
          met: false,
        }] : []),
        deterministicImportedCriterion(task, proofCommand, 'The no-UI runner has deterministic proof over a bounded fixture.'),
      ]
    case 'evaluation':
      return [
        {
          id: 'evaluation-categories',
          description: 'Evaluation output distinguishes missing context, noisy context, stale context, useful context, schema mismatch, and model behavior.',
          scenario: 'Inspect one failed and one successful fixture run.',
          expectation: 'Failures are classified precisely enough to explain what kind of mistake happened.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'stable-report-shape',
          description: 'The evaluation report shape is deterministic and comparable across repeated runs.',
          scenario: 'Compare repeated evaluation output for the same fixture.',
          expectation: 'The report can be used to compare packet strategies and fixture revisions over time.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        deterministicImportedCriterion(task, proofCommand, 'Evaluation output has deterministic proof over the bounded fixture set.'),
      ]
    case 'debug_report':
      return [
        {
          id: 'trace-spine',
          description: 'The debug report connects the run summary, packet, context receipts, and trace events into one reviewable spine.',
          scenario: 'Open the debug report for one bounded fixture run.',
          expectation: 'The report makes it obvious where a surprising result came from.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'context-accounting',
          description: 'The debug report shows why context was included, omitted, retrieved, or marked stale.',
          scenario: 'Inspect packet/context accounting in one run report.',
          expectation: 'The report explains context decisions rather than only showing final output.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'privacy-boundary',
          description: 'Debug traces respect the same privacy boundary as packets and redact unsafe detail when needed.',
          scenario: 'Review a run that includes private/global/session author material.',
          expectation: 'Traceability does not leak context the packet rules would not allow.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        deterministicImportedCriterion(task, proofCommand, 'The debug report has deterministic proof over a bounded fixture run.'),
      ]
    case 'schema_prune':
      return [
        {
          id: 'mvp-boundary-review',
          description: 'The first run is used to judge which schema fields are truly needed for the MVP contract boundary.',
          scenario: 'Compare the first run output against the MVP boundary questions.',
          expectation: 'Fields that do not help answer the MVP questions are deferred instead of silently kept.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'schema-pruning-record',
          description: 'Schema narrowing records which fields stay in the MVP, which move to fixture metadata, and which remain future follow-up.',
          scenario: 'Review the schema-pruning change after the first proof run.',
          expectation: 'The pruning decision is explicit and tied back to fixture evidence.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        deterministicImportedCriterion(task, proofCommand, 'Schema narrowing has deterministic proof tied to the first bounded run.'),
      ]
    case 'drafting_model':
      return [
        {
          id: 'deepinfra-model-candidate',
          description: 'The task records a DeepInfra-hosted drafting model candidate with model id, context window, license, privacy/retention notes, content-policy boundary, cost, and fallback risk.',
          scenario: 'Review the selected drafting model record.',
          expectation: 'The model choice is source-backed and fit for Narrative Harness drafting work, not a guessed default.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'broad-genre-drafting-proof',
          description: 'The model is tested against chapter-drafting scenarios across the intended fiction range, including legal adult fiction inside the Narrative Harness content boundary.',
          scenario: 'Run or review the drafting bakeoff fixture set.',
          expectation: 'The model can draft across the intended genre range without genre-level refusal for legal adult fiction.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'drafting-failure-telemetry',
          description: 'The proof records refusal behavior, repetition/runaway behavior, cost, latency, and whether the output preserves author voice and genre constraints.',
          scenario: 'Inspect the model proof output.',
          expectation: 'The model selection records concrete operating risks before the MVP treats it as usable.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        deterministicImportedCriterion(task, proofCommand, 'DeepInfra drafting-model selection has bounded local proof.'),
      ]
    case 'author_intent':
      return [
        {
          id: 'author-intent-records',
          description: 'Records exist for voice, genre, audience, theme, synopsis, outline, characters, character voices, world-state facts, and review plan.',
          scenario: 'Load the first author-intent fixture.',
          expectation: 'The fixture captures the inputs needed to draft and review fiction without asking the author to reconstruct context manually.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'intent-to-packet-proof',
          description: 'The no-UI packet builder can feed author-intent records into drafting and review without relying on a completed product UI.',
          scenario: 'Build one drafting/review packet from author-intent records.',
          expectation: 'Intent records become bounded packet inputs instead of loose prose notes.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'content-boundary-input',
          description: 'The author-intent input captures heat level/content boundary so adult fiction support stays inside the product policy.',
          scenario: 'Review a fixture that includes adult-fiction boundary settings.',
          expectation: 'The packet carries enough policy context to support legal adult fiction while rejecting disallowed material.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        deterministicImportedCriterion(task, proofCommand, 'Author-intent inputs have bounded local proof.'),
      ]
    case 'chapter_draft':
      return [
        {
          id: 'synopsis-to-outline-chain',
          description: 'The task can generate or load a synopsis, outline, character/voice records, and world-state facts before drafting.',
          scenario: 'Run the first synopsis-to-outline-to-records fixture.',
          expectation: 'Chapter drafting starts from structured story context, not a one-shot prompt blob.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'chapter-draft-command',
          description: 'A pnpm script or CLI command drafts one chapter from the selected model using the bounded context packet and review plan.',
          scenario: 'Execute the chapter-draft proof command.',
          expectation: 'The MVP can produce a reviewable chapter draft without a completed product UI.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'author-voice-preservation',
          description: 'The draft proof records whether the chapter follows the requested author voice, genre, audience, and character voices.',
          scenario: 'Inspect reviewer output for the generated chapter.',
          expectation: 'The draft is evaluated for voice and genre fit instead of only checking that text exists.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        deterministicImportedCriterion(task, proofCommand, 'Chapter drafting has bounded local proof.'),
      ]
    case 'world_state_review':
      return [
        {
          id: 'elapsed-time-state-transitions',
          description: 'The reviewer checks object and property changes over elapsed time, such as wet hair drying by climate, food spoiling, wounds healing, fires cooling, or objects being moved/used/consumed.',
          scenario: 'Run a fixture with a deliberate elapsed-time state contradiction.',
          expectation: 'The reviewer flags the contradiction using time, environment, and object/property evidence.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'world-state-finding-shape',
          description: 'Reviewer output names the entity, prior state, later state, elapsed time, environment, expected transition, contradiction, and source passages.',
          scenario: 'Inspect one world-state finding.',
          expectation: 'The finding explains the state transition rather than only saying continuity is broken.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'world-rule-exceptions',
          description: 'The proof preserves explicit magic, technology, or storyworld rules as exceptions instead of treating every non-real-world transition as an error.',
          scenario: 'Run a control fixture with a stated storyworld exception.',
          expectation: 'The reviewer keeps valid exceptions out of the finding list.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        deterministicImportedCriterion(task, proofCommand, 'World-state review has bounded local proof.'),
      ]
    case 'spatial_review':
      return [
        {
          id: 'travel-plausibility-proof',
          description: 'The reviewer checks distance, travel time, terrain, travel mode, walking speed, weather, light, and map consistency for a deliberately inconsistent fixture.',
          scenario: 'Run a fixture with impossible ordinary travel.',
          expectation: 'The reviewer flags unsupported movement or geography using concrete travel/plausibility evidence.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'genre-aware-geography',
          description: 'The reviewer distinguishes ordinary walking-speed impossibilities from explicit fantasy/speculative exceptions such as magic, mounts, portals, or non-human physiology.',
          scenario: 'Run an impossible-travel fixture plus a stated-exception control.',
          expectation: 'The lane catches the impossible ordinary journey and preserves the documented fantasy exception.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'spatial-finding-shape',
          description: 'Reviewer output names the passage, location, claimed movement/geography, expected plausible behavior, difference, severity, and evidence.',
          scenario: 'Inspect one spatial/geographic finding.',
          expectation: 'The finding is specific enough for a writer to fix the scene or add an intentional exception.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        deterministicImportedCriterion(task, proofCommand, 'Spatial/geographic review has bounded local proof.'),
      ]
  }
}

function deriveContractDrivenAcceptanceCriteria(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
): Task['acceptanceCriteria'] {
  const contractList = evidenceDetail.contractNames.slice(0, 6).map(name => `\`${name}\``).join(', ')
  const contractBoundary = contractList || 'the explicit contract boundary in the cited evidence'
  const fixtureContracts = evidenceDetail.contractNames.filter(name => /(fixture|expected)/i.test(name))
  const runContracts = evidenceDetail.contractNames.filter(name => /(run|evaluation|score|trace|signal)/i.test(name))
  const verificationSummary = evidenceDetail.verificationBullets[0]?.replace(/\.$/, '')
  const proofCommand = firstImportedProofCommand(task)
  const criteria: Task['acceptanceCriteria'] = [
    {
      id: 'contracts-defined',
      description: `The cited contracts are explicitly defined and usable in code: ${contractBoundary}.`,
      scenario: `Import ${task.title} from the cited project evidence.`,
      expectation: `Code can create and consume ${contractBoundary}.`,
      verifiedBy: 'review',
      source: 'inferred',
      met: false,
    },
  ]
  if (fixtureContracts.length > 0) {
    const fixtureList = fixtureContracts.slice(0, 4).map(name => `\`${name}\``).join(', ')
    criteria.push({
      id: 'fixture-ground-truth-shape',
      description: `${fixtureList} can express the tiny fiction fixture and its human-authored ground truth.`,
      scenario: 'Load the first bounded fixture into the schema layer.',
      expectation: `${fixtureList} cover the fixture inputs and expected records without extra ad hoc shape.`,
      verifiedBy: 'review',
      source: 'inferred',
      met: false,
    })
  }
  if (runContracts.length > 0) {
    const runList = runContracts.slice(0, 5).map(name => `\`${name}\``).join(', ')
    criteria.push({
      id: 'run-evaluation-shape',
      description: `${runList} capture the prototype run, evaluation, and trace evidence needed for the first proof loop.`,
      scenario: 'Record one prototype packet run and its evaluation output.',
      expectation: `${runList} preserve the reviewable run/evaluation story the cited docs call for.`,
      verifiedBy: 'review',
      source: 'inferred',
      met: false,
    })
  }
  if (verificationSummary) {
    criteria.push({
      id: 'proof-output-support',
      description: `The schema supports the documented proof flow: ${verificationSummary}.`,
      scenario: 'Run the cited verification flow against the imported schema layer.',
      expectation: verificationSummary,
      verifiedBy: 'review',
      source: 'inferred',
      met: false,
    })
  }
  criteria.push({
    id: 'deterministic-proof',
    description: proofCommand
      ? `The schema is covered by deterministic local proof via \`${proofCommand}\`.`
      : `Add bounded local workspace proof for ${task.title} and record the result against the cited verification plan.`,
    scenario: 'Execute the local proof path for this imported task.',
    expectation: proofCommand
      ? `\`${proofCommand}\` passes against the imported schema work.`
      : 'A real local proof path exists, runs, and is recorded with the task.',
    verifiedBy: proofCommand ? 'automated' : 'review',
    source: proofCommand ? 'documented' : 'inferred',
    met: false,
  })
  return criteria
}

function deriveReviewerLaneAcceptanceCriteria(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
): Task['acceptanceCriteria'] {
  const laneScope = evidenceDetail.implementationBullets[0] ?? ''
  const questionList = (
    evidenceDetail.reviewQuestions.length > 0
      ? evidenceDetail.reviewQuestions
      : [
          ...evidenceDetail.implementationBullets.filter(item => /\?$/.test(item)),
          ...evidenceDetail.implementationBullets,
        ]
  ).slice(0, 4)
  const ruleList = (
    evidenceDetail.rules.length > 0
      ? evidenceDetail.rules
      : [
          ...evidenceDetail.goalStatements,
          summarizeImportedProblemContext(task, evidenceDetail),
        ]
  ).slice(0, 3)
  const decisionSteps = (
    evidenceDetail.decisionSteps.length > 0
      ? evidenceDetail.decisionSteps
      : evidenceDetail.implementationBullets
  ).slice(0, 4)
  const proofCommand = firstImportedProofCommand(task)
  const criteria: Task['acceptanceCriteria'] = []

  if (laneScope) {
    criteria.push({
      id: 'lane-scope',
      description: `${task.title} covers the documented lens: ${laneScope}`,
      scenario: `Run ${task.title} against a bounded fiction scene or chapter.`,
      expectation: 'The lane evaluates the same craft surface the cited spec defines, rather than generic prose quality.',
      verifiedBy: 'review',
      source: 'inferred',
      met: false,
    })
  }
  criteria.push({
    id: 'review-prompts',
    description: `${task.title} can ask and answer the documented review prompts: ${questionList.join(' ')}`,
    scenario: 'Record reviewer output for one bounded proof fixture.',
    expectation: 'The reviewer output preserves the spec-native questions instead of flattening them into vague notes.',
    verifiedBy: 'review',
    source: 'inferred',
    met: false,
  })
  criteria.push({
    id: 'lane-boundary',
    description: `${task.title} respects the cited boundary and craft rules: ${ruleList.join('; ')}`,
    scenario: 'Inspect reviewer guidance for edge cases the spec warns about.',
    expectation: 'The lane protects the intended fiction boundary and does not apply generic smoothing rules.',
    verifiedBy: 'review',
    source: 'inferred',
    met: false,
  })
  if (decisionSteps.length > 0 || evidenceDetail.examples.length > 0) {
    const proofShape = decisionSteps.length > 0
      ? `It follows the cited decision path: ${decisionSteps.join(' -> ')}.`
      : `It produces findings shaped like the cited examples: ${evidenceDetail.examples.slice(0, 2).join(' / ')}.`
    criteria.push({
      id: 'finding-shape',
      description: `${task.title} emits actionable findings instead of generic commentary. ${proofShape}`,
      scenario: 'Review one sample finding from the lane.',
      expectation: 'The result points to a concrete craft move, comparison, or warning the author can use.',
      verifiedBy: 'review',
      source: 'inferred',
      met: false,
    })
  }
  criteria.push(deterministicImportedCriterion(task, proofCommand, 'The reviewer lane has deterministic proof over a bounded fiction fixture.'))
  return criteria
}

function deriveWorkflowAcceptanceCriteria(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
): Task['acceptanceCriteria'] {
  const chainSteps = (
    evidenceDetail.decisionSteps.length > 0
      ? evidenceDetail.decisionSteps
      : evidenceDetail.implementationBullets
  ).slice(0, 7)
  const weightDimensions = evidenceDetail.weightDimensions.slice(0, 6)
  const severityLevels = evidenceDetail.severityLevels.slice(0, 6)
  const boundaryRules = (
    evidenceDetail.rules.length > 0
      ? evidenceDetail.rules
      : [
          ...evidenceDetail.goalStatements,
          summarizeImportedProblemContext(task, evidenceDetail),
        ]
  ).slice(0, 3)
  const proofCommand = firstImportedProofCommand(task)
  const criteria: Task['acceptanceCriteria'] = []

  if (chainSteps.length > 0) {
    criteria.push({
      id: 'workflow-order',
      description: `${task.title} preserves the documented workflow order: ${chainSteps.join(' -> ')}`,
      scenario: `Pass one set of reviewer findings through ${task.title}.`,
      expectation: 'Findings become ordered constraints and decisions in the same sequence the cited spec defines.',
      verifiedBy: 'review',
      source: 'inferred',
      met: false,
    })
  }
  if (weightDimensions.length > 0) {
    criteria.push({
      id: 'weight-profile',
      description: `Findings carry the documented weight profile fields: ${weightDimensions.join(', ')}.`,
      scenario: 'Inspect one finding record produced by the workflow.',
      expectation: 'Weight is structured and multidimensional rather than a single flat priority number.',
      verifiedBy: 'review',
      source: 'inferred',
      met: false,
    })
  }
  if (severityLevels.length > 0) {
    criteria.push({
      id: 'severity-contract',
      description: `The workflow preserves the cited severity model, including ${severityLevels.join(', ')}.`,
      scenario: 'Record at least one weighted finding with severity.',
      expectation: 'Protect-level and higher-severity findings survive the pipeline without being flattened away.',
      verifiedBy: 'review',
      source: 'inferred',
      met: false,
    })
  }
  if (boundaryRules.length > 0) {
    criteria.push({
      id: 'fiction-boundary',
      description: `${task.title} enforces the fiction-first boundary from the cited spec: ${boundaryRules.join('; ')}`,
      scenario: 'Review workflow output for a scene where generic optimization would be harmful.',
      expectation: 'The workflow protects voice, ambiguity, and genre-specific intent instead of optimizing for generic prose polish.',
      verifiedBy: 'review',
      source: 'inferred',
      met: false,
    })
  }
  criteria.push(deterministicImportedCriterion(task, proofCommand, 'The workflow has deterministic proof using a bounded set of findings, weights, and output records.'))
  return criteria
}

function deriveGeneralImportedAcceptanceCriteria(
  task: MaterializedImportTask,
): Task['acceptanceCriteria'] {
  const proofCommand = firstImportedProofCommand(task)
  switch (importedGeneralShapeKind(task)) {
    case 'retrieval':
      return [
        {
          id: 'retrieval-surface',
          description: 'The retrieval surface names the story-record questions the task is allowed to answer.',
          scenario: `Review the intended query surface for ${task.title}.`,
          expectation: 'Character, scene, reader-state, and world questions have explicit retrieval boundaries.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'deterministic-record-lookup',
          description: 'Repeated retrieval requests over the same structured records resolve the same answers.',
          scenario: 'Replay the same retrieval prompt against the same bounded record set.',
          expectation: 'The task resolves through structured records instead of ad hoc manuscript rereads.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'retrieval-provenance',
          description: 'Retrieval output cites the records it used and respects provenance/privacy boundaries.',
          scenario: 'Inspect one retrieval answer that depends on multiple record types.',
          expectation: 'Consumers can tell where the answer came from and which sources stayed blocked.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        deterministicImportedCriterion(task, proofCommand, 'The retrieval surface has deterministic local proof.'),
      ]
    case 'agent_call':
      return [
        {
          id: 'agent-call-contract',
          description: 'The agent call names the packet contract it receives before any model execution happens.',
          scenario: `Inspect the request payload for ${task.title}.`,
          expectation: 'Constraint stack, privacy manifest, and related bounded inputs are explicit and typed.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'bounded-agent-inputs',
          description: 'The agent call receives only the bounded inputs the docs authorize.',
          scenario: 'Run one writer/editor call with both allowed and blocked provenance in scope.',
          expectation: 'Blocked provenance stays out of the agent call while allowed context still arrives.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        deterministicImportedCriterion(task, proofCommand, 'The agent call has deterministic local proof.'),
      ]
    case 'invalidation':
      return [
        {
          id: 'stale-context-detection',
          description: 'Edits identify which derived context is now stale.',
          scenario: 'Edit one section or scene after an initial bounded run.',
          expectation: 'Affected scene, reader-state, or packet-derived records are marked stale explicitly.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'rerun-boundary',
          description: 'The next run excludes or refreshes stale context before reuse.',
          scenario: 'Trigger a rerun after a source edit.',
          expectation: 'The rerun does not silently reuse invalid packet or retrieval context.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        deterministicImportedCriterion(task, proofCommand, 'Invalidation behavior has deterministic local proof.'),
      ]
    case 'telemetry':
      return [
        {
          id: 'telemetry-record-shape',
          description: 'Telemetry records capture cost, latency, quality, and related run identifiers in a stable shape.',
          scenario: `Inspect one recorded run for ${task.title}.`,
          expectation: 'Operators can compare runs without reconstructing telemetry from raw logs.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'telemetry-emission',
          description: 'Bounded prototype runs emit telemetry alongside their run evidence.',
          scenario: 'Complete one local proof run.',
          expectation: 'Telemetry stays attached to the run instead of being recorded in a disconnected stream.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        deterministicImportedCriterion(task, proofCommand, 'Telemetry records have deterministic local proof.'),
      ]
    case 'general':
      return [
        {
          id: 'task-boundary',
          description: `${task.title} has an explicit operating boundary tied to the cited project evidence.`,
          scenario: `Review the intended boundary for ${task.title}.`,
          expectation: 'The task names what it owns instead of standing in for a whole roadmap area.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'runtime-slice',
          description: `${task.title} produces a concrete runtime or data slice inside that boundary.`,
          scenario: 'Exercise the bounded behavior locally.',
          expectation: 'The imported task resolves to concrete behavior rather than a planning placeholder.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        deterministicImportedCriterion(task, proofCommand, 'The imported task has deterministic local proof.'),
      ]
  }
}

function firstImportedProofCommand(task: MaterializedImportTask): string | null {
  const proofCommand = simpleImportedProofPaths(task.proofPaths).find(
    proof =>
      proof.kind === 'command' &&
      proof.source !== 'inferred' &&
      typeof proof.command === 'string' &&
      proof.command.trim() &&
      isConcreteProjectProofCommand(proof.command),
  )
  if (proofCommand?.command?.trim()) return proofCommand.command.trim()
  return null
}

function deterministicImportedCriterion(
  task: MaterializedImportTask,
  command: string | null,
  defaultDescription: string,
): Task['acceptanceCriteria'][number] {
  return {
    id: 'deterministic-proof',
    description: command ? `${task.title} is covered by deterministic local proof via \`${command}\`.` : `Add bounded local workspace proof for ${task.title}.`,
    scenario: 'Execute the local proof path for this imported task.',
    expectation: command
      ? `\`${command}\` passes and records evidence for the cited task boundary.`
      : 'A real local proof path exists, passes, and is recorded with the task.',
    verifiedBy: command ? 'automated' : 'review',
    source: command ? 'documented' : 'inferred',
    ...(command ? { command } : {}),
    met: false,
  }
}

function summarizeImportedVerificationEvidence(
  evidenceDetail: ImportedEvidenceDetail,
  fallback: string,
): string {
  return evidenceDetail.verificationBullets[0]?.replace(/\.$/, '') || fallback
}

function summarizeImportedImplementationEvidence(
  evidenceDetail: ImportedEvidenceDetail,
  fallback: string,
): string {
  const first = evidenceDetail.implementationBullets[0]?.replace(/\.$/, '') || ''
  if (!first) return fallback
  if (/^`[^`]+`$/.test(first)) return fallback
  if (/^[A-Z][A-Za-z0-9]+$/.test(first)) return fallback
  return first
}

function deriveContractProofPaths(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
): Task['proofPaths'] {
  const command = firstImportedProofCommand(task)
  const contractList = evidenceDetail.contractNames.slice(0, 4).map(name => `\`${name}\``).join(', ')
  const verificationSummary = summarizeImportedVerificationEvidence(
    evidenceDetail,
    'The run/evaluation proof records the cited packet, trace, and evaluation artifacts',
  )
  const implementationSummary = summarizeImportedImplementationEvidence(
    evidenceDetail,
    'The imported schema layer exposes the cited fixture and run contracts without ad hoc gaps',
  )
  return [
    importedCommandProofExpectation(task, command, [
      verificationSummary,
    ]),
    {
      kind: 'review' as const,
      source: 'inferred' as const,
      expectedEvidence: [
        ...new Set([
          contractList
            ? `The imported contract surface explicitly names and uses ${contractList}.`
            : implementationSummary,
          implementationSummary,
        ]),
      ],
    },
  ]
}

function importedCommandProofPath(
  command: string,
  expectedEvidence: string[],
  source: 'documented' | 'inferred',
): NonNullable<Task['proofPaths']>[number] {
  const evidence = expectedEvidence.length > 0
    ? expectedEvidence
    : [`Command \`${command}\` completes successfully and records proof for the imported task boundary.`]
  return {
    kind: 'command' as const,
    command,
    source,
    launchSteps: [{
      id: importedCommandId(command),
      title: command,
      kind: 'copy_command',
      command,
    }],
    expectedEvidence: evidence,
  }
}

function importedMissingCommandProofPath(
  task: Pick<MaterializedImportTask, 'id' | 'title'>,
  expectedEvidence: string[],
): NonNullable<Task['proofPaths']>[number] {
  const title = task.title.replace(/[.?!]\s*$/, '')
  return {
    kind: 'command' as const,
    source: 'inferred' as const,
    launchSteps: [{
      id: `${task.id}-proof-command-needed`,
      title: 'Add proof command',
      kind: 'blocked_until_setup',
      setupRequirement: 'No repo-local pnpm script or CLI proof command is named yet.',
      ownerAction: `Name or implement the command that proves ${title}.`,
    }],
    expectedEvidence,
  }
}

function importedCommandProofExpectation(
  task: Pick<MaterializedImportTask, 'id' | 'title'>,
  command: string | null,
  expectedEvidence: string[],
): NonNullable<Task['proofPaths']>[number] {
  return command
    ? importedCommandProofPath(command, expectedEvidence, 'documented')
    : importedMissingCommandProofPath(task, expectedEvidence)
}

function materializedProofPaths(
  task: MaterializedImportTask,
  evidenceDetail?: ImportedEvidenceDetail,
): Task['proofPaths'] {
  const current = replaceGenericProjectProofPathsWithSetup({
    id: task.id,
    title: task.title,
    proofPaths: task.proofPaths?.map(normalizeImportedProofPath),
  })
  const fallback = importedAcceptanceProofPath(task, evidenceDetail)
  if (!evidenceDetail) return current.length > 0 ? current : fallback
  const semanticProofPaths = semanticImportProofPaths({ ...task, proofPaths: current })
  if (semanticProofPaths) return semanticProofPaths
  const prototypeTaskKind = importedPrototypeTaskKind(task)
  if (prototypeTaskKind) {
    const command = firstImportedProofCommand(task)
    switch (prototypeTaskKind) {
      case 'fixture':
        return [
          importedCommandProofExpectation(task, command, ['The bounded fixture and expected records load and compare successfully.']),
          {
            kind: 'review' as const,
            source: 'inferred' as const,
            expectedEvidence: [
              'The fixture covers manuscript text, brief/profile context, notes, expected records, and author decisions.',
              'Ground truth records are stable enough for repeated no-UI runs.',
            ],
          },
        ]
      case 'runner':
        return [
          importedCommandProofExpectation(task, command, ['The runner ingests the fixture, builds records, runs a packet, and saves output.']),
          {
            kind: 'review' as const,
            source: 'inferred' as const,
            expectedEvidence: [
              'The run stays inside the no-UI harness boundary.',
              'Saved run output is traceable back to the fixture inputs.',
            ],
          },
        ]
      case 'evaluation':
        return [
          importedCommandProofExpectation(task, command, ['Evaluation output classifies missing, noisy, stale, useful, schema, and model-behavior outcomes.']),
          {
            kind: 'review' as const,
            source: 'inferred' as const,
            expectedEvidence: [
              'Evaluation reports are comparable across repeated runs.',
              'Failure categories are specific enough to guide packet and schema fixes.',
            ],
          },
        ]
      case 'debug_report':
        return [
          importedCommandProofExpectation(task, command, ['The debug report records the run summary, packet/context receipts, and trace spine.']),
          {
            kind: 'review' as const,
            source: 'inferred' as const,
            expectedEvidence: [
              'The report explains why context was included, omitted, retrieved, or marked stale.',
              'Trace detail respects the same privacy boundary as packets.',
            ],
          },
        ]
      case 'schema_prune':
        return [
          importedCommandProofExpectation(task, command, ['The first bounded run still passes after schema narrowing.']),
          {
            kind: 'review' as const,
            source: 'inferred' as const,
            expectedEvidence: [
              'The narrowed schema is justified by the MVP contract boundary questions.',
              'Deferred fields are explicitly recorded instead of silently kept.',
            ],
          },
        ]
    }
  }
  if (importedTaskLooksWorkflowDriven(task, evidenceDetail)) {
    const command = firstImportedProofCommand(task)
    const verificationSummary = summarizeImportedVerificationEvidence(
      evidenceDetail,
      'The workflow records deterministic finding, weighting, and packet output evidence',
    )
    return [
      ...(command ? [importedCommandProofPath(command, [verificationSummary], 'documented')] : []),
      {
        kind: 'review' as const,
        source: 'inferred' as const,
        expectedEvidence: [
          evidenceDetail.decisionSteps.length > 0
            ? `Output follows the documented chain: ${evidenceDetail.decisionSteps.slice(0, 4).join(' -> ')}`
            : 'Output follows the documented workflow order.',
          evidenceDetail.weightDimensions.length > 0
            ? `Findings preserve weight dimensions such as ${evidenceDetail.weightDimensions.slice(0, 4).join(', ')}.`
            : 'Findings preserve the structured weight profile from the cited spec.',
        ],
      },
    ]
  }
  if (importedTaskLooksContractDriven(task)) {
    return deriveContractProofPaths(task, evidenceDetail)
  }
  if (importedTaskLooksReviewerLane(task, evidenceDetail)) {
    const command = firstImportedProofCommand(task)
    const verificationSummary = summarizeImportedVerificationEvidence(
      evidenceDetail,
      'The reviewer lane runs against a bounded fiction fixture and records structured findings',
    )
    return [
      ...(command ? [importedCommandProofPath(command, [verificationSummary], 'documented')] : []),
      {
        kind: 'review' as const,
        source: 'inferred' as const,
        expectedEvidence: [
          evidenceDetail.reviewQuestions.length > 0
            ? `Recorded findings answer prompts such as: ${evidenceDetail.reviewQuestions.slice(0, 2).join(' ')}`
            : 'Recorded findings stay anchored to the cited reviewer prompts.',
          evidenceDetail.rules.length > 0
            ? `The lane preserves the documented boundary: ${evidenceDetail.rules.slice(0, 2).join('; ')}`
            : 'The lane preserves the cited fiction-specific boundary.',
        ],
      },
    ]
  }
  const command = firstImportedProofCommand(task)
  switch (importedGeneralShapeKind(task)) {
    case 'retrieval':
      return [
        ...(command ? [importedCommandProofPath(command, ['Retrieval answers stay deterministic and cite structured story records.'], 'documented')] : []),
        {
          kind: 'review' as const,
          source: 'inferred' as const,
          expectedEvidence: [
            'Retrieval answers name the records they used.',
            'Blocked provenance stays out of retrieval output.',
          ],
        },
      ]
    case 'agent_call':
      return [
        ...(command ? [importedCommandProofPath(command, ['The agent call receives the bounded packet contract and keeps blocked provenance out of output.'], 'documented')] : []),
        {
          kind: 'review' as const,
          source: 'inferred' as const,
          expectedEvidence: [
            'Constraint stack and privacy manifest are visible in the call boundary.',
            'Blocked provenance never appears in tool calls or model output.',
          ],
        },
      ]
    case 'invalidation':
      return [
        ...(command ? [importedCommandProofPath(command, ['Edited sections or scenes invalidate stale context before reruns reuse it.'], 'documented')] : []),
        {
          kind: 'review' as const,
          source: 'inferred' as const,
          expectedEvidence: [
            'Affected derived context is marked stale after edits.',
            'The rerun excludes or refreshes stale packet and retrieval context.',
          ],
        },
      ]
    case 'telemetry':
      return [
        ...(command ? [importedCommandProofPath(command, ['Bounded runs emit cost, latency, quality, and run identity telemetry.'], 'documented')] : []),
        {
          kind: 'review' as const,
          source: 'inferred' as const,
          expectedEvidence: [
            'Telemetry records stay attached to the run evidence they describe.',
            'Cost, latency, and quality can be compared across repeated runs.',
          ],
        },
      ]
    case 'general':
      if (command) {
        return [
          importedCommandProofPath(command, [
            ...materializedAcceptanceCriteria(task, evidenceDetail).map(criterion => criterion.description.trim()).filter(Boolean).slice(0, 6),
          ], 'documented'),
          ...current.filter(proof => proof.kind !== 'command'),
        ]
      }
      if (current.length > 0) return current
      if (evidenceDetail.verificationBullets.length > 0) {
        return [{
          kind: 'review',
          source: 'documented',
          expectedEvidence: evidenceDetail.verificationBullets.slice(0, 6),
        }]
      }
      return fallback
  }
}

function semanticImportProofPaths(
  task: MaterializedImportTask,
): Task['proofPaths'] | null {
  const command = firstImportedProofCommand(task)
  const reviewPath = (expectedEvidence: string): NonNullable<Task['proofPaths']>[number] => ({
    kind: 'review',
    source: 'inferred',
    expectedEvidence: [expectedEvidence],
  })

  switch (task.semanticKind) {
    case 'drafting_model':
      return [
        importedCommandProofExpectation(task, command, ['The model bakeoff records comparable structured results across the selected genre matrix.']),
        reviewPath('The selected model record includes quality, refusal, repetition, cost, latency, and content-boundary fields.'),
      ]
    case 'author_intent':
      return [
        importedCommandProofExpectation(task, command, ['The author-intent record round-trips through the bounded packet and review inputs.']),
        reviewPath('The structured intent record contains the declared voice, genre, audience, theme, story-shape, world-state, and review-plan fields.'),
      ]
    case 'chapter_draft':
      return [
        importedCommandProofExpectation(task, command, ['The synopsis-to-chapter pipeline emits the declared structured records and bounded chapter output.']),
        reviewPath('The draft result identifies the input records and preserves the requested author and genre constraints.'),
      ]
    case 'world_state_review':
      return [
        importedCommandProofExpectation(task, command, ['The world-state fixture produces structured findings for elapsed time and object/property transitions.']),
        reviewPath('Each finding identifies the entity, prior state, later state, elapsed time, environment, and any explicit world-rule exception.'),
      ]
    case 'spatial_review':
      return [
        importedCommandProofExpectation(task, command, ['The spatial fixture produces structured findings for distance, terrain, travel mode, speed, weather, light, and map consistency.']),
        reviewPath('Each finding identifies the passage, location, movement claim, expected plausible behavior, difference, severity, and evidence.'),
      ]
    default:
      return null
  }
}

function importedAcceptanceProofPath(
  task: MaterializedImportTask,
  evidenceDetail?: ImportedEvidenceDetail,
): Task['proofPaths'] {
  const criteria = evidenceDetail ? materializedAcceptanceCriteria(task, evidenceDetail) : (task.acceptanceCriteria ?? [])
  const expectedEvidence = criteria
    .map(criterion => criterion.description.trim())
    .filter(Boolean)
  if (expectedEvidence.length === 0) return []
  return [{
    kind: 'review',
    source: 'inferred',
    expectedEvidence: expectedEvidence.slice(0, 6),
  }]
}

function splitMarkdownSections(content: string): Array<{ heading: string; body: string }> {
  const lines = content.split(/\r?\n/)
  const sections: Array<{ heading: string; body: string }> = []
  let currentHeading = '(intro)'
  let currentBody: string[] = []
  for (const line of lines) {
    const heading = /^#{2,6}\s+(.+?)\s*$/.exec(line)
    if (heading) {
      sections.push({ heading: currentHeading, body: currentBody.join('\n').trim() })
      currentHeading = heading[1]!.trim()
      currentBody = []
      continue
    }
    currentBody.push(line)
  }
  sections.push({ heading: currentHeading, body: currentBody.join('\n').trim() })
  return sections
}

function parseMarkdownTableFirstColumn(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('|'))
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
    .filter(cells => cells.length > 0 && cells[0] && !/^[-\s]+$/.test(cells[0]) && !/^(dimension|level)$/i.test(cells[0]))
    .map(cells => cells[0]!)
}

function cleanedImportedBullet(line: string): string {
  return line
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^\*\*([^*]+):\*\*\s*/u, '')
    .trim()
}

function importedRawLineIsMetadata(line: string): boolean {
  const trimmed = line.trim()
  return /\*\*(recommended first task title|recommended domain|stage alignment|why not decomposed yet):\*\*/i.test(trimmed)
}

function importedBulletIsAuditNoise(bullet: string): boolean {
  return (
    /^\[[ x]\]\s+/i.test(bullet) ||
    // A command plus its captured status is an evidence record, not a
    // durable implementation rule. Keep it out of imported task prose based
    // on its machine-shaped syntax, regardless of the provider's wording for
    // the status (MISSING, absent, failed, etc.).
    /^`[^`\n]+`\s*(?:->|=>|→)/i.test(bullet)
  )
}

function importedBulletIsPlanningMetadata(bullet: string): boolean {
  return /^(covers|recommended first task title|recommended domain|stage alignment|why not decomposed yet|depends on|current next milestone)\b/i.test(bullet)
}

function markdownSectionAllowsContractNameExtraction(section: {
  body: string
  contractSection: boolean
  genericSequenceSection: boolean
  matchesTaskContractTerms: boolean
  sectionMatchesReferenceSlug: boolean
}): boolean {
  if (!section.contractSection || section.genericSequenceSection) return false
  if (!section.matchesTaskContractTerms) return false
  if (/\bneeded contracts\s*:/i.test(section.body)) return true
  return section.sectionMatchesReferenceSlug
}

function extractGoalStatements(content: string): string[] {
  const lines = content.split(/\r?\n/)
  const statements: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index]?.trim() ?? ''
    const goalMatch = /^goal:\s*(.+)$/i.exec(current)
    if (!goalMatch?.[1]) continue
    const parts = [goalMatch[1].trim()]
    let cursor = index + 1
    while (cursor < lines.length) {
      const nextRaw = lines[cursor] ?? ''
      const next = nextRaw.trim()
      if (!next) break
      if (/^#{1,6}\s+/.test(next)) break
      if (/^(goal:|deliverables:|needed contracts:|purpose:|minimum [^:]+:)/i.test(next)) break
      if (/^[-*]\s+/.test(next) || /^\d+[.)]\s+/.test(next)) break
      parts.push(next)
      cursor += 1
    }
    const statement = parts.join(' ').replace(/\s+/g, ' ').trim()
    if (statement && !statements.includes(statement)) statements.push(statement)
  }
  return statements
}

function readImportedReferenceContent(
  reference: string,
  workspaceProjectPath: string,
): string | null {
  const absolute = absoluteImportedReference(reference, workspaceProjectPath)
  try {
    return readManagedTextFileSync(absolute, 'utf-8')
  } catch {
    return null
  }
}

function keywordOverlapScore(text: string, keywords: readonly string[]): number {
  const haystack = normalizeImportText(text)
  return keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0), 0)
}

function importedReferenceSlug(reference: string): string | null {
  const normalized = reference.replace(/\\/g, '/')
  const base = normalized.split('/').pop()?.trim() ?? ''
  if (!base.toLowerCase().endsWith('.md')) return null
  return normalizeImportText(base.replace(/\.md$/i, ''))
}

function extractReferenceEvidenceDetail(
  task: MaterializedImportTask,
  workspaceProjectPath: string,
  referenceContents?: ReadonlyMap<string, string>,
): ImportedEvidenceDetail {
  // Source evidence is selected from explicit references and structured
  // sections. A task title is display text, not a source-retrieval key.
  const keywords: readonly string[] = []
  const referenceSlugs = [...new Set(
    task.references
      .map(reference => importedReferenceSlug(reference))
      .filter((slug): slug is string => Boolean(slug)),
  )]
  const contractNames = new Set<string>(task.contractNames ?? [])
  const hasExplicitContractNames = contractNames.size > 0
  const implementationBullets: string[] = []
  const verificationBullets: string[] = []
  const goalStatements: string[] = []
  const reviewQuestions: string[] = []
  const decisionSteps: string[] = []
  const rules: string[] = []
  const examples: string[] = []
  const weightDimensions: string[] = []
  const severityLevels: string[] = []
  const coreLoopSteps: string[] = []
  const systemRecords: string[] = []
  const packetFields: string[] = []
  const privacyRules: string[] = []
  const invalidationRules: string[] = []
  const titleSuggestsContracts = task.semanticKind === 'contract'

  for (const reference of task.references) {
    const normalizedReference = reference.replace(/\\/g, '/')
    const content = referenceContents?.get(reference) ??
      referenceContents?.get(normalizedReference) ??
      readImportedReferenceContent(reference, workspaceProjectPath)
    if (!content) continue
    const inventoryStyleReference = /remaining-spec-decomposition-inventory\.md$/i.test(normalizedReference)
    for (const statement of extractGoalStatements(content)) {
      if (!goalStatements.includes(statement)) goalStatements.push(statement)
    }
    const sections = splitMarkdownSections(content)
    for (const section of sections) {
      const lowerHeading = section.heading.toLowerCase()
      const sectionLines = section.body.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
      if (/feedback weight dimensions/i.test(section.heading)) {
        for (const item of parseMarkdownTableFirstColumn(section.body)) {
          if (!weightDimensions.includes(item)) weightDimensions.push(item)
        }
      }
      if (/system records/i.test(section.heading)) {
        for (const item of parseMarkdownTableFirstColumn(section.body)) {
          if (!systemRecords.includes(item)) systemRecords.push(item)
        }
      }
      if (/severity levels/i.test(section.heading)) {
        for (const item of parseMarkdownTableFirstColumn(section.body)) {
          if (!severityLevels.includes(item)) severityLevels.push(item)
        }
      }
      for (const line of sectionLines) {
        if (!/^[-*]\s+/.test(line) && !/^\d+[.)]\s+/.test(line)) continue
        if (importedRawLineIsMetadata(line)) continue
        const bullet = cleanedImportedBullet(line)
        if (!bullet) continue
        if (importedBulletIsAuditNoise(bullet)) continue
        // An open question is a question-shaped source record. A heading such
        // as "Reviewer Questions" is not enough to turn a statement into a
        // question, especially when a model used that heading loosely.
        if (/\?$/.test(bullet)) {
          if (reviewQuestions.length < 6 && !reviewQuestions.includes(bullet)) reviewQuestions.push(bullet)
        }
        if (/decision tree|ordered feedback chain|grounding pass|core claim/i.test(lowerHeading)) {
          if (decisionSteps.length < 8 && !decisionSteps.includes(bullet)) decisionSteps.push(bullet)
        }
        if (/^core loop$/i.test(lowerHeading)) {
          if (coreLoopSteps.length < 8 && !coreLoopSteps.includes(bullet)) coreLoopSteps.push(bullet)
        }
        if (/rules|boundary|fiction-first boundary|dialect, register, and respect|finding contract|severity levels|core claim/i.test(lowerHeading)) {
          if (rules.length < 8 && !rules.includes(bullet)) rules.push(bullet)
        }
        if (/\b(packet|writer packet|chapter writer packet)\b/i.test(lowerHeading)) {
          if (packetFields.length < 8 && !packetFields.includes(bullet)) packetFields.push(bullet)
        }
        if (/\b(provenance|privacy)\b/i.test(lowerHeading)) {
          if (privacyRules.length < 6 && !privacyRules.includes(bullet)) privacyRules.push(bullet)
        }
        if (/\binvalidation\b/i.test(lowerHeading)) {
          if (invalidationRules.length < 6 && !invalidationRules.includes(bullet)) invalidationRules.push(bullet)
        }
        if (/examples/i.test(lowerHeading)) {
          if (examples.length < 4 && !examples.includes(bullet)) examples.push(bullet)
        }
      }
    }
    const rankedSections = sections
      .map(section => {
        const haystack = normalizeImportText(`${section.heading}\n${section.body}`)
        const score = keywords.reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0), 0)
        const heading = section.heading.toLowerCase()
        const sectionMatchesReferenceSlug = referenceSlugs.some(slug => slug.length > 0 && haystack.includes(slug))
        const sectionMentionsAnotherSpecSlug =
          inventoryStyleReference &&
          referenceSlugs.length > 0 &&
          /\.md`?/i.test(section.heading) &&
          !sectionMatchesReferenceSlug
        const contractSection =
          /\b(schema|trace|run record|fixture shape|prototype run|expected-record|needed contracts|first mvp candidate|minimum prototype requirements)\b/i.test(section.heading) ||
          /\bneeded contracts:\b/i.test(section.body)
        const matchesTaskContractTerms = task.semanticKind === 'contract' && contractSection
        const verificationSection = /^(?:\d+[.)]?\s*)?(verification|evaluation|rubric|run record|trace spine|success criteria|proof)\b/i.test(section.heading.trim())
        const genericSequenceSection =
          /\b(current next milestone|iteration round|test rounds|recommended decomposition order)\b/i.test(heading)
        return {
          ...section,
          score:
            score +
            (sectionMatchesReferenceSlug ? 10 : 0) +
            (titleSuggestsContracts && contractSection && matchesTaskContractTerms ? 6 : 0) +
            (verificationSection ? 2 : 0) -
            (sectionMentionsAnotherSpecSlug ? 12 : 0) -
            (genericSequenceSection ? 4 : 0),
          contractSection,
          matchesTaskContractTerms,
          verificationSection,
          genericSequenceSection,
          sectionMatchesReferenceSlug,
          sectionMentionsAnotherSpecSlug,
        }
      })
      .filter(section =>
        (!inventoryStyleReference || !section.sectionMentionsAnotherSpecSlug) && (
          section.score > 0 ||
        (section.contractSection && section.matchesTaskContractTerms) ||
        section.verificationSection ||
          sections.length === 1
        ),
      )
      .sort((left, right) => right.score - left.score)
      .slice(0, 6)

    for (const section of rankedSections) {
      const lowerHeading = section.heading.toLowerCase()
      const sectionLines = section.body.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
      if (markdownSectionAllowsContractNameExtraction(section)) {
        if (hasExplicitContractNames) continue
        for (const match of section.body.matchAll(/`([^`\n]{2,80})`/g)) {
          const name = match[1]!.trim()
          if (/^[A-Za-z][A-Za-z0-9_-]+$/.test(name)) contractNames.add(name)
        }
      }
      for (const line of sectionLines) {
        if (!/^[-*]\s+/.test(line) && !/^\d+[.)]\s+/.test(line)) continue
        if (importedRawLineIsMetadata(line)) continue
        const bullet = cleanedImportedBullet(line)
        if (!bullet) continue
        if (importedBulletIsAuditNoise(bullet)) continue
        const bulletKeywordScore = keywordOverlapScore(bullet, keywords)
        const allowGenericSequenceBullet = !section.genericSequenceSection || bulletKeywordScore > 0
        if (allowGenericSequenceBullet && section.verificationSection) {
          if (verificationBullets.length < 5) verificationBullets.push(bullet)
          continue
        }
        if (importedBulletIsPlanningMetadata(bullet)) continue
        if (!allowGenericSequenceBullet) continue
        if (section.genericSequenceSection && !section.contractSection) continue
        if (/examples/i.test(lowerHeading)) continue
        if (titleSuggestsContracts && !section.contractSection && /^(\d+\.|stage\s+\d+)/i.test(line)) continue
        if (implementationBullets.length < 6) implementationBullets.push(bullet)
      }
    }
  }

  return {
    contractNames: [...contractNames].slice(0, 10),
    implementationBullets: implementationBullets
      .filter(item => !importedBulletIsAuditNoise(item))
      .slice(0, 6),
    verificationBullets: verificationBullets
      .filter(item => !importedBulletIsAuditNoise(item))
      .slice(0, 5),
    goalStatements: goalStatements
      .sort((left, right) => keywordOverlapScore(right, keywords) - keywordOverlapScore(left, keywords))
      .slice(0, 4),
    reviewQuestions: reviewQuestions.slice(0, 6),
    decisionSteps: decisionSteps.slice(0, 8),
    rules: rules.slice(0, 8),
    examples: examples.slice(0, 4),
    weightDimensions: weightDimensions.slice(0, 8),
    severityLevels: severityLevels.slice(0, 8),
    coreLoopSteps: coreLoopSteps.slice(0, 8),
    systemRecords: systemRecords.slice(0, 8),
    packetFields: packetFields.slice(0, 8),
    privacyRules: privacyRules.slice(0, 6),
    invalidationRules: invalidationRules.slice(0, 6),
  }
}

function summarizeImportedProblemContext(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
): string {
  const explicit = task.whyThisMayMatter?.trim()
  if (explicit && !/is a prerequisite the project evidence already connects to/i.test(explicit)) return explicit
  const goalStatement = evidenceDetail.goalStatements[0]?.trim()
  if (goalStatement) return goalStatement
  if (explicit) return explicit
  const verificationSummary = evidenceDetail.verificationBullets[0]?.trim()
  if (verificationSummary) {
    return `This task exists to make the documented proof loop possible: ${verificationSummary.replace(/\.$/, '')}.`
  }
  return task.description.trim() || `${task.title} is imported current-scope work backed by the cited project evidence.`
}

function importedStructuredSpec(
  task: MaterializedImportTask,
  workspaceProjectPath: string,
): NonNullable<Task['structuredSpec']> {
  const evidenceDetail = extractReferenceEvidenceDetail(task, workspaceProjectPath)
  const acceptanceCriteria = materializedAcceptanceCriteria(task, evidenceDetail)
  const assumptions = (task.assumptions ?? []).filter(Boolean)
  const missingInformation = cleanImportedMissingInformation(task.missingInformation ?? [])
  const importedContext = summarizeImportedProblemContext(task, evidenceDetail)
  const proposedDesignBullets = importedTaskProposedDesignBullets(task, evidenceDetail)
  const proofPlan = simpleImportedProofPaths(materializedProofPaths(task, evidenceDetail)).map((path) => {
    if (path.kind === 'command' && typeof path.command === 'string' && path.command.trim()) {
      return `Run \`${path.command.trim()}\``
    }
    if (path.kind === 'browser') return 'Capture browser proof for the documented flow.'
    if (path.kind === 'review') {
      const expected = Array.isArray(path.expectedEvidence) ? path.expectedEvidence.filter(Boolean).join(', ') : ''
      return expected ? `Review recorded evidence: ${expected}` : 'Review the documented proof output.'
    }
    return null
  }).filter((line): line is string => Boolean(line))
  const verification = proofPlan.length > 0
    ? proofPlan
    : evidenceDetail.verificationBullets.length > 0
      ? evidenceDetail.verificationBullets
      : [`Run the documented proof plan for ${task.title} and record the result.`]
  const successMetric = summarizeImportedSuccessMetric(task, evidenceDetail)
  const proposedDesign = proposedDesignBullets.length > 0
    ? proposedDesignBullets.join('\n')
    : task.description.trim() || task.title
  return StructuredSpec.parse({
    whatThisIs: task.title,
    problemContext: importedContext,
    goals: [
      successMetric,
      ...(evidenceDetail.contractNames.length > 0
        ? [`Define and use the concrete contracts named in the cited docs: ${evidenceDetail.contractNames.join(', ')}.`]
        : []),
    ],
    nonGoals: missingInformation.length > 0
      ? missingInformation
      : ['Do not broaden beyond the cited evidence, acceptance criteria, and proof plan.'],
    proposedDesign,
    keyDecisions: [
      `Stay anchored to the imported evidence for ${task.title}.`,
      ...(assumptions.length > 0
        ? assumptions.map(item => `Assumption: ${item}`)
        : ['Reuse the documented project structure instead of inventing a new boundary.']),
    ],
    acceptanceCriteria: acceptanceCriteria.length > 0
      ? acceptanceCriteria.map((criterion) => ({
          scenario: criterion.scenario ?? criterion.description,
          expectation: criterion.expectation ?? criterion.description,
          verificationMode: criterion.verifiedBy === 'automated'
            ? 'automated'
            : criterion.verifiedBy === 'review'
              ? 'review'
              : 'human',
          ...(criterion.command ? { command: criterion.command } : {}),
          ...(criterion.expectedExit ? { expectedExit: criterion.expectedExit } : {}),
          ...(criterion.expectedOutputIncludes?.length ? { expectedOutputIncludes: criterion.expectedOutputIncludes } : {}),
          ...(criterion.evidenceHint ? { evidenceHint: criterion.evidenceHint } : {}),
          ...(criterion.negativeCase ? { negativeCase: criterion.negativeCase } : {}),
        }))
      : [{
          scenario: `Given the imported task ${task.title}, when it is shaped for execution`,
          expectation: 'Then it has concrete acceptance criteria and a recorded proof result.',
          verificationMode: 'review',
        }],
    verification,
    completionBoundary: {
      productOutcome: successMetric,
      whatGuildhallCanCompleteInCode: `Implement ${task.title} within the boundary described by the cited sources, acceptance criteria, and proof plan.`,
      externalDependencies: 'None beyond the cited repo-local evidence and the local tooling needed to run the proof plan.',
      ownerOnlySetup: 'None expected. Reshape the task if the imported evidence is stale or points at the wrong scope boundary.',
      verificationEnvironment: `Local filesystem and repo-local tooling; run the cited proof plan for ${task.title}.`,
      whatCountsAsDone: `${successMetric} Record the proof result against the imported acceptance criteria.`,
      whatMustBeSplitOrBlocked: 'Split only if the cited work contains independently verifiable deliverables. Block only for missing external credentials, unavailable services, or absent source evidence.',
      splitPolicy: 'conditional',
    },
  })
}

function importedTaskProposedDesignBullets(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
): string[] {
  if (task.semanticKind === 'reviewer_lane') {
    const bullets: string[] = []
    if (evidenceDetail.reviewQuestions.length > 0) {
      bullets.push(`Evaluate the documented review questions: ${evidenceDetail.reviewQuestions.join(' ')}`)
    }
    if (evidenceDetail.rules.length > 0) {
      bullets.push(`Shape findings around the documented review contract: ${evidenceDetail.rules.join('; ')}.`)
    }
    const scope = evidenceDetail.implementationBullets.find(item => !/\?$/.test(item))
    if (scope) {
      bullets.push(`Keep the lane scoped to the documented boundary: ${scope.replace(/\.$/, '')}.`)
    }
    if (bullets.length > 0) return bullets
  }
  if (importedPrototypeTaskKind(task) === 'runner') {
    const bullets: string[] = []
    if (evidenceDetail.systemRecords.length > 0) {
      bullets.push(`Load canonical story records for the runner: ${evidenceDetail.systemRecords.join(', ')}.`)
    }
    if (evidenceDetail.packetFields.length > 0) {
      bullets.push(`Build a bounded writer packet from the documented fields: ${evidenceDetail.packetFields.join(', ')}.`)
    }
    if (evidenceDetail.coreLoopSteps.length > 0) {
      bullets.push(`Keep the headless run aligned with the documented loop: ${evidenceDetail.coreLoopSteps.join(' -> ')}.`)
    }
    if (evidenceDetail.privacyRules.length > 0) {
      bullets.push(`Expose provenance/privacy scope in the run output: ${evidenceDetail.privacyRules.join('; ')}.`)
    }
    if (evidenceDetail.invalidationRules.length > 0) {
      bullets.push(`Mark packet context stale when source edits require it: ${evidenceDetail.invalidationRules.join('; ')}.`)
    }
    if (bullets.length > 0) return bullets
  }
  if ((task.acceptanceCriteria?.length ?? 0) > 0) {
    return (task.acceptanceCriteria ?? [])
      .map(criterion => criterion.description.trim())
      .filter(Boolean)
      .slice(0, 6)
  }
  return evidenceDetail.implementationBullets.length > 0 ? evidenceDetail.implementationBullets : []
}

function importedTaskBrief(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
  now: string,
): Task['productBrief'] {
  const cleanedNonGoals = (task.missingInformation ?? [])
    .filter(Boolean)
  return {
    userJob: summarizeImportedProblemContext(task, evidenceDetail),
    whyItMattersNow: summarizeImportedProblemContext(task, evidenceDetail),
    successMetric: summarizeImportedSuccessMetric(task, evidenceDetail),
    nonGoals: cleanedNonGoals,
    authoredBy: 'workspace-importer',
    authoredAt: now,
  }
}

function importedTaskWorkUnitAnalysis(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
  now: string,
): Task['workUnitAnalysis'] {
  const units = deriveImportedWorkUnits(task, evidenceDetail)
  const proofOnlyItems = [
    ...simpleImportedProofPaths(materializedProofPaths(task, evidenceDetail)).map((path) => {
      if (path.kind === 'command' && typeof path.command === 'string' && path.command.trim()) {
        return `Run ${path.command.trim()}`
      }
      if (path.kind === 'browser') return 'Capture browser proof for the documented flow.'
      if (path.kind === 'review') return 'Review the recorded proof output.'
      return ''
    }).filter(Boolean),
  ]
  return {
    summary: units.length === 1
      ? `One imported implementation unit for ${task.title}.`
      : `${units.length} evidence-backed work units define ${task.title}.`,
    units,
    proofOnlyItems,
    createdAt: now,
    createdBy: 'workspace-importer',
  }
}

function deriveImportedWorkUnits(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
): NonNullable<Task['workUnitAnalysis']>['units'] {
  const prototypeTaskKind = importedPrototypeTaskKind(task)
  if (prototypeTaskKind) {
    return derivePrototypeTaskWorkUnits(task, evidenceDetail, prototypeTaskKind)
  }
  if (importedTaskLooksWorkflowDriven(task, evidenceDetail)) {
    return deriveWorkflowWorkUnits(task, evidenceDetail)
  }
  if (importedTaskLooksContractDriven(task)) {
    return deriveContractWorkUnits(task, evidenceDetail)
  }
  if (importedTaskLooksReviewerLane(task, evidenceDetail)) {
    return deriveReviewerLaneWorkUnits(task, evidenceDetail)
  }
  return deriveGeneralImportedWorkUnits(task, evidenceDetail)
}

function derivePrototypeTaskWorkUnits(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
  kind: NonNullable<ReturnType<typeof importedPrototypeTaskKind>>,
): NonNullable<Task['workUnitAnalysis']>['units'] {
  const baseDependsOn = [...(task.dependsOn ?? [])]
  const proofCommand = firstImportedProofCommand(task)
  switch (kind) {
    case 'fixture':
      return [
        {
          id: `unit-${task.id}-fixture-shape`,
          title: 'Author the first bounded fiction fixture',
          deliverable: 'The fixture carries manuscript text, brief, profile, notes, expected records, and author decisions.',
          rationale: 'The no-UI harness needs a stable story fixture before packet and review proofs mean anything.',
          suggestedDomain: task.domain,
          dependsOn: baseDependsOn,
        },
        {
          id: `unit-${task.id}-ground-truth`,
          title: 'Record human-authored expected outputs',
          deliverable: 'Expected records capture the intended story facts and reviewable outcomes for repeated runs.',
          rationale: 'The harness needs explicit ground truth so it can compare generated records and findings deterministically.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-fixture-shape`],
        },
        ...(proofCommand ? [{
          id: `unit-${task.id}-proof`,
          title: 'Prove fixture repeatability in the no-UI harness',
          deliverable: `\`${proofCommand}\` passes against the bounded fixture and expected records.`,
          rationale: 'Fixture work is only trustworthy once the same fixture can drive repeated proof runs.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-ground-truth`],
        }] : []),
      ]
    case 'runner':
      return [
        {
          id: `unit-${task.id}-records`,
          title: 'Load fixture inputs and canonical story records',
          deliverable: evidenceDetail.systemRecords.length > 0
            ? `The runner ingests the fixture and materializes canonical records such as ${evidenceDetail.systemRecords.join(', ')}.`
            : 'The runner can ingest the bounded fixture and materialize the needed records.',
          rationale: 'The runner has to bridge from fixture inputs into deterministic packet-ready records.',
          suggestedDomain: task.domain,
          dependsOn: baseDependsOn,
        },
        {
          id: `unit-${task.id}-packet-run`,
          title: 'Build the bounded writer packet instead of rereading the manuscript',
          deliverable: evidenceDetail.packetFields.length > 0
            ? `The runner builds a bounded packet from fields such as ${evidenceDetail.packetFields.join(', ')}.`
            : 'The runner builds a bounded packet without whole-manuscript rereads.',
          rationale: 'The documented harness loop is supposed to prove packet discipline, not brute-force full-manuscript prompts.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-records`],
        },
        {
          id: `unit-${task.id}-loop`,
          title: 'Run the bounded reviewer and writer loop headlessly',
          deliverable: evidenceDetail.coreLoopSteps.length > 0
            ? `The headless runner preserves the documented loop: ${evidenceDetail.coreLoopSteps.join(' -> ')}.`
            : 'A packet run completes headlessly and emits reproducible output.',
          rationale: 'The Stage 1 harness should exercise the real review/writer loop, not a generic one-step command.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-packet-run`],
        },
        {
          id: `unit-${task.id}-privacy`,
          title: 'Prove provenance/privacy scope in packet output',
          deliverable: evidenceDetail.privacyRules.length > 0
            ? `Run output makes provenance decisions explicit: ${evidenceDetail.privacyRules.join('; ')}.`
            : 'Run output shows what provenance entered the packet and what stayed blocked.',
          rationale: 'The docs treat provenance scope as part of the proof loop, not a later polish layer.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-loop`],
        },
        {
          id: `unit-${task.id}-invalidation`,
          title: 'Invalidate stale packet context after source edits',
          deliverable: evidenceDetail.invalidationRules.length > 0
            ? `Edited inputs mark derived context stale according to rules like ${evidenceDetail.invalidationRules.join('; ')}.`
            : 'The next run excludes or flags stale context after relevant source edits.',
          rationale: 'The runner should prove stale-context handling before later phases pile more intelligence on top.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-privacy`],
        },
      ]
    case 'evaluation':
      return [
        {
          id: `unit-${task.id}-classification`,
          title: 'Classify evaluation outcomes',
          deliverable: 'Evaluation output distinguishes missing, noisy, stale, useful, schema, and model-behavior outcomes.',
          rationale: 'The harness needs precise failure categories to learn from runs instead of logging generic pass/fail.',
          suggestedDomain: task.domain,
          dependsOn: baseDependsOn,
        },
        {
          id: `unit-${task.id}-report-shape`,
          title: 'Emit a stable evaluation report',
          deliverable: 'Repeated runs produce comparable evaluation output.',
          rationale: 'The output should support side-by-side comparison as the harness changes.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-classification`],
        },
        ...(proofCommand ? [{
          id: `unit-${task.id}-proof`,
          title: 'Prove deterministic evaluation output',
          deliverable: `\`${proofCommand}\` records stable evaluation output for the bounded fixture.`,
          rationale: 'Evaluation logic needs deterministic proof before it can drive schema or packet decisions.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-report-shape`],
        }] : []),
      ]
    case 'debug_report':
      return [
        {
          id: `unit-${task.id}-trace-spine`,
          title: 'Connect packet, context, and trace into one report spine',
          deliverable: 'The report ties the run summary back to packet receipts and trace events.',
          rationale: 'Debuggability depends on following one surprising result back through the whole run.',
          suggestedDomain: task.domain,
          dependsOn: baseDependsOn,
        },
        {
          id: `unit-${task.id}-context-accounting`,
          title: 'Explain why context was included or dropped',
          deliverable: 'The report shows include/omit/retrieve/stale decisions for meaningful context items.',
          rationale: 'The harness should explain packet composition instead of only showing final output.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-trace-spine`],
        },
        ...(proofCommand ? [{
          id: `unit-${task.id}-proof`,
          title: 'Prove the debug report over a bounded run',
          deliverable: `\`${proofCommand}\` emits the traceable debug report for a fixture run.`,
          rationale: 'Traceability needs the same deterministic proof discipline as the rest of the harness.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-context-accounting`],
        }] : []),
      ]
    case 'schema_prune':
      return [
        {
          id: `unit-${task.id}-boundary`,
          title: 'Compare the first run against the MVP contract boundary',
          deliverable: 'The run is reviewed against the MVP questions that justify schema inclusion.',
          rationale: 'The docs explicitly say extra fields should stay out until a prototype run proves they matter.',
          suggestedDomain: task.domain,
          dependsOn: baseDependsOn,
        },
        {
          id: `unit-${task.id}-prune`,
          title: 'Record which schema fields stay, defer, or move to fixture metadata',
          deliverable: 'Schema narrowing is explicit and evidence-backed.',
          rationale: 'The MVP should keep only the fields the first run can justify.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-boundary`],
        },
        ...(proofCommand ? [{
          id: `unit-${task.id}-proof`,
          title: 'Prove the pruned schema against the first run',
          deliverable: `\`${proofCommand}\` passes after schema narrowing.`,
          rationale: 'The narrowed schema should still support the bounded proof loop.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-prune`],
        }] : []),
      ]
    case 'drafting_model':
      return [
        {
          id: `unit-${task.id}-model-record`,
          title: 'Record the DeepInfra drafting model candidate',
          deliverable: 'The model record names provider, model id, context window, license, retention/privacy posture, cost, adult-fiction policy boundary, and fallback risk.',
          rationale: 'The MVP cannot prove drafting if model choice is implicit or guessed.',
          suggestedDomain: task.domain,
          dependsOn: baseDependsOn,
        },
        {
          id: `unit-${task.id}-bakeoff`,
          title: 'Prove broad-genre chapter drafting behavior',
          deliverable: 'The bakeoff records voice preservation, legal adult-fiction behavior, refusal/repetition risk, cost, and latency.',
          rationale: 'A writing MVP needs evidence that the selected model can actually draft in the intended fiction range.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-model-record`],
        },
      ]
    case 'author_intent':
      return [
        {
          id: `unit-${task.id}-intent-records`,
          title: 'Define author-intent records',
          deliverable: 'Voice, genre, audience, theme, synopsis, outline, character voices, world-state facts, and review plan become packet-ready records.',
          rationale: 'The author should not have to reconstruct story intent manually for each run.',
          suggestedDomain: task.domain,
          dependsOn: baseDependsOn,
        },
        {
          id: `unit-${task.id}-policy-boundary`,
          title: 'Carry content boundary into packets',
          deliverable: 'Heat level and content-policy boundary travel with the author-intent packet inputs.',
          rationale: 'Adult-fiction support needs explicit policy context, not blanket refusal or invisible permissiveness.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-intent-records`],
        },
      ]
    case 'chapter_draft':
      return [
        {
          id: `unit-${task.id}-story-chain`,
          title: 'Build the synopsis-to-outline-to-records chain',
          deliverable: 'Synopsis, outline, character/voice records, and world-state facts are generated or loaded before drafting.',
          rationale: 'Chapter drafting should come from structured story context instead of a single prompt blob.',
          suggestedDomain: task.domain,
          dependsOn: baseDependsOn,
        },
        {
          id: `unit-${task.id}-chapter-proof`,
          title: 'Draft one chapter from a bounded packet',
          deliverable: 'A pnpm script or CLI command drafts one chapter and records author-voice and genre-fit review evidence.',
          rationale: 'The headless MVP needs a real writing proof, not only reviewer infrastructure.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-story-chain`],
        },
      ]
    case 'world_state_review':
      return [
        {
          id: `unit-${task.id}-state-transition-fixture`,
          title: 'Create elapsed-time state-transition fixtures',
          deliverable: 'Fixtures cover wet/dry, hot/cold, fresh/spoiled, healing, cooling, moved, used, or consumed state changes.',
          rationale: 'World-state review must reason about time and environment, not only named facts.',
          suggestedDomain: task.domain,
          dependsOn: baseDependsOn,
        },
        {
          id: `unit-${task.id}-finding-proof`,
          title: 'Prove world-state findings explain state changes',
          deliverable: 'Findings name entity, prior/later state, elapsed time, environment, expected transition, contradiction, and passages.',
          rationale: 'The writer needs an actionable state-change explanation, not a generic continuity warning.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-state-transition-fixture`],
        },
      ]
    case 'spatial_review':
      return [
        {
          id: `unit-${task.id}-travel-fixture`,
          title: 'Create travel and geography plausibility fixtures',
          deliverable: 'Fixtures cover distance, travel time, terrain, travel mode, walking speed, weather, light, and map consistency.',
          rationale: 'Spatial review has to prove physical-world reasoning over concrete journeys and scene geography.',
          suggestedDomain: task.domain,
          dependsOn: baseDependsOn,
        },
        {
          id: `unit-${task.id}-exception-proof`,
          title: 'Prove genre-aware geography findings',
          deliverable: 'The reviewer flags impossible ordinary movement while preserving explicit magic, mounts, portals, and non-human physiology exceptions.',
          rationale: 'Fantasy and speculative fiction need plausibility review that respects the storyworld’s own rules.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-travel-fixture`],
        },
      ]
  }
}

function defaultImportedWorkUnit(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
): NonNullable<Task['workUnitAnalysis']>['units'][number] {
  return {
    id: `unit-${task.id}`,
    title: task.title,
    deliverable: summarizeImportedSuccessMetric(task, evidenceDetail),
    rationale: summarizeImportedProblemContext(task, evidenceDetail),
    suggestedDomain: task.domain,
    dependsOn: [...(task.dependsOn ?? [])],
  }
}

function deriveGeneralImportedWorkUnits(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
): NonNullable<Task['workUnitAnalysis']>['units'] {
  const proofCommand = firstImportedProofCommand(task)
  const baseDependsOn = [...(task.dependsOn ?? [])]
  switch (importedGeneralShapeKind(task)) {
    case 'retrieval':
      return [
        {
          id: `unit-${task.id}-retrieval-surface`,
          title: 'Define the retrieval question surface over story records',
          deliverable: 'The task names the allowed character, scene, reader-state, and world questions over structured records.',
          rationale: 'Retrieval work should start by defining what may be asked from the record graph.',
          suggestedDomain: task.domain,
          dependsOn: baseDependsOn,
        },
        {
          id: `unit-${task.id}-retrieval-resolution`,
          title: 'Resolve deterministic answers from structured story records',
          deliverable: 'Repeated retrieval requests return stable answers from the same bounded records.',
          rationale: 'The retrieval path should answer from structured records instead of ad hoc manuscript rereads.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-retrieval-surface`],
        },
        {
          id: `unit-${task.id}-retrieval-proof`,
          title: 'Prove citations and provenance boundaries for retrieval results',
          deliverable: proofCommand
            ? `\`${proofCommand}\` records cited retrieval answers with provenance boundaries intact.`
            : 'Retrieval results cite their source records and keep blocked provenance out of answers.',
          rationale: 'Consumers need to trust both the answer and the source/provenance boundary behind it.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-retrieval-resolution`],
        },
      ]
    case 'agent_call':
      return [
        {
          id: `unit-${task.id}-agent-contract`,
          title: 'Define the writer-call packet contract',
          deliverable: 'The writer/editor call shape names the bounded packet inputs it receives.',
          rationale: 'Agent-call work should begin by making the packet contract explicit.',
          suggestedDomain: task.domain,
          dependsOn: baseDependsOn,
        },
        {
          id: `unit-${task.id}-agent-inputs`,
          title: 'Thread the constraint stack and privacy manifest into the writer call',
          deliverable: 'The bounded constraint stack and privacy manifest travel with the agent request.',
          rationale: 'The docs treat these as first-class call inputs, not optional metadata.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-agent-contract`],
        },
        {
          id: `unit-${task.id}-agent-proof`,
          title: 'Prove blocked provenance stays out of writer output',
          deliverable: proofCommand
            ? `\`${proofCommand}\` shows blocked provenance never enters tool calls or agent output.`
            : 'A bounded run proves blocked provenance stays out of writer output.',
          rationale: 'The privacy boundary is part of the runtime contract, not after-the-fact review.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-agent-inputs`],
        },
      ]
    case 'invalidation':
      return [
        {
          id: `unit-${task.id}-stale-detection`,
          title: 'Detect which derived context becomes stale after edits',
          deliverable: 'Edited sections or scenes identify the records and packets they invalidate.',
          rationale: 'The system needs explicit stale-context detection before it can rerun safely.',
          suggestedDomain: task.domain,
          dependsOn: baseDependsOn,
        },
        {
          id: `unit-${task.id}-stale-boundary`,
          title: 'Invalidate packet and retrieval context for affected edits',
          deliverable: 'Affected packet and retrieval context is excluded or refreshed after edits.',
          rationale: 'Invalidation only matters if reruns stop reusing stale derived context.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-stale-detection`],
        },
        {
          id: `unit-${task.id}-stale-proof`,
          title: 'Prove reruns exclude stale context after edits',
          deliverable: proofCommand
            ? `\`${proofCommand}\` proves reruns drop or refresh stale context after edits.`
            : 'A bounded rerun proves stale context is excluded after edits.',
          rationale: 'The edit boundary has to be observable in rerun behavior.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-stale-boundary`],
        },
      ]
    case 'telemetry':
      return [
        {
          id: `unit-${task.id}-telemetry-shape`,
          title: 'Define telemetry record fields for cost, latency, and quality',
          deliverable: 'Telemetry records have stable fields for cost, latency, quality, and run identity.',
          rationale: 'Telemetry is only useful if its record shape is stable enough to compare runs.',
          suggestedDomain: task.domain,
          dependsOn: baseDependsOn,
        },
        {
          id: `unit-${task.id}-telemetry-emission`,
          title: 'Emit telemetry records from bounded prototype runs',
          deliverable: 'Bounded runs emit telemetry alongside their run evidence.',
          rationale: 'Telemetry should ride with the run it describes instead of living as disconnected log trivia.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-telemetry-shape`],
        },
        {
          id: `unit-${task.id}-telemetry-proof`,
          title: 'Prove telemetry output stays attached to run evidence',
          deliverable: proofCommand
            ? `\`${proofCommand}\` records telemetry with the same bounded run evidence.`
            : 'A bounded proof run records telemetry that stays attached to the run evidence.',
          rationale: 'The proof loop should show telemetry and run evidence together.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-telemetry-emission`],
        },
      ]
    case 'general':
      return [
        {
          id: `unit-${task.id}-boundary`,
          title: `Define the operating boundary for ${task.title}`,
          deliverable: `${task.title} is scoped to one concrete runtime or data boundary.`,
          rationale: 'Imported work should become one bounded slice instead of staying as roadmap prose.',
          suggestedDomain: task.domain,
          dependsOn: baseDependsOn,
        },
        {
          id: `unit-${task.id}-behavior`,
          title: `Build the bounded behavior for ${task.title}`,
          deliverable: `${task.title} exists as concrete behavior inside the cited project surface.`,
          rationale: 'The task needs a real behavior slice, not just a planning heading.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-boundary`],
        },
        ...(proofCommand ? [{
          id: `unit-${task.id}-proof`,
          title: `Prove ${task.title} in the bounded local loop`,
          deliverable: `\`${proofCommand}\` passes for ${task.title}.`,
          rationale: 'Imported work should end in a real local proof path.',
          suggestedDomain: task.domain,
          dependsOn: [`unit-${task.id}-behavior`],
        }] : []),
      ]
  }
}

function deriveContractWorkUnits(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
): NonNullable<Task['workUnitAnalysis']>['units'] {
  const units: NonNullable<Task['workUnitAnalysis']>['units'] = []
  const fixtureContracts = evidenceDetail.contractNames.filter(name => /(fixture|expected)/i.test(name))
  const runContracts = evidenceDetail.contractNames.filter(name => /(run|evaluation|score|trace|signal)/i.test(name))
  const allContracts = evidenceDetail.contractNames.slice(0, 6)

  if (allContracts.length > 0) {
    units.push({
      id: `unit-${task.id}-contracts`,
      title: titleForImportedContractWorkUnit(evidenceDetail),
      deliverable: `Code defines and uses ${allContracts.map(name => `\`${name}\``).join(', ')}.`,
      rationale: 'Imported contract work should materialize the named schema and record surfaces directly from the cited docs.',
      suggestedDomain: task.domain,
      dependsOn: [...(task.dependsOn ?? [])],
    })
  }

  if (fixtureContracts.length > 0) {
    units.push({
      id: `unit-${task.id}-fixture`,
      title: 'Shape fixture and expected-record ground truth',
      deliverable: `${fixtureContracts.slice(0, 4).map(name => `\`${name}\``).join(', ')} cover the bounded fiction fixture and human-authored expected records.`,
      rationale: 'The first proof loop needs explicit fixture and ground-truth records instead of ad hoc fixture shape.',
      suggestedDomain: task.domain,
      dependsOn: units.length > 0 ? [units[0]!.id] : [...(task.dependsOn ?? [])],
    })
  }

  if (runContracts.length > 0) {
    units.push({
      id: `unit-${task.id}-run-eval`,
      title: 'Capture prototype run and evaluation records',
      deliverable: `${runContracts.slice(0, 5).map(name => `\`${name}\``).join(', ')} preserve the runnable evaluation story for the first proof loop.`,
      rationale: 'The MVP needs explicit run/evaluation artifacts so packet quality can be reviewed deterministically.',
      suggestedDomain: task.domain,
      dependsOn: units.length > 0 ? [units[units.length - 1]!.id] : [...(task.dependsOn ?? [])],
    })
  }

  const proofCommand = firstImportedProofCommand(task)
  if (proofCommand) {
    units.push({
      id: `unit-${task.id}-proof`,
      title: 'Add deterministic proof for the imported contract surface',
      deliverable: `\`${proofCommand}\` passes against the imported schema and record contracts.`,
      rationale: 'Imported contract work is not complete until the bounded local proof path runs against it.',
      suggestedDomain: task.domain,
      dependsOn: units.length > 0 ? [units[units.length - 1]!.id] : [...(task.dependsOn ?? [])],
    })
  }

  return units.length > 0 ? units : [defaultImportedWorkUnit(task, evidenceDetail)]
}

function titleForImportedContractWorkUnit(evidenceDetail: ImportedEvidenceDetail): string {
  const contractNames = evidenceDetail.contractNames
  const hasFixtureSurface = contractNames.some(name => /(fixture|expected)/i.test(name))
  const hasRunSurface = contractNames.some(name => /(prototype|run)/i.test(name))
  const hasEvaluationSurface = contractNames.some(name => /(evaluation|score|trace|signal)/i.test(name))
  if (hasFixtureSurface && hasRunSurface && hasEvaluationSurface) {
    return 'Define fixture, expected-record, prototype-run, and evaluation contracts'
  }
  if (hasFixtureSurface && hasEvaluationSurface) {
    return 'Define fixture and evaluation contracts'
  }
  if (hasFixtureSurface) return 'Define fixture and expected-record contracts'
  if (hasEvaluationSurface || hasRunSurface) return 'Define run and evaluation contracts'
  return 'Define the imported contract surface'
}

function deriveReviewerLaneWorkUnits(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
): NonNullable<Task['workUnitAnalysis']>['units'] {
  const units: NonNullable<Task['workUnitAnalysis']>['units'] = []
  const laneScope = evidenceDetail.implementationBullets[0] ?? summarizeImportedProblemContext(task, evidenceDetail)
  const questionList = (
    evidenceDetail.reviewQuestions.length > 0
      ? evidenceDetail.reviewQuestions
      : evidenceDetail.implementationBullets.filter(item => /\?$/.test(item))
  ).slice(0, 4)
  const ruleList = (
    evidenceDetail.rules.length > 0
      ? evidenceDetail.rules
      : evidenceDetail.goalStatements
  ).slice(0, 3)
  const decisionSteps = (
    evidenceDetail.decisionSteps.length > 0
      ? evidenceDetail.decisionSteps
      : evidenceDetail.implementationBullets
  ).slice(0, 4)

  units.push({
    id: `unit-${task.id}-scope`,
    title: `Define the craft lens for ${task.title}`,
    deliverable: `The lane evaluates the documented craft surface: ${laneScope}`,
    rationale: 'Reviewer lanes should start from the named fiction lens, not generic prose evaluation.',
    suggestedDomain: task.domain,
    dependsOn: [...(task.dependsOn ?? [])],
  })

  if (questionList.length > 0) {
    units.push({
      id: `unit-${task.id}-prompts`,
      title: 'Encode the spec-native review prompts',
      deliverable: `Reviewer output answers prompts such as ${questionList.join(' ')}`,
      rationale: 'The lane needs the project’s actual questions so findings stay aligned with the authored review method.',
      suggestedDomain: task.domain,
      dependsOn: [units[0]!.id],
    })
  }

  if (ruleList.length > 0) {
    units.push({
      id: `unit-${task.id}-boundary`,
      title: 'Protect the lane boundary and voice rules',
      deliverable: `The lane preserves rules like ${ruleList.join('; ')}`,
      rationale: 'Boundary rules keep the reviewer from flattening dialect, register, or voice-specific intent.',
      suggestedDomain: task.domain,
      dependsOn: [units[units.length - 1]!.id],
    })
  }

  if (decisionSteps.length > 0) {
    units.push({
      id: `unit-${task.id}-findings`,
      title: 'Shape actionable finding output',
      deliverable: `Findings follow the documented decision path: ${decisionSteps.join(' -> ')}`,
      rationale: 'The lane should emit concrete craft findings the writer can act on, not generic comments.',
      suggestedDomain: task.domain,
      dependsOn: [units[units.length - 1]!.id],
    })
  }

  const proofCommand = firstImportedProofCommand(task)
  if (proofCommand) {
    units.push({
      id: `unit-${task.id}-proof`,
      title: 'Add deterministic fixture proof for the reviewer lane',
      deliverable: `\`${proofCommand}\` passes over a bounded fiction fixture for this lane.`,
      rationale: 'A reviewer lane is only trustworthy once its bounded proof run is repeatable.',
      suggestedDomain: task.domain,
      dependsOn: [units[units.length - 1]!.id],
    })
  }

  return units
}

function deriveWorkflowWorkUnits(
  task: MaterializedImportTask,
  evidenceDetail: ImportedEvidenceDetail,
): NonNullable<Task['workUnitAnalysis']>['units'] {
  const units: NonNullable<Task['workUnitAnalysis']>['units'] = []
  const chainSteps = (
    evidenceDetail.decisionSteps.length > 0
      ? evidenceDetail.decisionSteps
      : evidenceDetail.implementationBullets
  ).slice(0, 7)
  const weightDimensions = evidenceDetail.weightDimensions.slice(0, 6)
  const severityLevels = evidenceDetail.severityLevels.slice(0, 6)
  const boundaryRules = (
    evidenceDetail.rules.length > 0
      ? evidenceDetail.rules
      : evidenceDetail.implementationBullets.filter(item => /\b(not optimize|fiction|friction|protect)\b/i.test(item))
  ).slice(0, 3)

  if (chainSteps.length > 0) {
    units.push({
      id: `unit-${task.id}-chain`,
      title: `Preserve the workflow order for ${task.title}`,
      deliverable: `The workflow keeps the documented sequence: ${chainSteps.join(' -> ')}`,
      rationale: 'Imported workflow work should preserve the authored pipeline order instead of collapsing it into one generic implementation step.',
      suggestedDomain: task.domain,
      dependsOn: [...(task.dependsOn ?? [])],
    })
  }

  if (weightDimensions.length > 0) {
    units.push({
      id: `unit-${task.id}-weights`,
      title: 'Model multidimensional finding weights',
      deliverable: `Finding records preserve ${weightDimensions.join(', ')}.`,
      rationale: 'The cited workflow depends on structured weight fields, not a flat priority number.',
      suggestedDomain: task.domain,
      dependsOn: units.length > 0 ? [units[units.length - 1]!.id] : [...(task.dependsOn ?? [])],
    })
  }

  if (severityLevels.length > 0 || boundaryRules.length > 0) {
    units.push({
      id: `unit-${task.id}-boundary`,
      title: 'Preserve severity and fiction-first boundaries',
      deliverable: [
        severityLevels.length > 0 ? `Severity model includes ${severityLevels.join(', ')}` : '',
        boundaryRules.length > 0 ? `Boundary rules include ${boundaryRules.join('; ')}` : '',
      ].filter(Boolean).join('. '),
      rationale: 'The workflow should keep protect-level findings and fiction-first constraints intact through the pipeline.',
      suggestedDomain: task.domain,
      dependsOn: units.length > 0 ? [units[units.length - 1]!.id] : [...(task.dependsOn ?? [])],
    })
  }

  const proofCommand = firstImportedProofCommand(task)
  if (proofCommand) {
    units.push({
      id: `unit-${task.id}-proof`,
      title: 'Add deterministic proof for the workflow pipeline',
      deliverable: `\`${proofCommand}\` passes using bounded findings, weights, and output records.`,
      rationale: 'The imported workflow is only complete when the cited local proof path runs deterministically.',
      suggestedDomain: task.domain,
      dependsOn: units.length > 0 ? [units[units.length - 1]!.id] : [...(task.dependsOn ?? [])],
    })
  }

  return units.length > 0 ? units : [defaultImportedWorkUnit(task, evidenceDetail)]
}

export function buildImportedBlueprintSeed(
  task: MaterializedImportTask,
  normalizedReferences: readonly string[],
  workspaceProjectPath: string,
  now: string,
  referenceContents?: ReadonlyMap<string, string>,
): ImportedBlueprintSeed {
  const normalizedTask: MaterializedImportTask = {
    ...task,
    references: [...normalizedReferences],
  }
  const evidenceDetail = extractReferenceEvidenceDetail(normalizedTask, workspaceProjectPath, referenceContents)
  const acceptanceCriteria = materializedAcceptanceCriteria(normalizedTask, evidenceDetail)
  const evidenceRefs = normalizedReferences.map(ref => `import:${ref}`)
  const sourceClaims = task.sourceClaims && task.sourceClaims.length > 0
    ? [...task.sourceClaims]
    : importedSourceClaimsForTask(normalizedTask, normalizedReferences)
  const notes = normalizedReferences.length > 0
    ? [{
        agentId: 'workspace-importer',
        role: 'importer' as const,
        content: [
          `Imported from: ${normalizedReferences.join(', ')}`,
          normalizedTask.whyThisMayMatter ? `Why this may matter: ${normalizedTask.whyThisMayMatter}` : '',
          normalizedTask.assumptions && normalizedTask.assumptions.length > 0 ? `Assumptions: ${normalizedTask.assumptions.join(' | ')}` : '',
          normalizedTask.missingInformation && normalizedTask.missingInformation.length > 0 ? `Missing information: ${normalizedTask.missingInformation.join(' | ')}` : '',
          normalizedTask.scope === 'later' ? 'Scope: later/deferred' : '',
        ].filter(Boolean).join('\n'),
        timestamp: now,
      }]
    : []

  if (!importedTaskHasBlueprintSeed(normalizedTask, evidenceDetail)) {
    return {
      status: normalizedTask.scope === 'later' ? 'shelved' : 'import_draft',
      outOfScope: [],
      notes,
      requestIntake: {
        intent: 'spec_only',
        recommendedNextAction: 'draft_spec',
        assumptions: [...(normalizedTask.assumptions ?? [])],
        missingInformation: [...(normalizedTask.missingInformation ?? [])],
        ...(normalizedTask.missingInformation && normalizedTask.missingInformation.length > 0
          ? {
              ownerDecisionNeeded: 'Confirm the intended scope and success boundary if this imported draft no longer matches current project needs.',
              whyOwnerDecisionMatters: 'Imported notes are evidence-backed candidates, but Guildhall should not treat them as current truth without reshaping.',
            }
          : {}),
        evidenceRefs,
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
      sourceClaims,
      // No blueprint means there is not enough source-backed proof to hand
      // this task to execution. Keep proof empty so the shaping lane, not a
      // generic review placeholder, owns the next step.
      proofPaths: [],
    }
  }

  const seededProductBrief = importedTaskBrief(normalizedTask, evidenceDetail, now)
  const seededStructuredSpec = importedStructuredSpec(normalizedTask, workspaceProjectPath)
  const seededSpec = renderStructuredSpecMarkdown(seededStructuredSpec)
  const seededWorkUnitAnalysis = importedTaskWorkUnitAnalysis(normalizedTask, evidenceDetail, now)
  const shapedSeedTask: Task = applyTaskShaping({
    id: `seed:${normalizedTask.id}`,
    title: normalizedTask.title,
    description: normalizedTask.description,
    domain: normalizedTask.domain,
    projectPath: '',
    status: 'spec_review',
    priority: normalizedTask.priority,
    ...(normalizedTask.semanticKind ? { semanticKind: normalizedTask.semanticKind } : {}),
    ...(normalizedTask.contractNames?.length ? { contractNames: [...normalizedTask.contractNames] } : {}),
    dependsOn: [...(normalizedTask.dependsOn ?? [])],
    outOfScope: [...(normalizedTask.missingInformation ?? [])],
    acceptanceCriteria,
    requestIntake: {
      intent: 'implementation',
      recommendedNextAction: 'proceed_to_implementation_spec',
      assumptions: [...(normalizedTask.assumptions ?? [])],
      missingInformation: [...(normalizedTask.missingInformation ?? [])],
      evidenceRefs,
      componentStack: [],
      pressureTestSummary: {
        systemOwned: true,
        degree: 'guided',
        qualityBar: 'Carry imported project evidence forward into a reviewable implementation blueprint before execution starts.',
        ownerQuestionPolicy: 'Only ask when the cited evidence conflicts strongly enough to change product intent or the active task scope.',
        checks: [
          {
            id: 'source-relevance',
            title: 'Source relevance',
            status: 'system-check',
            reason: 'The seeded blueprint should stay anchored to the cited project evidence.',
          },
          {
            id: 'acceptance-criteria',
            title: 'Acceptance criteria',
            status: 'system-check',
            reason: 'Imported criteria and proof steps must survive into the seeded implementation blueprint.',
          },
          {
            id: 'scope-boundary',
            title: 'Scope boundary',
            status: 'system-check',
            reason: 'Imported tasks should name a concrete completion boundary before execution begins.',
          },
        ],
      },
      clarifyingQuestions: [],
      createdAt: now,
      createdBy: 'workspace-importer',
    },
    references: [...normalizedReferences],
    sourceClaims,
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    spec: seededSpec,
    structuredSpec: seededStructuredSpec,
    productBrief: seededProductBrief,
    workUnitAnalysis: seededWorkUnitAnalysis,
    proofPaths: materializedProofPaths(normalizedTask, evidenceDetail),
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: now,
    updatedAt: now,
  }, { now, recordNote: false })

  return {
    status: normalizedTask.scope === 'later' ? 'shelved' : 'spec_review',
    requestIntake: shapedSeedTask.requestIntake,
    sourceClaims,
    acceptanceCriteria,
    proofPaths: materializedProofPaths(normalizedTask, evidenceDetail),
    productBrief: seededProductBrief,
    spec: seededSpec,
    structuredSpec: seededStructuredSpec,
    outOfScope: [...(task.missingInformation ?? [])],
    notes,
    workUnitAnalysis: seededWorkUnitAnalysis,
    taskReadiness: shapedSeedTask.taskReadiness,
    taskKind: shapedSeedTask.taskKind,
    definitionOfDone: shapedSeedTask.definitionOfDone,
    blockerPlans: shapedSeedTask.blockerPlans,
    contextBudget: shapedSeedTask.contextBudget,
    decomposition: shapedSeedTask.decomposition,
    sizePlan: shapedSeedTask.sizePlan,
  }
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
    ? parsedImportFromDraft(input.draftOverride)
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
  const materializedParsed = await materializeParsedWorkspaceImport({
    memoryDir: input.memoryDir,
    projectPath: input.projectPath,
    parsed,
  })
  const detectedDraftSnapshot = input.detectedDraftSnapshot
    ?? (
      input.draftOverride
        ? null
        : formWorkspaceHypothesis(
            await detectWorkspaceSignals({ projectPath: input.projectPath }),
          )
    )
  const approvedContext = input.draftOverride?.context
    ? [...input.draftOverride.context]
    : detectedDraftSnapshot?.context
      ? [...detectedDraftSnapshot.context]
      : []
  const materializedTasks = materializedParsed.tasks
  const approvedSpec = input.draftOverride
    ? formatParsedImportAsSpec(normalizeParsedImportForSpec(materializedParsed, input.projectPath))
    : null
  const recoverableArchivedTasks = await readRecoverableArchivedImportTasks(input.memoryDir)
  const existingImportedTasks: Task[] = []
  for (const existingTask of queue.tasks) {
    if (existingTask.id === WORKSPACE_IMPORT_TASK_ID) continue
    repairImportedTaskTitleFromSourceDescription(existingTask)
    existingImportedTasks.push(existingTask)
  }
  const refreshableTasks: Array<{ existing: Task; imported: MaterializedImportTask }> = []
  const supersededImportedTaskIds = new Set<string>()
  const mergeableTasks = materializedTasks.filter(task => {
    const existing = existingImportedTasks.find(candidate => existingImportedTaskMatchesIncoming(candidate, task))
    const archived = recoverableArchivedTasks.find(candidate =>
      archivedImportTaskMatchesIncoming(candidate, task, input),
    )
    if (archived && (!existing || activeImportedTaskShouldYieldToArchivedCompletion(existing, archived))) {
      const restored = ensureArchivedTaskRecoveredForImport({
        queue,
        archived,
        existingImportedTasks,
      })
      if (existing && existing.id !== restored.id) supersededImportedTaskIds.add(existing.id)
      refreshableTasks.push({ existing: restored, imported: task })
      return false
    }
    if (existing) {
      refreshableTasks.push({ existing, imported: task })
      return false
    }
    return true
  })

  // Merge tasks into the queue as intake candidates. Dup ids get suffixed.
  const existingIds = new Set(queue.tasks.map((t) => t.id))
  const allocatedTaskIds: string[] = []
  const dependencyIdMap = new Map<string, string>()
  const approvedQueueTaskIds = new Set<string>()
  for (const { existing, imported } of refreshableTasks) {
    if (!dependencyIdMap.has(imported.id)) {
      dependencyIdMap.set(imported.id, existing.id)
    }
    approvedQueueTaskIds.add(existing.id)
  }
  for (const t of mergeableTasks) {
    const id = uniqueTaskId(existingIds, t.id)
    existingIds.add(id)
    allocatedTaskIds.push(id)
    approvedQueueTaskIds.add(id)
    if (!dependencyIdMap.has(t.id)) {
      dependencyIdMap.set(t.id, id)
    }
  }

  const refreshedStatusForImportedTask = (
    existing: Task,
    importedScope: MaterializedImportTask['scope'],
    seededStatus: Task['status'],
    refreshedAcceptanceCriteria: Task['acceptanceCriteria'],
    refreshedProofPaths: Task['proofPaths'],
  ): Task['status'] => {
    const existingStatus = existing.status
    if (importedScope === 'later') return 'shelved'
    if (taskHasDurableCompletionEvidence(existing)) return 'done'
    if (
      ['done', 'pending_pr'].includes(existingStatus) &&
      importedCurrentCompletionNeedsFreshProof({
        existing,
        refreshedAcceptanceCriteria,
        refreshedProofPaths,
      })
    ) {
      return seededStatus
    }
    if (['blocked', 'in_progress', 'review', 'gate_check', 'done', 'pending_pr'].includes(existingStatus)) {
      return existingStatus
    }
    if (seededStatus === 'spec_review') return 'spec_review'
    if (existingStatus === 'shelved' || existingStatus === 'archived' || existingStatus === 'cancelled') {
      return seededStatus
    }
    return existingStatus
  }

  for (const { existing, imported } of refreshableTasks) {
    const domain = normalizeImportedTaskDomain(
      imported.domain,
      input.coordinatorProjectPaths,
      imported.references,
      input.projectPath,
    )
    const taskProjectPath =
      input.coordinatorProjectPaths?.[domain] ??
      resolveTaskProjectPath({
        workspaceProjectPath: input.projectPath,
        domain,
      })
    const normalizedDescription = normalizeImportedDescriptionForTask(
      imported.description,
      imported.references,
      input.projectPath,
      taskProjectPath,
    )
    const normalizedReferences = absoluteImportedReferences(imported.references, input.projectPath)
    const evidenceDetail = extractReferenceEvidenceDetail(imported, input.projectPath)
    const seededBlueprint = buildImportedBlueprintSeed(imported, normalizedReferences, input.projectPath, now)
    const refreshedAcceptanceCriteria = materializedAcceptanceCriteria(imported, evidenceDetail)
    const materializedProof = materializedProofPaths(imported, evidenceDetail) ?? []
    existing.title = effectiveTaskTitle({ title: imported.title, description: normalizedDescription }) ?? imported.title
    existing.description = normalizedDescription
    existing.domain = domain
    existing.projectPath = taskProjectPath
    existing.priority = imported.priority
    if (imported.sourceIdentity) existing.sourceIdentity = imported.sourceIdentity
    else delete existing.sourceIdentity
    if (imported.deliverableName) existing.deliverableName = imported.deliverableName
    else delete existing.deliverableName
    if (imported.producedArtifact) existing.producedArtifact = imported.producedArtifact
    else delete existing.producedArtifact
    if (imported.workShape) existing.workShape = imported.workShape
    else delete existing.workShape
    if (imported.targetArea) existing.targetArea = imported.targetArea
    else delete existing.targetArea
    if (imported.buildsOn?.length) existing.buildsOn = [...imported.buildsOn]
    else delete existing.buildsOn
    if (imported.consumerSurfaces?.length) existing.consumerSurfaces = [...imported.consumerSurfaces]
    else delete existing.consumerSurfaces
    if (imported.semanticKind) existing.semanticKind = imported.semanticKind
    else delete existing.semanticKind
    if (imported.contractNames?.length) existing.contractNames = [...imported.contractNames]
    else delete existing.contractNames
    existing.dependsOn = [...(imported.dependsOn ?? [])].map(dependency => dependencyIdMap.get(dependency) ?? dependency)
    existing.releaseIds = [...(imported.releaseIds ?? [])]
    existing.acceptanceCriteria = refreshedAcceptanceCriteria
    existing.requestIntake = seededBlueprint.requestIntake
    existing.references = normalizedReferences
    existing.notes = mergeImportedRefreshNotes(existing.notes, seededBlueprint.notes)
    existing.status = refreshedStatusForImportedTask(
      existing,
      imported.scope,
      seededBlueprint.status,
      refreshedAcceptanceCriteria,
      materializedProof,
    )
    if (existing.status === 'done' && !existing.completedAt) {
      existing.completedAt = durableCompletedAt(existing) ?? now
    }
    if (!['done', 'pending_pr'].includes(existing.status)) {
      delete existing.completedAt
    }
    existing.outOfScope = seededBlueprint.outOfScope
    existing.spec = seededBlueprint.spec
    existing.productBrief = seededBlueprint.productBrief
    existing.workUnitAnalysis = seededBlueprint.workUnitAnalysis
    existing.taskReadiness = seededBlueprint.taskReadiness
    existing.taskKind = seededBlueprint.taskKind
    existing.definitionOfDone = seededBlueprint.definitionOfDone
    existing.blockerPlans = seededBlueprint.blockerPlans
    existing.contextBudget = seededBlueprint.contextBudget
    existing.decomposition = seededBlueprint.decomposition
    existing.sizePlan = seededBlueprint.sizePlan
    if (materializedProof.length > 0) existing.proofPaths = materializedProof
    else delete existing.proofPaths
    existing.updatedAt = now
    materializeImportedSplitChildren(queue, existing, imported.scope, now)
  }

  const archivedImportedParentIds: string[] = []
  for (const taskId of supersededImportedTaskIds) {
    const existingTask = queue.tasks.find(task => task.id === taskId)
    if (!existingTask || existingTask.id === WORKSPACE_IMPORT_TASK_ID) continue
    if (existingTask.status === 'archived') continue
    existingTask.status = 'archived'
    existingTask.releaseIds = []
    existingTask.updatedAt = now
    archivedImportedParentIds.push(existingTask.id)
    existingTask.notes = [
      ...(existingTask.notes ?? []),
      {
        agentId: 'workspace-importer',
        role: 'system',
        timestamp: now,
        content: 'Workspace import recovered archived completion evidence for this work and archived the stale imported duplicate.',
      },
    ]
  }

  if (input.replacePreviouslyImportedTasks) {
    for (const existingTask of queue.tasks) {
      if (existingTask.id === WORKSPACE_IMPORT_TASK_ID) continue
      if (!importedTaskCanBeArchivedDuringScopeRefresh(existingTask.status)) continue
      if (!isWorkspaceImportManagedTask(existingTask)) continue
      if (approvedQueueTaskIds.has(existingTask.id)) continue
      existingTask.status = 'archived'
      existingTask.updatedAt = now
      archivedImportedParentIds.push(existingTask.id)
      existingTask.notes = [
        ...(existingTask.notes ?? []),
        {
          agentId: 'workspace-importer',
          role: 'system',
          timestamp: now,
          content: 'Workspace import refresh archived this draft because it is no longer part of the approved import scope.',
        },
      ]
    }
  }
  archiveGeneratedImportedDescendants(queue, archivedImportedParentIds, now)

  let tasksAdded = 0
  for (const [index, t] of mergeableTasks.entries()) {
    const id = allocatedTaskIds[index] ?? t.id
    const domain = normalizeImportedTaskDomain(
      t.domain,
      input.coordinatorProjectPaths,
      t.references,
      input.projectPath,
    )
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
    const normalizedReferences = absoluteImportedReferences(t.references, input.projectPath)
    const evidenceDetail = extractReferenceEvidenceDetail(t, input.projectPath)
    const seededBlueprint = buildImportedBlueprintSeed(t, normalizedReferences, input.projectPath, now)
    const importedProofPaths = materializedProofPaths(t, evidenceDetail) ?? []
    const importedTitle = effectiveTaskTitle({ title: t.title, description: normalizedDescription }) ?? t.title
    const importedTaskRecord = {
      id,
      title: importedTitle,
      description: normalizedDescription,
      ...(t.sourceIdentity ? { sourceIdentity: t.sourceIdentity } : {}),
      ...(t.deliverableName ? { deliverableName: t.deliverableName } : {}),
      ...(t.producedArtifact ? { producedArtifact: t.producedArtifact } : {}),
      ...(t.workShape ? { workShape: t.workShape } : {}),
      ...(t.targetArea ? { targetArea: t.targetArea } : {}),
      ...(t.buildsOn?.length ? { buildsOn: [...t.buildsOn] } : {}),
      ...(t.consumerSurfaces?.length ? { consumerSurfaces: [...t.consumerSurfaces] } : {}),
      domain,
      projectPath: taskProjectPath,
      status: seededBlueprint.status,
      priority: t.priority,
      ...(t.semanticKind ? { semanticKind: t.semanticKind } : {}),
      ...(t.contractNames?.length ? { contractNames: [...t.contractNames] } : {}),
      dependsOn: [...(t.dependsOn ?? [])].map(dependency => dependencyIdMap.get(dependency) ?? dependency),
      releaseIds: [...(t.releaseIds ?? [])],
      outOfScope: seededBlueprint.outOfScope,
      acceptanceCriteria: materializedAcceptanceCriteria(t, evidenceDetail),
      requestIntake: seededBlueprint.requestIntake,
      references: normalizedReferences,
      notes: seededBlueprint.notes,
      gateResults: [],
      reviewVerdicts: [],
      adjudications: [],
      escalations: [],
      agentIssues: [],
      ...(seededBlueprint.spec ? { spec: seededBlueprint.spec } : {}),
      ...(seededBlueprint.productBrief ? { productBrief: seededBlueprint.productBrief } : {}),
      ...(seededBlueprint.workUnitAnalysis ? { workUnitAnalysis: seededBlueprint.workUnitAnalysis } : {}),
      ...(seededBlueprint.taskReadiness ? { taskReadiness: seededBlueprint.taskReadiness } : {}),
      ...(seededBlueprint.taskKind ? { taskKind: seededBlueprint.taskKind } : {}),
      ...(seededBlueprint.definitionOfDone ? { definitionOfDone: seededBlueprint.definitionOfDone } : {}),
      ...(seededBlueprint.blockerPlans ? { blockerPlans: seededBlueprint.blockerPlans } : {}),
      ...(seededBlueprint.contextBudget ? { contextBudget: seededBlueprint.contextBudget } : {}),
      ...(seededBlueprint.decomposition ? { decomposition: seededBlueprint.decomposition } : {}),
      ...(seededBlueprint.sizePlan ? { sizePlan: seededBlueprint.sizePlan } : {}),
      ...(importedProofPaths.length > 0
        ? { proofPaths: importedProofPaths }
        : {}),
      revisionCount: 0,
      remediationAttempts: 0,
      origination: 'human',
      createdAt: now,
      updatedAt: now,
    } as unknown as Task
    queue.tasks.push(importedTaskRecord)
    materializeImportedSplitChildren(queue, importedTaskRecord, t.scope, now)
    tasksAdded++
  }

  pruneInactiveImportedSplitDependencies(queue, now)

  // Mark the importer task done.
  if (approvedSpec) {
    task.spec = approvedSpec
  }
  task.status = 'done'
  task.updatedAt = now
  task.completedAt = now
  ensureImportedReleaseContainers(
    queue,
    now,
    materializedParsed.releases ?? [],
    selectedReleaseIdFromCurrentImport(materializedTasks),
  )
  queue.lastUpdated = now
  await writeQueue(input.memoryDir, queue)

  // Persist goals (overwrites prior import — the agent is authoritative).
  if (
    materializedParsed.goals.length > 0 ||
    materializedParsed.tasks.length > 0 ||
    materializedParsed.milestones.length > 0 ||
    approvedContext.length > 0
  ) {
    const goalsPath = workspaceImportStatePath(input.memoryDir, WORKSPACE_GOALS_FILE)
    const approvedSnapshot = workspaceScopeSnapshotFromParsed(materializedParsed)
    const detectedSnapshot = detectedDraftSnapshot
      ? workspaceScopeSnapshotFromDraft(detectedDraftSnapshot)
      : input.draftOverride
        ? workspaceScopeSnapshotFromDraft(input.draftOverride)
        : approvedSnapshot
    await writeManagedTextFile(
      goalsPath,
          JSON.stringify(
        {
          version: WORKSPACE_GOALS_STRUCTURAL_VERSION,
          recordedAt: now,
          goals: [...materializedParsed.goals],
          ...(materializedParsed.releases?.length ? { releases: [...materializedParsed.releases] } : {}),
          tasks: [...materializedParsed.tasks],
          milestones: [...materializedParsed.milestones],
          documentedStructure: documentedStructuralContextsForProjection(approvedContext),
          context: [],
          approved: approvedSnapshot,
          detected: detectedSnapshot,
        } satisfies WorkspaceGoalsState,
        null,
        2,
      ),
      'utf-8',
    )
    // The queue write happens before this durable plan write. Refresh once at
    // the combined boundary so fast reads never observe a half-updated plan.
    const currentTasksPath = workspaceImportTasksPath(input.memoryDir)
    const expectedQueueRevision = readProjectStateDatabaseQueueRevision(currentTasksPath)
    writeProjectSummaryProjectionFromUnknownQueue(currentTasksPath, {
      queue,
      queueCommit: false,
      ...(expectedQueueRevision !== null ? { expectedQueueRevision } : {}),
    })
  }

  // Append milestones to PROGRESS.md.
  let milestonesLogged = 0
  if (materializedParsed.milestones.length > 0) {
    const progressPath = workspaceImportStatePath(input.memoryDir, 'PROGRESS.md')
    const blocks: string[] = []
    for (const m of materializedParsed.milestones) {
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

function pruneInactiveImportedSplitDependencies(queue: TaskQueue, now: string): void {
  const inactiveGeneratedSplitIds = new Set(
    queue.tasks
      .filter(task =>
        (task.status === 'archived' || task.status === 'cancelled') &&
        (
          task.proposedBy === 'task-sizing' ||
          task.origination === 'system' ||
          task.hierarchy?.relation === 'decomposes' ||
          task.requestIntake?.createdBy === 'workspace-importer' ||
          task.notes?.some(note => note.agentId === 'task-sizing' || note.agentId === 'workspace-importer')
        ),
      )
      .map(task => task.id),
  )
  if (inactiveGeneratedSplitIds.size === 0) return

  for (const task of queue.tasks) {
    if (task.status === 'archived' || task.status === 'cancelled') continue
    if (!task.dependsOn.some(dependency => inactiveGeneratedSplitIds.has(dependency))) continue
    task.dependsOn = task.dependsOn.filter(dependency => !inactiveGeneratedSplitIds.has(dependency))
    task.updatedAt = now
  }
}

function materializeImportedSplitChildren(
  queue: TaskQueue,
  task: Task,
  scope: MaterializedImportTask['scope'] | undefined,
  now: string,
): void {
  if (scope === 'later') return
  const action = task.sizePlan?.action
  if (!isMaterializableSplitAction(action)) return
  reconcileImportedSplitChildren(queue, task, now)
  materializeSplitChildren(queue, task, now)
  normalizeImportedSplitChildVisibility(queue, task, now)
}

function normalizeImportedSplitChildVisibility(
  queue: TaskQueue,
  parent: Task,
  now: string,
): void {
  for (const child of queue.tasks) {
    if (child.hierarchy?.parentId !== parent.id) continue
    if (child.workVisibility?.kind) continue
    const looksLikeGeneratedSplitChild =
      child.hierarchy?.relation === 'decomposes' ||
      child.notes?.some(note => note.agentId === 'task-sizing')
    if (!looksLikeGeneratedSplitChild) continue
    child.workVisibility = {
      kind: 'internal_step',
      countInProjectTotals: false,
    }
    child.updatedAt = now
  }
}

function reconcileImportedSplitChildren(
  queue: TaskQueue,
  task: Task,
  now: string,
): void {
  const action = task.sizePlan?.action
  if (!isMaterializableSplitAction(action)) return
  const plannedChildren = task.sizePlan?.recommendedChildren?.length
    ? task.sizePlan.recommendedChildren
    : buildDecompositionChildDrafts({ task })
  const plannedChildIds = new Set(
    plannedChildren
      .map(child => child.createdTaskId)
      .filter((id): id is string => Boolean(id?.trim())),
  )
  const plannedChildIdentities = new Set(
    plannedChildren
      .filter((child): child is typeof child & { identity: string } => Boolean(child.identity?.trim()))
      .map(child => splitChildSourceIdentity(task, child.identity)),
  )
  if (plannedChildIds.size === 0 && plannedChildIdentities.size === 0) return

  const currentChildIds = task.hierarchy?.childIds ?? []
  if (currentChildIds.length === 0) return
  const keptChildIds: string[] = []
  const staleChildIds = new Set<string>()

  for (const childId of currentChildIds) {
    const child = queue.tasks.find(candidate => candidate.id === childId)
    if (!child) continue
    const isGeneratedSplitChild =
      child.hierarchy?.parentId === task.id ||
      child.hierarchy?.relation === 'decomposes' ||
      child.notes?.some(note => note.agentId === 'task-sizing')
    const childIdentity = explicitTaskStructuralIdentity(child)
    const isPlannedChild = plannedChildIds.has(child.id) ||
      (childIdentity !== null && plannedChildIdentities.has(childIdentity))
    // A generated child without an explicit identity is legacy data. Preserve
    // it rather than guessing from its display title which child it represents.
    if (!isGeneratedSplitChild || isPlannedChild || (childIdentity === null && !plannedChildIds.has(child.id))) {
      keptChildIds.push(childId)
      continue
    }

    staleChildIds.add(child.id)
    if (child.hierarchy?.parentId === task.id) {
      const nextHierarchy = { ...(child.hierarchy ?? {}) }
      delete nextHierarchy.parentId
      child.hierarchy = nextHierarchy
    }
    if (!['done', 'pending_pr'].includes(child.status)) child.status = 'archived'
    child.updatedAt = now
    if (!child.notes.some(note =>
      note.agentId === 'workspace-importer' &&
      note.structured?.event === 'workspace_import_archive' &&
      note.structured?.reason === 'superseded_imported_split'
    )) {
      child.notes.push({
        agentId: 'workspace-importer',
        role: 'system',
        structured: {
          event: 'workspace_import_archive',
          reason: 'superseded_imported_split',
        },
        content: `Archived because this split child was superseded by a refreshed imported split for ${task.id}.`,
        timestamp: now,
      })
    }
  }

  if (staleChildIds.size === 0) return
  task.hierarchy = {
    ...(task.hierarchy ?? {}),
    order: task.hierarchy?.order ?? 0,
    relation: task.hierarchy?.relation ?? 'contains',
    childIds: keptChildIds,
  }
  if (task.deliverySteps?.length) {
    task.deliverySteps = task.deliverySteps.filter(step => !step.sourceTaskId || !staleChildIds.has(step.sourceTaskId))
  }
}

function archiveGeneratedImportedDescendants(
  queue: TaskQueue,
  parentIds: readonly string[],
  now: string,
): void {
  if (parentIds.length === 0) return
  const pending = [...parentIds]
  const seen = new Set<string>(parentIds)

  while (pending.length > 0) {
    const parentId = pending.shift()
    if (!parentId) continue

    for (const candidate of queue.tasks) {
      if (seen.has(candidate.id)) continue
      const isDescendant =
        candidate.hierarchy?.parentId === parentId
      if (!isDescendant) continue

      seen.add(candidate.id)
      pending.push(candidate.id)

      const isGeneratedSplitChild =
        candidate.hierarchy?.parentId === parentId ||
        candidate.hierarchy?.relation === 'decomposes' ||
        candidate.notes?.some(note => note.agentId === 'task-sizing' || note.agentId === 'workspace-importer')
      if (!isGeneratedSplitChild) continue

      if (candidate.hierarchy?.parentId) {
        const nextHierarchy = { ...(candidate.hierarchy ?? {}) }
        delete nextHierarchy.parentId
        candidate.hierarchy = nextHierarchy
      }
      if (!['done', 'pending_pr'].includes(candidate.status)) candidate.status = 'archived'
      candidate.updatedAt = now
      const notes = candidate.notes ?? (candidate.notes = [])
      if (!notes.some(note =>
        note.agentId === 'workspace-importer' &&
        note.structured?.event === 'workspace_import_archive' &&
        note.structured?.reason === 'superseded_imported_parent_scope'
      )) {
        notes.push({
          agentId: 'workspace-importer',
          role: 'system',
          structured: {
            event: 'workspace_import_archive',
            reason: 'superseded_imported_parent_scope',
          },
          content: 'Archived because this generated split child was superseded because its imported parent left the approved import scope.',
          timestamp: now,
        })
      }
    }
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
