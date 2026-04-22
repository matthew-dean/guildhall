/**
 * Ported from openharness/src/openharness/tools/base.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Pydantic `input_model: type[BaseModel]` → Zod `inputSchema: ZodType`
 *   - `model_json_schema()` output → generated via `zod-to-json-schema`-style
 *     helper we inline here (keep the engine package zero-dep beyond Zod;
 *     upstream produced draft-07 JSON schema, Anthropic accepts any)
 *   - ABC → interface + a `defineTool` helper for ergonomics
 */

import type { z } from 'zod'

import type { HookExecutor } from './hooks.js'

export interface ToolExecutionContext {
  cwd: string
  metadata: Record<string, unknown>
  hookExecutor?: HookExecutor
}

export interface ToolResult {
  output: string
  is_error: boolean
  metadata?: Record<string, unknown>
}

export interface Tool<TInput = unknown> {
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
  jsonSchema: Record<string, unknown>
  isReadOnly: (input: TInput) => boolean
  execute: (input: TInput, context: ToolExecutionContext) => Promise<ToolResult>
}

export interface ToolDefinition<TInput> {
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
  jsonSchema?: Record<string, unknown>
  isReadOnly?: (input: TInput) => boolean
  execute: (input: TInput, context: ToolExecutionContext) => Promise<ToolResult>
}

export function defineTool<TInput>(def: ToolDefinition<TInput>): Tool<TInput> {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    jsonSchema: def.jsonSchema ?? { type: 'object' },
    isReadOnly: def.isReadOnly ?? (() => false),
    execute: def.execute,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = Tool<any>

export class ToolRegistry {
  private readonly tools = new Map<string, AnyTool>()

  register(tool: AnyTool): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): AnyTool | undefined {
    return this.tools.get(name)
  }

  list(): AnyTool[] {
    return [...this.tools.values()]
  }

  toApiSchema(): Array<Record<string, unknown>> {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.jsonSchema,
    }))
  }
}
