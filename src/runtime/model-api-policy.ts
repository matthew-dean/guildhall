export type ModelApiRole =
  | 'coordinator'
  | 'spec'
  | 'worker'
  | 'reviewer'
  | 'gateChecker'
  | 'contextIndexer'
  | 'repair'

export interface ModelApiPolicyInput {
  role: ModelApiRole
  modelId: string
}

export interface ModelApiPolicy {
  reasoning_effort?: 'low' | 'medium' | 'high'
  reasoning?: Record<string, unknown>
  response_format?: Record<string, unknown>
  tool_choice?: string | Record<string, unknown>
  service_tier?: undefined
}

export function resolveModelApiPolicy(input: ModelApiPolicyInput): ModelApiPolicy {
  if (!supportsReasoningControls(input.modelId)) return {}

  const effort = reasoningEffortForRole(input.role, input.modelId)
  if (effort == null) return {}

  return {
    reasoning_effort: effort,
    reasoning: { effort },
  }
}

function supportsReasoningControls(modelId: string): boolean {
  const id = modelId.toLowerCase()
  return id.includes('thinking') ||
    id.includes('kimi') ||
    id.includes('deepseek-r1') ||
    id.startsWith('o1') ||
    id.startsWith('o3') ||
    id.startsWith('o4') ||
    id.startsWith('gpt-5')
}

function reasoningEffortForRole(
  role: ModelApiRole,
  modelId: string,
): 'low' | 'medium' | 'high' | undefined {
  const id = modelId.toLowerCase()
  if (role === 'worker' && !id.includes('thinking')) return undefined
  if (role === 'coordinator') return 'medium'
  if (role === 'reviewer') return 'low'
  if (role === 'spec') return 'medium'
  if (role === 'gateChecker') return 'low'
  if (role === 'repair') return 'low'
  if (role === 'contextIndexer') return undefined
  if (id.includes('thinking')) return 'low'
  return undefined
}
