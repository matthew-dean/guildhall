import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import { TaskQueue, type ProductBrief } from '@guildhall/core'
import { atomicWriteText } from '@guildhall/sessions'

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
  successMetric: z.string().optional().describe('How we\'ll know this worked — observable outcome'),
  antiPatterns: z
    .array(z.string())
    .default([])
    .describe('Things this task must NOT do — product / brand / ux-level prohibitions'),
  rolloutPlan: z
    .string()
    .optional()
    .describe('Staging, flagging, migration notes, if any'),
  authoredBy: z
    .string()
    .optional()
    .describe('Agent id or "human" — who is authoring the brief right now'),
  productBrief: z
    .union([
      z.string(),
      z.object({
        userJob: z.string().optional(),
        successMetric: z.string().optional(),
        antiPatterns: z.array(z.string()).optional(),
        rolloutPlan: z.string().optional(),
      }).passthrough(),
    ])
    .optional()
    .describe('Optional nested/serialized brief payload recovered from near-miss model calls.'),
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
  successMetric: string
  antiPatterns: string[]
  rolloutPlan?: string
}

interface BriefLikePayload {
  userJob?: string
  successMetric?: string
  antiPatterns?: string[]
  rolloutPlan?: string
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

function firstMeaningfulParagraph(text: string): string | null {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^(#+|\d+[.)]\s|\-\s)/.test(part))
  return paragraphs[0] ?? null
}

function inferBriefContentFromAssistantText(
  text: string,
  taskTitle: string,
): ResolvedBriefContent | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const guessMatch = trimmed.match(/my best guess(?: for [^:\n]+)?\s*\n+([\s\S]+)/i)
  const afterGuess = guessMatch?.[1]?.trim() ?? trimmed
  const lines = afterGuess
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const userJobLine = lines.find((line) =>
    /^you want to\b/i.test(line) ||
    /^this task is about\b/i.test(line) ||
    /^this task\b/i.test(line) ||
    /^the goal is to\b/i.test(line),
  ) ?? firstMeaningfulParagraph(afterGuess)
  const normalizedUserJob = userJobLine?.replace(/^[-*]\s*/, '').trim() ?? ''
  const looksLikeEvidencePreamble =
    /^based on\b/i.test(normalizedUserJob) ||
    /^the grep clearly shows\b/i.test(normalizedUserJob) ||
    /^i have sufficient evidence\b/i.test(normalizedUserJob) ||
    /^the integration appears complete\b/i.test(normalizedUserJob) ||
    /^let me write\b/i.test(normalizedUserJob)
  const fallbackUserJob =
    looksLikeEvidencePreamble || !normalizedUserJob
      ? `I want to verify whether ${taskTitle.replace(/\.$/, '')} is already done and, if not, capture only the remaining delta.`
      : normalizedUserJob
  if (!fallbackUserJob) return null

  const antiPatterns = lines
    .filter((line) => /^don't\b/i.test(line) || /^do not\b/i.test(line))
    .map((line) => line.replace(/^[*-]\s*/, '').trim())

  return {
    userJob: fallbackUserJob,
    successMetric: `Thread shows a drafted brief and actionable next step for "${taskTitle}".`,
    antiPatterns,
  }
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
  const antiPatterns = Array.isArray(obj.antiPatterns)
    ? obj.antiPatterns.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : undefined
  const userJob = typeof obj.userJob === 'string' ? obj.userJob.trim() : undefined
  const successMetric = typeof obj.successMetric === 'string' ? obj.successMetric.trim() : undefined
  const rolloutPlan = typeof obj.rolloutPlan === 'string' ? obj.rolloutPlan.trim() : undefined
  if (!userJob && !successMetric && !antiPatterns?.length && !rolloutPlan) return null
  return {
    ...(userJob ? { userJob } : {}),
    ...(successMetric ? { successMetric } : {}),
    ...(antiPatterns ? { antiPatterns } : {}),
    ...(rolloutPlan ? { rolloutPlan } : {}),
  }
}

function resolveBriefContent(
  input: Pick<UpdateProductBriefInput, 'userJob' | 'successMetric' | 'antiPatterns' | 'rolloutPlan' | 'productBrief'>,
  metadata: Record<string, unknown>,
  taskTitle: string,
): ResolvedBriefContent | { error: string } {
  const nested = parseBriefLikePayload(input.productBrief)
  const userJob = input.userJob?.trim() || nested?.userJob?.trim()
  const successMetric = input.successMetric?.trim() || nested?.successMetric?.trim()
  const antiPatterns = input.antiPatterns?.length
    ? input.antiPatterns
    : nested?.antiPatterns ?? []
  const rolloutPlan = input.rolloutPlan?.trim() || nested?.rolloutPlan?.trim()

  if (userJob && successMetric) {
    return {
      userJob,
      successMetric,
      antiPatterns,
      ...(rolloutPlan ? { rolloutPlan } : {}),
    }
  }

  const inferred = inferBriefContentFromAssistantText(
    String(metadata['last_assistant_text'] ?? ''),
    taskTitle,
  )
  if (!inferred) {
    return { error: 'Missing userJob/successMetric and could not infer a brief from metadata.last_assistant_text' }
  }
  return {
    ...inferred,
    antiPatterns: antiPatterns.length ? antiPatterns : inferred.antiPatterns,
    ...(rolloutPlan ? { rolloutPlan } : {}),
  }
}

export async function updateProductBrief(
  input: UpdateProductBriefInput,
): Promise<UpdateProductBriefResult> {
  if (!input.tasksPath?.trim()) return { success: false, error: 'Missing tasksPath' }
  if (!input.taskId?.trim()) return { success: false, error: 'Missing taskId' }
  if (!input.userJob?.trim()) return { success: false, error: 'Missing userJob' }
  if (!input.successMetric?.trim()) return { success: false, error: 'Missing successMetric' }
  if (!input.authoredBy?.trim()) return { success: false, error: 'Missing authoredBy' }
  try {
    const raw = await fs.readFile(input.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))
    const task = queue.tasks.find((t) => t.id === input.taskId)
    if (!task) return { success: false, error: `Task ${input.taskId} not found` }

    const now = new Date().toISOString()
    const existing = task.productBrief
    const brief: ProductBrief = {
      userJob: input.userJob,
      successMetric: input.successMetric,
      antiPatterns: input.antiPatterns ?? [],
      ...(input.rolloutPlan !== undefined ? { rolloutPlan: input.rolloutPlan } : {}),
      authoredBy: input.authoredBy,
      authoredAt: now,
      // Re-authoring after approval drops the approval (it was approved
      // against a different brief body).
      ...(existing?.approvedAt && existing?.userJob === input.userJob && existing?.successMetric === input.successMetric
        ? { approvedBy: existing.approvedBy, approvedAt: existing.approvedAt }
        : {}),
    }
    task.productBrief = brief
    task.updatedAt = now
    queue.lastUpdated = now

    atomicWriteText(input.tasksPath, JSON.stringify(queue, null, 2) + '\n')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const updateProductBriefTool = defineTool({
  name: 'update-product-brief',
  description:
    "Author or revise a task's product brief — the who / why / success-metric / anti-patterns layer that sits alongside the technical spec. Call this during exploring once you understand who the task serves and how we'll know it worked. Re-authoring an approved brief drops the approval unless userJob and successMetric are unchanged.",
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
      const raw = await fs.readFile(target.tasksPath, 'utf-8')
      const queue = TaskQueue.parse(JSON.parse(raw))
      const task = queue.tasks.find((t) => t.id === target.taskId)
      if (task?.title?.trim()) taskTitle = task.title
    } catch {
      // keep fallback taskTitle
    }
    const content = resolveBriefContent(input, ctx.metadata, taskTitle)
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
      successMetric: content.successMetric,
      antiPatterns: content.antiPatterns,
      ...(content.rolloutPlan !== undefined ? { rolloutPlan: content.rolloutPlan } : {}),
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
