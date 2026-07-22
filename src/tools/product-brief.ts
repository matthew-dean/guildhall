import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync } from '@guildhall/persistence'
import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import { TaskQueue, type ProductBrief } from '@guildhall/core'
import {
  readProjectTaskQueueForMutationSync,
  readProjectStateAuthorityAtBoundary,
  readProjectTaskQueueSync,
  writePromotedTaskDetailMutation,
  writeProjectTaskQueueWithSummary,
} from '@guildhall/runtime/project-state-boundary'
import { validateProductBriefGrounding } from '@guildhall/runtime/spec-quality'

// ---------------------------------------------------------------------------
// update-product-brief: the Spec Agent's authoring surface for the product
// brief. This is the *why* layer of a task — who it serves, how we'll know
// it worked, and what it must NOT do. Brief approval is an independent
// human gate from spec approval; see `approve-brief` on the HTTP side.
// ---------------------------------------------------------------------------

const TASKS_PATH_SCHEMA = z.string().describe('Absolute path to the TASKS.json file')

const updateProductBriefInputSchema = z.object({
  tasksPath: TASKS_PATH_SCHEMA.optional(),
  taskId: z.string().optional(),
  userJob: z.string().optional().describe('Who the task serves and what job it does for them'),
  whyItMattersNow: z.string().optional().describe('Why this matters now and why the task exists'),
  successMetric: z.string().optional().describe('How we\'ll know this worked — observable outcome'),
  nonGoals: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .describe('Intentional boundary — what this brief is explicitly not trying to do'),
  audience: z.string().optional().describe('Who this is for when that matters to say explicitly'),
  usageContext: z.string().optional().describe('Where or when the user encounters this outcome'),
  antiPatterns: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .describe('Legacy alias for nonGoals. Things this task must NOT do — product / brand / ux-level prohibitions'),
  rolloutPlan: z
    .string()
    .optional()
    .describe('Staging, flagging, migration notes, if any'),
  brandInteractionNotes: z
    .string()
    .optional()
    .describe('Optional brand, voice, or interaction-shape notes when the task touches product surface area'),
  authoredBy: z
    .string()
    .optional()
    .describe('Agent id or "human" — who is authoring the brief right now'),
  productBrief: z
    .union([
      z.string(),
      z.object({
        userJob: z.string().optional(),
        whyItMattersNow: z.string().optional(),
        successMetric: z.string().optional(),
        nonGoals: z.union([z.array(z.string()), z.string()]).optional(),
        audience: z.string().optional(),
        usageContext: z.string().optional(),
        antiPatterns: z.union([z.array(z.string()), z.string()]).optional(),
        rolloutPlan: z.string().optional(),
        brandInteractionNotes: z.string().optional(),
      }).passthrough(),
    ])
    .optional()
    .describe('Optional nested/serialized structured brief payload.'),
})

export type UpdateProductBriefInput = z.input<typeof updateProductBriefInputSchema>
export interface UpdateProductBriefResult {
  success: boolean
  error?: string
}

interface ResolvedBriefTarget {
  tasksPath: string
  taskId: string
  authoredBy: string
}

interface ResolvedBriefContent {
  userJob: string
  whyItMattersNow: string
  successMetric: string
  nonGoals: string[]
  audience?: string
  usageContext?: string
  antiPatterns: string[]
  rolloutPlan?: string
  brandInteractionNotes?: string
}

interface BriefLikePayload {
  userJob?: string
  whyItMattersNow?: string
  successMetric?: string
  nonGoals?: string[]
  audience?: string
  usageContext?: string
  antiPatterns?: string[]
  rolloutPlan?: string
  brandInteractionNotes?: string
}

function fallbackWhyItMattersNow(taskTitle: string, userJob: string, successMetric: string): string {
  const trimmedTitle = taskTitle.trim() || 'this task'
  const trimmedMetric = successMetric.trim()
  if (trimmedMetric) {
    return `This matters now because Guildhall needs "${trimmedTitle}" framed tightly enough to reach this outcome: ${trimmedMetric}`
  }
  return `This matters now because Guildhall needs "${trimmedTitle}" framed tightly enough to support the job: ${userJob.trim()}`
}

function fallbackNonGoals(taskTitle: string): string[] {
  return [`Do not let "${taskTitle.trim() || 'this task'}" quietly expand into unrelated follow-up work.`]
}

