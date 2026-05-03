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
  tasksPath: TASKS_PATH_SCHEMA.optional(),
  taskId: z.string().optional(),
  askedBy: z.string().optional().describe('Agent id posting the question (e.g. "spec-agent")'),
  /**
   * One of:
   *   confirm — restate user intent ("Here's what I think you want…")
   *   yesno   — binary
   *   choice  — 2..6 options; UI provides "Other…" textbox automatically
   *   text    — open-ended (use sparingly; multiple choice is almost always better)
   */
  kind: z.enum(['confirm', 'yesno', 'choice', 'text']).optional(),
  /** For confirm: the restatement. For yesno/choice/text: the prompt. */
  body: z.string().optional().describe('Restatement (confirm) or prompt (yesno/choice/text)'),
  prompt: z.string().optional().describe('Alias for body when posting yesno/choice/text questions.'),
  restatement: z.string().optional().describe('Alias for body when posting confirm questions.'),
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

interface InferredQuestion {
  kind: 'confirm' | 'yesno' | 'choice' | 'text'
  body: string
  choices?: string[]
  selectionMode?: 'single' | 'multiple'
}

const MAX_INFERRED_QUESTIONS = 3

function cleanInferredOptionLabel(raw: string): string {
  const trimmed = raw.trim()
  const boldHeading = trimmed.match(/^\*\*(.+?)\*\*(?:\s*[—-]\s*.*)?$/)
  if (boldHeading) return boldHeading[1]!.trim()
  return trimmed
}

function parseStructuredOptionLine(line: string): string | null {
  const trimmed = line.trim()
  if (/^-\s+/.test(trimmed)) {
    return trimmed.replace(/^-\s+/, '').replace(/^[A-Z][.)]\s*/, '').trim().replace(/\?$/, '')
  }
  if (/^[A-Z][.)]\s+/.test(trimmed)) {
    return trimmed.replace(/^[A-Z][.)]\s+/, '').trim().replace(/\?$/, '')
  }
  return null
}

function resolveQuestionDefaults(
  input: Pick<PostUserQuestionInput, 'tasksPath' | 'taskId' | 'askedBy'>,
  metadata: Record<string, unknown>,
): { tasksPath: string; taskId: string; askedBy: string } | { error: string } {
  const tasksPath = String(input.tasksPath ?? metadata['tasks_path'] ?? '').trim()
  const taskId = String(input.taskId ?? metadata['current_task_id'] ?? '').trim()
  const askedBy = String(input.askedBy ?? metadata['current_agent_id'] ?? 'agent').trim()
  if (!tasksPath) return { error: 'Missing tasksPath (or metadata.tasks_path)' }
  if (!taskId) return { error: 'Missing taskId (or metadata.current_task_id)' }
  if (!askedBy) return { error: 'Missing askedBy (or metadata.current_agent_id)' }
  return { tasksPath, taskId, askedBy }
}

function inferQuestionsFromAssistantText(text: string): InferredQuestion[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const simplePickOne = trimmed.match(/^pick one:\s*(.+)$/im)
  if (simplePickOne) {
    const body = simplePickOne[1]?.trim() ?? ''
    const split = body.match(/^(.+?),\s*or\s+(.+?)\??$/i)
    if (split) {
      return [{
        kind: 'choice',
        body: 'Pick one',
        choices: [split[1]!.trim(), split[2]!.trim().replace(/\?$/, '')],
        selectionMode: 'single',
      }]
    }
  }

  const lines = trimmed.split('\n')
  const inlinePromptQuestions: InferredQuestion[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const promptLine = lines[i]?.trim() ?? ''
    if (!promptLine) continue
    const normalizedPromptLine = promptLine.replace(/^#{1,6}\s*/, '').trim()
    const headingPrompt = normalizedPromptLine.match(/^\d+[.)]\s+(?:\*\*(.+?)\*\*|(.+))$/)
    const promptBody = (headingPrompt?.[1] ?? headingPrompt?.[2] ?? normalizedPromptLine).trim()
    const promptLike = /pick one\b|choose one\b|select one\b|\?$|:\s*$|success look like/i.test(promptBody)
    if (!promptLike) continue
    const summaryLike =
      /i['’]ll draft the full spec with\b|i will draft the full spec with\b|once you (?:pick|answer).+i['’]ll draft\b/i
        .test(promptBody)
    if (summaryLike) continue

    const choices: string[] = []
    let mode: 'numbered' | 'bullets' | null = null
    let invalidInlineGroup = false
    for (let j = i + 1; j < lines.length; j += 1) {
      const optionLine = lines[j]?.trim() ?? ''
      if (!optionLine) {
        if (choices.length > 0) break
        continue
      }
      const numberedOption = optionLine.match(/^\d+[.)]\s+(?:\*\*(.+?)\*\*|(.+))$/)
      if (numberedOption) {
        if (mode === 'bullets') break
        mode = 'numbered'
        choices.push(cleanInferredOptionLabel((numberedOption[1] ?? numberedOption[2] ?? '').trim()))
        continue
      }
      const structuredOption = parseStructuredOptionLine(optionLine)
      if (structuredOption) {
        if (mode === 'numbered') {
          invalidInlineGroup = true
          break
        }
        mode = 'bullets'
        choices.push(structuredOption)
        continue
      }
      if (choices.length > 0) break
    }

    if (!invalidInlineGroup && choices.length >= 2 && choices.length <= 6) {
      inlinePromptQuestions.push({
        kind: 'choice',
        body: promptBody.replace(/\s+/g, ' ').trim(),
        choices,
        selectionMode: /pick all|all that apply|select all|choose all/i.test(promptBody)
          ? 'multiple'
          : 'single',
      })
    }
  }
  if (inlinePromptQuestions.length > 0) return inlinePromptQuestions.slice(0, MAX_INFERRED_QUESTIONS)

  const sections: Array<{ heading: string; lines: string[] }> = []
  let current: { heading: string; lines: string[] } | null = null
  for (const rawLine of lines) {
    const line = rawLine.trim()
    const headingMatch = line.match(/^\d+[.)]\s+(?:\*\*(.+?)\*\*|(.+))$/)
    if (headingMatch) {
      if (current) sections.push(current)
      current = { heading: (headingMatch[1] ?? headingMatch[2] ?? '').trim(), lines: [] }
      continue
    }
    if (current) current.lines.push(rawLine)
  }
  if (current) sections.push(current)

  const sectionQuestions = sections
    .map<InferredQuestion | null>((section) => {
      const choices = section.lines
        .map((line) => parseStructuredOptionLine(line))
        .filter(Boolean)
        .map((line) => line as string)
      if (choices.length < 2 || choices.length > 6) return null
      const combined = [section.heading, ...section.lines.map((line) => line.trim())].join('\n')
      return {
        kind: 'choice',
        body: section.heading,
        choices,
        selectionMode: /pick all|all that apply|select all|choose all/i.test(combined)
          ? 'multiple'
          : 'single',
      }
    })
    .filter((question): question is InferredQuestion => question !== null)
  if (sectionQuestions.length > 0) return sectionQuestions.slice(0, MAX_INFERRED_QUESTIONS)

  if (trimmed.includes('?')) return [{ kind: 'text', body: trimmed }]
  return []
}

