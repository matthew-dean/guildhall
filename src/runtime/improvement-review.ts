import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync } from '@guildhall/persistence'
import fs from 'node:fs/promises'
import path from 'node:path'

import { TaskQueue, TERMINAL_TASK_STATUSES, type Task, type TaskQueue as TaskQueueType, type TaskStatus } from '@guildhall/core'
import { appendTaskEvidence, getProjectSystemStatePathFromMemoryDir, inferProjectRootFromMemoryDir, readProjectTaskQueueSync, readTaskEvidence } from '@guildhall/sessions'

import { reviewInProcessWorkForDesignLens, type DesignLensReviewResult } from './design-lens-review.js'
import { workSubtreeIds } from './work-hierarchy.js'

const TERMINAL_STATUSES = new Set<TaskStatus>(TERMINAL_TASK_STATUSES)
type ImprovementLensId =
  | 'spec-pressure-test'
  | 'review-calibration'
  | 'proof-path'
  | 'runtime-capability'
  | 'memory-context'
  | 'architecture-fit'
  | 'accessibility'

interface ImprovementLens {
  id: ImprovementLensId
  label: string
  statuses?: readonly TaskStatus[]
  summary: string
}

const IMPROVEMENT_LENSES: ImprovementLens[] = [
  {
    id: 'spec-pressure-test',
    label: 'Spec pressure test',
    statuses: ['exploring', 'import_draft', 'spec_review'],
    summary: 'Recheck this task against current intake and spec-readiness guidance before it moves forward.',
  },
  {
    id: 'review-calibration',
    label: 'Review calibration',
    statuses: ['review', 'gate_check', 'in_progress', 'ready'],
    summary: 'Apply the current review calibration and advisory lenses when this task reaches review.',
  },
  {
    id: 'proof-path',
    label: 'Proof path',
    statuses: ['ready', 'in_progress', 'review', 'gate_check', 'pending_pr'],
    summary: 'Confirm the proof path still matches Guildhall current expectations for visible evidence and release readiness.',
  },
  {
    id: 'runtime-capability',
    label: 'Runtime and capability access',
    statuses: ['ready', 'in_progress', 'review', 'gate_check'],
    summary: 'Check this task against current runtime isolation and capability-request guidance before assuming local access.',
  },
  {
    id: 'memory-context',
    label: 'Memory and context',
    summary: 'Refresh the task context from current Guildhall memory, learning, and project-profile guidance before continuing.',
  },
  {
    id: 'architecture-fit',
    label: 'Architecture fit',
    statuses: ['ready', 'in_progress', 'review', 'gate_check'],
    summary: 'Look for owner-visible architecture or dependency opportunities without silently expanding this task scope.',
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    summary: 'Recheck the work against current accessibility guidance before review or release.',
  },
]

export interface GuildhallImprovementReviewResult {
  design: DesignLensReviewResult
  examinedTaskIds: string[]
  notedTaskIds: string[]
  skippedTaskIds: string[]
}

