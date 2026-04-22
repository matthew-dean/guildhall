/**
 * Tests for the frontend/backend wire protocol.
 * Upstream reference: openharness/src/openharness/ui/protocol.py
 */

import { describe, expect, it } from 'vitest'

import {
  backendEventSchema,
  frontendRequestSchema,
  gateResultEventSchema,
  readyEventSchema,
  specDraftUpdateEventSchema,
  taskPhaseChangeEventSchema,
  taskSnapshotSchema,
  transcriptItemSchema,
} from '../wire.js'

describe('frontendRequestSchema', () => {
  it('parses submit_line', () => {
    const r = frontendRequestSchema.parse({ type: 'submit_line', line: 'hello' })
    expect(r.type).toBe('submit_line')
    if (r.type === 'submit_line') expect(r.line).toBe('hello')
  })

  it('parses permission_response', () => {
    const r = frontendRequestSchema.parse({
      type: 'permission_response',
      request_id: 'req_1',
      allowed: true,
    })
    expect(r.type).toBe('permission_response')
  })

  it('parses question_response', () => {
    const r = frontendRequestSchema.parse({
      type: 'question_response',
      request_id: 'req_2',
      answer: 'yes',
    })
    expect(r.type).toBe('question_response')
  })

  it('parses list_sessions with no payload', () => {
    const r = frontendRequestSchema.parse({ type: 'list_sessions' })
    expect(r.type).toBe('list_sessions')
  })

  it('parses shutdown with no payload', () => {
    const r = frontendRequestSchema.parse({ type: 'shutdown' })
    expect(r.type).toBe('shutdown')
  })

  it('rejects permission_response missing request_id', () => {
    expect(() =>
      frontendRequestSchema.parse({ type: 'permission_response', allowed: true }),
    ).toThrow()
  })

  it('rejects unknown request types', () => {
    expect(() => frontendRequestSchema.parse({ type: 'bogus' })).toThrow()
  })
})

describe('backendEventSchema', () => {
  const baseState = {
    model: 'claude-opus-4-7',
    cwd: '/tmp',
    provider: 'anthropic',
    permission_mode: 'default' as const,
  }

  it('parses ready with defaults for tasks/commands', () => {
    const e = readyEventSchema.parse({ type: 'ready', state: baseState })
    expect(e.tasks).toEqual([])
    expect(e.commands).toEqual([])
  })

  it('parses a full ready event', () => {
    const e = backendEventSchema.parse({
      type: 'ready',
      state: baseState,
      tasks: [
        { id: 't1', type: 'work', status: 'ready', description: 'Do the thing', metadata: {} },
      ],
      commands: ['plan', 'commit'],
    })
    expect(e.type).toBe('ready')
  })

  it('parses transcript_item', () => {
    const e = backendEventSchema.parse({
      type: 'transcript_item',
      item: { role: 'assistant', text: 'hi' },
    })
    expect(e.type).toBe('transcript_item')
  })

  it('parses tool_execution_started from the engine event vocabulary', () => {
    const e = backendEventSchema.parse({
      type: 'tool_execution_started',
      tool_name: 'shell',
      tool_input: { cmd: 'ls' },
    })
    expect(e.type).toBe('tool_execution_started')
  })

  it('parses Guildhall-specific task_phase_change', () => {
    const e = taskPhaseChangeEventSchema.parse({
      type: 'task_phase_change',
      task_id: 't1',
      from_phase: 'ready',
      to_phase: 'in_progress',
    })
    expect(e.to_phase).toBe('in_progress')
  })

  it('parses Guildhall-specific gate_result', () => {
    const e = gateResultEventSchema.parse({
      type: 'gate_result',
      task_id: 't1',
      gate: 'typecheck',
      passed: true,
    })
    expect(e.passed).toBe(true)
  })

  it('parses Guildhall-specific spec_draft_update', () => {
    const e = specDraftUpdateEventSchema.parse({
      type: 'spec_draft_update',
      task_id: 't1',
      markdown: '# Spec\n\nDo it.',
    })
    expect(e.markdown).toContain('# Spec')
  })

  it('rejects unknown event types', () => {
    expect(() => backendEventSchema.parse({ type: 'bogus' })).toThrow()
  })
})

describe('payload schemas', () => {
  it('transcriptItemSchema accepts tool_input and is_error', () => {
    const t = transcriptItemSchema.parse({
      role: 'tool',
      text: 'output',
      tool_name: 'shell',
      tool_input: { cmd: 'ls' },
      is_error: false,
    })
    expect(t.tool_name).toBe('shell')
  })

  it('taskSnapshotSchema defaults metadata to an empty object', () => {
    const t = taskSnapshotSchema.parse({
      id: 't1',
      type: 'work',
      status: 'ready',
      description: 'x',
    })
    expect(t.metadata).toEqual({})
  })
})
