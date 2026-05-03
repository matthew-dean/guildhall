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
import {
  providerCapabilitiesForAnyKey,
  providerFamilyForPreferredKey,
  type ProviderCapabilities,
  type ProviderFamily,
} from './provider-metadata.js'

export interface RuntimeProviderConfig {
  preferredProvider?: PreferredProviderKey
  preferredProviderFamily?: ProviderFamily
  preferredProviderCapabilities?: ProviderCapabilities | null
  allowPaidProviderFallback: boolean
  credentials: ResolvedProviderCredentials
  selectOptions: SelectApiClientOptions
}

export interface ReviewerFanoutPolicy {
  requestedConcurrency: number
  effectiveConcurrency: number
  recommendedConcurrency: number | null
  clamped: boolean
}

export interface LaneConcurrencyPolicy {
  requestedConcurrency: number
  effectiveConcurrency: number
  recommendedConcurrency: number | null
  clamped: boolean
}

export interface LaneConcurrencyPlan {
  spec: LaneConcurrencyPolicy
  worker: LaneConcurrencyPolicy
  review: LaneConcurrencyPolicy
  coordinator: LaneConcurrencyPolicy
  reviewerFanout: ReviewerFanoutPolicy
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
  const preferredProviderCapabilities = preferredProvider
    ? providerCapabilitiesForAnyKey(preferredProvider)
    : null
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
    preferredProviderCapabilities,
    allowPaidProviderFallback,
    credentials,
    selectOptions,
  }
}

export function resolveReviewerFanoutPolicy(input: {
  provider: PreferredProviderKey | ProviderName | 'none' | null | undefined
  requestedConcurrency: number
}): ReviewerFanoutPolicy {
  const requestedConcurrency = Math.max(1, Math.floor(input.requestedConcurrency))
  const caps = providerCapabilitiesForAnyKey(input.provider)
  const recommendedConcurrency = caps?.recommendedConcurrency ?? null
  if (!recommendedConcurrency) {
    return {
      requestedConcurrency,
      effectiveConcurrency: requestedConcurrency,
      recommendedConcurrency: null,
      clamped: false,
    }
  }
  const effectiveConcurrency = Math.max(
    1,
    Math.min(requestedConcurrency, recommendedConcurrency),
  )
  return {
    requestedConcurrency,
    effectiveConcurrency,
    recommendedConcurrency,
    clamped: effectiveConcurrency < requestedConcurrency,
  }
}

function clampLanePolicy(input: {
  requestedConcurrency: number
  ceiling: number
  recommendedConcurrency: number | null
}): LaneConcurrencyPolicy {
  const requestedConcurrency = Math.max(1, Math.floor(input.requestedConcurrency))
  const ceiling = Math.max(1, Math.floor(input.ceiling))
  const recommendedConcurrency = input.recommendedConcurrency == null
    ? null
    : Math.max(1, Math.floor(input.recommendedConcurrency))
  const effectiveConcurrency = Math.max(
    1,
    Math.min(
      requestedConcurrency,
      ceiling,
      recommendedConcurrency ?? Number.POSITIVE_INFINITY,
    ),
  )
  return {
    requestedConcurrency,
    effectiveConcurrency,
    recommendedConcurrency,
    clamped: effectiveConcurrency < requestedConcurrency,
  }
}

export function resolveLaneConcurrencyPlan(input: {
  projectPath: string
  provider: PreferredProviderKey | ProviderName | 'none' | null | undefined
  dispatchCapacity: number
}): LaneConcurrencyPlan {
  const projectCfg = readProjectConfig(input.projectPath)
  const dispatchCapacity = Math.max(1, Math.floor(input.dispatchCapacity))
  return {
    spec: clampLanePolicy({
      requestedConcurrency: projectCfg.specLaneConcurrency,
      ceiling: dispatchCapacity,
      recommendedConcurrency: 1,
    }),
    worker: clampLanePolicy({
      requestedConcurrency: projectCfg.workerLaneConcurrency,
      ceiling: dispatchCapacity,
      recommendedConcurrency: dispatchCapacity,
    }),
    review: clampLanePolicy({
      requestedConcurrency: projectCfg.reviewLaneConcurrency,
      ceiling: dispatchCapacity,
      recommendedConcurrency: 1,
    }),
    coordinator: clampLanePolicy({
      requestedConcurrency: projectCfg.coordinatorLaneConcurrency,
      ceiling: dispatchCapacity,
      recommendedConcurrency: 1,
    }),
    reviewerFanout: resolveReviewerFanoutPolicy({
      provider: input.provider,
      requestedConcurrency: projectCfg.reviewerFanoutConcurrency,
    }),
  }
}