export async function reviewInProcessWorkForGuildhallImprovements(input: {
  memoryDir: string
  rootTaskId?: string
  maxTaskNotes?: number
  maxDesignFindings?: number
  now?: () => string
}): Promise<GuildhallImprovementReviewResult> {
  const design = await reviewInProcessWorkForDesignLens({
    memoryDir: input.memoryDir,
    ...(input.rootTaskId ? { rootTaskId: input.rootTaskId } : {}),
    maxFindings: input.maxDesignFindings ?? 3,
    ...(input.now ? { now: input.now } : {}),
  })

  const queue = await readQueue(input.memoryDir)
  const scopedIds = input.rootTaskId ? new Set(workSubtreeIds(queue.tasks, input.rootTaskId)) : null
  const examinedTaskIds: string[] = []
  const notedTaskIds: string[] = []
  const skippedTaskIds: string[] = []
  const designReviewedTaskIds = new Set(design.examinedTaskIds)
  const now = input.now?.() ?? new Date().toISOString()
  const noteBudget = input.maxTaskNotes ?? 3
  const projectRoot = inferProjectRootFromMemoryDir(input.memoryDir)

  for (const task of queue.tasks) {
    if (notedTaskIds.length >= noteBudget) break
    if (scopedIds && !scopedIds.has(task.id)) continue
    if (TERMINAL_STATUSES.has(task.status)) continue
    if (task.status === 'proposed') continue
    if (designReviewedTaskIds.has(task.id)) continue
    if (isLeanCommandBackedTask(task)) continue

    const lens = IMPROVEMENT_LENSES.find(candidate =>
      (!candidate.statuses || candidate.statuses.includes(task.status)) &&
      improvementLensApplies(candidate.id, task),
    )
    if (!lens) continue
    examinedTaskIds.push(task.id)
    const existingNotes = hasImprovementReviewNote(task, lens.id)
      ? []
      : await readTaskEvidence(projectRoot, task.id, { kind: 'note' })
    if (hasImprovementReviewNote(task, lens.id) || existingNotes.some(event => hasImprovementReviewNotePayload(event.payload, lens.id))) {
      skippedTaskIds.push(task.id)
      continue
    }

    const note = {
      agentId: 'guildhall-improvement-review',
      role: 'improvement-review',
      content: [
        `[guildhall-improvement-review:${lens.id}] ${lens.label}: ${lens.summary}`,
        'Advisory only: preserve the accepted task intent, keep the current scope unless the owner accepts a broader pivot, and spend deeper review tokens only when the task naturally reaches spec, implementation, review, or gate check.',
      ].join('\n'),
      timestamp: now,
    }
    await appendTaskEvidence(projectRoot, task.id, {
      id: `improvement-review-${task.id}-${lens.id}`,
      kind: 'note',
      recordedAt: now,
      payload: note,
    })
    notedTaskIds.push(task.id)
  }

  return { design, examinedTaskIds, notedTaskIds, skippedTaskIds }
}

function isLeanCommandBackedTask(task: Task): boolean {
  return (
    task.sizePlan?.score === 1 &&
    task.sizePlan.reviewBudgetHint === 'lean' &&
    task.acceptanceCriteria.some((criterion) => typeof criterion.command === 'string' && criterion.command.trim().length > 0)
  )
}

async function readQueue(memoryDir: string): Promise<TaskQueueType> {
  const file = getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  try {
    return TaskQueue.parse(readProjectTaskQueueSync(file))
  } catch {
    return TaskQueue.parse({ version: 1, tasks: [] })
  }
}

function hasImprovementReviewNote(task: Task, lensId: ImprovementLensId): boolean {
  const marker = `[guildhall-improvement-review:${lensId}]`
  return task.notes.some(note => note.role === 'improvement-review' && note.content.includes(marker))
}

function hasImprovementReviewNotePayload(payload: Record<string, unknown>, lensId: ImprovementLensId): boolean {
  const marker = `[guildhall-improvement-review:${lensId}]`
  return payload.role === 'improvement-review' && typeof payload.content === 'string' && payload.content.includes(marker)
}

function improvementLensApplies(lensId: ImprovementLensId, task: Task): boolean {
  const lanes = new Set(task.reviewRisk?.lanes ?? [])
  switch (lensId) {
    case 'spec-pressure-test':
      return task.status === 'exploring' || task.status === 'import_draft' || task.status === 'spec_review'
        ? Boolean(
            task.requestIntake?.ownerDecisionNeeded ||
            (task.requestIntake?.missingInformation.length ?? 0) > 0 ||
            task.taskReadiness?.recommendation === 'needs_one_question',
          )
        : false
    case 'review-calibration':
      return lanes.has('calibration_governance') || task.reviewVerdicts.length > 0 || task.adjudications.length > 0
    case 'proof-path':
      return task.taskKind === 'verification' || task.workKind === 'verification' ||
        (task.proofPaths?.length ?? 0) > 0 || task.acceptanceCriteria.some(criterion => Boolean(criterion.command?.trim()))
    case 'runtime-capability':
      return Boolean(task.permissionMode) || lanes.has('security') || lanes.has('rollout_safety')
    case 'memory-context':
      return task.taskKind === 'learning' || task.workKind === 'learning'
    case 'architecture-fit':
      return lanes.has('api_contract') || lanes.has('data_integrity') || lanes.has('migration_safety') ||
        (task.structuredSpec?.contractSurfaceDeltas?.length ?? 0) > 0 ||
        (task.contractSurfaceReviewPackets?.length ?? 0) > 0
    case 'accessibility':
      return lanes.has('accessibility')
  }
}
