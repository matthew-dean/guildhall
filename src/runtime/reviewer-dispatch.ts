import type { Task, TaskQueue, TaskStatus, ReviewVerdict } from '@guildhall/core'
import {
  summarizeScopedHardGateDisposition,
  type ScopedGateContext,
} from '@guildhall/tools'
import { stableProofPathId } from './proof-paths.js'
import { readStructuredReviewResult, validateStructuredReviewResultTargets } from './review-contract.js'

// ---------------------------------------------------------------------------
// FR-27 / AC-18: reviewer dispatch with deterministic fallback.
//
// The reviewer has three implementations, chosen by the per-domain lever
// `reviewer_mode`:
//
//   • `llm_only`                       — always call the LLM reviewer.
//   • `deterministic_only`             — score the soft-gate rubric from
//                                        gate results + acceptance criteria;
//                                        no LLM call.
//   • `llm_with_deterministic_fallback`— attempt the LLM; on timeout,
//                                        budget exhaustion, or provider
//                                        outage, fall back to deterministic.
//
// `reviewerPath` on every persisted verdict tells the human auditing the
// trail which code path produced the decision — the load-bearing piece of
// AC-18.
// ---------------------------------------------------------------------------

export type ReviewerMode =
  | 'llm_only'
  | 'deterministic_only'
  | 'llm_with_deterministic_fallback'

// §3 soft-gate rubric weights — sum = 4.1. These are the defaults in SPEC.md;
// a future lever could make them overridable per-domain, but for v0.3 the
// deterministic reviewer uses the default rubric and the default 0.80 pass
// threshold.
export const SOFT_GATE_RUBRIC = {
  'acceptance-criteria-met': 1.0,
  'no-scope-creep': 0.8,
  'conventions-followed': 0.7,
  'no-regressions': 1.0,
  documented: 0.6,
} as const satisfies Record<string, number>

export const DETERMINISTIC_PASS_THRESHOLD = 0.8

export interface DeterministicVerdict {
  verdict: 'approve' | 'revise'
  reason: string
  /**
   * Full signal-by-signal breakdown of how the rubric scored this task.
   * Populated alongside `reason` so the audit trail has the full working,
   * not just the headline.
   */
  reasoning: string
  score: number
  failingSignals: string[]
}

export interface DeterministicReviewContext {
  projectPath: string
  likelyTargetFiles: readonly string[]
  gateScopeExceptions: Task['gateScopeExceptions']
}

function effectiveAcceptanceCriteria(task: Task) {
  // Structured intake/migration is the only authority. Rendered Markdown is
  // deliberately ignored so a model cannot alter review behavior by changing
  // headings or prose around an unchanged contract.
  return task.acceptanceCriteria
}

function reviewTargetsForTask(task: Task) {
  return {
    acceptanceCriterionIds: effectiveAcceptanceCriteria(task).map(criterion => criterion.id),
    proofEvidenceIds: (task.proofPaths ?? []).flatMap(path =>
      (Array.isArray(path.expectedEvidence) ? path.expectedEvidence : [])
        .flatMap((evidence) => {
          if (typeof evidence === 'string' && evidence.trim()) return [evidence.trim()]
          if (evidence && typeof evidence === 'object' && typeof evidence.id === 'string' && evidence.id.trim()) {
            return [evidence.id.trim()]
          }
          return []
        }),
    ),
  }
}

export function shouldAdvanceToGateCheckPendingHardGates(
  task: Task,
  failingSignals: string[],
): boolean {
  if (failingSignals.some((signal) => signal !== 'no-regressions')) return false
  const acs = effectiveAcceptanceCriteria(task)
  if (acs.length === 0 || !acs.every((criterion) => criterion.met)) return false
  return !task.gateResults.some((gate) => gate.type === 'hard')
}

export function shouldAdvanceToGateCheckPendingAutomatedVerification(
  task: Task,
): boolean {
  if (task.gateResults.some((gate) => gate.type === 'hard')) return false
  const acs = effectiveAcceptanceCriteria(task)
  if (acs.length === 0) return false

  let pendingAutomatedCount = 0
  let metCount = 0
  for (const criterion of acs) {
    if (criterion.met) {
      metCount += 1
      continue
    }
    if (criterion.verifiedBy !== 'automated') return false
    const command = typeof criterion.command === 'string' ? criterion.command.trim() : ''
    // An automated criterion is executable only when intake recorded the
    // exact command. Description prose is explanatory and cannot promote a
    // task into a gate-check lane.
    if (!command) return false
    pendingAutomatedCount += 1
  }

  return pendingAutomatedCount > 0 && metCount > 0
}

