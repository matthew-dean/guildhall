/**
 * Ported from openharness/src/openharness/engine/stream_events.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - `@dataclass(frozen=True)` union → Zod discriminated union on `type`
 *   - Each class gets an explicit `type` tag; upstream relied on Python's isinstance checks
 *   - `ConversationMessage` reference points at our ported messages.ts
 *   - `UsageSnapshot` reference points at our ported usage.ts
 */

import { z } from 'zod'

import { conversationMessageSchema } from './messages.js'
import { usageSnapshotSchema } from './usage.js'

export const assistantTextDeltaSchema = z.object({
  type: z.literal('assistant_text_delta'),
  text: z.string(),
})
export type AssistantTextDelta = z.infer<typeof assistantTextDeltaSchema>

export const assistantTurnCompleteSchema = z.object({
  type: z.literal('assistant_turn_complete'),
  message: conversationMessageSchema,
  usage: usageSnapshotSchema,
})
export type AssistantTurnComplete = z.infer<typeof assistantTurnCompleteSchema>

export const toolExecutionStartedSchema = z.object({
  type: z.literal('tool_execution_started'),
  tool_name: z.string(),
  tool_input: z.record(z.unknown()),
})
export type ToolExecutionStarted = z.infer<typeof toolExecutionStartedSchema>

export const toolExecutionCompletedSchema = z.object({
  type: z.literal('tool_execution_completed'),
  tool_name: z.string(),
  output: z.string(),
  is_error: z.boolean().default(false),
})
export type ToolExecutionCompleted = z.infer<typeof toolExecutionCompletedSchema>

export const errorEventSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  recoverable: z.boolean().default(true),
})
export type ErrorEvent = z.infer<typeof errorEventSchema>

export const statusEventSchema = z.object({
  type: z.literal('status'),
  message: z.string(),
})
export type StatusEvent = z.infer<typeof statusEventSchema>

export const compactProgressPhase = z.enum([
  'hooks_start',
  'context_collapse_start',
  'context_collapse_end',
  'session_memory_start',
  'session_memory_end',
  'compact_start',
  'compact_retry',
  'compact_end',
  'compact_failed',
])
export type CompactProgressPhase = z.infer<typeof compactProgressPhase>

export const compactProgressTrigger = z.enum(['auto', 'manual', 'reactive'])
export type CompactProgressTrigger = z.infer<typeof compactProgressTrigger>

export const compactProgressEventSchema = z.object({
  type: z.literal('compact_progress'),
  phase: compactProgressPhase,
  trigger: compactProgressTrigger,
  message: z.string().nullish(),
  attempt: z.number().int().nullish(),
  checkpoint: z.string().nullish(),
  metadata: z.record(z.unknown()).nullish(),
})
export type CompactProgressEvent = z.infer<typeof compactProgressEventSchema>

export const streamEventSchema = z.discriminatedUnion('type', [
  assistantTextDeltaSchema,
  assistantTurnCompleteSchema,
  toolExecutionStartedSchema,
  toolExecutionCompletedSchema,
  errorEventSchema,
  statusEventSchema,
  compactProgressEventSchema,
])
export type StreamEvent = z.infer<typeof streamEventSchema>
