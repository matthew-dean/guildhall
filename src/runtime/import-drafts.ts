import { readManagedTextFile } from '@guildhall/persistence'
import { clearTaskRuntimeState, clearTaskWorkspaceState, inferProjectRootFromMemoryDir } from '@guildhall/sessions'
import { existsSync } from 'node:fs'
import type { Task } from '@guildhall/core'
import { appendExploringTranscript } from '@guildhall/tools'
import { transitionTaskStatus } from './task-transition.js'
import { taskNeedsImportedBriefShaping } from '@guildhall/shared'

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function noteArray(task: Task): Task['notes'] {
  return Array.isArray(task.notes) ? task.notes : []
}

function hasShapingProgress(task: Task): boolean {
  return noteArray(task).some((note) => {
    if (note?.role === 'shaping-request') return true
    return note?.role === 'state-repair' && /imported draft shaping/i.test(note.content ?? '')
  })
}

export function hasWorkspaceImportProvenance(task: Task): boolean {
  if (task.requestIntake?.createdBy === 'workspace-importer') return true
  if (task.requestIntake?.evidenceRefs?.some(ref => /^import:/.test(ref))) return true
  if ((task.sourceClaims?.length ?? 0) > 0) return true
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

function importedEvidencePaths(task: Task): string[] {
  const refs = new Set<string>()
  for (const ref of task.references ?? []) {
    if (typeof ref !== 'string') continue
    const trimmed = ref.trim()
    if (!trimmed) continue
    refs.add(trimmed)
  }
  for (const claim of task.sourceClaims ?? []) {
    for (const ref of claim.references ?? []) {
      const trimmed = ref.trim()
      if (trimmed) refs.add(trimmed)
    }
  }
  for (const ref of task.requestIntake?.evidenceRefs ?? []) {
    if (typeof ref !== 'string') continue
    const match = /^import:(.+)$/.exec(ref.trim())
    if (!match?.[1]) continue
    refs.add(match[1])
  }
  return [...refs]
}

function compactImportText(text: string, max = 320): string {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^```/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, max)
    .trim()
}

async function buildImportedEvidenceSummary(task: Task): Promise<string> {
  const sections: string[] = []
  sections.push('Imported draft context')
  sections.push('======================')
  sections.push(`Title: ${task.title}`)
  if (trimmed(task.description)) {
    sections.push(`Current draft: ${trimmed(task.description)}`)
  }
  if (task.requestIntake?.assumptions?.length) {
    sections.push('')
    sections.push('Assumptions')
    sections.push('-----------')
    for (const assumption of task.requestIntake.assumptions) {
      sections.push(`- ${assumption}`)
    }
  }
  if (task.requestIntake?.missingInformation?.length) {
    sections.push('')
    sections.push('Known missing information')
    sections.push('-------------------------')
    for (const missing of task.requestIntake.missingInformation) {
      sections.push(`- ${missing}`)
    }
  }

  if (task.sourceClaims?.length) {
    sections.push('')
    sections.push('Source claims')
    sections.push('-------------')
    for (const claim of task.sourceClaims.slice(0, 8)) {
      const evidence = compactImportText(claim.evidence, 500)
      sections.push(`- ${claim.title}${claim.source ? ` (${claim.source})` : ''}`)
      if (evidence) sections.push(`  Evidence: ${evidence}`)
      if (claim.references?.length) sections.push(`  References: ${claim.references.join(', ')}`)
    }
  }

  const importerNotes = noteArray(task).filter(note =>
    note?.role === 'importer' || note?.agentId === 'workspace-importer',
  )
  if (importerNotes.length > 0) {
    sections.push('')
    sections.push('Importer notes')
    sections.push('--------------')
    for (const note of importerNotes.slice(-3)) {
      const content = compactImportText(note?.content ?? '', 500)
      if (content) sections.push(`- ${content}`)
    }
  }

  const evidencePaths = importedEvidencePaths(task)
  if (evidencePaths.length > 0) {
    sections.push('')
    sections.push('Imported evidence')
    sections.push('-----------------')
    for (const evidencePath of evidencePaths.slice(0, 6)) {
      sections.push(`- ${evidencePath}`)
      if (!existsSync(evidencePath)) continue
      try {
        const raw = await readManagedTextFile(evidencePath, 'utf-8')
        const excerpt = compactImportText(raw, 420)
        if (excerpt) sections.push(`  Excerpt: ${excerpt}`)
      } catch {
        // Best effort: missing excerpt is less harmful than blocking shaping.
      }
    }
  }

  sections.push('')
  sections.push(
    'Use the imported evidence above while drafting the brief/spec. Preserve the real documented intent, pull concrete scope and success criteria from the cited docs, and ask only the minimum clarifying questions needed when the sources still conflict or leave the boundary unclear.',
  )
  return sections.join('\n')
}

export function shouldUseImportDraftState(task: Task): boolean {
  if (!hasWorkspaceImportProvenance(task)) return false
  if (hasShapingProgress(task)) return false
  if (task.status === 'import_draft') return true
  if (task.status !== 'exploring') return false
  return !hasSpecDraft(task) && !hasProductBriefShape(task) && !hasAnyAcceptanceCriteria(task) && !hasOpenQuestions(task)
}

export function importedTaskNeedsBriefShaping(task: Task): boolean {
  return taskNeedsImportedBriefShaping(task)
}

export function importedTaskNeedsSourceRecovery(task: Task): boolean {
  if (!hasWorkspaceImportProvenance(task)) return false
  if (task.status === 'done' || task.status === 'shelved' || task.status === 'archived') return false
  return task.taskReadiness?.recommendation === 'needs_research_spike'
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
  const projectRoot = inferProjectRootFromMemoryDir(memoryDir)
  transitionTaskStatus({
    task,
    event: 'start_intake',
    actor: 'human',
    evidenceRefs: ['task:shape-import-draft'],
    now,
  })
  task.assignedTo = null
  delete task.blockReason
  delete task.worktreePath
  delete task.branchName
  delete task.baseBranch
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
  const evidenceSummary = await buildImportedEvidenceSummary(task)
  if (projectRoot) {
    await Promise.all([
      clearTaskRuntimeState(projectRoot, task.id),
      clearTaskWorkspaceState(projectRoot, task.id),
    ])
  }
  await appendExploringTranscript({
    memoryDir,
    taskId: task.id,
    role: 'system',
    content: evidenceSummary,
  })
}

export async function continueImportedSourceRecovery(task: Task, memoryDir: string): Promise<void> {
  const now = new Date().toISOString()
  const projectRoot = inferProjectRootFromMemoryDir(memoryDir)
  task.assignedTo = null
  delete task.blockReason
  delete task.worktreePath
  delete task.branchName
  delete task.baseBranch
  task.updatedAt = now
  if (!hasShapingProgress(task)) {
    task.notes = [
      ...noteArray(task),
      {
        agentId: 'human',
        role: 'shaping-request',
        content: 'User asked Guildhall to continue shaping this imported task from its source evidence.',
        timestamp: now,
      },
    ]
  }
  if (projectRoot) {
    await Promise.all([
      clearTaskRuntimeState(projectRoot, task.id),
      clearTaskWorkspaceState(projectRoot, task.id),
    ])
  }
  const evidenceSummary = await buildImportedEvidenceSummary(task)
  await appendExploringTranscript({
    memoryDir,
    taskId: task.id,
    role: 'system',
    content: evidenceSummary,
  })
}
