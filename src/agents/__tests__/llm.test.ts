import { describe, expect, it } from 'vitest'

import type { SupportsStreamingMessages } from '@guildhall/engine'

import { buildModelSet, samplingProfileForRole, temperatureForProfile, temperatureForRole } from '../llm.js'

const noopClient: SupportsStreamingMessages = {
  async *streamMessage() {
    throw new Error('not used in llm role binding tests')
  },
}

describe('llm role temperatures', () => {
  it('uses named behavior profiles instead of exposing sampling numbers as the product contract', () => {
    expect(samplingProfileForRole('spec')).toBe('balanced')
    expect(samplingProfileForRole('coordinator')).toBe('balanced')
    expect(samplingProfileForRole('worker')).toBe('precise')
    expect(samplingProfileForRole('reviewer')).toBe('precise')
    expect(samplingProfileForRole('gateChecker')).toBe('precise')
    expect(samplingProfileForRole('contextIndexer')).toBe('precise')
  })

  it('translates behavior profiles into provider sampling values internally', () => {
    expect(temperatureForProfile('precise')).toBe(0)
    expect(temperatureForProfile('balanced')).toBe(0.2)
    expect(temperatureForProfile('exploratory')).toBe(0.7)
  })

  it('uses conservative per-role defaults', () => {
    expect(temperatureForRole('spec')).toBe(0.2)
    expect(temperatureForRole('coordinator')).toBe(0.2)
    expect(temperatureForRole('worker')).toBe(0)
    expect(temperatureForRole('reviewer')).toBe(0)
    expect(temperatureForRole('gateChecker')).toBe(0)
  })

  it('lets callers override role behavior profiles without using raw temperatures', () => {
    const models = buildModelSet(
      {
        spec: 'spec-model',
        coordinator: 'coord-model',
        worker: 'worker-model',
        reviewer: 'review-model',
        gateChecker: 'gate-model',
        contextIndexer: 'context-model',
      },
      noopClient,
      { spec: 'exploratory', worker: 'balanced' },
    )

    expect(models.spec.temperature).toBe(0.7)
    expect(models.worker.temperature).toBe(0.2)
    expect(models.reviewer.temperature).toBe(0)
  })

  it('threads role temperatures into the model set', () => {
    const models = buildModelSet(
      {
        spec: 'spec-model',
        coordinator: 'coord-model',
        worker: 'worker-model',
        reviewer: 'review-model',
        gateChecker: 'gate-model',
        contextIndexer: 'gate-model',
      },
      noopClient,
    )

    expect(models.spec.temperature).toBe(0.2)
    expect(models.coordinator.temperature).toBe(0.2)
    expect(models.worker.temperature).toBe(0)
    expect(models.reviewer.temperature).toBe(0)
    expect(models.gateChecker.temperature).toBe(0)
  })
})
