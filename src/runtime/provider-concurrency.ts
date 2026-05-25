import { readGlobalConfig, readGlobalProviders } from '@guildhall/config'
import type { ProviderKind } from '@guildhall/config'
import {
  DEFAULT_GLOBAL_PROVIDER_CONCURRENCY,
  HOSTED_PROVIDER_DEFAULT_CONCURRENCY,
  LOCAL_PROVIDER_DEFAULT_CONCURRENCY,
  providerCapabilitiesForAnyKey,
} from './provider-metadata.js'
import type { PreferredProviderKey, ProviderName } from './provider-selection.js'

export function resolveGlobalProviderConcurrencyCeiling(): number {
  const configured = readGlobalConfig().maxProviderConcurrency
  return Math.max(1, Math.floor(configured ?? DEFAULT_GLOBAL_PROVIDER_CONCURRENCY))
}

type ProviderConcurrencyKey = PreferredProviderKey | ProviderName | 'none' | null | undefined

function storedProviderKey(provider: ProviderConcurrencyKey): ProviderKind | null {
  if (provider === 'codex') return 'codex-oauth'
  if (
    provider === 'anthropic-api' ||
    provider === 'claude-oauth' ||
    provider === 'codex-oauth' ||
    provider === 'llama-cpp' ||
    provider === 'openai-api'
  ) return provider
  return null
}

function fallbackConcurrency(provider: ProviderConcurrencyKey): number {
  const caps = providerCapabilitiesForAnyKey(provider)
  if (caps?.localServer) return LOCAL_PROVIDER_DEFAULT_CONCURRENCY
  return caps?.recommendedConcurrency ?? HOSTED_PROVIDER_DEFAULT_CONCURRENCY
}

export function resolveProviderGroupConcurrency(provider: ProviderConcurrencyKey): number | null {
  if (!provider || provider === 'none') return null
  const key = storedProviderKey(provider)
  const stored = key ? readGlobalProviders().providers[key]?.maxConcurrency : undefined
  const requested = stored ?? fallbackConcurrency(provider)
  return Math.min(resolveGlobalProviderConcurrencyCeiling(), Math.max(1, Math.floor(requested)))
}

export function resolveOpenAiCompatibleConcurrency(input: {
  provider: 'openai-api' | 'llama-cpp'
  baseUrl: string
}): number {
  return resolveProviderGroupConcurrency(input.provider) ?? fallbackConcurrency(input.provider)
}