/**
 * Rubric-driven verdict from observable task state alone. No LLM call, no
 * side effects. Mapping from rubric questions to integer signals keyed off
 * hard-gate results and acceptance-criteria flags:
 *
 *   • `acceptance-criteria-met` — full credit if every `acceptanceCriteria[i].met`
 *     is true AND at least one AC exists. Zero otherwise.
 *   • `no-regressions`          — full credit if every hard `gateResults[i].passed`
 *     is true AND at least one hard gate has run. Zero otherwise (no gate runs =
 *     can't confirm no regressions).
 *   • `conventions-followed`    — full credit if the `lint` hard gate passed
 *     or was not registered. Zero if it ran and failed.
 *   • `no-scope-creep`          — full credit absent structured signal (the
 *     deterministic reviewer has no way to verify scope boundaries from gates
 *     alone; the LLM reviewer picks this up semantically).
 *   • `documented`              — full credit; ditto.
 */
export function deterministicReview(
  task: Task,
  context?: DeterministicReviewContext,
): DeterministicVerdict {
  const rubric = SOFT_GATE_RUBRIC
  const totalWeight = Object.values(rubric).reduce((a, b) => a + b, 0)
  let weighted = 0
  const failing: string[] = []
  const trace: string[] = []

  const acs = effectiveAcceptanceCriteria(task)
  const acsAllMet = acs.length > 0 && acs.every((a) => a.met)
  const pendingAutomatedVerification =
    !acsAllMet && shouldAdvanceToGateCheckPendingAutomatedVerification(task)
  if (acsAllMet || pendingAutomatedVerification) {
    weighted += rubric['acceptance-criteria-met']
    trace.push(
      acsAllMet
        ? `acceptance-criteria-met: +${rubric['acceptance-criteria-met'].toFixed(1)} (${acs.length} AC(s), all met)`
        : `acceptance-criteria-met: +${rubric['acceptance-criteria-met'].toFixed(1)} (${acs.length} AC(s), only automated hard-verification checks remain unmet)`,
    )
  } else {
    failing.push('acceptance-criteria-met')
    const unmet = acs.filter((a) => !a.met).map((a) => a.id)
    trace.push(
      acs.length === 0
        ? `acceptance-criteria-met: +0.0 (no ACs defined — cannot credit)`
        : `acceptance-criteria-met: +0.0 (unmet: ${unmet.join(', ') || '?'})`,
    )
  }

  const hardGates = task.gateResults.filter((g) => g.type === 'hard')
  const scopedHardGateDisposition = context
    ? summarizeScopedHardGateDisposition(
        {
          projectPath: context.projectPath,
          likelyTargetFiles: context.likelyTargetFiles,
          gateScopeExceptions: context.gateScopeExceptions ?? [],
        } satisfies ScopedGateContext,
        hardGates,
      )
    : null
  const hardAllPass =
    hardGates.length > 0 &&
    (hardGates.every((g) => g.passed) || scopedHardGateDisposition?.shouldPass === true)
  if (hardAllPass) {
    weighted += rubric['no-regressions']
    if (hardGates.every((g) => g.passed)) {
      trace.push(`no-regressions: +${rubric['no-regressions'].toFixed(1)} (${hardGates.length} hard gate(s), all passed)`)
    } else {
      const exempted = scopedHardGateDisposition?.exemptedFailures.map((gate) => gate.gateId) ?? []
      trace.push(
        `no-regressions: +${rubric['no-regressions'].toFixed(1)} (${hardGates.length} hard gate(s), remaining failures are scoped unrelated repo-red: ${exempted.join(', ') || 'none'})`,
      )
    }
  } else {
    failing.push('no-regressions')
    const failed = hardGates.filter((g) => !g.passed).map((g) => g.gateId)
    trace.push(
      hardGates.length === 0
        ? `no-regressions: +0.0 (no hard gates have run — cannot confirm)`
        : `no-regressions: +0.0 (failed: ${failed.join(', ')})`,
    )
  }

  const lintGate = hardGates.find((g) => g.gateId === 'lint')
  if (!lintGate || lintGate.passed) {
    weighted += rubric['conventions-followed']
    trace.push(
      lintGate
        ? `conventions-followed: +${rubric['conventions-followed'].toFixed(1)} (lint gate passed)`
        : `conventions-followed: +${rubric['conventions-followed'].toFixed(1)} (no lint gate registered — credited)`,
    )
  } else {
    failing.push('conventions-followed')
    trace.push(`conventions-followed: +0.0 (lint gate failed)`)
  }

  // No structured signal — assume credit. The LLM reviewer owns these.
  weighted += rubric['no-scope-creep']
  weighted += rubric.documented
  trace.push(`no-scope-creep: +${rubric['no-scope-creep'].toFixed(1)} (no deterministic signal — credited)`)
  trace.push(`documented: +${rubric.documented.toFixed(1)} (no deterministic signal — credited)`)

  const score = weighted / totalWeight
  const advanceToGateCheck =
    pendingAutomatedVerification || shouldAdvanceToGateCheckPendingHardGates(task, failing)
  const verdict: DeterministicVerdict['verdict'] =
    advanceToGateCheck || score >= DETERMINISTIC_PASS_THRESHOLD ? 'approve' : 'revise'

  const reason = pendingAutomatedVerification
    ? 'Deterministic review: remaining unmet acceptance criteria are automated hard-verification steps; advance to gate_check.'
    : advanceToGateCheck
      ? 'Deterministic review: acceptance criteria are met and hard gates have not run yet; advance to gate_check.'
    : verdict === 'approve'
      ? `Deterministic review: score ${score.toFixed(2)} \u2265 ${DETERMINISTIC_PASS_THRESHOLD}`
      : `Deterministic review: score ${score.toFixed(2)} < ${DETERMINISTIC_PASS_THRESHOLD}; failing signals: ${failing.join(', ') || '(none recorded)'}`

  const reasoning = [
    `Rubric walkthrough (weighted /${totalWeight.toFixed(1)}):`,
    ...trace.map((t) => `  - ${t}`),
    `Total: ${weighted.toFixed(2)} / ${totalWeight.toFixed(1)} = ${score.toFixed(3)}`,
    pendingAutomatedVerification
      ? 'Special-case handoff: the only unmet acceptance criteria are automated hard-verification checks, and no hard gates have run yet. Advance to gate_check so the runner decides those remaining criteria.'
      : advanceToGateCheck
        ? 'Special-case handoff: all acceptance criteria are met, and no hard gates have run yet. Advance to gate_check so hard verification decides no-regressions.'
      : `Threshold: ${DETERMINISTIC_PASS_THRESHOLD} → ${verdict === 'approve' ? 'APPROVE' : 'REVISE'}`,
  ].join('\n')

  return {
    verdict,
    reason,
    reasoning,
    score,
    failingSignals: advanceToGateCheck ? [] : failing,
  }
}

