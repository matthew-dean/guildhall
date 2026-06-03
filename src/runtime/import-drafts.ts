import type { Task } from '@guildhall/core'
import { appendExploringTranscript } from '@guildhall/tools'
import { transitionTaskStatus } from './task-transition.js'

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function noteArray(task: Task): Task['notes'] {
  return Array.isArray(task.notes) ? task.notes : []
}

function hasShapingRequest(task: Task): boolean {
  return noteArray(task).some((note) => note?.role === 'shaping-request')
}

export function hasWorkspaceImportProvenance(task: Task): boolean {
  return noteArray(task).some((note) =>
    note?.role === 'importer' ||
    note?.agentId === 'workspace-importer' ||
    note?.agentId === 'workspace-importer-agent',
  )
}

function hasProductBriefShape(task: Task): boolean {
  const brief = task.productBrief
  if (!brief) return false
  return Boolean(
    trimmed(brief.userJob) ||
    trimmed(brief.whyItMattersNow) ||
    trimmed(brief.successMetric) ||
    trimmed(brief.rolloutPlan) ||
    (Array.isArray(brief.nonGoals) && brief.nonGoals.length > 0) ||
    (Array.isArray(brief.antiPatterns) && brief.antiPatterns.length > 0),
  )
}

function hasAnyAcceptanceCriteria(task: Task): boolean {
  return Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length > 0
}

function hasOpenQuestions(task: Task): boolean {
  return Array.isArray(task.openQuestions) && task.openQuestions.length > 0
}

function hasSpecDraft(task: Task): boolean {
  return trimmed(task.spec).length > 0
}

export function shouldUseImportDraftState(task: Task): boolean {
  if (!hasWorkspaceImportProvenance(task)) return false
  if (hasShapingRequest(task)) return false
  if (task.status === 'import_draft') return true
  if (task.status !== 'exploring') return false
  return !hasSpecDraft(task) && !hasProductBriefShape(task) && !hasAnyAcceptanceCriteria(task) && !hasOpenQuestions(task)
}

export function normalizeImportedDraftTask(task: Task): boolean {
  if (!shouldUseImportDraftState(task)) return false
  if (task.status === 'import_draft') return false
  transitionTaskStatus({
    task,
    event: 'mark_import_draft',
    actor: 'workspace-importer',
    evidenceRefs: ['task:workspace-import'],
    now: new Date().toISOString(),
  })
  task.assignedTo = null
  return true
}

export async function promoteImportDraftToExploring(task: Task, memoryDir: string): Promise<void> {
  const now = new Date().toISOString()
  transitionTaskStatus({
    task,
    event: 'start_intake',
    actor: 'human',
    evidenceRefs: ['task:shape-import-draft'],
    now,
  })
  task.assignedTo = null
  task.updatedAt = now
  task.notes = [
    ...noteArray(task),
    {
      agentId: 'human',
      role: 'shaping-request',
      content: 'User asked Guildhall to shape this imported draft into a complete task.',
      timestamp: now,
    },
  ]
  await appendExploringTranscript({
    memoryDir,
    taskId: task.id,
    role: 'system',
    content:
      'Imported from project notes. Turn this into a complete task by drafting the product brief, defining success, adding starter acceptance criteria, and asking only the minimum clarifying questions needed.',
  })
}
