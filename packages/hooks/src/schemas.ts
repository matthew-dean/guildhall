/**
 * Ported from openharness/src/openharness/hooks/schemas.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Pydantic models → Zod schemas with discriminated union on `type`
 *   - `int = Field(default=30, ge=1, le=600)` → `z.number().int().min(1).max(600).default(30)`
 *   - Upstream `matcher: str | None = None` → optional string; the executor
 *     treats absent + empty the same when matching
 */

import { z } from 'zod'

export const commandHookDefinitionSchema = z.object({
  type: z.literal('command'),
  command: z.string(),
  timeout_seconds: z.number().int().min(1).max(600).default(30),
  matcher: z.string().optional(),
  block_on_failure: z.boolean().default(false),
})

export const promptHookDefinitionSchema = z.object({
  type: z.literal('prompt'),
  prompt: z.string(),
  model: z.string().optional(),
  timeout_seconds: z.number().int().min(1).max(600).default(30),
  matcher: z.string().optional(),
  block_on_failure: z.boolean().default(true),
})

export const httpHookDefinitionSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
  timeout_seconds: z.number().int().min(1).max(600).default(30),
  matcher: z.string().optional(),
  block_on_failure: z.boolean().default(false),
})

export const agentHookDefinitionSchema = z.object({
  type: z.literal('agent'),
  prompt: z.string(),
  model: z.string().optional(),
  timeout_seconds: z.number().int().min(1).max(1200).default(60),
  matcher: z.string().optional(),
  block_on_failure: z.boolean().default(true),
})

export const hookDefinitionSchema = z.discriminatedUnion('type', [
  commandHookDefinitionSchema,
  promptHookDefinitionSchema,
  httpHookDefinitionSchema,
  agentHookDefinitionSchema,
])

export type CommandHookDefinition = z.infer<typeof commandHookDefinitionSchema>
export type PromptHookDefinition = z.infer<typeof promptHookDefinitionSchema>
export type HttpHookDefinition = z.infer<typeof httpHookDefinitionSchema>
export type AgentHookDefinition = z.infer<typeof agentHookDefinitionSchema>
export type HookDefinition = z.infer<typeof hookDefinitionSchema>
