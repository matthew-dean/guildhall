/**
 * Tests for the stream event discriminated union.
 * Upstream reference: openharness/src/openharness/engine/stream_events.py
 */

import { describe, expect, it } from 'vitest'

import {
  assistantTextDeltaSchema,
  compactProgressEventSchema,
  errorEventSchema,
  streamEventSchema,
  toolExecutionCompletedSchema,
} from '../events.js'

describe('streamEventSchema', () => {
  it('parses assistant_text_delta', () => {
    const e = streamEventSchema.parse({ type: 'assistant_text_delta', text: 'hi' })
    expect(e.type).toBe('assistant_text_delta')
  })

  it('parses assistant_turn_complete with full payload', () => {
    const e = streamEventSchema.parse({
      type: 'assistant_turn_complete',
      message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    expect(e.type).toBe('assistant_turn_complete')
  })

  it('parses tool_execution_completed with default is_error', () => {
    const e = toolExecutionCompletedSchema.parse({
      type: 'tool_execution_completed',
      tool_name: 'shell',
      output: 'ok',
    })
    expect(e.is_error).toBe(false)
  })

  it('parses error with default recoverable=true', () => {
    const e = errorEventSchema.parse({ type: 'error', message: 'oops' })
    expect(e.recoverable).toBe(true)
  })

  it('rejects unknown event types', () => {
    expect(() => streamEventSchema.parse({ type: 'bogus' })).toThrow()
  })

  it('assistantTextDeltaSchema requires text', () => {
    expect(() => assistantTextDeltaSchema.parse({ type: 'assistant_text_delta' })).toThrow()
  })
})

describe('compactProgressEventSchema', () => {
  it('accepts all nine phases and three triggers', () => {
    const phases = [
      'hooks_start',
      'context_collapse_start',
      'context_collapse_end',
      'session_memory_start',
      'session_memory_end',
      'compact_start',
      'compact_retry',
      'compact_end',
      'compact_failed',
    ] as const
    const triggers = ['auto', 'manual', 'reactive'] as const
    for (const phase of phases) {
      for (const trigger of triggers) {
        const e = compactProgressEventSchema.parse({ type: 'compact_progress', phase, trigger })
        expect(e.phase).toBe(phase)
        expect(e.trigger).toBe(trigger)
      }
    }
  })

  it('rejects invalid phase', () => {
    expect(() =>
      compactProgressEventSchema.parse({
        type: 'compact_progress',
        phase: 'bogus',
        trigger: 'auto',
      }),
    ).toThrow()
  })

  it('rejects invalid trigger', () => {
    expect(() =>
      compactProgressEventSchema.parse({
        type: 'compact_progress',
        phase: 'hooks_start',
        trigger: 'bogus',
      }),
    ).toThrow()
  })

  it('allows optional fields to be absent', () => {
    const e = compactProgressEventSchema.parse({
      type: 'compact_progress',
      phase: 'hooks_start',
      trigger: 'auto',
    })
    expect(e.message).toBeUndefined()
    expect(e.attempt).toBeUndefined()
  })
})
