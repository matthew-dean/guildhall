import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GuildDefinition, GuildSignals, CheckResult, GuildRole } from './types.js'
import { projectManagerGuild } from './project-manager/index.js'
import { componentDesignerGuild } from './component-designer/index.js'
import { visualDesignerGuild } from './visual-designer/index.js'
import { copywriterGuild } from './copywriter/index.js'
import { colorTheoristGuild } from './color-theorist/index.js'
import { apiDesignerGuild } from './api-designer/index.js'
import { accessibilitySpecialistGuild } from './accessibility-specialist/index.js'
import { securityEngineerGuild } from './security-engineer/index.js'
import { testEngineerGuild } from './test-engineer/index.js'
import { performanceEngineerGuild } from './performance-engineer/index.js'
import { frontendEngineerGuild } from './frontend-engineer/index.js'
import { backendEngineerGuild } from './backend-engineer/index.js'
import { typescriptEngineerGuild } from './typescript-engineer/index.js'

/**
 * The built-in guild roster. Order is the order they appear at the table
 * when multiple apply — the Project Manager opens, domain experts follow,
 * language/framework experts close. Projects can shadow any entry later via
 * `memory/guilds/<slug>/…`.
 */
export const BUILTIN_GUILDS: readonly GuildDefinition[] = [
  // Overseer first — always at the table.
  projectManagerGuild,
  // Designers — contribute to specs + review.
  componentDesignerGuild,
  visualDesignerGuild,
  copywriterGuild,
  colorTheoristGuild,
  apiDesignerGuild,
  // Specialists — author spec requirements + review + deterministic checks.
  accessibilitySpecialistGuild,
  securityEngineerGuild,
  testEngineerGuild,
  performanceEngineerGuild,
  // Engineers — build to spec. Ordering here affects `pickPrimaryEngineer`
  // ties; explicit specificity scores in that resolver take precedence.
  frontendEngineerGuild,
  backendEngineerGuild,
  typescriptEngineerGuild,
]

/** Return every guild whose `applicable()` predicate matches the signals. */
export function selectApplicableGuilds(
  signals: GuildSignals,
  roster: readonly GuildDefinition[] = BUILTIN_GUILDS,
): GuildDefinition[] {
  return roster.filter((g) => {
    try {
      return g.applicable(signals)
    } catch {
      return false
    }
  })
}

/** Filter the applicable guild list to just those with a given role. */
export function guildsByRole(
  guilds: readonly GuildDefinition[],
  role: GuildRole,
): GuildDefinition[] {
  return guilds.filter((g) => g.role === role)
}

/**
 * Resolve the single engineer persona whose voice should be in the worker's
 * system prompt at `in_progress`. Preference order:
 *  1. An explicit task hint (e.g. `task.assignedGuild`) — not implemented yet
 *     but hook left here so the Spec Agent / coordinator can route.
 *  2. The most specific applicable engineer — Frontend Engineer beats
 *     TypeScript Engineer when both apply, because frontend work is more
 *     narrowly scoped than "it's a TS project."
 *  3. The first applicable engineer.
 * Returns `null` when no engineer applies — the worker runs as its generic
 * self in that case.
 */
const ENGINEER_SPECIFICITY: Record<string, number> = {
  'frontend-engineer': 10,
  'backend-engineer': 10,
  'typescript-engineer': 1,
}
export function pickPrimaryEngineer(
  guilds: readonly GuildDefinition[],
): GuildDefinition | null {
  const engineers = guildsByRole(guilds, 'engineer')
  if (engineers.length === 0) return null
  const scored = engineers
    .map((g) => ({ g, score: ENGINEER_SPECIFICITY[g.slug] ?? 0 }))
    .sort((a, b) => b.score - a.score)
  return scored[0]?.g ?? null
}

/**
 * Resolve a guild's principles, honoring per-project overrides. Precedence:
 *   1. `<memoryDir>/guilds/<slug>/principles.md` — project-specific voice.
 *   2. `guild.specializePrinciples(signals)` — dynamic specialization (e.g.
 *      Project Manager's status-specific playbooks, Frontend Engineer's
 *      framework layer).
 *   3. `guild.principles` — the bundled default loaded at module import.
 *
 * Projects can shadow any persona without touching TS — drop a file at
 * `memory/guilds/<slug>/principles.md` and the next dispatch picks it up.
 */
export function resolvePrinciples(
  guild: GuildDefinition,
  signals: GuildSignals,
): string {
  const override = readOverridePrinciples(guild.slug, signals.memoryDir)
  if (override) return override
  const specialized = guild.specializePrinciples?.(signals) ?? null
  return specialized ?? guild.principles
}

function readOverridePrinciples(
  slug: string,
  memoryDir: string | undefined,
): string | null {
  if (!memoryDir) return null
  const override = join(memoryDir, 'guilds', slug, 'principles.md')
  if (!existsSync(override)) return null
  try {
    const body = readFileSync(override, 'utf8').trim()
    return body.length > 0 ? body : null
  } catch {
    return null
  }
}

