/**
 * Seed positions for every lever, used when `memory/agent-settings.yaml` is
 * first created. These are NOT "hidden defaults" — they are written
 * explicitly to the file with `setBy: 'system-default'` so the provenance
 * trail shows that the Spec Agent has not yet refined them via intake.
 *
 * The Spec Agent is expected to overwrite most of these during the first
 * exploratory conversation with the user (FR-14), using `setBy:
 * 'spec-agent-intake'` and a rationale derived from the conversation.
 */

import type {
  DomainLevers,
  LeverSettings,
  ProjectLevers,
} from './schema.js'

export function makeDefaultSettings(now: Date = new Date()): LeverSettings {
  const ts = now.toISOString()
  const stub = (rationale: string) => ({
    rationale,
    setAt: ts,
    setBy: 'system-default' as const,
  })

  const project: ProjectLevers = {
    concurrent_task_dispatch: {
      position: { kind: 'serial' },
      ...stub('start serial; Spec Agent widens fanout once project maturity and runtime isolation allow it'),
    },
    worktree_isolation: {
      position: 'none',
      ...stub('no isolation until fanout is enabled'),
    },
    merge_policy: {
      position: 'ff_only_local',
      ...stub('local-first; Spec Agent upgrades to ff_only_with_push or manual_pr on project signal'),
    },
    rejection_dampening: {
      position: { kind: 'off' },
      ...stub('dampening off until repeated-rejection shape is observed'),
    },
    business_envelope_strictness: {
      position: 'advisory',
      ...stub('advisory by default; Spec Agent tightens to strict for production work'),
    },
    agent_health_strictness: {
      position: 'standard',
      ...stub('2-minute stall threshold — balances local-LLM latency against stuck-detection'),
    },
    remediation_autonomy: {
      position: 'confirm_destructive',
      ...stub('coordinator may act on non-destructive remediations; restart_clean / shelve_task / pause_task_line require a human'),
    },
    runtime_isolation: {
      position: 'none',
      ...stub('no slot allocation until fanout is enabled'),
    },
  }

  const domainDefault: DomainLevers = {
    task_origination: {
      position: 'agent_proposed_coordinator_approved',
      ...stub('agents may propose; coordinator approves — the middle-ground that enables emergent work without losing human-visible provenance'),
    },
    spec_completeness: {
      position: 'stage_appropriate',
      ...stub('spec fidelity grows with task maturity — the Spec Agent decides what each stage needs'),
    },
    pre_rejection_policy: {
      position: 'requeue_with_dampening',
      ...stub('pre-rejections are signals, not verdicts — requeue and let dampening suppress repeat shapes'),
    },
    completion_approval: {
      position: 'coordinator_sufficient',
      ...stub('gates + coordinator review is enough to mark done; Spec Agent tightens to human_required when risk is high'),
    },
    reviewer_mode: {
      position: 'llm_with_deterministic_fallback',
      ...stub('prefer LLM reviewer; fall back to deterministic rubric when the LLM is unavailable'),
    },
    reviewer_fanout_policy: {
      position: 'strict',
      ...stub('every persona must approve; worker synthesizes dissenting revisions. Coordinator adjudication turns on once conflicts prove recurrent.'),
    },
    max_revisions: {
      position: 3,
      ...stub('three revision passes before escalation — enough for iteration, short enough to surface systemic spec issues'),
    },
    escalation_on_ambiguity: {
      position: 'coordinator_first',
      ...stub('let the coordinator try first; escalate to human only if coordinator cannot resolve'),
    },
    crash_recovery_default: {
      position: 'prefer_resume',
      ...stub('favor resume over restart to preserve in-flight work; coordinator overrides per-incident if checkpoint looks corrupted'),
    },
  }

  return {
    version: 1,
    project,
    domains: {
      default: domainDefault,
      overrides: {},
    },
  }
}
