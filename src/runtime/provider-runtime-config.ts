import {
  readGlobalConfig,
  readProjectConfig,
  resolveGlobalCredentials,
  type ResolvedProviderCredentials,
} from '@guildhall/config'
import type { ModelAssignmentConfig } from '@guildhall/core'
import {
  inferPreferredProvider,
  type PreferredProviderKey,
  type ProviderName,
  type SelectApiClientOptions,
} from './provider-selection.js'
import { providerFamilyForPreferredKey, type ProviderFamily } from './provider-metadata.js'

export interface RuntimeProviderConfig {
  preferredProvider?: PreferredProviderKey
  preferredProviderFamily?: ProviderFamily
  allowPaidProviderFallback: boolean
  credentials: ResolvedProviderCredentials
  selectOptions: SelectApiClientOptions
}

export function buildSelectApiClientOptions(input: {
  credentials: ResolvedProviderCredentials
  preferredProvider?: PreferredProviderKey
  allowPaidProviderFallback?: boolean
  providerOverride?: ProviderName
}): SelectApiClientOptions {
  return {
    ...(input.providerOverride ? { provider: input.providerOverride } : {}),
    ...(input.preferredProvider ? { preferredProvider: input.preferredProvider } : {}),
    ...(input.allowPaidProviderFallback ? { allowPaidProviderFallback: true } : {}),
    ...(input.credentials.anthropicApiKey
      ? { anthropicApiKey: input.credentials.anthropicApiKey }
      : {}),
    ...(input.credentials.openaiApiKey ? { openaiApiKey: input.credentials.openaiApiKey } : {}),
    ...(input.credentials.openaiBaseUrl
      ? { openaiBaseUrl: input.credentials.openaiBaseUrl }
      : {}),
    ...(input.credentials.llamaCppUrl ? { llamaCppUrl: input.credentials.llamaCppUrl } : {}),
  }
}

export function getRuntimeProviderConfig(input: {
  projectPath: string
  models: ModelAssignmentConfig
  providerOverride?: ProviderName
}): RuntimeProviderConfig {
  const projectCfg = readProjectConfig(input.projectPath)
  const globalCfg = readGlobalConfig()
  const credentials = resolveGlobalCredentials()
  const preferredProvider =
    projectCfg.preferredProvider ?? inferPreferredProvider(input.models)
  const preferredProviderFamily = preferredProvider
    ? providerFamilyForPreferredKey(preferredProvider)
    : undefined
  const allowPaidProviderFallback = Boolean(
    projectCfg.allowPaidProviderFallback ?? globalCfg.allowPaidProviderFallback,
  )

  const selectOptions = buildSelectApiClientOptions({
    credentials,
    preferredProvider,
    allowPaidProviderFallback,
    ...(input.providerOverride ? { providerOverride: input.providerOverride } : {}),
  })

  return {
    preferredProvider,
    preferredProviderFamily,
    allowPaidProviderFallback,
    credentials,
    selectOptions,
  }
}
