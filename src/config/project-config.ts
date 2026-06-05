import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { load as yamlLoad, dump as yamlDump } from 'js-yaml'
import { z } from 'zod'
import { GitStoryPolicy, ModelConfigInputSchema } from './schemas.js'

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
  '# Guildhall project exports are opt-in. Default project state is system-local.',
] as const
export const LOCAL_PROJECT_STATE_GITIGNORE_ENTRIES = [
  '# Project-local Guildhall state stays out of git unless explicitly exported.',
  `${PROJECT_CONFIG_DIRNAME}/`,
] as const
export const GUILDHALL_GITIGNORE_BEGIN = '# BEGIN Guildhall managed'
export const GUILDHALL_GITIGNORE_END = '# END Guildhall managed'

export function guildhallGitignoreManagedBlock(): string {
  return [
    GUILDHALL_GITIGNORE_BEGIN,
    ...SHARED_PROJECT_METADATA_GITIGNORE_ENTRIES,
    ...LOCAL_PROJECT_STATE_GITIGNORE_ENTRIES,
    GUILDHALL_GITIGNORE_END,
  ].join('\n')
}

function stripGuildhallManagedBlock(content: string): string {
  const pattern = new RegExp(
    `\\n?${GUILDHALL_GITIGNORE_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${GUILDHALL_GITIGNORE_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`,
    'g',
  )
  return content.replace(pattern, '\n')
}

const LEGACY_GUILDHALL_POLICY_LINES = new Set([
  `!${PROJECT_CONFIG_DIRNAME}/`,
  `!${PROJECT_CONFIG_DIRNAME}/**`,
  `!${PROJECT_CONFIG_DIRNAME}/*.yaml`,
  `${PROJECT_CONFIG_DIRNAME}/${PROJECT_CONFIG_FILENAME}`,
  `${PROJECT_CONFIG_DIRNAME}/codebase-map.yaml`,
  `${PROJECT_CONFIG_DIRNAME}/codebase-map.stale.json`,
  `${PROJECT_CONFIG_DIRNAME}/codebase-map.history.jsonl`,
  `${PROJECT_CONFIG_DIRNAME}/codebase-map/`,
  `${PROJECT_CONFIG_DIRNAME}/external-agent-links.json`,
  `${PROJECT_CONFIG_DIRNAME}/worktrees/`,
  `${PROJECT_CONFIG_DIRNAME}/local/`,
  `${PROJECT_CONFIG_DIRNAME}/cache/`,
  `${PROJECT_CONFIG_DIRNAME}/tmp/`,
  `${PROJECT_CONFIG_DIRNAME}/logs/`,
  `${PROJECT_CONFIG_DIRNAME}/sessions/`,
  `${PROJECT_CONFIG_DIRNAME}/transcripts/`,
  `${PROJECT_CONFIG_DIRNAME}/context-debug/`,
  `${PROJECT_CONFIG_DIRNAME}/events/`,
  `${PROJECT_CONFIG_DIRNAME}/checkpoints/`,
  `${PROJECT_CONFIG_DIRNAME}/dev-tools/`,
  `${PROJECT_CONFIG_DIRNAME}/.session-epoch`,
])

export function applyGuildhallGitignorePolicy(content: string): string {
  const withoutManagedBlock = stripGuildhallManagedBlock(content)
  const preserved = withoutManagedBlock
    .split(/\r?\n/)
    .filter((line) => !LEGACY_GUILDHALL_POLICY_LINES.has(line.trim()))
    .join('\n')
    .trimEnd()
  return [
    preserved.length > 0 ? preserved : null,
    preserved.length > 0 ? '' : null,
    guildhallGitignoreManagedBlock(),
    '',
  ].filter((line) => line !== null).join('\n')
}

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

  /**
   * Project-local copy of the machine-wide Git Story default. Project setup
   * seeds this from ~/.guildhall/config.yaml and then lets this checkout opt in
   * or out of auto-commit/push/PR behavior without changing the global default.
   */
  gitStory: GitStoryPolicy.optional(),
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
  const next = applyGuildhallGitignorePolicy(existing)
  if (next === existing) return
  writeFileSync(rootGitignore, next, 'utf8')
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
