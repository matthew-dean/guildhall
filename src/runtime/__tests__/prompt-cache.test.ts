import { describe, expect, it } from 'vitest'

import {
  buildPromptCacheKey,
  cachedPromptTokens,
  splitCacheableContextPrefix,
} from '../prompt-cache.js'

describe('prompt-cache helpers', () => {
  it('uses a stable per-project-role-task-session cache key without timestamps', () => {
    expect(buildPromptCacheKey({
      provider: 'openai-api',
      projectId: 'fair-labor-license',
      taskId: 'task-006',
      agentRole: 'worker',
      sessionId: 'session-a',
    })).toBe('openai-api:fair-labor-license:task-006:worker:session-a')
  })

  it('keeps stable cacheable prefix before dynamic task deltas', () => {
    const split = splitCacheableContextPrefix([
      { key: 'system', text: 'stable system', cacheability: 'cacheable' },
      { key: 'personaPrompt', text: 'stable persona', cacheability: 'cacheable' },
      { key: 'taskSummary', text: 'dynamic task', cacheability: 'dynamic' },
      { key: 'recentProgress', text: 'rolling progress', cacheability: 'dynamic' },
    ])

    expect(split.formatted).toBe('stable system\n\nstable persona\n\ndynamic task\n\nrolling progress')
    expect(split.cacheablePrefixChars).toBe('stable system\n\nstable persona'.length)
  })

  it('extracts cached prompt tokens from DeepInfra-compatible usage details', () => {
    expect(cachedPromptTokens({
      prompt_tokens: 5000,
      prompt_tokens_details: { cached_tokens: 4800 },
    })).toBe(4800)
  })
})
