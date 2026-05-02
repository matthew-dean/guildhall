import { z } from 'zod'
import { ModelAssignmentConfig, DEFAULT_LOCAL_MODEL_ASSIGNMENT } from '@guildhall/core'
import { mcpServerConfigSchema } from '@guildhall/mcp'

const MODEL_ROLE_KEYS = ['spec', 'coordinator', 'worker', 'reviewer', 'gateChecker'] as const
const MODEL_PROVIDER_KEYS = [
  'claude-oauth',
  'anthropic-api',
  'codex',
  'codex-oauth',
  'openai-api',
  'llama-cpp',
] as const
type ModelRoleKey = (typeof MODEL_ROLE_KEYS)[number]
type ModelProviderKey = (typeof MODEL_PROVIDER_KEYS)[number]

const LegacyModelAssignmentPartialSchema = ModelAssignmentConfig.partial().strict()

const ProviderModelShortcutSchema = z.object({
  all: z.string().optional(),
  smart: z.string().optional(),
  workhorse: z.string().optional(),
  spec: z.string().optional(),
  coordinator: z.string().optional(),
  worker: z.string().optional(),
  reviewer: z.string().optional(),
  gateChecker: z.string().optional(),
})

const ProviderModelAssignmentsSchema = z.object({
  'claude-oauth': ProviderModelShortcutSchema.optional(),
  'anthropic-api': ProviderModelShortcutSchema.optional(),
  codex: ProviderModelShortcutSchema.optional(),
  'codex-oauth': ProviderModelShortcutSchema.optional(),
  'openai-api': ProviderModelShortcutSchema.optional(),
  'llama-cpp': ProviderModelShortcutSchema.optional(),
}).strict()

export const ModelConfigInputSchema = z.union([
  LegacyModelAssignmentPartialSchema,
  ProviderModelAssignmentsSchema,
])
export type ModelConfigInput = z.infer<typeof ModelConfigInputSchema>
export type ProviderModelShortcut = z.infer<typeof ProviderModelShortcutSchema>
export type ProviderModelAssignments = z.infer<typeof ProviderModelAssignmentsSchema>

// ---------------------------------------------------------------------------
// guildhall.yaml — per-workspace configuration
// Lives next to the project's code (or in a .guildhall/ subdir).
// ---------------------------------------------------------------------------

