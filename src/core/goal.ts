import { z } from 'zod'

// ---------------------------------------------------------------------------
// FR-23 Business envelope — Goal entity
//
// A Goal sits *above* tasks and bounds the project's intent. Every task
// carries a `parentGoalId`; an uncategorized task is an escalation signal,
// not a free-floating entry.
//
// Coordinators evaluate proposals and completed work against the parent
// goal's `guardrails`. Strictness is governed by the project lever
// `business_envelope_strictness`:
//
//   - `strict`   — work outside the envelope is rejected
//   - `advisory` — coordinator warns but may approve
//   - `off`      — envelope is informational only
//
// Goals are seeded during meta-intake (FR-14). New goals are added via the
// same intake flow. See @guildhall/runtime business-envelope.ts for the
// pure-policy evaluator that consumes this entity.
// ---------------------------------------------------------------------------

export const GoalStatus = z.enum(['active', 'paused', 'complete'])
export type GoalStatus = z.infer<typeof GoalStatus>

/**
 * A `Guardrail` is a single statement of what work lies inside or outside the
 * envelope. `kind` distinguishes positive constraints ("within envelope")
 * from negative constraints ("outside envelope"). `tags` optionally key the
 * guardrail to the domain(s) it applies to — absent tags means it applies
 * to every task under this goal.
 *
 * The `description` is the operative text a coordinator reads when deciding
 * whether a task fits. Guardrails are human-authored during meta-intake;
 * agents never synthesize them silently. An agent may *propose* a new
 * guardrail via the normal proposal flow, but the user approves it.
 */
export const Guardrail = z.object({
  id: z.string().min(1),
  kind: z.enum(['include', 'exclude']),
  description: z.string().min(1),
  tags: z.array(z.string()).default([]),
})
export type Guardrail = z.infer<typeof Guardrail>

export const Goal = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),

  /**
   * Human-readable success condition — the concrete observable state the
   * goal is chasing. Mirrors a task's `acceptanceCriteria` but at the
   * goal-level granularity.
   */
  successCondition: z.string().min(1),

  /** List of guardrails scoping work inside / outside this goal's envelope. */
  guardrails: z.array(Guardrail).default([]),

  status: GoalStatus.default('active'),

  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Goal = z.infer<typeof Goal>

/**
 * GOALS.json — canonical storage alongside TASKS.json. Mirrors the TaskQueue
 * shape so the orchestrator can read/write it with the same primitives.
 */
export const GoalBook = z.object({
  version: z.literal(1).default(1),
  lastUpdated: z.string(),
  goals: z.array(Goal).default([]),
})
export type GoalBook = z.infer<typeof GoalBook>

export const GOALS_FILENAME = 'GOALS.json'
