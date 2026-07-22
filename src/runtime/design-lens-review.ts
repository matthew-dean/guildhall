import fs from 'node:fs/promises'
import path from 'node:path'

import { TaskQueue, TERMINAL_TASK_STATUSES, type Task, type TaskStatus } from '@guildhall/core'
import { getProjectSystemStatePathFromMemoryDir } from '@guildhall/sessions'

import {
  type DesignFindingClassification,
  type DesignFinding,
  readDesignFeedbackStore,
  recordDesignFinding,
  routeDesignFinding,
} from './design-feedback.js'
import { workSubtreeIds } from './work-hierarchy.js'

const TERMINAL_STATUSES = new Set<TaskStatus>(TERMINAL_TASK_STATUSES)

export interface DesignLensReviewResult {
  examinedTaskIds: string[]
  createdFindingIds: string[]
  skippedFindingIds: string[]
}

export async function reviewInProcessWorkForDesignLens(input: {
  memoryDir: string
  rootTaskId?: string
  maxFindings?: number
  now?: () => string
}): Promise<DesignLensReviewResult> {
  const queue = await readQueue(input.memoryDir)
  const scopedIds = input.rootTaskId ? new Set(workSubtreeIds(queue.tasks, input.rootTaskId)) : null
  const store = await readDesignFeedbackStore(input.memoryDir)
  const existingIds = new Set(store.findings.map(finding => finding.id))
  const examinedTaskIds: string[] = []
  const createdFindingIds: string[] = []
  const skippedFindingIds: string[] = []

  for (const task of queue.tasks) {
    if (createdFindingIds.length >= (input.maxFindings ?? 5)) break
    if (scopedIds && !scopedIds.has(task.id)) continue
    if (TERMINAL_STATUSES.has(task.status)) continue
    if (task.status === 'proposed') continue
    const classification = designLensClassificationFor(task)
    if (!classification) continue

    examinedTaskIds.push(task.id)
    const findingId = `design-lens-review-${task.id}`
    if (existingIds.has(findingId)) {
      skippedFindingIds.push(findingId)
      continue
    }

    const finding = await recordDesignFinding({
      memoryDir: input.memoryDir,
      finding: buildDesignLensFinding(task, classification, findingId, input.now?.() ?? new Date().toISOString()),
    })
    await routeDesignFinding({ memoryDir: input.memoryDir, findingId: finding.id })
    existingIds.add(finding.id)
    createdFindingIds.push(finding.id)
  }

  return { examinedTaskIds, createdFindingIds, skippedFindingIds }
}

async function readQueue(memoryDir: string): Promise<TaskQueue> {
  const file = getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  try {
    return TaskQueue.parse(JSON.parse(await fs.readFile(file, 'utf-8')))
  } catch {
    return TaskQueue.parse({ version: 1, lastUpdated: new Date().toISOString(), tasks: [] })
  }
}

function buildDesignLensFinding(
  task: Task,
  classification: DesignFindingClassification,
  findingId: string,
  now: string,
): Omit<DesignFinding, 'classification'> {
  const hierarchyLine = ' Recheck the semantic text hierarchy too: primary/current, body, secondary, muted, history, action, state, and code should map to named roles. If the active work needs a new text role, token, or component variant, require a token or variant budget before the surface consumes it.'
  const architectureLine = classification === 'architecture-opportunity'
    ? ' Check whether the stronger move is an owner-visible dependency or architecture pivot, including bespoke-to-library or library-to-bespoke. If the current shape is style sprawl, prefer elevating the need into shared UI primitives, shared layout controls, or clearer design-system prop semantics.'
    : ''
  return {
    id: findingId,
    summary: `Recheck active work "${task.title}" with the current design lens before it advances. Preserve the accepted intent, fill design blind spots, and confirm the control, layout, and design-system choices are still strong. Do not let the task add new style sprawl in product surfaces when the stronger move is to extend or extract shared UI semantics.${hierarchyLine}${architectureLine}`,
    source: {
      kind: 'design-lens-review',
      artifactId: `task:${task.id}`,
    },
    severity: classification === 'architecture-opportunity' ? 'medium' : 'low',
    dimension: classification === 'architecture-opportunity'
      ? 'design-architecture-opportunity'
      : classification === 'token-system-gap'
        ? 'design-system-token-gap'
        : 'design-lens-backstop',
    targetPackage: classification === 'token-system-gap' ? 'tokens' : 'core',
    evidenceRefs: [
      {
        kind: 'task',
        ref: task.id,
        summary: `${task.status} task with UI/design-system signals that may predate the current design lens.`,
      },
    ],
    suggestedClassification: classification,
    createdAt: now,
    updatedAt: now,
  }
}

function designLensClassificationFor(task: Task): DesignFindingClassification | null {
  const lanes = new Set(task.reviewRisk?.lanes ?? [])
  const structured = task.structuredSpec
  const hasDesignLane = lanes.has('visual_design') ||
    lanes.has('ux_comprehension') ||
    lanes.has('accessibility')
  const hasStructuredDesignSurface = Boolean(
    structured?.visualInteractionNotes?.trim() ||
    structured?.componentApiShape?.trim() ||
    structured?.userFacingBehavior?.trim(),
  )
  const isExplicitComponentWork = task.workKind === 'component' || task.workKind === 'story'
  if (!hasDesignLane && !hasStructuredDesignSurface && !isExplicitComponentWork) return null
  if (isExplicitComponentWork || structured?.componentApiShape?.trim()) return 'architecture-opportunity'
  return 'reusable-pattern'
}
