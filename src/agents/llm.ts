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
  temperature?: number
}

export interface ModelSet {
  spec: AgentLLM
  coordinator: AgentLLM
  worker: AgentLLM
  reviewer: AgentLLM
  gateChecker: AgentLLM
  contextIndexer: AgentLLM
}

export function temperatureForRole(role: AgentRole): number {
  switch (role) {
    case 'worker':
      return 0.1
    case 'reviewer':
    case 'gateChecker':
    case 'contextIndexer':
      return 0
    case 'spec':
    case 'coordinator':
      return 0.2
  }
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
    spec: { apiClient, modelId: assignment.spec, temperature: temperatureForRole('spec') },
    coordinator: { apiClient, modelId: assignment.coordinator, temperature: temperatureForRole('coordinator') },
    worker: { apiClient, modelId: assignment.worker, temperature: temperatureForRole('worker') },
    reviewer: { apiClient, modelId: assignment.reviewer, temperature: temperatureForRole('reviewer') },
    gateChecker: { apiClient, modelId: assignment.gateChecker, temperature: temperatureForRole('gateChecker') },
    contextIndexer: { apiClient, modelId: assignment.contextIndexer, temperature: temperatureForRole('contextIndexer') },
  }
}

export function modelForRole(role: AgentRole, models: ModelSet): AgentLLM {
  const map: Record<AgentRole, AgentLLM> = {
    spec: models.spec,
    coordinator: models.coordinator,
    worker: models.worker,
    reviewer: models.reviewer,
    gateChecker: models.gateChecker,
    contextIndexer: models.contextIndexer,
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