function normalizeAntiPatternsValue(raw: unknown): string[] | undefined {
  const normalizeItem = (item: unknown): string[] => {
    if (typeof item !== 'string') return []
    const trimmed = item.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (Array.isArray(parsed)) return parsed.flatMap(normalizeItem)
      } catch {
        // Keep malformed user text as one boundary item rather than dropping it.
      }
    }
    return [trimmed]
  }
  if (Array.isArray(raw)) {
    const values = raw.flatMap(normalizeItem)
    return values.length > 0 ? values : undefined
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (Array.isArray(parsed)) return normalizeAntiPatternsValue(parsed)
      } catch {
        // Fall through to newline parsing for ordinary text beginning with '['.
      }
    }
    const values = trimmed
      .split('\n')
      .map((line) => line.trim())
      .map((line) => line.replace(/^[*-]\s*/, '').trim())
      .filter(Boolean)
    return values.length > 0 ? values : undefined
  }
  return undefined
}

function resolveBriefTarget(
  input: Pick<UpdateProductBriefInput, 'tasksPath' | 'taskId' | 'authoredBy'>,
  metadata: Record<string, unknown>,
): ResolvedBriefTarget | { error: string } {
  const tasksPath = String(input.tasksPath ?? metadata['tasks_path'] ?? '').trim()
  const taskId = String(input.taskId ?? metadata['current_task_id'] ?? '').trim()
  const authoredBy = String(input.authoredBy ?? metadata['current_agent_id'] ?? 'agent').trim()
  if (!tasksPath) return { error: 'Missing tasksPath (or metadata.tasks_path)' }
  if (!taskId) return { error: 'Missing taskId (or metadata.current_task_id)' }
  if (!authoredBy) return { error: 'Missing authoredBy (or metadata.current_agent_id)' }
  return { tasksPath, taskId, authoredBy }
}

function validateBriefContent(content: ResolvedBriefContent): string | null {
  if (!content.nonGoals.length && !content.antiPatterns.length) {
    return 'Product brief must name at least one non-goal or anti-pattern so the task boundary is explicit.'
  }
  return null
}

function parseBriefLikePayload(raw: unknown): BriefLikePayload | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return null
    try {
      const parsed = JSON.parse(trimmed) as unknown
      return parseBriefLikePayload(parsed)
    } catch {
      return null
    }
  }
  if (typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const antiPatterns = normalizeAntiPatternsValue(obj.antiPatterns)
  const nonGoals = normalizeAntiPatternsValue(obj.nonGoals)
  const userJob = typeof obj.userJob === 'string' ? obj.userJob.trim() : undefined
  const whyItMattersNow = typeof obj.whyItMattersNow === 'string' ? obj.whyItMattersNow.trim() : undefined
  const successMetric = typeof obj.successMetric === 'string' ? obj.successMetric.trim() : undefined
  const audience = typeof obj.audience === 'string' ? obj.audience.trim() : undefined
  const usageContext = typeof obj.usageContext === 'string' ? obj.usageContext.trim() : undefined
  const rolloutPlan = typeof obj.rolloutPlan === 'string' ? obj.rolloutPlan.trim() : undefined
  const brandInteractionNotes = typeof obj.brandInteractionNotes === 'string' ? obj.brandInteractionNotes.trim() : undefined
  if (!userJob && !whyItMattersNow && !successMetric && !antiPatterns?.length && !nonGoals?.length && !rolloutPlan && !audience && !usageContext && !brandInteractionNotes) return null
  return {
    ...(userJob ? { userJob } : {}),
    ...(whyItMattersNow ? { whyItMattersNow } : {}),
    ...(successMetric ? { successMetric } : {}),
    ...(nonGoals ? { nonGoals } : {}),
    ...(audience ? { audience } : {}),
    ...(usageContext ? { usageContext } : {}),
    ...(antiPatterns ? { antiPatterns } : {}),
    ...(rolloutPlan ? { rolloutPlan } : {}),
    ...(brandInteractionNotes ? { brandInteractionNotes } : {}),
  }
}

