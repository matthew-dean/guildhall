---
title: Levers
help_topic: lever.index
help_summary: |
  Explains Guildhall's named behavioral settings: how autonomy, review,
  worktree isolation, recovery, and other project policies are stored and
  adjusted.
---

# Levers

Every behavioral knob in GuildHall is a **named lever** with a fixed set of **positions**. Levers are persisted in `memory/agent-settings.yaml` with full provenance (*who set it, when, why*).

- 9 **project levers** — singleton per workspace.
- 9 **domain levers** — per coordinator domain, with a `default` fallback.

## How levers get set

On first run, GuildHall seeds every lever with `setBy: system-default` so there are no invisible defaults. During dashboard onboarding, meta-intake can infer better starting positions from the project interview. The Spec Agent emits a `levers:` YAML draft alongside coordinator definitions; when you approve it, GuildHall writes those positions to `memory/agent-settings.yaml` with `setBy: spec-agent-intake` and the agent's rationale.

The agent should infer only what the conversation supports. Anything uncertain stays at the system default until you change it in Settings or edit the file directly. See [Onboarding and levers](../guide/onboarding-and-levers) for the end-to-end flow.

## How a lever is stored

```yaml
landing_strategy:
  position: cherry_pick_with_push
  rationale: "Land accepted work locally, then push the landing branch to origin"
  setAt: "2026-04-10T11:02:00Z"
  setBy: user-direct
```

See [Provenance](./provenance) for the setter enum.

## Project levers

| Lever | Positions | Default |
|---|---|---|
| [`concurrent_task_dispatch`](./concurrent-task-dispatch) | `serial`, `fanout_N` | `serial` |
| [`worktree_isolation`](./worktree-isolation) | `none`, `per_task`, `per_attempt` | `per_task` |
| [`landing_strategy`](./merge-policy) | `cherry_pick_local`, `cherry_pick_with_push`, `manual_pr` | `cherry_pick_local` |
| [`rejection_dampening`](./rejection-dampening) | `off`, `soft_penalty_after_N`, `hard_suppress_after_N` | `off` |
| [`business_envelope_strictness`](./business-envelope-strictness) | `strict`, `advisory`, `off` | `advisory` |
| [`agent_health_strictness`](./agent-health-strictness) | `lax`, `standard`, `strict` | `standard` |
| [`remediation_autonomy`](./remediation-autonomy) | `auto`, `confirm_destructive`, `confirm_all`, `pause_all_on_issue` | `confirm_destructive` |
| [`runtime_isolation`](./runtime-isolation) | `none`, `slot_allocation` | `none` |
| [`workspace_import_autonomy`](./workspace-import-autonomy) | `off`, `suggest`, `apply` | `suggest` |

## Domain levers

Per coordinator domain; one `default:` entry is required as fallback.

| Lever | Positions | Default |
|---|---|---|
| [`task_origination`](./task-origination) | `human_only`, `agent_proposed_human_approved`, `agent_proposed_coordinator_approved`, `agent_autonomous` | `agent_proposed_coordinator_approved` |
| [`spec_completeness`](./spec-completeness) | `full_upfront`, `stage_appropriate`, `emergent` | `stage_appropriate` |
| [`pre_rejection_policy`](./pre-rejection-policy) | `terminal_shelved`, `requeue_lower_priority`, `requeue_with_dampening` | `requeue_with_dampening` |
| [`completion_approval`](./completion-approval) | `human_required`, `coordinator_sufficient`, `gates_sufficient` | `coordinator_sufficient` |
| [`reviewer_mode`](./reviewer-mode) | `llm_only`, `deterministic_only`, `llm_with_deterministic_fallback` | `llm_with_deterministic_fallback` |
| [`reviewer_fanout_policy`](./reviewer-fanout-policy) | `strict`, `coordinator_adjudicates_on_conflict`, `advisory`, `majority` | `strict` |
| [`max_revisions`](./max-revisions) | integer | `3` |
| [`escalation_on_ambiguity`](./escalation-on-ambiguity) | `always`, `coordinator_first`, `never` | `coordinator_first` |
| [`crash_recovery_default`](./crash-recovery-default) | `prefer_resume`, `prefer_restart_clean`, `pause_for_review` | `prefer_resume` |
