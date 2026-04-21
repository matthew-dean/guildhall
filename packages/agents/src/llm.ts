/**
 * LLM wiring for Guildhall agents.
 *
 * NOTE: Concrete providers (Claude OAuth, Codex OAuth, llama.cpp) live in
 * @guildhall/providers (not yet ported). Until then, `buildModelSet` accepts
 * an injected `apiClient` (any `SupportsStreamingMessages`) and binds a
 * model ID per role.
 *
 * The orchestrator owns construction of the concrete apiClient and is the
 * single point where the provider contract gets satisfied.
 */

import type { SupportsStreamingMessages } from '@guildhall/engine'
import type { ModelAssignmentConfig, AgentRole } from '@guildhall/core'

export interface AgentLLM {
  apiClient: SupportsStreamingMessages
  modelId: string
}

export interface ModelSet {
  spec: AgentLLM
  coordinator: AgentLLM
  worker: AgentLLM
  reviewer: AgentLLM
  gateChecker: AgentLLM
}

/**
 * Bind each role's model ID to a shared `apiClient` (or a role-specific one).
 * For the common single-provider case, pass the same apiClient for every role.
 */
export function buildModelSet(
  assignment: ModelAssignmentConfig,
  apiClient: SupportsStreamingMessages,
): ModelSet {
  return {
    spec: { apiClient, modelId: assignment.spec },
    coordinator: { apiClient, modelId: assignment.coordinator },
    worker: { apiClient, modelId: assignment.worker },
    reviewer: { apiClient, modelId: assignment.reviewer },
    gateChecker: { apiClient, modelId: assignment.gateChecker },
  }
}

export function modelForRole(role: AgentRole, models: ModelSet): AgentLLM {
  const map: Record<AgentRole, AgentLLM> = {
    spec: models.spec,
    coordinator: models.coordinator,
    worker: models.worker,
    reviewer: models.reviewer,
    gateChecker: models.gateChecker,
  }
  return map[role]
}

/**
 * Stub apiClient that throws on first streamMessage call. Useful for
 * typechecks and wiring tests before real providers land.
 */
export function notImplementedApiClient(reason: string): SupportsStreamingMessages {
  return {
    streamMessage() {
      throw new Error(`LLM provider not implemented: ${reason}`)
    },
  }
}
