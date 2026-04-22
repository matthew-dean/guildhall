import fs from 'node:fs/promises'
import path from 'node:path'
import { TaskQueue, type Task, type TaskStatus } from '@guildhall/core'
import {
  appendExploringTranscript,
  resolveEscalation,
} from '@guildhall/tools'

// ---------------------------------------------------------------------------
// FR-12: exploratory task intake.
//
// A fuzzy user ask becomes a task in the `exploring` state, with a transcript
// seed at memory/exploring/<task-id>.md. The Spec Agent picks it up on the next
// orchestrator tick and drives a conversational intake.
//
// Approval transitions: exploring → spec_review. Until approved, the
// orchestrator will keep routing exploring tasks back to the Spec Agent.
// ---------------------------------------------------------------------------

function tasksPathFor(memoryDir: string): string {
  return path.join(memoryDir, 'TASKS.json')
}

function progressPathFor(memoryDir: string): string {
  return path.join(memoryDir, 'PROGRESS.md')
}

async function readQueue(memoryDir: string): Promise<TaskQueue> {
  const raw = await fs.readFile(tasksPathFor(memoryDir), 'utf-8')
  // The bootstrap seeds TASKS.json as a bare `[]` for legacy reasons, so be
  // permissive on intake: if we see a bare array, promote it to a full queue.
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) {
    return { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
  }
  return TaskQueue.parse(parsed)
}

async function writeQueue(memoryDir: string, queue: TaskQueue): Promise<void> {
  await fs.writeFile(tasksPathFor(memoryDir), JSON.stringify(queue, null, 2), 'utf-8')
}

function nextTaskId(queue: TaskQueue): string {
  const used = new Set(queue.tasks.map((t) => t.id))
  let n = queue.tasks.length + 1
  while (used.has(`task-${String(n).padStart(3, '0')}`)) n++
  return `task-${String(n).padStart(3, '0')}`
}

export interface IntakeInput {
  memoryDir: string
  ask: string
  domain: string
  projectPath: string
  /** Optional override for the task id (otherwise auto-generated) */
  taskId?: string
  /** Optional explicit title; defaults to a shortened ask */
  title?: string
}

export interface IntakeResult {
  taskId: string
  transcriptPath: string
}

/**
 * Create a new task in the `exploring` state from a fuzzy ask and seed its
 * transcript with the user's initial message.
 */
export async function createExploringTask(input: IntakeInput): Promise<IntakeResult> {
  const queue = await readQueue(input.memoryDir)
  const id = input.taskId ?? nextTaskId(queue)
  if (queue.tasks.some((t) => t.id === id)) {
    throw new Error(`Task ${id} already exists`)
  }

  const now = new Date().toISOString()
  const title = input.title?.trim() || truncateTitle(input.ask)

  const task: Task = {
    id,
    title,
    description: input.ask,
    domain: input.domain,
    projectPath: input.projectPath,
    status: 'exploring',
    priority: 'normal',
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
    origination: 'human',
    createdAt: now,
    updatedAt: now,
  }

  queue.tasks.push(task)
  queue.lastUpdated = now
  await writeQueue(input.memoryDir, queue)

  const appendResult = await appendExploringTranscript({
    memoryDir: input.memoryDir,
    taskId: id,
    role: 'user',
    content: input.ask,
  })
  if (!appendResult.success || !appendResult.path) {
    throw new Error(`Failed to seed transcript: ${appendResult.error ?? 'unknown'}`)
  }

  return { taskId: id, transcriptPath: appendResult.path }
}

function truncateTitle(ask: string): string {
  const firstLine = ask.split(/\n/)[0] ?? ask
  if (firstLine.length <= 60) return firstLine.trim()
  return firstLine.slice(0, 57).trim() + '...'
}

export interface ApproveSpecInput {
  memoryDir: string
  taskId: string
  /** Optional note left on the task by the approving human */
  approvalNote?: string
}

export interface ApproveSpecResult {
  success: boolean
  newStatus?: TaskStatus
  error?: string
}

/**
 * Mark a task's spec as approved by the human. Transitions `exploring` →
 * `spec_review`, where the domain coordinator picks it up next.
 */
export async function approveSpec(input: ApproveSpecInput): Promise<ApproveSpecResult> {
  const queue = await readQueue(input.memoryDir)
  const task = queue.tasks.find((t) => t.id === input.taskId)
  if (!task) return { success: false, error: `Task ${input.taskId} not found` }
  if (task.status !== 'exploring') {
    return {
      success: false,
      error: `Task ${input.taskId} is in status '${task.status}', expected 'exploring'`,
    }
  }
  if (!task.spec || task.spec.trim().length === 0) {
    return {
      success: false,
      error: `Task ${input.taskId} has no spec yet; cannot approve`,
    }
  }

  const now = new Date().toISOString()
  task.status = 'spec_review'
  task.updatedAt = now
  queue.lastUpdated = now

  if (input.approvalNote) {
    task.notes.push({
      agentId: 'human',
      role: 'approver',
      content: input.approvalNote,
      timestamp: now,
    })
  }

  await writeQueue(input.memoryDir, queue)

  await appendExploringTranscript({
    memoryDir: input.memoryDir,
    taskId: task.id,
    role: 'system',
    content: input.approvalNote
      ? `Spec approved by human. Note: ${input.approvalNote}`
      : 'Spec approved by human. Task advanced to spec_review.',
  })

  return { success: true, newStatus: 'spec_review' }
}

