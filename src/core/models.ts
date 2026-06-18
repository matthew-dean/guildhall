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
  'contextIndexer', // Context indexer: summarizes code purpose/contracts cheaply for Corpus Map
])
export type AgentRole = z.infer<typeof AgentRole>

export const ModelBehaviorProfile = z.enum(['precise', 'balanced', 'exploratory'])
export type ModelBehaviorProfile = z.infer<typeof ModelBehaviorProfile>

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
  contextIndexer: {
    reasoning: 2,        // Infers purpose/contracts but should not make product decisions
    codegen: 2,          // Must understand code well enough to summarize architecture
    structuredOutput: 3, // Must write compact, machine-usable summaries
    preferSpeed: true,   // Runs often and may touch high-token inputs
  },
}

export const DEFAULT_ROLE_BEHAVIOR: Record<AgentRole, ModelBehaviorProfile> = {
  spec: 'balanced',
  coordinator: 'balanced',
  worker: 'precise',
  reviewer: 'precise',
  gateChecker: 'precise',
  contextIndexer: 'precise',
}

export const MODEL_BEHAVIOR_PROFILES: Array<{
  id: ModelBehaviorProfile
  label: string
  description: string
}> = [
  {
    id: 'precise',
    label: 'Precise',
    description: 'Repeatable and conservative; best for code, review, checks, and compact summaries.',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Careful but flexible; best for planning, specs, intake, and task reframing.',
  },
  {
    id: 'exploratory',
    label: 'Exploratory',
    description: 'More variety; best for early ideas before work is committed to a plan.',
  },
]

// ---------------------------------------------------------------------------
// Model catalog
//
// A curated list of recommended models with notes. This is the reference
// guide for what to load in LM Studio (or configure in your cloud provider).
//
// Ratings are 0–3: 0 = poor, 1 = adequate, 2 = good, 3 = excellent
// ---------------------------------------------------------------------------

