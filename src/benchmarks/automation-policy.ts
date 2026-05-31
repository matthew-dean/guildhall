import { randomUUID } from 'node:crypto'

import {
  AutoResolutionRecord,
  BenchmarkAutomationPolicy,
  BenchmarkDecisionImpact,
  BenchmarkOwnerQuestion,
  type AutoResolutionRecord as AutoResolutionRecordData,
  type BenchmarkAutomationPolicy as BenchmarkAutomationPolicyData,
  type BenchmarkOwnerQuestion as BenchmarkOwnerQuestionData,
} from './types.js'

const nonDelegableImpacts = new Set<BenchmarkDecisionImpact>([
  'billing',
  'data_privacy',
  'destructive_action',
  'external_provider_setup',
  'host_access',
  'release_state',
  'security_posture',
  'shared_git_history',
])

export interface SyntheticBenchmarkAnswer {
  questionId: string
  choiceId: string
  reason: string
}

export interface ResolveOwnerQuestionInput {
  runId: string
  question: BenchmarkOwnerQuestionData
  policy: BenchmarkAutomationPolicyData
  syntheticAnswers?: readonly SyntheticBenchmarkAnswer[]
  now?: () => string
  resolvedBy?: string
}

export function isNonDelegableQuestion(questionInput: BenchmarkOwnerQuestionData): boolean {
  const question = BenchmarkOwnerQuestion.parse(questionInput)
  if (question.nonDelegable) return true
  const impacts = question.recommendedAnswer?.decisionImpacts ?? []
  return impacts.some(impact => nonDelegableImpacts.has(impact))
}

export function resolveOwnerQuestion(input: ResolveOwnerQuestionInput): AutoResolutionRecordData {
  const policy = BenchmarkAutomationPolicy.parse(input.policy)
  const question = BenchmarkOwnerQuestion.parse(input.question)
  const now = input.now?.() ?? new Date().toISOString()
  const synthetic = input.syntheticAnswers?.find(answer => answer.questionId === question.id)
  const nonDelegable = isNonDelegableQuestion(question)

  if (synthetic) {
    const selected = question.choices.find(choice => choice.id === synthetic.choiceId)
    if (!selected) {
      throw new Error(`Synthetic answer ${synthetic.choiceId} does not match question ${question.id}.`)
    }
    return AutoResolutionRecord.parse({
      id: `auto-${randomUUID()}`,
      runId: input.runId,
      taskId: question.taskId,
      questionId: question.id,
      policy,
      status: 'synthetic_answer_used',
      selectedChoiceId: synthetic.choiceId,
      resolutionText: selected.label,
      recommendationConfidence: question.recommendedAnswer?.confidence,
      evidenceRefs: question.recommendedAnswer?.evidenceRefs ?? [],
      resolvedBy: input.resolvedBy ?? 'benchmark-automation',
      policyReason: synthetic.reason,
      recordedAt: now,
    })
  }

  if (nonDelegable) {
    return AutoResolutionRecord.parse({
      id: `auto-${randomUUID()}`,
      runId: input.runId,
      taskId: question.taskId,
      questionId: question.id,
      policy,
      status: 'blocked_by_policy',
      resolutionText: 'Blocked because this decision is marked non-delegable without an explicit fixture answer.',
      recommendationConfidence: question.recommendedAnswer?.confidence,
      evidenceRefs: question.recommendedAnswer?.evidenceRefs ?? [],
      resolvedBy: input.resolvedBy ?? 'benchmark-automation',
      policyReason: 'Non-delegable project policy decisions cannot be silently resolved by benchmark automation.',
      recordedAt: now,
    })
  }

  const recommendation = question.recommendedAnswer
  if (!recommendation) {
    return AutoResolutionRecord.parse({
      id: `auto-${randomUUID()}`,
      runId: input.runId,
      taskId: question.taskId,
      questionId: question.id,
      policy,
      status: 'blocked_by_policy',
      resolutionText: 'Blocked because the question did not include a recommended answer.',
      resolvedBy: input.resolvedBy ?? 'benchmark-automation',
      policyReason: 'Automation requires a recommendation or an explicit fixture answer.',
      recordedAt: now,
    })
  }

  const allowed = policy === 'fully_automated' ||
    (policy === 'ask_when_necessary' && recommendation.confidence === 'high') ||
    (policy === 'ask_more_often' && recommendation.confidence === 'high' && recommendation.decisionImpacts.length === 0)

  if (!allowed) {
    return AutoResolutionRecord.parse({
      id: `auto-${randomUUID()}`,
      runId: input.runId,
      taskId: question.taskId,
      questionId: question.id,
      policy,
      status: 'blocked_by_policy',
      resolutionText: 'Blocked because the run automation policy did not allow this recommendation to be applied.',
      recommendationConfidence: recommendation.confidence,
      evidenceRefs: recommendation.evidenceRefs,
      resolvedBy: input.resolvedBy ?? 'benchmark-automation',
      policyReason: `${policy} requires a higher-confidence or lower-risk recommendation.`,
      recordedAt: now,
    })
  }

  const choice = question.choices.find(candidate => candidate.id === recommendation.choiceId)
  if (!choice) {
    throw new Error(`Recommended choice ${recommendation.choiceId} does not match question ${question.id}.`)
  }

  return AutoResolutionRecord.parse({
    id: `auto-${randomUUID()}`,
    runId: input.runId,
    taskId: question.taskId,
    questionId: question.id,
    policy,
    status: 'auto_resolved',
    selectedChoiceId: choice.id,
    resolutionText: choice.label,
    recommendationConfidence: recommendation.confidence,
    evidenceRefs: recommendation.evidenceRefs,
    resolvedBy: input.resolvedBy ?? 'benchmark-automation',
    policyReason: `Run policy ${policy} allowed a ${recommendation.confidence}-confidence recommendation.`,
    recordedAt: now,
  })
}
