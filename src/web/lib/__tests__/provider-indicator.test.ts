import { describe, expect, it } from 'vitest'

import { buildProviderIndicator } from '../provider-indicator.js'
import type { ProviderStatus } from '../types.js'

describe('buildProviderIndicator', () => {
  it('shows configured provider instead of none when a project is not running', () => {
    const providerStatus: ProviderStatus = {
      activeProvider: 'none',
      preferredProvider: 'openai-api',
      preferredProviderLabel: 'OpenAI-compatible',
      models: {
        spec: 'qwen/spec',
        coordinator: 'qwen/coord',
        worker: 'gpt-5.3-codex',
        reviewer: 'qwen/review',
        gateChecker: 'qwen/gate',
      },
    }

    expect(buildProviderIndicator(providerStatus, 'stopped')).toEqual({
      summaryLabel: 'OpenAI-compatible',
      title: [
        'This project is set to use OpenAI-compatible when you start a run.',
        'Worker model: gpt-5.3-codex',
        'Spec: qwen/spec',
        'Coordinator: qwen/coord',
        'Worker: gpt-5.3-codex',
        'Reviewer: qwen/review',
        'Gate: qwen/gate',
      ].join('\n'),
    })
  })

  it('shows the active provider when a project is running', () => {
    const providerStatus: ProviderStatus = {
      activeProvider: 'claude-oauth',
      activeProviderLabel: 'Claude',
      activeModel: 'claude-sonnet-4-6',
      models: {
        worker: 'claude-sonnet-4-6',
      },
    }

    expect(buildProviderIndicator(providerStatus, 'running')).toEqual({
      summaryLabel: 'Claude',
      title: 'Current run is using Claude.\nWorker model: claude-sonnet-4-6',
    })
  })
})
