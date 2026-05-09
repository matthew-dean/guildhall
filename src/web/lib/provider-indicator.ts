import type { ProviderStatus } from './types.js'

function providerLabel(provider: string | null | undefined): string {
  if (!provider) return 'Not selected'
  const labels: Record<string, string> = {
    'claude-oauth': 'Claude',
    'codex-oauth': 'Codex',
    codex: 'Codex',
    'llama-cpp': 'Local server',
    'anthropic-api': 'Anthropic',
    'openai-api': 'OpenAI-compatible',
    none: 'None',
  }
  return labels[provider] ?? provider
}

function compactModelLabel(model: string | null | undefined): string {
  if (!model) return 'default'
  const trimmed = model.trim()
  if (!trimmed) return 'default'
  const slash = trimmed.lastIndexOf('/')
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}

function modelMixSummary(models: ProviderStatus['models']): string | null {
  if (!models) return null
  const roles: Array<[string, string | undefined]> = [
    ['Spec', models.spec],
    ['Coordinator', models.coordinator],
    ['Worker', models.worker],
    ['Reviewer', models.reviewer],
    ['Gate', models.gateChecker],
  ]
  const values = roles.map(([, model]) => model).filter((model): model is string => Boolean(model))
  if (values.length === 0) return null
  if (new Set(values).size === 1) return null
  return roles
    .filter(([, model]) => Boolean(model))
    .map(([label, model]) => `${label}: ${model}`)
    .join('\n')
}

export interface ProviderIndicatorViewModel {
  summaryLabel: string
  title: string
}

export function buildProviderIndicator(
  providerStatus: ProviderStatus | null | undefined,
  runStatus: string,
): ProviderIndicatorViewModel | null {
  if (!providerStatus) return null

  const preferredProviderLabel =
    providerStatus.preferredProviderLabel ?? providerLabel(providerStatus.preferredProvider)
  const activeProviderLabel =
    providerStatus.activeProviderLabel ??
    providerLabel(providerStatus.activeProvider ?? providerStatus.preferredProvider)
  const mixedModels = modelMixSummary(providerStatus.models)
  const workerModelLabel = compactModelLabel(providerStatus.activeModel ?? providerStatus.models?.worker)
  const runtimeActive = runStatus === 'running' || runStatus === 'stopping'

  const summaryLabel = runtimeActive
    ? activeProviderLabel
    : providerStatus.preferredProvider
      ? preferredProviderLabel
      : providerStatus.activeProvider && providerStatus.activeProvider !== 'none'
        ? activeProviderLabel
        : mixedModels
          ? 'Configured'
          : 'Providers'

  const detailLines: string[] = []
  if (runtimeActive) {
    detailLines.push(`Running on ${activeProviderLabel}`)
    if (providerStatus.activeModel) detailLines.push(`Worker model: ${providerStatus.activeModel}`)
  } else if (providerStatus.preferredProvider) {
    detailLines.push(`Configured preferred provider: ${preferredProviderLabel}`)
    detailLines.push(`Worker model: ${workerModelLabel}`)
  } else if (providerStatus.activeProvider && providerStatus.activeProvider !== 'none') {
    detailLines.push(`Last active provider: ${activeProviderLabel}`)
    detailLines.push(`Worker model: ${workerModelLabel}`)
  } else if (mixedModels) {
    detailLines.push('Project has model assignments but no provider selected yet.')
  } else {
    detailLines.push('Provider not selected')
  }
  if (mixedModels) detailLines.push(mixedModels)
  if (providerStatus.decisions?.length) {
    detailLines.push(...providerStatus.decisions.map((entry) => entry.message))
  }

  const title = detailLines.join('\n')
  return { summaryLabel, title }
}