/**
 * Render a single persona's principles as a system-prompt additive. Used to
 * attach a specific engineer's voice to the worker at `in_progress`, or to
 * attach a single reviewer persona to a specialized reviewer agent at
 * `review`. Never concatenates multiple personas — that was the previous
 * "experts at the table" mistake.
 */
export function renderPersonaPrompt(
  guild: GuildDefinition,
  signals: GuildSignals,
): string {
  const body = resolvePrinciples(guild, signals).trim()
  return [`## Persona: ${guild.name}`, '', body].join('\n')
}

/**
 * Resolve a guild's spec contribution, honoring a project override at
 * `<memoryDir>/guilds/<slug>/spec-contribution.md`. Returns null if neither
 * the override nor the bundled field is present.
 */
export function resolveSpecContribution(
  guild: GuildDefinition,
  signals: GuildSignals,
): string | null {
  if (signals.memoryDir) {
    const override = join(
      signals.memoryDir,
      'guilds',
      guild.slug,
      'spec-contribution.md',
    )
    if (existsSync(override)) {
      try {
        const body = readFileSync(override, 'utf8').trim()
        if (body.length > 0) return body
      } catch {
        // fall through
      }
    }
  }
  const bundled = guild.specContribution?.trim()
  return bundled && bundled.length > 0 ? bundled : null
}

/**
 * Render every applicable **designer** and **specialist** persona's
 * `specContribution` into a single block the Spec Agent appends to its
 * elicitation context at `exploring`. Each expert weighs in on what the
 * spec must cover from their perspective — the engineer then builds to
 * whatever lands in the spec. Engineers and overseers are omitted (they
 * don't shape the spec; they execute or watch it).
 */
export function renderSpecContributions(
  guilds: readonly GuildDefinition[],
  signals: GuildSignals,
): string {
  const contributors = guilds.filter(
    (g) => g.role === 'designer' || g.role === 'specialist',
  )
  const resolved = contributors
    .map((g) => ({ guild: g, body: resolveSpecContribution(g, signals) }))
    .filter((x): x is { guild: GuildDefinition; body: string } => x.body !== null)
  if (resolved.length === 0) return ''
  const blocks: string[] = [
    '## Expert contributions to the spec',
    '',
    'Each expert below has requirements that must be answered *in the spec* before the engineer starts building. Missing answers mean escalations later.',
    '',
  ]
  for (const { guild, body } of resolved) {
    blocks.push(`### ${guild.name}`)
    blocks.push('')
    blocks.push(body)
    blocks.push('')
    blocks.push('---')
    blocks.push('')
  }
  while (blocks.length > 0 && (blocks.at(-1) === '---' || blocks.at(-1) === '')) {
    blocks.pop()
  }
  return blocks.join('\n')
}

/**
 * The reviewer pass fans out: one agent per applicable reviewer-capable
 * persona (designers, specialists, engineers-in-their-own-lane, and the
 * overseer). Returns the personas that should each produce an independent
 * `ReviewVerdict`.
 */
export function reviewersForTask(
  guilds: readonly GuildDefinition[],
): GuildDefinition[] {
  return guilds.filter((g) => g.rubric && g.rubric.length > 0)
}

/**
 * Flatten all applicable guild rubrics into a list for the reviewer. Each
 * item is tagged with its guild slug so the reviewer's verdict record can
 * attribute the question back.
 */
export interface TaggedRubricItem {
  guildSlug: string
  guildName: string
  id: string
  question: string
  weight: number
}

export function collectGuildRubrics(
  guilds: readonly GuildDefinition[],
): TaggedRubricItem[] {
  const out: TaggedRubricItem[] = []
  for (const g of guilds) {
    if (!g.rubric) continue
    for (const item of g.rubric) {
      out.push({
        guildSlug: g.slug,
        guildName: g.name,
        id: item.id,
        question: item.question,
        weight: item.weight,
      })
    }
  }
  return out
}

/**
 * Run every deterministic check from every applicable guild in parallel.
 * Failures are captured as check results rather than thrown — the caller
 * (gate-check runner / reviewer fallback) gets a full picture.
 */
export async function runGuildDeterministicChecks(
  guilds: readonly GuildDefinition[],
  signals: GuildSignals,
): Promise<CheckResult[]> {
  const runs: Promise<CheckResult>[] = []
  for (const g of guilds) {
    for (const check of g.deterministicChecks) {
      runs.push(
        Promise.resolve()
          .then(() => check.run(signals))
          .catch(
            (err): CheckResult => ({
              checkId: check.id,
              pass: false,
              summary: 'check threw',
              detail: err instanceof Error ? err.message : String(err),
            }),
          ),
      )
    }
  }
  return Promise.all(runs)
}
