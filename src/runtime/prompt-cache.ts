export type PromptCacheability = 'cacheable' | 'dynamic'

export interface PromptCacheKeyInput {
  provider: string
  projectId: string
  taskId: string
  agentRole: string
  sessionId: string
}

export interface PromptCacheSection {
  key: string
  text: string
  cacheability: PromptCacheability
}

export function buildPromptCacheKey(input: PromptCacheKeyInput): string {
  return [
    input.provider,
    input.projectId,
    input.taskId,
    input.agentRole,
    input.sessionId,
  ].map(cacheKeyPart).join(':')
}

export function splitCacheableContextPrefix(sections: PromptCacheSection[]): {
  formatted: string
  cacheablePrefixChars: number
} {
  const cacheable = sections
    .filter((section) => section.cacheability === 'cacheable' && section.text.trim())
    .map((section) => section.text.trim())
  const dynamic = sections
    .filter((section) => section.cacheability === 'dynamic' && section.text.trim())
    .map((section) => section.text.trim())
  const prefix = cacheable.join('\n\n')
  const suffix = dynamic.join('\n\n')
  return {
    formatted: [prefix, suffix].filter(Boolean).join('\n\n'),
    cacheablePrefixChars: prefix.length,
  }
}

export function cachedPromptTokens(usage: unknown): number {
  const details = (usage as { prompt_tokens_details?: { cached_tokens?: unknown } } | null)
    ?.prompt_tokens_details
  return typeof details?.cached_tokens === 'number' ? details.cached_tokens : 0
}

function cacheKeyPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '')
}
