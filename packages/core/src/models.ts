import { z } from 'zod'

// ---------------------------------------------------------------------------
// Model registry
//
// Forge needs different cognitive profiles for different agent roles.
// This module defines those profiles, ships a curated catalog of recommended
// models (local and cloud), and provides the config shape for wiring them up.
//
// Design principle: the cognitive requirements of each role are declared here
// in terms of *what matters*, not which specific model to use. The config
// then maps roles to available models. This lets you swap models without
// touching agent code.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Agent roles and their cognitive profiles
// ---------------------------------------------------------------------------

export const AgentRole = z.enum([
  'spec',         // Spec agent: unambiguous spec writing, ambiguity detection, escalation judgment
  'coordinator',  // Coordinator: planning, task assignment, cross-domain negotiation, ADR writing
  'worker',       // Worker: code generation, file editing, following conventions precisely
  'reviewer',     // Reviewer: rubric-based evaluation, structured output, catching regressions
  'gateChecker',  // Gate checker: runs shell commands, parses output, records results
])
export type AgentRole = z.infer<typeof AgentRole>

// What a role primarily needs from its model
export const CognitiveProfile = z.object({
  // How much long-horizon reasoning is needed (planning, multi-step logic)
  reasoning: z.number().min(0).max(3),
  // How strong code generation / understanding needs to be
  codegen: z.number().min(0).max(3),
  // How important structured/constrained output is
  structuredOutput: z.number().min(0).max(3),
  // Whether speed matters more than depth
  preferSpeed: z.boolean(),
})
export type CognitiveProfile = z.infer<typeof CognitiveProfile>

export const ROLE_PROFILES: Record<AgentRole, CognitiveProfile> = {
  spec: {
    reasoning: 3,        // Must detect ambiguity and reason about acceptance criteria
    codegen: 1,          // Reads code but doesn't write much
    structuredOutput: 2, // Needs to write structured specs
    preferSpeed: false,
  },
  coordinator: {
    reasoning: 3,        // Planning, negotiation, architectural judgment
    codegen: 1,
    structuredOutput: 2,
    preferSpeed: false,
  },
  worker: {
    reasoning: 2,        // Follows a spec, doesn't need to invent strategy
    codegen: 3,          // Primary job is writing correct code
    structuredOutput: 1,
    preferSpeed: false,
  },
  reviewer: {
    reasoning: 2,
    codegen: 2,          // Must understand code to evaluate it
    structuredOutput: 3, // Rubric output must be structured and consistent
    preferSpeed: true,   // Fast feedback loops matter here
  },
  gateChecker: {
    reasoning: 1,
    codegen: 0,
    structuredOutput: 3, // Must produce structured pass/fail records
    preferSpeed: true,
  },
}

// ---------------------------------------------------------------------------
// Model catalog
//
// A curated list of recommended models with notes. This is the reference
// guide for what to load in LM Studio (or configure in your cloud provider).
//
// Ratings are 0–3: 0 = poor, 1 = adequate, 2 = good, 3 = excellent
// ---------------------------------------------------------------------------

export const ModelProvider = z.enum(['lm-studio', 'anthropic', 'openai', 'google'])
export type ModelProvider = z.infer<typeof ModelProvider>