export const ModelProvider = z.enum(['lm-studio', 'anthropic', 'openai', 'google', 'deepinfra'])
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
  inputPricePerMillionUsd: z.number().optional(),
  outputPricePerMillionUsd: z.number().optional(),
  cachedInputPricePerMillionUsd: z.number().optional(),
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
    recommendedRoles: ['worker', 'spec', 'coordinator', 'contextIndexer'],
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
    recommendedRoles: ['worker', 'reviewer', 'gateChecker', 'contextIndexer'],
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
    recommendedRoles: ['reviewer', 'gateChecker', 'contextIndexer'],
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
    recommendedRoles: ['reviewer', 'gateChecker', 'contextIndexer'],
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
  {
    id: 'deepseek-ai/DeepSeek-V4-Flash',
    displayName: 'DeepSeek V4 Flash',
    provider: 'deepinfra',
    contextWindow: 1_000_000,
    reasoning: 2,
    codegen: 2,
    structuredOutput: 3,
    speed: 3,
    recommendedRoles: ['spec', 'coordinator', 'contextIndexer', 'reviewer', 'gateChecker'],
    inputPricePerMillionUsd: 0.10,
    outputPricePerMillionUsd: 0.20,
    cachedInputPricePerMillionUsd: 0.02,
    notes: 'Recommended DeepInfra general lane from Guildhall replay work: strong structured coordination/review output, very long context, and useful cheap context-indexer challenger.',
  },
  {
    id: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
    displayName: 'Qwen 3 235B A22B Instruct 2507',
    provider: 'deepinfra',
    contextWindow: 262_000,
    reasoning: 3,
    codegen: 3,
    structuredOutput: 3,
    speed: 1,
    recommendedRoles: ['worker'],
    inputPricePerMillionUsd: 0.071,
    outputPricePerMillionUsd: 0.10,
    notes: 'Prior DeepInfra worker lane from Guildhall replay work. Best strict worker pass rate and structured-output reliability in the earlier open-model set, but DeepInfra currently does not advertise cached-token pricing for this exact model, so avoid it for high-reuse worker runs unless quality matters more than cache savings.',
  },
  {
    id: 'Qwen/Qwen3.5-35B-A3B',
    displayName: 'Qwen 3.5 35B A3B',
    provider: 'deepinfra',
    contextWindow: 262_000,
    reasoning: 2,
    codegen: 3,
    structuredOutput: 2,
    speed: 2,
    recommendedRoles: ['worker', 'reviewer'],
    inputPricePerMillionUsd: 0.14,
    outputPricePerMillionUsd: 1.00,
    cachedInputPricePerMillionUsd: 0.05,
    notes: 'DeepInfra Qwen lane with advertised cached-input pricing. Use for cache-heavy worker runs while the larger Qwen 235B instruct lane lacks a cached price; retest output cost and strict-format reliability before making it the only worker lane.',
  },
  {
    id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo',
    displayName: 'Qwen 3 Coder 480B A35B Instruct Turbo',
    provider: 'deepinfra',
    contextWindow: 262_000,
    reasoning: 3,
    codegen: 3,
    structuredOutput: 2,
    speed: 3,
    recommendedRoles: ['worker'],
    inputPricePerMillionUsd: 0.30,
    outputPricePerMillionUsd: 1.00,
    cachedInputPricePerMillionUsd: 0.10,
    notes: 'Premium cached-input Qwen coding lane. Passed the latest FLL first-action worker replay quickly, but costs more than the cached Qwen 35B worker default.',
  },
  {
    id: 'Qwen/Qwen3.5-397B-A17B',
    displayName: 'Qwen 3.5 397B A17B',
    provider: 'deepinfra',
    contextWindow: 262_000,
    reasoning: 3,
    codegen: 3,
    structuredOutput: 2,
    speed: 2,
    recommendedRoles: ['worker'],
    inputPricePerMillionUsd: 0.49,
    outputPricePerMillionUsd: 3.60,
    cachedInputPricePerMillionUsd: 0.30,
    notes: 'Large cached-input Qwen challenger. Passed the latest FLL first-action worker replay, but the latency/cost tradeoff did not beat the cached Qwen 35B default.',
  },
  {
    id: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
    displayName: 'Qwen 3 235B A22B Thinking 2507',
    provider: 'deepinfra',
    contextWindow: 262_000,
    reasoning: 3,
    codegen: 3,
    structuredOutput: 2,
    speed: 1,
    recommendedRoles: ['worker'],
    inputPricePerMillionUsd: 0.23,
    outputPricePerMillionUsd: 2.30,
    cachedInputPricePerMillionUsd: 0.20,
    notes: 'Cached-input big-Qwen thinking lane. It is the closest cached sibling to the old 235B instruct worker, but failed one latest FLL first-action replay case and has a shallow cached-input discount.',
  },
  {
    id: 'moonshotai/Kimi-K2.6',
    displayName: 'Kimi K2.6',
    provider: 'deepinfra',
    contextWindow: 262_000,
    reasoning: 3,
    codegen: 3,
    structuredOutput: 2,
    speed: 1,
    recommendedRoles: ['worker'],
    inputPricePerMillionUsd: 0.75,
    outputPricePerMillionUsd: 3.50,
    cachedInputPricePerMillionUsd: 0.15,
    notes: 'Cached-input coding challenger. Passed the latest FLL first-action worker replay, but was too slow and expensive to recommend as the default worker lane.',
  },
  {
    id: 'Qwen/Qwen3.6-35B-A3B',
    displayName: 'Qwen 3.6 35B A3B',
    provider: 'deepinfra',
    contextWindow: 262_000,
    reasoning: 2,
    codegen: 3,
    structuredOutput: 2,
    speed: 2,
    recommendedRoles: ['contextIndexer', 'worker', 'reviewer'],
    notes: 'DeepInfra/open-model candidate when code understanding matters more than raw speed. Good bakeoff comparison against DeepSeek V4 Flash.',
  },
  {
    id: 'nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning',
    displayName: 'Nemotron 3 Nano Omni 30B A3B Reasoning',
    provider: 'deepinfra',
    contextWindow: 262_144,
    reasoning: 2,
    codegen: 2,
    structuredOutput: 3,
    speed: 3,
    recommendedRoles: ['reviewer', 'contextIndexer'],
    inputPricePerMillionUsd: 0.20,
    outputPricePerMillionUsd: 0.80,
    notes: 'Current DeepInfra open-model reviewer/context-indexer lane from Guildhall global config. Public DeepInfra metadata reports OpenAI-compatible structured output, tool, JSON, and reasoning support; keep it in bakeoffs against GLM and DeepSeek before expanding it to implementation work.',
  },
  {
    id: 'zai-org/GLM-4.6',
    displayName: 'GLM 4.6',
    provider: 'deepinfra',
    contextWindow: 128_000,
    reasoning: 3,
    codegen: 2,
    structuredOutput: 3,
    speed: 2,
    recommendedRoles: ['contextIndexer', 'coordinator', 'reviewer'],
    notes: 'Recommended DeepInfra context-indexer model from Guildhall live bakeoffs. Strong semantic architecture summaries; keep schema repair enabled for occasional malformed JSON.',
  },
  {
    id: 'zai-org/GLM-5.2',
    displayName: 'GLM 5.2',
    provider: 'deepinfra',
    contextWindow: 1_048_576,
    reasoning: 3,
    codegen: 2,
    structuredOutput: 3,
    speed: 2,
    recommendedRoles: ['spec', 'coordinator', 'worker', 'reviewer', 'contextIndexer'],
    inputPricePerMillionUsd: 1.40,
    outputPricePerMillionUsd: 4.40,
    cachedInputPricePerMillionUsd: 0.25,
    notes: 'DeepInfra GLM 5.2 challenger for long-context coding and agentic role bakeoffs. Added for live Guildhall benchmark comparison before any default-role promotion.',
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
  contextIndexer: z.string(),
})
export type ModelAssignmentConfig = z.infer<typeof ModelAssignmentConfig>