function resolveQuestionPayload(
  input: Pick<PostUserQuestionInput, 'kind' | 'body' | 'prompt' | 'restatement' | 'choices' | 'selectionMode'>,
  metadata: Record<string, unknown>,
): InferredQuestion | { error: string } {
  const resolvedBody = input.body
    ?? (input.kind === 'confirm' ? input.restatement : input.prompt)

  if (input.kind && resolvedBody) {
    return {
      kind: input.kind,
      body: resolvedBody,
      ...(input.choices ? { choices: input.choices } : {}),
      ...(input.selectionMode ? { selectionMode: input.selectionMode } : {}),
    }
  }

  const bucketKey = 'inferred_post_user_questions'
  const sourceKey = 'inferred_post_user_questions_source'
  const assistantText = String(metadata['last_assistant_text'] ?? '').trim()
  const existing = metadata[bucketKey]
  const existingSource = String(metadata[sourceKey] ?? '')
  let queue = Array.isArray(existing) ? [...existing] as InferredQuestion[] : []
  if (!Array.isArray(existing) || existingSource !== assistantText) {
    queue = inferQuestionsFromAssistantText(assistantText)
    metadata[sourceKey] = assistantText
  }
  const next = queue.shift()
  metadata[bucketKey] = queue
  if (!next) {
    return { error: 'Missing kind/body and could not infer a question from metadata.last_assistant_text' }
  }
  return next
}

export async function postUserQuestion(
  input: PostUserQuestionInput,
): Promise<PostUserQuestionResult> {
  if (!input.kind) return { success: false, error: 'Missing kind' }
  if (!input.body?.trim()) return { success: false, error: 'Missing body' }
  if (input.kind === 'choice' && (!input.choices || input.choices.length < 2)) {
    return { success: false, error: 'kind=choice requires 2..6 choices' }
  }
  if (!input.tasksPath?.trim()) return { success: false, error: 'Missing tasksPath' }
  if (!input.taskId?.trim()) return { success: false, error: 'Missing taskId' }
  if (!input.askedBy?.trim()) return { success: false, error: 'Missing askedBy' }
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
  jsonSchema: {
    type: 'object',
    properties: {
      tasksPath: { type: 'string', description: 'Absolute path to TASKS.json. Optional when injected via runtime metadata.' },
      taskId: { type: 'string', description: 'Current task id. Optional when injected via runtime metadata.' },
      askedBy: { type: 'string', description: 'Agent id posting the question. Optional when injected via runtime metadata.' },
      kind: { type: 'string', enum: ['confirm', 'yesno', 'choice', 'text'] },
      body: { type: 'string', description: 'Restatement for confirm, or prompt for yesno/choice/text.' },
      prompt: { type: 'string', description: 'Alias for body on yesno/choice/text questions.' },
      restatement: { type: 'string', description: 'Alias for body on confirm questions.' },
      choices: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 6,
        description: 'Required when kind=choice.',
      },
      selectionMode: {
        type: 'string',
        enum: ['single', 'multiple'],
        description: 'For choice questions: pick one or pick all that apply.',
      },
    },
  },
  isReadOnly: () => false,
  execute: async (input, ctx) => {
    const resolved = resolveQuestionDefaults(input, ctx.metadata)
    const payload = resolveQuestionPayload(input, ctx.metadata)
    if ('error' in resolved || 'error' in payload) {
      const error = 'error' in resolved ? resolved.error : payload.error
      return {
        output: `Error posting question: ${error}`,
        is_error: true,
        metadata: { success: false, error },
      }
    }
    const result = await postUserQuestion({
      ...input,
      tasksPath: resolved.tasksPath,
      taskId: resolved.taskId,
      askedBy: resolved.askedBy,
      kind: payload.kind,
      body: payload.body,
      ...(payload.choices ? { choices: payload.choices } : {}),
      ...(payload.selectionMode ? { selectionMode: payload.selectionMode } : {}),
    })
    return {
      output: result.success
        ? `Posted ${payload.kind} question (${result.questionId}) to ${resolved.taskId}. Yield now and wait for the user's answer.`
        : `Error posting question to ${resolved.taskId}: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})
