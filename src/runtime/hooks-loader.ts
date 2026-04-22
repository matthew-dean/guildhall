/**
 * FR-18 hook system wire-in.
 *
 * Takes the passthrough `hooks` field from ResolvedConfig, validates each entry
 * against `@guildhall/hooks` schemas, and returns a ready-to-use HookExecutor
 * (or `undefined` when the workspace has no hooks configured).
 *
 * Keeping this loader in the runtime avoids adding a hooks→config dep cycle:
 * config stores the raw passthrough, runtime does the schema validation at the
 * edge when it actually needs to execute hooks.
 */

import {
  HookExecutor,
  HookRegistry,
  hookDefinitionSchema,
  type HookExecutionContext,
} from '@guildhall/hooks'
import { HookEvent, type SupportsStreamingMessages } from '@guildhall/engine'
import type { ResolvedConfig } from '@guildhall/config'

const KNOWN_EVENTS = new Set<string>(Object.values(HookEvent))

export interface BuildHookExecutorOptions {
  config: ResolvedConfig
  apiClient: SupportsStreamingMessages
  defaultModel: string
  /** Override cwd; defaults to config.projectPath. */
  cwd?: string
}

/**
 * Build a HookExecutor from a ResolvedConfig's `hooks` field. Returns
 * `undefined` when the config has no hooks, so callers can skip wiring the
 * executor through to agents entirely.
 *
 * Definitions that fail schema validation are dropped with a console warning;
 * we do not want a malformed hook to brick the orchestrator. Event keys not
 * matching a known HookEvent are likewise skipped.
 */
export function buildHookExecutor(
  opts: BuildHookExecutorOptions,
): HookExecutor | undefined {
  const raw = opts.config.hooks
  if (!raw) return undefined

  const registry = new HookRegistry()
  let registered = 0

  for (const [event, defs] of Object.entries(raw)) {
    if (!KNOWN_EVENTS.has(event)) {
      console.warn(`[guildhall] Ignoring unknown hook event "${event}"`)
      continue
    }
    for (const def of defs) {
      const parsed = hookDefinitionSchema.safeParse(def)
      if (!parsed.success) {
        console.warn(
          `[guildhall] Invalid hook definition for ${event}: ${parsed.error.message}`,
        )
        continue
      }
      registry.register(event as HookEvent, parsed.data)
      registered++
    }
  }

  if (registered === 0) return undefined

  const ctx: HookExecutionContext = {
    cwd: opts.cwd ?? opts.config.projectPath,
    apiClient: opts.apiClient,
    defaultModel: opts.defaultModel,
  }
  return new HookExecutor(registry, ctx)
}
