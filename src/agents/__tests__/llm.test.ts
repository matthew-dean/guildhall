import { describe, expect, it } from 'vitest'

import type { SupportsStreamingMessages } from '@guildhall/engine'

import { buildModelSet, temperatureForRole } from '../llm.js'

const noopClient: SupportsStreamingMessages = {
  async *streamMessage() {
    throw new Error('not used in llm role binding tests')
  },
}

describe('llm role temperatures', () => {
  it('uses conservative per-role defaults', () => {
    expect(temperatureForRole('spec')).toBe(0.2)
    expect(temperatureForRole('coordinator')).toBe(0.2)
    expect(temperatureForRole('worker')).toBe(0.1)
    expect(temperatureForRole('reviewer')).toBe(0)
    expect(temperatureForRole('gateChecker')).toBe(0)
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
    expect(models.worker.temperature).toBe(0.1)
    expect(models.reviewer.temperature).toBe(0)
    expect(models.gateChecker.temperature).toBe(0)
  })
})
