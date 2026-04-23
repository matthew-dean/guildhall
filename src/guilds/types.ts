import type { Task, DesignSystem, SoftGateRubricItem } from '@guildhall/core'

/**
 * A **Guild** is an expert persona bundle — a named domain of expertise with
 * opinionated principles (prose for the worker), a review rubric (questions
 * for the reviewer), and deterministic checks (pure functions the gate
 * checker can run). At dispatch time the registry picks the guilds whose
 * `applicable()` predicate matches the task + project, and their artifacts
 * are woven into the worker prompt, reviewer context, and gate suite.
 */
/**
 * What this persona does in the lifecycle:
 *  - `engineer`   — builds code at `in_progress`. May also review in their
 *                   own lane (a TypeScript Engineer reviewing TS code).
 *  - `designer`   — contributes to the spec at `exploring` and verifies the
 *                   build at `review`. Never writes code.
 *  - `specialist` — reviews at `review`. Typically ships deterministic
 *                   checks that run at `gate_check` (e.g. Accessibility
 *                   Specialist's contrast matrix).
 *  - `overseer`   — watches the whole lifecycle (PM). Not a builder or
 *                   per-lane reviewer.
 */
export type GuildRole = 'engineer' | 'designer' | 'specialist' | 'overseer'

export interface GuildDefinition {
  /** URL-safe identifier, e.g. "accessibility-specialist". */
  slug: string
  /** Human-facing display name, e.g. "The Accessibility Specialist". */
  name: string
  /** One-line description used in registry listings and context summaries. */
  blurb: string
  /** Where this persona fits in the lifecycle. */
  role: GuildRole
  /**
   * First-person principles prose. How this persona thinks and what they
   * care about. Used as the system prompt when this persona runs as its own
   * agent (reviewer fan-out, spec co-authoring). Kept compact (target 200–
   * 500 words) so it fits on local models.
   */
  principles: string
  /**
   * A prompt fragment the Spec Agent appends to its elicitation context
   * when this persona applies to the task. Designers and specialists use
   * this to make sure their load-bearing questions get answered *in the
   * spec* (component API shape, palette role, a11y requirements, voice) —
   * the engineer builds to whatever lands here, so anything missing becomes
   * an engineer's guess. Engineers typically omit this: their job is to
   * build to the spec, not author it.
   */
  specContribution?: string
  /**
   * Optional rubric items this persona runs during its own review pass at
   * `review`. Each applicable expert produces an independent ReviewVerdict
   * tagged with `guildSlug`; the task advances to `gate_check` only when
   * all of them approve (policy governed by a future lever).
   */
  rubric?: SoftGateRubricItem[]
  /**
   * Deterministic checks — pure functions over the task/design-system/project
   * signals. Callers (gate checker, reviewer fallback) can invoke each
   * independently. Empty array means "no automated checks yet — rubric only."
   */
  deterministicChecks: DeterministicCheck[]
  /**
   * Applicability predicate. Return `true` iff this guild should sit at the
   * table for the given task. Cheap, pure, side-effect-free.
   */
  applicable(signals: GuildSignals): boolean
  /**
   * Optional principles specialization. A guild may vary its rendered prose
   * based on per-task or per-project context — e.g. the PM prepends a
   * status-specific playbook, the Frontend Engineer selects framework-
   * specific principles (Vue / React / Svelte) from `package.json` signals.
   * Return `null` to use `principles` verbatim.
   */
  specializePrinciples?(signals: GuildSignals): string | null
}

/** Inputs to `applicable()` and `specializePrinciples()`. Extend sparingly. */
export interface GuildSignals {
  task: Task
  designSystem?: DesignSystem | undefined
  /** The memoryDir, so guilds can read overrides like any other layer. */
  memoryDir: string
  /** Project root (worktree root). For checks that need filesystem access. */
  projectPath: string
}

/**
 * A deterministic check is a pure function with a stable id. The gate-check
 * subsystem can run these directly; the reviewer (under `deterministic_only`
 * or `llm_with_deterministic_fallback`) consults results alongside soft-gate
 * rubric scores.
 */
export interface DeterministicCheck {
  id: string
  description: string
  /** Runs sync or async. Must not throw — return a failing result instead. */
  run(input: CheckInput): CheckResult | Promise<CheckResult>
}

export interface CheckInput {
  task: Task
  designSystem?: DesignSystem | undefined
  memoryDir: string
  projectPath: string
}

export interface CheckResult {
  checkId: string
  pass: boolean
  /** One-line machine-parseable summary. */
  summary: string
  /** Optional longer detail (e.g. failing pairs with actual vs required). */
  detail?: string
  /** Suggested remediation items a worker can act on. */
  suggestions?: string[]
}
