/**
 * Guildhall's "guilds" — the named expert personas who sit at the table
 * when a task is dispatched. Each guild combines:
 *   - first-person principles prose (steers the worker)
 *   - a weighted rubric (steers the reviewer)
 *   - deterministic checks (steer the gate checker)
 *   - an applicability predicate (decides whether this expert cares)
 *
 * Applicable guilds are resolved per-task via `selectApplicableGuilds` and
 * woven into the JIT context by @guildhall/runtime's context-builder.
 */

export type {
  GuildDefinition,
  GuildSignals,
  GuildRole,
  DeterministicCheck,
  CheckInput,
  CheckResult,
} from './types.js'

export {
  BUILTIN_GUILDS,
  selectApplicableGuilds,
  guildsByRole,
  pickPrimaryEngineer,
  renderPersonaPrompt,
  resolvePrinciples,
  renderSpecContributions,
  resolveSpecContribution,
  reviewersForTask,
  collectGuildRubrics,
  runGuildDeterministicChecks,
  type TaggedRubricItem,
} from './registry.js'

export {
  loadGuildComposition,
  composeGuildRoster,
  loadProjectGuildRoster,
  type GuildsYaml,
  type CustomGuildSpec,
  type LoadedComposition,
} from './composition.js'

export {
  contrastRatio,
  contrastRatioFromStrings,
  relativeLuminance,
  parseColor,
  checkContrast,
  minimumContrast,
  type RGB,
  type WcagLevel,
  type TextSize,
  type ContrastCheckResult,
} from './wcag.js'
