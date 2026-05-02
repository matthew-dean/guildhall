import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { load as yamlLoad } from 'js-yaml'
import { z } from 'zod'
import { guildhallHomeDir, ensureGuildhallHome } from './global-config.js'

// ---------------------------------------------------------------------------
// Global provider store — ~/.guildhall/providers.yaml
//
// Providers are *machine-scoped*, not project-scoped. The same Anthropic API
// key, OpenAI API key, and llama.cpp URL apply to every Guildhall project on
// this machine. Projects pick which of the configured providers they prefer
// (via `preferredProvider` in guildhall.yaml) but do NOT carry their own
// copies of the credentials.
//
// OAuth-managed providers (Claude, Codex) live in their respective CLI dirs
// (`~/.claude/.credentials.json`, `~/.codex/auth.json`) and are NOT persisted
// here — we only record a "last verified" marker so the UI can show a
// reassuring green check even before the orchestrator boots.
//
// Precedence for credential resolution at runtime (high → low):
//   1. Explicit orchestrator option (used by tests / forced overrides)
//   2. Environment variable (ANTHROPIC_API_KEY, OPENAI_API_KEY, LLAMA_CPP_URL)
//   3. Global store (this file)
//   4. Legacy project-local config.yaml (migrated away on first read)
//   5. Not configured
// ---------------------------------------------------------------------------

export const GLOBAL_PROVIDERS_FILENAME = 'providers.yaml'

export function globalProvidersPath(): string {
  return join(guildhallHomeDir(), GLOBAL_PROVIDERS_FILENAME)
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const anthropicApiSchema = z.object({
  apiKey: z.string().min(1),
  verifiedAt: z.string().optional(),
})
const openaiApiSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url().optional(),
  verifiedAt: z.string().optional(),
})
const llamaCppSchema = z.object({
  url: z.string().url(),
  verifiedAt: z.string().optional(),
})
// OAuth providers: we do not persist the credential (the CLI owns that file);
// we only record that the user acknowledged the connection here.
const oauthSchema = z.object({
  verifiedAt: z.string().optional(),
})

export const GlobalProvidersSchema = z.object({
  version: z.literal(1).default(1),
  providers: z.preprocess(
    (value) => (value == null ? {} : value),
    z.object({
      'anthropic-api': anthropicApiSchema.optional(),
      'openai-api': openaiApiSchema.optional(),
      'llama-cpp': llamaCppSchema.optional(),
      'claude-oauth': oauthSchema.optional(),
      'codex-oauth': oauthSchema.optional(),
    })
      .default({}),
  ),
})

export type GlobalProviders = z.infer<typeof GlobalProvidersSchema>
export type ProviderKind = keyof NonNullable<GlobalProviders['providers']>

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

export function readGlobalProviders(): GlobalProviders {
  const path = globalProvidersPath()
  if (!existsSync(path)) return GlobalProvidersSchema.parse({})
  let raw: unknown
  try {
    raw = yamlLoad(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${String(err)}`)
  }
  const result = GlobalProvidersSchema.safeParse(raw ?? {})
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid ${path}:\n${issues}`)
  }
  return result.data
}

export function writeGlobalProviders(next: GlobalProviders): void {
  ensureGuildhallHome()
  const validated = GlobalProvidersSchema.parse(next)
  const path = globalProvidersPath()
  const homeDir = guildhallHomeDir()
  if (!existsSync(homeDir)) mkdirSync(homeDir, { recursive: true })
  writeFileSync(path, renderGlobalProvidersYaml(validated), 'utf8')
  // Credentials live here — tighten perms so ps auditors and nosy
  // process-listing tools can't read it. Best-effort: some filesystems
  // (FAT, certain CI containers) don't honor chmod; we ignore failures.
  try {
    chmodSync(path, 0o600)
  } catch {
    /* best-effort */
  }
}

function quote(value: string): string {
  return JSON.stringify(value)
}

