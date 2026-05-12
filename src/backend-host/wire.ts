/**
 * Ported from openharness/src/openharness/ui/protocol.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Pydantic BaseModel → Zod schemas (matches our protocol package convention).
 *   - TranscriptItem, FrontendRequest, BackendEvent share identical fields with
 *     the upstream Python schema so an existing React frontend speaking OHJSON
 *     can talk to this host unchanged.
 *   - `AppState` / `TaskSnapshot` / `McpConnectionStatus` / `BridgeSessionRecord`
 *     payloads are typed as `Record<string, unknown>` here; upstream is tightly
 *     coupled to those modules, which we port later behind the command layer.
 *   - `_format_permission_mode` and the command-specific `BackendEvent.ready`
 *     / `status_snapshot` factories are deferred to the caller that wires in
 *     the full state model — the wire schema itself is loose enough to carry
 *     them without change.
 */

import { z } from 'zod'

export const OHJSON_PREFIX = 'OHJSON:'

// ---------------------------------------------------------------------------
// TranscriptItem
// ---------------------------------------------------------------------------

export const transcriptRole = z.enum([
  'system',
  'user',
  'assistant',
  'tool',
  'tool_result',
  'log',
])
export type TranscriptRole = z.infer<typeof transcriptRole>

export const transcriptItemSchema = z.object({
  role: transcriptRole,
  text: z.string(),
  tool_name: z.string().nullish(),
  tool_input: z.record(z.unknown()).nullish(),
  is_error: z.boolean().nullish(),
})
export type TranscriptItem = z.infer<typeof transcriptItemSchema>

// ---------------------------------------------------------------------------
// FrontendRequest
// ---------------------------------------------------------------------------

export const frontendRequestType = z.enum([
  'submit_line',
  'permission_response',
  'question_response',
  'list_sessions',
  'select_command',
  'apply_select_command',
  'shutdown',
])
export type FrontendRequestType = z.infer<typeof frontendRequestType>

export const frontendRequestSchema = z.object({
  type: frontendRequestType,
  line: z.string().nullish(),
  command: z.string().nullish(),
  value: z.string().nullish(),
  request_id: z.string().nullish(),
  allowed: z.boolean().nullish(),
  answer: z.string().nullish(),
})
export type FrontendRequest = z.infer<typeof frontendRequestSchema>

// ---------------------------------------------------------------------------
// BackendEvent
// ---------------------------------------------------------------------------

export const backendEventType = z.enum([
  'ready',
  'state_snapshot',
  'tasks_snapshot',
  'transcript_item',
  'compact_progress',
  'assistant_delta',
  'assistant_complete',
  'line_complete',
  'tool_started',
  'tool_completed',
  'clear_transcript',
  'modal_request',
  'select_request',
  'todo_update',
  'plan_mode_change',
  'swarm_status',
  // FR-16: orchestrator-level lifecycle events. Upstream OpenHarness does not
  // have a multi-task orchestrator so these have no direct parallel; they
  // carry task_transition / escalation_raised payloads produced by the
  // Guildhall orchestrator's tick loop.
  'task_transition',
  'escalation_raised',
  // FR-31: structured agent-issue channel. Agents emit these mid-task via
  // the `report_issue` tool when they notice something the coordinator
  // should see but the task can keep running. Carries `issue_id`, `code`,
  // `severity`, and the existing `reason`/`agent_name`/`task_id` fields.
  'agent_issue',
  'agent_started',
  'agent_finished',
  'error',
  'shutdown',
])
export type BackendEventType = z.infer<typeof backendEventType>

export const backendEventSchema = z.object({
  type: backendEventType,
  select_options: z.array(z.record(z.unknown())).nullish(),
  message: z.string().nullish(),
  item: transcriptItemSchema.nullish(),
  state: z.record(z.unknown()).nullish(),
  tasks: z.array(z.record(z.unknown())).nullish(),
  mcp_servers: z.array(z.record(z.unknown())).nullish(),
  bridge_sessions: z.array(z.record(z.unknown())).nullish(),
  commands: z.array(z.string()).nullish(),
  modal: z.record(z.unknown()).nullish(),
  tool_name: z.string().nullish(),
  tool_input: z.record(z.unknown()).nullish(),
  output: z.string().nullish(),
  is_error: z.boolean().nullish(),
  compact_phase: z.string().nullish(),
  compact_trigger: z.string().nullish(),
  attempt: z.number().int().nullish(),
  compact_checkpoint: z.string().nullish(),
  compact_metadata: z.record(z.unknown()).nullish(),
  todo_markdown: z.string().nullish(),
  plan_mode: z.string().nullish(),
  swarm_teammates: z.array(z.record(z.unknown())).nullish(),
  swarm_notifications: z.array(z.record(z.unknown())).nullish(),
  // FR-16: orchestrator tick outcomes. These fields ride on `task_transition`
  // and `escalation_raised` events. The remainder of the union members leave
  // them unset.
  task_id: z.string().nullish(),
  from_status: z.string().nullish(),
  to_status: z.string().nullish(),
  agent_name: z.string().nullish(),
  revision_count: z.number().int().nullish(),
  transitioned: z.boolean().nullish(),
  escalation_id: z.string().nullish(),
  reason: z.string().nullish(),
  // FR-31: agent_issue payload. `code` + `severity` are the AgentIssue's
  // structured signal; the free-text `reason` field carries the detail
  // (reused from FR-10 so subscribers don't need a new field mapping).
  issue_id: z.string().nullish(),
  code: z.string().nullish(),
  severity: z.string().nullish(),
})
export type BackendEvent = z.infer<typeof backendEventSchema>

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

export function encodeBackendEvent(event: BackendEvent): string {
  return `${OHJSON_PREFIX}${JSON.stringify(event)}\n`
}

export function parseFrontendRequest(payload: string): FrontendRequest {
  const trimmed = payload.trim()
  if (!trimmed) throw new Error('Empty request payload')
  const body = trimmed.startsWith(OHJSON_PREFIX)
    ? trimmed.slice(OHJSON_PREFIX.length)
    : trimmed
  const json = JSON.parse(body) as unknown
  return frontendRequestSchema.parse(json)
}
