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
  if (Array.isArray(raw)) {
    const values = raw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
    return values.length > 0 ? values : undefined
  }
  if (typeof raw === 'string') {
    const values = raw
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
  const nonGoals = antiPatterns.length > 0 ? antiPatterns : fallbackNonGoals(taskTitle)

  return {
    userJob: fallbackUserJob,
    whyItMattersNow: `This matters now because Guildhall needs a concrete product outcome for "${taskTitle}" before implementation or approval can be trusted.`,
    successMetric: `The remaining work for "${taskTitle}" is described clearly enough to approve or narrow with one focused question.`,
    nonGoals,
    antiPatterns: nonGoals,
  }
}

function validateBriefContent(content: ResolvedBriefContent): string | null {
  const normalizedUserJob = content.userJob.toLowerCase()
  const normalizedWhy = content.whyItMattersNow.toLowerCase()
  const normalizedSuccessMetric = content.successMetric.toLowerCase()
  const agentProcessPatterns = [
    /\blet me\b/,
    /\bi (need|will|should|can) (explore|inspect|read|look at|check|investigate)\b/,
    /\bi have (enough context|a clear picture)\b/,
    /\bnow i have\b/,
    /\bwrite the (product )?brief\b/,
    /\bwrite the spec\b/,
    /\bgood\b.*\buser confirmed\b/,
    /\bi still need\b.*\b(decision|decisions|answer|answers)\b/,
    /\blet me post\b/,
    /\bbefore i can write the spec\b/,
    /\bproject state and prior task history\b/,
    /\bask the right questions\b/,
    /\blet me do that now\b/,
    /\bunderstand the current .+ before drafting\b/,
    /\bbefore (drafting|writing) the spec\b/,
    /\bafter i (explore|inspect|read|look at|check|investigate)\b/,
  ]
  const guildhallStatePatterns = [
    /\bthread shows\b/,
    /\bdrafted brief\b/,
    /\bbrief card\b/,
    /\bactionable next step\b/,
    /\bproduct brief is visible\b/,
  ]
  if (agentProcessPatterns.some((pattern) => pattern.test(normalizedUserJob))) {
    return 'Product brief must describe the user/product outcome, not the agent research process. Ask a focused question or draft from existing evidence instead.'
  }
  if (agentProcessPatterns.some((pattern) => pattern.test(normalizedWhy))) {
    return 'Product brief whyItMattersNow must describe the product or project reason for the work, not the agent drafting process.'
  }
  if (guildhallStatePatterns.some((pattern) => pattern.test(normalizedSuccessMetric))) {
    return 'Product brief successMetric must describe the product outcome, not Guildhall UI state.'
  }
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
  metadata: Record<string, unknown>,
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

  const inferred = inferBriefContentFromAssistantText(
    String(metadata['last_assistant_text'] ?? ''),
    taskTitle,
  )
  if (!inferred) {
    return { error: 'Missing userJob/successMetric and could not infer a brief from metadata.last_assistant_text' }
  }
  const content = {
    ...inferred,
    ...(whyItMattersNow ? { whyItMattersNow } : {}),
    nonGoals: nonGoals?.length ? nonGoals : inferred.nonGoals,
    ...(audience ? { audience } : {}),
    ...(usageContext ? { usageContext } : {}),
    antiPatterns: antiPatterns?.length ? antiPatterns : inferred.antiPatterns,
    ...(rolloutPlan ? { rolloutPlan } : {}),
    ...(brandInteractionNotes ? { brandInteractionNotes } : {}),
  }
  const validationError = validateBriefContent(content)
  return validationError ? { error: validationError } : content
}

export async function updateProductBrief(
  input: UpdateProductBriefInput,
): Promise<UpdateProductBriefResult> {
  if (!input.tasksPath?.trim()) return { success: false, error: 'Missing tasksPath' }
  if (!input.taskId?.trim()) return { success: false, error: 'Missing taskId' }
  if (!input.authoredBy?.trim()) return { success: false, error: 'Missing authoredBy' }
  try {
    const raw = await fs.readFile(input.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))
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
