/**
 * Ported from openharness/src/openharness/ui/protocol.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - **Redesigned as a proper discriminated union on `type`.** Upstream uses a single
 *     Pydantic model with every field optional; we split one schema per variant so
 *     each type carries exactly the fields it needs. This makes the TypeScript side
 *     type-safe to construct and exhaustively switch on, which Pydantic's flat model
 *     couldn't guarantee.
 *   - **Dropped variants:** `swarm_status`, `plan_mode_change`, and the MCP/bridge-sessions
 *     fields on `state_snapshot`. Swarm is out of scope for Guildhall. MCP + bridge
 *     sessions will return when those subsystems land — add a variant then.
 *   - **Renamed variants:** `assistant_delta` → `assistant_text_delta`, `assistant_complete` →
 *     `assistant_turn_complete`, `tool_started` → `tool_execution_started`,
 *     `tool_completed` → `tool_execution_completed` to match the engine stream event names.
 *     A single vocabulary between engine and wire means no translation layer.
 *   - **Added variants for Guildhall lifecycle:** `task_phase_change`, `gate_result`,
 *     `spec_draft_update` (for the exploring-phase split pane).
 *   - `TaskSnapshot.from_record` classmethod → `taskSnapshotFromRecord` free function
 *     (kept pure-data in the schema module).
 *   - Permission-mode label formatting (`_format_permission_mode`) dropped —
 *     that's UI-layer concern, not wire-format concern.
 */

import { z } from 'zod'

import {
  assistantTextDeltaSchema,
  assistantTurnCompleteSchema,
  compactProgressEventSchema,
  errorEventSchema,
  statusEventSchema,
  toolExecutionCompletedSchema,
  toolExecutionStartedSchema,
} from './events.js'

// ============================================================================
// Shared payloads
// ============================================================================

export const transcriptItemSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool', 'tool_result', 'log']),
  text: z.string(),
  tool_name: z.string().nullish(),
  tool_input: z.record(z.unknown()).nullish(),
  is_error: z.boolean().nullish(),
})
export type TranscriptItem = z.infer<typeof transcriptItemSchema>

export const taskSnapshotSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  description: z.string(),
  metadata: z.record(z.string()).default({}),
})
export type TaskSnapshot = z.infer<typeof taskSnapshotSchema>

export const appStateSchema = z
  .object({
    model: z.string(),
    cwd: z.string(),
    provider: z.string(),
    permission_mode: z.enum(['default', 'plan', 'full_auto']),
  })
  .passthrough()
export type AppState = z.infer<typeof appStateSchema>

// ============================================================================
// Frontend → Backend requests
// ============================================================================

export const submitLineRequestSchema = z.object({
  type: z.literal('submit_line'),
  line: z.string(),
})

export const permissionResponseRequestSchema = z.object({
  type: z.literal('permission_response'),
  request_id: z.string(),
  allowed: z.boolean(),
})

export const questionResponseRequestSchema = z.object({
  type: z.literal('question_response'),
  request_id: z.string(),
  answer: z.string(),
})

export const listSessionsRequestSchema = z.object({
  type: z.literal('list_sessions'),
})

export const selectCommandRequestSchema = z.object({
  type: z.literal('select_command'),
  command: z.string(),
})

export const applySelectCommandRequestSchema = z.object({
  type: z.literal('apply_select_command'),
  value: z.string(),
})

export const shutdownRequestSchema = z.object({
  type: z.literal('shutdown'),
})

export const frontendRequestSchema = z.discriminatedUnion('type', [
  submitLineRequestSchema,
  permissionResponseRequestSchema,
  questionResponseRequestSchema,
  listSessionsRequestSchema,
  selectCommandRequestSchema,
  applySelectCommandRequestSchema,
  shutdownRequestSchema,
])
export type FrontendRequest = z.infer<typeof frontendRequestSchema>

// ============================================================================
// Backend → Frontend events
// ============================================================================

export const readyEventSchema = z.object({
  type: z.literal('ready'),
  state: appStateSchema,
  tasks: z.array(taskSnapshotSchema).default([]),
  commands: z.array(z.string()).default([]),
})

export const stateSnapshotEventSchema = z.object({
  type: z.literal('state_snapshot'),
  state: appStateSchema,
})

export const tasksSnapshotEventSchema = z.object({
  type: z.literal('tasks_snapshot'),
  tasks: z.array(taskSnapshotSchema),
})

export const transcriptItemEventSchema = z.object({
  type: z.literal('transcript_item'),
  item: transcriptItemSchema,
})

export const clearTranscriptEventSchema = z.object({
  type: z.literal('clear_transcript'),
})

export const lineCompleteEventSchema = z.object({
  type: z.literal('line_complete'),
})

export const modalRequestEventSchema = z.object({
  type: z.literal('modal_request'),
  request_id: z.string(),
  modal: z.record(z.unknown()),
})

export const selectRequestEventSchema = z.object({
  type: z.literal('select_request'),
  request_id: z.string(),
  options: z.array(z.record(z.unknown())),
})

export const todoUpdateEventSchema = z.object({
  type: z.literal('todo_update'),
  todo_markdown: z.string(),
})

export const shutdownEventSchema = z.object({
  type: z.literal('shutdown'),
})

// Guildhall-specific lifecycle events

export const taskPhaseChangeEventSchema = z.object({
  type: z.literal('task_phase_change'),
  task_id: z.string(),
  from_phase: z.string(),
  to_phase: z.string(),
})

export const gateResultEventSchema = z.object({
  type: z.literal('gate_result'),
  task_id: z.string(),
  gate: z.string(),
  passed: z.boolean(),
  detail: z.string().nullish(),
})

export const specDraftUpdateEventSchema = z.object({
  type: z.literal('spec_draft_update'),
  task_id: z.string(),
  markdown: z.string(),
})

export const backendEventSchema = z.discriminatedUnion('type', [
  // Handshake / state
  readyEventSchema,
  stateSnapshotEventSchema,
  tasksSnapshotEventSchema,
  shutdownEventSchema,
  // Transcript / output
  transcriptItemEventSchema,
  clearTranscriptEventSchema,
  lineCompleteEventSchema,
  todoUpdateEventSchema,
  // Agent stream events (re-exported from events.ts for a unified wire channel)
  assistantTextDeltaSchema,
  assistantTurnCompleteSchema,
  toolExecutionStartedSchema,
  toolExecutionCompletedSchema,
  statusEventSchema,
  errorEventSchema,
  compactProgressEventSchema,
  // Interactive prompts
  modalRequestEventSchema,
  selectRequestEventSchema,
  // Guildhall lifecycle
  taskPhaseChangeEventSchema,
  gateResultEventSchema,
  specDraftUpdateEventSchema,
])
export type BackendEvent = z.infer<typeof backendEventSchema>
