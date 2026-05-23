import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { load as yamlLoad, dump as yamlDump } from 'js-yaml'
import { z } from 'zod'
import { ModelConfigInputSchema } from './schemas.js'

// ---------------------------------------------------------------------------
// Project-local Guildhall config — <project>/.guildhall/config.yaml
//
// This file holds local/private overrides for this checkout. Shared project
// contract belongs in `guildhall.yaml`; shared Guildhall metadata belongs in
// other checked-in `.guildhall/*.yaml` files such as `artifacts.yaml`.
// ---------------------------------------------------------------------------

export const PROJECT_CONFIG_DIRNAME = '.guildhall'
export const PROJECT_CONFIG_FILENAME = 'config.yaml'
export const SHARED_PROJECT_METADATA_GITIGNORE_ENTRIES = [
  `!${PROJECT_CONFIG_DIRNAME}/`,
  `!${PROJECT_CONFIG_DIRNAME}/*.yaml`,
] as const
export const LOCAL_PROJECT_STATE_GITIGNORE_ENTRIES = [
  `${PROJECT_CONFIG_DIRNAME}/${PROJECT_CONFIG_FILENAME}`,
  `${PROJECT_CONFIG_DIRNAME}/worktrees/`,
] as const

export const ProjectGuildhallConfig = z.object({
  /** Default model assignments (merged with per-workspace models) */
  models: ModelConfigInputSchema.optional(),

  /** Default max revisions before a task is escalated */
  maxRevisions: z.number().int().positive().default(3),

  /** Default heartbeat interval (seconds) */
  heartbeatInterval: z.number().int().positive().default(5),

  /** OpenAI-compatible local server URL */
  lmStudioUrl: z.string().url().default('http://localhost:1234/v1'),

  /** Anthropic API key (can also be set via ANTHROPIC_API_KEY env var) */
  anthropicApiKey: z.string().optional(),

  /** OpenAI API key (can also be set via OPENAI_API_KEY env var) */
  openaiApiKey: z.string().optional(),

  /** Dashboard server port for `guildhall serve` */
  servePort: z.number().int().min(1024).max(65535).default(7777),

  /**
   * Project override for falling back from an unavailable preferred provider
   * to another paid/cloud provider. Omitted means "use global default".
   */
  allowPaidProviderFallback: z.boolean().optional(),

  /**
   * Project-specific override for the machine-wide preferred provider.
   * Omit in normal use so the global default applies across projects.
   */
  preferredProvider: z.enum(['claude-oauth', 'codex', 'llama-cpp', 'anthropic-api', 'openai-api']).optional(),

  /**
   * Which branch accepted task work should land back onto in this checkout.
   * Omit to use the repo's current branch at orchestrator start.
   */
  landingBranch: z.string().min(1).optional(),

  /**
   * How many spec/intake tasks may run at once. Default `1` keeps the
   * conversational intake surface focused; raise it only when you want Guildhall
   * shaping multiple unrelated asks in parallel.
   */
  specLaneConcurrency: z.number().int().positive().max(16).optional(),

  /**
   * How many worker tasks may run at once. The effective value is also capped
   * by the `concurrent_task_dispatch` lever and any runtime slot limits.
   */
  workerLaneConcurrency: z.number().int().positive().max(16).optional(),

  /**
   * Advanced override for persona reviewer fan-out within one `review` pass.
   *
   * Omit this in normal use. Guildhall auto-derives reviewer concurrency from
   * the active provider's capacity (`1` for local servers, higher for hosted
   * providers). This knob remains as an escape hatch for unusual repos.
   */
  reviewerFanoutConcurrency: z.number().int().positive().max(16).optional(),

  /**
   * How many distinct review/gate tasks may run at once. This is separate from
   * `reviewerFanoutConcurrency`, which controls persona fan-out *within* one
   * review task.
   */
  reviewLaneConcurrency: z.number().int().positive().max(16).optional(),

  /**
   * How many coordinator/policy tasks may run at once. Default `1` keeps
   * adjudication and proposal/policy handling serialized unless a workspace
   * explicitly opts into more parallel judgment.
   */
  coordinatorLaneConcurrency: z.number().int().positive().max(16).optional(),
})
export type ProjectGuildhallConfig = z.infer<typeof ProjectGuildhallConfig>

export function projectConfigDir(projectPath: string): string {
  return join(projectPath, PROJECT_CONFIG_DIRNAME)
}

export function projectConfigPath(projectPath: string): string {
  return join(projectConfigDir(projectPath), PROJECT_CONFIG_FILENAME)
}

/**
 * Ensure the project-level `.guildhall/` file contract exists.
 *
 * `.guildhall/*.yaml` is intentionally trackable shared Guildhall metadata
 * (`artifacts.yaml`, future worktree include metadata, etc.). Local checkout
 * overrides and temporary worktrees stay ignored.
 */
export function ensureProjectGuildhallFilePolicy(projectPath: string): void {
  const projectRoot = resolve(projectPath)
  if (!existsSync(projectRoot)) mkdirSync(projectRoot, { recursive: true })
  const dir = projectConfigDir(projectRoot)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const rootGitignore = join(projectRoot, '.gitignore')
  const existing = existsSync(rootGitignore) ? readFileSync(rootGitignore, 'utf8') : ''
  const wanted = [
    ...SHARED_PROJECT_METADATA_GITIGNORE_ENTRIES,
    ...LOCAL_PROJECT_STATE_GITIGNORE_ENTRIES,
  ]
  const normalizedLines = existing
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter(Boolean)
  const missing = wanted.filter((entry) => !normalizedLines.includes(entry))

  if (missing.length === 0) return

  const prefix = existing.length === 0 ? '' : existing.endsWith('\n') ? existing : `${existing}\n`
  writeFileSync(rootGitignore, `${prefix}${missing.join('\n')}\n`, 'utf8')
}

/**
 * Ensure project-local Guildhall state is created and ignored by the host repo.
 * This is safe to call repeatedly from init/setup paths.
 */
export function ensureProjectLocalStateIgnored(projectPath: string): void {
  ensureProjectGuildhallFilePolicy(projectPath)
}

/**
 * Read `<project>/.guildhall/config.yaml`. Returns defaults if the file is
 * missing (so boot is never blocked by missing project-local state).
 */
export function readProjectConfig(projectPath: string): ProjectGuildhallConfig {
  const path = projectConfigPath(projectPath)
  if (!existsSync(path)) return ProjectGuildhallConfig.parse({})
  let raw: unknown
  try {
    raw = yamlLoad(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${String(err)}`)
  }
  try {
    return ProjectGuildhallConfig.parse(raw ?? {})
  } catch (err) {
    throw new Error(`Invalid ${path}: ${String(err)}`)
  }
}

/**
 * Write `<project>/.guildhall/config.yaml`. Creates the directory if needed.
 * File permissions are 0600 because this stores API keys.
 */
export function writeProjectConfig(projectPath: string, config: ProjectGuildhallConfig): void {
  ensureProjectLocalStateIgnored(projectPath)
  const validated = ProjectGuildhallConfig.parse(config)
  const yaml = yamlDump(validated, { lineWidth: 120, noRefs: true })
  writeFileSync(projectConfigPath(projectPath), yaml, { encoding: 'utf8', mode: 0o600 })
}

export function updateProjectConfig(
  projectPath: string,
  patch: Partial<ProjectGuildhallConfig>,
): ProjectGuildhallConfig {
  const current = readProjectConfig(projectPath)
  const merged = ProjectGuildhallConfig.parse({ ...current, ...patch })
  writeProjectConfig(projectPath, merged)
  return merged
}
