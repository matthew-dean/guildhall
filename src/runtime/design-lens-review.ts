import fs from 'node:fs/promises'
import path from 'node:path'

import { TaskQueue, TERMINAL_TASK_STATUSES, type Task, type TaskStatus } from '@guildhall/core'

import {
  type DesignFindingClassification,
  type DesignFinding,
  readDesignFeedbackStore,
  recordDesignFinding,
  routeDesignFinding,
} from './design-feedback.js'
import { workSubtreeIds } from './work-hierarchy.js'

const DESIGN_REVIEW_TASK_SIGNALS = /\b(ui|ux|frontend|front[- ]end|screen|page|view|form|modal|drawer|panel|toolbar|navigation|nav|component|primitive|variant|props?|control|button|split button|menu button|select|dropdown|combobox|typeahead|autocomplete|listbox|long list|layout|spacing|css|style|tailwind|token|design system|design-system|storybook|ladle|looma|ad-hoc|one-off|inline style|className)\b/i
const ARCHITECTURE_OPPORTUNITY_SIGNALS = /\b(third[- ]party|dependency|package|library|bespoke|custom|replace|remove|overhead|bundle|virtuali[sz]ation|positioning|combobox|autocomplete|typeahead|architecture|pivot|ad-hoc|one-off|style sprawl|inline style|wrapper class)\b/i
const TOKEN_GAP_SIGNALS = /\b(token|spacing|radius|density|motion|contrast|palette|color|typography)\b/i
const TERMINAL_STATUSES = new Set<TaskStatus>(TERMINAL_TASK_STATUSES)
const GENERATED_NOTE_ROLES = new Set([
  'automation',
  'approver',
  'blueprint-review',
  'git-story',
  'improvement-review',
  'orchestrator',
])

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
    const taskText = designLensTaskText(task)
    if (!DESIGN_REVIEW_TASK_SIGNALS.test(taskText)) continue

    examinedTaskIds.push(task.id)
    const findingId = `design-lens-review-${task.id}`
    if (existingIds.has(findingId)) {
      skippedFindingIds.push(findingId)
      continue
    }

    const finding = await recordDesignFinding({
      memoryDir: input.memoryDir,
      finding: buildDesignLensFinding(task, taskText, findingId, input.now?.() ?? new Date().toISOString()),
    })
    await routeDesignFinding({ memoryDir: input.memoryDir, findingId: finding.id })
    existingIds.add(finding.id)
    createdFindingIds.push(finding.id)
  }

  return { examinedTaskIds, createdFindingIds, skippedFindingIds }
}

async function readQueue(memoryDir: string): Promise<TaskQueue> {
  const file = path.join(memoryDir, 'TASKS.json')
  try {
    return TaskQueue.parse(JSON.parse(await fs.readFile(file, 'utf-8')))
  } catch {
    return TaskQueue.parse({ version: 1, tasks: [] })
  }
}

function buildDesignLensFinding(
  task: Task,
  taskText: string,
  findingId: string,
  now: string,
): Omit<DesignFinding, 'classification'> {
  const classification = classifyTaskForDesignLens(taskText)
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

function classifyTaskForDesignLens(taskText: string): DesignFindingClassification {
  if (ARCHITECTURE_OPPORTUNITY_SIGNALS.test(taskText)) return 'architecture-opportunity'
  if (TOKEN_GAP_SIGNALS.test(taskText)) return 'token-system-gap'
  return 'reusable-pattern'
}

function designLensTaskText(task: Task): string {
  return [
    task.title,
    task.description,
    task.request?.raw,
    stripGeneratedBoundarySections(task.spec),
    task.productBrief?.userJob,
    task.productBrief?.successMetric,
    task.productBrief?.antiPatterns?.join('\n'),
    task.acceptanceCriteria.map(ac => `${ac.id} ${ac.description}`).join('\n'),
    task.notes
      .filter(note => !GENERATED_NOTE_ROLES.has(note.role))
      .map(note => note.content)
      .join('\n'),
  ].filter(Boolean).join('\n')
}

function stripGeneratedBoundarySections(text: string | undefined): string | undefined {
  if (!text) return undefined
  const stripped: string[] = []
  let skipping = false
  for (const line of text.split('\n')) {
    if (/^##\s+(Out of Scope|Security Review)\b/i.test(line)) {
      skipping = true
      continue
    }
    if (skipping && /^##\s+/.test(line)) {
      skipping = false
    }
    if (!skipping) stripped.push(line)
  }
  return stripped.join('\n')
}
