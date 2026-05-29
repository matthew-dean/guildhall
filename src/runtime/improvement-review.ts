import fs from 'node:fs/promises'
import path from 'node:path'

import { TaskQueue, TERMINAL_TASK_STATUSES, type Task, type TaskQueue as TaskQueueType, type TaskStatus } from '@guildhall/core'
import { atomicWriteText } from '@guildhall/sessions'

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
  signal: RegExp
  statuses?: readonly TaskStatus[]
  summary: string
}

const IMPROVEMENT_LENSES: ImprovementLens[] = [
  {
    id: 'spec-pressure-test',
    label: 'Spec pressure test',
    signal: /\b(intake|scope creep|assumption|unclear|ambiguous|open question|question|brief gap|missing brief|missing success metric)\b/i,
    statuses: ['exploring', 'import_draft', 'spec_review'],
    summary: 'Recheck this task against current intake and spec-readiness guidance before it moves forward.',
  },
  {
    id: 'review-calibration',
    label: 'Review calibration',
    signal: /\b(review|rubric|persona|fan[- ]out|adjudicat|approve|revise|risk|regression|gate)\b/i,
    statuses: ['review', 'gate_check', 'in_progress', 'ready'],
    summary: 'Apply the current review calibration and advisory lenses when this task reaches review.',
  },
  {
    id: 'proof-path',
    label: 'Proof path',
    signal: /\b(proof|verify|verification|browser|screenshot|playwright|e2e|release|manual test)\b/i,
    statuses: ['ready', 'in_progress', 'review', 'gate_check', 'pending_pr'],
    summary: 'Confirm the proof path still matches Guildhall current expectations for visible evidence and release readiness.',
  },
  {
    id: 'runtime-capability',
    label: 'Runtime and capability access',
    signal: /\b(runtime|dev server|localhost|podman|docker|container|mount|host path|permission|capability|env|credential|secret|setup)\b/i,
    statuses: ['ready', 'in_progress', 'review', 'gate_check'],
    summary: 'Check this task against current runtime isolation and capability-request guidance before assuming local access.',
  },
  {
    id: 'memory-context',
    label: 'Memory and context',
    signal: /\b(memory|learning|context|corpus map|profile|project knowledge|handoff|transcript|local history|agent context)\b/i,
    summary: 'Refresh the task context from current Guildhall memory, learning, and project-profile guidance before continuing.',
  },
  {
    id: 'architecture-fit',
    label: 'Architecture fit',
    signal: /\b(architecture|third[- ]party|package|library|bespoke|custom|schema|api|persistence|abstraction|migration|replace|remove|overhead|bundle)\b/i,
    statuses: ['ready', 'in_progress', 'review', 'gate_check'],
    summary: 'Look for owner-visible architecture or dependency opportunities without silently expanding this task scope.',
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    signal: /\b(accessibility|a11y|keyboard|screen reader|aria|focus|contrast|reduced motion|semantic)\b/i,
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

  for (const task of queue.tasks) {
    if (notedTaskIds.length >= noteBudget) break
    if (scopedIds && !scopedIds.has(task.id)) continue
    if (TERMINAL_STATUSES.has(task.status)) continue
    if (task.status === 'proposed' || task.status === 'parent') continue
    if (designReviewedTaskIds.has(task.id)) continue

    const text = taskTextForImprovementReview(task)
    const lens = IMPROVEMENT_LENSES.find(candidate =>
      (!candidate.statuses || candidate.statuses.includes(task.status)) &&
      candidate.signal.test(text),
    )
    if (!lens) continue
    examinedTaskIds.push(task.id)
    if (hasImprovementReviewNote(task, lens.id)) {
      skippedTaskIds.push(task.id)
      continue
    }

    task.notes.push({
      agentId: 'guildhall-improvement-review',
      role: 'improvement-review',
      content: [
        `[guildhall-improvement-review:${lens.id}] ${lens.label}: ${lens.summary}`,
        'Advisory only: preserve the accepted task intent, keep the current scope unless the owner accepts a broader pivot, and spend deeper review tokens only when the task naturally reaches spec, implementation, review, or gate check.',
      ].join('\n'),
      timestamp: now,
    })
    task.updatedAt = now
    notedTaskIds.push(task.id)
  }

  if (notedTaskIds.length > 0) {
    queue.lastUpdated = now
    await writeQueue(input.memoryDir, queue)
  }

  return { design, examinedTaskIds, notedTaskIds, skippedTaskIds }
}

async function readQueue(memoryDir: string): Promise<TaskQueueType> {
  const file = path.join(memoryDir, 'TASKS.json')
  try {
    return TaskQueue.parse(JSON.parse(await fs.readFile(file, 'utf-8')))
  } catch {
    return TaskQueue.parse({ version: 1, tasks: [] })
  }
}

async function writeQueue(memoryDir: string, queue: TaskQueueType): Promise<void> {
  await atomicWriteText(path.join(memoryDir, 'TASKS.json'), JSON.stringify(TaskQueue.parse(queue), null, 2))
}

function hasImprovementReviewNote(task: Task, lensId: ImprovementLensId): boolean {
  const marker = `[guildhall-improvement-review:${lensId}]`
  return task.notes.some(note => note.role === 'improvement-review' && note.content.includes(marker))
}

function taskTextForImprovementReview(task: Task): string {
  return [
    task.title,
    task.description,
    task.request?.raw,
    task.spec,
    task.productBrief?.userJob,
    task.productBrief?.successMetric,
    task.productBrief?.antiPatterns?.join('\n'),
    task.acceptanceCriteria.map(ac => `${ac.id} ${ac.description} ${ac.verifiedBy} ${ac.command ?? ''}`).join('\n'),
    task.outOfScope.join('\n'),
    task.notes
      .filter(note => note.role !== 'improvement-review')
      .map(note => note.content)
      .join('\n'),
  ].filter(Boolean).join('\n')
}
