import { z } from 'zod'
import type { Task } from '@guildhall/core'
import type { EvidenceRef, GuildhallPersistence, PersistedRecord, PersistencePlacement } from '@guildhall/persistence'

export const DoneTaskSummaryBundle = z.object({
  taskId: z.string(),
  status: z.string(),
  completedAt: z.string().optional(),
  summary: z.object({
    journey: z.string(),
    decision: z.string(),
    evidence: z.string(),
    learningCandidates: z.array(z.string()).default([]),
    openResidue: z.string(),
  }),
  retention: z.object({
    transcriptPrimaryArtifact: z.boolean(),
    compactedFullTranscript: z.boolean(),
    fullEvidenceAvailable: z.boolean(),
  }),
  evidenceRefs: z.array(z.object({
    scope: z.string(),
    collection: z.string(),
    id: z.string(),
    path: z.string(),
    hash: z.string().optional(),
    contentType: z.string().optional(),
  })).default([]),
  createdAt: z.string(),
  createdBy: z.string(),
})
export type DoneTaskSummaryBundle = z.infer<typeof DoneTaskSummaryBundle>

export interface BuildDoneTaskSummaryBundleInput {
  task: Task
  changedFiles?: readonly string[]
  transcriptRef?: EvidenceRef
  createdAt?: string
  createdBy?: string
}

const doneSummaryPlacement: PersistencePlacement = {
  scope: 'shared_project',
  retention: 'archive',
  visibility: 'user_visible',
  commitPolicy: 'committed',
}

export function buildDoneTaskSummaryBundle(input: BuildDoneTaskSummaryBundleInput): DoneTaskSummaryBundle {
  const task = input.task
  const changedFiles = [...new Set((input.changedFiles ?? []).map((file) => file.trim()).filter(Boolean))]
  const notes = task.notes ?? []
  const reviewVerdicts = task.reviewVerdicts ?? []
  const gateResults = task.gateResults ?? []
  const escalations = task.escalations ?? []
  const agentIssues = task.agentIssues ?? []
  const workerNotes = notes.filter((note) => note.role === 'worker' || note.agentId?.includes('worker'))
  const reviewerCount = reviewVerdicts.length
  const reviseCount = reviewVerdicts.filter((verdict) => verdict.verdict === 'revise').length
  const passedGates = gateResults.filter((gate) => gate.passed)
  const failedGates = gateResults.filter((gate) => gate.passed === false)
  const openEscalations = escalations.filter((escalation) => !escalation.resolvedAt)
  const openIssues = agentIssues.filter((issue) => !issue.resolvedAt)
  const evidenceRefs = input.transcriptRef ? [input.transcriptRef] : []

  return DoneTaskSummaryBundle.parse({
    taskId: task.id,
    status: task.status,
    completedAt: task.completedAt,
    summary: {
      journey: [
        workerNotes.length > 0
          ? `${workerNotes[0]!.agentId} recorded: ${trimSentence(workerNotes[0]!.content)}`
          : 'The worker pass finished and handed the task forward.',
        reviewerCount > 0
          ? `${reviewerCount} reviewer verdict${reviewerCount === 1 ? '' : 's'} recorded${reviseCount > 0 ? `, including ${reviseCount} revision request${reviseCount === 1 ? '' : 's'}` : ''}.`
          : 'No reviewer verdict is recorded.',
      ].join(' '),
      decision: task.status === 'done'
        ? `Task finished as done${task.completedAt ? ` at ${task.completedAt}` : ''}.`
        : `Task finished in terminal status ${task.status}.`,
      evidence: evidenceSummary({ changedFiles, passedGates, failedGates }),
      learningCandidates: learningCandidates(task),
      openResidue: openEscalations.length === 0 && openIssues.length === 0
        ? 'No open residue recorded.'
        : [
            openEscalations.length > 0 ? `${openEscalations.length} open escalation${openEscalations.length === 1 ? '' : 's'}.` : '',
            openIssues.length > 0 ? `${openIssues.length} open issue${openIssues.length === 1 ? '' : 's'}.` : '',
          ].filter(Boolean).join(' '),
    },
    retention: {
      transcriptPrimaryArtifact: false,
      compactedFullTranscript: false,
      fullEvidenceAvailable: evidenceRefs.length === 0 || evidenceRefs.every((ref) => ref.path.trim().length > 0),
    },
    evidenceRefs,
    createdAt: input.createdAt ?? new Date().toISOString(),
    createdBy: input.createdBy ?? 'coordinator-agent',
  })
}

export async function recordDoneTaskSummaryBundle(input: {
  projectRoot: string
  bundle: DoneTaskSummaryBundle
  persistence: Pick<GuildhallPersistence, 'writeRecord'>
}): Promise<PersistedRecord<DoneTaskSummaryBundle>> {
  return input.persistence.writeRecord({
    projectRoot: input.projectRoot,
    placement: doneSummaryPlacement,
    collection: 'done-task-summaries',
    id: input.bundle.taskId,
    schemaName: 'done-task-summary-bundle',
    schemaVersion: 1,
    createdBy: input.bundle.createdBy,
    sourceRefs: [`task:${input.bundle.taskId}`],
    compactedFrom: input.bundle.evidenceRefs as EvidenceRef[],
    payload: input.bundle,
  })
}

function trimSentence(value: string, max = 180): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trimEnd()}…`
}

function evidenceSummary(input: {
  changedFiles: readonly string[]
  passedGates: readonly Task['gateResults'][number][]
  failedGates: readonly Task['gateResults'][number][]
}): string {
  const parts: string[] = []
  if (input.changedFiles.length > 0) {
    parts.push(`Changed ${input.changedFiles.slice(0, 4).join(', ')}${input.changedFiles.length > 4 ? `, and ${input.changedFiles.length - 4} more` : ''}.`)
  }
  if (input.passedGates.length > 0) {
    parts.push(`${input.passedGates.map((gate) => gate.gateId).join(', ')} passed.`)
  }
  if (input.failedGates.length > 0) {
    parts.push(`${input.failedGates.map((gate) => gate.gateId).join(', ')} failed.`)
  }
  return parts.join(' ') || 'No files or gates were recorded as evidence.'
}

function learningCandidates(task: Task): string[] {
  const candidates: string[] = []
  if (task.revisionCount > 0) {
    candidates.push(`Task needed ${task.revisionCount} revision loop${task.revisionCount === 1 ? '' : 's'}; consider a calibration case if this was avoidable.`)
  }
  if (task.sizePlan?.action === 'split_recommended' || task.sizePlan?.action === 'split_required') {
    candidates.push('Task sizing recommended splitting; compare actual journey quality against that recommendation.')
  }
  return candidates
}