export interface ApplyDeterministicVerdictInput {
  queue: TaskQueue
  taskId: string
  verdict: DeterministicVerdict
  now: string
  llmError?: string
  policyVersion?: string
  reviewerId?: string
}

export interface ApplyDeterministicVerdictResult {
  record: ReviewVerdict
  newStatus: TaskStatus
}

function assigneeForReviewOutcome(status: TaskStatus): string | undefined {
  switch (status) {
    case 'gate_check':
      return 'gate-checker-agent'
    case 'in_progress':
      return 'worker-agent'
    default:
      return undefined
  }
}

/**
 * Mutates the queue in place: appends a ReviewVerdict with
 * `reviewerPath: 'deterministic'`, transitions the task's status
 * (`approve` → `gate_check`, `revise` → `in_progress`), and bumps
 * `updatedAt`. The caller is responsible for persisting the queue.
 */
export function applyDeterministicVerdict(
  input: ApplyDeterministicVerdictInput,
): ApplyDeterministicVerdictResult {
  const idx = input.queue.tasks.findIndex((t) => t.id === input.taskId)
  if (idx < 0) throw new Error(`applyDeterministicVerdict: task ${input.taskId} not in queue`)
  const task = input.queue.tasks[idx]!
  const acceptedCriteriaIds = input.verdict.verdict === 'approve'
    ? effectiveAcceptanceCriteria(task)
      .filter(criterion => criterion.met)
      .map(criterion => criterion.id)
    : []
  const proofEvidenceIds = input.verdict.verdict === 'approve'
    ? (task.proofPaths ?? []).flatMap(path => path.kind === 'review'
      ? (Array.isArray(path.expectedEvidence) ? path.expectedEvidence : [])
        .map(evidence => evidence.id)
      : [])
    : []

  const record: ReviewVerdict = {
    verdict: input.verdict.verdict,
    reviewerPath: 'deterministic',
    reviewerId: input.reviewerId ?? 'deterministic-reviewer',
    reason: input.verdict.reason,
    reasoning: input.verdict.reasoning,
    score: input.verdict.score,
    failingSignals: input.verdict.failingSignals,
    ...(acceptedCriteriaIds.length > 0 ? { acceptedCriteriaIds } : {}),
    ...(proofEvidenceIds.length > 0 ? { proofEvidenceIds } : {}),
    ...(input.llmError !== undefined ? { llmError: input.llmError } : {}),
    ...(input.llmError !== undefined ? { failureCode: 'provider_unavailable' as const } : {}),
    recordedAt: input.now,
    ...(input.policyVersion !== undefined ? { policyVersion: input.policyVersion } : {}),
  }
  task.reviewVerdicts.push(record)
  if (record.verdict === 'approve') recordApprovedReviewProof(task, input.now)

  const newStatus: TaskStatus = input.verdict.verdict === 'approve' ? 'gate_check' : 'in_progress'
  task.status = newStatus
  const assignee = assigneeForReviewOutcome(newStatus)
  if (assignee) task.assignedTo = assignee
  task.updatedAt = input.now
  input.queue.lastUpdated = input.now

  return { record, newStatus }
}