function resolveBriefContent(
  input: Pick<UpdateProductBriefInput, 'userJob' | 'whyItMattersNow' | 'successMetric' | 'nonGoals' | 'audience' | 'usageContext' | 'antiPatterns' | 'rolloutPlan' | 'brandInteractionNotes' | 'productBrief'>,
  taskTitle: string,
): ResolvedBriefContent | { error: string } {
  const nested = parseBriefLikePayload(input.productBrief)
  const userJob = input.userJob?.trim() || nested?.userJob?.trim()
  const whyItMattersNow = input.whyItMattersNow?.trim() || nested?.whyItMattersNow?.trim()
  const successMetric = input.successMetric?.trim() || nested?.successMetric?.trim()
  const inputNonGoals = normalizeAntiPatternsValue(input.nonGoals)
  const inputAntiPatterns = normalizeAntiPatternsValue(input.antiPatterns)
  const nonGoals = inputNonGoals?.length
    ? inputNonGoals
    : nested?.nonGoals ?? inputAntiPatterns ?? nested?.antiPatterns
  const antiPatterns = inputAntiPatterns?.length
    ? inputAntiPatterns
    : nested?.antiPatterns ?? nonGoals
  const audience = input.audience?.trim() || nested?.audience?.trim()
  const usageContext = input.usageContext?.trim() || nested?.usageContext?.trim()
  const rolloutPlan = input.rolloutPlan?.trim() || nested?.rolloutPlan?.trim()
  const brandInteractionNotes = input.brandInteractionNotes?.trim() || nested?.brandInteractionNotes?.trim()

  if (userJob && successMetric) {
    const resolvedWhy = whyItMattersNow || fallbackWhyItMattersNow(taskTitle, userJob, successMetric)
    const resolvedNonGoals = nonGoals?.length ? nonGoals : fallbackNonGoals(taskTitle)
    const resolvedAntiPatterns = antiPatterns?.length ? antiPatterns : resolvedNonGoals
    const content = {
      userJob,
      whyItMattersNow: resolvedWhy,
      successMetric,
      nonGoals: resolvedNonGoals,
      ...(audience ? { audience } : {}),
      ...(usageContext ? { usageContext } : {}),
      antiPatterns: resolvedAntiPatterns,
      ...(rolloutPlan ? { rolloutPlan } : {}),
      ...(brandInteractionNotes ? { brandInteractionNotes } : {}),
    }
    const validationError = validateBriefContent(content)
    return validationError ? { error: validationError } : content
  }

  return {
    error:
      'Missing userJob/successMetric. Guildhall does not infer durable product briefs from assistant prose; call update-product-brief with the structured brief fields.',
  }
}

