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
import { DEFAULT_ROLE_BEHAVIOR } from '@guildhall/core'
import type { ModelAssignmentConfig, AgentRole, ModelBehaviorProfile } from '@guildhall/core'

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

export type ModelBehaviorConfig = Partial<Record<AgentRole, ModelBehaviorProfile>>

export function samplingProfileForRole(
  role: AgentRole,
  behavior: ModelBehaviorConfig = {},
): ModelBehaviorProfile {
  return behavior[role] ?? DEFAULT_ROLE_BEHAVIOR[role]
}

export function temperatureForProfile(profile: ModelBehaviorProfile): number {
  switch (profile) {
    case 'precise':
      return 0
    case 'balanced':
      return 0.2
    case 'exploratory':
      return 0.7
  }
}

export function temperatureForRole(role: AgentRole, behavior: ModelBehaviorConfig = {}): number {
  return temperatureForProfile(samplingProfileForRole(role, behavior))
}

/**
 * Bind each role's model ID to a shared `apiClient` (or a role-specific one).
 * For the common single-provider case, pass the same apiClient for every role.
 */
export function buildModelSet(
  assignment: ModelAssignmentConfig,
  apiClient: SupportsStreamingMessages,
  behavior: ModelBehaviorConfig = {},
): ModelSet {
  return {
    spec: { apiClient, modelId: assignment.spec, temperature: temperatureForRole('spec', behavior) },
    coordinator: { apiClient, modelId: assignment.coordinator, temperature: temperatureForRole('coordinator', behavior) },
    worker: { apiClient, modelId: assignment.worker, temperature: temperatureForRole('worker', behavior) },
    reviewer: { apiClient, modelId: assignment.reviewer, temperature: temperatureForRole('reviewer', behavior) },
    gateChecker: { apiClient, modelId: assignment.gateChecker, temperature: temperatureForRole('gateChecker', behavior) },
    contextIndexer: { apiClient, modelId: assignment.contextIndexer, temperature: temperatureForRole('contextIndexer', behavior) },
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
