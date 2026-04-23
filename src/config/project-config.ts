import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { load as yamlLoad, dump as yamlDump } from 'js-yaml'
import { z } from 'zod'
import { ModelAssignmentConfig } from '@guildhall/core'

// ---------------------------------------------------------------------------
// Project-local Guildhall config — <project>/.guildhall/config.yaml
//
// This file holds per-project Guildhall runtime state that does not belong in
// `guildhall.yaml` (which is usually checked in): provider API keys,
// preferred local model endpoints, the chosen serve port, etc.
//
// Guildhall never writes to a shared ~/.guildhall/ directory; version
// isolation between projects is provided by each project's pinned
// `node_modules/.bin/guildhall`. Cross-project aggregation lives in
// guild-pro.
// ---------------------------------------------------------------------------

export const PROJECT_CONFIG_DIRNAME = '.guildhall'
export const PROJECT_CONFIG_FILENAME = 'config.yaml'

export const ProjectGuildhallConfig = z.object({
  /** Default model assignments (merged with per-workspace models) */
  models: ModelAssignmentConfig.partial().optional(),

  /** Default max revisions before a task is escalated */
  maxRevisions: z.number().int().positive().default(3),

  /** Default heartbeat interval (seconds) */
  heartbeatInterval: z.number().int().positive().default(5),

  /** llama.cpp / LM Studio base URL */
  lmStudioUrl: z.string().url().default('http://localhost:1234/v1'),

  /** Anthropic API key (can also be set via ANTHROPIC_API_KEY env var) */
  anthropicApiKey: z.string().optional(),

  /** OpenAI API key (can also be set via OPENAI_API_KEY env var) */
  openaiApiKey: z.string().optional(),

  /** Dashboard server port for `guildhall serve` */
  servePort: z.number().int().min(1024).max(65535).default(7842),

  /**
   * Which provider the wizard chose last. Drives fallback order when
   * multiple providers are reachable.
   */
  preferredProvider: z.enum(['claude-oauth', 'codex', 'llama-cpp', 'anthropic-api', 'openai-api']).optional(),

  /**
   * How many persona reviewer agents to run concurrently during
   * `review` fan-out. Default `1` (sequential) is safe for any provider
   * — LM Studio / llama.cpp can't service concurrent requests on a
   * single session. Raise to 2–4 when the reviewer is a cloud provider
   * (Anthropic, OpenAI, Codex) whose rate limits comfortably exceed the
   * roster size — wall-clock review latency drops roughly linearly.
   */
  reviewerFanoutConcurrency: z.number().int().positive().max(16).default(1),
})
export type ProjectGuildhallConfig = z.infer<typeof ProjectGuildhallConfig>

export function projectConfigDir(projectPath: string): string {
  return join(projectPath, PROJECT_CONFIG_DIRNAME)
}

export function projectConfigPath(projectPath: string): string {
  return join(projectConfigDir(projectPath), PROJECT_CONFIG_FILENAME)
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
  const dir = projectConfigDir(projectPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const gitignorePath = join(dir, '.gitignore')
  if (!existsSync(gitignorePath)) {
    // Keep .guildhall/ untracked without requiring the user to edit their
    // outer repo's .gitignore — config may hold API keys.
    writeFileSync(gitignorePath, '*\n!.gitignore\n', 'utf8')
  }
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
