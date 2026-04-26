/**
 * post-user-question — asynchronous, structured agent → user question.
 *
 * Distinct from the synchronous `ask-user-question` tool (interaction.ts)
 * which only works when a live interactive prompt callback is wired in. In
 * the orchestrator's typical agent runs that callback is absent, so any
 * agent that needs human judgment posts a *structured* question record onto
 * `task.openQuestions` and yields. The Thread surface renders the question
 * with a deterministic affordance (confirm / yesno / choice / text) and the
 * user's answer flows back via POST /api/project/task/:id/answer-question.
 *
 * Producers (spec agent, intake, coordinator) MUST classify each question
 * into ONE of the four kinds — no free prose. Multiple choice is the
 * preferred kind whenever there's a small finite answer set, because the
 * UI degrades gracefully (Other… textbox) and the answer is structured.
 */

import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import { TaskQueue } from '@guildhall/core'
import { randomUUID } from 'node:crypto'
import { atomicWriteText } from '@guildhall/sessions'

const TASKS_PATH_SCHEMA = z.string().describe('Absolute path to the TASKS.json file')

const postUserQuestionInputSchema = z.object({
  tasksPath: TASKS_PATH_SCHEMA,
  taskId: z.string(),
  askedBy: z.string().describe('Agent id posting the question (e.g. "spec-agent")'),
  /**
   * One of:
   *   confirm — restate user intent ("Here's what I think you want…")
   *   yesno   — binary
   *   choice  — 2..6 options; UI provides "Other…" textbox automatically
   *   text    — open-ended (use sparingly; multiple choice is almost always better)
   */
  kind: z.enum(['confirm', 'yesno', 'choice', 'text']),
  /** For confirm: the restatement. For yesno/choice/text: the prompt. */
  body: z.string().describe('Restatement (confirm) or prompt (yesno/choice/text)'),
  /** Required when kind=choice. 2..6 distinct options in the user's voice. */
  choices: z
    .array(z.string())
    .min(2)
    .max(6)
    .optional()
    .describe('Required when kind=choice. 2-6 options.'),
  selectionMode: z
    .enum(['single', 'multiple'])
    .optional()
    .describe('For kind=choice: single means pick one; multiple means pick all that apply.'),
})

export type PostUserQuestionInput = z.input<typeof postUserQuestionInputSchema>
export interface PostUserQuestionResult {
  success: boolean
  questionId?: string
  error?: string
}

export async function postUserQuestion(
  input: PostUserQuestionInput,
): Promise<PostUserQuestionResult> {
  if (input.kind === 'choice' && (!input.choices || input.choices.length < 2)) {
    return { success: false, error: 'kind=choice requires 2..6 choices' }
  }
  try {
    const raw = await fs.readFile(input.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))
    const task = queue.tasks.find(t => t.id === input.taskId)
    if (!task) return { success: false, error: `Task ${input.taskId} not found` }

    const now = new Date().toISOString()
    const id = `q-${now.replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`

    const question =
      input.kind === 'confirm'
        ? { kind: 'confirm' as const, id, askedBy: input.askedBy, askedAt: now, restatement: input.body }
        : input.kind === 'yesno'
          ? { kind: 'yesno' as const, id, askedBy: input.askedBy, askedAt: now, prompt: input.body }
          : input.kind === 'choice'
            ? {
                kind: 'choice' as const,
                id,
                askedBy: input.askedBy,
                askedAt: now,
                prompt: input.body,
                choices: input.choices!,
                ...(input.selectionMode ? { selectionMode: input.selectionMode } : {}),
              }
            : { kind: 'text' as const, id, askedBy: input.askedBy, askedAt: now, prompt: input.body }

    const existing = task.openQuestions ?? []
    task.openQuestions = [...existing, question]
    task.updatedAt = now
    queue.lastUpdated = now

    atomicWriteText(input.tasksPath, JSON.stringify(queue, null, 2) + '\n')
    return { success: true, questionId: id }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const postUserQuestionTool = defineTool({
  name: 'post-user-question',
  description:
    "Post an asynchronous structured question to the user on this task. Use this whenever you need human judgment to proceed — the question lands in the user's Thread feed with a kind-specific affordance, and you should yield (end your turn) so the orchestrator can resume you when an answer arrives. PREFER `kind: 'choice'` whenever the answer space is small and discrete (it always degrades to Other… free-text). For choice questions, set `selectionMode: 'multiple'` when more than one answer may apply; otherwise set `selectionMode: 'single'` or omit it. Use `confirm` to restate intent before committing. Use `yesno` only for genuinely binary calls. Use `text` sparingly — usually a multiple choice with the question phrased as the prompt is better. NEVER bury questions in productBrief.userJob — that field is for what you think the user wants, not for asking them.",
  inputSchema: postUserQuestionInputSchema,
  jsonSchema: { type: 'object' },
  isReadOnly: () => false,
  execute: async input => {
    const result = await postUserQuestion(input)
    return {
      output: result.success
        ? `Posted ${input.kind} question (${result.questionId}) to ${input.taskId}. Yield now and wait for the user's answer.`
        : `Error posting question to ${input.taskId}: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})
