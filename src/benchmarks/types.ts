import { z } from 'zod'

export const BenchmarkAutomationPolicy = z.enum([
  'ask_more_often',
  'ask_when_necessary',
  'fully_automated',
])
export type BenchmarkAutomationPolicy = z.infer<typeof BenchmarkAutomationPolicy>

export const RecommendationConfidence = z.enum(['low', 'medium', 'high'])
export type RecommendationConfidence = z.infer<typeof RecommendationConfidence>

export const BenchmarkDecisionImpact = z.enum([
  'product_behavior',
  'security_posture',
  'billing',
  'release_state',
  'data_privacy',
  'external_provider_setup',
  'host_access',
  'shared_git_history',
  'destructive_action',
])
export type BenchmarkDecisionImpact = z.infer<typeof BenchmarkDecisionImpact>

export const BenchmarkEvidenceRef = z.object({
  id: z.string().min(1),
  kind: z.enum(['file', 'command', 'runtime', 'proof_path', 'mcp', 'ui', 'fixture', 'report']),
  summary: z.string().min(1),
  ref: z.string().min(1),
})
export type BenchmarkEvidenceRef = z.infer<typeof BenchmarkEvidenceRef>

export const RecommendedAnswerMetadata = z.object({
  choiceId: z.string().min(1),
  confidence: RecommendationConfidence,
  reason: z.string().min(1),
  risk: z.string().min(1),
  evidenceRefs: z.array(BenchmarkEvidenceRef).default([]),
  decisionImpacts: z.array(BenchmarkDecisionImpact).default([]),
})
export type RecommendedAnswerMetadata = z.infer<typeof RecommendedAnswerMetadata>

export const BenchmarkOwnerQuestion = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  prompt: z.string().min(1),
  choices: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
  })).min(2),
  recommendedAnswer: RecommendedAnswerMetadata.optional(),
  nonDelegable: z.boolean().default(false),
})
export type BenchmarkOwnerQuestion = z.infer<typeof BenchmarkOwnerQuestion>

export const AutoResolutionRecord = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  taskId: z.string().min(1),
  questionId: z.string().min(1),
  policy: BenchmarkAutomationPolicy,
  status: z.enum(['auto_resolved', 'blocked_by_policy', 'synthetic_answer_used']),
  selectedChoiceId: z.string().optional(),
  resolutionText: z.string().min(1),
  recommendationConfidence: RecommendationConfidence.optional(),
  evidenceRefs: z.array(BenchmarkEvidenceRef).default([]),
  resolvedBy: z.string().min(1),
  policyReason: z.string().min(1),
  overriddenByHuman: z.boolean().default(false),
  taskOutcome: z.enum(['pass', 'fail', 'unsupported', 'inconclusive', 'aborted', 'unknown']).default('unknown'),
  recordedAt: z.string().min(1),
})
export type AutoResolutionRecord = z.infer<typeof AutoResolutionRecord>

export const BenchmarkRunResult = z.object({
  runId: z.string().min(1),
  benchmarkId: z.string().min(1),
  benchmarkVersion: z.string().min(1),
  taskId: z.string().min(1),
  taskSubsetHash: z.string().min(1),
  guildhallVersion: z.string().min(1),
  guildhallCommit: z.string().min(1),
  runtimeImage: z.string().min(1),
  modelProvider: z.string().min(1),
  model: z.string().min(1),
  settings: z.record(z.unknown()).default({}),
  toolPolicy: z.string().min(1),
  taskInstruction: z.string().min(1),
  fixtureRef: z.string().min(1),
  projectRef: z.string().min(1),
  verificationCommandRefs: z.array(z.string()).default([]),
  timeoutMs: z.number().int().positive().default(120_000),
  retryPolicy: z.object({
    maxRetries: z.number().int().nonnegative().default(0),
    retryOnHarnessFailure: z.boolean().default(false),
  }).default({ maxRetries: 0, retryOnHarnessFailure: false }),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  tokenUse: z.object({
    input: z.number().int().nonnegative().default(0),
    output: z.number().int().nonnegative().default(0),
  }).default({ input: 0, output: 0 }),
  costUsd: z.number().nonnegative().default(0),
  turns: z.number().int().nonnegative(),
  commandCount: z.number().int().nonnegative(),
  automationPolicy: BenchmarkAutomationPolicy,
  autoResolutionCount: z.number().int().nonnegative(),
  blockedByPolicyCount: z.number().int().nonnegative(),
  result: z.enum(['pass', 'fail', 'unsupported', 'inconclusive', 'aborted']),
  failureClass: z.enum([
    'none',
    'task_failure',
    'false_success',
    'harness_failure',
    'blocked_by_policy',
    'unsupported',
    'timeout',
    'inconclusive',
  ]),
  failureSummary: z.string().default(''),
  proofPathRefs: z.array(BenchmarkEvidenceRef).default([]),
  evidenceRefs: z.array(BenchmarkEvidenceRef).default([]),
  auditRefs: z.array(BenchmarkEvidenceRef).default([]),
  redaction: z.object({
    internalOnly: z.boolean().default(true),
    publishable: z.boolean().default(false),
    redactionNotes: z.array(z.string()).default([]),
  }).default({ internalOnly: true, publishable: false, redactionNotes: [] }),
  metrics: z.record(z.number()).default({}),
})
export type BenchmarkRunResult = z.infer<typeof BenchmarkRunResult>

export const BenchmarkReport = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  generatedAt: z.string().min(1),
  automationPolicy: BenchmarkAutomationPolicy,
  taskSubsetHash: z.string().min(1),
  results: z.array(BenchmarkRunResult),
  autoResolutions: z.array(AutoResolutionRecord).default([]),
  summary: z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    unsupported: z.number().int().nonnegative(),
    inconclusive: z.number().int().nonnegative(),
    falseSuccesses: z.number().int().nonnegative(),
    blockedByPolicy: z.number().int().nonnegative(),
    autoResolutions: z.number().int().nonnegative(),
  }),
  outputPaths: z.object({
    jsonl: z.string().min(1),
    markdown: z.string().min(1),
  }).optional(),
})
export type BenchmarkReport = z.infer<typeof BenchmarkReport>