export const WorkspaceYamlConfig = z.object({
  // Human-readable workspace name shown in the dashboard
  name: z.string().min(1),

  // Short slug used for the registry key (auto-derived from name if omitted)
  id: z.string().regex(/^[a-z0-9-]+$/).optional(),

  // Absolute path to the project this workspace is tracking.
  // Defaults to the directory containing guildhall.yaml.
  projectPath: z.string().optional(),

  // Model assignments per agent role.
  // Missing roles fall back to global config, then built-in defaults.
  models: ModelConfigInputSchema.optional(),

  // Which coordinators are active in this workspace.
  // Each coordinator can target a sub-path of projectPath.
  coordinators: z.array(z.object({
    // Unique id for this coordinator (e.g. "looma", "knit")
    id: z.string(),
    // Display name shown in logs and dashboard
    name: z.string(),
    // Short domain label used for task routing (matches task.domain)
    domain: z.string(),
    // Absolute or relative path to the project this coordinator governs.
    // Relative paths are resolved from projectPath.
    path: z.string().optional(),
    // One-paragraph mandate describing what this coordinator cares about
    mandate: z.string().default(''),
    // Lens-based concerns this coordinator applies when reviewing work
    concerns: z.array(z.object({
      id: z.string(),
      description: z.string(),
      reviewQuestions: z.array(z.string()).default([]),
    })).default([]),
    // Decisions this coordinator can make without human input
    autonomousDecisions: z.array(z.string()).default([]),
    // Conditions that require escalation to a human
    escalationTriggers: z.array(z.string()).default([]),
  })).default([]),

  // Max number of revision cycles before a task is escalated as blocked
  maxRevisions: z.number().int().positive().default(3),

  // How often (in task transitions) to emit a heartbeat progress log
  heartbeatInterval: z.number().int().positive().default(5),

  // Paths to ignore when agents scan the project (gitignore-style)
  ignore: z.array(z.string()).default(['node_modules', 'dist', '.git', 'coverage']),

  // Optional tags for grouping workspaces in the dashboard
  tags: z.array(z.string()).default([]),

  // FR-24: runtime-resource isolation. Consumed when the project-scope lever
  // `runtime_isolation` is set to `slot_allocation`. All fields optional — the
  // orchestrator falls back to sensible built-in defaults (see
  // @guildhall/runtime slot-allocator.ts).
  runtime: z.object({
    // First slot's port base; slot N gets `portBase + N * portStride`.
    portBase: z.number().int().min(1024).max(65535).optional(),
    // Stride between slot port bases.
    portStride: z.number().int().positive().optional(),
    // Template for the per-slot env-var prefix. `{slot}` is replaced by the
    // slot number. Default `GUILDHALL_W{slot}_`.
    envVarPrefixTemplate: z.string().optional(),
    // Extra env vars passed through to every spawned worker, regardless of
    // slot. Use for shared URLs, credentials, or feature flags identical
    // across slots.
    sharedEnv: z.record(z.string(), z.string()).optional(),
  }).optional(),

  // FR-18: lifecycle hook definitions keyed by HookEvent (session_start,
  // session_end, pre_tool_use, post_tool_use, …). Each event maps to an array
  // of hook definitions (command/http/prompt/agent). The structure is left as
  // passthrough here; @guildhall/hooks' zod schema is applied by the runtime
  // when building the HookExecutor. Keeping validation at the edge avoids a
  // dep cycle with @guildhall/hooks → @guildhall/engine.
  hooks: z.record(z.string(), z.array(z.unknown())).optional(),

  // MCP servers exposed to every agent as tools. Keyed by server name; the
  // resulting `mcp__<server>__<tool>` adapters are injected into each agent's
  // tool registry alongside the built-in `list_mcp_resources` / `read_mcp_resource`
  // helpers. Failed connections are surfaced via McpConnectionStatus; the
  // workspace still boots.
  mcp: z.object({
    servers: z.record(z.string(), mcpServerConfigSchema).default({}),
  }).optional(),

  // Project bootstrap: shell commands that put the project into a testable
  // state (e.g. `pnpm install`, `pnpm db:migrate`). The orchestrator runs
  // these before dispatching any worker and re-runs when the lockfile hash
  // changes. `successGates` are the commands that must pass after bootstrap
  // for the state to be considered testable — the meta-intake agent
  // empirically verifies these before writing the block. `provenance`
  // records what was tried so humans can audit the derivation.
  bootstrap: z.object({
    commands: z.array(z.string()).default([]),
    successGates: z.array(z.string()).default([]),
    timeoutMs: z.number().int().positive().default(300_000),
    provenance: z.object({
      establishedBy: z.string(),
      establishedAt: z.string(),
      tried: z.array(z.object({
        command: z.string(),
        result: z.enum(['pass', 'fail']),
        stderr: z.string().optional(),
      })).default([]),
    }).optional(),
    // Structural verification block written by `runBootstrap` (see
    // src/runtime/bootstrap.ts). Presence of `verifiedAt` is the hard
    // precondition the orchestrator enforces before dispatching any task.
    verifiedAt: z.string().optional(),
    packageManager: z.enum(['pnpm', 'npm', 'yarn', 'bun', 'none']).optional(),
    install: z.object({
      command: z.string(),
      lastRunAt: z.string().optional(),
      status: z.enum(['ok', 'failed']).optional(),
    }).optional(),
    gates: z.object({
      lint: z.object({
        command: z.string(),
        available: z.boolean(),
        unavailableReason: z.string().optional(),
      }).optional(),
      typecheck: z.object({
        command: z.string(),
        available: z.boolean(),
        unavailableReason: z.string().optional(),
      }).optional(),
      build: z.object({
        command: z.string(),
        available: z.boolean(),
        unavailableReason: z.string().optional(),
      }).optional(),
      test: z.object({
        command: z.string(),
        available: z.boolean(),
        unavailableReason: z.string().optional(),
      }).optional(),
    }).optional(),
  }).optional(),
})
export type WorkspaceYamlConfig = z.infer<typeof WorkspaceYamlConfig>

// ---------------------------------------------------------------------------
// ~/.guildhall/config.yaml — global defaults
// Applied to all workspaces unless overridden in guildhall.yaml.
// ---------------------------------------------------------------------------

