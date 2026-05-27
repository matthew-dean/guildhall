import { describe, expect, it } from 'vitest'

import { parseDeepInfraModelMetadata } from '../deepinfra-model-metadata.js'

describe('parseDeepInfraModelMetadata', () => {
  it('extracts cached input pricing and capabilities from DeepInfra-like model metadata', () => {
    const metadata = parseDeepInfraModelMetadata({
      model_name: 'Qwen/Qwen3.5-35B-A3B',
      pricing: {
        input: 0.15,
        output: 0.60,
        cached_input: 0.05,
      },
      context_length: 262144,
      supported_parameters: [
        'tools',
        'response_format',
        'reasoning_effort',
      ],
    })

    expect(metadata.id).toBe('Qwen/Qwen3.5-35B-A3B')
    expect(metadata.pricing.inputPerMillionUsd).toBe(0.15)
    expect(metadata.pricing.outputPerMillionUsd).toBe(0.60)
    expect(metadata.pricing.cachedInputPerMillionUsd).toBe(0.05)
    expect(metadata.contextWindowTokens).toBe(262144)
    expect(metadata.capabilities.promptCaching).toBe(true)
    expect(metadata.capabilities.structuredOutputs).toBe(true)
    expect(metadata.capabilities.toolCalling).toBe(true)
    expect(metadata.capabilities.reasoningControls).toBe(true)
  })

  it('treats missing cached price as not prompt-cache eligible for default workers', () => {
    const metadata = parseDeepInfraModelMetadata({
      id: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
      pricing: {
        input: '$0.0710/Mtoken',
        output: '$0.30/Mtoken',
      },
      supported_parameters: ['tools', 'response_format'],
    })

    expect(metadata.pricing.cachedInputPerMillionUsd).toBeNull()
    expect(metadata.capabilities.promptCaching).toBe(false)
    expect(metadata.defaultWorkerEligible).toBe(false)
  })

  it('recognizes non-Qwen cached coding challengers without making them defaults by name', () => {
    const metadata = parseDeepInfraModelMetadata({
      id: 'moonshotai/Kimi-K2.6',
      pricing: {
        prompt_cache_read: 0.15,
        input: 0.60,
        output: 2.50,
      },
      capabilities: {
        tool_calling: true,
        structured_outputs: true,
      },
    })

    expect(metadata.capabilities.promptCaching).toBe(true)
    expect(metadata.capabilities.toolCalling).toBe(true)
    expect(metadata.capabilities.structuredOutputs).toBe(true)
    expect(metadata.defaultWorkerEligible).toBe(true)
  })
})
