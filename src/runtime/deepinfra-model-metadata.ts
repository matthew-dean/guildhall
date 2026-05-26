export interface DeepInfraModelMetadata {
  id: string
  pricing: {
    inputPerMillionUsd: number | null
    outputPerMillionUsd: number | null
    cachedInputPerMillionUsd: number | null
  }
  contextWindowTokens: number | null
  capabilities: {
    promptCaching: boolean
    structuredOutputs: boolean
    toolCalling: boolean
    reasoningControls: boolean
  }
  defaultWorkerEligible: boolean
}

export function parseDeepInfraModelMetadata(raw: Record<string, unknown>): DeepInfraModelMetadata {
  const id = stringValue(raw['id']) ??
    stringValue(raw['model_name']) ??
    stringValue(raw['name']) ??
    'unknown'
  const pricing = recordValue(raw['pricing']) ?? {}
  const supportedParameters = stringArray(raw['supported_parameters'])
  const capabilities = recordValue(raw['capabilities']) ?? {}
  const cachedInput = firstNumber(
    pricing['cached_input'],
    pricing['cachedInput'],
    pricing['prompt_cache_read'],
    pricing['cached_input_price'],
    raw['cached_input_price'],
  )
  const structuredOutputs = booleanValue(capabilities['structured_outputs']) ??
    booleanValue(capabilities['structuredOutputs']) ??
    supportedParameters.includes('response_format')
  const toolCalling = booleanValue(capabilities['tool_calling']) ??
    booleanValue(capabilities['toolCalling']) ??
    supportedParameters.includes('tools')
  const reasoningControls = booleanValue(capabilities['reasoning_controls']) ??
    booleanValue(capabilities['reasoningControls']) ??
    (supportedParameters.includes('reasoning_effort') ||
      supportedParameters.includes('reasoning'))

  return {
    id,
    pricing: {
      inputPerMillionUsd: firstNumber(pricing['input'], pricing['input_price']),
      outputPerMillionUsd: firstNumber(pricing['output'], pricing['output_price']),
      cachedInputPerMillionUsd: cachedInput,
    },
    contextWindowTokens: firstNumber(
      raw['context_length'],
      raw['contextWindowTokens'],
      raw['max_context_length'],
    ),
    capabilities: {
      promptCaching: cachedInput !== null,
      structuredOutputs,
      toolCalling,
      reasoningControls,
    },
    defaultWorkerEligible: cachedInput !== null,
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = parsePrice(value)
    if (parsed !== null) return parsed
  }
  return null
}

function parsePrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const match = value.match(/([0-9]+(?:\.[0-9]+)?)/)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}
