/**
 * Miscellaneous small tools: sleep, tool-search, brief.
 *
 * Ported from:
 *   openharness/src/openharness/tools/sleep_tool.py
 *   openharness/src/openharness/tools/tool_search_tool.py
 *   openharness/src/openharness/tools/brief_tool.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - `asyncio.sleep(s)` → `new Promise(r => setTimeout(r, s*1000))`. Node
 *     setTimeout accepts up to ~24 days so no clamp needed beyond the
 *     schema's 0–30s bound.
 *   - `context.metadata.get("tool_registry")` → TS equivalent; same shape,
 *     already threaded in run-query.ts:420.
 *   - `text[:n].rstrip() + "..."` → TS `slice(0, n).trimEnd() + '...'`.
 */

import { defineTool, type ToolRegistry } from '@guildhall/engine'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// sleep
// ---------------------------------------------------------------------------

const sleepInputSchema = z.object({
  seconds: z.number().min(0).max(30).default(1),
})
export type SleepInput = z.input<typeof sleepInputSchema>

export const sleepTool = defineTool({
  name: 'sleep',
  description: 'Pause execution briefly (0–30 seconds).',
  inputSchema: sleepInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      seconds: { type: 'number', minimum: 0, maximum: 30, default: 1 },
    },
    additionalProperties: false,
  },
  isReadOnly: () => true,
  execute: async (input) => {
    const seconds = input.seconds ?? 1
    await new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000))
    return { output: `Slept for ${seconds} seconds`, is_error: false }
  },
})

// ---------------------------------------------------------------------------
// tool-search
// ---------------------------------------------------------------------------

const toolSearchInputSchema = z.object({
  query: z.string().describe('Substring to search in tool names and descriptions'),
})
export type ToolSearchInput = z.input<typeof toolSearchInputSchema>

export const toolSearchTool = defineTool({
  name: 'tool-search',
  description: 'Search the available tool list by name or description substring.',
  inputSchema: toolSearchInputSchema,
  jsonSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  isReadOnly: () => true,
  execute: async (input, ctx) => {
    const registry = ctx.metadata['tool_registry'] as ToolRegistry | undefined
    if (!registry || typeof registry.list !== 'function') {
      return { output: 'Tool registry context not available', is_error: true }
    }
    const query = input.query.toLowerCase()
    const matches = registry
      .list()
      .filter(
        (tool) =>
          tool.name.toLowerCase().includes(query) ||
          tool.description.toLowerCase().includes(query),
      )
    if (matches.length === 0) {
      return { output: '(no matches)', is_error: false }
    }
    return {
      output: matches.map((t) => `${t.name}: ${t.description}`).join('\n'),
      is_error: false,
    }
  },
})

// ---------------------------------------------------------------------------
// brief
// ---------------------------------------------------------------------------

const briefInputSchema = z.object({
  text: z.string().describe('Text to shorten'),
  maxChars: z.number().int().min(20).max(2000).default(200),
})
export type BriefInput = z.input<typeof briefInputSchema>

export function runBrief(text: string, maxChars: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  return trimmed.slice(0, maxChars).trimEnd() + '...'
}

export const briefTool = defineTool({
  name: 'brief',
  description: 'Shorten a piece of text for compact display.',
  inputSchema: briefInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      maxChars: { type: 'integer', minimum: 20, maximum: 2000, default: 200 },
    },
    required: ['text'],
  },
  isReadOnly: () => true,
  execute: async (input) => {
    const maxChars = input.maxChars ?? 200
    return { output: runBrief(input.text, maxChars), is_error: false }
  },
})