/**
 * Extract the LLM reviewer's reasoning trace from the task. The reviewer
 * agent writes its per-AC + per-rubric walkthrough into `task.notes` via
 * the update-task tool; we pull the most-recent `reviewer-agent` note so
 * that text lands on the `ReviewVerdict.reasoning` field alongside the
 * verdict itself.
 *
 * Exported for test clarity — prefer passing `reasoning` explicitly into
 * `recordLlmVerdict` when you already have it.
 */
export function extractLlmReviewerReasoning(task: Task): string | undefined {
  // Walk backwards to find the latest note authored by the reviewer agent.
  for (let i = task.notes.length - 1; i >= 0; i--) {
    const note = task.notes[i]
    if (!note) continue
    if (note.agentId === 'reviewer-agent' || note.role === 'reviewer') {
      const content = note.content?.trim()
      if (content) return content
    }
  }
  return undefined
}

function extractLlmReviewerStructured(task: Task): unknown {
  for (let i = task.notes.length - 1; i >= 0; i--) {
    const note = task.notes[i]
    if (!note) continue
    if (note.agentId === 'reviewer-agent' || note.role === 'reviewer') {
      return note.structured
    }
  }
  return undefined
}

export function recordApprovedReviewProof(
  task: Task,
  now: string,
  recordedBy = 'reviewer-agent',
  proofEvidenceIds?: readonly string[],
): void {
  const proofPaths = (task as unknown as { proofPaths?: Array<Record<string, unknown>> }).proofPaths
  if (!Array.isArray(proofPaths)) return

  for (const [index, proofPath] of proofPaths.entries()) {
    if (proofPath.kind !== 'review') continue
    const proofPathId = stableProofPathId(proofPath, index)
    if (typeof proofPath.id !== 'string' || !proofPath.id.trim()) proofPath.id = proofPathId
    const rawExpectedEvidence = Array.isArray(proofPath.expectedEvidence) ? proofPath.expectedEvidence : []
    const expectedEvidence = rawExpectedEvidence.map((rawEvidence, index) => {
      if (rawEvidence && typeof rawEvidence === 'object' && !Array.isArray(rawEvidence)) {
        return rawEvidence as Record<string, unknown>
      }
      return {
        id: `${proofPathId}-evidence-${index}`,
        kind: 'artifact',
        description: String(rawEvidence),
        required: true,
      }
    })
    // Imported review paths historically stored bare strings. Canonicalize
    // them before recording evidence so the persisted contract has stable
    // evidence IDs that proof-health can match on every later read.
    proofPath.expectedEvidence = expectedEvidence
    if (expectedEvidence.length === 0) continue

    const existingRecords = Array.isArray(proofPath.verificationRecords)
      ? proofPath.verificationRecords.filter((record): record is Record<string, unknown> =>
          Boolean(record) && typeof record === 'object' && !Array.isArray(record),
        )
      : []
    const currentRecords = [...existingRecords]

    const latestApproved = [...(task.reviewVerdicts ?? [])]
      .reverse()
      .find(verdict => verdict.verdict === 'approve')
    const effectiveProofEvidenceIds = proofEvidenceIds ?? (
      latestApproved?.reviewerPath === 'llm' ? latestApproved.proofEvidenceIds ?? [] : undefined
    )
    const allowedEvidenceIds = effectiveProofEvidenceIds === undefined ? null : new Set(effectiveProofEvidenceIds)
    expectedEvidence.forEach((evidence, index) => {
      if (evidence.required === false) return
      const evidenceId = typeof evidence.id === 'string' && evidence.id.trim()
        ? evidence.id.trim()
        : `${proofPathId}-evidence-${index}`
      if (allowedEvidenceIds && !allowedEvidenceIds.has(evidenceId)) return
      const description = typeof evidence.description === 'string' && evidence.description.trim()
        ? evidence.description.trim()
        : evidenceId
      const withoutCurrentRecord = currentRecords.filter((record) => record.evidenceId !== evidenceId)
      withoutCurrentRecord.push({
        id: `review-proof-${evidenceId}-${now.replace(/[^0-9A-Za-z]/g, '')}`,
        evidenceId,
        kind: 'manual',
        status: 'passed',
        summary: `Approved review verified: ${description}`,
        recordedAt: now,
        recordedBy,
        evidenceRefs: [],
      })
      currentRecords.splice(0, currentRecords.length, ...withoutCurrentRecord)
    })

    proofPath.verificationRecords = currentRecords
    proofPath.status = 'verified'
    proofPath.updatedAt = now
    proofPath.updatedBy = 'reviewer-agent'
  }
}