// Conservative defaults for a local-only setup. Larger local models can be
// excellent, but they should be an explicit opt-in because LM Studio may
// allocate enough memory to destabilize smaller machines.
export const DEFAULT_LOCAL_MODEL_ASSIGNMENT: ModelAssignmentConfig = {
  spec: 'qwen2.5-coder-7b-instruct',
  coordinator: 'qwen2.5-coder-7b-instruct',
  worker: 'qwen2.5-coder-7b-instruct',
  reviewer: 'qwen2.5-coder-7b-instruct',
  gateChecker: 'qwen2.5-coder-7b-instruct',
  contextIndexer: 'qwen2.5-coder-7b-instruct',
}

// Defaults for a hybrid setup: cloud for reasoning, local for code
export const DEFAULT_HYBRID_MODEL_ASSIGNMENT: ModelAssignmentConfig = {
  spec: 'claude-sonnet-4-6',
  coordinator: 'claude-sonnet-4-6',
  worker: 'qwen2.5-coder-7b-instruct',
  reviewer: 'claude-haiku-4-5-20251001',
  gateChecker: 'qwen2.5-coder-7b-instruct',
  contextIndexer: 'qwen2.5-coder-14b-instruct',
}

// Defaults for a cloud-only setup
export const DEFAULT_CLOUD_MODEL_ASSIGNMENT: ModelAssignmentConfig = {
  spec: 'claude-sonnet-4-6',
  coordinator: 'claude-sonnet-4-6',
  worker: 'claude-sonnet-4-6',
  reviewer: 'claude-haiku-4-5-20251001',
  gateChecker: 'claude-haiku-4-5-20251001',
  contextIndexer: 'claude-haiku-4-5-20251001',
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
