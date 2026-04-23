/**
 * Zod schemas for every lever in SPEC.md §2.1.
 *
 * Each lever value is `{position, rationale, setAt, setBy}`. "Position" is
 * either a plain string enum or a discriminated object for parameterized
 * levers (fanout_N, soft_penalty_after_N, etc.).
 *
 * No hidden hardcoded defaults — defaults live in `defaults.ts` as explicit
 * named constants, and the first write of `memory/agent-settings.yaml` seeds
 * every lever with `setBy: 'system-default'` so the provenance trail is
 * intact.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Common entry envelope
// ---------------------------------------------------------------------------

export const leverSetterSchema = z.union([
  z.literal('system-default'),
  z.literal('spec-agent-intake'),
  z.literal('user-direct'),
  z.string().regex(/^coordinator:/),
])

export type LeverSetter = z.infer<typeof leverSetterSchema>

function entry<T extends z.ZodTypeAny>(positionSchema: T) {
  return z.object({
    position: positionSchema,
    rationale: z.string().min(1),
    setAt: z.string().datetime(),
    setBy: leverSetterSchema,
  })
}

// ---------------------------------------------------------------------------
// Parameterized position shapes
// ---------------------------------------------------------------------------

export const concurrentDispatchPositionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('serial') }),
  z.object({
    kind: z.literal('fanout'),
    n: z.number().int().min(2),
  }),
])

export const rejectionDampeningPositionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('off') }),
  z.object({
    kind: z.literal('soft_penalty'),
    after: z.number().int().min(1),
  }),
  z.object({
    kind: z.literal('hard_suppress'),
    after: z.number().int().min(1),
  }),
])

// ---------------------------------------------------------------------------
// Project-scope levers (singleton per project)
// ---------------------------------------------------------------------------

export const projectLeversSchema = z.object({
  concurrent_task_dispatch: entry(concurrentDispatchPositionSchema),
  worktree_isolation: entry(z.enum(['none', 'per_task', 'per_attempt'])),
  merge_policy: entry(z.enum(['ff_only_local', 'ff_only_with_push', 'manual_pr'])),
  rejection_dampening: entry(rejectionDampeningPositionSchema),
  business_envelope_strictness: entry(z.enum(['strict', 'advisory', 'off'])),
  agent_health_strictness: entry(z.enum(['lax', 'standard', 'strict'])),
  remediation_autonomy: entry(
    z.enum(['auto', 'confirm_destructive', 'confirm_all', 'pause_all_on_issue']),
  ),
  runtime_isolation: entry(z.enum(['none', 'slot_allocation'])),
  workspace_import_autonomy: entry(z.enum(['off', 'suggest', 'apply'])),
})

export type ProjectLevers = z.infer<typeof projectLeversSchema>

// ---------------------------------------------------------------------------
// Domain-scope levers (keyed by domain name; "default" required as fallback)
// ---------------------------------------------------------------------------

export const domainLeversSchema = z.object({
  task_origination: entry(
    z.enum([
      'human_only',
      'agent_proposed_human_approved',
      'agent_proposed_coordinator_approved',
      'agent_autonomous',
    ]),
  ),
  spec_completeness: entry(z.enum(['full_upfront', 'stage_appropriate', 'emergent'])),
  pre_rejection_policy: entry(
    z.enum(['terminal_shelved', 'requeue_lower_priority', 'requeue_with_dampening']),
  ),
  completion_approval: entry(
    z.enum(['human_required', 'coordinator_sufficient', 'gates_sufficient']),
  ),
  reviewer_mode: entry(
    z.enum(['llm_only', 'deterministic_only', 'llm_with_deterministic_fallback']),
  ),
  max_revisions: entry(z.number().int().min(0)),
  escalation_on_ambiguity: entry(z.enum(['always', 'coordinator_first', 'never'])),
  crash_recovery_default: entry(
    z.enum(['prefer_resume', 'prefer_restart_clean', 'pause_for_review']),
  ),
})

export type DomainLevers = z.infer<typeof domainLeversSchema>

// ---------------------------------------------------------------------------
// Top-level LeverSettings
// ---------------------------------------------------------------------------

export const leverSettingsSchema = z.object({
  version: z.literal(1),
  project: projectLeversSchema,
  domains: z.object({
    default: domainLeversSchema,
    // Named-domain overrides are a partial shape. Zod partials must be
    // declared up-front, so we accept unknown-shaped records at load time
    // and let `resolveDomainLevers` validate the merged result per-domain.
    overrides: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  }),
})

export type LeverSettings = z.infer<typeof leverSettingsSchema>

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
  'workspace_import_autonomy',
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
