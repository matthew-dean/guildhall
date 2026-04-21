/**
 * Valibot schemas for every lever in SPEC.md §2.1.
 *
 * Each lever value is `{position, rationale, setAt, setBy}`. "Position" is
 * either a plain string picklist or a discriminated object for parameterized
 * levers (fanout_N, soft_penalty_after_N, etc.).
 *
 * No hidden hardcoded defaults — defaults live in `defaults.ts` as explicit
 * named constants, and the first write of `memory/agent-settings.yaml` seeds
 * every lever with `setBy: 'system-default'` so the provenance trail is
 * intact.
 */

import * as v from 'valibot'

// ---------------------------------------------------------------------------
// Common entry envelope
// ---------------------------------------------------------------------------

export const leverSetterSchema = v.union([
  v.literal('system-default'),
  v.literal('spec-agent-intake'),
  v.literal('user-direct'),
  v.pipe(v.string(), v.regex(/^coordinator:/)),
])

export type LeverSetter = v.InferOutput<typeof leverSetterSchema>

function entry<TPosition extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  positionSchema: TPosition,
) {
  return v.object({
    position: positionSchema,
    rationale: v.pipe(v.string(), v.minLength(1)),
    setAt: v.pipe(v.string(), v.isoTimestamp()),
    setBy: leverSetterSchema,
  })
}

// ---------------------------------------------------------------------------
// Parameterized position shapes
// ---------------------------------------------------------------------------

export const concurrentDispatchPositionSchema = v.variant('kind', [
  v.object({ kind: v.literal('serial') }),
  v.object({
    kind: v.literal('fanout'),
    n: v.pipe(v.number(), v.integer(), v.minValue(2)),
  }),
])

export const rejectionDampeningPositionSchema = v.variant('kind', [
  v.object({ kind: v.literal('off') }),
  v.object({
    kind: v.literal('soft_penalty'),
    after: v.pipe(v.number(), v.integer(), v.minValue(1)),
  }),
  v.object({
    kind: v.literal('hard_suppress'),
    after: v.pipe(v.number(), v.integer(), v.minValue(1)),
  }),
])

// ---------------------------------------------------------------------------
// Project-scope levers (singleton per project)
// ---------------------------------------------------------------------------

export const projectLeversSchema = v.object({
  concurrent_task_dispatch: entry(concurrentDispatchPositionSchema),
  worktree_isolation: entry(v.picklist(['none', 'per_task', 'per_attempt'])),
  merge_policy: entry(v.picklist(['ff_only_local', 'ff_only_with_push', 'manual_pr'])),
  rejection_dampening: entry(rejectionDampeningPositionSchema),
  business_envelope_strictness: entry(v.picklist(['strict', 'advisory', 'off'])),
  agent_health_strictness: entry(v.picklist(['lax', 'standard', 'strict'])),
  remediation_autonomy: entry(
    v.picklist(['auto', 'confirm_destructive', 'confirm_all', 'pause_all_on_issue']),
  ),
  runtime_isolation: entry(v.picklist(['none', 'slot_allocation'])),
})

export type ProjectLevers = v.InferOutput<typeof projectLeversSchema>

// ---------------------------------------------------------------------------
// Domain-scope levers (keyed by domain name; "default" required as fallback)
// ---------------------------------------------------------------------------

export const domainLeversSchema = v.object({
  task_origination: entry(
    v.picklist([
      'human_only',
      'agent_proposed_human_approved',
      'agent_proposed_coordinator_approved',
      'agent_autonomous',
    ]),
  ),
  spec_completeness: entry(v.picklist(['full_upfront', 'stage_appropriate', 'emergent'])),
  pre_rejection_policy: entry(
    v.picklist(['terminal_shelved', 'requeue_lower_priority', 'requeue_with_dampening']),
  ),
  completion_approval: entry(
    v.picklist(['human_required', 'coordinator_sufficient', 'gates_sufficient']),
  ),
  reviewer_mode: entry(
    v.picklist(['llm_only', 'deterministic_only', 'llm_with_deterministic_fallback']),
  ),
  max_revisions: entry(v.pipe(v.number(), v.integer(), v.minValue(0))),
  escalation_on_ambiguity: entry(v.picklist(['always', 'coordinator_first', 'never'])),
  crash_recovery_default: entry(
    v.picklist(['prefer_resume', 'prefer_restart_clean', 'pause_for_review']),
  ),
})

export type DomainLevers = v.InferOutput<typeof domainLeversSchema>

// ---------------------------------------------------------------------------
// Top-level LeverSettings
// ---------------------------------------------------------------------------

export const leverSettingsSchema = v.object({
  version: v.literal(1),
  project: projectLeversSchema,
  domains: v.object({
    default: domainLeversSchema,
    // Named-domain overrides are a partial shape. valibot doesn't have a
    // first-class Partial<> so we express it as a record of strings →
    // partial object. We validate the outer shape here; the loader does the
    // partial-merge against `default` when reading.
    overrides: v.optional(
      v.record(v.string(), v.record(v.string(), v.unknown())),
      {},
    ),
  }),
})

export type LeverSettings = v.InferOutput<typeof leverSettingsSchema>

// ---------------------------------------------------------------------------
// Lever-name discriminators for type-safe resolution
// ---------------------------------------------------------------------------

export const PROJECT_LEVER_NAMES = [
  'concurrent_task_dispatch',
  'worktree_isolation',
  'merge_policy',
  'rejection_dampening',
  'business_envelope_strictness',
  'agent_health_strictness',
  'remediation_autonomy',
  'runtime_isolation',
] as const satisfies readonly (keyof ProjectLevers)[]

export const DOMAIN_LEVER_NAMES = [
  'task_origination',
  'spec_completeness',
  'pre_rejection_policy',
  'completion_approval',
  'reviewer_mode',
  'max_revisions',
  'escalation_on_ambiguity',
  'crash_recovery_default',
] as const satisfies readonly (keyof DomainLevers)[]

export type ProjectLeverName = (typeof PROJECT_LEVER_NAMES)[number]
export type DomainLeverName = (typeof DOMAIN_LEVER_NAMES)[number]
