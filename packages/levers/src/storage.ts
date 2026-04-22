/**
 * Read / write `memory/agent-settings.yaml`.
 *
 * The file is the single source of truth for lever positions. On first read,
 * if the file is missing, we seed it with `makeDefaultSettings()` and write
 * it — so every lever always has a provenance entry, even before the Spec
 * Agent has run.
 *
 * Malformed YAML or schema-invalid content throws, matching the posture set
 * by the other storage modules: "missing is a normal state, corrupt is a
 * bug the user must fix."
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import * as v from 'valibot'

import { makeDefaultSettings } from './defaults.js'
import {
  type DomainLevers,
  type LeverSettings,
  type ProjectLevers,
  leverSettingsSchema,
  domainLeversSchema,
} from './schema.js'

export const AGENT_SETTINGS_FILENAME = 'agent-settings.yaml'

export interface LoadOptions {
  /** Full path to the agent-settings.yaml file. */
  path: string
  /** Override clock — primarily for tests. */
  now?: () => Date
}

export class LeverSettingsCorruptError extends Error {
  constructor(path: string, detail: string) {
    super(`Lever settings at ${path} are corrupt: ${detail}`)
    this.name = 'LeverSettingsCorruptError'
  }
}

export async function loadLeverSettings(opts: LoadOptions): Promise<LeverSettings> {
  let raw: string
  try {
    raw = await fs.readFile(opts.path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      const seeded = makeDefaultSettings(opts.now?.())
      await saveLeverSettings({ path: opts.path, settings: seeded })
      return seeded
    }
    throw err
  }
  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch (err) {
    throw new LeverSettingsCorruptError(opts.path, (err as Error).message)
  }
  const result = v.safeParse(leverSettingsSchema, parsed)
  if (!result.success) {
    throw new LeverSettingsCorruptError(
      opts.path,
      result.issues.map((i) => `${i.path?.map((p) => p.key).join('.') ?? '<root>'}: ${i.message}`).join('; '),
    )
  }
  return result.output
}

/**
 * Re-validate an in-memory LeverSettings object against the schema. Used by
 * callers (e.g. Spec Agent lever-inference merge) that mutate the object
 * after loading and want to fail fast if the mutations produced an invalid
 * shape.
 */
export function validateLeverSettings(settings: LeverSettings): LeverSettings {
  const parsed = v.safeParse(leverSettingsSchema, settings)
  if (!parsed.success) {
    const detail = parsed.issues
      .map((i) => `${i.path?.map((p) => p.key).join('.') ?? '<root>'}: ${i.message}`)
      .join('; ')
    throw new LeverSettingsCorruptError('<in-memory>', detail)
  }
  return parsed.output
}

export interface SaveOptions {
  path: string
  settings: LeverSettings
}

export async function saveLeverSettings(opts: SaveOptions): Promise<void> {
  await fs.mkdir(dirname(opts.path), { recursive: true })
  const yaml = stringifyYaml(opts.settings, {
    // Stable key ordering is not guaranteed by `yaml`, but for a
    // human-readable-first file we accept the library's default (insertion
    // order). If we need sort stability later we can pipe through a
    // comparator.
    lineWidth: 100,
  })
  await fs.writeFile(opts.path, yaml, 'utf8')
}

/**
 * Resolve effective domain levers for a named domain: start from `default`,
 * then apply any per-domain overrides from `domains.overrides[<domain>]`.
 *
 * Overrides are validated against the DomainLevers schema per-field as they
 * are merged, so a typo in an override file surfaces as a clear error here
 * rather than a silent fallthrough to the default.
 */
export function resolveDomainLevers(
  settings: LeverSettings,
  domainName: string,
): DomainLevers {
  const base = settings.domains.default
  if (domainName === 'default') return base
  const override = settings.domains.overrides?.[domainName]
  if (!override) return base
  const merged = { ...base, ...override }
  const result = v.safeParse(domainLeversSchema, merged)
  if (!result.success) {
    throw new LeverSettingsCorruptError(
      `<overrides.${domainName}>`,
      result.issues.map((i) => `${i.path?.map((p) => p.key).join('.') ?? '<root>'}: ${i.message}`).join('; '),
    )
  }
  return result.output
}

/**
 * Convenience: resolve a single project-scope lever entry.
 */
export function projectLever<K extends keyof ProjectLevers>(
  settings: LeverSettings,
  name: K,
): ProjectLevers[K] {
  return settings.project[name]
}

/**
 * Default path helper for a given project root. Mirrors the
 * `memory/agent-settings.yaml` convention from FR-08 and §2.1.
 */
export function defaultAgentSettingsPath(projectRoot: string): string {
  return join(projectRoot, 'memory', AGENT_SETTINGS_FILENAME)
}