function renderGlobalProvidersYaml(next: GlobalProviders): string {
  const p = next.providers
  const lines: string[] = [
    '# Global LLM provider credentials for Guildhall.',
    '# Leave OpenAI-compatible baseUrl blank in the UI to use real OpenAI.',
    'version: 1',
    'providers:',
  ]

  if (p['claude-oauth']) {
    lines.push('  claude-oauth:')
    if (p['claude-oauth'].verifiedAt) {
      lines.push(`    verifiedAt: ${quote(p['claude-oauth'].verifiedAt)}`)
    }
  } else {
    lines.push('  # claude-oauth:')
    lines.push('  #   verifiedAt: "2026-05-02T00:00:00.000Z"')
  }

  if (p['codex-oauth']) {
    lines.push('  codex-oauth:')
    if (p['codex-oauth'].verifiedAt) {
      lines.push(`    verifiedAt: ${quote(p['codex-oauth'].verifiedAt)}`)
    }
  } else {
    lines.push('  # codex-oauth:')
    lines.push('  #   verifiedAt: "2026-05-02T00:00:00.000Z"')
  }

  if (p['anthropic-api']) {
    lines.push('  anthropic-api:')
    lines.push(`    apiKey: ${quote(p['anthropic-api'].apiKey)}`)
    if (p['anthropic-api'].verifiedAt) {
      lines.push(`    verifiedAt: ${quote(p['anthropic-api'].verifiedAt)}`)
    }
  } else {
    lines.push('  # anthropic-api:')
    lines.push('  #   apiKey: "sk-ant-..."')
  }

  if (p['openai-api']) {
    lines.push('  openai-api:')
    lines.push(`    apiKey: ${quote(p['openai-api'].apiKey)}`)
    if (p['openai-api'].baseUrl) {
      lines.push(`    baseUrl: ${quote(p['openai-api'].baseUrl)}`)
    } else {
      lines.push('    # baseUrl: "https://api.openai.com/v1"')
    }
    if (p['openai-api'].verifiedAt) {
      lines.push(`    verifiedAt: ${quote(p['openai-api'].verifiedAt)}`)
    }
  } else {
    lines.push('  # openai-api:')
    lines.push('  #   apiKey: "sk-..."')
    lines.push('  #   baseUrl: "https://api.openai.com/v1"')
  }

  if (p['llama-cpp']) {
    lines.push('  llama-cpp:')
    lines.push(`    url: ${quote(p['llama-cpp'].url)}`)
    if (p['llama-cpp'].verifiedAt) {
      lines.push(`    verifiedAt: ${quote(p['llama-cpp'].verifiedAt)}`)
    }
  } else {
    lines.push('  # llama-cpp:')
    lines.push('  #   url: "http://localhost:1234/v1"')
  }

  lines.push('')
  return lines.join('\n')
}

/**
 * Set a single provider entry, preserving other entries. Returns the new
 * full providers file.
 */
export function setProvider<K extends ProviderKind>(
  kind: K,
  value: NonNullable<GlobalProviders['providers'][K]>,
): GlobalProviders {
  const current = readGlobalProviders()
  const next: GlobalProviders = {
    ...current,
    providers: { ...current.providers, [kind]: value },
  }
  writeGlobalProviders(next)
  return next
}

/**
 * Remove a single provider entry. No-op if already absent.
 */
export function removeProvider(kind: ProviderKind): GlobalProviders {
  const current = readGlobalProviders()
  const providers = { ...current.providers }
  delete providers[kind]
  const next: GlobalProviders = { ...current, providers }
  writeGlobalProviders(next)
  return next
}

/**
 * Record a verification timestamp for a provider without changing its
 * credential material. Used after a successful test-message roundtrip.
 */
export function markProviderVerified(
  kind: ProviderKind,
  when: string = new Date().toISOString(),
): GlobalProviders {
  const current = readGlobalProviders()
  const existing = current.providers[kind]
  if (!existing) {
    // For OAuth kinds we create a bare entry — the credential is external.
    if (kind === 'claude-oauth' || kind === 'codex-oauth') {
      return setProvider(kind, { verifiedAt: when })
    }
    // For credentialed kinds, marking verified without material is
    // meaningless; silently no-op so callers don't have to branch.
    return current
  }
  const next: GlobalProviders = {
    ...current,
    providers: {
      ...current.providers,
      [kind]: { ...existing, verifiedAt: when },
    },
  }
  writeGlobalProviders(next)
  return next
}

