/**
 * Agent↔human / agent↔filesystem interaction tools.
 *
 * Ported from:
 *   openharness/src/openharness/tools/ask_user_question_tool.py
 *   openharness/src/openharness/tools/todo_write_tool.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - The `ask_user_prompt` callback is already threaded through Guildhall's
 *     QueryContext → ToolExecutionContext metadata dict
 *     (src/engine/run-query.ts:421), so the tool implementation just reads
 *     it back out — no new wiring needed.
 *   - Todo-write's path resolution uses Node's `path.isAbsolute` + `path.join`
 *     instead of Python `Path`; behavior is identical.
 *   - Atomic write is via `fs.writeFile` + temporary rename instead of a
 *     direct `path.write_text`; prevents a half-written TODO.md if the
 *     worker is killed mid-flush.
 */

import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'

// ---------------------------------------------------------------------------
// ask-user-question
// ---------------------------------------------------------------------------

export type AskUserPrompt = (question: string) => Promise<string>

const askUserQuestionInputSchema = z.object({
  question: z.string().describe('The exact question to ask the user.'),
})

export type AskUserQuestionInput = z.input<typeof askUserQuestionInputSchema>

export const askUserQuestionTool = defineTool({
  name: 'ask-user-question',
  description:
    'Ask the interactive user a follow-up question and return their answer. Only use when the session is running in a mode that accepts interactive input — in headless runs this reports unavailable.',
  inputSchema: askUserQuestionInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The exact question to ask the user.' },
    },
    required: ['question'],
  },
  isReadOnly: () => true,
  execute: async (input, ctx) => {
    const prompt = ctx.metadata['ask_user_prompt']
    if (typeof prompt !== 'function') {
      return {
        output: 'ask-user-question is unavailable in this session',
        is_error: true,
      }
    }
    const answer = String(await (prompt as AskUserPrompt)(input.question)).trim()
    return {
      output: answer.length === 0 ? '(no response)' : answer,
      is_error: false,
    }
  },
})

// ---------------------------------------------------------------------------
// todo-write
// ---------------------------------------------------------------------------

const todoWriteInputSchema = z.object({
  item: z.string().describe('TODO item text'),
  checked: z.boolean().optional().describe('Mark the item as done (default false).'),
  path: z
    .string()
    .optional()
    .describe('Target markdown file (default TODO.md, resolved relative to cwd).'),
})

export type TodoWriteInput = z.input<typeof todoWriteInputSchema>
export interface TodoWriteResult {
  action: 'noop' | 'added' | 'checked'
  path: string
}

export async function runTodoWrite(
  cwd: string,
  input: TodoWriteInput,
): Promise<TodoWriteResult> {
  const relPath = input.path ?? 'TODO.md'
  const absPath = path.isAbsolute(relPath) ? relPath : path.join(cwd, relPath)

  let existing: string
  try {
    existing = await fs.readFile(absPath, 'utf-8')
  } catch {
    existing = '# TODO\n'
  }

  const uncheckedLine = `- [ ] ${input.item}`
  const checkedLine = `- [x] ${input.item}`
  const targetLine = input.checked ? checkedLine : uncheckedLine

  if (input.checked && existing.includes(uncheckedLine)) {
    // In-place flip of an existing unchecked item.
    const next = existing.replace(uncheckedLine, checkedLine)
    await atomicWrite(absPath, next)
    return { action: 'checked', path: absPath }
  }
  if (existing.includes(targetLine)) {
    return { action: 'noop', path: absPath }
  }
  const next = `${existing.replace(/\s+$/, '')}\n${targetLine}\n`
  await atomicWrite(absPath, next)
  return { action: 'added', path: absPath }
}

async function atomicWrite(absPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  const tmp = `${absPath}.${process.pid}.tmp`
  await fs.writeFile(tmp, content, 'utf-8')
  await fs.rename(tmp, absPath)
}

export const todoWriteTool = defineTool({
  name: 'todo-write',
  description:
    'Add a new item to a markdown TODO checklist, or mark an existing item as done. Defaults to TODO.md at the working directory root. Keeps a single-line-per-item convention compatible with GitHub-style checkboxes.',
  inputSchema: todoWriteInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      item: { type: 'string', description: 'TODO item text (no leading dash/checkbox).' },
      checked: {
        type: 'boolean',
        description: 'Mark the item as done; when false adds/keeps as unchecked.',
      },
      path: {
        type: 'string',
        description: 'Markdown file path (default TODO.md, cwd-relative).',
      },
    },
    required: ['item'],
  },
  isReadOnly: () => false,
  execute: async (input, ctx) => {
    const result = await runTodoWrite(ctx.cwd, input)
    const message =
      result.action === 'noop'
        ? `No change needed in ${result.path}`
        : result.action === 'checked'
          ? `Checked off in ${result.path}`
          : `Appended to ${result.path}`
    return {
      output: message,
      is_error: false,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})