// ---------------------------------------------------------------------------
// Maintenance intake: a human-filed bug report becomes a `proposed` task.
//
// Distinct from createExploringTask: the reporter already knows what's broken,
// so we skip the conversational intake and drop the task straight into the
// queue as `proposed` with priority 'high'. The coordinator picks it up on the
// next tick and routes it like any other proposed work.
// ---------------------------------------------------------------------------

export interface BugReportInput {
  memoryDir: string
  projectPath: string
  title: string
  body: string
  stackTrace?: string
  env?: Record<string, string>
  domain: string
  /** Default 'high'. Set to 'normal' for minor bugs, 'critical' for outages. */
  priority?: 'low' | 'normal' | 'high' | 'critical'
}

export interface BugReportResult {
  taskId: string
}

/**
 * Extract the first file path from a stack trace. Matches the common Node/JS
 * frame formats: `at fn (/path/to/file.ts:12:3)` and `at /path/to/file.ts:12:3`.
 * Returns undefined when nothing file-shaped appears.
 */
export function parseStackTraceTopFile(stack: string): string | undefined {
  const lines = stack.split(/\r?\n/)
  for (const line of lines) {
    const paren = line.match(/\(([^()]+?):\d+(?::\d+)?\)/)
    if (paren) return paren[1]
    const bare = line.match(/\bat\s+([^\s()]+?):\d+(?::\d+)?/)
    if (bare) return bare[1]
  }
  return undefined
}

export async function createBugReportTask(input: BugReportInput): Promise<BugReportResult> {
  const queue = await readQueue(input.memoryDir)
  const id = nextTaskId(queue)
  const now = new Date().toISOString()

  const title = `Bug: ${truncateTitle(input.title).replace(/^Bug:\s*/i, '')}`

  const description = [
    input.body.trim(),
    input.stackTrace
      ? `\n**Stack trace:**\n\n\`\`\`\n${input.stackTrace.trim()}\n\`\`\``
      : '',
    input.env && Object.keys(input.env).length > 0
      ? `\n**Environment:**\n${Object.entries(input.env).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n')

  const task: Task = {
    id,
    title,
    description,
    domain: input.domain,
    projectPath: input.projectPath,
    status: 'proposed',
    priority: input.priority ?? 'high',
    dependsOn: [],
    outOfScope: [],
    acceptanceCriteria: [],
    notes: [
      {
        agentId: 'human',
        role: 'reporter',
        content: 'Filed via bug-report intake.',
        timestamp: now,
      },
    ],
    gateResults: [],
    reviewVerdicts: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: now,
    updatedAt: now,
  }

  queue.tasks.push(task)
  queue.lastUpdated = now
  await writeQueue(input.memoryDir, queue)

  return { taskId: id }
}

export interface ResumeExploringInput {
  memoryDir: string
  taskId: string
  /** Optional — if the task is currently blocked on an escalation, resolve it */
  resolveEscalationId?: string
  resolution?: string
  /** The next human message to inject into the transcript */
  message?: string
}

/**
 * Resume an exploring-phase conversation: optionally resolve a pending
 * escalation, optionally append a new user message to the transcript, and
 * ensure the task is back in `exploring` so the Spec Agent will pick it up
 * again.
 */
export async function resumeExploring(input: ResumeExploringInput): Promise<{ success: boolean; error?: string }> {
  const queue = await readQueue(input.memoryDir)
  const task = queue.tasks.find((t) => t.id === input.taskId)
  if (!task) return { success: false, error: `Task ${input.taskId} not found` }

  if (input.resolveEscalationId) {
    const result = await resolveEscalation({
      tasksPath: tasksPathFor(input.memoryDir),
      progressPath: progressPathFor(input.memoryDir),
      taskId: task.id,
      escalationId: input.resolveEscalationId,
      resolution: input.resolution ?? 'Resolved during intake resume',
      resolvedBy: 'human',
      nextStatus: 'exploring',
    })
    if (!result.success) return { success: false, error: result.error ?? 'unknown' }
  }

  if (input.message) {
    await appendExploringTranscript({
      memoryDir: input.memoryDir,
      taskId: task.id,
      role: 'user',
      content: input.message,
    })
  }

  return { success: true }
}