export const GlobalConfig = z.object({
  // Default model assignments (merged with per-workspace models)
  models: ModelConfigInputSchema.optional(),

  // Default max revisions
  maxRevisions: z.number().int().positive().default(3),

  // Default heartbeat interval
  heartbeatInterval: z.number().int().positive().default(5),

  // LM Studio base URL
  lmStudioUrl: z.string().url().default('http://localhost:1234/v1'),

  // Anthropic API key (can also be set via ANTHROPIC_API_KEY env var)
  anthropicApiKey: z.string().optional(),

  // OpenAI API key (can also be set via OPENAI_API_KEY env var)
  openaiApiKey: z.string().optional(),

  // Dashboard server port for `guildhall serve`
  servePort: z.number().int().min(1024).max(65535).default(7777),

  // Whether a project whose preferred provider is unavailable may fall back
  // to another paid/cloud provider. Default is deliberately false; projects
  // can opt in through their local .guildhall/config.yaml.
  allowPaidProviderFallback: z.boolean().default(false),
})
export type GlobalConfig = z.infer<typeof GlobalConfig>

// ---------------------------------------------------------------------------
// ~/.guildhall/registry.yaml — workspace registry
// Lists all workspaces Forge knows about, with their absolute disk paths.
// ---------------------------------------------------------------------------

export const WorkspaceRegistryEntry = z.object({
  // Unique identifier (matches WorkspaceYamlConfig.id or slugified name)
  id: z.string().regex(/^[a-z0-9-]+$/),

  // Absolute path to the directory containing guildhall.yaml
  path: z.string(),

  // Cached display name (from guildhall.yaml)
  name: z.string(),

  // Tags copied from guildhall.yaml for fast filtering
  tags: z.array(z.string()).default([]),

  // ISO timestamp of when this workspace was registered
  registeredAt: z.string(),

  // ISO timestamp of last known activity (updated by orchestrator heartbeat)
  lastSeenAt: z.string().optional(),
})
export type WorkspaceRegistryEntry = z.infer<typeof WorkspaceRegistryEntry>

export const WorkspaceRegistry = z.object({
  version: z.literal(1).default(1),
  workspaces: z.array(WorkspaceRegistryEntry).default([]),
})
export type WorkspaceRegistry = z.infer<typeof WorkspaceRegistry>

// ---------------------------------------------------------------------------
// memory/agent-overrides.yaml — agent-accumulated configuration
//
// Written by agents at runtime via the saveAgentSetting tool.
// Project-behavior fields are merged on top of guildhall.yaml during config
// resolution. Model assignments are intentionally not agent-owned; they describe
// the user's machine and belong in ~/.guildhall/config.yaml unless a human adds
// an explicit workspace override.
//
// Humans can inspect, edit, or revert this file — it is plain YAML.
// Agents record the rationale for every change in DECISIONS.md so you always
// know WHY a setting changed.
//
// Structure mirrors guildhall.yaml but everything is optional — agents only write
// the specific fields they have learned something about.
// ---------------------------------------------------------------------------

/** A single timestamped setting change, for auditing */
export const AgentSettingEntry = z.object({
  // ISO timestamp of when this setting was saved
  savedAt: z.string(),
  // Which agent role saved this (coordinator, worker, reviewer, …)
  agentRole: z.string(),
  // Free-text rationale (also written to DECISIONS.md)
  rationale: z.string(),
})
export type AgentSettingEntry = z.infer<typeof AgentSettingEntry>

/** Per-coordinator overrides that agents can refine over time */
export const AgentCoordinatorOverride = z.object({
  // Additional concerns discovered by the agent
  addConcerns: z.array(z.object({
    id: z.string(),
    description: z.string(),
    reviewQuestions: z.array(z.string()).default([]),
  })).default([]),
  // Concerns to remove (by id) — rarely needed, prefer refining
  removeConcerns: z.array(z.string()).default([]),
  // Additional autonomous decision types the agent has found safe
  addAutonomousDecisions: z.array(z.string()).default([]),
  // Additional escalation triggers discovered through experience
  addEscalationTriggers: z.array(z.string()).default([]),
  // Mandate refinement (appended to the human-authored mandate)
  mandateAddendum: z.string().optional(),
  // Audit trail
  history: z.array(AgentSettingEntry).default([]),
})
export type AgentCoordinatorOverride = z.infer<typeof AgentCoordinatorOverride>

export const AgentSettings = z.object({
  // Schema version for future migration
  version: z.literal(1).default(1),

  // Legacy field: parsed for backward compatibility, but config resolution
  // ignores it. Model defaults are user/machine settings.
  models: ModelConfigInputSchema.optional(),

  // Per-coordinator overrides, keyed by coordinator id (e.g. "looma", "knit")
  coordinators: z.record(z.string(), AgentCoordinatorOverride).default({}),

  // Additional ignore patterns the agent has learned are safe to skip
  addIgnore: z.array(z.string()).default([]),

  // Orchestrator tuning the agent has found works better
  maxRevisions: z.number().int().positive().optional(),
  heartbeatInterval: z.number().int().positive().optional(),

  // Global audit trail
  history: z.array(AgentSettingEntry).default([]),
})
export type AgentSettings = z.infer<typeof AgentSettings>

