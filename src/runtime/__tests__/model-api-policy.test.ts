import { describe, expect, it } from 'vitest'

import { resolveModelApiPolicy } from '../model-api-policy.js'

describe('resolveModelApiPolicy', () => {
  it('keeps the fast cached Qwen worker cheap by default', () => {
    const policy = resolveModelApiPolicy({
      role: 'worker',
      modelId: 'Qwen/Qwen3.5-35B-A3B',
    })

    expect(policy.reasoning_effort).toBeUndefined()
    expect(policy.reasoning).toBeUndefined()
    expect(policy.service_tier).toBeUndefined()
  })

  it('uses medium reasoning for coordinator turns on Qwen thinking models', () => {
    const policy = resolveModelApiPolicy({
      role: 'coordinator',
      modelId: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
    })

    expect(policy.reasoning_effort).toBe('medium')
    expect(policy.reasoning).toEqual({ effort: 'medium' })
    expect(policy.service_tier).toBeUndefined()
  })

  it('uses low reasoning for Kimi reviewer turns', () => {
    const policy = resolveModelApiPolicy({
      role: 'reviewer',
      modelId: 'moonshotai/Kimi-K2.6',
    })

    expect(policy.reasoning_effort).toBe('low')
    expect(policy.reasoning).toEqual({ effort: 'low' })
    expect(policy.service_tier).toBeUndefined()
  })

  it('does not invent provider-specific controls for generic local models', () => {
    expect(resolveModelApiPolicy({
      role: 'worker',
      modelId: 'local-model',
    })).toEqual({})
  })
})
