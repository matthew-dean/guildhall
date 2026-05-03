import { describe, it, expect, beforeEach } from 'vitest'
import type {
  ApiMessageRequest,
  ApiStreamEvent,
  SupportsStreamingMessages,
} from '@guildhall/engine'
import {
  clearProviderClientPool,
  getOrCreateProviderClient,
  providerClientHealth,
  providerClientPoolSize,
} from '../provider-client-pool.js'

const REQUEST: ApiMessageRequest = {
  model: 'test-model',
  messages: [],
  max_tokens: 64,
  tools: [],
}

beforeEach(() => {
  clearProviderClientPool()
})

class SuccessfulClient implements SupportsStreamingMessages {
  async *streamMessage(_request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    yield { type: 'message_start', message: { role: 'assistant', content: [] } }
    yield { type: 'message_stop', stop_reason: 'end_turn' }
  }
}

class RetryableFailureClient implements SupportsStreamingMessages {
  async *streamMessage(_request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    throw Object.assign(new Error('temporary outage'), { retryable: true })
  }
}

class BlockingClient implements SupportsStreamingMessages {
  constructor(
    private readonly state: { active: number; maxSeen: number; release: Promise<void> },
  ) {}

  async *streamMessage(_request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    this.state.active += 1
    this.state.maxSeen = Math.max(this.state.maxSeen, this.state.active)
    try {
      yield { type: 'message_start', message: { role: 'assistant', content: [] } }
      await this.state.release
      yield { type: 'message_stop', stop_reason: 'end_turn' }
    } finally {
      this.state.active -= 1
    }
  }
}

async function drain(client: SupportsStreamingMessages): Promise<void> {
  for await (const _event of client.streamMessage(REQUEST)) {
    // drain
  }
}

describe('provider-client-pool', () => {
  it('reuses an equivalent pooled client instance', () => {
    const a = getOrCreateProviderClient('openai-compatible:test', undefined, () => new SuccessfulClient())
    const b = getOrCreateProviderClient('openai-compatible:test', undefined, () => new SuccessfulClient())
    expect(a).toBe(b)
    expect(providerClientPoolSize()).toBe(1)
  })

  it('records pooled client success health after a successful stream', async () => {
    const client = getOrCreateProviderClient(
      'openai-compatible:test',
      undefined,
      () => new SuccessfulClient(),
    )
    await drain(client)
    expect(providerClientHealth('openai-compatible:test')).toMatchObject({
      state: 'healthy',
      pooled: true,
      consecutiveFailures: 0,
      retryableFailures: 0,
      fatalFailures: 0,
    })
  })

  it('degrades pooled client health after repeated retryable failures', async () => {
    const client = getOrCreateProviderClient(
      'openai-compatible:test',
      undefined,
      () => new RetryableFailureClient(),
    )
    await expect(drain(client)).rejects.toThrow(/temporary outage/)
    await expect(drain(client)).rejects.toThrow(/temporary outage/)
    expect(providerClientHealth('openai-compatible:test')).toMatchObject({
      state: 'degraded',
      consecutiveFailures: 2,
      retryableFailures: 2,
      fatalFailures: 0,
      lastError: 'temporary outage',
    })
  })

  it('recycles a degraded pooled client on the next equivalent acquisition', async () => {
    const first = getOrCreateProviderClient(
      'openai-compatible:test',
      undefined,
      () => new RetryableFailureClient(),
    )
    await expect(drain(first)).rejects.toThrow(/temporary outage/)
    await expect(drain(first)).rejects.toThrow(/temporary outage/)

    const replacement = getOrCreateProviderClient(
      'openai-compatible:test',
      undefined,
      () => new SuccessfulClient(),
    )

    expect(replacement).not.toBe(first)
    await drain(replacement)
    expect(providerClientHealth('openai-compatible:test')).toMatchObject({
      state: 'healthy',
      consecutiveFailures: 0,
      retryableFailures: 0,
      fatalFailures: 0,
    })
  })

  it('enforces maxConcurrency for pooled clients', async () => {
    let release!: () => void
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve
    })
    const state = { active: 0, maxSeen: 0, release: releasePromise }
    const client = getOrCreateProviderClient(
      'openai-compatible:test',
      { maxConcurrency: 1 },
      () => new BlockingClient(state),
    )

    const run1 = drain(client)
    const run2 = drain(client)
    await Promise.resolve()
    await Promise.resolve()
    expect(providerClientHealth('openai-compatible:test')).toMatchObject({
      maxConcurrency: 1,
      activeRequests: 1,
      queuedRequests: 1,
    })
    expect(state.maxSeen).toBe(1)

    release()
    await run1
    await run2
    expect(state.maxSeen).toBe(1)
    expect(providerClientHealth('openai-compatible:test')).toMatchObject({
      activeRequests: 0,
      queuedRequests: 0,
    })
  })
})
