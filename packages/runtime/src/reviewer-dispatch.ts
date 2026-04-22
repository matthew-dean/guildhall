import type { Task, TaskQueue, TaskStatus, ReviewVerdict } from '@guildhall/core'

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
  score: number
  failingSignals: string[]
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
export function deterministicReview(task: Task): DeterministicVerdict {
  const rubric = SOFT_GATE_RUBRIC
  const totalWeight = Object.values(rubric).reduce((a, b) => a + b, 0)
  let weighted = 0
  const failing: string[] = []

  const acs = task.acceptanceCriteria
  const acsAllMet = acs.length > 0 && acs.every((a) => a.met)
  if (acsAllMet) weighted += rubric['acceptance-criteria-met']
  else failing.push('acceptance-criteria-met')

  const hardGates = task.gateResults.filter((g) => g.type === 'hard')
  const hardAllPass = hardGates.length > 0 && hardGates.every((g) => g.passed)
  if (hardAllPass) weighted += rubric['no-regressions']
  else failing.push('no-regressions')

  const lintGate = hardGates.find((g) => g.gateId === 'lint')
  if (!lintGate || lintGate.passed) {
    weighted += rubric['conventions-followed']
  } else {
    failing.push('conventions-followed')
  }

  // No structured signal — assume credit. The LLM reviewer owns these.
  weighted += rubric['no-scope-creep']
  weighted += rubric.documented

  const score = weighted / totalWeight
  const verdict: DeterministicVerdict['verdict'] =
    score >= DETERMINISTIC_PASS_THRESHOLD ? 'approve' : 'revise'

  const reason =
    verdict === 'approve'
      ? `Deterministic review: score ${score.toFixed(2)} \u2265 ${DETERMINISTIC_PASS_THRESHOLD}`
      : `Deterministic review: score ${score.toFixed(2)} < ${DETERMINISTIC_PASS_THRESHOLD}; failing signals: ${failing.join(', ') || '(none recorded)'}`

  return { verdict, reason, score, failingSignals: failing }
}

export interface ApplyDeterministicVerdictInput {
  queue: TaskQueue
  taskId: string
  verdict: DeterministicVerdict
  now: string
  llmError?: string
  policyVersion?: string
}

export interface ApplyDeterministicVerdictResult {
  record: ReviewVerdict
  newStatus: TaskStatus
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

  const record: ReviewVerdict = {
    verdict: input.verdict.verdict,
    reviewerPath: 'deterministic',
    reason: input.verdict.reason,
    score: input.verdict.score,
    failingSignals: input.verdict.failingSignals,
    ...(input.llmError !== undefined ? { llmError: input.llmError } : {}),
    recordedAt: input.now,
    ...(input.policyVersion !== undefined ? { policyVersion: input.policyVersion } : {}),
  }
  task.reviewVerdicts.push(record)

  const newStatus: TaskStatus = input.verdict.verdict === 'approve' ? 'gate_check' : 'in_progress'
  task.status = newStatus
  task.updatedAt = input.now
  input.queue.lastUpdated = input.now

  return { record, newStatus }
}

/**
 * Record that the LLM reviewer path produced the verdict. Inferred from the
 * before/after status: a transition to `gate_check` means the LLM approved;
 * a transition to `in_progress` means it asked for revision; any other
 * terminal-ish transition (blocked, etc.) records a neutral "revise" so the
 * audit trail still has a row for this review pass.
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
}): ReviewVerdict | undefined {
  if (input.beforeStatus !== 'review') return undefined
  const idx = input.queue.tasks.findIndex((t) => t.id === input.taskId)
  if (idx < 0) return undefined
  const task = input.queue.tasks[idx]!

  const verdict: ReviewVerdict['verdict'] =
    input.afterStatus === 'gate_check' ? 'approve' : 'revise'
  const reason =
    verdict === 'approve'
      ? 'LLM reviewer approved (transitioned to gate_check)'
      : `LLM reviewer requested revision (transitioned to ${input.afterStatus})`

  const record: ReviewVerdict = {
    verdict,
    reviewerPath: 'llm',
    reason,
    failingSignals: [],
    recordedAt: input.now,
    ...(input.policyVersion !== undefined ? { policyVersion: input.policyVersion } : {}),
  }
  task.reviewVerdicts.push(record)
  return record
}
