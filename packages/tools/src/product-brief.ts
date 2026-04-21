import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import { TaskQueue, type ProductBrief } from '@guildhall/core'

// ---------------------------------------------------------------------------
// update-product-brief: the Spec Agent's authoring surface for the product
// brief. This is the *why* layer of a task — who it serves, how we'll know
// it worked, and what it must NOT do. Brief approval is an independent
// human gate from spec approval; see `approve-brief` on the HTTP side.
// ---------------------------------------------------------------------------

const TASKS_PATH_SCHEMA = z.string().describe('Absolute path to the TASKS.json file')

const updateProductBriefInputSchema = z.object({
  tasksPath: TASKS_PATH_SCHEMA,
  taskId: z.string(),
  userJob: z.string().describe('Who the task serves and what job it does for them'),
  successMetric: z.string().describe('How we\'ll know this worked — observable outcome'),
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
    .describe('Agent id or "human" — who is authoring the brief right now'),
})

export type UpdateProductBriefInput = z.input<typeof updateProductBriefInputSchema>
export interface UpdateProductBriefResult {
  success: boolean
  error?: string
}

export async function updateProductBrief(
  input: UpdateProductBriefInput,
): Promise<UpdateProductBriefResult> {
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

    await fs.writeFile(input.tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
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
  execute: async (input) => {
    const result = await updateProductBrief(input)
    return {
      output: result.success
        ? `Updated product brief for ${input.taskId}`
        : `Error updating product brief on ${input.taskId}: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})