/**
 * Record that the LLM reviewer path produced the verdict. Inferred from the
 * before/after status: a transition to `gate_check` means the LLM approved;
 * a transition to `in_progress` means it asked for revision; any other
 * terminal-ish transition (blocked, etc.) records a neutral "revise" so the
 * audit trail still has a row for this review pass.
 *
 * Reasoning: if `input.reasoning` is omitted, we pull the most-recent
 * reviewer-agent note off the task so the audit trail always has the "why".
 * Callers with a richer source of truth (streamed LLM output, structured
 * verdict JSON) can pass `reasoning` explicitly to override.
 *
 * Mutates the queue in place; caller persists.
 */
export function recordLlmVerdict(input: {
  queue: TaskQueue
  taskId: string
  beforeStatus: TaskStatus
  afterStatus: TaskStatus
  now: string
  policyVersion?: string
  reasoning?: string
}): { record: ReviewVerdict; normalizedStatus: TaskStatus } | undefined {
  if (input.beforeStatus !== 'review') return undefined
  const idx = input.queue.tasks.findIndex((t) => t.id === input.taskId)
  if (idx < 0) return undefined
  const task = input.queue.tasks[idx]!

  const reasoning = input.reasoning ?? extractLlmReviewerReasoning(task)
  const parsedStructuredResult = readStructuredReviewResult(
    reasoning,
    extractLlmReviewerStructured(task),
  )
  const structuredResult = parsedStructuredResult
    ? validateStructuredReviewResultTargets(parsedStructuredResult, reviewTargetsForTask(task))
    : null
  const verdict: ReviewVerdict['verdict'] = structuredResult?.verdict ?? 'revise'
  const normalizedStatus: TaskStatus = verdict === 'approve' ? 'gate_check' : 'in_progress'
  const reason =
    structuredResult
      ? verdict === 'approve'
        ? 'LLM reviewer returned a valid structured approval (transitioned to gate_check)'
        : `LLM reviewer returned a structured revision request (transitioned to ${input.afterStatus})`
      : 'LLM reviewer did not return the required structured machine result; review must be rerun.'

  const record: ReviewVerdict = {
    id: `review:${task.id}:reviewer-agent:${input.now}`,
    verdict,
    reviewerPath: 'llm',
    reviewerId: 'reviewer-agent',
    reviewerName: 'Review team',
    reason,
    ...(reasoning ? { reasoning } : {}),
    failingSignals: structuredResult ? [] : ['invalid-review-contract'],
    ...(structuredResult ? {} : { failureCode: 'invalid_review_contract' as const }),
    ...(structuredResult?.acceptedCriteriaIds.length ? { acceptedCriteriaIds: structuredResult.acceptedCriteriaIds } : {}),
    ...(structuredResult?.proofEvidenceIds.length ? { proofEvidenceIds: structuredResult.proofEvidenceIds } : {}),
    ...(structuredResult ? { findings: structuredResult.findings } : {}),
    ...((structuredResult?.advisoryScores.recommendationPriority ||
      structuredResult?.advisoryScores.expectedValue ||
      structuredResult?.advisoryScores.deferredRisk) ? {
        advisoryScores: structuredResult.advisoryScores,
      } : {}),
    recordedAt: input.now,
    ...(input.policyVersion !== undefined ? { policyVersion: input.policyVersion } : {}),
  }
  task.reviewVerdicts.push(record)
  if (verdict === 'approve') recordApprovedReviewProof(task, input.now, 'reviewer-agent', structuredResult?.proofEvidenceIds ?? [])
  return { record, normalizedStatus }
}
