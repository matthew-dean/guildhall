import { ScopeAuthorityRequest, type ScopeAuthorityRequestType } from '@guildhall/core'

export type ScopeAuthorityActionType =
  | 'split_work'
  | 'create_proof_work'
  | 'create_review_work'
  | 'create_setup_work'
  | 'create_migration_work'
  | 'change_visibility'
  | 'reorder_work'
  | 'merge_work'
  | ScopeAuthorityRequestType

export interface ScopeAuthorityActionInput {
  type: ScopeAuthorityActionType
  targetWorkId?: string
  reason: string
  ownerRequested?: boolean
}

export type ScopeAuthorityClassification =
  | {
      needsOwnerDecision: false
      authority: 'execution_planning'
      reason: string
    }
  | {
      needsOwnerDecision: true
      authority: 'scope_authority'
      requestType: ScopeAuthorityRequestType
      reason: string
    }

const SCOPE_AUTHORITY_TYPES = new Set<ScopeAuthorityRequestType>([
  'add_scope',
  'drop_scope',
  'defer_scope',
  'change_release_boundary',
  'resolve_goal_conflict',
  'external_permission',
  'irreversible_operation',
])

export function classifyScopeAuthorityAction(input: ScopeAuthorityActionInput): ScopeAuthorityClassification {
  if (input.type === 'defer_scope' && input.ownerRequested) {
    return {
      needsOwnerDecision: false,
      authority: 'execution_planning',
      reason: input.reason,
    }
  }
  if (isScopeAuthorityRequestType(input.type)) {
    return {
      needsOwnerDecision: true,
      authority: 'scope_authority',
      requestType: input.type,
      reason: input.reason,
    }
  }
  return {
    needsOwnerDecision: false,
    authority: 'execution_planning',
    reason: input.reason,
  }
}

export function createScopeAuthorityRequest(
  input: Omit<ScopeAuthorityRequest, 'status' | 'options'> & {
    status?: ScopeAuthorityRequest['status']
    options?: ScopeAuthorityRequest['options']
  },
): ScopeAuthorityRequest {
  return ScopeAuthorityRequest.parse({
    ...input,
    status: input.status ?? 'open',
    options: input.options ?? [],
  })
}

function isScopeAuthorityRequestType(type: ScopeAuthorityActionType): type is ScopeAuthorityRequestType {
  return SCOPE_AUTHORITY_TYPES.has(type as ScopeAuthorityRequestType)
}