export async function updateProductBrief(
  input: UpdateProductBriefInput,
): Promise<UpdateProductBriefResult> {
  if (!input.tasksPath?.trim()) return { success: false, error: 'Missing tasksPath' }
  if (!input.taskId?.trim()) return { success: false, error: 'Missing taskId' }
  if (!input.authoredBy?.trim()) return { success: false, error: 'Missing authoredBy' }
  try {
    const queueRead = readProjectTaskQueueForMutationSync(input.tasksPath)
    const queue = TaskQueue.parse(queueRead.queue)
    const task = queue.tasks.find((t) => t.id === input.taskId)
    if (!task) return { success: false, error: `Task ${input.taskId} not found` }
    if (!input.userJob?.trim()) return { success: false, error: 'Missing userJob' }
    if (!input.successMetric?.trim()) return { success: false, error: 'Missing successMetric' }

    const now = new Date().toISOString()
    const existing = task.productBrief
    const normalizedNonGoals = normalizeAntiPatternsValue(input.nonGoals)
    const normalizedAntiPatterns = normalizeAntiPatternsValue(input.antiPatterns)
    const resolvedWhy = input.whyItMattersNow?.trim() || fallbackWhyItMattersNow(task.title, input.userJob.trim(), input.successMetric.trim())
    const resolvedNonGoals = normalizedNonGoals ?? normalizedAntiPatterns ?? fallbackNonGoals(task.title)
    const resolvedAntiPatterns = normalizedAntiPatterns ?? normalizedNonGoals ?? resolvedNonGoals
    const validationError = validateBriefContent({
      userJob: input.userJob.trim(),
      whyItMattersNow: resolvedWhy,
      successMetric: input.successMetric.trim(),
      nonGoals: resolvedNonGoals,
      ...(input.audience?.trim() ? { audience: input.audience.trim() } : {}),
      ...(input.usageContext?.trim() ? { usageContext: input.usageContext.trim() } : {}),
      antiPatterns: resolvedAntiPatterns,
      ...(input.rolloutPlan?.trim() ? { rolloutPlan: input.rolloutPlan.trim() } : {}),
      ...(input.brandInteractionNotes?.trim() ? { brandInteractionNotes: input.brandInteractionNotes.trim() } : {}),
    })
    if (validationError) return { success: false, error: validationError }
    const brief: ProductBrief = {
      userJob: input.userJob,
      whyItMattersNow: resolvedWhy,
      successMetric: input.successMetric,
      nonGoals: resolvedNonGoals,
      ...(input.audience?.trim() ? { audience: input.audience.trim() } : {}),
      ...(input.usageContext?.trim() ? { usageContext: input.usageContext.trim() } : {}),
      antiPatterns: resolvedAntiPatterns,
      ...(input.rolloutPlan !== undefined ? { rolloutPlan: input.rolloutPlan } : {}),
      ...(input.brandInteractionNotes?.trim() ? { brandInteractionNotes: input.brandInteractionNotes.trim() } : {}),
      authoredBy: input.authoredBy,
      authoredAt: now,
      // Re-authoring after approval drops the approval (it was approved
      // against a different brief body).
      ...(existing?.approvedAt &&
        existing?.userJob === input.userJob &&
        existing?.successMetric === input.successMetric
        ? { approvedBy: existing.approvedBy, approvedAt: existing.approvedAt }
        : {}),
    }
    const grounding = validateProductBriefGrounding(task, brief)
    if (!grounding.ok) {
      return { success: false, error: grounding.errors.join(' ') }
    }
    task.productBrief = brief
    task.updatedAt = now
    queue.lastUpdated = now

    if (readProjectStateAuthorityAtBoundary(input.tasksPath).authority === 'database') {
      const projectRoot = path.isAbsolute(task.projectPath) ? task.projectPath : path.dirname(input.tasksPath)
      const pointMutation = writePromotedTaskDetailMutation(input.tasksPath, task.id, {
        projectId: path.basename(projectRoot),
        projectRoot,
        mutate: (current) => ({
          ...current,
          productBrief: brief,
          updatedAt: now,
        }),
      })
      if (!pointMutation) {
        throw new Error(`Could not persist promoted product brief for task ${task.id}`)
      }
    } else {
      writeProjectTaskQueueWithSummary(input.tasksPath, queue, {
        ...(queueRead.expectedQueueRevision !== null
          ? { expectedQueueRevision: queueRead.expectedQueueRevision }
          : {}),
      })
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const updateProductBriefTool = defineTool({
  name: 'update-product-brief',
  description:
    "Author or revise a task's product brief — the who / why now / success signal / non-goals layer that sits alongside the technical spec. Call this during exploring once you understand who the task serves, why the work matters now, how we'll know it worked, and what boundary it should keep. Re-authoring an approved brief drops the approval unless the core intent fields are unchanged.",
  inputSchema: updateProductBriefInputSchema,
  jsonSchema: { type: 'object' },
  isReadOnly: () => false,
  execute: async (input, ctx) => {
    const target = resolveBriefTarget(input, ctx.metadata)
    if ('error' in target) {
      return {
        output: `Error updating product brief: ${target.error}`,
        is_error: true,
        metadata: { success: false, error: target.error },
      }
    }
    let taskTitle = target.taskId
    try {
      const queue = TaskQueue.parse(readProjectTaskQueueSync(target.tasksPath))
      const task = queue.tasks.find((t) => t.id === target.taskId)
      if (task?.title?.trim()) taskTitle = task.title
    } catch {
      // keep fallback taskTitle
    }
    const content = resolveBriefContent(input, taskTitle)
    if ('error' in content) {
      return {
        output: `Error updating product brief: ${content.error}`,
        is_error: true,
        metadata: { success: false, error: content.error },
      }
    }
    const result = await updateProductBrief({
      ...input,
      tasksPath: target.tasksPath,
      taskId: target.taskId,
      authoredBy: target.authoredBy,
      userJob: content.userJob,
      whyItMattersNow: content.whyItMattersNow,
      successMetric: content.successMetric,
      nonGoals: content.nonGoals,
      ...(content.audience !== undefined ? { audience: content.audience } : {}),
      ...(content.usageContext !== undefined ? { usageContext: content.usageContext } : {}),
      antiPatterns: content.antiPatterns,
      ...(content.rolloutPlan !== undefined ? { rolloutPlan: content.rolloutPlan } : {}),
      ...(content.brandInteractionNotes !== undefined ? { brandInteractionNotes: content.brandInteractionNotes } : {}),
    })
    return {
      output: result.success
        ? `Updated product brief for ${target.taskId}`
        : `Error updating product brief on ${target.taskId}: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})
