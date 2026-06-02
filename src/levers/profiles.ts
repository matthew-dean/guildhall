export type OperatingProfileId = 'balanced' | 'conservative' | 'autonomous' | 'release_hardening'

export interface OperatingProfile {
  id: OperatingProfileId
  label: string
  summary: string
  leverPositions: Record<string, string>
}

export const OPERATING_PROFILES: OperatingProfile[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    summary: 'Guildhall asks for owner judgment when product meaning or risk changes, and otherwise keeps moving with proof.',
    leverPositions: {},
  },
  {
    id: 'conservative',
    label: 'Conservative',
    summary: 'Guildhall asks before high-risk starts, completion approval, and ambiguous scope changes.',
    leverPositions: {
      task_origination: 'human_only',
      completion_approval: 'human_required',
      escalation_on_ambiguity: 'always',
    },
  },
  {
    id: 'autonomous',
    label: 'Autonomous',
    summary: 'Guildhall proceeds when configured gates and coordinator checks are enough.',
    leverPositions: {
      task_origination: 'agent_proposed_coordinator_approved',
      completion_approval: 'gates_sufficient',
      escalation_on_ambiguity: 'coordinator_first',
    },
  },
  {
    id: 'release_hardening',
    label: 'Release hardening',
    summary: 'Guildhall favors stricter review, broader proof, and slower completion around release work.',
    leverPositions: {
      reviewer_fanout_policy: 'strict',
      review_effort: 'release_critical',
      completion_approval: 'human_required',
      pre_rejection_policy: 'requeue_with_dampening',
    },
  },
]

export function operatingProfileById(id: OperatingProfileId): OperatingProfile {
  return OPERATING_PROFILES.find(profile => profile.id === id) ?? OPERATING_PROFILES[0]!
}