export const ModelCatalogEntry = z.object({
  id: z.string(),               // The model ID string to use in config
  displayName: z.string(),
  provider: ModelProvider,
  contextWindow: z.number(),    // tokens
  reasoning: z.number().min(0).max(3),
  codegen: z.number().min(0).max(3),
  structuredOutput: z.number().min(0).max(3),
  speed: z.number().min(0).max(3), // 3 = fastest
  // RAM required to run at full precision (local models only)
  ramGb: z.number().optional(),
  recommendedRoles: z.array(AgentRole),
  notes: z.string(),
})
export type ModelCatalogEntry = z.infer<typeof ModelCatalogEntry>

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  // ---------------------------------------------------------------------------
  // Local — LM Studio (load these in LM Studio, point LM_STUDIO_MODEL at them)
  // ---------------------------------------------------------------------------
  {
    id: 'qwen2.5-coder-32b-instruct',
    displayName: 'Qwen 2.5 Coder 32B Instruct',
    provider: 'lm-studio',
    contextWindow: 32_768,
    reasoning: 2,
    codegen: 3,
    structuredOutput: 2,
    speed: 1,
    ramGb: 20,
    recommendedRoles: ['worker', 'spec', 'coordinator'],
    notes: 'Best all-round local model for coding tasks. Strong instruction following. Good first choice if you have ≥24GB VRAM.',
  },
  {
    id: 'qwen2.5-coder-14b-instruct',
    displayName: 'Qwen 2.5 Coder 14B Instruct',
    provider: 'lm-studio',
    contextWindow: 32_768,
    reasoning: 2,
    codegen: 2,
    structuredOutput: 2,
    speed: 2,
    ramGb: 10,
    recommendedRoles: ['worker', 'reviewer', 'gateChecker'],
    notes: 'Good balance of capability and speed. Recommended as the fast model for reviewer/gate-checker roles.',
  },
  {
    id: 'qwen2.5-coder-7b-instruct',
    displayName: 'Qwen 2.5 Coder 7B Instruct',
    provider: 'lm-studio',
    contextWindow: 32_768,
    reasoning: 1,
    codegen: 2,
    structuredOutput: 2,
    speed: 3,
    ramGb: 5,
    recommendedRoles: ['reviewer', 'gateChecker'],
    notes: 'Fast and small. Best suited for structured evaluation tasks (reviewer rubric, gate recording). Not recommended for spec or coordinator roles.',
  },
  {
    id: 'deepseek-r1-distill-qwen-32b',
    displayName: 'DeepSeek R1 Distill Qwen 32B',
    provider: 'lm-studio',
    contextWindow: 65_536,
    reasoning: 3,
    codegen: 2,
    structuredOutput: 2,
    speed: 1,
    ramGb: 20,
    recommendedRoles: ['spec', 'coordinator'],
    notes: 'Exceptional reasoning via chain-of-thought. Best local choice for spec and coordinator roles where judgment quality matters most. Slower than pure coders.',
  },
  {
    id: 'deepseek-coder-v2-lite-instruct',
    displayName: 'DeepSeek Coder V2 Lite Instruct',
    provider: 'lm-studio',
    contextWindow: 32_768,
    reasoning: 2,
    codegen: 3,
    structuredOutput: 2,
    speed: 2,
    ramGb: 9,
    recommendedRoles: ['worker', 'reviewer'],
    notes: 'Strong coder, lighter weight than the full V2. Good worker model when VRAM is limited.',
  },
  {
    id: 'llama-3.3-70b-instruct',
    displayName: 'Llama 3.3 70B Instruct',
    provider: 'lm-studio',
    contextWindow: 131_072,
    reasoning: 3,
    codegen: 2,
    structuredOutput: 2,
    speed: 1,
    ramGb: 42,
    recommendedRoles: ['spec', 'coordinator'],
    notes: 'Best-in-class local reasoning. If you have the VRAM, this is the top choice for coordinator and spec roles. Long context window is useful for large project memory.',
  },
  // ---------------------------------------------------------------------------
  // Cloud — use when quality matters more than cost/privacy
  // ---------------------------------------------------------------------------
  {
    id: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    contextWindow: 200_000,
    reasoning: 3,
    codegen: 3,
    structuredOutput: 3,
    speed: 2,
    recommendedRoles: ['spec', 'coordinator', 'worker', 'reviewer'],
    notes: 'Excellent across all roles. Use as the primary model if you want cloud quality. Strong structured output and very long context.',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    provider: 'anthropic',
    contextWindow: 200_000,
    reasoning: 2,
    codegen: 2,
    structuredOutput: 3,
    speed: 3,
    recommendedRoles: ['reviewer', 'gateChecker'],
    notes: 'Fast and cheap. Ideal fast model for reviewer and gate-checker roles in cloud setups.',
  },
  {
    id: 'gpt-4o',
    displayName: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128_000,
    reasoning: 3,
    codegen: 3,
    structuredOutput: 3,
    speed: 2,
    recommendedRoles: ['spec', 'coordinator', 'worker', 'reviewer'],
    notes: 'Strong across all roles. Good alternative to Claude if you prefer OpenAI.',
  },
  {
    id: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    provider: 'openai',
    contextWindow: 128_000,
    reasoning: 2,
    codegen: 2,
    structuredOutput: 3,
    speed: 3,
    recommendedRoles: ['reviewer', 'gateChecker'],
    notes: 'Fast and cheap. Good fast model for reviewer/gate-checker in OpenAI setups.',
  },
]