/**
 * Config-layer overrides filename.
 *
 * Historical name collision: `agent-settings.yaml` is the SPEC-mandated file
 * for levers (see `@guildhall/levers`). The config package's `AgentSettings`
 * schema — model overrides, coordinator customizations, learned preferences —
 * lives alongside it in a separate file to avoid silent strip-unknowns data
 * loss when the two schemas coexisted on one file.
 */
export const AGENT_OVERRIDES_FILENAME = 'agent-overrides.yaml'

// ---------------------------------------------------------------------------
// ResolvedConfig — the merged result passed to the orchestrator
// ---------------------------------------------------------------------------

export const ResolvedConfig = z.object({
  // Workspace identity
  workspaceId: z.string(),
  workspaceName: z.string(),
  workspacePath: z.string(),

  // Project path (defaults to workspacePath)
  projectPath: z.string(),

  // Memory directory (always <workspacePath>/memory)
  memoryDir: z.string(),

  // Fully resolved model assignments
  models: ModelAssignmentConfig,

  // Coordinator definitions (mirrors WorkspaceYamlConfig.coordinators)
  coordinators: z.array(z.object({
    id: z.string(),
    name: z.string(),
    domain: z.string(),
    path: z.string().optional(),
    mandate: z.string(),
    concerns: z.array(z.object({
      id: z.string(),
      description: z.string(),
      reviewQuestions: z.array(z.string()),
    })),
    autonomousDecisions: z.array(z.string()),
    escalationTriggers: z.array(z.string()),
  })),

  // Orchestrator behaviour
  maxRevisions: z.number(),
  heartbeatInterval: z.number(),
  ignore: z.array(z.string()),

  // Network & credentials (from global config + env)
  lmStudioUrl: z.string(),

  // Dashboard port
  servePort: z.number(),

  // FR-24: runtime-isolation passthrough (see WorkspaceYamlConfig.runtime).
  // The orchestrator reads this when instantiating a SlotAllocator under
  // `runtime_isolation: slot_allocation`.
  runtime: z.object({
    portBase: z.number().int().optional(),
    portStride: z.number().int().optional(),
    envVarPrefixTemplate: z.string().optional(),
    sharedEnv: z.record(z.string(), z.string()).optional(),
  }).optional(),

  // FR-18: passthrough hook definitions keyed by HookEvent. See
  // WorkspaceYamlConfig.hooks for the shape — this is the merged view the
  // orchestrator feeds into the HookExecutor at startup.
  hooks: z.record(z.string(), z.array(z.unknown())).optional(),

  // MCP servers the orchestrator connects to at startup. See
  // WorkspaceYamlConfig.mcp.
  mcp: z.object({
    servers: z.record(z.string(), mcpServerConfigSchema).default({}),
  }).optional(),

  // Project bootstrap block (passthrough from WorkspaceYamlConfig.bootstrap).
  // The orchestrator runs `commands` before the first task dispatch and re-runs
  // when the lockfile hash changes; `successGates` verify testability.
  bootstrap: z.object({
    commands: z.array(z.string()),
    successGates: z.array(z.string()),
    timeoutMs: z.number().int().positive(),
    provenance: z.object({
      establishedBy: z.string(),
      establishedAt: z.string(),
      tried: z.array(z.object({
        command: z.string(),
        result: z.enum(['pass', 'fail']),
        stderr: z.string().optional(),
      })),
    }).optional(),
    verifiedAt: z.string().optional(),
    packageManager: z.enum(['pnpm', 'npm', 'yarn', 'bun', 'none']).optional(),
    install: z.object({
      command: z.string(),
      lastRunAt: z.string().optional(),
      status: z.enum(['ok', 'failed']).optional(),
    }).optional(),
    gates: z.object({
      lint: z.object({
        command: z.string(),
        available: z.boolean(),
        unavailableReason: z.string().optional(),
      }).optional(),
      typecheck: z.object({
        command: z.string(),
        available: z.boolean(),
        unavailableReason: z.string().optional(),
      }).optional(),
      build: z.object({
        command: z.string(),
        available: z.boolean(),
        unavailableReason: z.string().optional(),
      }).optional(),
      test: z.object({
        command: z.string(),
        available: z.boolean(),
        unavailableReason: z.string().optional(),
      }).optional(),
    }).optional(),
  }).optional(),
})
export type ResolvedConfig = z.infer<typeof ResolvedConfig>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Slugify a workspace name into a valid id */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'workspace'
}

