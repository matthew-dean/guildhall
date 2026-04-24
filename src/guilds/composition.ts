import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { z } from 'zod'

import type { GuildDefinition, GuildRole, GuildSignals } from './types.js'
import { BUILTIN_GUILDS } from './registry.js'

/**
 * Declarative composition via `<memoryDir>/guilds.yaml`. Lets a project
 * shape its roster without writing TS:
 *
 *   enabled:          # optional allowlist; omitted = all applicable
 *     - project-manager
 *     - frontend-engineer
 *     - component-designer
 *   disabled:         # optional blocklist (wins over enabled)
 *     - performance-engineer
 *   custom:           # optional per-project personas
 *     - slug: vue-ecommerce-frontend
 *       name: The Vue/E-commerce Frontend Engineer
 *       extends: frontend-engineer     # inherits rubric + applicable + specialize
 *       additionalPrinciples: |        # appended to base principles
 *         We use Pinia for state, VueUse for composables.
 *         Commerce pages must be SSR-clean.
 *       specContribution: |            # replaces base spec-contribution
 *         For commerce tasks, answer SSR/SPA, cart storage, session strategy.
 *     - slug: house-copy
 *       name: The House Copy Lead
 *       extends: copywriter
 *       overridePrinciples: |          # replaces base principles entirely
 *         I enforce our house voice. Plain, warm, brief. No "please."
 *
 * `enabled` + `disabled` filter the BUILTIN_GUILDS list. `custom` entries
 * append to the result; a custom slug that shadows a built-in wins.
 */

const CustomGuildSchema = z.object({
  slug: z.string().min(1),
  name: z.string().optional(),
  blurb: z.string().optional(),
  role: z.enum(['engineer', 'designer', 'specialist', 'overseer']).optional(),
  extends: z.string().optional(),
  additionalPrinciples: z.string().optional(),
  overridePrinciples: z.string().optional(),
  specContribution: z.string().optional(),
})
export type CustomGuildSpec = z.infer<typeof CustomGuildSchema>

const GuildsYamlSchema = z.object({
  enabled: z.array(z.string()).optional(),
  disabled: z.array(z.string()).optional(),
  custom: z.array(CustomGuildSchema).optional(),
})
export type GuildsYaml = z.infer<typeof GuildsYamlSchema>

export interface LoadedComposition {
  /** The raw file contents (parsed), or null if no file. */
  spec: GuildsYaml | null
  /** Any parse / schema errors that made the file unusable. */
  errors: string[]
}

/**
 * Read `<memoryDir>/guilds.yaml`. Missing file returns `{spec: null}`.
 * Malformed files return an empty `spec` with errors populated — callers
 * should surface these as warnings and fall back to the built-in roster.
 */
export function loadGuildComposition(memoryDir: string): LoadedComposition {
  const path = join(memoryDir, 'guilds.yaml')
  if (!existsSync(path)) return { spec: null, errors: [] }
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    return {
      spec: null,
      errors: [`read ${path}: ${err instanceof Error ? err.message : String(err)}`],
    }
  }
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch (err) {
    return {
      spec: null,
      errors: [`parse ${path}: ${err instanceof Error ? err.message : String(err)}`],
    }
  }
  if (parsed === null || parsed === undefined) return { spec: null, errors: [] }
  const result = GuildsYamlSchema.safeParse(parsed)
  if (!result.success) {
    return {
      spec: null,
      errors: result.error.errors.map(
        (e) => `${e.path.join('.') || '<root>'}: ${e.message}`,
      ),
    }
  }
  return { spec: result.data, errors: [] }
}

/**
 * Apply a composition spec to the built-in roster, producing the project's
 * effective roster. Custom guilds that reference an unknown `extends` slug
 * fall back to treating the custom entry as standalone — we log the issue
 * but don't throw so a typo doesn't brick the project.
 */
export function composeGuildRoster(
  spec: GuildsYaml,
  base: readonly GuildDefinition[] = BUILTIN_GUILDS,
): { guilds: GuildDefinition[]; warnings: string[] } {
  const warnings: string[] = []
  const bySlug = new Map(base.map((g) => [g.slug, g]))

  const enabled = spec.enabled ? new Set(spec.enabled) : null
  const disabled = new Set(spec.disabled ?? [])

  const filtered = base.filter((g) => {
    if (disabled.has(g.slug)) return false
    if (enabled && !enabled.has(g.slug)) return false
    return true
  })

  if (enabled) {
    for (const slug of enabled) {
      if (!bySlug.has(slug) && !(spec.custom ?? []).some((c) => c.slug === slug)) {
        warnings.push(`enabled slug "${slug}" is not a known guild`)
      }
    }
  }

  const custom = (spec.custom ?? []).map((c): GuildDefinition => {
    if (c.extends) {
      const baseGuild = bySlug.get(c.extends)
      if (!baseGuild) {
        warnings.push(
          `custom guild "${c.slug}" extends unknown base "${c.extends}"; treating as standalone`,
        )
        return buildStandaloneCustom(c)
      }
      return buildExtendedCustom(c, baseGuild)
    }
    return buildStandaloneCustom(c)
  })

  // Custom entries win over built-ins on slug collision.
  const customSlugs = new Set(custom.map((c) => c.slug))
  const merged = [...filtered.filter((g) => !customSlugs.has(g.slug)), ...custom]
  return { guilds: merged, warnings }
}

function buildExtendedCustom(
  c: CustomGuildSpec,
  base: GuildDefinition,
): GuildDefinition {
  const principles = c.overridePrinciples
    ? c.overridePrinciples.trim()
    : c.additionalPrinciples
      ? [base.principles.trim(), '', c.additionalPrinciples.trim()].join('\n')
      : base.principles
  const rubric = base.rubric
  const specContribution =
    c.specContribution !== undefined ? c.specContribution.trim() : base.specContribution
  return {
    slug: c.slug,
    name: c.name ?? base.name,
    role: c.role ?? base.role,
    blurb: c.blurb ?? base.blurb,
    principles,
    ...(specContribution ? { specContribution } : {}),
    ...(rubric ? { rubric } : {}),
    deterministicChecks: base.deterministicChecks,
    applicable: base.applicable,
    ...(base.specializePrinciples
      ? {
          specializePrinciples: (signals: GuildSignals) =>
            base.specializePrinciples!(signals),
        }
      : {}),
  }
}

function buildStandaloneCustom(c: CustomGuildSpec): GuildDefinition {
  const role: GuildRole = c.role ?? 'specialist'
  const principles = (c.overridePrinciples ?? c.additionalPrinciples ?? '').trim()
  return {
    slug: c.slug,
    name: c.name ?? c.slug,
    role,
    blurb: c.blurb ?? `Custom persona: ${c.slug}`,
    principles,
    ...(c.specContribution ? { specContribution: c.specContribution.trim() } : {}),
    deterministicChecks: [],
    applicable: () => true,
  }
}

/**
 * One-shot: load composition from disk and produce the effective roster.
 * Falls back to BUILTIN_GUILDS unchanged when no file is present; surfaces
 * parse errors and composition warnings so the caller can log them.
 */
export function loadProjectGuildRoster(memoryDir: string): {
  guilds: readonly GuildDefinition[]
  warnings: string[]
} {
  const { spec, errors } = loadGuildComposition(memoryDir)
  if (!spec) {
    return { guilds: BUILTIN_GUILDS, warnings: errors }
  }
  const { guilds, warnings } = composeGuildRoster(spec)
  return { guilds, warnings: [...errors, ...warnings] }
}