// ---------------------------------------------------------------------------
// Model assignment config shape
//
// This is what goes in guildhall.config.ts. Each role gets its own model.
// You can reuse the same model for multiple roles if you want simplicity.
// ---------------------------------------------------------------------------

export const ModelAssignmentConfig = z.object({
  // One model ID per role. Must match the `id` field in MODEL_CATALOG,
  // or be any valid model string if you're using a custom/unlisted model.
  spec: z.string(),
  coordinator: z.string(),
  worker: z.string(),
  reviewer: z.string(),
  gateChecker: z.string(),
})
export type ModelAssignmentConfig = z.infer<typeof ModelAssignmentConfig>

// Sensible defaults for a local-only setup with a single powerful model
export const DEFAULT_LOCAL_MODEL_ASSIGNMENT: ModelAssignmentConfig = {
  spec: 'qwen2.5-coder-32b-instruct',
  coordinator: 'qwen2.5-coder-32b-instruct',
  worker: 'qwen2.5-coder-32b-instruct',
  reviewer: 'qwen2.5-coder-14b-instruct',
  gateChecker: 'qwen2.5-coder-7b-instruct',
}

// Defaults for a hybrid setup: cloud for reasoning, local for code
export const DEFAULT_HYBRID_MODEL_ASSIGNMENT: ModelAssignmentConfig = {
  spec: 'claude-sonnet-4-6',
  coordinator: 'claude-sonnet-4-6',
  worker: 'qwen2.5-coder-32b-instruct',
  reviewer: 'claude-haiku-4-5-20251001',
  gateChecker: 'qwen2.5-coder-7b-instruct',
}

// Defaults for a cloud-only setup
export const DEFAULT_CLOUD_MODEL_ASSIGNMENT: ModelAssignmentConfig = {
  spec: 'claude-sonnet-4-6',
  coordinator: 'claude-sonnet-4-6',
  worker: 'claude-sonnet-4-6',
  reviewer: 'claude-haiku-4-5-20251001',
  gateChecker: 'claude-haiku-4-5-20251001',
}

// ---------------------------------------------------------------------------
// Helper: look up a catalog entry by model id
// ---------------------------------------------------------------------------

export function findModel(id: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find(m => m.id === id)
}

// ---------------------------------------------------------------------------
// Helper: recommend models for a given role based on available catalog entries
// ---------------------------------------------------------------------------

export function recommendModelsForRole(role: AgentRole): ModelCatalogEntry[] {
  return MODEL_CATALOG
    .filter(m => m.recommendedRoles.includes(role))
    .sort((a, b) => {
      const profile = ROLE_PROFILES[role]
      const scoreA = a.reasoning * profile.reasoning + a.codegen * profile.codegen + a.structuredOutput * profile.structuredOutput
      const scoreB = b.reasoning * profile.reasoning + b.codegen * profile.codegen + b.structuredOutput * profile.structuredOutput
      return scoreB - scoreA
    })
}