// ---------------------------------------------------------------------------
// Resolution helpers (used by the orchestrator + /api/providers UI)
// ---------------------------------------------------------------------------

export interface ResolvedProviderCredentials {
  anthropicApiKey?: string
  openaiApiKey?: string
  openaiBaseUrl?: string
  llamaCppUrl?: string
}

/**
 * One-time migration: move provider credentials out of a project's local
 * config and into the global store. Idempotent — if the global store
 * already has a value, the project copy is still stripped (global wins).
 *
 * Returns a summary of what moved so the caller can surface it in the UI.
 */
export interface MigrationReport {
  movedAnthropic: boolean
  movedOpenAi: boolean
  movedLlamaUrl: boolean
}

export function migrateProjectProvidersToGlobal(
  projectPath: string,
  deps: {
    readProject: (p: string) => {
      anthropicApiKey?: string | undefined
      openaiApiKey?: string | undefined
      lmStudioUrl?: string | undefined
    }
    writeProject: (p: string, patch: Record<string, unknown>) => void
  },
): MigrationReport {
  const local = deps.readProject(projectPath)
  const report: MigrationReport = {
    movedAnthropic: false,
    movedOpenAi: false,
    movedLlamaUrl: false,
  }
  const current = readGlobalProviders()
  let touchedGlobal = false
  const patch: Record<string, unknown> = {}

  const a = (local.anthropicApiKey ?? '').trim()
  if (a) {
    if (!current.providers['anthropic-api']) {
      setProvider('anthropic-api', { apiKey: a })
      touchedGlobal = true
    }
    patch['anthropicApiKey'] = undefined
    report.movedAnthropic = true
  }
  const o = (local.openaiApiKey ?? '').trim()
  if (o) {
    if (!current.providers['openai-api']) {
      setProvider('openai-api', { apiKey: o })
      touchedGlobal = true
    }
    patch['openaiApiKey'] = undefined
    report.movedOpenAi = true
  }
  // lmStudioUrl has a schema default ('http://localhost:1234/v1') so we
  // only migrate values that were explicitly customized (not the default).
  const l = (local.lmStudioUrl ?? '').trim()
  if (l && l !== 'http://localhost:1234/v1') {
    if (!current.providers['llama-cpp']) {
      setProvider('llama-cpp', { url: l })
      touchedGlobal = true
    }
    patch['lmStudioUrl'] = undefined
    report.movedLlamaUrl = true
  }

  if (touchedGlobal || Object.keys(patch).length > 0) {
    // Strip the migrated keys from the project file by writing an explicit
    // undefined — callers use a partial merge so this removes them.
    deps.writeProject(projectPath, patch)
  }
  return report
}

/**
 * Resolve effective credentials for this machine, combining environment
 * variables (highest precedence) with the global store. Env vars win so
 * CI / ephemeral overrides keep working without editing the file.
 */
export function resolveGlobalCredentials(
  providers: GlobalProviders = readGlobalProviders(),
  env: NodeJS.ProcessEnv = process.env,
): ResolvedProviderCredentials {
  const out: ResolvedProviderCredentials = {}
  const a =
    (env.ANTHROPIC_API_KEY ?? '').trim() ||
    (providers.providers['anthropic-api']?.apiKey ?? '').trim()
  if (a) out.anthropicApiKey = a
  const o =
    (env.OPENAI_API_KEY ?? '').trim() ||
    (providers.providers['openai-api']?.apiKey ?? '').trim()
  if (o) out.openaiApiKey = o
  const ob =
    (env.OPENAI_BASE_URL ?? '').trim() ||
    (providers.providers['openai-api']?.baseUrl ?? '').trim()
  if (ob) out.openaiBaseUrl = ob
  const l =
    (env.LLAMA_CPP_URL ?? env.LM_STUDIO_BASE_URL ?? '').trim() ||
    (providers.providers['llama-cpp']?.url ?? '').trim()
  if (l) out.llamaCppUrl = l
  return out
}