type ModelAssignmentPartial = { [K in keyof z.infer<typeof ModelAssignmentConfig>]?: string | undefined }

function isRoleKey(key: string): key is ModelRoleKey {
  return (MODEL_ROLE_KEYS as readonly string[]).includes(key)
}

function isProviderModelAssignments(
  value: ModelConfigInput | undefined,
): value is ProviderModelAssignments {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.some(key => (MODEL_PROVIDER_KEYS as readonly string[]).includes(key))
}

function normalizeProviderModelKey(
  provider: string | undefined,
): ModelProviderKey | null {
  if (!provider) return null
  if (provider === 'codex') return 'codex'
  if (provider === 'codex-oauth') return 'codex-oauth'
  return (MODEL_PROVIDER_KEYS as readonly string[]).includes(provider)
    ? (provider as ModelProviderKey)
    : null
}

function expandProviderShortcut(
  shortcut: ProviderModelShortcut | undefined,
): ModelAssignmentPartial {
  if (!shortcut) return {}
  const out: ModelAssignmentPartial = {}
  if (shortcut.all) {
    for (const role of MODEL_ROLE_KEYS) out[role] = shortcut.all
  }
  if (shortcut.smart) {
    out.spec = shortcut.smart
    out.coordinator = shortcut.smart
  }
  if (shortcut.workhorse) {
    out.worker = shortcut.workhorse
    out.reviewer = shortcut.workhorse
    out.gateChecker = shortcut.workhorse
  }
  for (const role of MODEL_ROLE_KEYS) {
    const value = shortcut[role]
    if (value) out[role] = value
  }
  return out
}

export function resolveModelsForProvider(
  input: ModelConfigInput | undefined,
  provider?: string,
): ModelAssignmentPartial {
  if (!input) return {}
  if (!isProviderModelAssignments(input)) return input
  const normalized = normalizeProviderModelKey(provider)
  if (normalized) {
    const direct = input[normalized]
    if (direct) return expandProviderShortcut(direct)
    if (normalized === 'codex-oauth' && input.codex) return expandProviderShortcut(input.codex)
    if (normalized === 'codex' && input['codex-oauth']) return expandProviderShortcut(input['codex-oauth'])
  }
  const entries = Object.entries(input).filter(([, value]) => value && typeof value === 'object')
  if (entries.length === 1) {
    const only = entries[0]?.[1] as ProviderModelShortcut | undefined
    return expandProviderShortcut(only)
  }
  return {}
}

export function writeModelsForProvider(
  input: ModelConfigInput | undefined,
  provider: string | undefined,
  assignment: ModelAssignmentPartial | undefined,
): ModelConfigInput | undefined {
  const normalized = normalizeProviderModelKey(provider)
  if (!normalized) {
    return assignment && Object.keys(assignment).length > 0 ? assignment : undefined
  }
  const current = isProviderModelAssignments(input) ? { ...input } : {}
  if (!assignment || Object.keys(assignment).length === 0) {
    delete current[normalized]
    if (normalized === 'codex-oauth') delete current.codex
    if (normalized === 'codex') delete current['codex-oauth']
    return Object.keys(current).length > 0 ? current : undefined
  }
  const explicit: ProviderModelShortcut = {}
  for (const role of MODEL_ROLE_KEYS) {
    const value = assignment[role]
    if (value) explicit[role] = value
  }
  current[normalized] = explicit
  if (normalized === 'codex-oauth') delete current.codex
  if (normalized === 'codex') delete current['codex-oauth']
  return current
}

/** Merge partial model assignments: workspace overrides global overrides defaults */
export function mergeModels(
  base: ModelAssignmentPartial,
  override: ModelAssignmentPartial | undefined,
): z.infer<typeof ModelAssignmentConfig> {
  const cleaned: Record<string, string> = { ...DEFAULT_LOCAL_MODEL_ASSIGNMENT }
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined) cleaned[k] = v
  }
  for (const [k, v] of Object.entries(override ?? {})) {
    if (v !== undefined) cleaned[k] = v
  }
  return ModelAssignmentConfig.parse(cleaned)
}
